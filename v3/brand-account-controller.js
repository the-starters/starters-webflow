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
 * assignments rather than creating another account or Brand row. The password
 * email is deliberately not retried.
 *
 * Build Account makes the completion marker its last durable member write,
 * then attempts one Memberstack reset/set-password email. Account Security
 * attempts that email only after a changed login email succeeds. Password
 * email calls are never automatically retried; Memberstack's Forgot Password
 * flow is the recovery path when delivery cannot be confirmed.
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
  var BRAND_SIGNUP_FORM_SELECTOR = '#wf-form-Brand-Signup'
  var LIVE_BRAND_PLAN_ID = 'pln_free-plan-f6kn0dxz'
  var TEST_BRAND_PLAN_ID = 'pln_dorxata-test-brand-plan-777r02pa'
  var OP_TIMEOUT_MS = 15000
  var RETRY_DELAYS_MS = [0, 300]
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  var passwordEmailAttempts = new WeakMap()

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

  function configureBrandSignupPlan(hostname) {
    var form = document.querySelector(BRAND_SIGNUP_FORM_SELECTOR)
    if (!form || form.getAttribute('data-ms-form') !== 'signup') return false
    form.setAttribute('data-ms-plan:add', signupPlanForHost(hostname))
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

  async function updateEmailIfChanged(client, member, email) {
    var changed = memberEmail(member) !== email
    if (changed) {
      if (typeof client.updateMemberAuth !== 'function') {
        throw new Error('Memberstack email updates are unavailable.')
      }

      await runWithRetry(function () {
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

  function formWrapper(form) {
    return form && typeof form.closest === 'function' ? form.closest('.w-form') : null
  }

  function setMessage(form, kind, message) {
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
    if (invalid) throw new Error(invalid)

    var client = memberstack()
    var member = await currentMember(client)

    // Completion is the last durable member write. The password email follows
    // it as a single, non-retried side effect, so a lost acknowledgement cannot
    // cause an automatic replay to emit a duplicate message.
    await updateOrdinaryFields(client, values)
    await updateEmailIfChanged(client, member, values.email)
    await markBuildComplete(client)
    await sendResetPasswordEmailOnce(form, client, values.email)

    return { memberId: member.id }
  }

  async function submitSecurity(form, memberSnapshot, emailSnapshot) {
    var email = trim(emailSnapshot).toLowerCase()
    if (!EMAIL_PATTERN.test(email)) throw new Error('Enter a valid email address.')
    var client = memberstack()
    var member = memberSnapshot || (await currentMember(client))
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

        Promise.resolve()
          .then(function () {
            return submitter(form)
          })
          .then(function () {
            setMessage(form, 'success', '')
            if (redirectOnSuccess) {
              var redirect = form.getAttribute('redirect') || form.getAttribute('data-redirect')
              if (redirect) window.location.assign(redirect)
            }
          })
          .catch(function (error) {
            setMessage(form, 'error', friendlyError(error))
            trackFailure(error, operation)
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
        if (typeof form.checkValidity !== 'function' || form.checkValidity()) return

        var emailInput = form.querySelector(STARTER_PROFILE_EMAIL_SELECTOR)
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
            if (memberEmail(member) === email) return false

            ownsSubmission = true
            setBusy(form, true)
            setMessage(form, 'idle', '')
            await submitSecurity(form, member, email)
            setMessage(form, 'success', '')
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
            setMessage(form, 'error', friendlyError(error))
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
            await submitSecurity(form, member, email)
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
            setMessage(form, 'error', friendlyError(error))
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
            await submitSecurity(form, member, email)
            setMessage(form, 'success', '')
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
            setMessage(form, 'error', friendlyError(error))
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
    var bound = configureBrandSignupPlan(location.hostname || '')
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
