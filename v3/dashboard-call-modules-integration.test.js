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
})

test('dashboard reuses already-loaded narrow modules', async () => {
  const loaded = await dashboard.loadDashboardCallModules()
  assert.equal(loaded.actions, global.StartersDashboardCallActions)
  assert.equal(loaded.media, global.StartersDashboardCallMedia)
  assert.equal(loaded.payment, global.StartersDashboardCallPayment)
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
