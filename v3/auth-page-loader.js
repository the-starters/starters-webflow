/**
 * Minimal V3 authentication-page runtime loader.
 *
 * @release v1.59.507
 *
 * Install once in the V3 site Head Code after Memberstack, the shared
 * `window.memberReady` initializer, the unconditional sitewide
 * `route-guard.js` tag, and `signup-attribution.js`, and before the
 * conditional application block. The page-level `auth-route.js` tag is the
 * only tag it ever replaces, and only after the cutover proof in
 * AUTH-ROUTE-WIRING.md.
 *
 * On /login, /starter-login, and /auth-route it inserts auth-route.js, and the
 * site application block skips the controllers unrelated to authentication and
 * attribution through
 * `StartersV3AuthPageLoader.shouldLoadApplicationControllers()`. On every other
 * page the loader inserts nothing.
 *
 * It does NOT insert route-guard.js. The static parser-inserted deferred
 * `route-guard.js` tag is the sole owner of guard delivery. Only `/auth-route`
 * reads the guard's role contract, so only there does this loader wait for
 * DOMContentLoaded before inserting auth-route.js; parser-inserted deferred
 * scripts finish before that event, so the guard has executed first. The two
 * login paths only configure the login form's `/auth-route` redirect and never
 * touch the guard contract, so their insert happens immediately and its fetch
 * overlaps the body parse — the form has to carry `redirect="/auth-route"`
 * before the member can submit it. Inserting a second copy of the guard would
 * download 43 KB — a fresh download whenever the two tags sit on different
 * release refs — purely to hit the guard's own boot guard and return.
 *
 * The inserted script has `async = false`, so it keeps insertion order against
 * anything else inserted dynamically.
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
  var ROUTE_PAGE_PATH = '/auth-route'
  var AUTH_PATHS = new Set(['/login', '/starter-login', ROUTE_PAGE_PATH])
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

  // `candidate` defaults to the path this loader booted on, so the site-head
  // call answers correctly whether or not it passes the pathname.
  function shouldLoadApplicationControllers(candidate) {
    var target = candidate === undefined ? pathname : candidate
    if (!isAuthPath(target)) return true
    return !canInstall
  }

  function installAuthRouter(candidate) {
    if (!isAuthPath(candidate)) return
    if (base === null) {
      console.error(
        '[v3-auth-page-loader] Cannot read its own release base from ' +
          'document.currentScript; auth runtime not installed.',
      )
      return
    }
    var script = document.createElement('script')
    script.src = base + AUTH_ROUTE_PATH
    script.async = false
    script.defer = false
    // The marker the cutover runbook reads to tell this element apart from a
    // page-level auth-route.js tag during the overlap window.
    script.setAttribute('data-starters-auth-runtime', 'auth-route')
    script.onerror = function () {
      try {
        document.documentElement.setAttribute(
          'data-auth-page-loader-error',
          'auth-route-load-failed',
        )
      } catch (error) {}
      // Only /auth-route has a visible routing-failure block, and it is only
      // honest while no router owns the page. The /auth-route insert happens
      // after DOMContentLoaded, by which point a parser-inserted page-level
      // fallback has already executed and set the boot guard, so this single
      // read cannot paint over a copy that is routing the member.
      if (
        candidate === ROUTE_PAGE_PATH &&
        !window.__startersV3AuthRouterBooted
      ) {
        try {
          document.documentElement.setAttribute(
            'data-auth-route-error',
            'auth-route-load-failed',
          )
        } catch (error) {}
      }
      try {
        window.dispatchEvent(
          new CustomEvent('starters:v3-auth-page-loader-error', {
            detail: { stage: 'auth-route-load-failed' },
          }),
        )
      } catch (error) {}
      console.error('[v3-auth-page-loader] auth-route.js failed to load.')
    }
    ;(document.head || document.documentElement).appendChild(script)
  }

  function discardTiming() {
    try {
      window.sessionStorage.removeItem(TIMING_STORAGE_KEY)
    } catch (error) {}
  }

  // Returns the login-submit timestamp and CONSUMES the receipt, so a
  // destination page the member abandons before `load` cannot leave it behind
  // for an unrelated navigation to report as a login-to-destination duration.
  function consumeNavigationTiming(candidate) {
    if (isAuthPath(candidate)) return null
    var parsed
    try {
      var raw = window.sessionStorage.getItem(TIMING_STORAGE_KEY)
      parsed = raw ? JSON.parse(raw) : null
    } catch (error) {
      discardTiming()
      return null
    }
    discardTiming()
    if (!parsed) return null

    var startedAt = Number(parsed.startedAt)
    // `redirectedAt` is stamped by /auth-route immediately before it hands off.
    // Without it the receipt belongs to a login attempt that never reached the
    // router — a rejected password, or a click away from the login page.
    var redirectedAt = Number(parsed.redirectedAt)
    if (!Number.isFinite(startedAt) || !Number.isFinite(redirectedAt)) {
      return null
    }
    if (!withinBudget(Date.now() - startedAt)) return null
    return startedAt
  }

  function withinBudget(elapsedMs) {
    return elapsedMs >= 0 && elapsedMs <= TIMING_MAX_AGE_MS
  }

  // Elapsed is measured HERE, not when the receipt was read, so the number
  // matches its `destination-load` label and includes the destination page load
  // it is named after.
  function emitNavigationTiming(startedAt) {
    if (startedAt === null) return
    var elapsedMs = Date.now() - startedAt
    if (!withinBudget(elapsedMs)) return

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
  }

  var api = {
    release: 'v1.59.507',
    authPaths: Array.from(AUTH_PATHS),
    isApprovedHost: isApprovedHost,
    isAuthPath: isAuthPath,
    shouldLoadApplicationControllers: shouldLoadApplicationControllers,
  }
  window.StartersV3AuthPageLoader = api

  if (!approvedHost) return
  // /auth-route is the only path whose router reads the deferred guard's role
  // contract, so it is the only one that has to wait for the guard. Waiting on
  // a login path would instead delay `redirect="/auth-route"` past the point
  // where the member can already submit the form.
  if (pathname === ROUTE_PAGE_PATH && document.readyState === 'loading') {
    window.addEventListener(
      'DOMContentLoaded',
      function () {
        installAuthRouter(pathname)
      },
      { once: true },
    )
  } else {
    installAuthRouter(pathname)
  }

  var startedAt = consumeNavigationTiming(pathname)
  if (startedAt !== null) {
    if (document.readyState === 'complete') {
      emitNavigationTiming(startedAt)
    } else if (typeof window.addEventListener === 'function') {
      window.addEventListener(
        'load',
        function () {
          emitNavigationTiming(startedAt)
        },
        { once: true },
      )
    }
  }
})()
