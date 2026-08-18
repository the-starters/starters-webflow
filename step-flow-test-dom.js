const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  path.join(__dirname, 'global-embeds', 'step-flow', 'step-flow.js'),
  'utf8',
)

// ---------------------------------------------------------------------------
// Minimal DOM, same shape as wf-validate.test.js: attributes, dataset, classes,
// style.display, a tiny selector engine (tag / [attr] / [attr="v"] / [attr='v'] /
// .class / compounds / comma groups — the exact shapes step-flow.js queries), plus
// the geometry the scroll routine measures (rects, scrollTop/Height, offsetHeight)
// and scrollTo spies on both the window and any scrollable ancestor.
// ---------------------------------------------------------------------------

/**
 * @param {Element} el
 * @param {string} sel one compound selector (no combinators)
 * @returns {boolean}
 */
function matchesSimple(el, sel) {
  let rest = sel.trim()
  if (!rest) return false
  while (rest) {
    let m
    if ((m = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest))) {
      const value = el.getAttribute(m[1])
      if (value === null) return false
      const expected = m[2] !== undefined ? m[2] : m[3]
      if (expected !== undefined && value !== expected) return false
    } else if ((m = /^\.([\w-]+)/.exec(rest))) {
      if (!el.classList.contains(m[1])) return false
    } else if ((m = /^([a-zA-Z][\w-]*)/.exec(rest))) {
      if (el.tagName !== m[1].toUpperCase()) return false
    } else {
      throw new Error('unsupported selector: ' + sel)
    }
    rest = rest.slice(m[0].length)
  }
  return true
}

const matches = (el, selector) => selector.split(',').some((part) => matchesSimple(el, part))

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = String(tag).toUpperCase()
    this._attrs = new Map()
    this.children = []
    this.parentElement = null
    this.style = {}
    this.textContent = ''
    this.dataset = {}
    this._listeners = new Map()

    // geometry the scroll routine reads
    this.rect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }
    this.computed = {}
    this.scrollTop = 0
    this.scrollHeight = 0
    this.clientHeight = 0
    this.offsetHeight = 0
    this.scrollToCalls = []

    const classes = new Set()
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    }

    Object.keys(attrs).forEach((key) => this.setAttribute(key, attrs[key]))
    String(attrs.class || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => classes.add(c))
    children.forEach((child) => this.append(child))
  }

  /** `button.type` is read directly (terminal-submit detection), not via getAttribute. */
  get type() {
    return this.getAttribute('type')
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value))
  }
  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }
  hasAttribute(name) {
    return this._attrs.has(name)
  }
  removeAttribute(name) {
    this._attrs.delete(name)
  }

  append(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  descendants() {
    const out = []
    const walk = (node) =>
      node.children.forEach((child) => {
        out.push(child)
        walk(child)
      })
    walk(this)
    return out
  }

  querySelectorAll(selector) {
    return this.descendants().filter((el) => matches(el, selector))
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  matches(selector) {
    return matches(this, selector)
  }
  closest(selector) {
    let node = this
    while (node) {
      if (matches(node, selector)) return node
      node = node.parentElement
    }
    return null
  }
  contains(other) {
    let node = other
    while (node) {
      if (node === this) return true
      node = node.parentElement
    }
    return false
  }

  getBoundingClientRect() {
    return this.rect
  }
  scrollTo(options) {
    this.scrollToCalls.push(options)
  }

  addEventListener(type, listener) {
    const list = this._listeners.get(type) || []
    list.push(listener)
    this._listeners.set(type, list)
  }
}

/** @returns {Element} */
const h = (tag, attrs, children) => new Element(tag, attrs || {}, children || [])

/**
 * @param {string} type
 * @param {Element} target
 */
function makeEvent(type, target) {
  return {
    type,
    target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

/**
 * Runs step-flow.js against a fake document whose body is `root`, then fires
 * DOMContentLoaded so the engine initializes.
 *
 * @param {Element} root
 * @param {{ reducedMotion?: boolean, pageYOffset?: number, noMatchMedia?: boolean }} [options]
 */
function mount(root, options = {}) {
  const documentListeners = new Map()
  const document = {
    documentElement: { scrollTop: 0 },
    addEventListener(type, listener) {
      const list = documentListeners.get(type) || []
      list.push(listener)
      documentListeners.set(type, list)
    },
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    querySelector: (selector) => root.querySelector(selector),
  }
  const window = {
    pageYOffset: options.pageYOffset || 0,
    scrollToCalls: [],
    scrollTo(opts) {
      this.scrollToCalls.push(opts)
    },
    lumos: undefined,
  }
  const windowListeners = new Map()
  window.addEventListener = (type, listener) => {
    const list = windowListeners.get(type) || []
    list.push(listener)
    windowListeners.set(type, list)
  }
  window.dispatchEvent = (event) => {
    for (const listener of windowListeners.get(event.type) || []) listener(event)
    return true
  }
  if (!options.noMatchMedia) {
    window.matchMedia = (query) => ({
      matches: !!options.reducedMotion && /reduced-motion/.test(query),
    })
  }
  window.window = window

  const getComputedStyle = (el) =>
    Object.assign({ display: 'block', overflowY: 'visible', position: 'static' }, el.computed)

  /** @type {string[]} `console.warn` calls, so tests can assert on flow diagnostics. */
  const warnings = []

  const context = vm.createContext({
    Element,
    console: {
      warn: (...args) => warnings.push(args.map((arg) => String(arg)).join(' ')),
      log: () => {},
      error: () => {},
    },
    document,
    getComputedStyle,
    window,
    CSS: { escape: (value) => String(value) },
    HTMLElement: Element,
    HTMLInputElement: Element,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type
        this.detail = init.detail
      }
    },
    MutationObserver: class {
      observe() {}
    },
  })
  vm.runInContext(source, context)

  const domReady = documentListeners.get('DOMContentLoaded') || []
  assert.equal(domReady.length, 1, 'step-flow.js binds exactly one DOMContentLoaded listener')
  domReady.forEach((listener) => listener(makeEvent('DOMContentLoaded', null)))

  /** fire a listener bound on `el` itself (the flow root's click handler) */
  const fire = (el, type, target) => {
    const event = makeEvent(type, target || el)
    ;(el._listeners.get(type) || []).forEach((listener) => listener(event))
    return event
  }

  return { window, document, fire, warnings }
}

module.exports = { Element, h, matches, makeEvent, mount, source }
