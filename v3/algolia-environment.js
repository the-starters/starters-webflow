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
 * - [wf-algolia-sort-index]
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
  var CREDENTIAL_CLIENT_SELECTOR = 'script[data-app-id], script[data-search-key]'
  var RESOURCE_SELECTOR = '[data-starters-v3-algolia-resource]'
  var INDEX_SELECTOR = '[wf-algolia-index]'
  var SORT_SELECTOR = '[wf-algolia-sort-index]'
  var LEARN_CONTENT_INDEX = 'LearnContent'
  var SHARED_INDEXES = [
    LEARN_CONTENT_INDEX,
    'cancelled-consult-1',
    'cancelled-consult-2',
    'cancelled-hire-1',
  ]
  var STARTER_SORT_REPLICAS = [
    'name-AtoZ',
    'rate_asc',
    'rate_desc',
    'published_asc',
    'published_desc',
  ]
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

  function starterReplicaName(startersIndex, logicalName) {
    return clean(startersIndex) + '__' + clean(logicalName)
  }

  function logicalStarterSortName(value, startersIndex) {
    var current = clean(value)
    if (!current) return ''
    for (var i = 0; i < STARTER_SORT_REPLICAS.length; i += 1) {
      var logicalName = STARTER_SORT_REPLICAS[i]
      if (
        current === logicalName ||
        current === starterReplicaName(startersIndex, logicalName)
      ) {
        return logicalName
      }
    }
    return null
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

  function elements(documentObject, selector) {
    if (!documentObject || !documentObject.querySelectorAll) return []
    return Array.prototype.slice.call(documentObject.querySelectorAll(selector) || [])
  }

  function sharedIndex(indexName) {
    return SHARED_INDEXES.indexOf(String(indexName || '')) !== -1
  }

  function validateDocument(documentObject) {
    var managedClients = elements(documentObject, CLIENT_SELECTOR)
    if (managedClients.length !== 1) {
      return { ok: false, reason: 'unexpected_client_count' }
    }
    var credentialClients = elements(documentObject, CREDENTIAL_CLIENT_SELECTOR)
    for (var clientIndex = 0; clientIndex < credentialClients.length; clientIndex += 1) {
      if (credentialClients[clientIndex] !== managedClients[0]) {
        return { ok: false, reason: 'unexpected_client' }
      }
    }
    var indexedElements = elements(documentObject, INDEX_SELECTOR)
    for (var index = 0; index < indexedElements.length; index += 1) {
      var element = indexedElements[index]
      var resource = clean(element.getAttribute('data-starters-v3-algolia-resource'))
      if (resource === 'starters' || resource === 'opportunities') continue
      if (!resource && sharedIndex(element.getAttribute('wf-algolia-index'))) continue
      return { ok: false, reason: 'unexpected_index_resource' }
    }
    return { ok: true }
  }

  function block(documentObject, reason) {
    activeResolution = null
    each(documentObject, CLIENT_SELECTOR, function (element) {
      element.removeAttribute('data-app-id')
      element.removeAttribute('data-search-key')
      element.setAttribute('data-starters-v3-algolia-blocked', reason)
    })
    each(documentObject, CREDENTIAL_CLIENT_SELECTOR, function (element) {
      element.removeAttribute('data-app-id')
      element.removeAttribute('data-search-key')
      element.setAttribute('data-starters-v3-algolia-blocked', reason)
    })
    each(documentObject, RESOURCE_SELECTOR, function (element) {
      element.removeAttribute('wf-algolia-index')
      element.setAttribute('data-starters-v3-algolia-blocked', reason)
    })
    each(documentObject, SORT_SELECTOR, function (element) {
      element.removeAttribute('wf-algolia-sort-index')
      element.setAttribute('data-starters-v3-algolia-blocked', reason)
    })
    each(documentObject, INDEX_SELECTOR, function (element) {
      var resource = clean(element.getAttribute('data-starters-v3-algolia-resource'))
      if (!resource && sharedIndex(element.getAttribute('wf-algolia-index'))) return
      element.removeAttribute('wf-algolia-index')
      element.setAttribute('data-starters-v3-algolia-blocked', reason)
    })
    if (documentObject && documentObject.documentElement) {
      documentObject.documentElement.setAttribute('data-v3-algolia-status', 'blocked')
      documentObject.documentElement.setAttribute('data-v3-algolia-block-reason', reason)
    }
  }

  function apply(documentObject, resolution) {
    var documentValidation = validateDocument(documentObject)
    if (!documentValidation.ok) {
      block(documentObject, documentValidation.reason)
      return false
    }
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
    each(documentObject, SORT_SELECTOR, function (element) {
      var logicalName = logicalStarterSortName(
        element.getAttribute('data-starters-v3-algolia-sort') ||
          element.getAttribute('wf-algolia-sort-index'),
        resolution.settings.startersIndex,
      )
      if (logicalName === null) {
        invalidResource = true
        element.removeAttribute('wf-algolia-sort-index')
        element.setAttribute('data-starters-v3-algolia-blocked', 'unknown_sort_index')
        return
      }
      if (!logicalName) {
        element.setAttribute('wf-algolia-sort-index', '')
        element.removeAttribute('data-starters-v3-algolia-blocked')
        return
      }
      element.setAttribute('data-starters-v3-algolia-sort', logicalName)
      element.setAttribute(
        'wf-algolia-sort-index',
        starterReplicaName(resolution.settings.startersIndex, logicalName),
      )
      element.setAttribute('data-starters-v3-algolia-environment', resolution.environment)
      element.removeAttribute('data-starters-v3-algolia-blocked')
    })
    if (invalidResource) {
      block(documentObject, 'unknown_resource_or_sort_index')
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

  function getSharedSearchConfig(resource) {
    if (!activeResolution || !activeResolution.ok) return null
    if (resource !== 'learnContent') return null
    return {
      appId: activeResolution.settings.appId,
      searchKey: activeResolution.settings.searchKey,
      indexName: LEARN_CONTENT_INDEX,
      environment: activeResolution.environment,
    }
  }

  function boot(config) {
    var resolution = resolve(window.location && window.location.hostname, config)
    if (!resolution.ok) {
      block(document, resolution.reason)
      dispatch(BLOCKED_EVENT, {
        environment: resolution.environment,
        reason: resolution.reason,
      })
      return resolution
    }
    if (!apply(document, resolution)) {
      var reason = document && document.documentElement
        ? clean(document.documentElement.getAttribute('data-v3-algolia-block-reason'))
        : ''
      var blocked = {
        ok: false,
        environment: resolution.environment,
        reason: reason || 'unknown_resource_or_sort_index',
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
    getSharedSearchConfig: getSharedSearchConfig,
    resolve: resolve,
    validateConfig: validateConfig,
  }

  boot(window.__startersV3AlgoliaConfig)
})()
