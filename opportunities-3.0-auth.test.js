const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'opportunities-3.0.js'), 'utf8')

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function response(data, ok = true, status = 200) {
  return { ok, status, json: async () => data }
}

async function waitForRequestCount(requests, count) {
  for (let attempt = 0; attempt < 20 && requests.length < count; attempt += 1) {
    await new Promise(setImmediate)
  }
  assert.equal(requests.length, count)
}

async function loadBridge(
  fetch,
  {
    hostname = 'example.test',
    member = null,
    pathname = '/all-modals',
    querySelector = null,
    querySelectorAll = null,
    routeGuard = false,
    routeGuardDelayMs = null,
    routeGuardScript = false,
    search = '',
    wfXano = null,
    getXanoAuthToken = null,
  } = {},
) {
  const documentListeners = new Map()
  const windowListeners = new Map()
  const mutationObservers = []
  const consoleErrors = []
  let authChange
  const attributes = new Map()
  if (routeGuard) {
    attributes.set('data-route-guard', routeGuard === true ? 'allowed' : String(routeGuard))
  }
  const documentElement = {
    appendChild() {},
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
  }
  const document = {
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || []
      listeners.push(listener)
      documentListeners.set(type, listeners)
    },
    removeEventListener(type, listener) {
      const listeners = documentListeners.get(type) || []
      documentListeners.set(
        type,
        listeners.filter((candidate) => candidate !== listener),
      )
    },
    createElement(tag) {
      return el(tag)
    },
    documentElement,
    getElementById: () => null,
    head: documentElement,
    querySelector: (selector) => {
      if (selector === 'script[src*="/v3/route-guard.js"]' && routeGuardScript) return {}
      return querySelector ? querySelector(selector) : null
    },
    querySelectorAll: (selector) => (querySelectorAll ? querySelectorAll(selector) : []),
    readyState: 'loading',
  }
  const trackCalls = []
  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({ data: typeof member === 'function' ? member() : member }),
      getMemberCookie: async () => 'memberstack-a',
      onAuthChange(listener) {
        authChange = listener
      },
    },
    StartersTrack: { track: (...args) => trackCalls.push(args) },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || []
      listeners.push(listener)
      windowListeners.set(type, listeners)
    },
    clearInterval,
    clearTimeout,
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) listener(event)
    },
    removeEventListener(type, listener) {
      const listeners = windowListeners.get(type) || []
      windowListeners.set(type, listeners.filter((candidate) => candidate !== listener))
    },
    setInterval,
    setTimeout,
  }
  if (wfXano) window.WfXano = wfXano
  if (getXanoAuthToken) window.getXanoAuthToken = getXanoAuthToken
  window.fetch = fetch
  window.window = window
  const location = {
    href: `https://${hostname}${pathname}${search}`,
    hostname,
    pathname,
    search,
  }
  const context = vm.createContext({
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type
        this.detail = options?.detail
      }
    },
    FormData,
    Headers,
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback
        this.connected = true
        mutationObservers.push(this)
      }
      disconnect() {
        this.connected = false
      }
      observe() {}
    },
    Request,
    URL,
    URLSearchParams,
    alert() {},
    console: {
      error: (...args) => consoleErrors.push(args),
      info() {},
      log() {},
      warn() {},
    },
    document,
    fetch: (...args) => window.fetch(...args),
    history: { replaceState() {} },
    location,
    window,
  })
  vm.runInContext(source, context)
  if (routeGuardDelayMs !== null) {
    setTimeout(() => documentElement.setAttribute('data-route-guard', 'checking'), routeGuardDelayMs)
  }
  for (const listener of documentListeners.get('DOMContentLoaded') || []) listener()
  await Promise.resolve()
  assert.equal(typeof authChange, 'function')
  return {
    API: window.Opp30.API,
    authChange,
    attributes,
    consoleErrors,
    documentElement,
    fetch: window.fetch,
    location,
    trackCalls,
    window,
    notifyMutations(mutations = []) {
      mutationObservers
        .filter((observer) => observer.connected)
        .forEach((observer) => observer.callback(mutations))
    },
    dispatchDocument(type, event) {
      for (const listener of documentListeners.get(type) || []) listener(event)
    },
    dispatchWindow(type, detail) {
      window.dispatchEvent({ type, detail })
    },
    documentListenerCount(type) {
      return (documentListeners.get(type) || []).length
    },
  }
}

test('builds a login URL that preserves the current V3 path and query', async () => {
  const bridge = await loadBridge(async () => response({}))

  assert.equal(
    bridge.window.Opp30.loginPathWithNext(),
    '/login?next=%2Fall-modals',
  )
})

const talentMember = {
  id: 'm-talent',
  customFields: {},
  planConnections: [{ active: true, planId: 'pln_dorxata-test-free-plan-dvcg0k8o' }],
}
const paidBrandMember = {
  id: 'm-brand',
  customFields: {},
  planConnections: [{ active: true, planId: 'pln_new-paid-plan-463h04ph' }],
}
const freeBrandMember = {
  id: 'm-free',
  customFields: {},
  planConnections: [{ active: true, planId: 'pln_free-plan-f6kn0dxz' }],
}

test('projectDirectCreate sends its payload through the authenticated V3 route', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/projects/create-direct/v3')) {
        return response({ project: { id: 669 }, replayed: false })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember },
  )
  const payload = {
    starter_memberstack_id: 'mem_starter_123',
    title: 'Launch project',
    contract_type: 'standard',
    idempotency_key: 'project-direct-test',
  }

  const result = await bridge.API.projectDirectCreate(payload)

  assert.equal(result.project.id, 669)
  assert.equal(requests[1].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/projects/create-direct/v3')
  assert.equal(requests[1].init.method, 'POST')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(requests[1].init.body), payload)
})

test('invoiceCreate sends the V3 invoice payload through the authenticated Xano bridge', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/create/v3')) {
        return response({
          invoice_id: 901,
          stripe_ref: 'plink_test',
          payment_link: 'https://buy.stripe.com/test',
          status: 'unpaid',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember },
  )

  const result = await bridge.API.invoiceCreate({
    project_id: 675,
    amount: 25.5,
    description: 'August test invoice',
    idempotency_key: 'invoice-v3-675-test',
  })

  assert.equal(result.invoice_id, 901)
  assert.match(requests[1].url, /\/invoices\/create\/v3$/)
  assert.equal(requests[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    project_id: 675,
    amount: 25.5,
    description: 'August test invoice',
    idempotency_key: 'invoice-v3-675-test',
  })
})

test('project dashboard actions use the authenticated canonical endpoints', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) return response({ items: [{ id: 675 }] })
      if (url.includes('/contracts/link/v3')) return response({ url: 'https://app.pandadoc.com/s/test' })
      if (url.includes('/projects/action/v3')) {
        return response({ project: { id: 675, lifecycle_state: 'completion_requested' } })
      }
      if (url.includes('/brand/reviews/submit')) return response({ review_id: 42 })
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember },
  )

  await bridge.API.brandProjectList()
  await bridge.API.contractLink(675)
  await bridge.API.projectAction({
    project_id: 675,
    expected_version: 3,
    action: 'complete',
    reason: '',
    idempotency_key: 'project-action-ui:675:3:complete:test',
  })
  await bridge.API.brandReviewSubmit({
    project_id: 675,
    rating: 5,
    review_text: 'Excellent collaboration.',
    idempotency_key: 'review-ui:675:test',
  })

  assert.deepEqual(
    requests.slice(1).map(({ url }) => new URL(url).pathname.split('/api:opp30/')[1]),
    [
      'brand/projects/mine',
      'contracts/link/v3',
      'projects/action/v3',
      'brand/reviews/submit',
    ],
  )
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    project_id: 675,
    expected_version: 3,
    action: 'complete',
    reason: '',
    idempotency_key: 'project-action-ui:675:3:complete:test',
  })
})

test('project lifecycle intent covers cancellation, completion and early termination', async () => {
  const bridge = await loadBridge(async () => response({}))
  const intent = bridge.window.Opp30.projectActionIntent
  const plain = (value) => value == null ? value : JSON.parse(JSON.stringify(value))

  assert.deepEqual(
    plain(intent({ lifecycle_state: 'pending' }, () => true, () => '')),
    { action: 'cancel', reason: 'canceled_before_activation' },
  )
  assert.deepEqual(
    plain(intent(
      { status: 'pending', lifecycle_state: 'contract_sent' },
      () => true,
      () => 'COMPLETE',
    )),
    { action: 'cancel', reason: 'canceled_before_activation' },
  )
  assert.equal(intent({ lifecycle_state: 'pending' }, () => false, () => ''), null)
  assert.deepEqual(
    plain(intent({ lifecycle_state: 'active' }, () => true, () => 'COMPLETE')),
    { action: 'complete', reason: '' },
  )
  assert.deepEqual(
    plain(intent({ lifecycle_state: 'active' }, () => true, () => 'Scope changed')),
    { action: 'terminate', reason: 'Scope changed' },
  )
  assert.deepEqual(
    plain(intent({ lifecycle_state: 'completion_requested' }, () => true, () => '')),
    { action: 'complete', reason: '' },
  )
  assert.deepEqual(
    plain(intent(
      { lifecycle_state: 'termination_requested', end_reason: 'Scope changed' },
      () => true,
      () => '',
    )),
    { action: 'terminate', reason: 'Scope changed' },
  )
  assert.equal(intent({ lifecycle_state: 'completed' }, () => true, () => 'COMPLETE'), null)
})

test('project timelines use compact readable calendar ranges without timezone shifts', async () => {
  const bridge = await loadBridge(async () => response({}))
  const format = bridge.window.Opp30.formatProjectTimeline

  assert.equal(format({ start_date: '2026-08-06', end_date: '2026-08-31' }), 'August 6–31, 2026')
  assert.equal(
    format({ start_date: '2026-08-28', estimated_end_date: '2026-09-12' }),
    'August 28 – September 12, 2026',
  )
  assert.equal(
    format({ start_date: '2026-12-28', end_date: '2027-01-10' }),
    'December 28, 2026 – January 10, 2027',
  )
  assert.equal(format({ start_date: '2026-08-06' }), 'Starting August 6, 2026 · Ongoing')
  assert.equal(
    format({ end_date: '2026-08-04', timeline_display: '- 2026-08-04' }),
    'Ends August 4, 2026',
  )
  assert.equal(format({ estimated_end_date: '2026-08-04' }), 'Ends August 4, 2026')
  assert.equal(format({ start_date: '2026-08-06', end_date: '2026-08-06' }), 'August 6, 2026')
  assert.equal(
    format({ start_date: '2026-08-06T00:00:00.000Z', end_date: '2026-08-31T23:59:59+08:00' }),
    'August 6–31, 2026',
  )
  assert.equal(
    format({ start_date: '2026-02-30', timeline_display: '2026-02-30' }),
    '2026-02-30',
  )
  assert.equal(
    format({ start_date: '2026-08-06Trash', timeline_display: 'Unparseable timeline' }),
    'Unparseable timeline',
  )
  assert.equal(
    format({
      start_date: 'not-a-date',
      end_date: '2026-08-04',
      timeline_display: 'Invalid start - 2026-08-04',
    }),
    'Invalid start - 2026-08-04',
  )
  assert.equal(
    format({ start_date: '2026-08-06T25:00:00Z', timeline_display: 'Invalid timestamp' }),
    'Invalid timestamp',
  )
  assert.equal(
    format({
      start_date: '2026-08-06',
      end_date: 'not-a-date',
      timeline_display: '2026-08-06 - not-a-date',
    }),
    '2026-08-06 - not-a-date',
  )
})

for (const role of ['starter', 'brand']) {
  test(`${role} dashboard paints the live nested Project timeline value from canonical dates`, async () => {
    const label = el('p', { 'wf-xano-bind': 'label' })
    label.textContent = 'Project timeline'
    const timeline = el('p', { 'wf-xano-bind': 'value' })
    timeline.textContent = '2026-08-06 - 2026-08-31'
    const directTimeline = el('p', { 'wf-xano-bind': 'timeline_display' })
    directTimeline.textContent = 'Direct fallback'
    const detailRow = el('div', { 'data-wf-xano-nest-clone': '' }, [label, timeline])
    const details = el(
      'div',
      { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'contract_details' },
      [detailRow],
    )
    const card = el(
      'div',
      { class: 'project_item', 'data-wf-xano-id': '676' },
      [directTimeline, details],
    )
    const root = el(
      'div',
      {
        'wf-xano-instance': role === 'brand' ? 'dash-brand-projects' : 'dash-projects',
      },
      [card],
    )
    const member = role === 'brand' ? paidBrandMember : talentMember
    const pathname = role === 'brand' ? '/brand-dashboard' : '/starter-dashboard'

    await loadBridge(
      async (input) => {
        const url = String(input)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
        if (url.includes(`/${role}/projects/mine`)) {
          return response({
            items: [{
              id: 676,
              lifecycle_state: 'active',
              start_date: '2026-08-06',
              end_date: '2026-08-31',
              timeline_display: '2026-08-06 - 2026-08-31',
            }],
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      {
        member,
        pathname,
        querySelector: (selector) =>
          selectorMatches(root, selector) ? root : root.querySelector(selector),
        querySelectorAll: (selector) =>
          [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
        routeGuard: true,
      },
    )
    assert.ok(await waitFor(() => timeline.textContent === 'August 6–31, 2026'))
    assert.equal(directTimeline.textContent, 'Direct fallback')
  })
}

test('project dashboard keeps the direct timeline_display binding as a fallback', async () => {
  const timeline = el('p', { 'wf-xano-bind': 'timeline_display' })
  timeline.textContent = '2026-08-06 - 2026-08-31'
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '676' }, [timeline])
  const root = el(
    'div',
    {
      'wf-xano-instance': 'dash-projects',
    },
    [card],
  )

  await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        return response({
          items: [{
            id: 676,
            lifecycle_state: 'active',
            start_date: '2026-08-06',
            end_date: '2026-08-31',
            timeline_display: '2026-08-06 - 2026-08-31',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => timeline.textContent === 'August 6–31, 2026'))
})

test('Brand dashboard action wiring starts only after the stable paid-Brand gate', async () => {
  const requests = []
  await loadBridge(
    async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{ id: 675, lifecycle_state: 'active', lifecycle_version: 2 }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember, pathname: '/brand-dashboard', routeGuard: true },
  )
  await new Promise(setImmediate)
  assert.equal(requests.filter((url) => url.includes('/brand/projects/mine')).length, 1)

  const wrongRoleRequests = []
  await loadBridge(
    async (input) => {
      wrongRoleRequests.push(String(input))
      return response({})
    },
    { member: talentMember, pathname: '/brand-dashboard', routeGuard: true },
  )
  await new Promise(setImmediate)
  assert.equal(wrongRoleRequests.some((url) => url.includes('/brand/projects/mine')), false)

  const legacyFallbackRequests = []
  await loadBridge(
    async (input) => {
      legacyFallbackRequests.push(String(input))
      return response({})
    },
    {
      member: {
        ...talentMember,
        customFields: { 'brands-dashboard-url': '/brand-dashboard' },
      },
      pathname: '/brand-dashboard',
      routeGuard: false,
    },
  )
  await new Promise(setImmediate)
  assert.equal(legacyFallbackRequests.some((url) => url.includes('/brand/projects/mine')), false)
})

test('project action decoration reuses the wf-xano projection without a duplicate list request', async () => {
  const requests = []
  const project = {
    id: 675,
    lifecycle_state: 'active',
    lifecycle_version: 2,
    contract_status: 'sent',
  }
  const state = {
    status: 'success',
    data: { items: [project], total: 70 },
    query: { page: 1, perPage: 12, params: {} },
    revision: 1,
  }
  let subscriptions = 0
  const instance = {
    getState: () => state,
    subscribe(handler) {
      subscriptions += 1
      handler(state)
      return () => {}
    },
  }
  const wfXano = {
    get(key) {
      return key === 'dash-brand-projects' ? instance : null
    },
  }

  await loadBridge(
    async (input) => {
      requests.push(String(input))
      throw new Error(`Unexpected request: ${input}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      routeGuard: true,
      wfXano,
    },
  )
  await new Promise(setImmediate)

  assert.equal(subscriptions, 1)
  assert.equal(requests.some((url) => url.includes('/brand/projects/mine')), false)
})

test('project observer does not rewrite an already-correct action label', async () => {
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const label = el('div', { class: 'button_main-text' })
  let labelText = 'Cancel Project'
  let labelWrites = 0
  Object.defineProperty(label, 'textContent', {
    configurable: true,
    get: () => labelText,
    set: (value) => {
      labelWrites += 1
      labelText = String(value)
    },
  })
  const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects', 'wf-xano-source': 'opp30:brand/projects/mine' },
    [card],
  )
  const state = {
    status: 'success',
    data: { items: [{ id: 675, status: 'pending', lifecycle_state: 'contract_sent' }] },
    query: { page: 1, perPage: 12 },
  }
  const instance = {
    getState: () => state,
    subscribe(handler) {
      handler(state)
      return () => {}
    },
  }
  const bridge = await loadBridge(
    async (input) => {
      throw new Error(`Unexpected request: ${input}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects' ? instance : null
        },
      },
    },
  )
  await new Promise(setImmediate)
  labelWrites = 0

  // Opening lazy details or appending a Show more page produces childList
  // records. The observer may decorate again, but it must not create another
  // childList record by replacing an unchanged label text node.
  bridge.notifyMutations([{ type: 'childList', target: card }])
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(label.textContent, 'Cancel Project')
  assert.equal(labelWrites, 0)
})

test('current project wrapper fails closed without its keyed wf-xano owner', async () => {
  const root = el('div', {
    'wf-xano-instance': 'dash-brand-projects',
    'wf-xano-source': 'opp30:brand/projects/mine',
  })
  const requests = []

  await loadBridge(
    async (input) => {
      requests.push(String(input))
      throw new Error(`Unexpected request: ${input}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) => selectorMatches(root, selector) ? root : null,
      querySelectorAll: (selector) => selectorMatches(root, selector) ? [root] : [],
      routeGuard: true,
      wfXano: {
        get() {
          return null
        },
        push(callback) {
          callback(this)
        },
      },
    },
  )
  await new Promise(setImmediate)

  assert.deepEqual(requests, [])
})

test('project dashboard releases a synchronously failed state waiter', async () => {
  const state = { status: 'error' }
  let subscriptions = 0
  let unsubscriptions = 0
  const instance = {
    getState: () => state,
    subscribe(handler) {
      subscriptions += 1
      handler(state)
      return () => {
        unsubscriptions += 1
      }
    },
  }

  await loadBridge(
    async (input) => {
      throw new Error(`Unexpected request: ${input}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects' ? instance : null
        },
      },
    },
  )

  assert.ok(await waitFor(() => subscriptions === 2 && unsubscriptions === 1))
})

test('project lifecycle replay retries transient failure and accepts earlier exhaustion', async () => {
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'End Project'
  const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects', 'wf-xano-source': 'opp30:brand/projects/mine' },
    [card],
  )
  const events = []
  const handlers = new Set()
  let failNextPageTwo = true
  let state = {
    status: 'success',
    data: {
      items: [
        { id: 675, lifecycle_state: 'active', lifecycle_version: 1 },
        ...Array.from({ length: 83 }, (_, index) => ({ id: index + 1 })),
      ],
      hasMore: true,
    },
    query: { page: 7, perPage: 12 },
  }
  const pageItems = (page) => {
    const start = (page - 1) * 12
    return Array.from({ length: 12 }, (_, index) => {
      const position = start + index
      return position === 0
        ? { id: 675, lifecycle_state: 'active', lifecycle_version: 2 }
        : { id: position }
    })
  }
  const publishPage = (page, append) => {
    const items = append ? state.data.items.concat(pageItems(page)) : pageItems(page)
    state = {
      status: 'success',
      data: { items, hasMore: page < 6 },
      query: { page, perPage: 12 },
    }
    handlers.forEach((handler) => handler(state))
    return Promise.resolve(state)
  }
  const instance = {
    getState: () => state,
    goToPage(page) {
      events.push({ type: `page:${page}` })
      return publishPage(page, false)
    },
    loadNext() {
      const page = state.query.page + 1
      if (page === 2 && failNextPageTwo) {
        failNextPageTwo = false
        events.push({ type: 'page:2:error' })
        state = {
          status: 'error',
          data: state.data,
          query: { page: 1, perPage: 12 },
        }
        handlers.forEach((handler) => handler(state))
        return Promise.resolve()
      }
      events.push({ type: `page:${page}` })
      return publishPage(page, true)
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/projects/action/v3')) {
        events.push({ type: 'action', body: JSON.parse(init.body) })
        return response({ project: { id: 675, lifecycle_state: 'completion_requested' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects' ? instance : null
        },
      },
    },
  )
  bridge.window.prompt = () => 'COMPLETE'
  assert.ok(await waitFor(() => end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(end).event)

  assert.ok(await waitFor(() => events.some((event) => event.type === 'action')))
  assert.deepEqual(
    events.slice(0, 8).map((event) => event.type),
    ['page:1', 'page:2:error', 'page:2', 'page:3', 'page:4', 'page:5', 'page:6', 'action'],
  )
  assert.equal(events.find((event) => event.type === 'action').body.expected_version, 2)
  assert.equal(state.data.items.length, 72)
})

test('project lifecycle lock follows replacement controls during replay', async () => {
  const projectCard = (version) => {
    const end = el('button', { 'wf-xano-link': 'project-end' })
    const label = el('div', { class: 'button_main-text' })
    label.textContent = 'End Project'
    const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
    const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
    return { card, end, label, version, wrap }
  }
  let live = projectCard(1)
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects', 'wf-xano-source': 'opp30:brand/projects/mine' },
    [live.card],
  )
  const handlers = new Set()
  const firstPageTwo = deferred()
  let holdFirstPageTwo = true
  let prompts = 0
  let mutations = 0
  let state = {
    status: 'success',
    data: {
      items: [{ id: 675, lifecycle_state: 'active', lifecycle_version: 1 }],
      hasMore: true,
    },
    query: { page: 2, perPage: 12 },
  }
  const replaceCard = (version) => {
    live = projectCard(version)
    live.card.parent = root
    root.children = [live.card]
  }
  const publishPage = (page, append) => {
    const pageItems = page === 1
      ? [{ id: 675, lifecycle_state: 'active', lifecycle_version: 2 }]
      : Array.from({ length: 12 }, (_, index) => ({ id: 12 + index }))
    if (page === 1) replaceCard(2)
    state = {
      status: 'success',
      data: {
        items: append ? state.data.items.concat(pageItems) : pageItems,
        hasMore: page < 2,
      },
      query: { page, perPage: 12 },
    }
    handlers.forEach((handler) => handler(state))
    return state
  }
  const instance = {
    getState: () => state,
    goToPage(page) {
      publishPage(page, false)
      return Promise.resolve(state)
    },
    async loadNext() {
      if (holdFirstPageTwo) {
        holdFirstPageTwo = false
        await firstPageTwo.promise
      }
      return publishPage(2, true)
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/projects/action/v3')) {
        mutations += 1
        assert.equal(JSON.parse(init.body).expected_version, 2)
        return response({
          project: { id: 675, lifecycle_state: 'completion_requested', lifecycle_version: 3 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects' ? instance : null
        },
      },
    },
  )
  bridge.window.prompt = () => {
    prompts += 1
    return 'COMPLETE'
  }
  assert.ok(await waitFor(() => live.end.getAttribute('data-project-action') === 'end'))
  const firstAction = live.end

  bridge.dispatchDocument('click', clickEvent(firstAction).event)

  assert.ok(await waitFor(() => live.end !== firstAction && live.wrap.getAttribute('aria-disabled') === 'true'))
  bridge.dispatchDocument('click', clickEvent(live.end).event)
  await new Promise(setImmediate)
  assert.equal(prompts, 0)
  assert.equal(mutations, 0)

  firstPageTwo.resolve()
  assert.ok(await waitFor(
    () => mutations === 1 && live.wrap.getAttribute('aria-disabled') === null,
  ))
  assert.equal(prompts, 1)
})

test('project contract lock follows replacement controls during replay', async () => {
  const projectCard = () => {
    const contract = el('a', { href: '#contract' })
    const label = el('div', { class: 'button_main-text' })
    label.textContent = 'View Contract'
    const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
    const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
    return { card, contract, label, wrap }
  }
  let live = projectCard()
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects', 'wf-xano-source': 'opp30:brand/projects/mine' },
    [live.card],
  )
  const handlers = new Set()
  const firstPageTwo = deferred()
  let holdFirstPageTwo = true
  let opened = 0
  let linkRequests = 0
  let state = {
    status: 'success',
    data: {
      items: [{
        id: 675,
        sync_origin: 'v3',
        contract_source: 'standard',
        lifecycle_state: 'contract_sent',
        pandadoc_document_id: 'doc-675',
        contract_status: 'sent',
      }],
      hasMore: true,
    },
    query: { page: 2, perPage: 12 },
  }
  const replaceCard = () => {
    live = projectCard()
    live.card.parent = root
    live.card.parentNode = root
    root.children = [live.card]
  }
  const publishPage = (page, append) => {
    const pageItems = page === 1
      ? [{
          id: 675,
          sync_origin: 'v3',
          contract_source: 'standard',
          lifecycle_state: 'contract_sent',
          pandadoc_document_id: 'doc-675',
          contract_status: 'sent',
        }]
      : Array.from({ length: 12 }, (_, index) => ({ id: 12 + index }))
    if (page === 1) replaceCard()
    state = {
      status: 'success',
      data: {
        items: append ? state.data.items.concat(pageItems) : pageItems,
        hasMore: page < 2,
      },
      query: { page, perPage: 12 },
    }
    handlers.forEach((handler) => handler(state))
    return state
  }
  const instance = {
    getState: () => state,
    goToPage(page) {
      publishPage(page, false)
      return Promise.resolve(state)
    },
    async loadNext() {
      if (holdFirstPageTwo) {
        holdFirstPageTwo = false
        await firstPageTwo.promise
      }
      return publishPage(2, true)
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/contracts/link/v3')) {
        linkRequests += 1
        return response({ url: 'https://app.pandadoc.com/s/doc-675' })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects' ? instance : null
        },
      },
    },
  )
  bridge.window.open = () => {
    opened += 1
    return { closed: false, close() {}, location: {}, opener: bridge.window }
  }
  assert.ok(await waitFor(() => live.contract.getAttribute('data-project-action') === 'contract'))
  await new Promise(setImmediate)
  const firstAction = live.contract

  bridge.dispatchDocument('click', clickEvent(firstAction).event)

  assert.ok(await waitFor(
    () => live.contract !== firstAction && live.wrap.getAttribute('aria-disabled') === 'true',
  ))
  bridge.dispatchDocument('click', clickEvent(live.contract).event)
  await new Promise(setImmediate)
  assert.equal(opened, 0)
  assert.equal(linkRequests, 0)

  firstPageTwo.resolve()
  assert.ok(await waitFor(
    () => linkRequests === 1 && live.wrap.getAttribute('aria-disabled') === null,
  ))
  assert.equal(opened, 1)
})

test('project lifecycle success survives repeated failure on the same replay page', async () => {
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'End Project'
  const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects', 'wf-xano-source': 'opp30:brand/projects/mine' },
    [card],
  )
  const events = []
  const handlers = new Set()
  let mutationConfirmed = false
  let failedAttempts = 0
  let state = {
    status: 'success',
    data: {
      items: [
        { id: 675, lifecycle_state: 'active', lifecycle_version: 1 },
        ...Array.from({ length: 35 }, (_, index) => ({ id: index + 1 })),
      ],
      hasMore: true,
    },
    query: { page: 3, perPage: 12 },
  }
  const pageItems = (page) => {
    const start = (page - 1) * 12
    return Array.from({ length: 12 }, (_, index) => {
      const position = start + index
      return position === 0
        ? { id: 675, lifecycle_state: 'active', lifecycle_version: 2 }
        : { id: position }
    })
  }
  const publishPage = (page, append) => {
    state = {
      status: 'success',
      data: {
        items: append ? state.data.items.concat(pageItems(page)) : pageItems(page),
        hasMore: page < 7,
      },
      query: { page, perPage: 12 },
    }
    handlers.forEach((handler) => handler(state))
    return Promise.resolve(state)
  }
  const instance = {
    getState: () => state,
    goToPage(page) {
      events.push(`page:${page}`)
      return publishPage(page, false)
    },
    loadNext() {
      const page = state.query.page + 1
      if (mutationConfirmed && page === 2) {
        failedAttempts += 1
        events.push('page:2:error')
        state = {
          status: 'error',
          data: state.data,
          query: { page: 1, perPage: 12 },
        }
        handlers.forEach((handler) => handler(state))
        return Promise.resolve()
      }
      events.push(`page:${page}`)
      return publishPage(page, true)
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/projects/action/v3')) {
        mutationConfirmed = true
        events.push('action')
        assert.equal(JSON.parse(init.body).expected_version, 2)
        return response({
          project: { id: 675, lifecycle_state: 'completion_requested', lifecycle_version: 3 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects' ? instance : null
        },
      },
    },
  )
  bridge.window.prompt = () => 'COMPLETE'
  assert.ok(await waitFor(() => end.getAttribute('data-project-action') === 'end'))
  const timers = []
  bridge.window.setTimeout = (callback, delay) => {
    const timer = { callback, delay, canceled: false }
    timers.push(timer)
    return timer
  }
  bridge.window.clearTimeout = (timer) => {
    if (timer) timer.canceled = true
  }

  bridge.dispatchDocument('click', clickEvent(end).event)

  assert.ok(await waitFor(() => failedAttempts === 2 && bridge.consoleErrors.length > 0))
  const actionIndex = events.indexOf('action')
  assert.deepEqual(events.slice(actionIndex + 1), ['page:1', 'page:2:error', 'page:2:error'])
  assert.equal(wrap.getAttribute('data-project-action-result'), 'success')
  assert.equal(label.textContent, 'Completion requested')
  assert.match(String(bridge.consoleErrors.at(-1)[0]), /lifecycle projection refresh failed/)

  bridge.notifyMutations([{ type: 'childList', target: label }])
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(label.textContent, 'Completion requested')
  assert.equal(wrap.getAttribute('data-project-action-result'), 'success')
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 3500)

  bridge.dispatchDocument('click', clickEvent(end).event)
  assert.ok(await waitFor(() => timers.length === 2))

  assert.equal(timers[0].canceled, true)
  assert.equal(timers[1].delay, 6000)
  assert.equal(label.textContent, 'Project list cannot be refreshed')
  assert.equal(wrap.getAttribute('data-project-action-result'), 'error')

  timers[0].callback()
  bridge.notifyMutations([{ type: 'childList', target: label }])
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(label.textContent, 'Project list cannot be refreshed')
  assert.equal(wrap.getAttribute('data-project-action-result'), 'error')

  timers[1].callback()

  assert.equal(label.textContent, 'End Project')
  assert.equal(wrap.getAttribute('data-project-action-result'), null)
})

test('project lifecycle success uses stable feedback after page-one replay failure', async () => {
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'End Project'
  const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects', 'wf-xano-source': 'opp30:brand/projects/mine' },
    [card],
  )
  const handlers = new Set()
  let refreshCount = 0
  let mutations = 0
  let state = {
    status: 'success',
    data: {
      items: [{ id: 675, lifecycle_state: 'active', lifecycle_version: 1 }],
      hasMore: false,
    },
    query: { page: 1, perPage: 12 },
  }
  const instance = {
    getState: () => state,
    refresh() {
      refreshCount += 1
      if (refreshCount === 1) {
        state = {
          status: 'success',
          data: {
            items: [{ id: 675, lifecycle_state: 'active', lifecycle_version: 2 }],
            hasMore: false,
          },
          query: { page: 1, perPage: 12 },
        }
      } else {
        root.children = []
        state = {
          status: 'error',
          data: { items: [], hasMore: false },
          query: { page: 1, perPage: 12 },
        }
      }
      handlers.forEach((handler) => handler(state))
      return Promise.resolve()
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/projects/action/v3')) {
        mutations += 1
        assert.equal(JSON.parse(init.body).expected_version, 2)
        return response({
          project: { id: 675, lifecycle_state: 'completion_requested', lifecycle_version: 3 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects' ? instance : null
        },
      },
    },
  )
  bridge.window.prompt = () => 'COMPLETE'
  assert.ok(await waitFor(() => end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(end).event)

  assert.ok(await waitFor(() => {
    const feedback = root.querySelector('[data-project-workflow-feedback]')
    return feedback && feedback.textContent === 'Completion requested'
  }))
  const feedback = root.querySelector('[data-project-workflow-feedback]')
  assert.equal(mutations, 1)
  assert.equal(feedback.getAttribute('role'), 'status')
  assert.equal(feedback.getAttribute('data-project-action-result'), 'success')
  assert.match(String(bridge.consoleErrors.at(-1)[0]), /lifecycle projection refresh failed/)
})

test('invoice helpers turn the Stripe prerequisite into an actionable dashboard message', async () => {
  const bridge = await loadBridge(async () => response({}))

  assert.equal(
    bridge.window.Opp30.invoiceErrorMessage({
      data: { message: 'Connect a Stripe account before generating invoices' },
    }),
    'Connect your Stripe account from the dashboard before generating invoices.',
  )
  assert.equal(bridge.window.Opp30.formatInvoiceAmount(25.5), '$25.50')
})

test('invoice behavior binds only on exact normalized invoice routes', async () => {
  const starter = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/opportunities/match-context')) {
        return response({ category_refs: [] })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember, pathname: '/starter-dashboard', routeGuard: true },
  )
  assert.ok(await waitFor(() => starter.window.__opp30InvoicesWired === true))

  const starterSlash = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/starter/opportunities/match-context')) {
        return response({ category_refs: [] })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember, pathname: '/starter-dashboard/', routeGuard: true },
  )
  assert.ok(await waitFor(() => starterSlash.window.__opp30InvoicesWired === true))

  const similarStarter = await loadBridge(async () => response({}), {
    member: talentMember,
    pathname: '/starter-dashboard---availability-stage',
    routeGuard: true,
  })
  assert.equal(similarStarter.window.__opp30InvoicesWired, undefined)

  const preview = await loadBridge(async () => response({}), { pathname: '/all-modals/' })
  assert.equal(preview.window.__opp30InvoicesWired, true)

  const nestedPreview = await loadBridge(async () => response({}), {
    pathname: '/internal/all-modals',
  })
  assert.equal(nestedPreview.window.__opp30InvoicesWired, undefined)

  const brand = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    pathname: '/brand-dashboard',
    routeGuard: true,
  })
  await Promise.resolve()
  assert.equal(brand.window.__opp30InvoicesWired, undefined)
})

for (const dashboard of [
  {
    label: 'Brand',
    instance: 'dash-brand-projects',
    member: paidBrandMember,
    pathname: '/brand-dashboard',
  },
  {
    label: 'Starter',
    instance: 'dash-projects',
    member: talentMember,
    pathname: '/starter-dashboard',
  },
]) {
  test(`${dashboard.label} dashboard prepares lazy project details with multiline scope`, async () => {
    const scope = el('div', { 'wf-xano-bind': 'project_scope' })
    const nestedScope = el('div', { 'wf-xano-bind': 'value' })
    const scopeTarget = el(
      'div',
      {
        'wf-xano-element': 'nest-target',
        'wf-xano-field': 'project_scope_details',
      },
      [nestedScope],
    )
    const details = el('div', { 'wf-xano-element': 'details-target' }, [scope, scopeTarget])
    const template = el('div', { 'wf-xano-element': 'template' }, [details])
    const root = el(
      'div',
      { 'wf-xano-instance': dashboard.instance, 'wf-xano-source': '' },
      [template],
    )

    await loadBridge(async (input) => {
      const url = String(input)
      if (url.includes('/starter/opportunities/match-context')) return response({ category_refs: [] })
      return response({})
    }, {
      member: dashboard.member,
      pathname: dashboard.pathname,
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    })

    assert.equal(details.hasAttribute('wf-xano-lazy-details'), true)
    assert.equal(scope.style.whiteSpace, 'pre-wrap')
    assert.equal(scope.style.overflowWrap, 'anywhere')
    assert.equal(nestedScope.style.whiteSpace, 'pre-wrap')
    assert.equal(nestedScope.style.overflowWrap, 'anywhere')
  })
}

test('invoice behavior requires the canonical Talent plan role', async () => {
  const ambiguousLegacyBrand = {
    ...paidBrandMember,
    customFields: {
      'brands-dashboard-url': '/brand-dashboard',
      'freelancer-dashboard-url': '/starter-dashboard',
    },
  }
  const wrongRole = await loadBridge(async () => response({ category_refs: [] }), {
    member: ambiguousLegacyBrand,
    pathname: '/starter-dashboard',
    routeGuard: false,
  })
  await Promise.resolve()
  assert.equal(wrongRole.window.__opp30InvoicesWired, undefined)
})

test('invoice listeners teardown and rebind with Memberstack scope changes', async () => {
  const secondTalentMember = { ...talentMember, id: 'm-talent-2' }
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/starter/opportunities/match-context')) {
        return response({ category_refs: [] })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember, pathname: '/starter-dashboard', routeGuard: true },
  )
  assert.ok(await waitFor(() => bridge.window.__opp30InvoicesWired === true))
  assert.equal(bridge.documentListenerCount('submit'), 1)

  bridge.authChange(paidBrandMember)
  assert.equal(bridge.window.__opp30InvoicesWired, undefined)
  assert.equal(bridge.documentListenerCount('submit'), 0)

  bridge.authChange(secondTalentMember)
  assert.equal(bridge.window.__opp30InvoicesWired, true)
  assert.equal(bridge.documentListenerCount('submit'), 1)

  bridge.authChange(null)
  assert.equal(bridge.window.__opp30InvoicesWired, undefined)
  assert.equal(bridge.documentListenerCount('submit'), 0)
})

// A minimal element graph with attribute-accurate matches()/closest()/query*,
// so the invoice submit guards are exercised against real selector semantics
// instead of a substring match that would still pass if the selector were
// broadened or its form/modal scoping dropped.
function el(tag, attrs = {}, children = []) {
  const attributes = new Map(Object.entries(attrs))
  const node = { tag, attributes, children, parent: null, dataset: {}, style: {} }
  node.classList = {
    add: (...names) => {
      const classes = new Set((attributes.get('class') || '').split(/\s+/).filter(Boolean))
      names.forEach((name) => classes.add(name))
      attributes.set('class', [...classes].join(' '))
    },
    remove: (...names) => {
      const classes = new Set((attributes.get('class') || '').split(/\s+/).filter(Boolean))
      names.forEach((name) => classes.delete(name))
      attributes.set('class', [...classes].join(' '))
    },
  }
  if (tag === 'button' || tag === 'input') node.disabled = false
  children.forEach((child) => {
    child.parent = node
    child.parentNode = node
  })
  node.getAttribute = (name) => (attributes.has(name) ? attributes.get(name) : null)
  node.setAttribute = (name, value) => attributes.set(name, String(value))
  node.removeAttribute = (name) => attributes.delete(name)
  node.hasAttribute = (name) => attributes.has(name)
  node.matches = (selector) => selectorMatches(node, selector)
  node.closest = (selector) => {
    for (let current = node; current; current = current.parent) {
      if (selectorMatches(current, selector)) return current
    }
    return null
  }
  node.contains = (other) => other === node || descendants(node).includes(other)
  node.appendChild = (child) => {
    child.parent = node
    child.parentNode = node
    node.children.push(child)
    return child
  }
  node.querySelectorAll = (selector) =>
    descendants(node).filter((descendant) => selectorMatches(descendant, selector))
  node.querySelector = (selector) => node.querySelectorAll(selector)[0] || null
  return node
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)])
}

// The grammar the invoice selectors actually use: comma-separated lists of
// descendant-combined simple selectors built from a tag, #id, .class and
// [attr] / [attr="value"] terms.
function simpleMatches(node, simple) {
  const terms = simple.match(/^[a-z]+|#[\w-]+|\.[\w-]+|\[[^\]]+\]/gi) || []
  return terms.every((term) => {
    if (term.startsWith('#')) return node.getAttribute('id') === term.slice(1)
    if (term.startsWith('.')) {
      return (node.getAttribute('class') || '').split(/\s+/).includes(term.slice(1))
    }
    if (term.startsWith('[')) {
      const parsed = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(term)
      if (!parsed) throw new Error(`unsupported attribute selector: ${term}`)
      if (!node.hasAttribute(parsed[1])) return false
      return parsed[2] === undefined || node.getAttribute(parsed[1]) === parsed[2]
    }
    return node.tag === term
  })
}

function selectorMatches(node, selector) {
  return String(selector)
    .split(',')
    .some((part) => {
      const simples = part.trim().split(/\s+/)
      let current = node
      if (!simpleMatches(current, simples.pop())) return false
      while (simples.length) {
        const simple = simples.pop()
        let ancestor = current.parent
        while (ancestor && !simpleMatches(ancestor, simple)) ancestor = ancestor.parent
        if (!ancestor) return false
        current = ancestor
      }
      return true
    })
}

// The Generate Invoice modal as the shared Webflow button component renders it:
// the visible Send Invoice control is a .button_main-wrap wrapper carrying the
// theme attributes, and the element inside it is type="button", so no native
// submitter exists in the form.
function invoiceSubmitDom({
  disabled = false,
  hook = false,
  hookOnCta = false,
  inModal = true,
  isForm = true,
  nativeSubmit = false,
  secondPrimary = false,
} = {}) {
  const ctaAttrs = { type: 'button', class: 'clickable_btn' }
  if (hookOnCta) ctaAttrs['data-wf-invoice'] = 'submit'
  const cta = el('button', ctaAttrs)
  const ctaText = el('div', { class: 'button_main-text' })
  const wrapAttrs = {
    class: 'button_main-wrap',
    'data-button-style': 'primary',
    'data-button-theme': 'black',
  }
  if (hook) wrapAttrs['data-wf-invoice'] = 'submit'
  if (disabled) {
    wrapAttrs['data-button-theme'] = 'disabled'
    wrapAttrs['aria-disabled'] = 'true'
  }
  const wrap = el('div', wrapAttrs, [cta, ctaText])
  const amount = el('input', { id: 'Amount', name: 'Amount' })
  amount.value = '250'
  const description = el('input', { id: 'Description', name: 'Description' })
  description.value = 'August retainer'
  const fields = [amount, description, wrap]
  if (nativeSubmit) fields.push(el('input', { type: 'submit', class: 'w-button' }))
  if (secondPrimary) {
    fields.push(
      el('div', { class: 'button_main-wrap', 'data-button-style': 'primary' }, [
        el('button', { type: 'button' }),
      ]),
    )
  }
  const form = el(isForm ? 'form' : 'div', { id: 'wf-form-Generate-Invoice' }, fields)
  let submits = 0
  form.requestSubmit = () => {
    submits += 1
  }
  form.reset = () => {}
  const fail = el('div', { class: 'w-form-fail' })
  const done = el('div', { class: 'w-form-done' }, [
    el('div', { class: 'button_main-wrap', 'data-button-style': 'primary' }, [
      el('a', { class: 'clickable_link', href: '#invoice-payment-link' }),
    ]),
  ])
  const modal = el(
    'dialog',
    inModal ? { 'data-modal-target': 'generate-invoice' } : {},
    [form, fail, done],
  )
  return { amount, cta, ctaText, description, form, modal, wrap, submitCount: () => submits }
}

function clickEvent(target) {
  const counts = { prevented: 0, stopped: 0 }
  return {
    counts,
    event: {
      target,
      preventDefault: () => {
        counts.prevented += 1
      },
      stopPropagation: () => {
        counts.stopped += 1
      },
    },
  }
}

test('Brand project cards expose only canonical actions for their current lifecycle state', async () => {
  const action = (tag, attrs, label) => {
    const control = el(tag, attrs)
    const text = el('div', { class: 'button_main-text' })
    const wrap = el('div', { class: 'button_main-wrap' }, [control, text])
    text.textContent = label
    return { control, text, wrap }
  }
  const contract = action('a', { href: '#contract' }, 'View Contract')
  const end = action('button', { 'wf-xano-link': 'project-end' }, 'End Project')
  const review = action(
    'a',
    { href: '/messages', 'wf-xano-link': 'review_starter' },
    'Review Starter',
  )
  const card = el(
    'div',
    { class: 'project_item', 'data-wf-xano-id': '675' },
    [contract.wrap, end.wrap, review.wrap],
  )
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects' },
    [card],
  )
  const querySelector = (selector) =>
    selectorMatches(root, selector) ? root : root.querySelector(selector)
  const querySelectorAll = (selector) =>
    [root, ...descendants(root)].filter((node) => selectorMatches(node, selector))

  await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            status: 'completed',
            lifecycle_state: 'completed',
            lifecycle_version: 4,
            pandadoc_document_id: 'doc-675',
            contract_status: 'completed',
            review_eligible: true,
            has_review: false,
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector,
      querySelectorAll,
      routeGuard: true,
    },
  )
  await new Promise(setImmediate)

  assert.equal(contract.control.getAttribute('data-project-action'), 'contract')
  assert.equal(contract.wrap.style.display, 'none')
  assert.equal(end.control.getAttribute('wf-xano-link'), null)
  assert.equal(end.control.getAttribute('data-project-action'), 'end')
  assert.equal(end.wrap.style.display, 'none')
  assert.equal(review.control.getAttribute('wf-xano-link'), null)
  assert.equal(review.control.getAttribute('href'), '#review-starter')
  assert.equal(review.wrap.style.display, '')
})

test('Starter project cards keep completed contracts off the signing-session route', async () => {
  const contract = el('a', { href: '#contract' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'View Contract'
  const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-projects' },
    [card],
  )
  const contractRequests = []

  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'completed',
            pandadoc_document_id: 'doc-675',
            contract_status: 'completed',
          }],
        })
      }
      if (url.includes('/contracts/link/v3')) {
        contractRequests.push(url)
        return response({ url: 'https://app.pandadoc.com/s/completed-contract' })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  await new Promise(setImmediate)

  assert.equal(contract.getAttribute('data-project-action'), 'contract')
  assert.equal(wrap.style.display, 'none')
  assert.equal(wrap.getAttribute('aria-hidden'), 'true')

  bridge.dispatchDocument('click', clickEvent(contract).event)
  await new Promise(setImmediate)
  assert.deepEqual(contractRequests, [])
})

test('View Contract stays hidden until canonical project context authorizes it', async () => {
  const contract = el('a', { href: '#contract' })
  const invoice = el('a', { href: '#generate-invoice' })
  const contractWrap = el('div', { class: 'button_main-wrap' }, [contract])
  const invoiceWrap = el('div', { class: 'button_main-wrap' }, [invoice])
  const card = el(
    'div',
    { class: 'project_item', 'data-wf-xano-id': '680' },
    [contractWrap, invoiceWrap],
  )
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-projects' },
    [card],
  )
  const projectList = deferred()

  await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) return projectList.promise
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  assert.ok(await waitFor(() => contract.getAttribute('data-project-action') === 'contract'))

  assert.equal(contractWrap.style.display, 'none')
  assert.equal(contractWrap.getAttribute('aria-hidden'), 'true')
  assert.equal(invoiceWrap.style.display, undefined)
  assert.equal(invoiceWrap.getAttribute('aria-hidden'), null)

  projectList.resolve(response({
    items: [{
      id: 680,
      sync_origin: 'v3',
      contract_source: 'standard',
      brand_signed_at: '2026-08-12T01:00:00Z',
      lifecycle_state: 'contract_sent',
      pandadoc_document_id: 'doc-680',
      contract_status: 'sent',
    }],
  }))
  assert.ok(await waitFor(() => contractWrap.style.display === ''))
  assert.equal(contractWrap.getAttribute('aria-hidden'), 'false')
  assert.equal(invoiceWrap.style.display, undefined)
  assert.equal(invoiceWrap.getAttribute('aria-hidden'), null)
})

test('View Contract fails closed when a project card renders after dashboard boot', async () => {
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-projects' },
  )
  const projectList = deferred()
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) return projectList.promise
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  const contract = el('a', { href: '#contract' })
  const wrap = el('div', { class: 'button_main-wrap' }, [contract])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '680' }, [wrap])
  card.parent = root
  root.children.push(card)
  bridge.notifyMutations([{ addedNodes: [card] }])
  await new Promise(setImmediate)

  assert.equal(contract.getAttribute('data-project-action'), 'contract')
  assert.equal(wrap.style.display, 'none')
  assert.equal(wrap.getAttribute('aria-hidden'), 'true')

  projectList.resolve(response({
    items: [{
      id: 680,
      sync_origin: 'v3',
      contract_source: 'standard',
      brand_signed_at: '2026-08-12T01:00:00Z',
      lifecycle_state: 'contract_sent',
      pandadoc_document_id: 'doc-680',
      contract_status: 'sent',
    }],
  }))
  assert.ok(await waitFor(() => wrap.style.display === ''))
  assert.equal(wrap.getAttribute('aria-hidden'), 'false')
})

test('View Contract is limited to recipient-viewable canonical document states', async () => {
  const bridge = await loadBridge(async () => response({}))
  const isViewable = bridge.window.Opp30.projectContractIsViewable
  const canonicalStates = [
    'not_requested',
    'create_pending',
    'uploaded',
    'draft',
    'sent',
    'viewed',
    'partial',
    'completed',
    'declined',
    'expired',
    'error',
  ]

  canonicalStates.forEach((contractStatus) => {
    assert.equal(
      isViewable({ pandadoc_document_id: 'doc-675', contract_status: contractStatus }),
      ['sent', 'viewed', 'partial'].includes(contractStatus),
      contractStatus,
    )
  })
  assert.equal(isViewable({ contract_status: 'completed' }), false)
  assert.equal(isViewable({ pandadoc_document_id: 'doc-675' }), false)
})

test('contract signing panel reducer enforces Standard Contract and Brand-first signing', async () => {
  const bridge = await loadBridge(async () => response({}))
  const reduce = bridge.window.Opp30.projectContractPanelState
  const base = {
    id: 708,
    sync_origin: 'v3',
    contract_source: 'standard',
    lifecycle_state: 'contract_sent',
    contract_status: 'sent',
    pandadoc_document_id: 'doc-708',
    company_name: 'Acme',
    starter_name: 'Taylor',
  }

  assert.equal(reduce({ ...base, contract_source: 'own' }, 'brand').visible, false)
  assert.equal(reduce({ ...base, sync_origin: 'v2' }, 'brand').visible, false)
  assert.equal(reduce(base, 'brand').action, 'sign')
  assert.equal(reduce(base, 'starter').action, null)
  assert.equal(reduce(base, 'starter').state, 'waiting')

  const brandSigned = { ...base, brand_signed_at: '2026-08-12T01:00:00Z' }
  assert.equal(reduce(brandSigned, 'brand').action, 'view')
  assert.equal(reduce(brandSigned, 'starter').action, 'sign')

  const outOfOrder = { ...base, starter_signed_at: '2026-08-12T01:01:00Z' }
  assert.equal(reduce(outOfOrder, 'brand').action, null)
  assert.equal(reduce(outOfOrder, 'brand').state, 'attention')
  assert.equal(reduce(outOfOrder, 'starter').action, null)
  assert.equal(reduce(outOfOrder, 'starter').state, 'attention')

  const bothSigned = {
    ...brandSigned,
    starter_signed_at: '2026-08-12T01:01:00Z',
    lifecycle_state: 'signature_partial',
    contract_status: 'partial',
  }
  assert.equal(reduce(bothSigned, 'brand').state, 'processing')
  assert.equal(reduce(bothSigned, 'brand').action, null)
  assert.equal(reduce({ ...bothSigned, lifecycle_state: 'active' }, 'brand').visible, false)

  const partialWithoutTimestamps = { ...base, contract_status: 'partial' }
  assert.equal(reduce(partialWithoutTimestamps, 'brand').state, 'attention')
  assert.equal(reduce(partialWithoutTimestamps, 'brand').action, null)
  assert.equal(reduce(partialWithoutTimestamps, 'starter').state, 'attention')
  assert.equal(reduce(partialWithoutTimestamps, 'starter').action, null)
  assert.equal(reduce(partialWithoutTimestamps, 'brand').brandBadge, 'brand-pending')
  assert.equal(reduce(partialWithoutTimestamps, 'starter').starterBadge, 'starter-pending')
  assert.equal(reduce({ ...base, lifecycle_state: 'contract_draft' }, 'brand').state, 'processing')
  assert.equal(reduce({ ...base, contract_status: 'declined' }, 'brand').state, 'attention')
})

test('contract panel paints one badge per party and only the authorized role action', async () => {
  const topAction = el('a', { href: '#contract' })
  const topLabel = el('div', { class: 'button_main-text' })
  topLabel.textContent = 'View Contract'
  const topWrap = el('div', { class: 'button_main-wrap' }, [topAction, topLabel])
  const title = el('div', { 'data-project-contract-title': '' })
  const body = el('div', { 'data-project-contract-body': '' })
  const badges = [
    'brand-pending', 'brand-signed', 'starter-pending', 'starter-signed',
  ].map((value) => el('div', { 'data-project-contract-badge': value }))
  const signAction = el('a', { 'data-project-contract-action': 'sign' })
  const signLabel = el('div', { class: 'button_main-text' })
  signLabel.textContent = 'Review & Sign Contract'
  const signWrap = el('div', { class: 'button_main-wrap' }, [signAction, signLabel])
  const viewAction = el('a', { 'data-project-contract-action': 'view' })
  const viewLabel = el('div', { class: 'button_main-text' })
  viewLabel.textContent = 'View Contract'
  const viewWrap = el('div', { class: 'button_main-wrap' }, [viewAction, viewLabel])
  const actions = el('div', { 'data-project-contract-actions': '' }, [signWrap, viewWrap])
  const panel = el('div', { 'data-project-contract-panel': '' }, [
    title, body, ...badges, actions,
  ])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '708' }, [
    topWrap, panel,
  ])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])

  await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        return response({
          items: [{
            id: 708,
            sync_origin: 'v3',
            contract_source: 'standard',
            lifecycle_state: 'signature_partial',
            contract_status: 'partial',
            pandadoc_document_id: 'doc-708',
            brand_signed_at: '2026-08-12T01:00:00Z',
            company_name: 'Acme',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => panel.getAttribute('data-project-contract-state') === 'action'))
  assert.equal(panel.style.display, '')
  assert.equal(title.textContent, 'Acme has signed')
  assert.equal(signWrap.style.display, '')
  assert.equal(viewWrap.style.display, 'none')
  assert.equal(topWrap.style.display, '')
  assert.equal(topLabel.textContent, 'Review & Sign Contract')
  const visibleBadges = badges
    .filter((badge) => badge.style.display === '')
    .map((badge) => badge.getAttribute('data-project-contract-badge'))
  assert.deepEqual(visibleBadges, ['brand-signed', 'starter-pending'])

})

test('contract panel refreshes canonical signing state after returning from PandaDoc', async () => {
  const title = el('div', { 'data-project-contract-title': '' })
  const body = el('div', { 'data-project-contract-body': '' })
  const badges = [
    'brand-pending', 'brand-signed', 'starter-pending', 'starter-signed',
  ].map((value) => el('div', { 'data-project-contract-badge': value }))
  const signAction = el('a', { 'data-project-contract-action': 'sign' })
  const signWrap = el('div', { class: 'button_main-wrap' }, [signAction])
  const viewAction = el('a', { 'data-project-contract-action': 'view' })
  const viewWrap = el('div', { class: 'button_main-wrap' }, [viewAction])
  const actions = el('div', { 'data-project-contract-actions': '' }, [signWrap, viewWrap])
  const panel = el('div', { 'data-project-contract-panel': '' }, [
    title, body, ...badges, actions,
  ])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '708' }, [panel])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])
  let listRequests = 0

  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        listRequests += 1
        return response({
          items: [{
            id: 708,
            sync_origin: 'v3',
            contract_source: 'standard',
            lifecycle_state: listRequests === 1 ? 'contract_sent' : 'signature_partial',
            contract_status: listRequests === 1 ? 'sent' : 'partial',
            pandadoc_document_id: 'doc-708',
            brand_signed_at: listRequests === 1 ? null : '2026-08-12T01:00:00Z',
            company_name: 'Acme',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => title.textContent === 'Waiting for Acme to sign'))
  assert.equal(actions.style.display, 'none')

  bridge.dispatchWindow('pageshow')

  assert.ok(await waitFor(() => listRequests === 2 && title.textContent === 'Acme has signed'))
  assert.equal(signWrap.style.display, '')
  assert.equal(viewWrap.style.display, 'none')
  const visibleBadges = badges
    .filter((badge) => badge.style.display === '')
    .map((badge) => badge.getAttribute('data-project-contract-badge'))
  assert.deepEqual(visibleBadges, ['brand-signed', 'starter-pending'])

  // PandaDoc can open in a separate window without hiding the dashboard.
  // Returning to the dashboard fires focus rather than pageshow.
  bridge.dispatchWindow('focus')
  assert.ok(await waitFor(() => listRequests === 3))
})

test('contract panel fails closed when its return refresh fails', async () => {
  const signAction = el('a', { 'data-project-contract-action': 'sign' })
  const signWrap = el('div', { class: 'button_main-wrap' }, [signAction])
  const actions = el('div', { 'data-project-contract-actions': '' }, [signWrap])
  const panel = el('div', { 'data-project-contract-panel': '' }, [actions])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '708' }, [panel])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
  let listRequests = 0

  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        listRequests += 1
        if (listRequests > 1) throw new Error('Temporary project list failure')
        return response({
          items: [{
            id: 708,
            sync_origin: 'v3',
            contract_source: 'standard',
            lifecycle_state: 'contract_sent',
            contract_status: 'sent',
            pandadoc_document_id: 'doc-708',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => signWrap.style.display === ''))

  bridge.dispatchWindow('focus')

  assert.ok(await waitFor(() => listRequests === 2 && panel.style.display === 'none'))
  assert.equal(panel.getAttribute('aria-hidden'), 'true')
  assert.equal(signWrap.style.display, 'none')
  assert.match(String(bridge.consoleErrors.at(-1)[0]), /focus projection refresh failed/)
})

test('View Contract fails closed when the canonical refresh transiently fails', async () => {
  const contract = el('a', { href: '#contract' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'View Contract'
  const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects' },
    [card],
  )
  const requests = []
  let listCount = 0
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        listCount += 1
        if (listCount > 1) throw new Error('Temporary project list failure')
        return response({
          items: [{
            id: 675,
            sync_origin: 'v3',
            contract_source: 'standard',
            lifecycle_state: 'contract_sent',
            pandadoc_document_id: 'doc-675',
            contract_status: 'sent',
          }],
        })
      }
      if (url.includes('/contracts/link/v3')) {
        requests.push(url)
        return response({ url: 'https://app.pandadoc.com/s/sent-contract' })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  const contractWindow = { closed: false, location: {}, opener: bridge.window }
  bridge.window.open = () => contractWindow
  assert.ok(await waitFor(() => listCount === 1))

  bridge.dispatchDocument('click', clickEvent(contract).event)

  assert.ok(await waitFor(() => wrap.getAttribute('data-project-action-result') === 'error'))
  assert.equal(listCount, 2)
  assert.deepEqual(requests, [])
  assert.deepEqual(contractWindow.location, {})
  assert.equal(contractWindow.opener, bridge.window)
  assert.equal(label.textContent, 'Contract is unavailable. Please try again.')
})

test('View Contract closes its blank popup and reports a safe error when Xano returns no URL', async () => {
  const contract = el('a', { href: '#contract' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'View Contract'
  const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
  let linkRequests = 0
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            sync_origin: 'v3',
            contract_source: 'standard',
            lifecycle_state: 'contract_sent',
            pandadoc_document_id: 'doc-675',
            contract_status: 'sent',
          }],
        })
      }
      if (url.includes('/contracts/link/v3')) {
        linkRequests += 1
        return response({})
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  const originalHref = bridge.location.href
  const contractWindow = {
    closed: false,
    close() { this.closed = true },
    location: {},
    opener: bridge.window,
  }
  bridge.window.open = () => contractWindow
  assert.ok(await waitFor(() => wrap.style.display === ''))

  bridge.dispatchDocument('click', clickEvent(contract).event)

  assert.ok(await waitFor(() => linkRequests === 1 && contractWindow.closed))
  assert.equal(bridge.location.href, originalHref)
  assert.equal(wrap.getAttribute('data-project-action-result'), 'error')
  assert.equal(label.textContent, 'Contract is unavailable. Please try again.')
})

test('View Contract uses the authorized session in the current tab when popups are blocked', async () => {
  const contract = el('a', { href: '#contract' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'View Contract'
  const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])
  const sessionUrl = 'https://app.pandadoc.com/s/popup-blocked-contract'
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        return response({
          items: [{
            id: 675,
            sync_origin: 'v3',
            contract_source: 'standard',
            brand_signed_at: '2026-08-12T01:00:00Z',
            lifecycle_state: 'contract_sent',
            pandadoc_document_id: 'doc-675',
            contract_status: 'viewed',
          }],
        })
      }
      if (url.includes('/contracts/link/v3')) return response({ url: sessionUrl })
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  bridge.window.location = bridge.location
  bridge.window.open = () => null
  assert.ok(await waitFor(() => wrap.style.display === ''))

  bridge.dispatchDocument('click', clickEvent(contract).event)

  assert.ok(await waitFor(() => bridge.location.href === sessionUrl))
  assert.notEqual(wrap.getAttribute('data-project-action-result'), 'error')
})

test('project action context includes every canonical project page', async () => {
  const secondPageEnd = el('button', { 'wf-xano-link': 'project-end' })
  const secondPageLabel = el('div', { class: 'button_main-text' })
  secondPageLabel.textContent = 'End Project'
  const secondPageWrap = el('div', { class: 'button_main-wrap' }, [secondPageEnd, secondPageLabel])
  const secondPageCard = el(
    'div',
    { class: 'project_item', 'data-wf-xano-id': '676' },
    [secondPageWrap],
  )
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects' },
    [secondPageCard],
  )
  const requests = []

  await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        const body = JSON.parse(init.body)
        requests.push(body)
        return body.page === 1
          ? response({
              items: [{ id: 675, lifecycle_state: 'active', lifecycle_version: 1 }],
              itemsTotal: 2,
              curPage: 1,
              nextPage: 2,
            })
          : response({
              items: [{
                id: 676,
                status: 'pending',
                lifecycle_state: 'contract_sent',
                lifecycle_version: 1,
              }],
              itemsTotal: 2,
              curPage: 2,
              nextPage: null,
            })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => requests.length === 2))
  assert.deepEqual(requests, [{ page: 1, per_page: 12 }, { page: 2, per_page: 12 }])
  assert.equal(secondPageEnd.getAttribute('data-project-action'), 'end')
  assert.equal(secondPageLabel.textContent, 'Cancel Project')
})

test('lifecycle actions refresh and require a canonical version before mutation', async () => {
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'End Project'
  const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects' },
    [card],
  )
  const requests = []
  let listCount = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        listCount += 1
        requests.push({ type: 'list' })
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'active',
            lifecycle_version: listCount === 1 ? 1 : listCount === 2 ? 2 : null,
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        requests.push({ type: 'action', body: JSON.parse(init.body) })
        return response({ project: { id: 675, lifecycle_state: 'completion_requested' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  bridge.window.prompt = () => 'COMPLETE'
  assert.ok(await waitFor(() => listCount === 1))

  bridge.dispatchDocument('click', clickEvent(end).event)
  assert.ok(await waitFor(() => requests.some((request) => request.type === 'action')))
  const actionRequest = requests.find((request) => request.type === 'action')
  assert.equal(actionRequest.body.expected_version, 2)
  assert.deepEqual(requests.slice(0, 3).map((request) => request.type), ['list', 'list', 'action'])

  assert.ok(await waitFor(() => listCount === 3))
  bridge.dispatchDocument('click', clickEvent(end).event)
  await new Promise(setImmediate)
  assert.equal(requests.filter((request) => request.type === 'action').length, 1)
})

test('lifecycle success survives a failed projection refresh', async () => {
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'End Project'
  const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
  let listCount = 0
  let actionCount = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        listCount += 1
        if (listCount === 3) return response({ message: 'Refresh unavailable' }, false, 503)
        return response({
          items: [{ id: 675, lifecycle_state: 'active', lifecycle_version: listCount }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionCount += 1
        assert.equal(JSON.parse(init.body).expected_version, 2)
        return response({
          project: { id: 675, lifecycle_state: 'completion_requested', lifecycle_version: 3 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  bridge.window.prompt = () => 'COMPLETE'
  assert.ok(await waitFor(() => listCount === 1))

  bridge.dispatchDocument('click', clickEvent(end).event)

  assert.ok(await waitFor(() => listCount === 3 && bridge.consoleErrors.length > 0))
  assert.equal(actionCount, 1)
  assert.equal(wrap.getAttribute('data-project-action-result'), 'success')
  assert.equal(label.textContent, 'Completion requested')
  assert.match(String(bridge.consoleErrors.at(-1)[0]), /lifecycle projection refresh failed/)
})

test('review success survives a failed projection refresh', async () => {
  const review = el('a', { 'wf-xano-link': 'review_starter', href: '/messages' })
  const reviewLabel = el('div', { class: 'button_main-text' })
  reviewLabel.textContent = 'Review Starter'
  const reviewWrap = el('div', { class: 'button_main-wrap' }, [review, reviewLabel])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [reviewWrap])
  const rating = el('input', { name: 'Call-Rating' })
  rating.value = '5'
  const feedback = el('input', { name: 'Public-Feedback' })
  feedback.value = 'Excellent collaboration.'
  const submit = el('button', { type: 'submit' })
  const form = el('form', {}, [rating, feedback, submit])
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = '[Starter Name]'
  const done = el('div', { class: 'w-form-done' })
  const fail = el('div', { class: 'w-form-fail' })
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form, done, fail])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card, modal])
  let listCount = 0
  let reviewCount = 0
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        listCount += 1
        if (listCount === 2) return response({ message: 'Refresh unavailable' }, false, 503)
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'completed',
            lifecycle_version: 4,
            review_eligible: true,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewCount += 1
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  assert.ok(await waitFor(() => review.getAttribute('data-project-action') === 'review'))
  bridge.dispatchDocument('click', clickEvent(review).event)
  await new Promise(setImmediate)

  bridge.dispatchDocument('submit', {
    target: form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => listCount === 2 && bridge.consoleErrors.length > 0))
  assert.equal(reviewCount, 1)
  assert.equal(form.style.display, 'none')
  assert.equal(done.style.display, 'block')
  assert.notEqual(fail.style.display, 'block')
  assert.match(String(bridge.consoleErrors.at(-1)[0]), /review projection refresh failed/)
})

test('review submission enforces rating and feedback rules and locks duplicate submits', async () => {
  const review = el('a', { 'wf-xano-link': 'review_starter', href: '/messages' })
  const reviewWrap = el('div', { class: 'button_main-wrap' }, [review])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [reviewWrap])
  const rating = el('input', { name: 'Call-Rating' })
  const feedback = el('textarea', { name: 'Public-Feedback' })
  const submit = el('button', { type: 'submit' })
  const form = el('form', {}, [rating, feedback, submit])
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = '[Starter Name]'
  const done = el('div', { class: 'w-form-done' })
  const fail = el('div', { class: 'w-form-fail' })
  const modal = el(
    'dialog',
    { 'data-modal-target': 'rate-starter-call' },
    [starterName, form, done, fail],
  )
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card, modal])
  const pendingReview = deferred()
  const reviewBodies = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'completed',
            lifecycle_version: 4,
            review_eligible: true,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewBodies.push(JSON.parse(init.body))
        await pendingReview.promise
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  assert.ok(await waitFor(() => review.getAttribute('data-project-action') === 'review'))
  bridge.dispatchDocument('click', clickEvent(review).event)
  await new Promise(setImmediate)

  const submitEvent = () => ({
    target: form,
    preventDefault() {},
    stopPropagation() {},
  })

  rating.value = '0'
  feedback.value = 'Valid review feedback.'
  bridge.dispatchDocument('submit', submitEvent())
  assert.match(fail.textContent, /rating from 1 to 5/i)
  assert.equal(reviewBodies.length, 0)

  rating.value = '5'
  feedback.value = 'Too short'
  bridge.dispatchDocument('submit', submitEvent())
  assert.match(fail.textContent, /between 10 and 4,000 characters/i)
  assert.equal(reviewBodies.length, 0)

  feedback.value = 'x'.repeat(4001)
  bridge.dispatchDocument('submit', submitEvent())
  assert.match(fail.textContent, /between 10 and 4,000 characters/i)
  assert.equal(reviewBodies.length, 0)

  feedback.value = 'Excellent canonical project delivery.'
  bridge.dispatchDocument('submit', submitEvent())
  assert.ok(await waitFor(() => reviewBodies.length === 1))
  assert.equal(submit.disabled, true)

  bridge.dispatchDocument('submit', submitEvent())
  await new Promise(setImmediate)
  assert.equal(reviewBodies.length, 1)

  pendingReview.resolve()
  assert.ok(await waitFor(() => done.style.display === 'block'))
  assert.equal(submit.disabled, false)
})

test('review retries reuse their idempotency key until success', async () => {
  const review = el('a', { 'wf-xano-link': 'review_starter', href: '/messages' })
  const reviewLabel = el('div', { class: 'button_main-text' })
  reviewLabel.textContent = 'Review Starter'
  const reviewWrap = el('div', { class: 'button_main-wrap' }, [review, reviewLabel])
  const card = el(
    'div',
    { class: 'project_item', 'data-wf-xano-id': '675' },
    [reviewWrap],
  )
  const rating = el('input', { name: 'Call-Rating' })
  rating.value = '5'
  const feedback = el('input', { name: 'Public-Feedback' })
  feedback.value = 'Excellent collaboration.'
  const submit = el('button', { type: 'submit' })
  const form = el('form', {}, [rating, feedback, submit])
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = '[Starter Name]'
  const done = el('div', { class: 'w-form-done' })
  const fail = el('div', { class: 'w-form-fail' })
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form, done, fail])
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects' },
    [card, modal],
  )
  const reviewBodies = []
  const firstReview = deferred()
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'completed',
            lifecycle_version: 4,
            review_eligible: true,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewBodies.push(JSON.parse(init.body))
        if (reviewBodies.length === 1) {
          await firstReview.promise
          return response({ message: 'Temporary failure' }, false, 503)
        }
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  assert.ok(await waitFor(() => review.getAttribute('data-project-action') === 'review'))
  bridge.dispatchDocument('click', clickEvent(review).event)
  await new Promise(setImmediate)

  const submitEvent = () => ({
    target: form,
    preventDefault() {},
    stopPropagation() {},
  })
  bridge.dispatchDocument('submit', submitEvent())
  assert.ok(await waitFor(() => reviewBodies.length === 1))
  const retryKey = form.dataset.projectReviewKey

  bridge.dispatchWindow('modal-close', { modal })
  assert.equal(form.dataset.projectReviewKey, retryKey)
  firstReview.resolve()
  assert.ok(await waitFor(() => fail.style.display === 'block'))

  bridge.dispatchDocument('click', clickEvent(review).event)
  await new Promise(setImmediate)
  bridge.dispatchDocument('submit', submitEvent())
  assert.ok(await waitFor(() => reviewBodies.length === 2))

  assert.equal(reviewBodies[0].idempotency_key, reviewBodies[1].idempotency_key)
  assert.equal(form.dataset.projectReviewKey, undefined)
})

test('review binds the Lumos-owned modal to the opened project Starter without stale-card leakage', async () => {
  const reviewAction = () => {
    const review = el('a', { 'wf-xano-link': 'review_starter', href: '/messages' })
    const label = el('div', { class: 'button_main-text' })
    label.textContent = 'Review Starter'
    return { review, wrap: el('div', { class: 'button_main-wrap' }, [review, label]) }
  }
  const first = reviewAction()
  const second = reviewAction()
  const missing = reviewAction()
  const firstCard = el('div', { class: 'project_item', 'data-wf-xano-id': '667' }, [first.wrap])
  const secondCard = el('div', { class: 'project_item', 'data-wf-xano-id': '669' }, [second.wrap])
  const missingCard = el('div', { class: 'project_item', 'data-wf-xano-id': '668' }, [missing.wrap])

  const staleName = el('span', { 'starter-name': '' })
  staleName.textContent = '[Starter Name]'
  const staleForm = el('form', {}, [])
  staleForm.reset = () => {}
  const staleModal = el(
    'dialog',
    { 'data-modal-target': 'rate-starter-call' },
    [staleName, staleForm],
  )

  const headline = el('p')
  headline.textContent = '[Starter Name]'
  const rateCopy = el('p')
  rateCopy.textContent = 'Rate your experience with [Starter Name]'
  const rating = el('input', { name: 'Call-Rating' })
  rating.value = '5'
  const feedback = el('textarea', { name: 'Feedback' })
  feedback.value = 'Excellent canonical project delivery.'
  const submit = el('button', { type: 'submit' })
  const form = el('form', {}, [headline, rateCopy, rating, feedback, submit])
  form.reset = () => {}
  const done = el('div', { class: 'w-form-done' })
  const fail = el('div', { class: 'w-form-fail' })
  const activeModal = el(
    'dialog',
    { 'data-modal-target': 'rate-starter-call' },
    [form, done, fail],
  )
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects' },
    [firstCard, secondCard, missingCard, staleModal, activeModal],
  )
  const reviewBodies = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [
            {
              id: 667,
              lifecycle_state: 'completed',
              review_eligible: true,
              has_review: false,
              starter_name: 'JP Test',
            },
            {
              id: 668,
              lifecycle_state: 'completed',
              review_eligible: true,
              has_review: false,
              starter_name: '',
            },
            {
              id: 669,
              lifecycle_state: 'completed',
              review_eligible: true,
              has_review: false,
              starter_name: 'Second Starter',
            },
          ],
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewBodies.push(JSON.parse(init.body))
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  let openCount = 0
  bridge.window.lumos = {
    modal: {
      list: {
        'rate-starter-call': {
          el: activeModal,
          open() {
            openCount += 1
            activeModal.setAttribute('open', '')
          },
        },
      },
    },
  }

  assert.ok(await waitFor(() => first.review.getAttribute('data-project-action') === 'review'))
  bridge.dispatchDocument('click', clickEvent(first.review).event)
  assert.ok(await waitFor(() => openCount === 1))
  assert.equal(staleName.textContent, '[Starter Name]')
  assert.equal(headline.textContent, 'JP Test')
  assert.equal(rateCopy.textContent, 'Rate your experience with JP Test')

  bridge.dispatchDocument('submit', {
    target: form,
    preventDefault() {},
    stopPropagation() {},
  })
  assert.ok(await waitFor(() => reviewBodies.length === 1))
  assert.deepEqual(
    { project_id: reviewBodies[0].project_id, rating: reviewBodies[0].rating, review_text: reviewBodies[0].review_text },
    { project_id: 667, rating: 5, review_text: 'Excellent canonical project delivery.' },
  )

  bridge.dispatchWindow('modal-close', { modal: activeModal })
  assert.equal(headline.textContent, '[Starter Name]')
  assert.equal(rateCopy.textContent, 'Rate your experience with [Starter Name]')

  bridge.dispatchDocument('click', clickEvent(second.review).event)
  assert.ok(await waitFor(() => openCount === 2))
  assert.equal(headline.textContent, 'Second Starter')
  assert.equal(rateCopy.textContent, 'Rate your experience with Second Starter')

  bridge.dispatchWindow('modal-close', { modal: activeModal })
  assert.equal(headline.textContent, '[Starter Name]')
  assert.equal(rateCopy.textContent, 'Rate your experience with [Starter Name]')
  bridge.dispatchDocument('click', clickEvent(missing.review).event)
  await new Promise(setImmediate)
  assert.equal(openCount, 2)
  assert.equal(headline.textContent, '[Starter Name]')
  assert.equal(rateCopy.textContent, 'Rate your experience with [Starter Name]')
})

test('latest review card wins when an older canonical lookup resolves last', async () => {
  const reviewAction = () => {
    const review = el('a', { 'wf-xano-link': 'review_starter', href: '/messages' })
    const label = el('div', { class: 'button_main-text' })
    label.textContent = 'Review Starter'
    return { review, wrap: el('div', { class: 'button_main-wrap' }, [review, label]) }
  }
  const slow = reviewAction()
  const latest = reviewAction()
  const slowCard = el('div', { class: 'project_item', 'data-wf-xano-id': '667' }, [slow.wrap])
  const latestCard = el('div', { class: 'project_item', 'data-wf-xano-id': '669' }, [latest.wrap])
  const headline = el('p')
  headline.textContent = '[Starter Name]'
  const rating = el('input', { name: 'Call-Rating' })
  rating.value = '5'
  const feedback = el('textarea', { name: 'Feedback' })
  feedback.value = 'Excellent canonical project delivery.'
  const submit = el('button', { type: 'submit' })
  const form = el('form', {}, [rating, feedback, submit])
  form.reset = () => {}
  const done = el('div', { class: 'w-form-done' })
  const fail = el('div', { class: 'w-form-fail' })
  const modal = el(
    'dialog',
    { 'data-modal-target': 'rate-starter-call' },
    [headline, form, done, fail],
  )
  const root = el(
    'div',
    { 'wf-xano-instance': 'dash-brand-projects' },
    [slowCard, latestCard, modal],
  )
  const slowLookup = deferred()
  const reviewBodies = []
  let listCount = 0
  let openCount = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        listCount += 1
        if (listCount === 2) return slowLookup.promise
        return response({
          items: [{
            id: 669,
            lifecycle_state: 'completed',
            review_eligible: true,
            has_review: false,
            starter_name: 'Latest Starter',
          }],
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewBodies.push(JSON.parse(init.body))
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  bridge.window.lumos = {
    modal: {
      list: {
        'rate-starter-call': {
          el: modal,
          open() {
            openCount += 1
          },
        },
      },
    },
  }

  assert.ok(await waitFor(() => latest.review.getAttribute('data-project-action') === 'review'))
  bridge.dispatchDocument('click', clickEvent(slow.review).event)
  assert.ok(await waitFor(() => listCount === 2))
  bridge.dispatchDocument('click', clickEvent(latest.review).event)
  assert.ok(await waitFor(() => openCount === 1))
  assert.equal(headline.textContent, 'Latest Starter')

  slowLookup.resolve(response({
    items: [
      {
        id: 667,
        lifecycle_state: 'completed',
        review_eligible: true,
        has_review: false,
        starter_name: 'Slow Starter',
      },
      {
        id: 669,
        lifecycle_state: 'completed',
        review_eligible: true,
        has_review: false,
        starter_name: 'Latest Starter',
      },
    ],
  }))
  await new Promise(setImmediate)
  await new Promise(setImmediate)

  assert.equal(openCount, 1)
  assert.equal(headline.textContent, 'Latest Starter')
  assert.equal(slow.wrap.getAttribute('data-project-action-result'), null)

  bridge.dispatchDocument('submit', {
    target: form,
    preventDefault() {},
    stopPropagation() {},
  })
  assert.ok(await waitFor(() => reviewBodies.length === 1))
  assert.equal(reviewBodies[0].project_id, 669)
})

test('the authored type=button invoice CTA requests the native form submit', async () => {
  const bridge = await loadBridge(async () => response({}))
  const dom = invoiceSubmitDom()

  // The click lands on the overlaid button inside the wrapper, never on the
  // wrapper the selector resolves.
  const { counts, event } = clickEvent(dom.cta)
  bridge.dispatchDocument('click', event)

  assert.equal(dom.submitCount(), 1)
  assert.equal(counts.prevented, 1)
  assert.equal(counts.stopped, 1)

  // The explicit behaviour hook works without any theming attribute.
  const hooked = invoiceSubmitDom({ hook: true })
  bridge.dispatchDocument('click', clickEvent(hooked.cta).event)
  assert.equal(hooked.submitCount(), 1)

  // The hook and the theming attribute may land on different elements of the
  // same button, and the click can land on the label rather than the control.
  const split = invoiceSubmitDom({ hookOnCta: true })
  bridge.dispatchDocument('click', clickEvent(split.ctaText).event)
  assert.equal(split.submitCount(), 1)
})

test('the invoice submit fallback stands down outside its form, modal and disabled state', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { requestInvoiceSubmit } = bridge.window.Opp30

  // No form ancestor: the id is authored on a plain container.
  const notAForm = invoiceSubmitDom({ isForm: false })
  assert.equal(requestInvoiceSubmit(notAForm.cta), false)
  assert.equal(notAForm.submitCount(), 0)

  // A form that is not inside the Generate Invoice dialog.
  const outsideModal = invoiceSubmitDom({ inModal: false })
  assert.equal(requestInvoiceSubmit(outsideModal.cta), false)
  assert.equal(outsideModal.submitCount(), 0)

  // A primary-styled button in some other form is never an invoice submitter.
  const foreign = invoiceSubmitDom()
  foreign.form.setAttribute('id', 'wf-form-Something-Else')
  assert.equal(requestInvoiceSubmit(foreign.cta), false)
  assert.equal(foreign.submitCount(), 0)

  // data-button-style is theming, not behaviour: with a second primary-styled
  // control in the same form the inference is ambiguous and fails closed rather
  // than turning a Cancel-shaped button into an invoice submit.
  const ambiguous = invoiceSubmitDom({ secondPrimary: true })
  assert.equal(requestInvoiceSubmit(ambiguous.cta), false)
  assert.equal(ambiguous.submitCount(), 0)
  // Authoring the hook resolves the ambiguity.
  const ambiguousHooked = invoiceSubmitDom({ hook: true, secondPrimary: true })
  assert.equal(requestInvoiceSubmit(ambiguousHooked.cta), true)
  assert.equal(ambiguousHooked.submitCount(), 1)

  // A real submit control needs no fallback; the native click is left alone.
  const native = invoiceSubmitDom({ nativeSubmit: true })
  assert.equal(requestInvoiceSubmit(native.cta), false)
  assert.equal(native.submitCount(), 0)

  // A visually disabled wrapper never acts, even though this listener runs
  // before the wrapper's own capture gate.
  const gated = invoiceSubmitDom({ disabled: true })
  assert.equal(requestInvoiceSubmit(gated.cta), false)
  assert.equal(gated.submitCount(), 0)

  assert.equal(requestInvoiceSubmit(null), false)
  assert.equal(requestInvoiceSubmit({}), false)
})

test('the Send Invoice control is disabled by attribute while the invoice is in flight', async () => {
  const dom = invoiceSubmitDom()
  const pending = deferred()
  const requests = []
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/create/v3')) return pending.promise
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      querySelector: (selector) =>
        selector === '[data-modal-target="generate-invoice"]' ? dom.modal : null,
    },
  )

  bridge.window.Opp30.prepareInvoiceModal(dom.modal, {
    card: invoiceCard({ title: 'Growth', company: 'Acme Co' }),
    projectId: 675,
    title: 'Growth',
    brand: 'Acme Co',
  })

  const { counts, event } = clickEvent(dom.cta)
  bridge.dispatchDocument('click', event)
  assert.equal(dom.submitCount(), 1)
  assert.equal(counts.prevented, 1)

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  await waitForRequestCount(requests, 2)

  // The design-system control is disabled by attribute on its wrapper, so a
  // second click is refused instead of silently doing nothing.
  assert.equal(dom.wrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(dom.wrap.getAttribute('aria-disabled'), 'true')
  assert.equal(dom.cta.disabled, true)
  assert.equal(bridge.window.Opp30.requestInvoiceSubmit(dom.cta), false)
  assert.equal(dom.submitCount(), 1)

  pending.resolve(response({ invoice_id: 901, status: 'unpaid' }))
  for (let attempt = 0; attempt < 20; attempt += 1) await new Promise(setImmediate)

  assert.equal(dom.wrap.getAttribute('data-button-theme'), 'black')
  assert.equal(dom.wrap.getAttribute('aria-disabled'), null)
  assert.equal(dom.cta.disabled, false)
})

// A project card as either list library renders it: the row id as an attribute,
// the display fields behind wf-algolia-text / wf-xano-bind / data-opp-bind.
function invoiceCard(fields, id = '675') {
  return {
    getAttribute: (name) => (name === 'data-wf-xano-id' ? id : null),
    querySelector: (selector) => {
      const match = /^\[(?:wf-algolia-text|wf-xano-bind|data-opp-bind)="([\w-]+)"\]$/.exec(selector)
      const field = match && match[1]
      return field && fields[field] != null ? { textContent: fields[field] } : null
    },
  }
}

test('the invoiced amount is rounded to cents and never below the promised $0.01', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { normalizeInvoiceAmount } = bridge.window.Opp30

  // What gets posted is exactly what the success screen shows.
  assert.equal(normalizeInvoiceAmount('25.555'), 25.56)
  assert.equal(bridge.window.Opp30.formatInvoiceAmount(normalizeInvoiceAmount('25.555')), '$25.56')
  assert.equal(normalizeInvoiceAmount('0.01'), 0.01)
  assert.equal(normalizeInvoiceAmount('0.004'), null)
  assert.equal(normalizeInvoiceAmount('0'), null)
  assert.equal(normalizeInvoiceAmount('-5'), null)
  assert.equal(normalizeInvoiceAmount(''), null)
  assert.equal(normalizeInvoiceAmount('abc'), null)
  assert.equal(normalizeInvoiceAmount('1000000'), 1000000)
  assert.equal(normalizeInvoiceAmount('1000000.01'), null)
})

test('invoiceProjectContext prefers a bound brand field over the pipe-split heading', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { invoiceProjectContext } = bridge.window.Opp30

  const bound = invoiceProjectContext(
    invoiceCard({ heading_display: 'Growth | Ops | Acme Co', company: 'Acme Co', title: 'Growth' }),
  )
  assert.equal(bound.projectId, 675)
  assert.equal(bound.title, 'Growth')
  assert.equal(bound.brand, 'Acme Co')

  const heading = invoiceProjectContext(invoiceCard({ heading_display: 'Growth | Ops | Acme Co' }))
  assert.equal(heading.brand, 'Acme Co')

  // The authored V3 project card binds the brand as wf-xano-bind="company_name"
  // and its heading as "#<id> | <brand>", so the bound field must win over the
  // heading split rather than the other way round.
  const authored = invoiceProjectContext(
    invoiceCard({
      heading_display: '#1123 | Stale Heading',
      company_name: 'Northwind Coffee',
      title: 'Growth Marketing Lead',
    }),
  )
  assert.equal(authored.brand, 'Northwind Coffee')
  assert.equal(authored.title, 'Growth Marketing Lead')

  assert.equal(invoiceProjectContext(invoiceCard({}, '0')), null)
  assert.equal(invoiceProjectContext(invoiceCard({}, '-4')), null)
  assert.equal(invoiceProjectContext(null), null)
})

// The Generate Invoice modal's success screen as the authored Webflow component
// renders it: brand/project/amount binds (there is no status hook), and a
// "View in Stripe" design-system button whose visible element is the
// .button_main-wrap div wrapping an invisible a.clickable_link overlay that
// carries the "#invoice-payment-link" placeholder href.
function invoiceModalFixture() {
  const wrap = { style: {} }
  // Attribute-backed like the real anchor: rewriting .href rewrites the
  // attribute, so an [href="#invoice-payment-link"] selector stops matching.
  const linkAttributes = new Map([['href', '#invoice-payment-link']])
  const link = {
    style: {},
    closest: (selector) => (selector === '.button_main-wrap' ? wrap : null),
    getAttribute: (name) => (linkAttributes.has(name) ? linkAttributes.get(name) : null),
    hasAttribute: (name) => linkAttributes.has(name),
    setAttribute: (name, value) => linkAttributes.set(name, String(value)),
  }
  Object.defineProperty(link, 'href', {
    enumerable: true,
    get: () => linkAttributes.get('href'),
    set: (value) => linkAttributes.set('href', String(value)),
  })
  const binds = {
    brand: { textContent: '' },
    project: { textContent: '' },
    amount: { textContent: '$1,000.00' },
  }
  const form = { dataset: {}, style: {}, reset() {} }
  const done = { style: {} }
  const modal = {
    querySelector: (selector) => {
      if (selector === 'form') return form
      if (selector === '.w-form-done') return done
      if (selector === '[data-wf-invoice="payment-link"]') {
        return link.getAttribute('data-wf-invoice') === 'payment-link' ? link : null
      }
      if (selector === 'a[href="#invoice-payment-link"]') {
        return link.getAttribute('href') === '#invoice-payment-link' ? link : null
      }
      return null
    },
    querySelectorAll: (selector) => {
      const match = /^\[data-wf-invoice-bind="([\w-]+)"\]$/.exec(selector)
      const field = match && match[1]
      return field && binds[field] ? [binds[field]] : []
    },
  }
  return { binds, done, form, link, modal, wrap }
}

test('the success screen shows and hides the Stripe button, not just its overlay anchor', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { paintInvoiceSuccess } = bridge.window.Opp30
  const context = { brand: 'Northwind Coffee', title: 'Growth Marketing Lead' }

  const paid = invoiceModalFixture()
  paintInvoiceSuccess(
    paid.modal,
    { status: 'unpaid', payment_link: 'https://buy.stripe.com/test_link' },
    context,
    2500.5,
  )
  assert.equal(paid.form.style.display, 'none')
  assert.equal(paid.done.style.display, 'block')
  assert.equal(paid.binds.brand.textContent, 'Northwind Coffee')
  assert.equal(paid.binds.project.textContent, 'Growth Marketing Lead')
  assert.equal(paid.binds.amount.textContent, '$2,500.50')
  assert.equal(paid.link.href, 'https://buy.stripe.com/test_link')
  assert.equal(paid.link.target, '_blank')
  assert.equal(paid.link.rel, 'noopener noreferrer')
  assert.equal(paid.wrap.style.display, '')

  // Without a payment_link the styled button itself has to go: hiding only the
  // overlay anchor would leave a visible, dead "View in Stripe" button.
  const unpayable = invoiceModalFixture()
  paintInvoiceSuccess(unpayable.modal, { status: 'unpaid' }, context, 10)
  assert.equal(unpayable.wrap.style.display, 'none')
  assert.equal(unpayable.link.href, '#invoice-payment-link')
})

// A member can bill several projects without reloading, and the first success
// rewrites the anchor's placeholder href — so the pay CTA has to stay findable
// afterwards, or invoice #2 sends them to invoice #1's Stripe link.
test('a second invoice in the same session repaints the Stripe button, never a stale link', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { paintInvoiceSuccess, prepareInvoiceModal } = bridge.window.Opp30
  const first = { brand: 'Northwind Coffee', title: 'Growth Marketing Lead' }
  const second = { brand: 'Halcyon Labs', title: 'Lifecycle Email Revamp' }
  const fixture = invoiceModalFixture()

  prepareInvoiceModal(fixture.modal, first)
  paintInvoiceSuccess(
    fixture.modal,
    { status: 'unpaid', payment_link: 'https://buy.stripe.com/project-675' },
    first,
    250,
  )
  assert.equal(fixture.link.href, 'https://buy.stripe.com/project-675')

  prepareInvoiceModal(fixture.modal, second)
  assert.equal(fixture.wrap.style.display, '')
  paintInvoiceSuccess(
    fixture.modal,
    { status: 'unpaid', payment_link: 'https://buy.stripe.com/project-702' },
    second,
    480,
  )
  assert.equal(fixture.binds.brand.textContent, 'Halcyon Labs')
  assert.equal(fixture.link.href, 'https://buy.stripe.com/project-702')
  assert.equal(fixture.wrap.style.display, '')

  // An invoice that comes back without a payment_link must hide the button
  // rather than leave the previous invoice's live link behind it.
  prepareInvoiceModal(fixture.modal, second)
  assert.equal(fixture.link.href, '#invoice-payment-link')
  paintInvoiceSuccess(fixture.modal, { status: 'unpaid' }, second, 90)
  assert.equal(fixture.wrap.style.display, 'none')
  assert.equal(fixture.link.href, '#invoice-payment-link')
})

test('openInvoiceModal opens through modal.js and only falls back to showModal', async () => {
  let live = false
  let showModalCalls = 0
  const opens = []
  const modal = {
    open: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    showModal() {
      showModalCalls += 1
    },
  }
  const bridge = await loadBridge(async () => response({}), {
    querySelector: (selector) =>
      live && selector === '[data-modal-target="generate-invoice"]' ? modal : null,
  })
  live = true
  const card = invoiceCard({ title: 'Growth', company: 'Acme Co' })

  bridge.window.lumos = {
    modal: { list: { 'generate-invoice': { open: () => opens.push('modal.js'), el: modal } } },
  }
  assert.equal(bridge.window.Opp30.openInvoiceModal(card), true)
  assert.deepEqual(opens, ['modal.js'])
  assert.equal(showModalCalls, 0)

  bridge.window.lumos = undefined
  assert.equal(bridge.window.Opp30.openInvoiceModal(card), true)
  assert.equal(showModalCalls, 1)
})

test('redirectForeignBrandToFeed redirects only on ownership-denied statuses', async () => {
  const denied404 = await loadBridge(async () => response({}))
  assert.equal(denied404.window.Opp30.redirectForeignBrandToFeed({ status: 404 }), true)
  assert.equal(denied404.location.href, '/opportunities-brands-view')

  const denied403 = await loadBridge(async () => response({}))
  assert.equal(denied403.window.Opp30.redirectForeignBrandToFeed({ status: 403 }), true)
  assert.equal(denied403.location.href, '/opportunities-brands-view')

  // Transient / server / network errors must NOT bounce the (possibly real) owner.
  const server = await loadBridge(async () => response({}))
  assert.equal(server.window.Opp30.redirectForeignBrandToFeed({ status: 500 }), false)
  assert.equal(server.location.href, 'https://example.test/all-modals')

  const network = await loadBridge(async () => response({}))
  assert.equal(network.window.Opp30.redirectForeignBrandToFeed(new Error('fetch failed')), false)
  assert.equal(network.location.href, 'https://example.test/all-modals')

  const nullish = await loadBridge(async () => response({}))
  assert.equal(nullish.window.Opp30.redirectForeignBrandToFeed(null), false)
  assert.equal(nullish.location.href, 'https://example.test/all-modals')
})

test('both brand detail routes redirect a foreign brand after the owner-scoped probe returns 404', async () => {
  const member = {
    ...paidBrandMember,
    customFields: { 'brands-dashboard-url': '/brand-dashboard' },
  }
  const runRoute = async ({ pathname, search = '' }) => {
    const requests = []
    const dom = mergedFeedDom({})
    const bridge = await loadBridge(
      async (input) => {
        const url = String(input)
        requests.push(url)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
        if (url.includes('/brand/applications/list')) {
          return response({ message: 'Not found' }, false, 404)
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      {
        member,
        pathname,
        querySelector: dom.querySelector,
        querySelectorAll: dom.querySelectorAll,
        search,
      },
    )
    await waitForRequestCount(requests, 2)
    for (let attempt = 0; attempt < 20 && bridge.location.href !== '/opportunities-brands-view'; attempt += 1) {
      await new Promise(setImmediate)
    }
    assert.equal(bridge.location.href, '/opportunities-brands-view')
    assert.match(requests[1], /\/brand\/applications\/list$/)
    if (/^\/opportunities\//.test(pathname)) {
      assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'common')
      assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), 'brand')
    }
  }

  await runRoute({
    pathname: '/opportunities-details---brand-view',
    search: '?opp=456',
  })
  await runRoute({ pathname: '/opportunities/456' })
})

test('brandFreeHome routes to /quiz until the quiz is completed, then /quiz-results', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { Opp30 } = bridge.window
  assert.equal(Opp30.hasCompletedQuiz(freeBrandMember), false)
  assert.equal(Opp30.brandFreeHome(freeBrandMember), '/quiz')
  const done = {
    ...freeBrandMember,
    customFields: { 'starter-quiz': '{"status":"ready"}' },
  }
  assert.equal(Opp30.hasCompletedQuiz(done), true)
  assert.equal(Opp30.brandFreeHome(done), '/quiz-results')
  // Empty custom field is not "completed".
  assert.equal(Opp30.hasCompletedQuiz({ customFields: { 'starter-quiz': '' } }), false)
})

test('routeGuardActive reflects the html[data-route-guard] stamp', async () => {
  const off = await loadBridge(async () => response({}))
  assert.equal(off.window.Opp30.routeGuardActive(), false)

  const on = await loadBridge(async () => response({}), { routeGuard: true })
  assert.equal(on.window.Opp30.routeGuardActive(), true)
})

test('waits for an allowed guard outcome before revealing paid Brand and Talent feeds', async () => {
  for (const [role, resolvedMember] of [
    ['brand', paidBrandMember],
    ['talent', talentMember],
  ]) {
    let memberSnapshot = {
      id: `m-${role}-before-plans-hydrate`,
      customFields: {},
      planConnections: [],
    }
    const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
    const dom = mergedFeedDom(roots)
    const bridge = await loadBridge(async () => response({}), {
      member: () => memberSnapshot,
      pathname: '/opportunities',
      querySelector: dom.querySelector,
      querySelectorAll: dom.querySelectorAll,
      routeGuardScript: true,
    })

    assert.equal(dom.wrappers[role].style.display, undefined)
    memberSnapshot = resolvedMember
    bridge.documentElement.setAttribute('data-route-guard', 'allowed')

    assert.equal(await bridge.window.Opp30.waitForRouteGuardHandoff(), 'allowed')
    assert.ok(
      await waitFor(() => dom.wrappers[role].style.display === ''),
      `${role} wrapper revealed`,
    )
    assert.equal(dom.wrappers[role === 'brand' ? 'talent' : 'brand'].style.display, 'none')
    assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), role)
    assert.ok(Array.isArray(bridge.window.WfXano))
    assert.equal(bridge.window.WfXano.length, 1)
    assert.equal(bridge.window.Opp30.routeGuardActive(), true)
    assert.equal(
      bridge.location.href,
      'https://example.test/opportunities',
      'the guard owns the unresolved-role decision instead of the legacy / fallback',
    )
  }
})

test('guard errors and redirects leave the merged feed hidden without a legacy redirect', async () => {
  for (const terminal of ['error', 'redirecting']) {
    const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
    const dom = mergedFeedDom(roots)
    const bridge = await loadBridge(async () => response({}), {
      member: paidBrandMember,
      pathname: '/opportunities',
      querySelector: dom.querySelector,
      querySelectorAll: dom.querySelectorAll,
      routeGuard: 'checking',
      routeGuardScript: true,
    })

    if (terminal === 'error') {
      bridge.documentElement.setAttribute('data-route-guard-error', 'unmapped-plan')
    } else {
      bridge.documentElement.setAttribute('data-route-guard', 'redirecting')
    }

    assert.equal(await bridge.window.Opp30.waitForRouteGuardHandoff(), 'blocked')
    assert.equal(dom.wrappers.talent.style.display, undefined)
    assert.equal(dom.wrappers.brand.style.display, undefined)
    assert.equal(bridge.window.WfXano, undefined)
    assert.equal(bridge.location.href, 'https://example.test/opportunities')
  }
})

test('with the guard active, gateOrRedirect returns a matching member without a custom-field check or redirect', async () => {
  // Member has NO legacy dashboard custom-fields — legacy path would redirect.
  const bridge = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    routeGuard: true,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, paidBrandMember)
  assert.equal(bridge.location.href, 'https://example.test/all-modals') // unchanged
})

test('with the guard active, gateOrRedirect blocks a wrong-role member without redirecting', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember,
    routeGuard: true,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  assert.equal(bridge.location.href, 'https://example.test/all-modals') // unchanged
})

test('with the guard active, a logged-out visitor returns null and the guard (not opp30) redirects', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: null,
    routeGuard: true,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  assert.equal(bridge.location.href, 'https://example.test/all-modals') // opp30 did NOT redirect
})

test('without the guard, gateOrRedirect keeps the legacy custom-field redirect', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember, // no brands-dashboard-url custom field
    routeGuard: false,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  // freelancer-dashboard-url also absent -> falls back to '/'
  assert.equal(bridge.location.href, '/')
})

test('without the guard, a logged-out visitor is still sent to login by opp30', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: null,
    routeGuard: false,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  assert.equal(bridge.location.href, '/login?next=%2Fall-modals')
})

test('with the guard active, gateByPlan resolves talent/paid-brand and bails on free-brand without redirect', async () => {
  const talent = await loadBridge(async () => response({}), {
    member: talentMember,
    routeGuard: true,
  })
  const talentGate = await talent.window.Opp30.gateByPlan()
  assert.equal(talentGate.member, talentMember)
  assert.equal(talentGate.role, 'talent')
  assert.equal(talent.location.href, 'https://example.test/all-modals')

  const free = await loadBridge(async () => response({}), {
    member: freeBrandMember,
    routeGuard: true,
  })
  assert.equal(await free.window.Opp30.gateByPlan(), null)
  assert.equal(free.location.href, 'https://example.test/all-modals') // guard owns the redirect
})

test('waitForMappedMemberRole retries an authenticated snapshot until plans hydrate', async () => {
  let calls = 0
  const bridge = await loadBridge(async () => response({}), {
    member: () => {
      calls += 1
      return paidBrandMember
    },
  })
  const initialMember = {
    id: 'm-brand-before-plans-hydrate',
    customFields: {},
    planConnections: [],
  }

  const result = await bridge.window.Opp30.waitForMappedMemberRole(
    bridge.window.$memberstackDom,
    initialMember,
  )

  assert.equal(result.member, paidBrandMember)
  assert.equal(result.role, 'brand-paid')
  assert.equal(calls, 1)
})

test('waitForMappedMemberRole does not retry a complete unmapped plan snapshot', async () => {
  let calls = 0
  const bridge = await loadBridge(async () => response({}))
  const initialMember = {
    id: 'm-unmapped',
    customFields: {},
    planConnections: [{ active: true, planId: 'pln_unknown' }],
  }

  const result = await bridge.window.Opp30.waitForMappedMemberRole(
    {
      getCurrentMember: async () => {
        calls += 1
        return { data: paidBrandMember }
      },
    },
    initialMember,
  )

  assert.equal(result.member, initialMember)
  assert.equal(result.role, null)
  assert.equal(calls, 0)
})

test('waitForMappedMemberRole keeps polling after a transient Memberstack rejection', async () => {
  let calls = 0
  const bridge = await loadBridge(async () => response({}))
  const initialMember = {
    id: 'm-brand-before-plans-hydrate',
    customFields: {},
    planConnections: [],
  }

  const result = await bridge.window.Opp30.waitForMappedMemberRole(
    {
      getCurrentMember: async () => {
        calls += 1
        if (calls === 1) throw new Error('temporary Memberstack failure')
        return { data: paidBrandMember }
      },
    },
    initialMember,
  )

  assert.equal(result.member, paidBrandMember)
  assert.equal(result.role, 'brand-paid')
  assert.equal(calls, 2)
})

test('without the guard, gateByPlan sends an un-completed free brand to /quiz', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: freeBrandMember,
    routeGuard: false,
  })

  assert.equal(await bridge.window.Opp30.gateByPlan(), null)
  assert.equal(bridge.location.href, '/quiz')
})

test('without the guard, gateByPlan sends a completed free brand to /quiz-results', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: { ...freeBrandMember, customFields: { 'starter-quiz': '{"status":"ready"}' } },
    routeGuard: false,
  })

  assert.equal(await bridge.window.Opp30.gateByPlan(), null)
  assert.equal(bridge.location.href, '/quiz-results')
})

test('gateByPlan resolves paid brand under both guard states', async () => {
  const guarded = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    routeGuard: true,
  })
  const guardedGate = await guarded.window.Opp30.gateByPlan()
  assert.equal(guardedGate.member, paidBrandMember)
  assert.equal(guardedGate.role, 'brand-paid')

  const legacy = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    routeGuard: false,
  })
  const legacyGate = await legacy.window.Opp30.gateByPlan()
  assert.equal(legacyGate.member, paidBrandMember)
  assert.equal(legacyGate.role, 'brand-paid')
})

test('scheduling auth is limited to the exact Xano origin and path prefix', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init) => {
      requests.push({ input, init })
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )

  await bridge.fetch('https://attacker.test/api:tCpV3oqd/availability')
  await bridge.fetch('https://x08a-5ko8-jj1r.n7c.xano.io/not-api:tCpV3oqd/availability')

  assert.equal(requests.length, 2)
  assert.equal(requests.some(({ input }) => String(input).includes('trade-token')), false)
  assert.equal(requests.every(({ init }) => !init?.headers), true)
  assert.equal(bridge.window.__tsSchedulingAuthBridgeOwner, 'opportunities-3.0')
  assert.equal(typeof bridge.window.__tsSchedulingAuthOriginalFetch, 'function')
})

test('opportunity calls reuse the shared dashboard Xano token', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init) => {
      requests.push({ input, init })
      return response({ items: [] })
    },
    {
      getXanoAuthToken: async () => 'shared-xano-token',
    },
  )

  await bridge.window.Opp30.API.starterProjectList(1, 12)

  assert.equal(requests.length, 1)
  assert.equal(requests.some(({ input }) => String(input).includes('trade-token')), false)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer shared-xano-token')
})

test('scheduling auth validates the effective Request URL', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init) => {
      requests.push({ input, init })
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const input = {
    url: 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability',
    toString: () => 'https://attacker.test/collect',
  }

  await bridge.fetch(input)

  assert.equal(requests.length, 1)
  assert.equal(requests[0].input, input)
  assert.equal(String(requests[0].input), 'https://attacker.test/collect')
})

test('scheduling auth supports string, URL, and Request inputs', async () => {
  const schedulingRequests = []
  const bridge = await loadBridge(
    async (input) => {
      if (String(input).includes('/auth/trade-token/v3')) {
        return response({ authToken: 'xano-a' })
      }
      schedulingRequests.push(input)
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'

  await bridge.fetch(endpoint)
  await bridge.fetch(new URL(endpoint))
  await bridge.fetch(new Request(endpoint))

  assert.equal(schedulingRequests.length, 3)
  for (const request of schedulingRequests) {
    assert.equal(request.headers.get('Authorization'), 'Bearer xano-a')
  }
})

test('scheduling retry preserves effective Request semantics and body', async () => {
  const schedulingRequests = []
  let tradeCount = 0
  const controller = new AbortController()
  const bridge = await loadBridge(
    async (input) => {
      if (String(input).includes('/auth/trade-token/v3')) {
        tradeCount += 1
        return response({ authToken: `xano-${tradeCount}` })
      }
      schedulingRequests.push(input)
      return response(
        {},
        schedulingRequests.length !== 1,
        schedulingRequests.length === 1 ? 401 : 200,
      )
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'
  const input = new Request(endpoint, {
    body: 'request-body',
    credentials: 'include',
    headers: { 'Content-Type': 'text/plain', 'X-Input': 'discarded' },
    method: 'POST',
    signal: controller.signal,
  })

  const result = await bridge.fetch(input, {
    cache: 'no-store',
    headers: { 'Content-Type': 'text/plain', 'X-Init': 'preserved' },
  })

  assert.equal(result.status, 200)
  assert.equal(tradeCount, 2)
  assert.equal(schedulingRequests.length, 2)
  assert.equal(input.bodyUsed, true)
  for (const [index, request] of schedulingRequests.entries()) {
    assert.equal(request.method, 'POST')
    assert.equal(request.credentials, 'include')
    assert.equal(request.cache, 'no-store')
    assert.equal(request.signal.aborted, false)
    assert.equal(request.headers.get('X-Input'), null)
    assert.equal(request.headers.get('X-Init'), 'preserved')
    assert.equal(request.headers.get('Authorization'), `Bearer xano-${index + 1}`)
    assert.equal(await request.text(), 'request-body')
  }
  controller.abort()
  assert.equal(schedulingRequests.every((request) => request.signal.aborted), true)
})

test('scheduling auth leaves already-authorized requests untouched', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init) => {
      requests.push({ input, init })
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'
  const request = new Request(endpoint, { headers: { Authorization: 'Bearer native' } })

  await bridge.fetch(request)

  assert.equal(requests.length, 1)
  assert.equal(requests[0].input, request)
  assert.equal(requests[0].init, undefined)
})

test('auth switch rejects an in-flight scheduling response', async () => {
  const schedulingResponse = deferred()
  const requests = []
  const bridge = await loadBridge(
    async (input) => {
      requests.push(input)
      if (String(input).includes('/auth/trade-token/v3')) {
        return response({ authToken: 'xano-a' })
      }
      return schedulingResponse.promise
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'

  const request = bridge.fetch(endpoint)
  await waitForRequestCount(requests, 2)
  bridge.authChange({ id: 'member-b' })
  schedulingResponse.resolve(response({ slots: [] }))

  await assert.rejects(request, { code: 'MEMBER_SCOPE_CHANGED' })
})

test('scheduling retry preserves fetch network failures', async () => {
  const networkError = new TypeError('fetch failed')
  let schedulingCount = 0
  let tradeCount = 0
  const bridge = await loadBridge(
    async (input) => {
      if (String(input).includes('/auth/trade-token/v3')) {
        tradeCount += 1
        return response({ authToken: `xano-${tradeCount}` })
      }
      schedulingCount += 1
      if (schedulingCount === 1) return response({}, false, 401)
      throw networkError
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'

  await assert.rejects(bridge.fetch(endpoint), networkError)
  assert.equal(tradeCount, 2)
  assert.equal(schedulingCount, 2)
})

test('auth switch during token acquisition does not retry under the new member', async () => {
  const tokenResponse = deferred()
  const requests = []
  const bridge = await loadBridge(async (url, options) => {
    requests.push({ url, options })
    return tokenResponse.promise
  })
  bridge.authChange({ id: 'member-a' })

  const request = bridge.API.brandOppCreate({ title: 'A request' })
  await waitForRequestCount(requests, 1)

  bridge.authChange({ id: 'member-b' })
  tokenResponse.resolve(response({ authToken: 'xano-a' }))

  await assert.rejects(request, { code: 'MEMBER_SCOPE_CHANGED' })
  assert.equal(requests.length, 1)
})

test('auth switch rejects an in-flight response before it can resolve or track', async () => {
  const apiResponse = deferred()
  const requests = []
  const bridge = await loadBridge(async (url, options) => {
    requests.push({ url, options })
    if (url.includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-a' })
    }
    return apiResponse.promise
  })
  bridge.authChange({ id: 'member-a' })

  const request = bridge.API.brandOppCreate({ title: 'A request' })
  await waitForRequestCount(requests, 2)
  assert.equal(requests[1].options.headers.Authorization, 'Bearer xano-a')

  bridge.authChange({ id: 'member-b' })
  apiResponse.resolve(response({ id: 42 }))

  await assert.rejects(request, { code: 'MEMBER_SCOPE_CHANGED' })
  assert.deepEqual(bridge.trackCalls, [])
  assert.equal(requests.length, 2)
})

// --- Merged /opportunities feed (one page, role wrappers, deferred wf-xano) ---

function roleWrapper(role) {
  return {
    getAttribute: (name) => (name === 'data-opp-role' ? role : null),
    style: {},
  }
}

function deferredRoot(role) {
  return { __role: role }
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (check()) return true
    await new Promise(setImmediate)
  }
  return check()
}

function mergedFeedDom(roots) {
  const wrappers = { talent: roleWrapper('talent'), brand: roleWrapper('brand') }
  const navbarAttributes = new Map([['data-preview-nav', 'common']])
  const navbar = {
    getAttribute: (name) => navbarAttributes.get(name) || null,
    setAttribute: (name, value) => navbarAttributes.set(name, String(value)),
  }
  return {
    navbar,
    wrappers,
    querySelector: (selector) => {
      const match = /^\[data-opp-role="(talent|brand)"\] \[wf-xano-element="wrapper"\]\[wf-xano-defer="true"\]$/.exec(selector)
      if (match) return roots[match[1]] || null
      return null
    },
    querySelectorAll: (selector) => {
      if (selector === '[data-opp-role]') return [wrappers.talent, wrappers.brand]
      if (selector === '[data-preview-nav]') return [navbar]
      return []
    },
  }
}

test('boot routes bare /opportunities to the merged feed: talent wrapper + only the talent feed activates', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  assert.ok(await waitFor(() => dom.wrappers.talent.style.display === ''), 'talent wrapper revealed')
  assert.equal(dom.wrappers.brand.style.display, 'none')
  assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'freelancer')
  // This VM has no CSSOM; the resolved stamp proves the anti-flash selector no longer applies.
  assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), 'talent')
  assert.equal(bridge.documentElement.getAttribute('data-opp30-talent-algolia'), 'wf-xano')

  // wf-xano not loaded yet in this harness: activation queued on the pre-load array.
  assert.ok(Array.isArray(bridge.window.WfXano))
  assert.equal(bridge.window.WfXano.length, 1)
  const inits = []
  bridge.window.WfXano[0]({ init: (root) => inits.push(root) })
  assert.deepEqual(inits, [roots.talent], 'only the talent root is activated')
  assert.equal(bridge.location.href, 'https://example.test/opportunities', 'no redirect')
})

test('merged feed for a paid brand: brand wrapper + only the brand feed activates', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  assert.ok(await waitFor(() => dom.wrappers.brand.style.display === ''), 'brand wrapper revealed')
  assert.equal(dom.wrappers.talent.style.display, 'none')
  assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'brand')
  assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), 'brand')
  assert.equal(bridge.documentElement.getAttribute('data-opp30-talent-algolia'), null)

  assert.ok(Array.isArray(bridge.window.WfXano))
  assert.equal(bridge.window.WfXano.length, 1)
  const inits = []
  bridge.window.WfXano[0]({ init: (root) => inits.push(root) })
  assert.deepEqual(inits, [roots.brand], 'only the brand root is activated')
  assert.equal(bridge.window.__opp30CloseWired, true, 'brand close-opportunity modal wired')
  assert.equal(bridge.window.__opp30CreatePage, true, 'brand create form binder ran')
})

test('merged feed re-applies the Talent navbar role after Webflow restores the authored component value', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  assert.ok(await waitFor(() => dom.navbar.getAttribute('data-preview-nav') === 'freelancer'))
  dom.navbar.setAttribute('data-preview-nav', 'common')
  bridge.notifyMutations([{ type: 'attributes', target: dom.navbar }])
  assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'freelancer')
})

test('merged feed with the guard active bails quietly for a free brand (guard owns the redirect)', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: freeBrandMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  await bridge.window.Opp30.initMergedOppFeed()
  assert.equal(dom.wrappers.talent.style.display, undefined)
  assert.equal(dom.wrappers.brand.style.display, undefined)
  assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), null)
  assert.equal(bridge.window.WfXano, undefined, 'no feed activation queued')
  assert.equal(bridge.location.href, 'https://example.test/opportunities')
})

test('activateDeferredFeed runs immediately when wf-xano is already loaded', async () => {
  const bridge = await loadBridge(async () => response({}), { member: talentMember })
  const inits = []
  bridge.window.WfXano = { init: (root) => inits.push(root) }
  const root = deferredRoot('talent')
  bridge.window.Opp30.activateDeferredFeed(root)
  assert.deepEqual(inits, [root])
})
