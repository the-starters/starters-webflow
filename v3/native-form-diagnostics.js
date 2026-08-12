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
  var controllerScript = document.currentScript
  var pendingAuthForm = null

  function observedFetch(url, method) {
    var value = String(url || '')
    try {
      var parsed = new URL(value, window.location && window.location.href || undefined)
      if (parsed.hostname !== 'x08a-5ko8-jj1r.n7c.xano.io') return null
      value = parsed.pathname + parsed.search
    } catch (error) {
      return null
    }
    var upperMethod = String(method || 'GET').toUpperCase()
    var rules = [
      [/\/api:KZf7nFnk\/build_profile\/starter\/profile_image(?:\?|$)/, 'POST', 'profile_photo_xano_upload', 'talent_profile_photo'],
      [/\/api:PmBJV0AG\/Create_portfolio(?:\?|$)/, 'POST', 'portfolio_record_create', 'talent_portfolio'],
      [/\/api:PmBJV0AG\/Update_portfolio(?:\/|\?|$)/, 'PATCH', 'portfolio_record_update', 'talent_portfolio'],
      [/\/api:PmBJV0AG\/Delete_portfolio(?:\/|\?|$)/, 'DELETE', 'portfolio_record_delete', 'talent_portfolio'],
      [/\/api:PmBJV0AG\/upload-image(?:\?|$)/, 'POST', 'portfolio_image_upload', 'talent_portfolio_media'],
      [/\/api:PmBJV0AG\/Add_portfolio_image(?:\?|$)/, 'POST', 'portfolio_image_attach', 'talent_portfolio_media'],
      [/\/api:PmBJV0AG\/upload-video(?:\?|$)/, 'POST', 'portfolio_video_upload', 'talent_portfolio_media'],
      [/\/api:PmBJV0AG\/Add_portfolio_video(?:\?|$)/, 'POST', 'portfolio_video_attach', 'talent_portfolio_media'],
      [/\/api:PmBJV0AG\/Delete_portfolio_image(?:\/|\?|$)/, 'DELETE', 'portfolio_image_delete', 'talent_portfolio_media'],
      [/\/api:PmBJV0AG\/Delete_portfolio_video(?:\/|\?|$)/, 'DELETE', 'portfolio_video_delete', 'talent_portfolio_media'],
      [/\/api:SYL06lUR\/companies(?:\?|$)/, 'POST', 'company_experience_create', 'talent_company_experience'],
      [/\/api:SYL06lUR\/companies\/[A-Za-z0-9_-]+(?:\?|$)/, 'PATCH', 'company_experience_update', 'talent_company_experience'],
      [/\/api:SYL06lUR\/companies\/[A-Za-z0-9_-]+(?:\?|$)/, 'DELETE', 'company_experience_delete', 'talent_company_experience'],
      [/\/api:KZf7nFnk\/starter\/set_also_worked_with(?:\?|$)/, 'POST', 'company_experience_associations', 'talent_company_experience'],
    ]
    for (var index = 0; index < rules.length; index += 1) {
      if (rules[index][1] === upperMethod && rules[index][0].test(value)) {
        return { workflow: rules[index][2], resourceType: rules[index][3] }
      }
    }
    return null
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

  function installFetchObserver() {
    if (typeof window.fetch !== 'function' || window.fetch.__startersProfileDiagnostics) {
      return false
    }
    var original = window.fetch
    var wrapped = function (input, init) {
      var method = init && init.method || input && input.method || 'GET'
      var observation = observedFetch(input && input.url || input, method)
      if (!observation) return original.apply(this, arguments)
      var diagnostic = observeFetchRequest(observation)
      var request
      try {
        request = original.apply(this, arguments)
      } catch (error) {
        diagnostic.complete({
          result: 'failure',
          stage: 'request',
          error_code: 'NETWORK_ERROR',
        })
        throw error
      }
      return Promise.resolve(request).then(function (response) {
        diagnostic.complete({
          result: response && response.ok ? 'success' : 'failure',
          stage: 'response',
          error_code: response && response.ok ? '' : 'HTTP_ERROR',
          http_status: response && response.status,
        })
        return response
      }, function (error) {
        diagnostic.complete({
          result: 'failure',
          stage: 'request',
          error_code: 'NETWORK_ERROR',
        })
        throw error
      })
    }
    wrapped.__startersProfileDiagnostics = true
    wrapped.__startersProfileDiagnosticsOriginal = original
    window.fetch = wrapped
    return true
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

  function completed(form, result, errorCode, target) {
    var api = window.StartersWorkflowDiagnostics
    if (!api || !form || !form.__startersMemberstackDiagnostic) return null
    if (
      form.__startersMemberstackDiagnostic.result === 'success' ||
      form.__startersMemberstackDiagnostic.result === 'failure'
    ) {
      return form.__startersMemberstackDiagnostic
    }
    var receipt = api.record(api.complete(form.__startersMemberstackDiagnostic, {
      result: result,
      stage: result === 'success' && /_membership_request$/.test(workflowFor(form))
        ? 'request_accepted'
        : result === 'success' ? 'complete' : 'native_form',
      error_code: errorCode || '',
      duration_ms: Date.now() - (form.__startersMemberstackDiagnosticStartedAt || Date.now()),
      request_started: true,
    }))
    form.__startersMemberstackDiagnostic = receipt
    if (target) {
      var textTarget = target.querySelector && target.querySelector(
        '[data-workflow-diagnostic-message], [data-ms-message-text], p, div',
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
    var fail = firstVisibleState(form, ['[data-ms-message="error"]', '.w-form-fail'])
    if (done) {
      completed(form, 'success', '', done)
      return
    }
    if (fail) {
      completed(
        form,
        'failure',
        /_membership_request$/.test(workflowFor(form))
          ? 'WEBFLOW_FORM_ERROR'
          : 'MEMBERSTACK_FORM_ERROR',
        fail,
      )
    }
  }

  function bindForm(form) {
    if (!form || form.__startersMemberstackDiagnosticsBound || !workflowFor(form)) return false
    form.__startersMemberstackDiagnosticsBound = true
    form.addEventListener('submit', function () {
      Promise.resolve(helperReady).then(function () {
        if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
          validationFailed(form)
          return
        }
        started(form)
        var kind = form.getAttribute('data-ms-form')
        if (kind === 'login' || kind === 'signup') pendingAuthForm = form
      })
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
      var observer = new MutationObserver(function () { checkStates(form) })
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
    installFetchObserver()
    var count = bindAll()
    watchAuth()
    return count
  }

  window.StartersNativeFormDiagnostics = {
    bindAll: bindAll,
    init: init,
    installFetchObserver: installFetchObserver,
    observedFetch: observedFetch,
    visible: visible,
    workflowFor: workflowFor,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
