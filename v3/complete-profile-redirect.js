/**
 * /complete-profile — paid-Brand completion redirect.
 *
 * @release v1.59.77
 *
 * ONE job: keep a paid Brand who has already finished the Complete-profile form
 * from re-entering it. Completion is a durable signal on the member object — the
 * Memberstack custom field `completed-brand-profile`, written by a hidden
 * `data-ms-member` input on the form itself — so this check costs no network
 * request at all:
 *
 *   - field empty, whitespace-only, or absent → STAY. This is exactly who the
 *     page is for.
 *   - field carries any real value            → /brand-dashboard
 *
 * WHAT THIS MODULE IS NOT. It is not the page's access gate and it never sends
 * anyone TO this page. Access to /complete-profile is owned entirely by the
 * Memberstack `restrict-pages` gated content group (URL rule STARTS
 * `complete-profile`, redirect `login`), and v3/route-guard.js deliberately does
 * not list the page in PAGE_ROLES — two owners would mean two logged-out
 * destinations for one URL, and Memberstack's protectPages() wins that race from
 * cached group data anyway. A member without group access is kicked to /login and
 * forwarded on by the guard's member-bounce pages. Everything except the one
 * positive paid-Brand "already done" answer is therefore somebody else's job, and
 * this module does nothing in those cases rather than race another layer to a
 * different destination.
 *
 * ROLE SCOPE: paid Brand only, and the role comes from the sitewide
 * v3/route-guard.js contract (window.StartersV3RouteGuard) rather than a second
 * copy of the plan-ID table — the same borrow v3/auth-route.js and
 * v3/build-profile-redirect.js make. If the guard is missing or loaded late the
 * role reads as null and this module stays put, so install it AFTER
 * route-guard.js.
 *
 * INERT UNTIL THE FIELD IS WRITTEN. `completed-brand-profile` exists on the
 * member object but nothing wrote to it before 2026-08-03, so every member reads
 * as not-done until they submit the form once with the hidden input in place.
 * That is the safe direction: the page keeps working exactly as authored, and the
 * redirect switches itself on member by member as the field starts landing.
 *
 * FAIL-OPEN, EVERYWHERE. Logged out, Memberstack missing or slow, no role
 * contract, a non-paid-Brand role, a member lookup that throws, an unreadable
 * member object: every one of those leaves the page exactly as authored. Only one
 * positive, unambiguous answer ever redirects. This is funnel UX and never a
 * security boundary — Memberstack gated content and Xano endpoint authorization
 * remain the enforced layers.
 *
 * Install: one deferred page-level tag on /complete-profile, after the sitewide
 * route guard. Diagnostics are staging-only (`*.webflow.io`, localhost,
 * 127.0.0.1, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`);
 * production is silent. Wiring: see v3/COMPLETE-PROFILE-REDIRECT-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersCompleteProfileRedirectBooted) return
  window.__startersCompleteProfileRedirectBooted = true

  // Both slash forms, for the same reason route-guard.js lists both forms of
  // /favorites and /dashboard: no prefix rule catches the trailing-slash twin,
  // so each URL form needs its own entry to behave identically if Webflow ever
  // serves the page un-normalized.
  var COMPLETE_PROFILE_PATHS = ['/complete-profile', '/complete-profile/']
  var DASHBOARD_PATH = '/brand-dashboard'

  // The Memberstack custom field the form's hidden `data-ms-member` input writes
  // on submit. Read from the member object route-guard.js already resolves — no
  // extra call, and no Xano surface involved.
  var DONE_FIELD = 'completed-brand-profile'

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

  var LOG_PREFIX = '[starters complete-profile-redirect]'

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

  function isCompleteProfilePath(pathname) {
    return COMPLETE_PROFILE_PATHS.indexOf(pathname) !== -1
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
   * route-guard.js is loaded sitewide before page controllers and owns the stable
   * plan-ID role contract. Reusing its exported API — exactly as
   * v3/build-profile-redirect.js does — keeps this module from carrying a second
   * copy of the plan table that could drift.
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

  /* -------------------------------- completion ------------------------------- */

  /**
   * Deliberately the same semantics as route-guard.js's hasCompletedQuiz for the
   * `starter-quiz` field: a string counts only once trimmed non-empty, and a
   * non-string truthy value counts as set. Memberstack has been seen to hand back
   * a boolean for checkbox-backed fields, and a form that wrote *something*
   * should not be re-run because the something was not a string.
   *
   * The bias is toward STAYING: an absent field, an empty string, and a
   * whitespace-only value all read as not done, which leaves the page as
   * authored. Re-showing a completed form is a harmless annoyance; redirecting a
   * member away from a form they still have to fill in is not.
   */
  function hasCompletedBrandProfile(member) {
    var fields = (member && member.customFields) || {}
    var value = fields[DONE_FIELD]
    return typeof value === 'string' ? value.trim() !== '' : !!value
  }

  /* -------------------------------- decision -------------------------------- */

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
   * The destination this member belongs at, or null to stay. Separated from the
   * navigation itself so it can be called by hand on staging without the page
   * changing underneath the console.
   */
  async function completeProfileDestination() {
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
      note('no member session; Memberstack gated content owns this case.')
      return null
    }

    // Paid Brand only. Talent, a free Brand, and an unmapped or conflicted
    // member are all somebody else's problem: the gated group decides whether
    // they may see this page at all, and nothing here should second-guess it.
    var role = memberRole(member)
    if (role !== 'brand-paid') {
      note('role "' + role + '" is not paid Brand; no completion check.')
      return null
    }

    if (!hasCompletedBrandProfile(member)) {
      note(
        '"' +
          DONE_FIELD +
          '" is not set; this page is exactly where the member belongs.',
      )
      return null
    }

    note('"' + DONE_FIELD + '" is set; sending to ' + DASHBOARD_PATH + '.')
    return DASHBOARD_PATH
  }

  async function redirectPastCompleteProfile() {
    var destination = await completeProfileDestination()
    if (!destination) return false
    window.location.replace(destination)
    return true
  }

  /* ---------------------------------- boot ---------------------------------- */

  window.StartersCompleteProfileRedirect = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/complete-profile-redirect.test.js drift guard asserts they match.
    release: 'v1.59.77',
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isCompleteProfilePath: isCompleteProfilePath,
    diagnosticsEnabled: diagnosticsEnabled,
    hasCompletedBrandProfile: hasCompletedBrandProfile,
    completeProfileDestination: completeProfileDestination,
    redirectPastCompleteProfile: redirectPastCompleteProfile,
    completeProfilePaths: COMPLETE_PROFILE_PATHS.slice(),
    dashboardPath: DASHBOARD_PATH,
    doneField: DONE_FIELD,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isCompleteProfilePath(window.location.pathname)) return

  redirectPastCompleteProfile().catch(function (error) {
    warn('unexpected completion-redirect failure: ' + describe(error))
  })
})()
