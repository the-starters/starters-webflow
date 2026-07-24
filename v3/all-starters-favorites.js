/**
 * V3 /all-starters premium-Brand favorites.
 *
 * Page glue for the wf-xano favorites module (wf-xano v0.18+ ships the
 * toggle/hydration engine; endpoints live in Xano api:opp30 brand/favorites/*).
 * The /all-starters page has TWO `.section_all-starters-body` variants gated by
 * Memberstack: `data-ms-content="premium-brands"` (favorites live here) and
 * `data-ms-content="!premium-brands"` (must never show favorites UI). This
 * module:
 *
 *   - decorates the favorite wrapper in every Algolia expert card inside the
 *     PREMIUM section with the canonical wf-xano favorite attributes (and
 *     injects a ♡ visual when a Designer template variant ships the wrapper
 *     empty), and hard-hides favorite wrappers in the non-premium section,
 *   - binds the Designer-built "Show all / Favourites" radio filter (marked
 *     with data-ts-favorites-view="all|favorites") and applies it to the
 *     existing wf-algolia grid as an objectID filter — the same proven pattern
 *     as the applied-opportunities filter in opportunities-3.0.js. No UI is
 *     created from JS; the control and the empty state belong to the Designer.
 *   - keeps the filter live: while the Favourites view is active, un-hearting
 *     a card re-applies the filter (via the wf-xano:favorite event).
 *
 * It deliberately does NOT:
 *   - create any DOM UI (tabs/grids/radios) — Designer owns all markup,
 *   - load wf-xano or wf-algolia (site-level Head Code loads both sitewide),
 *   - re-declare xanoBase/authBase (site-level WfXanoConfig owns those; this
 *     module only defaults favoritesSource, which wf-xano reads lazily),
 *   - own the page reveal (the page's inline `ms-loaded` snippet does that,
 *     independent of this CDN file, so a CDN outage can never blank the page),
 *   - gate by hostname (entitlement = the brand-paid plan check here, the
 *     Memberstack premium-brands gated-content wrapper as presentation, and
 *     the Xano plan #4/#5 precondition server-side).
 *
 * Designer contract (all inside the data-ms-content="premium-brands" section):
 *   - radio inputs (one group) carrying data-ts-favorites-view="all" (checked
 *     by default) and data-ts-favorites-view="favorites" — the attribute may
 *     sit on the input itself or on its Webflow radio-field wrapper,
 *   - expert-card favorite wrapper (.expert-card_favorite-wrapper) in the card
 *     template, ideally with its bookmark SVG (♡ is injected when absent).
 *
 * Install: /all-starters Page Settings -> Custom Code -> Footer, one deferred
 * jsDelivr @latest tag. History: extracted 2026-07-24 from the page's inline
 * footer; UI injection dropped same day in favor of Designer-built controls
 * (see webflow-sites/starters-3/custom-code-backups/).
 */
;(function () {
  'use strict'

  if (window.__startersV3AllStartersFavoritesBooted) return
  window.__startersV3AllStartersFavoritesBooted = true

  // brand-paid role plan IDs — keep aligned with PLAN_ROLES in
  // v3/route-guard.js / v3/auth-route.js and MS_PLAN_ROLES in
  // opportunities-3.0.js (v3/ACCESS-MATRIX.md is the source of truth).
  var PREMIUM_PLAN_IDS = {
    'pln_new-paid-plan-463h04ph': true,
    'pln_dorxata-test-brand-plan-777r02pa': true,
  }
  var PREMIUM_SECTION = '.section_all-starters-body[data-ms-content="premium-brands"]'
  var NON_PREMIUM_SECTION = '.section_all-starters-body[data-ms-content="!premium-brands"]'
  var VIEW_ATTR = 'data-ts-favorites-view'
  var FAVORITE_TYPE = 'starter'
  var DEFAULT_FAVORITES_SOURCE = 'opp30:brand/favorites'
  // Same sentinel as the applied-opportunities filter: an impossible objectID
  // so "favourites view with zero favourites" shows the grid's empty state.
  var EMPTY_SENTINEL = '__none__'

  var CSS = [
    '/* Favorite control sits on the card photo corner (some Designer template',
    '   variants ship the wrapper as an empty full-width div). */',
    PREMIUM_SECTION + ' .expert-card_wrapper > .expert-card_favorite-wrapper { position: absolute; top: .75rem; right: .75rem; z-index: 2; width: auto; height: auto; }',
    '/* Favorites are premium-only: never show the control in the non-premium variant. */',
    NON_PREMIUM_SECTION + ' .expert-card_favorite-wrapper { display: none !important; }',
    '[wf-xano-element="favorite"].is-wf-xano-favorited path { fill: currentColor; }',
    '[wf-xano-element="favorite"].is-wf-xano-loading { opacity: .55; cursor: wait; }',
    '[wf-xano-element="favorite"]:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }',
  ].join('\n')

  function ensureFavoritesSource() {
    window.WfXanoConfig = window.WfXanoConfig || {}
    if (!window.WfXanoConfig.favoritesSource) {
      window.WfXanoConfig.favoritesSource = DEFAULT_FAVORITES_SOURCE
    }
  }

  function injectStyles() {
    var style = document.createElement('style')
    style.setAttribute('data-ts-favorites', 'true')
    style.textContent = CSS
    document.head.appendChild(style)
  }

  function isPremiumBrand(member) {
    return !!(member && (member.planConnections || []).some(function (connection) {
      return PREMIUM_PLAN_IDS[connection.planId] &&
        (connection.active === true || connection.status === 'ACTIVE')
    }))
  }

  // The site head loads wf-xano on every page; we only wait for it, never
  // inject it (that fallback caused a duplicate-loader hazard as inline code).
  function whenFavoritesReady(callback) {
    var attempts = 0
    function ready() {
      if (window.WfXano && window.WfXano.favorites) return callback(window.WfXano)
      if (++attempts < 100) window.setTimeout(ready, 100)
      else console.warn('[all-starters-favorites] wf-xano favorites API not available; giving up')
    }
    ready()
  }

  // Same access pattern as opportunities-3.0.js waitForWfAlgolia.
  function whenWfAlgoliaReady(callback) {
    var attempts = 0
    function ready() {
      if (window.WfAlgolia && typeof window.WfAlgolia.setFilter === 'function') {
        return callback(window.WfAlgolia)
      }
      if (++attempts < 100) window.setTimeout(ready, 100)
      else console.warn('[all-starters-favorites] wf-algolia setFilter not available; view filter skipped')
    }
    ready()
  }

  function decorateFavoriteControls(root) {
    var scope = root && root.querySelectorAll ? root : document
    var wrappers = []
    if (scope.matches && scope.matches('.expert-card_favorite-wrapper')) wrappers.push(scope)
    wrappers = wrappers.concat(Array.prototype.slice.call(scope.querySelectorAll('.expert-card_favorite-wrapper')))
    wrappers.forEach(function (wrapper) {
      if (!wrapper.closest(PREMIUM_SECTION + ' [data-wf-algolia-hit-objectid]')) return
      var control = wrapper.querySelector('button.expert_favorite-button') || wrapper
      if (control.getAttribute('wf-xano-element') === 'favorite') return
      control.setAttribute('wf-xano-element', 'favorite')
      control.setAttribute('wf-xano-favorite-type', FAVORITE_TYPE)
      control.setAttribute('wf-xano-favorite-label-add', 'Save Starter')
      control.setAttribute('wf-xano-favorite-label-remove', 'Remove saved Starter')
      var visual = control.querySelector('svg') || control.firstElementChild
      if (!visual) {
        // Empty Designer wrapper variant: give it a minimal visual.
        visual = document.createElement('span')
        visual.className = 'expert_favorite-button'
        visual.setAttribute('aria-hidden', 'true')
        visual.textContent = '♡'
        control.appendChild(visual)
      }
      visual.setAttribute('wf-xano-element', 'favorite-visual')
      if (control.tagName === 'BUTTON') control.setAttribute('type', 'button')
      else {
        control.setAttribute('role', 'button')
        control.setAttribute('tabindex', '0')
        control.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            control.click()
          }
        })
      }
      if (window.WfXano && window.WfXano.favorites) window.WfXano.favorites.init(control)
    })
  }

  // ---- Show all / Favourites view filter (Designer-built radios) ----

  var currentView = 'all'

  function viewOfMarker(marker) {
    return marker.getAttribute(VIEW_ATTR) === 'favorites' ? 'favorites' : 'all'
  }

  function applyFilter(api) {
    whenWfAlgoliaReady(function (algolia) {
      if (currentView === 'favorites') {
        var ids = api.favorites.ids(FAVORITE_TYPE)
        algolia.setFilter('objectID', ids.length ? ids : [EMPTY_SENTINEL])
      } else {
        algolia.setFilter('objectID', [])
      }
    })
  }

  function applyView(view, options) {
    currentView = view === 'favorites' ? 'favorites' : 'all'
    whenFavoritesReady(function (api) {
      if (currentView === 'favorites' && !(options && options.skipRefresh)) {
        // Fresh ids on entering the view (also covers first hydration).
        api.favorites.refresh(FAVORITE_TYPE).then(
          function () { applyFilter(api) },
          function () { applyFilter(api) }
        )
      } else {
        applyFilter(api)
      }
    })
  }

  function bindViewControls(section) {
    // Delegated: survives any re-render of the section's contents.
    document.addEventListener('change', function (event) {
      var target = event.target
      if (!target || !target.closest) return
      var marker = target.closest('[' + VIEW_ATTR + ']')
      if (!marker || !section.contains(marker)) return
      if (target.type === 'radio' && !target.checked) return
      applyView(viewOfMarker(marker))
    })

    // Honor the Designer's default-checked radio on load (only act when the
    // non-default view starts checked; "all" needs no filter call).
    var markers = section.querySelectorAll('[' + VIEW_ATTR + ']')
    Array.prototype.forEach.call(markers, function (marker) {
      var input = marker.matches && marker.matches('input') ? marker : marker.querySelector('input')
      if (input && input.checked && viewOfMarker(marker) === 'favorites') applyView('favorites')
    })

    // Un-hearting while in the Favourites view removes the card immediately.
    // wf-xano updates its ids cache before dispatching wf-xano:favorite.
    document.addEventListener('wf-xano:favorite', function (event) {
      var detail = (event && event.detail) || {}
      if (detail.item_type && detail.item_type !== FAVORITE_TYPE) return
      if (currentView === 'favorites') applyView('favorites', { skipRefresh: true })
    })
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

  function boot() {
    var section = document.querySelector(PREMIUM_SECTION)
    if (!section) return
    ensureFavoritesSource()
    injectStyles()
    memberReady().then(function (member) {
      if (!isPremiumBrand(member)) return
      decorateFavoriteControls(section)
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes || [], function (node) {
            if (node.nodeType === 1) decorateFavoriteControls(node)
          })
        })
      }).observe(section, { childList: true, subtree: true })
      whenFavoritesReady(function (api) { api.favorites.init(section) })
      bindViewControls(section)
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
