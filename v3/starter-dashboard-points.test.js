const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./starter-dashboard-points.js')

const ATTR = 'data-points-element'
const selector = (name) => '[' + ATTR + '="' + name + '"]'

class FakeElement {
  constructor(name = '', tagName = 'div') {
    this.attributes = new Map()
    this.childNodes = []
    this.children = new Map()
    this.hidden = false
    this.name = name
    this.nodeType = 1
    this.parentElement = null
    this.previousElementSibling = null
    this.style = {}
    this.tagName = tagName.toUpperCase()
    this.textContent = ''
  }

  append(...nodes) {
    nodes.forEach((node) => {
      this.childNodes.push(node)
      if (node.nodeType === 1) node.parentElement = this
    })
  }

  querySelector(value) {
    const direct = this.children.get(value)
    if (direct) return direct
    return this.querySelectorAll(value)[0] || null
  }

  querySelectorAll(value) {
    const matches = []
    const attributeMatch = value.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
    const visit = (node) => {
      if (!node || node.nodeType !== 1) return
      const matchesTag = value === 'p' && node.tagName === 'P'
      const matchesAttribute =
        attributeMatch &&
        node.attributes.has(attributeMatch[1]) &&
        (attributeMatch[2] === undefined ||
          node.getAttribute(attributeMatch[1]) === attributeMatch[2])
      if (matchesTag || matchesAttribute) matches.push(node)
      node.childNodes.forEach(visit)
    }
    this.childNodes.forEach(visit)
    return matches
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.name, this.tagName)
    clone.hidden = this.hidden
    clone.style = { ...this.style }
    clone.textContent = this.textContent
    this.attributes.forEach((value, name) => clone.setAttribute(name, value))
    if (deep) clone.append(...this.childNodes.map((node) => node.cloneNode(true)))
    return clone
  }

  insertBefore(node, referenceNode) {
    const index = referenceNode ? this.childNodes.indexOf(referenceNode) : -1
    if (index === -1) this.childNodes.push(node)
    else this.childNodes.splice(index, 0, node)
    node.parentElement = this
  }

  get nextSibling() {
    if (!this.parentElement) return null
    const siblings = this.parentElement.childNodes
    return siblings[siblings.indexOf(this) + 1] || null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.get(name) || null
  }
}

class FakeText {
  constructor(value) {
    this.nodeType = 3
    this.textContent = value
  }

  cloneNode() {
    return new FakeText(this.textContent)
  }
}

function paragraph(value) {
  const element = new FakeElement('', 'p')
  element.textContent = value
  return element
}

function pointsRuleRow(label, points, unit, subtitle = '') {
  const row = new FakeElement('rule-row')
  const title = new FakeElement('rule-title')
  title.append(paragraph(label))
  if (subtitle) title.append(paragraph(subtitle))
  const body = new FakeElement('rule-body')
  body.append(paragraph(points))
  if (unit) body.append(paragraph(unit))
  row.append(title, body)
  return row
}

function pointsRulesFixture() {
  const dialog = new FakeElement('points-dialog', 'dialog')
  dialog.setAttribute('data-modal-target', 'how-to-earn-points')
  const headline = new FakeElement('headline')
  headline.append(
    paragraph('Planned earning rules. Automatic earning is not active yet.'),
  )
  const list = new FakeElement('rule-list')
  list.append(
    pointsRuleRow('Starting a new project with a brand', '+2,000', '/project'),
    pointsRuleRow(
      'Responding to initial brand outreach',
      '+1,000 / +500 / 0',
      '',
      'Within 24h / 72h / 7 days',
    ),
    pointsRuleRow('No response within 7 days', '-1,000', ''),
    pointsRuleRow(
      'Paid invoices through The Starters',
      '+1',
      '/dollar',
      'Per $1 paid · Coming soon',
    ),
    pointsRuleRow('Approved 4–5 star review', '+5,000', '/review'),
    pointsRuleRow('Approved 1–3 star review', '-5,000', '/review'),
  )
  dialog.append(headline, list)
  const document = {
    querySelector(value) {
      return value === '[data-modal-target="how-to-earn-points"]'
        ? dialog
        : null
    },
  }
  return { dialog, document, list }
}

function visibleText(node) {
  if (node.nodeType === 3) return node.textContent
  if (node.hidden || node.style.display === 'none') return ''
  if (!node.childNodes.length) return node.textContent
  return node.childNodes.map(visibleText).join('')
}

function tile(options = {}) {
  const root = new FakeElement('root')
  const omitted = new Set(options.omit || [])
  const names = [
    'loading',
    'content',
    'error',
    'state-refreshing',
    'state-ineligible',
    'state-quarantined',
    'state-missing-role',
    'points',
    'overall-card',
    'overall-rank',
    'overall-cohort-size',
    'overall-tie',
    'role-card',
    'role-rank',
    'role-label',
    'role-cohort-size',
    'role-tie',
  ]
  const elements = Object.fromEntries(
    names.map((name) => [name, new FakeElement(name)]),
  )
  for (const [name, element] of Object.entries(elements)) {
    if (!omitted.has(name)) root.children.set(selector(name), element)
  }
  const roleRow = new FakeElement('role-row')
  const rolePrefix = new FakeElement('role-prefix')
  rolePrefix.textContent = 'Out of '
  const roleSuffix = new FakeElement('role-suffix')
  roleSuffix.textContent = ' eligible Starters'
  roleRow.append(rolePrefix, elements['role-cohort-size'], roleSuffix)

  const overallRow = new FakeElement('overall-row')
  const overallPrefix = new FakeText('Out of ')
  const overallSuffix = new FakeText(' eligible Starters')
  overallRow.append(
    overallPrefix,
    elements['overall-cohort-size'],
    overallSuffix,
  )

  elements.roleRow = roleRow
  elements.rolePrefix = rolePrefix
  elements.roleSuffix = roleSuffix
  elements.overallRow = overallRow
  elements.overallPrefix = overallPrefix
  elements.overallSuffix = overallSuffix
  return { root, elements }
}

test('earning rules become active and include one completed-call row', () => {
  const { dialog, document, list } = pointsRulesFixture()

  const result = api.syncEarningRules(document)
  const copy = dialog.querySelectorAll('p').map((item) => item.textContent)

  assert.deepEqual(result, {
    status: 'current',
    insertedCallRow: true,
    ruleRowCount: 7,
  })
  assert.equal(
    dialog.getAttribute('data-points-rules-version'),
    '2026-09-09',
  )
  assert.equal(list.childNodes.length, 7)
  assert.equal(
    list.childNodes[1].querySelectorAll('p')[0].textContent,
    'Completed free or paid call',
  )
  assert.equal(
    list.childNodes[1].getAttribute('data-points-rule'),
    'call-completed',
  )
  assert.ok(
    copy.includes(
      'Active points rules update automatically after each eligible activity is verified.',
    ),
  )
  assert.ok(copy.includes('Under 24h / 24h to under 72h / 72h to 7 days'))
  assert.ok(copy.includes('Verified paid invoices through The Starters'))
  assert.ok(copy.includes('Per verified $1 paid'))
  assert.ok(copy.includes('Approved 5-star / 4-star review'))
  assert.ok(copy.includes('+5,000 / 0'))
  assert.ok(copy.includes('/completed call'))
  assert.equal(copy.includes('Coming soon'), false)
})

test('earning-rule synchronization is idempotent', () => {
  const { dialog, document, list } = pointsRulesFixture()

  api.syncEarningRules(document)
  const result = api.syncEarningRules(document)

  assert.deepEqual(result, {
    status: 'current',
    insertedCallRow: false,
    ruleRowCount: 7,
  })
  assert.equal(list.childNodes.length, 7)
  assert.equal(
    dialog
      .querySelectorAll('[data-points-rule="call-completed"]')
      .length,
    1,
  )
})

test('ready state renders compact rank positions and clear sublines', () => {
  const { root, elements } = tile()

  api.render(root, {
    total_points: 12500,
    rank_status: 'ready',
    overall_rank: 284,
    overall_cohort_size: 703,
    overall_tie_count: 3,
    primary_role: {
      label: 'CMO',
      rank: 6,
      cohort_size: 21,
      tie_count: 2,
    },
  })

  assert.equal(root.getAttribute('data-points-status'), 'ready')
  assert.equal(elements.points.textContent, '12,500')
  assert.equal(elements['overall-rank'].textContent, '284th/703')
  assert.equal(elements['overall-cohort-size'].textContent, 'Starters Overall')
  assert.equal(elements['overall-cohort-size'].style.display, '')
  assert.equal(visibleText(elements.overallRow), 'Starters Overall')
  assert.deepEqual(elements.overallRow.childNodes, [
    elements.overallPrefix,
    elements['overall-cohort-size'],
    elements.overallSuffix,
  ])
  assert.equal(elements['overall-tie'].style.display, 'none')
  assert.equal(elements['role-rank'].textContent, '6th/21')
  assert.equal(elements['role-label'].textContent, 'CMO')
  assert.equal(elements['role-label'].style.display, 'none')
  assert.equal(elements['role-cohort-size'].textContent, 'CMO')
  assert.equal(elements['role-cohort-size'].style.display, '')
  assert.equal(visibleText(elements.roleRow), 'CMO')
  assert.deepEqual(elements.roleRow.childNodes, [
    elements.rolePrefix,
    elements['role-cohort-size'],
    elements.roleSuffix,
  ])
  assert.equal(elements['role-tie'].style.display, 'none')
  assert.equal(elements.loading.style.display, 'none')
  assert.equal(elements.error.style.display, 'none')
  assert.equal(elements['state-refreshing'].style.display, 'none')
  assert.equal(elements.content.style.display, '')
  assert.equal(elements['role-card'].style.display, '')
  assert.equal(elements['overall-card'].style.display, '')
  assert.equal(root.getAttribute('data-overall-tied'), 'true')
  assert.equal(root.getAttribute('data-role-tied'), 'true')
  assert.equal(root.getAttribute('data-points-view'), 'ready')
})

test('ready state hides authored tie labels regardless of tie count', () => {
  const { root, elements } = tile()
  elements['overall-tie'].textContent = 'Tied'
  elements['role-tie'].textContent = 'Tied'

  api.render(root, {
    total_points: 12500,
    rank_status: 'ready',
    overall_rank: 12,
    overall_cohort_size: 680,
    overall_tie_count: 1,
    primary_role: {
      label: 'CMO',
      rank: 3,
      cohort_size: 48,
      tie_count: 1,
    },
  })

  assert.equal(elements['overall-tie'].style.display, 'none')
  assert.equal(elements['role-tie'].style.display, 'none')
  assert.equal(elements['overall-tie'].textContent, 'Tied')
  assert.equal(elements['role-tie'].textContent, 'Tied')
})

test('position formatting handles ordinal suffix exceptions', () => {
  assert.equal(api.position(1, 21), '1st/21')
  assert.equal(api.position(2, 21), '2nd/21')
  assert.equal(api.position(3, 21), '3rd/21')
  assert.equal(api.position(11, 703), '11th/703')
  assert.equal(api.position(12, 703), '12th/703')
  assert.equal(api.position(13, 703), '13th/703')
  assert.equal(api.position(21, 703), '21st/703')
  assert.equal(api.position(284, 703), '284th/703')
})

test('refreshing state keeps points visible and reveals authored guidance', () => {
  const { root, elements } = tile()
  elements['state-refreshing'].textContent =
    'Your position will appear shortly.'

  api.render(root, {
    total_points: 500,
    rank_status: 'refreshing',
  })

  assert.equal(root.getAttribute('data-points-status'), 'refreshing')
  assert.equal(elements.points.textContent, '500')
  assert.equal(elements['overall-rank'].textContent, '')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(elements['overall-card'].style.display, 'none')
  assert.equal(elements['overall-tie'].style.display, 'none')
  assert.equal(elements['role-tie'].style.display, 'none')
  assert.equal(elements['state-refreshing'].style.display, '')
  assert.equal(
    elements['state-refreshing'].textContent,
    'Your position will appear shortly.',
  )
})

test('a stale ready payload degrades to refreshing instead of showing N/A', () => {
  const { root, elements } = tile()

  api.render(root, {
    total_points: 1000,
    rank_status: 'ready',
    overall_rank: null,
    overall_cohort_size: null,
  })

  assert.equal(root.getAttribute('data-points-status'), 'refreshing')
  assert.equal(elements['overall-rank'].textContent, '')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(elements['state-refreshing'].style.display, '')
  assert.equal(
    Object.values(elements).some((element) => element.textContent === 'N/A'),
    false,
  )
})

test('ineligible state reveals Webflow-authored profile guidance unchanged', () => {
  const { root, elements } = tile()
  elements['state-ineligible'].textContent =
    'Complete your profile to join rankings.'

  api.render(root, {
    total_points: 1000,
    rank_status: 'ineligible',
  })

  assert.equal(root.getAttribute('data-points-status'), 'ineligible')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(elements['overall-card'].style.display, 'none')
  assert.equal(elements['state-ineligible'].style.display, '')
  assert.equal(
    elements['state-ineligible'].textContent,
    'Complete your profile to join rankings.',
  )
})

test('quarantined state reveals Webflow-authored reconciliation copy', () => {
  const { root, elements } = tile()
  elements['state-quarantined'].textContent =
    'We are reconciling your points history.'

  api.render(root, {
    total_points: 1000,
    rank_status: 'quarantined',
  })

  assert.equal(root.getAttribute('data-points-status'), 'quarantined')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(elements['overall-card'].style.display, 'none')
  assert.equal(elements['state-quarantined'].style.display, '')
  assert.equal(
    elements['state-quarantined'].textContent,
    'We are reconciling your points history.',
  )
})

test('missing primary role keeps overall rank and shows setup guidance', () => {
  const { root, elements } = tile()
  elements['state-missing-role'].textContent =
    'Choose a primary role to see your role rank.'

  api.render(root, {
    total_points: 0,
    rank_status: 'ready',
    overall_rank: 600,
    overall_cohort_size: 680,
    primary_role: null,
  })

  assert.equal(root.getAttribute('data-points-status'), 'ready')
  assert.equal(root.getAttribute('data-points-view'), 'missing-role')
  assert.equal(elements['overall-rank'].textContent, '600th/680')
  assert.equal(elements['role-card'].style.display, '')
  assert.equal(elements['role-rank'].textContent, '')
  assert.equal(elements['role-label'].textContent, '')
  assert.equal(elements['state-missing-role'].style.display, '')
  assert.equal(
    elements['state-missing-role'].textContent,
    'Choose a primary role to see your role rank.',
  )
})

test('consult-only profile shows overall rank only, without role guidance', () => {
  const { root, elements } = tile()
  elements['state-missing-role'].textContent =
    'Choose a primary role to see your role rank.'

  api.render(root, {
    total_points: 0,
    rank_status: 'ready',
    overall_rank: 538,
    overall_cohort_size: 713,
    primary_role: null,
    consult_only: true,
  })

  assert.equal(root.getAttribute('data-points-status'), 'ready')
  assert.equal(root.getAttribute('data-points-view'), 'ready')
  assert.equal(root.getAttribute('data-consult-only'), 'true')
  assert.equal(elements['overall-rank'].textContent, '538th/713')
  assert.equal(elements['overall-card'].style.display, '')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(elements['state-missing-role'].style.display, 'none')
})

test('consult-only flag does not change the other rank states', () => {
  const { root, elements } = tile()

  api.render(root, {
    total_points: 250,
    rank_status: 'refreshing',
    consult_only: true,
  })

  assert.equal(root.getAttribute('data-points-status'), 'refreshing')
  assert.equal(root.getAttribute('data-consult-only'), 'true')
  assert.equal(elements['state-refreshing'].style.display, '')
  assert.equal(elements['role-card'].style.display, 'none')
})

test('non-consult profile without a role keeps the setup guidance', () => {
  const { root, elements } = tile()
  elements['state-missing-role'].textContent =
    'Choose a primary role to see your role rank.'

  api.render(root, {
    total_points: 0,
    rank_status: 'ready',
    overall_rank: 600,
    overall_cohort_size: 680,
    primary_role: null,
    consult_only: false,
  })

  assert.equal(root.getAttribute('data-points-view'), 'missing-role')
  assert.equal(root.getAttribute('data-consult-only'), 'false')
  assert.equal(elements['state-missing-role'].style.display, '')
})

test('error state hides content and reveals Designer-owned error markup', () => {
  const { root, elements } = tile()

  api.renderError(root)

  assert.equal(root.getAttribute('data-points-status'), 'error')
  assert.equal(root.getAttribute('data-points-view'), 'error')
  assert.equal(elements.loading.style.display, 'none')
  assert.equal(elements.content.style.display, 'none')
  assert.equal(elements.error.style.display, '')
})

test('loading clears dynamic values without writing status copy', () => {
  const { root, elements } = tile()
  elements.loading.textContent = 'Loading your points...'
  elements.points.textContent = '16,525'
  elements['overall-rank'].textContent = '#75'
  elements['overall-cohort-size'].textContent = '629'
  elements['role-rank'].textContent = '#7'
  elements['role-label'].textContent = 'CMO'

  api.renderLoading(root)

  assert.equal(root.getAttribute('data-points-status'), 'loading')
  assert.equal(elements.points.textContent, '')
  assert.equal(elements['overall-rank'].textContent, '')
  assert.equal(elements['overall-cohort-size'].textContent, '')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(elements['overall-card'].style.display, 'none')
  assert.equal(elements.loading.style.display, '')
  assert.equal(elements.loading.textContent, 'Loading your points...')
})

test('error clears dynamic values without writing status copy', () => {
  const { root, elements } = tile()
  elements.error.textContent = 'Points are temporarily unavailable.'
  elements.points.textContent = '16,525'
  elements['overall-rank'].textContent = '#75'

  api.renderError(root)

  assert.equal(root.getAttribute('data-points-status'), 'error')
  assert.equal(elements.points.textContent, '')
  assert.equal(elements['overall-rank'].textContent, '')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(elements['overall-card'].style.display, 'none')
  assert.equal(elements.error.style.display, '')
  assert.equal(
    elements.error.textContent,
    'Points are temporarily unavailable.',
  )
})

test('summary fetch trades the Memberstack token and sends Xano auth', async () => {
  const requests = []
  const previousFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (requests.length === 1) {
      return {
        ok: true,
        json: async () => ({ authToken: 'xano-test-token' }),
      }
    }
    return {
      ok: true,
      json: async () => ({
        total_points: 32000,
        rank_status: 'ready',
        overall_rank: 32,
        overall_cohort_size: 680,
      }),
    }
  }

  try {
    const result = await api.fetchSummary({
      getMemberCookie: async () => 'memberstack-test-token',
    })

    assert.equal(result.overall_rank, 32)
    assert.equal(requests.length, 2)
    assert.match(requests[0].url, /auth\/trade-token\/v3\?token=/)
    assert.equal(
      requests[1].url,
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/starter/points/summary',
    )
    assert.equal(requests[1].options.method, 'POST')
    assert.equal(requests[1].options.body, '{}')
    assert.equal(
      requests[1].options.headers.Authorization,
      'Bearer xano-test-token',
    )
  } finally {
    global.fetch = previousFetch
  }
})

test('summary fetch reuses the shared dashboard Xano token', async () => {
  const requests = []
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return {
      ok: true,
      json: async () => ({
        total_points: 32000,
        rank_status: 'ready',
        overall_rank: 32,
        overall_cohort_size: 680,
      }),
    }
  }

  try {
    const result = await api.fetchSummary({
      getMemberCookie: async () => {
        throw new Error('local Memberstack trade should not run')
      },
    })

    assert.equal(result.overall_rank, 32)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].options.headers.Authorization, 'Bearer shared-xano-token')
  } finally {
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})

test('refreshing summary is polled until the role rank is ready', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  const responses = [
    { total_points: 0, rank_status: 'refreshing' },
    {
      total_points: 0,
      rank_status: 'ready',
      overall_rank: 541,
      overall_cohort_size: 720,
      primary_role: {
        label: 'AI Automation Expert',
        rank: 9,
        cohort_size: 10,
      },
    },
  ]
  const rendered = []
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async () => ({
    ok: true,
    json: async () => responses.shift(),
  })

  try {
    const result = await api.fetchSummaryUntilTerminal(
      {},
      (summary) => rendered.push(summary.rank_status),
      { intervalMs: 0, maxAttempts: 3 },
    )

    assert.deepEqual(rendered, ['refreshing', 'ready'])
    assert.equal(result.primary_role.label, 'AI Automation Expert')
  } finally {
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})

test('summary polling is bounded while refreshing persists', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  let requestCount = 0
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async () => {
    requestCount += 1
    return {
      ok: true,
      json: async () => ({ total_points: 0, rank_status: 'refreshing' }),
    }
  }

  try {
    const result = await api.fetchSummaryUntilTerminal({}, () => {}, {
      intervalMs: 0,
      maxAttempts: 3,
    })

    assert.equal(requestCount, 3)
    assert.equal(result.rank_status, 'refreshing')
  } finally {
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})
