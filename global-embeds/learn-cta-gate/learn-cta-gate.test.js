const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE_PATH = path.join(__dirname, 'learn-cta-gate.js')
const CSS_PATH = path.join(__dirname, 'learn-cta-gate.css')
const source = fs.readFileSync(SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// Minimal DOM, same spirit as the replica-list / step-flow harnesses (there is
// no jsdom in this repo): a real parent/child tree so insertBefore and
// nextSibling behave, a tiny selector engine for the attribute and compound
// class selectors this embed queries, a TreeWalker over text nodes, and
// controllable stubs for getComputedStyle, IntersectionObserver, setTimeout and
// gsap.
// ---------------------------------------------------------------------------

const SHOW_TEXT = 4
const FILTER_ACCEPT = 1
const FILTER_REJECT = 2

class Style {
  constructor() {
    this._props = {}
  }
  set cssText(value) {
    String(value)
      .split(';')
      .filter(Boolean)
      .forEach((decl) => {
        const idx = decl.indexOf(':')
        if (idx > 0) this._props[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim()
      })
  }
  get cssText() {
    return Object.entries(this._props)
      .map(([k, v]) => `${k}:${v}`)
      .join(';')
  }
}

// Style is a plain bag elsewhere: the embed assigns .visibility, .opacity,
// .pointerEvents, .transform, .willChange, .overflow directly.
function makeStyle() {
  const s = new Style()
  return s
}

class Node {
  constructor(nodeType) {
    this.nodeType = nodeType
    this.childNodes = []
    this.parentNode = null
  }
  get nextSibling() {
    if (!this.parentNode) return null
    const kids = this.parentNode.childNodes
    const i = kids.indexOf(this)
    return i >= 0 && i + 1 < kids.length ? kids[i + 1] : null
  }
}

class Text extends Node {
  constructor(value) {
    super(3)
    this.nodeValue = value
    this.nodeName = '#text'
  }
}

class Element extends Node {
  /** @param {string} nodeName @param {Record<string,string>} attrs */
  constructor(nodeName, attrs = {}) {
    super(1)
    this.nodeName = nodeName.toUpperCase()
    this._attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]))
    this.style = makeStyle()
    /** what getComputedStyle reports; the embed reads display/visibility/opacity */
    this.computed = { display: 'flex', visibility: 'hidden', opacity: '0' }
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }
  setAttribute(name, value) {
    this._attrs.set(name, String(value))
  }
  hasAttribute(name) {
    return this._attrs.has(name)
  }

  append(...kids) {
    kids.forEach((k) => {
      k.parentNode = this
      this.childNodes.push(k)
    })
    return this
  }

  insertBefore(newNode, refNode) {
    newNode.parentNode = this
    const i = refNode ? this.childNodes.indexOf(refNode) : -1
    if (i < 0) this.childNodes.push(newNode)
    else this.childNodes.splice(i, 0, newNode)
    return newNode
  }

  /** depth-first descendants, document order */
  descendants() {
    const out = []
    const walk = (n) => {
      n.childNodes.forEach((c) => {
        out.push(c)
        if (c.nodeType === 1) walk(c)
      })
    }
    walk(this)
    return out
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null
  }

  querySelectorAll(sel) {
    return this.descendants().filter((n) => n.nodeType === 1 && matches(n, sel))
  }
}

/** Supports `[attr="value"]` chains and `.class.class` chains. */
function matches(el, sel) {
  let rest = String(sel).trim()
  if (!rest) return false
  while (rest) {
    const attr = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest)
    if (attr) {
      const value = el.getAttribute(attr[1])
      if (value === null) return false
      const expected = attr[2] !== undefined ? attr[2] : attr[3]
      if (expected !== undefined && value !== expected) return false
      rest = rest.slice(attr[0].length)
      continue
    }
    const cls = /^\.([\w-]+)/.exec(rest)
    if (cls) {
      const classAttr = el.getAttribute('class') || ''
      if (!classAttr.split(/\s+/).includes(cls[1])) return false
      rest = rest.slice(cls[0].length)
      continue
    }
    throw new Error('unsupported selector: ' + sel)
  }
  return true
}

function createTreeWalker(root, whatToShow, filter) {
  const all = root
    .descendants()
    .filter((n) => (whatToShow === SHOW_TEXT ? n.nodeType === 3 : true))
    .filter((n) => !filter || filter.acceptNode(n) === FILTER_ACCEPT)
  let i = -1
  return {
    nextNode() {
      i += 1
      return i < all.length ? all[i] : null
    },
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {number} opts.chars   how many characters of article text to build
 * @param {boolean} [opts.wrapper]        include the gate wrapper (default true)
 * @param {boolean} [opts.article]        include the article body (default true)
 * @param {boolean} [opts.backdrop]       include the backdrop (default true)
 * @param {string}  [opts.display]        computed display of the wrapper
 * @param {Record<string,string>} [opts.attrs] extra attributes on the wrapper
 * @param {boolean} [opts.gsap]           expose a gsap stub (default true)
 * @param {boolean} [opts.reducedMotion]
 * @param {string}  [opts.hostname]
 * @param {'resolved'|'rejected'|'absent'} [opts.memberReady] how the site's
 *        Memberstack readiness promise behaves. Defaults to 'resolved', which
 *        is the real production shape — boot must wait for it.
 *
 * Async because boot is now gated on that promise: the harness flushes
 * microtasks before returning so callers see a booted embed.
 */
async function harness(opts = {}) {
  const {
    chars = 6000,
    wrapper: withWrapper = true,
    article: withArticle = true,
    backdrop: withBackdrop = true,
    display = 'flex',
    attrs = {},
    gsap: withGsap = true,
    reducedMotion = false,
    hostname = 'www.thestarters.com',
    memberReady = 'resolved',
  } = opts

  const body = new Element('body')
  const root = new Element('html').append(body)

  let wrapperEl = null
  if (withWrapper) {
    wrapperEl = new Element('section', {
      'data-learn-gate-element': 'wrapper',
      class: 'section_learn-cta-gate',
      ...attrs,
    })
    wrapperEl.computed = { display, visibility: 'hidden', opacity: '0' }
    if (withBackdrop) {
      wrapperEl.append(
        new Element('div', {
          'data-learn-gate-element': 'backdrop',
          class: 'learn-cta-gate_backdrop',
        })
      )
    }
    wrapperEl.append(
      new Element('div', {
        'data-learn-gate-element': 'content',
        class: 'learn-cta-gate_contents',
      })
    )
    body.append(wrapperEl)
  }

  if (withArticle) {
    const article = new Element('div', { class: 'content_rte w-richtext' })
    // Split across paragraphs so the sentinel lands between real text nodes,
    // the way it will in CMS rich text.
    const perPara = 500
    for (let written = 0; written < chars; written += perPara) {
      const n = Math.min(perPara, chars - written)
      article.append(new Element('p').append(new Text('a'.repeat(n))))
    }
    // A script tag inside rich text must not count toward the character total.
    article.append(new Element('script').append(new Text('x'.repeat(9000))))
    body.append(article)
  }

  const timers = []
  const observers = []
  const captured = []
  const events = []
  const logs = { warn: [], info: [] }
  const gsapCalls = []

  const document = {
    readyState: 'complete',
    documentElement: root,
    body,
    createElement: (tag) => new Element(tag),
    createTreeWalker,
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    addEventListener: () => {},
  }

  function makeTimeline(config) {
    const tl = {
      config,
      played: false,
      set: (...a) => (gsapCalls.push(['set', ...a]), tl),
      fromTo: (...a) => (gsapCalls.push(['fromTo', ...a]), tl),
      play: () => {
        tl.played = true
        if (config && typeof config.onComplete === 'function') config.onComplete()
        return tl
      },
    }
    return tl
  }

  const context = {
    console: {
      warn: (...a) => logs.warn.push(a.join(' ')),
      info: (...a) => logs.info.push(a.join(' ')),
      log: () => {},
    },
    document,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeout: (id) => {
      if (id >= 1 && id <= timers.length) timers[id - 1].cleared = true
    },
    IntersectionObserver: class {
      constructor(cb, options) {
        this.cb = cb
        this.options = options
        this.targets = []
        this.disconnected = false
        observers.push(this)
      }
      observe(el) {
        this.targets.push(el)
      }
      disconnect() {
        this.disconnected = true
      }
      /** test helper */
      fire(isIntersecting = true) {
        this.cb(this.targets.map((t) => ({ target: t, isIntersecting })), this)
      }
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type
        this.detail = init && init.detail
      }
    },
  }

  const windowObj = {
    location: { hostname, pathname: '/learn/interviews-analyses/how-to-build-trust' },
    getComputedStyle: (el) => el.computed,
    matchMedia: (q) => ({ matches: reducedMotion && /reduce/.test(q) }),
    dispatchEvent: (e) => events.push(e),
    posthog: { capture: (name, props) => captured.push({ name, props }) },
  }

  // The site's readiness promise. Deliberately NOT already-resolved: a promise
  // that has settled before the embed loads would hide a boot that ignored it.
  let releaseMemberReady = null
  if (memberReady !== 'absent') {
    windowObj.memberReady = new Promise((resolve, reject) => {
      releaseMemberReady = () => (memberReady === 'rejected' ? reject(new Error('ms failed')) : resolve({}))
    })
    // Swallow the rejection so an unhandled rejection cannot fail the run; the
    // embed attaches its own handler when it calls .then(boot, boot).
    windowObj.memberReady.catch(() => {})
  }
  context.window = windowObj
  const gsapSets = []
  if (withGsap) {
    context.gsap = {
      timeline: makeTimeline,
      set: (target, vars) => {
        gsapSets.push({ target, vars })
      },
    }
  }
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'learn-cta-gate.js' })

  // Snapshot BEFORE releasing memberReady, so tests can assert the embed did
  // not arm anything while Memberstack was still deciding.
  const beforeMemberReady = windowObj.StartersLearnCtaGate.status()

  if (releaseMemberReady) {
    releaseMemberReady()
    await new Promise((r) => setImmediate(r))
  }

  return {
    beforeMemberReady,
    /** re-evaluate the embed in the SAME context, as a duplicate script tag would */
    runSourceAgain() {
      vm.runInContext(source, context, { filename: 'learn-cta-gate.js (again)' })
      return windowObj.StartersLearnCtaGate
    },
    api: windowObj.StartersLearnCtaGate,
    window: windowObj,
    document,
    body,
    wrapperEl,
    timers,
    observers,
    captured,
    events,
    logs,
    gsapCalls,
    gsapSets,
    /** run the single armed timer */
    fireTimer() {
      const pending = timers.find((t) => !t.cleared)
      assert.ok(pending, 'no timer was armed')
      pending.fn()
    },
    fireObserver() {
      assert.equal(observers.length, 1, 'expected exactly one IntersectionObserver')
      observers[0].fire(true)
    },
    sentinel() {
      return body.querySelector('[data-learn-gate-element="sentinel"]')
    },
  }
}

// ---------------------------------------------------------------------------
// Release marker
// ---------------------------------------------------------------------------

test('header carries an @release marker matching the RELEASE constant', async () => {
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the learn-cta-gate.js header')

  const constant = source.match(/var RELEASE = '(v\d+\.\d+\.\d+)'/)
  assert.ok(constant, 'no RELEASE constant')
  assert.equal(
    constant[1],
    marker[1],
    'the @release header and the RELEASE constant must match — the deploy check greps the served file'
  )
})

test('the stylesheet carries the same @release marker', async () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8')
  const cssMarker = css.match(/@release (v\d+\.\d+\.\d+)/)
  const jsMarker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(cssMarker, 'no @release marker in learn-cta-gate.css')
  assert.equal(cssMarker[1], jsMarker[1], 'the CSS and JS ship together, so they share a tag')
})

test('the stylesheet owns the closed state of the wrapper and backdrop', async () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8')
  assert.match(css, /\[data-learn-gate-element="wrapper"\][^}]*visibility:\s*hidden/s)
  assert.match(css, /\[data-learn-gate-element="wrapper"\][^}]*pointer-events:\s*none/s)
  assert.match(css, /\[data-learn-gate-element="backdrop"\][^}]*opacity:\s*0/s)
})

test('the stylesheet never sets a transform — GSAP owns that property alone', async () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8')
  // Regression guard, caught on staging: GSAP parses the computed transform as a
  // pixel matrix, so a CSS `translateY(100%)` lands in its `y` component and the
  // tween's `yPercent: 100` stacks on top. The sheet then starts at 200% and
  // finishes a full sheet-height below its resting place — it animates offscreen
  // and the reader never sees it. Only one side may own `transform`.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(
    declarations,
    /(^|[;{\s])transform\s*:/,
    'learn-cta-gate.css must not declare `transform` — see ensureClosed() in the js'
  )
})

// ---------------------------------------------------------------------------
// The Memberstack guard — the leak that matters
// ---------------------------------------------------------------------------

test('a display:none wrapper stands down and writes no style at all', async () => {
  const h = await harness({ display: 'none' })

  assert.equal(h.api.status().skipped, 'memberstack-hidden')
  assert.equal(h.api.status().mode, null)
  assert.equal(h.timers.length, 0, 'no timer may be armed')
  assert.equal(h.observers.length, 0, 'no observer may be armed')
  assert.deepEqual(h.wrapperEl.style._props, {}, 'not one inline style may be written')
  assert.equal(
    h.wrapperEl.getAttribute('data-script-initialized'),
    null,
    'the init attribute is a style-adjacent write and must also be skipped'
  )
})

test('a member with learn-access cannot be gated even by a manual reveal', async () => {
  const h = await harness({ display: 'none' })
  h.api.reveal()
  assert.equal(h.api.status().revealed, false)
  assert.equal(h.captured.length, 0)
})

// ---------------------------------------------------------------------------
// The Memberstack RACE — the finding that made a paying member unscrollable
// ---------------------------------------------------------------------------

test('boot waits for memberReady and arms nothing while Memberstack decides', async () => {
  const h = await harness({ chars: 6000 })

  assert.equal(h.beforeMemberReady.mode, null, 'nothing may be armed before memberReady settles')
  assert.equal(h.beforeMemberReady.chars, null, 'the article must not even be measured yet')
  assert.equal(h.api.status().mode, 'scroll', 'and it must arm once memberReady settles')
})

test('a rejected memberReady still boots — a silent gate beats a trapped reader', async () => {
  const h = await harness({ chars: 6000, memberReady: 'rejected' })
  assert.equal(h.beforeMemberReady.mode, null)
  assert.equal(h.api.status().mode, 'scroll')
})

test('a page with no memberReady boots immediately', async () => {
  const h = await harness({ chars: 6000, memberReady: 'absent' })
  assert.equal(h.beforeMemberReady.mode, 'scroll', 'no promise means no reason to wait')
})

test('Memberstack hiding the gate AFTER boot cancels the reveal without locking scroll', async () => {
  const h = await harness({ chars: 6000 })
  assert.equal(h.api.status().mode, 'scroll', 'armed while the wrapper was still visible')

  // Memberstack resolves late and hides the gate for a member with learn-access.
  h.wrapperEl.computed.display = 'none'
  h.fireObserver()

  const status = h.api.status()
  assert.equal(status.revealed, false, 'the gate must not open')
  assert.equal(status.skipped, 'memberstack-hidden-late')
  assert.notEqual(
    h.document.body.style.overflow,
    'hidden',
    'THE BUG: locking here strands a paying member on a page with no gate and no unlock'
  )
  assert.equal(h.captured.length, 0, 'and nothing is reported as shown')
  assert.ok(h.observers[0].disconnected, 'the trigger is still torn down')
})

test('the late guard runs before the lock on the timer path too', async () => {
  const h = await harness({ chars: 900 })
  h.wrapperEl.computed.display = 'none'
  h.fireTimer()

  assert.equal(h.api.status().revealed, false)
  assert.notEqual(h.document.body.style.overflow, 'hidden')
})

// ---------------------------------------------------------------------------

test('a duplicate script tag cannot overwrite the live API with a dud', async () => {
  const h = await harness({ chars: 6000 })
  const first = h.api
  assert.equal(first.status().mode, 'scroll')

  const second = h.runSourceAgain()
  assert.equal(second, first, 'the window guard must stop the second IIFE entirely')
  assert.equal(second.status().mode, 'scroll', 'the live instance survives')
})

test('no wrapper on the page is a silent no-op', async () => {
  const h = await harness({ wrapper: false })
  assert.equal(h.api.status().skipped, 'no-wrapper')
  assert.equal(h.logs.warn.length, 0, 'a non-Learn page must not warn')
  assert.equal(h.timers.length, 0)
})

// ---------------------------------------------------------------------------
// Trigger selection — the two mutually exclusive modes
// ---------------------------------------------------------------------------

test('a long article arms the scroll sentinel and no timer', async () => {
  const h = await harness({ chars: 6000 })
  const status = h.api.status()

  assert.equal(status.mode, 'scroll')
  assert.equal(status.chars, 6000, 'script text must not inflate the count')
  assert.equal(status.threshold, 2500)
  assert.ok(status.hasSentinel)
  assert.equal(h.timers.length, 0, 'the scroll mode must not also arm a timer')
  assert.equal(h.observers[0].options.threshold, 0)
})

test('a short article arms the 10s timer and plants no sentinel', async () => {
  const h = await harness({ chars: 900 })
  const status = h.api.status()

  assert.equal(status.mode, 'timer')
  assert.equal(status.chars, 900)
  assert.equal(status.delaySeconds, 10)
  assert.equal(status.hasSentinel, false)
  assert.equal(h.observers.length, 0, 'the timer mode must not also arm an observer')
  assert.equal(h.timers[0].ms, 10000)
})

test('an article exactly at the threshold takes the scroll branch', async () => {
  const h = await harness({ chars: 2500 })
  assert.equal(h.api.status().mode, 'scroll')
})

test('the sentinel lands after the text node that crosses the threshold', async () => {
  const h = await harness({ chars: 6000 }) // 12 paragraphs of 500 chars
  const sentinel = h.sentinel()
  assert.ok(sentinel, 'sentinel was not planted')

  // 2500 chars is reached at the end of the 5th paragraph.
  const paras = h.body.querySelectorAll('[data-learn-gate-element="sentinel"]')
  assert.equal(paras.length, 1, 'exactly one sentinel')

  const parent = sentinel.parentNode
  assert.equal(parent.nodeName, 'P')
  const article = h.body.querySelector('.content_rte.w-richtext')
  assert.equal(article.childNodes.indexOf(parent), 4, 'expected the 5th paragraph (0-indexed 4)')

  assert.match(sentinel.style.cssText, /position:absolute/)
  assert.match(sentinel.style.cssText, /height:1px/, 'zero-area targets are unreliable for IO')
  assert.equal(sentinel.getAttribute('aria-hidden'), 'true')
})

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

test('the scroll sentinel opens the gate and locks scroll', async () => {
  const h = await harness({ chars: 6000 })
  h.fireObserver()

  const status = h.api.status()
  assert.equal(status.revealed, true)
  assert.equal(status.trigger, 'scroll')
  assert.equal(h.document.body.style.overflow, 'hidden', 'modal.js scroll-lock idiom')
  assert.ok(h.observers[0].disconnected, 'the observer must be torn down after firing')
})

test('the timer opens the gate on a short article', async () => {
  const h = await harness({ chars: 900 })
  h.fireTimer()

  assert.equal(h.api.status().trigger, 'timer')
  assert.equal(h.document.body.style.overflow, 'hidden')
})

test('the gate opens exactly once even if both triggers fire', async () => {
  const h = await harness({ chars: 6000 })
  h.fireObserver()
  h.observers[0].fire(true)
  h.api.reveal()

  assert.equal(h.captured.length, 1, 'one reveal, one analytics event')
  assert.equal(h.api.status().trigger, 'scroll', 'the first trigger wins')
  assert.equal(h.events.length, 1)
})

test('a non-intersecting observer callback does not open the gate', async () => {
  const h = await harness({ chars: 6000 })
  h.observers[0].fire(false)
  assert.equal(h.api.status().revealed, false)
})

test('the timeline fades the backdrop then slides the sheet 0.3s later', async () => {
  const h = await harness({ chars: 6000 })
  h.fireObserver()

  const fromTos = h.gsapCalls.filter((c) => c[0] === 'fromTo')
  assert.equal(fromTos.length, 2)

  // Spread across the realm boundary: objects built inside the vm context have
  // a different Object.prototype, which strict deep-equality rejects.
  const [, , backdropFrom, backdropTo] = fromTos[0]
  assert.deepEqual({ ...backdropFrom }, { opacity: 0 })
  assert.equal(backdropTo.opacity, 1)
  assert.equal(backdropTo.duration, 0.2)
  assert.equal(backdropTo.ease, 'power2.out')

  const [, , sheetFrom, sheetTo, position] = fromTos[1]
  assert.deepEqual({ ...sheetFrom }, { yPercent: 100 })
  assert.equal(sheetTo.yPercent, 0)
  assert.equal(sheetTo.duration, 0.35)
  assert.equal(sheetTo.ease, 'power2.out')
  assert.equal(position, '<0.3')
})

/**
 * PR #369 said "A test pins lag > fadeDuration so a later tidy-up cannot quietly
 * clamp one to the other and change the feel." That test never landed: the PR
 * committed 133 lines of source and no test file at all, which is also why the
 * assertions above stayed stale on a green-looking main. This is that test.
 *
 * It reads the shipped values off the timeline rather than off the module's
 * constants, so clamping the lag in either the defaults or the attribute parser
 * fails here.
 */
test('the shipped lag exceeds the shipped fade, so the dimming completes before the sheet moves', async () => {
  const h = await harness({ chars: 6000 })
  h.fireObserver()

  const fromTos = h.gsapCalls.filter((c) => c[0] === 'fromTo')
  const fadeDuration = fromTos[0][3].duration
  const position = fromTos[1][4]

  const lag = Number(String(position).replace(/^</, ''))
  assert.ok(
    Number.isFinite(lag),
    'the sheet must be positioned relative to the start of the fade, as "<lag"',
  )
  assert.ok(
    lag > fadeDuration,
    `lag (${lag}) must exceed the fade (${fadeDuration}); a lag at or below it overlaps the two`,
  )
})

test('reduced motion cross-fades and never slides', async () => {
  const h = await harness({ chars: 6000, reducedMotion: true })
  h.fireObserver()

  const fromTos = h.gsapCalls.filter((c) => c[0] === 'fromTo')
  assert.equal(fromTos.length, 1, 'one cross-fade, not a fade plus a slide')
  assert.equal(fromTos[0][3].duration, 0.2)

  const sets = h.gsapCalls.filter((c) => c[0] === 'set')
  assert.ok(
    sets.some((s) => s[2] && s[2].yPercent === 0),
    'the sheet must be pulled back into place before the cross-fade'
  )
})

test('without gsap the gate still opens, just instantly', async () => {
  const h = await harness({ chars: 900, gsap: false })
  h.fireTimer()

  assert.equal(h.api.status().revealed, true)
  assert.equal(h.wrapperEl.style.visibility, 'visible')
  assert.equal(h.wrapperEl.style.opacity, '1')
  assert.equal(h.wrapperEl.style.pointerEvents, 'auto')
  assert.equal(h.document.body.style.overflow, 'hidden')
})

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

test('learn_gate_shown carries slug, trigger, chars and threshold', async () => {
  const h = await harness({ chars: 6000 })
  h.fireObserver()

  assert.equal(h.captured.length, 1)
  assert.equal(h.captured[0].name, 'learn_gate_shown')
  assert.deepEqual({ ...h.captured[0].props }, {
    slug: 'how-to-build-trust',
    trigger: 'scroll',
    chars: 6000,
    threshold: 2500,
    release: source.match(/var RELEASE = '(v[\d.]+)'/)[1],
  })
})

test('a posthog that throws does not stop the gate opening', async () => {
  const h = await harness({ chars: 900 })
  h.window.posthog.capture = () => {
    throw new Error('boom')
  }
  h.fireTimer()
  assert.equal(h.api.status().revealed, true)
})

test('a missing posthog does not stop the gate opening', async () => {
  const h = await harness({ chars: 900 })
  delete h.window.posthog
  h.fireTimer()
  assert.equal(h.api.status().revealed, true)
})

// ---------------------------------------------------------------------------
// Authoring mistakes
// ---------------------------------------------------------------------------

test('a custom threshold and delay are read off the wrapper', async () => {
  const h = await harness({
    chars: 6000,
    attrs: { 'data-learn-gate-chars': '4000', 'data-learn-gate-delay': '3' },
  })
  assert.equal(h.api.status().threshold, 4000)
  assert.equal(h.api.status().delaySeconds, 3)
})

test('a garbage threshold falls back to the default instead of breaking', async () => {
  const h = await harness({ chars: 6000, attrs: { 'data-learn-gate-chars': 'lots' } })
  assert.equal(h.api.status().threshold, 2500)
  assert.equal(h.api.status().mode, 'scroll')
})

test('a negative delay falls back to the default', async () => {
  const h = await harness({ chars: 900, attrs: { 'data-learn-gate-delay': '-5' } })
  assert.equal(h.api.status().delaySeconds, 10)
})

test('a missing article falls back to the timer rather than never gating', async () => {
  const h = await harness({ article: false })
  assert.equal(h.api.status().skipped, 'no-article')
  assert.equal(h.api.status().mode, 'timer')
  assert.equal(h.timers.length, 1)
})

test('a missing backdrop stops the embed instead of opening a half-built gate', async () => {
  const h = await harness({ chars: 6000, backdrop: false })
  assert.equal(h.api.status().skipped, 'missing-parts')
  assert.equal(h.timers.length, 0)
  assert.equal(h.observers.length, 0)
})

test('a custom article selector is honoured', async () => {
  const h = await harness({ chars: 6000, attrs: { 'data-learn-gate-article': '.nope' } })
  assert.equal(h.api.status().skipped, 'no-article')
  assert.equal(h.api.status().mode, 'timer')
})

test('boot parks the sheet off-screen through GSAP, not through CSS', async () => {
  const h = await harness({ chars: 6000 })
  const parked = h.gsapSets.filter((s) => s.vars && s.vars.yPercent === 100)
  assert.equal(parked.length, 1, 'the sheet must be parked exactly once at init')
  assert.equal(
    parked[0].target.getAttribute('data-learn-gate-element'),
    'content',
    'the sheet is the thing that slides, not the wrapper or the backdrop'
  )
})

test('reduced motion does not park the sheet off-screen', async () => {
  const h = await harness({ chars: 6000, reducedMotion: true })
  assert.equal(
    h.gsapSets.filter((s) => s.vars && s.vars.yPercent === 100).length,
    0,
    'nothing slides under reduced motion, so nothing should be parked'
  )
})

test('boot marks the wrapper so a second load cannot double-arm it', async () => {
  const h = await harness({ chars: 6000 })
  assert.equal(h.wrapperEl.getAttribute('data-script-initialized'), 'true')
})

// ---------------------------------------------------------------------------
// Diagnostics gating
// ---------------------------------------------------------------------------

test('staging hosts are matched anchored, so lookalikes stay silent', async () => {
  const h = await harness({ chars: 900 })
  const { stagingHost } = h.api

  assert.equal(stagingHost('the-starters-3-0.webflow.io'), true)
  assert.equal(stagingHost('localhost'), true)
  assert.equal(stagingHost('127.0.0.1'), true)
  assert.equal(stagingHost('abc-def.trycloudflare.com'), true)

  assert.equal(stagingHost('www.thestarters.com'), false)
  assert.equal(stagingHost('notwebflow.io'), false)
  assert.equal(stagingHost('evil-trycloudflare.com'), false)
  assert.equal(stagingHost(''), false)
})

test('production stays silent while staging talks', async () => {
  const prod = await harness({ article: false, hostname: 'www.thestarters.com' })
  assert.equal(prod.logs.warn.length, 0)

  const staging = await harness({ article: false, hostname: 'the-starters-3-0.webflow.io' })
  assert.ok(
    staging.logs.warn.some((m) => /no article matched/.test(m)),
    'staging must surface the authoring mistake'
  )
})
