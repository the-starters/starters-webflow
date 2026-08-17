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
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
  }
}

function nativeModal() {
  const listeners = new Map()
  return {
    attributes: { 'data-modal-target': 'set-availability' },
    open: false,
    showModalCalls: 0,
    closeCalls: 0,
    addEventListener(name, listener) {
      listeners.set(name, listener)
    },
    close() {
      this.closeCalls += 1
      this.open = false
    },
    dispatch(name, event = {}) {
      const listener = listeners.get(name)
      if (listener) listener(event)
    },
    getAttribute(name) {
      return this.attributes[name] ?? null
    },
    removeAttribute(name) {
      delete this.attributes[name]
      if (name === 'open') this.open = false
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
      if (name === 'open') this.open = true
    },
    showModal() {
      this.showModalCalls += 1
      this.open = true
    },
  }
}

function loadInitializer(options = {}) {
  const init = control({ 'init-availability': '' })
  const update = control({ 'update-availability': '' })
  const connectionAction = control({ 'calendar-connection-action': '' })
  // Production still uses the documented legacy class fallback for this row.
  const connectionItem = control({ class: 'dash-hero_action-item' })
  connectionItem.hidden = false
  connectionAction.closest = (selector) =>
    selector === '[data-action-element="item"], .dash-hero_action-item'
      ? connectionItem
      : null
  const steps = ['default', 'setup-form', 'how-to-manage', 'config-request-error'].map((name) =>
    control({ 'availability-step': name }),
  )
  const attributes = new Map()
  const storage = new Map(Object.entries(options.storage || {}))
  const events = []
  const document = {
    body: { style: {} },
    readyState: 'complete',
    documentElement: {
      setAttribute(name, value) {
        attributes.set(name, value)
      },
    },
    querySelector(selector) {
      if (selector === '[init-availability]') return init
      if (selector === '[update-availability]') return update
      if (selector === '[calendar-connection-action]') return connectionAction
      if (selector === 'dialog[data-modal-target="set-availability"]') {
        return options.modal || null
      }
      if (
        selector ===
        '[init-availability], [update-availability], [calendar-connection-action]'
      ) {
        return options.withoutControls ? null : init
      }
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[availability-step]') return steps
      if (selector === '[init-availability]') return options.withoutControls ? [] : [init]
      if (selector === '[update-availability]') return options.withoutControls ? [] : [update]
      if (selector === '[calendar-connection-action]') {
        return options.withoutControls ? [] : [connectionAction]
      }
      if (selector === '[init-availability], [update-availability]') {
        return options.withoutControls ? [] : [init, update]
      }
      return []
    },
    addEventListener() {},
  }
  if (options.withoutControls) {
    document.querySelector = () => null
  }

  const member = options.member || { id: 'member-a', customFields: {} }
  const windowListeners = new Map()
  const window = {
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      pathname: options.pathname || '/starter-dashboard---availability-stage',
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
    lumos: options.lumos,
    addEventListener(name, listener) {
      if (!windowListeners.has(name)) windowListeners.set(name, [])
      windowListeners.get(name).push(listener)
    },
    dispatchEvent(event) {
      events.push(event)
      for (const listener of windowListeners.get(event.type) || []) listener(event)
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

  return {
    attributes,
    connectionAction,
    connectionItem,
    events,
    init,
    steps,
    storage,
    update,
    warnings,
    window,
  }
}

async function settle() {
  await new Promise(setImmediate)
}

test('Calendar controls fall back to the native dialog when the shared modal engine is absent', async () => {
  const modal = nativeModal()
  const result = loadInitializer({
    modal,
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => null,
    }),
  })
  await settle()

  result.connectionAction.click()
  await settle()

  assert.equal(modal.open, true)
  assert.equal(modal.showModalCalls, 1)
  assert.equal(
    result.steps.find((step) => step.getAttribute('availability-step') === 'setup-form').style
      .display,
    'block',
  )

  let cancelPrevented = false
  modal.dispatch('cancel', {
    preventDefault() {
      cancelPrevented = true
    },
  })
  assert.equal(cancelPrevented, true)
  assert.equal(modal.open, false)

  result.connectionAction.click()
  await settle()
  modal.dispatch('click', {
    target: {
      closest(selector) {
        return selector === '[data-modal-close]' ? {} : null
      },
    },
  })
  assert.equal(modal.open, false)
  assert.equal(modal.closeCalls, 2)
})

test('Calendar controls prefer the shared modal registry and do not double-open the dialog', async () => {
  const modal = nativeModal()
  let registryOpenCalls = 0
  const result = loadInitializer({
    modal,
    lumos: {
      modal: {
        open(id) {
          registryOpenCalls += 1
          assert.equal(id, 'set-availability')
          modal.open = true
        },
      },
    },
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => null,
    }),
  })
  await settle()

  result.init.click()
  await settle()

  assert.equal(registryOpenCalls, 1)
  assert.equal(modal.open, true)
  assert.equal(modal.showModalCalls, 0)
})

test('does not install on an unapproved production path', () => {
  const result = loadInitializer({
    hostname: 'www.thestarters.com',
    pathname: '/brand-dashboard',
  })
  assert.equal(result.window.StarterSchedulingAvailability, undefined)
  assert.deepEqual(result.init.style, {})
})

test('installs on the canonical Starter dashboard across both production hosts', () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const result = loadInitializer({ hostname, pathname: '/starter-dashboard' })
    assert.equal(typeof result.window.StarterSchedulingAvailability.initialize, 'function')
  }
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

test('shows Connect Calendar for the empty endpoint 1583 V3 projection', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability: [],
        timezone: '',
        nylas_grant_id: '',
        nylas_grant_email: '',
        nylas_calendar_id: '',
      }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'init')
  assert.equal(result.events[0].detail.source, 'default')
})

test('shows Connect Calendar after timezone bootstrap creates an empty availability row', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability: {},
        timezone: 'Asia/Manila',
        nylas_grant_id: '',
        nylas_grant_email: '',
        nylas_calendar_id: '',
      }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'init')
  assert.equal(result.events[0].detail.source, 'default')
})

test('rejects an empty availability array when grant data already exists', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability: [],
        nylas_grant_id: 'grant-existing',
        nylas_calendar_id: 'calendar-existing',
      }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
})

test('rejects an empty availability object when grant data already exists', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability: {},
        nylas_grant_id: 'grant-existing',
        nylas_calendar_id: 'calendar-existing',
      }),
    }),
  })
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
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
  assert.equal(result.attributes.get('data-scheduling-calendar-state'), 'reconnect')
  assert.equal(result.connectionAction.style.display, 'flex')
  result.update.click()
  assert.equal(result.steps[2].style.display, 'block')
  assert.equal(result.events[0].detail.source, 'starter')
})

test('keeps the Calendar action usable while canonical connection state is loading', () => {
  const result = loadInitializer({
    xanoAuthFetch: () => new Promise(() => {}),
  })

  assert.equal(result.attributes.get('data-scheduling-calendar-state'), 'loading')
  assert.equal(result.connectionAction.style.display, 'flex')
  assert.equal(result.connectionItem.hidden, false)
  assert.equal(result.connectionItem.style.display, '')
  assert.equal(result.connectionAction.getAttribute('aria-busy'), 'true')
  result.connectionAction.click()
  assert.equal(result.steps[1].style.display, 'block')
})

test('removes the Calendar Action Item once the canonical connection is ready', async () => {
  const availability = {
    items: { general: { days: [1], start: '09:00', end: '18:00' } },
    manager: 'calendar',
  }
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability,
        nylas_grant_id: 'grant-existing',
        nylas_calendar_id: 'calendar-existing',
      }),
    }),
  })
  await settle()

  assert.equal(result.attributes.get('data-scheduling-calendar-state'), 'loading')
  result.window.dispatchEvent({
    type: 'starterSchedulingConnectionStateChanged',
    detail: {
      state: 'connected',
      hasGrant: true,
      hasCalendar: true,
      configurationCount: 1,
      manager: 'calendar',
    },
  })

  assert.equal(result.attributes.get('data-scheduling-calendar-state'), 'connected')
  assert.equal(result.connectionAction.style.display, 'none')
  assert.equal(result.connectionItem.hidden, true)
  assert.equal(result.connectionItem.style.display, 'none')
  result.update.click()
  assert.equal(result.steps[0].style.display, 'block')
})

test('removes the Calendar Action Item when Nylas availability exists without a Google connection', async () => {
  const availability = {
    items: { general: { days: [1], start: '09:00', end: '18:00' } },
    manager: 'platform',
  }
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability,
        nylas_grant_id: '',
        nylas_calendar_id: '',
      }),
    }),
  })
  await settle()

  result.window.dispatchEvent({
    type: 'starterSchedulingConnectionStateChanged',
    detail: {
      state: 'reconnect',
      hasGrant: false,
      hasCalendar: false,
      configurationCount: 1,
      manager: 'platform',
    },
  })

  assert.equal(result.connectionAction.style.display, 'none')
  assert.equal(result.connectionItem.hidden, true)
  assert.equal(result.connectionItem.style.display, 'none')
})

test('keeps the Calendar Action Item until Nylas availability exists', async () => {
  const availability = {
    items: { general: { days: [1], start: '09:00', end: '18:00' } },
    manager: 'calendar',
  }
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability,
        nylas_grant_id: 'grant-existing',
        nylas_calendar_id: 'calendar-existing',
      }),
    }),
  })
  await settle()

  result.window.dispatchEvent({
    type: 'starterSchedulingConnectionStateChanged',
    detail: {
      state: 'connected',
      hasGrant: true,
      hasCalendar: true,
      configurationCount: 0,
      manager: 'calendar',
    },
  })

  assert.equal(result.connectionAction.style.display, 'flex')
  assert.equal(result.connectionItem.hidden, false)
  assert.equal(result.connectionItem.style.display, '')
})

test('reinitializing retains the last canonical Nylas configuration count', async () => {
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability: { items: {}, manager: 'calendar' },
        nylas_grant_id: 'grant-existing',
        nylas_calendar_id: 'calendar-existing',
      }),
    }),
  })
  await settle()

  result.window.dispatchEvent({
    type: 'starterSchedulingConnectionStateChanged',
    detail: { state: 'connected', configurationCount: 1 },
  })
  assert.equal(result.connectionItem.hidden, true)

  await result.window.StarterSchedulingAvailability.initialize()

  assert.equal(result.connectionAction.style.display, 'none')
  assert.equal(result.connectionItem.hidden, true)
  assert.equal(result.connectionItem.style.display, 'none')
  assert.equal(
    result.window.STARTER_SCHEDULING_CONNECTION.configurationCount,
    1,
  )
})

test('renders partial provider state as reconnect and keeps the CTA actionable', async () => {
  const availability = {
    items: { general: { days: [1], start: '09:00', end: '18:00' } },
    manager: 'calendar',
  }
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability,
        nylas_grant_id: 'grant-existing',
        nylas_calendar_id: '',
      }),
    }),
  })
  await settle()

  assert.equal(result.attributes.get('data-scheduling-calendar-state'), 'reconnect')
  assert.equal(result.connectionAction.style.display, 'flex')
  assert.equal(result.connectionItem.hidden, false)
  assert.equal(result.connectionItem.style.display, '')
  result.connectionAction.click()
  assert.equal(result.steps[2].style.display, 'block')
})

test('restores the Calendar Action Item when a connected provider needs reconnect', async () => {
  const availability = {
    items: { general: { days: [1], start: '09:00', end: '18:00' } },
    manager: 'calendar',
  }
  const result = loadInitializer({
    xanoAuthFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        availability,
        nylas_grant_id: 'grant-existing',
        nylas_calendar_id: 'calendar-existing',
      }),
    }),
  })
  await settle()

  result.window.dispatchEvent({
    type: 'starterSchedulingConnectionStateChanged',
    detail: { state: 'connected', configurationCount: 1 },
  })
  assert.equal(result.connectionItem.hidden, true)

  result.window.dispatchEvent({
    type: 'starterSchedulingConnectionStateChanged',
    detail: { state: 'reconnect', configurationCount: 0 },
  })
  assert.equal(result.connectionAction.style.display, 'flex')
  assert.equal(result.connectionItem.hidden, false)
  assert.equal(result.connectionItem.style.display, '')
  result.connectionAction.click()
  assert.equal(result.steps[2].style.display, 'block')
})

test('keeps the hero action available when the page scheduling reader is missing', async () => {
  const result = loadInitializer()
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.events[0].type, 'starterSchedulingAvailabilityError')
})

test('rejects the legacy page reader when authenticated fetch is unavailable', async () => {
  let pageReaderCalls = 0
  const result = loadInitializer({
    getStarterByMemberId: async () => {
      pageReaderCalls += 1
      return { availability: { items: {}, manager: null } }
    },
  })
  await settle()

  assert.equal(pageReaderCalls, 0)
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.attributes.get('data-scheduling-calendar-state'), 'error')
  result.init.click()
  assert.equal(result.steps[3].style.display, 'block')
})

test('uses the authenticated V3 reader without calling the broken page helper', async () => {
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

  assert.match(request.url, /\/api:tCpV3oqd\/starter\/get_by_memberstack\/v3$/)
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

  assert.equal(result.init.style.display, 'flex')
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

  assert.equal(result.init.style.display, 'flex')
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

  assert.equal(result.init.style.display, 'flex')
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

  assert.equal(result.init.style.display, 'flex')
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

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.window.STARTER_AVAILABILITY, null)
})

test('revalidates canonical state instead of trusting a fresh availability cache', async () => {
  let calls = 0
  const availability = { items: { general: {} }, manager: 'platform' }
  const result = loadInitializer({
    storage: {
      'starter-scheduling-availability:member-a': JSON.stringify({
        cachedAt: Date.now(),
        availability,
      }),
    },
    xanoAuthFetch: async () => {
      calls += 1
      return { ok: true, status: 200, json: async () => ({ availability }) }
    },
  })
  await settle()

  assert.equal(calls, 1)
  assert.equal(result.update.style.display, 'flex')
  assert.equal(result.events[0].detail.source, 'starter')
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
    xanoAuthFetch: async () => {
      calls += 1
      return { ok: true, status: 200, json: async () => null }
    },
  })
  await settle()

  assert.equal(calls, 1)
  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.events[0].detail.source, 'default')
})

test('read failures keep hero and Action Items entries available in error state', async () => {
  const result = loadInitializer({
    storage: { 'starter-scheduling-availability:member-a': 'not-json' },
    getStarterByMemberId: async () => {
      throw new Error('read failed')
    },
  })
  await settle()

  assert.equal(result.init.style.display, 'flex')
  assert.equal(result.update.style.display, 'none')
  assert.equal(result.steps[0].style.display, 'none')
  assert.equal(result.steps[1].style.display, 'none')
  assert.equal(result.attributes.get('data-scheduling-availability-init'), 'error')
  assert.equal(result.events[0].type, 'starterSchedulingAvailabilityError')
  assert.equal(result.window.STARTER_AVAILABILITY, null)
  assert.equal(result.attributes.get('data-scheduling-calendar-state'), 'error')
  assert.equal(result.connectionAction.style.display, 'flex')
  result.init.click()
  assert.equal(result.steps[3].style.display, 'block')
  result.steps[0].style.display = 'block'
  result.steps[3].style.display = 'none'
  result.connectionAction.click()
  assert.equal(result.steps[0].style.display, 'none')
  assert.equal(result.steps[3].style.display, 'block')
})

test('rejects malformed saved availability instead of treating it as absent', async () => {
  const result = loadInitializer({
    getStarterByMemberId: async () => ({ availability: { items: [] } }),
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
  assert.match(calls[0].url, /\/api:tCpV3oqd\/starter\/get_by_memberstack\/v3$/)
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

test('test_member_id is inert on the canonical dashboard across both custom production domains', () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const result = loadInitializer({
      hostname,
      pathname: '/starter-dashboard',
      search: `?test_member_id=${ALLOWED_TEST_MEMBER}`,
    })
    assert.equal(typeof result.window.StarterSchedulingAvailability.initialize, 'function')
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

test('an override read issues only the V3 read call, with no write payloads', async () => {
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
  assert.match(calls[0].url, /\/api:tCpV3oqd\/starter\/get_by_memberstack\/v3$/)
  for (const call of calls) {
    assert.ok(
      /\/starter\/get_by_memberstack\/v3$/.test(call.url),
      'overridden ID must never reach a non-read endpoint',
    )
  }
})
