;(function () {
  'use strict'

  // V3 is not launched on the custom domains yet. Do not expand this guard
  // without explicit launch approval.
  if (window.location.hostname !== 'the-starters-3-0.webflow.io') return
  if (window.__tsSchedulingAuthBridge || window.__tsSchedulingAuthBridgePending) return
  window.__tsSchedulingAuthBridgePending = true

  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const TRADE_TOKEN_PATH = '/api:g1vmSLWh/auth/trade-token/v3'
  const AUTHENTICATED_PATHS = [
    '/api:tCpV3oqd/scheduler/configurations/',
    '/api:tCpV3oqd/calendars/get_availabilities',
  ]

  let originalFetch = window.fetch.bind(window)
  let xanoAuthToken = null

  function schedulingUrl(input) {
    let rawUrl
    if (typeof input === 'string') rawUrl = input
    else if (typeof URL !== 'undefined' && input instanceof URL) rawUrl = input.href
    else if (typeof Request !== 'undefined' && input instanceof Request) rawUrl = input.url
    else return null

    try {
      const url = new URL(rawUrl, window.location.href)
      if (url.origin !== XANO_ORIGIN) return null
      return AUTHENTICATED_PATHS.some(function (path) {
        return url.pathname.startsWith(path)
      })
        ? url
        : null
    } catch (error) {
      return null
    }
  }

  async function getXanoAuthToken(options) {
    const forceRefresh = Boolean(options && options.forceRefresh)
    if (forceRefresh) xanoAuthToken = null
    if (xanoAuthToken) return xanoAuthToken

    const memberstack = window.$memberstackDom
    if (!memberstack) throw new Error('Memberstack not available')

    const memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw new Error('No Memberstack session')

    const response = await originalFetch(
      XANO_ORIGIN + TRADE_TOKEN_PATH + '?token=' + encodeURIComponent(memberstackToken),
    )
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) throw new Error('Xano token trade failed')

    xanoAuthToken =
      typeof data === 'string' ? data : data && (data.authToken || data.token)
    if (!xanoAuthToken) throw new Error('Xano token trade returned no token')
    return xanoAuthToken
  }

  function withAuthorization(input, init, token) {
    const request = new Request(input, init)
    if (request.headers.has('Authorization')) return request

    const headers = new Headers(request.headers)
    headers.set('Authorization', 'Bearer ' + token)
    return new Request(request.clone(), { headers: headers })
  }

  async function xanoAuthFetch(input, init) {
    if (!schedulingUrl(input)) return originalFetch(input, init)

    let token = await getXanoAuthToken()
    let response = await originalFetch(withAuthorization(input, init, token))
    if (response.status !== 401) return response

    token = await getXanoAuthToken({ forceRefresh: true })
    return originalFetch(withAuthorization(input, init, token))
  }

  async function authenticatedFetch(input, init) {
    if (!schedulingUrl(input)) return originalFetch(input, init)

    try {
      return await xanoAuthFetch(input, init)
    } catch (error) {
      // Preserve the response behavior of legacy inline code while making the
      // auth failure visible in the console. Direct xanoAuthFetch callers get
      // the thrown error and can show a login/retry state.
      console.warn('[scheduling-auth] token unavailable:', error && error.message)
      return originalFetch(input, init)
    }
  }

  function installBridge() {
    if (window.__tsSchedulingAuthBridge) return
    if (!window.$memberstackDom) {
      window.setTimeout(installBridge, 100)
      return
    }

    window.getXanoAuthToken = getXanoAuthToken
    window.xanoAuthFetch = xanoAuthFetch
    window.fetch = authenticatedFetch
    window.__tsSchedulingAuthBridge = true
    window.__tsSchedulingAuthBridgePending = false
    console.info('[scheduling-auth] installed on V3 Webflow staging')
  }

  function scheduleInstall() {
    // Let Memberstack and the dashboard's initial reads finish first. The
    // configuration calls are user-driven after the page is interactive.
    window.setTimeout(installBridge, 2000)
  }

  if (document.readyState === 'complete') scheduleInstall()
  else window.addEventListener('load', scheduleInstall, { once: true })
})()
