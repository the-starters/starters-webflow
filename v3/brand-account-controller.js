/**
 * Brand signup plan, Build Account, and guarded identity email controller.
 *
 * Authority contract:
 *   - Memberstack owns identity, login email, custom fields, and profile image.
 *   - Xano endpoint #1513 consumes Memberstack webhooks and mirrors successful
 *     state into `user_v3` and the matching Brand or Talent role row by stable
 *     Memberstack member ID.
 *
 * This controller keeps the Designer-authored forms intact. It aligns the
 * native signup plan with the hostname's Memberstack data mode. On Build
 * Account, it prevents the native Webflow submission, validates the authored
 * fields, updates ordinary Memberstack fields first, updates login email only
 * when it changed, and sets the completion marker as its last durable member
 * write. Durable assignments are replay-safe; a failed retry repeats
 * assignments rather than creating another account or Brand row.
 *
 * Build Account does not send a password email when the member keeps the login
 * email they already authenticated with. If that email changes, Build Account
 * and Account Security attempt one reset email after the auth update succeeds.
 * Password email calls are never automatically retried; Memberstack's Forgot
 * Password flow is the recovery path when delivery cannot be confirmed.
 *
 * COMPLETION CONTRACT, SECOND HALF (2026-08-06). The durable answer is the
 * member field plus its Xano mirror, but the Memberstack webhook needs a moment
 * to land — so the instant the completion write resolves, this controller also
 * stamps the sessionStorage marker `thestarters:v3-brand-profile-completed`,
 * which v3/complete-profile-redirect.js and v3/auth-route.js read as "done"
 * without asking Xano. Best-effort and never blocking: a storage failure only
 * costs the member one fail-open Xano read.
 *
 * Login-email interception is also OFF by default so it cannot race the forms'
 * existing submit owners. The configured identity-scoped mode resolves the
 * current member through the canonical route-guard role contract, claims Brand
 * and Talent Account Security, and guards the visible Talent edit-profile form.
 * A valid changed login email can save independently when other required
 * profile fields are incomplete; a valid full-profile submit changes the login
 * email first and then replays its Designer-authored Xano submission:
 *   window.StartersBrandAccountConfig = { guardSecurityForm: 'identity' }
 * The legacy `brand` mode remains supported for a rollback-safe rollout.
 */
;(function () {
  'use strict'

  if (window.__startersBrandAccountControllerBooted) return
  window.__startersBrandAccountControllerBooted = true

  var ALLOWED_HOSTS = [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ]
  var BUILD_FORM_SELECTOR = '#wf-form-Complete-Profile-Form'
  var SECURITY_FORM_SELECTOR = '#wf-form-Account-Security'
  var STARTER_PROFILE_FORM_SELECTOR = '#wf-form-Build-Form-Full-Profile'
  var STARTER_PROFILE_EMAIL_SELECTOR = 'input[type="email"]'
  var QUIZ_SIGNUP_FORM_SELECTOR = '[data-quiz-form="signup"][data-ms-form="signup"]'
  var BRAND_SIGNUP_FORM_SELECTOR = [
    '#wf-form-Brand-Signup',
    QUIZ_SIGNUP_FORM_SELECTOR,
  ].join(', ')
  var LIVE_BRAND_PLAN_ID = 'pln_free-plan-f6kn0dxz'
  var TEST_BRAND_PLAN_ID = 'pln_dorxata-test-brand-plan-777r02pa'
  var OP_TIMEOUT_MS = 15000
  var RETRY_DELAYS_MS = [0, 300]
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  // Read by v3/complete-profile-redirect.js (outbound), v3/auth-route.js (login
  // hop), and v3/brand-profile-redirect.js (inbound) as "this member is done,
  // do not ask Xano". Written here and cleared by nobody: it dies with the tab,
  // by which time the Memberstack webhook has stamped brands_v3 for real.
  var BRAND_PROFILE_MARKER_KEY = 'thestarters:v3-brand-profile-completed'
  var BRAND_PROFILE_MARKER_VALUE = '1'
  var CONTROLLER_VERSION = 'brand-account-controller-v1'
  var WORKFLOW_DIAGNOSTICS_TIMEOUT_MS = 2000
  var NATIVE_FORM_DIAGNOSTICS_SCRIPT = 'native-form-diagnostics.js'
  var passwordEmailAttempts = new WeakMap()
  var workflowDiagnosticsControllerScript = document.currentScript
  var brandSignupPlanObserver = null
  var pendingBuildPasswordEmails = new WeakMap()

  function boundedWorkflowDiagnostics(promise) {
    return new Promise(function (resolve) {
      var settled = false
      var finish = function (api) {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(api || null)
      }
      var timer = window.setTimeout(function () { finish(null) }, WORKFLOW_DIAGNOSTICS_TIMEOUT_MS)
      Promise.resolve(promise).then(finish, function () { finish(null) })
    })
  }

  function loadWorkflowDiagnostics() {
    if (window.StartersWorkflowDiagnostics) return Promise.resolve(window.StartersWorkflowDiagnostics)
    if (window.__startersWorkflowDiagnosticsReady) {
      return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady)
    }
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
      var settled = false
      var finish = function (api) {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(api || null)
      }
      var timer = window.setTimeout(function () { finish(null) }, WORKFLOW_DIAGNOSTICS_TIMEOUT_MS)
      script.src = url
      script.async = false
      script.addEventListener('load', function () {
        finish(window.StartersWorkflowDiagnostics)
      }, { once: true })
      script.addEventListener('error', function () { finish(null) }, { once: true })
      ;(document.head || document.documentElement).appendChild(script)
    })
    return boundedWorkflowDiagnostics(window.__startersWorkflowDiagnosticsReady)
  }

  var workflowDiagnosticsReady = loadWorkflowDiagnostics()

  function loadNativeFormDiagnostics() {
    if (window.StartersNativeFormDiagnostics || !document.createElement) return
    var source = workflowDiagnosticsControllerScript && workflowDiagnosticsControllerScript.src
    if (!source) return
    var url = ''
    try {
      var cdnRoot = source.match(
        /^(https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/]+\/)/,
      )
      url = cdnRoot
        ? cdnRoot[1] + 'v3/' + NATIVE_FORM_DIAGNOSTICS_SCRIPT
        : new URL(NATIVE_FORM_DIAGNOSTICS_SCRIPT, source).href
    } catch (error) {
      return
    }
    if (document.querySelector('script[data-starters-native-form-diagnostics]')) return
    var script = document.createElement('script')
    script.src = url
    script.async = false
    script.setAttribute('data-starters-native-form-diagnostics', '')
    ;(document.head || document.documentElement).appendChild(script)
  }

  function workflowForOperation(operation) {
    if (operation === 'brand/account/build') return 'brand_account_build'
    if (operation === 'starter/account/email') return 'talent_account_email'
    return 'brand_account_email'
  }

  function diagnosticStart(form, operation) {
    var api = window.StartersWorkflowDiagnostics
    if (!api) return null
    var receipt = api.record(api.create({
      workflow: workflowForOperation(operation),
      controller_version: CONTROLLER_VERSION,
      result: 'started',
      stage: 'request',
      request_started: false,
      resource_type: 'member_account',
    }))
    if (form) {
      form.__startersAccountDiagnostic = receipt
      form.__startersAccountDiagnosticStartedAt = Date.now()
      form.__startersAccountDiagnosticRequestStarted = false
    }
    return receipt
  }

  function diagnosticComplete(form, fields) {
    var api = window.StartersWorkflowDiagnostics
    if (!api || !form || !form.__startersAccountDiagnostic) return null
    fields = Object.assign({}, fields || {}, {
      request_started: Boolean(form && form.__startersAccountDiagnosticRequestStarted),
    })
    var receipt = api.record(api.complete(form.__startersAccountDiagnostic, fields))
    form.__startersAccountDiagnostic = receipt
    return receipt
  }

  function diagnosticRequestStarted(form) {
    if (form) form.__startersAccountDiagnosticRequestStarted = true
  }

  function diagnosticErrorCode(error) {
    if (error && error.code === 'validation') return 'FORM_VALIDATION'
    if (error && error.passwordEmailAttempted) return 'PASSWORD_EMAIL_FAILED'
    var status = statusOf(error)
    if (status === 408) return 'REQUEST_TIMEOUT'
    if (status) return 'HTTP_ERROR'
    return 'ACCOUNT_UPDATE_FAILED'
  }

  function config() {
    return window.StartersBrandAccountConfig || {}
  }

  function allowedHost(hostname) {
    return (
      ALLOWED_HOSTS.indexOf(hostname) !== -1 ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(hostname || '')
    )
  }

  function signupPlanForHost(hostname) {
    return hostname === 'the-starters-3-0.webflow.io'
      ? TEST_BRAND_PLAN_ID
      : LIVE_BRAND_PLAN_ID
  }

  function configureBrandSignupPlan(hostname, selector) {
    var forms = document.querySelectorAll(selector || BRAND_SIGNUP_FORM_SELECTOR)
    var configured = false
    Array.prototype.forEach.call(forms, function (form) {
      if (form.getAttribute('data-ms-form') !== 'signup') return
      form.setAttribute('data-ms-plan:add', signupPlanForHost(hostname))
      configured = true
    })
    return configured
  }

  function watchForBrandSignupPlan(hostname) {
    if (brandSignupPlanObserver || !window.MutationObserver || !document.documentElement) {
      return false
    }
    brandSignupPlanObserver = new window.MutationObserver(function () {
      if (!configureBrandSignupPlan(hostname, QUIZ_SIGNUP_FORM_SELECTOR)) return
      brandSignupPlanObserver.disconnect()
      brandSignupPlanObserver = null
    })
    brandSignupPlanObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
    return true
  }

  function trim(value) {
    return String(value == null ? '' : value).trim()
  }

  function unwrapMember(result) {
    if (!result) return null
    return result.data || result.member || result
  }

  function memberEmail(member) {
    return trim(member && member.auth && member.auth.email).toLowerCase()
  }

  function inputValue(form, selector) {
    var input = form.querySelector(selector)
    return trim(input && input.value)
  }

  function buildValues(form) {
    return {
      firstName: inputValue(form, '[name="First-Name"]'),
      lastName: inputValue(form, '[name="Last-Name"]'),
      email: inputValue(form, '[name="Email-Address"]').toLowerCase(),
      company: inputValue(form, '[name="Company-Name"]'),
    }
  }

  function validate(values) {
    if (!values.firstName) return 'First name is required.'
    if (!values.lastName) return 'Last name is required.'
    if (!values.company) return 'Company name is required.'
    if (!EMAIL_PATTERN.test(values.email)) return 'Enter a valid email address.'
    return ''
  }

  function statusOf(error) {
    var value = Number(
      error && (error.status || error.statusCode || (error.response && error.response.status)),
    )
    return Number.isFinite(value) ? value : 0
  }

  function retryable(error) {
    var status = statusOf(error)
    return (
      (error && error.name === 'TypeError') ||
      status === 408 ||
      status === 429 ||
      status >= 500
    )
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms)
    })
  }

  function withTimeout(operation) {
    return new Promise(function (resolve, reject) {
      var settled = false
      var timer = window.setTimeout(function () {
        if (settled) return
        settled = true
        var error = new Error('Account update timed out. Please try again.')
        error.status = 408
        reject(error)
      }, OP_TIMEOUT_MS)

      Promise.resolve()
        .then(operation)
        .then(
          function (value) {
            if (settled) return
            settled = true
            window.clearTimeout(timer)
            resolve(value)
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

  async function runWithRetry(operation) {
    var lastError
    for (var index = 0; index < RETRY_DELAYS_MS.length; index += 1) {
      if (RETRY_DELAYS_MS[index]) await delay(RETRY_DELAYS_MS[index])
      try {
        return await withTimeout(operation)
      } catch (error) {
        lastError = error
        if (!retryable(error) || index === RETRY_DELAYS_MS.length - 1) throw error
      }
    }
    throw lastError
  }

  function memberstack() {
    var client = window.$memberstackDom
    if (!client) throw new Error('Memberstack is unavailable. Refresh and try again.')
    return client
  }

  async function currentMember(client) {
    if (typeof client.getCurrentMember !== 'function') {
      throw new Error('Memberstack member lookup is unavailable.')
    }
    var member = unwrapMember(await runWithRetry(function () {
      return client.getCurrentMember()
    }))
    if (!member || !member.id) throw new Error('Please log in again to update your account.')
    return member
  }

  function memberScopeChangedError() {
    var error = new Error('Your signed-in account changed. Refresh and try again.')
    error.code = 'MEMBER_SCOPE_CHANGED'
    return error
  }

  async function currentMemberForWrite(client, memberSnapshot) {
    var member = await currentMember(client)
    if (memberSnapshot && memberSnapshot.id !== member.id) {
      throw memberScopeChangedError()
    }
    return member
  }

  async function updateOrdinaryFields(client, values) {
    if (typeof client.updateMember !== 'function') {
      throw new Error('Memberstack profile updates are unavailable.')
    }
    return runWithRetry(function () {
      return client.updateMember({
        customFields: {
          'free-user': values.firstName,
          'last-name': values.lastName,
          company: values.company,
        },
      })
    })
  }

  /**
   * Records the authenticated baseline and the intended login email before the
   * auth write is attempted, because that write can land while its own response
   * is lost. Returns the pending intent when the changed target is already the
   * member's login email, so an ambiguous write is reconciled as a real email
   * change instead of reading as an unchanged onboarding submit.
   */
  function recordBuildEmailIntent(form, member, email) {
    var current = memberEmail(member)
    if (current !== email) {
      var intent = { baseline: current, target: email }
      pendingBuildPasswordEmails.set(form, intent)
      return intent
    }
    var pending = pendingBuildPasswordEmails.get(form)
    if (pending && pending.target === email && pending.baseline !== current) return pending
    return null
  }

  async function updateEmailIfChanged(client, member, email) {
    var changed = memberEmail(member) !== email
    if (changed) {
      if (typeof client.updateMemberAuth !== 'function') {
        throw new Error('Memberstack email updates are unavailable.')
      }

      await runWithRetry(async function () {
        await currentMemberForWrite(client, member)
        return client.updateMemberAuth({ email: email })
      })
    }

    return { changed: changed, email: email }
  }

  async function sendResetPasswordEmailOnce(form, client, email) {
    var normalizedEmail = trim(email).toLowerCase()
    var attemptedEmails = passwordEmailAttempts.get(form)
    if (!attemptedEmails) {
      attemptedEmails = new Set()
      passwordEmailAttempts.set(form, attemptedEmails)
    }
    if (attemptedEmails.has(normalizedEmail)) return { attempted: false }
    attemptedEmails.add(normalizedEmail)

    if (typeof client.sendMemberResetPasswordEmail !== 'function') {
      var unavailable = new Error('Password setup email is unavailable.')
      unavailable.passwordEmailAttempted = true
      throw unavailable
    }

    try {
      await withTimeout(function () {
        return client.sendMemberResetPasswordEmail({ email: normalizedEmail })
      })
      return { attempted: true }
    } catch (error) {
      var failed = new Error(
        error && error.message ? error.message : 'Password setup email could not be confirmed.',
      )
      failed.passwordEmailAttempted = true
      failed.status = statusOf(error)
      throw failed
    }
  }

  async function markBuildComplete(client) {
    return runWithRetry(function () {
      return client.updateMember({
        customFields: { 'completed-brand-profile': 'true' },
      })
    })
  }

  /**
   * The same-tab half of the completion contract, written only after the durable
   * member write has resolved. Every access is wrapped — Safari private mode
   * throws on the property itself — because a marker this controller failed to
   * write costs the member one fail-open Xano read, while an exception here would
   * cost them the rest of the submit: the password email and the redirect.
   */
  function markBrandProfileCompletedLocally() {
    try {
      window.sessionStorage.setItem(
        BRAND_PROFILE_MARKER_KEY,
        BRAND_PROFILE_MARKER_VALUE,
      )
      return true
    } catch (error) {
      return false
    }
  }

  function formWrapper(form) {
    return form && typeof form.closest === 'function' ? form.closest('.w-form') : null
  }

  function setMessage(form, kind, message, receipt) {
    var wrapper = formWrapper(form)
    if (!wrapper) return
    var success = wrapper.querySelector('.w-form-done')
    var failure = wrapper.querySelector('.w-form-fail')
    if (success) success.style.display = kind === 'success' ? 'block' : 'none'
    if (failure) {
      failure.style.display = kind === 'error' ? 'block' : 'none'
      var text = failure.querySelector('div')
      if (text && message) text.textContent = message
    }
  }

  function setBusy(form, busy) {
    form.setAttribute('aria-busy', busy ? 'true' : 'false')
    var submit = form.querySelector('[type="submit"]')
    if (submit) submit.disabled = !!busy
    var loading = form.querySelector('[data-opp-element="loading-button"]')
    if (loading) loading.setAttribute('data-opp-loading', busy ? 'true' : 'false')
  }

  function trackFailure(error, operation) {
    if (!window.StartersTrack || typeof window.StartersTrack.track !== 'function') return
    window.StartersTrack.track('bridge_error', {
      path: operation,
      status: statusOf(error),
    })
  }

  function friendlyError(error) {
    if (error && error.passwordEmailAttempted) {
      return 'Your account changes were saved, but the password email could not be confirmed. Use Forgot Password to send a new link.'
    }
    var status = statusOf(error)
    if (status === 409 || status === 422) {
      return 'That email is already in use. Choose another email address.'
    }
    return trim(error && error.message) || 'Your account could not be updated. Please try again.'
  }

  async function submitBuild(form) {
    var values = buildValues(form)
    var invalid = validate(values)
    if (invalid) {
      var validationError = new Error(invalid)
      validationError.code = 'validation'
      throw validationError
    }

    var client = memberstack()
    diagnosticRequestStarted(form)
    var member = await currentMember(client)

    // Completion is the last durable member write. A normal onboarding submit
    // keeps the authenticated login email and sends no password email. A real
    // email change keeps the existing ownership-proof email after completion.
    await updateOrdinaryFields(client, values)
    // The auth change can succeed before a later completion write fails, and it
    // can land while its own response is lost. Keep the baseline and the changed
    // target on this form so the safe retry still sends its one ownership-proof
    // message after completion succeeds.
    var emailIntent = recordBuildEmailIntent(form, member, values.email)
    await updateEmailIfChanged(client, member, values.email)
    await markBuildComplete(client)
    // Only reached once completion is durable. The marker stops the routers
    // from bouncing this member back onto the form during the webhook's
    // catch-up window.
    markBrandProfileCompletedLocally()
    if (emailIntent) {
      pendingBuildPasswordEmails.delete(form)
      await sendResetPasswordEmailOnce(form, client, emailIntent.target)
    }

    return { memberId: member.id }
  }

  async function submitSecurity(form, memberSnapshot, emailSnapshot) {
    var email = trim(emailSnapshot).toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      var validationError = new Error('Enter a valid email address.')
      validationError.code = 'validation'
      throw validationError
    }
    var client = memberstack()
    diagnosticRequestStarted(form)
    var member = memberSnapshot || await currentMember(client)
    var result = await updateEmailIfChanged(client, member, email)
    if (result.changed) await sendResetPasswordEmailOnce(form, client, result.email)
    return result
  }

  function bindForm(form, operation, submitter, redirectOnSuccess) {
    if (!form || form.getAttribute('data-brand-account-bound') === 'true') return false
    form.setAttribute('data-brand-account-bound', 'true')
    var busy = false

    form.addEventListener(
      'submit',
      function (event) {
        event.preventDefault()
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation()
        }
        if (busy) return
        busy = true
        setBusy(form, true)
        setMessage(form, 'idle', '')

        // Latched only on the success path that actually initiated a redirect.
        // `location.assign()` merely QUEUES the navigation, so the promise chain
        // settles while the browser is still fetching the destination; clearing
        // busy there would hand the member back a live-looking form (and stop the
        // button spinner) for the whole of that window. Staying busy until the
        // page unloads is the honest state, and it is what lets the page's
        // submit loader stay up through the redirect.
        var redirecting = false

        Promise.resolve(workflowDiagnosticsReady)
          .then(function () {
            diagnosticStart(form, operation)
            return submitter(form)
          })
          .then(function () {
            var receipt = diagnosticComplete(form, {
              result: 'success',
              stage: 'response',
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: true,
            })
            setMessage(form, 'success', '', receipt)
            if (redirectOnSuccess) {
              var redirect = form.getAttribute('redirect') || form.getAttribute('data-redirect')
              if (redirect) {
                window.location.assign(redirect)
                // Set AFTER the call: a throwing assign() falls through to
                // .catch() and must still release the form.
                redirecting = true
              }
            }
          })
          .catch(function (error) {
            var receipt = diagnosticComplete(form, {
              result: 'failed',
              stage: error && error.code === 'validation' ? 'validation' : 'response',
              error_code: diagnosticErrorCode(error),
              http_status: statusOf(error),
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: !(error && error.code === 'validation'),
            })
            setMessage(form, 'error', friendlyError(error), receipt)
            trackFailure(error, operation)
          })
          .finally(function () {
            if (redirecting) return
            busy = false
            setBusy(form, false)
          })
      },
      true,
    )
    return true
  }

  function replayNativeSubmit(form, submitter) {
    form.setAttribute('data-brand-account-native-replay', 'true')
    window.setTimeout(function () {
      try {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter || undefined)
        else if (typeof form.dispatchEvent === 'function') {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        }
      } finally {
        form.setAttribute('data-brand-account-native-replay', 'false')
      }
    }, 0)
  }

  function securityModeOwnsRole(mode, role) {
    if (mode === 'brand') return role === 'brand-free' || role === 'brand-paid'
    if (mode === 'identity') {
      return role === 'brand-free' || role === 'brand-paid' || role === 'talent'
    }
    return false
  }

  function securityFailurePath(role) {
    return role === 'talent' ? 'starter/account/email' : 'brand/account/email'
  }

  function bindStarterProfileEmail(form) {
    if (!form || form.getAttribute('data-starter-identity-bound') === 'true') return false
    form.setAttribute('data-starter-identity-bound', 'true')
    var busy = false
    var ownsSubmission = false
    var profileEmailInput = form.querySelector(STARTER_PROFILE_EMAIL_SELECTOR)
    var profileEmailBaseline = trim(profileEmailInput && profileEmailInput.value).toLowerCase()
    var profileEmailChanged = false

    function rememberProfileEmail(value) {
      profileEmailBaseline = trim(value).toLowerCase()
      profileEmailChanged = false
    }

    if (profileEmailInput && typeof profileEmailInput.addEventListener === 'function') {
      profileEmailInput.addEventListener('input', function (event) {
        var nextEmail = trim(profileEmailInput.value).toLowerCase()
        if (event && event.isTrusted === false) {
          if (!profileEmailChanged) profileEmailBaseline = nextEmail
          return
        }
        profileEmailChanged = !profileEmailBaseline || nextEmail !== profileEmailBaseline
      })
    }

    // Native constraint validation prevents the form's submit event from
    // firing when an unrelated required profile field is incomplete. The
    // authored submit disables pointer events in that state, so its direct
    // wrapper receives the click. Keep that validation for profile saves, but
    // let a valid changed login email use the identity path independently. A
    // later complete profile save sees an unchanged email and replays the
    // authored form normally.
    form.addEventListener(
      'click',
      function (event) {
        var submit =
          form.querySelector('[data-edit-submit]') || form.querySelector('[type="submit"]')
        var clickedSubmit =
          submit &&
          (event.target === submit ||
            (typeof submit.contains === 'function' && submit.contains(event.target)) ||
            event.target === submit.parentElement)
        if (!clickedSubmit || busy) return
        if (!profileEmailChanged) return
        if (typeof form.checkValidity !== 'function' || form.checkValidity()) return

        var emailInput = profileEmailInput || form.querySelector(STARTER_PROFILE_EMAIL_SELECTOR)
        if (
          !emailInput ||
          typeof emailInput.checkValidity !== 'function' ||
          !emailInput.checkValidity()
        ) {
          return
        }

        var email = trim(emailInput.value).toLowerCase()
        if (!EMAIL_PATTERN.test(email)) return

        event.preventDefault()
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation()
        }
        busy = true
        ownsSubmission = false

        Promise.resolve()
          .then(async function () {
            var guard = window.StartersV3RouteGuard
            if (!guard || typeof guard.memberRole !== 'function') return false
            var member = await currentMember(memberstack())
            if (guard.memberRole(member) !== 'talent') return false
            if (memberEmail(member) === email) {
              rememberProfileEmail(email)
              return false
            }

            ownsSubmission = true
            setBusy(form, true)
            setMessage(form, 'idle', '')
            await workflowDiagnosticsReady
            diagnosticStart(form, 'starter/account/email')
            await submitSecurity(form, member, email)
            rememberProfileEmail(email)
            var receipt = diagnosticComplete(form, {
              result: 'success',
              stage: 'response',
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: true,
            })
            setMessage(form, 'success', '', receipt)
            return true
          })
          .then(function (owned) {
            if (!owned && typeof form.reportValidity === 'function') {
              form.reportValidity()
            }
          })
          .catch(function (error) {
            if (!ownsSubmission) {
              if (typeof form.reportValidity === 'function') form.reportValidity()
              return
            }
            var receipt = diagnosticComplete(form, {
              result: 'failed',
              stage: error && error.code === 'validation' ? 'validation' : 'response',
              error_code: diagnosticErrorCode(error),
              http_status: statusOf(error),
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: !(error && error.code === 'validation'),
            })
            setMessage(form, 'error', friendlyError(error), receipt)
            trackFailure(error, 'starter/account/email')
          })
          .finally(function () {
            busy = false
            setBusy(form, false)
          })
      },
      true,
    )

    form.addEventListener(
      'submit',
      function (event) {
        if (form.getAttribute('data-brand-account-native-replay') === 'true') return
        event.preventDefault()
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation()
        }
        if (busy) return
        busy = true
        ownsSubmission = false
        var submitter = event.submitter
        var email = inputValue(form, STARTER_PROFILE_EMAIL_SELECTOR).toLowerCase()

        Promise.resolve()
          .then(async function () {
            var guard = window.StartersV3RouteGuard
            if (!guard || typeof guard.memberRole !== 'function') return false
            var member = await currentMember(memberstack())
            if (guard.memberRole(member) !== 'talent') return false

            if (!EMAIL_PATTERN.test(email)) return false
            if (memberEmail(member) === email) return false

            ownsSubmission = true
            setBusy(form, true)
            setMessage(form, 'idle', '')
            await workflowDiagnosticsReady
            diagnosticStart(form, 'starter/account/email')
            await submitSecurity(form, member, email)
            rememberProfileEmail(email)
            diagnosticComplete(form, {
              result: 'success',
              stage: 'response',
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: true,
            })
            return true
          })
          .then(function () {
            replayNativeSubmit(form, submitter)
          })
          .catch(function (error) {
            if (!ownsSubmission) {
              replayNativeSubmit(form, submitter)
              return
            }
            if (error && error.passwordEmailAttempted) {
              replayNativeSubmit(form, submitter)
            }
            var receipt = diagnosticComplete(form, {
              result: 'failed',
              stage: error && error.code === 'validation' ? 'validation' : 'response',
              error_code: diagnosticErrorCode(error),
              http_status: statusOf(error),
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: !(error && error.code === 'validation'),
            })
            setMessage(form, 'error', friendlyError(error), receipt)
            trackFailure(error, 'starter/account/email')
          })
          .finally(function () {
            busy = false
            setBusy(form, false)
          })
      },
      true,
    )
    return true
  }

  function bindIdentitySecurityForm(form, mode) {
    if (!form || form.getAttribute('data-brand-account-bound') === 'true') return false
    form.setAttribute('data-brand-account-bound', 'true')
    var busy = false
    var ownsSubmission = false
    var submissionRole = null

    form.addEventListener(
      'submit',
      function (event) {
        if (form.getAttribute('data-brand-account-native-replay') === 'true') return
        event.preventDefault()
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation()
        }
        if (busy) return
        busy = true
        ownsSubmission = false
        submissionRole = null
        var submitter = event.submitter
        var email = inputValue(form, '[data-ms-member="email"]').toLowerCase()

        Promise.resolve()
          .then(async function () {
            var guard = window.StartersV3RouteGuard
            if (!guard || typeof guard.memberRole !== 'function') return false
            var member = await currentMember(memberstack())
            var role = guard.memberRole(member)
            if (!securityModeOwnsRole(mode, role)) return false
            submissionRole = role
            ownsSubmission = true
            setBusy(form, true)
            setMessage(form, 'idle', '')
            await workflowDiagnosticsReady
            diagnosticStart(form, securityFailurePath(role))
            await submitSecurity(form, member, email)
            var receipt = diagnosticComplete(form, {
              result: 'success',
              stage: 'response',
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: true,
            })
            setMessage(form, 'success', '', receipt)
            return true
          })
          .then(function (owned) {
            if (!owned) replayNativeSubmit(form, submitter)
          })
          .catch(function (error) {
            if (!ownsSubmission) {
              replayNativeSubmit(form, submitter)
              return
            }
            var receipt = diagnosticComplete(form, {
              result: 'failed',
              stage: error && error.code === 'validation' ? 'validation' : 'response',
              error_code: diagnosticErrorCode(error),
              http_status: statusOf(error),
              duration_ms: Date.now() - (form.__startersAccountDiagnosticStartedAt || Date.now()),
              request_started: !(error && error.code === 'validation'),
            })
            setMessage(form, 'error', friendlyError(error), receipt)
            trackFailure(error, securityFailurePath(submissionRole))
          })
          .finally(function () {
            busy = false
            setBusy(form, false)
          })
      },
      true,
    )
    return true
  }

  function init() {
    var location = window.location || {}
    if (!allowedHost(location.hostname || '')) return false

    // The same Webflow site serves Memberstack Test Data on its webflow.io
    // hostname and Live Data on the custom domains. Keep the Designer-authored
    // live fallback, but align the plan before Memberstack handles signup.
    loadNativeFormDiagnostics()
    var bound = configureBrandSignupPlan(location.hostname || '')
    if (
      location.pathname === '/quiz' &&
      !configureBrandSignupPlan(location.hostname || '', QUIZ_SIGNUP_FORM_SELECTOR)
    ) {
      bound = watchForBrandSignupPlan(location.hostname || '') || bound
    }
    var buildForm = document.querySelector(BUILD_FORM_SELECTOR)
    if (buildForm) {
      bound = bindForm(buildForm, 'brand/account/build', submitBuild, true) || bound
    }

    var securityMode = config().guardSecurityForm
    if (securityMode === 'brand' || securityMode === 'identity') {
      var securityForm = document.querySelector(SECURITY_FORM_SELECTOR)
      if (securityForm) {
        bound = bindIdentitySecurityForm(securityForm, securityMode) || bound
      }
    }

    if (securityMode === 'identity' && location.pathname === '/starter-edit-profile') {
      var starterProfileForm = document.querySelector(STARTER_PROFILE_FORM_SELECTOR)
      if (starterProfileForm) {
        bound = bindStarterProfileEmail(starterProfileForm) || bound
      }
    }

    return bound
  }

  window.StartersBrandAccount = {
    init: init,
    submitBuild: submitBuild,
    submitSecurity: submitSecurity,
    signupPlanForHost: signupPlanForHost,
    validate: validate,
    retryable: retryable,
    // The shared completion-marker contract, exported so the reading modules'
    // key can be pinned against the writer's rather than against a literal.
    brandProfileMarkerKey: BRAND_PROFILE_MARKER_KEY,
    brandProfileMarkerValue: BRAND_PROFILE_MARKER_VALUE,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
