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
    xanoAuthFetch: options.xanoAuthFetch,
    $memberstackDom: options.memberstack,
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
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => null,
    }),
  })
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
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ availability }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'flex')
  assert.equal(result.steps[0].style.display, 'block')
  assert.equal(result.steps[1].style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'update')
  assert.equal(result.events[0].detail.source, 'starter')
})

test('keeps actions hidden when the page scheduling reader is missing', async () => {
  const result = loadInitializer()
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.events[0].type, 'starterSchedulingAvailabilityError')
})

test('uses the authenticated legacy reader without calling the broken page helper', async () => {
  let request
  let pageReaderCalls = 0
  const result = loadInitializer({
    xanoAuthFetch: async (url, init) => {
      request = { url, init }
      return { ok: true, status: 200, json: async () => null }
    },
    getStarterByMemberId: async () => {
      pageReaderCalls += 1
      return null
    },
  })
  await settle()

  assert.match(request.url, /\/api:tCpV3oqd\/starter\/get_by_memberstack$/)
  assert.equal(request.init.method, 'POST')
  assert.deepEqual(JSON.parse(request.init.body), { member_id: 'member-a' })
  assert.equal(pageReaderCalls, 0)
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'init')
})

test('rejects a member switch while scheduling availability is loading', async () => {
  let activeMember = { id: 'member-a' }
  let resolveStarter
  const starter = new Promise((resolve) => {
    resolveStarter = resolve
  })
  const result = loadInitializer({
    memberstack: {
      getCurrentMember: async () => ({ data: activeMember }),
    },
    getStarterByMemberId: async () => starter,
  })
  await settle()

  activeMember = { id: 'member-b' }
  resolveStarter({ availability: { items: { general: {} }, manager: 'platform' } })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.window.STARTER_AVAILABILITY, null)
})

test('rejects logout while scheduling availability is loading', async () => {
  let activeMember = { id: 'member-a' }
  let resolveStarter
  const starter = new Promise((resolve) => {
    resolveStarter = resolve
  })
  const result = loadInitializer({
    memberstack: {
      getCurrentMember: async () => ({ data: activeMember }),
    },
    getStarterByMemberId: async () => starter,
  })
  await settle()

  activeMember = null
  resolveStarter({ availability: { items: { general: {} }, manager: 'platform' } })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.window.STARTER_AVAILABILITY, null)
})

test('uses member-scoped cached availability before the legacy endpoint', async () => {
  let calls = 0
  const availability = { items: { general: {} }, manager: 'platform' }
  const result = loadInitializer({
    storage: {
      'starter-scheduling-availability:member-a': JSON.stringify({
        cachedAt: Date.now(),
        availability,
      }),
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

test('revalidates expired member-scoped availability', async () => {
  let calls = 0
  const result = loadInitializer({
    storage: {
      'starter-scheduling-availability:member-a': JSON.stringify({
        cachedAt: Date.now() - 6 * 60 * 1000,
        availability: { items: { stale: {} }, manager: 'platform' },
      }),
    },
    getStarterByMemberId: async () => {
      calls += 1
      return null
    },
  })
  await settle()

  assert.equal(calls, 1)
  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.events[0].detail.source, 'default')
})

test('read failures keep availability actions hidden in an error state', async () => {
  const result = loadInitializer({
    storage: { 'starter-scheduling-availability:member-a': 'not-json' },
    getStarterByMemberId: async () => {
      throw new Error('read failed')
    },
  })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.steps[0].style.display, 'none')
  assert.equal(result.steps[1].style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.events[0].type, 'starterSchedulingAvailabilityError')
  assert.equal(result.window.STARTER_AVAILABILITY, null)
})

test('rejects malformed saved availability instead of treating it as absent', async () => {
  const result = loadInitializer({
    getStarterByMemberId: async () => ({ availability: { items: [] } }),
  })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
})

test('marks pages without availability controls as not applicable', async () => {
  const result = loadInitializer({ withoutControls: true })
  await settle()

  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'not-applicable')
})
