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
    var route = clean(value)
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

  function checkoutIdentity(route, priceId, memberId) {
    var key = storageKey(priceId)
    var existing = null
    try {
      existing = JSON.parse(clean(globalObject.sessionStorage.getItem(key)) || 'null')
    } catch (_error) {
      existing = null
    }
    var existingEventId = clean(existing && existing.eventId).toLowerCase()
    var existingRoute = normalizedRoute(existing && existing.sourceRoute)
    var existingExpiresAt = Number(existing && existing.expiresAt)
    var existingMemberId = clean(existing && existing.memberId)
    if (
      /^evt_[a-z0-9-]{8,116}$/.test(existingEventId) &&
      validSourceRoute(existingRoute) &&
      existingMemberId === memberId &&
      existingExpiresAt > Date.now()
    ) {
      return { eventId: existingEventId, sourceRoute: existingRoute }
    }
    var created = {
      eventId: randomEventId(),
      sourceRoute: route,
      memberId: memberId,
      expiresAt: Date.now() + INTENT_TTL_MS,
    }
    try {
      var serialized = JSON.stringify(created)
      globalObject.sessionStorage.setItem(key, serialized)
      if (globalObject.sessionStorage.getItem(key) !== serialized) {
        throw new Error('Checkout identity was not persisted')
      }
    } catch (_error) {
      throw new Error('Secure checkout identity storage is unavailable')
    }
    return { eventId: created.eventId, sourceRoute: created.sourceRoute }
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
        typeof globalObject.$memberstackDom.getMemberCookie === 'function' &&
        typeof globalObject.$memberstackDom.getCurrentMember === 'function'
      ) {
        return globalObject.$memberstackDom
      }
      await new Promise(function (resolve) {
        globalObject.setTimeout(resolve, 250)
      })
    }
    throw new Error('Memberstack session is unavailable')
  }

  async function authenticatedSession() {
    var memberstack = await waitForMemberstack()
    var memberResult = await memberstack.getCurrentMember()
    var member = memberResult && memberResult.data ? memberResult.data : memberResult
    var memberId = clean(member && member.id)
    if (!memberId) throw new Error('Sign in before you choose a plan')
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
    var confirmedResult = await memberstack.getCurrentMember()
    var confirmedMember =
      confirmedResult && confirmedResult.data ? confirmedResult.data : confirmedResult
    if (clean(confirmedMember && confirmedMember.id) !== memberId) {
      throw new Error('Your signed-in account changed. Refresh and try again')
    }
    return { memberId: memberId, memberstack: memberstack, token: token }
  }

  async function registerIntent(route, priceId, eventId, token) {
    if (!token) token = (await authenticatedSession()).token
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

    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation()
    }

    var route = normalizedRoute(globalObject.location && globalObject.location.pathname)
    var priceId = clean(target.getAttribute(PRICE_ATTRIBUTE))
    if (!validSourceRoute(route) || !ALLOWED_PRICE_IDS[priceId]) {
      setControlState(target, 'error', 'This checkout is not available from this V3 page')
      return
    }
    if (pendingTargets && pendingTargets.has(target)) return
    if (pendingTargets) pendingTargets.add(target)

    setControlState(target, 'pending', '')
    try {
      var session = await authenticatedSession()
      var identity = checkoutIdentity(route, priceId, session.memberId)
      await registerIntent(identity.sourceRoute, priceId, identity.eventId, session.token)
      var confirmedResult = await session.memberstack.getCurrentMember()
      var confirmedMember =
        confirmedResult && confirmedResult.data ? confirmedResult.data : confirmedResult
      if (clean(confirmedMember && confirmedMember.id) !== session.memberId) {
        throw new Error('Your signed-in account changed. Refresh and try again')
      }
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
    if (!ALLOWED_HOSTS[host]) return false
    // Memberstack also binds a capture listener on document. Bind one level
    // earlier so the V3 authority row is committed before Memberstack can open
    // Stripe checkout, regardless of script load order.
    globalObject.addEventListener('click', handleCheckout, true)
    return true
  }

  globalObject.StartersMembershipCheckoutAuthority = {
    boot: boot,
    handleCheckout: handleCheckout,
    registerIntent: registerIntent,
  }

  boot()
})(typeof window !== 'undefined' ? window : null)
