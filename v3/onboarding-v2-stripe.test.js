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
  const finish = { hidden: true }
  const primaryStart = { hidden: false, closest: () => null }
  const retryStart = { hidden: false, closest: (sel) => (sel === '[data-onboarding-stripe-element="card"]' ? {} : null) }
  const root = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v },
    removeAttribute(k) { delete this.attrs[k] },
    querySelector: (sel) => (sel === '[data-onboarding-stripe-action="start"]' ? startButtons[0] : null),
    querySelectorAll: (sel) => (sel === '[data-onboarding-stripe-element="finish"]' ? [finish] : sel === '[data-onboarding-stripe-action="start"]' ? [retryStart, primaryStart] : []),
  }
  const tab = { closed: false, opener: {}, url: null, location: { replace(url) { tab.url = url } }, close() { tab.closed = true } }
  let statusIndex = 0
  const intervals = []
  const channels = []
  const warnings = []
  class FakeChannel {
    constructor(name) { this.name = name; this.closed = false; this.onmessage = null; channels.push(this) }
    close() { this.closed = true }
  }
  const win = {
    location: { origin, pathname: path, hostname: new URL(origin).hostname },
    $memberstackDom: { getMemberCookie: () => Promise.resolve('ms-token') },
    crypto: { randomUUID: () => 'uuid-1' },
    setTimeout: (fn, ms) => (ms === 15000 ? 0 : setImmediate(fn)),
    clearTimeout() {},
    setInterval: (fn) => { intervals.push({ fn, cleared: false }); return intervals.length - 1 },
    clearInterval(id) { if (intervals[id]) intervals[id].cleared = true },
    BroadcastChannel: FakeChannel,
    console: { log() {}, warn: (...args) => warnings.push(args) },
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
    win, view, calls, rendered, listeners, docListeners, root, tab, startButtons, intervals, channels, warnings, finish, primaryStart, retryStart,
    statusReads: () => statusIndex,
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

const NONE = { connected: false, charges_enabled: false }
const OPENED = { connected: true, charges_enabled: false, requires_onboarding: true }
const READY = { connected: true, charges_enabled: true, requires_onboarding: false }
const ONBOARDING = { mode: 'onboarding', url: 'https://connect.stripe.com/setup/e/acct_1/x' }

async function startedEnv(statuses) {
  const env = makeEnv({ statuses, startResult: ONBOARDING })
  const controller = createController(env.win, env.view)
  await controller.mount()
  await controller.start({ preventDefault() {} })
  return { env, controller }
}

test('return watch: focus re-reads once, keeps watching, and a none read keeps opened', async () => {
  const { env } = await startedEnv([NONE, NONE, NONE, READY])
  const before = env.statusReads()
  env.listeners.focus.forEach((fn) => fn())
  await settle()
  assert.equal(env.statusReads(), before + 1)
  assert.deepEqual(env.rendered, ['none', 'opened'])
  assert.equal(env.listeners.focus.length, 1)
  assert.equal(env.channels[0].closed, false)
  assert.equal(env.intervals[0].cleared, false)

  env.channels[0].onmessage({ data: { type: 'connected' } })
  await settle()
  assert.equal(env.rendered.at(-1), 'ready')
  assert.equal(env.channels[0].closed, true)
  assert.equal(env.intervals[0].cleared, true)
  assert.equal(env.listeners.focus.length, 0)
})

test('return watch: non-connected channel messages do not end the watch', async () => {
  const { env } = await startedEnv([NONE])
  env.channels[0].onmessage({ data: { type: 'other' } })
  await settle()
  assert.equal(env.channels[0].closed, false)
  assert.equal(env.intervals[0].cleared, false)
})

test('return watch: tab close ends the watch, then a none read is shown', async () => {
  const { env } = await startedEnv([NONE])
  env.intervals[0].fn()
  assert.equal(env.intervals[0].cleared, false)
  env.tab.closed = true
  env.intervals[0].fn()
  await settle()
  assert.equal(env.intervals[0].cleared, true)
  assert.equal(env.channels[0].closed, true)
  assert.equal(env.rendered.at(-1), 'none')
})

test('return watch: a second start replaces the first watch', async () => {
  const { env, controller } = await startedEnv([NONE])
  await controller.start({ preventDefault() {} })
  assert.equal(env.channels.length, 2)
  assert.equal(env.channels[0].closed, true)
  assert.equal(env.channels[1].closed, false)
  assert.equal(env.listeners.focus.length, 1)
})

test('start error: failures mark every root and always warn', async () => {
  const blocked = makeEnv({ popup: false, origin: 'https://www.thestarters.com' })
  assert.equal(await createController(blocked.win, blocked.view).start({ preventDefault() {} }), false)
  assert.equal(blocked.root.attrs['data-onboarding-stripe-error'], 'start')
  assert.equal(blocked.warnings.length, 1)

  const server = makeEnv({ startStatus: 500, startResult: { message: 'x' } })
  await createController(server.win, server.view).start({ preventDefault() {} })
  assert.equal(server.root.attrs['data-onboarding-stripe-error'], 'start')
  assert.equal(server.warnings.length, 1)

  const bad = makeEnv({ startResult: { mode: 'onboarding', url: 'https://evil.example/x' } })
  await createController(bad.win, bad.view).start({ preventDefault() {} })
  assert.equal(bad.root.attrs['data-onboarding-stripe-error'], 'start')
})

test('start error: cleared by a successful start', async () => {
  const env = makeEnv({ statuses: [NONE], startResult: ONBOARDING })
  const controller = createController(env.win, env.view)
  env.root.attrs['data-onboarding-stripe-error'] = 'start'
  await controller.start({ preventDefault() {} })
  assert.equal('data-onboarding-stripe-error' in env.root.attrs, false)
})

test('start error: cleared by a status read other than none, kept by none', async () => {
  const none = makeEnv({ statuses: [NONE] })
  none.root.attrs['data-onboarding-stripe-error'] = 'start'
  await createController(none.win, none.view).refresh()
  assert.equal(none.root.attrs['data-onboarding-stripe-error'], 'start')

  const opened = makeEnv({ statuses: [OPENED] })
  opened.root.attrs['data-onboarding-stripe-error'] = 'start'
  await createController(opened.win, opened.view).refresh()
  assert.equal('data-onboarding-stripe-error' in opened.root.attrs, false)
})

test('footer: Finish shows and primary start hides once Stripe is started; retry is untouched', async () => {
  const env = makeEnv({
    statuses: [{ connected: false, charges_enabled: false }],
    startResult: { mode: 'onboarding', url: 'https://connect.stripe.com/oauth/v2/authorize?x=1' },
  })
  const controller = createController(env.win, env.view)
  await controller.mount()
  assert.equal(env.finish.hidden, true)
  assert.equal(env.primaryStart.hidden, false)
  await controller.start({ preventDefault() {} })
  assert.equal(env.rendered.at(-1), 'opened')
  assert.equal(env.finish.hidden, false)
  assert.equal(env.primaryStart.hidden, true)
  assert.equal(env.retryStart.hidden, false)
})

test('footer: a ready account on load shows Finish', async () => {
  const env = makeEnv({ statuses: [{ connected: true, charges_enabled: true, requires_onboarding: false }] })
  await createController(env.win, env.view).mount()
  assert.equal(env.finish.hidden, false)
  assert.equal(env.primaryStart.hidden, true)
})

test('footer: tab closed with nothing connected goes back to Connect Stripe', async () => {
  const env = makeEnv({
    statuses: [{ connected: false, charges_enabled: false }],
    startResult: { mode: 'onboarding', url: 'https://connect.stripe.com/oauth/v2/authorize?x=1' },
  })
  const controller = createController(env.win, env.view)
  await controller.mount()
  await controller.start({ preventDefault() {} })
  assert.equal(env.finish.hidden, false)
  env.tab.closed = true
  env.intervals[0].fn()
  await settle()
  assert.equal(env.rendered.at(-1), 'none')
  assert.equal(env.finish.hidden, true)
  assert.equal(env.primaryStart.hidden, false)
})
