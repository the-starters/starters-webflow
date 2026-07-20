const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./scheduling-availability-writer.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

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
  steps['how-to-manage'].appendChild(buttons.managerSubmit)

  buttons.preRedirect = new El('a', { 'availability-action-btn': 'pre-redirect' })
  steps['how-to-manage'].appendChild(buttons.preRedirect)

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
  root.appendChild(managers.platform)
  root.appendChild(managers.calendar)
  root.appendChild(new El('div', { 'config-manager-element': '' }))
  root.appendChild(new El('div', { 'change-manager-link': '', 'data-type': 'platform' }))
  root.appendChild(new El('div', { 'change-manager-link': '', 'data-type': 'calendar' }))
  root.appendChild(new El('div', { 'bookings-wrapper': '' }))
  root.appendChild(new El('div', { 'config-initial-element': '' }))
  root.appendChild(new El('div', { 'config-initial-element': 'general' }))
  root.appendChild(new El('div', { 'config-initial-element': 'setup-form' }))

  const template = new El('div', { 'availability-template': '' })
  template.appendChild(new El('div', { 'availability-title': '' }))
  template.appendChild(new El('div', { 'availability-days': '' }))
  template.appendChild(new El('div', { 'availability-time': '' }))
  template.appendChild(new El('div', { 'availability-type': '' }))
  root.appendChild(template)
  const list = new El('div', { 'availability-list': '' })
  root.appendChild(list)

  return { root, steps, form, fields, buttons, managers, list }
}

const MEMBER_A = () => ({
  id: 'member-a',
  customFields: {
    'nylas-grant-id': 'grant-1',
    'nylas-grant-email': 'grant@example.com',
    'nylas-calendar-id': 'cal-1',
    'airtable-id': 'recAIRTABLE1',
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
    '/starter/update_availability': () => ({ status: 200, body: { id: 1 } }),
    '/starter/get_by_memberstack': () => ({
      status: 200,
      body: { id: 1, timezone: 'Asia/Manila', availability: defaultAvailability() },
    }),
    '/starter/set_timezone': () => ({ status: 200, body: { timezone: 'Asia/Manila' } }),
    '/starter/clear_calendar_data': () => ({ status: 200, body: { id: 1 } }),
    '/nylas_configurations/get_all': () => ({
      status: 200,
      body: [
        { config_id: 'cfg-free', grant_id: 'grant-1', is_paid: false },
        { config_id: 'cfg-paid', grant_id: 'grant-1', is_paid: true },
      ],
    }),
    '/scheduler/configurations/create': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/scheduler/configurations/update': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/scheduler/configurations/delete': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/grants/oauth/v3': () => ({
      status: 200,
      body: { response: { result: { data: { url: 'https://nylas.example/oauth' } } } },
    }),
    '/grants/create_virtual_account': () => ({
      status: 200,
      body: { response: { result: { data: { id: 'vgrant-1', email: 'virtual@example.com' } } } },
    }),
    '/grants/add_virtual/v3': () => ({ status: 200, body: { id: 5 } }),
    '/grants/create_virtual_calendar': () => ({
      status: 200,
      body: { response: { result: { data: { id: 'vcal-1' } } } },
    }),
    '/grants/delete': () => ({ status: 200, body: {} }),
  }
  return { ...routes, ...overridesMap }
}

function loadWriter(options = {}) {
  const dom = buildDom(options)
  const timers = []
  const calls = []
  const opened = []
  const historyCalls = []
  const events = []
  const warnings = []
  const storage = new Map(Object.entries(options.storage || {}))

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
          calls.push({ path, body: JSON.parse(init.body) })
          const route = routes[path]
          if (!route) throw new Error('unrouted path ' + path)
          const result = route(JSON.parse(init.body))
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
      pathname: '/starter-dashboard---availability-stage',
      origin: 'https://the-starters-3-0.webflow.io',
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
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
    clickAction,
    dom,
    events,
    flushTimers,
    harness,
    historyCalls,
    opened,
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

test('does not install outside V3 Webflow staging', () => {
  const result = loadWriter({ hostname: 'www.thestarters.com' })
  assert.equal(result.window.StarterSchedulingAvailabilityWriter, undefined)
  assert.equal(result.status(), null)
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
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  assert.equal(result.status(), 'ready')
  const configsCall = result.calls.find((c) => c.path === '/nylas_configurations/get_all')
  assert.deepEqual(configsCall.body, { grant_id: 'grant-1' })
  assert.equal(result.dom.list.children.length, 1)
  assert.equal(
    result.dom.list.children[0].querySelector('[availability-title]').textContent,
    'General Availability',
  )
  assert.equal(
    result.dom.root.querySelector('[bookings-wrapper]').style.display,
    'flex',
  )
  assert.ok(result.events.some((e) => e.type === 'starterSchedulingWriterReady'))
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
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.dom.fields.days[1].checked = true
  result.dom.fields.start.value = '10:00'
  result.dom.fields.end.value = '16:00'
  result.clickAction(result.dom.buttons.submit)
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability')
  assert.equal(update.body.member_id, 'member-a')
  assert.deepEqual(update.body.availability.items.general.days, [1])
  assert.equal(update.body.availability.items.general.start, '10:00')

  const configUpdates = result.calls.filter(
    (c) => c.path === '/scheduler/configurations/update',
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

test('shows and hides the step loader around a submit', async () => {
  let releaseUpdate
  const gate = new Promise((resolve) => {
    releaseUpdate = resolve
  })
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/starter/update_availability': () => {
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
    result.calls.filter((c) => c.path === '/starter/update_availability').length,
    0,
  )
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
  assert.ok(result.events.some((e) => e.type === 'starterSchedulingWriteError'))
})

test('choosing own-calendar clears grant data and lands on success-calendar', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.dom.managers.calendar.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  const clear = result.calls.find((c) => c.path === '/starter/clear_calendar_data')
  assert.deepEqual(clear.body, { member_id: 'member-a' })
  const update = result.calls.find((c) => c.path === '/starter/update_availability')
  assert.equal(update.body.availability.manager, null)
  assert.equal(result.dom.steps['success-calendar'].style.display, 'block')
})

test('own-calendar prefers the page bookings-aware clearGrantData composite', async () => {
  const composite = []
  const result = loadWriter({
    storage: TZ_CACHED,
    clearGrantData: async (memberId, grantId) => composite.push({ memberId, grantId }),
  })
  await settle()

  result.dom.managers.calendar.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  assert.deepEqual(composite, [{ memberId: 'member-a', grantId: 'grant-1' }])
  assert.equal(
    result.calls.filter((c) => c.path === '/starter/clear_calendar_data').length,
    0,
  )
})

test('choosing platform creates the virtual calendar chain and configs', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({ availability, storage: TZ_CACHED })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  const paths = result.calls.map((c) => c.path)
  const accountIndex = paths.indexOf('/grants/create_virtual_account')
  const addIndex = paths.indexOf('/grants/add_virtual/v3')
  const calendarIndex = paths.indexOf('/grants/create_virtual_calendar')
  assert.ok(accountIndex > -1 && addIndex > accountIndex && calendarIndex > addIndex)

  const add = result.calls[addIndex]
  assert.deepEqual(add.body, { grant_id: 'vgrant-1', member_id: 'member-a' })

  // No paid-call rate is resolvable, so only the free config is created.
  const creates = result.calls.filter((c) => c.path === '/scheduler/configurations/create')
  assert.equal(creates.length, 1)
  assert.match(creates[0].body.in_config_name, /^Free Consultation Call/)
  for (const create of creates) assert.equal(create.body.grant_id, 'vgrant-1')

  const update = result.calls.find((c) => c.path === '/starter/update_availability')
  assert.equal(update.body.availability.manager, 'platform')
  assert.equal(result.dom.steps.success.style.display, 'block')
})

test('platform setup failure shows config-request-error and writes nothing', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    storage: TZ_CACHED,
    routes: {
      '/grants/create_virtual_account': () => ({ status: 500, body: { message: 'nope' } }),
    },
  })
  await settle()

  result.dom.managers.platform.click()
  result.clickAction(result.dom.buttons.managerSubmit)
  await settle()

  assert.equal(
    result.calls.filter((c) => c.path === '/starter/update_availability').length,
    0,
  )
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
})

test('disconnect flow: confirm navigates to its step, disconnect rebuilds a virtual calendar', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.clickAction(result.dom.buttons.disconnectConfirm)
  assert.equal(result.dom.steps['disconnect-calendar'].style.display, 'block')

  result.clickAction(result.dom.buttons.disconnectCalendar)
  await settle()

  const paths = result.calls.map((c) => c.path)
  assert.ok(paths.indexOf('/starter/clear_calendar_data') > -1)
  const accountIndex = paths.indexOf('/grants/create_virtual_account')
  const calendarIndex = paths.indexOf('/grants/create_virtual_calendar')
  assert.ok(accountIndex > -1 && calendarIndex > accountIndex)

  const update = result.calls.find((c) => c.path === '/starter/update_availability')
  assert.equal(update.body.member_id, 'member-a')
  assert.equal(update.body.availability.manager, 'platform')
  assert.equal(result.dom.steps['success-disconnect'].style.display, 'block')

  const loader = result.dom.steps['disconnect-calendar'].querySelector('[data-custom-loader]')
  assert.match(loader.getAttribute('style'), /visibility: hidden/)
})

test('pre-redirect sends the authenticated member id as OAuth state', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.clickAction(result.dom.buttons.preRedirect)
  assert.equal(result.dom.steps['pre-redirect'].style.display, 'block')
  result.flushTimers()
  await settle()

  const oauth = result.calls.find((c) => c.path === '/grants/oauth/v3')
  assert.deepEqual(oauth.body, { in_state: 'member-a', in_provider: 'google' })
  assert.deepEqual(result.opened, [{ url: 'https://nylas.example/oauth', target: '_blank' }])
  assert.equal(result.dom.steps['reload-page'].style.display, 'block')
})

test('pre-redirect aborts when the member session changed', async () => {
  const result = loadWriter({ storage: TZ_CACHED })
  await settle()

  result.clickAction(result.dom.buttons.preRedirect)
  result.harness.setActiveMember({ id: 'member-b', customFields: {} })
  result.flushTimers()
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/oauth/v3').length, 0)
  assert.equal(result.opened.length, 0)
  assert.equal(result.dom.steps['config-request-error'].style.display, 'block')
})

test('a stored paid rate restores the free+paid config pair', async () => {
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

  const creates = result.calls.filter((c) => c.path === '/scheduler/configurations/create')
  assert.equal(creates.length, 2)
  const paid = creates.find((c) => /^Paid Consultation Call/.test(c.body.in_config_name))
  assert.ok(paid, 'expected a paid configuration')
  assert.match(paid.body.in_config_name, /\$150$/)
  assert.equal(result.dom.steps.success.style.display, 'block')
})

test('config update rejection lands on config-request-error', async () => {
  const result = loadWriter({
    storage: TZ_CACHED,
    routes: {
      '/scheduler/configurations/update': () => ({
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
})

test('removing an override returns its days to the general schedule', async () => {
  const availability = defaultAvailability()
  availability.items.general.days = [1, 2]
  availability.items['ov-1'] = { days: [3], start: '13:00', end: '15:00' }
  const result = loadWriter({ availability, storage: TZ_CACHED })
  await settle()

  const item = new El('div', { 'availability-item': '' })
  item.dataset.id = 'ov-1'
  const removeBtn = new El('a', { 'availability-action-btn': 'availability-remove' })
  item.appendChild(removeBtn)
  result.dom.root.appendChild(item)

  result.clickAction(removeBtn)
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability')
  assert.deepEqual(update.body.availability.items.general.days, [1, 2, 3])
  assert.equal(update.body.availability.items['ov-1'], undefined)
  assert.equal(
    result.calls.filter((c) => c.path === '/scheduler/configurations/update').length,
    2,
  )
})

test('returning from the calendar OAuth round trip records the calendar manager', async () => {
  const availability = defaultAvailability()
  availability.manager = null
  const result = loadWriter({
    availability,
    search: '?calendar=google',
    storage: TZ_CACHED,
    routes: {
      '/nylas_configurations/get_all': () => ({ status: 200, body: [] }),
    },
  })
  await settle()

  const update = result.calls.find((c) => c.path === '/starter/update_availability')
  assert.equal(update.body.member_id, 'member-a')
  assert.equal(update.body.availability.manager, 'calendar')
  // Rate-less starter: only the free config is created on the OAuth return.
  assert.equal(
    result.calls.filter((c) => c.path === '/scheduler/configurations/create').length,
    1,
  )
  assert.equal(result.historyCalls.length, 1)
  assert.equal(result.dom.steps.default.style.display, 'block')
})

test('resolves and persists the timezone through authenticated endpoints', async () => {
  const result = loadWriter({
    routes: {
      '/starter/get_by_memberstack': () => ({
        status: 200,
        body: { id: 1, timezone: '', availability: defaultAvailability() },
      }),
    },
  })
  await settle()

  const setCall = result.calls.find((c) => c.path === '/starter/set_timezone')
  assert.equal(setCall.body.member_id, 'member-a')
  assert.ok(setCall.body.timezone.length > 0)
  assert.equal(result.storage.get('starter-timezone:member-a'), 'Asia/Manila')
})
