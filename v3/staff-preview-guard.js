/**
 * Staff preview guard: shows a page only to verified staff members.
 *
 * Use: put a feature that is not launched on its own Webflow page (for example
 * /starter-onboarding-v2) and install this file as a NORMAL (not deferred,
 * not async) script tag in that page's head:
 *
 *   <script src=".../v3/staff-preview-guard.js"
 *           data-fallback="/starter-onboarding"></script>
 *
 * What it does:
 *   1. At once, it hides <body> with a style tag, before the page paints.
 *   2. It waits for Memberstack, then trades the Memberstack token for a Xano
 *      token (api:g1vmSLWh/auth/trade-token/v3, the same flow other v3 modules use).
 *   3. It calls GET api:kR5gpIDB/staff/session (Staff Console v1, endpoint 12006).
 *      Xano owns the staff rule (fn 5796/5797): live member, email domain exactly
 *      thestarters.com or hirethestarters.com, verified = true, local part not
 *      in the deny list.
 *   4. HTTP 200 with an email -> it sets html[data-staff-preview="allowed"] and
 *      shows the page.
 *      Logged out             -> /login?next=<this path + query>.
 *      Any other result       -> location.replace(data-fallback) (default
 *                                /starter-dashboard).
 *
 * FAIL-CLOSED, EVERYWHERE. If Memberstack is missing, the trade fails, the
 * request times out, the whole check takes more than 20 s, or the answer is
 * malformed, the visitor goes to the fallback. The page never shows without a 200 from Xano.
 *
 * This is a front-end gate for a page that is not launched. It hides UI. It is
 * not a data boundary: any new Xano endpoint the page writes to must call
 * fn 5797 require_staff_v1 itself until launch.
 *
 * Wiring and QA: docs/wiring/STAFF-PREVIEW-GUARD-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersStaffPreviewGuardBooted) return
  window.__startersStaffPreviewGuardBooted = true

  var XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  var TRADE_TOKEN_URL = XANO_ORIGIN + '/api:g1vmSLWh/auth/trade-token/v3'
  var STAFF_SESSION_URL = XANO_ORIGIN + '/api:kR5gpIDB/staff/session'
  var DEFAULT_FALLBACK = '/starter-dashboard'
  var MEMBERSTACK_TIMEOUT_MS = 8000
  var MEMBERSTACK_POLL_MS = 50
  var REQUEST_TIMEOUT_MS = 8000
  var OVERALL_DEADLINE_MS = 20000
  var ALLOWED_ATTR = 'data-staff-preview'
  var STYLE_ID = 'staff-preview-guard-hide'

  var script = document.currentScript
  var fallback = safePath(script && script.getAttribute('data-fallback')) || DEFAULT_FALLBACK
  // Flag mode (data-mode="flag", 2026-11-12): for a LIVE page that real users
  // also see (e.g. /starter-dashboard). It never hides the page and never
  // redirects; it only sets html[data-staff-preview] to allowed/denied and
  // resolves window.StartersStaffPreview (Promise<boolean>) + fires the
  // 'starters:staff-preview' event, so one staff-only element can wait for it.
  var flagMode = Boolean(script && script.getAttribute('data-mode') === 'flag')
  var settle
  window.StartersStaffPreview = new Promise(function (resolve) {
    settle = resolve
  })

  function publish(allowed) {
    settle(allowed)
    try {
      window.dispatchEvent(new CustomEvent('starters:staff-preview', { detail: { allowed: allowed } }))
    } catch (_error) {
      /* old browsers: the promise and the html attribute still carry the result */
    }
  }

  function debugEnabled() {
    var host = window.location.hostname || ''
    return (
      window.STARTERS_DEBUG === true ||
      /\.webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1'
    )
  }

  function log() {
    if (!debugEnabled() || !window.console) return
    var args = Array.prototype.slice.call(arguments)
    args.unshift('[staff-preview-guard]')
    window.console.log.apply(window.console, args)
  }

  // Only same-site absolute paths. Blocks "//evil.com", "https://...", "javascript:".
  function safePath(value) {
    var path = String(value || '').trim()
    if (!/^\/(?!\/)/.test(path)) return ''
    if (/[\\\s]/.test(path)) return ''
    return path
  }

  function hidePage() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent =
      'html:not([' + ALLOWED_ATTR + '="allowed"]) body{visibility:hidden!important}'
    ;(document.head || document.documentElement).appendChild(style)
  }

  var decided = false

  function allow(email) {
    if (decided) return
    decided = true
    document.documentElement.setAttribute(ALLOWED_ATTR, 'allowed')
    log('allowed', email)
    publish(true)
  }

  function leave(destination, reason) {
    if (decided) return
    decided = true
    document.documentElement.setAttribute(ALLOWED_ATTR, 'denied')
    publish(false)
    if (flagMode) {
      log('denied (flag mode, no redirect):', reason)
      return
    }
    log('denied:', reason, '->', destination)
    window.location.replace(destination)
  }

  function loginUrl() {
    var next = window.location.pathname + (window.location.search || '')
    return '/login?next=' + encodeURIComponent(next)
  }

  function fetchWithTimeout(url, options) {
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        reject(new Error('timeout'))
      }, REQUEST_TIMEOUT_MS)
      window.fetch(url, options).then(
        function (response) {
          window.clearTimeout(timer)
          resolve(response)
        },
        function (error) {
          window.clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  function waitForMemberstack() {
    function ready() {
      return window.$memberstackDom && typeof window.$memberstackDom.getMemberCookie === 'function'
    }
    if (ready()) return Promise.resolve(window.$memberstackDom)
    return new Promise(function (resolve) {
      var startedAt = Date.now()
      var timer = window.setInterval(function () {
        if (ready()) {
          window.clearInterval(timer)
          resolve(window.$memberstackDom)
        } else if (Date.now() - startedAt >= MEMBERSTACK_TIMEOUT_MS) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, MEMBERSTACK_POLL_MS)
    })
  }

  async function run() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) return leave(fallback, 'memberstack-unavailable')

    var memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) return leave(loginUrl(), 'logged-out')

    var trade = await fetchWithTimeout(
      TRADE_TOKEN_URL + '?token=' + encodeURIComponent(memberstackToken),
    )
    var tradeData = await trade.json().catch(function () {
      return null
    })
    if (!trade.ok) return leave(fallback, 'trade-' + trade.status)
    var token =
      typeof tradeData === 'string' ? tradeData : tradeData && (tradeData.authToken || tradeData.token)
    if (!token) return leave(fallback, 'trade-no-token')

    var response = await fetchWithTimeout(STAFF_SESSION_URL, {
      headers: { Authorization: 'Bearer ' + token },
    })
    var session = await response.json().catch(function () {
      return null
    })
    if (!response.ok) return leave(fallback, 'staff-' + response.status)
    if (!session || typeof session.email !== 'string' || !session.email) {
      return leave(fallback, 'staff-malformed')
    }
    return allow(session.email)
  }

  if (!flagMode) hidePage()
  window.setTimeout(function () {
    leave(fallback, 'deadline')
  }, OVERALL_DEADLINE_MS)
  run().catch(function (error) {
    leave(fallback, 'error: ' + (error && error.message))
  })
})()
