/**
 * Starter Dashboard 3.0 — Stripe Connect status and callback controller.
 *
 * Xano reads Stripe-authoritative state from freelancers_v3. Webflow owns all
 * markup, copy, links, and styling; this module only selects authored states,
 * handles the Connect redirect, and exchanges an OAuth code for the active
 * Memberstack member. Every Xano call is Bearer-authenticated: the active
 * Memberstack session is traded for a Xano token and the server derives the
 * member identity from that token, so no client-supplied member id is trusted.
 *
 * Designer wiring:
 *   data-stripe-connect-element="root|loading|disconnected|incomplete|
 *   ready|review|error"
 *   data-stripe-connect-action="start|refresh|earnings"
 *   data-stripe-connect-earnings-state="disconnected|ready"
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  if (!isCommonJs) {
    if (global.__startersStripeConnectBooted) return
    global.__startersStripeConnectBooted = true
  }

  const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  const XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  const TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  const STATUS_PATH = '/stripe_connect/status/v3'
  const START_PATH = '/stripe_connect/start/v3'
  const EXCHANGE_PATH = '/stripe_connect/oauth_exchange/v3'
  const SANDBOX_START_PATH = '/stripe_connect/sandbox/start/v3'
  const SANDBOX_EXCHANGE_PATH = '/stripe_connect/sandbox/oauth_exchange/v3'
  const SANDBOX_STATE_PREFIX = 'sandbox:'
  const SANDBOX_HOST = 'the-starters-3-0.webflow.io'
  const STRIPE_DASHBOARD_URL = 'https://dashboard.stripe.com/'
  const DASHBOARD_PATH = '/starter-dashboard'
  const CALLBACK_PATH = '/stripe-connect-callback'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  const RETURN_POLL_DELAYS_MS = [0, 750, 1500, 3000, 5000]
  const ELEMENT_ATTR = 'data-stripe-connect-element'
  const ACTION_ATTR = 'data-stripe-connect-action'
  const EARNINGS_STATE_ATTR = 'data-stripe-connect-earnings-state'
  const PENDING_TABINDEX_ATTR = 'data-stripe-connect-pending-tabindex'
  const STATES = [
    'loading',
    'disconnected',
    'incomplete',
    'ready',
    'review',
    'error',
  ]
  const elementSelector = (name) =>
    '[' + ELEMENT_ATTR + '="' + name + '"]'
  const actionSelector = (name) => '[' + ACTION_ATTR + '="' + name + '"]'

  function show(element, visible) {
    if (!element) return
    element.hidden = !visible
    element.style.display = visible ? '' : 'none'
  }

  function setView(root, view) {
    STATES.forEach(function (state) {
      show(root.querySelector(elementSelector(state)), state === view)
    })
    root.setAttribute('data-stripe-connect-status', view)
    root.setAttribute('data-stripe-connect-view', view)
  }

  function renderRoots(roots, view) {
    roots.forEach(function (root) {
      setView(root, view)
    })
  }

  function resolveDashboardView(status, returnedFromStripe) {
    if (!status || typeof status !== 'object') return 'error'
    if (status.charges_enabled === true) return 'ready'
    if (returnedFromStripe) return 'review'
    if (status.connected === true) return 'incomplete'
    return 'disconnected'
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      global.setTimeout(resolve, ms)
    })
  }

  async function waitForMemberstackDom(timeoutMs = MEMBERSTACK_TIMEOUT_MS) {
    if (
      global.$memberstackDom &&
      typeof global.$memberstackDom.getCurrentMember === 'function'
    ) {
      return global.$memberstackDom
    }

    return new Promise(function (resolve) {
      const startedAt = Date.now()
      const timer = global.setInterval(function () {
        if (
          global.$memberstackDom &&
          typeof global.$memberstackDom.getCurrentMember === 'function'
        ) {
          global.clearInterval(timer)
          resolve(global.$memberstackDom)
          return
        }
        if (Date.now() - startedAt >= timeoutMs) {
          global.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  async function currentMemberId() {
    if (
      global.$memberstackDom &&
      typeof global.$memberstackDom.getCurrentMember === 'function'
    ) {
      const result = await global.$memberstackDom.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member.id
    }

    if (global.memberReady && typeof global.memberReady.then === 'function') {
      const member = await global.memberReady
      if (member && member.id) return member.id
    }

    const memberstack = await waitForMemberstackDom()
    if (memberstack) {
      const result = await memberstack.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member.id
    }

    throw new Error('No logged-in Memberstack member')
  }

  let xanoTokenPromise = null

  async function tradeForXanoToken() {
    let memberstack = global.$memberstackDom
    if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
      memberstack = await waitForMemberstackDom()
    }
    if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
      throw new Error('No logged-in Memberstack member')
    }
    const memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw new Error('No logged-in Memberstack member')

    const response = await global.fetch(
      XANO_AUTH_BASE +
        TRADE_TOKEN_PATH +
        '?token=' +
        encodeURIComponent(memberstackToken),
    )
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) throw new Error('Xano token trade failed')
    const token =
      typeof data === 'string'
        ? data
        : data && (data.authToken || data.token)
    if (!token) throw new Error('Xano token trade returned no token')
    return token
  }

  function xanoToken() {
    if (!xanoTokenPromise) {
      xanoTokenPromise = tradeForXanoToken().catch(function (error) {
        xanoTokenPromise = null
        throw error
      })
    }
    return xanoTokenPromise
  }

  async function post(path, payload, allowAuthRetry) {
    const retryOnAuthFailure = allowAuthRetry !== false
    const tokenPromise = xanoToken()
    const token = await tokenPromise
    const response = await global.fetch(XANO_BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    })
    if (response.status === 401 && retryOnAuthFailure) {
      if (xanoTokenPromise === tokenPromise) xanoTokenPromise = null
      return post(path, payload, false)
    }
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data,
      })
    }
    if (!data || typeof data !== 'object') {
      throw new Error(path + ' returned no data')
    }
    return data
  }

  function fetchStatus() {
    return post(STATUS_PATH, {})
  }

  function sandboxMode() {
    if (!global.location || global.location.hostname !== SANDBOX_HOST) return false
    const params = new URLSearchParams(global.location.search)
    return params.get('stripe_connect_sandbox') === '1'
  }

  function startConnect(returnUrl, sandbox) {
    const callbackUrl = new URL(CALLBACK_PATH, new URL(returnUrl).origin).toString()
    return post(sandbox ? SANDBOX_START_PATH : START_PATH, {
      return_url: returnUrl,
      callback_url: callbackUrl,
    })
  }

  function exchangeCode(code, sandbox) {
    return post(sandbox ? SANDBOX_EXCHANGE_PATH : EXCHANGE_PATH, { code })
  }

  function isStripeUrl(value) {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.hostname === 'connect.stripe.com'
    } catch (error) {
      return false
    }
  }

  function setActionPending(button, pending) {
    if (!button) return
    button.setAttribute('aria-busy', pending ? 'true' : 'false')
    button.style.pointerEvents = pending ? 'none' : ''
    if (button.classList) button.classList.toggle('is-disabled', pending)
    if ('disabled' in button) button.disabled = pending

    if (pending) {
      const tabindex = button.getAttribute('tabindex')
      button.setAttribute(
        PENDING_TABINDEX_ATTR,
        tabindex === null ? '' : tabindex,
      )
      button.setAttribute('aria-disabled', 'true')
      button.setAttribute('tabindex', '-1')
      return
    }

    const previousTabindex = button.getAttribute(PENDING_TABINDEX_ATTR)
    if (previousTabindex === '') button.removeAttribute('tabindex')
    else if (previousTabindex !== null) {
      button.setAttribute('tabindex', previousTabindex)
    }
    button.removeAttribute(PENDING_TABINDEX_ATTR)
    button.setAttribute('aria-disabled', 'false')
  }

  function setEarningsAccess(elements, enabled) {
    elements.forEach(function (element) {
      element.setAttribute('aria-disabled', enabled ? 'false' : 'true')
      if (element.classList) element.classList.toggle('is-disabled', !enabled)

      if (enabled) {
        if (element.tagName === 'A') {
          element.setAttribute('href', STRIPE_DASHBOARD_URL)
          element.removeAttribute('tabindex')
        } else {
          element.setAttribute('role', 'button')
          element.setAttribute('tabindex', '0')
        }
      } else {
        element.removeAttribute('href')
        element.setAttribute('tabindex', '-1')
      }
    })
  }

  function setConnectAccess(element, enabled) {
    if (!element) return
    element.setAttribute('aria-disabled', enabled ? 'false' : 'true')
    if (element.classList) element.classList.toggle('is-disabled', !enabled)
    element.setAttribute('role', 'button')
    element.setAttribute('tabindex', enabled ? '0' : '-1')
  }

  function resolveEarningsTiles(elements) {
    const tiles = {
      all: elements,
      disconnected: elements.find(function (element) {
        return element.getAttribute(EARNINGS_STATE_ATTR) === 'disconnected'
      }),
      ready: elements.find(function (element) {
        return element.getAttribute(EARNINGS_STATE_ATTR) === 'ready'
      }),
    }

    // The live dashboard originally shipped two authored tiles with the same
    // action attribute. Preserve that markup contract while allowing explicit
    // state attributes on new installs.
    if (elements.length === 2) {
      if (!tiles.disconnected) {
        tiles.disconnected = elements.find(function (element) {
          return (
            !element.getAttribute(EARNINGS_STATE_ATTR) &&
            element !== tiles.ready
          )
        })
      }
      if (!tiles.ready) {
        tiles.ready = elements.find(function (element) {
          return (
            !element.getAttribute(EARNINGS_STATE_ATTR) &&
            element !== tiles.disconnected
          )
        })
      }
    } else if (
      elements.length === 1 &&
      !tiles.disconnected &&
      !tiles.ready
    ) {
      tiles.ready = elements[0]
    }

    return tiles
  }

  function renderEarningsTiles(tiles, view) {
    const showDisconnected = view === 'disconnected' || view === 'incomplete'
    const showReady = view === 'ready'

    tiles.all.forEach(function (element) {
      show(element, false)
    })
    setConnectAccess(tiles.disconnected, showDisconnected)
    setEarningsAccess(tiles.ready ? [tiles.ready] : [], showReady)
    show(tiles.disconnected, showDisconnected)
    show(tiles.ready, showReady)
  }

  function handleConnectClick(element, event, activate) {
    if (element.getAttribute('aria-disabled') === 'true') {
      event.preventDefault()
      return false
    }
    event.preventDefault()
    activate()
    return true
  }

  function handleConnectKeydown(element, event, activate) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
      return false
    }
    return handleConnectClick(element, event, activate)
  }

  function handleEarningsClick(element, event) {
    if (element.getAttribute('aria-disabled') === 'true') {
      event.preventDefault()
      return false
    }
    if (element.tagName !== 'A') {
      event.preventDefault()
      global.location.assign(STRIPE_DASHBOARD_URL)
    }
    return true
  }

  function handleEarningsKeydown(element, event) {
    if (element.tagName === 'A') return false
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
      return false
    }
    return handleEarningsClick(element, event)
  }

  function returnMarker() {
    const params = new URLSearchParams(global.location.search)
    return (
      params.get('after_onboarding') === 'true' ||
      params.get('stripe_connect') === 'connected'
    )
  }

  function cleanReturnMarker() {
    const url = new URL(global.location.href)
    url.searchParams.delete('after_onboarding')
    url.searchParams.delete('stripe_connect')
    url.searchParams.delete('stripe_connect_sandbox')
    global.history.replaceState(
      {},
      global.document.title,
      url.pathname + url.search + url.hash,
    )
  }

  async function readSettledStatus(returnedFromStripe) {
    let status = null
    const delays = returnedFromStripe ? RETURN_POLL_DELAYS_MS : [0]

    for (const delay of delays) {
      if (delay) await wait(delay)
      status = await fetchStatus()
      if (status.charges_enabled === true) break
    }
    return status
  }

  function emit(name, detail) {
    if (
      typeof global.CustomEvent !== 'function' ||
      typeof global.dispatchEvent !== 'function'
    ) {
      return
    }
    global.dispatchEvent(new global.CustomEvent(name, { detail }))
  }

  async function loadDashboardStatus(
    roots,
    returnedFromStripe,
    earningsTiles = resolveEarningsTiles([]),
  ) {
    renderRoots(roots, 'loading')
    renderEarningsTiles(earningsTiles, 'loading')
    try {
      const status = await readSettledStatus(returnedFromStripe)
      const view = resolveDashboardView(status, returnedFromStripe)
      renderRoots(roots, view)
      renderEarningsTiles(earningsTiles, view)
      emit('starterStripeConnectReady', { view, status })
      return status
    } catch (error) {
      renderRoots(roots, 'error')
      renderEarningsTiles(earningsTiles, 'error')
      emit('starterStripeConnectError', {
        action: 'status',
        message: error.message || 'Stripe Connect status failed',
      })
      global.console.error(
        '[starter-dashboard] Unable to load Stripe Connect status',
        error,
      )
      return null
    } finally {
      if (returnedFromStripe) cleanReturnMarker()
    }
  }

  async function handleStart(button, roots, bootMemberId) {
    setActionPending(button, true)
    try {
      const activeMemberId = await currentMemberId()
      if (activeMemberId !== bootMemberId) {
        throw new Error('Member session changed before Stripe Connect redirect')
      }
      const returnUrl = new URL(DASHBOARD_PATH, global.location.origin).toString()
      const result = await startConnect(returnUrl, sandboxMode())
      if (!isStripeUrl(result.url)) {
        throw new Error('Stripe Connect start returned an invalid URL')
      }
      emit('starterStripeConnectRedirect', { mode: result.mode || '' })
      global.location.assign(result.url)
    } catch (error) {
      setActionPending(button, false)
      renderRoots(roots, 'error')
      emit('starterStripeConnectError', {
        action: 'start',
        message: error.message || 'Stripe Connect start failed',
      })
      global.console.error(
        '[starter-dashboard] Unable to start Stripe Connect',
        error,
      )
    }
  }

  async function mountDashboard() {
    const roots = Array.prototype.slice.call(
      global.document.querySelectorAll(elementSelector('root')),
    )
    if (!roots.length) return null

    const earningsElements = Array.prototype.slice.call(
      global.document.querySelectorAll(actionSelector('earnings')),
    )
    const earningsTiles = resolveEarningsTiles(earningsElements)
    renderRoots(roots, 'loading')
    renderEarningsTiles(earningsTiles, 'loading')

    let actionPending = false
    function runExclusive(task) {
      if (actionPending) return Promise.resolve(null)
      actionPending = true
      return Promise.resolve()
        .then(task)
        .finally(function () {
          actionPending = false
        })
    }

    try {
      const memberId = await currentMemberId()
      if (earningsTiles.ready) {
        const link = earningsTiles.ready
        link.addEventListener('click', function (event) {
          handleEarningsClick(link, event)
        })
        link.addEventListener('keydown', function (event) {
          handleEarningsKeydown(link, event)
        })
      }
      if (earningsTiles.disconnected) {
        const connectTile = earningsTiles.disconnected
        const startFromTile = function (event) {
          return handleConnectClick(connectTile, event, function () {
            runExclusive(function () {
              return handleStart(connectTile, roots, memberId)
            })
          })
        }
        connectTile.addEventListener('click', startFromTile)
        connectTile.addEventListener('keydown', function (event) {
          handleConnectKeydown(connectTile, event, function () {
            runExclusive(function () {
              return handleStart(connectTile, roots, memberId)
            })
          })
        })
      }
      roots.forEach(function (root) {
        root.querySelectorAll(actionSelector('start')).forEach(function (button) {
          button.addEventListener('click', function (event) {
            event.preventDefault()
            runExclusive(function () {
              return handleStart(button, roots, memberId)
            })
          })
        })
        root.querySelectorAll(actionSelector('refresh')).forEach(function (button) {
          button.addEventListener('click', function (event) {
            event.preventDefault()
            runExclusive(function () {
              return loadDashboardStatus(roots, false, earningsTiles)
            })
          })
        })
      })

      const returnedFromStripe = returnMarker()
      return runExclusive(function () {
        return loadDashboardStatus(roots, returnedFromStripe, earningsTiles)
      })
    } catch (error) {
      renderRoots(roots, 'error')
      renderEarningsTiles(earningsTiles, 'error')
      emit('starterStripeConnectError', {
        action: 'session',
        message: error.message || 'Member session unavailable',
      })
      global.console.error(
        '[starter-dashboard] Unable to resolve Stripe Connect member',
        error,
      )
      return null
    }
  }

  function callbackParams() {
    const url = new URL(global.location.href)
    const result = {
      code: url.searchParams.get('code') || '',
      state: url.searchParams.get('state') || '',
      error: url.searchParams.get('error') || '',
    }
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    global.history.replaceState(
      {},
      global.document.title,
      url.pathname + url.search + url.hash,
    )
    return result
  }

  async function mountCallback() {
    const roots = Array.prototype.slice.call(
      global.document.querySelectorAll(elementSelector('root')),
    )
    renderRoots(roots, 'loading')
    const params = callbackParams()

    try {
      if (params.error) throw new Error('Stripe Connect authorization was not completed')
      if (!params.code) throw new Error('Stripe Connect callback code is missing')

      const memberId = await currentMemberId()
      const sandbox = params.state.startsWith(SANDBOX_STATE_PREFIX)
      if (sandbox && global.location.hostname !== SANDBOX_HOST) {
        throw new Error('Stripe Connect sandbox callback is staging-only')
      }
      const expectedState = sandbox
        ? SANDBOX_STATE_PREFIX + memberId
        : memberId
      if (params.state && params.state !== expectedState) {
        throw new Error('Stripe Connect state does not match the logged-in member')
      }

      const result = await exchangeCode(params.code, sandbox)
      if (result.connected !== true) {
        throw new Error('Stripe Connect exchange did not connect the account')
      }
      if (sandbox && result.sandbox !== true) {
        throw new Error('Stripe Connect sandbox exchange was not isolated')
      }

      const dashboardUrl = new URL(DASHBOARD_PATH, global.location.origin)
      dashboardUrl.searchParams.set('stripe_connect', 'connected')
      if (sandbox) dashboardUrl.searchParams.set('stripe_connect_sandbox', 'verified')
      global.location.assign(dashboardUrl.toString())
      return result
    } catch (error) {
      renderRoots(roots, 'error')
      emit('starterStripeConnectError', {
        action: 'callback',
        message: error.message || 'Stripe Connect callback failed',
      })
      global.console.error('[stripe-connect-callback] Exchange failed', error)
      return null
    }
  }

  const testApi = {
    CALLBACK_PATH,
    DASHBOARD_PATH,
    EXCHANGE_PATH,
    SANDBOX_EXCHANGE_PATH,
    SANDBOX_START_PATH,
    START_PATH,
    STATUS_PATH,
    STRIPE_DASHBOARD_URL,
    __resetXanoToken: function () {
      xanoTokenPromise = null
    },
    callbackParams,
    currentMemberId,
    exchangeCode,
    fetchStatus,
    handleConnectClick,
    handleConnectKeydown,
    handleEarningsClick,
    handleEarningsKeydown,
    isStripeUrl,
    loadDashboardStatus,
    mountCallback,
    mountDashboard,
    renderRoots,
    renderEarningsTiles,
    resolveEarningsTiles,
    resolveDashboardView,
    sandboxMode,
    setActionPending,
    setEarningsAccess,
    setView,
    startConnect,
  }

  if (isCommonJs) {
    module.exports = testApi
    return
  }

  function mount() {
    if (global.location.pathname === CALLBACK_PATH) mountCallback()
    else if (global.location.pathname === DASHBOARD_PATH) mountDashboard()
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
})(typeof window !== 'undefined' ? window : globalThis)
