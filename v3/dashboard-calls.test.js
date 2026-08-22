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

async function until(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
  const groups = []
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
    const field = element({ 'booking-element': name })
    const group = element({ 'booking-element-wrap': '' })
    group.querySelector = (selector) => selector === '[booking-element]' ? field : null
    field.closest = (selector) => selector === '[booking-element-wrap]' ? group : null
    if (name === 'meeting-link') field.href = 'stale'
    fields[name] = field
    groups.push(group)
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
  modal.querySelectorAll = (selector) => ({
    '[booking-popup-content]': [base, confirmation],
    '[booking-element-wrap]': groups,
    '[booking-action-btn], [booking-card-action-btn], [payment-action-btn], [booking-pm-action], [data-btn-payment], [popup-stripe-card-open], [pm-use-this]': actions,
    '[reschedule-blocked-info]': [blocked],
  })[selector] || []

  return {
    actions,
    base,
    blocked,
    confirmation,
    duplicatePayment,
    fields,
    modal,
    pendingDuplicate,
    pendingOne,
    priceUnit,
  }
}

test('Free Call details hide paid copy, duplicate copy, and unsupported actions', () => {
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
  assert.equal(view.actions[1].hidden, false)
  assert.equal(view.actions[2].hidden, true)
  assert.equal(view.actions[3].hidden, true)
  assert.equal(view.actions[4].hidden, false)

  booking.confirmation_expires_at = 1
  api.populateDetailModal(view.modal, booking, 'starter', 2_000)
  assert.equal(view.pendingOne.hidden, true)
  assert.equal(view.actions[4].hidden, true)
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

test('delegated Reschedule is stopped before an empty modal can open', () => {
  let clickListener
  const originalDocument = global.document
  try {
    global.document = {
      addEventListener(name, listener, capture) {
        assert.equal(name, 'click')
        assert.equal(capture, true)
        clickListener = listener
      },
    }
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
