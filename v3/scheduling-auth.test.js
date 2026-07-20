const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')

const source = fs.readFileSync(require.resolve('./scheduling-auth.js'), 'utf8')

class HeadersMock {
  constructor(init) {
    this.values = new Map()
    if (init instanceof HeadersMock) {
      init.values.forEach((value, key) => this.values.set(key, value))
    } else if (init) {
      Object.entries(init).forEach(([key, value]) => this.set(key, value))
    }
  }
  has(key) {
    return this.values.has(key.toLowerCase())
  }
  get(key) {
    return this.values.get(key.toLowerCase()) || null
  }
  set(key, value) {
    this.values.set(key.toLowerCase(), String(value))
  }
}

class RequestMock {
  constructor(input, init = {}) {
    const prior = input instanceof RequestMock ? input : null
    this.url = prior ? prior.url : String(input)
    this.method = init.method || (prior && prior.method) || 'GET'
    this.body = init.body || (prior && prior.body)
    this.headers = new HeadersMock(init.headers || (prior && prior.headers))
  }
  clone() {
    return new RequestMock(this)
  }
}

async function run() {
  const calls = []
  let schedulingAttempts = 0
  const nativeFetch = async (input) => {
    const request = input instanceof RequestMock ? input : new RequestMock(input)
    calls.push(request)
    if (request.url.includes('/auth/trade-token/v3')) {
      return { ok: true, status: 200, json: async () => ({ authToken: 'xano-token' }) }
    }
    schedulingAttempts += 1
    return { ok: true, status: schedulingAttempts === 1 ? 401 : 200, json: async () => ({}) }
  }

  const listeners = {}
  const window = {
    location: { hostname: 'the-starters-3-0.webflow.io', href: 'https://the-starters-3-0.webflow.io/test' },
    fetch: nativeFetch,
    setTimeout: (fn) => fn(),
    addEventListener: (event, fn) => (listeners[event] = fn),
    $memberstackDom: { getMemberCookie: async () => 'memberstack-token' },
  }
  const context = {
    window,
    location: window.location,
    document: { readyState: 'complete' },
    URL,
    Request: RequestMock,
    Headers: HeadersMock,
    console: { info() {}, warn() {} },
  }
  vm.runInNewContext(source, context)

  assert.equal(window.__tsSchedulingAuthBridge, true)
  assert.equal(typeof window.xanoAuthFetch, 'function')

  const response = await window.xanoAuthFetch(
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/scheduler/configurations/update',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  )
  assert.equal(response.status, 200)
  assert.equal(calls.filter((call) => call.url.includes('/auth/trade-token/v3')).length, 2)
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer xano-token')
  assert.equal(calls[3].headers.get('Authorization'), 'Bearer xano-token')

  const beforeUnrelated = calls.length
  await window.fetch('https://example.com/unrelated')
  assert.equal(calls.length, beforeUnrelated + 1)
  assert.equal(calls.at(-1).headers.has('Authorization'), false)

  const productionWindow = {
    location: { hostname: 'www.thestarters.com', href: 'https://www.thestarters.com/test' },
    fetch: nativeFetch,
  }
  vm.runInNewContext(source, {
    ...context,
    window: productionWindow,
    location: productionWindow.location,
  })
  assert.equal(productionWindow.__tsSchedulingAuthBridge, undefined)

  console.log('scheduling-auth tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
