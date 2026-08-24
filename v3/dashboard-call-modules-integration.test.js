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
