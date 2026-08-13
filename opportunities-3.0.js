/*!
 * Opportunities 3.0 — Webflow ↔ Xano binder
 * ------------------------------------------------------------------
 * Wires the existing 3.0 UI (opportunity pages, starter-dashboard, and
 * modals on /all-modals) to the authenticated "Opportunities 3.0" Xano API group.
 *
 * Load this ONCE per supported page via a page (or site) custom-code embed,
 * AFTER @xano/js-sdk and memberstack-x have loaded (footer).
 *
 * Auth model (important):
 *   1. Memberstack issues a member JWT on login.
 *   2. We trade it at  api:g1vmSLWh/auth/trade-token/v3  for a Xano auth token.
 *   3. That Xano token authorizes the opportunities calls at  api:opp30/...
 *      ($auth.id -> user_v3 -> brands_v3.memberstack_id | freelancers_v3.memberstack_id)
 *   4. On the Webflow V3 staging hostname only, a compatibility bridge can inject
 *      the same cached token into unauthenticated Scheduling calls at
 *      api:tCpV3oqd/...; v3/scheduling-auth.js takes ownership when loaded.
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

  const workflowDiagnosticsControllerScript = document.currentScript
  const WORKFLOW_DIAGNOSTICS_TIMEOUT_MS = 2000

  function boundedWorkflowDiagnostics(promise) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (api) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(api || null)
      }
      const timer = window.setTimeout(() => finish(null), WORKFLOW_DIAGNOSTICS_TIMEOUT_MS)
      Promise.resolve(promise).then(finish, () => finish(null))
    })
  }

  function loadWorkflowDiagnostics() {
    if (window.StartersWorkflowDiagnostics) return Promise.resolve(window.StartersWorkflowDiagnostics)
    if (window.__startersWorkflowDiagnosticsReady) {
      return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady)
    }
    const source = workflowDiagnosticsControllerScript && workflowDiagnosticsControllerScript.src
    if (!source || !document.createElement) return Promise.resolve(null)
    let url = ''
    try {
      const cdnRoot = source.match(
        /^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/,
      )
      url = cdnRoot
        ? cdnRoot[1] + 'utils/workflow-diagnostics.js'
        : new URL('utils/workflow-diagnostics.js', source).href
    } catch (_) {
      return Promise.resolve(null)
    }
    window.__startersWorkflowDiagnosticsReady = new Promise((resolve) => {
      const script = document.createElement('script')
      let settled = false
      const finish = (api) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(api || null)
      }
      const timer = window.setTimeout(() => finish(null), WORKFLOW_DIAGNOSTICS_TIMEOUT_MS)
      script.src = url
      script.async = false
      script.addEventListener('load', () => finish(window.StartersWorkflowDiagnostics), {
        once: true,
      })
      script.addEventListener('error', () => finish(null), { once: true })
      ;(document.head || document.documentElement).appendChild(script)
    })
    return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady)
  }

  const workflowDiagnosticsReady = loadWorkflowDiagnostics()

  // Freelancer feed: hide Algolia results until the requested tab's filters are
  // applied. All uses the current member's category refs; Applied deliberately uses
  // application IDs without categories. wf-algolia paints the unfiltered
  // `status:Active` set on load (which can include opportunities matched to a
  // previously-signed-in account), so the wrong cards must never flash during init or
  // tab transitions. `visibility` (not `display`) preserves layout while filtering.
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

  // Opportunity detail (/opportunities/<slug>): hide the application-state CTAs
  // (Apply / Applied / Withdraw / Edit application) until the member's applied
  // state is resolved, so the wrong CTA never flashes before paintState() runs
  // (the state comes from an async starter/opportunities/detail fetch). Injected
  // synchronously; the first paintState() removes it. Brand-view state elements
  // live inside the async-hidden talent wrapper, so this is a no-op for brands.
  if (/^\/opportunities\/[^/]+\/?$/.test(location.pathname)) {
    try {
      const stateHide = document.createElement('style')
      stateHide.id = 'opp30-detail-hide-until-state'
      stateHide.textContent = '[data-opp-state]{display:none!important}'
      ;(document.head || document.documentElement).appendChild(stateHide)
    } catch (e) {
      /* non-fatal */
    }

    // The brand Close/Reopen controls also depend on async Xano state. Keep
    // both invisible and non-interactive until paintOppStatus() has the
    // authoritative status, preventing the wrong action (or both actions)
    // from flashing at startup. Include the legacy Designer selectors so the
    // published page is protected before its old wf-xano-if markup is upgraded
    // in prepareOpportunityStatusControls().
    try {
      const statusHide = document.createElement('style')
      statusHide.id = 'opp30-detail-hide-until-status'
      statusHide.textContent =
        '[data-opp-status],[data-modal-trigger="close-opportunity"],[data-modal-trigger="reopen-opportunity"]{visibility:hidden!important;pointer-events:none!important}'
      ;(document.head || document.documentElement).appendChild(statusHide)
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
  const ROUTE_GUARD_HANDOFF_TIMEOUT_MS = 2000
  const MEMBER_ROLE_HYDRATION_TIMEOUT_MS = 2000
  const MEMBER_ROLE_HYDRATION_POLL_MS = 50

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
    'pln_dorxata-test-brand-plan-777r02pa': 'brand-paid', // test brand plan (4 members)
  }
  // Non-paying brands are not allowed on role-gated dual pages; send them to the
  // free-brand home. That home is /quiz-results only once the quiz is completed,
  // otherwise /quiz — the same durable signal the /quiz-results page reads (the
  // Memberstack `starter-quiz` custom field, present on the member object).
  // Mirrors brandFreeHome in v3/auth-route.js and v3/route-guard.js.
  function hasCompletedQuiz(member) {
    const cf = (member && member.customFields) || {}
    const value = cf['starter-quiz']
    return typeof value === 'string' ? value.trim() !== '' : !!value
  }
  function brandFreeHome(member) {
    return hasCompletedQuiz(member) ? '/quiz-results' : '/quiz'
  }

  /* ========================= AUTH BRIDGE ========================== */
  let _xanoToken = null
  // Memberstack id the caches below were built for. When it changes (account
  // switch), resetMemberScopedCaches() drops the stale token/context so the new
  // member never inherits the previous member's data.
  let _cacheMemberId = null
  let _memberScopeGeneration = 0
  let _memberScopeAuthChangeWired = false
  const MEMBER_SCOPE_RESET_EVENT = 'opp30:member-scope-reset'

  async function getMemberstackToken() {
    const ms = window.$memberstackDom
    if (!ms) throw new Error('Memberstack not available')
    // getMemberCookie() returns the member JWT (string). Awaiting is safe either way.
    const token = await ms.getMemberCookie()
    if (!token) throw new Error('No Memberstack session (member not logged in)')
    return token
  }

  function assertMemberScopeGeneration(generation) {
    if (generation === _memberScopeGeneration) return
    throw Object.assign(new Error('Member session changed during request'), {
      code: 'MEMBER_SCOPE_CHANGED',
    })
  }

  async function ensureXanoToken(generation = _memberScopeGeneration) {
    assertMemberScopeGeneration(generation)
    if (_xanoToken) return _xanoToken
    if (typeof window.getXanoAuthToken === 'function') {
      const sharedToken = await window.getXanoAuthToken()
      assertMemberScopeGeneration(generation)
      if (!sharedToken) throw new Error('shared auth bridge returned no token')
      _xanoToken = sharedToken
      return sharedToken
    }
    const msToken = await getMemberstackToken()
    assertMemberScopeGeneration(generation)
    const res = await fetch(
      `${XANO_AUTH_BASE}${XANO_TRADE_TOKEN_PATH}?token=${encodeURIComponent(msToken)}`,
    )
    const data = await res.json().catch(() => null)
    assertMemberScopeGeneration(generation)
    if (!res.ok) {
      throw Object.assign(new Error('trade-token failed'), { status: res.status, data })
    }
    // create_auth_token may return a raw string or { authToken }/{ token }
    const token = typeof data === 'string' ? data : data.authToken || data.token
    if (!token) throw new Error('trade-token returned no token')
    _xanoToken = token
    return token
  }

  /* ================== SCHEDULING AUTH BRIDGE ==================== */
  // Compatibility fallback for pages that have not loaded v3/scheduling-auth.js:
  // the in-progress V3 availability embed still calls the legacy Scheduling group
  // with plain fetch(). The shared bridge supersedes this wrapper in either script
  // order and owns the narrower production endpoint allowlist. Calls that already
  // carry Authorization pass through untouched.
  function installSchedulingAuthBridge() {
    if (location.hostname !== 'the-starters-3-0.webflow.io') return
    if (window.__tsSchedulingAuthBridge) return

    const schedulingOrigin = 'https://x08a-5ko8-jj1r.n7c.xano.io'
    const schedulingPath = '/api:tCpV3oqd/'
    const originalFetch = window.fetch.bind(window)

    window.__tsSchedulingAuthBridgeOwner = 'opportunities-3.0'
    window.__tsSchedulingAuthOriginalFetch = originalFetch
    window.__tsSchedulingAuthBridge = true

    function isSchedulingRequest(request) {
      try {
        const url = new URL(request.url)
        return url.origin === schedulingOrigin && url.pathname.startsWith(schedulingPath)
      } catch (error) {
        return false
      }
    }

    function withAuthorization(request, token) {
      const headers = new Headers(request.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return new Request(request.clone(), { headers })
    }

    window.fetch = async function (input, init) {
      const request = new Request(input, init)
      if (!isSchedulingRequest(request) || request.headers.has('Authorization')) {
        return originalFetch(input, init)
      }

      const generation = _memberScopeGeneration
      let token
      try {
        token = await ensureXanoToken(generation)
        assertMemberScopeGeneration(generation)
      } catch (error) {
        assertMemberScopeGeneration(generation)
        log('scheduling auth skipped:', error && error.message)
        const response = await originalFetch(input, init)
        assertMemberScopeGeneration(generation)
        return response
      }

      let response = await originalFetch(withAuthorization(request, token))
      assertMemberScopeGeneration(generation)
      if (response.status === 401) {
        _xanoToken = null
        try {
          token = await ensureXanoToken(generation)
          assertMemberScopeGeneration(generation)
        } catch (error) {
          assertMemberScopeGeneration(generation)
          log('scheduling auth retry failed:', error && error.message)
          return response
        }
        assertMemberScopeGeneration(generation)
        response = await originalFetch(withAuthorization(request, token))
        assertMemberScopeGeneration(generation)
      }
      assertMemberScopeGeneration(generation)
      return response
    }

    log('scheduling auth bridge installed for V3 staging')
  }

  installSchedulingAuthBridge()

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

  const DIAGNOSTIC_CALLS = {
    'brand/opportunities/create': { workflow: 'opportunity_create', resource_type: 'opportunity' },
    'brand/opportunities/update': { workflow: 'opportunity_edit', resource_type: 'opportunity' },
    'brand/opportunities/close': { workflow: 'opportunity_close', resource_type: 'opportunity' },
    'brand/opportunities/reopen': { workflow: 'opportunity_reopen', resource_type: 'opportunity' },
    'brand/applications/archive': { workflow: 'application_archive', resource_type: 'application' },
    'brand/applications/restore': { workflow: 'application_restore', resource_type: 'application' },
    'starter/applications/submit': { workflow: 'opportunity_application', resource_type: 'application' },
    'starter/applications/update': { workflow: 'application_edit', resource_type: 'application' },
    'starter/applications/cancel': { workflow: 'application_withdraw', resource_type: 'application' },
    'projects/action/v3': { workflow: 'project_lifecycle', resource_type: 'project' },
    'brand/reviews/submit': { workflow: 'project_review', resource_type: 'review' },
    'invoices/create/v3': { workflow: 'generate_invoice', resource_type: 'invoice' },
  }
  const responseDiagnostics = new WeakMap()

  function workflowDiagnostics() {
    return window.StartersWorkflowDiagnostics || null
  }

  function beginCallDiagnostic(path) {
    const config = DIAGNOSTIC_CALLS[path]
    const api = workflowDiagnostics()
    if (!config || !api) return null
    return api.record(api.create({
      workflow: config.workflow,
      controller_version: 'opportunities-3.0-v1',
      result: 'started',
      stage: 'auth',
      request_started: false,
      resource_type: config.resource_type,
    }))
  }

  function completeCallDiagnostic(receipt, data, fields) {
    const api = workflowDiagnostics()
    if (!api || !receipt) return null
    const completed = api.record(api.complete(receipt, {
      ...(fields || {}),
      resource_id: '',
      replayed: false,
    }))
    if (data && (typeof data === 'object' || typeof data === 'function')) {
      responseDiagnostics.set(data, completed)
    }
    return completed
  }

  function diagnosticForResponse(result) {
    return result && (typeof result === 'object' || typeof result === 'function')
      ? responseDiagnostics.get(result) || null
      : null
  }

  function diagnosticForError(error) {
    return error && error.workflowDiagnostic || null
  }

  function attachDiagnosticError(error, receipt) {
    if (!receipt) return error
    if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
      error = new Error('Workflow request failed')
    }
    try {
      Object.defineProperty(error, 'workflowDiagnostic', { value: receipt, configurable: true })
    } catch (_) {
      error.workflowDiagnostic = receipt
    }
    return error
  }

  function decorateWorkflowMessage(element, message, receipt) {
    if (!element) return message
    element.textContent = message
    return message
  }

  function workflowDiagnosticMessage(message, receipt) {
    const api = workflowDiagnostics()
    return api && receipt ? api.message(message, receipt) : message
  }

  function validationDiagnostic(workflow, resourceType, errorCode) {
    const api = workflowDiagnostics()
    if (!api) return null
    return api.record(api.create({
      workflow,
      controller_version: 'opportunities-3.0-v1',
      result: 'failed',
      stage: 'validation',
      error_code: errorCode,
      request_started: false,
      resource_type: resourceType,
    }))
  }

  async function call(path, { method = 'POST', body } = {}) {
    const generation = _memberScopeGeneration
    const startedAt = Date.now()
    let diagnostic = null
    let requestStarted = false
    let responseStatus = null
    try {
      if (DIAGNOSTIC_CALLS[path]) await workflowDiagnosticsReady
      diagnostic = beginCallDiagnostic(path)
      assertMemberScopeGeneration(generation)
      const token = await ensureXanoToken(generation)
      assertMemberScopeGeneration(generation)
      requestStarted = true
      const res = await fetch(`${XANO_OPP_BASE}/${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      responseStatus = res.status
      assertMemberScopeGeneration(generation)
      const data = await res.json().catch(() => null)
      assertMemberScopeGeneration(generation)
      if (!res.ok) {
        track('bridge_error', { path, status: res.status })
        throw Object.assign(new Error(data && data.message ? data.message : `API ${res.status}`), {
          status: res.status,
          data,
        })
      }
      completeCallDiagnostic(diagnostic, data, {
        result: 'success',
        stage: 'response',
        http_status: responseStatus,
        duration_ms: Date.now() - startedAt,
        request_started: true,
      })
      const event = TRACKED_CALLS[path]
      if (event) {
        track(event, {
          opportunity_id:
            (body && body.opportunity_id) || (data && (data.opportunity_id || data.id)) || undefined,
          application_id: (body && body.application_id) || undefined,
          has_message: path === 'starter/applications/submit' ? Boolean(body && body.message) : undefined,
        })
      }
      assertMemberScopeGeneration(generation)
      return data
    } catch (error) {
      const failure = completeCallDiagnostic(diagnostic, null, {
        result: 'failed',
        stage: requestStarted ? (responseStatus == null ? 'network' : 'response') : 'auth',
        error_code: error && error.code === 'MEMBER_SCOPE_CHANGED'
          ? 'MEMBER_SCOPE_CHANGED'
          : (responseStatus == null ? (requestStarted ? 'NETWORK_ERROR' : 'AUTH_ERROR') : 'HTTP_ERROR'),
        http_status: responseStatus,
        duration_ms: Date.now() - startedAt,
        request_started: requestStarted,
      })
      throw attachDiagnosticError(error, failure)
    }
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
    brandOppGet: (opportunity_id) => call('brand/opportunities/get', { body: { opportunity_id } }),
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
    projectCreate: (payload) => call('projects/create/v3', { body: payload }),
    projectDirectCreate: (payload) => call('projects/create-direct/v3', { body: payload }),
    projectOptions: (payload = {}) => call('projects/options/v3', { body: payload }),
    projectSubmit: (payload) => call('projects/submit/v3', { body: payload }),
    projectProposalAction: (payload) => call('projects/proposal-action/v3', { body: payload }),
    brandProjectList: (page = 1, per_page = 12) =>
      call('brand/projects/mine', { body: { page, per_page } }),
    starterProjectList: (page = 1, per_page = 12) =>
      call('starter/projects/mine', { body: { page, per_page } }),
    contractLink: (project_id) => call('contracts/link/v3', { body: { project_id } }),
    projectAction: (payload) => call('projects/action/v3', { body: payload }),
    brandReviewSubmit: (payload) => call('brand/reviews/submit', { body: payload }),
    invoiceCreate: (payload) => call('invoices/create/v3', { body: payload }),
    // starter / talent
    starterMatchContext: () => call('starter/profile/match-context', { body: {} }),
    starterOppList: (tab, page = 1, per_page = 20, options = {}) =>
      call('starter/opportunities/list', { body: { tab, page, per_page, ...options } }),
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

  function normalizedPagePath(value) {
    const path = String(value || '/').replace(/\/+$/, '')
    return path || '/'
  }

  function normalizedOpportunityPath(value) {
    if (!value) return ''
    try {
      const currentUrl = new URL(location.href)
      const url = new URL(String(value), currentUrl)
      if (url.origin !== currentUrl.origin || !/^\/opportunities\/[^/]+\/?$/.test(url.pathname)) return ''
      return url.pathname + url.search + url.hash
    } catch (e) {
      return ''
    }
  }

  // URL labels may change independently of identity. Prefer the projected CMS
  // path/slug and use the immutable Xano id only as a backwards-compatible fallback.
  function opportunityPath(item) {
    const record = item && typeof item === 'object' ? item : { id: item }
    const projectedPath = normalizedOpportunityPath(record.url_path)
    if (projectedPath) return projectedPath
    const id = record.opportunity_id || record.id || record.objectID
    const slug = String(record.webflow_slug || id || '').trim()
    return slug ? '/opportunities/' + encodeURIComponent(slug) : ''
  }

  function cardOpportunityPath(card) {
    if (!card) return ''
    const link = $('a[data-opp-detail-link], a[wf-algolia-link-url], a[wf-algolia-link], a.clickable_link', card)
    const renderedPath = link && normalizedOpportunityPath(link.getAttribute('href'))
    if (renderedPath) return renderedPath
    return opportunityPath({
      id:
        card.getAttribute('data-opp-id') ||
        card.getAttribute('data-wf-algolia-hit-objectid') ||
        card.getAttribute('data-wf-xano-id'),
      url_path: card.getAttribute('data-opp-url-path'),
      webflow_slug: card.getAttribute('data-opp-webflow-slug'),
    })
  }

  const fmtDate = (ts) =>
    ts ? new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''

  const CATEGORY_SET_EVENT = 'opp30:set-category-values'
  const MAX_CATEGORY_SELECTIONS = 3
  const EST_HOURS_FIELD_NAME = 'Estimated-Hours'
  const BUDGET_FIELD_BY_PROJECT_TYPE = {
    'One Time': 'One-Time-Budget',
    'Ongoing Part Time': 'Part-Time-Budget',
    'Full Time': 'Full-Time-Budget',
  }
  const CATEGORY_REQUIRED_MESSAGE = 'Please select at least one category.'
  const EST_HOURS_REQUIRED_MESSAGE = 'Please enter the estimated hours per week.'
  const OPPORTUNITY_TITLE_MAX_CHARS = 120
  const OPPORTUNITY_TITLE_MAX_CHARS_MESSAGE =
    'Please keep the title to 120 characters or fewer.'

  function parseStoredCategories(input) {
    try {
      const values = JSON.parse(input.getAttribute('data-opp30-selected-values') || '[]')
      return Array.isArray(values) ? values.map(String).map((value) => value.trim()).filter(Boolean) : []
    } catch (e) {
      return []
    }
  }

  function selectedOpportunityCategories(scope) {
    const input = $('[name="Category-option"]', scope)
    if (!input) return []
    const stored = parseStoredCategories(input)
    if (stored.length) return stored
    const wrapper = input.closest('[ms-code-select-wrapper]') || scope
    return $$('[ms-code-select="tag-name-selected"]', wrapper)
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
  }

  // Shared category multiselect for Create + Edit. This replaces the old
  // component-embedded script and keeps selected values in JSON so category
  // labels containing commas remain a single value end-to-end.
  function initOpportunityCategorySelects(root = document) {
    $$('[ms-code-select-wrapper]', root).forEach((wrapper) => {
      const input = $('[name="Category-option"]', wrapper)
      if (!input || wrapper.getAttribute('data-opp30-category-select-inited') === 'true') return

      const list = $('[ms-code-select="list"]', wrapper)
      const selectedWrapper = $('[ms-code-select="selected-wrapper"]', wrapper)
      if (!list || !selectedWrapper) return

      wrapper.setAttribute('data-opp30-category-select-inited', 'true')
      // The legacy Webflow embed uses this guard. Marking it here prevents both
      // implementations from binding the same control during the migration.
      wrapper.setAttribute('data-ms-code-select-inited', 'true')

      const nearbyScope = wrapper.closest('form') || wrapper.closest('[data-modal-target]') || document
      const modalScope = wrapper.closest('[data-modal-target]')
      const optionScope = $$('.category-option', nearbyScope).length
        ? nearbyScope
        : modalScope && $$('.category-option', modalScope).length
          ? modalScope
          : document
      const options = Array.from(
        new Set(
          $$('.category-option', optionScope)
            .map((el) => (el.textContent || '').trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b))
      if (!options.length) return

      const optionTemplate = $('[ms-code-select="tag-name-new"]', list)
      const selectedTemplate = $('[ms-code-select="tag"]', selectedWrapper)
      if (!optionTemplate || !selectedTemplate) return
      optionTemplate.remove()
      selectedTemplate.remove()

      const emptyState = $('[ms-code-select="empty-state"]', wrapper)
      let selected = parseStoredCategories(input)
        .filter((value) => options.includes(value))
        .slice(0, MAX_CATEGORY_SELECTIONS)
      let query = ''
      let highlightedIndex = -1
      let focused = false

      const warning = () => {
        let el = $('#ms-limit-error', wrapper)
        if (!el) {
          el = document.createElement('div')
          el.id = 'ms-limit-error'
          el.style.cssText =
            'color:#e11d48;font-size:0.75rem;font-weight:400;line-height:1.2;margin-top:4px;position:relative;z-index:0;'
          el.textContent = `You can only select up to ${MAX_CATEGORY_SELECTIONS} options.`
          list.insertAdjacentElement('afterend', el)
        }
        el.style.display = ''
      }

      const hideWarning = () => {
        const el = $('#ms-limit-error', wrapper)
        if (el) el.style.display = 'none'
      }

      const store = () => {
        input.setAttribute('data-opp30-selected-values', JSON.stringify(selected))
        input.setCustomValidity(selected.length ? '' : CATEGORY_REQUIRED_MESSAGE)
        if (!focused) input.value = selected.join(', ')
      }

      const createSelectedTag = (value) => {
        const tag = selectedTemplate.cloneNode(true)
        const name = $('[ms-code-select="tag-name-selected"]', tag)
        if (name) name.textContent = value
        const close = $('[ms-code-select="tag-close"]', tag)
        if (close) {
          close.addEventListener('mousedown', (event) => event.preventDefault())
          close.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            selected = selected.filter((item) => item !== value)
            render()
            input.dispatchEvent(new Event('change', { bubbles: true }))
            hideWarning()
          })
        }
        return tag
      }

      const optionElements = options.map((value) => {
        const option = optionTemplate.cloneNode(true)
        option.textContent = value
        option.setAttribute('data-opp30-category-value', value)
        option.addEventListener('mousedown', (event) => event.preventDefault())
        option.addEventListener('click', () => {
          if (selected.includes(value)) return
          if (selected.length >= MAX_CATEGORY_SELECTIONS) {
            warning()
            return
          }
          selected.push(value)
          query = ''
          input.value = ''
          if (selected.length >= MAX_CATEGORY_SELECTIONS) {
            // Max reached: auto-collapse the dropdown instead of keeping it open.
            focused = false
            list.style.display = 'none'
            render()
            input.blur()
          } else {
            render()
            input.focus()
          }
          input.dispatchEvent(new Event('change', { bubbles: true }))
        })
        list.appendChild(option)
        return option
      })

      const visibleOptions = () =>
        optionElements.filter((option) => option.style.display !== 'none')

      const updateHighlight = () => {
        optionElements.forEach((option) => {
          option.classList.remove('highlighted')
          option.style.backgroundColor = ''
        })
        const visible = visibleOptions()
        if (highlightedIndex >= 0 && visible[highlightedIndex]) {
          visible[highlightedIndex].classList.add('highlighted')
          visible[highlightedIndex].style.backgroundColor = '#eee'
        }
      }

      const render = () => {
        selectedWrapper.replaceChildren(...selected.map(createSelectedTag))
        store()
        const needle = query.trim().toLowerCase()
        let visibleCount = 0
        optionElements.forEach((option) => {
          const value = option.getAttribute('data-opp30-category-value') || ''
          const show = !selected.includes(value) && value.toLowerCase().includes(needle)
          option.style.display = show ? '' : 'none'
          option.style.opacity = selected.length >= MAX_CATEGORY_SELECTIONS ? '0.4' : ''
          option.style.cursor = selected.length >= MAX_CATEGORY_SELECTIONS ? 'not-allowed' : ''
          if (show) visibleCount += 1
        })
        if (emptyState) emptyState.style.display = visibleCount === 0 && needle ? '' : 'none'
        highlightedIndex = -1
        updateHighlight()
      }

      input.addEventListener('focus', () => {
        focused = true
        query = ''
        input.value = ''
        list.style.display = ''
        render()
      })
      input.addEventListener('input', () => {
        query = input.value
        render()
      })
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          focused = false
          query = ''
          list.style.display = 'none'
          render()
        }, 120)
      })
      input.addEventListener('keydown', (event) => {
        const visible = visibleOptions()
        if (!visible.length) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const delta = event.key === 'ArrowDown' ? 1 : -1
          highlightedIndex = (highlightedIndex + delta + visible.length) % visible.length
          updateHighlight()
        } else if (event.key === 'Enter' && highlightedIndex >= 0) {
          event.preventDefault()
          visible[highlightedIndex].click()
        }
      })
      input.addEventListener(CATEGORY_SET_EVENT, (event) => {
        const values = event.detail && Array.isArray(event.detail.values) ? event.detail.values : []
        // Prefill (e.g. the opp's saved category_names) may differ from the
        // option labels only in case/whitespace. Map each incoming value to the
        // canonical option label so it still selects — mirroring an option
        // click, which pushes the exact option label. Dedupe + cap like manual
        // selection does. render() then draws the tags AND stores the JSON.
        const byLower = new Map(options.map((opt) => [opt.toLowerCase(), opt]))
        const seen = new Set()
        selected = values
          .map(String)
          .map((value) => value.trim())
          .map((value) => byLower.get(value.toLowerCase()))
          .filter((value) => {
            if (!value || seen.has(value)) return false
            seen.add(value)
            return true
          })
          .slice(0, MAX_CATEGORY_SELECTIONS)
        render()
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })

      list.style.display = 'none'
      render()
    })
  }

  // Complete the published Create/Edit opportunity form contract. Categories
  // use a custom validity rule because the visible search query may be empty
  // while selected tags are stored separately. Estimated hours is required only
  // for Ongoing Part Time opportunities, and only the selected project type's
  // budget is required. Webflow owns all form markup, including Estimated-Hours
  // and the budget inputs; this controller only binds behavior to those authored
  // controls. wf-validate may already be bound when defer scripts run, so refresh
  // it after applying their state.
  function syncOpportunityEstimatedHours(form) {
    const projectType = $('[name="Project-Type"]:checked', form)
    const projectTypeValue = projectType && (PROJECT_TYPE[projectType.id] || projectType.value)
    const activeBudgetName = BUDGET_FIELD_BY_PROJECT_TYPE[projectTypeValue] || ''

    Object.values(BUDGET_FIELD_BY_PROJECT_TYPE).forEach((name) => {
      const input = $(`[name="${name}"]`, form)
      if (!input) return
      const required = name === activeBudgetName
      input.required = required
      input.setAttribute('aria-required', required ? 'true' : 'false')
      if (!required) input.setCustomValidity('')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const estHoursInput = $(`[name="${EST_HOURS_FIELD_NAME}"]`, form)
    if (estHoursInput) {
      const estHoursGroup = estHoursInput.closest('[data-project-type="part-time"]')
      const required = projectTypeValue === 'Ongoing Part Time'
      if (estHoursGroup) estHoursGroup.hidden = !required
      estHoursInput.required = required
      estHoursInput.setAttribute('aria-required', required ? 'true' : 'false')
      if (!required) estHoursInput.setCustomValidity('')
      estHoursInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  function prepareOpportunityForms(root = document) {
    const forms = []
    if (root.matches && root.matches('[data-opp-form="create"]')) forms.push(root)
    if (root.matches && root.matches('[data-modal-target="edit-opportunity"]')) {
      const form = $('form', root)
      if (form) forms.push(form)
    }
    if (
      root.matches &&
      root.matches('form') &&
      root.closest('[data-modal-target="edit-opportunity"]')
    )
      forms.push(root)
    forms.push(
      ...$$(
        '[data-opp-form="create"], [data-modal-target="edit-opportunity"] form',
        root,
      ),
    )
    Array.from(new Set(forms)).forEach((form) => {
      const titleInput = $('[name="Opportunity-title"]', form)
      if (titleInput) {
        titleInput.setAttribute('maxlength', String(OPPORTUNITY_TITLE_MAX_CHARS))
        titleInput.setAttribute(
          'wf-validate-message-maxlength',
          OPPORTUNITY_TITLE_MAX_CHARS_MESSAGE,
        )
      }

      const categoryInput = $('[name="Category-option"]', form)
      if (categoryInput) {
        categoryInput.setAttribute('aria-required', 'true')
        categoryInput.setAttribute('wf-validate-message', CATEGORY_REQUIRED_MESSAGE)
        categoryInput.setCustomValidity(
          selectedOpportunityCategories(form).length ? '' : CATEGORY_REQUIRED_MESSAGE,
        )
      }

      const estHoursInput = $(`[name="${EST_HOURS_FIELD_NAME}"]`, form)
      if (form.getAttribute('data-opp-conditional-fields-inited') === 'true') return
      form.setAttribute('data-opp-conditional-fields-inited', 'true')
      if (estHoursInput)
        estHoursInput.setAttribute(
          'wf-validate-message-required',
          EST_HOURS_REQUIRED_MESSAGE,
        )
      $$('[name="Project-Type"]', form).forEach((radio) =>
        radio.addEventListener('change', () => syncOpportunityEstimatedHours(form)),
      )
      syncOpportunityEstimatedHours(form)
      if (window.WfValidate && typeof window.WfValidate.refresh === 'function')
        window.WfValidate.refresh(form)
    })
  }

  function setOpportunityCategoryValues(scope, values) {
    const input = $('[name="Category-option"]', scope)
    if (!input) return
    input.dispatchEvent(
      new CustomEvent(CATEGORY_SET_EVENT, {
        detail: { values: Array.isArray(values) ? values : [] },
      }),
    )
  }

  function validateOpportunityPayload(payload) {
    if (!payload.title) return 'Please enter an opportunity title.'
    if (payload.title.length > OPPORTUNITY_TITLE_MAX_CHARS)
      return OPPORTUNITY_TITLE_MAX_CHARS_MESSAGE
    if (!payload.description) return 'Please enter an opportunity description.'
    if (!payload.exp_requirements) return 'Please enter the experience requirements.'
    if (!payload.role_names || !payload.role_names.length) return 'Please select at least one category.'
    if (!payload.project_type) return 'Please choose a project type.'
    if (!payload.est_project_duration) return 'Please choose an estimated project duration.'
    if (payload.project_type === 'Ongoing Part Time' && !payload.est_hours)
      return EST_HOURS_REQUIRED_MESSAGE
    if (!payload.budget) return 'Please enter a budget.'
    return ''
  }

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
    const budgetFieldName = BUDGET_FIELD_BY_PROJECT_TYPE[project_type]
    const budget = budgetFieldName ? val(budgetFieldName) : ''
    const role_names = selectedOpportunityCategories(scope)
    const payload = {
      title: val('Opportunity-title'),
      description: val('Description'),
      exp_requirements: val('Requirements'),
      project_type,
      est_project_duration: checkedVal('Duration'),
      est_hours: project_type === 'Ongoing Part Time' ? val(EST_HOURS_FIELD_NAME) : '',
      budget,
      budget_frequency: BUDGET_FREQUENCY[project_type] || '',
      // Xano resolves role_name -> function/category/subcategory refs via v3 taxonomy tables.
    }
    if (role_names.length) payload.role_names = role_names
    else {
      const legacyRoleName = multiVal('Role-option') || multiVal('Function')
      if (legacyRoleName) payload.role_name = legacyRoleName
    }
    return payload
  }

  // Application UI state (mirrors plan Phase 4). a = application row, o = opportunity.
  // archived_by_brand is intentionally NOT a state here: brand-side archiving is
  // private bookkeeping (it only moves the applicant between the brand's All/
  // Archived tabs) and must stay invisible to the talent. Treating it as a state
  // left an archived applicant's detail page with no Withdraw/Edit CTAs and no
  // state block to render (the template has no data-opp-state="archived"), so the
  // card showed with zero actions. Falling through keeps the application editable/
  // withdrawable and still yields 'closed'/'edited' correctly when those apply.
  function appState(o, a) {
    if (!a) return 'not-applied'
    if (a.canceled_at) return 'canceled'
    if (o && o.closed_at) return 'closed'
    if (o && a.seen_opportunity_revision != null && o.revision_number > a.seen_opportunity_revision)
      return 'edited'
    return 'applied'
  }

  // Toggle elements tagged [data-opp-state="applied|edited|..."] under a root.
  function paintState(root, state) {
    // Drop the detail-page hide-until-state guard now that we know the real
    // state, so the shown CTAs (which paint via an empty inline display) aren't
    // kept hidden by the guard's !important rule.
    const stateGuard = document.getElementById('opp30-detail-hide-until-state')
    if (stateGuard) stateGuard.remove()
    $$('[data-opp-state]', root).forEach((el) => {
      const states = el.getAttribute('data-opp-state').split(/\s+/)
      el.style.display = states.includes(state) ? '' : 'none'
    })
  }

  // Upgrade the legacy published detail-page controls in place. wf-xano-if
  // cannot evaluate these buttons because they live outside a wf-xano list
  // scope. Adding the current data-opp-* contracts before wireModals() runs
  // makes the Reopen action functional without waiting for a Designer publish.
  function prepareOpportunityStatusControls() {
    if (!/^\/opportunities\/[^/]+\/?$/.test(location.pathname)) return

    // The published CMS detail badge is static Webflow text ("Open"/"Closed")
    // with no data binding. Add a runtime contract so close/reopen responses
    // can repaint it immediately while the CMS mirror catches up.
    const brandTags = $('[data-ms-content="premium-brands"].opportunities-content_tag-wrapper')
    const statusBadge = brandTags && $('.label_component', brandTags)
    const statusBadgeText = statusBadge && $('.label_text', statusBadge)
    if (statusBadge) statusBadge.setAttribute('data-opp-status-badge', '')
    if (statusBadgeText && !statusBadgeText.hasAttribute('data-opp-bind'))
      statusBadgeText.setAttribute('data-opp-bind', 'status_label')

    const close = $('[data-modal-trigger="close-opportunity"]')
    if (close) {
      if (!close.hasAttribute('data-opp-status')) close.setAttribute('data-opp-status', 'active')
      close.removeAttribute('wf-xano-if')
    }

    const reopen = $('[data-modal-trigger="reopen-opportunity"]')
    if (reopen) {
      if (!reopen.hasAttribute('data-opp-status')) reopen.setAttribute('data-opp-status', 'closed')
      if (!reopen.hasAttribute('data-opp-submit')) reopen.setAttribute('data-opp-submit', 'reopen')
      reopen.removeAttribute('wf-xano-if')
    }
  }

  // Toggle [data-opp-status="active|closed"] elements by the opportunity's
  // status, so the detail-page Close vs Reopen buttons swap WITHOUT a reload.
  // (wf-xano-if can't drive these — they sit outside any wf-xano list scope —
  // and CMS conditional visibility is decided server-side at load.) Values are
  // space-separated like data-opp-state.
  function paintOppStatus(status) {
    prepareOpportunityStatusControls()
    const key = String(status || '') === 'Closed' ? 'closed' : 'active'
    $$('[data-opp-status]').forEach((el) => {
      const vals = el.getAttribute('data-opp-status').split(/\s+/)
      el.style.display = vals.includes(key) ? '' : 'none'
    })
    document.documentElement.setAttribute('data-opp-status-ready', key)
    const statusGuard = document.getElementById('opp30-detail-hide-until-status')
    if (statusGuard) statusGuard.remove()
  }

  // The shared Close modal on the brand list is not scoped to one opportunity
  // until a card is clicked, so its nav titles cannot use the document-level
  // data-opp-status painter. Upgrade the existing Designer-authored active/
  // closed title twins to a modal-local confirm/success contract, then paint
  // that state explicitly on open and after the close mutation succeeds.
  function prepareCloseOpportunityModalTitles(modal) {
    if (!modal) return
    $$('.modal_nav [data-opp-status]', modal).forEach((el) => {
      const statuses = (el.getAttribute('data-opp-status') || '').split(/\s+/)
      const titleState = statuses.includes('closed')
        ? 'success'
        : statuses.includes('active')
          ? 'confirm'
          : ''
      if (!titleState) return
      el.setAttribute('data-close-opp-title', titleState)
      el.removeAttribute('data-opp-status')
    })
  }

  function paintCloseOpportunityModalTitle(modal, state) {
    if (!modal) return
    prepareCloseOpportunityModalTitles(modal)
    $$('[data-close-opp-title]', modal).forEach((el) => {
      el.style.display = el.getAttribute('data-close-opp-title') === state ? '' : 'none'
    })
  }

  // Opportunity lifecycle controls use valued Webflow-safe attributes:
  //   data-opp-element="loading-button|loading-spinner"
  //   data-opp-element="loading-label|loading-hide" (optional CSS hide targets)
  //   data-opp-loading="false|true"
  // Keep the authored Close/Reopen markup in charge of appearance while
  // matching wf-xano's proven pending-state contract (busy/disabled ARIA,
  // native disabled restoration, mutation class, and duplicate suppression).
  // Close is confirmed inside a form-flow modal, so upgrade that confirmation
  // control with a clone of the authored Close spinner when Designer markup
  // only carries the loading parts on the page-level state button.
  const activeActionGuards = new WeakMap()
  const pendingElementSnapshots = new WeakMap()
  const approvedCloseFlowAdvances = new WeakSet()

  // Upgrade a confirmation control into the loading-button contract and give it
  // a spinner when the Designer authored none: mark it loading-button, seed
  // data-opp-loading, then (if it has no spinner of its own) clone one from the
  // first spinnerSources selector that resolves. Idempotent — the spinner guard
  // keeps repeat calls (modal-open, loadingControlFor) from stacking spinners.
  function upgradeConfirmLoadingButton(confirm, ...spinnerSources) {
    if (!confirm) return
    if (!confirm.hasAttribute('data-opp-element'))
      confirm.setAttribute('data-opp-element', 'loading-button')
    if (!confirm.hasAttribute('data-opp-loading')) confirm.setAttribute('data-opp-loading', 'false')
    if ($('[data-opp-element="loading-spinner"]', confirm)) return
    for (const selector of spinnerSources) {
      const source = $(selector)
      if (source) {
        confirm.appendChild(source.cloneNode(true))
        return
      }
    }
  }

  function prepareOpportunityLoadingControls() {
    $$('[data-opp-element="loading-button"]').forEach((control) => {
      if (!control.hasAttribute('data-opp-loading'))
        control.setAttribute('data-opp-loading', 'false')
    })

    // CLOSE confirm is a plain <div> with no authored spinner — synthesize one
    // from the close trigger's spinner.
    upgradeConfirmLoadingButton(
      $('[data-close-opp="confirm-button"]'),
      '[data-modal-trigger="close-opportunity"] [data-opp-element="loading-spinner"]',
    )

    // REOPEN confirm gets the same guarantee: spin whether or not the Designer
    // authored loading markup on it. Prefer the reopen trigger's own spinner,
    // then fall back to the close trigger's (the known-good source). On the
    // detail page [data-opp-submit="reopen"] is the reopen trigger itself
    // (prepareOpportunityStatusControls stamps it), which already carries a
    // spinner — the guard above skips synthesis there, so no double spinner.
    upgradeConfirmLoadingButton(
      $('[data-opp-submit="reopen"]'),
      '[data-modal-trigger="reopen-opportunity"] [data-opp-element="loading-spinner"]',
      '[data-modal-trigger="close-opportunity"] [data-opp-element="loading-spinner"]',
    )
  }

  function loadingControlFor(btn) {
    prepareOpportunityLoadingControls()
    return (btn && btn.closest('[data-opp-element="loading-button"]')) || btn
  }

  function setPendingElement(el, pending, isLoadingControl) {
    if (!el) return
    if (pending) {
      if (!pendingElementSnapshots.has(el)) {
        pendingElementSnapshots.set(el, {
          ariaBusy: el.getAttribute('aria-busy'),
          ariaDisabled: el.getAttribute('aria-disabled'),
          disabled: 'disabled' in el ? el.disabled : undefined,
          opacity: el.style.opacity,
          pointerEvents: el.style.pointerEvents,
        })
      }
      el.classList.add('is-wf-xano-mutating')
      el.setAttribute('aria-busy', 'true')
      el.setAttribute('aria-disabled', 'true')
      if ('disabled' in el) el.disabled = true
      el.style.pointerEvents = 'none'
      if (isLoadingControl) el.setAttribute('data-opp-loading', 'true')
      else el.style.opacity = '0.6'
      return
    }

    const snapshot = pendingElementSnapshots.get(el)
    el.classList.remove('is-wf-xano-mutating')
    if (isLoadingControl) el.setAttribute('data-opp-loading', 'false')
    if (!snapshot) return
    if (snapshot.ariaBusy == null) el.removeAttribute('aria-busy')
    else el.setAttribute('aria-busy', snapshot.ariaBusy)
    if (snapshot.ariaDisabled == null) el.removeAttribute('aria-disabled')
    else el.setAttribute('aria-disabled', snapshot.ariaDisabled)
    if ('disabled' in el && snapshot.disabled !== undefined) el.disabled = snapshot.disabled
    el.style.opacity = snapshot.opacity
    el.style.pointerEvents = snapshot.pointerEvents
    pendingElementSnapshots.delete(el)
  }

  function setOpportunityActionPending(btn, pending) {
    const control = loadingControlFor(btn)
    const hasLoadingUi =
      control && control.matches('[data-opp-element="loading-button"]')
    setPendingElement(control, pending, hasLoadingUi)
    // Close's delegated click resolves to the inner native button while the
    // loading UI lives on the outer confirmation control. Disable both so
    // keyboard activation cannot bypass the visual pointer lock.
    if (btn && btn !== control) setPendingElement(btn, pending, false)
    const nativeControl =
      control && $('button, input[type="button"], input[type="submit"]', control)
    if (nativeControl && nativeControl !== btn)
      setPendingElement(nativeControl, pending, false)
    return control
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
    unwireInvoiceWorkflow()
    unwireProjectDashboardWorkflow()
    _cacheMemberId = memberId
    _memberScopeGeneration += 1
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
    window.dispatchEvent(new CustomEvent(MEMBER_SCOPE_RESET_EVENT, { detail: { memberId } }))
  }

  async function wireMemberScopeAuthChange() {
    if (_memberScopeAuthChangeWired) return
    const memberstack = await waitForMemberstackDom()
    if (
      _memberScopeAuthChangeWired ||
      !memberstack ||
      typeof memberstack.onAuthChange !== 'function'
    ) {
      return
    }
    _memberScopeAuthChangeWired = true
    memberstack.onAuthChange((member) => {
      resetMemberScopedCaches(member?.id || null)
      if (normalizedPagePath(location.pathname) === '/all-modals') {
        wireInvoiceWorkflow()
      } else {
        authorizeStarterInvoiceWorkflow(member)
      }
      authorizeProjectDashboardWorkflow(member)
    })
  }

  /**
   * Build the V3 login URL while preserving the current path and query for the
   * role-scoped post-login router.
   * @returns {string}
   */
  function loginPathWithNext() {
    const next = location.pathname + location.search
    return '/login?next=' + encodeURIComponent(next)
  }

  /**
   * True after the sitewide route guard (v3/route-guard.js) has stamped
   * `html[data-route-guard]`. The authored script tag is detected separately so
   * this controller can wait when reversed defer order lets it execute first.
   * Once the guard reaches `allowed`, opp30 leaves access redirects to that
   * stable plan-ID authority and only fetches the member to scope its data.
   * Real security is enforced server-side in Xano regardless.
   * @returns {boolean}
   */
  function routeGuardActive() {
    try {
      return document.documentElement.getAttribute('data-route-guard') != null
    } catch (e) {
      return false
    }
  }

  /**
   * True when Webflow has authored the sitewide route-guard script on this
   * page, even if an earlier defer script is currently executing before the
   * guard has stamped html[data-route-guard].
   * @returns {boolean}
   */
  function routeGuardConfigured() {
    try {
      return !!document.querySelector('script[src*="/v3/route-guard.js"]')
    } catch (e) {
      return false
    }
  }

  let _routeGuardHandoffPromise = null

  function routeGuardOutcome() {
    try {
      if (document.documentElement.getAttribute('data-route-guard-error') != null) {
        return 'blocked'
      }
      const state = document.documentElement.getAttribute('data-route-guard')
      if (state === 'allowed') return 'allowed'
      if (state === 'redirecting') return 'blocked'
      return state == null ? null : 'pending'
    } catch (e) {
      return null
    }
  }

  /**
   * Give an authored, later-ordered route guard the opportunity to claim access
   * redirects before this controller evaluates Memberstack role state. This
   * closes the defer-order race where an early member snapshot can temporarily
   * omit planConnections and the legacy fallback would redirect to `/`.
   *
   * A guard that never boots still falls back after a bounded wait so legacy
   * installs retain their previous behavior.
   * @returns {Promise<'allowed'|'blocked'|'fallback'>}
   */
  function waitForRouteGuardHandoff() {
    if (_routeGuardHandoffPromise) return _routeGuardHandoffPromise
    const initialOutcome = routeGuardOutcome()
    if (initialOutcome === 'allowed' || initialOutcome === 'blocked') {
      return Promise.resolve(initialOutcome)
    }
    if (initialOutcome == null && !routeGuardConfigured()) return Promise.resolve('fallback')

    _routeGuardHandoffPromise = new Promise((resolve) => {
      const startedAt = Date.now()
      let guardBooted = initialOutcome != null
      const check = () => {
        const outcome = routeGuardOutcome()
        if (outcome === 'allowed' || outcome === 'blocked') {
          resolve(outcome)
          return
        }
        if (outcome === 'pending') guardBooted = true
        if (!guardBooted && Date.now() - startedAt >= ROUTE_GUARD_HANDOFF_TIMEOUT_MS) {
          resolve('fallback')
          return
        }
        window.setTimeout(check, 25)
      }
      check()
    })
    return _routeGuardHandoffPromise
  }

  /**
   * A brand opening an opportunity it does not own gets a 403/404 from the
   * owner-scoped applicants probe (server-side check). Product decision
   * 2026-07-23 (Kaeser): redirect such a brand to its opportunities feed rather
   * than showing a view-only detail page. Only ownership-denied statuses trigger
   * the redirect — transient/5xx/network errors are left to the caller so a real
   * owner is never bounced on a blip. Returns true if it redirected.
   * @param {any} err
   * @returns {boolean}
   */
  function redirectForeignBrandToFeed(err) {
    if (err && (err.status === 403 || err.status === 404)) {
      location.href = '/opportunities-brands-view'
      return true
    }
    return false
  }

  async function initialMemberSnapshot(memberstack) {
    if (window.memberReady && typeof window.memberReady.then === 'function') {
      const member = await window.memberReady
      if (member && member.id) return member
    }
    const response = await memberstack.getCurrentMember()
    return response && response.data
  }

  /**
   * Resolve the current member for a page. Wait for an authored route guard;
   * after `allowed`, require the matching plan-ID role but leave redirects to
   * the guard. A guard error or redirect blocks page work. Only a guard that
   * never boots uses the legacy custom-field check and redirects.
   * @param {'brand'|'freelancer'} expect
   * @returns {Promise<object|null>}
   */
  async function gateOrRedirect(expect /* 'brand' | 'freelancer' */) {
    const guardOutcome = await waitForRouteGuardHandoff()
    if (guardOutcome === 'blocked') return null
    const memberstack = await waitForMemberstackDom()
    if (!memberstack) throw new Error('Memberstack not available')
    const member = await initialMemberSnapshot(memberstack)
    if (!member || !member.id) {
      resetMemberScopedCaches(null)
      if (guardOutcome !== 'allowed') location.href = loginPathWithNext()
      return null
    }
    resetMemberScopedCaches(member.id)
    if (guardOutcome === 'allowed') {
      const role = memberPlanRole(member)
      const expectedRole = expect === 'brand' ? 'brand-paid' : 'talent'
      return role === expectedRole ? member : null
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

  /**
   * Memberstack can briefly return the authenticated member before
   * `planConnections` has hydrated during a fresh page boot. Retry only that
   * incomplete snapshot; an already-mapped role returns immediately.
   * @param {{getCurrentMember: () => Promise<{data?: object|null}>}} memberstack
   * @param {object} initialMember
   * @returns {Promise<{member: object, role: 'brand-paid'|'brand-free'|'talent'|null}>}
   */
  async function waitForMappedMemberRole(memberstack, initialMember) {
    let member = initialMember
    let role = memberPlanRole(member)
    if (role || member.planConnections?.length) return { member, role }

    const startedAt = Date.now()
    while (Date.now() - startedAt < MEMBER_ROLE_HYDRATION_TIMEOUT_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, MEMBER_ROLE_HYDRATION_POLL_MS))
      try {
        const response = await memberstack.getCurrentMember()
        if (response && response.data && response.data.id) member = response.data
      } catch (_) {}
      role = memberPlanRole(member)
      if (role || member.planConnections?.length) return { member, role }
    }
    return { member, role: null }
  }

  /** Plan-based gate for pages shared by talent AND paying brands
   *  (/opportunities/<slug>). After the route guard reports `allowed`, this
   *  only resolves {member, role} for the two valid roles and bails quietly
   *  otherwise; guard errors and redirects block page work. An authenticated
   *  snapshot with empty planConnections gets a bounded hydration retry, while
   *  a non-empty unmapped snapshot does not. If no guard is authored, legacy
   *  redirects apply: logged-out -> /login?next=..., free brand ->
   *  brandFreeHome (/quiz or /quiz-results), unmapped plans -> /. A configured
   *  guard that never boots and has no hydrated role fails closed in place. */
  async function gateByPlan() {
    const guardOutcome = await waitForRouteGuardHandoff()
    if (guardOutcome === 'blocked') return null
    const memberstack = await waitForMemberstackDom()
    if (!memberstack) throw new Error('Memberstack not available')
    const initialMember = await initialMemberSnapshot(memberstack)
    let member = initialMember
    if (!member || !member.id) {
      resetMemberScopedCaches(null)
      if (guardOutcome !== 'allowed') location.href = loginPathWithNext()
      return null
    }
    resetMemberScopedCaches(member.id)
    let role = memberPlanRole(member)
    if (!role) {
      const hydrated = await waitForMappedMemberRole(memberstack, member)
      member = hydrated.member
      role = hydrated.role
      resetMemberScopedCaches(member.id)
    }
    log('gateByPlan role:', role)
    if (guardOutcome === 'allowed') {
      // Guard already enforced page access. Reveal content only for the roles
      // valid on this page; bail quietly for anything else (the guard is mid-
      // redirect or showing its error state).
      return role === 'talent' || role === 'brand-paid' ? { member, role } : null
    }
    if (role === 'brand-free') {
      location.href = brandFreeHome(member)
      return null
    }
    if (!role) {
      // A configured route guard is the access authority. If Memberstack never
      // hydrates a mapped plan, fail closed on the current page instead of
      // sending a valid but temporarily incomplete member snapshot to `/`.
      if (routeGuardConfigured()) {
        document.documentElement.setAttribute('data-route-guard-error', 'member-role-unavailable')
        console.error('[opp30] Unable to resolve an active Memberstack plan for this page.')
        return null
      }
      location.href = '/'
      return null
    }
    return { member, role }
  }

  /** Reveal the [data-opp-role] wrapper matching `role` ('talent' | 'brand') and
   *  hide the rest. Pair with a page-head embed of
   *  <style>html:not([data-opp-role-resolved]) [data-opp-role]{display:none}</style>
   *  so neither wrapper flashes before this footer script resolves the member's
   *  plan. */
  function showRoleWrapper(role) {
    $$('[data-opp-role]').forEach((el) => {
      el.style.display = el.getAttribute('data-opp-role') === role ? '' : 'none'
    })
    document.documentElement.setAttribute('data-opp-role-resolved', role)
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

  /* ======================= INVOICES ============================ */
  const INVOICE_MODAL_ID = 'generate-invoice'
  const INVOICE_MODAL_SELECTOR = '[data-modal-target="' + INVOICE_MODAL_ID + '"]'
  const INVOICE_ACTION_SELECTOR =
    '[data-project-action="invoice"], a[href="#' + INVOICE_MODAL_ID + '"]'
  // The shared Webflow button component currently renders the authored Send
  // Invoice control as type="button" even when its Button Type prop is enabled.
  // Keep the fallback scoped to the native Generate Invoice form and its
  // attribute-driven primary action; native submit controls continue to work.
  // `data-button-style` is a theming attribute, not a behaviour hook, so it only
  // resolves the submitter while it is unambiguous — one primary-styled control
  // in that form and no native submit. Authoring [data-wf-invoice="submit"] on
  // the CTA wrapper always wins and never depends on the theme.
  const INVOICE_FORM_SELECTOR = '#wf-form-Generate-Invoice'
  const INVOICE_SUBMIT_HOOK_SELECTOR = '[data-wf-invoice="submit"]'
  const INVOICE_SUBMIT_STYLE_SELECTOR = INVOICE_FORM_SELECTOR + ' [data-button-style="primary"]'
  const INVOICE_SUBMIT_ACTION_SELECTOR =
    INVOICE_SUBMIT_HOOK_SELECTOR + ', ' + INVOICE_SUBMIT_STYLE_SELECTOR
  // A design-system button is disabled by attribute on its .button_main-wrap
  // wrapper, never by the native property (form-validation.js setButtonEnabled,
  // step-flow.js, tabs.js), so a gated control still receives the click.
  const INVOICE_DISABLED_SELECTOR =
    '[data-validate-disabled], [data-button-theme="disabled"], [aria-disabled="true"]'
  const INVOICE_DISABLED_THEME = 'disabled'
  // Same card contract as every other delegated handler in this file: the
  // wf-xano-rendered project card is whatever ancestor carries the row id.
  const INVOICE_CARD_SELECTOR = '[data-wf-xano-id]'
  const INVOICE_PAYMENT_LINK_PLACEHOLDER = '#invoice-payment-link'
  const INVOICE_MIN_AMOUNT = 0.01
  const INVOICE_MAX_AMOUNT = 1000000
  const INVOICE_AMOUNT_MESSAGE = 'Enter an amount between $0.01 and $1,000,000.'
  const INVOICE_NO_PROJECT_MESSAGE =
    'Open Generate Invoice from the project you want to bill, so we know which project to invoice.'
  let activeInvoiceProject = null
  let invoiceWorkflowBinding = null

  function invoiceProjectContext(card) {
    if (!card) return null
    const projectId = parseInt(card.getAttribute('data-wf-xano-id') || '', 10)
    if (!(projectId > 0)) return null
    // Prefer a bound brand/company field — on the authored V3 project card that
    // field is wf-xano-bind="company_name". The "Title | Brand" heading split is
    // only a fallback, and a title containing a pipe makes the last segment the
    // closest guess at the brand.
    const heading = cardFieldText(card, 'heading_display')
    const headingBrand = heading.includes('|') ? heading.split('|').pop().trim() : heading
    return {
      card,
      projectId,
      title: cardFieldText(card, 'title'),
      brand:
        cardFieldText(card, 'brand') ||
        cardFieldText(card, 'company') ||
        cardFieldText(card, 'company_name') ||
        headingBrand,
    }
  }

  /** Round to cents, then accept only a billable amount. @returns {number|null} */
  function normalizeInvoiceAmount(value) {
    const raw = Number(value)
    if (!Number.isFinite(raw)) return null
    const amount = Math.round(raw * 100) / 100
    if (amount < INVOICE_MIN_AMOUNT || amount > INVOICE_MAX_AMOUNT) return null
    return amount
  }

  function invoiceBind(modal, field, value) {
    if (!modal) return
    $$('[data-wf-invoice-bind="' + field + '"]', modal).forEach((el) => {
      el.textContent = value == null ? '' : String(value)
    })
  }

  // Single resolution for the authored error hook, so show and clear can never
  // drift onto different elements.
  function invoiceFailEl(modal) {
    if (!modal) return null
    return $('[data-wf-invoice="error"]', modal) || $('.w-form-fail', modal)
  }

  // The authored component has no data hook on its pay CTA, so the only way in
  // is the "#invoice-payment-link" placeholder href — which paintInvoiceSuccess
  // then overwrites with the live Stripe URL. Stamp our own hook on the first
  // resolve so every later invoice in the same page session still finds the same
  // anchor instead of silently painting nothing and leaving the previous
  // invoice's link behind the button.
  function invoicePaymentLinkEl(modal) {
    if (!modal) return null
    const link =
      $('[data-wf-invoice="payment-link"]', modal) ||
      $('a[href="' + INVOICE_PAYMENT_LINK_PLACEHOLDER + '"]', modal)
    if (link && link.getAttribute('data-wf-invoice') !== 'payment-link') {
      link.setAttribute('data-wf-invoice', 'payment-link')
    }
    return link
  }

  // The authored "View in Stripe" control is a design-system button: the visible
  // element is the .button_main-wrap div and the anchor inside it is an
  // invisible overlay (the same shape step-flow.js and form-validation.js
  // resolve with "button, a.clickable_link, .clickable_btn"). Toggling display
  // on the anchor alone would leave the styled button on the success screen with
  // nothing behind it, so show/hide the wrapper instead.
  function invoicePaymentLinkWrap(link) {
    if (!link) return null
    return (link.closest && link.closest('.button_main-wrap')) || link
  }

  function invoiceError(modal, message, receipt) {
    const text = message || 'Something went wrong. Please try again.'
    const fail = invoiceFailEl(modal)
    if (!fail) {
      console.warn(
        '[opp30:invoice] the Generate Invoice modal has no [data-wf-invoice="error"] or .w-form-fail element, so this stayed invisible to the member:',
        text,
      )
      return
    }
    const target = $('[data-wf-invoice="error-message"]', fail) || fail
    if (receipt) decorateWorkflowMessage(target, text, receipt)
    else target.textContent = text
    fail.style.display = 'block'
  }

  function clearInvoiceError(modal) {
    const fail = invoiceFailEl(modal)
    if (fail) fail.style.display = ''
  }

  function invoiceIdempotencyKey(form, projectId) {
    if (form.dataset.invoiceIdempotencyKey) return form.dataset.invoiceIdempotencyKey
    const uuid =
      window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    form.dataset.invoiceIdempotencyKey = 'invoice-v3-' + projectId + '-' + uuid
    return form.dataset.invoiceIdempotencyKey
  }

  // Reset the authored screens and remember which project this invoice bills,
  // without opening anything — the caller decides when the dialog appears.
  function prepareInvoiceModal(modal, context) {
    activeInvoiceProject = context
    invoiceBind(modal, 'brand', context.brand)
    invoiceBind(modal, 'project', context.title)
    const form = $('form', modal)
    const done = $('.w-form-done', modal)
    if (form) {
      form.reset()
      form.style.display = ''
      delete form.dataset.invoiceIdempotencyKey
    }
    if (done) done.style.display = ''
    // Put the previous invoice's live Stripe URL back to the placeholder, so a
    // half-painted success screen can never expose a pay button for an invoice
    // the member is no longer looking at.
    const link = invoicePaymentLinkEl(modal)
    if (link) link.href = INVOICE_PAYMENT_LINK_PLACEHOLDER
    const linkWrap = invoicePaymentLinkWrap(link)
    if (linkWrap) linkWrap.style.display = ''
    clearInvoiceError(modal)
  }

  /**
   * Open through modal.js's registry, not showModal(): modal.js owns the paused
   * gsap entrance timeline (whose from/fromTo tweens have already rendered the
   * .modal_content at opacity 0), the lenis/body scroll lock, and the
   * last-focused element it restores on close. Calling showModal() ourselves
   * would show an invisible dialog over a still-scrollable page. The direct
   * path stays only as a fallback for pages without modal.js.
   * @returns {boolean} whether the dialog is open
   */
  function showInvoiceModal(modal) {
    if (modal.open) return true
    const list = window.lumos && window.lumos.modal ? window.lumos.modal.list : null
    const entry = list ? list[INVOICE_MODAL_ID] : null
    if (entry && typeof entry.open === 'function') {
      try {
        entry.open()
        return true
      } catch (err) {
        console.warn('[opp30:invoice] modal.js refused to open the Generate Invoice modal', err)
      }
    }
    if (typeof modal.showModal === 'function') modal.showModal()
    else modal.setAttribute('open', '')
    window.dispatchEvent(new CustomEvent('modal-open', { detail: { modal } }))
    return true
  }

  function openInvoiceModal(card) {
    const modal = $(INVOICE_MODAL_SELECTOR)
    const context = invoiceProjectContext(card)
    if (!modal || !context) return false
    prepareInvoiceModal(modal, context)
    return showInvoiceModal(modal)
  }

  function formatInvoiceAmount(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
  }

  function paintInvoiceSuccess(modal, result, context, amount) {
    const form = $('form', modal)
    const done = $('.w-form-done', modal)
    if (form) form.style.display = 'none'
    if (done) {
      done.style.display = 'block'
      const receipt = diagnosticForResponse(result)
      const message = done.querySelector ? $('[data-workflow-diagnostic-message]', done) : null
      if (message && receipt) decorateWorkflowMessage(message, message.textContent, receipt)
    }
    invoiceBind(modal, 'brand', context.brand)
    invoiceBind(modal, 'project', context.title)
    invoiceBind(modal, 'amount', formatInvoiceAmount(amount))
    invoiceBind(modal, 'status', (result && result.status) || 'unpaid')
    const link = invoicePaymentLinkEl(modal)
    if (!link) return
    const linkWrap = invoicePaymentLinkWrap(link)
    const paymentLink = result && result.payment_link
    if (!paymentLink) {
      // The authored anchor still points at its "#invoice-payment-link"
      // placeholder, so showing it would be a dead pay button.
      linkWrap.style.display = 'none'
      console.warn('[opp30:invoice] invoice created without a payment_link; pay CTA hidden', result)
      return
    }
    link.href = paymentLink
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    linkWrap.style.display = ''
  }

  function invoiceErrorMessage(err) {
    const message = (err && err.data && err.data.message) || (err && err.message) || ''
    if (/connect a stripe account/i.test(message)) {
      return 'Connect your Stripe account from the dashboard before generating invoices.'
    }
    return message || 'Invoice generation failed. Please try again.'
  }

  /**
   * Single resolution for the control that submits the invoice form, so the
   * click fallback and the in-flight disable can never drift onto different
   * elements. @returns {Element|null}
   */
  function invoiceSubmitControl(form) {
    if (!form || typeof form.querySelector !== 'function') return null
    const hook = $(INVOICE_SUBMIT_HOOK_SELECTOR, form)
    if (hook) return hook
    const native = $('[type="submit"]', form)
    if (native) return native
    if (typeof form.querySelectorAll !== 'function') return null
    const styled = $$(INVOICE_SUBMIT_STYLE_SELECTOR, form)
    if (styled.length === 1) return styled[0]
    if (styled.length > 1) {
      console.warn(
        '[opp30:invoice] the Generate Invoice form has several primary-styled buttons and no submit control, so the click fallback stood down; author data-wf-invoice="submit" on the Send Invoice wrapper',
        styled.length,
      )
    }
    return null
  }

  // The hook and the theming attribute can sit on different elements of the same
  // design-system button (wrapper, overlaid .clickable_btn, label), so the click
  // counts as the resolved submitter whenever the two are in the same subtree.
  function invoiceSubmitOwns(control, action) {
    if (!control || !action) return false
    if (control === action) return true
    if (control.contains && control.contains(action)) return true
    return !!(action.contains && action.contains(control))
  }

  function invoiceControlDisabled(control) {
    return !!(control && control.closest && control.closest(INVOICE_DISABLED_SELECTOR))
  }

  // Follow form-validation.js's split between wrapper markers and the native
  // property on the actionable element. Preserve an authored wrapper theme;
  // wrappers without one still receive aria-disabled. A native submit control
  // is its own actionable element.
  function setInvoiceSubmitDisabled(control, disabled) {
    if (!control || typeof control.setAttribute !== 'function') return
    const actionable =
      (control.querySelector &&
        control.querySelector('button, a.clickable_link, .clickable_btn')) ||
      control
    if (disabled) {
      const theme = control.getAttribute && control.getAttribute('data-button-theme')
      if (theme && theme !== INVOICE_DISABLED_THEME) {
        if (control.dataset) control.dataset.invoiceOriginalTheme = theme
        control.setAttribute('data-button-theme', INVOICE_DISABLED_THEME)
      }
      control.setAttribute('aria-disabled', 'true')
      if ('disabled' in actionable) actionable.disabled = true
      return
    }
    const original = control.dataset && control.dataset.invoiceOriginalTheme
    if (original) {
      control.setAttribute('data-button-theme', original)
      delete control.dataset.invoiceOriginalTheme
    }
    if (control.removeAttribute) control.removeAttribute('aria-disabled')
    if ('disabled' in actionable) actionable.disabled = false
  }

  function requestInvoiceSubmit(target) {
    const action =
      target && target.closest ? target.closest(INVOICE_SUBMIT_ACTION_SELECTOR) : null
    if (!action) return false
    const form = action.closest && action.closest('form')
    const modal = form && form.closest && form.closest(INVOICE_MODAL_SELECTOR)
    if (!form || !modal) return false
    const control = invoiceSubmitControl(form)
    // A native submitter needs no fallback: the browser's own click handling
    // stays in charge and this listener must not swallow it.
    if (control && control.matches && control.matches('[type="submit"]')) return false
    if (!invoiceSubmitOwns(control, action)) return false
    // A visually disabled control never acts: this listener sees the click
    // before the wrapper's own capture gate, so it has to stand down itself.
    if (invoiceControlDisabled(action) || invoiceControlDisabled(control)) return false
    if (typeof form.requestSubmit === 'function') form.requestSubmit()
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    return true
  }

  function invoiceWorkflowBindingCurrent(binding) {
    if (invoiceWorkflowBinding !== binding) return false
    const path = normalizedPagePath(location.pathname)
    if (binding.generation === null) return path === '/all-modals'
    return path === '/starter-dashboard' && binding.generation === _memberScopeGeneration
  }

  function unwireInvoiceWorkflow() {
    const binding = invoiceWorkflowBinding
    if (!binding) return
    invoiceWorkflowBinding = null
    document.removeEventListener('click', binding.click, true)
    document.removeEventListener('submit', binding.submit, true)
    if (binding.submitControl) setInvoiceSubmitDisabled(binding.submitControl, false)
    activeInvoiceProject = null
    delete window.__opp30InvoicesWired
  }

  function authorizeStarterInvoiceWorkflow(member) {
    if (
      normalizedPagePath(location.pathname) !== '/starter-dashboard' ||
      !member ||
      member.id !== _cacheMemberId ||
      memberPlanRole(member) !== 'talent'
    ) {
      unwireInvoiceWorkflow()
      return false
    }
    wireInvoiceWorkflow(_memberScopeGeneration)
    return true
  }

  function wireInvoiceWorkflow(generation = null) {
    if (
      invoiceWorkflowBinding &&
      invoiceWorkflowBinding.generation === generation &&
      invoiceWorkflowBindingCurrent(invoiceWorkflowBinding)
    ) {
      return
    }
    unwireInvoiceWorkflow()
    const binding = { generation, submitting: false, submitControl: null }
    window.__opp30InvoicesWired = true

    binding.click = (event) => {
      if (!invoiceWorkflowBindingCurrent(binding)) {
        unwireInvoiceWorkflow()
        return
      }
      const target = event.target
      if (requestInvoiceSubmit(target)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const action = target && target.closest ? target.closest(INVOICE_ACTION_SELECTOR) : null
      if (!action) return
      // Only swallow the click once we know this workflow can handle it —
      // otherwise modal.js's own trigger delegation must stay reachable.
      const modal = $(INVOICE_MODAL_SELECTOR)
      const context = invoiceProjectContext(action.closest(INVOICE_CARD_SELECTOR))
      if (!modal || !context) {
        console.error('[opp30:invoice] cannot prepare the Generate Invoice modal', {
          modal: !!modal,
          project: context ? context.projectId : null,
        })
        return
      }
      event.preventDefault()
      event.stopPropagation()
      prepareInvoiceModal(modal, context)
      showInvoiceModal(modal)
    }

    binding.submit = async (event) => {
      if (!invoiceWorkflowBindingCurrent(binding)) {
        unwireInvoiceWorkflow()
        return
      }
      const form = event.target
      const modal = form && form.closest && form.closest(INVOICE_MODAL_SELECTOR)
      if (!modal) return
      event.preventDefault()
      event.stopPropagation()
      if (binding.submitting) return
      // modal.js's own trigger delegation can open this dialog without any
      // card, so there is no project to bill until prepareInvoiceModal ran.
      const context = activeInvoiceProject
      if (!context) {
        invoiceError(
          modal,
          INVOICE_NO_PROJECT_MESSAGE,
          validationDiagnostic('generate_invoice', 'invoice', 'NO_PROJECT_CONTEXT'),
        )
        return
      }

      const amountInput = $('#Amount', form) || $('[name="Amount"]', form)
      const descriptionInput = $('#Description', form) || $('[name="Description"]', form)
      const amount = normalizeInvoiceAmount(amountInput && amountInput.value)
      if (amount === null) {
        invoiceError(
          modal,
          INVOICE_AMOUNT_MESSAGE,
          validationDiagnostic('generate_invoice', 'invoice', 'INVALID_AMOUNT'),
        )
        return
      }

      clearInvoiceError(modal)
      binding.submitting = true
      const submit = invoiceSubmitControl(form)
      binding.submitControl = submit
      setInvoiceSubmitDisabled(submit, true)
      try {
        const result = await API.invoiceCreate({
          project_id: context.projectId,
          amount,
          description: descriptionInput ? descriptionInput.value.trim() : '',
          idempotency_key: invoiceIdempotencyKey(form, context.projectId),
        })
        if (!invoiceWorkflowBindingCurrent(binding)) return
        paintInvoiceSuccess(modal, result, context, amount)
        delete form.dataset.invoiceIdempotencyKey
        // A stale project must never be billed by a later submit from a modal
        // that was reopened without a card.
        activeInvoiceProject = null
        // Feed refresh is cosmetic; never report a created invoice as failed.
        try {
          if (window.WfXano && typeof window.WfXano.refresh === 'function') {
            window.WfXano.refresh(context.card.closest('[wf-xano-source]') || undefined)
          }
        } catch (refreshError) {
          /* non-fatal: the next page load repaints the card */
        }
      } catch (err) {
        if (!invoiceWorkflowBindingCurrent(binding)) return
        const receipt = diagnosticForError(err)
        console.error('[opp30:invoice] request failed', {
          diagnostic_id: receipt && receipt.diagnostic_id || '',
          error_code: receipt && receipt.error_code || 'WORKFLOW_ERROR',
          http_status: receipt && receipt.http_status,
        })
        invoiceError(modal, invoiceErrorMessage(err), diagnosticForError(err))
      } finally {
        if (invoiceWorkflowBindingCurrent(binding)) {
          binding.submitting = false
          binding.submitControl = null
          setInvoiceSubmitDisabled(submit, false)
        }
      }
    }

    invoiceWorkflowBinding = binding
    document.addEventListener('click', binding.click, true)
    document.addEventListener('submit', binding.submit, true)
  }

  /* ================= PROJECT DASHBOARD ACTIONS ================ */
  const PROJECT_CARD_SELECTOR = '.project_item[data-wf-xano-id]'
  const PROJECT_CONTRACT_SELECTOR =
    'a[href="#contract"], [data-project-action="contract"], [data-project-contract-action]'
  const PROJECT_CONTRACT_PANEL_SELECTOR = '[data-project-contract-panel]'
  const PROJECT_CONTRACT_TITLE_SELECTOR = '[data-project-contract-title]'
  const PROJECT_CONTRACT_BODY_SELECTOR = '[data-project-contract-body]'
  const PROJECT_CONTRACT_BADGE_SELECTOR = '[data-project-contract-badge]'
  const PROJECT_CONTRACT_ACTIONS_SELECTOR = '[data-project-contract-actions]'
  const PROJECT_END_SELECTOR =
    '[wf-xano-link="project-end"], [wf-xano-link="project-decline"], [data-project-action="end"]'
  const PROJECT_REVIEW_SELECTOR =
    '[wf-xano-link="review_starter"], [data-project-action="review"]'
  const PROJECT_REVIEW_MODAL_ID = 'rate-starter-call'
  const PROJECT_TERMINAL_STATES = new Set(['completed', 'terminated', 'canceled', 'cancelled'])
  // This action calls PandaDoc's recipient view/sign session endpoint. Completed
  // documents require the separate protected-PDF delivery contract.
  const PROJECT_VIEWABLE_CONTRACT_STATES = new Set(['sent', 'viewed', 'partial'])
  const PROJECT_CONTRACT_PREPARING_LIFECYCLES = new Set([
    'draft', 'contract_create_pending', 'contract_draft',
  ])
  const PROJECT_CONTRACT_PREPARING_STATUSES = new Set([
    'not_requested', 'create_pending', 'uploaded', 'draft',
  ])
  const PROJECT_CONTRACT_ATTENTION_STATES = new Set([
    'declined', 'expired', 'exception', 'error', 'contract_declined', 'contract_expired',
  ])
  const PROJECT_CONTRACT_HIDDEN_LIFECYCLES = new Set([
    'active', 'completion_requested', 'termination_requested',
    'completed', 'terminated', 'canceled', 'cancelled',
  ])
  const PROJECT_TIMELINE_FIELD_SELECTOR = '[wf-xano-bind="timeline_display"]'
  const PROJECT_CONTRACT_DETAILS_SELECTOR =
    '[wf-xano-element="nest-target"][wf-xano-field="contract_details"]'
  const PROJECT_CONTRACT_DETAIL_ROW_SELECTOR = '[data-wf-xano-nest-clone]'
  const PROJECT_TIMELINE_MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  let projectWorkflowRole = ''
  let projectWorkflowItems = new Map()
  let projectWorkflowRefresh = null
  let projectWorkflowObserver = null
  let projectWorkflowBinding = null
  let projectWorkflowProjectionUnsubscribe = null
  let projectWorkflowProjectionInstance = null
  let projectWorkflowActionLocks = new Map()
  let projectWorkflowFeedbackElement = null
  let projectWorkflowFeedbackTimer = null
  const projectActionFeedbackTimers = new WeakMap()
  let activeReviewProject = null
  let activeReviewModal = null
  let projectReviewOpenGeneration = 0
  let reviewSubmitting = false

  function normalizedDashboardPath() {
    return String(location.pathname || '/').replace(/\/+$/, '') || '/'
  }

  function projectRoleForPath() {
    const path = normalizedDashboardPath()
    if (path === '/brand-dashboard') return 'brand'
    if (path === '/starter-dashboard') return 'starter'
    return ''
  }

  function prepareDashboardProjectLazyDetails() {
    const role = projectRoleForPath()
    if (!role) return 0
    const root = currentProjectWorkflowRoot(role)
    const template = root && $('[wf-xano-element="template"]', root)
    if (!template) return 0
    const targets = $$('[wf-xano-element="details-target"]', template)
    targets.forEach((target) => {
      target.setAttribute('wf-xano-lazy-details', '')
      $$(
        '[wf-xano-bind="project_scope"], [wf-xano-element="nest-target"][wf-xano-field="project_scope_details"] [wf-xano-bind="value"]',
        target,
      ).forEach((scope) => {
        scope.style.whiteSpace = 'pre-wrap'
        scope.style.overflowWrap = 'anywhere'
      })
    })
    return targets.length
  }

  function projectItems(result) {
    return Array.isArray(result)
      ? result
      : Array.isArray(result && result.items)
        ? result.items
        : []
  }

  async function fetchProjectWorkflowItems(role) {
    const items = []
    const seenProjectIds = new Set()
    const seenPages = new Set()
    let page = 1
    while (!seenPages.has(page)) {
      seenPages.add(page)
      const result =
        role === 'brand'
          ? await API.brandProjectList(page)
          : await API.starterProjectList(page)
      const batch = projectItems(result)
      let added = 0
      batch.forEach((item) => {
        const id = Number(item && (item.project_id || item.id))
        if (!(id > 0) || seenProjectIds.has(id)) return
        seenProjectIds.add(id)
        items.push(item)
        added += 1
      })
      if (Array.isArray(result)) break

      const currentPage = Number(result && result.curPage)
      const nextPage = Number(result && result.nextPage)
      const itemsTotal = Number(result && result.itemsTotal)
      if (Number.isInteger(nextPage) && nextPage > 0 && !seenPages.has(nextPage)) {
        page = nextPage
      } else if (
        Number.isInteger(itemsTotal) &&
        itemsTotal > items.length &&
        added > 0
      ) {
        page = Number.isInteger(currentPage) && currentPage > 0 ? currentPage + 1 : page + 1
      } else if (Number.isInteger(itemsTotal) && itemsTotal > items.length) {
        throw new Error('Project pagination did not advance')
      } else {
        break
      }
    }
    return items
  }

  function projectWorkflowInstanceKey(role) {
    return role === 'brand' ? 'dash-brand-projects' : 'dash-projects'
  }

  function currentProjectWorkflowRoot(role) {
    return $('[wf-xano-instance="' + projectWorkflowInstanceKey(role) + '"][wf-xano-source]')
  }

  function currentProjectWorkflowInstance(role) {
    const runtime = window.WfXano
    if (!runtime || typeof runtime.get !== 'function') return null
    return runtime.get(projectWorkflowInstanceKey(role))
  }

  function waitForProjectWorkflowInstance(role) {
    const existing = currentProjectWorkflowInstance(role)
    if (existing) return Promise.resolve(existing)

    if (!currentProjectWorkflowRoot(role)) return Promise.resolve(null)
    const runtime = window.WfXano || []
    if (!window.WfXano) window.WfXano = runtime
    if (typeof runtime.push !== 'function') return Promise.resolve(null)

    return new Promise((resolve) => {
      let settled = false
      const finish = (instance) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(instance || null)
      }
      const timer = window.setTimeout(() => finish(null), 10000)
      runtime.push((wfx) => {
        const instance = wfx && typeof wfx.get === 'function'
          ? wfx.get(projectWorkflowInstanceKey(role))
          : null
        finish(instance)
      })
    })
  }

  function projectWorkflowStateItems(state) {
    return state && state.data && Array.isArray(state.data.items)
      ? state.data.items
      : []
  }

  function projectWorkflowItemsMap(items) {
    return new Map(
      items
        .map((item) => [Number(item && (item.project_id || item.id)), item])
        .filter(([id]) => id > 0),
    )
  }

  function applyProjectWorkflowState(role, state) {
    if (projectWorkflowRole !== role || projectRoleForPath() !== role) return false
    if (!state || state.status !== 'success') return false
    projectWorkflowItems = projectWorkflowItemsMap(projectWorkflowStateItems(state))
    decorateProjectCards()
    observeProjectCards()
    return true
  }

  function bindProjectWorkflowProjection(role, instance) {
    if (!instance || typeof instance.subscribe !== 'function') return
    if (projectWorkflowProjectionInstance === instance) return
    if (projectWorkflowProjectionUnsubscribe) projectWorkflowProjectionUnsubscribe()
    projectWorkflowProjectionInstance = instance
    projectWorkflowProjectionUnsubscribe = instance.subscribe((state) => {
      applyProjectWorkflowState(role, state)
    })
  }

  function waitForProjectWorkflowState(role, instance) {
    const current = typeof instance.getState === 'function' ? instance.getState() : null
    if (current && current.status === 'success') return Promise.resolve(current)

    return new Promise((resolve, reject) => {
      let settled = false
      let unsubscribe = null
      const finish = (error, state) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (unsubscribe) unsubscribe()
        if (error) reject(error)
        else resolve(state)
      }
      const timer = window.setTimeout(
        () => finish(new Error('Project list did not become ready')),
        10000,
      )
      unsubscribe = instance.subscribe((state) => {
        if (projectWorkflowRole !== role || projectRoleForPath() !== role) {
          finish(new Error('Project dashboard scope changed'))
        } else if (state && state.status === 'success') {
          finish(null, state)
        } else if (state && (state.status === 'error' || state.status === 'destroyed')) {
          finish(new Error('Project list could not be loaded'))
        }
      })
      if (settled && unsubscribe) unsubscribe()
    })
  }

  async function reloadProjectWorkflowInstance(instance) {
    const state = typeof instance.getState === 'function' ? instance.getState() : null
    const statePage = Number(state && state.query && state.query.page)
    const instancePage = Number(instance && instance.page)
    const loadedPage = Number.isInteger(statePage) && statePage > 0
      ? statePage
      : Number.isInteger(instancePage) && instancePage > 0
        ? instancePage
        : 1
    if (loadedPage === 1) {
      if (typeof instance.refresh !== 'function') {
        throw new Error('Project list cannot be refreshed')
      }
      await instance.refresh()
      return
    }
    if (typeof instance.goToPage !== 'function' || typeof instance.loadNext !== 'function') {
      throw new Error('Project list cannot preserve loaded pages')
    }
    await instance.goToPage(1)
    const first = typeof instance.getState === 'function' ? instance.getState() : null
    const firstPage = Number(first && first.query && first.query.page)
    if (!first || first.status !== 'success' || firstPage !== 1) {
      throw new Error('Project list could not reload page 1')
    }
    let confirmedPage = 1
    while (confirmedPage < loadedPage) {
      const confirmed = typeof instance.getState === 'function' ? instance.getState() : null
      if (
        confirmed &&
        confirmed.status === 'success' &&
        confirmed.data &&
        confirmed.data.hasMore === false
      ) break
      const requestedPage = confirmedPage + 1
      let lastError = null
      let advanced = false
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await instance.loadNext()
        } catch (error) {
          lastError = error
        }
        const current = typeof instance.getState === 'function' ? instance.getState() : null
        const currentPage = Number(current && current.query && current.query.page)
        if (current && current.status === 'success' && currentPage === requestedPage) {
          confirmedPage = currentPage
          advanced = true
          break
        }
      }
      if (!advanced) {
        throw lastError || new Error('Project list could not reload page ' + requestedPage)
      }
    }
  }

  function projectIdFromCard(card) {
    const id = parseInt(card && card.getAttribute('data-wf-xano-id'), 10)
    return id > 0 ? id : 0
  }

  function projectContextFromCard(card) {
    const id = projectIdFromCard(card)
    if (!id) return null
    return projectWorkflowItems.get(id) || { id, project_id: id }
  }

  function projectLifecycleActionsFromCard(card) {
    return card ? $$(PROJECT_END_SELECTOR, card) : []
  }

  function primaryProjectLifecycleAction(card) {
    const actions = projectLifecycleActionsFromCard(card)
    return actions.find((action) => action.getAttribute('wf-xano-link') === 'project-end') ||
      actions.find((action) => !action.hasAttribute('data-project-action-duplicate')) ||
      actions[0] || null
  }

  function currentProjectLifecycleAction(projectId, fallback = null) {
    const card = $$(PROJECT_CARD_SELECTOR).find((candidate) => projectIdFromCard(candidate) === projectId)
    return primaryProjectLifecycleAction(card) || fallback
  }

  function currentProjectContractAction(projectId, fallback = null) {
    const card = $$(PROJECT_CARD_SELECTOR).find((candidate) => projectIdFromCard(candidate) === projectId)
    const actions = card ? $$(PROJECT_CONTRACT_SELECTOR, card) : []
    return actions.find((action) => projectActionWrap(action).style.display !== 'none') || actions[0] || fallback
  }

  function currentProjectContractActions(projectId, fallback = null) {
    const card = $$(PROJECT_CARD_SELECTOR).find((candidate) => projectIdFromCard(candidate) === projectId)
    const actions = card ? $$(PROJECT_CONTRACT_SELECTOR, card) : []
    if (!actions.length && fallback) actions.push(fallback)
    return actions
  }

  function setProjectLifecyclePending(projectId, pending, fallback = null) {
    const action = currentProjectLifecycleAction(projectId, fallback)
    if (action) setOpportunityActionPending(projectActionWrap(action), pending)
  }

  function setProjectContractPending(projectId, pending, fallback = null) {
    currentProjectContractActions(projectId, fallback).forEach((action) => {
      setOpportunityActionPending(projectActionWrap(action), pending)
    })
  }

  function showProjectWorkflowFeedback(message, isError = false, receipt = null) {
    const root = currentProjectWorkflowRoot(projectWorkflowRole) || document.documentElement
    if (!root || typeof root.appendChild !== 'function') {
      console[isError ? 'error' : 'info']('[opp30:project-action]', message)
      return
    }
    let feedback = projectWorkflowFeedbackElement
    if (!feedback || feedback.parentNode !== root) {
      feedback = document.createElement('div')
      feedback.setAttribute('data-project-workflow-feedback', '')
      feedback.setAttribute('class', 'text-size-small')
      root.appendChild(feedback)
      projectWorkflowFeedbackElement = feedback
    }
    feedback.setAttribute('role', isError ? 'alert' : 'status')
    feedback.setAttribute('aria-live', isError ? 'assertive' : 'polite')
    feedback.setAttribute('data-project-action-result', isError ? 'error' : 'success')
    const renderedMessage = receipt
      ? decorateWorkflowMessage(feedback, message, receipt)
      : message
    if (!receipt) feedback.textContent = renderedMessage
    feedback.style.display = ''
    window.clearTimeout(projectWorkflowFeedbackTimer)
    projectWorkflowFeedbackTimer = window.setTimeout(() => {
      if (feedback.textContent === renderedMessage) {
        feedback.textContent = ''
        feedback.style.display = 'none'
        feedback.removeAttribute('data-project-action-result')
      }
    }, isError ? 6000 : 3500)
  }

  function showProjectLifecycleFeedback(projectId, message, isError = false, receipt = null) {
    const action = currentProjectLifecycleAction(projectId)
    if (action) showProjectActionFeedback(action, message, isError, receipt)
    else showProjectWorkflowFeedback(message, isError, receipt)
  }

  function showProjectContractFeedback(projectId, message, isError = false, receipt = null) {
    const action = currentProjectContractAction(projectId)
    if (action) showProjectActionFeedback(action, message, isError, receipt)
    else showProjectWorkflowFeedback(message, isError, receipt)
  }

  function projectActionWrap(action) {
    return (action && action.closest && action.closest('.button_main-wrap')) || action
  }

  function setProjectActionVisible(action, visible) {
    const wrap = projectActionWrap(action)
    if (!wrap) return
    wrap.style.display = visible ? '' : 'none'
    wrap.setAttribute('aria-hidden', visible ? 'false' : 'true')
  }

  function projectActionLabel(action) {
    const wrap = projectActionWrap(action)
    return wrap && $('.button_main-text', wrap)
  }

  function setProjectActionLabel(action, label) {
    const target = projectActionLabel(action)
    if (!target) return
    if (!target.dataset.projectActionAuthoredLabel) {
      target.dataset.projectActionAuthoredLabel = target.textContent.trim()
    }
    target.dataset.projectActionRestLabel = label || target.dataset.projectActionAuthoredLabel
    const wrap = projectActionWrap(action)
    if (wrap && wrap.hasAttribute('data-project-action-result')) return
    // The project-card observer watches childList changes so it can decorate
    // cards appended by wf-xano. Assigning textContent replaces the label's
    // text node and therefore wakes that same observer. Avoid a self-sustaining
    // mutation loop when the label is already correct (for example when lazy
    // project details are inserted or Show more appends another page).
    if (target.textContent !== target.dataset.projectActionRestLabel) {
      target.textContent = target.dataset.projectActionRestLabel
    }
  }

  function showProjectActionFeedback(action, message, isError = false, receipt = null) {
    const label = projectActionLabel(action)
    if (!label) {
      if (isError) console.error('[opp30:project-action]', message)
      return
    }
    if (!label.dataset.projectActionAuthoredLabel) {
      label.dataset.projectActionAuthoredLabel = label.textContent.trim()
    }
    const authored =
      label.dataset.projectActionRestLabel || label.dataset.projectActionAuthoredLabel
    const renderedMessage = receipt
      ? decorateWorkflowMessage(label, message, receipt)
      : message
    if (!receipt) label.textContent = renderedMessage
    const wrap = projectActionWrap(action)
    if (wrap) {
      window.clearTimeout(projectActionFeedbackTimers.get(wrap))
      wrap.setAttribute('data-project-action-result', isError ? 'error' : 'success')
    }
    const timer = window.setTimeout(() => {
      if (wrap && projectActionFeedbackTimers.get(wrap) !== timer) return
      if (label.textContent === renderedMessage) label.textContent = authored
      if (wrap) {
        wrap.removeAttribute('data-project-action-result')
        projectActionFeedbackTimers.delete(wrap)
      }
    }, isError ? 6000 : 3500)
    if (wrap) projectActionFeedbackTimers.set(wrap, timer)
  }

  function lifecycleState(project) {
    const dashboardStatus = String((project && project.status) || '').trim().toLowerCase()
    // The lifecycle column can already be more specific while a contract is still
    // awaiting activation. Xano's cancel action intentionally authorizes that phase
    // from status=pending, so pending must win over the finer lifecycle value here.
    if (dashboardStatus === 'pending') return 'pending'
    return String(
      (project && (project.lifecycle_state || dashboardStatus)) || '',
    ).trim().toLowerCase()
  }

  function projectContractIsViewable(project) {
    const documentId = String(project && project.pandadoc_document_id || '').trim()
    const contractStatus = String(project && project.contract_status || '').trim().toLowerCase()
    return Boolean(documentId) && PROJECT_VIEWABLE_CONTRACT_STATES.has(contractStatus)
  }

  function projectContractPanelState(project, role) {
    const hidden = {
      visible: false,
      state: 'hidden',
      title: '',
      body: '',
      brandBadge: '',
      starterBadge: '',
      action: null,
      actionLabel: '',
    }
    if (!project || !['brand', 'starter'].includes(role)) return hidden
    const syncOrigin = String(project.sync_origin || '').trim().toLowerCase()
    const contractSource = String(project.contract_source || '').trim().toLowerCase()
    if (syncOrigin !== 'v3' || contractSource !== 'standard') return hidden

    const lifecycle = String(project.lifecycle_state || '').trim().toLowerCase()
    const contractStatus = String(project.contract_status || '').trim().toLowerCase()
    if (PROJECT_CONTRACT_HIDDEN_LIFECYCLES.has(lifecycle)) return hidden

    const brandSigned = Boolean(project.brand_signed_at)
    const starterSigned = Boolean(project.starter_signed_at)
    const starterName = String(project.starter_name || '').trim() || 'The Starter'
    const companyName = String(project.company_name || '').trim() || 'The Brand'
    const base = {
      visible: true,
      brandBadge: brandSigned ? 'brand-signed' : 'brand-pending',
      starterBadge: starterSigned ? 'starter-signed' : 'starter-pending',
    }

    if (
      PROJECT_CONTRACT_ATTENTION_STATES.has(lifecycle) ||
      PROJECT_CONTRACT_ATTENTION_STATES.has(contractStatus)
    ) {
      return {
        ...base,
        state: 'attention',
        title: 'Contract needs attention',
        body: 'The contract cannot be signed right now. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      }
    }
    if (brandSigned && starterSigned) {
      return {
        ...base,
        state: 'processing',
        title: 'Both parties have signed',
        body: 'The project is being activated. This status will update automatically.',
        action: null,
        actionLabel: '',
      }
    }
    if (
      PROJECT_CONTRACT_PREPARING_LIFECYCLES.has(lifecycle) ||
      PROJECT_CONTRACT_PREPARING_STATUSES.has(contractStatus)
    ) {
      return {
        ...base,
        state: 'processing',
        title: 'Preparing the contract',
        body: 'The contract is being prepared. This status will update automatically.',
        action: null,
        actionLabel: '',
      }
    }

    const partialState = lifecycle === 'signature_partial' || contractStatus === 'partial'
    if (partialState && !brandSigned && !starterSigned) {
      return {
        ...base,
        state: 'attention',
        title: 'Contract needs attention',
        body: 'The contract status could not be confirmed. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      }
    }

    const recipientReady = projectContractIsViewable(project) &&
      ['contract_sent', 'signature_partial'].includes(lifecycle)
    if (!recipientReady) {
      return {
        ...base,
        state: 'attention',
        title: 'Contract is not available',
        body: 'The contract status could not be confirmed. Please contact The Starters for help.',
        action: null,
        actionLabel: '',
      }
    }

    const viewerSigned = role === 'brand' ? brandSigned : starterSigned
    const otherSigned = role === 'brand' ? starterSigned : brandSigned
    const counterpartyName = role === 'brand' ? starterName : companyName
    if (!viewerSigned) {
      return {
        ...base,
        state: 'action',
        title: otherSigned ? counterpartyName + ' has signed' : 'Your signature is required',
        body: otherSigned
          ? 'Your signature is required to activate this project.'
          : 'Review and sign the contract. The project starts after both parties sign.',
        action: 'sign',
        actionLabel: 'Review & Sign Contract',
      }
    }
    return {
      ...base,
      state: 'waiting',
      title: 'Waiting for ' + counterpartyName + ' to sign',
      body: 'Your signature is complete. We will notify you when ' + counterpartyName + ' signs.',
      action: 'view',
      actionLabel: 'View Contract',
    }
  }

  function setProjectPanelNodeVisible(node, visible) {
    if (!node) return
    node.hidden = !visible
    node.style.display = visible ? '' : 'none'
    node.setAttribute('aria-hidden', visible ? 'false' : 'true')
  }

  function paintProjectContractPanel(card, project) {
    if (!card) return
    const state = projectContractPanelState(project, projectWorkflowRole)
    const panel = $(PROJECT_CONTRACT_PANEL_SELECTOR, card)
    if (panel) {
      setProjectPanelNodeVisible(panel, state.visible)
      panel.setAttribute('data-project-contract-state', state.state)
      const title = $(PROJECT_CONTRACT_TITLE_SELECTOR, panel)
      const body = $(PROJECT_CONTRACT_BODY_SELECTOR, panel)
      if (title && title.textContent !== state.title) title.textContent = state.title
      if (body && body.textContent !== state.body) body.textContent = state.body
      $$(PROJECT_CONTRACT_BADGE_SELECTOR, panel).forEach((badge) => {
        const value = badge.getAttribute('data-project-contract-badge')
        setProjectPanelNodeVisible(
          badge,
          state.visible && (value === state.brandBadge || value === state.starterBadge),
        )
      })
      const actionsWrap = $(PROJECT_CONTRACT_ACTIONS_SELECTOR, panel)
      if (actionsWrap) setProjectPanelNodeVisible(actionsWrap, Boolean(state.action))
      $$('[data-project-contract-action]', panel).forEach((action) => {
        setProjectActionVisible(
          action,
          state.visible && action.getAttribute('data-project-contract-action') === state.action,
        )
        if (action.getAttribute('data-project-contract-action') === state.action) {
          setProjectActionLabel(action, state.actionLabel)
        }
      })
    }

    // Keep the existing project-row contract control synchronized with the
    // panel. It remains the compact action when the details panel is closed.
    $$(PROJECT_CONTRACT_SELECTOR, card)
      .filter((action) => !action.hasAttribute('data-project-contract-action'))
      .forEach((action) => {
        action.setAttribute('data-project-action', 'contract')
        action.setAttribute('data-project-contract-current-action', state.action || '')
        setProjectActionVisible(action, Boolean(state.action))
        if (state.action) setProjectActionLabel(action, state.actionLabel)
      })
    return state
  }

  // Parse date-only project fields as calendar parts instead of constructing a
  // local Date. That keeps a 2026-08-06 project on August 6 in every timezone.
  function projectDateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/.exec(
      String(value || '').trim(),
    )
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = Number(match[4] || 0)
    const minute = Number(match[5] || 0)
    const second = Number(match[6] || 0)
    const offset = match[7] && /^([+-])(\d{2}):(\d{2})$/.exec(match[7])
    if (
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59))
    ) return null
    const check = new Date(Date.UTC(year, month - 1, day))
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) return null
    return { year, month, day }
  }

  function projectDateLabel(parts) {
    return PROJECT_TIMELINE_MONTHS[parts.month - 1] + ' ' + parts.day + ', ' + parts.year
  }

  function formatProjectTimeline(project) {
    const fallback = String(project && project.timeline_display || '').trim()
    const startValue = project && project.start_date
    const endValue = project && (project.end_date || project.estimated_end_date)
    const start = projectDateParts(startValue)
    const end = projectDateParts(endValue)
    if (!start) {
      // A missing start can still have a valid canonical end. Do not leave the
      // Xano fallback as an ambiguous ISO fragment such as "- 2026-08-04".
      if (!startValue && end) return 'Ends ' + projectDateLabel(end)
      return fallback
    }
    // A present but malformed end date is not the same as an ongoing project.
    // Keep the canonical fallback instead of manufacturing a misleading label.
    if (endValue && !end) return fallback
    if (!end) return 'Starting ' + projectDateLabel(start) + ' · Ongoing'
    if (start.year === end.year && start.month === end.month && start.day === end.day) {
      return projectDateLabel(start)
    }
    if (start.year === end.year && start.month === end.month) {
      return PROJECT_TIMELINE_MONTHS[start.month - 1] + ' ' + start.day + '–' + end.day + ', ' + start.year
    }
    if (start.year === end.year) {
      return (
        PROJECT_TIMELINE_MONTHS[start.month - 1] + ' ' + start.day +
        ' – ' + PROJECT_TIMELINE_MONTHS[end.month - 1] + ' ' + end.day + ', ' + start.year
      )
    }
    return projectDateLabel(start) + ' – ' + projectDateLabel(end)
  }

  function projectTimelineTarget(card) {
    if (!card) return null
    for (const details of $$(PROJECT_CONTRACT_DETAILS_SELECTOR, card)) {
      for (const row of $$(PROJECT_CONTRACT_DETAIL_ROW_SELECTOR, details)) {
        const label = $('[wf-xano-bind="label"]', row)
        if (!label || label.textContent.trim().toLowerCase() !== 'project timeline') continue
        const value = $('[wf-xano-bind="value"]', row)
        if (value) return value
      }
    }
    return $(PROJECT_TIMELINE_FIELD_SELECTOR, card)
  }

  function paintProjectTimeline(card, project) {
    if (!card || !project) return
    const target = projectTimelineTarget(card)
    if (!target) return
    const label = formatProjectTimeline(project)
    if (label && target.textContent.trim() !== label) target.textContent = label
  }

  function decorateProjectCard(card) {
    const project = projectContextFromCard(card)
    paintProjectTimeline(card, project)
    paintProjectContractPanel(card, project)
    if (projectWorkflowActionLocks.get(projectIdFromCard(card)) === 'contract') {
      currentProjectContractActions(projectIdFromCard(card)).forEach((contract) => {
        setOpportunityActionPending(projectActionWrap(contract), true)
      })
    }
    if (!project || !project.lifecycle_state && !project.status) return
    const state = lifecycleState(project)
    const ends = projectLifecycleActionsFromCard(card)
    const end = primaryProjectLifecycleAction(card)
    const review = $(PROJECT_REVIEW_SELECTOR, card)

    ends.forEach((action) => {
      const primary = action === end
      action.removeAttribute('wf-xano-link')
      action.setAttribute('data-project-action', 'end')
      if (primary) action.removeAttribute('data-project-action-duplicate')
      else action.setAttribute('data-project-action-duplicate', 'true')
      setProjectActionVisible(action, primary && !PROJECT_TERMINAL_STATES.has(state))
    })

    if (end) {
      const label =
        state === 'pending'
          ? 'Cancel Project'
          : state === 'completion_requested'
            ? 'Confirm Completion'
            : state === 'termination_requested'
              ? 'Confirm End'
              : 'End Project'
      setProjectActionLabel(end, label)
      if (projectWorkflowActionLocks.get(projectIdFromCard(card)) === 'lifecycle') {
        setOpportunityActionPending(projectActionWrap(end), true)
      }
    }

    if (review) {
      review.removeAttribute('wf-xano-link')
      review.setAttribute('data-project-action', 'review')
      review.setAttribute('href', '#review-starter')
      setProjectActionVisible(
        review,
        projectWorkflowRole === 'brand' && Boolean(project.review_eligible) && !project.has_review,
      )
    }
  }

  function decorateProjectCards() {
    const role = projectRoleForPath()
    if (!role) return
    if (!projectWorkflowRole || role !== projectWorkflowRole) {
      $$(PROJECT_CARD_SELECTOR).forEach((card) => {
        setProjectPanelNodeVisible($(PROJECT_CONTRACT_PANEL_SELECTOR, card), false)
        $$(PROJECT_CONTRACT_SELECTOR, card).forEach((contract) => {
          if (!contract.hasAttribute('data-project-contract-action')) {
            contract.setAttribute('data-project-action', 'contract')
          }
          setProjectActionVisible(contract, false)
        })
      })
      return
    }
    $$(PROJECT_CARD_SELECTOR).forEach(decorateProjectCard)
  }

  function observeProjectCards() {
    if (projectWorkflowObserver) projectWorkflowObserver.disconnect()
    const root =
      $('[wf-xano-instance="dash-brand-projects"], [wf-xano-instance="dash-projects"]') ||
      document.documentElement
    if (!root || typeof MutationObserver !== 'function') return
    let queued = false
    projectWorkflowObserver = new MutationObserver(() => {
      if (queued) return
      queued = true
      Promise.resolve().then(() => {
        queued = false
        decorateProjectCards()
      })
    })
    projectWorkflowObserver.observe(root, { childList: true, subtree: true })
  }

  async function refreshProjectWorkflow(role = projectWorkflowRole, reload = false) {
    if (!role || projectRoleForPath() !== role) return null
    if (projectWorkflowRefresh) return projectWorkflowRefresh
    const request = (async () => {
      const instance = await waitForProjectWorkflowInstance(role)
      let items
      if (instance) {
        bindProjectWorkflowProjection(role, instance)
        if (reload) await reloadProjectWorkflowInstance(instance)
        const state = await waitForProjectWorkflowState(role, instance)
        items = projectWorkflowStateItems(state)
      } else if (currentProjectWorkflowRoot(role)) {
        throw new Error('Project list owner is unavailable')
      } else {
        // Compatibility for older dashboard surfaces that have not adopted
        // wf-xano. Current V3 dashboards use the instance state above so the
        // projects endpoint has exactly one list owner and one request.
        items = await fetchProjectWorkflowItems(role)
      }
      if (projectWorkflowRole !== role || projectRoleForPath() !== role) return null
      projectWorkflowItems = projectWorkflowItemsMap(items)
      decorateProjectCards()
      observeProjectCards()
      return items
    })()
    projectWorkflowRefresh = request
    try {
      return await request
    } finally {
      if (projectWorkflowRefresh === request) projectWorkflowRefresh = null
    }
  }

  function invalidateProjectWorkflowProjection(role) {
    if (projectWorkflowRole !== role || projectRoleForPath() !== role) return
    projectWorkflowItems = new Map()
    decorateProjectCards()
  }

  async function currentProjectContext(card, refresh = false) {
    const cachedProject = projectContextFromCard(card)
    let project = refresh ? null : cachedProject
    if (project && (project.lifecycle_state || project.status)) return project
    try {
      await refreshProjectWorkflow(projectWorkflowRole, refresh)
    } catch (error) {
      if (refresh) invalidateProjectWorkflowProjection(projectWorkflowRole)
      throw error
    }
    project = projectContextFromCard(card)
    return project && (project.lifecycle_state || project.status) ? project : null
  }

  async function refreshProjectWorkflowBestEffort(role, operation) {
    try {
      await refreshProjectWorkflow(role, true)
      return true
    } catch (error) {
      invalidateProjectWorkflowProjection(role)
      console.error('[opp30:project-action] ' + operation + ' projection refresh failed', error)
      return false
    }
  }

  function projectLifecycleVersion(project) {
    if (!project || project.lifecycle_version == null || project.lifecycle_version === '') {
      return null
    }
    const version = Number(project.lifecycle_version)
    return Number.isInteger(version) && version >= 0 ? version : null
  }

  function projectActionErrorMessage(error, fallback) {
    const message =
      (error && error.data && error.data.message) || (error && error.message) || fallback
    if (/project version is stale/i.test(message)) {
      return 'Project changed. Please try again.'
    }
    return message || fallback
  }

  function projectActionKey(action, project, actionName) {
    const version = projectLifecycleVersion(project)
    const scope = [project.id || project.project_id, version, actionName].join(':')
    if (action.dataset.projectActionScope === scope && action.dataset.projectActionKey) {
      return action.dataset.projectActionKey
    }
    const uuid =
      window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    action.dataset.projectActionScope = scope
    action.dataset.projectActionKey = 'project-action-ui:' + scope + ':' + uuid
    return action.dataset.projectActionKey
  }

  function projectActionIntent(project, confirmAction = window.confirm, promptAction = window.prompt) {
    const state = lifecycleState(project)
    if (!state || PROJECT_TERMINAL_STATES.has(state)) return null
    if (state === 'pending') {
      return confirmAction('Cancel this project before it starts?')
        ? { action: 'cancel', reason: 'canceled_before_activation' }
        : null
    }
    if (state === 'completion_requested') {
      return confirmAction(
        'Confirm that the project is complete? The project closes after both sides confirm.',
      )
        ? { action: 'complete', reason: '' }
        : null
    }
    if (state === 'termination_requested') {
      const reason = String(project.end_reason || '').trim()
      return confirmAction('Confirm ending this project early?')
        ? { action: 'terminate', reason }
        : null
    }
    const response = promptAction(
      'Type COMPLETE if the work is finished. To end the project early, enter the reason instead. Leave blank to keep it active.',
      '',
    )
    if (response == null || !String(response).trim()) return null
    const value = String(response).trim()
    return /^complete$/i.test(value)
      ? { action: 'complete', reason: '' }
      : { action: 'terminate', reason: value }
  }

  function projectMutationFeedback(project) {
    const state = lifecycleState(project)
    return {
      completion_requested: 'Completion requested',
      completed: 'Project completed',
      termination_requested: 'End requested',
      terminated: 'Project ended',
      canceled: 'Project canceled',
      cancelled: 'Project canceled',
    }[state] || 'Project updated'
  }

  async function openProjectContract(action, card) {
    const projectId = projectIdFromCard(card)
    if (!projectId || projectWorkflowActionLocks.has(projectId)) return
    projectWorkflowActionLocks.set(projectId, 'contract')
    setProjectContractPending(projectId, true, action)
    let contractWindow = null
    try {
      const project = await currentProjectContext(card, true)
      if (!project) {
        showProjectContractFeedback(projectId, 'Project details unavailable', true)
        return
      }
      const panelState = projectContractPanelState(project, projectWorkflowRole)
      const requestedAction =
        action.getAttribute('data-project-contract-action') ||
        action.getAttribute('data-project-contract-current-action') ||
        ''
      if (!panelState.visible || panelState.action !== requestedAction) {
        decorateProjectCard(card)
        showProjectContractFeedback(projectId, 'Contract is not available yet', true)
        return
      }
      if (typeof window.open === 'function') contractWindow = window.open('', '_blank')
      const result = await API.contractLink(project.id || project.project_id)
      const url = String(result && result.url || '').trim()
      if (!url) throw new Error('Contract link was not returned')
      if (contractWindow && !contractWindow.closed) {
        contractWindow.opener = null
        contractWindow.location.href = url
      } else {
        window.location.href = url
      }
    } catch (error) {
      if (contractWindow && !contractWindow.closed) contractWindow.close()
      showProjectContractFeedback(
        projectId,
        'Contract is unavailable. Please try again.',
        true,
      )
    } finally {
      projectWorkflowActionLocks.delete(projectId)
      setProjectContractPending(projectId, false, action)
      setOpportunityActionPending(projectActionWrap(action), false)
    }
  }

  async function mutateProjectLifecycle(action, card) {
    const projectId = projectIdFromCard(card)
    if (!projectId || projectWorkflowActionLocks.has(projectId)) return
    projectWorkflowActionLocks.set(projectId, 'lifecycle')
    setProjectLifecyclePending(projectId, true, action)
    try {
      const project = await currentProjectContext(card, true)
      if (!project) {
        showProjectLifecycleFeedback(projectId, 'Project details unavailable', true)
        return
      }
      const lifecycleVersion = projectLifecycleVersion(project)
      if (lifecycleVersion == null) {
        showProjectLifecycleFeedback(
          projectId,
          'Project version unavailable. Please try again.',
          true,
        )
        return
      }
      const intent = projectActionIntent(project)
      if (!intent) return
      if (intent.action === 'terminate' && !intent.reason) {
        showProjectLifecycleFeedback(projectId, 'A reason is required to end early', true)
        return
      }
      const result = await API.projectAction({
        project_id: project.id || project.project_id,
        expected_version: lifecycleVersion,
        action: intent.action,
        reason: intent.reason,
        idempotency_key: projectActionKey(action, project, intent.action),
      })
      const updated = result && result.project
      if (updated) projectWorkflowItems.set(Number(updated.id), updated)
      delete action.dataset.projectActionKey
      delete action.dataset.projectActionScope
      await refreshProjectWorkflowBestEffort(projectWorkflowRole, 'lifecycle')
      showProjectLifecycleFeedback(
        projectId,
        projectMutationFeedback(updated || project),
        false,
        diagnosticForResponse(result),
      )
    } catch (error) {
      showProjectLifecycleFeedback(
        projectId,
        projectActionErrorMessage(error, 'Project update failed. Please try again.'),
        true,
        diagnosticForError(error),
      )
      if (error && error.data && /project version is stale/i.test(error.data.message || '')) {
        await refreshProjectWorkflow(projectWorkflowRole, true)
      }
    } finally {
      projectWorkflowActionLocks.delete(projectId)
      setProjectLifecyclePending(projectId, false, action)
      setOpportunityActionPending(projectActionWrap(action), false)
    }
  }

  function showProjectModal(name, modal) {
    const entry = window.lumos && window.lumos.modal && window.lumos.modal.list
      ? window.lumos.modal.list[name]
      : null
    if (entry && typeof entry.open === 'function') {
      entry.open()
      return
    }
    if (typeof modal.showModal === 'function') modal.showModal()
    else modal.setAttribute('open', '')
    window.dispatchEvent(new CustomEvent('modal-open', { detail: { modal } }))
  }

  function reviewError(modal, message, receipt = null) {
    const fail = $('.w-form-fail', modal)
    if (!fail) return
    if (receipt) decorateWorkflowMessage(fail, message, receipt)
    else fail.textContent = message
    fail.style.display = 'block'
  }

  function reviewSubmissionKey(form, project, rating, reviewText) {
    let hash = 2166136261
    const payload = rating + ':' + reviewText
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    const scope = (project.id || project.project_id) + ':' + (hash >>> 0).toString(36)
    if (form.dataset.projectReviewScope === scope && form.dataset.projectReviewKey) {
      return form.dataset.projectReviewKey
    }
    const uuid =
      window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    form.dataset.projectReviewScope = scope
    form.dataset.projectReviewKey = 'review-ui:' + scope + ':' + uuid
    return form.dataset.projectReviewKey
  }

  function clearReviewSubmissionKey(form) {
    if (!form) return
    delete form.dataset.projectReviewScope
    delete form.dataset.projectReviewKey
  }

  function projectReviewModal() {
    const entry = window.lumos && window.lumos.modal && window.lumos.modal.list
      ? window.lumos.modal.list[PROJECT_REVIEW_MODAL_ID]
      : null
    const registered = entry && entry.el
    if (
      registered &&
      registered.matches &&
      registered.matches('[data-modal-target="' + PROJECT_REVIEW_MODAL_ID + '"]')
    ) return registered
    const modals = $$('[data-modal-target="' + PROJECT_REVIEW_MODAL_ID + '"]')
    return modals.length ? modals[modals.length - 1] : null
  }

  function clearProjectReviewContext(modal = activeReviewModal, resetForm = false) {
    activeReviewProject = null
    activeReviewModal = null
    if (!modal) return
    $$('[data-project-review-starter-name]', modal).forEach((target) => {
      const originalCopy = target.getAttribute('data-project-review-starter-copy')
      if (originalCopy !== null) target.textContent = originalCopy
      target.removeAttribute('data-project-review-starter-name')
      target.removeAttribute('data-project-review-starter-copy')
    })
    const form = $('form', modal)
    if (resetForm && form) form.reset()
  }

  function paintProjectReviewStarterName(modal, starterName) {
    if (!modal || !starterName) return 0
    let painted = 0
    $$('p, span, h1, h2, h3, h4, h5, h6, label, [starter-name]', modal).forEach((target) => {
      if (target.children && target.children.length) return
      if (!target.textContent.includes('[Starter Name]')) return
      target.setAttribute('data-project-review-starter-copy', target.textContent)
      target.textContent = target.textContent.replaceAll('[Starter Name]', starterName)
      target.setAttribute('data-project-review-starter-name', '')
      painted += 1
    })
    return painted
  }

  function prepareProjectReview(project) {
    if (reviewSubmitting) return false
    clearProjectReviewContext(activeReviewModal, true)
    const modal = projectReviewModal()
    const projectId = Number(project && (project.id || project.project_id))
    const starterName = String(project && project.starter_name || '').trim()
    if (
      !modal ||
      !(projectId > 0) ||
      !starterName ||
      !project.review_eligible ||
      project.has_review
    ) return false
    if (!paintProjectReviewStarterName(modal, starterName)) return false
    activeReviewProject = project
    activeReviewModal = modal
    const form = $('form', modal)
    const done = $('.w-form-done', modal)
    const fail = $('.w-form-fail', modal)
    if (form) {
      form.reset()
      form.style.display = ''
    }
    if (done) done.style.display = ''
    if (fail) fail.style.display = ''
    const privateFeedback = $('[name="Private-Feedback"]', modal)
    if (privateFeedback) {
      const privateWrap = privateFeedback.closest(
        '.modal_input-group, .modal-form_field-wrap, .form_field-wrap, .field-wrap',
      )
      if (privateWrap) privateWrap.style.display = 'none'
      else privateFeedback.style.display = 'none'
    }
    showProjectModal(PROJECT_REVIEW_MODAL_ID, modal)
    return true
  }

  async function openProjectReview(action, card) {
    const requestGeneration = ++projectReviewOpenGeneration
    const project = await currentProjectContext(card)
    if (requestGeneration !== projectReviewOpenGeneration) return
    if (!project || !prepareProjectReview(project)) {
      showProjectActionFeedback(action, 'Review is not available yet', true)
    }
  }

  async function submitProjectReview(event, modal) {
    event.preventDefault()
    event.stopPropagation()
    if (reviewSubmitting) return
    const project = activeReviewProject
    if (!project || modal !== activeReviewModal || projectWorkflowRole !== 'brand') {
      reviewError(
        modal,
        'Open Review Starter from the project you want to review.',
        validationDiagnostic('project_review', 'review', 'NO_PROJECT_CONTEXT'),
      )
      return
    }
    const form = event.target
    const ratingInput = $('input[name="Call-Rating"]:checked', form)
    const reviewInput = $('[name="Public-Feedback"], [name="Feedback"]', form)
    const rating = Number(ratingInput && ratingInput.value)
    const reviewText = String(reviewInput && reviewInput.value || '').trim()
    if (!(rating >= 1 && rating <= 5)) {
      reviewError(
        modal,
        'Choose a rating from 1 to 5 stars.',
        validationDiagnostic('project_review', 'review', 'INVALID_RATING'),
      )
      return
    }
    if (reviewText.length < 10 || reviewText.length > 4000) {
      reviewError(
        modal,
        'Write between 10 and 4,000 characters.',
        validationDiagnostic('project_review', 'review', 'INVALID_REVIEW_LENGTH'),
      )
      return
    }
    reviewSubmitting = true
    const submit = $('[type="submit"]', form)
    const pending = projectActionWrap(submit)
    setOpportunityActionPending(pending, true)
    try {
      const result = await API.brandReviewSubmit({
        project_id: project.id || project.project_id,
        rating,
        review_text: reviewText,
        idempotency_key: reviewSubmissionKey(form, project, rating, reviewText),
      })
      clearReviewSubmissionKey(form)
      form.style.display = 'none'
      const done = $('.w-form-done', modal)
      if (done) {
        done.style.display = 'block'
        const receipt = diagnosticForResponse(result)
        const message = done.querySelector ? $('[data-workflow-diagnostic-message]', done) : null
        if (message && receipt) decorateWorkflowMessage(message, message.textContent, receipt)
      }
      activeReviewProject = null
      await refreshProjectWorkflowBestEffort(projectWorkflowRole, 'review')
    } catch (error) {
      reviewError(
        modal,
        projectActionErrorMessage(error, 'Review could not be submitted.'),
        diagnosticForError(error),
      )
    } finally {
      reviewSubmitting = false
      setOpportunityActionPending(pending, false)
    }
  }

  function projectWorkflowBindingCurrent(binding) {
    return Boolean(
      binding &&
      projectWorkflowBinding === binding &&
      projectWorkflowRole === binding.role &&
      projectRoleForPath() === binding.role &&
      binding.generation === _memberScopeGeneration,
    )
  }

  function unwireProjectDashboardWorkflow() {
    projectReviewOpenGeneration += 1
    const binding = projectWorkflowBinding
    projectWorkflowBinding = null
    if (binding) {
      document.removeEventListener('click', binding.click, true)
      if (binding.submit) document.removeEventListener('submit', binding.submit, true)
      if (binding.close) window.removeEventListener('modal-close', binding.close)
      if (binding.pageshow) window.removeEventListener('pageshow', binding.pageshow)
      if (binding.focus) window.removeEventListener('focus', binding.focus)
      if (binding.visibility) document.removeEventListener('visibilitychange', binding.visibility)
    }
    projectWorkflowRole = ''
    projectWorkflowItems = new Map()
    projectWorkflowRefresh = null
    if (projectWorkflowProjectionUnsubscribe) projectWorkflowProjectionUnsubscribe()
    projectWorkflowProjectionUnsubscribe = null
    projectWorkflowProjectionInstance = null
    projectWorkflowActionLocks = new Map()
    window.clearTimeout(projectWorkflowFeedbackTimer)
    projectWorkflowFeedbackTimer = null
    if (projectWorkflowFeedbackElement) {
      projectWorkflowFeedbackElement.textContent = ''
      projectWorkflowFeedbackElement.style.display = 'none'
      projectWorkflowFeedbackElement.removeAttribute('data-project-action-result')
    }
    activeReviewProject = null
    activeReviewModal = null
    reviewSubmitting = false
    const reviewModal = projectReviewModal()
    clearProjectReviewContext(reviewModal, true)
    if (projectWorkflowObserver) projectWorkflowObserver.disconnect()
    projectWorkflowObserver = null
    if (projectRoleForPath()) {
      decorateProjectCards()
      observeProjectCards()
    }
  }

  function wireProjectWorkflowListeners(role) {
    if (
      projectWorkflowBinding &&
      projectWorkflowBinding.role === role &&
      projectWorkflowBinding.generation === _memberScopeGeneration &&
      projectWorkflowBindingCurrent(projectWorkflowBinding)
    ) return
    unwireProjectDashboardWorkflow()
    projectWorkflowRole = role
    const binding = {
      role,
      generation: _memberScopeGeneration,
      click: null,
      submit: null,
      close: null,
      pageshow: null,
      focus: null,
      visibility: null,
    }
    binding.click = async (event) => {
      if (!projectWorkflowBindingCurrent(binding)) {
        unwireProjectDashboardWorkflow()
        return
      }
      const target = event.target
      const action = target && target.closest
        ? target.closest(
            PROJECT_CONTRACT_SELECTOR + ', ' + PROJECT_END_SELECTOR + ', ' + PROJECT_REVIEW_SELECTOR,
          )
        : null
      if (!action) return
      const card = action.closest(PROJECT_CARD_SELECTOR)
      if (!card) return
      event.preventDefault()
      event.stopPropagation()
      if (action.matches(PROJECT_CONTRACT_SELECTOR)) await openProjectContract(action, card)
      else if (action.matches(PROJECT_END_SELECTOR)) await mutateProjectLifecycle(action, card)
      else if (binding.role === 'brand') await openProjectReview(action, card)
    }
    document.addEventListener('click', binding.click, true)
    binding.pageshow = () => {
      if (projectWorkflowBindingCurrent(binding)) {
        refreshProjectWorkflowBestEffort(role, 'pageshow')
      }
    }
    binding.focus = () => {
      if (projectWorkflowBindingCurrent(binding)) {
        refreshProjectWorkflowBestEffort(role, 'focus')
      }
    }
    binding.visibility = () => {
      if (document.visibilityState === 'visible' && projectWorkflowBindingCurrent(binding)) {
        refreshProjectWorkflowBestEffort(role, 'visibility')
      }
    }
    window.addEventListener('pageshow', binding.pageshow)
    window.addEventListener('focus', binding.focus)
    document.addEventListener('visibilitychange', binding.visibility)
    if (role === 'brand') {
      binding.submit = (event) => {
        if (!projectWorkflowBindingCurrent(binding)) {
          unwireProjectDashboardWorkflow()
          return
        }
        const modal = event.target && event.target.closest
          ? event.target.closest('[data-modal-target="' + PROJECT_REVIEW_MODAL_ID + '"]')
          : null
        if (modal) submitProjectReview(event, modal)
      }
      document.addEventListener('submit', binding.submit, true)
      binding.close = (event) => {
        const modal = event && event.detail && event.detail.modal
        if (modal && modal === activeReviewModal) clearProjectReviewContext(modal, true)
      }
      window.addEventListener('modal-close', binding.close)
    }
    projectWorkflowBinding = binding
  }

  function authorizeProjectDashboardWorkflow(member) {
    const role = projectRoleForPath()
    const memberRole = member ? memberPlanRole(member) : ''
    const allowed =
      member &&
      member.id === _cacheMemberId &&
      ((role === 'starter' && memberRole === 'talent') ||
        (role === 'brand' && memberRole === 'brand-paid'))
    if (!allowed) {
      unwireProjectDashboardWorkflow()
      return false
    }
    initProjectDashboardWorkflow(role, member)
    return true
  }

  async function initProjectDashboardWorkflow(role, authorizedMember = null) {
    const expected = role === 'brand' ? 'brand' : 'freelancer'
    if (projectRoleForPath() !== role) return false
    const member = authorizedMember || await gateOrRedirect(expected)
    const requiredRole = role === 'brand' ? 'brand-paid' : 'talent'
    if (
      !member ||
      member.id !== _cacheMemberId ||
      memberPlanRole(member) !== requiredRole
    ) {
      unwireProjectDashboardWorkflow()
      return false
    }
    wireProjectWorkflowListeners(role)
    // Webflow authors these controls visible. Hide contracts before the async
    // project projection arrives, and keep newly rendered cards fail-closed.
    // The refresh below reveals only role-authorized Standard Contract state.
    decorateProjectCards()
    observeProjectCards()
    try {
      await refreshProjectWorkflow(role)
      return true
    } catch (error) {
      console.error('[opp30:project-action] failed to load project action context', error)
      return false
    }
  }

  // Paint the existing Webflow-authored opportunity review screen. Some
  // modal instances predate the data-opp-bind contract and expose only an
  // empty title span, so keep a narrow fallback without creating any markup.
  function paintOpportunityReviewSuccess(done, title) {
    if (!done) return
    const opportunityTitle = title == null ? '' : String(title)
    bind(done, 'title', opportunityTitle)
    if (!$('[data-opp-bind="title"]', done)) {
      const placeholder = $$('span', done).find((span) => span.textContent.trim() === '[Job Name]')
      const heading = $('.heading-style-h1', done)
      const emptyHeadingSpan =
        heading && $$('span', heading).find((span) => !span.textContent.trim())
      const titleSpan = placeholder || emptyHeadingSpan
      if (titleSpan) titleSpan.textContent = opportunityTitle
    }
    const message = $('.text-size-medium', done)
    if (message && /\bapplication\b/i.test(message.textContent)) {
      message.textContent =
        'Our team is carefully reviewing your opportunity. You will receive an update soon.'
    }
  }

  // Match the Webflow CMS `full-overview` projection used by Xano's
  // sync-webflow endpoint: escape the two editable source fields, preserve
  // their line breaks as <br>, then separate Requirements from Description
  // with one blank line. The CMS remains the reload-time mirror; this painter
  // only keeps the already-open detail page current after an edit succeeds.
  function escapeOpportunityHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => {
      const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
      return entities[char]
    })
  }

  function opportunityMultilineHtml(value) {
    return escapeOpportunityHtml(value).replace(/\r?\n/g, '<br>')
  }

  function opportunityOverviewHtml(opportunity) {
    const description = opportunityMultilineHtml(opportunity && opportunity.description)
    const requirements = opportunityMultilineHtml(opportunity && opportunity.exp_requirements)
    return requirements ? description + '<br><br>' + requirements : description
  }

  function paintRichText(field, value) {
    const html = opportunityMultilineHtml(value)
    $$(`[data-opp-bind="${field}"]`).forEach((el) => {
      el.innerHTML = html
    })
  }

  function paintOpportunityDetail(opportunity) {
    if (!opportunity || typeof opportunity !== 'object') return
    ;['title', 'project_type', 'est_project_duration', 'budget', 'budget_frequency', 'status'].forEach((field) => {
      if (opportunity[field] != null) bind(document, field, opportunity[field])
    })
    // The detail page renders Description and Experience Requirements as two
    // separate rich-text elements (data-opp-bind="job_description" and
    // "experience_requirements"). Paint each from its own source field, keeping
    // line breaks as <br>. Legacy pages that still carry one combined
    // "full_overview" element get the concatenated projection. Status-only
    // mutation envelopes carry neither key, so they never blank existing copy.
    if ('description' in opportunity || 'exp_requirements' in opportunity) {
      if ('description' in opportunity) paintRichText('job_description', opportunity.description)
      if ('exp_requirements' in opportunity) {
        paintRichText('experience_requirements', opportunity.exp_requirements)
        // Tolerate the Designer typo currently on the CMS template
        // (experience_equirements) so repaint works before it is corrected.
        paintRichText('experience_equirements', opportunity.exp_requirements)
      }
      $$('[data-opp-bind="full_overview"]').forEach((el) => {
        el.innerHTML = opportunityOverviewHtml(opportunity)
      })
    }
    if (opportunity.status != null) {
      const status = String(opportunity.status)
      bind(document, 'status_label', status === 'Active' ? 'Open' : status)
      $$('[data-opp-status-badge]').forEach((el) => {
        el.setAttribute('data-opp-status-value', status.toLowerCase())
      })
      paintOppStatus(status)
    }
  }

  // Lifecycle endpoints currently return the edited opportunity directly.
  // Accept a small set of common envelopes as well, then fall back to the
  // known transition status so the already-open page never remains stale.
  function paintOpportunityMutationResult(result, fallbackStatus) {
    const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value)
    let opportunity = isRecord(result) ? result : {}
    if (isRecord(opportunity.opportunity)) opportunity = opportunity.opportunity
    else if (isRecord(opportunity.item)) opportunity = opportunity.item
    else if (isRecord(opportunity.data)) opportunity = opportunity.data
    if (opportunity.status == null) opportunity = { ...opportunity, status: fallbackStatus }
    paintOpportunityDetail(opportunity)
    // List page (/opportunities-brands-view): the cards are wf-xano-rendered and
    // their status pills + Close/Reopen swap are driven by per-card wf-xano-if,
    // NOT the document-scoped data-opp-bind/data-opp-status contracts that
    // paintOpportunityDetail touches. So a close/reopen from a LIST card would
    // otherwise leave the card stale ("Active + Close Opportunity") until a
    // manual reload, and a second click hits the backend's only-active/closed
    // guard. Re-fetch the brand feed so the mutated card repaints in place from
    // fresh Xano state (same pattern the apply/cancel/edit flows already use).
    // Detail pages carry no brand/opportunities/list feed, so this is a no-op
    // there and their in-place paintOpportunityDetail repaint is unaffected.
    //
    // Return the refresh PROMISE (WfXano.refresh(root) resolves after the feed
    // re-fetches and re-renders) so an awaiting caller — guard() awaits the
    // reopen onSuccess — keeps the loading spinner on until the card actually
    // repaints, with no window where the spinner is gone but the card is stale.
    const feedRoot = wfXanoBrandFeedRoot()
    if (feedRoot && window.WfXano && typeof window.WfXano.refresh === 'function') {
      try {
        return Promise.resolve(window.WfXano.refresh(feedRoot))
      } catch (e) {
        /* non-fatal: reload-time CMS mirror still corrects the card */
      }
    }
  }

  /* ===================== PAGE CONTROLLERS ======================== */
  // The brand feed is wf-xano-rendered when a list root — any of the three root
  // grammars (canonical wrapper, legacy wf-xano-list marker, v0.3.0 element="list"
  // root) — carries a wf-xano-source targeting brand/opportunities/list.
  const WF_XANO_BRAND_FEED_SEL =
    '[wf-xano-element="wrapper"][wf-xano-source*="brand/opportunities/list"], ' +
    '[wf-xano-list][wf-xano-source*="brand/opportunities/list"], ' +
    '[wf-xano-element="list"][wf-xano-source*="brand/opportunities/list"]'
  /** The wf-xano brand-feed root element, or null when the feed isn't on the page.
   *  Its .__wfXano instance is what WfXano.refresh(root) re-fetches + re-renders. */
  function wfXanoBrandFeedRoot() {
    return $(WF_XANO_BRAND_FEED_SEL)
  }
  function hasWfXanoBrandFeed() {
    return !!wfXanoBrandFeedRoot()
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
    let res
    try {
      res = await API.brandAppList(oppId, showArchived)
    } catch (err) {
      // Foreign brand -> redirect to its opportunities feed; other errors surface as before.
      if (redirectForeignBrandToFeed(err)) return
      throw err
    }
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

  function paintIncompleteProfilePrompt() {
    document.documentElement.setAttribute('data-opp30-profile-categories', 'missing')
    const targets = [
      $('[wf-xano-instance="dash-applied-opps"] [wf-xano-element="empty"]'),
      $('[wf-algolia-element="no-results"]'),
    ].filter(Boolean)

    targets.forEach((target) => {
      target.setAttribute('data-opp-profile-incomplete', 'true')
      const paragraphs = $$('p', target)
      if (paragraphs[0]) paragraphs[0].textContent = 'Complete your profile to see matching opportunities.'
      if (paragraphs[1]) {
        paragraphs[1].textContent = 'Add your roles so we can match opportunities to your expertise.'
      }
      if ($('[data-opp-complete-profile]', target)) return
      const link = document.createElement('a')
      link.href = '/starter-edit-profile'
      link.textContent = 'Complete profile'
      link.className = 'text-style-link'
      link.setAttribute('data-opp-complete-profile', '')
      link.style.display = 'inline-block'
      link.style.marginTop = '0.75rem'
      ;($('.tile-item_empty-state-layout', target) || target).appendChild(link)
    })
  }

  function showTalentIncompleteProfilePrompt() {
    const results = $('[wf-algolia-element="results"]')
    if (results && results.style.display !== 'none') results.style.display = 'none'
    const noResults = $('[wf-algolia-element="no-results"]')
    if (noResults && noResults.style.display !== '') noResults.style.display = ''
    paintIncompleteProfilePrompt()
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
  let _talentAlgoliaFilterQueue = Promise.resolve()
  let _talentAlgoliaExpectedFilters = null
  let _talentAlgoliaFilterTransitioning = false
  let _talentAlgoliaGuard = null
  let _talentAlgoliaRecoveryPromise = null
  let _talentRequestedTab = null
  let _talentRequestedTabPromise = null
  const TALENT_ALGOLIA_RESULT_TIMEOUT_MS = 10000

  function getTalentMatchContext() {
    if (!_talentMatchContextPromise) _talentMatchContextPromise = API.starterMatchContext()
    return _talentMatchContextPromise
  }

  function refreshTalentMatchContext() {
    _talentMatchContextPromise = null
    window.Opp30TalentMatchContext = null
    return getTalentMatchContext()
  }

  function queueTalentAlgoliaFilterChange(change) {
    const queued = _talentAlgoliaFilterQueue.catch(() => {}).then(change)
    _talentAlgoliaFilterQueue = queued
    return queued
  }

  function talentAlgoliaFacetFilters(result) {
    try {
      const value = new URLSearchParams(result?.params || '').get('facetFilters')
      if (!value) return []
      return JSON.parse(value).flat(Infinity).map(String)
    } catch {
      return []
    }
  }

  function talentAlgoliaFilterSnapshot(wfAlgolia, overrides = {}) {
    const state =
      typeof wfAlgolia.getFilterState === 'function' ? wfAlgolia.getFilterState() : {}
    return Object.fromEntries(
      ['category_refs', APPLIED_FIELD].map((field) => [
        field,
        Array.from(Object.hasOwn(overrides, field) ? overrides[field] : state[field]?.values || [])
          .map(String)
          .sort(),
      ]),
    )
  }

  function talentAlgoliaResultsMatchFilters(payload, expected) {
    const results = Array.isArray(payload?.results) ? payload.results : [payload]
    return (
      results.length > 0 &&
      results.every((result) => {
        const filters = talentAlgoliaFacetFilters(result)
        return Object.entries(expected).every(([field, values]) => {
          const prefix = `${field}:`
          const actual = filters
            .filter((filter) => filter.startsWith(prefix))
            .map((filter) => filter.slice(prefix.length))
            .sort()
          return values.length === actual.length && values.every((value, index) => value === actual[index])
        })
      })
    )
  }

  function waitForTalentAlgoliaResults(wfAlgolia, expected, request) {
    return new Promise((resolve, reject) => {
      let settled = false
      let timer = null
      const finish = (err) => {
        if (settled) return
        settled = true
        if (timer !== null) window.clearTimeout(timer)
        wfAlgolia.off('results', handleResults)
        wfAlgolia.off('error', handleError)
        if (err) reject(err)
        else resolve()
      }
      const handleResults = (payload) => {
        if (talentAlgoliaResultsMatchFilters(payload, expected)) finish()
      }
      const handleError = (err) => finish(err instanceof Error ? err : new Error(String(err)))
      wfAlgolia.on('results', handleResults)
      wfAlgolia.on('error', handleError)
      timer = window.setTimeout(
        () => finish(new Error('Timed out waiting for wf-algolia results')),
        TALENT_ALGOLIA_RESULT_TIMEOUT_MS,
      )
      try {
        request()
      } catch (err) {
        finish(err)
      }
    })
  }

  function setTalentAlgoliaFilterAndWait(wfAlgolia, field, values) {
    const expected = talentAlgoliaFilterSnapshot(wfAlgolia, { [field]: values })
    return waitForTalentAlgoliaResults(wfAlgolia, expected, () => wfAlgolia.setFilter(field, values))
  }

  function ensureTalentAlgoliaResultsGuard(wfAlgolia) {
    if (_talentAlgoliaGuard?.wfAlgolia === wfAlgolia) return
    if (_talentAlgoliaGuard) {
      _talentAlgoliaGuard.wfAlgolia.off('results', _talentAlgoliaGuard.handleResults)
    }
    const handleResults = (payload) => {
      const expected = _talentAlgoliaExpectedFilters
      if (!expected || talentAlgoliaResultsMatchFilters(payload, expected)) return
      setTalentResultsHidden(true)
      if (_talentAlgoliaFilterTransitioning || _talentAlgoliaRecoveryPromise) return
      const recovery = queueTalentAlgoliaFilterChange(async () => {
        _talentAlgoliaFilterTransitioning = true
        try {
          await waitForTalentAlgoliaResults(wfAlgolia, expected, () => {
            if (typeof wfAlgolia.refresh === 'function') wfAlgolia.refresh()
            else wfAlgolia.setFilter('category_refs', expected.category_refs)
          })
          if (_talentAlgoliaExpectedFilters === expected && !_talentRequestedTabPromise) {
            setTalentResultsHidden(false)
          }
        } catch (err) {
          _talentAlgoliaExpectedFilters = null
          document.documentElement.setAttribute('data-opp30-talent-algolia', 'error')
          console.error('[opp30] failed to recover stale talent Algolia results', err)
          const results = $('[wf-algolia-element="results"]')
          if (results) results.style.display = 'none'
          const noResults = $('[wf-algolia-element="no-results"]')
          if (noResults) noResults.style.display = ''
        } finally {
          _talentAlgoliaFilterTransitioning = false
        }
      })
      _talentAlgoliaRecoveryPromise = recovery
      const clearRecovery = () => {
        if (_talentAlgoliaRecoveryPromise === recovery) _talentAlgoliaRecoveryPromise = null
      }
      recovery.then(clearRecovery, clearRecovery)
    }
    wfAlgolia.on('results', handleResults)
    _talentAlgoliaGuard = { wfAlgolia, handleResults }
  }

  function initTalentAlgoliaMatch(clearApplied = false) {
    return queueTalentAlgoliaFilterChange(() => applyTalentAlgoliaMatch(clearApplied))
  }

  async function applyTalentAlgoliaMatch(clearApplied) {
    _talentAlgoliaFilterTransitioning = true
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
        _talentAlgoliaExpectedFilters = null
        document.documentElement.setAttribute('data-opp30-talent-algolia', 'no-category-refs')
        console.warn('[opp30] talent match context has no category_refs; Algolia match filter skipped')
        // No categories to match on: never fall back to the unfiltered feed. Collapse
        // the results and surface the empty state instead of showing non-matching cards.
        showTalentIncompleteProfilePrompt()
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
      ensureTalentAlgoliaResultsGuard(wfAlgolia)
      setTalentResultsHidden(true)
      const filterState =
        typeof wfAlgolia.getFilterState === 'function' ? wfAlgolia.getFilterState() : {}
      const appliedValues = filterState[APPLIED_FIELD]?.values || []
      await setTalentAlgoliaFilterAndWait(wfAlgolia, 'category_refs', categoryRefs)
      if (clearApplied && appliedValues.length) {
        await setTalentAlgoliaFilterAndWait(wfAlgolia, APPLIED_FIELD, [])
      }
      _talentAlgoliaExpectedFilters = talentAlgoliaFilterSnapshot(wfAlgolia)
      document.documentElement.setAttribute('data-opp30-talent-algolia', 'filtered')
      const results = $('[wf-algolia-element="results"]')
      if (results) results.style.display = ''
      if (_talentRequestedTab !== 'applied') setTalentResultsHidden(false)
    } catch (err) {
      _talentAlgoliaExpectedFilters = null
      document.documentElement.setAttribute('data-opp30-talent-algolia', 'error')
      console.error('[opp30] failed to apply talent Algolia match filter', err)
      const results = $('[wf-algolia-element="results"]')
      if (results) results.style.display = 'none'
      const noResults = $('[wf-algolia-element="no-results"]')
      if (noResults) noResults.style.display = ''
    } finally {
      _talentAlgoliaFilterTransitioning = false
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

  // Applied is historical member state: filter by application-linked opportunity IDs
  // and remove category_refs so later profile edits cannot hide prior applications.
  function applyTalentAppliedFilter() {
    return queueTalentAlgoliaFilterChange(async () => {
      _talentAlgoliaFilterTransitioning = true
      try {
        const wfAlgolia = await waitForWfAlgolia()
        if (!wfAlgolia) {
          document.documentElement.setAttribute('data-opp30-talent-algolia', 'missing-wf-algolia')
          console.warn('[opp30] wf-algolia unavailable; applied filter skipped')
          setTalentResultsHidden(false)
          return
        }
        const ids = await fetchAppliedOppIds()
        ensureTalentAlgoliaResultsGuard(wfAlgolia)
        setTalentResultsHidden(true)
        const filterState =
          typeof wfAlgolia.getFilterState === 'function' ? wfAlgolia.getFilterState() : {}
        const categoryValues = filterState.category_refs?.values || []
        await setTalentAlgoliaFilterAndWait(
          wfAlgolia,
          APPLIED_FIELD,
          ids.length ? ids : [APPLIED_EMPTY],
        )
        if (categoryValues.length) {
          await setTalentAlgoliaFilterAndWait(wfAlgolia, 'category_refs', [])
        }
        _talentAlgoliaExpectedFilters = talentAlgoliaFilterSnapshot(wfAlgolia)
        const results = $('[wf-algolia-element="results"]')
        if (results) results.style.display = ''
        document.documentElement.setAttribute('data-opp30-talent-applied-count', String(ids.length))
        document.documentElement.setAttribute('data-opp30-talent-algolia', 'filtered')
        if (_talentRequestedTab === 'applied') setTalentResultsHidden(false)
      } catch (err) {
        _talentAlgoliaExpectedFilters = null
        document.documentElement.setAttribute('data-opp30-talent-algolia', 'error')
        console.error('[opp30] failed to apply talent applied filter', err)
        const results = $('[wf-algolia-element="results"]')
        if (results) results.style.display = 'none'
        const noResults = $('[wf-algolia-element="no-results"]')
        if (noResults) noResults.style.display = ''
      } finally {
        _talentAlgoliaFilterTransitioning = false
      }
    })
  }

  function clearTalentAppliedFilter() {
    document.documentElement.removeAttribute('data-opp30-talent-applied-count')
    return initTalentAlgoliaMatch(true)
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
    if (tab === _talentRequestedTab && _talentRequestedTabPromise) return _talentRequestedTabPromise
    _talentRequestedTab = tab
    const allPanel = getTalentAllPanel()
    const appliedPanel = getTalentAppliedPanel()

    document.documentElement.setAttribute('data-opp30-talent-tab', tab)
    if (allPanel) allPanel.style.display = ''
    if (appliedPanel && appliedPanel !== allPanel) appliedPanel.style.display = tab === 'applied' ? '' : 'none'
    syncTalentTabControls(tab)

    const transition = tab === 'applied' ? applyTalentAppliedFilter() : clearTalentAppliedFilter()
    _talentRequestedTabPromise = transition
    try {
      await transition
    } finally {
      if (_talentRequestedTabPromise === transition) _talentRequestedTabPromise = null
    }
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

  // The dashboard's applied cards remain category-independent. Only replace its empty
  // state with profile guidance when the starter has no valid matching categories.
  async function initStarterDashboardOpportunityMatch() {
    try {
      const member = await gateOrRedirect('freelancer')
      if (!member) return
      // Generate Invoice is a Starter-only capability in Xano. Bind its UI
      // only after this page has resolved an authenticated Talent member, so a
      // Brand session can never inherit the modal click/submit behavior even
      // if the shared Project Item component is misconfigured or briefly
      // visible during a redirect.
      authorizeStarterInvoiceWorkflow(member)
      await initProjectDashboardWorkflow('starter', member)
      const context = await getTalentMatchContext()
      const categoryRefs = filterValues(contextValue(context, 'category_refs'))
      window.Opp30TalentMatchContext = context
      document.documentElement.setAttribute('data-opp30-talent-category-count', String(categoryRefs.length))
      document.documentElement.setAttribute('data-opp30-talent-category-refs', categoryRefs.join(','))
      document.documentElement.setAttribute(
        'data-opp30-dashboard-match',
        categoryRefs.length ? 'ready' : 'profile-incomplete',
      )
      if (!categoryRefs.length) paintIncompleteProfilePrompt()
    } catch (err) {
      document.documentElement.setAttribute('data-opp30-dashboard-match', 'error')
      console.error('[opp30] failed to initialize dashboard opportunity match context', err)
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
        if (link) {
          const path = opportunityPath(o)
          if (path) link.href = path
        }
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

  function parseOpportunityId(value) {
    const id = String(value || '').trim()
    if (!/^[1-9]\d*$/.test(id)) return null
    const parsed = Number(id)
    return Number.isSafeInteger(parsed) ? parsed : null
  }

  // The page's Xano opportunity id: prefer the CMS-bound [data-opp-page-id]
  // attribute (survives future slug-format changes). Fall back only for the
  // historical numeric slug, where the URL unambiguously represents the id.
  function pageOppId() {
    const el = $('[data-opp-page-id]')
    if (el) return parseOpportunityId(el.getAttribute('data-opp-page-id'))
    const slug = location.pathname.split('/').filter(Boolean).pop()
    return parseOpportunityId(slug)
  }

  async function initTalentDetail(member) {
    // Gate unless the caller (initOppDetailByRole) already resolved the member.
    if (!member && !(await gateOrRedirect('freelancer'))) return
    const oppId = pageOppId()
    if (!oppId) return (location.href = '/opportunities-freelancer-view')
    // CMS page already renders opportunity content — only fetch auth state
    let o, a
    try {
      ;({ opportunity: o, application: a } = await API.starterOppDetail(oppId))
    } catch (err) {
      console.error('[opp30] failed to load application state', err)
      // Reveal the not-applied CTAs (Apply) so a fetch failure never strands the
      // member behind the hide-until-state guard with no visible action.
      paintState(document, 'not-applied')
      return
    }
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

  // Prefill the edit-opportunity modal with the opp's CURRENT values so a brand
  // edits from reality (including categories and the Duration/Project-Type
  // radios, which otherwise submit their default state and clobber real values).
  async function prefillEditOpportunity(oppId) {
    const modal = $('[data-modal-target="edit-opportunity"]')
    if (modal) {
      prepareOpportunityForms(modal)
      initOpportunityCategorySelects(modal)
    }
    let o
    try {
      o = await API.brandOppGet(oppId)
    } catch (e) {
      return /* non-fatal: guard keeps existing values if the brand submits */
    }
    if (!o) return
    // Paint the Close/Reopen buttons from the live status (runs on brand-owner
    // init; independent of the edit modal, which may not be present).
    paintOppStatus(o.status)
    if (!modal) return
    const setVal = (name, val) => {
      const el = $(`[name="${name}"]`, modal)
      if (el && val != null) {
        el.value = val
        // Word/character counter embeds listen for user input. Dispatch the
        // same events after programmatic prefill so their displayed counts
        // match the values the member sees.
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
    setVal('Opportunity-title', o.title)
    setVal('Description', o.description)
    setVal('Requirements', o.exp_requirements)
    setOpportunityCategoryValues(modal, o.category_names)
    setVal(EST_HOURS_FIELD_NAME, o.est_hours)
    const budgetField =
      o.project_type === 'One Time'
        ? 'One-Time-Budget'
        : o.project_type === 'Full Time'
          ? 'Full-Time-Budget'
          : 'Part-Time-Budget'
    setVal(budgetField, o.budget)
    // Check the matching radio (value === current) and mirror Webflow's
    // visual class so the pre-selection shows when the modal opens.
    const checkRadio = (name, current, notify = false) => {
      let selected = null
      $$(`[name="${name}"]`, modal).forEach((el) => {
        const on = el.value === current
        el.checked = on
        if (on) selected = el
        el.classList.toggle('w--redirected-checked', on)
        const vis = el.parentElement && el.parentElement.querySelector('.w-radio-input')
        if (vis) vis.classList.toggle('w--redirected-checked', on)
      })
      // The authored Project Type tab controller listens for a native change
      // event to move data-tab-filters-active and reveal the matching
      // data-project-type panel. Assignment alone checks the real radio but
      // leaves the default One Time pill and panel visually active.
      if (notify && selected) selected.dispatchEvent(new Event('change', { bubbles: true }))
    }
    checkRadio('Project-Type', o.project_type, true)
    checkRadio('Duration', o.est_project_duration)
    syncOpportunityEstimatedHours(modal)
  }

  /** /opportunities/<slug> CMS detail page, shared by talent and PAYING brands.
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
    // Brand view: the CMS page renders the opportunity content; wire the brand
    // action modals, then the applicants list. When a wf-xano wrapper targets
    // brand/applications/list the library owns the render (B3) — the legacy
    // renderList fallback below only runs for un-migrated markup.
    const oppId = pageOppId()
    if (!oppId) return
    setActiveOpp(oppId)
    wireCloseOpportunityModal()
    // Ownership: plan gating (data-ms-content) can't know WHOSE opp this is —
    // any paid brand sees the brand wrapper. The applicants list 404s for a
    // foreign brand (server-side check), so probe it once and hide the
    // [data-opp-owner-only] action cluster (Close/Edit/applicants) when this
    // brand doesn't own the opportunity.
    try {
      await API.brandAppList(oppId, false, 1, 1)
      document.documentElement.setAttribute('data-opp-brand-owner', 'true')
      prefillEditOpportunity(oppId)
    } catch (err) {
      document.documentElement.setAttribute('data-opp-brand-owner', 'false')
      // Foreign brand (403/404): redirect to its opportunities feed rather than
      // leaving it on a view-only page (product decision 2026-07-23).
      if (redirectForeignBrandToFeed(err)) return
      // Transient/other error: keep the owner-only UI hidden (don't bounce a
      // real owner on a network blip), same as before.
      $$('[data-opp-owner-only]').forEach((el) => {
        el.style.display = 'none'
      })
      log('brand ownership probe failed — owner-only UI hidden')
      return
    }
    if ($('[wf-xano-element="wrapper"][wf-xano-source*="brand/applications/list"]')) return
    if (!$('[data-opp-role="brand"] [data-opp-list="applicants"]')) return
    const res = await API.brandAppList(oppId)
    renderList('applicants', res.items, (card, a) => {
      card.setAttribute('data-app-id', a.id)
      bind(card, 'message', a.message)
      bind(card, 'submitted_at', fmtDate(a.submitted_at))
    })
  }

  /** Activate a wf-xano root that opted out of automatic boot with
   *  wf-xano-defer="true" (wf-xano >= 0.28.0). Passing the root itself as the
   *  init scope bypasses the defer skip. Uses the wf-xano pre-load queue so
   *  activation is race-safe regardless of which script evaluates first. */
  function activateDeferredFeed(rootEl) {
    const run = (wfx) => {
      try {
        wfx.init(rootEl)
      } catch (e) {
        console.error('[opp30] deferred feed activation failed', e)
      }
    }
    if (window.WfXano && !Array.isArray(window.WfXano)) run(window.WfXano)
    else (window.WfXano = window.WfXano || []).push(run)
  }

  /** Keep the single authored Navbar Main component (renamed from Navbar v2 in
   *  the Designer) aligned with the merged opportunities role. Webflow can
   *  restore a component property's authored
   *  value after this controller first resolves the member, so re-apply the
   *  existing data-preview-nav attribute when that value or the component DOM
   *  changes. This mutates attributes only; it never creates navbar markup. */
  function syncMergedNavbarRole(role) {
    const navbarRole = role === 'talent' ? 'freelancer' : 'brand'
    const apply = () => {
      $$('[data-preview-nav]').forEach((navbar) => {
        if (navbar.getAttribute('data-preview-nav') !== navbarRole) {
          navbar.setAttribute('data-preview-nav', navbarRole)
        }
      })
    }

    apply()
    if (window.__opp30NavbarRoleObserver) window.__opp30NavbarRoleObserver.disconnect()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-preview-nav'],
      childList: true,
      subtree: true,
    })
    window.__opp30NavbarRoleObserver = observer
  }

  /** Merged opportunities feed (/opportunities): one page shared by talent and
   *  paying brands. Both role sections live in the DOM behind the page-head
   *  anti-flash CSS
   *  (<style>html:not([data-opp-role-resolved]) [data-opp-role]{display:none}</style>);
   *  both wf-xano feed roots carry wf-xano-defer="true" so neither fetches at
   *  boot. Resolve the member's plan role, reveal that role's wrapper, change
   *  only the existing native navbar's data-preview-nav role, and activate
   *  only its feed — the wrong-role instance never constructs or fetches. */
  async function initMergedOppFeed() {
    const gate = await gateByPlan()
    if (!gate) return
    const role = gate.role === 'talent' ? 'talent' : 'brand'
    showRoleWrapper(role)
    syncMergedNavbarRole(role)
    const feedRoot = $(
      `[data-opp-role="${role}"] [wf-xano-element="wrapper"][wf-xano-defer="true"]`,
    )
    if (feedRoot) activateDeferredFeed(feedRoot)
    else log('merged feed: no deferred wf-xano root for role', role)
    if (role === 'talent') {
      // Parity with initTalentList's wf-xano path: mark render ownership and
      // honor the match-debug opt-in on the merged page too.
      document.documentElement.setAttribute('data-opp30-talent-algolia', 'wf-xano')
      if (opportunityMatchDebugEnabled()) loadOpportunityMatchDebug()
      return
    }
    // Brand extras (both internally run-once/gated).
    wireCloseOpportunityModal()
    initBrandCreatePage()
  }

  // Standalone brand "create opportunity" PAGE (/opportunities---create).
  // Unlike the modal, this is a full Webflow form with a native submit button
  // and no [data-opp-submit] hook, so we bind its stable role directly.
  async function initBrandCreatePage() {
    // Shared run-once flag with v3/opportunities---create.js — whichever loads
    // first binds the form; the other no-ops (prevents double submit).
    if (window.__opp30CreatePage) return
    window.__opp30CreatePage = true
    if (!(await gateOrRedirect('brand'))) return
    const form = $('[data-opp-form="create"]')
    if (!form) return
    log('create page form bound', form)
    const status = $('[data-opp-create-status]') // optional inline message element
    const say = (m, receipt = null) => {
      if (status && receipt) decorateWorkflowMessage(status, m, receipt)
      else if (status) status.textContent = m
      else if (m) console.info('[opp30:create]', m)
    }
    const btn = $('input[type="submit"]', form) || $('[type="submit"]', form) || $('.w-button', form)
    const setBtn = (txt) => {
      if (!btn) return
      if (btn.value !== undefined && btn.tagName === 'INPUT') btn.value = txt
      else btn.textContent = txt
    }
    const origLabel = btn ? (btn.value !== undefined && btn.tagName === 'INPUT' ? btn.value : btn.textContent) : ''
    // Design-system submit buttons carry the authored loading contract
    // (data-opp-element="loading-button" with a loading-spinner + loading-hide).
    // When present, drive that contract (spinner shows, label/icon hide) instead
    // of writing "Submitting…" into the empty cover <button>, which rendered as
    // stray text over the styled button. Plain full-page inputs fall back to text.
    const loadingWrap = btn && btn.closest('[data-opp-element="loading-button"]')
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
        const validationMessage = validateOpportunityPayload(payload)
        if (validationMessage) {
          return say(
            validationMessage,
            validationDiagnostic('opportunity_create', 'opportunity', 'INVALID_FORM'),
          )
        }
        submitting = true
        if (loadingWrap) setOpportunityActionPending(btn, true)
        else if (btn) {
          btn.disabled = true
          btn.style.opacity = '0.6'
          setBtn('Submitting…')
        }
        say('Submitting…')
        try {
          const result = await API.brandOppCreate(payload)
          // Show the modal's native success screen ("<Job Name> is pending for
          // review") with the just-entered title bound in, instead of a full-page
          // redirect. Redirect only when the success markup is absent (e.g. the
          // standalone create page).
          const wrap = form.closest('.w-form') || form.parentElement
          const done =
            wrap && (wrap.querySelector('.create-opportunities_success') || wrap.querySelector('.w-form-done'))
          if (done) {
            paintOpportunityReviewSuccess(done, payload.title)
            form.style.display = 'none'
            done.style.display = 'block'
            const receipt = diagnosticForResponse(result)
            const message = done.querySelector ? $('[data-workflow-diagnostic-message]', done) : null
            if (message && receipt) decorateWorkflowMessage(message, message.textContent, receipt)
            say('')
            // Reset the submit state so a follow-up create (after the modal is
            // reopened and rewound to the form) works, and clear the spinner.
            submitting = false
            if (loadingWrap) setOpportunityActionPending(btn, false)
            // Bring the new opportunity into the wf-xano brand feed behind the modal.
            try {
              if (window.WfXano && typeof window.WfXano.refresh === 'function') window.WfXano.refresh()
            } catch (e) {
              /* non-fatal */
            }
          } else {
            say('Submitted! Your opportunity is now live.')
            location.href = '/opportunities-brands-view'
          }
        } catch (err) {
          const receipt = diagnosticForError(err)
          console.error('[opp30:create] request failed', {
            diagnostic_id: receipt && receipt.diagnostic_id || '',
            error_code: receipt && receipt.error_code || 'WORKFLOW_ERROR',
            http_status: receipt && receipt.http_status,
          })
          say(
            (err && err.data && err.data.message) || 'Something went wrong. Please try again.',
            diagnosticForError(err),
          )
          submitting = false
          if (loadingWrap) setOpportunityActionPending(btn, false)
          else if (btn) {
            btn.disabled = false
            btn.style.opacity = ''
            setBtn(origLabel)
          }
        }
      },
      true,
    )
  }

  /* ==================== ACTIVE-ID TRACKING ====================== */
  // Confirmation/edit modals carry no id; we remember what was clicked.
  let activeOpp = null
  let activeOppPath = ''
  let activeApp = null
  const setActiveOpp = (id, path = '') => {
    activeOpp = id ? parseInt(id, 10) : null
    activeOppPath = normalizedOpportunityPath(path) || opportunityPath(activeOpp)
  }
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
      // wf-xano also stamps applicant rows with data-wf-xano-id, but that id is
      // the application id — not the opportunity id. On the shared CMS detail
      // page an applicant-card click must never replace the page-level
      // activeOpp (otherwise Edit/Close sends the application id and Xano
      // correctly returns "Opportunity not found"). Keep it only as activeApp.
      const wfXanoRoot = card.closest('[wf-xano-source]')
      const wfXanoSource = wfXanoRoot ? wfXanoRoot.getAttribute('wf-xano-source') || '' : ''
      if (wfXanoSource.includes('applications/list')) {
        setActiveApp(card.getAttribute('data-app-id') || card.getAttribute('data-wf-xano-id'))
        return
      }
      setActiveOpp(
        card.getAttribute('data-opp-id') ||
          card.getAttribute('data-wf-algolia-hit-objectid') ||
          card.getAttribute('data-wf-xano-id'),
        cardOpportunityPath(card),
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

  window.addEventListener('modal-open', (e) => {
    const modal = e.detail && e.detail.modal
    prepareOpportunityLoadingControls()
    if (modal) {
      prepareOpportunityForms(modal)
      initOpportunityCategorySelects(modal)
    }
    const flowEl = modal && modal.querySelector('[data-form-flow]')
    const flowId = flowEl && flowEl.getAttribute('data-form-flow')
    const ff = window.lumos && window.lumos.formFlow
    if (flowId && ff && ff.list && ff.list[flowId]) ff.reset(flowId)
    // Edit-opportunity values are initially prefetched while the detail page
    // loads. Lumos then restores the Webflow-authored form defaults whenever
    // the modal opens, which can overwrite the native checked Project-Type
    // radio after its visual class was already painted. Refresh the live
    // opportunity after that synchronous reset so the native control, its
    // Webflow visual state, conditional hours field, and submitted payload all
    // agree. This only binds existing Designer markup.
    const editOppId = activeOpp || pageOppId()
    if (
      modal &&
      editOppId &&
      modal.matches &&
      modal.matches('[data-modal-target="edit-opportunity"]')
    )
      void prefillEditOpportunity(editOppId)
    // The withdraw modal's nav header lives OUTSIDE the form-flow steps (the
    // shared modal_nav bar), so the flow reset above can't rewind it. Its two
    // title variants follow the data-opp-state contract (like the close
    // modal's data-opp-status twins): repaint to 'applied' on every open so a
    // reopen after a same-page withdraw never strands the success title.
    if (modal && modal.matches && modal.matches('[data-modal-target="cancel-application"]'))
      paintState(modal, 'applied')
    if (modal && modal.matches && modal.matches('[data-modal-target="close-opportunity"]'))
      paintCloseOpportunityModalTitle(modal, 'confirm')
    // Apply/edit-application AND edit-opportunity modals: rewind the success
    // screen (w-form-done) back to the form step, mirroring the form-flow reset
    // above, so a reopened modal never strands the brand on "pending for review".
    if (
      modal &&
      modal.matches &&
      modal.matches(SUCCESS_SCREEN_MODALS + ', [data-modal-target="post-opportunity"]')
    ) {
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
    const createPageForm = createBtn ? createBtn.closest('[data-opp-form="create"]') : null
    const onCreatePage = location.pathname.includes('opportunities---create')
    if (createBtn && !createPageForm && !onCreatePage)
      createBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="post-opportunity"]')
        const payload = readOpportunityForm(modal)
        const validationMessage = validateOpportunityPayload(payload)
        if (validationMessage) {
          return showOpportunityError(
            createBtn,
            validationMessage,
            validationDiagnostic('opportunity_create', 'opportunity', 'INVALID_FORM'),
          )
        }
        await guard(createBtn, () => API.brandOppCreate(payload))
      })
    else if (createBtn && (createPageForm || onCreatePage)) {
      log('skipped generic create click binding on full-page create form')
    }

    // EDIT — on success show the edit modal's native w-form-done
    // ("pending for review") screen instead of reloading. The update endpoint
    // keeps existing values for any empty input (so a partial edit never wipes
    // the opp), and the modal is prefilled with current values on load.
    const editBtn = $('[data-opp-submit="update"]')
    if (editBtn) {
      const editModal = $('[data-modal-target="edit-opportunity"]')
      // The Submit control lives inside a Webflow .w-form, so clicking it also
      // fires a native form submit that Webflow intercepts to flash its own
      // inline .w-form-done/.w-form-fail toast (and can trigger a reload). Kill
      // that in the capture phase (same technique as initBrandCreatePage) so
      // ONLY our own success screen shows, after the real API call resolves.
      const editForm = editModal && $('form', editModal)
      if (editForm)
        editForm.addEventListener(
          'submit',
          (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
          },
          true,
        )
      editBtn.addEventListener('click', async () => {
        const modal = editModal || $('[data-modal-target="edit-opportunity"]')
        const payload = readOpportunityForm(modal)
        const validationMessage = validateOpportunityPayload(payload)
        if (validationMessage) {
          return showOpportunityError(
            editBtn,
            validationMessage,
            validationDiagnostic('opportunity_edit', 'opportunity', 'INVALID_FORM'),
          )
        }
        await guard(editBtn, () => API.brandOppUpdate(activeOpp, payload), (updatedOpportunity) => {
          paintOpportunityDetail(updatedOpportunity)
          // No-reload success: swap the form for the modal's native w-form-done
          // "pending for review" screen (same pattern as apply/edit-application).
          const form = $('form', modal)
          const done = $('.w-form-done', modal)
          const fail = $('.w-form-fail', modal)
          if (form && done) {
            paintOpportunityReviewSuccess(
              done,
              (updatedOpportunity && updatedOpportunity.title) || payload.title,
            )
            if (fail) fail.style.display = 'none'
            form.style.display = 'none'
            done.style.display = 'block'
            const receipt = diagnosticForResponse(updatedOpportunity)
            const message = done.querySelector ? $('[data-workflow-diagnostic-message]', done) : null
            if (message && receipt) decorateWorkflowMessage(message, message.textContent, receipt)
          } else {
            location.reload()
          }
        })
      })
    }

    // CLOSE (confirmation). Close controls inside the close-opportunity modal
    // are owned by wireCloseOpportunityModal() below. Binding them here as
    // well sends two PATCH requests from one click and lets this default guard
    // reload interrupt the detail modal's success step. Keep this direct path
    // only for any legacy close control that lives outside that modal.
    const closeBtn = $('[data-opp-submit="close"]')
    if (closeBtn && !closeBtn.closest('[data-modal-target="close-opportunity"]'))
      closeBtn.addEventListener('click', () =>
        guard(closeBtn, () => API.brandOppClose(activeOpp)),
      )

    // REOPEN closed opportunity (confirmation) — server re-activates it,
    // clears closed_at, and re-syncs Webflow CMS + Algolia so the
    // opportunity reappears in the talent feeds.
    const reopenBtn = $('[data-opp-submit="reopen"]')
    if (reopenBtn)
      reopenBtn.addEventListener('click', () =>
        guard(reopenBtn, () => API.brandOppReopen(activeOpp), (reopenedOpportunity) =>
          paintOpportunityMutationResult(reopenedOpportunity, 'Active'),
        ),
      )

    // ARCHIVE / RESTORE applicant (confirmation)
    const archiveBtn = $('[data-opp-submit="archive"]')
    if (archiveBtn)
      archiveBtn.addEventListener('click', () =>
        guard(archiveBtn, () => API.brandAppArchive(activeApp)),
      )

    // APPLY — on success show the modal's native w-form-done "Application sent"
    // screen (F4) in place instead of reloading (showApplySuccess falls back to
    // a reload when that markup is missing). Capture the new application id so
    // a follow-up edit/withdraw in the same page-life targets the right row.
    const applyBtn = $('[data-opp-submit="apply"]')
    if (applyBtn)
      applyBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="apply-opportunity"]')
        const msg = ($('[name="Cover-Letter"]', modal) || {}).value || ''
        if (!msg.trim()) {
          return showOpportunityError(
            applyBtn,
            'Please write a cover letter',
            validationDiagnostic('opportunity_application', 'application', 'MISSING_COVER_LETTER'),
          )
        }
        await guard(applyBtn, async () => {
          const res = await API.starterAppSubmit(activeOpp, msg.trim())
          const newId = res && (res.id || (res.application && res.application.id))
          if (newId) setActiveApp(newId)
          setEditPrefill(msg.trim()) // the new message is what an edit should start from
          return res
        }, showApplySuccess)
      })

    // EDIT APPLICATION — resolves the application id lazily (same as cancel)
    // so it still works when activeApp is stale/null after a no-reload apply
    // or withdraw earlier in the same page-life.
    const editAppBtn = $('[data-opp-submit="update-application"]')
    if (editAppBtn)
      editAppBtn.addEventListener('click', async () => {
        const modal = $('[data-modal-target="edit-application"]')
        const msg = ($('[name="Cover-Letter"]', modal) || {}).value || ''
        if (!msg.trim()) {
          return showOpportunityError(
            editAppBtn,
            'Please write a cover letter',
            validationDiagnostic('application_edit', 'application', 'MISSING_COVER_LETTER'),
          )
        }
        await guard(editAppBtn, async () => {
          let appId = activeApp
          if (!appId && activeOpp) {
            const detail = await API.starterOppDetail(activeOpp)
            appId = detail && detail.application && detail.application.id
          }
          if (!appId) throw { data: { message: 'Could not find your application for this opportunity.' } }
          return API.starterAppUpdate(appId, msg.trim())
        }, showEditAppSuccess)
      })

    // CANCEL APPLICATION (confirmation)
    // wf-xano/wf-algolia cards only carry the opportunity id, so the
    // application id is resolved lazily via the detail endpoint (which
    // returns the signed-in member's application for that opportunity).
    // On success the modal's own form-flow "withdrawn" step stays visible
    // (no reload) and the page repaints behind it.
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
        }, showCancelSuccess),
      )
  }

  // Disables a button while its action runs; on success runs onSuccess when
  // given, else reloads (simple v1 behavior kept as the default/fallback).
  function guard(btn, fn, onSuccess) {
    const control = loadingControlFor(btn)
    const guardKey = control || btn
    if (guardKey && activeActionGuards.has(guardKey)) return activeActionGuards.get(guardKey)

    const request = (async () => {
      clearOpportunityError(btn)
      setOpportunityActionPending(btn, true)
      try {
        const result = await fn()
        if (onSuccess) {
          await onSuccess(result)
          // No-reload flows can expose the same control again later (for
          // example Reopen -> Close -> Reopen). Restore the valued loading
          // state after the authoritative repaint/success transition.
          setOpportunityActionPending(btn, false)
        } else location.reload()
        return result
      } catch (err) {
        const receipt = diagnosticForError(err)
        console.error('[opp30] workflow request failed', {
          diagnostic_id: receipt && receipt.diagnostic_id || '',
          error_code: receipt && receipt.error_code || 'WORKFLOW_ERROR',
          http_status: receipt && receipt.http_status,
        })
        setOpportunityActionPending(btn, false)
        const baseMessage =
          (err && err.data && err.data.message) || 'Something went wrong. Please try again.'
        showOpportunityError(btn, baseMessage, diagnosticForError(err))
        return null
      } finally {
        if (guardKey) activeActionGuards.delete(guardKey)
      }
    })()

    if (guardKey) activeActionGuards.set(guardKey, request)
    return request
  }

  function opportunityErrorElement(btn) {
    if (!btn || !btn.closest) return null
    const modal = btn.closest('[data-modal-target]')
    const form = btn.closest('form')
    const scope = modal || (form && (form.closest('.w-form') || form.parentElement))
    if (!scope) return null
    return $('[data-workflow-diagnostic-error]', scope) || $('.w-form-fail', scope)
  }

  function clearOpportunityError(btn) {
    const fail = opportunityErrorElement(btn)
    if (fail) fail.style.display = 'none'
  }

  function showOpportunityError(btn, message, receipt) {
    const fail = opportunityErrorElement(btn)
    if (!fail) {
      alert(message)
      return false
    }
    fail.style.display = 'block'
    const target = fail.querySelector
      ? $('[data-workflow-diagnostic-message]', fail) || $('p, div', fail) || fail
      : fail
    if (target.__startersWorkflowDiagnosticBaseText === undefined) {
      target.__startersWorkflowDiagnosticBaseText = target.textContent || message
    }
    if (receipt) decorateWorkflowMessage(target, message, receipt)
    else target.textContent = message
    return true
  }

  /* ================== F4: APPLICATION-SENT SCREEN ================ */
  // The apply AND edit-application modals share the same skeleton: the
  // "Application sent" / "Application has been edited" screen is the form
  // block's native Webflow success state (.w-form-done), hidden until swapped
  // in here. Falls back to the old reload when the markup is missing.
  const APP_FORM_MODALS = '[data-modal-target="apply-opportunity"], [data-modal-target="edit-application"]'
  // Modals whose w-form-done success screen must rewind to the form on reopen:
  // the two application modals plus the brand edit-opportunity modal.
  const SUCCESS_SCREEN_MODALS = APP_FORM_MODALS + ', [data-modal-target="edit-opportunity"]'
  function showAppModalSuccess(target, result) {
    const modal = $('[data-modal-target="' + target + '"]')
    const form = modal && ($('.expert-application_form', modal) || $('form', modal))
    const done = modal && $('.w-form-done', modal)
    if (!modal || !form || !done) return location.reload()
    form.style.display = 'none'
    done.style.display = 'block'
    const receipt = diagnosticForResponse(result)
    const message = done.querySelector ? $('[data-workflow-diagnostic-message]', done) : null
    if (message && receipt) decorateWorkflowMessage(message, message.textContent, receipt)
    // Repaint the page behind the modal so closing it (any path) never shows
    // stale content: flip the state blocks and re-run the wf-xano application
    // card (fresh message after an edit) without a full reload.
    try {
      paintState(document, 'applied')
      if (window.WfXano && typeof window.WfXano.refresh === 'function') window.WfXano.refresh()
    } catch (e) {
      /* non-fatal */
    }
  }
  const showApplySuccess = (result) => showAppModalSuccess('apply-opportunity', result)
  const showEditAppSuccess = (result) => showAppModalSuccess('edit-application', result)

  // Keep the edit modal's Cover-Letter in sync with the live application
  // message across no-reload flows — initTalentDetail only prefills it at
  // page load, so a same-page apply/withdraw would otherwise leave it stale.
  function setEditPrefill(msg) {
    const cl = $('[name="Cover-Letter"]', $('[data-modal-target="edit-application"]') || document)
    if (cl) cl.value = msg || ''
  }

  // Withdraw success: the cancel modal's form-flow already advanced to its
  // "withdrawn" step when the confirm button was clicked, so leave the modal
  // as-is (the member actually gets to read the confirmation now) and repaint
  // the page behind it. 'not-applied' mirrors what a fresh load would compute:
  // the detail endpoint filters canceled applications, so appState() would
  // return 'not-applied', showing the Apply CTA + empty-state panel again.
  function showCancelSuccess(result) {
    setActiveApp(null) // the canceled id must never leak into a follow-up edit
    setEditPrefill('') // no live application anymore — a future edit starts blank
    const modal = $('[data-modal-target="cancel-application"]')
    try {
      paintState(document, 'not-applied')
      paintState(modal, 'not-applied')
      if (window.WfXano && typeof window.WfXano.refresh === 'function') window.WfXano.refresh()
    } catch (e) {
      /* non-fatal */
    }
    const receipt = diagnosticForResponse(result)
    const steps = modal ? $$('[data-form-flow-step]', modal) : []
    const visibleStep = steps.find((step) =>
      step.getAttribute('aria-hidden') !== 'true' && step.style.display !== 'none',
    )
    const message = visibleStep && visibleStep.querySelector
      ? $('[data-workflow-diagnostic-message]', visibleStep) || $('p', visibleStep)
      : null
    if (message && receipt) {
      if (message.__startersWorkflowDiagnosticBaseText === undefined) {
        message.__startersWorkflowDiagnosticBaseText = message.textContent
      }
      decorateWorkflowMessage(message, message.__startersWorkflowDiagnosticBaseText, receipt)
    }
  }

  // B3 applicants (wf-xano rows): archive/restore are PER-ROW buttons cloned
  // from the template after wireModals ran, so the single-button bindings
  // there never see them — delegate instead. The row's data-wf-xano-id is the
  // application id (the enriched brand/applications/list keeps id = app row).
  // Success re-runs wf-xano (row moves between All/Archived) — no reload.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-opp-submit="archive"], [data-opp-submit="restore"]')
    if (!btn) return
    const row = btn.closest('[data-wf-xano-id]')
    if (!row) return // static (non-wf-xano) buttons keep their wireModals path
    e.preventDefault()
    const appId = parseInt(row.getAttribute('data-wf-xano-id'), 10)
    if (!appId) return
    const action = btn.getAttribute('data-opp-submit')
    guard(btn, () => (action === 'archive' ? API.brandAppArchive(appId) : API.brandAppRestore(appId)), () => {
      try {
        if (window.WfXano && typeof window.WfXano.refresh === 'function') window.WfXano.refresh()
      } catch (err) {
        /* non-fatal */
      }
    })
  })

  // F4 buttons carry no hooks in the Designer, so delegate by label within the
  // success screen (same text-match pattern as wireCloseOpportunityModal).
  // Covers both app-form modals — apply and edit-application share the screen.
  document.addEventListener('click', (e) => {
    const modal = e.target.closest(APP_FORM_MODALS)
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
      // On the detail page the application is already on screen behind the
      // modal (showApplySuccess repainted it) — just close the modal via the
      // engine's own close element. On the feed the same modal applies from a
      // card, so "View Application" navigates to that opportunity's page.
      if (/^\/opportunities\/[^/]+\/?$/.test(location.pathname)) {
        const closeEl = modal.querySelector('[data-modal-close]')
        if (closeEl) closeEl.click()
        else location.reload()
      } else if (activeOpp) {
        location.href = activeOppPath || opportunityPath(activeOpp)
      } else {
        location.reload()
      }
    }
  })

  /* ============ wf-algolia bridge (opportunity feeds) ============ */
  // Brand and starter feeds render via the wf-algolia package, whose cards expose
  // data-wf-algolia-hit-objectid (not data-opp-id) and whose pagination + detail-link
  // markup needs adjusting. This bridges those cards to the Opp30 handlers, preserves
  // the starter incomplete-profile state across Algolia renders, and fixes markup
  // wf-algolia 1.0.4 can't drive on its own. No-op without a results container.
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

    // Per-card: mirror the stable id to data-opp-id. Preserve a projected
    // url_path/webflow_slug href from Algolia; use the Xano id only as fallback.
    const fixCards = () => {
      results.querySelectorAll('[data-wf-algolia-hit-objectid]').forEach((card) => {
        const id = card.getAttribute('data-wf-algolia-hit-objectid')
        if (!id) return
        if (!card.hasAttribute('data-opp-id')) card.setAttribute('data-opp-id', id)
        card
          .querySelectorAll('a[wf-algolia-link], a[wf-algolia-link-url], a.clickable_link, a[data-opp-detail-link]')
          .forEach((a) => {
            if (!normalizedOpportunityPath(a.getAttribute('href'))) a.setAttribute('href', opportunityPath(id))
          })
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
      if (
        isTalentFeed &&
        _talentRequestedTab !== 'applied' &&
        document.documentElement.getAttribute('data-opp30-talent-algolia') === 'no-category-refs'
      ) {
        showTalentIncompleteProfilePrompt()
      }
    }
    apply()
    // Cards render before the applied-ids fetch resolves; re-mark once it's in.
    if (isTalentFeed) fetchAppliedOppIds().then(apply).catch(() => {})
    const resultsObserver = new MutationObserver(apply)
    resultsObserver.observe(results, { childList: true, subtree: true })
    const noResults = $('[wf-algolia-element="no-results"]')
    if (isTalentFeed && noResults) {
      resultsObserver.observe(noResults, { attributes: true, attributeFilter: ['style'] })
    }
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

    document.addEventListener(
      'click',
      (e) => {
        const flowConfirm = e.target.closest('[data-close-opp="confirm-button"]')
        if (!flowConfirm) return
        if (approvedCloseFlowAdvances.has(flowConfirm)) {
          approvedCloseFlowAdvances.delete(flowConfirm)
          return
        }
        const closeModal = e.target.closest('[data-modal-target="close-opportunity"]')
        if (!closeModal || !activeOpp) return

        e.preventDefault()
        e.stopPropagation()

        const btn =
          e.target.closest('a, button, [role="button"], .button_main-wrap, [data-w-id]') ||
          flowConfirm
        guard(btn, () => API.brandOppClose(activeOpp), (closedOpportunity) => {
          paintOpportunityMutationResult(closedOpportunity, 'Closed')
          paintCloseOpportunityModalTitle(closeModal, 'success')
          setOpportunityActionPending(btn, false)
          approvedCloseFlowAdvances.add(flowConfirm)
          try {
            flowConfirm.click()
          } finally {
            approvedCloseFlowAdvances.delete(flowConfirm)
          }
        })
      },
      true,
    )

    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-modal-target="close-opportunity"]')) return
      if (e.target.closest('[data-close-opp="confirm-button"]')) return
      const btn =
        e.target.closest('a, button, [role="button"], .button_main-wrap, [data-w-id]') || e.target
      if (/^confirm$/i.test((btn.textContent || '').trim()) && activeOpp)
        guard(btn, () => API.brandOppClose(activeOpp))
    })
  }

  /* ================= OPPORTUNITY MATCH QA MODE ================== */
  const OPP_MATCH_DEBUG_PARAM = 'opp_debug'
  const OPP_MATCH_DEBUG_SCRIPT =
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/opportunities-3.0-debug.js'

  function opportunityMatchDebugEnabled() {
    const value = String(urlParam(OPP_MATCH_DEBUG_PARAM) || '').trim().toLowerCase()
    return ['1', 'true', 'yes', 'on'].includes(value)
  }

  function preserveOpportunityMatchDebugLink(link, value) {
    if (!link || !link.matches?.('a[href]')) return
    try {
      const target = new URL(link.href, location.href)
      if (target.origin !== location.origin) return
      if (!/^\/opportunities(?:-freelancer-view)?\/?$/.test(target.pathname)) return
      if (target.searchParams.get(OPP_MATCH_DEBUG_PARAM) === value) return
      target.searchParams.set(OPP_MATCH_DEBUG_PARAM, value)
      link.href = `${target.pathname}${target.search}${target.hash}`
    } catch (e) {
      /* non-fatal */
    }
  }

  function loadOpportunityMatchDebug() {
    const value = urlParam(OPP_MATCH_DEBUG_PARAM) || '1'
    const preserveLinks = (root) => {
      if (root?.matches?.('a[href]')) preserveOpportunityMatchDebugLink(root, value)
      root?.querySelectorAll?.('a[href]').forEach((link) =>
        preserveOpportunityMatchDebugLink(link, value),
      )
    }

    preserveLinks(document)
    const linkObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          preserveOpportunityMatchDebugLink(mutation.target, value)
          return
        }
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) preserveLinks(node)
        })
      })
    })
    linkObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['href'],
      childList: true,
      subtree: true,
    })
    document.addEventListener(
      'click',
      (event) => preserveOpportunityMatchDebugLink(event.target.closest?.('a[href]'), value),
      true,
    )

    window.Opp30MatchDebugBridge = {
      API,
      contextValue,
      filterValues,
      getTalentMatchContext,
      refreshTalentMatchContext,
      memberScopeResetEvent: MEMBER_SCOPE_RESET_EVENT,
    }

    const script = document.createElement('script')
    script.id = 'opp30-match-debug-script'
    script.src = OPP_MATCH_DEBUG_SCRIPT
    script.async = true
    script.addEventListener(
      'error',
      () => {
        document.documentElement.setAttribute('data-opp30-match-debug', 'error')
        console.error('[opp30] failed to load opportunity matching QA mode')
      },
      { once: true },
    )
    ;(document.head || document.documentElement).appendChild(script)
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
    wireMemberScopeAuthChange()
    initOpportunityCategorySelects()
    prepareOpportunityStatusControls()
    prepareOpportunityLoadingControls()
    wireModals()
    const p = location.pathname
    const normalizedPath = normalizedPagePath(p)
    if (normalizedPath === '/starter-dashboard') {
      decorateProjectCards()
      observeProjectCards()
      initStarterDashboardOpportunityMatch()
    }
    else if (normalizedPath === '/brand-dashboard') {
      decorateProjectCards()
      observeProjectCards()
      initProjectDashboardWorkflow('brand')
    }
    else if (p.includes('opportunities-details---brand-view')) initBrandDetail()
    else if (p.match(/^\/opportunities\/[^/]+\/?$/)) initOppDetailByRole()
    // Merged feed (bare /opportunities, launched 2026-07): matches neither the
    // detail regex above (needs a slug segment) nor the legacy *-view branches
    // below. Legacy branches stay until the old pages are retired.
    else if (/^\/opportunities\/?$/.test(p)) initMergedOppFeed()
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
    if (
      opportunityMatchDebugEnabled() &&
      (p.includes('starter-dashboard') || p.includes('opportunities-freelancer-view'))
    ) {
      loadOpportunityMatchDebug()
    }
    // /all-modals is the component-preview surface. Keep the authored invoice
    // modal interactive there without enabling it on any production Brand page.
    if (normalizedPath === '/all-modals') wireInvoiceWorkflow()
  }

  // The CDN script is loaded with `defer` on opportunity pages, so the modal
  // markup is available here before DOMContentLoaded. Claim the category
  // widgets now; the legacy component embed sees its run-once flag and skips.
  prepareDashboardProjectLazyDetails()
  prepareOpportunityForms()
  initOpportunityCategorySelects()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  // expose for debugging / manual calls in console
  window.Opp30 = {
    ...window.Opp30,
    API,
    ensureXanoToken,
    diagnoseFreelancerFeed,
    loginPathWithNext,
    routeGuardActive,
    routeGuardConfigured,
    waitForRouteGuardHandoff,
    redirectForeignBrandToFeed,
    hasCompletedQuiz,
    brandFreeHome,
    gateOrRedirect,
    gateByPlan,
    memberPlanRole,
    waitForMappedMemberRole,
    initMergedOppFeed,
    syncMergedNavbarRole,
    activateDeferredFeed,
    paintOpportunityDetail,
    paintCloseOpportunityModalTitle,
    paintOpportunityReviewSuccess,
    invoiceProjectContext,
    invoiceErrorMessage,
    formatInvoiceAmount,
    normalizeInvoiceAmount,
    openInvoiceModal,
    prepareInvoiceModal,
    paintInvoiceSuccess,
    requestInvoiceSubmit,
    invoiceSubmitControl,
    setInvoiceSubmitDisabled,
    projectActionIntent,
    projectContractIsViewable,
    projectContractPanelState,
    projectMutationFeedback,
    projectActionErrorMessage,
    formatProjectTimeline,
    prepareDashboardProjectLazyDetails,
    initProjectDashboardWorkflow,
    opportunityPath,
    pageOppId,
    waitForMemberstackDom,
    showCancelSuccess,
    showOpportunityError,
    prepareOpportunityCreateForms: prepareOpportunityForms,
    prepareOpportunityForms,
    prefillEditOpportunity,
    initOpportunityCategorySelects,
    readOpportunityForm,
    validateOpportunityPayload,
  }
})()
