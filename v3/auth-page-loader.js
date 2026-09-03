/**
 * Minimal V3 authentication-page runtime loader.
 *
 * @release v1.59.441
 *
 * Install once in the V3 site Head Code after Memberstack and the shared
 * `window.memberReady` initializer, and before the conditional site
 * application block. It replaces the page-level `auth-route.js` tags. It does
 * not replace the sitewide `route-guard.js` tag.
 *
 * On /login, /starter-login, and /auth-route it inserts route-guard.js and
 * then auth-route.js, and the site application block must skip itself through
 * `StartersV3AuthPageLoader.shouldLoadApplicationControllers()`. On every other
 * page the loader inserts nothing. The sitewide `route-guard.js` tag stays
 * inside that parser-blocking application block, so it keeps executing before
 * every page-level controller that reads `window.StartersV3RouteGuard`.
 *
 * Both dynamic scripts have `async = false`. Browsers can download them in
 * parallel but must execute them in insertion order, which preserves the
 * stable plan-ID role contract before the router consumes it.
 *
 * The loader only serves child assets from the release ref it was itself served
 * from. When it cannot read its own `src` it fails closed and installs nothing
 * rather than mixing refs.
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
      if (!src) return null
      var suffix = 'v3/auth-page-loader.js'
      var index = src.indexOf(suffix)
      return index === -1 ? null : src.slice(0, index)
    } catch (error) {
      return null
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
    if (!isAuthPath(pathname)) return []
    var base = loaderBase()
    if (!base) {
      console.error(
        '[v3-auth-page-loader] Cannot read its own release base from ' +
          'document.currentScript; auth runtime not installed.',
      )
      return []
    }
    return [
      appendOrderedScript(base + ROUTE_GUARD_PATH, 'route-guard'),
      appendOrderedScript(base + AUTH_ROUTE_PATH, 'auth-route'),
    ]
  }

  function discardTiming() {
    try {
      window.sessionStorage.removeItem(TIMING_STORAGE_KEY)
    } catch (error) {}
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
    // `redirectedAt` is stamped by /auth-route immediately before it hands off.
    // Without it the receipt belongs to a login attempt that never reached the
    // router — a rejected password, or a click away from the login page — and
    // its elapsed time would not measure a login-to-destination navigation.
    var redirectedAt = parsed && Number(parsed.redirectedAt)
    var elapsedMs = Date.now() - startedAt
    if (
      !Number.isFinite(redirectedAt) ||
      elapsedMs < 0 ||
      elapsedMs > TIMING_MAX_AGE_MS
    ) {
      discardTiming()
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
    discardTiming()
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
  var pathname = (window.location && window.location.pathname) || ''
  install(pathname)

  if (!isAuthPath(pathname)) {
    if (document.readyState === 'complete') {
      finishNavigationTiming(pathname)
    } else if (typeof window.addEventListener === 'function') {
      window.addEventListener(
        'load',
        function () {
          finishNavigationTiming(pathname)
        },
        { once: true },
      )
    }
  }
})()
