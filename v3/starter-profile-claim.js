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
  var EXCHANGE_FIELD_SELECTOR =
    'input[type="hidden"][data-ms-member="starter-claim-exchange"]'
  var ENDPOINT_ATTRIBUTE = 'data-starter-claim-prepare-url'
  var QUERY_PARAMETER = 'claim'
  var PREPARE_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter_profile_claim/prepare'
  var TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
  var EXCHANGE_CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
  var PROFILE_PATH_PATTERN = /^\/hire\/[A-Za-z0-9][A-Za-z0-9-]*$/
  var REQUEST_TIMEOUT_MS = 12000
  var LOG_PREFIX = '[starter-profile-claim]'
  var STAGING_HOSTS = ['localhost', '127.0.0.1']
  var STAGING_SUFFIXES = ['webflow.io', 'trycloudflare.com']
  var capturedClaim = captureClaim()

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

  function captureClaim() {
    try {
      var params = new URLSearchParams(window.location.search || '')
      var values = params.getAll(QUERY_PARAMETER)
      if (values.length === 0) return { present: false, token: '' }

      var token = values.length === 1 && TOKEN_PATTERN.test(values[0]) ? values[0] : ''
      if (!scrubClaimFromUrl()) return { present: true, token: '' }
      return { present: true, token: token }
    } catch (error) {
      return { present: false, token: '' }
    }
  }

  function profilePath() {
    var pathname = window.location && window.location.pathname
    if (typeof pathname !== 'string') return ''
    if (!PROFILE_PATH_PATTERN.test(pathname)) return ''
    return pathname
  }

  function prepareUrl(wrapper) {
    var raw = wrapper && wrapper.getAttribute(ENDPOINT_ATTRIBUTE)
    return raw === PREPARE_URL ? raw : ''
  }

  function scrubClaimFromUrl() {
    if (!window.history || typeof window.history.replaceState !== 'function') return false

    try {
      var current = new URL(window.location.href)
      current.searchParams.delete(QUERY_PARAMETER)
      var next = current.pathname + current.search + current.hash
      window.history.replaceState(window.history.state, '', next)
      return true
    } catch (error) {
      return false
    }
  }

  function fetchWithDeadline(url, options) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null
    var timer
    var requestOptions = Object.assign({}, options)
    if (controller) requestOptions.signal = controller.signal

    var deadline = new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        if (controller) controller.abort()
        reject(new Error('claim prepare timed out'))
      }, REQUEST_TIMEOUT_MS)
    })

    return Promise.race([window.fetch(url, requestOptions), deadline]).finally(function () {
      window.clearTimeout(timer)
    })
  }

  function responseExchangeCode(body, path) {
    if (!body || body.valid !== true || body.status !== 'active') return ''
    if (body.profile_path !== path) return ''
    return typeof body.exchange_code === 'string' && EXCHANGE_CODE_PATTERN.test(body.exchange_code)
      ? body.exchange_code
      : ''
  }

  async function init() {
    var claim = capturedClaim
    capturedClaim = { present: false, token: '' }
    var wrapper = document.querySelector(WRAPPER_SELECTOR)
    if (!wrapper) return { state: 'absent' }

    close(wrapper, 'closed')

    var token = claim.token
    if (!token) {
      if (claim.present) warn('claim value is malformed, repeated, or could not be removed; keeping the wrapper hidden.')
      return { state: claim.present ? 'invalid_query' : 'no_query' }
    }

    var path = profilePath()
    var form = wrapper.querySelector(FORM_SELECTOR)
    var exchangeField = form && form.querySelector(EXCHANGE_FIELD_SELECTOR)
    var endpoint = prepareUrl(wrapper)

    if (!path || !form || !exchangeField || !endpoint) {
      warn('claim markup, profile path, or prepare endpoint is incomplete; keeping the wrapper hidden.')
      close(wrapper, 'misconfigured')
      return { state: 'misconfigured' }
    }

    exchangeField.value = ''
    exchangeField.removeAttribute('value')
    close(wrapper, 'validating')

    try {
      var requestBody = JSON.stringify({ token: token, profile_path: path })
      token = ''
      claim.token = ''
      var response = await fetchWithDeadline(endpoint, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      requestBody = ''
      if (!response || !response.ok) throw new Error('claim prepare failed')
      var body = await response.json()
      var exchangeCode = responseExchangeCode(body, path)
      if (!exchangeCode) {
        close(wrapper, 'unavailable')
        return { state: 'unavailable' }
      }

      exchangeField.value = exchangeCode
      exchangeField.setAttribute('value', exchangeCode)
      reveal(wrapper)
      return { state: 'ready' }
    } catch (error) {
      close(wrapper, 'unavailable')
      warn('claim prepare was unavailable; keeping the wrapper hidden.')
      return { state: 'unavailable' }
    }
  }

  window.StarterProfileClaim = {
    init: init,
    profilePath: profilePath,
    prepareUrl: prepareUrl,
    responseExchangeCode: responseExchangeCode,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
})()
