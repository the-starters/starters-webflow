/**
 * V3 Brand Dashboard pending Starter project-proposal controller.
 *
 * Webflow owns the Action Items row template. The controller prefers an authored
 * review dialog and creates a read-only fallback dialog when that Designer
 * element is not available yet. It binds the authenticated
 * `brand/projects/mine` proposal projection, paints read-only proposal terms,
 * and submits versioned accept/reject commands through Opp30. A proposal is
 * never treated as a canonical project before acceptance.
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
  var FALLBACK_STYLE_ID = 'brand-project-proposal-fallback-styles'
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

  function setAttributes(element, attributes) {
    if (!element || !element.setAttribute) return element
    Object.keys(attributes || {}).forEach(function (name) {
      var value = attributes[name]
      if (value === null || value === undefined) return
      element.setAttribute(name, String(value))
    })
    return element
  }

  function appendElement(documentObject, parent, tagName, attributes, text) {
    if (!documentObject || typeof documentObject.createElement !== 'function' || !parent) return null
    var element = documentObject.createElement(tagName)
    setAttributes(element, attributes)
    if (text !== undefined && text !== null) element.textContent = String(text)
    parent.appendChild(element)
    return element
  }

  function registerModalPart(modal, type, name, element) {
    if (!modal || !element) return element
    if (type === 'field') {
      modal.fields = modal.fields || []
      modal.fields.push(element)
    } else if (type === 'link') {
      modal.links = modal.links || []
      modal.links.push(element)
    } else if (type === 'image') {
      modal.images = modal.images || []
      modal.images.push(element)
    } else if (type === 'action') {
      modal.actions = modal.actions || {}
      modal.actions[name] = element
    }
    return element
  }

  function appendField(documentObject, modal, parent, name, tagName, className) {
    var field = appendElement(documentObject, parent, tagName || 'dd', {
      'data-project-proposal-field': name,
      'class': className || 'project-proposal-review_value',
    })
    return registerModalPart(modal, 'field', name, field)
  }

  function appendDetail(documentObject, modal, parent, label, fieldName) {
    var item = appendElement(documentObject, parent, 'div', { 'class': 'project-proposal-review_detail' })
    appendElement(documentObject, item, 'dt', { 'class': 'project-proposal-review_label' }, label)
    appendField(documentObject, modal, item, fieldName)
    return item
  }

  function ensureFallbackStyles(documentObject) {
    if (!documentObject || !documentObject.head || typeof documentObject.createElement !== 'function') return null
    if (documentObject.getElementById && documentObject.getElementById(FALLBACK_STYLE_ID)) return null
    var style = documentObject.createElement('style')
    style.id = FALLBACK_STYLE_ID
    style.textContent = [
      '.project-proposal-review_dialog{border:0;padding:0;width:min(48rem,calc(100vw - 2rem));max-height:calc(100vh - 2rem);background:#fff;color:#1d1f1d;}',
      '.project-proposal-review_dialog::backdrop{background:rgba(16,19,16,.68);}',
      '.project-proposal-review_layout{display:grid;gap:1.5rem;padding:clamp(1.25rem,3vw,2.5rem);max-height:calc(100vh - 2rem);overflow:auto;}',
      '.project-proposal-review_header{display:flex;justify-content:space-between;gap:1rem;align-items:start;}',
      '.project-proposal-review_close{border:0;background:transparent;font:inherit;cursor:pointer;padding:.25rem;}',
      '.project-proposal-review_byline{margin:0;color:#5d625d;}',
      '.project-proposal-review_grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem 1.5rem;margin:0;}',
      '.project-proposal-review_group{display:grid;gap:.75rem;padding-top:1rem;border-top:1px solid #d9ddd9;}',
      '.project-proposal-review_detail{display:grid;gap:.25rem;}',
      '.project-proposal-review_label{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#6d726d;}',
      '.project-proposal-review_value{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;}',
      '.project-proposal-review_actions{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;}',
      '.project-proposal-review_button{border:1px solid #1d1f1d;background:#fff;color:#1d1f1d;padding:.75rem 1rem;font:inherit;cursor:pointer;}',
      '.project-proposal-review_button.is-primary{background:#1d1f1d;color:#fff;}',
      '.project-proposal-review_button.is-danger{border-color:#b3261e;color:#b3261e;}',
      '.project-proposal-review_feedback{padding:.75rem;background:#f1f3f1;}',
      '.project-proposal-review_confirm{display:grid;gap:.75rem;padding:1rem;border:1px solid #d9ddd9;}',
      '@media(max-width:47.99rem){.project-proposal-review_grid{grid-template-columns:1fr;}}',
    ].join('')
    documentObject.head.appendChild(style)
    return style
  }

  function createFallbackReviewModal(documentObject) {
    if (!documentObject || !documentObject.body || typeof documentObject.createElement !== 'function') return null
    ensureFallbackStyles(documentObject)

    var modal = appendElement(documentObject, documentObject.body, 'dialog', {
      'class': 'modal_dialog project-proposal-review_dialog',
      'data-modal-target': MODAL_ID,
      'data-project-proposal-generated': 'true',
      'aria-labelledby': 'project-proposal-review-heading',
    })
    if (!modal) return null

    var layout = appendElement(documentObject, modal, 'div', { 'class': 'project-proposal-review_layout' })
    var header = appendElement(documentObject, layout, 'div', { 'class': 'project-proposal-review_header' })
    var heading = appendElement(documentObject, header, 'h2', {
      'id': 'project-proposal-review-heading',
      'data-project-proposal-heading': '',
      'tabindex': '-1',
    }, 'Review project request')
    modal.heading = heading
    var closeButton = appendElement(documentObject, header, 'button', {
      'type': 'button',
      'class': 'project-proposal-review_close',
      'data-project-proposal-action': 'close',
      'aria-label': 'Close project request review',
    }, 'Close')
    registerModalPart(modal, 'action', 'close', closeButton)

    var byline = appendElement(documentObject, layout, 'p', { 'class': 'project-proposal-review_byline' })
    appendElement(documentObject, byline, 'span', {}, 'Review the terms submitted by ')
    appendField(documentObject, modal, byline, 'starter_name', 'strong', 'project-proposal-review_value')
    appendElement(documentObject, byline, 'span', {}, '. Approving creates the project with these terms.')

    var starterGroup = appendElement(documentObject, layout, 'section', { 'class': 'project-proposal-review_group' })
    appendElement(documentObject, starterGroup, 'h3', {}, 'Starter')
    var starterImage = appendElement(documentObject, starterGroup, 'img', {
      'data-project-proposal-image': 'starter',
      'class': 'project-proposal-review_image',
      'width': '64',
      'height': '64',
    })
    registerModalPart(modal, 'image', 'starter', starterImage)
    appendField(documentObject, modal, starterGroup, 'starter_name', 'p')
    var profileLink = appendElement(documentObject, starterGroup, 'a', {
      'data-project-proposal-link': 'profile',
      'class': 'project-proposal-review_link',
    }, 'View Starter profile')
    registerModalPart(modal, 'link', 'profile', profileLink)

    var projectGroup = appendElement(documentObject, layout, 'section', { 'class': 'project-proposal-review_group' })
    appendElement(documentObject, projectGroup, 'h3', {}, 'Project')
    var projectGrid = appendElement(documentObject, projectGroup, 'dl', { 'class': 'project-proposal-review_grid' })
    appendDetail(documentObject, modal, projectGrid, 'Project name', 'title')
    appendDetail(documentObject, modal, projectGrid, 'Service', 'service')
    appendDetail(documentObject, modal, projectGrid, 'Proposed start date', 'start_date')
    appendDetail(documentObject, modal, projectGrid, 'Estimated end date', 'estimated_end_date')

    var pricingGroup = appendElement(documentObject, layout, 'section', { 'class': 'project-proposal-review_group' })
    appendElement(documentObject, pricingGroup, 'h3', {}, 'Pricing and contract')
    var pricingGrid = appendElement(documentObject, pricingGroup, 'dl', { 'class': 'project-proposal-review_grid' })
    appendDetail(documentObject, modal, pricingGrid, 'Fee structure', 'engagement_type')
    appendDetail(documentObject, modal, pricingGrid, 'Commercial terms', 'commercial_summary')
    appendDetail(documentObject, modal, pricingGrid, 'Contract', 'contract_type')
    appendDetail(documentObject, modal, pricingGrid, 'Invoice frequency', 'invoice_frequency')

    var scopeGroup = appendElement(documentObject, layout, 'section', { 'class': 'project-proposal-review_group' })
    appendElement(documentObject, scopeGroup, 'h3', {}, 'Project scope')
    appendField(documentObject, modal, scopeGroup, 'project_scope', 'p')

    var feedback = appendElement(documentObject, layout, 'p', {
      'class': 'project-proposal-review_feedback',
      'data-project-proposal-feedback': '',
      'role': 'status',
      'aria-live': 'polite',
      'hidden': '',
    })
    feedback.hidden = true
    modal.feedback = feedback

    var actions = appendElement(documentObject, layout, 'div', { 'class': 'project-proposal-review_actions' })
    var message = appendElement(documentObject, actions, 'a', {
      'class': 'project-proposal-review_button',
      'data-project-proposal-action': 'message',
      'data-project-proposal-link': 'message',
    }, 'Message Starter')
    registerModalPart(modal, 'action', 'message', message)
    registerModalPart(modal, 'link', 'message', message)
    var reject = appendElement(documentObject, actions, 'button', {
      'type': 'button',
      'class': 'project-proposal-review_button is-danger',
      'data-project-proposal-action': 'reject',
    }, 'Decline Request')
    registerModalPart(modal, 'action', 'reject', reject)
    var accept = appendElement(documentObject, actions, 'button', {
      'type': 'button',
      'class': 'project-proposal-review_button is-primary',
      'data-project-proposal-action': 'accept',
    }, 'Approve & Create Project')
    registerModalPart(modal, 'action', 'accept', accept)

    var confirm = appendElement(documentObject, layout, 'div', {
      'class': 'project-proposal-review_confirm',
      'data-project-proposal-confirm': 'reject',
      'hidden': '',
    })
    confirm.hidden = true
    modal.confirm = confirm
    appendElement(documentObject, confirm, 'p', {}, 'Decline this project request? The Starter will need to submit a new request if you want to use different terms.')
    var confirmActions = appendElement(documentObject, confirm, 'div', { 'class': 'project-proposal-review_actions' })
    var cancelReject = appendElement(documentObject, confirmActions, 'button', {
      'type': 'button',
      'class': 'project-proposal-review_button',
      'data-project-proposal-action': 'reject-cancel',
    }, 'Keep Request')
    registerModalPart(modal, 'action', 'reject-cancel', cancelReject)
    var confirmReject = appendElement(documentObject, confirmActions, 'button', {
      'type': 'button',
      'class': 'project-proposal-review_button is-danger',
      'data-project-proposal-action': 'reject-confirm',
    }, 'Decline Request')
    registerModalPart(modal, 'action', 'reject-confirm', confirmReject)
    return modal
  }

  function replaceExactText(root, before, after) {
    if (!root || !root.querySelectorAll) return false
    var candidates = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')))
      .filter(function (element) { return clean(element.textContent) === before })
      .sort(function (left, right) {
        return left.querySelectorAll('*').length - right.querySelectorAll('*').length
      })
    if (!candidates.length) return false
    candidates[0].textContent = after
    return true
  }

  function prepareFallbackCard(card) {
    if (!card || !card.querySelector) return card
    if (!card.querySelector(FIELD_SELECTOR)) {
      var status = card.querySelector('.label_text')
      var title = card.querySelector('.action-item_title')
      if (status) status.setAttribute('data-project-proposal-field', 'status_label')
      if (title) title.setAttribute('data-project-proposal-field', 'title')
    }
    if (!card.querySelector('[data-project-proposal-open]')) {
      var buttons = card.querySelectorAll('.button_main-wrap')
      var opener = buttons && buttons[0]
      if (opener) {
        opener.setAttribute('data-project-proposal-open', '')
        opener.setAttribute('aria-label', 'Review project request')
        replaceExactText(opener, 'Post Opportunity', 'Review request')
      }
      if (buttons && buttons[1]) setVisible(buttons[1], false)
    }
    return card
  }

  function ensureGlobalFeedback(documentObject, list) {
    if (!documentObject || !list) return null
    var existing = documentObject.querySelector
      ? documentObject.querySelector(GLOBAL_FEEDBACK_SELECTOR)
      : null
    if (existing) return existing
    var target = appendElement(documentObject, list, 'p', {
      'class': 'project-proposal-review_feedback',
      'data-project-proposal-global-feedback': '',
      'role': 'status',
      'aria-live': 'polite',
      'hidden': '',
    })
    if (target) target.hidden = true
    return target
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
      prepareFallbackCard(card)
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
      if (action === 'close') {
        close()
      } else if (action === 'reject') {
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
      if (modal && modal.removeEventListener) modal.removeEventListener('cancel', onModalCancel)
    }

    function onModalCancel(event) {
      if (event && event.preventDefault) event.preventDefault()
      close()
    }

    documentObject.addEventListener('click', onClick, true)
    if (modal && modal.addEventListener) modal.addEventListener('cancel', onModalCancel)

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
    if (!template || !list) return null
    ensureGlobalFeedback(documentObject, list)
    if (!modal) modal = createFallbackReviewModal(documentObject)
    if (!modal) return null
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
    createFallbackReviewModal: createFallbackReviewModal,
    createController: createController,
    dateLabel: dateLabel,
    decisionPayload: decisionPayload,
    errorMessage: errorMessage,
    ensureGlobalFeedback: ensureGlobalFeedback,
    mount: mount,
    normalizeProposal: normalizeProposal,
    normalizeProposals: normalizeProposals,
    paintFields: paintFields,
    prepareFallbackCard: prepareFallbackCard,
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
