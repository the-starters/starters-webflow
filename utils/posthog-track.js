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

  function field(object, key) {
    try {
      return object && object[key]
    } catch (e) {
      return undefined
    }
  }

  const REJECTION_TEXT_LIMIT = 200
  const REJECTION_NAME_LIMIT = 80
  const REJECTION_STACK_LIMIT = 16 * 1024
  const REJECTION_STACK_LINE_LIMIT = 1024
  const REJECTION_STACK_FRAME_LIMIT = 20

  function cleanUrl(value) {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) return ''
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      return url.href
    } catch (e) {
      return ''
    }
  }

  function diagnosticText(value, limit = REJECTION_TEXT_LIMIT) {
    return value.slice(0, REJECTION_STACK_LIMIT)
      .replace(/https?:\/\/[^\s)]+/g, url => cleanUrl(url) || '[invalid URL]')
      .replace(/\s+/g, ' ').trim().slice(0, limit)
  }

  // Accept browser source frames, not arbitrary text supplied on a rejection.
  // Rebuild copied stacks without their header, which can itself inject frames.
  function sourceFrames(stack) {
    if (typeof stack !== 'string' || stack.length > REJECTION_STACK_LIMIT) return []
    const frames = []
    for (const line of stack.split(/\r?\n/)) {
      if (line.length > REJECTION_STACK_LINE_LIMIT) continue
      const chrome = line.match(/^\s*at\s+(.+?)\s+\((https?:\/\/[^\s()]+?):(\d+)(?::(\d+))?\)\s*$/)
      const bare = line.match(/^\s*at\s+(https?:\/\/[^\s()]+?):(\d+)(?::(\d+))?\s*$/)
      const gecko = line.match(/^(.*?)@(https?:\/\/[^\s()]+?):(\d+)(?::(\d+))?\s*$/)
      const match = chrome || gecko || (bare && [bare[0], '?', ...bare.slice(1)])
      if (!match) continue
      const url = cleanUrl(match[2])
      const row = Number(match[3])
      const column = match[4] === undefined ? null : Number(match[4])
      if (!url || !Number.isSafeInteger(row) || row < 1 || (column !== null && (!Number.isSafeInteger(column) || column < 0))) continue
      const name = match[1].trim()
      const fn = /^[\w.$<>\[\] -]{1,80}$/.test(name) ? name : '?'
      frames.push(`    at ${fn} (${url}:${row}${column === null ? '' : `:${column}`})`)
      if (frames.length === REJECTION_STACK_FRAME_LIMIT) break
    }
    return frames
  }

  function originatingFrames(reason) {
    // The SDK reads Safari's stacktrace before stack. A malformed field must
    // not replace a useful source that is still available in the other field.
    const first = sourceFrames(field(reason, 'stacktrace'))
    return first.length ? first : sourceFrames(field(reason, 'stack'))
  }

  const CHUNK_FAILURE_VENDORS = [
    {
      vendor: 'webflow',
      host: 'cdn.prod.website-files.com',
      path: /^\/[\w-]+\/js\/webflow\.[\w.-]+\.js$/,
      fingerprint: 'starters-webflow-chunk-load',
    },
    {
      vendor: 'marker.io',
      host: 'edge.marker.io',
      path: /^\/(?:[\w-]+\/)*[\w.-]+\.js$/,
      fingerprint: 'starters-markerio-chunk-load',
    },
  ]

  function chunkVendor(request) {
    if (typeof request !== 'string' || request.length > 2048 || /[\s\\]/.test(request)) return null
    try {
      const url = new URL(request)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null
      return CHUNK_FAILURE_VENDORS.find(({ host, path }) => url.hostname === host && path.test(url.pathname)) || null
    } catch (e) {
      return null
    }
  }

  function chunkFailure(event) {
    try {
      const error = event && event.error
      const name = safeString(field(error, 'name'))
      const message = [
        safeString(field(error, 'message')),
        safeString(field(event, 'message')),
      ].join(' ')
      const isChunkFailure =
        name === 'ChunkLoadError' || /Loading chunk\s+\S+\s+failed/i.test(message)
      if (!isChunkFailure) return null
      // A present request is authoritative, including an invalid or unknown
      // request. Caller frames and filename identify the caller, not the asset.
      if (error && typeof error === 'object' && 'request' in error) return chunkVendor(error.request)
      if (message.length > REJECTION_STACK_LIMIT) return null
      const requests = new Set(Array.from(message.matchAll(/\((?:error|timeout|missing):\s*(https?:\/\/[^\s)]+)\s*\)/g), match => match[1]))
      return requests.size === 1 ? chunkVendor(requests.values().next().value) : null
    } catch (e) {
      return null
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

  function recoverWebflowChunkFailure(failure) {
    const hostname = safeString(window.location && window.location.hostname)
    if (!WEBFLOW_CHUNK_RECOVERY_HOSTS.has(hostname)) return false
    if (!failure || failure.vendor !== 'webflow' || !claimWebflowChunkRecovery()) return false

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
    const rejectionError = (reason, frames) => {
      try {
        if (reason instanceof Error) return reason
        if (!reason || typeof reason !== 'object') return new Error(String(reason))

        const message = field(reason, 'message')
        const err = new Error(typeof message === 'string'
          ? diagnosticText(message) || 'Unhandled rejection object'
          : 'Unhandled rejection object')
        const name = field(reason, 'name')
        if (typeof name === 'string' && name.trim()) {
          err.name = diagnosticText(name, REJECTION_NAME_LIMIT)
        }
        if (frames.length) err.stack = frames.join('\n')
        return err
      } catch (e) {
        return new Error('Unhandled rejection object')
      }
    }
    const rejectionDiagnostics = (reason) => {
      const props = {}
      try {
        if (!reason || typeof reason !== 'object' || reason instanceof Error) return props
        for (const key of ['code', 'status']) {
          const value = field(reason, key)
          if (typeof value === 'string') props[`starters_error_${key}`] = diagnosticText(value)
          else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
            props[`starters_error_${key}`] = value
          }
        }
      } catch (e) { /* hostile objects are still captured */ }
      return props
    }
    const NETWORK_FAILURE = /^(Load failed|Failed to fetch( \(.*\))?|NetworkError when attempting to fetch resource\.?|Network Error)$/
    const isNetworkFailure = (reason) => {
      if (typeof reason === 'string') return NETWORK_FAILURE.test(reason)
      if (!reason || typeof reason !== 'object') return false
      const message = field(reason, 'message')
      return field(reason, 'code') === 'network-error' ||
        (typeof message === 'string' && NETWORK_FAILURE.test(message))
    }
    const chunkProps = (failure) => failure ? {
      starters_error_kind: 'chunk-load',
      starters_chunk_vendor: failure.vendor,
      $exception_fingerprint: failure.fingerprint,
    } : {}
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
      const failure = chunkFailure(e)
      Object.assign(props, chunkProps(failure))
      send(e.error || new Error(e.message), props)
      recoverWebflowChunkFailure(failure)
    })
    window.addEventListener('unhandledrejection', (e) => {
      const reason = field(e, 'reason')
      const frames = originatingFrames(reason)
      const props = Object.assign({ starters_error_source: 'onunhandledrejection' }, rejectionDiagnostics(reason))
      if (isNetworkFailure(reason) && !frames.length) {
        props.starters_error_kind = 'network'
        props.$exception_fingerprint = 'starters-network-rejection'
      }
      const failure = chunkFailure({ error: reason })
      Object.assign(props, chunkProps(failure))
      send(rejectionError(reason, frames), props)
      recoverWebflowChunkFailure(failure)
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
