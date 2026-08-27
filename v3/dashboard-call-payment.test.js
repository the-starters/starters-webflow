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

test('payment module does not activate an unreviewed native card form', () => {
  assert.equal(api.wire(), false)
  assert.equal(api.validPaymentMethodId('pm_test_1'), true)
  assert.equal(api.validPaymentMethodId('card_test_1'), false)
  assert.equal(api.validReplacementKey('invalid'), false)
})
