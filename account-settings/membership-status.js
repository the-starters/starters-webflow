/**
 * Account membership controls. Replaces the Account Settings inline status script.
 * @release pending
 */
;(function () {
  'use strict'

  if (window.__startersMembershipStatusInit) return
  window.__startersMembershipStatusInit = true

  const PAID_PLAN_IDS = [
    'pln_new-paid-plan-463h04ph',
    'pln_dorxata-test-brand-plan-777r02pa',
  ]
  const PAUSED_FIELDS = ['membership-paused', 'membership-is-paused', 'paused-membership']
  const PRICE_LABELS = {
    'prc_premium-monthly--fn1ae0qjj': '$295/mo',
    'prc_paid-annual-2o5f040u': '$2,340/yr',
    'prc_3-0-premium-monthly-ge4a00iw': '$495/mo',
    'prc_3-0-premium-annual-xhb200bu': '$3,540/yr',
    'prc_test-24h-trial-do-not-use-r5ae0vz6': '$495/mo',
  }
  const PRICE_SELECTOR = '[data-member-price="recurring"]'
  const SELECTORS = {
    projectComplete: '[data-project-status="complete"]',
    projectIncomplete: '[data-project-status="incomplete"]',
    memberActive: '[data-member-status="active"], [data-panel-nav-target="pause-membership"]',
    memberPaused: '[data-member-status="paused"], [data-members-status="paused"], [data-panel-nav-target="reactivate-membership"]',
  }
  const CANCEL_FLOW = '[data-form-flow="cancel-membership"]'
  const PAUSE_FLOW = '[data-form-flow="pause-membership"]'
  const PAUSE_CONTROLS = [
    '[data-member-status="pause-option"]',
    '[data-panel-nav-target="pause-membership"]',
    '[ms-form-cancel-state-change="pause"]',
    CANCEL_FLOW + ' [data-form-flow-button-group="step-2d-1"] [data-form-flow-action="next"]',
    PAUSE_FLOW + ' [data-form-flow-action="next"]',
  ].join(', ')
  const BLOCKED_ATTR = 'data-membership-pause-blocked'
  let lastMember = null
  let pauseBlocked = true
  let trialing = false
  let memberstack = null
  let revision = 0
  const trialShortcuts = new WeakSet()

  const truthy = (value) => value === true || value === 'True' || value === 'true'
  const status = (value) => String(value || '').trim().toUpperCase()
  const paidPlans = (member) => Array.isArray(member?.planConnections)
    ? member.planConnections.filter((plan) => PAID_PLAN_IDS.includes(plan?.planId))
    : []
  const unwrap = (payload) => payload?.data?.data ?? payload?.data ?? payload ?? null

  function show(el, visible) {
    if (visible) {
      el.style.removeProperty('display')
      el.removeAttribute('hidden')
    } else {
      el.style.display = 'none'
      el.setAttribute('hidden', '')
    }
    el.setAttribute('aria-hidden', visible ? 'false' : 'true')
  }

  function showAll(selector, visible) {
    document.querySelectorAll(selector).forEach((el) => show(el, visible))
  }

  function applyPauseControls() {
    document.querySelectorAll(PAUSE_CONTROLS).forEach((el) => {
      if (pauseBlocked) {
        el.setAttribute(BLOCKED_ATTR, 'true')
        el.setAttribute('inert', '')
        el.setAttribute('aria-hidden', 'true')
      } else {
        el.removeAttribute(BLOCKED_ATTR)
        el.removeAttribute('inert')
        // The membership state, form flow and panel controllers own normal visibility.
        if (!el.hasAttribute('hidden')) el.removeAttribute('aria-hidden')
      }
    })
  }

  function applyPrice(plans) {
    const current = plans.filter((plan) => plan.active !== false &&
      ['ACTIVE', 'TRIALING'].includes(status(plan.status)))
    const connection = current.length === 1 ? current[0] : null
    const priceId = connection?.payment?.priceId || connection?.priceId
    const label = Object.prototype.hasOwnProperty.call(PRICE_LABELS, priceId)
      ? PRICE_LABELS[priceId] : null
    const inTrial = connection && (status(connection.status) === 'TRIALING' ||
      status(connection.payment?.status) === 'TRIALING')
    const text = label ? label + (inTrial ? ' after your trial' : '') : 'Included'
    document.querySelectorAll(PRICE_SELECTOR).forEach((el) => {
      if (el.textContent !== text) el.textContent = text
    })
  }

  function apply(payload) {
    lastMember = unwrap(payload)
    const plans = paidPlans(lastMember)
    const activePlans = plans.filter((plan) => plan.active !== false)
    const currentPlans = activePlans.length ? activePlans : plans
    trialing = currentPlans.some((plan) => (
      status(plan.status) === 'TRIALING' || status(plan.payment?.status) === 'TRIALING'
    ))
    const pausedByField = PAUSED_FIELDS.some((field) => truthy(lastMember?.customFields?.[field]))
    const active = !pausedByField && plans.some((plan) => (
      ['ACTIVE', 'TRIALING'].includes(status(plan.status)) && plan.active !== false
    ))
    const paused = pausedByField || (plans.some((plan) => (
      status(plan.status) !== 'ACTIVE' || plan.active === false
    )) && !active)

    pauseBlocked = !lastMember || !plans.length || trialing
    const incomplete = truthy(lastMember?.customFields?.['incomplete-ongoing-project'])
    showAll(SELECTORS.projectComplete, !!lastMember && !incomplete)
    showAll(SELECTORS.projectIncomplete, !!lastMember && incomplete)
    showAll(SELECTORS.memberActive, !!lastMember && !!plans.length && active)
    showAll(SELECTORS.memberPaused, !!lastMember && !!plans.length && paused)
    applyPrice(plans)
    applyPauseControls()
  }

  function prevent(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function guardClick(event) {
    const target = event.target?.closest ? event.target : event.target?.parentElement
    if (!target) return
    if (pauseBlocked && target.closest(PAUSE_CONTROLS)) {
      prevent(event)
      return
    }
    const action = target.closest('[data-form-flow-action]')
    const flow = action?.closest(CANCEL_FLOW)
    if (!flow) return
    const controller = window.lumos?.formFlow?.list?.['cancel-membership']
    if (controller?.el !== flow) return
    if (trialShortcuts.has(flow) && action.getAttribute('data-form-flow-action') === 'back' &&
        action.closest('[data-form-flow-button-group="step-3"]') && typeof controller.reset === 'function') {
      prevent(event)
      trialShortcuts.delete(flow)
      controller.reset()
      return
    }
    if (action.getAttribute('data-form-flow-action') !== 'next' ||
        !action.closest('[data-form-flow-button-group="step-1"]')) return
    trialShortcuts.delete(flow)
    if (!trialing) return
    const checked = flow.querySelector('[data-form-flow-element="radio-list"] input[type="radio"]:checked')
    if (checked?.closest('[data-form-flow-value]')?.getAttribute('data-form-flow-value') !== 'step-2d') return

    // This branch only offers Pause. Use the existing flow API to reach cancellation.
    if (typeof controller.goTo !== 'function') return
    prevent(event)
    trialShortcuts.add(flow)
    controller.goTo('step-3')
  }

  function guardSubmit(event) {
    if (!pauseBlocked) return
    const form = event.target
    if (form?.closest(PAUSE_FLOW) ||
        form?.closest('[ms-form-cancel-state-current="pause"]') ||
        event.submitter?.closest(PAUSE_CONTROLS)) prevent(event)
  }

  async function refresh() {
    if (!memberstack || typeof memberstack.getCurrentMember !== 'function') return
    const requestRevision = ++revision
    try {
      const response = await memberstack.getCurrentMember()
      if (requestRevision === revision) apply(response)
    } catch (error) {
      if (requestRevision === revision) apply(null)
    }
  }

  function bind(client) {
    memberstack = client
    if (typeof client.onAuthChange === 'function') {
      client.onAuthChange((member) => {
        revision += 1
        apply(member)
      })
    }
    refresh()
  }

  function init() {
    const style = document.createElement('style')
    style.setAttribute('data-membership-status-style', '')
    style.textContent = '[' + BLOCKED_ATTR + '="true"] { display: none !important; }'
    ;(document.head || document.documentElement).appendChild(style)
    Object.values(SELECTORS).forEach((selector) => showAll(selector, false))
    applyPauseControls()
    document.addEventListener('click', guardClick, true)
    document.addEventListener('submit', guardSubmit, true)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    if (typeof MutationObserver === 'function') {
      new MutationObserver(() => apply(lastMember)).observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    }

    const startedAt = Date.now()
    function poll() {
      const client = window.$memberstackDom
      if (client && typeof client.getCurrentMember === 'function') {
        bind(client)
      } else if (Date.now() - startedAt < 10000) {
        window.setTimeout(poll, 100)
      }
    }
    poll()
  }

  window.StartersMembershipStatus = { refresh: refresh }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
