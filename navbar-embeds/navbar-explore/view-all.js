/**
 * Explore menu View All — open a Subcategory's Collection Page, using the
 * navbar's View All Map for the real slug and the label-derived slug otherwise.
 *
 * @release v1.59.584
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with `defer`.
 */

(function () {
  if (window.__startersViewAllInit) return
  window.__startersViewAllInit = true

  var LOG_PREFIX = '[view-all]'

  // Whitespace differs between the facet value and the CMS field, so normalise
  // both sides. Full path only: two Categories may share a Subcategory name.
  function normalisePath(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, ' ')
  }

  // The legacy fallback. Keep byte-for-byte compatible: a miss must land exactly
  // where this script landed before the Map existed, never somewhere new.
  function slugGuess(path) {
    return path
      .split('>')
      .pop()
      .trim()
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  // STARTERS_DEBUG may turn logging on in production; it must never widen what
  // counts as a staging host.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  var warned = false

  function warnOnce(path) {
    if (warned || !diagnosticsEnabled()) return
    warned = true
    console.warn(LOG_PREFIX + ' no Map entry for "' + path + '" — using the derived slug')
  }

  // Queried per click, not cached at load: the Explore rows are Algolia-rendered
  // after load and the Map is 43 links.
  function lookup(path) {
    var entries = document.querySelectorAll('[data-view-all-map] [data-view-all-path]')
    for (var i = 0; i < entries.length; i++) {
      if (normalisePath(entries[i].getAttribute('data-view-all-path')) === path) {
        return (entries[i].getAttribute('href') || '').trim()
      }
    }
    return ''
  }

  // Capturing: the menu stops bubbling clicks before they reach the document.
  document.addEventListener(
    'click',
    function (e) {
      var btn = e.target.closest('[data-navbar-explore="view-all-button"]')
      if (!btn) return
      // wf-algolia stamps wf-algolia-value on the row, not on the button.
      var item = btn.closest('.explore_sub_item')
      if (!item) return

      e.preventDefault()
      e.stopPropagation()

      var path = normalisePath(item.getAttribute('wf-algolia-value'))
      var href = lookup(path)
      if (href) {
        window.location.assign(href)
        return
      }

      warnOnce(path)
      window.location.assign('/subcategories/' + slugGuess(path))
    },
    true
  )
})()
