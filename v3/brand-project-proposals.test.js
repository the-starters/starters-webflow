'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const api = require('./brand-project-proposals.js')
const actionItems = require('./dashboard-action-items.js')

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
  isRendered() {
    for (let node = this; node; node = node.parentNode) {
      if (node.hidden || node.style.display === 'none') return false
    }
    return true
  }
  getBoundingClientRect() { return { height: this.isRendered() ? this.rectHeight || 0 : 0 } }
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
  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (node.matches && node.matches(selector)) return node
    }
    return null
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
  const documentListeners = {}
  return {
    head,
    body,
    listeners: documentListeners,
    addEventListener(name, handler) { documentListeners[name] = handler },
    removeEventListener(name) { delete documentListeners[name] },
    dispatchEvent() { return true },
    createElement(tagName) {
      const element = new Element()
      element.tagName = String(tagName || '').toUpperCase()
      return element
    },
    querySelector(selector) {
      return [...head.descendants(), ...body.descendants()]
        .find((element) => selector.split(',').some((part) => element.matches(part.trim()))) || null
    },
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
  const template = new Element({ 'data-project-request-template': '' })
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
  const projectProjectionReloads = []
  const rawProjectionRefreshes = []
  const globalObject = {
    crypto: { randomUUID: () => 'decision-key' },
    WfXano: { get: (key) => ({ async refresh() { rawProjectionRefreshes.push(key) } }) },
    Opp30: options.opp30 === undefined
      ? {
        async refreshProjectWorkflow(role, reload) {
          projectProjectionReloads.push([role, reload])
          if (options.projectReloadError) throw options.projectReloadError
          return []
        },
      }
      : options.opp30,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init.detail }
    },
    dispatchEvent() {},
    lumos: { modal: { list: { 'review-project-request': {
      open() { modal.open = true },
      close() { modal.open = false },
    } } } },
  }
  const projection = { project_proposals: [proposal()] }
  const calls = []
  const requestApi = options.api || {
    async projectProposalAction(payload) {
      calls.push(payload)
      return { proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: { id: 95 }, replayed: false }
    },
    async brandProjectProposalList() {
      return { project_proposals: [proposal()], nextPage: null }
    },
  }
  const controller = api.createController({
    globalObject,
    documentObject,
    list,
    template,
    modal,
    api: requestApi,
  })
  return {
    calls,
    controller,
    dispatched,
    globalFeedback,
    list,
    modal,
    projection,
    projectProjectionReloads,
    rawProjectionRefreshes,
  }
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

test('one envelope parser feeds both rendered rows and pagination', () => {
  const rows = [proposal()]
  assert.deepEqual(api.normalizeProposals({ project_proposals: rows }).map((item) => item.id), [41])
  for (const payload of [{ data: { project_proposals: rows } }, { items: rows }, null, []]) {
    assert.deepEqual(api.normalizeProposals(payload), [])
  }
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

test('refresh renders Action Items from the dedicated Brand proposal projection', async () => {
  const pages = []
  const fixture = controllerFixture({
    api: {
      async brandProjectProposalList(page, perPage) {
        pages.push([page, perPage])
        return { project_proposals: [proposal(), proposal({ proposal_id: 42, title: 'Lifecycle audit' })], nextPage: null }
      },
    },
  })

  const result = await fixture.controller.refresh()

  assert.deepEqual(pages, [[1, 12]])
  assert.deepEqual(result.project_proposals.length, 2)
  assert.deepEqual(fixture.controller.state.proposals.map((item) => item.id), [42, 41])
  assert.deepEqual(
    fixture.list.children.slice(0, 2).map((card) => card.getAttribute('data-project-proposal-id')),
    ['42', '41'],
  )
})

test('refresh loads every proposal page so requests after the first 12 remain reachable', async () => {
  const pages = []
  const fixture = controllerFixture({
    api: {
      async brandProjectProposalList(page, perPage) {
        pages.push([page, perPage])
        if (page === 1) {
          return {
            project_proposals: Array.from({ length: 12 }, (_, index) => proposal({ proposal_id: 100 + index })),
            itemsTotal: 13,
            nextPage: 2,
          }
        }
        return {
          project_proposals: [proposal({ proposal_id: 112, title: 'Page two request' })],
          itemsTotal: 13,
          nextPage: null,
        }
      },
    },
  })

  const result = await fixture.controller.refresh()

  assert.deepEqual(pages, [[1, 12], [2, 12]])
  assert.equal(result.project_proposals.length, 13)
  assert.equal(fixture.controller.state.proposals.length, 13)
  assert.ok(fixture.controller.state.proposals.some((item) => item.id === 112))
})

test('refresh stops at the last nextPage and never pages on itemsTotal alone', async () => {
  const pages = []
  const fixture = controllerFixture({
    api: {
      async brandProjectProposalList(page, perPage) {
        pages.push([page, perPage])
        return {
          project_proposals: [proposal({ proposal_id: 200 + page })],
          itemsTotal: 40,
          nextPage: null,
        }
      },
    },
  })

  const result = await fixture.controller.refresh()

  assert.deepEqual(pages, [[1, 12]])
  assert.equal(result.project_proposals.length, 1)
  assert.equal(result.itemsTotal, 1)
  assert.deepEqual(fixture.controller.state.proposals.map((item) => item.id), [201])
})

test('a full page without a nextPage signal is a load failure, not a short list', async () => {
  const pages = []
  const fixture = controllerFixture({
    api: {
      async brandProjectProposalList(page) {
        pages.push(page)
        return {
          project_proposals: Array.from({ length: 12 }, (_, index) => proposal({ proposal_id: 500 + index })),
          itemsTotal: 40,
        }
      },
    },
  })

  await assert.rejects(() => fixture.controller.refresh(), /nextPage signal/)
  assert.deepEqual(pages, [1])

  assert.equal(await fixture.controller.load(), null)
  assert.deepEqual(fixture.controller.state.proposals, [])
  assert.match(fixture.globalFeedback.textContent, /could not be loaded/)
})

test('refresh rejects a nextPage that does not advance', async () => {
  const pages = []
  const fixture = controllerFixture({
    api: {
      async brandProjectProposalList(page) {
        pages.push(page)
        return { project_proposals: [proposal({ proposal_id: 300 + page })], nextPage: 1 }
      },
    },
  })

  await assert.rejects(() => fixture.controller.refresh(), /did not advance/)
  assert.deepEqual(pages, [1])
})

test('refresh stops a server that keeps advancing nextPage forever', async () => {
  let requests = 0
  const fixture = controllerFixture({
    api: {
      async brandProjectProposalList(page) {
        requests += 1
        return { project_proposals: [proposal({ proposal_id: 400 + page })], nextPage: page + 1 }
      },
    },
  })

  await assert.rejects(() => fixture.controller.refresh(), /safe page limit/)
  assert.equal(requests, 100)
})

test('a failed list load renders an actionable message instead of a silent empty list', async () => {
  const fixture = controllerFixture({
    api: { async brandProjectProposalList() { return { items: [proposal()] } } },
  })
  fixture.controller.render(fixture.projection)

  assert.equal(await fixture.controller.load(), null)

  assert.deepEqual(fixture.controller.state.proposals, [])
  assert.equal(fixture.list.children.length, 1)
  assert.match(fixture.globalFeedback.textContent, /could not be loaded/)
  assert.equal(fixture.globalFeedback.hidden, false)
  assert.equal(fixture.globalFeedback.getAttribute('role'), 'alert')
})

test('a list response that settles after a member reset is discarded', async () => {
  let settleList
  const fixture = controllerFixture({
    api: {
      brandProjectProposalList() {
        return new Promise((resolve) => { settleList = resolve })
      },
    },
  })
  const pending = fixture.controller.load()

  fixture.controller.reset()
  settleList({ project_proposals: [proposal({ proposal_id: 77, starter_name: 'Previous Brand Starter' })], nextPage: null })

  assert.equal(await pending, null)
  assert.deepEqual(fixture.controller.state.proposals, [])
  assert.equal(fixture.list.children.length, 1)
  assert.equal(fixture.globalFeedback.textContent, '')
})

test('a list failure that settles after a member reset does not paint the failure banner', async () => {
  let failList
  const fixture = controllerFixture({
    api: {
      brandProjectProposalList() {
        return new Promise((resolve, reject) => { failList = reject })
      },
    },
  })
  const pending = fixture.controller.load()

  fixture.controller.reset()
  failList(Object.assign(new Error('offline'), { status: 0 }))

  assert.equal(await pending, null)
  assert.equal(fixture.globalFeedback.textContent, '')
  assert.equal(fixture.globalFeedback.hidden, true)
})

test('a later proposal page that arrives after a member reset never renders', async () => {
  const pages = []
  let settleSecondPage
  const fixture = controllerFixture({
    api: {
      brandProjectProposalList(page) {
        pages.push(page)
        if (page === 1) {
          return Promise.resolve({ project_proposals: [proposal({ proposal_id: 61 })], nextPage: 2 })
        }
        return new Promise((resolve) => { settleSecondPage = resolve })
      },
    },
  })
  const pending = fixture.controller.load()
  await new Promise((resolve) => setTimeout(resolve, 0))

  fixture.controller.reset()
  settleSecondPage({ project_proposals: [proposal({ proposal_id: 62 })], nextPage: null })

  assert.equal(await pending, null)
  assert.deepEqual(pages, [1, 2])
  assert.deepEqual(fixture.controller.state.proposals, [])
  assert.equal(fixture.list.children.length, 1)
})

test('a successful list load clears a previous load failure message', async () => {
  let attempt = 0
  const fixture = controllerFixture({
    api: {
      async brandProjectProposalList() {
        attempt += 1
        if (attempt === 1) throw Object.assign(new Error('offline'), { status: 0 })
        return { project_proposals: [proposal()], nextPage: null }
      },
    },
  })

  assert.equal(await fixture.controller.load(), null)
  assert.match(fixture.globalFeedback.textContent, /could not be loaded/)

  const reloaded = await fixture.controller.load()

  assert.equal(reloaded.project_proposals.length, 1)
  assert.equal(fixture.globalFeedback.textContent, '')
  assert.equal(fixture.globalFeedback.hidden, true)
})

test('a decline settles whether or not the response carries an empty project field', async () => {
  for (const project of [null, undefined, {}, { id: 0 }]) {
    const fixture = controllerFixture({
      api: {
        async projectProposalAction() {
          return { proposal: { id: 41, status: 'rejected', lifecycle_version: 4 }, project, replayed: false }
        },
        async brandProjectProposalList() { return { project_proposals: [], nextPage: null } },
      },
    })
    fixture.controller.render(fixture.projection)
    fixture.controller.open(fixture.controller.state.proposals[0])

    assert.equal(await fixture.controller.act('reject'), true, String(project))
    assert.equal(fixture.globalFeedback.textContent, 'Project request declined.')
    assert.deepEqual(fixture.projectProjectionReloads, [])
  }
})

test('a decline that reports a created project fails closed', async () => {
  const fixture = controllerFixture({
    api: {
      async projectProposalAction() {
        return { proposal: { id: 41, status: 'rejected', lifecycle_version: 4 }, project: { id: 95 }, replayed: false }
      },
      async brandProjectProposalList() { return { project_proposals: [], nextPage: null } },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])

  assert.equal(await fixture.controller.act('reject'), false)
  assert.match(fixture.globalFeedback.textContent, /could not be updated/)
  assert.deepEqual(fixture.controller.state.proposals.map((item) => item.id), [41])
})

test('refresh rejects a malformed fulfilled list response without clearing rendered cards', async () => {
  const fixture = controllerFixture({
    api: { async brandProjectProposalList() { return { items: [proposal()] } } },
  })
  fixture.controller.render(fixture.projection)
  await assert.rejects(() => fixture.controller.refresh(), /invalid response/)
  assert.deepEqual(fixture.controller.state.proposals.map((item) => item.id), [41])
})

test('a bridge without the proposal list route is a load failure, not an empty list', async () => {
  const fixture = controllerFixture({ api: {} })
  fixture.controller.render(fixture.projection)

  await assert.rejects(() => fixture.controller.refresh(), /not available/)
  assert.deepEqual(fixture.controller.state.proposals.map((item) => item.id), [41])

  assert.equal(await fixture.controller.load(), null)

  assert.deepEqual(fixture.controller.state.proposals, [])
  assert.match(fixture.globalFeedback.textContent, /could not be loaded/)
  assert.equal(fixture.globalFeedback.hidden, false)
  assert.equal(fixture.globalFeedback.getAttribute('role'), 'alert')
})

test('accepting reloads the canonical Brand project projection alongside the proposal list', async () => {
  const listed = []
  const fixture = controllerFixture({
    api: {
      async projectProposalAction() {
        return { proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: { id: 95 }, replayed: false }
      },
      async brandProjectProposalList() {
        listed.push(true)
        return { project_proposals: [], nextPage: null }
      },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])

  assert.equal(await fixture.controller.act('accept'), true)

  assert.deepEqual(fixture.projectProjectionReloads, [['brand', true]])
  assert.deepEqual(fixture.rawProjectionRefreshes, [])
  assert.equal(listed.length, 1)
  assert.equal(fixture.controller.state.proposals.length, 0)
})

test('declining leaves the canonical Brand project projection alone', async () => {
  const fixture = controllerFixture({
    api: {
      async projectProposalAction() {
        return { proposal: { id: 41, status: 'rejected', lifecycle_version: 4 }, project: null, replayed: false }
      },
      async brandProjectProposalList() { return { project_proposals: [], nextPage: null } },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])

  assert.equal(await fixture.controller.act('reject'), true)

  assert.deepEqual(fixture.projectProjectionReloads, [])
})

test('an accept survives a bridge without the project list reload method', async () => {
  const fixture = controllerFixture({
    opp30: {},
    api: {
      async projectProposalAction() {
        return { proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: { id: 95 }, replayed: false }
      },
      async brandProjectProposalList() { return { project_proposals: [], nextPage: null } },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])

  assert.equal(await fixture.controller.act('accept'), true)
  assert.equal(fixture.globalFeedback.textContent, 'Project approved and created.')
  assert.deepEqual(fixture.rawProjectionRefreshes, [])
})

test('a failed project list reload still reloads the proposal list', async () => {
  const listed = []
  const fixture = controllerFixture({
    projectReloadError: new Error('projection offline'),
    api: {
      async projectProposalAction() {
        return { proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: { id: 95 }, replayed: false }
      },
      async brandProjectProposalList() {
        listed.push(true)
        return { project_proposals: [], nextPage: null }
      },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])

  assert.equal(await fixture.controller.act('accept'), true)

  assert.deepEqual(fixture.projectProjectionReloads, [['brand', true]])
  assert.equal(listed.length, 1)
  assert.deepEqual(fixture.controller.state.proposals, [])
  assert.equal(fixture.list.children.length, 1)
  assert.match(fixture.globalFeedback.textContent, /Refresh the dashboard to load the project/)
  assert.equal(fixture.globalFeedback.hidden, false)
})

test('a reload that fails after a member reset does not announce stale copy', async () => {
  let settleList
  const fixture = controllerFixture({
    api: {
      async projectProposalAction() {
        return { proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: { id: 95 }, replayed: false }
      },
      brandProjectProposalList() {
        return new Promise((resolve, reject) => { settleList = reject })
      },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])
  const pending = fixture.controller.act('accept')
  await new Promise((resolve) => setTimeout(resolve, 0))

  fixture.controller.reset()
  settleList(Object.assign(new Error('offline'), { status: 0 }))

  assert.equal(await pending, true)
  assert.equal(fixture.globalFeedback.textContent, '')
  assert.equal(fixture.globalFeedback.hidden, true)
})

test('a decision response must carry the documented proposal and project identity', async () => {
  for (const [proposalResult, projectResult] of [
    [{ proposal_id: 41, status: 'accepted', lifecycle_version: 4 }, { id: 95 }],
    [{ id: 41, status: 'accepted', version: 4 }, { id: 95 }],
    [{ id: 41, status: 'accepted', lifecycle_version: 4 }, { project_id: 95 }],
  ]) {
    const fixture = controllerFixture({
      api: {
        async projectProposalAction() {
          return { proposal: proposalResult, project: projectResult, replayed: false }
        },
        async brandProjectProposalList() { return { project_proposals: [], nextPage: null } },
      },
    })
    fixture.controller.render(fixture.projection)
    fixture.controller.open(fixture.controller.state.proposals[0])

    assert.equal(await fixture.controller.act('accept'), false)
    assert.match(fixture.globalFeedback.textContent, /could not be updated/)
    assert.deepEqual(fixture.projectProjectionReloads, [])
    assert.deepEqual(fixture.controller.state.proposals.map((item) => item.id), [41])
  }
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

function brandDashboard() {
  const documentObject = fallbackDocument()
  const panel = documentObject.body.appendChild(new Element())
  const wrapper = panel.appendChild(new Element({ 'data-action-element': 'wrapper' }))
  const onboardingRow = wrapper.appendChild(new Element({ class: 'dash-hero_action-item' }))
  onboardingRow.rectHeight = 40
  const onboardingTemplate = onboardingRow.appendChild(
    new Element({ 'data-project-proposal-template': 'true' }),
  )
  const onboardingButton = onboardingRow.appendChild(new Element({ class: 'button_main-wrap' }))
  onboardingButton.textContent = 'Post Opportunity'
  const listeners = {}
  const globalObject = {
    document: documentObject,
    location: { pathname: '/brand-dashboard' },
    crypto: { randomUUID: () => 'decision-key' },
    addEventListener(name, handler) { listeners[name] = handler },
    setTimeout(callback) { return callback() },
    Opp30: { API: { async brandProjectProposalList() { return { project_proposals: [proposal()], nextPage: null } } } },
  }
  return { documentObject, globalObject, listeners, onboardingButton, onboardingRow, onboardingTemplate, panel, wrapper }
}

test('mount never claims the Action Items onboarding row as its proposal template', async () => {
  const dashboard = brandDashboard()

  const controller = api.mount(dashboard.globalObject)
  assert.ok(controller)
  await controller.load()

  assert.equal(dashboard.onboardingTemplate.getAttribute('data-project-proposal-template'), 'true')
  assert.equal(dashboard.onboardingTemplate.hasAttribute('data-project-request-template'), false)
  assert.equal(dashboard.onboardingButton.textContent, 'Post Opportunity')
  assert.equal(dashboard.onboardingButton.hasAttribute('data-project-proposal-open'), false)
  assert.equal(dashboard.onboardingRow.querySelectorAll('[data-project-proposal-card]').length, 0)
  assert.equal(dashboard.wrapper.querySelectorAll('[data-project-proposal-card]').length, 0)

  const section = dashboard.documentObject.querySelector('[data-project-request-list]')
  assert.ok(section)
  assert.equal(section.parentNode, dashboard.panel)
  const feedback = dashboard.documentObject.querySelector('[data-project-proposal-global-feedback]')
  assert.ok(feedback)
  assert.deepEqual(
    dashboard.panel.children.map((child) => (child === feedback ? 'feedback' : child === section ? 'requests' : 'action-items')),
    ['feedback', 'requests', 'action-items'],
  )
  assert.equal(dashboard.wrapper.children.includes(section), false)
  assert.equal(section.getAttribute('aria-labelledby'), 'project-request-list-heading')
  const heading = section.children[0]
  assert.equal(heading.getAttribute('id'), 'project-request-list-heading')
  assert.equal(heading.textContent, 'Project requests')
  assert.deepEqual(
    section.querySelectorAll('[data-project-proposal-card]').map((card) => card.getAttribute('data-project-proposal-id')),
    ['41'],
  )
})

test('the generated request section stays hidden until a request is pending', async () => {
  const dashboard = brandDashboard()
  let pending = []
  dashboard.globalObject.Opp30.API.brandProjectProposalList = async () => ({
    project_proposals: pending,
    nextPage: null,
  })

  const controller = api.mount(dashboard.globalObject)
  await controller.load()

  const section = dashboard.documentObject.querySelector('[data-project-request-list]')
  assert.ok(section)
  assert.equal(section.hidden, true)
  assert.equal(section.style.display, 'none')
  assert.equal(section.getAttribute('aria-hidden'), 'true')

  pending = [proposal()]
  await controller.load()

  assert.equal(section.hidden, false)
  assert.equal(section.getAttribute('aria-hidden'), 'false')
  assert.equal(section.querySelectorAll('[data-project-proposal-card]').length, 1)

  pending = []
  await controller.load()

  assert.equal(section.hidden, true)
  assert.equal(section.querySelectorAll('[data-project-proposal-card]').length, 0)
})

test('a failed load hides the generated section but keeps its feedback visible', async () => {
  const dashboard = brandDashboard()
  dashboard.globalObject.Opp30.API.brandProjectProposalList = async () => ({ items: [proposal()] })

  const controller = api.mount(dashboard.globalObject)
  await controller.load()

  const section = dashboard.documentObject.querySelector('[data-project-request-list]')
  const feedback = dashboard.documentObject.querySelector('[data-project-proposal-global-feedback]')
  assert.equal(section.hidden, true)
  assert.equal(feedback.hidden, false)
  assert.match(feedback.textContent, /could not be loaded/)
  assert.equal(section.children.includes(feedback), false)
})

test('an authored list host keeps its own empty state', async () => {
  const dashboard = brandDashboard()
  const authoredList = dashboard.documentObject.body.appendChild(
    new Element({ 'data-project-request-list': '' }),
  )
  dashboard.globalObject.Opp30.API.brandProjectProposalList = async () => ({
    project_proposals: [],
    nextPage: null,
  })

  const controller = api.mount(dashboard.globalObject)
  await controller.load()

  assert.equal(authoredList.hidden, false)
  assert.equal(authoredList.style.display, '')
})

test('pending requests stay visible when Action Items hides the onboarding row', async () => {
  const dashboard = brandDashboard()
  const controller = api.mount(dashboard.globalObject)
  await controller.load()
  const card = dashboard.documentObject
    .querySelector('[data-project-request-list]')
    .querySelectorAll('[data-project-proposal-card]')[0]
  card.rectHeight = 30
  assert.equal(card.getBoundingClientRect().height, 30)

  const rows = actionItems.brandRows(dashboard.documentObject)
  assert.equal(rows.post, dashboard.onboardingRow)
  actionItems.show(rows.post, false)

  assert.equal(dashboard.onboardingRow.hidden, true)
  assert.equal(dashboard.onboardingRow.style.display, 'none')
  assert.equal(card.getBoundingClientRect().height, 30)
  assert.equal(actionItems.countPendingItems(dashboard.wrapper), 0)
})

test('an authored proposal list host receives the generated row template', async () => {
  const dashboard = brandDashboard()
  const authoredList = dashboard.documentObject.body.appendChild(
    new Element({ 'data-project-request-list': '' }),
  )

  const controller = api.mount(dashboard.globalObject)
  await controller.load()

  assert.equal(authoredList.children.length, 2)
  assert.equal(authoredList.children[1].hasAttribute('data-project-request-template'), true)
  assert.deepEqual(
    authoredList.querySelectorAll('[data-project-proposal-card]').map((card) => card.getAttribute('data-project-proposal-id')),
    ['41'],
  )
})

function actionItemsDashboard() {
  const documentObject = fallbackDocument()
  const section = documentObject.body.appendChild(new Element())
  const wrapper = section.appendChild(new Element({ 'data-action-element': 'wrapper' }))
  const empty = wrapper.appendChild(new Element({ 'data-action-element': 'empty' }))
  const list = wrapper.appendChild(new Element({ 'data-action-element': 'list' }))
  return { documentObject, section, wrapper, empty, list }
}

test('the feedback region is created outside the Action Items wrapper', () => {
  const dashboard = actionItemsDashboard()
  const first = api.ensureGlobalFeedback(dashboard.documentObject, dashboard.list)
  assert.ok(first)
  assert.equal(first.getAttribute('data-project-proposal-global-feedback'), '')
  assert.equal(first.getAttribute('aria-live'), 'polite')
  assert.equal(first.hidden, true)
  assert.equal(first.parentNode, dashboard.section)
  assert.deepEqual(dashboard.section.children, [first, dashboard.wrapper])
  assert.equal(dashboard.wrapper.children.includes(first), false)
  assert.equal(dashboard.list.children.length, 0)

  dashboard.documentObject.querySelector = (selector) =>
    selector === '[data-project-proposal-global-feedback]' ? first : null
  const second = api.ensureGlobalFeedback(dashboard.documentObject, dashboard.list)
  assert.equal(second, first)
  assert.equal(dashboard.section.children.length, 2)
})

test('the failed-load message survives the Action Items panel hiding its empty wrapper', () => {
  const dashboard = actionItemsDashboard()
  const feedback = api.ensureGlobalFeedback(dashboard.documentObject, dashboard.list)
  const pendingRow = dashboard.list.appendChild(new Element({ 'data-action-element': 'item' }))
  pendingRow.rectHeight = 20
  const panel = actionItems.createPanel(dashboard.wrapper)

  assert.equal(panel.render(), 1)
  assert.equal(dashboard.wrapper.hidden, false)

  pendingRow.remove()
  feedback.textContent = 'Your pending project requests could not be loaded. Refresh the dashboard to try again.'
  feedback.hidden = false
  feedback.style.display = ''
  feedback.rectHeight = 18

  assert.equal(panel.render(), 0)
  assert.equal(dashboard.wrapper.hidden, true)
  assert.equal(dashboard.wrapper.style.display, 'none')
  assert.equal(feedback.getBoundingClientRect().height, 18)
})

test('binds an authored row without rewriting its authored copy', () => {
  const card = new Element()
  const label = card.appendChild(new Element({ class: 'label_text', textContent: 'Pending' }))
  const title = card.appendChild(new Element({ class: 'action-item_title', textContent: 'Project request' }))
  const review = card.appendChild(new Element({ class: 'button_main-wrap' }))
  review.appendChild(new Element({ textContent: 'Review request' }))
  const dismiss = card.appendChild(new Element({ class: 'button_main-wrap' }))
  dismiss.appendChild(new Element({ textContent: 'Dismiss' }))

  api.prepareFallbackCard(card)
  assert.equal(label.getAttribute('data-project-proposal-field'), 'status_label')
  assert.equal(title.getAttribute('data-project-proposal-field'), 'title')
  assert.equal(review.hasAttribute('data-project-proposal-open'), true)
  assert.equal(review.getAttribute('aria-label'), 'Review project request')
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

test('a malformed fulfilled action response is not reported as success and reuses its retry key', async () => {
  const calls = []
  let attempt = 0
  const fixture = controllerFixture({
    api: {
      async projectProposalAction(payload) {
        calls.push(payload)
        attempt += 1
        if (attempt === 1) return { proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: null }
        return { proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: { id: 95 }, replayed: true }
      },
      async brandProjectProposalList() { return { project_proposals: [], nextPage: null } },
    },
  })
  fixture.controller.render(fixture.projection)
  fixture.controller.open(fixture.controller.state.proposals[0])

  assert.equal(await fixture.controller.act('accept'), false)
  assert.equal(fixture.dispatched.length, 0)
  assert.equal(fixture.projectProjectionReloads.length, 0)
  assert.match(fixture.globalFeedback.textContent, /could not be updated/)

  assert.equal(await fixture.controller.act('accept'), true)
  assert.equal(calls[0].idempotency_key, calls[1].idempotency_key)
  assert.equal(fixture.dispatched[0].type, 'starters:project-proposal-accepted')
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
      async brandProjectProposalList() {
        refreshes += 1
        return { project_proposals: [proposal()], nextPage: null }
      },
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
  const projection = { project_proposals: proposals }
  const fixture = controllerFixture({
    api: {
      async projectProposalAction(payload) {
        calls.push(payload)
        if (calls.length === 1) {
          return new Promise((resolve) => { settleFirst = resolve })
        }
        return { proposal: { id: 42, status: 'rejected', lifecycle_version: 4 }, project: null, replayed: false }
      },
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

  settleFirst({ proposal: { id: 41, status: 'accepted', lifecycle_version: 4 }, project: { id: 95 }, replayed: false })
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
