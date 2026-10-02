const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const FREE_SOURCE = fs.readFileSync(require.resolve('./free-call-settings.js'), 'utf8')
const PAID_SOURCE = fs.readFileSync(require.resolve('./paid-call-settings.js'), 'utf8')
const PROFILE_LOADER_SOURCE = fs.readFileSync(
  require.resolve('./starter-edit-profile/canonical-profile-loader.js'),
  'utf8',
)
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

class El {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase()
    this.attributes = {}
    this.style = {}
    this.value = ''
    this.checked = false
    this.disabled = false
    this.hidden = false
    this.readOnly = false
    this.textContent = ''
    this.listeners = new Map()
    this.children = []
    this.parentElement = null
    Object.entries(attrs).forEach(([name, value]) => this.setAttribute(name, value))
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  matches(selector) {
    return selector.split(',').some((part) => {
      const candidate = part.trim()
      if (candidate.startsWith('.')) {
        return String(this.getAttribute('class') || '').split(/\s+/).includes(candidate.slice(1))
      }
      const attr = candidate.match(/^(?:([a-z]+))?\[([^=\]]+)(?:="([^"]+)")?\]$/i)
      if (attr) {
        const tagMatches = !attr[1] || attr[1].toUpperCase() === this.tagName
        return tagMatches && this.getAttribute(attr[2]) !== null &&
          (!attr[3] || this.getAttribute(attr[2]) === attr[3])
      }
      return candidate.toUpperCase() === this.tagName
    })
  }
  append(...children) {
    children.forEach((child) => {
      child.parentElement = this
      this.children.push(child)
    })
  }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }
  closest(selector) {
    let element = this
    while (element) {
      const matches = selector === '[data-form="step"][data-index]'
        ? element.getAttribute('data-form') === 'step' && element.getAttribute('data-index') !== null
        : element.matches(selector)
      if (matches) return element
      element = element.parentElement
    }
    return null
  }
  dispatchEvent(event) {
    event.target = this
    let root = this
    while (root.parentElement) root = root.parentElement
    const document = root.ownerDocument
    if (document) document.dispatchListeners(event, true)
    ;(this.listeners.get(event.type) || []).forEach((listener) => listener(event))
    if (event.bubbles && document) document.dispatchListeners(event, false)
    return true
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector) {
    const matches = []
    this.children.forEach((child) => {
      if (child.matches(selector)) matches.push(child)
      matches.push(...child.querySelectorAll(selector))
    })
    return matches
  }
}

function freeService(overrides = {}) {
  return {
    config_id: 'cfg-free-1',
    title: 'Free Consultation Call - 30min',
    price_cents: 0,
    currency: 'usd',
    duration: 30,
    active: true,
    revision: 4,
    ...overrides,
  }
}

function paidService(overrides = {}) {
  return {
    config_id: 'cfg-paid-1',
    title: 'Paid Consultation Call',
    price_cents: 35000,
    currency: 'usd',
    duration: 60,
    active: true,
    revision: 4,
    ...overrides,
  }
}

function freeCanonical(overrides = {}) {
  return {
    public_description: overrides.public_description || '',
    readiness: {
      calendar_connected: true,
      availability_configured: true,
      free_call_enabled: false,
      bookable: false,
      ...(overrides.readiness || {}),
    },
    services: overrides.services || [],
  }
}

function paidCanonical(overrides = {}) {
  return {
    readiness: {
      calendar_connected: true,
      availability_configured: true,
      stripe_connected: true,
      paid_call_enabled: false,
      bookable: false,
      ...(overrides.readiness || {}),
    },
    services: overrides.services || [],
  }
}

// One authored step 6 carrying both call radio groups and both sets of dependent
// fields: the single DOM both canonical controllers claim as their root on Edit Profile.
function buildStepSix() {
  const step = new El('div', { 'data-form': 'step', 'data-index': '6' })

  function radioPair(groupName) {
    const noLabel = new El('label')
    const yesLabel = new El('label')
    const no = new El('input', { name: groupName, value: 'No' })
    const yes = new El('input', { name: groupName, value: 'Yes' })
    const noVisual = new El('div', { class: 'radio-filter_check w-radio-input w--redirected-checked' })
    const yesVisual = new El('div', { class: 'radio-filter_check w-radio-input' })
    noLabel.append(noVisual, no)
    yesLabel.append(yesVisual, yes)
    step.append(noLabel, yesLabel)
    no.checked = true
    return { no, yes }
  }

  const free = radioPair('free-consulting-calls')
  const freeDescription = new El('input', { name: 'free-call-description' })
  const paid = radioPair('paid-consulting-calls')
  const paidDescription = new El('input', { name: 'paid-call-description' })
  const paidRate = new El('input', { name: 'paid-call-rate' })
  step.append(freeDescription, paidDescription, paidRate)

  return {
    step,
    freeNo: free.no,
    freeYes: free.yes,
    freeDescription,
    paidNo: paid.no,
    paidYes: paid.yes,
    paidDescription,
    paidRate,
  }
}

function load({
  order = ['paid', 'free'],
  free = freeCanonical(),
  paid = paidCanonical(),
  failGets = false,
  pageActions = false,
  prepare = null,
  profileDirtyState = false,
  schedulingAuthDelayed = false,
} = {}) {
  const dom = buildStepSix()
  if (pageActions) {
    const page = new El('main')
    dom.pageOpen = new El('div', { 'data-availability-action': 'item-form-open' })
    dom.pageSubmit = new El('button', { 'data-availability-action': 'item-form-submit' })
    page.append(dom.pageOpen, dom.pageSubmit, dom.step)
    dom.page = page
  }
  if (prepare) prepare(dom)
  const html = new El('html')
  const calls = []
  const timers = []
  const warnings = []
  const documentListeners = new Map()
  const windowListeners = new Map()

  const document = {
    readyState: 'complete',
    documentElement: html,
    querySelector(selector) {
      return selector === '[data-form="step"][data-index="6"]' ? dom.step : null
    },
    querySelectorAll() { return [] },
    addEventListener(name, listener, capture = false) {
      const listeners = documentListeners.get(name) || []
      listeners.push({ listener, capture })
      documentListeners.set(name, listeners)
    },
    dispatchListeners(event, capture) {
      for (const entry of documentListeners.get(event.type) || []) {
        if (entry.capture === capture) entry.listener(event)
      }
    },
  }
  ;(dom.page || dom.step).ownerDocument = document

  const authScope = {}
  const state = { free, paid }
  const authFetch = async (url, init) => {
    const path = url.replace(API_BASE, '')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ path, method: init.method, body })
    if (failGets) {
      return { ok: false, status: 500, json: async () => ({ message: 'Xano is down' }) }
    }
    if (path === '/starter/free-call-settings/get/v3') {
      return { ok: true, status: 200, json: async () => state.free }
    }
    if (path === '/starter/paid-call-settings/get/v3') {
      return { ok: true, status: 200, json: async () => state.paid }
    }
    throw new Error('unrouted request ' + path)
  }

  const authChangeHandlers = []
  const installSchedulingAuth = () => {
    window.__tsSchedulingAuthFetch = authFetch
    window.__tsSchedulingAuthGetScope = async () => authScope
  }

  const window = {
    location: { hostname: 'thestarters.com', pathname: '/starter-edit-profile' },
    crypto: { randomUUID: () => 'uuid-fixed' },
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimeout(timer) { timer.cancelled = true },
    addEventListener(name, listener) {
      const listeners = windowListeners.get(name) || []
      listeners.push(listener)
      windowListeners.set(name, listeners)
    },
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) listener(event)
    },
    $memberstackDom: {
      getCurrentMember: async () => ({ data: { id: 'member-a' } }),
      onAuthChange(handler) { authChangeHandlers.push(handler) },
    },
  }
  if (!schedulingAuthDelayed) installSchedulingAuth()

  class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init && init.detail
      this.bubbles = Boolean(init && init.bubbles)
    }
    preventDefault() {}
  }

  class MutationObserver {
    constructor(callback) { this.callback = callback }
    observe() {}
    disconnect() {}
  }

  const context = vm.createContext({
    CustomEvent,
    Date,
    Math,
    MutationObserver,
    console: { warn(...a) { warnings.push(a.join(' ')) } },
    document,
    window,
    // This VM has no provider client or native network entry point. Every
    // scheduling request uses the two local GET fixtures above.
    fetch() { throw new Error('Network is forbidden in this disposable fixture') },
  })
  // The page embeds the profile loader alongside the call controllers, and the loader owns the
  // shared hydration window both of them read.
  if (profileDirtyState) vm.runInContext(PROFILE_LOADER_SOURCE, context)
  order.forEach((name) => {
    vm.runInContext(name === 'free' ? FREE_SOURCE : PAID_SOURCE, context)
  })

  return {
    dom,
    calls,
    window,
    warnings,
    html,
    beforeUnload() {
      const event = {
        type: 'beforeunload',
        prevented: false,
        returnValue: undefined,
        preventDefault() { this.prevented = true },
      }
      window.dispatchEvent(event)
      return { prevented: event.prevented, returnValue: event.returnValue }
    },
    installSchedulingAuth,
    notifyAuthChange(member) {
      authChangeHandlers.forEach((handler) => { handler(member) })
    },
    flushTimers() {
      const pending = timers.splice(0)
      pending.forEach((timer) => { if (!timer.cancelled) timer.callback() })
    },
  }
}

async function settle(iterations = 30) {
  for (let index = 0; index < iterations; index += 1) await new Promise(setImmediate)
}

for (const order of [['paid', 'free'], ['free', 'paid']]) {
  test(`each call controller on the shared step 6 root drives only its own radios (${order.join(' then ')})`, async () => {
    const result = load({
      order,
      free: freeCanonical({
        public_description: 'Free growth review',
        services: [freeService()],
        readiness: { free_call_enabled: true, bookable: true },
      }),
      paid: paidCanonical(),
    })
    await settle()

    assert.equal(result.dom.freeYes.checked, true)
    assert.equal(result.dom.freeNo.checked, false)
    assert.equal(result.dom.freeDescription.value, 'Free growth review')

    assert.equal(result.dom.paidYes.checked, false)
    assert.equal(result.dom.paidNo.checked, true)

    assert.equal(result.window.StarterFreeCallSettings.hasChanges(), false)
    assert.equal(result.window.StarterPaidCallSettings.hasChanges(), false)
  })

  test(`both call controllers wait for a late scheduling auth bridge (${order.join(' then ')})`, async () => {
    const result = load({
      order,
      schedulingAuthDelayed: true,
      free: freeCanonical({
        public_description: 'Free growth review',
        services: [freeService()],
        readiness: { free_call_enabled: true, bookable: true },
      }),
      paid: paidCanonical(),
    })
    await settle()

    assert.equal(result.calls.length, 0)
    assert.equal(result.warnings.length, 0)

    result.installSchedulingAuth()
    result.flushTimers()
    await settle()

    assert.deepEqual(result.calls.map(({ path, method }) => ({ path, method })).sort((a, b) =>
      a.path.localeCompare(b.path)), [
      { path: '/starter/paid-call-settings/get/v3', method: 'GET' },
      { path: '/starter/free-call-settings/get/v3', method: 'GET' },
    ].sort((a, b) => a.path.localeCompare(b.path)))
    assert.equal(result.html.getAttribute('data-free-call-settings'), 'ready')
    assert.equal(result.html.getAttribute('data-paid-call-settings'), 'ready')
    assert.equal(result.dom.freeYes.checked, true)
    assert.equal(result.dom.paidNo.checked, true)
    assert.equal(result.warnings.length, 0)
  })

  test(`a Memberstack auth change during the auth-bridge wait never flashes the unavailable state (${order.join(' then ')})`, async () => {
    const result = load({
      order,
      schedulingAuthDelayed: true,
      free: freeCanonical({
        public_description: 'Free growth review',
        services: [freeService()],
        readiness: { free_call_enabled: true, bookable: true },
      }),
      paid: paidCanonical(),
    })
    await settle()

    assert.equal(result.html.getAttribute('data-free-call-settings'), 'loading')
    assert.equal(result.html.getAttribute('data-paid-call-settings'), 'loading')

    result.notifyAuthChange({ data: { id: 'member-a' } })
    await settle()

    assert.equal(result.calls.length, 0)
    assert.equal(result.html.getAttribute('data-free-call-settings'), 'loading')
    assert.equal(result.html.getAttribute('data-paid-call-settings'), 'loading')
    assert.equal(result.warnings.length, 0)

    result.installSchedulingAuth()
    result.flushTimers()
    await settle()

    assert.equal(result.html.getAttribute('data-free-call-settings'), 'ready')
    assert.equal(result.html.getAttribute('data-paid-call-settings'), 'ready')
    assert.equal(result.dom.freeYes.checked, true)
    assert.equal(result.dom.paidNo.checked, true)
    assert.equal(result.warnings.length, 0)
  })

  test(`a Paid radio click never marks the Free controller dirty (${order.join(' then ')})`, async () => {
    const result = load({
      order,
      free: freeCanonical({ services: [freeService()], readiness: { free_call_enabled: true, bookable: true } }),
      paid: paidCanonical({ services: [paidService()], readiness: { paid_call_enabled: true, bookable: true } }),
    })
    await settle()

    result.dom.paidNo.checked = true
    result.dom.paidYes.checked = false
    result.dom.paidNo.dispatchEvent({ type: 'change' })

    assert.equal(result.window.StarterPaidCallSettings.hasChanges(), true)
    assert.equal(result.window.StarterFreeCallSettings.hasChanges(), false)
    assert.equal(result.dom.freeYes.checked, true)
  })
}

test('a canonical render still announces its radio answer without shared hydration state', async () => {
  const result = load({
    free: freeCanonical({
      public_description: 'Free growth review',
      services: [freeService()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  const seen = []
  assert.equal(result.window.__tsProfileDirtyState, undefined)
  result.dom.freeYes.addEventListener('change', () => seen.push('free-yes'))
  result.dom.paidNo.addEventListener('change', () => seen.push('paid-no'))
  await settle()

  assert.deepEqual(seen.sort(), ['free-yes', 'paid-no'])
})

test('a failed canonical read leaves the answers the member can already see alone', async () => {
  const result = load({
    failGets: true,
    prepare: (dom) => {
      dom.freeNo.checked = false
      dom.freeYes.checked = true
      dom.freeDescription.value = 'Free growth review'
      dom.paidNo.checked = false
      dom.paidYes.checked = true
      dom.paidDescription.value = 'Paid deep dive'
      dom.paidRate.value = '350'
    },
  })
  await settle()

  assert.equal(result.dom.freeYes.checked, true)
  assert.equal(result.dom.freeDescription.value, 'Free growth review')
  assert.equal(result.dom.paidYes.checked, true)
  assert.equal(result.dom.paidDescription.value, 'Paid deep dive')
  assert.equal(result.dom.paidRate.value, '350')

  // Nothing was read, so neither controller may claim a saveable opinion.
  assert.equal(result.window.StarterFreeCallSettings.isReady(), false)
  assert.equal(result.window.StarterPaidCallSettings.isReady(), false)
  assert.equal(result.window.StarterFreeCallSettings.hasChanges(), false)
  assert.equal(result.window.StarterPaidCallSettings.hasChanges(), false)
})

test('the Free controller never reaches profile CRUD controls outside step 6', async () => {
  const result = load({
    pageActions: true,
    free: freeCanonical({
      public_description: 'Free growth review',
      services: [freeService()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.freeYes.checked, true)
  assert.equal(result.dom.pageSubmit.getAttribute('aria-disabled'), null)
  assert.equal(result.dom.pageSubmit.disabled, false)
  assert.equal(result.dom.pageSubmit.style.pointerEvents, undefined)
  assert.equal(result.dom.pageSubmit.style.opacity, undefined)
  assert.equal(result.dom.pageOpen.listeners.has('click'), false)
})

// canonical-profile-loader.js skips the five call controls, but every control it does restore
// is announced with the native input + change pair. This replays that pair over them anyway, so
// the hydration window still has to answer for any other source of a restored-shaped event.
function replayProfileLoaderHydration(dom) {
  function writeRadio(checked, unchecked) {
    checked.checked = true
    unchecked.checked = false
    checked.dispatchEvent({ type: 'input' })
    checked.dispatchEvent({ type: 'change' })
  }
  function writeText(input, value) {
    input.value = value
    input.dispatchEvent({ type: 'input' })
    input.dispatchEvent({ type: 'change' })
  }
  writeRadio(dom.freeNo, dom.freeYes)
  writeText(dom.freeDescription, '')
  writeRadio(dom.paidNo, dom.paidYes)
  writeText(dom.paidDescription, '')
  writeText(dom.paidRate, '')
}

test('the profile loader hydrating step 6 is not a member change to call settings', async () => {
  const result = load({
    profileDirtyState: true,
    failGets: true,
    prepare: (dom) => {
      dom.freeNo.checked = false
      dom.freeYes.checked = true
      dom.freeDescription.value = 'Free growth review'
    },
  })
  await settle()

  const dirtyState = result.window.__tsProfileDirtyState
  assert.equal(dirtyState.isHydrating(), true)
  replayProfileLoaderHydration(result.dom)

  // Neither controller may claim unsaved work the member never made: with the canonical read
  // failed, a claimed change is what blocks Hourly Rate, Availability and Retainer from saving.
  assert.equal(result.window.StarterFreeCallSettings.hasChanges(), false)
  assert.equal(result.window.StarterPaidCallSettings.hasChanges(), false)

  // A real gesture after hydration still counts, and still only for the controller that owns it.
  dirtyState.finishHydration()
  result.dom.freeDescription.value = 'Updated free introduction'
  result.dom.freeDescription.dispatchEvent({ type: 'input' })
  assert.equal(result.window.StarterFreeCallSettings.hasChanges(), true)
  assert.equal(result.window.StarterPaidCallSettings.hasChanges(), false)
})

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

for (const controller of ['free', 'paid']) {
  test(`a late ${controller} canonical radio render stays clean after profile hydration`, async (t) => {
    const pending = deferred()
    const result = load({
      profileDirtyState: true,
      free: controller === 'free' ? pending.promise : freeCanonical(),
      paid: controller === 'paid' ? pending.promise : paidCanonical(),
    })
    await settle()
    const dirtyState = result.window.__tsProfileDirtyState
    dirtyState.finishHydration()
    assert.equal(dirtyState.isDirty(), false)
    assert.equal(result.beforeUnload().prevented, false)

    // Match the observed Free Yes / Paid No answers. The response arrives only
    // after the actual loader's public finishHydration interface has completed.
    pending.resolve(controller === 'free'
      ? freeCanonical({ services: [freeService()] })
      : paidCanonical())
    await settle()

    const canonicalRender = {
      globalDirty: dirtyState.isDirty(),
      freeHasChanges: result.window.StarterFreeCallSettings.hasChanges(),
      paidHasChanges: result.window.StarterPaidCallSettings.hasChanges(),
      beforeUnload: result.beforeUnload(),
    }
    assert.equal(canonicalRender.freeHasChanges, false)
    assert.equal(canonicalRender.paidHasChanges, false)
    assert.equal(controller === 'free' ? result.dom.freeYes.checked : result.dom.paidNo.checked, true)

    // Discard only this disposable step to compare a fresh member edit even on
    // the unfixed source. A widget's synthetic user event must also stay dirty.
    dirtyState.setDirty(6, false)
    const input = controller === 'free' ? result.dom.freeDescription : result.dom.paidDescription
    input.value = 'A member edit'
    input.dispatchEvent({ type: 'input', bubbles: true, isTrusted: true })
    assert.equal(dirtyState.isDirty(), true)
    assert.equal(result.beforeUnload().prevented, true)
    assert.equal(result.window[controller === 'free' ? 'StarterFreeCallSettings' : 'StarterPaidCallSettings'].hasChanges(), true)
    dirtyState.setDirty(6, false)
    input.dispatchEvent({ type: 'input', bubbles: true, isTrusted: false })
    assert.equal(dirtyState.isDirty(), true)
    assert.equal(result.beforeUnload().prevented, true)
    assert.equal(result.calls.every(({ method }) => method === 'GET'), true)

    t.diagnostic(JSON.stringify({ controller, canonicalRender, memberAndWidgetEditsRemainDirty: true }))
    assert.equal(canonicalRender.globalDirty, false)
    assert.deepEqual(canonicalRender.beforeUnload, { prevented: false, returnValue: undefined })
  })

  test(`a late ${controller} canonical render preserves an unrelated dirty step and in-flight save`, async () => {
    const pending = deferred()
    const result = load({
      profileDirtyState: true,
      free: controller === 'free' ? pending.promise : freeCanonical(),
      paid: controller === 'paid' ? pending.promise : paidCanonical(),
    })
    await settle()
    const dirtyState = result.window.__tsProfileDirtyState
    dirtyState.finishHydration()
    dirtyState.markDirty(1)
    const saving = dirtyState.beginSave(2)
    pending.resolve(controller === 'free' ? freeCanonical({ services: [freeService()] }) : paidCanonical())
    await settle()

    assert.equal(result.beforeUnload().prevented, true)
    dirtyState.setDirty(1, false)
    assert.equal(dirtyState.isDirty(), true, 'canonical rendering must not erase an in-flight save')
    dirtyState.finishSave(2, true, saving)
    assert.equal(dirtyState.isDirty(), false, 'canonical rendering must not introduce step 6 changes')
    assert.equal(result.beforeUnload().prevented, false)
  })
}

test('canonical radio announcements retain their fallback when the shared wrapper is unavailable', async () => {
  const free = deferred()
  const paid = deferred()
  const result = load({ profileDirtyState: true, free: free.promise, paid: paid.promise })
  await settle()
  result.window.__tsProfileDirtyState.finishHydration()
  result.window.__tsProfileDirtyState.runHydrationSync = undefined
  const seen = []
  result.dom.freeYes.addEventListener('change', () => seen.push('free-yes'))
  result.dom.paidNo.addEventListener('change', () => seen.push('paid-no'))
  free.resolve(freeCanonical({ services: [freeService()] }))
  paid.resolve(paidCanonical())
  await settle()

  assert.deepEqual(seen.sort(), ['free-yes', 'paid-no'])
  assert.equal(result.dom.freeYes.checked, true)
  assert.equal(result.dom.paidNo.checked, true)
  assert.equal(result.window.StarterFreeCallSettings.hasChanges(), false)
  assert.equal(result.window.StarterPaidCallSettings.hasChanges(), false)
})
