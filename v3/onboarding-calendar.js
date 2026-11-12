/**
 * /starter-onboarding-v2 — calendar step controller (gaps G3 + G4, JP 2026-11-09).
 *
 * Jerico's v3/profile-calls-step.js renders and validates the hours editor
 * (onboarding context: hours + Google only). This module owns what it saves:
 *
 *   Next      Validates the hours, then POST api:tCpV3oqd/onboarding/calendar/
 *             ensure-default/v3 (#12047): platform calendar when no Google
 *             calendar is connected, the hours, and the Free scheduler config
 *             (same as the dashboard's own connect paths). Then the click goes
 *             through to the form flow.
 *   Google    "Connect Google" saves first, then sends a pop-up reserved in
 *             the click to Google through v3/calendar-google-connect.js. Google
 *             returns the pop-up to THIS page (JP 2026-11-09: sign-in returns
 *             where it started); the shared module finishes the connection
 *             there and posts on the BroadcastChannel below. This tab re-reads
 *             the calendar (also on focus and when the pop-up closes, one
 *             watcher per step). Load calendar-google-connect.js before this
 *             file.
 *
 * Hours format (Jai 2026-11-09: several windows in one day):
 *   window 1        -> items.general {days, start, end, defaultDays}
 *   window 2..n     -> items['window-<n>'] {days, start, end, defaultDays, kind: 'window'}
 *   additional days -> items['override-onboarding'] {days, start, end}
 * #1463 accepts separated windows on one weekday; the dashboard treats
 * kind 'window' items as added hours, not day overrides; a later dashboard day
 * override takes its days from them like from general.
 *
 * Contexts (one module, root marker decides):
 *   onboarding     /starter-onboarding-v2(-wip), Lumos form flow, Free call on.
 *   build-profile  /build-profile/{consult,full-profile}(-test) step with
 *                  [data-calls-step-context="build-profile"] (Jai 2026-11-12:
 *                  availability belongs in Build Profile). Next is the
 *                  multistep [data-form="next-btn"]; the Free call follows
 *                  its switch (editor.offerIntroCall()).
 *
 * Boot: staging origin, or thestarters.com / www.thestarters.com only when the
 * page also loads v3/staff-preview-guard.js. Load profile-calls-step.js first.
 */
;(function (global) {
  'use strict'

  const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  const TRADE_TOKEN_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
  const SCHEDULING = XANO + '/api:tCpV3oqd'
  const ENSURE_PATH = '/onboarding/calendar/ensure-default/v3'
  const STARTER_PATH = '/starter/get_by_memberstack/v3'
  const RETURN_CHANNEL = 'starters-calendar-connect-return'
  const ONBOARDING_ROUTES = new Set(['/starter-onboarding-v2', '/starter-onboarding-v2-wip'])
  // Build Profile step 6 (Jai 2026-11-12: availability belongs in Build Profile).
  const BUILD_PROFILE_ROUTES = new Set(['/build-profile/consult-test', '/build-profile/full-profile-test', '/build-profile/consult', '/build-profile/full-profile'])
  const ROUTES = new Set([...ONBOARDING_ROUTES, ...BUILD_PROFILE_ROUTES])
  // Build Profile roots need no marker (a new Data API attribute does not
  // publish; full-profile uses the shared component): any calls root with no
  // context or context "build-profile". profile-calls-step.js decides whether
  // it is really the Build Profile step (inside [data-form="step"]).
  const ROOT_BY_ROUTE = function (path) {
    return BUILD_PROFILE_ROUTES.has(path)
      ? '[data-calls-step="root"]:not([data-calls-step-context]), [data-calls-step="root"][data-calls-step-context="build-profile"]'
      : '[data-calls-step="root"][data-calls-step-context="onboarding"]'
  }
  const CONNECT = '[data-calls-step-action="connect-google"]'
  const REQUEST_TIMEOUT_MS = 20000
  const SAVE_ERROR = 'We couldn’t save your availability. Please try again.'
  const GOOGLE_ERROR = 'We couldn’t connect your Google Calendar. Please try again.'

  function bootAllowed(win) {
    const location = win.location
    if (!ROUTES.has(location.pathname.replace(/\/$/, ''))) return false
    if (location.origin === 'https://the-starters-3-0.webflow.io') return true
    if (location.origin !== 'https://www.thestarters.com' && location.origin !== 'https://thestarters.com') return false
    return Boolean(win.document && win.document.querySelector('script[src*="/v3/staff-preview-guard.js"]'))
  }

  // "9:00 AM" -> "09:00". Returns '' for anything else.
  function to24h(value) {
    const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(String(value || '').trim())
    if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) return ''
    const hour = (+match[1] % 12) + (match[3] === 'PM' ? 12 : 0)
    return String(hour).padStart(2, '0') + ':' + match[2]
  }

  function toItems(hours) {
    const days = hours.days.slice().sort(function (a, b) { return a - b })
    const items = {}
    hours.windows.forEach(function (window, index) {
      const item = { days: days.slice(), start: to24h(window.start), end: to24h(window.end), defaultDays: days.slice() }
      if (index === 0) {
        items.general = item
      } else {
        item.kind = 'window'
        items['window-' + (index + 1)] = item
      }
    })
    if (hours.extra && hours.extra.days.length) {
      items['override-onboarding'] = {
        days: hours.extra.days.slice().sort(function (a, b) { return a - b }),
        start: to24h(hours.extra.start),
        end: to24h(hours.extra.end),
      }
    }
    return items
  }

  function createController(win) {
    let tokenPromise = null
    let googleConnect = null

    function withTimeout(promise) {
      return new Promise(function (resolve, reject) {
        const timer = win.setTimeout(function () { reject(new Error('timeout')) }, REQUEST_TIMEOUT_MS)
        promise.then(
          function (value) { win.clearTimeout(timer); resolve(value) },
          function (error) { win.clearTimeout(timer); reject(error) },
        )
      })
    }

    async function memberId() {
      const member = await win.$memberstackDom.getCurrentMember()
      const id = member && member.data && member.data.id
      if (!id) throw new Error('logged-out')
      return id
    }

    async function trade() {
      const memberToken = await win.$memberstackDom.getMemberCookie()
      if (!memberToken) throw new Error('logged-out')
      const response = await withTimeout(win.fetch(TRADE_TOKEN_URL + '?token=' + encodeURIComponent(memberToken)))
      const data = await response.json().catch(function () { return null })
      const token = typeof data === 'string' ? data : data && (data.authToken || data.token)
      if (!response.ok || !token) throw new Error('trade-failed')
      return token
    }

    async function post(path, body) {
      if (!tokenPromise) tokenPromise = trade().catch(function (error) { tokenPromise = null; throw error })
      const response = await withTimeout(win.fetch(SCHEDULING + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await tokenPromise) },
        body: JSON.stringify(body),
      }))
      if (response.status === 401) tokenPromise = null
      const data = await response.json().catch(function () { return null })
      if (!response.ok) throw Object.assign(new Error(path + ' failed (' + response.status + ')'), { status: response.status, data })
      return data
    }

    function offerIntroCall(editor) {
      return typeof editor.offerIntroCall === 'function' ? editor.offerIntroCall() !== false : true
    }

    async function save(editor) {
      const hours = editor.read()
      return post(ENSURE_PATH, {
        member_id: await memberId(),
        availability: { items: toItems(hours) },
        in_timezone: hours.timezone || '',
        offer_intro_call: offerIntroCall(editor),
      })
    }

    async function refreshStatus(editor) {
      try {
        const starter = await post(STARTER_PATH, { member_id: await memberId() })
        const google = Boolean(starter && starter.availability && starter.availability.manager === 'calendar' && starter.nylas_grant_id)
        editor.setStatus({ calendar: google ? 'connected' : 'disconnected', email: google ? (starter.nylas_grant_email || '') : '' })
        return google
      } catch (error) {
        warn('calendar status read failed', error && error.message)
        return null
      }
    }

    function showError(root, message) {
      const error = root.querySelector('[data-calls-step-element="error"]')
      if (error) error.textContent = message
    }

    function isNextClick(event, stepEl) {
      const target = event.target
      if (!target || typeof target.closest !== 'function') return null
      // Build Profile multistep form: Next is [data-form="next-btn"] in the step.
      if (stepEl.getAttribute('data-form') === 'step') {
        const buildNext = target.closest('[data-form="next-btn"]')
        return buildNext && stepEl.contains(buildNext) ? buildNext : null
      }
      const group = target.closest('[data-form-flow-button-group]')
      if (!group || !stepEl.contains(group)) return null
      const explicit = target.closest('[data-form-flow-action]')
      if (explicit) return explicit.getAttribute('data-form-flow-action') === 'next' ? explicit : null
      const styled = target.closest('[data-button-style]')
      if (styled && styled.getAttribute('data-button-style') !== 'primary') return null
      return target.closest('button, a') || target
    }

    function wireStep(root, editor) {
      const stepEl = root.closest('[data-form-flow-element]') || root.closest('[data-form="step"]')
      if (!stepEl) return false
      let passThrough = false
      let busy = false
      let stopWatching = null

      stepEl.addEventListener('click', async function (event) {
        if (passThrough) return
        const nextEl = isNextClick(event, stepEl)
        if (!nextEl) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (busy) return
        const problem = editor.validate()
        if (problem) return showError(root, problem)
        busy = true
        try {
          await save(editor)
          editor.setStatus({ hoursSaved: true })
          passThrough = true
          try { nextEl.click() } finally { passThrough = false }
        } catch (error) {
          warn('save failed', error && error.message)
          showError(root, SAVE_ERROR)
        } finally {
          busy = false
        }
      }, true)

      root.querySelectorAll(CONNECT).forEach(function (connect) {
        connect.addEventListener('click', async function (event) {
          event.preventDefault()
          if (busy) return
          const problem = editor.validate()
          if (problem) return showError(root, problem)
          if (stopWatching) { stopWatching(); stopWatching = null }
          if (!googleConnect) return showError(root, SAVE_ERROR)
          const tab = typeof win.open === 'function' ? win.open('about:blank', 'starters-google-connect', 'popup,width=520,height=720') : null
          if (!tab) return showError(root, 'Allow pop-ups for this site, then try again.')
          try { tab.opener = null } catch (_error) { /* ignore */ }
          busy = true
          editor.setStatus({ calendar: 'connecting' })
          try {
            await save(editor)
            editor.setStatus({ hoursSaved: true })
            const id = await memberId()
            const url = await googleConnect.start({ offerIntroCall: offerIntroCall(editor) })
            tab.location.replace(url)
            stopWatching = watchReturn(tab, id, editor, root)
          } catch (error) {
            tab.close()
            editor.setStatus({ calendar: 'disconnected' })
            warn('connect google failed', error && error.message)
            showError(root, SAVE_ERROR)
          } finally {
            busy = false
          }
        })
      })
      return true
    }

    function watchReturn(tab, id, editor, root) {
      let channel = null
      let timer = null
      const stop = function () {
        win.removeEventListener('focus', onFocus)
        if (timer !== null) win.clearInterval(timer)
        if (channel) { channel.onmessage = null; channel.close(); channel = null }
      }
      const finish = async function () {
        const google = await refreshStatus(editor)
        if (google) stop()
        return google
      }
      const onFocus = function () { finish() }
      win.addEventListener('focus', onFocus)
      timer = win.setInterval(function () {
        if (tab.closed) {
          stop()
          refreshStatus(editor)
        }
      }, 1000)
      if (typeof win.BroadcastChannel === 'function') {
        try {
          channel = new win.BroadcastChannel(RETURN_CHANNEL)
          channel.onmessage = function (event) {
            const data = event && event.data
            if (!data || data.memberId !== id) return
            if (data.type === 'calendar-connected') finish()
            if (data.type === 'calendar-connect-failed') {
              stop()
              refreshStatus(editor)
              showError(root, GOOGLE_ERROR)
            }
          }
        } catch (_error) {
          channel = null
        }
      }
      return stop
    }

    function warn() {
      if (win.console) win.console.warn.apply(win.console, ['[onboarding-calendar]'].concat(Array.prototype.slice.call(arguments)))
    }

    function mount() {
      const shared = win.StartersCalendarGoogleConnect
      if (shared) {
        googleConnect = shared.createGoogleConnect(win, { post, memberId, callback: shared.pendingCallback || null })
        // This page is the pop-up Google sent back: finish the connection here.
        if (googleConnect.returnPending()) {
          googleConnect.completeReturn()
          return 0
        }
      }
      const api = win.StarterProfileCallsStep
      if (!api) return 0
      let count = 0
      win.document.querySelectorAll(ROOT_BY_ROUTE(win.location.pathname.replace(/\/$/, ''))).forEach(function (root) {
        const editor = api.editorFor(root)
        if (!editor) return
        if (wireStep(root, editor)) {
          count++
          refreshStatus(editor)
        }
      })
      return count
    }

    return { mount, save, refreshStatus, wireStep }
  }

  const exported = { bootAllowed, to24h, toItems, createController }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported
    return
  }
  if (global.__startersOnboardingCalendarBooted || !bootAllowed(global)) return
  global.__startersOnboardingCalendarBooted = true

  function boot() { createController(global).mount() }
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
})(typeof window === 'undefined' ? globalThis : window)
