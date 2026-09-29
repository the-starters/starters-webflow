const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

global.window = global
const api = require('./dashboard-calls.js')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
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

function anchorElement(attributes = {}) {
  const anchor = element(attributes)
  anchor.tagName = 'A'
  Object.defineProperty(anchor, 'href', {
    get() {
      return this.hasAttribute('href') ? this.attributes.href : ''
    },
    set(value) {
      this.setAttribute('href', value)
    },
  })
  return anchor
}

function matchesAttributeSelector(node, selector) {
  const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
  if (!match) return false
  const actual = node.getAttribute && node.getAttribute(match[1])
  return actual != null && (match[2] == null || actual === match[2])
}

test('payment actions prefer the authored saved-card entry and remain gated', () => {
  const previous = global.StartersDashboardCallPayment
  const legacy = element({ 'payment-action-btn': 'change-card' })
  const preferred = element({ 'payment-action-btn': 'change-card-v2' })
  const modal = element()
  modal.querySelectorAll = () => [legacy, preferred]
  modal.querySelector = selector => selector === '[payment-action-btn="change-card-v2"]' ? preferred : null
  try {
    global.StartersDashboardCallPayment = { canManageCards: role => role === 'brand' }
    api.configureDetailActions(modal, 'brand', 'confirmed', {})
    assert.equal(legacy.hidden, true)
    assert.equal(preferred.hidden, false)
    api.configureDetailActions(modal, 'starter', 'confirmed', {})
    assert.equal(preferred.hidden, true)
    modal.querySelector = () => null
    api.configureDetailActions(modal, 'brand', 'confirmed', {})
    assert.equal(legacy.hidden, false, 'the legacy entry remains usable when no newer entry exists')
  } finally { global.StartersDashboardCallPayment = previous }
})

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
      // Selector lists matter: the controller asks one panel for any of the
      // four authored Message controls in a single query.
      const parts = selector.split(',').map((part) => part.trim()).filter(Boolean)
      const results = []
      const visit = (candidate) => {
        if (parts.some((part) => matchesAttributeSelector(candidate, part))) {
          results.push(candidate)
        }
        candidate.children.forEach(visit)
      }
      this.children.forEach(visit)
      return results
    },
    closest(selector) {
      let candidate = this
      while (candidate) {
        if (matchesAttributeSelector(candidate, selector)) return candidate
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

test('reschedule proposals stay distinct from initial requests and confirmed calls', () => {
  const booking = { booking_id: 'proposal', status: 'rescheduled', start: 3000, end: 4000 }
  for (const role of ['brand', 'starter']) {
    assert.equal(api.bookingStatus(booking, 2000), 'rescheduled')
    assert.equal(api.statusLabel(api.bookingStatus(booking, 2000), role), 'Pending')
    assert.deepEqual(api.sectionBookings([booking], role, 'calls', 2000), [booking])
  }
  assert.deepEqual(api.sectionBookings([booking], 'starter', 'requests', 2000), [])
  assert.equal(api.responseWindowOpen(booking, 2000), false)
  assert.equal(api.responseWindowOpen({ ...booking, response_expires_at: 1000 }, 2000), false)
  assert.equal(api.bookingStatus(booking, 5000), 'completed')
  for (const role of ['brand', 'starter']) {
    assert.equal(api.canConfirmBooking(role, booking, 2000), false)
  }
  assert.equal(api.bookingStatus({ ...booking, status: 'confirmed' }, 2000), 'confirmed')
})

test('both roles see Pending proposal details without losing an existing meeting link', () => {
  for (const role of ['brand', 'starter']) {
    const view = detailModalHarness()
    const booking = {
      booking_id: 'proposal-details', status: 'rescheduled', start: 3000, end: 4000,
      start_old: 2500, end_old: 3500,
      duration: 30, meeting_link: 'https://meet.google.com/test-room',
      brand_data: { name: 'Brand', timezone: 'UTC' },
      starter_data: { name: 'Starter', timezone: 'UTC' },
    }
    api.populateDetailModal(view.modal, booking, role, 2000)
    assert.equal(view.fields.status.textContent, 'Pending')
    assert.equal(view.fields['meeting-link'].hidden, false)
    assert.equal(view.fields['meeting-link'].getAttribute('data-meeting-href'), booking.meeting_link)
  }
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

// Kaeser QA P5 (2026-09-28): the Starter confirm can take a minute. Accept
// only set aria-busy and logged a failure to the console, so the Starter read
// it as "unable to accept". The F21 alert pattern now shows the failure.
test('Starter Accept shows Confirming… in flight and a visible failure', async () => {
  const actions = require('./dashboard-call-actions.js')
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const booking = {
    booking_id: bookingId,
    config_id: configId,
    booking_ref: Buffer.concat([
      uuidBytes(configId),
      uuidBytes(bookingId),
      Buffer.from('bounded-salt'),
    ]).toString('base64url'),
    data_environment: 'production',
    starter_data: { memberstack_id: 'mem_starter-one' },
    status: 'pending',
  }
  const original = {
    document: global.document,
    crypto: global.crypto,
    fetch: global.xanoAuthFetch,
    storage: global.sessionStorage,
    actions: global.StartersDashboardCallActions,
    error: console.error,
  }
  function host(panels) {
    return {
      children: [],
      ownerDocument: {
        createElement() {
          return {
            hidden: false,
            style: {},
            textContent: '',
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = value },
          }
        },
      },
      getAttribute(name) { return name === 'data-booking-id' ? bookingId : null },
      appendChild(node) { node.parentNode = this; this.children.push(node) },
      notes() {
        return this.children.filter((node) => node.attributes && 'data-starters-action-error' in node.attributes)
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
      querySelectorAll(selector) {
        if (selector === '[booking-popup-content]') return panels
        if (selector === '[data-starters-action-error]') {
          return panels.flatMap((panel) => panel.notes()).concat(this.notes())
        }
        return []
      },
    }
  }
  try {
    global.StartersDashboardCallActions = actions
    global.crypto = {
      subtle: original.crypto && original.crypto.subtle,
      randomUUID: () => '00000000-0000-4000-8000-000000000071',
    }
    global.sessionStorage = memoryStorage()
    console.error = () => {}
    for (const where of ['modal', 'card']) {
      const basePanel = Object.assign(host([]), {
        hidden: false,
        style: {},
      })
      basePanel.getAttribute = (name) => name === 'booking-popup-content' ? 'base' : null
      const modal = host([basePanel])
      const card = host([])
      const label = { textContent: 'Accept' }
      const inner = { disabled: false }
      const button = {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value },
        querySelectorAll(selector) {
          if (selector === 'button') return [inner]
          return selector.includes('.button_main-text') ? [label] : []
        },
        closest(selector) {
          if (selector === '[data-booking-id]') return where === 'modal' ? modal : card
          if (selector.includes('popup-booking-info')) return where === 'modal' ? modal : null
          return this
        },
      }
      const listeners = []
      global.document = { addEventListener(_type, listener) { listeners.push(listener) } }
      const response = deferred()
      global.xanoAuthFetch = async () => response.promise
      api.wireBookingActions([{ rows: [booking] }], 'starter', async () => {})
      const click = listeners[0]({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
      await until(() => label.textContent === 'Confirming…')
      assert.equal(inner.disabled, true)
      assert.equal(button.attributes['aria-busy'], 'true')
      response.resolve({ ok: false, json: async () => ({ message: 'Controlled confirm refusal' }) })
      await click
      assert.equal(label.textContent, 'Accept')
      assert.equal(inner.disabled, false)
      assert.equal(button.attributes['aria-busy'], 'false')
      const notes = where === 'modal' ? basePanel.notes() : card.notes()
      assert.equal(notes.length, 1, where + ': one visible alert')
      assert.equal(notes[0].textContent, 'Controlled confirm refusal')
      assert.equal(notes[0].hidden, false)
      assert.equal(notes[0].attributes.role, 'alert')
    }
  } finally {
    global.document = original.document
    global.crypto = original.crypto
    global.xanoAuthFetch = original.fetch
    global.sessionStorage = original.storage
    global.StartersDashboardCallActions = original.actions
    console.error = original.error
  }
})

// The alert shows the server's own text only for a server answer. The
// fallback and client-side errors show plain copy, never internal wording,
// and a failure after the server confirmed shows no "not confirmed" alert.
test('Starter Accept alert shows server text only for server answers', async () => {
  const actions = require('./dashboard-call-actions.js')
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const original = {
    document: global.document,
    crypto: global.crypto,
    fetch: global.xanoAuthFetch,
    storage: global.sessionStorage,
    actions: global.StartersDashboardCallActions,
    error: console.error,
  }
  const scenarios = [
    { name: 'server message', respond: async () => ({ ok: false, json: async () => ({ error: 'Controlled server error' }) }), alert: 'Controlled server error' },
    { name: 'no server text', respond: async () => ({ ok: false, json: async () => ({}) }), alert: 'The call could not be confirmed. Please try again.' },
    { name: 'unreadable body', respond: async () => ({ ok: true, json: async () => { throw new Error('bad json') } }), alert: 'The call could not be confirmed. Please try again.' },
    { name: 'transport error', respond: async () => { throw new Error('Internal transport detail') }, alert: 'The call could not be confirmed. Please try again.' },
    {
      name: 'refresh after confirm fails',
      respond: async () => ({ ok: true, json: async () => ({ status: 'confirmed' }) }),
      restart: async () => { throw new Error('Refresh failed') },
      alert: null,
    },
  ]
  const logged = []
  try {
    global.StartersDashboardCallActions = actions
    global.sessionStorage = memoryStorage()
    console.error = (...args) => logged.push(args.join(' '))
    let uuid = 0
    global.crypto = {
      subtle: original.crypto && original.crypto.subtle,
      randomUUID: () => '00000000-0000-4000-8000-0000000008' + String(uuid += 1).padStart(2, '0'),
    }
    for (const scenario of scenarios) {
      const booking = {
        booking_id: bookingId,
        config_id: configId,
        booking_ref: Buffer.concat([
          uuidBytes(configId),
          uuidBytes(bookingId),
          Buffer.from('bounded-salt'),
        ]).toString('base64url'),
        data_environment: 'production',
        starter_data: { memberstack_id: 'mem_starter-one' },
        status: 'pending',
      }
      const card = {
        children: [],
        ownerDocument: {
          createElement() {
            return { hidden: false, style: {}, textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value } }
          },
        },
        getAttribute(name) { return name === 'data-booking-id' ? bookingId : null },
        appendChild(node) { node.parentNode = this; this.children.push(node) },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
        querySelectorAll(selector) {
          return selector === '[data-starters-action-error]'
            ? this.children.filter((node) => 'data-starters-action-error' in node.attributes)
            : []
        },
      }
      const label = { textContent: 'Accept' }
      const button = {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value },
        querySelectorAll(selector) {
          if (selector === 'button') return []
          return selector.includes('.button_main-text') ? [label] : []
        },
        closest(selector) {
          if (selector === '[data-booking-id]') return card
          if (selector.includes('popup-booking-info')) return null
          return this
        },
      }
      const listeners = []
      global.document = { addEventListener(_type, listener) { listeners.push(listener) } }
      global.xanoAuthFetch = scenario.respond
      api.wireBookingActions([{ rows: [booking] }], 'starter', scenario.restart || (async () => {}))
      await listeners[0]({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
      const notes = card.children.filter((node) => !node.hidden)
      if (scenario.alert === null) {
        assert.equal(notes.length, 0, scenario.name + ': no alert after the server confirmed')
      } else {
        assert.equal(notes.length, 1, scenario.name)
        assert.equal(notes[0].textContent, scenario.alert, scenario.name)
        assert.doesNotMatch(notes[0].textContent, /Canonical/)
      }
      assert.equal(label.textContent, 'Accept', scenario.name + ': label restored')
    }
    // The technical text still reaches the console.
    assert.ok(logged.some((line) => line.includes('Internal transport detail')))
    assert.ok(logged.some((line) => line.includes('Canonical booking confirmation failed')))
  } finally {
    global.document = original.document
    global.crypto = original.crypto
    global.xanoAuthFetch = original.fetch
    global.sessionStorage = original.storage
    global.StartersDashboardCallActions = original.actions
    console.error = original.error
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

test('Starter pending request exposes the authored read-only details trigger', () => {
  const wrapper = element()
  wrapper.hidden = true
  wrapper.style.display = 'none'
  const trigger = { parentElement: wrapper }
  const card = {
    querySelectorAll() { return [] },
    querySelector(selector) {
      assert.equal(
        selector,
        '[data-modal-trigger="popup-booking-info"]:not([booking-action-btn]):not([booking-card-action-btn])',
      )
      return trigger
    },
  }

  api.configureActionButtons(card, 'brand', 'pending')
  assert.equal(wrapper.hidden, true)
  api.configureActionButtons(card, 'starter', 'confirmed')
  assert.equal(wrapper.hidden, true)

  api.configureActionButtons(card, 'starter', 'pending')
  assert.equal(wrapper.hidden, false)
  assert.equal(wrapper.style.display, 'flex')

  const mixedWrapper = element()
  mixedWrapper.hidden = true
  mixedWrapper.style.display = 'none'
  mixedWrapper.querySelectorAll = () => [element({ 'booking-action-btn': 'reschedule' })]
  trigger.parentElement = mixedWrapper
  api.configureActionButtons(card, 'starter', 'pending')
  assert.equal(mixedWrapper.hidden, true)
  assert.equal(mixedWrapper.style.display, 'none')
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
  const stop = api.startBookingLifecycleTicker(refs, 'starter', async () => {
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

test('the lifecycle owner arms exactly one timer for each dashboard role', () => {
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
  const stop = api.startBookingLifecycleTicker(refs, 'starter', () => {}, {
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
  const stopBrand = api.startBookingLifecycleTicker(refs, 'brand', () => {}, {
    now: () => 2_000_000_000_000,
    setInterval() {
      brandTimers += 1
      return 1
    },
    clearInterval() {},
  })
  assert.equal(typeof stopBrand, 'function')
  assert.equal(brandTimers, 1)
  stop()
  stopBrand()
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
    api.startBookingLifecycleTicker(refs, 'starter', () => {
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
  api.startBookingLifecycleTicker(refs, 'starter', () => {
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

test('initial refresh waits through the post-login Memberstack hydration gap', async () => {
  const originalDocument = global.document
  const originalFetch = global.xanoAuthFetch
  const originalMemberReady = global.memberReady
  const originalSetTimeout = global.setTimeout
  const root = element({ 'data-dashboard-calls-v3': 'loading' })
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
  const delays = []
  try {
    global.document = { documentElement: root, querySelector: () => null }
    // The shared site-head promise resolves an empty object while the new
    // page's Memberstack client is still hydrating the authenticated session.
    global.memberReady = Promise.resolve({})
    global.setTimeout = (callback, delay) => {
      delays.push(delay)
      callback()
      return 1
    }
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => [] })
    const memberstack = {
      async getCurrentMember() {
        reads += 1
        return reads < 5 ? { data: null } : { data: { id: 'starter-after-login' } }
      },
    }

    assert.equal(await api.refreshSession(
      memberstack,
      [refs],
      'starter',
      1,
      () => 1,
      true,
      {},
    ), true)
    assert.equal(reads, 5)
    assert.deepEqual(delays.slice(0, 4), [200, 400, 800, 1200])
    assert.equal(root.getAttribute('data-dashboard-calls-v3'), 'ready')
  } finally {
    global.document = originalDocument
    global.xanoAuthFetch = originalFetch
    global.memberReady = originalMemberReady
    global.setTimeout = originalSetTimeout
  }
})

test('transient auth change keeps the initial post-login readiness window', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const retryTimers = []
  const delays = []
  const requests = []
  let authChange
  let reads = 0
  const member = { id: 'starter-after-login' }
  const list = element()
  const template = element({ 'bookings-item-template': 'calls' })
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': element(),
      '[bookings-empty="calls"]': element(),
      '[bookings-count]': element(),
      '.tabs-button_component.is-dashboard': element(),
    })[selector] || null
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    getElementById() {
      return null
    },
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
        reads += 1
        return { data: reads < 5 ? null : member }
      },
      onAuthChange(listener) {
        authChange = listener
      },
    },
    clearInterval() {},
    document,
    location: { pathname: '/starter-dashboard', search: '', hash: '' },
    memberReady: Promise.resolve({}),
    setInterval() {
      return 1
    },
    setTimeout(callback, delay) {
      delays.push(delay)
      retryTimers.push(callback)
      return retryTimers.length
    },
    xanoAuthFetch: async (_url, init) => {
      requests.push(JSON.parse(init.body).memberstack_id)
      return { ok: true, json: async () => [] }
    },
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    document,
    Intl,
    URLSearchParams,
    window,
  })
  await until(() => typeof authChange === 'function' && reads === 1)
  authChange({ data: null })

  for (let step = 0; step < 12 && root.getAttribute('data-dashboard-calls-v3') !== 'ready'; step += 1) {
    await new Promise(setImmediate)
    const callback = retryTimers.shift()
    if (callback) callback()
  }
  await until(() => root.getAttribute('data-dashboard-calls-v3') === 'ready')

  assert.deepEqual(requests, ['starter-after-login'])
  assert.equal(reads, 5)
  assert.deepEqual(delays.slice(0, 4), [200, 200, 400, 800])
})

test('auth change during delayed deep-link focus retries after canonical reload', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const bookingId = '00d39a7b-40be-436f-b794-a6832215234b'
  const retryTimers = []
  const requests = []
  let authChange
  let opened = 0
  const member = { id: 'starter-after-login' }
  const booking = {
    booking_id: bookingId,
    lifecycle_revision: 1,
    data_environment: 'production',
    status: 'confirmed',
    start: Date.now() + 86_400_000,
    starter_data: { memberstack_id: member.id },
  }
  const view = detailModalHarness()
  const list = element()
  const template = element({ 'bookings-item-template': 'calls' })
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': element(),
      '[bookings-empty="calls"]': element(),
      '[bookings-count]': element(),
      '.tabs-button_component.is-dashboard': element(),
    })[selector] || null
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    getElementById() {
      return null
    },
    querySelector(selector) {
      return selector === '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]'
        ? view.modal
        : null
    },
    querySelectorAll(selector) {
      return selector === '[bookings-section]' ? [section] : []
    },
  }
  const window = {
    $memberstackDom: {
      async getCurrentMember() {
        return { data: member }
      },
      onAuthChange(listener) {
        authChange = listener
      },
    },
    URLSearchParams,
    clearInterval() {},
    document,
    history: { replaceState() {} },
    location: {
      hostname: 'www.thestarters.com',
      pathname: '/starter-dashboard',
      search: '?booking_id=' + bookingId + '&revision=1&environment=production',
      hash: '#calls',
    },
    memberReady: Promise.resolve(member),
    setInterval() {
      return 1
    },
    setTimeout(callback) {
      retryTimers.push(callback)
      return retryTimers.length
    },
    xanoAuthFetch: async (_url, init) => {
      requests.push(JSON.parse(init.body).memberstack_id)
      return { ok: true, json: async () => [booking] }
    },
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    document,
    Intl,
    URLSearchParams,
    window,
  })
  await until(() => requests.length === 1 && retryTimers.length === 1)
  authChange({ data: null })
  await until(() => requests.length === 2 && retryTimers.length === 2)

  window.lumos = {
    modal: {
      list: { 'popup-booking-info': {} },
      open() {
        opened += 1
      },
    },
  }
  while (retryTimers.length) {
    retryTimers.shift()()
    await new Promise(setImmediate)
  }
  await until(() => opened === 1)

  assert.deepEqual(requests, [member.id, member.id])
  assert.equal(view.modal.getAttribute('data-booking-id'), bookingId)
  assert.equal(
    view.modal.getAttribute('data-booking-deep-link'),
    'current_state_read_only',
  )
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
    if (name === 'meeting-link') field.tagName = 'P'
    if (name.endsWith('-message-link')) field.href = '/messages'
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
    'start-date-old',
    'start-time',
    'start-time-old',
    'status-text',
    'duration',
    'price',
    'payment-status-text',
    'reschedule-reason',
    'cancel-reason',
    'meeting-link',
    'brand-message-link',
    'starter-message-link',
  ].forEach((name) => {
    const field = fieldNode(name)
    fields[name] = field
    fieldCopies[name] = [field]
  })
  // The authored cancel panel duplicates some base-panel fields; every copy
  // must be filled together (Kaeser QA F3).
  ;['context', 'start-date', 'start-date-old', 'meeting-link'].forEach((name) => {
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
  const cancelledPanel = element({ 'booking-popup-content': 'cancelled' })
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
  const message = element({ 'booking-action-btn': 'message' })
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
    message,
  ]
  const modal = element({ 'popup-booking-info': '' })
  modal.querySelector = (selector) => {
    const match = selector.match(/^\[booking-element="(.+)"\]$/)
    if (match) return fields[match[1]] || null
    if (selector === '[booking-popup-content="base"]') return base
    if (selector === '[booking-popup-content="cancelled"]') return cancelledPanel
    return null
  }
  modal.querySelectorAll = (selector) => {
    const match = selector.match(/^\[booking-element="(.+)"\]$/)
    if (match) return fieldCopies[match[1]] || []
    return {
      '[booking-popup-content]': [base, confirmation, cancelledPanel],
      '[booking-action-btn="switch-base"], [booking-card-action-btn="switch-base"]': [back],
      '[booking-element-wrap]': groups,
      '[booking-action-btn], [booking-card-action-btn], [payment-action-btn], [booking-pm-action], [data-btn-payment], [popup-stripe-card-open], [pm-use-this]': actions,
      '[reschedule-blocked-info]': [blocked],
    }[selector] || []
  }

  return {
    actions,
    back,
    base,
    blocked,
    cancelledPanel,
    confirmation,
    duplicatePayment,
    fields,
    message,
    modal,
    panelCopies,
    pendingDuplicate,
    pendingOne,
    priceUnit,
  }
}

function completedDetailModalHarness(panelKinds) {
  const view = detailModalHarness()
  const panels = panelKinds.map((kind) => {
    const panel = element({ 'booking-popup-content': 'completed' })
    panel.querySelector = (selector) =>
      selector === '[result-confirmed-text]' && kind === 'proposal-result' ? {} : null
    return panel
  })
  const originalQuerySelector = view.modal.querySelector
  const originalQuerySelectorAll = view.modal.querySelectorAll
  view.modal.querySelector = (selector) =>
    selector === '[booking-popup-content="completed"]'
      ? panels[0] || null
      : originalQuerySelector(selector)
  view.modal.querySelectorAll = (selector) => {
    if (selector === '[booking-popup-content="completed"]') return panels
    if (selector === '[booking-popup-content]') {
      return originalQuerySelectorAll(selector).concat(panels)
    }
    return originalQuerySelectorAll(selector)
  }
  return { ...view, completedPanels: panels }
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

test('proposal details show old and proposed times and the correct waiting role', () => {
  const booking = {
    booking_id: 'proposal-comparison', status: 'rescheduled', rescheduled_by: 'brand',
    start: Date.parse('2026-09-17T08:30:00Z'), start_old: Date.parse('2026-09-16T08:30:00Z'),
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'Asia/Manila' },
  }
  for (const role of ['brand', 'starter']) {
    const view = detailModalHarness()
    api.populateDetailModal(view.modal, booking, role)
    assert.equal(view.fields['start-date-old'].textContent, role === 'brand' ? 'Wed, Sep 16, 8:30 AM UTC' : 'Wed, Sep 16, 4:30 PM GMT+8')
    assert.equal(view.panelCopies['start-date-old'].textContent, view.fields['start-date-old'].textContent)
    assert.equal(view.fields['start-time'].hidden, true)
    assert.equal(view.fields['start-time-old'].hidden, true)
    assert.equal(view.fields['start-date'].textContent, role === 'brand' ? 'Thu, Sep 17, 8:30 AM UTC' : 'Thu, Sep 17, 4:30 PM GMT+8')
    assert.match(view.fields['status-text'].textContent, role === 'starter' ? /your confirmation/ : /Starter/)
    api.populateDetailModal(view.modal, { ...booking, rescheduled_by: 'starter' }, role)
    assert.match(view.fields['status-text'].textContent, role === 'brand' ? /your confirmation/ : /Brand/)
    api.populateDetailModal(view.modal, { ...booking, status: 'confirmed' }, role)
    assert.equal(view.fields['start-date-old'].hidden, true)
    assert.equal(view.fields['status-text'].hidden, true)
  }
})

// Kaeser 2026-09-28 (P6): a Dubai Brand with no stored timezone saw the
// Starter's zone (PDT), so the edited call showed another DATE than the Brand
// picked. Order: viewer's own zone, then the browser zone, then counterpart.
test('call times use the viewer zone, then the browser zone, then the counterpart', () => {
  const RealIntl = Intl
  function withBrowserZone(zone, run) {
    global.Intl = {
      DateTimeFormat: function (locales, options) {
        if (locales === undefined && options === undefined) {
          return { resolvedOptions: () => ({ timeZone: zone }) }
        }
        return new RealIntl.DateTimeFormat(locales, options)
      },
    }
    try { return run() } finally { global.Intl = RealIntl }
  }
  // 2026-10-01 01:30 UTC is Sep 30 in Los Angeles and Oct 1 in Dubai.
  const start = Date.parse('2026-10-01T01:30:00Z')
  const booking = {
    booking_id: 'timezone-order',
    status: 'confirmed',
    start,
    end: start + 1800000,
    brand_data: { name: 'Brand', timezone: '' },
    starter_data: { name: 'Starter', timezone: 'America/Los_Angeles' },
  }
  function detailDate(row, role) {
    const view = detailModalHarness()
    api.populateDetailModal(view.modal, row, role, start - 86400000)
    return view.fields['start-date'].textContent
  }
  function cardDate(row, role) {
    const startDate = element({ 'booking-element': 'start-date' })
    const card = element()
    card.querySelector = (selector) => selector === '[booking-element="start-date"]' ? startDate : null
    api.bindCard(card, row, role)
    return startDate.textContent
  }
  withBrowserZone('Asia/Dubai', () => {
    // A Brand with no stored zone reads its own browser zone, on details and card.
    assert.equal(detailDate(booking, 'brand'), 'Thu, Oct 01, 5:30 AM GMT+4')
    assert.equal(cardDate(booking, 'brand'), 'Thu, Oct 01, 5:30 AM GMT+4')
    // A stored own zone still wins over the browser.
    const stored = { ...booking, brand_data: { name: 'Brand', timezone: 'UTC' } }
    assert.equal(detailDate(stored, 'brand'), 'Thu, Oct 01, 1:30 AM UTC')
    // The Starter keeps its own stored zone.
    assert.equal(detailDate(booking, 'starter'), 'Wed, Sep 30, 6:30 PM PDT')
  })
  // With no browser zone either, the counterpart's zone is the last resort.
  withBrowserZone('', () => {
    assert.equal(detailDate(booking, 'brand'), 'Wed, Sep 30, 6:30 PM PDT')
  })
})

// P6 is a Brand fix. A Starter with no stored zone keeps the Brand's zone,
// as before, and never switches to the browser zone.
test('a Starter with no stored zone keeps the Brand zone, not the browser zone', () => {
  const RealIntl = Intl
  global.Intl = {
    DateTimeFormat: function (locales, options) {
      if (locales === undefined && options === undefined) {
        return { resolvedOptions: () => ({ timeZone: 'Asia/Dubai' }) }
      }
      return new RealIntl.DateTimeFormat(locales, options)
    },
  }
  try {
    // 2026-10-01 01:30 UTC is Sep 30 in Los Angeles and Oct 1 in Dubai.
    const start = Date.parse('2026-10-01T01:30:00Z')
    const booking = {
      booking_id: 'starter-timezone-order',
      status: 'confirmed',
      start,
      end: start + 1800000,
      brand_data: { name: 'Brand', timezone: 'America/Los_Angeles' },
      starter_data: { name: 'Starter', timezone: '' },
    }
    const view = detailModalHarness()
    api.populateDetailModal(view.modal, booking, 'starter', start - 86400000)
    assert.equal(view.fields['start-date'].textContent, 'Wed, Sep 30, 6:30 PM PDT')
    const startDate = element({ 'booking-element': 'start-date' })
    const card = element()
    card.querySelector = (selector) => selector === '[booking-element="start-date"]' ? startDate : null
    api.bindCard(card, booking, 'starter')
    assert.equal(startDate.textContent, 'Wed, Sep 30, 6:30 PM PDT')
    // The Brand on the same row still reads its browser zone.
    const brandView = detailModalHarness()
    api.populateDetailModal(brandView.modal, { ...booking, brand_data: { name: 'Brand', timezone: '' } }, 'brand', start - 86400000)
    assert.equal(brandView.fields['start-date'].textContent, 'Thu, Oct 01, 5:30 AM GMT+4')
  } finally {
    global.Intl = RealIntl
  }
})

test('proposal details hide unavailable old time and unknown proposer copy', () => {
  const view = detailModalHarness()
  api.populateDetailModal(view.modal, { booking_id: 'missing-old', status: 'rescheduled', start: Date.now() + 86400000, start_old: null }, 'starter')
  assert.equal(view.fields['start-date-old'].hidden, true)
  assert.equal(view.fields['status-text'].hidden, true)
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
    end: 20_000,
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
  assert.equal(view.panelCopies['meeting-link'].getAttribute('data-meeting-href'), 'https://meet.example/abc')
  assert.equal(view.panelCopies['meeting-link'].hidden, false)

  // A hidden field hides every copy too.
  booking.call_context = ''
  api.populateDetailModal(view.modal, booking, 'starter', 2_000)
  assert.equal(view.fields.context.hidden, true)
  assert.equal(view.panelCopies.context.hidden, true)
})

// F45 (Kaeser team test 2026-09-28): the "Are you sure?" cancel step showed an
// earlier edit's reason under the authored label "Reason", and the module's
// Starter row rendered below the Back / Cancel Call buttons, outside the card.
function withInsertBefore(node) {
  node.insertBefore = function (child, before) {
    const index = this.children.indexOf(before)
    if (index === -1) return this.appendChild(child)
    this.children.splice(index, 0, child)
    child.parentNode = this
    return child
  }
  return node
}

test('Free cancel and decline steps drop the stale edit reason; Paid keeps it', () => {
  const free = {
    status: 'confirmed',
    start: 10_000,
    duration: 30,
    rescheduled_reason: 'test call propose new time',
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }
  const paid = { ...free, is_paid: true, rescheduled_reason: 'Paid edit reason' }
  const reasonRows = (booking, panel) => api.detailSupplementRows(booking, 'brand', 'UTC', panel)
    .filter((row) => row.field === 'reschedule-reason')
    .map((row) => row.value)
  assert.deepEqual(reasonRows(free, 'cancel'), [])
  assert.deepEqual(reasonRows(free, 'decline'), [])
  for (const panel of ['base', 'cancelled', 'reschedule-proposed', undefined]) {
    assert.deepEqual(reasonRows(free, panel), ['test call propose new time'], panel)
  }
  assert.deepEqual(reasonRows(paid, 'cancel'), ['Paid edit reason'])

  const modal = domElement('dialog', { 'popup-booking-info': '' })
  modal.ownerDocument = { createElement: (tag) => domElement(tag) }
  const authoredReason = (panelName) => {
    const panel = domElement('div', { 'booking-popup-content': panelName })
    const wrap = domElement('div', { 'booking-element-wrap': '' })
    const field = domElement('p', { 'booking-element': 'reschedule-reason' })
    wrap.appendChild(field)
    panel.appendChild(wrap)
    modal.appendChild(panel)
    return { field, wrap }
  }
  const base = authoredReason('base')
  const cancel = authoredReason('cancel')

  api.populateDetailModal(modal, free, 'brand', 5_000)
  assert.equal(base.field.textContent, 'test call propose new time')
  assert.equal(base.field.hidden, false)
  assert.equal(cancel.field.hidden, true)
  assert.equal(cancel.wrap.hidden, true)

  // A reused modal shows the Paid reason again: every populate pass sets it.
  api.populateDetailModal(modal, paid, 'brand', 5_000)
  assert.equal(cancel.field.textContent, 'Paid edit reason')
  assert.equal(cancel.field.hidden, false)
  assert.equal(cancel.wrap.hidden, false)
})

test('the call summary sits above a confirmation step footer, not below it', () => {
  const modal = domElement('dialog')
  modal.ownerDocument = { createElement: (tag) => domElement(tag) }
  const cancel = withInsertBefore(domElement('div', { 'booking-popup-content': 'cancel' }))
  const content = domElement('div')
  content.appendChild(domElement('p', { 'booking-element': 'duration' }))
  const footer = domElement('div')
  footer.appendChild(domElement('div', { 'booking-action-btn': 'switch-base' }))
  footer.appendChild(domElement('div', { 'booking-action-btn': 'switch-cancel-reason' }))
  cancel.appendChild(content)
  cancel.appendChild(footer)
  modal.appendChild(cancel)
  const booking = {
    status: 'confirmed',
    start: 10_000,
    duration: 30,
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }

  assert.equal(api.detailFooter(cancel), footer)
  api.ensureDetailSupplements(modal, booking, 'brand', 'UTC')
  const supplement = cancel.querySelector('[data-starters-call-summary]')
  assert.ok(supplement.querySelector('[data-starters-call-summary-row="starter-name"]'))
  assert.deepEqual(cancel.children, [content, supplement, footer])

  // A panel without a button-only footer keeps the append fallback.
  const bare = withInsertBefore(domElement('div', { 'booking-popup-content': 'expired' }))
  const mixed = domElement('div')
  mixed.appendChild(domElement('p', { 'booking-element': 'duration' }))
  mixed.appendChild(domElement('div', { 'booking-action-btn': 'message' }))
  bare.appendChild(mixed)
  assert.equal(api.detailFooter(bare), null)
})

// F09 team test 2026-09-28: after a Brand edit and a Starter decline, Declined
// Details showed "Reschedule reason" (the old edit) and "Cancellation reason"
// (the decline reason). The declined panel labels the reason it really holds.
test('declined panels label the decline reason and drop the stale edit reason', () => {
  const booking = {
    status: 'declined',
    start: 10_000,
    duration: 30,
    rescheduled_reason: 'Earlier suits us',
    cancelled_reason: 'I am not available that day',
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }
  const rows = (panel) => api.detailSupplementRows(booking, 'starter', 'UTC', panel)
    .map((row) => [row.field, row.label])
    .filter(([field]) => field.endsWith('-reason'))
  assert.deepEqual(rows('declined'), [['decline-reason', 'Decline reason']])
  for (const panel of ['cancelled', 'base', undefined]) {
    assert.deepEqual(rows(panel), [
      ['reschedule-reason', 'Reschedule reason'],
      ['cancel-reason', 'Cancellation reason'],
    ])
  }

  for (const authored of [true, false]) {
    const modal = domElement('dialog', { 'popup-booking-info': '' })
    modal.ownerDocument = { createElement: (tag) => domElement(tag) }
    const declined = domElement('div', { 'booking-popup-content': 'declined' })
    const cancelled = domElement('div', { 'booking-popup-content': 'cancelled' })
    const wrap = domElement('div', { 'booking-element-wrap': '' })
    const reason = domElement('p', { 'booking-element': 'decline-reason' })
    wrap.appendChild(reason)
    if (authored) declined.appendChild(wrap)
    modal.appendChild(domElement('div', { 'booking-popup-content': 'base' }))
    modal.appendChild(declined)
    modal.appendChild(cancelled)

    api.populateDetailModal(modal, booking, 'starter', 5_000)
    const summary = (panel) =>
      panel.querySelectorAll('[data-starters-call-summary-row]').map((row) => [
        row.getAttribute('data-starters-call-summary-row'),
        row.children[0].textContent,
        row.children[1].textContent,
      ]).filter(([field]) => field.endsWith('-reason'))
    if (authored) {
      assert.equal(reason.textContent, 'I am not available that day')
      assert.equal(reason.hidden, false)
      assert.equal(wrap.hidden, false)
      assert.deepEqual(summary(declined), [], 'the authored hook is not duplicated')
    } else {
      assert.deepEqual(summary(declined), [
        ['decline-reason', 'Decline reason', 'I am not available that day'],
      ])
    }
    // Cancelled keeps its labels.
    assert.deepEqual(summary(cancelled), [
      ['reschedule-reason', 'Reschedule reason', 'Earlier suits us'],
      ['cancel-reason', 'Cancellation reason', 'I am not available that day'],
    ])
  }

  // Only a declined booking fills the decline-reason hook.
  const modal = domElement('dialog', { 'popup-booking-info': '' })
  modal.ownerDocument = { createElement: (tag) => domElement(tag) }
  const reason = domElement('p', { 'booking-element': 'decline-reason' })
  const declined = domElement('div', { 'booking-popup-content': 'declined' })
  declined.appendChild(reason)
  modal.appendChild(declined)
  api.populateDetailModal(modal, { ...booking, status: 'cancelled' }, 'starter', 5_000)
  assert.equal(reason.hidden, true)
})

// PR #974 kept the Paid declined display unchanged on purpose, so the F09
// labels and the decline-reason fill apply to Free bookings only. A reused
// modal puts back the authored hook a Free booking filled before.
test('Paid declined details keep their labels and the authored decline-reason hook', () => {
  const paid = {
    booking_id: 'paid-declined',
    status: 'declined',
    is_paid: true,
    start: 10_000,
    duration: 30,
    rescheduled_reason: 'Earlier suits us',
    cancelled_reason: 'I am not available that day',
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }
  const free = { ...paid, booking_id: 'free-declined', is_paid: false, cancelled_reason: 'Free reason' }
  const reasonRows = (booking, panel) => api.detailSupplementRows(booking, 'starter', 'UTC', panel)
    .map((row) => [row.field, row.label])
    .filter(([field]) => field.endsWith('-reason'))
  assert.deepEqual(reasonRows(paid, 'declined'), [
    ['reschedule-reason', 'Reschedule reason'],
    ['cancel-reason', 'Cancellation reason'],
  ])
  assert.deepEqual(reasonRows(free, 'declined'), [['decline-reason', 'Decline reason']])

  const modal = domElement('dialog', { 'popup-booking-info': '' })
  modal.ownerDocument = { createElement: (tag) => domElement(tag) }
  const declined = domElement('div', { 'booking-popup-content': 'declined' })
  const wrap = domElement('div', { 'booking-element-wrap': '' })
  const reason = domElement('p', { 'booking-element': 'decline-reason' })
  reason.textContent = 'Authored placeholder'
  wrap.appendChild(reason)
  declined.appendChild(wrap)
  modal.appendChild(domElement('div', { 'booking-popup-content': 'base' }))
  modal.appendChild(declined)
  const summary = () =>
    declined.querySelectorAll('[data-starters-call-summary-row]').map((row) => [
      row.getAttribute('data-starters-call-summary-row'),
      row.children[0].textContent,
    ]).filter(([field]) => field.endsWith('-reason'))

  api.populateDetailModal(modal, paid, 'starter', 5_000)
  assert.equal(reason.textContent, 'Authored placeholder', 'Paid never fills the hook')
  assert.equal(reason.hidden, false)
  assert.equal(wrap.hidden, false)
  assert.deepEqual(summary(), [
    ['reschedule-reason', 'Reschedule reason'],
    ['cancel-reason', 'Cancellation reason'],
  ])

  // A Free booking fills the hook; the next Paid booking gets the authored hook back.
  api.populateDetailModal(modal, free, 'starter', 5_000)
  assert.equal(reason.textContent, 'Free reason')
  api.populateDetailModal(modal, { ...free, booking_id: 'free-cancelled', status: 'cancelled' }, 'starter', 5_000)
  assert.equal(reason.hidden, true)
  api.populateDetailModal(modal, paid, 'starter', 5_000)
  assert.equal(reason.textContent, 'Authored placeholder', 'no Free reason leaks into Paid')
  assert.equal(reason.hidden, false)
  assert.equal(wrap.hidden, false)
  assert.notEqual(reason.style.display, 'none')
  assert.notEqual(wrap.style.display, 'none')
})

test('missing panel details and role-correct Message actions are supplied without duplicates', () => {
  const document = { createElement: (tag) => domElement(tag) }
  const modal = domElement('dialog')
  modal.ownerDocument = document
  const base = domElement('div', { 'booking-popup-content': 'base' })
  base.appendChild(domElement('span', { 'booking-element': 'start-date' }))
  const cancelled = domElement('div', { 'booking-popup-content': 'cancelled' })
  const composePanels = [
    'payment-methods',
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
  assert.equal(starterMessage.textContent, 'Messages tab')
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
  assert.equal(messageActions.tagName, 'p')
  assert.equal(messageActions.children[0].textContent, 'If you’d like to discuss options, reach out to Northwind via the ')
  assert.equal(messageActions.children[2].textContent, '.')
  assert.equal(starterMessage.parentNode, messageActions)
  assert.equal(starterMessage.style.display, 'inline')
  assert.equal(starterMessage.style.backgroundColor, undefined)
  assert.equal(starterMessage.style.color, 'inherit')
  assert.equal(starterMessage.style.textDecoration, 'underline')

  const supplement = cancelled.querySelector('[data-starters-call-summary]')
  assert.equal(supplement.hidden, false)
  assert.equal(supplement.style.display, 'flex')
  assert.equal(supplement.style.gap, '16px')
  // Every module-owned field — counterpart and duration included — sits inside
  // the bordered row group, and the Message action is the only thing beside it.
  assert.deepEqual(
    Array.from(rowGroup.children).map((row) =>
      row.getAttribute('data-starters-call-summary-row'),
    ),
    ['brand-name', 'start-date', 'duration', 'context', 'cancel-reason'],
  )
  assert.equal(supplement.children.length, 2)
  assert.equal(supplement.children[0], rowGroup)
  assert.equal(supplement.children[1], messageActions)

  // Compose steps keep their form controls unaccompanied.
  composePanels.forEach((panel) => {
    assert.equal(panel.querySelector('[data-starters-call-summary]'), null)
    assert.equal(panel.querySelector('[data-starters-call-message]'), null)
  })

  api.ensureDetailSupplements(modal, booking, 'brand', 'UTC')
  assert.equal(cancelled.querySelectorAll('[data-starters-call-summary]').length, 1)
  const brandMessage = cancelled.querySelector('[data-starters-call-message]')
  assert.equal(brandMessage.textContent, 'Messages tab')
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

// F52 (JP meeting 2026-09-30): module rows rendered as a second bordered table
// below the authored one, and the module Message line sat outside the padded
// card column. The fixtures below mirror the saved dashboard markup: panel >
// card column > [details table > booking-element-wrap rows] + a hidden
// Message block, then the button footer.
function richElement(tag, attributes = {}, text) {
  const node = domElement(tag, attributes)
  node.hasAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
  }
  node.insertBefore = function (child, before) {
    if (child.parentNode && child.parentNode.removeChild) child.parentNode.removeChild(child)
    const index = before ? this.children.indexOf(before) : -1
    if (index === -1) return this.appendChild(child)
    this.children.splice(index, 0, child)
    child.parentNode = this
    return child
  }
  node.removeChild = function (child) {
    const index = this.children.indexOf(child)
    if (index !== -1) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }
  node.contains = function (other) {
    for (let candidate = other; candidate; candidate = candidate.parentNode) {
      if (candidate === this) return true
    }
    return false
  }
  Object.defineProperty(node, 'nextSibling', {
    get() {
      const parent = node.parentNode
      if (!parent) return null
      return parent.children[parent.children.indexOf(node) + 1] || null
    },
  })
  node.cloneNode = function (deep) {
    const copy = richElement(this.tagName, this.attributes)
    copy.hidden = this.hidden
    copy.style = { ...this.style }
    copy.textContent = this.textContent
    if (deep) this.children.forEach((child) => copy.appendChild(child.cloneNode(true)))
    return copy
  }
  if (text != null) node.textContent = text
  return node
}

function authoredTableRow(title, field, value) {
  const wrap = richElement('div', {
    'booking-element-wrap': '',
    'display-flex': '',
    class: 'call-details_table-item',
  })
  const titleBox = richElement('div', { class: 'call-details_table-title' })
  titleBox.appendChild(richElement('p', {}, title))
  const valueBox = richElement('div', { class: 'call-details_table-label' })
  const hook = richElement('p', { 'booking-element': field, class: 'text-size-regular' }, value)
  valueBox.appendChild(hook)
  wrap.appendChild(titleBox)
  wrap.appendChild(valueBox)
  return { wrap, hook }
}

function f52Panel(panelName, { messageBlock, messageField, rows = [['Duration', 'duration', '30min']] } = {}) {
  const modal = richElement('dialog', { 'popup-booking-info': '' })
  modal.ownerDocument = { createElement: (tag) => richElement(tag) }
  const panel = richElement('div', { 'booking-popup-content': panelName })
  const column = richElement('div', { class: 'call-details_layout' })
  const heading = richElement('p', {}, 'Heading')
  const table = richElement('div', { class: 'call-details_table-details' })
  const authored = rows.map(([title, field, value]) => authoredTableRow(title, field, value))
  authored.forEach((row) => table.appendChild(row.wrap))
  column.appendChild(heading)
  column.appendChild(table)
  let block = null
  let link = null
  if (messageBlock) {
    block = richElement('div', { [messageBlock]: '' })
    const copy = richElement('p', {}, 'Reach out via the ')
    link = richElement('a', { 'booking-element': messageField }, 'Messages tab')
    copy.appendChild(link)
    block.appendChild(copy)
    column.appendChild(block)
  }
  const footer = richElement('div')
  footer.appendChild(richElement('a', { 'booking-action-btn': 'switch-base' }))
  footer.appendChild(richElement('a', { 'booking-action-btn': 'switch-cancel-reason' }))
  panel.appendChild(column)
  panel.appendChild(footer)
  modal.appendChild(panel)
  // The open dialog renders the panel; a Message link inside a hidden block
  // renders no box, so it is not an authoritative Message control.
  panel.getClientRects = () => [{ width: 320, height: 400 }]
  if (link) link.getClientRects = () => []
  return { modal, panel, column, heading, table, authored, block, link, footer }
}

function summaryRowsOf(table) {
  return table.children
    .filter((row) => row.getAttribute('data-starters-call-summary-row') != null)
    .map((row) => [
      row.getAttribute('data-starters-call-summary-row'),
      row.children[0].children[0].textContent,
      row.children[1].children[0].textContent,
    ])
}

const F52_BOOKING = {
  booking_id: 'f52-booking',
  status: 'confirmed',
  start: 10_000,
  duration: 30,
  call_context: '',
  brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
  starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
}

// The module's own date text for F52_BOOKING, read through the public row model.
const F52_DATE = api.detailSupplementRows(F52_BOOKING, 'brand', 'UTC', 'base')
  .find((row) => row.field === 'start-date').value

test('Brand cancel step: module rows join the authored table and the Message line stays in the card', () => {
  const view = f52Panel('cancel', {
    messageBlock: 'reschedule-blocked-info',
    messageField: 'starter-message-link',
  })
  assert.ok(api.ensureDetailSupplements(view.modal, F52_BOOKING, 'brand', 'UTC') > 0)

  // The authored Duration row stays authoritative; the missing fields become
  // extra rows of the same table, cloned from the authored row.
  assert.deepEqual(summaryRowsOf(view.table), [
    ['starter-name', 'Starter', 'Sam'],
    ['start-date', 'Date and time', F52_DATE],
  ])
  assert.equal(view.table.children[0], view.authored[0].wrap)
  const row = view.table.children[1]
  assert.equal(row.parentNode, view.table)
  assert.equal(row.getAttribute('class'), 'call-details_table-item', 'keeps the authored row typography')
  assert.equal(row.getAttribute('booking-element-wrap'), null)
  assert.equal(row.querySelectorAll('[booking-element]').length, 0, 'no controller hook is copied')
  assert.equal(row.hidden, false)
  assert.equal(row.style.display, 'flex')
  assert.equal(view.panel.querySelector('[data-starters-call-summary-rows]'), null, 'no second bordered table')

  // The Message line sits in the card column right after the hidden block,
  // and the panel keeps only the column and the footer.
  const supplement = view.panel.querySelector('[data-starters-call-summary]')
  assert.equal(supplement.parentNode, view.column)
  assert.deepEqual(view.column.children, [view.heading, view.table, view.block, supplement])
  assert.deepEqual(view.panel.children, [view.column, view.footer])
  assert.equal(supplement.style.marginTop, '0')
  assert.equal(supplement.hidden, false)
  assert.equal(supplement.children.length, 1)
  const message = supplement.querySelector('[data-starters-call-message]')
  assert.equal(message.href, '/messages?with=mem_starter')

  // Repeated passes (populate, the frame pass, a repaint) keep one row per field.
  api.ensureDetailSupplements(view.modal, F52_BOOKING, 'brand', 'UTC')
  api.ensureDetailSupplements(view.modal, F52_BOOKING, 'brand', 'UTC')
  assert.deepEqual(summaryRowsOf(view.table).map(([field]) => field), ['starter-name', 'start-date'])
  assert.equal(view.panel.querySelectorAll('[data-starters-call-summary]').length, 1)
  assert.equal(view.panel.querySelectorAll('[data-starters-call-message]').length, 1)
  assert.deepEqual(view.column.children, [view.heading, view.table, view.block, supplement])

  // A later pass with fewer missing fields removes the stale row.
  api.ensureDetailSupplements(view.modal, { ...F52_BOOKING, start: undefined }, 'brand', 'UTC')
  assert.deepEqual(summaryRowsOf(view.table).map(([field]) => field), ['starter-name'])

  // An identity reset removes the in-table rows and the Message line.
  const originalDocument = global.document
  const originalActions = global.StartersDashboardCallActions
  try {
    global.StartersDashboardCallActions = undefined
    global.document = { querySelector: () => view.modal }
    api.resetDetailModal()
    assert.deepEqual(view.table.children, [view.authored[0].wrap])
    assert.equal(view.modal.querySelectorAll('[data-starters-call-summary-row]').length, 0)
    assert.equal(view.modal.querySelector('[data-starters-call-message]'), null)
  } finally {
    global.document = originalDocument
    global.StartersDashboardCallActions = originalActions
  }
})

test('Starter steps put the Message line after the hidden pending-info block', () => {
  const view = f52Panel('decline', {
    messageBlock: 'pending-info-text',
    messageField: 'brand-message-link',
    rows: [['Duration', 'duration', '30min'], ['Brand', 'brand-name', '[Brand]']],
  })
  api.ensureDetailSupplements(view.modal, { ...F52_BOOKING, status: 'pending' }, 'starter', 'UTC')
  const supplement = view.panel.querySelector('[data-starters-call-summary]')
  assert.deepEqual(view.column.children, [view.heading, view.table, view.block, supplement])
  assert.equal(supplement.querySelector('[data-starters-call-message]').href, '/messages?with=mem_brand')
  assert.deepEqual(summaryRowsOf(view.table), [['start-date', 'Date and time', F52_DATE]])
  assert.deepEqual(view.panel.children, [view.column, view.footer])
})

test('a panel with no Message control puts the module line right after the table', () => {
  // F04 "Request time updated": no context hook and no Message control.
  const view = f52Panel('reschedule-updated', {
    rows: [['Duration', 'duration', '30min'], ['Starter', 'starter-name', '[Starter]']],
  })
  const booking = { ...F52_BOOKING, status: 'pending', call_context: 'Discuss launch' }
  api.ensureDetailSupplements(view.modal, booking, 'brand', 'UTC')
  assert.deepEqual(summaryRowsOf(view.table), [
    ['start-date', 'Date and time', F52_DATE],
    ['context', 'Call', 'Discuss launch'],
  ])
  const supplement = view.panel.querySelector('[data-starters-call-summary]')
  assert.deepEqual(view.column.children, [view.heading, view.table, supplement])
  assert.equal(supplement.querySelector('[data-starters-call-message]').href, '/messages?with=mem_starter')
  for (let pass = 0; pass < 3; pass += 1) {
    api.ensureDetailSupplements(view.modal, booking, 'brand', 'UTC')
  }
  assert.deepEqual(summaryRowsOf(view.table).map(([field]) => field), ['start-date', 'context'])
})

test('a hidden authored template row still yields a visible module row with fresh text', () => {
  const view = f52Panel('declined', {
    rows: [['Duration', 'duration', '30min']],
  })
  // resetDetailModal and populate hide an unused authored row the same way.
  const template = view.authored[0]
  template.wrap.hidden = true
  template.wrap.style.display = 'none'
  template.hook.hidden = true
  template.hook.style.display = 'none'
  const booking = { ...F52_BOOKING, status: 'declined', cancelled_reason: 'Not available' }
  api.ensureDetailSupplements(view.modal, booking, 'brand', 'UTC')
  const reason = view.table.children.find((row) =>
    row.getAttribute('data-starters-call-summary-row') === 'decline-reason')
  assert.ok(reason, 'the Free declined panel gets a Decline reason row')
  assert.equal(reason.hidden, false)
  assert.equal(reason.style.display, 'flex')
  assert.equal(reason.children[1].children[0].hidden, false)
  assert.equal(reason.children[1].children[0].style.display, '')
  assert.equal(reason.children[0].children[0].textContent, 'Decline reason')
  assert.equal(reason.children[1].children[0].textContent, 'Not available')
  // The authored row itself is left exactly as the populate pass set it.
  assert.equal(template.wrap.hidden, true)
  assert.equal(template.hook.textContent, '30min')
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
    end: Date.now() + 90_000,
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
  assert.equal(view.fields['meeting-link'].getAttribute('data-meeting-href'), 'https://meet.example/current')
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
      rescheduleKindFor(role, candidate, now) {
        eligibilityCalls.push({ role, candidate, now })
        return 'reschedule-propose'
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
    global.StartersDashboardCallActions.rescheduleKindFor = () => ''
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
  const modalMeeting = element({ 'booking-element': 'meeting-link' })
  modalMeeting.tagName = 'P'
  const modalGroup = element({ 'booking-element-wrap': '' })
  modalField.closest = (selector) => selector === '[booking-element-wrap]' ? modalGroup : null
  modalMeeting.closest = (selector) => selector === '[booking-element-wrap]' ? modalGroup : null
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
    '[booking-element]': [modalField, modalMeeting],
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
    clearInterval() {},
    document,
    location: { pathname: '/brand-dashboard' },
    setInterval() {
      return 1
    },
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
  modalMeeting.textContent = 'https://meet.google.com/member-a-room'
  modalMeeting.setAttribute('data-meeting-href', 'https://meet.google.com/member-a-room')
  modalMeeting.setAttribute('role', 'link')
  modalMeeting.setAttribute('tabindex', '0')
  modalMeeting.hidden = false
  modalMeeting.style.display = ''
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
  assert.equal(modalMeeting.textContent, '')
  assert.equal(modalMeeting.hasAttribute('data-meeting-href'), false)
  assert.equal(modalMeeting.hasAttribute('role'), false)
  assert.equal(modalMeeting.hasAttribute('tabindex'), false)
  assert.equal(modalMeeting.hidden, true)
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
    clearInterval() {},
    document,
    location: { pathname: '/brand-dashboard' },
    setInterval() {
      return 1
    },
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

test('F18 request links parse from the query and normalize #calls to the live anchor', () => {
  const bookingId = '00d39a7b-40be-436f-b794-a6832215234b'
  assert.deepEqual(api.callDeepLinkLocator({
    hostname: 'www.thestarters.com',
    search: '?booking_id=' + bookingId + '&revision=7&environment=production',
    hash: '#calls',
  }), { bookingId, revision: 7, environment: 'production' })
  const location = {
    pathname: '/starter-dashboard',
    search: '?booking_id=' + bookingId + '&revision=7&environment=production',
    hash: '#calls',
  }
  let replaced = ''
  assert.equal(api.normalizeCallsAnchor(location, {
    replaceState(_state, _title, url) { replaced = url },
  }), true)
  assert.equal(
    replaced,
    '/starter-dashboard?booking_id=' + bookingId + '&revision=7&environment=production#calls-section',
  )
})

test('F18 exact query-only request links recover a lost fragment and normalize to the live anchor', () => {
  const bookingId = '2f3bec74-0f47-4a98-ae8b-c6d38a1d5fa8'
  const search = '?booking_id=' + bookingId + '&revision=1&environment=production'
  const location = {
    hostname: 'www.thestarters.com',
    pathname: '/starter-dashboard',
    search,
    hash: '',
  }
  assert.deepEqual(api.callDeepLinkLocator(location), {
    bookingId,
    revision: 1,
    environment: 'production',
  })
  let replaced = ''
  assert.equal(api.normalizeCallsAnchor(location, {
    replaceState(_state, _title, url) { replaced = url },
  }), true)
  assert.equal(replaced, '/starter-dashboard' + search + '#calls-section')
})

test('F18 query-only recovery rejects incomplete, malformed, and non-call locators', () => {
  const bookingId = '2f3bec74-0f47-4a98-ae8b-c6d38a1d5fa8'
  const base = {
    hostname: 'www.thestarters.com',
    pathname: '/starter-dashboard',
    hash: '',
  }
  ;[
    '?booking_id=' + bookingId + '&revision=1',
    '?booking_id=' + bookingId + '&revision=one&environment=production',
    '?booking_id=not-a-uuid&revision=1&environment=production',
    '?booking_id=' + bookingId + '&revision=1&environment=test',
    '?booking_id=' + bookingId + '&booking_id=00000000-0000-4000-8000-000000000000&revision=1&environment=production',
    '?booking_id=' + bookingId + '&booking_id=' + bookingId + '&revision=1&environment=production',
    '?booking_id=' + bookingId + '&booking_id=&revision=1&environment=production',
    '?booking_id=' + bookingId + '&revision=1&environment=production&thread=7',
    '?thread=7',
  ].forEach((search) => {
    const location = { ...base, search }
    assert.equal(api.callDeepLinkLocator(location), null)
    assert.equal(api.normalizeCallsAnchor(location, { replaceState() {} }), false)
  })
})

test('F18 query-only recovery is limited to the production Starter dashboard', () => {
  const bookingId = '2f3bec74-0f47-4a98-ae8b-c6d38a1d5fa8'
  const search = '?booking_id=' + bookingId + '&revision=1&environment=production'
  ;[
    { hostname: 'www.thestarters.com', pathname: '/brand-dashboard', search, hash: '' },
    { hostname: 'www.thestarters.com', pathname: '/starter-dashboard---availability-stage', search, hash: '' },
    {
      hostname: 'the-starters-3-0.webflow.io',
      pathname: '/starter-dashboard',
      search: search.replace('production', 'test'),
      hash: '',
    },
  ].forEach((location) => {
    assert.equal(api.callDeepLinkLocator(location), null)
    assert.equal(api.normalizeCallsAnchor(location, { replaceState() {} }), false)
  })
})

test('F18 fragment-based links retain their existing dashboard and query behavior', () => {
  const bookingId = '2f3bec74-0f47-4a98-ae8b-c6d38a1d5fa8'
  const locator = api.callDeepLinkLocator({
    hostname: 'the-starters-3-0.webflow.io',
    pathname: '/brand-dashboard',
    search: '?booking_id=' + bookingId + '&revision=1&environment=test&thread=7',
    hash: '#calls-section',
  })
  assert.deepEqual(locator, { bookingId, revision: 1, environment: 'test' })
})

test('F18 request locators reject malformed, fragment-carried, and cross-environment values', () => {
  const bookingId = '00d39a7b-40be-436f-b794-a6832215234b'
  assert.equal(api.callDeepLinkLocator({
    hostname: 'www.thestarters.com',
    search: '?booking_id=' + bookingId + '&revision=7&environment=test',
    hash: '#calls',
  }), null)
  assert.equal(api.callDeepLinkLocator({
    hostname: 'www.thestarters.com',
    search: '',
    hash: '#calls?booking_id=' + bookingId + '&revision=7&environment=production',
  }), null)
  assert.equal(api.callDeepLinkLocator({
    hostname: 'www.thestarters.com',
    search: '?booking_id=not-a-uuid&revision=7&environment=production',
    hash: '#calls',
  }), null)
  assert.equal(api.callDeepLinkLocator({
    hostname: 'www.thestarters.com',
    search: '?booking_id=' + bookingId + '&revision=7&environment=production',
    hash: '#messages',
  }), null)
})

test('F18 canonical focus binds participant, environment, revision, and current actionability', () => {
  const bookingId = '00d39a7b-40be-436f-b794-a6832215234b'
  const locator = { bookingId, revision: 7, environment: 'production' }
  const booking = api.normalizeBooking({
    booking_id: bookingId,
    lifecycle_revision: 7,
    data_environment: 'production',
    status: 'pending',
    confirmation_expires_at: 10_000,
    start: 20_000,
    starter_data: { memberstack_id: 'mem_starter' },
    brand_data: { memberstack_id: 'mem_brand' },
  })
  const current = api.canonicalDeepLinkState(locator, [booking], 'mem_starter', 'starter', 1_000)
  assert.equal(current.booking.booking_id, bookingId)
  assert.equal(current.readOnly, false)
  assert.equal(current.reason, 'current_actionable_request')

  const stale = api.canonicalDeepLinkState(
    { ...locator, revision: 6 }, [booking], 'mem_starter', 'starter', 1_000,
  )
  assert.equal(stale.readOnly, true)
  assert.equal(stale.reason, 'stale_revision')
  assert.equal(
    api.canonicalDeepLinkState(locator, [booking], 'mem_foreign', 'starter', 1_000),
    null,
  )
  assert.equal(
    api.canonicalDeepLinkState(
      { ...locator, environment: 'test' }, [booking], 'mem_starter', 'starter', 1_000,
    ),
    null,
  )
  assert.equal(
    api.canonicalDeepLinkState(locator, [booking], 'mem_brand', 'brand', 1_000).readOnly,
    true,
  )
  assert.equal(
    api.canonicalDeepLinkState(
      locator, [{ ...booking, status: 'confirmed' }], 'mem_starter', 'starter', 1_000,
    ).readOnly,
    true,
  )
  ;[undefined, null, ''].forEach((revision) => {
    const missingRevision = api.canonicalDeepLinkState(
      locator,
      [{ ...booking, lifecycle_revision: revision }],
      'mem_starter',
      'starter',
      1_000,
    )
    assert.equal(missingRevision.readOnly, true)
    assert.equal(missingRevision.reason, 'stale_revision')
  })
  ;[undefined, null, '', 'not-a-date', 1].forEach((expiry) => {
    const missingOrPastExpiry = api.canonicalDeepLinkState(
      locator,
      [{ ...booking, confirmation_expires_at: expiry }],
      'mem_starter',
      'starter',
      1_000,
    )
    assert.equal(missingOrPastExpiry.readOnly, true)
    assert.equal(missingOrPastExpiry.reason, 'current_state_read_only')
  })
  assert.equal(api.canonicalDeepLinkState(
    locator,
    [{ ...booking, start: 1, confirmation_expires_at: 10_000 }],
    'mem_starter',
    'starter',
    2_000,
  ).readOnly, true)
})

test('F18 booking 1072 query-only stale receipt opens canonical cancelled details read-only', () => {
  const originalDocument = global.document
  const originalLumos = global.lumos
  const bookingId = '2f3bec74-0f47-4a98-ae8b-c6d38a1d5fa8'
  const view = detailModalHarness()
  let opened = 0
  try {
    global.document = { querySelector: () => view.modal }
    global.lumos = {
      modal: {
        list: { 'popup-booking-info': {} },
        open() { opened += 1 },
      },
    }
    const locator = api.callDeepLinkLocator({
      hostname: 'www.thestarters.com',
      pathname: '/starter-dashboard',
      search: '?booking_id=' + bookingId + '&revision=1&environment=production',
      hash: '',
    })
    const result = api.focusCanonicalDeepLink(locator, [{
      booking_id: bookingId,
      lifecycle_revision: 3,
      data_environment: 'production',
      status: 'cancelled',
      start: 1_790_225_100_000,
      end: 1_790_226_900_000,
      paid_meeting: false,
      starter_data: { memberstack_id: 'mem_starter', name: 'Starter', timezone: 'UTC' },
      brand_data: { memberstack_id: 'mem_brand', name: 'Brand', timezone: 'UTC' },
    }], 'mem_starter', 'starter', 1_790_088_200_000)

    assert.deepEqual(result, { focused: true, readOnly: true, reason: 'stale_revision' })
    assert.equal(opened, 1)
    assert.equal(view.modal.getAttribute('data-booking-status'), 'cancelled')
    assert.equal(view.modal.getAttribute('data-booking-deep-link'), 'stale_revision')
    assert.equal(view.fields.status.textContent, 'Cancelled')
    assert.equal(view.cancelledPanel.hidden, false)
    assert.equal(view.actions[2].hidden, true)
    assert.equal(view.actions[3].hidden, true)
    assert.equal(view.actions[4].hidden, true)
    assert.equal(view.actions[0].hidden, false)
    assert.equal(view.message.hidden, false)
  } finally {
    global.document = originalDocument
    global.lumos = originalLumos
  }
})

test('F18 read-only focus disables mutation controls and restores their original state', () => {
  const controls = [
    element({ 'booking-action-btn': 'switch-confirm' }),
    element({ 'booking-action-btn': 'reschedule' }),
    element({ 'payment-action-btn': 'change-card' }),
  ]
  controls[0].disabled = false
  controls[1].setAttribute('aria-disabled', 'mixed')
  controls[2].setAttribute('tabindex', '0')
  controls[2].hidden = true
  controls[2].style.display = 'inline-flex'
  const modal = element()
  modal.querySelectorAll = (selector) => {
    if (selector.includes('[booking-action-btn]')) return controls
    if (selector === '[data-booking-deep-link-disabled]') {
      return controls.filter((control) => control.hasAttribute('data-booking-deep-link-disabled'))
    }
    return []
  }
  assert.equal(api.makeDeepLinkDetailReadOnly(modal), 3)
  controls.forEach((control) => {
    assert.equal(control.hidden, true)
    assert.equal(control.getAttribute('aria-disabled'), 'true')
    assert.equal(control.getAttribute('tabindex'), '-1')
  })
  assert.equal(controls[0].disabled, true)

  assert.equal(api.resetDeepLinkDetailState(modal), 3)
  controls.forEach((control) => {
    assert.equal(control.hasAttribute('data-booking-deep-link-disabled'), false)
  })
  assert.equal(controls[0].disabled, false)
  assert.equal(controls[0].getAttribute('aria-disabled'), null)
  assert.equal(controls[1].getAttribute('aria-disabled'), 'mixed')
  assert.equal(controls[2].getAttribute('tabindex'), '0')
  assert.equal(controls[0].hidden, false)
  assert.equal(controls[2].hidden, true)
  assert.equal(controls[2].style.display, 'inline-flex')
})

test('F18 read-only focus preserves close, back, message, and media controls', () => {
  const preserved = [
    element({ 'booking-action-btn': 'switch-close' }),
    element({ 'booking-action-btn': 'switch-base' }),
    element({ 'booking-action-btn': 'message' }),
    element({ 'booking-action-btn': 'notetaker-media' }),
  ]
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const modal = element()
  modal.querySelectorAll = (selector) =>
    selector.includes('[booking-action-btn]') ? preserved.concat(accept) : []

  assert.equal(api.makeDeepLinkDetailReadOnly(modal), 1)
  preserved.forEach((control) => {
    assert.equal(control.hidden, false)
    assert.equal(control.hasAttribute('data-booking-deep-link-disabled'), false)
  })
  assert.equal(accept.hidden, true)
  assert.equal(accept.hasAttribute('data-booking-deep-link-disabled'), true)
})

test('a delayed action-gate repaint cannot reveal stale-link actions', () => {
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const modal = element({ 'data-booking-deep-link': 'stale_revision' })
  modal.querySelectorAll = (selector) => {
    if (selector.includes('[booking-action-btn]')) return [accept]
    if (selector === '[data-booking-deep-link-disabled]') {
      return accept.hasAttribute('data-booking-deep-link-disabled') ? [accept] : []
    }
    return []
  }
  modal.querySelector = () => null
  api.configureDetailActions(modal, 'starter', 'pending', {
    booking_id: '00d39a7b-40be-436f-b794-a6832215234b',
    status: 'pending',
    confirmation_expires_at: 10_000,
    start: 20_000,
    starter_data: { memberstack_id: 'mem_starter' },
  }, 1_000)
  assert.equal(accept.hidden, true)
  assert.equal(accept.getAttribute('aria-disabled'), 'true')
  assert.equal(accept.hasAttribute('data-booking-deep-link-disabled'), true)
})

test('F18 canonical focus waits for delayed Lumos readiness without refetching the booking', async () => {
  const originalDocument = global.document
  const originalLumos = global.lumos
  const view = detailModalHarness()
  const bookingId = '00d39a7b-40be-436f-b794-a6832215234b'
  let opened = 0
  let scheduled = 0
  try {
    global.document = { querySelector: () => view.modal }
    global.lumos = null
    const result = await api.focusCanonicalDeepLinkWhenReady(
      { bookingId, revision: 7, environment: 'production' },
      [{
        booking_id: bookingId,
        lifecycle_revision: 7,
        data_environment: 'production',
        status: 'pending',
        confirmation_expires_at: 10_000,
        start: 20_000,
        starter_data: { memberstack_id: 'mem_starter' },
        brand_data: { memberstack_id: 'mem_brand' },
      }],
      'mem_starter',
      'starter',
      1_000,
      1,
      () => 1,
      {
        delays: [0, 1],
        now: () => 1_000,
        setTimeout(resolve) {
          scheduled += 1
          global.lumos = {
            modal: {
              list: { 'popup-booking-info': {} },
              open() { opened += 1 },
            },
          }
          resolve()
        },
      },
    )
    assert.equal(result.focused, true)
    assert.equal(result.reason, 'current_actionable_request')
    assert.equal(scheduled, 1)
    assert.equal(opened, 1)
  } finally {
    global.document = originalDocument
    global.lumos = originalLumos
  }
})

test('F18 delayed focus stops when the authenticated session generation changes', async () => {
  const originalDocument = global.document
  const originalLumos = global.lumos
  const view = detailModalHarness()
  const bookingId = '00d39a7b-40be-436f-b794-a6832215234b'
  let generation = 1
  let opened = 0
  try {
    global.document = { querySelector: () => view.modal }
    global.lumos = null
    const result = await api.focusCanonicalDeepLinkWhenReady(
      { bookingId, revision: 7, environment: 'production' },
      [{
        booking_id: bookingId,
        lifecycle_revision: 7,
        data_environment: 'production',
        status: 'pending',
        confirmation_expires_at: 10_000,
        start: 20_000,
        starter_data: { memberstack_id: 'mem_starter' },
      }],
      'mem_starter', 'starter', 1_000, 1, () => generation,
      {
        delays: [0, 1],
        now: () => 1_000,
        setTimeout(resolve) {
          generation = 2
          global.lumos = {
            modal: {
              list: { 'popup-booking-info': {} },
              open() { opened += 1 },
            },
          }
          resolve()
        },
      },
    )
    assert.equal(result.focused, false)
    assert.equal(result.reason, 'session_changed')
    assert.equal(opened, 0)
  } finally {
    global.document = originalDocument
    global.lumos = originalLumos
  }
})

test('F18 delayed focus rechecks canonical expiry when the modal becomes ready', async () => {
  const originalDocument = global.document
  const originalLumos = global.lumos
  const view = detailModalHarness()
  const bookingId = '00d39a7b-40be-436f-b794-a6832215234b'
  const times = [1_000, 11_000_000]
  try {
    global.document = { querySelector: () => view.modal }
    global.lumos = null
    const result = await api.focusCanonicalDeepLinkWhenReady(
      { bookingId, revision: 7, environment: 'production' },
      [{
        booking_id: bookingId,
        lifecycle_revision: 7,
        data_environment: 'production',
        status: 'pending',
        confirmation_expires_at: 10_000,
        start: 20_000,
        starter_data: { memberstack_id: 'mem_starter' },
      }],
      'mem_starter', 'starter', 1_000, 1, () => 1,
      {
        delays: [0, 1],
        now: () => times.shift(),
        setTimeout(resolve) {
          global.lumos = {
            modal: {
              list: { 'popup-booking-info': {} },
              open() {},
            },
          }
          resolve()
        },
      },
    )
    assert.equal(result.focused, true)
    assert.equal(result.readOnly, true)
    assert.equal(result.reason, 'current_state_read_only')
    assert.equal(view.modal.getAttribute('data-booking-deep-link'), 'current_state_read_only')
  } finally {
    global.document = originalDocument
    global.lumos = originalLumos
  }
})

test('authenticated canonical rows reach F18 focus only after render, including an off-page booking', async () => {
  const originalDocument = global.document
  const originalFetch = global.xanoAuthFetch
  const root = element()
  const appended = []
  const list = element()
  list.appendChild = (child) => appended.push(child)
  const refs = {
    name: 'requests', filter: 'all', rows: [], rendered: 0,
    list, template: element(), loader: element(), empty: element(),
    loadMore: element(), filters: element(), count: element(), section: element(),
  }
  const rows = Array.from({ length: 8 }, (_unused, index) => ({
    booking_id: '00000000-0000-4000-8000-' + String(index).padStart(12, '0'),
    lifecycle_revision: 1,
    data_environment: 'production',
    status: 'pending',
    start: 20_000 + index,
    starter_data: { memberstack_id: 'mem_starter' },
  }))
  let callback = null
  try {
    global.document = { documentElement: root, querySelector: () => null }
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => rows })
    assert.equal(await api.refreshSession(
      { getCurrentMember: async () => ({ id: 'mem_starter' }) },
      [refs], 'starter', 1, () => 1, false,
      { onCanonicalRows(canonicalRows, memberId, role) {
        callback = { canonicalRows, memberId, role, rendered: refs.rendered }
      } },
    ), true)
    assert.equal(callback.canonicalRows.length, 8)
    assert.equal(callback.canonicalRows[7].booking_id, rows[7].booking_id)
    assert.equal(callback.memberId, 'mem_starter')
    assert.equal(callback.role, 'starter')
    assert.equal(callback.rendered, 6)
    assert.equal(appended.length, 6)
  } finally {
    global.document = originalDocument
    global.xanoAuthFetch = originalFetch
  }
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

test('bookingMessageHref builds the counterpart deep link per role', () => {
  assert.equal(
    api.bookingMessageHref('starter', { brand_data: { memberstack_id: 'mem_b1' } }),
    '/messages?with=mem_b1',
  )
  assert.equal(
    api.bookingMessageHref('brand', { starter_data: { memberstack_id: 'mem_s1' } }),
    '/messages?with=mem_s1',
  )
  assert.equal(api.bookingMessageHref('brand', { starter_data: {} }), '')
  assert.equal(api.bookingMessageHref('starter', null), '')
})

test('details populate restores only the counterpart Messages tab link', () => {
  const booking = {
    booking_id: 'free-msg',
    status: 'confirmed',
    start: 10_000,
    duration: 30,
    brand_data: { name: 'Brand', timezone: 'UTC', memberstack_id: 'mem_b1' },
    starter_data: { name: 'Starter', timezone: 'UTC', memberstack_id: 'mem_s1' },
  }
  // resetDetailModal clears authored booking-element nodes; the next populate
  // must restore the counterpart link's text, destination, and visibility, and
  // must leave the signed-in member's own identity row without a thread link.
  function reset(view) {
    ;['brand-message-link', 'starter-message-link'].forEach((name) => {
      view.fields[name].textContent = ''
      view.fields[name].href = ''
      view.fields[name].hidden = true
    })
  }

  const starterView = detailModalHarness()
  reset(starterView)
  assert.equal(
    api.populateDetailModal(starterView.modal, booking, 'starter', 2_000),
    true,
  )
  assert.equal(starterView.fields['brand-message-link'].href, '/messages?with=mem_b1')
  assert.equal(starterView.fields['brand-message-link'].textContent, 'Messages tab')
  assert.equal(starterView.fields['brand-message-link'].hidden, false)
  assert.equal(starterView.fields['starter-message-link'].href, '')
  assert.equal(starterView.fields['starter-message-link'].textContent, '')
  assert.equal(starterView.fields['starter-message-link'].hidden, true)

  const brandView = detailModalHarness()
  reset(brandView)
  assert.equal(api.populateDetailModal(brandView.modal, booking, 'brand', 2_000), true)
  assert.equal(brandView.fields['starter-message-link'].href, '/messages?with=mem_s1')
  assert.equal(brandView.fields['starter-message-link'].textContent, 'Messages tab')
  assert.equal(brandView.fields['starter-message-link'].hidden, false)
  assert.equal(brandView.fields['brand-message-link'].href, '')
  assert.equal(brandView.fields['brand-message-link'].hidden, true)

  // An unknown counterpart id still leaves the authored link a live
  // destination, since the copy sends the member to the Messages tab.
  const anonymous = detailModalHarness()
  reset(anonymous)
  api.populateDetailModal(
    anonymous.modal,
    { ...booking, brand_data: { name: 'Brand', timezone: 'UTC' } },
    'starter',
    2_000,
  )
  assert.equal(anonymous.fields['brand-message-link'].href, '/messages')
  assert.equal(anonymous.fields['brand-message-link'].hidden, false)
})

test('an authored Message control suppresses the module-owned one only where it renders', () => {
  const document = { createElement: (tag) => domElement(tag) }
  const modal = domElement('dialog')
  modal.ownerDocument = document
  const base = domElement('div', { 'booking-popup-content': 'base' })
  const authored = domElement('a', { 'booking-element': 'brand-message-link' })
  base.appendChild(authored)
  const cancelled = domElement('div', { 'booking-popup-content': 'cancelled' })
  modal.appendChild(base)
  modal.appendChild(cancelled)
  const box = [{ width: 120, height: 44 }]
  const boxless = { authored: false }
  base.getClientRects = () => box
  cancelled.getClientRects = () => box
  authored.getClientRects = () => (boxless.authored ? [] : box)
  const booking = {
    start: 10_000,
    duration: 30,
    cancelled_reason: 'Schedule changed',
    brand_data: { name: 'Northwind', memberstack_id: 'mem_brand', timezone: 'UTC' },
    starter_data: { name: 'Sam', memberstack_id: 'mem_starter', timezone: 'UTC' },
  }

  api.ensureDetailSupplements(modal, booking, 'starter', 'UTC')
  assert.equal(
    base.querySelector('[data-starters-call-message]'),
    null,
    'the panel that renders an authored Message control keeps it authoritative',
  )
  const cancelledMessage = cancelled.querySelector('[data-starters-call-message]')
  assert.ok(
    cancelledMessage,
    'a panel with no authored Message control still gets the module-owned one',
  )
  assert.equal(cancelledMessage.href, '/messages?with=mem_brand')

  // A hidden authored control is not authoritative.
  authored.hidden = true
  api.ensureDetailSupplements(modal, booking, 'starter', 'UTC')
  assert.ok(base.querySelector('[data-starters-call-message]'))

  // Neither is one that generates no box inside a rendered panel.
  authored.hidden = false
  boxless.authored = true
  api.ensureDetailSupplements(modal, booking, 'starter', 'UTC')
  assert.ok(base.querySelector('[data-starters-call-message]'))

  boxless.authored = false
  api.ensureDetailSupplements(modal, booking, 'starter', 'UTC')
  assert.equal(base.querySelector('[data-starters-call-message]'), null)
})

test('delegated Message clicks route to the counterpart thread', () => {
  let clickListener
  const originalDocument = global.document
  const originalLocation = global.location
  try {
    global.document = {
      addEventListener(name, listener, capture) {
        assert.equal(name, 'click')
        assert.equal(capture, true)
        clickListener = listener
      },
    }
    const visited = []
    global.location = { assign: (href) => visited.push(href) }
    const booking = {
      booking_id: 'booking-msg',
      status: 'confirmed',
      brand_data: { memberstack_id: 'mem_b1' },
    }
    const card = {
      getAttribute: (name) => (name === 'data-booking-id' ? 'booking-msg' : null),
    }
    const control = (carrier) => ({
      closest: (selector) => (selector === '[data-booking-id]' ? carrier : null),
    })
    const clickOn = (button) => {
      const counts = { prevented: 0, stopped: 0 }
      clickListener({
        target: {
          closest: (selector) => (selector.includes('message') ? button : null),
        },
        preventDefault() { counts.prevented += 1 },
        stopImmediatePropagation() { counts.stopped += 1 },
      })
      return counts
    }
    api.wireBookingMessages([{ rows: [booking] }], 'starter')

    assert.deepEqual(clickOn(control(card)), { prevented: 1, stopped: 1 })
    assert.deepEqual(visited, ['/messages?with=mem_b1'])

    // A click on anything else is left alone.
    assert.deepEqual(clickOn(null), { prevented: 0, stopped: 0 })
    assert.equal(visited.length, 1)

    // An unresolved booking bails before swallowing the click.
    assert.deepEqual(clickOn(control(null)), { prevented: 0, stopped: 0 })
    assert.equal(visited.length, 1)

    // So does a counterpart with no canonical Memberstack ID.
    delete booking.brand_data.memberstack_id
    assert.deepEqual(clickOn(control(card)), { prevented: 0, stopped: 0 })
    assert.equal(visited.length, 1)

    // With no navigable host the authored control keeps its own behaviour.
    booking.brand_data.memberstack_id = 'mem_b1'
    global.location = {}
    assert.deepEqual(clickOn(control(card)), { prevented: 0, stopped: 0 })
    assert.equal(visited.length, 1)
  } finally {
    global.document = originalDocument
    global.location = originalLocation
  }
})

test('modal Message button shows only with a known counterpart id', () => {
  const view = detailModalHarness()
  const booking = {
    booking_id: 'free-msg-btn',
    status: 'confirmed',
    start: 10_000,
    duration: 30,
    brand_data: { name: 'Brand', timezone: 'UTC', memberstack_id: 'mem_b1' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }
  api.populateDetailModal(view.modal, booking, 'starter', 2_000)
  assert.equal(view.message.hidden, false)

  const anonymous = detailModalHarness()
  delete booking.brand_data.memberstack_id
  api.populateDetailModal(anonymous.modal, booking, 'starter', 2_000)
  assert.equal(anonymous.message.hidden, true)
})

test('card Message button shows only with a known counterpart id', () => {
  const message = element({ 'booking-card-action-btn': 'message', href: '/messages' })
  message.tagName = 'A'
  const card = {
    querySelectorAll() {
      return [message]
    },
  }
  api.configureActionButtons(card, 'brand', 'confirmed', {
    status: 'confirmed',
    starter_data: { memberstack_id: 'mem_s1' },
  })
  assert.equal(message.hidden, false)
  assert.equal(message.getAttribute('href'), '/messages?with=mem_s1')

  api.configureActionButtons(card, 'brand', 'confirmed', {
    status: 'confirmed',
    starter_data: {},
  })
  assert.equal(message.hidden, true)
  assert.equal(message.getAttribute('href'), null)
})

test('card Message writes the counterpart thread onto a nested authored link', () => {
  const link = element({ href: '/messages' })
  link.tagName = 'A'
  const message = element({ 'booking-card-action-btn': 'message' })
  message.querySelectorAll = (selector) => (selector === 'a' ? [link] : [])
  const card = { querySelectorAll: () => [message] }

  api.configureActionButtons(card, 'starter', 'pending', {
    status: 'pending',
    brand_data: { memberstack_id: 'mem_brand_party' },
  })

  assert.equal(link.getAttribute('href'), '/messages?with=mem_brand_party')
})

test('show honors the authored display-flex marker', () => {
  const details = element({ 'booking-card-action-btn': 'details', 'display-flex': '' })
  const plain = element({ 'booking-card-action-btn': 'details' })
  const card = {
    querySelectorAll() {
      return [details, plain]
    },
  }
  api.configureActionButtons(card, 'starter', 'pending')
  assert.equal(details.hidden, false)
  assert.equal(details.style.display, 'flex')
  assert.equal(plain.style.display, '')
})

test('detailOpenPanel routes terminal bookings to authored panels', () => {
  const panels = { cancelled: true, declined: true }
  const modal = {
    querySelector(selector) {
      const match = selector.match(/^\[booking-popup-content="(.+)"\]$/)
      return match && panels[match[1]] ? {} : null
    },
  }
  assert.equal(api.detailOpenPanel(modal, { status: 'cancelled' }, 'cancelled'), 'cancelled')
  assert.equal(api.detailOpenPanel(modal, { status: 'declined' }, 'cancelled'), 'declined')
  assert.equal(api.detailOpenPanel(modal, { status: 'expired' }, 'cancelled'), 'cancelled')
  assert.equal(api.detailOpenPanel(modal, { status: 'confirmed' }, 'confirmed'), 'base')
  // completed has no authored panel yet, so it stays on base
  assert.equal(api.detailOpenPanel(modal, { status: 'confirmed' }, 'completed'), 'base')
  const brandModal = {
    querySelector(selector) {
      return selector === '[booking-popup-content="cancelled"]' ? {} : null
    },
  }
  // a view without a declined panel falls back to the cancelled panel
  assert.equal(api.detailOpenPanel(brandModal, { status: 'declined' }, 'cancelled'), 'cancelled')
})

test('completed details stay canonical after clicks and reload for both roles', (context) => {
  const originalActions = global.StartersDashboardCallActions
  const originalDocument = global.document
  global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
  context.after(function () {
    global.StartersDashboardCallActions = originalActions
    global.document = originalDocument
  })
  const booking = {
    booking_id: 'completed-duplicate-panels',
    status: 'completed',
    start: 10_000,
    end: 11_000,
    duration: 30,
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }
  for (const [role, order] of [
    ['starter', ['proposal-result', 'terminal']],
    ['brand', ['terminal', 'proposal-result']],
  ]) {
    for (const load of ['initial', 'reload']) {
      const view = completedDetailModalHarness(order)
      let clickListener
      global.document = {
        addEventListener(name, listener, capture) {
          assert.equal(name, 'click')
          assert.equal(capture, true)
          clickListener = listener
        },
        querySelector() {
          return view.modal
        },
      }
      const card = {
        getAttribute(name) {
          return name === 'data-booking-id' ? booking.booking_id : null
        },
      }
      const details = {
        closest(selector) {
          return selector === '[data-booking-id]' ? card : null
        },
      }
      api.wireBookingDetails([{ rows: [booking] }], role)
      clickListener({
        target: {
          closest(selector) {
            if (selector.includes('reschedule')) return null
            if (selector.includes('popup-booking-info')) return details
            return null
          },
        },
      })

      assert.equal(view.base.hidden, true, role + ' ' + load + ' base panel')
      for (const [index, kind] of order.entries()) {
        const panel = view.completedPanels[index]
        assert.equal(panel.hidden, kind !== 'terminal', role + ' ' + load + ' ' + kind)
        assert.equal(panel.style.display, kind === 'terminal' ? 'flex' : 'none')
      }
    }
  }
})

test('completed details fall back to base if the terminal panel is missing or ambiguous', (context) => {
  const originalActions = global.StartersDashboardCallActions
  global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
  context.after(function () {
    global.StartersDashboardCallActions = originalActions
  })
  const booking = {
    booking_id: 'completed-panel-fallback',
    status: 'completed',
    start: 10_000,
    end: 11_000,
    duration: 30,
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }
  for (const order of [
    ['proposal-result'],
    ['terminal', 'terminal'],
  ]) {
    const view = completedDetailModalHarness(order)
    assert.equal(api.detailOpenPanel(view.modal, booking, 'completed'), 'base')
    assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 20_000), true)
    assert.equal(view.base.hidden, false)
    for (const panel of view.completedPanels) assert.equal(panel.hidden, true)
  }
})

test('completed details hide the proposal result when the actions module is unavailable', (context) => {
  const originalActions = global.StartersDashboardCallActions
  global.StartersDashboardCallActions = null
  context.after(function () {
    global.StartersDashboardCallActions = originalActions
  })
  const view = completedDetailModalHarness(['proposal-result', 'terminal'])
  const booking = {
    booking_id: 'completed-no-actions-module',
    status: 'completed',
    start: 10_000,
    end: 11_000,
    duration: 30,
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }
  assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 20_000), true)
  assert.equal(view.base.hidden, true)
  assert.equal(view.completedPanels[0].hidden, true)
  assert.equal(view.completedPanels[0].style.display, 'none')
  assert.equal(view.completedPanels[1].hidden, false)
})

test('naturally completed Paid details preserve both authored completed panels', (context) => {
  const originalActions = global.StartersDashboardCallActions
  global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
  context.after(function () {
    global.StartersDashboardCallActions = originalActions
  })
  const view = completedDetailModalHarness(['proposal-result', 'terminal'])
  const booking = {
    booking_id: 'paid-completed-panels',
    status: 'confirmed',
    start: 10_000,
    end: 11_000,
    duration: 30,
    is_paid: true,
    price: 120,
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }
  assert.equal(api.bookingStatus(booking, 20_000), 'completed')
  assert.equal(api.detailOpenPanel(view.modal, booking, 'completed'), 'completed')
  assert.equal(api.populateDetailModal(view.modal, booking, 'brand', 20_000), true)
  assert.equal(view.base.hidden, true)
  for (const panel of view.completedPanels) {
    assert.equal(panel.hidden, false)
    assert.equal(panel.style.display, 'flex')
  }
})

test('details open the authored cancelled panel for a cancelled booking', () => {
  const view = detailModalHarness()
  const booking = {
    booking_id: 'terminal-one',
    status: 'cancelled',
    start: 10_000,
    duration: 30,
    cancelled_reason: 'The request has expired',
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }
  assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 2_000), true)
  assert.equal(view.cancelledPanel.hidden, false)
  assert.equal(view.base.hidden, true)
  assert.equal(view.confirmation.hidden, true)
})

test('a cancelled booking with its own authored panel opens on that panel', () => {
  const panels = { cancelled: true, declined: true, expired: true }
  // `expired` is authored here on purpose: even when a Designer adds the panel,
  // no booking carries a raw `expired` status, so the shared cancelled panel
  // stays the destination.
  const modal = {
    querySelector(selector) {
      const match = selector.match(/^\[booking-popup-content="(.+)"\]$/)
      return match && panels[match[1]] ? {} : null
    },
  }
  assert.equal(api.detailOpenPanel(modal, { status: 'expired' }, 'cancelled'), 'cancelled')
  assert.equal(api.detailOpenPanel(modal, { status: 'declined' }, 'cancelled'), 'declined')
  assert.equal(api.detailOpenPanel(modal, { status: 'canceled' }, 'cancelled'), 'cancelled')
})

test('paid call details keep the authored charge and refund copy', (context) => {
  const originalActions = global.StartersDashboardCallActions
  global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
  context.after(function () {
    global.StartersDashboardCallActions = originalActions
  })
  const view = detailModalHarness()
  const booking = {
    booking_id: 'paid-cancelled',
    status: 'cancelled',
    start: 10_000,
    duration: 30,
    is_paid: true,
    price: 120,
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }

  assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 2_000), true)
  assert.equal(view.duplicatePayment.hidden, false)

  booking.is_paid = false
  booking.price = 0
  assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 2_000), true)
  assert.equal(view.duplicatePayment.hidden, true)
})

test('opening on a terminal panel hides the authored back control', (context) => {
  const originalActions = global.StartersDashboardCallActions
  global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
  context.after(function () {
    global.StartersDashboardCallActions = originalActions
  })
  const view = detailModalHarness()
  const booking = {
    booking_id: 'terminal-back',
    status: 'cancelled',
    start: 10_000,
    duration: 30,
    brand_data: { name: 'Brand', timezone: 'UTC' },
    starter_data: { name: 'Starter', timezone: 'UTC' },
  }

  assert.equal(api.populateDetailModal(view.modal, booking, 'starter', 2_000), true)
  assert.equal(view.cancelledPanel.hidden, false)
  assert.equal(view.back.hidden, true)
  assert.equal(view.back.style.display, 'none')

  // Navigating away from base inside the open modal still exposes the control.
  global.StartersDashboardCallActions.switchPopupContent(view.modal, 'cancelled')
  assert.equal(view.back.hidden, false)
})

test('generated reschedule receipts preserve canonical base dates across deferred rendering', () => {
  const actions = require('./dashboard-call-actions.js')
  const originalFrame = global.requestAnimationFrame
  try {
    for (const role of ['brand', 'starter']) {
      const frames = []
      global.requestAnimationFrame = callback => frames.push(callback)
      const document = { createElement: tag => domElement(tag) }
      const modal = domElement('dialog', { 'popup-booking-info': '' })
      modal.ownerDocument = document
      const base = domElement('div', { 'booking-popup-content': 'base' })
      modal.appendChild(base)
      actions.ensureRescheduleViews(document, modal)
      const receipt = modal.querySelector('[booking-popup-content="reschedule-proposed"]')
      assert.ok(receipt)
      const booking = {
        booking_id: 'generated-' + role,
        status: 'confirmed',
        start: Date.now() + 72 * 60 * 60 * 1000,
        end: Date.now() + 73 * 60 * 60 * 1000,
        duration: 60,
        brand_data: { name: 'Brand', timezone: 'UTC' },
        starter_data: { name: 'Starter', timezone: 'Asia/Manila' },
      }
      const date = panel => panel.querySelector('[data-starters-call-summary-row="start-date"]').children[1].textContent
      api.populateDetailModal(modal, booking, role)
      const canonicalDate = date(base)
      assert.equal(date(receipt), canonicalDate)
      const proposal = { ...booking, start: booking.start + 86400000, end: booking.end + 86400000 }
      api.populateDetailModal(modal, proposal, role, undefined, 'reschedule-proposed')
      actions.switchPopupContent(modal, 'reschedule-proposed')
      const proposedDate = date(receipt)
      assert.notEqual(proposedDate, canonicalDate)
      assert.equal(date(base), canonicalDate)
      frames.splice(0).forEach(callback => callback())
      assert.equal(date(receipt), proposedDate)
      assert.equal(date(base), canonicalDate)

      const handlers = []
      document.addEventListener = (event, handler) => {
        if (event === 'click') handlers.push(handler)
      }
      document.querySelector = () => modal
      actions.wire({ document, role, getBooking() { throw new Error('Unexpected booking lookup') } })
      const button = {
        getAttribute(name) { return name === 'booking-action-btn' ? 'switch-base' : null },
        closest(selector) { return selector.includes('popup-booking-info') ? modal : this },
      }
      handlers.forEach(handler => handler({
        target: button, preventDefault() {}, stopImmediatePropagation() {},
      }))
      assert.equal(base.hidden, false)
      assert.equal(receipt.hidden, true)
      assert.equal(date(base), canonicalDate)

      api.populateDetailModal(modal, { ...proposal, status: 'pending' }, role)
      frames.splice(0).forEach(callback => callback())
      assert.equal(date(base), proposedDate)
      assert.equal(date(modal.querySelector('[booking-popup-content="reschedule-updated"]')), proposedDate)
    }
  } finally {
    global.requestAnimationFrame = originalFrame
  }
})


test('call card binds its Join Call destination and clears it for ineligible rebinding', () => {
  const card = element()
  const wrap = element()
  const link = anchorElement({ 'booking-element': 'meeting-link', href: '/' })
  link.closest = () => wrap
  card.querySelectorAll = (selector) => selector === '[booking-element="meeting-link"]' ? [link] : []
  const booking = { status: 'confirmed', start: Date.now() + 86400000, end: Date.now() + 88200000, meeting_link: 'https://meet.google.com/abc-defg-hij' }
  for (const role of ['brand', 'starter']) {
    api.bindCard(card, booking, role)
    assert.equal(link.getAttribute('href'), booking.meeting_link)
    assert.equal(link.hidden, false)
    assert.equal(wrap.hidden, false)
    for (const changed of [
      { status: 'pending' }, { status: 'cancelled' }, { status: 'completed' },
      { meeting_link: '' }, { meeting_link: 'javascript:alert(1)' },
      { meeting_link: '/' },
    ]) {
      api.bindCard(card, { ...booking, ...changed }, role)
      assert.equal(link.hasAttribute('href'), false)
      assert.equal(link.hasAttribute('target'), false)
      assert.equal(link.hasAttribute('rel'), false)
      assert.equal(link.hidden, true)
      assert.equal(wrap.hidden, true)
    }
    api.bindCard(card, {
      ...booking,
      status: 'rescheduled',
      start_old: booking.start,
      end_old: booking.end,
    }, role)
    assert.equal(link.getAttribute('href'), booking.meeting_link)
    assert.equal(link.hidden, false)
  }
})

test('rescheduled Join destinations follow the still-confirmed original end', () => {
  const previousNow = Date.now
  const now = 2_000_000_000_000
  Date.now = () => now
  try {
    for (const role of ['brand', 'starter']) {
      const card = element()
      const cardWrap = element()
      const anchor = anchorElement({ 'booking-element': 'meeting-link' })
      anchor.closest = selector => selector === '[booking-element-wrap]' ? cardWrap : null
      card.querySelectorAll = selector => selector === '[booking-element="meeting-link"]' ? [anchor] : []
      const view = detailModalHarness()
      const originalSlot = {
        status: 'rescheduled',
        start: now - 90_000,
        end: now - 60_000,
        start_old: now - 30_000,
        end_old: now + 60_000,
        duration: 30,
        meeting_link: 'https://meet.google.com/original-slot',
        brand_data: { name: 'Brand', timezone: 'UTC' },
        starter_data: { name: 'Starter', timezone: 'UTC' },
      }
      const assertDestinations = (booking, visible) => {
        api.bindCard(card, booking, role)
        api.populateDetailModal(view.modal, booking, role, now)
        if (visible) {
          assert.equal(anchor.getAttribute('href'), booking.meeting_link)
          assert.equal(view.fields['meeting-link'].getAttribute('data-meeting-href'), booking.meeting_link)
        } else {
          assert.equal(anchor.hasAttribute('href'), false)
          assert.equal(view.fields['meeting-link'].hasAttribute('data-meeting-href'), false)
        }
        assert.equal(anchor.hidden, !visible)
        assert.equal(view.fields['meeting-link'].hidden, !visible)
      }

      assertDestinations(originalSlot, true)
      assertDestinations({ ...originalSlot, end: now + 60_000, end_old: now }, false)
      assertDestinations({ ...originalSlot, end: now + 60_000, end_old: undefined }, false)
      assertDestinations({
        ...originalSlot,
        status: 'confirmed',
        end: now + 60_000,
        end_old: now - 60_000,
      }, true)
    }
  } finally {
    Date.now = previousNow
  }
})

test('authored details paragraph opens the current Meet URL for either role', () => {
  const previousOpen = global.open
  const opened = []
  global.open = (...args) => opened.push(args)
  try {
    for (const role of ['brand', 'starter']) {
      const view = detailModalHarness()
      const meeting = view.fields['meeting-link']
      const handlers = new Map()
      meeting.tagName = 'P'
      delete meeting.href
      meeting.addEventListener = (type, handler) => handlers.set(type, handler)
      const booking = {
        status: 'confirmed', start: Date.now() + 86400000,
        end: Date.now() + 88200000, duration: 30,
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        brand_data: { name: 'Brand', timezone: 'UTC' },
        starter_data: { name: 'Starter', timezone: 'UTC' },
      }
      api.populateDetailModal(view.modal, booking, role)
      assert.equal(meeting.textContent, booking.meeting_link)
      assert.equal(meeting.getAttribute('role'), 'link')
      assert.equal(meeting.getAttribute('tabindex'), '0')
      handlers.get('keydown')({ key: 'Enter', preventDefault() {} })
      assert.deepEqual(opened.at(-1), [booking.meeting_link, '_blank', 'noopener,noreferrer'])
      let spacePrevented = false
      handlers.get('keydown')({ key: ' ', preventDefault() { spacePrevented = true } })
      assert.equal(spacePrevented, false)
      assert.equal(opened.length, role === 'brand' ? 1 : 2)

      api.populateDetailModal(view.modal, { ...booking, status: 'cancelled' }, role)
      handlers.get('click')({ preventDefault() {} })
      assert.equal(meeting.getAttribute('data-meeting-href'), null)
      assert.equal(opened.length, role === 'brand' ? 1 : 2)
    }
  } finally {
    global.open = previousOpen
  }
})

test('meeting destinations prefer canonical time across device clock skew', () => {
  const previousActions = global.StartersDashboardCallActions
  const previousNow = Date.now
  const previousOpen = global.open
  const serverNow = 2_000_000_000_000
  let deviceNow = serverNow + 60 * 60 * 1000
  let canonicalNow = serverNow
  let observed = []
  const opened = []
  global.StartersDashboardCallActions = {
    canonicalNow(booking) {
      observed.push(booking)
      return canonicalNow
    },
  }
  Date.now = () => deviceNow
  global.open = (...args) => opened.push(args)
  try {
    for (const role of ['brand', 'starter']) {
      observed = []
      canonicalNow = serverNow
      deviceNow = serverNow + 60 * 60 * 1000
      const booking = {
        booking_id: 'canonical-meeting-' + role,
        status: 'confirmed',
        start: serverNow - 30 * 60 * 1000,
        end: serverNow + 60 * 1000,
        duration: 30,
        meeting_link: 'https://meet.google.com/canonical-' + role,
        brand_data: { name: 'Brand', timezone: 'UTC' },
        starter_data: { name: 'Starter', timezone: 'UTC' },
      }
      const card = element()
      const cardWrap = element()
      const anchor = anchorElement({ 'booking-element': 'meeting-link' })
      const anchorHandlers = new Map()
      anchor.closest = selector => selector === '[booking-element-wrap]' ? cardWrap : null
      anchor.addEventListener = (type, handler) => anchorHandlers.set(type, handler)
      card.querySelectorAll = selector => selector === '[booking-element="meeting-link"]' ? [anchor] : []
      const view = detailModalHarness()
      const paragraph = view.fields['meeting-link']
      const paragraphHandlers = new Map()
      paragraph.addEventListener = (type, handler) => paragraphHandlers.set(type, handler)

      api.bindCard(card, booking, role)
      api.populateDetailModal(view.modal, booking, role)
      assert.equal(anchor.getAttribute('href'), booking.meeting_link)
      assert.equal(paragraph.getAttribute('data-meeting-href'), booking.meeting_link)
      assert.ok(observed.length >= 2)
      assert.ok(observed.every(candidate => candidate === booking))

      canonicalNow = booking.end
      deviceNow = serverNow - 60 * 60 * 1000
      let anchorPrevented = false
      anchorHandlers.get('click')({
        preventDefault() { anchorPrevented = true },
        stopImmediatePropagation() {},
      })
      let paragraphPrevented = false
      paragraphHandlers.get('keydown')({
        key: 'Enter',
        preventDefault() { paragraphPrevented = true },
        stopImmediatePropagation() {},
      })
      assert.equal(anchorPrevented, true)
      assert.equal(paragraphPrevented, true)
      assert.equal(anchor.hasAttribute('href'), false)
      assert.equal(paragraph.hasAttribute('data-meeting-href'), false)
      assert.equal(opened.length, 0)
    }
  } finally {
    global.StartersDashboardCallActions = previousActions
    Date.now = previousNow
    global.open = previousOpen
  }
})

test('meeting destinations expire at call end for both roles without a canonical refresh', () => {
  const previousDocument = global.document
  const previousOpen = global.open
  const previousNow = Date.now
  const opened = []
  global.open = (...args) => opened.push(args)
  let currentTime = previousNow()
  Date.now = () => currentTime
  try {
    for (const role of ['brand', 'starter']) {
      currentTime += 24 * 60 * 60 * 1000
      const booking = {
        booking_id: 'ending-' + role,
        status: 'confirmed',
        start: currentTime - 30 * 60 * 1000,
        end: currentTime + 60 * 1000,
        duration: 30,
        meeting_link: 'https://meet.google.com/' + role + '-room',
        brand_data: { name: 'Brand', timezone: 'UTC' },
        starter_data: { name: 'Starter', timezone: 'UTC' },
      }
      const card = element({ 'data-booking-id': booking.booking_id })
      const cardWrap = element()
      const anchor = anchorElement({ 'booking-element': 'meeting-link' })
      const anchorHandlers = new Map()
      anchor.closest = selector => selector === '[booking-element-wrap]' ? cardWrap : null
      anchor.addEventListener = (type, handler) => anchorHandlers.set(type, handler)
      const auxiliaryWrap = element()
      const auxiliaryAnchor = anchorElement({ 'booking-element': 'meeting-link' })
      const auxiliaryHandlers = new Map()
      auxiliaryAnchor.closest = selector => selector === '[booking-element-wrap]' ? auxiliaryWrap : null
      auxiliaryAnchor.addEventListener = (type, handler) => auxiliaryHandlers.set(type, handler)
      const dragWrap = element()
      const dragAnchor = anchorElement({ 'booking-element': 'meeting-link' })
      const dragHandlers = new Map()
      dragAnchor.closest = selector => selector === '[booking-element-wrap]' ? dragWrap : null
      dragAnchor.addEventListener = (type, handler) => dragHandlers.set(type, handler)
      card.querySelectorAll = selector => selector === '[booking-element="meeting-link"]' ? [anchor, auxiliaryAnchor, dragAnchor] : []
      const view = detailModalHarness()
      const paragraph = view.fields['meeting-link']
      const paragraphHandlers = new Map()
      paragraph.addEventListener = (type, handler) => paragraphHandlers.set(type, handler)
      global.document = {
        querySelector: selector => selector === '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]' ? view.modal : null,
      }

      api.bindCard(card, booking, role)
      api.populateDetailModal(view.modal, booking, role, currentTime)
      const refs = [{
        rows: [booking],
        list: { querySelectorAll: selector => selector === '[data-booking-id]' ? [card] : [] },
      }]
      let tick
      let restarts = 0
      const stop = api.startBookingLifecycleTicker(refs, role, () => {
        restarts += 1
      }, {
        now: () => currentTime,
        setInterval(callback, delay) {
          assert.equal(delay, 10_000)
          tick = callback
          return role
        },
        clearInterval(timer) {
          assert.equal(timer, role)
        },
      })

      assert.equal(anchor.getAttribute('href'), booking.meeting_link)
      assert.equal(auxiliaryAnchor.getAttribute('href'), booking.meeting_link)
      assert.equal(dragAnchor.getAttribute('href'), booking.meeting_link)
      assert.equal(paragraph.getAttribute('data-meeting-href'), booking.meeting_link)
      let anchorPrevented = false
      anchorHandlers.get('click')({
        preventDefault() { anchorPrevented = true },
      })
      assert.equal(anchorPrevented, false)
      let auxiliaryPrevented = false
      auxiliaryHandlers.get('auxclick')({
        button: 1,
        preventDefault() { auxiliaryPrevented = true },
      })
      assert.equal(auxiliaryPrevented, false)
      let dragPrevented = false
      dragHandlers.get('dragstart')({
        preventDefault() { dragPrevented = true },
      })
      assert.equal(dragPrevented, false)
      const openedBefore = opened.length
      paragraphHandlers.get('click')({ preventDefault() {} })
      assert.equal(opened.length, openedBefore + 1)

      currentTime = booking.end
      let expiredDragPrevented = false
      let expiredDragStopped = false
      dragHandlers.get('dragstart')({
        preventDefault() { expiredDragPrevented = true },
        stopImmediatePropagation() { expiredDragStopped = true },
      })
      assert.equal(expiredDragPrevented, true)
      assert.equal(expiredDragStopped, true)
      assert.equal(dragAnchor.hasAttribute('href'), false)
      assert.equal(dragAnchor.hasAttribute('target'), false)
      assert.equal(dragAnchor.hasAttribute('rel'), false)
      assert.equal(dragAnchor.hidden, true)
      assert.equal(dragWrap.hidden, true)
      let expiredAuxiliaryPrevented = false
      let expiredAuxiliaryStopped = false
      auxiliaryHandlers.get('auxclick')({
        button: 1,
        preventDefault() { expiredAuxiliaryPrevented = true },
        stopImmediatePropagation() { expiredAuxiliaryStopped = true },
      })
      assert.equal(expiredAuxiliaryPrevented, true)
      assert.equal(expiredAuxiliaryStopped, true)
      assert.equal(auxiliaryAnchor.hasAttribute('href'), false)
      assert.equal(auxiliaryAnchor.hasAttribute('target'), false)
      assert.equal(auxiliaryAnchor.hasAttribute('rel'), false)
      assert.equal(auxiliaryAnchor.hidden, true)
      assert.equal(auxiliaryWrap.hidden, true)
      let expiredAnchorPrevented = false
      let expiredAnchorStopped = false
      anchorHandlers.get('click')({
        preventDefault() { expiredAnchorPrevented = true },
        stopImmediatePropagation() { expiredAnchorStopped = true },
      })
      assert.equal(expiredAnchorPrevented, true)
      assert.equal(expiredAnchorStopped, true)
      assert.equal(anchor.hasAttribute('href'), false)
      assert.equal(anchor.hidden, true)
      assert.equal(cardWrap.hidden, true)
      let expiredParagraphPrevented = false
      paragraphHandlers.get('keydown')({
        key: 'Enter',
        preventDefault() { expiredParagraphPrevented = true },
      })
      assert.equal(expiredParagraphPrevented, true)
      assert.equal(paragraph.hasAttribute('data-meeting-href'), false)
      assert.equal(paragraph.hasAttribute('role'), false)
      assert.equal(paragraph.hasAttribute('tabindex'), false)
      assert.equal(paragraph.hidden, true)
      assert.equal(paragraph.textContent, '')
      assert.equal(opened.length, openedBefore + 1)

      tick()
      assert.equal(view.panelCopies['meeting-link'].hasAttribute('data-meeting-href'), false)
      assert.equal(view.panelCopies['meeting-link'].hidden, true)
      paragraphHandlers.get('click')({ preventDefault() {} })
      assert.equal(opened.length, openedBefore + 1)
      assert.equal(restarts, 0)
      stop()
    }
  } finally {
    global.document = previousDocument
    global.open = previousOpen
    Date.now = previousNow
  }
})

test('successful cancellation clears current destinations before a failed refresh', async () => {
  const actions = require('./dashboard-call-actions.js')
  const previousDocument = global.document
  const previousFetch = global.xanoAuthFetch
  const previousStorage = global.sessionStorage
  const previousCrypto = global.crypto
  const previousError = console.error
  const now = Date.now()
  const booking = {
    booking_id: 'cancel-current-meeting',
    config_id: 'cancel-config',
    data_environment: 'test',
    status: 'confirmed',
    start: now + 60 * 60 * 1000,
    end: now + 90 * 60 * 1000,
    duration: 30,
    is_paid: false,
    meeting_link: 'https://meet.google.com/cancel-current',
    brand_data: { name: 'Brand', memberstack_id: 'brand-member', timezone: 'UTC' },
    starter_data: { name: 'Starter', memberstack_id: 'starter-member', timezone: 'UTC' },
  }
  const card = element({ 'data-booking-id': booking.booking_id })
  const cardWrap = element()
  const anchor = anchorElement({ 'booking-element': 'meeting-link' })
  anchor.closest = selector => selector === '[booking-element-wrap]' ? cardWrap : null
  card.querySelectorAll = selector => selector === '[booking-element="meeting-link"]' ? [anchor] : []
  const view = detailModalHarness()
  const reason = { value: 'Conflict came up' }
  const queryModal = view.modal.querySelector
  view.modal.querySelector = selector => selector === '[booking-cancel-reason]'
    ? reason
    : queryModal(selector)
  const refs = [{
    rows: [booking],
    list: { querySelectorAll: selector => selector === '[data-booking-id]' ? [card] : [] },
  }]
  const handlers = []
  const document = {
    addEventListener(type, handler) {
      if (type === 'click') handlers.push(handler)
    },
    removeEventListener(type, handler) {
      if (type !== 'click') return
      const index = handlers.indexOf(handler)
      if (index !== -1) handlers.splice(index, 1)
    },
    querySelector(selector) {
      return selector === '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]'
        ? view.modal
        : null
    },
  }
  const cancel = element({ 'booking-action-btn': 'cancel' })
  cancel.closest = selector => selector.includes('popup-booking-info') || selector.includes('dialog[')
    ? view.modal
    : cancel
  let restarts = 0
  let posts = 0
  try {
    global.document = document
    global.sessionStorage = memoryStorage()
    global.crypto = {
      subtle: previousCrypto.subtle,
      randomUUID: () => '00000000-0000-4000-8000-000000000099',
    }
    console.error = () => {}
    global.xanoAuthFetch = async () => {
      posts += 1
      return {
        ok: true,
        json: async () => ({
          cancel: { booking_id: booking.booking_id, status: 'cancelled' },
        }),
      }
    }
    api.bindCard(card, booking, 'brand')
    api.populateDetailModal(view.modal, booking, 'brand', now)
    actions.wire({
      document,
      role: 'brand',
      getBooking: () => booking,
      restart: () => {
        restarts += 1
        return Promise.reject(new Error('refresh unavailable'))
      },
      onCancelSuccess: (model, result) => api.applyCancellationResult(refs, model, result, now),
    })

    await handlers[0]({
      target: cancel,
      preventDefault() {},
      stopImmediatePropagation() {},
    })
    assert.equal(posts, 1)
    assert.equal(booking.status, 'cancelled')
    assert.equal(anchor.hasAttribute('href'), false)
    assert.equal(anchor.hidden, true)
    assert.equal(view.fields['meeting-link'].hasAttribute('data-meeting-href'), false)
    assert.equal(view.fields['meeting-link'].hasAttribute('role'), false)
    assert.equal(view.fields['meeting-link'].hasAttribute('tabindex'), false)
    assert.equal(view.fields['meeting-link'].hidden, true)
    assert.equal(restarts, 0)

    const close = element({ 'booking-action-btn': 'switch-close' })
    close.closest = selector => selector.includes('popup-booking-info') || selector.includes('dialog[')
      ? view.modal
      : close
    handlers.at(-1)({ target: close })
    await new Promise(setImmediate)
    assert.equal(restarts, 1)
    api.refreshMeetingDestinations(refs, now + 1)
    assert.equal(anchor.hasAttribute('href'), false)
    assert.equal(view.fields['meeting-link'].hasAttribute('data-meeting-href'), false)
  } finally {
    global.document = previousDocument
    global.xanoAuthFetch = previousFetch
    global.sessionStorage = previousStorage
    global.crypto = previousCrypto
    console.error = previousError
  }
})

test('Starter request Decline is exposed only with a loaded eligible contract and open response window', () => {
  const prior = global.StartersDashboardCallActions
  const button = element({ 'booking-action-btn': 'switch-decline' })
  const card = { querySelectorAll: () => [button] }
  const booking = { status: 'pending', data_environment: 'test', booking_id: 'b', config_id: 'c', start: Date.now() + 86400000 }
  try {
    global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
    api.configureActionButtons(card, 'starter', 'pending', booking)
    assert.equal(button.hidden, false)
    api.configureActionButtons(card, 'brand', 'pending', booking)
    assert.equal(button.hidden, true)
    api.configureActionButtons(card, 'starter', 'pending', { ...booking, confirmation_expires_at: Date.now() - 1000 })
    assert.equal(button.hidden, true)
    global.StartersDashboardCallActions = undefined
    api.configureActionButtons(card, 'starter', 'pending', booking)
    assert.equal(button.hidden, true)
  } finally { global.StartersDashboardCallActions = prior }
})


test('pending proposal cards retain confirmed time for both roles and adopt the accepted slot', () => {
  const booking = { status: 'rescheduled', start: Date.parse('2027-09-16T02:00:00Z'),
    start_old: Date.parse('2027-09-15T01:00:00Z'),
    brand_data: { timezone: 'UTC' }, starter_data: { timezone: 'Asia/Manila' } }
  for (const role of ['brand', 'starter']) {
    const card = element()
    const date = element()
    card.querySelector = selector => selector === '[booking-element="start-date"]' ? date : null
    const original = role === 'brand' ? 'Wed, Sep 15, 1:00 AM UTC' : 'Wed, Sep 15, 9:00 AM GMT+8'
    const proposed = role === 'brand' ? 'Thu, Sep 16, 2:00 AM UTC' : 'Thu, Sep 16, 10:00 AM GMT+8'
    api.bindCard(card, booking, role)
    assert.equal(date.textContent, original)
    for (const status of ['pending', 'confirmed', 'completed', 'cancelled']) {
      api.bindCard(card, { ...booking, status }, role)
      assert.equal(date.textContent, proposed)
    }
    for (const start_old of [null, 0, -1, 'invalid']) {
      api.bindCard(card, { ...booking, start_old }, role)
      assert.equal(date.textContent, 'Confirmed time unavailable')
    }
  }
})

test('reschedule decline clears incomplete original intervals before repaint', async () => {
  const actions = require('./dashboard-call-actions.js')
  const previous = {
    actions: global.StartersDashboardCallActions,
    fetch: global.xanoAuthFetch,
    storage: global.sessionStorage,
  }
  global.StartersDashboardCallActions = actions
  try {
    for (const role of ['brand', 'starter']) {
      for (const missingOriginal of ['start_old', 'end_old']) {
        global.sessionStorage = memoryStorage()
        const handlers = []
        const document = {
          createElement: tag => domElement(tag),
          addEventListener(type, handler) {
            if (type === 'click') handlers.push(handler)
          },
        }
        const modal = domElement('dialog', { 'popup-booking-info': '' })
        modal.ownerDocument = document
        document.querySelector = () => modal
        const base = domElement('div', { 'booking-popup-content': 'base' })
        const meetingWrap = domElement('div', { 'booking-element-wrap': '' })
        const meeting = domElement('p', { 'booking-element': 'meeting-link' })
        meetingWrap.appendChild(meeting)
        base.appendChild(meetingWrap)
        modal.appendChild(base)
        actions.ensureRescheduleViews(document, modal)
        const now = Date.now()
        const booking = {
          booking_id: 'decline-incomplete-' + role + '-' + missingOriginal,
          config_id: 'config',
          data_environment: 'test',
          status: 'rescheduled',
          rescheduled_by: role === 'brand' ? 'starter' : 'brand',
          start: now + 48 * 60 * 60 * 1000,
          end: now + 48 * 60 * 60 * 1000 + 30 * 60 * 1000,
          start_old: now + 24 * 60 * 60 * 1000,
          end_old: now + 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
          server_now_ms: now,
          duration: 30,
          price: 0,
          is_paid: false,
          meeting_link: 'https://meet.google.com/incomplete-original',
          brand_data: { memberstack_id: 'mem-brand', timezone: 'UTC' },
          starter_data: { memberstack_id: 'mem-starter', timezone: 'UTC' },
        }
        booking[missingOriginal] = null
        actions.bindCanonicalClock([booking], actions.monotonicNow())
        api.populateDetailModal(modal, booking, role)
        global.xanoAuthFetch = async () => ({
          ok: true,
          json: async () => ({
            reschedule_decline: {
              booking_id: booking.booking_id,
              status: 'confirmed',
              original_restored: true,
            },
          }),
        })
        actions.wire({
          document,
          role,
          getBooking: () => booking,
          refreshDetail: (target, model) => api.populateDetailModal(target, model, role),
        })
        const button = domElement('button', { 'booking-action-btn': 'reschedule-decline' })
        button.closest = selector => selector.includes('popup-booking-info') ? modal : button
        await handlers[0]({
          target: button,
          preventDefault() {},
          stopImmediatePropagation() {},
        })

        const currentField = missingOriginal === 'start_old' ? 'start' : 'end'
        const restoredField = missingOriginal === 'start_old' ? 'end' : 'start'
        const availableOriginal = missingOriginal === 'start_old' ? 'end_old' : 'start_old'
        assert.equal(booking.status, 'confirmed')
        assert.equal(booking[currentField], null)
        assert.equal(booking[restoredField], booking[availableOriginal])
        assert.equal(meeting.getAttribute('data-meeting-href'), null)
        assert.equal(meeting.hidden, true)
        assert.equal(meetingWrap.hidden, true)
      }
    }
  } finally {
    global.StartersDashboardCallActions = previous.actions
    global.xanoAuthFetch = previous.fetch
    global.sessionStorage = previous.storage
  }
})

test('reschedule responses refresh receipt and base without retaining proposal-only summary rows', async (context) => {
  const actions = require('./dashboard-call-actions.js')
  const previous = { fetch: global.xanoAuthFetch, storage: global.sessionStorage, actions: global.StartersDashboardCallActions }
  context.after(() => { global.xanoAuthFetch = previous.fetch; global.sessionStorage = previous.storage; global.StartersDashboardCallActions = previous.actions })
  global.StartersDashboardCallActions = actions
  for (const kind of ['confirm', 'decline']) for (const role of ['brand', 'starter']) for (const scenario of ['success', 'failure', 'transport-failure', 'switched-success', 'switched-failure', 'switched-transport-failure']) {
    // Both answers leave a confirmed call: #5760 restores a declined Free
    // proposal to its original confirmed time.
    const expectedStatus = 'confirmed'
    const values = new Map()
    global.sessionStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
    const handlers = []
    const document = { createElement: tag => domElement(tag), addEventListener(type, handler) { if (type === 'click') handlers.push(handler) } }
    const modal = domElement('dialog', { 'popup-booking-info': '' })
    modal.ownerDocument = document
    document.querySelector = () => modal
    const base = domElement('div', { 'booking-popup-content': 'base' })
    modal.appendChild(base)
    actions.ensureRescheduleViews(document, modal)
    const booking = { booking_id: 'accept-' + role, config_id: 'config', data_environment: 'test', status: 'rescheduled', rescheduled_by: role === 'brand' ? 'starter' : 'brand', start: Date.now() + 172800000, end: Date.now() + 174600000, start_old: Date.now() + 86400000, end_old: Date.now() + 88200000, duration: 30, price: 0, is_paid: false, brand_data: { memberstack_id: 'mem-brand', timezone: 'UTC' }, starter_data: { memberstack_id: 'mem-starter', timezone: 'Asia/Manila' } }
    booking.server_now_ms = Date.now()
    actions.bindCanonicalClock([booking], actions.monotonicNow())
    api.populateDetailModal(modal, booking, role)
    const receipt = modal.querySelector('[booking-popup-content="' + (kind === 'confirm' ? 'reschedule-accepted' : 'reschedule-declined') + '"]')
    assert.ok(receipt.querySelector('[data-starters-call-summary-row="start-date-old"]'))
    const requested = deferred()
    const response = deferred()
    global.xanoAuthFetch = async () => { requested.resolve(); return response.promise }
    actions.wire({ document, role, getBooking: () => booking, refreshDetail: (target, model) => api.populateDetailModal(target, model, role) })
    const button = domElement('button', { 'booking-action-btn': kind === 'confirm' ? 'confirm-reschedule' : 'reschedule-decline' })
    button.closest = selector => selector.includes('popup-booking-info') ? modal : button
    const action = handlers[0]({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
    await requested.promise
    const retryKeys = Array.from(values.entries())
    assert.ok(retryKeys.length > 0)
    if (scenario.startsWith('switched')) {
      api.populateDetailModal(modal, { ...booking, booking_id: 'other', status: 'confirmed', start: booking.start + 86400000, end: booking.end + 86400000 }, role)
    }
    const panelState = () => modal.querySelectorAll('[booking-popup-content]').map(panel => ({
      panel: panel.getAttribute('booking-popup-content'),
      hidden: panel.hidden,
      display: panel.style.display,
      rows: panel.querySelectorAll('[data-starters-call-summary-row]').map(row => ({
        field: row.getAttribute('data-starters-call-summary-row'),
        text: row.children.map(child => child.textContent),
      })),
    }))
    const pendingState = panelState()
    if (scenario.includes('transport')) {
      response.reject(new Error('Controlled transport failure'))
    } else if (scenario.endsWith('failure')) {
      response.resolve({ ok: false, json: async () => ({ message: 'Controlled failure' }) })
    } else {
      const result = { booking_id: booking.booking_id, status: expectedStatus }
      if (kind === 'decline') result.original_restored = true
      else {
        result.start = booking.start
        result.end = booking.end
      }
      response.resolve({ ok: true, json: async () => ({ ['reschedule_' + kind]: result }) })
    }
    await action
    if (scenario.endsWith('failure')) assert.deepEqual(Array.from(values.entries()), retryKeys, 'Failed attempt retains the same retry key')
    if (scenario !== 'success') {
      assert.equal(booking.status, 'rescheduled')
      assert.equal(receipt.hidden, true)
      assert.deepEqual(panelState(), pendingState, 'Delayed response preserves displayed dates and panels')
      if (scenario.startsWith('switched')) {
        assert.equal(modal.getAttribute('data-booking-id'), 'other')
        assert.equal(modal.querySelector('[data-starters-action-error]'), null)
      } else {
        assert.ok(values.size > 0, 'Failed attempt remains retryable')
        assert.equal(modal.querySelector('[data-starters-action-error]').textContent, scenario.includes('transport') ? 'Controlled transport failure' : 'Controlled failure')
      }
      continue
    }
    assert.equal(booking.status, expectedStatus)
    if (kind === 'decline') {
      assert.equal(booking.start, booking.start_old, 'Decline restores the original start')
      assert.equal(booking.end, booking.end_old, 'Decline restores the original end')
    }
    assert.equal(receipt.querySelector('[data-starters-call-summary-row="start-date-old"]'), null)
    assert.equal(base.querySelector('[data-starters-call-summary-row="start-date-old"]'), null)
    assert.equal(receipt.hidden, false)
  }
})


test('canonical reschedule originals normalize seconds without losing clock metadata', () => {
  const row=api.normalizeBooking({start:1800090000,end:1800091800,start_old:1800086400,end_old:1800088200,server_now_ms:1800000000000})
  assert.equal(row.start_old,1800086400000)
  assert.equal(row.end_old,1800088200000)
  assert.equal(row.server_now_ms,1800000000000)
})
test('clock-only refresh preserves rendered row identity comparisons', () => {
  const a={booking_id:'clock',start:1800090000000,server_now_ms:1800000000000}
  assert.equal(api.sameBookingRows([a],[{...a,server_now_ms:1800000001000}]),true)
  assert.equal(api.sameBookingRows([a],[{...a,start:a.start+1,server_now_ms:1800000001000}]),false)
})

const F12_SERVER_NOW = 1800000000000
function f12ClockRow(stamp = F12_SERVER_NOW) {
  const row = {
    booking_id: 'f12-clock-booking', config_id: 'f12-config',
    data_environment: 'test', status: 'confirmed', paid_meeting: false,
    grant_id: 'f12-grant', duration: 30,
    start: F12_SERVER_NOW + 8 * 3600000 + 5000,
    end: F12_SERVER_NOW + 8 * 3600000 + 1805000,
    brand_data: { memberstack_id: 'brand-f12' },
    starter_data: { memberstack_id: 'starter-f12' },
  }
  if (stamp != null) row.server_now_ms = stamp
  return row
}
function f12ClockRefs() {
  const list = element()
  let appendCount = 0
  list.appendChild = () => { appendCount++ }
  return {
    refs: {
      name: 'calls', filter: 'all', rows: [], rendered: 0,
      list, template: element(), loader: element(), empty: element(),
      loadMore: element(), filters: element(), count: element(), section: element(),
    },
    appendCount: () => appendCount,
  }
}

test('F12 canonical clock binds whether the action module loads before or after the authenticated read', async () => {
  const actions = require('./dashboard-call-actions.js')
  const original = {
    document: global.document, fetch: global.xanoAuthFetch,
    actions: global.StartersDashboardCallActions,
    performance: Object.getOwnPropertyDescriptor(global, 'performance'),
    wallNow: Date.now,
  }
  let mono = 100
  try {
    Object.defineProperty(global, 'performance', { configurable: true, value: { now: () => mono } })
    Date.now = () => F12_SERVER_NOW
    global.document = { documentElement: element(), querySelector: () => null, addEventListener() {} }
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => [f12ClockRow()] })
    const memberstack = { getCurrentMember: async () => ({ id: 'brand-f12' }) }
    for (const moduleFirst of [true, false]) {
      const { refs } = f12ClockRefs()
      global.StartersDashboardCallActions = moduleFirst ? actions : undefined
      assert.equal(await api.refreshSession(memberstack, [refs], 'brand', 1, () => 1, false), true)
      assert.equal(refs.rows.length, 1)
      assert.equal(actions.canProposeReschedule('brand', refs.rows[0]), moduleFirst)
      if (!moduleFirst) {
        global.StartersDashboardCallActions = actions
        await api.wireDashboardCallModules({
          document: global.document, getBooking: () => null,
          onAvailable(_module, key) {
            if (key === 'actions') api.bindBookingClocks(refs.rows)
          },
        })
        assert.equal(actions.canProposeReschedule('brand', refs.rows[0]), true)
      }
      mono += 100
    }
  } finally {
    global.document = original.document
    global.xanoAuthFetch = original.fetch
    global.StartersDashboardCallActions = original.actions
    Object.defineProperty(global, 'performance', original.performance)
    Date.now = original.wallNow
  }
})

test('F12 clock-only refresh retains the rendered row and replaces or invalidates its binding', async () => {
  const actions = require('./dashboard-call-actions.js')
  const original = {
    document: global.document, fetch: global.xanoAuthFetch,
    actions: global.StartersDashboardCallActions,
    performance: Object.getOwnPropertyDescriptor(global, 'performance'),
    wallNow: Date.now,
  }
  let mono = 100
  let stamp = F12_SERVER_NOW
  const view = f12ClockRefs()
  const memberstack = { getCurrentMember: async () => ({ id: 'brand-f12' }) }
  try {
    Object.defineProperty(global, 'performance', { configurable: true, value: { now: () => mono } })
    Date.now = () => F12_SERVER_NOW
    global.document = { documentElement: element(), querySelector: () => null }
    global.StartersDashboardCallActions = actions
    global.xanoAuthFetch = async () => ({ ok: true, json: async () => [f12ClockRow(stamp)] })
    assert.equal(await api.refreshSession(memberstack, [view.refs], 'brand', 1, () => 1, false), true)
    const retained = view.refs.rows[0]
    const painted = view.appendCount()
    assert.equal(actions.canonicalNow(retained), F12_SERVER_NOW)
    mono = 1100
    stamp = F12_SERVER_NOW + 1000
    assert.equal(await api.refreshSession(memberstack, [view.refs], 'brand', 1, () => 1, false, { preserveExisting: true }), true)
    assert.equal(view.refs.rows[0], retained)
    assert.equal(view.appendCount(), painted)
    assert.equal(actions.canonicalNow(retained), F12_SERVER_NOW + 1000)
    stamp = null
    assert.equal(await api.refreshSession(memberstack, [view.refs], 'brand', 1, () => 1, false, { preserveExisting: true }), true)
    assert.equal(view.refs.rows[0], retained)
    assert.equal(actions.canonicalNow(retained), null)
    assert.equal(actions.canProposeReschedule('brand', retained), false)
  } finally {
    global.document = original.document
    global.xanoAuthFetch = original.fetch
    global.StartersDashboardCallActions = original.actions
    Object.defineProperty(global, 'performance', original.performance)
    Date.now = original.wallNow
  }
})

test('F13: an expired cancellation shows Expired; other cancellations stay Cancelled', () => {
  const expired = { status: 'cancelled', cancelled_by: 'expired', start: 10_000, end: 20_000 }
  const cancelled = { status: 'cancelled', cancelled_by: 'brand', start: 10_000, end: 20_000 }
  for (const role of ['starter', 'brand']) {
    assert.equal(api.statusLabel(api.bookingStatus(expired, 30_000), role, expired), 'Expired')
    assert.equal(api.statusLabel(api.bookingStatus(cancelled, 30_000), role, cancelled), 'Cancelled')
    assert.equal(api.statusLabel('cancelled', role), 'Cancelled')
    assert.equal(api.statusLabel('confirmed', role, expired), 'Upcoming')
  }
})
