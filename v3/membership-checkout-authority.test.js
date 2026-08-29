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
  const window = {
    location: {
      hostname: options.hostname || 'thestarters.com',
      pathname: options.pathname || '/quiz-results',
    },
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      addEventListener(name, listener, capture) {
        listeners.push({ name, listener, capture })
      },
    },
    setTimeout,
    $memberstackDom: {
      getMemberCookie: async () => options.memberstackToken || 'memberstack-token',
    },
    fetch: async (url, init) => {
      requests.push({ url, init })
      if (String(url).includes('/auth/trade-token/v3')) {
        return { ok: true, json: async () => ({ authToken: 'xano-token' }) }
      }
      return options.registerResponse || {
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
  assert.equal(state.storage.size, 0)
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

test('ignores non-allowlisted routes and Memberstack prices', async () => {
  const routeState = boot({ pathname: '/account-settings' })
  assert.equal(routeState.listeners.length, 0)

  const priceState = boot()
  const control = target('prc_legacy-v2')
  const event = clickEvent(control)
  await priceState.listeners[0].listener(event)

  assert.equal(event.prevented, false)
  assert.equal(priceState.requests.length, 0)
  assert.equal(control.clicks, 0)
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
