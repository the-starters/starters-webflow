'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = path.join(__dirname, 'incremental-dropdowns.js')

function element(overrides = {}) {
  const listeners = new Map()
  const node = {
    dataset: {},
    style: {},
    name: '',
    id: '',
    value: '',
    type: 'text',
    checked: false,
    scrollHeight: 0,
    childElementCount: 0,
    textContent: '',
    firstElementChild: null,
    parentNode: null,
    dispatched: [],
    classList: { add() {}, remove() {}, contains() { return false } },
    selectorMap: {},
    selectorAllMap: {},
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener])
    },
    dispatchEvent(event) {
      node.dispatched.push(event.type)
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null },
    getBoundingClientRect() { return { height: 0, bottom: 0 } },
    closest() { return null },
    remove() {},
    cloneNode() { return element(overrides) },
    querySelector(selector) { return node.selectorMap[selector] ?? null },
    querySelectorAll(selector) { return node.selectorAllMap[selector] || [] },
  }
  return Object.assign(node, overrides)
}

function boot({ captureValue = '{}', requiredTitle = true } = {}) {
  const step = element()
  step.dataset.index = '6'

  const titleField = element()
  titleField.dataset.name = 'service-title'
  if (requiredTitle) titleField.dataset.required = 'true'

  const descriptionField = element()
  descriptionField.dataset.name = 'service-description'

  const captureField = element({ value: captureValue })
  captureField.dataset.inputCapture = ''

  const toggle = element()
  const content = element()
  const icon = element()

  const dropdown = element()
  dropdown.dataset.entity = 'Service'
  dropdown.selectorMap = {
    '[increment-dropdown-toggle]': toggle,
    '[increment-dropdown-content]': content,
    '[increment-dropdown-icon]': icon,
    '[increment-dropdown-remove]': null,
    '[data-input-capture]': captureField,
  }
  dropdown.selectorAllMap = {
    'input, textarea, select': [titleField, descriptionField, captureField],
    'input, textarea': [titleField, descriptionField],
    '*': [],
  }

  const addButton = element()
  addButton.parentNode = element()

  const wrapper = element()
  wrapper.selectorMap = {
    '.dropdowns-button .button': addButton,
    '[increment-dropdown]': dropdown,
    '[increment-dropdown="1"]': dropdown,
  }
  wrapper.selectorAllMap = { '[increment-dropdown]': [dropdown] }
  wrapper.closest = (selector) => (selector === "[data-form='step']" ? step : null)

  const domReady = []
  const context = {
    JSON,
    Math,
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        Object.assign(this, options)
      }
    },
    MEMBER: { id: 'member-1' },
    activeProfile: { data: {} },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: {
      addEventListener(type, listener) {
        if (type === 'DOMContentLoaded') domReady.push(listener)
      },
    },
    formatRateInputs() {},
    isValidEmail() { return true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    qs(selector, root) {
      return root && typeof root.querySelector === 'function' ? root.querySelector(selector) : null
    },
    qsa(selector, root) {
      if (!root) return selector === '[increment-dropdowns]' ? [wrapper] : []
      return root.querySelectorAll(selector)
    },
    setTimeout: () => 1,
    clearTimeout() {},
    waitForMember: (callback) => callback(),
    waitProfileData: (callback) => callback(),
  }
  context.window = context
  vm.createContext(context)
  new vm.Script(fs.readFileSync(SOURCE, 'utf8'), { filename: SOURCE }).runInContext(context)
  for (const listener of domReady) listener()

  return {
    addButton,
    captureField,
    descriptionField,
    titleField,
    capturedData() { return JSON.parse(captureField.value || '{}') },
    fire(field, type) {
      captureField.dispatched.length = 0
      field.dispatchEvent(new context.Event(type, { bubbles: true }))
    },
  }
}

test('a Custom Service field syncs its value into the hidden capture JSON while the member types', () => {
  const harness = boot()

  harness.titleField.value = 'Design audit'
  harness.fire(harness.titleField, 'input')

  assert.deepEqual(harness.capturedData(), { title: 'Design audit' })
  assert.deepEqual(harness.captureField.dispatched, ['change'])
})

test('clearing a Custom Service field syncs the empty value instead of leaving stale JSON', () => {
  const harness = boot({ captureValue: JSON.stringify({ title: 'Design audit' }) })

  harness.titleField.value = ''
  harness.fire(harness.titleField, 'input')

  assert.deepEqual(harness.capturedData(), { title: '' })
  assert.deepEqual(harness.captureField.dispatched, ['change'])
})

test('a Custom Service change event syncs the hidden capture JSON, including an empty value', () => {
  const harness = boot({ captureValue: JSON.stringify({ description: 'Weekly review' }) })

  harness.descriptionField.value = ''
  harness.fire(harness.descriptionField, 'change')

  assert.deepEqual(harness.capturedData(), { description: '' })
  assert.deepEqual(harness.captureField.dispatched, ['change'])
})

test('a Custom Service blur still syncs the hidden capture JSON', () => {
  const harness = boot()

  harness.descriptionField.value = 'Weekly review'
  harness.fire(harness.descriptionField, 'blur')

  assert.deepEqual(harness.capturedData(), { description: 'Weekly review' })
  assert.deepEqual(harness.captureField.dispatched, ['change'])
})

test('the add-service button tracks the required field as the member types and clears it', () => {
  const harness = boot()

  harness.titleField.value = 'Design audit'
  harness.fire(harness.titleField, 'input')
  assert.equal(harness.addButton.style.pointerEvents, '')
  assert.equal(harness.addButton.style.opacity, '')

  harness.titleField.value = ''
  harness.fire(harness.titleField, 'input')
  assert.equal(harness.addButton.style.pointerEvents, 'none')
  assert.equal(harness.addButton.style.opacity, '0.5')
})
