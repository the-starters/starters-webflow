/**
 * V3 dashboards — canonical call sections and Brand identity hero.
 *
 * @release v1.59.469
 *
 * The Webflow call cards remain Designer-owned. This controller authenticates
 * through scheduling-auth.js, reads only the signed-in member's canonical V3
 * bookings, clones the authored templates, and owns loading/empty/list state.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_SCHEDULING_BASE =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const BOOKINGS_PATH = '/booking_record/get/v3'
  const CONFIRM_PATH = '/booking/confirm/v3'
  const CONFIRM_FAILURE_COPY = 'The call could not be confirmed. Please try again.'
  const DASHBOARD_CALL_MODULES = [
    {
      globalName: 'StartersDashboardCallActions',
      path: 'dashboard-call-actions.js',
      marker: 'data-starters-dashboard-call-actions',
    },
    {
      globalName: 'StartersDashboardCallMedia',
      path: 'dashboard-call-media.js',
      marker: 'data-starters-dashboard-call-media',
    },
    {
      globalName: 'StartersDashboardCallPayment',
      path: 'dashboard-call-payment.js',
      marker: 'data-starters-dashboard-call-payment',
    },
  ]
  const DASHBOARD_MODULE_BASE =
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/'
  const CONFIRM_ATTEMPT_STORAGE_PREFIX = 'starters:dashboard-confirm:v1:'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  // A post-login navigation can expose the Memberstack client before its
  // authenticated member has hydrated. Keep the dashboard in its loading
  // state for one bounded readiness window instead of permanently rendering
  // zero calls after the old 600 ms retry budget.
  const MEMBER_RETRY_DELAYS_MS = [200, 400]
  const INITIAL_MEMBER_RETRY_DELAYS_MS = [200, 400, 800, 1200, 1600, 2000, 2000]
  const REQUEST_EXPIRATION_TICK_MS = 10000
  const REQUEST_EXPIRATION_POLL_MS = 30000
  const REQUEST_EXPIRATION_MAX_POLLS = 3
  // F54: F40 writes a virtual-calendar Meet link 38 to 56 s after the confirm
  // (task #760), and the list was read once. A Starter's upcoming confirmed
  // row with no link gets these re-reads, counted from the tick that first
  // sees it. Some calendars never get a link, so the budget is 3 per row.
  // Each re-read runs on the first 10 s tick at or after its delay, so the
  // effective schedule is 50, 90 and 150 s. The first re-read then runs 50 to
  // 60 s after the confirm, after most of the F40 window; a 40 s tick would
  // run before most links exist.
  const MEETING_LINK_POLL_DELAYS_MS = [45000, 90000, 150000]
  const MUTATION_RECONCILIATION_MAX_PASSES = 3
  const CANONICAL_READ_TIMEOUT_MS = 10000
  // F68 (production, 2026-09-30): a first read (boot or an auth change) that
  // timed out left both lists unavailable until a reload, because the
  // lifecycle ticker re-reads only for rendered rows. Retry that read once
  // after each of these delays, counted from the end of the failed attempt:
  // at most 3 retries, never while the page is hidden. Each attempt keeps the
  // 10 s deadline above. The deadline aborts only the canonical POST and its
  // body read: a retry joins a token trade that is still in flight in
  // v3/scheduling-auth.js. That trade has its own 30 s deadline, so the
  // second retry starts a new trade.
  const INITIAL_READ_RETRY_DELAYS_MS = [3000, 10000, 30000]
  const EMPTY_COPY_SELECTORS = ['h1,h2,h3,h4,h5,h6', 'p']
  const PROFILE_REFRESH_DELAYS_MS = [0, 150, 300, 600, 1000, 1600, 2500]
  const DEEP_LINK_READY_DELAYS_MS = [0, 100, 250, 500, 1000, 1600]
  const PROFILE_FORM_SELECTOR = 'form[data-ms-form="profile"]'
  const PAGE_SIZE = 6
  const PROJECT_PAGE_SIZE = 12
  const PROJECT_INSTANCE_KEYS = ['dash-projects', 'dash-brand-projects']
  /**
   * Authored duplicate tiles are matched by their heading text, live tiles by
   * `[bookings-section]`, so the two vocabularies need mapping explicitly. The keys
   * are the only headings this script has ever hidden.
   */
  const DUPLICATE_SECTION_NAMES = { calls: 'calls', 'call requests': 'requests' }
  /**
   * Webflow's zero-width, absolutely positioned anchor divs that carry the
   * `#…-section` ids the sticky dashboard sub-nav links to.
   */
  const SECTION_ANCHOR_SELECTOR = '.dash-main_anchor[id]'
  const STATUS_VARIANT_CLASSES = [
    'w-variant-34961dab-8ebb-e322-49a7-741a1936647a',
    'w-variant-89402c65-e26d-c236-91e7-76e9135a2d42',
    'w-variant-f48ad750-f9e7-4b94-4998-3df752bfb037',
  ]
  const DETAIL_ACTION_SELECTOR = [
    '[booking-action-btn]',
    '[booking-card-action-btn]',
    '[payment-action-btn]',
    '[booking-pm-action]',
    '[data-btn-payment]',
    '[popup-stripe-card-open]',
    '[pm-use-this]',
  ].join(', ')
  const DETAIL_MODAL_SELECTOR =
    '[popup-booking-info], dialog[data-modal-target="popup-booking-info"]'
  /** Module-owned `data-starters-action-hint` names that earlier versions made. */
  const ACTION_HINT_NAMES = ['reschedule', 'cancel', 'decline']
  const DASHBOARD_ROLES = {
    '/starter-dashboard': 'starter',
    '/starter-dashboard---availability-stage': 'starter',
    '/brand-dashboard': 'brand',
    '/brand-dashboard---availability-stage': 'brand',
  }

  function normalizedPath(pathname) {
    return String(pathname || '/').replace(/\/+$/, '') || '/'
  }

  function roleForPath(pathname) {
    return DASHBOARD_ROLES[normalizedPath(pathname)] || ''
  }

  function dashboardEnvironment(location) {
    const hostname = clean(location && location.hostname).toLowerCase()
    if (hostname === 'the-starters-3-0.webflow.io') return 'test'
    if (hostname === 'thestarters.com' || hostname === 'www.thestarters.com') {
      return 'production'
    }
    return ''
  }

  function locatorValue(searchParams, name) {
    const values = (searchParams ? searchParams.getAll(name) : [])
      .map(clean)
      .filter(Boolean)
    if (!values.length || values.some(function (value) { return value !== values[0] })) {
      return ''
    }
    return values[0]
  }

  /**
   * Parses the F18 request-created dashboard locator. The URL is only a locator:
   * ownership and current state still come from the authenticated canonical feed.
   * Existing links put the locator in the query string before `#calls`. A missing
   * anchor is recovered only for an exact production Starter-dashboard query.
   */
  function callDeepLinkLocator(location) {
    const Params = global.URLSearchParams
    if (!location || typeof Params !== 'function') return null
    const anchor = clean(location.hash).toLowerCase()
    if (anchor !== '' && anchor !== '#calls' && anchor !== '#calls-section') return null
    const searchParams = new Params(clean(location.search).replace(/^\?/, ''))
    if (anchor === '') {
      if (
        normalizedPath(location.pathname) !== '/starter-dashboard' ||
        dashboardEnvironment(location) !== 'production'
      ) return null
      const locatorNames = ['booking_id', 'revision', 'environment']
      let parameterCount = 0
      searchParams.forEach(function (_value, name) {
        parameterCount += 1
        if (!locatorNames.includes(name)) parameterCount = Number.NaN
      })
      if (
        parameterCount !== locatorNames.length ||
        locatorNames.some(function (name) {
          const values = searchParams.getAll(name)
          return values.length !== 1 || clean(values[0]) === ''
        })
      ) return null
    }
    const bookingId = locatorValue(searchParams, 'booking_id')
    const revisionValue = locatorValue(searchParams, 'revision')
    const environment = locatorValue(searchParams, 'environment').toLowerCase()
    const revision = Number(revisionValue)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId) ||
      !/^\d+$/.test(revisionValue) ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !['test', 'production'].includes(environment) ||
      dashboardEnvironment(location) !== environment
    ) return null
    return { bookingId, revision, environment }
  }

  function normalizeCallsAnchor(location, history) {
    if (!location) return false
    const anchor = clean(location.hash).toLowerCase()
    const exactQueryWithoutAnchor = anchor === '' && Boolean(callDeepLinkLocator(location))
    if (anchor !== '#calls' && !exactQueryWithoutAnchor) return false
    const next = clean(location.pathname) + clean(location.search) + '#calls-section'
    if (history && typeof history.replaceState === 'function') {
      history.replaceState(null, '', next)
      return true
    }
    location.hash = '#calls-section'
    return true
  }

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function validDashboardModule(value) {
    return value && typeof value.wire === 'function'
  }

  function moduleCacheSuffix() {
    const document = global.document
    const loader =
      document &&
      typeof document.querySelector === 'function' &&
      document.querySelector('script[src*="/v3/dashboard-calls.js"]')
    const src = clean(loader && loader.getAttribute('src'))
    const query = src.indexOf('?')
    if (query === -1) return ''
    const suffix = src.slice(query + 1)
    return suffix ? '?' + suffix : ''
  }

  function loadDashboardModule(spec, onAvailable) {
    let delivered = false
    function deliver(value) {
      if (!validDashboardModule(value) || delivered) return null
      delivered = true
      if (typeof onAvailable === 'function') onAvailable(value)
      return value
    }
    if (validDashboardModule(global[spec.globalName])) {
      return Promise.resolve(deliver(global[spec.globalName]))
    }
    if (!global.document || typeof global.document.createElement !== 'function') {
      return Promise.resolve(null)
    }
    return new Promise(function (resolve) {
      let script = global.document.querySelector(
        'script[' + spec.marker + '], script[src*="/v3/' + spec.path + '"]',
      )
      let settled = false
      function finish() {
        const dashboardModule = deliver(global[spec.globalName])
        if (settled) return
        settled = true
        resolve(dashboardModule)
      }
      if (!script) {
        script = global.document.createElement('script')
        script.src = DASHBOARD_MODULE_BASE + spec.path + moduleCacheSuffix()
        script.defer = true
        script.setAttribute(spec.marker, '')
        ;(global.document.head || global.document.documentElement).appendChild(script)
      }
      script.addEventListener('load', finish, { once: true })
      script.addEventListener('error', finish, { once: true })
      global.setTimeout(finish, 5000)
    })
  }

  async function loadDashboardCallModules() {
    const modules = await Promise.all(
      DASHBOARD_CALL_MODULES.map(loadDashboardModule),
    )
    return {
      actions: modules[0],
      media: modules[1],
      payment: modules[2],
    }
  }

  async function wireDashboardCallModules(moduleOptions) {
    const options = moduleOptions || {}
    const dashboardModules = {
      actions: null,
      media: null,
      payment: null,
    }
    const moduleKeys = ['actions', 'media', 'payment']
    try {
      await Promise.all(
        DASHBOARD_CALL_MODULES.map(function (spec, index) {
          return loadDashboardModule(spec, function (dashboardModule) {
            try {
              dashboardModule.wire(options)
              dashboardModules[moduleKeys[index]] = dashboardModule
              if (typeof options.onAvailable === 'function') {
                options.onAvailable(dashboardModule, moduleKeys[index])
              }
            } catch (error) {
              console.error(
                '[dashboard-calls] optional module unavailable:',
                error && error.message,
              )
            }
          })
        }),
      )
      return dashboardModules
    } catch (error) {
      console.error(
        '[dashboard-calls] optional modules unavailable:',
        error && error.message,
      )
      return null
    }
  }

  async function stableScopeHash(value) {
    const input = clean(value)
    if (!input) return ''
    const crypto = global.crypto
    const TextEncoder = global.TextEncoder
    if (!crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function' || typeof TextEncoder !== 'function') return ''
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
      return Array.from(new Uint8Array(digest), function (byte) {
        return byte.toString(16).padStart(2, '0')
      }).join('')
    } catch (_error) {
      return ''
    }
  }

  async function confirmAttemptStorageKey(booking) {
    const bookingId = clean(booking && booking.booking_id)
    const actorId = clean(booking && booking.starter_data && booking.starter_data.memberstack_id)
    const environment = clean(booking && booking.data_environment).toLowerCase()
    const actorScope = await stableScopeHash(actorId)
    if (!bookingId || !actorScope || !['test', 'production'].includes(environment)) return ''
    return CONFIRM_ATTEMPT_STORAGE_PREFIX + environment + ':' + actorScope + ':' + bookingId
  }

  function validConfirmAttemptKey(value) {
    return /^dashboard-confirm:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value))
  }

  async function storedConfirmAttemptKey(booking) {
    const storageKey = await confirmAttemptStorageKey(booking)
    const storage = global.sessionStorage
    if (!storageKey || !storage || typeof storage.getItem !== 'function') return ''
    try {
      const value = clean(storage.getItem(storageKey))
      if (validConfirmAttemptKey(value)) return value
      if (value && typeof storage.removeItem === 'function') storage.removeItem(storageKey)
    } catch (_error) {
      return ''
    }
    return ''
  }

  async function createConfirmAttemptKey(booking) {
    const randomUUID = global.crypto && global.crypto.randomUUID
    if (typeof randomUUID !== 'function') return ''
    const value = 'dashboard-confirm:' + randomUUID.call(global.crypto)
    if (!validConfirmAttemptKey(value)) return ''
    const storageKey = await confirmAttemptStorageKey(booking)
    const storage = global.sessionStorage
    if (!storageKey || !storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return ''
    try {
      storage.setItem(storageKey, value)
      if (clean(storage.getItem(storageKey)) !== value) return ''
    } catch (_error) {
      return ''
    }
    return value
  }

  async function clearConfirmAttemptKey(booking, value) {
    const storageKey = await confirmAttemptStorageKey(booking)
    const storage = global.sessionStorage
    if (!storageKey || !storage || typeof storage.getItem !== 'function' || typeof storage.removeItem !== 'function') return
    try {
      if (clean(storage.getItem(storageKey)) === clean(value)) storage.removeItem(storageKey)
    } catch (_error) {}
  }

  function confirmSucceeded(body) {
    return confirmationStatus(body) === 'confirmed'
  }

  function confirmationStatus(body) {
    const confirmation = body && body.confirmation && typeof body.confirmation === 'object' ? body.confirmation : null
    const nestedStatus = clean(confirmation && confirmation.status).toLowerCase()
    const topStatus = clean(body && body.status).toLowerCase()
    if (nestedStatus === 'confirmed' || topStatus === 'confirmed') return 'confirmed'
    const confirmationId = clean(confirmation && (confirmation.booking_id || confirmation.unique_id || confirmation.id))
    if (!nestedStatus && !topStatus && confirmationId) return 'confirmed'
    return ''
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value)
    if (!Number.isFinite(timestamp) || timestamp === 0) return timestamp
    return Math.abs(timestamp) < 1e12 ? timestamp * 1000 : timestamp
  }

  function normalizeBooking(booking) {
    const row = Object.assign({}, booking, {
      start: normalizeTimestamp(booking && booking.start),
      end: normalizeTimestamp(booking && booking.end),
    })
    if (booking && Object.prototype.hasOwnProperty.call(booking, 'start_old')) {
      row.start_old = normalizeTimestamp(booking.start_old)
    }
    if (booking && Object.prototype.hasOwnProperty.call(booking, 'end_old')) {
      row.end_old = normalizeTimestamp(booking.end_old)
    }
    return row
  }

  function bookingStatus(booking, now) {
    const raw = clean(booking && booking.status).toLowerCase()
    if (raw === 'archived') return 'archived'
    if (['cancelled', 'canceled', 'declined', 'expired'].includes(raw)) {
      return 'cancelled'
    }
    if (['pending', 'requested', 'request'].includes(raw)) return 'pending'
    const end = Number(booking && booking.end)
    if (Number.isFinite(end) && end > 0 && end <= (now || Date.now())) {
      return 'completed'
    }
    if (['completed', 'complete', 'done'].includes(raw)) return 'completed'
    if (raw === 'rescheduled') return 'rescheduled'
    return 'confirmed'
  }

  function uniqueBookings(bookings) {
    const seen = new Set()
    return (Array.isArray(bookings) ? bookings : [])
      .filter(function (booking) {
        const id = clean(
          booking && (booking.booking_id || booking.unique_id || booking.id),
        )
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .sort(function (left, right) {
        return Number(right.start || 0) - Number(left.start || 0)
      })
  }

  function memberOwnsBooking(booking, memberId, role) {
    if (!booking || !memberId) return false
    const participant =
      role === 'starter' ? booking.starter_data : booking.brand_data
    return clean(participant && participant.memberstack_id) === clean(memberId)
  }

  function sectionBookings(bookings, role, section, now) {
    return uniqueBookings(bookings).filter(function (booking) {
      const status = bookingStatus(booking, now)
      if (role !== 'starter') return section === 'calls'
      if (section === 'requests') return status === 'pending'
      return section === 'calls' && status !== 'pending'
    })
  }

  function sameBookingRows(current, next) {
    if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) {
      return false
    }
    return current.every(function (booking, index) {
      try {
        const withoutClock = function (key, value) { return key === 'server_now_ms' ? undefined : value }
        return JSON.stringify(booking, withoutClock) === JSON.stringify(next[index], withoutClock)
      } catch (_error) {
        return false
      }
    })
  }

  function waitForMemberstack(timeoutMs) {
    if (
      global.$memberstackDom &&
      typeof global.$memberstackDom.getCurrentMember === 'function'
    ) {
      return Promise.resolve(global.$memberstackDom)
    }
    return new Promise(function (resolve) {
      const started = Date.now()
      const timer = global.setInterval(function () {
        if (
          global.$memberstackDom &&
          typeof global.$memberstackDom.getCurrentMember === 'function'
        ) {
          global.clearInterval(timer)
          resolve(global.$memberstackDom)
        } else if (Date.now() - started >= timeoutMs) {
          global.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  function show(element, visible) {
    if (!element) return
    element.hidden = !visible
    // The Designer authors some hooks (the call-details tables) with a hidden
    // base style plus a `display-flex` marker attribute naming the display a
    // shower must set. Clearing the inline style there falls back to the
    // hidden authored CSS, which made every such hook read as "not rendering"
    // and pushed the module into generating replacement rows.
    const flexWhenShown =
      element.hasAttribute && element.hasAttribute('display-flex')
    element.style.display = visible ? (flexWhenShown ? 'flex' : '') : 'none'
  }

  const wiredMeetingDestinations = new WeakSet()
  const meetingDestinationBookings = new WeakMap()

  function safeMeetingHref(value) {
    try {
      const url = new URL(clean(value))
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
    } catch (_error) {
      return ''
    }
  }

  function setMeetingDestination(element, href, allowParagraph, booking) {
    if (!element) return false
    const tag = clean(element.tagName).toLowerCase()
    const isAnchor = tag === 'a'
    const isParagraph = tag === 'p' && allowParagraph
    if (!isAnchor && !isParagraph) return false
    if (href) meetingDestinationBookings.set(element, booking)
    else meetingDestinationBookings.delete(element)
    if (isAnchor) {
      if (href) {
        element.setAttribute('href', href)
        element.setAttribute('target', '_blank')
        element.setAttribute('rel', 'noopener noreferrer')
      } else {
        element.removeAttribute('href')
        element.removeAttribute('target')
        element.removeAttribute('rel')
      }
    } else {
      element.removeAttribute('href')
      if (href) {
        element.setAttribute('data-meeting-href', href)
        element.setAttribute('role', 'link')
        element.setAttribute('tabindex', '0')
      } else {
        element.removeAttribute('data-meeting-href')
        element.removeAttribute('role')
        element.removeAttribute('tabindex')
      }
    }
    if (!href || wiredMeetingDestinations.has(element) || typeof element.addEventListener !== 'function') return true
    const activateMeetingDestination = function (event) {
      const current = meetingHrefForBooking(meetingDestinationBookings.get(element))
      const rendered = safeMeetingHref(element.getAttribute(isAnchor ? 'href' : 'data-meeting-href'))
      if (!current || current !== rendered) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        if (event && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
        setMeetingDestination(element, '', allowParagraph)
        if (isParagraph) element.textContent = ''
        show(element, false)
        const group = element.closest && element.closest('[booking-element-wrap]')
        if (group) show(group, false)
        return
      }
      if (isAnchor || typeof global.open !== 'function') return
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      global.open(current, '_blank', 'noopener,noreferrer')
    }
    element.addEventListener('click', activateMeetingDestination, true)
    if (isAnchor) {
      element.addEventListener('auxclick', activateMeetingDestination, true)
      element.addEventListener('dragstart', activateMeetingDestination, true)
      element.addEventListener('contextmenu', activateMeetingDestination, true)
    }
    if (isParagraph) {
      element.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') activateMeetingDestination(event)
      })
    }
    wiredMeetingDestinations.add(element)
    return true
  }

  function meetingReferenceTime(booking, now) {
    const actions = global.StartersDashboardCallActions
    if (actions && typeof actions.canonicalNow === 'function') {
      try {
        const canonical = Number(actions.canonicalNow(booking))
        if (Number.isFinite(canonical) && canonical > 0) return canonical
      } catch (_error) {}
    }
    const reference = Number(now)
    if (Number.isFinite(reference) && reference > 0) return reference
    const wall = Number(Date.now())
    return Number.isFinite(wall) && wall > 0 ? wall : null
  }

  function effectiveConfirmedInterval(booking) {
    const rescheduled = clean(booking && booking.status).toLowerCase() === 'rescheduled'
    return {
      start: Number(booking && booking[rescheduled ? 'start_old' : 'start']),
      end: Number(booking && booking[rescheduled ? 'end_old' : 'end']),
    }
  }

  function detailStatusAtReference(booking, referenceTime) {
    if (clean(booking && booking.status).toLowerCase() === 'rescheduled') {
      const end = effectiveConfirmedInterval(booking).end
      if (Number.isFinite(end) && end > 0) {
        return end <= referenceTime ? 'completed' : 'rescheduled'
      }
    }
    return bookingStatus(booking, referenceTime)
  }

  function meetingWindowOpenAt(booking, currentTime) {
    const raw = clean(booking && booking.status).toLowerCase()
    if (currentTime == null) return false
    const status = raw === 'rescheduled' ? raw : bookingStatus(booking, currentTime)
    if (!['confirmed', 'rescheduled'].includes(status)) return false
    const interval = effectiveConfirmedInterval(booking)
    const start = interval.start
    const end = interval.end
    return Number.isFinite(start) && start > 0 && Number.isFinite(end) && end > start && end > currentTime
  }

  function meetingHrefAtReference(booking, currentTime) {
    if (!meetingWindowOpenAt(booking, currentTime)) return ''
    return safeMeetingHref(booking && booking.meeting_link)
  }

  function meetingHrefForBooking(booking, now) {
    return meetingHrefAtReference(booking, meetingReferenceTime(booking, now))
  }

  function paintMeetingDestinationsAt(root, booking, referenceTime, allowParagraph) {
    const href = meetingHrefAtReference(booking, referenceTime)
    bookingFields(root, 'meeting-link').forEach(function (meetingLink) {
      const supported = setMeetingDestination(meetingLink, href, allowParagraph, booking)
      if (allowParagraph && supported) meetingLink.textContent = href
      const visible = supported && href !== ''
      show(meetingLink, visible)
      const group = meetingLink.closest && meetingLink.closest('[booking-element-wrap]')
      if (group) show(group, visible)
    })
    return href
  }

  function paintMeetingDestinations(root, booking, now, allowParagraph) {
    return paintMeetingDestinationsAt(
      root,
      booking,
      meetingReferenceTime(booking, now),
      allowParagraph,
    )
  }

  function text(root, selector, value) {
    const element = root && root.querySelector(selector)
    if (element) element.textContent = clean(value)
  }

  function profileValues(form) {
    const value = function (field) {
      const input = form && form.querySelector('[data-ms-member="' + field + '"]')
      return clean(input && input.value)
    }
    return {
      firstName: value('free-user'),
      lastName: value('last-name'),
      company: value('company'),
    }
  }

  function memberMatchesProfile(member, values) {
    const fields = (member && member.customFields) || {}
    return (
      clean(fields['free-user']) === values.firstName &&
      clean(fields['last-name']) === values.lastName &&
      clean(fields.company) === values.company
    )
  }

  function browserTimezone() {
    try {
      const intl = global.Intl
      return clean(intl && intl.DateTimeFormat().resolvedOptions().timeZone)
    } catch (_error) {
      return ''
    }
  }

  /**
   * Timezone the signed-in viewer reads call times in: the viewer's own stored
   * zone first. A Brand then uses this browser's zone, and the counterpart's
   * zone only as a last resort. A Brand with no stored zone used to fall back
   * to the Starter's zone first, so a Dubai Brand saw a different date than it
   * booked (P6). A Starter keeps its own zone, then the Brand's.
   * @param {string} role Signed-in member's role.
   * @param {object} booking Canonical booking row.
   * @returns {string} IANA timezone, or '' for the formatter default.
   */
  function viewerTimezone(role, booking) {
    const own = role === 'starter'
      ? booking && booking.starter_data
      : booking && booking.brand_data
    const other = role === 'starter'
      ? booking && booking.brand_data
      : booking && booking.starter_data
    return clean(own && own.timezone) ||
      (role === 'brand' ? browserTimezone() : '') ||
      clean(other && other.timezone)
  }

  function formatDate(value, timezone) {
    const timestamp = Number(value)
    if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
    const options = {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }
    if (timezone) options.timeZone = timezone
    try {
      return new Intl.DateTimeFormat('en-US', options).format(
        new Date(timestamp),
      )
    } catch (_error) {
      delete options.timeZone
      return new Intl.DateTimeFormat('en-US', options).format(
        new Date(timestamp),
      )
    }
  }

  function formatPrice(value, paidMeeting) {
    const amount = Number(value)
    if (!paidMeeting || !Number.isFinite(amount) || amount <= 0) return 'Free'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(amount)
  }

  function formatDuration(value) {
    const duration = Number(value)
    return Number.isFinite(duration) && duration > 0 ? duration + 'min' : ''
  }

  function statusLabel(status, role, booking) {
    // Expiry writers record `cancelled` with `cancelled_by = "expired"`; show that as Expired.
    if (status === 'cancelled' && clean(booking && booking.cancelled_by).toLowerCase() === 'expired') {
      return 'Expired'
    }
    if (
      status === 'cancelled' &&
      booking &&
      booking.status === 'declined' &&
      !paidBooking(booking)
    ) {
      return 'Declined'
    }
    return {
      pending: role === 'starter' ? 'Pending' : 'Requested',
      rescheduled: 'Pending',
      confirmed: 'Upcoming',
      completed: 'Completed',
      cancelled: 'Cancelled',
      archived: 'Archived',
    }[status]
  }

  function statusVariantClass(status) {
    if (status === 'completed') return STATUS_VARIANT_CLASSES[1]
    if (status === 'cancelled' || status === 'archived') {
      return STATUS_VARIANT_CLASSES[2]
    }
    return STATUS_VARIANT_CLASSES[0]
  }

  function setClass(element, name, active) {
    if (!element || !element.classList) return
    if (typeof element.classList.toggle === 'function') {
      element.classList.toggle(name, Boolean(active))
    } else if (active && typeof element.classList.add === 'function') {
      element.classList.add(name)
    } else if (!active && typeof element.classList.remove === 'function') {
      element.classList.remove(name)
    }
  }

  function paintStatusPill(card, status, role, booking) {
    const pill = card && card.querySelector('[booking-element="status"]')
    if (!pill) return
    STATUS_VARIANT_CLASSES.forEach(function (className) {
      setClass(pill, className, className === statusVariantClass(status))
    })
    text(pill, '[label-text]', statusLabel(status, role, booking))
    if (!pill.querySelector('[label-text]')) pill.textContent = statusLabel(status, role, booking)
    show(pill, true)
    let group = pill.closest && pill.closest('[booking-element-wrap="status"]')
    if (!group && pill.closest) {
      const authoredGroup = pill.closest('[booking-element-wrap]')
      if (
        authoredGroup &&
        clean(authoredGroup.getAttribute('booking-element-wrap')) === '' &&
        authoredGroup.querySelector('[booking-element="status"]') === pill
      ) {
        group = authoredGroup
      }
    }
    if (group) {
      show(group, true)
      group.style.setProperty('display', 'flex', 'important')
    }
  }

  function paidBooking(booking) {
    const value = booking && (
      booking.is_paid != null ? booking.is_paid : booking.paid_meeting
    )
    return value === true || value === 1 || clean(value).toLowerCase() === 'true'
  }

  function responseWindowOpen(booking, now) {
    if (bookingStatus(booking, now) !== 'pending') return false
    const time = Number(now || Date.now())
    const expires = normalizeTimestamp(booking && booking.confirmation_expires_at)
    if (Number.isFinite(expires) && expires > 0 && expires <= time) return false
    const start = normalizeTimestamp(booking && booking.start)
    return !(Number.isFinite(start) && start > 0 && start <= time)
  }

  function responseDeadline(booking) {
    const expires = normalizeTimestamp(booking && booking.confirmation_expires_at)
    if (Number.isFinite(expires) && expires > 0) return expires
    const start = normalizeTimestamp(booking && booking.start)
    return Number.isFinite(start) && start > 0 ? start : Number.NaN
  }

  function formatResponseTime(deadline, now) {
    const remaining = Number(deadline) - Number(now == null ? Date.now() : now)
    if (!Number.isFinite(remaining) || remaining <= 0) return 'Expired'
    const totalMinutes = Math.ceil(remaining / 60000)
    const days = Math.floor(totalMinutes / 1440)
    const hours = Math.floor((totalMinutes % 1440) / 60)
    const minutes = totalMinutes % 60
    const parts = []
    if (days) parts.push(days + 'd')
    if (hours) parts.push(hours + 'h')
    if (minutes) parts.push(minutes + 'm')
    return parts.length ? parts.join(' ') : '0m'
  }

  function requestExpirationOwned(booking, role, now) {
    if (role !== 'starter' || bookingStatus(booking, now) !== 'pending') return false
    return Number.isFinite(responseDeadline(booking))
  }

  function requestExpirationKey(booking) {
    return clean(booking && (booking.booking_id || booking.id)) +
      '@' + responseDeadline(booking)
  }

  function paintRequestExpiration(card, booking, role, now) {
    const wrap = card && card.querySelector('[booking-item-expiration="wrap"]')
    const output = card && card.querySelector('[booking-item-expiration="time"]')
    const deadline = responseDeadline(booking)
    const visible = requestExpirationOwned(booking, role, now)
    show(wrap, visible)
    if (!visible) return false
    const currentTime = Number(now == null ? Date.now() : now)
    const expired = deadline <= currentTime
    if (output) output.textContent = formatResponseTime(deadline, currentTime)
    // The authored countdown has no expiring-state combo class. `text-color-red`
    // is the site-wide error colour already applied to error copy on this card,
    // so the urgent countdown reuses it instead of an unstyled marker class.
    setClass(output, 'text-color-red', deadline - currentTime < 48 * 60 * 60 * 1000)
    configureActionButtons(card, role, 'pending', booking, currentTime)
    return expired
  }

  function refreshRequestExpirations(refs, role, now) {
    const expired = []
    ;(Array.isArray(refs) ? refs : []).forEach(function (section) {
      if (!section || !section.list || typeof section.list.querySelectorAll !== 'function') return
      const bookings = new Map()
      ;(Array.isArray(section.rows) ? section.rows : []).forEach(function (booking) {
        bookings.set(clean(booking && (booking.booking_id || booking.id)), booking)
      })
      section.list.querySelectorAll('[data-booking-id]').forEach(function (card) {
        const booking = bookings.get(clean(card.getAttribute('data-booking-id')))
        if (booking && paintRequestExpiration(card, booking, role, now)) {
          expired.push(requestExpirationKey(booking))
        }
      })
    })
    return expired
  }

  function refreshDetailExpiration(refs, role, now) {
    if (!global.document || typeof global.document.querySelector !== 'function') return false
    const modal = global.document.querySelector(DETAIL_MODAL_SELECTOR)
    if (!modal || typeof modal.getAttribute !== 'function') return false
    if (!clean(modal.getAttribute('data-booking-id'))) return false
    const booking = bookingFromCard(Array.isArray(refs) ? refs : [], modal)
    if (!booking) return false
    const status = bookingStatus(booking, now)
    const base = modal.querySelector('[booking-popup-content="base"]') || modal
    const pendingMessages = Array.prototype.slice.call(
      base.querySelectorAll ? base.querySelectorAll('[pending-info-text]') : [],
    )
    pendingMessages.forEach(function (message, index) {
      show(message, index === 0 && status === 'pending' && responseWindowOpen(booking, now))
    })
    configureDetailActions(modal, role, status, booking, now)
    return true
  }

  function refreshMeetingDestinations(refs, now) {
    const sections = Array.isArray(refs) ? refs : []
    sections.forEach(function (section) {
      if (!section || !section.list || typeof section.list.querySelectorAll !== 'function') return
      section.list.querySelectorAll('[data-booking-id]').forEach(function (card) {
        const booking = bookingFromCard(sections, card)
        if (booking) paintMeetingDestinations(card, booking, now, false)
      })
    })
    if (!global.document || typeof global.document.querySelector !== 'function') return
    const modal = global.document.querySelector(DETAIL_MODAL_SELECTOR)
    if (!modal || !clean(modal.getAttribute && modal.getAttribute('data-booking-id'))) return
    const booking = bookingFromCard(sections, modal)
    paintMeetingDestinations(modal, booking, now, true)
  }

  function createBookingMutationState() {
    return {
      identity: 0,
      owners: new Map(),
      committed: new Map(),
      actionEpoch: new Map(),
      pending: new Map(),
      actionPending: new Set(),
      refreshRequired: new Set(),
    }
  }

  function resetBookingMutationState(state) {
    if (!state || !(state.owners instanceof Map)) return
    state.identity += 1
    state.owners.clear()
    state.committed.clear()
    state.actionEpoch.clear()
    state.pending.clear()
    state.actionPending.clear()
    state.refreshRequired.clear()
  }

  function bookingMutationCounter(map, bookingId) {
    return map instanceof Map ? map.get(clean(bookingId)) || 0 : 0
  }

  function bookingMutationPending(state, bookingId) {
    const pending = state && state.pending instanceof Map
      ? state.pending.get(clean(bookingId))
      : null
    return Boolean(
      (pending && pending.size) ||
      (state && state.actionPending instanceof Set && state.actionPending.has(clean(bookingId)))
    )
  }

  function bookingMutationLifecycle(booking) {
    return JSON.stringify([
      clean(booking && booking.status).toLowerCase(),
      clean(booking && booking.lifecycle_revision),
      normalizeTimestamp(booking && booking.start),
      normalizeTimestamp(booking && booking.end),
      normalizeTimestamp(booking && booking.start_old),
      normalizeTimestamp(booking && booking.end_old),
      clean(booking && booking.rescheduled_by).toLowerCase(),
    ])
  }

  function captureBookingMutation(refs, booking, state) {
    if (!state || !(state.owners instanceof Map)) return null
    const bookingId = clean(booking && (booking.booking_id || booking.id))
    const current = bookingById(Array.isArray(refs) ? refs : [], bookingId)
    if (!current) return null
    const owner = bookingMutationCounter(state.owners, bookingId) + 1
    state.owners.set(bookingId, owner)
    if (!state.pending.has(bookingId)) state.pending.set(bookingId, new Set())
    state.pending.get(bookingId).add(owner)
    return {
      bookingId,
      identity: state.identity,
      owner,
      lifecycle: bookingMutationLifecycle(current),
    }
  }

  function releaseBookingMutation(state, claim) {
    if (
      !state || !claim || claim.identity !== state.identity ||
      !(state.pending instanceof Map)
    ) return false
    const bookingId = clean(claim.bookingId)
    const pending = state.pending.get(bookingId)
    if (pending) {
      pending.delete(claim.owner)
      if (!pending.size) state.pending.delete(bookingId)
    }
    return !bookingMutationPending(state, bookingId) && state.refreshRequired.has(bookingId)
  }

  function snapshotBookingMutations(state) {
    if (!state || !(state.committed instanceof Map)) return null
    return {
      identity: state.identity,
      owners: new Map(state.owners),
      committed: new Map(state.committed),
      actionEpoch: new Map(state.actionEpoch),
      refreshRequired: new Set(state.refreshRequired),
    }
  }

  function bookingMutationReconciliationPending(state) {
    if (!state || !(state.refreshRequired instanceof Set)) return false
    return Array.from(state.refreshRequired).some(function (bookingId) {
      return !bookingMutationPending(state, bookingId)
    })
  }

  function acknowledgeBookingMutationRefresh(state, snapshot) {
    if (
      !state || !snapshot || snapshot.identity !== state.identity ||
      !(snapshot.refreshRequired instanceof Set)
    ) return
    snapshot.refreshRequired.forEach(function (bookingId) {
      if (
        bookingMutationPending(state, bookingId) ||
        bookingMutationCounter(state.owners, bookingId) !==
          (snapshot.owners.get(bookingId) || 0) ||
        bookingMutationCounter(state.committed, bookingId) !==
          (snapshot.committed.get(bookingId) || 0) ||
        bookingMutationCounter(state.actionEpoch, bookingId) !==
          (snapshot.actionEpoch.get(bookingId) || 0)
      ) return
      state.refreshRequired.delete(bookingId)
    })
  }

  function createBookingMutationReconciler(refresh, state) {
    let active = null
    const reconcile = function () {
      if (!bookingMutationReconciliationPending(state)) return Promise.resolve(true)
      const identity = state.identity
      if (active && active.identity === identity) return active.promise
      const attempt = function (pass) {
        if (
          identity !== state.identity ||
          !bookingMutationReconciliationPending(state)
        ) return Promise.resolve(true)
        return Promise.resolve()
          .then(refresh)
          .then(function (refreshed) {
            if (
              refreshed === true &&
              pass < MUTATION_RECONCILIATION_MAX_PASSES &&
              identity === state.identity &&
              bookingMutationReconciliationPending(state)
            ) return attempt(pass + 1)
            return refreshed === true && !bookingMutationReconciliationPending(state)
          })
      }
      const record = { identity, promise: null }
      record.promise = attempt(1).finally(function () {
        if (active === record) active = null
      })
      active = record
      return record.promise
    }
    return reconcile
  }

  function createBookingActionQueue(state, reconcile) {
    const tails = new Map()
    return function acquire(booking, failureMessage) {
      const bookingId = clean(booking && (booking.booking_id || booking.id))
      if (!bookingId) return Promise.resolve(null)
      const identity = state.identity
      const previous = tails.get(bookingId)
      const wait = previous && previous.identity === identity
        ? previous.done
        : Promise.resolve()
      let unlock
      const held = new Promise(function (resolve) { unlock = resolve })
      const record = { identity, done: wait.then(function () { return held }) }
      tails.set(bookingId, record)
      const releaseSlot = function () {
        unlock()
        if (tails.get(bookingId) === record) tails.delete(bookingId)
      }
      return wait.then(async function () {
        if (identity !== state.identity) {
          releaseSlot()
          return null
        }
        // An ambiguous earlier POST must be read back before another command
        // can use the same booking. The read has its own deadline.
        if (state.refreshRequired.has(bookingId)) {
          await reconcile()
          if (state.refreshRequired.has(bookingId)) {
            releaseSlot()
            throw new Error(failureMessage || 'The call could not be updated. Please try again.')
          }
        }
        if (identity !== state.identity) {
          releaseSlot()
          return null
        }
        state.actionEpoch.set(
          bookingId,
          bookingMutationCounter(state.actionEpoch, bookingId) + 1,
        )
        state.actionPending.add(bookingId)
        state.refreshRequired.add(bookingId)
        let released = false
        return async function release() {
          if (released) return
          released = true
          try {
            if (identity === state.identity) {
              state.actionPending.delete(bookingId)
              state.actionEpoch.set(
                bookingId,
                bookingMutationCounter(state.actionEpoch, bookingId) + 1,
              )
              await reconcile()
            }
          } finally {
            releaseSlot()
          }
        }
      }).catch(function (error) {
        releaseSlot()
        throw error
      })
    }
  }

  function createSerializedRefresh(refresh) {
    const tails = new Map()
    return function (owner) {
      const args = arguments
      const tail = tails.get(owner) || Promise.resolve()
      const current = tail.then(function () {
        return refresh.apply(null, args)
      })
      const recovered = current.catch(function () {})
      tails.set(owner, recovered)
      recovered.finally(function () {
        if (tails.get(owner) === recovered) tails.delete(owner)
      })
      return current
    }
  }

  function bookingChangedDuringRefresh(state, snapshot, bookingId) {
    const actionEpoch = bookingMutationCounter(state.actionEpoch, bookingId) !==
      (snapshot.actionEpoch.get(bookingId) || 0)
    const committed = bookingMutationCounter(state.committed, bookingId) !==
      (snapshot.committed.get(bookingId) || 0)
    const pending = bookingMutationPending(state, bookingId) &&
      bookingMutationCounter(state.owners, bookingId) !==
        (snapshot.owners.get(bookingId) || 0)
    const changed = actionEpoch || committed || pending
    if (changed) state.refreshRequired.add(bookingId)
    return changed
  }

  function reconcileCanonicalBookings(refs, rows, snapshot, state) {
    if (
      !snapshot || !state || !(state.committed instanceof Map) ||
      snapshot.identity !== state.identity
    ) return rows
    const currentRows = uniqueBookings(
      (Array.isArray(refs) ? refs : []).flatMap(function (section) {
        return Array.isArray(section && section.rows) ? section.rows : []
      }),
    )
    const currentById = new Map()
    currentRows.forEach(function (booking) {
      currentById.set(clean(booking.booking_id || booking.id), booking)
    })
    const seen = new Set()
    const reconciled = []
    ;(Array.isArray(rows) ? rows : []).forEach(function (booking) {
      const bookingId = clean(booking && (booking.booking_id || booking.id))
      if (!bookingId || seen.has(bookingId)) return
      const current = currentById.get(bookingId)
      const changed = current && bookingChangedDuringRefresh(
        state,
        snapshot,
        bookingId,
      )
      reconciled.push(changed ? current : booking)
      seen.add(bookingId)
    })
    currentRows.forEach(function (booking) {
      const bookingId = clean(booking && (booking.booking_id || booking.id))
      const changed = bookingChangedDuringRefresh(state, snapshot, bookingId)
      if (bookingId && changed && !seen.has(bookingId)) {
        reconciled.push(booking)
        seen.add(bookingId)
      }
    })
    return reconciled
  }

  function bookingMutationChangesMatch(booking, changes) {
    const fields = Object.keys(changes)
    if (!fields.length) return false
    return fields.every(function (field) {
      const current = booking[field]
      const next = changes[field]
      if (field === 'status' || field === 'rescheduled_by') {
        return clean(current).toLowerCase() === clean(next).toLowerCase()
      }
      if (['start', 'end', 'start_old', 'end_old'].includes(field)) {
        const currentTime = normalizeTimestamp(current)
        const nextTime = normalizeTimestamp(next)
        if (Number.isFinite(currentTime) && Number.isFinite(nextTime)) {
          return currentTime === nextTime
        }
      }
      return current === next
    })
  }

  function commitBookingMutation(refs, booking, update, claim, state, now) {
    const bookingId = clean(booking && (booking.booking_id || booking.id))
    const current = bookingById(Array.isArray(refs) ? refs : [], bookingId)
    if (!current) {
      if (
        state && claim && claim.identity === state.identity &&
        claim.bookingId === bookingId
      ) state.refreshRequired.add(bookingId)
      return null
    }
    if (state) {
      if (
        !claim || claim.bookingId !== bookingId ||
        claim.identity !== state.identity ||
        claim.owner !== bookingMutationCounter(state.owners, bookingId)
      ) {
        if (claim && claim.identity === state.identity) {
          state.refreshRequired.add(bookingId)
        }
        return null
      }
    }
    const lifecycleMatches = !state || claim.lifecycle === bookingMutationLifecycle(current)
    const changes = typeof update === 'function'
      ? update(lifecycleMatches ? current : booking)
      : update
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null
    if (state && !lifecycleMatches) {
      if (!bookingMutationChangesMatch(current, changes)) {
        state.refreshRequired.add(bookingId)
        return null
      }
      if (booking !== current) {
        Object.keys(changes).forEach(function (field) {
          booking[field] = current[field]
        })
      }
    } else {
      Object.assign(current, changes)
      if (booking !== current) Object.assign(booking, changes)
    }
    if (state) {
      state.committed.set(
        bookingId,
        bookingMutationCounter(state.committed, bookingId) + 1,
      )
      state.refreshRequired.add(bookingId)
    }
    refreshMeetingDestinations(refs, now)
    return current
  }

  function applyCancellationResult(refs, booking, result, now, commit, claim, reason, role) {
    const cancellation = result && result.cancel
    if (
      !booking || !cancellation ||
      clean(cancellation.booking_id) !== clean(booking.booking_id || booking.id) ||
      clean(cancellation.status).toLowerCase() !== 'cancelled'
    ) return false
    const changes = { status: cancellation.status }
    if (!paidBooking(booking) && clean(booking.status).toLowerCase() !== 'pending') {
      const start = normalizeTimestamp(cancellation.start)
      const end = normalizeTimestamp(cancellation.end)
      const revision = cancellation.revision
      const currentRevision = Number(booking.lifecycle_revision)
      // The Free response returns the confirmed slot, even when the cached
      // row still describes an unanswered proposal. Its reason is omitted,
      // so use only the reason submitted with this successful command.
      if (
        !Number.isSafeInteger(cancellation.start) || cancellation.start <= 0 ||
        !Number.isSafeInteger(cancellation.end) || cancellation.end <= 0 ||
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start ||
        !Number.isSafeInteger(revision) || revision <= 0 ||
        (Number.isFinite(currentRevision) && revision < currentRevision) ||
        !['brand', 'starter'].includes(role) || clean(cancellation.cancelled_by) !== role ||
        typeof reason !== 'string' || clean(reason) === ''
      ) return false
      Object.assign(changes, {
        lifecycle_revision: revision,
        start,
        end,
        cancelled_by: role,
        cancelled_reason: clean(reason),
      })
    }
    const apply = typeof commit === 'function'
      ? commit
      : function (model, changes) {
          return commitBookingMutation(refs, model, changes, null, null, now)
        }
    return Boolean(apply(booking, changes, claim))
  }

  /**
   * F54: booking IDs of rows in their confirmed meeting window with no Meet
   * link. The window and the clock are the ones the meeting-link paint uses,
   * so a row is re-read only while a link that arrives would be painted.
   * @param {Array} refs Dashboard sections.
   * @param {number} now Current time in ms.
   * @returns {string[]} Booking IDs.
   */
  function missingMeetingLinkKeys(refs, now) {
    const keys = []
    ;(Array.isArray(refs) ? refs : []).forEach(function (section) {
      ;(section && Array.isArray(section.rows) ? section.rows : []).forEach(function (booking) {
        if (!booking || clean(booking.meeting_link) !== '') return
        if (!meetingWindowOpenAt(booking, meetingReferenceTime(booking, now))) return
        const key = clean(booking.booking_id || booking.id)
        if (key && keys.indexOf(key) === -1) keys.push(key)
      })
    })
    return keys
  }

  function pageHidden() {
    const document = global.document
    return Boolean(document && (document.visibilityState === 'hidden' || document.hidden === true))
  }

  function startBookingLifecycleTicker(refs, role, restart, options) {
    const settings = options || {}
    // The old inline helper remains defined, but its legacy list generator is
    // no longer invoked on the current dashboard. This controller owns one
    // bounded timer for rendered booking lifecycle and Starter request expiry.
    if (!['starter', 'brand'].includes(role)) return null
    const setTimer = settings.setInterval || global.setInterval
    const clearTimer = settings.clearInterval || global.clearInterval
    const now = settings.now || Date.now
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') return null
    let refreshBusy = false
    let nextPollAt = 0
    const polls = new Map()
    // F54: per-row Meet link re-reads, Starter only. An entry outlives a reset
    // of the rendered rows, so a row that comes back keeps its spent budget.
    const linkPolls = new Map()
    let lastLinkTickAt = null
    const dueMeetingLinkKeys = function (currentTime) {
      const missing = missingMeetingLinkKeys(refs, currentTime)
      missing.forEach(function (key) {
        const poll = linkPolls.get(key)
        if (!poll) {
          linkPolls.set(key, { since: currentTime, count: 0, seenAt: currentTime })
          return
        }
        // A row that was out of the set on the previous tick (a reset of the
        // rendered rows, or a link that came and went) is back. It keeps its
        // spent count, and its remaining delays restart from this tick, as if
        // its last re-read ran now. The read that brought the row back is
        // fresh, so no re-read runs on this tick.
        if (poll.seenAt !== lastLinkTickAt) {
          poll.since = currentTime -
            (poll.count > 0 ? MEETING_LINK_POLL_DELAYS_MS[poll.count - 1] : 0)
        }
        poll.seenAt = currentTime
      })
      lastLinkTickAt = currentTime
      if (pageHidden()) return []
      return missing.filter(function (key) {
        const poll = linkPolls.get(key)
        return poll.count < MEETING_LINK_POLL_DELAYS_MS.length &&
          currentTime - poll.since >= MEETING_LINK_POLL_DELAYS_MS[poll.count]
      })
    }
    const spendMeetingLinkPolls = function (keys, currentTime) {
      keys.forEach(function (key) {
        const poll = linkPolls.get(key)
        const delay = MEETING_LINK_POLL_DELAYS_MS[poll.count]
        // A re-read that runs a full tick late (the page was hidden, or
        // another ticker read was in flight) restarts the remaining delays
        // from now, so overdue re-reads never run on back-to-back ticks.
        if (currentTime - poll.since - delay >= REQUEST_EXPIRATION_TICK_MS) {
          poll.since = currentTime - delay
        }
        poll.count += 1
      })
    }
    const tick = function () {
      const currentTime = Number(now())
      refreshMeetingDestinations(refs, currentTime)
      refreshOpenDetailPanel(refs, role, currentTime)
      if (typeof settings.reconcileBookingMutations === 'function') {
        Promise.resolve()
          .then(settings.reconcileBookingMutations)
          .catch(function (error) {
            console.error(
              '[dashboard-calls] mutation reconciliation failed:',
              error && error.message,
            )
          })
      }
      if (role !== 'starter') return
      const expiredKeys = refreshRequestExpirations(refs, role, currentTime)
      refreshDetailExpiration(refs, role, currentTime)
      const pollable = expiredKeys.filter(function (key) {
        return (polls.get(key) || 0) < REQUEST_EXPIRATION_MAX_POLLS
      })
      const expiryDue = pollable.length > 0 && currentTime >= nextPollAt
      const linkDue = dueMeetingLinkKeys(currentTime)
      // The expiry and Meet link re-reads share one canonical read and one
      // in-flight guard. A blocked tick spends no budget.
      if (refreshBusy || (!expiryDue && !linkDue.length)) return
      refreshBusy = true
      if (expiryDue) {
        nextPollAt = currentTime + REQUEST_EXPIRATION_POLL_MS
        pollable.forEach(function (key) {
          polls.set(key, (polls.get(key) || 0) + 1)
        })
      }
      spendMeetingLinkPolls(linkDue, currentTime)
      Promise.resolve()
        .then(restart)
        .then(function (refreshed) {
          // A successful read (true) has repainted the cards and the open
          // dialog's status and meeting link. Re-check the dialog's pending
          // copy and actions against the refreshed rows now, not on the next
          // tick. A failed (false) or superseded read changed no rows.
          if (!linkDue.length || refreshed !== true) return
          refreshDetailExpiration(refs, role, Number(now()))
        })
        .catch(function (error) {
          console.error('[dashboard-calls] expiration refresh failed:', error && error.message)
        })
        .finally(function () {
          refreshBusy = false
        })
    }
    tick()
    const timer = setTimer(tick, REQUEST_EXPIRATION_TICK_MS)
    return function stop() {
      clearTimer(timer)
    }
  }

  function canConfirmBooking(role, booking, now) {
    return role === 'starter' && responseWindowOpen(booking, now)
  }

  function decodeBookingRef(compactString) {
    const compact = clean(compactString)
    if (!compact || typeof global.atob !== 'function') return null
    try {
      const binary = global.atob(compact.replace(/-/g, '+').replace(/_/g, '/'))
      if (binary.length <= 32) return null
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      const uuid = function (offset) {
        const hex = Array.from(bytes.slice(offset, offset + 16))
          .map(function (value) { return value.toString(16).padStart(2, '0') })
          .join('')
        return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
      }
      const saltBytes = bytes.slice(32)
      let saltBinary = ''
      saltBytes.forEach(function (value) { saltBinary += String.fromCharCode(value) })
      return {
        config_id: uuid(0),
        booking_id: uuid(16),
        salt: global.btoa(saltBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      }
    } catch (_error) {
      return null
    }
  }

  function confirmPayload(booking, idempotencyKey) {
    const decoded = decodeBookingRef(booking && booking.booking_ref)
    const bookingId = clean(booking && booking.booking_id)
    const configId = clean(booking && booking.config_id)
    const key = clean(idempotencyKey)
    if (
      !decoded || !key ||
      decoded.booking_id !== bookingId ||
      decoded.config_id !== configId ||
      !decoded.salt
    ) return null
    return {
      booking_id: bookingId,
      config_id: configId,
      booking_ref_salt: decoded.salt,
      idempotency_key: key,
    }
  }

  function configureActionButtons(card, role, status, booking, now) {
    card.querySelectorAll('[booking-card-action-btn], [booking-action-btn]').forEach(function (button) {
      const action = clean(
        button.getAttribute('booking-action-btn') ||
        button.getAttribute('booking-card-action-btn'),
      )
      const details = action === 'details'
      const accept =
        action === 'switch-confirm' &&
        canConfirmBooking(role, booking || { status: status }, now)
      const actions = global.StartersDashboardCallActions
      const decline = action === 'switch-decline' &&
        responseWindowOpen(booking, now) &&
        validDashboardModule(actions) && typeof actions.canDecline === 'function' &&
        actions.canDecline(role, booking)
      const messageHref = action === 'message' ? bookingMessageHref(role, booking) : ''
      const message = action === 'message' && messageHref !== ''
      if (action === 'message') setMessageControlDestination(button, messageHref)
      // Only expose actions backed by a loaded canonical action contract.
      // Pending Starter rescheduling still has no supported contract.
      show(button, details || accept || decline || message)
    })

    // The Starter request template has an authored, read-only View details
    // trigger without a booking-action attribute. Its parent is hidden by the
    // base Webflow style, so the action loop above never exposes it. Show only
    // that exact trigger for a pending request; the detail modal already
    // binds the updated time and reschedule reason from the canonical booking.
    if (role !== 'starter' || status !== 'pending' ||
        typeof card.querySelector !== 'function') return
    const detailsTrigger = card.querySelector(
      '[data-modal-trigger="popup-booking-info"]:not([booking-action-btn]):not([booking-card-action-btn])',
    )
    const detailsWrapper = detailsTrigger && detailsTrigger.parentElement
    if (!detailsWrapper) return
    // Do not expose a whole legacy action row if another template puts
    // unsupported mutation controls beside this read-only trigger.
    if (typeof detailsWrapper.querySelectorAll === 'function' &&
        detailsWrapper.querySelectorAll('[booking-action-btn], [booking-card-action-btn]').length) return
    detailsWrapper.setAttribute('display-flex', '')
    show(detailsWrapper, true)
  }

  function bindCard(card, booking, role) {
    const now = Date.now()
    const status = bookingStatus(booking, now)
    const other = role === 'starter' ? booking.brand_data : booking.starter_data
    card.removeAttribute('bookings-item-template')
    card.setAttribute('data-booking-id', clean(booking.booking_id || booking.id))
    card.setAttribute('data-booking-status', status)
    paintStatusPill(card, status, role, booking)
    paintMeetingDestinations(card, booking, now, false)
    text(card, '[booking-element="brand-name"]', other && other.name)
    text(card, '[booking-element="starter-name"]', other && other.name)
    text(card, '[booking-element="title"]', booking.call_context || 'Call')
    text(
      card,
      '[booking-element="start-date"]',
      clean(booking.status).toLowerCase() === 'rescheduled'
        ? proposalOldDate(booking, viewerTimezone(role, booking)) || 'Confirmed time unavailable'
        : formatDate(booking.start, viewerTimezone(role, booking)),
    )
    text(card, '[booking-element="duration"]', formatDuration(booking.duration))
    text(
      card,
      '[booking-element="price"]',
      formatPrice(booking.price, paidBooking(booking)),
    )

    const paymentWrap = card.querySelector('[payment-status-wrap]')
    const paymentText = paidBooking(booking)
      ? booking.pm_confirmed
        ? 'Payment method confirmed.'
        : 'Payment method pending.'
      : ''
    text(card, '[booking-element="payment-status-text"]', paymentText)
    show(paymentWrap, Boolean(paymentText))

    const brandStatus = card.querySelector('[brand-status]')
    text(brandStatus, '[label-text]', status === 'pending' ? 'Awaiting confirmation' : '')
    show(brandStatus, status === 'pending' && role === 'brand')

    if (!requestExpirationOwned(booking, role, now)) {
      configureActionButtons(card, role, status, booking, now)
    }
    paintRequestExpiration(card, booking, role, now)

    return card
  }

  /**
   * F53 follow-up: a card-level Accept kept the card's Pending pill, its
   * Accept and Decline, and its countdown until the post-confirm list read
   * returned. Repaint each rendered card of the committed row in place, with
   * the same painters a render uses and the existing labels. The card moves
   * to its new section on the canonical read.
   */
  function repaintBookingCards(refs, booking, role) {
    const bookingId = clean(booking && (booking.booking_id || booking.id))
    if (!bookingId) return
    ;(Array.isArray(refs) ? refs : []).forEach(function (section) {
      if (!section || !section.list || typeof section.list.querySelectorAll !== 'function') return
      section.list.querySelectorAll('[data-booking-id]').forEach(function (card) {
        if (clean(card.getAttribute('data-booking-id')) === bookingId) {
          bindCard(card, booking, role)
        }
      })
    })
  }

  function collectSection(section) {
    const name = section.getAttribute('bookings-section')
    const list = section.querySelector('[bookings-list="' + name + '"]')
    const template = section.querySelector(
      '[bookings-item-template="' + name + '"]',
    )
    if (!name || !list || !template) return null
    return {
      section,
      name,
      list,
      template: template.cloneNode(true),
      loader: section.querySelector('[bookings-loader="' + name + '"]'),
      empty: section.querySelector('[bookings-empty="' + name + '"]'),
      count: section.querySelector('[bookings-count]'),
      loadMore: section.querySelector('[bookings-load-more]'),
      filters: section.querySelector('.tabs-button_component.is-dashboard'),
      rendered: 0,
      filter: 'all',
      rows: [],
    }
  }

  function clearAuthoredItems(refs) {
    refs.list
      .querySelectorAll('[bookings-item-template]')
      .forEach(function (item) {
        item.remove()
      })
    show(refs.list, false)
    show(refs.empty, false)
    show(refs.loadMore, false)
    show(refs.filters, false)
    show(refs.loader, true)
    if (refs.count) refs.count.textContent = '0'
  }

  function filteredRows(refs) {
    if (refs.filter === 'all') return refs.rows
    return refs.rows.filter(function (booking) {
      return bookingStatus(booking) === refs.filter
    })
  }

  function filterControls(refs) {
    return Array.prototype.slice.call(
      refs.section.querySelectorAll('[booking-filter]'),
    )
  }

  function paintActiveFilter(refs) {
    filterControls(refs).forEach(function (control) {
      const value = clean(control.getAttribute('booking-filter')).toLowerCase()
      const active = value === refs.filter
      const field = control.matches && control.matches('input')
        ? control
        : control.querySelector && control.querySelector('input')
      const visual = control.querySelector && control.querySelector(
        '[data-tab-filters-check], .tab-item_button',
      )
      if (field && 'checked' in field) field.checked = active
      setClass(control, 'is-active', active)
      setClass(visual, 'is-active', active)
      setClass(visual, 'w--redirected-checked', active)
      control.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  }

  function renderSection(refs, role, reset) {
    restoreAuthoredEmptyCopy(refs)
    if (reset) {
      refs.rendered = 0
      refs.list.innerHTML = ''
    }
    const rows = filteredRows(refs)
    const target = Math.min(rows.length, refs.rendered + PAGE_SIZE)
    for (let index = refs.rendered; index < target; index += 1) {
      refs.list.appendChild(bindCard(refs.template.cloneNode(true), rows[index], role))
    }
    refs.rendered = target
    show(refs.loader, false)
    show(refs.list, rows.length > 0)
    show(refs.empty, rows.length === 0)
    show(refs.loadMore, target < rows.length)
    show(refs.filters, refs.rows.length > 0)
    paintActiveFilter(refs)
    if (refs.count) refs.count.textContent = String(refs.rows.length)
    refs.section.setAttribute('data-bookings-state', rows.length ? 'ready' : 'empty')
  }

  function wireSection(refs, role) {
    filterControls(refs).forEach(function (control) {
      control.addEventListener('click', function (event) {
        event.preventDefault()
        refs.filter = clean(control.getAttribute('booking-filter')).toLowerCase()
        renderSection(refs, role, true)
      })
    })
    paintActiveFilter(refs)
    if (refs.loadMore) {
      refs.loadMore.addEventListener('click', function (event) {
        event.preventDefault()
        renderSection(refs, role, false)
      })
    }
  }

  /**
   * The authored `cancel` and `cancelled` panels duplicate booking-element
   * nodes from the `base` panel. Filling only the first match left the panel
   * copies blank and hidden, which rendered the cancel flow's call details as
   * empty fields (Kaeser QA F3, 2026-08-29). Every setter therefore fills and
   * toggles ALL matches of a name together.
   */
  function bookingFields(modal, name) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return []
    return Array.prototype.slice.call(
      modal.querySelectorAll('[booking-element="' + name + '"]'),
    )
  }

  function setBookingField(modal, name, value, visible) {
    bookingFields(modal, name).forEach(function (field) {
      const shouldShow = visible !== false && clean(value) !== ''
      if (shouldShow) field.textContent = clean(value)
      show(field, shouldShow)
      const group = field.closest && field.closest('[booking-element-wrap]')
      if (group) show(group, shouldShow)
    })
  }

  function setBookingPrice(modal, value, visible) {
    bookingFields(modal, 'price').forEach(function (field) {
      const shouldShow = visible !== false && clean(value) !== ''
      if (shouldShow) field.textContent = clean(value)
      show(field, shouldShow)
      const group = field.closest && field.closest('[booking-element-wrap]')
      if (group) show(group, shouldShow)

      // Webflow currently authors the legacy `/hr` unit without its own custom
      // attribute. Anchor the repair to the canonical price hook and only touch
      // an adjacent exact legacy unit. This preserves the Designer-owned markup
      // while making the canonical per-call price unambiguous.
      const parent = field.parentElement
      const siblings = parent && parent.children
        ? Array.prototype.slice.call(parent.children)
        : []
      const priceUnit = siblings.find(function (candidate) {
        const unit = clean(candidate.textContent).toLowerCase()
        return candidate !== field && (unit === '/hr' || unit === '/call')
      })
      if (priceUnit) {
        priceUnit.textContent = '/Call'
        show(priceUnit, shouldShow)
      } else if (shouldShow) {
        field.textContent = clean(value) + ' / Call'
      }
    })
  }

  function hideDuplicateDetailCopy(modal, isPaid) {
    if (isPaid) return
    if (!modal || typeof modal.querySelectorAll !== 'function') return
    modal.querySelectorAll('[booking-element-wrap]').forEach(function (group) {
      if (group.querySelector && group.querySelector('[booking-element]')) return
      const copy = clean(group.textContent).toLowerCase()
      if (
        copy.includes('card ending in') ||
        copy.includes('charged for this call') ||
        copy.includes('refunded since it')
      ) show(group, false)
    })
  }

  const DETAIL_COMPOSE_PANELS = [
    'cancel-reason',
    'decline-reason',
    'reschedule',
    'reschedule-calendar',
    'payment-methods',
  ]

  // The "Are you sure?" steps before a cancel or a decline. They describe the
  // call that the member is about to end, so an earlier edit's reason there
  // reads as the reason for this action (F45, Kaeser 2026-09-28).
  const DETAIL_CONFIRM_STEP_PANELS = ['cancel', 'decline']

  /** Every authored Message control, link or button, card or modal. */
  const MESSAGE_CONTROL_SELECTOR =
    '[booking-action-btn="message"], [booking-card-action-btn="message"], ' +
    '[booking-element="brand-message-link"], [booking-element="starter-message-link"]'

  function detailCounterpart(role, booking) {
    return role === 'starter'
      ? booking && booking.brand_data
      : booking && booking.starter_data
  }

  /**
   * Deep link to the Messages thread with the booking's counterpart. Empty
   * when the counterpart's Memberstack id is unknown, so callers can gate
   * message controls on a usable destination instead of a dead '#'.
   */
  function bookingMessageHref(role, booking) {
    const counterpart = detailCounterpart(role, booking)
    const counterpartId = clean(counterpart && counterpart.memberstack_id)
    return counterpartId ? '/messages?with=' + encodeURIComponent(counterpartId) : ''
  }

  /**
   * Writes the canonical counterpart thread onto the authored card control.
   * The capture delegate remains the navigation owner, but the real anchor
   * must also carry the deep link so keyboard activation, copied links, and
   * any Webflow interaction path all resolve to the same conversation.
   */
  function setMessageControlDestination(control, href) {
    if (!control) return 0
    const links = []
    if (clean(control.tagName).toLowerCase() === 'a') links.push(control)
    if (typeof control.querySelectorAll === 'function') {
      control.querySelectorAll('a').forEach(function (link) {
        if (!links.includes(link)) links.push(link)
      })
    }
    links.forEach(function (link) {
      if (href) link.setAttribute('href', href)
      else link.removeAttribute('href')
    })
    return links.length
  }

  /**
   * Whether `panelName` is a Free cancel or decline confirmation step. Paid
   * keeps its display, as PR #974 scoped F09 to Free.
   * @param {string} panelName Authored `booking-popup-content` value.
   * @param {object} booking Canonical booking row.
   * @returns {boolean} Whether the earlier edit's reason is stale there.
   */
  function confirmStepPanel(panelName, booking) {
    return DETAIL_CONFIRM_STEP_PANELS.indexOf(clean(panelName)) !== -1 && !paidBooking(booking)
  }

  function staleEditReasonPanel(panelName, booking) {
    return confirmStepPanel(panelName, booking) || (
      clean(panelName) === 'cancelled' && !paidBooking(booking) &&
      clean(booking && booking.status).toLowerCase() === 'cancelled'
    )
  }

  /**
   * Hides an earlier proposal's reason in Free confirmation and cancelled
   * panels. Their authored "Reason" label describes the current action, not
   * the old proposal. The next populate pass restores each copy for other
   * states and Paid calls; the stored proposal history remains intact.
   * @param {HTMLElement} root Modal or panel being populated.
   * @param {object} booking Canonical booking row.
   */
  function hideStaleEditReason(root, booking) {
    bookingFields(root, 'reschedule-reason').forEach(function (field) {
      const panel = field.closest && field.closest('[booking-popup-content]')
      const panelName = panel && typeof panel.getAttribute === 'function'
        ? panel.getAttribute('booking-popup-content')
        : ''
      if (!staleEditReasonPanel(panelName, booking)) return
      show(field, false)
      const group = field.closest && field.closest('[booking-element-wrap]')
      if (group) show(group, false)
    })
  }

  /**
   * The panel's button-only footer: a direct child that holds an authored
   * action control and no booking field. Terminal panels anchor on their close
   * control. The confirmation steps carry Back plus a forward control instead,
   * so appending there put the summary below the buttons (F45).
   * @param {HTMLElement} panel Authored panel.
   * @returns {HTMLElement|null} Footer to insert before, or `null`.
   */
  function detailFooter(panel) {
    const close = panel.querySelector('[booking-action-btn="switch-close"]')
    const controls = close && close.parentNode
    if (controls && controls.parentNode === panel) return controls
    const children = Array.prototype.slice.call(panel.children || [])
    return children.find(function (child) {
      return Boolean(
        child &&
        typeof child.querySelector === 'function' &&
        child.querySelector('[booking-action-btn]') &&
        !child.querySelector('[booking-element]'),
      )
    }) || null
  }

  /**
   * Fields whose authored row can serve as the template for a module row, in
   * order of preference. Each is a one-field `[booking-element-wrap]` row
   * directly inside the panel's details table. The date hooks sit in a nested
   * two-line label, and the meeting link carries an href, so neither is used.
   */
  const DETAIL_TABLE_TEMPLATE_FIELDS = [
    'duration',
    'starter-name',
    'brand-name',
    'context',
    'reschedule-reason',
    'cancel-reason',
    'decline-reason',
  ]

  /** Attributes a cloned authored row must lose, so no controller reads it. */
  const DETAIL_TABLE_CLONE_ATTRIBUTES = ['booking-element', 'booking-element-wrap', 'id']

  function nodeWithin(node, root) {
    let candidate = node
    while (candidate) {
      if (candidate === root) return true
      candidate = candidate.parentNode
    }
    return false
  }

  /**
   * An authored details-table row that a module row can copy: the
   * `[booking-element-wrap]` around exactly one table field, with a title part
   * and a value part. Its parent is the authored table, which sits in the
   * padded card column. A wrap that is a direct child of the panel has no
   * table, so the panel keeps the separate row group above its footer (F52).
   * @param {HTMLElement} panel Authored panel.
   * @returns {HTMLElement|null} Authored row, or `null`.
   */
  function detailTableTemplateRow(panel) {
    if (!panel || typeof panel.querySelectorAll !== 'function') return null
    let found = null
    DETAIL_TABLE_TEMPLATE_FIELDS.some(function (name) {
      return Array.prototype.slice
        .call(panel.querySelectorAll('[booking-element="' + name + '"]'))
        .some(function (field) {
          const wrap = field.closest && field.closest('[booking-element-wrap]')
          const table = wrap && wrap.parentNode
          if (!table || wrap === panel || table === panel) return false
          if (!nodeWithin(table, panel)) return false
          if (typeof wrap.cloneNode !== 'function') return false
          if (wrap.querySelectorAll('[booking-element]').length !== 1) return false
          if (!wrap.children || wrap.children.length < 2) return false
          found = wrap
          return true
        })
    })
    return found
  }

  /**
   * The authored block that holds the panel's Message copy while a state rule
   * hides it: `reschedule-blocked-info` or `pending-info-text`. The module
   * Message line goes right after it, inside the same card column.
   * @param {HTMLElement} panel Authored panel.
   * @returns {HTMLElement|null} Authored block, or `null`.
   */
  function hiddenMessageBlock(panel) {
    const control = panel.querySelector(MESSAGE_CONTROL_SELECTOR)
    if (!control || typeof control.closest !== 'function') return null
    const block =
      control.closest('[reschedule-blocked-info]') ||
      control.closest('[pending-info-text]')
    return block && block.parentNode && nodeWithin(block, panel) ? block : null
  }

  function removeNode(node) {
    const parent = node && node.parentNode
    if (parent && typeof parent.removeChild === 'function') parent.removeChild(node)
  }

  /**
   * Builds one module row from a clone of an authored table row, so it keeps
   * the authored row's classes, typography and fill. The clone loses every
   * controller hook and gets the module marker, the label and the value.
   * @param {HTMLElement} template Authored row from detailTableTemplateRow.
   * @param {{field: string, label: string, value: string}} row Row content.
   * @returns {HTMLElement|null} Module-owned row, or `null`.
   */
  function detailTableSummaryRow(template, row) {
    const line = template.cloneNode(true)
    if (!line || typeof line.querySelectorAll !== 'function') return null
    const value = line.querySelector('[booking-element]')
    if (!value) return null
    const title = Array.prototype.slice.call(line.children || []).find(function (child) {
      return child !== value && !nodeWithin(value, child)
    })
    let label = title
    while (label && label.children && label.children.length) label = label.children[0]
    ;[line].concat(Array.prototype.slice.call(
      line.querySelectorAll('[booking-element], [booking-element-wrap], [id]'),
    )).forEach(function (node) {
      DETAIL_TABLE_CLONE_ATTRIBUTES.forEach(function (name) {
        if (typeof node.removeAttribute === 'function') node.removeAttribute(name)
      })
    })
    line.setAttribute('data-starters-call-summary-row', row.field)
    if (label) label.textContent = row.label
    value.textContent = row.value
    if (typeof value.removeAttribute === 'function') value.removeAttribute('href')
    show(value, true)
    show(line, true)
    return line
  }

  function detailSupplementRows(booking, role, timezone, panelName) {
    const counterpart = detailCounterpart(role, booking)
    // A decline writes its reason to cancelled_reason. On a Free declined
    // panel that is the decline reason, and an earlier edit's reason is
    // stale. Paid keeps its display unchanged, as PR #974 scoped F09.
    const declinedPanel = panelName === 'declined' && !paidBooking(booking)
    const staleEditReason = staleEditReasonPanel(panelName, booking)
    return [
      {
        field: role === 'starter' ? 'brand-name' : 'starter-name',
        label: role === 'starter' ? 'Brand' : 'Starter',
        value: clean(counterpart && counterpart.name),
      },
      { field: 'start-date-old', label: 'Current confirmed time', value: proposalOldDate(booking, timezone) },
      { field: 'start-date', label: clean(booking && booking.status).toLowerCase() === 'rescheduled' ? 'Proposed time' : 'Date and time', value: formatDate(booking && booking.start, timezone) },
      { field: 'duration', label: 'Duration', value: formatDuration(booking && booking.duration) },
      { field: 'context', label: 'Call', value: clean(booking && booking.call_context) },
      { field: 'reschedule-reason', label: 'Reschedule reason', value: declinedPanel || staleEditReason ? '' : clean(booking && booking.rescheduled_reason) },
      declinedPanel
        ? { field: 'decline-reason', label: 'Decline reason', value: clean(booking && booking.cancelled_reason) }
        : { field: 'cancel-reason', label: 'Cancellation reason', value: clean(booking && booking.cancelled_reason) },
    ].filter(function (row) {
      return row.value !== ''
    })
  }

  /**
   * Counts the boxes a node currently generates, or `null` when the host cannot
   * answer. A node inside a `display: none` ancestor generates none, so this is
   * the only probe that can tell a rendered panel from one whose whole dialog is
   * still closed — a hidden ancestor never changes a descendant's computed
   * `display`.
   * @param {HTMLElement|null} node Node to measure.
   * @returns {number|null} Box count, or `null` when geometry is unavailable.
   */
  function renderedBoxCount(node) {
    if (!node || typeof node.getClientRects !== 'function') return null
    try {
      const rects = node.getClientRects()
      return rects && typeof rects.length === 'number' ? rects.length : null
    } catch (_error) {
      return null
    }
  }

  /**
   * Whether `panel` itself contains a node matching `selector` that currently
   * renders. Every Designer-first decision inside a panel — an authored field
   * and an authored Message control alike — asks this question, so both use the
   * same probe: an authored hook counts as authoritative only while it renders,
   * and only for the panel it renders in.
   * @param {HTMLElement|null} panel Panel to search.
   * @param {string} selector Selector, scoped to the panel's subtree.
   * @returns {boolean} Whether a rendering match exists.
   */
  function panelHasUsableMatch(panel, selector) {
    if (!panel || typeof panel.querySelectorAll !== 'function') return false
    const panelRendered = renderedBoxCount(panel) > 0
    return Array.prototype.slice.call(panel.querySelectorAll(selector)).some(function (field) {
      const group = field.closest && field.closest('[booking-element-wrap]')
      if (
        field.hidden ||
        (field.style && field.style.display === 'none') ||
        (group && (group.hidden || (group.style && group.style.display === 'none')))
      ) return false
      if (typeof global.getComputedStyle === 'function') {
        try {
          if (global.getComputedStyle(field).display === 'none') return false
          if (group && global.getComputedStyle(group).display === 'none') return false
        } catch (_error) {}
      }
      if (panelRendered && renderedBoxCount(field) === 0) return false
      return true
    })
  }

  function panelHasUsableField(panel, name) {
    return panelHasUsableMatch(panel, '[booking-element="' + name + '"]')
  }

  /**
   * Adds only the call information that each authored modal panel is missing.
   * Webflow's terminal and reason panels do not all contain the same booking
   * hooks, so filling every existing hook still left those views incomplete.
   * The supplement is module-owned and idempotent; Designer-owned fields stay
   * authoritative wherever they exist. Compose steps are skipped: a summary and
   * a navigating Message link below a reason form or the slot picker is noise
   * that can also discard the participant's in-progress input.
   */
  function ensureDetailSupplements(modal, booking, role, timezone, content) {
    if (!modal || !booking || typeof modal.querySelectorAll !== 'function') return 0
    const document = modal.ownerDocument || global.document
    if (!document || typeof document.createElement !== 'function') return 0
    const authored = Array.prototype.slice.call(
      modal.querySelectorAll(content
        ? '[booking-popup-content="' + content + '"]'
        : '[booking-popup-content]'),
    )
    const panels = authored.filter(function (panel) {
      return (
        DETAIL_COMPOSE_PANELS.indexOf(
          panel && panel.getAttribute ? panel.getAttribute('booking-popup-content') : '',
        ) === -1
      )
    })
    if (!authored.length && !content) panels.push(modal)
    const counterpart = detailCounterpart(role, booking)
    const counterpartId = clean(counterpart && counterpart.memberstack_id)
    let rendered = 0

    panels.forEach(function (panel) {
      if (!panel || typeof panel.querySelector !== 'function') return
      const panelName = panel !== modal && typeof panel.getAttribute === 'function'
        ? clean(panel.getAttribute('booking-popup-content'))
        : ''
      const rows = detailSupplementRows(booking, role, timezone, panelName)
      const authoritative = rows
        .filter(function (row) {
          return panelHasUsableField(panel, row.field)
        })
        .map(function (row) {
          return row.field
        })
      // F52: module rows join the authored details table as clones of an
      // authored row, and the Message line goes into the padded card column.
      // Only a panel with no authored table keeps the separate row group
      // above the footer. Rows from an earlier pass go first, so each pass
      // leaves one row per field.
      const templateRow = detailTableTemplateRow(panel)
      const table = templateRow && templateRow.parentNode
      Array.prototype.slice
        .call(panel.querySelectorAll('[data-starters-call-summary-row]'))
        .forEach(removeNode)
      let supplement = panel.querySelector('[data-starters-call-summary]')
      if (!supplement) {
        supplement = document.createElement('div')
        supplement.setAttribute('data-starters-call-summary', '')
        supplement.style.display = 'flex'
        supplement.style.flexDirection = 'column'
        supplement.style.gap = '16px'
        supplement.style.width = '100%'
        supplement.style.marginTop = '12px'
        const anchor = table ? hiddenMessageBlock(panel) || table : null
        const column = anchor && anchor.parentNode
        const controls = detailFooter(panel)
        if (column && typeof column.insertBefore === 'function') {
          supplement.style.marginTop = '0'
          column.insertBefore(supplement, anchor.nextSibling || null)
        } else if (controls && typeof panel.insertBefore === 'function') {
          panel.insertBefore(supplement, controls)
        } else {
          panel.appendChild(supplement)
        }
      }
      supplement.textContent = ''

      const rowGroup = document.createElement('div')
      rowGroup.setAttribute('data-starters-call-summary-rows', '')
      rowGroup.style.display = 'flex'
      rowGroup.style.flexDirection = 'column'
      rowGroup.style.width = '100%'
      rowGroup.style.border = '1px solid #e2e2e2'
      rowGroup.style.borderRadius = '2px'
      rowGroup.style.overflow = 'hidden'

      rows.forEach(function (row) {
        if (authoritative.indexOf(row.field) !== -1) return
        const cloned = table ? detailTableSummaryRow(templateRow, row) : null
        if (cloned) {
          table.appendChild(cloned)
          rendered += 1
          return
        }
        const line = document.createElement('div')
        line.setAttribute('data-starters-call-summary-row', row.field)
        line.style.display = 'grid'
        line.style.gridTemplateColumns = 'minmax(120px, 34%) 1fr'
        line.style.gap = '16px'
        line.style.padding = '14px 16px'
        line.style.borderBottom = '1px solid #e2e2e2'
        line.style.alignItems = 'center'
        line.style.fontSize = '14px'
        line.style.lineHeight = '1.4'
        const label = document.createElement('strong')
        label.textContent = row.label
        const value = document.createElement('span')
        value.textContent = row.value
        line.appendChild(label)
        line.appendChild(value)
        rowGroup.appendChild(line)
        rendered += 1
      })

      // The group is only attached when it holds a row: a panel whose every
      // field is Designer-owned would otherwise show an empty bordered box.
      // The trailing row drops its divider so the group's own border closes it.
      if (rowGroup.childNodes && rowGroup.childNodes.length) {
        const lastRow = rowGroup.childNodes[rowGroup.childNodes.length - 1]
        if (lastRow && lastRow.style) lastRow.style.borderBottom = '0'
        supplement.appendChild(rowGroup)
      }

      // An authored message control (link or button) is authoritative; the
      // module-owned duplicate renders only in a panel where the Designer has
      // none that renders.
      const authoredMessage = panelHasUsableMatch(panel, MESSAGE_CONTROL_SELECTOR)
      if (counterpartId && !authoredMessage) {
        const actions = document.createElement('p')
        actions.setAttribute('data-starters-call-summary-actions', '')
        actions.style.width = '100%'
        actions.style.margin = '0'
        actions.style.fontSize = '0.875rem'
        actions.style.lineHeight = '1.5'
        const copy = document.createElement('span')
        const counterpartName = clean(counterpart && counterpart.name) ||
          (role === 'starter' ? 'the Brand' : 'the Starter')
        copy.textContent = 'If you’d like to discuss options, reach out to ' + counterpartName + ' via the '
        actions.appendChild(copy)
        const message = document.createElement('a')
        message.setAttribute('data-starters-call-message', '')
        message.href = '/messages?with=' + encodeURIComponent(counterpartId)
        message.textContent = 'Messages tab'
        message.style.display = 'inline'
        message.style.color = 'inherit'
        message.style.textDecoration = 'underline'
        actions.appendChild(message)
        const period = document.createElement('span')
        period.textContent = '.'
        actions.appendChild(period)
        supplement.appendChild(actions)
        rendered += 1
      }
      const populated = Boolean(supplement.childNodes && supplement.childNodes.length)
      show(supplement, populated)
      if (populated) supplement.style.display = 'flex'
    })
    return rendered
  }

  /**
   * Re-runs the supplement once the detail dialog has actually been laid out.
   *
   * The View Details binding runs in the capture phase, before Webflow opens
   * the dialog, so at that moment nothing inside it generates a box and no
   * authored hook can be measured. Sampling geometry only in that pass would
   * never observe the live panel, which is where a hook can render with no box
   * of its own and no `[booking-element-wrap]` to key off. One animation frame
   * later the dialog is open, the base panel has boxes, and the same idempotent
   * pass either keeps the authored hook authoritative or renders the
   * module-owned row in its place.
   *
   * The frame callback re-reads `data-booking-id` so a modal that was closed,
   * reset, or rebound to another call in the meantime is left alone. A newer
   * render also supersedes queued work so canonical rows cannot overwrite a
   * scoped proposal receipt.
   * @param {HTMLElement|null} modal Detail modal being populated.
   * @param {object} booking Canonical row or receipt-only proposal model.
   * @param {string} role Signed-in member's role.
   * @param {string} [timezone] Display timezone.
   * @param {string} [content] Limit rendering to this booking-popup-content panel.
   * @returns {boolean} Whether a recompute was scheduled.
   */
  function scheduleDetailSupplements(modal, booking, role, timezone, content) {
    if (!modal || !booking || typeof modal.getAttribute !== 'function') return false
    if (typeof global.requestAnimationFrame !== 'function') return false
    const bookingId = clean(modal.getAttribute('data-booking-id'))
    const render = {}
    modal.__startersDetailSupplementRender = render
    try {
      global.requestAnimationFrame(function () {
        if (clean(modal.getAttribute('data-booking-id')) !== bookingId) return
        if (modal.__startersDetailSupplementRender !== render) return
        ensureDetailSupplements(modal, booking, role, timezone, content)
      })
    } catch (_error) {
      return false
    }
    return true
  }

  /**
   * Renders or hides a muted one-line explanation under an authored action
   * button that eligibility gating hides. The node is module-owned and marked
   * `data-starters-action-hint`; authored markup is never edited. During soft
   * launch no hint is shown (see configureDetailActions), so this only hides
   * a node that an earlier version or an earlier booking left in the modal.
   */
  function ensureActionHint(modal, anchor, name, message, visible) {
    if (!modal || typeof modal.querySelector !== 'function') return
    let hint = modal.querySelector('[data-starters-action-hint="' + name + '"]')
    if (!visible) {
      if (hint) show(hint, false)
      return
    }
    if (!hint) {
      const document = modal.ownerDocument || global.document
      if (
        !anchor ||
        !document ||
        typeof document.createElement !== 'function' ||
        typeof anchor.insertAdjacentElement !== 'function'
      ) return
      hint = document.createElement('div')
      hint.setAttribute('data-starters-action-hint', name)
      hint.style.fontSize = '13px'
      hint.style.lineHeight = '1.4'
      hint.style.color = '#6b6f66'
      hint.style.marginTop = '8px'
      anchor.insertAdjacentElement('afterend', hint)
    }
    hint.textContent = message
    show(hint, true)
  }

  function configureDetailActions(modal, role, status, booking, now) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return
    if (
      validDashboardModule(global.StartersDashboardCallActions) &&
      typeof global.StartersDashboardCallActions.ensureRescheduleViews === 'function'
    ) {
      global.StartersDashboardCallActions.ensureRescheduleViews(
        modal.ownerDocument || global.document,
        modal,
      )
    }
    modal
      .querySelectorAll(DETAIL_ACTION_SELECTOR)
      .forEach(function (button) {
        const action = clean(
          button.getAttribute('booking-action-btn') ||
          button.getAttribute('booking-card-action-btn'),
        )
        if (action === 'switch-base') return
        const accept =
          action === 'switch-confirm' &&
          canConfirmBooking(role, booking, now)
        const decline =
          (action === 'switch-decline' ||
            action === 'switch-decline-reason' ||
            action === 'decline') &&
          // Same response-window rule as the card: an expired request is read-only.
          responseWindowOpen(booking, now) &&
          validDashboardModule(global.StartersDashboardCallActions) &&
          typeof global.StartersDashboardCallActions.canDecline === 'function' &&
          global.StartersDashboardCallActions.canDecline(role, booking)
        const cancel =
          (action === 'switch-cancel' ||
            action === 'switch-cancel-reason' ||
            action === 'cancel') &&
          validDashboardModule(global.StartersDashboardCallActions) &&
          typeof global.StartersDashboardCallActions.canCancel === 'function' &&
          global.StartersDashboardCallActions.canCancel(role, booking, now)
        // Two contracts share this button: propose-then-confirm on a confirmed
        // call, and a direct time update on a Brand's own pending request.
        const proposeReschedule =
          (action === 'reschedule' || action === 'reschedule-calendar') &&
          validDashboardModule(global.StartersDashboardCallActions) &&
          typeof global.StartersDashboardCallActions.rescheduleKindFor === 'function' &&
          global.StartersDashboardCallActions.rescheduleKindFor(role, booking, now) !== ''
        const respondReschedule =
          (action === 'confirm-reschedule' || action === 'reschedule-decline') &&
          validDashboardModule(global.StartersDashboardCallActions) &&
          (action === 'confirm-reschedule'
            ? typeof global.StartersDashboardCallActions.canConfirmReschedule === 'function' &&
              global.StartersDashboardCallActions.canConfirmReschedule(role, booking)
            // "Keep Current Time" is retired (JP 2a, 2026-10-03). Fail closed:
            // an actions module without canKeepCurrentTime keeps it hidden.
            : typeof global.StartersDashboardCallActions.canKeepCurrentTime === 'function' &&
              global.StartersDashboardCallActions.canKeepCurrentTime(role, booking))
        const media =
          action === 'notetaker-media' &&
          validDashboardModule(global.StartersDashboardCallMedia) &&
          typeof global.StartersDashboardCallMedia.canReadMedia === 'function' &&
          global.StartersDashboardCallMedia.canReadMedia(booking, status)
        const message =
          action === 'message' && bookingMessageHref(role, booking) !== ''
        const paymentAction = clean(button.getAttribute('payment-action-btn'))
        const paymentControl = ['change-card', 'change-card-v2', 'add-card'].includes(paymentAction) ||
          (typeof button.hasAttribute === 'function' &&
            (button.hasAttribute('popup-stripe-card-open') || button.hasAttribute('pm-use-this')))
        const preferredPaymentControl = paymentAction !== 'change-card' ||
          !modal.querySelector('[payment-action-btn="change-card-v2"]')
        const payment = paymentControl && preferredPaymentControl &&
          typeof global.StartersDashboardCallPayment?.canManageCards === 'function' &&
          global.StartersDashboardCallPayment.canManageCards(role, booking)
        show(
          button,
          action === 'switch-close' ||
            accept ||
            decline ||
            cancel ||
            proposeReschedule ||
            respondReschedule ||
            media ||
            payment ||
            message,
        )
      })
    // Soft launch (JP meeting, 2026-09-30): a gated Paid action stays hidden
    // with no explanation, so the modal never names a feature that is not
    // live yet. This reverses the 2026-08-29 hint rule. A hint node that an
    // earlier version or an earlier booking left in the modal still hides.
    ACTION_HINT_NAMES.forEach(function (name) {
      ensureActionHint(modal, null, name, '', false)
    })
    const deepLinkState =
      typeof modal.getAttribute === 'function'
        ? clean(modal.getAttribute('data-booking-deep-link'))
        : ''
    if (deepLinkState && deepLinkState !== 'current_actionable_request') {
      makeDeepLinkDetailReadOnly(modal)
    }
  }

  function resetDetailActionState(modal) {
    global.StartersDashboardCallPayment?.invalidateModal?.(modal)
    const actionsModule = global.StartersDashboardCallActions
    if (!validDashboardModule(actionsModule)) return
    if (typeof actionsModule.resetRescheduleState === 'function') {
      actionsModule.resetRescheduleState(modal)
    }
    if (typeof actionsModule.showActionError === 'function') {
      actionsModule.showActionError(modal, '')
    }
  }

  function authoredDetailPanel(modal, name) {
    return (
      Boolean(name) &&
      Boolean(modal) &&
      typeof modal.querySelector === 'function' &&
      Boolean(modal.querySelector('[booking-popup-content="' + name + '"]'))
    )
  }

  function uniqueCompletedDetailPanel(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return null
    // Both dashboards also have an older proposal-result panel labelled
    // `completed`. Its existing result marker distinguishes it from the
    // authored Call Completed panel, regardless of their DOM order.
    const panels = Array.prototype.filter.call(
      modal.querySelectorAll('[booking-popup-content="completed"]'),
      function (panel) {
        return typeof panel.querySelector === 'function' &&
          !panel.querySelector('[result-confirmed-text]')
      },
    )
    return panels.length === 1 ? panels[0] : null
  }

  /**
   * Raw statuses bookingStatus folds into `cancelled` that the Designer can
   * author their own panel for. Each resolves to that panel when it exists and
   * falls back to the shared `cancelled` panel when it does not.
   *
   * `expired` is deliberately absent. Both expiry writers record an expired
   * request as `cancelled` with `cancelled_by = "expired"`, never as a raw
   * `expired` status, so an entry here could only point at a panel no booking
   * is able to reach.
   */
  const TERMINAL_PANEL_BY_RAW_STATUS = {
    declined: 'declined',
  }

  /**
   * Panel the details modal opens on. Terminal bookings open their authored
   * terminal panel so the Designer view renders instead of a module-composed
   * base view. Free completed calls require one unambiguous terminal panel;
   * Paid completed calls retain the shared library's existing selection.
   * `base` stays the acting view for live calls and the safe fallback.
   */
  function detailOpenPanel(modal, booking, status) {
    const raw = clean(booking && booking.status).toLowerCase()
    let candidate = ''
    if (status === 'cancelled') {
      const authoredRawPanel = TERMINAL_PANEL_BY_RAW_STATUS[raw]
      candidate =
        authoredRawPanel && authoredDetailPanel(modal, authoredRawPanel)
          ? authoredRawPanel
          : 'cancelled'
    } else if (status === 'completed') {
      candidate = paidBooking(booking) || uniqueCompletedDetailPanel(modal)
        ? 'completed'
        : ''
    }
    return authoredDetailPanel(modal, candidate) ? candidate : 'base'
  }

  function detailOpenPanelForMeeting(modal, booking, status, referenceTime) {
    return meetingHrefAtReference(booking, referenceTime)
      ? 'base'
      : detailOpenPanel(modal, booking, status)
  }

  const meetingForcedDetailBases = new WeakSet()

  function selectDetailPanel(modal, booking, role, openPanel) {
    const isPaid = paidBooking(booking)
    const actionsModule = global.StartersDashboardCallActions
    if (
      validDashboardModule(actionsModule) &&
      typeof actionsModule.switchPopupContent === 'function'
    ) {
      actionsModule.switchPopupContent(modal, openPanel)
    } else {
      modal.querySelectorAll('[booking-popup-content]').forEach(function (content) {
        show(content, content.getAttribute('booking-popup-content') === openPanel)
      })
    }
    if (openPanel === 'completed' && !isPaid) {
      const terminalPanel = uniqueCompletedDetailPanel(modal)
      modal.querySelectorAll('[booking-popup-content="completed"]').forEach(function (panel) {
        if (panel !== terminalPanel) show(panel, false)
      })
    }
    if (openPanel !== 'base') {
      hideDetailBackControl(modal)
      if (
        validDashboardModule(actionsModule) &&
        typeof actionsModule.fillCounterpartPlaceholders === 'function'
      ) {
        actionsModule.fillCounterpartPlaceholders(modal, openPanel, role, booking)
      }
    }
    return true
  }

  function visibleDetailPanels(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return []
    return Array.prototype.filter.call(
      modal.querySelectorAll('[booking-popup-content]'),
      function (panel) {
        return !panel.hidden && !(panel.style && panel.style.display === 'none')
      },
    )
  }

  function refreshOpenDetailPanel(refs, role, now) {
    if (!global.document || typeof global.document.querySelector !== 'function') return false
    const modal = global.document.querySelector(DETAIL_MODAL_SELECTOR)
    if (!modal || typeof modal.getAttribute !== 'function') return false
    const booking = bookingFromCard(Array.isArray(refs) ? refs : [], modal)
    if (!booking) return false
    const visible = visibleDetailPanels(modal)
    if (!visible.length) return false
    const storedStatus = clean(modal.getAttribute('data-booking-status'))
    const naturalPanel = detailOpenPanel(modal, booking, storedStatus)
    const forcedBase = meetingForcedDetailBases.has(modal)
    const previousPanel = forcedBase ? 'base' : naturalPanel
    if (visible.some(function (panel) {
      return clean(panel.getAttribute('booking-popup-content')) !== previousPanel
    })) {
      if (forcedBase) meetingForcedDetailBases.delete(modal)
      return false
    }
    if (
      previousPanel === 'completed' && !paidBooking(booking) &&
      (visible.length !== 1 || visible[0] !== uniqueCompletedDetailPanel(modal))
    ) return false
    const referenceTime = meetingReferenceTime(booking, now)
    const currentStatus = detailStatusAtReference(booking, referenceTime)
    const nextPanel = detailOpenPanelForMeeting(
      modal,
      booking,
      currentStatus,
      referenceTime,
    )
    if (currentStatus !== storedStatus) {
      modal.setAttribute('data-booking-status', currentStatus)
      setBookingField(modal, 'status', statusLabel(currentStatus, role, booking), true)
      configureDetailActions(modal, role, currentStatus, booking, referenceTime)
    }
    if (nextPanel === previousPanel) return false
    const selected = selectDetailPanel(modal, booking, role, nextPanel)
    if (selected && nextPanel === 'base' && naturalPanel !== 'base') {
      meetingForcedDetailBases.add(modal)
    } else if (selected) {
      meetingForcedDetailBases.delete(modal)
    }
    return selected
  }

  /**
   * The authored back control returns to the base panel, so it is meaningful
   * only after a chain has navigated away from it. A modal that opens directly
   * on a terminal panel has nowhere to return to, so the control stays hidden
   * until the member navigates, keeping the doubled close icon off the opening
   * view.
   */
  function hideDetailBackControl(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return
    modal
      .querySelectorAll(
        '[booking-action-btn="switch-base"], [booking-card-action-btn="switch-base"]',
      )
      .forEach(function (control) {
        show(control, false)
      })
  }

  function proposalOldDate(booking, timezone) {
    if (clean(booking && booking.status).toLowerCase() !== 'rescheduled') return ''
    return formatDate(normalizeTimestamp(booking && booking.start_old), timezone)
  }

  function proposalStatusText(booking, role) {
    if (clean(booking && booking.status).toLowerCase() !== 'rescheduled') return ''
    const proposer = clean(booking && booking.rescheduled_by).toLowerCase()
    if (!['brand', 'starter'].includes(proposer) || !['brand', 'starter'].includes(role)) return ''
    if (proposer !== role) return ' — Awaiting your confirmation of the proposed time.'
    return ' — Awaiting ' + (role === 'brand' ? 'Starter' : 'Brand') + ' confirmation of the proposed time.'
  }

  function populateDetailSchedule(root, booking, role) {
    const timezone = viewerTimezone(role, booking)
    setBookingField(root, 'start-date', formatDate(booking.start, timezone), true)
    // The shared date formatter already includes time and timezone.
    ;['start-time', 'start-time-old'].forEach(function (name) {
      bookingFields(root, name).forEach(function (field) { show(field, false) })
    })
    const oldDate = proposalOldDate(booking, timezone)
    setBookingField(root, 'start-date-old', oldDate, oldDate !== '')
    const statusText = proposalStatusText(booking, role)
    setBookingField(root, 'status-text', statusText, statusText !== '')
    setBookingField(root, 'reschedule-reason', booking.rescheduled_reason, Boolean(booking.rescheduled_reason))
    hideStaleEditReason(root, booking)
  }

  // Authored state of each decline-reason hook and its wrap from before a
  // Free fill first changed it, so a reused modal can put it back for Paid.
  const authoredDeclineReasons = new WeakMap()

  function displayState(node) {
    return node ? { node: node, hidden: node.hidden, display: node.style && node.style.display } : null
  }

  /**
   * The authored declined panels carry a decline-reason hook. A Free booking
   * fills it, which keeps the supplement from adding a second reason row
   * there. Paid keeps its v1.59.633 display (PR #974 scoped F09 to Free): the
   * hook stays as authored, restored when a Free booking changed it first.
   * @param {HTMLElement} modal Detail modal being populated.
   * @param {object} booking Canonical booking row.
   * @param {boolean} isPaid Whether the booking is a Paid call.
   */
  function populateDeclineReason(modal, booking, isPaid) {
    const fields = bookingFields(modal, 'decline-reason')
    if (isPaid) {
      fields.forEach(function (field) {
        const authored = authoredDeclineReasons.get(field)
        if (!authored) return
        field.textContent = authored.text
        authored.states.forEach(function (state) {
          state.node.hidden = state.hidden
          if (state.node.style) state.node.style.display = state.display
        })
      })
      return
    }
    fields.forEach(function (field) {
      if (authoredDeclineReasons.has(field)) return
      const group = field.closest && field.closest('[booking-element-wrap]')
      authoredDeclineReasons.set(field, {
        text: field.textContent,
        states: [displayState(field), displayState(group)].filter(Boolean),
      })
    })
    setBookingField(
      modal,
      'decline-reason',
      booking.cancelled_reason,
      clean(booking.status).toLowerCase() === 'declined' && Boolean(booking.cancelled_reason),
    )
  }

  function populateDetailModal(modal, booking, role, now, content) {
    if (!modal || !booking) return false
    const timezone = viewerTimezone(role, booking)
    if (content) {
      const panel = modal.querySelector('[booking-popup-content="' + content + '"]')
      if (!panel) return false
      populateDetailSchedule(panel, booking, role)
      ensureDetailSupplements(modal, booking, role, timezone, content)
      scheduleDetailSupplements(modal, booking, role, timezone, content)
      return true
    }
    resetDeepLinkDetailState(modal)
    const nextBookingId = clean(booking.booking_id || booking.id)
    const previousBookingId = clean(modal.getAttribute('data-booking-id'))
    if (previousBookingId !== nextBookingId) resetDetailActionState(modal)
    const referenceTime = meetingReferenceTime(booking, now)
    const status = bookingStatus(booking, now)
    const isPaid = paidBooking(booking)
    const paymentText = isPaid && status !== 'cancelled' && status !== 'archived'
      ? booking.pm_confirmed
        ? 'Payment method confirmed.'
        : 'Payment method pending.'
      : ''

    modal.setAttribute('data-booking-id', nextBookingId)
    modal.setAttribute('data-booking-status', status)
    modal.setAttribute('data-booking-payment', isPaid ? 'paid' : 'free')

    const naturalPanel = detailOpenPanel(modal, booking, status)
    const openPanel = detailOpenPanelForMeeting(modal, booking, status, referenceTime)
    selectDetailPanel(modal, booking, role, openPanel)
    if (openPanel === 'base' && naturalPanel !== 'base') {
      meetingForcedDetailBases.add(modal)
    } else {
      meetingForcedDetailBases.delete(modal)
    }
    setBookingField(modal, 'paid-meeting', isPaid ? 'Paid Call' : 'Free Call', true)
    setBookingField(modal, 'status', statusLabel(status, role, booking), true)
    setBookingField(modal, 'brand-name', booking.brand_data && booking.brand_data.name, true)
    setBookingField(modal, 'starter-name', booking.starter_data && booking.starter_data.name, true)
    setBookingField(modal, 'title', booking.call_context || 'Call', true)
    setBookingField(modal, 'context', booking.call_context, true)
    populateDetailSchedule(modal, booking, role)
    setBookingField(modal, 'duration', formatDuration(booking.duration), true)
    setBookingPrice(modal, formatPrice(booking.price, isPaid), isPaid)
    setBookingField(modal, 'payment-status-text', paymentText, isPaid)
    setBookingField(modal, 'cancel-reason', booking.cancelled_reason, Boolean(booking.cancelled_reason))
    populateDeclineReason(modal, booking, isPaid)

    paintMeetingDestinationsAt(modal, booking, referenceTime, true)

    // Authored "Messages tab" links are Designer-owned copy; resetDetailModal
    // clears and hides every [booking-element], so each populate pass must
    // restore their text, destination, and visibility. Only the counterpart's
    // identity row carries a thread: the signed-in member's own row would link
    // to a conversation with itself.
    const messageHref = bookingMessageHref(role, booking)
    const counterpartMessageLink =
      role === 'starter' ? 'brand-message-link' : 'starter-message-link'
    bookingFields(modal, counterpartMessageLink).forEach(function (link) {
      if ('href' in link) link.href = messageHref || '/messages'
      if (clean(link.textContent) === '') link.textContent = 'Messages tab'
      show(link, true)
      const group = link.closest && link.closest('[booking-element-wrap]')
      if (group) show(group, true)
    })

    const base = modal.querySelector('[booking-popup-content="base"]') || modal
    const pendingMessages = Array.prototype.slice.call(
      base.querySelectorAll ? base.querySelectorAll('[pending-info-text]') : [],
    )
    pendingMessages.forEach(function (message, index) {
      show(message, index === 0 && status === 'pending' && responseWindowOpen(booking, now))
    })
    modal.querySelectorAll('[reschedule-blocked-info]').forEach(function (info) {
      show(info, false)
    })
    configureDetailActions(modal, role, status, booking, now)
    ensureDetailSupplements(modal, booking, role, timezone)
    scheduleDetailSupplements(modal, booking, role, timezone)
    hideDuplicateDetailCopy(modal, isPaid)
    return true
  }

  function bookingById(refs, bookingId) {
    const id = clean(bookingId)
    if (!id) return null
    let booking = null
    refs.some(function (section) {
      booking = (Array.isArray(section && section.rows) ? section.rows : []).find(function (row) {
        return clean(row.booking_id || row.id) === id
      }) || null
      return Boolean(booking)
    })
    return booking
  }

  function bookingFromCard(refs, card) {
    return bookingById(refs, card && card.getAttribute('data-booking-id'))
  }

  function bookingForActionTarget(refs, target) {
    const carrier =
      target &&
      target.closest &&
      target.closest('[data-booking-id]')
    return bookingFromCard(refs, carrier)
  }

  function resetDetailModal() {
    if (!global.document || typeof global.document.querySelector !== 'function') return
    const modal = global.document.querySelector(DETAIL_MODAL_SELECTOR)
    if (!modal) return
    meetingForcedDetailBases.delete(modal)
    resetDetailActionState(modal)
    if (typeof modal.close === 'function') {
      try {
        modal.close()
      } catch (_error) {}
    }
    modal.removeAttribute('open')
    modal.removeAttribute('data-booking-id')
    modal.removeAttribute('data-booking-status')
    modal.removeAttribute('data-booking-payment')
    modal.querySelectorAll('[booking-element]').forEach(function (field) {
      field.textContent = ''
      if (clean(field.getAttribute && field.getAttribute('booking-element')) === 'meeting-link') {
        setMeetingDestination(field, '', true)
      } else if ('href' in field) field.href = ''
      show(field, false)
      const group = field.closest && field.closest('[booking-element-wrap]')
      if (group) show(group, false)
    })
    // F52 rows live in the authored tables, outside the supplement, so an
    // identity reset removes them on their own.
    modal.querySelectorAll('[data-starters-call-summary-row]').forEach(removeNode)
    modal.querySelectorAll('[data-starters-call-summary]').forEach(function (supplement) {
      supplement.textContent = ''
      show(supplement, false)
    })
    modal
      .querySelectorAll(
        '[booking-popup-content], [pending-info-text], ' + DETAIL_ACTION_SELECTOR,
      )
      .forEach(function (element) {
        show(element, false)
      })
  }

  function openBookingDetail(modal, booking, role) {
    const system = global.lumos && global.lumos.modal
    const dialog = modal && modal.closest && modal.closest('dialog')
    if (!system || typeof system.open !== 'function' ||
        !system.list || !system.list['popup-booking-info']) return false
    if (!populateDetailModal(modal, booking, role)) return false
    system.open('popup-booking-info')
    return !dialog || dialog.open
  }

  function canonicalDeepLinkState(locator, bookings, memberId, role, now) {
    if (!locator || !memberId || !['starter', 'brand'].includes(role)) return null
    const booking = (Array.isArray(bookings) ? bookings : []).find(function (candidate) {
      return (
        clean(candidate && candidate.booking_id) === locator.bookingId &&
        clean(candidate && candidate.data_environment).toLowerCase() === locator.environment &&
        memberOwnsBooking(candidate, memberId, role)
      )
    })
    if (!booking) return null
    const rawRevision = booking.lifecycle_revision
    const revisionValue = clean(rawRevision)
    const revision = Number(rawRevision)
    const validRevision =
      /^\d+$/.test(revisionValue) &&
      Number.isSafeInteger(revision) &&
      revision >= 0
    const stale = !validRevision || revision !== locator.revision
    const reference = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    const rawExpiresAt = booking.confirmation_expires_at
    const expiresAtValue = clean(rawExpiresAt)
    const expiresAt = normalizeTimestamp(rawExpiresAt)
    const validFutureExpiry =
      expiresAtValue !== '' &&
      Number.isFinite(expiresAt) &&
      expiresAt > reference
    const actionable =
      !stale &&
      role === 'starter' &&
      bookingStatus(booking, now) === 'pending' &&
      validFutureExpiry &&
      responseWindowOpen(booking, now)
    return {
      booking,
      readOnly: !actionable,
      reason: stale ? 'stale_revision' : (actionable ? 'current_actionable_request' : 'current_state_read_only'),
    }
  }

  function makeDeepLinkDetailReadOnly(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return 0
    const nonMutatingActions = ['switch-close', 'switch-base', 'message', 'details', 'notetaker-media']
    const controls = Array.prototype.slice
      .call(modal.querySelectorAll(DETAIL_ACTION_SELECTOR))
      .filter(function (control) {
        const action = clean(
          control.getAttribute('booking-action-btn') ||
          control.getAttribute('booking-card-action-btn'),
        )
        if (nonMutatingActions.includes(action)) return false
        return Boolean(
          action ||
          clean(control.getAttribute('payment-action-btn')) ||
          control.hasAttribute('booking-pm-action') ||
          control.hasAttribute('data-btn-payment') ||
          control.hasAttribute('popup-stripe-card-open') ||
          control.hasAttribute('pm-use-this'),
        )
      })
    controls.forEach(function (control) {
      if (!control.__startersDeepLinkControlState) {
        control.__startersDeepLinkControlState = {
          hadAriaDisabled: control.hasAttribute('aria-disabled'),
          ariaDisabled: control.getAttribute('aria-disabled'),
          hadTabindex: control.hasAttribute('tabindex'),
          tabindex: control.getAttribute('tabindex'),
          hasDisabledProperty: 'disabled' in control,
          disabled: 'disabled' in control ? Boolean(control.disabled) : false,
          hidden: Boolean(control.hidden),
          display: control.style && control.style.display,
        }
      }
      show(control, false)
      control.setAttribute('data-booking-deep-link-disabled', '')
      control.setAttribute('aria-disabled', 'true')
      control.setAttribute('tabindex', '-1')
      if ('disabled' in control) control.disabled = true
    })
    return controls.length
  }

  function resetDeepLinkDetailState(modal) {
    if (!modal || typeof modal.querySelectorAll !== 'function') return 0
    const controls = Array.prototype.slice.call(
      modal.querySelectorAll('[data-booking-deep-link-disabled]'),
    )
    controls.forEach(function (control) {
      const state = control.__startersDeepLinkControlState
      control.removeAttribute('data-booking-deep-link-disabled')
      if (state && state.hadAriaDisabled) {
        control.setAttribute('aria-disabled', state.ariaDisabled)
      } else {
        control.removeAttribute('aria-disabled')
      }
      if (state && state.hadTabindex) {
        control.setAttribute('tabindex', state.tabindex)
      } else {
        control.removeAttribute('tabindex')
      }
      if (state && state.hasDisabledProperty) control.disabled = state.disabled
      if (state) {
        control.hidden = state.hidden
        if (control.style) control.style.display = state.display
      }
      delete control.__startersDeepLinkControlState
    })
    modal.removeAttribute('data-booking-deep-link')
    return controls.length
  }

  function focusCanonicalDeepLink(locator, bookings, memberId, role, now) {
    const state = canonicalDeepLinkState(locator, bookings, memberId, role, now)
    if (!state || !global.document || typeof global.document.querySelector !== 'function') {
      return { focused: false, readOnly: true, reason: 'canonical_booking_unavailable' }
    }
    const modal = global.document.querySelector(DETAIL_MODAL_SELECTOR)
    if (!modal || !openBookingDetail(modal, state.booking, role)) {
      return { focused: false, readOnly: true, reason: 'details_unavailable' }
    }
    if (state.readOnly) makeDeepLinkDetailReadOnly(modal)
    modal.setAttribute('data-booking-deep-link', state.reason)
    return { focused: true, readOnly: state.readOnly, reason: state.reason }
  }

  async function focusCanonicalDeepLinkWhenReady(
    locator,
    bookings,
    memberId,
    role,
    now,
    generation,
    currentGeneration,
    options,
  ) {
    const settings = options || {}
    const delays = Array.isArray(settings.delays)
      ? settings.delays
      : DEEP_LINK_READY_DELAYS_MS
    const schedule = settings.setTimeout || global.setTimeout
    const clock = typeof settings.now === 'function' ? settings.now : Date.now
    let result = { focused: false, readOnly: true, reason: 'details_unavailable' }
    for (let index = 0; index < delays.length; index += 1) {
      if (generation !== currentGeneration()) {
        return { focused: false, readOnly: true, reason: 'session_changed' }
      }
      const delay = Number(delays[index])
      if (delay > 0) {
        if (typeof schedule !== 'function') break
        await new Promise(function (resolve) { schedule(resolve, delay) })
      }
      if (generation !== currentGeneration()) {
        return { focused: false, readOnly: true, reason: 'session_changed' }
      }
      result = focusCanonicalDeepLink(locator, bookings, memberId, role, clock())
      if (result.focused || result.reason !== 'details_unavailable') return result
    }
    return result
  }

  function wireBookingDetails(refs, role) {
    if (!global.document || !global.document.addEventListener) return
    global.document.addEventListener('click', function (event) {
      const target = event && event.target
      const reschedule = target && target.closest
        ? target.closest('[booking-action-btn="reschedule"], [booking-card-action-btn="reschedule"]')
        : null
      if (reschedule) {
        // Hide-era guard (v1.59.309): stopping every delegated Reschedule click
        // kept the empty legacy modal from opening. The reschedule chain now
        // ships in dashboard-call-actions.js, whose capture listener registers
        // AFTER this one, so an unconditional stop leaves the authored button
        // dead. Hand the click to the actions module when it can own it, and
        // keep swallowing when it cannot: module not loaded yet, booking
        // unresolved, or booking ineligible.
        const actionsModule = global.StartersDashboardCallActions
        const eligible =
          validDashboardModule(actionsModule) &&
          typeof actionsModule.rescheduleKindFor === 'function' &&
          actionsModule.rescheduleKindFor(
            role,
            bookingForActionTarget(refs, reschedule),
            Date.now(),
          ) !== ''
        if (eligible) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        else if (event.stopPropagation) event.stopPropagation()
        return
      }

      const details = target && target.closest
        ? target.closest('[data-modal-trigger="popup-booking-info"], [booking-action-btn="details"], [booking-card-action-btn="details"], [data-booking-details]')
        : null
      if (!details) return
      const card = details.closest && details.closest('[data-booking-id]')
      const booking = bookingFromCard(refs, card)
      const modal = global.document.querySelector(DETAIL_MODAL_SELECTOR)
      if (!booking || !modal || !populateDetailModal(modal, booking, role)) {
        if (event.preventDefault) event.preventDefault()
        if (event.stopImmediatePropagation) event.stopImmediatePropagation()
        else if (event.stopPropagation) event.stopPropagation()
      }
    }, true)
  }

  /**
   * Moves the sticky sub-nav anchors out of an authored duplicate tile before the
   * duplicate is hidden.
   *
   * The Designer put the dashboard's `#calls-section` anchor inside the *authored*
   * Calls tile rather than inside the V3 `[bookings-section]` tile that replaces it.
   * Hiding the duplicate with `display: none` therefore takes that id out of layout —
   * it stops generating a box, `getClientRects()` returns nothing, and the browser
   * has nowhere to send a fragment jump. The CALLS tab and every `#calls-section`
   * deep link (the post-call review email CTA carries one) then land on whichever
   * tile happens to sit at the current scroll position, which reads as "the tab does
   * nothing and the Messages panel shows instead".
   *
   * The anchors are zero-width absolutely positioned divs whose negative offset is
   * authored, so re-parenting one into the live tile keeps the landing position it
   * was designed with.
   *
   * An id another element already owns is left where it is: two elements sharing an
   * id would make `getElementById` pick whichever comes first in the document and
   * reintroduce the same class of bug.
   * @param {HTMLElement|null} source Tile about to be hidden.
   * @param {HTMLElement|null} target Live `[bookings-section]` tile that replaces it.
   * @returns {number} How many anchors moved.
   */
  function adoptSectionAnchors(source, target) {
    if (!source || !target || source === target) return 0
    if (typeof source.querySelectorAll !== 'function') return 0
    if (typeof target.insertBefore !== 'function') return 0
    let moved = 0
    Array.prototype.slice
      .call(source.querySelectorAll(SECTION_ANCHOR_SELECTOR))
      .forEach(function (anchor) {
        const id = clean(anchor && anchor.getAttribute && anchor.getAttribute('id'))
        if (!id) return
        if (document.getElementById(id) !== anchor) return
        target.insertBefore(anchor, target.firstChild || null)
        moved += 1
      })
    return moved
  }

  /** First live tile per `[bookings-section]` name, keyed lower-case. The
   * attribute alone is the contract (matching boot()); the class is only the
   * preferred match, so a Designer rename of the tile class cannot silently
   * disable anchor adoption. */
  function liveSectionTiles() {
    const tiles = {}
    const classed = document.querySelectorAll('.dash-main_tile-item[bookings-section]')
    const source = classed.length ? classed : document.querySelectorAll('[bookings-section]')
    Array.prototype.slice.call(source).forEach(function (tile) {
      const name = clean(tile.getAttribute('bookings-section')).toLowerCase()
      if (name && !tiles[name]) tiles[name] = tile
    })
    return tiles
  }

  function hideAuthoredDuplicates() {
    const live = liveSectionTiles()
    document.querySelectorAll('.dash-main_tile-item').forEach(function (tile) {
      if (tile.hasAttribute('bookings-section')) return
      const heading = tile.querySelector('h1,h2,h3,h4,h5,h6')
      const label = clean(heading && heading.textContent).toLowerCase()
      const name = DUPLICATE_SECTION_NAMES[label]
      if (!name) return
      // No live counterpart means nothing to hand the anchors to; the duplicate is
      // still hidden, exactly as before, so the documented contract is unchanged.
      adoptSectionAnchors(tile, live[name])
      show(tile, false)
    })
  }

  function projectFilterIsActive(params) {
    const status = clean(params && params.status).toLowerCase()
    return Boolean(status && status !== '*')
  }

  function projectTotal(state) {
    const value = state && state.data && state.data.total
    if (value == null || clean(value) === '') return Number.NaN
    const total = Number(value)
    return Number.isFinite(total) && total >= 0 ? total : Number.NaN
  }

  function projectFilterVisible(state, memory) {
    const snapshot = state || {}
    const query = snapshot.query || {}
    const activeFilter = projectFilterIsActive(query.params)
    const total = projectTotal(snapshot)
    const resolved = snapshot.status === 'success' && Number.isFinite(total)

    if (memory.authTransition) {
      if (!resolved) return false
      memory.authTransition = false
    }

    if (resolved) {
      if (total > 0) {
        memory.known = true
        memory.hasAny = true
      } else if (!activeFilter) {
        memory.known = true
        memory.hasAny = false
      }
    }

    if (activeFilter) memory.navigationVisible = true

    // Once an unfiltered result proves projects exist, keep the controls
    // available throughout later loading/error transitions so the member can
    // switch away from the current filter. Before that proof exists, an active
    // filter is itself enough reason to keep its navigation visible. Do not
    // probe All behind the member's back: rendering that replacement list can
    // strand a selected empty filter on its loading state before it is restored.
    return memory.known
      ? memory.hasAny
      : Boolean(activeFilter || memory.navigationVisible)
  }

  function findProjectLoadMore(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return []
    const canonical = Array.prototype.slice.call(
      root.querySelectorAll('[wf-xano-element="load-more"]'),
    )
    if (canonical.length) return canonical
    return Array.prototype.slice
      .call(root.querySelectorAll('.button_main-wrap'))
      .filter(function (control) {
        if (
          typeof control.closest === 'function' &&
          control.closest('[wf-xano-item], [wf-xano-element="template"]')
        ) {
          return false
        }
        const label = control.querySelector('.button_main-text')
        return clean(label && label.textContent).toLowerCase() === 'show more'
      })
  }

  function ensureProjectLoadMore(instance) {
    if (!instance || !instance.root) return []
    const existing = findProjectLoadMore(instance.root)
    if (existing.length) return existing

    const root = instance.root
    const doc = root.ownerDocument || global.document
    if (!doc || typeof doc.querySelectorAll !== 'function') return []
    const template = Array.prototype.slice
      .call(doc.querySelectorAll('.button_main-wrap'))
      .find(function (control) {
        if (control === root || (typeof root.contains === 'function' && root.contains(control))) {
          return false
        }
        const label = control.querySelector && control.querySelector('.button_main-text')
        return clean(label && label.textContent).toLowerCase() === 'show more'
      })
    if (!template || typeof template.cloneNode !== 'function') return []

    const control = template.cloneNode(true)
    const key = root.getAttribute('wf-xano-instance')
    control.removeAttribute('bookings-load-more')
    control.removeAttribute('hidden')
    control.setAttribute('data-dashboard-project-load-more', '')
    control.setAttribute('wf-xano-element', 'load-more')
    if (key) control.setAttribute('wf-xano-instance', key)
    if (control.style) control.style.display = 'none'
    root.appendChild(control)
    return [control]
  }

  function configureProjectWrappers() {
    if (!global.document || typeof global.document.querySelectorAll !== 'function') return
    PROJECT_INSTANCE_KEYS.forEach(function (key) {
      global.document
        .querySelectorAll('[wf-xano-instance="' + key + '"][wf-xano-source]')
        .forEach(function (root) {
          root.setAttribute('wf-xano-load', 'more')
          root.setAttribute('wf-xano-per-page', String(PROJECT_PAGE_SIZE))
        })
    })
  }

  function configureProjectInstance(instance) {
    if (!instance) return false
    const state = typeof instance.getState === 'function' ? instance.getState() : null
    const configuredPerPage = Number(
      state && state.query && state.query.perPage != null
        ? state.query.perPage
        : instance.perPage,
    )
    const needsReset = Number.isFinite(configuredPerPage) && configuredPerPage !== PROJECT_PAGE_SIZE
    instance.loadMode = 'more'
    instance.appendMode = true
    instance.perPage = PROJECT_PAGE_SIZE
    if (instance.root) {
      instance.root.setAttribute('wf-xano-load', 'more')
      instance.root.setAttribute('wf-xano-per-page', String(PROJECT_PAGE_SIZE))
    }
    return needsReset
  }

  function wireProjectLoadMore(instance) {
    if (!instance || !instance.root) return
    const needsReset = configureProjectInstance(instance)
    if (needsReset && typeof instance.goToPage === 'function') instance.goToPage(1)
    const controls = ensureProjectLoadMore(instance)
    if (!controls.length) return

    controls.forEach(function (control) {
      const nativeControl = control.getAttribute('wf-xano-element') === 'load-more'
      const generatedControl = control.hasAttribute &&
        control.hasAttribute('data-dashboard-project-load-more')
      if ((!nativeControl || generatedControl) && !control.__startersProjectLoadMoreBound) {
        control.__startersProjectLoadMoreBound = true
        control.addEventListener('click', function (event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (control.getAttribute('aria-disabled') === 'true') return
          if (typeof instance.loadNext === 'function') instance.loadNext()
        })
      }

      const repaint = function (state) {
        const data = (state && state.data) || {}
        const busy = Boolean(state && state.status === 'loading')
        const available = Boolean(data.hasMore) && !busy
        show(control, Boolean(data.hasMore) || busy)
        control.setAttribute('aria-hidden', data.hasMore || busy ? 'false' : 'true')
        control.setAttribute('aria-disabled', available ? 'false' : 'true')
        control.setAttribute('aria-busy', busy ? 'true' : 'false')
        control.setAttribute('data-opp-loading', busy ? 'true' : 'false')
        if (control.classList) control.classList.toggle('is-disabled', !available)
      }

      if (typeof instance.subscribe === 'function') instance.subscribe(repaint)
      else repaint(null)
    })
  }

  function hideProjectControls() {
    PROJECT_INSTANCE_KEYS.forEach(function (key) {
      document
        .querySelectorAll('[wf-xano-instance="' + key + '"]')
        .forEach(function (root) {
          const selector = '.tabs-button_component.is-dashboard'
          const filters =
            typeof root.matches === 'function' && root.matches(selector)
              ? root
              : root.querySelector(selector)
          show(filters, false)
          findProjectLoadMore(root).forEach(function (control) {
            show(control, false)
          })
        })
    })
  }

  function wireProjectFilters() {
    configureProjectWrappers()
    hideProjectControls()
    const queued = global.WfXano || []
    global.WfXano = queued
    if (!queued || typeof queued.push !== 'function') return
    queued.push(function (wfx) {
      PROJECT_INSTANCE_KEYS.forEach(function (key) {
        const instance = wfx && typeof wfx.get === 'function' ? wfx.get(key) : null
        if (!instance || typeof instance.subscribe !== 'function') return
        wireProjectLoadMore(instance)
        const selector = '.tabs-button_component.is-dashboard'
        const filters =
          typeof instance.qa === 'function'
            ? instance.qa(selector)
            : [instance.root && instance.root.querySelector(selector)].filter(Boolean)
        if (!filters.length) return
        const memory = {
          known: false,
          hasAny: false,
          navigationVisible: false,
          authTransition: false,
        }
        const reveal = function (visible) {
          filters.forEach(function (filter) {
            show(filter, visible)
          })
        }
        reveal(false)
        if (typeof instance.on === 'function') {
          instance.on('stateChange', function (change) {
            if (!change || change.reason !== 'auth:change') return
            memory.known = false
            memory.hasAny = false
            memory.navigationVisible = false
            memory.authTransition = true
            reveal(false)
          })
        }
        instance.subscribe(
          function (state) {
            return state
          },
          function (state) {
            reveal(projectFilterVisible(state, memory))
          },
        )
      })
    })
  }

  function heroElement(name) {
    return document.querySelector('[hero-element="' + name + '"]')
  }

  function bindBrandHero(member) {
    if (roleForPath(global.location && global.location.pathname) !== 'brand') return
    const fields = member.customFields || {}
    const firstName = heroElement('brand-first-name')
    if (firstName) firstName.textContent = clean(fields['free-user']) || 'Brand'
    const lastName = heroElement('brand-last-name')
    if (lastName) lastName.textContent = clean(fields['last-name'])
    const company = heroElement('brand-company')
    if (company) company.textContent = clean(fields.company)
  }

  function clearBrandHero(role) {
    if (role !== 'brand') return
    const firstName = heroElement('brand-first-name')
    if (firstName) firstName.textContent = ''
    const lastName = heroElement('brand-last-name')
    if (lastName) lastName.textContent = ''
    const company = heroElement('brand-company')
    if (company) company.textContent = ''
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      global.setTimeout(resolve, ms)
    })
  }

  async function repaintBrandHeroWhenSaved(memberstack, values, isCurrent) {
    for (const delayMs of PROFILE_REFRESH_DELAYS_MS) {
      if (delayMs) await wait(delayMs)
      if (!isCurrent()) return false
      try {
        const current = await memberstack.getCurrentMember()
        const member = current && (current.data || current)
        if (!isCurrent()) return false
        if (memberMatchesProfile(member, values)) {
          bindBrandHero(member)
          return true
        }
      } catch (_error) {
        // The native Memberstack form owns its success/error UI. A temporary
        // readback failure leaves the current hero intact and retries quietly.
      }
    }
    return false
  }

  function wireBrandProfileRepaint(memberstack, currentSessionGeneration) {
    if (roleForPath(global.location && global.location.pathname) !== 'brand') {
      return
    }
    document.querySelectorAll(PROFILE_FORM_SELECTOR).forEach(function (form) {
      if (form.__startersBrandProfileRepaintBound) return
      form.__startersBrandProfileRepaintBound = true
      let submissionGeneration = 0
      form.addEventListener('submit', function () {
        const expected = profileValues(form)
        if (!expected.firstName || !expected.lastName || !expected.company) {
          return
        }
        submissionGeneration += 1
        const generation = submissionGeneration
        const sessionGeneration = currentSessionGeneration()
        repaintBrandHeroWhenSaved(memberstack, expected, function () {
          return (
            generation === submissionGeneration &&
            sessionGeneration === currentSessionGeneration()
          )
        })
      })
    })
  }

  const bookingClockRequests = new WeakMap()
  function bindBookingClocks(rows) {
    const actions = global.StartersDashboardCallActions
    if (!actions || typeof actions.bindCanonicalClock !== 'function') return
    const groups = new Map()
    rows.forEach(function (row) {
      const request = bookingClockRequests.get(row)
      if (!request) { actions.bindCanonicalClock([row], null); return }
      if (!groups.has(request)) groups.set(request, [])
      groups.get(request).push(row)
    })
    groups.forEach(function (group, request) {
      actions.bindCanonicalClock(group, request.started, request.wallStarted)
    })
  }

  async function fetchBookings(memberId) {
    if (typeof global.xanoAuthFetch !== 'function') {
      throw new Error('Scheduling authentication bridge unavailable')
    }
    let requestStarted = null
    try { requestStarted = global.performance && global.performance.now() } catch (_error) {}
    const clockRequest = {started: requestStarted, wallStarted: Date.now()}
    const controller = typeof global.AbortController === 'function'
      ? new global.AbortController()
      : null
    let timer
    // A cancellable timer pair lets a successful read retire its deadline.
    const canTimeRead = typeof global.setTimeout === 'function' &&
      typeof global.clearTimeout === 'function'
    const deadline = canTimeRead
      ? new Promise(function (_resolve, reject) {
          timer = global.setTimeout(function () {
            if (controller) {
              try { controller.abort() } catch (_error) {}
            }
            reject(new Error('Canonical bookings request timed out'))
          }, CANONICAL_READ_TIMEOUT_MS)
        })
      : null
    let response
    let body
    try {
      const request = global.xanoAuthFetch(
        XANO_SCHEDULING_BASE + BOOKINGS_PATH,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberstack_id: memberId }),
          ...(controller ? { signal: controller.signal } : {}),
        },
      )
      response = deadline ? await Promise.race([request, deadline]) : await request
      const readBody = Promise.resolve().then(function () { return response.json() }).catch(function () {
        return null
      })
      body = deadline ? await Promise.race([readBody, deadline]) : await readBody
    } finally {
      if (canTimeRead) global.clearTimeout(timer)
    }
    if (!response.ok || !Array.isArray(body)) {
      throw new Error('Canonical bookings request failed')
    }
    const rows = body.map(normalizeBooking)
    const stamp = rows[0] && rows[0].server_now_ms
    if (rows.every(function (row) { return row.server_now_ms === stamp })) {
      rows.forEach(function (row) { bookingClockRequests.set(row, clockRequest) })
      bindBookingClocks(rows)
    }
    return rows
  }

  function wireBookingActions(refs, role, restart, acquireBookingAction, mutations) {
    if (role !== 'starter' || !global.document || !global.document.addEventListener) return
    // F53: the confirmed status goes through the session's mutation owner, as
    // the other call actions do. The commit invalidates an in-flight background
    // read, so a stale pending row cannot come back.
    const owner = mutations || {}
    const captureConfirmation = typeof owner.captureBookingMutation === 'function'
      ? owner.captureBookingMutation
      : function () { return null }
    const commitConfirmation = typeof owner.commitBookingMutation === 'function'
      ? owner.commitBookingMutation
      : function (model, changes) {
          return commitBookingMutation(refs, model, changes)
        }
    const releaseConfirmation = async function (claim) {
      if (!claim || typeof owner.releaseBookingMutation !== 'function') return
      const reconcile = owner.releaseBookingMutation(claim)
      if (reconcile && typeof owner.reconcileBookingMutations === 'function') {
        await owner.reconcileBookingMutations()
      }
    }
    global.document.addEventListener('click', async function (event) {
      const target = event && event.target
      const button = target && target.closest
        ? target.closest('[booking-action-btn="switch-confirm"], [booking-card-action-btn="switch-confirm"]')
        : null
      if (!button || button.__startersBookingActionBusy) return
      if (event.preventDefault) event.preventDefault()
      if (event.stopImmediatePropagation) event.stopImmediatePropagation()
      else if (event.stopPropagation) event.stopPropagation()

      const card = button.closest('[data-booking-id]')
      const bookingId = clean(card && card.getAttribute('data-booking-id'))
      let booking = null
      refs.some(function (section) {
        booking = section.rows.find(function (row) {
          return clean(row.booking_id) === bookingId
        }) || null
        return Boolean(booking)
      })
      if (!booking || !canConfirmBooking(role, booking)) return

      button.__startersBookingActionBusy = true
      button.setAttribute('aria-busy', 'true')
      button.setAttribute('aria-disabled', 'true')
      // P5: the confirm can take a minute, and aria-busy alone was invisible,
      // so the Starter read it as "unable to accept". The actions module owns
      // the visible busy label and the F21 action-error alert; the alert sits
      // in the open details panel, or on the card for a card-level Accept.
      const actionsModule = global.StartersDashboardCallActions
      const actionsReady = validDashboardModule(actionsModule)
      const releaseBusy = actionsReady && typeof actionsModule.markActionBusy === 'function'
        ? actionsModule.markActionBusy(button, 'Confirming…')
        : null
      const errorHost = (button.closest && button.closest(DETAIL_MODAL_SELECTOR)) || card
      const showError = function (message) {
        if (actionsReady && typeof actionsModule.showActionError === 'function') {
          actionsModule.showActionError(errorHost, message)
        }
      }
      showError('')
      // Only a server answer's own message or error text reaches the alert.
      // The fallback and client-side errors show plain copy instead of
      // internal wording; the technical text stays in the console.
      let serverMessage = ''
      let confirmed = false
      let releaseAction = null
      let claim = null
      try {
        if (typeof acquireBookingAction === 'function') {
          releaseAction = await acquireBookingAction(booking, CONFIRM_FAILURE_COPY)
          if (!releaseAction) return
          booking = bookingById(refs, bookingId)
          if (!booking || !canConfirmBooking(role, booking)) return
        }
        claim = captureConfirmation(booking)
        if (!button.__startersBookingActionKey) {
          button.__startersBookingActionKey = await storedConfirmAttemptKey(booking) || await createConfirmAttemptKey(booking)
        }
        const payload = confirmPayload(booking, button.__startersBookingActionKey)
        if (!canConfirmBooking(role, booking)) return
        if (!payload || typeof global.xanoAuthFetch !== 'function') {
          throw new Error('Canonical booking confirmation failed')
        }
        const response = await global.xanoAuthFetch(XANO_SCHEDULING_BASE + CONFIRM_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await response.json().catch(function () { return null })
        if (!response.ok || !confirmSucceeded(body)) {
          // Prefer the server's own message, as the other call actions do.
          serverMessage = clean(body && (body.message || body.error))
          throw new Error(serverMessage || 'Canonical booking confirmation failed')
        }
        confirmed = true
        // F53: the open details modal kept "Pending" with Confirm and Decline
        // on screen until the list read returned, or until a later tick when
        // that read failed. Commit the confirmed status to the canonical row,
        // then repaint the dialog from it at once. The repaint keeps its
        // guards: it leaves a dialog that shows another step alone, and it
        // paints the call the dialog shows. A refused commit (the row changed
        // or left the list) changes nothing, and the read below repaints.
        const confirmedStatus = confirmationStatus(body)
        const committed = commitConfirmation(booking, {
          status: confirmedStatus,
        }, claim)
        if (committed) {
          const committedRow = bookingById(refs, bookingId)
          if (committedRow) repaintBookingCards(refs, committedRow, role)
          refreshOpenDetailPanel(refs, role)
          refreshDetailExpiration(refs, role)
        }
        await clearConfirmAttemptKey(booking, button.__startersBookingActionKey)
        button.__startersBookingActionKey = ''
        await restart()
        // The read repainted the dialog's status and meeting link; re-check
        // its pending copy and actions against the refreshed row now, not on
        // the next tick.
        refreshDetailExpiration(refs, role)
      } catch (error) {
        console.error('[dashboard-calls] confirmation failed closed:', error && error.message)
        // A failure after the server confirmed (key cleanup or the list
        // refresh) must not tell the Starter the call was not confirmed.
        if (!confirmed) showError(serverMessage || CONFIRM_FAILURE_COPY)
      } finally {
        try {
          await releaseConfirmation(claim)
        } catch (error) {
          console.error('[dashboard-calls] confirmation reconciliation failed:', error && error.message)
        }
        if (releaseAction) {
          try { await releaseAction() } catch (error) {
            console.error('[dashboard-calls] confirmation readback failed:', error && error.message)
          }
        }
        button.__startersBookingActionBusy = false
        if (releaseBusy) releaseBusy()
        button.setAttribute('aria-busy', 'false')
        button.setAttribute('aria-disabled', 'false')
      }
    }, true)
  }

  /**
   * Navigates authored Message controls (card or modal) to the Messages
   * thread with the booking's counterpart. The buttons are Designer-owned;
   * this delegate only resolves the booking under the click and routes.
   */
  function wireBookingMessages(refs, role) {
    if (!global.document || !global.document.addEventListener) return
    global.document.addEventListener('click', function (event) {
      const target = event && event.target
      const button = target && target.closest
        ? target.closest('[booking-action-btn="message"], [booking-card-action-btn="message"]')
        : null
      if (!button) return
      const booking = bookingForActionTarget(refs, button)
      const href = bookingMessageHref(role, booking)
      if (!href) return
      // Nothing to route to without a navigable host: leave the authored
      // control's own behaviour intact rather than swallowing the click.
      if (!global.location || typeof global.location.assign !== 'function') return
      if (event.preventDefault) event.preventDefault()
      if (event.stopImmediatePropagation) event.stopImmediatePropagation()
      else if (event.stopPropagation) event.stopPropagation()
      global.location.assign(href)
    }, true)
  }

  function resetIdentityState(refs, role, mutationState) {
    resetBookingMutationState(mutationState)
    clearBrandHero(role)
    resetDetailModal()
    refs.forEach(function (section) {
      section.rows = []
      section.rendered = 0
      section.list.innerHTML = ''
      show(section.list, false)
      show(section.empty, false)
      show(section.loadMore, false)
      show(section.filters, false)
      show(section.loader, true)
      if (section.count) section.count.textContent = '0'
      section.section.setAttribute('data-bookings-state', 'loading')
    })
    document.documentElement.setAttribute('data-dashboard-calls-v3', 'loading')
  }

  /**
   * F68: the failure display writes its copy into the authored empty-state
   * heading and paragraph. Keep the authored text before the first overwrite,
   * so a later successful read with no rows shows the authored copy again.
   */
  function rememberAuthoredEmptyCopy(refs) {
    if (!refs || !refs.empty || refs.authoredEmptyCopy) return
    if (typeof refs.empty.querySelector !== 'function') return
    refs.authoredEmptyCopy = EMPTY_COPY_SELECTORS.map(function (selector) {
      const node = refs.empty.querySelector(selector)
      return node ? { node, text: node.textContent } : null
    }).filter(Boolean)
  }

  function restoreAuthoredEmptyCopy(refs) {
    const saved = refs && refs.authoredEmptyCopy
    if (!saved) return
    saved.forEach(function (entry) {
      entry.node.textContent = entry.text
    })
    refs.authoredEmptyCopy = null
  }

  function renderFailure(refs) {
    show(refs.loader, false)
    show(refs.list, false)
    show(refs.loadMore, false)
    show(refs.filters, false)
    show(refs.empty, true)
    rememberAuthoredEmptyCopy(refs)
    text(
      refs.empty,
      'h1,h2,h3,h4,h5,h6',
      refs.name === 'requests'
        ? 'Call requests are unavailable right now.'
        : 'Calls are unavailable right now.',
    )
    text(refs.empty, 'p', 'Refresh the page to try again.')
    refs.section.setAttribute('data-bookings-state', 'error')
  }

  async function refreshSession(
    memberstack,
    refs,
    role,
    generation,
    currentGeneration,
    useSharedMember,
    options,
  ) {
    const preserveExisting = Boolean(options && options.preserveExisting)
    // F68: a first-read retry paints the Brand hero only after its read
    // succeeds, so a failing retry does not flash the name on and off.
    const heroAfterRead = Boolean(options && options.heroAfterRead)
    const mutationState = options && options.mutationState
    const mutationSnapshot = snapshotBookingMutations(mutationState)
    try {
      let current =
        useSharedMember && global.memberReady && typeof global.memberReady.then === 'function'
          ? await global.memberReady
          : await memberstack.getCurrentMember()
      if (useSharedMember && (!current || !(current.data || current).id)) {
        current = await memberstack.getCurrentMember()
      }
      // Memberstack can briefly return an empty member while its client
      // refreshes the session. Retry before replacing a successful mutation
      // state with an auth failure. A genuinely missing session still fails
      // closed after the bounded retries.
      const retryDelays = useSharedMember
        ? INITIAL_MEMBER_RETRY_DELAYS_MS
        : MEMBER_RETRY_DELAYS_MS
      for (const delayMs of retryDelays) {
        if (current && (current.data || current).id) break
        if (generation !== currentGeneration()) return
        await new Promise(function (resolve) {
          global.setTimeout(resolve, delayMs)
        })
        if (generation !== currentGeneration()) return
        current = await memberstack.getCurrentMember()
      }
      if (generation !== currentGeneration()) return
      const member = current && (current.data || current)
      const memberId = clean(member && member.id)
      if (!memberId) {
        const missing = new Error('Authenticated member unavailable')
        missing.memberMissing = true
        throw missing
      }
      if (!heroAfterRead) bindBrandHero(member)
      const canonicalRows = (await fetchBookings(memberId)).filter(function (booking) {
        return memberOwnsBooking(booking, memberId, role)
      })
      if (generation !== currentGeneration()) return
      const rows = reconcileCanonicalBookings(
        refs,
        canonicalRows,
        mutationSnapshot,
        mutationState,
      ).filter(function (booking) {
        return memberOwnsBooking(booking, memberId, role)
      })
      refs.forEach(function (section) {
        const nextRows = sectionBookings(rows, role, section.name)
        if (preserveExisting && sameBookingRows(section.rows, nextRows)) {
          section.rows.forEach(function (row, index) {
            const next = nextRows[index]
            if (next !== row) {
              row.server_now_ms = next.server_now_ms
              bookingClockRequests.delete(row)
              const request = bookingClockRequests.get(next)
              if (request) bookingClockRequests.set(row, request)
            }
          })
          bindBookingClocks(section.rows)
          return
        }
        const previousRendered = preserveExisting ? section.rendered : 0
        section.rows = nextRows
        renderSection(section, role, true)
        while (section.rendered < previousRendered) {
          const rendered = section.rendered
          renderSection(section, role, false)
          if (section.rendered === rendered) break
        }
      })
      refreshMeetingDestinations(refs)
      refreshOpenDetailPanel(refs, role)
      if (heroAfterRead) bindBrandHero(member)
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'ready')
      if (options && typeof options.onCanonicalRows === 'function') {
        options.onCanonicalRows(rows, memberId, role)
      }
      acknowledgeBookingMutationRefresh(mutationState, mutationSnapshot)
      if (
        bookingMutationReconciliationPending(mutationState) &&
        options && typeof options.onMutationReconciliationRequired === 'function'
      ) {
        Promise.resolve()
          .then(options.onMutationReconciliationRequired)
          .catch(function (error) {
            console.error(
              '[dashboard-calls] mutation reconciliation failed:',
              error && error.message,
            )
          })
      }
      return true
    } catch (error) {
      if (generation !== currentGeneration()) return
      const memberMissing = Boolean(error && error.memberMissing)
      if (preserveExisting && !memberMissing) {
        console.error('[dashboard-calls] background refresh failed:', error && error.message)
        return false
      }
      if (preserveExisting) resetIdentityState(refs, role, mutationState)
      // A retry painted no hero. The failed first read already cleared it, and
      // a later paint came from a verified profile save, so a retry clears it
      // again only for a missing member.
      if (!heroAfterRead || memberMissing) clearBrandHero(role)
      refs.forEach(renderFailure)
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'error')
      console.error('[dashboard-calls] failed closed:', error && error.message)
      // F68: a member that stays missing is definitive. Any other failure
      // (a timed-out or failed canonical read) may be retried by the caller.
      if (!memberMissing && options && typeof options.onRetryableFailure === 'function') {
        options.onRetryableFailure()
      }
      return false
    }
  }

  async function boot() {
    const role = roleForPath(global.location && global.location.pathname)
    if (!role) return
    if (global.__startersDashboardCallsBooted) return
    global.__startersDashboardCallsBooted = true
    const deepLinkLocator = callDeepLinkLocator(global.location)
    const callsAnchorNormalized = normalizeCallsAnchor(global.location, global.history)
    let deepLinkPending = Boolean(deepLinkLocator)
    wireProjectFilters()

    const refs = Array.prototype.slice
      .call(document.querySelectorAll('[bookings-section]'))
      .map(collectSection)
      .filter(Boolean)
    if (!refs.length) return
    refs.forEach(clearAuthoredItems)
    refs.forEach(function (section) {
      wireSection(section, role)
    })
    wireBookingDetails(refs, role)
    wireBookingMessages(refs, role)
    hideAuthoredDuplicates()
    if (callsAnchorNormalized && typeof document.getElementById === 'function') {
      const callsAnchor = document.getElementById('calls-section')
      if (callsAnchor && typeof callsAnchor.scrollIntoView === 'function') {
        callsAnchor.scrollIntoView()
      }
    }
    const mutationState = createBookingMutationState()
    resetIdentityState(refs, role, mutationState)

    const memberstack = await waitForMemberstack(MEMBERSTACK_TIMEOUT_MS)
    if (!memberstack) {
      refs.forEach(renderFailure)
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'error')
      console.error('[dashboard-calls] failed closed: Memberstack unavailable')
      return
    }

    let sessionGeneration = 0
    let reconcileBookingMutations = null
    const currentGeneration = function () {
      return sessionGeneration
    }
    const requestMutationReconciliation = function () {
      return typeof reconcileBookingMutations === 'function'
        ? reconcileBookingMutations()
        : Promise.resolve(true)
    }
    wireBrandProfileRepaint(memberstack, currentGeneration)
    let initialReadinessPending = true
    const refreshCurrentSession = createSerializedRefresh(function (
      generation,
      useSharedMember,
      refreshOptions,
    ) {
      if (generation !== currentGeneration()) return
      return refreshSession(
        memberstack,
        refs,
        role,
        generation,
        currentGeneration,
        useSharedMember,
        refreshOptions,
      )
    })
    const restart = function (options) {
      sessionGeneration += 1
      const generation = sessionGeneration
      const useSharedMember = initialReadinessPending
      const preserveExisting = Boolean(options && options.preserveExisting)
      if (!preserveExisting) resetIdentityState(refs, role, mutationState)
      const onCanonicalRows = deepLinkPending
        ? function (rows, memberId) {
            focusCanonicalDeepLinkWhenReady(
              deepLinkLocator,
              rows,
              memberId,
              role,
              Date.now(),
              generation,
              currentGeneration,
            )
              .then(function (result) {
                if (result && result.reason !== 'session_changed') {
                  deepLinkPending = false
                }
              })
              .catch(function (error) {
                console.error('[dashboard-calls] deep link focus failed:', error && error.message)
              })
          }
        : null
      return readSession(
        generation,
        useSharedMember,
        {
          preserveExisting,
          onCanonicalRows,
          mutationState,
          onMutationReconciliationRequired: requestMutationReconciliation,
        },
        preserveExisting ? -1 : 0,
      )
    }
    // F68: a first read of a session (boot or an auth change) that fails for
    // any reason except a missing member is retried after each
    // INITIAL_READ_RETRY_DELAYS_MS delay. `attempt` counts the retries
    // already run; -1 marks a read that keeps the rendered list and gets no
    // retry. A retry reuses the session's generation and options, so it goes
    // through the same serialized refresh, keeps the deep-link focus, and
    // does not reset the sections to loading. The unavailable display stays
    // until a read succeeds.
    let parkedRetry = null
    let visibilityWired = false
    const readSession = function (generation, useSharedMember, refreshOptions, attempt) {
      let retryable = false
      const attemptOptions = Object.assign({}, refreshOptions)
      if (attempt >= 0) {
        attemptOptions.onRetryableFailure = function () {
          retryable = true
        }
      }
      if (attempt > 0) attemptOptions.heroAfterRead = true
      return refreshCurrentSession(
        generation,
        useSharedMember,
        attemptOptions,
      ).then(function (refreshed) {
        if (generation !== currentGeneration()) return refreshed
        if (refreshed === true) {
          initialReadinessPending = false
        } else if (retryable) {
          scheduleFirstReadRetry(generation, refreshOptions, attempt)
        }
        return refreshed
      })
    }
    const waitUntilVisible = function (run) {
      const doc = global.document
      if (!doc || typeof doc.addEventListener !== 'function') return false
      parkedRetry = run
      if (!visibilityWired) {
        visibilityWired = true
        doc.addEventListener('visibilitychange', function () {
          if (pageHidden() || !parkedRetry) return
          const resume = parkedRetry
          parkedRetry = null
          resume()
        })
      }
      return true
    }
    const scheduleFirstReadRetry = function (generation, refreshOptions, attempt) {
      const delayMs = INITIAL_READ_RETRY_DELAYS_MS[attempt]
      if (!(delayMs > 0) || typeof global.setTimeout !== 'function') return
      const runRetry = function () {
        // A newer session owns the page and has its own retry budget.
        if (generation !== currentGeneration()) return
        // A hidden page keeps the retry, without spending it, until the page
        // is visible again.
        if (pageHidden()) {
          if (!waitUntilVisible(runRetry)) global.setTimeout(runRetry, delayMs)
          return
        }
        // A retry reads the live member, never the boot-time shared snapshot
        // (`window.memberReady`). That snapshot can predate a profile save,
        // and a rejected snapshot can never recover. The first attempt has
        // already passed the readiness boundary, so the short member retries
        // of every later read apply.
        readSession(generation, false, refreshOptions, attempt + 1)
          .catch(function (error) {
            console.error('[dashboard-calls] first read retry failed:', error && error.message)
          })
      }
      global.setTimeout(runRetry, delayMs)
    }
    const refreshAfterMutation = function () {
      return restart({ preserveExisting: true })
    }
    const refreshExpiredRequests = function () {
      return refreshCurrentSession(sessionGeneration, false, {
        preserveExisting: true,
        mutationState,
        onMutationReconciliationRequired: requestMutationReconciliation,
      })
    }
    reconcileBookingMutations = createBookingMutationReconciler(
      refreshExpiredRequests,
      mutationState,
    )
    const acquireBookingAction = createBookingActionQueue(
      mutationState,
      requestMutationReconciliation,
    )
    const captureCurrentBooking = function (booking) {
      return captureBookingMutation(refs, booking, mutationState)
    }
    const commitCurrentBooking = function (booking, update, claim) {
      return commitBookingMutation(refs, booking, update, claim, mutationState)
    }
    const releaseCurrentBooking = function (claim) {
      return releaseBookingMutation(mutationState, claim)
    }
    const moduleOptions = {
      document: global.document,
      role,
      restart: refreshAfterMutation,
      getBooking: function (target) {
        return bookingForActionTarget(refs, target)
      },
      getBookingStatus: bookingStatus,
      openDetail: function (modal, booking) {
        return openBookingDetail(modal, booking, role)
      },
      // A proposal model must be scoped to its receipt; a direct update or
      // accepted proposal re-renders the modal with the confirmed booking.
      refreshDetail: function (modal, booking, content) {
        return populateDetailModal(modal, booking, role, undefined, content)
      },
      captureBookingMutation: captureCurrentBooking,
      commitBookingMutation: commitCurrentBooking,
      releaseBookingMutation: releaseCurrentBooking,
      reconcileBookingMutations: requestMutationReconciliation,
      acquireBookingAction,
      onCancelSuccess: function (booking, result, claim, reason) {
        return applyCancellationResult(
          refs,
          booking,
          result,
          Date.now(),
          commitCurrentBooking,
          claim,
          reason,
          role,
        )
      },
      onAvailable: function (_module, key) {
        bindBookingClocks(refs.flatMap(function (section) { return section.rows || [] }))
        refreshMeetingDestinations(refs)
        if (key === 'actions') refreshOpenDetailPanel(refs, role)
        refreshDetailExpiration(refs, role)
      },
    }
    wireDashboardCallModules(moduleOptions)
    wireBookingActions(refs, role, refreshAfterMutation, acquireBookingAction, {
      captureBookingMutation: captureCurrentBooking,
      commitBookingMutation: commitCurrentBooking,
      releaseBookingMutation: releaseCurrentBooking,
      reconcileBookingMutations: requestMutationReconciliation,
    })
    startBookingLifecycleTicker(refs, role, refreshExpiredRequests, {
      reconcileBookingMutations: requestMutationReconciliation,
    })
    if (typeof memberstack.onAuthChange === 'function') {
      memberstack.onAuthChange(function () {
        restart()
      })
    }
    await restart()
  }

  const api = {
    openBookingDetail,
    bindCard,
    bookingStatus,
    paidBooking,
    responseWindowOpen,
    responseDeadline,
    formatResponseTime,
    paintRequestExpiration,
    refreshRequestExpirations,
    refreshDetailExpiration,
    refreshMeetingDestinations,
    refreshOpenDetailPanel,
    createBookingMutationState,
    resetBookingMutationState,
    captureBookingMutation,
    releaseBookingMutation,
    bookingMutationReconciliationPending,
    createBookingMutationReconciler,
    createBookingActionQueue,
    createSerializedRefresh,
    reconcileCanonicalBookings,
    commitBookingMutation,
    applyCancellationResult,
    startBookingLifecycleTicker,
    refreshSession,
    bindBookingClocks,
    canConfirmBooking,
    statusLabel,
    statusVariantClass,
    paintStatusPill,
    paintActiveFilter,
    populateDetailModal,
    detailOpenPanel,
    detailOpenPanelForMeeting,
    wireBookingDetails,
    resetDetailModal,
    configureActionButtons,
    configureDetailActions,
    detailSupplementRows,
    detailFooter,
    ensureDetailSupplements,
    scheduleDetailSupplements,
    panelHasUsableField,
    confirmAttemptStorageKey,
    storedConfirmAttemptKey,
    createConfirmAttemptKey,
    clearConfirmAttemptKey,
    confirmSucceeded,
    confirmPayload,
    decodeBookingRef,
    memberOwnsBooking,
    memberMatchesProfile,
    normalizeBooking,
    dashboardEnvironment,
    callDeepLinkLocator,
    normalizeCallsAnchor,
    canonicalDeepLinkState,
    makeDeepLinkDetailReadOnly,
    resetDeepLinkDetailState,
    focusCanonicalDeepLink,
    focusCanonicalDeepLinkWhenReady,
    profileValues,
    adoptSectionAnchors,
    hideAuthoredDuplicates,
    configureProjectWrappers,
    findProjectLoadMore,
    ensureProjectLoadMore,
    projectFilterIsActive,
    projectFilterVisible,
    wireProjectLoadMore,
    roleForPath,
    sectionBookings,
    sameBookingRows,
    uniqueBookings,
    bookingForActionTarget,
    loadDashboardCallModules,
    loadDashboardModule,
    moduleCacheSuffix,
    validDashboardModule,
    wireDashboardCallModules,
    wireBookingActions,
    wireBookingMessages,
    bookingMessageHref,
    setMessageControlDestination,
    boot,
  }
  if (!isCommonJs) configureProjectWrappers()
  if (isCommonJs) module.exports = api
  else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})(typeof window === 'undefined' ? globalThis : window)
