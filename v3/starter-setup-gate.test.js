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

class El {
  constructor(attrs = {}, tag = 'DIV') { this.attrs = { ...attrs }; this.tagName = tag; this.hidden = false; this.children = [] }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
  setAttribute(n, v) { this.attrs[n] = String(v) }
  querySelectorAll(sel) {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel)
    return this.children.filter((c) => m && m[1] in c.attrs && (m[2] === undefined || c.attrs[m[1]] === m[2]))
  }
}

function makePage({ staff = true, flag = true, dialog = true, ready = readiness(), readyStatus = 200, modal = true, path = '/starter-dashboard' } = {}) {
  const opened = []
  const calls = []
  const avail = new El({ 'data-setup-missing': 'availability' })
  const stripe = new El({ 'data-setup-missing': 'stripe' })
  const go = new El({ 'data-setup-action': 'go', href: '#' }, 'A')
  const dlg = new El({ 'data-setup-gate': '', 'data-modal-target': MODAL_ID }, 'DIALOG')
  dlg.children = [avail, stripe, go]
  const win = {
    location: { origin: 'https://www.thestarters.com', pathname: path },
    setTimeout: () => 0,
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
    document: { querySelector: () => (dialog ? dlg : null) },
    lumos: modal ? { modal: { list: { [MODAL_ID]: {} }, open: (id) => opened.push(id) } } : undefined,
  }
  if (flag) win.StartersStaffPreview = Promise.resolve(staff)
  return { win, opened, calls, avail, stripe, go }
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
