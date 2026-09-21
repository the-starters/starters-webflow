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

  const WEBFLOW_CHUNK_RECOVERY_KEY = 'starters:webflow-chunk-recovery'
  const WEBFLOW_CHUNK_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000
  const WEBFLOW_CHUNK_RECOVERY_DELAY_MS = 250
  const WEBFLOW_CHUNK_RECOVERY_MAX_PAGES = 10
  const WEBFLOW_CHUNK_RECOVERY_MAX_PAGE_LENGTH = 200
  const WEBFLOW_CHUNK_RECOVERY_HOSTS = new Set([
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ])

  function safeString(value) {
    try {
      return typeof value === 'string' ? value : ''
    } catch (e) {
      return ''
    }
  }

  function isWebflowChunkFailure(event) {
    try {
      const error = event && event.error
      const name = safeString(error && error.name)
      const message = [
        safeString(error && error.message),
        safeString(event && event.message),
      ].join(' ')
      const isChunkFailure =
        name === 'ChunkLoadError' || /Loading chunk\s+\S+\s+failed/i.test(message)
      if (!isChunkFailure) return false

      const source = [
        safeString(error && error.request),
        safeString(error && error.stack),
        message,
        safeString(event && event.filename),
      ].join(' ')
      return /https?:\/\/cdn\.prod\.website-files\.com\/[^\s"'()]+\/js\/webflow\.[^\s"'()]+\.js/i.test(
        source,
      )
    } catch (e) {
      return false
    }
  }

  function claimWebflowChunkRecovery() {
    try {
      const page = (
        safeString(window.location && window.location.pathname) || '/'
      ).slice(0, WEBFLOW_CHUNK_RECOVERY_MAX_PAGE_LENGTH)
      const storage = window.sessionStorage
      if (!storage) return false

      const now = Date.now()
      // Each pathname carries its own cooldown, so recovering one page can
      // never re-arm another page's reload inside the five-minute window.
      let fresh = []
      try {
        const previous = JSON.parse(
          storage.getItem(WEBFLOW_CHUNK_RECOVERY_KEY),
        )
        if (Array.isArray(previous)) {
          for (const entry of previous) {
            if (!entry || typeof entry.page !== 'string') continue
            if (!Number.isFinite(entry.at)) continue
            if (now - entry.at >= WEBFLOW_CHUNK_RECOVERY_COOLDOWN_MS) continue
            if (entry.page === page) return false
            fresh.push({ page: entry.page, at: entry.at })
          }
        }
      } catch (e) {
        // Replace malformed local state with the bounded markers below.
        fresh = []
      }

      fresh.push({ page, at: now })
      storage.setItem(
        WEBFLOW_CHUNK_RECOVERY_KEY,
        JSON.stringify(fresh.slice(-WEBFLOW_CHUNK_RECOVERY_MAX_PAGES)),
      )
      return true
    } catch (e) {
      // Reloading without a durable loop guard is unsafe. Keep the original
      // error visible to PostHog and leave the page in its current state.
      return false
    }
  }

  function recoverWebflowChunkFailure(event) {
    const hostname = safeString(window.location && window.location.hostname)
    if (!WEBFLOW_CHUNK_RECOVERY_HOSTS.has(hostname)) return false
    if (!isWebflowChunkFailure(event) || !claimWebflowChunkRecovery()) return false

    window.setTimeout(() => {
      try {
        window.location.reload()
      } catch (e) {
        /* recovery must never replace the original error */
      }
    }, WEBFLOW_CHUNK_RECOVERY_DELAY_MS)
    return true
  }

  // Frontend error tracking: forward uncaught errors + unhandled promise
  // rejections to PostHog (complements the server-side `bridge_error` event;
  // links to session replay). Wired once. posthog.captureException is stubbed
  // by the head snippet, so calls before array.js loads are queued, not lost.
  function wireErrorCapture() {
    if (window.__startersErrorsWired) return
    window.__startersErrorsWired = true
    // captureException creates handled metadata before merging custom properties.
    // Correct only this forwarder's root exception at the public send boundary;
    // existing hooks still run afterward, including privacy filters and drops.
    const installed = new WeakSet()
    const queued = new WeakSet()
    const markUnhandled = (event) => {
      const props = event && event.properties
      const source = props && props.starters_error_source
      if (!event || event.event !== '$exception' || !['onuncaughtexception', 'onunhandledrejection'].includes(source)) return event
      const exceptions = props.$exception_list
      if (!Array.isArray(exceptions) || !exceptions[0]) return event
      return Object.assign({}, event, { properties: Object.assign({}, props, {
        $exception_list: [Object.assign({}, exceptions[0], {
          mechanism: Object.assign({}, exceptions[0].mechanism, { handled: false }),
        }), ...exceptions.slice(1)],
      }) })
    }
    const install = (posthog) => {
      if (!posthog || installed.has(posthog) || !posthog.config || typeof posthog.set_config !== 'function') return
      const previous = posthog.config.before_send
      const hooks = Array.isArray(previous) ? previous : previous ? [previous] : []
      posthog.set_config({ before_send: [markUnhandled, ...hooks] })
      installed.add(posthog)
    }
    const prepare = (posthog) => {
      install(posthog)
      if (!installed.has(posthog) && !queued.has(posthog) && typeof posthog.push === 'function') {
        queued.add(posthog)
        // The snippet queues this function before the capture call. The SDK
        // invokes it with the initialized instance as `this` when it loads.
        posthog.push(function () { install(this) })
      }
    }
    const send = (err, extra) => {
      try {
        const posthog = window.posthog
        if (posthog && typeof posthog.captureException === 'function' && err) {
          prepare(posthog)
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
      // If the error lacks a usable stack, the browser event may be the only
      // source location. Forward it separately without replacing the original error.
      const props = { starters_error_source: 'onuncaughtexception' }
      if (e.filename) props.filename = e.filename
      if (e.lineno) props.lineno = e.lineno
      if (e.colno) props.colno = e.colno
      send(e.error || new Error(e.message), props)
      recoverWebflowChunkFailure(e)
    })
    window.addEventListener('unhandledrejection', (e) => {
      send(rejectionError(e.reason), {
        starters_error_source: 'onunhandledrejection',
      })
      recoverWebflowChunkFailure({ error: e.reason })
    })
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
