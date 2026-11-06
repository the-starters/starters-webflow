const assert = require('node:assert/strict')
const test = require('node:test')
const { validateHours } = require('./profile-calls-step')

const hours = {
  days: [1, 2, 3, 4, 5],
  windows: [{ start: '9:00 AM', end: '6:00 PM' }],
  extra: null,
}

test('weekly hours require a day and reject a reversed or invalid window', () => {
  assert.equal(validateHours({ ...hours, days: [] }), 'Pick at least one day.')
  assert.equal(validateHours({ ...hours, windows: [{ start: '1:00 PM', end: '12:00 PM' }] }),
    'A window has to end after it starts.')
  assert.equal(validateHours({ ...hours, windows: [{ start: '', end: '1:00 PM' }] }),
    'A window has to end after it starts.')
})

test('weekly hours reject overlap regardless of row order and allow adjacent windows', () => {
  assert.equal(validateHours({ ...hours, windows: [
    { start: '12:30 PM', end: '1:00 PM' },
    { start: '9:00 AM', end: '1:30 PM' },
  ] }), 'These windows overlap. Adjust one so they don’t.')
  assert.equal(validateHours({ ...hours, windows: [
    { start: '12:00 PM', end: '6:00 PM' },
    { start: '9:00 AM', end: '12:00 PM' },
  ] }), '')
})

test('additional hours require days and validate their own window', () => {
  assert.equal(validateHours({ ...hours, extra: { days: [], start: '9:00 AM', end: '1:00 PM' } }),
    'Pick at least one day.')
  assert.equal(validateHours({ ...hours, extra: { days: [6], start: '9:00 AM', end: '8:00 AM' } }),
    'A window has to end after it starts.')
  assert.equal(validateHours({ ...hours, extra: { days: [6], start: '9:00 AM', end: '1:00 PM' } }), '')
})
