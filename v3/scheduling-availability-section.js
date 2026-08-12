;(function () {
  'use strict'

  // Non-modal counterpart to scheduling-availability-writer.js for the new
  // always-visible "Dashboard / Calendar" section on the canonical Starter
  // dashboard. Every availability item now carries its own inline edit form
  // instead of sharing one modal form, so this module owns per-item CRUD,
  // connect/disconnect, timezone, and Nylas scheduler-configuration logic
  // independently of the step/modal machinery in the writer. It deliberately
  // does not depend on scheduling-availability-init.js: that module's job
  // (show/hide the legacy `[init-availability]`/`[update-availability]` hero
  // controls and pick the old modal's initial step) has no equivalent markup
  // in the new component, so this module reads the canonical starter record
  // itself instead of waiting on the initializer's handoff.
  //
  // OAuth-callback ownership: on any page carrying this section's root
  // (`[data-availability-element="section"]`), this module is the sole
  // consumer of the `?code&state` / `?success&grant_id` Nylas return.
  // scheduling-availability-writer.js has a matching guard that bails out
  // before capturing the callback when this section's root is present, to
  // avoid both scripts racing to redeem the same one-time code.
  //
  // Real result popups (create/edit/remove/connect/disconnect) are
  // deliberately deferred — every action logs its outcome to the console
  // instead.

  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const STAGING_OAUTH_PATH = '/starter-dashboard---availability-stage'
  const PRODUCTION_HOSTS = new Set(['thestarters.com', 'www.thestarters.com'])
  const PRODUCTION_PATH = '/starter-dashboard'
  const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const API_BASE = XANO_ORIGIN + '/api:tCpV3oqd'
  const STATUS_ATTRIBUTE = 'data-scheduling-availability-section'
  // Shared with scheduling-availability-writer.js so any other dashboard
  // widget (e.g. dashboard-action-items.js) keeps working regardless of
  // which script actually owns the page.
  const CONNECTION_STATUS_ATTRIBUTE = 'data-scheduling-calendar-state'
  const CACHE_PREFIX = 'starter-scheduling-availability:'
  const TIMEZONE_CACHE_PREFIX = 'starter-timezone:'
  const PAID_RATE_STORAGE_KEY = 'paid_call_rate'
  const OAUTH_INTENT_PREFIX = 'starter-scheduling-oauth-intent:'
  const OAUTH_CALLBACK_KEY = 'starter-scheduling-oauth-callback'
  const OAUTH_INTENT_MAX_AGE = 15 * 60 * 1000

  const EL = 'data-availability-element'
  const ACTION = 'data-availability-action'
  // Confirmed against the live Designer component: default (unselected) vs.
  // selected day-badge variant classes on the `Dashboard / Availability Item
  // (Section)` component's day Labelv2 instances.
  const DAY_VARIANT_DEFAULT = 'w-variant-89402c65-e26d-c236-91e7-76e9135a2d42'
  const DAY_VARIANT_SELECTED = 'w-variant-ebea452c-a047-af3f-dd6c-3062ee4c048c'
  const SLOTS_SEARCH_DAYS = 14
  const SLOTS_LIMIT = 8

  const activePath = window.location.pathname.replace(/\/+$/, '') || '/'
  const isStagingHost = window.location.hostname === STAGING_HOST
  const isApprovedProductionPath =
    PRODUCTION_HOSTS.has(window.location.hostname) && activePath === PRODUCTION_PATH
  if (!isStagingHost && !isApprovedProductionPath) return
  if (window.__tsSchedulingAvailabilitySection) return
  window.__tsSchedulingAvailabilitySection = true

  let sessionMemberId = null
  let memberFields = {}
  let availability = null
  let configs = []
  let grantId = null
  let grantEmail = null
  let grantCalendarId = null
  let timezone = null
  let timezonePersisted = false
  let connectionError = false
  let connectBusy = false
  let cachedItemTemplate = null
  const oauthCallback = captureOAuthCallback()

  /* ------------------------------------------------------------------ */
  /* OAuth callback capture (mirrors scheduling-availability-writer.js)  */
  /* ------------------------------------------------------------------ */

  function captureOAuthCallback() {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const grantIdParam = params.get('grant_id')
    const hasError = Boolean(params.get('error') || params.get('error_code'))
    if (!code && !grantIdParam && !hasError) {
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
      grantId: grantIdParam,
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

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */

  function qs(selector, scope) {
    return (scope || document).querySelector(selector)
  }

  function qsa(selector, scope) {
    return (scope || document).querySelectorAll(selector)
  }

  function elSel(name) {
    return '[' + EL + '="' + name + '"]'
  }

  function setElementVisible(name, visible) {
    qsa(elSel(name)).forEach(function (el) {
      el.style.display = visible ? '' : 'none'
    })
  }

  // Wires the `[data-input-timepicker]` start/end inputs inside `scope` —
  // scoped to just the item card(s) that were rendered/cloned, not a full
  // document re-scan, since global-embeds/form-embeds/timepicker/timepicker.js
  // only initializes inputs present in the DOM at its own load time otherwise.
  function initInputPickers(scope) {
    if (window.wfInputTimepicker && typeof window.wfInputTimepicker.init === 'function') {
      window.wfInputTimepicker.init(scope)
    }
  }

  function setStatus(value) {
    document.documentElement.setAttribute(STATUS_ATTRIBUTE, value)
  }

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail: detail }))
  }

  /* ------------------------------------------------------------------ */
  /* Connection state (mirrors scheduling-availability-writer.js)        */
  /* ------------------------------------------------------------------ */

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

  // Repaints this section's own chrome whenever ANY code path (including a
  // future consumer) publishes a connection-state change, so state and UI
  // never drift apart.
  window.addEventListener('starterSchedulingConnectionStateChanged', function (event) {
    repaintConnectionUI(event.detail && event.detail.state)
  })

  /* ------------------------------------------------------------------ */
  /* Member / auth helpers                                               */
  /* ------------------------------------------------------------------ */

  function memberScopeChangedError() {
    return Object.assign(new Error('Member session changed during write'), {
      code: 'MEMBER_SCOPE_CHANGED',
    })
  }

  async function currentMember(options) {
    const requireLive = Boolean(options && options.live)
    if (!requireLive && window.memberReady && typeof window.memberReady.then === 'function') {
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

  async function writeMemberId() {
    const member = await currentMember({ live: true })
    if (!sessionMemberId || member.id !== sessionMemberId) {
      throw memberScopeChangedError()
    }
    return member.id
  }

  /* ------------------------------------------------------------------ */
  /* OAuth intent bookkeeping (mirrors scheduling-availability-writer.js)*/
  /* ------------------------------------------------------------------ */

  // NOTE: Nylas' redirect-URI allowlist only contains 3 exact values (the
  // staging `--availability-stage` page and the two production
  // `/starter-dashboard` hosts — see grants/oauth/v3's contract). There is no
  // staging `/starter-dashboard` (non-stage) entry, so on the staging host a
  // Google-connect started from this section still round-trips back to the
  // `--availability-stage` page (running the old modal writer), exactly as it
  // already does for scheduling-availability-writer.js today. Production is
  // unaffected: PRODUCTION_PATH always matches the page this section lives on.
  function oauthRedirectUri() {
    return isStagingHost
      ? 'https://' + STAGING_HOST + STAGING_OAUTH_PATH
      : 'https://' + window.location.hostname + PRODUCTION_PATH
  }

  function rememberOAuthIntent(memberId, redirectUri) {
    try {
      window.sessionStorage.setItem(
        OAUTH_INTENT_PREFIX + memberId,
        JSON.stringify({ createdAt: Date.now(), redirectUri: redirectUri }),
      )
    } catch (error) {
      /* storage unavailable */
    }
  }

  function readOAuthIntent(memberId) {
    const redirectUri = oauthRedirectUri()
    if (isStagingHost) return { redirectUri: redirectUri }
    const key = OAUTH_INTENT_PREFIX + memberId
    try {
      const raw = window.sessionStorage.getItem(key)
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
      window.sessionStorage.removeItem(key)
      return null
    } catch (error) {
      try {
        window.sessionStorage.removeItem(key)
      } catch (storageError) {
        /* storage unavailable */
      }
      return null
    }
  }

  function clearOAuthIntent(memberId) {
    try {
      window.sessionStorage.removeItem(OAUTH_INTENT_PREFIX + memberId)
    } catch (error) {
      /* storage unavailable */
    }
  }

  function invalidOAuthCallback(message) {
    return Object.assign(new Error(message), { code: 'OAUTH_CALLBACK_INVALID' })
  }

  /* ------------------------------------------------------------------ */
  /* Xano transport                                                      */
  /* ------------------------------------------------------------------ */

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

  async function xanoGet(path, query) {
    if (typeof window.xanoAuthFetch !== 'function') {
      throw new Error('xanoAuthFetch is not available')
    }
    const search = query ? '?' + new URLSearchParams(query).toString() : ''
    const response = await window.xanoAuthFetch(API_BASE + path + search, {
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
  /* Timezone (mirrors scheduling-availability-writer.js)                */
  /* ------------------------------------------------------------------ */

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
      console.warn('[scheduling-section] timezone resolution failed:', error && error.message)
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

  // No single `[starter-timezone]` label in this component — every rendered
  // item carries its own `item-timezone` span. There is no per-item timezone
  // in the data model (`availability.items[id]` only has `days/start/end`),
  // so this is a display-only render of the one resolved member timezone.
  function renderTimezone() {
    qsa(elSel('item-timezone')).forEach(function (el) {
      el.textContent = timezone || ''
    })
  }

  async function ensureTimezone() {
    if (!timezone || !timezonePersisted) timezone = await resolveTimezone(null, true)
    if (!timezone || !timezonePersisted) throw new Error('Timezone is unavailable')
    renderTimezone()
    return timezone
  }

  /* ------------------------------------------------------------------ */
  /* Availability model (mirrors scheduling-availability-writer.js)      */
  /* ------------------------------------------------------------------ */

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

  function getAvailArray() {
    const availabilityArray = []
    const avails = availability.items
    for (const id in avails) {
      if (!Object.prototype.hasOwnProperty.call(avails, id)) continue
      availabilityArray.push({
        days: avails[id].days,
        start: avails[id].start,
        end: avails[id].end,
      })
    }
    return availabilityArray
  }

  // Days already claimed by OTHER override items (never `general`, never
  // `excludeId`) — used to block a day from being double-assigned to two
  // custom windows at once.
  function computeOverrides(excludeId) {
    const claimed = []
    const avails = availability.items
    for (const key in avails) {
      if (!Object.prototype.hasOwnProperty.call(avails, key)) continue
      if (key === 'general' || key === excludeId) continue
      avails[key].days.forEach(function (day) {
        if (claimed.indexOf(day) === -1) claimed.push(day)
      })
    }
    return claimed
  }

  function writeAvailabilityCache() {
    try {
      window.localStorage.setItem(
        CACHE_PREFIX + sessionMemberId,
        JSON.stringify({ cachedAt: Date.now(), availability: availability }),
      )
    } catch (error) {
      console.warn('[scheduling-section] cache unavailable:', error && error.message)
    }
  }

  async function updateAvail() {
    await ensureTimezone()
    const memberId = await writeMemberId()
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

  async function readStarterRecord() {
    const starter = await xanoPost('/starter/get_by_memberstack/v3', {
      member_id: await writeMemberId(),
    })
    return starter && typeof starter === 'object' && !Array.isArray(starter) ? starter : null
  }

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

  /* ------------------------------------------------------------------ */
  /* Nylas scheduler configurations (mirrors writer.js, step-free)       */
  /* ------------------------------------------------------------------ */

  async function getConfigs(id, failOnError) {
    try {
      const response = await xanoPost('/nylas_configurations/get_all/v3', { grant_id: id })
      if (!Array.isArray(response)) throw new Error('Configuration reader returned invalid data')
      return response
    } catch (error) {
      console.warn('[scheduling-section] getConfigs failed:', error && error.message)
      if (failOnError) throw error
      return null
    }
  }

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

  // Every rendered item form clones the same `#price` hidden input
  // (`data-rate="150"` in the current Designer template), so any one of them
  // is representative of the paid-call rate.
  function resolvePaidRate() {
    const priceInput = qs(elSel('availability-form') + ' #price')
    if (priceInput) {
      const rate = Number(priceInput.dataset.rate || priceInput.value || 0)
      if (rate > 0) return rate
    }
    try {
      const stored = Number(window.localStorage.getItem(PAID_RATE_STORAGE_KEY) || 0)
      if (stored > 0) return stored
    } catch (error) {
      /* storage unavailable */
    }
    return 0
  }

  async function createConfigPair() {
    const free = await setupConfigs('free')
    if (free === null) throw new Error('Free scheduler configuration failed')
    if (resolvePaidRate() > 0) {
      const paid = await setupConfigs('paid')
      if (paid === null) throw new Error('Paid scheduler configuration failed')
      return paid
    }
    console.info('[scheduling-section] no paid-call rate; skipping paid configuration')
    return free
  }

  async function setupConfigs(type, isUpdate, configId) {
    await ensureTimezone()
    const isPaidCall = type === 'paid'
    const openHours = getAvailArray()
    const price = isPaidCall ? String(resolvePaidRate()) : '0'
    const duration = isPaidCall ? 60 : 30
    const interval = 15
    const buffer = 10

    const firstName = memberFields['free-user'] || ''
    const lastName = memberFields['last-name'] || ''
    const memberEmail = (window.MEMBER && window.MEMBER.auth && window.MEMBER.auth.email) || ''

    const tinyTitle = isPaidCall ? 'Paid Consultation Call' : 'Free Consultation Call'
    const fullTitle = isPaidCall
      ? tinyTitle + ' - ' + duration + 'min - $' + price
      : tinyTitle + ' - ' + duration + 'min'

    const requestConfig = {}
    if (isUpdate && configId) requestConfig.config_id = configId

    const redirectURL = window.location.origin + window.location.pathname

    const payload = Object.assign({}, requestConfig, {
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
        min_booking_notice: 1440,
        additional_fields: {
          call_full_title: { type: 'metadata', label: 'Call Full Title', default: fullTitle, required: false },
          call_tiny_title: { type: 'metadata', label: 'Call Tiny Title', default: tinyTitle, required: false },
          call_type: { type: 'metadata', label: 'Call Type', default: isPaidCall ? 'paid' : 'free', required: false },
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
    })

    try {
      const res = await xanoPost(
        '/scheduler/configurations/' + (isUpdate ? 'update/v3' : 'create/v3'),
        payload,
      )
      if (res && res.response && res.response.status === 200) return true
      publishCalendarConnectionError()
      console.warn('[scheduling-section] configuration request rejected')
      return null
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] configuration request failed:', error && error.message)
      return null
    }
  }

  async function updateConfigs() {
    const configsResponse = []
    for (const record of configs) {
      const res = await setupConfigs(record.is_paid ? 'paid' : 'free', true, record.config_id)
      configsResponse.push(res)
    }
    return configsResponse.length > 0 && configsResponse.every(Boolean)
  }

  /* ------------------------------------------------------------------ */
  /* Virtual (platform-managed) calendar + disconnect                    */
  /* ------------------------------------------------------------------ */

  async function createVirtualCalendarFlow(memberId) {
    await ensureTimezone()
    const result = { status: 400, grant_id: null, email: null, calendar_id: null }
    let account = null
    try {
      const accountResponse = await xanoPost('/grants/create_virtual_account/v3', {
        member_id: memberId,
      })
      account = accountResponse && accountResponse.response && accountResponse.response.result
    } catch (error) {
      console.warn('[scheduling-section] virtual account failed:', error && error.message)
      return result
    }
    const virtualGrantId = account && account.data && account.data.id
    if (!virtualGrantId) return result

    try {
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
      console.warn('[scheduling-section] virtual calendar failed:', error && error.message)
      return result
    }
  }

  async function clearGrant(memberId, currentGrantId) {
    if (!currentGrantId) return
    await ensureTimezone()
    if (typeof window.clearGrantData === 'function') {
      await window.clearGrantData(memberId, currentGrantId)
      return
    }
    await xanoPost('/starter/clear_calendar_data/v3', { member_id: memberId })
    const currentConfigs = (await getConfigs(currentGrantId)) || []
    for (const config of currentConfigs) {
      try {
        await xanoPost('/scheduler/configurations/delete/v3', {
          grant_id: config.grant_id,
          configuration_id: config.config_id,
        })
      } catch (error) {
        console.warn('[scheduling-section] config delete failed:', error && error.message)
      }
    }
    try {
      await xanoPost('/grants/delete/v3', { in_grant_id: currentGrantId })
    } catch (error) {
      console.warn('[scheduling-section] grant delete failed:', error && error.message)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Connect / disconnect actions                                        */
  /* ------------------------------------------------------------------ */

  async function activatePlatformManager() {
    if (connectBusy || (availability && availability.manager === 'platform')) return
    connectBusy = true
    publishCalendarConnectionState('loading')
    try {
      const memberId = await writeMemberId()
      // Switching straight from Google to Platform (connect-platform stays
      // clickable while manager === 'calendar') must clear the existing
      // Google grant first — otherwise it's orphaned, still connected in
      // Nylas, while the local state moves on to platform.
      await clearGrant(memberId, grantId)
      const virtual = await createVirtualCalendarFlow(memberId)
      if (virtual.status !== 200) throw new Error('Virtual calendar setup failed')
      grantId = virtual.grant_id
      grantEmail = virtual.email
      grantCalendarId = virtual.calendar_id
      await createConfigPair()
      availability.manager = 'platform'
      await updateAvail()
      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      console.log('[scheduling-section] connected to platform calendar')
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] connect-platform failed:', error && error.message)
    } finally {
      connectBusy = false
    }
  }

  async function activateGoogleManager() {
    if (connectBusy) return
    connectBusy = true
    publishCalendarConnectionState('loading')
    try {
      const memberId = await writeMemberId()
      await clearGrant(memberId, grantId)
      grantId = null
      grantEmail = null
      grantCalendarId = null
      configs = []
      if (availability.manager !== null) {
        availability.manager = null
        await updateAvail()
      }
      await refreshCanonicalConnectionState()
      console.log('[scheduling-section] redirecting to Google Calendar OAuth')
      await handlePreRedirect()
      // On success handlePreRedirect navigates away, so connectBusy is
      // intentionally left set; a fresh page load resets module state.
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] connect-google failed:', error && error.message)
      connectBusy = false
    }
  }

  async function disconnectGoogleManager() {
    if (connectBusy) return
    connectBusy = true
    publishCalendarConnectionState('loading')
    try {
      const memberId = await writeMemberId()
      await clearGrant(memberId, grantId)
      availability.manager = null

      const virtual = await createVirtualCalendarFlow(memberId)
      if (virtual.status !== 200) {
        grantId = null
        grantEmail = null
        grantCalendarId = null
        configs = []
        publishCalendarConnectionError()
        await updateAvail()
        throw new Error('Virtual calendar setup failed after disconnect')
      }
      grantId = virtual.grant_id
      grantEmail = virtual.email
      grantCalendarId = virtual.calendar_id
      await createConfigPair()
      availability.manager = 'platform'
      await updateAvail()
      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      console.log('[scheduling-section] disconnected Google Calendar, reverted to platform')
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] disconnect-google failed:', error && error.message)
    } finally {
      connectBusy = false
    }
  }

  async function handlePreRedirect() {
    try {
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
      rememberOAuthIntent(memberId, redirectUri)
      window.location.assign(url)
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] OAuth redirect failed:', error && error.message)
      throw error
    }
  }

  async function consumeOAuthCallback() {
    const oauthCode = oauthCallback.code
    const oauthGrantId = oauthCallback.grantId
    const oauthState = oauthCallback.state
    try {
      const memberId = await writeMemberId()
      if (!oauthState || oauthState !== memberId) {
        throw invalidOAuthCallback('OAuth state does not match the logged-in member')
      }
      if (oauthCallback.hasError) {
        throw invalidOAuthCallback('OAuth authorization was cancelled or failed')
      }
      if (oauthGrantId && oauthCallback.success !== 'true') {
        throw invalidOAuthCallback('Hosted OAuth did not report success')
      }
      const oauthIntent = readOAuthIntent(memberId)
      if (!oauthIntent) {
        throw invalidOAuthCallback('OAuth return was not initiated by this session')
      }
      await ensureTimezone()
      const grantPayload = {
        member_id: memberId,
        in_redirect_uri: oauthIntent.redirectUri,
        in_state: oauthState,
      }
      if (oauthCode) grantPayload.code = oauthCode
      else grantPayload.in_grant_id = oauthGrantId
      const grant = await xanoPost('/grants/add/v3', grantPayload)
      if (!(grant && grant.grant_id)) throw new Error('grants/add/v3 returned no grant')
      clearOAuthIntent(memberId)
      clearOAuthCallback()
      await refreshCanonicalConnectionState()
      console.log('[scheduling-section] Google Calendar connected via OAuth')
    } catch (error) {
      publishCalendarConnectionError()
      if (error && error.code === 'OAUTH_CALLBACK_INVALID') clearOAuthCallback()
      console.warn('[scheduling-section] OAuth grant save failed:', error && error.message)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Action-target resolution                                            */
  /* ------------------------------------------------------------------ */

  // Resolves the clickable element for `action` inside `wrapper`: prefers an
  // explicit `[data-availability-action="<action>"]` descendant (the
  // Designer wrapper divs), falling back to `wrapper`'s ordinal child at
  // `index` when the attribute hasn't been added yet. Both cases resolve to
  // a real element since the wrapper divs, once added, sit at the same
  // ordinal position as the bare buttons they wrap.
  function resolveActionTarget(wrapper, action, index) {
    if (!wrapper) return null
    return qs('[' + ACTION + '="' + action + '"]', wrapper) || (wrapper.children ? wrapper.children[index] : null)
  }

  function bindActionGroup(wrapper, actionsInOrder, handler) {
    if (!wrapper) return
    actionsInOrder.forEach(function (action, i) {
      const tagged = qs('[' + ACTION + '="' + action + '"]', wrapper)
      const target = tagged || (wrapper.children ? wrapper.children[i] : null)
      if (!target) return
      if (!tagged) {
        console.warn(
          '[scheduling-section] missing [' + ACTION + '="' + action + '"]; using ordinal position ' + i + ' as a fallback',
        )
      }
      target.addEventListener('click', function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault()
        handler(action, target)
      })
    })
  }

  function findByText(root, pattern) {
    if (!root) return null
    const all = qsa('*', root)
    let best = null
    for (let i = 0; i < all.length; i++) {
      const el = all[i]
      const text = el.textContent || ''
      if (pattern.test(text) && (!best || text.length < (best.textContent || '').length)) {
        best = el
      }
    }
    return best
  }

  /* ------------------------------------------------------------------ */
  /* Connection chrome (connect-wrapper / main-wrapper)                  */
  /* ------------------------------------------------------------------ */

  function applyConnectLabels(state) {
    const group = qs(elSel('connect-label-group'))
    if (!group || !group.children) return
    const connected = state === 'connected'
    if (group.children[0]) group.children[0].style.display = connected ? 'none' : ''
    if (group.children[1]) group.children[1].style.display = connected ? '' : 'none'
  }

  // Platform can't be disconnected outright — only switched away from by
  // connecting Google. So: not-on-platform shows "Connect Platform"; not-on-
  // Google shows "Connect Google"; only on-Google shows "Disconnect Google".
  function applyConnectButtonVisibility() {
    const wrapper = qs(elSel('connect-btn-wrapper'))
    if (!wrapper) return
    const manager = availability && availability.manager
    const rules = [
      ['connect-platform', manager !== 'platform'],
      ['connect-google', manager !== 'calendar'],
      ['disconnect-google', manager === 'calendar'],
    ]
    rules.forEach(function (rule, i) {
      const target = resolveActionTarget(wrapper, rule[0], i)
      if (target) target.style.display = rule[1] ? '' : 'none'
    })
  }

  function applyConnectInfoVisibility(state) {
    setElementVisible('connect-info-wrapper', state !== 'connected')
  }

  function repaintConnectionUI(state) {
    setElementVisible('main-wrapper', state === 'connected' || state === 'reconnect')
    applyConnectLabels(state)
    applyConnectButtonVisibility()
    applyConnectInfoVisibility(state)
  }

  function bindConnectButtons() {
    const wrapper = qs(elSel('connect-btn-wrapper'))
    bindActionGroup(wrapper, ['connect-platform', 'connect-google', 'disconnect-google'], function (action) {
      if (action === 'connect-platform') activatePlatformManager()
      else if (action === 'connect-google') activateGoogleManager()
      else if (action === 'disconnect-google') disconnectGoogleManager()
    })
  }

  /* ------------------------------------------------------------------ */
  /* Item rendering                                                      */
  /* ------------------------------------------------------------------ */

  function getItemHeadlineParts(card) {
    return {
      timeWrapper: qs(elSel('item-time-wrapper'), card),
      daysWrapper: qs(elSel('item-days-wrapper'), card),
    }
  }

  function getItemFormPieces(card) {
    const formWrapperEl = qs(elSel('availability-form-wrapper'), card)
    if (!formWrapperEl) return {}
    const form = qs(elSel('availability-form'), formWrapperEl)
    const editInner = formWrapperEl.children ? formWrapperEl.children[0] : null
    const buttonRow =
      editInner && editInner.children && editInner.children.length
        ? editInner.children[editInner.children.length - 1]
        : null
    return { formWrapperEl: formWrapperEl, form: form, buttonRow: buttonRow }
  }

  function applyDayBadges(card, days) {
    const parts = getItemHeadlineParts(card)
    if (!parts.daysWrapper || !parts.daysWrapper.children) return
    const badges = parts.daysWrapper.children
    for (let i = 0; i < badges.length; i++) {
      const badge = badges[i]
      const selected = Array.isArray(days) && days.indexOf(i) > -1
      badge.classList.remove(selected ? DAY_VARIANT_DEFAULT : DAY_VARIANT_SELECTED)
      badge.classList.add(selected ? DAY_VARIANT_SELECTED : DAY_VARIANT_DEFAULT)
    }
  }

  function applyItemTimeText(card, avail) {
    const parts = getItemHeadlineParts(card)
    if (!parts.timeWrapper || !parts.timeWrapper.children) return
    const children = parts.timeWrapper.children
    if (children[0]) children[0].textContent = avail.start || ''
    if (children[2]) children[2].textContent = avail.end || ''
    const tzEl = qs(elSel('item-timezone'), parts.timeWrapper)
    if (tzEl) tzEl.textContent = timezone || ''
  }

  // The example "General Availability" item in the Designer template has its
  // "Main schedule" tag hidden (Visibility=false); this reuses that polarity
  // — hidden for `general`, shown for override items — so members can tell a
  // custom window apart from the default schedule. Verify against a real
  // multi-item starter record before shipping; flip the ternary if wrong.
  function applyItemTag(card, id) {
    const topContent = qs(elSel('item-top-content'), card)
    const tag = topContent && topContent.children ? topContent.children[1] : null
    if (!tag) return
    tag.style.display = id === 'general' ? 'none' : ''
  }

  // Every item needs its edit button (and the row that holds it) visible;
  // `general` can never be removed (see handleAvailabilityRemove's guard),
  // so its remove button stays hidden while override items show both.
  function applyItemActionVisibility(card, id) {
    const buttonGroup = qs(elSel('item-button-group'), card)
    if (!buttonGroup) return
    buttonGroup.style.display = ''
    const editBtn = resolveActionTarget(buttonGroup, 'item-form-open', 0)
    const removeBtn = resolveActionTarget(buttonGroup, 'item-remove', 1)
    if (editBtn) editBtn.style.display = ''
    if (removeBtn) removeBtn.style.display = id === 'general' ? 'none' : ''
  }

  function closeItemForm(card) {
    const wrapper = qs(elSel('availability-form-wrapper'), card)
    if (wrapper) wrapper.style.display = 'none'
  }

  function isItemFormOpen(card) {
    const wrapper = qs(elSel('availability-form-wrapper'), card)
    return Boolean(wrapper) && wrapper.style.display === 'block'
  }

  function populateItemForm(form, id) {
    const item = availability.items[id]
    const overrides = computeOverrides(id)
    const dayInputs = qsa('[type=checkbox][name=avail-day]', form)
    dayInputs.forEach(function (day, i) {
      const selected = Boolean(item && item.days.indexOf(i) > -1)
      day.checked = selected
      const blocked = overrides.indexOf(i) > -1 && !selected
      day.disabled = blocked
      if (day.parentElement) {
        if (blocked) day.parentElement.classList.add('overridden')
        else day.parentElement.classList.remove('overridden')
        // Webflow's custom checkbox skin is a sibling element, not the real
        // (visually hidden) input — it needs its own "checked" class for the
        // checkmark to render, mirroring what a native user click would do.
        const box = qs('.w-checkbox-input', day.parentElement)
        if (box) {
          if (selected) box.classList.add('w--redirected-checked')
          else box.classList.remove('w--redirected-checked')
        }
      }
    })
    const startInput = qs('[name=start-time]', form)
    if (startInput) startInput.value = item ? item.start : ''
    const endInput = qs('[name=end-time]', form)
    if (endInput) endInput.value = item ? item.end : ''
    const card = form.closest(elSel('item-card'))
    if (card) applyDayBadges(card, item ? item.days : [])
  }

  function openItemForm(card, id) {
    const { form } = getItemFormPieces(card)
    const wrapper = qs(elSel('availability-form-wrapper'), card)
    if (!form || !wrapper) return
    form.setAttribute('data-availability-id', id)
    form.dataset.availabilityId = id
    populateItemForm(form, id)
    wrapper.style.display = 'block'
  }

  function toggleItemForm(card, id) {
    if (isItemFormOpen(card)) closeItemForm(card)
    else openItemForm(card, id)
  }

  function bindItemActions(card, id) {
    const buttonGroup = qs(elSel('item-button-group'), card)
    bindActionGroup(buttonGroup, ['item-form-open', 'item-remove'], function (action) {
      if (action === 'item-form-open') {
        // Opening/closing the form is a pure UI toggle — it doesn't change
        // availability data, so it must not disturb the slots preview.
        toggleItemForm(card, id)
      } else if (action === 'item-remove') {
        // Wait for the mutation to actually land before refreshing slots —
        // firing them concurrently could render a slots list computed from
        // the availability that's about to be replaced.
        handleAvailabilityRemove(card, id).then(renderSlotsPreview)
      }
    })

    const { form, buttonRow } = getItemFormPieces(card)
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault()
      })
    }
    bindActionGroup(buttonRow, ['item-form-close', 'item-form-submit'], function (action) {
      if (action === 'item-form-close') {
        if (availability.items[id]) closeItemForm(card)
        else card.remove()
      } else if (action === 'item-form-submit') {
        availFormHandler(card, id).then(renderSlotsPreview)
      }
    })
  }

  function generateItemId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID()
    }
    return 'override-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  }

  function renderAvailabilityItems() {
    if (!cachedItemTemplate) cachedItemTemplate = qs(elSel('item-template'))
    const template = cachedItemTemplate
    const list = qs(elSel('list'))
    if (!template || !list) {
      console.warn('[scheduling-section] item template/list missing')
      return
    }

    // Guard against `template.style.display` already being 'none' from a
    // previous render of this same (never-restored) master template —
    // otherwise every subsequent clone inherits 'none' and stays hidden.
    const templateDisplay = template.style.display === 'none' ? '' : template.style.display
    template.setAttribute('hidden', '')
    template.setAttribute('aria-hidden', 'true')
    template.style.display = 'none'

    // Clear only previously rendered clones, keeping the loading spinner and
    // the (now hidden) template intact — both are siblings inside `list`.
    qsa(elSel('item-card'), list).forEach(function (el) {
      el.remove()
    })

    const avails = availability.items
    for (const id in avails) {
      if (!Object.prototype.hasOwnProperty.call(avails, id)) continue
      const avail = avails[id]

      const card = template.cloneNode(true)
      card.removeAttribute('hidden')
      card.removeAttribute('aria-hidden')
      card.style.display = templateDisplay
      card.setAttribute(EL, 'item-card')
      card.dataset.id = id
      card.setAttribute('data-id', id)

      const titleEl = qs(elSel('item-title'), card)
      if (titleEl) {
        titleEl.textContent = id === 'general' ? 'General Availability' : daysAlias(avail.days).full
      }

      applyItemTag(card, id)
      applyItemActionVisibility(card, id)
      applyDayBadges(card, avail.days)
      applyItemTimeText(card, avail)
      closeItemForm(card)
      bindItemActions(card, id)

      list.appendChild(card)
    }

    initInputPickers(list)
    setElementVisible('loading-settings', false)
  }

  function handleCreateAvailability() {
    if (!cachedItemTemplate) cachedItemTemplate = qs(elSel('item-template'))
    const template = cachedItemTemplate
    const list = qs(elSel('list'))
    if (!template || !list) return

    const id = generateItemId()
    const templateDisplay = template.style.display === 'none' ? '' : template.style.display
    const card = template.cloneNode(true)
    card.removeAttribute('hidden')
    card.removeAttribute('aria-hidden')
    card.style.display = templateDisplay
    card.setAttribute(EL, 'item-card')
    card.dataset.id = id
    card.setAttribute('data-id', id)

    const titleEl = qs(elSel('item-title'), card)
    if (titleEl) titleEl.textContent = 'New availability window'

    applyItemTag(card, id)
    applyItemActionVisibility(card, id)
    applyDayBadges(card, [])
    applyItemTimeText(card, { start: '', end: '' })
    closeItemForm(card)
    bindItemActions(card, id)

    list.appendChild(card)
    initInputPickers(card)
    openItemForm(card, id)
  }

  function bindCreateTrigger() {
    const mainWrapper = qs(elSel('main-wrapper'))
    let trigger = qs('[' + ACTION + '="availability-create"]')
    if (!trigger && mainWrapper) {
      trigger = findByText(mainWrapper, /add availability/i)
      if (trigger) {
        console.warn(
          '[scheduling-section] missing [' + ACTION + '="availability-create"]; matched "Add availability window" by text as a fallback',
        )
      }
    }
    if (!trigger) return
    trigger.addEventListener('click', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      handleCreateAvailability()
    })
  }

  /* ------------------------------------------------------------------ */
  /* Item form submit / remove                                           */
  /* ------------------------------------------------------------------ */

  async function availFormHandler(card, id) {
    const { form } = getItemFormPieces(card)
    if (!form) return

    const dayInputs = qsa('[type=checkbox][name=avail-day]', form)
    const selectedDays = []
    dayInputs.forEach(function (day, i) {
      if (day.checked) selectedDays.push(i)
    })
    if (selectedDays.length === 0) {
      console.warn('[scheduling-section] select at least one available day')
      return
    }
    const startInput = qs('[name=start-time]', form)
    if (!(startInput && startInput.value)) {
      console.warn('[scheduling-section] start time required')
      return
    }
    const endInput = qs('[name=end-time]', form)
    if (!(endInput && endInput.value)) {
      console.warn('[scheduling-section] end time required')
      return
    }

    const availId = form.dataset.availabilityId || id || 'general'
    const avail = { days: selectedDays, start: startInput.value, end: endInput.value }

    try {
      if (availId !== 'general') {
        const general = availability.items.general
        if (general) {
          general.days = general.days.filter(function (day) {
            return avail.days.indexOf(day) === -1
          })
          availability.items.general = general
        }
      } else {
        avail.defaultDays = avail.days
      }

      availability.items[availId] = avail
      await updateAvail()

      if (grantId && configs.length !== 0) {
        const updated = await updateConfigs()
        if (!updated) throw new Error('Scheduler configuration update failed')
      } else if (grantId && configs.length === 0) {
        await createConfigPair()
      }

      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      console.log('[scheduling-section] availability saved', { id: availId, avail: avail })
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] availability save failed:', error && error.message)
    }
  }

  async function handleAvailabilityRemove(card, id) {
    if (id === 'general') {
      console.warn('[scheduling-section] cannot remove the general availability window')
      return
    }
    const removed = availability.items[id]
    const general = availability.items.general
    if (!removed || !general) return
    removed.days.forEach(function (day) {
      if (general.defaultDays && general.defaultDays.indexOf(day) > -1) {
        general.days.push(day)
      }
    })
    availability.items.general = general
    delete availability.items[id]

    try {
      await updateAvail()
      if (grantId && configs.length !== 0) {
        const updated = await updateConfigs()
        if (!updated) throw new Error('Scheduler configuration update failed')
      }
      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      console.log('[scheduling-section] availability removed', { id: id })
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] availability remove failed:', error && error.message)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Live bookable slots preview                                         */
  /* ------------------------------------------------------------------ */

  // Adapted from `getNextAvailableTimeSlot` in the external
  // wf code\_V3\Bookings\site-pages-scripts\book-func-lib-2.html (not part
  // of this git repo — that file's single-slot `.reduce()` needs a matching
  // update to expose the full list, tracked as a separate deployment).
  async function getUpcomingTimeSlots(options) {
    const opts = options || {}
    const grant = opts.grantId
    const configId = opts.configId
    const searchDays = opts.searchDays || SLOTS_SEARCH_DAYS
    const limit = opts.limit || SLOTS_LIMIT
    const region = opts.region || 'us'
    if (!grant || !configId) return []

    const nowInSeconds = Math.floor(Date.now() / 1000) + 24 * 60 * 60
    const searchEndInSeconds = nowInSeconds + searchDays * 24 * 60 * 60

    try {
      const response = await xanoGet('/scheduler/get_availability/v3', {
        grant_id: grant,
        configuration_id: configId,
        start_time: String(nowInSeconds),
        end_time: String(searchEndInSeconds),
        region: region,
      })
      const timeSlots = (response && response.time_slots) || []
      if (!Array.isArray(timeSlots)) return []
      return timeSlots
        .map(function (slot) {
          return Number(slot && slot.start_time)
        })
        .filter(function (startTime) {
          return Number.isFinite(startTime) && startTime >= nowInSeconds
        })
        .sort(function (a, b) {
          return a - b
        })
        .slice(0, limit)
    } catch (error) {
      console.warn('[scheduling-section] getUpcomingTimeSlots failed:', error && error.message)
      return []
    }
  }

  function formatSlotTime(startTimeSeconds) {
    const date = new Date(startTimeSeconds * 1000)
    try {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(date)
    } catch (error) {
      return date.toString()
    }
  }

  // Renders as a plain list built directly by this script — the 2 existing
  // (empty) HtmlEmbeds inside `slots-wrapper` are out of scope and ignored.
  function renderSlotsList(wrapper, slots) {
    let list = qs(elSel('slots-list'), wrapper)
    if (!list) {
      list = document.createElement('div')
      list.setAttribute(EL, 'slots-list')
      wrapper.appendChild(list)
    }
    list.innerHTML = ''
    if (!slots.length) {
      const empty = document.createElement('div')
      empty.textContent = 'No upcoming open slots found.'
      list.appendChild(empty)
      return
    }
    slots.forEach(function (startTime) {
      const row = document.createElement('div')
      row.textContent = formatSlotTime(startTime)
      list.appendChild(row)
    })
  }

  async function renderSlotsPreview() {
    const wrapper = qs(elSel('slots-wrapper'))
    if (!wrapper) return
    setElementVisible('slots-list', false)
    setElementVisible('loading-slots', true)
    const generalConfig =
      configs.filter(function (c) {
        return !c.is_paid
      })[0] || configs[0]
    if (!grantId || !generalConfig) {
      setElementVisible('loading-slots', false)
      return
    }
    const slots = await getUpcomingTimeSlots({
      grantId: grantId,
      configId: generalConfig.config_id,
      searchDays: SLOTS_SEARCH_DAYS,
      limit: SLOTS_LIMIT,
    })
    renderSlotsList(wrapper, slots)
    setElementVisible('loading-slots', false)
    setElementVisible('slots-list', true)
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  async function initialize() {
    const root = qs(elSel('section'))
    if (!root) {
      setStatus('not-applicable')
      return null
    }
    if (typeof window.xanoAuthFetch !== 'function') {
      setStatus('missing-auth')
      console.warn('[scheduling-section] xanoAuthFetch unavailable; section disabled')
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

      const starterRecord = await readStarterRecord()
      const canonicalAvailability = starterRecord && starterRecord.availability
      availability = isAvailability(canonicalAvailability)
        ? canonicalAvailability
        : { items: {}, manager: null }
      window.STARTER_AVAILABILITY = availability

      grantId = (starterRecord && starterRecord.nylas_grant_id) || null
      grantEmail = (starterRecord && starterRecord.nylas_grant_email) || null
      grantCalendarId = (starterRecord && starterRecord.nylas_calendar_id) || null

      timezone = await resolveTimezone(starterRecord, false)

      if (oauthCallback) {
        await consumeOAuthCallback()
      }

      if (grantId) {
        configs = (await getConfigs(grantId, true)) || []
      }

      bindConnectButtons()
      bindCreateTrigger()
      renderAvailabilityItems()

      const priceInput = qs(elSel('availability-form') + ' #price')
      if (priceInput) {
        const rate = Number(priceInput.dataset.rate || 0)
        priceInput.value = rate
        try {
          window.localStorage.setItem(PAID_RATE_STORAGE_KEY, rate)
        } catch (error) {
          /* storage unavailable */
        }
      }

      const state = await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      renderSlotsPreview()

      publishCalendarConnectionState(state)
      setStatus('ready')
      emit('starterSchedulingSectionReady', { memberId: sessionMemberId })
      return 'ready'
    } catch (error) {
      publishCalendarConnectionError()
      setStatus('error')
      setElementVisible('loading-settings', false)
      setElementVisible('loading-slots', false)
      console.warn('[scheduling-section] initialization failed:', error && error.message)
      return null
    }
  }

  window.StarterSchedulingAvailabilitySection = {
    initialize: initialize,
    daysAlias: daysAlias,
    getAvailArray: getAvailArray,
    applyDayBadges: applyDayBadges,
    getUpcomingTimeSlots: getUpcomingTimeSlots,
    publishCalendarConnectionState: publishCalendarConnectionState,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true })
  } else {
    initialize()
  }
})()
