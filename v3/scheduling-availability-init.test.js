const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./scheduling-availability-init.js'), 'utf8')

function control(attributes = {}) {
  const listeners = new Map()
  return {
    attributes,
    style: {},
    addEventListener(name, listener) {
      listeners.set(name, listener)
    },
    click() {
      const listener = listeners.get('click')
      if (listener) listener()
    },
    getAttribute(name) {
      return this.attributes[name] ?? null
    },
  }
}

function loadInitializer(options = {}) {
  const init = control({ 'init-availability': '' })
  const update = control({ 'update-availability': '' })
  const steps = ['default', 'setup-form'].map((name) =>
    control({ 'availability-step': name }),
  )
  const attributes = new Map()
  const storage = new Map(Object.entries(options.storage || {}))
  const events = []
  const document = {
    readyState: 'complete',
    documentElement: {
      setAttribute(name, value) {
        attributes.set(name, value)
      },
    },
    querySelector(selector) {
      if (selector === '[init-availability]') return init
      if (selector === '[update-availability]') return update
      if (selector === '[init-availability], [update-availability]') {
        return options.withoutControls ? null : init
      }
      return null
    },
    querySelectorAll(selector) {
      return selector === '[availability-step]' ? steps : []
    },
    addEventListener() {},
  }
  if (options.withoutControls) {
    document.querySelector = () => null
  }

  const member = options.member || { id: 'member-a', customFields: {} }
  const window = {
    location: { hostname: options.hostname || 'the-starters-3-0.webflow.io' },
    memberReady: Promise.resolve(member),
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null
      },
      setItem(key, value) {
        storage.set(key, value)
      },
    },
    getStarterByMemberId: options.getStarterByMemberId,
    dispatchEvent(event) {
      events.push(event)
    },
  }

  class CustomEvent {
    constructor(name, init) {
      this.type = name
      this.detail = init && init.detail
    }
  }

  vm.runInNewContext(source, {
    CustomEvent,
    console: { warn() {} },
    document,
    window,
  })

  return { attributes, events, init, steps, storage, update, window }
}

async function settle() {
  await new Promise(setImmediate)
}

test('does not install outside V3 Webflow staging', () => {
  const result = loadInitializer({ hostname: 'www.thestarters.com' })
  assert.equal(result.window.StarterSchedulingAvailability, undefined)
  assert.deepEqual(result.init.style, {})
})

test('shows Connect Calendar for a new V3 starter without a legacy row', async () => {
  const result = loadInitializer({ getStarterByMemberId: async () => null })
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.steps[0].style.display, 'none')
  assert.equal(result.steps[1].style.display, 'block')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'init')
  assert.equal(result.events[0].detail.source, 'default')
})

test('shows Manage availability when the starter has saved availability', async () => {
  const availability = {
    items: { general: { days: [1, 2], start: '09:00', end: '18:00' } },
    manager: 'platform',
  }
  const result = loadInitializer({
    getStarterByMemberId: async () => ({ availability }),
  })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'flex')
  assert.equal(result.steps[0].style.display, 'block')
  assert.equal(result.steps[1].style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'update')
  assert.equal(result.events[0].detail.source, 'starter')
})

test('uses member-scoped cached availability before the legacy endpoint', async () => {
  let calls = 0
  const availability = { items: { general: {} }, manager: 'platform' }
  const result = loadInitializer({
    storage: {
      'starter-scheduling-availability:member-a': JSON.stringify(availability),
    },
    getStarterByMemberId: async () => {
      calls += 1
      return null
    },
  })
  await settle()

  assert.equal(calls, 0)
  assert.equal(result.update.style.display, 'flex')
  assert.equal(result.events[0].detail.source, 'cache')
})

test('invalid data and read failures fall back to a visible setup control', async () => {
  const result = loadInitializer({
    storage: { 'starter-scheduling-availability:member-a': 'not-json' },
    getStarterByMemberId: async () => {
      throw new Error('read failed')
    },
  })
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
})

test('marks pages without availability controls as not applicable', async () => {
  const result = loadInitializer({ withoutControls: true })
  await settle()

  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'not-applicable')
})
