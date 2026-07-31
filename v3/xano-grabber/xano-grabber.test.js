const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./xano-grabber.js'), 'utf8')

/* ------------------------------- mini DOM ------------------------------- *
 * This module is almost entirely DOM work: it re-resolves elements by
 * attribute every pass, deep-clones a template, walks ancestors for
 * visibility, and writes textContent / src. The flat element stubs the
 * sibling tests use cannot express any of that, and no test file in this repo
 * uses jsdom, so this is a small tree implementing exactly the surface the
 * module touches. The selector engine supports comma lists, descendant
 * combinators, tag names, `*`, and attribute presence/value — and THROWS on
 * anything else, so an unsupported selector fails loudly instead of silently
 * matching nothing.
 *
 * Two deliberate simplifications, both faithful enough for what is asserted:
 *   - textContent joins child text with a single space, which is what real
 *     indented HTML produces once the module collapses whitespace.
 *   - innerHTML is stored, not parsed. Only the overlay uses it, and the
 *     assertions are on the string it wrote.
 * ---------------------------------------------------------------------- */

class El {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.nodeType = 1
    this.attributes = Object.create(null)
    this.childNodes = []
    this.parentNode = null
    this.style = {}
    this.ownText = ''
    this._innerHTML = ''
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1)
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null
  }

  get isConnected() {
    let node = this
    while (node.parentNode) node = node.parentNode
    return node.__root === true
  }

  get textContent() {
    if (this.childNodes.length) return this.childNodes.map((node) => node.textContent).join(' ')
    return this.ownText
  }

  set textContent(value) {
    this.childNodes.forEach((node) => {
      node.parentNode = null
    })
    this.childNodes = []
    this.ownText = String(value)
  }

  get innerHTML() {
    return this._innerHTML
  }

  set innerHTML(value) {
    this._innerHTML = String(value)
    this.childNodes = []
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }

  hasAttribute(name) {
    return name in this.attributes
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  appendChild(child) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child, ref) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    if (ref == null) {
      this.childNodes.push(child)
      return child
    }
    const at = this.childNodes.indexOf(ref)
    assert.notEqual(at, -1, 'mini-dom: insertBefore reference node is not a child')
    this.childNodes.splice(at, 0, child)
    return child
  }

  remove() {
    if (!this.parentNode) return
    const at = this.parentNode.childNodes.indexOf(this)
    if (at !== -1) this.parentNode.childNodes.splice(at, 1)
    this.parentNode = null
  }

  cloneNode(deep) {
    assert.equal(deep, true, 'mini-dom: only deep cloneNode is used by this module')
    const clone = new El(this.tagName)
    Object.assign(clone.attributes, this.attributes)
    Object.assign(clone.style, this.style)
    clone.ownText = this.ownText
    this.childNodes.forEach((child) => clone.appendChild(child.cloneNode(true)))
    return clone
  }

  matches(selector) {
    return matchesSelector(this, selector)
  }

  closest(selector) {
    for (let node = this; node && node.nodeType === 1; node = node.parentElement) {
      if (matchesSelector(node, selector)) return node
    }
    return null
  }

  querySelector(selector) {
    return queryAll(this, selector)[0] || null
  }

  querySelectorAll(selector) {
    return queryAll(this, selector)
  }
}

// '[a="b"][c]' / 'img' / '*' -> { tag, attrs: [{name, value}] }
function parseCompound(part) {
  const spec = { tag: null, attrs: [] }
  let rest = part
  const tag = /^(\*|[a-zA-Z][\w-]*)/.exec(rest)
  if (tag) {
    spec.tag = tag[1] === '*' ? '*' : tag[1].toUpperCase()
    rest = rest.slice(tag[1].length)
  }
  const attribute = /^\[([^\]=]+)(?:="([^"]*)")?\]/
  while (rest) {
    const match = attribute.exec(rest)
    if (!match) throw new Error('mini-dom: unsupported selector part: ' + part)
    spec.attrs.push({ name: match[1], value: match[2] === undefined ? null : match[2] })
    rest = rest.slice(match[0].length)
  }
  if (!spec.tag && !spec.attrs.length) throw new Error('mini-dom: empty selector part: ' + part)
  return spec
}

function matchesCompound(el, spec) {
  if (spec.tag && spec.tag !== '*' && el.tagName !== spec.tag) return false
  return spec.attrs.every((attr) => {
    if (!el.hasAttribute(attr.name)) return false
    return attr.value === null || el.getAttribute(attr.name) === attr.value
  })
}

function parseSelector(selector) {
  return String(selector)
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => group.split(/\s+/).map(parseCompound))
}

function matchesSelector(el, selector) {
  return parseSelector(selector).some((compounds) => {
    const last = compounds[compounds.length - 1]
    if (!matchesCompound(el, last)) return false
    let index = compounds.length - 2
    let node = el.parentElement
    while (index >= 0) {
      if (!node) return false
      if (matchesCompound(node, compounds[index])) index -= 1
      node = node.parentElement
    }
    return true
  })
}

function queryAll(root, selector) {
  const found = []
  const walk = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType !== 1) return
      if (matchesSelector(child, selector)) found.push(child)
      walk(child)
    })
  }
  walk(root)
  return found
}

/* ----------------------------- page building ---------------------------- */

function el(tag, attributes, kids) {
  const node = new El(tag)
  Object.keys(attributes || {}).forEach((name) => {
    if (name === 'style') Object.assign(node.style, attributes.style)
    else node.setAttribute(name, attributes[name])
  })
  if (typeof kids === 'string') node.textContent = kids
  else if (Array.isArray(kids)) kids.forEach((kid) => node.appendChild(kid))
  return node
}

function buildPage(kids) {
  const html = new El('html')
  html.__root = true
  const body = new El('body')
  html.appendChild(body)
  ;(kids || []).forEach((kid) => body.appendChild(kid))
  return { html, body }
}

const DATA_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E'
const REAL_PHOTO = 'https://images.example.com/real-photo.jpg'

/* ---------------------------- module loading ---------------------------- */

function loadModule({
  page,
  hostname = 'the-starters-3-0.webflow.io',
  search = '',
  debug,
  // 'array'  = wf-xano has not loaded yet; window.WfXano is the pre-load queue.
  // 'object' = wf-xano's module scope has run but boot() has NOT created
  //            instances yet. This ordering is what a deferred page script hits.
  // 'none'   = no wf-xano on the page at all; the observer must carry it.
  wfXano = 'array',
  instances = [],
} = {}) {
  const warnings = []
  const infos = []
  const timers = new Map()
  let timerId = 0
  let observed = null
  let takeRecordsCalls = 0

  const sandbox = {
    console: {
      warn: (...args) => warnings.push(args.join(' ')),
      info: (...args) => infos.push(args.join(' ')),
      error: () => {},
      log: () => {},
    },
    location: { hostname, search },
    setTimeout: (fn, ms) => {
      timers.set(++timerId, { fn, ms })
      return timerId
    },
    clearTimeout: (id) => {
      timers.delete(id)
    },
    // Capture-and-drive stub, per the repo convention: nothing simulates real
    // mutations, the callback is invoked by hand with fabricated records.
    MutationObserver: function (callback) {
      const instance = {
        observe(target, opts) {
          observed = { target, opts, callback }
        },
        takeRecords() {
          takeRecordsCalls += 1
          return []
        },
        disconnect() {},
      }
      return instance
    },
    document: {
      readyState: 'complete',
      documentElement: page.html,
      body: page.body,
      createElement: (tag) => new El(tag),
      querySelector: (selector) => page.html.querySelector(selector),
      querySelectorAll: (selector) => page.html.querySelectorAll(selector),
      addEventListener: () => {},
    },
  }
  sandbox.window = sandbox
  if (debug !== undefined) sandbox.window.STARTERS_DEBUG = debug

  let booted = false
  const queue = []
  const api = {
    instances,
    get: () => null,
    // Mirrors wf-xano's own push(): run now if booted, else queue until boot.
    push(fn) {
      if (typeof fn !== 'function') return
      if (booted) fn(api)
      else queue.push(fn)
    },
  }
  if (wfXano === 'object') sandbox.window.WfXano = api
  else if (wfXano === 'array') sandbox.window.WfXano = queue

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  // wf-xano's boot(): create instances, then run everything that queued.
  const drain = () => {
    booted = true
    queue.splice(0).forEach((fn) => fn(api))
  }
  const flushTimers = () => {
    const pending = Array.from(timers.values())
    timers.clear()
    pending.forEach(({ fn }) => fn())
  }
  const pendingDelays = () => Array.from(timers.values()).map((timer) => timer.ms)
  // Feed the observer records the way a real batch would arrive, then let the
  // setTimeout(0) coalescer run.
  const records = (targets) => {
    assert.ok(observed, 'the module must have registered a MutationObserver')
    observed.callback(targets.map((target) => ({ type: 'childList', target })))
  }
  const reevaluate = () => vm.runInContext(source, sandbox)

  return {
    sandbox,
    warnings,
    infos,
    queue,
    api,
    drain,
    flushTimers,
    pendingDelays,
    records,
    reevaluate,
    grabber: () => sandbox.window.StartersV3XanoGrabber,
    flush: () => sandbox.window.StartersV3XanoGrabber.flush(),
    report: () => sandbox.window.StartersV3XanoGrabber.report(),
    observed: () => observed,
    takeRecordsCalls: () => takeRecordsCalls,
    overlay: () => page.html.querySelector('[data-starters-xano-grab-overlay]'),
  }
}

function rowFor(mod, id) {
  const row = Array.from(mod.report().ids).find((entry) => entry.id === id)
  assert.ok(row, 'no report row for grab-id "' + id + '"')
  return row
}

/* ------------------------------- fixtures ------------------------------- */

// A wf-xano wrapper: hidden template carrying the source attributes (so every
// clone inherits them) plus N rendered `wf-xano-item` clones.
function profileWrapper({ cards = [], hidden = false, id = 'photo', headlineId = 'headline' } = {}) {
  const template = el('article', { 'wf-xano-element': 'template', style: { display: 'none' } }, [
    el('img', {
      'wf-xano-grab-element': 'source',
      'wf-xano-grab-id': id,
      src: DATA_PLACEHOLDER,
    }),
    el('div', { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': headlineId }, 'TEMPLATE placeholder'),
  ])
  const list = el('div', {}, [template])
  const wrapper = el(
    'div',
    { 'wf-xano-element': 'wrapper', style: hidden ? { display: 'none' } : {} },
    [list],
  )
  const rendered = cards.map((card) => {
    const node = el('article', { 'wf-xano-item': '' }, [
      el('img', {
        'wf-xano-grab-element': 'source',
        'wf-xano-grab-id': id,
        src: card.photo || DATA_PLACEHOLDER,
      }),
      el('div', { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': headlineId }, card.headline || ''),
    ])
    if (card.recordId) node.setAttribute('data-wf-xano-id', card.recordId)
    list.appendChild(node)
    return node
  })
  return { wrapper, list, template, rendered }
}

function imgLanding(id, extra) {
  return el(
    'img',
    Object.assign(
      {
        'wf-xano-grab-element': 'landing',
        'wf-xano-grab-id': id,
        src: 'authored-placeholder.png',
        srcset: 'authored-placeholder.png 1x',
      },
      extra || {},
    ),
  )
}

function textLanding(id, text, extra) {
  return el(
    'div',
    Object.assign({ 'wf-xano-grab-element': 'landing', 'wf-xano-grab-id': id }, extra || {}),
    text,
  )
}

// A list source container: wf-xano's loader/empty state blocks live INSIDE it,
// alongside the hidden template and the rendered clones.
function teamSource({ items = [], loaderVisible = false, emptyVisible = false, id = 'team' } = {}) {
  const container = el('div', {
    'wf-xano-grab-element': 'source',
    'wf-xano-grab-list': '',
    'wf-xano-grab-id': id,
  })
  container.appendChild(el('div', { 'wf-xano-element': 'loader', style: { display: loaderVisible ? '' : 'none' } }, 'Loading team…'))
  container.appendChild(el('div', { 'wf-xano-element': 'empty', style: { display: emptyVisible ? '' : 'none' } }, 'No team members found'))
  container.appendChild(
    el('div', { 'wf-xano-element': 'template', style: { display: 'none' } }, [
      el('img', { src: DATA_PLACEHOLDER }),
      el('div', {}, 'Name placeholder'),
      el('div', {}, 'Role placeholder'),
    ]),
  )
  items.forEach((item) => {
    const card = el('div', { 'wf-xano-item': '' })
    if (item.recordId) card.setAttribute('data-wf-xano-id', item.recordId)
    if (item.photo !== null) card.appendChild(el('img', { src: item.photo || DATA_PLACEHOLDER }))
    card.appendChild(el('div', {}, item.name || ''))
    card.appendChild(el('div', {}, item.role || ''))
    card.appendChild(el('div', {}, item.location || ''))
    container.appendChild(card)
  })
  return container
}

function teamLanding({ id = 'team', slots = ['Name goes here', 'Role goes here', 'Lorem location TBD'] } = {}) {
  const template = el('div', { 'wf-xano-grab-element': 'list-item' }, [
    el('img', { src: 'authored-avatar.png' }),
    ...slots.map((text) => el('div', {}, text)),
  ])
  return el(
    'div',
    {
      'wf-xano-grab-element': 'landing',
      'wf-xano-grab-list-container': '',
      'wf-xano-grab-id': id,
    },
    [template],
  )
}

const cloneTexts = (landing) =>
  landing
    .querySelectorAll('[data-wf-xano-grab-clone]')
    .map((clone) => clone.children.filter((kid) => kid.tagName !== 'IMG').map((kid) => kid.textContent))

/* --------------------------------- tests -------------------------------- */

test('mirrors a rendered text value into every landing sharing the grab-id', () => {
  const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera — Designer' }] })
  const first = textLanding('headline', 'authored #1')
  const second = textLanding('headline', 'authored #2')
  loadModule({ page: buildPage([wrapper, first, second]) })
  assert.equal(first.textContent, 'Alex Rivera — Designer')
  assert.equal(second.textContent, 'Alex Rivera — Designer', 'ALL landings with a matching id must mirror')
})

test('mirrors an image src and strips the landing srcset first', () => {
  const { wrapper } = profileWrapper({ cards: [{ photo: REAL_PHOTO }] })
  const landing = imgLanding('photo')
  loadModule({ page: buildPage([wrapper, landing]) })
  assert.equal(landing.getAttribute('src'), REAL_PHOTO)
  assert.equal(landing.hasAttribute('srcset'), false, 'a surviving srcset would win over src in the browser')
})

test('gates a data: placeholder src — the landing keeps its authored content', () => {
  const { wrapper } = profileWrapper({ cards: [{ photo: DATA_PLACEHOLDER }] })
  const landing = imgLanding('photo')
  const mod = loadModule({ page: buildPage([wrapper, landing]) })
  assert.equal(landing.getAttribute('src'), 'authored-placeholder.png')
  assert.equal(rowFor(mod, 'photo').state, 'GATED')
})

test('gates a blob: src and an empty src the same way', () => {
  const blob = profileWrapper({ cards: [{ photo: 'blob:https://x/abc' }] })
  const blobLanding = imgLanding('photo')
  const modBlob = loadModule({ page: buildPage([blob.wrapper, blobLanding]) })
  assert.equal(blobLanding.getAttribute('src'), 'authored-placeholder.png')
  assert.equal(rowFor(modBlob, 'photo').state, 'GATED')

  const blank = profileWrapper({ cards: [{ photo: '   ' }] })
  const blankLanding = imgLanding('photo')
  const modBlank = loadModule({ page: buildPage([blank.wrapper, blankLanding]) })
  assert.equal(blankLanding.getAttribute('src'), 'authored-placeholder.png')
  assert.equal(rowFor(modBlank, 'photo').state, 'GATED')
})

test('gates an empty text value — no blanking of authored copy', () => {
  const { wrapper } = profileWrapper({ cards: [{ headline: '   ' }] })
  const landing = textLanding('headline', 'authored headline')
  const mod = loadModule({ page: buildPage([wrapper, landing]) })
  assert.equal(landing.textContent, 'authored headline')
  assert.equal(rowFor(mod, 'headline').state, 'GATED')
})

test('never reverts through wf-xano\'s replace cycle (clear before fetch, then a placeholder)', () => {
  const { wrapper, list, rendered } = profileWrapper({
    cards: [{ photo: REAL_PHOTO, headline: 'Alex Rivera' }],
  })
  const photo = imgLanding('photo')
  const headline = textLanding('headline', 'authored headline')
  const mod = loadModule({ page: buildPage([wrapper, photo, headline]) })
  assert.equal(photo.getAttribute('src'), REAL_PHOTO)
  assert.equal(headline.textContent, 'Alex Rivera')

  // load() removes every clone BEFORE the fetch: for the whole width of the
  // refresh there is no source element on the page at all.
  rendered[0].remove()
  mod.flush()
  assert.equal(photo.getAttribute('src'), REAL_PHOTO, 'a transient clear must not blank the landing')
  assert.equal(headline.textContent, 'Alex Rivera')

  // render() re-clones with a NEW element identity; this member now has no
  // photo, so the clone keeps the template's data: placeholder.
  const reclone = el('article', { 'wf-xano-item': '' }, [
    el('img', { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': 'photo', src: DATA_PLACEHOLDER }),
    el('div', { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': 'headline' }, 'Alex Rivera — PUBLISHED'),
  ])
  list.appendChild(reclone)
  mod.flush()
  assert.equal(photo.getAttribute('src'), REAL_PHOTO, 'only another REAL value may overwrite')
  assert.equal(rowFor(mod, 'photo').state, 'REAL')
  assert.equal(headline.textContent, 'Alex Rivera — PUBLISHED', 'a new real value does overwrite')
})

test('never treats a hidden wf-xano template as a source', () => {
  // Template placeholder first in DOM order, rendered clone second — the exact
  // trap: a first-match resolver mirrors the decoy forever.
  const { wrapper } = profileWrapper({ cards: [{ photo: REAL_PHOTO, headline: 'Real headline' }] })
  const photo = imgLanding('photo')
  const headline = textLanding('headline', 'authored')
  const mod = loadModule({ page: buildPage([wrapper, photo, headline]) })
  assert.equal(photo.getAttribute('src'), REAL_PHOTO)
  assert.equal(headline.textContent, 'Real headline')
  assert.ok(mod.grabber().counters.templateSkips > 0, 'template candidates must be counted as skipped')
})

test('a page with only the template renders nothing and reports the landing as waiting', () => {
  const { wrapper } = profileWrapper({ cards: [] })
  const photo = imgLanding('photo')
  const mod = loadModule({ page: buildPage([wrapper, photo]) })
  assert.equal(photo.getAttribute('src'), 'authored-placeholder.png')
  const row = rowFor(mod, 'photo')
  assert.equal(row.sourceFound, false)
  assert.equal(row.state, 'WAITING')
  // "Nothing rendered yet" is the normal state at boot, so the warning waits out
  // the grace window and only then re-checks.
  assert.deepEqual(mod.warnings, [], 'must not warn before the grace window')
  mod.flushTimers()
  assert.match(mod.warnings.join('\n'), /no source element on the page/)
})

test('the orphan warning stays quiet when the source renders inside the grace window', () => {
  const { wrapper, list } = profileWrapper({ cards: [] })
  const photo = imgLanding('photo')
  const headline = textLanding('headline', 'authored')
  const mod = loadModule({ page: buildPage([wrapper, photo, headline]) })
  assert.deepEqual(mod.warnings, [])
  // wf-xano's first response lands: clones appear before the grace expires.
  list.appendChild(
    el('article', { 'wf-xano-item': '' }, [
      el('img', { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': 'photo', src: REAL_PHOTO }),
      el('div', { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': 'headline' }, 'Alex Rivera'),
    ]),
  )
  mod.flushTimers()
  assert.equal(photo.getAttribute('src'), REAL_PHOTO)
  assert.deepEqual(mod.warnings, [], 'a healthy page must print nothing at all')
})

test('an IMG source into a non-IMG landing reports MISMATCH instead of a silent gate', () => {
  const { wrapper } = profileWrapper({ cards: [{ photo: REAL_PHOTO }] })
  const landing = textLanding('photo', 'authored text')
  const mod = loadModule({ page: buildPage([wrapper, landing]) })
  assert.equal(landing.textContent, 'authored text')
  assert.equal(rowFor(mod, 'photo').state, 'MISMATCH')
  assert.match(mod.warnings.join('\n'), /IMG source cannot fill a non-IMG landing/)
})

test('reports an orphan source (marked, but no landing carries the id)', () => {
  const orphan = el('div', { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': 'tagline' }, 'A tagline nobody grabs.')
  const mod = loadModule({ page: buildPage([orphan]) })
  const row = rowFor(mod, 'tagline')
  assert.equal(row.landings, 0)
  assert.equal(Array.from(row.notes).join(';'), 'ORPHAN SOURCE')
})

/* ------------------------------ list mirroring --------------------------- */

test('item selection ignores the loader, empty and template state blocks', () => {
  const container = teamSource({
    items: [
      { name: 'Alex Rivera', role: 'Designer', photo: REAL_PHOTO },
      { name: 'Blair Kim', role: 'Engineer', photo: null },
    ],
    loaderVisible: true,
  })
  const landing = teamLanding()
  const mod = loadModule({ page: buildPage([container, landing]) })
  assert.equal(mod.grabber().listItems(container).length, 2, 'state blocks are never items')
  assert.equal(landing.querySelectorAll('[data-wf-xano-grab-clone]').length, 2)
  assert.equal(rowFor(mod, 'team').items, '2/2')
})

test('falls back to unmarked, visible children when nothing carries wf-xano-item', () => {
  const container = el('div', {
    'wf-xano-grab-element': 'source',
    'wf-xano-grab-list': '',
    'wf-xano-grab-id': 'team',
  })
  container.appendChild(el('div', { 'wf-xano-element': 'empty', style: { display: 'none' } }, 'none'))
  container.appendChild(el('div', { style: { display: 'none' } }, 'hidden row'))
  container.appendChild(el('div', {}, [el('div', {}, 'Cass Vo'), el('div', {}, 'Editor')]))
  const landing = teamLanding({ slots: ['Name', 'Role'] })
  const mod = loadModule({ page: buildPage([container, landing]) })
  assert.equal(mod.grabber().listItems(container).length, 1)
  assert.deepEqual(Array.from(cloneTexts(landing)).map((row) => Array.from(row)), [['Cass Vo', 'Editor']])
})

test('pairs leaf text slots by index and BLANKS the slots the item does not fill', () => {
  const container = teamSource({
    items: [
      { name: 'Alex Rivera', role: 'Designer', photo: REAL_PHOTO },
      { name: 'Dana Rho', role: 'Product Manager', location: 'Lisbon', photo: REAL_PHOTO },
    ],
  })
  const landing = teamLanding() // three slots, the third authored "Lorem location TBD"
  loadModule({ page: buildPage([container, landing]) })
  const rows = Array.from(cloneTexts(landing)).map((row) => Array.from(row))
  assert.deepEqual(rows, [
    ['Alex Rivera', 'Designer', ''],
    ['Dana Rho', 'Product Manager', 'Lisbon'],
  ])
})

test('a single-slot item template receives the whole item text', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer', photo: REAL_PHOTO }] })
  const landing = teamLanding({ slots: ['One slot'] })
  loadModule({ page: buildPage([container, landing]) })
  const rows = Array.from(cloneTexts(landing)).map((row) => Array.from(row))
  assert.deepEqual(rows, [['Alex Rivera Designer']])
})

test('an item with no img keeps the clone\'s authored placeholder, and the img is never hidden', () => {
  const container = teamSource({
    items: [
      { name: 'Blair Kim', role: 'Engineer', photo: null },
      { name: 'Casey Wu', role: 'Strategist', photo: DATA_PLACEHOLDER },
    ],
  })
  const landing = teamLanding()
  loadModule({ page: buildPage([container, landing]) })
  const images = landing.querySelectorAll('[data-wf-xano-grab-clone] img')
  assert.equal(images.length, 2)
  images.forEach((img) => {
    assert.equal(img.getAttribute('src'), 'authored-avatar.png', 'no img and a data: img are treated identically')
    assert.notEqual(img.style.display, 'none', 'layout is Designer-owned — never hide the img')
  })
})

test('a real item img is mirrored into the clone', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer', photo: REAL_PHOTO }] })
  const landing = teamLanding()
  loadModule({ page: buildPage([container, landing]) })
  assert.equal(landing.querySelector('[data-wf-xano-grab-clone] img').getAttribute('src'), REAL_PHOTO)
})

test('keeps stale clones through a transient clear, then clears on a confirmed empty', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer', photo: REAL_PHOTO }] })
  const landing = teamLanding()
  const mod = loadModule({ page: buildPage([container, landing]) })
  assert.equal(landing.querySelectorAll('[data-wf-xano-grab-clone]').length, 1)

  // Replace cycle: every clone removed before the fetch, loader shown.
  container.querySelectorAll('[wf-xano-item]').forEach((node) => node.remove())
  container.querySelector('[wf-xano-element="loader"]').style.display = ''
  mod.flush()
  assert.equal(landing.querySelectorAll('[data-wf-xano-grab-clone]').length, 1, 'never-revert during a transient clear')
  assert.match(Array.from(rowFor(mod, 'team').notes).join(';'), /never-revert/)

  // A genuine zero-result: wf-xano shows the container's empty state block.
  container.querySelector('[wf-xano-element="loader"]').style.display = 'none'
  container.querySelector('[wf-xano-element="empty"]').style.display = ''
  mod.flush()
  assert.equal(landing.querySelectorAll('[data-wf-xano-grab-clone]').length, 0, 'confirmed empty is authoritative')
  assert.match(Array.from(rowFor(mod, 'team').notes).join(';'), /confirmed empty/)
})

test('rebuilds clones wholesale when the source items change', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer', photo: REAL_PHOTO }] })
  const landing = teamLanding()
  const mod = loadModule({ page: buildPage([container, landing]) })
  container.appendChild(
    el('div', { 'wf-xano-item': '' }, [
      el('img', { src: REAL_PHOTO }),
      el('div', {}, 'Eli Ford'),
      el('div', {}, 'Producer'),
      el('div', {}, ''),
    ]),
  )
  mod.flush()
  const rows = Array.from(cloneTexts(landing)).map((row) => Array.from(row))
  assert.deepEqual(rows, [
    ['Alex Rivera', 'Designer', ''],
    ['Eli Ford', 'Producer', ''],
  ])
})

test('a list landing with no list-item template is an ERROR, not a silent no-op', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer' }] })
  const landing = el('div', {
    'wf-xano-grab-element': 'landing',
    'wf-xano-grab-list-container': '',
    'wf-xano-grab-id': 'team',
  })
  const mod = loadModule({ page: buildPage([container, landing]) })
  assert.equal(rowFor(mod, 'team').state, 'ERROR')
  assert.match(mod.warnings.join('\n'), /list landing has no \[wf-xano-grab-element="list-item"\] template/)
})

test('a list source paired with a non-list landing is an ERROR, with no text fallback', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer' }] })
  const landing = textLanding('team', 'authored copy')
  const mod = loadModule({ page: buildPage([container, landing]) })
  assert.equal(rowFor(mod, 'team').state, 'ERROR')
  assert.equal(landing.textContent, 'authored copy', 'no whole-container text fallback')
  assert.match(mod.warnings.join('\n'), /the source is a list container/)
})

test('a list-container landing paired with a non-list source refuses to write', () => {
  const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
  const landing = teamLanding({ id: 'headline' })
  const mod = loadModule({ page: buildPage([wrapper, landing]) })
  assert.equal(rowFor(mod, 'headline').state, 'ERROR')
  assert.ok(landing.querySelector('[wf-xano-grab-element="list-item"]'), 'the item template must survive')
  assert.match(mod.warnings.join('\n'), /refusing to write into it/)
})

/* --------------------------- duplicate sources -------------------------- */

test('prefers the first VISIBLE source when two wrappers carry the same grab-ids', () => {
  const hiddenWrapper = profileWrapper({ cards: [{ headline: 'HIDDEN form headline' }], hidden: true })
  const visibleWrapper = profileWrapper({ cards: [{ headline: 'VISIBLE form headline' }] })
  const landing = textLanding('headline', 'authored')
  const mod = loadModule({ page: buildPage([hiddenWrapper.wrapper, visibleWrapper.wrapper, landing]) })
  assert.equal(landing.textContent, 'VISIBLE form headline', 'plain DOM order would mirror the hidden form')
  const row = rowFor(mod, 'headline')
  assert.equal(row.candidates, 2)
  assert.match(Array.from(row.notes).join(';'), /DUP SOURCES: 2 candidates/)
  assert.match(mod.warnings.join('\n'), /using the first VISIBLE one/)
})

test('follows the visible source across a display switch', () => {
  const a = profileWrapper({ cards: [{ headline: 'A headline' }] })
  const b = profileWrapper({ cards: [{ headline: 'B headline' }], hidden: true })
  const landing = textLanding('headline', 'authored')
  const mod = loadModule({ page: buildPage([a.wrapper, b.wrapper, landing]) })
  assert.equal(landing.textContent, 'A headline')
  a.wrapper.style.display = 'none'
  b.wrapper.style.display = ''
  mod.flush()
  assert.equal(landing.textContent, 'B headline')
  assert.ok(mod.grabber().counters.reresolves > 0)
})

/* ------------------------- wf-xano-grab-item picking -------------------- */

function threeRecordPage(landings) {
  const { wrapper } = profileWrapper({
    cards: [
      { headline: 'Alex Rivera', recordId: '101' },
      { headline: 'Blair Kim', recordId: '202' },
      { headline: 'Casey Wu', recordId: '303' },
    ],
  })
  return buildPage([wrapper].concat(landings))
}

test('wf-xano-grab-item picks a rendered card by record id', () => {
  const landing = textLanding('headline', 'authored', { 'wf-xano-grab-item': '202' })
  loadModule({ page: threeRecordPage([landing]) })
  assert.equal(landing.textContent, 'Blair Kim')
})

test('wf-xano-grab-item="#3" picks by 1-based index in DOM order', () => {
  const landing = textLanding('headline', 'authored', { 'wf-xano-grab-item': '#3' })
  loadModule({ page: threeRecordPage([landing]) })
  assert.equal(landing.textContent, 'Casey Wu')
})

test('two landings can mirror two different records of the same list', () => {
  const first = textLanding('headline', 'authored A', { 'wf-xano-grab-item': '#1' })
  const second = textLanding('headline', 'authored B', { 'wf-xano-grab-item': '303' })
  loadModule({ page: threeRecordPage([first, second]) })
  assert.equal(first.textContent, 'Alex Rivera')
  assert.equal(second.textContent, 'Casey Wu')
})

test('an unmatched wf-xano-grab-item reports ITEM NOT FOUND and keeps the authored content', () => {
  const byId = textLanding('headline', 'authored id', { 'wf-xano-grab-item': '999' })
  const byIndex = textLanding('headline', 'authored index', { 'wf-xano-grab-item': '#9' })
  const mod = loadModule({ page: threeRecordPage([byId, byIndex]) })
  assert.equal(byId.textContent, 'authored id')
  assert.equal(byIndex.textContent, 'authored index')
  const row = rowFor(mod, 'headline')
  assert.match(row.state, /ITEM NOT FOUND/)
  assert.match(Array.from(row.notes).join(';'), /ITEM NOT FOUND: 999/)
  assert.match(Array.from(row.notes).join(';'), /ITEM NOT FOUND: #9/)
  mod.flushTimers() // the warning is graced: a filtered list can miss a record for one pass
  assert.match(mod.warnings.join('\n'), /matched none of the 3 rendered source\(s\)/)
})

test('wf-xano-grab-item overrides the visible-preferred rule', () => {
  const hiddenWrapper = profileWrapper({ cards: [{ headline: 'HIDDEN but explicitly wanted', recordId: '77' }], hidden: true })
  const visibleWrapper = profileWrapper({ cards: [{ headline: 'VISIBLE default', recordId: '88' }] })
  const chosen = textLanding('headline', 'authored', { 'wf-xano-grab-item': '77' })
  const defaulted = textLanding('headline', 'authored')
  loadModule({ page: buildPage([hiddenWrapper.wrapper, visibleWrapper.wrapper, chosen, defaulted]) })
  assert.equal(chosen.textContent, 'HIDDEN but explicitly wanted')
  assert.equal(defaulted.textContent, 'VISIBLE default')
})

test('the overlay lists each candidate\'s data-wf-xano-id so record ids can be read off the page', () => {
  const landing = textLanding('headline', 'authored')
  const mod = loadModule({ page: threeRecordPage([landing]), hostname: 'localhost', search: '?xano-grab' })
  assert.deepEqual(Array.from(rowFor(mod, 'headline').candidateIds), ['101', '202', '303'])
  assert.match(mod.overlay().innerHTML, /101, 202, 303/)
})

/* -------------------------------- observer ------------------------------ */

test('observes body for childList, subtree and the filtered attributes', () => {
  const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
  const page = buildPage([wrapper, textLanding('headline', 'authored')])
  const mod = loadModule({ page })
  const observed = mod.observed()
  assert.equal(observed.target, page.body)
  assert.equal(observed.opts.childList, true)
  assert.equal(observed.opts.subtree, true)
  assert.equal(observed.opts.attributes, true)
  assert.deepEqual(Array.from(observed.opts.attributeFilter).sort(), [
    'class',
    'data-wf-xano-bound-value',
    'data-wf-xano-id',
    'src',
    'srcset',
    'style',
    'wf-xano-item',
  ])
  assert.equal(observed.opts.characterData, undefined, 'wf-xano never edits a text node in place')
})

test('loop guard: records inside a landing are ignored and never schedule a flush', () => {
  const { wrapper, rendered } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
  const landing = textLanding('headline', 'authored')
  const mod = loadModule({ page: buildPage([wrapper, landing]) })
  const before = mod.grabber().counters.flushes
  mod.flushTimers() // drain the boot sweeps so the queue starts clean
  const settled = mod.grabber().counters.flushes

  // Our own echo: the write we just made to the landing comes back as a record.
  mod.records([landing])
  assert.deepEqual(mod.pendingDelays(), [], 'a self-echo must not schedule a pass')
  assert.equal(mod.grabber().counters.echoes > 0, true)
  mod.flushTimers()
  assert.equal(mod.grabber().counters.flushes, settled, 'no flush ran for the echo')

  // A real page mutation does schedule exactly one coalesced pass.
  mod.records([rendered[0], rendered[0]])
  assert.deepEqual(mod.pendingDelays(), [0], 'coalesced: one pass per batch, not one per record')
  mod.flushTimers()
  assert.equal(mod.grabber().counters.flushes, settled + 1)
  assert.ok(before <= settled)
  assert.ok(mod.takeRecordsCalls() > 0, 'takeRecords() must drop the write echo each flush')
})

test('coalesces two batches in the same task into one flush', () => {
  const { wrapper, rendered } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
  const mod = loadModule({ page: buildPage([wrapper, textLanding('headline', 'authored')]) })
  mod.flushTimers()
  const settled = mod.grabber().counters.flushes
  mod.records([rendered[0]])
  mod.records([rendered[0]])
  assert.deepEqual(mod.pendingDelays(), [0])
  mod.flushTimers()
  assert.equal(mod.grabber().counters.flushes, settled + 1)
})

test('schedules belt sweeps after boot for instances created later, plus the orphan re-check', () => {
  const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
  const mod = loadModule({ page: buildPage([wrapper, textLanding('headline', 'authored')]) })
  assert.deepEqual(mod.pendingDelays(), [250, 800, 3000])
})

/* ------------------------------ wf-xano belt ---------------------------- */

test('arms the wf-xano results/error belt through push(), for both globals shapes', () => {
  const listeners = []
  const instance = {
    key: 'team',
    on(event, handler) {
      listeners.push(event)
      return this
    },
  }
  const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
  const mod = loadModule({
    page: buildPage([wrapper, textLanding('headline', 'authored')]),
    wfXano: 'object',
    instances: [instance],
  })
  // The API object exists before boot() creates instances: arming immediately
  // there was a real shipped bug, so nothing may have run yet.
  assert.equal(listeners.length, 0)
  assert.equal(mod.queue.length, 1, 'must have queued through push()')
  mod.drain()
  assert.deepEqual(listeners, ['results', 'error'])
  assert.match(mod.infos.join('\n'), /wf-xano belt armed on 1 instance/)
})

test('works with no wf-xano on the page at all — the observer carries it', () => {
  const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera', photo: REAL_PHOTO }] })
  const landing = textLanding('headline', 'authored')
  const photo = imgLanding('photo')
  const mod = loadModule({ page: buildPage([wrapper, landing, photo]), wfXano: 'none' })
  assert.equal(landing.textContent, 'Alex Rivera')
  assert.equal(photo.getAttribute('src'), REAL_PHOTO)
  assert.deepEqual(mod.warnings, [], 'a page without wf-xano is not a miswiring')
})

/* -------------------------------- overlay ------------------------------- */

test('the overlay renders only with ?xano-grab on a staging host', () => {
  const build = () => {
    const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
    return buildPage([wrapper, textLanding('headline', 'authored')])
  }
  const staging = loadModule({ page: build(), hostname: 'the-starters-3-0.webflow.io', search: '?xano-grab' })
  assert.ok(staging.overlay(), 'staging + param must render')
  assert.match(staging.overlay().innerHTML, /grab-id/)

  const noParam = loadModule({ page: build(), hostname: 'the-starters-3-0.webflow.io', search: '' })
  assert.equal(noParam.overlay(), null, 'staging without the param stays silent')

  const production = loadModule({ page: build(), hostname: 'thestarters.com', search: '?xano-grab' })
  assert.equal(production.overlay(), null, 'production must never render the overlay')

  const productionDebug = loadModule({
    page: build(),
    hostname: 'thestarters.com',
    search: '?xano-grab',
    debug: true,
  })
  assert.equal(productionDebug.overlay(), null, 'STARTERS_DEBUG must not unlock the overlay')

  const lookalike = loadModule({ page: build(), hostname: 'notwebflow.io', search: '?xano-grab' })
  assert.equal(lookalike.overlay(), null, 'a lookalike host is not staging')
})

test('the overlay reports state, item counts and mismatches', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer', photo: REAL_PHOTO }] })
  const { wrapper } = profileWrapper({ cards: [{ photo: DATA_PLACEHOLDER }] })
  const page = buildPage([
    container,
    teamLanding(),
    wrapper,
    imgLanding('photo'),
    textLanding('photo', 'wants a URL as text'),
    textLanding('nowhere', 'orphan landing'),
  ])
  const mod = loadModule({ page, hostname: 'localhost', search: '?debug&xano-grab=1' })
  const html = mod.overlay().innerHTML
  assert.match(html, /MISMATCH/)
  assert.match(html, /GATED/)
  assert.match(html, /ORPHAN LANDING/)
  assert.match(html, /1\/1/, 'list item counts in/out')
  assert.match(html, /flush #/)
})

test('the overlay escapes attribute values it prints', () => {
  const source = el(
    'div',
    { 'wf-xano-grab-element': 'source', 'wf-xano-grab-id': '<img onerror=x>' },
    'value',
  )
  const landing = textLanding('<img onerror=x>', 'authored')
  const mod = loadModule({
    page: buildPage([source, landing]),
    hostname: 'localhost',
    search: '?xano-grab',
  })
  assert.match(mod.overlay().innerHTML, /&lt;img onerror=x&gt;/)
  assert.doesNotMatch(mod.overlay().innerHTML, /<img onerror=x>/)
})

/* ------------------------------ diagnostics ----------------------------- */

test('stays silent in production when the page is miswired', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer' }] })
  const mod = loadModule({
    page: buildPage([container, textLanding('team', 'authored')]),
    hostname: 'thestarters.com',
  })
  assert.deepEqual(mod.warnings, [])
  assert.deepEqual(mod.infos, [])
})

test('STARTERS_DEBUG re-enables the warnings in production', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer' }] })
  const mod = loadModule({
    page: buildPage([container, textLanding('team', 'authored')]),
    hostname: 'thestarters.com',
    debug: true,
  })
  assert.equal(mod.warnings.length, 1)
  assert.match(mod.warnings[0], /the source is a list container/)
})

test('warns once per distinct problem, not once per flush', () => {
  const container = teamSource({ items: [{ name: 'Alex Rivera', role: 'Designer' }] })
  const mod = loadModule({ page: buildPage([container, textLanding('team', 'authored')]) })
  mod.flush()
  mod.flush()
  mod.flush()
  assert.equal(mod.warnings.length, 1, 'a flush runs on every mutation batch — do not spam the console')
})

/* --------------------------- boot gate + reloads ------------------------ */

test('does not arm at all on a page with no grab attributes', () => {
  const mod = loadModule({ page: buildPage([el('div', {}, 'unrelated page')]) })
  assert.deepEqual(mod.queue, [], 'marker gate must bail before touching WfXano')
  assert.equal(mod.observed(), null, 'no observer on an irrelevant page')
  assert.equal(mod.grabber().counters.flushes, 0)
})

test('exports its helpers even when the marker gate bails', () => {
  const mod = loadModule({ page: buildPage([el('div', {}, 'unrelated page')]) })
  assert.equal(typeof mod.grabber().isRealValue, 'function')
  assert.equal(mod.grabber().isRealValue(DATA_PLACEHOLDER), false)
  assert.equal(mod.grabber().isRealValue(REAL_PHOTO), true)
  assert.equal(mod.grabber().isRealValue(''), false)
})

test('boots only once even if the file loads twice (duplicate CDN tag)', () => {
  const { wrapper } = profileWrapper({ cards: [{ headline: 'Alex Rivera' }] })
  const landing = textLanding('headline', 'authored')
  const mod = loadModule({ page: buildPage([wrapper, landing]) })
  assert.equal(mod.queue.length, 1)
  const flushes = mod.grabber().counters.flushes
  mod.reevaluate()
  assert.equal(mod.queue.length, 1, 'a second evaluation must not queue a second arm()')
  assert.equal(mod.grabber().counters.flushes, flushes, 'and must not run a second boot pass')
  assert.equal(landing.textContent, 'Alex Rivera')
})
