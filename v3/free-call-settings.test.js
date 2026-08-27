const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./free-call-settings.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

test('the Free error visibility rule outranks Webflow hide utilities', () => {
  assert.match(
    SOURCE,
    /\[data-call-settings-error-visible="true"\]\.w-form-fail\{display:block!important\}/,
  )
})

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
  async dispatch(name) {
    const event = { type: name, preventDefault() {} }
    await Promise.all((this.listeners.get(name) || []).map((listener) => listener(event)))
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

function canonical(overrides = {}) {
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

function service(overrides = {}) {
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

function buildDom(withRoot = true, publishedRoot = false, authoredPills = false, pillLabels = {}) {
  if (!withRoot) return { root: null }
  const card = new El('section')
  const open = new El('div', { 'data-call-settings-action': 'open' })
  const status = new El('p', { 'data-call-settings-output': 'status' })
  const price = new El('p', { 'data-call-settings-output': 'price' })
  const pillAttrs = authoredPills
    ? { 'data-availability-element': 'call-pill-on' }
    : null
  const on = new El('div', pillAttrs || { 'data-call-settings-output': 'on' })
  const off = new El('div', pillAttrs || { 'data-call-settings-output': 'off' })
  on.textContent = pillLabels.on || 'ON'
  off.textContent = pillLabels.off || 'OFF'
  const panel = new El('div', { 'data-call-settings-element': 'panel' })
  const root = new El('div', publishedRoot
    ? { 'data-availability-element': 'call-free-form' }
    : { 'data-call-settings-service': 'free' })
  const form = new El('form', {
    name: 'Call Free Form',
    'data-name': 'Call Free Form',
    'data-call-settings-element': 'form',
  })
  const no = new El('input', { name: 'consulting-calls-free', value: 'No' })
  const yes = new El('input', { name: 'consulting-calls-free', value: 'Yes' })
  const noLabel = new El('label')
  const yesLabel = new El('label')
  const noVisual = new El('div', { class: 'radio-filter_check w-radio-input w--redirected-checked' })
  const yesVisual = new El('div', { class: 'radio-filter_check w-radio-input' })
  const title = new El('input', { 'data-call-settings-input': 'description' })
  const close = new El('div', { 'data-call-settings-action': 'close' })
  const save = new El('div', { 'data-call-settings-action': 'submit' })
  const saveIcon = new El('div', { 'data-opp-element': 'loading-hide' })
  const saveSpinner = new El('svg', { 'data-button-spinner': '', 'aria-hidden': 'true' })
  saveSpinner.style.display = 'none'
  save.append(saveIcon, saveSpinner)
  const nativeError = new El('div', { class: 'w-form-fail', 'aria-hidden': 'true' })
  const nativeErrorMessage = new El('div')
  nativeErrorMessage.textContent = 'Oops! Something went wrong while submitting the form.'
  nativeError.append(nativeErrorMessage)
  nativeError.style.display = 'none'
  const prerequisites = ['calendar', 'availability', 'enabled', 'bookable']
    .map((name) => new El('div', { 'data-free-call-prerequisite': name }))
  noLabel.append(noVisual, no)
  yesLabel.append(yesVisual, yes)
  form.append(noLabel, yesLabel, title, close, save)
  root.append(form, nativeError)
  panel.append(root)
  card.append(open, status, price, on, off, ...prerequisites, panel)
  return {
    card,
    root,
    form,
    no,
    yes,
    noVisual,
    yesVisual,
    title,
    close,
    save,
    nativeError,
    nativeErrorMessage,
    open,
    status,
    price,
    on,
    off,
    panel,
    prerequisites,
  }
}

function buildPublishedSiblingDom() {
  const shared = new El('section')

  function card(serviceName, formName, groupName) {
    const wrapper = new El('section')
    const open = new El('div', { 'data-availability-action': 'item-form-open' })
    const panel = new El('div', { 'data-availability-element': 'call-form-wrapper' })
    const root = new El('div', { 'data-availability-element': 'call-' + serviceName + '-form' })
    const form = new El('form', { name: formName, 'data-name': formName })
    const no = new El('input', { name: groupName, value: 'No' })
    const yes = new El('input', { name: groupName, value: 'Yes' })
    const close = new El('div', { 'data-availability-action': 'item-form-close' })
    const save = new El('div', { 'data-availability-action': 'item-form-submit' })
    form.append(no, yes, close, save)
    root.append(form)
    panel.append(root)
    wrapper.append(open, panel)
    return { wrapper, open, panel, root, form, no, yes, close, save }
  }

  const free = card('free', 'Call Free Form', 'consulting-calls-free')
  const paid = card('paid', 'Call Paid Form', 'consulting-calls-paid')
  paid.no.checked = false
  paid.yes.checked = true
  shared.append(free.wrapper, paid.wrapper)

  return {
    card: free.wrapper,
    root: free.root,
    form: free.form,
    no: free.no,
    yes: free.yes,
    title: null,
    close: free.close,
    save: free.save,
    open: free.open,
    status: null,
    price: null,
    on: null,
    off: null,
    panel: free.panel,
    shared,
    free,
    paid,
  }
}

function load(options = {}) {
  const dom = options.publishedSiblings === true
    ? buildPublishedSiblingDom()
    : buildDom(
      options.withRoot !== false,
      options.publishedRoot === true,
      options.authoredPills === true,
      options.pillLabels || {},
    )
  const delayedSiblings = options.rootFirst === true && dom.card
    ? dom.card.children.filter((item) => item !== dom.panel)
    : []
  if (delayedSiblings.length) dom.card.children = [dom.panel]
  if (dom.root && options.radioNames) {
    dom.no.setAttribute('name', options.radioNames.no)
    dom.yes.setAttribute('name', options.radioNames.yes)
  }
  if (dom.root && options.radioValues) {
    dom.no.setAttribute('value', options.radioValues.no)
    dom.yes.setAttribute('value', options.radioValues.yes)
  }
  if (dom.form && options.reportValidity !== undefined) {
    dom.form.reportValidity = () => options.reportValidity
  }

  const html = new El('html')
  const calls = []
  const events = []
  const timers = []
  const observers = []
  const warnings = []
  const windowListeners = new Map()
  let rootAvailable = options.withRoot !== false && options.rootDelayed !== true
  let state = options.initial || canonical()
  let activeMember = { id: options.memberId || 'member-free-a' }
  let authSessionActive = true
  let authScope = {}
  let currentMemberReader = () => activeMember
  let authChange = null
  const routes = options.routes || {}

  const document = {
    readyState: 'complete',
    documentElement: html,
    querySelector(selector) {
      if (
        selector === '[data-call-settings-service="free"]' ||
        selector === '[data-availability-element="call-free-form"]'
      ) {
        return rootAvailable ? dom.root : null
      }
      return null
    },
    querySelectorAll() { return [] },
    addEventListener() {},
  }

  const memberstack = {
    getCurrentMember: async () => ({ data: await currentMemberReader() }),
    onAuthChange(listener) { authChange = listener },
  }

  const schedulingAuthFetch = async (url, init) => {
    if (!authSessionActive) throw new Error('No Memberstack session')
    const path = url.replace(API_BASE, '')
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ path, method: init.method, body })
    if (routes[path]) {
      return routes[path]({
        body,
        member: activeMember,
        state,
        setState: (next) => { state = next },
      })
    }
    if (path === '/starter/free-call-settings/get/v3') {
      return { ok: true, status: 200, json: async () => state }
    }
    throw new Error('unrouted request ' + path)
  }

  const window = {
    location: { hostname: options.hostname || 'the-starters-3-0.webflow.io' },
    crypto: { randomUUID: () => 'uuid-fixed' },
    memberReady: options.memberReady,
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
    dispatchEvent(event) { events.push(event) },
    __tsSchedulingAuthFetch: schedulingAuthFetch,
    __tsSchedulingAuthGetScope: async () => {
      if (!authSessionActive) throw new Error('No Memberstack session')
      return authScope
    },
    xanoAuthFetch: schedulingAuthFetch,
  }
  if (!options.withoutMemberstackAtLoad) window.$memberstackDom = memberstack

  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail }
  }

  class MutationObserver {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this) }
    observe() { this.active = true }
    disconnect() { this.active = false }
  }

  vm.runInNewContext(SOURCE, {
    CustomEvent,
    Date,
    Math,
    MutationObserver,
    console: { warn: (...args) => warnings.push(args.join(' ')) },
    document,
    window,
  })

  return {
    dom,
    calls,
    events,
    warnings,
    window,
    document,
    expireMember: () => { activeMember = null; authSessionActive = false; authScope = {} },
    setCurrentMemberReader: (reader) => { currentMemberReader = reader },
    changeMember: async (member) => {
      if (!activeMember || !member || activeMember.id !== member.id) authScope = {}
      activeMember = member
      authSessionActive = Boolean(member && member.id)
      return authChange ? authChange(member) : null
    },
    rotateAuthScope: async () => {
      authScope = {}
      return authChange ? authChange(activeMember) : null
    },
    switchAuthScopeWithNullNotice: async (member) => {
      activeMember = member
      authSessionActive = Boolean(member && member.id)
      authScope = {}
      return authChange ? authChange(null) : null
    },
    notifyAuthChange: async (member) => (authChange ? authChange(member) : null),
    revealRoot: () => {
      rootAvailable = true
      observers.filter((observer) => observer.active).forEach((observer) => observer.callback())
    },
    revealSiblings: () => {
      dom.card.append(...delayedSiblings)
      observers.filter((observer) => observer.active).forEach((observer) => observer.callback())
    },
    notifyMutation: () => {
      observers.filter((observer) => observer.active).forEach((observer) => observer.callback())
    },
    flushTimers: () => {
      const pending = timers.splice(0)
      pending.forEach((timer) => { if (!timer.cancelled) timer.callback() })
    },
    dispatchWindowEvent: async (name) => {
      const listeners = windowListeners.get(name) || []
      await Promise.all(listeners.map((listener) => listener({ type: name })))
    },
  }
}

async function settle(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) await new Promise(setImmediate)
}

test('is inert when the Free settings root is absent', async () => {
  const result = load({ withRoot: false })
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'waiting-for-ui')
  result.flushTimers()
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'not-applicable')
  assert.equal(result.calls.length, 0)
})

test('boots when the native Free form is inserted after the controller', async () => {
  const result = load({ rootDelayed: true, initial: canonical({ services: [service()] }) })
  await settle()
  result.revealRoot()
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
  assert.equal(result.calls.length, 1)
})

test('hydrates the published Free radio group from canonical GET', async () => {
  const active = service()
  const result = load({
    initial: canonical({
      public_description: 'Free growth review',
      services: [active],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.deepEqual(result.calls.map(({ path, method }) => ({ path, method })), [
    { path: '/starter/free-call-settings/get/v3', method: 'GET' },
  ])
  assert.equal(result.dom.yes.checked, true)
  assert.equal(result.dom.no.checked, false)
  assert.equal(result.dom.yes.getAttribute('data-call-settings-input'), 'enabled')
  assert.equal(result.dom.no.getAttribute('data-call-settings-input'), 'disabled')
  assert.equal(result.dom.title.value, 'Free growth review')
  assert.equal(result.dom.title.readOnly, false)
  assert.equal(result.dom.root.getAttribute('data-free-call-duration-required'), '30')
  assert.equal(result.dom.root.getAttribute('data-free-call-price-cents'), '0')
  assert.equal(result.dom.root.getAttribute('data-free-call-bookable'), 'true')
  assert.equal(result.dom.noVisual.getAttribute('class').includes('w--redirected-checked'), false)
  assert.equal(result.dom.yesVisual.getAttribute('class').includes('w--redirected-checked'), true)
})

test('production-shaped pills show only canonical Free status', async () => {
  const active = load({
    authoredPills: true,
    initial: canonical({
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  assert.equal(active.dom.on.hidden, false)
  assert.equal(active.dom.off.hidden, true)
  assert.equal(active.dom.on.getAttribute('data-call-settings-output'), 'on')
  assert.equal(active.dom.off.getAttribute('data-call-settings-output'), 'off')

  const inactive = load({ authoredPills: true, initial: canonical() })
  await settle()
  assert.equal(inactive.dom.on.hidden, true)
  assert.equal(inactive.dom.off.hidden, false)
})

test('Free re-resolves the card when status pills and Edit arrive after the root', async () => {
  const result = load({
    publishedRoot: true,
    authoredPills: true,
    rootFirst: true,
    initial: canonical({
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  result.revealSiblings()
  await settle()

  assert.equal(result.dom.on.hidden, false)
  assert.equal(result.dom.on.style.display, '')
  assert.equal(result.dom.off.hidden, true)
  assert.equal(result.dom.off.style.display, 'none')
  assert.equal(result.dom.on.getAttribute('data-call-settings-output'), 'on')
  assert.equal(result.dom.off.getAttribute('data-call-settings-output'), 'off')

  await result.dom.open.dispatch('click')
  assert.equal(result.dom.panel.style.display, 'flex')
})

test('drifted authored Free pill copy is reported on staging instead of failing silently', async () => {
  const result = load({
    authoredPills: true,
    pillLabels: { on: 'Live', off: 'Paused' },
    initial: canonical({
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.on.getAttribute('data-call-settings-output'), null)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /no authored status pill reads "on"/)
  assert.match(result.warnings[0], /live \| paused/)
})

test('authored Free pill copy padded with a non-breaking space still resolves', async () => {
  const result = load({
    authoredPills: true,
    pillLabels: { on: '\u00a0On\u00a0', off: 'Off' },
    initial: canonical({
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.on.hidden, false)
  assert.equal(result.dom.off.hidden, true)
  assert.equal(result.warnings.length, 0)
})

test('boots from the published call-free-form compatibility root', async () => {
  const result = load({
    publishedRoot: true,
    initial: canonical({
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
  assert.equal(result.dom.yes.checked, true)
  assert.equal(result.calls.filter((call) => call.path === '/starter/free-call-settings/get/v3').length, 1)
})

test('published sibling Paid actions never bind the Free controller and Free actions never change Paid controls', async () => {
  const result = load({
    publishedSiblings: true,
    initial: canonical(),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        const saved = service({ revision: 1 })
        setState(canonical({
          services: [saved],
          readiness: { free_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  const freeStateBeforePaidActions = {
    enabled: result.dom.root.getAttribute('data-free-call-enabled'),
    bookable: result.dom.root.getAttribute('data-free-call-bookable'),
    no: result.dom.no.checked,
    yes: result.dom.yes.checked,
    panelDisplay: result.dom.panel.style.display,
  }

  await result.dom.paid.open.dispatch('click')
  await result.dom.paid.save.dispatch('click')
  await settle()

  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.deepEqual({
    enabled: result.dom.root.getAttribute('data-free-call-enabled'),
    bookable: result.dom.root.getAttribute('data-free-call-bookable'),
    no: result.dom.no.checked,
    yes: result.dom.yes.checked,
    panelDisplay: result.dom.panel.style.display,
  }, freeStateBeforePaidActions)

  const paidControlsBeforeFreeActions = {
    no: result.dom.paid.no.checked,
    yes: result.dom.paid.yes.checked,
    panelDisplay: result.dom.paid.panel.style.display,
    openStyle: { ...result.dom.paid.open.style },
    saveStyle: { ...result.dom.paid.save.style },
  }

  await result.dom.free.open.dispatch('click')
  result.dom.free.yes.checked = true
  await result.dom.free.yes.dispatch('change')
  await result.dom.free.save.dispatch('click')
  await settle()

  const freePosts = result.calls.filter((call) =>
    call.method === 'POST' && call.path === '/starter/free-call-settings/upsert/v3')
  assert.equal(freePosts.length, 1)
  assert.deepEqual(freePosts[0].body, {
    config_id: null,
    description: '',
    expected_revision: 0,
    idempotency_key: 'free-call-upsert:uuid-fixed',
  })
  assert.deepEqual({
    no: result.dom.paid.no.checked,
    yes: result.dom.paid.yes.checked,
    panelDisplay: result.dom.paid.panel.style.display,
    openStyle: { ...result.dom.paid.open.style },
    saveStyle: { ...result.dom.paid.save.style },
  }, paidControlsBeforeFreeActions)
})

test('upsert sends description plus guarded service intent then requires 30-minute/$0 readback', async () => {
  const legacy = service({ duration: 15, price_cents: 100, revision: 2 })
  const result = load({
    initial: canonical({ services: [legacy], readiness: { free_call_enabled: true, bookable: true } }),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ body, setState }) => {
        const saved = service({ revision: 3 })
        setState(canonical({
          services: [saved],
          readiness: { free_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()
  await result.dom.save.dispatch('click')
  await settle()

  const upsert = result.calls.find((call) => call.path === '/starter/free-call-settings/upsert/v3')
  assert.deepEqual(upsert.body, {
    config_id: 'cfg-free-1',
    description: '',
    expected_revision: 2,
    idempotency_key: 'free-call-upsert:uuid-fixed',
  })
  assert.deepEqual(Object.keys(upsert.body).sort(), [
    'config_id',
    'description',
    'expected_revision',
    'idempotency_key',
  ])
  assert.equal(result.dom.root.getAttribute('data-free-call-duration-current'), '30')
  assert.equal(result.dom.root.getAttribute('data-free-call-price-cents'), '0')
})

test('new Free enable sends null config and revision zero while Xano retains service ownership', async () => {
  const result = load({
    initial: canonical(),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        const saved = service({ revision: 1 })
        setState(canonical({ services: [saved], readiness: { free_call_enabled: true, bookable: true } }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()
  result.dom.yes.checked = true
  await result.dom.yes.dispatch('change')
  await result.dom.save.dispatch('click')
  await settle()

  assert.deepEqual(result.calls.find((call) => call.method === 'POST').body, {
    config_id: null,
    description: '',
    expected_revision: 0,
    idempotency_key: 'free-call-upsert:uuid-fixed',
  })
})

test('Free description loads from canonical profile intent and is sent with the guarded upsert', async () => {
  const result = load({
    initial: canonical({ public_description: 'Growth strategy review' }),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ body, setState }) => {
        const saved = service({ revision: 1 })
        setState(canonical({
          public_description: body.description,
          services: [saved],
          readiness: { free_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.title.value, 'Growth strategy review')
  result.dom.title.value = 'Marketplace growth plan'
  result.dom.yes.checked = true
  result.dom.no.checked = false
  await result.dom.save.dispatch('click')
  await settle()

  const upsert = result.calls.find((call) => call.path === '/starter/free-call-settings/upsert/v3')
  assert.equal(upsert.body.description, 'Marketplace growth plan')
  assert.equal(result.dom.title.value, 'Marketplace growth plan')
  assert.equal(result.dom.title.readOnly, false)
})

test('a stale Free description readback leaves the editor open and reports an error', async () => {
  const result = load({
    initial: canonical({
      public_description: 'Old description',
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        setState(canonical({
          public_description: 'Old description',
          services: [service({ revision: 5 })],
          readiness: { free_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      },
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  result.dom.title.value = 'New description'
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'error')
  assert.match(result.dom.status.textContent, /description did not match canonical readback/)
  assert.equal(result.dom.panel.style.display, 'flex')
  assert.equal(result.events.some((event) => event.type === 'starterFreeCallWriteSuccess'), false)
})

test('a guarded Free update mirrors the error to both outputs and clears the native block on retry', async () => {
  let attempts = 0
  const active = canonical({
    public_description: 'Growth review',
    services: [service()],
    readiness: { free_call_enabled: true, bookable: true },
  })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        attempts += 1
        if (attempts === 1) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
          }
        }
        setState(active)
        return { ok: true, status: 200, json: async () => ({ service: service() }) }
      },
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'error')
  assert.equal(
    result.dom.status.textContent,
    'Resolve in-flight bookings before updating this service',
  )
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Resolve in-flight bookings before updating this service',
  )
  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(result.dom.nativeError.getAttribute('data-call-settings-error-visible'), 'true')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'false')
  assert.equal(result.dom.nativeError.getAttribute('role'), 'alert')
  assert.equal(result.dom.panel.style.display, 'flex')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')

  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
  assert.equal(result.dom.status.textContent, 'Free calls are on and bookable.')
  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')
  assert.equal(result.dom.nativeError.getAttribute('data-call-settings-error-visible'), 'false')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'true')
})

test('an invalid Free retry clears the request error without a second write', async () => {
  let validityChecks = 0
  const active = canonical({
    public_description: 'Growth review',
    services: [service()],
    readiness: { free_call_enabled: true, bookable: true },
  })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/upsert/v3': () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
      }),
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(result.dom.nativeError.getAttribute('data-call-settings-error-visible'), 'true')

  result.dom.form.reportValidity = () => {
    validityChecks += 1
    return false
  }
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(validityChecks, 1)
  assert.equal(
    result.calls.filter((call) => call.path === '/starter/free-call-settings/upsert/v3').length,
    1,
  )
  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'true')
})

test('a Free prerequisite refresh clears an update error while pending and replaces it only on failure', async () => {
  const successfulRefresh = deferred()
  const failedRefresh = deferred()
  let reads = 0
  const active = canonical({
    public_description: 'Growth review',
    services: [service()],
    readiness: { free_call_enabled: true, bookable: true },
  })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/get/v3': () => {
        reads += 1
        if (reads === 1) return { ok: true, status: 200, json: async () => active }
        return reads === 2 ? successfulRefresh.promise : failedRefresh.promise
      },
      '/starter/free-call-settings/upsert/v3': () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
      }),
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Resolve in-flight bookings before updating this service',
  )

  await result.dispatchWindowEvent('starterSchedulingConnectionStateChanged')
  await settle(2)

  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'true')

  successfulRefresh.resolve({ ok: true, status: 200, json: async () => active })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')

  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.dom.nativeError.style.display, 'block')

  await result.dispatchWindowEvent('starterSchedulingConnectionStateChanged')
  await settle(2)

  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')

  failedRefresh.resolve({
    ok: false,
    status: 503,
    json: async () => ({ message: 'temporarily unavailable' }),
  })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'error')
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Free-call readiness could not be refreshed. Your account was not changed.',
  )
  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'false')
})

test('Free description longer than 60 characters fails before any write', async () => {
  const result = load({ initial: canonical() })
  await settle()
  result.dom.title.value = 'x'.repeat(61)
  result.dom.yes.checked = true
  result.dom.no.checked = false
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.dom.status.textContent, 'Free-call description must be 60 characters or fewer.')
})

test('No plus Update sends the guarded disable payload and verifies canonical absence', async () => {
  const result = load({
    initial: canonical({ services: [service()], readiness: { free_call_enabled: true, bookable: true } }),
    routes: {
      '/starter/free-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()
  result.dom.no.checked = true
  await result.dom.no.dispatch('change')
  await result.dom.save.dispatch('click')
  await settle()

  assert.deepEqual(result.calls.find((call) => call.path === '/starter/free-call-settings/disable/v3').body, {
    config_id: 'cfg-free-1',
    expected_revision: 4,
    idempotency_key: 'free-call-disable:uuid-fixed',
  })
  assert.equal(result.calls.filter((call) => call.method === 'POST').length, 1)
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'false')
})

test('a stale checked No state cannot disable an active Free service without a change event', async () => {
  const result = load({
    initial: canonical({ services: [service()], readiness: { free_call_enabled: true, bookable: true } }),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        const saved = service({ revision: 5 })
        setState(canonical({ services: [saved], readiness: { free_call_enabled: true, bookable: true } }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  // Reproduce the published Webflow hydration race without a user change.
  result.dom.no.checked = true
  result.dom.yes.checked = false
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/free-call-settings/disable/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/free-call-settings/upsert/v3').length, 1)
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')
})

test('No while already off closes the native editor without a write', async () => {
  const result = load({ initial: canonical() })
  await settle()
  await result.dom.open.dispatch('click')
  assert.equal(result.dom.panel.style.display, 'flex')
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.dom.panel.style.display, 'none')
})

test('missing calendar or availability blocks a new Free enable', async () => {
  const result = load({
    initial: canonical({ readiness: { availability_configured: false } }),
  })
  await settle()
  result.dom.yes.checked = true
  result.dom.no.checked = false
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'true')
})

test('native validation blocks an intercepted Update click', async () => {
  const result = load({
    initial: canonical(),
    reportValidity: false,
  })
  await settle()
  result.dom.yes.checked = true
  result.dom.no.checked = false
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
})

test('unreadable or renamed radios fail closed without touching another form', async () => {
  const result = load({
    radioNames: { no: 'consulting-calls-paid', yes: 'consulting-calls-paid' },
    initial: canonical(),
  })
  await settle()
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.dom.no.getAttribute('data-call-settings-input'), null)
  assert.equal(result.dom.yes.getAttribute('data-call-settings-input'), null)
})

test('a transient null DOM member still updates Free through the scheduling auth bridge', async () => {
  const result = load({
    initial: canonical({ services: [service()], readiness: { free_call_enabled: true, bookable: true } }),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ body, setState }) => {
        const saved = service({ revision: 3 })
        setState(canonical({
          public_description: body.description,
          services: [saved],
          readiness: { free_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()
  result.setCurrentMemberReader(() => null)
  result.window.xanoAuthFetch = async () => { throw new Error('mutable auth bridge must not run') }

  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.method === 'POST').length, 1)
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
})

test('an expired member session fails closed before Free upsert', async () => {
  const result = load({
    initial: canonical({ services: [service()], readiness: { free_call_enabled: true, bookable: true } }),
  })
  await settle()
  result.expireMember()
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'error')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'false')
  assert.equal(result.dom.status.textContent, 'Sign in to manage free calls.')
})

test('double Update while an upsert is in flight produces one write', async () => {
  const pending = deferred()
  const result = load({
    initial: canonical(),
    routes: { '/starter/free-call-settings/upsert/v3': () => pending.promise },
  })
  await settle()
  result.dom.yes.checked = true
  result.dom.no.checked = false
  await Promise.all([result.dom.save.dispatch('click'), result.dom.save.dispatch('click')])
  await settle(2)
  assert.equal(result.calls.filter((call) => call.method === 'POST').length, 1)
  assert.equal(result.dom.save.getAttribute('data-call-settings-busy'), 'true')
  assert.equal(result.dom.save.getAttribute('aria-busy'), 'true')
  assert.equal(result.dom.save.getAttribute('data-opp-loading'), 'true')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').style.display, 'flex')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').getAttribute('aria-hidden'), 'false')
  assert.equal(result.dom.save.querySelector('[data-opp-element="loading-hide"]').style.display, 'none')
  pending.resolve({ ok: true, status: 200, json: async () => ({ service: service() }) })
  await settle()
  assert.equal(result.dom.save.getAttribute('data-call-settings-busy'), 'false')
  assert.equal(result.dom.save.getAttribute('aria-busy'), 'false')
  assert.equal(result.dom.save.getAttribute('data-opp-loading'), 'false')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').style.display, 'none')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').getAttribute('aria-hidden'), 'true')
  assert.equal(result.dom.save.querySelector('[data-opp-element="loading-hide"]').style.display, '')
})

test('a noncanonical upsert readback leaves the editor open and reports an error', async () => {
  const result = load({
    initial: canonical({ services: [service()], readiness: { free_call_enabled: true, bookable: true } }),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        setState(canonical({ services: [service({ duration: 60 })] }))
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      },
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'error')
  assert.match(result.dom.status.textContent, /30-minute\/\$0 readback/)
  assert.equal(result.dom.panel.style.display, 'flex')
})

test('production hosts run but unrelated hosts remain inert', async () => {
  const production = load({ hostname: 'www.thestarters.com' })
  await settle()
  assert.equal(production.calls.length, 1)
  const unrelated = load({ hostname: 'example.com' })
  await settle()
  assert.equal(unrelated.calls.length, 0)
  assert.equal(unrelated.window.StarterFreeCallSettings, undefined)
})

test('a canonical Xano record keyed on duration reads bookable and upserts without a readback error', async () => {
  const stored = service({ duration: 30, revision: 7 })
  delete stored.price_cents
  const result = load({
    initial: canonical({
      services: [stored],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        const saved = service({ duration: 30, revision: 8 })
        delete saved.price_cents
        setState(canonical({
          services: [saved],
          readiness: { free_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.root.getAttribute('data-free-call-duration-current'), '30')
  assert.equal(result.dom.root.getAttribute('data-free-call-price-cents'), '0')
  assert.equal(result.dom.root.getAttribute('data-free-call-bookable'), 'true')
  assert.equal(result.dom.status.textContent, 'Free calls are on and bookable.')

  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.find((call) => call.method === 'POST').body.expected_revision, 7)
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
  assert.equal(result.dom.status.textContent, 'Free calls are on and bookable.')
  assert.equal(result.dom.panel.style.display, 'none')
})

test('a stored duration or price outside the fixed contract stays unbookable and shows the real price', async () => {
  const result = load({
    initial: canonical({
      services: [service({ duration: 45, price_cents: 2500 })],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.root.getAttribute('data-free-call-duration-current'), '45')
  assert.equal(result.dom.root.getAttribute('data-free-call-price-cents'), '2500')
  assert.equal(result.dom.root.getAttribute('data-free-call-bookable'), 'false')
  assert.equal(result.dom.price.textContent, '$25.00')
  assert.equal(
    result.dom.status.textContent,
    'Update this service to the required 30-minute Free Call settings.',
  )
})

test('a lost session clears the whole canonical paint, not just the radios', async () => {
  const result = load({
    initial: canonical({
      public_description: 'Member A Free Call',
      services: [service({ title: 'Member A Free Call' })],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  assert.equal(result.dom.title.value, 'Member A Free Call')
  assert.deepEqual(
    result.dom.prerequisites.map((row) => row.getAttribute('data-ready')),
    ['true', 'true', 'true', 'true'],
  )

  result.expireMember()
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.status.textContent, 'Sign in to manage free calls.')
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.root.getAttribute('data-free-call-duration-current'), '')
  assert.equal(result.dom.root.getAttribute('data-free-call-price-cents'), '0')
  assert.equal(result.dom.price.textContent, '$0')
  assert.deepEqual(
    result.dom.prerequisites.map((row) => row.getAttribute('data-ready')),
    ['false', 'false', 'false', 'false'],
  )
})

test('a transient empty auth notification preserves and refreshes the Free canonical paint', async () => {
  const result = load({
    initial: canonical({
      public_description: 'Member A Free Call',
      services: [service({ title: 'Member A Free Call' })],
      readiness: { free_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  const readsBefore = result.calls.filter(
    (call) => call.path === '/starter/free-call-settings/get/v3',
  ).length
  const transition = result.notifyAuthChange(null)
  assert.equal(result.dom.title.value, 'Member A Free Call')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')

  await transition
  await settle()

  assert.equal(result.dom.title.value, 'Member A Free Call')
  assert.equal(result.dom.yes.checked, true)
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')
  assert.equal(
    result.calls.filter((call) => call.path === '/starter/free-call-settings/get/v3').length,
    readsBefore + 1,
  )
})

test('same-member cookie rotation reloads Free and keeps Update usable', async () => {
  let reads = 0
  let writes = 0
  const result = load({
    initial: canonical({
      public_description: 'Original Free Call',
      services: [service({ title: 'Original Free Call' })],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/get/v3': ({ state }) => {
        reads += 1
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/free-call-settings/upsert/v3': ({ setState }) => {
        writes += 1
        const saved = service({ revision: 3 })
        setState(canonical({
          public_description: 'Original Free Call',
          services: [saved],
          readiness: { free_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  await result.rotateAuthScope()
  await settle()

  assert.equal(reads, 2)
  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'false')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')

  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(writes, 1)
  assert.equal(result.dom.save.getAttribute('data-call-settings-busy'), 'false')
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
})

test('Free Update is blocked while a null-auth canonical read is unresolved', async () => {
  const refresh = deferred()
  let reads = 0
  const active = canonical({
    public_description: 'Member A Free Call',
    services: [service({ title: 'Member A Free Call' })],
    readiness: { free_call_enabled: true, bookable: true },
  })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/get/v3': () => {
        reads += 1
        if (reads === 1) return { ok: true, status: 200, json: async () => active }
        return refresh.promise
      },
    },
  })
  await settle()

  const transition = result.notifyAuthChange(null)
  await settle()
  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'true')
  await result.dom.save.dispatch('click')
  assert.equal(result.calls.some((call) => call.method === 'POST'), false)

  refresh.resolve({ ok: true, status: 200, json: async () => active })
  await transition
  await settle()
  assert.notEqual(result.dom.save.getAttribute('aria-disabled'), 'true')
})

test('a final Free 401 clears stale account settings', async () => {
  let reads = 0
  const active = canonical({ services: [service()], readiness: { free_call_enabled: true, bookable: true } })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/get/v3': () => {
        reads += 1
        return reads === 1
          ? { ok: true, status: 200, json: async () => active }
          : { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) }
      },
    },
  })
  await settle()
  await result.notifyAuthChange(null)
  await settle()
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'false')
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.status.textContent, 'Sign in to manage free calls.')
})

test('Free rejects an unowned mutable auth fallback and accepts the verified scheduling fallback', async () => {
  let writes = 0
  const active = canonical({ services: [service()], readiness: { free_call_enabled: true, bookable: true } })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/upsert/v3': () => {
        writes += 1
        return { ok: true, status: 200, json: async () => ({ service: service() }) }
      },
    },
  })
  await settle()
  delete result.window.__tsSchedulingAuthFetch
  result.window.__tsSchedulingAuthBridgeOwner = 'other-bundle'
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(writes, 0)

  result.window.__tsSchedulingAuthBridgeOwner = 'scheduling-auth'
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(writes, 1)
})

test('an owner-changing null auth notification cannot repaint Free settings', async () => {
  const result = load({
    initial: canonical({
      public_description: 'Member A Free Call',
      services: [service({ title: 'Member A Free Call' })],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/get/v3': ({ member }) => ({
        ok: true,
        status: 200,
        json: async () => canonical({
          public_description: member.id === 'member-free-b' ? 'Member B Free Call' : 'Member A Free Call',
          services: [service({ title: member.id === 'member-free-b' ? 'Member B Free Call' : 'Member A Free Call' })],
          readiness: { free_call_enabled: true, bookable: true },
        }),
      }),
    },
  })
  await settle()

  await result.switchAuthScopeWithNullNotice({ id: 'member-free-b' })
  await settle()

  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'false')
  assert.equal(result.dom.status.textContent, 'Sign in to manage free calls.')
  assert.equal(result.calls.filter(
    (call) => call.path === '/starter/free-call-settings/get/v3',
  ).length, 1)
})

test('a failed post-write auth read falls back to the verified Free update', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  let reads = 0
  let postFinished = false
  const result = load({
    initial: canonical(),
    routes: {
      '/starter/free-call-settings/get/v3': ({ state }) => {
        reads += 1
        if (reads > 1 && !postFinished) {
          return { ok: false, status: 503, json: async () => ({ message: 'temporarily unavailable' }) }
        }
        if (reads === 3) {
          return { ok: false, status: 503, json: async () => ({ message: 'temporarily unavailable' }) }
        }
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/free-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({ revision: 5 })
          setState(canonical({
            public_description: body.description,
            services: [saved],
            readiness: { free_call_enabled: true, bookable: true },
          }))
          postFinished = true
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Free Call'
  result.dom.yes.checked = true
  await result.dom.yes.dispatch('change')
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const authTransition = result.notifyAuthChange(null)
  await settle()
  assert.equal(result.dom.title.value, 'Updated Free Call')

  finishPost.resolve()
  await authTransition
  await settle()

  assert.equal(result.dom.title.value, 'Updated Free Call')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')
  assert.equal(result.dom.yes.checked, true)
  assert.equal(result.dom.save.getAttribute('data-call-settings-busy'), 'false')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').style.display, 'none')
  assert.equal(reads, 3)

  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.calls.filter(
    (call) => call.path === '/starter/free-call-settings/upsert/v3',
  ).length, 2)
})

test('a prerequisite event queues behind Free write auth recovery', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  let reads = 0
  const result = load({
    initial: canonical({
      public_description: 'Original Free Call',
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/get/v3': ({ state }) => {
        reads += 1
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/free-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({ revision: 5 })
          setState(canonical({
            public_description: body.description,
            services: [saved],
            readiness: { free_call_enabled: true, bookable: true },
          }))
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Free Call'
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const authTransition = result.notifyAuthChange(null)
  await settle()
  await result.dispatchWindowEvent('starterSchedulingConnectionStateChanged')
  assert.equal(reads, 1)

  finishPost.resolve()
  await authTransition
  await settle()

  assert.equal(result.dom.title.value, 'Updated Free Call')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')
  assert.equal(reads, 3)
})

test('a queued prerequisite event does not erase a failed Free write error', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  let reads = 0
  const active = canonical({
    public_description: 'Original Free Call',
    services: [service()],
    readiness: { free_call_enabled: true, bookable: true },
  })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/get/v3': () => {
        reads += 1
        return { ok: true, status: 200, json: async () => active }
      },
      '/starter/free-call-settings/upsert/v3': () => {
        postStarted.resolve()
        return finishPost.promise
      },
    },
  })
  await settle()

  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await postStarted.promise
  await result.dispatchWindowEvent('starterSchedulingConnectionStateChanged')
  assert.equal(reads, 1)

  finishPost.resolve({
    ok: false,
    status: 400,
    json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
  })
  await settle()

  assert.equal(reads, 1)
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'error')
  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(result.dom.nativeError.getAttribute('data-call-settings-error-visible'), 'true')
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Resolve in-flight bookings before updating this service',
  )
})

test('a null auth notice does not leave a failed Free write busy or erase its error', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  const active = canonical({
    public_description: 'Original Free Call',
    services: [service()],
    readiness: { free_call_enabled: true, bookable: true },
  })
  const result = load({
    initial: active,
    routes: {
      '/starter/free-call-settings/get/v3': () => ({
        ok: true,
        status: 200,
        json: async () => active,
      }),
      '/starter/free-call-settings/upsert/v3': () => {
        postStarted.resolve()
        return finishPost.promise
      },
    },
  })
  await settle()

  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const authTransition = result.notifyAuthChange(null)
  finishPost.resolve({
    ok: false,
    status: 400,
    json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
  })
  await authTransition
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'error')
  assert.equal(result.dom.save.getAttribute('data-call-settings-busy'), 'false')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').style.display, 'none')
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Resolve in-flight bookings before updating this service',
  )
})

test('logout supersedes pending Free write revalidation', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  const transitionStarted = deferred()
  const failTransition = deferred()
  let reads = 0
  const result = load({
    initial: canonical({
      public_description: 'Original Free Call',
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/get/v3': ({ state }) => {
        reads += 1
        if (reads === 3) {
          transitionStarted.resolve()
          return failTransition.promise
        }
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/free-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({ revision: 5 })
          setState(canonical({
            public_description: body.description,
            services: [saved],
            readiness: { free_call_enabled: true, bookable: true },
          }))
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Free Call'
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const staleTransition = result.notifyAuthChange(null)
  await settle()
  finishPost.resolve()
  await transitionStarted.promise
  result.expireMember()
  await result.notifyAuthChange(null)
  failTransition.resolve({
    ok: false,
    status: 503,
    json: async () => ({ message: 'temporarily unavailable' }),
  })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'false')
  assert.equal(result.dom.status.textContent, 'Sign in to manage free calls.')
})

test('account switch supersedes pending Free write revalidation', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  const transitionStarted = deferred()
  const failTransition = deferred()
  let memberAReads = 0
  const result = load({
    initial: canonical({
      services: [service()],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/get/v3': ({ member, state }) => {
        if (member.id === 'member-free-b') {
          return {
            ok: true,
            status: 200,
            json: async () => canonical({
              public_description: 'Member B Free Call',
              services: [service({ config_id: 'cfg-free-b', title: 'Member B Free Call' })],
            }),
          }
        }
        memberAReads += 1
        if (memberAReads === 3) {
          transitionStarted.resolve()
          return failTransition.promise
        }
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/free-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({ revision: 5 })
          setState(canonical({
            public_description: body.description,
            services: [saved],
            readiness: { free_call_enabled: true, bookable: true },
          }))
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Free Call'
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const staleTransition = result.notifyAuthChange(null)
  await settle()
  finishPost.resolve()
  await transitionStarted.promise
  await result.changeMember({ id: 'member-free-b' })
  failTransition.resolve({
    ok: false,
    status: 503,
    json: async () => ({ message: 'temporarily unavailable' }),
  })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, 'Member B Free Call')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')
})

test('a stale Free same-member revalidation cannot repaint after logout', async () => {
  const staleMember = deferred()
  const result = load({
    initial: canonical({
      public_description: 'Member A Free Call',
      services: [service({ title: 'Member A Free Call' })],
    }),
  })
  await settle()

  result.setCurrentMemberReader(() => staleMember.promise)
  const staleTransition = result.notifyAuthChange(null)
  assert.equal(result.dom.title.value, 'Member A Free Call')

  result.expireMember()
  result.setCurrentMemberReader(() => null)
  await result.notifyAuthChange(null)
  staleMember.resolve({ id: 'member-free-a' })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'false')
  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'true')
  assert.equal(result.dom.status.textContent, 'Sign in to manage free calls.')
})

test('a newer Free account switch supersedes pending empty-auth revalidation', async () => {
  const staleMember = deferred()
  const result = load({
    routes: {
      '/starter/free-call-settings/get/v3': ({ member }) => ({
        ok: true,
        status: 200,
        json: async () => canonical({
          public_description: member.id === 'member-free-b' ? 'Member B Free Call' : 'Member A Free Call',
          services: [service({
            config_id: member.id === 'member-free-b' ? 'cfg-free-b' : 'cfg-free-a',
            title: member.id === 'member-free-b' ? 'Member B Free Call' : 'Member A Free Call',
          })],
        }),
      }),
    },
  })
  await settle()

  result.setCurrentMemberReader(() => staleMember.promise)
  const staleTransition = result.notifyAuthChange(null)
  result.setCurrentMemberReader(() => ({ id: 'member-free-b' }))
  await result.changeMember({ id: 'member-free-b' })
  staleMember.resolve({ id: 'member-free-a' })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, 'Member B Free Call')
  assert.equal(result.dom.yes.checked, true)
  assert.equal(result.dom.root.getAttribute('data-free-call-enabled'), 'true')
})

test('a connection-state refresh repaints canonically and survives a transient failure', async () => {
  let failNextRead = false
  const result = load({
    initial: canonical({
      public_description: 'Member A Free Call',
      services: [service({ title: 'Member A Free Call' })],
      readiness: { free_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/free-call-settings/get/v3': ({ state }) => {
        if (failNextRead) {
          failNextRead = false
          return { ok: false, status: 503, json: async () => ({ message: 'temporarily unavailable' }) }
        }
        return { ok: true, status: 200, json: async () => state }
      },
    },
  })
  await settle()
  await result.dom.open.dispatch('click')

  await result.dispatchWindowEvent('starterSchedulingConnectionStateChanged')
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
  assert.equal(result.dom.title.value, 'Member A Free Call')
  assert.equal(result.dom.root.getAttribute('data-free-call-editor-open'), 'true')
  assert.deepEqual(
    result.dom.prerequisites.map((row) => row.getAttribute('data-ready')),
    ['true', 'true', 'true', 'true'],
  )

  failNextRead = true
  await result.dispatchWindowEvent('starterSchedulingConnectionStateChanged')
  await settle()
  assert.equal(
    result.dom.status.textContent,
    'Free-call readiness could not be refreshed. Your account was not changed.',
  )
  assert.notEqual(result.dom.status.textContent, 'Sign in to manage free calls.')

  await result.dispatchWindowEvent('starterSchedulingConnectionStateChanged')
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-free-call-settings'), 'ready')
  assert.equal(result.dom.title.value, 'Member A Free Call')
  assert.equal(
    result.calls.filter((call) => call.path === '/starter/free-call-settings/get/v3').length,
    4,
  )
})
