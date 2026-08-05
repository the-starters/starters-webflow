'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'project-form.js'), 'utf8')
const OPPORTUNITIES_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'opportunities-3.0.js'), 'utf8')

class Element {
  constructor(attrs = {}) {
    this.attrs = { ...attrs }
    this.value = attrs.value || ''
    this.type = attrs.type || 'text'
    this.checked = attrs.checked !== false
    this.disabled = attrs.disabled === true
    this.hidden = false
    this.textContent = ''
    this.style = { display: '' }
    this.children = []
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return this.attrs[name] ?? null }
  matches(selector) { return selector.includes('form[data-project-form-v3="brand"]') && this.attrs['data-project-form-v3'] === 'brand' }
  closest(selector) {
    if (selector.includes('form[data-project-form-v3="brand"]')) return this.form || (this.matches(selector) ? this : null)
    if (selector === '[data-project-form-container]') return this.wrapper || null
    return null
  }
  querySelector(selector) {
    const field = /^\[data-project-field="([^"]+)"\]$/.exec(selector)
    if (field) return this.children.find((child) => child.getAttribute('data-project-field') === field[1]) || null
    if (selector === '[data-project-form-state="error"]') return this.error || null
    if (selector === '[data-project-contract-choice]:checked') return this.contractChoice || null
    if (selector === '[data-project-form-state="success"]') return this.success || null
    return null
  }
  querySelectorAll(selector) {
    if (selector === '[data-project-field]') return this.children
    if (selector === '[data-project-field], [data-project-contract-choice]') {
      return this.children.concat(this.contractChoices || (this.contractChoice ? [this.contractChoice] : []))
    }
    if (selector.includes('[type="submit"]')) return this.submitters || []
    return []
  }
  reportValidity() { return this.valid !== false }
}

function field(name, value, attrs = {}) {
  return new Element({ 'data-project-field': name, value, ...attrs })
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
    querySelector(selector) { return selector.includes('form[data-project-form-v3="brand"]') ? form : null },
  }
}

function load(options = {}) {
  const form = options.form || projectForm()
  const document = options.document || documentFixture(form)
  const calls = []
  const window = {
    document,
    crypto: { randomUUID: () => 'uuid-123' },
    Opp30: { API: { projectDirectCreate: options.createProject || (async (payload) => {
      calls.push(payload)
      if (options.reject) throw Object.assign(new Error('raw server detail'), { status: options.reject })
      return { project: { id: 669 }, replayed: false }
    }) } },
    StartersTrack: { track(name, payload) { calls.push({ name, payload }) } },
    CustomEvent: class CustomEvent { constructor(name, init) { this.type = name; this.detail = init.detail } },
    WeakMap,
    Uint32Array,
    Date,
    Math,
  }
  vm.runInNewContext(SOURCE, { window, WeakMap, Uint32Array, Date, Math }, { filename: 'project-form.js' })
  return { api: window.StartersProjectFormV3, calls, document, form, window }
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
  assert.equal(api.canonicalHourlyFrequency('One Time'), 'one_time')
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

test('keeps pricing separate from the authored own-contract choice', () => {
  const form = projectForm({ engagement_type: 'Weekly Recurring' })
  form.contractChoice = new Element({ 'data-project-contract-choice': '', value: 'My own contract' })
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(serialized.payload.engagement_type, 'weekly')
  assert.equal(serialized.payload.contract_type, 'own_contract')
})

test('binds the existing Hire trigger when the selected Starter identity is present', () => {
  const form = projectForm()
  const { api, document } = load({ form })
  const trigger = new Element({ 'data-modal-trigger': 'generate-contract' })
  assert.equal(api.bindTrigger(trigger, document), true)
  assert.equal(form.getAttribute('data-project-form-status'), 'ready')
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
  assert.equal(document.event.type, 'starters:project-created')
  assert.equal(document.event.detail.project_id, 669)
  assert.equal(document.event.detail.replayed, false)
})

test('projects safe authorization errors without exposing raw server messages', async () => {
  const { api, form, window, document } = load({ reject: 403 })
  assert.equal(await api.submit(form, window, document), false)
  assert.equal(form.getAttribute('data-project-form-status'), 'error')
  assert.match(form.error.textContent, /Brand account/)
  assert.doesNotMatch(form.error.textContent, /raw server detail/)
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

test('installs the submit handler in capture phase ahead of native Webflow submission', () => {
  const { document } = load()
  assert.equal(document.listeners.submit.capture, true)
  assert.equal(typeof document.listeners.click.handler, 'function')
  assert.equal(typeof document.listeners.input.handler, 'function')
})

test('routes direct-hire project creation through the authenticated Opp30 bridge', () => {
  assert.match(
    OPPORTUNITIES_SOURCE,
    /projectDirectCreate:\s*\(payload\)\s*=>\s*call\('projects\/create-direct\/v3',\s*\{ body: payload \}\)/,
  )
})
