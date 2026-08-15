/**
 * Privacy-safe outcome diagnostics for Build Profile.
 *
 * @release v1.59.250
 *
 * Elvin's inline writer remains the sole mutation owner. This controller only
 * observes the authored submit click plus authored success/error states. It
 * never reads fields, intercepts the click, or sends a request.
 *
 * Navigation after a successful submit belongs to the authored success-state
 * CTA ("Start onboarding") on both /build-profile/consult and
 * /build-profile/full-profile. This module never navigates. That is deliberate,
 * decided 2026-08-14: the member chooses when to leave the success state, so
 * this module only records outcomes.
 *
 * EVERYTHING IS KEYED ON THE SUBMIT CYCLE, NOT ON THE PIXELS. A click on
 * `[form-submit]` opens a cycle and captures the state visible AT THAT MOMENT as
 * the cycle's baseline, so a stale error left over from the previous attempt is
 * the starting point rather than an outcome. The observer only records while a
 * cycle is open, which is what stops a success state revealed without a tracked
 * click — a native or Enter-key submit that reveals `.w-form-done`, or another
 * script toggling the states — from being charged to this module or from
 * bricking it.
 *
 * A success outcome closes the cycle AND is terminal for the page: the observer
 * disconnects and later clicks are ignored, so a second click can never re-arm a
 * receipt and inherit the still-visible success state. Only a cycle that a click
 * actually opened may engage that latch. An error outcome closes the cycle but
 * keeps observing, because the member may fix the form and retry; the next click
 * opens a new cycle with a new baseline, so error → retry → the same error still
 * records the second failure.
 *
 * The missing-CTA warning below is staging-only (`*.webflow.io`, localhost,
 * 127.0.0.1, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`) and is
 * not computed at all in production. Receipts are a separate matter: the shared
 * utils/workflow-diagnostics.js helper logs them on every host, and this module
 * does not change that.
 */
;(function () {
  'use strict'

  if (window.__startersBuildProfileSubmitDiagnosticsBooted) return
  window.__startersBuildProfileSubmitDiagnosticsBooted = true

  var ALLOWED_HOSTS = [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ]
  var ALLOWED_PATHS = ['/build-profile/consult', '/build-profile/full-profile']
  var CONTROLLER_VERSION = 'build-profile-submit-outcome-v3'
  var RELEASE = 'v1.59.250'
  var HELPER_TIMEOUT_MS = 2000
  var ONBOARDING_CTA_PATH = '/starter-onboarding'
  var LOG_PREFIX = '[starters build-profile-submit]'
  var controllerScript = document.currentScript
  var receipt = null
  var startedAt = 0
  var observer = null

  // The flush queue: what is owed to the diagnostics helper once it exists.
  // Separate from the cycle below on purpose — this axis is helper readiness,
  // not submit progress, and the two move independently when the helper is late.
  var pendingStart = false
  var pendingOutcome = null

  // The open submit cycle, or null when no click is outstanding:
  //   { baseline: '' | 'success' | 'error', departed: boolean }
  // `baseline` is the state at click time and `departed` records whether the
  // page has since left it, which is what lets a retry that ends in the SAME
  // still-visible error still read as an outcome.
  var cycle = null

  // Set only when a click-opened cycle succeeded. Deliberately not derived from
  // `observer === null`: a browser without MutationObserver never installs one,
  // and that must not read as "this page is finished".
  var terminal = false

  function currentHost() {
    var current = window.location || {}
    return current.hostname || ''
  }

  function stagingHost(host) {
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in allowed(): it may turn logging on in
  // production, but it must never make the module run on an unapproved host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost(currentHost())
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function allowed() {
    var current = window.location || {}
    var pathname = current.pathname || '/'
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
    var host = current.hostname || ''
    var hostAllowed =
      ALLOWED_HOSTS.indexOf(host) !== -1 ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    return hostAllowed && ALLOWED_PATHS.indexOf(pathname) !== -1
  }

  function bounded(promise) {
    return new Promise(function (resolve) {
      var settled = false
      var finish = function (api) {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(api || null)
      }
      var timer = window.setTimeout(function () { finish(null) }, HELPER_TIMEOUT_MS)
      Promise.resolve(promise).then(finish, function () { finish(null) })
    })
  }

  function loadHelper() {
    if (window.StartersWorkflowDiagnostics) {
      return Promise.resolve(window.StartersWorkflowDiagnostics)
    }
    if (window.__startersWorkflowDiagnosticsReady) {
      return bounded(window.__startersWorkflowDiagnosticsReady)
    }
    var source = controllerScript && controllerScript.src
    if (!source || !document.createElement) return Promise.resolve(null)
    var url = ''
    try {
      var cdnRoot = source.match(
        /^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/,
      )
      url = cdnRoot
        ? cdnRoot[1] + 'utils/workflow-diagnostics.js'
        : new URL('../../utils/workflow-diagnostics.js', source).href
    } catch (error) {
      return Promise.resolve(null)
    }
    window.__startersWorkflowDiagnosticsReady = new Promise(function (resolve) {
      var script = document.createElement('script')
      var settled = false
      var finish = function (api) {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(api || null)
      }
      var timer = window.setTimeout(function () { finish(null) }, HELPER_TIMEOUT_MS)
      script.src = url
      script.async = false
      script.addEventListener('load', function () {
        finish(window.StartersWorkflowDiagnostics)
      }, { once: true })
      script.addEventListener('error', function () { finish(null) }, { once: true })
      ;(document.head || document.documentElement).appendChild(script)
    })
    return bounded(window.__startersWorkflowDiagnosticsReady)
  }

  var helperReady = loadHelper()

  function visible(element) {
    if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false
    if (element.style && element.style.display === 'none') return false
    if (typeof window.getComputedStyle === 'function') {
      var style = window.getComputedStyle(element)
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
    }
    return true
  }

  function disabled(trigger) {
    if (!trigger) return true
    if (trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') return true
    var wrapper = typeof trigger.closest === 'function' ? trigger.closest('[data-button-theme]') : null
    return Boolean(
      wrapper &&
      (
        wrapper.getAttribute('data-button-theme') === 'disabled' ||
        wrapper.getAttribute('data-form-flow-disabled') !== null ||
        wrapper.getAttribute('aria-disabled') === 'true'
      ),
    )
  }

  function start() {
    var api = window.StartersWorkflowDiagnostics
    if (!api) return null
    startedAt = Date.now()
    receipt = api.record(api.create({
      workflow: 'build_profile_submit',
      controller_version: CONTROLLER_VERSION,
      result: 'started',
      stage: 'native_writer',
      request_started: false,
      resource_type: 'talent_profile',
    }))
    return receipt
  }

  function complete(result, errorCode) {
    var api = window.StartersWorkflowDiagnostics
    if (!api || !receipt || receipt.result !== 'started') return receipt
    receipt = api.record(api.complete(receipt, {
      result: result,
      stage: result === 'success' ? 'complete' : 'request',
      error_code: errorCode || '',
      duration_ms: Date.now() - startedAt,
      request_started: true,
    }))
    return receipt
  }

  function flushPending() {
    if (pendingStart) {
      pendingStart = false
      start()
    }
    if (pendingOutcome) {
      var outcome = pendingOutcome
      pendingOutcome = null
      complete(outcome.result, outcome.errorCode)
    }
  }

  function flushWhenReady() {
    if (window.StartersWorkflowDiagnostics) {
      flushPending()
      return
    }
    Promise.resolve(helperReady).then(flushPending)
  }

  function teardown() {
    if (!observer) return
    observer.disconnect()
    observer = null
  }

  /**
   * Only ever reached from an open cycle, so every outcome here belongs to a
   * click this module tracked. Closing the cycle first means a repeat callback
   * for the same state finds nothing open and records nothing.
   */
  function observeOutcome(result, errorCode) {
    cycle = null
    if (result === 'success') {
      // Stop watching before the flush: no later mutation or click can be
      // attributed to a submit that already finished. An in-flight flush still
      // completes, because the flush queue is not gated on the cycle.
      terminal = true
      teardown()
    }
    pendingOutcome = { result: result, errorCode: errorCode }
    flushWhenReady()
  }

  /* ---------------------------- success-state CTA ---------------------------- */

  function normalizePath(pathname) {
    var path = pathname || '/'
    if (path.charAt(0) !== '/') path = '/' + path
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1)
    return path
  }

  function pageUrl() {
    var current = window.location || {}
    if (current.href) return current.href
    var origin = current.origin || (current.hostname ? 'https://' + current.hostname : '')
    if (!origin) return ''
    return origin + (current.pathname || '/')
  }

  /**
   * The href resolved against the page, or null when it is not a same-origin
   * http(s) destination. Resolution is left to `window.URL` rather than hand-rolled
   * string surgery so relative, root-relative, and protocol-relative hrefs all
   * land where the browser would actually send the member. An off-site absolute
   * URL is not a way forward through this funnel, so it does not satisfy the
   * check even when its path happens to match.
   */
  function resolvedCtaPath(href) {
    var base = pageUrl()
    if (!href || typeof window.URL !== 'function' || !base) return null
    var parsed = null
    var page = null
    try {
      parsed = new window.URL(href, base)
      page = new window.URL(base)
    } catch (error) {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.host !== page.host) return null
    return normalizePath(parsed.pathname)
  }

  function hasOnboardingCta(success) {
    if (!success || typeof success.querySelectorAll !== 'function') return false
    var links = success.querySelectorAll('a[href]') || []
    for (var index = 0; index < links.length; index += 1) {
      var link = links[index]
      var href = typeof link.getAttribute === 'function' ? link.getAttribute('href') : ''
      if (resolvedCtaPath(href) === ONBOARDING_CTA_PATH) return true
    }
    return false
  }

  function init() {
    if (!allowed()) return false
    var form = document.querySelector('[build-profile-form]')
    var trigger = form && form.querySelector('[form-submit]')
    var success = document.querySelector('[build-profile-success]')
    var error = document.querySelector('[build-profile-error]')
    if (!form || !trigger || !success || !error) return false
    if (form.getAttribute('data-build-profile-submit-diagnostics') === 'true') return true
    form.setAttribute('data-build-profile-submit-diagnostics', 'true')

    // The success-state CTA is the member's only way out of a finished submit
    // now, so a missing one is a dead end. Staging only, and gated before the
    // walk so production does not compute a result that warn() would discard.
    if (diagnosticsEnabled() && !hasOnboardingCta(success)) {
      warn(
        'the authored success state has no link to ' + ONBOARDING_CTA_PATH +
        '; a member who submits successfully has no way forward.',
      )
    }

    function currentState() {
      if (visible(success)) return 'success'
      if (visible(error)) return 'error'
      return ''
    }

    trigger.addEventListener('click', function () {
      if (terminal || disabled(trigger)) return
      // Open a cycle against what is on screen right now. A stale error from the
      // previous attempt becomes this cycle's baseline instead of its outcome.
      cycle = { baseline: currentState(), departed: false }
      // Nothing observed before this click may be charged to the receipt this
      // click is about to open. The cycle guard in the observer already makes a
      // pre-click reading impossible; this is the belt to that pair of braces,
      // and it also stops a previous cycle's queued outcome from landing on this
      // one when the helper has still not appeared. The cost of that second case
      // is losing the earlier outcome, which is the right trade: an unattributed
      // gap beats a receipt that blames the wrong submit.
      pendingOutcome = null
      pendingStart = true
      flushWhenReady()
    }, true)

    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(function () {
        // No open cycle means no click to attribute this to. Record nothing, and
        // stay connected: this page may still be submitted properly later.
        if (!cycle) return
        var state = currentState()
        // Still sitting on the state the cycle started from, and never left it.
        if (state === cycle.baseline && !cycle.departed) return
        if (state !== cycle.baseline) cycle.departed = true
        if (state === 'success') observeOutcome('success', '')
        else if (state === 'error') observeOutcome('failure', 'BUILD_PROFILE_SAVE_FAILED')
      })
      // Attributes only. The callback reads the visibility of two nodes it
      // already holds, so childList adds nothing — and with it every keystroke
      // in the bio editor, autocomplete, or a counter fired this callback.
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
        subtree: true,
      })
    }
    return true
  }

  window.StartersBuildProfileSubmitDiagnostics = {
    disabled: disabled,
    init: init,
    release: RELEASE,
    visible: visible,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
