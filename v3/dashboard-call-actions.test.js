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

// Soft launch (JP, 2026-09-26): Paid decline and its settlement are hard-launch
// work, so the dashboard must not offer a Paid decline the cohort can click.
// Free and legacy rows without a paid flag keep Decline exactly as before.
test('decline eligibility excludes explicitly Paid requests only', () => {
  const booking = pendingBooking()
  assert.equal(api.canDecline('starter', { ...booking, is_paid: true }), false)
  assert.equal(api.canDecline('starter', { ...booking, is_paid: 'true' }), false)
  assert.equal(api.canDecline('starter', { ...booking, paid_meeting: true }), false)
  assert.equal(api.canDecline('starter', { ...booking, is_paid: false }), true)
  assert.equal(api.canDecline('starter', { ...booking, paid_meeting: false }), true)
  assert.equal(api.canDecline('starter', booking), true)
})

test('a Paid decline never reaches the decline endpoint; Free still does', async () => {
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
    global.xanoAuthFetch = async function (url) {
      requests.push(url)
      return {
        ok: true,
        async json() {
          return { decline: { booking_id: 'booking-test-1', status: 'declined', revision: 2 } }
        },
      }
    }
    const paid = await api.declineBooking({ ...pendingBooking(), is_paid: true }, 'Not available')
    assert.equal(paid, null)
    assert.deepEqual(requests, [])

    const free = await api.declineBooking({ ...pendingBooking(), is_paid: false }, 'Not available')
    assert.equal(free.decline.status, 'declined')
    assert.equal(requests.length, 1)
    assert.match(requests[0], /\/booking\/decline\/v3$/)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
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
      querySelectorAll() { return [] },
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
  assert.equal(api.canCancel('brand', { ...booking, status: 'pending' }), true)
  assert.equal(api.canCancel('brand', { ...booking, status: 'pending', paid_meeting: true }), false)
  assert.equal(api.canCancel('brand', { ...booking, status: 'pending', start: Date.now() - 1000 }), false)
  assert.equal(api.canCancel('brand', { ...booking, status: 'declined' }), false)
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

// F21: a details dialog with authored panels. Notes record their parent so a
// test can prove where the alert renders.
function actionErrorModal(panelNames, noteOptions = {}) {
  const created = []
  const ownerDocument = {
    createElement() {
      const node = {
        hidden: false,
        style: {},
        textContent: '',
        attributes: {},
        scrolls: [],
        setAttribute(name, value) { this.attributes[name] = value },
      }
      if (noteOptions.scroll === 'record') node.scrollIntoView = function (options) { this.scrolls.push(options) }
      if (noteOptions.scroll === 'throw') node.scrollIntoView = function () { throw new Error('no layout') }
      created.push(node)
      return node
    },
  }
  function container(extra, nested) {
    return Object.assign({
      children: [],
      ownerDocument,
      appendChild(node) {
        if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1)
        node.parentNode = this
        this.children.push(node)
      },
      notes() {
        return this.children.filter(node => node.attributes && 'data-starters-action-error' in node.attributes)
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null
      },
      querySelectorAll(selector) {
        if (selector === '[booking-popup-content]') return nested
        if (selector === '[data-starters-action-error]') {
          return nested.flatMap(panel => panel.notes()).concat(this.notes())
        }
        return []
      },
    }, extra)
  }
  const panels = panelNames.map(name => container({
    hidden: false,
    style: {},
    getAttribute(attribute) { return attribute === 'booking-popup-content' ? name : null },
  }, []))
  const modal = container({}, panels)
  function open(name) {
    panels.forEach(panel => {
      const active = panel.getAttribute('booking-popup-content') === name
      panel.hidden = !active
      panel.style.display = active ? 'flex' : 'none'
    })
  }
  return { created, modal, open, panel: name => panels.find(panel => panel.getAttribute('booking-popup-content') === name) }
}

test('F21: a shown action error renders in the open panel and scrolls into view once', () => {
  const { created, modal, open, panel } = actionErrorModal(['base', 'cancel-reason'], { scroll: 'record' })
  open('cancel-reason')
  api.showActionError(modal, 'Confirmed Free cancellation claim changed before provider cancellation')
  assert.equal(created.length, 1)
  assert.equal(created[0].parentNode, panel('cancel-reason'))
  assert.equal(modal.notes().length, 0, 'The clipped dialog root never holds the alert')
  assert.equal(created[0].hidden, false)
  assert.deepEqual(created[0].scrolls, [{ block: 'nearest' }])
})

test('F21: clearing an action error never scrolls', () => {
  const { created, modal, open } = actionErrorModal(['base', 'cancel-reason'], { scroll: 'record' })
  open('cancel-reason')
  api.showActionError(modal, '')
  assert.equal(created.length, 0)
  api.showActionError(modal, 'First failure')
  api.showActionError(modal, '')
  assert.equal(created[0].hidden, true)
  assert.equal(created[0].style.display, 'none')
  assert.equal(created[0].scrolls.length, 1, 'Only the shown message scrolled')
})

test('F21: a note without a working scrollIntoView still shows the message', () => {
  for (const scroll of ['absent', 'throw']) {
    const { created, modal, open } = actionErrorModal(['base', 'cancel-reason'], { scroll })
    open('cancel-reason')
    assert.doesNotThrow(() => api.showActionError(modal, 'Cancellation failed'))
    assert.equal(created[0].textContent, 'Cancellation failed')
    assert.equal(created[0].hidden, false)
  }
})

test('F21: the alert follows the open panel, falls back to the root, and clears everywhere', () => {
  const { created, modal, open, panel } = actionErrorModal(['base', 'cancel-reason', 'reschedule-calendar'])
  open('cancel-reason')
  api.showActionError(modal, 'Cancellation failed')
  open('reschedule-calendar')
  api.showActionError(modal, 'That time is no longer available.')
  assert.equal(created.length, 1, 'One note is reused across panels')
  assert.equal(created[0].parentNode, panel('reschedule-calendar'))
  assert.equal(panel('cancel-reason').notes().length, 0)
  // The payment module scopes its own note to the base panel.
  open('base')
  api.showActionError(panel('base'), 'Your payment methods could not be opened. Please try again.')
  assert.equal(created.length, 2)
  assert.equal(created[1].parentNode, panel('base'))
  api.showActionError(modal, '')
  assert.deepEqual(created.map(note => note.hidden), [true, true])
  // With no open panel the root keeps the alert, as before.
  const bare = actionErrorModal(['base'])
  bare.panel('base').hidden = true
  api.showActionError(bare.modal, 'Cancellation failed')
  assert.equal(bare.created[0].parentNode, bare.modal)
})

// Kaeser QA P5 (2026-09-28): call actions only set aria-busy, so a slow
// command read as a dead button. A busy control now reads its action label
// and is disabled until the command settles.
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function busyControl(action, authoredLabel) {
  const label = { textContent: authoredLabel }
  const inner = { disabled: false }
  return {
    label,
    inner,
    attributes: {},
    getAttribute(name) {
      return name === 'booking-action-btn' ? action : (this.attributes[name] ?? null)
    },
    setAttribute(name, value) { this.attributes[name] = String(value) },
    querySelectorAll(selector) {
      if (selector === 'button') return [inner]
      if (selector.includes('.button_main-text')) return [label]
      return []
    },
  }
}

test('markActionBusy shows a visible busy label and disables the control until release', () => {
  const control = busyControl('decline', 'Decline Call')
  control.inner.disabled = false
  const release = api.markActionBusy(control, 'Declining…')
  assert.equal(control.label.textContent, 'Declining…')
  assert.equal(control.inner.disabled, true)
  assert.equal(control.attributes['aria-busy'], 'true')
  assert.equal(control.attributes['aria-disabled'], 'true')
  release()
  release()
  assert.equal(control.label.textContent, 'Decline Call')
  assert.equal(control.inner.disabled, false)
  assert.equal(control.attributes['aria-busy'], 'false')
  assert.equal(control.attributes['aria-disabled'], 'false')

  // A plain generated button carries its label as its own text.
  const plain = { textContent: 'Keep Current Time', disabled: true, setAttribute() {} }
  const releasePlain = api.markActionBusy(plain, 'Keeping current time…')
  assert.equal(plain.textContent, 'Keeping current time…')
  releasePlain()
  assert.equal(plain.textContent, 'Keep Current Time')
  assert.equal(plain.disabled, true, 'a control disabled before stays disabled')
  // Markup without a label hook is never flattened into text.
  const icon = { textContent: 'Accept' }
  const structured = { textContent: 'Accept', children: [icon], setAttribute() {}, querySelectorAll: () => [] }
  const releaseStructured = api.markActionBusy(structured, 'Accepting…')
  assert.equal(structured.textContent, 'Accept')
  assert.equal(structured.children[0], icon)
  releaseStructured()
  assert.doesNotThrow(() => api.markActionBusy(null, 'Busy')())
})

test('decline and proposal responses show a busy label, then restore it and show failures', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  try {
    global.sessionStorage = storage()
    let uuid = 0
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        uuid += 1
        return '00000000-0000-4000-8000-0000000006' + String(uuid).padStart(2, '0')
      },
    }
    for (const scenario of [
      { action: 'decline', label: 'Decline Call', busy: 'Declining…', panel: 'decline-reason', booking: pendingBooking(), role: 'starter' },
      {
        action: 'confirm-reschedule',
        label: 'Accept New Time',
        busy: 'Accepting…',
        panel: 'base',
        booking: rescheduleBooking({ status: 'rescheduled', rescheduled_by: 'starter', start: Date.now() + 48 * 60 * 60 * 1000 }),
        role: 'brand',
      },
    ]) {
      const { modal, open, panel } = actionErrorModal(['base', 'decline-reason'])
      open(scenario.panel)
      const reasonField = { value: 'Not available' }
      const queryModal = modal.querySelector
      modal.querySelector = (selector) =>
        selector === '[booking-decline-reason]' ? reasonField : queryModal.call(modal, selector)
      modal.getAttribute = (name) => name === 'data-booking-id' ? scenario.booking.booking_id : null
      const handlers = []
      api.wire({
        document: { addEventListener(type, handler) { if (type === 'click') handlers.push(handler) } },
        role: scenario.role,
        getBooking: () => scenario.booking,
      })
      const control = busyControl(scenario.action, scenario.label)
      control.closest = (selector) => selector.includes('popup-booking-info') ? modal : control
      const response = deferred()
      global.xanoAuthFetch = async () => response.promise
      const click = handlers[0]({ target: control, preventDefault() {}, stopImmediatePropagation() {} })
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(control.label.textContent, scenario.busy, scenario.action + ' shows its busy label')
      assert.equal(control.inner.disabled, true)
      response.resolve({ ok: false, json: async () => ({ message: 'Controlled refusal' }) })
      await click
      assert.equal(control.label.textContent, scenario.label)
      assert.equal(control.inner.disabled, false)
      const note = panel(scenario.panel).notes()[0]
      assert.equal(note && note.textContent, 'Controlled refusal')
      assert.equal(note.hidden, false)
    }
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

// Keep Current Time and Accept New Time answer the same proposal. With only
// the clicked control busy, a click on its sibling sent the opposite command
// while the first was still in flight.
test('while one proposal response is in flight both respond controls are busy', async () => {
  const keepCurrentTimeBefore = api.setKeepCurrentTimeEnabledForTest(true)
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  try {
    global.sessionStorage = storage()
    let uuid = 0
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        uuid += 1
        return '00000000-0000-4000-8000-0000000007' + String(uuid).padStart(2, '0')
      },
    }
    for (const clicked of ['confirm-reschedule', 'reschedule-decline']) {
      const booking = rescheduleBooking({
        status: 'rescheduled',
        rescheduled_by: 'starter',
        start: Date.now() + 48 * 60 * 60 * 1000,
      })
      const { modal, open, panel } = actionErrorModal(['base'])
      open('base')
      modal.getAttribute = (name) => name === 'data-booking-id' ? booking.booking_id : null
      const accept = busyControl('confirm-reschedule', 'Accept New Time')
      const keep = busyControl('reschedule-decline', 'Keep Current Time')
      const base = panel('base')
      const queryBase = base.querySelectorAll
      base.querySelectorAll = (selector) =>
        selector.includes('"confirm-reschedule"') && selector.includes('"reschedule-decline"')
          ? [accept, keep]
          : queryBase.call(base, selector)
      for (const control of [accept, keep]) {
        control.closest = (selector) => selector.includes('popup-booking-info') ? modal : control
      }
      const handlers = []
      api.wire({
        document: { addEventListener(type, handler) { if (type === 'click') handlers.push(handler) } },
        role: 'brand',
        getBooking: () => booking,
      })
      const response = deferred()
      let posts = 0
      global.xanoAuthFetch = async () => {
        posts += 1
        return response.promise
      }
      const [first, sibling] = clicked === 'confirm-reschedule' ? [accept, keep] : [keep, accept]
      const event = (target) => ({ target, preventDefault() {}, stopImmediatePropagation() {} })
      const click = handlers[0](event(first))
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(first.label.textContent, clicked === 'confirm-reschedule' ? 'Accepting…' : 'Keeping current time…')
      assert.equal(sibling.label.textContent, clicked === 'confirm-reschedule' ? 'Keep Current Time' : 'Accept New Time',
        clicked + ': the sibling keeps its label')
      for (const control of [first, sibling]) {
        assert.equal(control.inner.disabled, true, clicked + ': both are disabled')
        assert.equal(control.attributes['aria-disabled'], 'true')
      }
      // A sibling click mid-flight sends nothing.
      await handlers[0](event(sibling))
      response.resolve({ ok: false, json: async () => ({ message: 'Controlled refusal' }) })
      await click
      assert.equal(posts, 1, clicked + ': one command only')
      assert.equal(accept.label.textContent, 'Accept New Time')
      assert.equal(keep.label.textContent, 'Keep Current Time')
      for (const control of [first, sibling]) {
        assert.equal(control.inner.disabled, false, clicked + ': both are released')
        assert.equal(control.attributes['aria-busy'], 'false')
        assert.equal(control.attributes['aria-disabled'], 'false')
      }
    }
  } finally {
    api.setKeepCurrentTimeEnabledForTest(keepCurrentTimeBefore)
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
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
  const row = Object.assign(
    {
      booking_id: 'booking-test-3',
      config_id: 'config-test-1',
      grant_id: 'grant-test-1',
      duration: 30,
      is_paid: false,
      data_environment: 'test',
      status: 'confirmed',
      start: Date.now() + 24 * 60 * 60 * 1000,
      start_old: Date.now() + 24 * 60 * 60 * 1000,
      server_now_ms: Date.now(),
      starter_data: { memberstack_id: 'mem_sb_starter' },
      brand_data: { memberstack_id: 'mem_sb_brand' },
    },
    overrides || {},
  )
  api.bindCanonicalClock([row], api.monotonicNow())
  return row
}

test('reschedule proposal eligibility requires a booked future call with calendar identity', () => {
  const booking = rescheduleBooking()
  assert.equal(api.canProposeReschedule('starter', booking), true)
  assert.equal(api.canProposeReschedule('brand', booking), true)
  assert.equal(api.canProposeReschedule('guest', booking), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ status: 'rescheduled' })), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ start: Date.now() - 1000 })), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ grant_id: '' })), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ duration: 0 })), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ is_paid: true })), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ is_paid: 'true' })), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ is_paid: undefined, paid_meeting: true })), false)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ is_paid: undefined, paid_meeting: false })), true)
  assert.equal(api.canProposeReschedule('starter', rescheduleBooking({ is_paid: undefined, paid_meeting: undefined })), false)
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

// F13 soft launch: published #5760 restores a Free call to its original
// confirmed time, so a declined proposal also answers `confirmed`. The old
// `cancelled` answer belongs to the retired decline-cancels contract.
test('reschedule responses require confirmed acceptance and a confirmed decline', async () => {
  const keepCurrentTimeBefore = api.setKeepCurrentTimeEnabledForTest(true)
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
      body[key] = {
        booking_id: 'booking-test-3',
        status: declineStatus && key === 'reschedule_decline' ? declineStatus : 'confirmed',
        revision: 4,
      }
      if (key === 'reschedule_decline') body[key].original_restored = true
      body.duplicate = false
      return { ok: true, async json() { return body } }
    }
    let declineStatus = ''
    const booking = rescheduleBooking({ status: 'rescheduled', rescheduled_by: 'starter' })
    const confirmed = await api.respondReschedule('reschedule-confirm', booking, 'brand')
    assert.equal(confirmed.reschedule_confirm.status, 'confirmed')
    assert.match(requests[0].url, /\/booking\/reschedule\/confirm\/v3$/)
    assert.match(JSON.parse(requests[0].options.body).idempotency_key, /^dashboard-reschedule-confirm:/)
    const declined = await api.respondReschedule('reschedule-decline', booking, 'brand')
    assert.equal(declined.reschedule_decline.status, 'confirmed')
    assert.match(requests[1].url, /\/booking\/reschedule\/decline\/v3$/)
    // The retired decline-cancels answer is no longer a success.
    declineStatus = 'cancelled'
    await assert.rejects(
      api.respondReschedule('reschedule-decline', booking, 'brand'),
      /Canonical reschedule response failed/,
    )
    assert.equal(await api.respondReschedule('reschedule-confirm', booking, 'starter'), null)
    assert.equal(await api.respondReschedule('cancel', booking, 'brand'), null)
  } finally {
    api.setKeepCurrentTimeEnabledForTest(keepCurrentTimeBefore)
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
  // Covers the retained two-button fallback; the retired default is covered
  // by the Keep Current Time tests below.
  const keepCurrentTimeBefore = api.setKeepCurrentTimeEnabledForTest(true)
  try {
    assert.equal(api.ensureRescheduleViews(doc, modal), true)
  } finally {
    api.setKeepCurrentTimeEnabledForTest(keepCurrentTimeBefore)
  }
  const inserted = group.children.filter(
    (child) => child.attributes && child.attributes['data-starters-reschedule-respond'] === '',
  )
  created.push(...inserted)
  assert.equal(inserted.length, 2)
  assert.deepEqual(
    inserted.map((child) => child.attributes['booking-action-btn']).sort(),
    ['confirm-reschedule', 'reschedule-decline'],
  )
  // Declining a Free proposal keeps the original time (#5760). The fallback
  // reads exactly like the authored "Keep Current Time" button.
  assert.equal(
    inserted.find((child) => child.attributes['booking-action-btn'] === 'reschedule-decline').textContent,
    'Keep Current Time',
  )
  assert.equal(api.ensureRescheduleViews(doc, modal), true)
  assert.equal(
    group.children.filter(
      (child) => child.attributes && child.attributes['data-starters-reschedule-respond'] === '',
    ).length,
    2,
  )
})

test('authored respond controls in the base view are not duplicated', () => {
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
  // Both published views author the respond pair here, next to the trigger.
  const authoredAccept = fakeElement('a')
  authoredAccept.setAttribute('booking-action-btn', 'confirm-reschedule')
  group.appendChild(authoredAccept)
  const authoredDecline = fakeElement('a')
  authoredDecline.setAttribute('booking-action-btn', 'reschedule-decline')
  authoredDecline.textContent = 'Keep Current Time'
  group.appendChild(authoredDecline)
  const modal = {
    querySelector(selector) {
      if (selector === '[data-starters-reschedule-views]') return {}
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('booking-action-btn="confirm-reschedule"')) {
        return [authoredAccept]
      }
      if (selector.includes('booking-action-btn="reschedule-decline"')) {
        return [authoredDecline]
      }
      if (selector.includes('booking-action-btn="reschedule"')) {
        return [rescheduleTrigger]
      }
      return []
    },
  }
  assert.equal(api.ensureRescheduleViews(doc, modal), true)
  assert.equal(
    group.children.filter(
      (child) => child.attributes && child.attributes['data-starters-reschedule-respond'] === '',
    ).length,
    0,
  )
  assert.equal(group.children.length, 3)
  // The authored label matches the #5760 keep-original contract and stays.
  assert.equal(authoredDecline.textContent, 'Keep Current Time')
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
    // "Keep Current Time" is retired (JP 2a, 2026-10-03): only Accept New Time
    // is generated.
    ['confirm-reschedule'],
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
      querySelectorAll() { return [] },
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

// F04 (Kaeser Call 1, 2026-09-28): #5921 replaces the provider booking and
// answers with the NEW booking_id plus replaced_booking_id = the sent id. The
// client used to require the sent id in booking_id, so a successful edit
// showed "Canonical reschedule request failed" and every retry replayed it.
test('a pending update accepts the replacement booking the server returns', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const keys = []
  let response = null
  try {
    global.sessionStorage = storage()
    let uuid = 0
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() {
        uuid += 1
        return '00000000-0000-4000-8000-0000000004' + String(uuid).padStart(2, '0')
      },
    }
    global.xanoAuthFetch = async function (_url, options) {
      keys.push(JSON.parse(options.body).idempotency_key)
      return { ok: true, async json() { return response } }
    }
    const start = Date.now() + 3 * 60 * 60 * 1000
    const slot = { start, end: start + 30 * 60 * 1000, timezone: 'Asia/Dubai' }
    const booking = () => rescheduleBooking({ booking_id: '2e9f08a2', status: 'pending' })

    // Negative cases keep the key for a safe replay of the same attempt.
    for (const result of [
      { booking_id: 'other-booking', replaced_booking_id: 'another-booking', status: 'pending' },
      { booking_id: '', replaced_booking_id: '2e9f08a2', status: 'pending' },
      { booking_id: '0984c0fb', replaced_booking_id: '2e9f08a2', status: 'confirmed' },
    ]) {
      response = { reschedule_request: result }
      await assert.rejects(
        api.proposeReschedule(booking(), 'brand', 'Earlier suits us', slot),
        /Canonical reschedule request failed/,
      )
    }
    assert.equal(new Set(keys).size, 1)

    response = {
      reschedule_request: { booking_id: '0984c0fb', replaced_booking_id: '2e9f08a2', status: 'pending' },
    }
    const accepted = await api.proposeReschedule(booking(), 'brand', 'Earlier suits us', slot)
    assert.equal(accepted.reschedule_request.booking_id, '0984c0fb')
    // The success cleared the attempt key stored under the sent id.
    await api.proposeReschedule(booking(), 'brand', 'Earlier suits us', slot)
    assert.equal(keys.length, 5)
    assert.equal(keys[3], keys[0])
    assert.notEqual(keys[4], keys[3])

    // Only the replacing contract may answer with another booking id.
    response = {
      reschedule: { booking_id: 'other-booking', replaced_booking_id: 'booking-test-3', status: 'rescheduled' },
    }
    await assert.rejects(
      api.proposeReschedule(rescheduleBooking(), 'brand', 'Conflict came up', slot),
      /Canonical reschedule proposal failed/,
    )
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('a replaced pending booking moves the modal, card, and row to the new id', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  function carrier(id) {
    const attributes = new Map([['data-booking-id', id]])
    return {
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
      setAttribute(name, value) { attributes.set(name, String(value)) },
    }
  }
  const container = { textContent: '' }
  const panels = ['base', 'reschedule-calendar', 'reschedule-updated'].map((name) => ({
    hidden: name !== 'reschedule-calendar',
    style: {},
    getAttribute(attribute) { return attribute === 'booking-popup-content' ? name : null },
    querySelectorAll() { return [] },
  }))
  const modal = Object.assign(carrier('2e9f08a2'), {
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      return null
    },
    querySelectorAll(selector) {
      return selector === '[booking-popup-content]' ? panels : []
    },
  })
  const card = carrier('2e9f08a2')
  const otherCard = carrier('unrelated-booking')
  const document = {
    querySelectorAll(selector) {
      return selector === '[data-booking-id]' ? [card, otherCard, modal] : []
    },
  }
  const mounts = []
  const refreshed = []
  try {
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar(options) { mounts.push(options) },
    }
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() { return '00000000-0000-4000-8000-000000000501' },
    }
    global.xanoAuthFetch = async function () {
      return {
        ok: true,
        async json() {
          return {
            reschedule_request: { booking_id: '0984c0fb', replaced_booking_id: '2e9f08a2', status: 'pending' },
          }
        },
      }
    }
    const booking = rescheduleBooking({ booking_id: '2e9f08a2', status: 'pending' })
    await api.mountRescheduleCalendar(document, modal, booking, 'brand', 'Earlier suits us', undefined,
      function (target, row) {
        refreshed.push({ target, id: row.booking_id, modalId: target.getAttribute('data-booking-id') })
      })
    const start = Date.now() + 5 * 60 * 60 * 1000
    await mounts[0].onConfirm({ start, end: start + 30 * 60 * 1000, timezone: 'Asia/Dubai' })

    assert.equal(booking.booking_id, '0984c0fb')
    assert.equal(booking.start, start)
    assert.equal(modal.getAttribute('data-booking-id'), '0984c0fb')
    assert.equal(card.getAttribute('data-booking-id'), '0984c0fb')
    assert.equal(otherCard.getAttribute('data-booking-id'), 'unrelated-booking')
    assert.deepEqual(refreshed, [{ target: modal, id: '0984c0fb', modalId: '0984c0fb' }])
    assert.equal(panels[2].hidden, false)
    assert.equal(panels[1].hidden, true)
    // The engine's post-success cleanup (status, slots, confirm) runs only
    // while the mount reads as current, so it must follow the adopted id.
    assert.equal(mounts[0].isCurrent(), true, 'the mount follows the adopted id')
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

// F04 retry edge: the member switched bookings during the ~10 s #5921 call.
// The attempt key under the sent id is already cleared, so the local row and
// its card must still leave the dead id, and the list re-reads on close.
test('a replacement that lands after the modal moved on still retires the sent id', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  function carrier(id) {
    const attributes = new Map([['data-booking-id', id]])
    return {
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
      setAttribute(name, value) { attributes.set(name, String(value)) },
    }
  }
  const container = { textContent: '' }
  const panels = ['base', 'reschedule-calendar', 'reschedule-updated'].map((name) => ({
    hidden: name !== 'reschedule-calendar',
    style: {},
    getAttribute(attribute) { return attribute === 'booking-popup-content' ? name : null },
    querySelectorAll() { return [] },
  }))
  const modalListeners = {}
  const modal = Object.assign(carrier('2e9f08a2'), {
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      return null
    },
    querySelectorAll(selector) {
      return selector === '[booking-popup-content]' ? panels : []
    },
    addEventListener(type, listener) { modalListeners[type] = listener },
    removeEventListener(type) { delete modalListeners[type] },
  })
  const card = carrier('2e9f08a2')
  const otherCard = carrier('other-booking')
  const document = {
    querySelectorAll(selector) {
      return selector === '[data-booking-id]' ? [card, otherCard, modal] : []
    },
    addEventListener() {},
    removeEventListener() {},
  }
  const mounts = []
  const refreshed = []
  const response = deferred()
  let restarts = 0
  try {
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar(options) { mounts.push(options) },
    }
    global.sessionStorage = storage()
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() { return '00000000-0000-4000-8000-000000000502' },
    }
    global.xanoAuthFetch = async () => response.promise
    const booking = rescheduleBooking({ booking_id: '2e9f08a2', status: 'pending' })
    await api.mountRescheduleCalendar(document, modal, booking, 'brand', 'Earlier suits us',
      function () { restarts += 1 },
      function (target, row) { refreshed.push(row.booking_id) })
    const start = Date.now() + 5 * 60 * 60 * 1000
    const confirm = mounts[0].onConfirm({ start, end: start + 30 * 60 * 1000, timezone: 'Asia/Dubai' })
    // Mid-request the member opens another booking in the same modal.
    modal.setAttribute('data-booking-id', 'other-booking')
    response.resolve({
      ok: true,
      async json() {
        return {
          reschedule_request: { booking_id: '0984c0fb', replaced_booking_id: '2e9f08a2', status: 'pending' },
        }
      },
    })
    await confirm

    assert.equal(booking.booking_id, '0984c0fb', 'the row leaves the replaced id')
    assert.equal(card.getAttribute('data-booking-id'), '0984c0fb', 'its card follows')
    assert.equal(modal.getAttribute('data-booking-id'), 'other-booking', 'the other booking is untouched')
    assert.equal(otherCard.getAttribute('data-booking-id'), 'other-booking')
    assert.deepEqual(refreshed, [], 'the other booking keeps its details')
    assert.equal(panels[2].hidden, true, 'no receipt over the other booking')
    assert.equal(mounts[0].isCurrent(), false)
    assert.equal(typeof modalListeners.close, 'function', 'the list re-reads on close')
    modalListeners.close()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(restarts, 1)
  } finally {
    global.StartersPaidCallBrandPayment = originalCalendar
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

test('reschedule receipts show the selected slot without moving a confirmed booking', async () => {
  const originalCalendar = global.StartersPaidCallBrandPayment
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const container = { textContent: '' }
  const reasonField = { value: 'Need a later time' }
  let currentId = 'booking-pending-1'
  const attributes = new Map()
  const modal = {
    getAttribute(name) {
      return name === 'data-booking-id' ? currentId : (attributes.get(name) ?? null)
    },
    setAttribute(name, value) {
      if (name === 'data-booking-id') currentId = String(value)
      else attributes.set(name, String(value))
    },
    removeAttribute(name) {
      if (name === 'data-booking-id') currentId = ''
      else attributes.delete(name)
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
  const details = require('./dashboard-calls.js')
  const panels = ['base', 'reschedule-proposed', 'reschedule-updated'].map(name => ({
    hidden: false,
    style: {},
    date: { textContent: '', style: {} },
    reason: { textContent: '', style: {} },
    getAttribute(attribute) { return attribute === 'booking-popup-content' ? name : null },
    querySelectorAll(selector) {
      if (selector === '[booking-element="start-date"]') return [this.date]
      if (selector === '[booking-element="reschedule-reason"]') return [this.reason]
      return []
    },
  }))
  const originalQuery = modal.querySelector
  modal.querySelector = selector => panels.find(panel =>
    selector === '[booking-popup-content="' + panel.getAttribute('booking-popup-content') + '"]'
  ) || originalQuery(selector)
  modal.querySelectorAll = selector => selector === '[booking-popup-content]'
    ? panels : panels.flatMap(panel => panel.querySelectorAll(selector))
  const handlers = []
  const document = {
    addEventListener(event, handler) { if (event === 'click') handlers.push(handler) },
    querySelector() { return modal },
  }
  api.wire({ document, role: 'brand', getBooking() { throw new Error('Unexpected booking lookup') } })
  function returnToBase() {
    const button = {
      getAttribute(name) { return name === 'booking-action-btn' ? 'switch-base' : null },
      closest(selector) { return selector.includes('popup-booking-info') ? modal : this },
    }
    handlers.forEach(handler => handler({
      target: button, preventDefault() {}, stopImmediatePropagation() {},
    }))
    assert.equal(panels[0].hidden, false)
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
      function (_modal, booking, content) {
        assert.equal(content, undefined)
        details.populateDetailModal(_modal, booking, 'brand', undefined, content)
        refreshed.push(booking)
      })
    await mounts[0].onConfirm(slot)
    assert.equal(refreshed.length, 1)
    assert.equal(refreshed[0], pending)
    assert.equal(pending.start, start)
    assert.notEqual(pending.start, pendingStart)
    assert.equal(pending.end, slot.end)
    assert.equal(panels[2].hidden, false)
    const updatedDate = panels[2].date.textContent
    assert.ok(updatedDate)
    returnToBase()
    assert.equal(panels[0].date.textContent, updatedDate)

    for (const role of ['starter', 'brand']) {
      // Confirmed: the receipt shows the proposal, but the confirmed booking stays unchanged.
      // The successful pending confirm clears the authored reason field, so refill it.
      reasonField.value = 'Need a later time'
      currentId = 'booking-confirmed-' + role
      const confirmed = rescheduleBooking({
        status: 'confirmed',
        booking_id: currentId,
        start: Date.now() + 72 * 60 * 60 * 1000,
      })
      const confirmedStart = confirmed.start
      const confirmedEnd = confirmed.end
      details.populateDetailModal(modal, confirmed, role)
      const canonicalDate = panels[0].date.textContent
      assert.notEqual(canonicalDate, updatedDate)
      const proposalViews = []
      await api.mountRescheduleCalendar({}, modal, confirmed, role, reasonField.value, undefined,
        function (_modal, booking, content) {
          details.populateDetailModal(_modal, booking, role, undefined, content)
          proposalViews.push(booking)
        })
      await mounts[mounts.length - 1].onConfirm(slot)
      assert.equal(proposalViews.length, 1)
      assert.notEqual(proposalViews[0], confirmed)
      assert.equal(proposalViews[0].start, slot.start)
      assert.equal(proposalViews[0].end, slot.end)
      assert.equal(proposalViews[0].rescheduled_reason, 'Need a later time')
      assert.equal(confirmed.start, confirmedStart)
      assert.equal(confirmed.end, confirmedEnd)
      assert.equal(panels[1].hidden, false)
      assert.equal(panels[1].date.textContent, updatedDate)
      assert.equal(panels[1].reason.textContent, 'Need a later time')
      returnToBase()
      assert.equal(panels[0].date.textContent, canonicalDate)
      assert.equal(panels[1].hidden, true)
    }
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

test('card Decline opens the selected booking before changing the modal panel', async () => {
  const booking = pendingBooking()
  const order = []
  const label = { textContent: 'Cancel Call' }
  const control = { querySelectorAll: () => [label] }
  const panel = { style: {}, getAttribute: () => 'decline', querySelectorAll: () => [control] }
  const modal = { querySelectorAll: selector => selector === '[booking-popup-content]' ? (order.push('panel'), [panel]) : [] }
  const card = {}
  const button = { getAttribute: key => key === 'booking-action-btn' ? 'switch-decline' : null,
    closest: selector => selector === '[data-booking-id]' ? card : selector.includes('[popup-booking-info]') ? null : button }
  let handler
  api.wire({ document: { addEventListener: (_name, fn) => { handler = fn }, querySelector: () => modal }, role: 'starter',
    getBooking: () => booking, openDetail: (actualModal, actualBooking) => { assert.equal(actualModal, modal); assert.equal(actualBooking, booking); order.push('open'); return true } })
  await handler({ target: button, preventDefault() {}, stopImmediatePropagation() {} })
  assert.deepEqual(order, ['open', 'panel'])
  assert.equal(label.textContent, 'Decline Call')
  assert.equal(panel.hidden, false)
})


test('availability rejection renders an error only for the current booking mount', async () => {
  const original = global.StartersPaidCallBrandPayment
  const container = { textContent: '' }
  const loader = { hidden: true, style: { display: 'none' } }
  let bookingId = 'booking-retained'
  let rejectRequest
  let receivedConfig
  const modal = {
    getAttribute() { return bookingId },
    querySelector(selector) {
      if (selector === '[booking-reschedule-calendar]') return container
      if (selector === '[booking-calendar-loader]') return loader
      return null
    },
    querySelectorAll() { return [] },
  }
  try {
    global.StartersPaidCallBrandPayment = {
      mountPaidCalendar(options) {
        receivedConfig = options.config
        return new Promise((resolve, reject) => { rejectRequest = reject })
      },
    }
    const booking = rescheduleBooking({ booking_id: bookingId })
    const first = api.mountRescheduleCalendar({}, modal, booking, 'starter', '')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(receivedConfig.booking_id, bookingId)
    rejectRequest(new Error('403'))
    await assert.rejects(first, /403/)
    assert.match(container.textContent, /Available times could not load/)
    assert.equal(loader.hidden, true)

    container.textContent = 'new booking content'
    const stale = api.mountRescheduleCalendar({}, modal, booking, 'starter', '')
    await new Promise((resolve) => setImmediate(resolve))
    bookingId = 'different-booking'
    rejectRequest(new Error('late 403'))
    await assert.rejects(stale, /late 403/)
    assert.equal(container.textContent, 'new booking content')
  } finally {
    global.StartersPaidCallBrandPayment = original
  }
})

for (const role of ['brand', 'starter']) {
  test(`${role} authored declined receipt keeps its original-time copy`, () => {
    const title = { textContent: 'Proposal declined', children: [] }
    const body = { textContent: 'The call keeps its original time.', children: [] }
    const detail = { textContent: 'Date and time', children: [] }
    const receipt = { querySelectorAll: () => [title, body, detail] }
    const modal = {
      querySelector(selector) {
        if (selector === '[booking-popup-content="reschedule-declined"]') return receipt
        if (selector === '[data-starters-reschedule-views]') return {}
        if (selector === '[data-starters-reschedule-respond]') return {}
        return null
      },
      querySelectorAll: () => [],
    }
    const document = { createElement() { throw new Error('Authored views must be reused') } }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal(api.ensureRescheduleViews(document, modal), true)
      assert.equal(title.textContent, 'Proposal declined')
      assert.equal(body.textContent, 'The call keeps its original time.')
      assert.equal(detail.textContent, 'Date and time')
    }
  })
}

test('cancellation hides a legacy proposal form carrying the same panel attribute', () => {
  function panel(name, actionAttribute, action) {
    return {
      hidden: false,
      style: {},
      getAttribute() { return name },
      querySelector(selector) {
        return selector.split(',').some((part) =>
          part.trim() === '[' + actionAttribute + '="' + action + '"]',
        ) ? { getAttribute(attribute) { return attribute === actionAttribute ? action : null } } : null
      },
      querySelectorAll() { return [] },
    }
  }
  for (const attribute of ['booking-action-btn', 'booking-card-action-btn']) {
    const proposal = panel('cancel', attribute, 'switch-confirm')
    const cancellation = panel('cancel', attribute, 'switch-cancel-reason')
    const base = panel('base', attribute, 'switch-cancel')
    const modal = {
      querySelectorAll(selector) {
        return selector === '[booking-popup-content]' ? [proposal, cancellation, base] : []
      },
    }
    assert.equal(api.switchPopupContent(modal, 'cancel'), true)
    assert.equal(cancellation.hidden, false)
    assert.equal(cancellation.style.display, 'flex')
    assert.equal(proposal.hidden, true)
    assert.equal(proposal.style.display, 'none')
    assert.equal(base.hidden, true)
    api.switchPopupContent(modal, 'base')
    assert.equal(base.hidden, false)
    assert.equal(cancellation.hidden, true)
    assert.equal(proposal.hidden, true)
  }
  const unique = panel('cancel', '', '')
  assert.equal(api.switchPopupContent({
    querySelectorAll(selector) { return selector === '[booking-popup-content]' ? [unique] : [] },
  }, 'cancel'), true)
  assert.equal(unique.hidden, false)
  assert.equal(unique.style.display, 'flex')
})

/* Jai list #12, JP decision 2a (2026-10-03): the "Keep Current Time" button is
   retired. The #5760 decline rule stays server-side (a declined proposal keeps
   the original confirmed call); only the dashboard control goes. */
test('Keep Current Time is retired by default while Accept New Time and Cancel stay', async () => {
  const originalFetch = global.xanoAuthFetch
  const requests = []
  try {
    global.xanoAuthFetch = async function (url) {
      requests.push(url)
      throw new Error('no request expected')
    }
    const booking = rescheduleBooking({ status: 'rescheduled', rescheduled_by: 'starter' })
    // The counterpart is still a valid responder; only the decline control is off.
    assert.equal(api.canRespondReschedule('brand', booking), true)
    assert.equal(api.canKeepCurrentTime('brand', booking), false)
    assert.equal(api.canKeepCurrentTime('starter', booking), false)
    // The counterpart keeps a non-expiring exit: Cancel stays available.
    assert.equal(api.canCancel('brand', booking), true)
    assert.equal(await api.respondReschedule('reschedule-decline', booking, 'brand'), null)
    assert.deepEqual(requests, [])
  } finally {
    global.xanoAuthFetch = originalFetch
  }
})

test('hideKeepCurrentTime adds one !important guard and hides authored controls', () => {
  const appended = []
  const authored = [
    { hidden: false, style: {}, attrs: {}, setAttribute(n, v) { this.attrs[n] = v } },
    { hidden: false, style: {}, attrs: {}, setAttribute(n, v) { this.attrs[n] = v } },
  ]
  const doc = {
    head: { appendChild(node) { appended.push(node) } },
    createElement(tag) {
      return { tag, attrs: {}, textContent: '', setAttribute(n, v) { this.attrs[n] = v } }
    },
    querySelector(selector) {
      return selector.startsWith('style[') && appended.length ? appended[0] : null
    },
    querySelectorAll(selector) {
      assert.match(selector, /booking-action-btn="reschedule-decline"/)
      assert.match(selector, /booking-card-action-btn="reschedule-decline"/)
      return authored
    },
  }
  assert.equal(api.hideKeepCurrentTime(doc), 2)
  assert.equal(api.hideKeepCurrentTime(doc), 2)
  assert.equal(appended.length, 1)
  assert.equal(appended[0].tag, 'style')
  assert.match(appended[0].textContent, /\[booking-action-btn="reschedule-decline"\]/)
  assert.match(appended[0].textContent, /display:none!important/)
  for (const control of authored) {
    assert.equal(control.hidden, true)
    assert.equal(control.style.display, 'none')
    assert.equal(control.attrs['aria-hidden'], 'true')
  }
  // Restored button: the guard is a no-op.
  const before = api.setKeepCurrentTimeEnabledForTest(true)
  try {
    const fresh = { ...doc, querySelector: () => null, head: { appendChild() { throw new Error('no style expected') } } }
    assert.equal(api.hideKeepCurrentTime(fresh), 0)
  } finally {
    api.setKeepCurrentTimeEnabledForTest(before)
  }
})

test('an authored Accept New Time alone needs no generated Keep Current Time', () => {
  const created = []
  const accept = { attributes: { 'booking-action-btn': 'confirm-reschedule' } }
  const basePanel = { getAttribute: (n) => (n === 'booking-popup-content' ? 'base' : null) }
  accept.closest = () => basePanel
  const modal = {
    querySelector(selector) {
      if (selector === '[data-starters-reschedule-views]') return {}
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('confirm-reschedule')) return [accept]
      return []
    },
  }
  const doc = { createElement(tag) { const el = { tag, attributes: {}, setAttribute(n, v) { this.attributes[n] = v } }; created.push(el); return el } }
  assert.equal(api.ensureRescheduleViews(doc, modal), true)
  assert.equal(
    created.some((el) => el.attributes && el.attributes['booking-action-btn'] === 'reschedule-decline'),
    false,
  )
})
