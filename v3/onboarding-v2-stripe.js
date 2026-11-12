/**
 * /starter-onboarding-v2 — Stripe step controller (gap G5, JP 2026-11-09).
 *
 * Jerico's v3/onboarding-stripe-view.js only renders. This module supplies
 * what that view needs from the existing, already-live Stripe Connect API
 * (api:KZf7nFnk, the same endpoints v3/starter-dashboard-stripe-connect.js uses):
 *
 *   1. On load: POST stripe_connect/status/v3 -> view state
 *        disconnected -> none, incomplete -> opened, review -> pending,
 *        ready -> ready. An unreadable status leaves the card as authored.
 *   2. [data-onboarding-stripe-action="start"]: reserve a blank tab in the
 *      click (popup blockers), POST stripe_connect/start/v3, send the tab to
 *      connect.stripe.com. The server allows only /starter-dashboard as
 *      return_url, so the Stripe tab ends on the dashboard; this tab learns the
 *      result from the callback page's BroadcastChannel message or the tab
 *      closing, then re-reads status a few times. Tab focus re-reads once and
 *      keeps watching; while watching, a 'none' read keeps the card 'opened'.
 *      A failed start sets data-onboarding-stripe-error="start" on every root.
 *   2b. Footer: started (not none) shows the authored Finish button and hides
 *      the primary start button; none shows start and hides Finish.
 *   3. Submit gate: a form that holds a Stripe root does not submit until
 *      StarterOnboardingStripeView.canContinue(root) is true (Stripe started
 *      and the confirmation checkbox ticked). Webflow's own required checks
 *      still run after this one.
 *
 * Edit route (Edit Profile v2, JP 2026-11-12): /starter-edit-profile-test
 * runs steps 1, 2 and 2b for the Calls tab Stripe card. Step 3 (the submit
 * gate) is onboarding-only: the Calls tab autosaves and has no confirm box.
 * Every render also fires 'starters:stripe-connect-state' on document with
 * detail {state} ('none' | 'opened' | 'pending' | 'ready'), so
 * v3/edit-profile-calls.js can re-check the Paid call. Nothing else listens.
 *
 * Boot: the same rule as the view — staging origin, or thestarters.com /
 * www.thestarters.com only when the page also loads v3/staff-preview-guard.js.
 * Load v3/onboarding-stripe-view.js before this file.
 */
;(function (global) {
  'use strict'

  const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  const TRADE_TOKEN_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh/auth/trade-token/v3'
  const STATUS_PATH = '/stripe_connect/status/v3'
  const START_PATH = '/stripe_connect/start/v3'
  const RETURN_CHANNEL_NAME = 'starters-stripe-connect-return'
  const EDIT_ROUTE = '/starter-edit-profile-test'
  const ROUTES = new Set(['/starter-onboarding-v2', EDIT_ROUTE])
  const STATE_EVENT = 'starters:stripe-connect-state'
  const ROOT = '[data-onboarding-stripe="root"]'
  const START = '[data-onboarding-stripe-action="start"]'
  const RETURN_POLL_DELAYS_MS = [0, 1500, 4000, 8000]
  const REQUEST_TIMEOUT_MS = 15000

  function bootAllowed(win) {
    const location = win.location
    if (!ROUTES.has(location.pathname.replace(/\/$/, ''))) return false
    if (location.origin === 'https://the-starters-3-0.webflow.io') return true
    if (location.origin !== 'https://www.thestarters.com' && location.origin !== 'https://thestarters.com') return false
    return Boolean(win.document && win.document.querySelector('script[src*="/v3/staff-preview-guard.js"]'))
  }

  function viewState(status) {
    if (!status || typeof status !== 'object' || typeof status.connected !== 'boolean') return null
    if (status.connected === false) return 'none'
    if (status.requires_onboarding === true) return 'opened'
    if (status.charges_enabled === true) return 'ready'
    return status.requires_onboarding === false ? 'pending' : 'opened'
  }

  function isStripeUrl(value) {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.hostname === 'connect.stripe.com'
    } catch (_error) {
      return false
    }
  }

  function createController(win, view) {
    let tokenPromise = null
    let busy = false
    let lastState = null
    let stopWatch = null
    const editRoute = String(win.location.pathname || '').replace(/\/$/, '') === EDIT_ROUTE

    function withTimeout(promise) {
      return new Promise(function (resolve, reject) {
        const timer = win.setTimeout(function () { reject(new Error('timeout')) }, REQUEST_TIMEOUT_MS)
        promise.then(
          function (value) { win.clearTimeout(timer); resolve(value) },
          function (error) { win.clearTimeout(timer); reject(error) },
        )
      })
    }

    async function trade() {
      const memberstack = win.$memberstackDom
      if (!memberstack || typeof memberstack.getMemberCookie !== 'function') throw new Error('memberstack-unavailable')
      const memberToken = await memberstack.getMemberCookie()
      if (!memberToken) throw new Error('logged-out')
      const response = await withTimeout(win.fetch(TRADE_TOKEN_URL + '?token=' + encodeURIComponent(memberToken)))
      const data = await response.json().catch(function () { return null })
      const token = typeof data === 'string' ? data : data && (data.authToken || data.token)
      if (!response.ok || !token) throw new Error('trade-failed')
      return token
    }

    function token() {
      if (!tokenPromise) tokenPromise = trade().catch(function (error) { tokenPromise = null; throw error })
      return tokenPromise
    }

    async function post(path, payload) {
      const response = await withTimeout(win.fetch(XANO_BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
        body: JSON.stringify(payload),
      }))
      if (response.status === 401) tokenPromise = null
      const data = await response.json().catch(function () { return null })
      if (!response.ok || !data || typeof data !== 'object') {
        throw Object.assign(new Error(path + ' failed (' + response.status + ')'), { status: response.status })
      }
      return data
    }

    function roots() {
      return Array.prototype.slice.call(win.document.querySelectorAll(ROOT))
    }

    function render(state) {
      if (!state) return
      if (stopWatch && state === 'none') return
      lastState = state
      roots().forEach(function (root) {
        view.render(root, state)
        swapFooter(root, state)
      })
      announce(state)
    }

    function announce(state) {
      const doc = win.document
      if (!doc || typeof doc.dispatchEvent !== 'function' || typeof win.CustomEvent !== 'function') return
      try {
        doc.dispatchEvent(new win.CustomEvent(STATE_EVENT, { detail: { state } }))
      } catch (_error) { /* listeners must not break the card */ }
    }

    // Footer swap (found in the 2026-11-09 prod click test): the authored
    // Finish button ([data-onboarding-stripe-element="finish"], hidden in the
    // markup) replaces the primary "Connect Stripe" start button once Stripe is
    // started. The retry link inside the card is not touched.
    function swapFooter(root, state) {
      const started = state !== 'none'
      root.querySelectorAll('[data-onboarding-stripe-element="finish"]').forEach(function (finish) {
        finish.hidden = !started
      })
      root.querySelectorAll(START).forEach(function (button) {
        if (button.closest('[data-onboarding-stripe-element="card"]')) return
        button.hidden = started
      })
    }

    async function refresh() {
      try {
        const state = viewState(await post(STATUS_PATH, {}))
        if (state && state !== 'none') setStartError(false)
        render(state)
      } catch (error) {
        log('status read failed', error && error.message)
      }
      return lastState
    }

    function wait(ms) {
      return new Promise(function (resolve) { win.setTimeout(resolve, ms) })
    }

    async function settleAfterReturn() {
      for (const delay of RETURN_POLL_DELAYS_MS) {
        if (delay) await wait(delay)
        const state = await refresh()
        if (state === 'ready' || state === 'pending') return state
      }
      return lastState
    }

    function watchReturn(stripeTab) {
      if (stopWatch) stopWatch()
      let channel = null
      let closedTimer = null
      const onFocus = function () { refresh() }
      const stop = function () {
        if (stopWatch !== stop) return
        stopWatch = null
        win.removeEventListener('focus', onFocus)
        if (closedTimer !== null) win.clearInterval(closedTimer)
        if (channel) { channel.onmessage = null; channel.close() }
      }
      const finish = function () {
        if (stopWatch !== stop) return
        stop()
        settleAfterReturn()
      }
      stopWatch = stop
      win.addEventListener('focus', onFocus)
      closedTimer = win.setInterval(function () { if (stripeTab.closed) finish() }, 1000)
      if (typeof win.BroadcastChannel === 'function') {
        try {
          channel = new win.BroadcastChannel(RETURN_CHANNEL_NAME)
          channel.onmessage = function (event) {
            if (event && event.data && event.data.type === 'connected') finish()
          }
        } catch (_error) {
          channel = null
        }
      }
    }

    function reserveTab() {
      if (typeof win.open !== 'function') return null
      const tab = win.open('about:blank', '_blank')
      if (!tab) return null
      try {
        tab.opener = null
      } catch (_error) {
        tab.close()
        return null
      }
      return tab
    }

    async function start(event) {
      event.preventDefault()
      if (busy) return false
      const stripeTab = reserveTab()
      if (!stripeTab) {
        startFailed('browser blocked the Stripe tab')
        return false
      }
      busy = true
      try {
        const origin = win.location.origin
        const result = await post(START_PATH, {
          return_url: origin + '/starter-dashboard',
          callback_url: origin + '/stripe-connect-callback',
          idempotency_key: (editRoute ? 'edit-profile-start-' : 'onboarding-v2-start-') + (win.crypto && win.crypto.randomUUID ? win.crypto.randomUUID() : Date.now().toString(36)),
        })
        if (result.mode === 'connected' || result.mode === 'reconciliation_required') {
          stripeTab.close()
          setStartError(false)
          await refresh()
          return true
        }
        if (!isStripeUrl(result.url)) throw new Error('start returned a non-Stripe URL')
        stripeTab.location.replace(result.url)
        setStartError(false)
        render('opened')
        watchReturn(stripeTab)
        return true
      } catch (error) {
        stripeTab.close()
        startFailed('start failed', error && error.message)
        return false
      } finally {
        busy = false
      }
    }

    function gateSubmit(event) {
      const form = event.target
      if (!form || typeof form.querySelector !== 'function') return
      const root = form.querySelector(ROOT)
      if (!root || view.canContinue(root)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      root.setAttribute('data-onboarding-stripe-required', 'true')
      const button = root.querySelector(START)
      if (button && typeof button.scrollIntoView === 'function') button.scrollIntoView({ block: 'center' })
    }

    function setStartError(on) {
      roots().forEach(function (root) {
        if (on) root.setAttribute('data-onboarding-stripe-error', 'start')
        else root.removeAttribute('data-onboarding-stripe-error')
      })
    }

    function startFailed() {
      setStartError(true)
      if (win.console) win.console.warn.apply(win.console, ['[onboarding-v2-stripe]'].concat(Array.prototype.slice.call(arguments)))
    }

    function log() {
      const host = win.location.hostname || ''
      if (!(win.STARTERS_DEBUG === true || /\.webflow\.io$/.test(host)) || !win.console) return
      win.console.log.apply(win.console, ['[onboarding-v2-stripe]'].concat(Array.prototype.slice.call(arguments)))
    }

    function mount() {
      win.document.querySelectorAll(START).forEach(function (button) {
        button.addEventListener('click', start)
      })
      if (!editRoute) win.document.addEventListener('submit', gateSubmit, true)
      return refresh()
    }

    return { mount, refresh, start, gateSubmit }
  }

  const api = { bootAllowed, viewState, isStripeUrl, createController, STATE_EVENT }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
    return
  }
  if (global.__startersOnboardingV2StripeBooted || !bootAllowed(global)) return
  global.__startersOnboardingV2StripeBooted = true

  function boot() {
    const view = global.StarterOnboardingStripeView
    if (!view) return
    createController(global, view).mount()
  }
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
})(typeof window === 'undefined' ? globalThis : window)
