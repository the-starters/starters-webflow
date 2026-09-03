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
 *   role-rank|role-label|role-cohort-size|role-tie|rank-message"
 *
 * State copy and its containers are authored in Webflow. This controller binds
 * authenticated values, formats compact rank positions, and selects which
 * authored state is visible.
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
  const SUMMARY_REFRESH_INTERVAL_MS = 10000
  const SUMMARY_REFRESH_MAX_ATTEMPTS = 60
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

  function ordinal(value) {
    const rank = number(value)
    if (!rank) return ''
    const remainder100 = rank % 100
    const remainder10 = rank % 10
    const suffix =
      remainder100 >= 11 && remainder100 <= 13
        ? 'th'
        : remainder10 === 1
          ? 'st'
          : remainder10 === 2
            ? 'nd'
            : remainder10 === 3
              ? 'rd'
              : 'th'
    return rank.toLocaleString() + suffix
  }

  function position(rank, cohortSize) {
    const cohort = number(cohortSize)
    const ranked = ordinal(rank)
    if (!ranked || !cohort) return ''
    return ranked + '/' + cohort.toLocaleString()
  }

  function viewModel(summary) {
    const totalPoints = number(summary && summary.total_points) || 0
    const status = String((summary && summary.rank_status) || 'refreshing')
    const consultOnly = Boolean(summary && summary.consult_only)
    const model = {
      totalPoints: totalPoints.toLocaleString(),
      status,
      consultOnly,
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
        model.overallRank = position(overallRank, overallSize)
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
        model.roleRank = position(role.rank, role.cohort_size)
        model.roleLabel = String(role.label || 'Primary role')
        model.roleCohortSize = number(role.cohort_size).toLocaleString()
        model.roleTied = number(role.tie_count) > 1
      } else if (consultOnly) {
        // Consult-only profiles have no primary role by design. The overall
        // rank is their single rank; never prompt them to set a role.
        model.showRoleCard = false
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

  function subline(root, cohortName, value) {
    const cohort = find(root, cohortName)
    if (!cohort) return

    const row = cohort.parentElement
    if (row) {
      Array.prototype.forEach.call(row.childNodes, function (node) {
        if (node === cohort) return
        if (node.nodeType === 1) show(node, false)
        else if (node.nodeType === 3) node.textContent = ''
      })
    }

    cohort.textContent = value
    show(cohort, Boolean(value))
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
    show(find(root, 'overall-tie'), false)
    show(find(root, 'role-tie'), false)
    show(find(root, 'role-label'), false)
    show(find(root, 'rank-message'), false)
    text(root, 'points', model.totalPoints)
    text(root, 'overall-rank', model.overallRank)
    text(root, 'overall-cohort-size', model.overallCohortSize)
    text(root, 'role-rank', model.roleRank)
    text(root, 'role-label', model.roleLabel)
    text(root, 'role-cohort-size', model.roleCohortSize)
    subline(root, 'overall-cohort-size', 'Starters Overall')
    subline(root, 'role-cohort-size', model.roleLabel)
    root.setAttribute('data-points-status', model.status)
    root.setAttribute('data-consult-only', String(model.consultOnly))
    root.setAttribute('data-overall-tied', String(model.overallTied))
    root.setAttribute('data-role-tied', String(model.roleTied))
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
    let xanoToken
    if (typeof global.getXanoAuthToken === 'function') {
      xanoToken = await global.getXanoAuthToken()
      if (!xanoToken) throw new Error('Shared Xano auth bridge returned no token')
    } else {
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
      xanoToken =
        typeof tradeData === 'string'
          ? tradeData
          : tradeData && (tradeData.authToken || tradeData.token)
      if (!xanoToken) throw new Error('Xano token trade returned no token')
    }

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

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      global.setTimeout(resolve, milliseconds)
    })
  }

  async function fetchSummaryUntilTerminal(memberstack, onSummary, options) {
    const settings = options || {}
    const intervalMs =
      Number.isFinite(settings.intervalMs) && settings.intervalMs >= 0
        ? settings.intervalMs
        : SUMMARY_REFRESH_INTERVAL_MS
    const maxAttempts =
      Number.isInteger(settings.maxAttempts) && settings.maxAttempts > 0
        ? settings.maxAttempts
        : SUMMARY_REFRESH_MAX_ATTEMPTS
    let summary = null

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      summary = await fetchSummary(memberstack)
      onSummary(summary)
      if (viewModel(summary).status !== 'refreshing') return summary
      if (attempt + 1 < maxAttempts) await wait(intervalMs)
    }

    return summary
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
      await fetchSummaryUntilTerminal(memberstack, function (summary) {
        roots.forEach(function (root) {
          render(root, summary)
        })
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
    fetchSummaryUntilTerminal,
    mount,
    ordinal,
    position,
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
