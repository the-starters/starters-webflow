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
    customValidity: '',
    reportValidityCount: 0,
    reportValidity() {
      this.reportValidityCount += 1
    },
    setCustomValidity(message) {
      this.customValidity = message
    },
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

;['cancel', 'decline'].forEach(function (kind) {
  test(kind + ' requires a reason before submitting', async () => {
    const originalFetch = global.xanoAuthFetch
    let requestCount = 0
    let restartCount = 0
    try {
      global.xanoAuthFetch = async function () {
        requestCount += 1
        throw new Error('request must not run')
      }
      const harness = actionChainHarness(kind, function () {
        restartCount += 1
      })
      await harness.click('switch-' + kind)
      await harness.click('switch-' + kind + '-reason')
      harness.reasonField.value = '   '
      await harness.click(kind)

      harness.assertActive(kind + '-reason')
      assert.equal(harness.reasonField.customValidity, 'Please provide a reason.')
      assert.equal(harness.reasonField.reportValidityCount, 1)
      assert.equal(requestCount, 0)
      assert.equal(restartCount, 0)
    } finally {
      global.xanoAuthFetch = originalFetch
    }
  })
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
  // booking/cancel/v3 rejects Paid bookings until the paid-cancel fast follow
  // ships, so the button must stay hidden on them. A missing flag counts as
  // Free so legacy rows keep their Cancel.
  assert.equal(api.canCancel('starter', { ...booking, is_paid: true }), false)
  assert.equal(api.canCancel('brand', { ...booking, paid_meeting: true }), false)
  assert.equal(api.canCancel('starter', { ...booking, is_paid: false }), true)
  assert.equal(api.canCancel('starter', { ...booking, paid_meeting: null }), true)
})

test('a refused cancel surfaces the server message instead of the generic failure', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000002'
      },
    }
    global.xanoAuthFetch = async function () {
      return {
        ok: false,
        json: async function () {
          return {
            code: 'ERROR_CODE_INPUT_ERROR',
            message: 'Paid call cancellation is not available yet',
          }
        },
      }
    }
    await assert.rejects(
      api.cancelBooking(confirmedBooking(), 'Test cancel', 'brand'),
      /Paid call cancellation is not available yet/,
    )
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('showActionError renders a module-owned alert and clears it again', () => {
  const created = []
  const modal = {
    nodes: [],
    querySelector(selector) {
      if (selector !== '[data-starters-action-error]') return null
      return this.nodes[0] || null
    },
    appendChild(node) {
      this.nodes.push(node)
    },
    ownerDocument: {
      createElement() {
        const node = {
          hidden: false,
          style: {},
          textContent: '',
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = value
          },
        }
        created.push(node)
        return node
      },
    },
  }
  api.showActionError(modal, 'Paid call cancellation is not available yet')
  assert.equal(created.length, 1)
  assert.equal(created[0].textContent, 'Paid call cancellation is not available yet')
  assert.equal(created[0].attributes.role, 'alert')
  assert.equal(created[0].hidden, false)
  api.showActionError(modal, '')
  assert.equal(created[0].hidden, true)
  assert.equal(created[0].style.display, 'none')
  api.showActionError(modal, 'Second failure')
  assert.equal(created.length, 1)
  assert.equal(created[0].textContent, 'Second failure')
  assert.equal(created[0].hidden, false)
})

test('a blocked legacy Free booking is reported as unpaid', async () => {
  const originalWarn = console.warn
  let clickHandler
  let warning
  let prevented = 0
  let stopped = 0
  try {
    console.warn = function () {
      warning = Array.from(arguments)
    }
    api.wire({
      document: {
        addEventListener(_name, handler) {
          clickHandler = handler
        },
      },
      getBooking() {
        return pendingBooking()
      },
      role: 'starter',
    })
    const button = {
      closest() {
        return this
      },
      getAttribute(name) {
        return name === 'booking-action-btn' ? 'cancel' : null
      },
    }
    await clickHandler({
      target: button,
      preventDefault() {
        prevented += 1
      },
      stopImmediatePropagation() {
        stopped += 1
      },
    })
    assert.equal(warning[1].status, 'pending')
    assert.equal(warning[1].paid, false)
    assert.equal(warning[1].identified, true)
    assert.equal(prevented, 1)
    assert.equal(stopped, 1)
  } finally {
    console.warn = originalWarn
  }
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

function rescheduleBooking(overrides) {
  return Object.assign(
    {
      booking_id: 'booking-test-3',
      config_id: 'config-test-1',
      grant_id: 'grant-test-1',
      duration: 30,
      is_paid: false,
      data_environment: 'test',
      status: 'confirmed',
      start: Date.now() + 60 * 60 * 1000,
      starter_data: { memberstack_id: 'mem_sb_starter' },
      brand_data: { memberstack_id: 'mem_sb_brand' },
    },
    overrides || {},
  )
}

test('reschedule proposal eligibility requires a booked future call with calendar identity', () => {
  const booking = rescheduleBooking()
  assert.equal(api.canProposeReschedule('starter', booking), true)
  assert.equal(api.canProposeReschedule('brand', booking), true)
  assert.equal(api.canProposeReschedule('guest', booking), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, status: 'rescheduled' }), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, start: Date.now() - 1000 }), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, grant_id: '' }), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, duration: 0 }), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, is_paid: true }), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, is_paid: 'true' }), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, is_paid: undefined, paid_meeting: true }), false)
  assert.equal(api.canProposeReschedule('starter', { ...booking, is_paid: undefined, paid_meeting: false }), true)
  assert.equal(api.canProposeReschedule('starter', { ...booking, is_paid: undefined, paid_meeting: undefined }), false)
})

test('only the counterpart can respond to a pending proposal', () => {
  const booking = rescheduleBooking({ status: 'rescheduled', rescheduled_by: 'starter' })
  assert.equal(api.canRespondReschedule('brand', booking), true)
  assert.equal(api.canRespondReschedule('starter', booking), false)
  assert.equal(api.canRespondReschedule('brand', { ...booking, status: 'confirmed' }), false)
  assert.equal(api.canRespondReschedule('brand', { ...booking, rescheduled_by: '' }), false)
  assert.equal(api.canRespondReschedule('brand', { ...booking, is_paid: true }), false)
})

test('a reschedule proposal posts slot, reason, and a durable propose key', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const requests = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000003'
      },
    }
    global.xanoAuthFetch = async function (url, options) {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            reschedule: {
              booking_id: 'booking-test-3',
              status: 'rescheduled',
              revision: 3,
            },
            duplicate: false,
          }
        },
      }
    }
    const start = Date.now() + 2 * 60 * 60 * 1000
    const result = await api.proposeReschedule(
      rescheduleBooking(),
      'starter',
      'Need a later time',
      { start, end: start + 30 * 60 * 1000, timezone: 'Asia/Manila' },
    )
    assert.equal(result.reschedule.status, 'rescheduled')
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/booking\/reschedule\/propose\/v3$/)
    const payload = JSON.parse(requests[0].options.body)
    assert.equal(payload.rescheduled_reason, 'Need a later time')
    assert.equal(payload.new_start, start)
    assert.equal(payload.new_end, start + 30 * 60 * 1000)
    assert.equal(payload.timezone, 'Asia/Manila')
    assert.match(payload.idempotency_key, /^dashboard-reschedule-propose:/)
    assert.equal(await api.proposeReschedule(rescheduleBooking(), 'starter', 'x', { start: 5, end: 5 }), null)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('reschedule responses post the correct endpoint and succeed only on confirmed', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const requests = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000004'
      },
    }
    global.xanoAuthFetch = async function (url, options) {
      requests.push({ url, options })
      const key = url.includes('/confirm/') ? 'reschedule_confirm' : 'reschedule_decline'
      const body = {}
      body[key] = { booking_id: 'booking-test-3', status: 'confirmed', revision: 4 }
      body.duplicate = false
      return { ok: true, async json() { return body } }
    }
    const booking = rescheduleBooking({ status: 'rescheduled', rescheduled_by: 'starter' })
    const confirmed = await api.respondReschedule('reschedule-confirm', booking, 'brand')
    assert.equal(confirmed.reschedule_confirm.status, 'confirmed')
    assert.match(requests[0].url, /\/booking\/reschedule\/confirm\/v3$/)
    assert.match(JSON.parse(requests[0].options.body).idempotency_key, /^dashboard-reschedule-confirm:/)
    const declined = await api.respondReschedule('reschedule-decline', booking, 'brand')
    assert.equal(declined.reschedule_decline.status, 'confirmed')
    assert.match(requests[1].url, /\/booking\/reschedule\/decline\/v3$/)
    assert.equal(await api.respondReschedule('reschedule-confirm', booking, 'starter'), null)
    assert.equal(await api.respondReschedule('cancel', booking, 'brand'), null)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('an ambiguous reschedule response retains the same idempotency key', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const keys = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000005'
      },
    }
    global.xanoAuthFetch = async function (_url, options) {
      keys.push(JSON.parse(options.body).idempotency_key)
      throw new Error('network outcome unknown')
    }
    const booking = rescheduleBooking({ status: 'rescheduled', rescheduled_by: 'brand' })
    await assert.rejects(
      api.respondReschedule('reschedule-confirm', booking, 'starter'),
      /network outcome unknown/,
    )
    await assert.rejects(
      api.respondReschedule('reschedule-confirm', booking, 'starter'),
      /network outcome unknown/,
    )
    assert.equal(keys.length, 2)
    assert.equal(keys[1], keys[0])
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('reschedule calendar mounts stay scoped to the active modal booking', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const mounts = []
  const requests = []
  const container = { textContent: '' }
  const reasonField = { value: 'Need a later time' }
  let bookingId = 'booking-a'
  const modal = {
    getAttribute(name) {
      return name === 'data-booking-id' ? bookingId : null
    },
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      if (selector === '[booking-reschedule-reason]') return reasonField
      return null
    },
    querySelectorAll() {
      return []
    },
  }
  try {
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar(options) {
        mounts.push(options)
        return { slots: [] }
      },
    }
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000006'
      },
    }
    global.xanoAuthFetch = async function (_url, options) {
      requests.push(JSON.parse(options.body))
      return {
        ok: true,
        async json() {
          return {
            reschedule: {
              booking_id: bookingId,
              status: 'rescheduled',
            },
          }
        },
      }
    }
    const bookingA = rescheduleBooking({ booking_id: 'booking-a' })
    await api.mountRescheduleCalendar({}, modal, bookingA, 'starter', reasonField.value)
    bookingId = 'booking-b'
    const bookingB = rescheduleBooking({ booking_id: 'booking-b' })
    await api.mountRescheduleCalendar({}, modal, bookingB, 'starter', reasonField.value)

    assert.equal(mounts[0].isCurrent(), false)
    assert.equal(mounts[1].isCurrent(), true)
    const start = Date.now() + 2 * 60 * 60 * 1000
    await mounts[0].onConfirm({
      start,
      end: start + 30 * 60 * 1000,
      timezone: 'Pacific/Honolulu',
    })
    assert.equal(requests.length, 0)
    await mounts[1].onConfirm({
      start,
      end: start + 30 * 60 * 1000,
      timezone: 'Pacific/Honolulu',
    })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].booking_id, 'booking-b')
    assert.equal(requests[0].new_start, start)
    assert.equal(requests[0].new_end, start + 30 * 60 * 1000)
    assert.equal(requests[0].timezone, 'Pacific/Honolulu')
    assert.equal(reasonField.value, '')
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('reschedule proposal failures replace stale alerts with the server message', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  let mount
  let alert
  const container = { textContent: '' }
  const reasonField = { value: 'Need a later time' }
  const modal = {
    getAttribute(name) {
      return name === 'data-booking-id' ? 'booking-test-3' : null
    },
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      if (selector === '[booking-reschedule-reason]') return reasonField
      if (selector === '[data-starters-action-error]') return alert || null
      return null
    },
    appendChild(node) {
      alert = node
    },
    ownerDocument: {
      createElement() {
        return {
          hidden: false,
          style: {},
          textContent: '',
          setAttribute() {},
        }
      },
    },
  }
  try {
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar(options) {
        mount = options
      },
    }
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        return '00000000-0000-4000-8000-000000000006'
      },
    }
    global.xanoAuthFetch = async function () {
      assert.equal(alert.hidden, true)
      return {
        ok: false,
        async json() {
          return { message: 'That time is no longer available.' }
        },
      }
    }
    api.showActionError(modal, 'Previous booking failed')
    await api.mountRescheduleCalendar(
      {},
      modal,
      rescheduleBooking(),
      'starter',
      reasonField.value,
    )
    const start = Date.now() + 2 * 60 * 60 * 1000
    await assert.rejects(
      mount.onConfirm({ start, end: start + 30 * 60 * 1000 }),
      /That time is no longer available/,
    )
    assert.equal(alert.textContent, 'That time is no longer available.')
    assert.equal(alert.hidden, false)
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('resetting reschedule state clears booking-scoped input and calendar', () => {
  const reason = { value: 'Old reason' }
  const calendar = { textContent: 'Old calendar' }
  const modal = {
    __startersRescheduleCalendarToken: {},
    querySelector(selector) {
      if (selector === '[booking-reschedule-reason]') return reason
      if (selector === '[booking-reschedule-calendar]') return calendar
      return null
    },
  }
  assert.equal(api.resetRescheduleState(modal), true)
  assert.equal(reason.value, '')
  assert.equal(calendar.textContent, '')
  assert.equal(modal.__startersRescheduleCalendarToken, null)
})

test('respond controls are rendered into the base view for the counterpart', () => {
  function fakeElement(tag) {
    return {
      tagName: tag,
      children: [],
      attributes: {},
      style: {},
      hidden: false,
      parentNode: null,
      nextSibling: null,
      textContent: '',
      setAttribute(name, value) {
        this.attributes[name] = String(value)
      },
      removeAttribute(name) {
        delete this.attributes[name]
      },
      getAttribute(name) {
        return name in this.attributes ? this.attributes[name] : null
      },
      appendChild(child) {
        child.parentNode = this
        this.children.push(child)
        return child
      },
      insertBefore(child, _ref) {
        child.parentNode = this
        this.children.push(child)
        return child
      },
      cloneNode() {
        const clone = fakeElement(this.tagName)
        clone.attributes = { ...this.attributes }
        return clone
      },
      closest() {
        return basePanel
      },
    }
  }
  const doc = { createElement: fakeElement }
  const basePanel = fakeElement('div')
  basePanel.setAttribute('booking-popup-content', 'base')
  const group = fakeElement('div')
  basePanel.appendChild(group)
  const rescheduleTrigger = fakeElement('div')
  rescheduleTrigger.setAttribute('booking-action-btn', 'reschedule')
  group.appendChild(rescheduleTrigger)
  const created = []
  const modal = {
    querySelector(selector) {
      if (selector === '[data-starters-reschedule-views]') return {}
      if (selector === '[data-starters-reschedule-respond]') {
        return created.length ? created[0] : null
      }
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('booking-action-btn="reschedule"')) {
        return [rescheduleTrigger]
      }
      return []
    },
  }
  assert.equal(api.ensureRescheduleViews(doc, modal), true)
  const inserted = group.children.filter(
    (child) => child.attributes && child.attributes['data-starters-reschedule-respond'] === '',
  )
  created.push(...inserted)
  assert.equal(inserted.length, 2)
  assert.deepEqual(
    inserted.map((child) => child.attributes['booking-action-btn']).sort(),
    ['confirm-reschedule', 'reschedule-decline'],
  )
  assert.equal(api.ensureRescheduleViews(doc, modal), true)
  assert.equal(
    group.children.filter(
      (child) => child.attributes && child.attributes['data-starters-reschedule-respond'] === '',
    ).length,
    2,
  )
})

test('authored reschedule controls and field label replace Webflow placeholder copy', () => {
  const textNode = (value) => ({ nodeType: 3, nodeValue: value })
  const backLabel = { textContent: 'This is some text inside of a div block.' }
  const continueLabel = { textContent: 'This is some text inside of a div block.' }
  const back = { querySelectorAll: () => [backLabel] }
  const next = { querySelectorAll: () => [continueLabel] }
  const reason = {
    attributes: {},
    placeholder: '',
    setAttribute(name, value) {
      this.attributes[name] = value
    },
  }
  const fieldLabel = textNode('This is some text inside of a div block.')
  function fakeElement(tag) {
    return {
      tagName: tag,
      attributes: {},
      children: [],
      style: {},
      setAttribute(name, value) {
        this.attributes[name] = String(value)
      },
      removeAttribute(name) {
        delete this.attributes[name]
      },
      getAttribute(name) {
        return name in this.attributes ? this.attributes[name] : null
      },
      appendChild(child) {
        child.parentNode = this
        this.children.push(child)
        return child
      },
      insertBefore(child) {
        child.parentNode = this
        this.children.push(child)
        return child
      },
    }
  }
  const host = fakeElement('div')
  const sibling = fakeElement('div')
  host.appendChild(sibling)
  const basePanel = fakeElement('div')
  basePanel.setAttribute('booking-popup-content', 'base')
  const actionGroup = fakeElement('div')
  basePanel.appendChild(actionGroup)
  const rescheduleTrigger = fakeElement('button')
  rescheduleTrigger.setAttribute('booking-action-btn', 'reschedule')
  rescheduleTrigger.closest = () => basePanel
  actionGroup.appendChild(rescheduleTrigger)
  const panel = {
    childNodes: [fieldLabel],
    querySelector(selector) {
      return selector === '[booking-reschedule-reason]' ? reason : null
    },
    querySelectorAll(selector) {
      if (selector.includes('switch-base')) return [back]
      if (selector.includes('reschedule-calendar')) return [next]
      return []
    },
  }
  const modal = {
    querySelector(selector) {
      if (selector === '[booking-popup-content="reschedule"]') return panel
      if (selector === '[booking-popup-content="cancel-reason"]') return sibling
      if (selector === '[data-starters-reschedule-respond]') {
        return actionGroup.children.find(
          (child) => child.attributes['data-starters-reschedule-respond'] === '',
        ) || null
      }
      const contentMatch = selector.match(/^\[booking-popup-content="([^"]+)"\]$/)
      if (contentMatch) {
        return host.children.find(
          (child) => child.attributes['booking-popup-content'] === contentMatch[1],
        ) || null
      }
      return null
    },
    querySelectorAll(selector) {
      return selector.includes('booking-action-btn="reschedule"')
        ? [rescheduleTrigger]
        : []
    },
  }

  assert.equal(api.normalizeRescheduleViewCopy(modal), true)
  assert.equal(backLabel.textContent, 'Back')
  assert.equal(continueLabel.textContent, 'Continue')
  assert.equal(fieldLabel.nodeValue, 'Why do you need a new time?')
  assert.equal(reason.placeholder, 'Why do you need a new time?')
  assert.equal(reason.attributes['aria-label'], 'Why do you need a new time?')
  assert.equal(api.ensureRescheduleViews({ createElement: fakeElement }, modal), true)
  assert.deepEqual(
    host.children
      .map((child) => child.attributes['booking-popup-content'])
      .filter(Boolean)
      .sort(),
    [
      'reschedule-accepted',
      'reschedule-calendar',
      'reschedule-declined',
      'reschedule-proposed',
      // The pending path's success view, generated for the same reason as the
      // others: a modal without the authored panel must still have a target.
      'reschedule-updated',
    ],
  )
  const calendarPanel = modal.querySelector('[booking-popup-content="reschedule-calendar"]')
  assert.equal(
    calendarPanel.children.some(
      (child) => child.attributes['booking-reschedule-calendar'] === '',
    ),
    true,
  )
  assert.deepEqual(
    actionGroup.children
      .map((child) => child.attributes['booking-action-btn'])
      .filter((action) => action !== 'reschedule')
      .sort(),
    ['confirm-reschedule', 'reschedule-decline'],
  )

  const fallbackHost = fakeElement('div')
  const fallbackBase = fakeElement('div')
  fallbackBase.setAttribute('booking-popup-content', 'base')
  fallbackHost.appendChild(fallbackBase)
  const fallbackModal = {
    querySelector(selector) {
      const contentMatch = selector.match(/^\[booking-popup-content="([^"]+)"\]$/)
      if (contentMatch) {
        return fallbackHost.children.find(
          (child) => child.attributes['booking-popup-content'] === contentMatch[1],
        ) || null
      }
      return null
    },
    querySelectorAll() {
      return []
    },
  }
  assert.equal(api.ensureRescheduleViews({ createElement: fakeElement }, fallbackModal), true)
  const fallbackPanel = fallbackModal.querySelector('[booking-popup-content="reschedule"]')
  assert.equal(fallbackPanel.children[0].textContent, 'Choose a new time')
  assert.equal(
    fallbackPanel.children[1].textContent,
    'Select a new time and add a short note about why you need the change.',
  )
})

test('the success panel text nodes render the current counterpart without changing other copy', () => {
  const firstBooking = {
    starter_data: { name: 'Sam Starter', memberstack_id: 'mem_sb_starter' },
    brand_data: { name: 'Bella Brand', memberstack_id: 'mem_sb_brand' },
  }
  const directText = {
    nodeType: 3,
    nodeValue: 'The call is cancelled. We will notify [Starter].',
  }
  const nestedText = { nodeType: 3, nodeValue: '[Brand] will receive an email.' }
  const untouched = { nodeType: 3, nodeValue: 'No placeholder here.' }
  const nestedElement = { nodeType: 1, childNodes: [nestedText, untouched] }
  const panel = { nodeType: 1, childNodes: [directText, nestedElement] }
  const modal = {
    querySelectorAll(selector) {
      assert.equal(selector, '[booking-popup-content="cancelled"]')
      return [panel]
    },
  }

  assert.equal(api.fillCounterpartPlaceholders(modal, 'cancelled', 'brand', firstBooking), 2)
  assert.equal(directText.nodeValue, 'The call is cancelled. We will notify Sam Starter.')
  assert.equal(nestedText.nodeValue, 'Sam Starter will receive an email.')
  assert.equal(untouched.nodeValue, 'No placeholder here.')

  const secondBooking = {
    starter_data: { name: 'Taylor Starter' },
    brand_data: { name: 'Blake Brand' },
  }
  assert.equal(api.fillCounterpartPlaceholders(modal, 'cancelled', 'starter', secondBooking), 2)
  assert.equal(directText.nodeValue, 'The call is cancelled. We will notify Blake Brand.')
  assert.equal(nestedText.nodeValue, 'Blake Brand will receive an email.')

  assert.equal(api.fillCounterpartPlaceholders(modal, 'cancelled', 'brand', {}), 2)
  assert.equal(directText.nodeValue, 'The call is cancelled. We will notify the other participant.')
  assert.equal(nestedText.nodeValue, 'the other participant will receive an email.')
})

test('the modal back and close chrome is module-owned', () => {
  const contents = ['base', 'cancel'].map(function (name) {
    return {
      hidden: name !== 'base',
      style: { display: name === 'base' ? 'flex' : 'none' },
      getAttribute(attribute) {
        return attribute === 'booking-popup-content' ? name : null
      },
    }
  })
  const backControl = { hidden: false, style: {} }
  const closeControl = {
    clicks: 0,
    click() {
      this.clicks += 1
    },
  }
  const modal = {
    querySelector(selector) {
      return selector === '[booking-popup-info-close], [data-modal-close]'
        ? closeControl
        : null
    },
    querySelectorAll(selector) {
      if (selector === '[booking-popup-content]') return contents
      if (selector.includes('switch-base')) return [backControl]
      return []
    },
  }
  const clickHandlers = []
  const document = {
    addEventListener(event, handler) {
      if (event === 'click') clickHandlers.push(handler)
    },
    querySelector() {
      return modal
    },
  }
  api.wire({
    document,
    role: 'brand',
    restart() {},
    getBooking() {
      throw new Error('modal chrome must not resolve a booking')
    },
  })
  function press(action) {
    let prevented = 0
    let stopped = 0
    const button = {
      getAttribute(attribute) {
        return attribute === 'booking-action-btn' ? action : null
      },
      closest(selector) {
        return selector.includes('popup-booking-info') ? modal : this
      },
    }
    clickHandlers.forEach(function (handler) {
      handler({
        target: button,
        preventDefault() {
          prevented += 1
        },
        stopImmediatePropagation() {
          stopped += 1
        },
      })
    })
    return { prevented, stopped }
  }

  // Leaving base shows the back control.
  api.switchPopupContent(modal, 'cancel')
  assert.equal(backControl.hidden, false)
  assert.equal(contents[0].hidden, true)

  // Back returns to base, consumes the click, and hides itself again.
  const back = press('switch-base')
  assert.equal(back.prevented, 1)
  assert.equal(back.stopped, 1)
  assert.equal(contents[0].hidden, false)
  assert.equal(contents[1].hidden, true)
  assert.equal(backControl.hidden, true)

  // Close clicks the authored close control so the native modal system runs.
  const close = press('switch-close')
  assert.equal(close.prevented, 1)
  assert.equal(close.stopped, 1)
  assert.equal(closeControl.clicks, 1)
})

test('closeDetailModal falls back to the dialog API without an authored control', () => {
  let closed = 0
  const modal = {
    querySelector() {
      return null
    },
    close() {
      closed += 1
    },
  }
  assert.equal(api.closeDetailModal(modal), true)
  assert.equal(closed, 1)
  assert.equal(api.closeDetailModal(null), false)
})

test('the authored loader covers the availability fetch, not just the script fetch', async () => {
  // The engine clears the container and only THEN requests availability, so
  // the slow half of the wait used to render as an empty panel. The loader has
  // to still be up while the engine runs, and down once it returns.
  const originalCalendar = global.StartersPaidCallBrandPayment
  const container = { textContent: 'stale' }
  const loader = { hidden: true, style: { display: 'none' } }
  const reasonField = { value: 'Need a later time' }
  const modal = {
    getAttribute(name) {
      return name === 'data-booking-id' ? 'booking-loader' : null
    },
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      if (selector === '[booking-calendar-loader]') return loader
      if (selector === '[booking-reschedule-reason]') return reasonField
      return null
    },
    querySelectorAll() {
      return []
    },
  }
  const seen = []
  try {
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar() {
        // Sampled from inside the engine's own await, which is exactly the
        // window that used to show nothing.
        seen.push({ hidden: loader.hidden, display: loader.style.display })
        return { slots: [] }
      },
    }
    const booking = rescheduleBooking({ booking_id: 'booking-loader' })
    const mounted = await api.mountRescheduleCalendar(
      {}, modal, booking, 'starter', reasonField.value,
    )

    assert.equal(mounted, true)
    // Up during the engine's work...
    assert.deepEqual(seen, [{ hidden: false, display: 'flex' }])
    // ...and down once it has painted.
    assert.equal(loader.hidden, true)
    assert.equal(loader.style.display, 'none')
    // The authored loader replaces the text fallback rather than doubling it.
    assert.equal(container.textContent, 'stale')
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
  }
})

test('a failed calendar load takes the loader down and explains itself', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const container = { textContent: '' }
  const loader = { hidden: true, style: { display: 'none' } }
  const modal = {
    getAttribute() { return 'booking-fail' },
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      if (selector === '[booking-calendar-loader]') return loader
      return null
    },
    querySelectorAll() { return [] },
  }
  try {
    // No engine on the global, and a document stub that cannot inject one.
    global.StartersPaidCallBrandPayment = undefined
    const booking = rescheduleBooking({ booking_id: 'booking-fail' })
    const mounted = await api.mountRescheduleCalendar({}, modal, booking, 'starter', '')
    assert.equal(mounted, false)
    assert.equal(loader.hidden, true)
    assert.equal(loader.style.display, 'none')
    assert.match(container.textContent, /could not load/)
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
  }
})

test('resetting mid-load clears the loader so the next open is not covered', () => {
  const loader = { hidden: false, style: { display: 'flex' } }
  const modal = {
    querySelector(selector) {
      if (selector === '[booking-calendar-loader]') return loader
      return null
    },
  }
  assert.equal(api.resetRescheduleState(modal), true)
  assert.equal(loader.hidden, true)
  assert.equal(loader.style.display, 'none')
})

test('a stale mount cannot hide the loader owned by a newer mount', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const loader = { hidden: true, style: { display: 'none' } }
  const containers = [{ textContent: '' }, { textContent: '' }]
  let activeContainer = containers[0]
  const modal = {
    getAttribute(name) {
      return name === 'data-booking-id' ? 'booking-overlap' : null
    },
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return activeContainer
      if (selector === '[booking-calendar-loader]') return loader
      return null
    },
    querySelectorAll() { return [] },
  }
  const releases = []
  try {
    global.StartersPaidCallBrandPayment = {
      mountPaidCalendar() {
        return new Promise((resolve) => releases.push(resolve))
      },
    }
    const booking = rescheduleBooking({ booking_id: 'booking-overlap' })
    const first = api.mountRescheduleCalendar({}, modal, booking, 'starter', '')
    await new Promise((resolve) => setImmediate(resolve))
    activeContainer = containers[1]
    const second = api.mountRescheduleCalendar({}, modal, booking, 'starter', '')
    await new Promise((resolve) => setImmediate(resolve))

    releases[0]({ slots: [] })
    await first
    assert.equal(loader.hidden, false)
    assert.equal(loader.style.display, 'flex')

    releases[1]({ slots: [] })
    await second
    assert.equal(loader.hidden, true)
    assert.equal(loader.style.display, 'none')
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
  }
})

test('a pending request is reschedulable by the brand only, and never by the propose contract', () => {
  const pending = rescheduleBooking({ status: 'pending' })
  const confirmed = rescheduleBooking({ status: 'confirmed' })

  // The two contracts must never both claim a booking: #5921 refuses a
  // confirmed booking and #5756 refuses a pending one, so an overlap here
  // would send a request the server is guaranteed to reject.
  assert.equal(api.canRequestReschedule('brand', pending), true)
  assert.equal(api.canProposeReschedule('brand', pending), false)
  assert.equal(api.canProposeReschedule('brand', confirmed), true)
  assert.equal(api.canRequestReschedule('brand', confirmed), false)

  // Brand only: it is the brand's own unanswered request.
  assert.equal(api.canRequestReschedule('starter', pending), false)

  // The same guards as the confirmed path still apply.
  assert.equal(api.canRequestReschedule('brand', rescheduleBooking({ status: 'pending', is_paid: true })), false)
  assert.equal(api.canRequestReschedule('brand', rescheduleBooking({ status: 'pending', grant_id: '' })), false)
  assert.equal(api.canRequestReschedule('brand', rescheduleBooking({ status: 'pending', data_environment: '' })), false)
  assert.equal(
    api.canRequestReschedule('brand', rescheduleBooking({ status: 'pending', start: Date.now() - 1000 })),
    false,
  )
})

test('rescheduleKindFor picks the contract the booking actually accepts', () => {
  assert.equal(api.rescheduleKindFor('brand', rescheduleBooking({ status: 'confirmed' })), 'reschedule-propose')
  assert.equal(api.rescheduleKindFor('brand', rescheduleBooking({ status: 'pending' })), 'reschedule-request')
  assert.equal(api.rescheduleKindFor('starter', rescheduleBooking({ status: 'pending' })), '')
  assert.equal(api.rescheduleKindFor('brand', rescheduleBooking({ status: 'cancelled' })), '')
})

test('a pending reschedule posts the update contract and keeps the booking pending', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const calls = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() { return '00000000-0000-4000-8000-00000000009a' },
    }
    global.xanoAuthFetch = async function (url, options) {
      calls.push({ url, body: JSON.parse(options.body) })
      return {
        ok: true,
        async json() {
          // The server leaves a pending request pending; only the time moves.
          return { reschedule_request: { booking_id: 'booking-pending-1', status: 'pending' } }
        },
      }
    }
    const booking = rescheduleBooking({ booking_id: 'booking-pending-1', status: 'pending' })
    const start = Date.now() + 3 * 60 * 60 * 1000
    const result = await api.proposeReschedule(booking, 'brand', 'Earlier suits us', {
      start,
      end: start + 30 * 60 * 1000,
      timezone: 'Asia/Manila',
    })

    assert.ok(result)
    assert.equal(calls.length, 1)
    // The pending contract, not the handshake one.
    assert.match(calls[0].url, /\/booking\/reschedule\/request\/v3$/)
    assert.equal(calls[0].body.booking_id, 'booking-pending-1')
    assert.equal(calls[0].body.new_start, start)
    assert.equal(calls[0].body.rescheduled_reason, 'Earlier suits us')
    assert.ok(calls[0].body.idempotency_key)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('a confirmed reschedule still posts the propose contract', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const calls = []
  try {
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() { return '00000000-0000-4000-8000-00000000009b' },
    }
    global.xanoAuthFetch = async function (url, options) {
      calls.push({ url, body: JSON.parse(options.body) })
      return {
        ok: true,
        async json() {
          return { reschedule: { booking_id: 'booking-confirmed-1', status: 'rescheduled' } }
        },
      }
    }
    const booking = rescheduleBooking({ booking_id: 'booking-confirmed-1', status: 'confirmed' })
    const start = Date.now() + 4 * 60 * 60 * 1000
    const result = await api.proposeReschedule(booking, 'brand', 'Conflict came up', {
      start,
      end: start + 30 * 60 * 1000,
      timezone: 'Asia/Manila',
    })

    assert.ok(result)
    assert.match(calls[0].url, /\/booking\/reschedule\/propose\/v3$/)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('the shared reason panel carries the copy of the contract in play', () => {
  function leaf(text) {
    return { children: [], textContent: text }
  }
  const title = leaf('Propose a new time')
  const body = leaf(
    'Your call keeps its current time until the other participant confirms the new one.' +
      ' Changes close to the start time can be disruptive, so add a short note about why.',
  )
  const untouched = leaf('If you would like to discuss options, reach out through the Messages tab')
  const panel = {
    querySelector() {
      return null
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'p, h1, h2, h3')
      return [title, body, untouched]
    },
  }
  const modal = {
    querySelector(selector) {
      return selector === '[booking-popup-content="reschedule"]' ? panel : null
    },
  }

  // A pending call updates its time immediately, so the handshake wording is wrong there.
  assert.equal(api.applyRescheduleContractCopy(modal, 'reschedule-request'), true)
  assert.equal(title.textContent, 'Update the requested time')
  assert.match(body.textContent, /applies right away/)
  assert.doesNotMatch(body.textContent, /until the other participant confirms/)

  // Reopening on a confirmed call restores the handshake wording.
  assert.equal(api.applyRescheduleContractCopy(modal, 'reschedule-propose'), true)
  assert.equal(title.textContent, 'Propose a new time')
  assert.match(body.textContent, /until the other participant confirms/)

  // Unrelated authored copy in the same panel is never rewritten.
  assert.equal(
    untouched.textContent,
    'If you would like to discuss options, reach out through the Messages tab',
  )
})

test('only the pending contract restates the booking before showing its success panel', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const container = { textContent: '' }
  const reasonField = { value: 'Need a later time' }
  let currentId = 'booking-pending-1'
  const modal = {
    getAttribute(name) {
      return name === 'data-booking-id' ? currentId : null
    },
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      if (selector === '[booking-reschedule-reason]') return reasonField
      return null
    },
    querySelectorAll() {
      return []
    },
  }
  const mounts = []
  try {
    api.resetRescheduleState()
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar(options) {
        mounts.push(options)
      },
    }
    global.sessionStorage = storage()
    let uuid = 0
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        uuid += 1
        return '00000000-0000-4000-8000-00000000000' + uuid
      },
    }
    global.xanoAuthFetch = async function () {
      return {
        ok: true,
        async json() {
          return {
            reschedule: { booking_id: currentId, status: 'rescheduled' },
            reschedule_request: { booking_id: currentId, status: 'pending' },
          }
        },
      }
    }
    const start = Date.now() + 96 * 60 * 60 * 1000
    const slot = { start, end: start + 30 * 60 * 1000, timezone: 'Asia/Manila' }

    // Pending: the call really moved, so the open modal is re-rendered from it.
    const pending = rescheduleBooking({
      status: 'pending',
      booking_id: 'booking-pending-1',
      start: Date.now() + 72 * 60 * 60 * 1000,
    })
    const pendingStart = pending.start
    const refreshed = []
    await api.mountRescheduleCalendar({}, modal, pending, 'brand', reasonField.value, undefined,
      function (_modal, booking) {
        refreshed.push(booking)
      })
    await mounts[0].onConfirm(slot)
    assert.equal(refreshed.length, 1)
    assert.equal(refreshed[0], pending)
    assert.equal(pending.start, start)
    assert.notEqual(pending.start, pendingStart)

    // Confirmed: the time holds until the counterpart answers, so nothing is restated.
    // The successful pending confirm clears the authored reason field, so refill it.
    reasonField.value = 'Need a later time'
    currentId = 'booking-confirmed-1'
    const confirmed = rescheduleBooking({
      status: 'confirmed',
      booking_id: 'booking-confirmed-1',
      start: Date.now() + 72 * 60 * 60 * 1000,
    })
    const confirmedStart = confirmed.start
    const notRefreshed = []
    await api.mountRescheduleCalendar({}, modal, confirmed, 'starter', reasonField.value, undefined,
      function (_modal, booking) {
        notRefreshed.push(booking)
      })
    await mounts[1].onConfirm(slot)
    assert.equal(notRefreshed.length, 0)
    assert.equal(confirmed.start, confirmedStart)
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('the authored booking-copy hooks are preferred over matching the copy strings', () => {
  const title = { children: [], textContent: 'Propose a new time' }
  const body = { children: [], textContent: 'anything the Designer happens to say today' }
  const panel = {
    querySelector(selector) {
      if (selector === '[booking-copy="reschedule-title"]') return title
      if (selector === '[booking-copy="reschedule-body"]') return body
      return null
    },
    querySelectorAll() {
      throw new Error('string matching must not run when the authored hooks exist')
    },
  }
  const modal = {
    querySelector(selector) {
      return selector === '[booking-popup-content="reschedule"]' ? panel : null
    },
  }

  assert.equal(api.applyRescheduleContractCopy(modal, 'reschedule-request'), true)
  assert.equal(title.textContent, 'Update the requested time')
  assert.match(body.textContent, /applies right away/)

  assert.equal(api.applyRescheduleContractCopy(modal, 'reschedule-propose'), true)
  assert.equal(title.textContent, 'Propose a new time')
  assert.match(body.textContent, /until the other participant confirms/)
})
