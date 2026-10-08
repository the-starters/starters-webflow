/**
 * Privacy-safe diagnostics for provider-owned native forms.
 *
 * This controller observes forms that Memberstack or Webflow already owns. It never
 * reads form values, prevents a submit, sends a request, or creates form HTML.
 * Existing Webflow success and error surfaces become copy targets for the
 * shared allowlisted workflow receipt.
 */
;(function () {
  'use strict'

  if (window.__startersNativeFormDiagnosticsBooted) return
  window.__startersNativeFormDiagnosticsBooted = true

  var ALLOWED_HOSTS = [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ]
  var FORM_SELECTOR = [
    'form[data-ms-form="login"]',
    'form[data-ms-form="signup"]',
    'form[data-ms-form="forgot-password"]',
    'form[data-ms-form="reset-password"]',
    'form#wf-form-Account-Profile',
    'form#wf-form-Pause-Membership',
    'form#wf-form-Cancel-Membership',
  ].join(',')
  var CONTROLLER_VERSION = 'native-form-diagnostics-v1'
  var HELPER_TIMEOUT_MS = 2000
  var MEMBERSTACK_WAIT_MS = 10000
  var OBSERVED_ATTRIBUTES = ['style', 'class', 'hidden', 'aria-hidden']
  var FAIL_SELECTORS = ['[data-ms-message="error"]', '.w-form-fail']
  var PROVIDER_SELECTOR = '[data-ms-auth-provider]'
  // Map the visible provider message to an allowlisted reason. Raw text is never sent.
  var ERROR_DETAILS = [
    [/credentials are invalid|invalid (email|password|credentials)|incorrect (email|password)/i, 'invalid_credentials'],
    [/login with your email|log in with (your )?email/i, 'use_email_login'],
    [/login with google|log in with google|continue with google/i, 'use_google_login'],
    [/too many|rate limit|try again later/i, 'rate_limited'],
    [/captcha|turnstile|verify (that )?you are human|\bbot\b/i, 'captcha'],
    [/network|connection|offline/i, 'network'],
  ]
  var controllerScript = document.currentScript
  var pendingAuthForm = null
  var providerClicksBound = false

  var MUTATION_WORKFLOWS = {
    profile_photo_xano_upload: 'talent_profile_photo',
    portfolio_record_create: 'talent_portfolio',
    portfolio_record_update: 'talent_portfolio',
    portfolio_record_delete: 'talent_portfolio',
    portfolio_image_upload: 'talent_portfolio_media',
    portfolio_image_attach: 'talent_portfolio_media',
    portfolio_video_upload: 'talent_portfolio_media',
    portfolio_video_attach: 'talent_portfolio_media',
    portfolio_image_delete: 'talent_portfolio_media',
    portfolio_video_delete: 'talent_portfolio_media',
    company_experience_create: 'talent_company_experience',
    company_experience_update: 'talent_company_experience',
    company_experience_delete: 'talent_company_experience',
    company_experience_associations: 'talent_company_experience',
  }

  function observeFetchRequest(observation) {
    var state = {
      completed: false,
      fields: null,
      receipt: null,
      startedAt: Date.now(),
    }
    var flush = function (api) {
      api = api || window.StartersWorkflowDiagnostics
      if (!api) return
      if (!state.receipt) {
        state.receipt = api.record(api.create({
          workflow: observation.workflow,
          controller_version: CONTROLLER_VERSION,
          result: 'started',
          stage: 'request',
          request_started: true,
          resource_type: observation.resourceType,
        }))
      }
      if (state.fields && !state.completed) {
        state.completed = true
        state.receipt = api.record(api.complete(state.receipt, Object.assign({}, state.fields, {
          duration_ms: Date.now() - state.startedAt,
          request_started: true,
        })))
      }
    }
    Promise.resolve(helperReady).then(flush)
    return {
      complete: function (fields) {
        state.fields = fields
        Promise.resolve(helperReady).then(flush)
      },
    }
  }

  function observeMutation(workflow, request) {
    var resourceType = MUTATION_WORKFLOWS[workflow]
    if (!resourceType || typeof request !== 'function') return request()
    var diagnostic = observeFetchRequest({ workflow: workflow, resourceType: resourceType })
    var response
      try {
        response = request()
      } catch (error) {
        diagnostic.complete({
          result: 'failure',
          stage: 'request',
          error_code: 'NETWORK_ERROR',
        })
        throw error
      }
      return Promise.resolve(response).then(function (result) {
        diagnostic.complete({
          result: result && result.ok ? 'success' : 'failure',
          stage: 'response',
          error_code: result && result.ok ? '' : 'HTTP_ERROR',
          http_status: result && result.status,
        })
        return result
      }, function (error) {
        diagnostic.complete({
          result: 'failure',
          stage: 'request',
          error_code: 'NETWORK_ERROR',
        })
        throw error
      })
  }

  function allowedHost(hostname) {
    return (
      ALLOWED_HOSTS.indexOf(hostname) !== -1 ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(hostname || '')
    )
  }

  function bounded(promise, timeoutMs) {
    return new Promise(function (resolve) {
      var settled = false
      var finish = function (value) {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(value || null)
      }
      var timer = window.setTimeout(function () { finish(null) }, timeoutMs)
      Promise.resolve(promise).then(finish, function () { finish(null) })
    })
  }

  function helperUrl() {
    var source = controllerScript && controllerScript.src
    if (!source) return ''
    try {
      var cdnRoot = source.match(
        /^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/,
      )
      return cdnRoot
        ? cdnRoot[1] + 'utils/workflow-diagnostics.js'
        : new URL('../utils/workflow-diagnostics.js', source).href
    } catch (error) {
      return ''
    }
  }

  function loadHelper() {
    if (window.StartersWorkflowDiagnostics) {
      return Promise.resolve(window.StartersWorkflowDiagnostics)
    }
    if (window.__startersWorkflowDiagnosticsReady) {
      return bounded(window.__startersWorkflowDiagnosticsReady, HELPER_TIMEOUT_MS)
    }
    var url = helperUrl()
    if (!url || !document.createElement) return Promise.resolve(null)
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
    return bounded(window.__startersWorkflowDiagnosticsReady, HELPER_TIMEOUT_MS)
  }

  var helperReady = loadHelper()
  var pendingForms = []

  function flushPendingForms() {
    var forms = pendingForms.slice()
    pendingForms = []
    forms.forEach(function (form) {
      if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
        validationFailed(form)
        return
      }
      started(form)
      var kind = form.getAttribute('data-ms-form')
      if (kind === 'login' || kind === 'signup') pendingAuthForm = form
      checkStates(form)
    })
  }

  function normalizedPath() {
    var pathname = (window.location && window.location.pathname) || '/'
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  }

  function workflowFor(form) {
    var kind = form && form.getAttribute('data-ms-form')
    var pathname = normalizedPath()
    if (kind === 'login') return pathname === '/starter-login' ? 'talent_login' : 'brand_login'
    if (kind === 'signup') return pathname === '/quiz' ? 'quiz_signup' : 'brand_signup'
    if (kind === 'forgot-password') return 'password_forgot'
    if (kind === 'reset-password') return 'password_reset'
    if (form && form.id === 'wf-form-Account-Profile') return 'account_profile'
    if (form && form.id === 'wf-form-Pause-Membership') return 'pause_membership_request'
    if (form && form.id === 'wf-form-Cancel-Membership') return 'cancel_membership_request'
    return ''
  }

  function resourceTypeFor(form) {
    var workflow = workflowFor(form)
    return /_membership_request$/.test(workflow) ? 'support_request' : 'member_account'
  }

  function wrapperFor(form) {
    return form && typeof form.closest === 'function' ? form.closest('.w-form') : null
  }

  function stateElement(form, selector) {
    var wrapper = wrapperFor(form)
    return wrapper && typeof wrapper.querySelector === 'function'
      ? wrapper.querySelector(selector)
      : null
  }

  function firstVisibleState(form, selectors) {
    for (var index = 0; index < selectors.length; index += 1) {
      var element = stateElement(form, selectors[index])
      if (visible(element)) return element
    }
    return null
  }

  function visible(element) {
    if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false
    if (element.style && element.style.display === 'none') return false
    if (typeof window.getComputedStyle === 'function') {
      var style = window.getComputedStyle(element)
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
    }
    return true
  }

  function started(form) {
    var api = window.StartersWorkflowDiagnostics
    var workflow = workflowFor(form)
    if (!api || !workflow) return null
    var receipt = api.record(api.create({
      workflow: workflow,
      controller_version: CONTROLLER_VERSION,
      result: 'started',
      stage: 'native_form',
      request_started: false,
      resource_type: resourceTypeFor(form),
    }))
    form.__startersMemberstackDiagnostic = receipt
    form.__startersMemberstackDiagnosticStartedAt = Date.now()
    return receipt
  }

  function errorDetail(element) {
    var textElement = element && typeof element.querySelector === 'function'
      ? element.querySelector('[data-ms-message-text]') || element
      : element
    var text = String((textElement && textElement.textContent) || '')
    for (var index = 0; index < ERROR_DETAILS.length; index += 1) {
      if (ERROR_DETAILS[index][0].test(text)) return ERROR_DETAILS[index][1]
    }
    return 'other'
  }

  function contains(parent, node) {
    return Boolean(parent && node && (parent === node ||
      (typeof parent.contains === 'function' && parent.contains(node))))
  }

  function completed(form, result, errorCode, target, extra) {
    var api = window.StartersWorkflowDiagnostics
    if (!api || !form || !form.__startersMemberstackDiagnostic) return null
    if (
      form.__startersMemberstackDiagnostic.result === 'success' ||
      form.__startersMemberstackDiagnostic.result === 'failure'
    ) {
      return form.__startersMemberstackDiagnostic
    }
    var receipt = api.record(api.complete(form.__startersMemberstackDiagnostic, Object.assign({
      result: result,
      stage: result === 'success' && /_membership_request$/.test(workflowFor(form))
        ? 'request_accepted'
        : result === 'success' ? 'complete' : 'native_form',
      error_code: errorCode || '',
      duration_ms: Date.now() - (form.__startersMemberstackDiagnosticStartedAt || Date.now()),
      request_started: true,
    }, extra || {})))
    form.__startersMemberstackDiagnostic = receipt
    return receipt
  }

  function validationFailed(form) {
    var api = window.StartersWorkflowDiagnostics
    if (!api) return null
    var receipt = started(form)
    if (!receipt) return null
    receipt = api.record(api.complete(receipt, {
      result: 'failure',
      stage: 'validation',
      error_code: 'FORM_VALIDATION',
      duration_ms: 0,
      request_started: false,
    }))
    form.__startersMemberstackDiagnostic = receipt
    return receipt
  }

  function checkStates(form) {
    var done = firstVisibleState(form, ['[data-ms-message="success"]', '.w-form-done'])
    var fail = firstVisibleState(form, FAIL_SELECTORS)
    if (done) {
      completed(form, 'success', '', done)
      return
    }
    // A banner left visible by the previous submit is not this submit's outcome.
    if (fail && fail !== form.__startersStaleError) {
      var webflow = /_membership_request$/.test(workflowFor(form))
      completed(
        form,
        'failure',
        webflow ? 'WEBFLOW_FORM_ERROR' : 'MEMBERSTACK_FORM_ERROR',
        fail,
        webflow ? null : { error_detail: errorDetail(fail) },
      )
    }
  }

  function clearStaleError(form, records) {
    var stale = form.__startersStaleError
    if (!stale) return
    if (!visible(stale)) {
      form.__startersStaleError = null
      return
    }
    Array.prototype.forEach.call(records || [], function (record) {
      if (contains(stale, record && record.target)) form.__startersStaleError = null
    })
  }

  function beginProviderDiagnostic(form) {
    form.__startersStaleError = firstVisibleState(form, FAIL_SELECTORS)
    Promise.resolve(helperReady).then(function () {
      started(form)
      if (form.getAttribute('data-ms-form') === 'login' || form.getAttribute('data-ms-form') === 'signup') {
        pendingAuthForm = form
      }
      checkStates(form)
    })
  }

  function formForProvider(control) {
    var wrapper = control && typeof control.closest === 'function'
      ? control.closest('.w-form')
      : null
    return wrapper && typeof wrapper.querySelector === 'function'
      ? wrapper.querySelector(FORM_SELECTOR)
      : null
  }

  function bindProviderClicks() {
    if (providerClicksBound || typeof window.addEventListener !== 'function') return
    providerClicksBound = true
    window.addEventListener('click', function (event) {
      var target = event && event.target
      var control = target && typeof target.closest === 'function'
        ? target.closest(PROVIDER_SELECTOR)
        : null
      var form = formForProvider(control)
      if (!form || !form.__startersMemberstackDiagnosticsBound) return
      beginProviderDiagnostic(form)
    }, true)
  }

  function bindForm(form) {
    if (!form || form.__startersMemberstackDiagnosticsBound || !workflowFor(form)) return false
    form.__startersMemberstackDiagnosticsBound = true
    form.addEventListener('submit', function () {
      form.__startersStaleError = firstVisibleState(form, FAIL_SELECTORS)
      if (pendingForms.indexOf(form) === -1) pendingForms.push(form)
      Promise.resolve(helperReady).then(flushPendingForms)
    }, true)
    form.addEventListener('invalid', function () {
      Promise.resolve(helperReady).then(function () {
        var current = form.__startersMemberstackDiagnostic
        if (!current || current.result !== 'failure' || current.stage !== 'validation') {
          validationFailed(form)
        }
      })
    }, true)

    var wrapper = wrapperFor(form)
    if (wrapper && typeof MutationObserver === 'function') {
      var observer = new MutationObserver(function (records) {
        clearStaleError(form, records)
        checkStates(form)
      })
      observer.observe(wrapper, {
        attributes: true,
        attributeFilter: OBSERVED_ATTRIBUTES,
        childList: true,
        subtree: true,
      })
      form.__startersMemberstackDiagnosticsObserver = observer
    }
    return true
  }

  function bindAll() {
    var forms = document.querySelectorAll(FORM_SELECTOR)
    var count = 0
    Array.prototype.forEach.call(forms || [], function (form) {
      if (bindForm(form)) count += 1
    })
    return count
  }

  function memberData(payload) {
    return payload && (payload.data || payload.member || payload)
  }

  function loggedIn(payload) {
    var member = memberData(payload)
    return Boolean(member && member.id)
  }

  // Role from the sitewide route guard, using only the member already on the page.
  function knownRole(member) {
    var guard = window.StartersV3RouteGuard
    try {
      return guard && typeof guard.memberRole === 'function' ? guard.memberRole(member) || '' : ''
    } catch (error) {
      return ''
    }
  }

  function watchAuth() {
    var startedAt = Date.now()
    var poll = function () {
      var memberstack = window.$memberstackDom
      if (!memberstack) {
        if (Date.now() - startedAt < MEMBERSTACK_WAIT_MS) window.setTimeout(poll, 250)
        return
      }
      if (typeof memberstack.onAuthChange !== 'function') return
      var seenLoggedOut = null
      Promise.resolve(
        typeof memberstack.getCurrentMember === 'function'
          ? memberstack.getCurrentMember()
          : null,
      ).then(function (current) {
        seenLoggedOut = !loggedIn(current)
      }, function () {
        seenLoggedOut = null
      })
      memberstack.onAuthChange(function (payload) {
        var isLoggedIn = loggedIn(payload)
        if (isLoggedIn && seenLoggedOut === true && pendingAuthForm) {
          completed(
            pendingAuthForm,
            'success',
            '',
            stateElement(pendingAuthForm, '.w-form-done'),
            { member_role: knownRole(memberData(payload)) },
          )
          pendingAuthForm = null
        }
        seenLoggedOut = isLoggedIn ? false : true
      })
    }
    poll()
  }

  function init() {
    if (!allowedHost((window.location && window.location.hostname) || '')) return 0
    bindProviderClicks()
    var count = bindAll()
    watchAuth()
    return count
  }

  window.StartersNativeFormDiagnostics = {
    bindAll: bindAll,
    init: init,
    observeMutation: observeMutation,
    visible: visible,
    workflowFor: workflowFor,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
