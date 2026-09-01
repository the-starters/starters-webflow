const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'opportunities-3.0.js'), 'utf8')
const diagnosticSource = fs.readFileSync(
  path.join(__dirname, 'utils/workflow-diagnostics.js'),
  'utf8',
)

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

function binaryResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    blob: async () => data,
    json: async () => {
      throw new Error('Binary response is not JSON')
    },
  }
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
    getCurrentMemberImpl = null,
    workflowDiagnostics = false,
    autoLoadWorkflowDiagnostics = false,
    workflowDiagnosticsReady = null,
    setTimeoutImpl = setTimeout,
    nowImpl = null,
    promptImpl = () => null,
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
  let context
  const appendedScripts = []
  const documentElement = {
    appendChild(node) {
      if (!node || node.tag !== 'script') return node
      appendedScripts.push(node.src)
      if (autoLoadWorkflowDiagnostics && /\/utils\/workflow-diagnostics\.js$/.test(node.src || '')) {
        vm.runInContext(diagnosticSource, context)
        node.dispatch?.('load')
      }
      return node
    },
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
  }
  const document = {
    visibilityState: 'visible',
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
      const node = el(tag)
      const listeners = new Map()
      node.addEventListener = (type, listener) => listeners.set(type, listener)
      node.dispatch = (type) => listeners.get(type)?.({ type })
      return node
    },
    currentScript: autoLoadWorkflowDiagnostics
      ? { src: 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/opportunities-3.0.js' }
      : null,
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
  const dispatchedEvents = []
  const diagnosticStorage = new Map()
  const copiedDiagnostics = []
  const window = {
    $memberstackDom: {
      getCurrentMember: getCurrentMemberImpl ||
        (async () => ({ data: typeof member === 'function' ? member() : member })),
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
      dispatchedEvents.push(event)
      for (const listener of windowListeners.get(event.type) || []) listener(event)
    },
    removeEventListener(type, listener) {
      const listeners = windowListeners.get(type) || []
      windowListeners.set(type, listeners.filter((candidate) => candidate !== listener))
    },
    setInterval,
    setTimeout: setTimeoutImpl,
    prompt: promptImpl,
  }
  window.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type
      this.detail = options?.detail
    }
  }
  if (workflowDiagnosticsReady) {
    window.__startersWorkflowDiagnosticsReady = workflowDiagnosticsReady
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
  const ContextDate = nowImpl
    ? class extends Date { static now() { return nowImpl() } }
    : Date
  context = vm.createContext({
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type
        this.detail = options?.detail
      }
    },
    Event: class Event {
      constructor(type, options) {
        this.type = type
        this.bubbles = options?.bubbles
      }
    },
    FormData,
    Headers,
    Date: ContextDate,
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
  if (workflowDiagnostics) {
    window.location = location
    window.Date = Date
    window.Math = Math
    window.Uint32Array = Uint32Array
    window.crypto = { randomUUID: () => '12345678-90ab-cdef-1234-567890abcdef' }
    window.sessionStorage = { setItem: (key, value) => diagnosticStorage.set(key, value) }
    window.navigator = { clipboard: { writeText: async (value) => copiedDiagnostics.push(value) } }
    window.console = context.console
    vm.runInContext(diagnosticSource, context)
  }
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
    dispatchedEvents,
    diagnosticStorage,
    copiedDiagnostics,
    appendedScripts,
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

test('project options and canonical Starter submission use authenticated V3 routes', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/projects/options/v3')) {
        return response({ counterparties: [{ counterparty_id: 81, company_name: 'Acme' }] })
      }
      if (url.includes('/projects/submit/v3')) {
        return response({
          project: { id: 669, lifecycle_state: 'contract_create_pending' },
          replayed: false,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember },
  )

  const options = await bridge.API.projectOptions()
  const payload = { brand_id: 81, title: 'Launch project', idempotency_key: 'starter-project-test' }
  const result = await bridge.API.projectSubmit(payload)

  assert.equal(options.counterparties[0].counterparty_id, 81)
  assert.equal(result.project.id, 669)
  assert.equal(result.project.lifecycle_state, 'contract_create_pending')
  assert.equal(requests[1].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/projects/options/v3')
  assert.equal(requests[1].init.method, 'POST')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(requests[1].init.body), {})
  assert.equal(requests[2].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/projects/submit/v3')
  assert.equal(requests[2].init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(requests[2].init.body), payload)
})

test('authenticated Starter profile uses the V3 self-profile route', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/profile/me')) {
        return response({ full_name: 'Starter Person', profile_photo: 'https://example.com/photo.jpg' })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember },
  )

  const profile = await bridge.API.starterProfile()

  assert.equal(profile.full_name, 'Starter Person')
  assert.equal(requests[1].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/starter/profile/me')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(requests[1].init.body), {})
})

test('superseded proposal controller retains its authenticated decision route', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/projects/proposal-action/v3')) {
        return response({ proposal: { id: 72, status: 'accepted' }, project: { id: 669 } })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember },
  )
  const decision = {
    proposal_id: 72,
    expected_version: 1,
    action: 'accept',
    idempotency_key: 'proposal-action-test',
  }

  const accepted = await bridge.API.projectProposalAction(decision)

  assert.equal(accepted.project.id, 669)
  assert.equal(requests[1].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/projects/proposal-action/v3')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(requests[1].init.body), decision)
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

test('invoiceCancel sends the authenticated cancellation contract to Xano', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/cancel/v3')) {
        return response({ invoice_id: 901, status: 'void', replayed: false })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember },
  )
  const payload = {
    invoice_id: 901,
    expected_status: 'unpaid',
    idempotency_key: 'invoice-cancel-ui:901:test',
    dry_run: false,
  }

  const result = await bridge.API.invoiceCancel(payload)

  assert.equal(result.status, 'void')
  assert.match(requests[1].url, /\/invoices\/cancel\/v3$/)
  assert.equal(requests[1].init.method, 'POST')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(requests[1].init.body), payload)
})

test('mutation diagnostics retain only safe invoice lifecycle fields', async () => {
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/create/v3')) {
        return response({
          invoice_id: 901,
          payment_link: 'https://private.example/payment/customer-value',
          status: 'unpaid',
          customer_email: 'private@example.com',
        }, true, 201)
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember, workflowDiagnostics: true },
  )

  await bridge.API.invoiceCreate({
    project_id: 709,
    amount: 500,
    description: 'Private project description',
    idempotency_key: 'private-retry-key',
  })

  const receipt = bridge.window.__startersWorkflowDiagnosticLast
  assert.equal(receipt.workflow, 'generate_invoice')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.http_status, 201)
  assert.equal(receipt.resource_type, 'invoice')
  assert.equal(receipt.resource_id, '')
  assert.equal(receipt.replayed, false)
  const serialized = JSON.stringify(receipt)
  assert.doesNotMatch(serialized, /private@example\.com/)
  assert.doesNotMatch(serialized, /Private project description/)
  assert.doesNotMatch(serialized, /private-retry-key/)
  assert.doesNotMatch(serialized, /customer-value/)
})

test('failed mutation exposes a safe diagnostic on the thrown error', async () => {
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/opportunities/create')) {
        return response({ message: 'Rejected private@example.com opportunity' }, false, 422)
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember, workflowDiagnostics: true },
  )

  await assert.rejects(
    bridge.API.brandOppCreate({ title: 'Private launch plan' }),
    (error) => {
      assert.equal(error.workflowDiagnostic.workflow, 'opportunity_create')
      assert.equal(error.workflowDiagnostic.result, 'failed')
      assert.equal(error.workflowDiagnostic.error_code, 'HTTP_ERROR')
      assert.equal(error.workflowDiagnostic.http_status, 422)
      assert.equal(error.workflowDiagnostic.request_started, true)
      assert.doesNotMatch(JSON.stringify(error.workflowDiagnostic), /private@example\.com|Private launch plan/)
      return true
    },
  )
  assert.equal(
    bridge.dispatchedEvents.some(
      (event) => event.type === 'starters:opportunity-created',
    ),
    false,
  )
})

test('a successful opportunity create emits the Brand action completion event', async () => {
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) {
        return response({ authToken: 'xano-token' })
      }
      if (url.includes('/brand/opportunities/create')) {
        return response({ id: 712 }, true, 201)
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember },
  )

  await bridge.API.brandOppCreate({ title: 'First opportunity' })

  const created = bridge.dispatchedEvents.filter(
    (event) => event.type === 'starters:opportunity-created',
  )
  assert.equal(created.length, 1)
  assert.equal(created[0].detail.opportunityId, 712)
})

test('loads the matching-version diagnostic helper before an opportunity mutation', async () => {
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/opportunities/create')) return response({ id: 710 }, true, 201)
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: paidBrandMember, autoLoadWorkflowDiagnostics: true },
  )

  await bridge.API.brandOppCreate({ title: 'Private launch plan' })

  assert.deepEqual(bridge.appendedScripts, [
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/utils/workflow-diagnostics.js',
  ])
  assert.equal(bridge.window.__startersWorkflowDiagnosticLast.workflow, 'opportunity_create')
  assert.equal(bridge.window.__startersWorkflowDiagnosticLast.result, 'success')
})

test('a stalled shared diagnostics loader fails open before an opportunity mutation', async () => {
  const calls = []
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/opportunities/create')) return response({ id: 711 }, true, 201)
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      workflowDiagnosticsReady: new Promise(() => {}),
      setTimeoutImpl: (callback, ms) => ms === 2000 ? setImmediate(callback) : setTimeout(callback, ms),
    },
  )

  await bridge.API.brandOppCreate({ title: 'Bounded diagnostics' })

  assert.equal(calls.some((url) => url.includes('/brand/opportunities/create')), true)
})

test('opportunity failures keep diagnostics out of the authored native failure state', async () => {
  const message = el('p')
  message.textContent = 'Something went wrong.'
  const listeners = new Map()
  message.addEventListener = (type, listener) => listeners.set(type, listener)
  const fail = el('div', { class: 'w-form-fail' }, [message])
  const button = el('button', { 'data-opp-submit': 'apply' })
  button.addEventListener = () => {}
  const modal = el('div', { 'data-modal-target': 'apply-opportunity' }, [fail, button])
  const bridge = await loadBridge(async () => response({}), {
    workflowDiagnostics: true,
    querySelector: (selector) => selectorMatches(modal, selector) ? modal : modal.querySelector(selector),
    querySelectorAll: (selector) => [modal, ...descendants(modal)].filter((node) => selectorMatches(node, selector)),
  })
  const receipt = bridge.window.StartersWorkflowDiagnostics.record(
    bridge.window.StartersWorkflowDiagnostics.create({
      workflow: 'opportunity_application',
      result: 'failed',
      stage: 'response',
      error_code: 'HTTP_ERROR',
    }),
  )

  assert.equal(bridge.window.Opp30.showOpportunityError(button, 'Request failed.', receipt), true)
  assert.equal(fail.style.display, 'block')
  assert.equal(message.textContent, 'Something went wrong.')
  assert.equal(message.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.equal(listeners.has('click'), false)
  assert.equal(bridge.copiedDiagnostics.length, 0)
})

test('withdraw success keeps diagnostics out of the visible authored confirmation state', async () => {
  const message = el('p')
  message.textContent = 'Your application was withdrawn.'
  const listeners = new Map()
  message.addEventListener = (type, listener) => listeners.set(type, listener)
  const step = el('div', { 'data-form-flow-step': '', 'aria-hidden': 'false' }, [message])
  const modal = el('div', { 'data-modal-target': 'cancel-application' }, [step])
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/applications/cancel')) return response({ application_id: 711 })
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      workflowDiagnostics: true,
      querySelector: (selector) => selectorMatches(modal, selector) ? modal : modal.querySelector(selector),
      querySelectorAll: (selector) => [modal, ...descendants(modal)].filter((node) => selectorMatches(node, selector)),
    },
  )
  const result = await bridge.API.starterAppCancel(711)

  bridge.window.Opp30.showCancelSuccess(result)

  assert.equal(message.textContent, 'Your application was withdrawn.')
  assert.equal(message.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.equal(listeners.has('click'), false)
  assert.equal(bridge.copiedDiagnostics.length, 0)
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
        return response({ project: { id: 675, lifecycle_state: 'completed' } })
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

test('Starter invoice cancellation requires exact CANCEL and refreshes the canonical row', async () => {
  const action = el('button', { 'data-project-invoice-action': 'cancel' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'Cancel Invoice'
  const wrap = el('div', { class: 'button_main-wrap' }, [action, label])
  const row = el('div', { 'data-wf-xano-nest-clone': '' }, [wrap])
  const invoices = el(
    'div',
    { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'invoices' },
    [row],
  )
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [invoices])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])
  const handlers = new Set()
  let state = {
    status: 'success',
    data: {
      items: [{
        id: 746,
        lifecycle_state: 'active',
        invoices: [{ id: 901, status: 'unpaid', cancel_eligible: true }],
      }],
    },
    query: { page: 1, perPage: 12 },
  }
  let refreshCount = 0
  const instance = {
    getState: () => state,
    refresh() {
      refreshCount += 1
      state = {
        ...state,
        data: {
          items: [{
            id: 746,
            lifecycle_state: 'active',
            invoices: [{ id: 901, status: 'void', cancel_eligible: false }],
          }],
        },
      }
      handlers.forEach((handler) => handler(state))
      return Promise.resolve(state)
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const prompts = ['cancel', 'CANCEL']
  const cancelBodies = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/cancel/v3')) {
        cancelBodies.push(JSON.parse(init.body))
        return response({ invoice_id: 901, status: 'void', replayed: false })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      promptImpl: () => prompts.shift(),
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: { get: (key) => key === 'dash-projects' ? instance : null },
    },
  )

  assert.ok(await waitFor(() => action.getAttribute('data-project-invoice-id') === '901'))
  assert.equal(wrap.style.display, '')

  bridge.dispatchDocument('click', clickEvent(action).event)
  await new Promise(setImmediate)
  assert.equal(cancelBodies.length, 0)

  bridge.dispatchDocument('click', clickEvent(action).event)
  assert.ok(await waitFor(() => cancelBodies.length === 1))
  assert.equal(cancelBodies[0].invoice_id, 901)
  assert.equal(cancelBodies[0].expected_status, 'unpaid')
  assert.equal(cancelBodies[0].dry_run, false)
  assert.match(cancelBodies[0].idempotency_key, /^invoice-cancel-ui:901:/)
  assert.ok(await waitFor(() => refreshCount === 1))
  assert.ok(await waitFor(() => wrap.style.display === 'none'))
})

test('dashboard invoice rows show Cancelled and remove payable actions for canonical void invoices', async () => {
  const voidLabel = el('div', { class: 'label_text' })
  let voidLabelText = 'Incomplete'
  let voidLabelWrites = 0
  Object.defineProperty(voidLabel, 'textContent', {
    get: () => voidLabelText,
    set: (value) => {
      voidLabelText = value
      voidLabelWrites += 1
    },
  })
  const voidBadge = el('div', { 'wf-xano-if': "status === 'void'" }, [voidLabel])
  const voidView = productButtonWrapFixture({
    buttonTag: 'a',
    buttonAttrs: { href: '#payment_link', 'wf-xano-link': 'payment_link' },
    label: 'View Invoice',
  })
  const voidRow = el('div', { 'data-wf-xano-nest-clone': '' }, [voidBadge, voidView.wrap])

  const unpaidView = productButtonWrapFixture({
    buttonTag: 'a',
    buttonAttrs: {
      href: 'https://buy.stripe.com/test-link',
      'wf-xano-link': 'payment_link',
    },
    label: 'View Invoice',
  })
  const unpaidRow = el('div', { 'data-wf-xano-nest-clone': '' }, [unpaidView.wrap])
  const invoices = el(
    'div',
    { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'invoices' },
    [voidRow, unpaidRow],
  )
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [invoices])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
  const state = {
    status: 'success',
    data: {
      items: [{
        id: 746,
        lifecycle_state: 'active',
        invoices: [
          {
            id: 901,
            status: 'void',
            status_display: 'Cancelled',
            payment_link: null,
            invoice_link: null,
            cancel_eligible: false,
          },
          {
            id: 902,
            status: 'unpaid',
            status_display: 'Unpaid',
            payment_link: 'https://buy.stripe.com/test-link',
            cancel_eligible: false,
          },
        ],
      }],
    },
    query: { page: 1, perPage: 12 },
  }
  const instance = {
    getState: () => state,
    refresh: () => Promise.resolve(state),
    subscribe(handler) {
      handler(state)
      return () => {}
    },
  }

  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
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
      wfXano: { get: (key) => key === 'dash-brand-projects' ? instance : null },
    },
  )

  assert.ok(await waitFor(() => voidLabel.textContent === 'Cancelled'))
  assert.equal(voidRow.getAttribute('data-project-invoice-id'), '901')
  assert.equal(voidRow.getAttribute('data-project-invoice-status'), 'void')
  assert.equal(voidView.button.getAttribute('href'), null)
  assert.equal(voidView.wrap.style.display, 'none')
  assert.equal(voidView.wrap.getAttribute('aria-hidden'), 'true')

  assert.equal(unpaidRow.getAttribute('data-project-invoice-id'), '902')
  assert.equal(unpaidRow.getAttribute('data-project-invoice-status'), 'unpaid')
  assert.equal(unpaidView.wrap.style.display, '')
  assert.equal(unpaidView.button.getAttribute('href'), 'https://buy.stripe.com/test-link')
  assert.equal(unpaidView.button.getAttribute('target'), '_blank')
  assert.equal(unpaidView.button.getAttribute('rel'), 'noopener noreferrer')

  assert.equal(voidLabelWrites, 1)
  bridge.notifyMutations()
  await new Promise(setImmediate)
  assert.equal(voidLabelWrites, 1)

  if (process.env.INVOICE_VOID_ROW_EVIDENCE === '1') {
    console.log(JSON.stringify({
      surface: 'Brand dashboard invoice rows',
      void_invoice: {
        id: voidRow.getAttribute('data-project-invoice-id'),
        canonical_status: voidRow.getAttribute('data-project-invoice-status'),
        visible_label: voidLabel.textContent,
        view_invoice_href: voidView.button.getAttribute('href'),
        view_invoice_visible: voidView.wrap.style.display !== 'none',
      },
      unpaid_invoice: {
        id: unpaidRow.getAttribute('data-project-invoice-id'),
        canonical_status: unpaidRow.getAttribute('data-project-invoice-status'),
        view_invoice_href: unpaidView.button.getAttribute('href'),
        opens_in_new_tab: unpaidView.button.getAttribute('target') === '_blank',
      },
    }))
  }
})

test('Starter invoice cancellation resolves a lazy row that hydrated after initial decoration', async () => {
  const initialAction = el('button', { 'data-project-invoice-action': 'cancel' })
  const initialWrap = el('div', { class: 'button_main-wrap' }, [initialAction])
  const initialRow = el('div', { 'data-wf-xano-nest-clone': '' }, [initialWrap])
  const invoices = el(
    'div',
    { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'invoices' },
    [initialRow],
  )
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [invoices])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])
  const state = {
    status: 'success',
    data: {
      items: [{
        id: 746,
        lifecycle_state: 'active',
        invoices: [
          { id: 900, status: 'unpaid', cancel_eligible: true },
          { id: 901, status: 'unpaid', cancel_eligible: true },
        ],
      }],
    },
    query: { page: 1, perPage: 12 },
  }
  const instance = {
    getState: () => state,
    refresh: () => Promise.resolve(state),
    subscribe(handler) {
      handler(state)
      return () => {}
    },
  }
  const cancelBodies = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/cancel/v3')) {
        cancelBodies.push(JSON.parse(init.body))
        return response({ invoice_id: 901, status: 'void', replayed: false })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      promptImpl: () => 'CANCEL',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: { get: (key) => key === 'dash-projects' ? instance : null },
    },
  )

  const action = el('button', { 'data-project-invoice-action': 'cancel' })
  const wrap = el('div', { class: 'button_main-wrap' }, [action])
  const row = el('div', { 'data-wf-xano-nest-clone': '' }, [wrap])
  assert.ok(await waitFor(() => initialAction.getAttribute('data-project-invoice-id') === '900'))
  invoices.appendChild(row)

  assert.equal(action.getAttribute('data-project-invoice-id'), null)
  bridge.dispatchDocument('click', clickEvent(action).event)

  assert.ok(await waitFor(() => cancelBodies.length === 1))
  assert.equal(action.getAttribute('data-project-invoice-id'), '901')
  assert.equal(cancelBodies[0].invoice_id, 901)
})

test('Starter invoice cancellation ignores stale DOM identity and canonical ineligibility', async () => {
  const action = el('button', { 'data-project-invoice-action': 'cancel' })
  const wrap = el('div', { class: 'button_main-wrap' }, [action])
  const row = el('div', { 'data-wf-xano-nest-clone': '' }, [wrap])
  const invoices = el(
    'div',
    { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'invoices' },
    [row],
  )
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [invoices])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])
  const handlers = new Set()
  let state = {
    status: 'success',
    data: {
      items: [{
        id: 746,
        lifecycle_state: 'active',
        invoices: [{ id: 901, status: 'unpaid', cancel_eligible: true }],
      }],
    },
    query: { page: 1, perPage: 12 },
  }
  const setInvoice = (invoice) => {
    state = {
      ...state,
      data: { items: [{ id: 746, lifecycle_state: 'active', invoices: [invoice] }] },
    }
    handlers.forEach((handler) => handler(state))
  }
  const instance = {
    getState: () => state,
    refresh: () => Promise.resolve(state),
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const cancelBodies = []
  let promptCount = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/cancel/v3')) {
        cancelBodies.push(JSON.parse(init.body))
        return response({ invoice_id: 902, status: 'void', replayed: false })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      promptImpl: () => {
        promptCount += 1
        return 'CANCEL'
      },
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: { get: (key) => key === 'dash-projects' ? instance : null },
    },
  )

  assert.ok(await waitFor(() => action.getAttribute('data-project-invoice-id') === '901'))
  setInvoice({ id: 902, status: 'unpaid', cancel_eligible: true })
  action.setAttribute('data-project-invoice-id', '901')
  bridge.dispatchDocument('click', clickEvent(action).event)

  assert.ok(await waitFor(() => cancelBodies.length === 1))
  assert.equal(cancelBodies[0].invoice_id, 902)
  assert.equal(promptCount, 1)

  setInvoice({ id: 903, status: 'void', cancel_eligible: false })
  action.setAttribute('data-project-invoice-id', '902')
  wrap.style.display = ''
  bridge.dispatchDocument('click', clickEvent(action).event)
  await new Promise(setImmediate)

  assert.equal(cancelBodies.length, 1)
  assert.equal(promptCount, 1)
})

test('reused invoice rows create a new cancellation key for the new invoice', async () => {
  const action = el('button', { 'data-project-invoice-action': 'cancel' })
  const wrap = el('div', { class: 'button_main-wrap' }, [action])
  const row = el('div', { 'data-wf-xano-nest-clone': '' }, [wrap])
  const invoices = el(
    'div',
    { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'invoices' },
    [row],
  )
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [invoices])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])
  const handlers = new Set()
  let state = {
    status: 'success',
    data: {
      items: [{
        id: 746,
        lifecycle_state: 'active',
        invoices: [{ id: 901, status: 'unpaid', cancel_eligible: true }],
      }],
    },
    query: { page: 1, perPage: 12 },
  }
  const instance = {
    getState: () => state,
    refresh() {
      state = {
        ...state,
        data: {
          items: [{
            id: 746,
            lifecycle_state: 'active',
            invoices: [{ id: 902, status: 'unpaid', cancel_eligible: true }],
          }],
        },
      }
      handlers.forEach((handler) => handler(state))
      return Promise.resolve(state)
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  const cancelBodies = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/cancel/v3')) {
        const body = JSON.parse(init.body)
        cancelBodies.push(body)
        return response({ invoice_id: body.invoice_id, status: 'void', replayed: false })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      promptImpl: () => 'CANCEL',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: { get: (key) => key === 'dash-projects' ? instance : null },
    },
  )

  assert.ok(await waitFor(() => action.getAttribute('data-project-invoice-id') === '901'))
  bridge.dispatchDocument('click', clickEvent(action).event)
  assert.ok(await waitFor(() => cancelBodies.length === 1))
  assert.ok(await waitFor(() => action.getAttribute('data-project-invoice-id') === '902'))

  bridge.dispatchDocument('click', clickEvent(action).event)
  assert.ok(await waitFor(() => cancelBodies.length === 2))

  assert.match(cancelBodies[0].idempotency_key, /^invoice-cancel-ui:901:/)
  assert.match(cancelBodies[1].idempotency_key, /^invoice-cancel-ui:902:/)
  assert.notEqual(cancelBodies[1].idempotency_key, cancelBodies[0].idempotency_key)
})

test('Brand dashboard always hides the shared Cancel Invoice control', async () => {
  const action = el('button', { 'data-project-invoice-action': 'cancel' })
  const wrap = el('div', { class: 'button_main-wrap' }, [action])
  const row = el('div', { 'data-wf-xano-nest-clone': '' }, [wrap])
  const invoices = el(
    'div',
    { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'invoices' },
    [row],
  )
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [invoices])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])

  await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 746,
            lifecycle_state: 'active',
            invoices: [{ id: 901, status: 'unpaid', cancel_eligible: true }],
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

  assert.ok(await waitFor(() => action.getAttribute('data-project-invoice-id') === '901'))
  assert.equal(wrap.style.display, 'none')
})

test('Brand dashboard hides Cancel Invoice while authorization is unresolved', async () => {
  const action = el('button', { 'data-project-invoice-action': 'cancel' })
  const wrap = el('div', { class: 'button_main-wrap' }, [action])
  const row = el('div', { 'data-wf-xano-nest-clone': '' }, [wrap])
  const invoices = el(
    'div',
    { 'wf-xano-element': 'nest-target', 'wf-xano-field': 'invoices' },
    [row],
  )
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [invoices])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
  const currentMember = deferred()

  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 746,
            lifecycle_state: 'active',
            invoices: [{ id: 901, status: 'unpaid', cancel_eligible: true }],
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      pathname: '/brand-dashboard',
      getCurrentMemberImpl: () => currentMember.promise,
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.equal(wrap.style.display, 'none')

  currentMember.resolve({ data: paidBrandMember })
  assert.ok(await waitFor(() => action.getAttribute('data-project-invoice-id') === '901'))
  assert.equal(wrap.style.display, 'none')
  assert.equal(bridge.consoleErrors.length, 0)
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
        return response({ project: { id: 675, lifecycle_state: 'completed' } })
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
          project: { id: 675, lifecycle_state: 'completed', lifecycle_version: 3 },
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
  assert.equal(opened, 1)
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
          project: { id: 675, lifecycle_state: 'completed', lifecycle_version: 3 },
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
  assert.equal(label.textContent, 'Project completed')
  assert.match(String(bridge.consoleErrors.at(-1)[0]), /lifecycle projection refresh failed/)

  bridge.notifyMutations([{ type: 'childList', target: label }])
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(label.textContent, 'Project completed')
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
          project: { id: 675, lifecycle_state: 'completed', lifecycle_version: 3 },
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
    return feedback && feedback.textContent === 'Project completed'
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
  assert.equal(bridge.documentListenerCount('submit'), 2)

  bridge.authChange(paidBrandMember)
  assert.equal(bridge.window.__opp30InvoicesWired, undefined)
  assert.equal(bridge.documentListenerCount('submit'), 0)

  bridge.authChange(secondTalentMember)
  assert.equal(bridge.window.__opp30InvoicesWired, true)
  assert.equal(bridge.documentListenerCount('submit'), 2)

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
  const node = {
    tag,
    attributes,
    children,
    parent: null,
    dataset: {},
    hidden: attributes.has('hidden'),
    style: {},
  }
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
  if (tag === 'input' && attributes.has('checked')) node.checked = true
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
  // Honor :checked only on radios/checkboxes. Review fixtures use the same
  // selector on a text input (Call-Rating); those still match as before.
  if (/:checked\b/.test(simple) && 'checked' in node && !node.checked) return false
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

function buttonWrapFixture({
  buttonAttrs = { type: 'submit' },
  buttonTag = 'button',
  spinnerDisplay = 'flex',
  wrapAttrs = {},
} = {}) {
  const spinner = el('div', { 'data-button-spinner': '' })
  spinner.style.display = spinnerDisplay
  const button = el(buttonTag, buttonAttrs)
  const wrap = el('div', wrapAttrs, [button, spinner])
  return { wrap, button, spinner }
}

// Live Webflow Button Wrap: empty overlay submit, visible text/line, Spinner
// nested under .button_main-element — not a sibling of the native control.
function productButtonWrapFixture({
  buttonAttrs = { type: 'submit' },
  spinnerDisplay = 'none',
  wrapAttrs = {
    class: 'button_main-wrap',
    'data-button-theme': 'black',
    'data-button-style': 'primary',
  },
  label = 'Submit',
} = {}) {
  const spinner = el('div', {
    'data-button-spinner': '',
    class: 'w-layout-vflex button_icon-spinner',
  })
  spinner.style.display = spinnerDisplay
  const text = el('div', { class: 'button_main-text' })
  text.textContent = label
  const line = el('div', { class: 'button_main-line' })
  const element = el('div', { class: 'button_main-element' }, [text, line, spinner])
  const button = el('button', { class: 'clickable_btn', ...buttonAttrs })
  const clickable = el('div', { class: 'clickable_wrap' }, [button])
  const wrap = el('div', wrapAttrs, [clickable, element])
  return { wrap, button, spinner, text, line }
}

function documentWith(root) {
  return {
    querySelector: (selector) =>
      selectorMatches(root, selector) ? root : root.querySelector(selector),
    querySelectorAll: (selector) =>
      [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
  }
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

test('completed Brand project cards hide every authored end action when legacy and canonical controls coexist', async () => {
  const decline = el('button', { 'wf-xano-link': 'project-decline' })
  const declineLabel = el('div', { class: 'button_main-text' })
  declineLabel.textContent = 'Decline Request'
  const declineWrap = el('div', { class: 'button_main-wrap' }, [decline, declineLabel])
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const endLabel = el('div', { class: 'button_main-text' })
  endLabel.textContent = 'End Project & Review'
  const endWrap = el('div', { class: 'button_main-wrap' }, [end, endLabel])
  const review = el('a', { 'wf-xano-link': 'review_starter', href: '/messages' })
  const reviewWrap = el('div', { class: 'button_main-wrap' }, [review])
  const message = el('a', { href: '/messages?project=708' })
  const messageWrap = el('div', { class: 'button_main-wrap' }, [message])
  const card = el(
    'div',
    { class: 'project_item', 'data-wf-xano-id': '708' },
    [declineWrap, endWrap, reviewWrap, messageWrap],
  )
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])

  await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 708,
            lifecycle_state: 'completed',
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
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )
  await new Promise(setImmediate)

  assert.equal(decline.getAttribute('wf-xano-link'), null)
  assert.equal(decline.getAttribute('data-project-action'), 'end')
  assert.equal(decline.getAttribute('data-project-action-duplicate'), 'true')
  assert.equal(declineWrap.style.display, 'none')
  assert.equal(end.getAttribute('wf-xano-link'), null)
  assert.equal(end.getAttribute('data-project-action'), 'end')
  assert.equal(end.getAttribute('data-project-action-duplicate'), null)
  assert.equal(endWrap.style.display, 'none')
  assert.equal(reviewWrap.style.display, '')
  assert.equal(message.getAttribute('href'), '/messages?project=708')
  assert.equal(message.getAttribute('data-project-action'), null)
  assert.equal(messageWrap.style.display, undefined)
})

test('pending project cards suppress the request-era duplicate and keep one canonical Cancel action', async () => {
  const decline = el('button', { 'wf-xano-link': 'project-decline' })
  const declineLabel = el('div', { class: 'button_main-text' })
  declineLabel.textContent = 'Decline Request'
  const declineWrap = el('div', { class: 'button_main-wrap' }, [decline, declineLabel])
  const end = el('button', { 'wf-xano-link': 'project-end' })
  const endLabel = el('div', { class: 'button_main-text' })
  endLabel.textContent = 'End Project & Review'
  const endWrap = el('div', { class: 'button_main-wrap' }, [end, endLabel])
  const card = el(
    'div',
    { class: 'project_item', 'data-wf-xano-id': '709' },
    [declineWrap, endWrap],
  )
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])

  await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        return response({
          items: [{ id: 709, status: 'pending', lifecycle_state: 'contract_sent' }],
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
  await new Promise(setImmediate)

  assert.equal(decline.getAttribute('data-project-action-duplicate'), 'true')
  assert.equal(declineWrap.style.display, 'none')
  assert.equal(end.getAttribute('data-project-action-duplicate'), null)
  assert.equal(end.getAttribute('data-project-action'), 'end')
  assert.equal(endWrap.style.display, '')
  assert.equal(endLabel.textContent, 'Cancel Project')
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

test('contract access separates recipient sessions from completed protected PDFs', async () => {
  const bridge = await loadBridge(async () => response({}))
  const isViewable = bridge.window.Opp30.projectContractIsViewable
  const isDownloadable = bridge.window.Opp30.projectContractIsDownloadable
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
    'voided',
    'expired',
    'error',
    'invalid',
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
  assert.equal(
    isDownloadable({ pandadoc_document_id: 'doc-675', contract_status: 'completed' }),
    true,
  )
  assert.equal(
    isDownloadable({ pandadoc_document_id: 'doc-675', contract_status: 'sent' }),
    false,
  )
  assert.equal(isDownloadable({ contract_status: 'completed' }), false)
})

test('contract signing panel reducer allows either party to sign first', async () => {
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

  assert.equal(reduce({ ...base, contract_source: 'own_contract' }, 'brand').visible, false)
  assert.equal(reduce({ ...base, sync_origin: 'v2' }, 'brand').visible, false)
  assert.equal(reduce(base, 'brand').action, 'sign')
  assert.equal(reduce(base, 'starter').action, 'sign')
  assert.equal(reduce(base, 'starter').state, 'action')

  const brandSigned = { ...base, brand_signed_at: '2026-08-12T01:00:00Z' }
  assert.equal(reduce(brandSigned, 'brand').action, 'view')
  assert.equal(reduce(brandSigned, 'starter').action, 'sign')

  const starterSignedFirst = { ...base, starter_signed_at: '2026-08-12T01:01:00Z' }
  assert.equal(reduce(starterSignedFirst, 'brand').action, 'sign')
  assert.equal(reduce(starterSignedFirst, 'brand').state, 'action')
  assert.equal(reduce(starterSignedFirst, 'brand').title, 'Taylor has signed')
  assert.equal(reduce(starterSignedFirst, 'starter').action, 'view')
  assert.equal(reduce(starterSignedFirst, 'starter').state, 'waiting')

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

test('brand and starter contract panels cover the release lifecycle matrix', async () => {
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
  const matrix = [
    {
      name: 'draft',
      project: { ...base, lifecycle_state: 'contract_draft', contract_status: 'draft' },
      expected: {
        visible: true,
        state: 'processing',
        title: 'Preparing the contract',
        body: 'The contract is being prepared. This status will update automatically.',
        action: null,
        actionLabel: '',
      },
    },
    {
      name: 'sent',
      project: base,
      expected: {
        visible: true,
        state: 'action',
        title: 'Your signature is required',
        body: 'Review and sign the contract. The project starts after both parties sign.',
        action: 'sign',
        actionLabel: 'Review & Sign Contract',
      },
    },
    {
      name: 'viewed',
      project: { ...base, contract_status: 'viewed' },
      expected: {
        visible: true,
        state: 'action',
        title: 'Your signature is required',
        body: 'Review and sign the contract. The project starts after both parties sign.',
        action: 'sign',
        actionLabel: 'Review & Sign Contract',
      },
    },
    {
      name: 'partial with counterparty signed first',
      project: (role) => ({
        ...base,
        lifecycle_state: 'signature_partial',
        contract_status: 'partial',
        [`${role === 'brand' ? 'starter' : 'brand'}_signed_at`]: '2026-08-12T01:01:00Z',
      }),
      expected: (role) => ({
        visible: true,
        state: 'action',
        title: (role === 'brand' ? 'Taylor' : 'Acme') + ' has signed',
        body: 'Your signature is required to activate this project.',
        action: 'sign',
        actionLabel: 'Review & Sign Contract',
      }),
    },
    {
      name: 'partial with viewer signed first',
      project: (role) => ({
        ...base,
        lifecycle_state: 'signature_partial',
        contract_status: 'partial',
        [`${role}_signed_at`]: '2026-08-12T01:01:00Z',
      }),
      expected: (role) => ({
        visible: true,
        state: 'waiting',
        title: 'Waiting for ' + (role === 'brand' ? 'Taylor' : 'Acme') + ' to sign',
        body: 'Your signature is complete. We will notify you when ' +
          (role === 'brand' ? 'Taylor' : 'Acme') + ' signs.',
        action: 'view',
        actionLabel: 'View Contract',
      }),
    },
    {
      name: 'partial with both signatures recorded',
      project: {
        ...base,
        lifecycle_state: 'signature_partial',
        contract_status: 'partial',
        brand_signed_at: '2026-08-12T01:00:00Z',
        starter_signed_at: '2026-08-12T01:01:00Z',
      },
      expected: {
        visible: true,
        state: 'processing',
        title: 'Both parties have signed',
        body: 'The project is being activated. This status will update automatically.',
        action: null,
        actionLabel: '',
      },
    },
    {
      name: 'active',
      project: { ...base, lifecycle_state: 'active', contract_status: 'completed' },
      expected: {
        visible: true,
        state: 'complete',
        title: 'Contract signed',
        body: 'Both parties signed the contract. You can view the completed copy at any time.',
        action: 'view',
        actionLabel: 'View Signed Contract',
      },
    },
    {
      name: 'completion requested',
      project: { ...base, lifecycle_state: 'completion_requested', contract_status: 'completed' },
      expected: {
        visible: true,
        state: 'complete',
        title: 'Contract signed',
        body: 'Both parties signed the contract. You can view the completed copy at any time.',
        action: 'view',
        actionLabel: 'View Signed Contract',
      },
    },
    {
      name: 'termination requested',
      project: { ...base, lifecycle_state: 'termination_requested', contract_status: 'completed' },
      expected: {
        visible: true,
        state: 'complete',
        title: 'Contract signed',
        body: 'Both parties signed the contract. You can view the completed copy at any time.',
        action: 'view',
        actionLabel: 'View Signed Contract',
      },
    },
    {
      name: 'completed',
      project: { ...base, lifecycle_state: 'completed', contract_status: 'completed' },
      expected: {
        visible: true,
        state: 'complete',
        title: 'Contract signed',
        body: 'Both parties signed the contract. You can view the completed copy at any time.',
        action: 'view',
        actionLabel: 'View Signed Contract',
      },
    },
    {
      name: 'terminated and incomplete',
      project: {
        ...base,
        lifecycle_state: 'terminated',
        status: 'incomplete',
        contract_status: 'completed',
      },
      expected: {
        visible: true,
        state: 'complete',
        title: 'Contract signed',
        body: 'Both parties signed the contract. You can view the completed copy at any time.',
        action: 'view',
        actionLabel: 'View Signed Contract',
      },
    },
    {
      name: 'declined',
      project: { ...base, lifecycle_state: 'contract_declined', contract_status: 'declined' },
      expected: {
        visible: true,
        state: 'attention',
        title: 'Contract declined',
        body: 'This contract was declined and cannot be signed. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      },
    },
    {
      name: 'expired',
      project: { ...base, lifecycle_state: 'contract_expired', contract_status: 'expired' },
      expected: {
        visible: true,
        state: 'attention',
        title: 'Contract expired',
        body: 'This contract has expired and cannot be signed. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      },
    },
    {
      name: 'voided',
      project: { ...base, lifecycle_state: 'contract_voided', contract_status: 'voided' },
      expected: {
        visible: true,
        state: 'attention',
        title: 'Contract voided',
        body: 'This contract was voided and cannot be signed. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      },
    },
    {
      name: 'error',
      project: { ...base, lifecycle_state: 'contract_sent', contract_status: 'error' },
      expected: {
        visible: true,
        state: 'attention',
        title: 'Contract needs attention',
        body: 'The contract cannot be signed right now. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      },
    },
    {
      name: 'failed',
      project: { ...base, lifecycle_state: 'contract_sent', contract_status: 'failed' },
      expected: {
        visible: true,
        state: 'attention',
        title: 'Contract needs attention',
        body: 'The contract cannot be signed right now. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      },
    },
    {
      name: 'invalid',
      project: { ...base, lifecycle_state: 'contract_sent', contract_status: 'invalid' },
      expected: {
        visible: true,
        state: 'attention',
        title: 'Contract needs attention',
        body: 'The contract cannot be signed right now. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      },
    },
  ]

  ;['brand', 'starter'].forEach((role) => {
    matrix.forEach(({ name, project, expected }) => {
      const state = reduce(typeof project === 'function' ? project(role) : project, role)
      const expectedState = typeof expected === 'function' ? expected(role) : expected
      assert.deepEqual(
        Object.fromEntries(Object.keys(expectedState).map((key) => [key, state[key]])),
        expectedState,
        `${role}: ${name}`,
      )
    })
  })
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
  const panel = el('div', { 'data-project-contract-panel': '', hidden: '' }, [
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
  assert.equal(panel.hidden, false)
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

test('contract panel refreshes once for a dashboard lifecycle return burst', async () => {
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
  let now = 10_000

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
      nowImpl: () => now,
    },
  )

  assert.ok(await waitFor(() => title.textContent === 'Your signature is required'))
  assert.equal(signWrap.style.display, '')
  assert.equal(viewWrap.style.display, 'none')

  bridge.dispatchWindow('pageshow')

  assert.ok(await waitFor(() => listRequests === 2 && title.textContent === 'Acme has signed'))
  assert.equal(signWrap.style.display, '')
  assert.equal(viewWrap.style.display, 'none')
  const visibleBadges = badges
    .filter((badge) => badge.style.display === '')
    .map((badge) => badge.getAttribute('data-project-contract-badge'))
  assert.deepEqual(visibleBadges, ['brand-signed', 'starter-pending'])

  // One browser return can emit pageshow, focus, and visible visibilitychange.
  // The first signal refreshes canonical state; the rest belong to that burst.
  bridge.dispatchWindow('focus')
  bridge.dispatchDocument('visibilitychange', {})
  await new Promise(setImmediate)
  assert.equal(listRequests, 2)

  // A distinct refocus while the lifecycle result is still fresh stays local.
  now += 15_000
  bridge.dispatchWindow('focus')
  await new Promise(setImmediate)
  assert.equal(listRequests, 2)

  now += 15_001
  bridge.dispatchWindow('focus')
  assert.ok(await waitFor(() => listRequests === 3))
})

test('contract panel fails closed when its return refresh fails', async () => {
  const signAction = el('a', { 'data-project-contract-action': 'sign' })
  const signWrap = el('div', { class: 'button_main-wrap' }, [signAction])
  const actions = el('div', { 'data-project-contract-actions': '' }, [signWrap])
  const panel = el('div', { 'data-project-contract-panel': '', hidden: '' }, [actions])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '708' }, [panel])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
  let listRequests = 0

  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        listRequests += 1
        if (listRequests === 2) throw new Error('Temporary project list failure')
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
  assert.equal(panel.hidden, true)
  assert.equal(panel.getAttribute('aria-hidden'), 'true')
  assert.equal(signWrap.style.display, 'none')
  assert.match(String(bridge.consoleErrors.at(-1)[0]), /focus projection refresh failed/)

  // A failed lifecycle refresh never starts the freshness window. The next
  // focus retries immediately and can restore the canonical projection.
  bridge.dispatchWindow('focus')
  assert.ok(await waitFor(() => listRequests === 3 && signWrap.style.display === ''))
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
  const contractWindow = {
    closed: false,
    location: {},
    opener: bridge.window,
    close() { this.closed = true },
  }
  bridge.window.open = () => contractWindow
  assert.ok(await waitFor(() => listCount === 1))

  bridge.dispatchDocument('click', clickEvent(contract).event)

  assert.ok(await waitFor(() => wrap.getAttribute('data-project-action-result') === 'error'))
  assert.equal(listCount, 2)
  assert.deepEqual(requests, [])
  assert.deepEqual(contractWindow.location, {})
  assert.equal(contractWindow.opener, null)
  assert.equal(contractWindow.closed, true)
  assert.equal(wrap.style.display, 'none')
  assert.equal(wrap.getAttribute('aria-hidden'), 'true')
  assert.equal(label.textContent, 'Contract is unavailable. Please try again.')
})

test('completed Standard Contracts use the protected-PDF route and never mint a signing session', async () => {
  const contract = el('a', { href: '#contract' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'View Contract'
  const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '715' }, [wrap])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
  const requests = []
  const pdf = new Blob(['signed-contract'], { type: 'application/pdf' })
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 715,
            sync_origin: 'v3',
            contract_source: 'standard',
            lifecycle_state: 'active',
            contract_status: 'completed',
            pandadoc_document_id: 'doc-715',
            brand_signed_at: '2026-08-13T01:00:00Z',
            starter_signed_at: '2026-08-13T01:01:00Z',
          }],
        })
      }
      requests.push({ url, init })
      if (url.includes('/contracts/download/v3')) return binaryResponse(pdf)
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
  let contractLoaded
  const contractWindow = {
    closed: false,
    location: {},
    opener: bridge.window,
    addEventListener(type, listener) {
      if (type === 'load') contractLoaded = listener
    },
  }
  const revokedUrls = []
  bridge.window.open = () => contractWindow
  bridge.window.URL = {
    createObjectURL: () => 'blob:signed-contract-715',
    revokeObjectURL: (url) => revokedUrls.push(url),
  }
  assert.ok(await waitFor(() => wrap.style.display === ''))
  assert.equal(label.textContent, 'View Signed Contract')

  bridge.dispatchDocument('click', clickEvent(contract).event)

  assert.ok(await waitFor(() => contractWindow.location.href === 'blob:signed-contract-715'))
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/contracts/download/v3',
  ])
  assert.equal(requests.some(({ url }) => url.includes('/contracts/link/v3')), false)
  assert.equal(requests[0].init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(requests[0].init.body), { project_id: 715 })
  assert.equal(contractWindow.opener, null)
  assert.deepEqual(revokedUrls, [])

  contractLoaded()

  assert.deepEqual(revokedUrls, ['blob:signed-contract-715'])
})

test('completed contract access fails closed when Xano rejects owner or environment', async () => {
  for (const rejection of [
    { name: 'wrong owner', status: 403 },
    { name: 'wrong environment', status: 404 },
  ]) {
    const contract = el('a', { href: '#contract' })
    const label = el('div', { class: 'button_main-text' })
    label.textContent = 'View Contract'
    const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
    const card = el('div', { class: 'project_item', 'data-wf-xano-id': '715' }, [wrap])
    const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card])
    const requests = []
    const bridge = await loadBridge(
      async (input) => {
        const url = String(input)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
        if (url.includes('/brand/projects/mine')) {
          return response({
            items: [{
              id: 715,
              sync_origin: 'v3',
              contract_source: 'standard',
              lifecycle_state: 'active',
              contract_status: 'completed',
              pandadoc_document_id: 'doc-715',
            }],
          })
        }
        requests.push(url)
        if (url.includes('/contracts/download/v3')) {
          return response({ message: rejection.name }, false, rejection.status)
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
    let objectUrlsCreated = 0
    bridge.window.open = () => contractWindow
    bridge.window.URL = {
      createObjectURL() {
        objectUrlsCreated += 1
        return 'blob:must-not-open'
      },
      revokeObjectURL() {},
    }
    assert.ok(await waitFor(() => wrap.style.display === ''), rejection.name)

    bridge.dispatchDocument('click', clickEvent(contract).event)

    assert.ok(
      await waitFor(() => wrap.getAttribute('data-project-action-result') === 'error'),
      rejection.name,
    )
    assert.deepEqual(requests, [
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/contracts/download/v3',
    ], rejection.name)
    assert.equal(contractWindow.closed, true, rejection.name)
    assert.deepEqual(contractWindow.location, {}, rejection.name)
    assert.equal(bridge.location.href, originalHref, rejection.name)
    assert.equal(objectUrlsCreated, 0, rejection.name)
    assert.equal(label.textContent, 'Contract is unavailable. Please try again.', rejection.name)
  }
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

test('View Contract never replaces either dashboard when popups are blocked', async () => {
  for (const dashboard of [
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      instance: 'dash-projects',
      endpoint: '/starter/projects/mine',
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      instance: 'dash-brand-projects',
      endpoint: '/brand/projects/mine',
    },
  ]) {
    const contract = el('a', { href: '#contract' })
    const label = el('div', { class: 'button_main-text' })
    label.textContent = 'View Contract'
    const wrap = el('div', { class: 'button_main-wrap' }, [contract, label])
    const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
    const root = el('div', { 'wf-xano-instance': dashboard.instance }, [card])
    let contractRequests = 0
    const bridge = await loadBridge(
      async (input) => {
        const url = String(input)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
        if (url.includes(dashboard.endpoint)) {
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
        if (url.includes('/contracts/link/v3')) {
          contractRequests += 1
          return response({ url: 'https://app.pandadoc.com/s/popup-blocked-contract' })
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      {
        member: dashboard.member,
        pathname: dashboard.pathname,
        querySelector: (selector) =>
          selectorMatches(root, selector) ? root : root.querySelector(selector),
        querySelectorAll: (selector) =>
          [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
        routeGuard: true,
      },
    )
    bridge.window.location = bridge.location
    let popupAttempts = 0
    bridge.window.open = () => {
      popupAttempts += 1
      return null
    }
    assert.ok(await waitFor(() => wrap.style.display === ''), dashboard.pathname)
    const originalHref = bridge.location.href

    bridge.dispatchDocument('click', clickEvent(contract).event)

    assert.equal(popupAttempts, 1, dashboard.pathname)
    assert.ok(
      await waitFor(() => wrap.getAttribute('data-project-action-result') === 'error'),
      dashboard.pathname,
    )
    assert.equal(bridge.location.href, originalHref, dashboard.pathname)
    assert.equal(contractRequests, 0, dashboard.pathname)
    assert.equal(label.textContent, 'Allow pop-ups to open the contract in a new tab.')
  }
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
        return response({ project: { id: 675, lifecycle_state: 'completed' } })
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
          project: { id: 675, lifecycle_state: 'completed', lifecycle_version: 3 },
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
  assert.equal(label.textContent, 'Project completed')
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

test('call-review email deep link validates the booking before opening and submits once', async () => {
  const rating = el('input', { name: 'Call-Rating' })
  rating.value = '5'
  const feedback = el('textarea', { name: 'Public-Feedback' })
  feedback.value = 'Excellent advice after the completed call.'
  const privateFeedback = el('textarea', { name: 'Private-Feedback' })
  const privateWrap = el('div', { class: 'form_field-wrap' }, [privateFeedback])
  const submit = el('button', { type: 'submit' })
  const form = el('form', {}, [rating, feedback, privateWrap, submit])
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = 'Rate your call with [Starter Name]'
  const done = el('div', { class: 'w-form-done' })
  const fail = el('div', { class: 'w-form-fail' })
  const modal = el(
    'dialog',
    { 'data-modal-target': 'rate-starter-call' },
    [starterName, form, done, fail],
  )
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [modal])
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({ message: 'Projects unavailable' }, false, 503)
      }
      if (url.includes('/brand/call-reviews/eligibility/v3')) {
        requests.push({ type: 'eligibility', url, body: JSON.parse(init.body) })
        return response({
          booking_id: 'booking/email 42',
          eligible: true,
          already_reviewed: false,
          starter_name: 'Brian',
        })
      }
      if (url.includes('/brand/call-reviews/submit/v3')) {
        requests.push({ type: 'submit', url, body: JSON.parse(init.body) })
        return response({ review_id: 42, booking_id: 'booking/email 42', created: true })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      search: '?review_booking=booking%2Femail%2042&utm_source=mandrill',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => modal.getAttribute('open') === ''))
  assert.equal(starterName.textContent, 'Rate your call with Brian')
  assert.equal(privateWrap.style.display, 'none')
  assert.deepEqual(requests[0].body, { booking_id: 'booking/email 42' })
  assert.match(requests[0].url, /api:KZf7nFnk\/brand\/call-reviews\/eligibility\/v3$/)

  bridge.dispatchDocument('submit', {
    target: form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => requests.filter((request) => request.type === 'submit').length === 1))
  const submitted = requests.find((request) => request.type === 'submit')
  assert.equal(submitted.body.booking_id, 'booking/email 42')
  assert.equal(submitted.body.rating, 5)
  assert.equal(submitted.body.review_text, feedback.value)
  assert.match(submitted.body.idempotency_key, /^review-ui:call:booking\/email 42:/)
  assert.equal(form.style.display, 'none')
  assert.equal(done.style.display, 'block')

  bridge.dispatchDocument('submit', {
    target: form,
    preventDefault() {},
    stopPropagation() {},
  })
  await new Promise(setImmediate)
  assert.equal(requests.filter((request) => request.type === 'submit').length, 1)
})

test('project-review email deep link opens only the eligible authenticated project', async () => {
  const form = el('form')
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = 'Rate your project with [Starter Name]'
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [modal])
  let projectRequests = 0
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        projectRequests += 1
        return response({
          items: [
            {
              id: 675,
              lifecycle_state: 'completed',
              review_eligible: true,
              has_review: false,
              starter_name: 'Brian',
            },
            {
              id: 676,
              lifecycle_state: 'completed',
              review_eligible: false,
              has_review: true,
              starter_name: 'Other Starter',
            },
          ],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      search: '?review_project=675&utm_source=mandrill',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => modal.getAttribute('open') === ''))
  assert.equal(projectRequests, 1)
  assert.equal(starterName.textContent, 'Rate your project with Brian')

  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.NO_MISTAKES_EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(process.env.NO_MISTAKES_EVIDENCE_DIR, 'project-review-eligible.json'),
      JSON.stringify({
        route: '/brand-dashboard?review_project=675',
        authenticated_role: 'brand-paid',
        exact_project_id: 675,
        project_requests: projectRequests,
        modal_open: modal.getAttribute('open') === '',
        visible_prompt: starterName.textContent,
      }, null, 2) + '\n',
    )
  }

  bridge.dispatchWindow('focus')
  await new Promise(setImmediate)
  assert.equal(starterName.textContent, 'Rate your project with Brian')
})

test('project-review email deep link resolves an eligible project beyond the visible page', async () => {
  const form = el('form')
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = 'Rate your project with [Starter Name]'
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form])
  const root = el('div', {
    'wf-xano-instance': 'dash-brand-projects',
    'wf-xano-source': 'opp30:brand/projects/mine',
  }, [modal])
  const visibleState = {
    status: 'success',
    data: {
      items: [{
        id: 676,
        lifecycle_state: 'completed',
        review_eligible: false,
        has_review: true,
        starter_name: 'Visible Starter',
      }],
    },
    query: { page: 1, perPage: 12 },
  }
  const requestedPages = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        const body = JSON.parse(init.body)
        requestedPages.push(body.page)
        if (body.page === 1) {
          return response({
            items: visibleState.data.items,
            itemsTotal: 2,
            curPage: 1,
            nextPage: 2,
          })
        }
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'completed',
            review_eligible: true,
            has_review: false,
            starter_name: 'Brian',
          }],
          itemsTotal: 2,
          curPage: 2,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      search: '?review_project=675&utm_source=mandrill',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) {
          return key === 'dash-brand-projects'
            ? { getState: () => visibleState, subscribe: () => () => {} }
            : null
        },
      },
    },
  )

  assert.ok(await waitFor(() => modal.getAttribute('open') === ''))
  assert.deepEqual(requestedPages, [1, 2])
  assert.equal(starterName.textContent, 'Rate your project with Brian')
  assert.equal(bridge.consoleErrors.length, 0)
})

test('stale project refresh cannot consume a newer member review deep link', async () => {
  const form = el('form')
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = 'Rate your project with [Starter Name]'
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form])
  const root = el('div', {
    'wf-xano-instance': 'dash-brand-projects',
    'wf-xano-source': 'opp30:brand/projects/mine',
  }, [modal])
  const oldHandlers = new Set()
  const newHandlers = new Set()
  const loadingState = { status: 'loading', data: { items: [] }, query: { page: 1, perPage: 12 } }
  const oldInstance = {
    getState: () => loadingState,
    subscribe(handler) {
      oldHandlers.add(handler)
      return () => oldHandlers.delete(handler)
    },
  }
  const newInstance = {
    getState: () => loadingState,
    subscribe(handler) {
      newHandlers.add(handler)
      return () => newHandlers.delete(handler)
    },
  }
  let currentInstance = oldInstance
  const bridge = await loadBridge(
    async (input) => {
      throw new Error(`Unexpected request: ${input}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      search: '?review_project=675',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: { get: () => currentInstance },
    },
  )

  assert.ok(await waitFor(() => oldHandlers.size > 0))
  currentInstance = newInstance
  bridge.authChange({ ...paidBrandMember, id: 'm-brand-2' })
  assert.ok(await waitFor(() => newHandlers.size > 0))

  const oldState = { status: 'success', data: { items: [] }, query: { page: 1, perPage: 12 } }
  for (const handler of [...oldHandlers]) handler(oldState)
  await new Promise(setImmediate)

  const newState = {
    status: 'success',
    data: { items: [{
      id: 675,
      lifecycle_state: 'completed',
      review_eligible: true,
      has_review: false,
      starter_name: 'New Member Starter',
    }] },
    query: { page: 1, perPage: 12 },
  }
  for (const handler of [...newHandlers]) handler(newState)

  assert.ok(await waitFor(() => modal.getAttribute('open') === ''))
  assert.equal(starterName.textContent, 'Rate your project with New Member Starter')
})

test('project-review email deep link fails closed for an ineligible project', async () => {
  const form = el('form')
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = '[Starter Name]'
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [modal])
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 676,
            lifecycle_state: 'completed',
            review_eligible: false,
            has_review: true,
            starter_name: 'Brian',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      search: '?review_project=676&utm_source=mandrill',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  await new Promise(setImmediate)
  await new Promise(setImmediate)
  assert.equal(modal.getAttribute('open'), null)
  assert.equal(starterName.textContent, '[Starter Name]')
  assert.ok(bridge.consoleErrors.length === 0)
})

test('project-review email deep link fails closed for malformed, mixed, and unauthorized requests', async () => {
  const cases = [
    { name: 'malformed project id', member: paidBrandMember, search: '?review_project=not-a-project' },
    { name: 'mixed review targets', member: paidBrandMember, search: '?review_project=675&review_booking=call-42' },
    { name: 'wrong member role', member: talentMember, search: '?review_project=675' },
    { name: 'signed-out visitor', member: null, search: '?review_project=675' },
  ]

  const evidence = []
  for (const scenario of cases) {
    const form = el('form')
    form.reset = () => {}
    const starterName = el('p')
    starterName.textContent = '[Starter Name]'
    const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form])
    const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [modal])
    let projectRequests = 0
    const bridge = await loadBridge(
      async (input) => {
        const url = String(input)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
        if (url.includes('/brand/projects/mine')) {
          projectRequests += 1
          return response({
            items: [{
              id: 675,
              lifecycle_state: 'completed',
              review_eligible: true,
              has_review: false,
              starter_name: 'Brian',
            }],
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      {
        member: scenario.member,
        pathname: '/brand-dashboard',
        search: scenario.search,
        querySelector: (selector) =>
          selectorMatches(root, selector) ? root : root.querySelector(selector),
        querySelectorAll: (selector) =>
          [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
        routeGuard: true,
      },
    )

    await new Promise(setImmediate)
    await new Promise(setImmediate)
    assert.equal(modal.getAttribute('open'), null, scenario.name)
    assert.equal(starterName.textContent, '[Starter Name]', scenario.name)
    assert.equal(bridge.consoleErrors.length, 0, scenario.name)
    assert.equal(
      projectRequests,
      scenario.member === paidBrandMember ? 1 : 0,
      scenario.name,
    )
    evidence.push({
      scenario: scenario.name,
      route: '/brand-dashboard' + scenario.search,
      project_requests: projectRequests,
      modal_open: modal.getAttribute('open') === '',
      visible_prompt: starterName.textContent,
    })
  }

  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.NO_MISTAKES_EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(process.env.NO_MISTAKES_EVIDENCE_DIR, 'project-review-fail-closed.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
  }
})

test('pending call-review eligibility cannot replace a newer project review', async () => {
  const review = el('a', { 'wf-xano-link': 'review_starter', href: '/messages' })
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [review])
  const form = el('form')
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = 'Rate your call with [Starter Name]'
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card, modal])
  const pendingEligibility = deferred()
  let projectRequests = 0
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        projectRequests += 1
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'completed',
            review_eligible: true,
            has_review: false,
            starter_name: 'New Project Starter',
          }],
        })
      }
      if (url.includes('/brand/call-reviews/eligibility/v3')) {
        return pendingEligibility.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      search: '?review_booking=older-call',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => projectRequests === 1))
  assert.equal(modal.getAttribute('open'), null)
  bridge.dispatchDocument('click', clickEvent(review).event)
  assert.ok(await waitFor(() => starterName.textContent === 'Rate your call with New Project Starter'))

  pendingEligibility.resolve(response({
    booking_id: 'older-call',
    eligible: true,
    already_reviewed: false,
    starter_name: 'Older Call Starter',
  }))
  await new Promise(setImmediate)
  await new Promise(setImmediate)

  assert.equal(starterName.textContent, 'Rate your call with New Project Starter')
})

test('call-review email deep link fails closed when Xano says the booking is ineligible', async () => {
  const form = el('form')
  form.reset = () => {}
  const starterName = el('p')
  starterName.textContent = '[Starter Name]'
  const modal = el('dialog', { 'data-modal-target': 'rate-starter-call' }, [starterName, form])
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [modal])
  let eligibilityRequests = 0
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) return response({ items: [] })
      if (url.includes('/brand/call-reviews/eligibility/v3')) {
        eligibilityRequests += 1
        return response({
          booking_id: 'booking-closed',
          eligible: false,
          already_reviewed: true,
          starter_name: 'Brian',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/brand-dashboard',
      search: '?review_booking=booking-closed&utm_source=mandrill',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => eligibilityRequests === 1))
  assert.equal(modal.getAttribute('open'), null)
  assert.equal(starterName.textContent, '[Starter Name]')
  bridge.dispatchWindow('focus')
  await new Promise(setImmediate)
  assert.equal(eligibilityRequests, 1)
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

  const canonical = invoiceProjectContext(
    invoiceCard({
      heading_display: '#746 | Stale Brand',
      company_name: 'Stale Brand',
      title: 'Stale project title',
    }, '746'),
    {
      id: 746,
      title: 'Test Invoice',
      company_name: 'The Starters',
      hiring_manager_name: 'Jai Dolwani',
    },
  )
  assert.equal(canonical.title, 'Test Invoice')
  assert.equal(canonical.brand, 'The Starters')
  assert.equal(canonical.party, 'Jai Dolwani')

  assert.equal(invoiceProjectContext(invoiceCard({}, '0')), null)
  assert.equal(invoiceProjectContext(invoiceCard({}, '-4')), null)
  assert.equal(invoiceProjectContext(null), null)
})

test('the opening invoice banner receives the same project, company and party paint as success', async () => {
  const bridge = await loadBridge(async () => response({}))
  const project = el('p')
  const company = el('p')
  const banner = el('div', { class: 'generate-invoice_banner' }, [project, company])
  const close = el('a', { href: '/starter-dashboard' })
  const done = el('div', { class: 'w-form-done' }, [close])
  const modal = el('dialog', { 'data-modal-target': 'generate-invoice' }, [banner, done])

  bridge.window.Opp30.prepareInvoiceModal(modal, {
    projectId: 746,
    title: 'Test Invoice',
    brand: 'The Starters',
    party: 'Jai Dolwani',
  })

  assert.equal(project.getAttribute('data-wf-invoice-bind'), 'project')
  assert.equal(project.textContent, 'Test Invoice')
  assert.equal(company.getAttribute('data-wf-invoice-bind'), 'brand')
  assert.equal(company.textContent, 'The Starters · Jai Dolwani')
  assert.equal(close.getAttribute('data-wf-invoice'), 'close-success')
})

test('a separately authored invoice party bind keeps company and party on distinct rows', async () => {
  const bridge = await loadBridge(async () => response({}))
  const project = el('p', { 'data-wf-invoice-bind': 'project' })
  const company = el('p', { 'data-wf-invoice-bind': 'brand' })
  const party = el('p', { 'data-wf-invoice-bind': 'party' })
  const modal = el('dialog', { 'data-modal-target': 'generate-invoice' }, [project, company, party])

  bridge.window.Opp30.prepareInvoiceModal(modal, {
    projectId: 746,
    title: 'Test Invoice',
    brand: 'The Starters',
    party: 'Jai Dolwani',
  })

  assert.equal(project.textContent, 'Test Invoice')
  assert.equal(company.textContent, 'The Starters')
  assert.equal(party.textContent, 'Jai Dolwani')
})

test('a completed project card can still open Generate Invoice', async () => {
  const title = el('p', { 'wf-xano-bind': 'title' })
  title.textContent = 'Completed campaign'
  const company = el('p', { 'wf-xano-bind': 'company_name' })
  company.textContent = 'Acme Co'
  const state = el('p', { 'wf-xano-bind': 'lifecycle_state' })
  state.textContent = 'completed'
  const action = el('a', { href: '#generate-invoice' })
  const card = el('div', { 'data-wf-xano-id': '746' }, [title, company, state, action])
  const form = el('form', { id: 'wf-form-Generate-Invoice' })
  form.reset = () => {}
  const modal = el('dialog', { 'data-modal-target': 'generate-invoice' }, [form])
  let opened = 0
  modal.showModal = () => { opened += 1 }
  const roots = [card, modal]
  const bridge = await loadBridge(async () => response({}), {
    pathname: '/all-modals',
    querySelector: (selector) => {
      for (const root of roots) {
        if (selectorMatches(root, selector)) return root
        const match = root.querySelector(selector)
        if (match) return match
      }
      return null
    },
    querySelectorAll: (selector) => roots.flatMap((root) =>
      [root, ...descendants(root)].filter((node) => selectorMatches(node, selector))),
  })
  const click = clickEvent(action)

  bridge.dispatchDocument('click', click.event)

  assert.equal(opened, 1)
  assert.equal(click.counts.prevented, 1)
  assert.equal(click.counts.stopped, 1)
})

test('Generate Invoice waits for canonical project context before opening', async () => {
  const title = el('p', { 'wf-xano-bind': 'title' })
  title.textContent = 'Stale project title'
  const company = el('p', { 'wf-xano-bind': 'company_name' })
  company.textContent = 'Stale company'
  const action = el('a', { href: '#generate-invoice' })
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [
    title,
    company,
    action,
  ])
  const root = el('div', { 'wf-xano-instance': 'dash-projects' }, [card])
  const projectBind = el('p', { 'data-wf-invoice-bind': 'project' })
  const companyBind = el('p', { 'data-wf-invoice-bind': 'brand' })
  const form = el('form')
  form.reset = () => {}
  const modal = el('dialog', { 'data-modal-target': 'generate-invoice' }, [
    projectBind,
    companyBind,
    form,
  ])
  modal.showModal = () => { modal.open = true }
  const projectList = deferred()
  let listRequested = false
  const roots = [root, modal]
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        listRequested = true
        return projectList.promise
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) => {
        for (const candidate of roots) {
          if (selectorMatches(candidate, selector)) return candidate
          const match = candidate.querySelector(selector)
          if (match) return match
        }
        return null
      },
      querySelectorAll: (selector) => roots.flatMap((candidate) =>
        [candidate, ...descendants(candidate)].filter((node) => selectorMatches(node, selector))),
      routeGuard: true,
    },
  )
  assert.ok(await waitFor(() => listRequested))

  const click = clickEvent(action)
  bridge.dispatchDocument('click', click.event)
  assert.equal(modal.open, undefined)
  assert.equal(click.counts.prevented, 1)

  projectList.resolve(response({
    items: [{
      id: 746,
      lifecycle_state: 'completed',
      title: 'Canonical project title',
      company_name: 'Canonical company',
      hiring_manager_name: 'Canonical party',
    }],
  }))

  assert.ok(await waitFor(() => modal.open === true))
  assert.equal(projectBind.textContent, 'Canonical project title')
  assert.equal(companyBind.textContent, 'Canonical company · Canonical party')
})

test('each invoice success drains a reload after an active project refresh', async () => {
  const dom = invoiceSubmitDom()
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [dom.modal])
  const root = el('div', {
    'wf-xano-instance': 'dash-projects',
    'wf-xano-source': 'opp30:starter/projects/mine',
  }, [card])
  const handlers = new Set()
  const firstRefresh = deferred()
  const secondRefresh = deferred()
  let refreshCount = 0
  let state = {
    status: 'success',
    data: { items: [{ id: 746, lifecycle_state: 'completed', invoice_status: 'unpaid' }] },
    query: { page: 1, perPage: 12 },
  }
  const instance = {
    getState: () => state,
    refresh() {
      refreshCount += 1
      if (refreshCount === 1) return firstRefresh.promise
      if (refreshCount === 2) return secondRefresh.promise
      state = {
        ...state,
        data: { items: [{ id: 746, lifecycle_state: 'completed', invoice_status: 'paid-latest' }] },
      }
      handlers.forEach((handler) => handler(state))
      return Promise.resolve(state)
    },
    subscribe(handler) {
      handlers.add(handler)
      handler(state)
      return () => handlers.delete(handler)
    },
  }
  let invoiceRequests = 0
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/create/v3')) {
        invoiceRequests += 1
        return response({ invoice_id: 901, status: 'unpaid' })
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
      wfXano: {
        get(key) { return key === 'dash-projects' ? instance : null },
      },
    },
  )
  assert.ok(await waitFor(() => bridge.documentListenerCount('submit') > 0))
  bridge.window.Opp30.prepareInvoiceModal(dom.modal, {
    card,
    projectId: 746,
    title: 'Canonical project title',
    brand: 'Canonical company',
  })

  bridge.dispatchWindow('focus')
  assert.ok(await waitFor(() => refreshCount === 1))
  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  assert.ok(await waitFor(() => invoiceRequests === 1))
  assert.equal(refreshCount, 1)

  firstRefresh.resolve(state)
  assert.ok(await waitFor(() => refreshCount === 2))

  bridge.window.Opp30.prepareInvoiceModal(dom.modal, {
    card,
    projectId: 746,
    title: 'Canonical project title',
    brand: 'Canonical company',
  })
  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  assert.ok(await waitFor(() => invoiceRequests === 2))
  assert.equal(refreshCount, 2)

  secondRefresh.resolve(state)
  assert.ok(await waitFor(() => refreshCount === 3))
  assert.equal(instance.getState().data.items[0].invoice_status, 'paid-latest')
})

test('project reload ownership resets when the authenticated member changes', async () => {
  const timeline = el('p', { 'wf-xano-bind': 'timeline_display' })
  timeline.textContent = 'Authored timeline'
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '746' }, [timeline])
  const root = el('div', {
    'wf-xano-instance': 'dash-projects',
    'wf-xano-source': 'opp30:starter/projects/mine',
  }, [card])
  const oldRefresh = deferred()
  const oldHandlers = new Set()
  let oldState = {
    status: 'success',
    data: { items: [{ id: 746, lifecycle_state: 'active', start_date: '2026-08-01', end_date: '2026-08-01' }] },
    query: { page: 1, perPage: 12 },
  }
  const oldInstance = {
    getState: () => oldState,
    refresh: () => oldRefresh.promise,
    subscribe(handler) {
      oldHandlers.add(handler)
      handler(oldState)
      return () => oldHandlers.delete(handler)
    },
  }
  const newHandlers = new Set()
  let newRefreshes = 0
  const newState = {
    status: 'success',
    data: { items: [{ id: 746, lifecycle_state: 'active', start_date: '2026-08-20', end_date: '2026-08-20' }] },
    query: { page: 1, perPage: 12 },
  }
  const newInstance = {
    getState: () => newState,
    refresh() {
      newRefreshes += 1
      newHandlers.forEach((handler) => handler(newState))
      return Promise.resolve(newState)
    },
    subscribe(handler) {
      newHandlers.add(handler)
      handler(newState)
      return () => newHandlers.delete(handler)
    },
  }
  let currentInstance = oldInstance
  const bridge = await loadBridge(
    async (input) => {
      throw new Error(`Unexpected request: ${input}`)
    },
    {
      member: talentMember,
      pathname: '/starter-dashboard',
      querySelector: (selector) =>
        selectorMatches(root, selector) ? root : root.querySelector(selector),
      querySelectorAll: (selector) =>
        [root, ...descendants(root)].filter((node) => selectorMatches(node, selector)),
      routeGuard: true,
      wfXano: {
        get(key) { return key === 'dash-projects' ? currentInstance : null },
      },
    },
  )
  assert.ok(await waitFor(() => timeline.textContent === 'August 1, 2026'))

  bridge.dispatchWindow('focus')
  currentInstance = newInstance
  bridge.authChange({ ...talentMember, id: 'm-talent-2' })
  assert.ok(await waitFor(() => timeline.textContent === 'August 20, 2026'))

  bridge.dispatchWindow('focus')
  assert.ok(await waitFor(() => newRefreshes === 1))

  oldState = {
    ...oldState,
    data: { items: [{ id: 746, lifecycle_state: 'active', start_date: '2026-09-01', end_date: '2026-09-01' }] },
  }
  oldRefresh.resolve(oldState)
  await new Promise(setImmediate)
  await new Promise(setImmediate)

  assert.equal(timeline.textContent, 'August 20, 2026')
  assert.equal(oldHandlers.size, 0)
})

test('project invoice links always open in a detached new tab', async () => {
  const bridge = await loadBridge(async () => response({}))
  const link = el('a', { 'wf-xano-link': 'payment_link', href: '#payment_link' })
  const card = el('div', { 'data-wf-xano-id': '746' }, [link])

  bridge.window.Opp30.decorateProjectInvoiceLinks(card)

  assert.equal(link.getAttribute('target'), '_blank')
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer')
})

test('Back to Dashboard closes the invoice success modal without navigation', async () => {
  const close = el('a', {
    'data-wf-invoice': 'close-success',
    href: '/starter-dashboard',
  })
  const modal = el('dialog', { 'data-modal-target': 'generate-invoice' }, [close])
  const bridge = await loadBridge(async () => response({}), {
    pathname: '/all-modals',
    querySelector: (selector) => selectorMatches(modal, selector) ? modal : modal.querySelector(selector),
    querySelectorAll: (selector) =>
      [modal, ...descendants(modal)].filter((node) => selectorMatches(node, selector)),
  })
  let closed = 0
  bridge.window.lumos = { modal: { list: { 'generate-invoice': { close: () => { closed += 1 } } } } }
  const click = clickEvent(close)

  bridge.dispatchDocument('click', click.event)

  assert.equal(closed, 1)
  assert.equal(click.counts.prevented, 1)
  assert.equal(click.counts.stopped, 1)
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

test('auth switch while diagnostics load rejects before token acquisition', async () => {
  const diagnosticsReady = deferred()
  const receipts = []
  const requests = []
  const bridge = await loadBridge(async (url, options) => {
    requests.push({ url, options })
    return response({ authToken: 'xano-b' })
  }, { workflowDiagnosticsReady: diagnosticsReady.promise })
  bridge.authChange({ id: 'member-a' })

  const request = bridge.API.brandOppCreate({ title: 'A request' })
  bridge.authChange({ id: 'member-b' })
  bridge.window.StartersWorkflowDiagnostics = {
    create(fields) {
      return { diagnostic_id: 'WFD-TEST', ...fields }
    },
    record(receipt) {
      receipts.push(receipt)
      return receipt
    },
    complete(receipt, fields) {
      return { ...receipt, ...fields }
    },
  }
  diagnosticsReady.resolve(null)

  await assert.rejects(request, (error) => {
    assert.equal(error.code, 'MEMBER_SCOPE_CHANGED')
    assert.equal(error.workflowDiagnostic.error_code, 'MEMBER_SCOPE_CHANGED')
    assert.equal(error.workflowDiagnostic.request_started, false)
    return true
  })
  assert.equal(requests.length, 0)
  assert.equal(receipts.at(-1).result, 'failed')
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

test('standalone create owner sends one request before returning to the published feed', async () => {
  let submit
  const input = (name, value, attrs = {}) => {
    const field = el('input', { name, ...attrs })
    field.value = value
    field.addEventListener = () => {}
    field.dispatchEvent = () => true
    field.setCustomValidity = () => {}
    return field
  }
  const title = input('Opportunity-title', 'V3 canary')
  const description = input('Description', 'Production email automation canary')
  const requirements = input('Requirements', 'Verified Brand owner')
  const category = input('Category-option', '', {
    'data-opp30-selected-values': '["Email Automation"]',
  })
  const projectType = input('Project-Type', 'One Time', {
    id: 'One-Time',
    checked: '',
  })
  projectType.id = 'One-Time'
  const duration = input('Duration', '≤ 1 month', { checked: '' })
  const budget = input('One-Time-Budget', '1000')
  const button = input('', 'Submit', { type: 'submit' })
  const form = el('form', { 'data-opp-form': 'create' }, [
    title,
    description,
    requirements,
    category,
    projectType,
    duration,
    budget,
    button,
  ])
  form.addEventListener = (type, listener) => {
    if (type === 'submit') submit = listener
  }

  const createResponse = deferred()
  const requests = []
  const bridge = await loadBridge(
    async (request) => {
      const url = String(request)
      requests.push(url)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/opportunities/create')) return createResponse.promise
      throw new Error(`Unexpected request: ${url}`)
    },
    {
      member: paidBrandMember,
      pathname: '/opportunities---create',
      querySelector: (selector) => selector === '[data-opp-form="create"]' ? form : null,
      querySelectorAll: (selector) =>
        selector === '[data-opp-form="create"], [data-modal-target="edit-opportunity"] form'
          ? [form]
          : [],
      routeGuard: true,
    },
  )

  assert.ok(await waitFor(() => typeof submit === 'function'))
  const event = {
    preventDefault() {},
    stopImmediatePropagation() {},
    stopPropagation() {},
  }
  const firstSubmit = submit(event)
  const duplicateSubmit = submit(event)
  assert.ok(
    await waitFor(
      () => requests.filter((url) => url.includes('/brand/opportunities/create')).length === 1,
    ),
  )
  assert.equal(bridge.location.href, 'https://example.test/opportunities---create')

  createResponse.resolve(response({ id: 123 }))
  await Promise.all([firstSubmit, duplicateSubmit])

  assert.equal(
    requests.filter((url) => url.includes('/brand/opportunities/create')).length,
    1,
  )
  assert.equal(bridge.location.href, '/opportunities')
})

function opportunityCreateFormFixture() {
  const listen = (node) => {
    const listeners = new Map()
    node.addEventListener = (type, listener) => {
      const list = listeners.get(type) || []
      list.push(listener)
      listeners.set(type, list)
    }
    node.dispatchEvent = (event) => {
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    }
    node.setCustomValidity = () => {}
    return node
  }
  const input = (name, value, attrs = {}) => {
    const field = listen(el('input', { name, ...attrs }))
    field.value = value
    return field
  }
  const title = input('Opportunity-title', 'V3 canary')
  const description = input('Description', 'Production email automation canary')
  const requirements = input('Requirements', 'Verified Brand owner')
  const category = input('Category-option', 'Email Automation', {
    'data-opp30-selected-values': '["Email Automation"]',
  })
  const categoryValuesFromEvent = []
  category.addEventListener('opp30:set-category-values', (event) => {
    const values = event.detail && Array.isArray(event.detail.values) ? event.detail.values : []
    categoryValuesFromEvent.splice(0, categoryValuesFromEvent.length, ...values)
    category.setAttribute('data-opp30-selected-values', JSON.stringify(values))
    category.value = values.join(', ')
  })
  const chip = el('button', {
    'data-opp-role-value': 'Email Automation',
    'aria-selected': 'true',
  })
  const oneTime = input('Project-Type', 'One Time', { id: 'One-Time' })
  oneTime.id = 'One-Time'
  oneTime.checked = false
  const partTime = input('Project-Type', 'Ongoing Part Time', {
    id: 'Ongoing-Part-Time',
    checked: '',
  })
  partTime.id = 'Ongoing-Part-Time'
  partTime.checked = true
  const durationDefault = input('Duration', '≤ 1 months')
  durationDefault.checked = false
  const durationLong = input('Duration', '3 to 6 months', { checked: '' })
  durationLong.checked = true
  const oneTimeBudget = input('One-Time-Budget', '')
  const partTimeBudget = input('Part-Time-Budget', '4000')
  const estimatedHours = input('Estimated-Hours', '25')
  const hoursGroup = el('div', { 'data-project-type': 'part-time' }, [estimatedHours])
  const cancel = el('button', { type: 'button' })
  cancel.textContent = 'Cancel'
  const button = input('', 'Submit', { type: 'submit' })
  const form = el('form', { 'data-opp-form': 'create' }, [
    title,
    description,
    requirements,
    category,
    chip,
    oneTime,
    partTime,
    durationDefault,
    durationLong,
    oneTimeBudget,
    partTimeBudget,
    hoursGroup,
    cancel,
    button,
  ])
  form.resetCount = 0
  form.reset = function reset() {
    this.resetCount += 1
    title.value = ''
    description.value = ''
    requirements.value = ''
    category.value = ''
    oneTimeBudget.value = ''
    partTimeBudget.value = ''
    estimatedHours.value = ''
    oneTime.checked = true
    partTime.checked = false
    durationDefault.checked = true
    durationLong.checked = false
  }
  let submit
  form.addEventListener = (type, listener) => {
    if (type === 'submit') submit = listener
  }
  const successTitle = el('span', { 'data-opp-bind': 'title' })
  successTitle.textContent = ''
  const done = el('div', { class: 'w-form-done' }, [successTitle])
  const wrap = el('div', { class: 'w-form' }, [form, done])
  const modal = el('dialog', { 'data-modal-target': 'post-opportunity' }, [wrap])
  const editTitle = input('Opportunity-title', 'Existing Opportunity')
  const editForm = el('form', {}, [editTitle])
  editForm.resetCount = 0
  editForm.reset = function reset() {
    this.resetCount += 1
    editTitle.value = ''
  }
  const editModal = el('dialog', { 'data-modal-target': 'edit-opportunity' }, [editForm])
  return {
    cancel,
    category,
    categoryValuesFromEvent,
    chip,
    description,
    done,
    durationDefault,
    durationLong,
    editForm,
    editModal,
    editTitle,
    estimatedHours,
    form,
    hoursGroup,
    modal,
    oneTime,
    oneTimeBudget,
    partTime,
    partTimeBudget,
    requirements,
    successTitle,
    title,
    submit: () => submit,
  }
}

function submitEvent() {
  return {
    preventDefault() {},
    stopImmediatePropagation() {},
    stopPropagation() {},
  }
}

async function loadCreateFormBridge(fixture, fetchImpl) {
  return loadBridge(fetchImpl, {
    member: paidBrandMember,
    pathname: '/opportunities---create',
    querySelector: (selector) => {
      if (selector === '[data-opp-form="create"]') return fixture.form
      if (selector === '[data-modal-target="edit-opportunity"]') return fixture.editModal
      if (selector === '[data-modal-target="post-opportunity"]') return fixture.modal
      return null
    },
    querySelectorAll: (selector) => {
      if (selector === '[data-opp-form="create"], [data-modal-target="edit-opportunity"] form') {
        return [fixture.form, fixture.editForm]
      }
      return []
    },
    routeGuard: true,
  })
}

test('successful create restores Create Form Authored Defaults and keeps Review Success title', async () => {
  const fixture = opportunityCreateFormFixture()
  const createBodies = []
  const bridge = await loadCreateFormBridge(fixture, async (request, options = {}) => {
    const url = String(request)
    if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
    if (url.includes('/brand/opportunities/create')) {
      createBodies.push(JSON.parse(options.body || '{}'))
      return response({ id: 100 + createBodies.length })
    }
    throw new Error(`Unexpected request: ${url}`)
  })

  assert.ok(await waitFor(() => typeof fixture.submit() === 'function'))
  await fixture.submit()(submitEvent())

  assert.equal(fixture.successTitle.textContent, 'V3 canary')
  assert.equal(fixture.title.value, '')
  assert.equal(fixture.description.value, '')
  assert.equal(fixture.requirements.value, '')
  assert.equal(fixture.oneTimeBudget.value, '')
  assert.equal(fixture.partTimeBudget.value, '')
  assert.equal(fixture.estimatedHours.value, '')
  assert.deepEqual(fixture.categoryValuesFromEvent, [])
  assert.equal(fixture.category.getAttribute('data-opp30-selected-values'), '[]')
  assert.equal(fixture.chip.getAttribute('aria-selected'), null)
  assert.equal(fixture.oneTime.checked, true)
  assert.equal(fixture.partTime.checked, false)
  assert.equal(fixture.durationDefault.checked, true)
  assert.equal(fixture.durationLong.checked, false)
  assert.equal(fixture.hoursGroup.hidden, true)
  assert.equal(fixture.form.resetCount, 1)
  assert.equal(bridge.location.href, 'https://example.test/opportunities---create')
  assert.equal(fixture.editTitle.value, 'Existing Opportunity')
  assert.equal(fixture.editForm.resetCount, 0)

  bridge.dispatchWindow('modal-open', { modal: fixture.modal })
  assert.equal(fixture.title.value, '')
  assert.equal(fixture.form.style.display, '')

  fixture.title.value = 'Second opportunity'
  fixture.description.value = 'A follow-up brief'
  fixture.requirements.value = 'Need a writer'
  fixture.category.setAttribute('data-opp30-selected-values', '["Paid Media"]')
  fixture.oneTimeBudget.value = '500'
  await fixture.submit()(submitEvent())

  assert.equal(createBodies.length, 2)
  assert.equal(createBodies[0].title, 'V3 canary')
  assert.equal(createBodies[1].title, 'Second opportunity')
  assert.equal(fixture.successTitle.textContent, 'Second opportunity')
  assert.equal(fixture.title.value, '')

  bridge.dispatchWindow('modal-open', { modal: fixture.editModal })
  assert.equal(fixture.editTitle.value, 'Existing Opportunity')
  assert.equal(fixture.editForm.resetCount, 0)
})

test('failed create submit leaves the Create Form draft in place', async () => {
  const fixture = opportunityCreateFormFixture()
  const bridge = await loadCreateFormBridge(fixture, async (request) => {
    const url = String(request)
    if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
    if (url.includes('/brand/opportunities/create')) {
      return response({ message: 'Xano rejected the create' }, false, 400)
    }
    throw new Error(`Unexpected request: ${url}`)
  })

  assert.ok(await waitFor(() => typeof fixture.submit() === 'function'))
  await fixture.submit()(submitEvent())

  assert.equal(fixture.title.value, 'V3 canary')
  assert.equal(fixture.partTime.checked, true)
  assert.equal(fixture.category.getAttribute('data-opp30-selected-values'), '["Email Automation"]')
  assert.equal(fixture.form.resetCount, 0)
  assert.equal(fixture.successTitle.textContent, '')
  assert.equal(bridge.location.href, 'https://example.test/opportunities---create')
})

test('Cancel without a successful create leaves the Create Form draft in place', async () => {
  const fixture = opportunityCreateFormFixture()
  const bridge = await loadCreateFormBridge(fixture, async (request) => {
    const url = String(request)
    if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
    throw new Error(`Unexpected request: ${url}`)
  })

  assert.ok(await waitFor(() => typeof fixture.submit() === 'function'))
  assert.equal(fixture.cancel.getAttribute('type'), 'button')
  fixture.modal.style.display = 'none'
  bridge.dispatchWindow('modal-open', { modal: fixture.modal })

  assert.equal(fixture.title.value, 'V3 canary')
  assert.equal(fixture.partTime.checked, true)
  assert.equal(fixture.estimatedHours.value, '25')
  assert.equal(fixture.category.getAttribute('data-opp30-selected-values'), '["Email Automation"]')
  assert.equal(fixture.chip.getAttribute('aria-selected'), 'true')
  assert.equal(fixture.form.resetCount, 0)
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

test('pending Create submit shows the Spinner and fades only the native control', async () => {
  const { wrap, button, spinner } = buttonWrapFixture({ spinnerDisplay: 'none' })
  const form = el('form', { 'data-opp-form': 'create' }, [wrap])
  const bridge = await loadBridge(async () => response({}), documentWith(form))

  bridge.window.Opp30.setOpportunityActionPending(button, true)

  assert.equal(spinner.style.display, 'flex')
  assert.equal(button.style.opacity, '0.6')
  assert.equal(button.disabled, true)
  assert.equal(button.getAttribute('aria-busy'), 'true')
  assert.equal(button.style.pointerEvents, 'none')
  assert.equal(wrap.style.opacity, undefined)
  assert.equal(wrap.hasAttribute('data-opp-loading'), false)
  assert.equal(button.hasAttribute('data-opp-loading'), false)
})

test('clearing pending hides the Spinner and restores the native control', async () => {
  const { button, spinner } = buttonWrapFixture({ spinnerDisplay: 'none' })
  const bridge = await loadBridge(async () => response({}), documentWith(button.parent))

  bridge.window.Opp30.setOpportunityActionPending(button, true)
  bridge.window.Opp30.setOpportunityActionPending(button, false)

  assert.equal(spinner.style.display, 'none')
  assert.equal(button.style.opacity, undefined)
  assert.equal(button.disabled, false)
  assert.equal(button.getAttribute('aria-busy'), null)
  assert.equal(button.style.pointerEvents, undefined)
})

test('pending Close confirm that is not a submit shows its Spinner and fades the inner native control', async () => {
  const { wrap, button, spinner } = buttonWrapFixture({
    buttonAttrs: { type: 'button' },
    spinnerDisplay: 'none',
    wrapAttrs: { 'data-opp-submit': 'close' },
  })
  const modal = el('div', { 'data-modal-target': 'close-opportunity' }, [wrap])
  const bridge = await loadBridge(async () => response({}), documentWith(modal))

  bridge.window.Opp30.setOpportunityActionPending(wrap, true)

  assert.equal(spinner.style.display, 'flex')
  assert.equal(button.style.opacity, '0.6')
  assert.equal(button.disabled, true)
  assert.equal(button.getAttribute('aria-busy'), 'true')
  assert.equal(wrap.style.opacity, undefined)
  assert.equal(wrap.getAttribute('aria-busy'), 'true')
  assert.equal(wrap.style.pointerEvents, 'none')
  assert.equal(wrap.hasAttribute('data-opp-loading'), false)
})

test('a wrap with no Spinner still disables and never clones one', async () => {
  const button = el('button', { type: 'submit' })
  const wrap = el('div', {}, [button])
  const childCount = wrap.children.length
  const bridge = await loadBridge(async () => response({}), documentWith(wrap))

  bridge.window.Opp30.setOpportunityActionPending(button, true)

  assert.equal(button.disabled, true)
  assert.equal(button.style.opacity, undefined)
  assert.equal(wrap.children.length, childCount)
  assert.equal(
    wrap.querySelector('[data-button-spinner]'),
    null,
  )
  assert.equal(wrap.hasAttribute('data-opp-loading'), false)
})

test('two wraps in one footer: only the action wrap spins', async () => {
  const submit = buttonWrapFixture({
    buttonAttrs: { type: 'submit' },
    spinnerDisplay: 'none',
  })
  const cancel = buttonWrapFixture({
    buttonAttrs: { type: 'button' },
    spinnerDisplay: 'none',
  })
  const footer = el('div', {}, [submit.wrap, cancel.wrap])
  const bridge = await loadBridge(async () => response({}), documentWith(footer))

  bridge.window.Opp30.setOpportunityActionPending(submit.button, true)

  assert.equal(submit.spinner.style.display, 'flex')
  assert.equal(cancel.spinner.style.display, 'none')
  assert.equal(submit.button.style.opacity, '0.6')
  assert.equal(cancel.button.style.opacity, undefined)
  assert.equal(cancel.button.disabled, false)
})

test('a wrap with no Spinner does not steal a neighbour Spinner', async () => {
  const submitButton = el('button', { type: 'submit' })
  const submitWrap = el('div', {}, [submitButton])
  const cancel = buttonWrapFixture({
    buttonAttrs: { type: 'button' },
    spinnerDisplay: 'none',
  })
  const footer = el('div', {}, [submitWrap, cancel.wrap])
  const childCount = footer.children.length
  const bridge = await loadBridge(async () => response({}), documentWith(footer))

  bridge.window.Opp30.setOpportunityActionPending(submitButton, true)

  assert.equal(cancel.spinner.style.display, 'none')
  assert.equal(submitButton.disabled, true)
  assert.equal(submitWrap.style.opacity, undefined)
  assert.equal(footer.children.length, childCount)
  assert.equal(submitWrap.querySelector('[data-button-spinner]'), null)
})

test('binding a wrap force-hides a leftover visible Spinner', async () => {
  const { spinner } = buttonWrapFixture({ spinnerDisplay: 'flex' })
  await loadBridge(async () => response({}), documentWith(spinner.parent))

  assert.equal(spinner.style.display, 'none')
})

test('binding does not hide a Spinner that is not in a Button Wrap', async () => {
  const stray = el('div', { 'data-button-spinner': '' })
  stray.style.display = 'flex'
  await loadBridge(async () => response({}), documentWith(stray))

  assert.equal(stray.style.display, 'flex')
})

test('pending Create on the live Button Wrap shows the nested Spinner and fades text and line', async () => {
  const { wrap, button, spinner, text, line } = productButtonWrapFixture({
    spinnerDisplay: 'none',
    wrapAttrs: {
      class: 'button_main-wrap',
      'data-button-theme': 'black',
      'data-button-style': 'primary',
      'data-opp-submit': 'create',
    },
  })
  const form = el('form', { 'data-opp-form': 'create' }, [wrap])
  const bridge = await loadBridge(async () => response({}), documentWith(form))

  bridge.window.Opp30.setOpportunityActionPending(button, true)

  assert.equal(spinner.style.display, 'flex')
  assert.equal(text.style.opacity, '0.6')
  assert.equal(line.style.opacity, '0.6')
  assert.equal(text.getAttribute('aria-busy'), null)
  assert.equal(line.getAttribute('aria-busy'), null)
  assert.equal(text.style.pointerEvents, undefined)
  assert.equal(line.style.pointerEvents, undefined)
  assert.equal(button.style.opacity, undefined)
  assert.equal(button.disabled, true)
  assert.equal(button.getAttribute('aria-busy'), 'true')
  assert.equal(wrap.style.opacity, undefined)
  assert.equal(spinner.style.opacity, undefined)
  assert.equal(wrap.hasAttribute('data-opp-loading'), false)
})

test('clearing pending on the live Button Wrap restores text, line, and nested Spinner', async () => {
  const { wrap, button, spinner, text, line } = productButtonWrapFixture({
    spinnerDisplay: 'none',
    wrapAttrs: {
      class: 'button_main-wrap',
      'data-button-theme': 'black',
      'data-opp-submit': 'create',
    },
  })
  const form = el('form', { 'data-opp-form': 'create' }, [wrap])
  const bridge = await loadBridge(async () => response({}), documentWith(form))

  bridge.window.Opp30.setOpportunityActionPending(button, true)
  bridge.window.Opp30.setOpportunityActionPending(button, false)

  assert.equal(spinner.style.display, 'none')
  assert.equal(text.style.opacity, undefined)
  assert.equal(line.style.opacity, undefined)
  assert.equal(text.getAttribute('aria-busy'), null)
  assert.equal(button.disabled, false)
  assert.equal(button.getAttribute('aria-busy'), null)
})

test('two live wraps in one footer: only the action wrap spins', async () => {
  const submit = productButtonWrapFixture({
    spinnerDisplay: 'none',
    wrapAttrs: {
      class: 'button_main-wrap',
      'data-button-theme': 'black',
      'data-button-style': 'primary',
      'data-opp-submit': 'create',
    },
  })
  const cancel = productButtonWrapFixture({
    buttonAttrs: { type: 'button' },
    spinnerDisplay: 'none',
    label: 'Cancel',
    wrapAttrs: {
      class: 'button_main-wrap',
      'data-button-theme': 'black',
      'data-button-style': 'tertiary',
    },
  })
  const footer = el('div', { class: 'modal_button-group' }, [cancel.wrap, submit.wrap])
  const form = el('form', { 'data-opp-form': 'create' }, [footer])
  const bridge = await loadBridge(async () => response({}), documentWith(form))

  bridge.window.Opp30.setOpportunityActionPending(submit.button, true)

  assert.equal(submit.spinner.style.display, 'flex')
  assert.equal(cancel.spinner.style.display, 'none')
  assert.equal(submit.text.style.opacity, '0.6')
  assert.equal(cancel.text.style.opacity, undefined)
  assert.equal(cancel.button.disabled, false)
})

test('a live wrap with no Spinner does not steal Cancel’s nested Spinner', async () => {
  const submitButton = el('button', { type: 'submit', class: 'clickable_btn' })
  const submitClickable = el('div', { class: 'clickable_wrap' }, [submitButton])
  const submitText = el('div', { class: 'button_main-text' })
  submitText.textContent = 'Submit'
  const submitElement = el('div', { class: 'button_main-element' }, [submitText])
  const submitWrap = el(
    'div',
    {
      class: 'button_main-wrap',
      'data-button-theme': 'black',
      'data-opp-submit': 'create',
    },
    [submitClickable, submitElement],
  )
  const cancel = productButtonWrapFixture({
    buttonAttrs: { type: 'button' },
    spinnerDisplay: 'none',
    label: 'Cancel',
    wrapAttrs: {
      class: 'button_main-wrap',
      'data-button-theme': 'black',
      'data-button-style': 'tertiary',
    },
  })
  const footer = el('div', { class: 'modal_button-group' }, [cancel.wrap, submitWrap])
  const childCount = footer.children.length
  const form = el('form', { 'data-opp-form': 'create' }, [footer])
  const bridge = await loadBridge(async () => response({}), documentWith(form))

  bridge.window.Opp30.setOpportunityActionPending(submitButton, true)

  assert.equal(cancel.spinner.style.display, 'none')
  assert.equal(submitButton.disabled, true)
  assert.equal(submitText.style.opacity, undefined)
  assert.equal(submitWrap.style.opacity, undefined)
  assert.equal(footer.children.length, childCount)
  assert.equal(submitWrap.querySelector('[data-button-spinner]'), null)
})

test('binding a live wrap force-hides a leftover nested Spinner', async () => {
  const { wrap, spinner } = productButtonWrapFixture({
    spinnerDisplay: 'flex',
    wrapAttrs: {
      class: 'button_main-wrap',
      'data-button-theme': 'black',
      'data-opp-submit': 'create',
    },
  })
  const form = el('form', { 'data-opp-form': 'create' }, [wrap])
  await loadBridge(async () => response({}), documentWith(form))

  assert.equal(spinner.style.display, 'none')
})

// The end-project modal replaces the native prompt/confirm intent capture.
// These cases pin first-action finalization, the required early-end reason,
// the review-timing rule, and the prompt fallback for pages that
// were published before the modal markup shipped.
function endProjectDom(overrides = {}) {
  const end = el('a', { 'wf-xano-link': 'project-end', href: '#' })
  const label = el('div', { class: 'button_main-text' })
  label.textContent = 'End Project'
  const wrap = el('div', { class: 'button_main-wrap' }, [end, label])
  const card = el('div', { class: 'project_item', 'data-wf-xano-id': '675' }, [wrap])
  const title = el('p', { 'data-end-project-title': '' })
  const subtitle = el('p', { 'data-end-project-subtitle': '' })
  const rating = el('input', { name: 'Call-Rating' })
  rating.value = overrides.rating == null ? '5' : overrides.rating
  const feedback = el('textarea', { name: 'Feedback' })
  feedback.value = overrides.feedback == null ? 'Excellent collaboration overall.' : overrides.feedback
  const reviewGroup = el('div', { 'data-end-project-review': '' }, [rating, feedback])
  const reason = el('textarea', { 'data-end-project-reason': '', name: 'End-Reason' })
  reason.value = overrides.reason == null ? '' : overrides.reason
  const reasonWrap = el('div', { 'data-end-project-reason-wrap': '' }, [reason])
  const toggle = el('a', { 'data-end-project-mode-toggle': '', href: '#' })
  const legacySubmit = overrides.legacySubmit === true
  // Mirror the live Clickable Wrap: a bare `clickable_btn` overlay carries
  // type=submit while the visible caption sits in the enclosing wrap.
  const submitText = el(legacySubmit ? 'span' : 'div', legacySubmit
    ? {}
    : { class: 'button_main-text' })
  submitText.textContent = 'End Project and Submit Review'
  const submitIcon = legacySubmit ? el('svg') : null
  const submit = el(
    'button',
    legacySubmit ? { type: 'submit' } : { type: 'submit', class: 'clickable_btn' },
    legacySubmit ? [submitText, submitIcon] : [],
  )
  if (legacySubmit) {
    let directText = ''
    Object.defineProperty(submit, 'textContent', {
      configurable: true,
      get: () => submit.children.length
        ? submit.children.map((child) => child.textContent || '').join('')
        : directText,
      set: (value) => {
        directText = String(value)
        submit.children.forEach((child) => {
          child.parent = null
          child.parentNode = null
        })
        submit.children.length = 0
      },
    })
  }
  const clickableWrap = legacySubmit
    ? null
    : el('div', { class: 'clickable_wrap' }, [submit])
  const submitWrap = legacySubmit
    ? null
    : el('div', { class: 'button_main-wrap' }, [clickableWrap, submitText])
  const form = el(
    'form',
    {},
    [reviewGroup, reasonWrap, toggle, legacySubmit ? submit : submitWrap],
  )
  form.reset = () => {}
  const done = el('div', { class: 'w-form-done' })
  const fail = el('div', { class: 'w-form-fail' })
  const modal = el(
    'dialog',
    { 'data-modal-target': 'end-project' },
    [title, subtitle, form, done, fail],
  )
  const root = el('div', { 'wf-xano-instance': 'dash-brand-projects' }, [card, modal])
  return {
    end, label, wrap, card, title, subtitle, rating, feedback, reviewGroup,
    reason, reasonWrap, toggle, submit, submitText, submitIcon, submitWrap,
    form, done, fail, modal, root,
  }
}

function endProjectBridgeOptions(dom, member, pathname) {
  return {
    member,
    pathname,
    querySelector: (selector) =>
      selectorMatches(dom.root, selector) ? dom.root : dom.root.querySelector(selector),
    querySelectorAll: (selector) =>
      [dom.root, ...descendants(dom.root)].filter((node) => selectorMatches(node, selector)),
    routeGuard: true,
  }
}

test('brand end-project modal completes and submits the review in one pass', async () => {
  const dom = endProjectDom()
  let actionBody = null
  let reviewBody = null
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'active',
            lifecycle_version: 4,
            review_eligible: false,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: {
            id: 675,
            lifecycle_state: 'completed',
            lifecycle_version: 5,
            starter_name: 'JP Test',
          },
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewBody = JSON.parse(init.body)
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  bridge.window.prompt = () => {
    throw new Error('prompt must not run when the modal markup exists')
  }
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project & Review'))
  assert.match(dom.subtitle.textContent, /closes the project now/)
  assert.equal(dom.reviewGroup.style.display, '')
  assert.equal(dom.reasonWrap.style.display, 'none')
  // Ending finalizes on the first action now, so the early-end toggle stays
  // available on an active project instead of being hidden behind a confirm.
  assert.equal(dom.toggle.style.display, '')

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => reviewBody !== null))
  assert.equal(actionBody.action, 'complete')
  assert.equal(actionBody.expected_version, 4)
  assert.equal(reviewBody.project_id, 675)
  assert.equal(reviewBody.rating, 5)
  assert.equal(reviewBody.review_text, 'Excellent collaboration overall.')
})

test('brand termination submits the optional review when it is filled in', async () => {
  const dom = endProjectDom({ reason: 'Scope changed' })
  let actionBody = null
  let reviewCount = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'active',
            lifecycle_version: 4,
            review_eligible: false,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: {
            id: 675,
            lifecycle_state: 'terminated',
            lifecycle_version: 5,
            review_eligible: false,
            has_review: false,
          },
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewCount += 1
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project & Review'))
  bridge.dispatchDocument('click', clickEvent(dom.toggle).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project Early'))

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => dom.label.textContent !== 'End Project'))
  assert.equal(actionBody.action, 'terminate')
  assert.equal(actionBody.reason, 'Scope changed')
  // JP opened reviews to early ends on 2026-09-01, so a filled review posts.
  assert.equal(reviewCount, 1)
  assert.match(dom.label.textContent, /Project ended/)
})

test('starter end-project modal completes without review fields', async () => {
  const dom = endProjectDom()
  let actionBody = null
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'active',
            lifecycle_version: 4,
            brand_name: 'Test Brand',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: { id: 675, lifecycle_state: 'completed', lifecycle_version: 5 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, talentMember, '/starter-dashboard'),
  )
  bridge.window.prompt = () => {
    throw new Error('prompt must not run when the Starter modal markup exists')
  }
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project Early'))
  assert.equal(dom.reviewGroup.style.display, 'none')
  assert.equal(dom.reasonWrap.style.display, '')

  bridge.dispatchDocument('click', clickEvent(dom.toggle).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project & Review'))
  assert.equal(dom.submitText.textContent, 'Mark Work Complete')
  assert.equal(dom.reviewGroup.style.display, 'none')
  assert.equal(dom.reasonWrap.style.display, 'none')

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => actionBody !== null))
  assert.equal(actionBody.action, 'complete')
  assert.equal(actionBody.expected_version, 4)
  assert.equal(actionBody.reason, '')
})

test('early-end mode requires a reason and sends it as the terminate reason', async () => {
  const dom = endProjectDom({ reason: '' })
  let actionBody = null
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'active',
            lifecycle_version: 4,
            review_eligible: false,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: { id: 675, lifecycle_state: 'terminated', lifecycle_version: 5 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project & Review'))

  bridge.dispatchDocument('click', clickEvent(dom.toggle).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project Early'))
  assert.equal(dom.reasonWrap.style.display, '')
  // The review is offered on an early end too now, and stays optional.
  assert.equal(dom.reviewGroup.style.display, '')

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  await new Promise(setImmediate)
  assert.equal(actionBody, null)
  assert.equal(dom.fail.style.display, 'block')

  dom.reason.value = 'Scope changed'
  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => actionBody !== null))
  assert.equal(actionBody.action, 'terminate')
  assert.equal(actionBody.reason, 'Scope changed')
})

test('end-project falls back to prompt when the modal markup is absent', async () => {
  const dom = endProjectDom()
  dom.modal.attributes.delete('data-modal-target')
  let actionBody = null
  let prompted = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'active',
            lifecycle_version: 4,
            review_eligible: false,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: { id: 675, lifecycle_state: 'completed', lifecycle_version: 5 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  bridge.window.prompt = () => {
    prompted += 1
    return 'COMPLETE'
  }
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)

  assert.ok(await waitFor(() => actionBody !== null))
  assert.equal(prompted, 1)
  assert.equal(actionBody.action, 'complete')
})

test('cancel prompt fallback requires and returns the typed ops note', async (t) => {
  const cases = [
    { name: 'cancelled prompt', response: null, expectedReason: null },
    { name: 'empty prompt', response: '   ', expectedReason: null },
    {
      name: 'typed note',
      response: '  Brand changed scope before kickoff  ',
      expectedReason: 'Brand changed scope before kickoff',
    },
  ]

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const dom = endProjectDom()
      dom.modal.attributes.delete('data-modal-target')
      let actionBody = null
      let prompted = 0
      const bridge = await loadBridge(
        async (input, init = {}) => {
          const url = String(input)
          if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
          if (url.includes('/brand/projects/mine')) {
            return response({
              items: [{
                id: 675,
                lifecycle_state: 'pending',
                lifecycle_version: 4,
                has_review: false,
                starter_name: 'JP Test',
              }],
            })
          }
          if (url.includes('/projects/action/v3')) {
            actionBody = JSON.parse(init.body)
            return response({
              project: { id: 675, lifecycle_state: 'canceled', lifecycle_version: 5 },
            })
          }
          throw new Error(`Unexpected request: ${url}`)
        },
        endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
      )
      bridge.window.confirm = () => true
      bridge.window.prompt = () => {
        prompted += 1
        return scenario.response
      }

      assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))
      bridge.dispatchDocument('click', clickEvent(dom.end).event)

      if (scenario.expectedReason) {
        assert.ok(await waitFor(() => actionBody !== null))
        assert.equal(actionBody.action, 'cancel')
        assert.equal(actionBody.reason, scenario.expectedReason)
      } else {
        await new Promise(setImmediate)
        assert.equal(actionBody, null)
      }
      assert.equal(prompted, 1)
    })
  }
})

// A `required` control inside a display:none group still fails constraint
// validation, and the browser cannot focus it to report the error, so the
// real form silently refuses to submit. This reproduces the production
// failure: hiding a group must also drop the constraint, and showing it
// again must restore it.
test('hiding a modal group clears required so the form can still submit', async () => {
  const dom = endProjectDom()
  dom.feedback.required = true
  dom.reason.required = true
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'pending',
            lifecycle_version: 4,
            starter_name: 'JP Test',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  // pending -> the cancel step asks what happened (an ops record, not a
  // review), so the reason group is shown and the review block is hidden.
  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'Cancel Project'))
  assert.equal(dom.reviewGroup.style.display, 'none')
  assert.equal(dom.reasonWrap.style.display, '')
  assert.equal(
    dom.feedback.required,
    false,
    'a hidden required control blocks submit with no visible error',
  )

  // The cancel step shows the reason group, so its constraint is restored and
  // the ops note is genuinely required.
  assert.equal(dom.reason.required, true, 'the cancel reason is required')

  bridge.window.dispatchEvent(
    new bridge.window.CustomEvent('modal-close', { detail: { modal: dom.modal } }),
  )
  await new Promise(setImmediate)

  // starter early-end shows the reason group, which must be required again
  const starterDom = endProjectDom()
  starterDom.reason.required = true
  const starterBridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/starter/projects/mine')) {
        return response({
          items: [{ id: 675, lifecycle_state: 'active', lifecycle_version: 4 }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(starterDom, talentMember, '/starter-dashboard'),
  )
  assert.ok(await waitFor(() => starterDom.end.getAttribute('data-project-action') === 'end'))
  starterBridge.dispatchDocument('click', clickEvent(starterDom.end).event)
  assert.ok(await waitFor(() => starterDom.title.textContent === 'End Project Early'))
  assert.equal(starterDom.reasonWrap.style.display, '')
  assert.equal(starterDom.reason.required, true, 'a visible required control keeps its constraint')
})

// The live Webflow button is a Clickable Wrap: a bare `clickable_btn` overlay
// carries type=submit while the visible caption lives in the enclosing wrap.
// Writing the caption into the overlay renders a second caption on top of the
// real one, which is what shipped and looked like overlapping button text.
test('submit caption paints the wrap label, never the bare submit overlay', async () => {
  const dom = endProjectDom()
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'pending',
            lifecycle_version: 4,
            starter_name: 'JP Test',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'Cancel Project'))

  assert.equal(dom.submitText.textContent, 'Cancel Project')
  assert.notEqual(
    dom.submit.textContent,
    'Cancel Project',
    'the bare submit overlay must not receive the caption or it renders over the real one',
  )
})

test('submit caption preserves legacy plain-button sibling content', async () => {
  const dom = endProjectDom({ legacySubmit: true })
  const bridge = await loadBridge(
    async (input) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'pending',
            lifecycle_version: 4,
            starter_name: 'JP Test',
          }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'Cancel Project'))

  assert.equal(dom.submitText.textContent, 'Cancel Project')
  assert.ok(dom.submit.children.includes(dom.submitIcon))
})

// Five production projects were left in `termination_requested` / `completion_requested`
// by the retired two-sided handshake. They must stay actionable, and a pending
// termination must reuse its recorded reason: Xano #1679 rejects a terminate
// whose reason differs from the one already on file.
test('a project stranded in termination_requested reuses its recorded reason', async () => {
  const dom = endProjectDom()
  let actionBody = null
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'termination_requested',
            lifecycle_version: 4,
            end_reason: 'Test Project End',
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: { id: 675, lifecycle_state: 'terminated', lifecycle_version: 5 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  bridge.window.prompt = () => {
    throw new Error('prompt must not run when the modal markup exists')
  }

  // The card stays actionable rather than showing a waiting lock.
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))
  assert.equal(dom.end.hasAttribute('data-project-action-waiting'), false)

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project Early'))
  assert.match(dom.subtitle.textContent, /Reason already on file: Test Project End/)
  assert.equal(dom.reasonWrap.style.display, 'none')
  assert.equal(dom.toggle.style.display, 'none')

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  assert.ok(await waitFor(() => actionBody !== null))
  assert.equal(actionBody.action, 'terminate')
  assert.equal(actionBody.reason, 'Test Project End')
})

test('prompt fallback for a stranded termination reuses its recorded reason', async () => {
  const dom = endProjectDom()
  dom.modal.attributes.delete('data-modal-target')
  let actionBody = null
  let confirmMessage = ''
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'termination_requested',
            lifecycle_version: 4,
            end_reason: 'Test Project End',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: { id: 675, lifecycle_state: 'terminated', lifecycle_version: 5 },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  bridge.window.confirm = (message) => {
    confirmMessage = message
    return true
  }
  bridge.window.prompt = () => {
    throw new Error('prompt must not replace the reason already on file')
  }

  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))
  bridge.dispatchDocument('click', clickEvent(dom.end).event)

  assert.ok(await waitFor(() => actionBody !== null))
  assert.match(confirmMessage, /Reason already on file: Test Project End/)
  assert.equal(actionBody.action, 'terminate')
  assert.equal(actionBody.reason, 'Test Project End')
})

test('a project stranded in completion_requested stays actionable and submits its review', async () => {
  const dom = endProjectDom()
  let actionBody = null
  let reviewBody = null
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'completion_requested',
            lifecycle_version: 4,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: {
            id: 675,
            lifecycle_state: 'completed',
            lifecycle_version: 5,
            starter_name: 'JP Test',
          },
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewBody = JSON.parse(init.body)
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )

  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))
  assert.equal(dom.end.hasAttribute('data-project-action-waiting'), false)

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project & Review'))

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => reviewBody !== null))
  assert.equal(actionBody.action, 'complete')
  assert.equal(actionBody.reason, '')
  assert.equal(reviewBody.project_id, 675)
  assert.equal(reviewBody.rating, 5)
  assert.equal(reviewBody.review_text, 'Excellent collaboration overall.')
})

// A cancellation captures an internal record of what happened for admin ops
// (JP, 2026-09-01). It is deliberately NOT a review: it must never reach
// core_reviews_v3, /hire, or ranking points. The text rides along as the
// project's cancel reason instead.
test('cancel requires an ops note and sends it as the cancel reason', async () => {
  const dom = endProjectDom({ reason: '' })
  let actionBody = null
  let reviewCount = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'pending',
            lifecycle_version: 4,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: { id: 675, lifecycle_state: 'canceled', lifecycle_version: 5 },
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewCount += 1
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'Cancel Project'))
  // the ops note is asked for; the review block is not offered at all
  assert.equal(dom.reasonWrap.style.display, '')
  assert.equal(dom.reviewGroup.style.display, 'none')

  // an empty note blocks the cancel
  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  await new Promise(setImmediate)
  assert.equal(actionBody, null, 'cancelling without an ops note must be refused')
  assert.match(dom.fail.textContent, /what happened/)

  dom.reason.value = 'Brand changed scope before kickoff'
  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  assert.ok(await waitFor(() => actionBody !== null))
  assert.equal(actionBody.action, 'cancel')
  assert.equal(actionBody.reason, 'Brand changed scope before kickoff')
  assert.equal(reviewCount, 0, 'a cancellation must never post a review')
})

test('a canceled action response discards a carried review intent', async () => {
  const dom = endProjectDom()
  let actionBody = null
  let reviewCount = 0
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'active',
            lifecycle_version: 4,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({
          project: { id: 675, lifecycle_state: 'canceled', lifecycle_version: 5 },
        })
      }
      if (url.includes('/brand/reviews/submit')) {
        reviewCount += 1
        return response({ review_id: 42 })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'),
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'End Project & Review'))
  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })

  assert.ok(await waitFor(() => actionBody !== null))
  assert.ok(await waitFor(() => dom.label.textContent !== 'End Project'))
  assert.equal(actionBody.action, 'complete')
  assert.equal(reviewCount, 0)
})

// Validation failures in the end-project modal carry a diagnostic receipt, and
// the receipt path used to swallow the message: `decorateWorkflowMessage` is
// deliberately inert so diagnostics never overwrite authored Webflow copy, so
// routing our copy through it left the Webflow default on screen and the brand
// saw "Oops! Something went wrong" with no idea what to fix.
test('a validation failure shows our copy, not the Webflow default', async () => {
  const dom = endProjectDom({ reason: '' })
  dom.fail.textContent = 'Oops! Something went wrong while submitting the form.'
  let actionBody = null
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/brand/projects/mine')) {
        return response({
          items: [{
            id: 675,
            lifecycle_state: 'pending',
            lifecycle_version: 4,
            has_review: false,
            starter_name: 'JP Test',
          }],
        })
      }
      if (url.includes('/projects/action/v3')) {
        actionBody = JSON.parse(init.body)
        return response({ project: { id: 675, lifecycle_state: 'canceled' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    // Diagnostics must be ON: without them validationDiagnostic returns null,
    // reviewError takes its plain-text branch, and the bug cannot reproduce.
    { ...endProjectBridgeOptions(dom, paidBrandMember, '/brand-dashboard'), workflowDiagnostics: true },
  )
  assert.ok(await waitFor(() => dom.end.getAttribute('data-project-action') === 'end'))

  bridge.dispatchDocument('click', clickEvent(dom.end).event)
  assert.ok(await waitFor(() => dom.title.textContent === 'Cancel Project'))

  bridge.dispatchDocument('submit', {
    target: dom.form,
    preventDefault() {},
    stopPropagation() {},
  })
  await new Promise(setImmediate)

  assert.equal(actionBody, null, 'an empty ops note must not cancel the project')
  assert.match(dom.fail.textContent, /what happened/)
  assert.doesNotMatch(dom.fail.textContent, /Oops! Something went wrong/)
})
