const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./paid-call-settings.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

class El {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase()
    this.attributes = {}
    this.style = {}
    this.value = ''
    this.checked = false
    this.disabled = false
    this.textContent = ''
    this.listeners = new Map()
    this.children = []
    Object.entries(attrs).forEach(([name, value]) => this.setAttribute(name, value))
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  matches(selector) { return selector.split(',').some((part) => part.trim().toUpperCase() === this.tagName) }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }
  async dispatch(name) {
    const event = { type: name, preventDefault() {} }
    await Promise.all((this.listeners.get(name) || []).map((listener) => listener(event)))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector) {
    return this.children.filter((child) => {
      const match = selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/)
      if (!match) return selector.split(',').some((part) => part.trim().toUpperCase() === child.tagName)
      return child.getAttribute(match[1]) !== null && (!match[2] || child.getAttribute(match[1]) === match[2])
    })
  }
}

function canonical(overrides = {}) {
  return {
    stripe_environment: 'live',
    readiness: {
      calendar_connected: true,
      availability_configured: true,
      stripe_connect_linked: true,
      stripe_charges_enabled: true,
      stripe_readiness_fresh: true,
      paid_call_enabled: false,
      bookable: false,
      ...(overrides.readiness || {}),
    },
    services: overrides.services || [],
  }
}

function service(overrides = {}) {
  return {
    config_id: 'cfg-paid-1',
    title: 'Paid Consultation Call',
    price_cents: 35000,
    currency: 'usd',
    duration: 60,
    active: true,
    revision: 4,
    payment_environment: 'live',
    ...overrides,
  }
}

function buildDom(withRoot = true) {
  const root = withRoot ? new El('section', { 'data-paid-call-element': 'settings' }) : null
  if (!root) return { root: null }
  const form = new El('form', { 'data-paid-call-element': 'form' })
  const enabled = new El('input', { 'data-paid-call-input': 'enabled' })
  const title = new El('input', { 'data-paid-call-input': 'title' })
  const price = new El('input', { 'data-paid-call-input': 'price' })
  const duration = new El('select', { 'data-paid-call-input': 'duration' })
  const save = new El('button', { 'data-paid-call-action': 'save' })
  const disable = new El('button', { 'data-paid-call-action': 'disable' })
  const status = new El('p', { 'data-paid-call-element': 'status' })
  const prerequisites = ['calendar', 'availability', 'stripe', 'charges', 'fresh', 'bookable']
    .map((name) => new El('div', { 'data-paid-call-prerequisite': name }))
  root.children.push(form, enabled, title, price, duration, save, disable, status, ...prerequisites)
  return { root, form, enabled, title, price, duration, save, disable, status, prerequisites }
}

function load(options = {}) {
  const dom = buildDom(options.withRoot !== false)
  const html = new El('html')
  const calls = []
  const events = []
  const windowListeners = new Map()
  const timers = []
  const warnings = []
  let state = options.initial || canonical()
  let activeMember = { id: options.memberId || 'member-a' }
  let authChange = null
  const routes = options.routes || {}

  const document = {
    readyState: 'complete',
    documentElement: html,
    querySelector(selector) {
      if (selector === '[data-paid-call-element="settings"]') return dom.root
      return null
    },
    querySelectorAll() { return [] },
    addEventListener() {},
  }

  const memberstack = {
    getCurrentMember: async () => ({ data: activeMember }),
    onAuthChange(listener) { authChange = listener },
  }
  const window = {
    location: { hostname: options.hostname || 'thestarters.com' },
    crypto: { randomUUID: () => 'uuid-fixed' },
    memberReady: options.memberReady,
    setTimeout(callback, delay) { timers.push({ callback, delay }) },
    addEventListener(name, listener) {
      const listeners = windowListeners.get(name) || []
      listeners.push(listener)
      windowListeners.set(name, listeners)
    },
    dispatchEvent(event) { events.push(event) },
    xanoAuthFetch: async (url, init) => {
      const path = url.replace(API_BASE, '')
      const method = init.method
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ path, method, body })
      if (routes[path]) {
        return routes[path]({
          method,
          body,
          member: activeMember,
          state,
          setState: (next) => { state = next },
        })
      }
      if (path === '/starter/paid-call-settings/get/v3') {
        return { ok: true, status: 200, json: async () => state }
      }
      throw new Error('unrouted request ' + path)
    },
  }
  if (!options.withoutMemberstackAtLoad) window.$memberstackDom = memberstack

  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail }
  }

  vm.runInNewContext(SOURCE, {
    CustomEvent,
    Date,
    Math,
    console: { warn: (...args) => warnings.push(args.join(' ')) },
    document,
    window,
  })

  return {
    dom,
    calls,
    events,
    timers,
    warnings,
    window,
    document,
    changeMember: async (nextMember) => {
      activeMember = nextMember
      if (authChange) return authChange(nextMember)
      return null
    },
    installMemberstack: () => { window.$memberstackDom = memberstack },
    flushTimers: () => {
      const pending = timers.splice(0)
      pending.forEach((timer) => timer.callback())
    },
    getState: () => state,
    dispatchWindow: async (name, detail) => {
      const event = { type: name, detail }
      await Promise.all((windowListeners.get(name) || []).map((listener) => listener(event)))
    },
  }
}

async function settle(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) await new Promise(setImmediate)
}

test('is inert when the native Webflow settings form is absent', async () => {
  const result = load({ withRoot: false })
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'not-applicable')
  assert.equal(result.calls.length, 0)
})

test('renders the active service and prerequisite state from canonical GET', async () => {
  const active = service()
  const result = load({ initial: canonical({
    services: [active],
    readiness: { paid_call_enabled: true, bookable: true },
  }) })
  await settle()

  assert.deepEqual(result.calls.map(({ path, method }) => ({ path, method })), [
    { path: '/starter/paid-call-settings/get/v3', method: 'GET' },
  ])
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.dom.title.value, active.title)
  assert.equal(result.dom.price.value, 350)
  assert.equal(result.dom.duration.value, '60')
  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'true')
  assert.ok(result.dom.prerequisites.every((item) => item.getAttribute('data-ready') === 'true'))
})

test('upsert sends product intent and revision, then trusts canonical readback', async () => {
  const initial = canonical()
  const savedService = service({ price_cents: 50000, revision: 1 })
  const result = load({
    initial,
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        setState(canonical({
          services: [savedService],
          readiness: { paid_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: savedService }) }
      },
    },
  })
  await settle()
  result.dom.enabled.checked = true
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '500'
  result.dom.duration.value = '60'

  await result.window.StarterPaidCallSettings.save()

  const upsert = result.calls.find((call) => call.path === '/starter/paid-call-settings/upsert/v3')
  assert.deepEqual(upsert.body, {
    config_id: null,
    title: 'Paid Consultation Call',
    price_cents: 50000,
    duration_minutes: 60,
    expected_revision: 0,
    idempotency_key: 'paid-call-upsert:uuid-fixed',
  })
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 2)
  assert.equal(result.dom.price.value, 500)
  assert.equal(result.dom.status.textContent, 'Paid calls are on and bookable.')
})

test('canonical readback does not report bookable when readiness changed during save', async () => {
  const savedService = service({ price_cents: 50000, revision: 1 })
  const result = load({
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ setState }) => {
        setState(canonical({
          services: [savedService],
          readiness: { paid_call_enabled: true, bookable: false },
        }))
        return { ok: true, status: 200, json: async () => ({ service: savedService }) }
      },
    },
  })
  await settle()
  result.dom.enabled.checked = true
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '500'
  result.dom.duration.value = '60'

  await result.window.StarterPaidCallSettings.save()

  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'false')
  assert.equal(result.dom.status.textContent, 'Paid calls are saved, but a prerequisite needs attention.')
})

test('readiness events refresh canonical settings without a reload', async () => {
  const result = load({ initial: canonical({ readiness: { calendar_connected: false } }) })
  await settle()
  assert.equal(result.dom.save.disabled, true)

  result.getState().readiness.calendar_connected = true
  await result.dispatchWindow('starterSchedulingConnectionStateChanged', { state: 'connected' })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 2)
  assert.equal(result.dom.save.disabled, false)
})

test('a newer readiness read cannot be overwritten by initial canonical state', async () => {
  const initialRead = deferred()
  const readinessRead = deferred()
  let reads = 0
  const result = load({
    routes: {
      '/starter/paid-call-settings/get/v3': () => {
        reads += 1
        const pending = reads === 1 ? initialRead : readinessRead
        return pending.promise.then((value) => ({ ok: true, status: 200, json: async () => value }))
      },
    },
  })
  await settle(2)

  const refresh = result.dispatchWindow('starterSchedulingConnectionStateChanged', { state: 'connected' })
  await settle(2)
  readinessRead.resolve(canonical())
  await refresh
  initialRead.resolve(canonical({ readiness: { calendar_connected: false } }))
  await settle()

  assert.equal(result.dom.save.disabled, false)
  assert.equal(result.dom.status.textContent, 'Paid calls are off. Add a rate to turn them on.')
})

test('auth changes clear prior settings and load the next member canonically', async () => {
  const memberBRead = deferred()
  const result = load({
    routes: {
      '/starter/paid-call-settings/get/v3': ({ member }) => {
        const value = member && member.id === 'member-a'
          ? canonical({ services: [service({ title: 'Member A Call', price_cents: 12500 })] })
          : memberBRead.promise
        return Promise.resolve(value).then((canonicalValue) => ({
          ok: true,
          status: 200,
          json: async () => canonicalValue,
        }))
      },
    },
  })
  await settle()
  assert.equal(result.dom.title.value, 'Member A Call')
  assert.equal(result.dom.price.value, 125)

  const memberBLoad = result.changeMember({ id: 'member-b' })
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)

  memberBRead.resolve(canonical({
    services: [service({ config_id: 'cfg-paid-b', title: 'Member B Call', price_cents: 45000 })],
  }))
  await memberBLoad
  assert.equal(result.dom.title.value, 'Member B Call')
  assert.equal(result.dom.price.value, 450)

  await result.changeMember(null)
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)
})

test('late Memberstack arrival still wires auth changes', async () => {
  const memberReady = deferred()
  const result = load({
    initial: canonical({ services: [service({ title: 'Member A Call' })] }),
    memberReady: memberReady.promise,
    withoutMemberstackAtLoad: true,
  })
  await settle(2)
  assert.equal(result.timers.length, 1)

  result.installMemberstack()
  result.flushTimers()
  memberReady.resolve({ id: 'member-a' })
  await settle()
  assert.equal(result.dom.title.value, 'Member A Call')

  await result.changeMember(null)
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)
})

test('late Memberstack arrival starts the initial canonical read after memberReady resolves', async () => {
  const memberReady = deferred()
  const result = load({
    initial: canonical({ services: [service({ title: 'Member A Call' })] }),
    memberReady: memberReady.promise,
    withoutMemberstackAtLoad: true,
  })
  memberReady.resolve({ id: 'member-a' })
  await settle()

  assert.equal(result.calls.length, 0)
  assert.equal(result.timers.length, 1)

  result.installMemberstack()
  result.flushTimers()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 1)
  assert.equal(result.dom.title.value, 'Member A Call')
})

test('disable sends the canonical revision and verifies the service is inactive', async () => {
  const active = service({ revision: 7 })
  const result = load({
    initial: canonical({ services: [active], readiness: { paid_call_enabled: true, bookable: true } }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  await result.window.StarterPaidCallSettings.disable()

  const disable = result.calls.find((call) => call.path === '/starter/paid-call-settings/disable/v3')
  assert.deepEqual(disable.body, {
    config_id: 'cfg-paid-1',
    expected_revision: 7,
    idempotency_key: 'paid-call-disable:uuid-fixed',
  })
  assert.equal(result.dom.enabled.checked, false)
  assert.equal(result.dom.status.textContent, 'Paid calls are off.')
})

test('blocks enable when a canonical prerequisite is missing', async () => {
  const result = load({ initial: canonical({ readiness: { stripe_charges_enabled: false } }) })
  await settle()
  result.dom.enabled.checked = true
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '500'
  result.dom.duration.value = '60'

  const saved = await result.window.StarterPaidCallSettings.save()

  assert.equal(saved, null)
  assert.equal(result.calls.some((call) => call.path.includes('/upsert/')), false)
  assert.equal(result.dom.save.disabled, true)
})

test('fails closed when canonical state has duplicate active paid services', async () => {
  const result = load({ initial: canonical({ services: [service(), service({ config_id: 'cfg-paid-2' })] }) })
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'error')
  assert.match(result.dom.status.textContent, /unavailable/i)
})
