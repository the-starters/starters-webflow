/**
 * Shared Google Calendar connect for Starter pages other than the dashboard
 * (JP 2026-11-09: Google sign-in returns to the page that started it).
 *
 * Pages: Build Profile step 6 (/build-profile/{consult,full-profile}(-test),
 * Jai 2026-11-12), /starter-onboarding-v2 (rollback only); Edit Profile later.
 * Each page path must be on the #1456/#1457 redirect allowlist. The dashboard keeps its own flow in scheduling-availability-section.js
 * and is not changed by this module.
 *
 *   start()   POST grants/oauth/v3 (#1456) with redirect_uri = this page
 *             (origin + path, no query). Stores a one-time intent for this
 *             member and page, then returns the Google URL. The caller opens
 *             it in a popup reserved in the click, so the first tab keeps its
 *             form state.
 *   return    Google sends the popup back to the same page with ?code&state.
 *             The params are taken off the URL at load. completeReturn()
 *             checks state == member and the stored intent (same member, same
 *             redirect_uri, max 15 min), then:
 *               1. reads the Starter row (hours + current grant),
 *               2. grants/delete/v3 (#1660) for the current grant, if any
 *                  (#1457 refuses to bind over an existing grant),
 *               3. grants/add/v3 (#1457) with the code and the same
 *                  redirect_uri,
 *               4. onboarding/calendar/ensure-default/v3 (#12047) with the same
 *                  hours and timezone: manager "calendar" for a Google grant, Free config.
 *             If 3 fails after 2, #12047 runs again to put the platform
 *             calendar back. If only 4 fails, it is tried once more and a
 *             success there counts as connected. A cancel at Google changes
 *             nothing.
 *             Result: BroadcastChannel 'starters-calendar-connect-return'
 *             {type: 'calendar-connected' | 'calendar-connect-failed',
 *             memberId}, then the popup closes (or says it can be closed).
 */
;(function (global) {
  'use strict'

  const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const SCHEDULING = XANO + '/api:tCpV3oqd'
  const INTENT_KEY = 'starters-google-connect-intent'
  const RETURN_CHANNEL = 'starters-calendar-connect-return'
  const INTENT_MAX_AGE_MS = 15 * 60 * 1000
  const CALLBACK_KEYS = ['code', 'state', 'grant_id', 'success', 'email', 'provider', 'error', 'error_code', 'error_description', 'error_uri']
  const OVERLAY_ID = 'starters-google-connect-return'
  const COPY = {
    working: 'Connecting your Google Calendar…',
    done: 'Google Calendar connected. You can close this tab.',
    failed: 'We couldn’t connect your Google Calendar. Close this tab and try again.',
  }

  // Taken once at load so the code never stays in the address bar or history.
  function captureCallback(win) {
    let params
    try { params = new URLSearchParams(win.location.search) } catch (_error) { return null }
    const code = params.get('code')
    // The live Nylas app uses hosted auth: Google comes back with grant_id +
    // success=true and no code (seen 2026-11-12). Accept both shapes, like the
    // dashboard (scheduling-availability-section.js).
    const grantId = params.get('grant_id')
    const hasError = Boolean(params.get('error') || params.get('error_code'))
    if (!code && !grantId && !hasError) return null
    const callback = {
      code: code || '',
      grantId: grantId || '',
      success: params.get('success') || '',
      state: params.get('state') || '',
      hasError,
    }
    CALLBACK_KEYS.forEach(function (key) { params.delete(key) })
    const rest = params.toString()
    try {
      win.history.replaceState(win.history.state, '', win.location.pathname + (rest ? '?' + rest : '') + (win.location.hash || ''))
    } catch (_error) { /* keep going: the code is single-use */ }
    return callback
  }

  function pageRedirectUri(win) {
    return win.location.origin + win.location.pathname.replace(/\/$/, '')
  }

  function createGoogleConnect(win, deps) {
    const post = deps.post
    const memberId = deps.memberId
    const callback = deps.callback === undefined ? captureCallback(win) : deps.callback

    function readIntent() {
      try {
        const raw = win.localStorage.getItem(INTENT_KEY)
        return raw ? JSON.parse(raw) : null
      } catch (_error) {
        return null
      }
    }

    function clearIntent() {
      try { win.localStorage.removeItem(INTENT_KEY) } catch (_error) { /* storage unavailable */ }
    }

    // options.offerIntroCall: the Free call choice on the page that started the
    // connection (Build Profile has a switch; onboarding always offers it).
    async function start(options) {
      const id = await memberId()
      const redirectUri = pageRedirectUri(win)
      const offerIntroCall = !(options && options.offerIntroCall === false)
      const data = await post('/grants/oauth/v3', { in_provider: 'google', in_redirect_uri: redirectUri })
      const url = data && data.response && data.response.result && data.response.result.data && data.response.result.data.url
      if (!url || !/^https:\/\//.test(url)) throw new Error('grants/oauth returned no URL')
      win.localStorage.setItem(INTENT_KEY, JSON.stringify({ memberId: id, redirectUri, offerIntroCall, createdAt: Date.now() }))
      return url
    }

    function returnPending() {
      return Boolean(callback)
    }

    async function completeReturn() {
      if (!callback) return null
      showOverlay('working')
      let id = null
      let deleted = false
      let added = false
      let defaults = null
      try {
        id = await memberId()
        const intent = readIntent()
        clearIntent()
        const age = intent ? Date.now() - intent.createdAt : -1
        if (!intent || intent.memberId !== id || intent.redirectUri !== pageRedirectUri(win) || !(age >= 0 && age <= INTENT_MAX_AGE_MS)) {
          throw new Error('return was not started on this page')
        }
        if (callback.state !== id) throw new Error('state does not match the member')
        if (callback.hasError || !(callback.code || callback.grantId)) throw new Error('cancelled at Google')
        if (!callback.code && callback.success !== 'true') throw new Error('hosted auth did not report success')

        const starter = await post('/starter/get_by_memberstack/v3', { member_id: id })
        defaults = {
          member_id: id,
          availability: { items: (starter && starter.availability && starter.availability.items) || {} },
          in_timezone: (starter && starter.timezone) || '',
          offer_intro_call: intent.offerIntroCall !== false,
        }
        if (!callback.code && starter && starter.nylas_grant_id === callback.grantId) {
          added = true
          await post('/onboarding/calendar/ensure-default/v3', defaults)
          return connected(id)
        }
        if (starter && starter.nylas_grant_id) {
          const removed = await post('/grants/delete/v3', { in_grant_id: starter.nylas_grant_id })
          if (!removed || removed.connected !== false) throw new Error('grants/delete returned no disconnected state')
          deleted = true
        }
        const grantPayload = {
          member_id: id,
          in_redirect_uri: intent.redirectUri,
          in_state: callback.state,
        }
        if (callback.code) grantPayload.code = callback.code
        else grantPayload.in_grant_id = callback.grantId
        const grant = await post('/grants/add/v3', grantPayload)
        if (!grant || !grant.grant_id) throw new Error('grants/add returned no grant')
        added = true
        await post('/onboarding/calendar/ensure-default/v3', defaults)
        return connected(id)
      } catch (error) {
        warn('google return failed', error && error.message)
        if (added) {
          try {
            await post('/onboarding/calendar/ensure-default/v3', defaults)
            return connected(id)
          } catch (retryError) {
            warn('google defaults retry failed', retryError && retryError.message)
          }
        } else if (deleted) {
          try {
            await post('/onboarding/calendar/ensure-default/v3', defaults)
          } catch (restoreError) {
            warn('platform restore failed', restoreError && restoreError.message)
          }
        }
        if (id) signal('calendar-connect-failed', id)
        showOverlay('failed')
        return false
      }
    }

    function connected(id) {
      signal('calendar-connected', id)
      showOverlay('done')
      closeSoon()
      return true
    }

    function signal(type, id) {
      if (typeof win.BroadcastChannel !== 'function') return
      try {
        const channel = new win.BroadcastChannel(RETURN_CHANNEL)
        channel.postMessage({ type, memberId: id })
        channel.close()
      } catch (_error) { /* the first tab also re-reads on focus */ }
    }

    function closeSoon() {
      win.setTimeout(function () {
        try { win.close() } catch (_error) { /* the message tells the Starter to close it */ }
      }, 1200)
    }

    function showOverlay(state) {
      const doc = win.document
      if (!doc || !doc.body) return
      doc.documentElement.setAttribute('data-google-connect-return', state)
      let overlay = doc.getElementById(OVERLAY_ID)
      if (!overlay) {
        overlay = doc.createElement('div')
        overlay.id = OVERLAY_ID
        overlay.setAttribute('role', 'status')
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#fff;color:#111;font:500 18px/1.4 system-ui,sans-serif;text-align:center'
        doc.body.appendChild(overlay)
      }
      overlay.textContent = COPY[state]
    }

    function warn() {
      if (win.console) win.console.warn.apply(win.console, ['[calendar-google-connect]'].concat(Array.prototype.slice.call(arguments)))
    }

    return { start, returnPending, completeReturn }
  }

  const exported = { captureCallback, pageRedirectUri, createGoogleConnect, RETURN_CHANNEL, INTENT_KEY }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported
    return
  }
  // Capture at load, before any other script can read or rewrite the URL.
  if (!global.StartersCalendarGoogleConnect) {
    exported.pendingCallback = captureCallback(global)
    global.StartersCalendarGoogleConnect = exported
  }
})(typeof window === 'undefined' ? globalThis : window)
