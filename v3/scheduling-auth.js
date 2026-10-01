;(function () {
  'use strict'

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const PRODUCTION_PATHS = new Set([
    '/starter-dashboard',
    '/brand-dashboard',
    '/messages',
    '/starter-edit-profile',
  ])
  // The retained V2 site shares the live TalkJS app. Its Messages page needs
  // this bridge only so the shared TalkJS session owner can obtain a signed
  // user token (F05). No other V2 path installs it.
  const V2_PRODUCTION_HOSTS = new Set(['hirethestarters.com', 'www.hirethestarters.com'])
  const V2_PRODUCTION_PATHS = new Set(['/messages'])
  const BLOCKED_PRODUCTION_PATHS = new Set(['/hire/jp-dionisio'])
  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const API_PREFIX = '/api:tCpV3oqd/'
  const activePath = window.location.pathname.replace(/\/+$/, '') || '/'
  const isHirePath = /^\/hire\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(activePath)
  const isStagingHost = window.location.hostname === STAGING_HOST
  const isBlockedProductionPath =
    PRODUCTION_HOSTS.has(window.location.hostname) &&
    BLOCKED_PRODUCTION_PATHS.has(activePath)
  const isApprovedProductionPath =
    PRODUCTION_HOSTS.has(window.location.hostname) &&
    (PRODUCTION_PATHS.has(activePath) || isHirePath)
  if (isBlockedProductionPath) {
    installBlockedRoute()
    return
  }
  const isApprovedV2Path =
    V2_PRODUCTION_HOSTS.has(window.location.hostname) &&
    V2_PRODUCTION_PATHS.has(activePath)
  if (!isStagingHost && !isApprovedProductionPath && !isApprovedV2Path) return
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
  // Callers with the same Memberstack token share one in-flight trade, so a
  // trade that never settled blocked every later token request (and each F68
  // dashboard retry) until a reload. This deadline covers the trade POST and
  // its body read. Request history on 2026-10-01 (101 trades) had a 567 ms
  // median, a 6.3 s p90 and a 17.8 s maximum, so 30 s keeps slow trades that
  // succeed, and the second F68 retry still starts a new trade.
  const TOKEN_TRADE_TIMEOUT_MS = 30000
  // Keep this exact. The stage adapter owns legacy-to-V3 routing; this bridge
  // only adds credentials to reviewed authenticated endpoints.
  const AUTHENTICATED_PATHS = [
    '/api:tCpV3oqd/booking/cancel/v3',
    '/api:tCpV3oqd/booking/live/cancel/v3',
    '/api:tCpV3oqd/booking/confirm/v3',
    '/api:tCpV3oqd/booking/decline/v3',
    '/api:tCpV3oqd/booking/reschedule/v3',
    '/api:tCpV3oqd/booking/reschedule/propose/v3',
    '/api:tCpV3oqd/booking/reschedule/request/v3',
    '/api:tCpV3oqd/booking/reschedule/confirm/v3',
    '/api:tCpV3oqd/booking/reschedule/decline/v3',
    '/api:tCpV3oqd/booking_record/archive/v3',
    '/api:tCpV3oqd/booking_record/get/v3',
    '/api:tCpV3oqd/booking_record/get_one/v3',
    '/api:tCpV3oqd/booking_record/payment_method_confirm/v3',
    '/api:tCpV3oqd/booking_record/update_paid_booking_price/v3',
    '/api:tCpV3oqd/booking_record/update_payment_status/v3',
    '/api:tCpV3oqd/booking_record/update_reschedule/v3',
    '/api:tCpV3oqd/brand/booking/payment-action/v3',
    '/api:tCpV3oqd/brand/booking/payment-method-replace/v3',
    '/api:tCpV3oqd/brand/payment-method/setup/v3',
    '/api:tCpV3oqd/brand/payment-method/set-default/v3',
    '/api:tCpV3oqd/brand/payment-methods/v3',
    '/api:tCpV3oqd/brand/payment-readiness/v3',
    '/api:tCpV3oqd/brand/booking/request/v3',
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
    '/api:tCpV3oqd/starter/get_stripe_connect_id/v3',
    '/api:tCpV3oqd/starter/free-call-settings/disable/v3',
    '/api:tCpV3oqd/starter/free-call-settings/get/v3',
    '/api:tCpV3oqd/starter/free-call-settings/upsert/v3',
    '/api:tCpV3oqd/starter/paid-call-settings/disable/v3',
    '/api:tCpV3oqd/starter/paid-call-settings/get/v3',
    '/api:tCpV3oqd/starter/paid-call-settings/upsert/v3',
    '/api:tCpV3oqd/starter/set_timezone/v3',
    '/api:tCpV3oqd/starter/update_availability/v3',
  ]
  // Pure reads that several dashboard scripts request independently. A
  // repeat within READ_DEDUPE_TTL_MS shares one network response (same member
  // session, method, URL and body). Any other authenticated request clears
  // the shared entries first, so a read that follows a write is always fresh.
  const READ_DEDUPE_TTL_MS = 5000
  const READ_DEDUPE_PATHS = [
    '/api:tCpV3oqd/nylas_configurations/get_all/v3',
    '/api:tCpV3oqd/nylas_configurations/get_bookable/v3',
    '/api:tCpV3oqd/starter/get_booking_profile/v3',
    '/api:tCpV3oqd/starter/get_by_memberstack/v3',
    '/api:tCpV3oqd/starter/free-call-settings/get/v3',
    '/api:tCpV3oqd/starter/paid-call-settings/get/v3',
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
  const tokenStartListeners = new Set()
  const sharedReads = new Map()
  let sharedReadsRevision = 0
  const sharedMemberstackReads = new Map()
  let memberstackReadOwner = 0
  let memberstackReadRevision = 0
  let sessionGeneration = 0
  let tokenRevision = 0
  let sessionScope = {}
  let authReconciliation = Promise.resolve()
  let wiredMemberstack = null
  let observedMemberstackToken = null
  let hasObservedMemberstackToken = false

  function xanoUrl(input) {
    let rawUrl
    if (typeof input === 'string') rawUrl = input
    else if (typeof URL !== 'undefined' && input instanceof URL) rawUrl = input.href
    else if (typeof Request !== 'undefined' && input instanceof Request) rawUrl = input.url
    else return null

    try {
      const url = new URL(rawUrl, window.location.href)
      if (url.origin !== XANO_ORIGIN) return null
      return url
    } catch (error) {
      return null
    }
  }

  function schedulingUrl(input) {
    const url = xanoUrl(input)
    if (!url) return null
    return (
      AUTHENTICATED_PATHS.indexOf(url.pathname) !== -1 ||
      LEGACY_COMPATIBILITY_PATHS.indexOf(url.pathname) !== -1
    )
      ? url
      : null
  }

  function memberSessionChangedError() {
    return Object.assign(new Error('Member session changed during request'), {
      code: 'MEMBER_SCOPE_CHANGED',
    })
  }

  function tokenTradeTimeoutError() {
    return Object.assign(new Error('Xano token trade timed out'), {
      code: 'XANO_TOKEN_TRADE_TIMEOUT',
    })
  }

  function assertSessionGeneration(generation) {
    if (generation !== sessionGeneration) throw memberSessionChangedError()
  }

  function assertExpectedScope(expectedScope) {
    if (expectedScope && expectedScope !== sessionScope) throw memberSessionChangedError()
  }

  function invalidateMemberstackReads() {
    memberstackReadRevision += 1
    sharedMemberstackReads.clear()
  }

  function clearSharedReads() {
    sharedReadsRevision += 1
    sharedReads.clear()
  }

  function resetSession() {
    sessionGeneration += 1
    tokenRevision += 1
    sessionScope = {}
    xanoAuthToken = null
    xanoAuthTokenMemberstackToken = null
    tokenRequest = null
    tokenStartListeners.forEach(function (listener) {
      listener(null)
    })
    clearSharedReads()
    invalidateMemberstackReads()
  }

  function pruneExpiredSharedReads() {
    const now = Date.now()
    sharedReads.forEach(function (shared, key) {
      if (shared.expiresAt !== null && shared.expiresAt <= now) sharedReads.delete(key)
    })
  }

  function observeMemberstackToken(memberstackToken) {
    if (!hasObservedMemberstackToken) {
      hasObservedMemberstackToken = true
      observedMemberstackToken = memberstackToken
      return
    }
    if (observedMemberstackToken === memberstackToken) return
    observedMemberstackToken = memberstackToken
    resetSession()
  }

  async function awaitLatestAuthReconciliation() {
    let pending
    do {
      pending = authReconciliation
      await pending
    } while (pending !== authReconciliation)
  }

  function reconcileAuthChange() {
    invalidateMemberstackReads()
    const memberstack = window.$memberstackDom
    authReconciliation = authReconciliation.catch(function () {}).then(async function () {
      let memberstackToken = null
      try {
        memberstackToken = await memberstack.getMemberCookie()
      } catch (error) {
        memberstackToken = null
      }
      observeMemberstackToken(memberstackToken)
    })
    return authReconciliation
  }

  function wireAuthChanges() {
    const memberstack = window.$memberstackDom
    if (!memberstack || typeof memberstack.onAuthChange !== 'function') {
      window.setTimeout(wireAuthChanges, 100)
      return
    }
    if (memberstack === wiredMemberstack) return
    wiredMemberstack = memberstack
    shareMemberstackReads(memberstack)
    memberstack.onAuthChange(reconcileAuthChange)
  }

  // Dashboard scripts each call getCurrentMember(), and every call is a
  // separate, queued network request (about 30 per page load). Calls made
  // while an identical one is still in flight share its result. Nothing is
  // kept after it settles, and any Memberstack write or auth change drops the
  // in-flight entries so a read after a write is never stale.
  function shareMemberstackReads(memberstack) {
    if (typeof memberstack.getCurrentMember !== 'function' || memberstack.__tsSharedReads) return
    const readOwner = ++memberstackReadOwner
    const original = memberstack.getCurrentMember.bind(memberstack)
    const NON_INVALIDATING_METHODS = ['getCurrentMember', 'getMemberCookie', 'onAuthChange']
    memberstack.__tsSharedReads = true
    memberstack.getCurrentMember = async function () {
      pruneExpiredSharedReads()
      const startingGeneration = sessionGeneration
      const startingReadRevision = memberstackReadRevision
      const args = Array.prototype.slice.call(arguments)
      const memberstackToken = await memberstack.getMemberCookie()
      observeMemberstackToken(memberstackToken)
      const generation = sessionGeneration
      const readRevision =
        generation === startingGeneration ? startingReadRevision : memberstackReadRevision
      const read = async function () {
        const result = await original.apply(null, args)
        let latestMemberstackToken
        try {
          latestMemberstackToken = await memberstack.getMemberCookie()
        } catch (error) {
          invalidateMemberstackReads()
          throw error
        }
        observeMemberstackToken(latestMemberstackToken)
        if (
          latestMemberstackToken !== memberstackToken ||
          generation !== sessionGeneration
        ) {
          invalidateMemberstackReads()
          throw memberSessionChangedError()
        }
        return result
      }
      let key
      try {
        key = JSON.stringify([
          readOwner,
          readRevision,
          generation,
          memberstackToken,
          args,
        ])
      } catch (error) {
        return read()
      }
      const shared = sharedMemberstackReads.get(key)
      if (shared) return shared
      const promise = read()
      sharedMemberstackReads.set(key, promise)
      const release = function () {
        if (sharedMemberstackReads.get(key) === promise) sharedMemberstackReads.delete(key)
      }
      promise.then(release, release)
      return promise
    }
    Object.keys(memberstack).forEach(function (name) {
      const method = memberstack[name]
      if (typeof method !== 'function' || NON_INVALIDATING_METHODS.indexOf(name) !== -1) return
      memberstack[name] = function () {
        invalidateMemberstackReads()
        let result
        try {
          result = method.apply(this, arguments)
        } catch (error) {
          invalidateMemberstackReads()
          throw error
        }
        if (result && typeof result.then === 'function') {
          return Promise.resolve(result).then(
            function (value) {
              invalidateMemberstackReads()
              return value
            },
            function (error) {
              invalidateMemberstackReads()
              throw error
            },
          )
        }
        invalidateMemberstackReads()
        return result
      }
    })
  }

  async function getXanoAuthToken(options) {
    await awaitLatestAuthReconciliation()
    const forceRefresh = Boolean(options && options.forceRefresh)
    const memberstack = window.$memberstackDom
    if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
      throw new Error('Memberstack not available')
    }
    wireAuthChanges()

    const memberstackToken = await memberstack.getMemberCookie()
    observeMemberstackToken(memberstackToken)
    if (!memberstackToken) throw new Error('No Memberstack session')
    const generation = sessionGeneration
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
      const tradeUrl =
        XANO_ORIGIN + TRADE_TOKEN_PATH + '?token=' + encodeURIComponent(memberstackToken)
      const canTimeTrade =
        typeof window.setTimeout === 'function' && typeof window.clearTimeout === 'function'
      const controller =
        canTimeTrade && typeof window.AbortController === 'function'
          ? new window.AbortController()
          : null
      let timer
      let timedOut = false
      // At the deadline the trade is aborted and every caller gets the timeout
      // error. A native fetch rejects with AbortError inside abort(), so the
      // catch below replaces that error. The owner call then releases
      // tokenRequest, so the next caller starts a new trade. A late response is
      // discarded.
      const deadline = canTimeTrade
        ? new Promise(function (resolve, reject) {
            timer = window.setTimeout(function () {
              timedOut = true
              reject(tokenTradeTimeoutError())
              if (controller) {
                try {
                  controller.abort()
                } catch (error) {}
              }
            }, TOKEN_TRADE_TIMEOUT_MS)
          })
        : null
      let response
      let data
      try {
        const request = controller
          ? originalFetch(tradeUrl, { signal: controller.signal })
          : originalFetch(tradeUrl)
        response = deadline ? await Promise.race([request, deadline]) : await request
        const readBody = response.json().catch(function () {
          return null
        })
        data = deadline ? await Promise.race([readBody, deadline]) : await readBody
      } catch (error) {
        if (timedOut) throw tokenTradeTimeoutError()
        throw error
      } finally {
        if (canTimeTrade) window.clearTimeout(timer)
      }
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
    tokenStartListeners.forEach(function (listener) {
      listener(tokenRequest)
    })
    try {
      return await promise
    } finally {
      if (tokenRequest && tokenRequest.promise === promise) tokenRequest = null
    }
  }

  // The deferred wf-xano library can reuse this dashboard token only when a
  // scheduling caller already has it or starts the trade within 200 ms. This
  // method never starts a trade; wf-xano retains its own fallback when null.
  async function reuseDashboardToken(memberstackToken) {
    if (typeof memberstackToken !== 'string' || !memberstackToken) return null
    try {
      await awaitLatestAuthReconciliation()
      const memberstack = window.$memberstackDom
      if (!memberstack || typeof memberstack.getMemberCookie !== 'function') return null
      const currentMemberstackToken = await memberstack.getMemberCookie()
      observeMemberstackToken(currentMemberstackToken)
      if (currentMemberstackToken !== memberstackToken) return null
      const generation = sessionGeneration
      const revision = tokenRevision
      let token = xanoAuthTokenMemberstackToken === memberstackToken ? xanoAuthToken : null
      if (!token) {
        const matches = function (request) {
          return request && request.generation === generation &&
            request.revision === revision &&
            request.memberstackToken === memberstackToken
        }
        let request = matches(tokenRequest) ? tokenRequest : null
        if (!request) {
          request = await new Promise(function (resolve) {
            let timer
            const settle = function (value) {
              tokenStartListeners.delete(onStart)
              window.clearTimeout(timer)
              resolve(value)
            }
            const onStart = function (started) {
              if (!started || matches(started)) settle(started)
            }
            tokenStartListeners.add(onStart)
            timer = window.setTimeout(function () {
              settle(null)
            }, 200)
          })
        }
        if (!request) return null
        try {
          token = await new Promise(function (resolve) {
            let timer
            const settle = function (value) {
              window.clearTimeout(timer)
              resolve(value)
            }
            timer = window.setTimeout(function () {
              resolve(null)
            }, 5000)
            request.promise.then(settle, function () {
              settle(null)
            })
          })
        } catch (error) {
          return null
        }
        if (!token) return null
      }
      await awaitLatestAuthReconciliation()
      const latestMemberstackToken = await memberstack.getMemberCookie()
      observeMemberstackToken(latestMemberstackToken)
      if (
        latestMemberstackToken !== memberstackToken ||
        generation !== sessionGeneration ||
        revision !== tokenRevision ||
        xanoAuthToken !== token ||
        xanoAuthTokenMemberstackToken !== memberstackToken
      ) return null
      return token
    } catch (error) {
      return null
    }
  }

  async function getAuthScope() {
    await awaitLatestAuthReconciliation()
    await getXanoAuthToken()
    return sessionScope
  }

  function withAuthorization(request, token) {
    const headers = new Headers(request.headers)
    headers.set('Authorization', 'Bearer ' + token)
    return new Request(request.clone(), { headers: headers })
  }

  async function passThroughFetch(request) {
    const invalidatesSharedReads =
      request.headers.has('Authorization') && Boolean(xanoUrl(request))
    if (invalidatesSharedReads) clearSharedReads()
    try {
      return await originalFetch(request)
    } finally {
      if (invalidatesSharedReads) clearSharedReads()
    }
  }

  async function fetchWithToken(request, token, generation, expectedScope) {
    await awaitLatestAuthReconciliation()
    assertSessionGeneration(generation)
    assertExpectedScope(expectedScope)
    let response = await originalFetch(withAuthorization(request, token))
    await awaitLatestAuthReconciliation()
    assertSessionGeneration(generation)
    if (response.status !== 401) return response

    try {
      token = await getXanoAuthToken({ forceRefresh: true })
    } catch (error) {
      await awaitLatestAuthReconciliation()
      assertSessionGeneration(generation)
      return response
    }
    await awaitLatestAuthReconciliation()
    assertSessionGeneration(generation)
    assertExpectedScope(expectedScope)
    response = await originalFetch(withAuthorization(request, token))
    await awaitLatestAuthReconciliation()
    assertSessionGeneration(generation)
    return response
  }

  async function sharedReadKey(request, url, generation) {
    if (READ_DEDUPE_PATHS.indexOf(url.pathname) === -1) return null
    if (request.method !== 'GET' && request.method !== 'POST') return null
    const body = request.method === 'POST' ? await request.clone().text() : ''
    return [generation, request.method, url.pathname + url.search, body].join('\n')
  }

  function hasExplicitAbortSignal(init, signalHint) {
    return signalHint === true || Boolean(init && init.signal != null)
  }

  async function xanoAuthFetch(input, init, expectedScope, signalHint) {
    const bypassSharedRead = hasExplicitAbortSignal(init, signalHint)
    const request = new Request(input, init)
    const url = schedulingUrl(request)
    if (!url || request.headers.has('Authorization')) {
      return passThroughFetch(request)
    }

    await awaitLatestAuthReconciliation()
    if (READ_DEDUPE_PATHS.indexOf(url.pathname) !== -1) {
      // A shared hit skips the token path, so still notice a rotated cookie.
      const memberstack = window.$memberstackDom
      if (memberstack && typeof memberstack.getMemberCookie === 'function') {
        observeMemberstackToken(await memberstack.getMemberCookie())
        await awaitLatestAuthReconciliation()
      }
    }
    const generation = sessionGeneration
    const key = await sharedReadKey(request, url, generation)
    if (key) assertExpectedScope(expectedScope)
    if (key && bypassSharedRead) {
      const revision = sharedReadsRevision
      try {
        const token = await getXanoAuthToken()
        assertSessionGeneration(generation)
        const response = await fetchWithToken(request, token, generation, expectedScope)
        if (!response.ok && revision === sharedReadsRevision) clearSharedReads()
        return response
      } catch (error) {
        if (!request.signal.aborted && revision === sharedReadsRevision) clearSharedReads()
        throw error
      }
    }
    if (!key) {
      clearSharedReads()
      const token = await getXanoAuthToken()
      assertSessionGeneration(generation)
      try {
        return await fetchWithToken(request, token, generation, expectedScope)
      } finally {
        clearSharedReads()
      }
    }

    pruneExpiredSharedReads()
    let shared = sharedReads.get(key)
    if (!shared) {
      const promise = (async function () {
        const token = await getXanoAuthToken()
        assertSessionGeneration(generation)
        return fetchWithToken(request, token, generation)
      })()
      shared = { promise, expiresAt: null }
      sharedReads.set(key, shared)
      promise.then(
        function (response) {
          if (sharedReads.get(key) !== shared) return
          if (!response.ok) {
            clearSharedReads()
            return
          }
          shared.expiresAt = Date.now() + READ_DEDUPE_TTL_MS
        },
        function () {
          if (sharedReads.get(key) === shared) clearSharedReads()
        },
      )
    }
    const response = await shared.promise
    await awaitLatestAuthReconciliation()
    assertSessionGeneration(generation)
    assertExpectedScope(expectedScope)
    return response.clone()
  }

  async function authenticatedFetch(input, init) {
    const request = new Request(input, init)
    const url = schedulingUrl(request)
    if (!url || request.headers.has('Authorization')) {
      return passThroughFetch(request)
    }

    clearSharedReads()
    try {
      await awaitLatestAuthReconciliation()
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
        return await originalFetch(request.clone())
      }
      assertSessionGeneration(generation)
      return await fetchWithToken(request, token, generation)
    } finally {
      clearSharedReads()
    }
  }

  function installBridge() {
    window.getXanoAuthToken = getXanoAuthToken
    window.__tsSchedulingAuthGetScope = getAuthScope
    // Keep an owner-specific reference for the routing adapter and call-settings
    // controllers. Other page bundles still expose compatibility bridges on
    // window.xanoAuthFetch and can replace that mutable global after install.
    window.__tsSchedulingAuthFetch = xanoAuthFetch
    if (
      activePath === '/starter-dashboard' &&
      (isStagingHost || PRODUCTION_HOSTS.has(window.location.hostname))
    ) {
      window.__tsSchedulingAuthTokenReuse = {
        owner: 'scheduling-auth',
        authBase: XANO_ORIGIN + '/api:g1vmSLWh',
        tradePath: '/auth/trade-token/v3',
        getToken: reuseDashboardToken,
      }
    }
    window.xanoAuthFetch = xanoAuthFetch
    window.fetch = authenticatedFetch
    window.__tsSchedulingAuthBridge = true
    window.__tsSchedulingAuthBridgeOwner = 'scheduling-auth'
    window.__tsSchedulingAuthBridgePending = false
    wireAuthChanges()
    if (isStagingHost) console.info('[scheduling-auth] installed on V3 Webflow staging')
  }

  installBridge()
})()
