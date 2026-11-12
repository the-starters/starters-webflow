const assert = require('node:assert/strict')
const test = require('node:test')
const { bootAllowed, to24h, toItems, createController } = require('./onboarding-calendar.js')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const ENSURE = XANO + '/api:tCpV3oqd/onboarding/calendar/ensure-default/v3'
const STARTER = XANO + '/api:tCpV3oqd/starter/get_by_memberstack/v3'
const OAUTH = XANO + '/api:tCpV3oqd/grants/oauth/v3'
const GOOGLE_URL = 'https://api.us.nylas.com/v3/connect/auth?client_id=c&state=mem_onb03'
const shared = require('./calendar-google-connect.js')

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
  matches(sel) { return sel.split(',').some((compound) => this.matchesCompound(compound.trim())) }
  matchesCompound(compound) {
    const token = /^(?:([a-z]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(\[([\w-]+)(?:="([^"]*)")?\]\))/
    const has = (n, v) => n in this.attrs && (v === undefined || this.attrs[n] === v)
    let rest = compound
    let ok = true
    while (rest) {
      const m = rest.match(token)
      if (!m) throw new Error('fake DOM cannot parse selector: ' + compound)
      if (m[1]) ok = ok && this.attrs.tag === m[1]
      else if (m[2]) ok = ok && has(m[2], m[3])
      else ok = ok && !has(m[4], m[5])
      rest = rest.slice(m[0].length)
    }
    return compound.length > 0 && ok
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
  const storage = new Map()
  const intervals = new Set()
  const channels = []
  let nextInterval = 1
  const error = new Node({ 'data-calls-step-element': 'error' })
  const connect = new Node({ 'data-calls-step-action': 'connect-google', tag: 'button' })
  const root = new Node({ 'data-calls-step': 'root', 'data-calls-step-context': 'onboarding' }, [error, connect])
  const backBtn = new Node({ tag: 'button' })
  const nextBtn = new Node({ tag: 'button' })
  const back = new Node({ 'data-button-style': 'secondary' }, [backBtn])
  const next = new Node({ 'data-button-style': 'primary' }, [nextBtn])
  const group = new Node({ 'data-form-flow-button-group': 'step-5' }, [back, next])
  const step = new Node({ 'data-form-flow-element': 'step-5' }, [root, group])
  const body = new Node({}, [step])
  // the form flow's own bubbling listener stands in for lumos
  group.addEventListener('click', (e) => flowClicks.push(e.target === nextBtn ? 'next' : 'back'))
  const tab = { closed: false, opener: {}, url: null, requestAtNavigation: null,
    location: { replace(u) { tab.url = u; tab.requestAtNavigation = storage.get('starters-google-connect-intent') || null } },
    close() { tab.closed = true } }
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
    clearTimeout() {},
    setInterval() { const id = nextInterval++; intervals.add(id); return id },
    clearInterval(id) { intervals.delete(id) },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    BroadcastChannel: class {
      constructor(name) { this.name = name; this.onmessage = null; this.closed = false; channels.push(this) }
      close() { this.closed = true }
    },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f) },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f) },
    open: () => (popup ? tab : null),
    console: { warn() {} },
    fetch(url, options) {
      calls.push({ url, body: options && options.body ? JSON.parse(options.body) : null })
      if (url.startsWith(XANO + '/api:g1vmSLWh/auth/trade-token/v3')) return Promise.resolve(response(200, { authToken: 't' }))
      if (url === ENSURE) return Promise.resolve(response(ensureStatus, { steps_done: ['update_availability'] }))
      if (url === STARTER) return Promise.resolve(response(200, starter))
      if (url === OAUTH) return Promise.resolve(response(200, { response: { result: { data: { url: GOOGLE_URL } } } }))
      return Promise.reject(new Error('unexpected ' + url))
    },
    document: {
      querySelector: (sel) => (guard && sel === 'script[src*="/v3/staff-preview-guard.js"]' ? {} : null),
      querySelectorAll: (sel) => body.querySelectorAll(sel),
    },
    StarterProfileCallsStep: { editorFor: () => editor },
    StartersCalendarGoogleConnect: { ...shared, pendingCallback: null },
  }
  return { win, body, calls, flowClicks, statuses, error, connect, nextBtn, backBtn, tab, listeners, storage, intervals, channels }
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
    'window-2': { days: [1, 2, 3], start: '13:00', end: '17:00', defaultDays: [1, 2, 3], kind: 'window' },
    'window-3': { days: [1, 2, 3], start: '18:00', end: '20:00', defaultDays: [1, 2, 3], kind: 'window' },
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

test('Connect Google saves first, then sends the reserved pop-up to Google with this page as the return', async () => {
  const page = makePage()
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  assert.ok(page.calls.some((c) => c.url === ENSURE))
  assert.equal(page.tab.opener, null)
  assert.equal(page.tab.url, GOOGLE_URL)
  const oauth = page.calls.find((c) => c.url === OAUTH)
  assert.deepEqual(oauth.body, { in_provider: 'google', in_redirect_uri: 'https://www.thestarters.com/starter-onboarding-v2' })
  assert.ok(page.calls.findIndex((c) => c.url === ENSURE) < page.calls.findIndex((c) => c.url === OAUTH))
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

test('Connect Google stores a one-time intent for this member and page before the pop-up reaches Google', async () => {
  const page = makePage()
  const before = Date.now()
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  const request = JSON.parse(page.tab.requestAtNavigation)
  assert.equal(request.memberId, 'mem_onb03')
  assert.equal(request.redirectUri, 'https://www.thestarters.com/starter-onboarding-v2')
  assert.ok(request.createdAt >= before && request.createdAt <= Date.now())
})

test('a second Connect Google click stops the previous watcher, so only one is active', async () => {
  const page = makePage()
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  page.connect.click()
  await settle()
  assert.equal((page.listeners.focus || []).length, 1)
  assert.equal(page.intervals.size, 1)
  const returnChannels = page.channels.filter((c) => c.name === 'starters-calendar-connect-return')
  assert.equal(returnChannels.length, 2)
  assert.equal(returnChannels[0].closed, true)
  assert.equal(returnChannels[1].closed, false)
})

test('the return signal is ignored unless it names this Starter', async () => {
  const page = makePage({ starter: { availability: { manager: 'calendar', items: {} }, nylas_grant_id: 'g-1', nylas_grant_email: 'me@gmail.example' } })
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  const channel = page.channels.find((c) => c.name === 'starters-calendar-connect-return')
  const reads = () => page.calls.filter((c) => c.url === STARTER).length
  const before = reads()
  channel.onmessage({ data: { type: 'calendar-connected', memberId: 'mem_other' } })
  await settle()
  assert.equal(reads(), before)
  assert.equal(channel.closed, false)
  channel.onmessage({ data: { type: 'calendar-connected', memberId: 'mem_onb03' } })
  await settle()
  assert.equal(reads(), before + 1)
  assert.equal(channel.closed, true)
})

test('a failed-connection signal for this Starter shows the Google error and stops watching', async () => {
  const page = makePage()
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  const channel = page.channels.find((c) => c.name === 'starters-calendar-connect-return')
  channel.onmessage({ data: { type: 'calendar-connect-failed', memberId: 'mem_onb03' } })
  await settle()
  assert.equal(page.error.textContent, 'We couldn’t connect your Google Calendar. Please try again.')
  assert.equal(channel.closed, true)
})

test('on the pop-up return the page finishes the connection and does not wire the step', async () => {
  const page = makePage()
  let completed = 0
  page.win.StartersCalendarGoogleConnect = {
    pendingCallback: { code: 'c', state: 'mem_onb03', hasError: false },
    createGoogleConnect: () => ({ returnPending: () => true, completeReturn: () => { completed++ }, start() {} }),
  }
  assert.equal(createController(page.win).mount(), 0)
  assert.equal(completed, 1)
  page.connect.click()
  await settle()
  assert.equal(page.calls.some((c) => c.url === ENSURE), false)
})

// Build Profile step 6 (Jai 2026-11-12): same save, multistep Next button.
function makeBuildPage({ offerIntroCall = true, path = '/build-profile/consult-test', hours, context = 'build-profile' } = {}) {
  const page = makePage({ path, hours })
  const error = new Node({ 'data-calls-step-element': 'error' })
  const connect = new Node({ 'data-calls-step-action': 'connect-google', tag: 'button' })
  const rootAttrs = { 'data-calls-step': 'root' }
  if (context !== null) rootAttrs['data-calls-step-context'] = context
  const root = new Node(rootAttrs, [error, connect])
  const backBtn = new Node({ 'data-form': 'back-btn', tag: 'a' })
  const nextBtn = new Node({ 'data-form': 'next-btn', tag: 'a' })
  const step = new Node({ 'data-form': 'step', 'data-index': '6' }, [root, backBtn, nextBtn])
  const form = new Node({ 'data-form': 'multistep' }, [step])
  const formClicks = []
  // the multistep form's own bubbling listener
  form.addEventListener('click', (e) => formClicks.push(e.target === nextBtn ? 'next' : 'back'))
  const body = new Node({}, [form])
  page.win.document.querySelectorAll = (sel) => body.querySelectorAll(sel)
  page.win.StarterProfileCallsStep.editorFor().offerIntroCall = () => offerIntroCall
  return { ...page, error, connect, nextBtn, backBtn, formClicks }
}

test('boot: the four Build Profile paths; production still needs the staff guard script', () => {
  for (const path of ['/build-profile/consult-test', '/build-profile/full-profile-test', '/build-profile/consult', '/build-profile/full-profile']) {
    assert.equal(bootAllowed(makePage({ path }).win), true, path)
    assert.equal(bootAllowed(makePage({ path, guard: false }).win), false, path)
  }
  assert.equal(bootAllowed(makePage({ path: '/build-profile/select-profile' }).win), false)
})

test('Build Profile Next saves the hours with the Free call switch, then lets the multistep form advance', async () => {
  const page = makeBuildPage({ offerIntroCall: false })
  createController(page.win).mount()
  await settle()
  page.nextBtn.click()
  await settle()
  const ensure = page.calls.find((c) => c.url === ENSURE)
  assert.deepEqual(ensure.body, {
    member_id: 'mem_onb03',
    availability: { items: { general: { days: [1, 2], start: '09:00', end: '12:00', defaultDays: [1, 2] } } },
    in_timezone: 'Asia/Manila',
    offer_intro_call: false,
  })
  assert.deepEqual(page.formClicks, ['next'])
})

test('Build Profile Next with invalid hours saves nothing and does not advance', async () => {
  const page = makeBuildPage({ hours: null })
  createController(page.win).mount()
  await settle()
  page.nextBtn.click()
  await settle()
  assert.equal(page.error.textContent, 'Pick at least one day.')
  assert.equal(page.calls.some((c) => c.url === ENSURE), false)
  assert.deepEqual(page.formClicks, [])
})

test('Build Profile Back is never intercepted', async () => {
  const page = makeBuildPage()
  createController(page.win).mount()
  await settle()
  page.backBtn.click()
  await settle()
  assert.deepEqual(page.formClicks, ['back'])
  assert.equal(page.calls.some((c) => c.url === ENSURE), false)
})

test('Build Profile Connect Google returns to the Build Profile page and keeps the Free call choice', async () => {
  const page = makeBuildPage({ offerIntroCall: false })
  createController(page.win).mount()
  await settle()
  page.connect.click()
  await settle()
  const oauth = page.calls.find((c) => c.url === OAUTH)
  assert.equal(oauth.body.in_redirect_uri, 'https://www.thestarters.com/build-profile/consult-test')
  assert.equal(JSON.parse(page.tab.requestAtNavigation).offerIntroCall, false)
  assert.equal(page.calls.find((c) => c.url === ENSURE).body.offer_intro_call, false)
})

test('an unmarked root in a Build Profile step is wired: Next saves the hours and the form advances', async () => {
  const page = makeBuildPage({ context: null })
  assert.equal(createController(page.win).mount(), 1)
  await settle()
  page.nextBtn.click()
  await settle()
  assert.equal(page.calls.filter((c) => c.url === ENSURE).length, 1)
  assert.deepEqual(page.formClicks, ['next'])
})

test('a build-profile-marked root in a Build Profile step is wired', () => {
  assert.equal(createController(makeBuildPage().win).mount(), 1)
})

test('edit- and onboarding-marked roots in a Build Profile step are not wired', async () => {
  for (const context of ['edit', 'onboarding']) {
    const page = makeBuildPage({ context })
    assert.equal(createController(page.win).mount(), 0, context)
    page.nextBtn.click()
    await settle()
    assert.equal(page.calls.some((c) => c.url === ENSURE), false, context)
    assert.deepEqual(page.formClicks, ['next'], context)
  }
})

test('an onboarding-marked root on a Build Profile page is not wired', async () => {
  const page = makePage({ path: '/build-profile/consult-test' })
  assert.equal(createController(page.win).mount(), 0)
})

// Edit Profile v2 (JP 2026-11-12): saved items back to editor hours.
const { fromItems } = require('./onboarding-calendar.js')

test('fromItems is the reverse of toItems for every shape the editor writes', () => {
  const hours = {
    days: [1, 3, 5],
    windows: [{ start: '9:00 AM', end: '12:00 PM' }, { start: '1:00 PM', end: '5:30 PM' }, { start: '6:00 PM', end: '7:00 PM' }],
    extra: { days: [6], start: '10:00 AM', end: '2:00 PM' },
  }
  const back = fromItems(toItems(hours))
  assert.deepEqual(back.rest, {})
  assert.deepEqual(back.hours, {
    days: [1, 3, 5],
    windows: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:30' }, { start: '18:00', end: '19:00' }],
    extra: { days: [6], start: '10:00', end: '14:00' },
  })
})

test('fromItems orders window-10 after window-2 and keeps dashboard overrides in rest', () => {
  const items = {
    general: { days: [5], start: '09:00', end: '10:00', defaultDays: [1, 5] },
    'window-10': { days: [5], start: '15:00', end: '16:00', defaultDays: [1, 5], kind: 'window' },
    'window-2': { days: [5], start: '11:00', end: '12:00', defaultDays: [1, 5], kind: 'window' },
    'override-1700': { days: [1], start: '13:00', end: '14:00' },
    'override-a': { days: [0], start: '08:00', end: '09:00' },
    'override-onboarding': { days: [6], start: '10:00', end: '11:00' },
  }
  const { hours, rest } = fromItems(items)
  assert.deepEqual(hours.days, [1, 5])
  assert.deepEqual(hours.windows.map((w) => w.start), ['09:00', '11:00', '15:00'])
  assert.deepEqual(hours.extra, { days: [6], start: '10:00', end: '11:00' })
  assert.deepEqual(Object.keys(rest).sort(), ['override-1700', 'override-a'])
})

const to12h = (value) => {
  const [hour, minute] = value.split(':').map(Number)
  return ((hour + 11) % 12 + 1) + ':' + String(minute).padStart(2, '0') + (hour < 12 ? ' AM' : ' PM')
}
const asEditor = (hours) => ({
  ...hours,
  windows: hours.windows.map((w) => ({ start: to12h(w.start), end: to12h(w.end) })),
  extra: hours.extra && { ...hours.extra, start: to12h(hours.extra.start), end: to12h(hours.extra.end) },
})
const DASHBOARD = {
  general: { days: [1, 2, 4, 5], start: '09:00', end: '17:00', defaultDays: [1, 2, 3, 4, 5] },
  '3f2a9c1e-uuid': { days: [3], start: '10:00', end: '12:00' },
}

test('a dashboard day override loads as the full weekly hours and round-trips unchanged', () => {
  const { hours, rest } = fromItems(structuredClone(DASHBOARD))
  assert.deepEqual(hours, { days: [1, 2, 3, 4, 5], windows: [{ start: '09:00', end: '17:00' }], extra: null })
  assert.deepEqual(rest, { '3f2a9c1e-uuid': DASHBOARD['3f2a9c1e-uuid'] })
  assert.deepEqual(toItems(asEditor(hours), rest, hours.days), DASHBOARD)
})

test('changing hours keeps the dashboard override and keeps its day out of general and windows', () => {
  const { hours, rest } = fromItems(structuredClone(DASHBOARD))
  const edited = asEditor(hours)
  edited.days = [1, 2, 3, 4]
  edited.windows = [{ start: '8:00 AM', end: '12:00 PM' }, { start: '1:00 PM', end: '4:00 PM' }]
  assert.deepEqual(toItems(edited, rest, hours.days), {
    '3f2a9c1e-uuid': { days: [3], start: '10:00', end: '12:00' },
    general: { days: [1, 2, 4], start: '08:00', end: '12:00', defaultDays: [1, 2, 3, 4] },
    'window-2': { days: [1, 2, 4], start: '13:00', end: '16:00', defaultDays: [1, 2, 3, 4], kind: 'window' },
  })
})

test('unticking a weekly day drops a dashboard override on only that day, so the day is not bookable', () => {
  const { hours, rest } = fromItems(structuredClone(DASHBOARD))
  const edited = asEditor(hours)
  edited.days = [1, 2, 4, 5]
  const items = toItems(edited, rest, hours.days)
  assert.deepEqual(items, {
    general: { days: [1, 2, 4, 5], start: '09:00', end: '17:00', defaultDays: [1, 2, 4, 5] },
  })
  assert.ok(Object.values(items).every((item) => !item.days.includes(3)))
})

test('an override on Wed and Sat keeps only Wed when Sat is unticked; overrides off the weekly days stay', () => {
  const saved = {
    general: { days: [1, 2, 4, 5], start: '09:00', end: '17:00', defaultDays: [1, 2, 3, 4, 5, 6] },
    'override-1731': { days: [3, 6], start: '10:00', end: '12:00', note: 'kept' },
    'sunday-uuid': { days: [0], start: '11:00', end: '13:00' },
  }
  const { hours, rest } = fromItems(structuredClone(saved))
  assert.deepEqual(toItems(asEditor(hours), rest, hours.days), saved)
  const edited = asEditor(hours)
  edited.days = [1, 2, 3, 4, 5]
  assert.deepEqual(toItems(edited, rest, hours.days), {
    'override-1731': { days: [3], start: '10:00', end: '12:00', note: 'kept' },
    'sunday-uuid': { days: [0], start: '11:00', end: '13:00' },
    general: { days: [1, 2, 4, 5], start: '09:00', end: '17:00', defaultDays: [1, 2, 3, 4, 5] },
  })
})

test('a dashboard same-day window round-trips with its defaultDays', () => {
  const saved = {
    general: { days: [1, 2, 4, 5], start: '09:00', end: '12:00', defaultDays: [1, 2, 3, 4, 5] },
    'window-2': { days: [1, 2, 4, 5], start: '13:00', end: '17:00', defaultDays: [1, 2, 3, 4, 5], kind: 'window' },
    'override-1731': { days: [3], start: '10:00', end: '11:00' },
  }
  const { hours, rest } = fromItems(structuredClone(saved))
  assert.equal(hours.extra, null)
  assert.deepEqual(toItems(asEditor(hours), rest, hours.days), {
    'override-1731': saved['override-1731'],
    general: saved.general,
    'window-2': saved['window-2'],
  })
})

test('toItems without preserved items is unchanged for onboarding and Build Profile', () => {
  const hours = { days: [5, 1], windows: [{ start: '9:00 AM', end: '12:00 PM' }, { start: '1:00 PM', end: '5:00 PM' }], extra: { days: [6], start: '10:00 AM', end: '2:00 PM' } }
  assert.equal(JSON.stringify(toItems(hours)), JSON.stringify({
    general: { days: [1, 5], start: '09:00', end: '12:00', defaultDays: [1, 5] },
    'window-2': { days: [1, 5], start: '13:00', end: '17:00', defaultDays: [1, 5], kind: 'window' },
    'override-onboarding': { days: [6], start: '10:00', end: '14:00' },
  }))
})

test('fromItems with no usable general returns no hours and keeps every item', () => {
  assert.deepEqual(fromItems(null), { hours: null, rest: {} })
  assert.deepEqual(fromItems({}), { hours: null, rest: {} })
  const odd = { general: { days: [], start: '09:00', end: '10:00' }, x: { days: [1] } }
  assert.deepEqual(fromItems(odd), { hours: null, rest: odd })
})

test('controller options: save keeps base items under the editor items and runs beforeSave first', async () => {
  const page = makePage()
  const order = []
  const controller = createController(page.win, {
    baseItems: () => ({ items: { 'override-1700': { days: [1], start: '13:00', end: '14:00' }, general: { stale: true } }, days: [1] }),
    beforeSave: () => order.push('beforeSave'),
  })
  await controller.save({ read: () => { order.push('read'); return { timezone: 'UTC', days: [1], windows: [{ start: '9:00 AM', end: '10:00 AM' }], extra: null } } })
  assert.deepEqual(order, ['beforeSave', 'read'])
  const body = page.calls.find((c) => c.url === ENSURE).body
  assert.deepEqual(body.availability.items, {
    'override-1700': { days: [1], start: '13:00', end: '14:00' },
    general: { days: [], start: '09:00', end: '10:00', defaultDays: [1] },
  })
})

test('controller options: onCalendarStatus hears each calendar read; get sends a bodyless GET', async () => {
  const page = makePage({ starter: { availability: { manager: 'calendar' }, nylas_grant_id: 'g1', nylas_grant_email: 'a@b.c' } })
  const heard = []
  const controller = createController(page.win, { onCalendarStatus: (google) => heard.push(google) })
  assert.equal(await controller.refreshStatus({ setStatus() {} }), true)
  assert.deepEqual(heard, [true])
  assert.equal(typeof controller.get, 'function')
  assert.equal(typeof controller.wireConnect, 'function')
  assert.equal(typeof controller.setupGoogle, 'function')
})
