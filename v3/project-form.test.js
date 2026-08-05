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
    this.disabled = false
    this.hidden = false
    this.textContent = ''
    this.style = { display: '' }
    this.children = []
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return this.attrs[name] ?? null }
  matches(selector) { return selector === 'form[data-project-form-v3="brand"]' && this.attrs['data-project-form-v3'] === 'brand' }
  closest(selector) {
    if (selector === 'form[data-project-form-v3="brand"]') return this.form || (this.matches(selector) ? this : null)
    if (selector.includes('data-wf-xano-id')) return this.card || null
    if (selector === '.w-form' || selector === '[data-modal-target]') return this.wrapper || null
    return null
  }
  querySelector(selector) {
    const field = /^\[data-project-field="([^"]+)"\]$/.exec(selector)
    if (field) return this.children.find((child) => child.getAttribute('data-project-field') === field[1]) || null
    if (selector === '[data-project-form-state="error"]') return this.error || null
    if (selector === '[data-project-contract-choice]:checked') return this.contractChoice || null
    if (selector.includes('generate-contract_success')) return this.success || null
    return null
  }
  querySelectorAll(selector) {
    if (selector === '[data-project-field]') return this.children
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
    opportunity_id: '77',
    application_id: '88',
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
    number_of_weeks: '8',
    number_of_months: '',
    start_date: '08/20/2026',
    estimated_end_date: '2026-10-15',
    project_scope: 'Build and optimize the retention program.',
    ...values,
  }).map(([name, value]) => field(name, value))
  return form
}

function documentFixture(form) {
  const listeners = {}
  return {
    documentElement: new Element({ 'data-opp30-opportunity-id': '77' }),
    listeners,
    addEventListener(name, handler, capture) { listeners[name] = { handler, capture } },
    dispatchEvent(event) { this.event = event },
    querySelector(selector) { return selector === 'form[data-project-form-v3="brand"]' ? form : null },
  }
}

function load(options = {}) {
  const form = options.form || projectForm()
  const document = options.document || documentFixture(form)
  const calls = []
  const window = {
    document,
    crypto: { randomUUID: () => 'uuid-123' },
    Opp30: { API: { projectCreate: async (payload) => {
      calls.push(payload)
      if (options.reject) throw Object.assign(new Error('raw server detail'), { status: options.reject })
      return { project: { id: 669 }, replayed: false }
    } } },
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
  const monthly = api.canonicalEngagement('Monthly Recurring')
  assert.equal(monthly.value, 'monthly')
  assert.equal(monthly.unsupported, false)
  const hourly = api.canonicalEngagement('Hourly Rate')
  assert.equal(hourly.value, '')
  assert.equal(hourly.unsupported, true)
})

test('serializes only explicitly marked fields into the Xano contract', () => {
  const { api, form } = load()
  form.children.push(new Element({ value: 'must-not-submit' }))
  const result = api.serialize(form)
  assert.equal(result.payload.opportunity_id, 77)
  assert.equal(result.payload.application_id, 88)
  assert.equal(result.payload.engagement_type, 'weekly')
  assert.equal(result.payload.pandadoc_template_key, 'weekly')
  assert.equal(result.payload.weekly_rate, 1250)
  assert.equal(result.payload.number_of_weeks, 8)
  assert.equal(result.payload.start_date, '2026-08-20')
  assert.equal(Object.values(result.payload).includes('must-not-submit'), false)
})

test('fails closed for hourly contracts because endpoint 1678 does not accept them', () => {
  const form = projectForm({ engagement_type: 'Ongoing Hourly', hourly_rate: '100' })
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.match(api.validationError(serialized), /not supported/)
})

test('uses the server-side own-contract template when that authored radio is selected', () => {
  const form = projectForm({ engagement_type: 'Weekly Recurring' })
  form.contractChoice = new Element({ 'data-project-contract-choice': '', value: 'My own contract' })
  const { api } = load({ form })
  const serialized = api.serialize(form)
  assert.equal(serialized.payload.engagement_type, 'own_contract')
  assert.equal(serialized.payload.pandadoc_template_key, 'own_contract')
})

test('hydrates stable opportunity and application ids from an authored applicant trigger', () => {
  const form = projectForm({ opportunity_id: '', application_id: '' })
  const { api, document } = load({ form })
  const card = new Element({ 'data-wf-xano-id': '88', 'data-project-opportunity-id': '77' })
  const trigger = new Element({ 'data-project-form-open': '' })
  trigger.card = card
  assert.equal(api.bindTrigger(trigger, document), true)
  assert.equal(form.querySelector('[data-project-field="opportunity_id"]').value, '77')
  assert.equal(form.querySelector('[data-project-field="application_id"]').value, '88')
  assert.equal(form.getAttribute('data-project-form-status'), 'ready')
})

test('submits once through Opp30 auth, keeps the retry key, and emits safe success state', async () => {
  const { api, calls, document, form, window } = load()
  form.wrapper = new Element()
  form.wrapper.success = new Element()
  const first = api.submit(form, window, document)
  const duplicate = api.submit(form, window, document)
  assert.equal(first, duplicate)
  assert.equal(await first, true)
  assert.equal(calls.filter((call) => call && call.application_id === 88).length, 1)
  assert.equal(calls[0].idempotency_key, 'project-ui:88:uuid-123')
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

test('installs the submit handler in capture phase ahead of native Webflow submission', () => {
  const { document } = load()
  assert.equal(document.listeners.submit.capture, true)
  assert.equal(typeof document.listeners.click.handler, 'function')
  assert.equal(typeof document.listeners.input.handler, 'function')
})

test('routes project creation through the existing authenticated Opp30 bridge', () => {
  assert.match(
    OPPORTUNITIES_SOURCE,
    /projectCreate:\s*\(payload\)\s*=>\s*call\('projects\/create\/v3',\s*\{ body: payload \}\)/,
  )
})
