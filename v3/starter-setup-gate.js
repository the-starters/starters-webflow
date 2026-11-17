/**
 * Starter setup gate (JP 2026-11-12 decision 1a; 2026-11-16 link-out per step).
 *
 * On /starter-dashboard, a Starter who is missing their availability/calendar
 * or Stripe sees the setup dialog every visit until both are done. The dialog
 * shows one screen per missing item, in order (availability, then Stripe):
 *   availability: the main button links to Edit Profile v2 > Calls
 *   stripe:       the main button closes the dialog and scrolls to the
 *                 dashboard Stripe card (Jai 2026-11-14: Stripe stays on the
 *                 dashboard)
 * "Skip for now" shows the next missing screen, or closes after the last one.
 * Any authored [data-modal-close] closes it for this visit only.
 *
 * /starter-dashboard#stripe (the Edit Profile v2 paid-call Stripe link, JP
 * 2026-11-17): the dialog stays closed; the page scrolls to the Stripe card
 * once it has loaded, and the hash is removed so a reload works as usual.
 *
 * Staff-only until launch: it runs only after the staff preview guard in FLAG
 * mode says "allowed" (window.StartersStaffPreview resolves true). The flag
 * guard never hides or redirects, so real Starters see nothing. Without the
 * flag guard on the page this module does nothing.
 *
 * Status: GET api:tCpV3oqd/starter/paid-call-settings/get/v3 -> readiness
 *   availability_configured + calendar_connected (any calendar) -> "availability"
 *   stripe_connect_linked                                         -> "stripe"
 * Google Calendar is optional and never opens the gate.
 *
 * Markup (Webflow, dashboard): the shared modal dialog
 *   <dialog class="modal_dialog" data-modal-target="starter-setup-required" data-setup-gate>
 *     [data-setup-step="availability"]      screen shown when hours/calendar are missing
 *       a[data-setup-action="go-calendar"]  href is set to Edit Profile v2 > Calls
 *     [data-setup-step="stripe"]            screen shown when Stripe is not started
 *       [data-setup-action="go-stripe"]     closes and scrolls to [data-stripe-connect-element="root"]
 *     [data-setup-action="skip"]            next missing screen, or close
 *     [data-modal-close]                    close for this visit
 *   Other [data-setup-step] screens (calendar, done) stay hidden.
 *   Legacy list markup still works: [data-setup-missing="..."] items and
 *   a[data-setup-action="go"] (href = Edit Profile v2 > Calls).
 * Wiring: v3/SETUP-GATE-WIRING.md.
 */
;(function (global) {
  'use strict'

  const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const TRADE_TOKEN_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
  const READINESS_URL = XANO + '/api:tCpV3oqd/starter/paid-call-settings/get/v3'
  const ROUTE = '/starter-dashboard'
  const MODAL_ID = 'starter-setup-required'
  const DIALOG = 'dialog[data-setup-gate][data-modal-target="' + MODAL_ID + '"]'
  const EDIT_PROFILE_CALLS = '/starter-edit-profile-test#calls'
  const STRIPE_CARD = '[data-stripe-connect-element="root"]'
  const STRIPE_START = '[data-stripe-connect-action="start"]'
  const STRIPE_LOADING = '[data-stripe-connect-element="loading"]'
  const STRIPE_HASH = '#stripe'
  // The shared modal fades out for 300 ms, holds the page scroll until then and
  // fires window "modal-close"; the timer only covers a missing event.
  const CLOSE_FALLBACK_MS = 1000
  const REQUEST_TIMEOUT_MS = 15000
  const MODAL_WAIT_MS = 10000

  function bootAllowed(win) {
    const location = win.location
    if (location.pathname.replace(/\/$/, '') !== ROUTE) return false
    return (
      location.origin === 'https://the-starters-3-0.webflow.io' ||
      location.origin === 'https://www.thestarters.com' ||
      location.origin === 'https://thestarters.com'
    )
  }

  // readiness -> list of missing items, in display order.
  function missingFrom(value) {
    const readiness = (value && value.readiness) || null
    if (!readiness) return null
    const missing = []
    if (readiness.availability_configured !== true || readiness.calendar_connected !== true) missing.push('availability')
    if (readiness.stripe_connect_linked !== true) missing.push('stripe')
    return missing
  }

  function createGate(win) {
    function withTimeout(promise) {
      return new Promise(function (resolve, reject) {
        const timer = win.setTimeout(function () { reject(new Error('timeout')) }, REQUEST_TIMEOUT_MS)
        promise.then(
          function (value) { win.clearTimeout(timer); resolve(value) },
          function (error) { win.clearTimeout(timer); reject(error) },
        )
      })
    }

    async function readReadiness() {
      const memberstack = win.$memberstackDom
      if (!memberstack || typeof memberstack.getMemberCookie !== 'function') return null
      const memberToken = await memberstack.getMemberCookie()
      if (!memberToken) return null
      const trade = await withTimeout(win.fetch(TRADE_TOKEN_URL + '?token=' + encodeURIComponent(memberToken)))
      const tradeData = await trade.json().catch(function () { return null })
      const token = typeof tradeData === 'string' ? tradeData : tradeData && (tradeData.authToken || tradeData.token)
      if (!trade.ok || !token) return null
      const response = await withTimeout(win.fetch(READINESS_URL, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      }))
      if (!response.ok) return null
      return response.json().catch(function () { return null })
    }

    function waitForModal() {
      const ready = function () {
        const system = win.lumos && win.lumos.modal
        return system && system.list && system.list[MODAL_ID] ? system : null
      }
      if (ready()) return Promise.resolve(ready())
      return new Promise(function (resolve) {
        let attempts = 0
        const timer = win.setInterval(function () {
          const system = ready()
          attempts++
          if (system || attempts >= MODAL_WAIT_MS / 100) {
            win.clearInterval(timer)
            resolve(system)
          }
        }, 100)
      })
    }

    function showStep(dialog, step) {
      for (const screen of dialog.querySelectorAll('[data-setup-step]')) {
        screen.hidden = screen.getAttribute('data-setup-step') !== step
      }
    }

    function fill(dialog, missing) {
      for (const item of dialog.querySelectorAll('[data-setup-missing]')) {
        item.hidden = !missing.includes(item.getAttribute('data-setup-missing'))
      }
      for (const go of dialog.querySelectorAll('[data-setup-action="go"], [data-setup-action="go-calendar"]')) {
        if (go.tagName === 'A') go.setAttribute('href', EDIT_PROFILE_CALLS)
      }
      showStep(dialog, missing[0])
    }

    function visible(element) {
      if (!element || element.hidden) return false
      return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0
    }

    // Native buttons and links, and anything with tabindex >= 0, can take keyboard focus.
    function focusable(element) {
      return Boolean(element) && typeof element.focus === 'function' && typeof element.tabIndex === 'number' && element.tabIndex >= 0
    }

    // Scroll to the dashboard Stripe card and focus its visible start control. The dashboard
    // start control is an authored div (live 2026-11-16) that cannot take focus; then focus the
    // card itself, made focusable by script only (tabindex -1 adds no Tab stop).
    function scrollToStripe() {
      const card = Array.prototype.find.call(win.document.querySelectorAll(STRIPE_CARD), visible)
      if (!card) return false
      if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const start = Array.prototype.find.call(card.querySelectorAll(STRIPE_START), visible)
      if (focusable(start)) {
        start.focus({ preventScroll: true })
      } else if (typeof card.focus === 'function') {
        if (card.getAttribute('tabindex') === null) card.setAttribute('tabindex', '-1')
        card.focus({ preventScroll: true })
      }
      return true
    }

    function close(system) {
      const entry = system.list && system.list[MODAL_ID]
      if (entry && typeof entry.close === 'function') entry.close()
    }

    function closeThenScroll(dialog, system) {
      let done = false
      let timer = null
      function onClose(event) {
        if (event && event.detail && event.detail.modal === dialog) finish()
      }
      function finish() {
        if (done) return
        done = true
        win.removeEventListener('modal-close', onClose)
        if (timer !== null) win.clearTimeout(timer)
        scrollToStripe()
      }
      win.addEventListener('modal-close', onClose)
      close(system)
      if (!done) timer = win.setTimeout(finish, CLOSE_FALLBACK_MS)
    }

    function bind(dialog, system, missing) {
      let index = 0
      if (dialog.__setupGateBound) return
      dialog.__setupGateBound = true
      dialog.addEventListener('click', function (event) {
        const target = event.target
        const action = target && typeof target.closest === 'function' ? target.closest('[data-setup-action]') : null
        if (!action) return
        const name = action.getAttribute('data-setup-action')
        if (name === 'go-stripe') {
          event.preventDefault()
          closeThenScroll(dialog, system)
        } else if (name === 'skip') {
          event.preventDefault()
          index++
          if (index < missing.length) showStep(dialog, missing[index])
          else close(system)
        }
      })
    }

    function dropHash() {
      const location = win.location
      const history = win.history
      if (!history || typeof history.replaceState !== 'function') return
      try { history.replaceState(history.state, '', location.pathname + (location.search || '')) } catch (_e) {}
    }

    // Wait until a visible Stripe card has finished loading its state, then scroll.
    // After MODAL_WAIT_MS it scrolls to whatever card is there.
    function scrollToStripeWhenReady() {
      const loaded = function () {
        const card = Array.prototype.find.call(win.document.querySelectorAll(STRIPE_CARD), visible)
        return Boolean(card) && !Array.prototype.some.call(card.querySelectorAll(STRIPE_LOADING), visible)
      }
      return new Promise(function (resolve) {
        if (loaded()) return resolve(scrollToStripe())
        let attempts = 0
        const timer = win.setInterval(function () {
          attempts++
          if (loaded() || attempts >= MODAL_WAIT_MS / 100) {
            win.clearInterval(timer)
            resolve(scrollToStripe())
          }
        }, 100)
      })
    }

    // Returns 'opened' | 'complete' | 'stripe-link' | 'skipped:<reason>'.
    async function run() {
      const staff = win.StartersStaffPreview
      if (!staff || typeof staff.then !== 'function') return 'skipped:no-staff-flag'
      if ((await staff) !== true) return 'skipped:not-staff'
      if (win.location.hash === STRIPE_HASH) {
        dropHash()
        await scrollToStripeWhenReady()
        return 'stripe-link'
      }
      const dialog = win.document.querySelector(DIALOG)
      if (!dialog) return 'skipped:no-dialog'
      let value = null
      try {
        value = await readReadiness()
      } catch (error) {
        warn('readiness read failed', error && error.message)
      }
      const missing = missingFrom(value)
      if (!missing) return 'skipped:no-readiness'
      if (!missing.length) return 'complete'
      const system = await waitForModal()
      if (!system) return 'skipped:no-modal-system'
      fill(dialog, missing)
      bind(dialog, system, missing)
      system.open(MODAL_ID)
      return 'opened'
    }

    function warn() {
      if (win.console) win.console.warn.apply(win.console, ['[starter-setup-gate]'].concat(Array.prototype.slice.call(arguments)))
    }

    return { run, missingFrom }
  }

  const exported = { bootAllowed, missingFrom, createGate, EDIT_PROFILE_CALLS, MODAL_ID }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported
    return
  }
  if (global.__startersSetupGateBooted || !bootAllowed(global)) return
  global.__startersSetupGateBooted = true
  function boot() { createGate(global).run() }
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
})(typeof window === 'undefined' ? globalThis : window)
