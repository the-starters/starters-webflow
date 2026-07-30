/**
 * Starter Dashboard 3.0 — Points and rank tile.
 *
 * Reads the authenticated Xano points summary and binds it to Designer-owned
 * markup. Xano remains authoritative for both the ledger total and rank.
 *
 * Designer wiring:
 *   data-points-element="root|loading|content|error|points|overall-rank|
 *   overall-cohort|role-card|role-rank|role-label|role-cohort|rank-message"
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
      overallCohort: '',
      roleRank: '',
      roleLabel: '',
      roleCohort: '',
      rankMessage: '',
      showRoleCard: true,
    }

    if (status === 'ready') {
      const overallRank = number(summary.overall_rank)
      const overallSize = number(summary.overall_cohort_size)
      if (overallRank && overallSize) {
        model.overallRank = '#' + overallRank
        model.overallCohort =
          'Out of ' + overallSize.toLocaleString() + ' eligible Starters'
      } else {
        model.status = 'refreshing'
        model.rankMessage = 'Your position will appear shortly.'
        model.showRoleCard = false
        return model
      }

      const role = summary.primary_role
      if (role && number(role.rank) && number(role.cohort_size)) {
        model.roleRank = '#' + number(role.rank)
        model.roleLabel = String(role.label || 'Primary role') + ' Rank'
        model.roleCohort =
          'Out of ' + number(role.cohort_size).toLocaleString() + ' in this role'
      } else {
        model.roleLabel = 'Set a primary role'
        model.roleCohort = 'Choose one to see your role rank.'
      }
      return model
    }

    if (status === 'ineligible') {
      model.rankMessage = 'Complete your profile to join rankings.'
      model.showRoleCard = false
      return model
    }

    if (status === 'quarantined') {
      model.rankMessage = 'We are reconciling your points history.'
      model.showRoleCard = false
      return model
    }

    model.rankMessage = 'Your position will appear shortly.'
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

  function render(root, summary) {
    const model = viewModel(summary)
    show(find(root, 'loading'), false)
    show(find(root, 'error'), false)
    show(find(root, 'content'), true)
    show(find(root, 'role-card'), model.showRoleCard)
    text(root, 'points', model.totalPoints)
    text(root, 'overall-rank', model.overallRank)
    text(root, 'overall-cohort', model.overallCohort)
    text(root, 'role-rank', model.roleRank)
    text(root, 'role-label', model.roleLabel)
    text(root, 'role-cohort', model.roleCohort)
    text(root, 'rank-message', model.rankMessage)
    root.setAttribute('data-points-status', model.status)
  }

  function renderError(root) {
    show(find(root, 'loading'), false)
    show(find(root, 'content'), false)
    show(find(root, 'error'), true)
    root.setAttribute('data-points-status', 'error')
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

    roots.forEach(function (root) {
      show(find(root, 'loading'), true)
      show(find(root, 'content'), false)
      show(find(root, 'error'), false)
    })

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
