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
    this.listeners = {}; this.focused = false; this.scrolled = null; this.scrolls = 0
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
  scrollIntoView(options) { this.scrolled = options; this.scrolls++ }
  getClientRects() { return this.hidden ? [] : [{}] }
}

function makePage({ staff = true, flag = true, dialog = true, ready = readiness(), readyStatus = 200, modal = true, path = '/starter-dashboard', hash = '' } = {}) {
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
  startVisible.tabIndex = 0 // a focusable control (button, link or tabindex 0)
  const stripeCard = new El({ 'data-stripe-connect-element': 'root' }, 'DIV', [startHidden, startVisible])
  const body = new El({}, 'BODY', [stripeCard])
  const windowListeners = {}
  const win = {
    addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn) },
    removeEventListener(type, fn) { windowListeners[type] = (windowListeners[type] || []).filter((f) => f !== fn) },
    location: { origin: 'https://www.thestarters.com', pathname: path, search: '', hash },
    history: { state: null, replaced: [], replaceState(state, title, url) { this.replaced.push(url); win.location.hash = '' } },
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
      querySelectorAll: (sel) => body.querySelectorAll(sel),
    },
    lumos: modal ? { modal: { list: { [MODAL_ID]: { close: () => closed.push(MODAL_ID) } }, open: (id) => opened.push(id) } } : undefined,
  }
  if (flag) win.StartersStaffPreview = Promise.resolve(staff)
  // What global-embeds/modal/modal.js fires once a dialog has finished closing.
  const modalClosed = (modalEl) => { for (const fn of [...(windowListeners['modal-close'] || [])]) fn({ detail: { modal: modalEl } }) }
  return { win, body, opened, closed, calls, timers, dlg, avail, stripe, go, stripeCard, startVisible, startHidden, modalClosed, windowListeners }
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

test('screens: only Stripe missing opens on the Stripe screen; its button closes and scrolls to the visible Stripe start control once the modal has closed', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  await createGate(page.win).run()
  assert.equal(page.screens.availability.hidden, true)
  assert.equal(page.screens.stripe.hidden, false)
  assert.equal(page.goStripe.click().defaultPrevented, true)
  assert.deepEqual(page.closed, [MODAL_ID])
  for (const t of page.timers.filter((t) => t.ms < 1000)) t.fn()
  assert.equal(page.stripeCard.scrolled, null, 'no scroll while the modal still holds the page')
  page.modalClosed(new El())
  assert.equal(page.stripeCard.scrolled, null, 'another dialog closing does not trigger the scroll')
  page.modalClosed(page.dlg)
  assert.deepEqual(page.stripeCard.scrolled, { behavior: 'smooth', block: 'center' })
  assert.equal(page.startVisible.focused, true)
  assert.equal(page.startHidden.focused, false)
  for (const t of page.timers) t.fn()
  page.modalClosed(page.dlg)
  assert.equal(page.stripeCard.scrolls, 1, 'never scrolls twice')
})

test('screens: go-stripe still scrolls after a fallback wait when the modal-close event never fires', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  await createGate(page.win).run()
  const before = page.timers.length
  page.goStripe.click()
  const queued = page.timers.slice(before)
  assert.equal(queued.length, 1, 'a fallback timer is queued')
  assert.ok(queued[0].ms >= 1000, 'the fallback leaves the 300 ms fade-out plenty of room')
  queued[0].fn()
  assert.equal(page.stripeCard.scrolls, 1)
  assert.equal(page.startVisible.focused, true)
  page.modalClosed(page.dlg)
  assert.equal(page.stripeCard.scrolls, 1, 'a late modal-close does not scroll again')
})

test('screens: a modal that closes at once (no fade) still scrolls once', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  page.win.lumos.modal.list[MODAL_ID].close = () => { page.closed.push(MODAL_ID); page.modalClosed(page.dlg) }
  await createGate(page.win).run()
  page.goStripe.click()
  assert.equal(page.stripeCard.scrolls, 1)
  for (const t of page.timers) t.fn()
  assert.equal(page.stripeCard.scrolls, 1)
})

test('screens: go-stripe scrolls to the first visible Stripe card, skipping a hidden one', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  const hiddenStart = new El({ 'data-stripe-connect-action': 'start' })
  const hiddenCard = new El({ 'data-stripe-connect-element': 'root' }, 'DIV', [hiddenStart])
  hiddenCard.hidden = true
  page.body.children.unshift(hiddenCard)
  hiddenCard.parent = page.body
  await createGate(page.win).run()
  page.goStripe.click()
  page.modalClosed(page.dlg)
  assert.equal(hiddenCard.scrolled, null)
  assert.equal(hiddenStart.focused, false)
  assert.deepEqual(page.stripeCard.scrolled, { behavior: 'smooth', block: 'center' })
  assert.equal(page.startVisible.focused, true)
})

test('screens: the Edit Profile link is a real navigation (not prevented) and does not close through the gate', async () => {
  const page = withScreens(makePage({ ready: readiness({ availability_configured: false }) }))
  await createGate(page.win).run()
  assert.equal(page.goCalendar.click().defaultPrevented, false)
  assert.deepEqual(page.closed, [])
})

test('screens: a dashboard without the Stripe card closes cleanly with no error', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  page.body.children = []
  await createGate(page.win).run()
  page.goStripe.click()
  assert.doesNotThrow(() => page.modalClosed(page.dlg))
  assert.doesNotThrow(() => { for (const t of page.timers) t.fn() })
  assert.deepEqual(page.closed, [MODAL_ID])
  assert.deepEqual(page.windowListeners['modal-close'], [])
})

test('screens: when the Stripe start control cannot take focus, the Stripe card is focused instead (script-only tabindex)', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  page.startVisible.tabIndex = -1 // authored div on the live dashboard
  await createGate(page.win).run()
  page.goStripe.click()
  page.modalClosed(page.dlg)
  assert.equal(page.startVisible.focused, false)
  assert.equal(page.stripeCard.focused, true)
  assert.equal(page.stripeCard.getAttribute('tabindex'), '-1')
})

test('screens: an authored tabindex on the Stripe card is kept', async () => {
  const page = withScreens(makePage({ ready: readiness({ stripe_connect_linked: false }) }))
  page.startVisible.tabIndex = -1
  page.stripeCard.setAttribute('tabindex', '0')
  await createGate(page.win).run()
  page.goStripe.click()
  page.modalClosed(page.dlg)
  assert.equal(page.stripeCard.focused, true)
  assert.equal(page.stripeCard.getAttribute('tabindex'), '0')
})

test('#stripe (Edit Profile paid link): staff land on the Stripe card, the dialog stays closed and the hash is removed', async () => {
  const page = withScreens(makePage({ hash: '#stripe', ready: readiness({ availability_configured: false, stripe_connect_linked: false }) }))
  const result = await createGate(page.win).run()
  assert.equal(result, 'stripe-link')
  assert.deepEqual(page.opened, [], 'no setup dialog on this visit')
  assert.equal(page.calls.length, 0, 'no readiness read needed')
  assert.deepEqual(page.stripeCard.scrolled, { behavior: 'smooth', block: 'center' })
  assert.equal(page.startVisible.focused, true)
  assert.deepEqual(page.win.history.replaced, ['/starter-dashboard'])
})

test('#stripe: waits for the Stripe card to finish loading before it scrolls', async () => {
  const page = makePage({ hash: '#stripe' })
  const loading = new El({ 'data-stripe-connect-element': 'loading' })
  page.stripeCard.children.push(loading)
  loading.parent = page.stripeCard
  const running = createGate(page.win).run()
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  assert.equal(page.stripeCard.scrolls, 0, 'no scroll while the card is loading')
  loading.hidden = true
  assert.equal(await running, 'stripe-link')
  assert.equal(page.stripeCard.scrolls, 1)
})

test('#stripe for a non-staff visitor does nothing', async () => {
  const page = makePage({ hash: '#stripe', staff: false })
  assert.equal(await createGate(page.win).run(), 'skipped:not-staff')
  assert.equal(page.stripeCard.scrolls, 0)
  assert.deepEqual(page.win.history.replaced, [])
})

test('another hash still opens the setup dialog as usual', async () => {
  const page = withScreens(makePage({ hash: '#calls', ready: readiness({ stripe_connect_linked: false }) }))
  assert.equal(await createGate(page.win).run(), 'opened')
  assert.deepEqual(page.opened, [MODAL_ID])
  assert.equal(page.stripeCard.scrolls, 0)
})
