const assert = require('node:assert/strict')
const fs = require('node:fs')
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

test('narrow modules contain no legacy direct provider or unsafe lifecycle route', () => {
  const files = [
    'dashboard-call-actions.js',
    'dashboard-call-media.js',
    'dashboard-call-payment.js',
  ]
  const source = files
    .map((file) => fs.readFileSync(require.resolve('./' + file), 'utf8'))
    .join('\n')
  assert.doesNotMatch(source, /api\.stripe\.com/)
  assert.doesNotMatch(source, /api\.us\.nylas\.com/)
  assert.doesNotMatch(source, /\/booking\/(?:cancel|reschedule)\/v3/)
  assert.doesNotMatch(source, /innerHTML\s*=/)
  assert.match(source, /\/booking\/decline\/v3/)
  assert.match(source, /\/notetaker\/get_media\/v3/)
  assert.match(source, /\/brand\/booking\/payment-method-replace\/v3/)
})
