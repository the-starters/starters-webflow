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

function tile() {
  const root = new FakeElement('root')
  const names = [
    'loading',
    'content',
    'error',
    'points',
    'overall-rank',
    'overall-cohort',
    'role-card',
    'role-rank',
    'role-label',
    'role-cohort',
    'rank-message',
  ]
  const elements = Object.fromEntries(
    names.map((name) => [name, new FakeElement(name)]),
  )
  for (const [name, element] of Object.entries(elements)) {
    root.children.set(selector(name), element)
  }
  return { root, elements }
}

test('ready state renders points plus overall and primary-role ranks', () => {
  const { root, elements } = tile()

  api.render(root, {
    total_points: 12500,
    rank_status: 'ready',
    overall_rank: 12,
    overall_cohort_size: 680,
    primary_role: {
      label: 'CMO',
      rank: 3,
      cohort_size: 48,
    },
  })

  assert.equal(root.getAttribute('data-points-status'), 'ready')
  assert.equal(elements.points.textContent, '12,500')
  assert.equal(elements['overall-rank'].textContent, '#12')
  assert.equal(
    elements['overall-cohort'].textContent,
    'Out of 680 eligible Starters',
  )
  assert.equal(elements['role-rank'].textContent, '#3')
  assert.equal(elements['role-label'].textContent, 'CMO Rank')
  assert.equal(elements['role-cohort'].textContent, 'Out of 48 in this role')
  assert.equal(elements.loading.style.display, 'none')
  assert.equal(elements.error.style.display, 'none')
  assert.equal(elements.content.style.display, '')
  assert.equal(elements['role-card'].style.display, '')
})

test('refreshing state keeps points visible and withholds rank', () => {
  const { root, elements } = tile()

  api.render(root, {
    total_points: 500,
    rank_status: 'refreshing',
  })

  assert.equal(root.getAttribute('data-points-status'), 'refreshing')
  assert.equal(elements.points.textContent, '500')
  assert.equal(elements['overall-rank'].textContent, '')
  assert.equal(
    elements['rank-message'].textContent,
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
  assert.equal(
    elements['rank-message'].textContent,
    'Your position will appear shortly.',
  )
  assert.equal(
    Object.values(elements).some((element) => element.textContent === 'N/A'),
    false,
  )
})

test('ineligible state hides the role card and shows profile guidance', () => {
  const { root, elements } = tile()

  api.render(root, {
    total_points: 1000,
    rank_status: 'ineligible',
  })

  assert.equal(root.getAttribute('data-points-status'), 'ineligible')
  assert.equal(elements['role-card'].style.display, 'none')
  assert.equal(
    elements['rank-message'].textContent,
    'Complete your profile to join rankings.',
  )
})

test('missing primary role keeps overall rank and shows setup guidance', () => {
  const { root, elements } = tile()

  api.render(root, {
    total_points: 0,
    rank_status: 'ready',
    overall_rank: 600,
    overall_cohort_size: 680,
    primary_role: null,
  })

  assert.equal(root.getAttribute('data-points-status'), 'ready')
  assert.equal(elements['overall-rank'].textContent, '#600')
  assert.equal(elements['role-rank'].textContent, '')
  assert.equal(elements['role-label'].textContent, 'Set a primary role')
  assert.equal(
    elements['role-cohort'].textContent,
    'Choose one to see your role rank.',
  )
})

test('error state hides content and reveals Designer-owned error markup', () => {
  const { root, elements } = tile()

  api.renderError(root)

  assert.equal(root.getAttribute('data-points-status'), 'error')
  assert.equal(elements.loading.style.display, 'none')
  assert.equal(elements.content.style.display, 'none')
  assert.equal(elements.error.style.display, '')
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
