;(function () {
  'use strict'

  // V3 is not launched on the custom domains yet. Do not expand this guard
  // without explicit launch approval.
  if (window.location.hostname !== 'the-starters-3-0.webflow.io') return
  const legacyBridgeInstalled =
    window.__tsSchedulingAuthBridgeOwner === 'opportunities-3.0'
  if (
    window.__tsSchedulingAuthBridgePending ||
    (window.__tsSchedulingAuthBridge && !legacyBridgeInstalled)
  ) {
    return
  }
  window.__tsSchedulingAuthBridgePending = true

  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const TRADE_TOKEN_PATH = '/api:g1vmSLWh/auth/trade-token/v3'
  const AUTHENTICATED_PATHS = [
    { path: '/api:tCpV3oqd/scheduler/configurations/', prefix: true },
    { path: '/api:tCpV3oqd/calendars/get_availabilities', prefix: true },
    { path: '/api:tCpV3oqd/starter/get_by_memberstack', prefix: false },
    // Availability-writer endpoints (v3/scheduling-availability-writer.js).
    // Keep this an explicit endpoint list — not an /api:tCpV3oqd/ prefix.
    { path: '/api:tCpV3oqd/starter/update_availability/v3', prefix: false },
    { path: '/api:tCpV3oqd/starter/set_timezone', prefix: false },
    { path: '/api:tCpV3oqd/starter/clear_calendar_data', prefix: false },
    { path: '/api:tCpV3oqd/grants/oauth/v3', prefix: false },
    { path: '/api:tCpV3oqd/grants/create_virtual_account', prefix: false },
    { path: '/api:tCpV3oqd/grants/create_virtual_calendar', prefix: false },
    { path: '/api:tCpV3oqd/grants/add_virtual/v3', prefix: false },
    // grants/add/v3 is called by the availability writer when the OAuth
    // return (?code&state) lands back on the Booking-stage page; it exchanges
    // the code and persists the grant server-side in one call.
    { path: '/api:tCpV3oqd/grants/add/v3', prefix: false },
    { path: '/api:tCpV3oqd/grants/delete', prefix: false },
    { path: '/api:tCpV3oqd/nylas_configurations/get_all', prefix: false },
    // Stripe Connect links for the profile owner (v3/stripe-connect.js). The
    // server resolves the starter from $auth; the client sends no ids.
    { path: '/api:tCpV3oqd/stripe/connect_links', prefix: false },
  ]

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
      return AUTHENTICATED_PATHS.some(function (authenticatedPath) {
        return authenticatedPath.prefix
          ? url.pathname.startsWith(authenticatedPath.path)
          : url.pathname === authenticatedPath.path
      })
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
