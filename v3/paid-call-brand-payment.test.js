const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

global.window = global
const api = require('./paid-call-brand-payment.js')
const SOURCE = fs.readFileSync(require.resolve('./paid-call-brand-payment.js'), 'utf8')

function loadBrowserApi(hostname, xanoAuthFetch) {
  const window = {
    location: hostname === undefined ? {} : { hostname },
    xanoAuthFetch,
  }
  vm.runInNewContext(SOURCE, {
    URLSearchParams,
    console,
    globalThis: window,
    window,
  })
  return window.StartersPaidCallBrandPayment
}

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

  contains() { return false }
}

function guestControl() {
  return {
    style: {},
    attrs: {},
    disabled: false,
    listeners: {},
    setAttribute(name, value) { this.attrs[name] = String(value) },
    getAttribute(name) { return this.attrs[name] || null },
    addEventListener(name, listener) { this.listeners[name] = listener },
  }
}

function makeGuestUi(values = []) {
  const error = guestControl()
  error.textContent = ''
  const add = guestControl()
  const rows = Array.from({ length: 5 }, (_, index) => {
    const field = guestControl()
    field.value = values[index] || ''
    field.focused = false
    field.focus = function () { this.focused = true }
    const remove = guestControl()
    const row = guestControl()
    row.querySelector = function (selector) {
      if (selector === '[data-call-guest-email]') return field
      if (selector === '[data-call-guest-remove]') return remove
      return null
    }
    return { row, field, remove }
  })
  const list = {
    querySelectorAll(selector) {
      return selector === '[data-call-guest-row]' ? rows.map(({ row }) => row) : []
    },
  }
  const wrapper = guestControl()
  wrapper.querySelector = function (selector) {
    if (selector === '[data-call-guest-list]') return list
    if (selector === '[data-call-guest-error]') return error
    if (selector === '[data-call-guest-add]') return add
    return null
  }
  return { wrapper, list, error, add, rows }
}

function guestQuery(ui, selector) {
  if (selector === '[data-call-guest-fields]') return ui.wrapper
  if (selector === '[data-call-guest-error]') return ui.error
  return null
}

function guestQueryAll(ui, selector) {
  if (selector === '[data-call-guest-fields]') return [ui.wrapper]
  if (selector === '[data-call-guest-list]') return [ui.list]
  if (selector === '[data-call-guest-error]') return [ui.error]
  if (selector === '[data-call-guest-add]') return [ui.add]
  if (selector === '[data-call-guest-row]') return ui.rows.map(({ row }) => row)
  if (selector === '[data-call-guest-email]') return ui.rows.map(({ field }) => field)
  if (selector === '[data-call-guest-remove]') return ui.rows.map(({ remove }) => remove)
  return []
}

class SubmitDomNode {
  constructor(tagName) {
    this.tagName = String(tagName || '').toUpperCase()
    this.children = []
    this.parentNode = null
    this.listeners = {}
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  addEventListener(name, listener, options) {
    if (!this.listeners[name]) this.listeners[name] = []
    this.listeners[name].push({ listener, capture: options === true || Boolean(options && options.capture) })
  }

  querySelectorAll(selector) {
    const matches = []
    function visit(node) {
      if (selector === 'form' && node.tagName === 'FORM') matches.push(node)
      node.children.forEach(visit)
    }
    this.children.forEach(visit)
    return matches
  }

  dispatchSubmit() {
    const path = []
    for (let node = this.parentNode; node; node = node.parentNode) path.unshift(node)
    const event = {
      type: 'submit',
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true },
      stopImmediatePropagation() { this.propagationStopped = true },
    }
    const invoke = function (node, capture) {
      const listeners = node.listeners.submit || []
      for (const binding of listeners) {
        if (binding.capture !== capture) continue
        binding.listener(event)
        if (event.propagationStopped) break
      }
    }
    for (const node of path) {
      invoke(node, true)
      if (event.propagationStopped) return event
    }
    invoke(this, true)
    if (!event.propagationStopped) invoke(this, false)
    if (!event.propagationStopped && event.bubbles) {
      for (const node of path.reverse()) {
        invoke(node, false)
        if (event.propagationStopped) break
      }
    }
    return event
  }
}

test('the native guest Form Block cannot submit through Webflow handlers', () => {
  const wrapper = new SubmitDomNode('div')
  const form = wrapper.appendChild(new SubmitDomNode('form'))
  let webflowSubmitCount = 0

  form.addEventListener('submit', function () { webflowSubmitCount += 1 })
  assert.equal(api.installGuestFormSubmitGuard(wrapper), true)

  const event = form.dispatchSubmit()
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.propagationStopped, true)
  assert.equal(webflowSubmitCount, 0)
})

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

test('Paid availability uses five minutes only on the exact staging host', async () => {
  const now = Date.UTC(2026, 7, 24, 0, 0, 0)
  const nowSeconds = Math.floor(now / 1000)
  const config = { config_id: 'config_paid', grant_id: 'grant_test', duration: 60 }

  assert.equal(api.minimumBookingNoticeMinutes(), 1440)
  assert.equal(
    new URL('https://example.test' + api.availabilityQuery(config, now))
      .searchParams.get('start_time'),
    String(nowSeconds + 1440 * 60),
  )

  const staging = loadBrowserApi(
    'the-starters-3-0.webflow.io',
    async () => response({
      time_slots: [
        { start_time: nowSeconds + 4 * 60 },
        { start_time: nowSeconds + 5 * 60 },
      ],
    }),
  )
  assert.equal(staging.minimumBookingNoticeMinutes(), 5)
  assert.equal(
    new URL('https://example.test' + staging.availabilityQuery(config, now))
      .searchParams.get('start_time'),
    String(nowSeconds + 5 * 60),
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(await staging.getPaidAvailability(config, now))),
    [{ start: (nowSeconds + 5 * 60) * 1000, end: (nowSeconds + 65 * 60) * 1000 }],
  )

  assert.equal(loadBrowserApi('thestarters.com').minimumBookingNoticeMinutes(), 1440)
  assert.equal(loadBrowserApi('staging.thestarters.com').minimumBookingNoticeMinutes(), 1440)
  assert.equal(loadBrowserApi().minimumBookingNoticeMinutes(), 1440)
})

test('paid availability fails closed before a request when service identity is incomplete', () => {
  assert.throws(
    () => api.availabilityQuery({ config_id: 'config_paid', duration: 15 }),
    /valid paid-call service/,
  )
})

test('shared call calendar renders dates and times and submits only the selected slot', async () => {
  const previous = {
    document: global.document,
    jQuery: global.jQuery,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const container = new CalendarElement('div')
  const submissions = []
  const selections = []
  let resolveConfirmation
  const firstStart =
    Math.floor((Date.now() + 2 * 24 * 60 * 60 * 1000) / 86400000) * 86400 +
    12 * 60 * 60
  const secondStart = firstStart + 30 * 60
  const thirdStart = firstStart + 24 * 60 * 60
  global.document = {
    createElement(tagName) { return new CalendarElement(tagName) },
  }
  global.jQuery = undefined
  global.xanoAuthFetch = async () => response({
    time_slots: [
      { start_time: firstStart, end_time: firstStart + 15 * 60 },
      { start_time: secondStart, end_time: secondStart + 15 * 60 },
      { start_time: thirdStart, end_time: thirdStart + 15 * 60 },
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
      confirmText: 'Request free call',
      onSelectionChange(slot) { selections.push(slot) },
      async onConfirm(slot) {
        submissions.push(slot)
        await new Promise((resolve) => { resolveConfirmation = resolve })
      },
    })
    assert.equal(result.slots.length, 3)
    assert.equal(container.getAttribute('data-paid-calendar-state'), 'ready')
    const timeButtons = container.querySelectorAll('[data-paid-calendar-slot]')
    const dateButtons = container.querySelectorAll('[data-paid-calendar-date]')
    const confirm = container.querySelectorAll('[data-paid-calendar-element]')
      .find((node) => node.getAttribute('data-paid-calendar-element') === 'confirm')
    assert.equal(timeButtons.length, 2)
    assert.equal(dateButtons.length, 2)
    assert.equal(confirm.textContent, 'Request free call')
    assert.equal(confirm.disabled, true)
    assert.deepEqual(selections, [null])
    timeButtons[1].listeners.click()
    assert.equal(confirm.disabled, false)
    assert.deepEqual(selections[1], result.slots[1])
    const pendingConfirmation = confirm.listeners.click()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(timeButtons[0].disabled, true)
    assert.equal(timeButtons[1].disabled, true)
    assert.equal(dateButtons[0].disabled, true)
    assert.equal(dateButtons[1].disabled, true)
    timeButtons[0].listeners.click()
    dateButtons[1].listeners.click()
    assert.deepEqual(selections[1], result.slots[1])
    resolveConfirmation()
    await pendingConfirmation
    assert.equal(submissions.length, 1)
    assert.deepEqual(submissions[0], {
      start: secondStart * 1000,
      end: (secondStart + 15 * 60) * 1000,
      timezone: result.timezone,
    })
  } finally {
    global.document = previous.document
    global.jQuery = previous.jQuery
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

test('a stale Paid availability response preserves the newer shared surface', async () => {
  const previous = {
    document: global.document,
    jQuery: global.jQuery,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const container = new CalendarElement('div')
  let resolveAvailability
  let current = true
  global.document = {
    createElement(tagName) { return new CalendarElement(tagName) },
  }
  global.jQuery = undefined
  global.xanoAuthFetch = async () => new Promise((resolve) => {
    resolveAvailability = () => resolve(response({
      time_slots: [{ start_time: 1787000000, end_time: 1787000900 }],
    }))
  })

  try {
    const pending = api.mountPaidCalendar({
      container,
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 15,
      },
      isCurrent() { return current },
      async onConfirm() {},
    })
    current = false
    container.textContent = 'Free scheduler'
    resolveAvailability()
    const result = await pending
    assert.equal(result.stale, true)
    assert.equal(container.textContent, 'Free scheduler')
    assert.equal(container.children.length, 0)
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
    return response({ booking: { booking_id: 'booking_one', row_id: 901 } })
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

test('guest emails are normalized, deduplicated, bounded, and exclude the call participants', () => {
  assert.deepEqual(api.normalizeGuestEmails([
    ' Guest.Two@Example.com ',
    'guest.one@example.com',
    'GUEST.ONE@example.com',
    'brand@example.com',
    '',
  ], ['BRAND@example.com', 'starter@example.com']), [
    'guest.one@example.com',
    'guest.two@example.com',
  ])
  assert.throws(
    () => api.normalizeGuestEmails(['not-an-email']),
    /valid guest email/,
  )
  ;[
    'guest@example..com',
    'guest@-example.com',
    'guest@example-.com',
    '.guest@example.com',
    'guest.@example.com',
  ].forEach((email) => {
    assert.throws(
      () => api.normalizeGuestEmails([email]),
      /valid guest email/,
    )
  })
  assert.throws(
    () => api.normalizeGuestEmails([
      'one@example.com',
      'two@example.com',
      'three@example.com',
      'four@example.com',
      'five@example.com',
      'six@example.com',
    ]),
    /up to five/,
  )
})

test('paid booking sends only canonical guest emails and keeps them stable on retry', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    return response({ booking: { booking_id: 'booking_with_guest', row_id: 902 } })
  }
  try {
    const attempt = api.createBookingAttempt({
      starter_slug: 'jp-testiz-d',
      config_id: 'config_paid',
      start: 1787000000000,
      end: 1787000900000,
      timezone: 'Asia/Manila',
      guest_emails: [
        ' Guest@example.com ',
        'guest@example.com',
        'brand@example.com',
      ],
      brand_email: 'brand@example.com',
      starter_email: 'starter@example.com',
    }, 'paid-booking-with-guest-123')
    await attempt.run()
    await attempt.run()
    assert.equal(requests.length, 2)
    const payload = JSON.parse(requests[0].options.body)
    assert.deepEqual(payload.guest_emails, ['guest@example.com'])
    assert.equal(Object.hasOwn(payload, 'brand_email'), false)
    assert.equal(Object.hasOwn(payload, 'starter_email'), false)
    assert.equal(requests[1].options.body, requests[0].options.body)
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('guest invitations travel to the canonical Xano booking endpoint', async () => {
  const previous = global.xanoAuthFetch
  const requests = []
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    return response({ booking: { booking_id: 'booking_invite_route', row_id: 903 } })
  }
  try {
    const attempt = api.createBookingAttempt({
      starter_slug: 'jp-testiz-d',
      config_id: 'config_paid',
      start: 1787000000000,
      end: 1787000900000,
      timezone: 'Asia/Manila',
      guest_emails: ['guest@example.com'],
    }, 'paid-booking-invite-route-123')
    await attempt.run()
    assert.equal(requests.length, 1)
    // The invite fan-out lives behind this exact Xano route: a drifted base,
    // path, or verb sends the guests nowhere and no other assertion here
    // notices, because every other check reads the module's own constants.
    assert.equal(
      requests[0].url,
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/brand/booking/request/v3',
    )
    assert.equal(requests[0].options.method, 'POST')
    assert.deepEqual(
      JSON.parse(requests[0].options.body).guest_emails,
      ['guest@example.com'],
    )
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('booking fingerprint changes with every captured request field but not equivalent guests', () => {
  const base = {
    starter_slug: 'jp-testiz-d',
    config_id: 'config_paid',
    start: 1787000000000,
    end: 1787000900000,
    timezone: 'Asia/Manila',
    topic: 'Audit',
    context: 'Review the account',
    guest_emails: [' Guest@Example.com ', 'guest@example.com'],
    brand_email: 'brand@example.com',
    starter_email: 'starter@example.com',
  }
  const fingerprint = api.bookingRequestFingerprint(base)
  assert.equal(api.bookingRequestFingerprint(Object.assign({}, base, {
    guest_emails: ['guest@example.com'],
  })), fingerprint)
  ;['starter_slug', 'config_id', 'start', 'end', 'timezone', 'topic', 'context'].forEach(function (field) {
    const changed = Object.assign({}, base, {
      [field]: typeof base[field] === 'number' ? base[field] + 1 : base[field] + '-changed',
    })
    assert.notEqual(api.bookingRequestFingerprint(changed), fingerprint, field)
  })
  assert.notEqual(api.bookingRequestFingerprint(Object.assign({}, base, {
    guest_emails: ['other@example.com'],
  })), fingerprint)
})

test('canonical Paid price rejects stale or unsupported display authority', () => {
  assert.equal(api.canonicalPaidPrice({ currency: 'usd', price_cents: 100 }), '$1')
  assert.equal(api.canonicalPaidPrice({ currency: 'USD', price_cents: 1250 }), '$12.50')
  assert.equal(api.canonicalPaidPrice({ currency: 'eur', price_cents: 100 }), '')
  assert.equal(api.canonicalPaidPrice({ currency: 'usd', price_cents: 99 }), '')
  assert.equal(api.canonicalPaidPrice({ currency: 'usd', price_cents: 500.5 }), '')
  assert.equal(api.canonicalPaidPrice({ currency: 'usd' }), '')
})

test('invalid canonical Paid price or duration leaves the authored option hidden', () => {
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
        duration: 60,
        is_paid: true,
        currency: 'usd',
        price_cents: 0,
      },
    }), false)
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 30,
        is_paid: true,
        currency: 'usd',
        price_cents: 500,
      },
    }), false)
    assert.equal(price.textContent, '$50')
    assert.equal(item.style.display, 'none')
  } finally {
    global.document = previous
  }
})

test('booking success requires canonical row and provider booking proof', async () => {
  const previous = global.xanoAuthFetch
  const responses = [{}, { booking: { booking_id: 'provider-only' } }]
  global.xanoAuthFetch = async () => response(responses.shift())
  try {
    const input = {
      starter_slug: 'starter-one',
      config_id: 'config_paid',
      start: 1787000000000,
      end: 1787003600000,
      timezone: 'UTC',
    }
    await assert.rejects(
      api.createBookingAttempt(input, 'missing-canonical-row').run(),
      /canonical booking response is incomplete/i,
    )
    await assert.rejects(
      api.createBookingAttempt(input, 'missing-provider-booking').run(),
      /canonical booking response is incomplete/i,
    )
  } finally {
    global.xanoAuthFetch = previous
  }
})

test('Paid installation stays bookable without optional guest markup', async () => {
  const previous = {
    document: global.document,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const requests = []
  let confirmSlot
  const price = { textContent: '$50' }
  const item = {
    style: { display: 'none' },
    querySelector(selector) { return selector === '[call-type-price]' ? price : null },
  }
  const cta = {
    attrs: { 'data-config': 'config_paid' },
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = value },
    closest() { return item },
  }
  const container = new CalendarElement('div')
  const popup = {
    querySelector(selector) {
      return selector === '[nylas-container]' ? container : null
    },
    querySelectorAll() { return [] },
  }
  global.document = {
    querySelector(selector) { return selector === '[popup-booking]' ? popup : null },
    querySelectorAll() { return [cta] },
  }
  global.xanoAuthFetch = async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith(api.READINESS_PATH)) {
      return response({ environment: 'test', bookable: true })
    }
    return response({ booking: { booking_id: 'booking_without_guest', row_id: 904 } })
  }
  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 60,
        is_paid: true,
        currency: 'usd',
        price_cents: 500,
      },
      starterSlug: 'starter-one',
      brandEmail: 'brand@example.com',
      starterEmail: 'starter@example.com',
      mountCalendar({ onConfirm, onSelectionChange }) {
        confirmSlot = onConfirm
        onSelectionChange({ start: 1000, end: 1900, timezone: 'Asia/Manila' })
        return Promise.resolve({})
      },
    }), true)
    assert.equal(price.textContent, '$5')
    assert.equal(item.style.display, 'block')
    assert.equal(cta.getAttribute('data-paid-call-v3'), 'ready')
    await cta.onclick({ preventDefault() {} })
    await confirmSlot({ start: 1000, end: 1900, timezone: 'Asia/Manila' })
    assert.equal(requests.length, 2)
    const bookingBody = JSON.parse(requests[1].options.body)
    assert.deepEqual(bookingBody, {
      starter_slug: 'starter-one',
      config_id: 'config_paid',
      start: 1000,
      end: 1900,
      timezone: 'Asia/Manila',
      idempotency_key: bookingBody.idempotency_key,
    })
  } finally {
    global.document = previous.document
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

test('Paid installation fails closed when optional guest markup is incomplete', () => {
  const previous = global.document
  const price = { textContent: '$50' }
  const item = {
    style: { display: 'none' },
    querySelector(selector) { return selector === '[call-type-price]' ? price : null },
  }
  const cta = {
    attrs: { 'data-config': 'config_paid' },
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = value },
    closest() { return item },
  }
  const container = new CalendarElement('div')
  const partialGuestWrapper = {
    querySelector() { return null },
  }
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return container
      if (selector === '[data-call-guest-fields]') return partialGuestWrapper
      return null
    },
    querySelectorAll(selector) {
      return selector === '[data-call-guest-fields]' ? [partialGuestWrapper] : []
    },
  }
  global.document = {
    querySelector(selector) { return selector === '[popup-booking]' ? popup : null },
    querySelectorAll() { return [cta] },
  }
  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 60,
        is_paid: true,
        currency: 'usd',
        price_cents: 500,
      },
    }), false)
    assert.equal(price.textContent, '$50')
    assert.equal(item.style.display, 'none')
    assert.equal(cta.getAttribute('data-paid-call-v3'), null)
  } finally {
    global.document = previous
  }
})

test('Paid installation fails closed for every stray guest hook outside the wrapper', () => {
  const previous = global.document
  const guestSelectors = [
    '[data-call-guest-fields]',
    '[data-call-guest-list]',
    '[data-call-guest-error]',
    '[data-call-guest-add]',
    '[data-call-guest-row]',
    '[data-call-guest-email]',
    '[data-call-guest-remove]',
  ]
  try {
    guestSelectors.forEach(function (guestSelector) {
      const price = { textContent: '$50' }
      const item = {
        style: { display: 'none' },
        querySelector(selector) { return selector === '[call-type-price]' ? price : null },
      }
      const cta = {
        attrs: { 'data-config': 'config_paid' },
        getAttribute(name) { return this.attrs[name] || null },
        setAttribute(name, value) { this.attrs[name] = value },
        closest() { return item },
      }
      const container = new CalendarElement('div')
      const strayHook = guestSelector === '[data-call-guest-fields]'
        ? { querySelector() { return null } }
        : {}
      const popup = {
        querySelector(selector) {
          if (selector === '[nylas-container]') return container
          if (selector === guestSelector) return strayHook
          return null
        },
        querySelectorAll(selector) { return selector === guestSelector ? [strayHook] : [] },
      }
      global.document = {
        querySelector(selector) { return selector === '[popup-booking]' ? popup : null },
        querySelectorAll() { return [cta] },
      }

      assert.equal(api.installPaidBookingController({
        config: {
          config_id: 'config_paid',
          grant_id: 'grant_test',
          duration: 60,
          is_paid: true,
          currency: 'usd',
          price_cents: 500,
        },
      }), false, guestSelector)
      assert.equal(price.textContent, '$50', guestSelector)
      assert.equal(item.style.display, 'none', guestSelector)
      assert.equal(cta.getAttribute('data-paid-call-v3'), null, guestSelector)
    })
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
  const freeButtons = {
    attrs: { 'data-type': 'free' },
    style: { display: 'flex' },
    getAttribute(name) { return this.attrs[name] || null },
  }
  const paidButtons = {
    attrs: { 'data-type': 'paid' },
    style: { display: 'none' },
    getAttribute(name) { return this.attrs[name] || null },
  }
  const successCallType = { textContent: 'Free Call' }
  const cardNotice = {
    attrs: { 'aria-hidden': 'true' },
    style: { display: 'none' },
    textContent: 'Your card ending in 1234 will be charged for this call.',
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = String(value) },
  }
  const paidText = { textContent: '' }
  const guestUi = makeGuestUi(['not-an-email'])
  const guestField = guestUi.rows[0].field
  const guestError = guestUi.error
  const steps = [
    { style: {}, getAttribute: () => 'default' },
    { style: {}, getAttribute: () => 'success' },
  ]
  const container = new CalendarElement('div')
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return container
      if (selector === '[booking-success-text]') return successText
      if (selector === '[paid-call-text]') return paidText
      return guestQuery(guestUi, selector)
    },
    querySelectorAll(selector) {
      const guestNodes = guestQueryAll(guestUi, selector)
      if (guestNodes.length) return guestNodes
      if (selector === '[schedule-step]') return steps
      if (selector === '[success-call-buttons]') return [freeButtons, paidButtons]
      if (selector === '[schedule-step="success"] [booking-element="paid-meeting"]') return [successCallType]
      if (selector === '[schedule-step="success"] *') return [successCallType, cardNotice]
      return []
    },
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
      return response({ environment: 'live', bookable: true })
    }
    return response({ booking: { booking_id: 'booking_one', row_id: 905 } })
  }
  let calendarOptions
  let calendarCount = 0
  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 60,
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
    await Promise.all([firstClick, secondClick])
    assert.equal(calendarCount, 1)
    assert.equal(requests.filter(({ url }) => url.endsWith(api.READINESS_PATH)).length, 0)
    assert.equal(guestUi.wrapper.style.display, 'none')
    assert.equal(guestUi.wrapper.getAttribute('aria-hidden'), 'true')
    calendarOptions.onSelectionChange({
      start: 1787000000000,
      end: 1787001800000,
    })
    assert.equal(guestUi.wrapper.style.display, 'flex')
    assert.equal(guestUi.wrapper.getAttribute('aria-hidden'), 'false')
    guestField.value = 'discard-on-slot-clear@example.com'
    calendarOptions.onSelectionChange(null)
    assert.equal(guestUi.wrapper.style.display, 'none')
    assert.equal(guestField.value, '')
    calendarOptions.onSelectionChange({
      start: 1787000000000,
      end: 1787001800000,
    })
    assert.equal(guestUi.wrapper.style.display, 'flex')
    guestField.value = 'not-an-email'
    await assert.rejects(
      calendarOptions.onConfirm({
        start: 1787000000000,
        end: 1787001800000,
        timezone: 'Pacific/Auckland',
      }),
      /valid guest email/,
    )
    assert.equal(guestError.textContent, 'Enter a valid guest email address')
    assert.equal(guestError.style.display, 'block')
    assert.equal(requests.filter(({ url }) => url.endsWith(api.BOOKING_PATH)).length, 0)
    const guestValues = [
      ' One@Example.com ',
      'two@example.com',
      'three@example.com',
      'four@example.com',
      'five@example.com',
    ]
    guestValues.forEach(function (value, index) {
      if (index) guestUi.add.listeners.click({ preventDefault() {} })
      guestUi.rows[index].field.value = value
    })
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
    const bookingPayload = JSON.parse(bookingRequests[0].options.body)
    assert.equal(bookingPayload.timezone, 'Pacific/Auckland')
    assert.deepEqual(bookingPayload.guest_emails, [
      'five@example.com',
      'four@example.com',
      'one@example.com',
      'three@example.com',
      'two@example.com',
    ])
    assert.equal(guestError.textContent, '')
    assert.equal(guestError.style.display, 'none')
    assert.equal(guestField.value, '')
    assert.equal(guestUi.wrapper.style.display, 'none')
    assert.equal(successText.textContent.includes('paid call request was sent'), true)
    assert.equal(freeButtons.style.display, 'none')
    assert.equal(paidButtons.style.display, 'flex')
    assert.equal(successCallType.textContent, 'Paid Call')
    assert.equal(cardNotice.style.display, '')
    assert.equal(cardNotice.getAttribute('aria-hidden'), 'false')
    assert.equal(steps[1].style.display, 'flex')
  } finally {
    global.document = previous.document
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

test('Free selection invalidates a pending Paid calendar response', async () => {
  const previous = {
    document: global.document,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  let resolveCalendar
  let calendarOptions
  const container = new CalendarElement('div')
  const guestUi = makeGuestUi()
  container.textContent = 'Free scheduler'
  const price = { textContent: '$50' }
  const item = {
    style: {},
    querySelector(selector) { return selector === '[call-type-price]' ? price : null },
  }
  const paid = {
    attrs: { 'data-config': 'config_paid' },
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = value },
    closest() { return item },
  }
  const freeListeners = {}
  const modalClose = guestControl()
  const topic = { value: '' }
  const context = { value: '' }
  const steps = [
    { style: {}, getAttribute: () => 'default' },
    { style: {}, getAttribute: () => 'success' },
  ]
  const free = {
    addEventListener(name, listener) { freeListeners[name] = listener },
  }
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return container
      if (selector === '[name="topic"], [booking-topic]') return topic
      if (selector === '[name="context"], [booking-context]') return context
      return guestQuery(guestUi, selector)
    },
    querySelectorAll(selector) {
      if (selector === '[data-modal-close], [booking-popup-close], [popup-booking-close]') return [modalClose]
      if (selector === '[schedule-step]') return steps
      return guestQueryAll(guestUi, selector)
    },
  }
  global.document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      return null
    },
    querySelectorAll(selector) {
      return selector.includes('data-type="free"') ? [free] : [paid]
    },
  }
  let mounts = 0

  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 60,
        is_paid: true,
        currency: 'usd',
        price_cents: 500,
      },
      mountCalendar(options) {
        mounts += 1
        calendarOptions = options
        return new Promise((resolve) => { resolveCalendar = resolve })
      },
    }), true)
    guestUi.wrapper.style.display = 'flex'
    guestUi.rows[0].field.value = 'close@example.com'
    topic.value = 'Old topic'
    context.value = 'Old context'
    steps[0].style.display = 'none'
    steps[1].style.display = 'flex'
    container.textContent = 'Old calendar'
    modalClose.listeners.click()
    assert.equal(guestUi.wrapper.style.display, 'none')
    assert.equal(guestUi.rows[0].field.value, '')
    assert.equal(topic.value, '')
    assert.equal(context.value, '')
    assert.equal(container.textContent, '')
    assert.equal(steps[0].style.display, 'flex')
    assert.equal(steps[1].style.display, 'none')
    const pending = paid.onclick({ preventDefault() {} })
    assert.equal(guestUi.wrapper.style.display, 'none')
    assert.equal(guestUi.wrapper.getAttribute('aria-hidden'), 'true')
    assert.equal(container.textContent, 'Loading available times...')
    assert.equal(container.getAttribute('data-paid-calendar-state'), 'loading')
    assert.equal(mounts, 1)
    assert.equal(calendarOptions.isCurrent(), true)
    freeListeners.click()
    assert.equal(guestUi.wrapper.style.display, 'none')
    assert.equal(guestUi.rows[0].field.value, '')
    container.textContent = 'Free scheduler'
    assert.equal(calendarOptions.isCurrent(), false)
    resolveCalendar({ slots: [] })
    await pending
    assert.equal(mounts, 1)
    assert.equal(container.textContent, 'Free scheduler')
  } finally {
    global.document = previous.document
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

test('a newer Paid selection runs after a Paid to Free to Paid switch', async () => {
  const previous = {
    document: global.document,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  let resolveFirstCalendar
  const container = new CalendarElement('div')
  const guestUi = makeGuestUi()
  const price = { textContent: '$50' }
  const item = {
    style: {},
    querySelector(selector) { return selector === '[call-type-price]' ? price : null },
  }
  const paid = {
    attrs: { 'data-config': 'config_paid' },
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = value },
    closest() { return item },
  }
  const freeListeners = {}
  const free = {
    addEventListener(name, listener) { freeListeners[name] = listener },
  }
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return container
      return guestQuery(guestUi, selector)
    },
    querySelectorAll(selector) { return guestQueryAll(guestUi, selector) },
  }
  global.document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      return null
    },
    querySelectorAll(selector) {
      return selector.includes('data-type="free"') ? [free] : [paid]
    },
  }
  const mounts = []

  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        duration: 60,
        is_paid: true,
        currency: 'usd',
        price_cents: 500,
      },
      grantId: 'grant_test',
      mountCalendar(options) {
        mounts.push(options)
        if (mounts.length === 1) {
          return new Promise((resolve) => { resolveFirstCalendar = resolve })
        }
        return Promise.resolve({ slots: [] })
      },
    }), true)
    const first = paid.onclick({ preventDefault() {} })
    freeListeners.click()
    container.textContent = 'Free scheduler'
    const second = paid.onclick({ preventDefault() {} })
    assert.equal(container.textContent, 'Loading available times...')
    assert.equal(mounts.length, 1)
    assert.equal(mounts[0].isCurrent(), false)
    resolveFirstCalendar({ slots: [] })
    await new Promise((resolve) => setImmediate(resolve))
    await Promise.all([first, second])
    assert.equal(mounts.length, 2)
    assert.equal(mounts[1].isCurrent(), true)
    assert.equal(mounts[1].config.grant_id, 'grant_test')
    assert.equal(mounts[1].config.duration, 60)
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
  const guestUi = makeGuestUi()
  const calendarContainer = new CalendarElement('div')
  let calendarOptions
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return calendarContainer
      return guestQuery(guestUi, selector)
    },
    querySelectorAll(selector) { return guestQueryAll(guestUi, selector) },
  }
  const save = {
    disabled: false,
    addEventListener(name, listener) { listeners[name] = listener },
  }
  const cardMount = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value },
  }
  const errorText = {
    textContent: '',
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value },
  }
  const statusText = {
    textContent: '',
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value },
  }
  const cardLabel = {
    id: '',
    textContent: 'Payment Methods',
    setAttribute(name, value) { if (name === 'id') this.id = value },
  }
  const staleAction = { style: {} }
  const paymentModal = {
    attrs: {},
    querySelector(selector) {
      if (selector === '[pm-use-this]') return staleAction
      return null
    },
    querySelectorAll() { return [cardLabel] },
    setAttribute(name, value) { this.attrs[name] = value },
  }
  let openCardClicks = 0
  const openCard = { click() { openCardClicks += 1 } }
  const closeCard = { click() {} }
  global.document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      if (selector.includes('[card-element]')) return cardMount
      if (selector.includes('[save-card-btn]')) return save
      if (selector.includes('[card-error]')) return errorText
      if (selector.includes('[save-card-status]')) return statusText
      if (selector === '[popup-stripe-card]') return paymentModal
      if (selector === '[popup-stripe-card-open]') return openCard
      if (selector === '[popup-stripe-card-close]') return closeCard
      return null
    },
    querySelectorAll() { return [cta] },
  }
  let cardChange
  let cardCreateOptions
  const card = {
    mount() {},
    clear() {},
    on(name, listener) { if (name === 'change') cardChange = listener },
  }
  global.Stripe = () => ({
    elements: () => ({
      create(type, options) {
        assert.equal(type, 'card')
        cardCreateOptions = options
        return card
      },
    }),
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
    if (url.endsWith(api.BOOKING_PATH)) {
      return response({ booking: { booking_id: 'booking_card_ready', row_id: 906 } })
    }
    throw new Error('Unexpected request: ' + url)
  }

  try {
    assert.equal(api.installPaidBookingController({
      config: {
        config_id: 'config_paid',
        grant_id: 'grant_test',
        duration: 60,
        is_paid: true,
        currency: 'USD',
        price_cents: 1250,
      },
      starterSlug: 'jp-testiz-d',
      mountCalendar(options) {
        calendarOptions = options
        return Promise.resolve({ slots: [] })
      },
    }), true)
    assert.equal(priceText.textContent, '$12.50')
    assert.equal(cardLabel.id, 'paid-card-details-label')
    assert.equal(cardMount.attrs['aria-labelledby'], 'paid-card-details-label')
    assert.equal(paymentModal.attrs.role, 'dialog')
    assert.equal(paymentModal.attrs['aria-modal'], 'true')
    assert.equal(paymentModal.attrs['aria-labelledby'], 'paid-card-details-label')
    assert.equal(errorText.attrs.role, 'alert')
    assert.equal(errorText.attrs['aria-live'], 'assertive')
    assert.equal(statusText.attrs.role, 'status')
    assert.equal(statusText.attrs['aria-live'], 'polite')
    assert.equal(staleAction.style.display, 'none')
    await cta.onclick({ preventDefault() {} })
    await calendarOptions.onConfirm({
      start: 1787000000000,
      end: 1787003600000,
      timezone: 'Pacific/Auckland',
    })
    assert.equal(openCardClicks, 1)
    assert.equal(cardCreateOptions.hidePostalCode, true)
    assert.equal(cardCreateOptions.style.base['::placeholder'].color, '#74786f')
    assert.equal(requests.filter(({ url }) => url.endsWith(api.SETUP_PATH)).length, 0)
    const saveEvent = {
      preventDefault() {},
      stopImmediatePropagation() {},
    }
    await listeners.click(saveEvent)
    assert.equal(errorText.textContent, 'Enter complete card details.')
    assert.equal(requests.filter(({ url }) => url.endsWith(api.SETUP_PATH)).length, 0)
    cardChange({ complete: true })
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

function makePaidLifecycleFixture(fetch) {
  const previous = {
    document: global.document,
    Stripe: global.Stripe,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const container = new CalendarElement('div')
  const calendars = []
  const steps = [
    { style: {}, getAttribute: () => 'default' },
    { style: {}, getAttribute: () => 'success' },
  ]
  function control() {
    const listeners = {}
    return {
      disabled: false,
      listeners,
      addEventListener(name, listener) {
        if (!listeners[name]) listeners[name] = []
        listeners[name].push(listener)
      },
      click() {
        ;(listeners.click || []).forEach(function (listener) {
          listener({ preventDefault() {}, stopImmediatePropagation() {} })
        })
      },
    }
  }
  const mainClose = control()
  const paymentClose = control()
  const save = control()
  const cardMount = { setAttribute() {} }
  const errorText = { textContent: '', setAttribute() {} }
  const statusText = { textContent: '', setAttribute() {} }
  const paymentModalListeners = {}
  const paymentModal = {
    addEventListener(name, listener) {
      if (!paymentModalListeners[name]) paymentModalListeners[name] = []
      paymentModalListeners[name].push(listener)
    },
    cancel() {
      ;(paymentModalListeners.cancel || []).forEach(function (listener) {
        listener({ preventDefault() {} })
      })
    },
    querySelector() { return null },
    querySelectorAll() { return [] },
    setAttribute() {},
  }
  const topic = { value: '' }
  const context = { value: '' }
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return container
      if (selector === '[name="topic"], [booking-topic]') return topic
      if (selector === '[name="context"], [booking-context]') return context
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-modal-close], [booking-popup-close], [popup-booking-close]') return [mainClose]
      if (selector === '[schedule-step]') return steps
      return []
    },
  }
  const price = { textContent: '' }
  const item = { style: {}, querySelector: () => price }
  const paid = {
    getAttribute(name) { return name === 'data-config' ? 'config_paid' : null },
    setAttribute() {},
    closest() { return item },
  }
  let openCount = 0
  const openPayment = { click() { openCount += 1 } }
  global.document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      if (selector.includes('[card-element]')) return cardMount
      if (selector.includes('[save-card-btn]')) return save
      if (selector.includes('[card-error]')) return errorText
      if (selector.includes('[save-card-status]')) return statusText
      if (selector === '[popup-stripe-card]') return paymentModal
      if (selector === '[popup-stripe-card-open]') return openPayment
      if (selector === '[popup-stripe-card-close]') return paymentClose
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('data-type="paid"')) return [paid]
      if (selector === '[popup-stripe-card] [data-modal-close], [popup-stripe-card-close]') return [paymentClose]
      return []
    },
  }
  const cardListeners = {}
  let cardCreates = 0
  let cardConfirmations = 0
  let saveBindings = 0
  const originalSaveAdd = save.addEventListener
  save.addEventListener = function (name, listener) {
    if (name === 'click') saveBindings += 1
    originalSaveAdd.call(save, name, listener)
  }
  global.Stripe = () => ({
    elements: () => ({
      create() {
        cardCreates += 1
        return {
          clear() {},
          mount() {},
          on(name, listener) { cardListeners[name] = listener },
        }
      },
    }),
    confirmCardSetup: async () => {
      cardConfirmations += 1
      return { setupIntent: { payment_method: 'pm_lifecycle' } }
    },
  })
  global.xanoAuthFetch = fetch
  api.installPaidBookingController({
    config: {
      config_id: 'config_paid',
      grant_id: 'grant_test',
      duration: 60,
      is_paid: true,
      currency: 'USD',
      price_cents: 500,
    },
    starterSlug: 'lifecycle-test',
    mountCalendar(options) {
      const state = { clearCount: 0, options }
      calendars.push(state)
      return Promise.resolve({
        slots: [],
        clearSelection() {
          state.clearCount += 1
          options.onSelectionChange(null)
        },
      })
    },
  })
  return {
    calendars,
    cardListeners,
    context,
    getCardConfirmations: () => cardConfirmations,
    getCardCreates: () => cardCreates,
    getOpenCount: () => openCount,
    getSaveBindings: () => saveBindings,
    mainClose,
    paid,
    paymentClose,
    paymentModal,
    restore() {
      global.document = previous.document
      global.Stripe = previous.Stripe
      global.xanoAuthFetch = previous.xanoAuthFetch
    },
    save,
    steps,
    topic,
  }
}

test('canceling card setup clears the selected slot before a later save', async () => {
  let readinessCount = 0
  let bookingCount = 0
  const fixture = makePaidLifecycleFixture(async (url) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      return response({ environment: 'test', bookable: readinessCount >= 3 })
    }
    if (url.endsWith(api.SETUP_PATH)) return response({ client_secret: 'seti_close' })
    if (url.endsWith(api.SET_DEFAULT_PATH)) return response({ readiness: 'ready' })
    if (url.endsWith(api.BOOKING_PATH)) {
      bookingCount += 1
      return response({ booking: { booking_id: 'unexpected', row_id: 1 } })
    }
    throw new Error('Unexpected request: ' + url)
  })
  try {
    await fixture.paid.onclick({ preventDefault() {} })
    const slot = { start: 1787000000000, end: 1787003600000, timezone: 'UTC' }
    await fixture.calendars[0].options.onConfirm(slot)
    assert.equal(fixture.getOpenCount(), 1)
    fixture.paymentModal.cancel()
    assert.equal(fixture.calendars[0].clearCount, 1)
    fixture.cardListeners.change({ complete: true })
    await fixture.save.listeners.click[0]({ preventDefault() {}, stopImmediatePropagation() {} })
    assert.equal(bookingCount, 0)
  } finally {
    fixture.restore()
  }
})

test('shared booking surface blocks overlapping Free and Paid commands', async () => {
  const container = new CalendarElement('div')
  let resolveFree
  let paidRuns = 0
  const freeCommand = global.StartersBookingSurfaceLifecycle.runBooking(
    container,
    'free-command',
    function () {
      return {
        run: function () {
          return new Promise(function (resolve) { resolveFree = resolve })
        },
      }
    },
  )

  assert.throws(function () {
    global.StartersBookingSurfaceLifecycle.runBooking(
      container,
      'paid-command',
      function () {
        return {
          run: async function () {
            paidRuns += 1
            return { booking: { booking_id: 'paid-overlap', row_id: 2 } }
          },
        }
      },
    )
  }, /Another booking request is still being processed/)
  assert.equal(paidRuns, 0)

  resolveFree({ booking: { booking_id: 'free-complete', row_id: 1 } })
  await freeCommand
  await global.StartersBookingSurfaceLifecycle.runBooking(
    container,
    'paid-command',
    function () {
      return {
        run: async function () {
          paidRuns += 1
          return { booking: { booking_id: 'paid-complete', row_id: 2 } }
        },
      }
    },
  )
  assert.equal(paidRuns, 1)
})

test('a reset booking blocks a changed command while one is in flight', async () => {
  let bookingCount = 0
  let resolveStaleBooking
  const fixture = makePaidLifecycleFixture(async (url) => {
    if (url.endsWith(api.READINESS_PATH)) return response({ environment: 'test', bookable: true })
    if (url.endsWith(api.BOOKING_PATH)) {
      bookingCount += 1
      if (bookingCount === 1) {
        return new Promise((resolve) => { resolveStaleBooking = () => resolve(response({ booking: { booking_id: 'stale', row_id: 1 } })) })
      }
      return response({ booking: { booking_id: 'current', row_id: 2 } })
    }
    throw new Error('Unexpected request: ' + url)
  })
  try {
    const slot = { start: 1787000000000, end: 1787003600000, timezone: 'UTC' }
    await fixture.paid.onclick({ preventDefault() {} })
    fixture.topic.value = 'Original topic'
    fixture.context.value = 'Original context'
    const stale = fixture.calendars[0].options.onConfirm(slot)
    await new Promise((resolve) => setImmediate(resolve))
    fixture.mainClose.click()
    assert.equal(fixture.topic.value, '')
    assert.equal(fixture.context.value, '')
    await fixture.paid.onclick({ preventDefault() {} })
    await assert.rejects(
      fixture.calendars[1].options.onConfirm(slot),
      /still being processed/i,
    )
    assert.equal(bookingCount, 1)
    resolveStaleBooking()
    await stale
    assert.equal(fixture.steps[0].style.display, 'flex')
    assert.equal(fixture.steps[1].style.display, 'none')
  } finally {
    fixture.restore()
  }
})

test('overlapping paid generations share one card setup installation', async () => {
  let readinessCount = 0
  let resolveInstallReadiness
  const fixture = makePaidLifecycleFixture(async (url) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      if (readinessCount === 2) {
        return new Promise((resolve) => {
          resolveInstallReadiness = () => resolve(response({ environment: 'test', bookable: false }))
        })
      }
      return response({ environment: 'test', bookable: false })
    }
    throw new Error('Unexpected request: ' + url)
  })
  try {
    const slot = { start: 1787000000000, end: 1787003600000, timezone: 'UTC' }
    await fixture.paid.onclick({ preventDefault() {} })
    const first = fixture.calendars[0].options.onConfirm(slot)
    await new Promise((resolve) => setImmediate(resolve))
    fixture.mainClose.click()
    await fixture.paid.onclick({ preventDefault() {} })
    const second = fixture.calendars[1].options.onConfirm(slot)
    await new Promise((resolve) => setImmediate(resolve))
    resolveInstallReadiness()
    await Promise.all([first, second])
    assert.equal(fixture.getCardCreates(), 1)
    assert.equal(fixture.getSaveBindings(), 1)
    assert.equal(fixture.getOpenCount(), 1)
  } finally {
    fixture.restore()
  }
})

test('the latest Paid confirmation owns an overlapping readiness response', async () => {
  let readinessCount = 0
  let resolveFirstReadiness
  const bookingStarts = []
  const fixture = makePaidLifecycleFixture(async (url, options) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      if (readinessCount === 1) {
        return new Promise((resolve) => {
          resolveFirstReadiness = () => resolve(response({ environment: 'test', bookable: true }))
        })
      }
      return response({ environment: 'test', bookable: true })
    }
    if (url.endsWith(api.BOOKING_PATH)) {
      bookingStarts.push(JSON.parse(options.body).start)
      return response({ booking: { booking_id: 'latest-slot', row_id: 904 } })
    }
    throw new Error('Unexpected request: ' + url)
  })
  try {
    const firstSlot = { start: 1787000000000, end: 1787003600000, timezone: 'UTC' }
    const secondSlot = { start: 1787007200000, end: 1787010800000, timezone: 'UTC' }
    await fixture.paid.onclick({ preventDefault() {} })
    const first = fixture.calendars[0].options.onConfirm(firstSlot)
    await new Promise((resolve) => setImmediate(resolve))
    const second = fixture.calendars[0].options.onConfirm(secondSlot)
    await second
    resolveFirstReadiness()
    await first
    assert.deepEqual(bookingStarts, [secondSlot.start])
  } finally {
    fixture.restore()
  }
})

test('booking retry reuses completed card setup and booking attempt', async () => {
  let readinessCount = 0
  let setupCount = 0
  let defaultCount = 0
  const bookingBodies = []
  const fixture = makePaidLifecycleFixture(async (url, options) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      return response({ environment: 'test', bookable: readinessCount >= 3 })
    }
    if (url.endsWith(api.SETUP_PATH)) {
      setupCount += 1
      return response({ client_secret: 'seti_booking_retry' })
    }
    if (url.endsWith(api.SET_DEFAULT_PATH)) {
      defaultCount += 1
      return response({ readiness: 'ready' })
    }
    if (url.endsWith(api.BOOKING_PATH)) {
      bookingBodies.push(options.body)
      if (bookingBodies.length === 1) throw new Error('temporary booking failure')
      return response({ booking: { booking_id: 'booking_retry', row_id: 905 } })
    }
    throw new Error('Unexpected request: ' + url)
  })
  try {
    const slot = { start: 1787000000000, end: 1787003600000, timezone: 'UTC' }
    await fixture.paid.onclick({ preventDefault() {} })
    await fixture.calendars[0].options.onConfirm(slot)
    fixture.cardListeners.change({ complete: true })
    const saveEvent = { preventDefault() {}, stopImmediatePropagation() {} }
    await fixture.save.listeners.click[0](saveEvent)
    await fixture.save.listeners.click[0](saveEvent)
    assert.equal(setupCount, 1)
    assert.equal(defaultCount, 1)
    assert.equal(fixture.getCardConfirmations(), 1)
    assert.equal(bookingBodies.length, 2)
    assert.equal(new Set(bookingBodies).size, 1)
  } finally {
    fixture.restore()
  }
})

test('stale card save cannot mutate a reopened payment generation', async () => {
  let readinessCount = 0
  let defaultCount = 0
  let bookingCount = 0
  const setupBodies = []
  const setupResolvers = []
  const fixture = makePaidLifecycleFixture(async (url, options) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      return response({ environment: 'test', bookable: readinessCount >= 4 })
    }
    if (url.endsWith(api.SETUP_PATH)) {
      setupBodies.push(options.body)
      return new Promise((resolve) => {
        setupResolvers.push(() => resolve(response({
          client_secret: 'seti_generation_' + setupResolvers.length,
        })))
      })
    }
    if (url.endsWith(api.SET_DEFAULT_PATH)) {
      defaultCount += 1
      return response({ readiness: 'ready' })
    }
    if (url.endsWith(api.BOOKING_PATH)) {
      bookingCount += 1
      return response({ booking: { booking_id: 'current-payment', row_id: 906 } })
    }
    throw new Error('Unexpected request: ' + url)
  })
  try {
    const slot = { start: 1787000000000, end: 1787003600000, timezone: 'UTC' }
    const saveEvent = { preventDefault() {}, stopImmediatePropagation() {} }
    await fixture.paid.onclick({ preventDefault() {} })
    await fixture.calendars[0].options.onConfirm(slot)
    fixture.cardListeners.change({ complete: true })
    const staleSave = fixture.save.listeners.click[0](saveEvent)
    await new Promise((resolve) => setImmediate(resolve))
    fixture.paymentClose.click()
    await fixture.calendars[0].options.onConfirm(slot)
    fixture.cardListeners.change({ complete: true })
    const currentSave = fixture.save.listeners.click[0](saveEvent)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(setupResolvers.length, 2)
    setupResolvers[0]()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fixture.getCardConfirmations(), 0)
    assert.equal(fixture.save.disabled, true)
    setupResolvers[1]()
    await Promise.all([staleSave, currentSave])
    assert.equal(new Set(setupBodies).size, 2)
    assert.equal(fixture.getCardConfirmations(), 1)
    assert.equal(defaultCount, 1)
    assert.equal(bookingCount, 1)
  } finally {
    fixture.restore()
  }
})
