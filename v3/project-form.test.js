'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'project-form.js'), 'utf8')

class Element {
  constructor(attrs = {}) {
    this.attrs = { ...attrs }
    this._value = attrs.value || ''
    this.type = attrs.type || 'text'
    this.checked = attrs.checked !== false
    this.disabled = attrs.disabled === true
    this.hidden = false
    this.textContent = ''
    this.style = { display: '' }
    this.children = []
    this.tagName = attrs.tagName || 'INPUT'
    this.options = attrs.options || []
    this.events = []
  }
  // A native <select> reports the value of whichever option is selected, so the
  // fixture must too: writing `option.selected` is the only thing the adapter
  // does to a select.
  get value() {
    if (this.tagName === 'SELECT' && this.options) {
      const selected = this.options.find((option) => option.selected)
      if (selected) return selected.value
    }
    return this._value
  }
  set value(next) { this._value = next }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return this.attrs[name] ?? null }
  removeAttribute(name) { delete this.attrs[name] }
  dispatchEvent(event) { this.events.push(event.type) }
  click() {
    this.checked = this.type === 'checkbox' ? !this.checked : true
    this.events.push('click')
  }
  matches(selector) { return selector.includes('[data-project-form-v3="brand"] form') && this.attrs['data-project-form-v3'] === 'brand' }
  closest(selector) {
    if (selector.includes('[data-project-form-v3="brand"] form')) return this.form || (this.matches(selector) ? this : null)
    if (selector === '[data-project-form-container]') return this.wrapper || null
    if (selector === '[data-project-diagnostic-copy]') return this.getAttribute('data-project-diagnostic-copy') !== null ? this : null
    return null
  }
  querySelector(selector) {
    const field = /^\[data-project-field="([^"]+)"\]$/.exec(selector)
    if (field) return this.children.find((child) => child.getAttribute('data-project-field') === field[1]) || null
    if (selector === '[data-project-form-state="error"]') return this.error || null
    if (selector === '[data-project-contract-choice]:checked') return this.contractChoice || null
    if (selector === 'input[type="radio"]:checked') return this.contractChoice || null
    if (selector === '[data-project-form-state="success"]') return this.success || null
    if (selector === '[data-project-success-title]') return this.successTitle || null
    if (selector === '[data-project-success-message]') return this.successMessage || null
    if (selector === '[data-preview-contract-element-toggle="Standard contract"]') return this.legacySuccessTitle || null
    if (selector === '[data-preview-contract-reference="contract"] > p:not([data-preview-contract-element-toggle])') return this.legacySuccessMessage || null
    if (selector === '.w-form-fail') return this.nativeError || null
    if (selector === '.w-form-done') return this.nativeSuccess || null
    const feePanel = /^\[data-input-filter-item="([^"]+)"\]$/.exec(selector)
    if (feePanel) return (this.feePanels && this.feePanels[feePanel[1]]) || null
    return null
  }
  querySelectorAll(selector) {
    if (selector === 'input, select, textarea') return this.controls || []
    if (selector === 'label') return this.labels || []
    if (selector === '[data-project-field]') return this.children
    const feePanels = /^\[data-input-filter-item="([^"]+)"\]$/.exec(selector)
    if (feePanels) {
      const matches = this.filterItems && this.filterItems[feePanels[1]]
      if (matches) return matches
      const panel = this.feePanels && this.feePanels[feePanels[1]]
      return panel ? [panel] : []
    }
    // Keyed on the exact filter-item value so the canonical and legacy panel
    // grammars stay distinguishable. `panelControls` is authoritative when a
    // test supplies it; otherwise the shorthand buckets answer for the
    // canonical grammar only.
    const panelControl = /^\[data-input-filter-item="([^"]+)"\] \[name="([^"]+)"\]$/.exec(selector)
    if (panelControl) {
      const [, item, name] = panelControl
      if (this.panelControls) return (this.panelControls[item] || {})[name] || []
      if (item === 'monthly' && name === 'endDateInput') return this.monthlyEndDates || []
      if (item === 'hourly' && name === 'endDateInput') return this.hourlyEndDates || []
      if (item === 'hourly' && name === 'no-end-date') return this.hourlyOngoingChoices || []
      return []
    }
    if (selector.startsWith('[required]')) {
      return this.children.filter((child) => child.getAttribute('required') !== null || child.getAttribute('data-project-required-hidden') !== null)
    }
    if (selector === '[name]') return this.children.filter((child) => child.getAttribute('name') !== null)
    const named = /^\[name="([^"]+)"\]$/.exec(selector)
    if (named) return this.children.filter((child) => child.getAttribute('name') === named[1])
    if (selector.includes('[data-project-field]') && selector.includes('[data-project-contract-choice]')) {
      return this.children.concat(this.contractChoices || (this.contractChoice ? [this.contractChoice] : []))
    }
    if (selector.includes('[type="submit"]')) return this.submitters || []
    return []
  }
  reportValidity() { return this.reportValidityImpl ? this.reportValidityImpl() : this.valid !== false }
}

function field(name, value, attrs = {}) {
  return new Element({ 'data-project-field': name, value, ...attrs })
}

function nativeField(name, value, attrs = {}) {
  return new Element({ name, value, ...attrs })
}

function labelElement(forId) {
  return new Element({ for: forId })
}

function projectForm(values = {}) {
  const form = new Element({ 'data-project-form-v3': 'brand' })
  form.error = new Element()
  form.submitters = [new Element({ type: 'submit' })]
  form.children = Object.entries({
    starter_memberstack_id: 'mem_starter_123',
    idempotency_key: '',
    title: 'Launch project',
    service: 'Email Marketing',
    engagement_type: 'Weekly Recurring',
    total_cost: '',
    paid_upfront_pct: '10%',
    hourly_rate: '',
    weekly_rate: '$1,250.00',
    monthly_rate: '',
    estimated_hours: '',
    maximum_total_hours: '',
    hourly_billing_frequency: '',
    invoice_frequency: 'weekly',
    maximum_hours_per_week: '',
    maximum_hours_per_month: '',
    number_of_weeks: '8',
    number_of_months: '',
    start_date: '08/20/2026',
    estimated_end_date: '2026-10-15',
    project_scope: 'Build and optimize the retention program.',
    ...values,
  }).map(([name, value]) => field(name, value))
  form.contractChoice = new Element({ 'data-project-contract-choice': '', type: 'radio', value: 'Standard contract', checked: true })
  return form
}

function documentFixture(form) {
  const listeners = {}
  return {
    documentElement: new Element(),
    listeners,
    addEventListener(name, handler, capture) { listeners[name] = { handler, capture } },
    dispatchEvent(event) { this.event = event },
    querySelectorAll() { return [] },
    querySelector(selector) {
      if (selector === 'dialog[data-modal-target="generate-contract"] #pushMemID') return form.querySelector('[data-project-field="starter_memberstack_id"]')
      return selector.includes('[data-project-form-v3="brand"] form') ? form : null
    },
  }
}

function load(options = {}) {
  const form = options.form || projectForm()
  const document = options.document || documentFixture(form)
  const calls = []
  const trackCalls = []
  const consoleLogs = []
  const clipboardWrites = []
  const storage = new Map()
  const window = {
    document,
    crypto: { randomUUID: () => 'uuid-123' },
    Opp30: { API: { projectDirectCreate: options.createProject || (async (payload) => {
      calls.push(payload)
      if (options.reject) throw Object.assign(new Error('raw server detail'), { status: options.reject })
      return { project: { id: 669 }, replayed: false }
    }) } },
    StartersTrack: { track(name, payload) { trackCalls.push({ name, payload }) } },
    location: { hostname: 'thestarters.com' },
    sessionStorage: {
      setItem(key, value) {
        if (options.storageThrows) throw new Error('storage unavailable')
        storage.set(key, String(value))
      },
      getItem(key) {
        if (options.storageThrows) throw new Error('storage unavailable')
        return storage.has(key) ? storage.get(key) : null
      },
    },
    navigator: options.noClipboard ? {} : {
      clipboard: {
        async writeText(value) {
          if (options.clipboardRejects) throw new Error('clipboard denied')
          clipboardWrites.push(String(value))
        },
      },
    },
    console: { info(...args) { consoleLogs.push(args) } },
    CustomEvent: class CustomEvent { constructor(name, init) { this.type = name; this.detail = init.detail } },
    Event: class Event { constructor(name) { this.type = name } },
    $memberstackDom: options.memberstack,
    setTimeout: options.setTimeout,
    WeakMap,
    Uint32Array,
    Date,
    Math,
  }
  vm.runInNewContext(SOURCE, { window, WeakMap, Uint32Array, Date, Math }, { filename: 'project-form.js' })
  return { api: window.StartersProjectFormV3, calls, trackCalls, consoleLogs, clipboardWrites, storage, document, form, window }
}

test('normalizes ids, money, dates, and supported engagement values', () => {
  const { api } = load()
  assert.equal(api.positiveId(' 42 '), 42)
  assert.equal(api.positiveId('0'), null)
  assert.equal(api.numberValue('$1,250.50'), 1250.5)
  assert.equal(api.dateValue('8/20/2026'), '2026-08-20')
  assert.equal(api.dateValue('02/30/2026'), '')
  assert.equal(api.dateValue('2026-02-30'), '')
  assert.equal(api.canonicalEngagement('Monthly Recurring'), 'monthly')
  assert.equal(api.canonicalEngagement('Ongoing Hourly'), 'hourly')
  assert.equal(api.canonicalContractType('My own contract'), 'own_contract')
  assert.equal(api.canonicalContractType('Own Contract'), 'own_contract')
  assert.equal(api.canonicalHourlyFrequency('One Time'), 'one_time')
  assert.equal(api.canonicalHourlyFrequency('Entire project'), 'one_time')
  assert.equal(api.canonicalHourlyFrequency('Per week'), 'weekly')
  assert.equal(api.canonicalHourlyFrequency('Per month'), 'monthly')
  assert.equal(api.canonicalInvoiceFrequency('Bi-Weekly'), 'bi_weekly')
  assert.equal(api.canonicalInvoiceFrequency('Upon completion of the project'), 'upon_completion')
})

test('prefills the native hiring-manager field from the signed-in Memberstack member', async () => {
  const form = projectForm()
  const manager = nativeField('Hiring-Manager-Name', '')
  form.children.push(manager)
  const document = documentFixture(form)
  document.querySelectorAll = (selector) => selector.includes('Hiring-Manager-Name') ? [manager] : []
  const memberstack = {
    getCurrentMember: async () => ({
      data: { customFields: { 'free-user': 'Jai', 'last-name': 'Indolwani' } },
    }),
  }
  const { api, window } = load({ form, document, memberstack })

  assert.equal(await api.fillMemberName(document, window, 0), true)
  assert.equal(manager.value, 'Jai Indolwani')
  assert.deepEqual(manager.events, ['input', 'change'])
})

test('smart-fill resolves fee structure and invoice frequency by native name', () => {
  const form = projectForm()
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'invoice_frequency')
  const fee = nativeField('Fee-Structure', '', {
    tagName: 'SELECT',
    options: [
      { value: '', textContent: 'Select one...' },
      { value: 'flat_fee', textContent: 'Flat Fee' },
    ],
    'data-sp-fill': 'input',
    'data-sp-fill-category': 'fee-structure',
  })
  const invoice = nativeField('invoice-frequency', '', {
    tagName: 'SELECT',
    options: [
      { value: '', textContent: 'Select one...' },
      { value: 'bi_weekly', textContent: 'Bi-Weekly' },
    ],
    // Mirrors the current Designer mistake. Native-name resolution must keep
    // an invoice preset from writing the fee-structure select.
    'data-sp-fill': 'input',
    'data-sp-fill-category': 'fee-structure',
  })
  form.children.push(fee, invoice)
  const document = documentFixture(form)
  document.querySelectorAll = (selector) => selector.includes('[data-sp-fill="input"]') ? [fee, invoice] : []
  const { api } = load({ form, document })

  assert.equal(api.applySmartFill(document, 'fee-structure', 'flat_fee'), true)
  assert.equal(api.applySmartFill(document, 'invoice-frequency', 'bi_weekly'), true)
  assert.equal(fee.value, 'flat_fee')
  assert.equal(invoice.value, 'bi_weekly')
  assert.deepEqual(fee.events, ['input', 'change'])
  assert.deepEqual(invoice.events, ['input', 'change'])
})

test('smart-fill mutates only the form that owns the clicked preset', () => {
  const first = projectForm()
  const second = projectForm()
  const firstFee = nativeField('Fee-Structure', '', {
    tagName: 'SELECT',
    options: [{ value: '', textContent: 'Select one...' }, { value: 'flat_fee', textContent: 'Flat Fee' }],
  })
  const secondFee = nativeField('Fee-Structure', '', {
    tagName: 'SELECT',
    options: [{ value: '', textContent: 'Select one...' }, { value: 'monthly', textContent: 'Monthly Recurring' }],
  })
  first.children.push(firstFee)
  second.children.push(secondFee)
  const firstQueryAll = first.querySelectorAll.bind(first)
  const secondQueryAll = second.querySelectorAll.bind(second)
  first.querySelectorAll = (selector) => selector === '[data-sp-fill="input"]' ? [firstFee] : firstQueryAll(selector)
  second.querySelectorAll = (selector) => selector === '[data-sp-fill="input"]' ? [secondFee] : secondQueryAll(selector)

  const preset = new Element({ 'data-sp-fill': 'button' })
  preset.form = second
  preset.querySelectorAll = (selector) => selector === '[data-sp-fill-category]'
    ? [new Element({ 'data-sp-fill-category': 'fee-structure', 'data-sp-fill-value': 'monthly' })]
    : []
  const clicked = new Element()
  clicked.closest = (selector) => selector === '[data-sp-fill="button"]' ? preset : null
  const document = documentFixture(first)
  const { api } = load({ form: first, document })

  assert.equal(api.handleSmartFill({ target: clicked }, document), true)
  assert.equal(firstFee.value, '')
  assert.equal(secondFee.value, 'monthly')
})

test('prefills the hiring-manager field whatever the Designer label casing', async () => {
  const form = projectForm()
  const manager = nativeField('Hiring-manager-name', '')
  form.children.push(manager)
  const document = documentFixture(form)
  const memberstack = {
    getCurrentMember: async () => ({ data: { customFields: { 'free-user': 'Jai', 'last-name': 'Indolwani' } } }),
  }
  const { api, window } = load({ form, document, memberstack })

  assert.equal(await api.fillMemberName(document, window, 0), true)
  assert.equal(manager.value, 'Jai Indolwani')
})

test('never reads Memberstack again once every hiring-manager target is filled', async () => {
  const form = projectForm()
  form.children.push(nativeField('Hiring-Manager-Name', 'Jai Indolwani'))
  const document = documentFixture(form)
  let reads = 0
  const memberstack = {
    getCurrentMember: async () => {
      reads += 1
      return { data: { customFields: { 'free-user': 'Jai' } } }
    },
  }
  const { api, window } = load({ form, document, memberstack })

  assert.equal(await api.fillMemberName(document, window, 0), false)
  assert.equal(reads, 0)
})

test('smart-fill widens a collapsed fee-structure resolution to the whole radio group', () => {
  const form = projectForm()
  const flat = nativeField('Fee-Structure', 'Flat Fee', { type: 'radio', checked: false })
  const weekly = nativeField('Fee-Structure', 'Weekly Recurring', { type: 'radio', checked: true })
  form.children.push(flat, weekly)
  const document = documentFixture(form)
  const { api } = load({ form, document })

  assert.equal(api.smartFillTarget(document, 'fee-structure'), weekly)
  assert.equal(api.applySmartFill(document, 'fee-structure', 'Flat Fee'), true)
  assert.equal(flat.checked, true)
  assert.deepEqual(flat.events, ['click'])
})

function taggedCheckbox(attrs = {}) {
  const form = projectForm()
  const checkbox = new Element({ type: 'checkbox', 'data-sp-fill': 'input', 'data-sp-fill-category': 'ongoing', ...attrs })
  const document = documentFixture(form)
  document.querySelectorAll = (selector) => selector.includes('[data-sp-fill="input"]') ? [checkbox] : []
  return { checkbox, document, api: load({ form, document }).api }
}

test('a false preset never turns a smart-fill checkbox on', () => {
  const off = taggedCheckbox({ checked: false })
  assert.equal(off.api.applySmartFill(off.document, 'ongoing', 'false'), true)
  assert.equal(off.checkbox.checked, false)
  assert.deepEqual(off.checkbox.events, [])

  const on = taggedCheckbox({ checked: true, value: 'false' })
  assert.equal(on.api.applySmartFill(on.document, 'ongoing', 'false'), true)
  assert.equal(on.checkbox.checked, false)
})

test('a smart-fill checkbox accepts its own value and ignores an unrecognized preset', () => {
  const own = taggedCheckbox({ checked: false, value: 'Yes' })
  assert.equal(own.api.applySmartFill(own.document, 'ongoing', 'yes'), true)
  assert.equal(own.checkbox.checked, true)

  const unknown = taggedCheckbox({ checked: false, value: 'Yes' })
  assert.equal(unknown.api.applySmartFill(unknown.document, 'ongoing', 'maybe'), false)
  assert.equal(unknown.checkbox.checked, false)
})

test('smart-fill selects the resolved option even when option values repeat', () => {
  const form = projectForm()
  const duplicated = { value: 'monthly', textContent: 'Monthly Basis' }
  const invoice = nativeField('invoice-frequency', '', {
    tagName: 'SELECT',
    options: [
      { value: '', textContent: 'Select one...' },
      { value: 'monthly', textContent: 'Monthly' },
      duplicated,
    ],
  })
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'invoice_frequency')
  form.children.push(invoice)
  const document = documentFixture(form)
  const { api } = load({ form, document })

  assert.equal(api.applySmartFill(document, 'invoice-frequency', 'Monthly Basis'), true)
  assert.equal(duplicated.selected, true)
  assert.equal(invoice.value, 'monthly')
  assert.equal(api.serialize(form).payload.invoice_frequency, 'monthly')
})

test('current-date migration fills tagged blank fields once without clobbering edits', () => {
  const { api, window } = load()
  const form = new Element()
  const blank = nativeField('startDateInput', '', { tagName: 'INPUT', 'data-set-current-date': 'mm/dd/yy' })
  const authored = nativeField('startDateInput', '09/01/2026', { tagName: 'INPUT', 'data-set-current-date': 'mm/dd/yy' })
  form.querySelectorAll = (selector) => selector === '[data-set-current-date]' ? [blank, authored] : []
  // Local-time construction: formatCurrentDate reads local accessors, so a UTC
  // instant would make this assertion fail at negative offsets.
  window.Date = class FixedDate extends Date {
    constructor() { super(2026, 7, 7) }
  }

  assert.equal(api.fillCurrentDates(form, window), 1)
  assert.equal(blank.value, '08/07/2026')
  assert.equal(authored.value, '09/01/2026')
  assert.equal(blank.getAttribute('data-set-current-date-inited'), 'true')
  assert.equal(authored.getAttribute('data-set-current-date-inited'), 'true')
  assert.equal(api.fillCurrentDates(form, window), 0)
})

test('serializes only explicitly marked fields into the Xano contract', () => {
  const { api, form } = load()
  form.children.push(new Element({ value: 'must-not-submit' }))
  const result = api.serialize(form)
  assert.equal(result.payload.starter_memberstack_id, 'mem_starter_123')
  assert.equal(result.payload.engagement_type, 'weekly')
  assert.equal(result.payload.contract_type, 'standard')
  assert.equal(result.payload.weekly_rate, 1250)
  assert.equal(result.payload.number_of_weeks, 8)
  assert.equal(result.payload.start_date, '2026-08-20')
  assert.equal(Object.values(result.payload).includes('must-not-submit'), false)
})

test('serializes the checked engagement radio before deduplicating its field name', () => {
  const form = projectForm()
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'engagement_type')
  form.children.push(
    field('engagement_type', 'Flat Fee', { type: 'radio', checked: false }),
    field('engagement_type', 'Weekly Recurring', { type: 'radio', checked: true }),
  )
  const { api } = load({ form })
  assert.equal(api.serialize(form).payload.engagement_type, 'weekly')
})

test('prefers the populated conditional fee-panel control over hidden blank siblings', () => {
  const form = projectForm({ start_date: '' })
  form.children.push(field('start_date', '08/20/2026'))
  const { api } = load({ form })
  assert.equal(api.serialize(form).payload.start_date, '2026-08-20')
})

test('serializes the authored ongoing-hourly model for the direct-hire endpoint', () => {
  const form = projectForm({ engagement_type: 'Ongoing Hourly', total_cost: '999', hourly_rate: '100', hourly_billing_frequency: 'Weekly', maximum_total_hours: '40', maximum_hours_per_week: '20', maximum_hours_per_month: '80' })
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(serialized.payload.engagement_type, 'hourly')
  assert.equal(serialized.payload.hourly_rate, 100)
  assert.equal(serialized.payload.hourly_billing_frequency, 'weekly')
  assert.equal(serialized.payload.maximum_hours_per_week, 20)
  assert.equal(serialized.payload.total_cost, null)
  assert.equal(serialized.payload.maximum_total_hours, null)
  assert.equal(serialized.payload.maximum_hours_per_month, null)
  assert.equal(api.validationError(serialized), '')
})

test('serializes a native Webflow invoice-frequency select independently from fee cadence', () => {
  const form = projectForm({ engagement_type: 'Ongoing Hourly', hourly_rate: '100', hourly_billing_frequency: 'Weekly', maximum_hours_per_week: '20' })
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'invoice_frequency')
  form.children.push(nativeField('invoice-frequency', 'Bi-Weekly'))
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(serialized.payload.engagement_type, 'hourly')
  assert.equal(serialized.payload.hourly_billing_frequency, 'weekly')
  assert.equal(serialized.payload.invoice_frequency, 'bi_weekly')
})

test('fails closed if the standard-contract Designer field is missing', () => {
  const form = projectForm()
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'invoice_frequency')
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(Object.prototype.hasOwnProperty.call(serialized.payload, 'invoice_frequency'), false)
  assert.equal(api.validationError(serialized), 'Choose an invoice frequency.')
})

test('uses hours-cap language when the hourly cap period is missing', () => {
  const form = projectForm({ engagement_type: 'Ongoing Hourly', hourly_rate: '100', hourly_billing_frequency: '' })
  const { api } = load({ form })
  assert.equal(api.validationError(api.serialize(form)), 'Choose an hours cap period.')
})

test('supports every authored pricing mode and keeps only its applicable commercial fields', async (t) => {
  const cases = [
    {
      name: 'Flat Fee',
      values: { engagement_type: 'Flat Fee', total_cost: '$5,000' },
      expected: { engagement_type: 'flat_fee', total_cost: 5000 },
      cleared: ['hourly_rate', 'weekly_rate', 'monthly_rate'],
    },
    {
      name: 'Ongoing Hourly with one-time cap',
      values: { engagement_type: 'Ongoing Hourly', hourly_rate: '150', hourly_billing_frequency: 'One Time', maximum_total_hours: '40' },
      expected: { engagement_type: 'hourly', hourly_rate: 150, hourly_billing_frequency: 'one_time', maximum_total_hours: 40 },
      cleared: ['maximum_hours_per_week', 'maximum_hours_per_month', 'total_cost'],
    },
    {
      name: 'Ongoing Hourly with weekly cap',
      values: { engagement_type: 'Ongoing Hourly', hourly_rate: '150', hourly_billing_frequency: 'Weekly', maximum_hours_per_week: '20' },
      expected: { engagement_type: 'hourly', hourly_rate: 150, hourly_billing_frequency: 'weekly', maximum_hours_per_week: 20 },
      cleared: ['maximum_total_hours', 'maximum_hours_per_month', 'total_cost'],
    },
    {
      name: 'Ongoing Hourly with monthly cap',
      values: { engagement_type: 'Ongoing Hourly', hourly_rate: '150', hourly_billing_frequency: 'Monthly', maximum_hours_per_month: '80' },
      expected: { engagement_type: 'hourly', hourly_rate: 150, hourly_billing_frequency: 'monthly', maximum_hours_per_month: 80 },
      cleared: ['maximum_total_hours', 'maximum_hours_per_week', 'total_cost'],
    },
    {
      name: 'Weekly',
      values: { engagement_type: 'Weekly Recurring', weekly_rate: '$1,250', number_of_weeks: '8' },
      expected: { engagement_type: 'weekly', weekly_rate: 1250, number_of_weeks: 8 },
      cleared: ['total_cost', 'hourly_rate', 'monthly_rate'],
    },
    {
      name: 'Monthly',
      values: { engagement_type: 'Monthly Recurring', monthly_rate: '$4,500', number_of_months: '6' },
      expected: { engagement_type: 'monthly', monthly_rate: 4500, number_of_months: 6 },
      cleared: ['total_cost', 'hourly_rate', 'weekly_rate'],
    },
  ]

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const form = projectForm(scenario.values)
      const { api } = load({ form })
      const serialized = api.serialize(form)
      assert.equal(api.validationError(serialized), '')
      for (const [name, value] of Object.entries(scenario.expected)) {
        assert.equal(serialized.payload[name], value, name)
      }
      for (const name of scenario.cleared) assert.equal(serialized.payload[name], null, name)
    })
  }
})

test('serializes all 11 PandaDoc contract outcomes into the canonical Xano input contract', async (t) => {
  const cases = [
    { id: 'PD-V3-01', values: { engagement_type: 'Flat Fee', total_cost: '5000', estimated_end_date: '2026-10-15' }, expected: { engagement_type: 'flat_fee', estimated_end_date: '2026-10-15' } },
    { id: 'PD-V3-02', values: { engagement_type: 'Ongoing Hourly', hourly_billing_frequency: 'Weekly', hourly_rate: '150', maximum_hours_per_week: '20', estimated_end_date: '2026-10-15' }, expected: { engagement_type: 'hourly', hourly_billing_frequency: 'weekly', estimated_end_date: '2026-10-15' } },
    { id: 'PD-V3-03', values: { engagement_type: 'Ongoing Hourly', hourly_billing_frequency: 'Monthly', hourly_rate: '150', maximum_hours_per_month: '80', estimated_end_date: '2026-10-15' }, expected: { engagement_type: 'hourly', hourly_billing_frequency: 'monthly', estimated_end_date: '2026-10-15' } },
    { id: 'PD-V3-04', values: { engagement_type: 'Ongoing Hourly', hourly_billing_frequency: 'Weekly', hourly_rate: '150', maximum_hours_per_week: '20', estimated_end_date: '' }, expected: { engagement_type: 'hourly', hourly_billing_frequency: 'weekly', estimated_end_date: null } },
    { id: 'PD-V3-05', values: { engagement_type: 'Ongoing Hourly', hourly_billing_frequency: 'Monthly', hourly_rate: '150', maximum_hours_per_month: '80', estimated_end_date: '' }, expected: { engagement_type: 'hourly', hourly_billing_frequency: 'monthly', estimated_end_date: null } },
    { id: 'PD-V3-06', values: { engagement_type: 'Ongoing Hourly', hourly_billing_frequency: 'One Time', hourly_rate: '150', maximum_total_hours: '40', estimated_end_date: '2026-10-15' }, expected: { engagement_type: 'hourly', hourly_billing_frequency: 'one_time', estimated_end_date: '2026-10-15' } },
    { id: 'PD-V3-07', values: { engagement_type: 'Ongoing Hourly', hourly_billing_frequency: 'One Time', hourly_rate: '150', maximum_total_hours: '40', estimated_end_date: '' }, expected: { engagement_type: 'hourly', hourly_billing_frequency: 'one_time', estimated_end_date: null } },
    { id: 'PD-V3-08', values: { engagement_type: 'Monthly Recurring', monthly_rate: '4500', number_of_months: '6', estimated_end_date: '2026-12-31' }, expected: { engagement_type: 'monthly', number_of_months: 6, estimated_end_date: null } },
    { id: 'PD-V3-09', values: { engagement_type: 'Monthly Recurring', monthly_rate: '4500', number_of_months: '', estimated_end_date: '2026-12-31' }, expected: { engagement_type: 'monthly', number_of_months: null, estimated_end_date: null } },
    { id: 'PD-V3-10', values: { engagement_type: 'Weekly Recurring', weekly_rate: '1250', number_of_weeks: '8', estimated_end_date: '2026-12-31' }, expected: { engagement_type: 'weekly', number_of_weeks: 8, estimated_end_date: null } },
    { id: 'PD-V3-11', values: { engagement_type: 'Weekly Recurring', weekly_rate: '1250', number_of_weeks: '', estimated_end_date: '2026-12-31' }, expected: { engagement_type: 'weekly', number_of_weeks: null, estimated_end_date: null } },
  ]

  for (const scenario of cases) {
    await t.test(scenario.id, () => {
      const form = projectForm(scenario.values)
      const { api } = load({ form })
      const serialized = api.serialize(form)
      assert.equal(api.validationError(serialized), '')
      for (const [name, value] of Object.entries(scenario.expected)) {
        assert.equal(serialized.payload[name], value, name)
      }
    })
  }
})

test('hides the contradictory monthly end date and serializes count as the only duration source', () => {
  const form = projectForm({
    engagement_type: 'Monthly Recurring',
    number_of_months: '6',
    estimated_end_date: '2027-03-01',
  })
  const group = new Element({ class: 'app-form_input_group' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027', { required: '' })
  monthlyEndDate.parentElement = group
  monthlyEndDate.form = form
  group.controls = [monthlyEndDate]
  group.parentElement = form
  form.monthlyEndDates = [monthlyEndDate]

  const { api } = load({ form })
  assert.equal(monthlyEndDate.value, '')
  assert.equal(monthlyEndDate.disabled, true)
  assert.equal(monthlyEndDate.required, false)
  assert.equal(monthlyEndDate.hidden, true)
  assert.equal(monthlyEndDate.style.display, 'none')
  assert.equal(monthlyEndDate.getAttribute('data-project-monthly-end-date-hidden'), 'true')
  assert.equal(group.hidden, true)
  assert.equal(group.style.display, 'none')

  const serialized = api.serialize(form)
  assert.equal(serialized.payload.number_of_months, 6)
  assert.equal(serialized.payload.estimated_end_date, null)
})

test('hides the monthly end date even without the authored input-group wrapper', () => {
  const form = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027', { required: '' })
  monthlyEndDate.form = form
  form.monthlyEndDates = [monthlyEndDate]

  load({ form })
  assert.equal(monthlyEndDate.hidden, true)
  assert.equal(monthlyEndDate.style.display, 'none')
  assert.equal(monthlyEndDate.disabled, true)
  assert.equal(monthlyEndDate.value, '')
})

test('hides an unclassed exclusive wrapper but never one holding a sibling control', () => {
  const form = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027')
  const wrapper = new Element()
  wrapper.controls = [monthlyEndDate]
  wrapper.parentElement = form
  monthlyEndDate.parentElement = wrapper
  monthlyEndDate.form = form
  form.monthlyEndDates = [monthlyEndDate]
  load({ form })
  assert.equal(wrapper.hidden, true)
  assert.equal(wrapper.style.display, 'none')

  const shared = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const sharedEndDate = nativeField('endDateInput', '03/01/2027')
  const startDate = nativeField('startDateInput', '08/20/2026')
  const row = new Element({ class: 'app-form_input_group' })
  row.controls = [startDate, sharedEndDate]
  row.parentElement = shared
  sharedEndDate.parentElement = row
  sharedEndDate.form = shared
  shared.monthlyEndDates = [sharedEndDate]
  load({ form: shared })
  assert.equal(row.hidden, false)
  assert.equal(row.style.display, '')
  assert.equal(sharedEndDate.hidden, true)
  assert.equal(startDate.hidden, false)
})

test('hides the end date caption with the control when they share a date row', () => {
  const form = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027', { id: 'Monthly-End-Date' })
  const startDate = nativeField('startDateInput', '08/20/2026', { id: 'Monthly-Start-Date' })
  const endLabel = labelElement('Monthly-End-Date')
  const startLabel = labelElement('Monthly-Start-Date')
  const row = new Element({ class: 'app-form_input_group' })
  row.controls = [startDate, monthlyEndDate]
  row.labels = [startLabel, endLabel]
  row.parentElement = form
  monthlyEndDate.parentElement = row
  monthlyEndDate.form = form
  form.labels = [startLabel, endLabel]
  form.monthlyEndDates = [monthlyEndDate]

  load({ form })
  assert.equal(monthlyEndDate.hidden, true)
  assert.equal(endLabel.hidden, true)
  assert.equal(endLabel.style.display, 'none')
  assert.equal(row.hidden, false)
  assert.equal(startDate.hidden, false)
  assert.equal(startLabel.hidden, false)
})

test('hides only the end date and its caption beside a date-picker companion input', () => {
  const form = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027', { id: 'Monthly-End-Date' })
  const companion = nativeField('endDateInput-alt', 'March 1, 2027')
  const endLabel = labelElement('Monthly-End-Date')
  const group = new Element({ class: 'app-form_input_group' })
  group.controls = [monthlyEndDate, companion]
  group.labels = [endLabel]
  group.parentElement = form
  monthlyEndDate.parentElement = group
  monthlyEndDate.form = form
  form.labels = [endLabel]
  form.monthlyEndDates = [monthlyEndDate]

  load({ form })
  assert.equal(monthlyEndDate.hidden, true)
  assert.equal(endLabel.hidden, true)
  assert.equal(group.hidden, false)
  assert.equal(group.style.display, '')
  assert.equal(companion.hidden, false)
})

test('hides the exclusive wrapper with its own caption but never a foreign caption', () => {
  const owned = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const ownedEndDate = nativeField('endDateInput', '03/01/2027', { id: 'Monthly-End-Date' })
  const ownLabel = labelElement('Monthly-End-Date')
  const ownGroup = new Element({ class: 'app-form_input_group' })
  ownGroup.controls = [ownedEndDate]
  ownGroup.labels = [ownLabel]
  ownGroup.parentElement = owned
  ownedEndDate.parentElement = ownGroup
  ownedEndDate.form = owned
  owned.labels = [ownLabel]
  owned.monthlyEndDates = [ownedEndDate]
  load({ form: owned })
  assert.equal(ownGroup.hidden, true)
  assert.equal(ownLabel.hidden, true)

  const foreign = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const foreignEndDate = nativeField('endDateInput', '03/01/2027', { id: 'Monthly-End-Date' })
  const foreignLabel = labelElement('Monthly-Number-of-Months')
  const sharedGroup = new Element({ class: 'app-form_input_group' })
  sharedGroup.controls = [foreignEndDate]
  sharedGroup.labels = [foreignLabel]
  sharedGroup.parentElement = foreign
  foreignEndDate.parentElement = sharedGroup
  foreignEndDate.form = foreign
  foreign.labels = [foreignLabel]
  foreign.monthlyEndDates = [foreignEndDate]
  load({ form: foreign })
  assert.equal(foreignEndDate.hidden, true)
  assert.equal(sharedGroup.hidden, false)
  assert.equal(foreignLabel.hidden, false)
})

test('never touches the hourly caption when both panels share the Designer end-date id', () => {
  const form = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027', { id: 'endDateInput' })
  const hourlyEndDate = nativeField('endDateInput', '10/15/2026', { id: 'endDateInput' })
  const monthlyLabel = labelElement('endDateInput')
  const hourlyLabel = labelElement('endDateInput')
  const monthlyPanel = new Element({ 'data-input-filter-item': 'Monthly Recurring' })
  const hourlyPanel = new Element({ 'data-input-filter-item': 'Ongoing Hourly' })
  monthlyPanel.controls = [monthlyEndDate]
  monthlyPanel.labels = [monthlyLabel]
  hourlyPanel.controls = [hourlyEndDate]
  hourlyPanel.labels = [hourlyLabel]
  monthlyEndDate.parentElement = monthlyPanel
  monthlyEndDate.form = form
  form.feePanels = { 'Monthly Recurring': monthlyPanel, 'Ongoing Hourly': hourlyPanel }
  form.labels = [monthlyLabel, hourlyLabel]
  form.monthlyEndDates = [monthlyEndDate]
  form.hourlyEndDates = [hourlyEndDate]

  load({ form })
  assert.equal(monthlyEndDate.hidden, true)
  assert.equal(monthlyLabel.hidden, true)
  assert.equal(monthlyPanel.hidden, false)
  assert.equal(hourlyLabel.hidden, false)
  assert.equal(hourlyLabel.style.display, '')
  assert.equal(hourlyEndDate.hidden, false)
  assert.equal(hourlyEndDate.disabled, false)
  assert.equal(hourlyEndDate.value, '10/15/2026')
})

test('never hides the conditional fee panel itself', () => {
  const form = projectForm({ engagement_type: 'Monthly Recurring', number_of_months: '6' })
  const panel = new Element({ 'data-input-filter-item': 'Monthly Recurring' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027')
  panel.controls = [monthlyEndDate]
  panel.parentElement = form
  monthlyEndDate.parentElement = panel
  monthlyEndDate.form = form
  form.monthlyEndDates = [monthlyEndDate]

  load({ form })
  assert.equal(panel.hidden, false)
  assert.equal(panel.style.display, '')
  assert.equal(monthlyEndDate.hidden, true)
})

test('duration sync and serialization resolve the selected engagement identically', () => {
  const form = projectForm({
    engagement_type: 'Ongoing Hourly',
    hourly_rate: '150',
    hourly_billing_frequency: 'Weekly',
    maximum_hours_per_week: '20',
    estimated_end_date: '2026-10-15',
  })
  // A stale native control disagreeing with the semantic attribute must not
  // send the sync and the serializer to different panels.
  form.children.push(nativeField('Fee-Structure', 'Monthly Recurring'))
  const endDate = nativeField('endDateInput', '10/15/2026')
  const ongoing = nativeField('no-end-date', 'on', { type: 'checkbox', checked: false, required: '' })
  endDate.form = form
  ongoing.form = form
  form.hourlyEndDates = [endDate]
  form.hourlyOngoingChoices = [ongoing]

  const { api } = load({ form })
  const payload = api.serialize(form).payload
  assert.equal(payload.engagement_type, 'hourly')
  assert.equal(ongoing.required, false)
  assert.equal(endDate.disabled, false)
  assert.equal(api.validationError({ payload }), '')
})

test('weekly and monthly never leak a stale conditional-panel end date', () => {
  for (const scenario of [
    { engagement_type: 'Weekly Recurring', number_of_weeks: '8', number_of_months: '' },
    { engagement_type: 'Monthly Recurring', number_of_weeks: '', number_of_months: '6' },
  ]) {
    const form = projectForm({ ...scenario, estimated_end_date: '2027-03-01' })
    const { api } = load({ form })
    assert.equal(api.serialize(form).payload.estimated_end_date, null)
  }
})

test('confirmation-step serialization scopes repeated controls to the selected fee panel', () => {
  const form = projectForm()
  form.children = form.children.filter((child) => ![
    'engagement_type',
    'start_date',
    'estimated_end_date',
    'total_cost',
    'paid_upfront_pct',
    'hourly_rate',
    'weekly_rate',
    'monthly_rate',
    'hourly_billing_frequency',
    'maximum_total_hours',
    'maximum_hours_per_week',
    'maximum_hours_per_month',
    'number_of_weeks',
    'number_of_months',
  ].includes(child.getAttribute('data-project-field')))
  form.children.push(nativeField('Fee-Structure', 'Monthly Recurring', { disabled: true }))

  const flatPanel = new Element()
  flatPanel.children = [
    nativeField('startDateInput', '08/01/2026', { disabled: true }),
    nativeField('endDateInput', '09/01/2026', { disabled: true }),
    nativeField('Amount', '9999', { disabled: true }),
    nativeField('Percent-Paid-Upfront', '50', { disabled: true }),
  ]
  const monthlyPanel = new Element()
  monthlyPanel.children = [
    nativeField('startDateInput', '08/20/2026', { disabled: true }),
    nativeField('endDateInput', '12/31/2026', { disabled: true }),
    nativeField('Amount', '4500', { disabled: true }),
    nativeField('Number-of-Months', '6', { disabled: true }),
  ]
  form.feePanels = { 'Flat Fee': flatPanel, 'Monthly Recurring': monthlyPanel }

  const { api } = load({ form })
  const payload = api.serialize(form).payload
  assert.equal(payload.engagement_type, 'monthly')
  assert.equal(payload.start_date, '2026-08-20')
  assert.equal(payload.monthly_rate, 4500)
  assert.equal(payload.number_of_months, 6)
  assert.equal(payload.estimated_end_date, null)
  assert.equal(payload.total_cost, null)
  assert.equal(payload.paid_upfront_pct, null)
})

test('fixed hourly accepts an end date without requiring the ongoing checkbox', () => {
  const form = projectForm({
    engagement_type: 'Ongoing Hourly',
    hourly_rate: '150',
    hourly_billing_frequency: 'Weekly',
    maximum_hours_per_week: '20',
    estimated_end_date: '2026-10-15',
  })
  const endDate = nativeField('endDateInput', '10/15/2026')
  const ongoing = nativeField('no-end-date', 'on', { type: 'checkbox', checked: false, required: '' })
  endDate.form = form
  ongoing.form = form
  form.hourlyEndDates = [endDate]
  form.hourlyOngoingChoices = [ongoing]

  const { api } = load({ form })
  api.syncDurationFields(form)
  assert.equal(endDate.disabled, false)
  assert.equal(ongoing.required, false)
  assert.equal(api.validationError(api.serialize(form)), '')
})

test('hourly requires the cadence-specific positive cap', () => {
  const scenarios = [
    { frequency: 'One Time', error: /maximum permitted hours for the entire project/ },
    { frequency: 'Weekly', error: /maximum permitted hours per week/ },
    { frequency: 'Monthly', error: /maximum permitted hours per month/ },
  ]
  for (const scenario of scenarios) {
    const form = projectForm({
      engagement_type: 'Ongoing Hourly',
      hourly_rate: '150',
      hourly_billing_frequency: scenario.frequency,
      maximum_total_hours: '',
      maximum_hours_per_week: '',
      maximum_hours_per_month: '',
    })
    const { api } = load({ form })
    assert.match(api.validationError(api.serialize(form)), scenario.error)
  }
})

test('Hours Cap Period shows and enables only its matching maximum-hours field', () => {
  const form = projectForm({ engagement_type: 'Ongoing Hourly' })
  const panel = new Element({ 'data-input-filter-item': 'hourly' })
  const frequency = nativeField('Frequency', 'Per month', { tagName: 'SELECT' })
  const controls = [
    nativeField('Maximum-Hours-Billed', '40', { id: 'max-total', required: '' }),
    nativeField('Maximum-Hours-Billed-per-Week', '20', { id: 'max-week', required: '' }),
    nativeField('Maximum-Hours-Billed-per-Month', '80', { id: 'max-month', required: '' }),
  ]
  const labels = controls.map((control) => labelElement(control.getAttribute('id')))

  controls.forEach((control, index) => {
    const group = new Element({ class: 'app-form_input_group' })
    group.controls = [control]
    group.labels = [labels[index]]
    group.parentElement = panel
    control.parentElement = group
    control.form = form
    control.group = group
  })
  frequency.form = form
  panel.children = [frequency, ...controls]
  panel.labels = labels
  panel.parentElement = form
  form.feePanels = { hourly: panel }

  const { api } = load({ form })
  api.syncDurationFields(form)

  assert.equal(controls[0].hidden, true)
  assert.equal(controls[0].disabled, true)
  assert.equal(controls[1].hidden, true)
  assert.equal(controls[1].disabled, true)
  assert.equal(controls[2].hidden, false)
  assert.equal(controls[2].disabled, false)
  assert.equal(controls[2].group.hidden, false)
  assert.equal(labels[2].hidden, false)
  assert.equal(frequency.value, 'Per month')

  assert.equal(controls[0].getAttribute('required'), null)
  assert.equal(controls[1].getAttribute('required'), null)
  assert.equal(controls[2].getAttribute('required'), '')
})

test('Hours Cap Period hides every maximum-hours field outside Hourly without clearing values', () => {
  const form = projectForm({ engagement_type: 'Weekly Recurring' })
  const panel = new Element({ 'data-input-filter-item': 'hourly' })
  const frequency = nativeField('Frequency', 'Per week', { tagName: 'SELECT' })
  const weekly = nativeField('Maximum-Hours-Billed-per-Week', '20', { id: 'max-week' })
  const group = new Element({ class: 'app-form_input_group' })
  group.controls = [weekly]
  weekly.parentElement = group
  weekly.form = form
  group.parentElement = panel
  panel.children = [frequency, weekly]
  panel.parentElement = form
  form.feePanels = { hourly: panel }

  const { api } = load({ form })
  api.syncHoursCapFields(form)

  assert.equal(weekly.hidden, true)
  assert.equal(weekly.disabled, true)
  assert.equal(weekly.value, '20')
  assert.equal(frequency.value, 'Per week')
})

test('top-level fee panel lookup ignores nested Hours Cap Period items with the same value', () => {
  const form = projectForm({ engagement_type: 'Weekly Recurring', weekly_rate: '' })
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'weekly_rate')
  const hourly = new Element({ 'data-input-filter-item': 'hourly' })
  const nestedWeekly = new Element({ 'data-input-filter-item': 'weekly' })
  const weekly = new Element({ 'data-input-filter-item': 'weekly' })
  nestedWeekly.parentElement = hourly
  hourly.parentElement = form
  weekly.parentElement = form
  nestedWeekly.children = [nativeField('Amount', '999')]
  weekly.children = [nativeField('Amount', '1250')]
  form.filterItems = { weekly: [nestedWeekly, weekly] }

  const { api } = load({ form })
  assert.equal(api.serialize(form).payload.weekly_rate, 1250)
})

test('standard flat fee requires a future end date before calling Xano', () => {
  const missing = projectForm({ engagement_type: 'Flat Fee', total_cost: '5000', estimated_end_date: '' })
  const invalid = projectForm({ engagement_type: 'Flat Fee', total_cost: '5000', start_date: '2026-08-20', estimated_end_date: '2026-08-19' })
  const missingApi = load({ form: missing }).api
  const invalidApi = load({ form: invalid }).api
  assert.match(missingApi.validationError(missingApi.serialize(missing)), /estimated end date/)
  assert.match(invalidApi.validationError(invalidApi.serialize(invalid)), /must be after/)
})

test('keeps pricing separate from the authored own-contract choice', () => {
  const form = projectForm({ engagement_type: 'Weekly Recurring' })
  form.contractChoice = new Element({ 'data-project-contract-choice': '', value: 'My own contract' })
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(serialized.payload.engagement_type, 'weekly')
  assert.equal(serialized.payload.contract_type, 'own_contract')
  assert.equal(Object.prototype.hasOwnProperty.call(serialized.payload, 'invoice_frequency'), false)
  assert.equal(api.validationError(serialized), '')
})

test('shows and requires invoice frequency for the generated standard contract', () => {
  const form = projectForm({ invoice_frequency: 'bi_weekly' })
  const invoice = form.querySelector('[data-project-field="invoice_frequency"]')
  const { api } = load({ form })
  api.syncInvoiceFrequencyField(form)
  assert.equal(invoice.hidden, false)
  assert.equal(invoice.disabled, false)
  assert.equal(invoice.required, true)
  assert.equal(invoice.getAttribute('required'), '')
  assert.equal(api.serialize(form).payload.invoice_frequency, 'bi_weekly')
})

test('hides and disables invoice frequency for an own contract, then restores it', () => {
  const form = projectForm({ invoice_frequency: 'bi_weekly' })
  const invoice = form.querySelector('[data-project-field="invoice_frequency"]')
  form.contractChoice = new Element({ 'data-project-contract-choice': '', type: 'radio', value: 'Own Contract', checked: true })
  const { api } = load({ form })

  api.syncInvoiceFrequencyField(form)
  assert.equal(invoice.hidden, true)
  assert.equal(invoice.disabled, true)
  assert.equal(invoice.required, false)
  assert.equal(invoice.getAttribute('data-project-invoice-frequency-hidden'), 'true')
  assert.equal(Object.prototype.hasOwnProperty.call(api.serialize(form).payload, 'invoice_frequency'), false)

  form.contractChoice.value = 'Standard contract'
  api.syncInvoiceFrequencyField(form)
  assert.equal(invoice.hidden, false)
  assert.equal(invoice.disabled, false)
  assert.equal(invoice.required, true)
  assert.equal(invoice.getAttribute('data-project-invoice-frequency-hidden'), null)
  assert.equal(api.serialize(form).payload.invoice_frequency, 'bi_weekly')
})

test('hides the invoice-frequency group and caption for an own contract, then shows both again', () => {
  const form = projectForm({ invoice_frequency: 'bi_weekly' })
  const invoice = form.querySelector('[data-project-field="invoice_frequency"]')
  invoice.setAttribute('id', 'Invoice-Frequency')
  invoice.form = form
  const caption = labelElement('Invoice-Frequency')
  const group = new Element({ class: 'app-form_input_group' })
  group.controls = [invoice]
  group.labels = [caption]
  group.parentElement = form
  invoice.parentElement = group
  form.labels = [caption]
  form.contractChoice = new Element({ 'data-project-contract-choice': '', type: 'radio', value: 'Own Contract', checked: true })

  const { api } = load({ form })
  api.syncInvoiceFrequencyField(form)
  assert.equal(invoice.hidden, true)
  assert.equal(caption.hidden, true)
  assert.equal(caption.style.display, 'none')
  assert.equal(group.hidden, true)
  assert.equal(group.style.display, 'none')

  form.contractChoice.value = 'Standard contract'
  api.syncInvoiceFrequencyField(form)
  assert.equal(invoice.hidden, false)
  assert.equal(invoice.style.display, '')
  assert.equal(caption.hidden, false)
  assert.equal(caption.style.display, '')
  assert.equal(group.hidden, false)
  assert.equal(group.style.display, '')
  assert.equal(api.serialize(form).payload.invoice_frequency, 'bi_weekly')
})

test('never hides or reveals a shared row holding another invoice-step control', () => {
  const form = projectForm({ invoice_frequency: 'bi_weekly' })
  const invoice = form.querySelector('[data-project-field="invoice_frequency"]')
  invoice.setAttribute('id', 'Invoice-Frequency')
  invoice.form = form
  const sibling = nativeField('Project-Scope', 'Build and optimize the retention program.')
  const row = new Element({ class: 'app-form_input_group' })
  row.controls = [sibling, invoice]
  row.parentElement = form
  invoice.parentElement = row
  row.hidden = true
  row.style.display = 'none'
  form.contractChoice = new Element({ 'data-project-contract-choice': '', type: 'radio', value: 'Own Contract', checked: true })

  const { api } = load({ form })
  api.syncInvoiceFrequencyField(form)
  assert.equal(invoice.hidden, true)
  assert.equal(sibling.hidden, false)
  assert.equal(row.hidden, true)

  form.contractChoice.value = 'Standard contract'
  api.syncInvoiceFrequencyField(form)
  assert.equal(invoice.hidden, false)
  assert.equal(row.hidden, true)
  assert.equal(row.style.display, 'none')
})

test('resolves the native invoice-frequency control whatever the Designer label casing', () => {
  const form = projectForm()
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'invoice_frequency')
  form.children.push(nativeField('Invoice-frequency', 'Upon completion of the project'))
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(serialized.payload.invoice_frequency, 'upon_completion')
  assert.equal(api.validationError(serialized), '')
})

test('fails closed when a standard contract has no invoice frequency', () => {
  const form = projectForm({ invoice_frequency: '' })
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(api.validationError(serialized), 'Choose an invoice frequency.')
})

function requiredConfirmation(form, { visible, name = 'conditional-confirmation' }) {
  const confirmation = nativeField(name, '', { type: 'checkbox', checked: false, required: '' })
  confirmation.form = form
  confirmation.offsetParent = visible ? {} : null
  form.children.push(confirmation)
  return confirmation
}

test('shows the own-contract affirmation only for Own Contract and clears stale Standard state', () => {
  const form = projectForm()
  const confirmation = requiredConfirmation(form, { visible: true, name: 'confirm-contract' })
  const checkedClasses = new Set(['w--redirected-checked'])
  const checkbox = { classList: { remove: (name) => checkedClasses.delete(name) } }
  const wrapper = new Element({ class: 'w-checkbox' })
  wrapper.controls = [confirmation]
  wrapper.querySelector = (selector) => selector === '.w-checkbox-input' ? checkbox : null
  confirmation.parentElement = wrapper
  confirmation.checked = true
  const { api } = load({ form })

  assert.equal(confirmation.checked, false)
  assert.deepEqual(confirmation.events, ['click'])
  assert.equal(checkedClasses.has('w--redirected-checked'), false)
  assert.equal(confirmation.hidden, true)
  assert.equal(confirmation.disabled, true)
  assert.equal(confirmation.required, false)
  assert.equal(confirmation.getAttribute('required'), null)
  assert.equal(confirmation.getAttribute('data-project-own-contract-confirmation-hidden'), 'true')

  form.contractChoice.value = 'My own contract'
  api.syncDurationFields(form)
  assert.equal(confirmation.checked, false)
  assert.equal(confirmation.hidden, false)
  assert.equal(confirmation.disabled, false)
  assert.equal(confirmation.required, true)
  assert.equal(confirmation.getAttribute('required'), '')
  assert.equal(confirmation.getAttribute('data-project-own-contract-confirmation-hidden'), null)

  confirmation.checked = true
  form.contractChoice.value = 'Standard contract'
  api.syncDurationFields(form)
  assert.equal(confirmation.checked, false)
  assert.equal(confirmation.hidden, true)
  assert.equal(confirmation.disabled, true)
  assert.equal(confirmation.getAttribute('required'), null)
})

test('hides the rendered Own Contract label on Standard without changing fee panels', () => {
  const form = projectForm()
  const confirmation = requiredConfirmation(form, { visible: true, name: 'confirm-contract' })
  const affirmationText = new Element({
    class: 'modal-form_checkbox-text w-form-label',
    for: 'confirm-contract',
    tagName: 'SPAN',
  })
  affirmationText.textContent = 'I confirm we will have an executed contract prior to the start date'
  const owner = new Element({
    'data-input-filter-item': 'My own contract',
    class: 'w-checkbox modal-form_checkbox-field',
    tagName: 'LABEL',
  })
  owner.controls = [confirmation]
  owner.children = [confirmation, affirmationText]
  owner.parentElement = form
  confirmation.parentElement = owner
  affirmationText.parentElement = owner

  const unrelatedFeePanel = new Element({ 'data-input-filter-item': 'Flat Fee', tagName: 'DIV' })
  unrelatedFeePanel.parentElement = form
  form.feePanels = { 'Flat Fee': unrelatedFeePanel }

  const { api } = load({ form })
  assert.equal(confirmation.hidden, true)
  assert.equal(owner.hidden, true)
  assert.equal(owner.style.display, 'none')
  assert.equal(owner.getAttribute('aria-hidden'), 'true')
  assert.equal(unrelatedFeePanel.hidden, false)
  assert.equal(unrelatedFeePanel.style.display, '')

  form.contractChoice.value = 'My own contract'
  api.syncDurationFields(form)
  assert.equal(confirmation.hidden, false)
  assert.equal(owner.hidden, false)
  assert.equal(owner.style.display, '')
  assert.equal(owner.getAttribute('aria-hidden'), null)
  assert.equal(unrelatedFeePanel.hidden, false)
  assert.equal(unrelatedFeePanel.style.display, '')
})

test('drops required from hidden conditional controls so native validation cannot block submit', async () => {
  const form = projectForm()
  const hiddenConfirmation = requiredConfirmation(form, { visible: false })
  form.reportValidityImpl = () => hiddenConfirmation.getAttribute('required') === null
  const { api, calls, document, window } = load({ form })
  assert.equal(await api.submit(form, window, document), true)
  assert.equal(hiddenConfirmation.getAttribute('required'), null)
  assert.equal(hiddenConfirmation.required, false)
  assert.equal(hiddenConfirmation.disabled, false)
  assert.equal(calls.filter((call) => call && call.starter_memberstack_id).length, 1)
})

test('clears hidden required state on click, before the browser validates the submit', () => {
  const form = projectForm()
  const hiddenConfirmation = requiredConfirmation(form, { visible: false })
  const visibleName = nativeField('Project-Name', 'Launch project', { required: '' })
  visibleName.form = form
  visibleName.offsetParent = {}
  form.children.push(visibleName)
  const { document } = load({ form })
  const submitter = new Element({ type: 'submit' })
  submitter.form = form
  document.listeners.click.handler({ target: submitter })
  assert.equal(hiddenConfirmation.getAttribute('required'), null)
  assert.equal(hiddenConfirmation.getAttribute('data-project-required-hidden'), 'true')
  assert.equal(visibleName.getAttribute('required'), '')
})

test('restores the authored required attribute when its branch becomes visible again', () => {
  const form = projectForm()
  const confirmation = requiredConfirmation(form, { visible: false })
  const { api, document } = load({ form })
  document.listeners.change.handler({ target: confirmation })
  assert.equal(confirmation.getAttribute('required'), null)
  confirmation.offsetParent = {}
  api.syncActiveRequired(form)
  assert.equal(confirmation.getAttribute('required'), '')
  assert.equal(confirmation.required, true)
  assert.equal(confirmation.getAttribute('data-project-required-hidden'), null)
})

test('keeps visible required controls in native validation', async () => {
  const form = projectForm()
  const visibleConfirmation = requiredConfirmation(form, { visible: true })
  form.reportValidityImpl = () => visibleConfirmation.getAttribute('required') === null
  const { api, calls, document, window } = load({ form })
  assert.equal(await api.submit(form, window, document), false)
  assert.equal(visibleConfirmation.getAttribute('required'), '')
  assert.equal(visibleConfirmation.disabled, false)
  assert.equal(calls.length, 0)
})

test('binds the existing Hire trigger when the selected Starter identity is present', () => {
  const form = projectForm()
  const { api, document, trackCalls, window } = load({ form })
  const trigger = new Element({ 'data-modal-trigger': 'generate-contract' })
  assert.equal(api.bindTrigger(trigger, document, window), true)
  assert.equal(form.getAttribute('data-project-form-status'), 'ready')
  assert.equal(trackCalls.some((entry) => entry.name === 'project_form_opened'), true)
})

test('binds only the clicked Starter modal when duplicate Contract Generation instances are open', () => {
  const first = projectForm({ starter_memberstack_id: '' })
  const second = projectForm({ starter_memberstack_id: '' })
  first.contractChoice.value = 'My own contract'
  second.contractChoice.value = 'Standard contract'

  const firstConfirmation = requiredConfirmation(first, { visible: true, name: 'confirm-contract' })
  const secondConfirmation = requiredConfirmation(second, { visible: true, name: 'confirm-contract' })
  firstConfirmation.checked = true
  secondConfirmation.checked = true

  function modalFixture(form, starterId) {
    const modal = new Element({ 'data-modal-target': 'generate-contract', tagName: 'DIALOG' })
    const owner = new Element({
      'data-input-filter-item': 'My own contract',
      class: 'w-checkbox modal-form_checkbox-field',
      tagName: 'LABEL',
    })
    const confirmation = form === first ? firstConfirmation : secondConfirmation
    owner.controls = [confirmation]
    owner.parentElement = form
    confirmation.parentElement = owner
    modal.form = form
    modal.selectedStarter = new Element({ id: 'pushMemID', value: starterId })
    form.parentElement = modal
    modal.querySelector = (selector) => {
      if (selector === '#pushMemID') return modal.selectedStarter
      if (selector.includes('[data-project-form-v3="brand"] form')) return form
      return null
    }
    modal.querySelectorAll = (selector) => selector.includes('[data-project-form-v3="brand"] form') ? [form] : []
    return modal
  }

  const firstModal = modalFixture(first, 'mem_wrong_starter')
  const secondModal = modalFixture(second, 'mem_selected_starter')
  const firstTrigger = new Element({ 'data-modal-trigger': 'generate-contract' })
  const secondTrigger = new Element({ 'data-modal-trigger': 'generate-contract' })
  firstTrigger.parentElement = firstModal
  secondTrigger.parentElement = secondModal

  const document = documentFixture(first)
  document.querySelector = (selector) => {
    if (selector === 'dialog[data-modal-target="generate-contract"] #pushMemID') return firstModal.selectedStarter
    return selector.includes('[data-project-form-v3="brand"] form') ? first : null
  }
  document.querySelectorAll = (selector) => selector.includes('[data-project-form-v3="brand"] form') ? [first, second] : []
  const { api } = load({ form: first, document })

  assert.equal(api.bindTrigger(secondTrigger, document), true)
  assert.equal(first.getAttribute('data-project-form-status'), null)
  assert.equal(firstConfirmation.checked, true)
  assert.equal(firstConfirmation.hidden, false)
  assert.equal(firstConfirmation.disabled, false)
  assert.equal(second.getAttribute('data-project-form-status'), 'ready')
  assert.equal(secondConfirmation.checked, false)
  assert.equal(secondConfirmation.hidden, true)
  assert.equal(secondConfirmation.disabled, true)
  assert.equal(api.serialize(second, document).payload.starter_memberstack_id, 'mem_selected_starter')
})

test('fails closed when the Hire form has no selected Starter identity', async () => {
  const form = projectForm({ starter_memberstack_id: '' })
  const { api, document, window } = load({ form, reject: 403 })
  const trigger = new Element({ 'data-modal-trigger': 'generate-contract' })
  assert.equal(api.bindTrigger(trigger, document), false)
  assert.equal(form.querySelector('[data-project-field="idempotency_key"]').value, '')
  assert.equal(await api.submit(form, window, document), false)
})

test('submits once through Opp30 auth, keeps the retry key, and emits safe success state', async () => {
  const { api, calls, document, form, window } = load()
  form.wrapper = new Element()
  form.wrapper.success = new Element()
  form.wrapper.success.legacySuccessTitle = new Element()
  form.wrapper.success.legacySuccessMessage = new Element()
  const first = api.submit(form, window, document)
  const duplicate = api.submit(form, window, document)
  assert.equal(first, duplicate)
  assert.equal(await first, true)
  assert.equal(calls.filter((call) => call && call.starter_memberstack_id === 'mem_starter_123').length, 1)
  assert.equal(calls[0].idempotency_key, 'direct-hire-ui:uuid-123')
  assert.equal(form.querySelector('[data-project-field="idempotency_key"]').value, '')
  assert.equal(form.getAttribute('data-project-form-status'), 'success')
  assert.equal(form.style.display, 'none')
  assert.equal(form.wrapper.success.style.display, 'block')
  assert.equal(form.wrapper.success.legacySuccessTitle.textContent, 'Project successfully created')
  assert.equal(form.wrapper.success.legacySuccessMessage.textContent, 'Your contract is queued for generation. You will receive a signing email after processing succeeds.')
  assert.equal(form.wrapper.success.legacySuccessMessage.getAttribute('data-project-diagnostic-copy'), null)
  assert.equal(document.event.type, 'starters:project-created')
  assert.equal(document.event.detail.project_id, 669)
  assert.equal(document.event.detail.replayed, false)
})

test('does not promise PandaDoc generation or email for an own-contract project', async () => {
  const form = projectForm()
  form.contractChoice.value = 'My own contract'
  form.wrapper = new Element()
  form.wrapper.success = new Element()
  form.wrapper.success.successTitle = new Element()
  form.wrapper.success.successMessage = new Element()
  const { api, document, window } = load({ form })

  assert.equal(await api.submit(form, window, document), true)
  assert.equal(form.wrapper.success.successTitle.textContent, 'Project successfully created')
  assert.equal(form.wrapper.success.successMessage.textContent, 'You can manage this project from your dashboard.')
  assert.equal(form.wrapper.success.successMessage.getAttribute('data-project-diagnostic-copy'), null)
})

test('uses the authored external Starter identity and internal retry state without new inputs', async () => {
  const form = projectForm()
  form.children = form.children.filter((child) => !['starter_memberstack_id', 'idempotency_key'].includes(child.getAttribute('data-project-field')))
  const selectedStarter = new Element({ value: 'mem_starter_external' })
  const document = documentFixture(form)
  const originalQuerySelector = document.querySelector
  document.querySelector = (selector) => selector === 'dialog[data-modal-target="generate-contract"] #pushMemID'
    ? selectedStarter
    : originalQuerySelector(selector)
  const { api, calls, window } = load({ form, document })
  assert.equal(await api.submit(form, window, document), true)
  assert.equal(calls[0].starter_memberstack_id, 'mem_starter_external')
  assert.equal(calls[0].idempotency_key, 'direct-hire-ui:uuid-123')
})

test('serializes the existing named Webflow controls without per-field attributes', () => {
  const form = projectForm()
  form.children = [
    nativeField('Project-Name', 'Native project'),
    nativeField('Services', 'Paid Social'),
    nativeField('fee-structure', 'Ongoing Hourly'),
    nativeField('startDateInput', '08/25/2026'),
    nativeField('endDateInput', '12/31/2026'),
    nativeField('Amount', '$175'),
    nativeField('Frequency', 'Weekly'),
    nativeField('Maximum-Hours-Billed-per-Week', '20'),
    nativeField('Project-Scope', 'Run the paid social program.'),
  ]
  form.contractChoice = new Element({ type: 'radio', value: 'Standard contract', checked: true })
  const { api, document } = load({ form })
  const payload = api.serialize(form, document).payload
  assert.equal(payload.title, 'Native project')
  assert.equal(payload.service, 'Paid Social')
  assert.equal(payload.engagement_type, 'hourly')
  assert.equal(payload.start_date, '2026-08-25')
  assert.equal(payload.hourly_rate, 175)
  assert.equal(payload.hourly_billing_frequency, 'weekly')
  assert.equal(payload.maximum_hours_per_week, 20)
  assert.equal(payload.contract_type, 'standard')
})

test('resolves canonical fee-panel attributes before legacy transition labels', () => {
  const form = projectForm({
    engagement_type: 'monthly',
    monthly_rate: '',
    number_of_months: '',
  })
  const canonicalPanel = new Element({ 'data-input-filter-item': 'monthly' })
  canonicalPanel.children = [
    nativeField('Amount', '$2,400'),
    nativeField('Number-of-Months', '6'),
  ]
  form.children = form.children.filter((child) => !['monthly_rate', 'number_of_months'].includes(child.getAttribute('data-project-field')))
  form.feePanels = { monthly: canonicalPanel }

  const { api } = load({ form })
  const payload = api.serialize(form).payload
  assert.equal(payload.engagement_type, 'monthly')
  assert.equal(payload.monthly_rate, 2400)
  assert.equal(payload.number_of_months, 6)
})

test('syncs canonical hourly filter-item duration controls', () => {
  const form = projectForm({ engagement_type: 'hourly' })
  const endDate = nativeField('endDateInput', '10/15/2026')
  const ongoing = nativeField('no-end-date', 'true', { type: 'checkbox', checked: true })
  form.hourlyEndDates = [endDate]
  form.hourlyOngoingChoices = [ongoing]

  load({ form })
  assert.equal(endDate.value, '')
  assert.equal(endDate.disabled, true)
})

test('still syncs hourly duration controls behind the legacy transition label', () => {
  const form = projectForm({ engagement_type: 'hourly' })
  const endDate = nativeField('endDateInput', '10/15/2026')
  const ongoing = nativeField('no-end-date', 'true', { type: 'checkbox', checked: true })
  form.panelControls = {
    'Ongoing Hourly': { endDateInput: [endDate], 'no-end-date': [ongoing] },
  }

  load({ form })
  assert.equal(endDate.value, '')
  assert.equal(endDate.disabled, true)
})

test('still clears the monthly end date behind the legacy transition label', () => {
  const form = projectForm({ engagement_type: 'monthly', number_of_months: '6' })
  const monthlyEndDate = nativeField('endDateInput', '03/01/2027')
  monthlyEndDate.form = form
  form.panelControls = { 'Monthly Recurring': { endDateInput: [monthlyEndDate] } }

  load({ form })
  assert.equal(monthlyEndDate.value, '')
  assert.equal(monthlyEndDate.disabled, true)
  assert.equal(monthlyEndDate.hidden, true)
})

test('hourly duration controls prefer the canonical panel over a legacy one', () => {
  const form = projectForm({ engagement_type: 'hourly' })
  const canonicalEndDate = nativeField('endDateInput', '10/15/2026')
  const canonicalOngoing = nativeField('no-end-date', 'true', { type: 'checkbox', checked: true })
  const legacyEndDate = nativeField('endDateInput', '11/20/2026')
  const legacyOngoing = nativeField('no-end-date', 'true', { type: 'checkbox', checked: true })
  // Mid-cutover markup carrying both grammars. The serializer reads the
  // canonical panel, so the duration sync must clear that same control.
  form.panelControls = {
    hourly: { endDateInput: [canonicalEndDate], 'no-end-date': [canonicalOngoing] },
    'Ongoing Hourly': { endDateInput: [legacyEndDate], 'no-end-date': [legacyOngoing] },
  }

  load({ form })
  assert.equal(canonicalEndDate.value, '')
  assert.equal(canonicalEndDate.disabled, true)
  assert.equal(legacyEndDate.value, '11/20/2026')
  assert.equal(legacyEndDate.disabled, false)
})

test('smart-fill matches a fee-structure preset across the value grammars', () => {
  const legacyOption = () => nativeField('Fee-Structure', '', {
    tagName: 'SELECT',
    options: [
      { value: '', textContent: 'Select one...' },
      { value: 'Flat Fee', textContent: 'Flat Fee' },
      { value: 'Ongoing Hourly', textContent: 'Ongoing Hourly' },
    ],
  })
  const canonicalOption = () => nativeField('Fee-Structure', '', {
    tagName: 'SELECT',
    options: [
      { value: '', textContent: 'Select one...' },
      { value: 'flat_fee', textContent: 'Flat Fee' },
      { value: 'hourly', textContent: 'Ongoing Hourly' },
    ],
  })
  const scenarios = [
    { select: legacyOption(), preset: 'flat_fee', expected: 'Flat Fee' },
    { select: legacyOption(), preset: 'hourly', expected: 'Ongoing Hourly' },
    { select: canonicalOption(), preset: 'Ongoing Hourly', expected: 'hourly' },
    { select: canonicalOption(), preset: 'Flat Fee', expected: 'flat_fee' },
  ]
  for (const scenario of scenarios) {
    const form = projectForm()
    form.children.push(scenario.select)
    const document = documentFixture(form)
    const { api } = load({ form, document })

    assert.equal(api.applySmartFill(document, 'fee_structure', scenario.preset), true)
    assert.equal(scenario.select.value, scenario.expected)
  }
})

test('smart-fill matches a canonical invoice-frequency preset against legacy option text', () => {
  const form = projectForm()
  form.children = form.children.filter((child) => child.getAttribute('data-project-field') !== 'invoice_frequency')
  const invoice = nativeField('invoice-frequency', '', {
    tagName: 'SELECT',
    options: [
      { value: '', textContent: 'Select one...' },
      { value: 'Bi-Weekly', textContent: 'Bi-Weekly' },
      { value: 'Upon completion of the project', textContent: 'Upon completion of the project' },
    ],
  })
  form.children.push(invoice)
  const document = documentFixture(form)
  const { api } = load({ form, document })

  assert.equal(api.applySmartFill(document, 'invoice_frequency', 'upon_completion'), true)
  assert.equal(invoice.value, 'Upon completion of the project')
})

test('smart-fill canonicalizes a fee-structure preset for a radio group', () => {
  const form = projectForm()
  const flat = nativeField('Fee-Structure', 'Flat Fee', { type: 'radio', checked: false })
  const hourly = nativeField('Fee-Structure', 'Ongoing Hourly', { type: 'radio', checked: true })
  form.children.push(flat, hourly)
  const document = documentFixture(form)
  const { api } = load({ form, document })

  assert.equal(api.applySmartFill(document, 'fee_structure', 'flat_fee'), true)
  assert.equal(flat.checked, true)
})

test('smart-fill leaves an unrelated category ungrammatical', () => {
  const form = projectForm()
  const service = nativeField('Services', '', {
    tagName: 'SELECT',
    options: [
      { value: '', textContent: 'Select one...' },
      { value: 'Email Marketing', textContent: 'Email Marketing' },
    ],
    'data-sp-fill': 'input',
    'data-sp-fill-category': 'service',
  })
  form.children.push(service)
  const document = documentFixture(form)
  document.querySelectorAll = (selector) => selector.includes('[data-sp-fill="input"]') ? [service] : []
  const { api } = load({ form, document })

  assert.equal(api.applySmartFill(document, 'service', 'email_marketing'), false)
  assert.equal(service.value, '')
})

test('serializes disabled authored controls from the confirmation step', () => {
  const form = projectForm()
  form.children = [
    field('starter_memberstack_id', 'mem_starter_123', { disabled: true }),
    nativeField('Project-Name', 'Confirmed project', { disabled: true }),
    nativeField('Services', 'Paid Social', { disabled: true }),
    nativeField('fee-structure', 'Weekly Recurring', { disabled: true }),
    nativeField('startDateInput', '08/25/2026', { disabled: true }),
    nativeField('Amount', '$1,250', { disabled: true }),
    nativeField('Number-of-Weeks', '8', { disabled: true }),
    nativeField('Project-Scope', 'Run the paid social program.', { disabled: true }),
  ]
  form.contractChoice = new Element({ type: 'radio', value: 'Own Contract', checked: true, disabled: true })
  const { api, document } = load({ form })
  const serialized = api.serialize(form, document)
  assert.equal(api.validationError(serialized), '')
  assert.equal(serialized.payload.title, 'Confirmed project')
  assert.equal(serialized.payload.weekly_rate, 1250)
  assert.equal(serialized.payload.contract_type, 'own_contract')
})

test('shows and resets native Webflow error and success states', async () => {
  const form = projectForm({ title: '' })
  form.error = null
  form.wrapper = new Element()
  form.wrapper.nativeError = new Element()
  form.wrapper.nativeSuccess = new Element()
  form.wrapper.nativeSuccess.hidden = false
  form.wrapper.nativeSuccess.style.display = 'block'
  const { api, document, window } = load({ form })
  assert.equal(await api.submit(form, window, document), false)
  assert.equal(form.wrapper.nativeError.hidden, false)
  assert.equal(form.wrapper.nativeError.style.display, 'block')
  form.querySelector('[data-project-field="title"]').value = 'Ready project'
  const trigger = new Element({ 'data-modal-trigger': 'generate-contract' })
  assert.equal(api.bindTrigger(trigger, document), true)
  assert.equal(form.wrapper.nativeError.hidden, true)
  assert.equal(form.wrapper.nativeError.style.display, 'none')
  assert.equal(form.wrapper.nativeSuccess.hidden, true)
  assert.equal(form.wrapper.nativeSuccess.style.display, 'none')
})

test('projects safe authorization errors without exposing raw server messages', async () => {
  const { api, form, window, document } = load({ reject: 403 })
  assert.equal(await api.submit(form, window, document), false)
  assert.equal(form.getAttribute('data-project-form-status'), 'error')
  assert.match(form.error.textContent, /Brand account/)
  assert.doesNotMatch(form.error.textContent, /raw server detail/)
})

test('publishes a copyable privacy-safe diagnostic receipt after success', async () => {
  const form = projectForm()
  form.wrapper = new Element()
  form.wrapper.success = new Element()
  form.wrapper.success.successTitle = new Element()
  form.wrapper.success.successMessage = new Element()
  const loaded = load({ form })

  assert.equal(await loaded.api.submit(form, loaded.window, loaded.document), true)

  const receipt = loaded.window.StartersProjectDiagnostics.getLast()
  assert.equal(receipt.schema, 'project_form_diagnostic_v1')
  assert.match(receipt.diagnostic_id, /^SPF-\d{8}-UUID123$/)
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.stage, 'complete')
  assert.equal(receipt.controller_version, '1.59.190')
  assert.equal(receipt.environment, 'thestarters.com')
  assert.equal(receipt.request_started, true)
  assert.equal(receipt.contract_type, 'standard')
  assert.equal(receipt.engagement_type, 'weekly')
  assert.equal(receipt.invoice_frequency, 'weekly')
  assert.equal(receipt.project_id, 669)
  assert.equal(receipt.replayed, false)
  assert.equal(loaded.trackCalls.some((entry) => entry.name === 'project_form_submit_started'), true)
  assert.equal(loaded.trackCalls.some((entry) => entry.name === 'project_form_submit_succeeded'), true)
  assert.equal(loaded.consoleLogs.length, 2)
  assert.equal(loaded.storage.size, 1)

  const formatted = loaded.window.StartersProjectDiagnostics.formatLast()
  assert.match(formatted, /Result: success/)
  assert.match(formatted, /Project ID: 669/)
  assert.doesNotMatch(formatted, /Build and optimize/)
  assert.doesNotMatch(formatted, /mem_starter_123/)
  assert.doesNotMatch(formatted, /direct-hire-ui/)

  assert.equal(await loaded.window.StartersProjectDiagnostics.copyLast(), true)
  assert.deepEqual(loaded.clipboardWrites, [formatted])
})

test('records a safe request failure without raw server data or form content', async () => {
  const loaded = load({ reject: 403 })

  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)

  const receipt = loaded.window.StartersProjectDiagnostics.getLast()
  assert.equal(receipt.result, 'error')
  assert.equal(receipt.stage, 'request')
  assert.equal(receipt.error_code, 'HTTP_403')
  assert.equal(receipt.http_status, 403)
  assert.equal(receipt.request_started, true)
  assert.equal(receipt.project_id, null)
  const formatted = loaded.window.StartersProjectDiagnostics.formatLast()
  assert.doesNotMatch(formatted, /raw server detail/)
  assert.doesNotMatch(formatted, /Build and optimize/)
  assert.doesNotMatch(formatted, /mem_starter_123/)
  assert.equal(loaded.form.error.textContent, 'This project is not available for your Brand account.')
  assert.equal(loaded.form.error.getAttribute('data-project-diagnostic-copy'), null)
  assert.equal(loaded.trackCalls.some((entry) => entry.name === 'project_form_submit_failed'), true)
})

test('records browser validation without issuing a project request', async () => {
  const form = projectForm()
  form.valid = false
  const loaded = load({ form })

  assert.equal(await loaded.api.submit(form, loaded.window, loaded.document), false)
  assert.equal(loaded.calls.length, 0)
  const receipt = loaded.window.StartersProjectDiagnostics.getLast()
  assert.equal(receipt.result, 'error')
  assert.equal(receipt.stage, 'validation')
  assert.equal(receipt.error_code, 'BROWSER_VALIDATION_FAILED')
  assert.equal(receipt.request_started, false)
  assert.equal(form.error.textContent, 'Review the highlighted fields and try again.')
  assert.equal(form.error.getAttribute('data-project-diagnostic-copy'), null)
  assert.equal(loaded.trackCalls.some((entry) => entry.name === 'project_form_validation_failed'), true)
})

test('records one receipt when native validation blocks the submit event', async () => {
  const loaded = load()
  const firstInvalidField = loaded.form.children[2]
  const secondInvalidField = loaded.form.children[3]
  firstInvalidField.form = loaded.form
  secondInvalidField.form = loaded.form

  assert.equal(loaded.document.listeners.invalid.capture, true)
  loaded.document.listeners.invalid.handler({ target: firstInvalidField })
  loaded.document.listeners.invalid.handler({ target: secondInvalidField })

  assert.equal(loaded.calls.length, 0)
  assert.equal(loaded.window.StartersProjectDiagnostics.getLast().error_code, 'BROWSER_VALIDATION_FAILED')
  assert.equal(loaded.form.getAttribute('data-project-form-status'), 'error')
  assert.equal(loaded.trackCalls.filter((entry) => entry.name === 'project_form_validation_failed').length, 1)

  await Promise.resolve()
  loaded.document.listeners.invalid.handler({ target: firstInvalidField })
  assert.equal(loaded.trackCalls.filter((entry) => entry.name === 'project_form_validation_failed').length, 2)
})

test('keeps authored messages inert while the console helper can copy the current diagnostic', async () => {
  const loaded = load({ reject: 422 })
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  const formatted = loaded.window.StartersProjectDiagnostics.formatLast()

  loaded.form.error.form = loaded.form
  loaded.document.listeners.click.handler({ target: loaded.form.error })
  await Promise.resolve()
  assert.deepEqual(loaded.clipboardWrites, [])

  await loaded.window.copyProjectDiagnostic()
  await Promise.resolve()
  assert.deepEqual(loaded.clipboardWrites, [formatted])
})

test('diagnostics degrade safely when storage or clipboard is unavailable', async () => {
  const loaded = load({ reject: 500, storageThrows: true, noClipboard: true })
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(loaded.window.StartersProjectDiagnostics.getLast().error_code, 'HTTP_500')
  assert.equal(await loaded.window.StartersProjectDiagnostics.copyLast(), false)
})

test('locks fields in flight and retains the retry key after a lost response', async () => {
  let rejectRequest
  const payloads = []
  const createProject = (payload) => {
    payloads.push(payload)
    return new Promise((resolve, reject) => { rejectRequest = reject })
  }
  const { api, document, form, window } = load({ createProject })
  form.contractChoice = new Element({ 'data-project-contract-choice': '', type: 'radio', value: 'My own contract' })
  const disabledChoice = new Element({ 'data-project-contract-choice': '', type: 'radio', value: 'Standard', disabled: true })
  form.contractChoice.form = form
  disabledChoice.form = form
  form.contractChoices = [form.contractChoice, disabledChoice]
  const pending = api.submit(form, window, document)
  await Promise.resolve()
  const keyField = form.querySelector('[data-project-field="idempotency_key"]')
  const retryKey = keyField.value
  const title = form.querySelector('[data-project-field="title"]')
  title.form = form
  assert.equal(title.disabled, true)
  assert.equal(form.contractChoice.disabled, true)
  assert.equal(disabledChoice.disabled, true)
  document.listeners.input.handler({ target: title })
  assert.equal(keyField.value, retryKey)
  assert.equal(api.submit(form, window, document), pending)
  rejectRequest(Object.assign(new Error('lost response'), { status: 503 }))
  assert.equal(await pending, false)
  assert.equal(title.disabled, false)
  assert.equal(form.contractChoice.disabled, false)
  assert.equal(disabledChoice.disabled, true)
  assert.equal(keyField.value, retryKey)
  assert.equal(payloads[0].idempotency_key, retryKey)
  const trigger = new Element({ 'data-modal-trigger': 'generate-contract' })
  assert.equal(api.bindTrigger(trigger, document), true)
  assert.equal(keyField.value, retryKey)
  title.value = 'Changed project'
  assert.equal(api.bindTrigger(trigger, document), true)
  assert.equal(keyField.value, '')
  keyField.value = retryKey
  document.listeners.input.handler({ target: title })
  assert.equal(keyField.value, '')
})

test('retries a lost response with the exact same idempotency key', async () => {
  const payloads = []
  let attempt = 0
  const createProject = async (payload) => {
    payloads.push(payload)
    attempt += 1
    if (attempt === 1) throw Object.assign(new Error('lost response'), { status: 503 })
    return { project: { id: 669 }, replayed: true }
  }
  const { api, document, form, window } = load({ createProject })
  assert.equal(await api.submit(form, window, document), false)
  assert.equal(await api.submit(form, window, document), true)
  assert.equal(payloads.length, 2)
  assert.equal(payloads[0].idempotency_key, payloads[1].idempotency_key)
  assert.equal(document.event.detail.replayed, true)
})

test('installs the submit handler in capture phase ahead of native Webflow submission', () => {
  const { document } = load()
  assert.equal(document.listeners.submit.capture, true)
  assert.equal(typeof document.listeners.click.handler, 'function')
  assert.equal(typeof document.listeners.input.handler, 'function')
})
