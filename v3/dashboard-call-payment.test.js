const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./dashboard-call-payment.js')

function paidBooking(status) {
  return {
    booking_id: 'booking-paid-1',
    paid_meeting: true,
    payment_environment: 'test',
    payment_status: status,
  }
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
    closest: selector => selector === '[popup-booking-info]' ? modal : button }
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
  const previous = { client: global.StartersPaidCallBrandPayment, actions: global.StartersDashboardCallActions, fetch: global.xanoAuthFetch }
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
  document.createElement = () => new Node()
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
  global.xanoAuthFetch = async url => {
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
      save: () => use.listeners.click(event(use)),
      close: () => { modal.open = false; document.listeners.close(event(modal)); modal.open = true },
      holdRead: () => { holdRead = true }, releaseRead: () => { holdRead = false; releaseRead() },
      holdRecovery: () => { holdRecovery = true }, releaseRecovery: () => { holdRecovery = false; releaseRecovery() },
      state: () => ({ forms, refreshes, defaults, recoveries, lists }) })
  } finally {
    global.StartersPaidCallBrandPayment = previous.client
    global.StartersDashboardCallActions = previous.actions
    global.xanoAuthFetch = previous.fetch
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
