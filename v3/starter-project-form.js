/**
 * V3 Starter Dashboard Contract Generation controller.
 *
 * Webflow owns the detached shared modal and all form markup. This controller
 * projects the selected Brand into the authored counterparty rail, binds the
 * native Brand select to Xano-authorized options, removes the authored generic
 * Service 1/2/3 slots, appends the authenticated Starter's canonical Xano
 * service names, reuses the shared commercial serializer from
 * v3/project-form.js, and creates the canonical project.
 */
;(function (global) {
  'use strict'

  if (!global || global.__startersV3StarterProjectFormBooted) return
  global.__startersV3StarterProjectFormBooted = true

  var STARTER_CONTEXT_SELECTOR = '[data-project-form-v3="starter"]'
  var FORM_SELECTOR = STARTER_CONTEXT_SELECTOR + ' form'
  var LEGACY_MODAL_SELECTOR = 'dialog[data-modal-target="start-project"]'
  var TRIGGER_SELECTOR = '[data-modal-trigger="start-project"]'
  var TRIGGER_LINK_SELECTOR = TRIGGER_SELECTOR + ' a.clickable_link'
  var STARTER_PROFILE_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/starter/profile/me'
  var BRAND_SELECT_SELECTOR = '[data-project-field="brand_id"], #Brand'
  var SERVICE_SELECT_SELECTOR = '[data-project-field="service"], select[name="Services"], select[name="services"]'
  var BRAND_ID_SELECTOR = '#brand-contract'
  var MANAGER_NAME_SELECTOR = '#hiring-manager-name, #Hiring-Manager-Name'
  var COMPANY_NAME_SELECTOR = '#brand-company-name, #Company-Name'
  var EMAIL_SELECTOR = '#brand-email, #Email-Address'
  var ERROR_SELECTOR = '[data-project-form-state="error"], .w-form-fail'
  var SUCCESS_SELECTOR = '[data-project-form-state="success"], .w-form-done'
  var LEGACY_SUCCESS_MESSAGE_SELECTOR = '.generate-contract_success-layout > p:not(.generate-contract_success-text)'
  var SUCCESS_LINK_SELECTOR = '.generate-contract_success a.clickable_link, .w-form-done a.clickable_link'
  var SUCCESS_PREVIEW_SELECTOR = '.generate-contract_success'
  var PAYLOAD_CONTROL_SELECTOR = 'input, select, textarea, button'
  var REVIEW_CONTROL_SELECTOR = 'input, select, textarea'
  var REVIEW_TRIGGER_SELECTOR = '[dx-button="review"]'
  var EDIT_TRIGGER_SELECTOR = '[dx-button="edit"]'
  var CONFIRM_SUBMIT_SELECTOR = '.button-group.is-confirm button[type="submit"], .button-group.is-confirm input[type="submit"], .button-group.is-confirm [data-project-submit]'
  var CURRENT_DATE_INITIALIZED_SELECTOR = '[data-set-current-date-inited="true"]'
  var PROFILE_BIND_SELECTOR = '[data-project-bind]'
  var LEGACY_PROFILE_BIND_SELECTOR = '[element]'
  var CMS_ONLY_IDENTITY_SELECTOR = '#brand-name-contract, #brand-name, #freeName, #FreeEmail, #pushMemID'
  var CREATED_PROJECT_STATES = {
    contract_create_pending: true,
    contract_draft: true,
    contract_sent: true,
    signature_partial: true,
    active: true,
  }
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

  function memberstackId(value) {
    var id = clean(value)
    return /^mem_[A-Za-z0-9_-]+$/.test(id) ? id : ''
  }

  function messageUrl(option) {
    var id = memberstackId(option && option.memberstack_member_id)
    return id ? '/messages?with=' + encodeURIComponent(id) : '#'
  }

  function createdProject(result) {
    var project = result && result.project
    var lifecycleState = clean(project && project.lifecycle_state).toLowerCase()
    return positiveId(project && project.id) && CREATED_PROJECT_STATES[lifecycleState]
      ? project
      : null
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
      profileRequest: null,
      submitRequest: null,
      options: [],
      optionsLoaded: false,
      profile: null,
      profileLoaded: false,
      services: [],
      selected: null,
      partyCopyTargets: null,
      key: '',
      keyPayload: '',
      lockedControls: null,
      reviewControls: null,
      submitStatus: 'idle',
      submitRetryable: false,
      submitObserver: null,
      generation: 0,
      optionsGeneration: 0,
      profileGeneration: 0,
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
      var counterpartyMemberstackId = memberstackId(raw && (
        raw.counterparty_memberstack_id || raw.memberstack_member_id || raw.memberstack_id
      ))
      if (!company) return items
      var label = company
      if (manager && company.toLowerCase() !== manager.toLowerCase()) {
        label = company + ' — ' + manager
      }
      seen[id] = true
      items.push({
        id: id,
        label: label,
        company_name: company,
        manager_name: manager,
        memberstack_member_id: counterpartyMemberstackId,
      })
      return items
    }, []).sort(function (left, right) {
      return left.label.localeCompare(right.label)
    })
  }

  function plainText(value) {
    return clean(value)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function normalizeProfile(response) {
    var firstName = clean(response && response.first_name)
    var lastName = clean(response && response.last_name)
    return {
      full_name: clean(response && response.full_name) || [firstName, lastName].filter(Boolean).join(' '),
      role_name: clean(response && response.role_name),
      professional_headline: clean(response && response.professional_headline),
      profile_photo: clean(response && response.profile_photo),
      freelancer_information: plainText(response && response.freelancer_information),
    }
  }

  function responseServices(response) {
    if (!response || typeof response !== 'object') return []
    return normalizeServices(
      Object.prototype.hasOwnProperty.call(response, 'services') ? response.services : response.Services
    )
  }

  function serviceSlot(key) {
    var match = /^service[\s_-]*([123])$/i.exec(clean(key))
    return match ? Number(match[1]) : 0
  }

  function normalizeServices(source) {
    var values = []
    if (Array.isArray(source)) {
      values = source
    } else if (source && typeof source === 'object') {
      // Xano's object shape only ever carries the three authored slots. Any
      // sibling metadata key must never become a selectable service value.
      Object.keys(source)
        .filter(function (key) { return serviceSlot(key) > 0 })
        .sort(function (first, second) { return serviceSlot(first) - serviceSlot(second) })
        .forEach(function (key) { values.push(source[key]) })
    }
    var seen = {}
    return values.reduce(function (services, item) {
      var name = clean(item && typeof item === 'object'
        ? (item.name || item.label || item.raw)
        : item)
      var key = name.toLowerCase()
      if (!name || serviceSlot(name) > 0 || seen[key]) return services
      seen[key] = true
      services.push(name)
      return services
    }, [])
  }

  function genericServiceSlot(entry) {
    return serviceSlot(entry.label) > 0 || serviceSlot(entry.value) > 0
  }

  function authoredServiceOptions(select) {
    if (!select.__starterProjectServiceOptions) {
      select.__starterProjectServiceOptions = Array.prototype.map.call(select.options, function (option) {
        return {
          value: clean(option && option.value),
          label: clean(option && option.textContent),
        }
      })
    }
    return select.__starterProjectServiceOptions
  }

  // Service 1/2/3 are Webflow authoring placeholders, never valid project
  // services. Remove them even when the canonical profile has no services or
  // the profile request fails. Valid authored options remain available.
  function renderServices(form, services) {
    var select = field(form, SERVICE_SELECT_SELECTOR)
    if (!select || !select.options || !select.ownerDocument || !select.ownerDocument.createElement) return false
    var authored = authoredServiceOptions(select)
    var names = normalizeServices(services)
    var target = authored.filter(function (entry) { return !genericServiceSlot(entry) })
    var seen = {}
    target.forEach(function (entry) { seen[entry.value.toLowerCase()] = true })
    names.forEach(function (name) {
      var key = name.toLowerCase()
      if (seen[key]) return
      seen[key] = true
      target.push({ value: name, label: name })
    })
    var selected = clean(select.value)
    for (var index = select.options.length - 1; index >= target.length; index -= 1) {
      select.remove(index)
    }
    target.forEach(function (entry, position) {
      var option = select.options[position]
      if (!option) {
        option = select.ownerDocument.createElement('option')
        select.appendChild(option)
      }
      option.value = entry.value
      option.textContent = entry.label
    })
    var selectedExists = Array.prototype.some.call(select.options, function (option) {
      return clean(option && option.value) === selected
    })
    select.value = selectedExists ? selected : ''
    return true
  }

  function formContext(form) {
    if (!form || !form.closest) return form
    return form.closest(STARTER_CONTEXT_SELECTOR) || form.closest('dialog') || form
  }

  function canonicalBindName(element) {
    var value = clean(element && element.getAttribute && (
      element.getAttribute('data-project-bind') || element.getAttribute('element')
    )).toLowerCase()
    if (value.indexOf('starter.') === 0) value = value.slice(8)
    if (value === 'freelancer_infromation') return 'freelancer_information'
    return value
  }

  function setBoundVisibility(element, visible) {
    if (!element) return
    var hideEmpty = clean(element.getAttribute && element.getAttribute('data-project-bind-empty')).toLowerCase() === 'hide'
    if (!hideEmpty) return
    element.hidden = !visible
    if (element.style) element.style.display = visible ? '' : 'none'
  }

  function renderProfile(form, profile) {
    var root = formContext(form)
    if (!root || !root.querySelectorAll) return false
    var targets = Array.prototype.slice.call(root.querySelectorAll(PROFILE_BIND_SELECTOR + ', ' + LEGACY_PROFILE_BIND_SELECTOR))
    targets.forEach(function (element) {
      var name = canonicalBindName(element)
      if (!Object.prototype.hasOwnProperty.call(profile || {}, name)) return
      var value = clean(profile[name])
      if (name === 'profile_photo' && clean(element.tagName).toLowerCase() === 'img') {
        if (value) {
          element.setAttribute('src', value)
          element.removeAttribute('srcset')
          element.setAttribute('alt', profile.full_name ? profile.full_name + ' profile photo' : 'Starter profile photo')
        } else {
          element.removeAttribute('src')
          element.removeAttribute('srcset')
          element.setAttribute('alt', '')
        }
      } else {
        element.textContent = value
      }
      setBoundVisibility(element, Boolean(value))
    })
    return Boolean(targets.length)
  }

  function setElementVisibility(element, visible) {
    if (!element) return
    element.hidden = !visible
    if (element.style) element.style.display = visible ? '' : 'none'
  }

  function replaceExactText(root, before, after) {
    if (!root || !root.querySelectorAll) return false
    var candidates = root.querySelectorAll('p, label, span')
    var replaced = false
    for (var i = 0; i < candidates.length; i += 1) {
      if (clean(candidates[i].textContent) !== before) continue
      candidates[i].textContent = after
      replaced = true
    }
    return replaced
  }

  function renderPartyCopy(form, option) {
    var current = formState(form)
    var root = formContext(form)
    if (!root || !root.querySelectorAll) return false
    if (!current.partyCopyTargets) {
      current.partyCopyTargets = Array.prototype.reduce.call(
        root.querySelectorAll('p, label, span, a, button'),
        function (targets, element) {
          var value = clean(element.textContent)
          if (value === 'Party') targets.push({ element: element, action: false })
          if (value === 'Message Party') targets.push({ element: element, action: true })
          return targets
        },
        []
      )
    }
    var manager = clean(option && option.manager_name)
    var name = manager ? manager.split(/\s+/)[0] : clean(option && option.company_name)
    if (!name) name = 'Party'
    current.partyCopyTargets.forEach(function (target) {
      target.element.textContent = target.action ? 'Message ' + name : name
      if (target.action && clean(target.element.tagName).toLowerCase() === 'a' && target.element.setAttribute) {
        target.element.setAttribute('href', messageUrl(option))
      }
    })
    return Boolean(current.partyCopyTargets.length)
  }

  function applyStarterCopy(form) {
    var root = formContext(form)
    if (!root) return false
    replaceExactText(root, 'Selected Freelancer:', 'Selected Brand:')
    replaceExactText(root, 'Starting a project is how you hire talent on The Starters', 'Starting a project lets you work with a Brand on The Starters')
    replaceExactText(root, "This is where you'll define scope, set milestones, and get to work. Once a project is created, you can document the engagement, sign a contract, and pay your Starter all in one place.", 'Define the scope, agree on terms, and get to work. After the project is created, both parties can review and sign the contract.')
    replaceExactText(root, 'Add project scope for the freelancer', 'Add the project scope you agreed with the Brand')
    replaceExactText(root, "The share of the total you'll pay the freelancer before work begins (0–100%).", 'The share of the total project cost the Brand will pay before work begins (0–100%).')
    replaceExactText(root, 'The contract will continue until the project is ended by you or the Starter', 'The contract will continue until you or the Brand ends the project')
    return true
  }

  function renderCounterparty(form, option) {
    var root = formContext(form)
    if (!root || !root.querySelectorAll) return false
    var company = clean(option && option.company_name)
    var manager = clean(option && option.manager_name)
    var values = {
      full_name: manager,
      professional_headline: company,
      profile_photo: '',
      role_name: '',
      list_roles: '',
      freelancer_information: '',
    }
    var targets = Array.prototype.slice.call(root.querySelectorAll(PROFILE_BIND_SELECTOR + ', ' + LEGACY_PROFILE_BIND_SELECTOR))
    targets.forEach(function (element) {
      var name = canonicalBindName(element)
      if (!Object.prototype.hasOwnProperty.call(values, name)) return
      var value = values[name]
      if (name === 'profile_photo' && clean(element.tagName).toLowerCase() === 'img') {
        element.removeAttribute('src')
        element.removeAttribute('srcset')
        element.setAttribute('alt', '')
      } else {
        element.textContent = value
      }
      setElementVisibility(element, Boolean(value))
    })
    return Boolean(targets.length)
  }

  function invalidateProfile(form) {
    var current = formState(form)
    current.profileGeneration += 1
    current.profileRequest = null
    current.profile = null
    current.profileLoaded = false
    current.services = []
    renderProfile(form, normalizeProfile(null))
    renderServices(form, [])
  }

  function loadProfile(form, globalObject, forceRefresh) {
    var current = formState(form)
    if (forceRefresh) invalidateProfile(form)
    if (current.profileRequest) return current.profileRequest
    if (current.profileLoaded) return Promise.resolve(current.profile)
    if (!forceRefresh) invalidateProfile(form)
    var generation = current.generation
    var profileGeneration = current.profileGeneration
    var request = starterProfileRequest(globalObject)
    if (!request) return Promise.resolve(null)
    var profileRequest = Promise.resolve()
      .then(function () { return request() })
      .then(function (response) {
        if (generation !== current.generation || profileGeneration !== current.profileGeneration) return null
        current.profile = normalizeProfile(response)
        current.services = responseServices(response)
        current.profileLoaded = true
        renderServices(form, current.services)
        return current.profile
      })
      .catch(function () {
        if (generation !== current.generation || profileGeneration !== current.profileGeneration) return null
        current.profile = null
        current.profileLoaded = false
        current.services = []
        return null
      })
      .finally(function () {
        if (current.profileRequest === profileRequest) current.profileRequest = null
      })
    current.profileRequest = profileRequest
    return profileRequest
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

  function prepareStarterContext(form) {
    if (!form || !form.querySelectorAll) return false
    installSubmitControlOwner(form)
    syncSubmitControls(form)
    // The shared Contract Generation component is reused outside its CMS page.
    // Mark the native form (not its visual wrapper) so the sitewide Turnstile
    // repair can restore Webflow's form contents before any submit attempt.
    form.setAttribute('data-starters-turnstile-fix', 'true')
    var cmsOnly = form.querySelectorAll(CMS_ONLY_IDENTITY_SELECTOR)
    Array.prototype.forEach.call(cmsOnly, function (control) {
      control.disabled = true
      control.required = false
      if (control.removeAttribute) control.removeAttribute('required')
    })
    ;[field(form, MANAGER_NAME_SELECTOR), field(form, COMPANY_NAME_SELECTOR)].forEach(function (control) {
      if (!control) return
      control.readOnly = true
      control.setAttribute('aria-readonly', 'true')
      control.removeAttribute('data-ms-member')
    })
    var email = field(form, EMAIL_SELECTOR)
    if (email) {
      email.disabled = true
      email.required = false
      email.removeAttribute('required')
      email.removeAttribute('data-ms-member')
      var emailGroup = email.parentElement
      if (emailGroup) {
        emailGroup.hidden = true
        if (emailGroup.style) emailGroup.style.display = 'none'
      }
    }
    var brandSelect = field(form, BRAND_SELECT_SELECTOR)
    if (brandSelect) {
      brandSelect.required = true
      brandSelect.setAttribute('required', '')
      brandSelect.setAttribute('data-project-field', 'brand_id')
    }
    applyStarterCopy(form)
    renderPartyCopy(form, formState(form).selected)
    var root = formContext(form)
    var successLinks = root && root.querySelectorAll ? root.querySelectorAll(SUCCESS_LINK_SELECTOR) : []
    Array.prototype.forEach.call(successLinks, function (link) {
      if (link && link.setAttribute) link.setAttribute('href', '/starter-dashboard#projects')
    })
    return true
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
    renderCounterparty(form, option)
    renderPartyCopy(form, option)
    return true
  }

  function clearSelectedBrand(form) {
    var current = formState(form)
    current.selected = null
    writeField(field(form, BRAND_ID_SELECTOR), '')
    writeField(field(form, MANAGER_NAME_SELECTOR), '')
    writeField(field(form, COMPANY_NAME_SELECTOR), '')
    writeField(field(form, EMAIL_SELECTOR), '')
    renderCounterparty(form, null)
    renderPartyCopy(form, null)
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

  // Opp30.API.starterProfile stays the primary path. The fallback exists only
  // for browser sessions holding a cached opportunities-3.0.js without that
  // method, and it must set Authorization itself: window.xanoAuthFetch only
  // credentials the reviewed api:tCpV3oqd scheduling paths and would send this
  // api:opp30 route unauthenticated. See STARTER-PROJECT-FORM-WIRING.md.
  function starterProfileRequest(globalObject) {
    var request = projectApi(globalObject, 'starterProfile')
    if (request) return request
    if (
      !globalObject ||
      typeof globalObject.getXanoAuthToken !== 'function' ||
      typeof globalObject.fetch !== 'function'
    ) return null
    return function () {
      return Promise.resolve(globalObject.getXanoAuthToken()).then(function (token) {
        if (!clean(token)) throw new Error('Starter profile authentication is unavailable')
        return globalObject.fetch(STARTER_PROFILE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: '{}',
        })
      }).then(function (response) {
        return Promise.resolve()
          .then(function () {
            return response && typeof response.json === 'function' ? response.json() : null
          })
          .catch(function () { return null })
          .then(function (data) {
            if (!response || !response.ok) {
              throw new Error(data && data.message ? data.message : 'Starter profile request failed')
            }
            return data
          })
      })
    }
  }

  function syncCommercialForm(form, documentObject, globalObject) {
    var shared = sharedFormApi(globalObject)
    if (!shared) return
    if (typeof shared.syncDurationFields === 'function') shared.syncDurationFields(form)
    if (typeof shared.syncActiveRequired === 'function') shared.syncActiveRequired(form)
    if (typeof shared.fillCurrentDates === 'function') shared.fillCurrentDates(form, globalObject)
  }

  function syncSubmitControls(form) {
    if (!form) return
    var current = formState(form)
    var submitEnabled = current.submitStatus === 'ready' || (
      current.submitStatus === 'error' && current.submitRetryable
    )
    var submitters = form.querySelectorAll
      ? form.querySelectorAll(CONFIRM_SUBMIT_SELECTOR)
      : []
    Array.prototype.forEach.call(submitters, function (submitter) {
      if (submitter.disabled === submitEnabled) submitter.disabled = !submitEnabled
      if (submitter.setAttribute) submitter.setAttribute('aria-disabled', submitEnabled ? 'false' : 'true')
    })
  }

  function installSubmitControlOwner(form) {
    var current = formState(form)
    if (current.submitObserver || typeof global.MutationObserver !== 'function') return
    current.submitObserver = new global.MutationObserver(function () {
      syncSubmitControls(form)
    })
    current.submitObserver.observe(form, { attributes: true, attributeFilter: ['disabled'], subtree: true })
  }

  function setStatus(form, status, message, retryableSubmit) {
    if (!form) return
    var current = formState(form)
    current.submitStatus = status
    current.submitRetryable = status === 'error' && retryableSubmit === true
    installSubmitControlOwner(form)
    form.setAttribute('data-starter-project-status', status)
    form.setAttribute('aria-busy', status === 'submitting' ? 'true' : 'false')
    syncSubmitControls(form)
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

  function captureReviewControls(form) {
    var current = formState(form)
    var controls = form.querySelectorAll ? form.querySelectorAll(REVIEW_CONTROL_SELECTOR) : []
    current.reviewControls = Array.prototype.map.call(controls, function (control) {
      return { control: control, disabled: Boolean(control.disabled) }
    })
  }

  function restoreReviewControls(form) {
    var current = formState(form)
    if (!current.reviewControls) return
    current.reviewControls.forEach(function (entry) { entry.control.disabled = entry.disabled })
    current.reviewControls = null
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
    current.profileRequest = null
    current.submitRequest = null
    current.options = []
    current.optionsLoaded = false
    invalidateProfile(form)
    current.selected = null
    current.key = ''
    current.keyPayload = ''
    current.lockedControls = null
    current.reviewControls = null
    resetPresentation(form, true)
    clearRenderedOptions(form)
    setSelectState(form, 'Choose a Brand', true)
    setStatus(form, 'idle', '')
  }

  function prepareOpen(form, documentObject, globalObject) {
    var wasSuccessful = form.getAttribute && form.getAttribute('data-starter-project-status') === 'success'
    resetPresentation(form, wasSuccessful)
    prepareStarterContext(form)
    syncCommercialForm(form, documentObject, globalObject)
  }

  function showSuccess(form, result, documentObject) {
    lockForm(form, false)
    restoreReviewControls(form)
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
      var message = success.querySelector && (
        success.querySelector('[data-project-success-message]') ||
        success.querySelector(LEGACY_SUCCESS_MESSAGE_SELECTOR)
      )
      if (message) {
        message.textContent = isActive
          ? 'Your project is now active.'
          : 'Your contract is being prepared. You and the Brand can sign when it is ready.'
      }
      var successLink = success.querySelector && success.querySelector(SUCCESS_LINK_SELECTOR)
      if (successLink && successLink.setAttribute) successLink.setAttribute('href', '/starter-dashboard#projects')
      success.hidden = false
      if (success.style) success.style.display = 'block'
      if (form.style) form.style.display = 'none'
      var preview = success.matches && success.matches(SUCCESS_PREVIEW_SELECTOR)
        ? success
        : success.querySelector && success.querySelector(SUCCESS_PREVIEW_SELECTOR)
      if (preview && preview.setAttribute) {
        preview.setAttribute('aria-hidden', 'true')
        Promise.resolve().then(function () { preview.setAttribute('aria-hidden', 'false') })
      }
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

  function retryableSubmitError(error) {
    var status = Number(error && error.status)
    return !status || status === 408 || status === 425 || status === 429 || status >= 500
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
    lockForm(form, true)
    setStatus(form, 'submitting', '')
    var submitRequest = Promise.resolve()
      .then(function () { return request(serialized.payload) })
      .then(function (result) {
        if (generation !== current.generation) return false
        if (!createdProject(result)) {
          setStatus(form, 'error', safeError(), true)
          return false
        }
        showSuccess(form, result, documentObject)
        return true
      })
      .catch(function (requestError) {
        if (generation !== current.generation) return false
        if (Number(requestError && requestError.status) === 403) invalidateOptions(form)
        setStatus(form, 'error', safeError(requestError), retryableSubmitError(requestError))
        return false
      })
      .finally(function () {
        if (generation !== current.generation || current.submitRequest !== submitRequest) return
        lockForm(form, false)
        syncSubmitControls(form)
        if (!current.optionsLoaded) setSelectState(form, 'Choose a Brand', true)
        current.submitRequest = null
      })
    current.submitRequest = submitRequest
    return submitRequest
  }

  function formFromTarget(target) {
    return target && target.closest ? target.closest(FORM_SELECTOR) : null
  }

  function normalizeModalMarkup(documentObject) {
    if (!documentObject || !documentObject.querySelectorAll) return false
    var detached = documentObject.querySelector && documentObject.querySelector(
      'dialog[data-modal-target="generate-contract"] [element="profile_photo"]'
    )
    var context = detached && detached.closest ? detached.closest('dialog') : null
    if (context && context.setAttribute) context.setAttribute('data-project-form-v3', 'starter')
    var canonical = context && clean(context.tagName).toLowerCase() === 'dialog'
      ? context
      : context && context.closest ? context.closest('dialog') : null
    var dialogs = Array.prototype.slice.call(documentObject.querySelectorAll(LEGACY_MODAL_SELECTOR))
    if (canonical && canonical.setAttribute) canonical.setAttribute('data-modal-target', 'start-project')
    dialogs = Array.prototype.slice.call(documentObject.querySelectorAll(LEGACY_MODAL_SELECTOR))
    var duplicateNumber = 0
    dialogs.forEach(function (dialog) {
      if (!dialog || dialog === canonical || !dialog.setAttribute) return
      duplicateNumber += 1
      dialog.setAttribute('data-modal-target', 'start-project-legacy-disabled-' + duplicateNumber)
    })
    var triggerLinks = documentObject.querySelectorAll(TRIGGER_LINK_SELECTOR)
    Array.prototype.forEach.call(triggerLinks, function (link) {
      if (link && link.setAttribute) link.setAttribute('href', '#start-project')
    })
    var canonicalForm = canonical && canonical.querySelector ? canonical.querySelector('form') : null
    if (canonicalForm) {
      prepareStarterContext(canonicalForm)
      invalidateProfile(canonicalForm)
    }
    return Boolean(canonicalForm)
  }

  function bind(documentObject, globalObject) {
    if (!documentObject || !documentObject.addEventListener) return false
    // This deferred head script runs before the shared modal initializer. Fix
    // the legacy nested navigation link and duplicate modal target first so a
    // navbar click opens only the canonical Contract Generation form.
    normalizeModalMarkup(documentObject)
    documentObject.addEventListener('click', function (event) {
      var review = event.target && event.target.closest ? event.target.closest(REVIEW_TRIGGER_SELECTOR) : null
      var form = review && formFromTarget(review)
      if (form) captureReviewControls(form)
    }, true)
    documentObject.addEventListener('click', function (event) {
      var clickedForm = formFromTarget(event.target)
      var edit = event.target && event.target.closest ? event.target.closest(EDIT_TRIGGER_SELECTOR) : null
      // The legacy Edit handler enables every control. Reapply the authored
      // Starter-only identity state before the next Review snapshot is taken.
      if (clickedForm && edit) prepareStarterContext(clickedForm)
      if (clickedForm) syncCommercialForm(clickedForm, documentObject, globalObject)
      var trigger = event.target && event.target.closest ? event.target.closest(TRIGGER_SELECTOR) : null
      if (trigger) {
        var form = documentObject.querySelector(FORM_SELECTOR)
        if (form) {
          prepareOpen(form, documentObject, globalObject)
          loadProfile(form, globalObject, true)
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
    memberstackId: memberstackId,
    messageUrl: messageUrl,
    normalizeOptions: normalizeOptions,
    normalizeProfile: normalizeProfile,
    normalizeServices: normalizeServices,
    responseServices: responseServices,
    renderProfile: renderProfile,
    renderServices: renderServices,
    renderCounterparty: renderCounterparty,
    applyStarterCopy: applyStarterCopy,
    loadProfile: loadProfile,
    prepareStarterContext: prepareStarterContext,
    selectBrand: selectBrand,
    clearSelectedBrand: clearSelectedBrand,
    renderOptions: renderOptions,
    setSelectState: setSelectState,
    syncCommercialForm: syncCommercialForm,
    starterPayload: starterPayload,
    validationError: validationError,
    loadOptions: loadOptions,
    submit: submit,
    normalizeModalMarkup: normalizeModalMarkup,
    bind: bind,
  }
  global.StartersStarterProjectFormV3 = api
  if (global.document) bind(global.document, global)
})(typeof window !== 'undefined' ? window : null)
