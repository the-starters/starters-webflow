;(function (global) {
  if (!new URLSearchParams(global.location.search).has('legacy-owner')) return
  const bookingSurfaceOwnership = getBookingSurfaceOwnership()
  global.StartersBookingSurfaceLifecycle = getBookingSurfaceLifecycle()
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
      register: function (popup, container, onReset, owner) {
        let binding = bindings.get(popup)
        if (!binding) {
          // `closePending` makes the reset idempotent per close cycle: one
          // reset per close no matter how many close-complete events the embed
          // emits, re-armed whenever the dialog is opened again or a call type
          // claims the surface.
          binding = { container, resets: new Map(), closePending: true }
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
        binding.resets.set(owner || onReset, onReset)
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

})(window)
