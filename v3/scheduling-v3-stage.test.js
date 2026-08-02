const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./scheduling-v3-stage.js'), 'utf8')
const authSource = fs.readFileSync(require.resolve('./scheduling-auth.js'), 'utf8')
const componentSource = fs.readFileSync(
  require.resolve('./scheduling-v3-stage-component.html'),
  'utf8',
)
const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const API_BASE = `${XANO_ORIGIN}/api:tCpV3oqd/`

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function loadStage(options = {}) {
  const nativeRequests = []
  const authenticatedRequests = []
  const attributes = {}
  const intervals = []
  const nativeFetch = async (request) => {
    nativeRequests.push(request)
    return response({ native: true })
  }
  const xanoAuthFetch = async (request) => {
    authenticatedRequests.push(request)
    return response({ authenticated: true })
  }
  const hostname = options.hostname || 'the-starters-3-0.webflow.io'
  const pathname = options.pathname || '/messages-stage'
  const window = {
    location: { hostname, pathname, href: `https://${hostname}${pathname}` },
    fetch: nativeFetch,
    xanoAuthFetch: options.withoutAuth ? undefined : xanoAuthFetch,
    MEMBER: options.brandMemberstackId ? { id: options.brandMemberstackId } : undefined,
    starter_memberstack_id: options.starterMemberstackId,
    setInterval(callback) {
      intervals.push({ callback, cleared: false })
      return intervals.length - 1
    },
    clearInterval(id) {
      intervals[id].cleared = true
    },
  }
  const document = {
    querySelectorAll() {
      return options.schedulerElements || []
    },
    documentElement: {
      setAttribute(name, value) {
        attributes[name] = value
      },
    },
  }

  vm.runInNewContext(source, {
    console: { info() {}, warn() {} },
    document,
    Object,
    Request,
    Response,
    Set,
    URL,
    window,
  })

  return { attributes, authenticatedRequests, intervals, nativeFetch, nativeRequests, window }
}

test('installs only on the five explicit staging pages', () => {
  for (const pathname of [
    '/starter-dashboard---availability-stage',
    '/brand-dashboard---availability-stage',
    '/messages-stage',
    '/hire-stage',
    '/hire/jp-dionisio',
  ]) {
    const { attributes, window } = loadStage({ pathname })
    assert.equal(window.__tsSchedulingV3Stage, true)
    assert.equal(attributes['data-scheduling-v3-stage'], 'ready')
  }
})

test('adds stable Brand and Starter IDs to the approved Hire booking payload', () => {
  const { window } = loadStage({
    pathname: '/hire/jp-dionisio',
    brandMemberstackId: 'brand-member',
    starterMemberstackId: 'starter-member',
  })
  const scheduler = {
    bookingInfo: JSON.stringify({
      primaryParticipant: { name: 'Brand', email: 'brand@example.com' },
      additionalFields: {
        unique_id: { value: 'payment-correlation-id', type: 'text' },
        from_stage: { value: 'true', type: 'text' },
      },
    }),
  }

  assert.equal(window.StarterSchedulingV3Stage.injectBookingIdentity(scheduler), true)
  const bookingInfo = JSON.parse(scheduler.bookingInfo)
  assert.deepEqual(bookingInfo.additionalFields.brand_memberstack_id, {
    value: 'brand-member',
    type: 'text',
    readOnly: true,
  })
  assert.deepEqual(bookingInfo.additionalFields.starter_memberstack_id, {
    value: 'starter-member',
    type: 'text',
    readOnly: true,
  })
  assert.equal(bookingInfo.additionalFields.unique_id.value, 'payment-correlation-id')
  assert.equal(bookingInfo.additionalFields.from_stage.value, 'true')
})

test('does not attach booking identity outside the isolated Hire canary', () => {
  const { window } = loadStage({
    pathname: '/messages-stage',
    brandMemberstackId: 'brand-member',
    starterMemberstackId: 'starter-member',
  })
  const scheduler = { bookingInfo: '{}' }

  assert.equal(window.StarterSchedulingV3Stage.injectBookingIdentity(scheduler), false)
  assert.equal(scheduler.bookingInfo, '{}')
})

test('retries identity injection when booking data and member IDs arrive asynchronously', () => {
  const scheduler = {}
  const { intervals, window } = loadStage({
    pathname: '/hire/jp-dionisio',
    schedulerElements: [scheduler],
  })

  assert.equal(intervals.length, 1)
  intervals[0].callback()
  assert.equal(intervals[0].cleared, false)

  window.MEMBER = { id: 'brand-member' }
  window.starter_memberstack_id = 'starter-member'
  scheduler.bookingInfo = JSON.stringify({ additionalFields: {} })
  intervals[0].callback()

  const bookingInfo = JSON.parse(scheduler.bookingInfo)
  assert.equal(bookingInfo.additionalFields.brand_memberstack_id.value, 'brand-member')
  assert.equal(bookingInfo.additionalFields.starter_memberstack_id.value, 'starter-member')
  assert.equal(intervals[0].cleared, true)
})

test('component loader installs auth and routing synchronously before cloned logic', () => {
  const tags = [...componentSource.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]
  assert.deepEqual(
    tags.map((match) => match[1].split('/').at(-1)),
    [
      'scheduling-auth.js',
      'scheduling-v3-stage.js',
      'scheduling-availability-init.js',
      'scheduling-availability-writer.js',
    ],
  )
  assert.doesNotMatch(tags[0][0], /\bdefer\b/)
  assert.doesNotMatch(tags[1][0], /\bdefer\b/)
  assert.match(tags[2][0], /\bdefer\b/)
  assert.match(tags[3][0], /\bdefer\b/)
})

test('does not install on the live profile component or production domains', () => {
  const publicProfile = loadStage({ pathname: '/detail_hire/example' })
  assert.equal(publicProfile.window.__tsSchedulingV3Stage, undefined)
  assert.equal(publicProfile.window.fetch, publicProfile.nativeFetch)

  const production = loadStage({ hostname: 'www.thestarters.com' })
  assert.equal(production.window.__tsSchedulingV3Stage, undefined)
  assert.equal(production.window.fetch, production.nativeFetch)
})

test('keeps the isolated Hire stage separate from the live CMS profile path', () => {
  const stage = loadStage({ pathname: '/hire-stage' })
  assert.equal(stage.window.__tsSchedulingV3Stage, true)
  assert.equal(stage.attributes['data-scheduling-v3-stage'], 'ready')

  const liveTemplate = loadStage({ pathname: '/detail_hire' })
  assert.equal(liveTemplate.window.__tsSchedulingV3Stage, undefined)
  assert.equal(liveTemplate.window.fetch, liveTemplate.nativeFetch)
})

test('installs on only the approved Test Talent Hire profile path', () => {
  const testProfile = loadStage({ pathname: '/hire/jp-dionisio' })
  assert.equal(testProfile.window.__tsSchedulingV3Stage, true)
  assert.equal(testProfile.attributes['data-scheduling-v3-stage'], 'ready')

  const otherProfile = loadStage({ pathname: '/hire/sabina-rahaman' })
  assert.equal(otherProfile.window.__tsSchedulingV3Stage, undefined)
  assert.equal(otherProfile.window.fetch, otherProfile.nativeFetch)
})

test('uses Brand-safe discovery reads only on the approved real Hire canary', async () => {
  const hire = loadStage({ pathname: '/hire/jp-dionisio' })
  const messages = loadStage({ pathname: '/messages-stage' })

  assert.equal(
    hire.window.StarterSchedulingV3Stage.routeMap['starter/get_by_memberstack'],
    'starter/get_booking_profile/v3',
  )
  assert.equal(
    hire.window.StarterSchedulingV3Stage.routeMap['nylas_configurations/get_all'],
    'nylas_configurations/get_bookable/v3',
  )
  assert.equal(
    messages.window.StarterSchedulingV3Stage.routeMap['starter/get_by_memberstack'],
    'starter/get_by_memberstack/v3',
  )
  assert.equal(
    messages.window.StarterSchedulingV3Stage.routeMap['nylas_configurations/get_all'],
    'nylas_configurations/get_all/v3',
  )

  await hire.window.fetch(`${API_BASE}starter/get_by_memberstack`, {
    method: 'POST',
    body: JSON.stringify({ member_id: 'test-talent' }),
  })
  await hire.window.fetch(`${API_BASE}nylas_configurations/get_all`, {
    method: 'POST',
    body: JSON.stringify({ grant_id: 'test-grant' }),
  })

  assert.deepEqual(
    hire.authenticatedRequests.map((request) => new URL(request.url).pathname),
    [
      '/api:tCpV3oqd/starter/get_booking_profile/v3',
      '/api:tCpV3oqd/nylas_configurations/get_bookable/v3',
    ],
  )
})

test('maps every reviewed legacy route to an authenticated V3 request', async () => {
  const { authenticatedRequests, window } = loadStage()
  const routeMap = window.StarterSchedulingV3Stage.routeMap

  for (const [legacy, v3] of Object.entries(routeMap)) {
    const result = await window.fetch(`${API_BASE}${legacy}?canary=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: legacy }),
    })
    assert.equal(result.status, 200)
    const request = authenticatedRequests.at(-1)
    assert.equal(new URL(request.url).pathname, `/api:tCpV3oqd/${v3}`)
    assert.equal(new URL(request.url).search, '?canary=1')
    assert.equal(await request.text(), JSON.stringify({ route: legacy }))
  }

  assert.equal(authenticatedRequests.length, Object.keys(routeMap).length)
})

test('the real auth bridge authorizes every mapped V3 target', async () => {
  const requests = []
  const attributes = {}
  const window = {
    location: {
      hostname: 'the-starters-3-0.webflow.io',
      pathname: '/messages-stage',
      href: 'https://the-starters-3-0.webflow.io/messages-stage',
    },
    fetch: async (request) => {
      const url = typeof request === 'string' ? request : request.url
      if (url.includes('/auth/trade-token/v3')) {
        return response({ authToken: 'xano-canary' })
      }
      requests.push(request)
      return response({ ok: true })
    },
    setTimeout() {},
    $memberstackDom: {
      getMemberCookie: async () => 'memberstack-canary',
      onAuthChange() {},
    },
  }
  const context = {
    console: { info() {}, warn() {} },
    document: {
      documentElement: {
        setAttribute(name, value) {
          attributes[name] = value
        },
      },
    },
    Headers,
    Object,
    Request,
    Response,
    Set,
    URL,
    window,
  }
  vm.runInNewContext(authSource, context)
  vm.runInNewContext(source, context)

  for (const legacy of Object.keys(window.StarterSchedulingV3Stage.routeMap)) {
    await window.fetch(`${API_BASE}${legacy}`, { method: 'POST', body: '{}' })
  }

  assert.equal(requests.length, Object.keys(window.StarterSchedulingV3Stage.routeMap).length)
  for (const request of requests) {
    assert.equal(request.headers.get('Authorization'), 'Bearer xano-canary')
    assert.match(new URL(request.url).pathname, /\/v3$/)
  }
  assert.equal(attributes['data-scheduling-v3-stage'], 'ready')
})

test('the real auth bridge authorizes the Brand-safe Hire discovery overrides', async () => {
  const requests = []
  const window = {
    location: {
      hostname: 'the-starters-3-0.webflow.io',
      pathname: '/hire/jp-dionisio',
      href: 'https://the-starters-3-0.webflow.io/hire/jp-dionisio',
    },
    fetch: async (request) => {
      const url = typeof request === 'string' ? request : request.url
      if (url.includes('/auth/trade-token/v3')) {
        return response({ authToken: 'xano-canary' })
      }
      requests.push(request)
      return response({ ok: true })
    },
    setTimeout() {},
    $memberstackDom: {
      getMemberCookie: async () => 'memberstack-canary',
      onAuthChange() {},
    },
  }
  const context = {
    console: { info() {}, warn() {} },
    document: { documentElement: { setAttribute() {} } },
    Headers,
    Object,
    Request,
    Response,
    Set,
    URL,
    window,
  }
  vm.runInNewContext(authSource, context)
  vm.runInNewContext(source, context)

  await window.fetch(`${API_BASE}starter/get_by_memberstack`, {
    method: 'POST',
    body: JSON.stringify({ member_id: 'test-talent' }),
  })
  await window.fetch(`${API_BASE}nylas_configurations/get_all`, {
    method: 'POST',
    body: JSON.stringify({ grant_id: 'test-grant' }),
  })

  assert.equal(requests.length, 2)
  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    [
      '/api:tCpV3oqd/starter/get_booking_profile/v3',
      '/api:tCpV3oqd/nylas_configurations/get_bookable/v3',
    ],
  )
  for (const request of requests) {
    assert.equal(request.headers.get('Authorization'), 'Bearer xano-canary')
  }
})

test('routes direct reviewed V3 calls through the auth bridge', async () => {
  const { authenticatedRequests, window } = loadStage()

  await window.fetch(`${API_BASE}booking/cancel/v3`, { method: 'POST', body: '{}' })

  assert.equal(authenticatedRequests.length, 1)
  assert.equal(new URL(authenticatedRequests[0].url).pathname, '/api:tCpV3oqd/booking/cancel/v3')
})

test('retains only approved legacy Stripe provider calls', async () => {
  const { authenticatedRequests, nativeRequests, window } = loadStage()

  await window.fetch(`${API_BASE}stripe/live/payment_intent/get`, {
    method: 'POST',
    body: '{}',
  })

  assert.equal(authenticatedRequests.length, 0)
  assert.equal(nativeRequests.length, 1)
  assert.equal(new URL(nativeRequests[0].url).pathname, '/api:tCpV3oqd/stripe/live/payment_intent/get')
})

test('fails closed for held, unsafe, and unclassified scheduling routes', async () => {
  const { authenticatedRequests, nativeRequests, window } = loadStage()
  const blocked = [
    'booking_record/get_with_filters',
    'booking_record/get_with_filters/v3',
    'notetaker/get_transcription',
    'google_meet/exchange',
  ]

  for (const route of blocked) {
    const result = await window.fetch(`${API_BASE}${route}`)
    assert.equal(result.status, 410)
    assert.equal((await result.json()).code, 'SCHEDULING_V3_ROUTE_BLOCKED')
  }

  assert.equal(authenticatedRequests.length, 0)
  assert.equal(nativeRequests.length, 0)
})

test('fails closed when the scheduling auth bridge is missing', async () => {
  const { attributes, nativeRequests, window } = loadStage({ withoutAuth: true })

  const result = await window.fetch(`${API_BASE}booking/cancel`)

  assert.equal(result.status, 410)
  assert.equal(attributes['data-scheduling-v3-stage'], 'auth-unavailable')
  assert.equal(nativeRequests.length, 0)
})
