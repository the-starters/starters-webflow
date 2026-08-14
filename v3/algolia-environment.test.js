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
  const sharedClient = element({
    'data-starters-shared-algolia-client': '',
    'data-app-id': 'shared-app',
    'data-search-key': 'shared-key',
  })
  const starters = element({
    'data-starters-v3-algolia-resource': 'starters',
    'wf-algolia-index': 'Freelancers3.0-dev',
  })
  const opportunities = element({
    'data-starters-v3-algolia-resource': 'opportunities',
    'wf-algolia-index': 'opportunities_v3_dev',
  })
  const unmanaged = element({ 'wf-algolia-index': 'LearnContent' })
  const extra = options.extraResource ? element({
    'data-starters-v3-algolia-resource': options.extraResource,
    'wf-algolia-index': 'unsafe-index',
  }) : null
  const root = element()
  const events = []
  const document = {
    documentElement: root,
    querySelectorAll(selector) {
      if (selector === 'script[data-starters-v3-algolia-client]') return [client]
      if (selector === 'script[data-starters-shared-algolia-client]') {
        return options.disableSharedClient ? [] : [sharedClient]
      }
      if (selector === '[data-starters-v3-algolia-resource]') {
        return [starters, opportunities, ...(extra ? [extra] : [])]
      }
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
    starterQuizLearnContentAlgoliaConfig: options.learnConfig,
    __startersV3AlgoliaEnvironment: options.requestedEnvironment,
  }

  vm.runInNewContext(source, { document, window })
  return {
    api: window.StartersV3AlgoliaEnvironment,
    client,
    events,
    opportunities,
    root,
    sharedClient,
    starters,
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
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'ready')
  assert.equal(runtime.events.at(-1).name, 'starters:algolia-environment-ready')
  assert.equal(runtime.events.at(-1).detail.searchKey, undefined)
  assert.deepEqual({ ...runtime.api.getManagedSearchConfig('starters') }, {
    appId: 'TESTAPP',
    searchKey: 'test-public-search-key',
    indexName: 'Freelancers3.0-staging-test',
    environment: 'test',
  })
  assert.deepEqual({ ...runtime.window.starterQuizLearnContentAlgoliaConfig }, {
    appId: 'shared-app',
    searchKey: 'shared-key',
    indexName: 'LearnContent',
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
  })
}

test('unknown hosts block managed indexes and retain the shared Learn client', () => {
  const runtime = load({ hostname: 'preview.example.com' })
  assert.equal(runtime.client.getAttribute('data-app-id'), 'shared-app')
  assert.equal(runtime.client.getAttribute('data-search-key'), 'shared-key')
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.opportunities.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-status'), 'blocked')
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'unknown_host')
  assert.equal(runtime.events.at(-1).name, 'starters:algolia-environment-blocked')
  assert.equal(runtime.sharedClient.getAttribute('data-app-id'), 'shared-app')
  assert.equal(runtime.sharedClient.getAttribute('data-search-key'), 'shared-key')
  assert.deepEqual({ ...runtime.window.starterQuizLearnContentAlgoliaConfig }, {
    appId: 'shared-app',
    searchKey: 'shared-key',
    indexName: 'LearnContent',
  })
})

test('missing configuration fails closed on an approved host', () => {
  const runtime = load({ config: undefined })
  assert.equal(runtime.client.getAttribute('data-search-key'), 'shared-key')
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'missing_appId')
})

test('shared search keys fail closed', () => {
  const runtime = load({ config: config({ production: { searchKey: 'test-public-search-key' } }) })
  assert.equal(runtime.client.getAttribute('data-search-key'), 'shared-key')
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

test('missing or shared LearnContent credentials fail closed', () => {
  const missing = load({ disableSharedClient: true })
  assert.equal(
    missing.root.getAttribute('data-v3-algolia-block-reason'),
    'missing_learn_content_config',
  )

  const shared = load({
    learnConfig: {
      appId: 'TESTAPP',
      searchKey: 'test-public-search-key',
      indexName: 'LearnContent',
    },
  })
  assert.equal(
    shared.root.getAttribute('data-v3-algolia-block-reason'),
    'shared_learn_search_key',
  )
})

test('unknown managed resources block the whole managed Algolia surface', () => {
  const runtime = load({ extraResource: 'learn' })
  assert.equal(runtime.client.getAttribute('data-search-key'), 'shared-key')
  assert.equal(runtime.starters.getAttribute('wf-algolia-index'), null)
  assert.equal(runtime.root.getAttribute('data-v3-algolia-block-reason'), 'unknown_resource')
})

test('unmanaged Algolia sections are not changed', () => {
  const runtime = load()
  assert.equal(runtime.unmanaged.getAttribute('wf-algolia-index'), 'LearnContent')
  assert.equal(runtime.window.starterQuizLearnContentAlgoliaConfig.searchKey, 'shared-key')
})
