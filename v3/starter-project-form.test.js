'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'starter-project-form.js'), 'utf8')

class ClassList {
  constructor(values = []) { this.values = new Set(values) }
  add(value) { this.values.add(value) }
  remove(value) { this.values.delete(value) }
  contains(value) { return this.values.has(value) }
}

class Element {
  constructor(attrs = {}) {
    this.attrs = { ...attrs }
    this.value = attrs.value || ''
    this.textContent = attrs.textContent || ''
    this.hidden = Boolean(attrs.hidden)
    this.disabled = Boolean(attrs.disabled)
    this.style = { display: '', opacity: '', pointerEvents: '' }
    this.classList = new ClassList((attrs.className || '').split(/\s+/).filter(Boolean))
    this.children = []
    this.events = []
    this.parent = null
    this.resetCount = 0
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return this.attrs[name] ?? null }
  dispatchEvent(event) { this.events.push(event.type) }
  cloneNode() {
    return new Element({
      ...this.attrs,
      textContent: this.textContent,
      hidden: this.hidden,
      className: Array.from(this.classList.values).join(' '),
    })
  }
  insertBefore(element, reference) {
    element.parent = this
    const index = this.children.indexOf(reference)
    if (index === -1) this.children.push(element)
    else this.children.splice(index, 0, element)
  }
  remove() {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((child) => child !== this)
  }
  reset() { this.resetCount += 1 }
  matches(selector) {
    if (selector === '#Select-Brand') return this.attrs.id === 'Select-Brand'
    return false
  }
  closest(selector) {
    if (selector === '.w-form') return this.wrapper || null
    if (selector.includes('dialog[data-modal-target="start-project"] form')) return this.form || null
    if (selector === '[data-starter-project-brand-option]') {
      return this.getAttribute('data-starter-project-brand-option') ? this : null
    }
    return null
  }
  querySelector(selector) {
    if (selector.includes(', ')) {
      for (const part of selector.split(', ')) {
        const found = this.querySelector(part)
        if (found) return found
      }
      return null
    }
    if (selector === '#Select-Brand') return this.fields && this.fields.search
    if (selector === '#brand-list') return this.fields && this.fields.list
    if (selector === '#brand-contract') return this.fields && this.fields.brandId
    if (selector === '#hiring-manager-name') return this.fields && this.fields.manager
    if (selector === '#brand-company-name') return this.fields && this.fields.company
    if (selector === '#brand-email') return this.fields && this.fields.email
    if (selector === '.brand-select_dropdown-item.is-not-found') return this.fields && this.fields.empty
    if (selector === '[data-project-form-state="error"]' || selector === '.w-form-fail') return this.error || null
    if (selector === '[data-project-form-state="success"]' || selector === '.w-form-done') return this.success || null
    if (selector === '[data-project-success-message]') return this.successMessage || null
    return null
  }
  querySelectorAll(selector) {
    if (selector === '[data-starter-project-brand-option]') {
      return this.children.filter((child) => child.getAttribute('data-starter-project-brand-option'))
    }
    if (selector === 'input, select, textarea, button') return this.controls || []
    if (selector === '[data-project-success-title], .generate-contract_success-text') return this.successTitles || []
    return []
  }
}

function formFixture() {
  const form = new Element()
  const wrapper = new Element()
  const list = new Element()
  const empty = new Element({ textContent: 'Not found', className: 'brand-select_dropdown-item is-not-found' })
  empty.parent = list
  list.children = [empty]
  form.fields = {
    search: new Element({ id: 'Select-Brand' }),
    list,
    empty,
    brandId: new Element({ id: 'brand-contract' }),
    manager: new Element({ id: 'hiring-manager-name', value: 'Sample manager' }),
    company: new Element({ id: 'brand-company-name', value: 'Sample company' }),
    email: new Element({ id: 'brand-email', value: 'sample@example.com' }),
  }
  Object.values(form.fields).forEach((element) => { element.form = form })
  form.wrapper = wrapper
  wrapper.error = new Element()
  wrapper.success = new Element({ hidden: true })
  wrapper.success.successTitles = [new Element(), new Element()]
  wrapper.success.successMessage = new Element()
  form.controls = Object.values(form.fields).filter((element) => element !== list && element !== empty)
  return { form, wrapper }
}

function load(options = {}) {
  const { form, wrapper } = options.fixture || formFixture()
  const calls = { options: [], submit: [] }
  const events = []
  const tracks = []
  const serializedPayload = {
    starter_memberstack_id: 'mem_starter',
    connection_type: 'opportunity',
    opportunity_id: 991,
    pandadoc_job_id: 44,
    title: 'Retention launch',
    service: 'Email Marketing',
    engagement_type: 'monthly',
    contract_type: 'own_contract',
    monthly_rate: 2500,
    start_date: '2026-08-20',
    project_scope: 'Build the retention program.',
  }
  const document = {
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler },
    querySelector(selector) { return selector.includes('start-project') ? form : null },
    dispatchEvent(event) { events.push(event) },
  }
  const window = {
    document: options.noDocument ? null : document,
    crypto: { randomUUID: () => 'proposal-key-123' },
    Event: class Event { constructor(type) { this.type = type } },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail } },
    WeakMap,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler },
    StartersTrack: { track(name, payload) { tracks.push({ name, payload }) } },
    StartersProjectFormV3: {
      serialize: () => ({ payload: { ...serializedPayload } }),
      commercialValidationError: options.validationError || (() => ''),
      createIdempotencyKey: () => 'proposal-key-123',
    },
    Opp30: { API: {
      projectOptions: options.projectOptions || (async (payload) => {
        calls.options.push(payload)
        return { counterparties: options.counterparties || [] }
      }),
      projectSubmit: options.projectSubmit || (async (payload) => {
        calls.submit.push(payload)
        return { proposal: { id: 81, status: 'awaiting_brand_approval' }, replayed: false }
      }),
    } },
  }
  vm.runInNewContext(SOURCE, { window, WeakMap, Number, String, JSON, Object, Array, Promise }, { filename: 'starter-project-form.js' })
  return { api: window.StartersStarterProjectFormV3, calls, document, events, form, tracks, window, wrapper }
}

test('normalizes, deduplicates, and sorts eligible Brands by stable Xano ID', () => {
  const { api } = load({ noDocument: true })
  const options = api.normalizeOptions({ counterparties: [
    { counterparty_id: 9, company_name: 'Zulu', hiring_manager_name: 'Zoe' },
    { counterparty_id: 4, company_name: 'Alpha', hiring_manager_name: 'Amy', email: 'not-returned@example.com' },
    { counterparty_id: 9, company_name: 'Duplicate' },
    { counterparty_id: 0, company_name: 'Invalid' },
  ] })
  assert.deepEqual(JSON.parse(JSON.stringify(options)), [
    { id: 4, label: 'Alpha — Amy', company_name: 'Alpha', manager_name: 'Amy' },
    { id: 9, label: 'Zulu — Zoe', company_name: 'Zulu', manager_name: 'Zoe' },
  ])
  assert.equal(Object.prototype.hasOwnProperty.call(options[0], 'email'), false)
})

test('selecting a Brand stores its ID and clears stale sample email', () => {
  const { api, form } = load({ noDocument: true })
  const selected = { id: 12, label: 'Acme — Jai', company_name: 'Acme', manager_name: 'Jai' }
  assert.equal(api.selectBrand(form, selected), true)
  assert.equal(form.fields.brandId.value, '12')
  assert.equal(form.fields.search.value, 'Acme — Jai')
  assert.equal(form.fields.company.value, 'Acme')
  assert.equal(form.fields.manager.value, 'Jai')
  assert.equal(form.fields.email.value, '')
})

test('loading one eligible Brand selects it automatically', async () => {
  const { api, calls, form, window } = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 14, company_name: 'Only Brand', hiring_manager_name: 'Manager' }],
  })
  const options = await api.loadOptions(form, window)
  assert.equal(calls.options.length, 1)
  assert.equal(JSON.stringify(calls.options[0]), '{}')
  assert.equal(options.length, 1)
  assert.equal(form.fields.brandId.value, '14')
  assert.equal(form.getAttribute('data-starter-project-status'), 'ready')
})

test('no eligible Brands produces a blocked, non-submittable state', async () => {
  const { api, form, window, wrapper } = load({ noDocument: true, counterparties: [] })
  await api.loadOptions(form, window)
  assert.equal(form.getAttribute('data-starter-project-status'), 'blocked')
  assert.match(wrapper.error.textContent, /after a Brand messages you/)
  assert.equal(form.fields.empty.textContent, 'No eligible brands yet')
})

test('Starter payload reuses commercial fields and omits connection type and Starter identity', () => {
  const { api, form, document, window } = load({ noDocument: true })
  api.selectBrand(form, { id: 22, label: 'Brand', company_name: 'Brand', manager_name: '' })
  const serialized = api.starterPayload(form, document, window)
  assert.equal(serialized.payload.brand_id, 22)
  assert.equal(serialized.payload.title, 'Retention launch')
  assert.equal(serialized.payload.project_scope, 'Build the retention program.')
  assert.equal(Object.prototype.hasOwnProperty.call(serialized.payload, 'starter_memberstack_id'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(serialized.payload, 'connection_type'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(serialized.payload, 'opportunity_id'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(serialized.payload, 'pandadoc_job_id'), false)
})

test('member scope reset clears cached Brands and ignores the prior in-flight response', async () => {
  let resolveFirst
  let requestNumber = 0
  const loaded = load({
    projectOptions: () => {
      requestNumber += 1
      if (requestNumber === 1) return new Promise((resolve) => { resolveFirst = resolve })
      return Promise.resolve({ counterparties: [{ counterparty_id: 52, company_name: 'Member B Brand' }] })
    },
  })
  const firstRequest = loaded.api.loadOptions(loaded.form, loaded.window)
  await Promise.resolve()
  loaded.window.listeners['opp30:member-scope-reset']({ detail: { memberId: 'member-b' } })
  resolveFirst({ counterparties: [{ counterparty_id: 51, company_name: 'Member A Brand' }] })
  assert.equal((await firstRequest).length, 0)

  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.fields.brandId.value, '52')
  assert.equal(loaded.form.fields.search.value, 'Member B Brand')
  assert.equal(loaded.form.fields.list.querySelectorAll('[data-starter-project-brand-option]').length, 1)
})

test('submission creates a proposal event and never reports a created project', async () => {
  const loaded = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 31, company_name: 'Brand' }],
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(loaded.calls.submit.length, 1)
  assert.equal(loaded.calls.submit[0].brand_id, 31)
  assert.equal(loaded.calls.submit[0].idempotency_key, 'proposal-key-123')
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.calls.submit[0], 'connection_type'), false)
  assert.equal(loaded.events[0].type, 'starters:project-proposal-created')
  assert.equal(loaded.events[0].detail.proposal_id, 81)
  assert.equal(loaded.tracks[0].name, 'project_proposal_submitted')
  assert.deepEqual(loaded.wrapper.success.successTitles.map((title) => title.textContent), [
    'Project request sent',
    'Project request sent',
  ])
})

test('opening the modal after success restores the form and hides success state', async () => {
  const loaded = load({ counterparties: [{ counterparty_id: 61, company_name: 'Brand' }] })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(loaded.form.style.display, 'none')
  assert.equal(loaded.wrapper.success.style.display, 'block')

  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  assert.equal(loaded.form.style.display, '')
  assert.equal(loaded.wrapper.success.hidden, true)
  assert.equal(loaded.wrapper.success.style.display, 'none')
  assert.equal(loaded.form.resetCount, 1)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'ready')
})

test('failed retry keeps the same idempotency key', async () => {
  const submitted = []
  let attempt = 0
  const loaded = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 41, company_name: 'Brand' }],
    projectSubmit: async (payload) => {
      submitted.push({ ...payload })
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('temporary'), { status: 503 })
      return { proposal: { id: 91 }, replayed: true }
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(submitted.length, 2)
  assert.equal(submitted[0].idempotency_key, submitted[1].idempotency_key)
})

test('an injected Brand ID cannot bypass the V3 options response', async () => {
  const loaded = load({ noDocument: true, counterparties: [] })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  loaded.form.fields.brandId.value = '999'
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(loaded.calls.submit.length, 0)
  assert.match(loaded.wrapper.error.textContent, /Select an eligible Brand/)
})
