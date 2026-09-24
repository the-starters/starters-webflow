/**
 * Shared authenticated TalkJS Classic session owner.
 *
 * The browser never selects the TalkJS identity that Xano signs. This helper
 * exchanges the current Memberstack session for a user_v3 bearer, requests a
 * short-lived TalkJS user token, verifies the public JWT claims, and creates
 * one Talk.Session for the exact signed-in member.
 *
 * Optional configuration belongs on the helper script element:
 *   data-starters-talkjs-auth
 *   data-environment="test|production" (localhost QA only)
 *
 * Tokens remain only in closures. They are never written to storage, the DOM,
 * URLs, logs, analytics, or the public debug snapshot.
 */
;(function () {
  'use strict'

  if (window.StartersTalkJsSessionOwner) return

  var XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  var DEFAULT_TOKEN_URL =
    XANO_ORIGIN + '/api:tCpV3oqd/talkjs/user-token/v3'
  var DEFAULT_CONVERSATION_URL =
    XANO_ORIGIN + '/api:tCpV3oqd/talkjs/conversation/v3'
  var MEMBER_ID_PATTERN = /^mem_(?:sb_)?[A-Za-z0-9]+$/
  var CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_:.|~-]{1,1024}$/
  var CLIENT_OWNERS = {
    'messages-v3': true,
    'messages-profile-v3': true,
    'dashboard-messages-v3': true,
  }
  var TRANSIENT_STATUSES = { 408: true, 425: true, 429: true }
  var MAX_ATTEMPTS = 2
  var MAX_TOKEN_TTL_SECONDS = 600
  var MAX_IDENTITY_ATTEMPTS = 3
  var IDENTITY_RETRY_DELAY_MS = 25

  var active = null
  var pending = null
  var generation = 0
  var wiredMemberstack = null

  function scriptConfig() {
    var script = document.querySelector('script[data-starters-talkjs-auth]')
    return {
      tokenUrl: DEFAULT_TOKEN_URL,
      conversationUrl: DEFAULT_CONVERSATION_URL,
      environment:
        (script && script.getAttribute('data-environment')) || '',
    }
  }

  function expectedEnvironment(memberId, configuredEnvironment) {
    var host = String((window.location && window.location.hostname) || '')
      .trim()
      .toLowerCase()
    var environment = ''
    if (host === 'the-starters-3-0.webflow.io') environment = 'test'
    if (
      host === 'thestarters.com' ||
      host === 'www.thestarters.com' ||
      host === 'hirethestarters.com' ||
      host === 'www.hirethestarters.com'
    ) {
      environment = 'production'
    }
    if (
      !environment &&
      (host === 'localhost' || host === '127.0.0.1') &&
      (configuredEnvironment === 'test' || configuredEnvironment === 'production')
    ) {
      environment = configuredEnvironment
    }
    if (!environment) throw identityError('Unsupported TalkJS client origin')
    var isTestMember = String(memberId).indexOf('mem_sb_') === 0
    if ((environment === 'test') !== isTestMember) {
      throw identityError('Member environment does not match this page')
    }
    return environment
  }

  function identityError(message) {
    var error = new Error(message)
    error.code = 'TALKJS_IDENTITY_MISMATCH'
    return error
  }

  function authenticationError(message) {
    var error = new Error(message)
    error.code = 'TALKJS_AUTHENTICATION_FAILED'
    return error
  }

  function responseError(message, status) {
    var error = new Error(message)
    error.status = status || 0
    return error
  }

  function memberFromResponse(response) {
    return response && (response.data || response.member || response)
  }

  async function currentMember(memberstack) {
    if (!memberstack || typeof memberstack.getCurrentMember !== 'function') {
      throw authenticationError('Memberstack is unavailable')
    }
    var member = memberFromResponse(await memberstack.getCurrentMember())
    if (!member || !MEMBER_ID_PATTERN.test(String(member.id || ''))) {
      throw authenticationError('No authenticated Memberstack member')
    }
    return member
  }

  async function currentSessionCookie(memberstack) {
    if (!memberstack || typeof memberstack.getMemberCookie !== 'function') {
      throw authenticationError('Memberstack session is unavailable')
    }
    var cookie = await memberstack.getMemberCookie()
    if (!cookie) throw authenticationError('No authenticated Memberstack session')
    return cookie
  }

  function meId(me) {
    var value = me && (me.id || (me.fields && me.fields.id))
    return value === undefined || value === null ? '' : String(value)
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms)
    })
  }

  async function stableIdentity(memberstack, memberId) {
    var confirmedCookie = null
    for (var attempt = 0; attempt < MAX_IDENTITY_ATTEMPTS; attempt += 1) {
      try {
        var beforeCookie = await memberstack.getMemberCookie()
        if (!beforeCookie) return { status: 'logout' }
        var member = await currentMember(memberstack)
        var afterCookie = await memberstack.getMemberCookie()
        if (!afterCookie) return { status: 'logout' }
        if (beforeCookie === afterCookie) {
          if (member.id !== memberId) return { status: 'changed' }
          if (confirmedCookie === afterCookie) {
            return { status: 'same', cookie: afterCookie }
          }
          confirmedCookie = afterCookie
        } else {
          confirmedCookie = null
        }
      } catch (error) {}
      if (attempt + 1 < MAX_IDENTITY_ATTEMPTS) {
        await wait(IDENTITY_RETRY_DELAY_MS)
      }
    }
    return { status: 'unresolved' }
  }

  function addReconnect(target, owner, reconnect) {
    if (typeof reconnect === 'function') target[owner] = reconnect
  }

  function addInvalidator(target, owner, invalidate) {
    if (typeof invalidate === 'function') target[owner] = invalidate
  }

  async function reconnectViews(reconnectors) {
    var owners = Object.keys(reconnectors)
    for (var index = 0; index < owners.length; index += 1) {
      try {
        await reconnectors[owners[index]]()
      } catch (error) {}
    }
  }

  async function invalidateViews(invalidators) {
    var owners = Object.keys(invalidators)
    for (var index = 0; index < owners.length; index += 1) {
      try {
        await invalidators[owners[index]]()
      } catch (error) {}
    }
  }

  function decodePart(value) {
    var base64 = String(value).replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4) base64 += '='
    return JSON.parse(window.atob(base64))
  }

  function decodeAndValidateToken(receipt, memberId, environment, nowSeconds) {
    if (!receipt || typeof receipt.token !== 'string') {
      throw authenticationError('TalkJS token response is missing')
    }
    var parts = receipt.token.split('.')
    if (parts.length !== 3) throw authenticationError('TalkJS token is malformed')
    var header
    var payload
    try {
      header = decodePart(parts[0])
      payload = decodePart(parts[1])
    } catch (error) {
      throw authenticationError('TalkJS token claims are malformed')
    }
    var expiresIn = Number(receipt.expires_in_seconds)
    var remaining = Number(payload.exp) - nowSeconds
    if (
      header.alg !== 'HS256' ||
      payload.tokenType !== 'user' ||
      !payload.iss ||
      payload.sub !== memberId ||
      receipt.me_id !== memberId ||
      receipt.data_environment !== environment ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0 ||
      expiresIn > MAX_TOKEN_TTL_SECONDS ||
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > MAX_TOKEN_TTL_SECONDS
    ) {
      throw identityError('TalkJS token does not match the authenticated member')
    }
    return {
      token: receipt.token,
      appId: String(payload.iss),
      expiresAt: Number(payload.exp),
    }
  }

  async function xanoBearer(memberstack, forceRefresh) {
    if (typeof window.getXanoAuthToken !== 'function') {
      throw authenticationError('Xano authentication bridge is unavailable')
    }
    var sharedToken = await window.getXanoAuthToken({
      forceRefresh: Boolean(forceRefresh),
    })
    if (!sharedToken) throw authenticationError('Xano bearer is unavailable')
    return sharedToken
  }

  async function assertExpectedIdentity(memberstack, memberId, cookie) {
    var beforeCookie = await memberstack.getMemberCookie()
    var member = await currentMember(memberstack)
    var afterCookie = await memberstack.getMemberCookie()
    if (
      !cookie ||
      beforeCookie !== cookie ||
      afterCookie !== cookie ||
      member.id !== memberId
    ) {
      throw identityError('Member changed before authenticated request')
    }
  }

  async function validateCapturedIdentity(identity, expectedOwner) {
    if (expectedOwner && active !== expectedOwner) {
      throw identityError('TalkJS session is no longer current')
    }
    try {
      await assertExpectedIdentity(
        identity.memberstack,
        identity.memberId,
        identity.memberstackCookie,
      )
    } catch (error) {
      if (expectedOwner) {
        await destroyAndInvalidate('member-change', expectedOwner)
      }
      throw error
    }
    if (expectedOwner && active !== expectedOwner) {
      throw identityError('TalkJS session is no longer current')
    }
  }

  async function xanoRequest(
    memberstack,
    url,
    init,
    forceRefresh,
    identity,
    expectedOwner,
  ) {
    var response
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      var bearer = await xanoBearer(
        memberstack,
        forceRefresh || attempt > 0,
      )
      await validateCapturedIdentity(identity, expectedOwner)
      response = await window.fetch(
        url,
        Object.assign({}, init, {
          headers: Object.assign({}, init.headers, {
            Authorization: 'Bearer ' + bearer,
          }),
        }),
      )
      await validateCapturedIdentity(identity, expectedOwner)
      if (response.status !== 401 || attempt + 1 >= MAX_ATTEMPTS) return response
    }
    return response
  }

  function transient(error) {
    return (
      !error.status ||
      TRANSIENT_STATUSES[error.status] ||
      (error.status >= 500 && error.status <= 599)
    )
  }

  async function requestToken(options) {
    var lastError
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        var before = await currentMember(options.memberstack)
        if (before.id !== options.memberId) {
          throw identityError('Member changed before TalkJS token refresh')
        }
        var response = await xanoRequest(options.memberstack, options.tokenUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: '{}',
          credentials: 'omit',
        }, attempt > 0, options, options.ownerState)
        var body = await response.json().catch(function () {
          return null
        })
        if (!response.ok) {
          throw responseError('TalkJS token request failed', response.status)
        }
        var after = await currentMember(options.memberstack)
        if (after.id !== options.memberId) {
          throw identityError('Member changed during TalkJS token refresh')
        }
        return decodeAndValidateToken(
          body,
          options.memberId,
          options.environment,
          Math.floor(Date.now() / 1000),
        )
      } catch (error) {
        lastError = error
        if (
          error.code === 'TALKJS_IDENTITY_MISMATCH' ||
          error.code === 'TALKJS_AUTHENTICATION_FAILED' ||
          !transient(error) ||
          attempt + 1 >= MAX_ATTEMPTS
        ) {
          throw error
        }
      }
    }
    throw lastError
  }

  function exactParticipantPair(participantIds, actorId, counterpartId) {
    if (!Array.isArray(participantIds) || participantIds.length !== 2) return false
    if (participantIds[0] === participantIds[1]) return false
    return (
      participantIds.indexOf(actorId) !== -1 &&
      participantIds.indexOf(counterpartId) !== -1
    )
  }

  /**
   * Ask Xano to resolve or provision one server-owned two-person conversation.
   * The browser supplies an intent only. It never supplies its actor identity,
   * creates a TalkJS conversation, or changes TalkJS participants.
   */
  async function authorizeConversation(options) {
    options = options || {}
    if (!active) throw authenticationError('No authenticated TalkJS session')
    if (!CLIENT_OWNERS[options.clientOwner]) {
      throw identityError('Unknown TalkJS client owner')
    }
    if (!active.clientOwners[options.clientOwner]) {
      throw identityError('TalkJS client does not own the active session')
    }

    var owned = active
    var member = await currentMember(owned.memberstack)
    if (member.id !== owned.memberId) {
      await destroyAndInvalidate('member-change', owned)
      throw identityError('Member changed before conversation authorization')
    }

    var counterpartId = String(options.counterpartId || '')
    var conversationId = String(options.conversationId || '')
    var pairMode = counterpartId !== ''
    var existingMode = conversationId !== ''
    if (pairMode === existingMode) {
      throw identityError('One conversation intent is required')
    }
    if (
      pairMode &&
      (!MEMBER_ID_PATTERN.test(counterpartId) || counterpartId === active.memberId)
    ) {
      throw identityError('Conversation counterpart is invalid')
    }
    if (existingMode && !CONVERSATION_ID_PATTERN.test(conversationId)) {
      throw identityError('Conversation id is invalid')
    }

    var config = scriptConfig()
    var body = pairMode
      ? { mode: 'pair', counterpart_id: counterpartId }
      : { mode: 'existing', conversation_id: conversationId }
    var response = await xanoRequest(owned.memberstack, config.conversationUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      credentials: 'omit',
    }, false, owned, owned)
    var receipt = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw responseError('TalkJS conversation authorization failed', response.status)
    }

    var after = await currentMember(owned.memberstack)
    if (active !== owned || after.id !== owned.memberId) {
      await destroyAndInvalidate('member-change', owned)
      throw identityError('Member changed during conversation authorization')
    }
    var returnedConversationId = String(
      (receipt && receipt.conversation_id) || '',
    )
    var returnedCounterpartId = String(
      (receipt && receipt.counterpart_id) || '',
    )
    if (
      !receipt ||
      receipt.authorized !== true ||
      receipt.actor_id !== owned.memberId ||
      receipt.data_environment !== owned.environment ||
      !CONVERSATION_ID_PATTERN.test(returnedConversationId) ||
      !MEMBER_ID_PATTERN.test(returnedCounterpartId) ||
      !exactParticipantPair(
        receipt.participant_ids,
        owned.memberId,
        returnedCounterpartId,
      ) ||
      (pairMode && returnedCounterpartId !== counterpartId) ||
      (existingMode && returnedConversationId !== conversationId)
    ) {
      throw identityError(
        'Conversation receipt does not match the authenticated member',
      )
    }
    return {
      conversationId: returnedConversationId,
      counterpartId: returnedCounterpartId,
    }
  }

  function destroy(reason) {
    generation += 1
    var owned = active
    active = null
    pending = null
    if (owned && owned.session && typeof owned.session.destroy === 'function') {
      try {
        owned.session.destroy()
      } catch (error) {}
    }
    return reason || 'destroyed'
  }

  async function destroyAndInvalidate(reason, expectedOwner) {
    if (expectedOwner && active !== expectedOwner) return
    var invalidators = active ? active.invalidators : {}
    destroy(reason)
    await invalidateViews(invalidators)
  }

  function captureIdentityGuard(clientOwner) {
    if (!active) throw authenticationError('No authenticated TalkJS session')
    if (!active.clientOwners[clientOwner]) {
      throw identityError('TalkJS client does not own the active session')
    }
    var owned = active
    return function () {
      return validateCapturedIdentity(owned, owned)
    }
  }

  function reconnectPending(opening) {
    Promise.resolve(opening.promise)
      .catch(function () {})
      .then(function () {
        return wait(0)
      })
      .then(function () {
        return stableIdentity(opening.memberstack, opening.memberId)
      })
      .then(function (identity) {
        if (identity.status === 'same') {
          return reconnectViews(opening.reconnectors)
        }
      })
      .catch(function () {})
  }

  async function reconcileMemberstack() {
    var owned = active
    var opening = pending
    if (!owned && !opening) return
    var lifecycle = owned || opening
    var reconnectors = lifecycle.reconnectors
    var invalidators = lifecycle.invalidators
    var memberstack = lifecycle.memberstack
    var memberId = lifecycle.memberId
    destroy('auth-change')
    await invalidateViews(invalidators)
    if (!owned) {
      reconnectPending(opening)
      return
    }
    await wait(IDENTITY_RETRY_DELAY_MS)
    var identity = await stableIdentity(memberstack, memberId)
    if (identity.status === 'same') await reconnectViews(reconnectors)
  }

  function wireMemberstack(memberstack) {
    if (
      memberstack === wiredMemberstack ||
      !memberstack ||
      typeof memberstack.onAuthChange !== 'function'
    ) {
      return
    }
    wiredMemberstack = memberstack
    memberstack.onAuthChange(function () {
      return reconcileMemberstack()
    })
  }

  async function openSession(options) {
    options = options || {}
    if (!CLIENT_OWNERS[options.clientOwner]) {
      throw identityError('Unknown TalkJS client owner')
    }
    if (!options.Talk || typeof options.Talk.Session !== 'function') {
      throw new Error('TalkJS is unavailable')
    }
    var memberstackCookie = await currentSessionCookie(options.memberstack)
    var member = await currentMember(options.memberstack)
    var memberId = String(member.id)
    if (
      !options.member ||
      String(options.member.id || '') !== memberId ||
      meId(options.me) !== memberId
    ) {
      throw identityError('TalkJS client identity differs from Memberstack')
    }
    var config = scriptConfig()
    var environment = expectedEnvironment(memberId, config.environment)
    wireMemberstack(options.memberstack)

    if (active) {
      if (
        active.memberId !== memberId ||
        active.environment !== environment ||
        active.memberstackCookie !== memberstackCookie
      ) {
        await destroyAndInvalidate('foreign-client', active)
        throw identityError('A foreign TalkJS session was refused')
      }
      active.clientOwners[options.clientOwner] = true
      addReconnect(
        active.reconnectors,
        options.clientOwner,
        options.onReconnect,
      )
      addInvalidator(
        active.invalidators,
        options.clientOwner,
        options.onInvalidate,
      )
      return active.session
    }
    if (pending) {
      if (pending.memberId !== memberId || pending.environment !== environment) {
        throw identityError('A foreign TalkJS session opening was refused')
      }
      pending.clientOwners[options.clientOwner] = true
      addReconnect(
        pending.reconnectors,
        options.clientOwner,
        options.onReconnect,
      )
      addInvalidator(
        pending.invalidators,
        options.clientOwner,
        options.onInvalidate,
      )
      return pending.promise
    }

    var openingGeneration = generation
    var pendingState = {
      memberId: memberId,
      environment: environment,
      memberstack: options.memberstack,
      memberstackCookie: memberstackCookie,
      clientOwners: {},
      reconnectors: {},
      invalidators: {},
      promise: null,
    }
    pendingState.clientOwners[options.clientOwner] = true
    addReconnect(
      pendingState.reconnectors,
      options.clientOwner,
      options.onReconnect,
    )
    addInvalidator(
      pendingState.invalidators,
      options.clientOwner,
      options.onInvalidate,
    )
    pending = pendingState
    pendingState.promise = (async function () {
      var requestOptions = {
        memberstack: options.memberstack,
        memberId: memberId,
        memberstackCookie: memberstackCookie,
        environment: environment,
        tokenUrl: config.tokenUrl,
      }
      var initial = await requestToken(requestOptions)
      if (openingGeneration !== generation) {
        throw identityError('TalkJS session opening was superseded')
      }
      var identity = await stableIdentity(options.memberstack, memberId)
      if (openingGeneration !== generation) {
        throw identityError('TalkJS session opening was superseded')
      }
      if (
        identity.status !== 'same' ||
        identity.cookie !== pendingState.memberstackCookie
      ) {
        throw identityError('TalkJS session opening was superseded')
      }
      var initialToken = initial.token
      var expectedAppId = initial.appId
      var sessionOwnerState = null
      var tokenFetcher = async function () {
        if (openingGeneration !== generation) {
          throw identityError('TalkJS session is no longer current')
        }
        if (initialToken) {
          var token = initialToken
          initialToken = null
          return token
        }
        try {
          requestOptions.ownerState = sessionOwnerState
          var refreshed = await requestToken(requestOptions)
          if (refreshed.appId !== expectedAppId) {
            throw identityError('TalkJS application changed during refresh')
          }
          if (openingGeneration !== generation) {
            throw identityError('TalkJS refresh was superseded')
          }
          return refreshed.token
        } catch (error) {
          await destroyAndInvalidate('refresh-failed', sessionOwnerState)
          throw error
        }
      }
      var session = new options.Talk.Session({
        appId: expectedAppId,
        me: options.me,
        tokenFetcher: tokenFetcher,
      })
      active = {
        session: session,
        memberstack: options.memberstack,
        memberId: memberId,
        appId: expectedAppId,
        environment: environment,
        memberstackCookie: identity.cookie,
        clientOwners: pendingState.clientOwners,
        reconnectors: pendingState.reconnectors,
        invalidators: pendingState.invalidators,
      }
      sessionOwnerState = active
      return session
    })()

    try {
      return await pendingState.promise
    } finally {
      if (pending === pendingState) pending = null
    }
  }

  function debugSnapshot() {
    if (!active) return null
    return {
      appId: active.appId,
      memberId: active.memberId,
      environment: active.environment,
      clientOwners: Object.keys(active.clientOwners).sort(),
    }
  }

  window.StartersTalkJsSessionOwner = {
    openSession: openSession,
    authorizeConversation: authorizeConversation,
    captureIdentityGuard: captureIdentityGuard,
    destroy: destroy,
    debugSnapshot: debugSnapshot,
  }
})()
