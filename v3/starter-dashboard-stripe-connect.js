/**
 * Starter Dashboard 3.0 — Stripe Connect status and callback controller.
 *
 * Xano reconciles Stripe-authoritative state into freelancers_v3. Webflow owns
 * the state markup, source button component, and styling; this module selects
 * authored states, handles Connect and callback redirects, and requests
 * provider-verified Dashboard access. Connected accounts leave the Action
 * Items list. The Starters support team owns disconnect requests.
 * Every Xano call is Bearer-authenticated: the active
 * Memberstack session is traded for a Xano token and the server derives the
 * member identity from that token, so no client-supplied member id is trusted.
 *
 * Designer wiring:
 *   data-stripe-connect-element="root|loading|disconnected|incomplete|
 *   ready|review|error"
 *   data-stripe-connect-action="start|refresh|earnings|dashboard"
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
  const DASHBOARD_ACCESS_PATH = '/stripe_connect/dashboard/v3'
  const DISCONNECT_PATH = '/stripe_connect/disconnect/v3'
  const EXCHANGE_PATH = '/stripe_connect/oauth_exchange/v3'
  const RETURN_CHANNEL_NAME = 'starters-stripe-connect-return'
  const DASHBOARD_PATH = '/starter-dashboard'
  const CALLBACK_PATH = '/stripe-connect-callback'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  const OAUTH_STATE_MIN_LENGTH = 16
  const OAUTH_STATE_MAX_LENGTH = 128
  const IDEMPOTENCY_KEY_MAX_LENGTH = 128
  const RETURN_POLL_DELAYS_MS = [0, 750, 1500, 3000, 5000]
  const ELEMENT_ATTR = 'data-stripe-connect-element'
  const ACTION_ATTR = 'data-stripe-connect-action'
  const EARNINGS_STATE_ATTR = 'data-stripe-connect-earnings-state'
  const HERO_ACTION_ATTR = 'data-stripe-connect-hero-action'
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
      show(
        root,
        view !== 'incomplete' && view !== 'ready' && view !== 'review',
      )
    })
  }

  function resolveDashboardView(status, returnedFromStripe) {
    if (
      !status ||
      typeof status !== 'object' ||
      typeof status.connected !== 'boolean' ||
      typeof status.charges_enabled !== 'boolean' ||
      (status.connected === false && status.charges_enabled === true)
    ) {
      return 'error'
    }
    if (status.connected === false) return 'disconnected'
    if (status.charges_enabled === true) return 'ready'
    if (returnedFromStripe) return 'review'
    return 'incomplete'
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

    const memberstack = await waitForMemberstackDom()
    if (memberstack) {
      const result = await memberstack.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member.id
    }

    throw new Error('No logged-in Memberstack member')
  }

  async function initialMemberId() {
    if (global.memberReady && typeof global.memberReady.then === 'function') {
      const member = await global.memberReady
      if (member && member.id) return member.id
    }

    return currentMemberId()
  }

  let xanoTokenPromise = null

  async function tradeForXanoToken(forceRefresh) {
    if (typeof global.getXanoAuthToken === 'function') {
      const token = await global.getXanoAuthToken(
        forceRefresh ? { forceRefresh: true } : undefined,
      )
      if (!token) throw new Error('Shared Xano auth bridge returned no token')
      return token
    }
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

  function xanoToken(forceRefresh) {
    if (forceRefresh) xanoTokenPromise = null
    if (!xanoTokenPromise) {
      xanoTokenPromise = tradeForXanoToken(forceRefresh).catch(function (error) {
        xanoTokenPromise = null
        throw error
      })
    }
    return xanoTokenPromise
  }

  async function post(path, payload, allowAuthRetry, forceAuthRefresh) {
    const retryOnAuthFailure = allowAuthRetry !== false
    const tokenPromise = xanoToken(forceAuthRefresh === true)
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
      return post(path, payload, false, true)
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

  function createAttemptKey(prefix) {
    const safePrefix = String(prefix || 'attempt').replace(/[^a-z0-9_-]/gi, '-')
    let entropy = ''
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      entropy = global.crypto.randomUUID()
    } else {
      entropy =
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14)
    }
    const key = safePrefix + '-' + entropy
    if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new Error('Unable to create a bounded idempotency key')
    }
    return key
  }

  function validOpaqueState(state) {
    return (
      typeof state === 'string' &&
      state.length >= OAUTH_STATE_MIN_LENGTH &&
      state.length <= OAUTH_STATE_MAX_LENGTH
    )
  }

  let connectStartAttemptKey = null
  let dashboardAttemptKey = null
  let disconnectAttemptKey = null

  function currentConnectStartAttemptKey() {
    if (!connectStartAttemptKey) {
      connectStartAttemptKey = createAttemptKey('connect-start')
    }
    return connectStartAttemptKey
  }

  function clearConnectStartAttemptKey() {
    connectStartAttemptKey = null
  }

  function currentDashboardAttemptKey() {
    if (!dashboardAttemptKey) {
      dashboardAttemptKey = createAttemptKey('connect-dashboard')
    }
    return dashboardAttemptKey
  }

  function clearDashboardAttemptKey() {
    dashboardAttemptKey = null
  }

  function currentDisconnectAttemptKey() {
    if (!disconnectAttemptKey) {
      disconnectAttemptKey = createAttemptKey('connect-disconnect')
    }
    return disconnectAttemptKey
  }

  function clearDisconnectAttemptKey() {
    disconnectAttemptKey = null
  }

  function shouldRetainConnectStartKey(error) {
    if (!error || typeof error.status !== 'number') return true
    return (
      error.status === 408 ||
      error.status === 409 ||
      error.status === 429 ||
      error.status >= 500
    )
  }

  function shouldRetainDisconnectKey(error) {
    return shouldRetainConnectStartKey(error)
  }

  function shouldRetainDashboardKey(error) {
    return shouldRetainConnectStartKey(error)
  }

  function startConnect(returnUrl, idempotencyKey) {
    const callbackUrl = new URL(CALLBACK_PATH, new URL(returnUrl).origin).toString()
    const payload = {
      return_url: returnUrl,
      callback_url: callbackUrl,
    }
    const attemptKey = idempotencyKey || createAttemptKey('connect-start')
    if (!attemptKey || attemptKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new Error('Stripe Connect idempotency key is invalid')
    }
    payload.idempotency_key = attemptKey
    return post(START_PATH, payload)
  }

  function dashboardAccess(idempotencyKey) {
    if (!idempotencyKey || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new Error('Stripe Dashboard idempotency key is invalid')
    }
    return post(DASHBOARD_ACCESS_PATH, { idempotency_key: idempotencyKey })
  }

  function disconnectConnect(idempotencyKey) {
    if (!idempotencyKey || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new Error('Stripe disconnect idempotency key is invalid')
    }
    return post(DISCONNECT_PATH, { idempotency_key: idempotencyKey })
  }

  function exchangeCode(code, state) {
    return post(EXCHANGE_PATH, { code, state }, false)
  }

  function resolveExchangeMode(result) {
    if (!result || typeof result !== 'object') {
      throw new Error('Stripe Connect exchange returned no result')
    }
    const mode = result.mode || (result.connected === true ? 'completed' : '')
    if (
      mode !== 'completed' &&
      mode !== 'reconciliation_required' &&
      mode !== 'restart_required'
    ) {
      throw new Error('Stripe Connect exchange returned an unknown mode')
    }
    if (mode === 'completed' && result.connected !== true) {
      throw new Error('Stripe Connect exchange did not connect the account')
    }
    return mode
  }

  function isStripeUrl(value) {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.hostname === 'connect.stripe.com'
    } catch (error) {
      return false
    }
  }

  function resolveDashboardDestination(result) {
    if (!result || typeof result !== 'object' || result.connected !== true) {
      throw new Error('Stripe Dashboard access did not confirm a connection')
    }
    if (result.mode !== 'full' && result.mode !== 'express') {
      throw new Error('Stripe Dashboard access returned an unknown mode')
    }
    if (
      typeof result.account_id !== 'string' ||
      !/^acct_[A-Za-z0-9]+$/.test(result.account_id)
    ) {
      throw new Error('Stripe Dashboard access returned an invalid account')
    }
    try {
      const url = new URL(result.url)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.hash
      ) {
        throw new Error('Stripe Dashboard access returned an invalid URL')
      }
      if (result.mode === 'full') {
        if (
          url.hostname !== 'dashboard.stripe.com' ||
          url.pathname !== '/b/' + result.account_id ||
          url.search
        ) {
          throw new Error('Stripe Dashboard account URL did not match')
        }
      } else if (
        url.hostname !== 'connect.stripe.com' ||
        !url.pathname.startsWith('/express/' + result.account_id + '/') ||
        url.pathname === '/express/' + result.account_id + '/'
      ) {
        throw new Error('Stripe Express account URL did not match')
      }
      return url.toString()
    } catch (error) {
      if (error && /^Stripe /.test(error.message || '')) throw error
      throw new Error('Stripe Dashboard access returned an invalid URL')
    }
  }

  function isStripeDashboardUrl(value, mode, accountId) {
    try {
      resolveDashboardDestination({
        account_id: accountId,
        connected: true,
        mode,
        url: value,
      })
      return true
    } catch (_error) {
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

  function setStartPending(button, connectTile, pending) {
    setActionPending(connectTile, pending)
    if (button !== connectTile) setActionPending(button, pending)
  }

  function createExclusiveRunner() {
    let actionPending = false
    function runExclusive(task, latchOnSuccess) {
      if (actionPending) return Promise.resolve(null)
      actionPending = true
      let result
      try {
        result = task()
      } catch (error) {
        actionPending = false
        return Promise.reject(error)
      }
      return Promise.resolve(result)
        .then(
          function (result) {
            if (!latchOnSuccess || result !== true) actionPending = false
            return result
          },
          function (error) {
            actionPending = false
            throw error
          },
        )
    }
    runExclusive.release = function () {
      actionPending = false
    }
    return runExclusive
  }

  function setEarningsAccess(elements, enabled) {
    elements.forEach(function (element) {
      element.setAttribute('aria-disabled', enabled ? 'false' : 'true')
      if (element.classList) element.classList.toggle('is-disabled', !enabled)

      if (enabled) {
        if (element.tagName === 'A') {
          element.setAttribute('href', '#')
          element.removeAttribute('target')
          element.removeAttribute('rel')
          element.removeAttribute('tabindex')
        } else {
          element.setAttribute('role', 'button')
          element.setAttribute('tabindex', '0')
        }
      } else {
        element.removeAttribute('href')
        element.removeAttribute('target')
        element.removeAttribute('rel')
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

    tiles.primary = tiles.ready || tiles.disconnected

    return tiles
  }

  function setHeroTileCopy(tile, title, description) {
    if (!tile) return
    const titleElement = tile.querySelector('.dash-hero_button-title')
    const descriptionElement = tile.querySelector(
      '.dash-hero_button-description',
    )
    if (titleElement) titleElement.textContent = title
    if (descriptionElement) descriptionElement.textContent = description
    tile.setAttribute('aria-label', title + '. ' + description)
  }

  function heroTileState(view) {
    if (view === 'disconnected') {
      return {
        action: 'start',
        description: 'Connect Stripe',
        enabled: true,
        title: 'Get Paid',
      }
    }
    if (view === 'incomplete') {
      return {
        action: 'start',
        description: 'Finish Stripe onboarding',
        enabled: true,
        title: 'Complete Setup',
      }
    }
    if (view === 'review') {
      return {
        action: 'none',
        description: 'Stripe is reviewing your account',
        enabled: false,
        title: 'Under Review',
      }
    }
    if (view === 'ready') {
      return {
        action: 'dashboard',
        description: 'Payment history & payouts',
        enabled: true,
        title: 'Earnings',
      }
    }
    if (view === 'error') {
      return {
        action: 'none',
        description: 'Use Try Again above',
        enabled: false,
        title: 'Stripe Unavailable',
      }
    }
    return {
      action: 'none',
      description: 'Loading account status',
      enabled: false,
      title: 'Checking Stripe',
    }
  }

  function renderEarningsTiles(tiles, view) {
    const primary = tiles.primary || tiles.ready || tiles.disconnected
    const state = heroTileState(view)

    tiles.all.forEach(function (element) {
      show(element, false)
    })
    if (!primary) return

    primary.setAttribute(HERO_ACTION_ATTR, state.action)
    setHeroTileCopy(primary, state.title, state.description)
    setEarningsAccess([primary], state.enabled)
    show(primary, true)
  }

  function handleHeroTileActivation(element, event, keyboard, actions) {
    const action = element.getAttribute(HERO_ACTION_ATTR)
    if (action === 'start') {
      const handle = keyboard ? handleConnectKeydown : handleConnectClick
      return handle(element, event, actions.start)
    }
    if (action === 'dashboard') {
      const handle = keyboard ? handleEarningsKeydown : handleEarningsClick
      return handle(element, event, actions.dashboard)
    }
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault()
    }
    return false
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

  function reserveStripeTab() {
    if (typeof global.open !== 'function') return null
    const stripeTab = global.open('about:blank', '_blank')
    if (!stripeTab) return null
    try {
      stripeTab.opener = null
      if (stripeTab.opener !== null) throw new Error('Unable to detach opener')
    } catch (_error) {
      closeStripeTab(stripeTab)
      return null
    }
    return stripeTab
  }

  function closeStripeTab(stripeTab) {
    if (!stripeTab || stripeTab.closed || typeof stripeTab.close !== 'function') {
      return
    }
    try {
      stripeTab.close()
    } catch (_error) {
      // A failed or already-detached popup needs no further recovery.
    }
  }

  function navigateStripeTab(stripeTab, url) {
    if (!stripeTab || stripeTab.closed) return false
    try {
      if (
        stripeTab.location &&
        typeof stripeTab.location.replace === 'function'
      ) {
        stripeTab.location.replace(url)
      } else {
        stripeTab.location = url
      }
      return true
    } catch (_error) {
      return false
    }
  }

  function signalStripeReturn(memberId) {
    if (
      !memberId ||
      typeof global.document === 'undefined' ||
      typeof global.BroadcastChannel !== 'function'
    ) {
      return false
    }
    let channel = null
    try {
      channel = new global.BroadcastChannel(RETURN_CHANNEL_NAME)
      channel.postMessage({ memberId: String(memberId), type: 'connected' })
      return true
    } catch (_error) {
      return false
    } finally {
      if (channel && typeof channel.close === 'function') channel.close()
    }
  }

  function watchStripeTabReturn(stripeTab, memberId, onReturn) {
    if (!stripeTab) return false
    const canWatchFocus =
      typeof global.addEventListener === 'function' &&
      typeof global.removeEventListener === 'function'
    const canWatchClosed =
      canWatchFocus &&
      typeof global.setInterval === 'function' &&
      typeof global.clearInterval === 'function'
    let returnChannel = null
    if (
      memberId &&
      typeof global.document !== 'undefined' &&
      typeof global.BroadcastChannel === 'function'
    ) {
      try {
        returnChannel = new global.BroadcastChannel(RETURN_CHANNEL_NAME)
      } catch (_error) {
        returnChannel = null
      }
    }
    if (!canWatchFocus && !canWatchClosed && !returnChannel) return false
    let settled = false
    let closedTimer = null
    let handleFocus = null
    const cleanup = function () {
      if (handleFocus) global.removeEventListener('focus', handleFocus)
      if (closedTimer !== null) {
        global.clearInterval(closedTimer)
        closedTimer = null
      }
      if (returnChannel) {
        returnChannel.onmessage = null
        if (typeof returnChannel.close === 'function') returnChannel.close()
        returnChannel = null
      }
    }
    const handleReturn = function (reason) {
      if (settled) return null
      settled = true
      cleanup()
      return Promise.resolve(reason).then(onReturn)
    }
    if (canWatchFocus) {
      handleFocus = function () {
        return handleReturn(stripeTab.closed ? 'closed' : 'focus')
      }
      global.addEventListener('focus', handleFocus)
    }
    if (returnChannel) {
      returnChannel.onmessage = function (event) {
        const message = event && event.data
        if (
          !message ||
          message.type !== 'connected' ||
          String(message.memberId || '') !== String(memberId)
        ) {
          return null
        }
        return handleReturn('callback')
      }
    }
    if (canWatchClosed) {
      closedTimer = global.setInterval(function () {
        if (stripeTab.closed) return handleReturn('closed')
        return null
      }, 500)
    }
    return {
      cancel: function () {
        if (settled) return
        settled = true
        cleanup()
      },
    }
  }

  function handleEarningsClick(element, event, activate) {
    if (element.getAttribute('aria-disabled') === 'true') {
      event.preventDefault()
      return false
    }
    // Always own the navigation. Webflow can attach a same-tab redirect to an
    // authored link even after target="_blank" is set, so relying on native
    // anchor behavior can replace the dashboard. Reserving the tab directly
    // keeps anchor and div tiles on the same proven path.
    event.preventDefault()
    activate()
    return true
  }

  function handleEarningsKeydown(element, event, activate) {
    if (element.tagName === 'A') return false
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
      return false
    }
    return handleEarningsClick(element, event, activate)
  }

  function openDashboardInNewTab(
    runExclusive,
    button,
    roots,
    memberId,
    earningsTiles = resolveEarningsTiles([]),
  ) {
    return runExclusive(async function () {
      let failed = false
      const stripeTab = reserveStripeTab()
      if (!stripeTab) {
        renderRoots(roots, 'error')
        renderEarningsTiles(earningsTiles, 'error')
        emit('starterStripeConnectError', {
          action: 'dashboard',
          message: 'Browser blocked the Stripe Dashboard tab',
        })
        return false
      }

      setActionPending(button, true)
      try {
        const activeMemberId = await currentMemberId()
        if (activeMemberId !== memberId) {
          throw new Error('Member session changed before Stripe Dashboard access')
        }
        const result = await dashboardAccess(currentDashboardAttemptKey())
        if (result.mode === 'disconnected' && result.connected === false) {
          clearDashboardAttemptKey()
          closeStripeTab(stripeTab)
          await loadDashboardStatus(roots, false, earningsTiles)
          return false
        }
        const destination = resolveDashboardDestination(result)
        clearDashboardAttemptKey()
        if (!navigateStripeTab(stripeTab, destination)) {
          throw new Error('Unable to open the connected Stripe account')
        }
        emit('starterStripeConnectDashboard', { mode: result.mode || '' })
        return true
      } catch (error) {
        failed = true
        if (!shouldRetainDashboardKey(error)) clearDashboardAttemptKey()
        closeStripeTab(stripeTab)
        renderRoots(roots, 'error')
        renderEarningsTiles(earningsTiles, 'error')
        emit('starterStripeConnectError', {
          action: 'dashboard',
          message: error.message || 'Stripe Dashboard access failed',
        })
        global.console.error(
          '[starter-dashboard] Unable to open the connected Stripe account',
          error,
        )
        return false
      } finally {
        setActionPending(button, false)
        if (failed) renderEarningsTiles(earningsTiles, 'error')
      }
    })
  }

  function confirmDisconnect() {
    return (
      typeof global.confirm === 'function' &&
      global.confirm(
        'Disconnect Stripe from The Starters? Paid consulting calls will be disabled until you reconnect.',
      )
    )
  }

  function handleDisconnect(
    runExclusive,
    button,
    roots,
    earningsTiles,
    bootMemberId,
  ) {
    if (!confirmDisconnect()) return Promise.resolve(false)
    return runExclusive(async function () {
      setActionPending(button, true)
      try {
        const activeMemberId = await currentMemberId()
        if (activeMemberId !== bootMemberId) {
          throw new Error('Member session changed before Stripe disconnect')
        }
        const result = await disconnectConnect(currentDisconnectAttemptKey())
        if (result.connected !== false) {
          throw new Error('Stripe disconnect returned an invalid result')
        }
        clearDisconnectAttemptKey()
        await loadDashboardStatus(roots, false, earningsTiles)
        emit('starterStripeConnectDisconnected', {
          providerAction: result.provider_action || '',
          replayed: result.replayed === true,
        })
        return true
      } catch (error) {
        if (!shouldRetainDisconnectKey(error)) clearDisconnectAttemptKey()
        renderRoots(roots, 'error')
        renderEarningsTiles(earningsTiles, 'error')
        emit('starterStripeConnectError', {
          action: 'disconnect',
          message: error.message || 'Stripe disconnect failed',
        })
        global.console.error(
          '[starter-dashboard] Unable to disconnect Stripe',
          error,
        )
        return false
      } finally {
        setActionPending(button, false)
      }
    })
  }

  function returnMarker() {
    const params = new URLSearchParams(global.location.search)
    const result = params.get('stripe_connect')
    return (
      params.get('after_onboarding') === 'true' ||
      result === 'connected' ||
      result === 'reconciliation_required'
    )
  }

  function cleanReturnMarker() {
    const url = new URL(global.location.href)
    url.searchParams.delete('after_onboarding')
    url.searchParams.delete('stripe_connect')
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
    pollForSettlement = returnedFromStripe,
    cleanReturnUrl = returnedFromStripe,
  ) {
    renderRoots(roots, 'loading')
    renderEarningsTiles(earningsTiles, 'loading')
    try {
      const status = await readSettledStatus(pollForSettlement)
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
      if (cleanReturnUrl) cleanReturnMarker()
    }
  }

  async function handleStart(
    button,
    connectTile,
    roots,
    bootMemberId,
    stripeTab,
  ) {
    setStartPending(button, connectTile, true)
    try {
      if (!stripeTab || stripeTab.closed) {
        throw new Error('Browser blocked the Stripe Connect tab')
      }
      const activeMemberId = await currentMemberId()
      if (activeMemberId !== bootMemberId) {
        throw new Error('Member session changed before Stripe Connect redirect')
      }
      const returnUrl = new URL(DASHBOARD_PATH, global.location.origin).toString()
      const attemptKey = currentConnectStartAttemptKey()
      const result = await startConnect(returnUrl, attemptKey)
      if (
        (result.mode === 'connected' || result.mode === 'reconciliation_required')
      ) {
        clearConnectStartAttemptKey()
        closeStripeTab(stripeTab)
        setStartPending(button, connectTile, false)
        emit('starterStripeConnectRedirect', {
          mode: result.mode,
          replayed: result.replayed === true,
        })
        return result.mode
      }
      if (!isStripeUrl(result.url)) {
        clearConnectStartAttemptKey()
        throw new Error('Stripe Connect start returned an invalid URL')
      }
      emit('starterStripeConnectRedirect', { mode: result.mode || '' })
      if (!navigateStripeTab(stripeTab, result.url)) {
        throw new Error('Unable to open the Stripe Connect tab')
      }
      clearConnectStartAttemptKey()
      return true
    } catch (error) {
      if (!shouldRetainConnectStartKey(error)) {
        clearConnectStartAttemptKey()
      }
      closeStripeTab(stripeTab)
      setStartPending(button, connectTile, false)
      renderRoots(roots, 'error')
      emit('starterStripeConnectError', {
        action: 'start',
        message: error.message || 'Stripe Connect start failed',
      })
      global.console.error(
        '[starter-dashboard] Unable to start Stripe Connect',
        error,
      )
      return false
    }
  }

  function startInNewTab(
    runExclusive,
    button,
    connectTile,
    roots,
    memberId,
    earningsTiles = resolveEarningsTiles([]),
  ) {
    return runExclusive(function () {
      const stripeTab = reserveStripeTab()
      if (!stripeTab) {
        renderRoots(roots, 'error')
        renderEarningsTiles(earningsTiles, 'error')
        emit('starterStripeConnectError', {
          action: 'start',
          message: 'Browser blocked the Stripe Connect tab',
        })
        return false
      }

      const recover = function (returnReason) {
        const returnedFromStripe = returnReason === 'callback'
        setStartPending(button, connectTile, false)
        return loadDashboardStatus(
          roots,
          returnedFromStripe,
          earningsTiles,
          true,
          false,
        ).finally(function () {
          runExclusive.release()
        })
      }
      let settleStart
      const startSettled = new Promise(function (resolve) {
        settleStart = resolve
      })
      const returnWatcher = watchStripeTabReturn(
        stripeTab,
        memberId,
        function (reason) {
          return startSettled.then(function (result) {
            if (result === true) return recover(reason)
            return null
          })
        },
      )

      return handleStart(
        button,
        connectTile,
        roots,
        memberId,
        stripeTab,
      ).then(
        function (result) {
          settleStart(result)
          if (
            result === 'connected' ||
            result === 'reconciliation_required'
          ) {
            if (returnWatcher) returnWatcher.cancel()
            return loadDashboardStatus(
              roots,
              result === 'reconciliation_required',
              earningsTiles,
              true,
              false,
            ).then(function () {
              return false
            })
          }
          if (result !== true) {
            if (returnWatcher) returnWatcher.cancel()
            closeStripeTab(stripeTab)
            renderEarningsTiles(earningsTiles, 'error')
            return result
          }

          if (!returnWatcher) {
            setStartPending(button, connectTile, false)
            runExclusive.release()
          }
          return true
        },
        function (error) {
          settleStart(false)
          if (returnWatcher) returnWatcher.cancel()
          throw error
        },
      )
    }, true)
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

    const runExclusive = createExclusiveRunner()

    try {
      const memberId = await initialMemberId()
      if (earningsTiles.primary) {
        const heroTile = earningsTiles.primary
        const activateHeroTile = function (event, keyboard) {
          return handleHeroTileActivation(heroTile, event, keyboard, {
            start: function () {
              startInNewTab(
                runExclusive,
                heroTile,
                heroTile,
                roots,
                memberId,
                earningsTiles,
              )
            },
            dashboard: function () {
              openDashboardInNewTab(
                runExclusive,
                heroTile,
                roots,
                memberId,
                earningsTiles,
              )
            },
          })
        }
        heroTile.addEventListener('click', function (event) {
          activateHeroTile(event, false)
        })
        heroTile.addEventListener('keydown', function (event) {
          activateHeroTile(event, true)
        })
      }
      roots.forEach(function (root) {
        root
          .querySelectorAll(actionSelector('dashboard'))
          .forEach(function (button) {
            button.addEventListener('click', function (event) {
              event.preventDefault()
              openDashboardInNewTab(
                runExclusive,
                button,
                roots,
                memberId,
                earningsTiles,
              )
            })
          })
        root.querySelectorAll(actionSelector('start')).forEach(function (button) {
          button.addEventListener('click', function (event) {
            event.preventDefault()
            startInNewTab(
              runExclusive,
              button,
              earningsTiles.primary,
              roots,
              memberId,
              earningsTiles,
            )
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
      if (!validOpaqueState(params.state)) {
        throw new Error('Stripe Connect state is missing or invalid')
      }

      const result = await exchangeCode(params.code, params.state)
      const mode = resolveExchangeMode(result)

      if (mode === 'completed') signalStripeReturn(memberId)
      const dashboardUrl = new URL(DASHBOARD_PATH, global.location.origin)
      dashboardUrl.searchParams.set(
        'stripe_connect',
        mode === 'completed' ? 'connected' : mode,
      )
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
    DASHBOARD_ACCESS_PATH,
    DASHBOARD_PATH,
    DISCONNECT_PATH,
    EXCHANGE_PATH,
    START_PATH,
    STATUS_PATH,
    __resetXanoToken: function () {
      xanoTokenPromise = null
    },
    __resetConnectStartAttempt: clearConnectStartAttemptKey,
    __resetDashboardAttempt: clearDashboardAttemptKey,
    __resetDisconnectAttempt: clearDisconnectAttemptKey,
    callbackParams,
    confirmDisconnect,
    createExclusiveRunner,
    createAttemptKey,
    currentConnectStartAttemptKey,
    currentDashboardAttemptKey,
    currentDisconnectAttemptKey,
    currentMemberId,
    dashboardAccess,
    disconnectConnect,
    exchangeCode,
    fetchStatus,
    handleConnectClick,
    handleConnectKeydown,
    handleDisconnect,
    handleEarningsClick,
    handleEarningsKeydown,
    handleHeroTileActivation,
    handleStart,
    heroTileState,
    navigateStripeTab,
    openDashboardInNewTab,
    reserveStripeTab,
    initialMemberId,
    isStripeDashboardUrl,
    isStripeUrl,
    loadDashboardStatus,
    mountCallback,
    mountDashboard,
    renderRoots,
    renderEarningsTiles,
    resolveExchangeMode,
    resolveDashboardDestination,
    resolveEarningsTiles,
    resolveDashboardView,
    setActionPending,
    setEarningsAccess,
    setHeroTileCopy,
    setStartPending,
    setView,
    shouldRetainConnectStartKey,
    shouldRetainDashboardKey,
    shouldRetainDisconnectKey,
    signalStripeReturn,
    startInNewTab,
    startConnect,
    validOpaqueState,
    watchStripeTabReturn,
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
