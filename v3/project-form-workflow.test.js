'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const { h, mount } = require('../step-flow-test-dom')

const projectSource = fs.readFileSync(require.resolve('./project-form.js'), 'utf8')
const previewSource = fs.readFileSync(
  require.resolve('../global-embeds/start-proj-gen-contract/contract-preview.js'),
  'utf8',
)
const datepickerSource = fs.readFileSync(
  require.resolve('../global-embeds/form-embeds/datepicker/datepicker.js'),
  'utf8',
)

function loadProjectApi(window) {
  window.window = window
  vm.runInNewContext(projectSource, { window, WeakMap, Uint32Array, Date, Math }, {
    filename: 'project-form.js',
  })
  return window.StartersProjectFormV3
}

function attachFormTarget(element, form) {
  const closest = element.closest.bind(element)
  element.closest = (selector) => selector.includes('[data-project-form-v3="brand"] form')
    ? form
    : closest(selector)
}

function projectDocument() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, listener, options) {
      const entries = listeners.get(type) || []
      entries.push({
        listener,
        capture: options === true || Boolean(options && options.capture),
      })
      listeners.set(type, entries)
    },
    querySelectorAll() { return [] },
    querySelector() { return null },
    dispatch(type, target, capture) {
      for (const entry of listeners.get(type) || []) {
        if (entry.capture === capture) entry.listener({ target })
      }
    },
  }
}

function fireBubbling(document, flow, form, type, target) {
  document.dispatch(type, target, true)
  const event = flow.fire(form, type, target)
  document.dispatch(type, target, false)
  return event
}

function projectWindow(document) {
  return {
    document,
    crypto: { randomUUID: () => 'workflow-test-id' },
    Opp30: { API: { projectDirectCreate: () => { throw new Error('must not submit') } } },
    location: { hostname: 'thestarters.com' },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    navigator: {},
    console: { info: () => {} },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail }
    },
    Event: class Event { constructor(type) { this.type = type } },
    Date,
    Math,
    WeakMap,
    Uint32Array,
  }
}

function contractDestination() {
  const value = h('p', { 'data-preview-contract-element': 'value' })
  const standardHelp = h('p', {
    'data-preview-contract-element-toggle': 'value=Standard contract',
  })
  const ownHelp = h('p', {
    'data-preview-contract-element-toggle': 'value=My own contract',
  })
  return {
    element: h('div', { 'data-preview-contract': 'contract' }, [value, standardHelp, ownHelp]),
    value,
    standardHelp,
    ownHelp,
  }
}

function labeledInput(text, input) {
  const label = h('label', { for: input.getAttribute('id') }, [input])
  label.textContent = text
  return label
}

test('first Own Contract click enables Continue and reaches its Review projection', () => {
  const standard = h('input', {
    id: 'standard-contract', name: 'Contract', type: 'radio',
    'data-project-contract-choice': '', required: '',
  })
  const own = h('input', {
    id: 'own-contract', name: 'Contract', type: 'radio',
    'data-project-contract-choice': '', required: '',
  })
  standard.value = 'Standard contract'
  own.value = 'My own contract'
  standard.name = own.name = 'Contract'
  standard.checked = own.checked = false
  standard.required = own.required = true

  const affirmation = h('input', { id: 'confirm-contract', name: 'confirm-contract', type: 'checkbox' })
  affirmation.name = 'confirm-contract'
  affirmation.checked = false
  const affirmationText = h('span', { for: 'confirm-contract' })
  affirmationText.textContent = 'I confirm an executed contract before the start date'
  const affirmationRow = h('label', { 'data-input-filter-item': 'My own contract' }, [
    affirmation,
    affirmationText,
  ])

  const contractSource = h('section', { 'data-preview-contract-fields': 'contract' }, [
    labeledInput('Contract', standard),
    labeledInput('Contract', own),
  ])
  const next = h('button', { type: 'button', 'data-form-flow-action': 'next' })
  const nextWrap = h('div', { class: 'button_main-wrap' }, [next])
  const step1 = h('section', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-1' }, [
    contractSource,
    affirmationRow,
  ])
  const review = contractDestination()
  const step2 = h('section', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2' }, [review.element])
  const form = h('form', {
    'data-form-flow': 'generate-contract',
    'data-form-flow-validate': 'true',
    'data-project-form-v3': 'brand',
  }, [
    step1,
    step2,
    h('div', { 'data-form-flow-button-group': 'step-1' }, [nextWrap]),
    h('div', { 'data-form-flow-button-group': 'step-2' }, [h('button', { type: 'submit' })]),
  ])
  const wrapper = h('div', { class: 'w-form' }, [form])
  const body = h('body', {}, [wrapper])
  for (const element of [body, ...body.descendants()]) element.nodeType = 1

  const formQuery = form.querySelector.bind(form)
  const formQueryAll = form.querySelectorAll.bind(form)
  form.querySelector = (selector) => {
    if (selector === '[data-project-contract-choice]:checked' || selector === 'input[type="radio"]:checked') {
      return [standard, own].find((radio) => radio.checked) || null
    }
    return formQuery(selector)
  }
  form.querySelectorAll = (selector) => selector.includes('] ')
    ? []
    : formQueryAll(selector)
  for (const control of [standard, own, affirmation]) {
    control.form = form
    attachFormTarget(control, form)
  }

  const document = projectDocument()
  const window = projectWindow(document)
  const api = loadProjectApi(window)
  api.syncDurationFields(form)
  assert.equal(affirmationRow.style.display, 'none')

  const previewObservers = []
  const previewDocument = {
    readyState: 'complete',
    body,
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  }
  const previewWindow = { CSS: { escape: String } }
  previewWindow.window = previewWindow
  vm.runInNewContext(previewSource, {
    CSS: previewWindow.CSS,
    MutationObserver: class MutationObserver {
      constructor(callback) { this.callback = callback; previewObservers.push(this) }
      observe() {}
    },
    document: previewDocument,
    getComputedStyle: (element) => ({ display: element.style.display || 'block' }),
    window: previewWindow,
  }, { filename: 'contract-preview.js' })

  const flow = mount(body)
  previewObservers.forEach((observer) => observer.callback())
  assert.equal(nextWrap.getAttribute('aria-disabled'), 'true')

  own.checked = true
  fireBubbling(document, flow, form, 'click', own)
  fireBubbling(document, flow, form, 'change', own)
  assert.equal(affirmationRow.style.display, '')
  assert.equal(affirmation.required, true)
  assert.equal(nextWrap.getAttribute('aria-disabled'), 'true')

  affirmation.checked = true
  fireBubbling(document, flow, form, 'change', affirmation)
  assert.equal(nextWrap.getAttribute('aria-disabled'), null)

  const click = fireBubbling(document, flow, form, 'click', next)
  previewObservers.forEach((observer) => observer.callback())
  assert.equal(click.defaultPrevented, true)
  assert.equal(step2.style.display, 'block')
  assert.equal(review.value.textContent, 'My own contract')
  assert.equal(review.ownHelp.hasAttribute('hidden'), false)
  assert.equal(review.standardHelp.hasAttribute('hidden'), true)
})

function flatFeeFlow() {
  const engagement = h('input', { 'data-project-field': 'engagement_type' })
  engagement.value = 'Flat Fee'
  const start = h('input', { name: 'startDateInput' })
  const end = h('input', { name: 'endDateInput' })
  start.name = 'startDateInput'
  end.name = 'endDateInput'
  start.value = '08/20/2026'
  end.value = ''
  let endError = ''
  start.setCustomValidity = () => {}
  end.setCustomValidity = (value) => { endError = value }
  start.checkValidity = () => Boolean(start.value)
  end.checkValidity = () => Boolean(end.value) && !endError

  const panel = h('div', { 'data-input-filter-item': 'flat_fee' }, [start, end])
  const next = h('button', { type: 'button', 'data-form-flow-action': 'next' })
  const nextWrap = h('div', { class: 'button_main-wrap' }, [next])
  const step1 = h('section', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-1' }, [engagement, panel])
  const review = h('section', { 'data-form-flow-step': '', 'data-form-flow-element': 'step-2' })
  const form = h('form', {
    'data-form-flow': 'generate-contract-flat',
    'data-form-flow-validate': 'true',
  }, [
    step1,
    review,
    h('div', { 'data-form-flow-button-group': 'step-1' }, [nextWrap]),
    h('div', { 'data-form-flow-button-group': 'step-2' }, [h('button', { type: 'submit' })]),
  ])
  const queryAll = form.querySelectorAll.bind(form)
  form.querySelectorAll = (selector) => selector.includes('] ')
    ? selector.includes('flat_fee') && selector.includes('startDateInput') ? [start]
      : selector.includes('flat_fee') && selector.includes('endDateInput') ? [end]
        : []
    : queryAll(selector)
  for (const control of [start, end, next]) attachFormTarget(control, form)
  return { body: h('body', {}, [form]), end, form, next, nextWrap, review, start }
}

test('Flat Fee date validity gates Continue before Review', () => {
  const fixture = flatFeeFlow()
  const document = projectDocument()
  const api = loadProjectApi(projectWindow(document))
  api.syncDurationFields(fixture.form)
  const flow = mount(fixture.body)

  assert.equal(fixture.end.required, true)
  assert.equal(fixture.nextWrap.getAttribute('aria-disabled'), 'true')
  assert.equal(fireBubbling(document, flow, fixture.form, 'click', fixture.next).defaultPrevented, true)
  assert.equal(fixture.review.style.display, 'none')

  fixture.end.value = '08/19/2026'
  fireBubbling(document, flow, fixture.form, 'input', fixture.end)
  assert.equal(fixture.nextWrap.getAttribute('aria-disabled'), 'true')
  fireBubbling(document, flow, fixture.form, 'click', fixture.next)
  assert.equal(fixture.review.style.display, 'none')

  fixture.end.value = '08/20/2026'
  fireBubbling(document, flow, fixture.form, 'input', fixture.end)
  assert.equal(fixture.nextWrap.getAttribute('aria-disabled'), 'true')

  fixture.end.value = '08/21/2026'
  fireBubbling(document, flow, fixture.form, 'input', fixture.end)
  assert.equal(fixture.nextWrap.getAttribute('aria-disabled'), null)
  fireBubbling(document, flow, fixture.form, 'click', fixture.next)
  assert.equal(fixture.review.style.display, 'block')
})

function datepickerJquery(today) {
  const states = new WeakMap()
  function state(element) {
    if (!states.has(element)) states.set(element, {
      initialized: false,
      options: {},
      open: false,
      closeCount: 0,
    })
    return states.get(element)
  }
  function jquery(element) {
    return {
      data(key) { return key === 'datepicker' && state(element).initialized ? state(element) : undefined },
      closest() { return { length: 0 } },
      datepicker(command, name, value) {
        const current = state(element)
        if (typeof command === 'object') {
          current.initialized = true
          current.options = { ...command }
          return this
        }
        if (command === 'option') {
          if (arguments.length === 2) return current.options[name] ?? null
          if (current.open) {
            current.open = false
            current.closeCount += 1
          }
          current.options[name] = value
          return this
        }
        if (command === 'setDate') {
          const selected = new Date(name.getFullYear(), name.getMonth(), name.getDate())
          const minimum = current.options.minDate === '0' ? today : current.options.minDate
          if (minimum instanceof Date && selected < minimum) return this
          element.value = `${String(selected.getMonth() + 1).padStart(2, '0')}/${String(selected.getDate()).padStart(2, '0')}/${selected.getFullYear()}`
          if (current.options.onSelect) current.options.onSelect.call(element)
          return this
        }
        return this
      },
    }
  }
  jquery.fn = { datepicker() {} }
  jquery.open = (element) => { state(element).open = true }
  jquery.isOpen = (element) => state(element).open
  jquery.closeCount = (element) => state(element).closeCount
  jquery.option = (element, name) => state(element).options[name] ?? null
  return jquery
}

test('Weekly datepicker selects past, current, and future start dates', () => {
  const engagement = h('input', { 'data-project-field': 'engagement_type' })
  engagement.value = 'Weekly Recurring'
  const start = h('input', {
    name: 'startDateInput',
    'data-input-datepicker': '',
    'data-input-datepicker-min': '0',
  })
  start.name = 'startDateInput'
  const panel = h('div', { 'data-input-filter-item': 'weekly' }, [start])
  const form = h('form', {}, [engagement, panel])
  const body = h('body', {}, [form])
  for (const element of [body, ...body.descendants()]) element.nodeType = 1
  const queryAll = form.querySelectorAll.bind(form)
  form.querySelectorAll = (selector) => selector.includes('] ')
    ? selector.includes('weekly') && selector.includes('startDateInput') ? [start] : []
    : queryAll(selector)

  const today = new Date(2026, 7, 18)
  const jquery = datepickerJquery(today)
  const window = projectWindow(undefined)
  window.jQuery = jquery
  window.addEventListener = () => {}
  window.removeEventListener = () => {}
  window.requestAnimationFrame = (callback) => { callback(); return 1 }
  const document = {
    body,
    head: { appendChild() {} },
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    createElement: () => h('script'),
    getElementById: () => null,
  }
  window.document = document
  window.window = window
  vm.runInNewContext(datepickerSource, {
    Date,
    cancelAnimationFrame: () => {},
    console: { warn: () => {} },
    document,
    requestAnimationFrame: window.requestAnimationFrame,
    setInterval,
    clearInterval,
    setTimeout,
    window,
  }, { filename: 'datepicker.js' })

  const api = loadProjectApi(window)
  api.syncDurationFields(form)
  assert.equal(start.getAttribute('data-input-datepicker-min'), null)
  assert.equal(jquery.option(start, 'minDate'), null)

  for (const expected of [
    ['08/01/2026', new Date(2026, 7, 1)],
    ['08/18/2026', new Date(2026, 7, 18)],
    ['08/30/2026', new Date(2026, 7, 30)],
  ]) {
    jquery(start).datepicker('setDate', expected[1])
    assert.equal(start.value, expected[0])
  }
})

test('Weekly datepicker stays open when the focus click reaches project form sync', () => {
  const engagement = h('input', { 'data-project-field': 'engagement_type' })
  engagement.value = 'Weekly Recurring'
  const start = h('input', {
    name: 'startDateInput',
    'data-input-datepicker': '',
  })
  start.name = 'startDateInput'
  const panel = h('div', { 'data-input-filter-item': 'weekly' }, [start])
  const form = h('form', {}, [engagement, panel])
  attachFormTarget(start, form)
  const body = h('body', {}, [form])
  for (const element of [body, ...body.descendants()]) element.nodeType = 1
  const queryAll = form.querySelectorAll.bind(form)
  form.querySelectorAll = (selector) => selector.includes('] ')
    ? selector.includes('weekly') && selector.includes('startDateInput') ? [start] : []
    : queryAll(selector)

  const jquery = datepickerJquery(new Date(2026, 7, 18))
  jquery(start).datepicker({ dateFormat: 'mm/dd/yy' })
  const window = projectWindow(undefined)
  window.jQuery = jquery
  const document = {
    body,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener(type, handler) {
      if (type === 'click') this.clickHandler = handler
    },
  }
  window.document = document

  loadProjectApi(window)
  jquery.open(start)
  document.clickHandler({ target: start })

  assert.equal(jquery.isOpen(start), true)
  assert.equal(jquery.closeCount(start), 0)
})

test('shared modal datepicker stays above a clipped input after scroll', async () => {
  const input = h('input', { 'data-input-datepicker': '' })
  input.nodeType = 1
  let inputTop = 650
  input.getBoundingClientRect = () => ({ top: inputTop, bottom: inputTop + 40, left: 520 })
  const modal = h('dialog', { class: 'modal_dialog' }, [input])
  modal.nodeType = 1
  modal.clientLeft = 0
  modal.clientTop = 0
  modal.clientWidth = 800
  modal.scrollLeft = 0
  modal.scrollTop = 40
  modal.getBoundingClientRect = () => ({ top: 100, left: 200 })
  const body = h('body', {}, [modal])
  body.nodeType = 1
  body.contains = (element) => element === input || body.descendants().includes(element)
  const popup = h('div', { id: 'ui-datepicker-div' })
  popup.style.display = 'block'
  popup.offsetHeight = 280
  popup.offsetWidth = 320
  popup.offsetParent = modal
  popup.getBoundingClientRect = () => ({ height: 280, width: 320 })
  const states = new WeakMap()
  const handlers = new Map()
  const jquery = (element) => ({
    appendTo(parent) {
      popup.offsetParent = parent[0] || parent
      return this
    },
    closest(selector) {
      return selector === '.modal_dialog' ? { 0: modal, length: 1 } : { length: 0 }
    },
    data(key) {
      return key === 'datepicker' ? states.get(element) : undefined
    },
    datepicker(options) {
      states.set(element, options)
      return this
    },
  })
  jquery.fn = { datepicker() {} }
  const document = {
    body,
    documentElement: { clientHeight: 720 },
    getElementById: (id) => id === 'ui-datepicker-div' ? popup : null,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  }
  const window = {
    document,
    innerHeight: 720,
    jQuery: jquery,
    addEventListener(type, handler) { handlers.set(type, handler) },
    removeEventListener() {},
  }
  window.window = window

  vm.runInNewContext(datepickerSource, {
    Date,
    cancelAnimationFrame: () => {},
    clearInterval,
    document,
    requestAnimationFrame: (callback) => { callback(); return 1 },
    setInterval,
    setTimeout,
    window,
  }, { filename: 'datepicker.js' })

  states.get(input).beforeShow(input)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(popup.style.top, '310px')

  inputTop = 620
  handlers.get('scroll')()
  assert.equal(popup.style.top, '280px')
})
