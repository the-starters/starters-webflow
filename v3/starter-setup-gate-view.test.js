const assert = require('node:assert/strict')
const test = require('node:test')
const { mount, stepsFor } = require('./starter-setup-gate-view')

test('Calendar never opens the gate by itself and precedes Stripe when setup is required', () => {
  assert.deepEqual(stepsFor({ availability: true, calendar: false, stripe: 'ready' }), [])
  assert.deepEqual(stepsFor({ availability: false, calendar: false, stripe: 'disconnected' }),
    ['availability', 'calendar', 'stripe'])
  assert.deepEqual(stepsFor({ availability: true, calendar: false, stripe: 'disconnected' }, true), ['stripe'])
})

test('Skip persists across visits to the mounted gate and Enter activates the close control', () => {
  const handlers = new Map()
  const steps = ['availability', 'calendar', 'stripe', 'done'].map((step) => ({
    getAttribute: () => step,
    querySelector: () => null,
    querySelectorAll: () => [],
  }))
  const dialog = {
    matches: () => true,
    querySelector: () => null,
    querySelectorAll: () => steps,
    addEventListener: (name, handler) => handlers.set(name, handler),
  }
  const view = mount(dialog)
  const status = { availability: true, calendar: false, stripe: 'disconnected' }
  assert.equal(view.begin(status), 'calendar')
  handlers.get('click')({
    target: { closest: () => ({ getAttribute: () => 'skip-calendar' }) },
    preventDefault() {},
  })
  assert.equal(steps[2].hidden, false)
  assert.equal(view.begin(status), 'stripe')
  assert.equal(view.advance({ ...status, stripe: 'ready' }), 'done')

  let clicked = 0
  handlers.get('keydown')({
    key: 'Enter',
    target: { closest: () => ({ click: () => { clicked += 1 } }) },
    preventDefault() {},
  })
  assert.equal(clicked, 1)
})
