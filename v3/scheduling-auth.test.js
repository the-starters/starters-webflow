const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./scheduling-auth.js'), 'utf8')
const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const SCHEDULING_URL = `${XANO_ORIGIN}/api:tCpV3oqd/scheduler/configurations/update/v3`
const V3_STARTER_URL = `${XANO_ORIGIN}/api:tCpV3oqd/starter/get_by_memberstack/v3`
const BRAND_PAYMENT_URLS = [
  `${XANO_ORIGIN}/api:tCpV3oqd/brand/booking/payment-action/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/brand/booking/payment-method-replace/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/brand/payment-method/setup/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/brand/payment-method/set-default/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/brand/payment-methods/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/brand/payment-readiness/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/brand/booking/request/v3`,
]
const PAID_CALL_SETTINGS_URLS = [
  `${XANO_ORIGIN}/api:tCpV3oqd/starter/paid-call-settings/get/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/starter/paid-call-settings/upsert/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/starter/paid-call-settings/disable/v3`,
]
const FREE_CALL_SETTINGS_URLS = [
  `${XANO_ORIGIN}/api:tCpV3oqd/starter/free-call-settings/get/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/starter/free-call-settings/upsert/v3`,
  `${XANO_ORIGIN}/api:tCpV3oqd/starter/free-call-settings/disable/v3`,
]

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fakeClock(initial = 0) {
  let now = initial
  return {
    Date: class extends Date {
      static now() {
        return now
      }
    },
    advance(milliseconds) {
      now += milliseconds
    },
    set(milliseconds) {
      now = milliseconds
    },
  }
}

function requestUrl(request) {
  return typeof request === 'string' ? request : request.url
}

function loadBridge(nativeFetch, options = {}) {
  let authChange
  const memberstack = options.memberstack || {
    getMemberCookie: async () => 'memberstack-a',
    onAuthChange(listener) {
      authChange = listener
    },
  }
  const window = {
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      pathname: options.pathname || '/test',
      href: `https://${options.hostname || 'the-starters-3-0.webflow.io'}${options.pathname || '/test'}`,
    },
    fetch: options.bridgeFetch || nativeFetch,
    setTimeout() {},
  }
  if (options.withoutMemberstack !== true) window.$memberstackDom = memberstack
  if (options.legacyBridge) {
    window.__tsSchedulingAuthBridge = true
    window.__tsSchedulingAuthBridgeOwner = 'opportunities-3.0'
    window.__tsSchedulingAuthOriginalFetch = nativeFetch
  }

  vm.runInNewContext(source, {
    Date: options.Date || Date,
    Headers,
    Request,
    Response,
    URL,
    console: options.console || { info() {}, warn() {} },
    window,
  })
  return {
    authChange: (member) => (authChange || memberstack.listener)(member),
    memberstack,
    window,
  }
}

test('installation logs stay on staging while production still initializes', () => {
  for (const hostname of ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']) {
    const messages = []
    const options = {
      hostname,
      pathname: '/hire/test-starter',
      console: { info: (message) => messages.push(message), warn() {} },
    }
    const result = loadBridge(async () => response({}), options)
    assert.equal(result.window.__tsSchedulingAuthBridgeOwner, 'scheduling-auth')
    assert.deepEqual(messages, hostname === 'the-starters-3-0.webflow.io' ? ['[scheduling-auth] installed on V3 Webflow staging'] : [])
  }
})

test('installs immediately and takes ownership from the opportunities bridge', () => {
  const nativeFetch = async () => response({})
  const legacyFetch = async () => {
    throw new Error('legacy bridge should be replaced')
  }
  const { window } = loadBridge(nativeFetch, {
    bridgeFetch: legacyFetch,
    legacyBridge: true,
    withoutMemberstack: true,
  })

  assert.equal(window.__tsSchedulingAuthBridgeOwner, 'scheduling-auth')
  assert.equal(typeof window.getXanoAuthToken, 'function')
  assert.equal(typeof window.xanoAuthFetch, 'function')
  assert.notEqual(window.fetch, legacyFetch)
})

test('does not install on malformed or nested production Hire paths', () => {
  for (const pathname of ['/hire', '/hire/', '/hire/two/levels', '/hire/Bad_Slug']) {
    const nativeFetch = async () => response({})
    const { window } = loadBridge(nativeFetch, {
      hostname: 'www.thestarters.com',
      pathname,
    })

    assert.equal(window.__tsSchedulingAuthBridge, undefined)
    assert.equal(window.xanoAuthFetch, undefined)
    assert.equal(window.fetch, nativeFetch)
  }
})

test('blocks every scheduling request on the protected production Test profile', async () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const requests = []
    const nativeFetch = async (request) => {
      requests.push(request)
      return response({ native: true })
    }
    const { window } = loadBridge(nativeFetch, {
      hostname,
      pathname: '/hire/jp-dionisio',
    })

    assert.equal(window.__tsSchedulingV3InertRoute, true)
    assert.equal(window.__tsSchedulingAuthBridge, undefined)
    assert.equal(window.xanoAuthFetch, undefined)
    const blocked = await window.fetch(
      `${XANO_ORIGIN}/api:tCpV3oqd/stripe/live/payment_intent/get`,
    )
    assert.equal(blocked.status, 410)
    assert.equal((await blocked.json()).code, 'SCHEDULING_V3_ROUTE_DISABLED')
    await window.fetch('https://example.com/profile-photo.jpg')
    assert.equal(requests.length, 1)
  }
})

test('installs on valid Hire profiles, canonical dashboards, and Edit Profile across both production hosts', () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    for (const pathname of [
      '/hire/jp-testiz-d',
      '/hire/sabina-rahaman',
      '/starter-dashboard',
      '/brand-dashboard',
      '/messages',
      '/starter-edit-profile',
    ]) {
      const nativeFetch = async () => response({})
      const { window } = loadBridge(nativeFetch, { hostname, pathname })

      assert.equal(window.__tsSchedulingAuthBridgeOwner, 'scheduling-auth')
      assert.equal(typeof window.xanoAuthFetch, 'function')
    }
  }
})

test('installs on the V2 production Messages page only, for the signed TalkJS session', () => {
  for (const hostname of ['hirethestarters.com', 'www.hirethestarters.com']) {
    const nativeFetch = async () => response({})
    const { window } = loadBridge(nativeFetch, { hostname, pathname: '/messages' })
    assert.equal(window.__tsSchedulingAuthBridgeOwner, 'scheduling-auth')
    assert.equal(typeof window.getXanoAuthToken, 'function')
    for (const pathname of ['/', '/brand-dashboard', '/hire/jp-dionisio', '/messages/extra']) {
      const other = loadBridge(async () => response({}), { hostname, pathname })
      assert.equal(other.window.__tsSchedulingAuthBridgeOwner, undefined)
      assert.equal(other.window.getXanoAuthToken, undefined)
    }
  }
})

test('authorized scheduling requests pass through without Memberstack', async () => {
  const requests = []
  const nativeFetch = async (request) => {
    requests.push(request)
    return response({})
  }
  const { window } = loadBridge(nativeFetch, { withoutMemberstack: true })

  await window.xanoAuthFetch(SCHEDULING_URL, {
    headers: { Authorization: 'Bearer caller-token' },
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].headers.get('Authorization'), 'Bearer caller-token')
})

test('401 retry preserves a body-bearing Request', async () => {
  const schedulingBodies = []
  let tradeCount = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      tradeCount += 1
      return response({ authToken: `xano-${tradeCount}` })
    }
    schedulingBodies.push(await request.text())
    return response({}, schedulingBodies.length === 1 ? 401 : 200)
  }
  const { window } = loadBridge(nativeFetch)
  const request = new Request(SCHEDULING_URL, { method: 'POST', body: '{"slot":1}' })

  const result = await window.xanoAuthFetch(request)

  assert.equal(result.status, 200)
  assert.deepEqual(schedulingBodies, ['{"slot":1}', '{"slot":1}'])
  assert.equal(tradeCount, 2)
})

test('authenticated V3 starter reads preserve POST body and retry once', async () => {
  const starterBodies = []
  const authHeaders = []
  let tradeCount = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      tradeCount += 1
      return response({ authToken: `xano-${tradeCount}` })
    }
    starterBodies.push(await request.text())
    authHeaders.push(request.headers.get('Authorization'))
    return response(null, starterBodies.length === 1 ? 401 : 200)
  }
  const { window } = loadBridge(nativeFetch)
  const request = new Request(V3_STARTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member_id: 'member-a' }),
  })

  const result = await window.xanoAuthFetch(request)

  assert.equal(result.status, 200)
  assert.deepEqual(starterBodies, [
    '{"member_id":"member-a"}',
    '{"member_id":"member-a"}',
  ])
  assert.deepEqual(authHeaders, ['Bearer xano-1', 'Bearer xano-2'])
  assert.equal(tradeCount, 2)
})

test('paid-call Brand payment endpoints receive the shared Bearer token', async () => {
  const requests = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-brand-payment' })
    }
    requests.push(request)
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  for (const url of BRAND_PAYMENT_URLS) {
    await window.xanoAuthFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  }

  assert.equal(requests.length, BRAND_PAYMENT_URLS.length)
  for (const request of requests) {
    assert.equal(request.headers.get('Authorization'), 'Bearer xano-brand-payment')
  }
})

test('paid-call Brand payment lookalike paths are not authenticated', async () => {
  let tradeCount = 0
  let receivedRequest
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) tradeCount += 1
    receivedRequest = request
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  await window.xanoAuthFetch(BRAND_PAYMENT_URLS[0] + '-debug', {
    method: 'POST',
    body: '{}',
  })

  assert.equal(tradeCount, 0)
  assert.equal(receivedRequest.headers.has('Authorization'), false)
})

test('paid-call settings endpoints receive the shared Bearer token', async () => {
  const requests = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-paid-call-settings' })
    }
    requests.push(request)
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  for (const url of PAID_CALL_SETTINGS_URLS) {
    await window.xanoAuthFetch(url, { method: 'POST', body: '{}' })
  }

  assert.equal(requests.length, PAID_CALL_SETTINGS_URLS.length)
  for (const request of requests) {
    assert.equal(request.headers.get('Authorization'), 'Bearer xano-paid-call-settings')
  }
})

test('paid-call settings lookalike paths are not authenticated', async () => {
  let tradeCount = 0
  let receivedRequest
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) tradeCount += 1
    receivedRequest = request
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  await window.xanoAuthFetch(PAID_CALL_SETTINGS_URLS[0] + '-debug')

  assert.equal(tradeCount, 0)
  assert.equal(receivedRequest.headers.has('Authorization'), false)
})

test('free-call settings endpoints receive the shared Bearer token', async () => {
  const requests = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-free-call-settings' })
    }
    requests.push(request)
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  for (const url of FREE_CALL_SETTINGS_URLS) {
    await window.xanoAuthFetch(url, { method: 'POST', body: '{}' })
  }

  assert.equal(requests.length, FREE_CALL_SETTINGS_URLS.length)
  for (const request of requests) {
    assert.equal(request.headers.get('Authorization'), 'Bearer xano-free-call-settings')
  }
})

test('free-call settings lookalike paths are not authenticated', async () => {
  let tradeCount = 0
  let receivedRequest
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) tradeCount += 1
    receivedRequest = request
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  await window.xanoAuthFetch(FREE_CALL_SETTINGS_URLS[0] + '-debug')

  assert.equal(tradeCount, 0)
  assert.equal(receivedRequest.headers.has('Authorization'), false)
})

test('does not authenticate lookalike V3 starter paths', async () => {
  let tradeCount = 0
  let receivedRequest
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) tradeCount += 1
    receivedRequest = request
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  await window.xanoAuthFetch(`${V3_STARTER_URL}_debug`)

  assert.equal(tradeCount, 0)
  assert.equal(receivedRequest.headers.has('Authorization'), false)
})

test('network failures are not replayed without authorization', async () => {
  let schedulingCalls = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-a' })
    }
    schedulingCalls += 1
    throw new Error('network failed')
  }
  const { window } = loadBridge(nativeFetch)

  await assert.rejects(window.fetch(SCHEDULING_URL), /network failed/)
  assert.equal(schedulingCalls, 1)
})

test('failed token refresh preserves the original 401 response', async () => {
  let tradeCount = 0
  let schedulingCalls = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      tradeCount += 1
      return tradeCount === 1
        ? response({ authToken: 'xano-a' })
        : response({ message: 'trade failed' }, 500)
    }
    schedulingCalls += 1
    return response({}, 401)
  }
  const { window } = loadBridge(nativeFetch)

  const result = await window.fetch(SCHEDULING_URL)

  assert.equal(result.status, 401)
  assert.equal(tradeCount, 2)
  assert.equal(schedulingCalls, 1)
})

test('legacy wrapper falls back only when initial token acquisition fails', async () => {
  let schedulingCalls = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) return response({}, 500)
    schedulingCalls += 1
    assert.equal(request.headers.has('Authorization'), false)
    return response({}, 401)
  }
  const { window } = loadBridge(nativeFetch)

  const result = await window.fetch(SCHEDULING_URL)

  assert.equal(result.status, 401)
  assert.equal(schedulingCalls, 1)
  await assert.rejects(window.xanoAuthFetch(SCHEDULING_URL), /token trade failed/)
  assert.equal(schedulingCalls, 1)
})

test('availability-writer endpoints are authenticated', async () => {
  const WRITER_PATHS = [
    '/api:tCpV3oqd/starter/update_availability/v3',
    '/api:tCpV3oqd/starter/set_timezone/v3',
    '/api:tCpV3oqd/starter/clear_calendar_data/v3',
    '/api:tCpV3oqd/grants/oauth/v3',
    '/api:tCpV3oqd/grants/create_virtual_account/v3',
    '/api:tCpV3oqd/grants/create_virtual_calendar/v3',
    '/api:tCpV3oqd/grants/add_virtual/v3',
    '/api:tCpV3oqd/grants/add/v3',
    '/api:tCpV3oqd/grants/delete/v3',
    '/api:tCpV3oqd/nylas_configurations/get_all/v3',
  ]
  const authHeaders = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-a' })
    }
    authHeaders.push(request.headers.get('Authorization'))
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  for (const path of WRITER_PATHS) {
    await window.xanoAuthFetch(XANO_ORIGIN + path, { method: 'POST', body: '{}' })
  }

  assert.equal(authHeaders.length, WRITER_PATHS.length)
  for (const header of authHeaders) assert.equal(header, 'Bearer xano-a')
})

test('non-stage staging consumers retain their previous legacy auth coverage', async () => {
  const LEGACY_PATHS = [
    '/api:tCpV3oqd/calendars/get_availabilities',
    '/api:tCpV3oqd/scheduler/configurations/create',
    '/api:tCpV3oqd/scheduler/configurations/delete',
    '/api:tCpV3oqd/scheduler/configurations/get_all',
    '/api:tCpV3oqd/scheduler/configurations/update',
    '/api:tCpV3oqd/scheduler/configurations/update_v2',
    '/api:tCpV3oqd/starter/get_by_memberstack',
  ]
  const authHeaders = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-a' })
    }
    authHeaders.push(request.headers.get('Authorization'))
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  for (const path of LEGACY_PATHS) {
    await window.xanoAuthFetch(XANO_ORIGIN + path, { method: 'POST', body: '{}' })
  }

  assert.equal(authHeaders.length, LEGACY_PATHS.length)
  for (const header of authHeaders) assert.equal(header, 'Bearer xano-a')
})

test('writer endpoint list does not blanket-authenticate the scheduling group', async () => {
  let tradeCount = 0
  let receivedRequest
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) tradeCount += 1
    receivedRequest = request
    return response({})
  }
  const { window } = loadBridge(nativeFetch)

  await window.xanoAuthFetch(`${XANO_ORIGIN}/api:tCpV3oqd/booking_record/get`, {
    method: 'POST',
    body: '{}',
  })

  assert.equal(tradeCount, 0)
  assert.equal(receivedRequest.headers.has('Authorization'), false)
})

test('auth changes invalidate cache and in-flight scheduling responses', async () => {
  let memberstackToken = 'memberstack-a'
  let tradeCount = 0
  const pendingScheduling = deferred()
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      tradeCount += 1
      return response({ authToken: `xano-${tradeCount}` })
    }
    if (tradeCount === 1) return pendingScheduling.promise
    return response({})
  }
  const memberstack = {
    getMemberCookie: async () => memberstackToken,
    onAuthChange(listener) {
      this.listener = listener
    },
  }
  const { authChange, window } = loadBridge(nativeFetch, { memberstack })
  const firstRequest = window.xanoAuthFetch(SCHEDULING_URL)
  await new Promise(setImmediate)

  memberstackToken = 'memberstack-b'
  authChange(null)
  pendingScheduling.resolve(response({}))

  await assert.rejects(firstRequest, (error) => error.code === 'MEMBER_SCOPE_CHANGED')
  const result = await window.xanoAuthFetch(SCHEDULING_URL)
  assert.equal(result.status, 200)
  assert.equal(tradeCount, 2)
})

test('a transient null auth change preserves an in-flight owner request', async () => {
  const pendingScheduling = deferred()
  let tradeCount = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      tradeCount += 1
      return response({ authToken: 'xano-a' })
    }
    return pendingScheduling.promise
  }
  const memberstack = {
    getMemberCookie: async () => 'memberstack-a',
    onAuthChange(listener) {
      this.listener = listener
    },
  }
  const { authChange, window } = loadBridge(nativeFetch, { memberstack })
  const scopeBefore = await window.__tsSchedulingAuthGetScope()
  const request = window.xanoAuthFetch(SCHEDULING_URL)
  await new Promise(setImmediate)

  await authChange(null)
  pendingScheduling.resolve(response({}))

  assert.equal((await request).status, 200)
  assert.equal(await window.__tsSchedulingAuthGetScope(), scopeBefore)
  assert.equal(tradeCount, 1)
})

test('a request queued behind cookie reconciliation uses the new generation', async () => {
  for (const fetchName of ['xanoAuthFetch', 'fetch']) {
    let memberstackToken = 'memberstack-a'
    let tradeCount = 0
    const nativeFetch = async (request) => {
      if (requestUrl(request).includes('/auth/trade-token/v3')) {
        tradeCount += 1
        return response({ authToken: `xano-${tradeCount}` })
      }
      return response({})
    }
    const memberstack = {
      getMemberCookie: async () => memberstackToken,
      onAuthChange(listener) {
        this.listener = listener
      },
    }
    const { authChange, window } = loadBridge(nativeFetch, { memberstack })
    await window.__tsSchedulingAuthGetScope()

    memberstackToken = 'memberstack-b'
    const reconciliation = authChange({ id: 'member-a' })
    const request = window[fetchName](SCHEDULING_URL)

    assert.equal((await request).status, 200)
    await reconciliation
    assert.equal(tradeCount, 2)
  }
})

test('an expected owner scope blocks stale POST dispatch after cookie rotation', async () => {
  let memberstackToken = 'memberstack-a'
  const dispatchedBodies = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: `xano-${memberstackToken}` })
    }
    dispatchedBodies.push(await request.text())
    return response({})
  }
  const memberstack = {
    getMemberCookie: async () => memberstackToken,
    onAuthChange(listener) {
      this.listener = listener
    },
  }
  const { authChange, window } = loadBridge(nativeFetch, { memberstack })
  const expectedScope = await window.__tsSchedulingAuthGetScope()

  memberstackToken = 'memberstack-b'
  const reconciliation = authChange({ id: 'member-a' })
  const staleWrite = window.__tsSchedulingAuthFetch(SCHEDULING_URL, {
    method: 'POST',
    body: JSON.stringify({ duration: 60 }),
  }, expectedScope)

  await assert.rejects(staleWrite, (error) => error.code === 'MEMBER_SCOPE_CHANGED')
  await reconciliation
  assert.deepEqual(dispatchedBodies, [])

  const currentScope = await window.__tsSchedulingAuthGetScope()
  const currentWrite = await window.__tsSchedulingAuthFetch(SCHEDULING_URL, {
    method: 'POST',
    body: JSON.stringify({ duration: 60 }),
  }, currentScope)
  assert.equal(currentWrite.status, 200)
  assert.deepEqual(dispatchedBodies, [JSON.stringify({ duration: 60 })])
})

test('cookie rotation changes scope after a failed refresh clears token fields', async () => {
  let memberstackToken = 'memberstack-a'
  let tradeCount = 0
  const dispatchedBodies = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      tradeCount += 1
      return tradeCount === 2
        ? response({ message: 'unavailable' }, 503)
        : response({ authToken: `xano-${memberstackToken}` })
    }
    const body = await request.text()
    if (body) dispatchedBodies.push(body)
    return response({}, 401)
  }
  const memberstack = {
    getMemberCookie: async () => memberstackToken,
    onAuthChange(listener) {
      this.listener = listener
    },
  }
  const { authChange, window } = loadBridge(nativeFetch, { memberstack })
  const memberAScope = await window.__tsSchedulingAuthGetScope()
  assert.equal((await window.__tsSchedulingAuthFetch(SCHEDULING_URL)).status, 401)

  memberstackToken = 'memberstack-b'
  const reconciliation = authChange({ id: 'member-b' })
  const staleWrite = window.__tsSchedulingAuthFetch(SCHEDULING_URL, {
    method: 'POST',
    body: JSON.stringify({ owner: 'member-a' }),
  }, memberAScope)

  await assert.rejects(staleWrite, (error) => error.code === 'MEMBER_SCOPE_CHANGED')
  await reconciliation
  assert.deepEqual(dispatchedBodies, [])
})

test('reconciliation queued during token lookup blocks dispatch', async () => {
  let memberstackToken = 'memberstack-a'
  let cookieReads = 0
  const dispatchedBodies = []
  const memberstack = {
    async getMemberCookie() {
      cookieReads += 1
      if (cookieReads === 3) {
        memberstackToken = 'memberstack-b'
        this.listener({ id: 'member-b' })
        return 'memberstack-a'
      }
      return memberstackToken
    },
    onAuthChange(listener) {
      this.listener = listener
    },
  }
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-a' })
    }
    dispatchedBodies.push(await request.text())
    return response({})
  }
  const { window } = loadBridge(nativeFetch, { memberstack })
  const memberAScope = await window.__tsSchedulingAuthGetScope()

  const staleWrite = window.__tsSchedulingAuthFetch(SCHEDULING_URL, {
    method: 'POST',
    body: JSON.stringify({ owner: 'member-a' }),
  }, memberAScope)

  await assert.rejects(staleWrite, (error) => error.code === 'MEMBER_SCOPE_CHANGED')
  assert.deepEqual(dispatchedBodies, [])
})

function countingFetch() {
  const calls = []
  const nativeFetch = async (request) => {
    const url = requestUrl(request)
    if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-1' })
    const body = await request.text()
    calls.push({ url, method: request.method, body })
    return response({ n: calls.length })
  }
  return { calls, nativeFetch }
}

const PAID_GET = `${XANO_ORIGIN}/api:tCpV3oqd/starter/paid-call-settings/get/v3`
const PAID_UPSERT = `${XANO_ORIGIN}/api:tCpV3oqd/starter/paid-call-settings/upsert/v3`
const FREE_GET = `${XANO_ORIGIN}/api:tCpV3oqd/starter/free-call-settings/get/v3`
const STRIPE_CONNECT_STATUS = `${XANO_ORIGIN}/api:KZf7nFnk/stripe_connect/status/v3`

test('concurrent and repeated identical reads share one network response', async () => {
  const { calls, nativeFetch } = countingFetch()
  const { window } = loadBridge(nativeFetch)

  const [a, b] = await Promise.all([window.xanoAuthFetch(PAID_GET), window.xanoAuthFetch(PAID_GET)])
  const c = await window.xanoAuthFetch(PAID_GET)

  assert.equal(calls.length, 1)
  assert.deepEqual(await a.json(), { n: 1 })
  assert.deepEqual(await b.json(), { n: 1 })
  assert.deepEqual(await c.json(), { n: 1 })
})

test('pending Xano reads stay shared and receive a full TTL after settlement', async () => {
  const clock = fakeClock()
  const readGate = deferred()
  const readStarted = deferred()
  let calls = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-1' })
    }
    calls += 1
    const callNumber = calls
    readStarted.resolve()
    await readGate.promise
    return response({ n: callNumber })
  }
  const { window } = loadBridge(nativeFetch, { Date: clock.Date })

  const first = window.xanoAuthFetch(PAID_GET)
  await readStarted.promise
  clock.advance(6000)
  const second = window.xanoAuthFetch(PAID_GET)
  for (let step = 0; step < 6; step += 1) await Promise.resolve()
  readGate.resolve()
  const [firstResponse, secondResponse] = await Promise.all([first, second])
  const immediate = await window.xanoAuthFetch(PAID_GET)
  clock.advance(4999)
  const beforeExpiry = await window.xanoAuthFetch(PAID_GET)
  clock.advance(1)
  const atExpiry = await window.xanoAuthFetch(PAID_GET)

  assert.equal(calls, 2)
  assert.deepEqual(await firstResponse.json(), { n: 1 })
  assert.deepEqual(await secondResponse.json(), { n: 1 })
  assert.deepEqual(await immediate.json(), { n: 1 })
  assert.deepEqual(await beforeExpiry.json(), { n: 1 })
  assert.deepEqual(await atExpiry.json(), { n: 2 })
})

test('later shared reads prune expired Xano entries', async (t) => {
  const scenarios = [
    {
      name: 'Xano access',
      access({ window }) {
        return window.xanoAuthFetch(FREE_GET)
      },
    },
    {
      name: 'Memberstack access',
      access({ memberstack }) {
        return memberstack.getCurrentMember()
      },
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const clock = fakeClock()
      const calls = []
      const memberstack = {
        getMemberCookie: async () => 'memberstack-a',
        onAuthChange() {},
        getCurrentMember: async () => ({ data: { id: 'member-a' } }),
      }
      const nativeFetch = async (request) => {
        const url = requestUrl(request)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-1' })
        calls.push(url)
        return response({ n: calls.length })
      }
      const bridge = loadBridge(nativeFetch, { Date: clock.Date, memberstack })

      await bridge.window.xanoAuthFetch(PAID_GET)
      clock.set(6000)
      await scenario.access(bridge)
      clock.set(1)
      const refreshed = await bridge.window.xanoAuthFetch(PAID_GET)

      assert.equal(calls.filter((url) => url === PAID_GET).length, 2)
      assert.deepEqual(await refreshed.json(), {
        n: scenario.name === 'Xano access' ? 3 : 2,
      })
    })
  }
})

test('reads with different bodies or URLs are not shared', async () => {
  const { calls, nativeFetch } = countingFetch()
  const { window } = loadBridge(nativeFetch)
  const post = (member) =>
    window.xanoAuthFetch(V3_STARTER_URL, { method: 'POST', body: JSON.stringify({ member_id: member }) })

  await Promise.all([post('member-a'), post('member-b'), post('member-a')])
  await window.xanoAuthFetch(PAID_GET)
  await window.xanoAuthFetch(`${XANO_ORIGIN}/api:tCpV3oqd/starter/free-call-settings/get/v3`)

  assert.equal(calls.length, 4)
})

test('a write clears shared reads so the next read is fresh', async () => {
  const { calls, nativeFetch } = countingFetch()
  const { window } = loadBridge(nativeFetch)

  await window.xanoAuthFetch(PAID_GET)
  await window.xanoAuthFetch(PAID_UPSERT, { method: 'POST', body: '{}' })
  const after = await window.xanoAuthFetch(PAID_GET)

  assert.equal(calls.length, 3)
  assert.deepEqual(await after.json(), { n: 3 })
})

test('authenticated Xano pass-throughs clear shared reads before and after dispatch', async (t) => {
  const scenarios = [
    {
      name: 'preauthorized xanoAuthFetch request',
      requestUrl: PAID_UPSERT,
      dispatch(window) {
        return window.xanoAuthFetch(PAID_UPSERT, {
          method: 'POST',
          headers: { Authorization: 'Bearer caller-token' },
          body: '{}',
        })
      },
    },
    {
      name: 'non-scheduling window.fetch request',
      requestUrl: STRIPE_CONNECT_STATUS,
      dispatch(window) {
        return window.fetch(STRIPE_CONNECT_STATUS, {
          method: 'POST',
          headers: { Authorization: 'Bearer caller-token' },
          body: '{}',
        })
      },
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const passThroughGate = deferred()
      const calls = []
      const nativeFetch = async (request) => {
        const url = requestUrl(request)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-1' })
        calls.push(url)
        if (url !== PAID_GET) await passThroughGate.promise
        return response({ n: calls.length })
      }
      const { window } = loadBridge(nativeFetch)

      const initial = await window.xanoAuthFetch(PAID_GET)
      const passThrough = scenario.dispatch(window)
      const during = await window.xanoAuthFetch(PAID_GET)
      passThroughGate.resolve()
      await passThrough
      const after = await window.xanoAuthFetch(PAID_GET)

      assert.deepEqual(calls, [PAID_GET, scenario.requestUrl, PAID_GET, PAID_GET])
      assert.deepEqual(await initial.json(), { n: 1 })
      assert.deepEqual(await during.json(), { n: 3 })
      assert.deepEqual(await after.json(), { n: 4 })
    })
  }
})

test('failed reads are not shared and a session change drops shared reads', async () => {
  let status = 500
  const calls = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) return response({ authToken: 'xano-1' })
    calls.push(requestUrl(request))
    return response({ ok: status === 200 }, status)
  }
  const memberstack = { getMemberCookie: async () => 'memberstack-a', onAuthChange() {} }
  const { window } = loadBridge(nativeFetch, { memberstack })

  assert.equal((await window.xanoAuthFetch(PAID_GET)).status, 500)
  status = 200
  assert.equal((await window.xanoAuthFetch(PAID_GET)).status, 200)
  await window.xanoAuthFetch(PAID_GET)
  assert.equal(calls.length, 2)

  memberstack.getMemberCookie = async () => 'memberstack-b'
  await window.xanoAuthFetch(PAID_GET)
  assert.equal(calls.length, 3)
})

test('shared reads honor each caller expected scope', async () => {
  const { nativeFetch } = countingFetch()
  const { window } = loadBridge(nativeFetch)
  const scope = await window.__tsSchedulingAuthGetScope()

  await window.xanoAuthFetch(PAID_GET, undefined, scope)
  await assert.rejects(window.xanoAuthFetch(PAID_GET, undefined, {}), { code: 'MEMBER_SCOPE_CHANGED' })
})

function memberstackWithCounter(extra = {}) {
  const state = { reads: 0, listeners: [], gate: null }
  const memberstack = {
    getMemberCookie: async () => 'memberstack-a',
    onAuthChange(listener) {
      state.listeners.push(listener)
    },
    async getCurrentMember() {
      state.reads += 1
      if (state.gate) await state.gate.promise
      return { data: { id: `member-${state.reads}` } }
    },
    async updateMember() {
      return { data: {} }
    },
    ...extra,
  }
  return { memberstack, state }
}

test('overlapping getCurrentMember calls share one Memberstack request', async () => {
  const { memberstack, state } = memberstackWithCounter()
  state.gate = deferred()
  loadBridge(async () => response({}), { memberstack })

  const calls = [memberstack.getCurrentMember(), memberstack.getCurrentMember(), memberstack.getCurrentMember()]
  state.gate.resolve()
  const results = await Promise.all(calls)

  assert.equal(state.reads, 1)
  assert.deepEqual(results.map((r) => r.data.id), ['member-1', 'member-1', 'member-1'])
})

test('getCurrentMember is not cached after it settles or across different arguments', async () => {
  const { memberstack, state } = memberstackWithCounter()
  loadBridge(async () => response({}), { memberstack })

  await memberstack.getCurrentMember()
  await memberstack.getCurrentMember()
  state.gate = deferred()
  const a = memberstack.getCurrentMember({ x: 1 })
  const b = memberstack.getCurrentMember({ x: 2 })
  state.gate.resolve()
  await Promise.all([a, b])

  assert.equal(state.reads, 4)
})

test('every non-read Memberstack method invalidates before and after settlement', async () => {
  const mutationGate = deferred()
  let mutations = 0
  const { memberstack, state } = memberstackWithCounter({
    disconnectProvider() {
      mutations += 1
      return mutationGate.promise
    },
  })
  state.gate = deferred()
  loadBridge(async () => response({}), { memberstack })

  const before = memberstack.getCurrentMember()
  const mutation = memberstack.disconnectProvider('google')
  const during = memberstack.getCurrentMember()
  assert.equal(state.reads, 2)
  mutationGate.resolve()
  await mutation
  const after = memberstack.getCurrentMember()
  assert.equal(state.reads, 3)
  state.gate.resolve()
  await Promise.all([before, during, after])

  assert.equal(mutations, 1)
})

test('Memberstack read methods preserve an overlapping member request', async () => {
  const { memberstack, state } = memberstackWithCounter()
  state.gate = deferred()
  loadBridge(async () => response({}), { memberstack })

  const before = memberstack.getCurrentMember()
  await memberstack.getMemberCookie()
  memberstack.onAuthChange(function () {})
  const after = memberstack.getCurrentMember()
  state.gate.resolve()
  await Promise.all([before, after])

  assert.equal(state.reads, 1)
})

test('cookie rotation prevents a new member joining an older getCurrentMember request', async () => {
  let cookie = 'memberstack-a'
  let reads = 0
  const memberAGate = deferred()
  const memberstack = {
    getMemberCookie: async () => cookie,
    onAuthChange() {},
    getCurrentMember() {
      reads += 1
      const memberId = cookie === 'memberstack-a' ? 'member-a' : 'member-b'
      if (memberId === 'member-a') {
        return memberAGate.promise.then(() => ({ data: { id: memberId } }))
      }
      return Promise.resolve({ data: { id: memberId } })
    },
  }
  const nativeFetch = async (request) =>
    requestUrl(request).includes('/auth/trade-token/v3')
      ? response({ authToken: `xano-${cookie}` })
      : response({})
  const { window } = loadBridge(nativeFetch, { memberstack })

  await window.__tsSchedulingAuthGetScope()
  const memberA = memberstack.getCurrentMember()
  cookie = 'memberstack-b'
  await window.xanoAuthFetch(PAID_GET)
  let memberB
  try {
    memberB = memberstack.getCurrentMember()
    assert.equal(reads, 2)
  } finally {
    memberAGate.resolve()
  }
  const [memberAResult, memberBResult] = await Promise.all([memberA, memberB])

  assert.equal(memberAResult.data.id, 'member-a')
  assert.equal(memberBResult.data.id, 'member-b')
})

test('a Memberstack write or auth change stops later reads joining an older request', async () => {
  const { memberstack, state } = memberstackWithCounter()
  loadBridge(async () => response({}), { memberstack })

  state.gate = deferred()
  const before = memberstack.getCurrentMember()
  await memberstack.updateMember({ customFields: { a: 1 } })
  const afterWrite = memberstack.getCurrentMember()
  state.listeners.forEach((listener) => listener({}))
  const afterAuth = memberstack.getCurrentMember()
  state.gate.resolve()
  await Promise.all([before, afterWrite, afterAuth])

  assert.equal(state.reads, 3)
})

test('auth change has one owner and clears member reads before cookie reconciliation', async () => {
  const cookieGate = deferred()
  const { memberstack, state } = memberstackWithCounter({
    getMemberCookie() {
      return cookieGate.promise
    },
  })
  state.gate = deferred()
  loadBridge(async () => response({}), { memberstack })

  const before = memberstack.getCurrentMember()
  const reconciliation = state.listeners[state.listeners.length - 1]({})
  const after = memberstack.getCurrentMember()
  cookieGate.resolve('memberstack-a')
  state.gate.resolve()
  await Promise.all([before, after, reconciliation])

  assert.equal(state.listeners.length, 1)
  assert.equal(state.reads, 2)
})
