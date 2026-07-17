const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'opportunities-3.0-debug.js'), 'utf8')

function loadDebugModule(options = {}) {
  const documentElement = {
    appendChild() {},
    setAttribute() {},
  }
  const document = {
    documentElement,
    getElementById: () => null,
    head: documentElement,
    querySelector: () => null,
    querySelectorAll: options.querySelectorAll || (() => []),
  }
  const window = {
    Opp30: {},
    Opp30MatchDebugBridge: {
      API: {},
      contextValue: () => null,
      filterValues: (values) =>
        (Array.isArray(values) ? values : [])
          .map(String)
          .map((value) => value.trim())
          .filter(Boolean),
      getTalentMatchContext: () => new Promise(() => {}),
      memberScopeResetEvent: 'opp30:member-scope-reset',
    },
    addEventListener() {},
    lil: { GUI: class GUI {} },
  }
  window.window = window
  const context = vm.createContext({
    URL,
    console,
    document,
    location: {
      href: 'https://example.test/starter-dashboard?opp_debug=1',
      pathname: options.pathname || '/starter-dashboard',
    },
    window,
  })
  vm.runInContext(source, context)
  return window.Opp30
}

test('freelancer feed targets talent-opps instead of the global search results', () => {
  const talentRoot = { querySelector: () => null }
  const hiddenGlobalSearchRoot = { querySelector: () => null }
  const debug = loadDebugModule({
    pathname: '/opportunities-freelancer-view',
    querySelectorAll: (selector) => {
      if (selector === '[wf-xano-instance="talent-opps"]') return [talentRoot]
      if (selector === '[wf-algolia-element="results"]') return [hiddenGlobalSearchRoot]
      return []
    },
  })

  const roots = debug.findOpportunityMatchCardRoots()
  assert.equal(roots.length, 1)
  assert.equal(roots[0], talentRoot)
})

test('Algolia fallback ignores a global search root without opportunity cards', () => {
  const hiddenGlobalSearchRoot = { querySelector: () => null }
  const opportunityRoot = {
    querySelector: (selector) => (selector === '.opportunity-card' ? {} : null),
  }
  const debug = loadDebugModule({
    pathname: '/opportunities-freelancer-view',
    querySelectorAll: (selector) => {
      if (selector === '[wf-xano-instance="talent-opps"]') return []
      if (selector === '[wf-algolia-element="results"]') {
        return [hiddenGlobalSearchRoot, opportunityRoot]
      }
      return []
    },
  })

  const roots = debug.findOpportunityMatchCardRoots()
  assert.equal(roots.length, 1)
  assert.equal(roots[0], opportunityRoot)
})

function dashboardCard(attributes, href) {
  const root = {}
  const link = {
    getAttribute: (name) => (name === 'href' ? href : null),
  }
  return {
    closest(selector) {
      return selector === '[wf-xano-instance="dash-applied-opps"]' ? root : null
    },
    getAttribute: (name) => attributes[name] || null,
    hasAttribute: (name) => Object.hasOwn(attributes, name),
    matches: () => false,
    querySelectorAll: (selector) => (selector === 'a[href]' ? [link] : []),
  }
}

test('dashboard application cards resolve their nested opportunity identity', () => {
  const debug = loadDebugModule()
  const data = debug.summarizeOpportunityMatching(
    [{ id: 42, category_refs: [6], applied: true }],
    [6],
    {
      applicationRows: [{ id: 501, opportunities_v3: { id: 42 } }],
    },
  )
  const card = dashboardCard(
    { 'data-wf-xano-id': '501' },
    '/opportunities/999',
  )

  assert.equal(debug.resolveOpportunityMatchCardId(card, data), '42')
})

test('dashboard application cards fall back to their opportunity detail link', () => {
  const debug = loadDebugModule()
  const data = debug.summarizeOpportunityMatching(
    [{ id: 42, category_refs: [6] }],
    [6],
  )
  const card = dashboardCard(
    { 'data-wf-xano-id': '501' },
    '/opportunities/42?opp_debug=1',
  )

  assert.equal(debug.resolveOpportunityMatchCardId(card, data), '42')
})

test('dashboard application cards resolve slug detail links against active records', () => {
  const debug = loadDebugModule()
  const data = debug.summarizeOpportunityMatching(
    [
      {
        id: 42,
        category_refs: [6],
        webflow_slug: 'growth-operator',
      },
    ],
    [6],
  )
  const card = dashboardCard(
    { 'data-wf-xano-id': '501' },
    '/opportunities/growth-operator?opp_debug=1',
  )

  assert.equal(debug.resolveOpportunityMatchCardId(card, data), '42')
})

test('dashboard application cards normalize full and relative opportunity paths', () => {
  const debug = loadDebugModule()
  const data = debug.summarizeOpportunityMatching(
    [
      {
        id: 42,
        category_refs: [6],
        url_path: 'https://example.test/opportunities/growth-operator/',
      },
      { id: 77, category_refs: [6], url_path: '/opportunities/retention-lead' },
    ],
    [6],
  )

  assert.equal(
    debug.resolveOpportunityMatchCardId(
      dashboardCard({ 'data-wf-xano-id': '501' }, '/opportunities/growth-operator'),
      data,
    ),
    '42',
  )
  assert.equal(
    debug.resolveOpportunityMatchCardId(
      dashboardCard({ 'data-wf-xano-id': '502' }, '/opportunities/retention-lead'),
      data,
    ),
    '77',
  )
})

test('dashboard slug fallback rejects ambiguous active opportunity identities', () => {
  const debug = loadDebugModule()
  const data = debug.summarizeOpportunityMatching(
    [
      { id: 42, category_refs: [6], webflow_slug: 'growth-operator' },
      { id: 77, category_refs: [6], url_path: 'opportunities/growth-operator' },
    ],
    [6],
  )
  const card = dashboardCard(
    { 'data-wf-xano-id': '501' },
    '/opportunities/growth-operator',
  )

  assert.equal(debug.resolveOpportunityMatchCardId(card, data), '')
})

test('explicit dashboard opportunity identity takes precedence over application identity', () => {
  const debug = loadDebugModule()
  const card = dashboardCard(
    { 'data-opportunity-id': '42', 'data-wf-xano-id': '501' },
    '/opportunities/999',
  )

  assert.equal(
    debug.resolveOpportunityMatchCardId(card, {
      applicationOpportunityIds: { 501: '77' },
    }),
    '42',
  )
})
