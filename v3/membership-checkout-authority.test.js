const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.join(__dirname, 'membership-checkout-authority.js'),
  'utf8',
)

function target(priceId, onClick) {
  const attributes = new Map([['data-ms-price:add', priceId]])
  const spinner = { style: { display: 'none' } }
  const control = {
    clicks: 0,
    spinner,
    closest(selector) {
      return selector === '[data-ms-price\\:add]' ? this : null
    },
    querySelector(selector) {
      return selector === '[data-button-spinner]' ? spinner : null
    },
    getAttribute(name) {
      return attributes.get(name) || null
    },
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    removeAttribute(name) {
      attributes.delete(name)
    },
    click() {
      this.clicks += 1
      if (onClick) onClick()
    },
  }
  control.child = {
    clicks: 0,
    closest(selector) {
      return selector === '[data-ms-price\\:add]' ? control : null
    },
    click() {
      this.clicks += 1
    },
  }
  return control
}

function boot(options = {}) {
  const requests = []
  const listeners = []
  const observers = []
  const storage = options.storage || new Map()
  const local = options.local || new Map()
  const pixelEvents = []
  const historyUpdates = []
  const purchaseStates = []
  const sessionStorage = options.sessionStorage || {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }
  const window = {
    location: {
      hostname: options.hostname || 'thestarters.com',
      pathname: options.pathname || '/quiz-results',
      search: options.search || '',
      hash: options.hash || '',
    },
    crypto: {
      randomUUID:
        options.randomUUID || (() => '12345678-1234-1234-1234-123456789abc'),
    },
    sessionStorage,
    localStorage: options.localStorage || {
      getItem: (key) => local.get(key) || null,
      setItem: (key, value) => local.set(key, value),
      removeItem: (key) => local.delete(key),
    },
    URLSearchParams,
    AbortController,
    history: { state: null, replaceState: (_state, _title, url) => historyUpdates.push(url) },
    navigator: { locks: options.locks === false ? null : options.locks || { request: async (_name, action) => action() } },
    fbq: options.fbq === null ? undefined : options.fbq || ((...args) => pixelEvents.push(args)),
    addEventListener(name, listener, capture) {
      listeners.push({ target: 'window', name, listener, capture })
    },
    document: {
      documentElement: { setAttribute: (_key, value) => purchaseStates.push(value) },
      querySelector(selector) {
        return selector === '[data-ms-action="logout"] [data-ms-loader]'
          ? options.logoutLoader || null
          : null
      },
      addEventListener(name, listener, capture) {
        listeners.push({ target: 'document', name, listener, capture })
      },
    },
    setTimeout: options.fastTimers ? (fn, ms) => setTimeout(fn, ms === 12000 ? ms : 0) : setTimeout,
    clearTimeout,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
        observers.push(this)
      }
      observe(element) {
        this.element = element
      }
      disconnect() {
        this.disconnected = true
      }
    },
    $memberstackDom: {
      getCurrentMember: async () => ({
        data:
          typeof options.currentMember === 'function'
            ? options.currentMember()
            : { id: options.memberId || 'member-a' },
      }),
      getMemberCookie: async () => options.memberstackToken || 'memberstack-token',
    },
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (String(url).includes('/auth/trade-token/v3')) {
        return (
          options.authResponse || {
            ok: true,
            json: async () => ({ authToken: 'xano-token' }),
          }
        )
      }
      if (String(url).includes('/membership/checkout-receipt/v3')) {
        return { ok: true, json: async () => typeof options.receipt === 'function' ? options.receipt() : options.receipt }
      }
      return (typeof options.registerResponse === 'function'
        ? options.registerResponse()
        : options.registerResponse) || {
        ok: true,
        json: async () => ({ ok: true, checkout_intent_id: 7 }),
      }
    },
  }
  vm.runInNewContext(source, { window, WeakSet, Promise, JSON, encodeURIComponent, Error })
  return { window, requests, listeners, observers, storage, local, pixelEvents, historyUpdates, purchaseStates }
}

test('binds ahead of Memberstack document capture regardless of load order', async () => {
  const state = boot()
  const control = target('prc_premium-monthly--fn1ae0qjj')
  const event = clickEvent(control)
  let nativeCheckoutOpened = false

  state.listeners.push({
    target: 'document',
    name: 'click',
    capture: true,
    listener() {
      nativeCheckoutOpened = true
    },
  })

  assert.equal(state.listeners[0].target, 'window')
  assert.equal(state.listeners[0].capture, true)
  for (const binding of state.listeners) {
    if (event.stopped) break
    await binding.listener(event)
  }

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(nativeCheckoutOpened, false)
  assert.equal(state.requests.length, 2)
  assert.equal(control.clicks, 1)
})

function clickEvent(element) {
  return {
    target: element,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopImmediatePropagation() {
      this.stopped = true
    },
  }
}

test('registers one V3 intent before resuming native Memberstack checkout', async () => {
  const state = boot()
  const control = target('prc_premium-monthly--fn1ae0qjj')
  const event = clickEvent(control)

  await state.listeners[0].listener(event)

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(control.clicks, 1)
  assert.equal(state.requests.length, 2)
  const register = state.requests[1]
  assert.equal(
    register.url,
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/membership/checkout-intent/v3',
  )
  assert.equal(register.init.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(JSON.parse(register.init.body), {
    source_event_id: 'evt_12345678-1234-1234-1234-123456789abc',
    source_route: '/quiz-results',
    stripe_price_id: 'prc_premium-monthly--fn1ae0qjj',
  })
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'accepted')
  assert.equal(state.storage.size, 1)
})

test('replays the original child click target after intent registration', async () => {
  const state = boot()
  const control = target('prc_premium-monthly--fn1ae0qjj')
  const event = clickEvent(control.child)

  await state.listeners[0].listener(event)

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(control.clicks, 0)
  assert.equal(control.child.clicks, 1)
  assert.equal(state.requests.length, 2)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'accepted')
})

test('shows the clicked checkout spinner without lighting Sign Out while preparing checkout', async () => {
  let finishAuth
  const logoutLoader = { style: { display: 'none', visibility: '' } }
  const state = boot({
    logoutLoader,
    authResponse: {
      ok: true,
      json: () => new Promise((resolve) => { finishAuth = resolve }),
    },
  })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  const operation = state.listeners[0].listener(clickEvent(control))
  await new Promise(setImmediate)
  assert.equal(control.spinner.style.display, 'flex')
  assert.equal(control.getAttribute('data-opp-loading'), 'true')
  assert.equal(logoutLoader.style.visibility, 'hidden')

  finishAuth({})
  await operation
  assert.equal(control.spinner.style.display, 'none')
  assert.equal(logoutLoader.style.visibility, '')
})

function nativeActionNode(matchFragment) {
  return {
    closest(selector) {
      return selector.indexOf(matchFragment) !== -1 ? this : null
    },
  }
}

test('releases the Sign Out loader hold immediately when a real logout begins mid-checkout', async () => {
  let finishAuth
  const logoutLoader = { style: { display: 'none', visibility: 'visible' } }
  const state = boot({
    logoutLoader,
    authResponse: {
      ok: true,
      json: () => new Promise((resolve) => { finishAuth = resolve }),
    },
  })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  const operation = state.listeners[0].listener(clickEvent(control))
  await new Promise(setImmediate)
  assert.equal(logoutLoader.style.visibility, 'hidden')

  await state.listeners[1].listener({ target: nativeActionNode('data-ms-action="logout"') })
  assert.equal(logoutLoader.style.visibility, 'visible')

  finishAuth({})
  await operation
  assert.equal(logoutLoader.style.visibility, 'visible')
})

test('releases the Sign Out loader hold when a real logout begins after checkout is accepted', async () => {
  const logoutLoader = { style: { display: 'none', visibility: 'visible' } }
  const state = boot({ logoutLoader })
  const control = target('prc_paid-annual-2o5f040u')

  await state.listeners[0].listener(clickEvent(control))
  assert.equal(logoutLoader.style.visibility, 'hidden')

  await state.listeners[1].listener({ target: nativeActionNode('data-ms-action="logout"') })
  assert.equal(logoutLoader.style.visibility, 'visible')

  state.observers[0].callback()
  assert.equal(logoutLoader.style.visibility, 'visible')
})

test('releases the Sign Out loader hold on a real profile form submit mid-checkout', async () => {
  let finishAuth
  const logoutLoader = { style: { display: 'none', visibility: 'visible' } }
  const state = boot({
    logoutLoader,
    authResponse: {
      ok: true,
      json: () => new Promise((resolve) => { finishAuth = resolve }),
    },
  })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  const operation = state.listeners[0].listener(clickEvent(control))
  await new Promise(setImmediate)
  assert.equal(logoutLoader.style.visibility, 'hidden')

  await state.listeners[2].listener({ target: nativeActionNode('data-ms-form') })
  assert.equal(logoutLoader.style.visibility, 'visible')

  finishAuth({})
  await operation
})

test('an unrelated click during checkout leaves the Sign Out loader hold in place', async () => {
  let finishAuth
  const logoutLoader = { style: { display: 'none', visibility: 'visible' } }
  const state = boot({
    logoutLoader,
    authResponse: {
      ok: true,
      json: () => new Promise((resolve) => { finishAuth = resolve }),
    },
  })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  const operation = state.listeners[0].listener(clickEvent(control))
  await new Promise(setImmediate)
  assert.equal(logoutLoader.style.visibility, 'hidden')

  await state.listeners[1].listener({ target: nativeActionNode('unrelated') })
  assert.equal(logoutLoader.style.visibility, 'hidden')

  finishAuth({})
  await operation
  assert.equal(logoutLoader.style.visibility, 'visible')
})

test('keeps Sign Out hidden while Memberstack loads checkout, then restores it', async () => {
  const logoutLoader = { style: { display: 'none', visibility: 'visible' } }
  const state = boot({ logoutLoader })
  const control = target('prc_paid-annual-2o5f040u', () => {
    logoutLoader.style.display = 'flex'
  })

  await state.listeners[0].listener(clickEvent(control))
  assert.equal(control.clicks, 1)
  assert.equal(control.spinner.style.display, 'flex')
  assert.equal(control.getAttribute('data-opp-loading'), 'true')
  assert.equal(logoutLoader.style.visibility, 'hidden')

  logoutLoader.style.display = 'none'
  state.observers[0].callback()
  assert.equal(control.spinner.style.display, 'none')
  assert.equal(control.getAttribute('data-opp-loading'), null)
  assert.equal(logoutLoader.style.visibility, 'visible')
  assert.equal(state.observers[0].disconnected, true)
})

test('keeps the Get Started spinner lit through a bounded fallback when there is no Sign Out loader', async () => {
  const state = boot({ logoutLoader: null })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))

  assert.equal(control.clicks, 1)
  assert.equal(control.spinner.style.display, 'flex')
  assert.equal(control.getAttribute('data-opp-loading'), 'true')

  await new Promise((resolve) => setTimeout(resolve, 3000))

  assert.equal(control.spinner.style.display, 'none')
  assert.equal(control.getAttribute('data-opp-loading'), null)
})

test('keeps the Memberstack session token out of authentication URLs', async () => {
  const state = boot({ memberstackToken: 'private-memberstack-token' })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))

  const authentication = state.requests[0]
  assert.equal(
    authentication.url,
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh/auth/trade-token/v3',
  )
  assert.equal(authentication.init.method, 'POST')
  assert.equal(authentication.init.headers['Content-Type'], 'application/json')
  assert.equal(authentication.url.includes('private-memberstack-token'), false)
  assert.deepEqual(JSON.parse(authentication.init.body), {
    token: 'private-memberstack-token',
  })
})

test('fails closed when V3 intent registration fails', async () => {
  const state = boot({
    registerResponse: { ok: false, status: 409, json: async () => ({}) },
  })
  const control = target('prc_paid-annual-2o5f040u')
  const event = clickEvent(control)

  await state.listeners[0].listener(event)

  assert.equal(event.prevented, true)
  assert.equal(control.clicks, 0)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
  assert.match(control.getAttribute('title'), /could not be prepared/)
  assert.equal(state.storage.size, 1)
})

test('fails closed when the Memberstack session cannot authenticate as user_v3', async () => {
  const state = boot({
    authResponse: { ok: false, status: 401, json: async () => ({}) },
  })
  const control = target('prc_premium-monthly--fn1ae0qjj')
  const event = clickEvent(control)

  await state.listeners[0].listener(event)

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(control.clicks, 0)
  assert.equal(state.requests.length, 1)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
  assert.match(control.getAttribute('title'), /session exchange failed/)
})

test('retries registration with the same event identity after cleanup', async () => {
  let attempts = 0
  const state = boot({
    registerResponse: () => {
      attempts += 1
      return attempts === 1
        ? { ok: false, status: 503, json: async () => ({}) }
        : {
            ok: true,
            json: async () => ({ ok: true, checkout_intent_id: 7 }),
          }
    },
  })
  const control = target('prc_paid-annual-2o5f040u')

  await state.listeners[0].listener(clickEvent(control))
  const firstEventId = JSON.parse(state.requests[1].init.body).source_event_id
  assert.equal(control.clicks, 0)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')

  await state.listeners[0].listener(clickEvent(control))
  const secondEventId = JSON.parse(state.requests[3].init.body).source_event_id
  assert.equal(secondEventId, firstEventId)
  assert.equal(control.clicks, 1)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'accepted')
  assert.equal(state.storage.size, 1)
})

test('does not activate on V2 host', () => {
  const state = boot({ hostname: 'www.hirethestarters.com' })
  assert.equal(state.listeners.length, 0)
  assert.equal(state.requests.length, 0)
})

test('normalizes the supported quiz-results trailing-slash route', async () => {
  const state = boot({ pathname: '/quiz-results/' })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))

  assert.equal(control.clicks, 1)
  assert.deepEqual(JSON.parse(state.requests[1].init.body), {
    source_event_id: 'evt_12345678-1234-1234-1234-123456789abc',
    source_route: '/quiz-results',
    stripe_price_id: 'prc_premium-monthly--fn1ae0qjj',
  })
})

test('registers an exact V3 intent from the all-starters shared paywall', async () => {
  const state = boot({ pathname: '/all-starters/' })
  const control = target('prc_paid-annual-2o5f040u')

  await state.listeners[0].listener(clickEvent(control))

  assert.equal(control.clicks, 1)
  assert.deepEqual(JSON.parse(state.requests[1].init.body), {
    source_event_id: 'evt_12345678-1234-1234-1234-123456789abc',
    source_route: '/all-starters',
    stripe_price_id: 'prc_paid-annual-2o5f040u',
  })
})

test('registers an exact V3 intent from one canonical hire profile', async () => {
  const state = boot({ pathname: '/hire/jp-test/' })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))

  assert.equal(control.clicks, 1)
  assert.equal(JSON.parse(state.requests[1].init.body).source_route, '/hire/jp-test')
})

test('registers from the exact public Join CTA route families', async () => {
  for (const pathname of [
    '/why-us',
    '/categories/growth',
    '/subcategories/paid-social',
    '/companies/example-brand',
    '/competitors/example-brand',
    '/functions/marketing',
    '/industries/beauty',
    '/roles/head-of-growth',
    '/skills/paid-social',
    '/tools/klaviyo',
  ]) {
    const state = boot({ pathname })
    const control = target('prc_premium-monthly--fn1ae0qjj')
    await state.listeners[0].listener(clickEvent(control))
    assert.equal(control.clicks, 1, pathname)
    assert.equal(JSON.parse(state.requests[1].init.body).source_route, pathname)
  }
})

test('registers checkout intents from Learn pages', async () => {
  for (const pathname of [
    '/learn',
    '/learn/sessions',
    '/learn/sessions/partnerships-playbook',
    '/learn/interviews-analysis/how-to-build-trust',
    '/learn/playbooks-frameworks/the-live-shopping-playbook',
    '/learn/frameworks-playbooks',
    '/learn/events',
  ]) {
    for (const priceId of [
      'prc_premium-monthly--fn1ae0qjj',
      'prc_paid-annual-2o5f040u',
    ]) {
      const state = boot({ pathname: pathname + '/' })
      const control = target(priceId)
      await state.listeners[0].listener(clickEvent(control))
      assert.equal(control.clicks, 1, pathname)
      assert.equal(JSON.parse(state.requests[1].init.body).source_route, pathname)
    }
  }
})

test('registers checkout intents from Become a Starter and case studies', async () => {
  for (const pathname of [
    '/become-a-starter',
    '/case-studies',
    '/case-studies/how-birddogs-found-an-elite-ui-ux-designer-on-the-starters',
  ]) {
    for (const priceId of [
      'prc_premium-monthly--fn1ae0qjj',
      'prc_paid-annual-2o5f040u',
    ]) {
      const state = boot({ pathname: pathname + '/' })
      const control = target(priceId)
      await state.listeners[0].listener(clickEvent(control))
      assert.equal(control.clicks, 1, pathname)
      assert.equal(JSON.parse(state.requests[1].init.body).source_route, pathname)
    }
  }
})

test('fails closed on non-allowlisted Memberstack prices', async () => {
  for (const pathname of ['/all-starters', '/learn/sessions/partnerships-playbook']) {
    const priceState = boot({ pathname })
    const control = target('prc_legacy-v2')
    const event = clickEvent(control)
    await priceState.listeners[0].listener(event)

    assert.equal(event.prevented, true, pathname)
    assert.equal(event.stopped, true, pathname)
    assert.equal(priceState.requests.length, 0, pathname)
    assert.equal(control.clicks, 0, pathname)
    assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
  }
})

test('fails closed on non-checkout V3 routes', async () => {
  for (const pathname of [
    '/brand-dashboard',
    '/ALL-STARTERS',
    '/hire',
    '/hire/',
    '/hire/JP-test',
    '/hire/jp-test/edit',
    '/hire/jp--test',
    '/hire/%2fbrand-dashboard',
    '/partners/example',
    '/services/example',
    '/categories/example/edit',
    '/learning',
    '/learn/Bad-Slug',
    '/learn/sessions//item',
    '/learn/sessions/%2fitem',
    '/case-studies/Bad-Slug',
    '/case-studies/example/edit',
    '/case-studies/%2fbrand-dashboard',
    '/case-studies-archive/example',
  ]) {
    const state = boot({ pathname })
    const control = target('prc_premium-monthly--fn1ae0qjj')
    const event = clickEvent(control)
    await state.listeners[0].listener(event)
    assert.equal(event.prevented, true, pathname)
    assert.equal(event.stopped, true, pathname)
    assert.equal(state.requests.length, 0, pathname)
    assert.equal(control.clicks, 0, pathname)
    assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
  }
})

test('does not activate on other hosts for a Learn checkout route', () => {
  for (const [hostname, pathname] of [
    ['www.hirethestarters.com', '/all-starters'],
    ['www.hirethestarters.com', '/learn/sessions/partnerships-playbook'],
    ['www.thestarters.com.evil.test', '/learn/sessions/partnerships-playbook'],
  ]) {
    const state = boot({ hostname, pathname })
    assert.equal(state.listeners.length, 0, hostname + pathname)
    assert.equal(state.requests.length, 0, hostname + pathname)
  }
})

test('a bypassed replay continues without a second registration', async () => {
  const state = boot()
  const control = target('prc_premium-monthly--fn1ae0qjj')
  await state.listeners[0].listener(clickEvent(control))

  const replayEvent = clickEvent(control)
  await state.listeners[0].listener(replayEvent)

  assert.equal(replayEvent.prevented, false)
  assert.equal(replayEvent.stopped, false)
  assert.equal(state.requests.length, 2)
})

test('a closed checkout reuses the accepted pending intent', async () => {
  const state = boot({ pathname: '/all-starters' })
  const control = target('prc_paid-annual-2o5f040u')

  await state.listeners[0].listener(clickEvent(control))
  await state.listeners[0].listener(clickEvent(control))
  await state.listeners[0].listener(clickEvent(control))

  assert.equal(state.requests.length, 4)
  const first = JSON.parse(state.requests[1].init.body)
  const second = JSON.parse(state.requests[3].init.body)
  assert.deepEqual(second, first)
  assert.equal(control.clicks, 2)
})

test('a route change reuses the original immutable pending route and event', async () => {
  const state = boot({ pathname: '/all-starters' })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))
  await state.listeners[0].listener(clickEvent(control))
  state.window.location.pathname = '/hire/jp-test'
  await state.listeners[0].listener(clickEvent(control))

  const first = JSON.parse(state.requests[1].init.body)
  const second = JSON.parse(state.requests[3].init.body)
  assert.deepEqual(second, first)
  assert.equal(second.source_route, '/all-starters')
})

test('replaces a pending identity when the authenticated member changes', async () => {
  let memberId = 'member-a'
  let sequence = 0
  const state = boot({
    currentMember: () => ({ id: memberId }),
    randomUUID: () =>
      sequence++ === 0
        ? '12345678-1234-1234-1234-123456789abc'
        : '87654321-4321-4321-4321-cba987654321',
  })

  await state.listeners[0].listener(
    clickEvent(target('prc_premium-monthly--fn1ae0qjj')),
  )
  memberId = 'member-b'
  await state.listeners[0].listener(
    clickEvent(target('prc_premium-monthly--fn1ae0qjj')),
  )

  const first = JSON.parse(state.requests[1].init.body)
  const second = JSON.parse(state.requests[3].init.body)
  assert.notEqual(second.source_event_id, first.source_event_id)
  assert.equal(
    JSON.parse(
      state.storage.get(
        'ts:v3:membership-checkout-intent:prc_premium-monthly--fn1ae0qjj',
      ),
    ).memberId,
    'member-b',
  )
})

test('fails closed when checkout identity storage is unavailable', async () => {
  const state = boot({
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  })
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))

  assert.equal(state.requests.length, 1)
  assert.match(state.requests[0].url, /\/auth\/trade-token\/v3$/)
  assert.equal(control.clicks, 0)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
  assert.match(control.getAttribute('title'), /storage is unavailable/)
})

test('replaces malformed stored identity before checkout', async () => {
  const state = boot()
  state.storage.set(
    'ts:v3:membership-checkout-intent:prc_premium-monthly--fn1ae0qjj',
    '{malformed',
  )
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))

  assert.equal(control.clicks, 1)
  assert.equal(state.requests.length, 2)
  assert.equal(
    JSON.parse(state.requests[1].init.body).source_event_id,
    'evt_12345678-1234-1234-1234-123456789abc',
  )
})

test('clears the pending state when secure event identity generation fails', async () => {
  const state = boot()
  state.window.crypto.randomUUID = () => {
    throw new Error('entropy unavailable')
  }
  const control = target('prc_premium-monthly--fn1ae0qjj')

  await state.listeners[0].listener(clickEvent(control))
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
  assert.equal(control.clicks, 0)

  state.window.crypto.randomUUID = () => '12345678-1234-1234-1234-123456789abc'
  await state.listeners[0].listener(clickEvent(control))
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'accepted')
  assert.equal(control.clicks, 1)
})

const monthlyPrice = 'prc_premium-monthly--fn1ae0qjj'
const annualPrice = 'prc_paid-annual-2o5f040u'
const canonicalIntent = 'a'.repeat(64)
function returnedPurchase(options = {}) {
  const priceId = options.priceId || monthlyPrice
  const storage = options.storage || new Map()
  if (!options.storage) storage.set('ts:v3:membership-checkout-intent:' + priceId, JSON.stringify({
    memberId: options.memberId || 'mem_production', intentKey: canonicalIntent,
    eventId: 'evt_12345678-1234-1234-1234-123456789abc', sourceRoute: '/quiz-results',
    expiresAt: Date.now() + 60000,
  }))
  return boot({
    pathname: '/dashboard', memberId: 'mem_production', storage,
    search: '?fromCheckout=true&msPriceId=' + priceId + '&stripePriceId=price_real&value=999999&keep=yes',
    hash: '#welcome', fastTimers: true,
    receipt: {
      ok: true, status: 'paid', intent_key: canonicalIntent, stripe_price_id: priceId,
      transaction_id: 'cs_live_transaction1', amount_total: 29500, currency: 'USD', source_environment: 'production',
    }, ...options,
  })
}
async function finishPurchase(state) {
  await state.window.StartersMembershipCheckoutAuthority.resumeCheckoutReturn()
}

test('sends the verified discounted monthly amount to the installed pixel, ignoring URL value', async () => {
  const state = returnedPurchase({ receipt: {
    ok: true, status: 'paid', intent_key: canonicalIntent, stripe_price_id: monthlyPrice,
    transaction_id: 'cs_live_discounted', amount_total: 22125, currency: 'USD', source_environment: 'production',
  } })
  await finishPurchase(state)
  assert.equal(state.pixelEvents.length, 1)
  const [action, pixelId, name, payload, identity] = state.pixelEvents[0]
  assert.equal(action, 'trackSingle')
  assert.equal(pixelId, '775648331097942')
  assert.equal(name, 'Purchase')
  assert.equal(payload.value, 221.25)
  assert.equal(payload.currency, 'USD')
  assert.deepEqual(Array.from(payload.content_ids), [monthlyPrice])
  assert.equal(identity.eventID, 'cs_live_discounted')
  assert.deepEqual(state.historyUpdates, ['/dashboard?value=999999&keep=yes#welcome'])
  assert.equal(state.storage.size, 0)
})

test('sends zero for a verified fully discounted checkout and suppresses refresh duplicates', async () => {
  const local = new Map()
  const receipt = {
    ok: true, status: 'paid', intent_key: canonicalIntent, stripe_price_id: monthlyPrice,
    transaction_id: 'cs_live_fullDiscount', amount_total: 0, fully_discounted: true,
    currency: 'USD', source_environment: 'production',
  }
  const first = returnedPurchase({local, receipt})
  await finishPurchase(first)
  assert.equal(first.pixelEvents.length, 1)
  assert.equal(first.pixelEvents[0][2], 'Purchase')
  assert.equal(first.pixelEvents[0][3].value, 0)
  assert.equal(first.pixelEvents[0][3].currency, 'USD')
  assert.equal(first.pixelEvents[0][4].eventID, 'cs_live_fullDiscount')
  const refresh = returnedPurchase({local, receipt})
  await finishPurchase(refresh)
  assert.equal(refresh.pixelEvents.length, 0)
  assert.ok(refresh.purchaseStates.includes('already-sent'))
})

test('sends the annual amount from the receipt', async () => {
  const state = returnedPurchase({priceId: annualPrice, receipt: {
    ok: true, status: 'paid', intent_key: canonicalIntent, stripe_price_id: annualPrice,
    transaction_id: 'cs_live_annual', amount_total: 234000, currency: 'USD', source_environment: 'production',
  }})
  await finishPurchase(state)
  assert.equal(state.pixelEvents[0][3].value, 2340)
})

test('captures return before dashboard navigation and resumes on the Brand destination', async () => {
  let resolveAuth
  const state = returnedPurchase({ authResponse: {ok: true, json: () => new Promise(resolve => { resolveAuth = resolve })} })
  assert.ok(state.storage.has('ts:v3:membership-checkout-return'))
  const next = returnedPurchase({ pathname: '/brand-dashboard', search: '', storage: state.storage })
  await finishPurchase(next)
  assert.equal(next.pixelEvents.length, 1)
  assert.equal(next.storage.size, 0)
  // Simulate destruction of the old page's outstanding fetch during navigation.
  for (let count = 0; !resolveAuth && count < 10; count++) await new Promise(resolve => setImmediate(resolve))
  resolveAuth(null)
  await finishPurchase(state)
  assert.equal(state.pixelEvents.length, 0)
})

test('refresh and a second tab use the same transaction marker and cross-tab lock', async () => {
  let chain = Promise.resolve()
  const locks = {request: (_key, action) => {
    const result = chain.then(action)
    chain = result.catch(() => {})
    return result
  }}
  const local = new Map()
  const first = returnedPurchase({local, locks})
  const second = returnedPurchase({local, locks})
  await Promise.all([finishPurchase(first), finishPurchase(second)])
  assert.equal(first.pixelEvents.length + second.pixelEvents.length, 1)
  const refresh = returnedPurchase({local})
  await finishPurchase(refresh)
  assert.equal(refresh.pixelEvents.length, 0)
  assert.ok(refresh.purchaseStates.includes('already-sent'))
})

test('ordinary dashboard visits, free signup, and cancelled checkout do not send Purchase', async () => {
  for (const search of ['', '?fromCheckout=false&msPriceId=' + monthlyPrice, '?value=295', '?fromCheckout=true&msPriceId=unknown']) {
    const state = returnedPurchase({search})
    await finishPurchase(state)
    assert.equal(state.pixelEvents.length, 0)
    assert.equal(state.requests.length, 0)
  }
  const noIntent = returnedPurchase({storage: new Map()})
  await finishPurchase(noIntent)
  assert.equal(noIntent.pixelEvents.length, 0)
})

test('pending webhook is retried, and a still-pending receipt is retained for refresh', async () => {
  let calls = 0
  const ready = { ok: true, status: 'paid', intent_key: canonicalIntent, stripe_price_id: monthlyPrice,
    transaction_id: 'cs_live_delayed', amount_total: 29500, currency: 'USD', source_environment: 'production' }
  const delayed = returnedPurchase({receipt: () => ++calls < 3 ? {ok: true, status: 'pending'} : ready})
  await finishPurchase(delayed)
  assert.equal(calls, 3)
  assert.equal(delayed.pixelEvents.length, 1)
  const pending = returnedPurchase({receipt: {ok: true, status: 'pending'}})
  await finishPurchase(pending)
  assert.equal(pending.pixelEvents.length, 0)
  assert.ok(pending.storage.has('ts:v3:membership-checkout-return'))
  assert.equal(pending.purchaseStates.at(-1), 'pending')
})

test('rejects unverified, unattested zero, non-finite, fractional cents, wrong currency, price, intent and environment receipts', async () => {
  const valid = {ok: true, status: 'paid', intent_key: canonicalIntent, stripe_price_id: monthlyPrice,
    transaction_id: 'cs_live_valid', amount_total: 29500, currency: 'USD', source_environment: 'production'}
  for (const override of [{ok: false}, {status: 'unpaid'}, {amount_total: 0}, {amount_total: 0, fully_discounted: 'true'}, {amount_total: 0, fully_discounted: false}, {amount_total: -1, fully_discounted: true},
    {amount_total: Infinity}, {amount_total: '29500'}, {amount_total: 1.5}, {currency: 'EUR'},
    {stripe_price_id: annualPrice}, {intent_key: 'b'.repeat(64)}, {source_environment: 'test'},
    {transaction_id: 'cs_test_wrongmode'}, {transaction_id: 'sub_123'}]) {
    const state = returnedPurchase({receipt: {...valid, ...override}})
    await finishPurchase(state)
    assert.equal(state.pixelEvents.length, 0, JSON.stringify(override))
  }
})

test('test-mode verification never sends test revenue to the production pixel', async () => {
  for (const amount of [{amount_total: 29500}, {amount_total: 0, fully_discounted: true}]) {
    const state = returnedPurchase({hostname: 'the-starters-3-0.webflow.io', memberId: 'mem_sb_test', receipt: {
      ok: true, status: 'paid', intent_key: canonicalIntent, stripe_price_id: monthlyPrice,
      transaction_id: 'cs_test_valid', ...amount, currency: 'USD', source_environment: 'test',
    }})
    await finishPurchase(state)
    assert.equal(state.pixelEvents.length, 0)
    assert.equal(state.purchaseStates.at(-1), 'test-verified')
  }
})

test('member changes before the receipt or pixel dispatch fail closed', async () => {
  for (const changeAt of [1, 3, 4]) {
    let reads = 0
    const state = returnedPurchase({currentMember: () => ({id: ++reads >= changeAt ? 'mem_other' : 'mem_production'})})
    await finishPurchase(state)
    assert.equal(state.pixelEvents.length, 0)
  }
})

test('blocked storage, missing pixel, and unsupported cross-tab locks never send unguarded events', async () => {
  for (const options of [{localStorage: {getItem() {throw new Error('blocked')}}}, {fbq: null}, {locks: false}]) {
    const state = returnedPurchase(options)
    await finishPurchase(state)
    assert.equal(state.pixelEvents.length, 0)
    assert.ok(state.storage.has('ts:v3:membership-checkout-return'))
  }
})

test('synchronous pixel failure releases the transaction marker so refresh can retry', async () => {
  const local = new Map()
  const failure = returnedPurchase({local, fbq: () => {throw new Error('pixel failure')}})
  await finishPurchase(failure)
  assert.equal(local.size, 0)
  const retry = returnedPurchase({local, storage: failure.storage, search: ''})
  await finishPurchase(retry)
  assert.equal(retry.pixelEvents.length, 1)
})

test('a coalesced registration stores the canonical intent key and server expiry', async () => {
  const expires = Date.now() + 30000
  const state = boot({registerResponse: {ok: true, json: async () => ({ok: true, intent_key: canonicalIntent, expires_at: expires})}})
  await state.window.StartersMembershipCheckoutAuthority.handleCheckout(clickEvent(target(monthlyPrice)))
  const persisted = JSON.parse(state.storage.get('ts:v3:membership-checkout-intent:' + monthlyPrice))
  assert.equal(persisted.intentKey, canonicalIntent)
  assert.equal(persisted.expiresAt, expires)
})

// Visible failure message (Lea Richards CX 2026-10-08): a fail-closed click
// must not look like a dead button.
function fakeElement(tag) {
  const attributes = new Map()
  return {
    tagName: tag,
    style: {},
    childNodes: [],
    parentNode: null,
    _text: '',
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child },
    set textContent(value) { this._text = String(value); this.childNodes = [] },
    get textContent() {
      return this._text + this.childNodes.map((child) => child.textContent).join('')
    },
  }
}

function withVisibleDom(state, control) {
  const warnings = []
  const parent = {
    children: [control],
    insertBefore(node, reference) {
      const index = reference ? this.children.indexOf(reference) : -1
      if (index === -1) this.children.push(node)
      else this.children.splice(index, 0, node)
      node.parentNode = this
      return node
    },
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node)
      node.parentNode = null
      return node
    },
  }
  control.parentNode = parent
  control.nextSibling = null
  state.window.document.createElement = (tag) => fakeElement(tag)
  state.window.document.createTextNode = (text) => ({ textContent: String(text) })
  state.window.console = { warn: (...args) => warnings.push(args) }
  const messages = () => parent.children.filter((child) => child !== control)
  return { parent, warnings, messages }
}

const notEligibleResponse = (message) => ({
  ok: false,
  status: 401,
  json: async () => ({ code: 'ERROR_CODE_UNAUTHORIZED', message }),
})

for (const serverMessage of [
  'Brand plan is not eligible for V3 checkout',
  'Canonical V3 Brand identity is incomplete',
]) {
  test(`shows a visible support message when the server says: ${serverMessage}`, async () => {
    const state = boot({ registerResponse: notEligibleResponse(serverMessage) })
    const control = target('prc_premium-monthly--fn1ae0qjj')
    const dom = withVisibleDom(state, control)

    await state.listeners[0].listener(clickEvent(control))

    assert.equal(control.clicks, 0)
    assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
    assert.match(control.getAttribute('title'), /could not be prepared/)
    const [note] = dom.messages()
    assert.equal(dom.messages().length, 1)
    assert.equal(note.getAttribute('role'), 'alert')
    assert.equal(note.getAttribute('aria-live'), 'assertive')
    assert.equal(note.getAttribute('data-v3-checkout-message'), 'not-eligible')
    assert.equal(
      note.textContent,
      "Your account can't be upgraded online right now. Please contact support at hello@hirethestarters.com.",
    )
    const link = note.childNodes.find((child) => child.tagName === 'a')
    assert.equal(link.getAttribute('href'), 'mailto:hello@hirethestarters.com')
    assert.deepEqual(JSON.parse(JSON.stringify(dom.warnings)), [
      ['[membership-checkout] checkout could not start', { reason: 'not-eligible', status: 401 }],
    ])
  })
}

test('shows the retry message for server, network, and session failures', async () => {
  const cases = [
    { registerResponse: { ok: false, status: 503, json: async () => ({}) }, status: 503 },
    { registerResponse: { ok: false, status: 400, json: async () => ({ message: 'Invalid V3 checkout event identity' }) }, status: 400 },
    { registerResponse: notEligibleResponse('Invalid token'), status: 401 },
    { registerResponse: notEligibleResponse('Starter is not eligible for V3 checkout during migration'), status: 401 },
    { registerResponse: () => { throw new TypeError('Failed to fetch') }, status: null },
    { authResponse: { ok: false, status: 401, json: async () => ({ message: 'not eligible' }) }, status: 401 },
  ]
  for (const options of cases) {
    const state = boot(options)
    const control = target('prc_paid-annual-2o5f040u')
    const dom = withVisibleDom(state, control)

    await state.listeners[0].listener(clickEvent(control))

    assert.equal(control.clicks, 0)
    const [note] = dom.messages()
    assert.equal(dom.messages().length, 1)
    assert.equal(note.getAttribute('role'), 'alert')
    assert.equal(note.getAttribute('data-v3-checkout-message'), 'unavailable')
    assert.equal(note.textContent, 'Checkout could not start. Please try again.')
    assert.deepEqual(JSON.parse(JSON.stringify(dom.warnings)), [
      ['[membership-checkout] checkout could not start', { reason: 'unavailable', status: options.status }],
    ])
  }
})

test('shows a visible message on non-allowlisted routes without calling Xano', async () => {
  for (const pathname of ['/brand-dashboard', '/favorites', '/messages', '/opportunities', '/complete-profile']) {
    const state = boot({ pathname })
    const control = target('prc_premium-monthly--fn1ae0qjj')
    const dom = withVisibleDom(state, control)
    const event = clickEvent(control)

    await state.listeners[0].listener(event)

    assert.equal(event.prevented, true, pathname)
    assert.equal(state.requests.length, 0, pathname)
    assert.equal(control.clicks, 0, pathname)
    assert.equal(control.getAttribute('title'), 'This checkout is not available from this V3 page')
    assert.equal(dom.messages().length, 1, pathname)
    assert.equal(dom.messages()[0].textContent, 'Checkout could not start. Please try again.')
  }
})

test('the next attempt removes the message, and repeated failures keep only one', async () => {
  let attempts = 0
  const state = boot({
    registerResponse: () => {
      attempts += 1
      return attempts < 3
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, json: async () => ({ ok: true, checkout_intent_id: 7 }) }
    },
  })
  const control = target('prc_paid-annual-2o5f040u')
  const dom = withVisibleDom(state, control)

  await state.listeners[0].listener(clickEvent(control))
  const first = dom.messages()[0]
  await state.listeners[0].listener(clickEvent(control))
  assert.equal(dom.messages().length, 1)
  assert.notEqual(dom.messages()[0], first)
  assert.equal(first.parentNode, null)

  await state.listeners[0].listener(clickEvent(control))
  assert.equal(dom.messages().length, 0)
  assert.equal(control.clicks, 1)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'accepted')
})

test('a missing DOM API keeps checkout fail-closed without throwing', async () => {
  const state = boot({ registerResponse: notEligibleResponse('Brand plan is not eligible for V3 checkout') })
  const control = target('prc_premium-monthly--fn1ae0qjj')
  control.parentNode = { insertBefore() { throw new Error('detached') } }
  state.window.document.createElement = (tag) => fakeElement(tag)
  state.window.document.createTextNode = (text) => ({ textContent: String(text) })

  await state.listeners[0].listener(clickEvent(control))

  assert.equal(control.clicks, 0)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
})
