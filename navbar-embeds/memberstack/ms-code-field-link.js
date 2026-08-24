(function () {
  'use strict'

  var V3_PROFILE_FIELD = 'freelancer-profile-url'
  var V3_PROFILE_PREFIX = '/hire/'
  var SLUG_RESOLVER_URL =
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter/slug_by_memberstack'
  var MEMBER_ID_PATTERN = /^mem_(?:sb_)?[A-Za-z0-9]+$/

  function hide(element) {
    element.style.display = 'none'
  }

  function show(element) {
    element.style.display = ''
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
      show(element)
    } catch (error) {
      hide(element)
    }
  }

  function bindV3Profile(element, memberId) {
    hide(element)
    if (!MEMBER_ID_PATTERN.test(memberId) || typeof fetch !== 'function') return

    fetch(SLUG_RESOLVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId }),
    })
      .then(function (response) {
        if (!response || response.ok === false) return null
        return response.json()
      })
      .then(function (data) {
        var slug = data && typeof data.slug === 'string' ? data.slug.trim() : ''
        if (!slug) return

        element.href = V3_PROFILE_PREFIX + encodeURIComponent(slug)
        element.removeAttribute('target')
        element.removeAttribute('rel')
        show(element)
      })
      .catch(function () {
        hide(element)
      })
  }

  document.addEventListener('DOMContentLoaded', function () {
    var memberData
    try {
      memberData = JSON.parse(localStorage.getItem('_ms-mem') || '{}')
    } catch (error) {
      memberData = {}
    }
    if (!memberData || !memberData.id) return

    document.querySelectorAll('[ms-code-field-link]').forEach(function (element) {
      // A real static link is authoritative. Only placeholders use member data.
      var staticHref = element.getAttribute('href')
      if (staticHref && staticHref !== '#') return

      var fieldKey = element.getAttribute('ms-code-field-link')
      if (fieldKey === V3_PROFILE_FIELD) {
        // The Memberstack field still stores the legacy V2 profile URL. Resolve
        // the current Starter's canonical V3 CMS slug instead.
        bindV3Profile(element, String(memberData.id).trim())
        return
      }

      bindLegacyField(element, memberData, fieldKey)
    })
  })
})()
