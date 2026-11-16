const assert = require('node:assert/strict')
const test = require('node:test')
const { bootAllowed, missingFrom, createGate, EDIT_PROFILE_CALLS, MODAL_ID } = require('./starter-setup-gate.js')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const READINESS = XANO + '/api:tCpV3oqd/starter/paid-call-settings/get/v3'

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

function readiness(over = {}) {
  return { readiness: { availability_configured: true, calendar_connected: true, stripe_connect_linked: true, ...over } }
}

// Minimal DOM stand-in: attribute selectors (comma lists allowed), a subtree
// walk, closest(), and click delegation through addEventListener.
class El {
  constructor(attrs = {}, tag = 'DIV', children = []) {
    this.attrs = { ...attrs }; this.tagName = tag; this.hidden = false; this.children = children; this.parent = null
    this.listeners = {}; this.focused = false; this.scrolled = null
    for (const c of children) c.parent = this
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
  setAttribute(n, v) { this.attrs[n] = String(v) }
  matches(sel) {
    return sel.split(',').some((one) => {
      const m = /^\s*\[([\w-]+)(?:="([^"]*)")?\]\s*$/.exec(one)
      return Boolean(m) && m[1] in this.attrs && (m[2] === undefined || this.attrs[m[1]] === m[2])
    })
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]) }
  querySelectorAll(sel) { return this.all().filter((c) => c.matches(sel)) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  closest(sel) { for (let el = this; el; el = el.parent) if (el.matches(sel)) return el; return null }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn) }
  click() {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    for (let el = this; el; el = el.parent) for (const fn of el.listeners.click || []) fn(event)
    return event
  }
  focus() { this.focused = true }
  scrollIntoView(options) { this.scrolled = options }
  getClientRects() { return this.hidden ? [] : [{}] }
}

function makePage({ staff = true, flag = true, dialog = true, ready = readiness(), readyStatus = 200, modal = true, path = '/starter-dashboard' } = {}) {
  const opened = []
  const closed = []
  const calls = []
  const timers = []
  const avail = new El({ 'data-setup-missing': 'availability' })
  const stripe = new El({ 'data-setup-missing': 'stripe' })
  const go = new El({ 'data-setup-action': 'go', href: '#' }, 'A')
  const dlg = new El({ 'data-setup-gate': '', 'data-modal-target': MODAL_ID }, 'DIALOG', [avail, stripe, go])
  const startHidden = new El({ 'data-stripe-connect-action': 'start', 'data-stripe-connect-element': 'incomplete' })
  startHidden.hidden = true
  const startVisible = new El({ 'data-stripe-connect-action': 'start', 'data-stripe-connect-element': 'disconnected' })
  const stripeCard = new El({ 'data-stripe-connect-element': 'root' }, 'DIV', [startHidden, startVisible])
  const body = new El({}, 'BODY', [stripeCard])
  const win = {
    location: { origin: 'https://www.thestarters.com', pathname: path },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout() {},
    setInterval(fn) {
      const id = { live: true }
      const loop = () => { if (id.live) { fn(); setImmediate(loop) } }
      setImmediate(loop)
      return id
    },
    clearInterval(id) { if (id) id.live = false },
    console: { warn() {} },
    $memberstackDom: { getMemberCookie: () => Promise.resolve('ms') },
    fetch(url, options) {
      calls.push({ url, options })
      if (url.startsWith(XANO + '/api:g1vmSLWh/auth/trade-token/v3')) return Promise.resolve(response(200, { authToken: 'x-token' }))
      if (url === READINESS) return Promise.resolve(response(readyStatus, ready))
      return Promise.reject(new Error('unexpected ' + url))
    },
    document: {
      querySelector: (sel) => (sel.startsWith('dialog') ? (dialog ? dlg : null) : body.querySelector(sel)),
    },
    lumos: modal ? { modal: { list: { [MODAL_ID]: { close: () => closed.push(MODAL_ID) } }, open: (id) => opened.push(id) } } : undefined,
  }
  if (flag) win.StartersStaffPreview = Promise.resolve(staff)
  return { win, opened, closed, calls, timers, dlg, avail, stripe, go, stripeCard, startVisible, startHidden }
}

// The dashboard dialog built from the All Modals design: one screen per item.
function withScreens(page) {
  const goCalendar = new El({ 'data-setup-action': 'go-calendar', href: '#' }, 'A')
  const skipA = new El({ 'data-setup-action': 'skip' }, 'BUTTON')
  const goStripe = new El({ 'data-setup-action': 'go-stripe' }, 'BUTTON')
  const skipS = new El({ 'data-setup-action': 'skip' }, 'BUTTON')
  const availability = new El({ 'data-setup-step': 'availability' }, 'DIV', [goCalendar, skipA])
  const stripe = new El({ 'data-setup-step': 'stripe' }, 'DIV', [goStripe, skipS])
  const calendar = new El({ 'data-setup-step': 'calendar' })
  const done = new El({ 'data-setup-step': 'done' })
  const close = new El({ 'data-modal-close': '' }, 'BUTTON')
  page.dlg.children = [close, availability, calendar, stripe, done]
  for (const c of page.dlg.children) c.parent = page.dlg
  return { ...page, screens: { availability, stripe, calendar, done }, goCalendar, skipA, goStripe, skipS }
}

test('boot: only /starter-dashboard on the live and staging hosts', () => {
  assert.equal(bootAllowed(makePage().win), true)
  assert.equal(bootAllowed({ location: { origin: 'https://the-starters-3-0.webflow.io', pathname: '/starter-dashboard/' } }), true)
  assert.equal(bootAllowed(makePage({ path: '/brand-dashboard' }).win), false)
  assert.equal(bootAllowed({ location: { origin: 'https://www.thestarters.com.evil.example', pathname: '/starter-dashboard' } }), false)
})

test('missing items: availability needs hours AND a calendar; Stripe needs a linked account; Google is never required', () => {
  assert.deepEqual(missingFrom(readiness()), [])
  assert.deepEqual(missingFrom(readiness({ availability_configured: false })), ['availability'])
  assert.deepEqual(missingFrom(readiness({ calendar_connected: false })), ['availability'])
  assert.deepEqual(missingFrom(readiness({ stripe_connect_linked: false })), ['stripe'])
  assert.deepEqual(missingFrom(readiness({ availability_configured: false, stripe_connect_linked: false })), ['availability', 'stripe'])
  assert.equal(missingFrom({}), null)
})

test('staff missing both: the dialog lists both, the CTA goes to Edit Profile v2 Calls, and the modal opens', async () => {
  const page = makePage({ ready: readiness({ availability_configured: false, stripe_connect_linked: false }) })
  assert.equal(await createGate(page.win).run(), 'opened')
  assert.deepEqual(page.opened, [MODAL_ID])
  assert.equal(page.avail.hidden, false)
  assert.equal(page.stripe.hidden, false)
  assert.equal(page.go.attrs.href, EDIT_PROFILE_CALLS)
  assert.equal(page.calls.find((c) => c.url === READINESS).options.headers.Authorization, 'Bearer x-token')
})

test('staff missing only Stripe: only the Stripe item shows', async () => {
  const page = makePage({ ready: readiness({ stripe_connect_linked: false }) })
  assert.equal(await createGate(page.win).run(), 'opened')
  assert.equal(page.avail.hidden, true)
  assert.equal(page.stripe.hidden, false)
})

test('staff with everything set up: no modal', async () => {
  const page = makePage()
  assert.equal(await createGate(page.win).run(), 'complete')
  assert.deepEqual(page.opened, [])
})

test('non-staff: no status read and no modal (real Starters see nothing)', async () => {
  const page = makePage({ staff: false, ready: readiness({ stripe_connect_linked: false }) })
  assert.equal(await createGate(page.win).run(), 'skipped:not-staff')
  assert.deepEqual(page.calls, [])
  assert.deepEqual(page.opened, [])
})

test('no flag-mode guard on the page: does nothing', async () => {
  const page = makePage({ flag: false, ready: readiness({ stripe_connect_linked: false }) })
  assert.equal(await createGate(page.win).run(), 'skipped:no-staff-flag')
  assert.deepEqual(page.calls, [])
})

test('readiness read fails: fail quiet, no modal', async () => {
  const page = makePage({ readyStatus: 500, ready: {} })
  assert.equal(await createGate(page.win).run(), 'skipped:no-readiness')
  assert.deepEqual(page.opened, [])
})

test('dialog or modal system missing: no modal and no error', async () => {
  assert.equal(await createGate(makePage({ dialog: false }).win).run(), 'skipped:no-dialog')
  const page = makePage({ modal: false, ready: readiness({ stripe_connect_linked: false }) })
  assert.equal(await createGate(page.win).run(), 'skipped:no-modal-system')
})

test('screens: staff missing both sees the availability screen first, and its button goes to Edit Profile v2 Calls', async () => {
  const page = withScreens(makePage({ ready: readiness({ calendar_connected: false, stripe_connect_linked: false }) }))
  assert.equal(await createGate(page.win).run(), 'opened')
  assert.equal(page.screens.availability.hidden, false)
  assert.equal(page.screens.stripe.hidden, true)
  assert.equal(page.screens.calendar.hidden, true)
  assert.equal(page.screens.done.hidden, true)
  assert.equal(page.goCalendar.attrs.href, EDIT_PROFILE_CALLS)
})

test('screens: Skip for now moves to the Stripe screen, then a second skip closes the dialog', async () => {
  const page = withScreens(makePage({ ready: readiness({ availability_configured: false, stripe_connect_linked: false }) }))
  await createGate(page.win).run()
  assert.equal(page.skipA.click().defaultPrevented, true)
  assert.equal(page.screens.availability.hidden, true)
  assert.equal(page.screens.stripe.hidden, false)
  assert.deepEqual(page.closed, [])
  page.skipS.click()
  assert.deepEqual(page.closed, [MODAL_ID])
})

test('screens: only Stripe missing opens on the Stripe screen; its button closes and then scrolls to the visible Stripe start control', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  await createGate(page.win).run()
  assert.equal(page.screens.availability.hidden, true)
  assert.equal(page.screens.stripe.hidden, false)
  assert.equal(page.goStripe.click().defaultPrevented, true)
  assert.deepEqual(page.closed, [MODAL_ID])
  assert.equal(page.stripeCard.scrolled, null)
  const later = page.timers.find((t) => t.ms >= 300 && t.ms < 1000)
  assert.ok(later, 'scroll waits for the modal fade-out')
  later.fn()
  assert.deepEqual(page.stripeCard.scrolled, { behavior: 'smooth', block: 'center' })
  assert.equal(page.startVisible.focused, true)
  assert.equal(page.startHidden.focused, false)
})

test('screens: the Edit Profile link is a real navigation (not prevented) and does not close through the gate', async () => {
  const page = withScreens(makePage({ ready: readiness({ availability_configured: false }) }))
  await createGate(page.win).run()
  assert.equal(page.goCalendar.click().defaultPrevented, false)
  assert.deepEqual(page.closed, [])
})

test('screens: a dashboard without the Stripe card closes cleanly with no error', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  page.win.document.querySelector = (sel) => (sel.startsWith('dialog') ? page.dlg : null)
  const gate = createGate(page.win)
  await gate.run()
  page.goStripe.click()
  assert.equal(gate.scrollToStripe(), false)
  assert.deepEqual(page.closed, [MODAL_ID])
})
