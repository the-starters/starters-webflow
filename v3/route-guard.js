/**
 * V3 protected-route guard.
 *
 * A thin, sitewide companion to v3/auth-route.js. auth-route.js only routes at
 * /login and /auth-route, so a logged-in member can still reach another role's
 * page by navigating directly (e.g. a Talent session opening /brand-dashboard).
 * This guard closes that gap: install it on each protected V3 page and it will
 *
 *   - send logged-out visitors to /login?next=<current path+query>,
 *   - send a logged-in member whose role is not allowed on this page to that
 *     member's role default (never the other role's page),
 *   - leave an authenticated-but-unmapped plan on the page with an explicit
 *     error state instead of silently redirecting home,
 *   - do nothing on a page it does not recognise (public/unlisted route).
 *
 * The plan-ID → role map and the page → allowed-roles table are the same stable
 * matrix used by v3/auth-route.js and documented in v3/ACCESS-MATRIX.md. This
 * guard is a routing/UX boundary only; Memberstack gated content and Xano
 * endpoint authorization remain separate, independently-enforced layers.
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

  // Identical to v3/auth-route.js and opportunities-3.0.js (MS_PLAN_ROLES).
  var PLAN_ROLES = {
    'pln_free-plan-f6kn0dxz': 'brand-free',
    'pln_new-paid-plan-463h04ph': 'brand-paid',
    'pln_dorxata-test-free-plan-dvcg0k8o': 'talent',
    'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid',
  }

  // Where each role is sent when it is not allowed on the requested page.
  // Identical to ROLE_DEFAULTS in v3/auth-route.js.
  var ROLE_DEFAULTS = {
    talent: '/starter-dashboard',
    'brand-paid': '/brand-dashboard',
    'brand-free': '/quiz-results',
  }

  // Page view-access, derived from v3/ACCESS-MATRIX.md. A role listed here may
  // load the page; any authenticated role not listed is redirected to its
  // ROLE_DEFAULTS destination. A page absent from both tables is unguarded.
  //
  // Intentionally excluded pending a product decision: /quiz-results and
  // /all-starters. The matrix rows for those pages describe logged-in redirect
  // defaults, not that logged-out access must be blocked, and either may be a
  // pre-signup funnel entry point. Leaving them out of this table means the
  // guard never forces a login there even if installed site-wide. Add them here
  // only after confirming both are authenticated-only in V3 beta.
  var PAGE_ROLES = {
    '/brand-dashboard': ['brand-paid'],
    '/messages': ['brand-paid', 'talent'],
    '/opportunities-brands-view': ['brand-paid'],
    '/opportunities-freelancer-view': ['talent'],
    '/opportunities---create': ['brand-paid'],
    '/starter-dashboard': ['talent'],
    '/starter-edit-profile': ['talent'],
    '/build-profile/select-profile': ['talent'],
    '/build-profile/full-profile': ['talent'],
    '/build-profile/consult': ['talent'],
  }

  // Single-segment opportunity detail pages (/opportunities/<slug>) are shared
  // by Talent and paid Brand only. Matches the prefix rule in v3/auth-route.js.
  var PAGE_ROLE_PREFIXES = [
    { prefix: '/opportunities/', roles: ['brand-paid', 'talent'] },
  ]

  function activePlanIds(member) {
    return (member && member.planConnections ? member.planConnections : [])
      .filter(function (connection) {
        return connection.active === true || connection.status === 'ACTIVE'
      })
      .map(function (connection) {
        return connection.planId
      })
  }

  // Mixed mapped/unmapped plans use the highest mapped role, matching auth-route.js.
  function memberRole(member) {
    var roles = activePlanIds(member)
      .map(function (planId) {
        return PLAN_ROLES[planId]
      })
      .filter(Boolean)

    if (roles.includes('brand-paid')) return 'brand-paid'
    if (roles.includes('brand-free')) return 'brand-free'
    if (roles.includes('talent')) return 'talent'
    return null
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
    return ROLE_DEFAULTS[role] // wrong role -> own default, never the other role's page
  }

  function loginPathWithNext() {
    var next = window.location.pathname + window.location.search
    return LOGIN_PATH + '?next=' + encodeURIComponent(next)
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

  async function guardCurrentPage() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) {
      showGuardError('memberstack-unavailable')
      return
    }

    var response = await memberstack.getCurrentMember()
    var member = response && response.data
    if (!member || !member.id) {
      window.location.replace(loginPathWithNext())
      return
    }

    var target = redirectTargetFor(member, window.location.pathname)
    if (target === null) {
      showGuardError('unmapped-plan')
      return
    }
    if (target) {
      window.location.replace(target)
      return
    }

    markResolved()
  }

  var api = {
    activePlanIds: activePlanIds,
    memberRole: memberRole,
    pageRolesFor: pageRolesFor,
    isGuardedPath: isGuardedPath,
    redirectTargetFor: redirectTargetFor,
  }
  window.StartersV3RouteGuard = api

  if (!APPROVED_HOSTS.has(window.location.hostname)) return
  // Only spend a Memberstack lookup on pages this guard actually protects.
  if (!isGuardedPath(window.location.pathname)) return

  document.documentElement.setAttribute('data-route-guard', 'checking')
  guardCurrentPage().catch(function (error) {
    console.error('[v3-route-guard] Unexpected guard failure', error)
    showGuardError('unexpected-error')
  })
})()
