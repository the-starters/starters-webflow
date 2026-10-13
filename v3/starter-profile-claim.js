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
    var mask = panel && panel.querySelector('[data-starter-claim="mask"]')
    var content = mask && mask.querySelector('[data-starter-claim="content"]')
    var surface = mask && mask.querySelector('[data-wf--background--variant]')
    var toggle = panel && panel.querySelector('[data-starter-claim="toggle"]')
    var visual = toggle && toggle.querySelector('[data-starter-claim="visual"]')
    var toggleLabel = toggle && toggle.querySelector('[data-starter-claim="toggle-label"]')
    var chevron = toggle && toggle.querySelector('[data-starter-claim="chevron"]')
    var compact = wrapper.querySelector('[data-starter-claim="compact"]')
    var compactLabel = compact && compact.querySelector('[data-starter-claim="compact-label"]')
    var closeButton = wrapper.querySelector(CLOSE_SELECTOR)
    var success = wrapper.querySelector('[data-starter-claim="success"]')
    var error = wrapper.querySelector('[data-starter-claim="error"]')
    if (!panel || !mask || !content || !surface || !toggle || !visual || !toggleLabel || !chevron || !compact || !compactLabel || !closeButton || !success) return false

    var style = document.createElement('style')
    style.textContent = [
      '[data-starter-claim-state]{pointer-events:none}',
      '[data-starter-claim="panel"]{position:relative;width:100%;pointer-events:auto;overflow:visible;transform:translateY(var(--sheet-offset,0px));transition:transform 260ms cubic-bezier(.4,0,.2,1);will-change:transform}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="panel"]{transition-duration:240ms;transition-delay:80ms}',
      '[data-starter-claim="mask"]{position:relative;width:100%;overflow:hidden}',
      '[data-starter-claim="mask"]>[data-wf--background--variant]{pointer-events:none}',
      '[data-starter-claim="content"]{max-height:80dvh;overflow:auto;opacity:1;filter:blur(0);transform:translateY(calc(-1 * var(--sheet-offset,0px)));transition:transform 260ms cubic-bezier(.4,0,.2,1),opacity 140ms ease 160ms,filter 140ms ease 160ms}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="content"]{opacity:0;filter:blur(3px);pointer-events:none;transition:transform 240ms cubic-bezier(.4,0,.2,1) 80ms,opacity 80ms ease,filter 80ms ease}',
      '[data-starter-claim="compact"]{position:absolute;inset:auto 0 0;min-height:calc(88px + env(safe-area-inset-bottom));box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:40px 5vw calc(24px + env(safe-area-inset-bottom));pointer-events:none}',
      '[data-starter-claim="compact-label"]{font-size:15px;font-weight:600;line-height:24px;opacity:0;filter:blur(3px);transition:opacity 180ms ease,filter 180ms ease}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="compact-label"]{opacity:1;filter:blur(0);transition-delay:220ms}',
      '[data-starter-claim="toggle"]{position:absolute;left:50%;right:auto;top:-22px;bottom:auto;transform:translateX(-50%);width:auto;min-width:44px;height:44px;display:grid;place-items:center;padding:0;border:0;background:transparent;pointer-events:auto;z-index:2;cursor:pointer;touch-action:manipulation}',
      '[data-starter-claim="visual"][data-button-theme="white"]{display:grid;place-items:center;grid-auto-flow:column;gap:6px;width:auto;height:32px;padding:0 10px;box-sizing:border-box;border-radius:4px;border:1px solid #eee;background:#eee;color:var(--colors--black-olive,#282b24);transition:background-color 200ms cubic-bezier(.4,0,.2,1),border-color 200ms cubic-bezier(.4,0,.2,1),transform 160ms cubic-bezier(.23,1,.32,1)}',
      '[data-starter-claim="toggle-label"]{font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;min-width:60px;text-align:center}',
      '[data-starter-claim="chevron"],[data-starter-claim="chevron"] svg{display:block;width:16px;height:16px}',
      '[data-starter-claim="chevron"] svg{transform:rotate(0deg);transition:transform 220ms cubic-bezier(.4,0,.2,1)}',
      '[data-starter-claim-state="collapsed"] [data-starter-claim="chevron"] svg{transform:rotate(180deg)}',
      '[data-starter-claim="toggle"]:active [data-starter-claim="visual"]{transform:scale(.97)}',
      '[data-starter-claim="toggle"]:focus-visible{outline:none}',
      '[data-starter-claim="toggle"]:focus-visible [data-starter-claim="visual"]{outline:2px solid var(--colors--olive,#355d76);outline-offset:2px}',
      '@media(hover:hover){[data-starter-claim="toggle"]:hover [data-starter-claim="visual"]{background:#effba8;border-color:#effba8}}',
      '[data-starter-claim="close"]{display:none!important;min-width:44px;min-height:44px;cursor:pointer;touch-action:manipulation}',
      '[data-starter-claim-state="success"] [data-starter-claim="close"]{display:flex!important;pointer-events:auto}',
      '[data-starter-claim-state="success"] [data-starter-claim="toggle"],[data-starter-claim-state="dismissed"] [data-starter-claim="toggle"]{display:none}',
      '[data-starter-claim-state="dismissed"] [data-starter-claim="panel"]{transition:transform 220ms cubic-bezier(.4,0,.2,1);pointer-events:none}',
      '[data-starter-claim-state="dismissed"] [data-starter-claim="content"]{opacity:0;filter:blur(3px);transition:opacity 100ms ease,filter 100ms ease}',
      '[data-starter-claim-motion="instant"] [data-starter-claim="panel"],[data-starter-claim-motion="instant"] [data-starter-claim="content"],[data-starter-claim-motion="instant"] [data-starter-claim="compact-label"],[data-starter-claim-motion="instant"] [data-starter-claim="visual"],[data-starter-claim-motion="instant"] [data-starter-claim="chevron"] svg{transition:none}',
      '@media(prefers-reduced-motion:reduce){[data-starter-claim="panel"],[data-starter-claim="content"],[data-starter-claim="compact-label"],[data-starter-claim="visual"],[data-starter-claim="chevron"] svg{transition:none!important}[data-starter-claim="toggle"]:active [data-starter-claim="visual"]{transform:none}}'
    ].join('\n')
    document.head.appendChild(style)
    chevron.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>'
    var state = 'expanded'
    var lastFocus = null
    ;[toggle, closeButton].forEach(function (button) {
      button.setAttribute('type', 'button')
    })
    closeButton.setAttribute('aria-label', 'Close claim confirmation')
    toggle.classList.remove('hide')
    toggle.hidden = false
    toggle.removeAttribute('hidden')
    compact.classList.remove('hide')
    compact.hidden = false
    compact.removeAttribute('hidden')

    function setState(next, animate) {
      state = next
      wrapper.setAttribute('data-starter-claim-motion', animate ? 'smooth' : 'instant')
      wrapper.setAttribute('data-starter-claim-state', state)
      var collapsed = state === 'collapsed'
      content.inert = collapsed || state === 'dismissed'
      content.setAttribute('aria-hidden', String(content.inert))
      compact.setAttribute('aria-hidden', String(!collapsed))
      toggle.setAttribute('aria-expanded', String(!collapsed))
      toggle.setAttribute('aria-label', collapsed ? 'View More' : 'View Less')
      toggleLabel.textContent = collapsed ? 'View More' : 'View Less'
      updateOffset()
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

    function updateOffset() {
      var panelHeight = panel.getBoundingClientRect().height
      var barHeight = compact.getBoundingClientRect().height
      var offset = state === 'dismissed' ? panelHeight : state === 'collapsed' ? Math.max(0, panelHeight - barHeight) : 0
      panel.style.setProperty('--sheet-offset', offset + 'px')
    }
    if (typeof window.ResizeObserver === 'function') {
      var resizeObserver = new window.ResizeObserver(function () {
        wrapper.setAttribute('data-starter-claim-motion', 'instant')
        updateOffset()
      })
      resizeObserver.observe(content)
      resizeObserver.observe(compact)
    }
    toggle.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (state !== 'expanded' && state !== 'collapsed') return
      setState(state === 'collapsed' ? 'expanded' : 'collapsed', event.detail !== 0)
    })
    closeButton.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (state === 'success') setState('dismissed', event.detail !== 0)
    })
    panel.addEventListener('transitionend', function (event) {
      if (state === 'dismissed' && event.target === panel && event.propertyName === 'transform') close(wrapper)
    })
    wrapper.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return
      if (state !== 'expanded' && state !== 'success') return
      event.preventDefault()
      setState(state === 'success' ? 'dismissed' : 'collapsed', false)
      if (state === 'collapsed') toggle.focus({ preventScroll: true })
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
    setState(state, false)
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
