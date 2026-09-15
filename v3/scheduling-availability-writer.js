;(function () {
  'use strict'

  // Writer counterpart to scheduling-availability-init.js for the scheduling
  // Starter dashboards. Ports the legacy V2 availability
  // writer flow (form submit, manager selection, Nylas scheduler configuration
  // create/update, timezone set, OAuth grant redirect) against the same
  // Webflow `availability-step` markup, with the loader and success/error
  // steps restored. Every api:tCpV3oqd call goes through window.xanoAuthFetch;
  // write payload member ids always come from the authenticated Memberstack
  // session — never from query parameters, page markup, or cached page state.
  //
  // Deliberately NOT ported from the legacy inline writer:
  // - the hardcoded test member id and dashboard/onboarding redirects;
  // - the unscoped `starter-availability` localStorage key (replaced by the
  //   init module's member-scoped cache);
  // - the `dev-speed-test` localStorage payload override;
  // - the bookings list machinery (rendering is delegated to the page's
  //   bookings embed via guarded window.generateBookingsList). Disconnects
  //   stay owned by the authenticated grants/delete/v3 composite route.

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const STAGING_OAUTH_PATH = '/starter-dashboard---availability-stage'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const PRODUCTION_PATH = '/starter-dashboard'
  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const API_BASE = XANO_ORIGIN + '/api:tCpV3oqd'
  const STATUS_ATTRIBUTE = 'data-scheduling-availability-writer'
  const CONNECTION_STATUS_ATTRIBUTE = 'data-scheduling-calendar-state'
  const TEST_MEMBER_ATTRIBUTE = 'data-scheduling-test-member'
  // Shared with scheduling-availability-init.js so a successful write
  // refreshes what the initializer renders on the next load.
  const CACHE_PREFIX = 'starter-scheduling-availability:'
  const TIMEZONE_CACHE_PREFIX = 'starter-timezone:'
  const OAUTH_INTENT_PREFIX = 'starter-scheduling-oauth-intent:'
  const OAUTH_CALLBACK_KEY = 'starter-scheduling-oauth-callback'
  const OAUTH_INTENT_MAX_AGE = 15 * 60 * 1000
  const PRODUCTION_MIN_BOOKING_NOTICE_MINUTES = 24 * 60
  const STAGING_MIN_BOOKING_NOTICE_MINUTES = 5
  // A stored paid-call rate the whole-dollar contract rejects stops the transition
  // before the irreversible provider request. That is a repairable Call Settings
  // problem, not a connection failure, so the authored error step must name the
  // rate instead of leaving the member with generic calendar copy.
  const PAID_CALL_RATE_UNSUPPORTED = 'PAID_CALL_RATE_UNSUPPORTED'
  const ERROR_TEXT_PAID_CALL_RATE =
    'Your paid call rate must be a whole-dollar amount from $1 to $1,000. Update it in Call Settings, then switch calendars again.'

  const activePath = window.location.pathname.replace(/\/+$/, '') || '/'
  const activeHostname = String(window.location.hostname || '').trim().toLowerCase()
  const isStagingHost = activeHostname === STAGING_HOST
  const isApprovedProductionPath =
    PRODUCTION_HOSTS.has(activeHostname) && activePath === PRODUCTION_PATH
  if (!isStagingHost && !isApprovedProductionPath) return
  // The staging-host gate above has no path restriction, so on
  // the-starters-3-0.webflow.io this writer would otherwise self-activate on
  // /starter-dashboard too — the same page as the new non-modal
  // "Dashboard / Calendar" section (scheduling-availability-section.js).
  // Both scripts would then race to capture and redeem the same one-time
  // Nylas OAuth ?code&state. Defer to the section script wherever its root
  // exists; this writer stays fully functional on --availability-stage,
  // which never carries that markup.
  if (document.querySelector('[data-availability-element="section"]')) return
  if (window.__tsSchedulingAvailabilityWriter) return
  window.__tsSchedulingAvailabilityWriter = true

  let sessionMemberId = null
  let memberFields = {}
  let availability = null
  let initialState = true
  let configs = []
  let grantId = null
  let grantEmail = null
  let grantCalendarId = null
  let activeManager = null
  let timezone = null
  let timezonePersisted = false
  let connectionError = false
  const oauthCallback = captureOAuthCallback()

  function minimumBookingNoticeMinutes() {
    return isStagingHost
      ? STAGING_MIN_BOOKING_NOTICE_MINUTES
      : PRODUCTION_MIN_BOOKING_NOTICE_MINUTES
  }

  function captureOAuthCallback() {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const grantId = params.get('grant_id')
    const hasError = Boolean(params.get('error') || params.get('error_code'))
    if (!code && !grantId && !hasError) {
      try {
        const raw = window.sessionStorage.getItem(OAUTH_CALLBACK_KEY)
        const stored = raw ? JSON.parse(raw) : null
        if (
          stored &&
          Number.isFinite(stored.capturedAt) &&
          Date.now() - stored.capturedAt >= 0 &&
          Date.now() - stored.capturedAt <= OAUTH_INTENT_MAX_AGE &&
          (stored.code || stored.grantId || stored.hasError)
        ) {
          stored.resumed = true
          stored.remainingQuery = window.location.search.replace(/^\?/, '')
          return stored
        }
        window.sessionStorage.removeItem(OAUTH_CALLBACK_KEY)
      } catch (error) {
        try {
          window.sessionStorage.removeItem(OAUTH_CALLBACK_KEY)
        } catch (storageError) {
          /* storage unavailable */
        }
      }
      return null
    }

    const callback = {
      code: code,
      grantId: grantId,
      state: params.get('state'),
      success: params.get('success'),
      hasError: hasError,
      capturedAt: Date.now(),
    }
    try {
      window.sessionStorage.setItem(OAUTH_CALLBACK_KEY, JSON.stringify(callback))
    } catch (error) {
      /* storage unavailable; the in-memory callback can still complete */
    }
    ;[
      'code',
      'grant_id',
      'email',
      'provider',
      'state',
      'success',
      'error',
      'error_description',
      'error_uri',
      'error_code',
    ].forEach(function (key) {
      params.delete(key)
    })
    const remainingQuery = params.toString()
    callback.remainingQuery = remainingQuery
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + (remainingQuery ? '?' + remainingQuery : ''),
    )
    return callback
  }

  function clearOAuthCallback() {
    try {
      window.sessionStorage.removeItem(OAUTH_CALLBACK_KEY)
    } catch (error) {
      /* storage unavailable */
    }
  }

  function qs(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function qsa(selector, scope) {
    return (scope || document).querySelectorAll(selector)
  }

  function setCalendarConnectCopy() {
    qsa('[config-manager]').forEach(function (manager) {
      const paragraphs = qsa('p', manager)
      const title = paragraphs[0]
      const body = paragraphs[1]
      if (manager.dataset.type === 'platform') {
        if (title) title.textContent = 'Use platform availability'
        if (body) {
          body.textContent =
            'Use your saved hours without checking conflicts in an external calendar.'
        }
      } else if (manager.dataset.type === 'calendar') {
        if (title) title.textContent = 'Connect Google Calendar'
        if (body) {
          body.textContent =
            'Check your real calendar for conflicts so brands only see times when you’re free.'
        }
      }
    })

    setManagerSubmitCopy(activeManager)

    const successStep = qs('[availability-step="success-calendar"]')
    if (successStep) {
      const headlines = qsa('.set-availability_success-headline', successStep)
      const savedTitle = headlines[0] && qs('.heading-style-h1', headlines[0])
      const savedParagraphs = headlines[0] ? qsa('p', headlines[0]) : []
      const savedBody = savedParagraphs[1]
      const connectTitle = headlines[1] && qs('.heading-style-h1', headlines[1])
      const connectParagraphs = headlines[1] ? qsa('p', headlines[1]) : []
      const connectBody = connectParagraphs[1]
      const connectButton = qs(
        '[availability-action-btn="pre-redirect"] .button_main-text',
        successStep,
      )

      if (savedTitle) savedTitle.textContent = 'Availability saved'
      if (savedBody) {
        savedBody.textContent =
          'Your hours are saved, but your calendar is not connected yet. Connect it before accepting call requests to prevent booking conflicts.'
      }
      if (connectTitle) connectTitle.textContent = 'Connect your Google Calendar'
      if (connectBody) {
        connectBody.textContent =
          'Connect Google Calendar to prevent booking conflicts. You’ll return here when setup is complete.'
      }
      if (connectButton) connectButton.textContent = 'Connect Google Calendar'
    }

    const redirectStep = qs('[availability-step="pre-redirect"]')
    if (redirectStep) {
      const redirectTitle = qs('.heading-style-h1', redirectStep)
      const redirectParagraphs = qsa('p', redirectStep)
      const redirectBody = redirectParagraphs[1]
      if (redirectTitle) redirectTitle.textContent = 'Opening Google Calendar…'
      if (redirectBody) {
        redirectBody.textContent =
          'Taking you to Google’s secure authorization page. Your availability is already saved.'
      }
    }
  }

  function setManagerSubmitCopy(manager) {
    const label =
      manager === 'calendar' ? 'Connect Google Calendar' : 'Use platform availability'
    qsa('[availability-action-btn="manager-submit"] .button_main-text').forEach(function (el) {
      el.textContent = label
    })
  }

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }))
  }

  function deriveCalendarConnectionState() {
    const hasGrant = Boolean(grantId)
    const hasCalendar = Boolean(grantCalendarId)
    const configurationCount = Array.isArray(configs) ? configs.length : 0
    if (connectionError) return 'error'
    if (hasGrant && hasCalendar && configurationCount > 0) return 'connected'
    if (
      hasGrant ||
      hasCalendar ||
      configurationCount > 0 ||
      (availability && availability.manager)
    ) {
      return 'reconnect'
    }
    return 'disconnected'
  }

  function publishCalendarConnectionState(forcedState) {
    const state = forcedState || deriveCalendarConnectionState()
    const detail = {
      state: state,
      hasGrant: Boolean(grantId),
      hasCalendar: Boolean(grantCalendarId),
      configurationCount: Array.isArray(configs) ? configs.length : 0,
      manager: (availability && availability.manager) || null,
    }
    document.documentElement.setAttribute(CONNECTION_STATUS_ATTRIBUTE, state)
    window.STARTER_SCHEDULING_CONNECTION = detail
    emit('starterSchedulingConnectionStateChanged', detail)
    return state
  }

  function publishCalendarConnectionError() {
    connectionError = true
    return publishCalendarConnectionState('error')
  }

  function memberScopeChangedError() {
    return Object.assign(new Error('Member session changed during write'), {
      code: 'MEMBER_SCOPE_CHANGED',
    })
  }

  async function currentMember(options) {
    const requireLive = Boolean(options && options.live)
    if (
      !requireLive &&
      window.memberReady &&
      typeof window.memberReady.then === 'function'
    ) {
      const member = await window.memberReady
      if (member && member.id) return member
    }
    const memberstack = window.$memberstackDom
    if (memberstack && typeof memberstack.getCurrentMember === 'function') {
      const result = await memberstack.getCurrentMember()
      const member = result && result.data
      if (member && member.id) return member
      throw new Error('No logged-in member')
    }
    throw new Error('No logged-in member')
  }

  // Writes never trust page state for identity: re-resolve the live session
  // and refuse to send if the member changed since the writer bootstrapped.
  async function writeMemberId() {
    const member = await currentMember({ live: true })
    if (!sessionMemberId || member.id !== sessionMemberId) {
      throw memberScopeChangedError()
    }
    return member.id
  }

  function oauthRedirectUri() {
    return isStagingHost
      ? 'https://' + STAGING_HOST + STAGING_OAUTH_PATH
      : 'https://' + window.location.hostname + PRODUCTION_PATH
  }

  function rememberOAuthIntent(memberId, redirectUri, paidCallIntent) {
    const intent = {
      createdAt: Date.now(),
      redirectUri: redirectUri,
      paidCallIntent: paidCallIntent || null,
    }
    return writeOAuthIntent(memberId, intent) ? intent : null
  }

  function oauthIntentStorages(storageNames) {
    const storages = []
    ;(storageNames || ['sessionStorage', 'localStorage']).forEach(function (storageName) {
      try {
        const storage = window[storageName]
        if (storage && !storages.includes(storage)) storages.push(storage)
      } catch (error) {
        /* storage unavailable */
      }
    })
    return storages
  }

  function writeOAuthIntent(memberId, intent) {
    const key = OAUTH_INTENT_PREFIX + memberId
    const value = JSON.stringify(intent)
    let stored = false
    oauthIntentStorages().forEach(function (storage) {
      try {
        storage.setItem(key, value)
        stored = true
      } catch (error) {
        /* storage unavailable */
      }
    })
    return stored
  }

  function readOAuthIntent(memberId, includeDurableFallback) {
    const redirectUri = oauthRedirectUri()
    const key = OAUTH_INTENT_PREFIX + memberId
    const storageNames = includeDurableFallback
      ? ['sessionStorage', 'localStorage']
      : ['sessionStorage']
    for (const storage of oauthIntentStorages(storageNames)) {
      try {
        const raw = storage.getItem(key)
        const intent = raw ? JSON.parse(raw) : null
        if (
          intent &&
          Number.isFinite(intent.createdAt) &&
          Date.now() - intent.createdAt >= 0 &&
          Date.now() - intent.createdAt <= OAUTH_INTENT_MAX_AGE &&
          intent.redirectUri === redirectUri
        ) {
          return intent
        }
        storage.removeItem(key)
      } catch (error) {
        try {
          storage.removeItem(key)
        } catch (storageError) {
          /* storage unavailable */
        }
      }
    }
    return isStagingHost ? { redirectUri: redirectUri, paidCallIntent: null } : null
  }

  function clearOAuthIntent(memberId) {
    const key = OAUTH_INTENT_PREFIX + memberId
    oauthIntentStorages().forEach(function (storage) {
      try {
        storage.removeItem(key)
      } catch (error) {
        /* storage unavailable */
      }
    })
  }

  function persistOAuthIntent(memberId, intent) {
    if (!Number.isFinite(intent.createdAt)) intent.createdAt = Date.now()
    if (!writeOAuthIntent(memberId, intent)) {
      throw new Error('OAuth transition could not be retained')
    }
    return intent
  }

  function invalidOAuthCallback(message) {
    return Object.assign(new Error(message), { code: 'OAUTH_CALLBACK_INVALID' })
  }

  async function xanoPost(path, payload) {
    if (typeof window.xanoAuthFetch !== 'function') {
      throw new Error('xanoAuthFetch is not available')
    }
    const response = await window.xanoAuthFetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data: data,
      })
    }
    return data
  }

  async function xanoGet(path) {
    if (typeof window.xanoAuthFetch !== 'function') {
      throw new Error('xanoAuthFetch is not available')
    }
    const response = await window.xanoAuthFetch(API_BASE + path, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data: data,
      })
    }
    return data
  }

  /* ------------------------------------------------------------------ */
  /* UI helpers (legacy step semantics)                                  */
  /* ------------------------------------------------------------------ */

  // Remembers the authored copy the first time the shared error step is revealed,
  // so every path that reveals it restores that copy and only a rate-aware caller
  // can replace it. Otherwise one transition's remediation message would still be
  // on screen for the next, unrelated failure.
  let authoredTransitionErrorCopy = null

  // Only a leaf the step authored as its copy may be written through. An element
  // holding markup of its own — an icon beside the text, a wrapper — is left alone
  // so the step is revealed exactly as authored rather than flattened into a
  // single text node for the rest of the session.
  function transitionErrorCopyLeaf(step) {
    const errorEl = step ? qs('[error-text-element]', step) : null
    if (!errorEl) return null
    const childElements = typeof errorEl.childElementCount === 'number'
      ? errorEl.childElementCount
      : (errorEl.children ? errorEl.children.length : 0)
    return childElements === 0 ? errorEl : null
  }

  function restoreTransitionErrorCopy(step) {
    const errorEl = transitionErrorCopyLeaf(step)
    if (!errorEl) return null
    if (authoredTransitionErrorCopy === null) authoredTransitionErrorCopy = errorEl.textContent
    errorEl.textContent = authoredTransitionErrorCopy
    return errorEl
  }

  function switchStep(step) {
    let stepElement = null
    qsa('[availability-step]').forEach(function (el) {
      if (el.getAttribute('availability-step') === step) {
        el.style.display = 'block'
        stepElement = el
      } else {
        el.style.display = 'none'
      }
    })
    if (step === 'config-request-error') restoreTransitionErrorCopy(stepElement)
    return stepElement
  }

  function showTransitionError(error) {
    const step = switchStep('config-request-error')
    if (!error || error.code !== PAID_CALL_RATE_UNSUPPORTED) return
    const errorEl = transitionErrorCopyLeaf(step)
    if (errorEl) errorEl.textContent = ERROR_TEXT_PAID_CALL_RATE
  }

  // Matches the page's shared `[data-custom-loader]` contract.
  function setLoader(state, wrapper) {
    const loader = qs('[data-custom-loader]', wrapper || undefined)
    if (!loader) return
    loader.setAttribute(
      'style',
      'display: flex; visibility: ' +
        (state ? 'visible' : 'hidden') +
        '; opacity: ' +
        (state ? 1 : 0) +
        '; pointer-events: ' +
        (state ? 'auto' : 'none') +
        ';',
    )
    if (!state) {
      setTimeout(function () {
        loader.style.display = 'none'
      }, 300)
    }
  }

  function showError(group) {
    if (!group) return
    group.classList.add('is-error')
    setTimeout(function () {
      group.classList.remove('is-error')
    }, 200)
    setTimeout(function () {
      group.classList.add('is-error')
    }, 400)
    setTimeout(function () {
      group.classList.remove('is-error')
    }, 600)
  }

  function toggleManagerSubmit(state) {
    qsa('[availability-action-btn="manager-submit"]').forEach(function (btn) {
      if (state) btn.classList.remove('disabled')
      else btn.classList.add('disabled')
    })
  }

  function bookingsWrapper(state) {
    qsa('[bookings-wrapper]').forEach(function (el) {
      el.style.display = state === 'show' ? 'flex' : 'none'
    })
  }

  function changeSubmitText(text) {
    const textEl = qs(
      '[availability-step="setup-form"] [availability-action-btn="submit"] [btn-text]',
    )
    if (textEl) textEl.textContent = text
  }

  function closeConfigPopup() {
    const close = qs('[availability-popup-close]')
    if (close) close.click()
  }

  function providerRequestSucceeded(result) {
    const status = Number(result && result.response && result.response.status)
    return Number.isFinite(status) && status >= 200 && status < 300
  }

  function showManagerActions() {
    const managerActions = qs('[config-manager-element]')
    if (!managerActions) return
    managerActions.style.display = 'flex'
    qsa('[change-manager-link]').forEach(function (btn) {
      btn.style.display = btn.dataset.type === availability.manager ? 'flex' : 'none'
    })
  }

  function daysAlias(days) {
    if (!days || !days.length) return { short: '', full: '' }
    const map = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const mapFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const sorted = Array.from(new Set(days)).sort(function (a, b) {
      return a - b
    })
    const ranges = []
    const rangesFull = []
    let start = sorted[0]
    let prev = sorted[0]
    for (let i = 1; i <= sorted.length; i++) {
      const curr = sorted[i]
      if (curr !== prev + 1) {
        if (start === prev) {
          ranges.push(map[start])
          rangesFull.push(mapFull[start])
        } else {
          ranges.push(map[start] + ' - ' + map[prev])
          rangesFull.push(mapFull[start] + ' - ' + mapFull[prev])
        }
        start = curr
      }
      prev = curr
    }
    return { short: ranges.join(', '), full: rangesFull.join(', ') }
  }

  /* ------------------------------------------------------------------ */
  /* Availability model                                                  */
  /* ------------------------------------------------------------------ */

  let overrides = []
  let cachedTemplate = null

  function renderAvail() {
    if (!cachedTemplate) cachedTemplate = qs('[availability-template]')
    const template = cachedTemplate
    const list = qs('[availability-list]')
    if (!template || !list) {
      console.warn('[scheduling-writer] availability template/list missing')
      return
    }

    // The Designer-authored card is a cloning source, not a user-facing row.
    // Hide it whenever the rendered list becomes visible. Use an inline
    // display override as well as the semantic attributes because authored
    // Designer CSS can override the browser's default `[hidden]` rule.
    const templateDisplay = template.style.display
    template.setAttribute('hidden', '')
    template.setAttribute('aria-hidden', 'true')
    template.style.display = 'none'

    const avails = availability.items
    list.innerHTML = ''
    overrides = []
    for (const id in avails) {
      if (!Object.prototype.hasOwnProperty.call(avails, id)) continue
      const avail = avails[id]

      if (id !== 'general') {
        avail.days.forEach(function (day) {
          if (overrides.indexOf(day) === -1) overrides.push(day)
        })
      }

      const card = template.cloneNode(true)
      card.removeAttribute('availability-template')
      card.removeAttribute('hidden')
      card.removeAttribute('aria-hidden')
      card.style.display = templateDisplay
      card.setAttribute('availability-item', '')
      card.dataset.id = id

      const daysText = daysAlias(avail.days)
      qsa('[availability-title]', card).forEach(function (el) {
        el.textContent = id === 'general' ? 'General Availability' : daysText.full
      })
      qsa('[availability-action-btn]', card).forEach(function (el) {
        if (id === 'general' && el.getAttribute('availability-action-btn') === 'availability-remove') {
          el.remove()
        }
      })
      qsa('[availability-type]', card).forEach(function (el) {
        if (id !== 'general') el.remove()
      })
      let short = daysText.short
      if (avail.days.length === 1) short += ' only'
      qsa('[availability-days]', card).forEach(function (el) {
        el.textContent = short
      })
      qsa('[availability-time]', card).forEach(function (el) {
        el.textContent = avail.start + ' - ' + avail.end
      })
      list.appendChild(card)
    }
  }

  function getAvailArray() {
    const availabilityArray = []
    const avails = availability.items
    for (const id in avails) {
      if (!Object.prototype.hasOwnProperty.call(avails, id)) continue
      const avail = avails[id]
      if (id === 'general' && avail.days.length === 0) continue
      availabilityArray.push({
        days: avail.days,
        start: avail.start,
        end: avail.end,
      })
    }
    return availabilityArray
  }

  function reconcileGeneralDays() {
    const general = availability.items.general
    if (!general) return
    const baseDays = Array.isArray(general.defaultDays) ? general.defaultDays : general.days
    const claimed = []
    for (const id in availability.items) {
      if (!Object.prototype.hasOwnProperty.call(availability.items, id) || id === 'general') continue
      availability.items[id].days.forEach(function (day) {
        if (claimed.indexOf(day) === -1) claimed.push(day)
      })
    }
    general.days = baseDays.filter(function (day) {
      return claimed.indexOf(day) === -1
    })
  }

  function writeAvailabilityCache() {
    try {
      window.localStorage.setItem(
        CACHE_PREFIX + sessionMemberId,
        JSON.stringify({ cachedAt: Date.now(), availability: availability }),
      )
    } catch (error) {
      console.warn('[scheduling-writer] cache unavailable:', error && error.message)
    }
  }

  async function updateAvail() {
    await ensureTimezone()
    const memberId = await writeMemberId()
    // The /v3 endpoint UPSERTS: new V3 starters have no legacy scheduling row,
    // so the first save creates it (seeded server-side from the auth user).
    // in_timezone is only used on that create; edits never touch the column.
    const updated = await xanoPost('/starter/update_availability/v3', {
      member_id: memberId,
      availability: availability,
      in_timezone: timezone || '',
    })
    if (!updated) throw new Error('starter/update_availability/v3 returned no record')
    window.STARTER_AVAILABILITY = availability
    writeAvailabilityCache()
    return updated
  }

  /* ------------------------------------------------------------------ */
  /* Timezone                                                            */
  /* ------------------------------------------------------------------ */

  // One authenticated read of the scheduling row per bootstrap. Grant state
  // comes from here (server truth): the Memberstack custom-field mirror is
  // not writable for Test-Data members (the admin PATCH uses the live key),
  // so relying on it left sandbox members grant-less in the writer.
  async function readStarterRecord() {
    const starter = await xanoPost('/starter/get_by_memberstack/v3', {
      member_id: await writeMemberId(),
    })
    return starter && typeof starter === 'object' && !Array.isArray(starter) ? starter : null
  }

  async function resolveTimezone(starterRecord, allowWrite) {
    let resolved = null
    try {
      const starter = starterRecord
      if (starter && typeof starter.timezone === 'string' && starter.timezone.trim() !== '') {
        resolved = starter.timezone
        timezonePersisted = true
      }
      if (!resolved) {
        try {
          resolved = window.localStorage.getItem(TIMEZONE_CACHE_PREFIX + sessionMemberId)
        } catch (error) {
          /* storage unavailable */
        }
      }
      if (allowWrite && !timezonePersisted) {
        const updated = await xanoPost('/starter/set_timezone/v3', {
          member_id: await writeMemberId(),
          timezone: resolved || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        })
        resolved = updated && updated.timezone ? updated.timezone : null
        timezonePersisted = Boolean(resolved)
      }
    } catch (error) {
      console.warn('[scheduling-writer] timezone resolution failed:', error && error.message)
    }

    if (resolved) {
      try {
        window.localStorage.setItem(TIMEZONE_CACHE_PREFIX + sessionMemberId, resolved)
      } catch (error) {
        /* storage unavailable */
      }
    }
    return resolved
  }

  function renderTimezone() {
    qsa('[starter-timezone]').forEach(function (el) {
      if (timezone) el.textContent = 'Your timezone is - ' + timezone
      else el.style.display = 'none'
    })
  }

  async function ensureTimezone() {
    if (!timezone || !timezonePersisted) timezone = await resolveTimezone(null, true)
    if (!timezone || !timezonePersisted) throw new Error('Timezone is unavailable')
    renderTimezone()
    return timezone
  }

  /* ------------------------------------------------------------------ */
  /* Nylas scheduler configurations                                      */
  /* ------------------------------------------------------------------ */

  async function getConfigs(id, failOnError) {
    try {
      const response = await xanoPost('/nylas_configurations/get_all/v3', { grant_id: id })
      if (!Array.isArray(response)) throw new Error('Configuration reader returned invalid data')
      return response
    } catch (error) {
      console.warn('[scheduling-writer] getConfigs failed:', error && error.message)
      if (failOnError) throw error
      return null
    }
  }

  // Every terminal connection state must come from a fresh canonical read.
  // Mutation responses are acknowledgements, not scheduling authority: re-read
  // availability_v3 through the authenticated Starter projection, then read
  // configurations for the grant returned by that row before repainting UI.
  async function refreshCanonicalConnectionState() {
    publishCalendarConnectionState('loading')
    try {
      const starter = await readStarterRecord()
      const canonicalAvailability = starter && starter.availability
      if (!isAvailability(canonicalAvailability)) {
        throw new Error('Canonical scheduling reader returned invalid availability')
      }
      const nextGrantId = (starter && starter.nylas_grant_id) || null
      const nextConfigs = nextGrantId ? await getConfigs(nextGrantId, true) : []

      grantId = nextGrantId
      grantEmail = (starter && starter.nylas_grant_email) || null
      grantCalendarId = (starter && starter.nylas_calendar_id) || null
      configs = nextConfigs
      availability = canonicalAvailability
      window.STARTER_AVAILABILITY = canonicalAvailability
      writeAvailabilityCache()
      connectionError = false
      return publishCalendarConnectionState()
    } catch (error) {
      publishCalendarConnectionError()
      throw error
    }
  }

  // Calendar setup owns only the free-call configuration. Paid services are
  // owned by starter/paid-call-settings/* and must not be inferred from DOM or
  // localStorage state.
  async function createFreeConfig() {
    const free = await setupConfigs('free')
    if (free === null) throw new Error('Free scheduler configuration failed')
    return free
  }

  function paidCallService(value) {
    if (!value || !Array.isArray(value.services) || !value.readiness) {
      throw new Error('Paid-call settings reader returned an invalid response')
    }
    const active = value.services.filter(function (service) {
      return service && service.active === true
    })
    if (active.length > 1) throw new Error('Multiple active paid-call services require support')
    return active[0] || null
  }

  async function capturePaidCallIntent() {
    const service = paidCallService(await xanoGet('/starter/paid-call-settings/get/v3'))
    if (!service) return null
    const intent = {
      title: String(service.title || '').trim(),
      price_cents: Number(service.price_cents),
      duration_minutes: Number(service.duration),
    }
    if (
      !Number.isInteger(intent.price_cents) ||
      intent.price_cents < 100 ||
      intent.price_cents > 100000 ||
      intent.price_cents % 100 !== 0
    ) {
      throw Object.assign(
        new Error('Canonical paid-call rate is outside the whole-dollar contract'),
        { code: PAID_CALL_RATE_UNSUPPORTED },
      )
    }
    if (intent.title.length < 3 || [15, 30, 45, 60].indexOf(intent.duration_minutes) === -1) {
      throw new Error('Canonical paid-call service cannot be preserved')
    }
    return intent
  }

  async function restorePaidCallIntent(intent) {
    if (!intent) return null
    const existing = paidCallService(await xanoGet('/starter/paid-call-settings/get/v3'))
    if (existing) {
      if (
        existing.title === intent.title &&
        Number(existing.price_cents) === intent.price_cents &&
        Number(existing.duration) === intent.duration_minutes
      ) {
        return existing
      }
      throw new Error('Canonical paid-call service conflicts with transition intent')
    }
    await xanoPost('/starter/paid-call-settings/upsert/v3', {
      config_id: null,
      title: intent.title,
      price_cents: intent.price_cents,
      duration_minutes: intent.duration_minutes,
      expected_revision: 0,
      idempotency_key: 'paid-call-calendar-transition:' + crypto.randomUUID(),
    })
    const service = paidCallService(await xanoGet('/starter/paid-call-settings/get/v3'))
    if (
      !service ||
      service.title !== intent.title ||
      Number(service.price_cents) !== intent.price_cents ||
      Number(service.duration) !== intent.duration_minutes
    ) {
      throw new Error('Paid-call service did not match canonical transition readback')
    }
    return service
  }

  async function recoverPaidCallAfterOAuthCancellation(memberId, oauthIntent) {
    const intent = oauthIntent && oauthIntent.paidCallIntent
    if (!intent) return false
    await refreshCanonicalConnectionState()
    let createdVirtual = false
    const recovery = oauthIntent.virtualRecovery
    const resumableGrant =
      recovery && recovery.grant_id && (!grantId || recovery.grant_id === grantId)
        ? recovery
        : null
    if (grantId && (!grantEmail || !grantCalendarId) && !resumableGrant) {
      throw new Error('Canonical calendar transition is incomplete')
    }
    if (!grantId || !grantEmail || !grantCalendarId) {
      const virtual = await createTransitionVirtualCalendar(memberId, oauthIntent, resumableGrant)
      if (virtual.status !== 200) throw new Error('OAuth cancellation recovery failed')
      grantId = virtual.grant_id
      grantEmail = virtual.email
      grantCalendarId = virtual.calendar_id
      configs = []
      createdVirtual = true
    }
    const hasFreeConfig = configs.some(function (config) {
      return config && config.config_id && config.is_paid === false && config.active !== false
    })
    if (!hasFreeConfig) await createFreeConfig()
    if (createdVirtual || availability.manager === null) {
      availability.manager = 'platform'
      await updateAvail()
    }
    await restorePaidCallIntent(intent)
    await refreshCanonicalConnectionState()
    return true
  }

  async function recoverFailedCalendarTransition(memberId, transition, error) {
    const recoveryTransition = transition || (error && error.calendarTransition)
    if (!(memberId && recoveryTransition && recoveryTransition.oauthIntent)) return false
    const recovered = await recoverPaidCallAfterOAuthCancellation(
      memberId,
      recoveryTransition.oauthIntent,
    )
    if (recovered) clearOAuthIntent(memberId)
    return recovered
  }

  async function setupConfigs(type) {
    if (type !== 'free') throw new Error('Paid configurations require the paid-call settings endpoint')
    await ensureTimezone()
    const openHours = getAvailArray()
    const price = '0'
    const duration = 30
    const interval = 15
    const buffer = 10

    const firstName = memberFields['free-user'] || ''
    const lastName = memberFields['last-name'] || ''
    const memberEmail = (window.MEMBER && window.MEMBER.auth && window.MEMBER.auth.email) || ''

    const tinyTitle = 'Free Consultation Call'
    const fullTitle = tinyTitle + ' - ' + duration + 'min'

    // Booking confirmation/reschedule/cancel links land back on this page —
    // its bookings embed owns booking_ref handling. No separate landing page.
    const redirectURL = window.location.origin + window.location.pathname

    const payload = {
      grant_id: grantId,
      in_config_name: fullTitle,
      in_availability: {
        duration_minutes: duration,
        interval_minutes: interval,
        availability_rules: {
          availability_method: 'collective',
          buffer: { before: buffer, after: buffer },
          default_open_hours: openHours,
        },
      },
      in_event_booking: {
        title: fullTitle,
        hide_participants: true,
        notify_participants: false,
        disable_emails: true,
        booking_type: 'organizer-confirmation',
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        conferencing: {
          provider: 'Google Meet',
          autocreate: { conf_grant_id: grantId },
        },
      },
      in_participants: [
        {
          name: firstName + ' ' + lastName,
          email: grantEmail,
          is_organizer: true,
          availability: { calendar_ids: [grantCalendarId] },
          booking: { calendar_id: grantCalendarId },
        },
      ],
      in_scheduler: {
        available_days_in_future: 14,
        organizer_confirmation_url: redirectURL + '?confirmation=:booking_ref',
        rescheduling_url: redirectURL + '?reschedule=:booking_ref',
        cancellation_url: redirectURL + '?cancel=:booking_ref',
        hide_rescheduling_options: true,
        hide_cancellation_options: true,
        min_booking_notice: minimumBookingNoticeMinutes(),
        additional_fields: {
          call_full_title: { type: 'metadata', label: 'Call Full Title', default: fullTitle, required: false },
          call_tiny_title: { type: 'metadata', label: 'Call Tiny Title', default: tinyTitle, required: false },
          call_type: { type: 'metadata', label: 'Call Type', default: 'free', required: false },
          starter_name: { type: 'metadata', label: 'Starter Name', default: firstName + ' ' + lastName, required: false },
          starter_email: { type: 'metadata', label: 'Starter Email', default: memberEmail, required: false },
          call_price: { type: 'metadata', label: 'Call Price', default: price, required: false },
          call_provider: { type: 'metadata', label: 'Call Provider', default: 'google', required: false },
          call_context: { type: 'text', label: 'Call Context', default: '', required: false },
          rescheduled_by: { type: 'text', label: 'Rescheduled By', default: '', required: false },
          rescheduled_reason: { type: 'text', label: 'Rescheduled Reason', default: '', required: true },
          unique_id: { type: 'text', label: 'Unique ID', default: '', required: false },
          from_stage: { type: 'text', label: 'Is From Stage', default: '', required: false },
        },
      },
    }

    try {
      const res = await xanoPost(
        '/scheduler/configurations/create/v3',
        payload,
      )
      if (providerRequestSucceeded(res)) return true
      publishCalendarConnectionError()
      switchStep('config-request-error')
      console.warn('[scheduling-writer] configuration request rejected')
      return null
    } catch (error) {
      publishCalendarConnectionError()
      switchStep('config-request-error')
      console.warn('[scheduling-writer] configuration request failed:', error && error.message)
      return null
    }
  }

  async function updateConfigAvailability(record) {
    await ensureTimezone()
    const duration = Number(record && record.duration)
    if (!record || !record.config_id || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('Canonical scheduler configuration is missing update fields')
    }
    const res = await xanoPost('/scheduler/configurations/update/v3', {
      config_id: record.config_id,
      grant_id: grantId,
      in_availability: {
        duration_minutes: duration,
        interval_minutes: 15,
        availability_rules: {
          availability_method: 'collective',
          buffer: { before: 10, after: 10 },
          default_open_hours: getAvailArray(),
        },
      },
    })
    if (providerRequestSucceeded(res)) return true
    publishCalendarConnectionError()
    switchStep('config-request-error')
    return null
  }

  async function refreshCanonicalConnectionSoon(delay) {
    setTimeout(async function () {
      try {
        await refreshCanonicalConnectionState()
      } catch (error) {
        console.warn(
          '[scheduling-writer] canonical connection refresh failed:',
          error && error.message,
        )
      }
    }, delay)
  }

  async function updateConfigs(step, removeAvail) {
    configs = await getConfigs(grantId, true)
    const configsResponse = []
    for (const record of configs) {
      if (record.active === false) continue
      const res = await updateConfigAvailability(record)
      configsResponse.push(res)
    }
    // Unlike the legacy inline writer, a failed update must not be replaced
    // by the success step — setupConfigs already switched to the error step.
    // Rate-gated starters may legitimately carry a single (free) config.
    const succeeded = configsResponse.length > 0 && configsResponse.every(Boolean)
    if (succeeded && !removeAvail) {
      switchStep('success')
    }
    if (step) setLoader(false, step)
    return succeeded
  }

  /* ------------------------------------------------------------------ */
  /* Virtual (platform-managed) calendar + disconnect                    */
  /* ------------------------------------------------------------------ */

  async function createVirtualCalendarFlow(memberId, options) {
    await ensureTimezone()
    const result = { status: 400, grant_id: null, email: null, calendar_id: null }
    let account =
      options && options.account && options.account.grant_id
        ? { data: { id: options.account.grant_id, email: options.account.email || null } }
        : null
    if (!account) {
      try {
        const accountResponse = await xanoPost('/grants/create_virtual_account/v3', {
          member_id: memberId,
        })
        account = accountResponse && accountResponse.response && accountResponse.response.result
        if (account && account.data && options && typeof options.onAccount === 'function') {
          options.onAccount(account.data)
        }
      } catch (error) {
        console.warn('[scheduling-writer] virtual account failed:', error && error.message)
        return result
      }
    }
    const virtualGrantId = account && account.data && account.data.id
    if (!virtualGrantId) return result

    try {
      // V3 endpoint: keyed on memberstack_id, no Airtable row-key involved.
      const grantAdded = await xanoPost('/grants/add_virtual/v3', {
        grant_id: virtualGrantId,
        member_id: memberId,
      })
      if (!grantAdded) return result

      const calendarResponse = await xanoPost('/grants/create_virtual_calendar/v3', {
        grant_id: virtualGrantId,
        member_id: memberId,
      })
      const calendar =
        calendarResponse && calendarResponse.response && calendarResponse.response.result
      if (!(calendar && calendar.data && calendar.data.id)) return result

      result.status = 200
      result.grant_id = virtualGrantId
      result.email = account.data.email || null
      result.calendar_id = calendar.data.id
      return result
    } catch (error) {
      console.warn('[scheduling-writer] virtual calendar failed:', error && error.message)
      return result
    }
  }

  async function createTransitionVirtualCalendar(memberId, oauthIntent, account) {
    if (!oauthIntent) return createVirtualCalendarFlow(memberId)
    return createVirtualCalendarFlow(memberId, {
      account: account || oauthIntent.virtualRecovery || null,
      onAccount: function (createdAccount) {
        oauthIntent.virtualRecovery = {
          grant_id: createdAccount.id,
          email: createdAccount.email || null,
        }
        persistOAuthIntent(memberId, oauthIntent)
      },
    })
  }

  async function clearGrant(currentGrantId, memberId) {
    if (!currentGrantId) return { paidCallIntent: null }
    await ensureTimezone()
    const paidCallIntent = await capturePaidCallIntent()
    const oauthIntent = paidCallIntent
      ? rememberOAuthIntent(memberId, oauthRedirectUri(), paidCallIntent)
      : null
    if (paidCallIntent && !oauthIntent) {
      throw new Error('Paid-call calendar transition could not be retained')
    }
    const transition = { paidCallIntent: paidCallIntent, oauthIntent: oauthIntent }
    try {
      const result = await xanoPost('/grants/delete/v3', { in_grant_id: currentGrantId })
      if (!result || result.connected !== false) {
        throw new Error('grants/delete/v3 returned an invalid disconnected state')
      }
      return Object.assign({ result: result }, transition)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('grants/delete/v3 failed')
      failure.calendarTransition = transition
      throw failure
    }
  }

  /* ------------------------------------------------------------------ */
  /* Form handling                                                       */
  /* ------------------------------------------------------------------ */

  function resetAvailForm(form, id) {
    qsa('input, textarea, select', form).forEach(function (field) {
      if (field.type === 'hidden') return
      if (field.type === 'checkbox' || field.type === 'radio') {
        field.checked = false
        field.disabled = false
        if (field.previousElementSibling) {
          field.previousElementSibling.classList.remove('w--redirected-checked')
        }
        if (field.parentElement) field.parentElement.classList.remove('overridden')
      } else {
        field.value = ''
      }
    })

    const availDays = qsa('[type=checkbox][name=avail-day]', form)
    availDays.forEach(function (day, i) {
      if (
        overrides.indexOf(i) > -1 &&
        !(availability.items[id] && availability.items[id].days.indexOf(i) > -1)
      ) {
        day.disabled = true
        if (day.parentElement) day.parentElement.classList.add('overridden')
      }
    })
  }

  function availabilityFormPopulate(form, id) {
    form.style.display = 'flex'
    const item = availability.items[id]
    if (!item) return
    const availDays = qsa('[type=checkbox][name=avail-day]', form)
    availDays.forEach(function (day, i) {
      if (item.days.indexOf(i) > -1 && day.parentElement) {
        day.parentElement.dispatchEvent(new MouseEvent('click'))
      }
    })
    const startTime = qs('[name=start-time]', form)
    if (startTime) startTime.value = item.start
    const endTime = qs('[name=end-time]', form)
    if (endTime) endTime.value = item.end
  }

  function availFormPrepare(form, id) {
    if (!id || !form) return
    if (!qs('[availability-list]')) return
    form.dataset.availabilityId = id
    resetAvailForm(form, id)
    availabilityFormPopulate(form, id)
    switchStep('setup-form')
  }

  async function availFormHandler(form) {
    if (!form) return

    const availDays = qsa('[type=checkbox][name=avail-day]', form)
    const selectedDays = []
    availDays.forEach(function (day, i) {
      if (day.checked) selectedDays.push(i)
    })
    if (selectedDays.length === 0) {
      if (availDays[0]) showError(availDays[0].closest('[set-availability-group]'))
      console.warn('[scheduling-writer] select at least one available day')
      return
    }
    const startTime = qs('[name=start-time]', form)
    if (!(startTime && startTime.value)) {
      if (startTime) showError(startTime.closest('[set-availability-group]'))
      console.warn('[scheduling-writer] start time required')
      return
    }
    const endTime = qs('[name=end-time]', form)
    if (!(endTime && endTime.value)) {
      if (endTime) showError(endTime.closest('[set-availability-group]'))
      console.warn('[scheduling-writer] end time required')
      return
    }

    const step = form.closest('[availability-step]')
    setLoader(true, step)
    const previousAvailability = JSON.parse(JSON.stringify(availability))
    let canonicalSaved = false

    try {
      const availId = form.dataset.availabilityId || 'general'
      const avail = { days: selectedDays, start: startTime.value, end: endTime.value }

      if (availId === 'general') {
        avail.defaultDays = avail.days
      }

      availability.items[availId] = avail
      if (availId !== 'general') reconcileGeneralDays()
      await updateAvail()
      canonicalSaved = true

      if (initialState) {
        await refreshCanonicalConnectionState()
        renderAvail()
        emit('starterSchedulingWriteSuccess', { action: 'availability-save' })
        switchStep('default')
        qsa('[config-initial-element="setup-form"]').forEach(function (el) {
          el.style.display = 'none'
        })
        setLoader(false, step)
        return
      }

      if (availability.manager === null) {
        await refreshCanonicalConnectionState()
        renderAvail()
        emit('starterSchedulingWriteSuccess', { action: 'availability-save' })
        switchStep('how-to-manage')
        setLoader(false, step)
        return
      }

      if (grantId) {
        const updated = await updateConfigs(step)
        if (updated) {
          await refreshCanonicalConnectionState()
          renderAvail()
          emit('starterSchedulingWriteSuccess', { action: 'availability-save' })
          setLoader(false, step)
          return
        }
        const activeConfigs = configs.filter(function (config) {
          return config.active !== false
        })
        if (activeConfigs.length === 0) {
          await createFreeConfig()
          await refreshCanonicalConnectionState()
          renderAvail()
          emit('starterSchedulingWriteSuccess', { action: 'availability-save' })
          switchStep('default')
          setLoader(false, step)
          return
        }
        throw new Error('Scheduler configuration update failed')
      }
      await refreshCanonicalConnectionState()
      renderAvail()
      emit('starterSchedulingWriteSuccess', { action: 'availability-save' })
      switchStep('default')
      setLoader(false, step)
    } catch (error) {
      if (!canonicalSaved) {
        availability = previousAvailability
        window.STARTER_AVAILABILITY = previousAvailability
        renderAvail()
      }
      publishCalendarConnectionError()
      setLoader(false, step)
      switchStep('config-request-error')
      console.warn('[scheduling-writer] availability save failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'availability-save',
        message: (error && error.message) || 'Availability save failed',
      })
    }
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  async function handleManagerSubmit(step) {
    if (initialState) {
      initialState = false
      qsa('[config-initial-element]').forEach(function (el) {
        el.style.display = 'none'
      })
    }
    if (activeManager === availability.manager) return

    bookingsWrapper('show')
    setLoader(true, step)
    let memberId = null
    let transition = null

    try {
      if (activeManager === 'platform') {
        switchStep('virtual-connect')
        publishCalendarConnectionState('loading')
        memberId = await writeMemberId()
        transition = await clearGrant(grantId, memberId)
        const virtual = await createTransitionVirtualCalendar(
          memberId,
          transition.oauthIntent,
        )
        if (virtual.status === 200) {
          grantId = virtual.grant_id
          grantEmail = virtual.email
          grantCalendarId = virtual.calendar_id

          await createFreeConfig()

          availability.manager = activeManager
          await updateAvail()
          await restorePaidCallIntent(transition.paidCallIntent)
          await refreshCanonicalConnectionState()
          if (transition.oauthIntent) clearOAuthIntent(memberId)
          try {
            window.localStorage.setItem('prev-availability-manager', activeManager)
          } catch (error) {
            /* storage unavailable */
          }
          showManagerActions()
          switchStep('success')
          emit('starterSchedulingWriteSuccess', { action: 'manager-platform' })
        } else {
          publishCalendarConnectionError()
          switchStep('config-request-error')
          console.warn('[scheduling-writer] virtual calendar setup failed')
          throw new Error('Virtual calendar setup failed')
        }
      } else {
        publishCalendarConnectionState('loading')
        memberId = await writeMemberId()
        transition = await clearGrant(grantId, memberId)
        grantId = null
        grantEmail = null
        grantCalendarId = null
        configs = []
        if (availability.manager !== null) {
          availability.manager = null
          await updateAvail()
        }
        await refreshCanonicalConnectionState()
        emit('starterSchedulingWriteSuccess', { action: 'manager-calendar' })
        await handlePreRedirect(transition.paidCallIntent, true)
      }
    } catch (error) {
      try {
        await recoverFailedCalendarTransition(memberId, transition, error)
      } catch (recoveryError) {
        console.warn('[scheduling-writer] manager recovery failed:', recoveryError && recoveryError.message)
      }
      publishCalendarConnectionError()
      showTransitionError(error)
      console.warn('[scheduling-writer] manager change failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'manager-submit',
        message: (error && error.message) || 'Manager change failed',
      })
    }
    setLoader(false, step)
  }

  async function handleDisconnectCalendar(step) {
    setLoader(true, step)
    let memberId = null
    let transition = null
    try {
      publishCalendarConnectionState('loading')
      memberId = await writeMemberId()
      transition = await clearGrant(grantId, memberId)
      availability.manager = null

      const virtual = await createTransitionVirtualCalendar(
        memberId,
        transition.oauthIntent,
      )
      if (virtual.status === 200) {
        grantId = virtual.grant_id
        grantEmail = virtual.email
        grantCalendarId = virtual.calendar_id

        await createFreeConfig()

        availability.manager = 'platform'
        await updateAvail()
        await restorePaidCallIntent(transition.paidCallIntent)
        await refreshCanonicalConnectionState()
        if (transition.oauthIntent) clearOAuthIntent(memberId)
        switchStep('success-disconnect')
        emit('starterSchedulingWriteSuccess', { action: 'disconnect-calendar' })
      } else {
        switchStep('config-request-error')
        console.warn('[scheduling-writer] virtual calendar setup failed')
        grantId = null
        grantEmail = null
        grantCalendarId = null
        configs = []
        publishCalendarConnectionError()
        throw new Error('Virtual calendar setup failed after disconnect')
      }
    } catch (error) {
      try {
        await recoverFailedCalendarTransition(memberId, transition, error)
      } catch (recoveryError) {
        console.warn('[scheduling-writer] disconnect recovery failed:', recoveryError && recoveryError.message)
      }
      publishCalendarConnectionError()
      showTransitionError(error)
      console.warn('[scheduling-writer] disconnect failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'disconnect-calendar',
        message: (error && error.message) || 'Disconnect failed',
      })
    }
    setLoader(false, step)
    showManagerActions()
  }

  async function handlePreRedirect(paidCallIntent, propagateFailure) {
    switchStep('pre-redirect')
    try {
      // OAuth returns to this same dashboard. Xano derives `state` from the
      // authenticated member id; the callback must round-trip that exact
      // value and a recent member-scoped intent before any grant write.
      const memberId = await writeMemberId()
      await ensureTimezone()
      const redirectUri = oauthRedirectUri()
      const response = await xanoPost('/grants/oauth/v3', {
        in_state: memberId,
        in_provider: 'google',
        in_redirect_uri: redirectUri,
      })
      const url =
        response &&
        response.response &&
        response.response.result &&
        response.response.result.data &&
        response.response.result.data.url
      if (!url) throw new Error('grants/oauth returned no URL')
      if (!rememberOAuthIntent(memberId, redirectUri, paidCallIntent)) {
        throw new Error('OAuth transition could not be retained')
      }
      // A delayed window.open occurs after awaited requests and is blocked by
      // normal browser popup protection. Same-tab navigation is reliable and
      // preserves the member-scoped intent needed by the callback verifier.
      window.location.assign(url)
    } catch (error) {
      publishCalendarConnectionError()
      switchStep('config-request-error')
      console.warn('[scheduling-writer] OAuth redirect failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'pre-redirect',
        message: (error && error.message) || 'OAuth redirect failed',
      })
      if (propagateFailure) throw error
    }
  }

  async function handleAvailabilityRemove(item) {
    const removed = availability.items[item.dataset.id]
    const general = availability.items.general
    if (!removed || !general) return
    const previousAvailability = JSON.parse(JSON.stringify(availability))
    let canonicalSaved = false
    delete availability.items[item.dataset.id]
    reconcileGeneralDays()

    try {
      await updateAvail()
      canonicalSaved = true
      if (grantId) {
        const updated = await updateConfigs(null, true)
        if (!updated) {
          const activeConfigs = configs.filter(function (config) {
            return config.active !== false
          })
          if (activeConfigs.length === 0) await createFreeConfig()
          else throw new Error('Scheduler configuration update failed')
        }
      }
      await refreshCanonicalConnectionState()
      renderAvail()
      emit('starterSchedulingWriteSuccess', { action: 'availability-remove' })
    } catch (error) {
      if (!canonicalSaved) {
        availability = previousAvailability
        window.STARTER_AVAILABILITY = previousAvailability
        renderAvail()
      }
      publishCalendarConnectionError()
      switchStep('config-request-error')
      console.warn('[scheduling-writer] availability remove failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'availability-remove',
        message: (error && error.message) || 'Availability remove failed',
      })
    }
  }

  async function handleAction(btn, form) {
    const item = btn.closest('[availability-item]')
    const action = btn.getAttribute('availability-action-btn')
    const step = btn.closest('[availability-step]')

    if (action === 'submit') {
      await availFormHandler(form)
    } else if (action === 'availability-edit') {
      if (item) {
        availFormPrepare(form, item.dataset.id)
        changeSubmitText('Edit configuration')
      }
    } else if (action === 'availability-create') {
      if (initialState) {
        const backBtn = qs('[availability-step="setup-form"] [data-to]')
        if (backBtn) backBtn.style.display = 'flex'
      }
      changeSubmitText('Add configuration')
      availFormPrepare(form, crypto.randomUUID())
    } else if (action === 'availability-remove') {
      if (item) await handleAvailabilityRemove(item)
    } else if (action === 'manager-submit') {
      await handleManagerSubmit(step)
    } else if (action === 'back' || action === 'disconnect-confirm') {
      switchStep(btn.dataset.to)
    } else if (action === 'close') {
      closeConfigPopup()
    } else if (action === 'disconnect-calendar') {
      await handleDisconnectCalendar(step)
    } else if (action === 'how-to-manage') {
      switchStep('how-to-manage')
    } else if (action === 'pre-redirect') {
      handlePreRedirect()
    }
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  function isAvailability(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !value.items ||
      typeof value.items !== 'object' ||
      Array.isArray(value.items) ||
      !Object.prototype.hasOwnProperty.call(value, 'manager') ||
      (value.manager !== null && value.manager !== 'platform' && value.manager !== 'calendar')
    ) {
      return false
    }
    return Object.keys(value.items).every(function (key) {
      const item = value.items[key]
      return Boolean(
        item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          Array.isArray(item.days) &&
          typeof item.start === 'string' &&
          typeof item.end === 'string',
      )
    })
  }

  function availabilityFromInitializer() {
    if (isAvailability(window.STARTER_AVAILABILITY)) {
      return Promise.resolve(window.STARTER_AVAILABILITY)
    }
    return new Promise(function (resolve, reject) {
      window.addEventListener(
        'starterSchedulingAvailabilityReady',
        function () {
          if (isAvailability(window.STARTER_AVAILABILITY)) resolve(window.STARTER_AVAILABILITY)
          else reject(new Error('Initializer produced no availability'))
        },
        { once: true },
      )
      window.addEventListener(
        'starterSchedulingAvailabilityError',
        function (event) {
          reject(
            new Error(
              (event && event.detail && event.detail.message) || 'Initializer failed',
            ),
          )
        },
        { once: true },
      )
    })
  }

  function testMemberOverrideActive() {
    return document.documentElement.getAttribute(TEST_MEMBER_ATTRIBUTE) === 'true'
  }

  async function initialize() {
    const form = qs('[availability-form]')
    if (!form) {
      setStatus('not-applicable')
      return null
    }
    if (typeof window.xanoAuthFetch !== 'function') {
      setStatus('missing-auth')
      console.warn('[scheduling-writer] xanoAuthFetch unavailable; writer disabled')
      return null
    }

    setStatus('loading')
    try {
      const member = await currentMember()
      sessionMemberId = member.id
      memberFields = member.customFields || {}
      timezone = null
      timezonePersisted = false
      connectionError = false
      configs = []
      grantId = null
      grantEmail = null
      grantCalendarId = null

      availability = await availabilityFromInitializer()

      // The ?test_member_id override renders another member's availability.
      // Submitting edits would overwrite the logged-in member's data with the
      // displayed member's schedule, so the writer stays read-only.
      if (testMemberOverrideActive()) {
        setStatus('blocked-test-member')
        console.warn('[scheduling-writer] test-member override active; writes disabled')
        return null
      }

      publishCalendarConnectionState('loading')

      initialState = Object.keys(availability.items).length === 0
      const starterRecord = await readStarterRecord()
      // Xano availability_v3 is canonical for scheduling connection state.
      // Memberstack remains the browser auth source, but its legacy grant
      // mirrors must never make a missing/stale Xano connection look ready.
      grantId = (starterRecord && starterRecord.nylas_grant_id) || null
      grantEmail = (starterRecord && starterRecord.nylas_grant_email) || null
      grantCalendarId = (starterRecord && starterRecord.nylas_calendar_id) || null

      form.addEventListener('submit', function (e) {
        e.preventDefault()
      })

      timezone = await resolveTimezone(starterRecord, isStagingHost)
      renderTimezone()

      const urlParams = new URLSearchParams(
        oauthCallback ? oauthCallback.remainingQuery : window.location.search,
      )
      let connectedCalendar = isStagingHost ? urlParams.get('calendar') || null : null
      let oauthPaidCallIntent = null

      if (!oauthCallback) {
        const pendingTransition = readOAuthIntent(sessionMemberId)
        if (pendingTransition && pendingTransition.paidCallIntent) {
          const recovered = await recoverPaidCallAfterOAuthCancellation(
            sessionMemberId,
            pendingTransition,
          )
          if (recovered) clearOAuthIntent(sessionMemberId)
        }
      }

      // OAuth returns directly to this page. The classic Nylas flow returns
      // ?code&state; the hosted-auth success flow returns
      // ?success=true&grant_id&email&provider&state. In both cases the state
      // was set by grants/oauth/v3 from the caller's Bearer token and must
      // match the logged-in member. grants/add/v3 performs the authoritative
      // server-side exchange or grant lookup before persisting V3 state.
      if (oauthCallback) {
        const oauthCode = oauthCallback.code
        const oauthGrantId = oauthCallback.grantId
        const oauthState = oauthCallback.state
        let memberId = null
        let oauthIntent = null
        let trustedState = false
        try {
          memberId = await writeMemberId()
          if (!oauthState || oauthState !== memberId) {
            throw invalidOAuthCallback('OAuth state does not match the logged-in member')
          }
          trustedState = true
          oauthIntent = readOAuthIntent(memberId, true)
          if (oauthCallback.hasError) {
            throw invalidOAuthCallback('OAuth authorization was cancelled or failed')
          }
          if (oauthGrantId && oauthCallback.success !== 'true') {
            throw invalidOAuthCallback('Hosted OAuth did not report success')
          }
          if (!oauthIntent) {
            throw invalidOAuthCallback('OAuth return was not initiated by this session')
          }
          oauthPaidCallIntent = oauthIntent.paidCallIntent || null
          await ensureTimezone()
          if (!oauthIntent.oauthGrantSaved && oauthCallback.resumed) {
            await refreshCanonicalConnectionState()
            if (
              grantId &&
              grantEmail &&
              grantCalendarId &&
              (!oauthGrantId || grantId === oauthGrantId)
            ) {
              oauthIntent.oauthGrantSaved = true
              persistOAuthIntent(memberId, oauthIntent)
            }
          }
          if (!oauthIntent.oauthGrantSaved) {
            const grantPayload = {
              member_id: memberId,
              in_redirect_uri: oauthIntent.redirectUri,
              in_state: oauthState,
            }
            if (oauthCode) grantPayload.code = oauthCode
            else grantPayload.in_grant_id = oauthGrantId
            const grant = await xanoPost('/grants/add/v3', grantPayload)
            if (!(grant && grant.grant_id)) {
              throw new Error('grants/add/v3 returned no grant')
            }
            oauthIntent.oauthGrantSaved = true
            persistOAuthIntent(memberId, oauthIntent)
          }
          await refreshCanonicalConnectionState()
          if (!grantId || !grantEmail || !grantCalendarId) {
            throw new Error('Canonical OAuth grant readback is incomplete')
          }
          if (availability.manager !== 'calendar') {
            availability.manager = 'calendar'
            await updateAvail()
          }
          const hasFreeConfig = configs.some(function (config) {
            return config && config.config_id && config.is_paid === false && config.active !== false
          })
          if (!hasFreeConfig) await createFreeConfig()
          await restorePaidCallIntent(oauthPaidCallIntent)
          await refreshCanonicalConnectionState()
          clearOAuthIntent(memberId)
          clearOAuthCallback()
          connectedCalendar = null
          switchStep('default')
          emit('starterSchedulingWriteSuccess', { action: 'oauth-connect' })
        } catch (error) {
          let recovered = false
          if (
            error &&
            error.code === 'OAUTH_CALLBACK_INVALID' &&
            trustedState &&
            oauthIntent &&
            oauthIntent.paidCallIntent
          ) {
            try {
              recovered = await recoverPaidCallAfterOAuthCancellation(
                memberId,
                oauthIntent,
              )
            } catch (recoveryError) {
              console.warn(
                '[scheduling-writer] OAuth cancellation recovery failed:',
                recoveryError && recoveryError.message,
              )
            }
          }
          publishCalendarConnectionError()
          if (
            error &&
            error.code === 'OAUTH_CALLBACK_INVALID' &&
            (!trustedState || !oauthIntent || !oauthIntent.paidCallIntent || recovered)
          ) {
            if (trustedState && memberId) clearOAuthIntent(memberId)
            clearOAuthCallback()
          }
          switchStep('config-request-error')
          console.warn('[scheduling-writer] OAuth grant save failed:', error && error.message)
          emit('starterSchedulingWriteError', {
            action: 'oauth-connect',
            message: (error && error.message) || 'OAuth grant save failed',
          })
        }
      }

      if (grantId) {
        configs = (await getConfigs(grantId, true)) || []
        if (isStagingHost && !configs.length && !connectedCalendar) {
          await createFreeConfig()
          refreshCanonicalConnectionSoon(500)
        }
      }

      // Returning from the calendar OAuth round trip.
      if (connectedCalendar && !configs.length) {
        urlParams.delete('calendar')
        const remainingQuery = urlParams.toString()
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname + (remainingQuery ? '?' + remainingQuery : ''),
        )
        availability.manager = 'calendar'
        await updateAvail()
        await createFreeConfig()
        await restorePaidCallIntent(oauthPaidCallIntent)
        await refreshCanonicalConnectionState()
        switchStep('default')
      }

      // Initial-visibility refinements beyond the init module's state.
      if (initialState) {
        qsa('[config-initial-element]').forEach(function (el) {
          el.style.display = 'flex'
        })
        const setupStep = qs('[availability-step="setup-form"]')
        const backBtn = setupStep ? qs('[data-to]', setupStep) : null
        if (backBtn) backBtn.style.display = 'none'
        bookingsWrapper('hide')
      } else {
        if (typeof window.generateBookingsList === 'function') {
          window.generateBookingsList(sessionMemberId)
        }
        if (availability.manager === null) {
          switchStep('how-to-manage')
          bookingsWrapper('hide')
          qsa('[config-initial-element="general"]').forEach(function (el) {
            el.style.display = 'flex'
          })
        } else {
          bookingsWrapper('show')
        }
        renderAvail()
      }

      // Manager selection.
      const activeManagerEl = qs('[config-manager].is-active')
      if (activeManagerEl) {
        activeManager = activeManagerEl.dataset.type
        setManagerSubmitCopy(activeManager)
        if (activeManager === availability.manager) toggleManagerSubmit(false)
      }
      const managers = qsa('[config-manager]')
      managers.forEach(function (manager) {
        manager.addEventListener('click', function () {
          toggleManagerSubmit(true)
          managers.forEach(function (m) {
            m.classList.remove('is-active')
          })
          manager.classList.add('is-active')
          activeManager = manager.dataset.type
          setManagerSubmitCopy(activeManager)
          if (activeManager === availability.manager) toggleManagerSubmit(false)
        })
      })
      if (availability.manager !== null) showManagerActions()

      setCalendarConnectCopy()

      // Popup close.
      qsa('[availability-popup-close]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          if (btn.getAttribute('availability-popup-close') === 'pre-redirect') {
            let previousManager = null
            try {
              previousManager = window.localStorage.getItem('prev-availability-manager')
            } catch (error) {
              /* storage unavailable */
            }
            availability.manager = previousManager || null
            try {
              await updateAvail()
              await refreshCanonicalConnectionState()
            } catch (error) {
              publishCalendarConnectionError()
              console.warn(
                '[scheduling-writer] manager restore failed:',
                error && error.message,
              )
            }
            if (availability.manager === null) {
              switchStep('how-to-manage')
              return
            }
          }
          if (initialState) return
          setTimeout(function () {
            switchStep('default')
          }, 50)
        })
      })

      // Action delegation.
      document.addEventListener('click', function (e) {
        const btn = e.target.closest && e.target.closest('[availability-action-btn]')
        if (!btn) return
        e.preventDefault()
        e.stopPropagation()
        handleAction(btn, form)
      })

      publishCalendarConnectionState()
      setStatus('ready')
      emit('starterSchedulingWriterReady', { memberId: sessionMemberId })
      return 'ready'
    } catch (error) {
      publishCalendarConnectionError()
      setStatus('error')
      console.warn('[scheduling-writer] initialization failed:', error && error.message)
      emit('starterSchedulingWriteError', {
        action: 'initialize',
        message: (error && error.message) || 'Writer initialization failed',
      })
      return null
    }
  }

  window.StarterSchedulingAvailabilityWriter = {
    initialize: initialize,
    switchStep: switchStep,
    daysAlias: daysAlias,
    getAvailArray: getAvailArray,
    minimumBookingNoticeMinutes: minimumBookingNoticeMinutes,
    publishCalendarConnectionState: publishCalendarConnectionState,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
