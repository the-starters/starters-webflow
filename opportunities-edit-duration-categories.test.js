// Task D (Jai 10-02 list): Edit Opportunity Duration + Categories do not update.
// Fixtures mirror the live /opportunities/<id> Edit form markup (2026-10-03):
// the Duration radios sit inside the data-project-type="one-time" panel, and
// the detail page renders categories from a CMS list bound as category-list.
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
    } else if ((m = /^:checked/.exec(rest))) {
      if (!el.checked) return false
    } else {
      throw new Error('unsupported selector: ' + sel)
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
  constructor(tag, attrs = {}, children = []) {
    super(tag, attrs, children)
    this.hidden = false
  }
  get value() {
    return this.getAttribute('value') || ''
  }
  set value(value) {
    this.setAttribute('value', value)
  }
  get parentNode() {
    return this.parentElement
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child)
    return this.append(child)
  }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index === -1) throw new Error('not a child')
    this.children.splice(index, 1)
    child.parentElement = null
    return child
  }
  insertBefore(child, ref) {
    if (child.parentElement) child.parentElement.removeChild(child)
    const index = this.children.indexOf(ref)
    if (index === -1) throw new Error('ref not a child')
    child.parentElement = this
    this.children.splice(index, 0, child)
    return child
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
  cloneNode(deep) {
    const attrs = {}
    this._attrs.forEach((value, key) => {
      attrs[key] = value
    })
    const copy = new Element(this.tagName.toLowerCase(), attrs)
    copy.textContent = this.textContent
    copy.checked = this.checked
    if (deep) this.children.forEach((child) => copy.append(child.cloneNode(true)))
    return copy
  }
  dispatchEvent() {}
  setCustomValidity(message) {
    this.validationMessage = message
  }
}

const h = (tag, attrs = {}, children = []) => new Element(tag, attrs, children)

const source = fs.readFileSync(path.join(__dirname, 'opportunities-3.0.js'), 'utf8')
const createSource = fs.readFileSync(path.join(__dirname, 'opportunities---create.js'), 'utf8')

function loadOpp30(document = new Element('html')) {
  document.readyState = 'loading'
  document.addEventListener = () => {}
  document.removeEventListener = () => {}
  document.documentElement = document
  document.head = document
  document.createElement = (tag) => h(tag)
  document.getElementById = () => null
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
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type
        this.detail = options?.detail
      }
    },
  }
  window.window = window
  window.location = location
  const context = vm.createContext({
    Array,
    Date,
    Event: class Event {
      constructor(type, options) {
        this.type = type
        this.bubbles = options?.bubbles
      }
    },
    FormData,
    Headers,
    MutationObserver: class MutationObserver {
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
  vm.runInContext(source, context)
  return window.Opp30
}

const durationRadio = (id, value, checked = false) => {
  const input = h('input', { type: 'radio', name: 'Duration', id, value })
  input.checked = checked
  return h('label', { class: 'form_selection-field w-radio' }, [input])
}

function liveEditForm() {
  const durationGroup = h('div', { class: 'app-form_input_group', 'data-test': 'duration-group' }, [
    h('label', { class: 'form_label' }),
    h('div', { class: 'form_radio-group' }, [
      durationRadio('1-months', '≤ 1 months', true),
      durationRadio('1-to-3-months', '1 to 3 months'),
      durationRadio('3-to-6-months', '3 to 6 months'),
      durationRadio('6-months', '≥ 6+ months'),
    ]),
  ])
  const oneTime = h('div', { 'data-project-type': 'one-time', class: 'display-contents' }, [
    durationGroup,
    h('div', { class: 'app-form_input_group' }, [h('input', { name: 'One-Time-Budget' })]),
  ])
  const partTimeHours = h('div', { 'data-project-type': 'part-time', class: 'app-form_input_group' }, [
    h('input', { name: 'Estimated-Hours' }),
  ])
  const partTime = h('div', { 'data-project-type': 'part-time', class: 'display-contents' }, [
    h('div', { class: 'app-form_input_group' }, [h('input', { name: 'Part-Time-Budget' })]),
  ])
  const fullTime = h('div', { 'data-project-type': 'full-time', class: 'display-contents' }, [
    h('div', { class: 'app-form_input_group' }, [h('input', { name: 'Full-Time-Budget' })]),
  ])
  const list = h('div', { 'data-project-type-list': '', class: 'display-contents' }, [
    oneTime,
    partTimeHours,
    partTime,
    fullTime,
  ])
  const tabs = h('div', { 'data-tab-filters': '' }, [
    h('input', { type: 'radio', name: 'Project-Type', id: 'One-Time', 'data-project-type': 'one-time' }),
    h('input', { type: 'radio', name: 'Project-Type', id: 'Ongoing-Part-Time', 'data-project-type': 'part-time' }),
  ])
  const inputs = h('div', { class: 'create-opportunities_form-inputs' }, [tabs, list])
  const form = h('form', { 'data-opp-form': 'create' }, [inputs])
  return { form, list, oneTime, durationGroup, inputs }
}

test('Duration group moves out of the One Time panel so every project type shows it', () => {
  const { promoteDurationGroup } = loadOpp30()
  const { form, list, oneTime, durationGroup, inputs } = liveEditForm()
  assert.equal(oneTime.contains(durationGroup), true, 'fixture reproduces the live hidden-panel placement')

  assert.equal(promoteDurationGroup(form), true)
  assert.equal(oneTime.contains(durationGroup), false)
  assert.equal(durationGroup.closest('[data-project-type]'), null, 'no project-type panel can hide Duration now')
  assert.equal(inputs.children.indexOf(durationGroup), inputs.children.indexOf(list) - 1)
  assert.equal(form.getAttribute('data-opp-duration-promoted'), 'true')
  assert.ok(oneTime.querySelector('[name="One-Time-Budget"]'))
  assert.equal(form.querySelectorAll('[name="Duration"]').length, 4)
})

test('Duration promotion is idempotent and a no-op on corrected Designer markup', () => {
  const { promoteDurationGroup } = loadOpp30()
  const { form } = liveEditForm()
  assert.equal(promoteDurationGroup(form), true)
  assert.equal(promoteDurationGroup(form), false)

  const fixed = h('form', { 'data-opp-form': 'create' }, [
    h('div', { class: 'app-form_input_group' }, [durationRadio('1-months', '≤ 1 months')]),
    h('div', { 'data-project-type-list': '' }, [h('div', { 'data-project-type': 'one-time' })]),
  ])
  assert.equal(promoteDurationGroup(fixed), false)
  assert.equal(fixed.getAttribute('data-opp-duration-promoted'), null)
})

test('Duration promotion refuses a group that also owns other fields', () => {
  const { promoteDurationGroup } = loadOpp30()
  const shared = h('div', { class: 'app-form_input_group' }, [
    durationRadio('1-months', '≤ 1 months'),
    h('input', { name: 'One-Time-Budget' }),
  ])
  const panel = h('div', { 'data-project-type': 'one-time' }, [shared])
  const form = h('form', {}, [h('div', { 'data-project-type-list': '' }, [panel])])
  assert.equal(promoteDurationGroup(form), false)
  assert.equal(panel.contains(shared), true)
})

test('prepareOpportunityForms promotes live edit markup through the public interface', () => {
  const { form, list, durationGroup } = liveEditForm()
  const modal = h('dialog', { 'data-modal-target': 'edit-opportunity' }, [form])
  const { prepareOpportunityForms } = loadOpp30()
  assert.equal(durationGroup.closest('[data-project-type]') !== null, true)

  prepareOpportunityForms(modal)

  assert.equal(durationGroup.closest('[data-project-type]'), null)
  assert.equal(form.children[0].children.indexOf(durationGroup), form.children[0].children.indexOf(list) - 1)
})

function categoryList(names) {
  const item = (name) =>
    h('div', { role: 'listitem', class: 'display-contents w-dyn-item' }, [
      h('div', { class: 'label_component' }, [
        Object.assign(h('div', { class: 'label_text' }), { textContent: name }),
      ]),
    ])
  return h('div', { 'data-opp-bind': 'category-list', role: 'list' }, names.map(item))
}

const labels = (list) => list.querySelectorAll('.label_text').map((el) => el.textContent)

test('saved categories repaint the CMS category chips in place', () => {
  const list = categoryList(['AI & Technology', 'Marketing Strategy & Brand'])
  const doc = h('html', {}, [list])
  const { paintOpportunityCategories } = loadOpp30(doc)
  assert.equal(paintOpportunityCategories(['Content & Organic', ' Paid Media ', '']), 1)
  assert.deepEqual(labels(list), ['Content & Organic', 'Paid Media'])
  assert.equal(list.querySelectorAll('.w-dyn-item').length, 2)
})

test('empty or missing category names never blank the authored chips', () => {
  const list = categoryList(['AI & Technology'])
  const doc = h('html', {}, [list])
  const { paintOpportunityCategories } = loadOpp30(doc)
  assert.equal(paintOpportunityCategories([]), 0)
  assert.equal(paintOpportunityCategories(undefined), 0)
  assert.deepEqual(labels(list), ['AI & Technology'])
})

test('create page controller never binds the Edit Opportunity form', () => {
  const createForm = h('form', { 'data-opp-form': 'create', id: 'create' })
  const editForm = h('form', { 'data-opp-form': 'create', id: 'edit' })
  const doc = h('html', {}, [
    h('dialog', { 'data-modal-target': 'edit-opportunity' }, [editForm]),
    h('dialog', { 'data-modal-target': 'post-opportunity' }, [createForm]),
  ])
  doc.readyState = 'complete'
  doc.addEventListener = () => {}
  doc.removeEventListener = () => {}
  const bound = []
  createForm.addEventListener = (type, listener, capture) => bound.push({ form: createForm, type, listener, capture })
  editForm.addEventListener = (type, listener, capture) => bound.push({ form: editForm, type, listener, capture })
  const window = {
    Opp30: {
      prepareOpportunityCreateForms() {},
    },
  }
  window.window = window
  const context = vm.createContext({
    Array,
    HTMLInputElement: Element,
    HTMLSelectElement: Element,
    console: { error() {}, info() {} },
    document: doc,
    location: {
      href: 'https://example.test/opportunities---create',
      pathname: '/opportunities---create',
      search: '',
    },
    window,
  })
  vm.runInContext(createSource, context)
  assert.deepEqual(
    bound.map((entry) => ({ id: entry.form.getAttribute('id'), type: entry.type, capture: entry.capture })),
    [{ id: 'create', type: 'submit', capture: true }],
  )
})
