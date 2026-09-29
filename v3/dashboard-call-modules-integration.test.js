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
  assert.equal(decline.hidden, false)
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

test('detail action refresh preserves back control visibility away from base', () => {
  const back = button('switch-base')
  back.hidden = true
  const panels = ['base', 'cancel'].map(function (name) {
    return {
      hidden: name !== 'base',
      style: {},
      getAttribute(attribute) {
        return attribute === 'booking-popup-content' ? name : null
      },
    }
  })
  const modal = {
    querySelectorAll(selector) {
      if (selector === '[booking-popup-content]') return panels
      if (selector.includes('switch-base')) return [back]
      if (selector.includes('[booking-action-btn]')) return [back]
      return []
    },
  }

  global.StartersDashboardCallActions.switchPopupContent(modal, 'cancel')
  assert.equal(back.hidden, false)

  dashboard.configureDetailActions(modal, 'starter', 'confirmed', {
    booking_id: 'booking-refresh',
    status: 'confirmed',
    start: Date.now() + 60 * 60 * 1000,
  })

  assert.equal(back.hidden, false)
  assert.equal(panels[0].hidden, true)
  assert.equal(panels[1].hidden, false)
})

// Kaeser 2026-09-28: every Brand step view showed two X icons, the header
// [close-to-base] back control beside the dialog close. A step that authors
// its own Back, or a receipt that authors its own Close, now keeps only that
// control; a panel with neither (payment-methods) keeps the header X, so every
// panel still has a way out.
test('the header back X shows only on a panel without its own Back or Close', () => {
  const header = button('switch-base')
  header.attributes = { 'close-to-base': '' }
  header.hasAttribute = (name) => name in header.attributes
  const ownBacks = {}
  const ownCloses = {}
  const withBack = ['cancel', 'cancel-reason', 'reschedule-calendar']
  const receipts = [
    'cancelled',
    'declined',
    'reschedule-proposed',
    'reschedule-updated',
    'reschedule-accepted',
    'reschedule-declined',
  ]
  const panels = ['base', ...withBack, ...receipts, 'payment-methods']
    .map(function (name) {
      if (withBack.includes(name)) ownBacks[name] = button('switch-base')
      if (receipts.includes(name)) ownCloses[name] = button('switch-close')
      return {
        name,
        hidden: name !== 'base',
        style: {},
        getAttribute(attribute) {
          return attribute === 'booking-popup-content' ? name : null
        },
        querySelector(selector) {
          const matches = []
          if (ownBacks[name]) matches.push('switch-base')
          if (ownCloses[name]) matches.push('switch-close')
          const hit = matches.find((action) => selector.includes('"' + action + '"'))
          return hit === 'switch-base' ? ownBacks[name] : hit === 'switch-close' ? ownCloses[name] : null
        },
        querySelectorAll() { return [] },
      }
    })
  const modal = {
    querySelectorAll(selector) {
      if (selector === '[booking-popup-content]') return panels
      if (selector.includes('switch-base')) return [header, ...Object.values(ownBacks)]
      if (selector.includes('[booking-action-btn]')) return [header]
      return []
    },
  }
  const actions = global.StartersDashboardCallActions
  for (const panel of panels) {
    actions.switchPopupContent(modal, panel.name)
    const own = ownBacks[panel.name] || ownCloses[panel.name]
    if (panel.name === 'base') {
      assert.equal(header.hidden, true)
      Object.values(ownBacks).forEach((control) => assert.equal(control.hidden, true))
      continue
    }
    assert.equal(header.hidden, Boolean(own), panel.name + ': one way out only')
    assert.equal(header.style.display, own ? 'none' : '')
    if (ownBacks[panel.name]) assert.equal(ownBacks[panel.name].hidden, false, panel.name + ': its own Back stays')
    assert.ok(!header.hidden || own, panel.name + ': keeps a way out')
  }
  assert.equal(header.hidden, false, 'payment-methods keeps the header X as its only way back')

  // A detail refresh on a step keeps the single back control.
  actions.switchPopupContent(modal, 'cancel')
  dashboard.configureDetailActions(modal, 'brand', 'confirmed', {
    booking_id: 'booking-header-x',
    status: 'confirmed',
    start: Date.now() + 60 * 60 * 1000,
  })
  assert.equal(header.hidden, true)
  assert.equal(ownBacks.cancel.hidden, false)
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

test('unsupported lifecycle and payment controls stay inactive', async () => {
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
  assert.equal(await global.StartersDashboardCallPayment.wire(), false)
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
    start: Date.now() + 24 * 60 * 60 * 1000,
    server_now_ms: Date.now(),
    starter_data: { memberstack_id: 'mem_sb_starter' },
    brand_data: { memberstack_id: 'mem_sb_brand' },
  }

  global.StartersDashboardCallActions.bindCanonicalClock([confirmedBooking], performance.now())
  dashboard.configureDetailActions(modal, 'starter', 'confirmed', confirmedBooking, Date.now())
  assert.equal(propose.hidden, false)
  assert.equal(proposeContinue.hidden, false)
  assert.equal(accept.hidden, true)
  assert.equal(keep.hidden, true)

  const proposedBooking = { ...confirmedBooking, start_old: confirmedBooking.start, status: 'rescheduled', rescheduled_by: 'starter' }
  global.StartersDashboardCallActions.bindCanonicalClock([proposedBooking], performance.now())
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
      canConfirmReschedule() {
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
    start: Date.now() + 24 * 60 * 60 * 1000,
    server_now_ms: Date.now(),
    starter_data: { memberstack_id: 'mem_sb_starter' },
    brand_data: { memberstack_id: 'mem_sb_brand' },
  }
  global.StartersDashboardCallActions.bindCanonicalClock([eligibleBooking], performance.now())
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
    dashboard.wireBookingDetails([{ rows }], 'brand')
    // …then the async-loaded actions module wires second.
    global.StartersDashboardCallActions.wire({
      document: global.document,
      role: 'brand',
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

    currentBooking = { ...eligibleBooking, status: 'pending' }
    rows[0] = currentBooking
    reschedulePanel.hidden = true
    basePanel.hidden = false
    const pendingBefore = getBookingCalls
    const pending = dispatch()
    assert.equal(getBookingCalls, pendingBefore + 1)
    assert.equal(pending.stopped, true)
    assert.equal(pending.prevented, 1)
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

// Soft launch (JP meeting, 2026-09-30): the details modal must not name a Paid
// feature that is not live yet. Gated Paid actions hide with no hint, and a
// hint node that an earlier version or booking left behind hides too.
// `stale` seeds visible module hint nodes, as v1.59.640 and older made them.
function hintModal(buttons, stale = []) {
  const hints = {}
  const inserted = []
  const ownerDocument = {
    createElement() {
      return {
        hidden: false,
        style: {},
        textContent: '',
        setAttribute(name, value) {
          if (name === 'data-starters-action-hint') hints[value] = this
        },
      }
    },
  }
  for (const name of stale) {
    const node = ownerDocument.createElement('div')
    node.setAttribute('data-starters-action-hint', name)
    node.textContent = 'stale ' + name + ' hint'
  }
  for (const node of buttons) {
    node.insertAdjacentElement = function (position, element) {
      inserted.push(element)
    }
  }
  return {
    hints,
    inserted,
    querySelectorAll() {
      return buttons
    },
    querySelector(selector) {
      const match = /data-starters-action-hint="([^"]+)"/.exec(selector)
      return match ? hints[match[1]] || null : null
    },
    ownerDocument,
  }
}

test('gated Paid Reschedule and Cancel hide with no explanation hint', () => {
  const originalActions = global.StartersDashboardCallActions
  try {
    global.StartersDashboardCallActions = {
      wire() {},
      ensureRescheduleViews() { return true },
      canDecline() { return false },
      canCancel() { return false },
      canProposeReschedule() { return false },
      // The gate reads the resolved kind now, because one button serves both
      // the confirmed propose flow and the pending time update.
      rescheduleKindFor() { return '' },
      canRespondReschedule() { return false },
    }
    const paidBooking = {
      booking_id: 'booking-hint-1',
      status: 'confirmed',
      is_paid: true,
      start: Date.now() + 60 * 60 * 1000,
    }
    for (const role of ['brand', 'starter']) {
      const reschedule = button('reschedule')
      const cancel = button('switch-cancel')
      const modal = hintModal([reschedule, cancel])
      dashboard.configureDetailActions(modal, role, 'confirmed', paidBooking, Date.now())
      assert.equal(reschedule.hidden, true, role + ': Paid Reschedule hides')
      assert.equal(cancel.hidden, true, role + ': Paid Cancel hides')
      assert.deepEqual(Object.keys(modal.hints), [], role + ': no hint node is made')
      assert.equal(modal.inserted.length, 0, role + ': nothing is inserted after the buttons')
    }

    // A modal that an older version (or an earlier booking) left with visible
    // hints clears them on the next populate, for every hint name.
    const reschedule = button('reschedule')
    const cancel = button('switch-cancel')
    const decline = button('switch-decline')
    const reused = hintModal([reschedule, cancel, decline], ['reschedule', 'cancel', 'decline'])
    for (const name of ['reschedule', 'cancel', 'decline']) {
      assert.equal(reused.hints[name].hidden, false, name + ': seeded visible')
    }
    dashboard.configureDetailActions(reused, 'brand', 'confirmed', paidBooking, Date.now())
    for (const name of ['reschedule', 'cancel', 'decline']) {
      assert.equal(reused.hints[name].hidden, true, name + ': stale hint hides')
      assert.equal(reused.hints[name].style.display, 'none', name + ': stale hint display none')
    }

    // When the actions are available (Free), the buttons show and no hint appears.
    global.StartersDashboardCallActions.rescheduleKindFor = () => 'reschedule-propose'
    global.StartersDashboardCallActions.canCancel = () => true
    const freeReschedule = button('reschedule')
    const freeCancel = button('switch-cancel')
    const freeModal = hintModal([freeReschedule, freeCancel])
    dashboard.configureDetailActions(
      freeModal, 'brand', 'confirmed', { ...paidBooking, is_paid: false }, Date.now(),
    )
    assert.equal(freeReschedule.hidden, false)
    assert.equal(freeCancel.hidden, false)
    assert.deepEqual(Object.keys(freeModal.hints), [])
  } finally {
    global.StartersDashboardCallActions = originalActions
  }
})

// Kaeser 2026-09-28 (P4) made the reschedule hint Paid-only. The soft-launch
// rule (2026-09-30) now removes it for Paid too, so no viewer gets a hint.
test('a call with no reschedule control for the viewer shows no reschedule hint', () => {
  const realActions = require('./dashboard-call-actions.js')
  const originalActions = global.StartersDashboardCallActions
  const now = Date.now()
  const base = {
    booking_id: 'booking-free-hint',
    config_id: 'config-free-hint',
    grant_id: 'grant-free-hint',
    duration: 30,
    data_environment: 'production',
    start: now + 48 * 60 * 60 * 1000,
    confirmation_expires_at: now + 24 * 60 * 60 * 1000,
    starter_data: { memberstack_id: 'mem_starter' },
    brand_data: { memberstack_id: 'mem_brand' },
  }
  try {
    global.StartersDashboardCallActions = realActions
    for (const [role, status, isPaid, start] of [
      // Free: the Starter cannot restate a pending request.
      ['starter', 'pending', false, base.start],
      // Free: inside the reschedule window nobody gets a control.
      ['brand', 'confirmed', false, now + 60 * 60 * 1000],
      // Paid: the gate is real, but soft launch shows no explanation.
      ['brand', 'confirmed', true, base.start],
      ['starter', 'confirmed', true, base.start],
    ]) {
      const reschedule = button('reschedule')
      const modal = hintModal([reschedule])
      const booking = { ...base, status, is_paid: isPaid, start, server_now_ms: now }
      realActions.bindCanonicalClock([booking], realActions.monotonicNow())
      dashboard.configureDetailActions(modal, role, status, booking, now)
      const label = role + ' ' + status + ' paid=' + isPaid
      assert.equal(reschedule.hidden, true, label + ': no reschedule control')
      assert.equal(modal.hints.reschedule, undefined, label + ': no hint')
    }
    // A Free call that does offer the control still shows no hint.
    const reschedule = button('reschedule')
    const modal = hintModal([reschedule])
    const eligible = { ...base, status: 'confirmed', is_paid: false, server_now_ms: now }
    realActions.bindCanonicalClock([eligible], realActions.monotonicNow())
    dashboard.configureDetailActions(modal, 'brand', 'confirmed', eligible, now)
    assert.equal(reschedule.hidden, false)
    assert.equal(modal.hints.reschedule, undefined)
  } finally {
    global.StartersDashboardCallActions = originalActions
  }
})

// Paid pending cancellation is hard-launch work, so canCancel hides the
// Brand's Cancel on a Paid pending request. Soft launch shows no hint for it,
// and nothing changes for Free requests or for the Starter, who declines.
test('Brand pending Paid request hides Cancel with no hint', () => {
  const originalActions = global.StartersDashboardCallActions
  const realActions = require('./dashboard-call-actions.js')
  const now = Date.now()
  const pending = {
    booking_id: 'booking-pending-hint',
    config_id: 'config-pending-hint',
    data_environment: 'production',
    status: 'pending',
    start: now + 48 * 60 * 60 * 1000,
    brand_data: { memberstack_id: 'mem_brand' },
    starter_data: { memberstack_id: 'mem_starter' },
  }
  try {
    global.StartersDashboardCallActions = {
      wire() {},
      ensureRescheduleViews() { return true },
      canDecline: realActions.canDecline,
      canCancel: realActions.canCancel,
      rescheduleKindFor() { return '' },
      canRespondReschedule() { return false },
    }

    const paidCancel = button('switch-cancel')
    const paidModal = hintModal([paidCancel], ['cancel'])
    dashboard.configureDetailActions(paidModal, 'brand', 'pending', { ...pending, is_paid: true }, now)
    assert.equal(paidCancel.hidden, true)
    assert.equal(paidModal.hints.cancel.hidden, true, 'a stale Paid cancel hint hides')
    assert.equal(paidModal.inserted.length, 0)

    // Free pending: the Brand keeps its working Cancel and gets no hint.
    const freeCancel = button('switch-cancel')
    const freeModal = hintModal([freeCancel])
    dashboard.configureDetailActions(freeModal, 'brand', 'pending', { ...pending, is_paid: false }, now)
    assert.equal(freeCancel.hidden, false)
    assert.equal(freeModal.hints.cancel, undefined)

    // Re-rendering the reused modal for a Free request keeps the hint hidden.
    dashboard.configureDetailActions(paidModal, 'brand', 'pending', { ...pending, is_paid: false }, now)
    assert.equal(paidCancel.hidden, false)
    assert.equal(paidModal.hints.cancel.hidden, true)

    // The Starter never cancels a pending request, Paid or Free.
    const starterCancel = button('switch-cancel')
    const starterModal = hintModal([starterCancel])
    dashboard.configureDetailActions(starterModal, 'starter', 'pending', { ...pending, is_paid: true }, now)
    assert.equal(starterCancel.hidden, true)
    assert.equal(starterModal.hints.cancel, undefined)
  } finally {
    global.StartersDashboardCallActions = originalActions
  }
})

// Soft launch (JP, 2026-09-26): Paid decline is hard-launch work. The Starter
// keeps Accept on a Paid request and loses Decline. Since 2026-09-30 the
// details modal no longer explains the hidden Decline. Free keeps Decline.
test('Starter Paid request hides Decline with no hint; Free keeps Decline', () => {
  const originalActions = global.StartersDashboardCallActions
  const now = Date.now()
  const pending = {
    booking_id: 'booking-decline-hint',
    config_id: 'config-decline-hint',
    data_environment: 'production',
    status: 'pending',
    start: now + 48 * 60 * 60 * 1000,
    confirmation_expires_at: now + 24 * 60 * 60 * 1000,
    brand_data: { memberstack_id: 'mem_brand' },
    starter_data: { memberstack_id: 'mem_starter' },
  }
  try {
    global.StartersDashboardCallActions = require('./dashboard-call-actions.js')

    // Card: Accept stays, Decline goes, for Paid only.
    const cardAccept = button('switch-confirm')
    const cardDecline = button('switch-decline')
    const card = { querySelectorAll() { return [cardAccept, cardDecline] } }
    dashboard.configureActionButtons(card, 'starter', 'pending', { ...pending, is_paid: true }, now)
    assert.equal(cardAccept.hidden, false)
    assert.equal(cardDecline.hidden, true)
    dashboard.configureActionButtons(card, 'starter', 'pending', { ...pending, is_paid: false }, now)
    assert.equal(cardAccept.hidden, false)
    assert.equal(cardDecline.hidden, false)

    // Details: every authored decline step hides and no hint explains it.
    const accept = button('switch-confirm')
    const decline = button('switch-decline')
    const declineReason = button('switch-decline-reason')
    const declineSubmit = button('decline')
    const modal = hintModal([accept, decline, declineReason, declineSubmit])
    dashboard.configureDetailActions(modal, 'starter', 'pending', { ...pending, is_paid: true }, now)
    assert.equal(accept.hidden, false)
    assert.equal(decline.hidden, true)
    assert.equal(declineReason.hidden, true)
    assert.equal(declineSubmit.hidden, true)
    assert.equal(modal.hints.decline, undefined, 'the hidden Paid Decline has no hint')
    assert.equal(modal.inserted.length, 0)

    // Reusing the modal for a Free request restores Decline.
    dashboard.configureDetailActions(modal, 'starter', 'pending', { ...pending, is_paid: false }, now)
    assert.equal(decline.hidden, false)
    assert.equal(declineReason.hidden, false)
    assert.equal(declineSubmit.hidden, false)
    assert.equal(modal.hints.decline, undefined)

    // A stale decline hint from an older version hides on a Paid request.
    const staleDecline = button('switch-decline')
    const staleModal = hintModal([staleDecline], ['decline'])
    dashboard.configureDetailActions(staleModal, 'starter', 'pending', { ...pending, is_paid: true }, now)
    assert.equal(staleDecline.hidden, true)
    assert.equal(staleModal.hints.decline.hidden, true)

    // The Brand never declines, and an expired or confirmed Paid request is
    // read-only: Decline stays hidden and no hint appears.
    for (const [role, booking] of [
      ['brand', { ...pending, is_paid: true }],
      ['starter', { ...pending, is_paid: true, confirmation_expires_at: now - 1000 }],
      ['starter', { ...pending, is_paid: true, status: 'confirmed' }],
    ]) {
      const other = button('switch-decline')
      const otherModal = hintModal([other])
      dashboard.configureDetailActions(
        otherModal, role, dashboard.bookingStatus(booking, now), booking, now,
      )
      assert.equal(other.hidden, true)
      assert.equal(otherModal.hints.decline, undefined)
    }
  } finally {
    global.StartersDashboardCallActions = originalActions
  }
})
