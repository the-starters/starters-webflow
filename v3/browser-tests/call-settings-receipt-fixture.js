// Local Build Profile -> Call Settings receipt handoff fixture.
//
// Only Memberstack, the Xano origin, the profile-hydration completion signal
// and the third-party driver.js popover are faked. The real scheduling-auth
// bridge, the real free/paid call controllers, the real onboarding tour and the
// real canonical-profile-loader dirty-state module run unchanged in Chrome
// against authored DOM. No request leaves the browser: window.fetch is replaced
// before any controller loads, so the bridge captures this recorder as its
// original fetch.
//
// Query params:
//   page=edit|dashboard|build  which authored surface to wire
//   base=<file>,<file>         serve these controller files from the pre-fix commit
//   receipt=off-both|free-off-paid-pending|paid-pending|foreign|none
//   canonical=none|paid-active  which canonical services Xano answers with
//   baseRef=calls|rate         which pre-fix commit the base files come from
//   paid=1                     also wire the dashboard Paid card and controller
//   gate=1                     hold every Memberstack member-JSON write until released
//   seen=1                     seed an existing tours seen-stamp in the member JSON
const params = new URLSearchParams(location.search)
const page = params.get('page') || 'edit'
const baseFiles = new Set((params.get('base') || '').split(',').filter(Boolean))
const receipt = params.get('receipt') || 'off-both'
let gate = params.get('gate') === '1'
const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'

const MEMBER = {
  id: 'mem_sb_918receipt',
  auth: { email: 'jaindolwani+testbuild918receipt@example.invalid' },
  planConnections: [{ planId: 'pln_dorxata-test-free-plan-dvcg0k8o', status: 'ACTIVE', active: true }],
}

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

const RECEIPTS = {
  'off-both': {
    version: 1,
    member_id: MEMBER.id,
    free: { enabled: false, description: '' },
    paid: { enabled: false, title: '', price_dollars: 0 },
  },
  'free-off-paid-pending': {
    version: 1,
    member_id: MEMBER.id,
    free: { enabled: false, description: '' },
    paid: { enabled: true, title: 'Strategy call', price_dollars: 250 },
  },
  'paid-pending': {
    version: 1,
    member_id: MEMBER.id,
    paid: { enabled: true, title: 'Strategy call', price_dollars: 250 },
  },
  foreign: {
    version: 1,
    member_id: 'mem_sb_someone_else',
    free: { enabled: false, description: '' },
    paid: { enabled: false, title: '', price_dollars: 0 },
  },
  none: null,
}

let memberJson = { keep: 'private' }
if (RECEIPTS[receipt]) memberJson.starter_call_settings_intent_v3 = clone(RECEIPTS[receipt])
if (params.get('seen') === '1') memberJson.tours = { 'starter-dashboard': '2026-09-01T00:00:00.000Z' }

const pendingWrites = []
window.__tsMemberJsonLog = []
window.__tsNetworkLog = []

window.__tsAuthChangeHandlers = []
window.$memberstackDom = {
  getCurrentMember: async () => ({ data: MEMBER }),
  getMemberCookie: async () => 'ms-session-cookie-918receipt',
  onAuthChange(handler) { window.__tsAuthChangeHandlers.push(handler) },
  getMemberJSON: async () => {
    window.__tsMemberJsonLog.push({ op: 'read', json: clone(memberJson) })
    return { data: clone(memberJson) }
  },
  updateMemberJSON: async value => {
    const payload = clone(value && value.json) || {}
    const entry = { op: 'write', json: payload, released: !gate }
    window.__tsMemberJsonLog.push(entry)
    if (gate) {
      await new Promise(resolve => pendingWrites.push(() => { entry.released = true; resolve() }))
    }
    memberJson = payload
  },
}

window.__tsMemberJsonState = () => clone(memberJson)
window.__tsPendingWriteCount = () => pendingWrites.length
window.__tsReleaseNextWrite = () => {
  const next = pendingWrites.shift()
  if (next) next()
  return Boolean(next)
}
window.__tsOpenGate = () => { gate = false; while (pendingWrites.length) pendingWrites.shift()() }

// Stands in for the end of the Edit Profile profile hydration (Xano profile GET
// plus the locations poll), which is where canonical-profile-loader.js calls
// finishHydration() in production. Everything the assertion reads - recordEdit,
// runHydrationSync, the beforeunload guard - is the real module.
window.__tsFinishProfileHydration = () => {
  window.__tsProfileDirtyState.finishHydration()
  return true
}
window.__tsIsProfileDirty = () => window.__tsProfileDirtyState.isDirty()
window.__tsBeforeUnloadPrompts = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

// No canonical Free or Paid service exists: the off receipt is already satisfied.
const FREE_SETTINGS = {
  public_description: '',
  readiness: { calendar_connected: false, availability_configured: false, free_call_enabled: false, bookable: false },
  services: [],
}
const PAID_SETTINGS = params.get('canonical') === 'paid-active'
  ? {
    readiness: { calendar_connected: true, availability_configured: true, stripe_connected: true, stripe_charges_enabled: true, paid_call_enabled: true, bookable: true },
    services: [{ config_id: 'cfg-paid-1', title: 'Deep-dive strategy session', price_cents: 35000, currency: 'usd', duration: 60, active: true, revision: 6 }],
  }
  : {
    readiness: { calendar_connected: false, availability_configured: false, stripe_connected: false, stripe_charges_enabled: false, paid_call_enabled: false, bookable: false },
    services: [],
  }

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

window.fetch = async function (input, init) {
  const request = new Request(input, init)
  const url = new URL(request.url, location.href)
  window.__tsNetworkLog.push({
    method: request.method,
    url: url.origin + url.pathname,
    authorization: request.headers.get('Authorization') ? 'Bearer …' : null,
  })
  if (url.origin !== XANO) throw new Error('unexpected origin ' + url.origin)
  if (url.pathname === '/api:g1vmSLWh/auth/trade-token/v3') return json({ authToken: 'xano-session-token' })
  if (url.pathname === '/api:tCpV3oqd/starter/free-call-settings/get/v3') return json(FREE_SETTINGS)
  if (url.pathname === '/api:tCpV3oqd/starter/paid-call-settings/get/v3') return json(PAID_SETTINGS)
  throw new Error('unrouted request ' + url.pathname)
}

// driver.js is the third-party popover renderer and loads from jsDelivr. The
// tour's own start/seen sequence is what is under test, so a local factory
// stands in for the CDN asset and paints a real popover node the tour polls for.
window.driver = {
  js: {
    driver(config) {
      return {
        drive() {
          const popover = document.createElement('div')
          popover.className = 'driver-popover'
          const step = (config.steps && config.steps[0]) || {}
          popover.innerHTML =
            '<div class="driver-popover-title">' + ((step.popover && step.popover.title) || '') + '</div>' +
            '<div class="driver-popover-description">' + ((step.popover && step.popover.description) || '') + '</div>' +
            '<button class="driver-popover-close-btn" type="button">×</button>'
          popover.querySelector('button').addEventListener('click', () => popover.remove())
          document.body.appendChild(popover)
        },
      }
    },
  },
}

// Page globals the published Edit Profile and Build Profile embeds own. On the
// Edit Profile surface waitForMember stays inert, so canonical-profile-loader.js
// installs its dirty-state module and beforeunload guard without running the
// Xano profile draft init this fixture does not stub. On Build Profile it hands
// the member straight to the submit writer, and xanoAuthFetch stands in for the
// canonical profile endpoint.
window.setLoader = () => {}
window.waitForMember = () => {}
window.qs = (selector, scope) => (scope || document).querySelector(selector)
window.qsa = (selector, scope) => (scope || document).querySelectorAll(selector)

window.__tsProfileRequests = []
if (page === 'build') {
  window.MEMBER = {
    id: MEMBER.id,
    auth: { email: MEMBER.auth.email },
    customFields: {
      'free-user': 'Test',
      'last-name': 'Starter',
      phone: '+15555550100',
      'freelancer-dashboard-url': '/starter-dashboard',
      'freelancer-profile-url': '/starter/test-starter',
    },
  }
  window.activeProfile = { type: 'full', type_id: 'a52dcf2c568fa40bf96cd67e4f8c6186' }
  window.waitForMember = callback => callback(window.MEMBER)
  window.intlTelInput = { getInstance: () => ({ getNumber: () => '+15555550100' }) }
  window.xanoAuthFetch = async (url, init) => {
    window.__tsProfileRequests.push({ url, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ saved: true }), text: async () => '' }
  }
}
window.__tsProfileRequestLog = () => clone(window.__tsProfileRequests)

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = src
    tag.onload = resolve
    tag.onerror = () => reject(new Error('failed to load ' + src))
    document.head.appendChild(tag)
  })
}

const basePrefix = params.get('baseRef') === 'rate' ? '/base-rate' : '/base'
function sourceFor(file) {
  return (baseFiles.has(file) ? basePrefix : '') + '/v3/' + file
}

// The dashboard tour scenarios wire the Free card alone so the receipt's Paid
// branch has no controller that could touch it.
const withPaid = params.get('paid') === '1'
if (page === 'dashboard' && !withPaid) document.getElementById('paid-card').remove()

if (page === 'build' && params.get('rate')) document.getElementById('paid-call-rate').value = params.get('rate')

window.__tsControllersReady = (async () => {
  await loadScript('/v3/scheduling-auth.js')
  if (page === 'edit') await loadScript('/v3/starter-edit-profile/canonical-profile-loader.js')
  await loadScript(sourceFor('free-call-settings.js'))
  if (page === 'edit' || withPaid) await loadScript(sourceFor('paid-call-settings.js'))
  if (page === 'dashboard') await loadScript(sourceFor('onboarding-tour.js'))
  if (page === 'build') {
    await loadScript(sourceFor('build-profile/submit-writer.js'))
    // The published page parses submit-writer.js before DOMContentLoaded; this
    // fixture loads every controller dynamically, so the event is replayed once.
    document.dispatchEvent(new Event('DOMContentLoaded'))
  }
  window.__tsControllersLoaded = true
})()

const stamp = document.getElementById('stamp')
function paintStamp() {
  const html = document.documentElement
  const freeRoot = document.querySelector('[data-call-settings-service="free"], [data-form="step"][data-index="6"]')
  const success = document.querySelector('[build-profile-success]')
  stamp.textContent = [
    'page: ' + page,
    'sources: ' + (baseFiles.size ? 'base for ' + Array.from(baseFiles).join(', ') : 'HEAD'),
    'receipt: ' + receipt,
    'data-free-call-settings: ' + (html.getAttribute('data-free-call-settings') || '—'),
    'data-free-build-call-intent: ' + ((freeRoot && freeRoot.getAttribute('data-free-build-call-intent')) || '—'),
    'member JSON receipt: ' + (memberJson.starter_call_settings_intent_v3
      ? Object.keys(memberJson.starter_call_settings_intent_v3).filter(key => key === 'free' || key === 'paid').join('+') || 'empty'
      : 'consumed'),
    'tours seen: ' + (memberJson.tours ? Object.keys(memberJson.tours).join(',') : '—'),
    'member-JSON writes pending: ' + pendingWrites.length,
    'canonical profile saves: ' + window.__tsProfileRequests.length,
    'success panel: ' + (success ? (success.style.display || 'authored default') : 'n/a'),
    'step 6 unsaved changes: ' + (window.__tsProfileDirtyState ? String(window.__tsProfileDirtyState.isDirty()) : 'n/a'),
  ].join('\n')
}
setInterval(paintStamp, 50)
paintStamp()
