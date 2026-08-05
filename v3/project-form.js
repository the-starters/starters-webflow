/**
 * V3 Brand project / contract form adapter.
 *
 * Webflow owns the native form and every field. This module only:
 *   - binds the existing Brand /hire/<slug> "Contract Generation" form to
 *     the selected Starter's stable Memberstack identity;
 *   - serializes the existing named Webflow controls into the published Xano
 *     projects/create-direct/v3 contract;
 *   - supplies a retry-stable idempotency key and submits through Opp30's
 *     authenticated Memberstack -> Xano bridge;
 *   - projects safe pending/success/error state into authored elements.
 *
 * Xano remains authoritative for identity, ownership, project creation,
 * PandaDoc, lifecycle state, and duplicate prevention. This script never
 * creates form HTML and intentionally ignores the separate "start-project"
 * modal. Only the Brand Hire modal with data-modal-target="generate-contract"
 * is in scope.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3ProjectFormBooted) return
  global.__startersV3ProjectFormBooted = true

  // Webflow applies Form Block custom attributes to the authored `.w-form`
  // wrapper, not its generated native `<form>`. Resolve the form through that
  // wrapper so the Designer remains the sole owner of the markup.
  var FORM_SELECTOR = 'dialog[data-modal-target="generate-contract"] [data-project-form-v3="brand"] form'
  var OPEN_SELECTOR = '[data-modal-trigger="generate-contract"]'
  var FIELD_ATTR = 'data-project-field'
  // `pushMemID` is an established CMS-bound control emitted by the target
  // modal's existing Code Embed on published pages. It is not present as a
  // selectable native Designer field, so scope the established ID to this
  // modal rather than editing the separate start-project embed.
  var SELECTED_STARTER_SELECTOR = 'dialog[data-modal-target="generate-contract"] #pushMemID'
  var CONTRACT_CHOICE_SELECTOR = '[data-project-contract-choice]'
  var PAYLOAD_CONTROL_SELECTOR = '[' + FIELD_ATTR + '], ' + CONTRACT_CHOICE_SELECTOR + ', [name], [type="submit"]'
  var CONTAINER_SELECTOR = '[data-project-form-container]'
  var SUCCESS_SELECTOR = '[data-project-form-state="success"]'
  var stateByForm = typeof WeakMap === 'function' ? new WeakMap() : null

  var ENGAGEMENT_TYPES = {
    'flat fee': 'flat_fee',
    flat_fee: 'flat_fee',
    'ongoing hourly': 'hourly',
    'on going hourly': 'hourly',
    'hourly rate': 'hourly',
    hourly: 'hourly',
    'weekly recurring': 'weekly',
    weekly: 'weekly',
    'monthly recurring': 'monthly',
    monthly: 'monthly',
  }

  var NUMERIC_FIELDS = {
    total_cost: true,
    paid_upfront_pct: true,
    hourly_rate: true,
    weekly_rate: true,
    monthly_rate: true,
    estimated_hours: true,
    maximum_total_hours: true,
    maximum_hours_per_week: true,
    maximum_hours_per_month: true,
    number_of_weeks: true,
    number_of_months: true,
  }

  var INTEGER_FIELDS = {
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
    var us = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(normalized)
    if (!iso && !us) return ''
    var year = Number(iso ? iso[1] : us[3])
    var month = Number(iso ? iso[2] : us[1])
    var day = Number(iso ? iso[3] : us[2])
    var candidate = new Date(Date.UTC(year, month - 1, day))
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) return ''
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  }

  function payloadSignature(payload) {
    var normalized = {}
    Object.keys(payload || {}).sort().forEach(function (name) {
      if (name !== 'idempotency_key') normalized[name] = payload[name]
    })
    return JSON.stringify(normalized)
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

  function createIdempotencyKey(cryptoObject) {
    return 'direct-hire-ui:' + randomPart(cryptoObject)
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
    if (!field) return ''
    var type = clean(field.type).toLowerCase()
    if ((type === 'checkbox' || type === 'radio') && !field.checked) return ''
    return clean(field.value)
  }

  function activeControl(field) {
    if (!field || field.hidden) return false
    var node = field
    while (node && node !== field.form) {
      if (node.hidden || clean(node.getAttribute && node.getAttribute('aria-hidden')).toLowerCase() === 'true') return false
      var style = node.style || {}
      if (style.display === 'none' || style.visibility === 'hidden') return false
      node = node.parentElement
    }
    // Published Webflow conditional panels use display:none. offsetParent is
    // the cheapest reliable runtime signal while remaining test-DOM friendly.
    return field.offsetParent !== null || typeof field.offsetParent === 'undefined'
  }

  function namedControls(form, name) {
    return form && form.querySelectorAll
      ? form.querySelectorAll('[name="' + name + '"]')
      : []
  }

  function namedField(form, names) {
    var candidates = []
    ;(Array.isArray(names) ? names : [names]).forEach(function (name) {
      Array.prototype.push.apply(candidates, Array.prototype.slice.call(namedControls(form, name)))
    })
    if (!candidates.length) return null
    return candidates.find(function (field) { return activeControl(field) && fieldValue(field) }) ||
      candidates.find(activeControl) ||
      candidates.find(function (field) { return fieldValue(field) }) ||
      candidates[0]
  }

  function setPayloadValue(payload, name, field) {
    if (!field || Object.prototype.hasOwnProperty.call(payload, name)) return
    var value = fieldValue(field)
    if (INTEGER_FIELDS[name]) {
      payload[name] = positiveId(value)
    } else if (NUMERIC_FIELDS[name]) {
      var numeric = numberValue(value)
      payload[name] = INTEGER_FIELDS[name] && numeric != null ? Math.trunc(numeric) : numeric
    } else if (name === 'start_date' || name === 'estimated_end_date') {
      payload[name] = dateValue(value) || null
    } else if (name === 'hourly_billing_frequency') {
      payload[name] = canonicalHourlyFrequency(value) || null
    } else {
      payload[name] = value
    }
  }

  function canonicalEngagement(value) {
    var normalized = clean(value).toLowerCase()
    return ENGAGEMENT_TYPES[normalized] || ''
  }

  function canonicalContractType(value) {
    var normalized = clean(value).toLowerCase()
    if (normalized === 'my own contract' || normalized === 'own contract' || normalized === 'your contract' || normalized === 'own_contract') return 'own_contract'
    if (normalized === 'standard contract' || normalized === 'standard') return 'standard'
    return ''
  }

  function canonicalHourlyFrequency(value) {
    var normalized = clean(value).toLowerCase().replace(/[\s-]+/g, '_')
    if (normalized === 'one_time' || normalized === 'weekly' || normalized === 'monthly') return normalized
    return ''
  }

  function serialize(form, documentObject) {
    var payload = {}
    var fields = form && form.querySelectorAll
      ? form.querySelectorAll('[' + FIELD_ATTR + ']')
      : []
    Array.prototype.forEach.call(fields, function (field) {
      if (clean(field.type).toLowerCase() === 'radio' && !field.checked) return
      var name = clean(field.getAttribute && field.getAttribute(FIELD_ATTR))
      if (!name) return
      var value = fieldValue(field)
      // The live form authors one rate/date control per conditional fee panel.
      // Prefer the populated control rather than allowing a hidden blank panel
      // to win by DOM order.
      if (Object.prototype.hasOwnProperty.call(payload, name) && !value) return
      if (INTEGER_FIELDS[name]) {
        payload[name] = positiveId(value)
      } else if (NUMERIC_FIELDS[name]) {
        var numeric = numberValue(value)
        payload[name] = name === 'number_of_weeks' || name === 'number_of_months'
          ? (numeric == null ? null : Math.trunc(numeric))
          : numeric
      } else if (name === 'start_date' || name === 'estimated_end_date') {
        payload[name] = dateValue(value) || null
      } else if (name === 'hourly_billing_frequency') {
        payload[name] = canonicalHourlyFrequency(value) || null
      } else {
        payload[name] = value
      }
    })

    // The authored form predates this adapter and already exposes stable native
    // Webflow names. Prefer semantic data attributes when present, then fill
    // the allowlisted payload from those native names. For repeated Amount,
    // Frequency, and date controls, namedField chooses the visible conditional
    // panel and never lets a hidden blank panel win.
    setPayloadValue(payload, 'title', namedField(form, 'Project-Name'))
    setPayloadValue(payload, 'service', namedField(form, 'Services'))
    setPayloadValue(payload, 'engagement_type', namedField(form, 'Fee-Structure') || namedField(form, 'fee-structure'))
    setPayloadValue(payload, 'start_date', namedField(form, 'startDateInput'))
    setPayloadValue(payload, 'estimated_end_date', namedField(form, 'endDateInput'))
    setPayloadValue(payload, 'project_scope', namedField(form, 'Project-Scope'))
    setPayloadValue(payload, 'paid_upfront_pct', namedField(form, 'Percent-Paid-Upfront'))
    setPayloadValue(payload, 'maximum_total_hours', namedField(form, 'Maximum-Hours-Billed'))
    setPayloadValue(payload, 'maximum_hours_per_week', namedField(form, 'Maximum-Hours-Billed-per-Week'))
    setPayloadValue(payload, 'maximum_hours_per_month', namedField(form, 'Maximum-Hours-Billed-per-Month'))
    setPayloadValue(payload, 'number_of_weeks', namedField(form, 'Number-of-Weeks'))
    setPayloadValue(payload, 'number_of_months', namedField(form, 'Number-of-Months'))

    var authoredAmount = namedField(form, 'Amount')
    var authoredFrequency = namedField(form, 'Frequency')
    var authoredEngagement = canonicalEngagement(payload.engagement_type)
    if (authoredEngagement === 'flat_fee') setPayloadValue(payload, 'total_cost', authoredAmount)
    if (authoredEngagement === 'hourly') {
      setPayloadValue(payload, 'hourly_rate', authoredAmount)
      setPayloadValue(payload, 'hourly_billing_frequency', authoredFrequency)
    }
    if (authoredEngagement === 'weekly') setPayloadValue(payload, 'weekly_rate', authoredAmount)
    if (authoredEngagement === 'monthly') setPayloadValue(payload, 'monthly_rate', authoredAmount)

    // Reuse the target modal's existing CMS-bound Starter identity control
    // instead of duplicating its CMS binding or generating a hidden field.
    if (!clean(payload.starter_memberstack_id) && documentObject && documentObject.querySelector) {
      payload.starter_memberstack_id = fieldValue(documentObject.querySelector(SELECTED_STARTER_SELECTOR))
    }

    payload.engagement_type = canonicalEngagement(payload.engagement_type)
    var contractChoice = form && form.querySelector
      ? form.querySelector(CONTRACT_CHOICE_SELECTOR + ':checked') || form.querySelector('input[type="radio"]:checked')
      : null
    payload.contract_type = canonicalContractType(fieldValue(contractChoice))

    // Webflow keeps inactive conditional panels in the DOM. Clear their stale
    // commercial values so only the selected pricing contract crosses the API.
    if (payload.engagement_type !== 'flat_fee') {
      payload.total_cost = null
      payload.paid_upfront_pct = null
    }
    if (payload.engagement_type !== 'hourly') {
      payload.hourly_rate = null
      payload.hourly_billing_frequency = null
      payload.maximum_total_hours = null
      payload.maximum_hours_per_week = null
      payload.maximum_hours_per_month = null
    } else if (payload.hourly_billing_frequency === 'one_time') {
      payload.maximum_hours_per_week = null
      payload.maximum_hours_per_month = null
    } else if (payload.hourly_billing_frequency === 'weekly') {
      payload.maximum_total_hours = null
      payload.maximum_hours_per_month = null
    } else if (payload.hourly_billing_frequency === 'monthly') {
      payload.maximum_total_hours = null
      payload.maximum_hours_per_week = null
    }
    if (payload.engagement_type !== 'weekly') {
      payload.weekly_rate = null
      payload.number_of_weeks = null
    }
    if (payload.engagement_type !== 'monthly') {
      payload.monthly_rate = null
      payload.number_of_months = null
    }
    return { payload: payload }
  }

  function validationError(serialized) {
    var payload = serialized.payload
    if (!clean(payload.starter_memberstack_id)) return 'The selected Starter could not be identified. Reload and try again.'
    if (!payload.engagement_type) return 'Choose a supported fee structure.'
    if (!payload.contract_type) return 'Choose a contract type.'
    if (!clean(payload.title)) return 'Enter a project name.'
    if (!clean(payload.service)) return 'Choose a service.'
    if (!payload.start_date) return 'Enter a valid start date.'
    if (!clean(payload.project_scope)) return 'Add the project scope.'
    if (payload.engagement_type === 'flat_fee' && !(payload.total_cost > 0)) return 'Enter a total project cost.'
    if (payload.engagement_type === 'hourly' && !(payload.hourly_rate > 0)) return 'Enter an hourly rate.'
    if (payload.engagement_type === 'hourly' && !payload.hourly_billing_frequency) return 'Choose an hourly billing frequency.'
    if (payload.engagement_type === 'weekly' && !(payload.weekly_rate > 0)) return 'Enter a weekly rate.'
    if (payload.engagement_type === 'monthly' && !(payload.monthly_rate > 0)) return 'Enter a monthly rate.'
    if (payload.paid_upfront_pct != null && (payload.paid_upfront_pct < 0 || payload.paid_upfront_pct > 100)) {
      return 'Paid upfront must be between 0% and 100%.'
    }
    return ''
  }

  function state(form) {
    if (!stateByForm) {
      form.__projectFormV3State = form.__projectFormV3State || { active: null, key: '', keyPayload: '', lockedFields: null }
      return form.__projectFormV3State
    }
    var current = stateByForm.get(form)
    if (!current) {
      current = { active: null, key: '', keyPayload: '', lockedFields: null }
      stateByForm.set(form, current)
    }
    return current
  }

  function setFormLocked(form, locked) {
    var formState = state(form)
    if (locked) {
      if (formState.lockedFields) return
      var fields = form.querySelectorAll(PAYLOAD_CONTROL_SELECTOR)
      formState.lockedFields = Array.prototype.map.call(fields, function (field) {
        var wasDisabled = Boolean(field.disabled)
        field.disabled = true
        return { field: field, wasDisabled: wasDisabled }
      })
      return
    }
    if (!formState.lockedFields) return
    formState.lockedFields.forEach(function (entry) {
      entry.field.disabled = entry.wasDisabled
    })
    formState.lockedFields = null
  }

  function setStatus(form, status, message) {
    form.setAttribute('data-project-form-status', status)
    form.setAttribute('aria-busy', status === 'submitting' ? 'true' : 'false')
    setFormLocked(form, status === 'submitting')
    var wrapper = formContainer(form)
    var error = form.querySelector('[data-project-form-state="error"]') ||
      (wrapper && (wrapper.querySelector('[data-project-form-state="error"]') || wrapper.querySelector('.w-form-fail')))
    if (error) {
      error.textContent = status === 'error' ? message : ''
      error.hidden = status !== 'error'
      error.style.display = status === 'error' ? 'block' : 'none'
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
    if (status === 409) return 'This project request was already accepted.'
    if (status === 400 || status === 422) return 'Review the project details and try again.'
    return 'The project could not be created. Please retry.'
  }

  function formForTrigger(trigger, documentObject) {
    return documentObject.querySelector(FORM_SELECTOR)
  }

  function formContainer(form) {
    return form && form.closest ? form.closest(CONTAINER_SELECTOR) : null
  }

  function bindTrigger(trigger, documentObject) {
    var form = formForTrigger(trigger, documentObject)
    if (!form) return false
    var formState = state(form)
    if (formState.active) return false
    form.style.display = ''
    var wrapper = formContainer(form)
    var priorSuccess = wrapper && (wrapper.querySelector(SUCCESS_SELECTOR) || wrapper.querySelector('.w-form-done'))
    if (priorSuccess) {
      priorSuccess.hidden = true
      priorSuccess.style.display = 'none'
    }
    if (formState.key && formState.keyPayload !== payloadSignature(serialize(form, documentObject).payload)) {
      formState.key = ''
      formState.keyPayload = ''
      setField(form, 'idempotency_key', '')
    }
    if (!fieldValue(documentObject.querySelector(SELECTED_STARTER_SELECTOR))) {
      setStatus(form, 'error', 'The selected Starter could not be identified. Reload and try again.')
      return false
    }
    setStatus(form, 'ready', '')
    return true
  }

  function projectApi(globalObject) {
    var api = globalObject && globalObject.Opp30 && globalObject.Opp30.API
    return api && typeof api.projectDirectCreate === 'function' ? api.projectDirectCreate : null
  }

  function showSuccess(form, result, documentObject) {
    setStatus(form, 'success', '')
    var formState = state(form)
    formState.key = ''
    formState.keyPayload = ''
    setField(form, 'idempotency_key', '')
    var wrapper = formContainer(form)
    var success = wrapper && (wrapper.querySelector(SUCCESS_SELECTOR) || wrapper.querySelector('.w-form-done'))
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

    var serialized = serialize(form, documentObject)
    var error = validationError(serialized)
    if (error) {
      setStatus(form, 'error', error)
      return Promise.resolve(false)
    }

    var signature = payloadSignature(serialized.payload)
    if (formState.key && formState.keyPayload !== signature) formState.key = ''
    if (!formState.key) {
      formState.key = createIdempotencyKey(globalObject.crypto)
      formState.keyPayload = signature
    }
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
      var formState = state(form)
      if (formState.active) return
      formState.key = ''
      formState.keyPayload = ''
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
    canonicalContractType: canonicalContractType,
    canonicalHourlyFrequency: canonicalHourlyFrequency,
    createIdempotencyKey: createIdempotencyKey,
    serialize: serialize,
    validationError: validationError,
    bindTrigger: bindTrigger,
    submit: submit,
    install: install,
  }
  global.StartersProjectFormV3 = api
  if (global.document) install(global.document, global)
})(typeof window !== 'undefined' ? window : null)
