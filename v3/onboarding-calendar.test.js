const assert = require('node:assert/strict')
const test = require('node:test')
const { bootAllowed, to24h, toItems, createController } = require('./onboarding-calendar.js')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const ENSURE = XANO + '/api:tCpV3oqd/onboarding/calendar/ensure-default/v3'
const STARTER = XANO + '/api:tCpV3oqd/starter/get_by_memberstack/v3'

function flush() { return new Promise((resolve) => setImmediate(resolve)) }
async function settle() { for (let i = 0; i < 20; i++) await flush() }
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

class Node {
  constructor(attrs = {}, children = []) {
    this.attrs = { ...attrs }
    this.children = []
    this.parent = null
    this.listeners = []
    this.textContent = ''
    children.forEach((c) => { c.parent = this; this.children.push(c) })
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
  matches(sel) {
    if (sel === 'button, a') return this.attrs.tag === 'button' || this.attrs.tag === 'a'
    const parts = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
    return parts.length > 0 && parts.every(([, n, v]) => n in this.attrs && (v === undefined || this.attrs[n] === v))
  }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches(sel)) return n; return null }
  contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false }
  all() { return this.children.flatMap((c) => [c, ...c.all()]) }
  querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  addEventListener(type, fn, capture) { this.listeners.push({ type, fn, capture }) }
  click() {
    const event = { target: this, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true }, stopImmediatePropagation() { this.stopped = true } }
    const chain = []
    for (let n = this; n; n = n.parent) chain.push(n)
    for (const n of chain.slice().reverse()) for (const l of n.listeners) if (l.type === 'click' && l.capture) { l.fn(event); if (event.stopped) return event }
    for (const n of chain) for (const l of n.listeners) if (l.type === 'click' && !l.capture) l.fn(event)
    return event
  }
}

function makePage({ hours, starter = { availability: { manager: 'platform', items: {} }, nylas_grant_id: 'v-1' }, ensureStatus = 200, popup = true, guard = true, origin = 'https://www.thestarters.com', path = '/starter-onboarding-v2' } = {}) {
  const calls = []
  const flowClicks = []
  const statuses = []
  const listeners = {}
  const error = new Node({ 'data-calls-step-element': 'error' })
  const connect = new Node({ 'data-calls-step-action': 'connect-google', tag: 'button' })
  const root = new Node({ 'data-calls-step': 'root', 'data-calls-step-context': 'onboarding' }, [error, connect])
  const backBtn = new Node({ tag: 'button' })
  const nextBtn = new Node({ tag: 'button' })
  const back = new Node({ 'data-button-style': 'secondary' }, [backBtn])
  const next = new Node({ 'data-button-style': 'primary' }, [nextBtn])
  const group = new Node({ 'data-form-flow-button-group': 'step-5' }, [back, next])
  const step = new Node({ 'data-form-flow-element': 'step-5' }, [root, group])
  // the form flow's own bubbling listener stands in for lumos
  group.addEventListener('click', (e) => flowClicks.push(e.target === nextBtn ? 'next' : 'back'))
  const tab = { closed: false, opener: {}, url: null, location: { replace(u) { tab.url = u } }, close() { tab.closed = true } }
  const editor = {
    validate: () => (hours === null ? 'Pick at least one day.' : ''),
    read: () => hours || { timezone: 'Asia/Manila', days: [1, 2], windows: [{ start: '9:00 AM', end: '12:00 PM' }], extra: null },
    setStatus: (s) => statuses.push(s),
  }
  const win = {
    location: { origin, pathname: path },
    $memberstackDom: {
      getMemberCookie: () => Promise.resolve('ms'),
      getCurrentMember: () => Promise.resolve({ data: { id: 'mem_onb03' } }),
    },
    setTimeout: (fn, ms) => (ms === 20000 ? 0 : setImmediate(fn)),
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f) },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f) },
    open: () => (popup ? tab : null),
    console: { warn() {} },
    fetch(url, options) {
      calls.push({ url, body: options && options.body ? JSON.parse(options.body) : null })
      if (url.startsWith(XANO + '/api:g1vmSLWh/auth/trade-token/v3')) return Promise.resolve(response(200, { authToken: 't' }))
      if (url === ENSURE) return Promise.resolve(response(ensureStatus, { steps_done: ['update_availability'] }))
      if (url === STARTER) return Promise.resolve(response(200, starter))
      return Promise.reject(new Error('unexpected ' + url))
    },
    document: {
      querySelector: (sel) => (guard && sel === 'script[src*="/v3/staff-preview-guard.js"]' ? {} : null),
      querySelectorAll: (sel) => (sel === '[data-calls-step="root"][data-calls-step-context="onboarding"]' ? [root] : []),
    },
    StarterProfileCallsStep: { editorFor: () => editor },
  }
  return { win, calls, flowClicks, statuses, error, connect, nextBtn, backBtn, tab, listeners }
}

test('boot: onboarding v2 routes; production needs the staff guard script', () => {
  assert.equal(bootAllowed(makePage().win), true)
  assert.equal(bootAllowed(makePage({ path: '/starter-onboarding-v2-wip' }).win), true)
  assert.equal(bootAllowed(makePage({ guard: false }).win), false)
  assert.equal(bootAllowed(makePage({ guard: false, origin: 'https://the-starters-3-0.webflow.io' }).win), true)
  assert.equal(bootAllowed(makePage({ path: '/starter-onboarding' }).win), false)
  assert.equal(bootAllowed(makePage({ origin: 'https://www.thestarters.com.evil.example' }).win), false)
})

test('times convert to 24 h HH:MM', () => {
  assert.equal(to24h('9:00 AM'), '09:00')
  assert.equal(to24h('12:30 PM'), '12:30')
  assert.equal(to24h('12:00 AM'), '00:00')
  assert.equal(to24h('6:30 PM'), '18:30')
  assert.equal(to24h('13:00 PM'), '')
  assert.equal(to24h('9:00'), '')
})

test('several windows in one day: window 1 is general, the rest are same-day windows, extra days are an override', () => {
  const items = toItems({
    days: [3, 1, 2],
    windows: [{ start: '9:00 AM', end: '12:00 PM' }, { start: '1:00 PM', end: '5:00 PM' }, { start: '6:00 PM', end: '8:00 PM' }],
    extra: { days: [6], start: '10:00 AM', end: '2:00 PM' },
  })
  assert.deepEqual(items, {
    general: { days: [1, 2, 3], start: '09:00', end: '12:00', defaultDays: [1, 2, 3] },
    'window-2': { days: [1, 2, 3], start: '13:00', end: '17:00', kind: 'window' },
    'window-3': { days: [1, 2, 3], start: '18:00', end: '20:00', kind: 'window' },
    'override-onboarding': { days: [6], start: '10:00', end: '14:00' },
  })
})

test('Next saves through #12047, then lets the form flow advance', async () => {
  const page = makePage()
  createController(page.win).mount()
  await settle()
  page.nextBtn.click()
  await settle()
  const ensure = page.calls.find((c) => c.url === ENSURE)
  assert.deepEqual(ensure.body, {
    member_id: 'mem_onb03',
    availability: { items: { general: { days: [1, 2], start: '09:00', end: '12:00', defaultDays: [1, 2] } } },
    in_timezone: 'Asia/Manila',
    offer_intro_call: true,
  })
  assert.deepEqual(page.flowClicks, ['next'])
  assert.ok(page.statuses.some((s) => s.hoursSaved === true))
})

test('Next with invalid hours shows the error and does not save or advance', async () => {
  const page = makePage({ hours: null })
  createController(page.win).mount()
  await settle()
  page.nextBtn.click()
  await settle()
  assert.equal(page.error.textContent, 'Pick at least one day.')
  assert.equal(page.calls.some((c) => c.url === ENSURE), false)
  assert.deepEqual(page.flowClicks, [])
})

test('a failed save keeps the Starter on the step with a message', async () => {
  const page = makePage({ ensureStatus: 500 })
  createController(page.win).mount()
  await settle()
  page.nextBtn.click()
  await settle()
  assert.equal(page.error.textContent, 'We couldn’t save your availability. Please try again.')
  assert.deepEqual(page.flowClicks, [])
})

test('Back is never intercepted', async () => {
  const page = makePage()
  createController(page.win).mount()
  await settle()
  page.backBtn.click()
  await settle()
  assert.deepEqual(page.flowClicks, ['back'])
  assert.equal(page.calls.some((c) => c.url === ENSURE), false)
})

test('Connect Google saves first, then sends the reserved tab to the dashboard Google link', async () => {
  const page = makePage()
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  assert.ok(page.calls.some((c) => c.url === ENSURE))
  assert.equal(page.tab.opener, null)
  assert.equal(page.tab.url, 'https://www.thestarters.com/starter-dashboard?onboarding_calendar=connect-google')
  assert.ok(page.statuses.some((s) => s.calendar === 'connecting'))
})

test('Connect Google with a blocked pop-up asks to allow pop-ups and saves nothing', async () => {
  const page = makePage({ popup: false })
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  assert.equal(page.error.textContent, 'Allow pop-ups for this site, then try again.')
  assert.equal(page.calls.some((c) => c.url === ENSURE), false)
})

test('status shows Google connected only when the manager is calendar', async () => {
  const google = makePage({ starter: { availability: { manager: 'calendar', items: {} }, nylas_grant_id: 'g-1', nylas_grant_email: 'me@gmail.example' } })
  createController(google.win).mount()
  await settle()
  assert.deepEqual(google.statuses.at(-1), { calendar: 'connected', email: 'me@gmail.example' })
  const platform = makePage()
  createController(platform.win).mount()
  await settle()
  assert.deepEqual(platform.statuses.at(-1), { calendar: 'disconnected', email: '' })
})
