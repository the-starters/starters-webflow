const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./algolia-environment.js'), 'utf8')
const tabCountsSource = fs.readFileSync(
  require.resolve('../explore-search/explore-search-tab-counts.js'),
  'utf8',
)

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
  const tabCount = options.legacyTabCount
    ? element({ 'data-tab-count-for': 'Freelancers3.0-dev' })
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
  const staticListOptions = options.staticList
  const staticList = staticListOptions
    ? element({
        'wf-algolia-element': 'browse',
        'wf-algolia-disable-filters': 'true',
        'wf-algolia-index': staticListOptions.index || 'Freelancers3.0-dev',
        'data-starters-v3-algolia-resource':
          staticListOptions.resource || 'starters',
        ...(Object.prototype.hasOwnProperty.call(staticListOptions, 'sort')
          ? { 'data-starters-v3-algolia-sort': staticListOptions.sort }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(staticListOptions, 'sortIndex')
          ? { 'wf-algolia-sort-index': staticListOptions.sortIndex }
          : {}),
      })
    : null
  const staticListChild = staticListOptions && staticListOptions.child
    ? element({
        'data-starters-v3-algolia-resource': 'starters',
        'wf-algolia-index': 'Freelancers3.0-dev',
      })
    : null
  if (staticList && staticList.getAttribute('wf-algolia-sort-index') !== null) {
    sortItems.push(staticList)
  }
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
        return [
          starters,
          opportunities,
          ...(unexpectedIndex &&
          unexpectedIndex.getAttribute('data-starters-v3-algolia-resource') !== null
            ? [unexpectedIndex]
            : []),
          ...(extra ? [extra] : []),
          ...(staticList ? [staticList] : []),
          ...(staticListChild ? [staticListChild] : []),
        ]
      }
      if (selector === '[wf-algolia-index]') {
        return [
          starters,
          opportunities,
          ...sharedIndexes,
          ...(unexpectedIndex ? [unexpectedIndex] : []),
          ...(extra ? [extra] : []),
          ...(staticList ? [staticList] : []),
          ...(staticListChild ? [staticListChild] : []),
        ].filter((item) => item.getAttribute('wf-algolia-index') !== null)
      }
      if (selector === '[wf-algolia-sort-index]') return sortItems
      if (selector === '[data-tab-count-for]') return tabCount ? [tabCount] : []
      if (selector === '[data-starters-v3-algolia-tab-count-resource]') {
        return tabCount && tabCount.getAttribute(selector.slice(1, -1)) !== null ? [tabCount] : []
      }
      if (selector === '[data-active-tab-count]') return []
      if (selector === '[data-tab-component="button-list"]') return []
      return []
    },
    querySelector(selector) {
      if (selector === '[data-tab-count-for]') return tabCount
      return null
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
    staticList,
    staticListChild,
    tabCount,
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

test('the exact legacy Starter index is remapped for unmarked sitewide component elements', () => {
  const runtime = load({ unexpectedIndex: 'Freelancers3.0-dev', legacyTabCount: true })
  assert.equal(runtime.client.getAttribute('data-search-key'), 'test-public-search-key')
  assert.equal(
    runtime.unexpectedIndex.getAttribute('wf-algolia-index'),
    'Freelancers3.0-staging-test',
  )
  assert.equal(runtime.unexpectedIndex.getAttribute('data-starters-v3-algolia-environment'), 'test')
  assert.equal(runtime.unexpectedIndex.getAttribute('data-starters-v3-algolia-resource'), 'starters')
  assert.equal(runtime.tabCount.getAttribute('data-tab-count-for'), 'Freelancers3.0-staging-test')
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('remapped legacy sitewide elements remain managed across repeated boots', () => {
  const runtime = load({ unexpectedIndex: 'Freelancers3.0-dev', legacyTabCount: true })
  assert.equal(runtime.api.boot(config()).ok, true)
  assert.equal(runtime.client.getAttribute('data-search-key'), 'test-public-search-key')
  assert.equal(
    runtime.unexpectedIndex.getAttribute('wf-algolia-index'),
    'Freelancers3.0-staging-test',
  )
  assert.equal(runtime.tabCount.getAttribute('data-tab-count-for'), 'Freelancers3.0-staging-test')
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('Explore counts render against the host-remapped legacy tab index', async () => {
  const runtime = load({ legacyTabCount: true })
  runtime.window.fetch = () => Promise.resolve({
    clone() {
      return {
        text() {
          return Promise.resolve(JSON.stringify({ results: [{ nbHits: 42 }] }))
        },
      }
    },
  })
  vm.runInNewContext(tabCountsSource, {
    document: runtime.document,
    setTimeout,
    window: runtime.window,
  })

  await runtime.window.fetch('https://test.algolia.net/1/indexes/*/queries', {
    body: JSON.stringify({
      requests: [{
        indexName: 'Freelancers3.0-staging-test',
        params: { clickAnalytics: true },
        query: '',
      }],
    }),
  })
  await new Promise(setImmediate)

  assert.equal(runtime.tabCount.textContent, '42')
})

test('the exact legacy Starter index maps to production on both production hosts', () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const runtime = load({
      hostname,
      legacyTabCount: true,
      unexpectedIndex: 'Freelancers3.0-dev',
    })
    assert.equal(
      runtime.unexpectedIndex.getAttribute('wf-algolia-index'),
      'Freelancers3.0-production',
    )
    assert.equal(
      runtime.unexpectedIndex.getAttribute('data-starters-v3-algolia-environment'),
      'production',
    )
    assert.equal(runtime.tabCount.getAttribute('data-tab-count-for'), 'Freelancers3.0-production')
  }
})

test('an unmarked near-match or arbitrary index blocks every Algolia client', () => {
  const runtime = load({ unexpectedIndex: 'Freelancers3.0-staging' })
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

test('a Static List with a logical sort searches the host Sort Replica', () => {
  const runtime = load({
    hostname: 'www.thestarters.com',
    staticList: { sort: 'published_desc' },
  })
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'Freelancers3.0-production__published_desc',
  )
  assert.equal(
    runtime.staticList.getAttribute('data-starters-v3-algolia-sort'),
    'published_desc',
  )
  assert.equal(
    runtime.staticList.getAttribute('data-starters-v3-algolia-environment'),
    'production',
  )
  assert.equal(runtime.staticList.getAttribute('data-starters-v3-algolia-blocked'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('a Static List Sort Replica stays inside the staging environment', () => {
  const runtime = load({ staticList: { sort: 'published_desc' } })
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'Freelancers3.0-staging-test__published_desc',
  )
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('every known logical sort maps to its host Sort Replica', () => {
  for (const logicalName of [
    'name-AtoZ',
    'rate_asc',
    'rate_desc',
    'published_asc',
    'published_desc',
  ]) {
    const runtime = load({ staticList: { sort: logicalName } })
    assert.equal(
      runtime.staticList.getAttribute('wf-algolia-index'),
      `Freelancers3.0-staging-test__${logicalName}`,
    )
  }
})

test('wf-algolia-sort-index on the Static List itself selects the Sort Replica', () => {
  const runtime = load({
    hostname: 'www.thestarters.com',
    staticList: { sortIndex: 'published_desc' },
  })
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'Freelancers3.0-production__published_desc',
  )
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-sort-index'),
    'Freelancers3.0-production__published_desc',
  )
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('a starters resource without a sort attribute stays on the Starter Index', () => {
  const runtime = load({ hostname: 'www.thestarters.com', staticList: {} })
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'Freelancers3.0-production',
  )
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('an authored replica name alone does not restore a Sort Replica', () => {
  const runtime = load({
    hostname: 'www.thestarters.com',
    staticList: { index: 'Freelancers3.0-production__published_asc' },
  })
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'Freelancers3.0-production',
  )
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('an unknown Static List sort blocks the whole managed Algolia surface', () => {
  const runtime = load({ staticList: { sort: 'price_asc' } })
  assert.equal(runtime.client.getAttribute('data-search-key'), null)
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.staticList.getAttribute('wf-algolia-index'), null)
  assert.equal(
    runtime.root.getAttribute('data-v3-algolia-block-reason'),
    'unknown_resource_or_sort_index',
  )
})

test('a sorted Static List does not move its unsorted starters children', () => {
  const runtime = load({
    hostname: 'www.thestarters.com',
    staticList: { sort: 'published_desc', child: true },
  })
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'Freelancers3.0-production__published_desc',
  )
  assert.equal(
    runtime.staticListChild.getAttribute('wf-algolia-index'),
    'Freelancers3.0-production',
  )
  assert.equal(
    runtime.staticListChild.getAttribute('data-starters-v3-algolia-sort'),
    null,
  )
})

test('an opportunities resource ignores Starter Sort Replicas', () => {
  const runtime = load({
    hostname: 'www.thestarters.com',
    staticList: { resource: 'opportunities', sort: 'published_desc' },
  })
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'opportunities_v3_production',
  )
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
})

test('Static List Sort Replica mapping is idempotent', () => {
  const runtime = load({
    hostname: 'www.thestarters.com',
    staticList: { sort: 'published_desc' },
  })
  const resolution = runtime.api.resolve('www.thestarters.com', config())
  assert.equal(runtime.api.apply(runtime.document, resolution), true)
  assert.equal(
    runtime.staticList.getAttribute('wf-algolia-index'),
    'Freelancers3.0-production__published_desc',
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
