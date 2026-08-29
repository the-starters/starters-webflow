/**
 * GitHub-owned Free Call booking controller for /hire/<slug>.
 *
 * @release v1.59.429
 *
 * Webflow owns the chooser, modal shell, guest fields, and success step. This
 * module binds those authored elements and sends Free requests through the
 * canonical V3 booking command. It never creates a provider booking directly.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
  const STARTER_PATH = '/starter/get_booking_profile/v3'
  const CONFIGS_PATH = '/nylas_configurations/get_bookable/v3'
  const AVAILABILITY_PATH = '/scheduler/get_availability/v3'
  const BOOKING_PATH = '/brand/booking/request/v3'
  const STAGING_HOST = 'the-starters-3-0.webflow.io'
  // The one copy of this string. hire-profile.js's load-time painter imports it
  // rather than duplicating it, so the two writers cannot drift apart.
  const NO_SLOTS_TEXT = 'No available slots'
  const PRODUCTION_MIN_BOOKING_NOTICE_MINUTES = 24 * 60
  const STAGING_MIN_BOOKING_NOTICE_MINUTES = 5
  const chooserBindings = new WeakMap()
  const bookingSurfaceOwnership = getBookingSurfaceOwnership()
  const bookingSurfaceLifecycle = getBookingSurfaceLifecycle()

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

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function isStagingHost() {
    return clean(global.location && global.location.hostname).toLowerCase() === STAGING_HOST
  }

  function minimumBookingNoticeMinutes() {
    if (isCommonJs) return PRODUCTION_MIN_BOOKING_NOTICE_MINUTES
    return isStagingHost()
      ? STAGING_MIN_BOOKING_NOTICE_MINUTES
      : PRODUCTION_MIN_BOOKING_NOTICE_MINUTES
  }

  async function authenticatedRequest(path, method, payload) {
    if (typeof global.xanoAuthFetch !== 'function') {
      throw new Error('The authenticated Xano bridge is unavailable')
    }
    const options = {
      method: method || 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }
    if (payload !== undefined) options.body = JSON.stringify(payload)
    const response = await global.xanoAuthFetch(XANO_BASE + path, options)
    const data = await response.json().catch(function () { return null })
    if (!response.ok) {
      throw Object.assign(new Error(path + ' failed (' + response.status + ')'), {
        status: response.status,
        data,
      })
    }
    return data
  }

  async function getStarterByMemberId(memberId) {
    const id = clean(memberId)
    if (!id) throw new Error('A Starter member ID is required')
    try {
      const result = await authenticatedRequest(STARTER_PATH, 'POST', { member_id: id })
      return result && result.id ? result : null
    } catch (error) {
      console.error('[free-call-booking] Starter lookup failed:', error)
      return null
    }
  }

  async function getConfigs(grantId) {
    const id = clean(grantId)
    if (!id) throw new Error('A Nylas grant ID is required')
    try {
      const result = await authenticatedRequest(CONFIGS_PATH, 'POST', { grant_id: id })
      return Array.isArray(result) ? result : []
    } catch (error) {
      console.error('[free-call-booking] configuration lookup failed:', error)
      return []
    }
  }

  function availabilityPath(grantId, configId, nowMs) {
    const grant = clean(grantId)
    const config = clean(configId)
    if (!grant || !config) throw new Error('A grant and configuration are required')
    const start =
      Math.floor(Number(nowMs === undefined ? Date.now() : nowMs) / 1000) +
      minimumBookingNoticeMinutes() * 60
    const query = new URLSearchParams({
      grant_id: grant,
      configuration_id: config,
      start_time: String(start),
      end_time: String(start + 14 * 86400),
      region: 'us',
    })
    return AVAILABILITY_PATH + '?' + query.toString()
  }

  async function getNearestSlot(grantId, configId, nowMs) {
    const result = await authenticatedRequest(availabilityPath(grantId, configId, nowMs), 'GET')
    const minimum =
      Math.floor(Number(nowMs === undefined ? Date.now() : nowMs) / 1000) +
      minimumBookingNoticeMinutes() * 60
    const slots = Array.isArray(result && result.time_slots) ? result.time_slots : []
    const starts = slots.map(function (slot) {
      return Number(slot && slot.start_time)
    }).filter(function (start) {
      return Number.isFinite(start) && start >= minimum
    }).sort(function (a, b) { return a - b })
    return starts.length ? starts[0] : null
  }

  function formatWithTimezone(timestamp, formatOptions) {
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return { default: '', list: {} }
    const formatter = new Intl.DateTimeFormat('en-US', Object.assign({
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }, formatOptions || {}))
    const values = {}
    formatter.formatToParts(date).forEach(function (part) {
      if (part.type !== 'literal') values[part.type] = part.value
    })
    values.dayPeriod = clean(values.dayPeriod).toUpperCase()
    return {
      default: [
        values.weekday + ' ' + values.month + ' ' + values.day + ',',
        values.hour + ':' + values.minute + values.dayPeriod,
        values.timeZoneName,
      ].join(' '),
      list: values,
    }
  }

  function canonicalBookingApi(settings) {
    const candidate = settings && settings.bookingApi
      ? settings.bookingApi
      : global.StartersPaidCallBrandPayment
    if (
      !candidate ||
      typeof candidate.mountPaidCalendar !== 'function' ||
      typeof candidate.createBookingAttempt !== 'function' ||
      typeof candidate.bookingRequestFingerprint !== 'function'
    ) return null
    return candidate
  }

  function canonicalBookingId(result) {
    const booking = result && result.booking
    if (!booking || typeof booking !== 'object') return ''
    return clean(booking.row_id) && clean(booking.booking_id)
      ? clean(booking.booking_id)
      : ''
  }

  function switchStep(popup, target) {
    popup.querySelectorAll('[schedule-step]').forEach(function (step) {
      step.style.display = step.getAttribute('schedule-step') === target ? 'flex' : 'none'
    })
  }

  function fieldValue(popup, selector) {
    const field = popup.querySelector(selector)
    return field ? clean(field.value) : ''
  }

  function readGuestEmails(api, popup, excludedEmails) {
    if (typeof api.readGuestEmails !== 'function') return []
    const fields = Array.from(popup.querySelectorAll('[data-call-guest-email]'))
    if (!fields.length) return []
    return api.readGuestEmails(popup, excludedEmails)
  }

  function setGuestError(popup, message) {
    const error = popup.querySelector('[data-call-guest-error]')
    if (!error) return
    error.textContent = clean(message)
    error.style.display = message ? 'block' : 'none'
  }

  function installGuestUi(api, popup, container) {
    const wrapper = popup.querySelector('[data-call-guest-fields]')
    const hookSelector =
      '[data-call-guest-fields], [data-call-guest-list], [data-call-guest-error], [data-call-guest-add], [data-call-guest-row], [data-call-guest-email], [data-call-guest-remove]'
    if (!popup.querySelectorAll(hookSelector).length) {
      return {
        hide: function () {},
        read: function () { return [] },
        reset: function () {},
        show: function () {},
      }
    }
    const list = wrapper && wrapper.querySelector('[data-call-guest-list]')
    const error = wrapper && wrapper.querySelector('[data-call-guest-error]')
    const add = wrapper && wrapper.querySelector('[data-call-guest-add]')
    const rows = list ? Array.from(list.querySelectorAll('[data-call-guest-row]')) : []
    const bindings = rows.map(function (row) {
      return {
        row,
        field: row.querySelector('[data-call-guest-email]'),
        remove: row.querySelector('[data-call-guest-remove]'),
      }
    })
    if (
      !wrapper || !list || !error || !add || rows.length !== 5 ||
      popup.querySelectorAll('[data-call-guest-email]').length !== 5 ||
      popup.querySelectorAll('[data-call-guest-remove]').length !== 5 ||
      bindings.some(function (binding) { return !binding.field || !binding.remove }) ||
      (typeof container.contains === 'function' && container.contains(wrapper))
    ) return null

    if (typeof api.installGuestFormSubmitGuard === 'function') {
      api.installGuestFormSubmitGuard(wrapper)
    }

    function update() {
      const visible = bindings.filter(function (binding) {
        return binding.row.getAttribute('aria-hidden') !== 'true'
      }).length
      add.disabled = visible >= 5
      add.style.display = add.disabled ? 'none' : ''
    }

    function reset() {
      bindings.forEach(function (binding, index) {
        binding.field.value = ''
        binding.field.disabled = index !== 0
        binding.row.style.display = index === 0 ? 'flex' : 'none'
        binding.row.setAttribute('aria-hidden', index === 0 ? 'false' : 'true')
        binding.remove.style.display = index === 0 ? 'none' : ''
      })
      setGuestError(popup, '')
      update()
    }

    function setVisible(visible) {
      wrapper.style.display = visible ? 'flex' : 'none'
      wrapper.setAttribute('aria-hidden', visible ? 'false' : 'true')
    }

    if (!add.__startersGuestUiBound) {
      add.__startersGuestUiBound = true
      add.addEventListener('click', function (event) {
        event.preventDefault()
        const next = bindings.find(function (binding) {
          return binding.row.getAttribute('aria-hidden') === 'true'
        })
        if (!next) return
        next.row.style.display = 'flex'
        next.row.setAttribute('aria-hidden', 'false')
        next.field.disabled = false
        if (typeof next.field.focus === 'function') next.field.focus()
        update()
      })
      bindings.forEach(function (binding, index) {
        binding.remove.__startersGuestUiBound = true
        binding.remove.addEventListener('click', function (event) {
          event.preventDefault()
          binding.field.value = ''
          if (index !== 0) {
            binding.field.disabled = true
            binding.row.style.display = 'none'
            binding.row.setAttribute('aria-hidden', 'true')
          }
          setGuestError(popup, '')
          update()
        })
      })
    }

    reset()
    setVisible(false)
    return {
      hide: function () { reset(); setVisible(false) },
      read: function (excluded) { return readGuestEmails(api, popup, excluded) },
      reset,
      show: function () { setVisible(true) },
    }
  }

  function showFreeSuccess(popup) {
    popup.querySelectorAll('[success-call-buttons]').forEach(function (element) {
      element.style.display = element.getAttribute('data-type') === 'free' ? 'flex' : 'none'
    })
    popup.querySelectorAll('[schedule-step="success"] [booking-element="paid-meeting"]').forEach(function (element) {
      element.textContent = 'Free Call'
    })
    popup.querySelectorAll('[schedule-step="success"] *').forEach(function (element) {
      if (/^Your card ending in .+ will be charged for this call\.$/i.test(clean(element.textContent))) {
        element.style.display = 'none'
        element.setAttribute('aria-hidden', 'true')
      }
    })
    const successText = popup.querySelector('[booking-success-text]')
    if (successText) {
      successText.textContent =
        'Your free call request was sent. We will notify you when the Starter confirms it.'
    }
    switchStep(popup, 'success')
  }

  function nextSlotText(value) {
    const list = formatWithTimezone(value * 1000, { month: '2-digit' }).list
    return list.hour + ':' + list.minute + list.dayPeriod + ' on ' + list.month + '/' + list.day
  }

  /**
   * Writes one slot hook and records WHY it says what it says.
   *
   * The state attribute matters because three of the four strings this writes
   * are not times: 'Loading...', the no-slots copy, and the no-slots copy again
   * after a failure all read as "no time" to a human but mean different things
   * to QA. hire-profile.js's load-time painter stamps the same attribute, so a
   * hook is self-describing whichever writer got there last.
   *
   * The equality check is not micro-optimisation: two body-wide MutationObservers
   * (millify's and the portfolio see-more's) wake on every text write, so
   * rewriting an identical string costs real work for no change.
   */
  function updateNearestSlot(state, value, slotState) {
    const item = state.cta.closest('[call-type-item]') || state.cta
    const target = item.querySelector('[next-available-slot]')
    if (!target) return
    if (target.textContent !== value) target.textContent = value
    if (slotState) target.setAttribute('data-next-slot-state', slotState)
  }

  function installFreeBookingController(options) {
    const settings = options || {}
    const config = settings.config || {}
    const configId = clean(config.config_id)
    const grantId = clean(settings.grantId)
    const starterSlug = clean(settings.starterSlug)
    const bookingApi = canonicalBookingApi(settings)
    if (
      !configId ||
      config.is_paid !== false ||
      (config.price_cents != null && Number(config.price_cents) !== 0) ||
      (config.duration != null && Number(config.duration) !== 30) ||
      !grantId ||
      !starterSlug ||
      !bookingApi
    ) {
      return false
    }
    const popup = global.document.querySelector('[popup-booking]')
    const ctas = Array.from(global.document.querySelectorAll(
      '[call-type-item] [booking-popup-open][data-type="free"]',
    ))
    // The calendar footer's back control carries this trigger name too, and it
    // is not a page-level Book Call button. Binding the next-slot prefetch to
    // it would fire a stray availability read on the way back to the chooser.
    // The snapshot is taken at install, before any calendar has mounted, so
    // today this only matters if the controller is ever reinstalled — which is
    // exactly the kind of thing that changes without this line noticing.
    const mainButtons = Array.from(global.document.querySelectorAll(
      '[data-modal-trigger="popup-booking-main"]:not([data-booking-back])',
    ))
    const container = popup && (
      popup.querySelector('[nylas-container]') ||
      global.document.querySelector('[nylas-container]')
    )
    if (!popup || !container || !ctas.length) return false
    const guestUi = installGuestUi(bookingApi, popup, container)
    if (!guestUi) return false

    const state = {
      bookingApi,
      config: Object.assign({}, config, {
        grant_id: grantId,
        duration: 30,
        price_cents: 0,
      }),
      configId,
      grantId,
      starterSlug,
      brandEmail: clean(settings.brandEmail),
      starterEmail: clean(settings.starterEmail),
      popup,
      cta: ctas[0],
    }
    if (!state.brandEmail) return false

    let clearFreeCalendarSelection = null
    const bookingLocks = new Set()

    function clearField(selector) {
      const field = popup.querySelector(selector)
      if (field && 'value' in Object(field)) field.value = ''
    }

    function resetFreeUi() {
      if (clearFreeCalendarSelection) clearFreeCalendarSelection()
      clearFreeCalendarSelection = null
      guestUi.hide()
      clearField('[name="topic"], [booking-topic]')
      clearField('[name="context"], [booking-context]')
      container.textContent = ''
      if (typeof container.removeAttribute === 'function') {
        container.removeAttribute('data-paid-calendar-state')
      }
      switchStep(popup, 'default')
    }

    ctas.forEach(function (cta) {
      const binding = chooserBindings.get(cta) || {}
      binding.state = Object.assign({}, state, { cta })
      chooserBindings.set(cta, binding)
      cta.setAttribute('data-config', configId)
      cta.setAttribute('data-free-call-v3', 'ready')
      const item = cta.closest('[call-type-item]')
      if (item) item.style.display = 'block'
      cta.onclick = async function (event) {
        event.preventDefault()
        const current = binding.state
        const generation = bookingSurfaceLifecycle.reset(popup, 'free')
        container.textContent = 'Loading available times...'
        container.setAttribute('data-paid-calendar-state', 'loading')
        guestUi.hide()
        setGuestError(current.popup, '')
        current.popup.querySelectorAll('[success-call-buttons]').forEach(function (element) {
          element.style.display = element.getAttribute('data-type') === 'free' ? 'flex' : 'none'
        })
        try {
          const result = await current.bookingApi.mountPaidCalendar({
            container,
            config: current.config,
            confirmText: 'Request free call',
            isCurrent: function () {
              return bookingSurfaceOwnership.owns(container, generation)
            },
            onConfirm: async function (slot) {
              if (
                !bookingSurfaceOwnership.owns(container, generation) ||
                bookingLocks.has(generation)
              ) return
              let guests
              try {
                guests = guestUi.read([
                  current.brandEmail,
                  current.starterEmail,
                ])
                setGuestError(current.popup, '')
              } catch (error) {
                setGuestError(current.popup, error && error.message)
                throw error
              }
              const input = {
                starter_slug: current.starterSlug,
                config_id: current.configId,
                start: slot.start,
                end: slot.end,
                timezone: slot.timezone,
                topic: fieldValue(current.popup, '[name="topic"], [booking-topic]'),
                context: fieldValue(current.popup, '[name="context"], [booking-context]'),
                guest_emails: guests,
                brand_email: current.brandEmail,
                starter_email: current.starterEmail,
              }
              const fingerprint = current.bookingApi.bookingRequestFingerprint(input)
              bookingLocks.add(generation)
              try {
                const result = await bookingSurfaceLifecycle.runBooking(
                  container,
                  fingerprint,
                  function () { return current.bookingApi.createBookingAttempt(input) },
                  function (result) {
                    if (!canonicalBookingId(result)) {
                      throw new Error('The canonical booking response is incomplete')
                    }
                  },
                )
                if (!bookingSurfaceOwnership.owns(container, generation)) return result
                showFreeSuccess(current.popup)
                return result
              } finally {
                bookingLocks.delete(generation)
              }
            },
            onSelectionChange: function (slot) {
              if (!bookingSurfaceOwnership.owns(container, generation)) return
              if (!slot) {
                guestUi.hide()
                return
              }
              guestUi.reset()
              guestUi.show()
            },
          })
          if (bookingSurfaceOwnership.owns(container, generation)) {
            clearFreeCalendarSelection = result && typeof result.clearSelection === 'function'
              ? result.clearSelection
              : null
          }
        } catch (error) {
          if (!bookingSurfaceOwnership.owns(container, generation)) return
          container.setAttribute('data-paid-calendar-state', 'error')
          container.textContent = 'We could not load the calendar. Please try again.'
          console.error('[free-call-booking] canonical booking flow failed:', error)
        }
      }
    })

    if (!bookingSurfaceLifecycle.register(popup, container, resetFreeUi)) return false
    bookingSurfaceLifecycle.reset(popup)

    mainButtons.forEach(function (button) {
      button.onclick = async function (event) {
        event.preventDefault()
        updateNearestSlot(state, 'Loading...', 'loading')
        try {
          const slot = await getNearestSlot(state.grantId, state.configId)
          if (slot) updateNearestSlot(state, nextSlotText(slot), 'painted')
          else updateNearestSlot(state, NO_SLOTS_TEXT, 'empty')
        } catch (error) {
          updateNearestSlot(state, NO_SLOTS_TEXT, 'error')
          console.error('[free-call-booking] availability failed:', error)
        }
      }
    })
    return true
  }

  const api = {
    AVAILABILITY_PATH,
    BOOKING_PATH,
    CONFIGS_PATH,
    STARTER_PATH,
    XANO_BASE,
    authenticatedRequest,
    availabilityPath,
    canonicalBookingId,
    NO_SLOTS_TEXT,
    formatWithTimezone,
    getConfigs,
    getNearestSlot,
    getStarterByMemberId,
    installFreeBookingController,
    minimumBookingNoticeMinutes,
    nextSlotText,
  }

  if (isCommonJs) {
    module.exports = api
    return
  }
  global.StartersFreeCallBooking = Object.freeze(api)
})(typeof window !== 'undefined' ? window : globalThis)
