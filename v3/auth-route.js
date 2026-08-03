/**
 * V3 login router.
 *
 * @release v1.59.76
 *
 * Install on the V3 login pages (/login and /starter-login) and /auth-route
 * only. Every V3 login form must redirect to /auth-route so shared Memberstack
 * plan redirects can remain unchanged for V2.
 *
 * Talent members additionally get an onboarding-funnel check here, because
 * /auth-route is the one page every Talent login passes through. The product
 * flow is Apply → Build profile (creates the Xano freelancers_v3 row before the
 * member ever logs in) → Login → Onboarding → Dashboard, so the router asks
 * Xano where in that flow the member actually is:
 *
 *   - no freelancers_v3 row      → /build-profile/select-profile
 *   - row, onboarding not done   → /starter-onboarding (wins over any `next`)
 *   - row, onboarding done       → the normal `next`/role-home routing
 *
 * The check FAILS OPEN in every other case — logged out of Xano, token trade
 * rejected, HTTP error, malformed envelope, or the whole check exceeding its
 * 4s budget — and the member is routed exactly as before. This is funnel UX,
 * never a security boundary: Memberstack gated content, v3/route-guard.js, and
 * Xano endpoint authorization remain the enforced layers. Brand roles and
 * unmapped members never trigger a Xano call at all.
 */
;(function () {
  'use strict'

  if (window.__startersV3AuthRouterBooted) return
  window.__startersV3AuthRouterBooted = true

  var APPROVED_HOSTS = new Set([
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ])
  // The canonical login page, and the only one this router ever CONSTRUCTS a
  // URL for (the logged-out bounce off /auth-route).
  var LOGIN_PATH = '/login'
  // Every page that carries a V3 login form and therefore needs its redirect
  // rewritten. /starter-login is the Talent-facing form; it is a real page with
  // its own [data-ms-form="login"] and was previously left on the shared
  // Memberstack plan redirect, skipping /auth-route entirely.
  //
  // /sign-up is deliberately ABSENT. v3/starters-ms-redirect.js owns signup-form
  // redirects through its `starters-ms-redirect` markers (per-page return
  // destinations for the signup modals) and skips any form that already carries
  // a non-empty `redirect`. Adding /sign-up here would set that attribute first
  // and silently disable the marker system.
  var LOGIN_PATHS = ['/login', '/starter-login']
  var ROUTE_PATH = '/auth-route'
  var DASHBOARD_PATH = '/dashboard'
  var ONBOARDING_PATH = '/starter-onboarding'
  var BUILD_PROFILE_PATH = '/build-profile/select-profile'
  var NEXT_STORAGE_KEY = 'thestarters:v3-auth-next'
  var MEMBERSTACK_TIMEOUT_MS = 10000
  var LOG_PREFIX = '[v3-auth-route]'

  // Same Xano surface the sibling v3 modules use (see
  // v3/onboarding-done-redirect.js, opportunities-3.0.js). The plumbing is
  // duplicated rather than shared on purpose: each browser-facing script is
  // dropped into a Webflow page on its own and must stand alone.
  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var GET_FREELANCERS_PATH = '/starters_onboarding/get_freelancers'

  // One OVERALL deadline for the token trade plus the record read, not a
  // per-request timeout. /auth-route is a blank hop page, so the member is
  // staring at nothing while this runs; past the budget the funnel check is
  // abandoned and the standard destination wins.
  var ONBOARDING_CHECK_BUDGET_MS = 4000

  var FUNNEL_NO_RECORD = 'no-record'
  var FUNNEL_NOT_DONE = 'not-done'
  var FUNNEL_DONE = 'done'
  var FUNNEL_UNKNOWN = 'unknown'

  /* ------------------------------ diagnostics ------------------------------ */
  // Funnel routing is invisible to the member (one blank page replacing itself
  // with another), so staging gets a running commentary and production stays
  // silent apart from the existing configuration-error console.error calls.
  // Anchored host patterns, same shape as the sibling v3 scripts: a lookalike
  // such as "notwebflow.io" must not read as staging.

  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function note(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.info(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function describe(error) {
    return (error && error.message) || String(error)
  }

  /**
   * route-guard.js is loaded sitewide before page controllers and owns the
   * stable plan-ID role contract. Reusing its exported API keeps login routing,
   * direct access, and /dashboard on one resolver.
   */
  function roleContract() {
    var contract = window.StartersV3RouteGuard
    if (
      !contract ||
      typeof contract.memberRole !== 'function' ||
      typeof contract.memberRoleError !== 'function' ||
      typeof contract.roleHome !== 'function'
    ) {
      return null
    }
    return contract
  }

  // Backwards-compatible diagnostic wrappers around the shared role contract.
  function activePlanIds(member) {
    var contract = roleContract()
    return contract ? contract.activePlanIds(member) : []
  }
  function memberRole(member) {
    var contract = roleContract()
    return contract ? contract.memberRole(member) : null
  }
  function memberRoleError(member) {
    var contract = roleContract()
    return contract
      ? contract.memberRoleError(member)
      : 'role-contract-unavailable'
  }
  function roleHome(member) {
    var contract = roleContract()
    return contract ? contract.roleHome(member) : null
  }
  function hasCompletedQuiz(member) {
    var contract = roleContract()
    return contract ? contract.hasCompletedQuiz(member) : false
  }
  function brandFreeHome(member) {
    var contract = roleContract()
    return contract ? contract.brandFreeHome(member) : null
  }

  var ROLE_DESTINATIONS = {
    talent: new Set([
      '/starter-dashboard',
      // route-guard.js sends a logged-out visitor to /starter-onboarding
      // through /login?next=/starter-onboarding, so the round trip only closes
      // if the router is willing to hand that path back.
      '/starter-onboarding',
      '/build-profile/select-profile',
      '/build-profile/full-profile',
      '/build-profile/consult',
      '/starter-edit-profile',
      '/messages',
      '/opportunities-freelancer-view',
      '/opportunities',
      '/opportunities/',
      // Talent invoicing, guarded by route-guard.js as Talent-only since
      // 2026-08-03. Both slash forms, matching the guard's two page entries.
      '/generate-invoice',
      '/generate-invoice/',
    ]),
    'brand-paid': new Set([
      '/all-starters',
      '/brand-dashboard',
      // route-guard.js guards the Saved Starters list as paid-Brand only and
      // sends a logged-out visitor through /login?next=/favorites, so the round
      // trip only closes if the router is willing to hand that path back. Both
      // slash forms, matching the guard's two page entries.
      '/favorites',
      '/favorites/',
      '/opportunities-brands-view',
      '/opportunities',
      '/opportunities/',
      '/messages',
      // /complete-profile is deliberately absent (decision 2026-08-03).
      // Memberstack's `restrict-pages` gated group owns that page outright and
      // redirects a logged-out visitor to /login with no `?next=`, so there is
      // no round trip for the router to close and route-guard.js no longer
      // lists it either.
    ]),
    'brand-free': new Set(['/all-starters', '/quiz', '/quiz-results']),
  }
  var ROLE_DESTINATION_PREFIXES = {
    talent: ['/opportunities/'],
    'brand-paid': ['/opportunities/'],
    'brand-free': [],
  }

  ROLE_DESTINATIONS['brand-paid'].add('/opportunities---create')

  function localPath(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') return null

    try {
      var url = new URL(rawValue, window.location.origin)
      if (url.origin !== window.location.origin) return null
      if (url.username || url.password) return null
      if (url.hash) url.hash = ''
      return url.pathname + url.search
    } catch (error) {
      return null
    }
  }

  function pathnameOf(localDestination) {
    try {
      return new URL(localDestination, window.location.origin).pathname
    } catch (error) {
      return null
    }
  }

  function destinationFor(member, requestedDestination) {
    var role = memberRole(member)
    if (!role) return null

    var requested = localPath(requestedDestination)
    var requestedPathname = pathnameOf(requested)
    if (requestedPathname === DASHBOARD_PATH) return roleHome(member)
    var matchesRoleDestination =
      requestedPathname &&
      (ROLE_DESTINATIONS[role].has(requestedPathname) ||
        ROLE_DESTINATION_PREFIXES[role].some(function (prefix) {
          if (!requestedPathname.startsWith(prefix)) return false
          var suffix = requestedPathname.slice(prefix.length)
          return suffix.length > 0 && !suffix.includes('/')
        }))
    if (requested && matchesRoleDestination) {
      return requested
    }

    return roleHome(member)
  }

  function readStoredDestination() {
    try {
      return window.sessionStorage.getItem(NEXT_STORAGE_KEY)
    } catch (error) {
      return null
    }
  }

  function storeRequestedDestination(destination) {
    try {
      window.sessionStorage.setItem(NEXT_STORAGE_KEY, destination)
    } catch (error) {}
  }

  function clearRequestedDestination() {
    try {
      window.sessionStorage.removeItem(NEXT_STORAGE_KEY)
    } catch (error) {}
  }

  function requestedDestination() {
    var queryValue = new URLSearchParams(window.location.search).get('next')
    var queryDestination = localPath(queryValue)
    if (queryDestination) {
      storeRequestedDestination(queryDestination)
      return queryDestination
    }
    return localPath(readStoredDestination())
  }

  function consumeRequestedDestination() {
    var destination = requestedDestination()
    clearRequestedDestination()
    return destination
  }

  function isLoginPath(pathname) {
    return LOGIN_PATHS.indexOf(pathname) !== -1
  }

  function configureLoginForms() {
    var queryValue = new URLSearchParams(window.location.search).get('next')
    var queryDestination = localPath(queryValue)
    if (queryDestination) {
      storeRequestedDestination(queryDestination)
    } else {
      clearRequestedDestination()
    }

    // Both attributes are required. Memberstack only reads `data-ms-redirect`
    // from a click listener (it stashes the value in sessionStorage when a click
    // lands inside the element), so an Enter-key submit never registers the
    // override and the member falls through to the server-side loginRedirect.
    // Its email/password submit handler reads the plain `redirect` attribute off
    // the form directly, which covers Enter-key submits and outranks both the
    // stored override and the server value. Keep `data-ms-redirect` too: it is
    // what carries the destination through the click-driven provider flows.
    document
      .querySelectorAll('[data-ms-form="login"], [data-ms-form="signup"]')
      .forEach(function (form) {
        form.setAttribute('data-ms-redirect', ROUTE_PATH)
        form.setAttribute('redirect', ROUTE_PATH)
      })
  }

  function waitForMemberstack() {
    if (
      window.$memberstackDom &&
      typeof window.$memberstackDom.getCurrentMember === 'function'
    ) {
      return Promise.resolve(window.$memberstackDom)
    }

    return new Promise(function (resolve) {
      var startedAt = Date.now()
      var timer = window.setInterval(function () {
        if (
          window.$memberstackDom &&
          typeof window.$memberstackDom.getCurrentMember === 'function'
        ) {
          window.clearInterval(timer)
          resolve(window.$memberstackDom)
          return
        }

        if (Date.now() - startedAt >= MEMBERSTACK_TIMEOUT_MS) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  /* --------------------------- onboarding funnel --------------------------- */

  /**
   * The single 4s budget for the whole check. One AbortController is shared by
   * both requests so an expiry releases the sockets too, and `expiry` resolves
   * (never rejects) with FUNNEL_UNKNOWN so the caller's race reads like any
   * other inconclusive answer.
   */
  function startCheckBudget() {
    var controller =
      typeof window.AbortController === 'function'
        ? new window.AbortController()
        : null
    var timer = null

    var expiry = new Promise(function (resolve) {
      timer = window.setTimeout(function () {
        timer = null
        if (controller) {
          try {
            controller.abort()
          } catch (error) {}
        }
        warn(
          'onboarding check exceeded its ' +
            ONBOARDING_CHECK_BUDGET_MS +
            'ms budget; using the standard destination.',
        )
        resolve(FUNNEL_UNKNOWN)
      }, ONBOARDING_CHECK_BUDGET_MS)
    })

    return {
      expiry: expiry,
      signal: controller ? controller.signal : undefined,
      cancel: function () {
        if (timer === null) return
        window.clearTimeout(timer)
        timer = null
      },
    }
  }

  /**
   * Tolerant on purpose: the trade endpoint has been seen to answer a raw
   * string, `{authToken}`, and `{token}`, and all three are valid.
   */
  async function tradeForXanoToken(memberstack, signal) {
    if (typeof memberstack.getMemberCookie !== 'function') {
      throw new Error('Memberstack cannot supply a member cookie')
    }

    var memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw new Error('No Memberstack session cookie')

    var response = await window.fetch(
      XANO_AUTH_BASE +
        TRADE_TOKEN_PATH +
        '?token=' +
        encodeURIComponent(memberstackToken),
      { signal: signal },
    )
    var data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw new Error('Xano token trade failed with ' + response.status)
    }
    var token =
      typeof data === 'string' ? data : data && (data.authToken || data.token)
    if (!token) throw new Error('Xano token trade returned no token')
    return token
  }

  /**
   * `{"freelancer": [ <one record> ]}`, and an empty envelope for a member who
   * never completed Build profile. Only a literal `true` counts as done, so a
   * missing field or an unexpected shape lands on "not done" — the state that
   * sends the member into onboarding rather than past it.
   */
  function onboardingStateFrom(payload) {
    var records = payload && payload.freelancer
    if (!Array.isArray(records) || records.length === 0) return FUNNEL_NO_RECORD
    var record = records[0]
    if (!record) return FUNNEL_NOT_DONE
    return record.onboarding_done === true ? FUNNEL_DONE : FUNNEL_NOT_DONE
  }

  async function readOnboardingState(memberstack, signal) {
    var token = await tradeForXanoToken(memberstack, signal)
    var response = await window.fetch(
      XANO_ONBOARDING_BASE + GET_FREELANCERS_PATH,
      { headers: { Authorization: 'Bearer ' + token }, signal: signal },
    )
    if (!response.ok) {
      throw new Error('get_freelancers responded ' + response.status)
    }
    var data = await response.json().catch(function () {
      return null
    })
    return onboardingStateFrom(data)
  }

  /**
   * Always resolves, never rejects: every failure is FUNNEL_UNKNOWN, which the
   * caller treats as "route the member the way this page always did".
   */
  function onboardingFunnelState(memberstack) {
    if (typeof window.fetch !== 'function') {
      warn('fetch is unavailable; skipping the onboarding funnel check.')
      return Promise.resolve(FUNNEL_UNKNOWN)
    }

    var budget = startCheckBudget()
    return Promise.race([
      readOnboardingState(memberstack, budget.signal).catch(function (error) {
        warn(
          'onboarding funnel check failed, using the standard destination: ' +
            describe(error),
        )
        return FUNNEL_UNKNOWN
      }),
      budget.expiry,
    ]).then(function (state) {
      budget.cancel()
      return state
    })
  }

  function showConfigurationError(code) {
    document.documentElement.setAttribute('data-auth-route-error', code)
    window.dispatchEvent(
      new CustomEvent('starters:v3-auth-route-error', {
        detail: { code: code },
      }),
    )
    console.error('[v3-auth-route] Unable to route member:', code)
  }

  async function routeAuthenticatedMember() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) {
      showConfigurationError('memberstack-unavailable')
      return
    }

    var response = await memberstack.getCurrentMember()
    var member = response && response.data
    if (!member || !member.id) {
      var loginNext = consumeRequestedDestination()
      var loginUrl = loginNext
        ? LOGIN_PATH + '?next=' + encodeURIComponent(loginNext)
        : LOGIN_PATH
      window.location.replace(loginUrl)
      return
    }

    // Consumed before the funnel check, and unconditionally: whichever branch
    // wins, the stored destination has had its one chance at this login.
    var requested = consumeRequestedDestination()

    // Talent only. A Brand or unmapped member must not cost a Xano round trip,
    // and memberRole() returning null (unmapped, conflicted, or a missing role
    // contract) still falls through to the existing error handling below.
    if (memberRole(member) === 'talent') {
      var state = await onboardingFunnelState(memberstack)
      if (state === FUNNEL_NO_RECORD) {
        note(
          'no freelancer record; sending Talent to ' + BUILD_PROFILE_PATH + '.',
        )
        window.location.replace(BUILD_PROFILE_PATH)
        return
      }
      if (state === FUNNEL_NOT_DONE) {
        note(
          'onboarding not done; sending Talent to ' +
            ONBOARDING_PATH +
            (requested ? ' instead of ' + requested : '') +
            '.',
        )
        window.location.replace(ONBOARDING_PATH)
        return
      }
      note('onboarding state "' + state + '"; routing normally.')
    }

    var destination = destinationFor(member, requested)
    if (!destination) {
      showConfigurationError(memberRoleError(member))
      return
    }

    note('routing to ' + destination + '.')
    window.location.replace(destination)
  }

  var api = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/auth-route.test.js drift guard asserts they match.
    release: 'v1.59.76',
    activePlanIds: activePlanIds,
    destinationFor: destinationFor,
    hasCompletedQuiz: hasCompletedQuiz,
    brandFreeHome: brandFreeHome,
    localPath: localPath,
    memberRole: memberRole,
    memberRoleError: memberRoleError,
    roleHome: roleHome,
    // Onboarding funnel, for console diagnostics and tests.
    stagingHost: stagingHost,
    diagnosticsEnabled: diagnosticsEnabled,
    onboardingStateFrom: onboardingStateFrom,
    onboardingFunnelState: onboardingFunnelState,
    onboardingPath: ONBOARDING_PATH,
    buildProfilePath: BUILD_PROFILE_PATH,
    checkBudgetMs: ONBOARDING_CHECK_BUDGET_MS,
    isLoginPath: isLoginPath,
    loginPaths: LOGIN_PATHS.slice(),
  }
  window.StartersV3AuthRouter = api

  if (!APPROVED_HOSTS.has(window.location.hostname)) return
  if (isLoginPath(window.location.pathname)) {
    configureLoginForms()
    return
  }
  if (window.location.pathname === ROUTE_PATH) {
    routeAuthenticatedMember().catch(function (error) {
      console.error('[v3-auth-route] Unexpected routing failure', error)
      showConfigurationError('unexpected-error')
    })
  }
})()
