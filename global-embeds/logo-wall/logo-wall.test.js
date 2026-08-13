const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./logo-wall.js'), 'utf8')

/* ------------------------------ mini DOM ------------------------------ *
 * The script is a closed IIFE that exports nothing, so the only seam is the
 * DOM a visitor's browser would end up holding. This is a small element tree
 * implementing exactly the surface the script touches — enough to run it for
 * real in a vm and then read the result back.
 *
 * Layout is test-controlled: an element's `layoutWidth` is its own measured
 * width, and anything without one measures as the sum of its children. That
 * is all `scrollWidth` needs to model, and it lets a test present a wide or a
 * narrow world without stubbing any script internals.
 * -------------------------------------------------------------------- */

/**
 * Selector support is deliberately narrow: `[attr]`, `[attr="value"]`, a bare
 * tag name, and `.class` — everything the script uses and nothing else. An
 * unsupported selector throws, so a future one cannot silently match nothing
 * and turn a real regression into a passing test.
 */
function matcher(selector) {
  const part = String(selector).trim()
  if (!part) throw new Error('mini DOM: empty selector')

  const attrValue = /^\[([a-z0-9-]+)="([^"]*)"\]$/.exec(part)
  if (attrValue) return (el) => el.getAttribute(attrValue[1]) === attrValue[2]

  const attr = /^\[([a-z0-9-]+)\]$/.exec(part)
  if (attr) return (el) => el.hasAttribute(attr[1])

  const cls = /^\.([a-z0-9_-]+)$/i.exec(part)
  if (cls) return (el) => el.classList.contains(cls[1])

  if (/^[a-z]+$/.test(part)) {
    const tag = part.toUpperCase()
    return (el) => el.tagName === tag
  }

  throw new Error('mini DOM: unsupported selector ' + part)
}

class El {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.nodeType = 1
    this.attributes = Object.create(null)
    this.children = []
    this.parentNode = null
    /** Inline styles the script writes. Empty is the contract, not an accident. */
    this.style = {}
    /** Test-controlled layout. null means "measure my children". */
    this.layoutWidth = null
    this.clientWidth = 0

    this._classes = new Set()
    this.classList = {
      add: (name) => this._classes.add(name),
      remove: (name) => this._classes.delete(name),
      contains: (name) => this._classes.has(name),
    }
  }

  get parentElement() {
    return this.parentNode
  }

  get firstElementChild() {
    return this.children[0] || null
  }

  get firstChild() {
    return this.children[0] || null
  }

  get scrollWidth() {
    if (this.layoutWidth != null) return this.layoutWidth
    return this.children.reduce((sum, child) => sum + child.scrollWidth, 0)
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    return this
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }

  hasAttribute(name) {
    return name in this.attributes
  }

  removeAttribute(name) {
    delete this.attributes[name]
    return this
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }

  /** Alias used by the fixtures; the script only ever calls appendChild. */
  append(child) {
    return this.appendChild(child)
  }

  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child)
    const at = reference ? this.children.indexOf(reference) : -1
    child.parentNode = this
    if (at < 0) this.children.push(child)
    else this.children.splice(at, 0, child)
    return child
  }

  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at >= 0) this.children.splice(at, 1)
    child.parentNode = null
    return child
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this)
    return this
  }

  cloneNode(deep) {
    const copy = new El(this.tagName)
    Object.keys(this.attributes).forEach((name) => copy.setAttribute(name, this.attributes[name]))
    this._classes.forEach((name) => copy.classList.add(name))
    copy.layoutWidth = this.layoutWidth
    copy.clientWidth = this.clientWidth
    if (this.complete !== undefined) copy.complete = this.complete
    if (deep) this.children.forEach((child) => copy.appendChild(child.cloneNode(true)))
    return copy
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: this.scrollWidth, height: 0 }
  }

  addEventListener() {}

  /** Depth-first self-and-descendants. */
  walk(out) {
    const acc = out || []
    acc.push(this)
    this.children.forEach((child) => child.walk(acc))
    return acc
  }

  /** Descendants only, matching the real querySelectorAll contract. */
  querySelectorAll(selector) {
    const test = matcher(selector)
    return this.walk().slice(1).filter(test)
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

/* ------------------------------ fixtures ------------------------------ */

const ITEM = 'data-logo-wall-element'
const CLONE = 'data-logo-wall-clone'
const INDEX = 'data-test-index'

/** One logo cell: a marked div of a known width holding a loaded image. */
function logoItem(index, width) {
  const el = new El('div').setAttribute(ITEM, 'item').setAttribute(INDEX, String(index))
  el.layoutWidth = width
  const img = new El('img')
  // Already-loaded images make whenImagesReady resolve inline, so armLoops runs
  // synchronously and the test can read the finished DOM straight after load().
  img.complete = true
  el.appendChild(img)
  return el
}

/**
 * html > body > section > wrapper > items — a padded ancestor chain, so a test
 * can prove the script leaves everything above the wrapper alone.
 */
function makePage(options) {
  const o = options || {}
  const html = new El('html')
  const body = new El('body')
  const section = new El('section')
  const wrapper = new El('div').setAttribute(ITEM, 'wrapper')

  html.clientWidth = o.viewportWidth == null ? 1200 : o.viewportWidth
  wrapper.clientWidth = o.wrapperWidth == null ? 0 : o.wrapperWidth
  if (o.tracks != null) wrapper.setAttribute('data-logo-wall-tracks', String(o.tracks))

  // What a Track computes as. 'flex' is the companion stylesheet applied;
  // 'block' is the stylesheet 404. Mutable, so a test can load the CSS late.
  const page = { html, body, section, wrapper, items: [], trackDisplay: o.trackDisplay || 'flex' }

  html.appendChild(body)
  body.appendChild(section)
  section.appendChild(wrapper)

  const width = o.itemWidth == null ? 100 : o.itemWidth
  for (let i = 0; i < (o.items || 0); i++) {
    const el = logoItem(i, width)
    wrapper.appendChild(el)
    page.items.push(el)
  }

  return page
}

/** Run the script for real against a page, in a fresh sandbox. */
function load(page, options) {
  const o = options || {}
  const warnings = []
  const warnArgs = []
  const listeners = {}
  const timers = new Map()
  let nextTimer = 1

  const sandbox = {
    console: {
      warn(...args) {
        warnArgs.push(args)
        warnings.push(args.filter((a) => typeof a === 'string').join(' '))
      },
      log() {},
    },
    // Manual-flush timers: the resize re-arm is debounced by 150ms, and a test
    // that has to wait 150 real milliseconds is a test that flakes.
    setTimeout(fn) {
      const id = nextTimer++
      timers.set(id, fn)
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    parseInt,
    parseFloat,
    isFinite,
    Number,
    String,
    Math,
    RegExp,
    Object,
    Array,
  }

  sandbox.window = sandbox
  sandbox.location = { hostname: o.hostname || 'www.thestarters.com' }
  sandbox.window.location = sandbox.location
  sandbox.window.innerWidth = page.html.clientWidth
  if (o.debug !== undefined) sandbox.window.STARTERS_DEBUG = o.debug
  sandbox.window.addEventListener = (type, fn) => {
    ;(listeners[type] = listeners[type] || []).push(fn)
  }
  sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} })
  // columnGap/display are what the script reads. The overflow keys are here so
  // the "ancestors are untouched" test has teeth: the retired bleed walk read
  // them to decide which ancestors to rewrite.
  sandbox.window.getComputedStyle = (el) => ({
    columnGap: '0px',
    display: el.getAttribute(ITEM) === 'track' ? page.trackDisplay : 'flex',
    overflowX: el === page.section ? 'hidden' : 'visible',
    overflowY: 'visible',
  })

  sandbox.document = {
    readyState: 'complete',
    documentElement: page.html,
    body: page.body,
    addEventListener: () => {},
    createElement: (tag) => new El(tag),
    querySelectorAll(selector) {
      const test = matcher(selector)
      return page.html.walk().filter(test)
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
  }

  vm.createContext(sandbox)
  new vm.Script(source).runInContext(sandbox)

  const flush = () => {
    const pending = Array.from(timers.entries())
    timers.clear()
    pending.forEach(([, fn]) => fn())
  }

  return {
    warnings,
    warnArgs,
    window: sandbox.window,
    listeners,
    flush,
    /** Fire the debounced resize re-arm the way a real viewport change would. */
    resize: () => {
      ;(listeners.resize || []).forEach((fn) => fn())
      flush()
    },
  }
}

/* ------------------------------ readers ------------------------------ */

function tracksOf(wrapper) {
  return wrapper.children.filter((child) => child.getAttribute(ITEM) === 'track')
}

function originalsOf(track) {
  return track.children.filter((child) => child.getAttribute(ITEM) === 'item')
}

function clonesOf(track) {
  return track.children.filter((child) => child.hasAttribute(CLONE))
}

function indexesOf(elements) {
  return elements.map((el) => Number(el.getAttribute(INDEX)))
}

/** Inline style the script wrote, serialized. '' is the contract. */
function inlineStyle(el) {
  return Object.keys(el.style)
    .filter((name) => el.style[name] !== '' && el.style[name] != null)
    .map((name) => name + ':' + el.style[name])
    .join(';')
}

function ancestorsOf(el) {
  const out = []
  let node = el.parentNode
  while (node) {
    out.push(node)
    node = node.parentNode
  }
  return out
}

/* ------------------------------ the tracks ------------------------------ */

test('one requested track holds every logo, in source order', () => {
  // itemWidth * items already exceeds 2x the wrapper, so nothing is cloned and
  // the distribution is readable on its own.
  const page = makePage({ items: 6, itemWidth: 100, wrapperWidth: 100, tracks: 1 })
  load(page)

  const tracks = tracksOf(page.wrapper)
  assert.equal(tracks.length, 1)
  assert.equal(page.wrapper.children.length, 1, 'the wrapper holds nothing but its tracks')
  assert.deepEqual(indexesOf(originalsOf(tracks[0])), [0, 1, 2, 3, 4, 5])
})

test('with no attribute the logos deal round-robin across three tracks', () => {
  const page = makePage({ items: 6, itemWidth: 100, wrapperWidth: 50 })
  load(page)

  const tracks = tracksOf(page.wrapper)
  assert.equal(tracks.length, 3, 'DEFAULT_TRACKS')
  assert.deepEqual(indexesOf(originalsOf(tracks[0])), [0, 3])
  assert.deepEqual(indexesOf(originalsOf(tracks[1])), [1, 4])
  assert.deepEqual(indexesOf(originalsOf(tracks[2])), [2, 5])
})

/* ------------------------------ the clone fill --------------------------- */

test('clones fill both sides symmetrically and leave the unique set centered', () => {
  // 4 items x 100px = 400. Target is 2x the wrapper's 1000 = 2000, so the fill
  // appends 4 sets (5 x 400 = 2000) and then mirrors them on the left.
  const page = makePage({ items: 4, itemWidth: 100, wrapperWidth: 1000, tracks: 1 })
  load(page)

  const track = tracksOf(page.wrapper)[0]
  const kids = track.children
  const originals = originalsOf(track)

  assert.deepEqual(indexesOf(originals), [0, 1, 2, 3], 'the originals survive untouched')
  assert.equal(clonesOf(track).length, kids.length - 4, 'everything else is a marked clone')

  const first = kids.indexOf(originals[0])
  const last = kids.indexOf(originals[3])
  assert.equal(last - first, 3, 'the unique set stays contiguous')
  assert.equal(first, kids.length - 1 - last, 'as many clones before it as after it')
  assert.ok(first > 0, 'the fill actually ran')
  assert.equal(first % 4, 0, 'whole clone sets on each side')

  const clone = kids[0]
  assert.equal(clone.getAttribute(CLONE), '', 'clones are marked')
  assert.equal(clone.getAttribute(ITEM), null, 'and stop answering to the item selector')
})

test('a track that can never reach its target stops cloning at the cap', () => {
  // 1px items against a 1,000,000px wrapper: the width target is unreachable, so
  // only MAX_CLONES can stop the loop.
  const page = makePage({ items: 2, itemWidth: 1, wrapperWidth: 1000000, tracks: 1 })
  load(page)

  const track = tracksOf(page.wrapper)[0]
  const kids = track.children
  const MAX_CLONES = 24
  assert.equal(clonesOf(track).length, MAX_CLONES * 2 * 2, 'two items, 24 sets each side')
  assert.equal(kids.length, 2 + MAX_CLONES * 2 * 2)
  assert.equal(kids.indexOf(originalsOf(track)[0]), MAX_CLONES * 2, 'still centered')
})

test('the fill target comes from the wrapper, not from the viewport', () => {
  // Same viewport in both worlds; only the wrapper differs. If the target were
  // viewport-derived these two would clone identically.
  const shared = { items: 4, itemWidth: 100, tracks: 1, viewportWidth: 1200 }
  const narrow = makePage(Object.assign({}, shared, { wrapperWidth: 400 }))
  const wide = makePage(Object.assign({}, shared, { wrapperWidth: 2000 }))
  load(narrow)
  load(wide)

  const narrowClones = clonesOf(tracksOf(narrow.wrapper)[0]).length
  const wideClones = clonesOf(tracksOf(wide.wrapper)[0]).length
  assert.ok(narrowClones > 0, 'the narrow wrapper still fills')
  assert.ok(
    wideClones > narrowClones,
    'a wider wrapper must need more clones, got ' + wideClones + ' vs ' + narrowClones
  )
})

/* --------------------------- the container is the mask -------------------- */

test('nothing above the wrapper is touched, and the wrapper is not resized', () => {
  const page = makePage({ items: 4, itemWidth: 100, wrapperWidth: 1000, tracks: 1 })
  load(page)

  assert.ok(clonesOf(tracksOf(page.wrapper)[0]).length > 0, 'the script did run')
  assert.equal(inlineStyle(page.wrapper), '', 'the wrapper sizes itself from the Designer, not from JS')
  ancestorsOf(page.wrapper).forEach((el) => {
    assert.equal(inlineStyle(el), '', el.tagName + ' must keep its own overflow and layout')
  })
})

/* ------------------------------ the bail-outs ---------------------------- */

test('a leftover non-item child stops the wrapper from being built', () => {
  const page = makePage({ items: 4, itemWidth: 100, wrapperWidth: 1000, tracks: 1 })
  page.wrapper.appendChild(new El('div')) // an unmarked Designer element
  load(page)

  assert.equal(tracksOf(page.wrapper).length, 0)
  assert.equal(page.wrapper.querySelectorAll('[' + CLONE + ']').length, 0)
})

test('the Designer canvas is left alone', () => {
  const page = makePage({ items: 4, itemWidth: 100, wrapperWidth: 1000, tracks: 1 })
  page.html.classList.add('wf-design-mode')
  load(page)

  assert.equal(tracksOf(page.wrapper).length, 0)
  assert.equal(page.wrapper.getAttribute('data-logo-wall-inited'), null)
  assert.equal(page.wrapper.children.length, 4, 'the authored items are still the authored items')
})

/* --------------------------- the missing-CSS guard ----------------------- */

/** A wall wide enough that a healthy arm always clones. */
function fillingPage(extra) {
  return makePage(
    Object.assign({ items: 4, itemWidth: 100, wrapperWidth: 1000, tracks: 1 }, extra || {})
  )
}

test('a Track that is not a flex row leaves the logos static and uncloned', () => {
  // The homepage incident: the stylesheet URL 404d, the Track laid out as a
  // block, the fill target became unreachable and 22 items became ~550 nodes.
  const page = fillingPage({ trackDisplay: 'block' })
  const { warnings, warnArgs } = load(page, { debug: true })

  const track = tracksOf(page.wrapper)[0]
  assert.equal(clonesOf(track).length, 0, 'no clones at all, not merely fewer')
  assert.equal(track.children.length, 4, 'the Track holds the originals and nothing else')
  assert.deepEqual(indexesOf(originalsOf(track)), [0, 1, 2, 3], 'untouched and in order')
  track.children.forEach((child) => {
    assert.equal(inlineStyle(child), '', 'nothing is transformed or positioned')
  })

  assert.equal(warnings.length, 1, 'exactly one warning: ' + JSON.stringify(warnings))
  assert.match(warnings[0], /\[logo-wall\].*structural CSS missing/)
  assert.ok(warnArgs[0].includes(page.wrapper), 'the warning points at the offending wrapper')
})

test('the missing-CSS warning stays silent in production', () => {
  const page = fillingPage({ trackDisplay: 'block' })
  const { warnings } = load(page, { hostname: 'www.thestarters.com' })
  assert.deepEqual(warnings, [], 'visitors never see console noise')
  assert.equal(clonesOf(tracksOf(page.wrapper)[0]).length, 0, 'but the guard still holds')
})

test('late-loading CSS recovers on the next re-arm, without a second warning', () => {
  const page = fillingPage({ trackDisplay: 'block' })
  const { warnings, resize } = load(page, { debug: true })

  const track = tracksOf(page.wrapper)[0]
  assert.equal(clonesOf(track).length, 0, 'static while the stylesheet is missing')

  page.trackDisplay = 'flex' // the stylesheet finally arrives
  resize()

  assert.ok(clonesOf(track).length > 0, 'the fill runs on re-arm, no reload needed')
  assert.equal(warnings.length, 1, 'the warning is once per wrapper, the recovery is not')
})

test('losing the stylesheet on a re-arm strips the clones it already made', () => {
  // A re-arm from a healthy state must not leave stale clones stranded in a
  // Track that can no longer lay them out.
  const page = fillingPage()
  const { resize, warnings } = load(page, { debug: true })

  const track = tracksOf(page.wrapper)[0]
  assert.ok(clonesOf(track).length > 0, 'healthy first arm')
  assert.deepEqual(warnings, [], 'and no warning while the CSS is present')

  page.trackDisplay = 'block'
  resize()

  assert.equal(clonesOf(track).length, 0)
  assert.deepEqual(indexesOf(originalsOf(track)), [0, 1, 2, 3], 'the originals survive')
  assert.equal(warnings.length, 1)
})

/* ------------------------------- drift guard ----------------------------- */

test('the header @release marker matches the exposed release string', () => {
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the logo-wall.js header')
  const page = makePage({ items: 2, itemWidth: 100, wrapperWidth: 100, tracks: 1 })
  const { window } = load(page)
  assert.equal(window.__startersLogoWall.release, marker[1])
})
