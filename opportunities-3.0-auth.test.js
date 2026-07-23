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
  { hostname = 'example.test', member = null, routeGuard = false } = {},
) {
  const documentListeners = new Map()
  let authChange
  const attributes = new Map()
  if (routeGuard) attributes.set('data-route-guard', 'checking')
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
    createElement() {
      return { addEventListener() {}, setAttribute() {}, style: {} }
    },
    documentElement,
    getElementById: () => null,
    head: documentElement,
    querySelector: () => null,
    querySelectorAll: () => [],
    readyState: 'loading',
  }
  const trackCalls = []
  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({ data: member }),
      getMemberCookie: async () => 'memberstack-a',
      onAuthChange(listener) {
        authChange = listener
      },
    },
    StartersTrack: { track: (...args) => trackCalls.push(args) },
    addEventListener() {},
    clearInterval,
    clearTimeout,
    dispatchEvent() {},
    setInterval,
    setTimeout,
  }
  window.fetch = fetch
  window.window = window
  const location = {
    href: `https://${hostname}/all-modals`,
    hostname,
    pathname: '/all-modals',
    search: '',
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
      disconnect() {}
      observe() {}
    },
    Request,
    URL,
    URLSearchParams,
    alert() {},
    console: { error() {}, info() {}, log() {}, warn() {} },
    document,
    fetch: (...args) => window.fetch(...args),
    history: { replaceState() {} },
    location,
    window,
  })
  vm.runInContext(source, context)
  for (const listener of documentListeners.get('DOMContentLoaded') || []) listener()
  await Promise.resolve()
  assert.equal(typeof authChange, 'function')
  return {
    API: window.Opp30.API,
    authChange,
    attributes,
    documentElement,
    fetch: window.fetch,
    location,
    trackCalls,
    window,
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

test('routeGuardActive reflects the html[data-route-guard] stamp', async () => {
  const off = await loadBridge(async () => response({}))
  assert.equal(off.window.Opp30.routeGuardActive(), false)

  const on = await loadBridge(async () => response({}), { routeGuard: true })
  assert.equal(on.window.Opp30.routeGuardActive(), true)
})

test('with the guard active, gateOrRedirect returns the member without a custom-field check or redirect', async () => {
  // Member has NO legacy dashboard custom-fields — legacy path would redirect.
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember,
    routeGuard: true,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, talentMember)
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

test('without the guard, gateByPlan keeps the legacy free-brand redirect', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: freeBrandMember,
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
