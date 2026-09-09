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
