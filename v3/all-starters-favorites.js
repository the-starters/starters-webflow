/**
 * V3 /all-starters premium-Brand favorites (All / Saved views).
 *
 * Page glue for the wf-xano favorites module (wf-xano v0.18+ ships the actual
 * toggle/hydration engine; endpoints live in Xano api:opp30 brand/favorites/*).
 * This module:
 *
 *   - injects the favorites UI styles (shell stacking, tab contrast, saved grid),
 *   - builds the All/Saved tab shell + Saved wf-xano wrapper for members whose
 *     active Memberstack plan maps to the brand-paid role,
 *   - decorates every Algolia expert-card favorite wrapper with the canonical
 *     wf-xano favorite attributes (and injects a ♡ visual when the Designer
 *     template ships an empty wrapper).
 *
 * It deliberately does NOT:
 *   - load wf-xano (the site-level Head Code loads it on every page),
 *   - re-declare xanoBase/authBase (site-level WfXanoConfig owns those; this
 *     module only defaults favoritesSource when the site config lacks it —
 *     wf-xano reads favoritesSource lazily, so a deferred assign is safe),
 *   - own the page reveal (the page's inline `ms-loaded` snippet does that,
 *     independent of this CDN file, so a CDN outage can never blank the page),
 *   - gate by hostname (entitlement is the plan check here plus the Xano
 *     plan #4/#5 precondition server-side; Memberstack gated content stays a
 *     separate presentation layer).
 *
 * Install: /all-starters Page Settings -> Custom Code -> Footer, one deferred
 * jsDelivr @latest tag. History: extracted 2026-07-24 from the page's inline
 * footer (see webflow-sites/starters-3/custom-code-backups/).
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
  var SECTION_SELECTOR = '.section_all-starters-body'
  var DEFAULT_FAVORITES_SOURCE = 'opp30:brand/favorites'

  var CSS = [
    '/* The section decorative layers (.all-starters-body_floating-bg, .section_bg',
    '   variants) paint over statically-inserted children; the shell must own a',
    '   stacking context. */',
    '.ts-favorites-shell { position: relative; z-index: 5; padding-top: 1.5rem; padding-bottom: 1.5rem; }',
    '.ts-favorites-tabs { display: flex; gap: .5rem; margin-bottom: 1.5rem; border-bottom: 1px solid currentColor; }',
    '/* Explicit color: the tabs sit on the section dark floating band where the',
    '   inherited text color is near-black. */',
    '.ts-favorites-tab { appearance: none; border: 0; border-bottom: 2px solid transparent; background: transparent; padding: .75rem 1rem; cursor: pointer; font: inherit; color: #fff; }',
    '.ts-favorites-tab[aria-selected="true"] { border-bottom-color: currentColor; font-weight: 600; }',
    '.section_all-starters-body.is-saved-view > .padding-global:not(.ts-favorites-shell) { display: none !important; }',
    '.ts-saved-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem; }',
    '.ts-saved-card { position: relative; overflow: hidden; border: 1px solid rgba(0,0,0,.14); border-radius: .75rem; background: #fff; }',
    '.ts-saved-card_image { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; }',
    '.ts-saved-card_body { display: grid; gap: .5rem; padding: 1rem; }',
    '.ts-saved-card_name { color: inherit; font-size: 1.25rem; font-weight: 600; text-decoration: none; }',
    '.ts-saved-card_meta { display: flex; flex-wrap: wrap; gap: .5rem 1rem; }',
    '.ts-saved-card .expert-card_favorite-wrapper { position: absolute; top: .75rem; right: .75rem; z-index: 2; }',
    '/* Some Designer expert-card template variants ship the favorite wrapper as an',
    '   empty full-width div; pin it to the photo corner like the saved cards. */',
    '.section_all-starters-body .expert-card_wrapper > .expert-card_favorite-wrapper { position: absolute; top: .75rem; right: .75rem; z-index: 2; width: auto; height: auto; }',
    '[wf-xano-element="favorite"].is-wf-xano-favorited path { fill: currentColor; }',
    '[wf-xano-element="favorite"].is-wf-xano-loading { opacity: .55; cursor: wait; }',
    '[wf-xano-element="favorite"]:focus-visible,',
    '.ts-favorites-tab:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }',
    '[wf-xano-element="loader"], [wf-xano-element="error"], [wf-xano-element="empty"] { padding: 2rem 0; }',
    '.ts-saved-pagination { display: flex; align-items: center; justify-content: center; gap: .75rem; padding-top: 1.5rem; }',
    '@media (max-width: 991px) { .ts-saved-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
    '@media (max-width: 767px) { .ts-saved-grid { grid-template-columns: 1fr; } }',
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
      return PREMIUM_PLAN_IDS[connection.planId] && connection.status === 'ACTIVE'
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

  function decorateFavoriteControls(root) {
    var scope = root && root.querySelectorAll ? root : document
    var wrappers = []
    if (scope.matches && scope.matches('.expert-card_favorite-wrapper')) wrappers.push(scope)
    wrappers = wrappers.concat(Array.prototype.slice.call(scope.querySelectorAll('.expert-card_favorite-wrapper')))
    wrappers.forEach(function (wrapper) {
      if (!wrapper.closest(SECTION_SELECTOR + ' [data-wf-algolia-hit-objectid]')) return
      var control = wrapper.querySelector('button.expert_favorite-button') || wrapper
      if (control.getAttribute('wf-xano-element') === 'favorite') return
      control.setAttribute('wf-xano-element', 'favorite')
      control.setAttribute('wf-xano-favorite-type', 'starter')
      control.setAttribute('wf-xano-favorite-label-add', 'Save Starter')
      control.setAttribute('wf-xano-favorite-label-remove', 'Remove saved Starter')
      var visual = control.querySelector('svg') || control.firstElementChild
      if (!visual) {
        // Empty Designer wrapper variant: give it the same visual as saved cards.
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

  function savedMarkup() {
    return '<section wf-xano-element="wrapper" wf-xano-instance="saved-starters" wf-xano-source="opp30:brand/favorites/starters/list" wf-xano-method="POST" wf-xano-auth="memberstack" wf-xano-per-page="20" wf-xano-refresh-on="favorite" wf-xano-favorite-type="starter">' +
      '<div wf-xano-element="loader">Loading saved Starters…</div>' +
      '<div wf-xano-element="error" role="alert">Saved Starters could not be loaded. Please try again.</div>' +
      '<div wf-xano-element="empty"><h2>No saved Starters yet</h2><button type="button" data-open-all-starters>Browse all Starters</button></div>' +
      '<div class="ts-saved-grid" wf-xano-element="list">' +
        '<article class="ts-saved-card" wf-xano-element="template">' +
          '<img class="ts-saved-card_image" wf-xano-src="profile_photo" alt="">' +
          '<button type="button" class="expert-card_favorite-wrapper" wf-xano-element="favorite" wf-xano-favorite-type="starter" wf-xano-favorite-label-add="Save Starter" wf-xano-favorite-label-remove="Remove saved Starter"><span class="expert_favorite-button" wf-xano-element="favorite-visual" aria-hidden="true">♡</span></button>' +
          '<div class="ts-saved-card_body"><a class="ts-saved-card_name" wf-xano-link="slug" wf-xano-link-prefix="/hire/"><span wf-xano-bind="first_name"></span></a>' +
          '<div wf-xano-bind="professional_headline"></div><div wf-xano-bind="profile_type"></div>' +
          '<div class="ts-saved-card_meta"><span wf-xano-bind="hourly_rate" wf-xano-prefix="$" wf-xano-suffix="/hr"></span><span wf-xano-bind="availability"></span></div></div>' +
        '</article>' +
      '</div>' +
      '<div class="ts-saved-pagination"><button type="button" wf-xano-element="page-prev">Previous</button><button type="button" wf-xano-element="page-number">1</button><span wf-xano-element="page-dots">…</span><button type="button" wf-xano-element="page-next">Next</button></div>' +
    '</section>'
  }

  function buildPremiumUi(section) {
    if (section.querySelector('.ts-favorites-shell')) return
    injectStyles()
    var shell = document.createElement('div')
    shell.className = 'padding-global ts-favorites-shell'
    shell.innerHTML = '<div class="container-large"><div class="ts-favorites-tabs" role="tablist" aria-label="Starter views"><button type="button" class="ts-favorites-tab" role="tab" aria-selected="true">All Starters</button><button type="button" class="ts-favorites-tab" role="tab" aria-selected="false">Saved</button></div><div class="ts-favorites-saved" role="tabpanel" hidden>' + savedMarkup() + '</div></div>'
    section.insertBefore(shell, section.firstChild)

    var tabs = shell.querySelectorAll('[role="tab"]')
    var savedPanel = shell.querySelector('.ts-favorites-saved')
    function selectSaved(saved) {
      section.classList.toggle('is-saved-view', saved)
      tabs[0].setAttribute('aria-selected', saved ? 'false' : 'true')
      tabs[1].setAttribute('aria-selected', saved ? 'true' : 'false')
      savedPanel.hidden = !saved
      if (saved) whenFavoritesReady(function (api) { api.init(savedPanel); api.favorites.refresh('starter').catch(function () {}) })
    }
    tabs[0].addEventListener('click', function () { selectSaved(false) })
    tabs[1].addEventListener('click', function () { selectSaved(true) })
    shell.querySelector('[data-open-all-starters]').addEventListener('click', function () { selectSaved(false) })

    decorateFavoriteControls(section)
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes || [], decorateFavoriteControls)
      })
    }).observe(section, { childList: true, subtree: true })
    whenFavoritesReady(function (api) { api.init(shell); api.favorites.init(section) })
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
    var section = document.querySelector(SECTION_SELECTOR)
    if (!section) return
    ensureFavoritesSource()
    memberReady().then(function (member) {
      if (isPremiumBrand(member)) buildPremiumUi(section)
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
