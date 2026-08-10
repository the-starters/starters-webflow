;(function () {
  'use strict'

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const PRODUCTION_PATHS = new Set([
    '/hire/jp-test',
    '/starter-dashboard',
    '/brand-dashboard',
  ])
  const BLOCKED_PRODUCTION_PATHS = new Set(['/hire/jp-dionisio'])
  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const API_PREFIX = '/api:tCpV3oqd/'
  const activePath = window.location.pathname.replace(/\/+$/, '') || '/'
  const isStagingHost = window.location.hostname === STAGING_HOST
  const isBlockedProductionPath =
    PRODUCTION_HOSTS.has(window.location.hostname) &&
    BLOCKED_PRODUCTION_PATHS.has(activePath)
  const isApprovedProductionPath =
    PRODUCTION_HOSTS.has(window.location.hostname) && PRODUCTION_PATHS.has(activePath)
  if (isBlockedProductionPath) {
    installBlockedRoute()
    return
  }
  if (!isStagingHost && !isApprovedProductionPath) return
  const legacyBridgeInstalled =
    window.__tsSchedulingAuthBridgeOwner === 'opportunities-3.0'
  if (
    window.__tsSchedulingAuthBridgePending ||
    (window.__tsSchedulingAuthBridge && !legacyBridgeInstalled)
  ) {
    return
  }
  window.__tsSchedulingAuthBridgePending = true

  const TRADE_TOKEN_PATH = '/api:g1vmSLWh/auth/trade-token/v3'
  // Keep this exact. The stage adapter owns legacy-to-V3 routing; this bridge
  // only adds credentials to reviewed authenticated endpoints.
  const AUTHENTICATED_PATHS = [
    '/api:tCpV3oqd/booking/cancel/v3',
    '/api:tCpV3oqd/booking/live/cancel/v3',
    '/api:tCpV3oqd/booking/confirm/v3',
    '/api:tCpV3oqd/booking/decline/v3',
    '/api:tCpV3oqd/booking/reschedule/v3',
    '/api:tCpV3oqd/booking_record/archive/v3',
    '/api:tCpV3oqd/booking_record/get/v3',
    '/api:tCpV3oqd/booking_record/get_one/v3',
    '/api:tCpV3oqd/booking_record/payment_method_confirm/v3',
    '/api:tCpV3oqd/booking_record/update_paid_booking_price/v3',
    '/api:tCpV3oqd/booking_record/update_payment_status/v3',
    '/api:tCpV3oqd/booking_record/update_reschedule/v3',
    '/api:tCpV3oqd/brand/payment-method/setup/v3',
    '/api:tCpV3oqd/brand/payment-method/set-default/v3',
    '/api:tCpV3oqd/brands/customer/get/v3',
    '/api:tCpV3oqd/brands/update/customer_id/v3',
    '/api:tCpV3oqd/brands/update/payment_method/v3',
    '/api:tCpV3oqd/grants/add/v3',
    '/api:tCpV3oqd/grants/add_virtual/v3',
    '/api:tCpV3oqd/grants/create_virtual_account/v3',
    '/api:tCpV3oqd/grants/create_virtual_calendar/v3',
    '/api:tCpV3oqd/grants/delete/v3',
    '/api:tCpV3oqd/grants/oauth/v3',
    '/api:tCpV3oqd/notetaker/get_media/v3',
    '/api:tCpV3oqd/nylas_configurations/get_all/v3',
    '/api:tCpV3oqd/nylas_configurations/get_bookable/v3',
    '/api:tCpV3oqd/nylas_configurations/get_one/v3',
    '/api:tCpV3oqd/scheduler/configurations/create/v3',
    '/api:tCpV3oqd/scheduler/configurations/delete/v3',
    '/api:tCpV3oqd/scheduler/configurations/update/v3',
    '/api:tCpV3oqd/scheduler/get_availability/v3',
    '/api:tCpV3oqd/starter/clear_calendar_data/v3',
    '/api:tCpV3oqd/starter/get_booking_profile/v3',
    '/api:tCpV3oqd/starter/get_by_memberstack/v3',
    '/api:tCpV3oqd/starter/get_charges_enabled/v3',
    '/api:tCpV3oqd/starter/set_timezone/v3',
    '/api:tCpV3oqd/starter/update_availability/v3',
  ]
  // Temporary backwards compatibility for staging pages that already load
  // this shared auth module but do not yet load scheduling-v3-stage.js. The
  // stage adapter intercepts these paths first on the exact staging and
  // production surfaces documented in v3/README.md.
  const LEGACY_COMPATIBILITY_PATHS = [
    '/api:tCpV3oqd/calendars/get_availabilities',
    '/api:tCpV3oqd/scheduler/configurations/create',
    '/api:tCpV3oqd/scheduler/configurations/delete',
    '/api:tCpV3oqd/scheduler/configurations/get_all',
    '/api:tCpV3oqd/scheduler/configurations/update',
    '/api:tCpV3oqd/scheduler/configurations/update_v2',
    '/api:tCpV3oqd/starter/get_by_memberstack',
  ]

  function installBlockedRoute() {
    if (window.__tsSchedulingV3InertRoute) return
    const originalFetch = window.fetch.bind(window)
    window.fetch = async function (input, init) {
      const request = new Request(input, init)
      let url
      try {
        url = new URL(request.url, window.location.href)
      } catch (error) {
        return originalFetch(request)
      }
      if (url.origin !== XANO_ORIGIN || !url.pathname.startsWith(API_PREFIX)) {
        return originalFetch(request)
      }
      return new Response(
        JSON.stringify({
          code: 'SCHEDULING_V3_ROUTE_DISABLED',
          message: 'Scheduling is disabled on this profile.',
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      )
    }
    window.__tsSchedulingV3InertRoute = true
  }

  const originalFetch = legacyBridgeInstalled
    ? window.__tsSchedulingAuthOriginalFetch
    : window.fetch.bind(window)
  let xanoAuthToken = null
  let xanoAuthTokenMemberstackToken = null
  let tokenRequest = null
  let sessionGeneration = 0
  let tokenRevision = 0
  let wiredMemberstack = null

  function schedulingUrl(input) {
    let rawUrl
    if (typeof input === 'string') rawUrl = input
    else if (typeof URL !== 'undefined' && input instanceof URL) rawUrl = input.href
    else if (typeof Request !== 'undefined' && input instanceof Request) rawUrl = input.url
    else return null

    try {
      const url = new URL(rawUrl, window.location.href)
      if (url.origin !== XANO_ORIGIN) return null
      return (
        AUTHENTICATED_PATHS.indexOf(url.pathname) !== -1 ||
        LEGACY_COMPATIBILITY_PATHS.indexOf(url.pathname) !== -1
      )
        ? url
        : null
    } catch (error) {
      return null
    }
  }

  function memberSessionChangedError() {
    return Object.assign(new Error('Member session changed during request'), {
      code: 'MEMBER_SCOPE_CHANGED',
    })
  }

  function assertSessionGeneration(generation) {
    if (generation !== sessionGeneration) throw memberSessionChangedError()
  }

  function resetSession() {
    sessionGeneration += 1
    tokenRevision += 1
    xanoAuthToken = null
    xanoAuthTokenMemberstackToken = null
    tokenRequest = null
  }

  function wireAuthChanges() {
    const memberstack = window.$memberstackDom
    if (!memberstack || typeof memberstack.onAuthChange !== 'function') {
      window.setTimeout(wireAuthChanges, 100)
      return
    }
    if (memberstack === wiredMemberstack) return
    wiredMemberstack = memberstack
    memberstack.onAuthChange(resetSession)
  }

  async function getXanoAuthToken(options) {
    const forceRefresh = Boolean(options && options.forceRefresh)
    const memberstack = window.$memberstackDom
    if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
      throw new Error('Memberstack not available')
    }
    wireAuthChanges()

    let generation = sessionGeneration
    const memberstackToken = await memberstack.getMemberCookie()
    assertSessionGeneration(generation)
    if (!memberstackToken) throw new Error('No Memberstack session')

    if (
      xanoAuthTokenMemberstackToken &&
      xanoAuthTokenMemberstackToken !== memberstackToken
    ) {
      resetSession()
      generation = sessionGeneration
    }
    if (forceRefresh) {
      tokenRevision += 1
      xanoAuthToken = null
      xanoAuthTokenMemberstackToken = null
      tokenRequest = null
    }
    if (xanoAuthToken && xanoAuthTokenMemberstackToken === memberstackToken) {
      return xanoAuthToken
    }

    const revision = tokenRevision
    if (
      tokenRequest &&
      tokenRequest.generation === generation &&
      tokenRequest.revision === revision &&
      tokenRequest.memberstackToken === memberstackToken
    ) {
      return tokenRequest.promise
    }

    const promise = (async function () {
      const response = await originalFetch(
        XANO_ORIGIN + TRADE_TOKEN_PATH + '?token=' + encodeURIComponent(memberstackToken),
      )
      const data = await response.json().catch(function () {
        return null
      })
      assertSessionGeneration(generation)
      if (revision !== tokenRevision) throw memberSessionChangedError()
      if (!response.ok) throw new Error('Xano token trade failed')

      const latestMemberstackToken = await memberstack.getMemberCookie()
      assertSessionGeneration(generation)
      if (latestMemberstackToken !== memberstackToken) {
        resetSession()
        throw memberSessionChangedError()
      }

      const token = typeof data === 'string' ? data : data && (data.authToken || data.token)
      if (!token) throw new Error('Xano token trade returned no token')
      xanoAuthToken = token
      xanoAuthTokenMemberstackToken = memberstackToken
      return token
    })()

    tokenRequest = { generation, revision, memberstackToken, promise }
    try {
      return await promise
    } finally {
      if (tokenRequest && tokenRequest.promise === promise) tokenRequest = null
    }
  }

  function withAuthorization(request, token) {
    const headers = new Headers(request.headers)
    headers.set('Authorization', 'Bearer ' + token)
    return new Request(request.clone(), { headers: headers })
  }

  async function fetchWithToken(request, token, generation) {
    let response = await originalFetch(withAuthorization(request, token))
    assertSessionGeneration(generation)
    if (response.status !== 401) return response

    try {
      token = await getXanoAuthToken({ forceRefresh: true })
    } catch (error) {
      assertSessionGeneration(generation)
      return response
    }
    assertSessionGeneration(generation)
    response = await originalFetch(withAuthorization(request, token))
    assertSessionGeneration(generation)
    return response
  }

  async function xanoAuthFetch(input, init) {
    const request = new Request(input, init)
    if (!schedulingUrl(request) || request.headers.has('Authorization')) {
      return originalFetch(request)
    }

    const generation = sessionGeneration
    const token = await getXanoAuthToken()
    assertSessionGeneration(generation)
    return fetchWithToken(request, token, generation)
  }

  async function authenticatedFetch(input, init) {
    const request = new Request(input, init)
    if (!schedulingUrl(request) || request.headers.has('Authorization')) {
      return originalFetch(request)
    }

    const generation = sessionGeneration
    let token
    try {
      token = await getXanoAuthToken()
    } catch (error) {
      if (error && error.code === 'MEMBER_SCOPE_CHANGED') throw error
      // Preserve the response behavior of legacy inline code while making the
      // auth failure visible in the console. Direct xanoAuthFetch callers get
      // the thrown error and can show a login/retry state.
      console.warn('[scheduling-auth] token unavailable:', error && error.message)
      return originalFetch(request.clone())
    }
    assertSessionGeneration(generation)
    return fetchWithToken(request, token, generation)
  }

  function installBridge() {
    window.getXanoAuthToken = getXanoAuthToken
    window.xanoAuthFetch = xanoAuthFetch
    window.fetch = authenticatedFetch
    window.__tsSchedulingAuthBridge = true
    window.__tsSchedulingAuthBridgeOwner = 'scheduling-auth'
    window.__tsSchedulingAuthBridgePending = false
    wireAuthChanges()
    console.info('[scheduling-auth] installed on V3 Webflow staging')
  }

  installBridge()
})()
