/**
 * /starters-onboarding — completion redirect and "done" marker.
 *
 * Two jobs, one page-scoped module:
 *
 *   1. ON LOAD — a member whose Xano freelancer record already carries
 *      `onboarding_done === true` is sent to /starter-dashboard with
 *      `location.replace()`, so a finished member cannot land back inside the
 *      onboarding flow from a bookmark, the back button, or a stale link.
 *   2. ON SUCCESSFUL SUBMIT — when either of the page's two native Webflow
 *      forms (full profile and consult; both count as completing onboarding)
 *      reaches its Webflow success state, the module PATCHes the Xano endpoint
 *      that sets `onboarding_done = true`.
 *
 * Those two jobs would fight each other without the fresh-submit beat. The
 * member who just submitted has to see the page's own completion/preview state
 * rather than be bounced to the dashboard, so a successful submit writes a
 * `sessionStorage` marker and the next load consumes it — reads it, removes it,
 * and skips job 1 exactly once.
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
 * Xano token, which authorizes both api:KZf7nFnk calls as a bearer. The traded
 * token is memoized for the page so the guard and the submit hook share one
 * trade, and dropped on failure so a retry re-trades rather than reusing a
 * token that just failed.
 *
 * Install: ONE deferred tag, on /starters-onboarding only. Diagnostics are
 * staging-only (`*.webflow.io`, localhost, 127.0.0.1, `*.trycloudflare.com`, or
 * `window.STARTERS_DEBUG === true`); production is silent. Page wiring and the
 * staging QA order: see v3/ONBOARDING-DONE-REDIRECT-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersOnboardingDoneRedirectBooted) return
  window.__startersOnboardingDoneRedirectBooted = true

  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var GET_FREELANCERS_PATH = '/starters_onboarding/get_freelancers'
  var SET_STATUS_PATH = '/starters_onboarding/set_onboarding_status'

  var ONBOARDING_PATHS = ['/starters-onboarding', '/starters-onboarding/']
  var DASHBOARD_PATH = '/starter-dashboard'
  // Same production allowlist as v3/route-guard.js, plus the local/dev-tunnel
  // hosts the ./dev-tunnel.sh loop serves from — without those the module would
  // be dead on staging exactly when it needs QA.
  var APPROVED_HOSTS = ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']

  // Namespaced so it cannot collide with Webflow, Memberstack, or the vendor
  // multi-step script. sessionStorage (not localStorage) on purpose: the skip is
  // meant for this tab's immediate post-submit view, not forever.
  var JUST_SUBMITTED_KEY = 'starters-onboarding-just-submitted'

  var MEMBERSTACK_TIMEOUT_MS = 8000
  var MEMBERSTACK_POLL_MS = 100
  var REQUEST_TIMEOUT_MS = 8000
  // Initial attempt plus these two delays. A failed mark is recoverable — the
  // next visit simply redirects late — so this gives up quietly rather than
  // hammering Xano or blocking the completion view.
  var PATCH_RETRY_DELAYS_MS = [1000, 3000]

  var FORM_WRAPPER_SELECTOR = '.w-form'
  var FORM_SELECTOR = 'form'
  var DONE_SELECTOR = '.w-form-done'
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

  function markJustSubmitted() {
    try {
      window.sessionStorage.setItem(JUST_SUBMITTED_KEY, '1')
      return true
    } catch (error) {
      warn('could not write the fresh-submit marker: ' + describe(error))
      return false
    }
  }

  /* --------------------------------- fetch --------------------------------- */

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms)
    })
  }

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

  /* ------------------------- job 1: redirect on visit ------------------------ */

  /**
   * `{"freelancer": [ <one record> ]}`, and an empty envelope for a member with
   * no row yet. Only a literal `true` redirects: anything else — missing key,
   * empty array, absent field, a string, a malformed body — is read as "not
   * done" so the failure mode is always "the page renders".
   */
  function onboardingDone(payload) {
    var records = payload && payload.freelancer
    if (!Array.isArray(records) || records.length === 0) return false
    var record = records[0]
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

  /* ------------------------ job 2: mark done on submit ----------------------- */

  async function markOnboardingDone() {
    var attempts = PATCH_RETRY_DELAYS_MS.length + 1
    var lastError = null

    for (var attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await delay(PATCH_RETRY_DELAYS_MS[attempt - 1])
      try {
        var token = await xanoToken()
        var response = await fetchWithTimeout(XANO_ONBOARDING_BASE + SET_STATUS_PATH, {
          method: 'PATCH',
          headers: authHeaders(token),
        })
        if (response && response.ok) {
          note('onboarding_done set on attempt ' + (attempt + 1) + '.')
          return true
        }
        throw new Error(
          'set_onboarding_status responded ' + ((response && response.status) || 'no response'),
        )
      } catch (error) {
        lastError = error
        // The token may itself be the reason this failed; re-trade next round
        // rather than replaying a token Xano just rejected.
        forgetXanoToken()
        if (error && error.code === 'logged-out') break
      }
    }

    warn(
      'gave up marking onboarding_done after ' +
        attempts +
        ' attempts: ' +
        describe(lastError) +
        ' — the member can still be marked on a later visit.',
    )
    return false
  }

  /**
   * Webflow's AJAX success path hides the `form` and reveals its sibling
   * `.w-form-done`, which ships with an inline `display:none`, by writing a new
   * inline `display`. So an inline value that is neither empty nor "none" is the
   * positive signal; `offsetParent` is the fallback for a page whose done state
   * is driven by a class instead.
   */
  function isShown(element) {
    if (!element) return false
    var inline = (element.style && element.style.display) || ''
    if (inline === 'none') return false
    if (inline !== '') return true
    return !!element.offsetParent
  }

  // Success is detected per `.w-form` wrapper, not per submit click: a click
  // only means "tried", and the vendor multi-step script on this page fires its
  // own click handling first. Firing at most once per wrapper per page load
  // keeps a re-render or a second mutation from double-PATCHing.
  function handleFormSuccess(wrapper) {
    if (!wrapper || wrapper.__startersOnboardingDoneFired) return false
    wrapper.__startersOnboardingDoneFired = true

    // Set the marker BEFORE the PATCH: the completion view must survive even if
    // the write fails or the member navigates while it is in flight.
    markJustSubmitted()
    note('form success detected; marking onboarding done.')
    markOnboardingDone().catch(function (error) {
      warn('unexpected failure marking onboarding done: ' + describe(error))
    })
    return true
  }

  function watchForm(wrapper) {
    if (!wrapper || typeof wrapper.querySelector !== 'function') return false
    if (wrapper.__startersOnboardingDoneWatched) return false
    if (!wrapper.querySelector(FORM_SELECTOR)) return false

    var done = wrapper.querySelector(DONE_SELECTOR)
    if (!done) {
      warn('a .w-form wrapper on this page has no ' + DONE_SELECTOR + ' sibling; skipping it.')
      return false
    }
    // Already visible at parse time means this is not a submit we witnessed
    // (a re-served page, an authored preview). Job 1's marker owns that case.
    if (isShown(done)) return false
    if (typeof window.MutationObserver !== 'function') {
      warn('MutationObserver unavailable; submit success cannot be detected.')
      return false
    }

    wrapper.__startersOnboardingDoneWatched = true
    var observer = new window.MutationObserver(function () {
      if (!isShown(done)) return
      observer.disconnect()
      handleFormSuccess(wrapper)
    })
    observer.observe(done, { attributes: true, attributeFilter: ['style', 'class'] })
    return true
  }

  function watchForms() {
    var wrappers = document.querySelectorAll(FORM_WRAPPER_SELECTOR)
    var list = wrappers ? Array.prototype.slice.call(wrappers) : []
    if (list.length === 0) {
      warn('no ' + FORM_WRAPPER_SELECTOR + ' wrapper found; nothing to watch for submit success.')
      return 0
    }
    var watched = 0
    list.forEach(function (wrapper) {
      if (watchForm(wrapper)) watched += 1
    })
    note('watching ' + watched + ' of ' + list.length + ' form wrappers for success.')
    return watched
  }

  /* ---------------------------------- boot ---------------------------------- */

  function start() {
    watchForms()

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
    isShown: isShown,
    watchForms: watchForms,
    markOnboardingDone: markOnboardingDone,
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
