(function () {
  'use strict'

  var V3_PROFILE_FIELD = 'freelancer-profile-url'
  var V3_PROFILE_PREFIX = '/hire/'
  var SLUG_RESOLVER_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter/slug_by_memberstack'
  var MEMBER_ID_PATTERN = /^mem_(?:sb_)?[A-Za-z0-9]+$/
  var MEMBERSTACK_TIMEOUT_MS = 2000
  var MEMBERSTACK_POLL_MS = 100
  var PROFILE_POLL_MS = 10000
  var PROFILE_PUBLISHING_LABEL = 'View Profile (Publishing)'

  function hide(element) {
    element.style.display = 'none'
  }

  function show(element) {
    element.style.display = ''
  }

  function disabledClass(element) {
    var className = element.getAttribute('data-class-disabled') || ''
    return className.trim().replace(/^\./, '')
  }

  function setProfileDisabled(element, label) {
    var className = disabledClass(element)
    if (className) element.classList.add(className)
    element.removeAttribute('href')
    element.removeAttribute('target')
    element.removeAttribute('rel')
    element.setAttribute('aria-disabled', 'true')
    element.textContent = label
    show(element)
  }

  function setProfilePublished(element, slug, label) {
    var className = disabledClass(element)
    if (className) element.classList.remove(className)
    element.removeAttribute('aria-disabled')
    element.textContent = label
    element.setAttribute('href', V3_PROFILE_PREFIX + encodeURIComponent(slug))
    element.removeAttribute('target')
    element.removeAttribute('rel')
    show(element)
  }

  function bindLegacyField(element, memberData, fieldKey) {
    var fieldValue = memberData.customFields && memberData.customFields[fieldKey]
    fieldValue = typeof fieldValue === 'string' ? fieldValue.trim() : ''

    if (!fieldValue) {
      hide(element)
      return
    }

    try {
      var url = !/^https?:\/\//i.test(fieldValue) ? 'https://' + fieldValue : fieldValue
      new URL(url)
      element.href = url
      element.rel = 'noopener noreferrer'
      element.target = '_blank'
    } catch (error) {
      hide(element)
    }
  }

  function memberFromResult(result) {
    return result && (result.data || result.member || result)
  }

  function waitForMemberstack() {
    var startedAt = Date.now()

    return new Promise(function (resolve) {
      function check() {
        var memberstack = window.$memberstackDom
        if (memberstack && typeof memberstack.getCurrentMember === 'function') {
          resolve(memberstack)
          return
        }
        if (Date.now() - startedAt >= MEMBERSTACK_TIMEOUT_MS) {
          resolve(null)
          return
        }
        window.setTimeout(check, MEMBERSTACK_POLL_MS)
      }

      check()
    })
  }

  function waitForMemberstackReady() {
    var ready = window.memberReady
    if (!ready || typeof ready.then !== 'function') return Promise.resolve()
    return Promise.resolve(ready).then(
      function () {},
      function () {},
    )
  }

  function bindV3Profile(element) {
    var publishedLabel = element.textContent || 'View Profile'
    var timerPending = false
    var requestPending = false
    var stopped = false

    setProfileDisabled(element, publishedLabel)
    element.addEventListener('click', function (event) {
      if (element.getAttribute('aria-disabled') !== 'true') return
      event.preventDefault()
      event.stopPropagation()
    })
    if (typeof fetch !== 'function') return

    function connected() {
      return element.isConnected !== false
    }

    function schedule() {
      if (stopped || timerPending || !connected()) return
      timerPending = true
      window.setTimeout(function () {
        timerPending = false
        watch()
      }, PROFILE_POLL_MS)
    }

    function finish() {
      requestPending = false
      if (!stopped) schedule()
    }

    function watch() {
      if (stopped || requestPending || !connected()) return
      requestPending = true

      waitForMemberstackReady()
        .then(waitForMemberstack)
        .then(function (memberstack) {
          if (!memberstack) return null
          return memberstack.getCurrentMember()
        })
        .then(function (result) {
          var member = memberFromResult(result)
          var memberId = member && typeof member.id === 'string' ? member.id.trim() : ''
          if (!MEMBER_ID_PATTERN.test(memberId)) return null

          return fetch(SLUG_RESOLVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ member_id: memberId }),
          }).then(function (response) {
            if (!response || response.ok === false) throw new Error('Profile resolver failed')
            return response.json()
          })
        })
        .then(function (data) {
          if (!data || !connected()) return
          var slug = typeof data.slug === 'string' ? data.slug.trim() : ''
          if (slug) {
            stopped = true
            setProfilePublished(element, slug, publishedLabel)
            return
          }
          setProfileDisabled(element, PROFILE_PUBLISHING_LABEL)
        })
        .then(finish, finish)
    }

    watch()
  }

  document.addEventListener('DOMContentLoaded', function () {
    var memberData
    try {
      memberData = JSON.parse(localStorage.getItem('_ms-mem') || '{}')
    } catch (error) {
      memberData = {}
    }
    document.querySelectorAll('[ms-code-field-link]').forEach(function (element) {
      // A real static link is authoritative. Only placeholders use member data.
      var staticHref = element.getAttribute('href')
      if (staticHref && staticHref !== '#') return

      var fieldKey = element.getAttribute('ms-code-field-link')
      if (fieldKey === V3_PROFILE_FIELD) {
        // The Memberstack field still stores the legacy V2 profile URL. Resolve
        // the current Starter's canonical V3 CMS slug instead.
        bindV3Profile(element)
        return
      }

      if (!memberData || !memberData.id) return
      bindLegacyField(element, memberData, fieldKey)
    })
  })
})()
