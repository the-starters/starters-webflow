/**
 * Minimal V3 authentication-page runtime loader.
 *
 * @release v1.59.504
 *
 * Install once in the V3 site Head Code after Memberstack, the shared
 * `window.memberReady` initializer, the unconditional sitewide
 * `route-guard.js` tag, and `signup-attribution.js`, and before the
 * conditional application block. It replaces the page-level `auth-route.js`
 * tags and nothing else.
 *
 * On /login, /starter-login, and /auth-route it inserts route-guard.js and
 * then auth-route.js, and the site application block skips the controllers
 * unrelated to authentication and attribution through
 * `StartersV3AuthPageLoader.shouldLoadApplicationControllers()`. On every other
 * page the loader inserts nothing.
 *
 * `route-guard.js` stays a static parser-blocking tag on every page, ahead of
 * this file, so the sitewide stable plan-ID role contract never depends on a
 * CDN round trip and never sits behind a conditional. Its own boot guard makes
 * the copy inserted here inert; the insertion exists so the auth paths keep
 * guard-before-router ordering on their own terms.
 *
 * Both dynamic scripts have `async = false`. Browsers can download them in
 * parallel but must execute them in insertion order, which preserves the
 * stable plan-ID role contract before the router consumes it.
 *
 * The loader only serves child assets from the release ref it was itself served
 * from. When it cannot read its own `src` it installs nothing, and
 * `shouldLoadApplicationControllers()` then answers true so the site's own
 * block still runs. A degraded loader must never leave a page with no runtime
 * at all.
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

  // Read while this script is still executing: `document.currentScript` is null
  // by the time the inline site-head block asks the questions below.
  var base = loaderBase()
  var approvedHost = isApprovedHost(window.location && window.location.hostname)
  var canInstall = approvedHost && base !== null
  var pathname = (window.location && window.location.pathname) || ''

  function shouldLoadApplicationControllers(candidate) {
    if (!isAuthPath(candidate)) return true
    return !canInstall
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

  function install(candidate) {
    if (!isAuthPath(candidate)) return []
    if (base === null) {
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

  // Consumes the receipt where it is read, so a destination page the member
  // abandons before `load` cannot leave it behind for an unrelated navigation
  // to report as a login-to-destination duration.
  function readNavigationTiming(candidate) {
    if (isAuthPath(candidate)) return null
    var parsed
    try {
      var raw = window.sessionStorage.getItem(TIMING_STORAGE_KEY)
      parsed = raw ? JSON.parse(raw) : null
    } catch (error) {
      return null
    }
    if (!parsed) return null
    discardTiming()

    var startedAt = Number(parsed.startedAt)
    // `redirectedAt` is stamped by /auth-route immediately before it hands off.
    // Without it the receipt belongs to a login attempt that never reached the
    // router — a rejected password, or a click away from the login page.
    var redirectedAt = Number(parsed.redirectedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(redirectedAt)) {
      return null
    }
    var elapsedMs = Date.now() - startedAt
    if (elapsedMs < 0 || elapsedMs > TIMING_MAX_AGE_MS) return null
    return elapsedMs
  }

  function emitNavigationTiming(elapsedMs) {
    if (elapsedMs === null) return null
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
    return elapsedMs
  }

  function finishNavigationTiming(candidate) {
    return emitNavigationTiming(readNavigationTiming(candidate))
  }

  var api = {
    release: 'v1.59.504',
    authPaths: Array.from(AUTH_PATHS),
    isApprovedHost: isApprovedHost,
    isAuthPath: isAuthPath,
    shouldLoadApplicationControllers: shouldLoadApplicationControllers,
    readNavigationTiming: readNavigationTiming,
    finishNavigationTiming: finishNavigationTiming,
  }
  window.StartersV3AuthPageLoader = api

  if (!approvedHost) return
  install(pathname)

  if (!isAuthPath(pathname)) {
    var pending = readNavigationTiming(pathname)
    if (pending !== null) {
      if (document.readyState === 'complete') {
        emitNavigationTiming(pending)
      } else if (typeof window.addEventListener === 'function') {
        window.addEventListener(
          'load',
          function () {
            emitNavigationTiming(pending)
          },
          { once: true },
        )
      }
    }
  }
})()
