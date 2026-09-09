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
 * authored state is visible. The earning-rules dialog currently has no native
 * custom attributes on its rows. Until those attributes can be added through
 * Webflow's headless element builder, this controller also normalizes that one
 * dialog from its exact authored labels and stamps stable runtime attributes.
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
  const POINTS_RULES_VERSION = '2026-09-09'
  const POINTS_DIALOG_SELECTOR =
    '[data-modal-target="how-to-earn-points"]'
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

  function normalizedText(element) {
    return String((element && element.textContent) || '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function paragraphByText(scope, acceptedText) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return null
    const accepted = Array.isArray(acceptedText) ? acceptedText : [acceptedText]
    return (
      Array.prototype.find.call(
        scope.querySelectorAll('p'),
        function (item) {
          return accepted.includes(normalizedText(item))
        },
      ) || null
    )
  }

  function ruleRow(dialog, labels) {
    const label = paragraphByText(dialog, labels)
    const titleWrapper = label && label.parentElement
    const row = titleWrapper && titleWrapper.parentElement
    return row && row.parentElement ? row : null
  }

  function replaceParagraphText(scope, acceptedText, nextText) {
    const paragraph = paragraphByText(scope, acceptedText)
    if (!paragraph) return false
    paragraph.textContent = nextText
    return true
  }

  function syncEarningRules(documentRoot) {
    if (!documentRoot || typeof documentRoot.querySelector !== 'function') {
      return { status: 'missing-document', insertedCallRow: false }
    }

    const dialog = documentRoot.querySelector(POINTS_DIALOG_SELECTOR)
    if (!dialog) return { status: 'missing-dialog', insertedCallRow: false }

    const projectRow = ruleRow(dialog, 'Starting a new project with a brand')
    let callRow = ruleRow(dialog, 'Completed free or paid call')
    let insertedCallRow = false

    if (!callRow && projectRow && typeof projectRow.cloneNode === 'function') {
      callRow = projectRow.cloneNode(true)
      const label = paragraphByText(
        callRow,
        'Starting a new project with a brand',
      )
      const points = paragraphByText(callRow, '+2,000')
      const unit = paragraphByText(callRow, '/project')
      if (label && points && unit) {
        label.textContent = 'Completed free or paid call'
        points.textContent = '+2,000'
        unit.textContent = '/completed call'
        projectRow.parentElement.insertBefore(callRow, projectRow.nextSibling)
        insertedCallRow = true
      } else {
        callRow = null
      }
    }

    const rowLabels = [
      ['Starting a new project with a brand', 'project-start'],
      ['Completed free or paid call', 'call-completed'],
      ['Responding to initial brand outreach', 'initial-response'],
      ['No response within 7 days', 'response-expired'],
      [
        [
          'Paid invoices through The Starters',
          'Verified paid invoices through The Starters',
        ],
        'invoice-paid',
      ],
      [
        ['Approved 4–5 star review', 'Approved 5-star / 4-star review'],
        'review-five-four',
      ],
      ['Approved 1–3 star review', 'review-one-three'],
    ]
    rowLabels.forEach(function (entry) {
      const row = ruleRow(dialog, entry[0])
      if (row) row.setAttribute('data-points-rule', entry[1])
    })

    replaceParagraphText(
      dialog,
      [
        'Planned earning rules. Automatic earning is not active yet.',
        'Active points rules update automatically after each eligible activity is verified.',
      ],
      'Active points rules update automatically after each eligible activity is verified.',
    )
    replaceParagraphText(
      dialog,
      [
        'Within 24h / 72h / 7 days',
        'Within 24h / 24–72h / 72h–7 days',
        'Under 24h / 24h to under 72h / 72h to 7 days',
      ],
      'Under 24h / 24h to under 72h / 72h to 7 days',
    )
    replaceParagraphText(
      dialog,
      ['Paid invoices through The Starters', 'Verified paid invoices through The Starters'],
      'Verified paid invoices through The Starters',
    )
    replaceParagraphText(
      dialog,
      ['Per $1 paid · Coming soon', 'Per verified $1 paid'],
      'Per verified $1 paid',
    )
    replaceParagraphText(
      dialog,
      ['Approved 4–5 star review', 'Approved 5-star / 4-star review'],
      'Approved 5-star / 4-star review',
    )
    replaceParagraphText(dialog, ['+5,000', '+5,000 / 0'], '+5,000 / 0')

    dialog.setAttribute('data-points-rules-version', POINTS_RULES_VERSION)
    return {
      status: callRow ? 'current' : 'missing-call-row-template',
      insertedCallRow,
      ruleRowCount: dialog.querySelectorAll('[data-points-rule]').length,
    }
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
    syncEarningRules(global.document)
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
    syncEarningRules,
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
