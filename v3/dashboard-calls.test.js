const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./dashboard-calls.js')

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
