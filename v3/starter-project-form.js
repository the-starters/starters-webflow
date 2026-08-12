/**
 * V3 Starter "Start a Project" controller.
 *
 * Webflow owns the modal and all form markup. This controller binds the
 * existing native Brand select to Xano-authorized options, reuses the
 * shared commercial serializer from v3/project-form.js, and creates the
 * canonical project. Standard Contract signatures replace a separate Brand
 * approval step.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3StarterProjectFormBooted) return
  global.__startersV3StarterProjectFormBooted = true

  var FORM_SELECTOR = 'dialog[data-modal-target="start-project"] form'
  var TRIGGER_SELECTOR = '[data-modal-trigger="start-project"]'
  var BRAND_SELECT_SELECTOR = '#Brand'
  var BRAND_ID_SELECTOR = '#brand-contract'
  var MANAGER_NAME_SELECTOR = '#hiring-manager-name'
  var COMPANY_NAME_SELECTOR = '#brand-company-name'
  var EMAIL_SELECTOR = '#brand-email'
  var ERROR_SELECTOR = '[data-project-form-state="error"], .w-form-fail'
  var SUCCESS_SELECTOR = '[data-project-form-state="success"], .w-form-done'
  var PAYLOAD_CONTROL_SELECTOR = 'input, select, textarea, button'
  var CURRENT_DATE_INITIALIZED_SELECTOR = '[data-set-current-date-inited="true"]'
  var STARTER_PAYLOAD_FIELDS = [
    'title',
    'service',
    'engagement_type',
    'contract_type',
    'invoice_frequency',
    'project_scope',
    'start_date',
    'estimated_end_date',
    'total_cost',
    'paid_upfront_pct',
    'hourly_rate',
    'hourly_billing_frequency',
    'maximum_total_hours',
    'maximum_hours_per_week',
    'maximum_hours_per_month',
    'weekly_rate',
    'number_of_weeks',
    'monthly_rate',
    'number_of_months',
  ]
  var stateByForm = typeof WeakMap === 'function' ? new WeakMap() : null

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function positiveId(value) {
    var parsed = Number(clean(value))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  function formState(form) {
    if (!stateByForm) {
      form.__starterProjectState = form.__starterProjectState || defaultState()
      return form.__starterProjectState
    }
    var current = stateByForm.get(form)
    if (!current) {
      current = defaultState()
      stateByForm.set(form, current)
    }
    return current
  }

  function defaultState() {
    return {
      optionsRequest: null,
      submitRequest: null,
      options: [],
      optionsLoaded: false,
      selected: null,
      key: '',
      keyPayload: '',
      lockedControls: null,
      generation: 0,
      optionsGeneration: 0,
    }
  }

  function optionSource(response) {
    if (response && Array.isArray(response.counterparties)) return response.counterparties
    if (response && Array.isArray(response.brands)) return response.brands
    return []
  }

  function normalizeOptions(response) {
    var seen = {}
    return optionSource(response).reduce(function (items, raw) {
      var id = positiveId(raw && (raw.counterparty_id || raw.brand_id || raw.id))
      if (!id || seen[id]) return items
      var company = clean(raw && (raw.company_name || raw.counterparty_label || raw.label))
      var manager = clean(raw && (raw.hiring_manager_name || raw.full_name || raw.manager_name))
      var label = company || manager
      if (company && manager && company.toLowerCase() !== manager.toLowerCase()) {
        label = company + ' — ' + manager
      }
      if (!label) return items
      seen[id] = true
      items.push({ id: id, label: label, company_name: company, manager_name: manager })
      return items
    }, []).sort(function (left, right) {
      return left.label.localeCompare(right.label)
    })
  }

  function field(form, selector) {
    return form && form.querySelector ? form.querySelector(selector) : null
  }

  function formContainer(form) {
    return form && form.closest ? form.closest('.w-form') : null
  }

  function stateElement(form, selector) {
    return field(form, selector) || field(formContainer(form), selector)
  }

  function writeField(target, value) {
    if (!target) return
    target.value = clean(value)
    if (typeof target.dispatchEvent === 'function' && typeof global.Event === 'function') {
      target.dispatchEvent(new global.Event('input', { bubbles: true }))
      target.dispatchEvent(new global.Event('change', { bubbles: true }))
    }
  }

  function writeSelectValue(form, value) {
    var select = field(form, BRAND_SELECT_SELECTOR)
    if (select) select.value = clean(value)
  }

  function selectBrand(form, option) {
    if (!form || !option || !positiveId(option.id)) return false
    var current = formState(form)
    current.selected = option
    writeField(field(form, BRAND_ID_SELECTOR), option.id)
    writeSelectValue(form, option.id)
    writeField(field(form, MANAGER_NAME_SELECTOR), option.manager_name)
    writeField(field(form, COMPANY_NAME_SELECTOR), option.company_name)
    // The V3 options response intentionally omits Brand email. Clear any stale
    // sample or previous selection value already present in the authored form.
    writeField(field(form, EMAIL_SELECTOR), '')
    return true
  }

  function clearSelectedBrand(form) {
    var current = formState(form)
    current.selected = null
    writeField(field(form, BRAND_ID_SELECTOR), '')
    writeField(field(form, MANAGER_NAME_SELECTOR), '')
    writeField(field(form, COMPANY_NAME_SELECTOR), '')
    writeField(field(form, EMAIL_SELECTOR), '')
  }

  function clearRenderedOptions(form) {
    var select = field(form, BRAND_SELECT_SELECTOR)
    if (!select || !select.options) return
    while (select.options.length > 1) select.remove(1)
  }

  function setSelectState(form, placeholder, disabled) {
    var select = field(form, BRAND_SELECT_SELECTOR)
    if (!select) return false
    var first = select.options && select.options[0]
    if (first) {
      first.value = ''
      first.textContent = clean(placeholder)
    }
    select.disabled = Boolean(disabled)
    select.setAttribute('aria-disabled', disabled ? 'true' : 'false')
    return true
  }

  function renderOptions(form, options) {
    clearRenderedOptions(form)
    var select = field(form, BRAND_SELECT_SELECTOR)
    if (!select || !select.ownerDocument || !select.ownerDocument.createElement) return false
    if (!options.length) {
      setSelectState(form, 'No eligible Brands yet', true)
      return true
    }
    options.forEach(function (option) {
      var element = select.ownerDocument.createElement('option')
      element.textContent = option.label
      element.value = String(option.id)
      select.appendChild(element)
    })
    setSelectState(form, 'Choose a Brand', false)
    return true
  }

  function projectApi(globalObject, method) {
    var api = globalObject && globalObject.Opp30 && globalObject.Opp30.API
    return api && typeof api[method] === 'function' ? api[method] : null
  }

  function syncCommercialForm(form, documentObject, globalObject) {
    var shared = sharedFormApi(globalObject)
    if (!shared) return
    if (typeof shared.syncDurationFields === 'function') shared.syncDurationFields(form)
    if (typeof shared.syncActiveRequired === 'function') shared.syncActiveRequired(form)
    if (typeof shared.fillCurrentDates === 'function') shared.fillCurrentDates(form, globalObject)
  }

  function setStatus(form, status, message) {
    if (!form) return
    form.setAttribute('data-starter-project-status', status)
    form.setAttribute('aria-busy', status === 'submitting' ? 'true' : 'false')
    var error = stateElement(form, ERROR_SELECTOR)
    if (error) {
      error.textContent = status === 'error' || status === 'blocked' ? clean(message) : ''
      error.hidden = status !== 'error' && status !== 'blocked'
      if (error.style) error.style.display = error.hidden ? 'none' : 'block'
    }
  }

  function invalidateOptions(form) {
    var current = formState(form)
    current.optionsGeneration += 1
    current.options = []
    current.optionsLoaded = false
    writeSelectValue(form, '')
    clearSelectedBrand(form)
    clearRenderedOptions(form)
    setSelectState(form, 'Choose a Brand', true)
  }

  function loadOptions(form, globalObject, forceRefresh) {
    var current = formState(form)
    if (current.submitRequest) return Promise.resolve(current.options)
    if (forceRefresh) invalidateOptions(form)
    if (current.optionsRequest && !forceRefresh) return current.optionsRequest
    if (current.optionsLoaded) return Promise.resolve(current.options)
    var generation = current.generation
    var optionsGeneration = current.optionsGeneration
    var request = projectApi(globalObject, 'projectOptions')
    if (!request) {
      setStatus(form, 'error', 'The Brand list is not available. Reload and try again.')
      return Promise.resolve([])
    }
    syncCommercialForm(form, globalObject && globalObject.document, globalObject)
    setStatus(form, 'loading', '')
    setSelectState(form, 'Loading Brands...', true)
    var optionsRequest = Promise.resolve()
      .then(function () { return request({}) })
      .then(function (response) {
        if (generation !== current.generation || optionsGeneration !== current.optionsGeneration) return []
        current.options = normalizeOptions(response)
        current.optionsLoaded = true
        clearSelectedBrand(form)
        renderOptions(form, current.options)
        if (!current.options.length) {
          setStatus(form, 'blocked', 'You can start a project after a Brand messages you.')
        } else {
          setStatus(form, 'ready', '')
          if (current.options.length === 1) selectBrand(form, current.options[0])
        }
        return current.options
      })
      .catch(function () {
        if (generation !== current.generation || optionsGeneration !== current.optionsGeneration) return []
        setSelectState(form, 'Could not load Brands', true)
        setStatus(form, 'error', 'The Brand list could not load. Try again.')
        return []
      })
      .finally(function () {
        if (current.optionsRequest === optionsRequest) current.optionsRequest = null
      })
    current.optionsRequest = optionsRequest
    return optionsRequest
  }

  function sharedFormApi(globalObject) {
    return globalObject && globalObject.StartersProjectFormV3
  }

  function starterPayload(form, documentObject, globalObject) {
    var shared = sharedFormApi(globalObject)
    if (!shared || typeof shared.serialize !== 'function') return { error: 'The project form is not available.' }
    var serialized = shared.serialize(form, documentObject)
    var source = serialized && serialized.payload ? serialized.payload : {}
    var payload = {}
    STARTER_PAYLOAD_FIELDS.forEach(function (name) {
      if (Object.prototype.hasOwnProperty.call(source, name)) payload[name] = source[name]
    })
    var current = formState(form)
    payload.brand_id = positiveId(current.selected && current.selected.id) || positiveId(field(form, BRAND_ID_SELECTOR) && field(form, BRAND_ID_SELECTOR).value)
    return { payload: payload }
  }

  function validationError(form, serialized, globalObject) {
    if (!serialized || serialized.error) return serialized && serialized.error ? serialized.error : 'The project form is not available.'
    var current = formState(form)
    var selectedId = positiveId(serialized.payload.brand_id)
    var selectedIsEligible = current.selected && current.options.some(function (option) {
      return option.id === selectedId
    })
    if (!selectedIsEligible) return 'Select an eligible Brand.'
    var shared = sharedFormApi(globalObject)
    if (!shared || typeof shared.commercialValidationError !== 'function') return 'The project form is not available.'
    return shared.commercialValidationError(serialized)
  }

  function payloadSignature(payload) {
    var copy = {}
    Object.keys(payload || {}).sort().forEach(function (key) {
      if (key !== 'idempotency_key') copy[key] = payload[key]
    })
    return JSON.stringify(copy)
  }

  function lockForm(form, locked) {
    var current = formState(form)
    if (locked) {
      if (current.lockedControls) return
      var controls = form.querySelectorAll ? form.querySelectorAll(PAYLOAD_CONTROL_SELECTOR) : []
      current.lockedControls = Array.prototype.map.call(controls, function (control) {
        var disabled = Boolean(control.disabled)
        control.disabled = true
        return { control: control, disabled: disabled }
      })
      return
    }
    if (!current.lockedControls) return
    current.lockedControls.forEach(function (entry) { entry.control.disabled = entry.disabled })
    current.lockedControls = null
  }

  function resetPresentation(form, resetValues) {
    if (resetValues && typeof form.reset === 'function') {
      form.reset()
      var initializedDates = form.querySelectorAll ? form.querySelectorAll(CURRENT_DATE_INITIALIZED_SELECTOR) : []
      Array.prototype.forEach.call(initializedDates, function (dateField) {
        if (dateField && typeof dateField.removeAttribute === 'function') dateField.removeAttribute('data-set-current-date-inited')
      })
    }
    if (form.style) form.style.display = ''
    var success = stateElement(form, SUCCESS_SELECTOR)
    if (success) {
      success.hidden = true
      if (success.style) success.style.display = 'none'
    }
    if (!resetValues) return
    var current = formState(form)
    current.selected = null
    current.key = ''
    current.keyPayload = ''
    writeSelectValue(form, '')
    clearSelectedBrand(form)
  }

  function resetMemberState(form) {
    var current = formState(form)
    lockForm(form, false)
    current.generation += 1
    current.optionsRequest = null
    current.submitRequest = null
    current.options = []
    current.optionsLoaded = false
    current.selected = null
    current.key = ''
    current.keyPayload = ''
    current.lockedControls = null
    resetPresentation(form, true)
    clearRenderedOptions(form)
    setSelectState(form, 'Choose a Brand', true)
    setStatus(form, 'idle', '')
  }

  function prepareOpen(form, documentObject, globalObject) {
    var wasSuccessful = form.getAttribute && form.getAttribute('data-starter-project-status') === 'success'
    resetPresentation(form, wasSuccessful)
    syncCommercialForm(form, documentObject, globalObject)
  }

  function showSuccess(form, result, documentObject) {
    setStatus(form, 'success', '')
    var current = formState(form)
    current.key = ''
    current.keyPayload = ''
    var project = result && result.project
    var projectId = positiveId(project && project.id)
    var isActive = project && project.lifecycle_state === 'active'
    var success = stateElement(form, SUCCESS_SELECTOR)
    if (success) {
      var titles = success.querySelectorAll ? success.querySelectorAll('[data-project-success-title], .generate-contract_success-text') : []
      Array.prototype.forEach.call(titles, function (title) { title.textContent = 'Project successfully created' })
      var message = success.querySelector && success.querySelector('[data-project-success-message]')
      if (message) {
        message.textContent = isActive
          ? 'Your project is now active.'
          : 'Your contract is being prepared. You and the Brand can sign when it is ready.'
      }
      success.hidden = false
      if (success.style) success.style.display = 'block'
      if (form.style) form.style.display = 'none'
    }
    if (typeof global.CustomEvent === 'function' && documentObject && documentObject.dispatchEvent) {
      documentObject.dispatchEvent(new global.CustomEvent('starters:project-created', {
        detail: { project_id: projectId, replayed: Boolean(result && result.replayed) },
      }))
    }
    if (global.StartersTrack && typeof global.StartersTrack.track === 'function') {
      global.StartersTrack.track('project_created', { project_id: projectId })
    }
  }

  function safeError(error) {
    var status = error && Number(error.status)
    if (status === 401) return 'Your session expired. Sign in and try again.'
    if (status === 403) return 'That Brand is no longer eligible. Refresh the Brand list.'
    if (status === 409) return 'A project already exists for this request.'
    if (status === 422) return 'Review the project details and try again.'
    return 'The project could not be created. Try again.'
  }

  function submit(form, globalObject, documentObject) {
    var current = formState(form)
    if (current.submitRequest) return current.submitRequest
    var generation = current.generation
    syncCommercialForm(form, documentObject, globalObject)
    var shared = sharedFormApi(globalObject)
    if (shared && typeof shared.reportActiveValidity === 'function' && !shared.reportActiveValidity(form)) {
      setStatus(form, 'error', 'Review the required project details and try again.')
      return Promise.resolve(false)
    }
    var serialized = starterPayload(form, documentObject, globalObject)
    var error = validationError(form, serialized, globalObject)
    if (error) {
      setStatus(form, 'error', error)
      return Promise.resolve(false)
    }
    var signature = payloadSignature(serialized.payload)
    if (current.key && current.keyPayload !== signature) current.key = ''
    if (!current.key) {
      current.key = shared.createIdempotencyKey(globalObject.crypto)
      current.keyPayload = signature
    }
    serialized.payload.idempotency_key = current.key
    var request = projectApi(globalObject, 'projectSubmit')
    if (!request) {
      setStatus(form, 'error', 'The project service is not available. Reload and try again.')
      return Promise.resolve(false)
    }
    setStatus(form, 'submitting', '')
    lockForm(form, true)
    var submitRequest = Promise.resolve()
      .then(function () { return request(serialized.payload) })
      .then(function (result) {
        if (generation !== current.generation) return false
        showSuccess(form, result, documentObject)
        return true
      })
      .catch(function (requestError) {
        if (generation !== current.generation) return false
        if (Number(requestError && requestError.status) === 403) invalidateOptions(form)
        setStatus(form, 'error', safeError(requestError))
        return false
      })
      .finally(function () {
        if (generation !== current.generation || current.submitRequest !== submitRequest) return
        lockForm(form, false)
        if (!current.optionsLoaded) setSelectState(form, 'Choose a Brand', true)
        current.submitRequest = null
      })
    current.submitRequest = submitRequest
    return submitRequest
  }

  function formFromTarget(target) {
    return target && target.closest ? target.closest(FORM_SELECTOR) : null
  }

  function bind(documentObject, globalObject) {
    if (!documentObject || !documentObject.addEventListener) return false
    documentObject.addEventListener('click', function (event) {
      var clickedForm = formFromTarget(event.target)
      if (clickedForm) syncCommercialForm(clickedForm, documentObject, globalObject)
      var trigger = event.target && event.target.closest ? event.target.closest(TRIGGER_SELECTOR) : null
      if (trigger) {
        var form = documentObject.querySelector(FORM_SELECTOR)
        if (form) {
          prepareOpen(form, documentObject, globalObject)
          loadOptions(form, globalObject, true)
        }
        return
      }
    })
    documentObject.addEventListener('input', function (event) {
      var form = formFromTarget(event.target)
      if (!form) return
      syncCommercialForm(form, documentObject, globalObject)
      var current = formState(form)
      current.key = ''
      current.keyPayload = ''
      if (event.target.matches && event.target.matches(BRAND_SELECT_SELECTOR)) {
        var id = positiveId(event.target.value)
        var option = current.options.find(function (item) { return item.id === id })
        if (option) selectBrand(form, option)
        else clearSelectedBrand(form)
      }
    })
    documentObject.addEventListener('submit', function (event) {
      var form = formFromTarget(event.target)
      if (!form) return
      event.preventDefault()
      event.stopImmediatePropagation()
      submit(form, globalObject, documentObject)
    }, true)
    if (globalObject && globalObject.addEventListener) {
      globalObject.addEventListener('opp30:member-scope-reset', function () {
        var form = documentObject.querySelector(FORM_SELECTOR)
        if (form) resetMemberState(form)
      })
    }
    return true
  }

  var api = {
    positiveId: positiveId,
    normalizeOptions: normalizeOptions,
    selectBrand: selectBrand,
    clearSelectedBrand: clearSelectedBrand,
    renderOptions: renderOptions,
    setSelectState: setSelectState,
    syncCommercialForm: syncCommercialForm,
    starterPayload: starterPayload,
    validationError: validationError,
    loadOptions: loadOptions,
    submit: submit,
    bind: bind,
  }
  global.StartersStarterProjectFormV3 = api
  if (global.document) bind(global.document, global)
})(typeof window !== 'undefined' ? window : null)
