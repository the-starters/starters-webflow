/**
 * Starter setup gate (JP 2026-11-12, decision 1a).
 *
 * On /starter-dashboard, a Starter who is missing their availability/calendar
 * or Stripe sees the setup dialog every visit until both are done. The dialog
 * lists what is missing and sends them to Edit Profile v2 > Calls to fix it.
 * "Later" (any authored [data-modal-close]) closes it for this visit only.
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
 *     [data-setup-missing="availability"]   shown when hours/calendar are missing
 *     [data-setup-missing="stripe"]         shown when Stripe is not started
 *     a[data-setup-action="go"]             CTA; href is set to Edit Profile v2 > Calls
 *     [data-modal-close]                    "Later"
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

    function fill(dialog, missing) {
      for (const item of dialog.querySelectorAll('[data-setup-missing]')) {
        item.hidden = !missing.includes(item.getAttribute('data-setup-missing'))
      }
      for (const go of dialog.querySelectorAll('[data-setup-action="go"]')) {
        if (go.tagName === 'A') go.setAttribute('href', EDIT_PROFILE_CALLS)
      }
    }

    // Returns 'opened' | 'complete' | 'skipped:<reason>'.
    async function run() {
      const staff = win.StartersStaffPreview
      if (!staff || typeof staff.then !== 'function') return 'skipped:no-staff-flag'
      if ((await staff) !== true) return 'skipped:not-staff'
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
