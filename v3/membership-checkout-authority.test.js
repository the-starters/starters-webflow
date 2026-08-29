const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.join(__dirname, 'membership-checkout-authority.js'),
  'utf8',
)

function target(priceId) {
  const attributes = new Map([['data-ms-price:add', priceId]])
  return {
    clicks: 0,
    closest(selector) {
      return selector === '[data-ms-price\\:add]' ? this : null
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
    },
  }
}

function boot(options = {}) {
  const requests = []
  const listeners = []
  const storage = new Map()
  const sessionStorage = options.sessionStorage || {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }
  const window = {
    location: {
      hostname: options.hostname || 'thestarters.com',
      pathname: options.pathname || '/quiz-results',
    },
    crypto: {
      randomUUID:
        options.randomUUID || (() => '12345678-1234-1234-1234-123456789abc'),
    },
    sessionStorage,
    document: {
      addEventListener(name, listener, capture) {
        listeners.push({ name, listener, capture })
      },
    },
    setTimeout,
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
      return (typeof options.registerResponse === 'function'
        ? options.registerResponse()
        : options.registerResponse) || {
        ok: true,
        json: async () => ({ ok: true, checkout_intent_id: 7 }),
      }
    },
  }
  vm.runInNewContext(source, { window, WeakSet, Promise, JSON, encodeURIComponent, Error })
  return { window, requests, listeners, storage }
}

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

test('fails closed on non-allowlisted Memberstack prices', async () => {
  const priceState = boot({ pathname: '/all-starters' })
  const control = target('prc_legacy-v2')
  const event = clickEvent(control)
  await priceState.listeners[0].listener(event)

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(priceState.requests.length, 0)
  assert.equal(control.clicks, 0)
  assert.equal(control.getAttribute('data-v3-checkout-authority'), 'error')
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

test('does not activate on a V2 host for a real V3 checkout route', () => {
  const state = boot({ hostname: 'www.hirethestarters.com', pathname: '/all-starters' })
  assert.equal(state.listeners.length, 0)
  assert.equal(state.requests.length, 0)
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
