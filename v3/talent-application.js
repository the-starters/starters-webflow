/**
 * V3 talent application intake (INITIATIVE-127).
 *
 * Install on /freelancer-application/step-1 only. Intercepts the multistep
 * apply form's final submit and POSTs it to the Xano intake endpoint
 * through a host-owned endpoint contract. Staging uses the TEST-only Xano
 * route; both custom production hosts use the production route, which owns the
 * authoritative application row and mirrors it into Airtable server-side.
 * Unknown hosts fail closed. The native Webflow submission is suppressed.
 *
 * Contract: binds to `form[application-form]` (the form's existing custom
 * attribute). Redirects to the form's data-redirect (step-2) on success.
 * A duplicate submission (same email, open application) is treated as
 * success — the applicant just continues the flow.
 */
;(function () {
  'use strict'

  if (window.__startersTalentApplicationBooted) return
  window.__startersTalentApplicationBooted = true

  var XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var ENDPOINTS = {
    'the-starters-3-0.webflow.io': XANO_BASE + '/talent/application/create-test',
    'thestarters.com': XANO_BASE + '/talent/application/create',
    'www.thestarters.com': XANO_BASE + '/talent/application/create',
  }
  var currentHostname = String(window.location.hostname || '')
    .toLowerCase()
    .replace(/\.$/, '')
  var ENDPOINT = ENDPOINTS[currentHostname] || null
  var FORM_SELECTOR = 'form[application-form]'
  var MULTISTEP_SUBMIT_SELECTOR =
    '[data-form="submit-btn"], [data-form-ms="submit-btn"]'
  var MARKETING_CONSENT_SELECTOR =
    'input[type="checkbox"][name="marketing-email-consent"]'
  var DEFAULT_REDIRECT = '/freelancer-application/step-2'
  var CONTROLLER_VERSION = 'talent-application-v3'
  var WORKFLOW = 'talent_application'
  var workflowDiagnosticsControllerScript = document.currentScript
  var WORKFLOW_DIAGNOSTICS_TIMEOUT_MS = 2000

  function boundedWorkflowDiagnostics(promise) {
    return new Promise(function (resolve) {
      var settled = false
      var finish = function (api) {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(api || null)
      }
      var timer = window.setTimeout(function () { finish(null) }, WORKFLOW_DIAGNOSTICS_TIMEOUT_MS)
      Promise.resolve(promise).then(finish, function () { finish(null) })
    })
  }

  function loadWorkflowDiagnostics() {
    if (window.StartersWorkflowDiagnostics) return Promise.resolve(window.StartersWorkflowDiagnostics)
    if (window.__startersWorkflowDiagnosticsReady) {
      return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady)
    }
    var source = workflowDiagnosticsControllerScript && workflowDiagnosticsControllerScript.src
    if (!source || !document.createElement) return Promise.resolve(null)
    var url = ''
    try {
      var cdnRoot = source.match(
        /^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/,
      )
      url = cdnRoot
        ? cdnRoot[1] + 'utils/workflow-diagnostics.js'
        : new URL('../utils/workflow-diagnostics.js', source).href
    } catch (_) {
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
      var timer = window.setTimeout(function () { finish(null) }, WORKFLOW_DIAGNOSTICS_TIMEOUT_MS)
      script.src = url
      script.async = false
      script.addEventListener('load', function () {
        finish(window.StartersWorkflowDiagnostics)
      }, { once: true })
      script.addEventListener('error', function () { finish(null) }, { once: true })
      ;(document.head || document.documentElement).appendChild(script)
    })
    return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady)
  }

  var workflowDiagnosticsReady = loadWorkflowDiagnostics()

  function diagnostics() {
    return window.StartersWorkflowDiagnostics || null
  }

  function diagnosticStart(form, fields) {
    var api = diagnostics()
    if (!api) return null
    var receipt = api.record(api.create(Object.assign({
      workflow: WORKFLOW,
      controller_version: CONTROLLER_VERSION,
      result: 'started',
      stage: 'request',
      request_started: true,
      resource_type: 'talent_application',
    }, fields || {})))
    if (form) form.__startersDiagnostic = receipt
    return receipt
  }

  function diagnosticComplete(form, fields) {
    var api = diagnostics()
    if (!api || !form || !form.__startersDiagnostic) return null
    var receipt = api.record(api.complete(form.__startersDiagnostic, fields || {}))
    form.__startersDiagnostic = receipt
    return receipt
  }

  // The country/state selects store numeric option indexes as values (their
  // options are built from a locations JSON); the human-readable name is the
  // option's text. Sending raw values reproduces the legacy "Country: 0" bug,
  // so resolve the selected option's text instead. City options use the city
  // name as the value, but resolving text is correct for it too.
  function selectText(form, name) {
    var el = form.querySelector('select[name="' + name + '"]')
    if (!el || !el.options || el.selectedIndex < 0) return ''
    var option = el.options[el.selectedIndex]
    if (!option || option.value === '') return ''
    return (option.textContent || option.text || '').trim()
  }

  function fieldMap(formData) {
    var raw = {}
    formData.forEach(function (value, key) {
      if (typeof value !== 'string') return
      if (raw[key] === undefined) raw[key] = value
      else raw[key] = String(raw[key]) + ', ' + value
    })

    var profileType = raw['profile-type'] || ''
    var isConsult = profileType === 'Consult Only'

    return {
      email: raw['email'] || '',
      first_name: raw['first-name'] || '',
      last_name: raw['last-name'] || '',
      phone: raw['phone'] || '',
      linkedin_url: raw['linkedin'] || '',
      profile_type: profileType,
      function_category: raw['function'] || '',
      // The form uses separate role/rate fields per profile type; the Zapier
      // era silently dropped the consult pair. Coalesce so review always sees
      // the pair that matches the chosen profile type.
      role_30: (isConsult ? raw['consult-option'] : raw['role-option']) || raw['role-option'] || raw['consult-option'] || '',
      rate: (isConsult ? raw['rate-consult'] : raw['rate']) || raw['rate'] || raw['rate-consult'] || '',
      referral_source: raw['referral-source'] || '',
      country: raw['country'] || '',
      city: raw['city'] || '',
      answers: raw,
    }
  }

  // Native checkbox contract for /freelancer-application/step-1. An unchecked
  // checkbox is omitted from FormData, so read the live control directly and
  // send an explicit Boolean. When the Designer field is not installed yet,
  // omit the value rather than fabricating consent or a refusal.
  function marketingEmailConsent(form) {
    var checkbox = form.querySelector(MARKETING_CONSENT_SELECTOR)
    if (!checkbox) return null
    return checkbox.checked === true
  }

  function showFail(form, receipt) {
    var wrapper = form.closest('.w-form') || form.parentElement
    var fail = wrapper ? wrapper.querySelector('.w-form-fail') : null
    if (!fail) return
    fail.style.display = 'block'
  }

  function setSubmitting(form, submitting) {
    var buttons = form.querySelectorAll('input[type="submit"], button[type="submit"]')
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = submitting
      if (buttons[i].dataset) {
        if (submitting && !buttons[i].dataset.originalValue && buttons[i].value) {
          buttons[i].dataset.originalValue = buttons[i].value
          if (buttons[i].dataset.wait) buttons[i].value = buttons[i].dataset.wait
        }
        if (!submitting && buttons[i].dataset.originalValue) {
          buttons[i].value = buttons[i].dataset.originalValue
        }
      }
    }
  }

  function isFieldVisible(el) {
    if (el.offsetParent !== null) return true
    if (typeof el.getClientRects === 'function') {
      var rects = el.getClientRects()
      return !!(rects && rects.length)
    }
    return true
  }

  function reportValidityForVisible(form) {
    if (!form.elements || typeof form.elements.length !== 'number') {
      if (form.checkValidity && !form.checkValidity()) {
        if (form.reportValidity) form.reportValidity()
        return false
      }
      return true
    }
    var firstInvalid = null
    for (var i = 0; i < form.elements.length; i++) {
      var el = form.elements[i]
      if (!el || typeof el.checkValidity !== 'function') continue
      if (el.willValidate === false) continue
      if (!isFieldVisible(el)) continue
      if (!el.checkValidity() && !firstInvalid) firstInvalid = el
    }
    if (firstInvalid) {
      if (firstInvalid.reportValidity) firstInvalid.reportValidity()
      return false
    }
    return true
  }

  function redirectTarget(form) {
    return (
      form.getAttribute('data-redirect') ||
      form.getAttribute('redirect') ||
      DEFAULT_REDIRECT
    )
  }

  function submitApplication(form, event) {
    if (!form || !form.matches || !form.matches(FORM_SELECTOR)) return

    // The multistep library normally owns its validation UI. Because its
    // synthetic jQuery submit bypasses native capture listeners, we intercept
    // its final click first; preserve native constraint validation before
    // taking ownership of that click. Only the visible controls are checked so
    // required-but-hidden Webflow fields (the non-selected consult/full pair,
    // inactive steps) cannot silently block Complete with an unshowable error.
    if (!reportValidityForVisible(form)) {
      var validationReceipt = diagnosticStart(form, {
        result: 'failed',
        stage: 'validation',
        request_started: false,
        error_code: 'NATIVE_VALIDATION',
      })
      if (validationReceipt) showFail(form, validationReceipt)
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    if (form.__startersSubmitting) return
    form.__startersSubmitting = true
    setSubmitting(form, true)
    var startedAt = Date.now()
    var responseStatus = null
    var failureCode = 'NETWORK_ERROR'
    var failureStage = 'network'
    var requestStarted = false

    var payload = fieldMap(new FormData(form))
    var consent = marketingEmailConsent(form)
    delete payload.answers['marketing-email-consent']
    if (consent !== null) payload.marketing_email_consent = consent
    var countryText = selectText(form, 'country')
    var cityText = selectText(form, 'city')
    var stateText = selectText(form, 'state')
    if (countryText) payload.country = countryText
    if (cityText) payload.city = cityText
    if (stateText) payload.answers.state = stateText
    if (countryText) payload.answers.country = countryText
    if (cityText) payload.answers.city = cityText

    var startRequest = function () {
      if (!ENDPOINT) {
        failureCode = 'ENVIRONMENT_UNRECOGNIZED'
        failureStage = 'environment'
        diagnosticStart(form, {
          stage: failureStage,
          request_started: requestStarted,
        })
        return Promise.reject(new Error('talent application host is not registered'))
      }
      diagnosticStart(form)
      requestStarted = true
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    var request = diagnostics() ? startRequest() : workflowDiagnosticsReady.then(startRequest)
    request
      .then(function (response) {
        responseStatus = response.status
        if (!response.ok) {
          failureCode = 'HTTP_ERROR'
          throw new Error('intake ' + response.status)
        }
        return response.json()
      })
      .then(function (result) {
        if (!result || result.id === undefined || result.id === null) {
          failureCode = 'INVALID_RESPONSE'
          throw new Error('intake returned no application id')
        }
        diagnosticComplete(form, {
          result: 'success',
          stage: 'response',
          http_status: responseStatus,
          duration_ms: Date.now() - startedAt,
          request_started: true,
          resource_id: result.id,
        })
        window.location.assign(redirectTarget(form))
      })
      .catch(function (error) {
        form.__startersSubmitting = false
        setSubmitting(form, false)
        var failureReceipt = diagnosticComplete(form, {
          result: 'failed',
          stage: responseStatus === null ? failureStage : 'response',
          error_code: failureCode,
          http_status: responseStatus,
          duration_ms: Date.now() - startedAt,
          request_started: requestStarted,
        })
        showFail(form, failureReceipt)
        if (window.console && console.warn) {
          console.warn('[talent-application] submit failed:', error)
        }
      })
  }

  function handleSubmit(event) {
    submitApplication(event.target, event)
  }

  function handleMultistepSubmitClick(event) {
    var target = event.target
    if (!target || !target.closest) return

    var submitControl = target.closest(MULTISTEP_SUBMIT_SELECTOR)
    if (!submitControl) return

    submitApplication(submitControl.closest(FORM_SELECTOR), event)
  }

  // Videsigns' multistep library calls jQuery's synthetic form.submit() from
  // its final click handler. Native addEventListener('submit') never sees that
  // synthetic event, so intercept the final control before the library can
  // fall through to Webflow's native form API. Keep the submit listener for
  // real native submits such as pressing Enter.
  document.addEventListener('click', handleMultistepSubmitClick, true)
  document.addEventListener('submit', handleSubmit, true)
})()
