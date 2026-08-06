const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'replica-list-relayout.js'), 'utf8')

// ---------------------------------------------------------------------------
// Minimal DOM, same shape as the root-level step-flow / wf-validate harnesses
// (there is no jsdom here): attributes, a tiny selector engine for the one
// compound attribute selector the embed queries, plus the two visibility probes
// it uses (checkVisibility / getClientRects) and controllable stubs for
// IntersectionObserver, setTimeout and window.dispatchEvent.
// ---------------------------------------------------------------------------

/** @param {Element} el @param {string} sel one compound selector */
function matchesSimple(el, sel) {
  let rest = sel.trim()
  if (!rest) return false
  while (rest) {
    const m = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest)
    if (!m) throw new Error('unsupported selector: ' + sel)
    const value = el.getAttribute(m[1])
    if (value === null) return false
    const expected = m[2] !== undefined ? m[2] : m[3]
    if (expected !== undefined && value !== expected) return false
    rest = rest.slice(m[0].length)
  }
  return true
}

class Element {
  /** @param {Record<string, string>} attrs */
  constructor(attrs = {}, { visible = false } = {}) {
    this._attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]))
    this.visible = visible
    /** set true to make both visibility probes explode */
    this.probeThrows = false
    /** set false to emulate an engine without Element.checkVisibility */
    this.supportsCheckVisibility = true
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  matches(selector) {
    return matchesSimple(this, selector)
  }

  get checkVisibility() {
    if (!this.supportsCheckVisibility) return undefined
    return () => {
      if (this.probeThrows) throw new Error('probe exploded')
      return this.visible
    }
  }

  getClientRects() {
    if (this.probeThrows) throw new Error('probe exploded')
    return this.visible ? [{ width: 100, height: 100 }] : []
  }
}

/** A static replica-list block: the exact attribute pair the embed targets. */
const staticList = (options) =>
  new Element(
    {
      'wf-algolia-element': 'browse',
      'wf-algolia-disable-filters': 'true',
      'wf-algolia-index': 'top-consultants',
    },
    options,
  )

/** A filtered browse block — same element role, but NOT a static list. */
const browseList = (options) =>
  new Element({ 'wf-algolia-element': 'browse' }, options)

/**
 * Runs replica-list-relayout.js against a fake page holding `nodes`.
 *
 * @param {Element[]} nodes
 * @param {{ hostname?: string, readyState?: string, noIO?: boolean,
 *           dispatchThrows?: boolean }} [options]
 */
function mount(nodes, options = {}) {
  const documentListeners = [] // { type, handler, capture }
  const observers = []
  const timers = []
  /** @type {string[]} event types seen by window.dispatchEvent */
  const dispatched = []
  const logs = []

  const document = {
    readyState: options.readyState || 'complete',
    querySelectorAll: (selector) => nodes.filter((n) => n.matches(selector)),
    addEventListener(type, handler, capture) {
      documentListeners.push({ type, handler, capture })
    },
    removeEventListener(type, handler, capture) {
      const i = documentListeners.findIndex(
        (l) => l.type === type && l.handler === handler && l.capture === capture,
      )
      if (i !== -1) documentListeners.splice(i, 1)
    },
  }

  const window = {
    location: { hostname: options.hostname || 'example.com', search: '' },
    dispatchEvent(event) {
      if (options.dispatchThrows) throw new Error('dispatch exploded')
      dispatched.push(event.type)
      return true
    },
  }
  window.window = window

  class IntersectionObserver {
    constructor(callback, init) {
      this.callback = callback
      this.init = init
      this.observed = []
      this.disconnected = false
      observers.push(this)
    }
    observe(el) {
      this.observed.push(el)
    }
    unobserve(el) {
      const i = this.observed.indexOf(el)
      if (i !== -1) this.observed.splice(i, 1)
    }
    disconnect() {
      this.disconnected = true
      this.observed = []
    }
    /** test helper: deliver entries as the browser would */
    fire(entries) {
      this.callback(entries)
    }
  }

  const context = vm.createContext({
    window,
    document,
    IntersectionObserver: options.noIO ? undefined : IntersectionObserver,
    CustomEvent: class {
      constructor(type) {
        this.type = type
      }
    },
    setTimeout: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => {},
    console: {
      info: (...args) => logs.push(args.map(String).join(' ')),
      warn: (...args) => logs.push(args.map(String).join(' ')),
      log: (...args) => logs.push(args.map(String).join(' ')),
      error: (...args) => logs.push(args.map(String).join(' ')),
    },
  })

  const run = () => vm.runInContext(source, context)
  run()

  /** Drain every queued setTimeout callback (the click belt's next-task hop). */
  const flush = () => {
    while (timers.length) timers.shift()()
  }

  /** Fire a document click through the embed's capture-phase listener. */
  const click = () => {
    documentListeners
      .filter((l) => l.type === 'click')
      .forEach((l) => l.handler({ type: 'click' }))
    flush()
  }

  /** Deliver an IO callback for `el` as intersecting. */
  const intersect = (el, isIntersecting = true) => {
    observers.forEach((o) => {
      if (o.disconnected) return
      if (!o.observed.includes(el)) return
      o.fire([{ target: el, isIntersecting }])
    })
  }

  const domReady = () =>
    documentListeners
      .filter((l) => l.type === 'DOMContentLoaded')
      .forEach((l) => l.handler({ type: 'DOMContentLoaded' }))

  return {
    window,
    document,
    documentListeners,
    observers,
    dispatched,
    logs,
    timers,
    run,
    flush,
    click,
    intersect,
    domReady,
    clickListeners: () => documentListeners.filter((l) => l.type === 'click'),
  }
}

const RELAYOUT = 'expert-cards:relayout'

// ---------------------------------------------------------------------------
// 1. Init guard
// ---------------------------------------------------------------------------

test('the init guard is set once and a second load binds nothing', () => {
  const block = staticList()
  const h = mount([block])

  assert.equal(h.window.__replicaListRelayoutInit, true)
  assert.equal(h.observers.length, 1)
  assert.equal(h.clickListeners().length, 1)

  h.run() // the page embeds the file twice

  assert.equal(h.observers.length, 1, 'no second observer')
  assert.equal(h.clickListeners().length, 1, 'no second click listener')
})

test('a second load cannot cause a double dispatch', () => {
  const block = staticList()
  const h = mount([block])
  h.run()

  block.visible = true
  h.click()

  assert.deepEqual(h.dispatched, [RELAYOUT])
})

// ---------------------------------------------------------------------------
// 2. Nothing to do
// ---------------------------------------------------------------------------

test('no static lists: no observer, no listener, no crash', () => {
  const h = mount([browseList({ visible: true }), new Element({ 'data-loader': '1000' })])

  assert.equal(h.observers.length, 0)
  assert.equal(h.clickListeners().length, 0)
  assert.deepEqual(h.dispatched, [])
})

test('a filtered browse block is never targeted', () => {
  const browse = browseList()
  const h = mount([browse])

  browse.visible = true
  assert.equal(h.clickListeners().length, 0, 'nothing bound, so nothing to fire')
  assert.deepEqual(h.dispatched, [])
})

test('an already-visible static list at init: marked done, never dispatched', () => {
  const block = staticList({ visible: true })
  const h = mount([block])

  assert.deepEqual(h.dispatched, [], 'expert-card.js own passes cover visible content')
  assert.equal(h.observers.length, 0, 'nothing left to watch')
  assert.equal(h.clickListeners().length, 0)
})

test('mixed page: only the hidden list is watched', () => {
  const shown = staticList({ visible: true })
  const hidden = staticList()
  const h = mount([shown, hidden])

  assert.equal(h.observers.length, 1)
  assert.deepEqual(h.observers[0].observed, [hidden])
})

// ---------------------------------------------------------------------------
// 3. IntersectionObserver path
// ---------------------------------------------------------------------------

test('IO path: one dispatch per block, never a second', () => {
  const block = staticList()
  const h = mount([block])

  block.visible = true
  h.intersect(block)
  assert.deepEqual(h.dispatched, [RELAYOUT])

  h.intersect(block) // observer already unobserved it; belt and braces
  h.click()
  assert.deepEqual(h.dispatched, [RELAYOUT], 'still exactly one')
})

test('IO path: a non-intersecting entry dispatches nothing', () => {
  const block = staticList()
  const h = mount([block])

  h.intersect(block, false)

  assert.deepEqual(h.dispatched, [])
  assert.equal(h.observers[0].disconnected, false, 'still watching')
})

test('IO is created with threshold 0', () => {
  const h = mount([staticList()])
  // the init object is created inside the vm realm, so compare the field
  assert.equal(h.observers[0].init.threshold, 0)
})

test('two hidden lists dispatch once each, independently', () => {
  const a = staticList()
  const b = staticList()
  const h = mount([a, b])

  h.intersect(a)
  assert.deepEqual(h.dispatched, [RELAYOUT])
  assert.equal(h.observers[0].disconnected, false, 'b is still pending')

  h.intersect(b)
  assert.deepEqual(h.dispatched, [RELAYOUT, RELAYOUT])
  assert.equal(h.observers[0].disconnected, true, 'all done')
})

// ---------------------------------------------------------------------------
// 4. Click belt (the path a hidden/occluded document can still deliver)
// ---------------------------------------------------------------------------

test('click belt dispatches when the IO callback never fires', () => {
  const block = staticList()
  const h = mount([block])

  block.visible = true // a Webflow interaction opened the modal
  h.click()

  assert.deepEqual(h.dispatched, [RELAYOUT])
})

test('click belt works with no IntersectionObserver at all', () => {
  const block = staticList()
  const h = mount([block], { noIO: true })

  assert.equal(h.observers.length, 0)
  assert.equal(h.clickListeners().length, 1, 'the belt is still bound')

  block.visible = true
  h.click()

  assert.deepEqual(h.dispatched, [RELAYOUT])
})

test('click belt is capture-phase', () => {
  const h = mount([staticList()])
  assert.equal(h.clickListeners()[0].capture, true)
})

test('a click while the list is still hidden dispatches nothing', () => {
  const block = staticList()
  const h = mount([block])

  h.click()
  h.click()

  assert.deepEqual(h.dispatched, [])
  assert.equal(h.clickListeners().length, 1, 'still armed')
})

test('the click belt runs on the next task, not synchronously', () => {
  const block = staticList()
  const h = mount([block])
  block.visible = true

  h.documentListeners
    .filter((l) => l.type === 'click')
    .forEach((l) => l.handler({ type: 'click' }))

  assert.deepEqual(h.dispatched, [], 'the interaction display write lands first')
  h.flush()
  assert.deepEqual(h.dispatched, [RELAYOUT])
})

test('re-opening the modal does not re-dispatch', () => {
  const block = staticList()
  const h = mount([block])

  block.visible = true
  h.click()
  block.visible = false // closed
  block.visible = true // re-opened
  h.click()
  h.intersect(block)

  assert.deepEqual(h.dispatched, [RELAYOUT])
})

// ---------------------------------------------------------------------------
// 5. Cleanup
// ---------------------------------------------------------------------------

test('observer and click listener are dropped once every block has fired', () => {
  const block = staticList()
  const h = mount([block])

  block.visible = true
  h.click()

  assert.equal(h.observers[0].disconnected, true)
  assert.equal(h.clickListeners().length, 0)
  assert.equal(h.documentListeners.length, 0, 'no listener left on the document')
})

test('the settled block is unobserved before the observer is torn down', () => {
  const a = staticList()
  const b = staticList()
  const h = mount([a, b])

  h.intersect(a)

  assert.deepEqual(h.observers[0].observed, [b])
})

// ---------------------------------------------------------------------------
// 6. Defensive wrapper
// ---------------------------------------------------------------------------

test('a throwing dispatchEvent never propagates, and the block still settles', () => {
  const block = staticList()
  const h = mount([block], { dispatchThrows: true })

  block.visible = true
  assert.doesNotThrow(() => h.click())
  assert.equal(h.clickListeners().length, 0, 'the block was still marked done')
})

test('a throwing visibility probe keeps the block pending instead of crashing', () => {
  const block = staticList()
  block.probeThrows = true
  const h = mount([block])

  assert.equal(h.observers.length, 1, 'treated as hidden, so still watched')
  assert.doesNotThrow(() => h.click())
  assert.deepEqual(h.dispatched, [])
})

test('a page without checkVisibility falls back to getClientRects', () => {
  const block = staticList()
  block.supportsCheckVisibility = false
  const h = mount([block])

  block.visible = true
  h.click()

  assert.deepEqual(h.dispatched, [RELAYOUT])
})

test('an IO entry with no target never throws', () => {
  const h = mount([staticList()])
  assert.doesNotThrow(() => h.observers[0].fire([null, undefined]))
  assert.deepEqual(h.dispatched, [])
})

// ---------------------------------------------------------------------------
// 7. Diagnostics gating + head-embed guard
// ---------------------------------------------------------------------------

test('production is silent', () => {
  const block = staticList()
  const h = mount([block], { hostname: 'www.thestarters.com' })

  block.visible = true
  h.click()

  assert.deepEqual(h.logs, [])
  assert.deepEqual(h.dispatched, [RELAYOUT], 'silence does not mean inert')
})

test('staging logs the scan and each dispatch', () => {
  const block = staticList()
  const h = mount([block], { hostname: 'the-starters-3-0.webflow.io' })

  block.visible = true
  h.click()

  assert.equal(h.logs.length, 2)
  assert.match(h.logs[0], /1 static replica list\(s\) found; 1 hidden/)
  assert.match(h.logs[1], /dispatched expert-cards:relayout/)
})

test('a page with no static lists says so on staging only', () => {
  assert.equal(mount([], { hostname: 'localhost' }).logs.length, 1)
  assert.equal(mount([], { hostname: 'www.thestarters.com' }).logs.length, 0)
})

test('a head embed waits for DOMContentLoaded before scanning', () => {
  const block = staticList()
  const h = mount([block], { readyState: 'loading' })

  assert.equal(h.observers.length, 0, 'nothing scanned yet')
  h.domReady()
  assert.equal(h.observers.length, 1)

  block.visible = true
  h.click()
  assert.deepEqual(h.dispatched, [RELAYOUT])
})
