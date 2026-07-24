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

function loadModule(options = {}) {
  const warnings = []
  const events = []
  let run
  const window = {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    $memberstackDom: options.memberstack,
    driver: options.driver,
    localStorage: options.localStorage || {
      getItem() {
        return null
      },
      setItem() {},
    },
    dispatchEvent(event) {
      events.push(event)
    },
    addEventListener() {},
    location: { search: options.search || '' },
    URLSearchParams,
  }
  const head = {
    children: [],
    appendChild(element) {
      element.parentNode = head
      head.children.push(element)
      if (options.onAssetAppend) options.onAssetAppend(element, head)
    },
    removeChild(element) {
      const index = head.children.indexOf(element)
      if (index !== -1) head.children.splice(index, 1)
      element.parentNode = null
    },
  }
  const document = {
    // 'complete' so boot's hydration settle-delay takes the setTimeout path
    // instead of waiting for a window 'load' event the stub never fires.
    // Module load still registers run via DOMContentLoaded below because
    // addEventListener is only consulted when readyState is 'loading' at
    // eval time — so keep capturing the boot callback explicitly.
    readyState: 'loading',
    head,
    createElement(tagName) {
      return { tagName: tagName.toUpperCase(), parentNode: null }
    },
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') {
        run = () => {
          document.readyState = 'complete'
          return listener()
        }
      }
    },
    // Tests toggle __popover to simulate a running/dismissed driver popover.
    __popover: null,
    querySelector(selector) {
      if (selector === '.driver-popover') return document.__popover
      if (selector.indexOf('[data-tour-step="') === 0) {
        return (options.nodes || [])[0] || null
      }
      if (options.invalidSelector === selector) {
        throw new Error(`Invalid selector: ${selector}`)
      }
      if (options.cssTargets) return options.cssTargets[selector] || null
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-tour-step]') return options.nodes || []
      if (selector === '[data-tour-start]') return []
      if (selector === 'a, button, [role="button"]') {
        return options.interactiveTextElements || options.textElements || []
      }
      if (selector === 'span, div, p') {
        return options.nonInteractiveTextElements || []
      }
      throw new Error(`Unexpected selector: ${selector}`)
    },
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
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type
        this.detail = init && init.detail
      }
    },
  }
  window.MouseEvent = class MouseEvent {
    constructor(type) {
      this.type = type
    }
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  return { api: window.StartersV3OnboardingTour, warnings, events, run, window }
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
    fakeElement({ 'data-tour-step': 't:01', 'data-tour-title': 'b' }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.deepEqual(
    plain(tours[0].steps.map((step) => step.title)),
    ['a', 'b'],
  )
})

test('parseTours skips duplicate step values with a warning', () => {
  const { api, warnings } = loadModule()
  const nodes = [
    fakeElement({ 'data-tour-step': 't:1', 'data-tour-title': 'first' }),
    fakeElement({ 'data-tour-step': 't:1', 'data-tour-title': 'duplicate' }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.deepEqual(
    plain(tours[0].steps.map((step) => step.title)),
    ['first'],
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Ignoring duplicate data-tour-step: t:1/)
})

test('parseTours allows colons in the tour id', () => {
  const { api } = loadModule()
  const nodes = [fakeElement({ 'data-tour-step': 'brand:feed:3' })]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.equal(tours[0].id, 'brand:feed')
  assert.equal(tours[0].steps[0].order, 3)
})

test('parseTours safely accepts object prototype property names as tour ids', () => {
  const { api } = loadModule()
  const nodes = [
    fakeElement({ 'data-tour-step': '__proto__:1' }),
    fakeElement({ 'data-tour-step': 'constructor:1' }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.deepEqual(
    plain(tours.map((tour) => tour.id)),
    ['__proto__', 'constructor'],
  )
  assert.equal(tours[0].steps.length, 1)
  assert.equal(tours[1].steps.length, 1)
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

test('buildDriverSteps omits empty popover fields and passes selectors', () => {
  const { api } = loadModule()
  const selector = '[data-tour-step="t:1"]'
  const tour = {
    steps: [
      { selector, order: 1, title: 'Hi', text: '', side: '', align: '' },
      { selector, order: 2, title: '', text: 'Body', side: 'top', align: 'end' },
    ],
  }
  const steps = api.buildDriverSteps(tour)
  assert.deepEqual(plain(steps[0].popover), { title: 'Hi' })
  assert.deepEqual(plain(steps[1].popover), {
    description: 'Body',
    side: 'top',
    align: 'end',
  })
  // A selector string, not a node: hydration on V3 pages can detach nodes
  // captured at parse time, and driver.js re-resolves selectors per step.
  assert.equal(steps[0].element, selector)
})

function textEl(text, descendants = 0) {
  return {
    textContent: text,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    getElementsByTagName: () => ({ length: descendants }),
  }
}

test('resolveStepElement returns the step selector when no target is set', () => {
  const { api } = loadModule()
  assert.equal(api.resolveStepElement({ selector: 'S', target: '' }), 'S')
})

test('resolveStepElement returns a matching CSS-selector target', () => {
  const { api } = loadModule({ cssTargets: { '.post-btn': {} } })
  assert.equal(
    api.resolveStepElement({ selector: 'S', target: '.post-btn' }),
    '.post-btn',
  )
})

test('resolveStepElement falls back when a CSS-selector target has no match', () => {
  const { api } = loadModule()
  assert.equal(
    api.resolveStepElement({ selector: 'S', target: '.missing' }),
    'S',
  )
})

test('resolveStepElement falls back when a CSS-selector target is invalid', () => {
  const { api } = loadModule({ invalidSelector: '[' })
  assert.equal(api.resolveStepElement({ selector: 'S', target: '[' }), 'S')
})

test('resolveStepElement text: match prefers an interactive element over a nested leaf', () => {
  const anchor = textEl('Post Opportunity', 1)
  const span = textEl('Post Opportunity', 0)
  const { api } = loadModule({
    interactiveTextElements: [anchor],
    nonInteractiveTextElements: [span],
  })
  const resolved = api.resolveStepElement({
    selector: 'S',
    target: 'text:Post Opportunity',
  })
  assert.equal(resolved, anchor)
})

test('resolveStepElement text: match uses the smallest non-interactive fallback', () => {
  const wrapper = textEl('Post Opportunity', 5)
  const span = textEl('Post Opportunity', 0)
  const { api } = loadModule({
    nonInteractiveTextElements: [wrapper, span],
  })
  const resolved = api.resolveStepElement({
    selector: 'S',
    target: 'text:Post Opportunity',
  })
  assert.equal(resolved, span)
})

test('resolveStepElement falls back to the selector when text has no match', () => {
  const hidden = {
    textContent: 'Post Opportunity',
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    getElementsByTagName: () => ({ length: 0 }),
  }
  const { api } = loadModule({ textElements: [hidden] })
  assert.equal(
    api.resolveStepElement({ selector: 'S', target: 'text:Post Opportunity' }),
    'S',
  )
})

test('resolveStepElement skips text matches with one zero dimension', () => {
  const zeroWidth = {
    textContent: 'Post Opportunity',
    getBoundingClientRect: () => ({ width: 0, height: 20 }),
    getElementsByTagName: () => ({ length: 0 }),
  }
  const zeroHeight = {
    textContent: 'Post Opportunity',
    getBoundingClientRect: () => ({ width: 100, height: 0 }),
    getElementsByTagName: () => ({ length: 0 }),
  }
  const { api } = loadModule({
    interactiveTextElements: [zeroWidth, zeroHeight],
  })
  assert.equal(
    api.resolveStepElement({ selector: 'S', target: 'text:Post Opportunity' }),
    'S',
  )
})

test('parseTours builds an escaped selector per step', () => {
  const { api } = loadModule()
  const nodes = [
    fakeElement({ 'data-tour-step': 'my"tour:1' }),
    fakeElement({ 'data-tour-step': 'line\nbreak:2' }),
    fakeElement({ 'data-tour-step': 'form\fbreak:3' }),
    fakeElement({ 'data-tour-step': 'delete\u007fbreak:4' }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.equal(tours[0].steps[0].selector, '[data-tour-step="my\\"tour:1"]')
  assert.equal(
    tours[1].steps[0].selector,
    '[data-tour-step="line\\a break:2"]',
  )
  assert.equal(
    tours[2].steps[0].selector,
    '[data-tour-step="form\\c break:3"]',
  )
  assert.equal(
    tours[3].steps[0].selector,
    '[data-tour-step="delete\\7f break:4"]',
  )
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

test('member seen state supports direct JSON and wrapped response shapes', async () => {
  for (const response of [
    { tours: { welcome: 'date' } },
    { data: { tours: { welcome: 'date' } } },
  ]) {
    let started = false
    const { run } = loadModule({
      memberstack: {
        getCurrentMember: async () => ({
          data: { id: 'member-1', planConnections: [] },
        }),
        getMemberJSON: async () => response,
      },
      driver: {
        js: {
          driver: () => ({
            drive() {
              started = true
            },
          }),
        },
      },
      nodes: [fakeElement({ 'data-tour-step': 'welcome:1' })],
    })
    await run()
    assert.equal(started, false)
  }
})

test('memberMarkSeen merges shared JSON and safely persists special tour ids', async () => {
  let update
  const memberstack = {
    getCurrentMember: async () => ({
      data: { id: 'member-1', planConnections: [] },
    }),
    getMemberJSON: async () => ({
      starterQuiz: { result: 'talent' },
      tours: { existing: 'date' },
    }),
    updateMemberJSON: async (value) => {
      update = value
    },
  }
  const { run } = loadModule({
    memberstack,
    driver: {
      js: {
        driver: () => ({ drive() {} }),
      },
    },
    nodes: [fakeElement({ 'data-tour-step': '__proto__:1' })],
  })

  await run()

  assert.deepEqual(plain(update.json.starterQuiz), { result: 'talent' })
  assert.equal(update.json.tours.existing, 'date')
  assert.equal(Object.keys(update.json.tours).includes('__proto__'), true)
})

test('boot marks a show-once tour only after driver starts successfully', async () => {
  const calls = []
  const memberstack = {
    getCurrentMember: async () => ({
      data: { id: 'member-1', planConnections: [] },
    }),
    getMemberJSON: async () => ({}),
    updateMemberJSON: async () => {
      calls.push('marked')
    },
  }
  const driver = {
    js: {
      driver() {
        return {
          drive() {
            calls.push('started')
          },
        }
      },
    },
  }
  const { run } = loadModule({
    memberstack,
    driver,
    nodes: [fakeElement({ 'data-tour-step': 'welcome:1' })],
  })

  await run()

  assert.deepEqual(calls, ['started', 'marked'])
})

test('boot does not mark seen when driver startup fails', async () => {
  let marked = false
  const memberstack = {
    getCurrentMember: async () => ({
      data: { id: 'member-1', planConnections: [] },
    }),
    getMemberJSON: async () => ({}),
    updateMemberJSON: async () => {
      marked = true
    },
  }
  const driver = {
    js: {
      driver() {
        return {
          drive() {
            throw new Error('driver failed')
          },
        }
      },
    },
  }
  const { run } = loadModule({
    memberstack,
    driver,
    nodes: [fakeElement({ 'data-tour-step': 'welcome:1' })],
  })

  await run()
  assert.equal(marked, false)
})

test('startTour prevents overlapping starts and unlocks after dismissal', async () => {
  const starts = []
  const { api, window } = loadModule({
    driver: {
      js: {
        driver() {
          return {
            drive() {
              starts.push('started')
              // Simulate driver rendering its popover, as in a real drive().
              window.document.__popover = {}
            },
          }
        },
      },
    },
  })
  const tour = {
    id: 'welcome',
    steps: [{ selector: '[data-tour-step="welcome:1"]' }],
  }

  const [first, overlapping] = await Promise.all([
    api.startTour(tour),
    api.startTour(tour),
  ])
  assert.ok(first)
  assert.equal(overlapping, null)
  assert.deepEqual(starts, ['started'])

  // Wait for the release poller to observe the rendered popover; the tour
  // is running, so a new start stays blocked by the DOM check.
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.equal(await api.startTour(tour), null)
  assert.deepEqual(starts, ['started'])

  // Dismissal (X button, Done, Esc) removes the popover from the DOM —
  // driver 1.8 fires no reliable callback for this — and replay works again.
  window.document.__popover = null
  assert.ok(await api.startTour(tour))
  assert.deepEqual(starts, ['started', 'started'])
})

test('loadDriver waits for both script and stylesheet', async () => {
  const appended = []
  const { api } = loadModule({
    onAssetAppend(element) {
      appended.push(element)
    },
  })

  let resolved = false
  const loading = api.loadDriver().then(() => {
    resolved = true
  })
  const link = appended.find((element) => element.tagName === 'LINK')
  const script = appended.find((element) => element.tagName === 'SCRIPT')

  script.onload()
  await Promise.resolve()
  assert.equal(resolved, false)

  link.onload()
  await assert.rejects(loading, /factory missing/)
})

test('loadDriver rejects CSS failure and retries after a failed attempt', async () => {
  const appended = []
  const { api, window } = loadModule({
    onAssetAppend(element) {
      appended.push(element)
    },
  })

  const first = api.loadDriver()
  const firstLink = appended.find((element) => element.tagName === 'LINK')
  firstLink.onerror()
  await assert.rejects(first, /stylesheet failed/)

  const second = api.loadDriver()
  const secondAssets = appended.slice(2)
  const secondLink = secondAssets.find((element) => element.tagName === 'LINK')
  const secondScript = secondAssets.find((element) => element.tagName === 'SCRIPT')
  assert.ok(secondLink)
  assert.ok(secondScript)
  window.driver = { js: { driver() {} } }
  secondLink.onload()
  secondScript.onload()
  assert.equal(await second, window.driver.js.driver)
})

test('replayRequestFromQuery parses start, reset, and empty values', () => {
  const { api } = loadModule()
  assert.deepEqual(plain(api.replayRequestFromQuery('?tour=starter-dashboard')), {
    startTourId: 'starter-dashboard',
    reset: false,
  })
  assert.deepEqual(plain(api.replayRequestFromQuery('?tour=reset')), {
    startTourId: null,
    reset: true,
  })
  assert.deepEqual(plain(api.replayRequestFromQuery('?other=1')), {
    startTourId: null,
    reset: false,
  })
  assert.deepEqual(plain(api.replayRequestFromQuery('')), {
    startTourId: null,
    reset: false,
  })
})

test('?tour=<id> starts the tour without marking it seen, even when already seen', async () => {
  const calls = []
  const memberstack = {
    getCurrentMember: async () => ({
      data: { id: 'member-1', planConnections: [] },
    }),
    getMemberJSON: async () => ({ tours: { welcome: 'date' } }),
    updateMemberJSON: async () => {
      calls.push('marked')
    },
  }
  const driver = {
    js: {
      driver() {
        return {
          drive() {
            calls.push('started')
          },
        }
      },
    },
  }
  const { run } = loadModule({
    memberstack,
    driver,
    search: '?tour=welcome',
    nodes: [fakeElement({ 'data-tour-step': 'welcome:1' })],
  })
  await run()
  assert.deepEqual(calls, ['started'])
})

test('?tour=reset clears seen state so auto-start runs again', async () => {
  const calls = []
  let json = { starterQuiz: { result: 'x' }, tours: { welcome: 'date' } }
  const memberstack = {
    getCurrentMember: async () => ({
      data: { id: 'member-1', planConnections: [] },
    }),
    getMemberJSON: async () => JSON.parse(JSON.stringify(json)),
    updateMemberJSON: async (value) => {
      json = value.json
      calls.push('update')
    },
  }
  const driver = {
    js: {
      driver() {
        return {
          drive() {
            calls.push('started')
          },
        }
      },
    },
  }
  const { run } = loadModule({
    memberstack,
    driver,
    search: '?tour=reset',
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {
        calls.push('guest-cleared')
      },
    },
    nodes: [fakeElement({ 'data-tour-step': 'welcome:1' })],
  })
  await run()
  // reset write, guest clear, tour start, then the normal mark-seen write
  assert.deepEqual(calls, ['update', 'guest-cleared', 'started', 'update'])
  assert.deepEqual(plain(json.starterQuiz), { result: 'x' })
  assert.equal(Object.keys(json.tours).length, 1)
})

test('unknown ?tour id warns and does not start anything', async () => {
  let started = false
  const { run, warnings } = loadModule({
    memberstack: {
      getCurrentMember: async () => ({
        data: { id: 'member-1', planConnections: [] },
      }),
      getMemberJSON: async () => ({}),
      updateMemberJSON: async () => {},
    },
    driver: {
      js: {
        driver: () => ({
          drive() {
            started = true
          },
        }),
      },
    },
    search: '?tour=nope',
    nodes: [fakeElement({ 'data-tour-step': 'welcome:1' })],
  })
  await run()
  assert.equal(started, false)
  assert.equal(
    warnings.some((w) => w.includes('No steps found for requested tour')),
    true,
  )
})

test('startTour injects the typography theme style exactly once', async () => {
  const appended = []
  const { api, window } = loadModule({
    driver: {
      js: {
        driver: () => ({
          drive() {},
        }),
      },
    },
    onAssetAppend(element) {
      appended.push(element)
    },
  })
  const tour = {
    id: 'welcome',
    steps: [{ selector: '[data-tour-step="welcome:1"]' }],
  }
  await api.startTour(tour)
  window.document.__popover = null
  await api.startTour(tour)
  const styles = appended.filter((element) => element.tagName === 'STYLE')
  assert.equal(styles.length, 1)
  assert.match(
    styles[0].textContent,
    /\.driver-popover \.driver-popover-title\{/,
  )
  assert.match(styles[0].textContent, /serif/)
  assert.match(
    styles[0].textContent,
    /\.driver-popover \.driver-popover-description\{/,
  )
})

function discEl({ w = 100, h = 20, dispatched = [] } = {}) {
  return {
    _w: w,
    _h: h,
    dispatched,
    getBoundingClientRect() {
      return { width: this._w, height: this._h }
    },
    getElementsByTagName() {
      return { length: 0 }
    },
    dispatchEvent(e) {
      this.dispatched.push(e.type)
      return true
    },
  }
}

test('parseTours reads data-tour-open onto the step', () => {
  const { api } = loadModule()
  const nodes = [
    fakeElement({ 'data-tour-step': 't:1', 'data-tour-open': '.avatar' }),
  ]
  const tours = api.parseTours(fakeRoot(nodes))
  assert.equal(tours[0].steps[0].open, '.avatar')
})

test('buildDriverSteps drops a disclosure step whose control is not visible', () => {
  const { api } = loadModule({
    cssTargets: { '.avatar': discEl({ w: 0, h: 0 }) }, // collapsed (mobile)
  })
  const tour = {
    steps: [{ selector: 'S1', target: '', open: '.avatar', title: 'Edit' }],
  }
  assert.equal(api.buildDriverSteps(tour).length, 0)
})

test('buildDriverSteps keeps a disclosure step when its control is visible and wires hooks', () => {
  const { api } = loadModule({
    cssTargets: { '.avatar': discEl({ w: 37, h: 37 }) },
  })
  const tour = {
    steps: [{ selector: 'S1', target: '', open: '.avatar', title: 'Edit' }],
  }
  const steps = api.buildDriverSteps(tour)
  assert.equal(steps.length, 1)
  assert.equal(typeof steps[0].onHighlightStarted, 'function')
})

test('entering a later step restores (closes) a disclosure a prior step opened', () => {
  const avatar = discEl({ w: 37, h: 37 })
  const editHidden = discEl({ w: 0, h: 0 })
  const { api } = loadModule({
    cssTargets: { '.avatar': avatar, '.edit': editHidden },
  })
  const tour = {
    steps: [
      { selector: 'S1', target: '.edit', open: '.avatar', title: 'Edit' },
      { selector: 'S2', target: '', open: '', title: 'Next' },
    ],
  }
  const steps = api.buildDriverSteps(tour)
  steps[0].onHighlightStarted() // opens the avatar menu
  assert.deepEqual(avatar.dispatched, ['mousedown', 'mouseup', 'click'])
  editHidden._w = 155
  editHidden._h = 36
  steps[1].onHighlightStarted() // moving on closes it again
  assert.deepEqual(avatar.dispatched, [
    'mousedown',
    'mouseup',
    'click',
    'mousedown',
    'mouseup',
    'click',
  ])
})

test('onHighlightStarted opens the disclosure when the target is hidden', () => {
  const avatar = discEl({ w: 37, h: 37 })
  const editHidden = discEl({ w: 0, h: 0 }) // menu closed -> target hidden
  const { api } = loadModule({
    cssTargets: { '.avatar': avatar, '.edit': editHidden },
  })
  const tour = {
    steps: [{ selector: 'S1', target: '.edit', open: '.avatar', title: 'Edit' }],
  }
  const step = api.buildDriverSteps(tour)[0]
  step.onHighlightStarted()
  // full mouse sequence dispatched on the avatar toggle
  assert.deepEqual(avatar.dispatched, ['mousedown', 'mouseup', 'click'])
})

test('onHighlightStarted checks a text target before its visible fallback', () => {
  const editHidden = {
    ...discEl({ w: 0, h: 0 }),
    textContent: 'Edit profile',
  }
  const fallbackVisible = discEl({ w: 100, h: 20 })
  const avatar = discEl({ w: 37, h: 37 })
  avatar.dispatchEvent = function (event) {
    this.dispatched.push(event.type)
    if (event.type === 'click') {
      editHidden._w = 100
      editHidden._h = 20
    }
    return true
  }
  const { api } = loadModule({
    cssTargets: { '.avatar': avatar, S1: fallbackVisible },
    textElements: [editHidden],
  })
  const tour = {
    steps: [
      {
        selector: 'S1',
        target: 'text:Edit profile',
        open: '.avatar',
        title: 'Edit',
      },
    ],
  }
  const step = api.buildDriverSteps(tour)[0]
  assert.equal(step.element, 'S1')
  step.onHighlightStarted()
  assert.deepEqual(avatar.dispatched, ['mousedown', 'mouseup', 'click'])
  assert.equal(step.element, editHidden)
})

test('disclosure step falls back when its CSS-selector target is invalid', () => {
  const avatar = discEl({ w: 37, h: 37 })
  const { api } = loadModule({
    cssTargets: { '.avatar': avatar },
    invalidSelector: '[',
  })
  const tour = {
    steps: [{ selector: 'S1', target: '[', open: '.avatar', title: 'Edit' }],
  }

  assert.equal(api.buildDriverSteps(tour)[0].element, 'S1')
})

test('invalid disclosure target does not open or leave a disclosure open', () => {
  const avatar = discEl({ w: 37, h: 37 })
  const carrier = discEl({ w: 100, h: 20 })
  const { api } = loadModule({
    nodes: [carrier],
    cssTargets: { '.avatar': avatar },
    invalidSelector: '[',
  })
  const steps = api.buildDriverSteps({
    steps: [
      {
        selector: '[data-tour-step="t:1"]',
        target: '[',
        open: '.avatar',
        title: 'Edit',
      },
      {
        selector: '[data-tour-step="t:2"]',
        target: '',
        open: '',
        title: 'Next',
      },
    ],
  })

  steps[0].onHighlightStarted()
  steps[1].onHighlightStarted()
  assert.deepEqual(avatar.dispatched, [])
})

test('restoring a disclosure does not reopen it when its target is hidden', () => {
  const avatar = discEl({ w: 37, h: 37 })
  const edit = discEl({ w: 0, h: 0 })
  const { api } = loadModule({
    cssTargets: { '.avatar': avatar, '.edit': edit },
  })
  const steps = api.buildDriverSteps({
    steps: [
      { selector: 'S1', target: '.edit', open: '.avatar', title: 'Edit' },
      { selector: 'S2', target: '', open: '', title: 'Next' },
    ],
  })

  steps[0].onHighlightStarted()
  steps[1].onHighlightStarted()
  assert.deepEqual(avatar.dispatched, ['mousedown', 'mouseup', 'click'])
})

test('onHighlightStarted does not re-open when the target is already visible', () => {
  const avatar = discEl({ w: 37, h: 37 })
  const editVisible = discEl({ w: 155, h: 36 })
  const { api } = loadModule({
    cssTargets: { '.avatar': avatar, '.edit': editVisible },
  })
  const tour = {
    steps: [{ selector: 'S1', target: '.edit', open: '.avatar', title: 'Edit' }],
  }
  const step = api.buildDriverSteps(tour)[0]
  step.onHighlightStarted()
  assert.deepEqual(avatar.dispatched, [])
})

test('startTour returns null when responsive filtering removes every step', async () => {
  let factoryCalls = 0
  const driver = {
    js: {
      driver() {
        factoryCalls += 1
        return { drive() {} }
      },
    },
  }
  const { api } = loadModule({
    driver,
    cssTargets: { '.avatar': discEl({ w: 0, h: 0 }) },
  })
  const tour = {
    id: 'mobile-hidden',
    steps: [{ selector: 'S1', target: '', open: '.avatar' }],
  }
  assert.equal(await api.startTour(tour), null)
  assert.equal(factoryCalls, 0)
  assert.equal(await api.startTour(tour), null)
})

test('boot does not mark seen when disclosure filtering removes every step', async () => {
  const calls = []
  const { api, run } = loadModule({
    memberstack: {
      getCurrentMember: async () => ({ data: null }),
    },
    driver: {
      js: {
        driver() {
          calls.push('created')
          return {
            drive() {
              calls.push('started')
            },
          }
        },
      },
    },
    localStorage: {
      getItem() {
        return null
      },
      setItem() {
        calls.push('marked')
      },
    },
    nodes: [
      fakeElement({
        'data-tour-step': 'welcome:1',
        'data-tour-open': '.avatar',
      }),
    ],
    cssTargets: { '.avatar': discEl({ w: 0, h: 0 }) },
  })
  await run()
  assert.deepEqual(calls, [])
  assert.equal(
    await api.startTour({
      id: 'welcome',
      steps: [{ selector: 'S1', target: '', open: '.avatar' }],
    }),
    null,
  )
  assert.deepEqual(calls, [])
})
