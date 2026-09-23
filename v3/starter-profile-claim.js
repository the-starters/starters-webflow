/**
 * Premade Starter profile claim gate for `/hire/<slug>`.
 *
 * The Webflow wrapper is authored with `hide`, `hidden`, and
 * `aria-hidden="true"`. This controller only reveals it after Xano confirms
 * that the opaque `?claim=` capability belongs to the current profile path and
 * is still usable. No query, malformed input, incomplete markup, a failed
 * request, or a negative response leaves the wrapper closed.
 *
 * Designer contract and backend response shape: see v3/README.md.
 */
;(function () {
  'use strict'

  if (window.__starterProfileClaimBooted) return
  window.__starterProfileClaimBooted = true

  var WRAPPER_SELECTOR = '[data-starter-claim="wrapper"]'
  var FORM_SELECTOR = 'form[data-starter-claim="form"][data-ms-form="signup"]'
  var TOKEN_FIELD_SELECTOR = '[data-ms-member="starter-claim-token"]'
  var ENDPOINT_ATTRIBUTE = 'data-starter-claim-validate-url'
  var QUERY_PARAMETER = 'claim'
  var ALLOWED_API_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
  var ALLOWED_API_PREFIX = '/api:KZf7nFnk/starter_profile_claim/'
  var TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
  var PROFILE_PATH_PATTERN = /^\/hire\/[A-Za-z0-9][A-Za-z0-9-]*\/?$/
  var REQUEST_TIMEOUT_MS = 12000
  var LOG_PREFIX = '[starter-profile-claim]'
  var STAGING_HOSTS = ['localhost', '127.0.0.1']
  var STAGING_SUFFIXES = ['webflow.io', 'trycloudflare.com']

  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    var hostname = (window.location && window.location.hostname) || ''
    if (STAGING_HOSTS.indexOf(hostname) !== -1) return true
    return STAGING_SUFFIXES.some(function (suffix) {
      return hostname === suffix || hostname.endsWith('.' + suffix)
    })
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  function clean(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

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

  function claimToken() {
    try {
      var params = new URLSearchParams(window.location.search || '')
      var values = params.getAll(QUERY_PARAMETER)
      if (values.length !== 1) return ''
      var token = clean(values[0])
      return TOKEN_PATTERN.test(token) ? token : ''
    } catch (error) {
      return ''
    }
  }

  function profilePath() {
    var pathname = clean(window.location && window.location.pathname)
    if (!PROFILE_PATH_PATTERN.test(pathname)) return ''
    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  }

  function validationUrl(wrapper) {
    var raw = clean(wrapper && wrapper.getAttribute(ENDPOINT_ATTRIBUTE))
    if (!raw) return ''

    try {
      var parsed = new URL(raw)
      if (parsed.origin !== ALLOWED_API_ORIGIN) return ''
      if (parsed.pathname.indexOf(ALLOWED_API_PREFIX) !== 0) return ''
      if (parsed.search || parsed.hash || parsed.username || parsed.password) return ''
      return parsed.href
    } catch (error) {
      return ''
    }
  }

  function scrubTokenFromUrl() {
    if (!window.history || typeof window.history.replaceState !== 'function') return

    try {
      var current = new URL(window.location.href)
      current.searchParams.delete(QUERY_PARAMETER)
      var next = current.pathname + current.search + current.hash
      window.history.replaceState(window.history.state, '', next)
    } catch (error) {}
  }

  function fetchWithDeadline(url, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null
    var timer
    var requestOptions = Object.assign({}, options)
    if (controller) requestOptions.signal = controller.signal

    var deadline = new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        if (controller) controller.abort()
        reject(new Error('claim validation timed out'))
      }, REQUEST_TIMEOUT_MS)
    })

    return Promise.race([window.fetch(url, requestOptions), deadline]).finally(function () {
      window.clearTimeout(timer)
    })
  }

  function responseMatches(body, path) {
    if (!body || body.valid !== true || body.status !== 'active') return false
    return clean(body.profile_path) === path
  }

  async function init() {
    var wrapper = document.querySelector(WRAPPER_SELECTOR)
    if (!wrapper) return { state: 'absent' }

    close(wrapper, 'closed')

    var rawClaimPresent = false
    try {
      rawClaimPresent = new URLSearchParams(window.location.search || '').has(QUERY_PARAMETER)
    } catch (error) {}

    var token = claimToken()
    if (!token) {
      if (rawClaimPresent) warn('claim value is malformed or repeated; keeping the wrapper hidden.')
      return { state: rawClaimPresent ? 'invalid_query' : 'no_query' }
    }

    var path = profilePath()
    var form = wrapper.querySelector(FORM_SELECTOR)
    var tokenField = form && form.querySelector(TOKEN_FIELD_SELECTOR)
    var endpoint = validationUrl(wrapper)

    if (!path || !form || !tokenField || !endpoint) {
      warn('claim markup, profile path, or validation endpoint is incomplete; keeping the wrapper hidden.')
      close(wrapper, 'misconfigured')
      return { state: 'misconfigured' }
    }

    close(wrapper, 'validating')

    try {
      var response = await fetchWithDeadline(endpoint, {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, profile_path: path }),
      })

      if (!response || !response.ok) throw new Error('claim validation failed')
      var body = await response.json()
      if (!responseMatches(body, path)) {
        close(wrapper, 'unavailable')
        scrubTokenFromUrl()
        return { state: 'unavailable' }
      }

      tokenField.value = token
      tokenField.setAttribute('value', token)
      scrubTokenFromUrl()
      reveal(wrapper)
      return { state: 'ready' }
    } catch (error) {
      close(wrapper, 'unavailable')
      warn('claim validation was unavailable; keeping the wrapper hidden.')
      return { state: 'unavailable' }
    }
  }

  window.StarterProfileClaim = {
    init: init,
    claimToken: claimToken,
    profilePath: profilePath,
    validationUrl: validationUrl,
    responseMatches: responseMatches,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
