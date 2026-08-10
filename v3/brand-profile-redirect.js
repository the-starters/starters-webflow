/**
 * Brand platform pages — the inbound half of the Brand profile-completion loop.
 *
 * @release v1.59.116
 *
 * ONE job: a signed-in paid Brand whose Xano brand record exists but is not yet
 * marked complete is sent to /complete-profile with `location.replace()`, so a
 * Brand who abandoned the form halfway — or who never opened it, and reached a
 * locked page from a bookmark, the back button, nav, or a stale link — is put
 * back in front of the form instead of using the platform unfinished.
 *
 * IN-SCOPE PAGES (exact path + trailing-slash twin, plus /opportunities/<slug>):
 *   /brand-dashboard, /opportunities, /all-starters, /messages,
 *   /starter-dashboard, /dashboard
 * Install one deferred tag on each of those pages (or sitewide — out-of-scope
 * paths exit immediately). Paid-Brand only in effect: Talent / free-Brand get
 * has_record false from the endpoint and stay; the route guard still owns role
 * routing and runs first.
 *
 * PAIRED WITH v3/complete-profile-redirect.js, which owns the OUTBOUND half:
 * that module sits on /complete-profile and bounces a Brand who is already
 * finished forward to /brand-dashboard, plus the two wrong-role cases. Between
 * them the two pages form a closed loop, and the loop only stays closed because
 * BOTH halves answer from the SAME signal (decided 2026-08-06): Xano
 * `get_brand_profile_status` → `{has_record, brand_profile_done}`. The Memberstack
 * field `completed-brand-profile` is still written by the controller (it feeds
 * endpoint #1513's stamp) but nothing routes on it anymore — a split source
 * ping-pongs a fresh completer until the webhook lands. Xano is also where
 * /brand-dashboard's own data lives: if the record is not there yet, the
 * dashboard has nothing to render.
 *
 * THE DECISION TABLE, in the order the module walks it:
 *
 *   - sessionStorage marker set (just submitted)  → STAY, and do not call Xano
 *   - has_record true,  brand_profile_done false  → /complete-profile
 *   - has_record true,  brand_profile_done true   → STAY (the normal dashboard)
 *   - has_record false (any done value)           → STAY
 *   - logged out, Memberstack absent or slow      → STAY
 *   - trade failed, HTTP error, malformed, hung   → STAY
 *
 * Exactly one shape redirects. Everything else renders the page as authored.
 *
 * THE sessionStorage MARKER, and why it has to exist. Completion is written to
 * Memberstack by v3/brand-account-controller.js and only reaches Xano afterwards,
 * through the Memberstack webhook — so for a few seconds after a successful
 * submit, Xano still answers `brand_profile_done: false` for a Brand who is in
 * fact done. Without a bridge, the outbound half would forward the member to
 * /brand-dashboard and this module would immediately bounce them back to the form
 * they just completed. The controller therefore writes
 * `thestarters:v3-brand-profile-completed` into sessionStorage right after the
 * submit succeeds, and a non-empty value here is read as DONE: the network call is
 * skipped entirely and the dashboard renders. The marker is deliberately
 * sessionStorage and deliberately never cleared by this file — it dies with the
 * tab, by which time the webhook has long since landed and Xano answers for
 * itself. Every access is wrapped, because Safari private mode throws on the
 * property itself and a storage failure must not cost the member their dashboard.
 * Semantics match the other two readers of this key (complete-profile-redirect,
 * auth-route): a string counts once trimmed non-empty, and a non-string truthy
 * value counts as set.
 *
 * FAIL-OPEN, EVERYWHERE. Logged out, Memberstack missing or slow, token trade
 * rejected, HTTP error, malformed envelope, request timeout, storage that throws:
 * every one of those leaves the page exactly as authored, spinner included — it
 * comes back down on every outcome except a redirect that is already navigating,
 * and no DOM or storage failure around it is allowed to delay or prevent the
 * decision itself. The cost of that rule is one accepted wait: a visitor whose
 * Memberstack never loads sits under the spinner for the full 8-second budget
 * before it lowers. The bias is the whole risk posture — a paid Brand left on a
 * thin dashboard can navigate to the form themselves, while a Brand shoved onto a
 * form they already filled in because a transient Xano blip read as "not done" has
 * no way out. This redirect is a UX courtesy, never a security boundary:
 * Memberstack gated content and Xano endpoint authorization remain the enforced
 * layers, and role routing for /brand-dashboard stays entirely with
 * v3/route-guard.js (the page is `brand-paid` in its matrix).
 *
 * NO ROLE LOGIC HERE, on purpose. A Talent or free-Brand member who reaches
 * /brand-dashboard is the route guard's problem, and the guard runs first and
 * sitewide. For those members this endpoint answers `has_record: false` — they
 * have no Brand row — which falls into the fail-open branch and leaves the page
 * alone, so the two modules cannot fight over the same visitor.
 *
 * That answer costs a round trip, and until it lands the dashboard is fully
 * visible — so a member on their way to the form would watch the dashboard paint
 * and then vanish under the redirect. This module therefore owns the shared
 * `[data-page-spinner]` element for the length of its check: up before the read,
 * down again the moment the answer is "stay". When the answer is "go" it is left
 * up on purpose, because the navigation is already in flight and lowering it would
 * flash the dashboard one last time on the way out. A page with no spinner built
 * decides identically, minus the cover.
 *
 * Auth is the proven trade-token flow the sibling v3 modules use (see
 * v3/onboarding-done-redirect.js, opportunities-3.0.js): the Memberstack JWT from
 * `getMemberCookie()` is traded at api:g1vmSLWh/auth/trade-token/v3 for a Xano
 * token, which authorizes the api:KZf7nFnk read as a bearer. The traded token is
 * memoized for the page, and dropped on failure so a retry re-trades rather than
 * reusing a token that just failed.
 *
 * Install: one deferred page-level tag on each in-scope page (or sitewide — the
 * path gate exits immediately elsewhere), AFTER v3/route-guard.js so role
 * routing has already run. Diagnostics are staging-only (`*.webflow.io`,
 * localhost, 127.0.0.1, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`);
 * production is silent. Page wiring and QA: see v3/BRAND-PROFILE-REDIRECT-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersBrandProfileRedirectBooted) return
  window.__startersBrandProfileRedirectBooted = true

  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var BRAND_STATUS_PATH = '/starters_onboarding/get_brand_profile_status'

  // Exact paths only (both slash forms). No prefix rule catches a trailing-slash
  // twin, so each form needs its own entry. /opportunities/<slug> is matched
  // separately below — nested paths like …/apply are not in scope.
  var GUARDED_PATHS = [
    '/brand-dashboard',
    '/brand-dashboard/',
    '/opportunities',
    '/opportunities/',
    '/all-starters',
    '/all-starters/',
    '/messages',
    '/messages/',
    '/starter-dashboard',
    '/starter-dashboard/',
    '/dashboard',
    '/dashboard/',
  ]
  var COMPLETE_PROFILE_PATH = '/complete-profile'

  // Same production allowlist as v3/route-guard.js, plus the local/dev-tunnel
  // hosts the ./dev-tunnel.sh loop serves from — without those the module would
  // be dead on staging exactly when it needs QA.
  var APPROVED_HOSTS = ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']

  var MEMBERSTACK_TIMEOUT_MS = 8000
  var MEMBERSTACK_POLL_MS = 100
  var REQUEST_TIMEOUT_MS = 8000

  // Written by v3/brand-account-controller.js immediately after a successful
  // profile submit, and read here as "done" so the Memberstack → Xano webhook
  // latency cannot bounce a member back onto the form they just finished. Never
  // written or cleared by this file.
  var MARKER_KEY = 'thestarters:v3-brand-profile-completed'

  // Optional, and the same element v3/onboarding-done-redirect.js and
  // v3/patch-onboarding-status.js raise on /starter-onboarding. Different page,
  // so there is no sharing to coordinate here — only the selector convention.
  var LOADER_SELECTOR = '[data-page-spinner]'

  var LOG_PREFIX = '[starters brand-profile-redirect]'

  /* ------------------------------ environment ------------------------------ */

  // Anchored on purpose (same shape as the sibling v3 scripts): a lookalike such
  // as "notwebflow.io" or "evil-trycloudflare.com" must not read as staging,
  // because this gate also decides whether the module runs at all.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  function allowedHost(hostname) {
    return APPROVED_HOSTS.indexOf(hostname) !== -1 || stagingHost(hostname)
  }

  function isGuardedPath(pathname) {
    var path = pathname || ''
    if (GUARDED_PATHS.indexOf(path) !== -1) return true
    // Single-segment opportunity detail only (same shape as route-guard).
    return /^\/opportunities\/[^/]+\/?$/.test(path)
  }

  // Back-compat alias for console checks written against the dashboard-only name.
  function isBrandDashboardPath(pathname) {
    return isGuardedPath(pathname)
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never make the module run on an unapproved host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function note(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.info(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function describe(error) {
    return (error && error.message) || String(error)
  }

  /* ------------------------------ page spinner ------------------------------ */
  // Every access is guarded and every one of them is optional. The redirect
  // decision is the part that matters: a page with no spinner built, or a DOM
  // that refuses to be styled, must still reach the same answer at the same
  // speed. Looked up fresh each time rather than held between the raise and the
  // lower, so neither call depends on the other having worked.

  function findLoader() {
    try {
      return document.querySelector(LOADER_SELECTOR)
    } catch (error) {
      return null
    }
  }

  // Webflow ships hidden elements as an inline `display:none`, sometimes
  // alongside the `hidden` attribute, so both are cleared.
  function showLoader() {
    var loader = findLoader()
    if (!loader) {
      note('no ' + LOADER_SELECTOR + ' element on this page; the check runs uncovered.')
      return false
    }
    try {
      if (loader.style) loader.style.display = 'block'
      if (typeof loader.removeAttribute === 'function') loader.removeAttribute('hidden')
    } catch (error) {
      warn('could not reveal the spinner: ' + describe(error))
      return false
    }
    return true
  }

  // Back to the inline `display:none` Webflow authored it with. Silent when
  // there is no element: showLoader() has already said so once, and this runs on
  // every load.
  function hideLoader() {
    var loader = findLoader()
    if (!loader) return false
    try {
      if (loader.style) loader.style.display = 'none'
    } catch (error) {
      warn('could not hide the spinner: ' + describe(error))
      return false
    }
    return true
  }

  /* ---------------------------- completion marker ---------------------------- */

  /**
   * The webhook-latency bridge described in the header. Reading the property can
   * itself throw (Safari private mode), so the whole access is wrapped and a
   * failure reads as "no marker" — that costs one network call, which fails open
   * on its own, rather than costing the member their dashboard.
   *
   * Semantics deliberately match v3/complete-profile-redirect.js's read of this
   * shared session marker: a string counts once trimmed non-empty, and a
   * non-string truthy value counts as set.
   */
  function completionMarkerSet() {
    var value
    try {
      var storage = window.sessionStorage
      if (!storage || typeof storage.getItem !== 'function') return false
      value = storage.getItem(MARKER_KEY)
    } catch (error) {
      note('sessionStorage is unavailable, so the marker cannot be read: ' + describe(error))
      return false
    }
    if (typeof value === 'string') return value.trim() !== ''
    return !!value
  }

  /* --------------------------------- fetch --------------------------------- */

  // A hung request must not leave the member staring at a page that may still
  // redirect. AbortController is used when present so the socket is released
  // too, but the timeout stands either way.
  function fetchWithTimeout(url, options) {
    var config = options || {}
    var controller =
      typeof window.AbortController === 'function' ? new window.AbortController() : null
    if (controller) {
      config = {
        method: config.method,
        headers: config.headers,
        body: config.body,
        signal: controller.signal,
      }
    }

    return new Promise(function (resolve, reject) {
      var settled = false
      var timer = window.setTimeout(function () {
        if (settled) return
        settled = true
        if (controller) {
          try {
            controller.abort()
          } catch (error) {}
        }
        reject(new Error('Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms'))
      }, REQUEST_TIMEOUT_MS)

      Promise.resolve()
        .then(function () {
          return window.fetch(url, config)
        })
        .then(
          function (response) {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(response)
          },
          function (error) {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            reject(error)
          },
        )
    })
  }

  /* ---------------------------------- auth ---------------------------------- */

  function waitForMemberstack() {
    function ready() {
      return (
        window.$memberstackDom && typeof window.$memberstackDom.getMemberCookie === 'function'
      )
    }
    if (ready()) return Promise.resolve(window.$memberstackDom)

    return new Promise(function (resolve) {
      var startedAt = Date.now()
      var timer = window.setInterval(function () {
        if (ready()) {
          window.clearInterval(timer)
          resolve(window.$memberstackDom)
          return
        }
        if (Date.now() - startedAt >= MEMBERSTACK_TIMEOUT_MS) {
          window.clearInterval(timer)
          resolve(null)
        }
      }, MEMBERSTACK_POLL_MS)
    })
  }

  function loggedOutError() {
    var error = new Error('No Memberstack session')
    error.code = 'logged-out'
    return error
  }

  // Tolerant parsing copied in spirit from opportunities-3.0.js:
  // create_auth_token has been seen to answer a raw string, `{authToken}`, or
  // `{token}`, and all three are valid.
  async function tradeForXanoToken() {
    var memberstack = await waitForMemberstack()
    if (!memberstack) {
      var unavailable = new Error('Memberstack never became available')
      unavailable.code = 'memberstack-unavailable'
      throw unavailable
    }

    var memberstackToken = await memberstack.getMemberCookie()
    if (!memberstackToken) throw loggedOutError()

    var response = await fetchWithTimeout(
      XANO_AUTH_BASE + TRADE_TOKEN_PATH + '?token=' + encodeURIComponent(memberstackToken),
    )
    var data = await response.json().catch(function () {
      return null
    })
    if (!response.ok) throw new Error('Xano token trade failed with ' + response.status)
    var token = typeof data === 'string' ? data : data && (data.authToken || data.token)
    if (!token) throw new Error('Xano token trade returned no token')
    return token
  }

  var xanoTokenPromise = null

  function xanoToken() {
    if (!xanoTokenPromise) {
      xanoTokenPromise = tradeForXanoToken().catch(function (error) {
        xanoTokenPromise = null
        throw error
      })
    }
    return xanoTokenPromise
  }

  function forgetXanoToken() {
    xanoTokenPromise = null
  }

  function authHeaders(token) {
    return { Authorization: 'Bearer ' + token }
  }

  /* ---------------------------- redirect on visit ---------------------------- */

  /**
   * `{"has_record": bool, "brand_profile_done": bool}`. Exactly one shape means
   * "send them to the form": a literal `true` for has_record alongside a literal
   * `false` for brand_profile_done. Anything else — a missing key, a string
   * `"false"`, a `0`, an absent record, a malformed body, null — is read as "do
   * not move them", so the failure mode is always "the dashboard renders".
   *
   * has_record false is also the answer this endpoint gives a Talent or free-Brand
   * session, which is why no role logic is needed here: those members simply fall
   * into the stay branch and the route guard handles them.
   */
  function needsBrandProfile(payload) {
    if (!payload || typeof payload !== 'object') {
      note('brand profile status: unreadable body — treated as "stay".')
      return false
    }
    if (payload.has_record !== true) {
      note(
        'brand profile status: has_record = ' +
          JSON.stringify(payload.has_record) +
          ' — no Brand record to complete, staying put.',
      )
      return false
    }
    note(
      'brand profile status: has_record = true, brand_profile_done = ' +
        JSON.stringify(payload.brand_profile_done),
    )
    return payload.brand_profile_done === false
  }

  async function fetchNeedsBrandProfile() {
    var token = await xanoToken()
    var response = await fetchWithTimeout(XANO_ONBOARDING_BASE + BRAND_STATUS_PATH, {
      headers: authHeaders(token),
    })
    if (!response.ok) {
      forgetXanoToken()
      throw new Error('get_brand_profile_status responded ' + response.status)
    }
    var data = await response.json().catch(function () {
      return null
    })
    return needsBrandProfile(data)
  }

  /**
   * Read, decide, and navigate. Deliberately does not touch the spinner, so it can
   * be called by hand on staging without the page moving underneath the console.
   * Returns true only when a navigation has been started.
   */
  async function redirectIfIncomplete() {
    // Before anything else, and before any network: a member who just submitted
    // is done, whatever Xano currently says.
    if (completionMarkerSet()) {
      note('completion marker is set; the webhook is still catching up — staying put.')
      return false
    }

    var incomplete
    try {
      incomplete = await fetchNeedsBrandProfile()
    } catch (error) {
      if (error && error.code === 'logged-out') {
        note('no member session; leaving the page alone.')
      } else {
        warn('could not read brand profile status, staying put: ' + describe(error))
      }
      return false
    }

    if (!incomplete) {
      note('brand profile does not need completing; staying put.')
      return false
    }

    note('brand profile is unfinished; replacing with ' + COMPLETE_PROFILE_PATH + '.')
    window.location.replace(COMPLETE_PROFILE_PATH)
    return true
  }

  /* ---------------------------------- boot ---------------------------------- */

  // The spinner is raised and lowered here and nowhere else, so the exposed
  // redirectIfIncomplete() stays a pure read-and-decide.
  function start() {
    showLoader()
    redirectIfIncomplete().then(
      function (redirecting) {
        // Left up on purpose when a redirect is in flight: the page is being
        // replaced, and uncovering it first would flash content the member is
        // on their way out of.
        if (redirecting) return
        hideLoader()
      },
      function (error) {
        warn('unexpected redirect-check failure: ' + describe(error))
        hideLoader()
      },
    )
  }

  window.StartersBrandProfileRedirect = {
    // Keep in sync with the @release line in this file's header comment; the
    // v3/brand-profile-redirect.test.js drift guard asserts they match.
    release: 'v1.59.116',
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isGuardedPath: isGuardedPath,
    isBrandDashboardPath: isBrandDashboardPath,
    diagnosticsEnabled: diagnosticsEnabled,
    completionMarkerSet: completionMarkerSet,
    needsBrandProfile: needsBrandProfile,
    redirectIfIncomplete: redirectIfIncomplete,
    guardedPaths: GUARDED_PATHS.slice(),
    brandDashboardPaths: GUARDED_PATHS.slice(),
    completeProfilePath: COMPLETE_PROFILE_PATH,
    markerKey: MARKER_KEY,
    loaderSelector: LOADER_SELECTOR,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isGuardedPath(window.location.pathname)) return

  // With `defer` the document is already parsed; the readyState branch only
  // matters if the tag is ever moved into the head without it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
