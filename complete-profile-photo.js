/**
 * /complete-profile — Memberstack-owned Brand profile image upload.
 *
 * The page is a Brand onboarding surface. The previous controller sent the
 * image to Xano's Starter-only endpoint (#1390), which requires a
 * `freelancers_v3` row and therefore failed every Brand with "Starter not
 * found". Memberstack already owns the profile image and its Webflow package
 * exposes the supported `data-ms-action="profile-image"` uploader.
 *
 * Keep the native Webflow element. This module only binds the Memberstack
 * behavior attribute early (deferred scripts execute before DOMContentLoaded),
 * so the Webflow package can discover it without JavaScript-generated form
 * markup. Published Xano endpoint #1513 consumes the resulting `member.updated`
 * webhook and mirrors `member.profileImage` into `brands_v3.image_link`.
 */
;(function () {
  'use strict'

  if (window.__startersBrandProfileImageBound) return
  window.__startersBrandProfileImageBound = true

  var ALLOWED_HOSTS = [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
  ]
  var COMPLETE_PROFILE_PATHS = ['/complete-profile', '/complete-profile/']
  var BUTTON_SELECTOR = '.app-form_upload.is-complete-profile .upload-btn'
  var PREVIEW_SELECTOR = '[data-complete-profile-image]'

  function isAllowedHost(hostname) {
    return (
      ALLOWED_HOSTS.indexOf(hostname) !== -1 ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(hostname || '')
    )
  }

  function init() {
    var location = window.location || {}
    if (!isAllowedHost(location.hostname || '')) return false
    if (COMPLETE_PROFILE_PATHS.indexOf(location.pathname || '') === -1) return false

    var button = document.querySelector(BUTTON_SELECTOR)
    if (!button) return false

    button.setAttribute('data-ms-action', 'profile-image')

    var preview = document.querySelector(PREVIEW_SELECTOR)
    if (preview && preview.tagName === 'IMG') {
      preview.setAttribute('data-ms-member', 'profile-image')
    }

    return true
  }

  window.StartersBrandProfileImage = { init: init }
  init()
})()
