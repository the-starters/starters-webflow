// Local Edit Profile step 6 boundary fixture. Only Memberstack and the Xano
// origin are faked; the real scheduling-auth bridge, free-call-settings.js and
// paid-call-settings.js run unchanged in Chrome against the authored step 6 DOM.
// No request leaves the browser: window.fetch is replaced before any controller
// loads, so the bridge captures this recorder as its original fetch.
const params = new URLSearchParams(location.search)
const order = (params.get('order') || 'free,paid').split(',')
const sourcePrefix = params.get('source') === 'base' ? '/base' : ''
const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'

window.__tsNetworkLog = []
window.__tsBridgeInstalled = false

const MEMBER = { id: 'mem_sb_918edit', auth: { email: 'jaindolwani+testbuild918editemail@example.invalid' } }
window.$memberstackDom = {
  getCurrentMember: async () => ({ data: MEMBER }),
  getMemberCookie: async () => 'ms-session-cookie-918edit',
  onAuthChange(handler) { window.__tsAuthChangeHandlers.push(handler) },
}
window.__tsAuthChangeHandlers = []
window.__tsNotifyAuthChange = () => {
  window.__tsAuthChangeHandlers.forEach(handler => { handler({ data: MEMBER }) })
}

const FREE_SETTINGS = {
  public_description: 'Intro call about growth strategy',
  readiness: { calendar_connected: true, availability_configured: true, free_call_enabled: true, bookable: true },
  services: [{ config_id: 'cfg-free-1', title: 'Free Consultation Call - 30min', price_cents: 0, currency: 'usd', duration: 30, active: true, revision: 6 }],
}
const PAID_SETTINGS = {
  readiness: { calendar_connected: true, availability_configured: true, stripe_connected: true, stripe_charges_enabled: true, paid_call_enabled: true, bookable: true },
  services: [{ config_id: 'cfg-paid-1', title: 'Deep-dive strategy session', price_cents: 35000, currency: 'usd', duration: 60, active: true, revision: 6 }],
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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = src
    tag.onload = resolve
    tag.onerror = () => reject(new Error('failed to load ' + src))
    document.head.appendChild(tag)
  })
}

window.__tsInstallSchedulingAuth = async () => {
  await loadScript('/v3/scheduling-auth.js')
  window.__tsBridgeInstalled = true
}

// bridge=early loads the shared auth bridge before the call controllers, the
// arrival order Edit Profile cannot guarantee. The default reproduces the race:
// both controllers execute first and the bridge arrives on the driver's signal.
window.__tsControllersReady = (async () => {
  if (params.get('bridge') === 'early') await window.__tsInstallSchedulingAuth()
  for (const name of order) await loadScript(sourcePrefix + '/v3/' + name + '-call-settings.js')
})()

const stamp = document.getElementById('stamp')
function paintStamp() {
  const html = document.documentElement
  stamp.textContent = [
    'source: ' + (sourcePrefix ? 'base d9da4a7 (pre-fix)' : 'HEAD 600dd0c (fixed)'),
    'controller order: ' + order.join(' then '),
    'scheduling-auth bridge: ' + (window.__tsBridgeInstalled ? 'installed' : 'not yet loaded'),
    'data-free-call-settings: ' + (html.getAttribute('data-free-call-settings') || '—'),
    'data-paid-call-settings: ' + (html.getAttribute('data-paid-call-settings') || '—'),
  ].join('\n')
}
setInterval(paintStamp, 50)
paintStamp()
