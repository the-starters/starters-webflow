const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./algolia-environment.js'), 'utf8')

function element(initial = {}) {
  const attributes = { ...initial }
  return {
    attributes,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null
    },
    setAttribute(name, value) {
      attributes[name] = String(value)
    },
    removeAttribute(name) {
      delete attributes[name]
    },
  }
}

function config(overrides = {}) {
  return {
    test: {
      appId: 'TESTAPP',
      searchKey: 'test-public-search-key',
      startersIndex: 'Freelancers3.0-staging-test',
      opportunitiesIndex: 'opportunities_v3_test',
      ...(overrides.test || {}),
    },
    production: {
      appId: 'PRODAPP',
      searchKey: 'production-public-search-key',
      startersIndex: 'Freelancers3.0-production',
      opportunitiesIndex: 'opportunities_v3_production',
      ...(overrides.production || {}),
    },
  }
}

function load(options = {}) {
  const client = element({
    'data-starters-v3-algolia-client': '',
    'data-app-id': 'legacy-managed-app',
    'data-search-key': 'legacy-managed-key',
  })
  const starters = element({
    'data-starters-v3-algolia-resource': 'starters',
    'wf-algolia-index': 'Freelancers3.0-dev',
  })
  const opportunities = element({
    'data-starters-v3-algolia-resource': 'opportunities',
    'wf-algolia-index': 'opportunities_v3_dev',
  })
  const sharedIndexes = [
    'LearnContent',
    'cancelled-consult-1',
    'cancelled-consult-2',
    'cancelled-hire-1',
  ].map((indexName) => element({ 'wf-algolia-index': indexName }))
  const unmanaged = sharedIndexes[0]
  const unexpectedIndex = options.unexpectedIndex
    ? element({ 'wf-algolia-index': options.unexpectedIndex })
    : null
  const competingClient = options.competingClient
    ? element({
        'data-app-id': 'browser-selected-app',
        'data-search-key': 'browser-selected-key',
      })
    : null
  const extraManagedClient = options.extraManagedClient
    ? element({ 'data-starters-v3-algolia-client': '' })
    : null
  const sortItems = [
    element({ 'wf-algolia-sort-index': '' }),
    element({ 'wf-algolia-sort-index': 'name-AtoZ' }),
    element({ 'wf-algolia-sort-index': 'rate_asc' }),
    element({ 'wf-algolia-sort-index': 'rate_desc' }),
    element({ 'wf-algolia-sort-index': 'published_asc' }),
    element({ 'wf-algolia-sort-index': 'published_desc' }),
  ]
  if (options.unknownSort) {
    sortItems.push(element({ 'wf-algolia-sort-index': options.unknownSort }))
  }
  const extra = options.extraResource ? element({
    'data-starters-v3-algolia-resource': options.extraResource,
    'wf-algolia-index': 'unsafe-index',
  }) : null
  const root = element()
  const events = []
  const document = {
    documentElement: root,
    querySelectorAll(selector) {
      if (selector === 'script[data-starters-v3-algolia-client]') {
        if (options.noManagedClient) return []
        return [client, ...(extraManagedClient ? [extraManagedClient] : [])]
      }
      if (selector === 'script[data-app-id], script[data-search-key]') {
        return [client, ...(competingClient ? [competingClient] : [])]
      }
      if (selector === '[data-starters-v3-algolia-resource]') {
        return [starters, opportunities, ...(extra ? [extra] : [])]
      }
      if (selector === '[wf-algolia-index]') {
        return [
          starters,
          opportunities,
          ...sharedIndexes,
          ...(unexpectedIndex ? [unexpectedIndex] : []),
          ...(extra ? [extra] : []),
        ].filter((item) => item.getAttribute('wf-algolia-index') !== null)
      }
      if (selector === '[wf-algolia-sort-index]') return sortItems
      return []
    },
  }
  const window = {
    __startersV3AlgoliaConfig: Object.prototype.hasOwnProperty.call(options, 'config')
      ? options.config
      : config(),
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.name = name
        this.detail = init && init.detail
      }
    },
    dispatchEvent(event) {
      events.push(event)
    },
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      search: options.search || '',
      hash: options.hash || '',
    },
    localStorage: options.localStorage,
    starterQuizAlgoliaConfig: options.starterQuizAlgoliaConfig,
    __startersV3AlgoliaEnvironment: options.requestedEnvironment,
  }

  vm.runInNewContext(source, { document, window })
  return {
    api: window.StartersV3AlgoliaEnvironment,
    client,
    competingClient,
    document,
    events,
    opportunities,
    root,
    sortItems,
    sharedIndexes,
    starters,
    unexpectedIndex,
    unmanaged,
    window,
  }
}

test('staging selects only TEST credentials and indexes', () => {
  const runtime = load()
  assert.equal(runtime.window.__startersV3AlgoliaEnvironment, 'test')
  assert.equal(runtime.client.getAttribute('data-app-id'), 'TESTAPP')
  assert.equal(runtime.client.getAttribute('data-search-key'), 'test-public-search-key')
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), 'Freelancers3.0-staging-test')
  assert.equal(runtime.opportunities.getAttribute('wf-algolia-index'), 'opportunities_v3_test')
  assert.deepEqual(runtime.sortItems.map((item) => item.getAttribute('wf-algolia-sort-index')), [
    '',
    'Freelancers3.0-staging-test__name-AtoZ',
    'Freelancers3.0-staging-test__rate_asc',
    'Freelancers3.0-staging-test__rate_desc',
    'Freelancers3.0-staging-test__published_asc',
    'Freelancers3.0-staging-test__published_desc',
  ])
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
  assert.equal(runtime.events.at(-1).name, 'starters:algolia-environment-ready')
  assert.equal(runtime.events.at(-1).detail.searchKey, undefined)
  assert.deepEqual({ ...runtime.api.getManagedSearchConfig('starters') }, {
    appId: 'TESTAPP',
    searchKey: 'test-public-search-key',
    indexName: 'Freelancers3.0-staging-test',
    environment: 'test',
  })
  assert.deepEqual({ ...runtime.api.getSharedSearchConfig('learnContent') }, {
    appId: 'TESTAPP',
    searchKey: 'test-public-search-key',
    indexName: 'LearnContent',
    environment: 'test',
  })
})

test('browser-controlled inputs cannot select the environment', () => {
  const runtime = load({
    search: '?environment=production&index=Freelancers3.0-production',
    hash: '#algolia-environment=production',
    requestedEnvironment: 'production',
    starterQuizAlgoliaConfig: {
      appId: 'PRODAPP',
      searchKey: 'production-public-search-key',
      indexName: 'Freelancers3.0-production',
    },
    localStorage: {
      getItem() {
        return 'production'
      },
    },
  })

  assert.equal(runtime.window.__startersV3AlgoliaEnvironment, 'test')
  assert.equal(runtime.client.getAttribute('data-app-id'), 'TESTAPP')
  assert.equal(runtime.client.getAttribute('data-search-key'), 'test-public-search-key')
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), 'Freelancers3.0-staging-test')
  assert.equal(runtime.opportunities.getAttribute('wf-algolia-index'), 'opportunities_v3_test')
})

for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
  test(`${hostname} selects only production credentials and indexes`, () => {
    const runtime = load({ hostname })
    assert.equal(runtime.window.__startersV3AlgoliaEnvironment, 'production')
    assert.equal(runtime.client.getAttribute('data-app-id'), 'PRODAPP')
    assert.equal(runtime.client.getAttribute('data-search-key'), 'production-public-search-key')
    assert.equal(runtime.starters.getAttribute('wf-algolia-index'), 'Freelancers3.0-production')
    assert.equal(runtime.opportunities.getAttribute('wf-algolia-index'), 'opportunities_v3_production')
    assert.equal(
      runtime.sortItems[1].getAttribute('wf-algolia-sort-index'),
      'Freelancers3.0-production__name-AtoZ',
    )
  })
}

test('unknown hosts fail closed while leaving unmanaged index markup unchanged', () => {
  const runtime = load({
    hostname: 'preview.example.com',
    requestedEnvironment: 'production',
  })
  assert.equal(runtime.window.__startersV3AlgoliaEnvironment, '')
  assert.equal(runtime.client.getAttribute('data-app-id'), null)
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.opportunities.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'blocked')
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'unknown_host')
  assert.equal(runtime.events.at(-1).name, 'starters:algolia-environment-blocked')
  assert.equal(runtime.unmanaged.getAttribute('wf-algolia-index'), 'LearnContent')
  assert.equal(runtime.api.getSharedSearchConfig('learnContent'), null)
})

test('missing configuration fails closed on an approved host', () => {
  const runtime = load({ config: undefined })
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'missing_appId')
})

test('shared search keys fail closed', () => {
  const runtime = load({ config: config({ production: { searchKey: 'test-public-search-key' } }) })
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'shared_search_key')
})

test('shared or legacy dev indexes fail closed', () => {
  const shared = load({ config: config({ production: { startersIndex: 'Freelancers3.0-staging-test' } }) })
  assert.equal(shared.root.getAttribute('data-v3-algolia-block-reason'), 'shared_index')

  const legacy = load({ config: config({ production: { startersIndex: 'Freelancers3.0-dev' } }) })
  assert.equal(legacy.root.getAttribute('data-v3-algolia-block-reason'), 'legacy_dev_index')
})

test('cross-role shared indexes fail closed', () => {
  const runtime = load({
    config: config({
      production: { opportunitiesIndex: 'Freelancers3.0-staging-test' },
    }),
  })
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'shared_index')
  assert.equal(runtime.api.getManagedSearchConfig('starters'), null)
})

test('swapped or arbitrary managed index mappings fail closed', () => {
  const swapped = load({
    config: config({
      test: {
        startersIndex: 'opportunities_v3_test',
        opportunitiesIndex: 'Freelancers3.0-staging-test',
      },
    }),
  })
  assert.equal(
    swapped.root.getAttribute('data-v3-algolia-block-reason'),
    'unexpected_index_mapping',
  )

  const arbitrary = load({
    config: config({ production: { startersIndex: 'freelancers_live' } }),
  })
  assert.equal(
    arbitrary.root.getAttribute('data-v3-algolia-block-reason'),
    'unexpected_index_mapping',
  )
})

test('unknown shared resources fail closed through the resolver API', () => {
  const runtime = load()
  assert.equal(runtime.api.getSharedSearchConfig('unknown'), null)
})

test('unknown managed resources block the whole managed Algolia surface', () => {
  const runtime = load({ extraResource: 'learn' })
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(
    runtime.root.getAttribute('data-v3-algolia-block-reason'),
    'unexpected_index_resource',
  )
})

test('an unmarked unexpected index blocks every Algolia client', () => {
  const runtime = load({ unexpectedIndex: 'Freelancers3.0-dev' })
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.unexpectedIndex.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'unexpected_index_resource')
  assert.deepEqual(
    runtime.sharedIndexes.map((item) => item.getAttribute('wf-algolia-index')),
    ['LearnContent', 'cancelled-consult-1', 'cancelled-consult-2', 'cancelled-hire-1'],
  )
  assert.equal(runtime.events.at(-1).detail.reason, 'unexpected_index_resource')
})

test('a competing credentialed client is stripped before boot can become ready', () => {
  const runtime = load({ competingClient: true })
  assert.equal(runtime.client.getAttribute('data-app-id'), null)
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.competingClient.getAttribute('data-app-id'), null)
  assert.equal(runtime.competingClient.getAttribute('data-search-key'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'unexpected_client')
  assert.equal(runtime.events.at(-1).name, 'starters:algolia-environment-blocked')
})

test('the resolver requires exactly one marked client', () => {
  for (const options of [{ noManagedClient: true }, { extraManagedClient: true }]) {
    const runtime = load(options)
    assert.equal(runtime.client.getAttribute('data-search-key'), null)
    assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'unexpected_client_count')
  }
})

test('unknown sort indexes block the whole managed Algolia surface', () => {
  const runtime = load({ unknownSort: 'Freelancers3.0-dev_price_asc' })
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(
    runtime.root.getAttribute('data-v3-algolia-block-reason'),
    'unknown_resource_or_sort_index',
  )
})

test('replica mapping is idempotent', () => {
  const runtime = load()
  const resolution = runtime.api.resolve('the-starters-3-0.webflow.io', config())
  assert.equal(runtime.api.apply(runtime.document, resolution), true)
  assert.equal(
    runtime.sortItems[2].getAttribute('wf-algolia-sort-index'),
    'Freelancers3.0-staging-test__rate_asc',
  )
})

test('unmanaged Algolia sections are not changed', () => {
  const runtime = load()
  assert.deepEqual(
    runtime.sharedIndexes.map((item) => item.getAttribute('wf-algolia-index')),
    ['LearnContent', 'cancelled-consult-1', 'cancelled-consult-2', 'cancelled-hire-1'],
  )
  assert.equal(
    runtime.api.getSharedSearchConfig('learnContent').searchKey,
    'test-public-search-key',
  )
})
