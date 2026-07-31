/**
 * /starter-onboarding — mark onboarding done on a successful submit.
 *
 * ONE job: when either of the page's two native Webflow forms (full profile and
 * consult; both count as completing onboarding) reaches its Webflow success
 * state, PATCH the Xano endpoint that sets `onboarding_done = true`.
 *
 * PAIRED WITH v3/onboarding-done-redirect.js, which sends a member whose record
 * already carries `onboarding_done === true` off this page. That check would
 * bounce the member who just submitted before the page's own completion view
 * could be read, so a success here writes the `sessionStorage` marker
 * 'starter-onboarding-just-submitted' BEFORE the PATCH, and the redirect module
 * consumes it on the next load to skip its check exactly once. The two files
 * install together as a pair of deferred tags on /starter-onboarding; either one
 * alone is a broken half of the flow.
 *
 * FAIL-OPEN, EVERYWHERE. Logged out, Memberstack missing or slow, token trade
 * rejected, HTTP error, request timeout, storage that refuses to be written:
 * every one of those leaves the page exactly as authored, showing the completion
 * state the member just earned. A mark that never lands is recoverable — the
 * member is simply not redirected away on a later visit — so nothing here is
 * allowed to throw at the page or stand between a submit and its success view.
 *
 * Auth is the proven trade-token flow the sibling v3 modules use (see
 * opportunities-3.0.js, v3/starter-dashboard-points.js): the Memberstack JWT
 * from `getMemberCookie()` is traded at api:g1vmSLWh/auth/trade-token/v3 for a
 * Xano token, which authorizes the api:KZf7nFnk PATCH as a bearer. The traded
 * token is memoized for the page so the retries share one trade, and dropped on
 * failure so the next attempt re-trades rather than reusing a token that just
 * failed.
 *
 * Install: TWO deferred tags on /starter-onboarding and nowhere else — this file
 * and v3/onboarding-done-redirect.js, versioned and shipped together, never one
 * without the other. Diagnostics are staging-only (`*.webflow.io`, localhost,
 * 127.0.0.1, `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`);
 * production is silent. Page wiring and the staging QA order: see
 * v3/ONBOARDING-PATCH-STATUS-WIRING.md.
 */
;(function () {
  'use strict'

  if (window.__startersPatchOnboardingStatusBooted) return
  window.__startersPatchOnboardingStatusBooted = true

  var XANO_AUTH_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:g1vmSLWh'
  var XANO_ONBOARDING_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk'
  var TRADE_TOKEN_PATH = '/auth/trade-token/v3'
  var SET_STATUS_PATH = '/starters_onboarding/set_onboarding_status'

  var ONBOARDING_PATHS = ['/starter-onboarding', '/starter-onboarding/']
  // Same production allowlist as v3/route-guard.js, plus the local/dev-tunnel
  // hosts the ./dev-tunnel.sh loop serves from — without those the module would
  // be dead on staging exactly when it needs QA.
  var APPROVED_HOSTS = ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']

  // Written here, consumed by v3/onboarding-done-redirect.js.
  // Namespaced so it cannot collide with Webflow, Memberstack, or the step-flow
  // script driving this page's panels. sessionStorage (not localStorage) on
  // purpose: the skip is meant for this tab's immediate post-submit view, not
  // forever.
  var JUST_SUBMITTED_KEY = 'starter-onboarding-just-submitted'

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
  var LOG_PREFIX = '[starters patch-onboarding-status]'

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

  /* -------------------------- mark done on submit --------------------------- */

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

  // Success is detected per `.w-form` wrapper, not per submit click: a click only
  // means "tried", and the panel script on this page owns the buttons and their
  // own click handling. Firing at most once per wrapper per page load keeps a
  // re-render or a second mutation from double-PATCHing.
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

  /**
   * A Webflow form with a Redirect URL set in the Designer navigates away on AJAX
   * success and never reveals `.w-form-done`, so the watcher below can never fire
   * and the PATCH becomes structurally unreachable. That failure is invisible
   * from here — an unmarked member looks exactly like one who never submitted —
   * so it gets called out by name. Diagnostic only: the observer is still
   * installed, because opting out would be the wrong bet if Webflow's success
   * behaviour ever changes.
   */
  function warnAboutSuccessRedirect(form) {
    if (!form || typeof form.getAttribute !== 'function') return false
    var redirect = form.getAttribute('data-redirect') || form.getAttribute('redirect')
    if (typeof redirect !== 'string' || redirect === '') return false

    var name = form.getAttribute('data-name') || form.getAttribute('id')
    warn(
      (name ? 'form "' + name + '"' : 'a form') +
        ' has a success redirect ("' +
        redirect +
        '"): Webflow navigates on success and the done state never shows, so ' +
        'completion can never be detected here. ' +
        "Remove the form's Redirect URL in the Designer.",
    )
    return true
  }

  function watchForm(wrapper) {
    if (!wrapper || typeof wrapper.querySelector !== 'function') return false
    if (wrapper.__startersOnboardingDoneWatched) return false
    var form = wrapper.querySelector(FORM_SELECTOR)
    if (!form) return false

    warnAboutSuccessRedirect(form)

    var done = wrapper.querySelector(DONE_SELECTOR)
    if (!done) {
      warn('a .w-form wrapper on this page has no ' + DONE_SELECTOR + ' sibling; skipping it.')
      return false
    }
    // Already visible at parse time means this is not a submit we witnessed (a
    // re-served page, an authored preview), and PATCHing on it would mark a
    // member who never submitted on this load.
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
  }

  window.StartersPatchOnboardingStatus = {
    allowedHost: allowedHost,
    stagingHost: stagingHost,
    isOnboardingPath: isOnboardingPath,
    diagnosticsEnabled: diagnosticsEnabled,
    isShown: isShown,
    watchForms: watchForms,
    markOnboardingDone: markOnboardingDone,
    justSubmittedKey: JUST_SUBMITTED_KEY,
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
