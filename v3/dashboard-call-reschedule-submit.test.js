const assert = require('node:assert/strict')
const test = require('node:test')
const { webcrypto } = require('node:crypto')

global.window = global
const api = require('./dashboard-call-actions.js')
const SERVER = 1800000000000

async function submitAfterHashDelay(role, status, selectedOffset) {
  const originals = {
    performance: Object.getOwnPropertyDescriptor(global, 'performance'),
    crypto: Object.getOwnPropertyDescriptor(global, 'crypto'),
    storage: global.sessionStorage,
    fetch: global.xanoAuthFetch,
    wallNow: Date.now,
  }
  let elapsed = 0
  let hashes = 0
  const requests = []
  const values = new Map()
  const booking = {
    booking_id: 'f12-local-submit-1',
    config_id: 'f12-local-config-1',
    grant_id: 'f12-local-grant-1',
    data_environment: 'test',
    status,
    is_paid: false,
    duration: 30,
    start: SERVER + 24 * 3600000,
    server_now_ms: SERVER,
    brand_data: { memberstack_id: 'mem_f12_local_brand' },
    starter_data: { memberstack_id: 'mem_f12_local_starter' },
  }
  try {
    Object.defineProperty(global, 'performance', {
      configurable: true, value: { now: () => 100 + elapsed },
    })
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: {
        subtle: {
          async digest(algorithm, input) {
            hashes++
            if (hashes === 2) elapsed = 1000
            return webcrypto.subtle.digest(algorithm, input)
          },
        },
        randomUUID() { return '00000000-0000-4000-8000-000000000012' },
      },
    })
    Date.now = () => SERVER + elapsed
    global.sessionStorage = {
      getItem(key) { return values.get(key) || null },
      setItem(key, value) { values.set(key, String(value)) },
      removeItem(key) { values.delete(key) },
    }
    global.xanoAuthFetch = async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) })
      const key = status === 'pending' ? 'reschedule_request' : 'reschedule'
      return {
        ok: true,
        async json() {
          return { [key]: { booking_id: booking.booking_id, status: status === 'pending' ? 'pending' : 'rescheduled' } }
        },
      }
    }
    assert.equal(api.bindCanonicalClock([booking], 100, SERVER), true)
    let result
    let error
    try {
      result = await api.proposeReschedule(booking, role, 'Local fixture time change', {
        start: SERVER + selectedOffset,
        end: SERVER + selectedOffset + 1800000,
        timezone: 'Asia/Manila',
      })
    } catch (caught) { error = caught }
    return { result, error, requests, hashes, keys: Array.from(values.values()) }
  } finally {
    Object.defineProperty(global, 'performance', originals.performance)
    if (originals.crypto) Object.defineProperty(global, 'crypto', originals.crypto)
    else delete global.crypto
    global.sessionStorage = originals.storage
    global.xanoAuthFetch = originals.fetch
    Date.now = originals.wallNow
  }
}

for (const role of ['brand', 'starter']) {
  for (const selectedOffset of [999, 1000]) {
    test(`${role} cannot submit a confirmed slot that expires during request-key hashing (${selectedOffset})`, async () => {
      const actual = await submitAfterHashDelay(role, 'confirmed', selectedOffset)
      assert.equal(actual.requests.length, 0, 'an expired slot must not reach the request adapter')
      assert.equal(actual.hashes, 2, 'the request key was prepared before refusal')
      assert.equal(actual.error && actual.error.staleSlot, true)
      assert.equal(actual.error.message, 'This time is no longer available. Please choose another time.')
      assert.equal(actual.keys.length, 1, 'the prepared command key remains safe for the unchanged scope')
    })
  }
}

test('a confirmed slot still one millisecond in the future posts the unchanged propose contract', async () => {
  const actual = await submitAfterHashDelay('starter', 'confirmed', 1001)
  assert.equal(actual.error, undefined)
  assert.equal(actual.requests.length, 1)
  assert.match(actual.requests[0].url, /\/booking\/reschedule\/propose\/v3$/)
  assert.deepEqual(actual.requests[0].payload, {
    booking_id: 'f12-local-submit-1',
    config_id: 'f12-local-config-1',
    idempotency_key: 'dashboard-reschedule-propose:00000000-0000-4000-8000-000000000012',
    rescheduled_reason: 'Local fixture time change',
    new_start: SERVER + 1001,
    new_end: SERVER + 1001 + 1800000,
    timezone: 'Asia/Manila',
  })
  assert.equal(actual.result.reschedule.status, 'rescheduled')
})

test('the confirmed-only final check preserves the pending-request client contract', async () => {
  const actual = await submitAfterHashDelay('brand', 'pending', 1000)
  assert.equal(actual.error, undefined)
  assert.equal(actual.requests.length, 1)
  assert.match(actual.requests[0].url, /\/booking\/reschedule\/request\/v3$/)
  assert.equal(actual.result.reschedule_request.status, 'pending')
})
