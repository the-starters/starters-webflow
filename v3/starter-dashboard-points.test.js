const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./starter-dashboard-points.js')

const ATTR = 'data-points-element'
const selector = (name) => '[' + ATTR + '="' + name + '"]'

class FakeElement {
  constructor(name = '') {
    this.attributes = new Map()
    this.children = new Map()
    this.hidden = false
    this.name = name
    this.previousElementSibling = null
    this.style = {}
    this.textContent = ''
  }

  querySelector(value) {
    return this.children.get(value) || null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.get(name) || null
  }
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
  const rolePrefix = new FakeElement('role-prefix')
  const overallPrefix = new FakeElement('overall-prefix')
  elements['role-cohort-size'].previousElementSibling = rolePrefix
  elements['overall-cohort-size'].previousElementSibling = overallPrefix
  elements.rolePrefix = rolePrefix
  elements.overallPrefix = overallPrefix
  return { root, elements }
}

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
  assert.equal(elements['overall-cohort-size'].textContent, '703')
  assert.equal(elements['overall-cohort-size'].style.display, 'none')
  assert.equal(elements.overallPrefix.textContent, 'Starters Overall')
  assert.equal(elements['overall-tie'].style.display, 'none')
  assert.equal(elements['role-rank'].textContent, '6th/21')
  assert.equal(elements['role-label'].textContent, 'CMO')
  assert.equal(elements['role-label'].style.display, 'none')
  assert.equal(elements['role-cohort-size'].textContent, '21')
  assert.equal(elements['role-cohort-size'].style.display, 'none')
  assert.equal(elements.rolePrefix.textContent, 'CMO')
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
