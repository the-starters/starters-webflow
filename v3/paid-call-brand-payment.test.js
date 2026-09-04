const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

global.window = global
const api = require('./paid-call-brand-payment.js')
const SOURCE = fs.readFileSync(require.resolve('./paid-call-brand-payment.js'), 'utf8')

/** The close selector the controller actually ships, read off the source. */
function bookingCloseSelector() {
  const match = /const BOOKING_CLOSE_SELECTOR =\s*([\s\S]*?)\n\s*const /.exec(SOURCE)
  if (!match) throw new Error('BOOKING_CLOSE_SELECTOR not found in the controller source')
  // The literal is written as concatenated single-quoted parts.
  const parts = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
  if (!parts.length) throw new Error('BOOKING_CLOSE_SELECTOR is not a string literal any more')
  return parts.join('')
}

/**
 * Document order + the real selector, which is the pair that decides which
 * control a synthesized close lands on. Supports the two forms the selector
 * uses: a bare attribute, and `:not([attribute])`.
 */
function firstCloseMatch(selector, candidates) {
  const groups = String(selector).split(',').map((part) => part.trim()).filter(Boolean)
  const compiled = groups.map((group) => {
    const excluded = [...group.matchAll(/:not\(\[([\w-]+)\]\)/g)].map((m) => m[1])
    const required = [...group.replace(/:not\([^)]*\)/g, '').matchAll(/\[([\w-]+)\]/g)].map((m) => m[1])
    if (!required.length) return null
    return (el) => {
      const has = (name) =>
        typeof el.getAttribute === 'function'
          ? el.getAttribute(name) !== null && el.getAttribute(name) !== undefined
          : !!(el.attrs && Object.prototype.hasOwnProperty.call(el.attrs, name))
      return required.every(has) && !excluded.some(has)
    }
  }).filter(Boolean)
  if (!compiled.length) return null
  // querySelector returns the first element in DOCUMENT order that matches any
  // group, not the first group's match, so order the candidates not the groups.
  return candidates.find((el) => compiled.some((match) => match(el))) || null
}

/**
 * The booking surface resets on the modal embed's close-complete event, not on
 * a close control's click, so the suite needs a window-level event bus to close
 * the dialog with. The controller reads `global.addEventListener` when it
 * registers a popup, which is why this is installed before any test runs.
 */
const modalEvents = new EventTarget()
global.addEventListener = function (name, listener) { modalEvents.addEventListener(name, listener) }
global.removeEventListener = function (name, listener) { modalEvents.removeEventListener(name, listener) }

function dispatchModal(type, modal) {
  modalEvents.dispatchEvent(new CustomEvent(type, { detail: { modal } }))
}

/**
 * How many times the shared surface reset ran, read off the public ownership
 * seam: every `lifecycle.reset` claims one generation for the container, so the
 * gap between two claims minus this probe's own claim is the reset count.
 */
function resetCounter(container) {
  let mark = global.StartersBookingSurfaceOwnership.claim(container)
  return function since() {
    const next = global.StartersBookingSurfaceOwnership.claim(container)
    const count = next - mark - 1
    mark = next
    return count
  }
}

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
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  removeAttribute(name) { delete this.attrs[name] }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  addEventListener(name, listener) { this.listeners[name] = listener }

  /**
   * Enough of `closest` for the contracts this engine walks: a tag name, a
   * bare `[attribute]`, an `[attribute="value"]`, or a `.class`. The contract
   * walks from the mount container out to the dialog, so the stub has to model
   * ancestry as well as descent.
   */
  closest(selector) {
    const target = String(selector).trim()
    const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(target)
    const className = /^\.([\w-]+)$/.exec(target)
    for (let node = this; node; node = node.parentElement) {
      if (attribute) {
        const value = node.getAttribute(attribute[1])
        if (value !== null && (attribute[2] === undefined || value === attribute[2])) return node
      } else if (className) {
        const classes = String(node.getAttribute('class') || '').split(/\s+/)
        if (classes.includes(className[1])) return node
      } else if (node.tagName === selector) {
        return node
      }
    }
    return null
  }

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
  global.document = calendarDocument()
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
    const timezone = container.querySelectorAll('[data-paid-calendar-element]')
      .find((node) => node.getAttribute('data-paid-calendar-element') === 'timezone')
    assert.equal(timeButtons.length, 2)
    assert.equal(dateButtons.length, 2)
    assert.equal(confirm.textContent, 'Request free call')
    assert.equal(timezone.value, result.timezone)
    assert.equal(timezone.getAttribute('aria-label'), 'Timezone')
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

test('timezone changes regroup dates, clear selection, and submit the selected timezone', async () => {
  const previous = {
    document: global.document,
    jQuery: global.jQuery,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const container = new CalendarElement('div')
  const selections = []
  const submissions = []
  const utcDay = Math.floor((Date.now() + 3 * 86400000) / 86400000) * 86400000
  const early = Math.floor((utcDay + 30 * 60000) / 1000)
  const later = Math.floor((utcDay + 12.5 * 3600000) / 1000)
  global.document = {
    createElement(tagName) { return new CalendarElement(tagName) },
  }
  global.jQuery = undefined
  global.xanoAuthFetch = async () => response({
    time_slots: [
      { start_time: early, end_time: early + 15 * 60 },
      { start_time: later, end_time: later + 15 * 60 },
    ],
  })

  try {
    const result = await api.mountPaidCalendar({
      container,
      config: { config_id: 'config_paid', grant_id: 'grant_test', duration: 15 },
      initialTimezone: 'UTC',
      timezones: ['UTC', 'Pacific/Honolulu'],
      onSelectionChange(slot) { selections.push(slot) },
      async onConfirm(slot) { submissions.push(slot) },
    })
    const role = (name) => container.querySelectorAll('[data-paid-calendar-element]')
      .find((node) => node.getAttribute('data-paid-calendar-element') === name)
    const timezone = role('timezone')
    const confirm = role('confirm')

    assert.equal(container.querySelectorAll('[data-paid-calendar-date]').length, 1)
    assert.equal(container.querySelectorAll('[data-paid-calendar-slot]').length, 2)
    assert.deepEqual(timezone.children.map((option) => option.value), ['UTC', 'Pacific/Honolulu'])

    container.querySelectorAll('[data-paid-calendar-slot]')[0].listeners.click()
    assert.equal(confirm.disabled, false)
    timezone.value = 'Pacific/Honolulu'
    timezone.listeners.change()

    assert.equal(result.timezone, 'Pacific/Honolulu')
    assert.equal(container.querySelectorAll('[data-paid-calendar-date]').length, 2)
    assert.equal(container.querySelectorAll('[data-paid-calendar-slot]').length, 1)
    assert.equal(confirm.disabled, true)
    assert.equal(selections.at(-1), null)

    container.querySelectorAll('[data-paid-calendar-slot]')[0].listeners.click()
    await confirm.listeners.click()
    assert.equal(submissions.length, 1)
    assert.equal(submissions[0].timezone, 'Pacific/Honolulu')
  } finally {
    global.document = previous.document
    global.jQuery = previous.jQuery
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

test('timezone changes rebuild the production jQuery datepicker', async () => {
  const previous = {
    document: global.document,
    jQuery: global.jQuery,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const container = new CalendarElement('div')
  const calls = []
  const start = Math.floor((Date.now() + 3 * 86400000) / 1000)
  global.document = {
    createElement(tagName) { return new CalendarElement(tagName) },
  }
  const jQuery = function () {
    return {
      datepicker(command, option, value) {
        calls.push({ command, option, value })
      },
    }
  }
  jQuery.fn = { datepicker() {} }
  global.jQuery = jQuery
  global.xanoAuthFetch = async () => response({
    time_slots: [{ start_time: start, end_time: start + 15 * 60 }],
  })

  try {
    await api.mountPaidCalendar({
      container,
      config: { config_id: 'config_paid', grant_id: 'grant_test', duration: 15 },
      initialTimezone: 'UTC',
      timezones: ['UTC', 'America/New_York'],
      async onConfirm() {},
    })
    const timezone = container.querySelectorAll('[data-paid-calendar-element]')
      .find((node) => node.getAttribute('data-paid-calendar-element') === 'timezone')
    timezone.value = 'America/New_York'
    timezone.listeners.change()

    assert.equal(calls.filter(({ command }) => typeof command === 'object').length, 2)
    assert.equal(calls.filter(({ command }) => command === 'destroy').length, 1)
  } finally {
    global.document = previous.document
    global.jQuery = previous.jQuery
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
})

/**
 * A calendar mount inside a booking dialog — the surface the back control is
 * allowed on. Bare containers model the other mounts this engine serves.
 */
function bookingMount() {
  const dialog = new CalendarElement('dialog')
  dialog.setAttribute('data-modal-target', 'popup-booking')
  const container = new CalendarElement('div')
  container.setAttribute('nylas-container', '')
  dialog.appendChild(container)
  return container
}

/**
 * Mounts the shared calendar against the element stub and hands back the
 * footer's parts by their `data-paid-calendar-element` role.
 */
/**
 * A document stub with the head the layout stylesheet needs. The engine bails
 * out silently on a document without `getElementById`, so without this the
 * injection would be untestable rather than merely untested.
 */
function calendarDocument() {
  const head = new CalendarElement('head')
  return {
    head,
    createElement(tagName) { return new CalendarElement(tagName) },
    getElementById(id) {
      return head.children.find((child) => child.getAttribute('id') === id) || null
    },
  }
}

/* A hand-rolled cascade simulator used to stand here — it parsed the injected
   sheet and reported a "computed" style per element. It was deleted rather
   than fixed. It could not tell a class selector it did not understand from
   one that matched everything, it dropped `:empty` and `:hover` before
   matching, and it treated `border` and `border-color` as unrelated
   properties, so it PASSED on rules that a browser would never have applied
   that way. A test that can pass for the wrong reason is worse than no test.

   The sheet's text is asserted directly below instead, which is what the rest
   of this file does. What the browser then does with that text is checked
   where it can actually be observed: the fixture screenshots captured for each
   round of this work. */

/**
 * The parts of one site button component. Reading them positionally is
 * deliberate: the order IS the contract, because the click overlay has to come
 * before the label for the label to sit on top of it.
 */
function siteButtonParts(wrap) {
  if (!wrap) return null
  const [clickableWrap, element] = wrap.children
  return {
    wrap,
    clickableWrap,
    button: clickableWrap && clickableWrap.children[0],
    element,
    text: element && element.children[0],
    line: element && element.children[1],
  }
}

async function mountFooterFixture(options = {}) {
  const previous = {
    document: global.document,
    jQuery: global.jQuery,
    xanoAuthFetch: global.xanoAuthFetch,
  }
  const container = options.container || bookingMount()
  const start =
    Math.floor((Date.now() + 2 * 24 * 60 * 60 * 1000) / 86400000) * 86400 + 12 * 60 * 60
  global.document = calendarDocument()
  global.jQuery = undefined
  global.xanoAuthFetch = async () => response({
    time_slots: options.slots === undefined
      ? [{ start_time: start, end_time: start + 15 * 60 }]
      : options.slots,
  })
  try {
    const mount = { container, config: { config_id: 'config_paid', grant_id: 'grant_test', duration: 15 }, async onConfirm() {} }
    if (options.confirmText) mount.confirmText = options.confirmText
    if (options.backText) mount.backText = options.backText
    if (options.onConfirm) mount.onConfirm = options.onConfirm
    const result = await api.mountPaidCalendar(mount)
    const role = (name) => container.querySelectorAll('[data-paid-calendar-element]')
      .find((node) => node.getAttribute('data-paid-calendar-element') === name) || null
    return {
      container,
      result,
      document: global.document,
      shell: role('shell'),
      footer: role('footer'),
      back: role('back'),
      confirm: role('confirm'),
      status: role('status'),
      backParts: siteButtonParts(role('back')),
      confirmParts: siteButtonParts(role('confirm')),
    }
  } finally {
    global.document = previous.document
    global.jQuery = previous.jQuery
    global.xanoAuthFetch = previous.xanoAuthFetch
  }
}

test('the calendar footer puts Back beside the confirm control', async () => {
  const { document, shell, footer, back, confirm, status, backParts } = await mountFooterFixture()
  const role = (name) => shell.querySelectorAll('[data-paid-calendar-element]')
    .find((node) => node.getAttribute('data-paid-calendar-element') === name)
  const layout = role('layout')
  const calendarPanel = role('calendar-panel')
  const timePanel = role('time-panel')
  const month = role('month')
  const timezone = role('timezone-control')
  const times = role('times')

  // Back reads before the call it steps away from, and both sit in one row —
  // the footer is what makes "beside" true rather than "stacked above".
  assert.equal(footer.tagName, 'div')
  assert.deepEqual(footer.children, [back, confirm])
  assert.equal(shell.children.indexOf(footer), 1)
  assert.deepEqual(
    shell.children.map((child) => child.getAttribute('data-paid-calendar-element')),
    ['layout', 'footer', 'status'],
  )
  assert.deepEqual(
    layout.children.map((child) => child.getAttribute('data-paid-calendar-element')),
    ['calendar-panel', 'time-panel'],
  )
  assert.deepEqual(
    calendarPanel.children.map((child) => child.getAttribute('data-paid-calendar-element')),
    ['month', 'timezone-control'],
  )
  assert.deepEqual(
    timePanel.children.map((child) => child.getAttribute('data-paid-calendar-element')),
    ['times'],
  )
  // The three responsive wrappers are built but left unstyled HERE, and the
  // sheet collapses them, because this surface's arrangement is the sheet's: an
  // inline grid on any of the boxes would nest it inside a second one no rule
  // could outrank. The dashboard keeps the inline columns — see the off-surface
  // test below.
  const ROLE = '[data-modal-target="popup-booking"] [data-paid-calendar-element='
  const css = document.head.children[0].textContent
  assert.deepEqual(Object.keys(layout.style), [], 'the sheet owns the booking layout')
  assert.deepEqual(Object.keys(calendarPanel.style), [], 'and the calendar panel')
  assert.deepEqual(Object.keys(timePanel.style), [], 'and the time panel with it')
  assert.ok(css.includes(
    ROLE + '"layout"],' + ROLE + '"calendar-panel"],' + ROLE + '"time-panel"]{display:contents}',
  ))
  // Collapsed, the DOM nesting the dashboard needs costs this surface nothing:
  // the month, the caption and the times are the shell's own grid items again
  // and the sheet places each of them by role.
  assert.equal(month.parentElement, calendarPanel)
  assert.equal(timezone.parentElement, calendarPanel)
  assert.equal(times.parentElement, timePanel)
  assert.equal(status.getAttribute('data-paid-calendar-element'), 'status')

  // The markers live on the WRAP, because that is the node the modal embed
  // finds: it reads `closest()` from the click target, and the click lands on
  // the overlay button nested inside. The three attributes ARE the behaviour —
  // close this dialog, open the chooser, and carry the marker the entry-aware
  // visibility keys on. A typo in any of them is a silently dead control.
  assert.equal(back.tagName, 'div')
  assert.equal(back.getAttribute('data-booking-back'), '')
  assert.equal(back.getAttribute('data-modal-close'), '')
  assert.equal(back.getAttribute('data-modal-trigger'), 'popup-booking-main')
  assert.equal(back.getAttribute('data-paid-calendar-element'), 'back')

  // The label is plain "Back". The arrow belonged to the unstyled text button
  // this replaced; the component carries its own affordance.
  assert.equal(backParts.text.textContent, 'Back')
  assert.equal(backParts.button.tagName, 'button')
  assert.equal(backParts.button.type, 'button')
  assert.equal(backParts.button.getAttribute('aria-label'), 'Back')

  // Display belongs to the profile script's guard stylesheet, and aria-hidden
  // to the profile script. A second writer here would fight them and could
  // flash the control on a direct entry.
  assert.equal(back.style.display, undefined)
  assert.equal(back.getAttribute('aria-hidden'), null)
})

test('both footer controls are the site button component, not bare buttons', async () => {
  // The whole point of the change: the look is inherited from the design
  // system rather than written here, and that only works if the markup is the
  // shape the design system's rules and typography are keyed on.
  const { backParts, confirmParts } = await mountFooterFixture()

  for (const [name, parts, style] of [
    ['back', backParts, 'secondary'],
    ['confirm', confirmParts, 'primary'],
  ]) {
    assert.equal(parts.wrap.getAttribute('class'), 'button_main-wrap', name)
    assert.equal(parts.wrap.getAttribute('data-button-style'), style, name)
    assert.equal(parts.clickableWrap.getAttribute('class'), 'clickable_wrap', name)
    assert.equal(parts.button.getAttribute('class'), 'clickable_btn', name)
    assert.equal(parts.button.getAttribute('aria-label'), parts.text.textContent, name)
    assert.equal(parts.element.getAttribute('class'), 'button_main-element', name)
    assert.equal(parts.text.getAttribute('class'), 'button_main-text', name)
    assert.equal(parts.line.getAttribute('class'), 'button_main-line', name)
    // No size variant class. The Designer's default size is the ABSENCE of a
    // `w-variant-*` / `.small` / `.large-*` class on the element, so anything
    // extra here is a button at the wrong size and weight.
    assert.equal(parts.element.children.length, 2, `${name} element holds label + line only`)
  }

  // Appearance is never written inline: an inline declaration outranks the
  // site's stylesheet and is the hardcoded look wearing the right class name.
  for (const [name, parts] of [['back', backParts], ['confirm', confirmParts]]) {
    for (const node of [parts.clickableWrap, parts.button, parts.element, parts.text, parts.line]) {
      assert.deepEqual(Object.keys(node.style), [], `${name} inner nodes carry no inline styles`)
    }
  }
})

test('the confirm starts disabled in look as well as behaviour', async () => {
  // A visitor reads the theme, not the `disabled` property. Setting only one of
  // the two leaves a live-looking button that does nothing.
  const { confirm, confirmParts } = await mountFooterFixture()
  assert.equal(confirmParts.button.disabled, true)
  assert.equal(confirm.getAttribute('data-button-theme'), 'disabled')
})

test('picking a slot turns the confirm black and live, and clearing it back', async () => {
  const { result, confirm, confirmParts, shell } = await mountFooterFixture()
  const slot = shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'times')
    .children[0]

  slot.listeners.click()
  assert.equal(confirmParts.button.disabled, false)
  assert.equal(confirm.getAttribute('data-button-theme'), 'black')

  // Clearing the selection — what changing the day does, and what the booking
  // controllers call between attempts — has to put the confirm back to BOTH
  // halves of disabled, not just the property.
  result.clearSelection()
  assert.equal(confirmParts.button.disabled, true)
  assert.equal(confirm.getAttribute('data-button-theme'), 'disabled')
})

test('the slot chips rest on #eee and go back to it after a deselect', async () => {
  // The resting colour is written in three places — when a chip is built, when
  // another chip is picked, and in the deselect reset — and the reset is the
  // one that gets forgotten. Miss it and a select-then-deselect leaves one chip
  // a different grey from its neighbours.
  const { result, shell } = await mountFooterFixture()
  const times = shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'times')
  const chip = times.children[0]

  assert.equal(chip.style.background, '#eee', 'resting on build')

  chip.listeners.click()
  assert.equal(chip.style.background, '#1f211d', 'selected')
  assert.equal(chip.style.color, '#ffffff')

  result.clearSelection()
  assert.equal(chip.style.background, '#eee', 'back to resting, not the old #f3f4ef')
  assert.equal(chip.style.color, '#1f211d')

  const reschedule = new CalendarElement('dialog')
  reschedule.setAttribute('data-modal-target', 'popup-booking-info')
  const host = new CalendarElement('div')
  reschedule.appendChild(host)
  const dashboard = await mountFooterFixture({ container: host })
  const dashboardTimes = dashboard.shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'times')
  const dashboardChip = dashboardTimes.children[0]
  assert.equal(dashboardChip.style.background, '#f3f4ef', 'dashboard build')
  dashboardChip.listeners.click()
  dashboard.result.clearSelection()
  assert.equal(dashboardChip.style.background, '#f3f4ef', 'dashboard reset')
})

test('the footer back label is overridable by the caller', async () => {
  const { backParts } = await mountFooterFixture({ backText: 'Back to call options' })
  assert.equal(backParts.text.textContent, 'Back to call options')
  assert.equal(backParts.button.getAttribute('aria-label'), 'Back to call options')
})

test('the Free flow gets the same footer with its own confirm label', async () => {
  // One engine serves both flows: free-call-booking.js passes only confirmText,
  // so the Free footer has to come out of this mount identical but for the
  // label — including the component markup.
  const { footer, back, confirm, confirmParts } = await mountFooterFixture({
    confirmText: 'Request free call',
  })

  assert.equal(confirmParts.text.textContent, 'Request free call')
  assert.equal(confirm.getAttribute('class'), 'button_main-wrap')
  assert.deepEqual(footer.children, [back, confirm])
  assert.equal(back.getAttribute('data-modal-trigger'), 'popup-booking-main')
})

test('the two ignored class attributes change nothing and raise nothing', async () => {
  // The live site has these authored today, and the component supersedes them.
  // Reacting to them at all — applying them, or warning — would be a change
  // Jerico has to chase before this can ship.
  const container = bookingMount()
  container.setAttribute('data-booking-confirm-class', 'button_main-wrap is-primary')
  container.setAttribute('data-booking-back-class', 'clickable-text-link')
  const plain = await mountFooterFixture()
  const authored = await mountFooterFixture({ container })

  assert.equal(authored.confirm.getAttribute('class'), 'button_main-wrap')
  assert.equal(authored.back.getAttribute('class'), 'button_main-wrap')
  assert.deepEqual(
    Object.keys(authored.confirm.style),
    Object.keys(plain.confirm.style),
    'an ignored attribute cannot change the placement writes either',
  )
})

test('an authored footer class is applied verbatim and places its own children', async () => {
  const container = bookingMount()
  container.setAttribute('data-booking-footer-class', 'call-sched_button-group')
  const { footer, back, confirm } = await mountFooterFixture({ container })

  assert.equal(footer.getAttribute('class'), 'call-sched_button-group')
  // The trap. An inline declaration outranks the Designer's stylesheet, so an
  // authored row that also carries the fallback layout is still the engine's
  // layout wearing the right class name. The shared action spacing is the one
  // exception, and it is placement between the two controls, not appearance.
  assert.deepEqual(Object.keys(footer.style), ['columnGap'])
  assert.equal(footer.style.columnGap, '0.5rem')
  assert.deepEqual(Object.keys(back.style), [], 'an authored row places its own children')
  assert.deepEqual(Object.keys(confirm.style), [])
})

test('the unauthored footer row writes only what does not vary by breakpoint', async () => {
  const { footer, back, confirm } = await mountFooterFixture()

  assert.equal(footer.getAttribute('class'), null)
  assert.equal(footer.style.display, 'flex')
  // The shared action spacing is written on every row; this row's own flex
  // `gap` shorthand supersedes it here, so every inline gap declaration on the
  // row has to carry the same length or the shorthand silently changes it.
  assert.equal(footer.style.columnGap, '0.5rem')
  assert.equal(footer.style.gap, '0.5rem')
  assert.deepEqual(
    Object.keys(footer.style)
      .filter((name) => /gap/i.test(name))
      .map((name) => footer.style[name]),
    ['0.5rem', '0.5rem'],
  )
  assert.equal(footer.style.width, '100%')

  // Alignment is NOT written here. The row is right-aligned natural-width
  // buttons on desktop and a full-width stack on mobile, and an inline
  // declaration outranks any stylesheet rule — writing `align-items` or a
  // `flex` basis here would pin one of those at both sizes. The sheet owns it.
  assert.equal(footer.style.alignItems, undefined)
  assert.equal(footer.style.justifyContent, undefined)

  // And the buttons carry no inline sizing at all any more, so they keep the
  // component's own padding and size to their label plus that padding.
  for (const [name, node] of [['back', back], ['confirm', confirm]]) {
    assert.deepEqual(Object.keys(node.style), [], `${name} carries no inline styles`)
  }
})

test('the class contract still reads the mount container before the dialog', async () => {
  // `authoredClassList` is unchanged and still serves the footer attribute and
  // the off-surface confirm, so its read order has to keep working.
  const dialog = new CalendarElement('dialog')
  dialog.setAttribute('data-modal-target', 'popup-booking')
  dialog.setAttribute('data-booking-footer-class', 'dialog-level')
  const container = new CalendarElement('div')
  container.setAttribute('nylas-container', '')
  dialog.appendChild(container)

  assert.deepEqual(api.authoredClassList(container, 'data-booking-footer-class'), ['dialog-level'])
  container.setAttribute('data-booking-footer-class', 'container-level')
  assert.deepEqual(api.authoredClassList(container, 'data-booking-footer-class'), ['container-level'])

  const { footer } = await mountFooterFixture({ container })
  assert.equal(footer.getAttribute('class'), 'container-level')
})

test('an authored class list is applied verbatim and blank values fall back', async () => {
  const container = bookingMount()
  container.setAttribute('data-booking-footer-class', '  is-row   call-sched_button-group  ')
  assert.deepEqual(
    api.authoredClassList(container, 'data-booking-footer-class'),
    ['is-row', 'call-sched_button-group'],
  )
  const authored = await mountFooterFixture({ container })
  assert.equal(authored.footer.getAttribute('class'), 'is-row call-sched_button-group')

  const blank = bookingMount()
  blank.setAttribute('data-booking-footer-class', '   ')
  const fallback = await mountFooterFixture({ container: blank })
  // Whitespace is not an authored class list, so the row keeps its own layout.
  assert.equal(fallback.footer.getAttribute('class'), null)
  assert.equal(fallback.footer.style.display, 'flex')
})

test('the shell declares no row gap, at either width', async () => {
  // The frame padding is the whole vertical rhythm now. An earlier round put a
  // 16px row gap on the shell, and once the stacked elements carried their own
  // padding that gap only ever reached mobile — desktop has overridden it to 0
  // since the footer became a band. Jerico struck it out; the month's bottom
  // padding separates it from the times, and the times' from the buttons.
  //
  // Nothing replaces it, so this is a check that no gap comes BACK: a row gap
  // plus the frame would double the spacing on a phone.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const beforeMedia = css.split('@media')[0]
  assert.ok(!beforeMedia.includes('row-gap'), 'no unconditional row gap')
  const mobileBlock = css.split('@media (max-width:767.98px){')[1].split('}@media')[0]
  // One row gap is allowed on mobile and it is not this one: the footer's own,
  // between its two stacked BUTTONS. Different box, different axis of doubling
  // — the frame padding it would double against is the footer's horizontal
  // one. Every other rule in the block still has to be gapless.
  for (const rule of mobileBlock.split('}')) {
    if (!rule.includes('row-gap')) continue
    assert.match(
      rule.slice(0, rule.lastIndexOf('{')),
      /\[data-paid-calendar-element="footer"\]\[data-paid-calendar-footer\]$/,
      `row gap added back for mobile: ${rule}`,
    )
  }
  // Desktop still says zero out loud. It is the initial value now, but it is
  // the declaration that documents the footer band as the only separator.
  assert.match(css.split('@media (min-width:768px){')[1], /"shell"\]\{column-gap:2rem;row-gap:0;/)
})

test('the booking shell defers its display and gaps to the sheet, the dashboard does not', async () => {
  // An inline declaration outranks a stylesheet rule whatever its specificity,
  // so an inline `gap` shorthand on the booking shell would pin `column-gap`
  // too and the sheet could not widen the month-to-times space without
  // `!important`. `display` went the same way once the two breakpoints needed
  // different formatting contexts — a grid on desktop, a flex column on a
  // phone so the footer can stick. Off the booking surface both stay inline,
  // exactly where they were.
  const { shell } = await mountFooterFixture()
  assert.deepEqual(Object.keys(shell.style), ['width'])
  assert.equal(shell.style.gap, undefined, 'the sheet owns the booking shell gaps')
  assert.equal(shell.style.display, undefined, 'and its display')

  const reschedule = new CalendarElement('dialog')
  reschedule.setAttribute('data-modal-target', 'popup-booking-info')
  const host = new CalendarElement('div')
  reschedule.appendChild(host)
  const away = await mountFooterFixture({ container: host })
  assert.deepEqual(Object.keys(away.shell.style), ['display', 'gap', 'width'])
  assert.equal(away.shell.style.gap, '16px', 'the dashboard shell is untouched')
})

test('a calendar mounted outside the booking dialog keeps its control contract', async () => {
  // This engine also mounts the dashboard's reschedule calendar
  // (dashboard-call-actions.js -> mountRescheduleCalendar), inside
  // `popup-booking-info`. There is no Free/Paid chooser to hand off to there,
  // no guard stylesheet to hide a back control, and no design-system context to
  // inherit — so that surface keeps the plain button and the authored-class
  // contract it shipped with, down to the inline fallback styles.
  const reschedule = new CalendarElement('dialog')
  reschedule.setAttribute('data-modal-target', 'popup-booking-info')
  const host = new CalendarElement('div')
  host.setAttribute('booking-reschedule-calendar', '')
  reschedule.appendChild(host)

  const away = await mountFooterFixture({ container: host, confirmText: 'Propose new time' })
  assert.equal(away.back, null)
  assert.equal(host.querySelectorAll('[data-booking-back]').length, 0)
  assert.equal(away.footer, null)

  // A plain single element, not the component: no wrap, no overlay, no label
  // div — and the confirm goes straight into the grid shell, where it
  // stretches, rather than becoming a flex child of a row.
  assert.equal(away.confirm.tagName, 'button')
  assert.equal(away.confirm.type, 'button')
  assert.equal(away.confirm.textContent, 'Propose new time')
  assert.equal(away.confirm.children.length, 0)
  assert.equal(away.confirm.disabled, true)
  assert.equal(away.confirm.getAttribute('data-button-theme'), null)
  assert.equal(away.shell.children.indexOf(away.confirm), 3)
  assert.equal(away.confirm.style.background, '#1f211d')
  assert.equal(away.confirm.style.color, '#ffffff')
  assert.equal(away.confirm.style.gridColumn, undefined, 'no row means no placement write')

  // The off-surface confirm still reads its authored class attribute.
  const classed = new CalendarElement('dialog')
  classed.setAttribute('data-modal-target', 'popup-booking-info')
  const classedHost = new CalendarElement('div')
  classedHost.setAttribute('data-booking-confirm-class', 'reschedule-cta')
  classed.appendChild(classedHost)
  const styled = await mountFooterFixture({ container: classedHost })
  assert.equal(styled.confirm.getAttribute('class'), 'reschedule-cta')
  assert.deepEqual(Object.keys(styled.confirm.style), [])

  // Fails closed on any surface the profile script's guard rule cannot reach.
  // `[popup-booking]` alone is such a surface: nothing would ever hide the
  // control there. On the published page both markers sit on the same dialog,
  // so requiring the guarded one costs nothing.
  const popupOnly = new CalendarElement('div')
  popupOnly.setAttribute('popup-booking', '')
  const looseMount = new CalendarElement('div')
  looseMount.setAttribute('nylas-container', '')
  popupOnly.appendChild(looseMount)
  const loose = await mountFooterFixture({ container: looseMount })
  assert.equal(loose.back, null, 'an unguarded surface gets no back control')
  assert.equal(loose.confirm.tagName, 'button', 'and no component confirm either')
})

test('an empty calendar still offers the way back to the chooser', async () => {
  // No times is exactly when a visitor wants the other kind of call, so the
  // footer has to survive the empty-state early return.
  const { container, footer, back, confirm, status, backParts } =
    await mountFooterFixture({ slots: [] })

  assert.equal(container.getAttribute('data-paid-calendar-state'), 'empty')
  assert.equal(status.textContent, 'No available times were found in the next 14 days.')
  assert.equal(confirm, null, 'there is nothing to request, so no Request button')
  assert.equal(back.getAttribute('data-modal-trigger'), 'popup-booking-main')
  assert.equal(backParts.text.textContent, 'Back')
  assert.equal(backParts.button.getAttribute('class'), 'clickable_btn')
  assert.deepEqual(footer.children, [back])
  assert.equal(container.children.indexOf(footer), 1)
})

test('the footer row is right-aligned on desktop and stacked on mobile', async () => {
  // On a direct entry the guard stylesheet hides the back WRAP with
  // `display:none`, which takes it out of the flex layout entirely. With the
  // row right-aligned the confirm simply stays at the right-hand end rather
  // than stretching to fill — the arrangement Jerico picked from the two
  // screenshots, and the one the modal's own authored button group uses.
  const { document, footer, back, confirm } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const ROLE = '[data-modal-target="popup-booking"] [data-paid-calendar-element='

  assert.ok(css.includes(ROLE + '"footer"]{grid-area:footer}'))
  assert.ok(css.includes('[data-paid-calendar-element="footer"][data-paid-calendar-footer]{display:flex;padding:1.25rem;justify-content:flex-end;align-items:center}'))
  // Nothing inline can fight it.
  assert.deepEqual(Object.keys(back.style), [])
  assert.deepEqual(Object.keys(confirm.style), [])
  assert.equal(footer.style.justifyContent, undefined)

  // Mobile still stacks full width, primary first.
  const mobile = css.split('@media (max-width:767.98px){')[1].split('}@media')[0]
  assert.ok(mobile.includes('{display:flex;flex-direction:column;align-items:stretch;row-gap:0.5rem}'))
  assert.ok(mobile.includes('{order:-1}'))

  // An authored row still gets no inline styles from the engine beyond the
  // shared action spacing. The sheet paints its frame; the DOM stays its own.
  const authoredFooter = bookingMount()
  authoredFooter.setAttribute('data-booking-footer-class', 'call-sched_button-group')
  const owned = await mountFooterFixture({ container: authoredFooter })
  assert.deepEqual(Object.keys(owned.footer.style), ['columnGap'])
  assert.equal(owned.footer.style.columnGap, '0.5rem')
  assert.deepEqual(Object.keys(owned.confirm.style), [])
  assert.deepEqual(Object.keys(owned.back.style), [])
})

test('an empty calendar off the booking surface renders no footer at all', async () => {
  const host = new CalendarElement('div')
  const { container, footer, back } = await mountFooterFixture({ container: host, slots: [] })
  assert.equal(back, null)
  assert.equal(footer, null)
  assert.equal(container.children.length, 1)
})

test('the layout stylesheet is scoped to the booking dialog, every rule', async () => {
  // This is the containment test, and it is the important one. The page has
  // other jQuery-UI datepickers wearing the same `.ui-datepicker` class — the
  // contract form's start and end dates — and the dashboard mounts this same
  // engine into a different dialog. One unscoped rule here restyles them.
  const { document } = await mountFooterFixture()
  const injected = document.head.children.filter((child) => child.tagName === 'style')
  assert.equal(injected.length, 1)
  const css = injected[0].textContent
  assert.equal(injected[0].getAttribute('id'), 'starters-booking-calendar-layout')

  const DIALOG = '[data-modal-target="popup-booking"]'
  // Split into selector/body pairs and require a dialog-scoped prefix on every
  // selector that is not a media query boundary or a brace.
  const selectors = css
    .split('}')
    .map((chunk) => chunk.split('{')[0].trim())
    .filter((sel) => sel && !sel.startsWith('@media') && sel !== '')
  assert.ok(selectors.length >= 8, 'the sheet should carry every layout rule')
  for (const sel of selectors) {
    for (const one of sel.split(',')) {
      assert.ok(
        one.trim().startsWith(DIALOG),
        `unscoped selector would leak off the booking dialog: ${one.trim()}`,
      )
    }
  }
  // Named explicitly, because a `.ui-datepicker` rule that escaped this file
  // would repaint the contract form's date fields on a page nobody was
  // testing.
  assert.ok(!/(^|[,{}])\s*\.ui-datepicker/.test(css), 'no unscoped .ui-datepicker rule')
  // The page's rules are plain class selectors, so a scoped descendant
  // selector already outranks them. Reaching for !important would mean the
  // scoping was wrong.
  assert.ok(!css.includes('!important'))
})

test('every length is rem; px is borders plus forced-colors outline', async () => {
  // Jerico's round-5 call, and the convention this file and the datepicker
  // sheet both follow: lengths in rem so they track the site's responsive root
  // font size, borders in px because a hairline is a device-pixel affordance
  // (at the 12.93px root a 0.0625rem border computes to 0.81px and renders
  // inconsistently or not at all), with one transparent 2px outline used only
  // as the forced-colors/High-Contrast focus hook.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent

  // Media query breakpoints are px by definition — they are viewport widths,
  // not lengths in the layout — so they are excluded before the sweep.
  const declarations = css
    .replace(/@media[^{]*\{/g, '')
    .replace('outline:2px solid transparent', '')
  for (const match of declarations.matchAll(/[\w-]+\s*:[^;{}]*?\d*\.?\d+px/g)) {
    assert.match(
      match[0],
      /^border(-top|-right|-bottom|-left)?(-width)?\s*:/,
      `every px length must be a border: ${match[0].trim()}`,
    )
  }

  // And the conversions themselves, so a future edit cannot quietly go back.
  assert.ok(css.includes('font-size:0.8125rem'), '13px status text')
  assert.ok(css.includes('box-shadow:0 0 0 0.1875rem'), '3px picker ring')
  assert.ok(css.includes('padding-left:0.25rem'), '4px weekday inset')
  assert.ok(css.includes('::-webkit-scrollbar{width:0.1875rem'), '3px scrollbar')
  assert.ok(css.includes('border-radius:0.1875rem'), '3px scrollbar thumb')
  // The hairline is gone, so the focus outline is the one px length left.
  assert.ok(!css.includes('border-top:'), 'the footer hairline was removed on request')
  // The focus outline is exempt for the same reason a border is, and for one
  // more: it is transparent, drawn only so forced-colors mode has an outline to
  // repaint. Its width is never seen in a normal render, and in forced-colors
  // the OS decides how it is painted anyway — so scaling it with the root font
  // size would buy nothing.
  assert.ok(css.includes('outline:2px solid transparent'), 'the forced-colors focus hook')
})

test('the sheet gives the month picker its ring and straightens the weekday row', async () => {
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const DIALOG = '[data-modal-target="popup-booking"]'

  // The card, as Jerico tuned it in the browser: the 3px #eee ring and the
  // #eee fill, and nothing else. Earlier rounds tried a flat picker and then a
  // 1px #d8d8d8 outline; this ring is what he meant by an outline all along.
  assert.ok(css.includes(DIALOG + ' .ui-datepicker.ui-widget-content{box-shadow:0 0 0 0.1875rem var(--Fill-Primary, #eee);background:#eee}'))
  // The page's original card also carried a `0 4px 8px` drop shadow. It is
  // deliberately NOT restored — his capture has the ring alone.
  assert.ok(!/0 4px 8px/.test(css), 'no drop shadow')
  // No border and no container padding, so the page's own zeroed border stands
  // and the header band sits flush. The pull-back rule that compensated for
  // that padding is gone with it.
  assert.ok(!/\.ui-datepicker\.ui-widget-content\{[^}]*border:/.test(css))
  assert.ok(!/\.ui-datepicker\.ui-widget-content\{[^}]*padding:/.test(css))
  assert.ok(!css.includes('.ui-datepicker .ui-datepicker-header'))

  // The weekday labels are left-aligned below the tablet breakpoint while the
  // dates are centred, so the header row sits 9.6-14.3px left of its own
  // columns, unevenly. Centring is the fix, and it survives the re-theme.
  assert.ok(css.includes(DIALOG + ' .ui-datepicker thead th{text-align:center}'))
  assert.ok(css.includes(DIALOG + ' .ui-datepicker thead th:first-child{padding-left:0.25rem}'))
  assert.ok(css.includes(DIALOG + ' .ui-datepicker thead th:last-child{padding-right:0.25rem}'))
})

test('the empty state keeps its bottom breathing room at both widths', async () => {
  // One mechanism now, at both widths: the FOOTER's own bottom padding. The
  // empty path appends the status and the footer straight to the mount with no
  // shell in between, so the footer is the last thing in it either way.
  //
  // Earlier rounds put this on the mount, for mobile only. That rule is gone:
  // with the footer padded on its bottom edge at both widths it would double,
  // and the mount would be paying for spacing it no longer owns.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const mobileBlock = css.split('@media (max-width:767.98px){')[1].split('}@media')[0]
  assert.ok(mobileBlock.includes('"footer"]{order:4}'))
  assert.ok(mobileBlock.includes('[data-paid-calendar-element="footer"][data-paid-calendar-footer]{position:sticky;bottom:0;background:#fff;padding:1.25rem}'))

  const desktopBlock = css.split('@media (min-width:768px){')[1]
  assert.ok(desktopBlock.includes('[data-paid-calendar-element="footer"][data-paid-calendar-footer]{display:flex;padding:1.25rem'))

  // No mount PADDING on any state that lays a calendar out. The mount does
  // carry rules — the banner's min-height and the empty state's column — so
  // this asks about the declaration rather than about the selector.
  //
  // `loading` and `error` are exempt, and the exemption is the point of the
  // rule rather than a hole in it: this guard exists because mount padding
  // DOUBLES against the footer's own, and those two states have no footer and
  // no shell to double against. They are the only states where the mount is
  // the sole thing that can carry a frame, so there it must.
  //
  // The exemption is per SELECTOR, not per rule: a rule that merely mentions
  // the two — the min-height floor lists all four states in one selector list
  // — still has to answer for `ready` and `empty`, which do have a footer to
  // double against.
  const framed = /data-paid-calendar-state="(loading|error)"/
  let checked = 0
  for (const rule of css.split('}')) {
    if (!rule.includes('[nylas-container]')) continue
    const selectors = rule.slice(0, rule.lastIndexOf('{')).split(',')
    if (selectors.every((selector) => framed.test(selector))) continue
    checked += 1
    assert.ok(!/padding/.test(rule), `no mount padding: ${rule}`)
  }
  // The loop still has mount rules to judge — an exemption that swallowed any
  // of them would pass this test while asserting less. Two rules reach a
  // calendar-laying state: the four-state min-height floor and the empty
  // state's column.
  assert.ok(checked >= 2, `mount rules checked: ${checked}`)
})

test('the interior frame is the only inset at mobile too', async () => {
  // Jerico specced these element by element at 400px. The desktop asymmetry
  // does not transfer: stacked, there is no column gap to hand the inner edges
  // to, so every element repeats the horizontal frame and only the month opens
  // the top.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const mobileBlock = css.split('@media (max-width:767.98px){')[1].split('}@media')[0]

  assert.ok(mobileBlock.includes('"month"]{order:1;padding:1.25rem}'))
  assert.ok(mobileBlock.includes('"times"]{order:3;padding:0 1.25rem 1.25rem}'))
  // The floating footer is framed on all four sides, not three: its top edge
  // is where the chips pass behind it, so nothing above can space it. Keyed on
  // the bare attribute, so an authored row is framed too — the engine always
  // paints this frame now.
  assert.match(mobileBlock, /\[data-paid-calendar-element="footer"\]\[data-paid-calendar-footer\]\{[^}]*padding:1\.25rem\}/)
  assert.ok(mobileBlock.includes('"footer"]{order:4}'))
  assert.ok(mobileBlock.includes('[data-paid-calendar-element="footer"][data-paid-calendar-footer]{position:sticky;bottom:0;background:#fff;padding:1.25rem}'))

  // Borderless on request; the sticky bar's white fill is the only divider.
  assert.ok(!/border-top/.test(mobileBlock))

  // Desktop is untouched by all of this — the two blocks cannot both match.
  const desktopBlock = css.split('@media (min-width:768px){')[1]
  assert.ok(desktopBlock.includes('"month"]{grid-area:month;align-self:start;padding:1.25rem 0 1.25rem 1.25rem}'))
})

test('the footer stacks primary-first below the site mobile breakpoint', async () => {
  const { document, footer } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const ROW = '[data-modal-target="popup-booking"] [data-paid-calendar-element="footer"][data-paid-calendar-footer]'

  assert.ok(css.includes('@media (max-width:767.98px){'))
  assert.ok(css.includes(ROW + '{display:flex;flex-direction:column;align-items:stretch;row-gap:0.5rem}'))
  // Primary on top, matching the profile's own vertical CTA rail.
  assert.ok(css.includes(ROW + ' [data-paid-calendar-element="confirm"]{order:-1}'))

  // The stack's own spacing, which the engine's inline `column-gap` cannot
  // give a column. The fallback row's inline `gap` shorthand carries a row gap
  // of its own and outranks this; an authored row has only its class, so
  // without this rule its two buttons touch. Same 0.5rem either way.
  assert.match(css.split('@media (max-width:767.98px){')[1].split('}@media')[0],
    /\[data-paid-calendar-element="footer"\]\[data-paid-calendar-footer\]\{[^}]*row-gap:0\.5rem/)
  assert.equal(footer.style.gap, '0.5rem')

  // Every stacking rule that reaches a footer keys on the doubled attribute,
  // so it reaches an authored row too and still outranks its class. Two rules
  // are exempt and both are named here: the mount's column stacks the empty
  // state's contents, and the shell's stacks the panel itself. Neither reaches
  // into a footer.
  assert.equal(footer.getAttribute('data-paid-calendar-footer'), 'fallback')
  for (const line of css.split('}')) {
    if (!line.includes('flex-direction:column') && !line.includes('order:-1')) continue
    if (line.includes('[nylas-container]')) continue
    if (line.includes('"shell"]')) continue
    assert.ok(line.includes('[data-paid-calendar-element="footer"][data-paid-calendar-footer]'), line)
  }
})

test('both footer flavours are still stamped and still distinguishable', async () => {
  // Re-keying the sheet onto the bare attribute did not collapse the
  // distinction between the two rows, it only stopped the FRAME depending on
  // it. The value still says which row this is, and the DOM each one gets is
  // still different — that part of the contract is unchanged.
  const fallback = await mountFooterFixture()
  assert.equal(fallback.footer.getAttribute('data-paid-calendar-footer'), 'fallback')
  // The engine's own row still brings its inline flex box.
  assert.equal(fallback.footer.style.display, 'flex')
  assert.equal(fallback.footer.style.width, '100%')

  const container = bookingMount()
  container.setAttribute('data-booking-footer-class', 'call-sched_button-group')
  const { footer } = await mountFooterFixture({ container })
  assert.equal(footer.getAttribute('data-paid-calendar-footer'), 'authored')
  assert.equal(footer.getAttribute('class'), 'call-sched_button-group')
  // The shared action spacing is still the only thing written on an authored
  // row. That matters more than it used to: the sheet now paints this row, and
  // an inline declaration here would outrank every rule in it.
  assert.deepEqual(Object.keys(footer.style), ['columnGap'])
  assert.equal(footer.style.columnGap, '0.5rem')
})

test('the desktop footer is a full-width band under both columns', async () => {
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const ROLE = '[data-modal-target="popup-booking"] [data-paid-calendar-element='

  assert.ok(css.includes('@media (min-width:768px){'))
  // The footer spans BOTH columns on its own row, so the buttons anchor to the
  // bottom of the whole panel rather than the bottom of the right column.
  // Replayed verbatim, Jerico's `position:absolute` version overlaps the times
  // by 78px and the month by 110px, and on mobile it covers the slots so
  // completely that a slot cannot be clicked at all.
  assert.match(css, /grid-template-areas:"month timezone" "month times" "footer footer"/)
  assert.match(css, /grid-template-rows:min-content minmax\(0,1fr\) min-content;/)
  // Two rows, not three: the status became a banner anchored to the modal's
  // body, so a `status` grid area here would be a track nothing lands in.
  assert.ok(!/"status status"/.test(css))
  assert.ok(!/"status"\]\{grid-area/.test(css))
  // The footer stays in flow. The banner is the ONE absolutely positioned
  // thing in this sheet, and it is the status, never the footer: replayed
  // verbatim, an absolute footer overlaps the times by 78px and blocks every
  // slot tap on mobile.
  for (const rule of css.split('}')) {
    if (!rule.includes('position:absolute')) continue
    assert.ok(rule.includes('"status"]'), `only the status may leave the flow: ${rule}`)
  }

  // The containment, measured rather than reasoned: a flexible track in an
  // auto-height grid is sized to max-content, so `minmax(0,1fr)` alone let the
  // times row reach 397px against the month's 305px and grew the modal from
  // 438px to 601px. `height:0` takes the times out of track sizing so the
  // month decides the row height; `min-height:100%` refills the area.
  assert.match(css, /"times"\]\{grid-area:times;height:0;min-height:100%;align-content:start;/)
  // `align-content:start` keeps the chips compact — a stretched grid inflated
  // four chips to 113px against 42.7px on a busy day.
  assert.match(css, /"times"\]\{[^}]*align-content:start/)

  // The 1.25rem interior frame. Both columns now pad their bottom edge too, so
  // they end level above the footer's rule.
  assert.ok(css.includes(ROLE + '"month"]{grid-area:month;align-self:start;padding:1.25rem 0 1.25rem 1.25rem}'))
  // The times no longer pad their TOP: the timezone caption above owns that
  // edge of the frame, and padding both would put a whole frame between the
  // caption and the first chip.
  assert.match(css, /"times"\]\{[^}]*padding:0 1\.25rem 1\.25rem 0\}/)

  // Zero row gap: the band's own padding does the separating.
  assert.match(css, /"shell"\]\{column-gap:2rem;row-gap:0;/)
  assert.ok(css.includes(ROLE + '"footer"]{grid-area:footer}'))
})

test('the authored step stops padding the calendar at every width', async () => {
  // `.call-details_layout` is the wrapper the mount sits in, and the site pads
  // it by `--_spacing---spacer--spacing-14` (32.3px measured at 1280, 15.4px
  // at 375). With the interior frame doing that job on the elements
  // themselves, that padding was a second frame outside the first: the
  // footer's hairline stopped short of both modal edges, the banner could not
  // run the panel's full width, and on a phone the two insets stacked.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const D = '[data-modal-target="popup-booking"]'

  // Unconditional, so neither breakpoint can be left with a doubled inset.
  assert.ok(css.split('@media')[0].includes(D + ' [data-paid-calendar-step]{padding:0;overflow:visible}'))
  assert.ok(!css.split('@media (min-width:768px){')[1].includes('data-paid-calendar-step'))
  // NEVER on the bare class. The dialog has four `.call-details_layout`
  // wrappers — calendar, success, confirmed, payment-methods — and a rule on
  // the class stripped the authored padding from all of them.
  assert.ok(!/\.call-details_layout/.test(css), 'the class must not be styled')

  // Specificity rather than `!important`, which this sheet forbids: the site's
  // own declarations are flat `.call-details_layout` class selectors at
  // (0,1,0), and the dialog attribute makes this (0,2,0).
  assert.ok(!/\.call-details_layout[^}]*!important/.test(css))
})

test('only the calendar\'s own step wrapper loses its padding', async () => {
  // The booking dialog has FOUR `.call-details_layout` wrappers — the calendar
  // step, success, confirmed and payment-methods. A rule on the bare class
  // stripped the authored padding from every one of them, which is how the
  // success step ended up flush against the modal's edges. The engine marks
  // the one ancestor it actually mounts into.
  const dialog = new CalendarElement('dialog')
  dialog.setAttribute('data-modal-target', 'popup-booking')
  const calendarStep = new CalendarElement('div')
  calendarStep.setAttribute('class', 'call-details_layout height-auto')
  const otherStep = new CalendarElement('div')
  otherStep.setAttribute('class', 'call-details_layout height-auto')
  const mount = new CalendarElement('div')
  mount.setAttribute('nylas-container', '')
  calendarStep.appendChild(mount)
  dialog.appendChild(calendarStep)
  dialog.appendChild(otherStep)

  await mountFooterFixture({ container: mount })
  assert.equal(calendarStep.getAttribute('data-paid-calendar-step'), '', 'the calendar step is marked')
  assert.equal(otherStep.getAttribute('data-paid-calendar-step'), null, 'the other steps are not')
})

test('the step wrapper is marked only on the booking surface', async () => {
  // Off it there is no sheet to read the marker, and that surface has to stay
  // as it shipped.
  const reschedule = new CalendarElement('dialog')
  reschedule.setAttribute('data-modal-target', 'popup-booking-info')
  const step = new CalendarElement('div')
  step.setAttribute('class', 'call-details_layout')
  const host = new CalendarElement('div')
  host.setAttribute('booking-reschedule-calendar', '')
  step.appendChild(host)
  reschedule.appendChild(step)
  await mountFooterFixture({ container: host })
  assert.equal(step.getAttribute('data-paid-calendar-step'), null)
})

test('every footer row gets the frame, authored class or not', async () => {
  /* The contract this enforces was REVERSED on purpose. It used to be "an
     authored `data-booking-footer-class` row places its own children and
     paints itself", so appearance keyed on `="fallback"`. Live production
     authors `call-sched_button-group` on that row, so the band was keyed to a
     value the real page never carries and none of it rendered there.

     Now: the engine always paints the booking footer's frame, and an authored
     class may only ADD to it. */
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const PLACEMENT = /^(grid-area|order)$/

  // Appearance must never key on the BARE role selector. Not because an
  // authored row should escape it any more, but because that selector is
  // (0,2,0) and the authored class it has to beat is (0,1,0) in the site's own
  // head sheet — the doubled attribute is what buys the extra specificity, so
  // a declaration that drifts back onto the bare selector would silently stop
  // winning on the one page that matters.
  for (const chunk of css.split('}')) {
    const [selector, body] = chunk.split('{')
    if (!selector || !body) continue
    if (!/\[data-paid-calendar-element="footer"\]\s*$/.test(selector.trim())) continue
    for (const declaration of body.split(';')) {
      if (!declaration.trim()) continue
      const property = declaration.split(':')[0].trim()
      assert.ok(
        PLACEMENT.test(property),
        `appearance on the low-specificity selector: ${selector.trim()}{${declaration.trim()}}`,
      )
    }
  }

  // Every appearance rule now keys on the bare ATTRIBUTE, which matches both
  // `fallback` and `authored`. None may pin a single value.
  const APPEARANCE = /(border-top|position:sticky|padding|background|justify-content|align-items|flex-direction)/
  let appearanceRules = 0
  for (const chunk of css.split('}')) {
    const [selector, body] = chunk.split('{')
    if (!selector || !body) continue
    if (!selector.includes('data-paid-calendar-footer')) continue
    if (!APPEARANCE.test(body)) continue
    appearanceRules += 1
    assert.ok(
      !/data-paid-calendar-footer="/.test(selector),
      `frame pinned to one footer flavour: ${selector.trim()}{${body.trim()}}`,
    )
    // And it carries the doubled attribute that beats the authored class.
    assert.match(selector, /\[data-paid-calendar-element="footer"\]\[data-paid-calendar-footer\]/)
  }
  // The desktop band, the mobile sticky band and the mobile column.
  assert.equal(appearanceRules, 3)

  // Nothing the engine uses to ARRANGE the two actions may depend on the
  // authored class's formatting context. The engine writes an inline
  // `display` on its own fallback row only, so any rule that reaches an
  // authored row with a flex-container property has to establish the flex
  // container itself in the same rule — otherwise a `display:block` or
  // `display:grid` class leaves the declaration inert, the band still painted
  // and the two wraps in DOM order with Back above Confirm.
  const CONTAINER_ONLY = /(^|;)\s*(justify-content|align-items|flex-direction|row-gap|column-gap)\s*:/
  let arrangementRules = 0
  for (const chunk of css.split('}')) {
    const [selector, body] = chunk.split('{')
    if (!selector || !body) continue
    if (!/\[data-paid-calendar-footer\]\s*$/.test(selector.trim())) continue
    if (!CONTAINER_ONLY.test(body)) continue
    arrangementRules += 1
    assert.match(body, /(^|;)\s*display:flex(;|$)/,
      `arrangement without its own flex container: ${selector.trim()}{${body.trim()}}`)
  }
  // The desktop band and the mobile column.
  assert.equal(arrangementRules, 2)
  // And the engine still writes no `display` of its own on an authored row,
  // which is exactly why the rules above have to carry it.
  const authored = bookingMount()
  authored.setAttribute('data-booking-footer-class', 'call-sched_button-group')
  const owned = await mountFooterFixture({ container: authored })
  assert.equal(owned.footer.style.display, undefined)

  // The frame itself, spelled out, on the selector that reaches an authored row.
  const F = '[data-paid-calendar-element="footer"][data-paid-calendar-footer]'
  assert.ok(css.includes(F + '{display:flex;padding:1.25rem;justify-content:flex-end;align-items:center}'))
  assert.ok(css.includes(F + '{position:sticky;bottom:0;background:#fff;padding:1.25rem}'))
  assert.ok(css.includes(F + '{display:flex;flex-direction:column;align-items:stretch;row-gap:0.5rem}'))
  assert.ok(css.includes(F + ' [data-paid-calendar-element="confirm"]{order:-1}'))

  // Still scoped to the booking dialog, so the dashboard's reschedule calendar
  // — which has no injected sheet at all — keeps the look it shipped with.
  for (const chunk of css.split('}')) {
    const [selector] = chunk.split('{')
    if (!selector || !selector.includes('data-paid-calendar-footer')) continue
    assert.ok(selector.trim().startsWith('[data-modal-target="popup-booking"]'))
  }

  assert.ok(!css.includes('!important'))
})


test('a booking in flight takes the back control out of the pointer path', async () => {
  // Disabling the inner button is not enough. The WRAP carries
  // `data-modal-close`, and the modal embed resolves it with `closest()` from
  // the click target, so the border around a disabled button still closed the
  // dialog with the request open — losing the surface the confirmation was
  // about to land on.
  let release
  const { document, backParts, back, confirmParts, footer } = await mountFooterFixture({
    onConfirm: () => new Promise((resolve) => { release = resolve }),
  })
  const css = document.head.children[0].textContent
  assert.ok(css.includes('[data-paid-calendar-element="back"][data-paid-calendar-busy]{pointer-events:none}'))

  const slot = footer.parentElement.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'times')
    .children[0]
  slot.listeners.click()
  assert.equal(back.getAttribute('data-paid-calendar-busy'), null)

  const pending = confirmParts.button.listeners.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(back.getAttribute('data-paid-calendar-busy'), '', 'the wrap stops taking clicks')
  assert.equal(backParts.button.disabled, true)
  // The theme swaps too, so it READS disabled rather than just refusing.
  assert.equal(back.getAttribute('data-button-theme'), 'disabled')

  release()
  await pending
  assert.equal(back.getAttribute('data-paid-calendar-busy'), null, 'and it comes back')
  assert.equal(backParts.button.disabled, false)
  assert.equal(back.getAttribute('data-button-theme'), 'black')
})

test('a status message scrolls itself into view', async () => {
  // The banner is absolute against the modal's body, which is also what
  // scrolls on a phone — so it paints at the top of the CONTENT, not the top
  // of what the visitor can see. Measured from the bottom of a busy day's
  // scroll: a failure message rendered 487px above the viewport and nothing
  // changed on screen.
  const scrollport = new CalendarElement('div')
  scrollport.scrollHeight = 1245
  scrollport.clientHeight = 726
  scrollport.scrollTop = 519

  const dialog = new CalendarElement('dialog')
  dialog.setAttribute('data-modal-target', 'popup-booking')
  const mount = new CalendarElement('div')
  mount.setAttribute('nylas-container', '')
  scrollport.appendChild(mount)
  dialog.appendChild(scrollport)

  const { confirmParts, footer } = await mountFooterFixture({
    container: mount,
    onConfirm: async () => { throw new Error('booking refused') },
  })
  const slot = footer.parentElement.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'times')
    .children[0]
  slot.listeners.click()
  assert.equal(
    scrollport.scrollTop, 519,
    'clearing the status must NOT scroll — that would yank a visitor browsing slots',
  )

  await confirmParts.button.listeners.click()
  assert.equal(scrollport.scrollTop, 0, 'a failure brings its banner into view')
})

test('empty availability scrolls its status banner into view', async () => {
  const scrollport = new CalendarElement('div')
  scrollport.scrollHeight = 1245
  scrollport.clientHeight = 726
  scrollport.scrollTop = 519

  const dialog = new CalendarElement('dialog')
  dialog.setAttribute('data-modal-target', 'popup-booking')
  const mount = new CalendarElement('div')
  mount.setAttribute('nylas-container', '')
  scrollport.appendChild(mount)
  dialog.appendChild(scrollport)

  await mountFooterFixture({ container: mount, slots: [] })
  assert.equal(scrollport.scrollTop, 0)
})

test('a status message never scrolls a box outside the booking dialog', async () => {
  // The desktop shape: nothing inside the dialog overflows, because the times
  // list scrolls inside its own grid cell precisely so the panel never grows.
  // The first scroller above the banner is then the page itself, and scrolling
  // that would yank the hire profile behind the open modal to the top while
  // the banner was already fully in view.
  const page = new CalendarElement('html')
  page.scrollHeight = 4820
  page.clientHeight = 900
  page.scrollTop = 1640

  const dialog = new CalendarElement('dialog')
  dialog.setAttribute('data-modal-target', 'popup-booking')
  const mount = new CalendarElement('div')
  mount.setAttribute('nylas-container', '')
  dialog.appendChild(mount)
  page.appendChild(dialog)

  await mountFooterFixture({ container: mount, slots: [] })
  assert.equal(page.scrollTop, 1640, 'the page behind the modal must not move')
})

test('the stacked footer floats, and only because the shell is a flex column', async () => {
  // On a phone the whole panel scrolls inside the modal's body, so the buttons
  // would otherwise sit below the fold on a busy day. Sticky pins them to the
  // bottom of that scrollport while keeping them IN FLOW, which is what
  // reserves their slot at the end and stops the last chips landing under
  // them — the "space at the bottom" in Jerico's note, structural rather than
  // a guessed offset.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const mobileBlock = css.split('@media (max-width:767.98px){')[1].split('}@media')[0]

  assert.ok(mobileBlock.includes('"footer"]{order:4}'))
  assert.ok(mobileBlock.includes('[data-paid-calendar-element="footer"][data-paid-calendar-footer]{position:sticky;bottom:0;background:#fff;padding:1.25rem}'))

  /* The flex column is load-bearing, not a refactor. A GRID item's containing
     block is its own grid area, so a footer on the last row has zero room to
     travel and sticky does nothing whatsoever; a flex item's containing block
     is the whole shell. Measured at 400 on a busy day: 1245px of shell inside
     a 726px scrollport, so a grid would have thrown away 519px of travel.
     Do not "simplify" this back to grid rows. */
  assert.ok(mobileBlock.includes('"shell"]{display:flex;flex-direction:column}'))
  assert.ok(!mobileBlock.includes('grid-template-areas'), 'a grid here kills the sticky')
  assert.ok(!/"footer"\]\{[^}]*grid-area/.test(mobileBlock))

  // An opaque fill, because chips scroll underneath and would otherwise show
  // through the gap between the two buttons.
  assert.match(mobileBlock, /\[data-paid-calendar-element="footer"\]\[data-paid-calendar-footer\]\{[^}]*background:#fff/)

  // Borderless on request, both widths.
  assert.ok(!/border-top/.test(mobileBlock))

  // Desktop keeps the grid and the always-visible band: nothing sticks there,
  // because the times scroll inside their own cell instead.
  const desktopBlock = css.split('@media (min-width:768px){')[1]
  assert.ok(!desktopBlock.includes('position:sticky'))
  assert.match(desktopBlock, /grid-template-areas:"month timezone" "month times" "footer footer"/)
})

test('the timezone selector sits above the slots at both widths', async () => {
  // The shared engine renders a note naming the clock the times are shown in,
  // and appends it to the shell with no placement of its own. Left alone on
  // desktop it auto-placed into an implicit row BELOW the footer band, at half
  // the panel width and flush to the modal's left edge; on a phone it ran
  // full-bleed while every neighbour was inset. Jerico placed it at the top of
  // the times area, above the first row of chips, at both widths.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const ROLE = '[data-modal-target="popup-booking"] [data-paid-calendar-element='

  // Desktop: its own area at the top of the right column, with the month
  // spanning down beside it so the panel does not grow by the caption.
  const desktopBlock = css.split('@media (min-width:768px){')[1]
  assert.ok(desktopBlock.includes(
    ROLE + '"timezone-control"]{grid-area:timezone;padding:1.25rem 1.25rem 1rem 0}',
  ))

  // Mobile: it has to be MOVED, not just padded. The engine appends it FIRST
  // in the shell, ahead of the month (see the shell order pinned above), so
  // document order alone would render it above the calendar; `order:2` drops
  // it between the month and the chips. The inset is the frame every
  // neighbour carries — and it must be the frame, not a bleed.
  const mobileBlock = css.split('@media (max-width:767.98px){')[1].split('}@media')[0]
  assert.ok(mobileBlock.includes(ROLE + '"timezone-control"]{order:2;padding:0 1.25rem 1rem}'))
  // `order` only applies to flex items, so the column is load-bearing for this
  // placement too, not only for the sticky footer.
  assert.ok(mobileBlock.includes('"shell"]{display:flex;flex-direction:column}'))

  // The control's internal label/select layout belongs to the sheet on the
  // booking surface, because its former inline placement writes overrode the
  // grid and flex placement rules above.
  const beforeMedia = css.split('@media')[0]
  assert.ok(beforeMedia.includes(ROLE + '"timezone-control"]{display:grid;gap:0.375rem}'))

  // The WRAPPER itself gets layout and no margin — it is the box the grid and
  // flex placement rules act on, and a margin here would fight the padding
  // those rules give it at each width. Only rules that END at the wrapper are
  // checked: the caption below it is a separate element with its own role, so
  // this guard has nothing to say about it.
  for (const rule of css.split('}')) {
    const selector = (rule.split('{')[0] || '').trim()
    if (!/\[data-paid-calendar-element="timezone-control"\]$/.test(selector)) continue
    assert.ok(!/(^|;|\{)\s*margin\s*:/.test(rule), rule)
  }
})

test('the timezone select wears the modal\'s design, not the OS default', async () => {
  // Jerico: "keep our UI design". A native select renders as an OS control,
  // and `appearance:none` plus the rules below rebuild the CLOSED face in the
  // modal's own language. The OPEN list is drawn by the operating system and
  // cannot be styled — an accepted constraint, not an omission.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const ROLE = '[data-modal-target="popup-booking"] [data-paid-calendar-element='
  const face = css.split(ROLE + '"timezone"]{')[1].split('}')[0]

  // Both spellings: Safari still wants the prefixed one.
  assert.match(face, /(^|;)appearance:none/)
  assert.match(face, /-webkit-appearance:none/)
  // The site's face and the sheet's own scale, not the UA stylesheet's.
  assert.match(face, /font:inherit/)
  assert.match(face, /font-size:0\.9375rem/)
  assert.match(face, /font-weight:400/)
  // The floor the suppressed inline styles used to carry, in rem. Without it
  // the control is shorter than the chips it sits above, because nothing else
  // in this rule holds it open.
  assert.match(face, /min-height:2\.625rem/)
  // White with the modal's own hairline, NOT the chips' #eee fill: the control
  // sits directly above a field of grey chips and a grey box there reads as
  // the first chip rather than as a control to open.
  assert.match(face, /background-color:#fff/)
  assert.match(face, /border:1px solid #eee/)
  assert.match(face, /border-radius:0\.375rem/)
  assert.ok(!/background-color:#eee/.test(face), 'not chip-coloured')
  // Their off-palette border is gone.
  assert.ok(!/#d7d9d2/.test(css))
  // A chevron of our own, since `appearance:none` removes the OS one.
  assert.match(face, /background-image:url\("data:image\/svg\+xml/)
  assert.match(face, /stroke='%231e211e'/, 'the month picker nav arrows\' colour')
  // A miter join on this vertex projects the point past the bottom of the
  // 6-unit viewBox and the tip gets clipped; rounding the join keeps the whole
  // chevron inside the box.
  assert.match(face, /stroke-linejoin='round'/)
  assert.match(face, /background-repeat:no-repeat/)
  assert.match(face, /background-position:right 0\.75rem center/)
  // Room for it on the right, and rem padding like everything else here.
  assert.match(face, /padding:0\.625rem 2\.25rem 0\.625rem 0\.75rem/)

  // Focus-visible, so a mouse click does not paint a ring nobody asked for.
  // The treatment is the site's own, lifted from the timepicker embed.
  const focus = css.split(ROLE + '"timezone"]:focus-visible{')[1].split('}')[0]
  assert.match(focus, /border-color:#20221f/)
  assert.match(focus, /box-shadow:0 0 0 0\.1875rem rgba\(32, 34, 31, 0\.1\)/)
  // A TRANSPARENT outline, never `outline:0`. Forced-colors mode replaces the
  // border colour with the OS palette and strips the box-shadow, so a
  // suppressed outline leaves a keyboard user with no focus indicator at all.
  assert.match(focus, /outline:2px solid transparent/)
  assert.ok(!/outline:0/.test(focus), 'a suppressed outline is invisible in forced-colors')

  // The caption keeps the engine's grey at the size the old static caption had,
  // on a rule that names the caption rather than every span in the control.
  assert.ok(css.includes(ROLE + '"timezone-caption"]{font-size:0.75rem;color:#6f746d}'))
  assert.ok(!/"timezone-control"\] span\{/.test(css), 'not any span the wrapper holds')
})

test('the timezone control keeps its inline look off the booking surface', async () => {
  // The dashboard's reschedule calendar has no sheet to take the look over, so
  // every inline declaration the engine used to write is still written there.
  const reschedule = new CalendarElement('dialog')
  reschedule.setAttribute('data-modal-target', 'popup-booking-info')
  const host = new CalendarElement('div')
  host.setAttribute('booking-reschedule-calendar', '')
  reschedule.appendChild(host)
  const away = await mountFooterFixture({ container: host })

  const findRole = (root, role) => root.querySelectorAll('[data-paid-calendar-element]')
    .find((node) => node.getAttribute('data-paid-calendar-element') === role)
  const control = findRole(away.shell, 'timezone-control')
  assert.ok(control, 'the control still renders there')
  const select = findRole(control, 'timezone')
  const caption = findRole(control, 'timezone-caption')
  assert.ok(caption, 'the caption carries its own role on every surface')
  assert.equal(select.style.border, '1px solid #d7d9d2')
  assert.equal(select.style.fontSize, '14px')
  assert.equal(select.style.minHeight, '42px')
  assert.equal(select.style.background, '#ffffff')
  assert.equal(caption.style.color, '#6f746d')
  assert.equal(caption.style.fontSize, '13px')

  // And on the booking surface it writes none of them.
  const { shell } = await mountFooterFixture()
  const onSurface = findRole(shell, 'timezone-control')
  const onSurfaceSelect = findRole(onSurface, 'timezone')
  const onSurfaceCaption = findRole(onSurface, 'timezone-caption')
  assert.ok(onSurfaceCaption, 'the sheet has an element to key its caption rule on')
  assert.deepEqual(Object.keys(onSurfaceSelect.style), [])
  assert.deepEqual(Object.keys(onSurfaceCaption.style), [])
})

test('the timezone control defers placement styles only on the booking surface', async () => {
  const onSurface = await mountFooterFixture()
  const control = onSurface.shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'timezone-control')
  assert.ok(control)
  assert.deepEqual(Object.keys(control.style), [], 'the sheet owns its placement here')

  const reschedule = new CalendarElement('dialog')
  reschedule.setAttribute('data-modal-target', 'popup-booking-info')
  const host = new CalendarElement('div')
  host.setAttribute('booking-reschedule-calendar', '')
  reschedule.appendChild(host)
  const away = await mountFooterFixture({ container: host })
  const awayControl = away.shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'timezone-control')
  assert.ok(awayControl)
  assert.deepEqual(
    Object.keys(awayControl.style),
    ['display', 'gap', 'justifySelf', 'width'],
    'the dashboard keeps its inline control placement',
  )
  assert.equal(awayControl.style.width, 'min(100%, 320px)')
})

test('the timezone selector cannot come back inside the scrolling list', async () => {
  // It is a sibling of the times, not a child, and the placement keeps it
  // that way: the chips scroll under a caption that stays put, which is what a
  // label for the whole list wants. A `grid-area:times` here would put it in
  // the scroll box and send it off the top on the first wheel.
  const { document, shell } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const role = (name) => shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === name)
  const control = role('timezone-control')
  assert.ok(control, 'the engine renders the selector')
  // The DOM groups it under the month, which is what gives the dashboard its
  // left column. That wrapper is collapsed with `display:contents` here, so
  // what the sheet places is a shell grid item beside the times.
  assert.equal(control.parentElement, role('calendar-panel'))
  assert.ok(
    !role('times').querySelectorAll('[data-paid-calendar-element]').includes(control),
    'a sibling of the times, never a child',
  )
  for (const rule of css.split('}')) {
    if (!rule.includes('"timezone-control"]')) continue
    assert.ok(!/grid-area:times\b/.test(rule), rule)
  }
})

test('the day chips fill their cell, scoped so other date pickers do not', async () => {
  // Jerico made this edit on the page's GLOBAL datepicker sheet. Shipped
  // globally it would resize the contract form's date fields too, so it is
  // re-scoped here. The page's own rule and its mobile 2.5rem override are both
  // (0,1,2); under the dialog attribute this is (0,2,2) and wins at both widths
  // without `!important`.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const D = '[data-modal-target="popup-booking"]'
  assert.ok(css.includes(D + ' .ui-datepicker td a,' + D + ' .ui-datepicker td span{width:100%}'))
  // Height is left to the page — only the width was his edit.
  assert.ok(!/td a,[^{]*td span\{[^}]*height/.test(css))
})

test('the status line hides only when it has nothing to say', async () => {
  // Jerico set a blanket `display:none` inline on it. The same element carries
  // "No available times were found in the next 14 days.", the sending state and
  // every booking error, so a blanket rule would silence all of them. `:empty`
  // is the case he was actually looking at.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  assert.ok(css.includes('[data-paid-calendar-element="status"]:empty{display:none}'))
  assert.ok(!/"status"\]\{[^}]*display:none/.test(css), 'never a blanket hide')
  // `:empty` has to come out ahead of the base banner rule, and it does it on
  // specificity rather than with `!important` — which the containment test
  // forbids anyway.
  const base = css.split('"status"]{')[1].split('}')[0]
  assert.ok(base.includes('position:absolute'), 'the base rule is the banner one')
})

test('the status is a banner across the top of the modal body', async () => {
  // Jerico's round 3, and a change of kind: the status stops being a line
  // under the buttons and becomes a band over the top of the panel. Replaying
  // his capture verbatim already lands it there — the static position of an
  // absolutely positioned grid child is the grid container's content origin —
  // so the offsets here only straighten what that leaves ragged. His band is
  // 100% of a container it is not aligned to, which insets it 32px on the left
  // and overhangs the right edge by the same 32px.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const D = '[data-modal-target="popup-booking"]'
  const ROLE = D + ' [data-paid-calendar-element='

  assert.ok(css.includes(
    ROLE + '"status"]{position:absolute;top:0;left:0;right:0;z-index:2;'
      + 'margin:0;padding:1rem;font-size:0.8125rem;background:#434B43;color:#fff}',
  ))
  // The modal's BODY is the containing block, so the band lands under the
  // header bar and runs the panel's full width. `.modal_content` would put it
  // over the header; the mount would inset it by the authored step's 2.5rem.
  assert.ok(css.includes(D + ' .modal_content-layout{position:relative}'))
  assert.ok(!css.includes('.modal_content{position:relative}'))
  // Every one of those rules is inside the dialog scope, which is what keeps a
  // `position:relative` off the dashboard's own modal body.
  assert.ok(css.includes(D + ' .modal_content-layout'))
})

test('only a failed booking wears the red banner', async () => {
  // His capture is `#DD5555` taken on the booking-failed state. The element
  // carries two other strings — the empty-availability notice and "Sending
  // your request..." — and neither is a failure, so they take the dark olive
  // notification fill rather than an alarm colour. Jerico picked that pair in
  // round 4, after `#eee` on `#1f211d` read as a panel at banner size.
  const { document } = await mountFooterFixture()
  const css = document.head.children[0].textContent
  const ROLE = '[data-modal-target="popup-booking"] [data-paid-calendar-element='

  assert.ok(css.includes(
    ROLE + '"status"][data-paid-calendar-status="error"]{background:#DD5555;color:#fff}',
  ))
  // Both neutral messages share one rule, so they cannot drift apart: the tone
  // attribute only ever selects the red away from this default.
  assert.ok(!/status="progress"/.test(css))
  assert.ok(!/status="empty"/.test(css))
  // Red is reachable ONLY through the error tone. A red in the base rule would
  // paint the progress notice as a failure.
  for (const rule of css.split('}')) {
    if (!/DD5555/i.test(rule)) continue
    assert.ok(rule.includes('[data-paid-calendar-status="error"]'), rule)
  }
})

test('each status message is tagged with the tone that colours it', async () => {
  // The tone is the only thing telling the three strings apart, so every write
  // site has to set it and every clear has to drop it.
  const failing = await mountFooterFixture({
    onConfirm: async () => { throw new Error('booking refused') },
  })
  const times = failing.shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'times')

  assert.equal(failing.status.textContent, '')
  assert.equal(failing.status.getAttribute('data-paid-calendar-status'), null)

  times.children[0].listeners.click()
  assert.equal(failing.status.getAttribute('data-paid-calendar-status'), null, 'still nothing to say')

  await failing.confirmParts.button.listeners.click()
  assert.equal(failing.status.textContent, 'We could not book this call. Please try again.')
  assert.equal(failing.status.getAttribute('data-paid-calendar-status'), 'error')

  // Picking another slot clears the failure, tone and all — a stale red band
  // over a fresh selection would be the modal contradicting itself.
  times.children[0].listeners.click()
  assert.equal(failing.status.textContent, '')
  assert.equal(failing.status.getAttribute('data-paid-calendar-status'), null)

  // In flight, and not red: this one is a progress notice.
  let release
  const pending = await mountFooterFixture({
    onConfirm: () => new Promise((resolve) => { release = resolve }),
  })
  const pendingTimes = pending.shell.querySelectorAll('[data-paid-calendar-element]')
    .find((child) => child.getAttribute('data-paid-calendar-element') === 'times')
  pendingTimes.children[0].listeners.click()
  const inFlight = pending.confirmParts.button.listeners.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(pending.status.textContent, 'Sending your request...')
  assert.equal(pending.status.getAttribute('data-paid-calendar-status'), 'progress')
  release()
  await inFlight

  // And the empty-availability notice, which is not a failure either.
  const empty = await mountFooterFixture({ slots: [] })
  assert.equal(empty.status.textContent, 'No available times were found in the next 14 days.')
  assert.equal(empty.status.getAttribute('data-paid-calendar-status'), 'empty')
})

test('the banner leaves the status with no inline styles to outrank the sheet', async () => {
  // An inline declaration beats any rule in the injected sheet whatever its
  // specificity, so the grey line this element used to be written as would
  // have quietly won the banner's own colour back.
  const { status } = await mountFooterFixture()
  assert.deepEqual(Object.keys(status.style), [])

  // Off the booking surface there is no sheet, so the inline look is the only
  // look there is and it stays exactly as it shipped — tone attribute included,
  // which that surface has nothing to read.
  const reschedule = new CalendarElement('dialog')
  reschedule.setAttribute('data-modal-target', 'popup-booking-info')
  const host = new CalendarElement('div')
  host.setAttribute('booking-reschedule-calendar', '')
  reschedule.appendChild(host)
  const away = await mountFooterFixture({ container: host, slots: [] })
  assert.equal(away.status.style.color, '#6f746d')
  assert.equal(away.status.style.fontSize, '13px')
  assert.equal(away.status.style.margin, '0')
  assert.equal(away.status.textContent, 'No available times were found in the next 14 days.')
  assert.equal(away.status.getAttribute('data-paid-calendar-status'), null)
})

test('the empty state holds itself open under the banner', async () => {
  // Jerico's own min-height and his own reason: with the banner out of flow
  // the empty-availability panel has only a button left to set its height, so
  // it would collapse to that and the banner would cover it. The mount then
  // has to push what it does have to the BOTTOM, or the footer sits under the
  // band at exactly the width where the message wraps.
  const { document } = await mountFooterFixture({ slots: [] })
  const css = document.head.children[0].textContent
  const D = '[data-modal-target="popup-booking"]'

  assert.ok(css.includes(
    D + ' [nylas-container][data-paid-calendar-state="ready"],'
      + D + ' [nylas-container][data-paid-calendar-state="empty"],'
      + D + ' [nylas-container][data-paid-calendar-state="loading"],'
      + D + ' [nylas-container][data-paid-calendar-state="error"]{min-height:20rem}',
  ))
  // Still keyed on the state attribute rather than applied to the bare mount.
  // An unconditional rule would reach the mount before it has a state at all —
  // including the reset path, which strips the attribute outright.
  assert.ok(!/\[nylas-container\]\{min-height/.test(css))
  assert.ok(css.includes(
    D + ' [nylas-container][data-paid-calendar-state="empty"]'
      + '{display:flex;flex-direction:column;justify-content:flex-end}',
  ))
  // Both live outside the media queries: the empty state can be reached at
  // either width and collapses at both.
  const beforeMedia = css.split('@media')[0]
  assert.ok(beforeMedia.includes('min-height:20rem'))
  assert.ok(beforeMedia.includes('justify-content:flex-end'))
})

test('the loading and error states get a frame instead of a bare strip', async () => {
  // The two pre-mount states have no shell and no footer, so nothing inside
  // them carries the interior frame the calendar states pad themselves with —
  // and the step wrapper they used to inherit the authored 32px from is zeroed
  // by this same sheet. Measured on the real page before this rule: the mount
  // was 21px tall with 0 padding on every open after the first, so the dialog
  // opened as a ~72px strip with the sentence flush against its edges.
  const { document } = await mountFooterFixture({ slots: [] })
  const css = document.head.children[0].textContent
  const D = '[data-modal-target="popup-booking"]'

  assert.ok(css.includes(
    D + ' [nylas-container][data-paid-calendar-state="loading"],'
      + D + ' [nylas-container][data-paid-calendar-state="error"]'
      + '{padding:1.25rem;display:flex;flex-direction:column;'
      + 'justify-content:center;align-items:center;text-align:center}',
  ))
  // The same CALENDAR_FRAME the month, the times and the footer pad with, so
  // the waiting panel is inset by the amount the calendar state settles into
  // rather than by a value of its own.
  assert.match(css, /data-paid-calendar-state="error"\]\{padding:1\.25rem/)

  // Centred on the block axis, which is what makes the restored floor read as
  // a panel waiting rather than as the void under one sentence that got the
  // floor taken away in the first place.
  assert.ok(/state="error"\]\{[^}]*justify-content:center/.test(css))
  // And NOT the empty state's bottom alignment, which exists to keep that
  // state's footer out from under the banner. These two states have no footer.
  assert.ok(!/state="error"\]\{[^}]*flex-end/.test(css))

  // Outside the media queries: both states are reachable at either width.
  const beforeMedia = css.split('@media')[0]
  assert.ok(beforeMedia.includes('data-paid-calendar-state="loading"]'))
  assert.ok(beforeMedia.includes('justify-content:center'))

  // The frame is keyed on the mount's own state, never on the step wrapper the
  // sheet deliberately zeroes — restoring padding there would put it back on
  // all four `.call-details_layout` steps in the dialog.
  assert.ok(css.includes(D + ' [data-paid-calendar-step]{padding:0;overflow:visible}'))

  // No `!important` anywhere, as the rest of this sheet promises.
  assert.ok(!css.includes('!important'))
})

test('a second mount reuses the stylesheet rather than stacking copies', async () => {
  const container = bookingMount()
  const first = await mountFooterFixture({ container })
  assert.equal(first.document.head.children.length, 1)
  // Each mount gets a fresh document stub, so re-running the injector against
  // the SAME document is what has to be proven inert.
  api.ensureBookingCalendarLayout(first.document)
  api.ensureBookingCalendarLayout(first.document)
  assert.equal(first.document.head.children.length, 1)
})

test('the layout injector is inert on a document that cannot host it', async () => {
  // The dashboard controller and the unit fixtures both mount against reduced
  // documents. A throw here would take the whole calendar down with it.
  assert.doesNotThrow(() => api.ensureBookingCalendarLayout(undefined))
  assert.doesNotThrow(() => api.ensureBookingCalendarLayout({}))
  assert.doesNotThrow(() => api.ensureBookingCalendarLayout({
    createElement() { return new CalendarElement('style') },
    getElementById() { return null },
  }))
})

test('back is disabled while a booking request is in flight', async () => {
  // Back closes the dialog. Live during the request, one stray click wipes the
  // surface the confirmation was about to land on while the booking still goes
  // through server-side — a call the visitor never sees. The disable lands on
  // the inner button, which is the element that actually takes the click.
  let release
  const { footer, confirm, backParts, confirmParts } = await mountFooterFixture({
    onConfirm: () => new Promise((resolve) => { release = resolve }),
  })
  const slot = footer.parentElement.querySelectorAll('[data-paid-calendar-slot]')[0]

  slot.listeners.click()
  assert.equal(confirmParts.button.disabled, false)
  assert.equal(backParts.button.disabled, false)

  const pending = confirmParts.button.listeners.click()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(confirmParts.button.disabled, true)
  assert.equal(confirm.getAttribute('data-button-theme'), 'disabled')
  assert.equal(backParts.button.disabled, true, 'back must not close the dialog mid-request')

  release()
  await pending
  assert.equal(backParts.button.disabled, false, 'and it has to come back after the request')
  // The slot is still selected, so the confirm returns to live in both halves.
  assert.equal(confirmParts.button.disabled, false)
  assert.equal(confirm.getAttribute('data-button-theme'), 'black')
})

test('a synthesized booking close never lands on the rendered back control', async () => {
  // The back control is now built by this engine rather than authored, so the
  // close selector's `:not([data-booking-back])` is load-bearing on every page
  // the calendar mounts on, not only where Jerico happens to author one.
  const { footer, back, confirm } = await mountFooterFixture()
  const selector = bookingCloseSelector()
  const realCloser = { attrs: { 'data-modal-close': '', 'booking-popup-close': '' } }

  assert.equal(firstCloseMatch(selector, [back, realCloser]), realCloser)
  assert.equal(firstCloseMatch(selector, [back]), null)
  assert.equal(firstCloseMatch(selector, footer.children), null)
  assert.equal(firstCloseMatch(selector, [confirm]), null)
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
  global.document = calendarDocument()
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
  assert.equal(api.canonicalPaidPrice({ currency: 'USD', price_cents: 1200 }), '$12')
  assert.equal(api.canonicalPaidPrice({ currency: 'USD', price_cents: 100000 }), '$1000')
  assert.equal(api.canonicalPaidPrice({ currency: 'USD', price_cents: 100100 }), '')
  assert.equal(api.canonicalPaidPrice({ currency: 'USD', price_cents: 1250 }), '')
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
    for (const priceCents of [1250, 100100, 250000]) {
      assert.equal(api.installPaidBookingController({
        config: {
          config_id: 'config_paid',
          grant_id: 'grant_test',
          duration: 60,
          is_paid: true,
          currency: 'usd',
          price_cents: priceCents,
        },
      }), false, `${priceCents} must not install a paid booking controller`)
    }
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
  function paymentAction(action, text) {
    return {
      attrs: { 'booking-pm-action': action, 'data-unique-id': 'legacy-booking-id' },
      style: {},
      textContent: text,
      listeners: [],
      classList: { remove() {} },
      getAttribute(name) { return this.attrs[name] || null },
      setAttribute(name, value) { this.attrs[name] = String(value) },
      removeAttribute(name) { delete this.attrs[name] },
      addEventListener(name, listener, options) {
        this.listeners.push({ name, listener, capture: options === true })
      },
    }
  }
  const changePayment = paymentAction('change', 'Change payment method')
  const confirmPayment = paymentAction('confirm', 'Confirm payment method')
  let closeClicks = 0
  const popupClose = { attrs: { 'data-modal-close': '' }, click() { closeClicks += 1 } }
  // Ordered exactly as the DOM would be, and matched by the real selector the
  // controller uses, so this stops being a string the fixture has to be kept in
  // step with by hand.
  const popupCloseCandidates = [popupClose]
  const successCallType = { textContent: 'Free Call' }
  const paidText = {
    attrs: { 'aria-hidden': 'true' },
    style: { display: 'none' },
    textContent: 'Your card ending in 1234 will be charged for this call.',
    getAttribute(name) { return this.attrs[name] || null },
    setAttribute(name, value) { this.attrs[name] = String(value) },
  }
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
      const close = firstCloseMatch(selector, popupCloseCandidates)
      if (close) return close
      return guestQuery(guestUi, selector)
    },
    querySelectorAll(selector) {
      const guestNodes = guestQueryAll(guestUi, selector)
      if (guestNodes.length) return guestNodes
      if (selector === '[schedule-step]') return steps
      if (selector === '[success-call-buttons]') return [freeButtons, paidButtons]
      if (selector === '[success-call-buttons][data-type="paid"] [booking-pm-action]') {
        return [changePayment, confirmPayment]
      }
      if (selector === '[schedule-step="success"] [booking-element="paid-meeting"]') return [successCallType]
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
    assert.equal(paidText.textContent, 'Your saved payment method will be used for this call.')
    assert.equal(paidText.style.display, '')
    assert.equal(paidText.getAttribute('aria-hidden'), 'false')
    assert.equal(changePayment.style.display, 'none')
    assert.equal(changePayment.getAttribute('aria-hidden'), 'true')
    assert.equal(confirmPayment.textContent, 'Close')
    assert.equal(confirmPayment.getAttribute('data-unique-id'), null)
    assert.equal(confirmPayment.getAttribute('data-paid-call-success-action'), 'close')
    const closeBinding = confirmPayment.listeners.find(function (listener) {
      return listener.name === 'click' && listener.capture
    })
    assert.ok(closeBinding)
    let stopped = false
    closeBinding.listener({
      preventDefault() {},
      stopImmediatePropagation() { stopped = true },
    })
    assert.equal(stopped, true)
    assert.equal(closeClicks, 1)
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
    // Closing means the whole close: the embed fades the dialog out and only
    // then reports close-complete, which is what resets the surface.
    ;(modalClose.listeners.click ? [modalClose.listeners.click] : []).forEach(function (listener) { listener() })
    dispatchModal('modal-close', popup)
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
        bookable: readinessCount >= 2,
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
        price_cents: 1200,
      },
      starterSlug: 'jp-testiz-d',
      mountCalendar(options) {
        calendarOptions = options
        return Promise.resolve({ slots: [] })
      },
    }), true)
    assert.equal(priceText.textContent, '$12')
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

function makePaidLifecycleFixture(fetch, fixtureOptions = {}) {
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
      clickCount: 0,
      disabled: false,
      listeners,
      addEventListener(name, listener) {
        if (!listeners[name]) listeners[name] = []
        listeners[name].push(listener)
      },
      click() {
        this.clickCount += 1
        ;(listeners.click || []).forEach(function (listener) {
          listener({ preventDefault() {}, stopImmediatePropagation() {} })
        })
      },
    }
  }
  // The authored dialog carries several closers — the X, one or more "Close"
  // buttons, and the backdrop — and every one of them must behave the same.
  const closeControls = [control(), control(), control()]
    .slice(0, Math.max(1, fixtureOptions.closers || 1))
  const mainClose = closeControls[0]
  const paymentClose = control()
  // The authored page puts `popup-stripe-card-close` on three elements: the
  // card dialog's X and backdrop, and — this is the cross-dialog trap — the
  // booking dialog's backdrop, which is also one of the booking closers.
  const paymentBackdrop = control()
  const bookingBackdrop = control()
  const save = control()
  const cardMount = { setAttribute() {} }
  const errorText = { textContent: '', setAttribute() {} }
  const statusText = { textContent: '', setAttribute() {} }
  const paymentModalListeners = {}
  // `nestedPaymentMarker` models a Designer re-nest: the `popup-stripe-card`
  // marker sits on a child of the dialog, so the dialog's own backdrop is a
  // sibling of the marker and only the owning `[data-modal-target]` can reach it.
  const nestedMarker = fixtureOptions.nestedPaymentMarker === true
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
    closest(selector) {
      if (selector !== '[data-modal-target]') return null
      return nestedMarker ? paymentDialog : paymentModal
    },
    querySelector() { return null },
    querySelectorAll(selector) {
      if (selector === '[data-modal-close], [popup-stripe-card-close]') {
        return nestedMarker ? [paymentClose] : [paymentClose, paymentBackdrop]
      }
      return []
    },
    setAttribute() {},
  }
  const paymentDialog = {
    querySelectorAll(selector) {
      return selector === '[data-modal-close], [popup-stripe-card-close]'
        ? [paymentClose, paymentBackdrop]
        : []
    },
  }
  const topic = { value: '' }
  const context = { value: '' }
  const paidText = { textContent: 'Choose a time for your paid call.' }
  const popup = {
    querySelector(selector) {
      if (selector === '[nylas-container]') return container
      if (selector === '[name="topic"], [booking-topic]') return topic
      if (selector === '[name="context"], [booking-context]') return context
      if (selector === '[paid-call-text]') return paidText
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-modal-close], [booking-popup-close], [popup-booking-close]') {
        return closeControls.concat([bookingBackdrop])
      }
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
      // The booking dialog is authored before the card dialog, so a global
      // attribute lookup finds this unrelated backdrop first.
      if (selector === '[popup-stripe-card-close]') return bookingBackdrop
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('data-type="paid"')) return [paid]
      // What the unscoped selector really matched on the authored page: both of
      // the card dialog's closers *and* the booking dialog's backdrop.
      if (selector === '[popup-stripe-card] [data-modal-close], [popup-stripe-card-close]') {
        return [paymentClose, paymentBackdrop, bookingBackdrop]
      }
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
  const install = fixtureOptions.install || api.installPaidBookingController
  install({
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
      if (fixtureOptions.mountCalendar) return fixtureOptions.mountCalendar(options, state)
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
    /**
     * A whole close, in the order the embed performs one: the closer's own
     * click handling first, then close-complete once the 300ms fade has ended.
     */
    closeThroughFade(closer) {
      ;(closer || mainClose).click()
      dispatchModal('modal-close', popup)
    },
    bookingBackdrop,
    closeControls,
    container,
    context,
    getCardConfirmations: () => cardConfirmations,
    getCardCreates: () => cardCreates,
    getOpenCount: () => openCount,
    getSaveBindings: () => saveBindings,
    mainClose,
    paid,
    paidText,
    popup,
    paymentBackdrop,
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
      return response({ environment: 'test', bookable: readinessCount >= 2 })
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

test('selected-slot readiness controls card setup without a second read', async () => {
  let readinessCount = 0
  const fixture = makePaidLifecycleFixture(async (url) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      return response({ environment: 'test', bookable: readinessCount > 1 })
    }
    throw new Error('Unexpected request: ' + url)
  })
  try {
    await fixture.paid.onclick({ preventDefault() {} })
    await fixture.calendars[0].options.onConfirm({
      start: 1787000000000,
      end: 1787003600000,
      timezone: 'UTC',
    })
    assert.equal(readinessCount, 1)
    assert.equal(fixture.getCardCreates(), 1)
    assert.equal(fixture.getOpenCount(), 1)
  } finally {
    fixture.restore()
  }
})

test('main modal reset restores authored Paid copy after calendar failure', async () => {
  let mountCount = 0
  const fixture = makePaidLifecycleFixture(async (url) => {
    throw new Error('Unexpected request: ' + url)
  }, {
    mountCalendar() {
      mountCount += 1
      if (mountCount === 1) return Promise.reject(new Error('calendar unavailable'))
      return Promise.resolve({ slots: [] })
    },
  })
  try {
    await fixture.paid.onclick({ preventDefault() {} })
    assert.equal(fixture.paidText.textContent, 'We could not book this call. Please try again.')
    fixture.closeThroughFade()
    assert.equal(fixture.paidText.textContent, 'Choose a time for your paid call.')
    await fixture.paid.onclick({ preventDefault() {} })
    assert.equal(fixture.paidText.textContent, 'Choose a time for your paid call.')
    assert.equal(mountCount, 2)
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
    fixture.closeThroughFade()
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
  let resolveFirstReadiness
  const fixture = makePaidLifecycleFixture(async (url) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      if (readinessCount === 1) {
        return new Promise((resolve) => {
          resolveFirstReadiness = () => resolve(response({ environment: 'test', bookable: false }))
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
    fixture.closeThroughFade()
    await fixture.paid.onclick({ preventDefault() {} })
    const second = fixture.calendars[1].options.onConfirm(slot)
    await second
    resolveFirstReadiness()
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
      return response({ environment: 'test', bookable: readinessCount >= 2 })
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
      return response({ environment: 'test', bookable: readinessCount >= 3 })
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

// --------------------------------------------------------------------------
// Reset-after-fade: the booking surface must survive the close animation.
//
// The modal embed keeps the dialog on screen for a 300ms fade-out and only
// then dispatches `modal-close`. Resetting any earlier repaints a dialog the
// visitor can still see — a success screen snapping back to "Book a Call"
// before it disappears.
// --------------------------------------------------------------------------

/**
 * A transcription of the lifecycle singleton shipped before this change: it
 * resets on a close control's click and on the dialog's `cancel` as well as on
 * close-complete. Used to stand in for an older generation that already claimed
 * the first-installer-wins window slot.
 */
function oldGenerationLifecycle(scope) {
  const generations = new WeakMap()
  const ownership = {
    claim: function (container) {
      const generation = (generations.get(container) || 0) + 1
      generations.set(container, generation)
      return generation
    },
    owns: function (container, generation) {
      return generations.get(container) === generation
    },
  }
  const bindings = new WeakMap()
  const lifecycle = {
    register: function (popup, container, onReset) {
      let binding = bindings.get(popup)
      if (!binding) {
        binding = { container, resets: new Set() }
        bindings.set(popup, binding)
        popup.querySelectorAll(
          '[data-modal-close], [booking-popup-close], [popup-booking-close]',
        ).forEach(function (control) {
          control.addEventListener('click', function () { lifecycle.reset(popup) })
        })
        if (typeof popup.addEventListener === 'function') {
          popup.addEventListener('cancel', function () { lifecycle.reset(popup) })
        }
        scope.addEventListener('modal-close', function (event) {
          const modal = event && event.detail && event.detail.modal
          if (modal === popup) lifecycle.reset(popup)
        })
      }
      if (binding.container !== container) return false
      binding.resets.add(onReset)
      return true
    },
    reset: function (popup, nextType) {
      const binding = bindings.get(popup)
      if (!binding) return 0
      const generation = ownership.claim(binding.container)
      binding.resets.forEach(function (reset) { reset(generation, nextType || '') })
      return generation
    },
    runBooking: function (container, fingerprint, createAttempt) {
      return createAttempt().run()
    },
  }
  return { lifecycle, ownership }
}

/**
 * A second, isolated copy of the controller, loaded against its own window so a
 * pre-installed lifecycle singleton can be planted before module scope runs.
 * The document and Stripe stubs are read through getters so the copy sees
 * exactly what makePaidLifecycleFixture installs on the shared globals.
 */
function loadIsolated(events) {
  const window = {
    location: { hostname: 'www.thestarters.com' },
    get document() { return global.document },
    get Stripe() { return global.Stripe },
    get xanoAuthFetch() { return global.xanoAuthFetch },
    addEventListener: (name, listener) => events.addEventListener(name, listener),
    removeEventListener: (name, listener) => events.removeEventListener(name, listener),
  }
  return window
}

function runIsolated(window) {
  vm.runInNewContext(SOURCE, {
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    globalThis: window,
    window,
  })
  return window.StartersPaidCallBrandPayment
}

async function advancedPaidFixture(options = {}) {
  const fixture = makePaidLifecycleFixture(async (url) => {
    if (url.endsWith(api.READINESS_PATH)) return response({ environment: 'test', bookable: true })
    if (url.endsWith(api.BOOKING_PATH)) {
      return response({ booking: { booking_id: 'confirmed', row_id: 77 } })
    }
    throw new Error('Unexpected request: ' + url)
  }, options)
  await fixture.paid.onclick({ preventDefault() {} })
  fixture.topic.value = 'Growth audit'
  fixture.context.value = 'Review the launch plan'
  fixture.container.textContent = 'Calendar'
  fixture.steps[0].style.display = 'none'
  fixture.steps[1].style.display = 'flex'
  return fixture
}

test('the close click leaves the Paid step untouched until the fade ends', async () => {
  const fixture = await advancedPaidFixture({ closers: 3 })
  try {
    // Trap. On the click-bound generation these listeners existed and wiped the
    // surface right here, while the dialog was still fully opaque.
    fixture.closeControls.forEach(function (control) { control.click() })

    assert.deepEqual(
      fixture.closeControls.map((control) => (control.listeners.click || []).length),
      fixture.closeControls.map(() => 0),
      'no closer may carry a reset listener — that is the mid-fade repaint',
    )
    assert.equal(fixture.steps[1].style.display, 'flex')
    assert.equal(fixture.steps[0].style.display, 'none')
    assert.equal(fixture.container.textContent, 'Calendar')
    assert.equal(fixture.topic.value, 'Growth audit')

    dispatchModal('modal-close', fixture.popup)

    assert.equal(fixture.steps[1].style.display, 'none')
    assert.equal(fixture.steps[0].style.display, 'flex')
    assert.equal(fixture.container.textContent, '')
    assert.equal(fixture.topic.value, '')
    assert.equal(fixture.context.value, '')
  } finally {
    fixture.restore()
  }
})

test('every Paid closer resets the booking surface exactly once', async () => {
  const fixture = await advancedPaidFixture({ closers: 3 })
  try {
    const counted = resetCounter(fixture.container)
    fixture.closeControls.forEach(function (control, index) {
      dispatchModal('modal-open', fixture.popup)
      fixture.closeThroughFade(control)
      assert.equal(counted(), 1, `closer ${index} must reset exactly once`)
    })

    // A duplicate close-complete for the same close cycle must not reset again.
    dispatchModal('modal-close', fixture.popup)
    assert.equal(counted(), 0)

    // Reopening re-arms it.
    dispatchModal('modal-open', fixture.popup)
    dispatchModal('modal-close', fixture.popup)
    assert.equal(counted(), 1)
  } finally {
    fixture.restore()
  }
})

test('closing the Stripe card dialog does not reset the booking surface', async () => {
  const fixture = await advancedPaidFixture()
  try {
    const counted = resetCounter(fixture.container)
    fixture.paymentModal.cancel()
    dispatchModal('modal-close', { hasAttribute: (name) => name === 'popup-stripe-card' })

    assert.equal(counted(), 0)
    assert.equal(fixture.steps[1].style.display, 'flex')
    assert.equal(fixture.container.textContent, 'Calendar')
  } finally {
    fixture.restore()
  }
})

test('reopening the Paid surface after a close starts from a fresh default step', async () => {
  const fixture = await advancedPaidFixture()
  try {
    fixture.closeThroughFade()
    assert.equal(fixture.steps[0].style.display, 'flex')
    assert.equal(fixture.steps[1].style.display, 'none')
    assert.equal(fixture.container.textContent, '')

    dispatchModal('modal-open', fixture.popup)
    await fixture.paid.onclick({ preventDefault() {} })
    assert.equal(fixture.container.textContent, 'Loading available times...')
    assert.equal(fixture.steps[0].style.display, 'flex')
    assert.equal(fixture.calendars.length, 2)

    fixture.steps[1].style.display = 'flex'
    fixture.closeThroughFade()
    assert.equal(fixture.steps[0].style.display, 'flex')
    assert.equal(fixture.steps[1].style.display, 'none')
  } finally {
    fixture.restore()
  }
})

test('this generation marks the Paid singleton it installs as close-complete', async () => {
  const fixture = await advancedPaidFixture({ closers: 3 })
  try {
    const lifecycle = global.StartersBookingSurfaceLifecycle
    assert.equal(lifecycle.resetTiming, 'close-complete')

    // An older controller adopting this singleton gets the fixed timing for
    // free: all of its close wiring lives inside register(), which no longer
    // binds clicks, so its reset also waits for the fade.
    let adopted = 0
    assert.equal(
      lifecycle.register(fixture.popup, fixture.container, function () { adopted += 1 }),
      true,
    )
    fixture.closeControls.forEach(function (control) { control.click() })
    assert.equal(adopted, 0)
    dispatchModal('modal-close', fixture.popup)
    assert.equal(adopted, 1)
  } finally {
    fixture.restore()
  }
})

test('an older Paid singleton already installed is adopted with no extra close wiring', async () => {
  const events = new EventTarget()
  const window = loadIsolated(events)
  const old = oldGenerationLifecycle(window)
  window.StartersBookingSurfaceLifecycle = old.lifecycle
  window.StartersBookingSurfaceOwnership = old.ownership
  const isolated = runIsolated(window)

  const fixture = await advancedPaidFixture({
    closers: 3,
    install: isolated.installPaidBookingController,
  })
  try {
    // The singleton is adopted, not replaced, and it still carries no
    // capability mark. Nothing gates on that absence: adoption is
    // unconditional by design. Asserting it here documents which generation
    // this fixture is standing in.
    assert.equal(window.StartersBookingSurfaceLifecycle, old.lifecycle)
    assert.equal(old.lifecycle.resetTiming, undefined)

    // Differential: a popup with no controller on it, registered against the
    // same old singleton, resets exactly as often as the one this controller
    // registered against. Equal counts mean the new code contributed no close
    // wiring of its own.
    // Same shape as the fixture's popup — same closer count, same lack of a
    // `cancel` binding — so the only difference between the two is whether a
    // controller registered against it.
    const controlControls = fixture.closeControls.map(() => ({
      listeners: {},
      addEventListener(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn) },
      click() { (this.listeners.click || []).forEach((fn) => fn({ preventDefault() {} })) },
    }))
    const controlContainer = new CalendarElement('div')
    const controlPopup = {
      querySelector() { return null },
      querySelectorAll(selector) {
        return selector === '[data-modal-close], [booking-popup-close], [popup-booking-close]'
          ? controlControls
          : []
      },
    }

    let adopted = 0
    let control = 0
    old.lifecycle.register(fixture.popup, fixture.container, function () { adopted += 1 })
    old.lifecycle.register(controlPopup, controlContainer, function () { control += 1 })

    function driveClose(popup, controls) {
      controls.forEach(function (item) { item.click() })
      events.dispatchEvent(new CustomEvent('modal-close', { detail: { modal: popup } }))
    }
    driveClose(fixture.popup, fixture.closeControls)
    driveClose(controlPopup, controlControls)

    assert.ok(control >= 1, 'the old generation must still reset — no missed reset')
    assert.equal(adopted, control, 'adopting the old singleton must not add a second reset')
    assert.equal(fixture.steps[0].style.display, 'flex')
  } finally {
    fixture.restore()
  }
})

// --------------------------------------------------------------------------
// Payment-cancel scoping: only the card dialog's own dismissal cancels setup.
//
// `popup-stripe-card-close` is authored on the booking dialog's backdrop as
// well as on the card dialog's X and backdrop, so an unscoped attribute match
// let a backdrop dismissal of the booking modal cancel a visitor's in-progress
// card setup. Containment decides now, not the marker on its own.
//
// --------------------------------------------------------------------------

const SCOPING_SLOT = { start: 1787000000000, end: 1787003600000, timezone: 'UTC' }

/**
 * A Paid surface parked exactly where the payment matters: a slot confirmed, a
 * card setup opened and pending, nothing booked yet. Cancelling here drops the
 * slot; leaving it alone lets the card save go on to book.
 */
function makeCardSetupFixture(options = {}) {
  let readinessCount = 0
  const counts = { booking: 0 }
  const fixture = makePaidLifecycleFixture(async (url) => {
    if (url.endsWith(api.READINESS_PATH)) {
      readinessCount += 1
      return response({ environment: 'test', bookable: readinessCount >= 2 })
    }
    if (url.endsWith(api.SETUP_PATH)) return response({ client_secret: 'seti_scope' })
    if (url.endsWith(api.SET_DEFAULT_PATH)) return response({ readiness: 'ready' })
    if (url.endsWith(api.BOOKING_PATH)) {
      counts.booking += 1
      return response({ booking: { booking_id: 'scoped', row_id: 5 } })
    }
    throw new Error('Unexpected request: ' + url)
  }, options)
  return { counts, fixture }
}

async function openCardSetup(fixture) {
  await fixture.paid.onclick({ preventDefault() {} })
  await fixture.calendars[0].options.onConfirm(SCOPING_SLOT)
  assert.equal(fixture.getOpenCount(), 1)
  assert.equal(fixture.calendars[0].clearCount, 0)
}

async function saveCard(fixture) {
  fixture.cardListeners.change({ complete: true })
  await fixture.save.listeners.click[0]({ preventDefault() {}, stopImmediatePropagation() {} })
}

test('saving a card closes its dialog without clicking the earlier booking backdrop', async () => {
  const { counts, fixture } = makeCardSetupFixture()
  try {
    await openCardSetup(fixture)
    await saveCard(fixture)

    assert.equal(counts.booking, 1)
    assert.equal(fixture.paymentClose.clickCount, 1, 'the card dialog must close after booking')
    assert.equal(fixture.bookingBackdrop.clickCount, 0, 'the booking dialog must remain on success')
    assert.equal(fixture.steps[1].style.display, 'flex', 'the paid-call success step must remain visible')
  } finally {
    fixture.restore()
  }
})

test('dismissing the booking dialog by its backdrop leaves the card setup intact', async () => {
  const { counts, fixture } = makeCardSetupFixture()
  try {
    await openCardSetup(fixture)

    // Trap. The booking dialog's backdrop carries `popup-stripe-card-close`,
    // so the unscoped match bound the payment cancel to it.
    assert.equal(
      (fixture.bookingBackdrop.listeners.click || []).length,
      0,
      'a booking closer must carry no payment-cancel listener',
    )

    fixture.bookingBackdrop.click()
    assert.equal(
      fixture.calendars[0].clearCount,
      0,
      'the booking backdrop must not clear the selected slot',
    )

    await saveCard(fixture)
    assert.equal(counts.booking, 1, 'the pending slot must survive a booking-dialog dismissal')
  } finally {
    fixture.restore()
  }
})

test('every Stripe card dialog dismissal still cancels the card setup', async () => {
  const dismissals = [
    ['the card dialog close control', (fixture) => fixture.paymentClose.click()],
    ['the card dialog backdrop', (fixture) => fixture.paymentBackdrop.click()],
    ['Esc on the card dialog', (fixture) => fixture.paymentModal.cancel()],
  ]
  for (const [name, dismiss] of dismissals) {
    const { counts, fixture } = makeCardSetupFixture()
    try {
      await openCardSetup(fixture)
      dismiss(fixture)
      assert.equal(fixture.calendars[0].clearCount, 1, `${name} must clear the selected slot`)
      await saveCard(fixture)
      assert.equal(counts.booking, 0, `${name} must leave nothing to book`)
    } finally {
      fixture.restore()
    }
  }
})

test('a card-dialog marker nested on a child still binds that dialog own backdrop', async () => {
  const { counts, fixture } = makeCardSetupFixture({ nestedPaymentMarker: true })
  try {
    await openCardSetup(fixture)

    // The re-nested marker cannot see its own dialog's backdrop, so the scope
    // widens to the `[data-modal-target]` that owns it — and no further.
    assert.equal(
      (fixture.bookingBackdrop.listeners.click || []).length,
      0,
      'widening to the owning dialog must not reach the booking dialog',
    )

    fixture.paymentBackdrop.click()
    assert.equal(fixture.calendars[0].clearCount, 1)
    await saveCard(fixture)
    assert.equal(counts.booking, 0)
  } finally {
    fixture.restore()
  }
})

test('a synthesized booking close skips the back arrow and uses a real closer', () => {
  // The back arrow closes the booking dialog AND opens the chooser, so it
  // carries a close marker like any other closer. If the success-close lookup
  // could land on it, finishing a booking would bounce the visitor back into
  // the Free/Paid chooser instead of closing. Today the backdrop happens to sit
  // first in the DOM and the bug is unreachable, which is exactly the kind of
  // accident a Designer reorder undoes.
  const selector = bookingCloseSelector()
  const backArrow = {
    attrs: { 'data-booking-back': '', 'data-modal-close': '', 'data-modal-trigger': 'popup-booking-main' },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
    },
  }
  const realCloser = {
    attrs: { 'data-modal-close': '', 'booking-popup-close': '' },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
    },
  }

  // The back arrow first in document order is the case that matters.
  assert.equal(firstCloseMatch(selector, [backArrow, realCloser]), realCloser)
  // And it is still skipped when it is the only close-marked control there is,
  // rather than being picked as a last resort.
  assert.equal(firstCloseMatch(selector, [backArrow]), null)
  // An ordinary closer is unaffected on every one of the three markers.
  for (const marker of ['data-modal-close', 'booking-popup-close', 'popup-booking-close']) {
    const only = {
      attrs: { [marker]: '' },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
      },
    }
    assert.equal(firstCloseMatch(selector, [only]), only, marker)
  }
})

test('timezoneLabel names the zone with a DST-correct offset and fails soft', () => {
  const january = Date.UTC(2026, 0, 15, 12, 0, 0)
  const july = Date.UTC(2026, 6, 15, 12, 0, 0)
  assert.equal(api.timezoneLabel('America/New_York', january), 'America/New_York (EST)')
  assert.equal(api.timezoneLabel('America/New_York', july), 'America/New_York (EDT)')
  assert.match(api.timezoneLabel('Asia/Manila', july), /^Asia\/Manila \(GMT\+8\)$/)
  // UTC formats as "UTC" itself, so no duplicate suffix is added.
  assert.equal(api.timezoneLabel('UTC', july), 'UTC')
  assert.equal(api.timezoneLabel('', july), '')
  // An invalid zone still returns the zone name instead of throwing.
  assert.equal(api.timezoneLabel('Not/A_Zone', july), 'Not/A_Zone')
})

test('the dashboard mount makes every wide-grid area a shell child', async () => {
  const dialog = new CalendarElement('dialog')
  dialog.setAttribute('data-modal-target', 'popup-booking-info')
  const container = new CalendarElement('div')
  container.setAttribute('booking-reschedule-calendar', '')
  dialog.appendChild(container)

  const { shell } = await mountFooterFixture({ container })
  const role = (name) => shell.querySelectorAll('[data-paid-calendar-element]')
    .find((node) => node.getAttribute('data-paid-calendar-element') === name) || null
  const gridItems = ['month', 'timezone-control', 'times', 'confirm'].map(role)

  assert.ok(gridItems.every(Boolean))
  assert.ok(gridItems.every((node) => node.parentElement === shell))
  assert.deepEqual(
    shell.children.map((node) => node.getAttribute('data-paid-calendar-element')),
    ['month', 'timezone-control', 'times', 'confirm', 'status'],
  )
  assert.equal(role('footer'), null)
})

test('the dashboard layout injector is idempotent and inert on a bare document', () => {
  let injected = 0
  const doc = {
    existing: null,
    getElementById() { return doc.existing },
    createElement() { return new CalendarElement('style') },
    head: {
      appendChild(node) { injected += 1; doc.existing = node },
    },
  }
  api.ensureDashboardCalendarLayout(doc)
  api.ensureDashboardCalendarLayout(doc)
  assert.equal(injected, 1)
  assert.doesNotThrow(() => api.ensureDashboardCalendarLayout(undefined))
  assert.doesNotThrow(() => api.ensureDashboardCalendarLayout({}))
})
