/*!
 * Opportunities 3.0 — Webflow ↔ Xano binder
 * ------------------------------------------------------------------
 * Wires the existing 3.0 UI (pages + modals on /all-modals) to the
 * authenticated "Opportunities 3.0" Xano API group.
 *
 * Load this ONCE per opportunities page via a page (or site) custom-code
 * embed, AFTER @xano/js-sdk and memberstack-x have loaded (footer).
 *
 * Auth model (important):
 *   1. Memberstack issues a member JWT on login.
 *   2. We trade it at  api:g1vmSLWh/auth/trade-token/v3  for a Xano auth token.
 *   3. That Xano token authorizes the opportunities calls at  api:opp30/...
 *      ($auth.id -> user_v3 -> brands_v3.memberstack_id | freelancers_v3.memberstack_id)
 *
 * The Xano `user_v3` table must already contain a row whose
 * memberstack_member_id matches the logged-in member, or trade-token 404s.
 * ------------------------------------------------------------------
 */
(function () {
  'use strict'

  // Run-once guard: window.Opp30 is set at the end of this IIFE, so a second
  // load (duplicate embed, Webflow re-init) returns here instead of re-binding.
  if (window.Opp30) return

  /* ============================ CONFIG ============================ */
  /** Verbose console logging during rollout; set false for production quiet. @type {boolean} */
  const DEBUG_LOG = true
  /**
   * Namespaced console logger; no-op unless DEBUG_LOG.
   * @param {...unknown} args
   * @returns {void}
   */
  const log = (...args) => {
    if (DEBUG_LOG) console.info('[opp30]', ...args)
  }

  const XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh' // WMX group: trade-token
  const XANO_OPP_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30' // Opportunities 3.0 group
  const XANO_TRADE_TOKEN_PATH = '/auth/trade-token/v3'

  // project_type: modal radio id  ->  human string Xano stores / display logic expects
  const PROJECT_TYPE = {
    'One-Time': 'One Time',
    'Ongoing-Part-Time': 'Ongoing Part Time',
    'Full-Time': 'Full Time',
  }
  // budget_frequency derived from project_type (confirm with product)
  const BUDGET_FREQUENCY = {
    'One Time': 'project',
    'Ongoing Part Time': 'month',
    'Full Time': 'year',
  }

  /* ========================= AUTH BRIDGE ========================== */
  let _xanoToken = null

  async function getMemberstackToken() {
    const ms = window.$memberstackDom
    if (!ms) throw new Error('Memberstack not available')
    // getMemberCookie() returns the member JWT (string). Awaiting is safe either way.
    const token = await ms.getMemberCookie()
    if (!token) throw new Error('No Memberstack session (member not logged in)')
    return token
  }

  async function ensureXanoToken() {
    if (_xanoToken) return _xanoToken
    const msToken = await getMemberstackToken()
    const res = await fetch(
      `${XANO_AUTH_BASE}${XANO_TRADE_TOKEN_PATH}?token=${encodeURIComponent(msToken)}`,
    )
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw Object.assign(new Error('trade-token failed'), { status: res.status, data })
    }
    // create_auth_token may return a raw string or { authToken }/{ token }
    _xanoToken = typeof data === 'string' ? data : data.authToken || data.token
    if (!_xanoToken) throw new Error('trade-token returned no token')
    return _xanoToken
  }

  async function call(path, { method = 'POST', body } = {}) {
    const token = await ensureXanoToken()
    const res = await fetch(`${XANO_OPP_BASE}/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw Object.assign(new Error(data && data.message ? data.message : `API ${res.status}`), {
        status: res.status,
        data,
      })
    }
    return data
  }

  /* ===================== ENDPOINT WRAPPERS ======================= */
  // Lists return Xano paged objects: { items: [...], itemsTotal, curPage, ... }
  const API = {
    // brand
    brandOppList: (status, page = 1, per_page = 20) =>
      call('brand/opportunities/list', { body: { status, page, per_page } }),
    brandOppCreate: (payload) => call('brand/opportunities/create', { body: payload }),
    brandOppUpdate: (opportunity_id, payload) =>
      call('brand/opportunities/update', { method: 'PATCH', body: { opportunity_id, ...payload } }),
    brandOppClose: (opportunity_id) =>
      call('brand/opportunities/close', { method: 'PATCH', body: { opportunity_id } }),
    brandAppList: (opportunity_id, archived = false, page = 1, per_page = 20) =>
      call('brand/applications/list', { body: { opportunity_id, archived, page, per_page } }),
    brandAppArchive: (application_id) =>
      call('brand/applications/archive', { method: 'PATCH', body: { application_id } }),
    brandAppRestore: (application_id) =>
      call('brand/applications/restore', { method: 'PATCH', body: { application_id } }),
    // starter / talent
    starterMatchContext: () => call('starter/profile/match-context', { body: {} }),
    starterOppList: (tab, page = 1, per_page = 20) =>
      call('starter/opportunities/list', { body: { tab, page, per_page } }),
    starterOppDetail: (opportunity_id) =>
      call('starter/opportunities/detail', { body: { opportunity_id } }),
    starterAppSubmit: (opportunity_id, message) =>
      call('starter/applications/submit', { body: { opportunity_id, message } }),
    starterAppUpdate: (application_id, message) =>
      call('starter/applications/update', { method: 'PATCH', body: { application_id, message } }),
    starterAppCancel: (application_id) =>
      call('starter/applications/cancel', { method: 'PATCH', body: { application_id } }),
    starterAppMarkSeen: (application_id) =>
      call('starter/applications/mark_seen', { method: 'PATCH', body: { application_id } }),
  }

  /* ========================= HELPERS ============================= */
  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))
  const urlParam = (k) => new URL(location.href).searchParams.get(k)

  const fmtDate = (ts) =>
    ts ? new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''

  // Read a modal/form's fields by their existing Webflow `name` attributes.
  function readOpportunityForm(scope) {
    const val = (name) => {
      const el = scope.querySelector(`[name="${name}"]`)
      return el ? el.value.trim() : ''
    }
    const multiVal = (name) => {
      const values = []
      const seen = new Set()
      const add = (raw) => {
        String(raw || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => {
            const key = part.toLowerCase()
            if (!seen.has(key)) {
              seen.add(key)
              values.push(part)
            }
          })
      }

      $$(`[name="${name}"]`, scope).forEach((el) => {
        if (el instanceof HTMLSelectElement && el.multiple) {
          Array.from(el.selectedOptions).forEach((opt) => add(opt.value || opt.textContent))
          return
        }
        if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
          if (el.checked) add(el.value)
          return
        }
        if ('value' in el) add(el.value)
      })

      $$('[data-opp-role-value][aria-selected="true"], [data-opp-role-value].is-selected, [data-opp-role-value].w--current', scope).forEach((el) => {
        add(el.getAttribute('data-opp-role-value') || el.textContent)
      })

      return values.join(', ')
    }
    const checked = (name) => {
      const el = scope.querySelector(`[name="${name}"]:checked`)
      return el ? el.id : '' // project_type radios are keyed by id -> PROJECT_TYPE
    }
    const checkedVal = (name) => {
      const el = scope.querySelector(`[name="${name}"]:checked`)
      return el ? el.value : '' // duration is stored as its human label (e.g. "≤ 1 months")
    }
    const ptId = checked('Project-Type')
    const project_type = PROJECT_TYPE[ptId] || ptId
    // budget: one of three inputs is visible/required per project type
    const budget =
      val('One-Time-Budget') || val('Part-Time-Budget') || val('Full-Time-Budget')
    return {
      title: val('Opportunity-title'),
      description: val('Description'),
      exp_requirements: val('Requirements'),
      role_name: multiVal('Role-option') || multiVal('Function'),
      project_type,
      est_project_duration: checkedVal('Duration'),
      budget,
      budget_frequency: BUDGET_FREQUENCY[project_type] || '',
      // Xano resolves role_name -> function/category/subcategory refs via v3 taxonomy tables.
    }
  }

  // Application UI state (mirrors plan Phase 4). a = application row, o = opportunity.
  function appState(o, a) {
    if (!a) return 'not-applied'
    if (a.canceled_at) return 'canceled'
    if (a.archived_by_brand) return 'archived'
    if (o && o.closed_at) return 'closed'
    if (o && a.seen_opportunity_revision != null && o.revision_number > a.seen_opportunity_revision)
      return 'edited'
    return 'applied'
  }

  // Toggle elements tagged [data-opp-state="applied|edited|..."] under a root.
  function paintState(root, state) {
    $$('[data-opp-state]', root).forEach((el) => {
      const states = el.getAttribute('data-opp-state').split(/\s+/)
      el.style.display = states.includes(state) ? '' : 'none'
    })
  }

  /* ============== MEMBERSTACK GATE (reused from v2) ============== */
  async function gateOrRedirect(expect /* 'brand' | 'freelancer' */) {
    const { data: member } = await window.$memberstackDom.getCurrentMember()
    if (!member || !member.id) {
      location.href = '/login'
      return null
    }
    const cf = member.customFields || {}
    if (expect === 'freelancer' && !cf['freelancer-dashboard-url']) {
      location.href = cf['brands-dashboard-url'] ? '/opportunities-brands-view' : '/'
      return null
    }
    if (expect === 'brand' && !cf['brands-dashboard-url']) {
      location.href = cf['freelancer-dashboard-url'] ? '/opportunities-freelancer-view' : '/'
      return null
    }
    return member
  }

  /* ===================== GENERIC LIST RENDER ===================== */
  // Renders into [data-opp-list="<key>"] by cloning its [data-opp-card] template
  // and filling child [data-opp-bind="<field>"] / [data-opp-bind-id] elements.
  function renderList(listKey, items, fill) {
    const list = $(`[data-opp-list="${listKey}"]`)
    if (!list) return
    const tpl = $('[data-opp-card]', list)
    if (!tpl) return
    const empty = $(`[data-opp-empty="${listKey}"]`)
    // clear previously rendered (keep the template, hidden)
    $$('[data-opp-card]', list).forEach((c, i) => i > 0 && c.remove())
    tpl.style.display = 'none'
    if (!items || !items.length) {
      if (empty) empty.style.display = ''
      return
    }
    if (empty) empty.style.display = 'none'
    items.forEach((item) => {
      const card = tpl.cloneNode(true)
      card.style.display = ''
      card.setAttribute('data-opp-id', item.id)
      fill(card, item)
      list.appendChild(card)
    })
  }

  const bind = (card, field, value) => {
    const el = $(`[data-opp-bind="${field}"]`, card)
    if (el) el.textContent = value == null ? '' : value
  }

  /* ===================== PAGE CONTROLLERS ======================== */
  async function initBrandList() {
    if (!(await gateOrRedirect('brand'))) return
    const filter = $('[data-opp-filter]') // optional <select> with values '', Active, Pending Review, Closed
    const load = async (status) => {
      const res = await API.brandOppList(status || '')
      renderList('brand-opps', res.items, (card, o) => {
        bind(card, 'title', o.title)
        bind(card, 'company', o.company)
        bind(card, 'project_type', o.project_type)
        bind(card, 'est_project_duration', o.est_project_duration)
        bind(card, 'est_hours', o.est_hours)
        bind(card, 'budget', o.budget)
        bind(card, 'budget_frequency', o.budget_frequency)
        bind(card, 'status', o.status)
        bind(card, 'created_at', fmtDate(o.created_at))
        const link = $('[data-opp-detail-link]', card)
        if (link) link.href = `/opportunities-details---brand-view?opp=${o.id}`
      })
    }
    await load(filter ? filter.value : '')
    if (filter) filter.addEventListener('change', (e) => load(e.target.value))
  }

  async function initBrandDetail() {
    if (!(await gateOrRedirect('brand'))) return
    const oppId = parseInt(urlParam('opp'), 10)
    if (!oppId) return (location.href = '/opportunities-brands-view')
    setActiveOpp(oppId)
    const showArchived = false
    const res = await API.brandAppList(oppId, showArchived)
    renderList('applicants', res.items, (card, a) => {
      card.setAttribute('data-app-id', a.id)
      bind(card, 'message', a.message)
      bind(card, 'submitted_at', fmtDate(a.submitted_at))
      // applicant profile fields come from the joined starter record if the endpoint returns it
    })
    const count = $('[data-opp-bind="applicant_count"]')
    if (count) count.textContent = res.itemsTotal != null ? res.itemsTotal : res.items.length
  }

  async function initTalentList() {
    if (!(await gateOrRedirect('freelancer'))) return
    if (!$('[wf-algolia-element="results"]')) {
      handleMissingTalentAlgoliaMarkup()
      return
    }
    const tabsBound = await initTalentTabs()
    if (!tabsBound) await initTalentAlgoliaMatch()
  }

  function handleMissingTalentAlgoliaMarkup() {
    document.documentElement.setAttribute('data-opp30-talent-algolia', 'missing-markup')
    const legacyList = $('.opportunities-list_collection-list') || $('[data-opp-list="talent-opps"]')
    if (legacyList) legacyList.style.display = 'none'
    const empty = $('.section_opportunities-empty') || $('[data-opp-empty="talent-opps"]')
    if (empty) empty.style.display = ''
    console.error(
      '[opp30] /opportunities-freelancer-view must be wired as a wf-algolia browse feed; no [wf-algolia-element="results"] container was found.',
    )
  }

  function filterValues(values) {
    return Array.from(
      new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => parseInt(value, 10))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map(String),
      ),
    )
  }

  function waitForWfAlgolia(timeoutMs = 10000) {
    if (window.WfAlgolia && typeof window.WfAlgolia.setFilter === 'function') {
      return Promise.resolve(window.WfAlgolia)
    }
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = window.setInterval(() => {
        if (window.WfAlgolia && typeof window.WfAlgolia.setFilter === 'function') {
          window.clearInterval(timer)
          resolve(window.WfAlgolia)
          return
        }
        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  let _talentMatchContextPromise = null

  function getTalentMatchContext() {
    if (!_talentMatchContextPromise) _talentMatchContextPromise = API.starterMatchContext()
    return _talentMatchContextPromise
  }

  async function initTalentAlgoliaMatch() {
    try {
      const context = await getTalentMatchContext()
      const categoryRefs = filterValues(context && context.category_refs)
      window.Opp30TalentMatchContext = context
      log('talent algolia match context', {
        starter_id: context && context.starter_id,
        category_refs: categoryRefs,
        subcategory_refs: filterValues(context && context.subcategory_refs),
      })
      if (!categoryRefs.length) return

      const wfAlgolia = await waitForWfAlgolia()
      if (!wfAlgolia) {
        console.warn('[opp30] wf-algolia unavailable; talent match filter skipped')
        return
      }
      wfAlgolia.setFilter('category_refs', categoryRefs)
    } catch (err) {
      console.error('[opp30] failed to apply talent Algolia match filter', err)
    }
  }

  function normalizeTalentTab(value) {
    const tab = String(value || '').trim().toLowerCase()
    return tab === 'applied' ? 'applied' : 'all'
  }

  function getTalentAllPanel() {
    return $('[data-opp-talent-panel="all"]') || $('[wf-algolia-element="browse"]')
  }

  function getTalentAppliedPanel() {
    const list = $('[data-opp-list="talent-applied"]')
    return $('[data-opp-talent-panel="applied"]') || (list && list.closest('[data-opp-talent-panel]')) || list
  }

  function getInitialTalentTab() {
    const checked = $$('[data-opp-talent-tab]').find((el) => 'checked' in el && el.checked)
    return normalizeTalentTab((checked || $('[data-opp-talent-tab]') || {}).getAttribute?.('data-opp-talent-tab'))
  }

  function syncTalentTabControls(activeTab) {
    $$('[data-opp-talent-tab]').forEach((el) => {
      const tab = normalizeTalentTab(el.getAttribute('data-opp-talent-tab'))
      const active = tab === activeTab
      if ('checked' in el && /^(radio|checkbox)$/i.test(el.type || '')) el.checked = active
      el.setAttribute('aria-pressed', active ? 'true' : 'false')
      el.classList.toggle('is-active', active)
    })
  }

  async function initTalentTabs() {
    const controls = $$('[data-opp-talent-tab]')
    if (!controls.length) return false
    controls.forEach((control) => {
      if (control.__opp30TalentTabWired) return
      control.__opp30TalentTabWired = true
      const activate = (event) => {
        const target = event.currentTarget || event.target || control
        if (/^radio$/i.test(target.type || '') && !target.checked) return
        setTalentTab(target.getAttribute('data-opp-talent-tab'))
      }
      control.addEventListener('change', activate)
      control.addEventListener('click', activate)
    })
    await setTalentTab(getInitialTalentTab())
    return true
  }

  async function setTalentTab(value) {
    const tab = normalizeTalentTab(value)
    const allPanel = getTalentAllPanel()
    const appliedPanel = getTalentAppliedPanel()
    if (tab === 'applied' && !appliedPanel) {
      document.documentElement.setAttribute('data-opp30-talent-tab', 'all')
      if (allPanel) allPanel.style.display = ''
      syncTalentTabControls('all')
      console.warn(
        '[opp30] Applied tab selected, but no [data-opp-talent-panel="applied"] or [data-opp-list="talent-applied"] exists.',
      )
      return
    }

    document.documentElement.setAttribute('data-opp30-talent-tab', tab)
    if (allPanel) allPanel.style.display = tab === 'all' ? '' : 'none'
    if (appliedPanel) appliedPanel.style.display = tab === 'applied' ? '' : 'none'
    syncTalentTabControls(tab)

    if (tab === 'all') {
      await initTalentAlgoliaMatch()
      return
    }
    await loadTalentAppliedList()
  }

  function normalizeAppliedItem(item) {
    const opportunity =
      item.opportunity ||
      item.opportunities_v3 ||
      item.opportunity_v3 ||
      item.opportunity_record ||
      {}
    const opportunityId =
      opportunity.id || item.opportunity_id || item.opportunities_v3_id || item.opportunity
    return {
      ...opportunity,
      id: opportunityId || item.id,
      opportunity_id: opportunityId || item.id,
      application_id: item.id,
      message: item.message || opportunity.message || '',
      submitted_at: item.submitted_at || item.created_at || '',
      title: opportunity.title || item.opportunity_title || item.title || '',
      company: opportunity.company || item.company || '',
      project_type: opportunity.project_type || item.project_type || '',
      est_project_duration: opportunity.est_project_duration || item.est_project_duration || '',
      budget: opportunity.budget || item.budget || '',
      budget_frequency: opportunity.budget_frequency || item.budget_frequency || '',
      description: opportunity.description || item.description || item.message || '',
      status: opportunity.status || item.status || 'Applied',
      created_at: opportunity.created_at || item.opportunity_created_at || '',
    }
  }

  async function loadTalentAppliedList() {
    const list = $('[data-opp-list="talent-applied"]')
    if (!list) return
    if (list.getAttribute('data-opp-loading') === 'true') return
    list.setAttribute('data-opp-loading', 'true')
    try {
      const res = await API.starterOppList('Applied')
      const raw = Array.isArray(res) ? res : Array.isArray(res && res.items) ? res.items : []
      const items = raw.map(normalizeAppliedItem)
      renderList('talent-applied', items, (card, o) => {
        card.setAttribute('data-opp-id', o.opportunity_id || o.id)
        if (o.application_id) card.setAttribute('data-app-id', o.application_id)
        bind(card, 'title', o.title)
        bind(card, 'company', o.company)
        bind(card, 'description', o.description)
        bind(card, 'project_type', o.project_type)
        bind(card, 'est_project_duration', o.est_project_duration)
        bind(card, 'budget', o.budget)
        bind(card, 'budget_frequency', o.budget_frequency)
        bind(card, 'message', o.message)
        bind(card, 'submitted_at', fmtDate(o.submitted_at))
        bind(card, 'created_at', fmtDate(o.created_at))
        bind(card, 'status', o.status)
        const link = $('[data-opp-detail-link]', card)
        if (link && (o.opportunity_id || o.id)) link.href = `/opportunities/${o.opportunity_id || o.id}`
        paintState(card, 'applied')
      })
    } catch (err) {
      console.error('[opp30] failed to load applied opportunities', err)
      const empty = $('[data-opp-empty="talent-applied"]')
      if (empty) empty.style.display = ''
    } finally {
      list.setAttribute('data-opp-loading', 'false')
    }
  }

  async function initTalentDetail() {
    if (!(await gateOrRedirect('freelancer'))) return
    // Slug IS the Xano ID (e.g. /opportunities/591)
    const oppId = parseInt(location.pathname.split('/').pop(), 10)
    if (!oppId) return (location.href = '/opportunities-freelancer-view')
    // CMS page already renders opportunity content — only fetch auth state
    const { opportunity: o, application: a } = await API.starterOppDetail(oppId)
    setActiveOpp(oppId)
    if (a) setActiveApp(a.id)
    paintState(document, appState(o, a))
    // mark-seen: flip edited → applied when the member views the updated opportunity
    if (a && appState(o, a) === 'edited') {
      try {
        await API.starterAppMarkSeen(a.id)
        paintState(document, 'applied')
      } catch (e) {
        /* non-fatal */
      }
    }
    // prefill the edit-application modal's Cover-Letter
    if (a) {
      const cl = $('[name="Cover-Letter"]', $('[data-modal-target="edit-application"]') || document)
      if (cl) cl.value = a.message || ''
    }
  }

  // Standalone brand "create opportunity" PAGE (/opportunities---create).
  // Unlike the modal, this is a full Webflow form (#email-form.create-opportunities_layout)
  // with a native submit button and no [data-opp-submit] hook, so we bind it directly.
  async function initBrandCreatePage() {
    // Shared run-once flag with v3/opportunities---create.js — whichever loads
    // first binds the form; the other no-ops (prevents double submit).
    if (window.__opp30CreatePage) return
    window.__opp30CreatePage = true
    if (!(await gateOrRedirect('brand'))) return
    const form = $('[data-opp-form="create"]') || $('form.create-opportunities_layout') || $('#email-form')
    if (!form) return
    log('create page form bound', form)
    const status = $('[data-opp-create-status]') // optional inline message element
    const say = (m) => {
      if (status) status.textContent = m
      else if (m) console.info('[opp30:create]', m)
    }
    const btn = $('input[type="submit"]', form) || $('[type="submit"]', form) || $('.w-button', form)
    const setBtn = (txt) => {
      if (!btn) return
      if (btn.value !== undefined && btn.tagName === 'INPUT') btn.value = txt
      else btn.textContent = txt
    }
    const origLabel = btn ? (btn.value !== undefined && btn.tagName === 'INPUT' ? btn.value : btn.textContent) : ''
    let submitting = false

    // capture phase + stopPropagation => Webflow's own (bubble) submit handler never runs,
    // and preventDefault stops the native GET navigation/reload.
    form.addEventListener(
      'submit',
      async (e) => {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (submitting) return
        const payload = readOpportunityForm(form)
        if (!payload.title) return say('Please enter an opportunity title.')
        if (!payload.project_type) return say('Please choose a project type.')
        if (!payload.budget) return say('Please enter a budget.')
        submitting = true
        if (btn) {
          btn.disabled = true
          btn.style.opacity = '0.6'
        }
        setBtn('Submitting…')
        say('Submitting…')
        try {
          await API.brandOppCreate(payload)
          say('Submitted! Your opportunity is now live.')
          location.href = '/opportunities-brands-view'
        } catch (err) {
          console.error('[opp30:create]', err)
          say((err && err.data && err.data.message) || 'Something went wrong. Please try again.')
          submitting = false
          if (btn) {
            btn.disabled = false
            btn.style.opacity = ''
          }
          setBtn(origLabel)
        }
      },
      true,
    )
  }

  /* ==================== ACTIVE-ID TRACKING ====================== */
  // Confirmation/edit modals carry no id; we remember what was clicked.
  let activeOpp = null
  let activeApp = null
  const setActiveOpp = (id) => (activeOpp = id ? parseInt(id, 10) : null)
  const setActiveApp = (id) => (activeApp = id ? parseInt(id, 10) : null)

  // When any element inside a card is clicked, capture that card's ids.
  // wf-algolia-rendered cards expose the id as data-wf-algolia-hit-objectid (not data-opp-id).
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-opp-id], [data-wf-algolia-hit-objectid]')
    if (card) {
      setActiveOpp(card.getAttribute('data-opp-id') || card.getAttribute('data-wf-algolia-hit-objectid'))
      if (card.hasAttribute('data-app-id')) setActiveApp(card.getAttribute('data-app-id'))
    }
  })

  /* ====================== MODAL HANDLERS ======================== */
  function wireModals() {
    // CREATE
    const createBtn = $('[data-opp-submit="create"]')
    const createPageForm = createBtn
      ? createBtn.closest(
          '[data-opp-form="create"], form.create-opportunities_layout, #wf-form-Opportunity-Create-Form',
        )
      : null
    const onCreatePage = location.pathname.includes('opportunities---create')
    if (createBtn && !createPageForm && !onCreatePage)
      createBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="post-opportunity"]')
        const payload = readOpportunityForm(modal)
        if (!payload.title) return alert('Please enter a title')
        await guard(createBtn, () => API.brandOppCreate(payload))
      })
    else if (createBtn && (createPageForm || onCreatePage)) {
      log('skipped generic create click binding on full-page create form')
    }

    // EDIT
    const editBtn = $('[data-opp-submit="update"]')
    if (editBtn)
      editBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="edit-opportunity"]')
        const payload = readOpportunityForm(modal)
        await guard(editBtn, () => API.brandOppUpdate(activeOpp, payload))
      })

    // CLOSE (confirmation)
    const closeBtn = $('[data-opp-submit="close"]')
    if (closeBtn)
      closeBtn.addEventListener('click', () =>
        guard(closeBtn, () => API.brandOppClose(activeOpp)),
      )

    // ARCHIVE / RESTORE applicant (confirmation)
    const archiveBtn = $('[data-opp-submit="archive"]')
    if (archiveBtn)
      archiveBtn.addEventListener('click', () =>
        guard(archiveBtn, () => API.brandAppArchive(activeApp)),
      )

    // APPLY
    const applyBtn = $('[data-opp-submit="apply"]')
    if (applyBtn)
      applyBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="apply-opportunity"]')
        const msg = ($('[name="Cover-Letter"]', modal) || {}).value || ''
        if (!msg.trim()) return alert('Please write a cover letter')
        await guard(applyBtn, () => API.starterAppSubmit(activeOpp, msg.trim()))
      })

    // EDIT APPLICATION
    const editAppBtn = $('[data-opp-submit="update-application"]')
    if (editAppBtn)
      editAppBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="edit-application"]')
        const msg = ($('[name="Cover-Letter"]', modal) || {}).value || ''
        if (!msg.trim()) return alert('Please write a cover letter')
        await guard(editAppBtn, () => API.starterAppUpdate(activeApp, msg.trim()))
      })

    // CANCEL APPLICATION (confirmation)
    const cancelBtn = $('[data-opp-submit="cancel"]')
    if (cancelBtn)
      cancelBtn.addEventListener('click', () =>
        guard(cancelBtn, () => API.starterAppCancel(activeApp)),
      )
  }

  // Disables a button while its action runs; reloads on success (simple v1).
  async function guard(btn, fn) {
    const label = btn.textContent
    btn.style.pointerEvents = 'none'
    btn.style.opacity = '0.6'
    try {
      await fn()
      location.reload()
    } catch (err) {
      console.error('[opp30]', err)
      alert((err && err.data && err.data.message) || 'Something went wrong. Please try again.')
      btn.style.pointerEvents = ''
      btn.style.opacity = ''
      btn.textContent = label
    }
  }

  /* ============ wf-algolia bridge (brand list page) ============ */
  // The brand list renders via the wf-algolia package, whose cards expose
  // data-wf-algolia-hit-objectid (not data-opp-id) and whose pagination + detail-link
  // markup needs adjusting. This bridges those cards to the Opp30 handlers and fixes
  // the card/pagination markup wf-algolia 1.0.4 can't drive on its own. No-op when the
  // page has no wf-algolia results container.
  function initWfAlgoliaBridge() {
    const results = $('[wf-algolia-element="results"]')
    if (!results) return
    log('wf-algolia bridge active')

    // Pagination: page-prev / page-number / page-next must share a parent (else
    // wf-algolia's insertBefore throws), and the page-number template must drop
    // is-inactive (which is display:none) so cloned page buttons are visible.
    const fixPaginationMarkup = () => {
      const tmpl = $('[wf-algolia-element="page-number"]')
      if (!tmpl || !tmpl.parentElement) return
      const parent = tmpl.parentElement
      const prev = $('[wf-algolia-element="page-prev"]')
      const next = $('[wf-algolia-element="page-next"]')
      if (prev && prev.parentElement !== parent) parent.insertBefore(prev, parent.firstChild)
      if (next && next.parentElement !== parent) parent.appendChild(next)
      tmpl.classList.remove('is-inactive')
    }

    // Per-card: mirror the id to data-opp-id (for active-id tracking) and set a real
    // /opportunities/<id> href on the detail link(s).
    const fixCards = () => {
      results.querySelectorAll('[data-wf-algolia-hit-objectid]').forEach((card) => {
        const id = card.getAttribute('data-wf-algolia-hit-objectid')
        if (!id) return
        if (!card.hasAttribute('data-opp-id')) card.setAttribute('data-opp-id', id)
        card
          .querySelectorAll('a[wf-algolia-link], a[wf-algolia-link-url], a.clickable_link, a[data-opp-detail-link]')
          .forEach((a) => a.setAttribute('href', '/opportunities/' + id))
      })
    }

    // Current page gets a real is-active class (wf-algolia only sets a data attribute).
    const fixActivePage = () => {
      document
        .querySelectorAll('.wf-algolia-page-num')
        .forEach((n) => n.classList.toggle('is-active', n.getAttribute('data-wf-algolia-active') === 'true'))
    }

    fixPaginationMarkup()
    const apply = () => {
      fixCards()
      fixActivePage()
    }
    apply()
    new MutationObserver(apply).observe(results, { childList: true, subtree: true })
    const pager = ($('[wf-algolia-element="page-number"]') || {}).parentElement
    if (pager) new MutationObserver(fixActivePage).observe(pager, { childList: true, subtree: true, attributes: true })

    // The close-opportunity modal's confirm button is a plain <div> (not tagged
    // data-opp-submit), and Finsweet relocates the modal after boot — so use
    // DOCUMENT-level delegation: a "Confirm" click inside the close-opportunity modal
    // -> brandOppClose(activeOpp) (activeOpp set by the card-click listener).
    if (!window.__opp30CloseWired) {
      window.__opp30CloseWired = true
      document.addEventListener('click', (e) => {
        if (!e.target.closest('[data-modal-target="close-opportunity"]')) return
        const btn =
          e.target.closest('a, button, [role="button"], .button_main-wrap, [data-w-id]') || e.target
        if (/^confirm$/i.test((btn.textContent || '').trim()) && activeOpp) {
          guard(btn, () => API.brandOppClose(activeOpp))
        }
      })
    }

    // If wf-algolia already rendered (and possibly crashed) before our markup fix, re-render.
    if (window.WfAlgolia && typeof window.WfAlgolia.refresh === 'function') {
      try {
        window.WfAlgolia.refresh()
      } catch (e) {
        /* non-fatal */
      }
    }
  }

  /* ========================= BOOTSTRAP ========================== */
  function boot() {
    wireModals()
    const p = location.pathname
    if (p.includes('opportunities-details---brand-view')) initBrandDetail()
    else if (p.match(/^\/opportunities\/\d+/)) initTalentDetail()
    else if (p.includes('opportunities-brands-view')) {
      initBrandList()
      initWfAlgoliaBridge()
    } else if (p.includes('opportunities-freelancer-view')) {
      initTalentList()
      initWfAlgoliaBridge()
    } else if (p.includes('opportunities---create')) initBrandCreatePage()
    // /all-modals: only wireModals() (already called) — no data fetch
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  // expose for debugging / manual calls in console
  window.Opp30 = { API, ensureXanoToken }
})()
