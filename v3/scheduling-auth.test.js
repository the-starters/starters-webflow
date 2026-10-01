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

function timerQueue() {
  const timers = []
  let nextId = 1
  const pending = (milliseconds) =>
    timers.filter(
      (timer) =>
        !timer.cleared &&
        !timer.fired &&
        (milliseconds == null || timer.milliseconds === milliseconds),
    )
  return {
    setTimeout(callback, milliseconds) {
      const timer = { id: nextId++, callback, milliseconds, cleared: false, fired: false }
      timers.push(timer)
      return timer.id
    },
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id)
      if (timer) timer.cleared = true
    },
    pending,
    fire(milliseconds) {
      const [timer] = pending(milliseconds)
      assert.ok(timer, `no pending ${milliseconds} ms timer`)
      timer.fired = true
      timer.callback()
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
    setTimeout: options.setTimeout || function () {},
    clearTimeout: options.clearTimeout === null ? undefined : options.clearTimeout || function () {},
  }
  if (options.AbortController) window.AbortController = options.AbortController
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

test('dashboard token reuse exposes exact owner and trade metadata only on approved dashboard hosts', () => {
  for (const hostname of ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']) {
    const { window } = loadBridge(async () => response({}), {
      hostname,
      pathname: '/starter-dashboard',
    })
    assert.equal(window.__tsSchedulingAuthTokenReuse.owner, 'scheduling-auth')
    assert.equal(window.__tsSchedulingAuthTokenReuse.authBase, `${XANO_ORIGIN}/api:g1vmSLWh`)
    assert.equal(window.__tsSchedulingAuthTokenReuse.tradePath, '/auth/trade-token/v3')
    assert.equal(typeof window.__tsSchedulingAuthTokenReuse.getToken, 'function')
  }
  for (const [hostname, pathname] of [
    ['the-starters-3-0.webflow.io', '/hire/example'],
    ['thestarters.com', '/brand-dashboard'],
    ['www.thestarters.com', '/messages'],
    ['hirethestarters.com', '/messages'],
    ['example.com', '/starter-dashboard'],
  ]) {
    const { window } = loadBridge(async () => response({}), { hostname, pathname })
    assert.equal(window.__tsSchedulingAuthTokenReuse, undefined)
  }
})

test('dashboard token reuse returns a cached token for the exact Memberstack cookie without a new trade', async () => {
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      trades += 1
      return response({ authToken: 'xano-a' })
    }
    return response({})
  }, { pathname: '/starter-dashboard' })

  assert.equal(await window.getXanoAuthToken(), 'xano-a')
  assert.equal(await window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a'), 'xano-a')
  assert.equal(await window.__tsSchedulingAuthTokenReuse.getToken('memberstack-b'), null)
  assert.equal(trades, 1)
})

test('dashboard token reuse joins a matching in-flight trade without its own fetch', async () => {
  const trade = deferred()
  const started = deferred()
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      trades += 1
      started.resolve()
      return trade.promise
    }
    return response({})
  }, { pathname: '/starter-dashboard' })

  const owner = window.getXanoAuthToken()
  await started.promise
  const joiner = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  trade.resolve(response({ authToken: 'xano-a' }))

  assert.equal(await owner, 'xano-a')
  assert.equal(await joiner, 'xano-a')
  assert.equal(trades, 1)
})

test('dashboard token reuse gives up on a stalled in-flight trade', async () => {
  const trade = deferred()
  const started = deferred()
  let completionTimer
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      trades += 1
      started.resolve()
      return trade.promise
    }
    return response({})
  }, {
    pathname: '/starter-dashboard',
    setTimeout(callback, milliseconds) {
      // The owner trade arms its own 30 s deadline; this test drives only the
      // 5 s reuse wait.
      if (milliseconds === 30000) return 2
      assert.equal(milliseconds, 5000)
      completionTimer = callback
      return 1
    },
    clearTimeout() {},
  })

  const owner = window.getXanoAuthToken()
  await started.promise
  const joiner = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  await new Promise(setImmediate)
  assert.equal(trades, 1)
  completionTimer()

  assert.equal(await joiner, null)
  assert.equal(trades, 1)
  trade.resolve(response({ authToken: 'xano-late' }))
  assert.equal(await owner, 'xano-late')
})

test('dashboard token reuse leaves a late successful owner trade cached', async () => {
  const trade = deferred()
  const started = deferred()
  let completionTimer
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      trades += 1
      started.resolve()
      return trade.promise
    }
    return response({})
  }, {
    pathname: '/starter-dashboard',
    setTimeout(callback, milliseconds) {
      // The owner trade arms its own 30 s deadline; this test drives only the
      // 5 s reuse wait.
      if (milliseconds === 30000) return 2
      assert.equal(milliseconds, 5000)
      completionTimer = callback
      return 1
    },
    clearTimeout() {},
  })

  const owner = window.getXanoAuthToken()
  await started.promise
  const joiner = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  await new Promise(setImmediate)
  completionTimer()
  assert.equal(await joiner, null)
  trade.resolve(response({ authToken: 'xano-late' }))

  assert.equal(await owner, 'xano-late')
  assert.equal(await window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a'), 'xano-late')
  assert.equal(trades, 1)
})

test('dashboard token reuse waits briefly for a scheduling trade to start', async () => {
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      trades += 1
      return response({ authToken: 'xano-a' })
    }
    return response({})
  }, { pathname: '/starter-dashboard', setTimeout, clearTimeout })

  const waiting = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  await new Promise(setImmediate)
  assert.equal(trades, 0)
  assert.equal(await window.getXanoAuthToken(), 'xano-a')
  assert.equal(await waiting, 'xano-a')
  assert.equal(trades, 1)
})

test('dashboard token reuse returns null after 200 ms without initiating a trade', async () => {
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) trades += 1
    return response({})
  }, { pathname: '/starter-dashboard', setTimeout, clearTimeout })
  const start = Date.now()

  assert.equal(await window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a'), null)
  assert.ok(Date.now() - start >= 180)
  assert.equal(trades, 0)
})

test('dashboard token reuse returns null when the session resets while waiting for a trade', async () => {
  const waitingStarted = deferred()
  let cookie = 'memberstack-a'
  let trades = 0
  const memberstack = {
    getMemberCookie: async () => cookie,
    onAuthChange(listener) {
      this.listener = listener
    },
  }
  const { authChange, window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) trades += 1
    return response({})
  }, {
    memberstack,
    pathname: '/starter-dashboard',
    setTimeout(callback, milliseconds) {
      assert.equal(milliseconds, 200)
      waitingStarted.resolve()
      return setTimeout(callback, milliseconds)
    },
    clearTimeout,
  })

  const waiting = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  await waitingStarted.promise
  cookie = 'memberstack-b'
  await authChange({ id: 'member-b' })

  assert.equal(await waiting, null)
  assert.equal(trades, 0)
})

test('dashboard token reuse returns null when the member changes during an in-flight trade', async () => {
  const trade = deferred()
  const started = deferred()
  let cookie = 'memberstack-a'
  let trades = 0
  const memberstack = {
    getMemberCookie: async () => cookie,
    onAuthChange(listener) {
      this.listener = listener
    },
  }
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      trades += 1
      started.resolve()
      return trade.promise
    }
    return response({})
  }, { memberstack, pathname: '/starter-dashboard' })

  const owner = window.getXanoAuthToken()
  await started.promise
  const joiner = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  await new Promise(setImmediate)
  cookie = 'memberstack-b'
  trade.resolve(response({ authToken: 'xano-a' }))

  await assert.rejects(owner, (error) => error.code === 'MEMBER_SCOPE_CHANGED')
  assert.equal(await joiner, null)
  assert.equal(trades, 1)
})

test('dashboard token reuse returns null when the scheduling trade fails', async () => {
  const trade = deferred()
  const started = deferred()
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      trades += 1
      started.resolve()
      return trade.promise
    }
    return response({})
  }, { pathname: '/starter-dashboard' })

  const owner = window.getXanoAuthToken()
  await started.promise
  const joiner = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  trade.resolve(response({ message: 'unavailable' }, 503))

  await assert.rejects(owner, /token trade failed/)
  assert.equal(await joiner, null)
  assert.equal(trades, 1)
})

test('dashboard token reuse rejects an in-flight token invalidated by forceRefresh', async () => {
  const tradesPending = [deferred(), deferred()]
  const tradesStarted = [deferred(), deferred()]
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      const index = trades++
      tradesStarted[index].resolve()
      return tradesPending[index].promise
    }
    return response({})
  }, { pathname: '/starter-dashboard' })

  const owner = window.getXanoAuthToken()
  const ownerRejected = assert.rejects(owner, (error) => error.code === 'MEMBER_SCOPE_CHANGED')
  await tradesStarted[0].promise
  const joiner = window.__tsSchedulingAuthTokenReuse.getToken('memberstack-a')
  await new Promise(setImmediate)
  const refresh = window.getXanoAuthToken({ forceRefresh: true })
  await tradesStarted[1].promise
  tradesPending[0].resolve(response({ authToken: 'old-xano-token' }))
  tradesPending[1].resolve(response({ authToken: 'new-xano-token' }))

  await ownerRejected
  assert.equal(await refresh, 'new-xano-token')
  assert.equal(await joiner, null)
  assert.equal(trades, 2)
})

const TRADE_DEADLINE_MS = 30000
const BOOKINGS_URL = `${XANO_ORIGIN}/api:tCpV3oqd/booking_record/get/v3`

function isTrade(request) {
  return requestUrl(request).includes('/auth/trade-token/v3')
}

test('a stalled token trade times out, aborts its request, and the next call starts a new trade', async () => {
  const timers = timerQueue()
  const firstTrade = deferred()
  const started = deferred()
  const signals = []
  let trades = 0
  const { window } = loadBridge(async (request, init) => {
    if (isTrade(request)) {
      trades += 1
      signals.push(init && init.signal)
      if (trades === 1) {
        started.resolve()
        return firstTrade.promise
      }
      return response({ authToken: 'xano-fresh' })
    }
    return response({})
  }, { AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })

  const owner = window.getXanoAuthToken()
  await started.promise
  const joiner = window.getXanoAuthToken()
  await new Promise(setImmediate)
  assert.deepEqual(timers.pending().map((timer) => timer.milliseconds), [TRADE_DEADLINE_MS])
  assert.equal(signals[0].aborted, false)

  timers.fire(TRADE_DEADLINE_MS)

  await assert.rejects(owner, (error) => error.code === 'XANO_TOKEN_TRADE_TIMEOUT')
  await assert.rejects(joiner, (error) => error.code === 'XANO_TOKEN_TRADE_TIMEOUT')
  assert.equal(signals[0].aborted, true)
  assert.equal(trades, 1)

  firstTrade.resolve(response({ authToken: 'xano-late' }))
  assert.equal(await window.getXanoAuthToken(), 'xano-fresh')
  assert.equal(trades, 2)
  assert.equal(signals[1].aborted, false)
  assert.equal(timers.pending().length, 0)
  assert.equal(await window.getXanoAuthToken(), 'xano-fresh')
  assert.equal(trades, 2)
})

test('a token trade whose body read stalls also times out and is released', async () => {
  const timers = timerQueue()
  const started = deferred()
  let trades = 0
  let firstSignal
  const { window } = loadBridge(async (request, init) => {
    if (isTrade(request)) {
      trades += 1
      if (trades === 1) {
        firstSignal = init.signal
        started.resolve()
        return { ok: true, status: 200, json: () => new Promise(() => {}) }
      }
      return response({ authToken: 'xano-fresh' })
    }
    return response({})
  }, { AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })

  const owner = window.getXanoAuthToken()
  await started.promise
  await new Promise(setImmediate)
  timers.fire(TRADE_DEADLINE_MS)

  await assert.rejects(owner, (error) => error.code === 'XANO_TOKEN_TRADE_TIMEOUT')
  assert.equal(firstSignal.aborted, true)
  assert.equal(await window.getXanoAuthToken(), 'xano-fresh')
  assert.equal(trades, 2)
})

test('without AbortController the trade keeps its request shape and still times out', async () => {
  const timers = timerQueue()
  const started = deferred()
  const inits = []
  let trades = 0
  const { window } = loadBridge(async (request, init) => {
    if (isTrade(request)) {
      trades += 1
      inits.push(init)
      if (trades === 1) {
        started.resolve()
        return new Promise(() => {})
      }
      return response({ authToken: 'xano-fresh' })
    }
    return response({})
  }, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })

  const owner = window.getXanoAuthToken()
  await started.promise
  timers.fire(TRADE_DEADLINE_MS)

  await assert.rejects(owner, (error) => error.code === 'XANO_TOKEN_TRADE_TIMEOUT')
  assert.equal(await window.getXanoAuthToken(), 'xano-fresh')
  assert.deepEqual(inits, [undefined, undefined])
})

test('a window without clearTimeout trades without a deadline or an abort signal', async () => {
  const armed = []
  const inits = []
  const { window } = loadBridge(async (request, init) => {
    if (isTrade(request)) {
      inits.push(init)
      return response({ authToken: 'xano-a' })
    }
    return response({})
  }, {
    AbortController,
    setTimeout: (callback, milliseconds) => armed.push(milliseconds),
    clearTimeout: null,
  })

  assert.equal(await window.getXanoAuthToken(), 'xano-a')
  assert.deepEqual(inits, [undefined])
  assert.deepEqual(armed, [])
})

test('a token trade that settles before the deadline clears its timer and stays cached', async () => {
  const timers = timerQueue()
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (isTrade(request)) {
      trades += 1
      return response({ authToken: 'xano-a' })
    }
    return response({})
  }, { AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })

  assert.equal(await window.getXanoAuthToken(), 'xano-a')
  assert.equal(timers.pending(TRADE_DEADLINE_MS).length, 0)
  assert.equal(await window.getXanoAuthToken(), 'xano-a')
  assert.equal(trades, 1)
})

test('a failed trade clears its deadline timer', async () => {
  const timers = timerQueue()
  const { window } = loadBridge(async (request) => {
    if (isTrade(request)) throw new TypeError('Failed to fetch')
    return response({})
  }, { AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })

  await assert.rejects(window.getXanoAuthToken(), /Failed to fetch/)
  assert.equal(timers.pending(TRADE_DEADLINE_MS).length, 0)
})

test('an authenticated read stuck on the shared trade fails at the deadline and the next read recovers', async () => {
  const timers = timerQueue()
  const started = deferred()
  const reads = []
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (isTrade(request)) {
      trades += 1
      if (trades === 1) {
        started.resolve()
        return new Promise(() => {})
      }
      return response({ authToken: 'xano-fresh' })
    }
    reads.push(request.headers.get('Authorization'))
    return response([])
  }, { AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  const read = () => {
    const controller = new AbortController()
    return window.xanoAuthFetch(BOOKINGS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberstack_id: 'mem_a' }),
      signal: controller.signal,
    })
  }

  const first = read()
  await started.promise
  const joined = read()
  await new Promise(setImmediate)
  timers.fire(TRADE_DEADLINE_MS)

  await assert.rejects(first, (error) => error.code === 'XANO_TOKEN_TRADE_TIMEOUT')
  await assert.rejects(joined, (error) => error.code === 'XANO_TOKEN_TRADE_TIMEOUT')
  assert.deepEqual(reads, [])

  const recovered = await read()
  assert.equal(recovered.status, 200)
  assert.deepEqual(reads, ['Bearer xano-fresh'])
  assert.equal(trades, 2)
})

test('the legacy fetch wrapper falls back without a token after a trade timeout', async () => {
  const timers = timerQueue()
  const started = deferred()
  const warnings = []
  const sent = []
  const { window } = loadBridge(async (request) => {
    if (isTrade(request)) {
      started.resolve()
      return new Promise(() => {})
    }
    sent.push(request.headers.get('Authorization'))
    return response({ message: 'unauthorized' }, 401)
  }, {
    AbortController,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    console: { info() {}, warn: (...args) => warnings.push(args.join(' ')) },
  })

  const pending = window.fetch(SCHEDULING_URL, { method: 'POST', body: '{}' })
  await started.promise
  timers.fire(TRADE_DEADLINE_MS)

  assert.equal((await pending).status, 401)
  assert.deepEqual(sent, [null])
  assert.ok(warnings.some((line) => line.includes('Xano token trade timed out')))
})

test('a 401 refresh whose trade stalls returns the original 401 at the deadline', async () => {
  const timers = timerQueue()
  const refreshStarted = deferred()
  const sent = []
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (isTrade(request)) {
      trades += 1
      if (trades === 1) return response({ authToken: 'xano-expired' })
      refreshStarted.resolve()
      return new Promise(() => {})
    }
    sent.push(request.headers.get('Authorization'))
    return response({ message: 'expired' }, 401)
  }, { AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })

  const pending = window.xanoAuthFetch(SCHEDULING_URL, { method: 'POST', body: '{}' })
  await refreshStarted.promise
  timers.fire(TRADE_DEADLINE_MS)

  const result = await pending
  assert.equal(result.status, 401)
  assert.deepEqual(sent, ['Bearer xano-expired'])
  assert.equal(trades, 2)
})

test('a stale trade deadline does not disturb the trade that replaced it', async () => {
  const timers = timerQueue()
  const started = deferred()
  let trades = 0
  const { window } = loadBridge(async (request) => {
    if (isTrade(request)) {
      trades += 1
      if (trades === 1) {
        started.resolve()
        return new Promise(() => {})
      }
      return response({ authToken: 'xano-new' })
    }
    return response({})
  }, { AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })

  const owner = window.getXanoAuthToken()
  await started.promise
  assert.equal(await window.getXanoAuthToken({ forceRefresh: true }), 'xano-new')
  assert.equal(timers.pending(TRADE_DEADLINE_MS).length, 1)

  timers.fire(TRADE_DEADLINE_MS)

  await assert.rejects(owner, (error) => error.code === 'XANO_TOKEN_TRADE_TIMEOUT')
  assert.equal(await window.getXanoAuthToken(), 'xano-new')
  assert.equal(trades, 2)
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

test('explicit AbortSignals bypass shared Xano reads without invalidating cache', async (t) => {
  const scenarios = [
    {
      name: 'signaled owner',
      first(window, controller) {
        return window.xanoAuthFetch(PAID_GET, { signal: controller.signal })
      },
      second(window) {
        return window.xanoAuthFetch(PAID_GET)
      },
      abortedIndex: 0,
    },
    {
      name: 'signaled later caller',
      first(window) {
        return window.xanoAuthFetch(PAID_GET)
      },
      second(window, controller) {
        return window.xanoAuthFetch(PAID_GET, { signal: controller.signal })
      },
      abortedIndex: 1,
    },
    {
      name: 'Request input with second-argument signal',
      first(window, controller) {
        return window.xanoAuthFetch(new Request(PAID_GET), {
          signal: controller.signal,
        })
      },
      second(window) {
        return window.xanoAuthFetch(PAID_GET)
      },
      abortedIndex: 0,
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const controller = new AbortController()
      const responseGate = deferred()
      const firstStarted = deferred()
      let calls = 0
      let freeCalls = 0
      const nativeFetch = async (request) => {
        if (requestUrl(request).includes('/auth/trade-token/v3')) {
          return response({ authToken: 'xano-1' })
        }
        if (requestUrl(request) === FREE_GET) {
          freeCalls += 1
          return response({ free: freeCalls })
        }
        calls += 1
        const callNumber = calls
        if (calls === 1) firstStarted.resolve()
        return new Promise((resolve, reject) => {
          const abort = () => reject(request.signal.reason)
          if (request.signal.aborted) {
            abort()
            return
          }
          request.signal.addEventListener('abort', abort, { once: true })
          responseGate.promise.then(() => {
            request.signal.removeEventListener('abort', abort)
            resolve(response({ n: callNumber }))
          })
        })
      }
      const { window } = loadBridge(nativeFetch)

      await window.xanoAuthFetch(FREE_GET)
      const first = scenario.first(window, controller)
      await firstStarted.promise
      const second = scenario.second(window, controller)
      await new Promise(setImmediate)
      assert.equal(calls, 2)
      controller.abort()
      responseGate.resolve()
      const results = await Promise.allSettled([first, second])
      const completedIndex = scenario.abortedIndex === 0 ? 1 : 0

      assert.equal(results[scenario.abortedIndex].status, 'rejected')
      assert.equal(results[scenario.abortedIndex].reason.name, 'AbortError')
      assert.equal(results[completedIndex].status, 'fulfilled')
      assert.equal((await results[completedIndex].value.json()).n, completedIndex + 1)
      assert.deepEqual(await (await window.xanoAuthFetch(FREE_GET)).json(), { free: 1 })
      assert.equal(freeCalls, 1)
    })
  }
})

test('plain Request inputs share one Xano read', async () => {
  const responseGate = deferred()
  const firstStarted = deferred()
  let calls = 0
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-1' })
    }
    calls += 1
    firstStarted.resolve()
    await responseGate.promise
    return response({ n: calls })
  }
  const { window } = loadBridge(nativeFetch)

  const first = window.xanoAuthFetch(new Request(PAID_GET))
  await firstStarted.promise
  const second = window.xanoAuthFetch(new Request(PAID_GET))
  await new Promise(setImmediate)
  const callsBeforeRelease = calls
  responseGate.resolve()
  const [firstResponse, secondResponse] = await Promise.all([first, second])

  assert.equal(callsBeforeRelease, 1)
  assert.deepEqual(await firstResponse.json(), { n: 1 })
  assert.deepEqual(await secondResponse.json(), { n: 1 })
  assert.deepEqual(await (await window.xanoAuthFetch(new Request(PAID_GET))).json(), {
    n: 1,
  })
  assert.equal(calls, 1)
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

test('any failed shared Xano read drops every cached entry', async (t) => {
  for (const failure of ['response', 'rejection']) {
    await t.test(failure, async () => {
      const calls = []
      const nativeFetch = async (request) => {
        const url = requestUrl(request)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-1' })
        calls.push(url)
        if (url === FREE_GET) {
          if (failure === 'response') return response({ failed: true }, 500)
          throw new Error('free settings failed')
        }
        return response({ n: calls.length })
      }
      const { window } = loadBridge(nativeFetch)

      await window.xanoAuthFetch(PAID_GET)
      if (failure === 'response') {
        assert.equal((await window.xanoAuthFetch(FREE_GET)).status, 500)
      } else {
        await assert.rejects(window.xanoAuthFetch(FREE_GET), /free settings failed/)
      }
      const refreshed = await window.xanoAuthFetch(PAID_GET)

      assert.equal(calls.filter((url) => url === PAID_GET).length, 2)
      assert.deepEqual(await refreshed.json(), { n: 3 })
    })
  }
})

test('failed signaled reads clear every cached entry', async (t) => {
  for (const failure of ['response', 'rejection']) {
    await t.test(failure, async () => {
      let paidCalls = 0
      let freeCalls = 0
      const nativeFetch = async (request) => {
        const url = requestUrl(request)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-1' })
        if (url === FREE_GET) {
          freeCalls += 1
          return response({ free: freeCalls })
        }
        paidCalls += 1
        if (paidCalls === 2) {
          if (failure === 'response') return response({ failed: true }, 500)
          throw new Error('signaled paid settings failed')
        }
        return response({ paid: paidCalls })
      }
      const { window } = loadBridge(nativeFetch)

      await window.xanoAuthFetch(PAID_GET)
      await window.xanoAuthFetch(FREE_GET)
      const controller = new AbortController()
      if (failure === 'response') {
        assert.equal(
          (await window.xanoAuthFetch(PAID_GET, { signal: controller.signal })).status,
          500,
        )
      } else {
        await assert.rejects(
          window.xanoAuthFetch(PAID_GET, { signal: controller.signal }),
          /signaled paid settings failed/,
        )
      }
      const refreshedPaid = await window.xanoAuthFetch(PAID_GET)
      const refreshedFree = await window.xanoAuthFetch(FREE_GET)

      assert.deepEqual(await refreshedPaid.json(), { paid: 3 })
      assert.deepEqual(await refreshedFree.json(), { free: 2 })
      assert.equal(paidCalls, 3)
      assert.equal(freeCalls, 2)
    })
  }
})

test('a stale failed signaled read cannot evict a replacement cache entry', async () => {
  const failureGate = deferred()
  const failureStarted = deferred()
  let paidCalls = 0
  const nativeFetch = async (request) => {
    const url = requestUrl(request)
    if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-1' })
    if (url === PAID_UPSERT) return response({ updated: true })
    paidCalls += 1
    if (paidCalls === 2) {
      failureStarted.resolve()
      await failureGate.promise
      throw new Error('stale signaled read failed')
    }
    return response({ paid: paidCalls })
  }
  const { window } = loadBridge(nativeFetch)

  await window.xanoAuthFetch(PAID_GET)
  const controller = new AbortController()
  const staleFailure = window.xanoAuthFetch(PAID_GET, { signal: controller.signal })
  await failureStarted.promise
  await window.xanoAuthFetch(PAID_UPSERT, { method: 'POST', body: '{}' })
  const replacement = await window.xanoAuthFetch(PAID_GET)
  failureGate.resolve()
  await assert.rejects(staleFailure, /stale signaled read failed/)
  const reused = await window.xanoAuthFetch(PAID_GET)

  assert.deepEqual(await replacement.json(), { paid: 3 })
  assert.deepEqual(await reused.json(), { paid: 3 })
  assert.equal(paidCalls, 3)
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
  for (let step = 0; step < 6; step += 1) await Promise.resolve()
  assert.equal(state.reads, 2)
  mutationGate.resolve()
  await mutation
  const after = memberstack.getCurrentMember()
  for (let step = 0; step < 3; step += 1) await Promise.resolve()
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
  const memberAStarted = deferred()
  const memberstack = {
    getMemberCookie: async () => cookie,
    onAuthChange() {},
    getCurrentMember() {
      reads += 1
      const memberId = cookie === 'memberstack-a' ? 'member-a' : 'member-b'
      if (memberId === 'member-a') {
        memberAStarted.resolve()
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
  await memberAStarted.promise
  cookie = 'memberstack-b'
  await window.xanoAuthFetch(PAID_GET)
  const memberB = memberstack.getCurrentMember()
  const memberARejection = assert.rejects(memberA, {
    code: 'MEMBER_SCOPE_CHANGED',
  })
  for (let step = 0; step < 6; step += 1) await Promise.resolve()
  try {
    assert.equal(reads, 2)
  } finally {
    memberAGate.resolve()
  }
  const [memberBResult] = await Promise.all([memberB, memberARejection])

  assert.equal(memberBResult.data.id, 'member-b')
})

test('live cookie isolates member reads without an auth event or Xano request', async () => {
  let cookie = 'memberstack-a'
  let reads = 0
  const memberAGate = deferred()
  const memberAStarted = deferred()
  const memberstack = {
    getMemberCookie: async () => cookie,
    onAuthChange() {},
    getCurrentMember() {
      reads += 1
      const memberId = cookie === 'memberstack-a' ? 'member-a' : 'member-b'
      if (memberId === 'member-a') {
        memberAStarted.resolve()
        return memberAGate.promise.then(() => ({ data: { id: memberId } }))
      }
      return Promise.resolve({ data: { id: memberId } })
    },
  }
  loadBridge(async () => response({}), { memberstack })

  const memberAOwner = memberstack.getCurrentMember()
  await memberAStarted.promise
  const memberAJoiner = memberstack.getCurrentMember()
  cookie = 'memberstack-b'
  const memberB = memberstack.getCurrentMember()
  const memberAOwnerRejection = assert.rejects(memberAOwner, {
    code: 'MEMBER_SCOPE_CHANGED',
  })
  const memberAJoinerRejection = assert.rejects(memberAJoiner, {
    code: 'MEMBER_SCOPE_CHANGED',
  })
  for (let step = 0; step < 6; step += 1) await Promise.resolve()
  try {
    assert.equal(reads, 2)
  } finally {
    memberAGate.resolve()
  }
  const [memberBResult] = await Promise.all([
    memberB,
    memberAOwnerRejection,
    memberAJoinerRejection,
  ])

  assert.equal(memberBResult.data.id, 'member-b')
})

test('first read in a silently rotated session shares its new revision', async () => {
  let cookie = 'memberstack-a'
  const reads = { a: 0, b: 0 }
  const memberAGate = deferred()
  const memberBGate = deferred()
  const memberAStarted = deferred()
  const memberBStarted = deferred()
  const memberstack = {
    getMemberCookie: async () => cookie,
    onAuthChange() {},
    getCurrentMember() {
      const member = cookie === 'memberstack-a' ? 'a' : 'b'
      reads[member] += 1
      if (member === 'a') {
        memberAStarted.resolve()
        return memberAGate.promise.then(() => ({ data: { id: 'member-a' } }))
      }
      memberBStarted.resolve()
      return memberBGate.promise.then(() => ({ data: { id: 'member-b' } }))
    },
  }
  loadBridge(async () => response({}), { memberstack })

  const memberA = memberstack.getCurrentMember()
  await memberAStarted.promise
  cookie = 'memberstack-b'
  const memberB1 = memberstack.getCurrentMember()
  await memberBStarted.promise
  const memberB2 = memberstack.getCurrentMember()
  const memberARejection = assert.rejects(memberA, {
    code: 'MEMBER_SCOPE_CHANGED',
  })
  for (let step = 0; step < 6; step += 1) await Promise.resolve()
  try {
    assert.deepEqual(reads, { a: 1, b: 1 })
  } finally {
    memberAGate.resolve()
    memberBGate.resolve()
  }
  const [memberB1Result, memberB2Result] = await Promise.all([
    memberB1,
    memberB2,
    memberARejection,
  ])

  assert.equal(memberB1Result.data.id, 'member-b')
  assert.equal(memberB2Result.data.id, 'member-b')
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
