/**
 * V3 membership checkout authority gate.
 *
 * This controller records one authenticated V3 checkout intent before the
 * native Memberstack price control opens Stripe checkout. It does not create
 * the checkout, subscription, entitlement, or renewal email. V2 pages and
 * hirethestarters.com are outside this controller's host and route allowlists.
 */
;(function (globalObject) {
  'use strict'

  if (!globalObject || globalObject.__tsMembershipCheckoutAuthority) return
  globalObject.__tsMembershipCheckoutAuthority = true

  var AUTH_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh/auth/trade-token/v3'
  var REGISTER_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/membership/checkout-intent/v3'
  var PRICE_ATTRIBUTE = 'data-ms-price:add'
  var ALLOWED_HOSTS = {
    'thestarters.com': true,
    'www.thestarters.com': true,
    'the-starters-3-0.webflow.io': true,
  }
  var ALLOWED_PRICE_IDS = {
    'prc_premium-monthly--fn1ae0qjj': true,
    'prc_paid-annual-2o5f040u': true,
  }
  var INTENT_TTL_MS = 2 * 60 * 60 * 1000
  var bypassTargets = typeof WeakSet === 'function' ? new WeakSet() : null
  var pendingTargets = typeof WeakSet === 'function' ? new WeakSet() : null

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function normalizedRoute(value) {
    var route = clean(value).toLowerCase()
    if (route.length > 1) route = route.replace(/\/+$/, '')
    return route || '/'
  }

  function validSourceRoute(value) {
    var route = normalizedRoute(value)
    if (
      route === '/' ||
      route === '/quiz-results' ||
      route === '/all-starters' ||
      route === '/why-us'
    ) {
      return true
    }
    return /^\/(?:hire|categories|subcategories|companies|competitors|functions|industries|roles|skills|tools)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route)
  }

  function checkoutTarget(node) {
    if (!node) return null
    if (typeof node.closest === 'function') {
      return node.closest('[' + PRICE_ATTRIBUTE.replace(':', '\\:') + ']')
    }
    return typeof node.getAttribute === 'function' && node.getAttribute(PRICE_ATTRIBUTE)
      ? node
      : null
  }

  function randomEventId() {
    if (
      globalObject.crypto &&
      typeof globalObject.crypto.randomUUID === 'function'
    ) {
      return 'evt_' + globalObject.crypto.randomUUID().toLowerCase()
    }
    throw new Error('Secure checkout identity is unavailable')
  }

  function storageKey(priceId) {
    return 'ts:v3:membership-checkout-intent:' + priceId
  }

  function checkoutIdentity(route, priceId) {
    var key = storageKey(priceId)
    try {
      var existing = JSON.parse(clean(globalObject.sessionStorage.getItem(key)) || 'null')
      var existingEventId = clean(existing && existing.eventId).toLowerCase()
      var existingRoute = normalizedRoute(existing && existing.sourceRoute)
      var existingExpiresAt = Number(existing && existing.expiresAt)
      if (
        /^evt_[a-z0-9-]{8,116}$/.test(existingEventId) &&
        validSourceRoute(existingRoute) &&
        existingExpiresAt > Date.now()
      ) {
        return { eventId: existingEventId, sourceRoute: existingRoute }
      }
      var created = {
        eventId: randomEventId(),
        sourceRoute: route,
        expiresAt: Date.now() + INTENT_TTL_MS,
      }
      globalObject.sessionStorage.setItem(key, JSON.stringify(created))
      return { eventId: created.eventId, sourceRoute: created.sourceRoute }
    } catch (_error) {
      return { eventId: randomEventId(), sourceRoute: route }
    }
  }

  function setControlState(target, state, message) {
    if (!target || typeof target.setAttribute !== 'function') return
    target.setAttribute('data-v3-checkout-authority', state)
    target.setAttribute('aria-busy', state === 'pending' ? 'true' : 'false')
    if (message) target.setAttribute('title', message)
    else if (typeof target.removeAttribute === 'function') target.removeAttribute('title')
  }

  async function waitForMemberstack() {
    for (var attempt = 0; attempt < 40; attempt += 1) {
      if (
        globalObject.$memberstackDom &&
        typeof globalObject.$memberstackDom.getMemberCookie === 'function'
      ) {
        return globalObject.$memberstackDom
      }
      await new Promise(function (resolve) {
        globalObject.setTimeout(resolve, 250)
      })
    }
    throw new Error('Memberstack session is unavailable')
  }

  async function xanoToken() {
    var memberstack = await waitForMemberstack()
    var memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw new Error('Sign in before you choose a plan')

    var response = await globalObject.fetch(AUTH_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: memberstackToken }),
    })
    var payload = await response.json().catch(function () {
      return null
    })
    var token =
      typeof payload === 'string'
        ? payload
        : payload && (payload.authToken || payload.token)
    if (!response.ok || !token) throw new Error('V3 session exchange failed')
    return token
  }

  async function registerIntent(route, priceId, eventId) {
    var token = await xanoToken()
    var response = await globalObject.fetch(REGISTER_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_event_id: eventId,
        source_route: route,
        stripe_price_id: priceId,
      }),
    })
    var payload = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error('V3 checkout could not be prepared')
    }
    return payload
  }

  function resumeNativeCheckout(target) {
    if (bypassTargets) bypassTargets.add(target)
    if (typeof target.click === 'function') target.click()
  }

  async function handleCheckout(event) {
    var target = checkoutTarget(event && event.target)
    if (!target) return
    if (bypassTargets && bypassTargets.has(target)) {
      bypassTargets.delete(target)
      return
    }

    var route = normalizedRoute(globalObject.location && globalObject.location.pathname)
    var priceId = clean(target.getAttribute(PRICE_ATTRIBUTE))
    if (!validSourceRoute(route) || !ALLOWED_PRICE_IDS[priceId]) return

    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation()
    }
    if (pendingTargets && pendingTargets.has(target)) return
    if (pendingTargets) pendingTargets.add(target)

    setControlState(target, 'pending', '')
    try {
      var identity = checkoutIdentity(route, priceId)
      await registerIntent(identity.sourceRoute, priceId, identity.eventId)
      setControlState(target, 'accepted', '')
      resumeNativeCheckout(target)
    } catch (error) {
      setControlState(
        target,
        'error',
        (error && error.message) || 'V3 checkout could not be prepared',
      )
    } finally {
      if (pendingTargets) pendingTargets.delete(target)
    }
  }

  function boot() {
    var host = clean(globalObject.location && globalObject.location.hostname).toLowerCase()
    var route = normalizedRoute(globalObject.location && globalObject.location.pathname)
    if (!ALLOWED_HOSTS[host] || !validSourceRoute(route)) return false
    globalObject.document.addEventListener('click', handleCheckout, true)
    return true
  }

  globalObject.StartersMembershipCheckoutAuthority = {
    boot: boot,
    handleCheckout: handleCheckout,
    registerIntent: registerIntent,
  }

  boot()
})(typeof window !== 'undefined' ? window : null)
