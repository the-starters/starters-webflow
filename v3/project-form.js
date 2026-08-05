/**
 * V3 Brand project / contract form adapter.
 *
 * Webflow owns the native form and every field. This module only:
 *   - binds an authored Brand "Generate Contract" form to the selected
 *     opportunity/application stable IDs;
 *   - serializes an explicit data-project-field allowlist into the published
 *     Xano projects/create/v3 contract;
 *   - supplies a retry-stable idempotency key and submits through Opp30's
 *     authenticated Memberstack -> Xano bridge;
 *   - projects safe pending/success/error state into authored elements.
 *
 * Xano remains authoritative for identity, ownership, project creation,
 * PandaDoc, lifecycle state, and duplicate prevention. This script never
 * creates form HTML and intentionally does not wire the Starter-only
 * "Start a Project" component: endpoint #1678 is Brand-only.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3ProjectFormBooted) return
  global.__startersV3ProjectFormBooted = true

  var FORM_SELECTOR = 'form[data-project-form-v3="brand"]'
  var OPEN_SELECTOR = '[data-project-form-open]'
  var FIELD_ATTR = 'data-project-field'
  var stateByForm = typeof WeakMap === 'function' ? new WeakMap() : null

  var ENGAGEMENT_TYPES = {
    'flat fee': 'flat_fee',
    flat_fee: 'flat_fee',
    'weekly recurring': 'weekly',
    weekly: 'weekly',
    'monthly recurring': 'monthly',
    monthly: 'monthly',
    'my own contract': 'own_contract',
    'your contract': 'own_contract',
    own_contract: 'own_contract',
  }

  var UNSUPPORTED_ENGAGEMENTS = {
    'hourly rate': true,
    hourly: true,
    'ongoing hourly': true,
    'on going hourly': true,
  }

  var NUMERIC_FIELDS = {
    total_cost: true,
    paid_upfront_pct: true,
    hourly_rate: true,
    weekly_rate: true,
    monthly_rate: true,
    estimated_hours: true,
    maximum_total_hours: true,
    number_of_weeks: true,
    number_of_months: true,
  }

  var INTEGER_FIELDS = {
    opportunity_id: true,
    application_id: true,
    number_of_weeks: true,
    number_of_months: true,
  }

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function positiveId(value) {
    var normalized = clean(value)
    return /^\d+$/.test(normalized) && Number(normalized) > 0 ? Number(normalized) : null
  }

  function numberValue(value) {
    var normalized = clean(value).replace(/[$,%\s]/g, '')
    if (!normalized) return null
    var parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  function dateValue(value) {
    var normalized = clean(value)
    if (!normalized) return ''
    var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
    if (iso) return normalized
    var us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(normalized)
    if (!us) return ''
    var month = Number(us[1])
    var day = Number(us[2])
    var year = Number(us[3])
    var candidate = new Date(Date.UTC(year, month - 1, day))
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) return ''
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  }

  function randomPart(cryptoObject) {
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return cryptoObject.randomUUID()
    if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
      var values = new Uint32Array(4)
      cryptoObject.getRandomValues(values)
      return Array.prototype.map.call(values, function (value) {
        return value.toString(16).padStart(8, '0')
      }).join('')
    }
    return String(Date.now()) + ':' + String(Math.random()).slice(2)
  }

  function createIdempotencyKey(applicationId, cryptoObject) {
    return 'project-ui:' + String(applicationId || 'unknown') + ':' + randomPart(cryptoObject)
  }

  function formField(form, name) {
    return form && form.querySelector
      ? form.querySelector('[' + FIELD_ATTR + '="' + name + '"]')
      : null
  }

  function setField(form, name, value) {
    var field = formField(form, name)
    if (!field) return false
    var normalized = value == null ? '' : String(value)
    field.value = normalized
    if (field.setAttribute) field.setAttribute('value', normalized)
    return true
  }

  function fieldValue(field) {
    if (!field || field.disabled) return ''
    var type = clean(field.type).toLowerCase()
    if ((type === 'checkbox' || type === 'radio') && !field.checked) return ''
    return clean(field.value)
  }

  function canonicalEngagement(value) {
    var normalized = clean(value).toLowerCase()
    if (UNSUPPORTED_ENGAGEMENTS[normalized]) return { value: '', unsupported: true }
    return { value: ENGAGEMENT_TYPES[normalized] || '', unsupported: false }
  }

  function serialize(form) {
    var payload = {}
    var fields = form && form.querySelectorAll
      ? form.querySelectorAll('[' + FIELD_ATTR + ']')
      : []
    Array.prototype.forEach.call(fields, function (field) {
      var name = clean(field.getAttribute && field.getAttribute(FIELD_ATTR))
      if (!name || Object.prototype.hasOwnProperty.call(payload, name)) return
      var value = fieldValue(field)
      if (INTEGER_FIELDS[name]) {
        payload[name] = positiveId(value)
      } else if (NUMERIC_FIELDS[name]) {
        var numeric = numberValue(value)
        payload[name] = name === 'number_of_weeks' || name === 'number_of_months'
          ? (numeric == null ? null : Math.trunc(numeric))
          : numeric
      } else if (name === 'start_date' || name === 'estimated_end_date') {
        payload[name] = dateValue(value) || null
      } else {
        payload[name] = value
      }
    })

    var engagement = canonicalEngagement(payload.engagement_type)
    var contractChoice = form && form.querySelector
      ? form.querySelector('[data-project-contract-choice]:checked')
      : null
    if (contractChoice && canonicalEngagement(fieldValue(contractChoice)).value === 'own_contract') {
      engagement = { value: 'own_contract', unsupported: false }
    }
    payload.engagement_type = engagement.value
    // The worker's template selector intentionally matches the approved
    // engagement enum. Derive it here so authored markup cannot pair a weekly
    // price model with a flat-fee PandaDoc template.
    payload.pandadoc_template_key = engagement.value
    return { payload: payload, unsupportedEngagement: engagement.unsupported }
  }

  function validationError(serialized) {
    var payload = serialized.payload
    if (!payload.opportunity_id || !payload.application_id) return 'Select an eligible applicant before starting the project.'
    if (serialized.unsupportedEngagement) return 'Hourly project contracts are not supported by the V3 project workflow yet.'
    if (!payload.engagement_type) return 'Choose a supported fee structure.'
    if (!clean(payload.title)) return 'Enter a project name.'
    if (!clean(payload.service)) return 'Choose a service.'
    if (!payload.start_date) return 'Enter a valid start date.'
    if (!clean(payload.project_scope)) return 'Add the project scope.'
    if (payload.engagement_type === 'flat_fee' && !(payload.total_cost > 0)) return 'Enter a total project cost.'
    if (payload.engagement_type === 'weekly' && !(payload.weekly_rate > 0)) return 'Enter a weekly rate.'
    if (payload.engagement_type === 'monthly' && !(payload.monthly_rate > 0)) return 'Enter a monthly rate.'
    if (payload.paid_upfront_pct != null && (payload.paid_upfront_pct < 0 || payload.paid_upfront_pct > 100)) {
      return 'Paid upfront must be between 0% and 100%.'
    }
    return ''
  }

  function state(form) {
    if (!stateByForm) {
      form.__projectFormV3State = form.__projectFormV3State || { active: null, key: '' }
      return form.__projectFormV3State
    }
    var current = stateByForm.get(form)
    if (!current) {
      current = { active: null, key: '' }
      stateByForm.set(form, current)
    }
    return current
  }

  function setStatus(form, status, message) {
    form.setAttribute('data-project-form-status', status)
    form.setAttribute('aria-busy', status === 'submitting' ? 'true' : 'false')
    var error = form.querySelector('[data-project-form-state="error"]')
    if (error) {
      error.textContent = status === 'error' ? message : ''
      error.hidden = status !== 'error'
      if (error.setAttribute) error.setAttribute('role', 'alert')
    }
    var submitters = form.querySelectorAll('[type="submit"], [data-project-submit]')
    Array.prototype.forEach.call(submitters, function (button) {
      button.disabled = status === 'submitting'
      button.setAttribute('aria-disabled', status === 'submitting' ? 'true' : 'false')
    })
  }

  function safeError(error) {
    var status = error && Number(error.status)
    if (status === 401) return 'Your session expired. Sign in again and retry.'
    if (status === 403) return 'This project is not available for your Brand account.'
    if (status === 409) return 'This application already has a project request.'
    if (status === 400 || status === 422) return 'Review the project details and try again.'
    return 'The project could not be created. Please retry.'
  }

  function selectedContext(trigger, documentObject) {
    var card = trigger && trigger.closest
      ? trigger.closest('[data-wf-xano-id], [data-app-id], [data-project-application-id]')
      : null
    var page = documentObject && documentObject.documentElement
    var pageOpportunity = documentObject && documentObject.querySelector
      ? documentObject.querySelector('[data-opp-page-id]')
      : null
    var applicationId = positiveId(
      trigger && trigger.getAttribute('data-project-application-id') ||
      card && (card.getAttribute('data-project-application-id') || card.getAttribute('data-wf-xano-id') || card.getAttribute('data-app-id')),
    )
    var opportunityId = positiveId(
      trigger && trigger.getAttribute('data-project-opportunity-id') ||
      card && card.getAttribute('data-project-opportunity-id') ||
      pageOpportunity && pageOpportunity.getAttribute('data-opp-page-id') ||
      page && (page.getAttribute('data-opp30-opportunity-id') || page.getAttribute('data-opp-id')),
    )
    return { opportunityId: opportunityId, applicationId: applicationId }
  }

  function formForTrigger(trigger, documentObject) {
    var target = clean(trigger && trigger.getAttribute('data-project-form-target'))
    if (target && documentObject.querySelector) {
      try {
        var explicit = documentObject.querySelector(target)
        if (explicit && explicit.matches && explicit.matches(FORM_SELECTOR)) return explicit
      } catch (_) {}
    }
    return documentObject.querySelector(FORM_SELECTOR)
  }

  function bindTrigger(trigger, documentObject) {
    var form = formForTrigger(trigger, documentObject)
    if (!form) return false
    form.style.display = ''
    var wrapper = form.closest && (form.closest('.w-form') || form.closest('[data-modal-target]'))
    var priorSuccess = wrapper && wrapper.querySelector('.generate-contract_success, [data-project-form-state="success"]')
    if (priorSuccess) {
      priorSuccess.hidden = true
      priorSuccess.style.display = 'none'
    }
    var context = selectedContext(trigger, documentObject)
    if (!context.opportunityId || !context.applicationId) {
      setStatus(form, 'error', 'Select an eligible applicant before starting the project.')
      return false
    }
    setField(form, 'opportunity_id', context.opportunityId)
    setField(form, 'application_id', context.applicationId)
    setField(form, 'idempotency_key', '')
    state(form).key = ''
    setStatus(form, 'ready', '')
    return true
  }

  function projectApi(globalObject) {
    var api = globalObject && globalObject.Opp30 && globalObject.Opp30.API
    return api && typeof api.projectCreate === 'function' ? api.projectCreate : null
  }

  function showSuccess(form, result, documentObject) {
    setStatus(form, 'success', '')
    var wrapper = form.closest && (form.closest('.w-form') || form.closest('[data-modal-target]'))
    var success = wrapper && wrapper.querySelector('.generate-contract_success, [data-project-form-state="success"]')
    if (success) {
      success.hidden = false
      success.style.display = 'block'
      form.style.display = 'none'
    }
    var project = result && result.project
    var projectId = positiveId(project && project.id)
    if (typeof global.CustomEvent === 'function' && documentObject && documentObject.dispatchEvent) {
      documentObject.dispatchEvent(new global.CustomEvent('starters:project-created', {
        detail: { project_id: projectId, replayed: Boolean(result && result.replayed) },
      }))
    }
    if (global.StartersTrack && typeof global.StartersTrack.track === 'function') {
      global.StartersTrack.track('project_created', { project_id: projectId })
    }
  }

  function submit(form, globalObject, documentObject) {
    var formState = state(form)
    if (formState.active) return formState.active
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return Promise.resolve(false)

    var serialized = serialize(form)
    var error = validationError(serialized)
    if (error) {
      setStatus(form, 'error', error)
      return Promise.resolve(false)
    }

    var keyField = formField(form, 'idempotency_key')
    if (!keyField) {
      setStatus(form, 'error', 'The project form is missing its idempotency field.')
      return Promise.resolve(false)
    }
    if (!formState.key) formState.key = createIdempotencyKey(serialized.payload.application_id, globalObject.crypto)
    serialized.payload.idempotency_key = formState.key
    setField(form, 'idempotency_key', formState.key)

    var createProject = projectApi(globalObject)
    if (!createProject) {
      setStatus(form, 'error', 'The project service is not available. Reload and retry.')
      return Promise.resolve(false)
    }

    setStatus(form, 'submitting', '')
    formState.active = Promise.resolve()
      .then(function () { return createProject(serialized.payload) })
      .then(function (result) {
        showSuccess(form, result, documentObject)
        return true
      })
      .catch(function (requestError) {
        setStatus(form, 'error', safeError(requestError))
        return false
      })
      .finally(function () { formState.active = null })
    return formState.active
  }

  function install(documentObject, globalObject) {
    if (!documentObject || !documentObject.addEventListener) return
    documentObject.addEventListener('click', function (event) {
      var trigger = event.target && event.target.closest ? event.target.closest(OPEN_SELECTOR) : null
      if (trigger) bindTrigger(trigger, documentObject)
    })
    documentObject.addEventListener('input', function (event) {
      var field = event.target
      var form = field && field.closest ? field.closest(FORM_SELECTOR) : null
      if (!form || field.getAttribute(FIELD_ATTR) === 'idempotency_key') return
      state(form).key = ''
      setField(form, 'idempotency_key', '')
    })
    documentObject.addEventListener('submit', function (event) {
      var form = event.target && event.target.closest ? event.target.closest(FORM_SELECTOR) : null
      if (!form) return
      event.preventDefault()
      event.stopImmediatePropagation()
      submit(form, globalObject, documentObject)
    }, true)
  }

  var api = {
    positiveId: positiveId,
    numberValue: numberValue,
    dateValue: dateValue,
    canonicalEngagement: canonicalEngagement,
    createIdempotencyKey: createIdempotencyKey,
    serialize: serialize,
    validationError: validationError,
    selectedContext: selectedContext,
    bindTrigger: bindTrigger,
    submit: submit,
    install: install,
  }
  global.StartersProjectFormV3 = api
  if (global.document) install(global.document, global)
})(typeof window !== 'undefined' ? window : null)
