/**
 * V3 login router.
 *
 * Install on the V3 /login and /auth-route pages only. The V3 login form must
 * redirect to /auth-route so shared Memberstack plan redirects can remain
 * unchanged for V2.
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
  var LOGIN_PATH = '/login'
  var ROUTE_PATH = '/auth-route'
  var NEXT_STORAGE_KEY = 'thestarters:v3-auth-next'
  var MEMBERSTACK_TIMEOUT_MS = 10000

  var PLAN_ROLES = {
    'pln_free-plan-f6kn0dxz': 'brand-free',
    'pln_new-paid-plan-463h04ph': 'brand-paid',
    'pln_dorxata-test-free-plan-dvcg0k8o': 'talent',
    'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid',
  }

  var ROLE_DEFAULTS = {
    talent: '/starter-dashboard',
    'brand-paid': '/brand-dashboard',
    'brand-free': '/quiz-results',
  }

  var ROLE_DESTINATIONS = {
    talent: new Set([
      '/starter-dashboard',
      '/build-profile/full-profile',
      '/starter-edit-profile',
      '/messages',
    ]),
    'brand-paid': new Set([
      '/brand-dashboard',
      '/opportunities-brands-view',
      '/messages',
    ]),
    'brand-free': new Set(['/quiz-results', '/messages']),
  }

  function activePlanIds(member) {
    return (member && member.planConnections ? member.planConnections : [])
      .filter(function (connection) {
        return connection.active === true || connection.status === 'ACTIVE'
      })
      .map(function (connection) {
        return connection.planId
      })
  }

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
    if (
      requested &&
      requestedPathname &&
      ROLE_DESTINATIONS[role].has(requestedPathname)
    ) {
      return requested
    }

    return ROLE_DEFAULTS[role]
  }

  function requestedDestination() {
    var queryValue = new URLSearchParams(window.location.search).get('next')
    var queryDestination = localPath(queryValue)
    if (queryDestination) {
      window.sessionStorage.setItem(NEXT_STORAGE_KEY, queryDestination)
      return queryDestination
    }
    return localPath(window.sessionStorage.getItem(NEXT_STORAGE_KEY))
  }

  function consumeRequestedDestination() {
    var destination = requestedDestination()
    window.sessionStorage.removeItem(NEXT_STORAGE_KEY)
    return destination
  }

  function configureLoginForms() {
    requestedDestination()

    document
      .querySelectorAll('[data-ms-form="login"], [data-ms-form="signup"]')
      .forEach(function (form) {
        form.setAttribute('data-ms-redirect', ROUTE_PATH)
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
      var requested = consumeRequestedDestination()
      var loginUrl = requested
        ? LOGIN_PATH + '?next=' + encodeURIComponent(requested)
        : LOGIN_PATH
      window.location.replace(loginUrl)
      return
    }

    var destination = destinationFor(member, consumeRequestedDestination())
    if (!destination) {
      showConfigurationError('unmapped-plan')
      return
    }

    window.location.replace(destination)
  }

  var api = {
    activePlanIds: activePlanIds,
    destinationFor: destinationFor,
    localPath: localPath,
    memberRole: memberRole,
  }
  window.StartersV3AuthRouter = api

  if (!APPROVED_HOSTS.has(window.location.hostname)) return
  if (window.location.pathname === LOGIN_PATH) {
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
