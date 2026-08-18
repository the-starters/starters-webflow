const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./paid-call-brand-payment.js')

function response(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    json: async () => body,
  }
}

test('setup retries reuse one bounded attempt key', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    return response({ environment: 'test', client_secret: 'seti_test_secret' })
  }

  try {
    const attempt = api.createSetupAttempt('setup-attempt-123')
    await attempt.run()
    await attempt.run()

    assert.equal(attempt.idempotencyKey, 'setup-attempt-123')
    assert.equal(requests.length, 2)
    assert.deepEqual(
      requests.map(({ options }) => JSON.parse(options.body)),
      [
        { idempotency_key: 'setup-attempt-123' },
        { idempotency_key: 'setup-attempt-123' },
      ],
    )
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('default-card retries reuse a key and send no client identity or environment', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    return response({ readiness: 'ready' })
  }

  try {
    const attempt = api.createDefaultSelectionAttempt(
      'pm_card_one',
      'default-attempt-123',
    )
    await attempt.run()
    await attempt.run()

    assert.equal(requests[0].url, api.XANO_BASE + api.SET_DEFAULT_PATH)
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      payment_method_id: 'pm_card_one',
      idempotency_key: 'default-attempt-123',
    })
    assert.deepEqual(
      JSON.parse(requests[1].options.body),
      JSON.parse(requests[0].options.body),
    )
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('A to B to A selections receive three independent attempt keys', () => {
  const attempts = [
    api.createDefaultSelectionAttempt('pm_a'),
    api.createDefaultSelectionAttempt('pm_b'),
    api.createDefaultSelectionAttempt('pm_a'),
  ]
  const keys = attempts.map(({ idempotencyKey }) => idempotencyKey)
  assert.equal(new Set(keys).size, 3)
  assert.ok(keys.every((key) => key.startsWith('brand-default-card-')))
  assert.ok(keys.every((key) => key.length <= 128))
  assert.notEqual(attempts[0].idempotencyKey, attempts[2].idempotencyKey)
})

test('invalid payment methods and keys fail before any request', () => {
  assert.throws(
    () => api.createDefaultSelectionAttempt('card_not_a_payment_method'),
    /valid Stripe PaymentMethod/,
  )
  assert.throws(
    () => api.createDefaultSelectionAttempt('pm_valid', 'x'.repeat(129)),
    /bounded idempotency key/,
  )
})

test('the shared token bridge fallback sends a Bearer-authenticated request', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const requests = []
  global.xanoAuthFetch = undefined
  global.getXanoAuthToken = async () => 'xano-token'
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    return response({ readiness: 'ready' })
  }

  try {
    await api
      .createDefaultSelectionAttempt('pm_valid', 'attempt-123')
      .run()
    assert.equal(requests[0].options.headers.Authorization, 'Bearer xano-token')
  } finally {
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

test('readiness uses an authenticated GET with no browser authority payload', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    return response({ environment: 'live', bookable: true })
  }
  try {
    const result = await api.getReadiness()
    assert.equal(result.bookable, true)
    assert.equal(requests[0].url, api.XANO_BASE + api.READINESS_PATH)
    assert.equal(requests[0].options.method, 'GET')
    assert.equal(requests[0].options.body, undefined)
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('booking retries reuse one key and omit identity, price, card, and environment authority', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    return response({ booking_id: 'booking_one', status: 'pending' })
  }
  try {
    const attempt = api.createBookingAttempt({
      starter_slug: 'jp-testiz-d',
      config_id: 'config_paid',
      start: 1787000000000,
      end: 1787001800000,
      timezone: 'Asia/Manila',
      topic: 'Audit',
      context: 'Review the account',
      member_id: 'must-not-send',
      environment: 'must-not-send',
      price: 1,
      payment_method_id: 'must-not-send',
    }, 'paid-booking-123')
    await attempt.run()
    await attempt.run()
    assert.equal(requests.length, 2)
    assert.equal(requests[0].url, api.XANO_BASE + api.BOOKING_PATH)
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      starter_slug: 'jp-testiz-d',
      config_id: 'config_paid',
      start: 1787000000000,
      end: 1787001800000,
      timezone: 'Asia/Manila',
      topic: 'Audit',
      context: 'Review the account',
      idempotency_key: 'paid-booking-123',
    })
    assert.equal(requests[1].options.body, requests[0].options.body)
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('paid Scheduler final submit is prevented and owned by one canonical Xano command', async () => {
  const previous = {
    document: global.document,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const requests = []
  const item = { style: {}, setAttribute() {} }
  const cta = {
    attrs: { 'data-config': 'config_paid' },
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = value },
    closest() { return item },
  }
  const successText = { textContent: '' }
  const paidText = { textContent: '' }
  const steps = [
    { style: {}, getAttribute: () => 'default' },
    { style: {}, getAttribute: () => 'success' },
  ]
  const container = {}
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return container
      if (selector === '[booking-success-text]') return successText
      if (selector === '[paid-call-text]') return paidText
      return null
    },
    querySelectorAll() { return steps },
  }
  global.document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      return null
    },
    querySelectorAll() { return [cta] },
  }
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith(api.READINESS_PATH)) return response({ environment: 'live', bookable: true })
    return response({ booking_id: 'booking_one', status: 'pending' })
  }
  let scheduler
  try {
    assert.equal(api.installPaidBookingController({
      config: { config_id: 'config_paid', is_paid: true },
      starterSlug: 'jp-testiz-d',
      brandName: 'Brand Test',
      brandEmail: 'brand@example.com',
      createScheduler() {
        scheduler = { eventOverrides: {} }
        return scheduler
      },
    }), true)
    await cta.onclick({ preventDefault() {} })
    assert.equal(typeof scheduler.eventOverrides.detailsConfirmed, 'function')

    let prevented = false
    const connector = {
      scheduler: {
        bookTimeslot() { throw new Error('direct Nylas booking must not run') },
      },
      schedulerStore: {
        get() {
          return {
            start_time: new Date(1787000000000),
            end_time: new Date(1787001800000),
          }
        },
      },
    }
    scheduler.eventOverrides.detailsConfirmed({
      preventDefault() { prevented = true },
    }, connector)
    assert.equal(prevented, true, 'preventDefault must run synchronously')
    await new Promise((resolve) => setImmediate(resolve))
    const bookingRequests = requests.filter(({ url }) => url.endsWith(api.BOOKING_PATH))
    assert.equal(bookingRequests.length, 1)
    assert.equal(successText.textContent.includes('paid call request was sent'), true)
    assert.equal(steps[1].style.display, 'flex')
  } finally {
    global.document = previous.document
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})
