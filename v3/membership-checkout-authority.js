/**
 * V3 membership checkout authority gate.
 * @release v1.59.674
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
  var RECEIPT_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/membership/checkout-receipt/v3'
  var RETURN_KEY = 'ts:v3:membership-checkout-return'
  var purchaseTask = null
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
  var logoutLoaderHolds = 0
  var logoutLoaderOriginalVisibility = ''

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
      route === '/why-us' ||
      route === '/become-a-starter' ||
      route === '/case-studies' ||
      route === '/learn'
    ) {
      return true
    }
    if (/^\/learn(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(route)) return true
    if (/^\/case-studies\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route)) return true
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

  function checkoutVisuals(target) {
    var spinner =
      typeof target.querySelector === 'function'
        ? target.querySelector('[data-button-spinner]')
        : null
    var spinnerDisplay = spinner && spinner.style ? spinner.style.display : null
    var loading = target.getAttribute('data-opp-loading')
    var documentObject = globalObject.document
    var logoutLoader =
      documentObject && typeof documentObject.querySelector === 'function'
        ? documentObject.querySelector('[data-ms-action="logout"] [data-ms-loader]')
        : null
    if (spinner && spinner.style) spinner.style.display = 'flex'
    target.setAttribute('data-opp-loading', 'true')
    if (logoutLoader && logoutLoader.style) {
      if (logoutLoaderHolds === 0) {
        logoutLoaderOriginalVisibility = logoutLoader.style.visibility
      }
      logoutLoaderHolds += 1
      logoutLoader.style.visibility = 'hidden'
    }

    var restored = false
    return {
      logoutLoader: logoutLoader,
      restore: function () {
        if (restored) return
        restored = true
        if (spinner && spinner.style) spinner.style.display = spinnerDisplay
        if (loading === null) target.removeAttribute('data-opp-loading')
        else target.setAttribute('data-opp-loading', loading)
        if (logoutLoader && logoutLoader.style && logoutLoaderHolds > 0) {
          logoutLoaderHolds -= 1
          if (logoutLoaderHolds === 0) {
            logoutLoader.style.visibility = logoutLoaderOriginalVisibility
          }
        }
      },
    }
  }

  function releaseLogoutLoaderHold() {
    if (logoutLoaderHolds === 0) return
    var documentObject = globalObject.document
    var logoutLoader =
      documentObject && typeof documentObject.querySelector === 'function'
        ? documentObject.querySelector('[data-ms-action="logout"] [data-ms-loader]')
        : null
    logoutLoaderHolds = 0
    if (logoutLoader && logoutLoader.style) {
      logoutLoader.style.visibility = logoutLoaderOriginalVisibility
    }
  }

  function isRealMemberstackAction(node) {
    if (!node || typeof node.closest !== 'function') return false
    return !!node.closest(
      '[data-ms-action="logout"], [data-ms-form], [data-ms-action="profile"]',
    )
  }

  function handleNativeActionRelease(event) {
    if (isRealMemberstackAction(event && event.target)) releaseLogoutLoaderHold()
  }

  function followNativeLoader(visuals) {
    var loader = visuals.logoutLoader
    if (!loader || !loader.style || typeof globalObject.MutationObserver !== 'function') {
      globalObject.setTimeout(visuals.restore, 3000)
      return
    }
    var seen = !!loader.style.display && loader.style.display !== 'none'
    var finished = false
    var startTimer
    var limitTimer
    var observer = new globalObject.MutationObserver(function () {
      if (loader.style.display && loader.style.display !== 'none') seen = true
      else if (seen) finish()
    })
    function finish() {
      if (finished) return
      finished = true
      observer.disconnect()
      globalObject.clearTimeout(startTimer)
      globalObject.clearTimeout(limitTimer)
      visuals.restore()
    }
    observer.observe(loader, { attributes: true, attributeFilter: ['style'] })
    startTimer = globalObject.setTimeout(function () {
      if (!seen) finish()
    }, 3000)
    limitTimer = globalObject.setTimeout(finish, 2 * 60 * 1000)
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

  function resumeNativeCheckout(target, clickedNode) {
    if (bypassTargets) bypassTargets.add(target)
    var replayTarget =
      clickedNode && typeof clickedNode.click === 'function' ? clickedNode : target
    if (typeof replayTarget.click === 'function') replayTarget.click()
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

    var visuals = checkoutVisuals(target)
    setControlState(target, 'pending', '')
    try {
      var session = await authenticatedSession()
      var identity = checkoutIdentity(route, priceId, session.memberId)
      var accepted = await registerIntent(identity.sourceRoute, priceId, identity.eventId, session.token)
      rememberAcceptedIntent(priceId, session.memberId, accepted)
      var confirmedResult = await session.memberstack.getCurrentMember()
      var confirmedMember =
        confirmedResult && confirmedResult.data ? confirmedResult.data : confirmedResult
      if (clean(confirmedMember && confirmedMember.id) !== session.memberId) {
        throw new Error('Your signed-in account changed. Refresh and try again')
      }
      setControlState(target, 'accepted', '')
      resumeNativeCheckout(target, event && event.target)
      followNativeLoader(visuals)
    } catch (error) {
      visuals.restore()
      setControlState(
        target,
        'error',
        (error && error.message) || 'V3 checkout could not be prepared',
      )
    } finally {
      if (pendingTargets) pendingTargets.delete(target)
    }
  }

  function readStored(key) {
    try {
      return JSON.parse(globalObject.sessionStorage.getItem(key) || 'null')
    } catch (_error) {
      return null
    }
  }

  function rememberAcceptedIntent(priceId, memberId, accepted) {
    try {
      var record = readStored(storageKey(priceId))
      if (!record || record.memberId !== memberId || !/^[a-f0-9]{64}$/.test(accepted.intent_key)) return
      record.intentKey = accepted.intent_key
      // The server expiry wins when a pending intent was coalesced across tabs.
      record.expiresAt = Math.min(record.expiresAt, (typeof accepted.expires_at === 'number' ? accepted.expires_at : Date.parse(accepted.expires_at)))
      if (!Number.isFinite(record.expiresAt)) return
      globalObject.sessionStorage.setItem(storageKey(priceId), JSON.stringify(record))
    } catch (_error) {
      // Analytics storage must not prevent an otherwise accepted checkout.
    }
  }

  function returnRoute() {
    return ['/dashboard', '/brand-dashboard', '/complete-profile', '/all-starters'].indexOf(
      normalizedRoute(globalObject.location && globalObject.location.pathname),
    ) !== -1
  }

  function captureCheckoutReturn() {
    if (!returnRoute()) return
    try {
      var params = new globalObject.URLSearchParams(globalObject.location.search || '')
      if (params.get('fromCheckout') !== 'true') return
      var priceId = params.get('msPriceId')
      if (!ALLOWED_PRICE_IDS[priceId]) return
      var intent = readStored(storageKey(priceId))
      if (!intent || !/^[a-f0-9]{64}$/.test(intent.intentKey) || intent.expiresAt <= Date.now()) return
      globalObject.sessionStorage.setItem(RETURN_KEY, JSON.stringify({
        intentKey: intent.intentKey,
        memberId: intent.memberId,
        priceId: priceId,
        expiresAt: intent.expiresAt,
      }))
    } catch (_error) {}
  }

  function purchaseState(state) {
    var root = globalObject.document && globalObject.document.documentElement
    if (root && typeof root.setAttribute === 'function') {
      root.setAttribute('data-v3-membership-purchase', state)
    }
  }

  function clearCheckoutReturn(record) {
    var current = readStored(RETURN_KEY)
    if (current && current.intentKey === record.intentKey) {
      globalObject.sessionStorage.removeItem(RETURN_KEY)
    }
    var intent = readStored(storageKey(record.priceId))
    if (intent && intent.intentKey === record.intentKey) {
      globalObject.sessionStorage.removeItem(storageKey(record.priceId))
    }
    var params = new globalObject.URLSearchParams(globalObject.location.search || '')
    if (params.get('fromCheckout') === 'true' && params.get('msPriceId') === record.priceId) {
      params.delete('fromCheckout')
      params.delete('msPriceId')
      params.delete('stripePriceId')
      var query = params.toString()
      globalObject.history.replaceState(globalObject.history.state, '',
        globalObject.location.pathname + (query ? '?' + query : '') + (globalObject.location.hash || ''))
    }
  }

  async function delay(ms) {
    await new Promise(function (resolve) { globalObject.setTimeout(resolve, ms) })
  }

  async function readCheckoutReceipt(record, token) {
    var controller = new globalObject.AbortController()
    var timer = globalObject.setTimeout(function () { controller.abort() }, 12000)
    try {
      var response = await globalObject.fetch(RECEIPT_URL, {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent_key: record.intentKey, stripe_price_id: record.priceId }),
      })
      var payload = await response.json()
      if (!response.ok || !payload || payload.ok !== true) throw new Error('Receipt unavailable')
      return payload
    } finally {
      globalObject.clearTimeout(timer)
    }
  }

  async function processCheckoutReturn() {
    var host = clean(globalObject.location && globalObject.location.hostname).toLowerCase()
    if (!ALLOWED_HOSTS[host] || !returnRoute()) return
    var record = readStored(RETURN_KEY)
    if (!record || !/^[a-f0-9]{64}$/.test(record.intentKey) ||
        !ALLOWED_PRICE_IDS[record.priceId] || !(record.expiresAt > Date.now())) return
    purchaseState('verifying')
    try {
      var session = await authenticatedSession()
      if (session.memberId !== record.memberId) throw new Error('Checkout member changed')
      var expectedEnvironment = host === 'the-starters-3-0.webflow.io' ? 'test' : 'production'
      if ((session.memberId.indexOf('mem_sb_') === 0) !== (expectedEnvironment === 'test')) {
        throw new Error('Checkout environment mismatch')
      }
      var receipt
      for (var attempt = 0; attempt < 12; attempt += 1) {
        if (!(record.expiresAt > Date.now())) throw new Error('Checkout expired')
        receipt = await readCheckoutReceipt(record, session.token)
        if (receipt.status !== 'pending') break
        await delay(2500)
      }
      if (receipt.status === 'pending') {
        purchaseState('pending')
        return
      }
      if (receipt.status !== 'paid' || receipt.intent_key !== record.intentKey ||
          receipt.stripe_price_id !== record.priceId || receipt.source_environment !== expectedEnvironment ||
          !/^cs_(?:test_|live_)[a-zA-Z0-9]+$/.test(receipt.transaction_id) ||
          typeof receipt.amount_total !== 'number' || !Number.isSafeInteger(receipt.amount_total) ||
          receipt.amount_total < 0 || (receipt.amount_total === 0 && receipt.fully_discounted !== true) ||
          receipt.currency !== 'USD') {
        throw new Error('Checkout receipt is invalid')
      }
      var confirmed = await session.memberstack.getCurrentMember()
      var member = confirmed && confirmed.data ? confirmed.data : confirmed
      if (clean(member && member.id) !== record.memberId) throw new Error('Checkout member changed')
      if (expectedEnvironment === 'test') {
        purchaseState('test-verified')
        clearCheckoutReturn(record)
        return
      }
      if (receipt.transaction_id.indexOf('cs_live_') !== 0) throw new Error('Checkout mode mismatch')
      for (var pixelAttempt = 0; pixelAttempt < 40 && typeof globalObject.fbq !== 'function'; pixelAttempt += 1) {
        await delay(250)
      }
      if (typeof globalObject.fbq !== 'function') throw new Error('Pixel unavailable')
      if (!globalObject.navigator || !globalObject.navigator.locks) throw new Error('Purchase lock unavailable')
      await globalObject.navigator.locks.request('ts:v3:membership-purchase:' + receipt.transaction_id, async function () {
        // Recheck inside the cross-tab lock after all asynchronous readiness work.
        var result = await session.memberstack.getCurrentMember()
        var active = result && result.data ? result.data : result
        if (clean(active && active.id) !== record.memberId) throw new Error('Checkout member changed')
        var key = 'ts:v3:membership-purchase:' + receipt.transaction_id
        if (globalObject.localStorage.getItem(key)) {
          purchaseState('already-sent')
        } else {
          globalObject.localStorage.setItem(key, 'queued')
          if (globalObject.localStorage.getItem(key) !== 'queued') throw new Error('Purchase storage unavailable')
          try {
            globalObject.fbq('trackSingle', '775648331097942', 'Purchase', {
              value: receipt.amount_total / 100,
              currency: receipt.currency,
              content_ids: [record.priceId],
              content_name: 'The Starters Membership',
              content_type: 'product',
            }, { eventID: receipt.transaction_id })
          } catch (error) {
            globalObject.localStorage.removeItem(key)
            throw error
          }
          purchaseState('queued')
        }
        clearCheckoutReturn(record)
      })
    } catch (_error) {
      purchaseState('unverified')
    }
  }

  function resumeCheckoutReturn() {
    if (!purchaseTask) purchaseTask = processCheckoutReturn()
    return purchaseTask
  }

  function boot() {
    var host = clean(globalObject.location && globalObject.location.hostname).toLowerCase()
    if (!ALLOWED_HOSTS[host]) return false
    captureCheckoutReturn()
    resumeCheckoutReturn()
    // Memberstack also binds a capture listener on document. Bind one level
    // earlier so the V3 authority row is committed before Memberstack can open
    // Stripe checkout, regardless of script load order.
    globalObject.addEventListener('click', handleCheckout, true)
    globalObject.addEventListener('click', handleNativeActionRelease, true)
    globalObject.addEventListener('submit', handleNativeActionRelease, true)
    return true
  }

  globalObject.StartersMembershipCheckoutAuthority = {
    boot: boot,
    handleCheckout: handleCheckout,
    registerIntent: registerIntent,
    resumeCheckoutReturn: resumeCheckoutReturn,
  }

  boot()
})(typeof window !== 'undefined' ? window : null)
