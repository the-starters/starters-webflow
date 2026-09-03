/**
 * /complete-profile — role routing for a page that belongs to exactly one role.
 *
 * @release v1.59.441
 *
 * ONE job: put every MAPPED member who lands on /complete-profile where they
 * actually belong, without a hop through /login. The page is a paid-Brand form,
 * so only a paid Brand who has not finished it has any reason to be here:
 *
 *   - paid Brand, completion marker in sessionStorage → /brand-dashboard, no network
 *   - paid Brand, Xano says brand_profile_done true   → /brand-dashboard
 *   - paid Brand, Xano says has_record true and
 *     brand_profile_done false                        → STAY. This is exactly who
 *     the page is for.
 *   - paid Brand, any inconclusive Xano answer        → STAY
 *   - free Brand                                      → its guard home
 *     (the quiz funnel: /quiz-results once `starter-quiz` is set, else /quiz)
 *   - Talent                                          → /starter-dashboard
 *
 * COMPLETION IS READ FROM XANO, NOT FROM THE MEMBER OBJECT (change of source,
 * 2026-08-06). Until this release the paid-Brand branch read the Memberstack
 * custom field `completed-brand-profile` off the member object route-guard.js had
 * already resolved, which cost nothing but broke the SAME-SIGNAL RULE: the
 * inbound check (v3/brand-profile-redirect.js on /brand-dashboard) reads Xano, so
 * two halves of one loop answering from two sources means a fresh completer
 * ping-pongs — the field lands in Memberstack immediately, the webhook mirror
 * into `brands_v3.brand_profile_done` lands seconds later, and in between this
 * page forwarded the member to the dashboard while the dashboard bounced them
 * straight back. Both halves now read:
 *
 *   GET api:KZf7nFnk/starters_onboarding/get_brand_profile_status
 *   → {has_record, brand_profile_done}
 *
 * authorized by the proven trade-token flow (the Memberstack JWT from
 * `getMemberCookie()` traded at api:g1vmSLWh/auth/trade-token/v3). No inputs: the
 * member is derived from the bearer token. The plumbing is duplicated from the
 * sibling v3 modules rather than shared, on purpose — each browser-facing script
 * is dropped into a Webflow page on its own and must stand alone.
 *
 * THE MARKER COMES FIRST, AND COSTS NOTHING. v3/brand-account-controller.js
 * stamps `thestarters:v3-brand-profile-completed` into sessionStorage the moment
 * its durable completion write resolves, and a non-empty value here is read as
 * DONE with no network call at all — that is what closes the webhook's catch-up
 * window from this side. It is deliberately sessionStorage and deliberately never
 * cleared here: it dies with the tab, by which time Xano answers for itself.
 * Every access is wrapped, because Safari private mode throws on the property
 * itself, and a storage failure only costs one fail-open read.
 *
 * The role and the other two destinations still come from the guard contract
 * already in memory, so the free-Brand and Talent branches remain ZERO network
 * beyond the one getCurrentMember() call. Only the paid-Brand branch spends a
 * round trip, and only when the marker is absent.
 *
 * WHY THE ROLE BRANCHES EXIST (decision 2026-08-03 evening). Until this release a
 * free Brand or a Talent member who reached /complete-profile was left on a form
 * they can neither fill in nor submit, and the only way out was a manual trip to
 * /login so the guard's member-home bounce could forward them. That hop is
 * pointless: this module already holds the member object and the guard's own
 * roleHome() answer, so it sends them straight to their home instead. Same
 * destinations the /login bounce would have produced, one navigation instead of
 * two, and no login form flashing at an already-authenticated member.
 *
 * WHAT THIS MODULE IS STILL NOT. It is not the page's access gate and it never
 * sends anyone TO this page. Access to /complete-profile is owned entirely by the
 * Memberstack `restrict-pages` gated content group — URL rule STARTS
 * `complete-profile`, access "All Members", Access Denied URL `login` (the
 * dashboard field's slug form; a denied visitor lands on the path /login) — and
 * v3/route-guard.js deliberately does not list the page in PAGE_ROLES — two
 * owners would mean two logged-out destinations for one URL, and Memberstack's
 * protectPages() wins that race from cached group data anyway. The logged-out
 * kick is therefore Memberstack's, not this module's, and this module never
 * touches a visitor it cannot positively identify.
 *
 * ROLE CONTRACT: the role, and the free-Brand and Talent destinations, all come
 * from the sitewide v3/route-guard.js contract (window.StartersV3RouteGuard —
 * memberRole plus roleHome) rather than a second copy of the plan-ID table or of
 * ROLE_DEFAULTS — the same borrow v3/auth-route.js and
 * v3/build-profile-redirect.js make. If the guard is missing or loaded late the
 * contract reads as unavailable and this module stays put, so install it AFTER
 * route-guard.js.
 *
 * WHO ACTUALLY GETS FORWARDED (paid Brand only). Every brand that existed before
 * the funnel shipped is grandfathered `brand_profile_done: true` in `brands_v3`,
 * so in practice this branch forwards essentially everybody except a new signup
 * who has not submitted the form yet — which is the intent: the page is for them,
 * and nobody else should be looking at it.
 *
 * FAIL-OPEN HERE MEANS STAYING, because staying is the authored state. Logged
 * out, Memberstack missing or slow, no role contract, an unmapped or cross-role
 * conflicted plan set, a role whose home the guard cannot name, a member lookup
 * that throws, an unreadable member object, a rejected token trade, an HTTP
 * error, a malformed body, a hung request, storage that throws: every one of
 * those leaves the page exactly as authored. Only a positive, unambiguous answer
 * ever redirects. The bias is the whole risk posture — a finished Brand who is
 * shown the form once more can navigate away, while a Brand forwarded to a
 * dashboard because a transient blip read as "done" has skipped the one step the
 * product needed from them. This is funnel UX and never a security boundary —
 * Memberstack gated content and Xano endpoint authorization remain the enforced
 * layers.
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

  // Same Xano surface the sibling v3 modules use (see v3/auth-route.js,
  // v3/brand-profile-redirect.js). Duplicated rather than shared on purpose:
  // each browser-facing script is dropped into a Webflow page on its own.
  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  // No inputs; the member is derived from the bearer token.
  // → {has_record, brand_profile_done}
  var BRAND_STATUS_PATH = '/starters_onboarding/get_brand_profile_status'

  // Written by v3/brand-account-controller.js the moment its durable completion
  // write resolves. Read here as DONE, never written or cleared by this file.
  var MARKER_KEY = 'thestarters:v3-brand-profile-completed'

  // One OVERALL deadline for the token trade plus the status read, not a
  // per-request timeout — the same budget v3/auth-route.js gives its funnel
  // checks. Past it the check is abandoned and the member stays on the form.
  var STATUS_BUDGET_MS = 4000

  // What the status read can conclude. DONE is the only answer that navigates.
  var BRAND_DONE = 'done'
  var BRAND_NOT_DONE = 'not-done'
  var BRAND_UNKNOWN = 'unknown'

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
   * plan-ID role contract AND the per-role home table. Reusing its exported API —
   * exactly as v3/build-profile-redirect.js does — keeps this module from carrying
   * a second copy of either, which is the only way the free-Brand quiz-funnel rule
   * (/quiz-results once `starter-quiz` is set, else /quiz) can stay in one place.
   *
   * Both halves are required together: a contract that can name a role but not its
   * home would let this module identify a Talent member and then have nowhere to
   * send them, so the whole thing reads as unavailable and the page is left alone.
   */
  function roleContract() {
    var contract = window.StartersV3RouteGuard
    if (!contract) return null
    if (typeof contract.memberRole !== 'function') return null
    if (typeof contract.roleHome !== 'function') return null
    return contract
  }

  /**
   * The contract, or null plus one staging warning. Both borrows below go through
   * here so the "no usable guard" answer is worded and logged in exactly one
   * place — an install-order mistake reads the same whichever half asked first.
   */
  function contractOrWarn() {
    var contract = roleContract()
    if (contract) return contract
    warn('route guard role contract unavailable; leaving the page alone.')
    return null
  }

  function memberRole(member) {
    var contract = contractOrWarn()
    if (!contract) return null
    return contract.memberRole(member)
  }

  /**
   * The guard's own answer for "where does this member live?" — /starter-dashboard
   * for Talent, and for a free Brand the quiz funnel decided by the `starter-quiz`
   * marker. Deliberately not reimplemented here; if the guard ever changes a role
   * home, this page follows automatically.
   */
  function roleHome(member) {
    var contract = contractOrWarn()
    if (!contract) return null
    return contract.roleHome(member) || null
  }

  /* -------------------------------- completion ------------------------------- */

  /**
   * The same-tab completion marker, checked before any network. Reading the
   * property can itself throw (Safari private mode), so the whole access is
   * wrapped and a failure reads as "no marker" — that costs one fail-open Xano
   * read, never a wrong destination.
   *
   * Semantics match the other two readers of this key (v3/auth-route.js,
   * v3/brand-profile-redirect.js), and are the same rule route-guard.js uses for
   * `starter-quiz`: a string counts only once trimmed non-empty, and a non-string
   * truthy value counts as set.
   */
  function completionMarkerSet() {
    var value
    try {
      var storage = window.sessionStorage
      if (!storage || typeof storage.getItem !== 'function') return false
      value = storage.getItem(MARKER_KEY)
    } catch (error) {
      note('sessionStorage is unavailable, so the marker cannot be read.')
      return false
    }
    if (typeof value === 'string') return value.trim() !== ''
    return !!value
  }

  /**
   * The single 4s budget for the whole check. One AbortController is shared by
   * both requests so an expiry releases the sockets too, and `expiry` resolves
   * (never rejects) with BRAND_UNKNOWN so the caller's race reads like any other
   * inconclusive answer — which on this page means "stay".
   */
  function startStatusBudget() {
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
          'brand profile check exceeded its ' +
            STATUS_BUDGET_MS +
            'ms budget; leaving the page alone.',
        )
        resolve(BRAND_UNKNOWN)
      }, STATUS_BUDGET_MS)
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
   * Tolerant on purpose: the trade endpoint has been seen to answer a raw string,
   * `{authToken}`, and `{token}`, and all three are valid.
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
   * `{has_record, brand_profile_done}` → one of three answers. Strict in the DONE
   * direction, because DONE is the only one that takes the member off a page they
   * may still need:
   *
   *   - has_record true + a literal `true`  → DONE, the only navigating answer.
   *   - has_record true + a literal `false` → NOT DONE, the page as authored.
   *   - has_record false                    → UNKNOWN. No brands_v3 row means the
   *     webhook has not mirrored this member yet; the form is still the right
   *     place for them.
   *   - anything else (missing, null, "true", 1) → UNKNOWN.
   */
  function brandProfileStateFrom(payload) {
    if (!payload || typeof payload !== 'object') return BRAND_UNKNOWN
    if (payload.has_record !== true) return BRAND_UNKNOWN
    if (payload.brand_profile_done === true) return BRAND_DONE
    if (payload.brand_profile_done === false) return BRAND_NOT_DONE
    return BRAND_UNKNOWN
  }

  async function readBrandProfileState(memberstack, signal) {
    var token = await tradeForXanoToken(memberstack, signal)
    var response = await window.fetch(XANO_ONBOARDING_BASE + BRAND_STATUS_PATH, {
      headers: { Authorization: 'Bearer ' + token },
      signal: signal,
    })
    if (!response.ok) {
      throw new Error('get_brand_profile_status responded ' + response.status)
    }
    var data = await response.json().catch(function () {
      return null
    })
    return brandProfileStateFrom(data)
  }

  /**
   * Always resolves, never rejects: every failure is BRAND_UNKNOWN, which the
   * caller treats as "leave the page exactly as authored".
   */
  function brandProfileState(memberstack) {
    if (completionMarkerSet()) {
      note('completion marker is set; skipping the Xano read.')
      return Promise.resolve(BRAND_DONE)
    }

    if (typeof window.fetch !== 'function') {
      warn('fetch is unavailable; leaving the page alone.')
      return Promise.resolve(BRAND_UNKNOWN)
    }

    var budget = startStatusBudget()
    return Promise.race([
      readBrandProfileState(memberstack, budget.signal).catch(function (error) {
        warn(
          'brand profile status read failed, leaving the page alone: ' +
            describe(error),
        )
        return BRAND_UNKNOWN
      }),
      budget.expiry,
    ]).then(function (state) {
      budget.cancel()
      return state
    })
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
   * changing underneath the console. It answers for all three roles now, not just
   * the paid-Brand completion case: /brand-dashboard, the free-Brand quiz funnel,
   * or /starter-dashboard.
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

    // An unmapped or cross-role conflicted plan set resolves to null here, and
    // that stays untouched: the gated group already decided this member may see
    // the page, and guessing a home for a member whose plans do not add up would
    // be worse than the form they cannot submit. memberRole() has already warned
    // if the contract itself was missing.
    var role = memberRole(member)
    if (!role) {
      note('no mapped role for this member; leaving the page alone.')
      return null
    }

    // The one role the page was authored for, and the only role whose answer can
    // be "stay" — and the only one that costs a network call.
    if (role === 'brand-paid') {
      var state = await brandProfileState(memberstack)
      if (state === BRAND_DONE) {
        note('brand profile is complete; sending to ' + DASHBOARD_PATH + '.')
        return DASHBOARD_PATH
      }
      note(
        'brand profile state "' +
          state +
          '"; this page is exactly where the member belongs.',
      )
      return null
    }

    // Talent and free Brand: this form is not theirs and never will be, so send
    // them to the home the guard would have sent them to after a /login hop —
    // /starter-dashboard for Talent, the quiz funnel for a free Brand — and skip
    // the hop. Neither the completion marker nor the Xano read is consulted for
    // either role: both are paid-Brand signals, a stray marker on the wrong role
    // means nothing, and this endpoint has no record for them anyway.
    var home = roleHome(member)
    if (!home) {
      warn(
        'role "' +
          role +
          '" has no home in the route guard contract; leaving the page alone.',
      )
      return null
    }

    note(
      'role "' +
        role +
        '" does not belong on this page; sending to ' +
        home +
        '.',
    )
    return home
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
    release: 'v1.59.441',
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isCompleteProfilePath: isCompleteProfilePath,
    diagnosticsEnabled: diagnosticsEnabled,
    // The completion signal, in both halves: the free marker check and the Xano
    // body reader, so a staging session can ask each of them in isolation.
    completionMarkerSet: completionMarkerSet,
    brandProfileStateFrom: brandProfileStateFrom,
    brandProfileState: brandProfileState,
    // The two contract borrows, exported so a staging session can ask "what role
    // does the guard think I am, and where does it think I live?" without
    // reproducing the decision by hand.
    memberRole: memberRole,
    roleHome: roleHome,
    // Answers for all three roles: /brand-dashboard, the free-Brand quiz funnel,
    // or /starter-dashboard. null means stay.
    completeProfileDestination: completeProfileDestination,
    redirectPastCompleteProfile: redirectPastCompleteProfile,
    completeProfilePaths: COMPLETE_PROFILE_PATHS.slice(),
    dashboardPath: DASHBOARD_PATH,
    markerKey: MARKER_KEY,
    statusBudgetMs: STATUS_BUDGET_MS,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isCompleteProfilePath(window.location.pathname)) return

  redirectPastCompleteProfile().catch(function (error) {
    warn('unexpected completion-redirect failure: ' + describe(error))
  })
})()
