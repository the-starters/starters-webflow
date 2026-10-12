const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./dashboard-call-payment.js')
const canonicalActions = require('./dashboard-call-actions.js')
global.StartersDashboardCallActions = canonicalActions

function paidBooking(status) {
  const booking = {
    booking_id: 'booking-paid-1',
    paid_meeting: true,
    payment_environment: 'test',
    data_environment: 'test',
    payment_status: status,
    status: 'confirmed',
    start: Date.now() + 30 * 3600000,
    server_now_ms: Date.now(),
  }
  canonicalActions.bindCanonicalClock([booking], canonicalActions.monotonicNow())
  return booking
}

test('a booking card replacement retains identity on retry and stops stale callers', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  let current = true
  global.xanoAuthFetch = async (url, options) => {
    requests.push(JSON.parse(options.body))
    if (requests.length === 1) throw new Error('Ambiguous response')
    return { ok: true, json: async () => ({ payment_recovery: {
      booking_id: 'booking-paid-1', payment_status: 'authorized',
    } }) }
  }
  try {
    const booking = paidBooking('card_or_payment_declined')
    const attempt = api.createCardReplacementAttempt('brand', booking, 'pm_chosen', () => current)
    booking.booking_id = 'different-booking'
    const first = attempt.run()
    assert.equal(attempt.run(), first)
    await assert.rejects(first, /Ambiguous/)
    const result = await attempt.run()
    assert.deepEqual(requests[1], requests[0])
    assert.equal(requests[0].booking_id, 'booking-paid-1')
    assert.equal(requests[0].payment_method_id, 'pm_chosen')
    assert.equal(await attempt.run(), result)
    assert.equal(requests.length, 2)
    current = false
    await assert.rejects(attempt.run(), /context changed/)
    assert.equal(requests.length, 2)
  } finally { global.xanoAuthFetch = previous }
})

test('replacement completion cannot report success to a different booking context', async () => {
  const previous = global.xanoAuthFetch
  let release
  let current = true
  let requests = 0
  global.xanoAuthFetch = () => {
    requests += 1
    return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({
      payment_recovery: { booking_id: 'booking-paid-1', payment_status: 'authorized' },
    }) }) })
  }
  try {
    const attempt = api.createCardReplacementAttempt('brand', paidBooking('card_or_payment_declined'), 'pm_chosen', () => current)
    const pending = attempt.run()
    current = false
    release()
    await assert.rejects(pending, /context changed/)
    await assert.rejects(attempt.run(), /context changed/)
    assert.equal(requests, 1)
  } finally { global.xanoAuthFetch = previous }
})

test('payment recovery eligibility is Brand-only and status exact', () => {
  assert.equal(
    api.canRequestPaymentAction('brand', paidBooking('auth_required')),
    true,
  )
  assert.equal(
    api.canRequestPaymentAction('starter', paidBooking('auth_required')),
    false,
  )
  assert.equal(
    api.canReplacePaymentMethod(
      'brand',
      paidBooking('card_or_payment_declined'),
    ),
    true,
  )
  assert.equal(
    api.canReplacePaymentMethod('brand', paidBooking('authorized')),
    false,
  )
  assert.equal(
    api.canReplacePaymentMethod('brand', {
      ...paidBooking('expired_card'),
      payment_environment: '',
    }),
    false,
  )
})

test('payment action retrieves only the booking-scoped canonical secret', async () => {
  const original = global.xanoAuthFetch
  const requests = []
  try {
    global.xanoAuthFetch = async function (url, options) {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            booking_id: 'booking-paid-1',
            payment_status: 'auth_required',
            client_secret: 'pi_secret_test',
          }
        },
      }
    }
    const result = await api.getPaymentAction(
      'brand',
      paidBooking('auth_required'),
    )
    assert.equal(result.client_secret, 'pi_secret_test')
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/brand\/booking\/payment-action\/v3$/)
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      booking_id: 'booking-paid-1',
    })
  } finally {
    global.xanoAuthFetch = original
  }
})

test('payment-method replacement uses the canonical reconciliation command', async () => {
  const original = global.xanoAuthFetch
  const requests = []
  const key =
    'dashboard-payment-replace:00000000-0000-4000-8000-000000000001'
  try {
    global.xanoAuthFetch = async function (url, options) {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            payment_recovery: {
              booking_id: 'booking-paid-1',
              payment_status: 'authorized',
              requires_action: false,
            },
            duplicate: false,
          }
        },
      }
    }
    const result = await api.replacePaymentMethod(
      'brand',
      paidBooking('expired_card'),
      'pm_test_1',
      key,
    )
    assert.equal(result.payment_recovery.payment_status, 'authorized')
    assert.equal(requests.length, 1)
    assert.match(
      requests[0].url,
      /\/brand\/booking\/payment-method-replace\/v3$/,
    )
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      booking_id: 'booking-paid-1',
      payment_method_id: 'pm_test_1',
      idempotency_key: key,
    })
  } finally {
    global.xanoAuthFetch = original
  }
})

test('dashboard Change Payment Method binds the selected booking to recovery', async () => {
  const previous = { client: global.StartersPaidCallBrandPayment, actions: global.StartersDashboardCallActions, fetch: global.xanoAuthFetch }
  let listener, pickerOptions, loaded = 0, restarted = 0
  const panels = []
  const requests = []
  const booking = paidBooking('card_or_payment_declined')
  const modal = { open: true, querySelector: () => ({}) }
  const button = { getAttribute: () => 'change-card', hasAttribute: () => false,
    closest: selector => selector === '[popup-booking-info]' ? modal : selector === '[payment-action-btn], [popup-stripe-card-open]' ? button : null }
  const document = { addEventListener: (event, fn) => { listener = fn } }
  global.StartersPaidCallBrandPayment = {
    getReadiness: async () => ({ environment: 'test' }),
    installSavedCardPicker: (panel, options) => { pickerOptions = options; return { load: async () => { loaded += 1 }, dispose() {} } },
    installCardSetupForm() {}, stripeForPaymentEnvironment() {},
  }
  global.StartersDashboardCallActions = { switchPopupContent: (root, panel) => panels.push(panel), showActionError: (root, message) => { throw Error(message) } }
  global.xanoAuthFetch = async (url, options) => {
    requests.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ payment_recovery: { booking_id: booking.booking_id, payment_status: 'authorized' } }) }
  }
  try {
    assert.equal(await api.wire({ document, role: 'brand', getBooking: () => booking, restart: async () => { restarted += 1 } }), true)
    await listener({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
    assert.equal(loaded, 1)
    assert.deepEqual(panels, ['payment-methods'])
    assert.equal(pickerOptions.environment, 'test')
    await pickerOptions.onSaved('pm_selected')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].booking_id, booking.booking_id)
    assert.equal(requests[0].payment_method_id, 'pm_selected')
    assert.equal(restarted, 1)
    assert.equal(panels.at(-1), 'base')
    modal.open = false
    assert.equal(pickerOptions.isCurrent(), false)
  } finally {
    global.StartersPaidCallBrandPayment = previous.client
    global.StartersDashboardCallActions = previous.actions
    global.xanoAuthFetch = previous.fetch
  }
})

test('payment module requires an explicit Brand booking context to activate', async () => {
  assert.equal(await api.wire(), false)
  assert.equal(await api.wire({ role: 'starter', document: {}, getBooking() {} }), false)
  assert.equal(api.validPaymentMethodId('pm_test_1'), true)
  assert.equal(api.validPaymentMethodId('card_test_1'), false)
  assert.equal(api.validReplacementKey('invalid'), false)
})

async function paymentRaceHarness(run) {
  const client = require('./paid-call-brand-payment.js')
  const previous = { client: global.StartersPaidCallBrandPayment, actions: global.StartersDashboardCallActions, fetch: global.xanoAuthFetch, Stripe: global.Stripe }
  class Node {
    constructor() { this.listeners = {}; this.style = {}; this.attrs = {}; this.children = [] }
    setAttribute(key, value) { this.attrs[key] = value }
    getAttribute(key) { return this.attrs[key] }
    removeAttribute(key) { delete this.attrs[key] }
    querySelectorAll() { return [] }
    querySelector() { return null }
    addEventListener(key, fn) { this.listeners[key] = fn }
    removeEventListener(key) { delete this.listeners[key] }
    appendChild(child) { this.children.push(child) }
    replaceChildren() { this.children = [] }
    insertBefore() {}
    remove() {}
    cloneNode() { return new Node() }
  }
  const document = new Node()
  const created = []
  document.createElement = () => { const node = new Node(); created.push(node); return node }
  // A reopened picker renders a fresh consent control; the newest one is live.
  const consentInput = () => created.filter(node => node.attrs['data-payment-consent-input'] !== undefined).at(-1)
  const panel = new Node(), use = new Node(), list = new Node(), template = new Node()
  list.parentNode = new Node()
  panel.ownerDocument = document
  panel.querySelector = selector => selector === '[pm-use-this]' ? use : selector === '[customer-cards-list]' ? list : template
  const modal = new Node(), add = new Node(), nativeAdd = new Node(), cardModal = new Node()
  modal.open = true
  modal.querySelector = () => panel
  modal.querySelectorAll = () => [add]
  add.querySelectorAll = () => [nativeAdd]
  let forms = 0, refreshes = 0, defaults = 0, recoveries = 0, lists = 0
  let releaseRead, releaseRecovery
  let holdRead = false, holdRecovery = false
  cardModal.showModal = () => { cardModal.open = true }
  cardModal.close = () => { cardModal.open = false; cardModal.listeners.close?.() }
  document.querySelector = () => cardModal
  const booking = paidBooking('card_or_payment_declined')
  global.StartersPaidCallBrandPayment = { ...client, getReadiness: async () => ({ environment: 'test' }),
    stripeForPaymentEnvironment: async () => ({}), installCardSetupForm: () => { forms++; return { dispose() {} } } }
  global.StartersDashboardCallActions = { switchPopupContent() {} }
  // The saved-card path confirms an off-session SetupIntent for the chosen card.
  global.Stripe = () => ({ confirmCardSetup: async (secret, options) => ({ setupIntent: { id: 'seti_dashboard', payment_method: options.payment_method, status: 'succeeded' } }) })
  global.xanoAuthFetch = async url => {
    if (url.endsWith(client.SETUP_PATH)) return { ok: true, json: async () => ({ environment: 'test', setup_intent_id: 'seti_dashboard', client_secret: 'secret' }) }
    if (url.endsWith(client.SET_DEFAULT_PATH)) { defaults++; return { ok: true, json: async () => ({ environment: 'test', bookable: true }) } }
    if (url.endsWith(client.PAYMENT_METHODS_PATH)) {
      lists++
      if (holdRead) await new Promise(resolve => { releaseRead = resolve })
      return { ok: true, json: async () => ({ environment: 'test', items: [{ id: 'pm_one', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, is_default: true }], has_more: false, next_cursor: '' }) }
    }
    recoveries++
    if (holdRecovery) await new Promise(resolve => { releaseRecovery = resolve })
    return { ok: true, json: async () => ({ payment_recovery: { booking_id: booking.booking_id, payment_status: 'authorized' } }) }
  }
  const event = target => ({ target, preventDefault() {}, stopImmediatePropagation() {} })
  const click = async action => {
    const button = new Node()
    button.getAttribute = () => action
    button.hasAttribute = () => false
    button.closest = selector => selector === '[popup-booking-info]' ? modal : selector === '[payment-action-btn], [popup-stripe-card-open]' ? button : null
    await document.listeners.click(event(button))
  }
  const tick = () => new Promise(resolve => setImmediate(resolve))
  try {
    await api.wire({ document, role: 'brand', getBooking: () => booking, restart: async () => { refreshes++ } })
    await click('change-card')
    await run({ click, tick, modal, nativeAdd, cardModal,
      save: () => {
        const input = consentInput()
        if (input) { input.checked = true; input.listeners.change?.({ type: 'change' }) }
        return use.listeners.click(event(use))
      },
      close: () => { modal.open = false; document.listeners.close(event(modal)); modal.open = true },
      holdRead: () => { holdRead = true }, releaseRead: () => { holdRead = false; releaseRead() },
      holdRecovery: () => { holdRecovery = true }, releaseRecovery: () => { holdRecovery = false; releaseRecovery() },
      state: () => ({ forms, refreshes, defaults, recoveries, lists }) })
  } finally {
    global.StartersPaidCallBrandPayment = previous.client
    global.StartersDashboardCallActions = previous.actions
    global.xanoAuthFetch = previous.fetch
    global.Stripe = previous.Stripe
  }
}

test('close and reopen during canonical default readback cannot revive recovery', async () => {
  await paymentRaceHarness(async h => {
    h.holdRead()
    const pending = h.save()
    await h.tick()
    assert.equal(h.state().defaults, 1)
    h.close()
    h.releaseRead()
    await pending
    assert.equal(h.state().recoveries, 0)
    assert.equal(h.state().refreshes, 0)
    await h.click('change-card')
    await h.save()
    assert.equal(h.state().recoveries, 1)
    assert.equal(h.state().refreshes, 1)
  })
})

test('Add and double selection stay blocked through default readback and recovery', async () => {
  await paymentRaceHarness(async h => {
    h.holdRead()
    h.holdRecovery()
    const pending = h.save()
    await h.tick()
    assert.equal(h.nativeAdd.disabled, true)
    await h.click('add-card')
    await h.save()
    assert.equal(h.state().forms, 0)
    assert.equal(h.state().defaults, 1)
    h.releaseRead()
    await h.tick()
    assert.equal(h.state().recoveries, 1)
    await h.click('add-card')
    assert.equal(h.state().forms, 0)
    h.releaseRecovery()
    await pending
    assert.equal(h.nativeAdd.disabled, false)
    await h.click('add-card')
    assert.equal(h.state().forms, 1)
    await h.save()
    assert.equal(h.state().defaults, 1)
    h.cardModal.close()
    await h.click('add-card')
    assert.equal(h.state().forms, 2)
  })
})

test('a failed Change card open shows a Brand-facing message, never a route path', async () => {
  const previous = { client: global.StartersPaidCallBrandPayment, actions: global.StartersDashboardCallActions, warn: console.warn }
  let listener
  const shown = []
  const warned = []
  const booking = paidBooking('card_or_payment_declined')
  const basePanel = {}
  const modal = { open: true, querySelector: selector => selector === '[booking-popup-content="base"]' ? basePanel : {} }
  const button = { getAttribute: () => 'change-card', hasAttribute: () => false,
    closest: selector => selector === '[popup-booking-info]' ? modal : selector === '[payment-action-btn], [popup-stripe-card-open]' ? button : null }
  const document = { addEventListener: (event, fn) => { listener = fn } }
  global.StartersPaidCallBrandPayment = {
    // The real client throws this when the readiness route returns no body.
    getReadiness: async () => { throw new Error('/brand/payment/readiness/v3 returned no data') },
    installSavedCardPicker() { throw new Error('picker must not install after a failed readiness read') },
    installCardSetupForm() {}, stripeForPaymentEnvironment() {},
  }
  global.StartersDashboardCallActions = { switchPopupContent() {}, showActionError: (root, message) => shown.push({ root, message }) }
  console.warn = (...args) => warned.push(args.join(' '))
  try {
    assert.equal(await api.wire({ document, role: 'brand', getBooking: () => booking }), true)
    await listener({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
    assert.equal(shown.length, 1)
    assert.equal(shown[0].root, basePanel)
    assert.doesNotMatch(shown[0].message, /\/|v3|returned no data/)
    assert.equal(shown[0].message, 'Your payment methods could not be opened. Please try again.')
    // The diagnostic detail stays available to support in the console.
    assert.ok(warned.some(line => line.includes('/brand/payment/readiness/v3 returned no data')))
  } finally {
    global.StartersPaidCallBrandPayment = previous.client
    global.StartersDashboardCallActions = previous.actions
    console.warn = previous.warn
  }
})

test('P9 approve payment runs the Stripe bank step with the canonical secret only', async () => {
  const original = global.xanoAuthFetch
  const requests = []
  const secrets = []
  const stripe = { handleNextAction: async ({ clientSecret }) => { secrets.push(clientSecret); return { paymentIntent: { status: 'requires_capture' } } } }
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ booking_id: 'booking-paid-1', payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: 'requires_action' }) }
  }
  try {
    assert.equal(await api.approvePayment('brand', paidBooking('auth_required'), stripe), 'requires_capture')
    assert.deepEqual(secrets, ['pi_secret_test'])
    assert.match(requests[0].url, /\/brand\/booking\/payment-action\/v3$/)
    // A declined card, a Starter, or a missing Stripe client never reaches the route.
    assert.equal(await api.approvePayment('brand', paidBooking('card_or_payment_declined'), stripe), null)
    assert.equal(await api.approvePayment('starter', paidBooking('auth_required'), stripe), null)
    await assert.rejects(api.approvePayment('brand', paidBooking('auth_required'), {}))
    assert.equal(requests.length, 1)
    const failing = { handleNextAction: async () => ({ error: { message: 'bank said no' } }) }
    await assert.rejects(api.approvePayment('brand', paidBooking('auth_required'), failing), /did not complete/)
  } finally { global.xanoAuthFetch = original }
})

test('P9 dashboard Approve payment is single-flight, Brand-only and reloads the booking', async () => {
  const previous = { client: global.StartersPaidCallBrandPayment, actions: global.StartersDashboardCallActions, fetch: global.xanoAuthFetch }
  let listener, restarted = 0, release
  const errors = []
  const booking = paidBooking('auth_required')
  const modal = { open: true, querySelector: () => ({}) }
  const attrs = {}
  const button = { getAttribute: name => name === 'payment-action-btn' ? 'approve-payment' : null, hasAttribute: () => false,
    setAttribute: (name, value) => { attrs[name] = value },
    closest: selector => selector === '[popup-booking-info]' ? modal : selector === '[payment-action-btn], [popup-stripe-card-open]' ? button : null }
  const document = { addEventListener: (event, fn) => { if (event === 'click') listener = fn } }
  const gate = new Promise(resolve => { release = resolve })
  let bankSteps = 0
  global.StartersPaidCallBrandPayment = {
    getReadiness: async () => ({ environment: 'test' }), installSavedCardPicker() {}, installCardSetupForm() {},
    stripeForPaymentEnvironment: async env => {
      assert.equal(env, 'test')
      return { handleNextAction: async () => { bankSteps += 1; await gate; return { paymentIntent: { status: 'requires_capture' } } } }
    },
  }
  global.StartersDashboardCallActions = { canonicalNow: canonicalActions.canonicalNow, switchPopupContent() {}, showActionError: (root, message) => errors.push(message) }
  global.xanoAuthFetch = async () => ({ ok: true, json: async () => ({ booking_id: booking.booking_id, payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: 'requires_action' }) })
  try {
    assert.equal(await api.wire({ document, role: 'brand', getBooking: () => booking, restart: async () => { restarted += 1; booking.payment_status = 'intent_created'; booking.payment_reconciliation_status = 'reconciled'; return true } }), true)
    assert.equal(api.canApprovePayment('brand', booking), true)
    assert.equal(api.canApprovePayment('starter', booking), false)
    assert.equal(api.canApprovePayment('brand', paidBooking('card_or_payment_declined')), false)
    const event = () => ({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
    const first = listener(event())
    await new Promise(resolve => setImmediate(resolve))
    await listener(event())
    assert.equal(attrs['aria-disabled'], 'true')
    release()
    await first
    assert.equal(bankSteps, 1)
    assert.equal(restarted, 1)
    assert.deepEqual(errors, [])
    assert.equal(attrs['aria-disabled'], 'false')
  } finally {
    global.StartersPaidCallBrandPayment = previous.client
    global.StartersDashboardCallActions = previous.actions
    global.xanoAuthFetch = previous.fetch
  }
})

test('P9 review: approve only on a live call before start, never twice for a stale modal', async () => {
  const H = 3600000
  const at = (extra) => Object.assign(paidBooking('auth_required'), extra)
  assert.equal(api.canRequestPaymentAction('brand', at({})), true)
  assert.equal(api.canRequestPaymentAction('brand', at({ status: 'rescheduled', start_old: Date.now() + H })), true)
  assert.equal(api.canRequestPaymentAction('brand', at({ status: 'rescheduled', start_old: Date.now() - 1, start: Date.now() + H })), false)
  assert.equal(api.canRequestPaymentAction('brand', at({ start: new Date(Date.now() + H).toISOString() })), true)
  for (const extra of [{ status: 'cancelled' }, { status: 'completed' }, { status: 'pending' }, { status: 'rescheduled', start_old: null }, { status: 'rescheduled', start_old: 'invalid', start: Date.now() + H }, { start: Date.now() - 1 }, { start: null }]) {
    assert.equal(api.canRequestPaymentAction('brand', at(extra)), false, JSON.stringify(extra))
  }
  // W5 environment switch: production rows stay closed until the list opens.
  assert.deepEqual(api.PAYMENT_ACTION_OPEN_ENVIRONMENTS, ['test'])
  for (const extra of [{ data_environment: 'production' }, { data_environment: '' }, { data_environment: undefined }]) {
    assert.equal(api.canRequestPaymentAction('brand', at(extra)), false, JSON.stringify(extra))
    assert.equal(api.canApprovePayment('brand', at(extra)), false, JSON.stringify(extra))
  }
  const previous = global.xanoAuthFetch
  global.xanoAuthFetch = async () => ({ ok: true, json: async () => ({ booking_id: 'booking-paid-1', payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: 'requires_action' }) })
  try {
    let calls = 0
    const stripe = status => ({ handleNextAction: async () => { calls += 1; return { paymentIntent: { status } } } })
    assert.equal(await api.approvePayment('brand', at({}), stripe('requires_capture'), () => false), null)
    assert.equal(calls, 0)
    assert.equal(await api.approvePayment('brand', at({}), stripe('processing'), () => true), 'processing')
    await assert.rejects(api.approvePayment('brand', at({}), stripe('requires_payment_method')), /unexpected state/)
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('P9 A: off-session 3DS (requires_payment_method) confirms on-session with the saved card', async () => {
  const previous = global.xanoAuthFetch
  global.xanoAuthFetch = async () => ({ ok: true, json: async () => ({ booking_id: 'booking-paid-1', payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: 'requires_payment_method', payment_method: 'pm_saved_1' }) })
  try {
    const calls = []
    const stripe = {
      handleNextAction: async () => { calls.push('next'); return { paymentIntent: { status: 'requires_capture' } } },
      confirmCardPayment: async (secret, data) => { calls.push(['confirm', secret, data.payment_method]); return { paymentIntent: { status: 'requires_capture' } } },
    }
    assert.equal(await api.approvePayment('brand', paidBooking('auth_required'), stripe, () => true), 'requires_capture')
    assert.deepEqual(calls, [['confirm', 'pi_secret_test', 'pm_saved_1']])
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => ({ booking_id: 'booking-paid-1', payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: 'requires_payment_method', payment_method: '' }) })
    await assert.rejects(api.approvePayment('brand', paidBooking('auth_required'), stripe, () => true), /unavailable/)
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => ({ booking_id: 'booking-paid-1', payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: 'requires_action' }) })
    calls.length = 0
    assert.equal(await api.approvePayment('brand', paidBooking('auth_required'), stripe, () => true), 'requires_capture')
    assert.deepEqual(calls, ['next'])
  } finally { global.xanoAuthFetch = previous }
})

test('P9 A: unexpected provider status fails before Stripe action', async () => {
  const previous = global.xanoAuthFetch
  const states = [
    {},
    { provider_status: '' },
    { provider_status: 'processing' },
  ]
  try {
    for (const state of states) {
      let actions = 0
      global.xanoAuthFetch = async () => ({ ok: true, json: async () => Object.assign({ booking_id: 'booking-paid-1', payment_status: 'auth_required', client_secret: 'pi_secret_test' }, state) })
      const stripe = {
        handleNextAction: async () => { actions += 1; return { paymentIntent: { status: 'requires_capture' } } },
        confirmCardPayment: async () => { actions += 1; return { paymentIntent: { status: 'requires_capture' } } },
      }
      await assert.rejects(api.approvePayment('brand', paidBooking('auth_required'), stripe, () => true), /invalid/)
      assert.equal(actions, 0, JSON.stringify(state))
    }
  } finally { global.xanoAuthFetch = previous }
})


const PAYMENT_SERVER_NOW = 1800000000000
async function withPaymentClock(run) {
  const originalPerformance = Object.getOwnPropertyDescriptor(global, 'performance')
  const originalWall = Date.now
  const originalActions = global.StartersDashboardCallActions
  let monotonic = 100
  let wall = PAYMENT_SERVER_NOW
  Object.defineProperty(global, 'performance', { configurable: true, value: { now: () => monotonic } })
  Date.now = () => wall
  global.StartersDashboardCallActions = canonicalActions
  const bound = extra => {
    const booking = Object.assign(paidBooking('auth_required'), { server_now_ms: PAYMENT_SERVER_NOW, start: PAYMENT_SERVER_NOW + 1000 }, extra)
    assert.equal(canonicalActions.bindCanonicalClock([booking], monotonic, wall), true)
    return booking
  }
  try { await run({ bound, setMonotonic: value => { monotonic = value }, setWall: value => { wall = value } }) }
  finally {
    Date.now = originalWall
    Object.defineProperty(global, 'performance', originalPerformance)
    global.StartersDashboardCallActions = originalActions
  }
}

async function approvalWireHarness(booking, run, stripeLoad) {
  const previous = { client: global.StartersPaidCallBrandPayment, fetch: global.xanoAuthFetch }
  const calls = { stripeLoads: [], routes: [], bankSteps: [], refreshes: 0 }
  let currentBooking = booking
  let listener
  const modal = { open: true, querySelector: () => ({}) }
  const button = {
    getAttribute: name => name === 'payment-action-btn' ? 'approve-payment' : null,
    hasAttribute: () => false, setAttribute() {},
    closest: selector => selector === '[popup-booking-info]' ? modal : selector === '[payment-action-btn], [popup-stripe-card-open]' ? button : null,
  }
  const document = { addEventListener: (event, fn) => { if (event === 'click') listener = fn } }
  global.StartersPaidCallBrandPayment = {
    getReadiness: async () => ({ environment: 'test' }), installSavedCardPicker() {}, installCardSetupForm() {},
    stripeForPaymentEnvironment: async env => {
      calls.stripeLoads.push(env)
      if (stripeLoad) await stripeLoad()
      return { handleNextAction: async action => {
        calls.bankSteps.push(action)
        return { paymentIntent: { status: 'requires_capture' } }
      } }
    },
  }
  global.xanoAuthFetch = async (url, options) => {
    calls.routes.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ booking_id: 'booking-paid-1', payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: 'requires_action' }) }
  }
  try {
    assert.equal(await api.wire({ document, role: 'brand', getBooking: () => currentBooking, restart: async () => { calls.refreshes += 1; currentBooking = { ...currentBooking, payment_status: 'intent_created', payment_reconciliation_status: 'reconciled' }; return true } }), true)
    await run({ calls, modal, replaceBooking: value => { currentBooking = value }, click: () => listener({ target: button, preventDefault() {}, stopImmediatePropagation() {} }) })
  } finally { global.StartersPaidCallBrandPayment = previous.client; global.xanoAuthFetch = previous.fetch }
}

async function approvalConvergenceHarness(onRefresh) {
  const previous = { client: global.StartersPaidCallBrandPayment, fetch: global.xanoAuthFetch, timer: global.setTimeout, warn: console.warn }
  const calls = { reads: 0, bankSteps: 0, paymentActions: 0, delays: [], errors: [] }
  let booking = paidBooking('auth_required')
  booking.payment_reconciliation_status = 'reconciled'
  let click, close
  const modal = { open: true, querySelector: () => ({}) }
  const button = { getAttribute: name => name === 'payment-action-btn' ? 'approve-payment' : null,
    hasAttribute: () => false, setAttribute() {},
    closest: selector => selector === '[popup-booking-info]' ? modal : button }
  const document = { addEventListener: (name, listener) => { if (name === 'click') click = listener; if (name === 'close') close = listener } }
  global.StartersPaidCallBrandPayment = {
    getReadiness() {}, installSavedCardPicker() {}, installCardSetupForm() {},
    stripeForPaymentEnvironment: async () => ({ handleNextAction: async () => {
      calls.bankSteps += 1
      return { paymentIntent: { status: 'requires_capture' } }
    } }),
  }
  global.xanoAuthFetch = async () => {
    calls.paymentActions += 1
    return { ok: true, json: async () => ({ booking_id: booking.booking_id, payment_status: 'auth_required',
      client_secret: 'synthetic', provider_status: 'requires_action' }) }
  }
  global.setTimeout = (callback, delay) => { calls.delays.push(delay); queueMicrotask(callback); return 1 }
  console.warn = () => {}
  try {
    await api.wire({ document, role: 'brand', getBooking: () => booking, restart: async () => {
      calls.reads += 1
      return onRefresh({ calls, booking, replace: row => { booking = row }, modal, close: () => close({ target: modal }) })
    } })
    await click({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
    return calls
  } finally {
    global.StartersPaidCallBrandPayment = previous.client
    global.xanoAuthFetch = previous.fetch
    global.setTimeout = previous.timer
    console.warn = previous.warn
  }
}

test('P9 retries read-only after an early webhook read and stops on the fresh same-booking projection', async () => {
  const calls = await approvalConvergenceHarness(({ calls, booking, replace }) => {
    // Real canonical refreshes replace row objects. That must not cancel this
    // same-booking read loop or allow another Stripe confirmation.
    replace({ ...booking, ...(calls.reads === 3 ? { payment_status: 'intent_created', payment_reconciliation_status: 'reconciled' } : {}) })
    return true
  })
  assert.equal(calls.reads, 3)
  assert.equal(calls.bankSteps, 1)
  assert.equal(calls.paymentActions, 1)
  assert.equal(calls.delays.length, 2)
})

test('P9 post-bank refresh failure retries without repeating financial actions', async () => {
  const calls = await approvalConvergenceHarness(({ calls, booking, replace }) => {
    if (calls.reads === 1) throw new Error('read failed')
    replace({ ...booking, payment_status: 'intent_created', payment_reconciliation_status: 'reconciled' })
    return true
  })
  assert.equal(calls.reads, 2)
  assert.equal(calls.bankSteps, 1)
  assert.equal(calls.paymentActions, 1)
})

test('P9 unresolved post-bank reads have a finite budget', async () => {
  const calls = await approvalConvergenceHarness(() => false)
  assert.equal(calls.reads, 7)
  assert.deepEqual(calls.delays, [1000, 3000, 6000, 10000, 15000, 25000])
  assert.equal(calls.bankSteps, 1)
  assert.equal(calls.paymentActions, 1)
})

test('P9 stops post-bank reads when the modal closes or changes booking', async () => {
  for (const change of ['close', 'booking']) {
    const calls = await approvalConvergenceHarness(({ booking, replace, modal, close }) => {
      if (change === 'close') { modal.open = false; close() }
      else replace({ ...booking, booking_id: 'other-booking' })
      return true
    })
    assert.equal(calls.reads, 1, change)
    assert.equal(calls.delays.length, 0, change)
    assert.equal(calls.bankSteps, 1, change)
  }
})

test('P9 approval normalizes authoritative is_paid before the legacy Paid flag', () => {
  for (const value of [true, 1, 'true', ' TRUE ']) {
    assert.equal(api.canRequestPaymentAction('brand', Object.assign(paidBooking('auth_required'), { is_paid: value, paid_meeting: false })), true, String(value))
  }
  for (const value of [false, 0, 'false', '0', 'anything']) {
    assert.equal(api.canRequestPaymentAction('brand', Object.assign(paidBooking('auth_required'), { is_paid: value, paid_meeting: true })), false, String(value))
  }
  for (const value of [null, undefined]) {
    assert.equal(api.canRequestPaymentAction('brand', Object.assign(paidBooking('auth_required'), { is_paid: value, paid_meeting: 'true' })), true)
    assert.equal(api.canRequestPaymentAction('brand', Object.assign(paidBooking('auth_required'), { is_paid: value, paid_meeting: 'false' })), false)
  }
})

test('P9 Test/live mismatch cannot load Stripe, call the route or open a bank step', async () => {
  for (const extra of [{ payment_environment: 'live' }, { data_environment: 'production' }, { payment_environment: '' }]) {
    const booking = Object.assign(paidBooking('auth_required'), extra)
    assert.equal(api.canRequestPaymentAction('brand', booking), false)
    await approvalWireHarness(booking, async ({ calls, click }) => {
      await click()
      assert.deepEqual(calls, { stripeLoads: [], routes: [], bankSteps: [], refreshes: 0 })
    })
  }
})

test('P9 approval uses the bound server cutoff despite slow or fast browser time', async () => withPaymentClock(async ({ bound, setMonotonic, setWall }) => {
  for (const drift of [-3600000, 3600000]) {
    setMonotonic(100)
    setWall(PAYMENT_SERVER_NOW + drift)
    const booking = bound({ start: PAYMENT_SERVER_NOW + 1 })
    assert.equal(api.canRequestPaymentAction('brand', booking, PAYMENT_SERVER_NOW - 3600000), true)
    setMonotonic(101)
    assert.equal(api.canRequestPaymentAction('brand', booking, PAYMENT_SERVER_NOW - 3600000), false)
  }
  setMonotonic(100)
  const rescheduled = bound({ status: 'rescheduled', start_old: PAYMENT_SERVER_NOW, start: PAYMENT_SERVER_NOW + 3600000 })
  assert.equal(api.canRequestPaymentAction('brand', rescheduled), false)
}))

test('P9 invalid or unbound canonical clocks fail closed without route calls', async () => withPaymentClock(async ({ bound }) => {
  const previous = global.xanoAuthFetch
  let calls = 0
  global.xanoAuthFetch = async () => { calls += 1; throw Error('must not call') }
  try {
    const booking = bound({})
    assert.equal(api.canRequestPaymentAction('brand', { ...booking }), false)
    for (const stamp of [null, undefined, '1800000000000', NaN, Infinity, 0]) {
      const invalid = Object.assign(paidBooking('auth_required'), { server_now_ms: stamp })
      assert.equal(canonicalActions.bindCanonicalClock([invalid], canonicalActions.monotonicNow()), false)
      assert.equal(await api.getPaymentAction('brand', invalid), null)
    }
    global.StartersDashboardCallActions = {}
    assert.equal(await api.getPaymentAction('brand', booking), null)
    assert.equal(calls, 0)
  } finally { global.xanoAuthFetch = previous }
}))

test('P9 wire keeps the bound booking reference through a successful bank step', async () => withPaymentClock(async ({ bound }) => {
  await approvalWireHarness(bound({ is_paid: true, paid_meeting: false }), async ({ calls, click }) => {
    await click()
    assert.deepEqual(calls.stripeLoads, ['test'])
    assert.equal(calls.routes.length, 1)
    assert.deepEqual(calls.routes[0].body, { booking_id: 'booking-paid-1' })
    assert.deepEqual(calls.bankSteps, [{ clientSecret: 'pi_secret_test' }])
    assert.equal(calls.refreshes, 1)
  })
}))

test('P9 wire rechecks the start after asynchronous Stripe loading', async () => withPaymentClock(async ({ bound, setMonotonic }) => {
  await approvalWireHarness(bound({}), async ({ calls, click }) => {
    await click()
    assert.deepEqual(calls.stripeLoads, ['test'])
    assert.deepEqual(calls.routes, [])
    assert.deepEqual(calls.bankSteps, [])
    assert.equal(calls.refreshes, 0)
  }, async () => { setMonotonic(1100) })
}))

test('P9 route latency crossing start blocks both Stripe approval branches', async () => withPaymentClock(async ({ bound, setMonotonic }) => {
  const previous = global.xanoAuthFetch
  try {
    for (const providerStatus of ['requires_action', 'requires_payment_method']) {
      setMonotonic(100)
      const booking = bound({})
      let bankSteps = 0
      global.xanoAuthFetch = async () => {
        setMonotonic(1100)
        return { ok: true, json: async () => ({ booking_id: booking.booking_id, payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: providerStatus, payment_method: 'pm_saved_1' }) }
      }
      const stripe = {
        handleNextAction: async () => { bankSteps += 1 },
        confirmCardPayment: async () => { bankSteps += 1 },
      }
      assert.equal(await api.approvePayment('brand', booking, stripe, () => true), null)
      assert.equal(bankSteps, 0)
    }
  } finally { global.xanoAuthFetch = previous }
}))

test('P9 wire preserves captured booking identity while Stripe loads', async () => withPaymentClock(async ({ bound }) => {
  const booking = bound({})
  await approvalWireHarness(booking, async ({ calls, click }) => {
    await click()
    assert.deepEqual(calls.routes, [])
    assert.deepEqual(calls.bankSteps, [])
    assert.equal(calls.refreshes, 0)
  }, async () => { booking.booking_id = 'booking-other' })
}))


test('P9 wire stops closed or replaced modals while Stripe loads', async () => withPaymentClock(async ({ bound }) => {
  for (const stale of ['closed', 'replaced']) {
    const booking = bound({})
    let invalidate
    await approvalWireHarness(booking, async ({ calls, modal, replaceBooking, click }) => {
      invalidate = () => { if (stale === 'closed') modal.open = false; else replaceBooking(bound({ booking_id: 'booking-other' })) }
      await click()
      assert.deepEqual(calls.routes, [])
      assert.deepEqual(calls.bankSteps, [])
      assert.equal(calls.refreshes, 0)
    }, async () => { invalidate() })
  }
}))


async function approvalModalHarness(options, run) {
  const previous = { client: global.StartersPaidCallBrandPayment, fetch: global.xanoAuthFetch, document: global.document, payment: global.StartersDashboardCallPayment }
  const booking = options.booking
  const calls = { stripeLoads: 0, routes: 0, bankSteps: 0, refreshes: 0, pickerDisposals: 0 }
  let release
  const gate = new Promise(resolve => { release = resolve })
  const listeners = {}
  const ancestor = options.ancestor ? { tagName: 'DIALOG', open: true } : null
  const modal = { tagName: 'DIV', querySelector: () => null, querySelectorAll: () => [], removeAttribute() {}, closest: selector => selector === 'dialog' ? ancestor : null }
  if (ancestor) ancestor.querySelectorAll = selector => selector === '[popup-booking-info]' ? [modal] : []
  const control = action => {
    const button = { getAttribute: name => name === 'payment-action-btn' ? action : null, hasAttribute: () => false, setAttribute() {} }
    button.closest = selector => selector === '[popup-booking-info]' ? modal : selector === '[payment-action-btn], [popup-stripe-card-open]' ? button : null
    return button
  }
  const approve = control('approve-payment')
  const close = { closest: selector => selector === '[popup-booking-info]' ? modal : selector.includes('[data-modal-close]') ? close : null }
  const document = { addEventListener: (name, listener) => { listeners[name] = listener }, querySelector: () => modal }
  global.document = document
  global.StartersDashboardCallPayment = api
  global.StartersPaidCallBrandPayment = {
    getReadiness: async () => ({ environment: 'test' }),
    installSavedCardPicker: () => ({ load: async () => {}, dispose: () => { calls.pickerDisposals += 1 } }),
    installCardSetupForm() {},
    stripeForPaymentEnvironment: async () => {
      calls.stripeLoads += 1
      if (options.phase === 'stripe') await gate
      const bankStep = async () => {
        calls.bankSteps += 1
        if (options.phase === 'bank') await gate
        return { paymentIntent: { status: 'requires_capture' } }
      }
      return { handleNextAction: bankStep, confirmCardPayment: bankStep }
    },
  }
  global.xanoAuthFetch = async () => {
    calls.routes += 1
    if (options.phase === 'route') await gate
    return { ok: true, json: async () => ({ booking_id: booking.booking_id, payment_status: 'auth_required', client_secret: 'pi_secret_test', provider_status: options.providerStatus || 'requires_action', payment_method: 'pm_saved_1' }) }
  }
  const click = target => listeners.click({ target, preventDefault() {}, stopImmediatePropagation() {} })
  try {
    assert.equal(await api.wire({ document, role: 'brand', getBooking: () => booking, restart: async () => { calls.refreshes += 1 } }), true)
    await run({ booking, modal, calls, release,
      start: () => click(approve), tick: () => new Promise(resolve => setImmediate(resolve)),
      closeControl: () => click(close), invalidate: () => api.invalidateModal(modal),
      reset: () => require('./dashboard-calls.js').resetDetailModal(),
      closeAncestor: (emit, reopen) => {
        ancestor.open = false
        if (emit) listeners.close({ target: ancestor })
        if (reopen) ancestor.open = true
      },
      changeCard: () => { booking.payment_status = 'expired_card'; return click(control('change-card')) },
    })
  } finally {
    global.StartersPaidCallBrandPayment = previous.client
    global.xanoAuthFetch = previous.fetch
    global.document = previous.document
    global.StartersDashboardCallPayment = previous.payment
  }
}

for (const close of ['closeControl', 'invalidate', 'reset']) {
  test('P9 DIV approval is permanently invalidated by ' + close + ' while Stripe loads', async () => withPaymentClock(async ({ bound }) => {
    await approvalModalHarness({ booking: bound({}), phase: 'stripe' }, async context => {
      const pending = context.start()
      await context.tick()
      await context[close]()
      context.release()
      await pending
      assert.equal(context.calls.stripeLoads, 1)
      assert.equal(context.calls.routes, 0)
      assert.equal(context.calls.bankSteps, 0)
      assert.equal(context.calls.refreshes, 0)
    })
  }))
}

test('P9 DIV approval fails closed when its native ancestor dialog closes', async () => withPaymentClock(async ({ bound }) => {
  for (const [emit, reopen] of [[false, false], [true, true]]) {
    await approvalModalHarness({ booking: bound({}), phase: 'stripe', ancestor: true }, async context => {
      const pending = context.start()
      await context.tick()
      context.closeAncestor(emit, reopen)
      context.release()
      await pending
      assert.equal(context.calls.routes, 0)
      assert.equal(context.calls.bankSteps, 0)
      assert.equal(context.calls.refreshes, 0)
    })
  }
}))

test('P9 delegated DIV close during either canonical response prevents bank approval', async () => withPaymentClock(async ({ bound }) => {
  for (const providerStatus of ['requires_action', 'requires_payment_method']) {
    await approvalModalHarness({ booking: bound({}), phase: 'route', providerStatus }, async context => {
      const pending = context.start()
      await context.tick()
      await context.closeControl()
      context.release()
      await pending
      assert.equal(context.calls.routes, 1)
      assert.equal(context.calls.bankSteps, 0)
      assert.equal(context.calls.refreshes, 0)
    })
  }
}))

test('P9 close while the bank step returns cannot refresh an invalidated DIV modal', async () => withPaymentClock(async ({ bound }) => {
  await approvalModalHarness({ booking: bound({}), phase: 'bank' }, async context => {
    const pending = context.start()
    await context.tick()
    await context.closeControl()
    context.release()
    await pending
    assert.equal(context.calls.routes, 1)
    assert.equal(context.calls.bankSteps, 1)
    assert.equal(context.calls.refreshes, 0)
  })
}))

test('P9 stale approval cleanup preserves a successor card-picker owner', async () => withPaymentClock(async ({ bound }) => {
  await approvalModalHarness({ booking: bound({}), phase: 'stripe' }, async context => {
    const pending = context.start()
    await context.tick()
    context.invalidate()
    await context.changeCard()
    context.release()
    await pending
    assert.equal(context.calls.routes, 0)
    assert.equal(context.calls.bankSteps, 0)
    assert.equal(context.calls.pickerDisposals, 0)
    context.invalidate()
    assert.equal(context.calls.pickerDisposals, 1)
  })
}))
