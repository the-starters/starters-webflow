const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./dashboard-call-actions.js')

function storage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
  }
}

function pendingBooking() {
  return {
    booking_id: 'booking-test-1',
    config_id: 'config-test-1',
    data_environment: 'test',
    status: 'pending',
    starter_data: { memberstack_id: 'mem_sb_starter' },
  }
}

test('decline eligibility is Starter-only, pending, scoped, and identified', () => {
  const booking = pendingBooking()
  assert.equal(api.canDecline('starter', booking), true)
  assert.equal(api.canDecline('brand', booking), false)
  assert.equal(api.canDecline('starter', { ...booking, status: 'confirmed' }), false)
  assert.equal(api.canDecline('starter', { ...booking, data_environment: '' }), false)
  assert.equal(api.canDecline('starter', { ...booking, config_id: '' }), false)
})

test('decline payload requires a reason and bounded durable idempotency key', () => {
  const booking = pendingBooking()
  const key = 'dashboard-decline:00000000-0000-4000-8000-000000000001'
  assert.deepEqual(api.declinePayload(booking, 'Not available', key), {
    booking_id: booking.booking_id,
    config_id: booking.config_id,
    reason: 'Not available',
    idempotency_key: key,
  })
  assert.equal(api.declinePayload(booking, '', key), null)
  assert.equal(api.declinePayload(booking, 'No', 'invalid'), null)
})

test('decline command uses only the canonical environment-safe endpoint', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const requests = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000001'
      },
    }
    global.xanoAuthFetch = async function (url, options) {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            decline: {
              booking_id: 'booking-test-1',
              status: 'declined',
              revision: 2,
            },
            duplicate: false,
          }
        },
      }
    }
    const result = await api.declineBooking(pendingBooking(), 'Not available')
    assert.equal(result.decline.status, 'declined')
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/booking\/decline\/v3$/)
    assert.equal(requests[0].options.method, 'POST')
    const payload = JSON.parse(requests[0].options.body)
    assert.equal(payload.booking_id, 'booking-test-1')
    assert.equal(payload.config_id, 'config-test-1')
    assert.equal(payload.reason, 'Not available')
    assert.match(payload.idempotency_key, /^dashboard-decline:/)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('ambiguous decline retains the same idempotency key', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const keys = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000001'
      },
    }
    global.xanoAuthFetch = async function (_url, options) {
      keys.push(JSON.parse(options.body).idempotency_key)
      throw new Error('network outcome unknown')
    }
    await assert.rejects(
      api.declineBooking(pendingBooking(), 'Not available'),
      /network outcome unknown/,
    )
    await assert.rejects(
      api.declineBooking(pendingBooking(), 'Not available'),
      /network outcome unknown/,
    )
    assert.equal(keys.length, 2)
    assert.match(keys[0], /^dashboard-decline:/)
    assert.equal(keys[1], keys[0])
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('a changed decline reason receives a different request scope', async () => {
  const first = await api.declineStorageKey(pendingBooking(), 'Reason one')
  const second = await api.declineStorageKey(pendingBooking(), 'Reason two')
  assert.notEqual(first, second)
  assert.equal(first.includes('Reason one'), false)
  assert.equal(second.includes('Reason two'), false)
})

test('only an exact declined response clears the command', () => {
  assert.equal(
    api.declineSucceeded({
      decline: { booking_id: 'booking-test-1', status: 'declined' },
    }),
    true,
  )
  assert.equal(
    api.declineSucceeded({
      decline: { booking_id: 'booking-test-1', status: 'pending' },
    }),
    false,
  )
  assert.equal(api.declineSucceeded(null), false)
})
