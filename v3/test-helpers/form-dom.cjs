// Minimal DOM reused from the global validator behavior harness.
const assert = require('node:assert/strict')
function matchesSimple(el, sel) {
  let rest = sel.trim()
  while (rest) {
    let m
    if ((m = /^:not\(([^)]*)\)/.exec(rest))) {
      if (matchesSimple(el, m[1])) return false
    } else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) {
      const value = el.getAttribute(m[1])
      if (value === null) return false
      if (m[2] !== undefined && value !== m[2]) return false
    } else if ((m = /^\.([\w-]+)/.exec(rest))) {
      if (!el.classList.contains(m[1])) return false
    } else if ((m = /^#([\w-]+)/.exec(rest))) {
      if (el.getAttribute('id') !== m[1]) return false
    } else if ((m = /^([a-zA-Z][\w-]*)/.exec(rest))) {
      if (el.tagName !== m[1].toUpperCase()) return false
    } else {
      throw new Error('unsupported selector: ' + sel)
    }
    rest = rest.slice(m[0].length)
  }
  return true
}

const matches = (el, selector) => selector.replace(/'([^']*)'/g, '"$1"').split(',').some((part) => matchesSimple(el, part))

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = String(tag).toUpperCase()
    this._attrs = new Map()
    this.children = []
    this.parentElement = null
    this.style = {}
    this._text = ''
    this.id = ''
    this.dataset = {}
    this.value = ''
    this.noValidate = false
    this.rendered = true
    this.willValidate = /^(INPUT|SELECT|TEXTAREA)$/.test(this.tagName)
    this._custom = ''
    this._listeners = new Map()
    this.focusCalls = []
    this.scrollCalls = []
    this.selectionStart = undefined
    this.selectionEnd = undefined

    const classes = new Set()
    this._classes = classes
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !classes.has(c) : !!on
        if (next) classes.add(c)
        else classes.delete(c)
        return next
      },
    }

    Object.keys(attrs).forEach((key) => this.setAttribute(key, attrs[key]))
    String(attrs.class || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => classes.add(c))
    children.forEach((child) => this.append(child))
  }

  get textContent() {
    return this._text
  }
  set textContent(value) {
    this._text = String(value)
    this.children.forEach((child) => (child.parentElement = null))
    this.children = []
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
  get name() { return this.getAttribute('name') || '' }
  set name(value) { this.setAttribute('name', value) }
  get required() { return this.hasAttribute('required') }
  set required(value) { if (value) this.setAttribute('required', ''); else this.removeAttribute('required') }
  removeAttribute(name) {
    this._attrs.delete(name)
  }
  cloneNode(deep = false) {
    const clone = new Element(this.tagName, Object.fromEntries(this._attrs), deep ? this.children.map(child => child.cloneNode(true)) : [])
    clone.value = this.value
    clone._text = this._text
    clone.style = { ...this.style }
    clone.disabled = this.disabled
    clone.checked = this.checked
    clone.dataset = { ...this.dataset }
    return clone
  }
  matches(selector) { return matches(this, selector) }
  contains(other) { return other === this || this.descendants().includes(other) }

  append(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }
  appendChild(child) {
    return this.append(child)
  }
  insertBefore(child, ref) {
    child.parentElement = this
    const at = ref ? this.children.indexOf(ref) : -1
    if (at === -1) this.children.push(child)
    else this.children.splice(at, 0, child)
    return child
  }
  get firstChild() {
    return this.children[0] || null
  }
  remove() {
    const parent = this.parentElement
    if (!parent) return
    parent.children.splice(parent.children.indexOf(this), 1)
    this.parentElement = null
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
  closest(selector) {
    let node = this
    while (node) {
      if (matches(node, selector)) return node
      node = node.parentElement
    }
    return null
  }
  insertAdjacentElement(position, el) {
    assert.equal(position, 'afterend')
    const parent = this.parentElement
    parent.children.splice(parent.children.indexOf(this) + 1, 0, el)
    el.parentElement = parent
    return el
  }

  getClientRects() {
    return this.rendered ? [{}] : []
  }
  setCustomValidity(message) {
    this._custom = message || ''
  }
  get validity() {
    const valueMissing = this.hasAttribute('required') && !this.value
    const type = this.getAttribute('type')
    const typeMismatch =
      type === 'email' && !!this.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)
    const customError = !!this._custom
    return {
      valueMissing,
      typeMismatch,
      badInput: false,
      patternMismatch: false,
      tooShort: false,
      tooLong: false,
      rangeUnderflow: false,
      rangeOverflow: false,
      stepMismatch: false,
      customError,
      valid: !valueMissing && !typeMismatch && !customError,
    }
  }
  get validationMessage() {
    if (this._custom) return this._custom
    const v = this.validity
    if (v.valueMissing) return 'Please fill out this field.'
    if (v.typeMismatch) return 'Please enter an email address.'
    return ''
  }

  focus(options) {
    this.focusCalls.push(options)
  }
  scrollIntoView(options) {
    this.scrollCalls.push(options)
  }
  setSelectionRange(start, end) {
    this.selectionStart = start
    this.selectionEnd = end
  }

  dispatchEvent(event) {
    event.target = this
    let node = this
    do {
      for (const listener of node._listeners.get(event.type) || []) listener(event)
      node = event.bubbles && !event.stopped ? node.parentElement : null
    } while (node)
    return !event.defaultPrevented
  }

  addEventListener(type, listener) {
    const list = this._listeners.get(type) || []
    list.push(listener)
    this._listeners.set(type, list)
  }
  removeEventListener(type, listener) {
    this._listeners.set(type, (this._listeners.get(type) || []).filter(item => item !== listener))
  }
}

/** @returns {Element} */
const h = (tag, attrs, children) => new Element(tag, attrs || {}, children || [])

/**
 * @param {string} type
 * @param {Element} target
 * @param {object} [extra] extra event properties (e.g. ToggleEvent's newState)
 */
function makeEvent(type, target, extra) {
  return Object.assign({
    type,
    target,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopImmediatePropagation() {
      this.stopped = true
    },
  }, extra || {})
}


module.exports = { Element, h, makeEvent }
