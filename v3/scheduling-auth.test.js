const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./scheduling-auth.js'), 'utf8')
const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const SCHEDULING_URL = `${XANO_ORIGIN}/api:tCpV3oqd/scheduler/configurations/update`
const LEGACY_STARTER_URL = `${XANO_ORIGIN}/api:tCpV3oqd/starter/get_by_memberstack`

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
      href: `https://${options.hostname || 'the-starters-3-0.webflow.io'}/test`,
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
    Headers,
    Request,
    URL,
    console: { info() {}, warn() {} },
    window,
  })
  return {
    authChange: (member) => (authChange || memberstack.listener)(member),
    memberstack,
    window,
  }
}

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

test('does not install outside V3 Webflow staging', () => {
  const nativeFetch = async () => response({})
  const { window } = loadBridge(nativeFetch, { hostname: 'www.thestarters.com' })

  assert.equal(window.__tsSchedulingAuthBridge, undefined)
  assert.equal(window.xanoAuthFetch, undefined)
  assert.equal(window.fetch, nativeFetch)
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

test('authenticated legacy starter reads preserve POST body and retry once', async () => {
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
  const request = new Request(LEGACY_STARTER_URL, {
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
  authChange({ id: 'member-b' })
  pendingScheduling.resolve(response({}))

  await assert.rejects(firstRequest, (error) => error.code === 'MEMBER_SCOPE_CHANGED')
  const result = await window.xanoAuthFetch(SCHEDULING_URL)
  assert.equal(result.status, 200)
  assert.equal(tradeCount, 2)
})
