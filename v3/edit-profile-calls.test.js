const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const { bootAllowed, paidBlocker, paidIntent, createEditCalls } = require('./edit-profile-calls.js')
const calendar = require('./onboarding-calendar.js')
const shared = require('./calendar-google-connect.js')
const { mount: mountEditor } = require('./profile-calls-step.js')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const S = XANO + '/api:tCpV3oqd'
const ENSURE = S + '/onboarding/calendar/ensure-default/v3'
const STARTER = S + '/starter/get_by_memberstack/v3'
const OAUTH = S + '/grants/oauth/v3'
const FREE_GET = S + '/starter/free-call-settings/get/v3'
const FREE_UPSERT = S + '/starter/free-call-settings/upsert/v3'
const FREE_DISABLE = S + '/starter/free-call-settings/disable/v3'
const PAID_GET = S + '/starter/paid-call-settings/get/v3'
const PAID_UPSERT = S + '/starter/paid-call-settings/upsert/v3'
const PAID_DISABLE = S + '/starter/paid-call-settings/disable/v3'
const GOOGLE_URL = 'https://api.us.nylas.com/v3/connect/auth?client_id=c&state=mem_edit1'

function flush() { return new Promise((resolve) => setImmediate(resolve)) }
async function settle() { for (let i = 0; i < 30; i++) await flush() }
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

// Fake DOM: compound attribute selectors, tag names and comma lists.
function matchesOne(el, selector) {
  const tag = /^([a-z]+)/.exec(selector)
  if (tag && el.tagName !== tag[1].toUpperCase()) return false
  const parts = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
  if (!tag && !parts.length) return false
  return parts.every(([, name, expected]) => {
    const actual = el.getAttribute(name)
    return actual !== null && (expected === undefined || actual === expected)
  })
}

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase()
    this.attrs = new Map(Object.entries(attrs))
    this.children = []
    this.parentElement = null
    this.listeners = []
    this.textContent = ''
    this.hidden = false
    this.disabled = false
    this.checked = false
    this.style = {}
    this.value = attrs.value || ''
    children.forEach((child) => this.appendChild(child))
  }
  get dataset() {
    const out = {}
    for (const [name, value] of this.attrs) if (name.startsWith('data-')) out[name.slice(5)] = value
    return out
  }
  get options() { return this.children }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null }
  setAttribute(name, value) { this.attrs.set(name, String(value)) }
  removeAttribute(name) { this.attrs.delete(name) }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child }
  replaceChildren() { this.children = [] }
  remove() { this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]) }
  matches(selector) { return selector.split(',').some((part) => matchesOne(this, part.trim())) }
  querySelectorAll(selector) { return this.descendants().filter((el) => el.matches(selector)) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node
    return null
  }
  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true
    return false
  }
  cloneNode() {
    const copy = new El(this.tagName, Object.fromEntries(this.attrs), this.children.map((c) => c.cloneNode()))
    copy.value = this.value
    copy.textContent = this.textContent
    copy.hidden = this.hidden
    return copy
  }
  addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture: capture === true }) }
  dispatch(type) {
    const event = { type, target: this, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true }, stopImmediatePropagation() { this.stopped = true } }
    const chain = []
    for (let n = this; n; n = n.parentElement) chain.push(n)
    for (const n of chain.slice().reverse()) for (const l of n.listeners) if (l.type === type && l.capture) { l.fn(event); if (event.stopped) return event }
    for (const n of chain) for (const l of n.listeners) if (l.type === type && !l.capture) l.fn(event)
    return event
  }
  click() { return this.disabled ? null : this.dispatch('click') }
}

function freeService(overrides = {}) {
  return { config_id: 11, revision: 3, active: true, duration: 30, price_cents: 0, ...overrides }
}
function paidService(overrides = {}) {
  return { config_id: 22, revision: 5, active: true, duration: 60, price_cents: 15000, currency: 'usd', title: 'Strategy call', ...overrides }
}
const READY = { calendar_connected: true, availability_configured: true, stripe_connect_linked: true, stripe_charges_enabled: true, stripe_readiness_fresh: true }

function makePage(options = {}) {
  const {
    path = '/starter-edit-profile-test',
    origin = 'https://www.thestarters.com',
    guard = true,
    starter = {
      timezone: 'Asia/Manila',
      availability: {
        manager: 'platform',
        items: {
          general: { days: [1, 2, 3], start: '09:00', end: '12:00', defaultDays: [1, 2, 3] },
          'window-2': { days: [1, 2, 3], start: '13:00', end: '17:00', defaultDays: [1, 2, 3], kind: 'window' },
          'override-1700': { days: [2], start: '10:00', end: '11:00' },
        },
      },
      nylas_grant_id: '',
    },
    free = { services: [], readiness: { calendar_connected: true, availability_configured: true }, public_description: '' },
    paid = { services: [], readiness: { ...READY } },
    fail = {},
    callback = null,
  } = options
  const server = { starter, free: structuredClone(free), paid: structuredClone(paid), fail }
  const calls = []
  const warnings = []
  const timers = new Map()
  let nextTimer = 1
  const docListeners = {}
  const assigned = []
  const el = (tag, attrs, children) => new El(tag, attrs, children)
  const select = (kind, value) => el('select', { 'data-calls-step-input': kind, value })
  const toggle = (id) => el('input', { id, 'data-call-settings-input': 'enabled', value: 'yes' })
  const freeToggle = toggle('free-consulting-calls')
  const description = el('input', { id: 'free-call-description', 'data-call-settings-input': 'description' })
  const paidToggle = toggle('paid-consulting-calls')
  const title = el('input', { id: 'paid-call-description', 'data-call-settings-input': 'title' })
  const price = el('input', { id: 'paid-call-rate', 'data-call-settings-input': 'price' })
  const freeStatus = el('p', { 'data-call-settings-output': 'status' })
  const paidStatus = el('p', { 'data-call-settings-output': 'status' })
  const freeRow = el('div', { 'data-call-settings-service': 'free' }, [freeToggle, el('div', { 'data-call-settings-element': 'panel' }, [description]), freeStatus])
  const paidRow = el('div', { 'data-call-settings-service': 'paid' }, [paidToggle, el('div', { 'data-call-settings-element': 'panel' }, [title, price]), paidStatus])
  const day = (n) => el('button', { 'data-day': String(n), 'aria-pressed': 'false' })
  const days = el('div', { 'data-calls-step-element': 'days' }, [1, 2, 3, 4, 5, 6, 0].map(day))
  const windows = el('div', { 'data-calls-step-element': 'windows' }, [el('div', { 'data-calls-step-element': 'window' }, [
    select('window-start', '9:00 AM'), select('window-end', '6:00 PM'), el('button', { 'data-calls-step-action': 'remove-window' }),
  ])])
  const extra = el('div', { 'data-calls-step-element': 'extra' }, [select('extra-start', ''), select('extra-end', ''), el('button', { 'data-calls-step-action': 'remove-extra' })])
  const error = el('p', { 'data-calls-step-element': 'error' })
  const connect = el('button', { 'data-calls-step-action': 'connect-google' })
  const switchCalendar = el('button', { 'data-calls-step-action': 'switch-calendar' })
  const disconnect = el('button', { 'data-calls-step-action': 'disconnect-calendar' })
  const addWindow = el('button', { 'data-calls-step-action': 'add-window' })
  const addExtra = el('button', { 'data-calls-step-action': 'add-extra' })
  const availability = el('div', { 'data-calls-step-element': 'availability' }, [
    days, el('div', { 'data-calls-step-element': 'extra-days' }), windows, addWindow, addExtra, extra, select('timezone', ''),
    el('span', { 'data-calls-step-output': 'timezone-now' }),
  ])
  const calendarEl = el('div', { 'data-calls-step-element': 'calendar' }, [
    el('span', { 'data-calls-step-output': 'calendar-tag' }), connect,
    el('div', { 'data-calls-step-element': 'calendar-connected' }, [switchCalendar, disconnect]),
  ])
  const root = el('div', { 'data-calls-step': 'root', 'data-calls-step-context': 'edit' }, [freeRow, paidRow, availability, calendarEl, error])
  const body = el('body', {}, [root])
  extra.hidden = true
  const storage = new Map()
  const tab = { closed: false, opener: {}, url: null, location: { replace(u) { tab.url = u } }, close() { tab.closed = true } }

  function route(url, method, payload) {
    if (url.startsWith(XANO + '/api:g1vmSLWh/auth/trade-token/v3')) return response(200, { authToken: 'xano-jwt' })
    const failure = server.fail[url]
    if (failure) return response(failure, { message: 'nope' })
    if (url === STARTER) return response(200, server.starter)
    if (url === ENSURE) {
      server.starter = { ...server.starter, availability: { ...server.starter.availability, items: payload.availability.items } }
      server.free.readiness = { calendar_connected: true, availability_configured: true }
      return response(200, { steps_done: ['update_availability'] })
    }
    if (url === FREE_GET) return response(200, structuredClone(server.free))
    if (url === PAID_GET) return response(200, structuredClone(server.paid))
    if (url === FREE_UPSERT) {
      const current = server.free.services.find((s) => s.active)
      server.free.services = [freeService({ config_id: payload.config_id || 11, revision: (current ? current.revision : 0) + 1 })]
      server.free.public_description = server.fail.freeDescriptionDrift ? 'other' : payload.description
      return response(200, { ok: true })
    }
    if (url === FREE_DISABLE) { server.free.services = server.free.services.map((s) => ({ ...s, active: false })); return response(200, { ok: true }) }
    if (url === PAID_UPSERT) {
      server.paid.services = [paidService({ config_id: payload.config_id || 22, title: payload.title, price_cents: payload.price_cents, duration: payload.duration_minutes })]
      return response(200, { ok: true })
    }
    if (url === PAID_DISABLE) { server.paid.services = server.paid.services.map((s) => ({ ...s, active: false })); return response(200, { ok: true }) }
    if (url === OAUTH) return response(200, { response: { result: { data: { url: GOOGLE_URL } } } })
    throw new Error('unexpected ' + method + ' ' + url)
  }

  const win = {
    location: { origin, pathname: path, assign: (u) => assigned.push(u) },
    $memberstackDom: {
      getMemberCookie: () => Promise.resolve('ms'),
      getCurrentMember: () => Promise.resolve({ data: { id: 'mem_edit1' } }),
    },
    crypto: { randomUUID: () => 'uuid-' + calls.length },
    setTimeout(fn, ms) {
      if (ms === 20000) return 0
      const id = nextTimer++
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    setInterval() { return 0 },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    open: () => tab,
    console: { warn: (...args) => warnings.push(args.join(' ')) },
    fetch(url, init = {}) {
      const payload = init && init.body ? JSON.parse(init.body) : undefined
      calls.push({ url, method: init.method, body: payload, auth: init.headers && init.headers.Authorization })
      try { return Promise.resolve(route(url, init.method, payload)) } catch (e) { return Promise.reject(e) }
    },
    document: {
      querySelector: (sel) => (sel === 'script[src*="/v3/staff-preview-guard.js"]' ? (guard ? {} : null) : body.querySelector(sel)),
      querySelectorAll: (sel) => body.querySelectorAll(sel),
      addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn) },
    },
    StartersCalendarGoogleConnect: { ...shared, pendingCallback: callback },
  }
  root.ownerDocument = { defaultView: win, createElement: (tag) => el(tag) }
  const editors = new Map()
  const editorFor = (r) => { if (!editors.has(r)) editors.set(r, mountEditor(r)); return editors.get(r) }
  const controller = createEditCalls(win, { calendar, editorFor })

  async function tick() {
    await settle()
    for (let round = 0; round < 5 && timers.size; round++) {
      const due = [...timers.values()]
      timers.clear()
      due.forEach((t) => t.fn())
      await settle()
    }
  }
  const writes = () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/get_by_memberstack/v3'))
  const writesTo = (url) => calls.filter((c) => c.url === url)
  const stripe = (state) => (docListeners['starters:stripe-connect-state'] || []).forEach((fn) => fn({ detail: { state } }))
  return {
    win, server, calls, warnings, root, error, freeToggle, description, paidToggle, title, price, freeRow, paidRow, freeStatus, paidStatus,
    days, windows, addWindow, addExtra, connect, switchCalendar, disconnect, tab, assigned, timers, storage,
    controller, editor: () => editorFor(root), tick, writes, writesTo, stripe,
  }
}

async function ready(options) {
  const page = makePage(options)
  assert.equal(await page.controller.mount(), 'ready', page.warnings.join('\n'))
  return page
}

const pressed = (page) => page.days.querySelectorAll('[data-day][aria-pressed="true"]').map((d) => Number(d.getAttribute('data-day')))

// ---- boot gating ----

test('boot: only /starter-edit-profile-test, on staging or on production with the staff guard', () => {
  const win = (o) => makePage(o).win
  assert.equal(bootAllowed(win({})), true)
  assert.equal(bootAllowed(win({ path: '/starter-edit-profile-test/' })), true)
  assert.equal(bootAllowed(win({ origin: 'https://thestarters.com' })), true)
  assert.equal(bootAllowed(win({ origin: 'https://the-starters-3-0.webflow.io', guard: false })), true)
  assert.equal(bootAllowed(win({ guard: false })), false)
  assert.equal(bootAllowed(win({ origin: 'https://www.thestarters.com.evil.example' })), false)
  assert.equal(bootAllowed(win({ origin: 'http://www.thestarters.com' })), false)
  for (const path of ['/starter-edit-profile', '/starter-dashboard', '/starter-onboarding-v2', '/build-profile/consult-test', '/']) {
    assert.equal(bootAllowed(win({ path })), false, path)
  }
})

test('browser boot: nothing starts and no request is made on another path', () => {
  const source = fs.readFileSync(require.resolve('./edit-profile-calls.js'), 'utf8')
  for (const pathname of ['/starter-edit-profile', '/starter-dashboard']) {
    let fetched = 0
    const window = {
      location: { origin: 'https://the-starters-3-0.webflow.io', pathname },
      document: { readyState: 'complete', querySelector: () => null, addEventListener() {} },
      fetch() { fetched++ },
      StartersOnboardingCalendar: calendar,
      StarterProfileCallsStep: { editorFor() { throw new Error('should not mount') } },
    }
    vm.runInNewContext(source, { window })
    assert.equal(window.__startersEditProfileCallsBooted, undefined, pathname)
    assert.equal(fetched, 0, pathname)
  }
})

test('browser boot: the staging draft boots once and asks for the editor', () => {
  const source = fs.readFileSync(require.resolve('./edit-profile-calls.js'), 'utf8')
  let asked = 0
  const window = {
    location: { origin: 'https://the-starters-3-0.webflow.io', pathname: '/starter-edit-profile-test' },
    document: { readyState: 'complete', querySelector: () => ({}), addEventListener() {} },
    console: { warn() {} },
    StartersOnboardingCalendar: { ...calendar, createController: () => ({ setupGoogle: () => false }) },
    StarterProfileCallsStep: { editorFor() { asked++; return null } },
  }
  vm.runInNewContext(source, { window })
  vm.runInNewContext(source, { window })
  assert.equal(window.__startersEditProfileCallsBooted, true)
  assert.equal(asked, 1)
})

// ---- load ----

test('load fills the editor from the Starter row and both settings readers, with Bearer auth', async () => {
  const page = await ready({
    free: { services: [freeService()], readiness: { calendar_connected: true, availability_configured: true }, public_description: 'Say hi' },
    paid: { services: [paidService()], readiness: { ...READY } },
  })
  const editor = page.editor()
  assert.deepEqual(editor.read(), {
    timezone: 'Asia/Manila',
    days: [1, 2, 3],
    windows: [{ start: '9:00 AM', end: '12:00 PM' }, { start: '1:00 PM', end: '5:00 PM' }],
    extra: null,
  })
  assert.equal(page.freeToggle.checked, true)
  assert.equal(page.description.value, 'Say hi')
  assert.equal(page.paidToggle.checked, true)
  assert.equal(page.title.value, 'Strategy call')
  assert.equal(page.price.value, '150')
  assert.equal(page.root.getAttribute('data-edit-calls-state'), 'ready')
  assert.deepEqual(page.calls.filter((c) => c.method === 'GET').map((c) => c.url).sort(), [FREE_GET, PAID_GET])
  assert.ok(page.calls.filter((c) => !c.url.includes('trade-token')).every((c) => c.auth === 'Bearer xano-jwt'))
  assert.equal(page.writes().length, 0, 'loading writes nothing')
})

test('load shows a Google calendar as connected only for manager calendar with a grant', async () => {
  const page = await ready({ starter: { timezone: 'UTC', availability: { manager: 'calendar', items: {} }, nylas_grant_id: 'g-1', nylas_grant_email: 'a@b.co' } })
  assert.equal(page.root.querySelector('[data-calls-step-output="calendar-tag"]').textContent, 'Connected')
  const other = await ready({ starter: { timezone: 'UTC', availability: { manager: 'platform', items: {} }, nylas_grant_id: 'g-1' } })
  assert.equal(other.root.querySelector('[data-calls-step-output="calendar-tag"]').textContent, 'Not connected')
})

test('a failed load shows the error, wires no connect button and never saves', async () => {
  const page = makePage({ fail: { [FREE_GET]: 500 } })
  assert.equal(await page.controller.mount(), 'load-failed')
  assert.equal(page.root.getAttribute('data-edit-calls-state'), 'error')
  assert.match(page.error.textContent, /couldn’t load/)
  page.days.querySelector('[data-day="5"]').click()
  page.freeToggle.checked = true
  page.freeToggle.dispatch('change')
  page.connect.click()
  await page.tick()
  assert.equal(page.writes().length, 0)
  assert.equal(page.tab.url, null)
})

// ---- hours autosave ----

test('hours autosave: one debounced #12047 save for several quick changes, keeping the unshown override', async () => {
  const page = await ready({ free: { services: [freeService()], readiness: { calendar_connected: true, availability_configured: true }, public_description: '' } })
  page.days.querySelector('[data-day="4"]').click()
  page.days.querySelector('[data-day="5"]').click()
  assert.equal(page.writesTo(ENSURE).length, 0, 'nothing before the debounce')
  await page.tick()
  const saves = page.writesTo(ENSURE)
  assert.equal(saves.length, 1)
  const body = saves[0].body
  assert.equal(body.member_id, 'mem_edit1')
  assert.equal(body.in_timezone, 'Asia/Manila')
  assert.equal(body.offer_intro_call, true)
  assert.deepEqual(body.availability.items.general.days, [1, 2, 3, 4, 5])
  assert.deepEqual(body.availability.items['window-2'], { days: [1, 2, 3, 4, 5], start: '13:00', end: '17:00', defaultDays: [1, 2, 3, 4, 5], kind: 'window' })
  assert.deepEqual(body.availability.items['override-1700'], { days: [2], start: '10:00', end: '11:00' })
  assert.equal(page.root.getAttribute('data-edit-calls-hours'), 'saved')
})

test('hours autosave: invalid hours do not save; offer_intro_call follows the Free switch', async () => {
  const page = await ready()
  for (const d of [1, 2, 3]) page.days.querySelector('[data-day="' + d + '"]').click()
  await page.tick()
  assert.deepEqual(pressed(page), [])
  assert.equal(page.writesTo(ENSURE).length, 0)
  page.days.querySelector('[data-day="1"]').click()
  await page.tick()
  assert.equal(page.writesTo(ENSURE).length, 1)
  assert.equal(page.writesTo(ENSURE)[0].body.offer_intro_call, false)
})

test('hours autosave: a timezone change and window actions save; a failure shows the save error', async () => {
  const page = await ready({ fail: { [ENSURE]: 500 } })
  const tz = page.root.querySelector('[data-calls-step-input="timezone"]')
  tz.value = 'UTC'
  tz.dispatch('change')
  page.addWindow.click()
  await page.tick()
  assert.equal(page.writesTo(ENSURE).length, 1)
  assert.equal(page.root.getAttribute('data-edit-calls-hours'), 'error')
  assert.match(page.error.textContent, /couldn’t save your availability/)
})

test('hours autosave: a change made during a save runs exactly one more save afterwards', async () => {
  const page = await ready()
  page.days.querySelector('[data-day="4"]').click()
  for (const [id, t] of page.timers) { page.timers.delete(id); t.fn() }
  page.days.querySelector('[data-day="5"]').click()
  for (const [id, t] of page.timers) { page.timers.delete(id); t.fn() }
  page.days.querySelector('[data-day="6"]').click()
  for (const [id, t] of page.timers) { page.timers.delete(id); t.fn() }
  await page.tick()
  const saves = page.writesTo(ENSURE)
  assert.equal(saves.length, 2)
  assert.deepEqual(saves[1].body.availability.items.general.days, [1, 2, 3, 4, 5, 6])
})

// ---- Free call ----

test('Free on: upserts with the description, reads back, and does not write again when unchanged', async () => {
  const page = await ready()
  page.description.value = 'Quick intro'
  page.freeToggle.checked = true
  page.freeToggle.dispatch('change')
  await page.tick()
  const upserts = page.writesTo(FREE_UPSERT)
  assert.equal(upserts.length, 1)
  assert.deepEqual({ ...upserts[0].body, idempotency_key: undefined }, { config_id: null, description: 'Quick intro', expected_revision: 0, idempotency_key: undefined })
  assert.match(upserts[0].body.idempotency_key, /^free-call-upsert:/)
  assert.equal(page.freeRow.getAttribute('data-edit-calls-state'), 'saved')
  page.description.dispatch('change')
  await page.tick()
  assert.equal(page.writesTo(FREE_UPSERT).length, 1, 'unchanged service is not written again')
})

test('Free description typing saves once after the pause with the current revision', async () => {
  const page = await ready({ free: { services: [freeService()], readiness: { calendar_connected: true, availability_configured: true }, public_description: 'Old' } })
  page.description.value = 'New'
  page.description.dispatch('input')
  page.description.value = 'New text'
  page.description.dispatch('input')
  await page.tick()
  const upserts = page.writesTo(FREE_UPSERT)
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].body.description, 'New text')
  assert.equal(upserts[0].body.config_id, 11)
  assert.equal(upserts[0].body.expected_revision, 3)
})

test('Free on with no calendar yet saves the hours first, then upserts', async () => {
  const page = await ready({ free: { services: [], readiness: { calendar_connected: false, availability_configured: false }, public_description: '' } })
  page.freeToggle.checked = true
  page.freeToggle.dispatch('change')
  await page.tick()
  const order = page.writes().map((c) => c.url)
  assert.deepEqual(order, [ENSURE, FREE_UPSERT])
  assert.equal(page.writesTo(ENSURE)[0].body.offer_intro_call, true)
})

test('Free on with invalid hours and no calendar shows the reason and writes nothing', async () => {
  const page = await ready({ free: { services: [], readiness: { calendar_connected: false, availability_configured: false }, public_description: '' } })
  for (const d of [1, 2, 3]) page.days.querySelector('[data-day="' + d + '"]').click()
  page.freeToggle.checked = true
  page.freeToggle.dispatch('change')
  await page.tick()
  assert.equal(page.writes().length, 0)
  assert.equal(page.freeRow.getAttribute('data-edit-calls-state'), 'blocked')
  assert.equal(page.freeStatus.textContent, 'Set your weekly hours first.')
})

test('Free off: disables the active service and checks the readback', async () => {
  const page = await ready({ free: { services: [freeService()], readiness: { calendar_connected: true, availability_configured: true }, public_description: 'x' } })
  page.freeToggle.checked = false
  page.freeToggle.dispatch('change')
  await page.tick()
  const disables = page.writesTo(FREE_DISABLE)
  assert.equal(disables.length, 1)
  assert.equal(disables[0].body.config_id, 11)
  assert.equal(disables[0].body.expected_revision, 3)
  assert.match(disables[0].body.idempotency_key, /^free-call-disable:/)
  assert.equal(page.freeStatus.textContent, 'Free calls are off.')
})

test('Free failures: a server error or a description that does not read back shows the error', async () => {
  const failed = await ready({ fail: { [FREE_UPSERT]: 500 } })
  failed.freeToggle.checked = true
  failed.freeToggle.dispatch('change')
  await failed.tick()
  assert.equal(failed.freeRow.getAttribute('data-edit-calls-state'), 'error')
  assert.match(failed.freeStatus.textContent, /couldn’t save your free call/)

  const drift = await ready({ fail: { freeDescriptionDrift: true } })
  drift.description.value = 'Mine'
  drift.freeToggle.checked = true
  drift.freeToggle.dispatch('change')
  await drift.tick()
  assert.equal(drift.freeRow.getAttribute('data-edit-calls-state'), 'error')
})

test('Free description over 140 characters is refused before any write', async () => {
  const page = await ready()
  page.description.value = 'x'.repeat(141)
  page.freeToggle.checked = true
  page.freeToggle.dispatch('change')
  await page.tick()
  assert.equal(page.writesTo(FREE_UPSERT).length, 0)
  assert.equal(page.freeRow.getAttribute('data-edit-calls-state'), 'invalid')
})

// ---- Paid call ----

test('Paid on: validates title and price, then upserts 60 minutes and checks the readback', async () => {
  const page = await ready()
  page.title.value = 'Strategy session'
  page.price.value = '200'
  page.paidToggle.checked = true
  page.paidToggle.dispatch('change')
  await page.tick()
  const upserts = page.writesTo(PAID_UPSERT)
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].body.title, 'Strategy session')
  assert.equal(upserts[0].body.price_cents, 20000)
  assert.equal(upserts[0].body.duration_minutes, 60)
  assert.equal(upserts[0].body.config_id, null)
  assert.match(upserts[0].body.idempotency_key, /^paid-call-upsert:/)
  assert.equal(page.paidRow.getAttribute('data-edit-calls-state'), 'saved')
})

test('Paid on with a bad title or price shows the reason and writes nothing', async () => {
  const page = await ready()
  page.title.value = 'ab'
  page.price.value = '200'
  page.paidToggle.checked = true
  page.paidToggle.dispatch('change')
  await page.tick()
  assert.equal(page.paidStatus.textContent, 'Use a title between 3 and 80 characters.')
  page.title.value = 'Good title'
  page.price.value = '12.50'
  page.price.dispatch('change')
  await page.tick()
  assert.equal(page.paidStatus.textContent, 'Use a whole-dollar rate from $1 to $1,000.')
  assert.equal(page.writesTo(PAID_UPSERT).length, 0)
})

test('Paid on without Stripe shows the reason, then saves when Stripe reports ready', async () => {
  const page = await ready({ paid: { services: [], readiness: { ...READY, stripe_connect_linked: false, stripe_charges_enabled: false } } })
  page.title.value = 'Strategy session'
  page.price.value = '200'
  page.paidToggle.checked = true
  page.paidToggle.dispatch('change')
  await page.tick()
  assert.equal(page.paidRow.getAttribute('data-edit-calls-state'), 'blocked')
  assert.equal(page.paidStatus.textContent, 'To turn on paid calls, connect Stripe first. Stripe sends call payments to you.')
  assert.equal(page.writesTo(PAID_UPSERT).length, 0)
  page.stripe('opened')
  await page.tick()
  assert.equal(page.writesTo(PAID_UPSERT).length, 0, 'an opened Stripe tab is not a reason to retry')
  page.server.paid.readiness = { ...READY }
  page.stripe('ready')
  await page.tick()
  assert.equal(page.writesTo(PAID_UPSERT).length, 1)
  assert.equal(page.root.querySelector('[data-calls-step-output="stripe-tag"]'), null)
})

test('Paid off disables the active service; an unchanged service is not written again', async () => {
  const page = await ready({ paid: { services: [paidService()], readiness: { ...READY } } })
  page.title.dispatch('change')
  await page.tick()
  assert.equal(page.writesTo(PAID_UPSERT).length, 0)
  page.paidToggle.checked = false
  page.paidToggle.dispatch('change')
  await page.tick()
  const disables = page.writesTo(PAID_DISABLE)
  assert.equal(disables.length, 1)
  assert.equal(disables[0].body.config_id, 22)
  assert.equal(disables[0].body.expected_revision, 5)
  assert.equal(page.paidStatus.textContent, 'Paid calls are off.')
})

test('Paid failure: a server error shows the paid error', async () => {
  const page = await ready({ fail: { [PAID_DISABLE]: 409 }, paid: { services: [paidService()], readiness: { ...READY } } })
  page.paidToggle.checked = false
  page.paidToggle.dispatch('change')
  await page.tick()
  assert.equal(page.paidRow.getAttribute('data-edit-calls-state'), 'error')
})

test('paidBlocker and paidIntent follow the dashboard card rules', () => {
  assert.match(paidBlocker({ readiness: {} }), /connect your calendar/)
  assert.match(paidBlocker({ readiness: { ...READY, stripe_charges_enabled: false } }), /finish your Stripe setup/)
  assert.match(paidBlocker({ readiness: { ...READY, stripe_readiness_fresh: false } }), /updating/)
  assert.equal(paidBlocker({ readiness: READY }), '')
  assert.deepEqual(paidIntent(' Call ', '1000'), { title: 'Call', price_cents: 100000, duration_minutes: 60 })
  assert.ok(paidIntent('Call', '0').error)
  assert.ok(paidIntent('Call', '1001').error)
  assert.ok(paidIntent('x'.repeat(81), '5').error)
})

// ---- calendar ----

test('Connect Google saves the hours (keeping the override), then opens Google with this page as the return', async () => {
  const page = await ready()
  page.connect.click()
  await page.tick()
  assert.equal(page.writesTo(ENSURE).length, 1)
  assert.ok(page.writesTo(ENSURE)[0].body.availability.items['override-1700'])
  assert.equal(page.writesTo(OAUTH)[0].body.in_redirect_uri, 'https://www.thestarters.com/starter-edit-profile-test')
  assert.equal(page.tab.url, GOOGLE_URL)
})

test('Switch calendar uses the same connect flow; a queued autosave is folded into it', async () => {
  const page = await ready()
  page.days.querySelector('[data-day="4"]').click()
  page.switchCalendar.click()
  await page.tick()
  assert.equal(page.writesTo(ENSURE).length, 1, 'the connect save replaces the queued autosave')
  assert.equal(page.writesTo(OAUTH).length, 1)
})

test('Disconnect goes to the dashboard calendar section and writes nothing', async () => {
  const page = await ready()
  const event = page.disconnect.click()
  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(page.assigned, ['/starter-dashboard'])
  await page.tick()
  assert.equal(page.writes().length, 0)
})

test('on the Google return pop-up the shared module finishes the connection and the editor is not loaded', async () => {
  const page = makePage({ callback: { code: 'c', grantId: '', success: '', state: 'mem_edit1', hasError: false } })
  assert.equal(await page.controller.mount(), 'google-return')
  assert.equal(page.calls.some((c) => c.url === FREE_GET || c.url === PAID_GET), false)
})

test('Stripe state events update the editor status', async () => {
  const page = await ready()
  const statuses = []
  const editor = page.editor()
  const original = editor.setStatus
  editor.setStatus = (s) => { statuses.push(s); original(s) }
  page.stripe('pending')
  page.stripe('bogus')
  assert.deepEqual(statuses, [{ stripe: 'pending' }])
})
