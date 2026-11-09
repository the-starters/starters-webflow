const assert = require('node:assert/strict')
const test = require('node:test')
const { bootAllowed, viewState, isStripeUrl, createController } = require('./onboarding-v2-stripe.js')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const STATUS = XANO + '/api:KZf7nFnk/stripe_connect/status/v3'
const START = XANO + '/api:KZf7nFnk/stripe_connect/start/v3'
const TRADE = XANO + '/api:g1vmSLWh/auth/trade-token/v3?token=ms-token'

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}
async function settle() {
  for (let i = 0; i < 15; i++) await flush()
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

function makeEnv({ statuses = [{ connected: false, charges_enabled: false }], startResult, startStatus = 200, popup = true, guard = true, origin = 'https://www.thestarters.com', path = '/starter-onboarding-v2' } = {}) {
  const calls = []
  const rendered = []
  const listeners = {}
  const docListeners = []
  const startButtons = [{ handlers: [], addEventListener(type, fn) { this.handlers.push(fn) } }]
  const root = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v },
    querySelector: (sel) => (sel === '[data-onboarding-stripe-action="start"]' ? startButtons[0] : null),
  }
  const tab = { closed: false, opener: {}, url: null, location: { replace(url) { tab.url = url } }, close() { tab.closed = true } }
  let statusIndex = 0
  const win = {
    location: { origin, pathname: path, hostname: new URL(origin).hostname },
    $memberstackDom: { getMemberCookie: () => Promise.resolve('ms-token') },
    crypto: { randomUUID: () => 'uuid-1' },
    setTimeout: (fn, ms) => (ms === 15000 ? 0 : setImmediate(fn)),
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn) },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn) },
    open: () => (popup ? tab : null),
    fetch(url, options) {
      calls.push({ url, options })
      if (url === TRADE) return Promise.resolve(response(200, { authToken: 'xano-token' }))
      if (url === STATUS) {
        const body = statuses[Math.min(statusIndex, statuses.length - 1)]
        statusIndex++
        return Promise.resolve(response(200, body))
      }
      if (url === START) return Promise.resolve(response(startStatus, startResult))
      return Promise.reject(new Error('unexpected ' + url))
    },
    document: {
      querySelector: (sel) => (guard && sel === 'script[src*="/v3/staff-preview-guard.js"]' ? {} : null),
      querySelectorAll: (sel) => (sel === '[data-onboarding-stripe="root"]' ? [root] : sel === '[data-onboarding-stripe-action="start"]' ? startButtons : []),
      addEventListener: (type, fn, capture) => docListeners.push({ type, fn, capture }),
    },
  }
  let canContinue = false
  const view = {
    render: (r, state) => { rendered.push(state); return true },
    canContinue: () => canContinue,
  }
  return {
    win, view, calls, rendered, listeners, docListeners, root, tab, startButtons,
    setCanContinue(value) { canContinue = value },
  }
}

test('boot: staging route, or production only with the staff guard script', () => {
  const env = (o) => makeEnv(o).win
  assert.equal(bootAllowed(env({ origin: 'https://the-starters-3-0.webflow.io', guard: false })), true)
  assert.equal(bootAllowed(env({})), true)
  assert.equal(bootAllowed(env({ origin: 'https://thestarters.com' })), true)
  assert.equal(bootAllowed(env({ guard: false })), false)
  assert.equal(bootAllowed(env({ path: '/starter-onboarding' })), false)
  assert.equal(bootAllowed(env({ origin: 'https://www.thestarters.com.example.org' })), false)
  assert.equal(bootAllowed(env({ origin: 'http://www.thestarters.com' })), false)
})

test('status maps to the view states', () => {
  assert.equal(viewState({ connected: false, charges_enabled: false }), 'none')
  assert.equal(viewState({ connected: true, charges_enabled: false, requires_onboarding: true }), 'opened')
  assert.equal(viewState({ connected: true, charges_enabled: false, requires_onboarding: false }), 'pending')
  assert.equal(viewState({ connected: true, charges_enabled: true, requires_onboarding: false }), 'ready')
  assert.equal(viewState(null), null)
  assert.equal(viewState({ charges_enabled: true }), null)
})

test('only https connect.stripe.com URLs are accepted', () => {
  assert.equal(isStripeUrl('https://connect.stripe.com/setup/e/acct_1/abc'), true)
  assert.equal(isStripeUrl('http://connect.stripe.com/x'), false)
  assert.equal(isStripeUrl('https://connect.stripe.com.evil.com/x'), false)
  assert.equal(isStripeUrl('javascript:alert(1)'), false)
})

test('mount reads status with a Bearer token and renders it', async () => {
  const env = makeEnv({ statuses: [{ connected: true, charges_enabled: false, requires_onboarding: false }] })
  await createController(env.win, env.view).mount()
  const status = env.calls.find((c) => c.url === STATUS)
  assert.equal(status.options.method, 'POST')
  assert.equal(status.options.headers.Authorization, 'Bearer xano-token')
  assert.deepEqual(env.rendered, ['pending'])
  assert.ok(env.docListeners.some((l) => l.type === 'submit' && l.capture === true))
})

test('start: sends dashboard return_url, opens Stripe in the reserved tab, re-reads status on return', async () => {
  const env = makeEnv({
    statuses: [{ connected: false, charges_enabled: false }, { connected: true, charges_enabled: true, requires_onboarding: false }],
    startResult: { mode: 'onboarding', url: 'https://connect.stripe.com/setup/e/acct_1/x' },
  })
  const controller = createController(env.win, env.view)
  await controller.mount()
  let prevented = false
  await controller.start({ preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  const start = env.calls.find((c) => c.url === START)
  const body = JSON.parse(start.options.body)
  assert.equal(body.return_url, 'https://www.thestarters.com/starter-dashboard')
  assert.equal(body.callback_url, 'https://www.thestarters.com/stripe-connect-callback')
  assert.match(body.idempotency_key, /^onboarding-v2-start-/)
  assert.equal(env.tab.opener, null)
  assert.equal(env.tab.url, 'https://connect.stripe.com/setup/e/acct_1/x')
  assert.deepEqual(env.rendered, ['none', 'opened'])
  env.listeners.focus.forEach((fn) => fn())
  await settle()
  assert.equal(env.rendered.at(-1), 'ready')
})

test('start: a non-Stripe URL closes the tab and changes nothing', async () => {
  const env = makeEnv({ startResult: { mode: 'onboarding', url: 'https://evil.example/x' } })
  const controller = createController(env.win, env.view)
  await controller.mount()
  assert.equal(await controller.start({ preventDefault() {} }), false)
  assert.equal(env.tab.closed, true)
  assert.equal(env.tab.url, null)
  assert.deepEqual(env.rendered, ['none'])
})

test('start: blocked popup makes no start call', async () => {
  const env = makeEnv({ popup: false })
  const controller = createController(env.win, env.view)
  assert.equal(await controller.start({ preventDefault() {} }), false)
  assert.equal(env.calls.some((c) => c.url === START), false)
})

test('start: already connected closes the tab and refreshes', async () => {
  const env = makeEnv({
    statuses: [{ connected: true, charges_enabled: true, requires_onboarding: false }],
    startResult: { mode: 'connected' },
  })
  const controller = createController(env.win, env.view)
  assert.equal(await controller.start({ preventDefault() {} }), true)
  assert.equal(env.tab.closed, true)
  assert.deepEqual(env.rendered, ['ready'])
})

test('start: server error closes the tab', async () => {
  const env = makeEnv({ startStatus: 500, startResult: { message: 'x' } })
  const controller = createController(env.win, env.view)
  assert.equal(await controller.start({ preventDefault() {} }), false)
  assert.equal(env.tab.closed, true)
})

test('submit gate blocks until the view says the Stripe step can continue', () => {
  const env = makeEnv()
  const controller = createController(env.win, env.view)
  const form = { querySelector: (sel) => (sel === '[data-onboarding-stripe="root"]' ? env.root : null) }
  let prevented = 0
  let stopped = 0
  const event = { target: form, preventDefault() { prevented++ }, stopImmediatePropagation() { stopped++ } }
  controller.gateSubmit(event)
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  assert.equal(env.root.attrs['data-onboarding-stripe-required'], 'true')
  env.setCanContinue(true)
  controller.gateSubmit(event)
  assert.equal(prevented, 1)
  const otherForm = { target: { querySelector: () => null }, preventDefault() { prevented++ }, stopImmediatePropagation() {} }
  controller.gateSubmit(otherForm)
  assert.equal(prevented, 1)
})

test('unreadable status leaves the card as authored', async () => {
  const env = makeEnv({ statuses: [{ unexpected: true }] })
  await createController(env.win, env.view).mount()
  assert.deepEqual(env.rendered, [])
})
