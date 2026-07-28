const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const core = fs.readFileSync(require.resolve('./opportunities-3.0.js'), 'utf8')
const standalone = fs.readFileSync(require.resolve('./opportunities---create.js'), 'utf8')

test('opportunity forms expose visible category validation before wf-validate binds', () => {
  assert.match(core, /const CATEGORY_REQUIRED_MESSAGE = 'Please select at least one category\.'/)
  assert.match(core, /input\.setCustomValidity\(selected\.length \? '' : CATEGORY_REQUIRED_MESSAGE\)/)
  assert.match(core, /prepareOpportunityForms\(\)\s+initOpportunityCategorySelects\(\)/)
  assert.match(core, /categoryInput\.setAttribute\('aria-required', 'true'\)/)
})

test('ongoing part-time opportunities require and submit estimated weekly hours', () => {
  assert.match(core, /\$\(`\[name="\$\{EST_HOURS_FIELD_NAME\}"\]`, form\)/)
  assert.doesNotMatch(core, /fieldGroup\.innerHTML/)
  assert.match(core, /payload\.project_type === 'Ongoing Part Time' && !payload\.est_hours/)
  assert.match(
    core,
    /est_hours: project_type === 'Ongoing Part Time' \? val\(EST_HOURS_FIELD_NAME\) : ''/,
  )
  assert.match(core, /setVal\(EST_HOURS_FIELD_NAME, o\.est_hours\)/)
})

test('standalone create controller delegates to the shared form and validation contract', () => {
  assert.match(standalone, /window\.Opp30\.prepareOpportunityCreateForms\(form\)/)
  assert.match(standalone, /window\.Opp30\.readOpportunityForm\(form\)/)
  assert.match(standalone, /window\.Opp30\.validateOpportunityPayload\(payload\)/)
  assert.match(
    standalone,
    /est_hours: project_type === 'Ongoing Part Time' \? val\('Estimated-Hours'\) : ''/,
  )
})

class FakeControl {
  constructor(attrs = {}) {
    this.attrs = new Map(Object.entries(attrs).map(([name, value]) => [name, String(value)]))
    this.listeners = new Map()
    this.value = attrs.value || ''
    this.id = attrs.id || ''
    this.checked = false
    this.required = false
    this.customValidity = ''
    this.classList = { toggle() {} }
    this.parentElement = { querySelector: () => ({ classList: { toggle() {} } }) }
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event)
    return true
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value))
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null
  }

  setCustomValidity(message) {
    this.customValidity = message
  }

  closest() {
    return null
  }
}

function opportunityForm(kind) {
  const category = new FakeControl({ name: 'Category-option' })
  const budget = new FakeControl({ name: 'Part-Time-Budget' })
  const estimatedHoursGroup = { hidden: false }
  const estimatedHours = new FakeControl({ name: 'Estimated-Hours' })
  estimatedHours.closest = (selector) =>
    selector === '[data-project-type="part-time"]' ? estimatedHoursGroup : null
  const partTime = new FakeControl({
    id: 'Ongoing-Part-Time',
    name: 'Project-Type',
    value: 'Ongoing Part Time',
  })
  const fullTime = new FakeControl({
    id: 'Full-Time',
    name: 'Project-Type',
    value: 'Full Time',
  })
  const fields = new Map([
    ['Category-option', category],
    ['Part-Time-Budget', budget],
    ['Estimated-Hours', estimatedHours],
  ])
  const partTimeGroup = {
    querySelector: (selector) =>
      selector === '[name="Part-Time-Budget"]' ? budget : null,
  }
  const form = {
    attrs: new Map(),
    kind,
    matches(selector) {
      return selector === 'form' || (kind === 'create' && selector === '[data-opp-form="create"]')
    },
    closest(selector) {
      return kind === 'edit' && selector === '[data-modal-target="edit-opportunity"]'
        ? modal
        : null
    },
    querySelector(selector) {
      if (selector === '[data-project-type="part-time"]') return partTimeGroup
      if (selector === '[name="Project-Type"]:checked')
        return [partTime, fullTime].find((radio) => radio.checked) || null
      const name = /^\[name="([^"]+)"\]$/.exec(selector)
      return name ? fields.get(name[1]) || null : null
    },
    querySelectorAll(selector) {
      return selector === '[name="Project-Type"]' ? [partTime, fullTime] : []
    },
    setAttribute(name, value) {
      this.attrs.set(name, String(value))
    },
    getAttribute(name) {
      return this.attrs.get(name) ?? null
    },
  }
  const modal = {
    matches: (selector) => selector === '[data-modal-target="edit-opportunity"]',
    querySelector: (selector) => (selector === 'form' ? form : form.querySelector(selector)),
    querySelectorAll: (selector) =>
      selector === '[data-opp-form="create"], [data-modal-target="edit-opportunity"] form'
        ? [form]
        : form.querySelectorAll(selector),
  }
  return { category, estimatedHoursGroup, fields, form, fullTime, modal, partTime }
}

function loadOpportunityForms() {
  const create = opportunityForm('create')
  const edit = opportunityForm('edit')
  const refreshed = []
  const documentElement = {
    appendChild() {},
    getAttribute: () => null,
    setAttribute() {},
  }
  const document = {
    addEventListener() {},
    createElement: () => new FakeControl(),
    documentElement,
    getElementById: () => null,
    head: documentElement,
    querySelector(selector) {
      return selector === '[data-modal-target="edit-opportunity"]' ? edit.modal : null
    },
    querySelectorAll(selector) {
      return selector === '[data-opp-form="create"], [data-modal-target="edit-opportunity"] form'
        ? [create.form, edit.form]
        : []
    },
    readyState: 'loading',
  }
  const window = {
    WfValidate: { refresh: (form) => refreshed.push(form) },
    addEventListener() {},
    clearInterval,
    clearTimeout,
    dispatchEvent() {},
    setInterval,
    setTimeout,
  }
  window.window = window
  vm.runInNewContext(core, {
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type
        this.detail = options.detail
      }
    },
    Event: class Event {
      constructor(type) {
        this.type = type
      }
    },
    FormData,
    Headers,
    HTMLInputElement: FakeControl,
    HTMLSelectElement: class HTMLSelectElement {},
    MutationObserver: class MutationObserver {},
    Request,
    URL,
    URLSearchParams,
    alert() {},
    console: { error() {}, info() {}, log() {}, warn() {} },
    document,
    fetch: async () => {
      throw new Error('unexpected fetch')
    },
    history: { replaceState() {} },
    location: {
      href: 'https://example.test/all-modals',
      hostname: 'example.test',
      pathname: '/all-modals',
      search: '',
    },
    window,
  })
  return { create, edit, refreshed, window }
}

test('create and edit forms bind Webflow-authored estimated hours without generating markup', () => {
  const { create, edit, refreshed } = loadOpportunityForms()

  assert.ok(create.fields.get('Estimated-Hours'))
  assert.ok(edit.fields.get('Estimated-Hours'))
  assert.equal(create.estimatedHoursGroup.hidden, true)
  assert.equal(edit.estimatedHoursGroup.hidden, true)
  assert.deepEqual(refreshed, [create.form, edit.form])
})

test('edit prefill sets weekly hours and restores conditional inline validation', async () => {
  const { edit, window } = loadOpportunityForms()
  window.Opp30.API.brandOppGet = async () => ({
    budget: '2000',
    category_names: [],
    est_hours: '25 hrs/week',
    est_project_duration: '3 months',
    project_type: 'Ongoing Part Time',
    status: 'Active',
  })

  await window.Opp30.prefillEditOpportunity(42)

  const estimatedHours = edit.fields.get('Estimated-Hours')
  assert.equal(estimatedHours.value, '25 hrs/week')
  assert.equal(edit.partTime.checked, true)
  assert.equal(edit.estimatedHoursGroup.hidden, false)
  assert.equal(estimatedHours.required, true)
  assert.equal(estimatedHours.getAttribute('aria-required'), 'true')
  assert.equal(
    estimatedHours.getAttribute('wf-validate-message-required'),
    'Please enter the estimated hours per week.',
  )

  edit.partTime.checked = false
  edit.fullTime.checked = true
  edit.fullTime.dispatchEvent({ type: 'change' })

  assert.equal(estimatedHours.required, false)
  assert.equal(estimatedHours.getAttribute('aria-required'), 'false')
  assert.equal(edit.estimatedHoursGroup.hidden, true)
})
