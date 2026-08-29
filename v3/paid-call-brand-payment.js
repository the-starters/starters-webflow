/**
 * V3 paid-call Brand payment client.
 *
 * @release v1.59.446
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

     ON THE BOOKING SURFACE the two controls are now rendered as the site's own
     button component — the same wrapper/overlay/label markup the Designer
     produces — so they inherit the real design system through the global
     `[data-button-theme]` / `[data-button-style]` attribute rules and
     `.button_main-element`'s typography. Because the component supersedes them,
     `data-booking-confirm-class` and `data-booking-back-class` are IGNORED
     there. Both are harmless if left authored: nothing reads them on that
     surface, and no warning is raised.

     `data-booking-footer-class` keeps its full meaning on every surface. When it
     is authored the row's class is applied verbatim and the engine places
     nothing; when it is not, the engine's own fallback row is used. The
     injected sheet honours that split: PLACEMENT rules (`grid-area`, `order`)
     key on the role attribute and reach every footer, while everything that
     paints one — the hairline, the padding, the fill, the sticky, the
     alignment — keys on `data-paid-calendar-footer="fallback"` and cannot
     reach an authored row.

     OFF the booking surface — the dashboard's reschedule calendar mounts this
     same engine — nothing changed at all: no footer, no back control, and a
     plain single-element confirm that still reads `data-booking-confirm-class`.
     That surface has no design-system context to inherit and no guard
     stylesheet, so it keeps the look it shipped with.

     Read order is container first, then the dialog the container sits in, so a
     page with several booking surfaces can style one of them differently
     without affecting the rest. */
  const FOOTER_CLASS_ATTRIBUTE = 'data-booking-footer-class'
  const CONFIRM_CLASS_ATTRIBUTE = 'data-booking-confirm-class'

  /**
   * The booking dialog this calendar is mounted inside, or null.
   *
   * Null is a real answer, not a failure: the same engine mounts the
   * dashboard's reschedule calendar (`dashboard-call-actions.js`), which lives
   * in a different dialog entirely.
   *
   * This is deliberately the SAME selector `hire-profile.js` keys its guard
   * stylesheet rule and its `bookingDialogs()` lookup on, and nothing wider.
   * A back control rendered on a surface those two cannot reach is a control
   * nothing ever hides on a direct entry — so anything but an exact match
   * fails closed and renders no control at all. On the published page the
   * dialog carries `data-modal-target="popup-booking"` and `popup-booking`
   * together, so the narrower selector loses nothing.
   */
  const BOOKING_SURFACE_SELECTOR = '[data-modal-target="popup-booking"]'

  function bookingSurfaceFor(container) {
    if (!container || typeof container.closest !== 'function') return null
    return container.closest(BOOKING_SURFACE_SELECTOR)
  }

  /* ---- the calendar's layout, in one injected stylesheet ----
     Four things live here that inline styles cannot express: two media
     queries, a descendant override of the page's own datepicker CSS, and
     bottom spacing that has to apply to the empty-state path as well as the
     calendar. It follows the same shape as the profile script's guard rule:
     one id-guarded <style> in the head, injected once per document.

     EVERY rule is scoped under the booking dialog. That is the whole
     containment story: the dashboard's reschedule calendar mounts this same
     engine into a different dialog, and the page has other jQuery-UI
     datepickers (the contract form's start and end dates) wearing the exact
     same `.ui-datepicker` class. Scoping is what keeps both pixel-untouched.

     No `!important` anywhere. The page's datepicker rules are plain class
     selectors, so a descendant selector under the dialog attribute outranks
     them on specificity alone — verified against computed styles in the
     fixture, not assumed.

     Layout summary:
     - Below 768px: one column, and the two footer buttons stack full width
       with the primary on top. That matches the profile's own vertical CTA
       rail (Hire above Book Call above Message) and stops the longer label
       wrapping to two lines in a half-width button.
     - From 768px up: two columns. The month sets the column height on the
       left; the times, the buttons and the status line stack on the right,
       with the times taking the leftover height and scrolling inside itself
       so a day with many slots cannot grow the modal. */
  const CALENDAR_LAYOUT_STYLE_ID = 'starters-booking-calendar-layout'
  /* The interior frame Jerico tuned in the browser, and the ONLY inset between
     the modal's edges and the calendar's contents at any width — the authored
     step's own padding is zeroed above so these two do not stack. Rem, so it
     tracks the site's responsive root font size (25.85px at 1280, 19.25px at
     375).

     Which edges carry it differs by breakpoint, because the layout does. In
     two columns it goes on the edges that actually touch the panel's margins:
     the month's left, both columns' top and bottom, the times' right, and the
     footer all round. Stacked, every element repeats the horizontal frame and
     only the month opens the top — Jerico specced those values element by
     element at 400px.

     It also replaces the mount's bottom padding from an earlier round: that
     rule is gone at both widths, and the footer's own bottom padding does that
     job — including on the empty-availability path, where the footer is the
     last thing in the mount. */
  const CALENDAR_FRAME = '1.25rem'
  /* The slot chips' two states. Resting is `#eee` — the same grey as the month
     picker's fill and the footer's hairline, so the three read as one surface.
     It is written from JavaScript rather than the sheet because the chips are
     built here and their state flips on click; every place that writes the
     resting colour must use this constant, including the deselect reset, or a
     select-then-deselect leaves one chip a different grey from its neighbours. */
  const BOOKING_SLOT_RESTING_BACKGROUND = '#eee'
  const SLOT_SELECTED_BACKGROUND = '#1f211d'
  /* The rule above the buttons. There is no row gap on desktop any more: the
     footer is its own band, and a hairline plus its own padding is what
     separates it from the panel. A gap AND a rule would read as two dividers. */
  const CALENDAR_FOOTER_RULE = '1px solid #eee'
  /* ---- the status banner ----
     Jerico's round-3 tuning, and a change of kind rather than degree: the
     status stops being a line of text under the buttons and becomes a band
     across the top of the modal's body, overlaying the calendar. His capture
     is `color:white; padding:1rem; width:100%; background:#DD5555`, taken on
     the booking-failed state.

     Only that state is red. The element carries three strings and the other
     two — "no times in the next 14 days" and "Sending your request..." — are
     not failures, so they take a dark olive notification fill instead of an
     alarm colour. The engine tags each write with a tone and these rules
     colour by it.

     The neutral pair is Jerico's round-4 pick. It was `#eee` on `#1f211d`
     first, matching the picker fill and the footer hairline; at banner size
     that read as a panel rather than a notice, so both neutral messages now
     wear the same weight as the failure and differ only in hue. */
  const STATUS_ERROR_BACKGROUND = '#DD5555'
  const STATUS_ERROR_COLOR = '#fff'
  const STATUS_NEUTRAL_BACKGROUND = '#434B43'
  const STATUS_NEUTRAL_COLOR = '#fff'
  const STATUS_BANNER_PADDING = '1rem'
  const STATUS_FONT_SIZE = '0.8125rem'
  /* The gap between the timezone selector and the first row of chips. A full frame would
     read as a row of its own; this is Jerico's round-8 value, up from the
     0.5rem the placement round shipped. */
  const TIMEZONE_GAP = '1rem'
  /* ---- the timezone control's closed face ----
     A native select renders as an OS control, which is what Jerico objected
     to. `appearance:none` drops that chrome and the rest of these rebuild it
     in the modal's own language. Only the CLOSED face: the open list is drawn
     by the operating system and cannot be styled, which is the constraint he
     accepted rather than a custom dropdown being built.

     WHITE with a hairline, not the chips' `#eee` fill. The control sits
     directly above the slot chips at both widths, and a grey box on top of a
     field of grey boxes reads as the first chip — an option to pick rather
     than a control to open. White separates the two while the `#eee` border
     keeps it in the family: it is the same hairline as the footer band and the
     same grey as the picker's ring. Their original was white too; what changes
     is the off-palette `#d7d9d2` border for the modal's own `#eee`. */
  const TIMEZONE_SELECT_BACKGROUND = '#fff'
  const TIMEZONE_SELECT_BORDER = CALENDAR_FOOTER_RULE
  const TIMEZONE_SELECT_RADIUS = '0.375rem'
  const TIMEZONE_CAPTION_SIZE = '0.75rem'
  /* The chevron, drawn to match the month picker's own nav arrows: the same
     2px stroke in the same `#1e211e`. It has to be a background image rather
     than a pseudo-element — a select is a replaced element and does not render
     `::after` reliably across engines. The `#` is percent-encoded because a
     raw one would start the URL's fragment. */
  const TIMEZONE_SELECT_CHEVRON =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%231e211e' stroke-width='2'/%3E%3C/svg%3E\")"
  /* The site's own select-focus treatment, lifted from the timepicker embed
     (`.ui-timepicker-div select:focus`) rather than invented here. */
  const TIMEZONE_FOCUS_BORDER = '#20221f'
  const TIMEZONE_FOCUS_RING = '0 0 0 0.1875rem rgba(32, 34, 31, 0.1)'
  /* ---- lengths are rem, borders are px ----
     Jerico's round-5 call: every length in this sheet is a rem so it tracks the
     site's responsive root font size, the way the frame and the banner's
     padding already did.

     Borders are the one exception, and it is deliberate rather than an
     oversight. A hairline is a device-pixel affordance, not part of the type
     scale: this site's root is 12.93px at 1280, so `0.0625rem` computes to
     0.81px and renders as an inconsistent, sometimes invisible line. The same
     rule is applied to the datepicker sheet's own 1px and 2px borders, so
     "lengths in rem, borders in px" holds across both files.

     Note what a rem IS on this site before reading these as no-ops: the root
     font size is responsive — 12.93px at 1280, 16.34px at 400 — so these
     values are about 19% SMALLER than the pixels they replace on desktop and
     about 2% larger at 400. That scaling is the point of the change, but it is
     a visible change, not a unit-only one. */
  const RING = '0.1875rem'
  const CELL_INSET = '0.25rem'
  const SCROLLBAR_WIDTH = '0.1875rem'
  /* Jerico's value and Jerico's reason: "I also added min-height so the
     absolute error wouldn't be weird looking". With the banner out of flow
     there is nothing holding the panel open on the empty-availability path —
     the mount would collapse to the height of one button and the banner would
     cover it. Rem, so it tracks the site's responsive root font size (363px at
     1280, 433px at 375); the calendar state is taller than that at both
     widths, so this only ever shows on the empty path. */
  const CALENDAR_MIN_HEIGHT = '28.125rem'

  function ensureBookingCalendarLayout(document) {
    if (
      !document ||
      typeof document.getElementById !== 'function' ||
      typeof document.createElement !== 'function'
    ) return
    if (document.getElementById(CALENDAR_LAYOUT_STYLE_ID)) return
    const dialog = BOOKING_SURFACE_SELECTOR
    const role = dialog + ' [data-paid-calendar-element='
    // The engine's own footer row. An authored `data-booking-footer-class`
    // row places its own children by contract, so the stacking rules below
    // must not reach it.
    const ownRow = dialog + ' [data-paid-calendar-footer="fallback"]'
    const style = document.createElement('style')
    style.setAttribute('id', CALENDAR_LAYOUT_STYLE_ID)
    style.textContent = [
      // ---- every width ----
      /* The month picker's card, as Jerico tuned it in the browser: the 3px
         `#eee` ring and the `#eee` fill, and nothing else. Earlier rounds tried
         a flat picker and then a 1px `#d8d8d8` outline; this ring is what he
         meant by an outline all along, so both of those are gone. The original
         page styling also carried a `0 4px 8px` drop shadow — deliberately NOT
         restored, his capture has the ring alone.

         No `border` and no `padding` here on purpose. Without a `border`
         declaration the page's own `.ui-widget.ui-widget-content{border:0}`
         applies and the picker has no border, which is what he tuned against;
         and with no container padding the header band sits flush again, so the
         pull-back rule that used to compensate for it is gone too.

         `.ui-widget-content` still doubles the specificity. It is not needed
         for these two properties, but the moment anyone adds `border` back to
         this rule it becomes load-bearing again — the page sets that border to
         0 from a <style> in the BODY, which beats this head-injected sheet at
         equal specificity. */
      dialog + ' .ui-datepicker.ui-widget-content{box-shadow:0 0 0 ' + RING + ' var(--Fill-Primary, #eee);background:#eee}',
      /* The weekday header row is LEFT-aligned below the site's tablet
         breakpoint while the date cells are centred, so every label sits at
         its column's left edge and the header reads as ragged and misaligned
         against the dates. Measured at 375px: the labels drift 9.6-14.3px
         left of their own columns, unevenly, because the offset tracks each
         label's width. Verified identical on the published scripts, so this
         is a pre-existing page-CSS bug rather than anything the layout above
         introduced — it is repaired here because this is the surface Jerico
         reported it on, and repaired ONLY here so the contract form's
         datepickers keep the look they have today.
         Centring is the whole fix; the two padding rules give the first and
         last columns the same 4px inset the body cells already have. */
      /* The day chips fill their cell instead of being a fixed 2.75rem box
         centred in it. Jerico's edit, and he made it on the page's GLOBAL
         datepicker sheet — re-scoped here so the contract form's date fields
         keep the size they have today. The page's own rule is
         `.ui-datepicker td a, .ui-datepicker td span` (0,1,2) and its mobile
         override is the same selector at 2.5rem; scoping under the dialog
         attribute makes this (0,2,2), so it wins at both widths without
         `!important`. Height is left to the page. */
      dialog + ' .ui-datepicker td a,' + dialog + ' .ui-datepicker td span{width:100%}',
      /* ---- the status banner ----
         The modal's body is the containing block, so the banner lands directly
         under the "Book a Call" header bar and runs the full width of the
         panel rather than being inset by the authored step's own 2.5rem. It is
         the one element in this sheet that needs a positioned ancestor, and
         `.modal_content-layout` is it: exactly one of them sits in this dialog,
         it starts at the header's bottom edge, and it already holds the mount.

         Anchoring to `.modal_content` instead would put the band OVER the
         header, and anchoring to the mount would inset it by 32px on every
         side — neither is the full-width band under the header that Jerico's
         screenshot shows. */
      dialog + ' .modal_content-layout{position:relative}',
      /* Out of flow, so a message overlays the panel instead of adding a row
         under the buttons and growing the modal. Replaying his exact state
         proves the geometry: `position:absolute` with no offsets already
         lands at the top of the panel, because the static position of an
         absolutely-positioned grid child is the grid container's content
         origin. The offsets here only straighten what that leaves ragged —
         his band starts 32px in from the left and overhangs the right edge by
         the same amount, being 100% of a container it is not aligned to. */
      role + '"status"]{position:absolute;top:0;left:0;right:0;z-index:2;'
        + 'margin:0;padding:' + STATUS_BANNER_PADDING + ';font-size:' + STATUS_FONT_SIZE + ';'
        + 'background:' + STATUS_NEUTRAL_BACKGROUND + ';color:' + STATUS_NEUTRAL_COLOR + '}',
      // The failure, and only the failure, wears his red.
      role + '"status"][data-paid-calendar-status="error"]{background:' + STATUS_ERROR_BACKGROUND + ';color:' + STATUS_ERROR_COLOR + '}',
      /* The status line reserves space even with nothing to say, which as a
         banner means an empty red band across the calendar. Jerico set a
         blanket `display:none` inline; encoded as `:empty` instead, because the
         same element carries "No available times were found in the next 14
         days.", the sending state and every booking error — hiding it outright
         would silence all of them. Empty is exactly the case he was looking at.
         It has to outrank the base rule above, and `:empty` gives it the extra
         specificity to do that without `!important`. */
      role + '"status"]:empty{display:none}',
      /* The back control while a booking is in flight. Disabling the inner
         button is not enough on its own: the wrap carries `data-modal-close`,
         and the modal embed resolves it with `closest()` from whatever was
         clicked — so the 1px of wrap around the disabled button still closed
         the dialog with the POST open, losing the surface the confirmation was
         about to land on. The engine stamps this while it waits. */
      role + '"back"][data-paid-calendar-busy]{pointer-events:none}',
      role + '"timezone-control"]{display:grid;gap:0.375rem}',
      /* The caption above the control, at the size the static caption it
         replaced used to carry. Its colour stays the engine's `#6f746d`. */
      role + '"timezone-control"] span{font-size:' + TIMEZONE_CAPTION_SIZE + ';color:#6f746d}',
      /* The closed face. `appearance` twice because Safari still wants the
         prefixed one; `font:inherit` first so the site's face and the sheet's
         own size are not fighting the UA stylesheet's. */
      role + '"timezone"]{'
        + 'appearance:none;-webkit-appearance:none;'
        + 'font:inherit;font-size:1rem;font-weight:500;'
        + 'width:100%;cursor:pointer;'
        + 'color:' + SLOT_SELECTED_BACKGROUND + ';'
        + 'background-color:' + TIMEZONE_SELECT_BACKGROUND + ';'
        + 'background-image:' + TIMEZONE_SELECT_CHEVRON + ';'
        + 'background-repeat:no-repeat;'
        + 'background-position:right 0.75rem center;'
        + 'border:' + TIMEZONE_SELECT_BORDER + ';'
        + 'border-radius:' + TIMEZONE_SELECT_RADIUS + ';'
        + 'padding:0.625rem 2.25rem 0.625rem 0.75rem}',
      /* Focus-visible rather than focus, so a mouse click does not paint a
         ring the visitor did not ask for while a keyboard tab still does. */
      role + '"timezone"]:focus-visible{'
        + 'outline:0;border-color:' + TIMEZONE_FOCUS_BORDER + ';'
        + 'box-shadow:' + TIMEZONE_FOCUS_RING + '}',
      /* The shell's own display, which the engine used to write inline. It is
         a grid at every width by default and the mobile block swaps it for a
         flex column; see the sticky footer rule there. */
      role + '"shell"]{display:grid}',
      /* The engine's `layout`, `calendar-panel` and `time-panel` wrappers, taken
         back out of the box tree. This sheet places the month, the timezone
         caption, the times and the footer itself — in the shell's grid areas on
         desktop and its flex column on a phone — and those rules only reach them
         while they are the shell's own children. `display:contents` restores
         that without touching the DOM the engine builds, so the dashboard's
         reschedule calendar keeps the nested columns it just gained, including
         the caption grouped under the month. The engine writes no inline display
         on any of the three here, so this rule is unopposed. */
      role + '"layout"],' + role + '"calendar-panel"],' + role + '"time-panel"]{display:contents}',
      /* Jerico's inline min-height, moved to the sheet. See CALENDAR_MIN_HEIGHT
         — with the banner out of flow, the empty-availability panel has only a
         button left in it to set its height. */
      /* Only the two states that actually lay a calendar out. It used to be
         unconditional, and the `loading` and `error` states — a single line of
         text, with no shell and no footer — inherited a 450px void under one
         sentence. The free-call controller mounts into this same container and
         stamps the same states, so it inherited the void too. */
      dialog + ' [nylas-container][data-paid-calendar-state="ready"],'
        + dialog + ' [nylas-container][data-paid-calendar-state="empty"]'
        + '{min-height:' + CALENDAR_MIN_HEIGHT + '}',
      /* And the other half of that: something has to fill the height the
         min-height opens up. On the empty path the mount's only in-flow child
         is the footer, and left at the top it sits UNDER the banner. Pushed to
         the bottom it reads as the same band the calendar state ends with, and
         it cannot collide with the banner at any width or message length. */
      dialog + ' [nylas-container][data-paid-calendar-state="empty"]{display:flex;flex-direction:column;justify-content:flex-end}',
      dialog + ' .ui-datepicker thead th{text-align:center}',
      dialog + ' .ui-datepicker thead th:first-child{padding-left:' + CELL_INSET + '}',
      dialog + ' .ui-datepicker thead th:last-child{padding-right:' + CELL_INSET + '}',

      /* The authored step stops padding the calendar. `.call-details_layout` is
         the wrapper the mount sits in and the site pads it by
         `--_spacing---spacer--spacing-14` (32.3px measured at 1280, 15.4px at
         375). With the interior frame below doing that job on the elements
         themselves at every width, this was a second frame outside the first:
         the footer's hairline stopped short of both modal edges, the status
         banner could not run the panel's full width, and on a phone the two
         insets stacked.

         Specificity, not `!important` (which this sheet forbids): the site's
         two declarations are the flat `.call-details_layout` and a
         narrower-breakpoint `.call-form_layout,.call-details_layout`, both
         (0,1,0). Under the dialog attribute this is (0,2,0) and outranks both
         — verified against the computed style, not assumed. */
      /* `overflow:visible` is not cosmetic — it is what lets the stacked
         footer stick. The authored step is `overflow-y:auto`, which makes it a
         SCROLLPORT even though it never actually scrolls (measured: 1245 of
         content in a 1245 box). Sticky positions against the nearest
         scrollport, so the footer was sticking to a box that does not move and
         did nothing at all: measured at 400 on a busy day, the footer sat
         519px below the visible area at the top of the scroll and only
         appeared at the end, exactly as if it were static.

         Releasing it hands the job to `.modal_content-layout`, the modal's
         body and the only box here that really scrolls. Inert everywhere else:
         nothing overflows this wrapper at either width, on desktop because the
         times scroll inside their own cell.

         KEYED ON THE STEP THE CALENDAR MOUNTS INTO, never on the class. The
         dialog has FOUR `.call-details_layout` wrappers — the calendar step,
         the success step, the confirmed step and payment-methods — and a rule
         on the bare class stripped the authored padding from all of them,
         which is how the success step ended up flush against the modal's
         edges. The engine stamps the one ancestor it actually mounts into. */
      dialog + ' [data-paid-calendar-step]{padding:0;overflow:visible}',

      /* No row gap rule here any more. It used to be `row-gap:16px`, and by the
         time round 4 gave every stacked element its own frame padding the only
         width it still reached was mobile — desktop has overridden it to 0
         since the footer became a band. Jerico struck it out in the browser,
         and with the frame carrying the rhythm the elements do not touch:
         the month's bottom padding is what separates it from the times, and
         the times' bottom padding separates them from the buttons, one
         `1.25rem` each rather than a padding plus a gap.

         The shell writes no inline gap on this surface, so removing the rule
         leaves row-gap at its initial value. The dashboard's shell still
         writes `gap:16px` inline and has no sheet at all, so it is untouched
         either way. */

      // ---- below the site's mobile breakpoint ----
      '@media (max-width:767.98px){',
      /* The interior frame, mapped onto the single stacked column. Jerico
         specced these values as inline edits at 400px: the month framed on all
         four sides, and the times repeating the horizontal frame while opening
         their top edge, so their top spacing is the caption above rather than
         a doubled pair. The footer is framed on all four sides too, since it
         floats — its top edge is where the chips pass behind, not something
         the element above it can space.

         The desktop asymmetry does not transfer — there the month drops its
         right padding and the times their left, because the 2rem column gap
         between them is doing that job. Stacked, there is no column gap to
         hand it to.

         The footer's bottom padding here is what keeps the empty-availability
         state off the modal's bottom edge on a phone; an earlier round put
         that on the MOUNT, which now would double against this. The footer's
         own rule sits further down, with the sticky. */
      /* A FLEX column, and it really is emitted here — an earlier round wrote
         only `flex-direction` and left the base `display:grid` standing, so
         the comments and tests described a column the sheet never produced.

         The choice is deliberate rather than cosmetic. The footer below is
         sticky, and a grid item's containing block is its own grid area, which
         for a footer on the last row leaves it nothing to travel through. The
         spec is explicit about that; Chromium and WebKit are more forgiving
         and pin it anyway, which is why the grid version measured as working,
         but Gecko is unverified and the flex column is what the mechanism is
         actually supposed to rest on. A flex item's containing block is the
         whole shell — 1245px inside a 726px scrollport at 400 on a busy day.

         `order` pins the stacked sequence: month, timezone caption, chips,
         footer. The engine's own appends now read the same way — the caption
         sits above the times inside its panel — so reading order and visual
         order finally agree, and these declarations hold that arrangement
         steady rather than correcting it. */
      role + '"shell"]{display:flex;flex-direction:column}',
      role + '"month"]{order:1;padding:' + CALENDAR_FRAME + '}',
      /* The frame, which it would otherwise run full-bleed past while every
         neighbour is inset. Its top spacing is the month's bottom padding; the
         `1rem` is the gap down to the first chip, which has to come from this
         padding because the control has no margin of its own. */
      role + '"timezone-control"]{order:2;padding:0 ' + CALENDAR_FRAME + ' ' + TIMEZONE_GAP + '}',
      role + '"times"]{order:3;padding:0 ' + CALENDAR_FRAME + ' ' + CALENDAR_FRAME + '}',
      /* The floating footer. On a phone the whole panel scrolls — calendar,
         caption and chips together — inside `.modal_content-layout`, which is
         the modal's body and the only thing on the page that scrolls here
         (measured: 726 visible against 1245 of content on a busy day; the
         document itself and every box between are not scrollers). Pinned to
         the bottom of that scrollport, the buttons stay reachable without
         scrolling to the end.

         `sticky` rather than `fixed` on purpose: it keeps the footer IN FLOW,
         so its slot at the end of the content is still reserved and the last
         row of chips ends above the buttons instead of under them. That is the
         "space needed at the bottom" in Jerico's note, and it is structural
         rather than a guessed offset.

         The background and the hairline are what make it read as a surface
         rather than as floating text: chips scroll underneath, and without the
         fill they show through the gap between the two buttons. White, because
         that is the modal's own fill; the hairline is the same one the desktop
         band carries, and Jerico asked for both once he had seen the footer
         float. It stays in px — a hairline is a device-pixel affordance, per
         the unit convention this sheet follows. */
      /* PLACEMENT on the role selector, which every footer answers to;
         APPEARANCE on the engine's own row only. An authored
         `data-booking-footer-class` row places its own children and paints
         itself — the contract this file documents — and appearance rules on
         the role selector broke that promise at winning specificity. */
      role + '"footer"]{order:4}',
      ownRow + '{position:sticky;bottom:0;background:#fff;border-top:' + CALENDAR_FOOTER_RULE + ';padding:' + CALENDAR_FRAME + '}',
      // Stacked, full width, primary first. `order` rather than
      // `column-reverse` so the empty state — which has only the back
      // control — is unaffected either way.
      ownRow + '{flex-direction:column;align-items:stretch}',
      ownRow + ' [data-paid-calendar-element="confirm"]{order:-1}',
      '}',

      // ---- from the site's tablet breakpoint up ----
      '@media (min-width:768px){',
      role + '"shell"]{',
      // More air between the month and the times than between the stacked
      // rows on the right. Rem, so it tracks the site's responsive root font
      // size rather than pinning a pixel width.
      'column-gap:2rem;',
      // Zero, not small: the footer band's hairline and padding do the
      // separating now. See CALENDAR_FOOTER_RULE.
      'row-gap:0;',
      'grid-template-columns:minmax(0,1fr) minmax(0,1fr);',
      /* The footer spans BOTH columns on its own row at the bottom, so the
         buttons anchor to the bottom of the whole panel rather than to the
         bottom of the right-hand column. That is the arrangement Jerico was
         reaching for with a `position:absolute; bottom:0` footer in the
         browser — replayed verbatim, that version pulls the footer out of flow
         and it OVERLAPS the times list by 78px and the month by 110px, and on
         mobile it covers the slots so completely that a slot cannot be clicked
         at all. A spanning grid row gets the same anchoring with the footer
         still in flow. */
      /* Three rows, and the month spans the first two. The timezone note —
         the shared engine's caption naming the clock the times are shown in —
         sits at the TOP of the right column, directly above the first row of
         chips, which is where Jerico placed it. The status has no area of its
         own: it is a banner now, out of flow and anchored to the modal's body.

         The month spanning rows 1 and 2 is what keeps the modal the same
         height. Its own height still decides the whole column, and the note
         takes its share from INSIDE that, so the panel does not grow by the
         caption — the times area gives up the note's height instead. */
      'grid-template-areas:"month timezone" "month times" "footer footer";',
      /* Row 1 is the caption at its own height, row 2 is what the times get,
         row 3 the footer band. The month spans 1 and 2, so the two together
         still measure exactly the month. */
      'grid-template-rows:min-content minmax(0,1fr) min-content;',
      'align-content:start}',
      // The month keeps its natural height rather than stretching down its row.
      // It now carries the frame on its bottom edge as well: with the row gap
      // gone, this padding is what holds the calendar off the footer's rule.
      role + '"month"]{grid-area:month;align-self:start;padding:' + CALENDAR_FRAME + ' 0 ' + CALENDAR_FRAME + ' ' + CALENDAR_FRAME + '}',
      /* `height:0;min-height:100%` is the containment, and it is not
         decoration. A flexible grid track in an AUTO-height grid is sized to
         its items' max-content, so `minmax(0,1fr)` plus `min-height:0` alone
         still let a long slot list grow the modal — measured: the times row
         went to 397px against the month's 305px and the modal from 438px to
         601px. Giving the times a definite `height:0` removes it from the
         track's sizing entirely, so the month alone decides the row height,
         and `min-height:100%` then fills the area the month left. Do not
         "simplify" this to `min-height:0`.

         `align-content:start` keeps the slot chips at their natural height: the
         box has a definite height now and a grid's default `align-content` is
         `stretch`, which inflated four chips to 113px against 42.7px on a busy
         day.

         The frame padding skips the left edge, which belongs to the column
         gap, and it no longer pads the TOP: the timezone note above now owns
         that edge of the frame, and a top inset here as well would push the
         first chip a whole frame below the caption. The bottom edge stays
         padded like the month's so both columns end level above the footer's
         rule. Padding is INSIDE the scroll container, so the bottom inset
         scrolls with the content. */
      role + '"times"]{grid-area:times;height:0;min-height:100%;align-content:start;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:0 ' + CALENDAR_FRAME + ' ' + CALENDAR_FRAME + ' 0}',
      /* The timezone control's own area. The engine writes no inline styles on
         its wrapper on this surface — inline beats any rule here — so the box
         rule above and this padding are the whole of its layout; the caption
         and the select inside it keep their inline typography, which this
         sheet does not try to reach.

         It carries the frame's top and right edges, so it lines up with the
         times below it and with the month's top opposite. The bottom `1rem`
         is the gap down to the first chip: the control has no margin of its
         own, so the space has to come from its padding, and half a
         frame reads as a caption attached to the list rather than a row of its
         own.

         It sits OUTSIDE the scroll container — a sibling of the times, not a
         child — so it stays put while the chips scroll under it. That is the
         behaviour a caption for the whole list wants. */
      role + '"timezone-control"]{grid-area:timezone;padding:' + CALENDAR_FRAME + ' ' + CALENDAR_FRAME + ' ' + TIMEZONE_GAP + ' 0}',
      /* The page hides every inner scrollbar globally
         (`*:not(html):not(body)::-webkit-scrollbar{display:none}`), which would
         leave this list scrollable with no affordance that there is more below.
         Re-enabled here at the same 3px the page already uses for the Nylas
         scheduler's own timeslot list. */
      role + '"times"]::-webkit-scrollbar{width:' + SCROLLBAR_WIDTH + ';display:block;background:transparent}',
      role + '"times"]::-webkit-scrollbar-thumb{background-color:var(--colors--black-olive-40);border-radius:' + SCROLLBAR_WIDTH + '}',
      role + '"times"]::-webkit-scrollbar-track{background-color:var(--colors--silver)}',
      /* The footer as its own band: a hairline across the full width, its own
         padding inside it, and the buttons pushed to the right at their
         natural width.

         Right-aligned rather than sharing the row: that is what Jerico's
         screenshot shows, it is what his note "the button group flex" asks
         for, and it is how the modal's own authored `.call-sched_button-group`
         lays buttons out (`justify-content:flex-end`), so the calendar step now
         matches the steps either side of it. The buttons keep the component's
         own padding, which is what makes "natural width" a real size rather
         than a shrink-to-label.

         `align-items:center` rather than `stretch`, because with no flex-grow
         the two buttons are sized by their own content and a stretch would only
         matter if their heights differed. */
      // Placement for every footer; the band's own look for the engine's row
      // alone. See the mobile split above.
      role + '"footer"]{grid-area:footer}',
      ownRow + '{border-top:' + CALENDAR_FOOTER_RULE + ';padding:' + CALENDAR_FRAME + ';justify-content:flex-end;align-items:center}',
      '}',
    ].join('')
    const host = document.head || document.documentElement
    if (host && typeof host.appendChild === 'function') host.appendChild(style)
  }

  function authoredClassSurfaces(container) {
    const surfaces = [container]
    const root = bookingSurfaceFor(container)
    if (root && root !== container) surfaces.push(root)
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

  /* ---- the site's button component ----
     Copied structurally from the published page, where every button is this
     shape. The look is not ours to write: the theme fill, text colour and
     border come from the global `[data-button-theme][data-button-style]` rules,
     and the padding, uppercase, size and weight come from
     `.button_main-element`. Reproducing the markup is therefore the whole job —
     an inline style here would be the old hardcoded look wearing a new class
     name, and a missing wrapper is a button with the wrong typography.

     Two structural details are load-bearing:

     - The real interactive element is the `.clickable_btn` overlaid INSIDE the
       wrap, not the wrap itself. `.button_main-element` is `pointer-events:
       none`, so the label never receives the click. Handlers and `disabled`
       belong on the inner button; markers and modal attributes belong on the
       wrap, which is what `closest()` finds from the click target.
     - No size variant class is applied. The Designer's default size is the
       absence of a `w-variant-*` / `.small` / `.large-*` class on
       `.button_main-element`, so adding nothing IS asking for the default. */
  function buildSiteButton(document, label, style) {
    const wrap = document.createElement('div')
    wrap.setAttribute('data-button-theme', 'black')
    wrap.setAttribute('data-button-style', style)
    wrap.setAttribute('class', 'button_main-wrap')

    const clickableWrap = document.createElement('div')
    clickableWrap.setAttribute('class', 'clickable_wrap')
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('class', 'clickable_btn')
    button.setAttribute('aria-label', String(label))
    clickableWrap.appendChild(button)

    const element = document.createElement('div')
    element.setAttribute('class', 'button_main-element')
    const text = document.createElement('div')
    text.setAttribute('class', 'button_main-text')
    text.textContent = String(label)
    const line = document.createElement('div')
    line.setAttribute('class', 'button_main-line')
    element.appendChild(text)
    element.appendChild(line)

    wrap.appendChild(clickableWrap)
    wrap.appendChild(element)
    return { wrap, button, text }
  }

  /**
   * The theme half of a component button's enabled/disabled state.
   *
   * `disabled` on the inner button stops the click; the theme swap is what the
   * visitor sees, and it is how every authored disabled button on the site is
   * expressed. Doing only one of the two leaves a dead-looking live button or a
   * live-looking dead one.
   */
  function setSiteButtonDisabled(control, disabled) {
    if (!control) return
    control.button.disabled = Boolean(disabled)
    control.wrap.setAttribute('data-button-theme', disabled ? 'disabled' : 'black')
  }

  /**
   * The back control: the site's secondary button, carrying the markers and
   * modal attributes on its WRAP.
   *
   * The wrap is the marked node because that is what the modal embed resolves —
   * it reads `event.target.closest('[data-modal-close]')` and
   * `closest("[data-modal-trigger='…']")`, both of which walk up from the inner
   * `.clickable_btn` the visitor actually presses. It is also the node the
   * profile script's guard stylesheet hides and writes `aria-hidden` on, so the
   * whole component disappears together rather than leaving an empty wrapper.
   *
   * The label is plain "Back". The arrow was a hand-drawn affordance from when
   * this was an unstyled text button; the component carries its own affordance.
   */
  function buildBackControl(document, settings) {
    const control = buildSiteButton(
      document,
      (settings && settings.backText) || 'Back',
      'secondary',
    )
    control.wrap.setAttribute('data-booking-back', '')
    control.wrap.setAttribute('data-modal-close', '')
    control.wrap.setAttribute('data-modal-trigger', 'popup-booking-main')
    control.wrap.setAttribute('data-paid-calendar-element', 'back')
    return control
  }

  /**
   * Human label for the calendar's timezone, e.g. "Asia/Manila (GMT+8)". The
   * calendar renders in the visitor's detected zone and offers no picker, so
   * this label is what tells them which clock the times use (Kaeser QA B4).
   * The reference timestamp keeps the offset DST-correct for the shown dates.
   */
  function timezoneLabel(timezone, referenceMsInput) {
    const zone = String(timezone || '').trim()
    if (!zone) return ''
    const referenceMs = Number.isFinite(Number(referenceMsInput))
      ? Number(referenceMsInput)
      : Date.now()
    let offset = ''
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        timeZoneName: 'short',
      }).formatToParts(new Date(referenceMs))
      const name = parts.find(function (part) {
        return part.type === 'timeZoneName'
      })
      offset = String((name && name.value) || '').trim()
    } catch (_error) {
      offset = ''
    }
    return offset && offset !== zone ? zone + ' (' + offset + ')' : zone
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

  function supportedTimezones(initialTimezone, preferredTimezones) {
    let values = []
    if (Array.isArray(preferredTimezones)) {
      values = preferredTimezones
    } else if (typeof Intl.supportedValuesOf === 'function') {
      try {
        values = Intl.supportedValuesOf('timeZone')
      } catch (_) {}
    }
    if (!values.length) {
      values = [
        'UTC',
        'Pacific/Honolulu',
        'America/Anchorage',
        'America/Los_Angeles',
        'America/Denver',
        'America/Chicago',
        'America/New_York',
        'America/Sao_Paulo',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Africa/Johannesburg',
        'Asia/Dubai',
        'Asia/Kolkata',
        'Asia/Bangkok',
        'Asia/Manila',
        'Asia/Singapore',
        'Asia/Hong_Kong',
        'Asia/Tokyo',
        'Australia/Perth',
        'Australia/Sydney',
        'Pacific/Auckland',
      ]
    }
    const unique = Array.from(new Set(values.map(function (value) {
      return String(value || '').trim()
    }).filter(Boolean)))
    if (initialTimezone && !unique.includes(initialTimezone)) unique.unshift(initialTimezone)
    if (!unique.includes('UTC')) unique.unshift('UTC')
    return unique
  }

  function createTimezoneControl(settings, initialTimezone, timestamp, onBookingSurface) {
    const wrapper = global.document.createElement('label')
    if (!onBookingSurface) {
      applyStyles(wrapper, {
        display: 'grid',
        gap: '6px',
        justifySelf: 'start',
        width: 'min(100%, 320px)',
      })
    }
    wrapper.setAttribute('data-paid-calendar-element', 'timezone-control')

    /* The caption and the control itself follow the wrapper's lead: on the
       booking surface the injected sheet owns their look, because an inline
       declaration outranks every rule in it and the OS-default select Jerico
       objected to is exactly what those inline pixels produce. Every other
       surface keeps them untouched — the dashboard's reschedule calendar has
       no sheet to take over. */
    const label = global.document.createElement('span')
    if (!onBookingSurface) {
      applyStyles(label, { color: '#6f746d', fontSize: '13px' })
    }
    label.textContent = 'Timezone'

    const select = global.document.createElement('select')
    if (!onBookingSurface) {
      applyStyles(select, {
        width: '100%',
        minHeight: '42px',
        padding: '8px 36px 8px 12px',
        border: '1px solid #d7d9d2',
        borderRadius: '6px',
        background: '#ffffff',
        color: '#1f211d',
        fontSize: '14px',
        cursor: 'pointer',
      })
    }
    select.setAttribute('data-paid-calendar-element', 'timezone')
    select.setAttribute('aria-label', 'Timezone')
    supportedTimezones(initialTimezone, settings.timezones).forEach(function (timezone) {
      const option = global.document.createElement('option')
      option.value = timezone
      option.textContent = timezoneLabel(timezone, timestamp)
      select.appendChild(option)
    })
    select.value = initialTimezone
    wrapper.appendChild(label)
    wrapper.appendChild(select)
    return { wrapper, select }
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
    let timezone = String(
      settings.initialTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    ).trim() || 'UTC'
    const slots = await getPaidAvailability(config)
    if (!isCurrent()) return { slots: [], stale: true }
    container.textContent = ''
    container.setAttribute('data-paid-calendar-state', slots.length ? 'ready' : 'empty')

    /* Whether this mount is the profile's booking dialog. Everything the
       booking surface adds — the injected stylesheet, the component buttons,
       the back control and the status banner — hangs off this, and the
       dashboard's reschedule calendar takes none of it. */
    const bookingSurface = bookingSurfaceFor(container)
    const onBookingSurface = Boolean(bookingSurface)
    if (onBookingSurface) {
      ensureBookingCalendarLayout(global.document)
      /* The authored step this calendar lives in, marked so the sheet can
         reset ITS padding without touching the dialog's other steps. There are
         four `.call-details_layout` wrappers in the booking dialog — calendar,
         success, confirmed and payment-methods — and keying on the class alone
         stripped the authored padding from all of them. */
      const step = typeof container.closest === 'function'
        ? container.closest('.call-details_layout')
        : null
      if (step && typeof step.setAttribute === 'function') {
        step.setAttribute('data-paid-calendar-step', '')
      }
    }

    const status = global.document.createElement('p')
    status.setAttribute('data-paid-calendar-element', 'status')
    /* Off the booking surface there is no injected sheet, so the status keeps
       the plain grey line it has always been and these inline declarations are
       the only thing giving it one. ON the booking surface the sheet paints it
       as a banner, and an inline declaration written here would outrank every
       rule in that sheet — including the colour that tells a failed booking
       apart from a progress notice. */
    if (!onBookingSurface) {
      applyStyles(status, { color: '#6f746d', fontSize: '13px', margin: '0' })
    }

    /**
     * The one place the status line is written, so the sheet always has a tone
     * to colour it by. Three strings ever reach it — the empty-availability
     * notice, the in-flight notice and the booking failure — and only the last
     * is a failure, which is why they are not all the same red.
     *
     * The tone is a booking-surface concern (it is what the injected sheet
     * keys on), so it is not written on the dashboard's reschedule calendar:
     * that surface has no sheet to read it and has to stay as it shipped.
     */
    function setStatus(text, tone) {
      status.textContent = text || ''
      if (!onBookingSurface) return
      if (text && tone) status.setAttribute('data-paid-calendar-status', tone)
      else status.removeAttribute('data-paid-calendar-status')
      if (text) revealStatus()
    }

    /**
     * Bring the banner into view.
     *
     * The banner is absolutely positioned against the modal's body, which is
     * also what scrolls on a phone — so it is painted at the TOP of the
     * scrollable content, not at the top of what the visitor can see. Measured
     * from the bottom of a busy day's scroll: a failure message rendered 487px
     * above the viewport and nothing at all changed on screen. A message the
     * visitor cannot see is not a message.
     *
     * Scrolling the scrollport back to the top is the smallest fix that keeps
     * the overlay design intact at both widths. It only ever runs when there
     * is something to say, so it cannot fight a visitor who is browsing slots.
     *
     * The search for that scrollport stops at the booking dialog. Nothing
     * between the banner and the dialog is guaranteed to overflow — on desktop
     * the times list scrolls inside its own grid cell precisely so the panel
     * never grows, and then no box in the dialog scrolls at all — so an
     * unbounded walk would climb past it and find the document, which does
     * scroll on a hire profile page. Yanking the page behind an open modal to
     * the top is not bringing a banner into view; when the dialog holds no
     * scrollport, the banner is already on screen and nothing should move.
     */
    function revealStatus() {
      let node = status.parentElement
      while (node) {
        const scrollable = Number(node.scrollHeight) > Number(node.clientHeight) + 1
        if (scrollable && typeof node.scrollTop === 'number') {
          node.scrollTop = 0
          return
        }
        if (node === bookingSurface) return
        node = node.parentElement
      }
    }
    const timezoneControl = createTimezoneControl(
      settings,
      timezone,
      slots.length ? slots[0].start : Date.now(),
      onBookingSurface,
    )

    /* The back control is a hand-off, not a behaviour of its own: the two modal
       attributes close this dialog and open the Free/Paid chooser, exactly as
       an authored control would, and `data-booking-back` is the marker the
       profile script keys its entry-aware visibility on. Nothing here decides
       when it is on screen — the guard stylesheet owns display and the profile
       script owns the accessible state, so this must not write either.

       It is built only on the booking surface. This engine also mounts the
       dashboard's reschedule calendar, where there is no Free/Paid chooser to
       go back to and no guard stylesheet to hide the control: a back rendered
       there would be an always-visible button that closes the reschedule
       dialog and lands the visitor nowhere. */
    const backControl = onBookingSurface
      ? buildBackControl(global.document, settings)
      : null
    const back = backControl ? backControl.wrap : null

    /* No back control means no row to put it in, and the confirm button goes
       straight into the grid shell. That preserves the dashboard reschedule
       calendar's full-width confirm control: it cannot author classes and has
       no back, while a footer would turn its confirm from a full-width grid
       item into a shrink-to-fit flex child. */
    let footer = null
    let footerIsAuthored = false
    if (back) {
      footer = global.document.createElement('div')
      footer.setAttribute('data-paid-calendar-element', 'footer')
      footerIsAuthored = applyAuthoredClasses(
        footer,
        authoredClassList(container, FOOTER_CLASS_ATTRIBUTE),
      )
      // Keep the two actions visually distinct on every booking surface. This
      // is layout placement, so it applies to every row without changing either
      // button's Designer-owned appearance. The engine's own fallback row below
      // declares a flex `gap`, which supersedes this on that row; an authored
      // row places its own children and this is the only spacing it gets.
      footer.style.columnGap = '16px'
      // Which row this is, so the injected stylesheet's stacking rules can
      // reach the engine's own row without ever touching an authored one.
      footer.setAttribute(
        'data-paid-calendar-footer',
        footerIsAuthored ? 'authored' : 'fallback',
      )
      if (!footerIsAuthored) {
        // `data-booking-footer-class` is optional, so this fallback row is the
        // likely production shape and it has to look finished on its own.
        //
        // Flex rather than fixed columns is what survives the back control
        // being hidden on a direct entry: `display:none` takes it out of the
        // layout entirely and the confirm fills the row, instead of being
        // stranded in a second column beside an empty first.
        /* Only what does not vary by breakpoint. Alignment and the buttons'
           own sizing are breakpoint-dependent — a right-aligned row of
           natural-width buttons on desktop, a full-width stack on mobile — and
           an inline declaration outranks any stylesheet rule, so writing them
           here would pin them at both sizes. The sheet owns them. */
        applyStyles(footer, {
          display: 'flex',
          gap: '12px',
          width: '100%',
        })
      }
      footer.appendChild(back)
    }

    if (!slots.length) {
      container.appendChild(status)
      setStatus('No available times were found in the next 14 days.', 'empty')
      // An empty calendar is exactly when a visitor most wants the other kind
      // of call, so the way back out has to survive the early return.
      if (footer) container.appendChild(footer)
      return { slots: [], timezone }
    }

    let groups = {}
    let dateKeys = []
    let selectedDate = ''
    let selectedSlot = null
    let confirmationPending = false

    function groupSlots() {
      groups = {}
      dateKeys = []
      slots.forEach(function (slot) {
        const key = calendarDateKey(slot.start, timezone)
        if (!groups[key]) {
          groups[key] = []
          dateKeys.push(key)
        }
        groups[key].push(slot)
      })
      selectedDate = dateKeys[0]
    }

    groupSlots()

    /* The booking surface hands its gaps to the injected sheet; the dashboard
       keeps writing them inline exactly as it always did.

       This split is not tidiness. An inline declaration outranks a stylesheet
       rule whatever its specificity, so an inline `gap` shorthand would pin
       `column-gap` too and the sheet could not widen the space between the
       month and the times without `!important` — which nothing else here
       needs. Withholding the shorthand on this one surface is what keeps the
       sheet authoritative and the no-`!important` rule intact. The sheet does
       not restate the 16px row gap: on this surface there is no row gap at
       all, and the frame padding each stacked element carries is the whole
       vertical rhythm. */
    /* On the booking surface the sheet owns `display` as well as both gaps.
       An inline declaration outranks every rule in it, and the two breakpoints
       need DIFFERENT formatting contexts: a grid on desktop, a flex column on
       a phone so the footer can stick. See the sticky footer rule for why a
       grid cannot do it — a grid item's containing block is its own grid area,
       which for a footer on its own row leaves sticky nowhere to travel.
       Off that surface the inline shorthand stays exactly where it was. */
    const shell = applyStyles(global.document.createElement('div'), onBookingSurface
      ? { width: '100%' }
      : { display: 'grid', gap: '16px', width: '100%' })
    shell.setAttribute('data-paid-calendar-element', 'shell')
    /* The shared engine's three responsive wrappers. Off the booking surface
       they carry the inline grid that gives the dashboard its columns — the
       month with the timezone caption under it on the left, the times on the
       right — exactly as they shipped. ON it they are left unstyled and the
       sheet collapses them with `display:contents` — see that rule for why.
       Writing the inline grid here instead would nest this file's whole
       arrangement inside a second grid whose declarations no rule in the sheet
       can outrank without `!important`, which the containment test forbids. */
    const layout = applyStyles(global.document.createElement('div'), onBookingSurface
      ? {}
      : {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
        alignItems: 'start',
        gap: '16px',
        width: '100%',
      })
    layout.setAttribute('data-paid-calendar-element', 'layout')
    const calendarPanel = applyStyles(global.document.createElement('div'), onBookingSurface
      ? {}
      : {
        display: 'grid',
        alignContent: 'start',
        gap: '16px',
        minWidth: '0',
      })
    calendarPanel.setAttribute('data-paid-calendar-element', 'calendar-panel')
    const calendarHost = global.document.createElement('div')
    calendarHost.setAttribute('data-paid-calendar-element', 'month')
    const timePanel = applyStyles(global.document.createElement('div'), onBookingSurface
      ? {}
      : {
        display: 'grid',
        alignContent: 'start',
        gap: '16px',
        minWidth: '0',
      })
    timePanel.setAttribute('data-paid-calendar-element', 'time-panel')
    const times = applyStyles(global.document.createElement('div'), {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
      gap: '8px',
    })
    times.setAttribute('data-paid-calendar-element', 'times')
    const confirmLabel = String(settings.confirmText || 'Request paid call')
    const slotRestingBackground = onBookingSurface
      ? BOOKING_SLOT_RESTING_BACKGROUND
      : '#f3f4ef'
    /* On the booking surface the confirm is the site's primary button. Off it,
       the dashboard's reschedule calendar keeps the plain element and the
       authored-class contract it shipped with, unchanged. */
    const confirmControl = onBookingSurface
      ? buildSiteButton(global.document, confirmLabel, 'primary')
      : null
    let confirm
    let confirmButton
    if (confirmControl) {
      confirm = confirmControl.wrap
      confirmButton = confirmControl.button
    } else {
      confirm = global.document.createElement('button')
      confirm.type = 'button'
      confirm.textContent = confirmLabel
      confirmButton = confirm
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
    }
    confirm.setAttribute('data-paid-calendar-element', 'confirm')

    /**
     * The confirm's enabled state, in the one place that owns both halves of
     * it. On the component the visitor reads the theme, not the `disabled`
     * property; off the booking surface there is no theme to swap and this is
     * exactly the `confirm.disabled = …` line it replaced.
     */
    function setConfirmDisabled(disabled) {
      if (confirmControl) setSiteButtonDisabled(confirmControl, disabled)
      else confirmButton.disabled = Boolean(disabled)
    }
    setConfirmDisabled(true)

    if (footer) {
      footer.appendChild(confirm)
    }

    function clearSelection() {
      selectedSlot = null
      onSelectionChange(null)
      setConfirmDisabled(true)
      setStatus('')
      Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (candidate) {
        candidate.setAttribute('aria-pressed', 'false')
        candidate.style.background = slotRestingBackground
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
          background: slotRestingBackground,
          color: '#1f211d',
          cursor: 'pointer',
        })
        button.addEventListener('click', function () {
          if (confirmationPending) return
          Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (candidate) {
            candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false')
            candidate.style.background = candidate === button
              ? SLOT_SELECTED_BACKGROUND
              : slotRestingBackground
            candidate.style.color = candidate === button ? '#ffffff' : '#1f211d'
          })
          selectedSlot = slot
          onSelectionChange(slot)
          setConfirmDisabled(false)
          setStatus('')
        })
        times.appendChild(button)
      })
    }

    const $ = global.jQuery
    let datepickerMounted = false

    function renderCalendar() {
      if ($ && $.fn && $.fn.datepicker) {
        if (datepickerMounted) $(calendarHost).datepicker('destroy')
        calendarHost.textContent = ''
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
        datepickerMounted = true
      } else {
        calendarHost.textContent = ''
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
      renderTimes()
    }

    timezoneControl.select.addEventListener('change', function () {
      if (confirmationPending) return
      timezone = String(timezoneControl.select.value || '').trim() || 'UTC'
      groupSlots()
      renderCalendar()
    })

    confirmButton.addEventListener('click', async function () {
      if (!selectedSlot || confirmButton.disabled || confirmationPending) return
      confirmationPending = true
      setConfirmDisabled(true)
      timezoneControl.select.disabled = true
      // Back sits in the same row as the button that was just pressed, and it
      // closes the dialog. Left live, one stray click mid-request wipes the
      // surface the confirmation was about to appear on, while the booking
      // still goes through server-side — a call the visitor never sees.
      /* Both halves matter. `setSiteButtonDisabled` swaps the component's
         theme as well as disabling the inner button, so the control reads
         disabled instead of just refusing clicks. The marker then takes the
         WRAP out of the pointer path: it carries `data-modal-close`, and the
         modal embed resolves that with `closest()` from the click target, so
         the border around a disabled button still closed the dialog with the
         request open. */
      if (backControl) {
        setSiteButtonDisabled(backControl, true)
        backControl.wrap.setAttribute('data-paid-calendar-busy', '')
      }
      Array.from(calendarHost.querySelectorAll('[data-paid-calendar-date]')).forEach(function (button) {
        button.disabled = true
      })
      if ($ && $.fn && $.fn.datepicker) {
        $(calendarHost).datepicker('option', 'disabled', true)
      }
      Array.from(times.querySelectorAll('[data-paid-calendar-slot]')).forEach(function (button) {
        button.disabled = true
      })
      setStatus('Sending your request...', 'progress')
      try {
        await onConfirm({
          start: selectedSlot.start,
          end: selectedSlot.end,
          timezone,
        })
      } catch (error) {
        console.error('[paid-call] booking failed', error)
        setStatus('We could not book this call. Please try again.', 'error')
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
          setConfirmDisabled(!selectedSlot)
          timezoneControl.select.disabled = false
          if (backControl) {
            setSiteButtonDisabled(backControl, false)
            backControl.wrap.removeAttribute('data-paid-calendar-busy')
          }
        }
      }
    })

    calendarPanel.appendChild(calendarHost)
    calendarPanel.appendChild(timezoneControl.wrapper)
    layout.appendChild(calendarPanel)
    timePanel.appendChild(times)
    layout.appendChild(timePanel)
    shell.appendChild(layout)
    shell.appendChild(footer || confirm)
    shell.appendChild(status)
    container.appendChild(shell)
    renderCalendar()
    const result = { slots, clearSelection }
    Object.defineProperty(result, 'timezone', {
      enumerable: true,
      get: function () { return timezone },
    })
    return result
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
    ensureBookingCalendarLayout,
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
    timezoneLabel,
    installGuestFormSubmitGuard,
    installPaidBookingController,
    mountPaidCalendar,
    minimumBookingNoticeMinutes,
    normalizeGuestEmails,
    normalizeAvailabilitySlots,
    readGuestEmails,
    requireCanonicalBookingProof,
    supportedTimezones,
    timezoneLabel,
    validateKey,
    validatePaymentMethodId,
  }

  if (isCommonJs) {
    module.exports = api
    return
  }
  global.StartersPaidCallBrandPayment = api
})(typeof window !== 'undefined' ? window : globalThis)
