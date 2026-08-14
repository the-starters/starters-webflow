/**
 * V3 Algolia browser environment resolver.
 *
 * @release unreleased
 *
 * Load this deferred script before the deferred wf-algolia bundle. Load a
 * GitHub-owned public configuration first as window.__startersV3AlgoliaConfig.
 * The resolver changes only elements with the explicit V3 attributes below:
 *
 * - script[data-starters-v3-algolia-client]
 * - [data-starters-v3-algolia-resource="starters"]
 * - [data-starters-v3-algolia-resource="opportunities"]
 *
 * Unknown hosts, missing configuration, shared search keys, shared indexes,
 * and legacy dev index names fail closed before wf-algolia can start.
 */
;(function () {
  'use strict'

  var HOST_ENVIRONMENTS = {
    'the-starters-3-0.webflow.io': 'test',
    'thestarters.com': 'production',
    'www.thestarters.com': 'production',
  }
  var CLIENT_SELECTOR = 'script[data-starters-v3-algolia-client]'
  var SHARED_CLIENT_SELECTOR = 'script[data-starters-shared-algolia-client]'
  var RESOURCE_SELECTOR = '[data-starters-v3-algolia-resource]'
  var LEARN_CONTENT_INDEX = 'LearnContent'
  var EXPECTED_INDEXES = {
    test: {
      startersIndex: 'Freelancers3.0-staging-test',
      opportunitiesIndex: 'opportunities_v3_test',
    },
    production: {
      startersIndex: 'Freelancers3.0-production',
      opportunitiesIndex: 'opportunities_v3_production',
    },
  }
  var READY_EVENT = 'starters:algolia-environment-ready'
  var BLOCKED_EVENT = 'starters:algolia-environment-blocked'
  var activeResolution = null

  function clean(value) {
    return String(value || '').trim()
  }

  function environmentForHost(hostname) {
    return HOST_ENVIRONMENTS[clean(hostname).toLowerCase()] || ''
  }

  function normalizedEnvironment(config, environment) {
    var source = config && config[environment]
    return {
      appId: clean(source && source.appId),
      searchKey: clean(source && source.searchKey),
      startersIndex: clean(source && source.startersIndex),
      opportunitiesIndex: clean(source && source.opportunitiesIndex),
    }
  }

  function legacyIndexName(indexName) {
    return /(?:^|[-_.])dev(?:$|[-_.])/i.test(clean(indexName))
  }

  function validateConfig(config) {
    var test = normalizedEnvironment(config, 'test')
    var production = normalizedEnvironment(config, 'production')
    var required = ['appId', 'searchKey', 'startersIndex', 'opportunitiesIndex']
    for (var i = 0; i < required.length; i += 1) {
      var field = required[i]
      if (!test[field] || !production[field]) {
        return { ok: false, reason: 'missing_' + field }
      }
    }
    if (test.searchKey === production.searchKey) {
      return { ok: false, reason: 'shared_search_key' }
    }
    var indexes = [
      test.startersIndex,
      test.opportunitiesIndex,
      production.startersIndex,
      production.opportunitiesIndex,
    ]
    for (var index = 0; index < indexes.length; index += 1) {
      if (indexes.indexOf(indexes[index]) !== index) {
        return { ok: false, reason: 'shared_index' }
      }
    }
    if (
      legacyIndexName(test.startersIndex) ||
      legacyIndexName(test.opportunitiesIndex) ||
      legacyIndexName(production.startersIndex) ||
      legacyIndexName(production.opportunitiesIndex)
    ) {
      return { ok: false, reason: 'legacy_dev_index' }
    }
    if (
      test.startersIndex !== EXPECTED_INDEXES.test.startersIndex ||
      test.opportunitiesIndex !== EXPECTED_INDEXES.test.opportunitiesIndex ||
      production.startersIndex !== EXPECTED_INDEXES.production.startersIndex ||
      production.opportunitiesIndex !== EXPECTED_INDEXES.production.opportunitiesIndex
    ) {
      return { ok: false, reason: 'unexpected_index_mapping' }
    }
    return { ok: true, test: test, production: production }
  }

  function resolve(hostname, config) {
    var environment = environmentForHost(hostname)
    if (!environment) return { ok: false, reason: 'unknown_host', environment: '' }
    var validation = validateConfig(config)
    if (!validation.ok) {
      return { ok: false, reason: validation.reason, environment: environment }
    }
    return {
      ok: true,
      environment: environment,
      settings: validation[environment],
    }
  }

  function each(documentObject, selector, callback) {
    var elements = documentObject && documentObject.querySelectorAll
      ? documentObject.querySelectorAll(selector)
      : []
    Array.prototype.forEach.call(elements || [], callback)
  }

  function preserveSharedLearnContentConfig(documentObject) {
    var existing = window.starterQuizLearnContentAlgoliaConfig || {}
    if (
      clean(existing.appId) &&
      clean(existing.searchKey) &&
      clean(existing.indexName) === LEARN_CONTENT_INDEX
    ) {
      return {
        appId: clean(existing.appId),
        searchKey: clean(existing.searchKey),
        indexName: LEARN_CONTENT_INDEX,
      }
    }

    var sharedClient = null
    each(documentObject, SHARED_CLIENT_SELECTOR, function (element) {
      if (element.getAttribute('data-starters-v3-algolia-client') !== null) return
      if (!sharedClient) sharedClient = element
    })
    var appId = clean(sharedClient && sharedClient.getAttribute('data-app-id'))
    var searchKey = clean(sharedClient && sharedClient.getAttribute('data-search-key'))
    if (!appId || !searchKey) return null

    var preserved = {
      appId: appId,
      searchKey: searchKey,
      indexName: LEARN_CONTENT_INDEX,
    }
    window.starterQuizLearnContentAlgoliaConfig = preserved
    return preserved
  }

  function block(documentObject, reason) {
    activeResolution = null
    var shared = window.starterQuizLearnContentAlgoliaConfig || {}
    var sharedAppId = clean(shared.appId)
    var sharedSearchKey = clean(shared.searchKey)
    var hasSharedClient = sharedAppId &&
      sharedSearchKey &&
      clean(shared.indexName) === LEARN_CONTENT_INDEX
    each(documentObject, CLIENT_SELECTOR, function (element) {
      if (hasSharedClient) {
        element.setAttribute('data-app-id', sharedAppId)
        element.setAttribute('data-search-key', sharedSearchKey)
      } else {
        element.removeAttribute('data-app-id')
        element.removeAttribute('data-search-key')
      }
      element.setAttribute('data-starters-v3-algolia-blocked', reason)
    })
    each(documentObject, RESOURCE_SELECTOR, function (element) {
      element.removeAttribute('wf-algolia-index')
      element.setAttribute('data-starters-v3-algolia-blocked', reason)
    })
    if (documentObject && documentObject.documentElement) {
      documentObject.documentElement.setAttribute('data-v3-algolia-status', 'blocked')
      documentObject.documentElement.setAttribute('data-v3-algolia-block-reason', reason)
    }
  }

  function apply(documentObject, resolution) {
    var invalidResource = false
    each(documentObject, CLIENT_SELECTOR, function (element) {
      element.setAttribute('data-app-id', resolution.settings.appId)
      element.setAttribute('data-search-key', resolution.settings.searchKey)
      element.setAttribute('data-starters-v3-algolia-environment', resolution.environment)
      element.removeAttribute('data-starters-v3-algolia-blocked')
    })
    each(documentObject, RESOURCE_SELECTOR, function (element) {
      var resource = clean(element.getAttribute('data-starters-v3-algolia-resource'))
      var indexName = resource === 'starters'
        ? resolution.settings.startersIndex
        : resource === 'opportunities'
          ? resolution.settings.opportunitiesIndex
          : ''
      if (!indexName) {
        invalidResource = true
        element.removeAttribute('wf-algolia-index')
        element.setAttribute('data-starters-v3-algolia-blocked', 'unknown_resource')
        return
      }
      element.setAttribute('wf-algolia-index', indexName)
      element.setAttribute('data-starters-v3-algolia-environment', resolution.environment)
      element.removeAttribute('data-starters-v3-algolia-blocked')
    })
    if (invalidResource) {
      block(documentObject, 'unknown_resource')
      return false
    }
    if (documentObject && documentObject.documentElement) {
      documentObject.documentElement.setAttribute('data-v3-algolia-status', 'ready')
      documentObject.documentElement.setAttribute('data-v3-algolia-environment', resolution.environment)
      documentObject.documentElement.removeAttribute('data-v3-algolia-block-reason')
    }
    return true
  }

  function dispatch(name, detail) {
    if (!window.dispatchEvent || !window.CustomEvent) return
    window.dispatchEvent(new window.CustomEvent(name, { detail: detail }))
  }

  function getManagedSearchConfig(resource) {
    if (!activeResolution || !activeResolution.ok) return null
    var indexName = resource === 'starters'
      ? activeResolution.settings.startersIndex
      : resource === 'opportunities'
        ? activeResolution.settings.opportunitiesIndex
        : ''
    if (!indexName) return null
    return {
      appId: activeResolution.settings.appId,
      searchKey: activeResolution.settings.searchKey,
      indexName: indexName,
      environment: activeResolution.environment,
    }
  }

  function boot(config) {
    var sharedLearnContent = preserveSharedLearnContentConfig(document)
    var resolution = resolve(window.location && window.location.hostname, config)
    if (!sharedLearnContent) {
      resolution = {
        ok: false,
        reason: 'missing_learn_content_config',
        environment: resolution.environment || environmentForHost(
          window.location && window.location.hostname,
        ),
      }
    } else if (
      config &&
      (sharedLearnContent.searchKey === clean(config.test && config.test.searchKey) ||
        sharedLearnContent.searchKey === clean(
          config.production && config.production.searchKey,
        ))
    ) {
      resolution = {
        ok: false,
        reason: 'shared_learn_search_key',
        environment: resolution.environment,
      }
    }
    if (!resolution.ok) {
      block(document, resolution.reason)
      dispatch(BLOCKED_EVENT, {
        environment: resolution.environment,
        reason: resolution.reason,
      })
      return resolution
    }
    if (!apply(document, resolution)) {
      var blocked = {
        ok: false,
        environment: resolution.environment,
        reason: 'unknown_resource',
      }
      dispatch(BLOCKED_EVENT, blocked)
      return blocked
    }
    activeResolution = resolution
    window.__startersV3AlgoliaEnvironment = resolution.environment
    dispatch(READY_EVENT, {
      environment: resolution.environment,
      appId: resolution.settings.appId,
      startersIndex: resolution.settings.startersIndex,
      opportunitiesIndex: resolution.settings.opportunitiesIndex,
    })
    return resolution
  }

  window.StartersV3AlgoliaEnvironment = {
    apply: apply,
    block: block,
    boot: boot,
    environmentForHost: environmentForHost,
    getManagedSearchConfig: getManagedSearchConfig,
    preserveSharedLearnContentConfig: preserveSharedLearnContentConfig,
    resolve: resolve,
    validateConfig: validateConfig,
  }

  boot(window.__startersV3AlgoliaConfig)
})()
