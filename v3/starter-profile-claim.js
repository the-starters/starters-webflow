/**
 * Show the signup form on the approved premade Starter profiles.
 *
 * QR codes use the normal public `/hire/<slug>` URL. The Hire template supplies
 * the slug list approved by Kaeser. This client-side list only
 * controls form visibility; Xano must still require an admin-prebuilt,
 * unclaimed profile and atomically bind its first successful signup.
 *
 * Webflow authors the wrapper with `hide`, `hidden`, and `aria-hidden=true`.
 * No query parameter or per-QR token is required.
 */
;(function () {
  'use strict'

  if (window.__starterProfileClaimBooted) return
  window.__starterProfileClaimBooted = true

  // Fail closed until the Hire template supplies Kaeser's approved profile slugs.
  var CLAIMABLE_SLUGS = Array.isArray(window.STARTER_PROFILE_CLAIM_SLUGS)
    ? window.STARTER_PROFILE_CLAIM_SLUGS
    : []
  var CLAIMABLE_SLUG_SET = new Set(CLAIMABLE_SLUGS)
  var WRAPPER_SELECTOR = '[data-starter-claim="wrapper"]'
  var FORM_SELECTOR = 'form[data-starter-claim="form"][data-ms-form="signup"]'
  var PROFILE_SLUG_FIELD_SELECTOR =
    'input[type="hidden"][data-ms-member="starter-claim-profile-slug"]'
  var GOOGLE_AUTH_SELECTOR = '[data-ms-auth-provider="google"]'
  var PROFILE_PATH_PATTERN = /^\/hire\/([a-z0-9]+(?:-[a-z0-9]+)*)$/

  function close(wrapper, state) {
    if (!wrapper) return
    if (wrapper.classList && typeof wrapper.classList.add === 'function') {
      wrapper.classList.add('hide')
    }
    wrapper.hidden = true
    wrapper.setAttribute('hidden', '')
    wrapper.setAttribute('aria-hidden', 'true')
    wrapper.setAttribute('data-starter-claim-state', state || 'closed')
  }

  function reveal(wrapper) {
    if (wrapper.classList && typeof wrapper.classList.remove === 'function') {
      wrapper.classList.remove('hide')
    }
    wrapper.hidden = false
    wrapper.removeAttribute('hidden')
    wrapper.setAttribute('aria-hidden', 'false')
    wrapper.setAttribute('data-starter-claim-state', 'ready')
  }

  function hideUnverifiedGoogle(wrapper) {
    var googleAuth = wrapper && wrapper.querySelector(GOOGLE_AUTH_SELECTOR)
    if (!googleAuth) return
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

  function isClaimableSlug(slug) {
    return typeof slug === 'string' && CLAIMABLE_SLUG_SET.has(slug)
  }

  function init() {
    var wrapper = document.querySelector(WRAPPER_SELECTOR)
    if (!wrapper) return { state: 'absent' }

    close(wrapper, 'closed')
    hideUnverifiedGoogle(wrapper)

    var path = profilePath()
    var slug = profileSlug(path)
    if (!path || !isClaimableSlug(slug)) {
      return { state: path ? 'not_listed' : 'not_profile' }
    }

    var form = wrapper.querySelector(FORM_SELECTOR)
    var profileSlugField = form && form.querySelector(PROFILE_SLUG_FIELD_SELECTOR)
    if (!form || !profileSlugField) {
      close(wrapper, 'misconfigured')
      return { state: 'misconfigured' }
    }

    profileSlugField.value = slug
    profileSlugField.setAttribute('value', slug)
    reveal(wrapper)
    return { state: 'ready', slug: slug }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
