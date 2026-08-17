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
  // Save/remove/connect/disconnect results surface through the shared
  // "Availability - Notifications" modal (`[data-modal-target=
  // "availability-notification"]`) — see the "Notification modal" section
  // below. Every action also still logs its outcome to the console.

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

  // Shared "Availability - Notifications" modal (`[data-modal-target=
  // "availability-notification"]`), driven by global-embeds/modal/modal.js.
  // One instance covers every open-*/confirm action below by switching which
  // `[notification-type]` step is visible before/while opening it.
  const NOTIFICATION_ATTR = 'notification-type'
  const NOTIFICATION_MODAL_ID = 'availability-notification'
  const ERROR_TEXT_ITEM_SAVE =
    "We couldn't save this availability window. Please try again or contact support."
  const ERROR_TEXT_ITEM_REMOVE =
    "We couldn't remove this availability window. Please try again or contact support."
  const ERROR_TEXT_CONNECT_PLATFORM =
    "We couldn't connect your platform calendar. Please try again or contact support."
  const ERROR_TEXT_CONNECT_GOOGLE =
    "We couldn't connect your Google calendar. Please try again or contact support."
  const ERROR_TEXT_DISCONNECT_GOOGLE =
    "We couldn't disconnect your Google calendar. Please try again or contact support."

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
  let creatingDraft = false
  let selectedPreviewConfigId = null
  let selectedPreviewDateKey = null
  let selectedPreviewSlotStart = null
  let previewRenderVersion = 0
  // Set by the per-item "open-item-remove" trigger, consumed by the
  // notification modal's "item-remove" confirm button.
  let pendingRemoveId = null
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

  const TIMEPICKER_INIT_RETRY_MS = 100
  const TIMEPICKER_INIT_MAX_ATTEMPTS = 40 // ~4s ceiling before giving up

  // Wires the `[data-input-timepicker]` start/end inputs inside `scope` —
  // scoped to just the item card(s) that were rendered/cloned, not a full
  // document re-scan, since global-embeds/form-embeds/timepicker/timepicker.js
  // only initializes inputs present in the DOM at its own load time otherwise.
  //
  // `window.wfInputTimepicker` is attached by that other script asynchronously
  // (it's a separate <script> tag); nothing guarantees it has run by the time
  // this module's own initialize()/renderAvailabilityItems() fires, especially
  // on a fresh page load. Calling this once and silently no-op'ing when the
  // global isn't there yet (the old behavior) meant the very first render
  // could permanently ship with no timepickers wired up. Retry instead until
  // the global appears.
  function initInputPickers(scope, attempt) {
    if (window.wfInputTimepicker && typeof window.wfInputTimepicker.init === 'function') {
      window.wfInputTimepicker.init(scope)
      return
    }
    const tries = attempt || 0
    if (tries >= TIMEPICKER_INIT_MAX_ATTEMPTS) {
      console.warn('[scheduling-section] window.wfInputTimepicker never became available; timepickers not wired up')
      return
    }
    setTimeout(function () {
      initInputPickers(scope, tries + 1)
    }, TIMEPICKER_INIT_RETRY_MS)
  }

  // A cloned item-card carries over the item-template's own timepicker
  // markup verbatim: the master template sits inside `[data-availability-
  // element="list"]` (just hidden, never removed), so the very first
  // initInputPickers(list) call also scans and marks IT initialized —
  // meaning every later clone inherits `data-input-timepicker-
  // initialized="true"` on `[data-input-timepicker-group]` and bails out of
  // global-embeds/form-embeds/timepicker/timepicker.js's initGroup() guard
  // before ever wiring up. Cloned `[data-input-timepicker]` inputs also
  // duplicate the template's `id`. Strip both right after cloning, before
  // initInputPickers() runs on the clone.
  function resetTimepickerMarkup(card) {
    qsa('[data-input-timepicker-group]', card).forEach(function (el) {
      el.removeAttribute('data-input-timepicker-initialized')
    })
    qsa('[data-input-timepicker]', card).forEach(function (el) {
      el.removeAttribute('id')
    })
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

  // A member connecting a calendar for the first time (platform or Google)
  // has no `general` item yet — left as-is, createFreeConfig() would build
  // the scheduler config with empty open hours, and nobody could ever book a
  // slot. Seed a Mon-Fri 09:00-18:00 default so the connection is usable
  // right away; the member can edit it or add overrides afterward. Never
  // touches an already-existing `general` item. Returns whether it actually
  // seeded anything, so callers can tell whether a persist is needed.
  function ensureDefaultAvailability() {
    if (!availability || availability.items.general) return false
    const days = [1, 2, 3, 4, 5]
    availability.items.general = { days: days, start: '09:00', end: '18:00', defaultDays: days }
    return true
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

  // Calendar setup owns only the free-call configuration. Paid services are
  // created, updated, and disabled through the canonical paid-call settings
  // endpoints, never from a DOM value or browser cache.
  async function createFreeConfig() {
    const free = await setupConfigs('free')
    if (free === null) throw new Error('Free scheduler configuration failed')
    return free
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
        min_booking_notice: 1440,
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
    if (res && res.response && res.response.status === 200) return true
    publishCalendarConnectionError()
    return null
  }

  async function updateConfigs() {
    configs = await getConfigs(grantId, true)
    const configsResponse = []
    for (const record of configs.filter(function (config) { return config.active !== false })) {
      const res = await updateConfigAvailability(record)
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

  async function clearGrant(currentGrantId) {
    if (!currentGrantId) return
    await ensureTimezone()
    // The authenticated Xano route owns the complete provider-first lifecycle:
    // active-booking guard, Nylas grant deletion, configuration cleanup,
    // canonical availability cleanup, and Memberstack reconciliation. Never
    // call the page's legacy clearGrantData helper or clear canonical fields
    // before this request, because doing so removes the ownership proof that
    // the composite route needs to delete the provider grant safely.
    const result = await xanoPost('/grants/delete/v3', { in_grant_id: currentGrantId })
    if (!result || result.connected !== false) {
      throw new Error('grants/delete/v3 returned an invalid disconnected state')
    }
    return result
  }

  /* ------------------------------------------------------------------ */
  /* Connect / disconnect actions                                        */
  /* ------------------------------------------------------------------ */

  async function activatePlatformManager() {
    if (connectBusy || (availability && availability.manager === 'platform')) return
    connectBusy = true
    setRequestBusy(true)
    publishCalendarConnectionState('loading')
    try {
      const memberId = await writeMemberId()
      // Switching straight from Google to Platform (connect-platform stays
      // clickable while manager === 'calendar') must clear the existing
      // Google grant first — otherwise it's orphaned, still connected in
      // Nylas, while the local state moves on to platform.
      await clearGrant(grantId)
      const virtual = await createVirtualCalendarFlow(memberId)
      if (virtual.status !== 200) throw new Error('Virtual calendar setup failed')
      grantId = virtual.grant_id
      grantEmail = virtual.email
      grantCalendarId = virtual.calendar_id
      ensureDefaultAvailability()
      await createFreeConfig()
      availability.manager = 'platform'
      await updateAvail()
      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      renderSlotsPreview()
      console.log('[scheduling-section] connected to platform calendar')
      return true
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] connect-platform failed:', error && error.message)
      return false
    } finally {
      connectBusy = false
      setRequestBusy(false)
    }
  }

  async function activateGoogleManager() {
    if (connectBusy) return
    connectBusy = true
    setRequestBusy(true)
    publishCalendarConnectionState('loading')
    try {
      const memberId = await writeMemberId()
      await clearGrant(grantId)
      grantId = null
      grantEmail = null
      grantCalendarId = null
      configs = []
      const hadManager = availability.manager !== null
      availability.manager = null
      // A member with no availability saved yet (manager already null, so
      // the branch above alone would never persist anything) has no
      // canonical availability row in Xano at all — refreshCanonicalConnectionState()'s
      // strict isAvailability() check throws on that, aborting the redirect
      // before the member ever reaches Google. Seed the same first-connect
      // default used elsewhere and persist whenever anything actually changed.
      const seededDefault = ensureDefaultAvailability()
      if (hadManager || seededDefault) {
        await updateAvail()
      }
      await refreshCanonicalConnectionState()
      console.log('[scheduling-section] redirecting to Google Calendar OAuth')
      await handlePreRedirect()
      // On success handlePreRedirect navigates away, so connectBusy is
      // intentionally left set; a fresh page load resets module state.
      return true
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] connect-google failed:', error && error.message)
      connectBusy = false
      setRequestBusy(false)
      return false
    }
  }

  async function disconnectGoogleManager() {
    if (connectBusy) return
    connectBusy = true
    setRequestBusy(true)
    publishCalendarConnectionState('loading')
    try {
      const memberId = await writeMemberId()
      await clearGrant(grantId)
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
      ensureDefaultAvailability()
      await createFreeConfig()
      availability.manager = 'platform'
      await updateAvail()
      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      renderSlotsPreview()
      console.log('[scheduling-section] disconnected Google Calendar, reverted to platform')
      return true
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] disconnect-google failed:', error && error.message)
      return false
    } finally {
      connectBusy = false
      setRequestBusy(false)
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
      // Mirror activatePlatformManager/disconnectGoogleManager: the manager
      // switch must be persisted here, not just left for the caller — this is
      // the only place that observes the freshly-added Google grant.
      availability.manager = 'calendar'
      ensureDefaultAvailability()
      await updateAvail()
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
  /* Notification modal (Availability - Notifications)                   */
  /* ------------------------------------------------------------------ */

  // Cached like cachedItemTemplate elsewhere in this file — cheap to
  // re-query on the rare miss, permanent once found.
  let cachedNotificationModal = null
  function notificationModal() {
    if (!cachedNotificationModal) {
      cachedNotificationModal = qs('[data-modal-target="' + NOTIFICATION_MODAL_ID + '"]')
    }
    return cachedNotificationModal
  }

  // Hides every `[notification-type]` step except the one matching `type`.
  // Calling with a value that matches nothing (e.g. undefined) hides all of
  // them — used at bind time so a stray/URL-triggered modal.js auto-open
  // (`?modal-id=availability-notification`) never shows every step stacked.
  function switchNotification(type) {
    qsa('[' + NOTIFICATION_ATTR + ']', notificationModal()).forEach(function (el) {
      el.style.display = el.getAttribute(NOTIFICATION_ATTR) === type ? '' : 'none'
    })
  }

  function openNotification(type) {
    switchNotification(type)
    if (window.lumos && window.lumos.modal) window.lumos.modal.open(NOTIFICATION_MODAL_ID)
  }

  // Also used for failures discovered before any open-* trigger ran in this
  // page load (e.g. consumeOAuthCallback on the post-redirect return), where
  // the modal isn't open yet — `dialog.open` is the live, browser-maintained
  // flag for that, so this only calls modal.open() when it's actually
  // needed (calling showModal() on an already-open <dialog> throws).
  function showNotificationError(text) {
    const modal = notificationModal()
    const errorEl = modal && qs('[error-text-element]', modal)
    if (errorEl) errorEl.textContent = text
    switchNotification('request-error')
    if (modal && !modal.open && window.lumos && window.lumos.modal) {
      window.lumos.modal.open(NOTIFICATION_MODAL_ID)
    }
  }

  // Disables the whole Close/confirm button row (not just the clicked
  // button) so a member can't dismiss the modal mid-request while a
  // remove/disconnect call is in flight — mirrors setRequestBusy's
  // pointer-events/opacity toggle elsewhere in this file.
  function setNotificationBusy(target, busy) {
    const group = target && target.closest('.call-sched_button-group')
    if (!group) return
    group.style.pointerEvents = busy ? 'none' : ''
    group.style.opacity = busy ? '0.6' : ''
  }

  // Binds every `[data-availability-action]` element living inside the
  // shared notification modal — the open-* triggers live elsewhere
  // (bindConnectButtons/bindItemActions) and only call openNotification();
  // this handles the confirm/continue actions that live inside the modal
  // itself and actually run the underlying request.
  function bindNotificationModalActions() {
    const modal = notificationModal()
    if (!modal) return
    switchNotification(undefined)
    qsa('[' + ACTION + ']', modal).forEach(function (target) {
      const action = target.getAttribute(ACTION)
      target.addEventListener('click', function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault()
        if (action === 'connect-google') {
          // Confirmed switching from platform — continue into the same
          // pre-oauth step a fresh connect would show.
          switchNotification('pre-oauth')
        } else if (action === 'open-oauth-redirect') {
          switchNotification('oauth-redirect')
          activateGoogleManager().then(function (ok) {
            if (ok === false) showNotificationError(ERROR_TEXT_CONNECT_GOOGLE)
          })
        } else if (action === 'disconnect-google') {
          setNotificationBusy(target, true)
          disconnectGoogleManager()
            .then(function (ok) {
              if (ok) switchNotification('calendar-disconnected')
              else showNotificationError(ERROR_TEXT_DISCONNECT_GOOGLE)
            })
            .finally(function () {
              setNotificationBusy(target, false)
            })
        } else if (action === 'item-remove') {
          if (!pendingRemoveId) return
          const id = pendingRemoveId
          setNotificationBusy(target, true)
          handleAvailabilityRemove(id)
            .then(function (ok) {
              if (!ok) {
                showNotificationError(ERROR_TEXT_ITEM_REMOVE)
                return
              }
              pendingRemoveId = null
              switchNotification('availability-removed')
              return renderSlotsPreview()
            })
            .finally(function () {
              setNotificationBusy(target, false)
            })
        }
      })
    })
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

  /* ------------------------------------------------------------------ */
  /* Connection chrome (labels / buttons / connect-info-wrapper)         */
  /* ------------------------------------------------------------------ */

  // 'loading' means the request is still in flight — leave the label as
  // whatever it already showed until a real (non-loading) state arrives, so
  // clicking connect/reconnect/disconnect doesn't flash the "disconnected"
  // label before the request even resolves.
  //
  // `connect-label-group` holds three `[data-availability-element=
  // "connect-label"]` instances: `[data-type="false"]` ("Disconnected") plus
  // two `[data-type="true"][data-manager]` variants, one per manager
  // ("platform" / "calendar") — only the one matching the live
  // `availability.manager` is shown while connected.
  function applyConnectLabels(state) {
    if (state === 'loading') return
    const connected = state === 'connected' || state === 'reconnect'
    const manager = availability && availability.manager
    const labels = qsa(elSel('connect-label'))
    if (labels.length) {
      labels.forEach(function (label) {
        const isConnectedVariant = label.getAttribute('data-type') === 'true'
        const visible = isConnectedVariant
          ? connected && label.getAttribute('data-manager') === manager
          : !connected
        label.style.display = visible ? '' : 'none'
      })
      return
    }
    // Legacy fallback for markup predating [data-type]/[data-manager]: a
    // plain 2-child group, ordinal position 0 = disconnected, 1 = connected.
    const group = qs(elSel('connect-label-group'))
    if (!group || !group.children) return
    if (group.children[0]) group.children[0].style.display = connected ? 'none' : ''
    if (group.children[1]) group.children[1].style.display = connected ? '' : 'none'
  }

  // Platform can't be disconnected outright — only switched away from by
  // connecting Google. So: not-on-platform shows "Connect Platform"; not-on-
  // Google shows "Connect Google"; only on-Google shows "Disconnect Google" —
  // connect-platform is redundant there since disconnect-google already
  // reverts to platform on its own.
  function applyConnectButtonVisibility() {
    const wrapper = qs(elSel('connect-btn-wrapper'))
    if (!wrapper) return
    const manager = availability && availability.manager
    const onGoogle = manager === 'calendar'
    const rules = [
      ['connect-platform', manager !== 'platform' && !onGoogle],
      ['open-connect-google', !onGoogle],
      ['open-disconnect-google', onGoogle],
    ]
    rules.forEach(function (rule, i) {
      const target = resolveActionTarget(wrapper, rule[0], i)
      if (target) target.style.display = rule[1] ? '' : 'none'
    })
  }

  // Same "wait for the real response" rule as applyConnectLabels — skip the
  // transient 'loading' state entirely.
  function applyConnectInfoVisibility(state) {
    if (state === 'loading') return
    setElementVisible('connect-info-wrapper', state !== 'connected' && state !== 'reconnect')
  }

  // `main-wrapper` only ever appears after a *successful* calendar connect —
  // once shown, it must stay shown through later reconnect/disconnect
  // switches, so this latches to true on 'connected' and never reverts.
  let mainWrapperRevealed = false

  function applyMainWrapperVisibility(state) {
    if (state === 'loading') return
    if (state === 'connected' || state === 'reconnect') mainWrapperRevealed = true
    if (!mainWrapperRevealed) return
    qsa(elSel('main-wrapper')).forEach(function (el) {
      el.style.display = 'grid'
    })
  }

  function repaintConnectionUI(state) {
    applyConnectLabels(state)
    applyConnectButtonVisibility()
    applyConnectInfoVisibility(state)
    applyMainWrapperVisibility(state)
  }

  function bindConnectButtons() {
    const wrapper = qs(elSel('connect-btn-wrapper'))
    bindActionGroup(wrapper, ['connect-platform', 'open-connect-google', 'open-disconnect-google'], function (action) {
      if (action === 'connect-platform') {
        // No confirmation step for platform — open straight on the spinner
        // and let the request itself decide success/error.
        openNotification('virtual-connect')
        activatePlatformManager().then(function (ok) {
          if (ok === false) showNotificationError(ERROR_TEXT_CONNECT_PLATFORM)
          else if (ok) switchNotification('virtual-connected')
        })
      } else if (action === 'open-connect-google') {
        // Switching away from platform cancels active bookings — warn first.
        // Starting from disconnected skips straight to the informational step.
        openNotification(availability && availability.manager === 'platform' ? 'switch-calendar' : 'pre-oauth')
      } else if (action === 'open-disconnect-google') {
        openNotification('disconnect-calendar')
      }
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
    const removeBtn = resolveActionTarget(buttonGroup, 'open-item-remove', 1)
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

  // Drives the item-form-submit button's own pending-state markup —
  // `[text-element]` swaps to "Loading...", `[loading-spinner]` shows,
  // `[loading-hide]` (the default icon) hides — while the whole item-card
  // (not just the button) dims and stops accepting clicks until the
  // save/remove request settles either way.
  function setItemSubmitLoading(card, target, loading) {
    if (!target) return
    const textEl = qs('[text-element]', target)
    if (textEl) textEl.textContent = loading ? 'Loading...' : 'Save availability'
    const spinner = qs('[loading-spinner]', target)
    if (spinner) spinner.style.display = loading ? 'flex' : 'none'
    const hideIcon = qs('[loading-hide]', target)
    if (hideIcon) hideIcon.style.display = loading ? 'none' : ''
    if (card) {
      card.style.opacity = loading ? '0.6' : '1'
      card.style.pointerEvents = loading ? 'none' : 'auto'
    }
  }

  function bindItemActions(card, id) {
    const buttonGroup = qs(elSel('item-button-group'), card)
    bindActionGroup(buttonGroup, ['item-form-open', 'open-item-remove'], function (action) {
      if (action === 'item-form-open') {
        // Opening/closing the form is a pure UI toggle — it doesn't change
        // availability data, so it must not disturb the slots preview.
        toggleItemForm(card, id)
      } else if (action === 'open-item-remove') {
        // Confirmation happens in the notification modal's "item-remove"
        // button — see bindNotificationModalActions.
        pendingRemoveId = id
        openNotification('availability-remove-approve')
      }
    })

    const { form, buttonRow } = getItemFormPieces(card)
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault()
      })
    }
    bindActionGroup(buttonRow, ['item-form-close', 'item-form-submit'], function (action, target) {
      if (action === 'item-form-close') {
        if (availability.items[id]) {
          closeItemForm(card)
        } else {
          card.remove()
          setCreateTriggerBusy(false)
        }
      } else if (action === 'item-form-submit') {
        setItemSubmitLoading(card, target, true)
        availFormHandler(card, id)
          .then(renderSlotsPreview)
          .finally(function () {
            setItemSubmitLoading(card, target, false)
          })
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

    // A full render always reflects saved-canonical items only — any draft
    // in progress gets wiped below, so the create trigger is safe to re-enable.
    setCreateTriggerBusy(false)

    // Guard against `template.style.display` already being 'none' from a
    // previous render of this same (never-restored) master template —
    // otherwise every subsequent clone inherits 'none' and stays hidden.
    const templateDisplay = template.style.display === 'none' ? '' : template.style.display
    template.setAttribute('hidden', '')
    template.setAttribute('aria-hidden', 'true')
    template.style.display = 'none'

    // Clear only previously rendered clones, keeping the (now hidden)
    // template intact — it stays a sibling inside `list`.
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
      resetTimepickerMarkup(card)

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
    resetTimepickerMarkup(card)

    const titleEl = qs(elSel('item-title'), card)
    if (titleEl) titleEl.textContent = 'New availability window'

    applyItemTag(card, id)
    applyItemActionVisibility(card, id)
    // A freshly created item is a draft that doesn't exist server-side yet
    // and opens straight into its edit form — edit/remove and the days/time
    // headline (there's nothing saved to summarize) don't apply until it's
    // actually saved, at which point renderAvailabilityItems() re-runs and
    // restores them normally.
    const buttonGroup = qs(elSel('item-button-group'), card)
    if (buttonGroup) buttonGroup.style.display = 'none'
    const headline = qs(elSel('item-headline'), card)
    if (headline) headline.style.display = 'none'
    applyDayBadges(card, [])
    applyItemTimeText(card, { start: '', end: '' })
    closeItemForm(card)
    bindItemActions(card, id)

    list.appendChild(card)
    initInputPickers(card)
    openItemForm(card, id)
    setCreateTriggerBusy(true)
  }

  // The create trigger has two independent reasons to be locked: an open,
  // unsaved draft (`creatingDraft`) and an in-flight mutating request
  // anywhere in the section (`requestBusy`, see below) — either one alone
  // must keep it disabled, so painting is a pure OR of both instead of
  // living inside whichever setter last ran.
  function paintCreateTrigger() {
    const trigger = qs('[' + ACTION + '="availability-create"]')
    if (!trigger) return
    const locked = creatingDraft || requestBusy
    trigger.style.opacity = locked ? '0.6' : '1'
    trigger.style.pointerEvents = locked ? 'none' : 'auto'
  }

  // Only one unsaved draft can exist at a time — dims/disables the create
  // trigger while one is open so repeated clicks can't stack more of them.
  // Cleared by renderAvailabilityItems() (any full re-render, including a
  // successful save, means no draft survives) and by discarding a draft via
  // its own close/cancel button.
  function setCreateTriggerBusy(busy) {
    creatingDraft = busy
    paintCreateTrigger()
  }

  // Global request lock: while ANY mutating request is in flight (connect,
  // disconnect, save, remove), every clickable action across the whole
  // section — connect buttons, every item card's edit/remove/save/cancel —
  // is disabled, not just the one that started the request. This must not
  // fight the draft lock above: the create trigger stays disabled as long as
  // EITHER condition holds (see paintCreateTrigger), so a request finishing
  // never re-enables it while a draft is still open, and an open draft never
  // masks the fact that a request is (or isn't) in flight.
  let requestBusy = false

  function collectRequestLockTargets() {
    const targets = []
    const connectWrapper = qs(elSel('connect-btn-wrapper'))
    if (connectWrapper) {
      ;['connect-platform', 'open-connect-google', 'open-disconnect-google'].forEach(function (action, i) {
        const target = resolveActionTarget(connectWrapper, action, i)
        if (target) targets.push(target)
      })
    }
    qsa(elSel('item-card')).forEach(function (card) {
      const buttonGroup = qs(elSel('item-button-group'), card)
      if (buttonGroup) {
        const editBtn = resolveActionTarget(buttonGroup, 'item-form-open', 0)
        const removeBtn = resolveActionTarget(buttonGroup, 'open-item-remove', 1)
        if (editBtn) targets.push(editBtn)
        if (removeBtn) targets.push(removeBtn)
      }
      const { buttonRow } = getItemFormPieces(card)
      if (buttonRow) {
        const closeBtn = resolveActionTarget(buttonRow, 'item-form-close', 0)
        const submitBtn = resolveActionTarget(buttonRow, 'item-form-submit', 1)
        if (closeBtn) targets.push(closeBtn)
        if (submitBtn) targets.push(submitBtn)
      }
    })
    return targets
  }

  function setRequestBusy(busy) {
    requestBusy = busy
    collectRequestLockTargets().forEach(function (el) {
      el.style.pointerEvents = busy ? 'none' : ''
      el.style.opacity = busy ? '0.6' : ''
    })
    paintCreateTrigger()
  }

  function bindCreateTrigger() {
    const trigger = qs('[' + ACTION + '="availability-create"]')
    if (!trigger) return
    trigger.addEventListener('click', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      if (creatingDraft) return
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

    setRequestBusy(true)
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

      if (grantId) {
        const updated = await updateConfigs()
        if (!updated) {
          if (configs.length === 0) await createFreeConfig()
          else throw new Error('Scheduler configuration update failed')
        }
      }

      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      console.log('[scheduling-section] availability saved', { id: availId, avail: avail })
      openNotification('availability-saved')
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] availability save failed:', error && error.message)
      showNotificationError(ERROR_TEXT_ITEM_SAVE)
    } finally {
      setRequestBusy(false)
    }
  }

  async function handleAvailabilityRemove(id) {
    if (id === 'general') {
      console.warn('[scheduling-section] cannot remove the general availability window')
      return false
    }
    const removed = availability.items[id]
    const general = availability.items.general
    if (!removed || !general) return false
    removed.days.forEach(function (day) {
      if (general.defaultDays && general.defaultDays.indexOf(day) > -1) {
        general.days.push(day)
      }
    })
    availability.items.general = general
    delete availability.items[id]

    setRequestBusy(true)
    try {
      await updateAvail()
      if (grantId) {
        const updated = await updateConfigs()
        if (!updated && configs.length !== 0) {
          throw new Error('Scheduler configuration update failed')
        }
      }
      await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      console.log('[scheduling-section] availability removed', { id: id })
      return true
    } catch (error) {
      publishCalendarConnectionError()
      console.warn('[scheduling-section] availability remove failed:', error && error.message)
      return false
    } finally {
      setRequestBusy(false)
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
    const limit = opts.limit === undefined ? SLOTS_LIMIT : Number(opts.limit)
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
      const sortedSlots = timeSlots
        .map(function (slot) {
          return Number(slot && slot.start_time)
        })
        .filter(function (startTime) {
          return Number.isFinite(startTime) && startTime >= nowInSeconds
        })
        .sort(function (a, b) {
          return a - b
        })
      return Number.isFinite(limit) && limit > 0 ? sortedSlots.slice(0, limit) : sortedSlots
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
        timeZone: timezone || undefined,
      }).format(date)
    } catch (error) {
      return date.toString()
    }
  }

  function slotDateKey(startTimeSeconds) {
    const date = new Date(startTimeSeconds * 1000)
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: timezone || undefined,
      }).formatToParts(date)
      const values = {}
      parts.forEach(function (part) {
        values[part.type] = part.value
      })
      return [values.year, values.month, values.day].join('-')
    } catch (error) {
      return date.toISOString().slice(0, 10)
    }
  }

  function formatSlotDate(startTimeSeconds) {
    const date = new Date(startTimeSeconds * 1000)
    try {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: timezone || undefined,
      }).format(date)
    } catch (error) {
      return date.toDateString()
    }
  }

  function formatSlotTimeOnly(startTimeSeconds) {
    const date = new Date(startTimeSeconds * 1000)
    try {
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone || undefined,
      }).format(date)
    } catch (error) {
      return date.toTimeString().slice(0, 5)
    }
  }

  function localDateFromKey(key) {
    const parts = String(key || '').split('-').map(Number)
    return new Date(parts[0], parts[1] - 1, parts[2])
  }

  function localDateKey(date) {
    return [
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-')
  }

  function activeFreeConfigs() {
    return configs.filter(function (config) {
      return Boolean(
        config &&
          config.config_id &&
          config.is_paid === false &&
          config.active !== false,
      )
    })
  }

  function applyStyles(node, styles) {
    Object.keys(styles).forEach(function (name) {
      node.style[name] = styles[name]
    })
    return node
  }

  function previewText(tag, text, styles) {
    const node = document.createElement(tag)
    node.textContent = text
    return applyStyles(node, styles || {})
  }

  function renderServicesPreview(mount, services, selectedConfig) {
    mount.innerHTML = ''
    mount.setAttribute('data-scheduling-preview-state', services.length ? 'ready' : 'empty')

    const shell = applyStyles(document.createElement('div'), {
      display: 'grid',
      gap: '16px',
    })
    shell.setAttribute(EL, 'services-calendar-preview')

    if (!services.length) {
      shell.appendChild(
        previewText('div', 'No active free service is available for preview.', {
          padding: '18px',
          border: '1px solid #e2e2e2',
          borderRadius: '8px',
        }),
      )
      mount.appendChild(shell)
      return null
    }

    const servicesWrap = applyStyles(document.createElement('div'), {
      display: 'grid',
      gridTemplateColumns: services.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
      gap: '8px',
    })
    servicesWrap.setAttribute(EL, 'preview-services')
    services.forEach(function (config) {
      const selected = config.config_id === selectedConfig.config_id
      const button = applyStyles(document.createElement('button'), {
        padding: '12px 14px',
        border: selected ? '2px solid #1f211d' : '1px solid #d9d9d9',
        borderRadius: '8px',
        background: '#ffffff',
        color: '#1f211d',
        textAlign: 'left',
        cursor: 'pointer',
      })
      button.setAttribute('type', 'button')
      button.setAttribute('aria-pressed', selected ? 'true' : 'false')
      button.setAttribute('data-preview-config-id', config.config_id)
      button.appendChild(
        previewText('strong', config.title || 'Free Consultation Call', {
          display: 'block',
          fontSize: '14px',
        }),
      )
      button.appendChild(
        previewText('span', String(Number(config.duration) || 30) + ' minutes · Free', {
          display: 'block',
          marginTop: '4px',
          color: '#6f746d',
          fontSize: '12px',
        }),
      )
      button.addEventListener('click', function () {
        if (selectedPreviewConfigId !== config.config_id) {
          selectedPreviewDateKey = null
          selectedPreviewSlotStart = null
        }
        selectedPreviewConfigId = config.config_id
        renderSlotsPreview()
      })
      servicesWrap.appendChild(button)
    })
    shell.appendChild(servicesWrap)

    const calendar = applyStyles(document.createElement('div'), {
      padding: '14px',
      border: '1px solid #e2e2e2',
      borderRadius: '8px',
      background: '#ffffff',
    })
    calendar.setAttribute(EL, 'preview-calendar')
    const heading = applyStyles(document.createElement('div'), {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      alignItems: 'baseline',
      marginBottom: '10px',
    })
    heading.appendChild(previewText('strong', 'Next available times', { fontSize: '14px' }))
    heading.appendChild(previewText('span', timezone || '', { color: '#6f746d', fontSize: '11px' }))
    calendar.appendChild(heading)
    shell.appendChild(calendar)
    mount.appendChild(shell)
    return calendar
  }

  // Renders inside the Designer-owned calendar-preview mount. The generated
  // nodes are read-only and use canonical configuration and availability data.
  function renderMonthCalendar(container, groupedSlots, dateKeys, slots, wrapper) {
    const $ = window.jQuery
    if (!$ || !$.fn || !$.fn.datepicker) return false

    const calendarHost = applyStyles(document.createElement('div'), {
      minWidth: '0',
      width: '100%',
    })
    calendarHost.setAttribute(EL, 'preview-month-calendar')
    container.appendChild(calendarHost)

    $(calendarHost).datepicker({
      dateFormat: 'yy-mm-dd',
      defaultDate: localDateFromKey(selectedPreviewDateKey),
      minDate: localDateFromKey(dateKeys[0]),
      maxDate: localDateFromKey(dateKeys[dateKeys.length - 1]),
      showOtherMonths: true,
      selectOtherMonths: false,
      beforeShowDay: function (date) {
        const key = localDateKey(date)
        const available = Boolean(groupedSlots[key])
        return [
          available,
          available ? 'scheduling-preview-available-date' : '',
          available ? 'Available' : 'Unavailable',
        ]
      },
      onSelect: function (dateText) {
        selectedPreviewDateKey = dateText
        selectedPreviewSlotStart = null
        renderSlotsList(wrapper, slots)
      },
    })
    $(calendarHost).datepicker('setDate', localDateFromKey(selectedPreviewDateKey))

    const inlineCalendar = calendarHost.querySelector('.ui-datepicker-inline')
    if (inlineCalendar) {
      applyStyles(inlineCalendar, {
        display: 'block',
        width: '100%',
        boxShadow: 'none',
      })
    }
    return true
  }

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
      applyStyles(empty, { color: '#6f746d', fontSize: '12px' })
      list.appendChild(empty)
      return
    }
    const groupedSlots = {}
    const dateKeys = []
    slots.forEach(function (startTime) {
      const key = slotDateKey(startTime)
      if (!groupedSlots[key]) {
        groupedSlots[key] = []
        dateKeys.push(key)
      }
      groupedSlots[key].push(startTime)
    })
    if (!groupedSlots[selectedPreviewDateKey]) {
      selectedPreviewDateKey = dateKeys[0]
      selectedPreviewSlotStart = null
    }

    applyStyles(list, { display: 'grid', gap: '14px' })
    const pickerLayout = applyStyles(document.createElement('div'), {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: '14px',
      alignItems: 'start',
    })
    pickerLayout.setAttribute(EL, 'preview-picker-layout')

    const calendarColumn = document.createElement('div')
    calendarColumn.setAttribute(EL, 'preview-calendar-column')
    const hasMonthCalendar = renderMonthCalendar(
      calendarColumn,
      groupedSlots,
      dateKeys,
      slots,
      wrapper,
    )

    const dates = applyStyles(document.createElement('div'), {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(82px, 1fr))',
      gap: '7px',
    })
    dates.setAttribute(EL, 'preview-dates')
    if (hasMonthCalendar) dates.style.display = 'none'
    dateKeys.forEach(function (key) {
      const dateSlots = groupedSlots[key]
      const selected = key === selectedPreviewDateKey
      const dateButton = applyStyles(document.createElement('button'), {
        padding: '9px 8px',
        border: selected ? '2px solid #1f211d' : '1px solid #d9d9d9',
        borderRadius: '7px',
        background: selected ? '#f0ffc0' : '#ffffff',
        color: '#1f211d',
        cursor: 'pointer',
        fontSize: '12px',
      })
      dateButton.setAttribute('type', 'button')
      dateButton.setAttribute('data-preview-date', key)
      dateButton.setAttribute('aria-pressed', selected ? 'true' : 'false')
      dateButton.textContent = formatSlotDate(dateSlots[0])
      dateButton.addEventListener('click', function () {
        selectedPreviewDateKey = key
        selectedPreviewSlotStart = null
        renderSlotsList(wrapper, slots)
      })
      dates.appendChild(dateButton)
    })
    calendarColumn.appendChild(dates)
    pickerLayout.appendChild(calendarColumn)

    const timesColumn = applyStyles(document.createElement('div'), {
      display: 'grid',
      gap: '9px',
    })
    timesColumn.setAttribute(EL, 'preview-times-column')
    timesColumn.appendChild(
      previewText('strong', formatSlotDate(groupedSlots[selectedPreviewDateKey][0]), {
        fontSize: '13px',
      }),
    )
    const times = applyStyles(document.createElement('div'), {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
      gap: '7px',
    })
    times.setAttribute(EL, 'preview-times')
    groupedSlots[selectedPreviewDateKey].forEach(function (startTime) {
      const selected = startTime === selectedPreviewSlotStart
      const timeButton = applyStyles(document.createElement('button'), {
        padding: '10px 11px',
        border: selected ? '2px solid #1f211d' : '1px solid transparent',
        borderRadius: '6px',
        background: selected ? '#1f211d' : '#f3f4ef',
        color: selected ? '#ffffff' : '#1f211d',
        cursor: 'pointer',
        fontSize: '12px',
      })
      timeButton.setAttribute('type', 'button')
      timeButton.setAttribute('data-preview-slot-start', String(startTime))
      timeButton.setAttribute('aria-pressed', selected ? 'true' : 'false')
      timeButton.textContent = formatSlotTimeOnly(startTime)
      timeButton.addEventListener('click', function () {
        selectedPreviewSlotStart = startTime
        renderSlotsList(wrapper, slots)
      })
      times.appendChild(timeButton)
    })
    timesColumn.appendChild(times)
    pickerLayout.appendChild(timesColumn)
    list.appendChild(pickerLayout)

    if (selectedPreviewSlotStart) {
      const selectedSummary = previewText(
        'div',
        'Selected: ' + formatSlotTime(selectedPreviewSlotStart),
        { color: '#1f211d', fontSize: '12px', fontWeight: '600' },
      )
      selectedSummary.setAttribute(EL, 'preview-selection')
      list.appendChild(selectedSummary)
    }
  }

  async function renderSlotsPreview() {
    const wrapper = qs(elSel('slots-wrapper'))
    if (!wrapper) return
    const mount = qs(elSel('calendar-preview'), wrapper) || wrapper
    const renderVersion = ++previewRenderVersion
    setElementVisible('slots-list', false)
    setElementVisible('loading-slots', true)
    const services = activeFreeConfigs()
    const selectedConfig =
      services.filter(function (config) {
        return config.config_id === selectedPreviewConfigId
      })[0] || services[0]
    selectedPreviewConfigId = selectedConfig ? selectedConfig.config_id : null
    const calendar = renderServicesPreview(mount, services, selectedConfig)
    if (!grantId || !selectedConfig || !calendar) {
      setElementVisible('loading-slots', false)
      return
    }
    const slots = await getUpcomingTimeSlots({
      grantId: grantId,
      configId: selectedConfig.config_id,
      searchDays: SLOTS_SEARCH_DAYS,
      // The provider configuration already enforces the canonical 14-day
      // booking window. Keep every returned slot so dense 15-minute schedules
      // do not make later bookable dates disappear from the month calendar.
      limit: 0,
    })
    if (renderVersion !== previewRenderVersion) return
    renderSlotsList(calendar, slots)
    setElementVisible('loading-slots', false)
    setElementVisible('slots-list', true)
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                           */
  /* ------------------------------------------------------------------ */

  // `connect-wrapper` is hidden by the site's own CSS until the first load
  // resolves — the script never hides it again, it only ever reveals it once
  // via an explicit `display` value (clearing to '' would just fall back to
  // that same CSS-hidden default). It must appear once loading finishes
  // regardless of outcome (connected, disconnected, or error), so members
  // always land on a usable connect UI instead of a stuck spinner.
  function revealConnectWrapper() {
    qsa(elSel('connect-wrapper')).forEach(function (el) {
      el.style.display = 'flex'
    })
  }

  // `main-wrapper` (containing `list-wrapper` and `slots-wrapper`) is gated
  // separately by applyMainWrapperVisibility — it only ever appears after a
  // successful calendar connect. `loading-section` is the single spinner
  // shown in their place until then.
  function revealSection(state) {
    setElementVisible('loading-section', false)
    revealConnectWrapper()
    applyMainWrapperVisibility(state)
  }

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
      selectedPreviewConfigId = null
      selectedPreviewDateKey = null
      selectedPreviewSlotStart = null
      previewRenderVersion = 0
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
      bindNotificationModalActions()
      bindCreateTrigger()
      renderAvailabilityItems()

      const state = await refreshCanonicalConnectionState()
      renderAvailabilityItems()
      renderSlotsPreview()

      publishCalendarConnectionState(state)
      revealSection(state)
      setStatus('ready')
      emit('starterSchedulingSectionReady', { memberId: sessionMemberId })
      return 'ready'
    } catch (error) {
      publishCalendarConnectionError()
      setStatus('error')
      setElementVisible('loading-section', false)
      setElementVisible('loading-slots', false)
      // Loading finished (with an error) — the connect UI must still surface
      // so the member isn't left staring at a vanished spinner.
      revealConnectWrapper()
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
