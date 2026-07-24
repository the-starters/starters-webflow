const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./onboarding-tour.js'), 'utf8')

function fakeElement(attributes) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null
    },
  }
}

function fakeRoot(nodes) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-tour-step]')
      return nodes
    },
  }
}

function loadModule() {
  const warnings = []
  const window = {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  }
  const document = {
    readyState: 'loading',
    addEventListener() {},
    documentElement: {
      getAttribute() {
        return null
      },
    },
  }
  window.document = document
  const context = {
    window,
    document,
    console: {
      warn(...args) {
        warnings.push(args.join(' '))
      },
      error() {},
    },
    Date,
    JSON,
    Promise,
    Object,
    Array,
    Error,
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  return { api: window.StartersV3OnboardingTour, warnings }
}

// Objects created inside the vm context have foreign prototypes, which
// deepStrictEqual rejects; normalize through JSON before comparing.
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function plan(planId) {
  return { active: true, planId }
}

test('parseTours groups, sorts, and reads step content', () => {
  const { api } = loadModule()
  const nodes = [
    fakeElement({
      'data-tour-step': 'starter-dashboard:2',
      'data-tour-title': 'Second',
      'data-tour-text': 'Second body',
    }),
    fakeElement({
      'data-tour-step': 'starter-dashboard:1',
      'data-tour-title': 'First',
      'data-tour-side': 'bottom',
      'data-tour-align': 'start',
    }),
    fakeElement({ 'data-tour-step': 'brand-feed:1', 'data-tour-title': 'Other' }),
  ]

  const tours = api.parseTours(fakeRoot(nodes))
  assert.equal(tours.length, 2)
  assert.equal(tours[0].id, 'starter-dashboard')
  assert.deepEqual(
    plain(tours[0].steps.map((step) => step.title)),
    ['First', 'Second'],
  )
  assert.equal(tours[0].steps[0].side, 'bottom')
  assert.equal(tours[0].steps[0].align, 'start')
  assert.equal(tours[1].id, 'brand-feed')
})

test('parseTours keeps DOM order for equal step orders', () => {
  const { api } = loadModule()
  const nodes = [
    fakeElement({ 'data-tour-step': 't:1', 'data-tour-title': 'a' }),
    fakeElement({ 'data-tour-step': 't:1', 'data-tour-title': 'b' }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.deepEqual(
    plain(tours[0].steps.map((step) => step.title)),
    ['a', 'b'],
  )
})

test('parseTours allows colons in the tour id', () => {
  const { api } = loadModule()
  const nodes = [fakeElement({ 'data-tour-step': 'brand:feed:3' })]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.equal(tours[0].id, 'brand:feed')
  assert.equal(tours[0].steps[0].order, 3)
})

test('parseTours skips malformed steps with a warning', () => {
  const { api, warnings } = loadModule()
  const nodes = [
    fakeElement({ 'data-tour-step': 'no-order' }),
    fakeElement({ 'data-tour-step': ':1' }),
    fakeElement({ 'data-tour-step': 'ok:x' }),
    fakeElement({ 'data-tour-step': 'ok:1' }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.equal(tours.length, 1)
  assert.equal(tours[0].steps.length, 1)
  assert.equal(warnings.length, 3)
})

test('parseTours merges roles across steps and honors data-tour-once', () => {
  const { api } = loadModule()
  const nodes = [
    fakeElement({ 'data-tour-step': 't:1', 'data-tour-roles': 'talent' }),
    fakeElement({
      'data-tour-step': 't:2',
      'data-tour-roles': ' talent, brand-paid ',
      'data-tour-once': 'false',
    }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.deepEqual(plain(tours[0].roles), ['talent', 'brand-paid'])
  assert.equal(tours[0].once, false)
})

test('buildDriverSteps omits empty popover fields', () => {
  const { api } = loadModule()
  const element = fakeElement({})
  const tour = {
    steps: [
      { element, order: 1, title: 'Hi', text: '', side: '', align: '' },
      { element, order: 2, title: '', text: 'Body', side: 'top', align: 'end' },
    ],
  }
  const steps = api.buildDriverSteps(tour)
  assert.deepEqual(plain(steps[0].popover), { title: 'Hi' })
  assert.deepEqual(plain(steps[1].popover), {
    description: 'Body',
    side: 'top',
    align: 'end',
  })
  assert.equal(steps[0].element, element)
})

test('autoStartTarget respects roles, seen state, and DOM order', () => {
  const { api } = loadModule()
  const step = { order: 1 }
  const talentTour = { id: 'talent-tour', steps: [step], roles: ['talent'], once: true }
  const openTour = { id: 'open-tour', steps: [step], roles: null, once: true }
  const emptyTour = { id: 'empty', steps: [], roles: null, once: true }
  const repeatTour = { id: 'repeat', steps: [step], roles: null, once: false }

  // Role mismatch skips to the next eligible tour.
  assert.equal(
    api.autoStartTarget([talentTour, openTour], 'brand-paid', []),
    openTour,
  )
  // Matching role wins in DOM order.
  assert.equal(api.autoStartTarget([talentTour, openTour], 'talent', []), talentTour)
  // Role-gated tours never auto-start for logged-out visitors.
  assert.equal(api.autoStartTarget([talentTour], null, []), null)
  // Seen tours are skipped when once=true...
  assert.equal(api.autoStartTarget([openTour], null, ['open-tour']), null)
  // ...but not when once=false.
  assert.equal(api.autoStartTarget([repeatTour], null, ['repeat']), repeatTour)
  // Tours without steps never start.
  assert.equal(api.autoStartTarget([emptyTour], null, []), null)
})

test('memberRole maps stable plan IDs and prefers the highest mapped role', () => {
  const { api } = loadModule()
  assert.equal(
    api.memberRole({ planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')] }),
    'talent',
  )
  assert.equal(
    api.memberRole({ planConnections: [plan('pln_free-plan-f6kn0dxz')] }),
    'brand-free',
  )
  assert.equal(
    api.memberRole({
      planConnections: [
        plan('pln_dorxata-test-free-plan-dvcg0k8o'),
        plan('pln_new-paid-plan-463h04ph'),
      ],
    }),
    'brand-paid',
  )
  // Inactive and unmapped plans do not grant a role.
  assert.equal(
    api.memberRole({
      planConnections: [
        { active: false, status: 'CANCELED', planId: 'pln_new-paid-plan-463h04ph' },
        plan('pln_dorxata-test-paid-plan-8kcm0edn'),
      ],
    }),
    null,
  )
  assert.equal(api.memberRole(null), null)
})
