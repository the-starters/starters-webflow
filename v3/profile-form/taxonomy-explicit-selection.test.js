'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = path.join(__dirname, 'shared-foundation.js')

// Minimal DOM + jQuery surface for the tag-select controller. Only the operations
// `handleCustomSelects` actually performs are implemented.
let nextTemplateToken = 0
const templates = new Map()

class Node {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
    this.attrs = new Map()
    this.classes = new Set()
    this.children = []
    this.parent = null
    this.ownText = ''
    this.value = ''
    this.style = {}
    this.visible = true
    this.listeners = new Map()
    this.scrollTopValue = 0
  }

  get textContent() {
    return this.ownText + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value) {
    this.children = []
    this.ownText = String(value)
  }

  append(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  detach() {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  ancestors() {
    const chain = []
    for (let node = this.parent; node; node = node.parent) chain.push(node)
    return chain
  }

  closest(selector) {
    for (const node of [this, ...this.ancestors()]) {
      if (matchesSelector(node, selector)) return node
    }
    return null
  }

  contains(node) {
    return node === this || this.descendants().includes(node)
  }

  isVisible() {
    return this.visible && this.ancestors().every((node) => node.visible)
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener])
  }

  removeListeners(type) {
    this.listeners.delete(type)
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type
    const payload = typeof event === 'string'
      ? { type, preventDefault() {}, stopPropagation() {} }
      : event
    for (const listener of [...(this.listeners.get(type) || [])]) listener.call(this, payload)
    return true
  }

  clone() {
    const copy = new Node(this.tagName)
    copy.attrs = new Map(this.attrs)
    copy.classes = new Set(this.classes)
    copy.ownText = this.ownText
    for (const child of this.children) copy.append(child.clone())
    return copy
  }
}

const TOKEN = String.raw`#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]|:not\(([^)]*)\)|(:visible)|([\w-]+)`

function matchesCompound(node, selector) {
  const pattern = new RegExp(TOKEN, 'g')
  let match
  let matched = false
  while ((match = pattern.exec(selector))) {
    matched = true
    const [, id, className, attribute, doubleQuoted, singleQuoted, negated, visible, tagName] = match
    if (id !== undefined && node.attrs.get('id') !== id) return false
    if (className !== undefined && !node.classes.has(className)) return false
    if (attribute !== undefined) {
      if (!node.attrs.has(attribute)) return false
      const expected = doubleQuoted ?? singleQuoted
      if (expected !== undefined && node.attrs.get(attribute) !== expected) return false
    }
    if (negated !== undefined && matchesSelector(node, negated)) return false
    if (visible !== undefined && !node.isVisible()) return false
    if (tagName !== undefined && node.tagName !== tagName.toUpperCase()) return false
  }
  return matched
}

function matchesSelector(node, selector) {
  return String(selector)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => matchesCompound(node, part))
}

function createJQuery(root) {
  function wrap(nodes) {
    const collection = Object.create(api)
    collection.nodes = nodes
    collection.length = nodes.length
    nodes.forEach((node, index) => { collection[index] = node })
    return collection
  }

  const api = {
    each(callback) {
      this.nodes.forEach((node, index) => callback.call(node, index, node))
      return this
    },
    map(callback) {
      return wrap(this.nodes.map((node, index) => callback.call(node, index, node)))
    },
    get() { return [...this.nodes] },
    filter(predicate) {
      if (typeof predicate === 'function') {
        return wrap(this.nodes.filter((node, index) => predicate.call(node, index, node)))
      }
      return wrap(this.nodes.filter((node) => matchesSelector(node, predicate)))
    },
    eq(index) { return wrap(this.nodes[index] ? [this.nodes[index]] : []) },
    first() { return this.eq(0) },
    find(selector) {
      return wrap(this.nodes.flatMap((node) => node.descendants().filter((child) => matchesSelector(child, selector))))
    },
    closest(selector) {
      return wrap(this.nodes.map((node) => node.closest(selector)).filter(Boolean))
    },
    nextUntil() { return wrap([]) },
    attr(name, value) {
      if (value === undefined) return this.nodes[0] ? this.nodes[0].attrs.get(name) : undefined
      this.nodes.forEach((node) => node.attrs.set(name, String(value)))
      return this
    },
    prop(name) {
      if (name !== 'outerHTML') throw new Error(`unsupported prop ${name}`)
      const node = this.nodes[0]
      if (!node) return ''
      const token = `<template-${nextTemplateToken++}>`
      templates.set(token, node)
      return token
    },
    val(value) {
      if (value === undefined) return this.nodes[0] ? this.nodes[0].value : undefined
      this.nodes.forEach((node) => { node.value = String(value) })
      return this
    },
    text(value) {
      if (value === undefined) return this.nodes[0] ? this.nodes[0].textContent : ''
      this.nodes.forEach((node) => { node.textContent = value })
      return this
    },
    addClass(name) {
      this.nodes.forEach((node) => node.classes.add(name))
      return this
    },
    removeClass(name) {
      this.nodes.forEach((node) => node.classes.delete(name))
      return this
    },
    hasClass(name) { return this.nodes.some((node) => node.classes.has(name)) },
    css(property, value) {
      const declarations = typeof property === 'object' ? property : { [property]: value }
      this.nodes.forEach((node) => Object.assign(node.style, declarations))
      return this
    },
    append(child) {
      const appended = child instanceof Node ? [child] : child.nodes
      this.nodes.forEach((node) => appended.forEach((item) => node.append(item)))
      return this
    },
    empty() {
      this.nodes.forEach((node) => { node.children = [] })
      return this
    },
    remove() {
      this.nodes.forEach((node) => node.detach())
      return this
    },
    detach() { return this.remove() },
    toggle(visible) {
      this.nodes.forEach((node) => { node.visible = Boolean(visible) })
      return this
    },
    hide() { return this.toggle(false) },
    show() { return this.toggle(true) },
    is(selector) {
      return this.nodes.some((node) => (selector === ':visible' ? node.isVisible() : matchesSelector(node, selector)))
    },
    on(types, selectorOrHandler, maybeHandler) {
      const handler = typeof selectorOrHandler === 'function' ? selectorOrHandler : maybeHandler
      String(types).split(/\s+/).filter(Boolean).forEach((type) => {
        this.nodes.forEach((node) => node.addEventListener(type, handler))
      })
      return this
    },
    off(types) {
      String(types).split(/\s+/).filter(Boolean).forEach((type) => {
        this.nodes.forEach((node) => node.removeListeners(type))
      })
      return this
    },
    trigger(type) {
      this.nodes.forEach((node) => node.dispatchEvent(type))
      return this
    },
    focus() { return this.trigger('focus') },
    scrollTop(value) {
      if (value === undefined) return this.nodes[0] ? this.nodes[0].scrollTopValue : 0
      this.nodes.forEach((node) => { node.scrollTopValue = Number(value) })
      return this
    },
  }

  const $ = (target) => {
    if (target instanceof Node) return wrap([target])
    if (target && Array.isArray(target.nodes)) return target
    const selector = String(target)
    if (selector.startsWith('<')) {
      const template = templates.get(selector)
      return wrap([template ? template.clone() : new Node('div')])
    }
    return wrap(root.descendants().filter((node) => matchesSelector(node, selector)))
  }
  $.each = (items, callback) => items.forEach((item, index) => callback(index, item))
  return $
}

function node(tagName, attributes = {}, text = '') {
  const created = new Node(tagName)
  for (const [name, value] of Object.entries(attributes)) created.attrs.set(name, String(value))
  created.ownText = text
  return created
}

function createFixture({ isMulti = true, maxSelections = 3, options: optionList, initialValue = '' } = {}) {
  const root = new Node('body')
  const listInstance = node('div', { 'fs-list-instance': 'skills' })
  root.append(listInstance)

  const optionSources = optionList.map((option) => {
    const item = node('div', { 'fs-list-element': 'select-value', 'data-id': option.id }, option.name)
    listInstance.append(item)
    return item
  })

  const wrapper = node('div', { 'ms-code-select-wrapper': isMulti ? 'multi' : 'single' })
  listInstance.append(wrapper)

  const input = node('input', {
    'ms-code-select': 'input',
    'ms-code-select-max': String(maxSelections),
    'ms-code-select-min': '1',
  })
  const inputValue = node('input', { 'ms-code-select': 'input-value' })
  inputValue.value = initialValue
  const inputRequired = node('input', { 'ms-code-select': 'input-required' })
  const list = node('div', { 'ms-code-select': 'list' })
  const newTagTemplate = node('div', { 'ms-code-select': 'tag-name-new' })
  list.append(newTagTemplate)
  const selectedWrapper = node('div', { 'ms-code-select': 'selected-wrapper' })
  const tagTemplate = node('div', { 'ms-code-select': 'tag' })
  tagTemplate.append(node('span', { 'ms-code-select': 'tag-name-selected' }))
  tagTemplate.append(node('span', { 'ms-code-select': 'tag-close' }))
  selectedWrapper.append(tagTemplate)
  const emptyState = node('div', { 'ms-code-select': 'empty-state' })

  for (const child of [input, inputValue, inputRequired, list, selectedWrapper, emptyState]) {
    wrapper.append(child)
  }

  return { root, wrapper, input, inputValue, inputRequired, list, selectedWrapper, optionSources }
}

function boot(fixtureOptions = {}) {
  const fixture = createFixture(fixtureOptions)
  const timers = []
  const intervals = []
  const documentListeners = new Map()
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: {
      addEventListener(type, listener) {
        documentListeners.set(type, [...(documentListeners.get(type) || []), listener])
      },
      createElement: (tagName) => new Node(tagName),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        Object.assign(this, options)
      }
    },
    JSON,
    fetch: async () => ({ ok: true, json: async () => [] }),
    qs: () => null,
    qsa: () => [],
    setInterval: (callback) => {
      intervals.push(callback)
      return intervals.length
    },
    clearInterval() {},
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay })
      return timers.length
    },
    clearTimeout() {},
    requestAnimationFrame: (callback) => { callback() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  }
  context.window = context
  if (fixtureOptions.dirtyState) context.window.__tsProfileDirtyState = fixtureOptions.dirtyState
  context.window.matchMedia = () => ({ matches: false })
  context.$ = createJQuery(fixture.root)
  vm.createContext(context)
  new vm.Script(fs.readFileSync(SOURCE, 'utf8'), { filename: SOURCE }).runInContext(context)
  context.handleCustomSelects()

  return {
    ...fixture,
    context,
    // The controller defers its blur settle behind a 100ms timeout.
    flushTimers() {
      while (timers.length) timers.shift().callback()
    },
    flushProfileHydration() {
      context.activeProfile.last_update = 1
      while (intervals.length) intervals.shift()()
      while (timers.length) timers.shift().callback()
    },
    renderedOption(name) {
      return fixture.list.children.find((child) => child.textContent.trim() === name)
    },
    selectedTagNames() {
      return fixture.selectedWrapper.children.map((tag) => tag.textContent.trim())
    },
    keydown(key) {
      let defaultPrevented = false
      fixture.input.dispatchEvent({ key, type: 'keydown', preventDefault() { defaultPrevented = true } })
      return defaultPrevented
    },
    type(value) {
      fixture.input.value = value
      fixture.input.dispatchEvent('input')
    },
  }
}

test('late taxonomy hydration does not arm Edit Profile dirty state', () => {
  let hydrationDepth = 0
  let dirtyEvents = 0
  let hydrationCalls = 0
  const dirtyState = {
    runHydrationSync(callback) {
      hydrationCalls += 1
      hydrationDepth += 1
      try {
        return callback()
      } finally {
        hydrationDepth -= 1
      }
    },
  }
  const harness = boot({
    initialValue: 'skill-1',
    options: [{ id: 'skill-1', name: 'Figma' }],
    dirtyState,
  })
  const markDirty = () => {
    if (hydrationDepth === 0) dirtyEvents += 1
  }
  harness.inputValue.addEventListener('input', markDirty)
  harness.inputValue.addEventListener('change', markDirty)

  harness.flushProfileHydration()

  assert.equal(hydrationCalls, 1)
  assert.equal(dirtyEvents, 0)
  assert.deepEqual(harness.selectedTagNames(), ['Figma'])
})

test('hydration keeps saved taxonomy ids that no longer have a rendered option', () => {
  const harness = boot({
    initialValue: 'skill-a, skill-retired, skill-c',
    options: [{ id: 'skill-a', name: 'Figma' }, { id: 'skill-c', name: 'Sketch' }],
  })

  harness.flushProfileHydration()

  assert.deepEqual(harness.selectedTagNames(), ['Figma', 'Sketch'])
  assert.equal(harness.inputValue.value, 'skill-a, skill-c, skill-retired')
})

test('editing a taxonomy after hydration still keeps the retired saved id', () => {
  const harness = boot({
    initialValue: 'skill-a, skill-retired',
    options: [{ id: 'skill-a', name: 'Figma' }, { id: 'skill-c', name: 'Sketch' }],
  })

  harness.flushProfileHydration()
  harness.renderedOption('Sketch').dispatchEvent('click')

  assert.deepEqual(harness.selectedTagNames(), ['Figma', 'Sketch'])
  assert.equal(harness.inputValue.value, 'skill-a, skill-c, skill-retired')
})

test('a max-one Function selector hydrates only one rendered saved id', () => {
  const harness = boot({
    isMulti: false,
    maxSelections: 1,
    initialValue: 'function-a, function-b',
    options: [
      { id: 'function-a', name: 'Marketing' },
      { id: 'function-b', name: 'Design' },
    ],
  })

  harness.flushProfileHydration()

  assert.deepEqual(harness.selectedTagNames(), ['Marketing'])
  assert.equal(harness.inputValue.value, 'function-a')
  assert.equal(harness.inputRequired.value, 'function-a')
})

test('a max-one Availability selector drops unmatched saved ids', () => {
  const harness = boot({
    isMulti: false,
    maxSelections: 1,
    initialValue: 'availability-retired, availability-b',
    options: [{ id: 'availability-b', name: '20 hours per week' }],
  })

  harness.flushProfileHydration()

  assert.deepEqual(harness.selectedTagNames(), ['20 hours per week'])
  assert.equal(harness.inputValue.value, 'availability-b')
  assert.equal(harness.inputRequired.value, 'availability-b')
})

const OPTIONS = [
  { id: '1', name: 'Figma' },
  { id: '2', name: 'Sketch' },
]

test('typing an exact option name and blurring never selects a taxonomy option', () => {
  const harness = boot({ options: OPTIONS })

  harness.type('Figma')
  harness.input.dispatchEvent('blur')
  harness.flushTimers()

  assert.deepEqual(harness.selectedTagNames(), [])
  assert.equal(harness.inputValue.value, '')
  assert.equal(harness.inputRequired.value, '')
  assert.equal(harness.input.value, '')
})

test('typing an exact option name followed by a comma never selects a taxonomy option', () => {
  const harness = boot({ options: OPTIONS })

  harness.type('Figma,')

  assert.deepEqual(harness.selectedTagNames(), [])
  assert.equal(harness.inputValue.value, '')
  assert.equal(harness.inputRequired.value, '')

  harness.type('Figma, ')
  harness.type('Figma, Sketch,')

  assert.deepEqual(harness.selectedTagNames(), [])
  assert.equal(harness.inputValue.value, '')
})

test('a comma after an exact option name leaves nothing selected once the field blurs', () => {
  const harness = boot({ options: OPTIONS })

  harness.type('Figma,')
  harness.input.dispatchEvent('blur')
  harness.flushTimers()

  assert.deepEqual(harness.selectedTagNames(), [])
  assert.equal(harness.inputValue.value, '')
  assert.equal(harness.input.value, '')
})

test('a comma cannot append a second taxonomy option beside an explicit selection', () => {
  const harness = boot({ options: OPTIONS })

  harness.input.dispatchEvent('focus')
  harness.renderedOption('Figma').dispatchEvent('click')
  assert.equal(harness.inputValue.value, '1')

  harness.type('Figma, Sketch,')

  assert.deepEqual(harness.selectedTagNames(), ['Figma'])
  assert.equal(harness.inputValue.value, '1')
})

test('typing an exact option name and blurring never selects a single-select taxonomy option', () => {
  const harness = boot({ options: OPTIONS, isMulti: false })

  harness.type('Figma')
  harness.input.dispatchEvent('blur')
  harness.flushTimers()

  assert.deepEqual(harness.selectedTagNames(), [])
  assert.equal(harness.inputValue.value, '')
})

test('clicking an option selects it and blurring preserves that explicit selection', () => {
  const harness = boot({ options: OPTIONS })

  harness.input.dispatchEvent('focus')
  harness.renderedOption('Figma').dispatchEvent('click')

  assert.deepEqual(harness.selectedTagNames(), ['Figma'])
  assert.equal(harness.inputValue.value, '1')
  assert.equal(harness.inputRequired.value, '1')

  harness.input.dispatchEvent('blur')
  harness.flushTimers()

  assert.deepEqual(harness.selectedTagNames(), ['Figma'])
  assert.equal(harness.inputValue.value, '1')
  assert.equal(harness.input.value, 'Figma')
})

test('Enter selects the highlighted option after the member types a partial name', () => {
  const harness = boot({ options: OPTIONS })

  harness.input.dispatchEvent('focus')
  harness.type('Fig')
  assert.equal(harness.keydown('ArrowDown'), true)
  assert.equal(harness.keydown('Enter'), true)

  assert.deepEqual(harness.selectedTagNames(), ['Figma'])
  assert.equal(harness.inputValue.value, '1')
})

test('a typed exact name cannot resurrect a taxonomy option the member removed', () => {
  const harness = boot({ options: OPTIONS })

  harness.input.dispatchEvent('focus')
  harness.renderedOption('Figma').dispatchEvent('click')
  assert.equal(harness.inputValue.value, '1')

  harness.type('Figma')
  harness.selectedWrapper.children[0].children[1].dispatchEvent('click')
  assert.equal(harness.inputValue.value, '')

  harness.type('Figma')
  harness.input.dispatchEvent('blur')
  harness.flushTimers()

  assert.deepEqual(harness.selectedTagNames(), [])
  assert.equal(harness.inputValue.value, '')
})
