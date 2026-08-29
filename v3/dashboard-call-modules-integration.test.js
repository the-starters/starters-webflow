const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
global.StartersDashboardCallActions = require('./dashboard-call-actions.js')
global.StartersDashboardCallMedia = require('./dashboard-call-media.js')
global.StartersDashboardCallPayment = require('./dashboard-call-payment.js')
const dashboard = require('./dashboard-calls.js')

function button(action) {
  return {
    action,
    hidden: false,
    style: {},
    getAttribute(name) {
      return name === 'booking-action-btn' ? this.action : null
    },
  }
}

test('dashboard exposes only supported migrated actions', () => {
  const details = button('details')
  const accept = button('switch-confirm')
  const decline = button('switch-decline')
  const cancel = button('switch-cancel')
  const reschedule = button('reschedule')
  const media = button('notetaker-media')
  const card = {
    querySelectorAll() {
      return [details, accept, decline, cancel, reschedule, media]
    },
  }
  const booking = {
    booking_id: 'booking-1',
    config_id: 'config-1',
    data_environment: 'test',
    status: 'pending',
    starter_data: { memberstack_id: 'mem_sb_starter' },
  }

  dashboard.configureActionButtons(card, 'starter', 'pending', booking)
  assert.equal(details.hidden, false)
  assert.equal(accept.hidden, false)
  assert.equal(decline.hidden, true)
  assert.equal(cancel.hidden, true)
  assert.equal(reschedule.hidden, true)
  assert.equal(media.hidden, true)
})

test('card actions keep notetaker media and other legacy controls inside Details', () => {
  const media = button('notetaker-media')
  const cancel = button('cancel')
  const card = {
    querySelectorAll() {
      return [media, cancel]
    },
  }
  dashboard.configureActionButtons(card, 'brand', 'completed', {
    booking_id: 'booking-1',
    status: 'completed',
    notetaker_id: 'notetaker-1',
    grant_id: 'grant-1',
  })
  assert.equal(media.hidden, true)
  assert.equal(cancel.hidden, true)
})

test('Details exposes exact supported decline and media actions only', () => {
  const close = button('switch-close')
  const decline = button('switch-decline')
  const cancel = button('switch-cancel')
  const reschedule = button('reschedule')
  const media = button('notetaker-media')
  const modal = {
    querySelectorAll() {
      return [close, decline, cancel, reschedule, media]
    },
  }
  dashboard.configureDetailActions(modal, 'starter', 'pending', {
    booking_id: 'booking-1',
    config_id: 'config-1',
    data_environment: 'test',
    status: 'pending',
    starter_data: { memberstack_id: 'mem_sb_starter' },
  })
  assert.equal(close.hidden, false)
  assert.equal(decline.hidden, false)
  assert.equal(cancel.hidden, true)
  assert.equal(reschedule.hidden, true)
  assert.equal(media.hidden, true)

  dashboard.configureDetailActions(modal, 'brand', 'completed', {
    booking_id: 'booking-2',
    status: 'completed',
    notetaker_id: 'notetaker-1',
    grant_id: 'grant-1',
  })
  assert.equal(media.hidden, false)
  assert.equal(decline.hidden, true)
  assert.equal(cancel.hidden, true)
  assert.equal(reschedule.hidden, true)

  dashboard.configureDetailActions(modal, 'brand', 'completed', {
    booking_id: 'booking-ended',
    status: 'confirmed',
    end: Date.now() - 1000,
    notetaker_id: 'notetaker-1',
    grant_id: 'grant-1',
  })
  assert.equal(media.hidden, false)
})

test('dashboard reuses already-loaded narrow modules', async () => {
  const loaded = await dashboard.loadDashboardCallModules()
  assert.equal(loaded.actions, global.StartersDashboardCallActions)
  assert.equal(loaded.media, global.StartersDashboardCallMedia)
  assert.equal(loaded.payment, global.StartersDashboardCallPayment)
})

test('optional module loading does not block dashboard boot', async () => {
  const originalDocument = global.document
  const originalLocation = global.location
  const originalSetTimeout = global.setTimeout
  const originalBooted = global.__startersDashboardCallsBooted
  const originalWfXano = global.WfXano
  const originalActions = global.StartersDashboardCallActions
  const originalMedia = global.StartersDashboardCallMedia
  const originalPayment = global.StartersDashboardCallPayment
  const appended = []
  let fallbackCount = 0

  global.document = {
    createElement() {
      return {
        addEventListener() {},
        setAttribute() {},
      }
    },
    head: {
      appendChild(script) {
        appended.push(script)
      },
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
  }
  global.location = { pathname: '/starter-dashboard' }
  global.setTimeout = function () {
    fallbackCount += 1
    return fallbackCount
  }
  global.__startersDashboardCallsBooted = false
  global.WfXano = []
  delete global.StartersDashboardCallActions
  delete global.StartersDashboardCallMedia
  delete global.StartersDashboardCallPayment

  try {
    const outcome = await Promise.race([
      dashboard.boot().then(function () {
        return 'booted'
      }),
      new Promise(function (resolve) {
        originalSetTimeout(function () {
          resolve('blocked')
        }, 25)
      }),
    ])
    assert.equal(outcome, 'booted')
  } finally {
    global.document = originalDocument
    global.location = originalLocation
    global.setTimeout = originalSetTimeout
    global.__startersDashboardCallsBooted = originalBooted
    global.WfXano = originalWfXano
    global.StartersDashboardCallActions = originalActions
    global.StartersDashboardCallMedia = originalMedia
    global.StartersDashboardCallPayment = originalPayment
  }
})

test('optional modules wire once when they load after the fallback', async () => {
  const originalDocument = global.document
  const originalSetTimeout = global.setTimeout
  const originalActions = global.StartersDashboardCallActions
  const originalMedia = global.StartersDashboardCallMedia
  const originalPayment = global.StartersDashboardCallPayment
  const scripts = []
  const fallbacks = []
  const wireCounts = { actions: 0, media: 0, payment: 0 }
  const available = []

  global.document = {
    createElement() {
      const listeners = {}
      const script = {
        listeners,
        addEventListener(name, listener) {
          listeners[name] = listener
        },
        setAttribute() {},
      }
      scripts.push(script)
      return script
    },
    head: {
      appendChild() {},
    },
    querySelector() {
      return null
    },
  }
  global.setTimeout = function (callback) {
    fallbacks.push(callback)
    return fallbacks.length
  }
  delete global.StartersDashboardCallActions
  delete global.StartersDashboardCallMedia
  delete global.StartersDashboardCallPayment

  try {
    const wiring = dashboard.wireDashboardCallModules({
      document: global.document,
      onAvailable(_dashboardModule, key) {
        available.push(key)
      },
    })
    fallbacks.forEach(function (fallback) {
      fallback()
    })
    const loaded = await wiring
    assert.deepEqual(loaded, { actions: null, media: null, payment: null })

    global.StartersDashboardCallActions = {
      wire() {
        wireCounts.actions += 1
      },
    }
    global.StartersDashboardCallMedia = {
      wire() {
        wireCounts.media += 1
      },
    }
    global.StartersDashboardCallPayment = {
      wire() {
        wireCounts.payment += 1
      },
    }
    scripts.forEach(function (script) {
      script.listeners.load()
      script.listeners.load()
    })

    assert.deepEqual(wireCounts, { actions: 1, media: 1, payment: 1 })
    assert.deepEqual(available, ['actions', 'media', 'payment'])
    assert.equal(loaded.actions, global.StartersDashboardCallActions)
    assert.equal(loaded.media, global.StartersDashboardCallMedia)
    assert.equal(loaded.payment, global.StartersDashboardCallPayment)
  } finally {
    global.document = originalDocument
    global.setTimeout = originalSetTimeout
    global.StartersDashboardCallActions = originalActions
    global.StartersDashboardCallMedia = originalMedia
    global.StartersDashboardCallPayment = originalPayment
  }
})

test('unsupported lifecycle and payment controls stay inactive', () => {
  const cancel = button('switch-cancel')
  const reschedule = button('reschedule')
  const payment = button('replace-payment-method')
  const modal = {
    querySelectorAll() {
      return [cancel, reschedule, payment]
    },
  }

  dashboard.configureDetailActions(modal, 'brand', 'confirmed', {
    booking_id: 'booking-paid-1',
    paid_meeting: true,
    payment_environment: 'test',
    payment_status: 'expired_card',
    status: 'confirmed',
  })

  assert.equal(cancel.hidden, true)
  assert.equal(reschedule.hidden, true)
  assert.equal(payment.hidden, true)
  assert.equal(global.StartersDashboardCallPayment.wire(), false)
})

test('Details exposes the full cancel chain for booked participant calls only', () => {
  const close = button('switch-close')
  const switchCancel = button('switch-cancel')
  const switchCancelReason = button('switch-cancel-reason')
  const cancel = button('cancel')
  const reschedule = button('reschedule')
  const modal = {
    querySelectorAll() {
      return [close, switchCancel, switchCancelReason, cancel, reschedule]
    },
  }
  const booking = {
    booking_id: 'booking-2',
    config_id: 'config-1',
    data_environment: 'test',
    status: 'confirmed',
    start: Date.now() + 60 * 60 * 1000,
    starter_data: { memberstack_id: 'mem_sb_starter' },
    brand_data: { memberstack_id: 'mem_sb_brand' },
  }

  dashboard.configureDetailActions(modal, 'starter', 'confirmed', booking, Date.now())
  assert.equal(switchCancel.hidden, false)
  assert.equal(switchCancelReason.hidden, false)
  assert.equal(cancel.hidden, false)
  assert.equal(reschedule.hidden, true)

  dashboard.configureDetailActions(modal, 'brand', 'confirmed', booking, Date.now())
  assert.equal(switchCancel.hidden, false)
  assert.equal(cancel.hidden, false)

  dashboard.configureDetailActions(
    modal,
    'starter',
    'pending',
    { ...booking, status: 'pending' },
    Date.now(),
  )
  assert.equal(switchCancel.hidden, true)
  assert.equal(switchCancelReason.hidden, true)
  assert.equal(cancel.hidden, true)

  dashboard.configureDetailActions(
    modal,
    'starter',
    'confirmed',
    { ...booking, start: Date.now() - 1000 },
    Date.now(),
  )
  assert.equal(switchCancel.hidden, true)
})

test('Details exposes the decline reason step alongside decline', () => {
  const switchDecline = button('switch-decline')
  const switchDeclineReason = button('switch-decline-reason')
  const decline = button('decline')
  const modal = {
    querySelectorAll() {
      return [switchDecline, switchDeclineReason, decline]
    },
  }
  const booking = {
    booking_id: 'booking-3',
    config_id: 'config-1',
    data_environment: 'test',
    status: 'pending',
    starter_data: { memberstack_id: 'mem_sb_starter' },
  }
  dashboard.configureDetailActions(modal, 'starter', 'pending', booking, Date.now())
  assert.equal(switchDecline.hidden, false)
  assert.equal(switchDeclineReason.hidden, false)
  assert.equal(decline.hidden, false)
})

test('injected module scripts inherit the loader cache key', async () => {
  const originalDocument = global.document
  const originalSetTimeout = global.setTimeout
  const originalActions = global.StartersDashboardCallActions
  const appended = []

  function harness(loaderSrc) {
    return {
      createElement() {
        return {
          addEventListener() {},
          setAttribute() {},
        }
      },
      head: {
        appendChild(script) {
          appended.push(script.src)
        },
      },
      querySelector(selector) {
        if (
          selector === 'script[src*="/v3/dashboard-calls.js"]' &&
          loaderSrc
        ) {
          return {
            getAttribute(name) {
              return name === 'src' ? loaderSrc : null
            },
          }
        }
        return null
      },
    }
  }

  global.setTimeout = function (fn) {
    fn()
    return 0
  }
  delete global.StartersDashboardCallActions

  try {
    global.document = harness(
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/dashboard-calls.js?v=1.59.408',
    )
    assert.equal(dashboard.moduleCacheSuffix(), '?v=1.59.408')
    await dashboard.loadDashboardModule({
      globalName: 'StartersDashboardCallActions',
      path: 'dashboard-call-actions.js',
      marker: 'data-starters-dashboard-call-actions',
    })
    assert.equal(
      appended[appended.length - 1],
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/dashboard-call-actions.js?v=1.59.408',
    )

    global.document = harness(
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/dashboard-calls.js',
    )
    assert.equal(dashboard.moduleCacheSuffix(), '')
    await dashboard.loadDashboardModule({
      globalName: 'StartersDashboardCallActions',
      path: 'dashboard-call-actions.js',
      marker: 'data-starters-dashboard-call-actions',
    })
    assert.equal(
      appended[appended.length - 1],
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/dashboard-call-actions.js',
    )
  } finally {
    global.document = originalDocument
    global.setTimeout = originalSetTimeout
    global.StartersDashboardCallActions = originalActions
  }
})

test('an already-present versioned module script tag is reused, not duplicated', async () => {
  const originalDocument = global.document
  const originalSetTimeout = global.setTimeout
  const originalActions = global.StartersDashboardCallActions
  const appended = []
  const existing = {
    listeners: {},
    addEventListener(name, listener) {
      this.listeners[name] = listener
    },
  }

  global.document = {
    createElement() {
      return { addEventListener() {}, setAttribute() {} }
    },
    head: {
      appendChild(script) {
        appended.push(script)
      },
    },
    querySelector(selector) {
      if (
        selector ===
        'script[data-starters-dashboard-call-actions], script[src*="/v3/dashboard-call-actions.js"]'
      ) {
        return existing
      }
      return null
    },
  }
  global.setTimeout = function (fn) {
    fn()
    return 0
  }
  delete global.StartersDashboardCallActions

  try {
    await dashboard.loadDashboardModule({
      globalName: 'StartersDashboardCallActions',
      path: 'dashboard-call-actions.js',
      marker: 'data-starters-dashboard-call-actions',
    })
    assert.equal(appended.length, 0)
    assert.equal(typeof existing.listeners.load, 'function')
  } finally {
    global.document = originalDocument
    global.setTimeout = originalSetTimeout
    global.StartersDashboardCallActions = originalActions
  }
})

test('Details exposes the reschedule propose and respond chains by eligibility', () => {
  const propose = button('reschedule')
  const proposeContinue = button('reschedule-calendar')
  const accept = button('confirm-reschedule')
  const keep = button('reschedule-decline')
  const modal = {
    querySelectorAll() {
      return [propose, proposeContinue, accept, keep]
    },
  }
  const confirmedBooking = {
    booking_id: 'booking-4',
    config_id: 'config-1',
    grant_id: 'grant-1',
    duration: 30,
    is_paid: false,
    data_environment: 'test',
    status: 'confirmed',
    start: Date.now() + 60 * 60 * 1000,
    starter_data: { memberstack_id: 'mem_sb_starter' },
    brand_data: { memberstack_id: 'mem_sb_brand' },
  }

  dashboard.configureDetailActions(modal, 'starter', 'confirmed', confirmedBooking, Date.now())
  assert.equal(propose.hidden, false)
  assert.equal(proposeContinue.hidden, false)
  assert.equal(accept.hidden, true)
  assert.equal(keep.hidden, true)

  const proposedBooking = { ...confirmedBooking, status: 'rescheduled', rescheduled_by: 'starter' }
  dashboard.configureDetailActions(modal, 'brand', 'confirmed', proposedBooking, Date.now())
  assert.equal(propose.hidden, true)
  assert.equal(accept.hidden, false)
  assert.equal(keep.hidden, false)

  dashboard.configureDetailActions(modal, 'starter', 'confirmed', proposedBooking, Date.now())
  assert.equal(accept.hidden, true)
  assert.equal(keep.hidden, true)
})

test('Details creates and exposes the module-rendered decline response action', () => {
  const originalActions = global.StartersDashboardCallActions
  const accept = button('confirm-reschedule')
  const generatedDecline = button('reschedule-decline')
  const buttons = [accept]
  const modal = {
    ownerDocument: {},
    querySelectorAll() {
      return buttons
    },
  }
  try {
    global.StartersDashboardCallActions = {
      wire() {},
      ensureRescheduleViews(document, target) {
        assert.equal(document, modal.ownerDocument)
        assert.equal(target, modal)
        buttons.push(generatedDecline)
        return true
      },
      canRespondReschedule() {
        return true
      },
    }
    dashboard.configureDetailActions(modal, 'brand', 'rescheduled', {}, Date.now())
    assert.equal(accept.hidden, false)
    assert.equal(generatedDecline.hidden, false)
  } finally {
    global.StartersDashboardCallActions = originalActions
  }
})

test('the authored Reschedule entry click reaches the actions module in real listener order', async () => {
  // Regression: wireBookingDetails registers its capture swallow at boot,
  // BEFORE the async actions module wires. The swallow must hand an eligible
  // click through, and stopImmediatePropagation from the earlier listener
  // must never be the reason the reschedule chain looks dead (Kaeser QA,
  // 2026-08-29).
  const originalDocument = global.document
  const listeners = []
  const panels = ['base', 'reschedule', 'reschedule-calendar'].map(function (name) {
    return {
      name,
      hidden: name !== 'base',
      style: { display: name === 'base' ? 'flex' : 'none' },
      getAttribute(attr) {
        return attr === 'booking-popup-content' ? this.name : null
      },
    }
  })
  const modal = {
    querySelector(selector) {
      // Pre-marked so ensureRescheduleViews takes its early-return path.
      if (selector.indexOf('data-starters-reschedule-views') !== -1) return {}
      if (selector.indexOf('data-starters-reschedule-respond') !== -1) return {}
      return null
    },
    querySelectorAll(selector) {
      return selector.indexOf('booking-popup-content') !== -1 ? panels : []
    },
  }
  const eligibleBooking = {
    booking_id: 'booking-int-1',
    config_id: 'config-int-1',
    data_environment: 'test',
    status: 'confirmed',
    is_paid: false,
    grant_id: 'grant-int-1',
    duration: 30,
    start: Date.now() + 60 * 60 * 1000,
    starter_data: { memberstack_id: 'mem_sb_starter' },
    brand_data: { memberstack_id: 'mem_sb_brand' },
  }
  let currentBooking = eligibleBooking
  const rows = [eligibleBooking]
  const card = {
    getAttribute(name) {
      return name === 'data-booking-id' ? 'booking-int-1' : null
    },
  }
  const rescheduleButton = {
    getAttribute(name) {
      return name === 'booking-action-btn' ? 'reschedule' : null
    },
    closest(selector) {
      if (selector === '[data-booking-id]') return card
      if (selector.indexOf('popup-booking-info') !== -1) return modal
      if (selector.indexOf('reschedule') !== -1) return this
      return null
    },
  }
  function dispatch() {
    let stopped = false
    let prevented = 0
    const event = {
      target: rescheduleButton,
      preventDefault() { prevented += 1 },
      stopImmediatePropagation() { stopped = true },
      stopPropagation() { stopped = true },
    }
    for (const listener of listeners) {
      listener(event)
      if (stopped) break
    }
    return { stopped, prevented }
  }
  try {
    global.document = {
      addEventListener(name, listener, capture) {
        assert.equal(name, 'click')
        assert.equal(capture, true)
        listeners.push(listener)
      },
      querySelector() { return null },
    }
    let getBookingCalls = 0
    // Real boot order: the dashboard swallow listener registers first…
    dashboard.wireBookingDetails([{ rows }], 'starter')
    // …then the async-loaded actions module wires second.
    global.StartersDashboardCallActions.wire({
      document: global.document,
      role: 'starter',
      restart() {},
      getBooking() {
        getBookingCalls += 1
        return currentBooking
      },
    })
    assert.equal(listeners.length, 2)

    const eligible = dispatch()
    assert.equal(getBookingCalls, 1)
    assert.equal(eligible.stopped, true)
    assert.equal(eligible.prevented, 1)
    const reschedulePanel = panels.find((panel) => panel.name === 'reschedule')
    const basePanel = panels.find((panel) => panel.name === 'base')
    assert.equal(reschedulePanel.hidden, false)
    assert.equal(basePanel.hidden, true)

    // A Paid booking stays swallowed by the first listener and never reaches
    // the actions module.
    currentBooking = { ...eligibleBooking, is_paid: true }
    rows[0] = currentBooking
    reschedulePanel.hidden = true
    basePanel.hidden = false
    const before = getBookingCalls
    const paid = dispatch()
    assert.equal(paid.stopped, true)
    assert.equal(getBookingCalls, before)
    assert.equal(reschedulePanel.hidden, true)
  } finally {
    global.document = originalDocument
  }
})

test('gated Reschedule and paid Cancel render an explanation hint', () => {
  const originalActions = global.StartersDashboardCallActions
  function hintButton(action) {
    const node = button(action)
    node.inserted = []
    node.insertAdjacentElement = function (position, element) {
      assert.equal(position, 'afterend')
      node.inserted.push(element)
    }
    return node
  }
  function hintModal(buttons) {
    const hints = {}
    return {
      hints,
      querySelectorAll() {
        return buttons
      },
      querySelector(selector) {
        const match = /data-starters-action-hint="([^"]+)"/.exec(selector)
        return match ? hints[match[1]] || null : null
      },
      ownerDocument: {
        createElement() {
          return {
            hidden: false,
            style: {},
            textContent: '',
            attributes: {},
            setAttribute(name, value) {
              this.attributes[name] = value
              if (name === 'data-starters-action-hint') hints[value] = this
            },
          }
        },
      },
    }
  }
  try {
    global.StartersDashboardCallActions = {
      wire() {},
      ensureRescheduleViews() { return true },
      canDecline() { return false },
      canCancel() { return false },
      canProposeReschedule() { return false },
      canRespondReschedule() { return false },
    }
    const reschedule = hintButton('reschedule')
    const cancel = hintButton('switch-cancel')
    const modal = hintModal([reschedule, cancel])
    const paidBooking = {
      booking_id: 'booking-hint-1',
      status: 'confirmed',
      is_paid: true,
      start: Date.now() + 60 * 60 * 1000,
    }
    dashboard.configureDetailActions(modal, 'brand', 'confirmed', paidBooking, Date.now())
    assert.equal(
      modal.hints.reschedule.textContent,
      'Rescheduling is available for confirmed Free calls.',
    )
    assert.equal(modal.hints.reschedule.hidden, false)
    assert.equal(
      modal.hints.cancel.textContent,
      'Paid call cancellation is not available yet.',
    )
    assert.equal(modal.hints.cancel.hidden, false)

    // When the actions become available the hints hide again.
    global.StartersDashboardCallActions.canProposeReschedule = () => true
    global.StartersDashboardCallActions.canCancel = () => true
    const freeBooking = { ...paidBooking, is_paid: false }
    dashboard.configureDetailActions(modal, 'brand', 'confirmed', freeBooking, Date.now())
    assert.equal(modal.hints.reschedule.hidden, true)
    assert.equal(modal.hints.cancel.hidden, true)

    // A past or terminal booking renders no hint at all.
    const freshModal = hintModal([hintButton('reschedule'), hintButton('switch-cancel')])
    global.StartersDashboardCallActions.canProposeReschedule = () => false
    global.StartersDashboardCallActions.canCancel = () => false
    dashboard.configureDetailActions(
      freshModal,
      'brand',
      'cancelled',
      { ...paidBooking, status: 'cancelled' },
      Date.now(),
    )
    assert.equal(freshModal.hints.reschedule, undefined)
    assert.equal(freshModal.hints.cancel, undefined)
  } finally {
    global.StartersDashboardCallActions = originalActions
  }
})
