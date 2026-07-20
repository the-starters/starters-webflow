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
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      search: options.search || '',
    },
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

  const warnings = []
  vm.runInNewContext(source, {
    CustomEvent,
    URLSearchParams,
    console: {
      warn(...args) {
        warnings.push(args.join(' '))
      },
    },
    document,
    window,
  })

  return { attributes, events, init, steps, storage, update, warnings, window }
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

test('rejects a 404 instead of treating it as confirmed first-time setup', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ message: 'not found' }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
})

test('rejects a legacy starter response without availability', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 123 }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
})

test('rejects null availability on an existing legacy starter', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ availability: null }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'none')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
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

const ALLOWED_TEST_MEMBER = 'mem_sb_cmqhuaxn80d270sseeo74fn7i'

test('reads an allowlisted test member on the Webflow staging hostname', async () => {
  const calls = []
  const availability = { items: { general: {} }, manager: 'platform' }
  const result = loadInitializer({
    search: `?test_member_id=${ALLOWED_TEST_MEMBER}`,
    xanoAuthFetch: async (url, init) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => ({ availability }) }
    },
  })
  await settle()

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/api:tCpV3oqd\/starter\/get_by_memberstack$/)
  assert.deepEqual(JSON.parse(calls[0].init.body), { member_id: ALLOWED_TEST_MEMBER })
  assert.equal(result.update.style.display, 'flex')
  assert.equal(result.events[0].type, 'starterSchedulingAvailabilityReady')
  assert.equal(result.events[0].detail.source, 'query-test')
  assert.equal(result.events[0].detail.memberId, ALLOWED_TEST_MEMBER)
  assert.equal(result.attributes.get('data-scheduling-test-member'), 'true')
})

test('fails closed when an override cannot use the authenticated reader', async () => {
  let fallbackCalls = 0
  const result = loadInitializer({
    search: `?test_member_id=${ALLOWED_TEST_MEMBER}`,
    getStarterByMemberId: async () => {
      fallbackCalls += 1
      return { availability: { items: { qa: {} }, manager: null } }
    },
  })
  await settle()

  assert.equal(fallbackCalls, 0)
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.attributes.has('data-scheduling-test-member'), false)
  assert.equal(result.events[0].type, 'starterSchedulingAvailabilityError')
})

test('missing test_member_id keeps the authenticated-member behavior', async () => {
  let request
  const result = loadInitializer({
    xanoAuthFetch: async (url, init) => {
      request = { url, init }
      return { ok: true, status: 200, json: async () => null }
    },
  })
  await settle()

  assert.deepEqual(JSON.parse(request.init.body), { member_id: 'member-a' })
  assert.equal(result.events[0].detail.memberId, 'member-a')
  assert.equal(result.events[0].detail.source, 'default')
  assert.equal(result.attributes.has('data-scheduling-test-member'), false)
})

test('ignores an invalid test_member_id with a warning and no echoed value', async () => {
  let request
  const result = loadInitializer({
    search: '?test_member_id=<script>alert(1)</script>',
    xanoAuthFetch: async (url, init) => {
      request = { url, init }
      return { ok: true, status: 200, json: async () => null }
    },
  })
  await settle()

  assert.deepEqual(JSON.parse(request.init.body), { member_id: 'member-a' })
  assert.equal(result.attributes.has('data-scheduling-test-member'), false)
  const warning = result.warnings.find((entry) => entry.includes('test_member_id'))
  assert.ok(warning, 'expected a concise ignore warning')
  assert.ok(!warning.includes('alert'), 'warning must not echo the supplied value')
})

test('ignores a well-formed but non-allowlisted test_member_id', async () => {
  let request
  const result = loadInitializer({
    search: '?test_member_id=mem_sb_zzzzzzzzzzzzzzzzzzzzzzzzz',
    xanoAuthFetch: async (url, init) => {
      request = { url, init }
      return { ok: true, status: 200, json: async () => null }
    },
  })
  await settle()

  assert.deepEqual(JSON.parse(request.init.body), { member_id: 'member-a' })
  assert.equal(result.attributes.has('data-scheduling-test-member'), false)
  assert.ok(result.warnings.some((entry) => entry.includes('test_member_id')))
})

test('test_member_id is inert on both custom production domains', () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const result = loadInitializer({
      hostname,
      search: `?test_member_id=${ALLOWED_TEST_MEMBER}`,
    })
    assert.equal(result.window.StarterSchedulingAvailability, undefined)
    assert.deepEqual(result.init.style, {})
    assert.equal(result.attributes.has('data-scheduling-test-member'), false)
  }
})

test('never reuses the authenticated member cache for an override read', async () => {
  const calls = []
  const result = loadInitializer({
    search: `?test_member_id=${ALLOWED_TEST_MEMBER}`,
    storage: {
      'starter-scheduling-availability:member-a': JSON.stringify({
        cachedAt: Date.now(),
        availability: { items: { general: {} }, manager: 'platform' },
      }),
    },
    xanoAuthFetch: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ availability: { items: { qa: {} }, manager: null } }),
      }
    },
  })
  await settle()

  assert.equal(calls.length, 1, 'override must bypass the authenticated member cache')
  assert.deepEqual(JSON.parse(calls[0].init.body), { member_id: ALLOWED_TEST_MEMBER })
  const overrideCache = JSON.parse(
    result.storage.get(`starter-scheduling-availability:${ALLOWED_TEST_MEMBER}`),
  )
  assert.deepEqual(overrideCache.availability.items, { qa: {} })
  const authenticatedCache = JSON.parse(
    result.storage.get('starter-scheduling-availability:member-a'),
  )
  assert.deepEqual(authenticatedCache.availability.items, { general: {} })
})

test('an override read issues only the legacy read call — no write payloads', async () => {
  const calls = []
  loadInitializer({
    search: `?test_member_id=${ALLOWED_TEST_MEMBER}`,
    xanoAuthFetch: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ availability: { items: { qa: {} }, manager: null } }),
      }
    },
  })
  await settle()

  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/api:tCpV3oqd\/starter\/get_by_memberstack$/)
  for (const call of calls) {
    assert.ok(
      /\/starter\/get_by_memberstack$/.test(call.url),
      'overridden ID must never reach a non-read endpoint',
    )
  }
})
