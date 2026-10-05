/**
 * Show the claim request form on approved premade Starter profiles.
 *
 * QR codes use the normal public `/hire/<slug>` URL. Xano decides whether the
 * current slug is still claimable. Any failed, slow, malformed, or mismatched
 * response leaves the form hidden.
 *
 * Webflow authors the wrapper with `hide`, `hidden`, and `aria-hidden=true`.
 * No query parameter or per-QR token is required.
 */
;(function () {
  'use strict'

  if (window.__starterProfileClaimBooted) return
  window.__starterProfileClaimBooted = true

  var WRAPPER_SELECTOR = '[data-starter-claim="wrapper"]'
  var FORM_SELECTOR = 'form[data-starter-claim="form"]'
  var PROFILE_SLUG_FIELD_SELECTOR =
    'input[type="hidden"][name="Profile Slug"][data-starter-claim="profile-slug"]'
  var GOOGLE_AUTH_SELECTOR = '[data-ms-auth-provider="google"]'
  var PROFILE_PATH_PATTERN = /^\/hire\/([a-z0-9]+(?:-[a-z0-9]+)*)$/
  var CLAIM_STATUS_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/profile/starter/claim-status/v3'
  var CLAIM_STATUS_SCHEMA = 'starter_profile_claim_status_v3'
  var CLAIM_STATUS_TIMEOUT_MS = 8000
  var BUTTON_SUBMIT_BOUND_ATTR = 'data-starter-claim-submit-bound'

  function close(wrapper) {
    if (!wrapper) return
    if (wrapper.classList && typeof wrapper.classList.add === 'function') {
      wrapper.classList.add('hide')
    }
    wrapper.hidden = true
    wrapper.setAttribute('hidden', '')
    wrapper.setAttribute('aria-hidden', 'true')
  }

  function reveal(wrapper) {
    if (wrapper.classList && typeof wrapper.classList.remove === 'function') {
      wrapper.classList.remove('hide')
    }
    wrapper.hidden = false
    wrapper.removeAttribute('hidden')
    wrapper.setAttribute('aria-hidden', 'false')
  }

  function hideUnverifiedGoogle(wrapper) {
    var googleAuth = wrapper && wrapper.querySelector(GOOGLE_AUTH_SELECTOR)
    if (!googleAuth) return
    googleAuth.classList.add('hide')
    googleAuth.hidden = true
    googleAuth.setAttribute('hidden', '')
    googleAuth.setAttribute('aria-hidden', 'true')
    googleAuth.setAttribute('tabindex', '-1')
  }

  function profilePath() {
    var pathname = window.location && window.location.pathname
    if (typeof pathname !== 'string') return ''
    return PROFILE_PATH_PATTERN.test(pathname) ? pathname : ''
  }

  function profileSlug(path) {
    var match = PROFILE_PATH_PATTERN.exec(path || profilePath())
    return match ? match[1] : ''
  }

  function buildClaimStatusUrl(slug) {
    return CLAIM_STATUS_URL + '?slug=' + encodeURIComponent(slug)
  }

  function fetchClaimStatus(slug) {
    if (typeof window.fetch !== 'function') return Promise.resolve(null)

    var controller = null
    var timeoutId = null
    var options = {}

    function clearTimer() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    if (typeof window.AbortController === 'function') {
      controller = new window.AbortController()
      options.signal = controller.signal
    }

    var timeout = new Promise(function (resolve) {
      timeoutId = window.setTimeout(function () {
        if (controller) controller.abort()
        resolve(null)
      }, CLAIM_STATUS_TIMEOUT_MS)
    })

    var request = window.fetch(buildClaimStatusUrl(slug), options)
      .then(function (response) {
        if (!response || response.status !== 200 || typeof response.json !== 'function') {
          return null
        }
        return response.json().catch(function () {
          return null
        })
      })
      .catch(function () {
        return null
      })

    return Promise.race([request, timeout])
      .then(function (body) {
        clearTimer()
        return body
      })
  }

  function isClaimableResponse(body, slug) {
    return body &&
      body.schema === CLAIM_STATUS_SCHEMA &&
      body.slug === slug &&
      body.claimable === true
  }

  function init() {
    var wrapper = document.querySelector(WRAPPER_SELECTOR)
    if (!wrapper) return

    close(wrapper)
    hideUnverifiedGoogle(wrapper)

    var path = profilePath()
    var slug = profileSlug(path)
    if (!path || !slug) return

    var form = wrapper.querySelector(FORM_SELECTOR)
    if (!form) return
    if (form.getAttribute && form.getAttribute('data-ms-form') !== null) return

    var profileSlugField = form.querySelector(PROFILE_SLUG_FIELD_SELECTOR)
    if (!profileSlugField) return

    fetchClaimStatus(slug).then(function (body) {
      if (!isClaimableResponse(body, slug)) return
      profileSlugField.value = slug
      profileSlugField.setAttribute('value', slug)
      bindButtonSubmit(form)
      reveal(wrapper)
    })
  }

  // The shared Button component renders `<button type="button">`, which never
  // submits. Memberstack used to drive it through `data-ms-form`; the plain
  // Webflow form needs the click turned into a native submit so constraint
  // validation, Turnstile, and the Webflow notification all run as usual.
  function bindButtonSubmit(form) {
    if (typeof form.addEventListener !== 'function') return
    if (form.getAttribute(BUTTON_SUBMIT_BOUND_ATTR) !== null) return
    form.setAttribute(BUTTON_SUBMIT_BOUND_ATTR, '')
    form.addEventListener('click', function (event) {
      var target = event.target
      var button = target && typeof target.closest === 'function' ? target.closest('button') : null
      if (!button || button.getAttribute('type') !== 'button') return
      if (typeof form.contains === 'function' && !form.contains(button)) return
      if (button.disabled) return
      event.preventDefault()
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit()
        return
      }
      var nativeSubmit = form.querySelector('input[type="submit"], button[type="submit"]')
      if (nativeSubmit && typeof nativeSubmit.click === 'function') nativeSubmit.click()
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
