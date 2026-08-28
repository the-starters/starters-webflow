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

function scriptElementModel(html) {
  const elements = []
  let cursor = 0
  while (cursor < html.length) {
    const start = html.indexOf('<script', cursor)
    if (start === -1) break
    let end = start + 7
    let quote = null
    while (end < html.length) {
      const character = html[end]
      if (quote) {
        if (character === quote) quote = null
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
      end += 1
    }
    const attributes = new Map()
    let index = start + 7
    while (index < end) {
      while (index < end && /\s/.test(html[index])) index += 1
      const nameStart = index
      while (index < end && !/[\s=>]/.test(html[index])) index += 1
      if (nameStart === index) break
      const name = html.slice(nameStart, index).toLowerCase()
      while (index < end && /\s/.test(html[index])) index += 1
      let value = ''
      if (html[index] === '=') {
        index += 1
        while (index < end && /\s/.test(html[index])) index += 1
        const delimiter = html[index] === '"' || html[index] === "'" ? html[index++] : null
        const valueStart = index
        if (delimiter) {
          while (index < end && html[index] !== delimiter) index += 1
          value = html.slice(valueStart, index)
          if (html[index] === delimiter) index += 1
        } else {
          while (index < end && !/\s/.test(html[index])) index += 1
          value = html.slice(valueStart, index)
        }
      }
      attributes.set(name, value)
    }
    elements.push({
      src: attributes.get('src') || '',
      defer: attributes.has('defer'),
    })
    cursor = end + 1
  }
  return elements
}

function loadStage(options = {}) {
  const nativeRequests = []
  const authenticatedRequests = []
  const attributes = {}
  const intervals = []
  const mutationObservers = []
  const documentListeners = new Map()
  const nativeFetch = async (request) => {
    nativeRequests.push(request)
    return response({ native: true })
  }
  const xanoAuthFetch = async (request) => {
    authenticatedRequests.push(request)
    if (options.authFetch) return options.authFetch(request)
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
    queueMicrotask(callback) {
      callback()
    },
  }
  const document = {
    addEventListener(name, callback) {
      documentListeners.set(name, callback)
    },
    querySelectorAll() {
      return options.schedulerElements || []
    },
    documentElement: {
      setAttribute(name, value) {
        attributes[name] = value
      },
    },
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      mutationObservers.push(this)
    }

    observe() {}
  }

  vm.runInNewContext(source, {
    console: { info() {}, warn() {} },
    document,
    MutationObserver: options.withMutationObserver ? MutationObserver : undefined,
    Object,
    Request,
    Response,
    Set,
    URL,
    window,
  })

  return {
    attributes,
    authenticatedRequests,
    intervals,
    documentListeners,
    mutationObservers,
    nativeFetch,
    nativeRequests,
    window,
  }
}

test('detaches the Nylas element only after the authored success step is ready', () => {
  let removed = false
  const success = { style: { display: 'flex' } }
  const popup = {
    querySelector(selector) {
      return selector === '[schedule-step="success"]' ? success : null
    },
  }
  const scheduler = {
    closest(selector) {
      if (selector === 'nylas-scheduling') return this
      if (selector === '[popup-booking]') return popup
      return null
    },
    remove() {
      removed = true
    },
  }
  const { attributes, documentListeners } = loadStage({
    hostname: 'thestarters.com',
    pathname: '/hire/jp-testiz-d',
  })

  documentListeners.get('bookedEventInfo')({
    detail: { data: { booking_id: 'booking-1' } },
    target: scheduler,
  })

  assert.equal(removed, true)
  assert.equal(attributes['data-scheduling-booked-success'], 'ready')
})

test('keeps the Nylas element mounted when booking fails or success is not shown', () => {
  let removed = false
  const success = { style: { display: 'none' } }
  const popup = { querySelector: () => success }
  const scheduler = {
    closest(selector) {
      return selector === 'nylas-scheduling' ? this : popup
    },
    remove() {
      removed = true
    },
  }
  const { documentListeners } = loadStage({
    hostname: 'thestarters.com',
    pathname: '/hire/jp-testiz-d',
  })
  const listener = documentListeners.get('bookedEventInfo')

  listener({ detail: { error: 'provider failure' }, target: scheduler })
  listener({ detail: { data: {} }, target: scheduler })

  assert.equal(removed, false)
})

test('installs on the seven explicit staging pages', () => {
  for (const pathname of [
    '/starter-dashboard---availability-stage',
    '/brand-dashboard---availability-stage',
    '/starter-dashboard',
    '/brand-dashboard',
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

test('does not time out while a hidden scheduler is waiting to initialize', () => {
  const scheduler = {}
  const { intervals } = loadStage({
    pathname: '/hire/jp-dionisio',
    schedulerElements: [scheduler],
  })

  for (let attempt = 0; attempt < 121; attempt += 1) intervals[0].callback()
  assert.equal(intervals[0].cleared, false)
})

test('keeps retrying until every scheduler has stable identity', () => {
  const readyScheduler = { bookingInfo: JSON.stringify({ additionalFields: {} }) }
  const slowScheduler = {}
  const { intervals } = loadStage({
    pathname: '/hire/jp-dionisio',
    brandMemberstackId: 'brand-member',
    starterMemberstackId: 'starter-member',
    schedulerElements: [readyScheduler, slowScheduler],
  })

  intervals[0].callback()
  assert.equal(intervals[0].cleared, false)

  slowScheduler.bookingInfo = JSON.stringify({ additionalFields: {} })
  intervals[0].callback()

  assert.equal(
    JSON.parse(readyScheduler.bookingInfo).additionalFields.brand_memberstack_id.value,
    'brand-member',
  )
  assert.equal(
    JSON.parse(slowScheduler.bookingInfo).additionalFields.starter_memberstack_id.value,
    'starter-member',
  )
  assert.equal(intervals[0].cleared, true)
})

test('restarts retrying for a scheduler added after the first loop completed', () => {
  const schedulerElements = [
    { bookingInfo: JSON.stringify({ additionalFields: {} }) },
  ]
  const { intervals, mutationObservers } = loadStage({
    pathname: '/hire/jp-dionisio',
    brandMemberstackId: 'brand-member',
    starterMemberstackId: 'starter-member',
    schedulerElements,
    withMutationObserver: true,
  })
  assert.equal(intervals.length, 0)

  const lateScheduler = {
    nodeType: 1,
    matches(selector) {
      return selector === 'nylas-scheduling'
    },
    querySelectorAll() {
      return []
    },
  }
  schedulerElements.push(lateScheduler)
  mutationObservers[0].callback([{ addedNodes: [lateScheduler] }])
  assert.equal(intervals.length, 1)

  lateScheduler.bookingInfo = JSON.stringify({ additionalFields: {} })
  intervals[0].callback()

  assert.equal(
    JSON.parse(lateScheduler.bookingInfo).additionalFields.brand_memberstack_id.value,
    'brand-member',
  )
  assert.equal(intervals[0].cleared, true)
})

test('component manifest installs auth and routing before deferred controllers', () => {
  const scripts = scriptElementModel(componentSource)
  assert.deepEqual(
    scripts.map((script) => ({
      file: new URL(script.src).pathname.split('/').at(-1),
      defer: script.defer,
    })),
    [
      { file: 'scheduling-auth.js', defer: false },
      { file: 'scheduling-v3-stage.js', defer: false },
      { file: 'dashboard-calls.js', defer: true },
      { file: 'scheduling-availability-init.js', defer: true },
      { file: 'scheduling-availability-writer.js', defer: true },
      { file: 'scheduling-availability-section.js', defer: true },
      { file: 'free-call-settings.js', defer: true },
      { file: 'paid-call-settings.js', defer: true },
    ],
  )
})

test('maps paid-call settings routes only to their exact authenticated V3 endpoints', async () => {
  const { authenticatedRequests, nativeRequests, window } = loadStage({
    pathname: '/starter-dashboard',
  })
  const routes = [
    'starter/paid-call-settings/get',
    'starter/paid-call-settings/upsert',
    'starter/paid-call-settings/disable',
  ]

  for (const route of routes) {
    const result = await window.fetch(`${API_BASE}${route}`, {
      method: 'POST',
      body: '{}',
    })
    assert.equal(result.status, 200)
  }
  const lookalike = await window.fetch(`${API_BASE}${routes[0]}-debug`)

  assert.deepEqual(
    authenticatedRequests.map((request) => new URL(request.url).pathname),
    routes.map((route) => `/api:tCpV3oqd/${route}/v3`),
  )
  assert.equal(lookalike.status, 410)
  assert.equal((await lookalike.json()).code, 'SCHEDULING_V3_ROUTE_BLOCKED')
  assert.equal(nativeRequests.length, 0)
})

test('maps free-call settings routes only to their exact authenticated V3 endpoints', async () => {
  const { authenticatedRequests, nativeRequests, window } = loadStage({
    pathname: '/starter-dashboard',
  })
  const routes = [
    'starter/free-call-settings/get',
    'starter/free-call-settings/upsert',
    'starter/free-call-settings/disable',
  ]

  for (const route of routes) {
    const result = await window.fetch(`${API_BASE}${route}`, {
      method: 'POST',
      body: '{}',
    })
    assert.equal(result.status, 200)
  }
  const lookalike = await window.fetch(`${API_BASE}${routes[0]}-debug`)

  assert.deepEqual(
    authenticatedRequests.map((request) => new URL(request.url).pathname),
    routes.map((route) => `/api:tCpV3oqd/${route}/v3`),
  )
  assert.equal(lookalike.status, 410)
  assert.equal((await lookalike.json()).code, 'SCHEDULING_V3_ROUTE_BLOCKED')
  assert.equal(nativeRequests.length, 0)
})

test('does not install on the live profile component or unrelated production paths', () => {
  const publicProfile = loadStage({ pathname: '/detail_hire/example' })
  assert.equal(publicProfile.window.__tsSchedulingV3Stage, undefined)
  assert.equal(publicProfile.window.fetch, publicProfile.nativeFetch)

  const production = loadStage({
    hostname: 'www.thestarters.com',
    pathname: '/messages-stage',
  })
  assert.equal(production.window.__tsSchedulingV3Stage, undefined)
  assert.equal(production.window.fetch, production.nativeFetch)
})

test('installs on valid Hire profiles and canonical dashboards across both production hosts', async () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    for (const pathname of [
      '/hire/jp-testiz-d',
      '/hire/sabina-rahaman',
      '/starter-dashboard',
      '/brand-dashboard',
    ]) {
      const approved = loadStage({ hostname, pathname })
      assert.equal(approved.window.__tsSchedulingV3Stage, true)
      assert.equal(approved.attributes['data-scheduling-v3-stage'], 'ready')
    }

    for (const pathname of ['/hire', '/hire/two/levels', '/hire/Bad_Slug']) {
      const otherProfile = loadStage({ hostname, pathname })
      assert.equal(otherProfile.window.__tsSchedulingV3Stage, undefined)
      assert.equal(otherProfile.window.fetch, otherProfile.nativeFetch)
    }

    const protectedProfile = loadStage({ hostname, pathname: '/hire/jp-dionisio' })
    assert.equal(protectedProfile.window.__tsSchedulingV3InertRoute, true)
    assert.equal(protectedProfile.window.__tsSchedulingV3Stage, undefined)
    assert.equal(protectedProfile.window.StarterSchedulingV3Stage, undefined)
    assert.equal(protectedProfile.attributes['data-scheduling-v3-stage'], 'disabled')
    const blocked = await protectedProfile.window.fetch(
      `${API_BASE}starter/get_by_memberstack`,
    )
    assert.equal(blocked.status, 410)
    assert.equal((await blocked.json()).code, 'SCHEDULING_V3_ROUTE_DISABLED')
    assert.equal(protectedProfile.nativeRequests.length, 0)
    assert.equal(protectedProfile.authenticatedRequests.length, 0)
  }
})

test('keeps the protected production Test profile inert with both synchronous scripts', async () => {
  const requests = []
  const attributes = {}
  const window = {
    location: {
      hostname: 'www.thestarters.com',
      pathname: '/hire/jp-dionisio',
      href: 'https://www.thestarters.com/hire/jp-dionisio',
    },
    fetch: async (request) => {
      requests.push(request)
      return response({ native: true })
    },
    setTimeout() {},
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
    Object,
    Request,
    Response,
    Set,
    URL,
    window,
  }

  vm.runInNewContext(authSource, context)
  vm.runInNewContext(source, context)

  assert.equal(window.__tsSchedulingV3InertRoute, true)
  assert.equal(window.xanoAuthFetch, undefined)
  assert.equal(window.StarterSchedulingV3Stage, undefined)
  assert.equal(attributes['data-scheduling-v3-stage'], 'disabled')
  const blocked = await window.fetch(`${API_BASE}nylas_configurations/get_all`)
  assert.equal(blocked.status, 410)
  assert.equal(requests.length, 0)
})

test('adds stable booking identity on the exact production Live JP Hire route', () => {
  const { window } = loadStage({
    hostname: 'www.thestarters.com',
    pathname: '/hire/jp-testiz-d',
    brandMemberstackId: 'live-brand-member',
    starterMemberstackId: 'live-starter-member',
  })
  const scheduler = { bookingInfo: JSON.stringify({ additionalFields: {} }) }

  assert.equal(window.StarterSchedulingV3Stage.injectBookingIdentity(scheduler), true)
  const bookingInfo = JSON.parse(scheduler.bookingInfo)
  assert.equal(
    bookingInfo.additionalFields.brand_memberstack_id.value,
    'live-brand-member',
  )
  assert.equal(
    bookingInfo.additionalFields.starter_memberstack_id.value,
    'live-starter-member',
  )
})

test('keeps the isolated Hire stage separate from the live CMS profile path', () => {
  const stage = loadStage({ pathname: '/hire-stage' })
  assert.equal(stage.window.__tsSchedulingV3Stage, true)
  assert.equal(stage.attributes['data-scheduling-v3-stage'], 'ready')

  const liveTemplate = loadStage({ pathname: '/detail_hire' })
  assert.equal(liveTemplate.window.__tsSchedulingV3Stage, undefined)
  assert.equal(liveTemplate.window.fetch, liveTemplate.nativeFetch)
})

test('installs on valid TEST Hire profile paths', () => {
  const testProfile = loadStage({ pathname: '/hire/jp-dionisio' })
  assert.equal(testProfile.window.__tsSchedulingV3Stage, true)
  assert.equal(testProfile.attributes['data-scheduling-v3-stage'], 'ready')

  const otherProfile = loadStage({ pathname: '/hire/sabina-rahaman' })
  assert.equal(otherProfile.window.__tsSchedulingV3Stage, true)
  assert.equal(otherProfile.attributes['data-scheduling-v3-stage'], 'ready')
})

test('uses Brand-safe discovery reads only on the approved real Hire canary', async () => {
  const hire = loadStage({ pathname: '/hire/jp-dionisio' })
  const messages = loadStage({ pathname: '/messages-stage' })

  assert.equal(
    hire.window.StarterSchedulingV3Stage.routeMap['starter/get_by_memberstack'],
    'starter/get_booking_profile/v3',
  )
  assert.equal(
    hire.window.StarterSchedulingV3Stage.routeMap['starter/get_by_memberstack/v3'],
    'starter/get_booking_profile/v3',
  )
  assert.equal(
    hire.window.StarterSchedulingV3Stage.routeMap['nylas_configurations/get_all'],
    'nylas_configurations/get_bookable/v3',
  )
  assert.equal(
    hire.window.StarterSchedulingV3Stage.routeMap['nylas_configurations/get_all/v3'],
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
  await hire.window.fetch(`${API_BASE}starter/get_by_memberstack/v3`, {
    method: 'POST',
    body: JSON.stringify({ member_id: 'test-talent' }),
  })
  await hire.window.fetch(`${API_BASE}nylas_configurations/get_all/v3`, {
    method: 'POST',
    body: JSON.stringify({ grant_id: 'test-grant' }),
  })

  assert.deepEqual(
    hire.authenticatedRequests.map((request) => new URL(request.url).pathname),
    [
      '/api:tCpV3oqd/starter/get_booking_profile/v3',
      '/api:tCpV3oqd/nylas_configurations/get_bookable/v3',
      '/api:tCpV3oqd/starter/get_booking_profile/v3',
      '/api:tCpV3oqd/nylas_configurations/get_bookable/v3',
    ],
  )
})

test('remaps the versioned Hire helpers that call xanoAuthFetch directly', async () => {
  const hire = loadStage({ pathname: '/hire/jp-dionisio' })

  await hire.window.xanoAuthFetch(`${API_BASE}starter/get_by_memberstack/v3`, {
    method: 'POST',
    body: JSON.stringify({ member_id: 'test-talent' }),
  })
  await hire.window.xanoAuthFetch(`${API_BASE}nylas_configurations/get_all/v3`, {
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

test('allows reviewed Brand payment routes on dashboards and Hire', async () => {
  const dashboard = loadStage({ pathname: '/brand-dashboard' })
  const hire = loadStage({ pathname: '/hire/jp-dionisio' })
  const paymentRoutes = [
    'brand/booking/payment-action/v3',
    'brand/booking/payment-method-replace/v3',
    'brand/payment-method/setup/v3',
    'brand/payment-method/set-default/v3',
  ]

  for (const route of paymentRoutes) {
    const dashboardResponse = await dashboard.window.xanoAuthFetch(`${API_BASE}${route}`, {
      method: 'POST',
      body: '{}',
    })
    const hireResponse = await hire.window.xanoAuthFetch(`${API_BASE}${route}`, {
      method: 'POST',
      body: '{}',
    })

    assert.equal(dashboardResponse.status, 200)
    assert.equal(hireResponse.status, 200)
  }

  assert.deepEqual(
    dashboard.authenticatedRequests.map((request) =>
      new URL(typeof request === 'string' ? request : request.url).pathname
    ),
    paymentRoutes.map((route) => `/api:tCpV3oqd/${route}`),
  )
  assert.deepEqual(
    hire.authenticatedRequests.map((request) => new URL(request.url).pathname),
    paymentRoutes.map((route) => `/api:tCpV3oqd/${route}`),
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

test('routes the environment-bound Stripe Connect lookup through authenticated V3', async () => {
  const { authenticatedRequests, window } = loadStage()

  const legacy = await window.fetch(`${API_BASE}starter/get_stripe_connect_id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member_id: 'same-environment-starter' }),
  })
  const direct = await window.fetch(`${API_BASE}starter/get_stripe_connect_id/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member_id: 'same-environment-starter' }),
  })

  assert.equal(legacy.status, 200)
  assert.equal(direct.status, 200)
  assert.deepEqual(
    authenticatedRequests.map((request) => new URL(request.url).pathname),
    [
      '/api:tCpV3oqd/starter/get_stripe_connect_id/v3',
      '/api:tCpV3oqd/starter/get_stripe_connect_id/v3',
    ],
  )
})

test('returns a null connect_id when the Connect lookup has no session', async () => {
  const { window } = loadStage({
    authFetch: async () => {
      throw new Error('No Memberstack session')
    },
  })

  const legacy = await window.fetch(`${API_BASE}starter/get_stripe_connect_id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member_id: 'logged-out-visitor' }),
  })
  const direct = await window.fetch(`${API_BASE}starter/get_stripe_connect_id/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ member_id: 'logged-out-visitor' }),
  })

  assert.equal(legacy.status, 200)
  assert.equal(direct.status, 200)
  assert.deepEqual(await legacy.json(), { connect_id: null })
  assert.deepEqual(await direct.json(), { connect_id: null })
})

test('lets other authenticated routes reject when there is no session', async () => {
  const { window } = loadStage({
    authFetch: async () => {
      throw new Error('No Memberstack session')
    },
  })

  await assert.rejects(
    window.fetch(`${API_BASE}starter/get_charges_enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    /No Memberstack session/,
  )
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

test('dashboard routing reclaims the reviewed auth bridge from a competing page bridge', async () => {
  const requests = []
  let tradeCount = 0
  let competingBridgeCount = 0
  const attributes = {}
  const window = {
    location: {
      hostname: 'the-starters-3-0.webflow.io',
      pathname: '/starter-dashboard',
      href: 'https://the-starters-3-0.webflow.io/starter-dashboard',
    },
    fetch: async (request) => {
      const url = typeof request === 'string' ? request : request.url
      if (url.includes('/auth/trade-token/v3')) {
        tradeCount += 1
        return response({ authToken: 'xano-paid-settings' })
      }
      requests.push(request)
      return response({ ready: true })
    },
    setTimeout() {},
    $memberstackDom: {
      getMemberCookie: async () => 'memberstack-test-starter',
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
  window.xanoAuthFetch = async (input, init) => {
    competingBridgeCount += 1
    return window.fetch(input, init)
  }
  vm.runInNewContext(source, context)

  const result = await window.xanoAuthFetch(
    `${API_BASE}starter/paid-call-settings/get/v3`,
  )
  const lookalike = await window.xanoAuthFetch(
    `${API_BASE}starter/paid-call-settings/get/v3-debug`,
  )

  assert.equal(result.status, 200)
  assert.equal(tradeCount, 1)
  assert.equal(competingBridgeCount, 0)
  assert.equal(requests.length, 1)
  assert.equal(
    requests[0].headers.get('Authorization'),
    'Bearer xano-paid-settings',
  )
  assert.equal(lookalike.status, 410)
  assert.equal((await lookalike.json()).code, 'SCHEDULING_V3_ROUTE_BLOCKED')
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

test('blocks legacy Stripe provider calls', async () => {
  const { authenticatedRequests, nativeRequests, window } = loadStage()

  const response = await window.fetch(`${API_BASE}stripe/live/payment_intent/get`, {
    method: 'POST',
    body: '{}',
  })

  assert.equal(authenticatedRequests.length, 0)
  assert.equal(nativeRequests.length, 0)
  assert.equal(response.status, 410)
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
