'use strict'

// Jai 2026-11-06: a Brand can select every category on Create and Edit
// Opportunity. The shared multiselect must not cap selection or prefill.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { Element: BaseElement } = require('./step-flow-test-dom.js')

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
      return false
    }
    rest = rest.slice(m[0].length)
  }
  return true
}

function matchesSelector(el, selector) {
  const parts = selector.trim().split(/\s+/)
  if (!matchesSimple(el, parts[parts.length - 1])) return false
  let node = el.parentElement
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (node && !matchesSimple(node, parts[index])) node = node.parentElement
    if (!node) return false
    node = node.parentElement
  }
  return true
}

class Element extends BaseElement {
  get value() {
    return this._value || ''
  }
  set value(value) {
    this._value = String(value)
  }
  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  querySelectorAll(selector) {
    return selector
      .split(',')
      .flatMap((part) => this.descendants().filter((el) => matchesSelector(el, part)))
      .filter((el, index, all) => all.indexOf(el) === index)
  }
  matches(selector) {
    return selector.split(',').some((part) => matchesSelector(this, part))
  }
  closest(selector) {
    let node = this
    while (node) {
      if (node.matches && node.matches(selector)) return node
      node = node.parentElement
    }
    return null
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child)
    child.parentElement = this
    this.children.push(child)
    return child
  }
  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1)
    child.parentElement = null
    return child
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this)
  }
  replaceChildren(...nodes) {
    this.children.slice().forEach((child) => this.removeChild(child))
    nodes.forEach((node) => this.appendChild(node))
  }
  insertAdjacentElement(_where, el) {
    const parent = this.parentElement
    parent.children.splice(parent.children.indexOf(this) + 1, 0, el)
    el.parentElement = parent
    return el
  }
  cloneNode(deep) {
    const attrs = {}
    this._attrs.forEach((value, key) => {
      attrs[key] = value
    })
    const copy = new Element(this.tagName.toLowerCase(), attrs)
    copy.textContent = this.textContent
    if (deep) this.children.forEach((child) => copy.appendChild(child.cloneNode(true)))
    return copy
  }
  dispatchEvent(event) {
    ;(this._listeners.get(event.type) || []).forEach((listener) =>
      listener({ preventDefault() {}, stopPropagation() {}, ...event, target: this }),
    )
    return true
  }
  click() {
    this.dispatchEvent({ type: 'click' })
  }
  focus() {}
  blur() {}
  setCustomValidity(message) {
    this.validationMessage = message
  }
}

const h = (tag, attrs = {}, children = []) => {
  const el = new Element(tag, attrs)
  children.forEach((child) => el.appendChild(child))
  return el
}

const CATEGORIES = [
  'Brand Strategy',
  'Content Creation',
  'Design',
  'Influencers',
  'Marketing',
  'Paid Media',
  'Social Media',
]

function categoryForm() {
  const input = h('input', { name: 'Category-option' })
  const list = h('div', { 'ms-code-select': 'list' }, [h('div', { 'ms-code-select': 'tag-name-new' })])
  const selectedWrapper = h('div', { 'ms-code-select': 'selected-wrapper' }, [
    h('div', { 'ms-code-select': 'tag' }, [
      h('div', { 'ms-code-select': 'tag-name-selected' }),
      h('div', { 'ms-code-select': 'tag-close' }),
    ]),
  ])
  const wrapper = h('div', { 'ms-code-select-wrapper': '' }, [input, list, selectedWrapper])
  const options = CATEGORIES.map((name) => {
    const el = h('div', { class: 'category-option' })
    el.textContent = name
    return el
  })
  const form = h('form', {}, [wrapper, h('div', {}, options)])
  return { form, input, list }
}

function loadOpp30() {
  const document = h('html')
  document.readyState = 'loading'
  document.documentElement = document
  document.head = document
  document.body = document
  document.createElement = (tag) => h(tag)
  document.getElementById = () => null
  document.removeEventListener = () => {}
  const location = {
    href: 'https://example.test/opportunities/123',
    hostname: 'example.test',
    pathname: '/opportunities/123',
    search: '',
  }
  const window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  window.window = window
  window.location = location
  class Event {
    constructor(type, options) {
      this.type = type
      this.bubbles = options?.bubbles
    }
  }
  class CustomEvent extends Event {
    constructor(type, options) {
      super(type, options)
      this.detail = options?.detail
    }
  }
  window.CustomEvent = CustomEvent
  const context = vm.createContext({
    Array,
    CustomEvent,
    Date,
    Event,
    FormData,
    Headers,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Request,
    URL,
    URLSearchParams,
    alert() {},
    clearInterval,
    clearTimeout,
    console: { error() {}, info() {}, log() {}, warn() {} },
    document,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    history: { replaceState() {} },
    location,
    setInterval,
    setTimeout,
    window,
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'opportunities-3.0.js'), 'utf8'), context)
  return window.Opp30
}

const stored = (input) => JSON.parse(input.getAttribute('data-opp30-selected-values') || '[]')

test('a Brand can click every category option with no limit warning', () => {
  const Opp30 = loadOpp30()
  const { form, input, list } = categoryForm()
  Opp30.initOpportunityCategorySelects(form)

  const options = list.querySelectorAll('[data-opp30-category-value]')
  assert.equal(options.length, CATEGORIES.length)
  options.forEach((option) => option.click())

  assert.deepEqual(stored(input), CATEGORIES)
  assert.equal(input.validationMessage, '')
  assert.equal(form.querySelector('#ms-limit-error'), null)
  options.forEach((option) => {
    assert.notEqual(option.style.cursor, 'not-allowed')
    assert.notEqual(option.style.opacity, '0.4')
  })
})

test('Edit prefill keeps every saved category instead of the first three', () => {
  const Opp30 = loadOpp30()
  const { form, input } = categoryForm()
  Opp30.initOpportunityCategorySelects(form)

  input.dispatchEvent({
    type: 'opp30:set-category-values',
    detail: { values: [' design ', 'MARKETING', 'Influencers', 'Paid Media', 'Social Media', 'Design'] },
  })

  assert.deepEqual(stored(input), ['Design', 'Marketing', 'Influencers', 'Paid Media', 'Social Media'])
})
