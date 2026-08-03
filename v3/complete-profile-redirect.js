/**
 * /complete-profile — role routing for a page that belongs to exactly one role.
 *
 * @release v1.59.81
 *
 * ONE job: put every MAPPED member who lands on /complete-profile where they
 * actually belong, without a hop through /login. The page is a paid-Brand form,
 * so only a paid Brand who has not finished it has any reason to be here:
 *
 *   - paid Brand, `completed-brand-profile` empty/whitespace/absent → STAY. This
 *     is exactly who the page is for.
 *   - paid Brand, field carries any real value                     → /brand-dashboard
 *   - free Brand                                                   → its guard home
 *     (the quiz funnel: /quiz-results once `starter-quiz` is set, else /quiz)
 *   - Talent                                                       → /starter-dashboard
 *
 * Completion is a durable signal on the member object — the Memberstack custom
 * field `completed-brand-profile`, written by a hidden `data-ms-member` input on
 * the form itself — and the role and the other two destinations come from the
 * guard contract already in memory, so the whole decision still costs ZERO
 * network requests beyond the one getCurrentMember() call.
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
 * Memberstack `restrict-pages` gated content group (URL rule STARTS
 * `complete-profile`, access "All Members", Access Denied URL `login`), and
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
 * INERT UNTIL THE FIELD IS WRITTEN (paid Brand only). `completed-brand-profile`
 * exists on the member object but nothing wrote to it before 2026-08-03, so every
 * paid Brand reads as not-done until they submit the form once with the hidden
 * input in place. That is the safe direction: the page keeps working exactly as
 * authored for the role it is for, and the completion redirect switches itself on
 * member by member as the field starts landing. The free-Brand and Talent
 * branches depend on no new field and are live immediately.
 *
 * FAIL-OPEN ON EVERY UNCERTAIN ANSWER. Logged out, Memberstack missing or slow,
 * no role contract, an unmapped or cross-role conflicted plan set, a role whose
 * home the guard cannot name, a member lookup that throws, an unreadable member
 * object: every one of those leaves the page exactly as authored. Only a
 * positive, unambiguous role answer ever redirects. This is funnel UX and never a
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

  function memberRole(member) {
    var contract = roleContract()
    if (!contract) {
      warn('route guard role contract unavailable; leaving the page alone.')
      return null
    }
    return contract.memberRole(member)
  }

  /**
   * The guard's own answer for "where does this member live?" — /starter-dashboard
   * for Talent, and for a free Brand the quiz funnel decided by the `starter-quiz`
   * marker. Deliberately not reimplemented here; if the guard ever changes a role
   * home, this page follows automatically.
   */
  function roleHome(member) {
    var contract = roleContract()
    if (!contract) {
      warn('route guard role contract unavailable; leaving the page alone.')
      return null
    }
    return contract.roleHome(member) || null
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
    // be "stay".
    if (role === 'brand-paid') {
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

    // Talent and free Brand: this form is not theirs and never will be, so send
    // them to the home the guard would have sent them to after a /login hop —
    // /starter-dashboard for Talent, the quiz funnel for a free Brand — and skip
    // the hop. `completed-brand-profile` is not consulted for either role; it is a
    // paid-Brand form marker and a stray value on the wrong role means nothing.
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
    release: 'v1.59.81',
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isCompleteProfilePath: isCompleteProfilePath,
    diagnosticsEnabled: diagnosticsEnabled,
    hasCompletedBrandProfile: hasCompletedBrandProfile,
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
    doneField: DONE_FIELD,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isCompleteProfilePath(window.location.pathname)) return

  redirectPastCompleteProfile().catch(function (error) {
    warn('unexpected completion-redirect failure: ' + describe(error))
  })
})()
