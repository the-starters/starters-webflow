/**
 * Privacy-safe outcome diagnostics for the coupled Build Profile writer.
 *
 * Elvin's inline writer remains the sole mutation owner. This controller only
 * observes the authored submit click plus authored success/error states. It
 * never reads fields, intercepts the click, or sends a request.
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
  var CONTROLLER_VERSION = 'build-profile-submit-diagnostics-v1'
  var HELPER_TIMEOUT_MS = 2000
  var controllerScript = document.currentScript
  var receipt = null
  var startedAt = 0
  var pendingStart = false
  var pendingOutcome = null

  function allowed() {
    var location = window.location || {}
    var pathname = location.pathname || '/'
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
    var hostAllowed =
      ALLOWED_HOSTS.indexOf(location.hostname) !== -1 ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(location.hostname || '')
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

  function complete(result, errorCode, target) {
    var api = window.StartersWorkflowDiagnostics
    if (!api || !receipt || receipt.result !== 'started') return receipt
    receipt = api.record(api.complete(receipt, {
      result: result,
      stage: result === 'success' ? 'complete' : 'request',
      error_code: errorCode || '',
      duration_ms: Date.now() - startedAt,
      request_started: true,
    }))
    if (target) {
      var textTarget = target.querySelector && target.querySelector(
        '[data-workflow-diagnostic-message], p, div',
      ) || target
      if (textTarget.__startersWorkflowDiagnosticBaseText === undefined) {
        textTarget.__startersWorkflowDiagnosticBaseText = textTarget.textContent || ''
      }
      textTarget.textContent = api.message(
        textTarget.__startersWorkflowDiagnosticBaseText,
        receipt,
      )
      api.decorate(textTarget, receipt)
    }
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
      complete(outcome.result, outcome.errorCode, outcome.target)
    }
  }

  function observeOutcome(result, errorCode, target) {
    pendingOutcome = { result: result, errorCode: errorCode, target: target }
    if (window.StartersWorkflowDiagnostics) {
      flushPending()
      return
    }
    Promise.resolve(helperReady).then(flushPending)
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

    trigger.addEventListener('click', function () {
      if (disabled(trigger)) return
      pendingStart = true
      if (window.StartersWorkflowDiagnostics) {
        flushPending()
        return
      }
      Promise.resolve(helperReady).then(flushPending)
    }, true)

    if (typeof MutationObserver === 'function') {
      var observer = new MutationObserver(function () {
        if (visible(success)) {
          observeOutcome('success', '', success)
          return
        }
        if (visible(error)) observeOutcome('failure', 'BUILD_PROFILE_SAVE_FAILED', error)
      })
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
        childList: true,
        subtree: true,
      })
      form.__startersBuildProfileSubmitDiagnosticsObserver = observer
    }
    return true
  }

  window.StartersBuildProfileSubmitDiagnostics = {
    disabled: disabled,
    init: init,
    visible: visible,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
