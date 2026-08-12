/**
 * V3 Brand Dashboard pending Starter project-proposal controller.
 *
 * Webflow owns the Action Items row template and review dialog. This controller
 * binds the authenticated `brand/projects/mine` proposal projection, paints
 * read-only proposal terms, and submits versioned accept/reject commands through
 * Opp30. A proposal is never treated as a canonical project before acceptance.
 */
;(function (global) {
  'use strict'

  var isCommonJs = typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  if (!isCommonJs) {
    if (!global || global.__startersBrandProjectProposalsBooted) return
    global.__startersBrandProjectProposalsBooted = true
  }

  var DASHBOARD_PATH = '/brand-dashboard'
  var INSTANCE_KEY = 'dash-brand-projects'
  var MODAL_ID = 'review-project-request'
  var TEMPLATE_SELECTOR = '[data-project-proposal-template]'
  var CARD_SELECTOR = '[data-project-proposal-card]'
  var FIELD_SELECTOR = '[data-project-proposal-field]'
  var ACTION_SELECTOR = '[data-project-proposal-action]'
  var FEEDBACK_SELECTOR = '[data-project-proposal-feedback]'
  var GLOBAL_FEEDBACK_SELECTOR = '[data-project-proposal-global-feedback]'
  var CONFIRM_SELECTOR = '[data-project-proposal-confirm="reject"]'
  var MEMBER_RESET_EVENT = 'opp30:member-scope-reset'

  function clean(value) {
    return String(value == null ? '' : value).trim()
  }

  function positiveId(value) {
    var parsed = Number(clean(value))
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  function booleanCapability(value) {
    return value === true
  }

  function sourceProposals(value) {
    if (Array.isArray(value && value.project_proposals)) return value.project_proposals
    if (Array.isArray(value && value.data && value.data.project_proposals)) {
      return value.data.project_proposals
    }
    return []
  }

  function normalizeProposal(raw) {
    var id = positiveId(raw && (raw.proposal_id || raw.id))
    var version = positiveId(raw && (raw.lifecycle_version || raw.version))
    var status = clean(raw && raw.status).toLowerCase()
    var canAccept = booleanCapability(raw && raw.can_accept)
    var canReject = booleanCapability(raw && raw.can_reject)
    if (!id || version === null || status !== 'awaiting_brand_approval') return null
    if (!canAccept && !canReject) return null
    return {
      id: id,
      version: version,
      status: status,
      can_accept: canAccept,
      can_reject: canReject,
      created_at: clean(raw.created_at || raw.submitted_at),
      starter_id: positiveId(raw.starter_id),
      starter_name: clean(raw.starter_name),
      starter_image_url: clean(raw.starter_image_url || raw.starter_profile_image),
      starter_profile_url: clean(raw.starter_profile_url),
      message_url: clean(raw.message_url),
      title: clean(raw.title || raw.project_name),
      service: clean(raw.service),
      project_scope: clean(raw.project_scope),
      engagement_type: clean(raw.engagement_type).toLowerCase(),
      contract_type: clean(raw.contract_type).toLowerCase(),
      invoice_frequency: clean(raw.invoice_frequency).toLowerCase(),
      start_date: clean(raw.start_date),
      estimated_end_date: clean(raw.estimated_end_date),
      total_cost: Number(raw.total_cost),
      paid_upfront_pct: Number(raw.paid_upfront_pct),
      hourly_rate: Number(raw.hourly_rate),
      hourly_billing_frequency: clean(raw.hourly_billing_frequency).toLowerCase(),
      maximum_total_hours: Number(raw.maximum_total_hours),
      maximum_hours_per_week: Number(raw.maximum_hours_per_week),
      maximum_hours_per_month: Number(raw.maximum_hours_per_month),
      weekly_rate: Number(raw.weekly_rate),
      number_of_weeks: Number(raw.number_of_weeks),
      monthly_rate: Number(raw.monthly_rate),
      number_of_months: Number(raw.number_of_months),
    }
  }

  function normalizeProposals(value) {
    var seen = {}
    return sourceProposals(value).reduce(function (items, raw) {
      var proposal = normalizeProposal(raw)
      if (!proposal || seen[proposal.id]) return items
      seen[proposal.id] = true
      items.push(proposal)
      return items
    }, []).sort(function (left, right) {
      var byCreated = right.created_at.localeCompare(left.created_at)
      return byCreated || right.id - left.id
    })
  }

  function money(value) {
    if (!(Number(value) >= 0)) return ''
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: Number(value) % 1 ? 2 : 0,
      }).format(Number(value))
    } catch (error) {
      return '$' + Number(value).toFixed(Number(value) % 1 ? 2 : 0)
    }
  }

  function positiveNumber(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null
  }

  function commercialSummary(proposal) {
    if (!proposal) return ''
    if (proposal.engagement_type === 'flat_fee') {
      var upfront = positiveNumber(proposal.paid_upfront_pct)
      return money(proposal.total_cost) + ' flat fee' + (upfront ? ' · ' + upfront + '% upfront' : '')
    }
    if (proposal.engagement_type === 'hourly') {
      var cap = positiveNumber(proposal.maximum_total_hours)
      var cadence = 'project'
      if (proposal.hourly_billing_frequency === 'weekly') {
        cap = positiveNumber(proposal.maximum_hours_per_week)
        cadence = 'week'
      } else if (proposal.hourly_billing_frequency === 'monthly') {
        cap = positiveNumber(proposal.maximum_hours_per_month)
        cadence = 'month'
      }
      return money(proposal.hourly_rate) + '/hr' + (cap ? ' · Up to ' + cap + ' hrs/' + cadence : '')
    }
    if (proposal.engagement_type === 'weekly') {
      var weeks = positiveNumber(proposal.number_of_weeks)
      return money(proposal.weekly_rate) + '/week' + (weeks ? ' · ' + weeks + ' weeks' : ' · Ongoing')
    }
    if (proposal.engagement_type === 'monthly') {
      var months = positiveNumber(proposal.number_of_months)
      return money(proposal.monthly_rate) + '/month' + (months ? ' · ' + months + ' months' : ' · Ongoing')
    }
    return ''
  }

  function titleCase(value) {
    return clean(value).replace(/_/g, ' ').replace(/\b\w/g, function (letter) {
      return letter.toUpperCase()
    })
  }

  function dateLabel(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(value))
    if (!match) return ''
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(date)
  }

  function scopePreview(value) {
    var normalized = clean(value).replace(/\s+/g, ' ')
    return normalized.length > 180 ? normalized.slice(0, 177).trimEnd() + '...' : normalized
  }

  function proposalDisplay(proposal) {
    return {
      status_label: 'Awaiting your approval',
      starter_name: proposal.starter_name,
      title: proposal.title,
      service: proposal.service,
      commercial_summary: commercialSummary(proposal),
      submitted_at: dateLabel(proposal.created_at),
      start_date: dateLabel(proposal.start_date),
      estimated_end_date: dateLabel(proposal.estimated_end_date),
      scope_preview: scopePreview(proposal.project_scope),
      project_scope: proposal.project_scope,
      engagement_type: titleCase(proposal.engagement_type),
      contract_type: proposal.contract_type === 'own_contract' ? 'Own Contract' : 'Standard Contract',
      invoice_frequency: titleCase(proposal.invoice_frequency),
    }
  }

  function decisionPayload(proposal, action, idempotencyKey) {
    if (!proposal || !positiveId(proposal.id)) throw new Error('Proposal is required')
    if (action !== 'accept' && action !== 'reject') throw new Error('Unsupported proposal action')
    var key = clean(idempotencyKey)
    if (!key) throw new Error('Idempotency key is required')
    return {
      proposal_id: proposal.id,
      expected_version: proposal.version,
      action: action,
      idempotency_key: key,
    }
  }

  function errorMessage(error) {
    var status = Number(error && error.status)
    if (status === 401) return 'Your session expired. Sign in and try again.'
    if (status === 403) return 'This project request is no longer available to your Brand account.'
    if (status === 409) return 'This request changed or was already handled. Refresh the request before continuing.'
    if (status === 422) return 'The project request could not be approved with these terms.'
    return 'The project request could not be updated. Try again.'
  }

  function setVisible(element, visible) {
    if (!element) return
    element.hidden = !visible
    if (element.style) element.style.display = visible ? '' : 'none'
    if (element.setAttribute) element.setAttribute('aria-hidden', visible ? 'false' : 'true')
  }

  function safeLink(value) {
    var href = clean(value)
    if (!href || /[\u0000-\u001f\u007f\\]/.test(href)) return ''
    if (/^https?:\/\//i.test(href)) return href
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || /^\/\//.test(href)) return ''
    return href
  }

  function paintFields(scope, proposal) {
    if (!scope || !scope.querySelectorAll) return
    var values = proposalDisplay(proposal)
    Array.prototype.forEach.call(scope.querySelectorAll(FIELD_SELECTOR), function (element) {
      var name = clean(element.getAttribute('data-project-proposal-field'))
      if (Object.prototype.hasOwnProperty.call(values, name)) element.textContent = values[name]
    })
    Array.prototype.forEach.call(scope.querySelectorAll('[data-project-proposal-link]'), function (link) {
      var type = clean(link.getAttribute('data-project-proposal-link'))
      var href = safeLink(type === 'profile' ? proposal.starter_profile_url : type === 'message' ? proposal.message_url : '')
      if (href) link.setAttribute('href', href)
      else link.removeAttribute('href')
      setVisible(link, Boolean(href))
    })
    Array.prototype.forEach.call(scope.querySelectorAll('[data-project-proposal-image="starter"]'), function (image) {
      if (proposal.starter_image_url) image.setAttribute('src', proposal.starter_image_url)
      else image.removeAttribute('src')
      image.setAttribute('alt', proposal.starter_name ? proposal.starter_name + ' profile photo' : '')
      setVisible(image, Boolean(proposal.starter_image_url))
    })
  }

  function clearCards(list) {
    if (!list || !list.querySelectorAll) return
    Array.prototype.forEach.call(list.querySelectorAll(CARD_SELECTOR), function (card) {
      if (!card.hasAttribute('data-project-proposal-template') && typeof card.remove === 'function') card.remove()
    })
  }

  function renderCards(list, template, proposals) {
    if (!list || !template || typeof template.cloneNode !== 'function') return 0
    clearCards(list)
    setVisible(template, false)
    proposals.forEach(function (proposal) {
      var card = template.cloneNode(true)
      card.removeAttribute('data-project-proposal-template')
      card.setAttribute('data-project-proposal-card', '')
      card.setAttribute('data-project-proposal-id', String(proposal.id))
      card.setAttribute('data-action-element', 'item')
      paintFields(card, proposal)
      setVisible(card, true)
      list.insertBefore(card, template)
    })
    return proposals.length
  }

  function proposalFromCard(card, proposals) {
    var id = positiveId(card && card.getAttribute('data-project-proposal-id'))
    return proposals.find(function (proposal) { return proposal.id === id }) || null
  }

  function makeKey(globalObject, proposal, action) {
    var uuid = globalObject.crypto && typeof globalObject.crypto.randomUUID === 'function'
      ? globalObject.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    return 'project-proposal-ui:' + proposal.id + ':' + proposal.version + ':' + action + ':' + uuid
  }

  function createController(options) {
    var globalObject = options.globalObject
    var documentObject = options.documentObject
    var list = options.list
    var template = options.template
    var modal = options.modal
    var api = options.api
    var instance = options.instance || null
    var state = {
      proposals: [],
      active: null,
      activeTrigger: null,
      pendingAction: null,
      keys: {},
      unsubscribe: null,
      generation: 0,
      resolved: {},
    }

    function feedback(message, isError) {
      var target = modal && modal.querySelector ? modal.querySelector(FEEDBACK_SELECTOR) : null
      if (target) {
        target.textContent = clean(message)
        target.setAttribute('role', isError ? 'alert' : 'status')
        target.setAttribute('aria-live', isError ? 'assertive' : 'polite')
        setVisible(target, Boolean(message))
      }
    }

    function announce(message, isError) {
      var target = documentObject && documentObject.querySelector
        ? documentObject.querySelector(GLOBAL_FEEDBACK_SELECTOR)
        : null
      if (target) {
        target.textContent = clean(message)
        target.setAttribute('role', isError ? 'alert' : 'status')
        target.setAttribute('aria-live', isError ? 'assertive' : 'polite')
        setVisible(target, Boolean(message))
      }
    }

    function confirmation(visible) {
      setVisible(modal && modal.querySelector ? modal.querySelector(CONFIRM_SELECTOR) : null, visible)
    }

    function actionControl(name) {
      return modal && modal.querySelector
        ? modal.querySelector('[data-project-proposal-action="' + name + '"]')
        : null
    }

    function lockActions(locked) {
      if (!modal || !modal.querySelectorAll) return
      Array.prototype.forEach.call(modal.querySelectorAll(ACTION_SELECTOR), function (control) {
        var name = clean(control.getAttribute('data-project-proposal-action'))
        if (name === 'message' || name === 'reject-cancel') return
        control.disabled = Boolean(locked)
        control.setAttribute('aria-disabled', locked ? 'true' : 'false')
      })
      modal.setAttribute('aria-busy', locked ? 'true' : 'false')
    }

    function paintActionCapabilities(proposal) {
      if (!proposal) return
      var alreadyResolved = Boolean(state.resolved[proposal.id])
      setVisible(actionControl('accept'), proposal.can_accept && !alreadyResolved)
      setVisible(actionControl('reject'), proposal.can_reject && !alreadyResolved)
      setVisible(actionControl('reject-confirm'), proposal.can_reject && !alreadyResolved)
      lockActions(Boolean(state.pendingAction))
    }

    function render(value) {
      state.proposals = normalizeProposals(value)
      renderCards(list, template, state.proposals)
      if (state.active) {
        var refreshedActive = state.proposals.find(function (item) { return item.id === state.active.id })
        if (!refreshedActive) {
          close()
        } else if (refreshedActive.version !== state.active.version) {
          close()
          announce('This project request changed. Review the latest request before continuing.', false)
        } else {
          state.active = refreshedActive
          paintActionCapabilities(refreshedActive)
        }
      }
      if (typeof globalObject.CustomEvent === 'function' && globalObject.dispatchEvent) {
        globalObject.dispatchEvent(new globalObject.CustomEvent('brandProjectProposalsChanged', {
          detail: { count: state.proposals.length },
        }))
      }
      return state.proposals
    }

    function show() {
      var entry = globalObject.lumos && globalObject.lumos.modal && globalObject.lumos.modal.list
        ? globalObject.lumos.modal.list[MODAL_ID]
        : null
      if (entry && typeof entry.open === 'function') entry.open()
      else if (modal && typeof modal.showModal === 'function') modal.showModal()
      else if (modal) modal.setAttribute('open', '')
      var heading = modal && modal.querySelector
        ? modal.querySelector('[data-project-proposal-heading], h1, h2')
        : null
      if (heading && typeof heading.focus === 'function') {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
        heading.focus()
      }
    }

    function close() {
      var entry = globalObject.lumos && globalObject.lumos.modal && globalObject.lumos.modal.list
        ? globalObject.lumos.modal.list[MODAL_ID]
        : null
      if (entry && typeof entry.close === 'function' && modal && modal.open) entry.close()
      else if (modal && typeof modal.close === 'function' && modal.open) modal.close()
      else if (modal) modal.removeAttribute('open')
      confirmation(false)
      feedback('', false)
      lockActions(Boolean(state.pendingAction))
      state.active = null
      var trigger = state.activeTrigger
      state.activeTrigger = null
      if (trigger && typeof trigger.focus === 'function') trigger.focus()
    }

    function open(proposal, trigger) {
      if (!proposal) return false
      state.active = proposal
      state.activeTrigger = trigger || null
      paintFields(modal, proposal)
      feedback('', false)
      confirmation(false)
      var alreadyResolved = Boolean(state.resolved[proposal.id])
      paintActionCapabilities(proposal)
      if (alreadyResolved) feedback('This project request was already handled. Refresh the dashboard to update the list.', false)
      show()
      return true
    }

    function currentState() {
      return instance && typeof instance.getState === 'function' ? instance.getState() : null
    }

    async function refresh() {
      if (instance && typeof instance.refresh === 'function') {
        await instance.refresh()
        var current = currentState()
        if (current && current.status === 'success') render(current)
        return current
      }
      if (!api || typeof api.brandProjectList !== 'function') return null
      var result = await api.brandProjectList(1, 12)
      render(result)
      return result
    }

    async function act(action) {
      var proposal = state.active
      if (!proposal || state.pendingAction) return false
      if (action === 'accept' && !proposal.can_accept) return false
      if (action === 'reject' && !proposal.can_reject) return false
      if (!api || typeof api.projectProposalAction !== 'function') {
        var unavailableMessage = 'Project request actions are not available. Reload and try again.'
        feedback(unavailableMessage, true)
        announce(unavailableMessage, true)
        return false
      }
      var scope = proposal.id + ':' + proposal.version + ':' + action
      if (!state.keys[scope]) state.keys[scope] = makeKey(globalObject, proposal, action)
      var request = {
        action: action,
        generation: state.generation,
        proposalId: proposal.id,
      }
      state.pendingAction = request
      lockActions(true)
      feedback('', false)
      try {
        var result = await api.projectProposalAction(decisionPayload(proposal, action, state.keys[scope]))
        if (state.pendingAction !== request) return false
        delete state.keys[scope]
        var resultProposal = result && result.proposal
        var resultProject = result && result.project
        var eventName = action === 'accept'
          ? 'starters:project-proposal-accepted'
          : 'starters:project-proposal-rejected'
        if (typeof globalObject.CustomEvent === 'function' && documentObject.dispatchEvent) {
          documentObject.dispatchEvent(new globalObject.CustomEvent(eventName, {
            detail: {
              proposal_id: positiveId(resultProposal && (resultProposal.id || resultProposal.proposal_id)) || proposal.id,
              project_id: positiveId(resultProject && (resultProject.id || resultProject.project_id)),
              replayed: Boolean(result && result.replayed),
            },
          }))
        }
        state.resolved[proposal.id] = true
        var successMessage = action === 'accept' ? 'Project approved and created.' : 'Project request declined.'
        if (state.active && state.active.id === request.proposalId) feedback(successMessage, false)
        announce(successMessage, false)
        try {
          await refresh()
        } catch (refreshError) {
          if (state.active && state.active.id === request.proposalId) {
            feedback(
              action === 'accept'
                ? 'Project approved. Refresh the dashboard to load the project.'
                : 'Project request declined. Refresh the dashboard to update the list.',
              false,
            )
          }
        }
        return true
      } catch (error) {
        if (state.pendingAction !== request) return false
        var safeError = errorMessage(error)
        if (state.active && state.active.id === request.proposalId) feedback(safeError, true)
        announce(safeError, true)
        if (Number(error && error.status) === 403 || Number(error && error.status) === 409) {
          try { await refresh() } catch (refreshError) { /* retain safe error */ }
        }
        return false
      } finally {
        if (state.pendingAction === request) {
          state.pendingAction = null
          lockActions(false)
        }
      }
    }

    function onClick(event) {
      var openTrigger = event.target && event.target.closest
        ? event.target.closest('[data-project-proposal-open]')
        : null
      if (openTrigger) {
        var card = openTrigger.closest(CARD_SELECTOR)
        var proposal = proposalFromCard(card, state.proposals)
        if (!proposal) return
        event.preventDefault()
        event.stopImmediatePropagation()
        open(proposal, openTrigger)
        return
      }
      var actionTarget = event.target && event.target.closest
        ? event.target.closest(ACTION_SELECTOR)
        : null
      if (!actionTarget || !modal || !actionTarget.closest || actionTarget.closest('[data-modal-target="' + MODAL_ID + '"]') !== modal) return
      var action = clean(actionTarget.getAttribute('data-project-proposal-action'))
      if (action === 'message') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (action === 'reject') {
        confirmation(true)
        var confirm = actionControl('reject-confirm')
        if (confirm && typeof confirm.focus === 'function') confirm.focus()
      } else if (action === 'reject-cancel') {
        confirmation(false)
        var reject = actionControl('reject')
        if (reject && typeof reject.focus === 'function') reject.focus()
      } else if (action === 'accept' || action === 'reject-confirm') {
        act(action === 'accept' ? 'accept' : 'reject')
      }
    }

    function subscribe() {
      if (!instance || typeof instance.subscribe !== 'function') return false
      state.unsubscribe = instance.subscribe(function (projectionState) {
        if (projectionState && projectionState.status === 'success') render(projectionState)
      })
      var current = currentState()
      if (current && current.status === 'success') render(current)
      return true
    }

    function reset() {
      state.generation += 1
      state.pendingAction = null
      state.proposals = []
      state.keys = {}
      state.resolved = {}
      clearCards(list)
      close()
      announce('', false)
    }

    function destroy() {
      reset()
      if (typeof state.unsubscribe === 'function') state.unsubscribe()
      state.unsubscribe = null
      documentObject.removeEventListener('click', onClick, true)
    }

    documentObject.addEventListener('click', onClick, true)

    return {
      act: act,
      close: close,
      destroy: destroy,
      open: open,
      refresh: refresh,
      render: render,
      reset: reset,
      state: state,
      subscribe: subscribe,
    }
  }

  function resolveInstance(globalObject) {
    return globalObject.WfXano && typeof globalObject.WfXano.get === 'function'
      ? globalObject.WfXano.get(INSTANCE_KEY)
      : null
  }

  function mount(globalObject) {
    var documentObject = globalObject && globalObject.document
    var path = clean(globalObject && globalObject.location && globalObject.location.pathname).replace(/\/+$/, '') || '/'
    if (!documentObject || path !== DASHBOARD_PATH) return null
    var template = documentObject.querySelector(TEMPLATE_SELECTOR)
    var modal = documentObject.querySelector('[data-modal-target="' + MODAL_ID + '"]')
    var list = template && template.parentNode
    if (!template || !list || !modal) return null
    var api = globalObject.Opp30 && globalObject.Opp30.API
    var controller = createController({
      globalObject: globalObject,
      documentObject: documentObject,
      list: list,
      template: template,
      modal: modal,
      api: api,
      instance: resolveInstance(globalObject),
    })
    if (!controller.subscribe()) controller.refresh().catch(function () { controller.render({ project_proposals: [] }) })
    globalObject.addEventListener(MEMBER_RESET_EVENT, function () {
      controller.reset()
      globalObject.setTimeout(function () { controller.refresh().catch(function () {}) }, 0)
    })
    globalObject.StartersBrandProjectProposalsV3 = controller
    return controller
  }

  var publicApi = {
    commercialSummary: commercialSummary,
    createController: createController,
    dateLabel: dateLabel,
    decisionPayload: decisionPayload,
    errorMessage: errorMessage,
    mount: mount,
    normalizeProposal: normalizeProposal,
    normalizeProposals: normalizeProposals,
    paintFields: paintFields,
    proposalDisplay: proposalDisplay,
    renderCards: renderCards,
    scopePreview: scopePreview,
    safeLink: safeLink,
  }

  if (isCommonJs) {
    module.exports = publicApi
    return
  }
  global.StartersBrandProjectProposals = publicApi
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', function () { mount(global) }, { once: true })
  } else {
    mount(global)
  }
})(typeof window !== 'undefined' ? window : globalThis)
