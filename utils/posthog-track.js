/**
 * posthog-track.js — shared funnel-event helper.
 *
 * Load site-wide with `defer` after the PostHog head snippet. Page scripts
 * call `StartersTrack.track(name, props)` instead of posthog.capture directly
 * so every event carries a consistent `platform` property ("v2" | "v3") and a
 * missing/blocked PostHog can never break page logic.
 *
 * Event names and properties are defined in
 * platform-ops/architecture/posthog-funnel-events-plan.md — additions are
 * fine, renames need a migration note there.
 */
(function () {
  'use strict'

  function platform() {
    if (window.STARTERS_PLATFORM) return String(window.STARTERS_PLATFORM)
    // Exact host match, NOT substring: v2 prod "hirethestarters.com" contains
    // the substring "thestarters.com", so a .includes() check mislabels all v2
    // prod traffic as v3. v3 = the 3.0 staging site or the thestarters.com prod
    // domain; everything else (hirethestarters.com, the-starters.webflow.io) = v2.
    const host = location.host
    if (host.includes('the-starters-3-0') || host === 'thestarters.com' || host === 'www.thestarters.com') {
      return 'v3'
    }
    return 'v2'
  }

  function track(name, props) {
    try {
      const posthog = window.posthog
      if (!posthog || typeof posthog.capture !== 'function') return
      posthog.capture(name, Object.assign({ platform: platform() }, props || {}))
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  // Frontend error tracking: forward uncaught errors + unhandled promise
  // rejections to PostHog (complements the server-side `bridge_error` event;
  // links to session replay). Wired once. posthog.captureException is stubbed
  // by the head snippet, so calls before array.js loads are queued, not lost.
  function wireErrorCapture() {
    if (window.__startersErrorsWired) return
    window.__startersErrorsWired = true
    const send = (err, extra) => {
      try {
        const posthog = window.posthog
        if (posthog && typeof posthog.captureException === 'function' && err) {
          posthog.captureException(err, Object.assign({ platform: platform() }, extra || {}))
        }
      } catch (e) {
        /* never break the page */
      }
    }
    const rejectionError = (reason) => {
      try {
        if (reason instanceof Error) return reason
        if (!reason || typeof reason !== 'object') return new Error(String(reason))

        // Keep only bounded diagnostic fields. Promise rejection objects can
        // contain request bodies, member data, or circular references.
        const fields = ['message', 'code', 'status']
        const details = fields.flatMap((key) => {
          const value = reason[key]
          if (!['string', 'number', 'boolean'].includes(typeof value)) return []
          return [`${key}=${String(value).slice(0, 200)}`]
        })
        const err = new Error(details.join(' ') || 'Unhandled rejection object')
        if (typeof reason.name === 'string' && reason.name.trim()) {
          err.name = reason.name.trim().slice(0, 80)
        }
        return err
      } catch (e) {
        return new Error('Unhandled rejection object')
      }
    }
    window.addEventListener('error', (e) => {
      // Cross-origin script failures reach the page as a bare "Script error."
      // with no error object and no source location — the browser strips the
      // detail. They name no script, so forwarding them only files issues that
      // point back at this listener. Drop the ones with nothing to triage.
      if (!e.error && !e.filename) return
      // window.onerror is an uncaught path, so mark it unhandled — captureException
      // otherwise records every call as handled. A DOMException such as
      // InvalidStateError is not an Error and carries no stack, so filename,
      // lineno, and colno on the event are the only record of which script broke;
      // forward them as properties because the error object cannot preserve them.
      const props = { handled: false, mechanism: 'onerror' }
      if (e.filename) props.filename = e.filename
      if (e.lineno) props.lineno = e.lineno
      if (e.colno) props.colno = e.colno
      send(e.error || new Error(e.message), props)
    })
    window.addEventListener('unhandledrejection', (e) =>
      send(rejectionError(e.reason), { handled: false, mechanism: 'onunhandledrejection' }),
    )
  }

  // Sitewide form tracking: delegated `submit` listener fires `form_submitted`
  // for EVERY form (native Webflow or custom), and for native Webflow forms a
  // per-submit observer watches the `.w-form` wrapper for Webflow's post-submit
  // reveal of `.w-form-done` / `.w-form-fail`, firing `form_succeeded` /
  // `form_failed`. No per-form wiring, and forms added later are covered
  // automatically. Custom bridge forms (no `.w-form-done/-fail`) emit only
  // `form_submitted` here; their own page scripts own success/failure events.
  function wireFormCapture() {
    if (window.__startersFormsWired) return
    window.__startersFormsWired = true

    const nameOf = (form) =>
      form.getAttribute('data-name') ||
      form.getAttribute('name') ||
      form.id ||
      form.getAttribute('aria-label') ||
      'unnamed'

    const meta = (form) => ({ form_name: nameOf(form), form_id: form.id || null, path: location.pathname })

    const isVisible = (el) => {
      if (!el) return false
      const cs = getComputedStyle(el)
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetParent !== null
    }

    function watchResult(form) {
      // Only native Webflow forms have a `.w-form` wrapper with its own
      // done/fail siblings. Without it (custom / bridge forms), do NOT fall back
      // to a broader ancestor — that would match ANOTHER form's `.w-form-fail`
      // and misfire. Those forms own their own result events.
      const wrap = form.closest('.w-form')
      if (!wrap) return
      const done = wrap.querySelector('.w-form-done')
      const fail = wrap.querySelector('.w-form-fail')
      if (!done && !fail) return
      let settled = false
      const finish = (name) => {
        if (settled) return
        settled = true
        try { obs.disconnect() } catch (e) {}
        clearTimeout(timer)
        track(name, meta(form))
      }
      const check = () => {
        if (isVisible(fail)) finish('form_failed')
        else if (isVisible(done)) finish('form_succeeded')
      }
      const obs = new MutationObserver(check)
      obs.observe(wrap, { attributes: true, attributeFilter: ['style', 'class'], subtree: true })
      const timer = setTimeout(() => { try { obs.disconnect() } catch (e) {} }, 20000)
      check() // in case Webflow resolved before the observer attached
    }

    document.addEventListener(
      'submit',
      (e) => {
        const form = e.target
        if (!form || form.tagName !== 'FORM') return
        try {
          track('form_submitted', meta(form))
          watchResult(form)
        } catch (err) {
          /* analytics must never break the page */
        }
      },
      true,
    )
  }

  window.StartersTrack = window.StartersTrack || { track }
  wireErrorCapture()
  wireFormCapture()
})()
