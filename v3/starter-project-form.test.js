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
    this.required = Boolean(attrs.required)
    this.readOnly = Boolean(attrs.readOnly)
    this.tagName = String(attrs.tagName || 'div').toUpperCase()
    this.style = { display: '', opacity: '', pointerEvents: '' }
    this.classList = new ClassList((attrs.className || '').split(/\s+/).filter(Boolean))
    this.children = []
    this.options = attrs.tagName === 'select' ? [] : null
    this.ownerDocument = null
    this.events = []
    this.parent = null
    this.parentElement = null
    this.resetCount = 0
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value)
    if (this.onAttributeChange) this.onAttributeChange(name, String(value))
  }
  getAttribute(name) { return this.attrs[name] ?? null }
  removeAttribute(name) { delete this.attrs[name] }
  dispatchEvent(event) {
    this.events.push(event.type)
    event.target = this
    if (event.bubbles && this.eventDocument && this.eventDocument.listeners[event.type]) {
      this.eventDocument.listeners[event.type](event)
    }
  }
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
  appendChild(element) {
    element.parent = this
    element.parentElement = this
    this.children.push(element)
    if (this.options) this.options.push(element)
  }
  remove(index) {
    if (typeof index === 'number' && this.options) {
      const removed = this.options.splice(index, 1)[0]
      this.children = this.children.filter((child) => child !== removed)
      return
    }
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((child) => child !== this)
  }
  reset() { this.resetCount += 1 }
  matches(selector) {
    if (selector === '#Brand' || selector.includes('#Brand')) return this.attrs.id === 'Brand'
    if (selector === '[data-project-form-v3="starter"]') return this.getAttribute('data-project-form-v3') === 'starter'
    if (selector === '.generate-contract_success') return this.classList.contains('generate-contract_success')
    return false
  }
  closest(selector) {
    if (selector === '.w-form') return this.wrapper || null
    if (selector === '.button-group.is-confirm') {
      let element = this
      while (element) {
        if (element.classList.contains('button-group') && element.classList.contains('is-confirm')) return element
        element = element.parentElement
      }
      return null
    }
    if (selector.includes('dialog[data-modal-target="start-project"] form')) return this.form || null
    if (selector.includes('[data-project-form-v3="starter"] form')) return this.form || null
    if (selector === '[data-project-form-v3="starter"]') return this.context || (this.matches(selector) ? this : null)
    if (selector === 'dialog') return this.dialog || null
    if (selector === '[data-starter-project-brand-option]') {
      return this.getAttribute('data-starter-project-brand-option') ? this : null
    }
    if (selector === '[dx-button="review"]') {
      return this.getAttribute('dx-button') === 'review' ? this : null
    }
    if (selector === '[dx-button="edit"]') {
      return this.getAttribute('dx-button') === 'edit' ? this : null
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
    if (selector === '#Brand') return this.fields && this.fields.select
    if (selector === '[data-project-field="service"]') return this.fields && this.fields.serviceSelect
    if (selector === 'select[name="Services"]') return this.fields && this.fields.serviceSelect
    if (selector === 'select[name="services"]') return this.fields && this.fields.serviceSelect
    if (selector === '#brand-contract') return this.fields && this.fields.brandId
    if (selector === '#hiring-manager-name') return this.fields && this.fields.manager
    if (selector === '#Hiring-Manager-Name') return this.fields && this.fields.manager
    if (selector === '#brand-company-name') return this.fields && this.fields.company
    if (selector === '#Company-Name') return this.fields && this.fields.company
    if (selector === '#brand-email') return this.fields && this.fields.email
    if (selector === '#Email-Address') return this.fields && this.fields.email
    if (selector === '[data-project-form-state="error"]' || selector === '.w-form-fail') return this.error || null
    if (selector === '[data-project-form-state="success"]' || selector === '.w-form-done') return this.success || null
    if (selector === '[data-project-success-message]') return this.successMessage || null
    if (selector === '.generate-contract_success-layout > p:not(.generate-contract_success-text)') return this.successMessage || null
    if (selector === '.generate-contract_success') return this.preview || null
    if (selector === '.generate-contract_success a.clickable_link') return this.successLink || null
    if (selector === '.w-form-done a.clickable_link') return this.successLink || null
    if (selector === 'form') return this.form || null
    return null
  }
  querySelectorAll(selector) {
    if (selector === 'input, select, textarea, button') return this.controls || []
    if (selector === 'input, select, textarea') return this.controls || []
    if (selector === '.button-group.is-confirm button[type="submit"], .button-group.is-confirm input[type="submit"], .button-group.is-confirm [data-project-submit]') {
      return (this.controls || []).filter((control) => (
        (control.getAttribute('type') === 'submit' || control.getAttribute('data-project-submit') !== null) &&
        control.closest('.button-group.is-confirm')
      ))
    }
    if (selector === '[data-set-current-date-inited="true"]') {
      return (this.controls || []).filter((control) => control.getAttribute('data-set-current-date-inited') === 'true')
    }
    if (selector === '[data-project-success-title], .generate-contract_success-text') return this.successTitles || []
    if (selector === '[data-project-bind], [element]') return this.profileTargets || []
    if (selector === 'p, label, span') return this.copyTargets || []
    if (selector === 'p, label, span, a, button') return this.copyTargets || []
    if (selector === '.generate-contract_success a.clickable_link, .w-form-done a.clickable_link') return this.successLinks || []
    if (selector === '#brand-name-contract, #brand-name, #freeName, #FreeEmail, #pushMemID') return this.cmsOnly || []
    return []
  }
}

function formFixture() {
  const form = new Element({ tagName: 'form' })
  const wrapper = new Element()
  const context = new Element({ tagName: 'dialog', 'data-project-form-v3': 'starter' })
  context.form = form
  form.context = context
  form.dialog = context
  const select = new Element({ id: 'Brand', name: 'Brand', tagName: 'select' })
  const placeholder = new Element({ value: '', textContent: 'Choose a Brand', tagName: 'option' })
  select.ownerDocument = { createElement: (tagName) => new Element({ tagName }) }
  select.appendChild(placeholder)
  const serviceSelect = new Element({ name: 'Services', tagName: 'select' })
  serviceSelect.ownerDocument = { createElement: (tagName) => new Element({ tagName }) }
  ;[
    ['', 'Select one...'],
    ['Freelance work', 'Freelance work'],
    ['Monthly retainer', 'Monthly retainer'],
    ['Service 1', 'Service 1'],
    ['Service 2', 'Service 2'],
    ['Service 3', 'Service 3'],
  ].forEach(([value, textContent]) => serviceSelect.appendChild(new Element({ value, textContent, tagName: 'option' })))
  form.fields = {
    select,
    serviceSelect,
    brandId: new Element({ id: 'brand-contract' }),
    manager: new Element({ id: 'hiring-manager-name', value: 'Sample manager' }),
    company: new Element({ id: 'brand-company-name', value: 'Sample company' }),
    email: new Element({ id: 'brand-email', value: 'sample@example.com' }),
  }
  Object.values(form.fields).forEach((element) => { element.form = form })
  Object.values(form.fields).forEach((element) => { element.context = context })
  form.wrapper = wrapper
  wrapper.error = new Element()
  wrapper.success = new Element({ hidden: true, className: 'generate-contract_success' })
  wrapper.success.successTitles = [new Element(), new Element()]
  wrapper.success.successMessage = new Element()
  const successLink = new Element({ href: '/brand-dashboard', tagName: 'a' })
  wrapper.success.successLink = successLink
  context.successLinks = [successLink]
  context.profileTargets = [
    new Element({ tagName: 'img', element: 'profile_photo' }),
    new Element({ element: 'full_name', textContent: 'Full Name' }),
    new Element({ element: 'professional_headline', textContent: 'Headline' }),
    new Element({ element: 'list_roles' }),
    new Element({ element: 'role_name' }),
    new Element({ element: 'freelancer_infromation', textContent: 'Freelancer information' }),
  ]
  context.copyTargets = [
    new Element({ tagName: 'p', textContent: 'Selected Freelancer:' }),
    new Element({ tagName: 'p', textContent: 'Starting a project is how you hire talent on The Starters' }),
    new Element({ tagName: 'p', textContent: "This is where you'll define scope, set milestones, and get to work. Once a project is created, you can document the engagement, sign a contract, and pay your Starter all in one place." }),
    new Element({ tagName: 'label', textContent: 'Add project scope for the freelancer' }),
    new Element({ tagName: 'p', textContent: "The share of the total you'll pay the freelancer before work begins (0–100%)." }),
    new Element({ tagName: 'p', textContent: 'The contract will continue until the project is ended by you or the Starter' }),
    new Element({ tagName: 'p', textContent: 'The contract will continue until the project is ended by you or the Starter' }),
    new Element({ tagName: 'span', textContent: 'Party' }),
    new Element({ tagName: 'button', textContent: 'Message Party' }),
  ]
  form.controls = Object.values(form.fields)
  return { context, form, wrapper }
}

function attachConfirm(form, attrs = {}) {
  const footer = new Element({ className: 'button-group is-confirm' })
  const confirm = new Element({ tagName: 'button', type: 'submit', disabled: true, ...attrs })
  footer.appendChild(confirm)
  confirm.form = form
  form.controls.push(confirm)
  return confirm
}

function load(options = {}) {
  const { context, form, wrapper } = options.fixture || formFixture()
  const calls = { options: [], profile: [], submit: [] }
  const events = []
  const tracks = []
  const mutationObservers = []
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
    captureListeners: {},
    addEventListener(name, handler, capture) {
      if (capture === true) this.captureListeners[name] = handler
      else this.listeners[name] = handler
    },
    querySelector(selector) {
      if (selector === '[data-project-form-v3="starter"]') return context
      return selector.includes('start-project') || selector.includes('data-project-form-v3') ? form : null
    },
    dispatchEvent(event) { events.push(event) },
  }
  Object.values(form.fields).forEach((element) => { element.eventDocument = document })
  const window = {
    document: options.noDocument ? null : document,
    crypto: { randomUUID: () => 'project-key-123' },
    Event: class Event {
      constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles) }
    },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail } },
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback
        this.target = null
        mutationObservers.push(this)
      }
      observe(target) { this.target = target }
    },
    WeakMap,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler },
    StartersTrack: { track(name, payload) { tracks.push({ name, payload }) } },
    StartersProjectFormV3: {
      serialize: () => ({ payload: { ...serializedPayload } }),
      commercialValidationError: options.validationError || (() => ''),
      createIdempotencyKey: () => 'project-key-123',
      fillCurrentDates: options.fillCurrentDates,
    },
    Opp30: { API: {
      starterProfile: options.starterProfile || (async () => {
        calls.profile.push({})
        return options.profile || {
          full_name: 'Starter Person',
          role_name: 'Retention',
          professional_headline: 'Growth strategist',
          profile_photo: 'https://example.com/starter.jpg',
          freelancer_information: 'Builds durable growth systems.',
        }
      }),
      projectOptions: options.projectOptions || (async (payload) => {
        calls.options.push(payload)
        return { counterparties: options.counterparties || [] }
      }),
      projectSubmit: options.projectSubmit || (async (payload) => {
        calls.submit.push(payload)
        return { project: { id: 81, lifecycle_state: 'contract_create_pending' }, replayed: false }
      }),
    } },
  }
  vm.runInNewContext(SOURCE, { window, WeakMap, Number, String, JSON, Object, Array, Promise }, { filename: 'starter-project-form.js' })
  return {
    api: window.StartersStarterProjectFormV3,
    calls,
    context,
    document,
    events,
    form,
    tracks,
    window,
    wrapper,
    flushDisabledMutation(target = form) {
      mutationObservers.forEach((observer) => {
        if (observer.target === target) observer.callback([{ attributeName: 'disabled' }])
      })
    },
  }
}

test('renders the authenticated Starter services and leaves the Brand rail identity intact', async () => {
  const loaded = load({ noDocument: true, profile: {
    first_name: 'Starter',
    last_name: 'Person',
    role_name: 'Lifecycle Marketing',
    professional_headline: 'Retention lead',
    profile_photo: 'https://example.com/photo.jpg',
    freelancer_information: '<p>Builds &amp; improves retention.</p>',
    services: [
      { name: 'Lifecycle Email Program', description: 'Build retention.', price: 2500 },
      { name: 'Retention Audit', description: 'Find gaps.', price: 800 },
    ],
  } })
  const photo = new Element({ tagName: 'img', 'data-project-bind': 'starter.profile_photo' })
  const name = new Element({ 'data-project-bind': 'starter.full_name' })
  const headline = new Element({ 'data-project-bind': 'starter.professional_headline', 'data-project-bind-empty': 'hide' })
  const role = new Element({ element: 'role_name' })
  const summary = new Element({ element: 'freelancer_infromation' })
  loaded.context.profileTargets = [photo, name, role, headline, summary]

  const request = loaded.api.loadProfile(loaded.form, loaded.window)
  loaded.api.renderCounterparty(loaded.form, { id: 7, manager_name: 'Dana Reyes', company_name: 'Northwind Coffee' })
  const profile = await request

  assert.equal(loaded.calls.profile.length, 1)
  assert.equal(profile.full_name, 'Starter Person')
  assert.equal(name.textContent, 'Dana Reyes')
  assert.equal(headline.textContent, 'Northwind Coffee')
  assert.equal(photo.getAttribute('src'), null)
  assert.equal(photo.getAttribute('alt'), '')
  assert.equal(role.textContent, '')
  assert.equal(summary.textContent, '')
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => [option.value, option.textContent]),
    [
      ['', 'Select one...'],
      ['Freelance work', 'Freelance work'],
      ['Monthly retainer', 'Monthly retainer'],
      ['Lifecycle Email Program', 'Lifecycle Email Program'],
      ['Retention Audit', 'Retention Audit'],
    ],
  )
})

test('the canonical service list never reaches the profile bind projection', async () => {
  const loaded = load({
    noDocument: true,
    profile: { full_name: 'Starter Person', services: ['Lifecycle Email Program', 'Retention Audit'] },
  })
  const services = new Element({ 'data-project-bind': 'starter.services', textContent: 'Authored services copy' })
  loaded.context.profileTargets = [services]

  await loaded.api.loadProfile(loaded.form, loaded.window)

  assert.equal(services.textContent, 'Authored services copy')
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.value),
    ['', 'Freelance work', 'Monthly retainer', 'Lifecycle Email Program', 'Retention Audit'],
  )
})

test('normalizes canonical services and removes generic slots from every source', () => {
  const loaded = load({ noDocument: true })

  assert.deepEqual(
    JSON.parse(JSON.stringify(loaded.api.normalizeServices({
      'service-3': { name: 'paid media audit' },
      'service-2': { raw: 'Creative Strategy Sprint' },
      'service-1': { name: 'Paid Media Audit' },
      count: 2,
      updated_at: '2026-08-24',
      service_slots: ['Not a service'],
      services: ['Also not a service'],
    }))),
    ['Paid Media Audit', 'Creative Strategy Sprint'],
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(loaded.api.normalizeServices([
      'Service 1',
      { name: 'service-2' },
      { label: 'SERVICE_3' },
      'Paid Media Audit',
    ]))),
    ['Paid Media Audit'],
  )

  loaded.form.fields.serviceSelect.value = 'Service 2'
  assert.equal(loaded.api.renderServices(loaded.form, [
    'Service 1',
    'Paid Media Audit',
    { label: 'Service 3' },
  ]), true)
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => [option.value, option.textContent]),
    [
      ['', 'Select one...'],
      ['Freelance work', 'Freelance work'],
      ['Monthly retainer', 'Monthly retainer'],
      ['Paid Media Audit', 'Paid Media Audit'],
    ],
  )
  assert.equal(loaded.form.fields.serviceSelect.value, '')
})

test('authored generic service slots stay removed for an empty list and a failed profile request', async () => {
  let rejectProfile
  const loaded = load({
    noDocument: true,
    starterProfile: () => new Promise((resolve, reject) => { rejectProfile = reject }),
  })
  const validAuthored = ['Select one...', 'Freelance work', 'Monthly retainer']
  const labels = () => loaded.form.fields.serviceSelect.options.map((option) => option.textContent)

  assert.equal(loaded.api.renderServices(loaded.form, []), true)
  assert.deepEqual(labels(), validAuthored)

  const request = loaded.api.loadProfile(loaded.form, loaded.window, true)
  assert.deepEqual(labels(), validAuthored)

  await Promise.resolve()
  rejectProfile(new Error('services unavailable'))
  assert.equal(await request, null)
  assert.deepEqual(labels(), validAuthored)
})

test('a profile response without services keeps only valid authored service options', async () => {
  const loaded = load({ noDocument: true, profile: { full_name: 'Starter Person' } })

  assert.equal((await loaded.api.loadProfile(loaded.form, loaded.window)).full_name, 'Starter Person')
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.textContent),
    ['Select one...', 'Freelance work', 'Monthly retainer'],
  )
})

test('a member scope change drops the previous Starter services without restoring generic slots', async () => {
  const loaded = load({ profile: { services: ['CRM Strategy'] } })

  await loaded.api.loadProfile(loaded.form, loaded.window, true)
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.textContent),
    ['Select one...', 'Freelance work', 'Monthly retainer', 'CRM Strategy'],
  )

  loaded.window.listeners['opp30:member-scope-reset']({ detail: { memberId: 'member-b' } })

  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.textContent),
    ['Select one...', 'Freelance work', 'Monthly retainer'],
  )
})

test('opening the modal loads the authenticated Starter services', async () => {
  const loaded = load({
    profile: { services: [{ name: 'CRM Strategy' }, { name: 'Lifecycle Build' }] },
  })

  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  await loaded.api.loadProfile(loaded.form, loaded.window)

  assert.equal(loaded.calls.profile.length, 1)
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.textContent),
    ['Select one...', 'Freelance work', 'Monthly retainer', 'CRM Strategy', 'Lifecycle Build'],
  )
})

test('the Opp30 starterProfile method stays the primary path and never reaches the auth bridge', async () => {
  const loaded = load({ noDocument: true, profile: { services: [{ name: 'CRM Strategy' }] } })
  const requests = []
  let tokenCalls = 0
  loaded.window.getXanoAuthToken = async () => {
    tokenCalls += 1
    return 'xano-token'
  }
  loaded.window.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ services: ['Should never load'] }) }
  }

  await loaded.api.loadProfile(loaded.form, loaded.window, true)

  assert.equal(loaded.calls.profile.length, 1)
  assert.equal(tokenCalls, 0)
  assert.deepEqual(requests, [])
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.textContent),
    ['Select one...', 'Freelance work', 'Monthly retainer', 'CRM Strategy'],
  )
})

test('loads Starter services through the shared Xano auth bridge when the cached API lacks starterProfile', async () => {
  const loaded = load({ noDocument: true })
  const requests = []
  let tokenCalls = 0
  delete loaded.window.Opp30.API.starterProfile
  loaded.window.getXanoAuthToken = async () => {
    tokenCalls += 1
    return 'xano-token'
  }
  loaded.window.fetch = async (url, options) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({ services: [{ name: 'CRM Strategy' }] }),
    }
  }

  await loaded.api.loadProfile(loaded.form, loaded.window, true)

  assert.equal(tokenCalls, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/starter/profile/me')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer xano-token')
  assert.equal(requests[0].options.body, '{}')
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => [option.value, option.textContent]),
    [
      ['', 'Select one...'],
      ['Freelance work', 'Freelance work'],
      ['Monthly retainer', 'Monthly retainer'],
      ['CRM Strategy', 'CRM Strategy'],
    ],
  )
})

test('a blank shared token issues no fallback request and keeps only valid authored service slots', async () => {
  const loaded = load({ noDocument: true })
  const authored = ['Select one...', 'Freelance work', 'Monthly retainer']
  const requests = []
  delete loaded.window.Opp30.API.starterProfile
  loaded.window.getXanoAuthToken = async () => '   '
  loaded.window.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ services: ['Should never load'] }) }
  }

  assert.equal(await loaded.api.loadProfile(loaded.form, loaded.window, true), null)

  assert.deepEqual(requests, [])
  assert.deepEqual(loaded.form.fields.serviceSelect.options.map((option) => option.textContent), authored)
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.value),
    ['', 'Freelance work', 'Monthly retainer'],
  )
  assert.deepEqual(loaded.calls.submit, [])
})

test('a missing shared auth bridge issues no fallback request and keeps only valid authored service slots', async () => {
  const loaded = load({ noDocument: true })
  const authored = ['Select one...', 'Freelance work', 'Monthly retainer']
  const requests = []
  delete loaded.window.Opp30.API.starterProfile
  loaded.window.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ services: ['Should never load'] }) }
  }

  assert.equal(await loaded.api.loadProfile(loaded.form, loaded.window, true), null)

  assert.deepEqual(requests, [])
  assert.deepEqual(loaded.form.fields.serviceSelect.options.map((option) => option.textContent), authored)
  assert.deepEqual(loaded.calls.submit, [])
})

test('a non-ok fallback response with a non-JSON body keeps only valid authored service slots', async () => {
  const loaded = load({ noDocument: true })
  const authored = ['Select one...', 'Freelance work', 'Monthly retainer']
  const requests = []
  delete loaded.window.Opp30.API.starterProfile
  loaded.window.getXanoAuthToken = async () => 'xano-token'
  loaded.window.fetch = async (url, options) => {
    requests.push({ url, options })
    return {
      ok: false,
      status: 502,
      json: async () => { throw new Error('Unexpected token < in JSON at position 0') },
    }
  }

  assert.equal(await loaded.api.loadProfile(loaded.form, loaded.window, true), null)

  assert.equal(requests.length, 1)
  assert.deepEqual(loaded.form.fields.serviceSelect.options.map((option) => option.textContent), authored)
  assert.deepEqual(
    loaded.form.fields.serviceSelect.options.map((option) => option.value),
    ['', 'Freelance work', 'Monthly retainer'],
  )
  assert.deepEqual(loaded.calls.submit, [])
})

test('a 401 fallback response with a JSON error body keeps only valid authored service slots', async () => {
  const loaded = load({ noDocument: true })
  const authored = ['Select one...', 'Freelance work', 'Monthly retainer']
  const requests = []
  delete loaded.window.Opp30.API.starterProfile
  loaded.window.getXanoAuthToken = async () => 'xano-token'
  loaded.window.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) }
  }

  assert.equal(await loaded.api.loadProfile(loaded.form, loaded.window, true), null)

  assert.equal(requests.length, 1)
  assert.deepEqual(loaded.form.fields.serviceSelect.options.map((option) => option.textContent), authored)
  assert.deepEqual(loaded.calls.submit, [])
})

test('profile loading clears authored identity and stays clear on failure', async () => {
  let rejectProfile
  const loaded = load({
    noDocument: true,
    starterProfile: () => new Promise((resolve, reject) => { rejectProfile = reject }),
  })
  const photo = new Element({
    tagName: 'img',
    element: 'profile_photo',
    src: 'https://example.com/authored.jpg',
    srcset: 'https://example.com/authored-2x.jpg 2x',
    alt: 'Authored Starter',
  })
  const name = new Element({ element: 'full_name', textContent: 'Authored Starter' })
  const role = new Element({ element: 'role_name', textContent: 'Authored role' })
  const headline = new Element({ element: 'professional_headline', textContent: 'Authored headline' })
  const summary = new Element({ element: 'freelancer_infromation', textContent: 'Authored summary' })
  loaded.context.profileTargets = [photo, name, role, headline, summary]

  const request = loaded.api.loadProfile(loaded.form, loaded.window)

  assert.equal(photo.getAttribute('src'), null)
  assert.equal(photo.getAttribute('srcset'), null)
  assert.equal(photo.getAttribute('alt'), '')
  assert.equal(name.textContent, '')
  assert.equal(role.textContent, '')
  assert.equal(headline.textContent, '')
  assert.equal(summary.textContent, '')

  await Promise.resolve()
  rejectProfile(new Error('profile unavailable'))
  assert.equal(await request, null)
  assert.equal(name.textContent, '')
  assert.equal(photo.getAttribute('src'), null)
})

test('member reset clears profile identity and rejects stale profile responses', async () => {
  let resolveFirst
  let requestNumber = 0
  const loaded = load({
    starterProfile: () => {
      requestNumber += 1
      if (requestNumber === 1) return new Promise((resolve) => { resolveFirst = resolve })
      return Promise.reject(new Error('member B profile unavailable'))
    },
  })
  const photo = new Element({ tagName: 'img', element: 'profile_photo' })
  const name = new Element({ element: 'full_name' })
  loaded.context.profileTargets = [photo, name]
  loaded.api.renderProfile(loaded.form, {
    full_name: 'Member A',
    profile_photo: 'https://example.com/member-a.jpg',
  })

  const firstRequest = loaded.api.loadProfile(loaded.form, loaded.window, true)
  await Promise.resolve()
  loaded.window.listeners['opp30:member-scope-reset']({ detail: { memberId: 'member-b' } })

  assert.equal(name.textContent, '')
  assert.equal(photo.getAttribute('src'), null)

  resolveFirst({ full_name: 'Member A', profile_photo: 'https://example.com/member-a.jpg' })
  assert.equal(await firstRequest, null)
  assert.equal(name.textContent, '')

  assert.equal(await loaded.api.loadProfile(loaded.form, loaded.window), null)
  assert.equal(name.textContent, '')
  assert.equal(photo.getAttribute('src'), null)
})

test('promotes the detached shared Contract Generation form into Starter context', async () => {
  const loaded = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
  })
  const old = new Element({ tagName: 'dialog', 'data-modal-target': 'start-project' })
  old.form = new Element({ tagName: 'form' })
  const shared = new Element({ tagName: 'dialog', 'data-modal-target': 'generate-contract' })
  shared.form = formFixture().form
  const confirm = attachConfirm(shared.form)
  const otherSubmitter = new Element({ tagName: 'button', type: 'submit', disabled: true })
  otherSubmitter.form = shared.form
  shared.form.controls.push(otherSubmitter)
  shared.form.dialog = shared
  shared.form.context = shared
  const marker = new Element({ tagName: 'img', element: 'profile_photo' })
  marker.dialog = shared
  const nestedLink = new Element({ href: '/opportunities-freelancer-view', className: 'clickable_link' })
  const dialogs = [old, shared]
  const document = {
    querySelector(selector) {
      if (selector === '[data-project-form-v3="starter"]') {
        return dialogs.find((dialog) => dialog.getAttribute('data-project-form-v3') === 'starter') || null
      }
      if (selector.includes('dialog[data-modal-target="generate-contract"]')) return marker
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'dialog[data-modal-target="start-project"]') {
        return dialogs.filter((dialog) => dialog.getAttribute('data-modal-target') === 'start-project')
      }
      if (selector === '[data-modal-trigger="start-project"] a.clickable_link') return [nestedLink]
      return []
    },
  }

  assert.equal(loaded.api.normalizeModalMarkup(document), true)
  assert.equal(shared.getAttribute('data-project-form-v3'), 'starter')
  assert.equal(shared.getAttribute('data-modal-target'), 'start-project')
  assert.equal(old.getAttribute('data-modal-target'), 'start-project-legacy-disabled-1')
  assert.equal(shared.form.getAttribute('data-starters-turnstile-fix'), 'true')
  assert.equal(confirm.disabled, true)
  assert.equal(confirm.getAttribute('aria-disabled'), 'true')
  assert.equal(otherSubmitter.disabled, true)
  assert.equal(otherSubmitter.getAttribute('aria-disabled'), null)
  confirm.disabled = false
  loaded.flushDisabledMutation(shared.form)
  assert.equal(confirm.disabled, true)
  assert.equal(otherSubmitter.disabled, true)
  await loaded.api.loadOptions(shared.form, loaded.window)
  assert.equal(shared.form.getAttribute('data-starter-project-status'), 'ready')
  assert.equal(confirm.disabled, false)
  assert.equal(otherSubmitter.disabled, true)
  assert.equal(shared.form.fields.select.required, true)
  assert.equal(shared.form.fields.select.getAttribute('data-project-field'), 'brand_id')
  assert.equal(nestedLink.getAttribute('href'), '#start-project')
})

test('normalizes, deduplicates, and sorts eligible Brands by stable Xano ID', () => {
  const { api } = load({ noDocument: true })
  const options = api.normalizeOptions({ counterparties: [
    { counterparty_id: 9, company_name: 'Zulu', hiring_manager_name: 'Zoe' },
    { counterparty_id: 4, company_name: 'Alpha', hiring_manager_name: 'Amy', email: 'not-returned@example.com' },
    { counterparty_id: 9, company_name: 'Duplicate' },
    { counterparty_id: 0, company_name: 'Invalid' },
    { counterparty_id: 6, company_name: 'Missing manager' },
    { counterparty_id: 7, hiring_manager_name: 'Missing company' },
  ] })
  assert.deepEqual(JSON.parse(JSON.stringify(options)), [
    { id: 4, label: 'Alpha — Amy', company_name: 'Alpha', manager_name: 'Amy' },
    { id: 6, label: 'Missing manager', company_name: 'Missing manager', manager_name: '' },
    { id: 9, label: 'Zulu — Zoe', company_name: 'Zulu', manager_name: 'Zoe' },
  ])
  assert.equal(Object.prototype.hasOwnProperty.call(options[0], 'email'), false)
})

test('keeps every legacy Start a Project modal disabled without the shared marker', () => {
  const { api } = load({ noDocument: true })
  const legacy = new Element({ 'data-modal-target': 'start-project' })
  legacy.form = new Element()
  const legacyWithNativeForm = new Element({ 'data-modal-target': 'start-project' })
  legacyWithNativeForm.form = formFixture().form
  legacyWithNativeForm.setAttribute('data-project-form-v3', 'starter')
  const nestedLink = new Element({ href: '/opportunities-freelancer-view', className: 'clickable_link' })
  const document = {
    querySelector() { return null },
    querySelectorAll(selector) {
      if (selector === 'dialog[data-modal-target="start-project"]') return [legacy, legacyWithNativeForm]
      if (selector === '[data-modal-trigger="start-project"] a.clickable_link') return [nestedLink]
      return []
    },
  }

  assert.equal(api.normalizeModalMarkup(document), false)
  assert.equal(legacy.getAttribute('data-modal-target'), 'start-project-legacy-disabled-1')
  assert.equal(legacyWithNativeForm.getAttribute('data-modal-target'), 'start-project-legacy-disabled-2')
  assert.equal(nestedLink.getAttribute('href'), '#start-project')
})

test('disables every target when no modal has the native V3 form contract', () => {
  const { api } = load({ noDocument: true })
  const first = new Element({ 'data-modal-target': 'start-project' })
  first.form = new Element()
  const second = new Element({ 'data-modal-target': 'start-project' })
  second.form = new Element()
  const document = {
    querySelectorAll(selector) {
      if (selector === 'dialog[data-modal-target="start-project"]') return [first, second]
      return []
    },
  }

  assert.equal(api.normalizeModalMarkup(document), false)
  assert.equal(first.getAttribute('data-modal-target'), 'start-project-legacy-disabled-1')
  assert.equal(second.getAttribute('data-modal-target'), 'start-project-legacy-disabled-2')
})

test('selecting a Brand stores its ID and clears stale sample email', () => {
  const { api, context, form } = load({ noDocument: true })
  const selected = { id: 12, label: 'Acme — Jai', company_name: 'Acme', manager_name: 'Jai' }
  assert.equal(api.selectBrand(form, selected), true)
  assert.equal(form.fields.brandId.value, '12')
  assert.equal(form.fields.select.value, '12')
  assert.equal(form.fields.company.value, 'Acme')
  assert.equal(form.fields.manager.value, 'Jai')
  assert.equal(form.fields.email.value, '')
  assert.equal(context.profileTargets[0].hidden, true)
  assert.equal(context.profileTargets[1].textContent, 'Jai')
  assert.equal(context.profileTargets[2].textContent, 'Acme')
  assert.equal(context.profileTargets[3].hidden, true)
  assert.equal(context.profileTargets[5].hidden, true)
})

test('selected Brand personalizes Party copy and clearing restores neutral copy', () => {
  const { api, context, form } = load({ noDocument: true })

  api.prepareStarterContext(form)
  api.selectBrand(form, { id: 12, company_name: 'Acme', manager_name: 'Dana Reyes' })
  assert.deepEqual(context.copyTargets.slice(-2).map((element) => element.textContent), [
    'Dana',
    'Message Dana',
  ])

  api.selectBrand(form, { id: 13, company_name: 'Northwind Coffee', manager_name: '   ' })
  assert.deepEqual(context.copyTargets.slice(-2).map((element) => element.textContent), [
    'Northwind Coffee',
    'Message Northwind Coffee',
  ])

  api.clearSelectedBrand(form)
  assert.deepEqual(context.copyTargets.slice(-2).map((element) => element.textContent), [
    'Party',
    'Message Party',
  ])
})

test('an eligible Brand without a manager name uses its company for Party copy', async () => {
  const { api, calls, context, form, window } = load({
    counterparties: [{ counterparty_id: 13, company_name: 'Northwind Coffee', hiring_manager_name: '   ' }],
  })

  const options = await api.loadOptions(form, window)

  assert.equal(calls.options.length, 1)
  assert.equal(options.length, 1)
  assert.equal(form.fields.select.value, '13')
  assert.equal(form.fields.brandId.value, '13')
  assert.equal(form.fields.select.options[1].textContent, 'Northwind Coffee')
  assert.deepEqual(context.copyTargets.slice(-2).map((element) => element.textContent), [
    'Northwind Coffee',
    'Message Northwind Coffee',
  ])
})

test('prepares Starter-specific copy and dashboard destination without changing native markup', () => {
  const { api, context, form } = load({ noDocument: true })

  assert.equal(api.prepareStarterContext(form), true)

  assert.deepEqual(context.copyTargets.map((element) => element.textContent), [
    'Selected Brand:',
    'Starting a project lets you work with a Brand on The Starters',
    'Define the scope, agree on terms, and get to work. After the project is created, both parties can review and sign the contract.',
    'Add the project scope you agreed with the Brand',
    'The share of the total project cost the Brand will pay before work begins (0–100%).',
    'The contract will continue until you or the Brand ends the project',
    'The contract will continue until you or the Brand ends the project',
    'Party',
    'Message Party',
  ])
  assert.equal(context.successLinks[0].getAttribute('href'), '/starter-dashboard#projects')
})

test('auto-selection and user selection use native select behavior without re-entry', async () => {
  const { api, calls, form, window } = load({
    counterparties: [{ counterparty_id: 14, company_name: 'Only Brand', hiring_manager_name: 'Manager' }],
  })
  const options = await api.loadOptions(form, window)
  assert.equal(calls.options.length, 1)
  assert.equal(JSON.stringify(calls.options[0]), '{}')
  assert.equal(options.length, 1)
  assert.equal(form.fields.brandId.value, '14')
  assert.equal(form.fields.select.value, '14')
  assert.equal(form.fields.select.options.length, 2)
  assert.equal(form.getAttribute('data-starter-project-status'), 'ready')
  assert.deepEqual(form.fields.select.events, [])

  const multiple = load({ counterparties: [
    { counterparty_id: 14, company_name: 'Only Brand', hiring_manager_name: 'Manager' },
    { counterparty_id: 15, company_name: 'Second Brand', hiring_manager_name: 'Owner' },
  ] })
  await multiple.api.loadOptions(multiple.form, multiple.window)
  multiple.form.fields.select.value = '15'
  multiple.form.fields.select.dispatchEvent(new multiple.window.Event('input', { bubbles: true }))
  assert.equal(multiple.form.fields.brandId.value, '15')
  assert.equal(multiple.form.fields.company.value, 'Second Brand')
  assert.deepEqual(multiple.form.fields.select.events, ['input'])
})

test('no eligible Brands produces a blocked, non-submittable state', async () => {
  const { api, form, window, wrapper } = load({ noDocument: true, counterparties: [] })
  await api.loadOptions(form, window)
  assert.equal(form.getAttribute('data-starter-project-status'), 'blocked')
  assert.match(wrapper.error.textContent, /after a Brand messages you/)
  assert.equal(form.fields.select.options[0].textContent, 'No eligible Brands yet')
  assert.equal(form.fields.select.disabled, true)
})

test('multiple eligible Brands render as native select options and require a choice', async () => {
  const loaded = load({
    counterparties: [
      { counterparty_id: 21, company_name: 'Alpha', hiring_manager_name: 'Alice' },
      { counterparty_id: 22, company_name: 'Beta', hiring_manager_name: 'Bob' },
    ],
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)

  assert.equal(loaded.form.fields.select.disabled, false)
  assert.equal(loaded.form.fields.select.options.length, 3)
  assert.equal(loaded.form.fields.select.options[0].textContent, 'Choose a Brand')
  assert.deepEqual(
    loaded.form.fields.select.options.slice(1).map((option) => [option.value, option.textContent]),
    [['21', 'Alpha — Alice'], ['22', 'Beta — Bob']],
  )
  assert.equal(loaded.form.fields.brandId.value, '')

  loaded.form.fields.select.value = '22'
  loaded.document.listeners.input({ target: loaded.form.fields.select })
  assert.equal(loaded.form.fields.brandId.value, '22')
  assert.equal(loaded.form.fields.company.value, 'Beta')
})

test('Starter payload reuses commercial fields and omits connection type and Starter identity', () => {
  const { api, form, document, window } = load({ noDocument: true })
  api.selectBrand(form, { id: 22, label: 'Brand — Manager', company_name: 'Brand', manager_name: 'Manager' })
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
      return Promise.resolve({ counterparties: [{ counterparty_id: 52, company_name: 'Member B Brand', hiring_manager_name: 'Member B' }] })
    },
  })
  const firstRequest = loaded.api.loadOptions(loaded.form, loaded.window)
  await Promise.resolve()
  loaded.window.listeners['opp30:member-scope-reset']({ detail: { memberId: 'member-b' } })
  resolveFirst({ counterparties: [{ counterparty_id: 51, company_name: 'Member A Brand', hiring_manager_name: 'Member A' }] })
  assert.equal((await firstRequest).length, 0)

  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.fields.brandId.value, '52')
  assert.equal(loaded.form.fields.select.value, '52')
  assert.equal(loaded.form.fields.select.options.length, 2)
})

test('opening the modal refreshes authorized Brands for the same member', async () => {
  let requestNumber = 0
  const loaded = load({
    projectOptions: async () => {
      requestNumber += 1
      return { counterparties: requestNumber === 1
        ? []
        : [{ counterparty_id: 53, company_name: 'Newly Eligible Brand', hiring_manager_name: 'New Member' }] }
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'blocked')

  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)

  assert.equal(requestNumber, 2)
  assert.equal(loaded.form.fields.brandId.value, '53')
  assert.equal(loaded.form.fields.select.value, '53')
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'ready')
})

test('authorization refresh clears the prior Brand label before new options load', async () => {
  let resolveRefresh
  let requestNumber = 0
  const loaded = load({
    projectOptions: () => {
      requestNumber += 1
      if (requestNumber === 1) {
        return Promise.resolve({ counterparties: [{ counterparty_id: 56, company_name: 'Prior Brand', hiring_manager_name: 'Prior Member' }] })
      }
      return new Promise((resolve) => { resolveRefresh = resolve })
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.fields.select.value, '56')

  const refresh = loaded.api.loadOptions(loaded.form, loaded.window, true)
  await Promise.resolve()
  assert.equal(loaded.form.fields.select.value, '')
  assert.equal(loaded.form.fields.brandId.value, '')

  resolveRefresh({ counterparties: [
    { counterparty_id: 57, company_name: 'Current One', hiring_manager_name: 'Member One' },
    { counterparty_id: 58, company_name: 'Current Two', hiring_manager_name: 'Member Two' },
  ] })
  await refresh
  assert.equal(loaded.form.fields.select.value, '')
  assert.equal(loaded.form.fields.select.options.length, 3)
})

test('reopening during an options request supersedes its stale response', async () => {
  let resolveFirst
  let resolveSecond
  let requestNumber = 0
  const loaded = load({
    projectOptions: () => {
      requestNumber += 1
      return new Promise((resolve) => {
        if (requestNumber === 1) resolveFirst = resolve
        else resolveSecond = resolve
      })
    },
  })
  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  await Promise.resolve()
  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  await Promise.resolve()
  assert.equal(requestNumber, 2)

  resolveFirst({ counterparties: [{ counterparty_id: 54, company_name: 'Stale Brand', hiring_manager_name: 'Stale Member' }] })
  await Promise.resolve()
  assert.equal(loaded.form.fields.brandId.value, '')

  resolveSecond({ counterparties: [{ counterparty_id: 55, company_name: 'Current Brand', hiring_manager_name: 'Current Member' }] })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.fields.brandId.value, '55')
  assert.equal(loaded.form.fields.select.value, '55')
  assert.equal(loaded.form.fields.select.options.length, 2)
})

test('submission reports the canonical project and contract-first success state', async () => {
  const loaded = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
  })
  const renderedBrand = new Element()
  loaded.wrapper.success.onAttributeChange = (name, value) => {
    if (name === 'aria-hidden' && value === 'false') {
      renderedBrand.textContent = loaded.form.fields.company.disabled
        ? ''
        : loaded.form.fields.company.value
    }
  }
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(loaded.calls.submit.length, 1)
  assert.equal(loaded.calls.submit[0].brand_id, 31)
  assert.equal(loaded.calls.submit[0].idempotency_key, 'project-key-123')
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.calls.submit[0], 'connection_type'), false)
  assert.equal(loaded.events[0].type, 'starters:project-created')
  assert.equal(loaded.events[0].detail.project_id, 81)
  assert.equal(loaded.tracks[0].name, 'project_created')
  assert.deepEqual(loaded.wrapper.success.successTitles.map((title) => title.textContent), [
    'Project successfully created',
    'Project successfully created',
  ])
  assert.equal(
    loaded.wrapper.success.querySelector('[data-project-success-message]').textContent,
    'Your contract is being prepared. You and the Brand can sign when it is ready.',
  )
  assert.equal(loaded.context.successLinks[0].getAttribute('href'), '/starter-dashboard#projects')
  assert.equal(loaded.wrapper.success.getAttribute('aria-hidden'), 'false')
  assert.equal(renderedBrand.textContent, 'Brand')
})

test('Review then submit restores preview fields without enabling authored disabled fields', async () => {
  const loaded = load({
    counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
  })
  const review = new Element({ 'dx-button': 'review', tagName: 'button' })
  review.form = loaded.form
  const renderedBrand = new Element()
  loaded.wrapper.success.onAttributeChange = (name, value) => {
    if (name === 'aria-hidden' && value === 'false') {
      renderedBrand.textContent = loaded.form.fields.company.disabled
        ? ''
        : loaded.form.fields.company.value
    }
  }

  loaded.api.prepareStarterContext(loaded.form)
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.fields.company.disabled, false)
  assert.equal(loaded.form.fields.email.disabled, true)

  loaded.document.captureListeners.click({ target: review })
  loaded.form.controls.forEach((control) => { control.disabled = true })

  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(renderedBrand.textContent, 'Brand')
  assert.equal(loaded.form.fields.company.disabled, false)
  assert.equal(loaded.form.fields.email.disabled, true)
})

test('delayed Turnstile tokens cannot enable Confirm outside eligible controller states', async () => {
  const fixture = formFixture()
  const confirm = attachConfirm(fixture.form, {
    className: 'clickable_btn w-form-loading',
  })
  const otherSubmitter = new Element({ tagName: 'button', type: 'submit', disabled: true })
  otherSubmitter.form = fixture.form
  fixture.form.controls.push(otherSubmitter)
  let resolveOptions
  const loaded = load({
    fixture,
    projectOptions: () => new Promise((resolve) => { resolveOptions = resolve }),
  })

  const optionsRequest = loaded.api.loadOptions(loaded.form, loaded.window)
  await Promise.resolve()
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'loading')
  assert.equal(otherSubmitter.disabled, true)
  confirm.disabled = false
  loaded.flushDisabledMutation()
  assert.equal(confirm.disabled, true)

  resolveOptions({ counterparties: [] })
  await optionsRequest
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'blocked')
  assert.equal(otherSubmitter.disabled, true)
  confirm.disabled = false
  loaded.flushDisabledMutation()
  assert.equal(confirm.disabled, true)

  const refreshRequest = loaded.api.loadOptions(loaded.form, loaded.window, true)
  await Promise.resolve()
  resolveOptions({ counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }] })
  await refreshRequest
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'ready')
  assert.equal(confirm.disabled, false)
  assert.equal(otherSubmitter.disabled, true)
})

test('Confirm enables only for ready and retryable submit errors', async () => {
  const fixture = formFixture()
  const confirm = attachConfirm(fixture.form)
  const otherSubmitter = new Element({ tagName: 'button', type: 'submit', disabled: true })
  otherSubmitter.form = fixture.form
  fixture.form.controls.push(otherSubmitter)
  let rejectSubmit
  const loaded = load({
    fixture,
    counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
    projectSubmit: () => new Promise((resolve, reject) => { rejectSubmit = reject }),
  })

  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'ready')
  assert.equal(confirm.disabled, false)
  assert.equal(confirm.getAttribute('aria-disabled'), 'false')
  assert.equal(otherSubmitter.disabled, true)
  assert.equal(otherSubmitter.getAttribute('aria-disabled'), null)

  const submission = loaded.api.submit(loaded.form, loaded.window, loaded.document)
  await Promise.resolve()
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'submitting')
  assert.equal(confirm.disabled, true)
  assert.equal(confirm.getAttribute('aria-disabled'), 'true')
  assert.equal(otherSubmitter.disabled, true)
  confirm.disabled = false
  loaded.flushDisabledMutation()
  assert.equal(confirm.disabled, true)

  rejectSubmit(Object.assign(new Error('temporary'), { status: 503 }))
  assert.equal(await submission, false)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'error')
  assert.equal(confirm.disabled, false)
  assert.equal(confirm.getAttribute('aria-disabled'), 'false')
  assert.equal(otherSubmitter.disabled, true)
})

test('Confirm stays disabled for non-retryable errors', async () => {
  const cases = [
    {
      name: 'options load',
      load: { projectOptions: async () => { throw new Error('offline') } },
      run: async (loaded) => loaded.api.loadOptions(loaded.form, loaded.window),
    },
    {
      name: 'validation',
      load: {
        counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
        validationError: () => 'Invalid details',
      },
      run: async (loaded) => {
        await loaded.api.loadOptions(loaded.form, loaded.window)
        return loaded.api.submit(loaded.form, loaded.window, loaded.document)
      },
    },
    {
      name: 'missing service',
      load: { counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }] },
      run: async (loaded) => {
        await loaded.api.loadOptions(loaded.form, loaded.window)
        delete loaded.window.Opp30.API.projectSubmit
        return loaded.api.submit(loaded.form, loaded.window, loaded.document)
      },
    },
    {
      name: 'authorization invalidation',
      load: {
        counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
        projectSubmit: async () => { throw Object.assign(new Error('forbidden'), { status: 403 }) },
      },
      run: async (loaded) => {
        await loaded.api.loadOptions(loaded.form, loaded.window)
        return loaded.api.submit(loaded.form, loaded.window, loaded.document)
      },
    },
    {
      name: 'reload required',
      load: {
        counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
        projectSubmit: async () => { throw Object.assign(new Error('expired'), { status: 401 }) },
      },
      run: async (loaded) => {
        await loaded.api.loadOptions(loaded.form, loaded.window)
        return loaded.api.submit(loaded.form, loaded.window, loaded.document)
      },
    },
  ]

  for (const scenario of cases) {
    const fixture = formFixture()
    const confirm = attachConfirm(fixture.form)
    const loaded = load({ fixture, ...scenario.load })
    await scenario.run(loaded)
    assert.equal(confirm.disabled, true, scenario.name)
    assert.equal(confirm.getAttribute('aria-disabled'), 'true', scenario.name)
    confirm.disabled = false
    loaded.flushDisabledMutation()
    assert.equal(confirm.disabled, true, scenario.name + ' after delayed token')
  }
})

test('Review Edit fee change refreshes preview controls and preserves authored disabled fields', async () => {
  const loaded = load({
    counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
  })
  const review = new Element({ 'dx-button': 'review', tagName: 'button' })
  const edit = new Element({ 'dx-button': 'edit', tagName: 'button' })
  review.form = loaded.form
  edit.form = loaded.form
  const flatCost = new Element({ value: '1000' })
  const monthlyRate = new Element({ value: '3200', disabled: true })
  flatCost.form = loaded.form
  monthlyRate.form = loaded.form
  loaded.form.controls.push(flatCost, monthlyRate)
  let renderedMonthlyRate = ''
  loaded.wrapper.success.onAttributeChange = (name, value) => {
    if (name === 'aria-hidden' && value === 'false') {
      renderedMonthlyRate = monthlyRate.disabled ? '' : monthlyRate.value
    }
  }

  loaded.api.prepareStarterContext(loaded.form)
  await loaded.api.loadOptions(loaded.form, loaded.window)

  loaded.document.captureListeners.click({ target: review })
  loaded.form.controls.forEach((control) => { control.disabled = true })

  // The legacy Edit handler enables all controls before the document listener
  // reapplies Starter identity state and the selected fee branch changes.
  loaded.form.controls.forEach((control) => { control.disabled = false })
  loaded.document.listeners.click({ target: edit })
  flatCost.disabled = true
  monthlyRate.disabled = false

  loaded.document.captureListeners.click({ target: review })
  loaded.form.controls.forEach((control) => { control.disabled = true })

  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(renderedMonthlyRate, '3200')
  assert.equal(flatCost.disabled, true)
  assert.equal(monthlyRate.disabled, false)
  assert.equal(loaded.form.fields.email.disabled, true)
})

test('Own Contract submission reports immediate activation', async () => {
  let loaded
  loaded = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 31, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
    projectSubmit: async (payload) => {
      loaded.calls.submit.push(payload)
      return { project: { id: 82, lifecycle_state: 'active' }, replayed: false }
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(
    loaded.wrapper.success.querySelector('[data-project-success-message]').textContent,
    'Your project is now active.',
  )
})

test('opening the modal after success restores the form and hides success state', async () => {
  const loaded = load({ counterparties: [{ counterparty_id: 61, company_name: 'Brand', hiring_manager_name: 'Brand Member' }] })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(loaded.form.style.display, 'none')
  assert.equal(loaded.wrapper.success.style.display, 'block')

  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.style.display, '')
  assert.equal(loaded.wrapper.success.hidden, true)
  assert.equal(loaded.wrapper.success.style.display, 'none')
  assert.equal(loaded.form.resetCount, 1)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'ready')
})

test('reopening during submission cannot let an options refresh replace success', async () => {
  let resolveSubmit
  const loaded = load({
    counterparties: [{ counterparty_id: 63, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
    projectSubmit: (payload) => {
      loaded.calls.submit.push(payload)
      return new Promise((resolve) => { resolveSubmit = resolve })
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  const submission = loaded.api.submit(loaded.form, loaded.window, loaded.document)
  await Promise.resolve()

  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  assert.equal(loaded.calls.options.length, 1)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'submitting')

  resolveSubmit({ project: { id: 92, lifecycle_state: 'contract_create_pending' }, replayed: false })
  assert.equal(await submission, true)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'success')

  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(loaded.form.resetCount, 1)
  assert.equal(loaded.form.getAttribute('data-starter-project-status'), 'ready')
})

test('opening after success reinitializes reset current-date fields', async () => {
  const fixture = formFixture()
  const date = new Element({ value: '08/12/2026', 'data-set-current-date-inited': 'true' })
  fixture.form.controls.push(date)
  fixture.form.reset = function () {
    this.resetCount += 1
    date.value = ''
  }
  let fillCalls = 0
  const loaded = load({
    fixture,
    counterparties: [{ counterparty_id: 62, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
    fillCurrentDates: (form) => {
      fillCalls += 1
      if (!date.getAttribute('data-set-current-date-inited') && !date.value) {
        date.value = '08/12/2026'
        date.setAttribute('data-set-current-date-inited', 'true')
      }
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)

  loaded.document.listeners.click({
    target: { closest: (selector) => selector === '[data-modal-trigger="start-project"]' ? {} : null },
  })
  assert.equal(date.value, '08/12/2026')
  assert.equal(date.getAttribute('data-set-current-date-inited'), 'true')
  assert.ok(fillCalls > 0)
})

test('failed retry keeps the same idempotency key', async () => {
  const submitted = []
  let attempt = 0
  const loaded = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 41, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
    projectSubmit: async (payload) => {
      submitted.push({ ...payload })
      attempt += 1
      if (attempt === 1) throw Object.assign(new Error('temporary'), { status: 503 })
      return { project: { id: 91, lifecycle_state: 'contract_create_pending' }, replayed: true }
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.equal(submitted.length, 2)
  assert.equal(submitted[0].idempotency_key, submitted[1].idempotency_key)
})

test('malformed project responses fail and preserve the retry key', async () => {
  const submitted = []
  const responses = [
    { proposal: { id: 72, status: 'awaiting_brand_approval' } },
    { project: { id: 91, lifecycle_state: 'unexpected' } },
    { project: { id: 91, lifecycle_state: 'contract_create_pending' }, replayed: true },
  ]
  const loaded = load({
    noDocument: true,
    counterparties: [{ counterparty_id: 41, company_name: 'Brand', hiring_manager_name: 'Brand Member' }],
    projectSubmit: async (payload) => {
      submitted.push({ ...payload })
      return responses.shift()
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)

  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(loaded.events.length, 0)
  assert.equal(loaded.tracks.length, 0)
  assert.equal(loaded.form.style.display, '')
  assert.match(loaded.wrapper.error.textContent, /could not be created/)

  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), true)
  assert.deepEqual(submitted.map((payload) => payload.idempotency_key), [
    'project-key-123',
    'project-key-123',
    'project-key-123',
  ])
  assert.equal(loaded.events[0].detail.project_id, 91)
})

test('a rejected Brand authorization is invalidated before another submit', async () => {
  let optionsRequest = 0
  const loaded = load({
    noDocument: true,
    projectOptions: async () => {
      optionsRequest += 1
      return { counterparties: optionsRequest === 1
        ? [{ counterparty_id: 42, company_name: 'Revoked Brand', hiring_manager_name: 'Revoked Member' }]
        : [{ counterparty_id: 43, company_name: 'Current Brand', hiring_manager_name: 'Current Member' }] }
    },
    projectSubmit: async (payload) => {
      loaded.calls.submit.push(payload)
      throw Object.assign(new Error('revoked'), { status: 403 })
    },
  })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(loaded.form.fields.brandId.value, '')
  assert.equal(loaded.form.fields.select.disabled, true)
  assert.equal(loaded.form.fields.select.getAttribute('aria-disabled'), 'true')
  assert.match(loaded.wrapper.error.textContent, /no longer eligible/)

  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(loaded.calls.submit.length, 1)

  await loaded.api.loadOptions(loaded.form, loaded.window, true)
  assert.equal(loaded.form.fields.select.disabled, false)
  assert.equal(loaded.form.fields.select.value, '43')
  assert.equal(loaded.form.fields.brandId.value, '43')
})

test('an injected Brand ID cannot bypass the V3 options response', async () => {
  const loaded = load({ noDocument: true, counterparties: [] })
  await loaded.api.loadOptions(loaded.form, loaded.window)
  loaded.form.fields.brandId.value = '999'
  assert.equal(await loaded.api.submit(loaded.form, loaded.window, loaded.document), false)
  assert.equal(loaded.calls.submit.length, 0)
  assert.match(loaded.wrapper.error.textContent, /Select an eligible Brand/)
})
