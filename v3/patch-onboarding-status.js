/**
 * /starter-onboarding — mark onboarding done on a successful submit, then send
 * the member to the dashboard.
 *
 * ONE job, in four beats: when either of the page's two native Webflow forms
 * (full profile and consult; both count as completing onboarding) reaches its
 * Webflow success state, reveal the optional `[data-page-spinner]` element,
 * hide the submitted form's `.w-form` wrapper, PATCH the Xano endpoint that sets
 * `onboarding_done = true`, and — once that PATCH settles either way —
 * `location.replace('/starter-dashboard')`. The member never reads Webflow's own
 * success message; the loader covers the patch window instead.
 *
 * The redirect fires even when the PATCH gave up. A member parked behind a
 * hidden form with no way forward is the one genuinely bad outcome here, and an
 * unmarked record costs only that the onboarding page renders again on a later
 * visit. The single exception is a member with no Memberstack session, who is
 * left exactly where they are.
 *
 * PAIRED WITH v3/onboarding-done-redirect.js, which reads the record on load and
 * keeps an already-done member from re-entering this page from a bookmark, the
 * back button, or a stale link. This module owns the whole post-submit journey,
 * so the two never fight over it. They install together as a pair of deferred
 * tags on /starter-onboarding; either one alone is a broken half of the flow.
 *
 * FAIL-OPEN, EVERYWHERE. Logged out, Memberstack missing or slow, token trade
 * rejected, HTTP error, request timeout, a loader element that was never built:
 * none of those is allowed to throw at the page or to stand between a submit and
 * its redirect. A mark that never lands is recoverable; a stuck member is not.
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
  var DASHBOARD_PATH = '/starter-dashboard'
  // Same production allowlist as v3/route-guard.js, plus the local/dev-tunnel
  // hosts the ./dev-tunnel.sh loop serves from — without those the module would
  // be dead on staging exactly when it needs QA.
  var APPROVED_HOSTS = ['the-starters-3-0.webflow.io', 'thestarters.com', 'www.thestarters.com']

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
  // Optional: an element the Designer may add, hidden by default, shown for the
  // length of the patch window. The page works without it.
  var LOADER_SELECTOR = '[data-page-spinner]'
  var LOG_PREFIX = '[starters patch-onboarding-status]'
  var CONTROLLER_VERSION = 'patch-onboarding-status-v1'
  var WORKFLOW = 'starter_onboarding_completion'
  var workflowDiagnosticsControllerScript = document.currentScript

  function loadWorkflowDiagnostics() {
    if (window.StartersWorkflowDiagnostics) return Promise.resolve(window.StartersWorkflowDiagnostics)
    if (window.__startersWorkflowDiagnosticsReady) return window.__startersWorkflowDiagnosticsReady
    var source = workflowDiagnosticsControllerScript && workflowDiagnosticsControllerScript.src
    if (!source || !document.createElement) return Promise.resolve(null)
    var url = ''
    try {
      var cdnRoot = source.match(
        /^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/,
      )
      url = cdnRoot
        ? cdnRoot[1] + 'utils/workflow-diagnostics.js'
        : new URL('../utils/workflow-diagnostics.js', source).href
    } catch (error) {
      return Promise.resolve(null)
    }
    window.__startersWorkflowDiagnosticsReady = new Promise(function (resolve) {
      var script = document.createElement('script')
      script.src = url
      script.async = false
      script.addEventListener('load', function () {
        resolve(window.StartersWorkflowDiagnostics || null)
      }, { once: true })
      script.addEventListener('error', function () { resolve(null) }, { once: true })
      ;(document.head || document.documentElement).appendChild(script)
    })
    return window.__startersWorkflowDiagnosticsReady
  }

  var workflowDiagnosticsReady = loadWorkflowDiagnostics()

  function diagnosticStart(wrapper) {
    var api = window.StartersWorkflowDiagnostics
    if (!api) return null
    var receipt = api.record(api.create({
      workflow: WORKFLOW,
      controller_version: CONTROLLER_VERSION,
      result: 'started',
      stage: 'request',
      request_started: false,
      resource_type: 'starter_onboarding',
    }))
    if (wrapper) {
      wrapper.__startersOnboardingDiagnostic = receipt
      wrapper.__startersOnboardingDiagnosticStartedAt = Date.now()
    }
    return receipt
  }

  function diagnosticComplete(wrapper, fields) {
    var api = window.StartersWorkflowDiagnostics
    if (!api) return null
    var receipt = api.record(api.complete(
      wrapper && wrapper.__startersOnboardingDiagnostic,
      fields || {},
    ))
    if (wrapper) wrapper.__startersOnboardingDiagnostic = receipt
    return receipt
  }

  function diagnosticErrorCode(outcome) {
    if (outcome && outcome.code === 'logged-out') return 'MEMBER_LOGGED_OUT'
    if (outcome && outcome.code === 'memberstack-unavailable') return 'MEMBERSTACK_UNAVAILABLE'
    if (outcome && outcome.timedOut) return 'REQUEST_TIMEOUT'
    if (outcome && outcome.status) return 'HTTP_ERROR'
    return 'ONBOARDING_STATUS_FAILED'
  }

  function decorateOnboardingReceipt(wrapper, receipt, kind) {
    var api = window.StartersWorkflowDiagnostics
    if (!wrapper || !api || !receipt || typeof wrapper.querySelector !== 'function') return false
    var target = wrapper.querySelector(
      kind === 'success' || kind === 'visible-error' ? DONE_SELECTOR : '.w-form-fail',
    )
    if (!target) return false
    var text = target.querySelector && target.querySelector('[data-workflow-diagnostic-message], div, p') || target
    if (text.__startersWorkflowDiagnosticBaseText === undefined) {
      text.__startersWorkflowDiagnosticBaseText = kind === 'visible-error'
        ? 'We could not confirm your member session. Please log in and try again.'
        : text.textContent ||
          (kind === 'success' ? 'Onboarding completed.' : 'We could not confirm onboarding status.')
    }
    text.textContent = api.message(text.__startersWorkflowDiagnosticBaseText, receipt)
    api.decorate(text, receipt)
    return true
  }

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

  /* ------------------------- post-submit page state ------------------------- */
  // Every DOM touch below is wrapped and every one of them is optional: the
  // PATCH and the redirect are the parts that matter, and a page whose loader
  // was never built, or whose wrapper refuses to be styled, must still complete
  // the flow rather than strand the member.

  /**
   * The loader is a Designer element that does not exist yet, so its absence is
   * an ordinary outcome, not a fault. Webflow ships hidden elements as an inline
   * `display:none`, sometimes alongside the `hidden` attribute, so both are
   * cleared.
   */
  function showLoader() {
    var loader = null
    try {
      loader = document.querySelector(LOADER_SELECTOR)
    } catch (error) {
      return null
    }
    if (!loader) {
      note('no ' + LOADER_SELECTOR + ' element on this page; continuing without a loader.')
      return null
    }
    try {
      if (loader.style) loader.style.display = 'block'
      if (typeof loader.removeAttribute === 'function') loader.removeAttribute('hidden')
    } catch (error) {
      warn('could not reveal the loader: ' + describe(error))
      return null
    }
    return loader
  }

  // Hides Webflow's success message along with the form: the member is on their
  // way to the dashboard and should not read a completion panel they are about
  // to lose.
  function hideWrapper(wrapper) {
    try {
      if (!wrapper || !wrapper.style) return false
      wrapper.style.display = 'none'
      return true
    } catch (error) {
      warn('could not hide the submitted form: ' + describe(error))
      return false
    }
  }

  // The logged-out branch is the one outcome that leaves the member on this
  // page, so it has to undo the two changes above: a loader spinning over a
  // hidden form with no redirect coming is exactly the stranding this module
  // exists to avoid. The wrapper goes back to its authored display rather than
  // a hard-coded one, since Webflow ships `.w-form` without an inline value.
  function restorePage(loader, wrapper) {
    try {
      if (loader && loader.style) loader.style.display = 'none'
      if (wrapper && wrapper.style) wrapper.style.display = ''
    } catch (error) {
      warn('could not restore the page after a logged-out submit: ' + describe(error))
    }
  }

  function goToDashboard() {
    note('patch settled; replacing with ' + DASHBOARD_PATH + '.')
    try {
      window.location.replace(DASHBOARD_PATH)
    } catch (error) {
      warn('could not redirect to ' + DASHBOARD_PATH + ': ' + describe(error))
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
    if (!response.ok) {
      var tradeError = new Error('Xano token trade failed with ' + response.status)
      tradeError.status = response.status || 0
      throw tradeError
    }
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

  /**
   * Resolves with an outcome instead of throwing, because the caller has to know
   * *why* a mark failed: every failure still redirects except a missing member
   * session, which is the one case where there is nothing to redirect to.
   */
  async function attemptMarkOnboardingDone() {
    var attempts = PATCH_RETRY_DELAYS_MS.length + 1
    var lastError = null
    var finalAttempt = 0

    for (var attempt = 0; attempt < attempts; attempt += 1) {
      finalAttempt = attempt
      if (attempt > 0) await delay(PATCH_RETRY_DELAYS_MS[attempt - 1])
      try {
        var token = await xanoToken()
        var response = await fetchWithTimeout(XANO_ONBOARDING_BASE + SET_STATUS_PATH, {
          method: 'PATCH',
          headers: authHeaders(token),
        })
        if (response && response.ok) {
          note('onboarding_done set on attempt ' + (attempt + 1) + '.')
          return { ok: true, code: null, status: response.status || 200, replayed: attempt > 0 }
        }
        var responseError = new Error(
          'set_onboarding_status responded ' + ((response && response.status) || 'no response'),
        )
        responseError.status = (response && response.status) || 0
        throw responseError
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
    return {
      ok: false,
      code: (lastError && lastError.code) || null,
      status: (lastError && Number(lastError.status)) || 0,
      timedOut: /timed out/i.test(describe(lastError)),
      replayed: finalAttempt > 0,
    }
  }

  // The plain boolean form, kept for hand-exercising the write on staging.
  async function markOnboardingDone() {
    var outcome = await attemptMarkOnboardingDone()
    return outcome.ok
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

    note('form success detected; marking onboarding done.')
    // Page state first, so the loader is up for the whole patch window rather
    // than for whatever is left of it. Neither call can throw, so neither can
    // stand between the submit and the PATCH.
    var loader = showLoader()
    hideWrapper(wrapper)

    Promise.resolve(workflowDiagnosticsReady).then(function () {
      diagnosticStart(wrapper)
      return attemptMarkOnboardingDone()
    }).then(
      function (outcome) {
        var receipt = diagnosticComplete(wrapper, {
          result: outcome && outcome.ok ? 'success' : 'failed',
          stage: 'response',
          error_code: outcome && outcome.ok ? '' : diagnosticErrorCode(outcome),
          http_status: outcome && outcome.status,
          duration_ms: Date.now() - (wrapper.__startersOnboardingDiagnosticStartedAt || Date.now()),
          request_started: !(
            outcome &&
            (outcome.code === 'logged-out' || outcome.code === 'memberstack-unavailable')
          ),
          replayed: Boolean(outcome && outcome.replayed),
        })
        decorateOnboardingReceipt(
          wrapper,
          receipt,
          outcome && outcome.ok
            ? 'success'
            : outcome && outcome.code === 'logged-out'
              ? 'visible-error'
              : 'error',
        )
        // A member with no session has nowhere to be sent, so the page is put
        // back the way it was found. Every other failure still redirects:
        // leaving them behind a hidden form is worse than a record that gets
        // marked on a later visit.
        if (outcome && outcome.code === 'logged-out') {
          note('no member session; restoring the page instead of redirecting.')
          restorePage(loader, wrapper)
          return
        }
        goToDashboard()
      },
      function (error) {
        var receipt = diagnosticComplete(wrapper, {
          result: 'failed',
          stage: 'response',
          error_code: 'ONBOARDING_STATUS_FAILED',
          duration_ms: Date.now() - (wrapper.__startersOnboardingDiagnosticStartedAt || Date.now()),
          request_started: true,
        })
        decorateOnboardingReceipt(wrapper, receipt, 'error')
        warn('unexpected failure marking onboarding done: ' + describe(error))
        goToDashboard()
      },
    )
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
    dashboardPath: DASHBOARD_PATH,
    loaderSelector: LOADER_SELECTOR,
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
