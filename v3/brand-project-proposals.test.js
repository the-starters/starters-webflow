'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const api = require('./brand-project-proposals.js')

class Element {
  constructor(attrs = {}) {
    this.attrs = { ...attrs }
    this.textContent = attrs.textContent || ''
    this.hidden = Boolean(attrs.hidden)
    this.disabled = false
    this.open = false
    this.style = { display: '' }
    this.parentNode = null
    this.children = []
    this.fields = []
    this.links = []
    this.images = []
    this.actions = {}
    this.feedback = null
    this.confirm = null
    this.focused = false
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return this.attrs[name] ?? null }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) }
  removeAttribute(name) { delete this.attrs[name] }
  focus() { this.focused = true }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this)
  }
  appendChild(element) {
    element.parentNode = this
    this.children.push(element)
    return element
  }
  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }
  matches(selector) {
    if (selector === '*') return true
    if (selector.startsWith('.')) {
      return String(this.getAttribute('class') || '').split(/\s+/).includes(selector.slice(1))
    }
    const exact = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector)
    if (exact) return this.getAttribute(exact[1]) === exact[2]
    const present = /^\[([^\]]+)\]$/.exec(selector)
    if (present) return this.hasAttribute(present[1])
    return false
  }
  cloneNode() {
    const clone = new Element({ ...this.attrs })
    clone.fields = this.fields.map((field) => new Element({ ...field.attrs }))
    clone.links = this.links.map((link) => new Element({ ...link.attrs }))
    clone.images = this.images.map((image) => new Element({ ...image.attrs }))
    return clone
  }
  insertBefore(element, reference) {
    element.parentNode = this
    const index = this.children.indexOf(reference)
    if (index < 0) this.children.push(element)
    else this.children.splice(index, 0, element)
  }
  querySelector(selector) {
    if (selector === '[data-project-proposal-feedback]') return this.feedback
    if (selector === '[data-project-proposal-confirm="reject"]') return this.confirm
    const action = /^\[data-project-proposal-action="([^"]+)"\]$/.exec(selector)
    if (action) return this.actions[action[1]] || null
    if (selector === '[data-project-proposal-heading], h1, h2') return this.heading || null
    return this.descendants().find((element) => selector.split(',').some((part) => element.matches(part.trim()))) || null
  }
  querySelectorAll(selector) {
    if (selector === '[data-project-proposal-field]' && this.fields.length) return this.fields
    if (selector === '[data-project-proposal-link]' && this.links.length) return this.links
    if (selector === '[data-project-proposal-image="starter"]' && this.images.length) return this.images
    if (selector === '[data-project-proposal-action]' && Object.keys(this.actions).length) return Object.values(this.actions)
    if (selector === '[data-project-proposal-card]') {
      return this.children.filter((child) => child.hasAttribute('data-project-proposal-card'))
    }
    return this.descendants().filter((element) => selector.split(',').some((part) => element.matches(part.trim())))
  }
}

function fallbackDocument() {
  const head = new Element()
  const body = new Element()
  return {
    head,
    body,
    createElement() { return new Element() },
    getElementById(id) {
      return [...head.descendants(), ...body.descendants()].find((element) => element.id === id) || null
    },
  }
}

function proposal(overrides = {}) {
  return {
    proposal_id: 41,
    lifecycle_version: 3,
    status: 'awaiting_brand_approval',
    can_accept: true,
    can_reject: true,
    created_at: '2026-08-12T03:00:00Z',
    starter_id: 82,
    starter_name: 'Alex Starter',
    title: 'Retention launch',
    service: 'Email Marketing',
    project_scope: 'Build and launch the retention program.',
    engagement_type: 'monthly',
    monthly_rate: 2500,
    number_of_months: 3,
    contract_type: 'standard_contract',
    invoice_frequency: 'monthly',
    start_date: '2026-08-20',
    ...overrides,
  }
}

function controllerFixture(options = {}) {
  const template = new Element({ 'data-project-proposal-template': '' })
  template.fields = [new Element({ 'data-project-proposal-field': 'starter_name' })]
  const list = new Element()
  list.children = [template]
  template.parentNode = list

  const modal = new Element({ 'data-modal-target': 'review-project-request' })
  modal.feedback = new Element()
  modal.confirm = new Element()
  modal.heading = new Element()
  for (const name of ['accept', 'reject', 'reject-confirm', 'reject-cancel', 'message']) {
    modal.actions[name] = new Element({ 'data-project-proposal-action': name })
  }
  const globalFeedback = new Element()
  const dispatched = []
  const listeners = {}
  const documentObject = {
    addEventListener(name, handler) { listeners[name] = handler },
    removeEventListener(name) { delete listeners[name] },
    dispatchEvent(event) { dispatched.push(event) },
    querySelector(selector) {
      return selector === '[data-project-proposal-global-feedback]' ? globalFeedback : null
    },
  }
  const globalObject = {
    crypto: { randomUUID: () => 'decision-key' },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail }
    },
    dispatchEvent() {},
    lumos: { modal: { list: { 'review-project-request': {
      open() { modal.open = true },
      close() { modal.open = false },
    } } } },
  }
  const projection = { status: 'success', data: { project_proposals: [proposal()] } }
  const instance = options.instance || {
    subscribe() { return () => {} },
    getState() { return projection },
    async refresh() {},
  }
  const calls = []
  const requestApi = options.api || {
    async projectProposalAction(payload) {
      calls.push(payload)
      return { proposal: { id: 41 }, project: { id: 95 }, replayed: false }
    },
  }
  const controller = api.createController({
    globalObject,
    documentObject,
    list,
    template,
    modal,
    api: requestApi,
    instance,
  })
  return { calls, controller, dispatched, globalFeedback, list, modal, projection }
}

test('normalizes only actionable pending proposals with positive lifecycle versions', () => {
  const normalized = api.normalizeProposals({ project_proposals: [
    proposal({ proposal_id: 2, created_at: '2026-08-10T00:00:00Z' }),
    proposal({ proposal_id: 3, created_at: '2026-08-12T00:00:00Z', can_accept: false }),
    proposal({ proposal_id: 4, lifecycle_version: 0 }),
    proposal({ proposal_id: 5, status: 'accepted' }),
    proposal({ proposal_id: 6, can_accept: false, can_reject: false }),
    proposal({ proposal_id: 3, title: 'Duplicate' }),
  ] })
  assert.deepEqual(normalized.map((item) => item.id), [3, 2])
  assert.equal(normalized[0].can_reject, true)
})

test('formats each supported commercial model without exposing editable state', () => {
  assert.equal(api.commercialSummary(api.normalizeProposal(proposal())), '$2,500/month · 3 months')
  assert.equal(api.commercialSummary(api.normalizeProposal(proposal({
    engagement_type: 'flat_fee', total_cost: 1200, paid_upfront_pct: 25,
  }))), '$1,200 flat fee · 25% upfront')
  assert.equal(api.commercialSummary(api.normalizeProposal(proposal({
    engagement_type: 'hourly', hourly_rate: 75, hourly_billing_frequency: 'weekly', maximum_hours_per_week: 20,
  }))), '$75/hr · Up to 20 hrs/week')
  assert.equal(api.commercialSummary(api.normalizeProposal(proposal({
    engagement_type: 'weekly', weekly_rate: 900, number_of_weeks: 0,
  }))), '$900/week · Ongoing')
})

test('builds a minimal versioned decision command', () => {
  const normalized = api.normalizeProposal(proposal())
  assert.deepEqual(api.decisionPayload(normalized, 'accept', 'retry-1'), {
    proposal_id: 41,
    expected_version: 3,
    action: 'accept',
    idempotency_key: 'retry-1',
  })
  assert.throws(() => api.decisionPayload(normalized, 'edit', 'retry-1'), /Unsupported/)
})

test('renders proposal rows as Action Items from the authored template', () => {
  const fixture = controllerFixture()
  const rows = fixture.controller.render(fixture.projection)
  assert.equal(rows.length, 1)
  assert.equal(fixture.list.children.length, 2)
  const card = fixture.list.children[0]
  assert.equal(card.getAttribute('data-project-proposal-id'), '41')
  assert.equal(card.getAttribute('data-action-element'), 'item')
  assert.equal(card.fields[0].textContent, 'Alex Starter')
  assert.equal(fixture.list.children[1].hidden, true)
})

test('builds a complete read-only review dialog when Designer markup is absent', () => {
  const documentObject = fallbackDocument()
  const modal = api.createFallbackReviewModal(documentObject)
  assert.ok(modal)
  assert.equal(modal.getAttribute('data-modal-target'), 'review-project-request')
  assert.equal(modal.getAttribute('data-project-proposal-generated'), 'true')
  assert.equal(modal.heading.textContent, 'Review project request')
  assert.equal(modal.actions.accept.textContent, 'Approve & Create Project')
  assert.equal(modal.actions.reject.textContent, 'Decline Request')
  assert.equal(modal.actions.message.textContent, 'Message Starter')
  assert.equal(modal.actions['reject-confirm'].textContent, 'Decline Request')
  assert.equal(modal.confirm.hidden, true)
  assert.equal(documentObject.body.children.includes(modal), true)

  api.paintFields(modal, api.normalizeProposal(proposal({
    starter_profile_url: '/starters/alex',
    message_url: '/messages/alex',
  })))
  assert.equal(modal.fields.find((field) => field.getAttribute('data-project-proposal-field') === 'title').textContent, 'Retention launch')
  assert.equal(modal.actions.message.getAttribute('href'), '/messages/alex')
})

test('adds one persistent Action Items feedback region when none is authored', () => {
  const documentObject = fallbackDocument()
  const list = new Element()
  const first = api.ensureGlobalFeedback(documentObject, list)
  assert.ok(first)
  assert.equal(first.getAttribute('data-project-proposal-global-feedback'), '')
  assert.equal(first.getAttribute('aria-live'), 'polite')
  assert.equal(first.hidden, true)

  documentObject.querySelector = (selector) => selector === '[data-project-proposal-global-feedback]' ? first : null
  const second = api.ensureGlobalFeedback(documentObject, list)
  assert.equal(second, first)
  assert.equal(list.children.length, 1)
})

test('adapts the existing Action Items row when nested proposal attributes are absent', () => {
  const card = new Element()
  const label = card.appendChild(new Element({ class: 'label_text', textContent: 'Onboarding' }))
  const title = card.appendChild(new Element({ class: 'action-item_title', textContent: 'Have great talent come to you.' }))
  const review = card.appendChild(new Element({ class: 'button_main-wrap' }))
  review.appendChild(new Element({ textContent: 'Post Opportunity' }))
  const dismiss = card.appendChild(new Element({ class: 'button_main-wrap' }))
  dismiss.appendChild(new Element({ textContent: 'Dismiss' }))

  api.prepareFallbackCard(card)
  assert.equal(label.getAttribute('data-project-proposal-field'), 'status_label')
  assert.equal(title.getAttribute('data-project-proposal-field'), 'title')
  assert.equal(review.hasAttribute('data-project-proposal-open'), true)
  assert.equal(review.children[0].textContent, 'Review request')
  assert.equal(dismiss.hidden, true)
})

test('proposal links expose only safe relative or HTTP destinations', () => {
  const scope = new Element()
  const profile = new Element({ 'data-project-proposal-link': 'profile', href: '/stale' })
  const message = new Element({ 'data-project-proposal-link': 'message', href: '/stale' })
  scope.links = [profile, message]

  api.paintFields(scope, api.normalizeProposal(proposal({
    starter_profile_url: 'javascript:alert(1)',
    message_url: '/messages/thread-41',
  })))
  assert.equal(profile.hasAttribute('href'), false)
  assert.equal(profile.hidden, true)
  assert.equal(message.getAttribute('href'), '/messages/thread-41')
  assert.equal(message.hidden, false)

  api.paintFields(scope, api.normalizeProposal(proposal({
    starter_profile_url: 'https://thestarters.com/starters/82',
    message_url: 'java\nscript:alert(1)',
  })))
  assert.equal(profile.getAttribute('href'), 'https://thestarters.com/starters/82')
  assert.equal(message.hasAttribute('href'), false)
  assert.equal(message.hidden, true)
})

test('accept sends the authorized command and keeps success feedback outside the closing modal', async () => {
  const fixture = controllerFixture()
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])
  assert.equal(await fixture.controller.act('accept'), true)
  assert.deepEqual(fixture.calls[0], {
    proposal_id: 41,
    expected_version: 3,
    action: 'accept',
    idempotency_key: 'project-proposal-ui:41:3:accept:decision-key',
  })
  assert.equal(fixture.globalFeedback.textContent, 'Project approved and created.')
  assert.equal(fixture.dispatched[0].type, 'starters:project-proposal-accepted')
  assert.equal(fixture.dispatched[0].detail.project_id, 95)

  fixture.controller.open(fixture.controller.state.proposals[0])
  assert.equal(fixture.modal.actions.accept.hidden, true)
  assert.match(fixture.modal.feedback.textContent, /already handled/)
})

test('a failed retry reuses its idempotency key and maps stale conflicts safely', async () => {
  const calls = []
  let attempt = 0
  let refreshes = 0
  const fixture = controllerFixture({
    api: {
      async projectProposalAction(payload) {
        calls.push(payload)
        attempt += 1
        if (attempt === 1) throw Object.assign(new Error('raw backend detail'), { status: 500 })
        throw Object.assign(new Error('raw stale detail'), { status: 409 })
      },
    },
    instance: {
      subscribe() { return () => {} },
      getState() { return { status: 'success', project_proposals: [proposal()] } },
      async refresh() { refreshes += 1 },
    },
  })
  fixture.controller.render({ project_proposals: [proposal()] })
  fixture.controller.open(fixture.controller.state.proposals[0])
  assert.equal(await fixture.controller.act('reject'), false)
  assert.equal(await fixture.controller.act('reject'), false)
  assert.equal(calls[0].idempotency_key, calls[1].idempotency_key)
  assert.equal(refreshes, 1)
  assert.match(fixture.modal.feedback.textContent, /changed or was already handled/)
  assert.doesNotMatch(fixture.modal.feedback.textContent, /raw stale detail/)
})

test('every mapped action error remains visible after the modal closes', async () => {
  const fixture = controllerFixture({
    api: {
      async projectProposalAction() {
        throw Object.assign(new Error('raw backend detail'), { status: 422 })
      },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])
  assert.equal(await fixture.controller.act('accept'), false)
  assert.match(fixture.modal.feedback.textContent, /could not be approved/)
  assert.equal(fixture.globalFeedback.textContent, fixture.modal.feedback.textContent)
  assert.equal(fixture.globalFeedback.getAttribute('role'), 'alert')

  fixture.controller.close()
  assert.equal(fixture.modal.feedback.textContent, '')
  assert.match(fixture.globalFeedback.textContent, /could not be approved/)
  assert.equal(fixture.globalFeedback.hidden, false)
})

test('an unavailable action service reports persistent feedback', async () => {
  const fixture = controllerFixture({ api: {} })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])
  assert.equal(await fixture.controller.act('accept'), false)
  assert.match(fixture.modal.feedback.textContent, /not available/)
  assert.equal(fixture.globalFeedback.textContent, fixture.modal.feedback.textContent)

  fixture.controller.close()
  assert.equal(fixture.modal.feedback.textContent, '')
  assert.match(fixture.globalFeedback.textContent, /not available/)
  assert.equal(fixture.globalFeedback.getAttribute('role'), 'alert')
})

test('an in-flight request keeps later proposal actions locked until it settles', async () => {
  let settleFirst
  const calls = []
  const proposals = [proposal(), proposal({ proposal_id: 42, title: 'Lifecycle audit' })]
  const projection = { status: 'success', data: { project_proposals: proposals } }
  const fixture = controllerFixture({
    api: {
      async projectProposalAction(payload) {
        calls.push(payload)
        if (calls.length === 1) {
          return new Promise((resolve) => { settleFirst = resolve })
        }
        return { proposal: { id: 42 }, replayed: false }
      },
    },
    instance: {
      subscribe() { return () => {} },
      getState() { return projection },
      async refresh() {},
    },
  })
  fixture.controller.render(projection)
  fixture.controller.open(fixture.controller.state.proposals.find((item) => item.id === 41))
  const firstAction = fixture.controller.act('accept')

  fixture.controller.close()
  fixture.controller.open(fixture.controller.state.proposals.find((item) => item.id === 42))
  assert.equal(fixture.modal.actions.accept.disabled, true)
  assert.equal(await fixture.controller.act('reject'), false)
  assert.equal(calls.length, 1)

  settleFirst({ proposal: { id: 41 }, project: { id: 95 }, replayed: false })
  assert.equal(await firstAction, true)
  assert.equal(fixture.controller.state.active.id, 42)
  assert.equal(fixture.modal.actions.accept.disabled, false)
  assert.equal(fixture.modal.feedback.textContent, '')
  assert.equal(await fixture.controller.act('reject'), true)
  assert.equal(calls.length, 2)
})

test('member reset clears pending cards and retry state', () => {
  const fixture = controllerFixture()
  fixture.controller.render(fixture.projection)
  fixture.controller.state.keys.test = 'key'
  fixture.controller.state.resolved[41] = true
  fixture.globalFeedback.textContent = 'Project approved and created.'
  fixture.globalFeedback.hidden = false
  fixture.controller.reset()
  assert.equal(fixture.controller.state.proposals.length, 0)
  assert.deepEqual(fixture.controller.state.keys, {})
  assert.deepEqual(fixture.controller.state.resolved, {})
  assert.equal(fixture.list.children.length, 1)
  assert.equal(fixture.globalFeedback.textContent, '')
  assert.equal(fixture.globalFeedback.hidden, true)
})

test('a projection version change closes stale modal terms and announces the refresh', () => {
  const fixture = controllerFixture()
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])
  assert.equal(fixture.modal.open, true)
  fixture.controller.render({ project_proposals: [proposal({ lifecycle_version: 4 })] })
  assert.equal(fixture.modal.open, false)
  assert.match(fixture.globalFeedback.textContent, /changed/)
  assert.equal(fixture.controller.state.active, null)
})

test('an open modal repaints action controls from refreshed server capabilities', () => {
  const fixture = controllerFixture()
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])
  assert.equal(fixture.modal.actions.accept.hidden, false)
  assert.equal(fixture.modal.actions.reject.hidden, false)

  fixture.controller.render({ project_proposals: [proposal({ can_accept: false, can_reject: true })] })
  assert.equal(fixture.controller.state.active.can_accept, false)
  assert.equal(fixture.modal.actions.accept.hidden, true)
  assert.equal(fixture.modal.actions.reject.hidden, false)
  assert.equal(fixture.modal.actions['reject-confirm'].hidden, false)

  fixture.controller.render({ project_proposals: [proposal({ can_accept: true, can_reject: false })] })
  assert.equal(fixture.modal.actions.accept.hidden, false)
  assert.equal(fixture.modal.actions.reject.hidden, true)
  assert.equal(fixture.modal.actions['reject-confirm'].hidden, true)
})
