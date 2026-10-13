const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./scheduling-availability-writer.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
const ACTIVE_CALLS_COPY =
  'You have Requested or Confirmed calls on your current calendar. Decline or cancel them, or wait until they end, then try again.'
const GENERIC_TRANSITION_COPY =
  "We couldn't complete that calendar change. Please try again or contact support."

/* ------------------------------------------------------------------ */
/* Minimal DOM                                                         */
/* ------------------------------------------------------------------ */

class El {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase()
    this.attributes = {}
    this.dataset = {}
    this.children = []
    this.parentElement = null
    this.style = {}
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.disabled = false
    this._classes = new Set()
    this._listeners = new Map()
    const self = this
    this.classList = {
      add: (c) => self._classes.add(c),
      remove: (c) => self._classes.delete(c),
      contains: (c) => self._classes.has(c),
    }
    for (const [name, value] of Object.entries(attrs)) {
      this.setAttribute(name, value)
    }
  }

  get type() {
    return this.attributes.type || ''
  }

  get name() {
    return this.attributes.name || ''
  }

  get previousElementSibling() {
    if (!this.parentElement) return null
    const index = this.parentElement.children.indexOf(this)
    return index > 0 ? this.parentElement.children[index - 1] : null
  }

  set innerHTML(value) {
    if (value === '') this.children = []
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'class') {
      this._classes = new Set(String(value).split(' ').filter(Boolean))
    }
    if (name.startsWith('data-')) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (m, c) => c.toUpperCase())
      this.dataset[key] = String(value)
    }
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }

  hasAttribute(name) {
    return name in this.attributes
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  remove() {
    if (!this.parentElement) return
    const index = this.parentElement.children.indexOf(this)
    if (index > -1) this.parentElement.children.splice(index, 1)
    this.parentElement = null
  }

  cloneNode() {
    const copy = new El(this.tagName.toLowerCase())
    copy.attributes = { ...this.attributes }
    copy.dataset = { ...this.dataset }
    copy._classes = new Set(this._classes)
    copy.textContent = this.textContent
    copy.value = this.value
    for (const child of this.children) copy.appendChild(child.cloneNode())
    return copy
  }

  addEventListener(name, listener) {
    if (!this._listeners.has(name)) this._listeners.set(name, [])
    this._listeners.get(name).push(listener)
  }

  dispatchEvent(event) {
    for (const listener of this._listeners.get(event.type) || []) listener(event)
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this })
  }

  * walk() {
    for (const child of this.children) {
      yield child
      yield* child.walk()
    }
  }

  closest(selector) {
    let el = this
    while (el) {
      if (matchesCompound(el, selector.trim())) return el
      el = el.parentElement
    }
    return null
  }

  querySelectorAll(selector) {
    const results = []
    for (const part of selector.split(',')) {
      for (const el of this.walk()) {
        if (matchesSelector(el, part.trim()) && results.indexOf(el) === -1) {
          results.push(el)
        }
      }
    }
    return results
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function matchesCompound(el, compound) {
  const parts = compound.match(/\[[^\]]+\]|#[\w-]+|\.[\w-]+|^[a-zA-Z][\w-]*/g) || []
  return parts.every((part) => {
    if (part.startsWith('[')) {
      const inner = part.slice(1, -1)
      const eq = inner.indexOf('=')
      if (eq === -1) return el.hasAttribute(inner)
      const name = inner.slice(0, eq)
      const value = inner.slice(eq + 1).replace(/^["']|["']$/g, '')
      return el.getAttribute(name) === value
    }
    if (part.startsWith('#')) return el.getAttribute('id') === part.slice(1)
    if (part.startsWith('.')) return el.classList.contains(part.slice(1))
    return el.tagName.toLowerCase() === part.toLowerCase()
  })
}

function matchesSelector(el, selector) {
  const compounds = selector.split(/\s+/)
  if (!matchesCompound(el, compounds[compounds.length - 1])) return false
  let index = compounds.length - 2
  let ancestor = el.parentElement
  while (index >= 0 && ancestor) {
    if (matchesCompound(ancestor, compounds[index])) index -= 1
    ancestor = ancestor.parentElement
  }
  return index < 0
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

// All 11 step wrappers present in the published Booking-stage modal
// (dialog[data-modal-target="set-availability"], audited 2026-07-21).
const STEP_NAMES = [
  'setup-form',
  'default',
  'how-to-manage',
  'virtual-connect',
  'success',
  'success-calendar',
  'success-disconnect',
  'disconnect-calendar',
  'config-request-error',
  'pre-redirect',
  'reload-page',
]

function buildDom(options) {
  const root = new El('body')
  const steps = {}
  for (const name of STEP_NAMES) {
    const step = new El('div', { 'availability-step': name })
    step.appendChild(new El('div', { 'data-custom-loader': '' }))
    steps[name] = step
    root.appendChild(step)
  }

  // The writer uses `[error-text-element]` when it is a plain text leaf and
  // otherwise leaves the Designer-authored generic error step intact.
  let errorText = null
  if (!options.withoutErrorTextElement) {
    errorText = new El('div', { 'error-text-element': '' })
    errorText.textContent =
      "We couldn't complete that calendar change. Please try again or contact support."
    if (options.nestedErrorTextMarkup) {
      // Designer may author the copy beside an inline icon. Real DOM semantics
      // apply on this node: assigning textContent discards every child, so the
      // writer must leave it alone instead of flattening the authored subtree.
      let text = errorText.textContent
      Object.defineProperty(errorText, 'textContent', {
        get() { return text },
        set(value) {
          text = String(value)
          errorText.children = []
        },
      })
      const icon = new El('span', { class: 'error-icon' })
      const copy = new El('span', { class: 'error-copy' })
      copy.textContent = text
      errorText.appendChild(icon)
      errorText.appendChild(copy)
    }
    steps['config-request-error'].appendChild(errorText)
  }

  let form = null
  const fields = { days: [] }
  if (!options.withoutForm) {
    form = new El('form', { 'availability-form': '' })
    for (let i = 0; i < 3; i++) {
      const group = new El('div', { 'set-availability-group': '' })
      const day = new El('input', { type: 'checkbox', name: 'avail-day' })
      group.appendChild(day)
      form.appendChild(group)
      fields.days.push(day)
    }
    const startGroup = new El('div', { 'set-availability-group': '' })
    fields.start = new El('input', { name: 'start-time' })
    startGroup.appendChild(fields.start)
    form.appendChild(startGroup)
    const endGroup = new El('div', { 'set-availability-group': '' })
    fields.end = new El('input', { name: 'end-time' })
    endGroup.appendChild(fields.end)
    form.appendChild(endGroup)
    steps['setup-form'].appendChild(form)
  }

  const buttons = {}
  buttons.submit = new El('a', { 'availability-action-btn': 'submit' })
  buttons.submit.appendChild(new El('span', { 'btn-text': '' }))
  steps['setup-form'].appendChild(buttons.submit)

  buttons.managerSubmit = new El('a', { 'availability-action-btn': 'manager-submit' })
  const managerSubmitText = new El('span', { class: 'button_main-text' })
  managerSubmitText.textContent = 'Confirm'
  buttons.managerSubmit.appendChild(managerSubmitText)
  steps['how-to-manage'].appendChild(buttons.managerSubmit)

  buttons.preRedirect = new El('a', { 'availability-action-btn': 'pre-redirect' })
  const preRedirectButtonText = new El('span', { class: 'button_main-text' })
  preRedirectButtonText.textContent = 'Done'
  buttons.preRedirect.appendChild(preRedirectButtonText)

  const savedHeadline = new El('div', { class: 'set-availability_success-headline' })
  const savedTitle = new El('p', { class: 'heading-style-h1' })
  savedTitle.textContent = 'Availability saved'
  const savedBody = new El('p')
  savedBody.textContent = 'Legacy saved copy'
  savedHeadline.appendChild(savedTitle)
  savedHeadline.appendChild(savedBody)
  const connectHeadline = new El('div', { class: 'set-availability_success-headline' })
  const connectTitle = new El('p', { class: 'heading-style-h1' })
  connectTitle.textContent = 'Redirecting to calendar...'
  const connectBody = new El('p')
  connectBody.textContent = 'Legacy redirect copy'
  connectHeadline.appendChild(connectTitle)
  connectHeadline.appendChild(connectBody)
  steps['success-calendar'].appendChild(savedHeadline)
  steps['success-calendar'].appendChild(connectHeadline)
  steps['success-calendar'].appendChild(buttons.preRedirect)

  const redirectHeadline = new El('div', { class: 'set-availability_success-headline' })
  const redirectTitle = new El('p', { class: 'heading-style-h1' })
  redirectTitle.textContent = 'Connecting calendar...'
  const redirectBody = new El('p')
  redirectBody.textContent = 'Legacy connecting copy'
  redirectHeadline.appendChild(redirectTitle)
  redirectHeadline.appendChild(redirectBody)
  steps['pre-redirect'].appendChild(redirectHeadline)

  // Mirrors the published markup: the calendar change-manager-link doubles as
  // the disconnect-confirm navigation into the disconnect-calendar step.
  buttons.disconnectConfirm = new El('div', {
    'availability-action-btn': 'disconnect-confirm',
    'data-to': 'disconnect-calendar',
  })
  steps.default.appendChild(buttons.disconnectConfirm)
  buttons.disconnectCalendar = new El('div', {
    'availability-action-btn': 'disconnect-calendar',
  })
  steps['disconnect-calendar'].appendChild(buttons.disconnectCalendar)

  const managers = {
    platform: new El('div', { 'config-manager': '', 'data-type': 'platform' }),
    calendar: new El('div', { 'config-manager': '', 'data-type': 'calendar' }),
  }
  const platformTitle = new El('p')
  platformTitle.textContent = 'Use platform availability'
  const platformBody = new El('p')
  platformBody.textContent = 'Legacy platform copy'
  managers.platform.appendChild(platformTitle)
  managers.platform.appendChild(platformBody)
  const calendarTitle = new El('p')
  calendarTitle.textContent = 'Connect your calendar'
  const calendarBody = new El('p')
  calendarBody.textContent = 'Sync with Google or Outlook'
  managers.calendar.appendChild(calendarTitle)
  managers.calendar.appendChild(calendarBody)
  root.appendChild(managers.platform)
  root.appendChild(managers.calendar)
  root.appendChild(new El('div', { 'config-manager-element': '' }))
  root.appendChild(new El('div', { 'change-manager-link': '', 'data-type': 'platform' }))
  root.appendChild(new El('div', { 'change-manager-link': '', 'data-type': 'calendar' }))
  root.appendChild(new El('div', { 'bookings-wrapper': '' }))
  const popupClose = new El('div', { 'availability-popup-close': '' })
  root.appendChild(popupClose)
  root.appendChild(new El('div', { 'config-initial-element': '' }))
  root.appendChild(new El('div', { 'config-initial-element': 'general' }))
  root.appendChild(new El('div', { 'config-initial-element': 'setup-form' }))

  const template = new El('div', { 'availability-template': '' })
  template.style.display = options.templateDisplay
  template.appendChild(new El('div', { 'availability-title': '' }))
  template.appendChild(new El('div', { 'availability-days': '' }))
  template.appendChild(new El('div', { 'availability-time': '' }))
  template.appendChild(new El('div', { 'availability-type': '' }))
  root.appendChild(template)
  const list = new El('div', { 'availability-list': '' })
  root.appendChild(list)

  return { root, steps, form, fields, buttons, managers, list, popupClose, errorText }
}

// Deliberately WITHOUT nylas-* custom fields: the Memberstack mirror is not
// writable for Test-Data members, so the writer must source grant state from
// the scheduling row (get_by_memberstack) instead.
const MEMBER_A = () => ({
  id: 'member-a',
  customFields: {
    'free-user': 'Test',
    'last-name': 'Starter',
  },
})

function defaultAvailability() {
  return {
    items: {
      general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] },
    },
    manager: 'platform',
  }
}

function defaultRoutes(overridesMap = {}) {
  const routes = {
    '/starter/update_availability/v3': () => ({ status: 200, body: { id: 1 } }),
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: defaultAvailability(),
        nylas_grant_id: 'grant-1',
        nylas_grant_email: 'grant@example.com',
        nylas_calendar_id: 'cal-1',
        calendar_binding_version: null,
      },
    }),
    '/starter/set_timezone/v3': () => ({ status: 200, body: { timezone: 'Asia/Manila' } }),
    '/starter/clear_calendar_data/v3': () => ({ status: 200, body: { id: 1 } }),
    '/starter/paid-call-settings/get/v3': () => ({
      status: 200,
      body: { readiness: { paid_call_enabled: false }, services: [] },
    }),
    '/nylas_configurations/get_all/v3': () => ({
      status: 200,
      body: [
        { config_id: 'cfg-free', grant_id: 'grant-1', duration: 30, is_paid: false, active: true },
        { config_id: 'cfg-paid', grant_id: 'grant-1', duration: 60, is_paid: true, active: true },
      ],
    }),
    '/scheduler/configurations/create/v3': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/scheduler/configurations/update/v3': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/scheduler/configurations/delete/v3': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/grants/oauth/v3': () => ({
      status: 200,
      body: { response: { result: { data: { url: 'https://nylas.example/oauth' } } } },
    }),
    '/grants/create_virtual_account/v3': () => ({
      status: 200,
      body: { response: { result: { data: { id: 'vgrant-1', email: 'virtual@example.com' } } } },
    }),
    '/grants/add_virtual/v3': () => ({ status: 200, body: { id: 5 } }),
    '/grants/add/v3': () => ({
      status: 200,
      body: { grant_id: 'grant-9', email: 'g@example.com', calendar_id: 'g@example.com' },
    }),
    '/grants/create_virtual_calendar/v3': () => ({
      status: 200,
      body: { response: { result: { data: { id: 'vcal-1' } } } },
    }),
    '/grants/delete/v3': () => ({
      status: 200,
      body: {
        connected: false,
        already_disconnected: false,
        availability: {},
        deleted_configuration_ids: [],
        provider_response: { status: 200 },
      },
    }),
  }
  return { ...routes, ...overridesMap }
}

function loadWriter(options = {}) {
  const dom = buildDom(options)
  const timers = []
  const calls = []
  const opened = []
  const assigned = []
  const historyCalls = []
  const events = []
  const warnings = []
  const storage = new Map(Object.entries(options.storage || {}))
  const sessionStorage = new Map(Object.entries(options.sessionStorage || {}))

  const member = options.member === undefined ? MEMBER_A() : options.member
  let activeMember = member
  const harness = {
    setActiveMember(next) {
      activeMember = next
    },
  }

  const routes = defaultRoutes(options.routes || {})
  const xanoAuthFetch =
    options.withoutAuthFetch === true
      ? undefined
      : async (url, init) => {
          const path = url.replace(API_BASE, '')
          const body = init.body ? JSON.parse(init.body) : undefined
          calls.push({ path, method: init.method, body })
          const route = routes[path]
          if (!route) throw new Error('unrouted path ' + path)
          const result = route(body)
          return {
            ok: result.status >= 200 && result.status < 300,
            status: result.status,
            json: async () => result.body,
          }
        }

  const documentElement = new El('html')
  if (options.testMemberOverride) {
    documentElement.setAttribute('data-scheduling-test-member', 'true')
  }

  const document = {
    readyState: 'complete',
    title: 'Booking stage',
    documentElement,
    addEventListener(name, listener) {
      if (!document._listeners.has(name)) document._listeners.set(name, [])
      document._listeners.get(name).push(listener)
    },
    _listeners: new Map(),
    querySelector: (selector) => dom.root.querySelector(selector),
    querySelectorAll: (selector) => dom.root.querySelectorAll(selector),
  }

  const window = {
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      search: options.search || '',
      pathname: options.pathname || '/starter-dashboard---availability-stage',
      origin: options.origin || 'https://the-starters-3-0.webflow.io',
      assign: (url) => assigned.push(url),
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    sessionStorage: {
      getItem: (key) => (sessionStorage.has(key) ? sessionStorage.get(key) : null),
      setItem: (key, value) => sessionStorage.set(key, String(value)),
      removeItem: (key) => sessionStorage.delete(key),
    },
    history: {
      replaceState: (...args) => historyCalls.push(args),
    },
    open: (url, target) => opened.push({ url, target }),
    addEventListener() {},
    dispatchEvent: (event) => events.push(event),
    $memberstackDom: {
      getCurrentMember: async () => ({ data: activeMember }),
    },
    MEMBER: { auth: { email: 'member@example.com' } },
    STARTER_AVAILABILITY:
      options.availability === undefined ? defaultAvailability() : options.availability,
    xanoAuthFetch,
    clearGrantData: options.clearGrantData,
    generateBookingsList: options.generateBookingsList,
  }

  class CustomEvent {
    constructor(name, init) {
      this.type = name
      this.detail = init && init.detail
    }
  }
  class MouseEvent {
    constructor(name) {
      this.type = name
    }
  }

  vm.runInNewContext(source, {
    CustomEvent,
    MouseEvent,
    URLSearchParams,
    Intl,
    crypto: { randomUUID: () => 'uuid-fixed' },
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
    console: {
      warn: (...args) => warnings.push(args.join(' ')),
      info() {},
      log() {},
    },
    document,
    window,
  })

  function status() {
    return documentElement.getAttribute('data-scheduling-availability-writer')
  }

  function clickAction(btn) {
    for (const listener of document._listeners.get('click') || []) {
      listener({ target: btn, preventDefault() {}, stopPropagation() {} })
    }
  }

  function flushTimers(maxDelay = Infinity) {
    const due = timers.filter((t) => t.delay <= maxDelay)
    timers.length = 0
    for (const t of due) t.fn()
  }

  return {
    calls,
    assigned,
    clickAction,
    dom,
    events,
    flushTimers,
    harness,
    historyCalls,
    opened,
    sessionStorage,
    status,
    storage,
    timers,
    warnings,
    window,
  }
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise(setImmediate)
}

const TZ_CACHED = { 'starter-timezone:member-a': 'Asia/Manila' }

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

test('does not install on an unapproved production path', () => {
  const result = loadWriter({
    hostname: 'www.thestarters.com',
    pathname: '/brand-dashboard',
  })
  assert.equal(result.window.StarterSchedulingAvailabilityWriter, undefined)
  assert.equal(result.status(), null)
})

test('installs on the canonical Starter dashboard across both production hosts', () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const result = loadWriter({ hostname, pathname: '/starter-dashboard' })
    assert.equal(typeof result.window.StarterSchedulingAvailabilityWriter.initialize, 'function')
  }
})

test('marks pages without an availability form as not applicable', async () => {
  const result = loadWriter({ withoutForm: true })
  await settle()
  assert.equal(result.status(), 'not-applicable')
})

test('is disabled without xanoAuthFetch instead of writing unauthenticated', async () => {
  const result = loadWriter({ withoutAuthFetch: true, storage: TZ_CACHED })
  await settle()
  assert.equal(result.status(), 'missing-auth')
  assert.equal(result.calls.length, 0)
})

test('stays read-only while the test_member_id override renders another member', async () => {
  const result = loadWriter({ testMemberOverride: true, storage: TZ_CACHED })
  await settle()
  assert.equal(result.status(), 'blocked-test-member')
  assert.equal(result.calls.length, 0)

  result.clickAction(result.dom.buttons.submit)
  await settle()
  assert.equal(result.calls.length, 0)
})

test('bootstraps a saved schedule: ready state, configs read, cards rendered', async () => {
  const result = loadWriter({ storage: TZ_CACHED, templateDisplay: 'flex' })
  await settle()

  assert.equal(result.status(), 'ready')
  const configsCall = result.calls.find((c) => c.path === '/nylas_configurations/get_all/v3')
  assert.deepEqual(configsCall.body, { grant_id: 'grant-1' })
  assert.equal(result.dom.list.children.length, 1)
  assert.equal(
    result.dom.list.children[0].querySelector('[availability-title]').textContent,
    'General Availability',
  )
  assert.equal(result.dom.root.querySelector('[availability-template]').hasAttribute('hidden'), true)
  assert.equal(result.dom.root.querySelector('[availability-template]').style.display, 'none')
  assert.equal(result.dom.list.children[0].hasAttribute('hidden'), false)
  assert.equal(result.dom.list.children[0].hasAttribute('aria-hidden'), false)
  assert.equal(result.dom.list.children[0].style.display, 'flex')
  assert.equal(
    result.dom.root.querySelector('[bookings-wrapper]').style.display,
    'flex',
  )
  assert.ok(result.events.some((e) => e.type === 'starterSchedulingWriterReady'))
  assert.equal(
    result.window.STARTER_SCHEDULING_CONNECTION.state,
    'connected',
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.window.STARTER_SCHEDULING_CONNECTION)),
    {
      state: 'connected',
      hasGrant: true,
      hasCalendar: true,
      configurationCount: 2,
      manager: 'platform',
      calendarBindingVersion: null,
    },
  )
  assert.ok(
    result.events.some(
      (event) =>
        event.type === 'starterSchedulingConnectionStateChanged' &&
        event.detail.state === 'connected',
    ),
  )
})

test('reports disconnected independently of saved availability', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: '',
          nylas_grant_email: '',
          nylas_calendar_id: '',
        },
      }),
    },
  })
  await settle()

  assert.equal(result.status(), 'ready')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'disconnected')
  assert.equal(
    result.calls.filter((call) => call.path === '/nylas_configurations/get_all/v3').length,
    0,
  )
})

test('reports reconnect for partial canonical provider state', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-partial',
          nylas_grant_email: '',
          nylas_calendar_id: '',
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  assert.equal(result.status(), 'ready')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'reconnect')
})

test('boots connected for a versioned binding with no active offers', async () => {
  const availability = defaultAvailability()
  availability.manager = 'platform'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
          calendar_binding_version: 1,
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  assert.equal(result.status(), 'ready')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
})

test('versioned zero-offer binding without a grant email remains reconnect', async () => {
  const availability = defaultAvailability()
  availability.manager = 'platform'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: '',
          nylas_calendar_id: 'cal-1',
          calendar_binding_version: 1,
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  assert.equal(result.status(), 'ready')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'reconnect')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.hasGrant, true)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.hasCalendar, true)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
})

test('legacy zero-config binding without a version marker remains reconnect', async () => {
  const availability = defaultAvailability()
  availability.manager = 'platform'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
          calendar_binding_version: null,
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  assert.equal(result.status(), 'ready')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'reconnect')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, null)
})

test('availability save keeps a versioned zero-offer binding empty', async () => {
  const availability = defaultAvailability()
  availability.manager = 'platform'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
          calendar_binding_version: 1,
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/update/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 1)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
})

test('availability remove keeps a versioned zero-offer binding empty', async () => {
  const availability = defaultAvailability()
  availability.manager = 'platform'
  availability.items.general.days = [1, 2]
  availability.items['ov-1'] = { days: [3], start: '13:00', end: '15:00' }
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
          calendar_binding_version: 1,
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  const item = new El('div', { 'availability-item': '' })
  item.dataset.id = 'ov-1'
  const removeBtn = new El('a', { 'availability-action-btn': 'availability-remove' })
  item.appendChild(removeBtn)
  result.dom.root.appendChild(item)
  result.clickAction(removeBtn)
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/update/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 1)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
})

test('fails closed when canonical configuration state cannot be read', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/nylas_configurations/get_all/v3': () => ({
        status: 503,
        body: { message: 'temporarily unavailable' },
      }),
    },
  })
  await settle()

  assert.equal(result.status(), 'error')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.ok(
    result.events.some(
      (event) =>
        event.type === 'starterSchedulingConnectionStateChanged' &&
        event.detail.state === 'error',
    ),
  )
})

test('first-time setup shows initial elements and keeps bookings hidden', async () => {
  const result = loadWriter({
    availability: { items: {}, manager: null },
    storage: TZ_CACHED,
  })
  await settle()

  assert.equal(result.status(), 'ready')
  for (const el of result.dom.root.querySelectorAll('[config-initial-element]')) {
    assert.equal(el.style.display, 'flex')
  }
  assert.equal(result.dom.root.querySelector('[bookings-wrapper]').style.display, 'none')
})

test('existing schedule without a manager opens the how-to-manage step', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({ availability, storage: TZ_CACHED })
  await settle()

  assert.equal(result.dom.steps['how-to-manage'].style.display, 'block')
  assert.equal(result.dom.root.querySelector('[bookings-wrapper]').style.display, 'none')
})

test('form submit writes the authenticated member id and reaches the success step', async () => {
  let canonicalAvailability = defaultAvailability()
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/starter/update_availability/v3': (body) => {
        canonicalAvailability = body.availability
        return { status: 200, body: { id: 1 } }
      },
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: canonicalAvailability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
    },
  })
  await settle()

  result.dom.fields.days[1].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(update.body.member_id, 'member-a')
  assert.equal(update.body.in_timezone, 'Asia/Manila')
  assert.deepEqual(update.body.availability.items.general.days, [1])
  assert.equal(update.body.availability.items.general.start, '10:00')

  const configUpdates = result.calls.filter(
    (c) => c.path === '/scheduler/configurations/update/v3',
  )
  assert.equal(configUpdates.length, 2)
  assert.deepEqual(
    configUpdates.map((c) => c.body.config_id).sort(),
    ['cfg-free', 'cfg-paid'],
  )
  for (const c of configUpdates) assert.equal(c.body.grant_id, 'grant-1')

  assert.equal(result.dom.steps.success.style.display, 'block')
  const cache = JSON.parse(result.storage.get('starter-scheduling-availability:member-a'))
  assert.deepEqual(cache.availability.items.general.days, [1])
  assert.ok(result.events.some((e) => e.type === 'starterSchedulingWriteSuccess'))
})

test('editing an override restores its previous default day and omits an empty provider window', async () => {
  const availability = {
    items: {
      general: { days: [2], start: '09:00', end: '17:00', defaultDays: [1, 2] },
      'ov-1': { days: [1], start: '13:00', end: '15:00' },
    },
    manager: 'platform',
  }
  let canonicalAvailability = availability
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/update_availability/v3': (body) => {
        canonicalAvailability = body.availability
        return { status: 200, body: { id: 1 } }
      },
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: canonicalAvailability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
    },
  })
  await settle()

  const item = new El('div', { 'availability-item': '' })
  item.dataset.id = 'ov-1'
  const editBtn = new El('a', { 'availability-action-btn': 'availability-edit' })
  item.appendChild(editBtn)
  result.dom.root.appendChild(item)
  result.clickAction(editBtn)
  result.dom.fields.days.forEach((day) => { day.checked = false })
  result.dom.fields.days[2].checked = true
  result.dom.fields.start.value = '13:00'
  result.dom.fields.end.value = '15:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  const update = result.calls.find((call) => call.path === '/starter/update_availability/v3')
  assert.deepEqual(update.body.availability.items.general.days, [1])
  assert.deepEqual(update.body.availability.items['ov-1'].days, [2])
  const configUpdate = result.calls.find((call) => call.path === '/scheduler/configurations/update/v3')
  const providerHours = configUpdate.body.in_availability.availability_rules.default_open_hours
  assert.equal(providerHours.some((window) => window.days.length === 0), false)
  assert.deepEqual(providerHours.map((window) => window.days), [[1], [2]])
})

test('failed canonical override save restores the mirrored model and cards', async () => {
  const availability = {
    items: {
      general: { days: [2], start: '09:00', end: '17:00', defaultDays: [1, 2] },
      'ov-1': { days: [1], start: '13:00', end: '15:00' },
    },
    manager: 'platform',
  }
  const expectedAvailability = JSON.parse(JSON.stringify(availability))
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/update_availability/v3': () => ({ status: 500, body: { message: 'rejected' } }),
    },
  })
  await settle()

  const item = new El('div', { 'availability-item': '' })
  item.dataset.id = 'ov-1'
  const editBtn = new El('a', { 'availability-action-btn': 'availability-edit' })
  item.appendChild(editBtn)
  result.dom.root.appendChild(item)
  result.clickAction(editBtn)
  result.dom.fields.days.forEach((day) => { day.checked = false })
  result.dom.fields.days[2].checked = true
  result.dom.fields.start.value = '13:00'
  result.dom.fields.end.value = '15:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(JSON.stringify(result.window.STARTER_AVAILABILITY), JSON.stringify(expectedAvailability))
  assert.deepEqual(result.dom.list.children.map((card) => card.dataset.id), ['general', 'ov-1'])
  assert.equal(result.calls.some((call) => call.path === '/scheduler/configurations/update/v3'), false)
})

test('form submit accepts provider 2xx statuses for configuration updates', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/scheduler/configurations/update/v3': () => ({
        status: 200,
        body: { response: { status: 204 } },
      }),
    },
  })
  await settle()

  result.dom.fields.days[1].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(result.dom.steps.success.style.display, 'block')
  assert.notEqual(result.dom.steps['config-request-error'].style.display, 'block')
})

test('form submit recreates a free configuration when every canonical config is inactive', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: [
          { config_id: 'cfg-free-old', grant_id: 'grant-1', duration: 30, is_paid: false, active: false },
          { config_id: 'cfg-paid-old', grant_id: 'grant-1', duration: 60, is_paid: true, active: false },
        ],
      }),
      '/scheduler/configurations/create/v3': () => ({
        status: 200,
        body: { response: { status: 201 } },
      }),
    },
  })
  await settle()

  result.dom.fields.days[1].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(
    result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length,
    1,
  )
  assert.notEqual(result.dom.steps['config-request-error'].style.display, 'block')
})

test('shows and hides the step loader around a submit', async () => {
  let releaseUpdate
  const gate = new Promise((resolve) => {
    releaseUpdate = resolve
  })
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/starter/update_availability/v3': () => {
        releaseUpdate({ ok: true })
        return { status: 200, body: { id: 1 } }
      },
    },
  })
  await settle()

  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  const loader = result.dom.steps['setup-form'].querySelector('[data-custom-loader]')
  result.clickAction(result.dom.buttons.submit)
  assert.match(loader.getAttribute('style'), /visibility: visible/)

  await gate
  await settle()
  assert.match(loader.getAttribute('style'), /visibility: hidden/)
})

test('invalid form input sends nothing', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()
  const before = result.calls.length

  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(result.calls.length, before)
})

test('refuses to write when the member session changed after bootstrap', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.harness.setActiveMember({ id: 'member-b', customFields: {} })
  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(
    result.calls.filter((c) => c.path === '/starter/update_availability/v3').length,
    0,
  )
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.ok(result.events.some((e) => e.type === 'starterSchedulingWriteError'))
})

test('choosing own-calendar starts OAuth while retaining the current default', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/starter/paid-call-settings/get/v3': () => ({
        status: 200,
        body: {
          readiness: { paid_call_enabled: true },
          services: [{
            config_id: 'paid-old',
            title: 'Paid Legacy Call',
            price_cents: 100050,
            duration: 90,
            active: true,
          }],
        },
      }),
    },
  })
  await settle()
  result.dom.managers.calendar.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 0)
  assert.equal(result.dom.steps['success-calendar'].style.display, 'none')
  assert.equal(result.dom.steps['pre-redirect'].style.display, 'block')
  assert.deepEqual(result.assigned, ['https://nylas.example/oauth'])
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  const intent = JSON.parse(result.sessionStorage.get('starter-scheduling-oauth-intent:member-a'))
  assert.equal(intent.preserveBookings, true)
  assert.equal(intent.replaceGrantId, 'grant-1')
  assert.equal(intent.paidCallIntent, null)
  assert.ok(intent.transitionId)
})

test('own-calendar never delegates disconnect ownership to clearGrantData', async () => {
  const composite = []
  const result = loadWriter({
    storage: TZ_CACHED,
    clearGrantData: async (memberId, grantId) => composite.push({ memberId, grantId }),
  })
  await settle()

  result.dom.managers.calendar.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  assert.deepEqual(composite, [])
  assert.equal(result.calls.filter((c) => c.path === '/grants/delete/v3').length, 0)
})


test('starting a calendar switch retains the current default and active calls until OAuth completes', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/grants/delete/v3': () => ({
        status: 400,
        body: { message: 'Resolve active bookings before disconnecting the calendar' },
      }),
    },
  })
  await settle()
  const originalAvailability = JSON.parse(JSON.stringify(result.window.STARTER_AVAILABILITY))

  result.dom.managers.calendar.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.deepEqual(result.assigned, ['https://nylas.example/oauth'])
  assert.deepEqual(JSON.parse(JSON.stringify(result.window.STARTER_AVAILABILITY)), originalAvailability)
})

test('choosing platform creates the virtual calendar chain and configs', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  let virtualPersisted = false
  let configCreated = false
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: {
            ...availability,
            manager: virtualPersisted ? 'platform' : null,
          },
          nylas_grant_id: virtualPersisted ? 'vgrant-1' : null,
          nylas_grant_email: virtualPersisted ? 'virtual@example.com' : null,
          nylas_calendar_id: virtualPersisted ? 'vcal-1' : null,
        },
      }),
      '/grants/add_virtual/v3': () => {
        virtualPersisted = true
        return { status: 200, body: { id: 5 } }
      },
      '/scheduler/configurations/create/v3': () => {
        configCreated = true
        return { status: 200, body: { response: { status: 200 } } }
      },
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: configCreated
          ? [{ config_id: 'cfg-free', grant_id: 'vgrant-1', is_paid: false }]
          : [],
      }),
    },
  })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  const paths = result.calls.map((c) => c.path)
  const accountIndex = paths.indexOf('/grants/create_virtual_account/v3')
  const addIndex = paths.indexOf('/grants/add_virtual/v3')
  const calendarIndex = paths.indexOf('/grants/create_virtual_calendar/v3')
  assert.ok(accountIndex > -1 && addIndex > accountIndex && calendarIndex > addIndex)

  const add = result.calls[addIndex]
  assert.deepEqual(add.body, { grant_id: 'vgrant-1', member_id: 'member-a' })

  // No paid-call rate is resolvable, so only the free config is created.
  const creates = result.calls.filter((c) => c.path === '/scheduler/configurations/create/v3')
  assert.equal(creates.length, 1)
  assert.match(creates[0].body.in_config_name, /^Free Consultation Call/)
  for (const create of creates) assert.equal(create.body.grant_id, 'vgrant-1')

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(update.body.availability.manager, 'platform')
  assert.equal(result.dom.steps.success.style.display, 'block')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  const canonicalReadIndex = paths.indexOf('/starter/get_by_memberstack/v3', calendarIndex + 1)
  const canonicalConfigIndex = paths.indexOf(
    '/nylas_configurations/get_all/v3',
    canonicalReadIndex + 1,
  )
  assert.ok(canonicalReadIndex > calendarIndex)
  assert.ok(canonicalConfigIndex > canonicalReadIndex)
})

test('platform setup failure shows config-request-error and writes nothing', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/grants/create_virtual_account/v3': () => ({ status: 500, body: { message: 'nope' } }),
    },
  })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  assert.equal(
    result.calls.filter((c) => c.path === '/starter/update_availability/v3').length,
    0,
  )
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
})

test('Google-to-Platform manager switch uses preserved server selection', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  let canonicalManager = 'calendar'
  let canonicalGrant = {
    id: 'grant-1',
    email: 'grant@example.com',
    calendarId: 'cal-1',
  }
  let calendarBindingVersion = null
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: { ...availability, manager: canonicalManager },
          nylas_grant_id: canonicalGrant && canonicalGrant.id,
          nylas_grant_email: canonicalGrant && canonicalGrant.email,
          nylas_calendar_id: canonicalGrant && canonicalGrant.calendarId,
          calendar_binding_version: calendarBindingVersion,
        },
      }),
      '/nylas_configurations/get_all/v3': (body) => ({
        status: 200,
        body:
          body.grant_id === 'platform-grant'
            ? [
                { config_id: 'cfg-free-new', grant_id: 'platform-grant', is_paid: false, active: true },
                { config_id: 'cfg-paid-new', grant_id: 'platform-grant', is_paid: true, active: true },
              ]
            : body.grant_id === 'grant-1'
              ? [
                  { config_id: 'cfg-free-old', grant_id: 'grant-1', is_paid: false, active: true },
                  { config_id: 'cfg-paid-old', grant_id: 'grant-1', is_paid: true, active: true },
                ]
              : [],
      }),
      '/grants/delete/v3': () => {
        return { status: 400, body: { message: 'RESOLVE ACTIVE BOOKINGS before disconnecting the calendar' } }
      },
      '/grants/create_virtual_account/v3': (body) => {
        canonicalManager = 'platform'
        canonicalGrant = {
          id: 'platform-grant',
          email: 'virtual@example.com',
          calendarId: 'platform-cal',
        }
        calendarBindingVersion = 1
        return {
          status: 200,
          body: {
            transition_id: body.in_transition_id,
            previous_grant_retained: true,
            replaced_grant_id: 'grant-1',
            grant_id: 'platform-grant',
            default_selected: true,
            services_ready: true,
            manager: 'platform',
            active_config_ids: ['cfg-free-new', 'cfg-paid-new'],
            active_service_count: 2,
          },
        }
      },
    },
  })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()
  await settle()

  const request = result.calls.find((call) => call.path === '/grants/create_virtual_account/v3')
  assert.deepEqual(request.body, {
    member_id: 'member-a',
    in_preserve_bookings: true,
    in_replace_grant_id: 'grant-1',
    in_transition_id: 'uuid-fixed',
  })
  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/add_virtual/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_calendar/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(canonicalManager, 'platform')
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  assert.equal(result.dom.steps.success.style.display, 'block')
  assert.equal(result.sessionStorage.has('starter-scheduling-platform-transition:member-a'), false)
  assert.equal(result.storage.has('prev-availability-manager'), false)
})

test('Google-to-Platform manager switch accepts a zero-offer preserved binding', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  let canonicalManager = 'calendar'
  let calendarBindingVersion = null
  let canonicalGrant = {
    id: 'grant-1',
    email: 'grant@example.com',
    calendarId: 'cal-1',
  }
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: { ...availability, manager: canonicalManager },
          nylas_grant_id: canonicalGrant.id,
          nylas_grant_email: canonicalGrant.email,
          nylas_calendar_id: canonicalGrant.calendarId,
          calendar_binding_version: calendarBindingVersion,
        },
      }),
      '/nylas_configurations/get_all/v3': (body) => ({
        status: 200,
        body: body.grant_id === 'platform-grant'
          ? []
          : [{ config_id: 'cfg-free-old', grant_id: 'grant-1', is_paid: false, active: true }],
      }),
      '/grants/create_virtual_account/v3': (body) => {
        canonicalManager = 'platform'
        canonicalGrant = {
          id: 'platform-grant',
          email: 'virtual@example.com',
          calendarId: 'platform-cal',
        }
        calendarBindingVersion = 1
        return {
          status: 200,
          body: {
            transition_id: body.in_transition_id,
            previous_grant_retained: true,
            replaced_grant_id: 'grant-1',
            grant_id: 'platform-grant',
            default_selected: true,
            services_ready: true,
            manager: 'platform',
            active_config_ids: [],
            active_service_count: 0,
          },
        }
      },
    },
  })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()
  await settle()

  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.sessionStorage.has('starter-scheduling-platform-transition:member-a'), false)
  assert.equal(result.storage.has('prev-availability-manager'), false)
})

test('failed preserved Platform selection retries with the same transition id', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  let canonicalManager = 'calendar'
  let canonicalGrant = {
    id: 'grant-1',
    email: 'grant@example.com',
    calendarId: 'cal-1',
  }
  let calendarBindingVersion = null
  let attempts = 0
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: { ...availability, manager: canonicalManager },
          nylas_grant_id: canonicalGrant.id,
          nylas_grant_email: canonicalGrant.email,
          nylas_calendar_id: canonicalGrant.calendarId,
          calendar_binding_version: calendarBindingVersion,
        },
      }),
      '/nylas_configurations/get_all/v3': (body) => ({
        status: 200,
        body: body.grant_id === 'platform-grant'
          ? [{ config_id: 'cfg-free-new', grant_id: 'platform-grant', is_paid: false, active: true }]
          : [{ config_id: 'cfg-free-old', grant_id: 'grant-1', is_paid: false, active: true }],
      }),
      '/grants/create_virtual_account/v3': (body) => {
        attempts += 1
        if (attempts === 1) return { status: 503, body: { message: 'try again' } }
        canonicalManager = 'platform'
        canonicalGrant = {
          id: 'platform-grant',
          email: 'virtual@example.com',
          calendarId: 'platform-cal',
        }
        calendarBindingVersion = 1
        return {
          status: 200,
          body: {
            transition_id: body.in_transition_id,
            previous_grant_retained: true,
            replaced_grant_id: 'grant-1',
            grant_id: 'platform-grant',
            default_selected: true,
            services_ready: true,
            manager: 'platform',
            active_config_ids: ['cfg-free-new'],
            active_service_count: 1,
          },
        }
      },
    },
  })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  assert.equal(result.sessionStorage.has('starter-scheduling-platform-transition:member-a'), true)
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()
  await settle()

  const requests = result.calls.filter((c) => c.path === '/grants/create_virtual_account/v3')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].body.in_transition_id, 'uuid-fixed')
  assert.equal(requests[1].body.in_transition_id, 'uuid-fixed')
  assert.equal(result.calls.filter((c) => c.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((c) => c.path === '/grants/add_virtual/v3').length, 0)
  assert.equal(result.calls.filter((c) => c.path === '/grants/create_virtual_calendar/v3').length, 0)
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.sessionStorage.has('starter-scheduling-platform-transition:member-a'), false)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  assert.equal(canonicalManager, 'platform')
})

test('disconnect flow: confirm navigates to its step, disconnect rebuilds a virtual calendar', async () => {
  let virtualPersisted = false
  let configCreated = false
  let paidService = {
    config_id: 'cfg-paid-old',
    title: 'Paid Strategy Call',
    price_cents: 42500,
    duration: 45,
    active: true,
  }
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/starter/paid-call-settings/get/v3': () => ({
        status: 200,
        body: {
          readiness: { paid_call_enabled: Boolean(paidService) },
          services: paidService ? [paidService] : [],
        },
      }),
      '/starter/paid-call-settings/upsert/v3': (body) => {
        paidService = {
          config_id: 'cfg-paid-restored',
          title: body.title,
          price_cents: body.price_cents,
          duration: body.duration_minutes,
          active: true,
        }
        return { status: 200, body: { service: paidService } }
      },
      '/grants/delete/v3': () => {
        paidService = null
        return {
          status: 200,
          body: {
            connected: false,
            already_disconnected: false,
            availability: {},
            deleted_configuration_ids: ['cfg-free-old', 'cfg-paid-old'],
            provider_response: { status: 200 },
          },
        }
      },
      '/grants/add_virtual/v3': () => {
        virtualPersisted = true
        return { status: 200, body: { id: 5 } }
      },
      '/scheduler/configurations/create/v3': () => {
        configCreated = true
        return { status: 200, body: { response: { status: 200 } } }
      },
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: {
            ...defaultAvailability(),
            manager: virtualPersisted ? 'platform' : 'calendar',
          },
          nylas_grant_id: virtualPersisted ? 'vgrant-1' : 'grant-1',
          nylas_grant_email: virtualPersisted ? 'virtual@example.com' : 'grant@example.com',
          nylas_calendar_id: virtualPersisted ? 'vcal-1' : 'cal-1',
        },
      }),
      '/nylas_configurations/get_all/v3': (body) => ({
        status: 200,
        body:
          body.grant_id === 'vgrant-1' && configCreated
            ? [{ config_id: 'cfg-free', grant_id: 'vgrant-1', is_paid: false }]
            : [
                { config_id: 'cfg-free-old', grant_id: 'grant-1', is_paid: false },
                { config_id: 'cfg-paid-old', grant_id: 'grant-1', is_paid: true },
              ],
      }),
    },
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectConfirm)
  assert.equal(result.dom.steps['disconnect-calendar'].style.display, 'block')

  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  const paths = result.calls.map((c) => c.path)
  assert.ok(paths.indexOf('/grants/delete/v3') > -1)
  const accountIndex = paths.indexOf('/grants/create_virtual_account/v3')
  const calendarIndex = paths.indexOf('/grants/create_virtual_calendar/v3')
  assert.ok(accountIndex > -1 && calendarIndex > accountIndex)

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(update.body.member_id, 'member-a')
  assert.equal(update.body.availability.manager, 'platform')
  assert.equal(result.dom.steps['success-disconnect'].style.display, 'block')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  const restoreCall = result.calls.find(
    (call) => call.path === '/starter/paid-call-settings/upsert/v3',
  )
  assert.deepEqual(restoreCall.body, {
    config_id: null,
    title: 'Paid Strategy Call',
    price_cents: 42500,
    duration_minutes: 45,
    expected_revision: 0,
    idempotency_key: 'paid-call-calendar-transition:uuid-fixed',
  })
  assert.ok(paths.indexOf('/grants/delete/v3') < paths.indexOf('/starter/paid-call-settings/upsert/v3'))

  const canonicalReadIndex = paths.indexOf('/starter/get_by_memberstack/v3', calendarIndex + 1)
  const canonicalConfigIndex = paths.indexOf(
    '/nylas_configurations/get_all/v3',
    canonicalReadIndex + 1,
  )
  assert.ok(canonicalReadIndex > calendarIndex)
  assert.ok(canonicalConfigIndex > canonicalReadIndex)

  const loader = result.dom.steps['disconnect-calendar'].querySelector('[data-custom-loader]')
  assert.match(loader.getAttribute('style'), /visibility: hidden/)
})

// Calendar transitions preserve the canonical paid-call service by re-writing it
// after the grant is deleted, so a rate the paid-call contract rejects must stop
// the transition before the irreversible provider mutation — and must say which
// repairable value stopped it instead of blaming the calendar connection.
function blockedPaidRateRoutes(priceCents) {
  return {
    '/starter/paid-call-settings/get/v3': () => ({
      status: 200,
      body: {
        readiness: { paid_call_enabled: true },
        services: [
          {
            config_id: 'cfg-paid-old',
            title: 'Paid Strategy Call',
            price_cents: priceCents,
            duration: 45,
            active: true,
          },
        ],
      },
    }),
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: { ...defaultAvailability(), manager: 'calendar' },
        nylas_grant_id: 'grant-1',
        nylas_grant_email: 'grant@example.com',
        nylas_calendar_id: 'cal-1',
      },
    }),
    '/nylas_configurations/get_all/v3': () => ({
      status: 200,
      body: [{ config_id: 'cfg-free-old', grant_id: 'grant-1', is_paid: false }],
    }),
  }
}

for (const [label, priceCents] of [
  ['above the $1,000 maximum', 100100],
  ['not a whole dollar', 42550],
]) {
  test(`a canonical paid-call rate ${label} stops the writer disconnect before the grant is deleted`, async () => {
    const result = loadWriter({ storage: TZ_CACHED, routes: blockedPaidRateRoutes(priceCents) })
    await settle()

    result.clickAction(result.dom.buttons.disconnectConfirm)
    result.clickAction(result.dom.buttons.disconnectCalendar)
    await settle()

    const paths = result.calls.map((c) => c.path)
    assert.equal(
      paths.filter((path) => path === '/grants/delete/v3').length,
      0,
      'the provider grant must survive a paid-call rate the contract rejects',
    )
    assert.equal(
      paths.filter((path) => path === '/starter/paid-call-settings/upsert/v3').length,
      0,
      'no paid-call rate may be rewritten from a rejected canonical value',
    )
    assert.equal(result.dom.steps['success-disconnect'].style.display, 'none')
    assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
    assert.match(result.dom.errorText.textContent, /paid call rate/i)
    assert.match(result.dom.errorText.textContent, /\$1 to \$1,000/)
    assert.match(result.dom.errorText.textContent, /Call Settings/)
    assert.doesNotMatch(result.dom.errorText.textContent, /contact support/)
  })
}

// Designer owns the error step's markup. Where the copy sits beside an inline
// icon, no reveal may replace that subtree with a single text node.
test('a revealed error step keeps nested authored markup inside its error-text element', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    nestedErrorTextMarkup: true,
    routes: blockedPaidRateRoutes(100100),
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectConfirm)
  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(
    result.calls.filter((call) => call.path === '/grants/delete/v3').length,
    0,
    'the provider grant must survive regardless of which error copy the page can show',
  )
  assert.equal(result.dom.errorText.children.length, 2, 'authored icon and copy must survive')
  assert.match(result.dom.errorText.children[1].textContent, /contact support/)
})

test('an active-booking refusal keeps nested authored markup inside its error-text element', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    nestedErrorTextMarkup: true,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
      '/grants/delete/v3': () => ({
        status: 400,
        body: { message: 'Resolve active bookings before disconnecting the calendar' },
      }),
    },
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.dom.errorText.children.length, 2, 'authored icon and copy must survive')
  assert.equal(result.dom.errorText.children[1].textContent, GENERIC_TRANSITION_COPY)
})

test('a blocked paid-call rate still stops the disconnect where Designer authored no error-text element', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    withoutErrorTextElement: true,
    routes: blockedPaidRateRoutes(100100),
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectConfirm)
  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  assert.equal(result.dom.errorText, null)
  assert.equal(
    result.calls.filter((call) => call.path === '/grants/delete/v3').length,
    0,
    'the provider grant must survive regardless of which error copy the page can show',
  )
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.dom.steps['success-disconnect'].style.display, 'none')
})

// The error step is shared. Once a blocked transition has replaced its copy with
// the paid-call remediation message, the next unrelated failure that reveals the
// same step must not still be telling the member to fix their rate.
test('a stale paid-call remediation message never survives into an unrelated failure', async () => {
  const routes = blockedPaidRateRoutes(100100)
  routes['/scheduler/configurations/update/v3'] = () => ({
    status: 200,
    body: { response: { status: 400 } },
  })
  const result = loadWriter({ storage: TZ_CACHED, routes })
  await settle()

  result.clickAction(result.dom.buttons.disconnectConfirm)
  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()
  assert.match(result.dom.errorText.textContent, /paid call rate/i)

  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.match(result.dom.errorText.textContent, /contact support/)
  assert.doesNotMatch(result.dom.errorText.textContent, /paid call rate/i)
})

test('a calendar failure unrelated to the paid-call rate keeps the authored generic copy', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/starter/paid-call-settings/get/v3': () => ({
        status: 200,
        body: { readiness: { paid_call_enabled: false }, services: [] },
      }),
      '/grants/delete/v3': () => ({ status: 500, body: {} }),
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: { ...defaultAvailability(), manager: 'calendar' },
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: [{ config_id: 'cfg-free-old', grant_id: 'grant-1', is_paid: false }],
      }),
    },
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectConfirm)
  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.match(result.dom.errorText.textContent, /contact support/)
  assert.doesNotMatch(result.dom.errorText.textContent, /paid call rate/i)
})

test('an active-booking rejection preserves calendar state in the disconnect flow', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  const legacyClearCalls = []
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    clearGrantData: async (...args) => legacyClearCalls.push(args),
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
      '/grants/delete/v3': () => ({
        status: 400,
        body: { message: 'Resolve active bookings before disconnecting the calendar' },
      }),
    },
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/delete/v3').length, 1)
  assert.equal(result.calls.filter((c) => c.path === '/grants/create_virtual_account/v3').length, 0)
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 0)
  assert.deepEqual(legacyClearCalls, [])
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'calendar')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.dom.steps['success-disconnect'].style.display, 'none')
  assert.equal(result.dom.errorText.textContent, ACTIVE_CALLS_COPY)
})

// A 400 from a different grants/delete/v3 precondition is not the active-calls
// refusal; it must keep the authored generic copy.
test('a different grant deletion 400 keeps the authored generic copy', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
      '/grants/delete/v3': () => ({
        status: 400,
        body: { message: 'Grant does not belong to the authenticated member' },
      }),
    },
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/delete/v3').length, 1)
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.dom.errorText.textContent, GENERIC_TRANSITION_COPY)
})

test('a matching active-bookings message on non-400 keeps the authored generic copy', async () => {
  const availability = defaultAvailability()
  availability.manager = 'calendar'
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
      '/grants/delete/v3': () => ({
        status: 500,
        body: { message: 'Resolve active bookings before disconnecting the calendar' },
      }),
    },
  })
  await settle()

  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/delete/v3').length, 1)
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.dom.errorText.textContent, GENERIC_TRANSITION_COPY)
})

test('calendar connection copy describes the explicit same-tab handoff', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  const successHeadlines = result.dom.steps['success-calendar'].querySelectorAll(
    '.set-availability_success-headline',
  )
  assert.equal(successHeadlines[0].querySelector('p').textContent, 'Availability saved')
  assert.equal(
    successHeadlines[0].querySelectorAll('p')[1].textContent,
    'Your hours are saved, but your calendar is not connected yet. Connect it before accepting call requests to prevent booking conflicts.',
  )
  assert.equal(
    successHeadlines[1].querySelector('p').textContent,
    'Connect your Google Calendar',
  )
  assert.equal(
    result.dom.buttons.preRedirect.querySelector('.button_main-text').textContent,
    'Connect Google Calendar',
  )
  assert.equal(
    result.dom.steps['pre-redirect'].querySelector('.heading-style-h1').textContent,
    'Opening Google Calendar…',
  )
  assert.equal(
    result.dom.managers.calendar.querySelectorAll('p')[0].textContent,
    'Connect Google Calendar',
  )
  assert.equal(
    result.dom.managers.calendar.querySelectorAll('p')[1].textContent,
    'Check your real calendar for conflicts so brands only see times when you’re free.',
  )
  assert.equal(
    result.dom.buttons.managerSubmit.querySelector('.button_main-text').textContent,
    'Use platform availability',
  )

  result.dom.managers.calendar.click()
  assert.equal(
    result.dom.buttons.managerSubmit.querySelector('.button_main-text').textContent,
    'Connect Google Calendar',
  )
})

test('pre-redirect sends the authenticated member id as OAuth state and navigates same-tab', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.clickAction(result.dom.buttons.preRedirect)
  assert.equal(result.dom.steps['pre-redirect'].style.display, 'block')
  await settle()

  const oauth = result.calls.find((c) => c.path === '/grants/oauth/v3')
  assert.deepEqual(oauth.body, {
    in_state: 'member-a',
    in_provider: 'google',
    in_redirect_uri:
      'https://the-starters-3-0.webflow.io/starter-dashboard---availability-stage',
  })
  assert.deepEqual(result.assigned, ['https://nylas.example/oauth'])
  assert.deepEqual(result.opened, [])
})

test('pre-redirect aborts when the member session changed', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.harness.setActiveMember({ id: 'member-b', customFields: {} })
  result.clickAction(result.dom.buttons.preRedirect)
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/oauth/v3').length, 0)
  assert.equal(result.assigned.length, 0)
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
})

test('production pre-redirect persists timezone and uses the canonical host', async () => {
  const result = loadWriter({
    hostname: 'www.thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://www.thestarters.com',
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: '',
          availability: defaultAvailability(),
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/starter/set_timezone/v3').length, 0)
  result.clickAction(result.dom.buttons.preRedirect)
  await settle()

  const paths = result.calls.map((c) => c.path)
  const timezoneIndex = paths.indexOf('/starter/set_timezone/v3')
  const oauthIndex = paths.indexOf('/grants/oauth/v3')
  assert.ok(timezoneIndex > -1 && oauthIndex > timezoneIndex)
  assert.deepEqual(result.calls[oauthIndex].body, {
    in_state: 'member-a',
    in_provider: 'google',
    in_redirect_uri: 'https://www.thestarters.com/starter-dashboard',
  })
})

test('a stored paid rate cannot create a paid configuration', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    storage: { ...TZ_CACHED, paid_call_rate: '150' },
  })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  const creates = result.calls.filter((c) => c.path === '/scheduler/configurations/create/v3')
  assert.equal(creates.length, 1)
  assert.equal(creates[0].body.in_config_name, 'Free Consultation Call - 30min')
  assert.equal(creates[0].body.in_scheduler.min_booking_notice, 5)
  assert.equal(result.dom.steps.success.style.display, 'block')
})

test('production scheduler configuration creation keeps the 24-hour booking notice', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    storage: TZ_CACHED,
  })
  await settle()

  assert.equal(result.window.StarterSchedulingAvailabilityWriter.minimumBookingNoticeMinutes(), 1440)
  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  const creates = result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3')
  assert.equal(creates.length, 1)
  assert.equal(creates[0].body.in_scheduler.min_booking_notice, 1440)
})

test('config update rejection lands on config-request-error', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/scheduler/configurations/update/v3': () => ({
        status: 200,
        body: { response: { status: 400 } },
      }),
    },
  })
  await settle()

  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
})

test('removing an override returns its days to the general schedule', async () => {
  let paidCreated = false
  const availability = defaultAvailability()
  availability.items.general.days = [1, 2]
  availability.items['ov-1'] = { days: [3], start: '13:00', end: '15:00' }
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/update_availability/v3': () => {
        paidCreated = true
        return { status: 200, body: { id: 1 } }
      },
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: [
          { config_id: 'cfg-free', grant_id: 'grant-1', duration: 30, is_paid: false, active: true },
          ...(paidCreated
            ? [{ config_id: 'cfg-paid', grant_id: 'grant-1', duration: 60, is_paid: true, active: true }]
            : []),
        ],
      }),
    },
  })
  await settle()

  const item = new El('div', { 'availability-item': '' })
  item.dataset.id = 'ov-1'
  const removeBtn = new El('a', { 'availability-action-btn': 'availability-remove' })
  item.appendChild(removeBtn)
  result.dom.root.appendChild(item)

  result.clickAction(removeBtn)
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.deepEqual(update.body.availability.items.general.days, [1, 2, 3])
  assert.equal(update.body.availability.items['ov-1'], undefined)
  assert.equal(
    result.calls.filter((c) => c.path === '/scheduler/configurations/update/v3').length,
    2,
  )
  const configUpdates = result.calls.filter((c) => c.path === '/scheduler/configurations/update/v3')
  assert.deepEqual(configUpdates.map((call) => call.body.config_id), ['cfg-free', 'cfg-paid'])
  assert.deepEqual(configUpdates.map((call) => call.body.in_availability.duration_minutes), [30, 60])
  configUpdates.forEach((call) => {
    assert.equal(call.body.in_config_name, undefined)
    assert.equal(call.body.in_event_booking, undefined)
    assert.equal(call.body.in_scheduler, undefined)
  })
  const paths = result.calls.map((call) => call.path)
  const updateIndex = paths.indexOf('/starter/update_availability/v3')
  const configIndex = paths.lastIndexOf('/scheduler/configurations/update/v3')
  const canonicalReadIndex = paths.indexOf('/starter/get_by_memberstack/v3', configIndex + 1)
  assert.ok(updateIndex > -1 && configIndex > updateIndex)
  assert.ok(canonicalReadIndex > configIndex)
})

test('failed canonical removal restores the mirrored model and cards', async () => {
  const availability = defaultAvailability()
  availability.items.general.days = [1, 2]
  availability.items['ov-1'] = { days: [3], start: '13:00', end: '15:00' }
  const expectedAvailability = JSON.parse(JSON.stringify(availability))
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/update_availability/v3': () => ({ status: 500, body: { message: 'rejected' } }),
    },
  })
  await settle()

  const item = new El('div', { 'availability-item': '' })
  item.dataset.id = 'ov-1'
  const removeBtn = new El('a', { 'availability-action-btn': 'availability-remove' })
  item.appendChild(removeBtn)
  result.dom.root.appendChild(item)
  result.clickAction(removeBtn)
  await settle()

  assert.equal(JSON.stringify(result.window.STARTER_AVAILABILITY), JSON.stringify(expectedAvailability))
  assert.deepEqual(result.dom.list.children.map((card) => card.dataset.id), ['general', 'ov-1'])
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
})

test('rejects malformed canonical availability after a mutation', async () => {
  let starterReads = 0
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => {
        starterReads += 1
        return {
          status: 200,
          body:
            starterReads === 1
              ? {
                  id: 1,
                  timezone: 'Asia/Manila',
                  availability,
                  nylas_grant_id: null,
                  nylas_calendar_id: null,
                }
              : { id: 1, timezone: 'Asia/Manila', availability: null },
        }
      },
    },
  })
  await settle()

  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
})

test('an OAuth code on this page exchanges the grant and finishes the connect flow', async () => {
  const member = MEMBER_A()
  delete member.customFields['nylas-grant-id']
  const availability = defaultAvailability()
  availability.manager = null
  let starterReads = 0
  let configCreated = false
  const result = loadWriter({
    member,
    availability,
    search: '?code=abc123&state=member-a',
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => {
        starterReads += 1
        return {
          status: 200,
          body: {
            id: 1,
            timezone: 'Asia/Manila',
            availability: availability,
            nylas_grant_id: starterReads === 1 ? null : 'grant-9',
            nylas_grant_email: starterReads === 1 ? null : 'g@example.com',
            nylas_calendar_id: starterReads === 1 ? null : 'cal-9',
          },
        }
      },
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: configCreated
          ? [{ config_id: 'cfg-new', grant_id: 'grant-9', is_paid: false }]
          : [],
      }),
      '/scheduler/configurations/create/v3': () => {
        configCreated = true
        return { status: 200, body: { response: { status: 200 } } }
      },
    },
  })
  await settle()

  const add = result.calls.find((c) => c.path === '/grants/add/v3')
  assert.deepEqual(add.body, {
    code: 'abc123',
    member_id: 'member-a',
    in_redirect_uri:
      'https://the-starters-3-0.webflow.io/starter-dashboard---availability-stage',
    in_state: 'member-a',
  })
  assert.ok(result.historyCalls.length >= 1, 'code/state stripped from the URL')

  const paths = result.calls.map((call) => call.path)
  const addIndex = paths.indexOf('/grants/add/v3')
  const canonicalReadIndex = paths.indexOf('/starter/get_by_memberstack/v3', addIndex + 1)
  const canonicalConfigIndex = paths.indexOf(
    '/nylas_configurations/get_all/v3',
    canonicalReadIndex + 1,
  )
  assert.ok(addIndex > -1 && canonicalReadIndex > addIndex)
  assert.ok(canonicalConfigIndex > canonicalReadIndex)

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(update.body.availability.manager, 'calendar')
  const creates = result.calls.filter((c) => c.path === '/scheduler/configurations/create/v3')
  assert.equal(creates.length, 1)
  assert.equal(creates[0].body.grant_id, 'grant-9')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.dom.steps.default.style.display, 'block')
  assert.equal(result.status(), 'ready')
})

test('an OAuth state for a different member aborts the exchange without writing', async () => {
  const result = loadWriter({
    search: '?code=abc123&state=member-b',
    storage: TZ_CACHED,
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.ok(
    result.events.some(
      (e) => e.type === 'starterSchedulingWriteError' && e.detail.action === 'oauth-connect',
    ),
  )
  assert.equal(result.status(), 'ready')
})

test('an OAuth code without state aborts the exchange without writing', async () => {
  const result = loadWriter({
    search: '?code=abc123',
    storage: TZ_CACHED,
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.ok(
    result.events.some(
      (e) => e.type === 'starterSchedulingWriteError' && e.detail.action === 'oauth-connect',
    ),
  )
})

test('passive production initialization performs no scheduling writes', async () => {
  const result = loadWriter({
    hostname: 'www.thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://www.thestarters.com',
    search: '?code=abc123&state=member-a&calendar=google',
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: '',
          availability: defaultAvailability(),
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  const writePaths = new Set([
    '/starter/set_timezone/v3',
    '/starter/update_availability/v3',
    '/scheduler/configurations/create/v3',
    '/scheduler/configurations/update/v3',
    '/scheduler/configurations/delete/v3',
    '/grants/add/v3',
  ])
  assert.deepEqual(
    result.calls.filter((call) => writePaths.has(call.path)),
    [],
  )
})

test('production OAuth return writes only with a recent session intent', async () => {
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?code=abc123&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
      }),
    },
    routes: {
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  const add = result.calls.find((c) => c.path === '/grants/add/v3')
  assert.deepEqual(add.body, {
    code: 'abc123',
    member_id: 'member-a',
    in_redirect_uri: 'https://thestarters.com/starter-dashboard',
    in_state: 'member-a',
  })
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 1)
  assert.equal(
    result.calls.filter((c) => c.path === '/scheduler/configurations/create/v3').length,
    1,
  )
  assert.equal(result.sessionStorage.size, 0)
})

test('production hosted OAuth callback verifies and persists the returned grant', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    availability,
    search:
      '?success=true&grant_id=hosted-grant-9&email=callback%40example.com&provider=google&state=member-a',
    storage: { ...TZ_CACHED, paid_call_rate: '150' },
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
      }),
    },
    routes: {
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  const add = result.calls.find((c) => c.path === '/grants/add/v3')
  assert.deepEqual(add.body, {
    in_grant_id: 'hosted-grant-9',
    member_id: 'member-a',
    in_redirect_uri: 'https://thestarters.com/starter-dashboard',
    in_state: 'member-a',
  })
  assert.equal(result.historyCalls.at(-1)[2], '/starter-dashboard')
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 1)
  const creates = result.calls.filter((c) => c.path === '/scheduler/configurations/create/v3')
  assert.equal(creates.length, 1)
  assert.equal(creates[0].body.in_config_name, 'Free Consultation Call - 30min')
})

test('production hosted OAuth callback accepts a recent durable intent fallback', async () => {
  const intentKey = 'starter-scheduling-oauth-intent:member-a'
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    availability,
    search: '?success=true&grant_id=hosted-grant-9&state=member-a',
    storage: {
      ...TZ_CACHED,
      [intentKey]: JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: null,
      }),
    },
    routes: {
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
  assert.equal(result.storage.has(intentKey), false)
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-callback'), false)
})

test('another tab does not consume the durable OAuth intent without a callback', async () => {
  const intentKey = 'starter-scheduling-oauth-intent:member-a'
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    storage: {
      ...TZ_CACHED,
      [intentKey]: JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 0)
  assert.equal(result.storage.has(intentKey), true)
})

test('OAuth callback is stripped before bootstrap failure and survives a login reload', async () => {
  const firstLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    member: null,
    search:
      '?success=true&grant_id=hosted-grant-9&email=callback%40example.com&provider=google&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
      }),
    },
    routes: {
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })

  assert.equal(firstLoad.historyCalls.at(-1)[2], '/starter-dashboard')
  await settle()
  assert.equal(firstLoad.status(), 'error')
  assert.equal(firstLoad.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.ok(firstLoad.sessionStorage.has('starter-scheduling-oauth-callback'))

  const secondLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
    storage: TZ_CACHED,
    sessionStorage: Object.fromEntries(firstLoad.sessionStorage),
    routes: {
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  const add = secondLoad.calls.find((c) => c.path === '/grants/add/v3')
  assert.deepEqual(add.body, {
    in_grant_id: 'hosted-grant-9',
    member_id: 'member-a',
    in_redirect_uri: 'https://thestarters.com/starter-dashboard',
    in_state: 'member-a',
  })
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-callback'), false)
})

test('OAuth callback and intent survive a transient grant save failure', async () => {
  const sessionStorage = {
    'starter-scheduling-oauth-intent:member-a': JSON.stringify({
      createdAt: Date.now(),
      redirectUri: 'https://thestarters.com/starter-dashboard',
    }),
  }
  const firstLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?success=true&grant_id=hosted-grant-9&state=member-a',
    storage: TZ_CACHED,
    sessionStorage,
    routes: {
      '/grants/add/v3': () => ({ status: 503, body: { message: 'try again' } }),
    },
  })
  await settle()

  assert.ok(firstLoad.sessionStorage.has('starter-scheduling-oauth-callback'))
  assert.ok(firstLoad.sessionStorage.has('starter-scheduling-oauth-intent:member-a'))

  const secondLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
    storage: TZ_CACHED,
    sessionStorage: Object.fromEntries(firstLoad.sessionStorage),
  })
  await settle()

  assert.equal(secondLoad.calls.filter((c) => c.path === '/grants/add/v3').length, 1)
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-callback'), false)
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-intent:member-a'), false)
})

test('OAuth retry reconciles a committed grant after its response was lost', async () => {
  let grantPersisted = false
  let manager = null
  let configCreated = false
  const routes = {
    '/grants/add/v3': () => {
      grantPersisted = true
      return { status: 503, body: { message: 'response lost' } }
    },
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: { ...defaultAvailability(), manager },
        nylas_grant_id: grantPersisted ? 'hosted-grant-9' : null,
        nylas_grant_email: grantPersisted ? 'google@example.com' : null,
        nylas_calendar_id: grantPersisted ? 'cal-9' : null,
      },
    }),
    '/starter/update_availability/v3': (body) => {
      manager = body.availability.manager
      return { status: 200, body: { id: 1 } }
    },
    '/nylas_configurations/get_all/v3': () => ({
      status: 200,
      body: configCreated
        ? [{ config_id: 'cfg-free', grant_id: 'hosted-grant-9', is_paid: false, active: true }]
        : [],
    }),
    '/scheduler/configurations/create/v3': () => {
      configCreated = true
      return { status: 200, body: { response: { status: 200 } } }
    },
  }
  const firstLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?success=true&grant_id=hosted-grant-9&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
      }),
    },
    routes,
  })
  await settle()

  assert.equal(firstLoad.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
  assert.equal(firstLoad.sessionStorage.has('starter-scheduling-oauth-callback'), true)

  const secondLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
    storage: TZ_CACHED,
    sessionStorage: Object.fromEntries(firstLoad.sessionStorage),
    routes,
  })
  await settle()
  await settle()

  assert.equal(secondLoad.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assert.equal(manager, 'calendar')
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-callback'), false)
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-intent:member-a'), false)
})

test('OAuth success resumes paid restoration without saving the grant twice', async () => {
  let grantPersisted = false
  let manager = null
  let configCreated = false
  let paidService = null
  let rejectPaidRestore = true
  const routes = {
    '/grants/add/v3': () => {
      grantPersisted = true
      return { status: 200, body: { grant_id: 'grant-9' } }
    },
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: { ...defaultAvailability(), manager },
        nylas_grant_id: grantPersisted ? 'grant-9' : null,
        nylas_grant_email: grantPersisted ? 'google@example.com' : null,
        nylas_calendar_id: grantPersisted ? 'cal-9' : null,
      },
    }),
    '/starter/update_availability/v3': (body) => {
      manager = body.availability.manager
      return { status: 200, body: { id: 1 } }
    },
    '/nylas_configurations/get_all/v3': () => ({
      status: 200,
      body: configCreated
        ? [{ config_id: 'cfg-free', grant_id: 'grant-9', is_paid: false, active: true }]
        : [],
    }),
    '/scheduler/configurations/create/v3': () => {
      configCreated = true
      return { status: 200, body: { response: { status: 200 } } }
    },
    '/starter/paid-call-settings/get/v3': () => ({
      status: 200,
      body: {
        readiness: { paid_call_enabled: Boolean(paidService) },
        services: paidService ? [paidService] : [],
      },
    }),
    '/starter/paid-call-settings/upsert/v3': (body) => {
      if (rejectPaidRestore) return { status: 503, body: { message: 'try again' } }
      paidService = {
        config_id: 'cfg-paid',
        title: body.title,
        price_cents: body.price_cents,
        duration: body.duration_minutes,
        active: true,
      }
      return { status: 200, body: { service: paidService } }
    },
  }
  const firstLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?success=true&grant_id=grant-9&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
    routes,
  })
  await settle()
  await settle()

  assert.equal(firstLoad.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
  assert.equal(firstLoad.sessionStorage.has('starter-scheduling-oauth-callback'), true)
  const retainedIntent = JSON.parse(
    firstLoad.sessionStorage.get('starter-scheduling-oauth-intent:member-a'),
  )
  assert.equal(retainedIntent.oauthGrantSaved, true)

  rejectPaidRestore = false
  const secondLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
    storage: TZ_CACHED,
    sessionStorage: Object.fromEntries(firstLoad.sessionStorage),
    routes,
  })
  await settle()
  await settle()

  assert.equal(secondLoad.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assert.equal(paidService.title, 'Paid Strategy Call')
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-callback'), false)
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-intent:member-a'), false)
})

test('hosted OAuth callback without success strips its query and performs no writes', async () => {
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?grant_id=hosted-grant-9&email=x%40example.com&provider=google&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.historyCalls.at(-1)[2], '/starter-dashboard')
})

test('OAuth cancellation returns to an actionable error state without writing', async () => {
  const result = loadWriter({
    search:
      '?error=access_denied&error_description=cancelled&error_uri=provider&state=member-a',
    storage: TZ_CACHED,
  })
  await settle()

  assert.ok(result.historyCalls.length >= 1, 'OAuth error fields stripped from the URL')
  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-callback'), false)
})

test('OAuth cancellation rebuilds platform scheduling and restores the saved paid service', async () => {
  let virtualPersisted = false
  let configCreated = false
  let paidService = null
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?error=access_denied&error_description=cancelled&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
    routes: {
      '/grants/add_virtual/v3': () => {
        virtualPersisted = true
        return { status: 200, body: { id: 5 } }
      },
      '/scheduler/configurations/create/v3': () => {
        configCreated = true
        return { status: 200, body: { response: { status: 200 } } }
      },
      '/starter/update_availability/v3': (body) => ({ status: 200, body }),
      '/starter/paid-call-settings/upsert/v3': (body) => {
        paidService = {
          config_id: 'cfg-paid-restored',
          title: body.title,
          price_cents: body.price_cents,
          duration: body.duration_minutes,
          active: true,
        }
        return { status: 200, body: { service: paidService } }
      },
      '/starter/paid-call-settings/get/v3': () => ({
        status: 200,
        body: {
          readiness: { paid_call_enabled: Boolean(paidService) },
          services: paidService ? [paidService] : [],
        },
      }),
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: {
            ...defaultAvailability(),
            manager: virtualPersisted ? 'platform' : null,
          },
          nylas_grant_id: virtualPersisted ? 'vgrant-1' : null,
          nylas_grant_email: virtualPersisted ? 'virtual@example.com' : null,
          nylas_calendar_id: virtualPersisted ? 'vcal-1' : null,
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: configCreated
          ? [{ config_id: 'cfg-free', grant_id: 'vgrant-1', is_paid: false, active: true }]
          : [],
      }),
    },
  })
  await settle()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 1)
  assert.deepEqual(paidService, {
    config_id: 'cfg-paid-restored',
    title: 'Paid Strategy Call',
    price_cents: 42500,
    duration: 45,
    active: true,
  })
  const update = result.calls.find((call) => call.path === '/starter/update_availability/v3')
  assert.equal(update.body.availability.manager, 'platform')
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-callback'), false)
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-intent:member-a'), false)
})

test('OAuth cancellation recovery reuses canonical resources after partial success', async () => {
  const paidService = {
    config_id: 'cfg-paid-existing',
    title: 'Paid Strategy Call',
    price_cents: 42500,
    duration: 45,
    active: true,
  }
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?error=access_denied&error_description=cancelled&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: defaultAvailability(),
          nylas_grant_id: 'vgrant-existing',
          nylas_grant_email: 'virtual@example.com',
          nylas_calendar_id: 'vcal-existing',
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: [
          {
            config_id: 'cfg-free-existing',
            grant_id: 'vgrant-existing',
            duration: 30,
            is_paid: false,
            active: true,
          },
        ],
      }),
      '/starter/paid-call-settings/get/v3': () => ({
        status: 200,
        body: {
          readiness: { paid_call_enabled: true },
          services: [paidService],
        },
      }),
    },
  })
  await settle()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-callback'), false)
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-intent:member-a'), false)
})

test('OAuth cancellation keeps recovery state when platform scheduling cannot be rebuilt', async () => {
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?error=access_denied&error_description=cancelled&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
    routes: {
      '/grants/create_virtual_account/v3': () => ({ status: 503, body: { message: 'try again' } }),
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: { ...defaultAvailability(), manager: null },
          nylas_grant_id: null,
          nylas_grant_email: null,
          nylas_calendar_id: null,
        },
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-callback'), true)
  assert.equal(result.sessionStorage.has('starter-scheduling-oauth-intent:member-a'), true)
})

test('OAuth cancellation retries a saved virtual grant without creating another account', async () => {
  const baseRoutes = {
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: { ...defaultAvailability(), manager: null },
        nylas_grant_id: null,
        nylas_grant_email: null,
        nylas_calendar_id: null,
      },
    }),
  }
  const firstLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?error=access_denied&error_description=cancelled&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
    routes: {
      ...baseRoutes,
      '/grants/add_virtual/v3': () => ({ status: 503, body: { message: 'try again' } }),
    },
  })
  await settle()
  await settle()

  const retainedIntent = JSON.parse(
    firstLoad.sessionStorage.get('starter-scheduling-oauth-intent:member-a'),
  )
  assert.deepEqual(retainedIntent.virtualRecovery, {
    grant_id: 'vgrant-1',
    email: 'virtual@example.com',
  })

  let virtualPersisted = false
  let configCreated = false
  let paidService = null
  const secondLoad = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
    storage: TZ_CACHED,
    sessionStorage: Object.fromEntries(firstLoad.sessionStorage),
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: { ...defaultAvailability(), manager: virtualPersisted ? 'platform' : null },
          nylas_grant_id: virtualPersisted ? 'vgrant-1' : null,
          nylas_grant_email: virtualPersisted ? 'virtual@example.com' : null,
          nylas_calendar_id: virtualPersisted ? 'vcal-1' : null,
        },
      }),
      '/grants/add_virtual/v3': () => {
        virtualPersisted = true
        return { status: 200, body: { id: 5 } }
      },
      '/scheduler/configurations/create/v3': () => {
        configCreated = true
        return { status: 200, body: { response: { status: 200 } } }
      },
      '/nylas_configurations/get_all/v3': () => ({
        status: 200,
        body: configCreated
          ? [{ config_id: 'cfg-free', grant_id: 'vgrant-1', is_paid: false, active: true }]
          : [],
      }),
      '/starter/paid-call-settings/get/v3': () => ({
        status: 200,
        body: {
          readiness: { paid_call_enabled: Boolean(paidService) },
          services: paidService ? [paidService] : [],
        },
      }),
      '/starter/paid-call-settings/upsert/v3': (body) => {
        paidService = {
          config_id: 'cfg-paid',
          title: body.title,
          price_cents: body.price_cents,
          duration: body.duration_minutes,
          active: true,
        }
        return { status: 200, body: { service: paidService } }
      },
    },
  })
  await settle()
  await settle()

  assert.equal(secondLoad.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 0)
  const addVirtual = secondLoad.calls.find((call) => call.path === '/grants/add_virtual/v3')
  assert.equal(addVirtual.body.grant_id, 'vgrant-1')
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-callback'), false)
  assert.equal(secondLoad.sessionStorage.has('starter-scheduling-oauth-intent:member-a'), false)
})

test('hosted OAuth callback for a different member performs no writes', async () => {
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?success=true&grant_id=hosted-grant-9&state=member-b',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 0)
})

test('hosted OAuth callback without a recent production intent performs no writes', async () => {
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?success=true&grant_id=hosted-grant-9&state=member-a',
    storage: TZ_CACHED,
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 0)
})

test('hosted OAuth callback with an expired production intent performs no writes', async () => {
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '?success=true&grant_id=hosted-grant-9&state=member-a',
    storage: TZ_CACHED,
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now() - 15 * 60 * 1000 - 1,
        redirectUri: 'https://thestarters.com/starter-dashboard',
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 0)
  assert.equal(result.calls.filter((c) => c.path === '/starter/update_availability/v3').length, 0)
  assert.equal(
    result.calls.filter((c) => c.path === '/scheduler/configurations/create/v3').length,
    0,
  )
  assert.equal(result.sessionStorage.size, 0)
})

test('returning from the calendar OAuth round trip records the calendar manager', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    search: '?calendar=google',
    storage: TZ_CACHED,
    routes: {
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(update.body.member_id, 'member-a')
  assert.equal(update.body.availability.manager, 'calendar')
  // Rate-less starter: only the free config is created on the OAuth return.
  assert.equal(
    result.calls.filter((c) => c.path === '/scheduler/configurations/create/v3').length,
    1,
  )
  assert.equal(result.historyCalls.length, 1)
  assert.equal(result.dom.steps.default.style.display, 'block')
})

test('staging calendar query does not provision a versioned zero-offer binding', async () => {
  const availability = defaultAvailability()
  availability.manager = 'platform'
  const result = loadWriter({
    availability,
    search: '?calendar=google',
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability,
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
          calendar_binding_version: 1,
        },
      }),
      '/nylas_configurations/get_all/v3': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
})

test('a save without a chosen manager routes to the how-to-manage step', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({ availability, storage: TZ_CACHED })
  await settle()

  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(update.body.member_id, 'member-a')
  assert.equal(result.dom.steps['how-to-manage'].style.display, 'block')
  assert.equal(
    result.calls.filter((c) => c.path.startsWith('/scheduler/configurations/')).length,
    0,
  )
})

test('closing the modal resets a saved schedule back to the default step', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.clickAction(result.dom.buttons.preRedirect)
  assert.equal(result.dom.steps['pre-redirect'].style.display, 'block')
  result.dom.popupClose.click()
  await settle()
  result.flushTimers(50)

  assert.equal(result.dom.steps.default.style.display, 'block')
  assert.equal(result.dom.steps['pre-redirect'].style.display, 'none')
})

test('does not treat stale Memberstack grant mirrors as canonical connection state', async () => {
  const member = MEMBER_A()
  member.customFields['nylas-grant-id'] = 'ms-grant-2'
  const result = loadWriter({
    member,
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: { id: 1, timezone: 'Asia/Manila', availability: defaultAvailability() },
      }),
    },
  })
  await settle()

  assert.equal(
    result.calls.filter((c) => c.path === '/nylas_configurations/get_all/v3').length,
    0,
  )
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'reconnect')
})

test('a grant-less save still lands back on the default step', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: { id: 1, timezone: 'Asia/Manila', availability: defaultAvailability() },
      }),
    },
  })
  await settle()

  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(update.body.member_id, 'member-a')
  assert.equal(
    result.calls.filter((c) => c.path.startsWith('/scheduler/configurations/')).length,
    0,
  )
  assert.equal(result.dom.steps.default.style.display, 'block')
})

test('production availability save persists timezone only after submit', async () => {
  const result = loadWriter({
    hostname: 'thestarters.com',
    pathname: '/starter-dashboard',
    origin: 'https://thestarters.com',
    storage: TZ_CACHED,
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: '',
          availability: defaultAvailability(),
          nylas_grant_id: 'grant-1',
          nylas_grant_email: 'grant@example.com',
          nylas_calendar_id: 'cal-1',
        },
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/starter/set_timezone/v3').length, 0)
  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  const setCall = result.calls.find((c) => c.path === '/starter/set_timezone/v3')
  const update = result.calls.find((c) => c.path === '/starter/update_availability/v3')
  assert.equal(setCall.body.member_id, 'member-a')
  assert.equal(update.body.in_timezone, 'Asia/Manila')
})

test('resolves and persists the timezone through authenticated endpoints', async () => {
  const result = loadWriter({
    routes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: { id: 1, timezone: '', availability: defaultAvailability() },
      }),
    },
  })
  await settle()

  const setCall = result.calls.find((c) => c.path === '/starter/set_timezone/v3')
  assert.equal(setCall.body.member_id, 'member-a')
  assert.ok(setCall.body.timezone.length > 0)
  assert.equal(result.storage.get('starter-timezone:member-a'), 'Asia/Manila')
})

// Synthetic server admission for the future-default transition contract. These
// fixtures never use provider credentials or the network.
function preservedOAuthCase(options = {}) {
  const activeConfigIds =
    options.activeConfigIds === undefined ? ['new-free'] : options.activeConfigIds
  const intent = {
    createdAt: Date.now(),
    redirectUri: 'https://thestarters.com/starter-dashboard',
    paidCallIntent: options.paidCallIntent || null,
    preserveBookings: true,
    replaceGrantId: 'old-grant',
    transitionId: 'transition-fixture',
    ...options.intent,
  }
  const receipt = {
    transition_id: 'transition-fixture',
    previous_grant_retained: true,
    replaced_grant_id: 'old-grant',
    grant_id: 'new-grant',
    default_selected: true,
    services_ready: true,
    manager: 'calendar',
    active_config_ids: activeConfigIds,
    active_service_count: activeConfigIds.length,
    ...options.receipt,
  }
  let selected = options.selected === true
  const newConfigs =
    options.newConfigs === undefined
      ? activeConfigIds.map((configId) => ({
          config_id: configId,
          grant_id: 'new-grant',
          duration: configId.indexOf('paid') > -1 ? 60 : 30,
          is_paid: configId.indexOf('paid') > -1,
          active: true,
        }))
      : options.newConfigs
  const oldConfigs = options.oldConfigs || [{
    config_id: 'old-free',
    grant_id: 'old-grant',
    duration: 30,
    is_paid: false,
    active: true,
  }]
  const availability = {
    items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
    manager: selected ? 'calendar' : 'platform',
  }
  const routes = {
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: { ...availability, manager: selected ? 'calendar' : 'platform' },
        nylas_grant_id: selected ? 'new-grant' : 'old-grant',
        nylas_grant_email: selected ? 'new@example.com' : 'old@example.com',
        nylas_calendar_id: selected ? 'new-calendar' : 'old-calendar',
        calendar_binding_version: selected
          ? (options.bindingVersion === undefined ? 1 : options.bindingVersion)
          : null,
      },
    }),
    '/nylas_configurations/get_all/v3': (body) => ({
      status: 200,
      body: (selected ? newConfigs : oldConfigs).map((config) => ({
        ...config,
        grant_id: options.wrongConfigGrant ? 'old-grant' : body.grant_id,
      })),
    }),
    '/grants/add/v3': () => {
      if (options.addFailure) return { status: 503, body: { message: 'Retry transition' } }
      if (options.selectOnAdd !== false) selected = true
      return { status: 200, body: receipt }
    },
  }
  const sessionStorage = {
    'starter-scheduling-oauth-intent:member-a': JSON.stringify(intent),
    ...options.sessionStorage,
  }
  const search = options.search === undefined ? '?code=fixture-code&state=member-a' : options.search
  const result = loadWriter({
    hostname: options.hostname || 'thestarters.com',
    pathname: options.pathname || '/starter-dashboard',
    origin: options.origin || 'https://thestarters.com',
    search, sessionStorage, storage: TZ_CACHED, availability, routes,
  })
  result.intentStillStored = () => result.sessionStorage.has('starter-scheduling-oauth-intent:member-a')
  return result
}

function assertNoCalendarReplacementWrites(calls) {
  const forbidden = new Set([
    '/grants/delete/v3', '/grants/create_virtual_account/v3', '/grants/add_virtual/v3',
    '/grants/create_virtual_calendar/v3', '/starter/update_availability/v3',
    '/scheduler/configurations/create/v3', '/scheduler/configurations/update/v3',
    '/starter/paid-call-settings/upsert/v3',
  ])
  assert.deepEqual(calls.filter((call) => forbidden.has(call.path)), [])
}

test('preserved OAuth completion sends the expected old binding and accepts only an attested new default', async () => {
  const result = preservedOAuthCase()
  await settle()
  const request = result.calls.find((call) => call.path === '/grants/add/v3')
  assert.deepEqual(request.body, {
    member_id: 'member-a',
    in_redirect_uri: 'https://thestarters.com/starter-dashboard',
    in_state: 'member-a',
    code: 'fixture-code',
    in_replace_grant_id: 'old-grant',
    in_preserve_bookings: true,
    in_transition_id: 'transition-fixture',
  })
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'calendar')
  assert.equal(result.intentStillStored(), false)
})

test('preserved OAuth accepts a versioned binding with no active offers', async () => {
  const result = preservedOAuthCase({ activeConfigIds: [], newConfigs: [] })
  await settle()

  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'calendar')
  assert.equal(result.intentStillStored(), false)
})

test('staging preserved OAuth accepts zero offers without bootstrap provisioning', async () => {
  const result = preservedOAuthCase({
    hostname: 'the-starters-3-0.webflow.io',
    pathname: '/starter-dashboard---availability-stage',
    origin: 'https://the-starters-3-0.webflow.io',
    intent: { redirectUri: 'https://the-starters-3-0.webflow.io/starter-dashboard---availability-stage' },
    activeConfigIds: [],
    newConfigs: [],
  })
  await settle()

  const add = result.calls.find((call) => call.path === '/grants/add/v3')
  assert.equal(add.body.in_redirect_uri, 'https://the-starters-3-0.webflow.io/starter-dashboard---availability-stage')
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.intentStillStored(), false)
})

test('preserved OAuth rejects missing or mismatched server attestations before any configuration writes', async () => {
  const badReceipts = [
    { transition_id: 'other-transition' }, { previous_grant_retained: false },
    { replaced_grant_id: 'another-old-grant' }, { default_selected: false },
    { services_ready: false }, { manager: 'platform' },
    { grant_id: 'old-grant' }, { grant_id: '' },
    { active_config_ids: undefined }, { active_config_ids: ['new-free', 'new-free'], active_service_count: 2 },
    { active_config_ids: ['new-free'], active_service_count: 0 },
  ]
  for (const receipt of badReceipts) {
    const result = preservedOAuthCase({ receipt, selectOnAdd: false })
    await settle()
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
    assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
    assert.equal(result.intentStillStored(), true)
    assert.ok(result.warnings.some((warning) => warning.includes('did not verify booking preservation')))
  }
})

test('preserved hosted OAuth requires the receipt grant to match the hosted callback', async () => {
  const result = preservedOAuthCase({ search: '?success=true&grant_id=different-grant&state=member-a' })
  await settle()
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.intentStillStored(), true)
  assert.ok(result.warnings.some((warning) => warning.includes('did not verify booking preservation')))
})

test('preserved OAuth fails closed if canonical selection or config ownership disagrees with the receipt', async () => {
  const unexpectedConfig = {
    config_id: 'unexpected-free',
    grant_id: 'new-grant',
    duration: 30,
    is_paid: false,
    active: true,
  }
  for (const options of [
    { selectOnAdd: false },
    { wrongConfigGrant: true },
    { activeConfigIds: ['new-free'], newConfigs: [] },
    { activeConfigIds: [], newConfigs: [unexpectedConfig] },
    { activeConfigIds: ['new-free'], newConfigs: [unexpectedConfig] },
    { bindingVersion: null },
  ]) {
    const result = preservedOAuthCase(options)
    await settle()
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.intentStillStored(), true)
    assert.ok(result.warnings.some((warning) => warning.includes('does not match the verified transition')))
  }
})

test('a resumed preserved code callback exchanges through the server even while the old default is usable', async () => {
  const result = preservedOAuthCase({
    search: '',
    sessionStorage: {
      'starter-scheduling-oauth-callback': JSON.stringify({
        capturedAt: Date.now(), code: 'fixture-code', state: 'member-a',
      }),
    },
  })
  await settle()
  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
  assert.equal(result.intentStillStored(), false)
  assertNoCalendarReplacementWrites(result.calls)
})

test('a persisted completed preservation receipt resumes without re-exchanging the one-use code', async () => {
  const result = preservedOAuthCase({
    selected: true,
    intent: {
      oauthGrantSaved: true,
      grantReceipt: {
        transition_id: 'transition-fixture', previous_grant_retained: true,
        replaced_grant_id: 'old-grant', grant_id: 'new-grant', default_selected: true,
        services_ready: true, manager: 'calendar',
        active_config_ids: ['new-free'], active_service_count: 1,
      },
    },
  })
  await settle()
  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assert.equal(result.intentStillStored(), false)
  assertNoCalendarReplacementWrites(result.calls)
})

test('cancelled and abandoned preserved OAuth never rebuilds a virtual calendar or restores paid settings', async () => {
  for (const search of ['?error=access_denied&state=member-a', '']) {
    const result = preservedOAuthCase({
      search,
      paidCallIntent: { title: 'Paid Consultation', price_cents: 15000, duration_minutes: 60 },
    })
    await settle()
    assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  }
})

test('staging cancelled preserved OAuth does not bootstrap a Free config', async () => {
  const result = preservedOAuthCase({
    hostname: 'the-starters-3-0.webflow.io',
    pathname: '/starter-dashboard---availability-stage',
    origin: 'https://the-starters-3-0.webflow.io',
    search: '?error=access_denied&state=member-a',
    intent: { redirectUri: 'https://the-starters-3-0.webflow.io/starter-dashboard---availability-stage' },
    oldConfigs: [],
    paidCallIntent: { title: 'Paid Consultation', price_cents: 15000, duration_minutes: 60 },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  assert.equal(result.intentStillStored(), false)
})

test('preserved OAuth transient failure leaves the old default and transition available for retry', async () => {
  const result = preservedOAuthCase({ addFailure: true })
  await settle()
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  assert.equal(result.intentStillStored(), true)
})

test('a partial availability save explains that canonical settings were saved but booking times need retry', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: { '/scheduler/configurations/update/v3': () => ({ status: 503, body: null }) },
  })
  await settle()
  result.dom.fields.days[0].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()
  assert.equal(result.window.STARTER_AVAILABILITY.items.general.start, '10:00')
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.equal(result.dom.errorText.textContent,
    "Your availability was saved, but booking times could not be verified. Please try again or contact support.")
})

test('a completed preserved receipt rejects another hosted grant without re-exchanging the code', async () => {
  const result = preservedOAuthCase({
    search: '?success=true&grant_id=other-grant&state=member-a',
    selected: true,
    intent: { grantReceipt: {
      transition_id: 'transition-fixture', previous_grant_retained: true,
      replaced_grant_id: 'old-grant', grant_id: 'new-grant', default_selected: true,
      services_ready: true, manager: 'calendar',
      active_config_ids: ['new-free'], active_service_count: 1,
    } },
  })
  await settle()
  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.intentStillStored(), true)
  assert.ok(result.warnings.some((warning) => warning.includes('does not match the completed transition')))
})
