/**
 * V3 dashboards — canonical call sections and Brand identity hero.
 *
 * @release v1.59.455
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
  const MEMBER_RETRY_ATTEMPTS = 2
  const REQUEST_EXPIRATION_TICK_MS = 10000
  const REQUEST_EXPIRATION_POLL_MS = 30000
  const REQUEST_EXPIRATION_MAX_POLLS = 3
  const PROFILE_REFRESH_DELAYS_MS = [0, 150, 300, 600, 1000, 1600, 2500]
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
    const confirmation = body && body.confirmation ? body.confirmation : body
    return clean(confirmation && confirmation.status).toLowerCase() === 'confirmed'
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value)
    if (!Number.isFinite(timestamp) || timestamp === 0) return timestamp
    return Math.abs(timestamp) < 1e12 ? timestamp * 1000 : timestamp
  }

  function normalizeBooking(booking) {
    return Object.assign({}, booking, {
      start: normalizeTimestamp(booking && booking.start),
      end: normalizeTimestamp(booking && booking.end),
    })
  }

  function bookingStatus(booking, now) {
    const raw = clean(booking && booking.status).toLowerCase()
    if (raw === 'archived') return 'archived'
    if (['cancelled', 'canceled', 'declined', 'expired'].includes(raw)) {
      return 'cancelled'
    }
    if (['pending', 'requested', 'request'].includes(raw)) return 'pending'
    const end = Number(booking && booking.end)
    if (Number.isFinite(end) && end > 0 && end < (now || Date.now())) {
      return 'completed'
    }
    if (['completed', 'complete', 'done'].includes(raw)) return 'completed'
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
        return JSON.stringify(booking) === JSON.stringify(next[index])
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
    element.style.display = visible ? '' : 'none'
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

  function statusLabel(status, role) {
    return {
      pending: role === 'starter' ? 'Pending' : 'Requested',
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

  function paintStatusPill(card, status, role) {
    const pill = card && card.querySelector('[booking-element="status"]')
    if (!pill) return
    STATUS_VARIANT_CLASSES.forEach(function (className) {
      setClass(pill, className, className === statusVariantClass(status))
    })
    text(pill, '[label-text]', statusLabel(status, role))
    if (!pill.querySelector('[label-text]')) pill.textContent = statusLabel(status, role)
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

  function startRequestExpirationTicker(refs, role, restart, options) {
    const settings = options || {}
    // The old inline helper remains defined, but its legacy list generator is
    // no longer invoked on the current dashboard. This controller is the one
    // active owner and uses one bounded timer for every rendered request.
    if (role !== 'starter') return null
    const setTimer = settings.setInterval || global.setInterval
    const clearTimer = settings.clearInterval || global.clearInterval
    const now = settings.now || Date.now
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') return null
    let refreshBusy = false
    let nextPollAt = 0
    const polls = new Map()
    const tick = function () {
      const currentTime = Number(now())
      const expiredKeys = refreshRequestExpirations(refs, role, currentTime)
      refreshDetailExpiration(refs, role, currentTime)
      const pollable = expiredKeys.filter(function (key) {
        return (polls.get(key) || 0) < REQUEST_EXPIRATION_MAX_POLLS
      })
      if (!pollable.length || refreshBusy || currentTime < nextPollAt) return
      refreshBusy = true
      nextPollAt = currentTime + REQUEST_EXPIRATION_POLL_MS
      pollable.forEach(function (key) {
        polls.set(key, (polls.get(key) || 0) + 1)
      })
      Promise.resolve()
        .then(restart)
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
      // Details is read-only. Accept is the first V3-native mutation. Every
      // other legacy control stays hidden until it has a populated current
      // endpoint contract and tests. In particular, never open empty
      // Reschedule UI.
      show(button, details || accept)
    })
  }

  function bindCard(card, booking, role) {
    const now = Date.now()
    const status = bookingStatus(booking, now)
    const other = role === 'starter' ? booking.brand_data : booking.starter_data
    const own = role === 'starter' ? booking.starter_data : booking.brand_data
    card.removeAttribute('bookings-item-template')
    card.setAttribute('data-booking-id', clean(booking.booking_id || booking.id))
    card.setAttribute('data-booking-status', status)
    paintStatusPill(card, status, role)
    text(card, '[booking-element="brand-name"]', other && other.name)
    text(card, '[booking-element="starter-name"]', other && other.name)
    text(card, '[booking-element="title"]', booking.call_context || 'Call')
    text(
      card,
      '[booking-element="start-date"]',
      formatDate(booking.start, (own && own.timezone) || (other && other.timezone)),
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

  function hideDuplicateDetailCopy(modal) {
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
  ]

  function detailCounterpart(role, booking) {
    return role === 'starter'
      ? booking && booking.brand_data
      : booking && booking.starter_data
  }

  function detailSupplementRows(booking, role, timezone) {
    const counterpart = detailCounterpart(role, booking)
    return [
      {
        field: role === 'starter' ? 'brand-name' : 'starter-name',
        label: role === 'starter' ? 'Brand' : 'Starter',
        value: clean(counterpart && counterpart.name),
      },
      { field: 'start-date', label: 'Date and time', value: formatDate(booking && booking.start, timezone) },
      { field: 'duration', label: 'Duration', value: formatDuration(booking && booking.duration) },
      { field: 'context', label: 'Call', value: clean(booking && booking.call_context) },
      { field: 'reschedule-reason', label: 'Reschedule reason', value: clean(booking && booking.rescheduled_reason) },
      { field: 'cancel-reason', label: 'Cancellation reason', value: clean(booking && booking.cancelled_reason) },
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

  function panelHasUsableField(panel, name) {
    if (!panel || typeof panel.querySelectorAll !== 'function') return false
    const panelRendered = renderedBoxCount(panel) > 0
    return Array.prototype.slice.call(
      panel.querySelectorAll('[booking-element="' + name + '"]'),
    ).some(function (field) {
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

  /**
   * Adds only the call information that each authored modal panel is missing.
   * Webflow's terminal and reason panels do not all contain the same booking
   * hooks, so filling every existing hook still left those views incomplete.
   * The supplement is module-owned and idempotent; Designer-owned fields stay
   * authoritative wherever they exist. Compose steps are skipped: a summary and
   * a navigating Message link below a reason form or the slot picker is noise
   * that can also discard the participant's in-progress input.
   */
  function ensureDetailSupplements(modal, booking, role, timezone) {
    if (!modal || !booking || typeof modal.querySelectorAll !== 'function') return 0
    const document = modal.ownerDocument || global.document
    if (!document || typeof document.createElement !== 'function') return 0
    const authored = Array.prototype.slice.call(
      modal.querySelectorAll('[booking-popup-content]'),
    )
    const panels = authored.filter(function (panel) {
      return (
        DETAIL_COMPOSE_PANELS.indexOf(
          panel && panel.getAttribute ? panel.getAttribute('booking-popup-content') : '',
        ) === -1
      )
    })
    if (!authored.length) panels.push(modal)
    const rows = detailSupplementRows(booking, role, timezone)
    const counterpart = detailCounterpart(role, booking)
    const counterpartId = clean(counterpart && counterpart.memberstack_id)
    let rendered = 0

    panels.forEach(function (panel) {
      if (!panel || typeof panel.querySelector !== 'function') return
      const authoritative = rows
        .filter(function (row) {
          return panelHasUsableField(panel, row.field)
        })
        .map(function (row) {
          return row.field
        })
      let supplement = panel.querySelector('[data-starters-call-summary]')
      if (!supplement) {
        supplement = document.createElement('div')
        supplement.setAttribute('data-starters-call-summary', '')
        supplement.style.display = 'flex'
        supplement.style.flexDirection = 'column'
        supplement.style.gap = '16px'
        supplement.style.width = '100%'
        supplement.style.marginTop = '12px'
        panel.appendChild(supplement)
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

      if (counterpartId) {
        const actions = document.createElement('div')
        actions.setAttribute('data-starters-call-summary-actions', '')
        actions.style.display = 'flex'
        actions.style.justifyContent = 'flex-end'
        actions.style.width = '100%'
        const message = document.createElement('a')
        message.setAttribute('data-starters-call-message', '')
        message.href = '/messages?with=' + encodeURIComponent(counterpartId)
        message.textContent = role === 'starter' ? 'Message Brand' : 'Message Starter'
        message.style.display = 'inline-flex'
        message.style.alignItems = 'center'
        message.style.justifyContent = 'center'
        message.style.minHeight = '44px'
        message.style.padding = '10px 20px'
        message.style.borderRadius = '4px'
        message.style.backgroundColor = '#1f231f'
        message.style.color = '#ffffff'
        message.style.fontWeight = '600'
        message.style.textDecoration = 'none'
        actions.appendChild(message)
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
   * reset, or rebound to another call in the meantime is left alone.
   * @param {HTMLElement|null} modal Detail modal being populated.
   * @param {object} booking Canonical row bound to the modal.
   * @param {string} role Signed-in member's role.
   * @param {string} [timezone] Display timezone.
   * @returns {boolean} Whether a recompute was scheduled.
   */
  function scheduleDetailSupplements(modal, booking, role, timezone) {
    if (!modal || !booking || typeof modal.getAttribute !== 'function') return false
    if (typeof global.requestAnimationFrame !== 'function') return false
    const bookingId = clean(modal.getAttribute('data-booking-id'))
    try {
      global.requestAnimationFrame(function () {
        if (clean(modal.getAttribute('data-booking-id')) !== bookingId) return
        ensureDetailSupplements(modal, booking, role, timezone)
      })
    } catch (_error) {
      return false
    }
    return true
  }

  /**
   * Renders or hides a muted one-line explanation under an authored action
   * button that eligibility gating hides. Without it a gated action reads as
   * a missing feature (Kaeser QA, 2026-08-29). The node is module-owned and
   * marked `data-starters-action-hint`; authored markup is never edited.
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
    const gates = {
      rescheduleAnchor: null,
      rescheduleShown: false,
      respondShown: false,
      cancelAnchor: null,
      cancelShown: false,
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
        const proposeReschedule =
          (action === 'reschedule' || action === 'reschedule-calendar') &&
          validDashboardModule(global.StartersDashboardCallActions) &&
          typeof global.StartersDashboardCallActions.canProposeReschedule === 'function' &&
          global.StartersDashboardCallActions.canProposeReschedule(role, booking, now)
        const respondReschedule =
          (action === 'confirm-reschedule' || action === 'reschedule-decline') &&
          validDashboardModule(global.StartersDashboardCallActions) &&
          typeof global.StartersDashboardCallActions.canRespondReschedule === 'function' &&
          global.StartersDashboardCallActions.canRespondReschedule(role, booking)
        const media =
          action === 'notetaker-media' &&
          validDashboardModule(global.StartersDashboardCallMedia) &&
          typeof global.StartersDashboardCallMedia.canReadMedia === 'function' &&
          global.StartersDashboardCallMedia.canReadMedia(booking, status)
        if (action === 'reschedule') {
          if (!gates.rescheduleAnchor) gates.rescheduleAnchor = button
          if (proposeReschedule) gates.rescheduleShown = true
        }
        if (action === 'confirm-reschedule' && respondReschedule) {
          gates.respondShown = true
        }
        if (action === 'switch-cancel' || action === 'cancel') {
          if (!gates.cancelAnchor) gates.cancelAnchor = button
          if (cancel) gates.cancelShown = true
        }
        show(
          button,
          action === 'switch-close' ||
            accept ||
            decline ||
            cancel ||
            proposeReschedule ||
            respondReschedule ||
            media,
        )
      })
    const start = Number(booking && booking.start)
    const reference = Number.isFinite(Number(now)) ? Number(now) : Date.now()
    const upcoming = Number.isFinite(start) && start > reference
    const active = ['pending', 'confirmed', 'rescheduled'].includes(status)
    ensureActionHint(
      modal,
      gates.rescheduleAnchor,
      'reschedule',
      'Rescheduling is available for confirmed Free calls.',
      Boolean(gates.rescheduleAnchor) &&
        active &&
        upcoming &&
        !gates.rescheduleShown &&
        !gates.respondShown,
    )
    ensureActionHint(
      modal,
      gates.cancelAnchor,
      'cancel',
      'Paid call cancellation is not available yet.',
      Boolean(gates.cancelAnchor) &&
        paidBooking(booking) &&
        ['confirmed', 'rescheduled'].includes(status) &&
        upcoming &&
        !gates.cancelShown,
    )
  }

  function resetDetailActionState(modal) {
    const actionsModule = global.StartersDashboardCallActions
    if (!validDashboardModule(actionsModule)) return
    if (typeof actionsModule.resetRescheduleState === 'function') {
      actionsModule.resetRescheduleState(modal)
    }
    if (typeof actionsModule.showActionError === 'function') {
      actionsModule.showActionError(modal, '')
    }
  }

  function populateDetailModal(modal, booking, role, now) {
    if (!modal || !booking) return false
    const nextBookingId = clean(booking.booking_id || booking.id)
    const previousBookingId = clean(modal.getAttribute('data-booking-id'))
    if (previousBookingId !== nextBookingId) resetDetailActionState(modal)
    const status = bookingStatus(booking, now)
    const isPaid = paidBooking(booking)
    const other = role === 'starter' ? booking.brand_data : booking.starter_data
    const own = role === 'starter' ? booking.starter_data : booking.brand_data
    const timezone = (own && own.timezone) || (other && other.timezone)
    const paymentText = isPaid && status !== 'cancelled' && status !== 'archived'
      ? booking.pm_confirmed
        ? 'Payment method confirmed.'
        : 'Payment method pending.'
      : ''

    modal.setAttribute('data-booking-id', nextBookingId)
    modal.setAttribute('data-booking-status', status)
    modal.setAttribute('data-booking-payment', isPaid ? 'paid' : 'free')

    const actionsModule = global.StartersDashboardCallActions
    if (
      validDashboardModule(actionsModule) &&
      typeof actionsModule.switchPopupContent === 'function'
    ) {
      actionsModule.switchPopupContent(modal, 'base')
    } else {
      modal.querySelectorAll('[booking-popup-content]').forEach(function (content) {
        show(content, content.getAttribute('booking-popup-content') === 'base')
      })
    }
    setBookingField(modal, 'paid-meeting', isPaid ? 'Paid Call' : 'Free Call', true)
    setBookingField(modal, 'status', statusLabel(status, role), true)
    setBookingField(modal, 'brand-name', booking.brand_data && booking.brand_data.name, true)
    setBookingField(modal, 'starter-name', booking.starter_data && booking.starter_data.name, true)
    setBookingField(modal, 'title', booking.call_context || 'Call', true)
    setBookingField(modal, 'context', booking.call_context, true)
    setBookingField(modal, 'start-date', formatDate(booking.start, timezone), true)
    setBookingField(modal, 'duration', formatDuration(booking.duration), true)
    setBookingPrice(modal, formatPrice(booking.price, isPaid), isPaid)
    setBookingField(modal, 'payment-status-text', paymentText, isPaid)
    setBookingField(modal, 'reschedule-reason', booking.rescheduled_reason, Boolean(booking.rescheduled_reason))
    setBookingField(modal, 'cancel-reason', booking.cancelled_reason, Boolean(booking.cancelled_reason))

    const showMeeting = status === 'confirmed' && clean(booking.meeting_link) !== ''
    bookingFields(modal, 'meeting-link').forEach(function (meetingLink) {
      if ('href' in meetingLink) meetingLink.href = showMeeting ? clean(booking.meeting_link) : ''
      meetingLink.textContent = showMeeting ? clean(booking.meeting_link) : ''
      show(meetingLink, showMeeting)
      const group = meetingLink.closest && meetingLink.closest('[booking-element-wrap]')
      if (group) show(group, showMeeting)
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
    hideDuplicateDetailCopy(modal)
    return true
  }

  function bookingFromCard(refs, card) {
    const bookingId = clean(card && card.getAttribute('data-booking-id'))
    let booking = null
    refs.some(function (section) {
      booking = section.rows.find(function (row) {
        return clean(row.booking_id || row.id) === bookingId
      }) || null
      return Boolean(booking)
    })
    return booking
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
      if ('href' in field) field.href = ''
      show(field, false)
      const group = field.closest && field.closest('[booking-element-wrap]')
      if (group) show(group, false)
    })
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
          typeof actionsModule.canProposeReschedule === 'function' &&
          actionsModule.canProposeReschedule(
            role,
            bookingForActionTarget(refs, reschedule),
            Date.now(),
          )
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

  async function fetchBookings(memberId) {
    if (typeof global.xanoAuthFetch !== 'function') {
      throw new Error('Scheduling authentication bridge unavailable')
    }
    const response = await global.xanoAuthFetch(
      XANO_SCHEDULING_BASE + BOOKINGS_PATH,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberstack_id: memberId }),
      },
    )
    const body = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !Array.isArray(body)) {
      throw new Error('Canonical bookings request failed')
    }
    return body.map(normalizeBooking)
  }

  function wireBookingActions(refs, role, restart) {
    if (role !== 'starter' || !global.document || !global.document.addEventListener) return
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
      try {
        if (!button.__startersBookingActionKey) {
          button.__startersBookingActionKey = await storedConfirmAttemptKey(booking) || await createConfirmAttemptKey(booking)
        }
        const payload = confirmPayload(booking, button.__startersBookingActionKey)
        if (
          !payload ||
          typeof global.xanoAuthFetch !== 'function' ||
          !canConfirmBooking(role, booking)
        ) return
        const response = await global.xanoAuthFetch(XANO_SCHEDULING_BASE + CONFIRM_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await response.json().catch(function () { return null })
        if (!response.ok || !confirmSucceeded(body)) throw new Error('Canonical booking confirmation failed')
        await clearConfirmAttemptKey(booking, button.__startersBookingActionKey)
        button.__startersBookingActionKey = ''
        await restart()
      } catch (error) {
        console.error('[dashboard-calls] confirmation failed closed:', error && error.message)
      } finally {
        button.__startersBookingActionBusy = false
        button.setAttribute('aria-busy', 'false')
        button.setAttribute('aria-disabled', 'false')
      }
    }, true)
  }

  function resetIdentityState(refs, role) {
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

  function renderFailure(refs) {
    show(refs.loader, false)
    show(refs.list, false)
    show(refs.loadMore, false)
    show(refs.filters, false)
    show(refs.empty, true)
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
      for (
        let attempt = 0;
        attempt < MEMBER_RETRY_ATTEMPTS && (!current || !(current.data || current).id);
        attempt += 1
      ) {
        await new Promise(function (resolve) {
          global.setTimeout(resolve, 200 * (attempt + 1))
        })
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
      bindBrandHero(member)
      const rows = (await fetchBookings(memberId)).filter(function (booking) {
        return memberOwnsBooking(booking, memberId, role)
      })
      if (generation !== currentGeneration()) return
      refs.forEach(function (section) {
        const nextRows = sectionBookings(rows, role, section.name)
        if (preserveExisting && sameBookingRows(section.rows, nextRows)) return
        const previousRendered = preserveExisting ? section.rendered : 0
        section.rows = nextRows
        renderSection(section, role, true)
        while (section.rendered < previousRendered) {
          const rendered = section.rendered
          renderSection(section, role, false)
          if (section.rendered === rendered) break
        }
      })
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'ready')
      return true
    } catch (error) {
      if (generation !== currentGeneration()) return
      const memberMissing = Boolean(error && error.memberMissing)
      if (preserveExisting && !memberMissing) {
        console.error('[dashboard-calls] background refresh failed:', error && error.message)
        return false
      }
      if (preserveExisting) resetIdentityState(refs, role)
      clearBrandHero(role)
      refs.forEach(renderFailure)
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'error')
      console.error('[dashboard-calls] failed closed:', error && error.message)
      return false
    }
  }

  async function boot() {
    const role = roleForPath(global.location && global.location.pathname)
    if (!role) return
    if (global.__startersDashboardCallsBooted) return
    global.__startersDashboardCallsBooted = true
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
    hideAuthoredDuplicates()
    resetIdentityState(refs, role)

    const memberstack = await waitForMemberstack(MEMBERSTACK_TIMEOUT_MS)
    if (!memberstack) {
      refs.forEach(renderFailure)
      document.documentElement.setAttribute('data-dashboard-calls-v3', 'error')
      console.error('[dashboard-calls] failed closed: Memberstack unavailable')
      return
    }

    let sessionGeneration = 0
    const currentGeneration = function () {
      return sessionGeneration
    }
    wireBrandProfileRepaint(memberstack, currentGeneration)
    let restartCount = 0
    const restart = function (options) {
      sessionGeneration += 1
      const useSharedMember = restartCount === 0
      restartCount += 1
      const preserveExisting = Boolean(options && options.preserveExisting)
      if (!preserveExisting) resetIdentityState(refs, role)
      return refreshSession(
        memberstack,
        refs,
        role,
        sessionGeneration,
        currentGeneration,
        useSharedMember,
        { preserveExisting },
      )
    }
    const refreshAfterMutation = function () {
      return restart({ preserveExisting: true })
    }
    const refreshExpiredRequests = function () {
      const generation = sessionGeneration
      return refreshSession(
        memberstack,
        refs,
        role,
        generation,
        currentGeneration,
        false,
        { preserveExisting: true },
      )
    }
    const moduleOptions = {
      document: global.document,
      role,
      restart: refreshAfterMutation,
      getBooking: function (target) {
        return bookingForActionTarget(refs, target)
      },
      getBookingStatus: bookingStatus,
      onAvailable: function () {
        refreshDetailExpiration(refs, role)
      },
    }
    wireDashboardCallModules(moduleOptions)
    wireBookingActions(refs, role, refreshAfterMutation)
    startRequestExpirationTicker(refs, role, refreshExpiredRequests)
    if (typeof memberstack.onAuthChange === 'function') {
      memberstack.onAuthChange(function () {
        restart()
      })
    }
    await restart()
  }

  const api = {
    bookingStatus,
    paidBooking,
    responseWindowOpen,
    responseDeadline,
    formatResponseTime,
    paintRequestExpiration,
    refreshRequestExpirations,
    refreshDetailExpiration,
    startRequestExpirationTicker,
    refreshSession,
    canConfirmBooking,
    statusLabel,
    statusVariantClass,
    paintStatusPill,
    paintActiveFilter,
    populateDetailModal,
    wireBookingDetails,
    resetDetailModal,
    configureActionButtons,
    configureDetailActions,
    detailSupplementRows,
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
