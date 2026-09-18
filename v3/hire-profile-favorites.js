/**
 * V3 /hire/<slug> paid-Brand favorites hydration.
 *
 * Page glue for Designer-authored profile hearts
 * (`[wf-xano-element="favorite"]`). wf-xano owns toggle/paint; Xano api:opp30
 * brand/favorites/* owns the data. This module only:
 *
 *   - defaults `window.WfXanoConfig.favoritesSource` to `opp30:brand/favorites`
 *     when a hire-profile favorite control exists and the viewer is paid Brand
 *     (site Head Code sets xanoBase/authBase but not favoritesSource),
 *   - waits for `window.WfXano.favorites` and calls `init` on each profile
 *     control so wf-xano can un-hide it after ids hydrate,
 *   - pre-warms `favorites.refresh('starter')` for that same paid-Brand viewer.
 *
 * It deliberately does NOT:
 *   - key off `[data-starters-list]` (that marker means the All Starters
 *     Algolia list; see `v3/all-starters-favorites.js`),
 *   - decorate or rewrite Designer favorite attributes,
 *   - un-hide the control itself (wf-xano's paint does that),
 *   - load wf-xano, or replace an existing WfXanoConfig object,
 *   - hydrate for logged-out / Free Brand / Talent viewers — those keep the
 *     Designer-owned hidden control, with no favoritesSource write that would
 *     let wf-xano auto-init and flash a heart.
 *
 * Path rule matches `v3/agency-profile.js`: exactly one `/hire/<slug>` segment.
 *
 * Install: hire template Page Settings -> Custom Code -> Footer, one deferred
 * jsDelivr tag next to `v3/hire-profile.js`. Pin / cache-bust is Webflow Guy's
 * job after merge; do not publish from this change.
 */
;(function () {
  'use strict'

  if (window.__startersV3HireProfileFavoritesBooted) return
  window.__startersV3HireProfileFavoritesBooted = true

  // brand-paid role plan IDs — keep aligned with v3/all-starters-favorites.js
  // and PLAN_ROLES in v3/route-guard.js (v3/ACCESS-MATRIX.md is the source).
  var PREMIUM_PLAN_IDS = {
    'pln_new-paid-plan-463h04ph': true,
    'pln_dorxata-test-brand-plan-777r02pa': true,
  }
  var CONTROL = '[wf-xano-element="favorite"]'
  var FAVORITE_TYPE = 'starter'
  var DEFAULT_FAVORITES_SOURCE = 'opp30:brand/favorites'

  var CSS = [
    /* Webflow icon-button classes can set display:flex, which beats the UA
       [hidden] rule. Scope the override to favorite controls only — hire uses
       button.icon-32.is-profile, not .expert_favorite-button. */
    '[wf-xano-element="favorite"][hidden] { display: none !important; }',
    '[wf-xano-element="favorite"].is-wf-xano-favorited path { fill: currentColor; }',
    '[wf-xano-element="favorite"].is-wf-xano-loading { opacity: .55; cursor: wait; }',
    '[wf-xano-element="favorite"]:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }',
  ].join('\n')

  function profileSlug(pathname) {
    var match = String(pathname || '').match(/^\/hire\/([^/?#]+)\/?$/i)
    if (!match) return ''
    try {
      return decodeURIComponent(match[1]).trim()
    } catch (_) {
      return ''
    }
  }

  function isHireProfilePath() {
    return !!profileSlug(window.location && window.location.pathname)
  }

  function profileFavoriteControls() {
    if (!document.querySelectorAll) return []
    return Array.prototype.slice.call(document.querySelectorAll(CONTROL))
  }

  function hasProfileFavoriteControl() {
    return !!(document.querySelector && document.querySelector(CONTROL))
  }

  function ensureFavoritesSource() {
    window.WfXanoConfig = window.WfXanoConfig || {}
    if (!window.WfXanoConfig.favoritesSource) {
      window.WfXanoConfig.favoritesSource = DEFAULT_FAVORITES_SOURCE
    }
  }

  function injectStyles() {
    if (document.querySelector && document.querySelector('style[data-ts-hire-favorites]')) return
    var style = document.createElement('style')
    style.setAttribute('data-ts-hire-favorites', 'true')
    style.textContent = CSS
    if (document.head) document.head.appendChild(style)
  }

  function isPremiumBrand(member) {
    return !!(member && (member.planConnections || []).some(function (connection) {
      return PREMIUM_PLAN_IDS[connection.planId] &&
        (connection.active === true || connection.status === 'ACTIVE')
    }))
  }

  function whenFavoritesReady(callback) {
    var attempts = 0
    function ready() {
      if (window.WfXano && window.WfXano.favorites) return callback(window.WfXano)
      if (++attempts < 100) window.setTimeout(ready, 100)
      else console.warn('[hire-profile-favorites] wf-xano favorites API not available; giving up')
    }
    ready()
  }

  function memberReady() {
    if (window.memberReady && typeof window.memberReady.then === 'function') {
      return window.memberReady
    }
    var memberstack = window.$memberstackDom
    if (!memberstack || !memberstack.getCurrentMember) return Promise.resolve(null)
    return memberstack.getCurrentMember().then(
      function (result) { return (result && result.data) || null },
      function () { return null }
    )
  }

  var memberPromise = memberReady()

  function hydrate(controls) {
    if (!controls.length) return
    ensureFavoritesSource()
    injectStyles()
    whenFavoritesReady(function (api) {
      controls.forEach(function (control) {
        api.favorites.init(control)
      })
    })
  }

  function boot() {
    if (!isHireProfilePath()) return
    var controls = profileFavoriteControls()
    if (!controls.length) return
    memberPromise.then(function (member) {
      return member || memberReady()
    }).then(function (member) {
      if (!isPremiumBrand(member)) return
      hydrate(controls)
    })
  }

  try {
    if (isHireProfilePath() && hasProfileFavoriteControl()) {
      memberPromise.then(function (member) {
        if (!isPremiumBrand(member)) return
        ensureFavoritesSource()
        whenFavoritesReady(function (api) {
          api.favorites.refresh(FAVORITE_TYPE).catch(function () {})
        })
      }).catch(function () {})
    }
  } catch (e) {
    /* never break the page */
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
