/**
 * /build-profile/* — funnel-position redirect.
 *
 * @release v1.59.74
 *
 * ONE job: keep a Talent member who is PAST the Build-profile step from
 * re-entering it. The product flow is Apply → Build profile (creates the Xano
 * freelancers_v3 row) → Login → Onboarding → Dashboard, so the answer to "does
 * this member still belong on this page" is the same freelancer record
 * v3/auth-route.js reads at login:
 *
 *   - no freelancers_v3 row      → STAY. This is exactly who the page is for.
 *   - row, onboarding not done   → /starter-onboarding
 *   - row, onboarding done       → /starter-dashboard
 *
 * This is the page-scoped counterpart to the funnel check in
 * v3/auth-route.js. That one runs once, at login, on the one page every Talent
 * session passes through; it cannot help a member who arrives here later from a
 * bookmark, the back button, a stale email link, or a marketing CTA. Same Xano
 * surface, same 4-second overall budget, same fail-open rule, different entry
 * point. The plumbing is duplicated rather than shared on purpose: each
 * browser-facing script is dropped into a Webflow page on its own and must stand
 * alone.
 *
 * ROLE SCOPE: Talent only, and the role comes from the sitewide
 * v3/route-guard.js contract (window.StartersV3RouteGuard) rather than a second
 * copy of the plan-ID table. The guard already bounces a Brand or unmapped
 * member off these pages and already sends a logged-out visitor away, so this
 * module deliberately does nothing in those cases instead of racing the guard to
 * a different destination. If the guard is missing or loaded late, the role
 * reads as null and this module stays put — install it AFTER route-guard.js.
 *
 * FAIL-OPEN, EVERYWHERE. Logged out, Memberstack missing or slow, no role
 * contract, a non-Talent role, a rejected token trade, an HTTP error, a
 * malformed envelope, a browser without fetch, or the whole check exceeding its
 * budget: every one of those leaves the page exactly as authored. Only two
 * positive, unambiguous answers ever redirect. This is funnel UX and never a
 * security boundary — Memberstack gated content, v3/route-guard.js, and Xano
 * endpoint authorization remain the enforced layers.
 *
 * Install: one deferred tag on each of the three /build-profile pages, after
 * the sitewide route guard. Diagnostics are staging-only (`*.webflow.io`,
 * localhost, 127.0.0.1, `*.trycloudflare.com`, or `window.STARTERS_DEBUG ===
 * true`); production is silent. Wiring: see
 * v3/BUILD-PROFILE-REDIRECT-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersBuildProfileRedirectBooted) return
  window.__startersBuildProfileRedirectBooted = true

  // Same Xano surface as v3/auth-route.js and v3/onboarding-done-redirect.js.
  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var GET_FREELANCERS_PATH = '/starters_onboarding/get_freelancers'

  // Exactly the three authored Build-profile steps. Matches the three
  // Talent-only entries in route-guard.js PAGE_ROLES; like those, no
  // trailing-slash twins, because Webflow serves these normalized and the guard
  // does not list slashed forms for them either.
  var BUILD_PROFILE_PATHS = [
    '/build-profile/select-profile',
    '/build-profile/full-profile',
    '/build-profile/consult',
  ]
  var ONBOARDING_PATH = '/starter-onboarding'
  var DASHBOARD_PATH = '/starter-dashboard'

  // Same production allowlist as v3/route-guard.js, plus the local/dev-tunnel
  // hosts ./dev-tunnel.sh serves from — without those the module would be dead
  // on staging exactly when it needs QA.
  var APPROVED_HOSTS = [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ]

  var MEMBERSTACK_TIMEOUT_MS = 8000
  var MEMBERSTACK_POLL_MS = 100

  // One OVERALL deadline for the token trade plus the record read, not a
  // per-request timeout — the same shape and budget as the login-time check in
  // v3/auth-route.js. Past it the check is abandoned and the page renders.
  var FUNNEL_CHECK_BUDGET_MS = 4000

  var FUNNEL_NO_RECORD = 'no-record'
  var FUNNEL_NOT_DONE = 'not-done'
  var FUNNEL_DONE = 'done'
  var FUNNEL_UNKNOWN = 'unknown'

  var LOG_PREFIX = '[starters build-profile-redirect]'

  /* ------------------------------ environment ------------------------------ */

  // Anchored on purpose (same shape as the sibling v3 scripts): a lookalike such
  // as "notwebflow.io" or "evil-trycloudflare.com" must not read as staging,
  // because this gate also decides whether the module runs at all.
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

  function isBuildProfilePath(pathname) {
    return BUILD_PROFILE_PATHS.indexOf(pathname) !== -1
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never make the module run on an unapproved host.
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

  /* ------------------------------ role contract ------------------------------ */

  /**
   * route-guard.js is loaded sitewide before page controllers and owns the
   * stable plan-ID role contract. Reusing its exported API — exactly as
   * v3/auth-route.js does — keeps this module from carrying a second copy of the
   * plan table that could drift.
   */
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

  /* --------------------------------- budget --------------------------------- */

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
          'funnel check exceeded its ' +
            FUNNEL_CHECK_BUDGET_MS +
            'ms budget; rendering the page.',
        )
        resolve(FUNNEL_UNKNOWN)
      }, FUNNEL_CHECK_BUDGET_MS)
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

  /* ---------------------------------- auth ---------------------------------- */

  function waitForMemberstack() {
    function ready() {
      return (
        window.$memberstackDom &&
        typeof window.$memberstackDom.getCurrentMember === 'function'
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

  /* --------------------------------- funnel --------------------------------- */

  /**
   * `{"freelancer": [ <one record> ]}`, and an empty envelope for a member who
   * never completed Build profile. Only a literal `true` counts as done. An
   * unreadable record lands on "not done", which sends the member into
   * onboarding rather than past it — the same bias as v3/auth-route.js.
   */
  function onboardingStateFrom(payload) {
    var records = payload && payload.freelancer
    if (!Array.isArray(records) || records.length === 0) return FUNNEL_NO_RECORD
    var record = records[0]
    if (!record) return FUNNEL_NOT_DONE
    return record.onboarding_done === true ? FUNNEL_DONE : FUNNEL_NOT_DONE
  }

  async function readFunnelState(memberstack, signal) {
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
   * caller treats as "render the page as authored".
   */
  function funnelState(memberstack) {
    if (typeof window.fetch !== 'function') {
      warn('fetch is unavailable; skipping the funnel check.')
      return Promise.resolve(FUNNEL_UNKNOWN)
    }

    var budget = startCheckBudget()
    return Promise.race([
      readFunnelState(memberstack, budget.signal).catch(function (error) {
        warn('funnel check failed, rendering the page: ' + describe(error))
        return FUNNEL_UNKNOWN
      }),
      budget.expiry,
    ]).then(function (state) {
      budget.cancel()
      return state
    })
  }

  /* -------------------------------- decision -------------------------------- */

  /**
   * The destination this member belongs at, or null to stay. Separated from the
   * navigation itself so it can be called by hand on staging without the page
   * changing underneath the console.
   */
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
      note('no member session; route-guard.js owns this case.')
      return null
    }

    // Talent only. A Brand or unmapped member must not cost a Xano round trip,
    // and the guard is already redirecting them off this page.
    var role = memberRole(member)
    if (role !== 'talent') {
      note('role "' + role + '" is not Talent; no funnel check.')
      return null
    }

    var state = await funnelState(memberstack)
    if (state === FUNNEL_NO_RECORD) {
      note('no freelancer record; this page is exactly where the member belongs.')
      return null
    }
    if (state === FUNNEL_NOT_DONE) {
      note('record exists, onboarding not done; sending to ' + ONBOARDING_PATH + '.')
      return ONBOARDING_PATH
    }
    if (state === FUNNEL_DONE) {
      note('record exists, onboarding done; sending to ' + DASHBOARD_PATH + '.')
      return DASHBOARD_PATH
    }

    note('funnel state "' + state + '"; rendering the page.')
    return null
  }

  async function redirectPastBuildProfile() {
    var destination = await funnelDestination()
    if (!destination) return false
    window.location.replace(destination)
    return true
  }

  /* ---------------------------------- boot ---------------------------------- */

  window.StartersBuildProfileRedirect = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/build-profile-redirect.test.js drift guard asserts they match.
    release: 'v1.59.74',
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isBuildProfilePath: isBuildProfilePath,
    diagnosticsEnabled: diagnosticsEnabled,
    onboardingStateFrom: onboardingStateFrom,
    funnelState: funnelState,
    funnelDestination: funnelDestination,
    redirectPastBuildProfile: redirectPastBuildProfile,
    buildProfilePaths: BUILD_PROFILE_PATHS.slice(),
    onboardingPath: ONBOARDING_PATH,
    dashboardPath: DASHBOARD_PATH,
    checkBudgetMs: FUNNEL_CHECK_BUDGET_MS,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isBuildProfilePath(window.location.pathname)) return

  redirectPastBuildProfile().catch(function (error) {
    warn('unexpected funnel-redirect failure: ' + describe(error))
  })
})()
