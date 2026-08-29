/**
 * V3 paid-call Brand payment client.
 *
 * @release v1.59.427
 *
 * Xano derives the Brand and payment environment from the authenticated
 * session. A selection attempt owns one bounded idempotency key: retries reuse
 * that key, while every later intentional selection creates a new attempt.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const SETUP_PATH = '/brand/payment-method/setup/v3'
  const SET_DEFAULT_PATH = '/brand/payment-method/set-default/v3'
  const READINESS_PATH = '/brand/payment-readiness/v3'
  const AVAILABILITY_PATH = '/scheduler/get_availability/v3'
  const BOOKING_PATH = '/brand/booking/request/v3'
  const STRIPE_PUBLIC_KEY_TEST =
    'pk_test_51MMhu4AW8v1kanawI48Is1kTMhsz4XbB1XVOjw5xxLiFlKXuehHSFWhApJiUKquc8bmwjtuSTlTMitYjjShjB6aQ00Dhe2oFlX'
  const STRIPE_PUBLIC_KEY_LIVE =
    'pk_live_51MMhu4AW8v1kanawUQQjQTpTWBAsdVusIXoXSA26AcTHtZPYbJt6sr98ishd7cs5DXx4QeSMHw45QqrTuzftXaJm005MjZL3sz'
  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  const PRODUCTION_MIN_BOOKING_NOTICE_MINUTES = 24 * 60
  const STAGING_MIN_BOOKING_NOTICE_MINUTES = 5
  const MAX_KEY_LENGTH = 128
  const MAX_PAYMENT_METHOD_LENGTH = 128
  const MAX_GUEST_EMAILS = 5
  const GUEST_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  // The back arrow carries a close marker too, because closing the booking
  // dialog is half of its hand-off back to the chooser. A synthesized close
  // must never land on it: that would reopen the chooser instead of finishing.
  // Today the backdrop happens to match first and this is moot, but "happens to
  // be first in the DOM" is one Designer reorder away from being wrong.
  const BOOKING_CLOSE_SELECTOR =
    '[data-modal-close]:not([data-booking-back]), ' +
    '[booking-popup-close]:not([data-booking-back]), ' +
    '[popup-booking-close]:not([data-booking-back])'
  const bookingSurfaceOwnership = getBookingSurfaceOwnership()
  const bookingSurfaceLifecycle = getBookingSurfaceLifecycle()
  const guardedGuestSubmitTargets = new WeakSet()

  function getBookingSurfaceOwnership() {
    const existing = global.StartersBookingSurfaceOwnership
    if (
      existing &&
      typeof existing.claim === 'function' &&
      typeof existing.owns === 'function'
    ) return existing
    const generations = new WeakMap()
    const ownership = {
      claim: function (container) {
        const generation = (generations.get(container) || 0) + 1
        generations.set(container, generation)
        return generation
      },
      owns: function (container, generation) {
        return generations.get(container) === generation
      },
    }
    global.StartersBookingSurfaceOwnership = ownership
    return ownership
  }

  /**
   * Does this `modal-open` / `modal-close` event belong to our booking dialog?
   *
   * The modal embed puts the dialog element on `detail.modal`, and on the
   * authored page that dialog is itself the `[popup-booking]` element. The
   * wrapper check covers a page where the marker sits on a child of the
   * dialog instead, so a Designer re-nest cannot silently stop the reset. The
   * sibling `[popup-stripe-card]` dialog deliberately does not match — its own
   * close is a different concern, and matching it here would wipe the booking
   * surface out from under an in-progress payment.
   */
  function isOwnBookingModal(popup, event) {
    const modal = event && event.detail && event.detail.modal
    if (!modal) return false
    if (modal === popup || modal === 'popup-booking') return true
    if (typeof modal.hasAttribute === 'function' && modal.hasAttribute('popup-booking')) return true
    return typeof modal.querySelector === 'function' &&
      modal.querySelector('[popup-booking]') === popup
  }

  function getBookingSurfaceLifecycle() {
    const existing = global.StartersBookingSurfaceLifecycle
    if (
      existing &&
      typeof existing.register === 'function' &&
      typeof existing.reset === 'function' &&
      typeof existing.runBooking === 'function'
    ) return existing
    const bindings = new WeakMap()
    const bookingStates = new WeakMap()
    const lifecycle = {
      /**
       * Capability mark for the mixed-generation case.
       *
       * This object is a first-installer-wins window singleton shared by the
       * Free and Paid controllers, so a page can serve one controller from
       * this generation and one from an older one. `close-complete` means the
       * surface reset is bound to the embed's close-complete event and nothing
       * else — an adopting controller must therefore add no close wiring of
       * its own. An older singleton carries no mark, still resets on the close
       * click, and is likewise adopted untouched: adding wiring to either one
       * is what would reset twice, and neither one can miss a close.
       */
      resetTiming: 'close-complete',
      register: function (popup, container, onReset) {
        let binding = bindings.get(popup)
        if (!binding) {
          // `closePending` makes the reset idempotent per close cycle: one
          // reset per close no matter how many close-complete events the embed
          // emits, re-armed whenever the dialog is opened again or a call type
          // claims the surface.
          binding = { container, resets: new Set(), closePending: true }
          bindings.set(popup, binding)
          if (typeof global.addEventListener === 'function') {
            global.addEventListener('modal-open', function (event) {
              if (isOwnBookingModal(popup, event)) binding.closePending = true
            })
            // The reset runs on close-complete, never on the close click: the
            // embed keeps the dialog on screen for its 300ms fade-out, and
            // clearing the calendar mount or switching back to the default
            // step before that fade ends repaints a dialog the visitor can
            // still see.
            global.addEventListener('modal-close', function (event) {
              if (!isOwnBookingModal(popup, event) || !binding.closePending) return
              binding.closePending = false
              lifecycle.reset(popup)
            })
          }
        }
        if (binding.container !== container) return false
        binding.resets.add(onReset)
        return true
      },
      reset: function (popup, nextType) {
        const binding = bindings.get(popup)
        if (!binding) return 0
        if (nextType) binding.closePending = true
        const generation = bookingSurfaceOwnership.claim(binding.container)
        binding.resets.forEach(function (reset) { reset(generation, nextType || '') })
        return generation
      },
      runBooking: function (container, fingerprint, createAttempt, validateResult) {
        let state = bookingStates.get(container)
        if (!state) {
          state = { active: null, attempts: new Map() }
          bookingStates.set(container, state)
        }
        let entry = state.active
        if (entry && entry.fingerprint !== fingerprint) {
          throw new Error('Another booking request is still being processed')
        }
        if (!entry) {
          entry = state.attempts.get(fingerprint)
          if (!entry) {
            entry = { attempt: createAttempt(), fingerprint, inFlight: null }
            state.attempts.set(fingerprint, entry)
          }
          state.active = entry
        }
        if (!entry.inFlight) {
          entry.inFlight = entry.attempt.run().then(function (result) {
            if (validateResult) validateResult(result)
            if (state.attempts.get(fingerprint) === entry) state.attempts.delete(fingerprint)
            return result
          }).finally(function () {
            if (state.active === entry) state.active = null
            entry.inFlight = null
          })
        }
        return entry.inFlight
      },
    }
    global.StartersBookingSurfaceLifecycle = lifecycle
    return lifecycle
  }

  function isStagingHost() {
    return String((global.location && global.location.hostname) || '')
      .trim()
      .toLowerCase() === STAGING_HOST
  }

  function minimumBookingNoticeMinutes() {
    if (isCommonJs) return PRODUCTION_MIN_BOOKING_NOTICE_MINUTES
    return isStagingHost()
      ? STAGING_MIN_BOOKING_NOTICE_MINUTES
      : PRODUCTION_MIN_BOOKING_NOTICE_MINUTES
  }

  function isValidGuestEmail(email) {
    if (!GUEST_EMAIL_PATTERN.test(email) || email.length > 254) return false
    const at = email.lastIndexOf('@')
    const local = email.slice(0, at)
    const domain = email.slice(at + 1)
    if (
      !local ||
      local.length > 64 ||
      local.startsWith('.') ||
      local.endsWith('.') ||
      local.includes('..')
    ) return false
    return domain.split('.').every(function (label) {
      return label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    })
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
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new Error('Unable to create a bounded idempotency key')
    }
    return key
  }

  function validateKey(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_KEY_LENGTH) {
      throw new Error('A bounded idempotency key is required')
    }
    return value
  }

  function validatePaymentMethodId(value) {
    if (
      typeof value !== 'string' ||
      !value.startsWith('pm_') ||
      value.length > MAX_PAYMENT_METHOD_LENGTH
    ) {
      throw new Error('A valid Stripe PaymentMethod ID is required')
    }
    return value
  }

  function normalizeGuestEmails(values, excludedEmails) {
    const excluded = new Set((excludedEmails || []).map(function (value) {
      return String(value || '').trim().toLowerCase()
    }).filter(Boolean))
    const normalized = []
    const seen = new Set()
    ;(Array.isArray(values) ? values : []).forEach(function (value) {
      const email = String(value || '').trim().toLowerCase()
      if (!email) return
      if (!isValidGuestEmail(email)) {
        throw new Error('Enter a valid guest email address')
      }
      if (excluded.has(email) || seen.has(email)) return
      if (normalized.length >= MAX_GUEST_EMAILS) {
        throw new Error('You can add up to five guest email addresses')
      }
      seen.add(email)
      normalized.push(email)
    })
    return normalized.sort()
  }

  function readGuestEmails(popup, excludedEmails) {
    if (!popup || typeof popup.querySelectorAll !== 'function') {
      throw new Error('The authored guest email form is unavailable')
    }
    const fields = Array.from(popup.querySelectorAll('[data-call-guest-email]'))
    if (fields.length !== MAX_GUEST_EMAILS) {
      throw new Error('The authored guest email form is incomplete')
    }
    const values = fields.map(function (field) {
      if (
        field &&
        String(field.value || '').trim() &&
        typeof field.checkValidity === 'function' &&
        !field.checkValidity()
      ) throw new Error('Enter a valid guest email address')
      return field && field.value
    })
    return normalizeGuestEmails(values, excludedEmails)
  }

  function bookingRequestFingerprint(input) {
    const payload = bookingPayload(input, 'fingerprint')
    delete payload.idempotency_key
    return JSON.stringify(payload)
  }

  async function authenticatedRequest(path, method, payload) {
    const url = XANO_BASE + path
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (payload !== undefined) options.body = JSON.stringify(payload)
    let response
    if (typeof global.xanoAuthFetch === 'function') {
      response = await global.xanoAuthFetch(url, options)
    } else if (typeof global.getXanoAuthToken === 'function') {
      const token = await global.getXanoAuthToken()
      if (!token) throw new Error('Xano authentication returned no token')
      options.headers.Authorization = 'Bearer ' + token
      response = await global.fetch(url, options)
    } else {
      throw new Error('The authenticated Xano bridge is unavailable')
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

  function authenticatedPost(path, payload) {
    return authenticatedRequest(path, 'POST', payload)
  }

  function getReadiness() {
    return authenticatedRequest(READINESS_PATH, 'GET')
  }

  function availabilityQuery(config, nowMs) {
    const configId = String((config && config.config_id) || '').trim()
    const grantId = String((config && config.grant_id) || '').trim()
    const duration = Number(config && config.duration)
    if (!configId || !grantId || !Number.isInteger(duration) || duration <= 0) {
      throw new Error('A valid paid-call service is required')
    }
    const start =
      Math.floor(Number(nowMs === undefined ? Date.now() : nowMs) / 1000) +
      minimumBookingNoticeMinutes() * 60
    const end = start + 14 * 24 * 60 * 60
    const query = new URLSearchParams({
      grant_id: grantId,
      configuration_id: configId,
      start_time: String(start),
      end_time: String(end),
      region: 'us',
    })
    return AVAILABILITY_PATH + '?' + query.toString()
  }

  function normalizeAvailabilitySlots(result, config, nowMs) {
    const durationMs = Number(config && config.duration) * 60 * 1000
    const minimumStartMs =
      (Math.floor(Number(nowMs === undefined ? Date.now() : nowMs) / 1000) +
        minimumBookingNoticeMinutes() * 60) * 1000
    const rows = Array.isArray(result && result.time_slots) ? result.time_slots : []
    return rows.map(function (slot) {
      const startSeconds = Number(slot && slot.start_time)
      const endSeconds = Number(slot && slot.end_time)
      const start = startSeconds * 1000
      const end = Number.isFinite(endSeconds) && endSeconds > startSeconds
        ? endSeconds * 1000
        : start + durationMs
      return { start, end }
    }).filter(function (slot) {
      return Number.isFinite(slot.start) &&
        Number.isFinite(slot.end) &&
        slot.end > slot.start &&
        slot.start >= minimumStartMs
    }).sort(function (a, b) {
      return a.start - b.start
    })
  }

  async function getPaidAvailability(config, nowMs) {
    const resolvedNowMs = Number(nowMs === undefined ? Date.now() : nowMs)
    const result = await authenticatedRequest(availabilityQuery(config, resolvedNowMs), 'GET')
    return normalizeAvailabilitySlots(result, config, resolvedNowMs)
  }

  function createSetupAttempt(idempotencyKey) {
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-payment-setup'),
    )
    return {
      idempotencyKey: key,
      run: function () {
        return authenticatedPost(SETUP_PATH, { idempotency_key: key })
      },
    }
  }

  function createDefaultSelectionAttempt(paymentMethodId, idempotencyKey) {
    const methodId = validatePaymentMethodId(paymentMethodId)
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-default-card'),
    )
    return {
      paymentMethodId: methodId,
      idempotencyKey: key,
      run: function () {
        return authenticatedPost(SET_DEFAULT_PATH, {
          payment_method_id: methodId,
          idempotency_key: key,
        })
      },
    }
  }

  function bookingPayload(input, idempotencyKey) {
    const source = input || {}
    const start = Number(source.start)
    const end = Number(source.end)
    const starterSlug = String(source.starter_slug || '').trim()
    const configId = String(source.config_id || '').trim()
    const timezone = String(source.timezone || '').trim()
    if (!starterSlug || !configId || !timezone || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      throw new Error('A valid paid-call slot is required')
    }
    const payload = {
      starter_slug: starterSlug,
      config_id: configId,
      start,
      end,
      timezone,
      idempotency_key: validateKey(idempotencyKey),
    }
    const topic = String(source.topic || '').trim()
    const context = String(source.context || '').trim()
    if (topic) payload.topic = topic
    if (context) payload.context = context
    const guestEmails = normalizeGuestEmails(source.guest_emails, [
      source.brand_email,
      source.starter_email,
    ])
    if (guestEmails.length) payload.guest_emails = guestEmails
    return payload
  }

  function createBookingAttempt(input, idempotencyKey) {
    const key = validateKey(
      idempotencyKey || createAttemptKey('brand-paid-call-booking'),
    )
    const payload = bookingPayload(input, key)
    return {
      idempotencyKey: key,
      payload,
      run: async function () {
        const result = await authenticatedPost(BOOKING_PATH, payload)
        return requireCanonicalBookingProof(result)
      },
    }
  }

  function requireCanonicalBookingProof(result) {
    const booking = result && result.booking
    const rowId = String((booking && booking.row_id) || '').trim()
    const bookingId = String((booking && booking.booking_id) || '').trim()
    if (!rowId || !bookingId) {
      throw new Error('The canonical booking response is incomplete')
    }
    return result
  }

  function loadStripe() {
    if (typeof global.Stripe === 'function') return Promise.resolve(global.Stripe)
    if (!global.document) return Promise.reject(new Error('Stripe.js is unavailable'))
    const existing = global.document.querySelector('script[src="https://js.stripe.com/v3/"]')
    if (existing) {
      return new Promise(function (resolve, reject) {
        existing.addEventListener('load', function () { resolve(global.Stripe) }, { once: true })
        existing.addEventListener('error', function () { reject(new Error('Stripe.js failed to load')) }, { once: true })
      })
    }
    return new Promise(function (resolve, reject) {
      const script = global.document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.addEventListener('load', function () { resolve(global.Stripe) }, { once: true })
      script.addEventListener('error', function () { reject(new Error('Stripe.js failed to load')) }, { once: true })
      global.document.head.appendChild(script)
    })
  }

  function switchStep(popup, target) {
    if (!popup) return
    popup.querySelectorAll('[schedule-step]').forEach(function (step) {
      step.style.display = step.getAttribute('schedule-step') === target ? 'flex' : 'none'
    })
  }

  function canonicalPaidPrice(config) {
    const cents = Number(config && config.price_cents)
    const currency = String((config && config.currency) || '').toUpperCase()
    if (!Number.isInteger(cents) || cents < 100 || currency !== 'USD') return ''
    return cents % 100 === 0
      ? '$' + String(cents / 100)
      : '$' + (cents / 100).toFixed(2)
  }

  function applyStyles(node, styles) {
    Object.keys(styles).forEach(function (name) {
      node.style[name] = styles[name]
    })
    return node
  }

  /* ---- the calendar footer's class contract ----
     The calendar mount is wiped on every lifecycle reset, so nothing authored
     can live inside it and the footer's two controls have to be built here.
     That used to mean their look was hardcoded in this file, which is why the
     confirm button never matched the site's button styling. Instead of guessing
     at the design system from JavaScript, the engine reads the class names off
     the nearest authored surface and applies them verbatim: the styling stays
     in the Designer, where it can change without a script release.

     Read order is container first, then the dialog the container sits in, so a
     page with several booking surfaces can style one of them differently
     without affecting the rest. */
  const FOOTER_CLASS_ATTRIBUTE = 'data-booking-footer-class'
  const CONFIRM_CLASS_ATTRIBUTE = 'data-booking-confirm-class'
  const BACK_CLASS_ATTRIBUTE = 'data-booking-back-class'

  function authoredClassSurfaces(container) {
    const surfaces = [container]
    if (container && typeof container.closest === 'function') {
      const root =
        container.closest('[data-modal-target="popup-booking"]') ||
        container.closest('[popup-booking]') ||
        container.closest('dialog')
      if (root && root !== container) surfaces.push(root)
    }
    return surfaces
  }

  /** The authored class names for one control, or [] when none are authored. */
  function authoredClassList(container, attribute) {
    const surfaces = authoredClassSurfaces(container)
    for (let index = 0; index < surfaces.length; index += 1) {
      const surface = surfaces[index]
      if (!surface || typeof surface.getAttribute !== 'function') continue
      const authored = String(surface.getAttribute(attribute) || '').trim()
      if (authored) return authored.split(/\s+/)
    }
    return []
  }

  /**
   * Applies authored classes and reports whether any were applied, so the
   * caller can skip its inline fallback. An authored control must carry NO
   * inline styles: a hardcoded declaration here would outrank the Designer's
   * own stylesheet and quietly win the parts of the look it names.
   */
  function applyAuthoredClasses(node, classes) {
    if (!classes.length) return false
    node.setAttribute('class', classes.join(' '))
    return true
  }

  function calendarDateKey(timestamp, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone,
    }).formatToParts(new Date(timestamp))
    const values = {}
    parts.forEach(function (part) { values[part.type] = part.value })
    return [values.year, values.month, values.day].join('-')
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

  async function mountPaidCalendar(options) {
    const settings = options || {}
    const container = settings.container
    const config = settings.config
    const onConfirm = settings.onConfirm
    const onSelectionChange = typeof settings.onSelectionChange === 'function'
      ? settings.onSelectionChange
      : function () {}
    const isCurrent = typeof settings.isCurrent === 'function'
      ? settings.isCurrent
      : function () { return true }
    if (!container || !global.document || typeof onConfirm !== 'function') {
      throw new Error('The authored paid-call calendar is unavailable')
    }
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const slots = await getPaidAvailability(config)
    if (!isCurrent()) return { slots: [], stale: true }
    container.textContent = ''
    container.setAttribute('data-paid-calendar-state', slots.length ? 'ready' : 'empty')

    const status = applyStyles(global.document.createElement('p'), {
      color: '#6f746d',
      fontSize: '13px',
      margin: '0',
    })
    status.setAttribute('data-paid-calendar-element', 'status')
    if (!slots.length) {
      status.textContent = 'No available times were found in the next 14 days.'
      container.appendChild(status)
      return { slots: [] }
    }

    const groups = {}
    const dateKeys = []
    slots.forEach(function (slot) {
      const key = calendarDateKey(slot.start, timezone)
      if (!groups[key]) {
        groups[key] = []
        dateKeys.push(key)
      }
      groups[key].push(slot)
    })
    let selectedDate = dateKeys[0]
    let selectedSlot = null
    let confirmationPending = false

    const shell = applyStyles(global.document.createElement('div'), {
      display: 'grid',
      gap: '16px',
      width: '100%',
    })
    shell.setAttribute('data-paid-calendar-element', 'shell')
    const calendarHost = global.document.createElement('div')
    calendarHost.setAttribute('data-paid-calendar-element', 'month')
    const times = applyStyles(global.document.createElement('div'), {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
      gap: '8px',
    })
    times.setAttribute('data-paid-calendar-element', 'times')
    const confirm = global.document.createElement('button')
    confirm.type = 'button'
    confirm.disabled = true
    confirm.textContent = String(settings.confirmText || 'Request paid call')
    confirm.setAttribute('data-paid-calendar-element', 'confirm')
    if (!applyAuthoredClasses(confirm, authoredClassList(container, CONFIRM_CLASS_ATTRIBUTE))) {
      applyStyles(confirm, {
        padding: '12px 16px',
        border: '1px solid #1f211d',
        borderRadius: '6px',
        background: '#1f211d',
        color: '#ffffff',
        cursor: 'pointer',
      })
    }

    /* The back control is a hand-off, not a behaviour of its own: the two modal
       attributes close this dialog and open the Free/Paid chooser, exactly as
       an authored control would, and `data-booking-back` is the marker the
       profile script keys its entry-aware visibility on. Nothing here decides
       when it is on screen — the guard stylesheet owns display and the profile
       script owns the accessible state, so this must not write either. */
    const back = global.document.createElement('button')
    back.type = 'button'
    back.textContent = String(settings.backText || '← Back')
    back.setAttribute('data-booking-back', '')
    back.setAttribute('data-modal-close', '')
    back.setAttribute('data-modal-trigger', 'popup-booking-main')
    back.setAttribute('data-paid-calendar-element', 'back')
    if (!applyAuthoredClasses(back, authoredClassList(container, BACK_CLASS_ATTRIBUTE))) {
      applyStyles(back, {
        padding: '12px 16px',
        border: '1px solid transparent',
        borderRadius: '6px',
        background: 'transparent',
        color: '#1f211d',
        cursor: 'pointer',
      })
    }

    const footer = global.document.createElement('div')
    footer.setAttribute('data-paid-calendar-element', 'footer')
    if (!applyAuthoredClasses(footer, authoredClassList(container, FOOTER_CLASS_ATTRIBUTE))) {
      applyStyles(footer, {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
      })
    }
    footer.appendChild(back)
    footer.appendChild(confirm)

    function clearSelection() {
      selectedSlot = null
      onSelectionChange(null)
      confirm.disabled = true
      status.textContent = ''
      Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (candidate) {
        candidate.setAttribute('aria-pressed', 'false')
        candidate.style.background = '#f3f4ef'
        candidate.style.color = '#1f211d'
      })
    }

    function renderTimes() {
      clearSelection()
      times.textContent = ''
      groups[selectedDate].forEach(function (slot) {
        const button = global.document.createElement('button')
        button.type = 'button'
        button.textContent = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        }).format(new Date(slot.start))
        button.setAttribute('data-paid-calendar-slot', String(slot.start))
        button.setAttribute('aria-pressed', 'false')
        applyStyles(button, {
          padding: '10px 11px',
          border: '1px solid transparent',
          borderRadius: '6px',
          background: '#f3f4ef',
          color: '#1f211d',
          cursor: 'pointer',
        })
        button.addEventListener('click', function () {
          if (confirmationPending) return
          Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (candidate) {
            candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false')
            candidate.style.background = candidate === button ? '#1f211d' : '#f3f4ef'
            candidate.style.color = candidate === button ? '#ffffff' : '#1f211d'
          })
          selectedSlot = slot
          onSelectionChange(slot)
          confirm.disabled = false
          status.textContent = ''
        })
        times.appendChild(button)
      })
    }

    const $ = global.jQuery
    if ($ && $.fn && $.fn.datepicker) {
      $(calendarHost).datepicker({
        dateFormat: 'yy-mm-dd',
        defaultDate: localDateFromKey(selectedDate),
        minDate: localDateFromKey(dateKeys[0]),
        maxDate: localDateFromKey(dateKeys[dateKeys.length - 1]),
        showOtherMonths: true,
        selectOtherMonths: false,
        beforeShowDay: function (date) {
          const available = Boolean(groups[localDateKey(date)])
          return [available, available ? 'scheduling-preview-available-date' : '', available ? 'Available' : 'Unavailable']
        },
        onSelect: function (dateText) {
          if (confirmationPending) return
          selectedDate = dateText
          renderTimes()
        },
      })
    } else {
      applyStyles(calendarHost, {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
        gap: '8px',
      })
      dateKeys.forEach(function (key) {
        const button = global.document.createElement('button')
        button.type = 'button'
        button.setAttribute('data-paid-calendar-date', key)
        button.textContent = new Intl.DateTimeFormat('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone,
        }).format(new Date(groups[key][0].start))
        button.addEventListener('click', function () {
          if (confirmationPending) return
          selectedDate = key
          renderTimes()
        })
        calendarHost.appendChild(button)
      })
    }

    confirm.addEventListener('click', async function () {
      if (!selectedSlot || confirm.disabled || confirmationPending) return
      confirmationPending = true
      confirm.disabled = true
      Array.from(calendarHost.querySelectorAll('[data-paid-calendar-date]')).forEach(function (button) {
        button.disabled = true
      })
      if ($ && $.fn && $.fn.datepicker) {
        $(calendarHost).datepicker('option', 'disabled', true)
      }
      Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (button) {
        button.disabled = true
      })
      status.textContent = 'Sending your request...'
      try {
        await onConfirm({
          start: selectedSlot.start,
          end: selectedSlot.end,
          timezone,
        })
      } catch (error) {
        console.error('[paid-call] booking failed', error)
        status.textContent = 'We could not book this call. Please try again.'
      } finally {
        confirmationPending = false
        if (isCurrent()) {
          Array.from(calendarHost.querySelectorAll('[data-paid-calendar-date]')).forEach(function (button) {
            button.disabled = false
          })
          if ($ && $.fn && $.fn.datepicker) {
            $(calendarHost).datepicker('option', 'disabled', false)
          }
          Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (button) {
            button.disabled = false
          })
          confirm.disabled = !selectedSlot
        }
      }
    })

    shell.appendChild(calendarHost)
    shell.appendChild(times)
    shell.appendChild(footer)
    shell.appendChild(status)
    container.appendChild(shell)
    renderTimes()
    return { slots, timezone, clearSelection }
  }

  function installPaidBookingController(options) {
    const settings = options || {}
    const config = settings.config
    const grantId = String(settings.grantId || (config && config.grant_id) || '').trim()
    const duration = Number(config && config.duration)
    const document = global.document
    const priceText = canonicalPaidPrice(config)
    if (!document || !config || config.is_paid !== true || !config.config_id || !grantId || duration !== 60 || !priceText) {
      return false
    }
    const availabilityConfig = Object.assign({}, config, {
      grant_id: grantId,
      duration,
    })
    const ctas = Array.from(document.querySelectorAll(
      '[call-type-item] [booking-popup-open][data-type="paid"][data-config]',
    )).filter(function (cta) {
      return cta.getAttribute('data-config') === config.config_id
    })
    const popup = document.querySelector('[popup-booking]')
    const container = popup && popup.querySelector('[nylas-container]')
    if (!ctas.length || !popup || !container) return false
    const paidCallMessage = popup.querySelector('[paid-call-text]')
    const authoredPaidCallText = paidCallMessage
      ? String(paidCallMessage.textContent || '')
      : ''
    const guestHookSelectors = [
      '[data-call-guest-fields]',
      '[data-call-guest-list]',
      '[data-call-guest-error]',
      '[data-call-guest-add]',
      '[data-call-guest-row]',
      '[data-call-guest-email]',
      '[data-call-guest-remove]',
    ]
    const guestHooks = guestHookSelectors.reduce(function (hooks, selector) {
      hooks[selector] = Array.from(popup.querySelectorAll(selector))
      return hooks
    }, {})
    const guestWrapper = guestHooks['[data-call-guest-fields]'][0] || null
    const guestList = guestWrapper && guestWrapper.querySelector('[data-call-guest-list]')
    const guestError = guestWrapper && guestWrapper.querySelector('[data-call-guest-error]')
    const guestAdd = guestWrapper && guestWrapper.querySelector('[data-call-guest-add]')
    const guestRows = guestList
      ? Array.from(guestList.querySelectorAll('[data-call-guest-row]'))
      : []
    const guestBindings = guestRows.map(function (row) {
      return {
        row,
        field: row.querySelector('[data-call-guest-email]'),
        remove: row.querySelector('[data-call-guest-remove]'),
      }
    })
    const authoredGuestFields = guestHooks['[data-call-guest-email]']
    const authoredGuestRemoves = guestHooks['[data-call-guest-remove]']
    const hasGuestMarkup = guestHookSelectors.some(function (selector) {
      return guestHooks[selector].length > 0
    })
    const hasCompleteGuestMarkup = Boolean(
      guestHooks['[data-call-guest-fields]'].length === 1 &&
      guestHooks['[data-call-guest-list]'].length === 1 &&
      guestHooks['[data-call-guest-error]'].length === 1 &&
      guestHooks['[data-call-guest-add]'].length === 1 &&
      guestHooks['[data-call-guest-row]'].length === MAX_GUEST_EMAILS &&
      authoredGuestFields.length === MAX_GUEST_EMAILS &&
      authoredGuestRemoves.length === MAX_GUEST_EMAILS &&
      guestWrapper &&
      guestList === guestHooks['[data-call-guest-list]'][0] &&
      guestError === guestHooks['[data-call-guest-error]'][0] &&
      guestAdd === guestHooks['[data-call-guest-add]'][0] &&
      guestRows.length === MAX_GUEST_EMAILS &&
      guestRows.every(function (row) { return guestHooks['[data-call-guest-row]'].includes(row) }) &&
      !guestBindings.some(function (binding) { return !binding.field || !binding.remove }) &&
      !guestBindings.some(function (binding) { return !authoredGuestFields.includes(binding.field) }) &&
      !guestBindings.some(function (binding) { return !authoredGuestRemoves.includes(binding.remove) }) &&
      !(typeof container.contains === 'function' && container.contains(guestWrapper)),
    )
    if (hasGuestMarkup && !hasCompleteGuestMarkup) {
      return false
    }
    const guestUiEnabled = hasCompleteGuestMarkup
    const bindings = ctas.map(function (cta) {
      const item = cta.closest('[call-type-item]')
      const price = item && item.querySelector('[call-type-price]')
      return { cta, item, price }
    })
    if (bindings.some(function (binding) { return !binding.item || !binding.price })) return false
    if (guestUiEnabled) installGuestFormSubmitGuard(guestWrapper)

    let cardElement = null
    let cardComplete = false
    let cardSetupInstalled = false
    let cardSetupInstallPromise = null
    const paymentAttempts = new Map()
    let paymentUiGeneration = 0
    let pendingPaidSlot = null
    let pendingPaidSlotGeneration = 0
    let pendingPaidConfirmation = 0
    let clearPaidCalendarSelection = null
    let paidClickLock = false
    const bookingLocks = new Set()
    let paidConfirmationSequence = 0
    let activePaidGeneration = 0
    let queuedPaidGeneration = 0
    let activeSurfaceType = ''

    function ownsSurface(generation) {
      return bookingSurfaceOwnership.owns(container, generation)
    }

    function clearField(selector) {
      const field = popup.querySelector(selector)
      if (field && 'value' in Object(field)) field.value = ''
    }

    function paymentNodes() {
      return {
        mount: document.querySelector('[popup-stripe-card] [card-element], [card-element]'),
        save: document.querySelector('[popup-stripe-card] [save-card-btn], [save-card-btn]'),
        error: document.querySelector('[popup-stripe-card] [card-error], [card-error]'),
        status: document.querySelector('[popup-stripe-card] [save-card-status], [save-card-status]'),
      }
    }

    /**
     * The card dialog's own dismissal controls, and only those.
     *
     * `popup-stripe-card-close` is authored on the booking dialog's backdrop as
     * well as on the card dialog's X and its backdrop, so matching that marker
     * across the whole document let a backdrop dismissal of the *booking*
     * modal cancel an in-progress card setup. Containment decides instead: the
     * scope is the card dialog, widened to the `[data-modal-target]` that owns the
     * marker so a Designer re-nest onto a child cannot silently unbind the
     * dialog's own backdrop. (`closest` returns the marker itself on the
     * authored page, where the marker is the dialog.) A page that nested the
     * card dialog inside the booking dialog would have one dialog, not two, so
     * the cross-dialog concern cannot arise from the widening.
     */
    function paymentCloseControls() {
      const marker = document.querySelector('[popup-stripe-card]')
      if (!marker) return []
      const owner = typeof marker.closest === 'function' ? marker.closest('[data-modal-target]') : null
      const scope = owner || marker
      if (typeof scope.querySelectorAll !== 'function') return []
      return Array.from(scope.querySelectorAll('[data-modal-close], [popup-stripe-card-close]'))
    }

    function installPaymentAccessibility() {
      const paymentModal = document.querySelector('[popup-stripe-card]')
      const nodes = paymentNodes()
      if (!paymentModal) return

      let label = null
      if (typeof paymentModal.querySelector === 'function') {
        label = paymentModal.querySelector('[data-payment-card-label]')
      }
      if (!label && typeof paymentModal.querySelectorAll === 'function') {
        label = Array.from(paymentModal.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div')).find(function (node) {
          const text = String(node && node.textContent || '').trim()
          return text === 'Card details' || text === 'Payment Methods'
        }) || null
      }

      if (label) {
        const labelId = label.id || 'paid-card-details-label'
        if (!label.id && typeof label.setAttribute === 'function') label.setAttribute('id', labelId)
        if (nodes.mount && typeof nodes.mount.setAttribute === 'function') {
          nodes.mount.setAttribute('aria-labelledby', labelId)
        }
        if (typeof paymentModal.setAttribute === 'function') {
          paymentModal.setAttribute('role', 'dialog')
          paymentModal.setAttribute('aria-modal', 'true')
          paymentModal.setAttribute('aria-labelledby', labelId)
        }
      }

      if (nodes.error && typeof nodes.error.setAttribute === 'function') {
        nodes.error.setAttribute('role', 'alert')
        nodes.error.setAttribute('aria-live', 'assertive')
      }
      if (nodes.status && typeof nodes.status.setAttribute === 'function') {
        nodes.status.setAttribute('role', 'status')
        nodes.status.setAttribute('aria-live', 'polite')
      }

      const staleAction = typeof paymentModal.querySelector === 'function'
        ? paymentModal.querySelector('[pm-use-this]')
        : null
      if (staleAction && staleAction.style) staleAction.style.display = 'none'
    }

    function resetPaymentUi() {
      const previousGeneration = paymentUiGeneration
      paymentUiGeneration += 1
      paymentAttempts.delete(previousGeneration)
      cardComplete = false
      const nodes = paymentNodes()
      if (nodes.error) nodes.error.textContent = ''
      if (nodes.status) nodes.status.textContent = ''
      if (nodes.save) nodes.save.disabled = false
      if (cardElement && typeof cardElement.clear === 'function') cardElement.clear()
    }

    function clearPendingPaidSelection() {
      pendingPaidSlot = null
      pendingPaidSlotGeneration = 0
      pendingPaidConfirmation = 0
      if (clearPaidCalendarSelection) clearPaidCalendarSelection()
      resetGuestUi()
      setGuestUiVisible(false)
    }

    function cancelPaymentUi() {
      resetPaymentUi()
      clearPendingPaidSelection()
    }

    function resetBookingUi(generation, nextType) {
      activePaidGeneration = generation
      activeSurfaceType = nextType || ''
      queuedPaidGeneration = 0
      paidConfirmationSequence += 1
      resetGuestUi()
      setGuestUiVisible(false)
      clearPendingPaidSelection()
      clearPaidCalendarSelection = null
      clearField('[name="topic"], [booking-topic]')
      clearField('[name="context"], [booking-context]')
      container.textContent = ''
      if (typeof container.removeAttribute === 'function') {
        container.removeAttribute('data-paid-calendar-state')
      }
      if (paidCallMessage) paidCallMessage.textContent = authoredPaidCallText
      resetPaymentUi()
      switchStep(popup, 'default')
    }

    function claimPaidSurface() {
      const generation = bookingSurfaceLifecycle.reset(popup, 'paid')
      container.textContent = 'Loading available times...'
      container.setAttribute('data-paid-calendar-state', 'loading')
      return generation
    }

    function fieldValue(selector) {
      const field = popup.querySelector(selector)
      return field ? String(field.value || '').trim() : ''
    }

    function setGuestError(message) {
      if (!guestUiEnabled) return
      guestError.textContent = String(message || '')
      guestError.style.display = message ? 'block' : 'none'
    }

    function setGuestUiVisible(visible) {
      if (!guestUiEnabled) return
      guestWrapper.style.display = visible ? 'flex' : 'none'
      guestWrapper.setAttribute('aria-hidden', visible ? 'false' : 'true')
    }

    function updateGuestControls() {
      if (!guestUiEnabled) return
      const visibleCount = guestBindings.filter(function (binding) {
        return binding.row.getAttribute('aria-hidden') !== 'true'
      }).length
      guestAdd.disabled = visibleCount >= MAX_GUEST_EMAILS
      guestAdd.style.display = guestAdd.disabled ? 'none' : ''
    }

    function resetGuestUi() {
      if (!guestUiEnabled) return
      guestBindings.forEach(function (binding, index) {
        binding.field.value = ''
        binding.field.disabled = index !== 0
        binding.row.style.display = index === 0 ? 'flex' : 'none'
        binding.row.setAttribute('aria-hidden', index === 0 ? 'false' : 'true')
        binding.remove.style.display = index === 0 ? 'none' : ''
      })
      setGuestError('')
      updateGuestControls()
    }

    function showBookingError(error) {
      console.error('[paid-call] booking failed', error)
      container.setAttribute('data-paid-calendar-state', 'error')
      container.textContent = 'We could not load the calendar. Please try again.'
      if (paidCallMessage) paidCallMessage.textContent = 'We could not book this call. Please try again.'
    }

    function showPaidSuccess() {
      popup.querySelectorAll('[success-call-buttons]').forEach(function (element) {
        element.style.display = element.getAttribute('data-type') === 'paid' ? 'flex' : 'none'
      })

      // The canonical V3 booking command has already checked the Brand's
      // payment readiness and created the call request. The old Paid success
      // buttons belonged to the retired two-phase flow. Its Confirm handler
      // expects a legacy unique ID, then hides every step when that ID is not
      // present. Keep the native button, but make it a safe Close action and
      // hide the obsolete payment-method change action.
      popup.querySelectorAll(
        '[success-call-buttons][data-type="paid"] [booking-pm-action]',
      ).forEach(function (control) {
        const action = control.getAttribute('booking-pm-action')
        if (action === 'change') {
          control.style.display = 'none'
          control.setAttribute('aria-hidden', 'true')
          return
        }
        if (action !== 'confirm') return
        control.textContent = 'Close'
        control.style.display = ''
        control.setAttribute('aria-hidden', 'false')
        control.setAttribute('data-paid-call-success-action', 'close')
        if (typeof control.removeAttribute === 'function') {
          control.removeAttribute('data-unique-id')
        }
        if (control.classList && typeof control.classList.remove === 'function') {
          control.classList.remove('disabled')
        }
        if (!control.__startersPaidSuccessCloseBound && typeof control.addEventListener === 'function') {
          control.__startersPaidSuccessCloseBound = true
          control.addEventListener('click', function (event) {
            event.preventDefault()
            event.stopImmediatePropagation()
            const close = popup.querySelector(BOOKING_CLOSE_SELECTOR)
            if (close && typeof close.click === 'function') {
              close.click()
              return
            }
            bookingSurfaceLifecycle.reset(popup)
          }, true)
        }
      })
      popup.querySelectorAll('[schedule-step="success"] [booking-element="paid-meeting"]').forEach(function (element) {
        element.textContent = 'Paid Call'
      })
      // Do not display the Designer placeholder card digits. The canonical
      // readiness contract intentionally returns no card details, so generic
      // truthful copy is safer than stale or guessed last-four digits.
      if (paidCallMessage) {
        paidCallMessage.textContent = 'Your saved payment method will be used for this call.'
        if (paidCallMessage.style) paidCallMessage.style.display = ''
        if (typeof paidCallMessage.setAttribute === 'function') {
          paidCallMessage.setAttribute('aria-hidden', 'false')
        }
      }
      const successText = popup.querySelector('[booking-success-text]')
      if (successText) {
        successText.textContent = 'Your paid call request was sent. We will notify you when the Starter confirms it.'
      }
      switchStep(popup, 'success')
    }

    async function submitBooking(slot, generation, confirmation) {
      if (
        !ownsSurface(generation) ||
        confirmation !== paidConfirmationSequence ||
        bookingLocks.has(generation)
      ) return
      let guestEmails
      try {
        guestEmails = guestUiEnabled
          ? readGuestEmails(popup, [settings.brandEmail, settings.starterEmail])
          : []
        setGuestError('')
      } catch (error) {
        setGuestError(error && error.message)
        throw error
      }
      const bookingInput = {
        starter_slug: settings.starterSlug,
        config_id: config.config_id,
        start: slot.start,
        end: slot.end,
        timezone: slot.timezone,
        topic: fieldValue('[name="topic"], [booking-topic]'),
        context: fieldValue('[name="context"], [booking-context]'),
        guest_emails: guestEmails,
        brand_email: settings.brandEmail,
        starter_email: settings.starterEmail,
      }
      const fingerprint = bookingRequestFingerprint(bookingInput)
      bookingLocks.add(generation)
      try {
        const result = await bookingSurfaceLifecycle.runBooking(
          container,
          fingerprint,
          function () { return createBookingAttempt(bookingInput) },
        )
        if (!ownsSurface(generation) || confirmation !== paidConfirmationSequence) return result
        resetGuestUi()
        setGuestUiVisible(false)
        pendingPaidSlot = null
        pendingPaidSlotGeneration = 0
        pendingPaidConfirmation = 0
        showPaidSuccess()
        return result
      } finally {
        bookingLocks.delete(generation)
      }
    }

    async function mountCalendar(generation) {
      if (!ownsSurface(generation)) return
      const mount = typeof settings.mountCalendar === 'function'
        ? settings.mountCalendar
        : mountPaidCalendar
      const result = await mount({
        container,
        config: availabilityConfig,
        onConfirm: function (slot) { return confirmPaidSlot(slot, generation) },
        onSelectionChange: function (slot) {
          if (!ownsSurface(generation)) return
          paidConfirmationSequence += 1
          if (!slot) {
            pendingPaidSlot = null
            pendingPaidSlotGeneration = 0
            pendingPaidConfirmation = 0
            resetGuestUi()
            setGuestUiVisible(false)
            return
          }
          if (!guestUiEnabled) return
          if (guestWrapper.getAttribute('aria-hidden') === 'true') resetGuestUi()
          setGuestUiVisible(true)
        },
        isCurrent: function () { return ownsSurface(generation) },
      })
      if (ownsSurface(generation)) {
        clearPaidCalendarSelection = result && typeof result.clearSelection === 'function'
          ? result.clearSelection
          : null
      }
      return ownsSurface(generation) ? result : undefined
    }

    async function installCardSetup(readiness) {
      if (cardSetupInstalled) return
      if (!cardSetupInstallPromise) cardSetupInstallPromise = (async function () {
        const nodes = paymentNodes()
        const cardMount = nodes.mount
        const save = nodes.save
        const errorText = nodes.error
        const statusText = nodes.status
        if (!cardMount || !save || !errorText || !statusText) {
          throw new Error('The authored payment form is incomplete')
        }
        const Stripe = await loadStripe()
        const stripe = Stripe(readiness.environment === 'test' ? STRIPE_PUBLIC_KEY_TEST : STRIPE_PUBLIC_KEY_LIVE)
        cardElement = stripe.elements().create('card', {
          hidePostalCode: true,
          style: {
            base: {
              color: '#1f211d',
              '::placeholder': { color: '#74786f' },
            },
            invalid: { color: '#b42318' },
          },
        })
        cardElement.mount(cardMount)
        cardElement.on('change', function (event) {
          cardComplete = Boolean(event && event.complete)
          errorText.textContent = event.error ? event.error.message : ''
        })
        save.addEventListener('click', async function (event) {
          event.preventDefault()
          event.stopImmediatePropagation()
          if (save.disabled) return
          const attemptGeneration = paymentUiGeneration
          let paymentAttempt = paymentAttempts.get(attemptGeneration)
          if (!paymentAttempt) {
            paymentAttempt = {
              defaultAttempt: null,
              defaultPaymentMethod: '',
              ready: false,
              setupAttempt: null,
            }
            paymentAttempts.set(attemptGeneration, paymentAttempt)
          }
          const paymentAlreadyReady = paymentAttempt.ready
          if (!paymentAlreadyReady && !cardComplete) {
            errorText.textContent = 'Enter complete card details.'
            statusText.textContent = ''
            return
          }
          save.disabled = true
          errorText.textContent = ''
          statusText.textContent = paymentAlreadyReady ? 'Sending...' : 'Saving...'
          try {
            if (!paymentAlreadyReady) {
              if (!paymentAttempt.setupAttempt) paymentAttempt.setupAttempt = createSetupAttempt()
              const setup = await paymentAttempt.setupAttempt.run()
              if (attemptGeneration !== paymentUiGeneration) return
              const confirmed = await stripe.confirmCardSetup(setup.client_secret, {
                payment_method: {
                  card: cardElement,
                  billing_details: {
                    name: settings.brandName || '',
                    email: settings.brandEmail || '',
                  },
                },
              })
              if (attemptGeneration !== paymentUiGeneration) return
              if (confirmed.error) throw new Error(confirmed.error.message || 'Card setup failed')
              const paymentMethod = confirmed.setupIntent && confirmed.setupIntent.payment_method
              if (!paymentAttempt.defaultAttempt || paymentAttempt.defaultPaymentMethod !== paymentMethod) {
                paymentAttempt.defaultPaymentMethod = paymentMethod
                paymentAttempt.defaultAttempt = createDefaultSelectionAttempt(paymentMethod)
              }
              await paymentAttempt.defaultAttempt.run()
              if (attemptGeneration !== paymentUiGeneration) return
              const readiness = await getReadiness()
              if (attemptGeneration !== paymentUiGeneration) return
              if (!readiness.bookable) throw new Error('The payment method is not ready')
              paymentAttempt.setupAttempt = null
              paymentAttempt.defaultAttempt = null
              paymentAttempt.defaultPaymentMethod = ''
              paymentAttempt.ready = true
              statusText.textContent = 'Card saved. Sending...'
            }
            if (attemptGeneration !== paymentUiGeneration) return
            await resumePendingPaidBooking()
            if (attemptGeneration !== paymentUiGeneration) return
            statusText.textContent = 'Card saved.'
            const close = document.querySelector('[popup-stripe-card-close]')
            if (close) close.click()
          } catch (error) {
            if (attemptGeneration !== paymentUiGeneration) return
            errorText.textContent = error.message || 'Card setup failed'
            statusText.textContent = ''
          } finally {
            if (attemptGeneration === paymentUiGeneration) save.disabled = false
          }
        }, true)
        cardSetupInstalled = true
      })()
      try {
        await cardSetupInstallPromise
      } catch (error) {
        cardSetupInstallPromise = null
        throw error
      }
    }

    async function resumePendingPaidBooking() {
      const slot = pendingPaidSlot
      const generation = pendingPaidSlotGeneration
      const confirmation = pendingPaidConfirmation
      if (!slot || !generation || !ownsSurface(generation)) return
      await submitBooking(slot, generation, confirmation)
    }

    async function confirmPaidSlot(slot, generation) {
      if (!slot || !ownsSurface(generation)) return
      const confirmation = ++paidConfirmationSequence
      pendingPaidSlot = slot
      pendingPaidSlotGeneration = generation
      pendingPaidConfirmation = confirmation
      const readiness = await getReadiness()
      if (!ownsSurface(generation) || confirmation !== paidConfirmationSequence) return
      if (readiness.bookable) {
        await submitBooking(slot, generation, confirmation)
        return
      }
      await installCardSetup(readiness)
      if (!ownsSurface(generation) || confirmation !== paidConfirmationSequence) return
      resetPaymentUi()
      const openCard = document.querySelector('[popup-stripe-card-open]')
      if (!openCard) throw new Error('The payment form opener is unavailable')
      openCard.click()
    }

    async function runPaidSelection(generation) {
      try {
        await mountCalendar(generation)
      } catch (error) {
        if (ownsSurface(generation)) showBookingError(error)
      }
    }

    async function paidClick(event) {
      event.preventDefault()
      if (paidClickLock && activeSurfaceType === 'paid' && ownsSurface(activePaidGeneration)) return
      queuedPaidGeneration = claimPaidSurface()
      if (paidClickLock) return
      paidClickLock = true
      try {
        while (queuedPaidGeneration) {
          const generation = queuedPaidGeneration
          queuedPaidGeneration = 0
          await runPaidSelection(generation)
        }
      } finally {
        paidClickLock = false
      }
    }

    Array.from(document.querySelectorAll(
      '[call-type-item] [booking-popup-open][data-type="free"][data-config]',
    )).forEach(function (cta) {
      if (typeof cta.addEventListener === 'function') {
        cta.addEventListener('click', function () {
          bookingSurfaceLifecycle.reset(popup, 'free')
        }, true)
      }
    })

    if (guestUiEnabled && !guestAdd.__startersGuestUiBound) {
      guestAdd.__startersGuestUiBound = true
      guestAdd.addEventListener('click', function (event) {
        event.preventDefault()
        const next = guestBindings.find(function (binding) {
          return binding.row.getAttribute('aria-hidden') === 'true'
        })
        if (!next) return
        next.row.style.display = 'flex'
        next.row.setAttribute('aria-hidden', 'false')
        next.field.disabled = false
        if (typeof next.field.focus === 'function') next.field.focus()
        updateGuestControls()
      })

      guestBindings.forEach(function (binding, index) {
        binding.remove.__startersGuestUiBound = true
        binding.remove.addEventListener('click', function (event) {
          event.preventDefault()
          binding.field.value = ''
          if (index !== 0) {
            binding.field.disabled = true
            binding.row.style.display = 'none'
            binding.row.setAttribute('aria-hidden', 'true')
          }
          setGuestError('')
          updateGuestControls()
        })
      })
    }

    paymentCloseControls().forEach(function (control) {
      if (typeof control.addEventListener === 'function') {
        control.addEventListener('click', cancelPaymentUi)
      }
    })

    const paymentModal = document.querySelector('[popup-stripe-card]')
    if (paymentModal && typeof paymentModal.addEventListener === 'function') {
      paymentModal.addEventListener('cancel', cancelPaymentUi)
    }

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('modal-close', function (event) {
        const modal = event && event.detail && event.detail.modal
        if (
          modal === 'popup-stripe-card' ||
          (modal && typeof modal.hasAttribute === 'function' && modal.hasAttribute('popup-stripe-card'))
        ) cancelPaymentUi()
      })
    }

    if (!bookingSurfaceLifecycle.register(popup, container, resetBookingUi)) return false
    installPaymentAccessibility()
    bookingSurfaceLifecycle.reset(popup)

    bindings.forEach(function (binding) {
      const cta = binding.cta
      cta.onclick = paidClick
      cta.setAttribute('data-paid-call-v3', 'ready')
      binding.price.textContent = priceText
      binding.item.style.display = 'block'
    })
    return true
  }

  function installGuestFormSubmitGuard(guestWrapper) {
    if (!guestWrapper || typeof guestWrapper.addEventListener !== 'function') return false

    function guard(target) {
      if (guardedGuestSubmitTargets.has(target)) return
      target.addEventListener('submit', blockNativeGuestSubmit, true)
      guardedGuestSubmitTargets.add(target)
    }

    guard(guestWrapper)
    if (typeof guestWrapper.querySelectorAll === 'function') {
      Array.from(guestWrapper.querySelectorAll('form')).forEach(function (form) {
        if (form !== guestWrapper && typeof form.addEventListener === 'function') {
          guard(form)
        }
      })
    }
    return true
  }

  function blockNativeGuestSubmit(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const api = {
    SETUP_PATH,
    SET_DEFAULT_PATH,
    READINESS_PATH,
    AVAILABILITY_PATH,
    BOOKING_PATH,
    XANO_BASE,
    authenticatedRequest,
    authenticatedPost,
    authoredClassList,
    bookingPayload,
    bookingRequestFingerprint,
    canonicalPaidPrice,
    createBookingAttempt,
    createAttemptKey,
    createDefaultSelectionAttempt,
    createSetupAttempt,
    availabilityQuery,
    getReadiness,
    getPaidAvailability,
    installGuestFormSubmitGuard,
    installPaidBookingController,
    mountPaidCalendar,
    minimumBookingNoticeMinutes,
    normalizeGuestEmails,
    normalizeAvailabilitySlots,
    readGuestEmails,
    requireCanonicalBookingProof,
    validateKey,
    validatePaymentMethodId,
  }

  if (isCommonJs) {
    module.exports = api
    return
  }
  global.StartersPaidCallBrandPayment = api
})(typeof window !== 'undefined' ? window : globalThis)
