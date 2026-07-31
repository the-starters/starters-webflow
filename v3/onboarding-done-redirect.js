/**
 * /starter-onboarding — completion redirect.
 *
 * ONE job: a member whose Xano freelancer record already carries
 * `onboarding_done === true` is sent to /starter-dashboard with
 * `location.replace()`, so a finished member cannot land back inside the
 * onboarding flow from a bookmark, the back button, or a stale link.
 *
 * PAIRED WITH v3/patch-onboarding-status.js, which owns the writing half: when
 * one of this page's Webflow forms reaches its success state, that module PATCHes
 * Xano and leaves the `sessionStorage` marker 'starter-onboarding-just-submitted'
 * behind. Unread, this check would bounce the member who just submitted straight
 * past the page's own completion/preview state — so the marker is consumed here
 * on every load: read it, remove it, and skip the redirect exactly once. The two
 * files install together as a pair of deferred tags on /starter-onboarding;
 * either one alone is a broken half of the flow.
 *
 * FAIL-OPEN, EVERYWHERE. Logged out, Memberstack missing or slow, token trade
 * rejected, HTTP error, malformed envelope, request timeout: every one of those
 * leaves the page exactly as authored. This redirect is a UX courtesy, never a
 * security boundary — Memberstack gated content and Xano endpoint authorization
 * remain the enforced layers, and a member who should not see this page is
 * still handled by v3/route-guard.js.
 *
 * Auth is the proven trade-token flow the sibling v3 modules use (see
 * opportunities-3.0.js, v3/starter-dashboard-points.js): the Memberstack JWT
 * from `getMemberCookie()` is traded at api:g1vmSLWh/auth/trade-token/v3 for a
 * Xano token, which authorizes the api:KZf7nFnk read as a bearer. The traded
 * token is memoized for the page, and dropped on failure so a retry re-trades
 * rather than reusing a token that just failed.
 *
 * Install: TWO deferred tags on /starter-onboarding and nowhere else — this file
 * and v3/patch-onboarding-status.js, versioned and shipped together, never one
 * without the other. Diagnostics are staging-only (`*.webflow.io`, localhost,
 * 127.0.0.1, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`);
 * production is silent. Page wiring and the staging QA order: see
 * v3/ONBOARDING-DONE-REDIRECT-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersOnboardingDoneRedirectBooted) return
  window.__startersOnboardingDoneRedirectBooted = true

  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var GET_FREELANCERS_PATH = '/starters_onboarding/get_freelancers'

  var ONBOARDING_PATHS = ['/starter-onboarding', '/starter-onboarding/']
  var DASHBOARD_PATH = '/starter-dashboard'
  // Same production allowlist as v3/route-guard.js, plus the local/dev-tunnel
  // hosts the ./dev-tunnel.sh loop serves from — without those the module would
  // be dead on staging exactly when it needs QA.
  var APPROVED_HOSTS = ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']

  // Consumed here, written by v3/patch-onboarding-status.js.
  // Namespaced so it cannot collide with Webflow, Memberstack, or the step-flow
  // script driving this page's panels. sessionStorage (not localStorage) on
  // purpose: the skip is meant for this tab's immediate post-submit view, not
  // forever.
  var JUST_SUBMITTED_KEY = 'starter-onboarding-just-submitted'

  var MEMBERSTACK_TIMEOUT_MS = 8000
  var MEMBERSTACK_POLL_MS = 100
  var REQUEST_TIMEOUT_MS = 8000

  var LOG_PREFIX = '[starters onboarding-done]'

  /* ------------------------------ environment ------------------------------ */

  // Anchored on purpose (same shape as v3/onboarding-profile-preview.js): a
  // lookalike such as "notwebflow.io" or "evil-trycloudflare.com" must not read
  // as staging, because this gate also decides whether the module runs at all.
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

  function isOnboardingPath(pathname) {
    return ONBOARDING_PATHS.indexOf(pathname) !== -1
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

  /* --------------------------- fresh-submit marker -------------------------- */
  // Every sessionStorage touch is wrapped: Safari private mode throws on access,
  // and a storage failure must never take the page down with it. A marker that
  // cannot be written just means the next load redirects one beat too early.

  function consumeJustSubmitted() {
    try {
      var value = window.sessionStorage.getItem(JUST_SUBMITTED_KEY)
      if (value === null || typeof value === 'undefined') return false
      window.sessionStorage.removeItem(JUST_SUBMITTED_KEY)
      return true
    } catch (error) {
      return false
    }
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
        window.$memberstackDom &&
        typeof window.$memberstackDom.getMemberCookie === 'function'
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

  // Tolerant parsing copied verbatim in spirit from opportunities-3.0.js:
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
   * `{"freelancer": [ <one record> ]}`, and an empty envelope for a member with
   * no row yet. Only a literal `true` redirects: anything else — missing key,
   * empty array, absent field, a string, a malformed body — is read as "not
   * done" so the failure mode is always "the page renders".
   */
  function onboardingDone(payload) {
    var records = payload && payload.freelancer
    if (!Array.isArray(records) || records.length === 0) {
      note('freelancer record: none — onboarding_done unknown, treated as not done.')
      return false
    }
    var record = records[0]
    note('freelancer record found; onboarding_done = ' + (record ? JSON.stringify(record.onboarding_done) : 'unreadable record'))
    return !!record && record.onboarding_done === true
  }

  async function fetchOnboardingDone() {
    var token = await xanoToken()
    var response = await fetchWithTimeout(XANO_ONBOARDING_BASE + GET_FREELANCERS_PATH, {
      headers: authHeaders(token),
    })
    if (!response.ok) {
      forgetXanoToken()
      throw new Error('get_freelancers responded ' + response.status)
    }
    var data = await response.json().catch(function () {
      return null
    })
    return onboardingDone(data)
  }

  async function redirectIfDone() {
    var done
    try {
      done = await fetchOnboardingDone()
    } catch (error) {
      if (error && error.code === 'logged-out') {
        note('no member session; leaving the onboarding page alone.')
      } else {
        warn('could not read onboarding status, staying put: ' + describe(error))
      }
      return false
    }

    if (!done) {
      note('onboarding not marked done; rendering the page.')
      return false
    }

    note('onboarding already done; replacing with ' + DASHBOARD_PATH + '.')
    window.location.replace(DASHBOARD_PATH)
    return true
  }

  /* ---------------------------------- boot ---------------------------------- */

  function start() {
    // Consumed on every load, whether or not it is present, so a marker left by
    // an abandoned submit can never suppress more than the one next load.
    if (consumeJustSubmitted()) {
      note('fresh submit marker consumed; skipping the redirect check once.')
      return
    }

    redirectIfDone().catch(function (error) {
      warn('unexpected redirect-check failure: ' + describe(error))
    })
  }

  window.StartersOnboardingDoneRedirect = {
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isOnboardingPath: isOnboardingPath,
    diagnosticsEnabled: diagnosticsEnabled,
    onboardingDone: onboardingDone,
    redirectIfDone: redirectIfDone,
    justSubmittedKey: JUST_SUBMITTED_KEY,
    dashboardPath: DASHBOARD_PATH,
  }

  if (!allowedHost(window.location.hostname)) return
  if (!isOnboardingPath(window.location.pathname)) return

  // With `defer` the document is already parsed; the readyState branch only
  // matters if the tag is ever moved into the head without it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
