/**
 * Explore menu View All — open a Subcategory's Collection Page, using the
 * navbar's View All Map for the real slug and the label-derived slug otherwise.
 *
 * @release v1.59.582
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with `defer`.
 *
 * The Map is a hidden Webflow Collection List in the navbar:
 * `[data-view-all-map]` wrapping one `[data-view-all-path]` link per live
 * Subcategory, path bound to the CMS `algolia-filter` field, href to the item's
 * Collection Page. The hand-authored CMS slugs follow no rule, so deriving one
 * from the label 404s on 16 of the 43 Subcategories.
 */

(function () {
  if (window.__startersViewAllInit) return
  window.__startersViewAllInit = true

  var LOG_PREFIX = '[view-all]'

  // Whitespace differs between the Algolia facet value and the CMS field, so
  // normalise both sides before comparing. Match the full path, never the leaf:
  // two Categories may share a Subcategory name.
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

  function warnOnce(path, mapPresent) {
    if (warned || !diagnosticsEnabled()) return
    warned = true
    console.warn(
      LOG_PREFIX +
        ' no Map entry for "' +
        path +
        '" — using the derived slug. Map present: ' +
        (mapPresent ? 'yes' : 'no')
    )
  }

  // Queried per click, not cached at load: the Explore rows are Algolia-rendered
  // after load and the Map is 43 links.
  function lookup(path) {
    var present = !!document.querySelector('[data-view-all-map]')
    if (!present) return { present: false, href: '' }
    var entries = document.querySelectorAll('[data-view-all-map] [data-view-all-path]')
    for (var i = 0; i < entries.length; i++) {
      if (normalisePath(entries[i].getAttribute('data-view-all-path')) === path) {
        return { present: true, href: (entries[i].getAttribute('href') || '').trim() }
      }
    }
    return { present: true, href: '' }
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
      var entry = lookup(path)
      if (entry.href) {
        window.location.assign(entry.href)
        return
      }

      warnOnce(path, entry.present)
      window.location.assign('/subcategories/' + slugGuess(path))
    },
    true
  )
})()
