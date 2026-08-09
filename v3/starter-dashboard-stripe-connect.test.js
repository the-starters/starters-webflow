const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./starter-dashboard-stripe-connect.js')

const ELEMENT_ATTR = 'data-stripe-connect-element'
const selector = (name) => '[' + ELEMENT_ATTR + '="' + name + '"]'

class FakeElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName
    this.attributes = new Map()
    this.children = new Map()
    this.hidden = false
    this.style = {}
    this.classes = new Set()
    this.classList = {
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        if (force) this.classes.add(name)
        else this.classes.delete(name)
      },
    }
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

  removeAttribute(name) {
    this.attributes.delete(name)
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

test('the two authored earnings tiles resolve to disconnected and ready states', () => {
  const connect = new FakeElement()
  const history = new FakeElement()

  const tiles = api.resolveEarningsTiles([connect, history])

  assert.equal(tiles.disconnected, connect)
  assert.equal(tiles.ready, history)
})

test('explicit earnings state attributes do not depend on document order', () => {
  const connect = new FakeElement()
  const history = new FakeElement()
  connect.setAttribute('data-stripe-connect-earnings-state', 'disconnected')
  history.setAttribute('data-stripe-connect-earnings-state', 'ready')

  const tiles = api.resolveEarningsTiles([history, connect])

  assert.equal(tiles.disconnected, connect)
  assert.equal(tiles.ready, history)
})

test('partial earnings state wiring assigns only the unlabeled fallback', () => {
  const labeledConnect = new FakeElement()
  const unlabeledHistory = new FakeElement()
  labeledConnect.setAttribute(
    'data-stripe-connect-earnings-state',
    'disconnected',
  )

  const connectTiles = api.resolveEarningsTiles([
    unlabeledHistory,
    labeledConnect,
  ])

  assert.equal(connectTiles.disconnected, labeledConnect)
  assert.equal(connectTiles.ready, unlabeledHistory)

  const unlabeledConnect = new FakeElement()
  const labeledHistory = new FakeElement()
  labeledHistory.setAttribute('data-stripe-connect-earnings-state', 'ready')

  const historyTiles = api.resolveEarningsTiles([
    labeledHistory,
    unlabeledConnect,
  ])

  assert.equal(historyTiles.disconnected, unlabeledConnect)
  assert.equal(historyTiles.ready, labeledHistory)
})

test('a lone explicitly disconnected tile is never reused as ready', () => {
  const connect = new FakeElement()
  connect.setAttribute('data-stripe-connect-earnings-state', 'disconnected')

  const tiles = api.resolveEarningsTiles([connect])

  assert.equal(tiles.disconnected, connect)
  assert.equal(tiles.ready, undefined)

  api.renderEarningsTiles(tiles, 'disconnected')
  assert.equal(connect.hidden, false)
  assert.equal(connect.getAttribute('aria-disabled'), 'false')
})

test('exactly one earnings tile is shown for disconnected and ready states', () => {
  const connect = new FakeElement()
  const history = new FakeElement()
  const tiles = api.resolveEarningsTiles([connect, history])

  api.renderEarningsTiles(tiles, 'disconnected')

  assert.equal(connect.hidden, false)
  assert.equal(connect.style.display, '')
  assert.equal(connect.getAttribute('aria-disabled'), 'false')
  assert.equal(connect.getAttribute('tabindex'), '0')
  assert.equal(history.hidden, true)
  assert.equal(history.style.display, 'none')

  api.renderEarningsTiles(tiles, 'ready')

  assert.equal(connect.hidden, true)
  assert.equal(connect.style.display, 'none')
  assert.equal(history.hidden, false)
  assert.equal(history.style.display, '')
  assert.equal(history.getAttribute('aria-disabled'), 'false')
  assert.equal(history.getAttribute('tabindex'), '0')
})

test('earnings tiles stay hidden while status is loading or unavailable', () => {
  const connect = new FakeElement()
  const history = new FakeElement()
  const tiles = api.resolveEarningsTiles([connect, history])

  api.renderEarningsTiles(tiles, 'loading')
  assert.equal(connect.hidden, true)
  assert.equal(history.hidden, true)

  api.renderEarningsTiles(tiles, 'error')
  assert.equal(connect.hidden, true)
  assert.equal(history.hidden, true)
})

test('the disconnected earnings tile activates only while enabled', () => {
  const connect = new FakeElement()
  let activations = 0
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }

  connect.setAttribute('aria-disabled', 'true')
  assert.equal(
    api.handleConnectClick(connect, event, () => {
      activations += 1
    }),
    false,
  )
  assert.equal(event.prevented, true)
  assert.equal(activations, 0)

  event.prevented = false
  connect.setAttribute('aria-disabled', 'false')
  assert.equal(
    api.handleConnectClick(connect, event, () => {
      activations += 1
    }),
    true,
  )
  assert.equal(event.prevented, true)
  assert.equal(activations, 1)
})

test('the disconnected earnings tile supports Enter and Space', () => {
  const connect = new FakeElement()
  const keys = []
  const keydown = (key) => ({
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  })
  connect.setAttribute('aria-disabled', 'false')

  assert.equal(
    api.handleConnectKeydown(connect, keydown('a'), () => keys.push('a')),
    false,
  )
  assert.equal(
    api.handleConnectKeydown(connect, keydown('Enter'), () => keys.push('Enter')),
    true,
  )
  assert.equal(
    api.handleConnectKeydown(connect, keydown(' '), () => keys.push('Space')),
    true,
  )
  assert.deepEqual(keys, ['Enter', 'Space'])
})

test('a pending Connect Stripe action is visibly and fully disabled', () => {
  const connect = new FakeElement()
  connect.disabled = false
  connect.setAttribute('data-stripe-connect-earnings-state', 'disconnected')
  api.renderEarningsTiles(api.resolveEarningsTiles([connect]), 'disconnected')

  api.setActionPending(connect, true)

  assert.equal(connect.getAttribute('aria-busy'), 'true')
  assert.equal(connect.getAttribute('aria-disabled'), 'true')
  assert.equal(connect.getAttribute('tabindex'), '-1')
  assert.equal(connect.classList.contains('is-disabled'), true)
  assert.equal(connect.style.pointerEvents, 'none')
  assert.equal(connect.disabled, true)

  let activations = 0
  const event = { preventDefault() {} }
  assert.equal(
    api.handleConnectClick(connect, event, () => {
      activations += 1
    }),
    false,
  )
  assert.equal(activations, 0)

  api.setActionPending(connect, false)

  assert.equal(connect.getAttribute('aria-busy'), 'false')
  assert.equal(connect.getAttribute('aria-disabled'), 'false')
  assert.equal(connect.getAttribute('tabindex'), '0')
  assert.equal(connect.getAttribute('data-stripe-connect-pending-tabindex'), null)
  assert.equal(connect.classList.contains('is-disabled'), false)
  assert.equal(connect.style.pointerEvents, '')
  assert.equal(connect.disabled, false)
})

test('both start paths apply pending state to the Connect Stripe tile', () => {
  const connect = new FakeElement()
  const actionListButton = new FakeElement('BUTTON')
  connect.setAttribute('tabindex', '0')

  ;[connect, actionListButton].forEach((initiator) => {
    api.setStartPending(initiator, connect, true)

    assert.equal(connect.getAttribute('aria-busy'), 'true')
    assert.equal(connect.getAttribute('aria-disabled'), 'true')
    assert.equal(connect.getAttribute('tabindex'), '-1')
    assert.equal(connect.classList.contains('is-disabled'), true)
    assert.equal(initiator.getAttribute('aria-busy'), 'true')

    api.setStartPending(initiator, connect, false)
    assert.equal(connect.getAttribute('tabindex'), '0')
    assert.equal(connect.getAttribute('aria-disabled'), 'false')
  })
})

test('the exclusive start guard latches only after a successful redirect', async () => {
  const successfulRunner = api.createExclusiveRunner()
  let successfulRuns = 0

  assert.equal(
    await successfulRunner(() => {
      successfulRuns += 1
      return true
    }, true),
    true,
  )
  assert.equal(
    await successfulRunner(() => {
      successfulRuns += 1
      return true
    }, true),
    null,
  )
  assert.equal(successfulRuns, 1)

  const failedRunner = api.createExclusiveRunner()
  let failedRuns = 0
  assert.equal(
    await failedRunner(() => {
      failedRuns += 1
      return false
    }, true),
    false,
  )
  assert.equal(
    await failedRunner(() => {
      failedRuns += 1
      return true
    }, true),
    true,
  )
  assert.equal(failedRuns, 2)
})

test('earnings opens Stripe only while charges are enabled', () => {
  const earnings = new FakeElement('A')
  earnings.setAttribute('href', '#')

  api.setEarningsAccess([earnings], false)

  assert.equal(earnings.getAttribute('href'), null)
  assert.equal(earnings.getAttribute('aria-disabled'), 'true')
  assert.equal(earnings.getAttribute('tabindex'), '-1')
  assert.equal(earnings.classList.contains('is-disabled'), true)

  api.setEarningsAccess([earnings], true)

  assert.equal(earnings.getAttribute('href'), 'https://dashboard.stripe.com/')
  assert.equal(earnings.getAttribute('aria-disabled'), 'false')
  assert.equal(earnings.getAttribute('tabindex'), null)
  assert.equal(earnings.classList.contains('is-disabled'), false)
})

test('the authored Earnings div redirects only after it is enabled', () => {
  const previousLocation = global.location
  const earnings = new FakeElement()
  const destinations = []
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  global.location = { assign: (value) => destinations.push(value) }

  try {
    api.setEarningsAccess([earnings], false)
    assert.equal(earnings.getAttribute('tabindex'), '-1')
    assert.equal(api.handleEarningsClick(earnings, event), false)
    assert.equal(event.prevented, true)
    assert.deepEqual(destinations, [])

    event.prevented = false
    api.setEarningsAccess([earnings], true)
    assert.equal(earnings.getAttribute('tabindex'), '0')
    assert.equal(earnings.getAttribute('role'), 'button')
    assert.equal(api.handleEarningsClick(earnings, event), true)
    assert.equal(event.prevented, true)
    assert.deepEqual(destinations, ['https://dashboard.stripe.com/'])
  } finally {
    global.location = previousLocation
  }
})

test('the authored Earnings div activates from the keyboard once enabled', () => {
  const previousLocation = global.location
  const earnings = new FakeElement()
  const destinations = []
  const keydown = (key) => ({
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  })
  global.location = { assign: (value) => destinations.push(value) }

  try {
    api.setEarningsAccess([earnings], false)
    const whileDisabled = keydown('Enter')
    assert.equal(api.handleEarningsKeydown(earnings, whileDisabled), false)
    assert.equal(whileDisabled.prevented, true)
    assert.deepEqual(destinations, [])

    api.setEarningsAccess([earnings], true)
    const ignored = keydown('a')
    assert.equal(api.handleEarningsKeydown(earnings, ignored), false)
    assert.equal(ignored.prevented, false)
    assert.deepEqual(destinations, [])

    const enter = keydown('Enter')
    assert.equal(api.handleEarningsKeydown(earnings, enter), true)
    assert.equal(enter.prevented, true)

    const space = keydown(' ')
    assert.equal(api.handleEarningsKeydown(earnings, space), true)
    assert.equal(space.prevented, true)
    assert.deepEqual(destinations, [
      'https://dashboard.stripe.com/',
      'https://dashboard.stripe.com/',
    ])
  } finally {
    global.location = previousLocation
  }
})

test('keyboard activation is a no-op for the anchor earnings tile', () => {
  const earnings = new FakeElement('A')
  const event = {
    key: 'Enter',
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  assert.equal(api.handleEarningsKeydown(earnings, event), false)
  assert.equal(event.prevented, false)
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

test('status reuses the shared dashboard Xano token without a local trade', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  const requests = []
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    return response({ connected: true, charges_enabled: true, synced_at: 123 })
  }
  api.__resetXanoToken()

  try {
    const status = await api.fetchStatus()
    assert.equal(status.charges_enabled, true)
    assert.equal(requests.length, 1)
    assert.equal(requests.some(({ url }) => String(url).includes('trade-token')), false)
    assert.equal(requests[0].options.headers.Authorization, 'Bearer shared-xano-token')
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
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
      callback_url: 'https://thestarters.com/stripe-connect-callback',
    })
    assert.equal(api.isStripeUrl(result.url), true)
    assert.equal(api.isStripeUrl('https://evil.example/stripe'), false)
    assert.equal(api.isStripeUrl('javascript:alert(1)'), false)
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
  }
})

test('sandbox start is staging-only and sends an explicit callback URL', async () => {
  const previous = {
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  global.location = {
    hostname: 'the-starters-3-0.webflow.io',
    origin: 'https://the-starters-3-0.webflow.io',
    search: '?stripe_connect_sandbox=1',
  }
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      mode: 'oauth',
      sandbox: true,
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }

  try {
    assert.equal(api.sandboxMode(), true)
    await api.startConnect(
      'https://the-starters-3-0.webflow.io/starter-dashboard',
      true,
    )
    const startRequest = stripeRequest(
      requests,
      '/stripe_connect/sandbox/start/v3',
    )
    assert.match(startRequest.options.headers.Authorization, /^Bearer .+/)
    assert.deepEqual(JSON.parse(startRequest.options.body), {
      return_url: 'https://the-starters-3-0.webflow.io/starter-dashboard',
      callback_url:
        'https://the-starters-3-0.webflow.io/stripe-connect-callback',
    })

    global.location.hostname = 'thestarters.com'
    assert.equal(api.sandboxMode(), false)
  } finally {
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('a stale Xano token triggers one re-trade and retry on 401', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  let trades = 0
  let statusAttempts = 0
  api.__resetXanoToken()
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      trades += 1
      return response({ authToken: 'xano-token-' + trades })
    }
    statusAttempts += 1
    if (statusAttempts === 1) {
      return response({ error: 'expired token' }, { ok: false, status: 401 })
    }
    return response({ connected: true, charges_enabled: true })
  }

  try {
    const status = await api.fetchStatus()
    assert.equal(status.charges_enabled, true)
    assert.equal(statusAttempts, 2, 'the request is retried exactly once')
    assert.equal(trades, 2, 'a fresh token is traded after the 401')
    const statusRequests = requests.filter((request) =>
      String(request.url).includes('/stripe_connect/status/v3'),
    )
    assert.equal(
      statusRequests[0].options.headers.Authorization,
      'Bearer xano-token-1',
    )
    assert.equal(
      statusRequests[1].options.headers.Authorization,
      'Bearer xano-token-2',
      'the retry uses the freshly traded token',
    )
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
    api.__resetXanoToken()
  }
})

test('a persistent 401 rejects without retrying forever', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  let statusAttempts = 0
  api.__resetXanoToken()
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    statusAttempts += 1
    return response({ error: 'expired token' }, { ok: false, status: 401 })
  }

  try {
    await assert.rejects(
      () => api.fetchStatus(),
      /status\/v3 failed \(401\)/,
    )
    assert.equal(statusAttempts, 2, 'retried once, then gives up')
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
    api.__resetXanoToken()
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

test('sandbox callback exchanges without production persistence and marks verification', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { root, states } = stripeRoot()
  const requests = []
  const assigned = []

  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = { replaceState: () => {} }
  global.location = {
    hostname: 'the-starters-3-0.webflow.io',
    href:
      'https://the-starters-3-0.webflow.io/stripe-connect-callback?' +
      'code=test-code&state=sandbox%3Amem-test',
    origin: 'https://the-starters-3-0.webflow.io',
    assign: (url) => assigned.push(url),
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-test' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      connected: true,
      charges_enabled: false,
      sandbox: true,
    })
  }

  try {
    const result = await api.mountCallback()
    assert.equal(result.sandbox, true)
    const exchangeRequest = stripeRequest(
      requests,
      '/stripe_connect/sandbox/oauth_exchange/v3',
    )
    assert.deepEqual(JSON.parse(exchangeRequest.options.body), {
      code: 'test-code',
    })
    assert.deepEqual(assigned, [
      'https://the-starters-3-0.webflow.io/starter-dashboard?' +
        'stripe_connect=connected&stripe_connect_sandbox=verified',
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
