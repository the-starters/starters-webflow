/**
 * V3 protected-route guard.
 *
 * @release v1.59.86
 *
 * A thin, sitewide companion to v3/auth-route.js. auth-route.js only routes at
 * /login and /auth-route, so a logged-in member can still reach another role's
 * page by navigating directly (e.g. a Talent session opening /brand-dashboard).
 * This guard closes that gap: install it once sitewide before page controllers
 * and it will
 *
 *   - send logged-out visitors to /login?next=<current path+query>, or to the
 *     per-page destination in LOGGED_OUT_DESTINATIONS where a funnel page wants
 *     the homepage instead of a login form,
 *   - route /dashboard to the authenticated member's role-specific home,
 *   - send a logged-in member whose role is not allowed on this page to that
 *     member's role default (never the other role's page),
 *   - bounce an already-logged-in member off the four public entry pages in
 *     MEMBER_BOUNCE_PAGES (homepage, both login pages, signup) to a validated
 *     `?next=` or their role home, while leaving logged-out visitors there
 *     completely alone — with two homepage-only overrides on '/' (see
 *     homepageBounceOverride): a cancelled paid Brand goes to /all-starters,
 *     and a free Brand who has not taken the quiz stays put,
 *   - send a logged-in member whose role does not belong on one of the
 *     ROLE_BOUNCE_PAGES (/quiz-results, /all-starters) to that member's role
 *     home, again leaving logged-out visitors completely alone,
 *   - leave an authenticated-but-unmapped or cross-role-conflicted member on
 *     the page with an explicit error state instead of silently redirecting,
 *   - do nothing on a page it does not recognise (public/unlisted route).
 *
 * The plan-ID → role map and guarded page roles derive from the stable access
 * matrix used by v3/auth-route.js and documented in v3/ACCESS-MATRIX.md.
 * /quiz stays outside all three tables (its page controller
 * quiz-main/quiz-redirect.js owns it), and /quiz-results and /all-starters are
 * role-bounce pages rather than guarded pages, so neither ever forces a login.
 * This guard is a routing/UX boundary only; Memberstack gated content and Xano
 * endpoint authorization remain separate, independently enforced layers.
 */
;(function () {
  'use strict'

  if (window.__startersV3RouteGuardBooted) return
  window.__startersV3RouteGuardBooted = true

  var APPROVED_HOSTS = new Set([
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ])
  var LOGIN_PATH = '/login'
  var MEMBERSTACK_TIMEOUT_MS = 10000
  var LOG_PREFIX = '[v3-route-guard]'
  var SHARED_OPPORTUNITIES_ROLE_TIMEOUT_MS = 2000
  var SHARED_OPPORTUNITIES_ROLE_POLL_MS = 100

  // Written by quiz-main.js on /quiz and consumed by quiz-results.js. Same key
  // and same `ready` status quiz-main/quiz-redirect.js reads.
  var PENDING_QUIZ_STORAGE_KEY = 'starterQuizPending'
  var PENDING_QUIZ_READY_STATUS = 'ready'

  // Identical to v3/auth-route.js and opportunities-3.0.js (MS_PLAN_ROLES).
  var PLAN_ROLES = {
    'pln_free-plan-f6kn0dxz': 'brand-free',
    'pln_new-paid-plan-463h04ph': 'brand-paid',
    'pln_dorxata-test-free-plan-dvcg0k8o': 'talent',
    'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid',
  }

  // Where each role is sent when it is not allowed on the requested page.
  // Identical to ROLE_DEFAULTS in v3/auth-route.js. brand-free is decided at
  // runtime by quiz completion (see brandFreeHome); the map value is the
  // not-yet-completed fallback.
  var ROLE_DEFAULTS = {
    talent: '/starter-dashboard',
    'brand-paid': '/brand-dashboard',
    'brand-free': '/quiz',
  }

  // A brand-free member's home is /quiz-results once the quiz is completed,
  // else /quiz. Same durable signal the /quiz-results page reads: the
  // Memberstack `starter-quiz` custom field (on the member object, no extra
  // call). Identical to brandFreeHome in v3/auth-route.js.
  function hasCompletedQuiz(member) {
    var cf = (member && member.customFields) || {}
    var value = cf['starter-quiz']
    return typeof value === 'string' ? value.trim() !== '' : !!value
  }
  function brandFreeHome(member) {
    return hasCompletedQuiz(member) ? '/quiz-results' : '/quiz'
  }

  /**
   * A finished-but-not-yet-persisted quiz sitting in sessionStorage.
   *
   * The `starter-quiz` custom field cannot be the only gate on /quiz-results,
   * because of the order the post-signup funnel runs in: quiz-main.js saves the
   * answers to sessionStorage, Memberstack signs the visitor up and redirects
   * them to /quiz-results, and it is quiz-results.js — running ON that page,
   * AFTER it renders — that writes the field. A member who has just signed up
   * therefore always reads as not-completed for a moment, and hasCompletedQuiz()
   * alone would bounce them off the very page that was about to save their
   * answers. The `ready` payload is the same signal quiz-results.js renders
   * from, so it counts as "quiz done" for the enforcement branch below.
   *
   * Read-only on purpose, and never cleared: quiz-loader/quiz-loader.js derives
   * its skip-on-refresh run id from this key's `updatedAt`, and quiz-results.js
   * still needs the payload to render.
   *
   * Deliberately duplicated from quiz-main/quiz-redirect.js (v1.59.84) rather
   * than shared — these are two independently loaded browser scripts with no
   * module boundary between them, and cross-file duplication with matching
   * comments is this repo's convention (see PLAN_ROLES and hasCompletedQuiz).
   * Same tolerance as that copy: a `draft` payload, a payload with no `status`
   * at all, malformed JSON, and blocked storage all read as NOT ready, because
   * none of them proves the visitor finished the quiz. quiz-results.js is more
   * tolerant of a status-less payload; this gate is not, so every failure mode
   * falls back to today's behaviour.
   *
   * @returns {boolean}
   */
  function hasReadyPendingQuiz() {
    var raw
    try {
      var storage = window.sessionStorage
      if (!storage) return false
      raw = storage.getItem(PENDING_QUIZ_STORAGE_KEY)
    } catch (error) {
      // Blocked storage (privacy modes) reads as "no pending quiz".
      return false
    }

    if (!raw) return false

    var payload
    try {
      payload = JSON.parse(raw)
    } catch (error) {
      // Malformed payload: ignored silently, same as no payload.
      return false
    }

    if (!payload || typeof payload !== 'object') return false

    return (
      String(payload.status || '').trim().toLowerCase() ===
      PENDING_QUIZ_READY_STATUS
    )
  }

  // Page view-access, derived from v3/ACCESS-MATRIX.md. A role listed here may
  // load the page; any authenticated role not listed is redirected to its
  // ROLE_DEFAULTS destination. A page absent from both tables is unguarded.
  //
  // Intentionally and permanently excluded: /quiz-results and /all-starters.
  // The matrix rows for those pages describe logged-in redirect defaults, not
  // that logged-out access must be blocked, and both are reachable pre-signup.
  // Leaving them out of this table is what keeps the guard from ever forcing a
  // login there. Their logged-in role rules live in ROLE_BOUNCE_PAGES below.
  var PAGE_ROLES = {
    // Canonical dashboard entry point. No role stays here: the empty allowlist
    // makes every mapped role resolve to its own default while preserving the
    // two authored dashboard pages as the actual page bodies.
    '/dashboard': [],
    // Trailing-slash twin for the same reason as /opportunities/ below: the
    // exact map misses it and there is no /dashboard/ prefix rule, so without
    // this entry the slashed URL would be unguarded if Webflow ever serves it
    // un-normalized, stranding the member on the neutral loading surface.
    '/dashboard/': [],
    '/brand-dashboard': ['brand-paid'],
    '/messages': ['brand-paid', 'talent'],
    // Merged opportunities feed (2026-07): one page, role wrappers decide the
    // rendered view. Legacy per-role feed entries below stay until those pages
    // are retired.
    '/opportunities': ['brand-paid', 'talent'],
    // Trailing-slash twin: exact map misses it and the /opportunities/ prefix
    // rule requires a non-empty slug segment, so without this entry the
    // slashed URL would be unguarded if Webflow ever serves it un-normalized.
    '/opportunities/': ['brand-paid', 'talent'],
    '/opportunities-brands-view': ['brand-paid'],
    // Saved Starters list. Paid Brand only, matching Xano #1506's own
    // memberstack_plan 4/5 precondition: a free Brand cannot hold favorites, so
    // sending it to the quiz funnel beats an empty list it cannot fill.
    // Trailing-slash twin for the same reason as /opportunities/ below.
    '/favorites': ['brand-paid'],
    '/favorites/': ['brand-paid'],
    '/opportunities-freelancer-view': ['talent'],
    '/opportunities---create': ['brand-paid'],
    '/starter-dashboard': ['talent'],
    '/starter-edit-profile': ['talent'],
    '/build-profile/select-profile': ['talent'],
    '/build-profile/full-profile': ['talent'],
    '/build-profile/consult': ['talent'],
    '/starter-onboarding': ['talent'],
    // Talent invoicing (2026-08-03). Both slash forms for the same reason as
    // /favorites/ and /dashboard/: no prefix rule catches the trailing-slash
    // twin, so each URL form needs its own entry to route identically.
    '/generate-invoice': ['talent'],
    '/generate-invoice/': ['talent'],
    // /complete-profile is deliberately absent (decision 2026-08-03).
    // Memberstack is its sole gate: the `restrict-pages` gated content group
    // carries a STARTS-WITH rule for it that redirects to /login. Adding it
    // back here would create two owners with two different logged-out
    // destinations, and Memberstack's protectPages() wins the race anyway
    // because it fires from cached group data. Members who land on /login
    // without a `?next=` are picked up by the member-home bounce pages.
  }

  // Single-segment opportunity detail pages (/opportunities/<slug>) are shared
  // by Talent and paid Brand only. Matches the prefix rule in v3/auth-route.js.
  var PAGE_ROLE_PREFIXES = [
    { prefix: '/opportunities/', roles: ['brand-paid', 'talent'] },
  ]

  /**
   * Public entry pages an already-signed-in member should never sit on
   * (decision by Jerico 2026-08-03).
   *
   * These are deliberately NOT in PAGE_ROLES. A guarded page forces a login;
   * these four must keep working exactly as authored for everyone who is not
   * signed in, because they are the pre-signup funnel itself. The bounce is
   * therefore a separate, weaker mechanism: it only ever acts on a member it
   * can positively identify AND map to a role, and every other outcome —
   * logged out, Memberstack missing or slow, unmapped plan, cross-role
   * conflict — leaves the page completely untouched, with no error attribute
   * and no redirect. A signed-out visitor cannot tell the guard is installed.
   *
   * Two login pages exist: /login is the canonical V3 form and /starter-login
   * is the Talent-facing one. Both bounce, and both are also configured by
   * v3/auth-route.js.
   */
  var MEMBER_BOUNCE_PAGES = new Set([
    '/',
    '/login',
    '/starter-login',
    '/sign-up',
  ])

  /**
   * Member-only role bounce pages (decision by Jerico 2026-08-03).
   *
   * The third page category, and the weakest of the three. Like the guarded
   * pages it keeps a member off a page their role does not belong on; like the
   * member-bounce pages it is invisible to everyone else. A logged-out visitor,
   * a member Memberstack cannot resolve, an unmapped plan, and a cross-role
   * conflict are all left completely alone: no redirect, no error attribute, no
   * `checking` stamp. Only a positively identified, role-mapped member is ever
   * moved, and only ever to their own role home.
   *
   * That asymmetry is the whole point. /quiz-results legitimately serves
   * pre-signup anonymous visitors whose quiz answers are still in
   * sessionStorage, and quiz-results.js owns that case; /all-starters is a
   * public browse page whose content is gated by Memberstack `data-ms-content`
   * rather than by route. Guarding either one would break both.
   *
   * `enforceBrandFreeQuizState` adds a /quiz-results-specific second check: an
   * allowed free Brand still belongs there only once the quiz is done, because
   * before that their role home is /quiz and the results page has nothing to
   * show them. /all-starters deliberately does not use it — both Brand tiers
   * stay regardless of quiz state.
   *
   * "Done" is two signals, not one (regression fix 2026-08-04). The Memberstack
   * `starter-quiz` field alone CANNOT be the gate here, because of the order the
   * post-signup funnel runs in: quiz-main.js saves the answers to
   * sessionStorage, Memberstack signs the visitor up and redirects them to
   * /quiz-results, and the field is written by quiz-results.js on this page,
   * AFTER it renders. Gating on the field alone therefore redirected every
   * brand-new member off /quiz-results before the page could save it — an
   * intermittent bounce-to-/quiz loop that only "worked" on the attempt where
   * the Memberstack save happened to win the race (shipped v1.59.76, reproduced
   * on staging 2026-08-04). So a ready `starterQuizPending` payload — the same
   * signal quiz-results.js renders from, and the one it is about to persist —
   * counts as done too, via hasReadyPendingQuiz(). Only the free-Brand
   * enforcement branch consults it; the wrong-role bounces above it are
   * unaffected, so a paid Brand or Talent member is still moved to their own
   * home whatever is in sessionStorage.
   */
  var ROLE_BOUNCE_PAGES = {
    '/quiz-results': { roles: ['brand-free'], enforceBrandFreeQuizState: true },
    '/quiz-results/': { roles: ['brand-free'], enforceBrandFreeQuizState: true },
    '/all-starters': {
      roles: ['brand-paid', 'brand-free'],
      enforceBrandFreeQuizState: false,
    },
    '/all-starters/': {
      roles: ['brand-paid', 'brand-free'],
      enforceBrandFreeQuizState: false,
    },
  }

  /**
   * Per-page overrides for where a LOGGED-OUT visitor to a guarded page is
   * sent, replacing the default /login?next=<here> (decision by Jerico
   * 2026-08-03).
   *
   * The build-profile funnel is reached from marketing flows, not from a
   * member's bookmark, so dropping a stranger on a login form asks them to
   * authenticate into a funnel step they have no account for yet. The homepage
   * restarts the funnel properly instead. Every other guarded page keeps the
   * /login?next= round trip, which is what makes a deep link survive a login.
   */
  var LOGGED_OUT_DESTINATIONS = {
    '/build-profile/select-profile': '/',
    '/build-profile/full-profile': '/',
    '/build-profile/consult': '/',
  }

  // The single shared definition of "this plan connection currently counts".
  // Everything that reads planConnections goes through it, so the active test
  // cannot drift between role resolution and the cancelled-plan predicate.
  function isActiveConnection(connection) {
    return connection.active === true || connection.status === 'ACTIVE'
  }

  function planConnectionsOf(member) {
    return member && member.planConnections ? member.planConnections : []
  }

  function activePlanIds(member) {
    return planConnectionsOf(member)
      .filter(isActiveConnection)
      .map(function (connection) {
        return connection.planId
      })
  }

  // Derived from PLAN_ROLES rather than a second hard-coded ID list, so adding a
  // paid Brand plan to the map above is enough to teach the cancelled predicate
  // about it.
  function isPaidBrandPlanId(planId) {
    return PLAN_ROLES[planId] === 'brand-paid'
  }

  /**
   * A member who has paid for Brand at some point and does not have a live paid
   * Brand connection now (decision by Jerico 2026-08-03).
   *
   * True when at least one paid-Brand plan connection exists and is NOT active
   * by isActiveConnection, AND no paid-Brand connection is active. Both
   * real-world sub-kinds satisfy it: the member whose older free-Brand plan is
   * still active (roleResolution says brand-free) and the member left with no
   * active plans at all (roleResolution says unmapped-plan). That is why the
   * only caller checks this BEFORE the role lookup — the second sub-kind has no
   * role to key off.
   *
   * `CANCELED` is the expected inactive Memberstack status, but the predicate
   * deliberately does not look at the status string: any inactive paid-Brand
   * connection counts, so a `PAST_DUE` or `EXPIRED` shape needs no code change.
   *
   * Unverified: the exact Memberstack payload during a cancel-at-period-end
   * grace window. While the paid connection still reports active, this returns
   * false and the member correctly remains a paid Brand with full access — the
   * fail-safe direction. Only once Memberstack flips that connection inactive
   * does the member read as cancelled.
   */
  function hasCancelledPaidBrandPlan(member) {
    var connections = planConnectionsOf(member)
    var hasInactivePaidBrand = false
    for (var i = 0; i < connections.length; i++) {
      var connection = connections[i]
      if (!connection || !isPaidBrandPlanId(connection.planId)) continue
      // Any live paid connection settles it: this member is still a paid Brand,
      // whatever else has lapsed alongside it.
      if (isActiveConnection(connection)) return false
      hasInactivePaidBrand = true
    }
    return hasInactivePaidBrand
  }

  /**
   * Resolve active plans into one application role.
   *
   * Brand Free + paid Brand is a valid same-family upgrade state and resolves
   * to paid Brand. Talent + either Brand role is a cross-family conflict and
   * fails closed. Unknown active plans are ignored when a known role exists,
   * preserving the existing mixed known/unmapped contract.
   */
  function roleResolution(member) {
    var roles = activePlanIds(member)
      .map(function (planId) {
        return PLAN_ROLES[planId]
      })
      .filter(Boolean)

    var hasTalent = roles.includes('talent')
    var hasBrandPaid = roles.includes('brand-paid')
    var hasBrandFree = roles.includes('brand-free')
    if (hasTalent && (hasBrandPaid || hasBrandFree)) {
      return { role: null, error: 'conflicting-plan-roles' }
    }
    if (hasBrandPaid) return { role: 'brand-paid', error: null }
    if (hasBrandFree) return { role: 'brand-free', error: null }
    if (hasTalent) return { role: 'talent', error: null }
    return { role: null, error: 'unmapped-plan' }
  }

  function memberRole(member) {
    return roleResolution(member).role
  }

  function memberRoleError(member) {
    return roleResolution(member).error
  }

  function roleHome(member) {
    var role = memberRole(member)
    if (!role) return null
    if (role === 'brand-free') return brandFreeHome(member)
    return ROLE_DEFAULTS[role]
  }

  // The roles allowed on a pathname, or null when the page is not guarded.
  function pageRolesFor(pathname) {
    if (Object.prototype.hasOwnProperty.call(PAGE_ROLES, pathname)) {
      return PAGE_ROLES[pathname]
    }
    for (var i = 0; i < PAGE_ROLE_PREFIXES.length; i++) {
      var rule = PAGE_ROLE_PREFIXES[i]
      if (pathname.indexOf(rule.prefix) !== 0) continue
      var suffix = pathname.slice(rule.prefix.length)
      if (suffix.length > 0 && suffix.indexOf('/') === -1) return rule.roles
    }
    return null
  }

  function isGuardedPath(pathname) {
    return pageRolesFor(pathname) !== null
  }

  // '' -> stay (allowed), a path string -> redirect there, null -> unmapped.
  function redirectTargetFor(member, pathname) {
    var allowed = pageRolesFor(pathname)
    if (!allowed) return '' // page is not guarded
    var role = memberRole(member)
    if (!role) return null // authenticated but no mapped active plan
    if (allowed.indexOf(role) !== -1) return '' // allowed on this page
    // wrong role (or canonical /dashboard) -> own default, never the other
    // role's page.
    return roleHome(member)
  }

  function loginPathWithNext(pathname, search) {
    return LOGIN_PATH + '?next=' + encodeURIComponent(pathname + (search || ''))
  }

  /**
   * Where a logged-out visitor to a guarded page goes: the LOGGED_OUT_DESTINATIONS
   * override when one exists, else the default login round trip.
   */
  function loggedOutDestinationFor(pathname, search) {
    if (
      Object.prototype.hasOwnProperty.call(LOGGED_OUT_DESTINATIONS, pathname)
    ) {
      return LOGGED_OUT_DESTINATIONS[pathname]
    }
    return loginPathWithNext(pathname, search)
  }

  function isMemberBouncePage(pathname) {
    return MEMBER_BOUNCE_PAGES.has(pathname)
  }

  function roleBounceRuleFor(pathname) {
    if (!Object.prototype.hasOwnProperty.call(ROLE_BOUNCE_PAGES, pathname)) {
      return null
    }
    return ROLE_BOUNCE_PAGES[pathname]
  }

  function isRoleBouncePage(pathname) {
    return roleBounceRuleFor(pathname) !== null
  }

  // The roles allowed on a role-bounce page, or null when it is not one. Mirrors
  // pageRolesFor so the two tables read the same way from the console.
  function roleBounceRolesFor(pathname) {
    var rule = roleBounceRuleFor(pathname)
    return rule ? rule.roles.slice() : null
  }

  // Both slash forms of every path in these tables are listed explicitly, so
  // this only has to reconcile a role home (never slashed) against the page it
  // is being compared to (either form).
  function samePage(a, b) {
    return trimTrailingSlash(a) === trimTrailingSlash(b)
  }
  function trimTrailingSlash(pathname) {
    return pathname.length > 1 && pathname.charAt(pathname.length - 1) === '/'
      ? pathname.slice(0, -1)
      : pathname
  }

  /**
   * Where a member on a ROLE_BOUNCE_PAGES page belongs.
   *
   * '' -> stay (also the answer for any page that is not a role-bounce page)
   * a path string -> redirect there
   * null -> unmapped or conflicted; stay silently, this page is public
   */
  function roleBounceTargetFor(member, pathname) {
    var rule = roleBounceRuleFor(pathname)
    if (!rule) return '' // page has no role-bounce rule
    var role = memberRole(member)
    if (!role) return null // authenticated but no mapped active plan
    if (rule.roles.indexOf(role) === -1) return roleHome(member)
    if (rule.enforceBrandFreeQuizState && role === 'brand-free') {
      // A ready pre-signup payload IS a completed quiz for this decision. It is
      // what quiz-results.js renders from and is about to write to the
      // `starter-quiz` field, so the field being empty right now proves only
      // that this page has not run yet — see the ROLE_BOUNCE_PAGES docblock.
      // Checked before brandFreeHome() so a just-signed-up member is never sent
      // back to /quiz to redo a quiz they already finished.
      if (hasReadyPendingQuiz()) return ''
      var home = brandFreeHome(member)
      // Quiz not done: home is /quiz, so this page is the wrong one even though
      // the role is allowed. Quiz done: home IS this page, so stay.
      if (!samePage(home, pathname)) return home
    }
    return ''
  }

  /**
   * Same-origin normalisation as localPath in v3/auth-route.js: a `?next=` is
   * only ever honoured as a path on this origin, never as an absolute URL to
   * somewhere else, and credentials in the URL disqualify it outright.
   */
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

  /**
   * The `?next=` half of bounceTargetFor: the local path to honour, or null when
   * this member has no usable `next`.
   *
   * A `?next=` survives when it is same-origin AND either allowed for this
   * member's role or on a page the guard does not police at all — the second
   * case is what lets a member be returned to a public marketing page they were
   * reading before they signed in. A `next` pointing back at a bounce page is
   * refused, because honouring it would land the member on a page the bounce is
   * about to move them off again.
   *
   * Extracted so the homepage overrides below can consult the exact same
   * validation instead of re-deriving it. `role` may be null (an unmapped
   * member), in which case only the unguarded-page branch can match: there is no
   * role for the allowlist test.
   *
   * That role-less case is a deliberate widening, not a refactor artefact
   * (decision 2026-08-03). Before the homepage overrides, bounceTargetFor
   * returned null on `!role` before any `?next=` was examined, so an unmapped
   * member never reached this validation at all. On '/' such a member now
   * follows a valid deep link where they previously stayed — precedence rule 1
   * applied consistently, since deep-link intent does not depend on plan state.
   * The other three bounce pages are unaffected: there the `!role` bail still
   * runs first.
   */
  function honouredNext(requestedNext, role) {
    var next = localPath(requestedNext)
    var nextPathname = next ? pathnameOf(next) : null
    if (!nextPathname || isMemberBouncePage(nextPathname)) return null
    var allowed = pageRolesFor(nextPathname)
    // Unguarded (null) is honoured as a public page. An empty allowlist —
    // /dashboard — is not: no role stays there, so it resolves to the role home
    // exactly as it does in redirectTargetFor and auth-route.js.
    if (allowed === null) return next
    if (role && allowed.indexOf(role) !== -1) return next
    return null
  }

  /**
   * Homepage-only bounce overrides (decision by Jerico 2026-08-03).
   *
   * Two rules that apply on '/' and on no other page. Every other bounce page
   * (`/login`, `/starter-login`, `/sign-up`), every guarded-page wrong-role
   * redirect, and all of auth-route.js login routing are deliberately untouched:
   * a member who lands on a login form has just authenticated and still wants
   * their funnel, whereas the homepage is where someone browses back to.
   *
   * Precedence, highest first:
   *
   *   1. A valid explicit `?next=` — deep-link intent beats both rules.
   *   2. A cancelled paid Brand goes to '/all-starters'. This overrides BOTH the
   *      brand-free roleHome fallback (the quiz funnel, which is the wrong ask
   *      of someone who already paid) AND the unmapped-plan stay-with-an-error
   *      outcome. Note this outranks rule 3, so a cancelled member whose old
   *      free plan is still live and who never took the quiz is CANCELLED, not
   *      a stay.
   *   3. A free Brand who has not completed the quiz stays on the homepage
   *      instead of being pushed to '/quiz'. Quiz-done free Brands keep going
   *      to '/quiz-results'.
   *
   * `role` and `honoured` are computed once by the caller and passed in, because
   * the fall-through path needs the identical pair — recomputing them here would
   * run memberRole and the `?next=` validation twice for every non-override
   * member on '/'.
   *
   * Returns a path to redirect to, '' to stay put, or null when no override
   * applies and the caller should fall through to the normal bounce.
   */
  function homepageBounceOverride(member, role, honoured) {
    if (honoured) return honoured
    if (hasCancelledPaidBrandPlan(member)) return '/all-starters'
    if (role === 'brand-free' && !hasCompletedQuiz(member)) return ''
    return null
  }

  /**
   * Where a signed-in member on a MEMBER_BOUNCE_PAGES page belongs.
   *
   * '' -> stay (returned only by the homepage not-yet-quizzed free-Brand rule)
   * a path string -> redirect there
   * null -> unmapped or conflicted; stay silently, this is a public page
   *
   * `pathname` is the bounce page being left. It is required for the
   * homepage-only overrides to fire at all: called without it (the pure-logic
   * unit tests, or any future caller that forgets) only the role-home behaviour
   * that predates them is reachable.
   */
  function bounceTargetFor(member, requestedNext, pathname) {
    // Computed once and shared with the homepage override below. honouredNext is
    // side-effect free, so hoisting it above the `!role` bail changes nothing:
    // that branch discards it anyway.
    var role = memberRole(member)
    var next = honouredNext(requestedNext, role)

    if (pathname === '/') {
      var override = homepageBounceOverride(member, role, next)
      if (override !== null) return override
    }

    if (!role) return null
    if (next) return next

    return roleHome(member)
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

  function showGuardError(code) {
    document.documentElement.setAttribute('data-route-guard-error', code)
    window.dispatchEvent(
      new CustomEvent('starters:v3-route-guard-error', {
        detail: { code: code },
      }),
    )
    console.error('[v3-route-guard] Unable to authorize page:', code)
  }

  function markResolved() {
    document.documentElement.setAttribute('data-route-guard', 'allowed')
    window.dispatchEvent(new CustomEvent('starters:v3-route-guard-allowed'))
  }

  function replaceLocation(target) {
    document.documentElement.setAttribute('data-route-guard', 'redirecting')
    window.dispatchEvent(new CustomEvent('starters:v3-route-guard-redirecting'))
    window.location.replace(target)
  }

  function isSharedOpportunitiesPath(pathname) {
    return pathname === '/opportunities' || pathname === '/opportunities/'
  }

  /**
   * A member with several plans can briefly expose only the lower Brand Free
   * connection during Memberstack boot. Before redirecting from the shared
   * feed, give an allowed Talent or paid-Brand connection a bounded chance to
   * hydrate. Allowed snapshots never wait; this only delays a denial.
   */
  async function waitForSharedOpportunitiesAccess(memberstack, member, pathname) {
    var target = redirectTargetFor(member, pathname)
    if (!isSharedOpportunitiesPath(pathname) || target === '') {
      return { member: member, target: target }
    }

    var deadline = Date.now() + SHARED_OPPORTUNITIES_ROLE_TIMEOUT_MS
    while (Date.now() < deadline) {
      var pollDelayMs = Math.min(
        SHARED_OPPORTUNITIES_ROLE_POLL_MS,
        deadline - Date.now(),
      )
      await new Promise(function (resolve) {
        window.setTimeout(resolve, pollDelayMs)
      })
      var remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break

      var lookup = await new Promise(function (resolve) {
        var settled = false
        var timer = window.setTimeout(function () {
          finish({ timedOut: true })
        }, remainingMs)

        function finish(result) {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          resolve(result)
        }

        Promise.resolve()
          .then(function () {
            return memberstack.getCurrentMember()
          })
          .then(
            function (response) {
              finish({ response: response })
            },
            function () {
              finish({ failed: true })
            },
          )
      })
      if (lookup.timedOut) break
      if (lookup.failed) continue
      var response = lookup.response
      if (response && response.data && response.data.id) member = response.data
      target = redirectTargetFor(member, pathname)
      if (target === '') return { member: member, target: target }
    }
    return { member: member, target: target }
  }

  async function guardCurrentPage() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) {
      showGuardError('memberstack-unavailable')
      return
    }

    var response = await memberstack.getCurrentMember()
    var member = response && response.data
    if (!member || !member.id) {
      replaceLocation(
        loggedOutDestinationFor(
          window.location.pathname,
          window.location.search,
        ),
      )
      return
    }

    var resolved = await waitForSharedOpportunitiesAccess(
      memberstack,
      member,
      window.location.pathname,
    )
    member = resolved.member
    var target = resolved.target
    if (target === null) {
      showGuardError(memberRoleError(member) || 'unmapped-plan')
      return
    }
    if (target) {
      replaceLocation(target)
      return
    }

    markResolved()
  }

  /**
   * The MEMBER_BOUNCE_PAGES counterpart to guardCurrentPage().
   *
   * Deliberately silent in every inconclusive case. No `data-route-guard`
   * "checking" stamp either: these pages are authored for signed-out visitors
   * and must not depend on this script to become visible, so the only attribute
   * it ever sets here is the "redirecting" one on the way out.
   */
  async function bounceMemberHome() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) return

    var response = await memberstack.getCurrentMember()
    var member = response && response.data
    if (!member || !member.id) return

    var next = new URLSearchParams(window.location.search).get('next')
    var target = bounceTargetFor(member, next, window.location.pathname)
    if (target === null) {
      // A public page is the wrong place to surface a plan-configuration
      // problem, so this is console-only: the member simply stays.
      console.error(
        LOG_PREFIX + ' Cannot resolve a member home:',
        memberRoleError(member) || 'unmapped-plan',
      )
      return
    }
    if (target) replaceLocation(target)
  }

  /**
   * The ROLE_BOUNCE_PAGES counterpart to guardCurrentPage().
   *
   * Silent in exactly the same cases as bounceMemberHome(), and for the same
   * reason: these pages must render for signed-out visitors without depending on
   * this script, so the only attribute it ever sets is the "redirecting" one on
   * the way out.
   */
  async function bounceRoleHome() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) return

    var response = await memberstack.getCurrentMember()
    var member = response && response.data
    if (!member || !member.id) return

    var target = roleBounceTargetFor(member, window.location.pathname)
    if (target === null) {
      // Console-only for the same reason as the member bounce: a page that
      // serves anonymous visitors is the wrong place to surface a
      // plan-configuration problem. The member simply stays.
      console.error(
        LOG_PREFIX + ' Cannot resolve a role home:',
        memberRoleError(member) || 'unmapped-plan',
      )
      return
    }
    if (target) replaceLocation(target)
  }

  var api = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/route-guard.test.js drift guard asserts they match.
    release: 'v1.59.86',
    activePlanIds: activePlanIds,
    roleResolution: roleResolution,
    memberRole: memberRole,
    memberRoleError: memberRoleError,
    roleHome: roleHome,
    hasCompletedQuiz: hasCompletedQuiz,
    hasReadyPendingQuiz: hasReadyPendingQuiz,
    hasCancelledPaidBrandPlan: hasCancelledPaidBrandPlan,
    brandFreeHome: brandFreeHome,
    pageRolesFor: pageRolesFor,
    isGuardedPath: isGuardedPath,
    redirectTargetFor: redirectTargetFor,
    waitForSharedOpportunitiesAccess: waitForSharedOpportunitiesAccess,
    // Member-home bounce and per-page logged-out overrides.
    isMemberBouncePage: isMemberBouncePage,
    bounceTargetFor: bounceTargetFor,
    localPath: localPath,
    loggedOutDestinationFor: loggedOutDestinationFor,
    // Member-only role bounce (/quiz-results, /all-starters).
    isRoleBouncePage: isRoleBouncePage,
    roleBounceRolesFor: roleBounceRolesFor,
    roleBounceTargetFor: roleBounceTargetFor,
  }
  window.StartersV3RouteGuard = api

  if (!APPROVED_HOSTS.has(window.location.hostname)) return

  // Checked before the guarded-page test: the bounce pages are intentionally
  // absent from PAGE_ROLES, so isGuardedPath() would bail out on them.
  if (isMemberBouncePage(window.location.pathname)) {
    bounceMemberHome().catch(function (error) {
      console.error(LOG_PREFIX + ' Unexpected member-bounce failure', error)
    })
    return
  }

  // Only spend a Memberstack lookup on pages one of the three tables claims.
  // The full boot order is member-bounce (above) → guarded pages (here) →
  // role-bounce (below), i.e. MEMBER_BOUNCE_PAGES is tested first and PAGE_ROLES
  // outranks only ROLE_BOUNCE_PAGES. v3/route-guard.test.js asserts the three
  // tables are disjoint, so the order decides nothing today — but if a path is
  // ever duplicated by mistake, the earlier, stronger gate is the safe winner.
  if (isGuardedPath(window.location.pathname)) {
    document.documentElement.setAttribute('data-route-guard', 'checking')
    guardCurrentPage().catch(function (error) {
      console.error('[v3-route-guard] Unexpected guard failure', error)
      showGuardError('unexpected-error')
    })
    return
  }

  if (isRoleBouncePage(window.location.pathname)) {
    bounceRoleHome().catch(function (error) {
      console.error(LOG_PREFIX + ' Unexpected role-bounce failure', error)
    })
  }
})()
