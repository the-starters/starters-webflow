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
  var CLOSE_SELECTOR = '[data-starter-claim="close"]'
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
      if (bindBannerInteraction(wrapper)) return
      var closeButton = wrapper.querySelector(CLOSE_SELECTOR)
      if (closeButton) {
        if (closeButton.tagName.toLowerCase() === 'button') {
          closeButton.setAttribute('type', 'button')
        }
        if (!String(closeButton.getAttribute('aria-label') || '').trim()) {
          closeButton.setAttribute('aria-label', 'Close claim banner')
        }
        closeButton.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          close(wrapper)
        })
      }
    })
  }


  function bindBannerInteraction(wrapper) {
    var panel = wrapper.querySelector('[data-starter-claim="panel"]')
    var collapseButton = wrapper.querySelector('[data-starter-claim="collapse"]')
    var expandButton = wrapper.querySelector('[data-starter-claim="expand"]')
    var closeButton = wrapper.querySelector(CLOSE_SELECTOR)
    var success = wrapper.querySelector('[data-starter-claim="success"]')
    var error = wrapper.querySelector('[data-starter-claim="error"]')
    if (!panel || !collapseButton || !expandButton || !closeButton || !success) return false

    var style = document.createElement('style')
    style.textContent = [
      '[data-starter-claim-state]{pointer-events:none}',
      '[data-starter-claim="panel"]{position:relative;width:100%;pointer-events:auto;max-height:80dvh;overflow:auto;clip-path:inset(0);transition:clip-path 280ms cubic-bezier(.25,.65,.25,1)}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="panel"]{clip-path:inset(calc(100% - 64px - env(safe-area-inset-bottom)) 0 0);pointer-events:none;transition-duration:240ms}',
      '[data-starter-claim-state="dismissed"] [data-starter-claim="panel"]{clip-path:inset(100% 0 0);pointer-events:none;transition-duration:220ms}',
      '[data-starter-claim="panel"]>[data-starter-claim]{opacity:1;transition:opacity 180ms ease}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="panel"]>[data-starter-claim],[data-starter-claim-state="dismissed"] [data-starter-claim="panel"]>[data-starter-claim]{opacity:0;transition-duration:100ms}',
      '[data-starter-claim="expand"]{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;width:100%;min-height:64px;padding:10px 5vw calc(10px + env(safe-area-inset-bottom));border:0;background:linear-gradient(100deg,#d2e0da 12%,#91acb1 100%);color:inherit;font:inherit;font-size:15px;font-weight:600;opacity:0;pointer-events:none;transition:opacity 180ms ease;z-index:1}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="expand"]{opacity:1;pointer-events:auto}',
      '[data-starter-claim="expand-label"]{opacity:0;filter:blur(3px);transition:opacity 180ms ease,filter 180ms ease}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="expand-label"]{opacity:1;filter:blur(0)}',
      '[data-starter-claim="expand-affordance"]{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:400}',
      '[data-starter-claim="chevron"]{display:block;width:12px;height:12px;border-right:1.7px solid currentColor;border-bottom:1.7px solid currentColor;transform:rotate(45deg)}',
      '[data-starter-claim="expand"] [data-starter-claim="chevron"]{transform:rotate(225deg)}',
      '[data-starter-claim="collapse"],[data-starter-claim="close"]{display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;cursor:pointer;touch-action:manipulation;transition:transform 120ms cubic-bezier(.23,1,.32,1)}',
      '[data-starter-claim="collapse"]:active,[data-starter-claim="close"]:active{transform:scale(.97)}',
      '[data-starter-claim-state="expanded"] [data-starter-claim="close"],[data-starter-claim-state="collapsed"] [data-starter-claim="close"],[data-starter-claim-state="success"] [data-starter-claim="collapse"]{display:none!important}',
      '[data-starter-claim="collapse"]:focus-visible,[data-starter-claim="close"]:focus-visible,[data-starter-claim="expand"]:focus-visible{outline:3px solid #355d76;outline-offset:-3px}',
      '[data-starter-claim-motion="instant"] [data-starter-claim="panel"],[data-starter-claim-motion="instant"] [data-starter-claim="panel"]>[data-starter-claim],[data-starter-claim-motion="instant"] [data-starter-claim="expand"],[data-starter-claim-motion="instant"] [data-starter-claim="expand-label"]{transition:none}',
      '@media(prefers-reduced-motion:reduce){[data-starter-claim="panel"],[data-starter-claim="panel"]>[data-starter-claim],[data-starter-claim="expand"],[data-starter-claim="expand-label"],[data-starter-claim="collapse"],[data-starter-claim="close"]{transition:none!important}}'
    ].join('\n')
    document.head.appendChild(style)

    var state = 'expanded'
    var lastFocus = null
    ;[collapseButton, expandButton, closeButton].forEach(function (button) {
      button.setAttribute('type', 'button')
    })
    collapseButton.setAttribute('aria-label', 'Minimize claim banner')
    closeButton.setAttribute('aria-label', 'Close claim confirmation')
    collapseButton.classList.remove('hide')
    expandButton.classList.remove('hide')
    collapseButton.hidden = false
    collapseButton.removeAttribute('hidden')
    expandButton.hidden = false
    expandButton.removeAttribute('hidden')

    function setState(next, animate) {
      state = next
      wrapper.setAttribute('data-starter-claim-motion', animate ? 'smooth' : 'instant')
      wrapper.setAttribute('data-starter-claim-state', state)
      var collapsed = state === 'collapsed'
      panel.inert = collapsed || state === 'dismissed'
      panel.setAttribute('aria-hidden', String(panel.inert))
      expandButton.inert = !collapsed
      expandButton.setAttribute('aria-hidden', String(!collapsed))
      expandButton.setAttribute('aria-expanded', String(!collapsed))
      collapseButton.setAttribute('aria-expanded', String(!collapsed))
      if (collapsed) expandButton.focus({ preventScroll: true })
      if (state === 'expanded') collapseButton.focus({ preventScroll: true })
      if (state === 'success') {
        success.setAttribute('tabindex', '-1')
        success.focus({ preventScroll: true })
      }
      if (state === 'dismissed') {
        wrapper.inert = true
        wrapper.setAttribute('aria-hidden', 'true')
        if (lastFocus && lastFocus.isConnected && !wrapper.contains(lastFocus)) {
          lastFocus.focus({ preventScroll: true })
        } else {
          closeButton.blur()
        }
        if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) close(wrapper)
      }
    }

    function bindControl(button, action) {
      button.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        if (state === 'dismissed') return
        if (action === 'collapsed' && state !== 'expanded') return
        if (action === 'expanded' && state !== 'collapsed') return
        if (action === 'dismissed' && state !== 'success') return
        setState(action, event.detail !== 0)
      })
    }
    bindControl(collapseButton, 'collapsed')
    bindControl(expandButton, 'expanded')
    bindControl(closeButton, 'dismissed')
    panel.addEventListener('transitionend', function (event) {
      if (state === 'dismissed' && event.target === panel && event.propertyName === 'clip-path') close(wrapper)
    })
    wrapper.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return
      if (state !== 'expanded' && state !== 'success') return
      event.preventDefault()
      setState(state === 'success' ? 'dismissed' : 'collapsed', false)
    })
    document.addEventListener('focusin', function (event) {
      if (!wrapper.contains(event.target)) lastFocus = event.target
    })

    function visible(element) {
      return element && !element.hidden && window.getComputedStyle(element).display !== 'none'
    }
    var observer = new window.MutationObserver(function () {
      if (state === 'dismissed') return
      if (visible(success) && state !== 'success') setState('success', false)
      else if (visible(error) && state === 'collapsed') setState('expanded', false)
    })
    observer.observe(success, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
    if (error) observer.observe(error, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
    wrapper.setAttribute('data-starter-claim-state', state)
    panel.setAttribute('aria-hidden', 'false')
    expandButton.inert = true
    expandButton.setAttribute('aria-hidden', 'true')
    collapseButton.setAttribute('aria-expanded', 'true')
    return true
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
      if (button.getAttribute('data-starter-claim') !== null) return
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
