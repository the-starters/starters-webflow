/**
 * Shared V3 password-recovery routing.
 *
 * The Brand and Talent pages use the same Memberstack form contracts, so this
 * module keeps one canonical recovery chain and treats persona as navigation
 * context only:
 *
 *   /forgot-password -> /reset-password -> /password-success
 *
 * Install once in the V3 site head. It is inert outside the approved V3 hosts
 * and auth paths. Legacy Talent paths are redirected with the original query
 * string and hash intact so existing Memberstack reset-token links keep
 * working. The only appended value is the non-sensitive `from=talent` context.
 *
 * Native Webflow markup remains authoritative. Optional login-choice links use:
 *
 *   data-password-recovery-login="brand"
 *   data-password-recovery-login="talent"
 *
 * Recovery Email Hint (the address submitted on Forgot Password) fills:
 *
 *   [data-password-recovery-email]
 *
 * When both login choices are present, an unknown origin shows both. A known origin
 * shows only the matching choice. JavaScript never creates form or link markup.
 */
;(function () {
  'use strict'

  if (window.__startersV3PasswordRecoveryBooted) return
  window.__startersV3PasswordRecoveryBooted = true

  var APPROVED_HOSTS = new Set([
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ])
  var ORIGINS = new Set(['brand', 'talent'])
  var ORIGIN_STORAGE_KEY = 'thestarters:v3-password-origin'
  var HINT_STORAGE_KEY = 'thestarters:v3-password-email'
  var ORIGIN_QUERY_KEY = 'from'
  var BRAND_LOGIN_PATH = '/login'
  var TALENT_LOGIN_PATH = '/starter-login'
  var FORGOT_PATH = '/forgot-password'
  var RESET_PATH = '/reset-password'
  var SUCCESS_PATH = '/password-success'

  var LEGACY_PATHS = {
    '/starters-forgot-password': {
      destination: FORGOT_PATH,
      origin: 'talent',
    },
    '/starters-reset-password': {
      destination: RESET_PATH,
      origin: 'talent',
    },
    '/starters-password-success': {
      destination: SUCCESS_PATH,
      origin: 'talent',
    },
    '/starter-password-success': {
      destination: SUCCESS_PATH,
      origin: 'talent',
    },
    '/password-sucess': {
      destination: SUCCESS_PATH,
      origin: 'brand',
    },
  }

  var AUTH_PATHS = new Set([
    BRAND_LOGIN_PATH,
    TALENT_LOGIN_PATH,
    FORGOT_PATH,
    RESET_PATH,
    SUCCESS_PATH,
  ])

  function validOrigin(value) {
    return typeof value === 'string' && ORIGINS.has(value) ? value : null
  }

  function normalizePathname(pathname) {
    if (typeof pathname !== 'string' || pathname === '') return '/'
    if (pathname.length > 1 && pathname.endsWith('/')) {
      return pathname.slice(0, -1)
    }
    return pathname
  }

  function readStoredOrigin() {
    try {
      return validOrigin(window.sessionStorage.getItem(ORIGIN_STORAGE_KEY))
    } catch (error) {
      return null
    }
  }

  function storeOrigin(origin) {
    if (!validOrigin(origin)) return
    try {
      window.sessionStorage.setItem(ORIGIN_STORAGE_KEY, origin)
    } catch (error) {}
  }

  function readHint() {
    try {
      var value = window.sessionStorage.getItem(HINT_STORAGE_KEY)
      return typeof value === 'string' && value !== '' ? value : null
    } catch (error) {
      return null
    }
  }

  function storeHint(email) {
    if (typeof email !== 'string') return
    if (!email.replace(/^\s+|\s+$/g, '')) return
    try {
      window.sessionStorage.setItem(HINT_STORAGE_KEY, email)
    } catch (error) {}
  }

  function clearHint() {
    try {
      window.sessionStorage.removeItem(HINT_STORAGE_KEY)
    } catch (error) {}
  }

  function captureForgotHint(form) {
    if (!form || typeof form.querySelector !== 'function') return
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) return
    var input = form.querySelector('[data-ms-member="email"]')
    if (!input || typeof input.value !== 'string') return
    storeHint(input.value)
  }

  function bindForgotHintCapture() {
    elements('form[data-ms-form="forgot-password"]').forEach(function (form) {
      if (form.__startersPasswordHintBound) return
      if (typeof form.addEventListener !== 'function') return
      form.__startersPasswordHintBound = true
      form.addEventListener(
        'submit',
        function () {
          captureForgotHint(form)
        },
        true,
      )
    })
  }

  function fillHintSurface() {
    var hint = readHint()
    if (!hint) return
    elements('[data-password-recovery-email]').forEach(function (surface) {
      var textNode = surface.firstChild
      if (textNode && textNode.nodeType === 3 && !textNode.nextSibling) {
        textNode.nodeValue = hint
        return
      }
      surface.textContent = hint
    })
  }

  function fillForgotEmail() {
    var hint = readHint()
    if (!hint) return
    elements('form[data-ms-form="forgot-password"]').forEach(function (form) {
      if (!form || typeof form.querySelector !== 'function') return
      var input = form.querySelector('[data-ms-member="email"]')
      if (!input) return
      input.value = hint
    })
  }

  function queryOrigin(search) {
    try {
      return validOrigin(new URLSearchParams(search || '').get(ORIGIN_QUERY_KEY))
    } catch (error) {
      return null
    }
  }

  function originFor(pathname, search) {
    var normalizedPathname = normalizePathname(pathname)
    var legacy = LEGACY_PATHS[normalizedPathname]
    if (legacy) return legacy.origin

    if (normalizedPathname === BRAND_LOGIN_PATH) return 'brand'
    if (normalizedPathname === TALENT_LOGIN_PATH) return 'talent'

    return queryOrigin(search) || readStoredOrigin()
  }

  // Append origin without parsing or reserializing an existing query. Reset
  // tokens can be encoding-sensitive, so every existing byte remains in place.
  function appendOrigin(search, origin) {
    var safeOrigin = validOrigin(origin)
    var rawSearch = typeof search === 'string' ? search : ''
    if (!safeOrigin) return rawSearch
    if (/(?:^\?|&)from(?:=|&|$)/.test(rawSearch)) return rawSearch
    if (!rawSearch) return '?' + ORIGIN_QUERY_KEY + '=' + safeOrigin

    var separator = rawSearch.endsWith('?') || rawSearch.endsWith('&') ? '' : '&'
    return rawSearch + separator + ORIGIN_QUERY_KEY + '=' + safeOrigin
  }

  function pathWithOrigin(pathname, origin) {
    return pathname + appendOrigin('', origin)
  }

  function legacyDestination(pathname, search, hash) {
    var legacy = LEGACY_PATHS[normalizePathname(pathname)]
    if (!legacy) return null
    return (
      legacy.destination +
      appendOrigin(search, legacy.origin) +
      (typeof hash === 'string' ? hash : '')
    )
  }

  function elements(selector) {
    var matches = document.querySelectorAll(selector)
    return matches ? Array.prototype.slice.call(matches) : []
  }

  function setHref(element, value) {
    if (!element || typeof element.setAttribute !== 'function') return
    element.setAttribute('href', value)
  }

  function configureLoginEntry(pathname, origin) {
    if (pathname !== BRAND_LOGIN_PATH && pathname !== TALENT_LOGIN_PATH) return

    elements(
      'a[href="/forgot-password"], a[href="/starters-forgot-password"], a[href="/legacy-starters-forgot-password"]',
    ).forEach(function (link) {
      setHref(link, pathWithOrigin(FORGOT_PATH, origin))
    })
  }

  function configureForm(pathname, origin) {
    var selector = null
    var destination = null

    if (pathname === FORGOT_PATH) {
      selector = 'form[data-ms-form="forgot-password"]'
      destination = pathWithOrigin(RESET_PATH, origin)
    } else if (pathname === RESET_PATH) {
      selector = 'form[data-ms-form="reset-password"]'
      destination = pathWithOrigin(SUCCESS_PATH, origin)
    }

    if (!selector) return 0

    var configured = 0
    elements(selector).forEach(function (form) {
      form.setAttribute('redirect', destination)
      form.setAttribute('data-redirect', destination)
      configured += 1
    })
    return configured
  }

  function configureRetryLinks(pathname, origin) {
    if (pathname !== RESET_PATH && pathname !== SUCCESS_PATH) return

    elements(
      '[data-password-recovery-retry], a[href="/forgot-password"], a[href="/starters-forgot-password"]',
    ).forEach(function (link) {
      setHref(link, pathWithOrigin(FORGOT_PATH, origin))
    })
  }

  function configureLoginChoices(pathname, origin) {
    if (pathname !== FORGOT_PATH && pathname !== RESET_PATH && pathname !== SUCCESS_PATH) {
      return
    }

    var choices = elements('[data-password-recovery-login]')
    if (choices.length > 0) {
      choices.forEach(function (choice) {
        var choiceOrigin = validOrigin(choice.getAttribute('data-password-recovery-login'))
        if (!choiceOrigin) return

        setHref(choice, choiceOrigin === 'talent' ? TALENT_LOGIN_PATH : BRAND_LOGIN_PATH)

        if (origin && choiceOrigin !== origin) {
          choice.setAttribute('hidden', '')
        } else {
          choice.removeAttribute('hidden')
        }
      })
      return
    }

    // Compatibility fallback while the canonical pages are being wired with
    // native, explicitly marked Brand and Talent choices. Direct visits with
    // no origin must not silently favor either persona.
    if (!origin) {
      elements('a[href="/login"], a[href="/starter-login"]').forEach(function (link) {
        setHref(link, '/')
        link.setAttribute('aria-label', 'Return to homepage')

        var buttonWrap =
          typeof link.closest === 'function' ? link.closest('.button_main-wrap') : null
        var visibleLabel =
          buttonWrap && typeof buttonWrap.querySelector === 'function'
            ? buttonWrap.querySelector('.button_main-text')
            : null

        if (visibleLabel) {
          visibleLabel.textContent = 'Return to homepage'
        } else {
          link.textContent = 'Return to homepage'
        }
      })
      return
    }
    var destination = origin === 'talent' ? TALENT_LOGIN_PATH : BRAND_LOGIN_PATH
    elements('a[href="/login"], a[href="/starter-login"]').forEach(function (link) {
      setHref(link, destination)
    })
  }

  function apply() {
    var pathname = normalizePathname(window.location.pathname)
    if (!AUTH_PATHS.has(pathname)) return 0

    var origin = originFor(pathname, window.location.search)
    storeOrigin(origin)
    configureLoginEntry(pathname, origin)
    var configuredForms = configureForm(pathname, origin)
    configureRetryLinks(pathname, origin)
    configureLoginChoices(pathname, origin)
    if (pathname === FORGOT_PATH) {
      bindForgotHintCapture()
      fillForgotEmail()
    }
    if (pathname === RESET_PATH) fillHintSurface()
    if (pathname === SUCCESS_PATH) clearHint()
    return configuredForms
  }

  var api = {
    appendOrigin: appendOrigin,
    apply: apply,
    legacyDestination: legacyDestination,
    normalizePathname: normalizePathname,
    originFor: originFor,
    queryOrigin: queryOrigin,
    validOrigin: validOrigin,
  }
  window.StartersV3PasswordRecovery = api

  if (!APPROVED_HOSTS.has(window.location.hostname)) return

  var destination = legacyDestination(
    window.location.pathname,
    window.location.search,
    window.location.hash,
  )
  if (destination) {
    window.location.replace(destination)
    return
  }

  apply()
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
