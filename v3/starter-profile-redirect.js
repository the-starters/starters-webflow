/**
 * Talent platform pages — the inbound half of the Starter funnel.
 *
 * @release vX.Y.Z
 *
 * ONE job: a signed-in Talent member whose Xano funnel is not finished is sent
 * forward with `location.replace()`, so a Starter who abandoned Build-profile
 * or onboarding — or who never opened them, and reached a locked page from a
 * bookmark, the back button, nav, or a stale link — is put back in the funnel
 * instead of using the platform unfinished.
 *
 *   GET api:KZf7nFnk/starters_onboarding/get_build_profile_status
 *   → {has_record, build_profile_done, onboarding_done, profile_type,
 *      platform_status}
 *
 *   - build_profile_done false → /build-profile/select-profile
 *   - done, not onboarded      → /starter-onboarding
 *   - done and onboarded       → STAY
 *   - anything else            → STAY (fail-open)
 *
 * That table is an exact replay of the Talent branch in v3/auth-route.js, on
 * page entry rather than at login. `build_profile_done` is the STRICTER signal
 * that replaced "a freelancers_v3 row exists" on 2026-08-04: it also requires
 * the row's `profile_type_30` to be non-empty, which Build-profile submit is
 * what stamps. The ~282 legacy rows with an empty `profile_type_30` are bounced
 * to Build-profile here the same way they already are at every login.
 *
 * IN-SCOPE PAGES (exact path + trailing-slash twin, plus /opportunities/<slug>):
 *   /brand-dashboard, /opportunities, /all-starters, /messages,
 *   /starter-dashboard, /dashboard
 * Identical net to v3/brand-profile-redirect.js, on purpose. Install one
 * deferred tag on each of those pages (or sitewide — out-of-scope paths exit
 * immediately). Talent only in effect: Brand / unmapped / logged-out get no
 * Xano call and stay; the route guard still owns role routing and runs first.
 *
 * PAIRED WITH the existing outbound halves, which already live on the funnel
 * pages themselves:
 *   - v3/build-profile-redirect.js on /build-profile/* keeps PAST-THAT-STEP
 *     Talent out (done → onboarding or dashboard).
 *   - v3/onboarding-done-redirect.js on /starter-onboarding keeps FINISHED
 *     Talent out (onboarding_done true → /starter-dashboard).
 * Between them the loop stays closed because every half answers from the SAME
 * signal: Xano `get_build_profile_status`. There is no sessionStorage marker.
 * A failed onboarding PATCH still redirects to the dashboard (anti-stranding
 * in v3/patch-onboarding-status.js); this module then bounces that member back
 * to onboarding to resubmit. Self-healing. If Xano is down, this read fails
 * open too, so the two cannot loop.
 *
 * ROLE GATE FIRST, BEFORE ANY XANO CALL. This is load-bearing, not style. A
 * Brand member has no freelancers_v3 row, and this endpoint answers
 * `build_profile_done: false` for that shape — the same envelope that earns
 * the Build-profile bounce. Without the role gate a paid Brand on
 * /brand-dashboard would be shipped to a Talent form. The role comes from the
 * sitewide v3/route-guard.js contract (`window.StartersV3RouteGuard.memberRole`)
 * rather than a second copy of the plan-ID table — the same borrow
 * v3/auth-route.js, v3/build-profile-redirect.js, and
 * v3/complete-profile-redirect.js make. If the guard is missing or loaded late
 * the contract reads as unavailable and this module stays put, so install it
 * AFTER route-guard.js.
 *
 * FAIL-OPEN, EVERYWHERE. Logged out, Memberstack missing or slow, no role
 * contract, a non-Talent role, token trade rejected, HTTP error, malformed
 * envelope, request timeout: every one of those leaves the page exactly as
 * authored, spinner included. This redirect is a UX courtesy, never a security
 * boundary.
 *
 * THE PAGE SPINNER. Staging currently has no `[data-page-spinner]` on
 * /starter-dashboard, so an unfinished Talent sees a brief flash before the
 * redirect (accepted). Adding that element in Designer is the revert path —
 * this file picks it up with no code change. Up before the read, down on stay,
 * left up on go.
 *
 * Install: one deferred page-level tag on each in-scope page, AFTER
 * v3/route-guard.js. Diagnostics are staging-only (`*.webflow.io`,
 * localhost, 127.0.0.1, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`);
 * production is silent. Wiring: v3/STARTER-PROFILE-REDIRECT-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersStarterProfileRedirectBooted) return
  window.__startersStarterProfileRedirectBooted = true

  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var BUILD_PROFILE_STATUS_PATH = '/starters_onboarding/get_build_profile_status'

  var GUARDED_PATHS = [
    '/brand-dashboard',
    '/brand-dashboard/',
    '/opportunities',
    '/opportunities/',
    '/all-starters',
    '/all-starters/',
    '/messages',
    '/messages/',
    '/starter-dashboard',
    '/starter-dashboard/',
    '/dashboard',
    '/dashboard/',
  ]
  var BUILD_PROFILE_PATH = '/build-profile/select-profile'
  var ONBOARDING_PATH = '/starter-onboarding'

  var APPROVED_HOSTS = ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']

  var MEMBERSTACK_TIMEOUT_MS = 8000
  var MEMBERSTACK_POLL_MS = 100
  var REQUEST_TIMEOUT_MS = 8000

  var FUNNEL_BUILD_PROFILE = 'build-profile'
  var FUNNEL_ONBOARDING = 'onboarding'
  var FUNNEL_DONE = 'done'
  var FUNNEL_UNKNOWN = 'unknown'

  var LOADER_SELECTOR = '[data-page-spinner]'

  var LOG_PREFIX = '[starters starter-profile-redirect]'

  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  function allowedHost(hostname) {
    return APPROVED_HOSTS.indexOf(hostname) !== -1 || stagingHost(hostname)
  }

  function isGuardedPath(pathname) {
    var path = pathname || ''
    if (GUARDED_PATHS.indexOf(path) !== -1) return true
    return /^\/opportunities\/[^/]+\/?$/.test(path)
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never make the module run on an unapproved host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function note(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.info(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function describe(error) {
    return (error && error.message) || String(error)
  }

  function roleContract() {
    var contract = window.StartersV3RouteGuard
    if (!contract || typeof contract.memberRole !== 'function') return null
    return contract
  }

  function memberRole(member) {
    var contract = roleContract()
    if (!contract) {
      warn('route guard role contract unavailable; leaving the page alone.')
      return null
    }
    return contract.memberRole(member)
  }

  function findLoader() {
    try {
      return document.querySelector(LOADER_SELECTOR)
    } catch (error) {
      return null
    }
  }

  // Webflow ships hidden elements as an inline `display:none`, sometimes
  // alongside the `hidden` attribute, so both are cleared.
  function showLoader() {
    var loader = findLoader()
    if (!loader) {
      note('no ' + LOADER_SELECTOR + ' element on this page; the check runs uncovered.')
      return false
    }
    try {
      if (loader.style) loader.style.display = 'block'
      if (typeof loader.removeAttribute === 'function') loader.removeAttribute('hidden')
    } catch (error) {
      warn('could not reveal the spinner: ' + describe(error))
      return false
    }
    return true
  }

  // Back to the inline `display:none` Webflow authored it with. Silent when
  // there is no element: showLoader() has already said so once, and this runs on
  // every load.
  function hideLoader() {
    var loader = findLoader()
    if (!loader) return false
    try {
      if (loader.style) loader.style.display = 'none'
    } catch (error) {
      warn('could not hide the spinner: ' + describe(error))
      return false
    }
    return true
  }

  function fetchWithTimeout(url, options) {
    var config = options || {}
    var controller =
      typeof window.AbortController === 'function' ? new window.AbortController() : null
    if (controller) {
      config = {
        method: config.method,
        headers: config.headers,
        body: config.body,
        signal: controller.signal,
      }
    }

    return new Promise(function (resolve, reject) {
      var settled = false
      var timer = window.setTimeout(function () {
        if (settled) return
        settled = true
        if (controller) {
          try {
            controller.abort()
          } catch (error) {}
        }
        reject(new Error('Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms'))
      }, REQUEST_TIMEOUT_MS)

      Promise.resolve()
        .then(function () {
          return window.fetch(url, config)
        })
        .then(
          function (response) {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(response)
          },
          function (error) {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            reject(error)
          },
        )
    })
  }

  function waitForMemberstack() {
    function ready() {
      return (
        window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === 'function'
      )
    }
    if (ready()) return Promise.resolve(window.$memberstackDom)

    return new Promise(function (resolve) {
      var startedAt = Date.now()
      var timer = window.setInterval(function () {
        if (ready()) {
          window.clearInterval(timer)
          resolve(window.$memberstackDom)
          return
        }
        if (Date.now() - startedAt >= MEMBERSTACK_TIMEOUT_MS) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, MEMBERSTACK_POLL_MS)
    })
  }

  function loggedOutError() {
    var error = new Error('No Memberstack session')
    error.code = 'logged-out'
    return error
  }

  async function tradeForXanoToken(memberstack) {
    if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
      throw new Error('Memberstack cannot supply a member cookie')
    }

    var memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw loggedOutError()

    var response = await fetchWithTimeout(
      XANO_AUTH_BASE + TRADE_TOKEN_PATH + '?token=' + encodeURIComponent(memberstackToken),
    )
    var data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) throw new Error('Xano token trade failed with ' + response.status)
    var token = typeof data === 'string' ? data : data && (data.authToken || data.token)
    if (!token) throw new Error('Xano token trade returned no token')
    return token
  }

  var xanoTokenPromise = null

  function xanoToken(memberstack) {
    if (!xanoTokenPromise) {
      xanoTokenPromise = tradeForXanoToken(memberstack).catch(function (error) {
        xanoTokenPromise = null
        throw error
      })
    }
    return xanoTokenPromise
  }

  function forgetXanoToken() {
    xanoTokenPromise = null
  }

  function authHeaders(token) {
    return { Authorization: 'Bearer ' + token }
  }

  function funnelStateFrom(payload) {
    if (!payload || typeof payload !== 'object') return FUNNEL_UNKNOWN
    if (payload.build_profile_done === false) return FUNNEL_BUILD_PROFILE
    if (payload.build_profile_done !== true) return FUNNEL_UNKNOWN
    return payload.onboarding_done === true ? FUNNEL_DONE : FUNNEL_ONBOARDING
  }

  function destinationForState(state) {
    if (state === FUNNEL_BUILD_PROFILE) return BUILD_PROFILE_PATH
    if (state === FUNNEL_ONBOARDING) return ONBOARDING_PATH
    return null
  }

  async function fetchFunnelState(memberstack) {
    var token = await xanoToken(memberstack)
    var response = await fetchWithTimeout(XANO_ONBOARDING_BASE + BUILD_PROFILE_STATUS_PATH, {
      headers: authHeaders(token),
    })
    if (!response.ok) {
      forgetXanoToken()
      throw new Error('get_build_profile_status responded ' + response.status)
    }
    var data = await response.json().catch(function () {
      return null
    })
    return funnelStateFrom(data)
  }

  async function funnelDestination() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) {
      warn('Memberstack never became available; leaving the page alone.')
      return null
    }

    var member = null
    try {
      var response = await memberstack.getCurrentMember()
      member = response && response.data
    } catch (error) {
      warn('member lookup failed, leaving the page alone: ' + describe(error))
      return null
    }

    if (!member || !member.id) {
      note('no member session; leaving the page alone.')
      return null
    }

    var role = memberRole(member)
    if (role !== 'talent') {
      note('role "' + role + '" is not Talent; no funnel check.')
      return null
    }

    var state
    try {
      state = await fetchFunnelState(memberstack)
    } catch (error) {
      if (error && error.code === 'logged-out') {
        note('no member session cookie; leaving the page alone.')
      } else {
        warn('could not read build profile status, staying put: ' + describe(error))
      }
      return null
    }

    var destination = destinationForState(state)
    if (destination) {
      note('funnel state "' + state + '"; replacing with ' + destination + '.')
      return destination
    }

    note('funnel state "' + state + '"; staying put.')
    return null
  }

  async function redirectIfIncomplete() {
    var destination = await funnelDestination()
    if (!destination) return false
    window.location.replace(destination)
    return true
  }

  function start() {
    showLoader()
    redirectIfIncomplete().then(
      function (redirecting) {
        if (redirecting) return
        hideLoader()
      },
      function (error) {
        warn('unexpected redirect-check failure: ' + describe(error))
        hideLoader()
      },
    )
  }

  window.StartersStarterProfileRedirect = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/starter-profile-redirect.test.js drift guard asserts they match.
    release: 'vX.Y.Z',
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isGuardedPath: isGuardedPath,
    diagnosticsEnabled: diagnosticsEnabled,
    funnelStateFrom: funnelStateFrom,
    destinationForState: destinationForState,
    funnelDestination: funnelDestination,
    redirectIfIncomplete: redirectIfIncomplete,
    guardedPaths: GUARDED_PATHS.slice(),
    buildProfilePath: BUILD_PROFILE_PATH,
    onboardingPath: ONBOARDING_PATH,
    loaderSelector: LOADER_SELECTOR,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isGuardedPath(window.location.pathname)) return

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
