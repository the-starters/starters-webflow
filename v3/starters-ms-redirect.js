/**
 * Per-page Memberstack signup redirect.
 *
 * Webflow's native form "Redirect URL" is one static value per form, so a signup
 * modal in a shared component or on a CMS collection template cannot send members
 * back to the page they signed up from. This module copies the target out of a
 * `starters-ms-redirect` marker attribute the page (or CMS item) can vary, onto
 * `redirect` + `data-redirect` on every signup form, before Memberstack's
 * `initSignupForms()` reads `redirect`.
 *
 * Resolution order, per `form[data-ms-form="signup"]`:
 *   1. `starters-ms-redirect` on the form itself (per-form override).
 *   2. The first `[starters-ms-redirect]` element that is not itself a form
 *      (a marker on a form belongs to that form alone).
 * A form that already has a non-empty `redirect` is left alone — an author's
 * explicit Designer value wins. Accepted values are root-relative same-origin
 * paths: they must start with `/`, must not start with `//` or `/\` (both
 * protocol-relative), and must contain no ASCII control characters (the URL
 * parser strips tab/LF/CR, so `/\t/evil.example` would otherwise leave the site).
 * The value is otherwise used verbatim, so a query string such as
 * `?modal-id=signup-modal` survives the redirect. Anything else is ignored.
 *
 * Limitation: signup forms injected after DOMContentLoaded are out of scope —
 * this module does not observe later mutations. Call
 * `window.StartersMsRedirect.apply()` after injecting one.
 *
 * Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`, or `window.STARTERS_DEBUG === true`); production is
 * silent. Install snippet and Designer wiring: see v3/README.md.
 */
;(function () {
  'use strict'

  if (window.__startersMsRedirectBooted) return
  window.__startersMsRedirectBooted = true

  var MARKER_ATTRIBUTE = 'starters-ms-redirect'
  var MARKER_SELECTOR = '[' + MARKER_ATTRIBUTE + ']'
  var SIGNUP_FORM_SELECTOR = 'form[data-ms-form="signup"]'
  var REDIRECT_ATTRIBUTES = ['redirect', 'data-redirect']
  var LOG_PREFIX = '[starters-ms-redirect]'
  var CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/
  var STAGING_HOST_SUFFIXES = ['webflow.io', 'trycloudflare.com']
  var STAGING_HOSTS = ['localhost', '127.0.0.1']

  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true

    var hostname = (window.location && window.location.hostname) || ''
    if (STAGING_HOSTS.indexOf(hostname) !== -1) return true
    return STAGING_HOST_SUFFIXES.some(function (suffix) {
      return hostname === suffix || hostname.endsWith('.' + suffix)
    })
  }

  function warn(message) {
    if (!diagnosticsEnabled()) return
    try {
      console.warn(LOG_PREFIX + ' ' + message)
    } catch (error) {}
  }

  // A usable value is a root-relative same-origin path. `//host/…` and `/\host`
  // are protocol-relative and would leave the site, so they are rejected even
  // though they start with a slash.
  //
  // Control characters are rejected outright rather than stripped: the WHATWG URL
  // parser removes ASCII tab, LF and CR *before* parsing, so `/\t/evil.example`
  // would pass the leading-slash checks below and still resolve to
  // `https://evil.example/`. A control character in a redirect value is never
  // legitimate.
  function localPath(rawValue) {
    if (typeof rawValue !== 'string') return null
    if (CONTROL_CHARACTERS.test(rawValue)) return null

    var value = rawValue.trim()
    if (value.charAt(0) !== '/') return null
    if (value.charAt(1) === '/' || value.charAt(1) === '\\') return null
    return value
  }

  function attributeValue(element, name) {
    if (!element || typeof element.getAttribute !== 'function') return null
    return element.getAttribute(name)
  }

  // The page-level default. A marker sitting on a form belongs to that form
  // alone: donating it to a *different* signup form would silently redirect that
  // form to the wrong page, so form-borne markers are skipped here. Filtered in
  // code rather than with `:not([data-ms-form])` for older-browser safety.
  function pageMarkerValue() {
    var markers = document.querySelectorAll(MARKER_SELECTOR)
    var candidates = markers ? Array.prototype.slice.call(markers) : []

    for (var index = 0; index < candidates.length; index += 1) {
      if (attributeValue(candidates[index], 'data-ms-form') !== null) continue
      var value = attributeValue(candidates[index], MARKER_ATTRIBUTE)
      if (typeof value === 'string' && value.trim() !== '') return value
    }
    return null
  }

  function signupForms() {
    var forms = document.querySelectorAll(SIGNUP_FORM_SELECTOR)
    return forms ? Array.prototype.slice.call(forms) : []
  }

  // Writes the resolved redirect onto every signup form that still needs one.
  // Returns the number of forms changed; safe to call repeatedly.
  function apply() {
    var forms = signupForms()
    // A marker with no signup form on the page is a no-op, not an error: the
    // module can be installed sitewide while only some pages host the modal.
    if (forms.length === 0) return 0

    var markerValue = null
    var markerRead = false
    var applied = 0

    forms.forEach(function (form) {
      var existing = attributeValue(form, 'redirect')
      if (typeof existing === 'string' && existing.trim() !== '') return

      var raw = attributeValue(form, MARKER_ATTRIBUTE)
      if (typeof raw !== 'string' || raw.trim() === '') {
        if (!markerRead) {
          markerValue = pageMarkerValue()
          markerRead = true
        }
        raw = markerValue
      }

      if (typeof raw !== 'string' || raw.trim() === '') {
        warn(
          'signup form found but no [' +
            MARKER_ATTRIBUTE +
            '] value on the page; leaving its redirect unset.',
        )
        return
      }

      var path = localPath(raw)
      if (!path) {
        warn(
          'ignoring ' +
            MARKER_ATTRIBUTE +
            ' value ' +
            JSON.stringify(raw) +
            ' — it must be a root-relative same-origin path such as ' +
            '"/hire/some-slug?modal-id=signup-modal".',
        )
        return
      }

      REDIRECT_ATTRIBUTES.forEach(function (name) {
        form.setAttribute(name, path)
      })
      applied += 1
    })

    return applied
  }

  window.StartersMsRedirect = {
    apply: apply,
    localPath: localPath,
    markerAttribute: MARKER_ATTRIBUTE,
    diagnosticsEnabled: diagnosticsEnabled,
  }

  apply()

  // With `defer` the document is already parsed, so this only matters when the
  // script is loaded early (head, no defer) and the form or marker had not been
  // parsed yet. apply() is idempotent, so a second pass is harmless.
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      function () {
        apply()
      },
      { once: true },
    )
  }
})()
