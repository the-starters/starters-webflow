/**
 * Starter Dashboard 3.0 — Points and rank tile.
 *
 * Reads the authenticated Xano points summary and binds it to Designer-owned
 * markup. Xano remains authoritative for both the ledger total and rank.
 *
 * Designer wiring:
 *   data-points-element="root|loading|content|error|state-refreshing|
 *   state-ineligible|state-quarantined|state-missing-role|points|
 *   overall-card|overall-rank|overall-cohort-size|overall-tie|role-card|
 *   role-rank|role-label|role-cohort-size|role-tie"
 *
 * State copy and its containers are authored in Webflow. This controller only
 * binds authenticated values and selects which authored state is visible.
 */
;(function (global) {
  'use strict'

  const isCommonJs =
    typeof module !== 'undefined' && typeof module.exports !== 'undefined'
  if (!isCommonJs) {
    if (global.__startersDashboardPointsBooted) return
    global.__startersDashboardPointsBooted = true
  }

  const XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  const XANO_OPP_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30'
  const TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  const SUMMARY_PATH = '/starter/points/summary'
  const MEMBERSTACK_TIMEOUT_MS = 10000
  const ATTR = 'data-points-element'
  const selector = (name) => '[' + ATTR + '="' + name + '"]'
  const STATE_ELEMENTS = [
    'loading',
    'error',
    'state-refreshing',
    'state-ineligible',
    'state-quarantined',
    'state-missing-role',
  ]

  function number(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  function viewModel(summary) {
    const totalPoints = number(summary && summary.total_points) || 0
    const status = String((summary && summary.rank_status) || 'refreshing')
    const model = {
      totalPoints: totalPoints.toLocaleString(),
      status,
      overallRank: '',
      overallCohortSize: '',
      overallTied: false,
      roleRank: '',
      roleLabel: '',
      roleCohortSize: '',
      roleTied: false,
      stateElement: '',
      showRoleCard: true,
    }

    if (status === 'ready') {
      const overallRank = number(summary.overall_rank)
      const overallSize = number(summary.overall_cohort_size)
      if (overallRank && overallSize) {
        model.overallRank = '#' + overallRank
        model.overallCohortSize = overallSize.toLocaleString()
        model.overallTied = number(summary.overall_tie_count) > 1
      } else {
        model.status = 'refreshing'
        model.stateElement = 'state-refreshing'
        model.showRoleCard = false
        return model
      }

      const role = summary.primary_role
      if (role && number(role.rank) && number(role.cohort_size)) {
        model.roleRank = '#' + number(role.rank)
        model.roleLabel = String(role.label || 'Primary role')
        model.roleCohortSize = number(role.cohort_size).toLocaleString()
        model.roleTied = number(role.tie_count) > 1
      } else {
        model.stateElement = 'state-missing-role'
      }
      return model
    }

    if (status === 'ineligible') {
      model.stateElement = 'state-ineligible'
      model.showRoleCard = false
      return model
    }

    if (status === 'quarantined') {
      model.stateElement = 'state-quarantined'
      model.showRoleCard = false
      return model
    }

    model.stateElement = 'state-refreshing'
    model.showRoleCard = false
    return model
  }

  function find(root, name) {
    return root.querySelector(selector(name))
  }

  function show(element, visible) {
    if (!element) return
    element.hidden = !visible
    element.style.display = visible ? '' : 'none'
  }

  function text(root, name, value) {
    const element = find(root, name)
    if (element) element.textContent = value
  }

  function showState(root, activeName) {
    STATE_ELEMENTS.forEach(function (name) {
      show(find(root, name), name === activeName)
    })
  }

  function render(root, summary) {
    const model = viewModel(summary)
    showState(root, model.stateElement)
    show(find(root, 'content'), true)
    show(find(root, 'role-card'), model.showRoleCard)
    show(find(root, 'overall-card'), model.status === 'ready')
    show(find(root, 'overall-tie'), model.overallTied)
    show(find(root, 'role-tie'), model.showRoleCard && model.roleTied)
    text(root, 'points', model.totalPoints)
    text(root, 'overall-rank', model.overallRank)
    text(root, 'overall-cohort-size', model.overallCohortSize)
    text(root, 'role-rank', model.roleRank)
    text(root, 'role-label', model.roleLabel)
    text(root, 'role-cohort-size', model.roleCohortSize)
    root.setAttribute('data-points-status', model.status)
    root.setAttribute(
      'data-points-view',
      model.stateElement.replace(/^state-/, '') || 'ready',
    )
  }

  function clearDynamicFields(root) {
    show(find(root, 'role-card'), false)
    show(find(root, 'overall-card'), false)
    show(find(root, 'overall-tie'), false)
    show(find(root, 'role-tie'), false)
    text(root, 'points', '')
    text(root, 'overall-rank', '')
    text(root, 'overall-cohort-size', '')
    text(root, 'role-rank', '')
    text(root, 'role-label', '')
    text(root, 'role-cohort-size', '')
  }

  function renderLoading(root) {
    showState(root, 'loading')
    show(find(root, 'content'), false)
    clearDynamicFields(root)
    root.setAttribute('data-points-status', 'loading')
    root.setAttribute('data-points-view', 'loading')
  }

  function renderError(root) {
    showState(root, 'error')
    show(find(root, 'content'), false)
    clearDynamicFields(root)
    root.setAttribute('data-points-status', 'error')
    root.setAttribute('data-points-view', 'error')
  }

  function waitForMemberstackDom(timeoutMs = MEMBERSTACK_TIMEOUT_MS) {
    if (
      global.$memberstackDom &&
      typeof global.$memberstackDom.getMemberCookie === 'function'
    ) {
      return Promise.resolve(global.$memberstackDom)
    }

    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = global.setInterval(() => {
        if (
          global.$memberstackDom &&
          typeof global.$memberstackDom.getMemberCookie === 'function'
        ) {
          global.clearInterval(timer)
          resolve(global.$memberstackDom)
          return
        }

        if (Date.now() - startedAt >= timeoutMs) {
          global.clearInterval(timer)
          resolve(null)
        }
      }, 100)
    })
  }

  async function fetchSummary(memberstack) {
    const memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw new Error('No Memberstack session')

    const tradeResponse = await global.fetch(
      XANO_AUTH_BASE +
        TRADE_TOKEN_PATH +
        '?token=' +
        encodeURIComponent(memberstackToken),
    )
    const tradeData = await tradeResponse.json().catch(function () {
      return null
    })
    if (!tradeResponse.ok) throw new Error('Xano token trade failed')
    const xanoToken =
      typeof tradeData === 'string'
        ? tradeData
        : tradeData && (tradeData.authToken || tradeData.token)
    if (!xanoToken) throw new Error('Xano token trade returned no token')

    const response = await global.fetch(XANO_OPP_BASE + SUMMARY_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + xanoToken,
      },
      body: '{}',
    })
    const data = await response.json().catch(function () {
      return null
    })
    if (!response.ok || !data) throw new Error('Points summary request failed')
    return data
  }

  async function mount() {
    const roots = Array.prototype.slice.call(
      global.document.querySelectorAll(selector('root')),
    )
    if (!roots.length) return

    roots.forEach(renderLoading)

    const memberstack = await waitForMemberstackDom()
    if (!memberstack) {
      roots.forEach(renderError)
      return
    }

    try {
      const summary = await fetchSummary(memberstack)
      roots.forEach(function (root) {
        render(root, summary)
      })
    } catch (error) {
      roots.forEach(renderError)
      global.console.error(
        '[starter-dashboard] Unable to load points summary',
        error,
      )
    }
  }

  const testApi = {
    fetchSummary,
    mount,
    render,
    renderError,
    renderLoading,
    viewModel,
  }

  if (isCommonJs) {
    module.exports = testApi
    return
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
})(typeof window !== 'undefined' ? window : globalThis)
