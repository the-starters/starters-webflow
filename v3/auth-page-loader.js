/**
 * Minimal V3 authentication-page runtime loader.
 *
 * @release v1.59.441
 *
 * Install once in the V3 site Head Code after Memberstack and the shared
 * `window.memberReady` initializer. It replaces the static sitewide
 * `route-guard.js` tag and the page-level `auth-route.js` tags.
 *
 * On /login, /starter-login, and /auth-route it inserts only route-guard.js and
 * auth-route.js. Other application controllers must stay inside the
 * `StartersV3AuthPageLoader.shouldLoadApplicationControllers()` condition in
 * the complete site Head Code. On all other pages it inserts route-guard.js
 * only; the existing site-head controller block remains authoritative there.
 *
 * Both dynamic scripts have `async = false`. Browsers can download them in
 * parallel but must execute them in insertion order, which preserves the
 * stable plan-ID role contract before the router consumes it.
 */
;(function () {
  'use strict'

  if (window.__startersV3AuthPageLoaderBooted) return
  window.__startersV3AuthPageLoaderBooted = true

  var APPROVED_HOSTS = new Set([
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ])
  var AUTH_PATHS = new Set(['/login', '/starter-login', '/auth-route'])
  var ROUTE_GUARD_PATH = 'v3/route-guard.js'
  var AUTH_ROUTE_PATH = 'v3/auth-route.js'
  var DEFAULT_BASE =
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/'
  var TIMING_STORAGE_KEY = 'thestarters:v3-auth-route-timing'
  var TIMING_MARK_PREFIX = 'starters:v3-auth-route:'
  var TIMING_MAX_AGE_MS = 120000

  function isApprovedHost(hostname) {
    return APPROVED_HOSTS.has(String(hostname || '').toLowerCase())
  }

  function isAuthPath(pathname) {
    return AUTH_PATHS.has(pathname || '')
  }

  function shouldLoadApplicationControllers(pathname) {
    return !isAuthPath(pathname)
  }

  function loaderBase() {
    try {
      var current = document.currentScript
      var src = current && current.src
      if (!src) return DEFAULT_BASE
      var suffix = 'v3/auth-page-loader.js'
      var index = src.indexOf(suffix)
      return index === -1 ? DEFAULT_BASE : src.slice(0, index)
    } catch (error) {
      return DEFAULT_BASE
    }
  }

  function appendOrderedScript(src, name) {
    var script = document.createElement('script')
    script.src = src
    script.async = false
    script.defer = false
    script.setAttribute('data-starters-auth-runtime', name)
    ;(document.head || document.documentElement).appendChild(script)
    return script
  }

  function install(pathname) {
    var base = loaderBase()
    var installed = [appendOrderedScript(base + ROUTE_GUARD_PATH, 'route-guard')]
    if (isAuthPath(pathname)) {
      installed.push(appendOrderedScript(base + AUTH_ROUTE_PATH, 'auth-route'))
    }
    return installed
  }

  function finishNavigationTiming(pathname) {
    if (isAuthPath(pathname)) return null
    var parsed
    try {
      var raw = window.sessionStorage.getItem(TIMING_STORAGE_KEY)
      parsed = raw ? JSON.parse(raw) : null
    } catch (error) {
      return null
    }

    var startedAt = parsed && Number(parsed.startedAt)
    if (!Number.isFinite(startedAt)) return null
    var elapsedMs = Date.now() - startedAt
    if (elapsedMs < 0 || elapsedMs > TIMING_MAX_AGE_MS) {
      try {
        window.sessionStorage.removeItem(TIMING_STORAGE_KEY)
      } catch (error) {}
      return null
    }

    try {
      if (window.performance && typeof window.performance.mark === 'function') {
        window.performance.mark(TIMING_MARK_PREFIX + 'destination-load')
      }
    } catch (error) {}
    try {
      window.dispatchEvent(
        new CustomEvent('starters:v3-auth-route-timing', {
          detail: { stage: 'destination-load', elapsedMs: elapsedMs },
        }),
      )
    } catch (error) {}
    try {
      window.sessionStorage.removeItem(TIMING_STORAGE_KEY)
    } catch (error) {}
    return elapsedMs
  }

  var api = {
    release: 'v1.59.441',
    authPaths: Array.from(AUTH_PATHS),
    isApprovedHost: isApprovedHost,
    isAuthPath: isAuthPath,
    shouldLoadApplicationControllers: shouldLoadApplicationControllers,
    finishNavigationTiming: finishNavigationTiming,
  }
  window.StartersV3AuthPageLoader = api

  if (!isApprovedHost(window.location && window.location.hostname)) return
  install((window.location && window.location.pathname) || '')

  if (!isAuthPath((window.location && window.location.pathname) || '')) {
    if (document.readyState === 'complete') {
      finishNavigationTiming(window.location.pathname)
    } else if (typeof window.addEventListener === 'function') {
      window.addEventListener(
        'load',
        function () {
          finishNavigationTiming(window.location.pathname)
        },
        { once: true },
      )
    }
  }
})()
