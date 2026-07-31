const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./starter-dashboard-stripe-connect.js')

const ELEMENT_ATTR = 'data-stripe-connect-element'
const selector = (name) => '[' + ELEMENT_ATTR + '="' + name + '"]'

class FakeElement {
  constructor() {
    this.attributes = new Map()
    this.children = new Map()
    this.hidden = false
    this.style = {}
  }

  querySelector(value) {
    return this.children.get(value) || null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.get(name) || null
  }
}

function stripeRoot() {
  const root = new FakeElement()
  const states = Object.fromEntries(
    ['loading', 'disconnected', 'incomplete', 'ready', 'review', 'error'].map(
      (name) => [name, new FakeElement()],
    ),
  )
  Object.entries(states).forEach(([name, element]) => {
    root.children.set(selector(name), element)
  })
  return { root, states }
}

function response(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    json: async () => body,
  }
}

test('dashboard view uses canonical connected and charges-enabled state', () => {
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: false },
      false,
    ),
    'disconnected',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: false },
      false,
    ),
    'incomplete',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: true },
      false,
    ),
    'ready',
  )
})

test('a Stripe return with charges still disabled renders under review', () => {
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: false },
      true,
    ),
    'review',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: false },
      true,
    ),
    'review',
  )
})

test('rendering selects authored state without changing its copy', () => {
  const { root, states } = stripeRoot()
  states.review.textContent = 'Stripe is reviewing your account.'

  api.setView(root, 'review')

  assert.equal(states.review.style.display, '')
  assert.equal(states.loading.style.display, 'none')
  assert.equal(states.error.style.display, 'none')
  assert.equal(states.review.textContent, 'Stripe is reviewing your account.')
  assert.equal(root.getAttribute('data-stripe-connect-status'), 'review')
  assert.equal(root.getAttribute('data-stripe-connect-view'), 'review')
})

function stripeRequest(requests, path) {
  return requests.find((request) => String(request.url).includes(path))
}

test('status reads Xano with a Bearer token and no client-supplied member id', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({ connected: true, charges_enabled: true, synced_at: 123 })
  }

  try {
    const status = await api.fetchStatus()
    assert.equal(status.charges_enabled, true)
    const statusRequest = stripeRequest(requests, '/stripe_connect/status/v3')
    assert.equal(
      statusRequest.url,
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/stripe_connect/status/v3',
    )
    assert.equal(statusRequest.options.method, 'POST')
    assert.match(
      statusRequest.options.headers.Authorization,
      /^Bearer .+/,
    )
    assert.deepEqual(JSON.parse(statusRequest.options.body), {})
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
  }
})

test('start sends the dashboard return URL and accepts Stripe URLs only', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }

  try {
    const result = await api.startConnect(
      'https://thestarters.com/starter-dashboard',
    )
    assert.equal(result.mode, 'oauth')
    const startRequest = stripeRequest(requests, '/stripe_connect/start/v3')
    assert.match(startRequest.options.headers.Authorization, /^Bearer .+/)
    assert.deepEqual(JSON.parse(startRequest.options.body), {
      return_url: 'https://thestarters.com/starter-dashboard',
    })
    assert.equal(api.isStripeUrl(result.url), true)
    assert.equal(api.isStripeUrl('https://evil.example/stripe'), false)
    assert.equal(api.isStripeUrl('javascript:alert(1)'), false)
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
  }
})

test('callback strips OAuth params and exchanges for the live member session', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { root, states } = stripeRoot()
  const requests = []
  const historyCalls = []
  const assigned = []

  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = {
    replaceState: (...args) => historyCalls.push(args),
  }
  global.location = {
    href: 'https://thestarters.com/stripe-connect-callback?code=code-123&state=mem-live',
    origin: 'https://thestarters.com',
    assign: (url) => assigned.push(url),
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({ connected: true, charges_enabled: false })
  }

  try {
    const result = await api.mountCallback()
    assert.equal(result.connected, true)
    const exchangeRequest = stripeRequest(
      requests,
      '/stripe_connect/oauth_exchange/v3',
    )
    assert.match(exchangeRequest.options.headers.Authorization, /^Bearer .+/)
    assert.deepEqual(JSON.parse(exchangeRequest.options.body), {
      code: 'code-123',
    })
    assert.equal(historyCalls.length, 1)
    assert.equal(
      historyCalls[0][2],
      '/stripe-connect-callback',
      'code and state are removed before the exchange',
    )
    assert.deepEqual(assigned, [
      'https://thestarters.com/starter-dashboard?stripe_connect=connected',
    ])
    assert.equal(states.error.style.display, 'none')
  } finally {
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('callback refuses a state for another member without exchanging', async () => {
  const previous = {
    console: global.console,
    document: global.document,
    fetch: global.fetch,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { root, states } = stripeRoot()
  let fetchCount = 0

  global.console = { ...console, error: () => {} }
  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = { replaceState: () => {} }
  global.location = {
    href: 'https://thestarters.com/stripe-connect-callback?code=code-123&state=mem-other',
    origin: 'https://thestarters.com',
    assign: () => {
      throw new Error('must not redirect')
    },
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
  }
  global.fetch = async () => {
    fetchCount += 1
    return response({ connected: true })
  }

  try {
    const result = await api.mountCallback()
    assert.equal(result, null)
    assert.equal(fetchCount, 0)
    assert.equal(states.error.style.display, '')
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
  } finally {
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})
