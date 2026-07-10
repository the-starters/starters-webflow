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

  // Freelancer feed: hide the Algolia results until the current member's category
  // filter is applied. wf-algolia paints the unfiltered `status:Active` set on load
  // (which can include opportunities matched to a previously-signed-in account), so
  // without this the wrong cards flash before initTalentAlgoliaMatch() narrows them.
  // Injected synchronously (before wf-algolia renders); removed/overridden the moment
  // the filtered results are ready. `visibility` (not `display`) preserves layout.
  if (location.pathname.includes('opportunities-freelancer-view')) {
    try {
      const hideStyle = document.createElement('style')
      hideStyle.id = 'opp30-talent-hide-until-filtered'
      hideStyle.textContent = '[wf-algolia-element="results"]{visibility:hidden}'
      ;(document.head || document.documentElement).appendChild(hideStyle)
    } catch (e) {
      /* non-fatal */
    }
  }

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

  // Memberstack plan id -> role label. Keyed by plan ID (names drift; dashboard
  // names as of 2026-07-07: talent = "Dorxata Test Free Plan",
  // brand-free = "Free Plan", brand-paid = "Premium Plan (Paying Client)").
  // Members whose active plans are all unmapped are treated as roleless.
  const MS_PLAN_ROLES = {
    'pln_dorxata-test-free-plan-dvcg0k8o': 'talent',
    'pln_free-plan-f6kn0dxz': 'brand-free',
    'pln_new-paid-plan-463h04ph': 'brand-paid',
    // 'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid', // test brand plan (4 members) — enable if test brand accounts need access
  }
  // Non-paying brands are not allowed on role-gated dual pages; send them to the
  // free-brand home (same destination the quiz funnel uses for free members).
  const BRAND_FREE_REDIRECT = '/quiz-results'

  /* ========================= AUTH BRIDGE ========================== */
  let _xanoToken = null
  // Memberstack id the caches below were built for. When it changes (account
  // switch), resetMemberScopedCaches() drops the stale token/context so the new
  // member never inherits the previous member's data.
  let _cacheMemberId = null

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

  // Funnel events (see platform-ops/architecture/posthog-funnel-events-plan.md).
  // Fired from call() so an event only exists when the Xano write succeeded.
  const track = (name, props) =>
    window.StartersTrack && window.StartersTrack.track ? window.StartersTrack.track(name, props) : undefined
  const TRACKED_CALLS = {
    'brand/opportunities/create': 'opportunity_created',
    'brand/opportunities/update': 'opportunity_updated',
    'brand/opportunities/close': 'opportunity_closed',
    'brand/opportunities/reopen': 'opportunity_reopened',
    'starter/applications/submit': 'application_submitted',
    'starter/applications/update': 'application_updated',
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
      track('bridge_error', { path, status: res.status })
      throw Object.assign(new Error(data && data.message ? data.message : `API ${res.status}`), {
        status: res.status,
        data,
      })
    }
    const event = TRACKED_CALLS[path]
    if (event) {
      track(event, {
        opportunity_id:
          (body && body.opportunity_id) || (data && (data.opportunity_id || data.id)) || undefined,
        application_id: (body && body.application_id) || undefined,
        has_message: path === 'starter/applications/submit' ? Boolean(body && body.message) : undefined,
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
    brandOppReopen: (opportunity_id) =>
      call('brand/opportunities/reopen', { method: 'PATCH', body: { opportunity_id } }),
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
      role_name: multiVal('Category-option') || multiVal('Role-option') || multiVal('Function'),
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
  function waitForMemberstackDom(timeoutMs = 10000) {
    if (window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === 'function') {
      return Promise.resolve(window.$memberstackDom)
    }
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = window.setInterval(() => {
        if (window.$memberstackDom && typeof window.$memberstackDom.getCurrentMember === 'function') {
          window.clearInterval(timer)
          resolve(window.$memberstackDom)
          return
        }
        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  // Drop every member-scoped cache when the signed-in member changes, so a new
  // account never reuses the previous member's Xano token, match context, or
  // applied-ids (which would leak the previous member's opportunities into the feed).
  function resetMemberScopedCaches(memberId) {
    if (memberId === _cacheMemberId) return
    _cacheMemberId = memberId
    _xanoToken = null
    _talentMatchContextPromise = null
    _talentAppliedIdsPromise = null
    _talentAppliedIdsCache = null
    window.Opp30TalentMatchContext = null
    // Drop any Algolia results cached for the previous member.
    if (window.WfAlgolia && typeof window.WfAlgolia.refresh === 'function') {
      try {
        window.WfAlgolia.refresh()
      } catch (e) {
        /* non-fatal */
      }
    }
  }

  async function gateOrRedirect(expect /* 'brand' | 'freelancer' */) {
    const memberstack = await waitForMemberstackDom()
    if (!memberstack) throw new Error('Memberstack not available')
    const { data: member } = await memberstack.getCurrentMember()
    if (!member || !member.id) {
      resetMemberScopedCaches(null)
      location.href = '/login'
      return null
    }
    resetMemberScopedCaches(member.id)
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

  /** Resolve the member's role label from their ACTIVE Memberstack plans via
   *  MS_PLAN_ROLES. Paid brand wins over free brand wins over talent, so a
   *  member carrying several mapped plans lands on the highest-access label.
   *  @returns {'brand-paid'|'brand-free'|'talent'|null} */
  function memberPlanRole(member) {
    const labels = (member.planConnections || [])
      .filter((c) => c.active === true || c.status === 'ACTIVE')
      .map((c) => MS_PLAN_ROLES[c.planId])
      .filter(Boolean)
    if (labels.includes('brand-paid')) return 'brand-paid'
    if (labels.includes('brand-free')) return 'brand-free'
    if (labels.includes('talent')) return 'talent'
    return null
  }

  /** Plan-based gate for pages shared by talent AND paying brands
   *  (/opportunities/<id>). Redirects: logged-out -> /login, free brand ->
   *  BRAND_FREE_REDIRECT, unmapped plans -> /. Resolves {member, role} otherwise. */
  async function gateByPlan() {
    const memberstack = await waitForMemberstackDom()
    if (!memberstack) throw new Error('Memberstack not available')
    const { data: member } = await memberstack.getCurrentMember()
    if (!member || !member.id) {
      resetMemberScopedCaches(null)
      location.href = '/login'
      return null
    }
    resetMemberScopedCaches(member.id)
    const role = memberPlanRole(member)
    log('gateByPlan role:', role)
    if (role === 'brand-free') {
      location.href = BRAND_FREE_REDIRECT
      return null
    }
    if (!role) {
      location.href = '/'
      return null
    }
    return { member, role }
  }

  /** Reveal the [data-opp-role] wrapper matching `role` ('talent' | 'brand') and
   *  hide the rest. Pair with a page-head embed of
   *  <style>[data-opp-role]{display:none}</style> so neither wrapper flashes
   *  before this footer script resolves the member's plan. */
  function showRoleWrapper(role) {
    $$('[data-opp-role]').forEach((el) => {
      el.style.display = el.getAttribute('data-opp-role') === role ? '' : 'none'
    })
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
    $$(`[data-opp-bind="${field}"]`, card).forEach((el) => {
      el.textContent = value == null ? '' : value
    })
  }

  /* ===================== PAGE CONTROLLERS ======================== */
  /** True when the brand feed is wf-xano-rendered: a list root (any of the three
   *  root grammars — canonical wrapper, legacy wf-xano-list marker, v0.3.0
   *  element="list" root) whose wf-xano-source targets brand/opportunities/list. */
  function hasWfXanoBrandFeed() {
    return !!$(
      '[wf-xano-element="wrapper"][wf-xano-source*="brand/opportunities/list"], ' +
        '[wf-xano-list][wf-xano-source*="brand/opportunities/list"], ' +
        '[wf-xano-element="list"][wf-xano-source*="brand/opportunities/list"]',
    )
  }

  async function initBrandList() {
    if (!(await gateOrRedirect('brand'))) return
    const filter = $('[data-opp-filter]') // optional <select> with values '', Active, Pending Review, Closed
    const load = async (status) => {
      const res = await API.brandOppList(status || '')
      renderList('brand-opps', res.items, (card, o) => {
        bind(card, 'title', o.title)
        bind(card, 'company', o.company)
        bind(card, 'description', o.description)
        bind(card, 'project_type', o.project_type)
        bind(card, 'est_project_duration', o.est_project_duration)
        bind(card, 'est_hours', o.est_hours)
        bind(card, 'budget', o.budget)
        bind(card, 'budget_frequency', o.budget_frequency)
        bind(card, 'status', o.status)
        bind(card, 'created_at', fmtDate(o.created_at))
        bind(card, 'published_at', fmtDate(o.published_at))
        // Drive [data-opp-if="status === 'Active'|'Closed'|'Pending Review'"] status
        // pills (converted from the card's old wf-algolia-if attributes).
        applyOppIf(card, o)
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
    track('opportunity_viewed', { opportunity_id: oppId, viewer_role: 'brand' })
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
    try {
      if (!(await gateOrRedirect('freelancer'))) return
      // wf-xano owns the feed when its wrapper is on the page (2026-07-03
      // migration): don't hide anything, don't require wf-algolia markup.
      if ($('[wf-xano-element="wrapper"], [wf-xano-list], [wf-xano-element="list"][wf-xano-source]')) {
        document.documentElement.setAttribute('data-opp30-talent-algolia', 'wf-xano')
        return
      }
      if (!$('[wf-algolia-element="results"]')) {
        handleMissingTalentAlgoliaMarkup()
        return
      }
      const tabsBound = await initTalentTabs()
      if (!tabsBound) await initTalentAlgoliaMatch()
    } catch (err) {
      document.documentElement.setAttribute('data-opp30-talent-algolia', 'error')
      console.error('[opp30] failed to initialize talent list', err)
      setTalentResultsHidden(false)
    }
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
    const list = Array.isArray(values)
      ? values
      : typeof values === 'string'
        ? values.match(/-?\d+/g) || []
        : values == null
          ? []
          : [values]
    return Array.from(
      new Set(
        list
          .map((value) => parseInt(value, 10))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map(String),
      ),
    )
  }

  function contextValue(context, field) {
    if (!context) return undefined
    if (typeof context === 'object') return context[field]
    if (typeof context !== 'string') return undefined
    try {
      const parsed = JSON.parse(context)
      if (parsed && typeof parsed === 'object') return parsed[field]
    } catch {}
    const match = context.match(new RegExp(`${field}\\s*:\\s*([^\\n}]+)`))
    return match ? match[1] : undefined
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

  // Show/hide the talent results container. Revealing also removes the early
  // "hide-until-filtered" <style>, and the inline visibility wins over it either way.
  function setTalentResultsHidden(hidden) {
    const results = $('[wf-algolia-element="results"]')
    if (results) results.style.visibility = hidden ? 'hidden' : 'visible'
    if (!hidden) {
      const rule = document.getElementById('opp30-talent-hide-until-filtered')
      if (rule) rule.remove()
    }
  }

  // Reveal the talent feed once the post-filter render has actually landed. Waits for
  // the first results mutation after setFilter (so the filtered cards are in the DOM),
  // with a fallback timeout so the feed can never stay stuck hidden.
  function revealTalentResultsWhenReady() {
    const results = $('[wf-algolia-element="results"]')
    if (!results) return setTalentResultsHidden(false)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      try {
        observer.disconnect()
      } catch (e) {
        /* non-fatal */
      }
      window.clearTimeout(timer)
      setTalentResultsHidden(false)
    }
    const observer = new MutationObserver(finish)
    observer.observe(results, { childList: true, subtree: true })
    const timer = window.setTimeout(finish, 1500)
  }

  let _talentMatchContextPromise = null

  function getTalentMatchContext() {
    if (!_talentMatchContextPromise) _talentMatchContextPromise = API.starterMatchContext()
    return _talentMatchContextPromise
  }

  async function initTalentAlgoliaMatch() {
    try {
      const context = await getTalentMatchContext()
      const categoryRefs = filterValues(contextValue(context, 'category_refs'))
      const subcategoryRefs = filterValues(contextValue(context, 'subcategory_refs'))
      window.Opp30TalentMatchContext = context
      document.documentElement.setAttribute('data-opp30-talent-category-count', String(categoryRefs.length))
      document.documentElement.setAttribute('data-opp30-talent-category-refs', categoryRefs.join(','))
      document.documentElement.setAttribute('data-opp30-talent-context-type', Array.isArray(context) ? 'array' : typeof context)
      log('talent algolia match context', {
        starter_id: contextValue(context, 'starter_id'),
        category_refs: categoryRefs,
        subcategory_refs: subcategoryRefs,
      })
      console.info('[opp30] talent algolia category ref count', categoryRefs.length)
      if (!categoryRefs.length) {
        document.documentElement.setAttribute('data-opp30-talent-algolia', 'no-category-refs')
        console.warn('[opp30] talent match context has no category_refs; Algolia match filter skipped')
        // No categories to match on: never fall back to the unfiltered feed. Collapse
        // the results and surface the empty state instead of showing non-matching cards.
        const results = $('[wf-algolia-element="results"]')
        if (results) results.style.display = 'none'
        const noResults = $('[wf-algolia-element="no-results"]')
        if (noResults) noResults.style.display = ''
        return
      }

      document.documentElement.setAttribute('data-opp30-talent-algolia', 'waiting-wf-algolia')
      const wfAlgolia = await waitForWfAlgolia()
      if (!wfAlgolia) {
        document.documentElement.setAttribute('data-opp30-talent-algolia', 'missing-wf-algolia')
        console.warn('[opp30] wf-algolia unavailable; talent match filter skipped')
        setTalentResultsHidden(false)
        return
      }
      wfAlgolia.setFilter('category_refs', categoryRefs)
      document.documentElement.setAttribute('data-opp30-talent-algolia', 'filtered')
      revealTalentResultsWhenReady()
    } catch (err) {
      document.documentElement.setAttribute('data-opp30-talent-algolia', 'error')
      console.error('[opp30] failed to apply talent Algolia match filter', err)
      setTalentResultsHidden(false)
    }
  }

  const APPLIED_FIELD = 'objectID'
  const APPLIED_EMPTY = '__none__'
  let _talentAppliedIdsPromise = null
  let _talentAppliedIdsCache = null

  function fetchAppliedOppIds() {
    if (!_talentAppliedIdsPromise) {
      _talentAppliedIdsPromise = API.starterOppList('Applied').then((res) => {
        const raw = Array.isArray(res) ? res : Array.isArray(res && res.items) ? res.items : []
        const ids = raw
          .map(normalizeAppliedItem)
          .map((o) => o.opportunity_id || o.id)
          .filter(Boolean)
          .map(String)
        const deduped = Array.from(new Set(ids))
        _talentAppliedIdsCache = deduped
        return deduped
      })
    }
    return _talentAppliedIdsPromise
  }

  // Mirrors wf-algolia-if's grammar (truthy field, or ===/!==/>/>=/</<= against a
  // literal) but evaluates against OUR per-card data instead of the Algolia hit,
  // since "already applied" is member-specific and isn't an indexed field.
  // Longest operators first so ">=" doesn't get matched as ">".
  const OPP_IF_OPERATORS = ['===', '!==', '>=', '<=', '>', '<']
  function evalOppIf(expr, data) {
    const op = OPP_IF_OPERATORS.find((candidate) => expr.includes(candidate))
    if (!op) return Boolean(data[expr.trim()])
    const [left, right] = expr.split(op).map((s) => s.trim())
    if (left === undefined || right === undefined) return false
    const leftVal = data[left]
    const rightVal = right.replace(/^["']|["']$/g, '')
    const leftNum = parseFloat(leftVal)
    const rightNum = parseFloat(rightVal)
    const bothNumeric = !isNaN(leftNum) && !isNaN(rightNum)
    switch (op) {
      case '===':
        return String(leftVal) === rightVal
      case '!==':
        return String(leftVal) !== rightVal
      case '>':
        return bothNumeric && leftNum > rightNum
      case '>=':
        return bothNumeric && leftNum >= rightNum
      case '<':
        return bothNumeric && leftNum < rightNum
      case '<=':
        return bothNumeric && leftNum <= rightNum
      default:
        return false
    }
  }

  // Applies every [data-opp-if] inside a card against that card's data, e.g.
  // data-opp-if="applied === false" on the Apply button hides it once applied.
  // data-opp-display (mirrors wf-algolia-display) optionally forces the shown
  // value — default is clearing the inline style so the element's own class
  // (flex/grid/whatever) takes back over, unlike wf-algolia-if which defaults
  // to a hardcoded display:block on show.
  function applyOppIf(card, data) {
    $$('[data-opp-if]', card).forEach((el) => {
      const expr = el.getAttribute('data-opp-if')
      const visible = evalOppIf(expr, data)
      el.style.display = visible ? el.getAttribute('data-opp-display') || '' : 'none'
    })
  }

  // Reads the sync cache (not the promise) so it's safe to call from a
  // MutationObserver callback; call sites also re-run once the fetch resolves.
  function markAppliedCards(container) {
    if (!_talentAppliedIdsCache) return
    const appliedIds = new Set(_talentAppliedIdsCache)
    $$('[data-wf-algolia-hit-objectid]', container).forEach((card) => {
      const id = card.getAttribute('data-wf-algolia-hit-objectid')
      const applied = Boolean(id) && appliedIds.has(id)
      card.setAttribute('data-opp-already-applied', applied ? 'true' : 'false')
      applyOppIf(card, { applied })
    })
  }

  async function applyTalentAppliedFilter() {
    const wfAlgolia = await waitForWfAlgolia()
    if (!wfAlgolia) {
      document.documentElement.setAttribute('data-opp30-talent-algolia', 'missing-wf-algolia')
      console.warn('[opp30] wf-algolia unavailable; applied filter skipped')
      setTalentResultsHidden(false)
      return
    }
    const ids = await fetchAppliedOppIds()
    wfAlgolia.setFilter(APPLIED_FIELD, ids.length ? ids : [APPLIED_EMPTY])
    document.documentElement.setAttribute('data-opp30-talent-applied-count', String(ids.length))
    document.documentElement.setAttribute('data-opp30-talent-algolia', 'filtered')
    revealTalentResultsWhenReady()
  }

  async function clearTalentAppliedFilter() {
    const wfAlgolia = await waitForWfAlgolia()
    if (wfAlgolia) wfAlgolia.setFilter(APPLIED_FIELD, [])
    document.documentElement.removeAttribute('data-opp30-talent-applied-count')
    await initTalentAlgoliaMatch()
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

  function stripTalentTabAlgoliaFilterAttrs() {
    const filterAttrs = ['wf-algolia-field', 'wf-algolia-facet', 'wf-algolia-value', 'wf-algolia-operator']
    const filterElements = new Set(['filter-group', 'filter-item'])
    const candidates = new Set()

    $$('[data-opp-talent-tab]').forEach((control) => {
      let node = control
      let depth = 0
      while (node && node !== document.documentElement && depth < 4) {
        const elementType = node.getAttribute?.('wf-algolia-element')
        const hasFilterAttr =
          filterElements.has(elementType) || filterAttrs.some((attr) => node.hasAttribute?.(attr))
        if (node === control || hasFilterAttr || node.tagName === 'LABEL') candidates.add(node)
        if (elementType === 'browse' || node.hasAttribute?.('data-opp-talent-panel')) break
        node = node.parentElement
        depth += 1
      }
    })

    let removed = 0
    candidates.forEach((el) => {
      if (filterElements.has(el.getAttribute?.('wf-algolia-element'))) {
        el.removeAttribute('wf-algolia-element')
        removed += 1
      }
      filterAttrs.forEach((attr) => {
        if (el.hasAttribute?.(attr)) {
          el.removeAttribute(attr)
          removed += 1
        }
      })
    })

    if (removed) {
      console.warn('[opp30] Removed wf-algolia filter attributes from All/Applied tab controls.', { removed })
    }
  }

  // The page's [data-tab-filters-check].w--redirected-checked rule is meant to paint
  // the active pill, but it ties for specificity with .tab-item_button.is-inherit
  // (background-color: inherit) and loses on source order — so toggling classes alone
  // never paints anything. data-opp-tab-active is our own attribute (inert by default;
  // add CSS for it in Designer if you want to style from there) and the inline style
  // is what actually guarantees the paint, using the same design-system variables the
  // dead rule already referenced.
  function syncTalentTabControls(activeTab) {
    $$('[data-opp-talent-tab]').forEach((el) => {
      const tab = normalizeTalentTab(el.getAttribute('data-opp-talent-tab'))
      const active = tab === activeTab
      if ('checked' in el && /^(radio|checkbox)$/i.test(el.type || '')) el.checked = active
      el.setAttribute('aria-pressed', active ? 'true' : 'false')
      const label = el.closest('label')
      if (!label) return
      label.setAttribute('data-opp-tab-active', active ? 'true' : 'false')
      const pill = $('[data-tab-filters-check]', label) || $('.tab-item_button', label)
      if (pill) {
        pill.style.backgroundColor = active ? 'var(--tab-filters-active-bg, var(--colors--olive, #434b43))' : ''
        pill.style.color = active ? 'var(--tab-filters-active-color, var(--colors--white, #ffffff))' : ''
      }
    })
  }

  async function initTalentTabs() {
    const controls = $$('[data-opp-talent-tab]')
    if (!controls.length) return false
    stripTalentTabAlgoliaFilterAttrs()
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
    // Warm the memoized applied-ids fetch now (while the page shows "all") so the
    // first Applied click doesn't wait on a fresh Xano round-trip.
    fetchAppliedOppIds().catch(() => {})
    await setTalentTab(getInitialTalentTab())
    return true
  }

  async function setTalentTab(value) {
    const tab = normalizeTalentTab(value)
    const allPanel = getTalentAllPanel()
    const appliedPanel = getTalentAppliedPanel()

    document.documentElement.setAttribute('data-opp30-talent-tab', tab)
    if (allPanel) allPanel.style.display = ''
    if (appliedPanel && appliedPanel !== allPanel) appliedPanel.style.display = tab === 'applied' ? '' : 'none'
    syncTalentTabControls(tab)

    if (tab === 'applied') {
      await applyTalentAppliedFilter()
      return
    }
    await clearTalentAppliedFilter()
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

  async function initTalentDetail(member) {
    // Gate unless the caller (initOppDetailByRole) already resolved the member.
    if (!member && !(await gateOrRedirect('freelancer'))) return
    // Slug IS the Xano ID (e.g. /opportunities/591)
    const oppId = parseInt(location.pathname.split('/').pop(), 10)
    if (!oppId) return (location.href = '/opportunities-freelancer-view')
    // CMS page already renders opportunity content — only fetch auth state
    const { opportunity: o, application: a } = await API.starterOppDetail(oppId)
    setActiveOpp(oppId)
    track('opportunity_viewed', { opportunity_id: oppId, viewer_role: 'freelancer' })
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

  /** /opportunities/<id> CMS detail page, shared by talent and PAYING brands.
   *  Gates by Memberstack plan (gateByPlan), reveals the matching
   *  [data-opp-role="talent"|"brand"] wrapper, then runs that role's wiring.
   *  Free brands never reach this point (redirected by the gate). */
  async function initOppDetailByRole() {
    const gate = await gateByPlan()
    if (!gate) return
    const wrapperRole = gate.role === 'talent' ? 'talent' : 'brand'
    showRoleWrapper(wrapperRole)
    if (wrapperRole === 'talent') {
      await initTalentDetail(gate.member)
      return
    }
    // Brand view: the CMS page renders the opportunity content; only wire the
    // applicants list when the brand wrapper carries one (ownership is enforced
    // server-side by brand/applications/list, so a foreign opp just errors/empties).
    const oppId = parseInt(location.pathname.split('/').pop(), 10)
    if (!oppId) return
    setActiveOpp(oppId)
    if (!$('[data-opp-role="brand"] [data-opp-list="applicants"]')) return
    const res = await API.brandAppList(oppId)
    renderList('applicants', res.items, (card, a) => {
      card.setAttribute('data-app-id', a.id)
      bind(card, 'message', a.message)
      bind(card, 'submitted_at', fmtDate(a.submitted_at))
    })
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

  // Read a field's text from a card, whichever library rendered it:
  // wf-algolia (wf-algolia-text), wf-xano (wf-xano-bind), or renderList (data-opp-bind).
  function cardFieldText(card, field) {
    const el =
      $('[wf-algolia-text="' + field + '"]', card) ||
      $('[wf-xano-bind="' + field + '"]', card) ||
      $('[data-opp-bind="' + field + '"]', card)
    return el ? el.textContent.trim() : ''
  }

  // Fill the apply modal's [data-opp-bind="company"/"title"] elements from
  // whichever card was clicked.
  function fillApplyModalMeta(card) {
    const modal = $('[data-modal-target="apply-opportunity"]')
    if (!modal || !card) return
    bind(modal, 'company', cardFieldText(card, 'company'))
    bind(modal, 'title', cardFieldText(card, 'title'))
  }

  // Fill the close-confirmation modal's [data-opp-bind="title"] with the
  // clicked card's title, so the brand sees WHICH opportunity they're about
  // to conclude (the Designer element was a static placeholder before).
  function fillCloseModalMeta(card) {
    const modal = $('[data-modal-target="close-opportunity"]')
    if (!modal || !card) return
    const title = cardFieldText(card, 'title')
    if (title) bind(modal, 'title', title)
  }

  // Fill the reopen-confirmation modal's [data-opp-bind="title"] with the
  // clicked card's title, so the brand sees WHICH opportunity they're
  // putting back on the marketplace.
  function fillReopenModalMeta(card) {
    const modal = $('[data-modal-target="reopen-opportunity"]')
    if (!modal || !card) return
    const title = cardFieldText(card, 'title')
    if (title) bind(modal, 'title', title)
  }

  // Fill the cancel-application confirmation modal's [data-opp-bind="title"/
  // "company"] from the clicked card, so the member sees WHICH application
  // they're about to cancel.
  function fillCancelModalMeta(card) {
    const modal = $('[data-modal-target="cancel-application"]')
    if (!modal || !card) return
    const title = cardFieldText(card, 'title')
    const company = cardFieldText(card, 'company')
    if (title) bind(modal, 'title', title)
    if (company) bind(modal, 'company', company)
  }

  // When any element inside a card is clicked, capture that card's ids.
  // wf-algolia-rendered cards expose the id as data-wf-algolia-hit-objectid,
  // wf-xano-rendered cards as data-wf-xano-id (neither uses data-opp-id).
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-opp-id], [data-wf-algolia-hit-objectid], [data-wf-xano-id]')
    if (card) {
      setActiveOpp(
        card.getAttribute('data-opp-id') ||
          card.getAttribute('data-wf-algolia-hit-objectid') ||
          card.getAttribute('data-wf-xano-id'),
      )
      // Always reset (null when absent): wf-xano/wf-algolia cards carry no
      // data-app-id, and a stale id from a previously-clicked card must never
      // leak into this card's cancel/edit actions. The cancel handler resolves
      // the id from activeOpp when it's null.
      setActiveApp(card.getAttribute('data-app-id'))
      fillApplyModalMeta(card)
      fillCloseModalMeta(card)
      fillReopenModalMeta(card)
      fillCancelModalMeta(card)
    }
  })

  // A confirm button advances its form-flow immediately (data-form-flow-action
  // ="next"), independent of whether the API call it also fires succeeds — on
  // success guard() reloads the page, but on failure nothing rewinds the flow,
  // stranding the modal on its success step for the rest of the session. The
  // modal system dispatches "modal-open" and the flow engine exposes
  // lumos.formFlow, so rewind any flow inside a modal whenever it opens.
  window.addEventListener('modal-open', (e) => {
    const modal = e.detail && e.detail.modal
    const flowEl = modal && modal.querySelector('[data-form-flow]')
    const flowId = flowEl && flowEl.getAttribute('data-form-flow')
    const ff = window.lumos && window.lumos.formFlow
    if (flowId && ff && ff.list && ff.list[flowId]) ff.reset(flowId)
    // Apply modal: rewind the F4 success screen (w-form-done) back to the form
    // step, mirroring the form-flow reset above for the native success state.
    if (modal && modal.matches && modal.matches('[data-modal-target="apply-opportunity"]')) {
      const form = modal.querySelector('.expert-application_form') || modal.querySelector('form')
      const done = modal.querySelector('.w-form-done')
      if (form) form.style.display = ''
      if (done) done.style.display = ''
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

    // REOPEN closed opportunity (confirmation) — server re-activates it,
    // clears closed_at, and re-syncs Webflow CMS + Algolia so the
    // opportunity reappears in the talent feeds.
    const reopenBtn = $('[data-opp-submit="reopen"]')
    if (reopenBtn)
      reopenBtn.addEventListener('click', () =>
        guard(reopenBtn, () => API.brandOppReopen(activeOpp)),
      )

    // ARCHIVE / RESTORE applicant (confirmation)
    const archiveBtn = $('[data-opp-submit="archive"]')
    if (archiveBtn)
      archiveBtn.addEventListener('click', () =>
        guard(archiveBtn, () => API.brandAppArchive(activeApp)),
      )

    // APPLY — on success show the modal's native w-form-done "Application sent"
    // screen (F4) in place instead of reloading (showApplySuccess falls back to
    // a reload when that markup is missing).
    const applyBtn = $('[data-opp-submit="apply"]')
    if (applyBtn)
      applyBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="apply-opportunity"]')
        const msg = ($('[name="Cover-Letter"]', modal) || {}).value || ''
        if (!msg.trim()) return alert('Please write a cover letter')
        await guard(applyBtn, () => API.starterAppSubmit(activeOpp, msg.trim()), showApplySuccess)
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
    // wf-xano/wf-algolia cards only carry the opportunity id, so the
    // application id is resolved lazily via the detail endpoint (which
    // returns the signed-in member's application for that opportunity).
    const cancelBtn = $('[data-opp-submit="cancel"]')
    if (cancelBtn)
      cancelBtn.addEventListener('click', () =>
        guard(cancelBtn, async () => {
          let appId = activeApp
          if (!appId && activeOpp) {
            const detail = await API.starterOppDetail(activeOpp)
            appId = detail && detail.application && detail.application.id
          }
          if (!appId) throw { data: { message: 'Could not find your application for this opportunity.' } }
          return API.starterAppCancel(appId)
        }),
      )
  }

  // Disables a button while its action runs; on success runs onSuccess when
  // given, else reloads (simple v1 behavior kept as the default/fallback).
  async function guard(btn, fn, onSuccess) {
    const label = btn.textContent
    btn.style.pointerEvents = 'none'
    btn.style.opacity = '0.6'
    try {
      await fn()
      if (onSuccess) onSuccess()
      else location.reload()
    } catch (err) {
      console.error('[opp30]', err)
      alert((err && err.data && err.data.message) || 'Something went wrong. Please try again.')
      btn.style.pointerEvents = ''
      btn.style.opacity = ''
      btn.textContent = label
    }
  }

  /* ================== F4: APPLICATION-SENT SCREEN ================ */
  // The apply modal's "Application sent" screen is the form block's native
  // Webflow success state (.w-form-done) — hidden until swapped in here.
  // Falls back to the old reload when the markup is missing.
  function showApplySuccess() {
    const modal = $('[data-modal-target="apply-opportunity"]')
    const form = modal && ($('.expert-application_form', modal) || $('form', modal))
    const done = modal && $('.w-form-done', modal)
    if (!modal || !form || !done) return location.reload()
    form.style.display = 'none'
    done.style.display = 'block'
    // Repaint the page behind the modal so closing it (any path) never shows a
    // stale "Apply Now": flip the state blocks and re-run the wf-xano
    // application card without a full reload.
    try {
      paintState(document, 'applied')
      if (window.WfXano && typeof window.WfXano.refresh === 'function') window.WfXano.refresh()
    } catch (e) {
      /* non-fatal */
    }
  }

  // F4 buttons carry no hooks in the Designer, so delegate by label within the
  // success screen (same text-match pattern as wireCloseOpportunityModal).
  document.addEventListener('click', (e) => {
    const modal = e.target.closest('[data-modal-target="apply-opportunity"]')
    if (!modal || !e.target.closest('.w-form-done')) return
    // The design-system button is a cover-link: the <a.clickable_link> that
    // actually receives the click is EMPTY (its label lives in the sibling
    // .button_main-text), so resolve the label from the .button_main-wrap.
    const btn = e.target.closest('.button_main-wrap') || e.target.closest('a, button, [role="button"]')
    if (!btn) return
    const label = (btn.textContent || '').trim().toLowerCase()
    // preventDefault: the Designer anchors carry their own hrefs (View
    // Application points at the retired /opportunities-details---freelancer-view)
    // and the default navigation would win over the handlers below.
    if (label.includes('back to opportunities')) {
      e.preventDefault()
      location.href = '/opportunities-freelancer-view?tab=applied'
    } else if (label.includes('view application')) {
      e.preventDefault()
      location.reload()
    }
  })

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

    // starterOppList('Applied') is a starter-only endpoint; only relevant on the
    // freelancer feed (this bridge also runs on the brand list page).
    const isTalentFeed = location.pathname.includes('opportunities-freelancer-view')

    fixPaginationMarkup()
    const apply = () => {
      fixCards()
      fixActivePage()
      if (isTalentFeed) markAppliedCards(results)
    }
    apply()
    // Cards render before the applied-ids fetch resolves; re-mark once it's in.
    if (isTalentFeed) fetchAppliedOppIds().then(apply).catch(() => {})
    new MutationObserver(apply).observe(results, { childList: true, subtree: true })
    const pager = ($('[wf-algolia-element="page-number"]') || {}).parentElement
    if (pager) new MutationObserver(fixActivePage).observe(pager, { childList: true, subtree: true, attributes: true })

    // If wf-algolia already rendered (and possibly crashed) before our markup fix, re-render.
    if (window.WfAlgolia && typeof window.WfAlgolia.refresh === 'function') {
      try {
        window.WfAlgolia.refresh()
      } catch (e) {
        /* non-fatal */
      }
    }
  }

  // The close-opportunity modal's confirm button is a plain <div> (not tagged
  // data-opp-submit), and Finsweet relocates the modal after boot — so use
  // DOCUMENT-level delegation: a "Confirm" click inside the close-opportunity modal
  // -> brandOppClose(activeOpp) (activeOpp set by the card-click listener). Wired on the
  // brand list page independently of the wf-algolia bridge, so closing works whether the
  // feed renders via Xano (data-opp-list="brand-opps") or the legacy wf-algolia markup.
  function wireCloseOpportunityModal() {
    if (window.__opp30CloseWired) return
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

  function diagnoseFreelancerFeed() {
    const scriptSrcs = $$('script[src]').map((script) => script.src || '')
    const matchContext = window.Opp30TalentMatchContext || null
    const categoryRefs = filterValues(matchContext && matchContext.category_refs)
    const filterState =
      window.WfAlgolia && typeof window.WfAlgolia.getFilterState === 'function'
        ? window.WfAlgolia.getFilterState()
        : null
    const filterStateText = filterState == null ? '' : JSON.stringify(filterState)
    const filterAttrs = $$(
      '[wf-algolia-element="filter-group"], [wf-algolia-element="filter-item"], [wf-algolia-field], [wf-algolia-facet]',
    ).map((el) => ({
      tag: (el.tagName || '').toLowerCase(),
      element: el.getAttribute('wf-algolia-element'),
      field: el.getAttribute('wf-algolia-field'),
      facet: el.getAttribute('wf-algolia-facet'),
    }))
    const tabControls = $$('[data-opp-talent-tab]').map((el) => ({
      tab: el.getAttribute('data-opp-talent-tab'),
      checked: 'checked' in el ? el.checked : null,
      ariaPressed: el.getAttribute('aria-pressed'),
      activeAttr: el.closest('label')?.getAttribute('data-opp-tab-active') || 'false',
    }))
    const activeTab = document.documentElement.getAttribute('data-opp30-talent-tab')
    const appliedCountAttr = document.documentElement.getAttribute('data-opp30-talent-applied-count')
    const appliedCount = appliedCountAttr == null ? null : Number(appliedCountAttr)
    const issues = []

    if (!scriptSrcs.some((src) => /starters-webflow@[^/]+\/opportunities-3\.0\.js/.test(src))) {
      issues.push('opportunities-3.0.js is not loaded from a versioned/@latest jsDelivr URL.')
    }
    if (!window.WfAlgolia) issues.push('window.WfAlgolia is missing.')
    if (!$('[wf-algolia-element="browse"]')) issues.push('Missing wf-algolia browse wrapper.')
    if (!$('[wf-algolia-element="results"]')) issues.push('Missing wf-algolia results container.')
    if (!$('[wf-algolia-element="template"]')) issues.push('Missing wf-algolia template card.')
    if (!tabControls.some((control) => control.tab === 'all')) issues.push('Missing data-opp-talent-tab="all" control.')
    if (!tabControls.some((control) => control.tab === 'applied')) {
      issues.push('Missing data-opp-talent-tab="applied" control.')
    }
    if (!matchContext) issues.push('window.Opp30TalentMatchContext is missing.')
    else if (!categoryRefs.length) issues.push('Opp30TalentMatchContext.category_refs is empty.')
    if (categoryRefs.length && !filterStateText.includes('category_refs')) {
      issues.push('WfAlgolia filter state does not show category_refs.')
    }
    if (activeTab === 'applied' && !filterStateText.includes(APPLIED_FIELD)) {
      issues.push('WfAlgolia filter state does not show the applied objectID filter.')
    }
    if (filterAttrs.length) issues.push('Leftover wf-algolia filter attributes found on the page.')

    return {
      url: location.href,
      htmlTalentTab: document.documentElement.getAttribute('data-opp30-talent-tab'),
      htmlTalentAlgolia: document.documentElement.getAttribute('data-opp30-talent-algolia'),
      htmlTalentCategoryCount: document.documentElement.getAttribute('data-opp30-talent-category-count'),
      scripts: {
        opportunities30: scriptSrcs.filter((src) => /starters-webflow@.*\/opportunities-3\.0\.js/.test(src)),
        wfAlgolia: scriptSrcs.filter((src) => /@candid-leap\/wf-algolia|wf-algolia/i.test(src)),
      },
      runtime: {
        opp30Loaded: true,
        wfAlgoliaLoaded: Boolean(window.WfAlgolia),
        matchContextStarterId: matchContext && matchContext.starter_id,
        categoryRefs,
        filterState,
        appliedFilterField: APPLIED_FIELD,
        appliedCount,
      },
      markup: {
        browseCount: $$('[wf-algolia-element="browse"]').length,
        resultsCount: $$('[wf-algolia-element="results"]').length,
        templateCount: $$('[wf-algolia-element="template"]').length,
        renderedCardsWithObjectId: $$('[data-wf-algolia-hit-objectid]').length,
        tabControls,
        filterAttrs,
      },
      issues,
    }
  }

  /* ========================= BOOTSTRAP ========================== */
  function boot() {
    wireModals()
    const p = location.pathname
    if (p.includes('opportunities-details---brand-view')) initBrandDetail()
    else if (p.match(/^\/opportunities\/\d+/)) initOppDetailByRole()
    else if (p.includes('opportunities-brands-view')) {
      // Brand feed: when the page carries wf-xano brand-feed markup (Designer swap,
      // 2026-07-02), the wf-xano library owns the render — initBrandList would repeat
      // the member gate + trade-token + the same list query into the removed
      // data-opp-list="brand-opps" container (~2.3s of discarded network, measured
      // 2026-07-03). It stays as the fallback for un-migrated markup. The brand gate
      // still runs either way so non-brand members are redirected.
      if (hasWfXanoBrandFeed()) gateOrRedirect('brand')
      else initBrandList()
      wireCloseOpportunityModal()
      initWfAlgoliaBridge()
      // The post-a-job modal on this page wraps the full Webflow create form, so
      // wireModals' generic click binding skips it — bind the form handler here too.
      initBrandCreatePage()
    } else if (p.includes('opportunities-freelancer-view')) {
      initTalentList()
      initWfAlgoliaBridge()
    } else if (p.includes('opportunities---create')) initBrandCreatePage()
    // /all-modals: only wireModals() (already called) — no data fetch
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  // expose for debugging / manual calls in console
  window.Opp30 = { API, ensureXanoToken, diagnoseFreelancerFeed, waitForMemberstackDom }
})()
