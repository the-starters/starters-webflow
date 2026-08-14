/**
 * Privacy-safe outcome diagnostics for Build Profile.
 *
 * @release v1.59.245
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
 * Because nothing navigates away any more, the module owns its own teardown.
 * The authored success state is terminal for the page: once it is observed the
 * observer disconnects and later submit clicks are ignored, so a second click
 * can never re-arm a receipt and inherit the still-visible success state. An
 * authored error is NOT terminal — the member may fix the form and retry, so
 * observation continues and a later success is recorded normally. Outcomes are
 * edge-triggered on a state change, so a stale visible error is never charged
 * to the retry that follows it.
 *
 * Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`); production is
 * silent.
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
  var RELEASE = 'v1.59.245'
  var HELPER_TIMEOUT_MS = 2000
  var ONBOARDING_CTA_PATH = '/starter-onboarding'
  var LOG_PREFIX = '[starters:build-profile-submit]'
  var controllerScript = document.currentScript
  var receipt = null
  var startedAt = 0
  var pendingStart = false
  var pendingOutcome = null
  var observer = null
  var lastState = ''
  var settled = false

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

  function observeOutcome(result, errorCode) {
    if (settled) return
    // The authored success state is terminal: stop watching before the flush so
    // no later mutation or click can be attributed to this finished submit. An
    // in-flight flush still completes, because only new cycles are latched out.
    if (result === 'success') {
      settled = true
      teardown()
    }
    pendingOutcome = { result: result, errorCode: errorCode }
    flushWhenReady()
  }

  function ctaPath(href) {
    var value = String(href || '').split('?')[0].split('#')[0]
    value = value.replace(/^https?:\/\/[^/]+/i, '')
    if (value.length > 1 && value.charAt(value.length - 1) === '/') value = value.slice(0, -1)
    return value
  }

  function hasOnboardingCta(success) {
    if (typeof success.querySelectorAll !== 'function') return false
    var links = success.querySelectorAll('a[href]') || []
    for (var index = 0; index < links.length; index += 1) {
      if (ctaPath(links[index].getAttribute('href')) === ONBOARDING_CTA_PATH) return true
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
    // now, so a missing one is a dead end. Warn on staging; never bail.
    if (!hasOnboardingCta(success)) {
      warn(
        'the authored success state has no link to ' + ONBOARDING_CTA_PATH +
        '; a member who submits successfully has no way forward.',
      )
    }

    trigger.addEventListener('click', function () {
      if (settled || disabled(trigger)) return
      pendingStart = true
      flushWhenReady()
    }, true)

    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(function () {
        var state = visible(success) ? 'success' : (visible(error) ? 'error' : '')
        if (state === lastState) return
        lastState = state
        if (state === 'success') observeOutcome('success', '')
        else if (state === 'error') observeOutcome('failure', 'BUILD_PROFILE_SAVE_FAILED')
      })
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
        childList: true,
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
