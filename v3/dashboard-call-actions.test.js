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
    }, 'booking-test-1'),
    true,
  )
  assert.equal(
    api.declineSucceeded({
      decline: { booking_id: 'booking-test-1', status: 'pending' },
    }, 'booking-test-1'),
    false,
  )
  assert.equal(
    api.declineSucceeded({
      decline: { booking_id: 'booking-other', status: 'declined' },
    }, 'booking-test-1'),
    false,
  )
  assert.equal(api.declineSucceeded(null, 'booking-test-1'), false)
})

test('a mismatched decline response retains the command key', async () => {
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
      return {
        ok: true,
        async json() {
          return {
            decline: { booking_id: 'booking-other', status: 'declined' },
          }
        },
      }
    }

    await assert.rejects(
      api.declineBooking(pendingBooking(), 'Not available'),
      /Canonical booking decline failed/,
    )
    await assert.rejects(
      api.declineBooking(pendingBooking(), 'Not available'),
      /Canonical booking decline failed/,
    )
    assert.equal(keys.length, 2)
    assert.equal(keys[1], keys[0])
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

function confirmedBooking() {
  return {
    booking_id: 'booking-test-2',
    config_id: 'config-test-1',
    data_environment: 'test',
    status: 'confirmed',
    start: Date.now() + 60 * 60 * 1000,
    starter_data: { memberstack_id: 'mem_sb_starter' },
    brand_data: { memberstack_id: 'mem_sb_brand' },
  }
}

function actionChainHarness(kind, restart) {
  const names =
    kind === 'cancel'
      ? ['base', 'cancel', 'cancel-reason', 'cancelled']
      : ['base', 'decline', 'decline-reason', 'declined']
  const contents = names.map(function (name) {
    return {
      hidden: name !== 'base',
      style: { display: name === 'base' ? 'flex' : 'none' },
      getAttribute(attribute) {
        return attribute === 'booking-popup-content' ? name : null
      },
    }
  })
  const reasonField = {
    value: kind === 'cancel' ? 'Conflict came up' : 'Not available',
    reportValidity() {},
    setCustomValidity() {},
  }
  const modal = {
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler
    },
    removeEventListener(event, handler) {
      if (this.listeners[event] === handler) delete this.listeners[event]
    },
    querySelector(selector) {
      const expected =
        kind === 'cancel' ? '[booking-cancel-reason]' : '[booking-decline-reason]'
      return selector === expected ? reasonField : null
    },
    querySelectorAll(selector) {
      return selector === '[booking-popup-content]' ? contents : []
    },
  }
  function actionButton(action) {
    return {
      attributes: {},
      closest(selector) {
        return selector.includes('[popup-booking-info]') ? modal : this
      },
      getAttribute(attribute) {
        return attribute === 'booking-action-btn' ? action : null
      },
      setAttribute(attribute, value) {
        this.attributes[attribute] = value
      },
    }
  }
  const clickHandlers = []
  const document = {
    addEventListener(event, handler) {
      if (event === 'click') clickHandlers.push(handler)
    },
    removeEventListener(event, handler) {
      if (event !== 'click') return
      const index = clickHandlers.indexOf(handler)
      if (index !== -1) clickHandlers.splice(index, 1)
    },
    querySelector() {
      return modal
    },
  }
  const booking = kind === 'cancel' ? confirmedBooking() : pendingBooking()
  api.wire({
    document,
    getBooking() {
      return booking
    },
    role: 'starter',
    restart,
  })
  return {
    async click(action) {
      const button = actionButton(action)
      const event = {
        target: button,
        preventDefault() {},
        stopImmediatePropagation() {},
      }
      for (const handler of clickHandlers.slice()) await handler(event)
    },
    assertActive(name) {
      contents.forEach(function (content) {
        const active = content.getAttribute('booking-popup-content') === name
        assert.equal(content.hidden, !active)
        assert.equal(content.style.display, active ? 'flex' : 'none')
      })
    },
    assertAllHidden() {
      contents.forEach(function (content) {
        assert.equal(content.hidden, true)
        assert.equal(content.style.display, 'none')
      })
    },
    booking,
    hideAll() {
      contents.forEach(function (content) {
        content.hidden = true
        content.style.display = 'none'
      })
    },
    reasonField,
  }
}

;[
  {
    kind: 'cancel',
    actions: ['switch-cancel', 'switch-cancel-reason', 'cancel'],
    panels: ['cancel', 'cancel-reason', 'cancelled'],
  },
  {
    kind: 'decline',
    actions: ['switch-decline', 'switch-decline-reason', 'decline'],
    panels: ['decline', 'decline-reason', 'declined'],
  },
].forEach(function (scenario) {
  test(scenario.kind + ' clicks reveal each authored modal panel', async () => {
    const originalFetch = global.xanoAuthFetch
    const originalStorage = global.sessionStorage
    const originalCrypto = global.crypto
    try {
      global.sessionStorage = storage()
      global.crypto = {
        subtle: originalCrypto.subtle,
        randomUUID() {
          return scenario.kind === 'cancel'
            ? '00000000-0000-4000-8000-000000000002'
            : '00000000-0000-4000-8000-000000000001'
        },
      }
      let restartCount = 0
      let harness
      const restart = async function () {
        restartCount += 1
        harness.hideAll()
      }
      harness = actionChainHarness(scenario.kind, restart)
      global.xanoAuthFetch = async function () {
        return {
          ok: true,
          async json() {
            return {
              [scenario.kind]: {
                booking_id: harness.booking.booking_id,
                status: scenario.kind === 'cancel' ? 'cancelled' : 'declined',
              },
            }
          },
        }
      }

      for (let index = 0; index < scenario.actions.length; index += 1) {
        await harness.click(scenario.actions[index])
        harness.assertActive(scenario.panels[index])
      }
      assert.equal(restartCount, 0)
      await harness.click('switch-close')
      await Promise.resolve()
      assert.equal(restartCount, 1)
      harness.assertAllHidden()
    } finally {
      global.xanoAuthFetch = originalFetch
      global.sessionStorage = originalStorage
      global.crypto = originalCrypto
    }
  })
})

test('a null command result keeps the reason panel and skips refresh', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalError = console.error
  let restartCount = 0
  const errors = []
  try {
    delete global.xanoAuthFetch
    console.error = function () {
      errors.push(Array.from(arguments))
    }
    const harness = actionChainHarness('cancel', function () {
      restartCount += 1
      harness.hideAll()
    })
    await harness.click('switch-cancel')
    await harness.click('switch-cancel-reason')
    await harness.click('cancel')

    harness.assertActive('cancel-reason')
    assert.equal(harness.reasonField.value, 'Conflict came up')
    assert.equal(restartCount, 0)
    assert.equal(errors.length, 1)
  } finally {
    global.xanoAuthFetch = originalFetch
    console.error = originalError
  }
})

test('cancel eligibility is participant-only, booked, future, scoped, and identified', () => {
  const booking = confirmedBooking()
  assert.equal(api.canCancel('starter', booking), true)
  assert.equal(api.canCancel('brand', booking), true)
  assert.equal(api.canCancel('guest', booking), false)
  assert.equal(api.canCancel('starter', { ...booking, status: 'pending' }), false)
  assert.equal(api.canCancel('starter', { ...booking, status: 'rescheduled' }), true)
  assert.equal(api.canCancel('starter', { ...booking, status: 'completed' }), false)
  assert.equal(api.canCancel('starter', { ...booking, start: Date.now() - 1000 }), false)
  assert.equal(api.canCancel('starter', { ...booking, data_environment: '' }), false)
  assert.equal(api.canCancel('starter', { ...booking, config_id: '' }), false)
  assert.equal(api.canCancel('brand', { ...booking, brand_data: {} }), false)
})

test('cancel payload requires a reason and a bounded durable cancel key', () => {
  const booking = confirmedBooking()
  const key = 'dashboard-cancel:00000000-0000-4000-8000-000000000002'
  assert.deepEqual(api.cancelPayload(booking, 'Conflict came up', key, 'brand'), {
    booking_id: booking.booking_id,
    config_id: booking.config_id,
    idempotency_key: key,
    cancelled_reason: 'Conflict came up',
  })
  assert.equal(api.cancelPayload(booking, '', key, 'brand'), null)
  assert.equal(api.cancelPayload(booking, 'No', 'invalid', 'brand'), null)
  assert.equal(
    api.cancelPayload(booking, 'No', 'dashboard-decline:00000000-0000-4000-8000-000000000002', 'brand'),
    null,
  )
})

test('cancel command uses only the canonical environment-safe endpoint', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const requests = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000002'
      },
    }
    global.xanoAuthFetch = async function (url, options) {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            cancel: {
              booking_id: 'booking-test-2',
              status: 'cancelled',
              revision: 3,
              cancelled_by: 'starter',
            },
            duplicate: false,
          }
        },
      }
    }
    const result = await api.cancelBooking(confirmedBooking(), 'Conflict came up', 'starter')
    assert.equal(result.cancel.status, 'cancelled')
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/booking\/cancel\/v3$/)
    assert.equal(requests[0].options.method, 'POST')
    const payload = JSON.parse(requests[0].options.body)
    assert.equal(payload.booking_id, 'booking-test-2')
    assert.equal(payload.config_id, 'config-test-1')
    assert.equal(payload.cancelled_reason, 'Conflict came up')
    assert.match(payload.idempotency_key, /^dashboard-cancel:/)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('cancel storage scope separates actors and reasons', async () => {
  const booking = confirmedBooking()
  const starterKey = await api.cancelStorageKey(booking, 'Reason one', 'starter')
  const brandKey = await api.cancelStorageKey(booking, 'Reason one', 'brand')
  const otherReason = await api.cancelStorageKey(booking, 'Reason two', 'starter')
  assert.notEqual(starterKey, brandKey)
  assert.notEqual(starterKey, otherReason)
  assert.equal(starterKey.includes('Reason one'), false)
  assert.match(starterKey, /^starters:dashboard-cancel:v1:test:/)
})

test('only an exact cancelled response clears the cancel command', () => {
  assert.equal(
    api.cancelSucceeded({
      cancel: { booking_id: 'booking-test-2', status: 'cancelled' },
    }, 'booking-test-2'),
    true,
  )
  assert.equal(
    api.cancelSucceeded({
      cancel: { booking_id: 'booking-test-2', status: 'confirmed' },
    }, 'booking-test-2'),
    false,
  )
  assert.equal(api.cancelSucceeded(null, 'booking-test-2'), false)
})

test('an ambiguous cancel retains the same idempotency key', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const keys = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000002'
      },
    }
    global.xanoAuthFetch = async function (_url, options) {
      keys.push(JSON.parse(options.body).idempotency_key)
      throw new Error('network outcome unknown')
    }
    const booking = confirmedBooking()
    await assert.rejects(
      api.cancelBooking(booking, 'Conflict came up', 'brand'),
      /network outcome unknown/,
    )
    await assert.rejects(
      api.cancelBooking(booking, 'Conflict came up', 'brand'),
      /network outcome unknown/,
    )
    assert.equal(keys.length, 2)
    assert.match(keys[0], /^dashboard-cancel:/)
    assert.equal(keys[1], keys[0])
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})
