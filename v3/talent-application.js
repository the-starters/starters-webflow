/**
 * V3 talent application intake (INITIATIVE-127).
 *
 * Install on /freelancer-application/step-1 only. Intercepts the multistep
 * apply form's final submit and POSTs it to the Xano intake endpoint
 * (talent/application/create), which owns the authoritative application row
 * and mirrors it into the Airtable review table server-side. The native
 * Webflow submission is suppressed — Zapier is no longer the intake path.
 *
 * Contract: binds to `form[application-form]` (the form's existing custom
 * attribute). Redirects to the form's data-redirect (step-2) on success.
 * A duplicate submission (same email, open application) is treated as
 * success — the applicant just continues the flow.
 */
;(function () {
  'use strict'

  if (window.__startersTalentApplicationBooted) return
  window.__startersTalentApplicationBooted = true

  var ENDPOINT =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/talent/application/create'
  var FORM_SELECTOR = 'form[application-form]'
  var DEFAULT_REDIRECT = '/freelancer-application/step-2'

  function fieldMap(formData) {
    var raw = {}
    formData.forEach(function (value, key) {
      if (typeof value !== 'string') return
      if (raw[key] === undefined) raw[key] = value
      else raw[key] = String(raw[key]) + ', ' + value
    })

    var profileType = raw['profile-type'] || ''
    var isConsult = profileType === 'Consult Only'

    return {
      email: raw['email'] || '',
      first_name: raw['first-name'] || '',
      last_name: raw['last-name'] || '',
      phone: raw['phone'] || '',
      linkedin_url: raw['linkedin'] || '',
      profile_type: profileType,
      function_category: raw['function'] || '',
      // The form uses separate role/rate fields per profile type; the Zapier
      // era silently dropped the consult pair. Coalesce so review always sees
      // the pair that matches the chosen profile type.
      role_30: (isConsult ? raw['consult-option'] : raw['role-option']) || raw['role-option'] || raw['consult-option'] || '',
      rate: (isConsult ? raw['rate-consult'] : raw['rate']) || raw['rate'] || raw['rate-consult'] || '',
      referral_source: raw['referral-source'] || '',
      country: raw['country'] || '',
      city: raw['city'] || '',
      answers: raw,
    }
  }

  function showFail(form) {
    var wrapper = form.closest('.w-form') || form.parentElement
    var fail = wrapper ? wrapper.querySelector('.w-form-fail') : null
    if (fail) fail.style.display = 'block'
  }

  function setSubmitting(form, submitting) {
    var buttons = form.querySelectorAll('input[type="submit"], button[type="submit"]')
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = submitting
      if (buttons[i].dataset) {
        if (submitting && !buttons[i].dataset.originalValue && buttons[i].value) {
          buttons[i].dataset.originalValue = buttons[i].value
          if (buttons[i].dataset.wait) buttons[i].value = buttons[i].dataset.wait
        }
        if (!submitting && buttons[i].dataset.originalValue) {
          buttons[i].value = buttons[i].dataset.originalValue
        }
      }
    }
  }

  function redirectTarget(form) {
    return (
      form.getAttribute('data-redirect') ||
      form.getAttribute('redirect') ||
      DEFAULT_REDIRECT
    )
  }

  function handleSubmit(event) {
    var form = event.target
    if (!form || !form.matches || !form.matches(FORM_SELECTOR)) return

    event.preventDefault()
    event.stopImmediatePropagation()

    if (form.__startersSubmitting) return
    form.__startersSubmitting = true
    setSubmitting(form, true)

    var payload = fieldMap(new FormData(form))

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        if (!response.ok) throw new Error('intake ' + response.status)
        return response.json()
      })
      .then(function (result) {
        if (!result || result.id === undefined || result.id === null) {
          throw new Error('intake returned no application id')
        }
        window.location.assign(redirectTarget(form))
      })
      .catch(function (error) {
        form.__startersSubmitting = false
        setSubmitting(form, false)
        showFail(form)
        if (window.console && console.warn) {
          console.warn('[talent-application] submit failed:', error)
        }
      })
  }

  // Capture phase beats Webflow's delegated jQuery submit handler and the
  // multistep library's own final-submit behavior.
  document.addEventListener('submit', handleSubmit, true)
})()
