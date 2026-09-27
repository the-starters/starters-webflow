const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const calls = require('./dashboard-calls.js')
const actions = require('./dashboard-call-actions.js')

function declinedBooking() {
  return {
    booking_id: 'f09-display-disposable',
    config_id: 'f09-display-config',
    data_environment: 'test',
    status: 'declined',
    cancelled_by: 'starter',
    start: 1_790_660_000_000,
    end: 1_790_661_800_000,
    starter_data: { name: 'Sam Starter', memberstack_id: 'mem_sb_starter' },
    brand_data: { name: 'Bella Brand', memberstack_id: 'mem_sb_brand' },
  }
}

test('both roles see Declined while the status category and actions stay terminal', () => {
  const booking = declinedBooking()
  for (const role of ['starter', 'brand']) {
    const status = calls.bookingStatus(booking, booking.start - 1000)
    assert.equal(status, 'cancelled')
    assert.equal(calls.statusLabel(status, role, booking), 'Declined')
    assert.equal(actions.canDecline(role, booking), false)
    assert.equal(actions.canCancel(role, booking, booking.start - 1000), false)
    assert.equal(calls.canConfirmBooking(role, booking, booking.start - 1000), false)
  }
})

test('the authored list pill shows Declined with the unchanged terminal variant', () => {
  const booking = declinedBooking()
  for (const nested of [true, false]) {
    const label = { textContent: '' }
    const classStates = new Map()
    const pill = {
      hidden: true,
      style: { removeProperty() {} },
      textContent: '',
      classList: { toggle(name, value) { classStates.set(name, value) } },
      querySelector() { return nested ? label : null },
      closest() { return null },
    }
    const card = {
      querySelector(selector) {
        assert.equal(selector, '[booking-element="status"]')
        return pill
      },
    }
    calls.paintStatusPill(card, 'cancelled', 'starter', booking)
    assert.equal(nested ? label.textContent : pill.textContent, 'Declined')
    assert.equal(pill.hidden, false)
    assert.equal(classStates.get(calls.statusVariantClass('cancelled')), true)
  }
})

test('Expired priority and ordinary cancellation labels remain unchanged', () => {
  for (const role of ['starter', 'brand']) {
    const booking = declinedBooking()
    assert.equal(calls.statusLabel('cancelled', role, { ...booking, status: ' DECLINED ' }), 'Declined')
    assert.equal(calls.statusLabel('cancelled', role, { ...booking, cancelled_by: 'expired' }), 'Expired')
    assert.equal(calls.statusLabel('cancelled', role, { ...booking, status: 'cancelled' }), 'Cancelled')
    assert.equal(calls.statusLabel('cancelled', role), 'Cancelled')
    assert.equal(calls.statusLabel('confirmed', role, booking), 'Upcoming')
  }
})

function authoredPanel(nodes) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '[booking-popup-content="declined"]')
      return [{ nodeType: 1, childNodes: nodes }]
    },
  }
}

test('lowercase and mixed-case authored placeholders use the role counterpart', () => {
  for (const [role, expected] of [['starter', 'Bella Brand'], ['brand', 'Sam Starter']]) {
    const nodes = ['[brand] declined this call.', '[bRaNd] receives the update.', '[Starter] receives the update.']
      .map((nodeValue) => ({ nodeType: 3, nodeValue }))
    assert.equal(actions.fillCounterpartPlaceholders(authoredPanel(nodes), 'declined', role, declinedBooking()), 3)
    assert.deepEqual(nodes.map((node) => node.nodeValue), [
      expected + ' declined this call.',
      expected + ' receives the update.',
      expected + ' receives the update.',
    ])
  }
})

test('reused authored text restores its template and keeps names and other copy literal', () => {
  const nameNode = { nodeType: 3, nodeValue: '[brand] declined this call.' }
  const untouched = { nodeType: 3, nodeValue: 'Reason: [other] with unchanged punctuation.' }
  const panel = authoredPanel([nameNode, { nodeType: 1, childNodes: [untouched] }])
  const first = { brand_data: { name: 'Brand $& $1' } }
  assert.equal(actions.fillCounterpartPlaceholders(panel, 'declined', 'starter', first), 1)
  assert.equal(nameNode.nodeValue, 'Brand $& $1 declined this call.')
  assert.equal(actions.fillCounterpartPlaceholders(panel, 'declined', 'brand', declinedBooking()), 1)
  assert.equal(nameNode.nodeValue, 'Sam Starter declined this call.')
  assert.equal(actions.fillCounterpartPlaceholders(panel, 'declined', 'starter', {}), 1)
  assert.equal(nameNode.nodeValue, 'the other participant declined this call.')
  assert.equal(untouched.nodeValue, 'Reason: [other] with unchanged punctuation.')
})
