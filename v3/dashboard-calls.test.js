const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

global.window = global
const api = require('./dashboard-calls.js')

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function element(attributes = {}) {
  const classes = new Set()
  return {
    attributes: { ...attributes },
    hidden: false,
    innerHTML: '',
    style: {},
    textContent: '',
    addEventListener() {},
    appendChild() {},
    cloneNode() {
      return element(this.attributes)
    },
    getAttribute(name) {
      return this.attributes[name] || null
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
    },
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name))
      },
      contains(name) {
        return classes.has(name)
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name))
      },
      toggle(name, force) {
        const active = force == null ? !classes.has(name) : Boolean(force)
        if (active) classes.add(name)
        else classes.delete(name)
        return active
      },
    },
    matches() {
      return false
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    remove() {},
    removeAttribute(name) {
      delete this.attributes[name]
    },
    setAttribute(name, value) {
      this.attributes[name] = value
    },
  }
}

function domElement(tag, attributes = {}) {
  const node = {
    tagName: tag,
    attributes: { ...attributes },
    children: [],
    hidden: false,
    style: {},
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
      return child
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
    removeAttribute(name) {
      delete this.attributes[name]
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
    querySelectorAll(selector) {
      const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
      if (!match) return []
      const results = []
      const visit = (candidate) => {
        const actual = candidate.getAttribute && candidate.getAttribute(match[1])
        if (actual != null && (match[2] == null || actual === match[2])) {
          results.push(candidate)
        }
        candidate.children.forEach(visit)
      }
      this.children.forEach(visit)
      return results
    },
    closest(selector) {
      const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
      if (!match) return null
      let candidate = this
      while (candidate) {
        const actual = candidate.getAttribute && candidate.getAttribute(match[1])
        if (actual != null && (match[2] == null || actual === match[2])) return candidate
        candidate = candidate.parentNode
      }
      return null
    },
  }
  let ownText = ''
  Object.defineProperty(node, 'textContent', {
    get() { return ownText },
    set(value) {
      ownText = String(value)
      if (ownText === '') node.children = []
    },
  })
  Object.defineProperty(node, 'childNodes', { get() { return node.children } })
  return node
}

function memoryStorage() {
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

async function until(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(setImmediate)
  }
  assert.fail('condition was not reached')
}

test('activates only canonical V3 dashboard paths', () => {
  assert.equal(api.roleForPath('/starter-dashboard/'), 'starter')
  assert.equal(api.roleForPath('/brand-dashboard'), 'brand')
  assert.equal(api.roleForPath('/freelancer-start-project'), '')
})

test('normalizes lifecycle statuses and completed timestamps', () => {
  const now = 2_000
  assert.equal(api.bookingStatus({ status: 'pending' }, now), 'pending')
  assert.equal(api.bookingStatus({ status: 'declined' }, now), 'cancelled')
  assert.equal(api.bookingStatus({ status: 'confirmed', end: 1_000 }, now), 'completed')
  assert.equal(api.bookingStatus({ status: 'confirmed', end: 3_000 }, now), 'confirmed')
})

test('normalizes canonical Unix seconds once while preserving milliseconds', () => {
  assert.deepEqual(
    api.normalizeBooking({ booking_id: 'seconds', start: 1_709_645_400, end: '1709649000' }),
    { booking_id: 'seconds', start: 1_709_645_400_000, end: 1_709_649_000_000 },
  )
  assert.deepEqual(
    api.normalizeBooking({ booking_id: 'milliseconds', start: 1_709_645_400_000 }),
    { booking_id: 'milliseconds', start: 1_709_645_400_000, end: Number.NaN },
  )
})

test('builds the current confirm payload only when booking_ref identities match', () => {
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const salt = Buffer.from('bounded-salt')
  const bookingRef = Buffer.concat([uuidBytes(configId), uuidBytes(bookingId), salt])
    .toString('base64url')
  const payload = api.confirmPayload({
    booking_id: bookingId,
    config_id: configId,
    booking_ref: bookingRef,
  }, 'dashboard-confirm:one')

  assert.deepEqual(payload, {
    booking_id: bookingId,
    config_id: configId,
    booking_ref_salt: salt.toString('base64url'),
    idempotency_key: 'dashboard-confirm:one',
  })
  assert.equal(api.confirmPayload({
    booking_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    config_id: configId,
    booking_ref: bookingRef,
  }, 'dashboard-confirm:one'), null)
  assert.equal(api.confirmPayload({
    booking_id: bookingId,
    config_id: configId,
    booking_ref: 'malformed',
  }, 'dashboard-confirm:one'), null)
})

test('accepts the canonical nested confirmation response and fails closed otherwise', () => {
  assert.equal(api.confirmSucceeded({ confirmation: { status: 'confirmed' }, duplicate: false }), true)
  assert.equal(api.confirmSucceeded({ confirmation: { status: 'confirmed' }, duplicate: true }), true)
  assert.equal(api.confirmSucceeded({ status: 'confirmed' }), true)
  assert.equal(api.confirmSucceeded({ confirmation: { status: 'pending' } }), false)
  assert.equal(api.confirmSucceeded({ confirmation: null }), false)
  assert.equal(api.confirmSucceeded(null), false)
})

test('confirmation attempt storage scopes omit identity data and isolate account and environment', async () => {
  const base = {
    booking_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    data_environment: 'production',
    starter_data: { memberstack_id: 'mem_starter-one', email: 'private@example.com' },
  }
  const first = await api.confirmAttemptStorageKey(base)
  const otherAccount = await api.confirmAttemptStorageKey({
    ...base,
    starter_data: { memberstack_id: 'mem_starter-two', email: 'other@example.com' },
  })
  const otherEnvironment = await api.confirmAttemptStorageKey({ ...base, data_environment: 'test' })

  assert.match(first, /^starters:dashboard-confirm:v1:production:[0-9a-f]{64}:aaaaaaaa-/)
  assert.equal(first.includes('mem_starter-one'), false)
  assert.equal(first.includes('private@example.com'), false)
  assert.notEqual(first, otherAccount)
  assert.notEqual(first, otherEnvironment)
  assert.equal(await api.confirmAttemptStorageKey({ ...base, data_environment: '' }), '')
})

test('confirmation attempt creation fails closed without durable storage readback', async () => {
  const booking = {
    booking_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    data_environment: 'production',
    starter_data: { memberstack_id: 'mem_starter-one' },
  }
  const originalCrypto = global.crypto
  const originalStorage = global.sessionStorage

  try {
    global.crypto = {
      subtle: originalCrypto && originalCrypto.subtle,
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
    }
    global.sessionStorage = {
      getItem() { return null },
      setItem() {},
    }
    assert.equal(await api.createConfirmAttemptKey(booking), '')

    global.sessionStorage = {
      getItem() { return null },
      setItem() { throw new Error('storage unavailable') },
    }
    assert.equal(await api.createConfirmAttemptKey(booking), '')

    global.sessionStorage = undefined
    assert.equal(await api.createConfirmAttemptKey(booking), '')
  } finally {
    global.crypto = originalCrypto
    global.sessionStorage = originalStorage
  }
})

test('ambiguous confirmation survives a page rebuild and clears only after success', async () => {
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const bookingRef = Buffer.concat([
    uuidBytes(configId),
    uuidBytes(bookingId),
    Buffer.from('bounded-salt'),
  ]).toString('base64url')
  const booking = {
    booking_id: bookingId,
    config_id: configId,
    booking_ref: bookingRef,
    data_environment: 'production',
    starter_data: { memberstack_id: 'mem_starter-one' },
    status: 'pending',
  }
  const storage = memoryStorage()
  const bodies = []
  let responseOk = false
  let restartCount = 0
  const originalDocument = global.document
  const originalCrypto = global.crypto
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalConsoleError = console.error

  async function clickFreshButton() {
    const listeners = []
    const card = {
      getAttribute(name) {
        return name === 'data-booking-id' ? bookingId : null
      },
    }
    const button = {
      attributes: {},
      closest(selector) {
        return selector === '[data-booking-id]' ? card : this
      },
      setAttribute(name, value) {
        this.attributes[name] = value
      },
    }
    global.document = {
      addEventListener(_type, listener) {
        listeners.push(listener)
      },
    }
    api.wireBookingActions([{ rows: [booking] }], 'starter', async () => {
      restartCount += 1
    })
    await listeners[0]({
      target: button,
      preventDefault() {},
      stopImmediatePropagation() {},
    })
  }

  try {
    global.crypto = {
      subtle: originalCrypto && originalCrypto.subtle,
      randomUUID: () => '00000000-0000-4000-8000-000000000001',
    }
    global.sessionStorage = storage
    global.xanoAuthFetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      return { ok: responseOk, json: async () => responseOk ? { status: 'confirmed' } : { code: 'ambiguous' } }
    }
    console.error = () => {}

    await clickFreshButton()
    assert.equal(bodies.length, 1)
    assert.equal(await api.storedConfirmAttemptKey(booking), bodies[0].idempotency_key)

    responseOk = true
    global.xanoAuthFetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      return { ok: true, json: async () => ({ confirmation: { status: 'pending' } }) }
    }
    await clickFreshButton()
    assert.equal(bodies.length, 2)
    assert.equal(bodies[1].idempotency_key, bodies[0].idempotency_key)
    assert.equal(await api.storedConfirmAttemptKey(booking), bodies[0].idempotency_key)
    assert.equal(restartCount, 0)

    global.xanoAuthFetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      return { ok: true, json: async () => ({ confirmation: { status: 'confirmed' }, duplicate: false }) }
    }
    await clickFreshButton()
    assert.equal(bodies.length, 3)
    assert.equal(bodies[2].idempotency_key, bodies[0].idempotency_key)
    assert.equal(await api.storedConfirmAttemptKey(booking), '')
    assert.equal(restartCount, 1)
  } finally {
    global.document = originalDocument
    global.crypto = originalCrypto
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    console.error = originalConsoleError
  }
})

test('Starter Accept sends one canonical request and blocks a double click', async () => {
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const bookingRef = Buffer.concat([
    uuidBytes(configId),
    uuidBytes(bookingId),
    Buffer.from('bounded-salt'),
  ]).toString('base64url')
  const booking = {
    booking_id: bookingId,
    config_id: configId,
    booking_ref: bookingRef,
    data_environment: 'production',
    starter_data: { memberstack_id: 'mem_starter-one' },
    status: 'pending',
  }
  const listeners = []
  const requests = []
  let releaseRequest
  let restartCount = 0
  const originalDocument = global.document
  const originalCrypto = global.crypto
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const card = {
    getAttribute(name) {
      return name === 'data-booking-id' ? bookingId : null
    },
  }
  const button = {
    attributes: {},
    closest(selector) {
      return selector === '[data-booking-id]' ? card : this
    },
    setAttribute(name, value) {
      this.attributes[name] = value
    },
  }
  const event = {
    target: button,
    preventDefault() {},
    stopImmediatePropagation() {},
  }

  try {
    global.document = {
      addEventListener(type, listener, capture) {
        listeners.push({ type, listener, capture })
      },
    }
    global.crypto = {
      subtle: originalCrypto && originalCrypto.subtle,
      randomUUID: () => '00000000-0000-4000-8000-000000000002',
    }
    global.sessionStorage = memoryStorage()
    global.xanoAuthFetch = async (url, options) => {
      requests.push({ url, options })
      await new Promise((resolve) => { releaseRequest = resolve })
      return { ok: true, json: async () => ({ status: 'confirmed' }) }
    }
    api.wireBookingActions([{ rows: [booking] }], 'starter', async () => {
      restartCount += 1
    })
    assert.equal(listeners.length, 1)
    assert.equal(listeners[0].type, 'click')
    assert.equal(listeners[0].capture, true)

    const first = listeners[0].listener(event)
    const second = listeners[0].listener(event)
    await until(() => requests.length === 1 && typeof releaseRequest === 'function')
    releaseRequest()
    await Promise.all([first, second])

    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/booking\/confirm\/v3$/)
    const requestBody = JSON.parse(requests[0].options.body)
    assert.deepEqual({ ...requestBody, idempotency_key: 'canonical-key' }, {
      booking_id: bookingId,
      config_id: configId,
      booking_ref_salt: Buffer.from('bounded-salt').toString('base64url'),
      idempotency_key: 'canonical-key',
    })
    assert.match(requestBody.idempotency_key, /^dashboard-confirm:[0-9a-f-]+$/)
    assert.equal(restartCount, 1)
    assert.equal(button.attributes['aria-busy'], 'false')
    assert.equal(button.attributes['aria-disabled'], 'false')
  } finally {
    global.document = originalDocument
    global.crypto = originalCrypto
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
  }
})

test('Starter Accept rechecks the response window immediately before mutation', async () => {
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const bookingRef = Buffer.concat([
    uuidBytes(configId),
    uuidBytes(bookingId),
    Buffer.from('bounded-salt'),
  ]).toString('base64url')
  const booking = {
    booking_id: bookingId,
    config_id: configId,
    status: 'pending',
    confirmation_expires_at: Date.now() + 60_000,
  }
  Object.defineProperty(booking, 'booking_ref', {
    get() {
      booking.confirmation_expires_at = 1
      return bookingRef
    },
  })
  const listeners = []
  const requests = []
  const originalDocument = global.document
  const originalFetch = global.xanoAuthFetch
  const card = {
    getAttribute(name) {
      return name === 'data-booking-id' ? bookingId : null
    },
  }
  const button = {
    __startersBookingActionKey: 'dashboard-confirm:expired-action',
    closest(selector) {
      return selector === '[data-booking-id]' ? card : this
    },
    setAttribute() {},
  }

  try {
    global.document = {
      addEventListener(_type, listener) {
        listeners.push(listener)
      },
    }
    global.xanoAuthFetch = async (...args) => {
      requests.push(args)
    }
    api.wireBookingActions([{ rows: [booking] }], 'starter', async () => {})
    await listeners[0]({
      target: button,
      preventDefault() {},
      stopImmediatePropagation() {},
    })

    assert.equal(requests.length, 0)
  } finally {
    global.document = originalDocument
    global.xanoAuthFetch = originalFetch
  }
})

test('only the V3-native Starter Accept action is visible on pending cards', () => {
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const decline = element({ 'booking-action-btn': 'switch-decline' })
  const reschedule = element({ 'booking-action-btn': 'reschedule' })
  const message = element({ 'booking-action-btn': 'message' })
  const join = element({ 'booking-action-btn': 'join' })
  const buttons = [accept, decline, reschedule, message, join]
  const card = {
    querySelectorAll(selector) {
      assert.equal(selector, '[booking-card-action-btn], [booking-action-btn]')
      return buttons
    },
  }

  api.configureActionButtons(card, 'starter', 'pending')

  assert.equal(accept.hidden, false)
  assert.equal(accept.style.display, '')
  for (const button of [decline, reschedule, message, join]) {
    assert.equal(button.hidden, true)
    assert.equal(button.style.display, 'none')
  }
})

test('read-only details stay available while expired requests cannot be accepted', () => {
  const details = element({ 'booking-card-action-btn': 'details' })
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const reschedule = element({ 'booking-action-btn': 'reschedule' })
  const card = {
    querySelectorAll() {
      return [details, accept, reschedule]
    },
  }
  const now = 2_000_000_000_000

  api.configureActionButtons(card, 'starter', 'pending', {
    status: 'pending',
    start: 3_000_000_000_000,
    confirmation_expires_at: 1_000_000_000_000,
  }, now)

  assert.equal(details.hidden, false)
  assert.equal(accept.hidden, true)
  assert.equal(reschedule.hidden, true)
})

test('request expiration uses the canonical confirmation deadline before the call start', () => {
  assert.equal(api.responseDeadline({
    confirmation_expires_at: 2_000_000_000,
    start: 3_000_000_000_000,
  }), 2_000_000_000_000)
  assert.equal(api.responseDeadline({ start: 3_000_000_000 }), 3_000_000_000_000)
  assert.equal(api.formatResponseTime(2_000_000_000_000 + 60_000, 2_000_000_000_000), '1m')
  assert.equal(api.formatResponseTime(2_000_000_000_000 + 61 * 60_000, 2_000_000_000_000), '1h 1m')
  assert.equal(api.formatResponseTime(2_000_000_000_000 + 25 * 60 * 60_000 + 60_000, 2_000_000_000_000), '1d 1h 1m')
  assert.equal(api.formatResponseTime(2_000_000_000_000, 2_000_000_000_000), 'Expired')
})

test('pending Starter request cards show the countdown and hide Accept at expiration', () => {
  const wrap = element()
  const output = element()
  const details = element({ 'booking-card-action-btn': 'details' })
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const card = {
    querySelector(selector) {
      if (selector === '[booking-item-expiration="wrap"]') return wrap
      if (selector === '[booking-item-expiration="time"]') return output
      return null
    },
    querySelectorAll() {
      return [details, accept]
    },
  }
  const now = 2_000_000_000_000
  const booking = {
    status: 'pending',
    start: now + 60 * 60 * 1000,
    confirmation_expires_at: now + 30 * 60 * 1000,
  }

  assert.equal(api.paintRequestExpiration(card, booking, 'starter', now), false)
  assert.equal(wrap.hidden, false)
  assert.equal(output.textContent, '30m')
  assert.equal(output.classList.contains('text-color-red'), true)
  assert.equal(wrap.classList.contains('is-expiring'), false)
  assert.equal(accept.hidden, false)

  assert.equal(api.paintRequestExpiration(card, booking, 'starter', now + 30 * 60 * 1000), true)
  assert.equal(output.textContent, 'Expired')
  assert.equal(output.classList.contains('text-color-red'), true)
  assert.equal(wrap.classList.contains('is-expiring'), false)
  assert.equal(accept.hidden, true)
  assert.equal(details.hidden, false)

  assert.equal(api.paintRequestExpiration(card, booking, 'brand', now), false)
  assert.equal(wrap.hidden, true)
})

test('GitHub expiration owner polls one expired request at a bounded interval', async () => {
  const nowValue = { value: 2_000_000_000_000 }
  const wrap = element()
  const output = element()
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const card = {
    getAttribute(name) {
      return name === 'data-booking-id' ? 'booking-expired' : null
    },
    querySelector(selector) {
      if (selector === '[booking-item-expiration="wrap"]') return wrap
      if (selector === '[booking-item-expiration="time"]') return output
      return null
    },
    querySelectorAll() {
      return [accept]
    },
  }
  const cards = [card]
  const refs = [{
    rows: [{
      booking_id: 'booking-expired',
      status: 'pending',
      start: nowValue.value + 60_000,
      confirmation_expires_at: nowValue.value - 1,
    }],
    list: {
      querySelectorAll() {
        return cards
      },
    },
  }]
  let tick
  let cleared = false
  let restarts = 0
  const stop = api.startRequestExpirationTicker(refs, 'starter', async () => {
    restarts += 1
  }, {
    now: () => nowValue.value,
    setInterval(callback, delay) {
      assert.equal(delay, 10_000)
      tick = callback
      return 42
    },
    clearInterval(timer) {
      assert.equal(timer, 42)
      cleared = true
    },
  })

  await new Promise(setImmediate)
  assert.equal(restarts, 1)
  assert.equal(output.textContent, 'Expired')
  assert.equal(accept.hidden, true)

  tick()
  await new Promise(setImmediate)
  assert.equal(restarts, 1)

  // The same expired request stops earning canonical reads once its bounded
  // budget is spent, even while it stays rendered and past its deadline.
  for (let elapsed = 0; elapsed < 10; elapsed += 1) {
    nowValue.value += 30_000
    tick()
    await new Promise(setImmediate)
  }
  assert.equal(restarts, 3)

  // A different request crossing its own deadline is still polled.
  refs[0].rows.push({
    booking_id: 'booking-expired-later',
    status: 'pending',
    start: nowValue.value + 60_000,
    confirmation_expires_at: nowValue.value - 1,
  })
  cards.push({
    getAttribute(name) {
      return name === 'data-booking-id' ? 'booking-expired-later' : null
    },
    querySelector: () => element(),
    querySelectorAll: () => [],
  })
  nowValue.value += 30_000
  tick()
  await new Promise(setImmediate)
  assert.equal(restarts, 4)

  nowValue.value += 30_000
  tick()
  await new Promise(setImmediate)
  assert.equal(restarts, 5)

  stop()
  assert.equal(cleared, true)
})

test('the expiration owner arms exactly one timer, and none for Brands', () => {
  const expiredRow = (id) => ({
    booking_id: id,
    status: 'pending',
    start: 2_000_000_000_000 + 60_000,
    confirmation_expires_at: 1,
  })
  const expiredCard = (id) => ({
    getAttribute: (name) => (name === 'data-booking-id' ? id : null),
    querySelector: () => element(),
    querySelectorAll: () => [],
  })
  const refs = [
    {
      rows: [expiredRow('a'), expiredRow('b')],
      list: { querySelectorAll: () => [expiredCard('a'), expiredCard('b')] },
    },
    {
      rows: [expiredRow('c')],
      list: { querySelectorAll: () => [expiredCard('c')] },
    },
  ]

  let starterTimers = 0
  const stop = api.startRequestExpirationTicker(refs, 'starter', () => {}, {
    now: () => 2_000_000_000_000,
    setInterval() {
      starterTimers += 1
      return 1
    },
    clearInterval() {},
  })
  assert.equal(typeof stop, 'function')
  assert.equal(starterTimers, 1)

  let brandTimers = 0
  assert.equal(api.startRequestExpirationTicker(refs, 'brand', () => {}, {
    now: () => 2_000_000_000_000,
    setInterval() {
      brandTimers += 1
      return 1
    },
    clearInterval() {},
  }), null)
  assert.equal(brandTimers, 0)
})

test('an open detail modal hides Accept once the request passes its deadline', () => {
  const originalDocument = global.document
  const now = 2_000_000_000_000
  const booking = {
    booking_id: 'booking-open',
    status: 'pending',
    start: now + 2 * 60 * 60 * 1000,
    confirmation_expires_at: now + 60 * 60 * 1000,
  }
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const close = element({ 'booking-action-btn': 'switch-close' })
  const pendingInfo = element({ 'pending-info-text': '' })
  const modal = {
    attributes: { 'data-booking-id': 'booking-open' },
    getAttribute(name) {
      return this.attributes[name] || null
    },
    querySelector() {
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[pending-info-text]') return [pendingInfo]
      return [accept, close]
    },
  }
  const refs = [{ rows: [booking], list: { querySelectorAll: () => [] } }]
  try {
    global.document = { querySelector: () => modal }

    assert.equal(api.refreshDetailExpiration(refs, 'starter', now), true)
    assert.equal(accept.hidden, false)
    assert.equal(close.hidden, false)
    assert.equal(pendingInfo.hidden, false)

    assert.equal(
      api.refreshDetailExpiration(refs, 'starter', now + 60 * 60 * 1000),
      true,
    )
    assert.equal(accept.hidden, true)
    assert.equal(close.hidden, false)
    assert.equal(pendingInfo.hidden, true)

    modal.attributes = {}
    assert.equal(api.refreshDetailExpiration(refs, 'starter', now), false)
  } finally {
    global.document = originalDocument
  }
})

test('expiration polling recovers from thrown and rejected refreshes and keeps retries bounded', async () => {
  const nowValue = { value: 2_000_000_000_000 }
  const card = {
    getAttribute() {
      return 'booking-expired'
    },
    querySelector() {
      return element()
    },
    querySelectorAll() {
      return []
    },
  }
  const refs = [{
    rows: [{
      booking_id: 'booking-expired',
      status: 'pending',
      start: nowValue.value + 60_000,
      confirmation_expires_at: nowValue.value - 1,
    }],
    list: { querySelectorAll: () => [card] },
  }]
  let tick
  let restarts = 0
  const originalError = console.error
  console.error = () => {}
  try {
    api.startRequestExpirationTicker(refs, 'starter', () => {
      restarts += 1
      if (restarts === 1) throw new Error('synchronous refresh failure')
      if (restarts === 2) return Promise.reject(new Error('rejected refresh failure'))
      return Promise.resolve()
    }, {
      now: () => nowValue.value,
      setInterval(callback) {
        tick = callback
        return 1
      },
      clearInterval() {},
    })
    await new Promise(setImmediate)
    assert.equal(restarts, 1)

    nowValue.value += 30_000
    tick()
    await new Promise(setImmediate)
    assert.equal(restarts, 2)

    nowValue.value += 30_000
    tick()
    await new Promise(setImmediate)
    assert.equal(restarts, 3)

    // The retry budget is spent: a transient failure never becomes an
    // open-ended poll against the canonical endpoint.
    nowValue.value += 30_000
    tick()
    await new Promise(setImmediate)
    assert.equal(restarts, 3)
  } finally {
    console.error = originalError
  }
})

test('expiration polling does not overlap an in-flight canonical refresh', async () => {
  const nowValue = { value: 2_000_000_000_000 }
  const card = {
    getAttribute: () => 'booking-expired',
    querySelector: () => element(),
    querySelectorAll: () => [],
  }
  const refs = [{
    rows: [{
      booking_id: 'booking-expired',
      status: 'pending',
      start: nowValue.value + 60_000,
      confirmation_expires_at: nowValue.value - 1,
    }],
    list: { querySelectorAll: () => [card] },
  }]
  const pending = deferred()
  let tick
  let restarts = 0
  api.startRequestExpirationTicker(refs, 'starter', () => {
    restarts += 1
    return pending.promise
  }, {
    now: () => nowValue.value,
    setInterval(callback) {
      tick = callback
      return 1
    },
    clearInterval() {},
  })
  await new Promise(setImmediate)
  // Far enough past the throttle that only the in-flight guard can hold the
  // second read back.
  nowValue.value += 30_000
  tick()
  assert.equal(restarts, 1)

  pending.resolve()
  await new Promise(setImmediate)
  nowValue.value += 30_000
  tick()
  await new Promise(setImmediate)
  assert.equal(restarts, 2)
})

test('background expiration refresh preserves the rendered request after a transient failure', async () => {
  const originalDocument = global.document
  const originalLocation = global.location
  const originalFetch = global.xanoAuthFetch
  const originalError = console.error
  const root = element({ 'data-dashboard-calls-v3': 'ready' })
  const list = element()
  list.innerHTML = 'rendered request'
  const refs = {
    name: 'requests',
    filter: 'all',
    rows: [api.normalizeBooking({
      booking_id: 'booking-expired',
      status: 'pending',
      starter_data: { memberstack_id: 'starter-1' },
      confirmation_expires_at: 1,
    })],
    rendered: 1,
    list,
    template: element(),
    loader: element(),
    empty: element(),
    loadMore: element(),
    filters: element(),
    count: element(),
    section: element(),
  }
  let requestCount = 0
  try {
    global.document = { documentElement: root, querySelector: () => null }
    global.location = { pathname: '/starter-dashboard' }
    console.error = () => {}
    global.xanoAuthFetch = async () => {
      requestCount += 1
      if (requestCount === 1) {
        return { ok: false, json: async () => null }
      }
      if (requestCount === 2) {
        return {
          ok: true,
          json: async () => [{
            booking_id: 'booking-expired',
            status: 'pending',
            starter_data: { memberstack_id: 'starter-1' },
            confirmation_expires_at: 1,
          }],
        }
      }
      return {
        ok: true,
        json: async () => [{
          booking_id: 'booking-expired',
          status: 'cancelled',
          starter_data: { memberstack_id: 'starter-1' },
        }],
      }
    }
    const memberstack = {
      getCurrentMember: async () => ({ id: 'starter-1' }),
    }
    const currentGeneration = () => 1

    assert.equal(await api.refreshSession(
      memberstack,
      [refs],
      'starter',
      1,
      currentGeneration,
      false,
      { preserveExisting: true },
    ), false)
    assert.equal(refs.rows.length, 1)
    assert.equal(list.innerHTML, 'rendered request')
    assert.equal(root.getAttribute('data-dashboard-calls-v3'), 'ready')

    assert.equal(await api.refreshSession(
      memberstack,
      [refs],
      'starter',
      1,
      currentGeneration,
      false,
      { preserveExisting: true },
    ), true)
    assert.equal(refs.rows.length, 1)
    assert.equal(list.innerHTML, 'rendered request')
    assert.equal(root.getAttribute('data-dashboard-calls-v3'), 'ready')

    assert.equal(await api.refreshSession(
      memberstack,
      [refs],
      'starter',
      1,
      currentGeneration,
      false,
      { preserveExisting: true },
    ), true)
    assert.equal(refs.rows.length, 0)
    assert.equal(list.innerHTML, '')
    assert.equal(refs.section.getAttribute('data-bookings-state'), 'empty')
    assert.equal(root.getAttribute('data-dashboard-calls-v3'), 'ready')
  } finally {
    global.document = originalDocument
    global.location = originalLocation
    global.xanoAuthFetch = originalFetch
    console.error = originalError
  }
})

test('session refresh tolerates a bounded transient empty Memberstack member', async () => {
  const originalDocument = global.document
  const originalFetch = global.xanoAuthFetch
  const originalSetTimeout = global.setTimeout
  const root = element({ 'data-dashboard-calls-v3': 'ready' })
  const refs = {
    name: 'calls',
    filter: 'all',
    rows: [],
    rendered: 0,
    list: element(),
    template: element(),
    loader: element(),
    empty: element(),
    loadMore: element(),
    filters: element(),
    count: element(),
    section: element(),
  }
  let reads = 0
  try {
    global.document = { documentElement: root, querySelector: () => null }
    global.setTimeout = (callback) => {
      callback()
      return 1
    }
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => [] })
    const memberstack = {
      async getCurrentMember() {
        reads += 1
        return reads < 3 ? null : { id: 'starter-1' }
      },
    }

    assert.equal(await api.refreshSession(
      memberstack,
      [refs],
      'starter',
      1,
      () => 1,
      false,
      { preserveExisting: true },
    ), true)
    assert.equal(reads, 3)
    assert.equal(root.getAttribute('data-dashboard-calls-v3'), 'ready')
  } finally {
    global.document = originalDocument
    global.xanoAuthFetch = originalFetch
    global.setTimeout = originalSetTimeout
  }
})

test('a post-mutation refresh still fails closed once the member stays missing', async () => {
  const originalDocument = global.document
  const originalFetch = global.xanoAuthFetch
  const originalSetTimeout = global.setTimeout
  const originalError = console.error
  const root = element({ 'data-dashboard-calls-v3': 'ready' })
  const empty = element()
  const list = element()
  list.innerHTML = 'rendered call'
  const refs = {
    name: 'calls',
    filter: 'all',
    rows: [{ booking_id: 'booking-1' }],
    rendered: 1,
    list,
    template: element(),
    loader: element(),
    empty,
    loadMore: element(),
    filters: element(),
    count: element(),
    section: element(),
  }
  let reads = 0
  const delays = []
  try {
    global.document = { documentElement: root, querySelector: () => null }
    console.error = () => {}
    global.setTimeout = (callback, delay) => {
      delays.push(delay)
      callback()
      return 1
    }
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => [] })
    const memberstack = {
      async getCurrentMember() {
        reads += 1
        return null
      },
    }

    assert.equal(await api.refreshSession(
      memberstack,
      [refs],
      'starter',
      1,
      () => 1,
      false,
      { preserveExisting: true },
    ), false)
    assert.equal(reads, 3)
    assert.deepEqual(delays, [200, 400])
    assert.equal(root.getAttribute('data-dashboard-calls-v3'), 'error')
    assert.equal(refs.section.getAttribute('data-bookings-state'), 'error')
    assert.equal(empty.hidden, false)
    assert.equal(list.hidden, true)
    assert.deepEqual(refs.rows, [])
    assert.equal(refs.rendered, 0)
    assert.equal(list.innerHTML, '')
  } finally {
    global.document = originalDocument
    global.xanoAuthFetch = originalFetch
    global.setTimeout = originalSetTimeout
    console.error = originalError
  }
})

test('a background refresh that only loses the canonical read keeps the rendered list', async () => {
  const originalDocument = global.document
  const originalFetch = global.xanoAuthFetch
  const originalError = console.error
  const root = element({ 'data-dashboard-calls-v3': 'ready' })
  const list = element()
  list.innerHTML = 'rendered call'
  const refs = {
    name: 'calls',
    filter: 'all',
    rows: [{ booking_id: 'booking-1' }],
    rendered: 1,
    list,
    template: element(),
    loader: element(),
    empty: element(),
    loadMore: element(),
    filters: element(),
    count: element(),
    section: element({ 'data-bookings-state': 'ready' }),
  }
  try {
    global.document = { documentElement: root, querySelector: () => null }
    console.error = () => {}
    global.xanoAuthFetch = async () => ({ ok: false, json: async () => null })

    assert.equal(await api.refreshSession(
      { getCurrentMember: async () => ({ id: 'starter-1' }) },
      [refs],
      'starter',
      1,
      () => 1,
      false,
      { preserveExisting: true },
    ), false)
    assert.equal(list.innerHTML, 'rendered call')
    assert.equal(refs.rows.length, 1)
    assert.equal(root.getAttribute('data-dashboard-calls-v3'), 'ready')
    assert.equal(refs.section.getAttribute('data-bookings-state'), 'ready')
  } finally {
    global.document = originalDocument
    global.xanoAuthFetch = originalFetch
    console.error = originalError
  }
})

test('a background expiration refresh keeps every Load More page rendered', async () => {
  const originalDocument = global.document
  const originalLocation = global.location
  const originalFetch = global.xanoAuthFetch
  const root = element({ 'data-dashboard-calls-v3': 'ready' })
  const appended = []
  const list = element()
  list.appendChild = (child) => {
    appended.push(child)
  }
  const canonicalRows = (context) => Array.from({ length: 14 }, (_unused, index) => ({
    booking_id: 'booking-' + index,
    status: 'confirmed',
    start: 3_000_000_000_000,
    call_context: index === 0 ? context : 'Call ' + index,
    starter_data: { memberstack_id: 'starter-1' },
  }))
  const refs = {
    name: 'calls',
    filter: 'all',
    rows: canonicalRows('before').map(api.normalizeBooking),
    // The reader clicked Load More twice: 14 rows, 12 of them on screen.
    rendered: 12,
    list,
    template: element(),
    loader: element(),
    empty: element(),
    loadMore: element(),
    filters: element(),
    count: element(),
    section: element(),
  }
  try {
    global.document = { documentElement: root, querySelector: () => null }
    global.location = { pathname: '/starter-dashboard' }
    global.xanoAuthFetch = async () => ({
      ok: true,
      json: async () => canonicalRows('after'),
    })

    assert.equal(await api.refreshSession(
      { getCurrentMember: async () => ({ id: 'starter-1' }) },
      [refs],
      'starter',
      1,
      () => 1,
      false,
      { preserveExisting: true },
    ), true)

    assert.equal(refs.rows.length, 14)
    assert.equal(refs.rows[0].call_context, 'after')
    assert.equal(refs.rendered, 12)
    assert.equal(appended.length, 12)
    assert.equal(refs.loadMore.hidden, false)
  } finally {
    global.document = originalDocument
    global.location = originalLocation
    global.xanoAuthFetch = originalFetch
  }
})

test('a background refresh that shrinks the list stops at the available rows', async () => {
  const originalDocument = global.document
  const originalLocation = global.location
  const originalFetch = global.xanoAuthFetch
  const root = element({ 'data-dashboard-calls-v3': 'ready' })
  const appended = []
  const list = element()
  list.appendChild = (child) => {
    appended.push(child)
  }
  const refs = {
    name: 'calls',
    filter: 'all',
    rows: Array.from({ length: 14 }, (_unused, index) => api.normalizeBooking({
      booking_id: 'booking-' + index,
      status: 'confirmed',
      start: 3_000_000_000_000,
      starter_data: { memberstack_id: 'starter-1' },
    })),
    rendered: 12,
    list,
    template: element(),
    loader: element(),
    empty: element(),
    loadMore: element(),
    filters: element(),
    count: element(),
    section: element(),
  }
  try {
    global.document = { documentElement: root, querySelector: () => null }
    global.location = { pathname: '/starter-dashboard' }
    global.xanoAuthFetch = async () => ({
      ok: true,
      json: async () => [{
        booking_id: 'booking-0',
        status: 'confirmed',
        start: 3_000_000_000_000,
        starter_data: { memberstack_id: 'starter-1' },
      }],
    })

    assert.equal(await api.refreshSession(
      { getCurrentMember: async () => ({ id: 'starter-1' }) },
      [refs],
      'starter',
      1,
      () => 1,
      false,
      { preserveExisting: true },
    ), true)

    assert.equal(refs.rows.length, 1)
    assert.equal(refs.rendered, 1)
    assert.equal(appended.length, 1)
    assert.equal(refs.loadMore.hidden, true)
  } finally {
    global.document = originalDocument
    global.location = originalLocation
    global.xanoAuthFetch = originalFetch
  }
})

test('important CSS-hidden status wrappers become visible with the role-aware lifecycle variant', () => {
  const label = element()
  const group = element({ 'booking-element-wrap': 'status' })
  let inlineDisplay = ''
  let inlineDisplayPriority = ''
  group.style = {
    get display() {
      return inlineDisplay
    },
    set display(value) {
      inlineDisplay = value
      inlineDisplayPriority = ''
    },
    getPropertyPriority(name) {
      return name === 'display' ? inlineDisplayPriority : ''
    },
    setProperty(name, value, priority) {
      if (name !== 'display') return
      inlineDisplay = value
      inlineDisplayPriority = priority || ''
    },
  }
  const computedDisplay = (target) => {
    if (target.hidden || target.style.display === 'none') return 'none'
    if (
      target.authoredImportantDisplay &&
      target.style.getPropertyPriority('display') !== 'important'
    ) {
      return target.authoredImportantDisplay
    }
    return target.style.display || target.authoredDisplay || 'block'
  }
  group.authoredImportantDisplay = 'none'
  const pill = element({ 'booking-element': 'status' })
  pill.querySelector = (selector) => selector === '[label-text]' ? label : null
  pill.closest = (selector) => (
    selector === '[booking-element-wrap="status"]' ? group : null
  )
  const card = {
    querySelector(selector) {
      return selector === '[booking-element="status"]' ? pill : null
    },
  }

  assert.equal(computedDisplay(group), 'none')
  api.paintStatusPill(card, 'pending', 'starter')
  assert.equal(computedDisplay(group), 'flex')
  assert.equal(group.style.getPropertyPriority('display'), 'important')
  assert.equal(label.textContent, 'Pending')
  assert.equal(pill.hidden, false)
  assert.equal(
    pill.classList.contains('w-variant-34961dab-8ebb-e322-49a7-741a1936647a'),
    true,
  )

  api.paintStatusPill(card, 'completed', 'brand')
  assert.equal(label.textContent, 'Completed')
  assert.equal(
    pill.classList.contains('w-variant-34961dab-8ebb-e322-49a7-741a1936647a'),
    false,
  )
  assert.equal(
    pill.classList.contains('w-variant-89402c65-e26d-c236-91e7-76e9135a2d42'),
    true,
  )
})

test('production empty-value status wrapper becomes visible when it owns the status pill', () => {
  const label = element()
  const group = element({ 'booking-element-wrap': '' })
  let inlineDisplay = ''
  let inlineDisplayPriority = ''
  group.style = {
    get display() {
      return inlineDisplay
    },
    set display(value) {
      inlineDisplay = value
      inlineDisplayPriority = ''
    },
    getPropertyPriority(name) {
      return name === 'display' ? inlineDisplayPriority : ''
    },
    setProperty(name, value, priority) {
      if (name !== 'display') return
      inlineDisplay = value
      inlineDisplayPriority = priority || ''
    },
  }
  group.style.display = 'none'
  const pill = element({ 'booking-element': 'status' })
  group.querySelector = (selector) => (
    selector === '[booking-element="status"]' ? pill : null
  )
  pill.querySelector = (selector) => selector === '[label-text]' ? label : null
  pill.closest = (selector) => (
    selector === '[booking-element-wrap]'
      ? group
      : null
  )
  const card = {
    querySelector(selector) {
      return selector === '[booking-element="status"]' ? pill : null
    },
  }

  api.paintStatusPill(card, 'cancelled', 'starter')

  assert.equal(group.hidden, false)
  assert.equal(group.style.display, 'flex')
  assert.equal(group.style.getPropertyPriority('display'), 'important')
  assert.equal(label.textContent, 'Cancelled')
  assert.equal(pill.hidden, false)
})

test('status pill painting does not force a non-status authored wrapper visible', () => {
  const label = element()
  const genericGroup = element({ 'booking-element-wrap': '' })
  genericGroup.style.display = 'none'
  const pill = element({ 'booking-element': 'status' })
  pill.querySelector = (selector) => selector === '[label-text]' ? label : null
  pill.closest = (selector) => (
    selector === '[booking-element-wrap]'
      ? genericGroup
      : null
  )
  const card = {
    querySelector(selector) {
      return selector === '[booking-element="status"]' ? pill : null
    },
  }

  api.paintStatusPill(card, 'pending', 'starter')

  assert.equal(genericGroup.hidden, false)
  assert.equal(genericGroup.style.display, 'none')
  assert.equal(label.textContent, 'Pending')
})

function detailModalHarness() {
  const fields = {}
  const fieldCopies = {}
  const panelCopies = {}
  const groups = []
  function fieldNode(name) {
    const field = element({ 'booking-element': name })
    const group = element({ 'booking-element-wrap': '' })
    group.querySelector = (selector) => selector === '[booking-element]' ? field : null
    field.closest = (selector) => selector === '[booking-element-wrap]' ? group : null
    if (name === 'meeting-link') field.href = 'stale'
    groups.push(group)
    return field
  }
  ;[
    'paid-meeting',
    'status',
    'brand-name',
    'starter-name',
    'title',
    'context',
    'start-date',
    'duration',
    'price',
    'payment-status-text',
    'reschedule-reason',
    'cancel-reason',
    'meeting-link',
  ].forEach((name) => {
    const field = fieldNode(name)
    fields[name] = field
    fieldCopies[name] = [field]
  })
  // The authored cancel panel duplicates some base-panel fields; every copy
  // must be filled together (Kaeser QA F3).
  ;['context', 'start-date', 'meeting-link'].forEach((name) => {
    const copy = fieldNode(name)
    panelCopies[name] = copy
    fieldCopies[name].push(copy)
  })
  const priceUnit = element()
  priceUnit.textContent = '/hr'
  const priceParent = element()
  priceParent.children = [fields.price, priceUnit]
  fields.price.parentElement = priceParent
  const duplicatePayment = element({ 'booking-element-wrap': '' })
  duplicatePayment.textContent = 'Your card ending in 1234 will be charged for this call.'
  duplicatePayment.querySelector = () => null
  groups.push(duplicatePayment)

  const base = element({ 'booking-popup-content': 'base' })
  const confirmation = element({ 'booking-popup-content': 'confirmed' })
  const pendingOne = element({ 'pending-info-text': '' })
  const pendingDuplicate = element({ 'pending-info-text': '' })
  base.querySelectorAll = (selector) =>
    selector === '[pending-info-text]' ? [pendingOne, pendingDuplicate] : []
  const blocked = element({ 'reschedule-blocked-info': '' })
  const close = element({ 'booking-action-btn': 'switch-close' })
  const back = element({ 'booking-action-btn': 'switch-base' })
  const cancel = element({ 'booking-action-btn': 'cancel' })
  const reschedule = element({ 'booking-action-btn': 'reschedule' })
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const confirmPayment = element({ 'payment-action-btn': 'confirm' })
  const changePayment = element({ 'payment-action-btn': 'change-card' })
  const createIntent = element({ 'payment-action-btn': 'create-intent' })
  const addPayment = element({ 'payment-action-btn': 'add-card' })
  const legacyPayment = element({ 'booking-pm-action': 'confirm' })
  const actions = [
    close,
    back,
    cancel,
    reschedule,
    accept,
    confirmPayment,
    changePayment,
    createIntent,
    addPayment,
    legacyPayment,
  ]
  const modal = element({ 'popup-booking-info': '' })
  modal.querySelector = (selector) => {
    const match = selector.match(/^\[booking-element="(.+)"\]$/)
    if (match) return fields[match[1]] || null
    if (selector === '[booking-popup-content="base"]') return base
    return null
  }
  modal.querySelectorAll = (selector) => {
    const match = selector.match(/^\[booking-element="(.+)"\]$/)
    if (match) return fieldCopies[match[1]] || []
    return {
      '[booking-popup-content]': [base, confirmation],
      '[booking-action-btn="switch-base"], [booking-card-action-btn="switch-base"]': [back],
      '[booking-element-wrap]': groups,
      '[booking-action-btn], [booking-card-action-btn], [payment-action-btn], [booking-pm-action], [data-btn-payment], [popup-stripe-card-open], [pm-use-this]': actions,
      '[reschedule-blocked-info]': [blocked],
    }[selector] || []
  }

  return {
    actions,
    base,
    blocked,
    confirmation,
    duplicatePayment,
    fields,
    modal,
    panelCopies,
    pendingDuplicate,
    pendingOne,
    priceUnit,
  }
}

test('Free Call details hide paid copy, duplicate copy, and unsupported actions', (context) => {
  const originalActions = global.StartersDashboardCallActions
  global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
  context.after(function () {
    global.StartersDashboardCallActions = originalActions
  })
  const view = detailModalHarness()
  const booking = {
    booking_id: 'free-one',
    status: 'pending',
    start: 10_000,
    confirmation_expires_at: 9_000,
    paid_meeting: false,
    price: 0,
    duration: 30,
    call_context: 'Discuss launch',
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }

  assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 2_000), true)
  assert.equal(view.fields['paid-meeting'].textContent, 'Free Call')
  assert.equal(view.fields.status.textContent, 'Pending')
  assert.equal(view.fields.price.hidden, true)
  assert.equal(view.fields['payment-status-text'].hidden, true)
  assert.equal(view.duplicatePayment.hidden, true)
  assert.equal(view.base.hidden, false)
  assert.equal(view.confirmation.hidden, true)
  assert.equal(view.pendingOne.hidden, false)
  assert.equal(view.pendingDuplicate.hidden, true)
  assert.equal(view.actions[0].hidden, false)
  // switch-base starts hidden on the base panel; the actions module shows it
  // only after a chain leaves base.
  assert.equal(view.actions[1].hidden, true)
  assert.equal(view.actions[2].hidden, true)
  assert.equal(view.actions[3].hidden, true)
  assert.equal(view.actions[4].hidden, false)

  booking.confirmation_expires_at = 1
  api.populateDetailModal(view.modal, booking, 'starter', 2_000)
  assert.equal(view.pendingOne.hidden, true)
  assert.equal(view.actions[4].hidden, true)
})

test('details fill every authored panel copy of a booking field', () => {
  // The authored cancel/cancelled panels duplicate base-panel fields. Filling
  // only the first match rendered the cancel flow with blank call details
  // (Kaeser QA F3).
  const view = detailModalHarness()
  const booking = {
    booking_id: 'copy-one',
    status: 'confirmed',
    start: 10_000,
    paid_meeting: false,
    duration: 30,
    call_context: 'Discuss launch',
    meeting_link: 'https://meet.example/abc',
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }

  assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 2_000), true)
  assert.equal(view.fields.context.textContent, 'Discuss launch')
  assert.equal(view.panelCopies.context.textContent, 'Discuss launch')
  assert.equal(view.panelCopies.context.hidden, false)
  assert.equal(view.panelCopies['start-date'].textContent, view.fields['start-date'].textContent)
  assert.equal(view.panelCopies['start-date'].hidden, false)
  assert.equal(view.panelCopies['meeting-link'].href, 'https://meet.example/abc')
  assert.equal(view.panelCopies['meeting-link'].hidden, false)

  // A hidden field hides every copy too.
  booking.call_context = ''
  api.populateDetailModal(view.modal, booking, 'starter', 2_000)
  assert.equal(view.fields.context.hidden, true)
  assert.equal(view.panelCopies.context.hidden, true)
})

test('missing panel details and role-correct Message actions are supplied without duplicates', () => {
  const document = { createElement: (tag) => domElement(tag) }
  const modal = domElement('dialog')
  modal.ownerDocument = document
  const base = domElement('div', { 'booking-popup-content': 'base' })
  base.appendChild(domElement('span', { 'booking-element': 'start-date' }))
  const cancelled = domElement('div', { 'booking-popup-content': 'cancelled' })
  const composePanels = [
    'cancel-reason',
    'decline-reason',
    'reschedule',
    'reschedule-calendar',
  ].map((name) => domElement('div', { 'booking-popup-content': name }))
  modal.appendChild(base)
  modal.appendChild(cancelled)
  composePanels.forEach((panel) => modal.appendChild(panel))
  const booking = {
    start: 10_000,
    duration: 30,
    call_context: 'Discuss launch',
    cancelled_reason: 'Schedule changed',
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }

  assert.ok(api.ensureDetailSupplements(modal, booking, 'starter', 'UTC') > 0)
  assert.equal(base.querySelector('[data-starters-call-summary-row="start-date"]'), null)
  assert.ok(cancelled.querySelector('[data-starters-call-summary-row="start-date"]'))
  assert.equal(
    cancelled.querySelector('[data-starters-call-summary-row="cancel-reason"]')
      .children[1].textContent,
    'Schedule changed',
  )
  const starterMessage = cancelled.querySelector('[data-starters-call-message]')
  assert.equal(starterMessage.textContent, 'Message Brand')
  assert.equal(starterMessage.href, '/messages?with=mem_brand')

  const rowGroup = cancelled.querySelector('[data-starters-call-summary-rows]')
  assert.ok(rowGroup)
  assert.equal(rowGroup.style.border, '1px solid #e2e2e2')
  assert.equal(rowGroup.style.overflow, 'hidden')
  assert.ok(rowGroup.children.length > 1)
  assert.equal(rowGroup.children[0].style.padding, '14px 16px')
  assert.equal(rowGroup.children[0].style.borderBottom, '1px solid #e2e2e2')
  assert.equal(rowGroup.children[rowGroup.children.length - 1].style.borderBottom, '0')

  const messageActions = cancelled.querySelector('[data-starters-call-summary-actions]')
  assert.ok(messageActions)
  assert.equal(messageActions.style.justifyContent, 'flex-end')
  assert.equal(starterMessage.parentNode, messageActions)
  assert.equal(starterMessage.style.display, 'inline-flex')
  assert.equal(starterMessage.style.backgroundColor, '#1f231f')
  assert.equal(starterMessage.style.color, '#ffffff')
  assert.equal(starterMessage.style.textDecoration, 'none')

  const supplement = cancelled.querySelector('[data-starters-call-summary]')
  assert.equal(supplement.hidden, false)
  assert.equal(supplement.style.display, 'flex')
  assert.equal(supplement.style.gap, '16px')

  // Compose steps keep their form controls unaccompanied.
  composePanels.forEach((panel) => {
    assert.equal(panel.querySelector('[data-starters-call-summary]'), null)
    assert.equal(panel.querySelector('[data-starters-call-message]'), null)
  })

  api.ensureDetailSupplements(modal, booking, 'brand', 'UTC')
  assert.equal(cancelled.querySelectorAll('[data-starters-call-summary]').length, 1)
  const brandMessage = cancelled.querySelector('[data-starters-call-message]')
  assert.equal(brandMessage.textContent, 'Message Starter')
  assert.equal(brandMessage.href, '/messages?with=mem_starter')
  assert.equal(
    cancelled.querySelectorAll('[data-starters-call-summary-rows]').length,
    1,
  )
  assert.equal(
    cancelled.querySelectorAll('[data-starters-call-summary-actions]').length,
    1,
  )

  // An identity reset leaves no counterpart ID behind in the modal.
  const originalDocument = global.document
  const originalActions = global.StartersDashboardCallActions
  try {
    global.StartersDashboardCallActions = undefined
    global.document = { querySelector: () => modal }
    api.resetDetailModal()
    assert.equal(modal.querySelector('[data-starters-call-message]'), null)
    assert.equal(modal.querySelectorAll('[data-starters-call-summary-row]').length, 0)
    assert.equal(cancelled.querySelector('[data-starters-call-summary]').hidden, true)
  } finally {
    global.document = originalDocument
    global.StartersDashboardCallActions = originalActions
  }
})

test('an authored field inside a CSS-hidden wrapper still receives a visible supplement', () => {
  const originalGetComputedStyle = global.getComputedStyle
  const group = { hidden: false, style: {} }
  const field = {
    hidden: false,
    style: {},
    closest(selector) {
      return selector === '[booking-element-wrap]' ? group : null
    },
  }
  const panel = {
    querySelectorAll(selector) {
      return selector === '[booking-element="start-date"]' ? [field] : []
    },
  }
  try {
    global.getComputedStyle = (node) => ({ display: node === group ? 'none' : 'block' })
    assert.equal(api.panelHasUsableField(panel, 'start-date'), false)

    global.getComputedStyle = () => ({ display: 'block' })
    assert.equal(api.panelHasUsableField(panel, 'start-date'), true)
  } finally {
    global.getComputedStyle = originalGetComputedStyle
  }
})

test('a hook with no rendered geometry is not authoritative in the active panel', () => {
  const originalGetComputedStyle = global.getComputedStyle
  const field = {
    hidden: false,
    style: {},
    closest() { return null },
    getClientRects() { return [] },
  }
  let panelBoxes = [{ width: 320, height: 200 }]
  const panel = {
    hidden: false,
    getClientRects() { return panelBoxes },
    querySelectorAll(selector) {
      return selector === '[booking-element="brand-name"]' ? [field] : []
    },
  }
  try {
    global.getComputedStyle = (node) => ({ display: node === panel ? 'flex' : 'inline' })
    assert.equal(api.panelHasUsableField(panel, 'brand-name'), false)

    // A panel inside a closed dialog generates no box of its own, so geometry
    // says nothing about its hooks and the authored display contract rules.
    panelBoxes = []
    assert.equal(api.panelHasUsableField(panel, 'brand-name'), true)
  } finally {
    global.getComputedStyle = originalGetComputedStyle
  }
})

function geometryDetailModal() {
  const document = { createElement: (tag) => domElement(tag) }
  const modal = domElement('dialog', { 'popup-booking-info': '' })
  modal.ownerDocument = document
  const base = domElement('div', { 'booking-popup-content': 'base' })
  const hooks = {
    'brand-name': domElement('span', { 'booking-element': 'brand-name' }),
    'start-date': domElement('span', { 'booking-element': 'start-date' }),
    duration: domElement('span', { 'booking-element': 'duration' }),
  }
  Object.keys(hooks).forEach((name) => base.appendChild(hooks[name]))
  modal.appendChild(base)
  // Mirrors the live dialog: nothing inside a closed `dialog` generates a box,
  // and once it opens the counterpart name hook still renders none of its own.
  const state = { open: false, boxless: [hooks['brand-name']] }
  const box = [{ width: 120, height: 18 }]
  ;[modal, base].concat(Object.keys(hooks).map((name) => hooks[name])).forEach((node) => {
    node.getClientRects = () =>
      state.open && state.boxless.indexOf(node) === -1 ? box : []
  })
  return { base, hooks, modal, state }
}

test('a detail modal populated before its dialog opens keeps every authored hook authoritative', () => {
  const originalActions = global.StartersDashboardCallActions
  const originalGetComputedStyle = global.getComputedStyle
  const originalFrame = global.requestAnimationFrame
  const frames = []
  const view = geometryDetailModal()
  const booking = {
    booking_id: 'geometry-one',
    status: 'confirmed',
    start: 4_000_000_000_000,
    duration: 30,
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }
  try {
    global.StartersDashboardCallActions = undefined
    global.getComputedStyle = () => ({ display: 'block' })
    global.requestAnimationFrame = (callback) => frames.push(callback)

    // The View Details binding runs while the dialog is still closed.
    assert.equal(api.populateDetailModal(view.modal, booking, 'starter'), true)
    assert.equal(view.base.querySelectorAll('[data-starters-call-summary-row]').length, 0)
    assert.equal(view.hooks['brand-name'].textContent, 'Northwind')
    assert.equal(frames.length, 1)

    // Once the dialog is open, only the box-less hook loses authority.
    view.state.open = true
    frames[0]()
    const row = view.base.querySelector('[data-starters-call-summary-row="brand-name"]')
    assert.ok(row, 'a geometry-hidden hook must yield a module-owned row')
    assert.equal(row.children[1].textContent, 'Northwind')
    assert.equal(view.base.querySelectorAll('[data-starters-call-summary-row]').length, 1)

    // A frame landing after the modal was rebound to another call is ignored.
    view.state.boxless = [view.hooks['start-date']]
    view.modal.setAttribute('data-booking-id', 'geometry-two')
    frames[0]()
    assert.ok(view.base.querySelector('[data-starters-call-summary-row="brand-name"]'))
    assert.equal(
      view.base.querySelector('[data-starters-call-summary-row="start-date"]'),
      null,
    )
  } finally {
    global.StartersDashboardCallActions = originalActions
    global.getComputedStyle = originalGetComputedStyle
    global.requestAnimationFrame = originalFrame
  }
})

test('a hook inside a CSS-hidden wrapper yields a supplement row while a visible one stays authoritative', () => {
  function buildModal() {
    const document = { createElement: (tag) => domElement(tag) }
    const modal = domElement('dialog')
    modal.ownerDocument = document
    const base = domElement('div', { 'booking-popup-content': 'base' })
    const wrap = domElement('div', { 'booking-element-wrap': '' })
    wrap.appendChild(domElement('span', { 'booking-element': 'start-date' }))
    base.appendChild(wrap)
    base.appendChild(domElement('span', { 'booking-element': 'duration' }))
    modal.appendChild(base)
    return { modal, base, wrap }
  }

  const booking = {
    start: 10_000,
    duration: 30,
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }
  const expected = api
    .detailSupplementRows(booking, 'starter', 'UTC')
    .find((row) => row.field === 'start-date')
  assert.ok(expected && expected.value)

  const originalGetComputedStyle = global.getComputedStyle
  try {
    const hidden = buildModal()
    global.getComputedStyle = (node) => ({
      display: node === hidden.wrap ? 'none' : 'block',
    })
    api.ensureDetailSupplements(hidden.modal, booking, 'starter', 'UTC')
    const row = hidden.base.querySelector('[data-starters-call-summary-row="start-date"]')
    assert.ok(row, 'a hook inside a hidden wrapper must not suppress the module-owned row')
    assert.equal(row.children[1].textContent, expected.value)
    assert.equal(
      hidden.base.querySelector('[data-starters-call-summary-row="duration"]'),
      null,
    )

    const shown = buildModal()
    global.getComputedStyle = () => ({ display: 'block' })
    api.ensureDetailSupplements(shown.modal, booking, 'starter', 'UTC')
    assert.equal(
      shown.base.querySelector('[data-starters-call-summary-row="start-date"]'),
      null,
    )
  } finally {
    global.getComputedStyle = originalGetComputedStyle
  }
})

test('confirmed Paid Call details show per-call price and hide every unsupported payment control', () => {
  const view = detailModalHarness()
  const booking = {
    booking_id: 'paid-one',
    status: 'confirmed',
    start: Date.now() + 60_000,
    paid_meeting: true,
    price: 25,
    duration: 30,
    pm_confirmed: true,
    meeting_link: 'https://meet.example/current',
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }

  api.populateDetailModal(view.modal, booking, 'brand')
  assert.equal(view.fields['paid-meeting'].textContent, 'Paid Call')
  assert.equal(view.fields.status.textContent, 'Upcoming')
  assert.equal(view.fields.price.textContent, '$25.00')
  assert.equal(view.priceUnit.textContent, '/Call')
  assert.equal(view.fields.price.hidden, false)
  assert.equal(view.fields['payment-status-text'].textContent, 'Payment method confirmed.')
  assert.equal(view.fields['payment-status-text'].hidden, false)
  assert.equal(view.fields['meeting-link'].href, 'https://meet.example/current')
  assert.equal(view.pendingOne.hidden, true)
  assert.equal(view.pendingDuplicate.hidden, true)
  assert.equal(view.actions[4].hidden, true)
  for (const action of view.actions.slice(5)) {
    assert.equal(action.hidden, true)
    assert.equal(action.style.display, 'none')
  }

  api.populateDetailModal(view.modal, booking, 'brand')
  assert.equal(view.fields.price.textContent, '$25.00')
  assert.equal(view.priceUnit.textContent, '/Call')

  booking.status = 'cancelled'
  api.populateDetailModal(view.modal, booking, 'brand')
  assert.equal(view.fields.status.textContent, 'Cancelled')
  assert.equal(view.fields['payment-status-text'].hidden, true)
  assert.equal(view.fields['meeting-link'].hidden, true)
})

test('detail modal lifecycle clears module-owned action errors', () => {
  const originalActions = global.StartersDashboardCallActions
  const originalDocument = global.document
  const view = detailModalHarness()
  const cleared = []
  const resets = []
  const booking = {
    booking_id: 'new-booking',
    status: 'confirmed',
    start: Date.now() + 60_000,
    paid_meeting: false,
    duration: 30,
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }
  try {
    view.modal.setAttribute('data-booking-id', 'old-booking')
    global.StartersDashboardCallActions = {
      wire() {},
      resetRescheduleState(modal) {
        resets.push(modal)
      },
      showActionError(modal, message) {
        cleared.push({ modal, message })
      },
    }
    global.document = {
      querySelector() {
        return view.modal
      },
    }

    api.populateDetailModal(view.modal, booking, 'brand')
    assert.equal(resets.length, 1)
    assert.deepEqual(cleared, [{ modal: view.modal, message: '' }])

    api.populateDetailModal(view.modal, booking, 'brand')
    assert.equal(resets.length, 1)
    assert.equal(cleared.length, 1)

    api.resetDetailModal()
    assert.equal(resets.length, 2)
    assert.deepEqual(cleared[1], { modal: view.modal, message: '' })
  } finally {
    global.StartersDashboardCallActions = originalActions
    global.document = originalDocument
  }
})

test('delegated View Details binds the selected canonical booking before Webflow opens', () => {
  let clickListener
  const originalDocument = global.document
  const view = detailModalHarness()
  const booking = {
    booking_id: 'selected-paid',
    status: 'confirmed',
    start: Date.now() + 60_000,
    is_paid: true,
    paid_meeting: false,
    price: 45,
    duration: 45,
    brand_data: { name: 'Selected Brand', timezone: 'UTC' },
    starter_data: { name: 'Selected Starter', timezone: 'UTC' },
  }
  const card = {
    getAttribute(name) {
      return name === 'data-booking-id' ? 'selected-paid' : null
    },
  }
  const details = {
    closest(selector) {
      return selector === '[data-booking-id]' ? card : null
    },
  }
  try {
    global.document = {
      addEventListener(name, listener, capture) {
        assert.equal(name, 'click')
        assert.equal(capture, true)
        clickListener = listener
      },
      querySelector(selector) {
        assert.equal(
          selector,
          '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]',
        )
        return view.modal
      },
    }
    api.wireBookingDetails([{ rows: [booking] }], 'brand')
    clickListener({
      target: {
        closest(selector) {
          if (selector.includes('reschedule')) return null
          if (selector.includes('popup-booking-info')) return details
          return null
        },
      },
    })

    assert.equal(view.modal.attributes['data-booking-id'], 'selected-paid')
    assert.equal(view.fields['paid-meeting'].textContent, 'Paid Call')
    assert.equal(view.fields.price.textContent, '$45.00')
    assert.equal(view.priceUnit.textContent, '/Call')
    assert.equal(view.fields['starter-name'].textContent, 'Selected Starter')
  } finally {
    global.document = originalDocument
  }
})

test('delegated Reschedule is stopped when the actions module cannot own it', () => {
  let clickListener
  const originalDocument = global.document
  const originalActions = global.StartersDashboardCallActions
  try {
    global.document = {
      addEventListener(name, listener, capture) {
        assert.equal(name, 'click')
        assert.equal(capture, true)
        clickListener = listener
      },
    }
    delete global.StartersDashboardCallActions
    api.wireBookingDetails([], 'brand')
    let prevented = 0
    let stopped = 0
    clickListener({
      target: {
        closest(selector) {
          return selector.includes('reschedule') ? {} : null
        },
      },
      preventDefault() { prevented += 1 },
      stopImmediatePropagation() { stopped += 1 },
    })
    assert.equal(prevented, 1)
    assert.equal(stopped, 1)
  } finally {
    global.document = originalDocument
    global.StartersDashboardCallActions = originalActions
  }
})

test('an eligible Reschedule click is handed to the actions module untouched', () => {
  let clickListener
  const originalDocument = global.document
  const originalActions = global.StartersDashboardCallActions
  try {
    global.document = {
      addEventListener(name, listener, capture) {
        assert.equal(name, 'click')
        assert.equal(capture, true)
        clickListener = listener
      },
    }
    const booking = { booking_id: 'booking-9', status: 'confirmed' }
    const eligibilityCalls = []
    global.StartersDashboardCallActions = {
      wire() {},
      canProposeReschedule(role, candidate, now) {
        eligibilityCalls.push({ role, candidate, now })
        return true
      },
    }
    const card = {
      getAttribute(name) {
        return name === 'data-booking-id' ? 'booking-9' : null
      },
    }
    const button = {
      closest(selector) {
        return selector === '[data-booking-id]' ? card : null
      },
    }
    api.wireBookingDetails([{ rows: [booking] }], 'starter')
    let prevented = 0
    let stopped = 0
    clickListener({
      target: {
        closest(selector) {
          return selector.includes('reschedule') ? button : null
        },
      },
      preventDefault() { prevented += 1 },
      stopImmediatePropagation() { stopped += 1 },
    })
    assert.equal(prevented, 0)
    assert.equal(stopped, 0)
    assert.equal(eligibilityCalls.length, 1)
    assert.equal(eligibilityCalls[0].role, 'starter')
    assert.equal(eligibilityCalls[0].candidate, booking)

    // An ineligible booking still swallows the click.
    global.StartersDashboardCallActions.canProposeReschedule = () => false
    clickListener({
      target: {
        closest(selector) {
          return selector.includes('reschedule') ? button : null
        },
      },
      preventDefault() { prevented += 1 },
      stopImmediatePropagation() { stopped += 1 },
    })
    assert.equal(prevented, 1)
    assert.equal(stopped, 1)
  } finally {
    global.document = originalDocument
    global.StartersDashboardCallActions = originalActions
  }
})

test('accepted calls keep every legacy action hidden even with a meeting link', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const actions = [
    element({ 'booking-action-btn': 'switch-confirm' }),
    element({ 'booking-action-btn': 'switch-decline' }),
    element({ 'booking-action-btn': 'reschedule' }),
    element({ 'booking-action-btn': 'message' }),
    element({ 'booking-action-btn': 'join' }),
  ]
  const renderedCards = []
  const card = element({ 'bookings-item-template': 'calls' })
  card.cloneNode = () => card
  card.querySelectorAll = (selector) =>
    selector === '[booking-card-action-btn], [booking-action-btn]' ? actions : []
  const list = element()
  list.appendChild = (rendered) => renderedCards.push(rendered)
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [card] : []
  const template = element({ 'bookings-item-template': 'calls' })
  template.cloneNode = () => card
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': element(),
      '[bookings-empty="calls"]': element(),
    })[selector] || null
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    querySelector() {
      return null
    },
    querySelectorAll(selector) {
      return selector === '[bookings-section]' ? [section] : []
    },
  }
  const window = {
    $memberstackDom: {
      async getCurrentMember() {
        return { id: 'starter-1' }
      },
      onAuthChange() {},
    },
    document,
    location: { pathname: '/starter-dashboard' },
    xanoAuthFetch: async () => ({
      ok: true,
      json: async () => [{
        booking_id: 'confirmed-call',
        starter_data: { memberstack_id: 'starter-1' },
        status: 'confirmed',
        meeting_link: 'https://meet.example/canonical',
      }],
    }),
  }

  vm.runInNewContext(source, { console: { error() {} }, document, Intl, window })
  await until(() => root.attributes['data-dashboard-calls-v3'] === 'ready')

  assert.equal(renderedCards.length, 1)
  for (const action of actions) {
    assert.equal(action.hidden, true)
    assert.equal(action.style.display, 'none')
  }
})

test('canonical V3 component loader includes the dashboard controller', () => {
  const loader = fs.readFileSync(
    require.resolve('./scheduling-v3-stage-component.html'),
    'utf8',
  )
  assert.match(loader, /v3\/dashboard-calls\.js/)
})

test('auth changes clear identity state and stale requests cannot render', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const firstResponse = deferred()
  const requests = []
  let authChange
  let currentMember = {
    id: 'member-a',
    customFields: { 'free-user': 'Member A', company: 'Company A' },
  }
  const name = element()
  const surname = element()
  const company = element()
  const image = element({ 'hero-element': 'brand-image', srcset: 'placeholder.jpg 1x' })
  const list = element()
  const template = element({ 'bookings-item-template': 'calls' })
  const loader = element()
  const empty = element()
  const count = element()
  const filters = element()
  const modalField = element({ 'booking-element': 'starter-name' })
  const modalGroup = element({ 'booking-element-wrap': '' })
  modalField.closest = (selector) => selector === '[booking-element-wrap]' ? modalGroup : null
  const modalAction = element({ 'booking-action-btn': 'switch-close' })
  const modalPaymentAction = element({ 'payment-action-btn': 'confirm' })
  const modal = element({
    'popup-booking-info': '',
    open: '',
    'data-booking-id': 'member-a-call',
    'data-booking-status': 'confirmed',
    'data-booking-payment': 'paid',
  })
  let modalCloseCount = 0
  modal.close = () => { modalCloseCount += 1 }
  modal.querySelectorAll = (selector) => ({
    '[booking-element]': [modalField],
    '[booking-popup-content], [pending-info-text], [booking-action-btn], [booking-card-action-btn], [payment-action-btn], [booking-pm-action], [data-btn-payment], [popup-stripe-card-open], [pm-use-this]': [modalAction, modalPaymentAction],
  })[selector] || []
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': loader,
      '[bookings-empty="calls"]': empty,
      '[bookings-count]': count,
      '.tabs-button_component.is-dashboard': filters,
    })[selector] || null
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  template.cloneNode = () => element()
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    querySelector(selector) {
      return (
        {
          '[hero-element="brand-first-name"]': name,
          '[hero-element="brand-last-name"]': surname,
          '[hero-element="brand-company"]': company,
          '[hero-element="brand-image"]': image,
          '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]': modal,
        }[selector] || null
      )
    },
    querySelectorAll(selector) {
      if (selector === '[bookings-section]') return [section]
      return []
    },
  }
  const memberstack = {
    async getCurrentMember() {
      return currentMember
    },
    onAuthChange(listener) {
      authChange = listener
    },
  }
  const window = {
    $memberstackDom: memberstack,
    clearInterval,
    document,
    location: { pathname: '/brand-dashboard' },
    setInterval,
    xanoAuthFetch: async (_url, init) => {
      requests.push(JSON.parse(init.body).memberstack_id)
      if (requests.length === 1) return firstResponse.promise
      return {
        ok: true,
        json: async () => [
          {
            booking_id: 'member-b-call',
            brand_data: { memberstack_id: 'member-b' },
            status: 'confirmed',
          },
        ],
      }
    },
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    document,
    Intl,
    setInterval,
    window,
  })
  await until(() => requests.length === 1)

  modal.setAttribute('open', '')
  modal.setAttribute('data-booking-id', 'member-a-call')
  modal.setAttribute('data-booking-status', 'confirmed')
  modal.setAttribute('data-booking-payment', 'paid')
  modalField.textContent = 'Member A'
  modalField.hidden = false
  modalField.style.display = ''
  modalAction.hidden = false
  modalAction.style.display = ''
  modalPaymentAction.hidden = false
  modalPaymentAction.style.display = ''
  const closesBeforeAuthChange = modalCloseCount

  currentMember = {
    id: 'member-b',
    customFields: { 'free-user': 'Member B', company: 'Company B' },
    profileImage: 'https://cdn.example/member-b.jpg',
  }
  authChange()
  assert.equal(name.textContent, '')
  assert.equal(company.textContent, '')
  assert.equal(modalCloseCount, closesBeforeAuthChange + 1)
  assert.equal(modal.hasAttribute('open'), false)
  assert.equal(modal.hasAttribute('data-booking-id'), false)
  assert.equal(modal.hasAttribute('data-booking-status'), false)
  assert.equal(modal.hasAttribute('data-booking-payment'), false)
  assert.equal(modalField.textContent, '')
  assert.equal(modalField.hidden, true)
  assert.equal(modalGroup.hidden, true)
  assert.equal(modalAction.hidden, true)
  assert.equal(modalPaymentAction.hidden, true)
  await until(() => requests.length === 2 && root.attributes['data-dashboard-calls-v3'] === 'ready')
  assert.deepEqual(requests, ['member-a', 'member-b'])
  assert.equal(name.textContent, 'Member B')
  assert.equal(company.textContent, 'Company B')
  assert.equal(image.attributes.src, undefined)
  assert.equal(image.attributes.srcset, 'placeholder.jpg 1x')
  assert.equal(filters.hidden, false)

  firstResponse.resolve({ ok: true, json: async () => [] })
  await new Promise(setImmediate)
  assert.equal(name.textContent, 'Member B')

  currentMember = null
  authChange()
  assert.equal(name.textContent, '')
  assert.equal(company.textContent, '')
  assert.equal(filters.hidden, true)
  await until(() => root.attributes['data-dashboard-calls-v3'] === 'error')
})

test('native Brand profile saves repaint the hero only after canonical Memberstack readback', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const profileListeners = {}
  const profileFields = {
    'free-user': { value: 'Old First' },
    'last-name': { value: 'Old Last' },
    company: { value: 'Old Company' },
  }
  const profileForm = element({ 'data-ms-form': 'profile' })
  profileForm.querySelector = (selector) => {
    const match = selector.match(/^\[data-ms-member="(.+)"\]$/)
    return match ? profileFields[match[1]] || null : null
  }
  profileForm.addEventListener = (name, listener) => {
    profileListeners[name] = listener
  }

  const name = element()
  const surname = element()
  const company = element()
  const list = element()
  const template = element({ 'bookings-item-template': 'calls' })
  const loader = element()
  const empty = element()
  const count = element()
  const filters = element()
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': loader,
      '[bookings-empty="calls"]': empty,
      '[bookings-count]': count,
      '.tabs-button_component.is-dashboard': filters,
    })[selector] || null
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  template.cloneNode = () => element()

  let memberReads = 0
  let authChange
  let pendingMemberRead
  const oldMember = {
    id: 'brand-1',
    customFields: {
      'free-user': 'Old First',
      'last-name': 'Old Last',
      company: 'Old Company',
    },
  }
  const newMember = {
    id: 'brand-1',
    customFields: {
      'free-user': 'New First',
      'last-name': 'New Last',
      company: 'New Company',
    },
  }
  let currentMember = oldMember
  const memberstack = {
    async getCurrentMember() {
      memberReads += 1
      if (pendingMemberRead) {
        const read = pendingMemberRead
        pendingMemberRead = null
        return read.promise
      }
      return currentMember
    },
    onAuthChange(listener) {
      authChange = listener
    },
  }
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    querySelector(selector) {
      return (
        {
          '[hero-element="brand-first-name"]': name,
          '[hero-element="brand-last-name"]': surname,
          '[hero-element="brand-company"]': company,
          '[hero-element="brand-image"]': null,
        }[selector] || null
      )
    },
    querySelectorAll(selector) {
      if (selector === '[bookings-section]') return [section]
      if (selector === 'form[data-ms-form="profile"]') return [profileForm]
      return []
    },
  }
  const window = {
    $memberstackDom: memberstack,
    clearInterval,
    document,
    location: { pathname: '/brand-dashboard' },
    setInterval,
    setTimeout: (listener) => setImmediate(listener),
    xanoAuthFetch: async () => ({ ok: true, json: async () => [] }),
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    document,
    Intl,
    setInterval,
    window,
  })
  await until(() => root.attributes['data-dashboard-calls-v3'] === 'ready')
  assert.equal(name.textContent, 'Old First')
  assert.equal(surname.textContent, 'Old Last')
  assert.equal(company.textContent, 'Old Company')

  profileFields['free-user'].value = ' New First '
  profileFields['last-name'].value = ' New Last '
  profileFields.company.value = ' New Company '
  let prevented = false
  profileListeners.submit({
    preventDefault() {
      prevented = true
    },
  })
  await until(() => memberReads >= 3)
  assert.equal(prevented, false)
  assert.equal(name.textContent, 'Old First')

  currentMember = newMember
  await until(() => name.textContent === 'New First')
  assert.equal(surname.textContent, 'New Last')
  assert.equal(company.textContent, 'New Company')

  profileFields['free-user'].value = 'Stale First'
  profileFields['last-name'].value = 'Stale Last'
  profileFields.company.value = 'Stale Company'
  const staleRead = deferred()
  pendingMemberRead = staleRead
  profileListeners.submit({})
  await until(() => pendingMemberRead === null)

  currentMember = {
    id: 'brand-2',
    customFields: {
      'free-user': 'Current First',
      'last-name': 'Current Last',
      company: 'Current Company',
    },
  }
  authChange()
  await until(() => name.textContent === 'Current First')

  staleRead.resolve({
    id: 'brand-1',
    customFields: {
      'free-user': 'Stale First',
      'last-name': 'Stale Last',
      company: 'Stale Company',
    },
  })
  await new Promise(setImmediate)
  assert.equal(name.textContent, 'Current First')
  assert.equal(surname.textContent, 'Current Last')
  assert.equal(company.textContent, 'Current Company')
})

test('fails closed when the authenticated participant identity is absent or mismatched', () => {
  const booking = {
    starter_data: { memberstack_id: 'starter-1' },
    brand_data: { memberstack_id: 'brand-1' },
  }
  assert.equal(api.memberOwnsBooking(booking, 'starter-1', 'starter'), true)
  assert.equal(api.memberOwnsBooking(booking, 'brand-1', 'brand'), true)
  assert.equal(api.memberOwnsBooking(booking, 'brand-1', 'starter'), false)
  assert.equal(api.memberOwnsBooking(booking, '', 'brand'), false)
})

test('deduplicates canonical booking IDs and sorts newest call first', () => {
  const rows = api.uniqueBookings([
    { booking_id: 'old', start: 100 },
    { booking_id: 'new', start: 300 },
    { booking_id: 'old', start: 200 },
    { start: 400 },
  ])
  assert.deepEqual(rows.map((row) => row.booking_id), ['new', 'old'])
})

test('Starter separates pending requests from calls while Brand keeps one call list', () => {
  const rows = [
    { booking_id: 'pending', status: 'pending', start: 300 },
    { booking_id: 'active', status: 'confirmed', start: 200, end: Date.now() + 10_000 },
    { booking_id: 'cancelled', status: 'cancelled', start: 100 },
  ]
  assert.deepEqual(
    api.sectionBookings(rows, 'starter', 'requests').map((row) => row.booking_id),
    ['pending'],
  )
  assert.deepEqual(
    api.sectionBookings(rows, 'starter', 'calls').map((row) => row.booking_id),
    ['active', 'cancelled'],
  )
  assert.equal(api.sectionBookings(rows, 'brand', 'calls').length, 3)
})

test('call filters remain visible when the selected status alone has no matches', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const listeners = {}
  const allFilter = element({ 'booking-filter': 'all' })
  const completedFilter = element({ 'booking-filter': 'completed' })
  allFilter.addEventListener = (name, listener) => {
    listeners.all = listener
  }
  completedFilter.addEventListener = (name, listener) => {
    listeners.completed = listener
  }
  const list = element()
  const renderedCards = []
  list.appendChild = (card) => renderedCards.push(card)
  const template = element({ 'bookings-item-template': 'calls' })
  template.cloneNode = () => element()
  const loader = element()
  const empty = element()
  const filters = element()
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': loader,
      '[bookings-empty="calls"]': empty,
      '.tabs-button_component.is-dashboard': filters,
    })[selector] || null
  section.querySelectorAll = (selector) =>
    selector === '[booking-filter]' ? [allFilter, completedFilter] : []
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    querySelector() {
      return null
    },
    querySelectorAll(selector) {
      return selector === '[bookings-section]' ? [section] : []
    },
  }
  const window = {
    $memberstackDom: {
      async getCurrentMember() {
        return { id: 'brand-1', customFields: {} }
      },
      onAuthChange() {},
    },
    document,
    location: { pathname: '/brand-dashboard' },
    xanoAuthFetch: async () => ({
      ok: true,
      json: async () => [
        {
          booking_id: 'confirmed-call',
          brand_data: { memberstack_id: 'brand-1' },
          status: 'confirmed',
        },
      ],
    }),
  }

  vm.runInNewContext(source, { console: { error() {} }, document, Intl, window })
  await until(() => root.attributes['data-dashboard-calls-v3'] === 'ready')
  assert.equal(filters.hidden, false)
  assert.equal(renderedCards.length, 1)
  assert.equal(allFilter.classList.contains('is-active'), true)
  assert.equal(allFilter.attributes['aria-pressed'], 'true')
  assert.equal(completedFilter.classList.contains('is-active'), false)

  listeners.completed({ preventDefault() {} })
  assert.equal(renderedCards.length, 1)
  assert.equal(list.hidden, true)
  assert.equal(empty.hidden, false)
  assert.equal(filters.hidden, false)
  assert.equal(allFilter.classList.contains('is-active'), false)
  assert.equal(allFilter.attributes['aria-pressed'], 'false')
  assert.equal(completedFilter.classList.contains('is-active'), true)
  assert.equal(completedFilter.attributes['aria-pressed'], 'true')
})

test('project filters hide only after an authoritative unfiltered empty result', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      { status: 'success', data: { total: 0 }, query: { params: {} } },
      memory,
    ),
    false,
  )
  assert.deepEqual(memory, { known: true, hasAny: false })
})

test('project filters remain usable when only the selected filter is empty', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: 2 },
        query: { params: { status: '*' } },
      },
      memory,
    ),
    true,
  )
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: 0 },
        query: { params: { status: 'completed' } },
      },
      memory,
    ),
    true,
  )
})

test('project filters stay visible while a known project list changes filters', () => {
  const memory = { known: true, hasAny: true }
  assert.equal(api.projectFilterVisible({ status: 'loading' }, memory), true)
  assert.equal(api.projectFilterVisible({ status: 'error' }, memory), true)
  assert.equal(api.projectFilterVisible({}, memory), true)
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: null },
        query: { params: { status: 'active' } },
      },
      memory,
    ),
    true,
  )
})

test('an active project filter remains usable before the full list is known', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      { status: 'loading', query: { params: { status: 'incomplete' } } },
      memory,
    ),
    true,
  )
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: 0 },
        query: { params: { status: 'active' } },
      },
      memory,
    ),
    true,
  )
  assert.deepEqual(memory, {
    known: false,
    hasAny: false,
    navigationVisible: true,
  })
  assert.equal(
    api.projectFilterVisible(
      { status: 'loading', query: { params: {} } },
      memory,
    ),
    true,
  )
  assert.equal(
    api.projectFilterVisible(
      { status: 'error', query: { params: {} } },
      memory,
    ),
    true,
  )
})

test('an unresolved unfiltered project list stays hidden', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      { status: 'loading', query: { params: {} } },
      memory,
    ),
    false,
  )
  assert.equal(
    api.projectFilterVisible(
      { status: 'error', query: { params: {} } },
      memory,
    ),
    false,
  )
})

test('project filters hide synchronously before wf-xano is available', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const filters = element()
  const project = element({ 'wf-xano-instance': 'dash-projects' })
  project.querySelector = (selector) =>
    selector === '.tabs-button_component.is-dashboard' ? filters : null
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[wf-xano-instance="dash-projects"]') return [project]
      return []
    },
  }
  const window = {
    document,
    location: { pathname: '/starter-dashboard' },
  }

  vm.runInNewContext(source, { document, Intl, window })

  assert.equal(filters.hidden, true)
  assert.equal(filters.style.display, 'none')
  assert.equal(window.WfXano.length, 1)
})

test('an empty selected filter stays visible without issuing a hidden All probe', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const filters = element()
  const project = element({ 'wf-xano-instance': 'dash-projects' })
  project.querySelector = (selector) =>
    selector === '.tabs-button_component.is-dashboard' ? filters : null
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[wf-xano-instance="dash-projects"]') return [project]
      return []
    },
  }
  const window = {
    document,
    location: { pathname: '/starter-dashboard' },
  }
  let state = {
    status: 'success',
    data: { total: 0 },
    query: { params: { status: 'active' } },
  }
  const params = []
  let subscriber
  const instance = {
    qa: () => [filters],
    root: project,
    on() {},
    setParam(field, value) {
      params.push([field, value])
    },
    subscribe(selector, handler) {
      subscriber = (next) => handler(selector(next))
      subscriber(state)
    },
  }

  vm.runInNewContext(source, { document, Intl, window })
  window.WfXano[0]({ get: (key) => (key === 'dash-projects' ? instance : null) })
  assert.deepEqual(params, [])
  assert.equal(filters.hidden, false)

  subscriber({
    status: 'loading',
    data: { total: 0 },
    query: { params: {} },
  })
  assert.equal(filters.hidden, false)

  subscriber({
    status: 'error',
    data: { total: 0 },
    query: { params: {} },
  })
  assert.equal(filters.hidden, false)
})

test('project navigation stays hidden until the remote auth reload resolves', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const filters = element()
  const project = element({ 'wf-xano-instance': 'dash-projects' })
  project.querySelector = (selector) =>
    selector === '.tabs-button_component.is-dashboard' ? filters : null
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[wf-xano-instance="dash-projects"]') return [project]
      return []
    },
  }
  const window = {
    document,
    location: { pathname: '/starter-dashboard' },
  }
  let stateChange
  let subscriber
  const instance = {
    qa: () => [filters],
    root: project,
    on(name, handler) {
      if (name === 'stateChange') stateChange = handler
    },
    subscribe(selector, handler) {
      subscriber = (state) => handler(selector(state))
      subscriber({
        status: 'success',
        data: {
          total: 2,
          items: [
            { id: 1, status: 'pending' },
            { id: 2, status: 'completed' },
          ],
        },
        query: { params: {} },
      })
    },
  }

  vm.runInNewContext(source, { document, Intl, window })
  window.WfXano[0]({ get: (key) => (key === 'dash-projects' ? instance : null) })
  assert.equal(filters.hidden, false)

  stateChange({ reason: 'auth:change' })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'loading',
    data: { total: 1 },
    query: { params: { status: 'active' } },
  })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'error',
    data: { total: 1 },
    query: { params: { status: 'active' } },
  })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'success',
    data: {},
    query: { params: { status: 'active' } },
  })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'success',
    data: { total: 0 },
    query: { params: { status: 'pending' } },
  })
  assert.equal(filters.hidden, false)
})

test('both current project wrappers are configured for 12-item append pagination', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const roots = ['dash-projects', 'dash-brand-projects'].map((key) =>
    element({
      'wf-xano-instance': key,
      'wf-xano-source': `opp30:${key === 'dash-projects' ? 'starter' : 'brand'}/projects/mine`,
    }),
  )
  const document = {
    addEventListener() {},
    readyState: 'loading',
    querySelectorAll(selector) {
      const match = /^\[wf-xano-instance="([^"]+)"\]\[wf-xano-source\]$/.exec(selector)
      return match ? roots.filter((root) => root.getAttribute('wf-xano-instance') === match[1]) : []
    },
  }
  const window = { document, location: { pathname: '/starter-dashboard' } }

  vm.runInNewContext(source, { document, Intl, window })

  roots.forEach((root) => {
    assert.equal(root.getAttribute('wf-xano-load'), 'more')
    assert.equal(root.getAttribute('wf-xano-per-page'), '12')
  })
})

test('project Show more loads the next server page and hides after the final page', () => {
  const label = element()
  label.textContent = 'Show more'
  const control = element()
  let listeners = 0
  let disabledClass = false
  control.classList.toggle = (name, force) => {
    if (name === 'is-disabled') disabledClass = force
  }
  let click
  control.addEventListener = (name, handler) => {
    listeners += 1
    if (name === 'click') click = handler
  }
  control.closest = () => null
  control.querySelector = (selector) =>
    selector === '.button_main-text' ? label : null
  const root = element({ 'wf-xano-instance': 'dash-projects' })
  root.querySelectorAll = (selector) => {
    if (selector === '.button_main-wrap') return [control]
    return []
  }
  let loads = 0
  let repaintState
  const instance = {
    appendMode: false,
    loadMode: 'pagination',
    root,
    subscribe(handler) {
      repaintState = handler
      handler({ status: 'success', data: { hasMore: true } })
      return () => {}
    },
    loadNext() {
      loads += 1
    },
  }

  api.wireProjectLoadMore(instance)
  assert.equal(instance.loadMode, 'more')
  assert.equal(instance.appendMode, true)
  assert.equal(instance.perPage, 12)
  assert.equal(root.attributes['wf-xano-load'], 'more')
  assert.equal(root.attributes['wf-xano-per-page'], '12')
  assert.equal(control.hidden, false)
  assert.equal(control.attributes['aria-disabled'], 'false')
  assert.equal(control.attributes['aria-hidden'], 'false')
  assert.equal(control.attributes['aria-busy'], 'false')
  assert.equal(control.attributes['data-opp-loading'], 'false')
  assert.equal(disabledClass, false)
  assert.equal(control.attributes['wf-xano-element'], undefined)
  assert.equal(listeners, 1)
  click({ preventDefault() {} })
  assert.equal(loads, 1)
  repaintState({ status: 'success', data: { hasMore: false } })
  assert.equal(control.hidden, true)
  assert.equal(control.attributes['aria-disabled'], 'true')
  click({ preventDefault() {} })
  assert.equal(loads, 1)
})

test('project pagination creates a scoped Show more control when Webflow omitted one', () => {
  let click
  const label = element()
  label.textContent = 'Show more'
  const template = element()
  template.querySelector = (selector) => selector === '.button_main-text' ? label : null
  template.cloneNode = () => {
    const cloneLabel = element()
    cloneLabel.textContent = 'Show more'
    const clone = element({ 'bookings-load-more': 'calls', hidden: '' })
    clone.querySelector = (selector) => selector === '.button_main-text' ? cloneLabel : null
    clone.closest = () => null
    clone.addEventListener = (name, handler) => {
      if (name === 'click') click = handler
    }
    return clone
  }
  const appended = []
  const root = element({ 'wf-xano-instance': 'dash-brand-projects' })
  root.ownerDocument = {
    querySelectorAll(selector) {
      return selector === '.button_main-wrap' ? [template] : []
    },
  }
  root.contains = () => false
  root.appendChild = (child) => appended.push(child)
  root.querySelectorAll = () => []
  let loads = 0
  const instance = {
    root,
    subscribe(handler) {
      handler({ status: 'success', data: { hasMore: true } })
      return () => {}
    },
    loadNext() {
      loads += 1
    },
  }

  api.wireProjectLoadMore(instance)
  assert.equal(appended.length, 1)
  const control = appended[0]
  assert.equal(control.getAttribute('wf-xano-element'), 'load-more')
  assert.equal(control.getAttribute('wf-xano-instance'), 'dash-brand-projects')
  assert.equal(control.getAttribute('bookings-load-more'), null)
  assert.equal(control.hidden, false)
  assert.equal(control.style.display, '')
  let prevented = 0
  click({ preventDefault() { prevented += 1 } })
  assert.equal(loads, 1)
  control.setAttribute('aria-disabled', 'true')
  click({ preventDefault() { prevented += 1 } })
  assert.equal(prevented, 2)
  assert.equal(loads, 1)
})

for (const total of [0, 12, 20, 73]) {
  test(`project pagination renders and exhausts ${total} server rows in 12-item pages`, async () => {
    const label = element()
    label.textContent = 'Show more'
    const control = element()
    let click
    control.addEventListener = (name, handler) => {
      if (name === 'click') click = handler
    }
    control.closest = () => null
    control.querySelector = (selector) =>
      selector === '.button_main-text' ? label : null
    const root = element({
      'wf-xano-instance': 'dash-projects',
      'wf-xano-source': 'opp30:starter/projects/mine',
    })
    root.querySelectorAll = (selector) => selector === '.button_main-wrap' ? [control] : []
    const rows = Array.from({ length: total }, (_, index) => ({ id: index + 1 }))
    const requests = []
    const subscribers = []
    let state = { status: 'idle', data: { items: [], hasMore: false } }
    const publish = (next) => {
      state = next
      subscribers.forEach((handler) => handler(state))
    }
    const instance = {
      root,
      page: 1,
      getState: () => state,
      subscribe(handler) {
        subscribers.push(handler)
        handler(state)
        return () => {}
      },
      async request(page, append) {
        requests.push({ page, per_page: this.perPage })
        const start = (page - 1) * this.perPage
        const pageRows = rows.slice(start, start + this.perPage)
        const items = append ? state.data.items.concat(pageRows) : pageRows
        publish({
          status: 'success',
          data: { items, hasMore: start + pageRows.length < rows.length },
          query: { page, perPage: this.perPage },
        })
      },
      loadNext() {
        if (!state.data.hasMore) return Promise.resolve()
        this.page += 1
        return this.request(this.page, true)
      },
    }

    api.wireProjectLoadMore(instance)
    await instance.request(1, false)
    while (state.data.hasMore) {
      const expectedRequests = requests.length + 1
      click({ preventDefault() {} })
      await until(() => requests.length === expectedRequests)
    }

    assert.equal(state.data.items.length, total)
    assert.deepEqual(state.data.items.map((row) => row.id), rows.map((row) => row.id))
    assert.equal(requests.length, Math.max(1, Math.ceil(total / 12)))
    assert.ok(requests.every((request) => request.per_page === 12))
    assert.equal(control.hidden, true)
    assert.equal(control.attributes['aria-disabled'], 'true')
  })
}

test('both project dashboards leave remote filtering to the default wf-xano contract', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const keys = ['dash-projects', 'dash-brand-projects']
  const roots = Object.fromEntries(
    keys.map((key) => {
      const filters = element()
      const root = element({ 'wf-xano-instance': key })
      root.querySelector = (selector) =>
        selector === '.tabs-button_component.is-dashboard' ? filters : null
      return [key, { filters, root }]
    }),
  )
  const snapshots = {}
  const params = {}
  const instances = Object.fromEntries(
    keys.map((key) => [
      key,
      {
        filterMode: 'remote',
        keyed: false,
        keyField: 'id',
        root: roots[key].root,
        qa: () => [roots[key].filters],
        on() {},
        setParam(field, value) {
          params[key] = [field, value]
          return Promise.resolve(key)
        },
        subscribe(selector, handler) {
          snapshots[key] = { filterMode: this.filterMode, keyed: this.keyed }
          handler(
            selector({
              status: 'success',
              data: { total: 1 },
              query: { params: {} },
            }),
          )
        },
      },
    ]),
  )
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      const match = selector.match(/^\[wf-xano-instance="([^"]+)"\]$/)
      if (match && roots[match[1]]) return [roots[match[1]].root]
      return []
    },
  }
  const window = { document, location: { pathname: '/starter-dashboard' } }

  vm.runInNewContext(source, { document, Intl, window })
  window.WfXano[0]({ get: (key) => instances[key] || null })

  keys.forEach((key) => {
    assert.deepEqual(snapshots[key], { filterMode: 'remote', keyed: false })
    assert.equal(roots[key].filters.hidden, false)
  })

  const results = await Promise.all(
    keys.map((key) => instances[key].setParam('status', 'completed')),
  )
  assert.deepEqual(params, {
    'dash-projects': ['status', 'completed'],
    'dash-brand-projects': ['status', 'completed'],
  })
  assert.deepEqual(results, keys)
})

// SFR-232 — the Designer put `#calls-section` inside the *authored* Calls tile, not
// inside the V3 `[bookings-section="calls"]` tile that replaces it. Hiding the
// duplicate used to take that id out of layout, so the CALLS tab and every
// `#calls-section` deep link had nowhere to jump to.
test('hidden authored duplicates hand their sub-nav anchors to the live V3 tile', () => {
  const originalDocument = global.document
  const anchor = element({ id: 'calls-section', class: 'dash-main_anchor' })
  const liveChildren = [element()]
  const originalFirstChild = liveChildren[0]
  const liveTile = element({
    'bookings-section': 'calls',
    class: 'dash-main_tile-item',
  })
  liveTile.firstChild = originalFirstChild
  const inserted = []
  liveTile.insertBefore = (node, reference) => {
    inserted.push({ node, reference })
    liveChildren.unshift(node)
    liveTile.firstChild = liveChildren[0]
    return node
  }

  const heading = element()
  heading.textContent = ' Calls '
  const duplicate = element({ class: 'dash-main_tile-item' })
  duplicate.querySelector = (selector) =>
    selector === 'h1,h2,h3,h4,h5,h6' ? heading : null
  duplicate.querySelectorAll = (selector) =>
    selector === '.dash-main_anchor[id]' ? [anchor] : []

  try {
    global.document = {
      getElementById: (id) => (id === 'calls-section' ? anchor : null),
      querySelectorAll(selector) {
        if (selector === '.dash-main_tile-item[bookings-section]') return [liveTile]
        if (selector === '.dash-main_tile-item') return [liveTile, duplicate]
        return []
      },
    }

    api.hideAuthoredDuplicates()

    assert.deepEqual(inserted, [{ node: anchor, reference: originalFirstChild }])
    assert.equal(liveChildren[0], anchor)
    assert.equal(duplicate.hidden, true)
    assert.equal(duplicate.style.display, 'none')
    assert.equal(liveTile.hidden, false)
  } finally {
    global.document = originalDocument
  }
})

test('a duplicate with no live counterpart is still hidden and keeps its anchors', () => {
  const originalDocument = global.document
  const anchor = element({ id: 'requests-section', class: 'dash-main_anchor' })
  const heading = element()
  heading.textContent = 'Call Requests'
  const duplicate = element({ class: 'dash-main_tile-item' })
  duplicate.querySelector = (selector) =>
    selector === 'h1,h2,h3,h4,h5,h6' ? heading : null
  duplicate.querySelectorAll = (selector) =>
    selector === '.dash-main_anchor[id]' ? [anchor] : []
  const unrelated = element({ class: 'dash-main_tile-item' })
  const unrelatedHeading = element()
  unrelatedHeading.textContent = 'Projects'
  unrelated.querySelector = (selector) =>
    selector === 'h1,h2,h3,h4,h5,h6' ? unrelatedHeading : null

  try {
    global.document = {
      getElementById: () => anchor,
      querySelectorAll(selector) {
        if (selector === '.dash-main_tile-item[bookings-section]') return []
        if (selector === '.dash-main_tile-item') return [duplicate, unrelated]
        return []
      },
    }

    api.hideAuthoredDuplicates()

    assert.equal(duplicate.hidden, true)
    assert.equal(unrelated.hidden, false)
    assert.equal(unrelated.style.display, undefined)
  } finally {
    global.document = originalDocument
  }
})

test('an anchor id another element already owns is never re-parented', () => {
  const originalDocument = global.document
  const stray = element({ id: 'calls-section', class: 'dash-main_anchor' })
  const winner = element({ id: 'calls-section' })
  const source = element()
  source.querySelectorAll = (selector) =>
    selector === '.dash-main_anchor[id]' ? [stray] : []
  const target = element()
  let inserts = 0
  target.insertBefore = () => {
    inserts += 1
  }

  try {
    global.document = { getElementById: () => winner }
    assert.equal(api.adoptSectionAnchors(source, target), 0)
    assert.equal(inserts, 0)
  } finally {
    global.document = originalDocument
  }
})

test('anchor adoption ignores missing, identical, and inert tiles', () => {
  const source = element()
  source.querySelectorAll = () => []
  assert.equal(api.adoptSectionAnchors(null, element()), 0)
  assert.equal(api.adoptSectionAnchors(source, null), 0)
  assert.equal(api.adoptSectionAnchors(source, source), 0)
  assert.equal(api.adoptSectionAnchors({}, element()), 0)
  assert.equal(api.adoptSectionAnchors(source, {}), 0)
})
