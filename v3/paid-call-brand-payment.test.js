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

class CalendarElement {
  constructor(tagName) {
    this.tagName = tagName
    this.style = {}
    this.attrs = {}
    this.children = []
    this.listeners = {}
    this.disabled = false
    this._textContent = ''
  }

  set textContent(value) {
    this._textContent = String(value || '')
    this.children = []
  }

  get textContent() {
    return this._textContent
  }

  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return this.attrs[name] || null }
  appendChild(child) { this.children.push(child); return child }
  addEventListener(name, listener) { this.listeners[name] = listener }
  querySelectorAll(selector) {
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1]
    const matches = []
    function visit(node) {
      if (attribute && Object.prototype.hasOwnProperty.call(node.attrs, attribute)) matches.push(node)
      node.children.forEach(visit)
    }
    this.children.forEach(visit)
    return matches
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

test('paid availability uses one authenticated read with no booking authority', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    return response({
      time_slots: [
        { start_time: 1787001800 },
        { start_time: 1787000000, end_time: 1787000900 },
      ],
    })
  }
  try {
    const config = {
      config_id: 'config_paid',
      grant_id: 'grant_test',
      duration: 15,
    }
    const slots = await api.getPaidAvailability(config, 1786900000000)
    const url = new URL(requests[0].url)
    assert.equal(url.pathname.endsWith(api.AVAILABILITY_PATH), true)
    assert.equal(url.searchParams.get('configuration_id'), 'config_paid')
    assert.equal(url.searchParams.get('grant_id'), 'grant_test')
    assert.equal(requests[0].options.method, 'GET')
    assert.equal(requests[0].options.body, undefined)
    assert.deepEqual(slots, [
      { start: 1787000000000, end: 1787000900000 },
      { start: 1787001800000, end: 1787002700000 },
    ])
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('paid availability fails closed before a request when service identity is incomplete', () => {
  assert.throws(
    () => api.availabilityQuery({ config_id: 'config_paid', duration: 15 }),
    /valid paid-call service/,
  )
})

test('paid calendar renders dates and times and submits only the selected slot', async () => {
  const previous = {
    document: global.document,
    jQuery: global.jQuery,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const container = new CalendarElement('div')
  const submissions = []
  global.document = {
    createElement(tagName) { return new CalendarElement(tagName) },
  }
  global.jQuery = undefined
  global.xanoAuthFetch = async () => response({
    time_slots: [
      { start_time: 1787000000, end_time: 1787000900 },
      { start_time: 1787001800, end_time: 1787002700 },
    ],
  })

  try {
    const result = await api.mountPaidCalendar({
      container,
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 15,
      },
      async onConfirm(slot) { submissions.push(slot) },
    })
    assert.equal(result.slots.length, 2)
    assert.equal(container.getAttribute('data-paid-calendar-state'), 'ready')
    const timeButtons = container.querySelectorAll('[data-paid-calendar-slot]')
    const confirm = container.querySelectorAll('[data-paid-calendar-element]')
      .find((node) => node.getAttribute('data-paid-calendar-element') === 'confirm')
    assert.equal(timeButtons.length, 2)
    assert.equal(confirm.disabled, true)
    timeButtons[1].listeners.click()
    assert.equal(confirm.disabled, false)
    await confirm.listeners.click()
    assert.equal(submissions.length, 1)
    assert.deepEqual(submissions[0], {
      start: 1787001800000,
      end: 1787002700000,
      timezone: result.timezone,
    })
  } finally {
    global.document = previous.document
    global.jQuery = previous.jQuery
    global.xanoAuthFetch = previous.xanoAuthFetch
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

test('canonical Paid price rejects stale or unsupported display authority', () => {
  assert.equal(api.canonicalPaidPrice({ currency: 'usd', price_cents: 500 }), '$5')
  assert.equal(api.canonicalPaidPrice({ currency: 'USD', price_cents: 1250 }), '$12.50')
  assert.equal(api.canonicalPaidPrice({ currency: 'eur', price_cents: 500 }), '')
  assert.equal(api.canonicalPaidPrice({ currency: 'usd', price_cents: 0 }), '')
  assert.equal(api.canonicalPaidPrice({ currency: 'usd', price_cents: 500.5 }), '')
  assert.equal(api.canonicalPaidPrice({ currency: 'usd' }), '')
})

test('invalid canonical Paid price leaves the authored option hidden and unchanged', () => {
  const previous = global.document
  const price = { textContent: '$50' }
  const item = {
    style: { display: 'none' },
    querySelector(selector) { return selector === '[call-type-price]' ? price : null },
  }
  const cta = {
    getAttribute(name) { return name === 'data-config' ? 'config_paid' : null },
    closest() { return item },
  }
  global.document = {
    querySelector() { return null },
    querySelectorAll() { return [cta] },
  }
  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 30,
        is_paid: true,
        currency: 'usd',
        price_cents: 0,
      },
    }), false)
    assert.equal(price.textContent, '$50')
    assert.equal(item.style.display, 'none')
  } finally {
    global.document = previous
  }
})

test('paid calendar selection is owned by one canonical Xano command', async () => {
  const previous = {
    document: global.document,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const requests = []
  let resolveReadiness
  const priceText = { textContent: '$50' }
  const item = {
    style: {},
    setAttribute() {},
    querySelector(selector) { return selector === '[call-type-price]' ? priceText : null },
  }
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
    if (url.endsWith(api.READINESS_PATH)) {
      return new Promise((resolve) => {
        resolveReadiness = () => resolve(response({ environment: 'live', bookable: true }))
      })
    }
    return response({ booking_id: 'booking_one', status: 'pending' })
  }
  let calendarOptions
  let calendarCount = 0
  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 30,
        is_paid: true,
        currency: 'usd',
        price_cents: 500,
      },
      starterSlug: 'jp-testiz-d',
      brandName: 'Brand Test',
      brandEmail: 'brand@example.com',
      mountCalendar(options) {
        calendarCount += 1
        calendarOptions = options
        return Promise.resolve({ slots: [] })
      },
    }), true)
    assert.equal(priceText.textContent, '$5')
    const firstClick = cta.onclick({ preventDefault() {} })
    const secondClick = cta.onclick({ preventDefault() {} })
    assert.equal(requests.filter(({ url }) => url.endsWith(api.READINESS_PATH)).length, 1)
    resolveReadiness()
    await Promise.all([firstClick, secondClick])
    assert.equal(calendarCount, 1)
    await Promise.all([
      calendarOptions.onConfirm({
        start: 1787000000000,
        end: 1787001800000,
        timezone: 'Pacific/Auckland',
      }),
      calendarOptions.onConfirm({
        start: 1787000000000,
        end: 1787001800000,
        timezone: 'Pacific/Auckland',
      }),
    ])
    const bookingRequests = requests.filter(({ url }) => url.endsWith(api.BOOKING_PATH))
    assert.equal(bookingRequests.length, 1)
    assert.equal(JSON.parse(bookingRequests[0].options.body).timezone, 'Pacific/Auckland')
    assert.equal(successText.textContent.includes('paid call request was sent'), true)
    assert.equal(steps[1].style.display, 'flex')
  } finally {
    global.document = previous.document
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

test('card setup retries reuse the same setup and default-selection attempts', async () => {
  const previous = {
    document: global.document,
    Stripe: global.Stripe,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const requests = []
  const listeners = {}
  const priceText = { textContent: '$50' }
  const item = {
    style: {},
    querySelector(selector) { return selector === '[call-type-price]' ? priceText : null },
  }
  const cta = {
    attrs: { 'data-config': 'config_paid' },
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = value },
    closest() { return item },
  }
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return {}
      return null
    },
  }
  const save = {
    disabled: false,
    addEventListener(name, listener) { listeners[name] = listener },
  }
  const cardMount = {}
  const errorText = { textContent: '' }
  const statusText = { textContent: '' }
  const openCard = { click() {} }
  const closeCard = { click() {} }
  global.document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      if (selector.includes('[card-element]')) return cardMount
      if (selector.includes('[save-card-btn]')) return save
      if (selector.includes('[card-error]')) return errorText
      if (selector.includes('[save-card-status]')) return statusText
      if (selector === '[popup-stripe-card-open]') return openCard
      if (selector === '[popup-stripe-card-close]') return closeCard
      return null
    },
    querySelectorAll() { return [cta] },
  }
  const card = { mount() {}, on() {} }
  global.Stripe = () => ({
    elements: () => ({ create: () => card }),
    confirmCardSetup: async () => ({
      setupIntent: { payment_method: 'pm_retry_card' },
    }),
  })
  let readinessCount = 0
  let defaultCount = 0
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      return response({
        environment: 'test',
        bookable: readinessCount >= 3,
      })
    }
    if (url.endsWith(api.SET_DEFAULT_PATH)) {
      defaultCount += 1
      if (defaultCount === 1) throw new Error('network timeout')
      return response({ readiness: 'ready' })
    }
    if (url.endsWith(api.SETUP_PATH)) {
      return response({ client_secret: 'seti_retry_secret' })
    }
    throw new Error('Unexpected request: ' + url)
  }

  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 30,
        is_paid: true,
        currency: 'USD',
        price_cents: 1250,
      },
      starterSlug: 'jp-testiz-d',
      mountCalendar() { return Promise.resolve({ slots: [] }) },
    }), true)
    assert.equal(priceText.textContent, '$12.50')
    await cta.onclick({ preventDefault() {} })
    const saveEvent = {
      preventDefault() {},
      stopImmediatePropagation() {},
    }
    await listeners.click(saveEvent)
    await listeners.click(saveEvent)

    const setupBodies = requests
      .filter(({ url }) => url.endsWith(api.SETUP_PATH))
      .map(({ options }) => options.body)
    const defaultBodies = requests
      .filter(({ url }) => url.endsWith(api.SET_DEFAULT_PATH))
      .map(({ options }) => options.body)
    assert.equal(setupBodies.length, 2)
    assert.equal(new Set(setupBodies).size, 1)
    assert.equal(defaultBodies.length, 2)
    assert.equal(new Set(defaultBodies).size, 1)
    assert.equal(statusText.textContent, 'Card saved.')
  } finally {
    global.document = previous.document
    global.Stripe = previous.Stripe
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})
