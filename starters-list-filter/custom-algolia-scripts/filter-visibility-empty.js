// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/filter-visibility-empty

(function () {
  'use strict'

  // Any element marked with this attribute is kept visible even when the
  // wf-algolia script tries to inline-hide it (empty / all-zero dynamic group).
  var SELECTOR = '[starters-algolia-hide-on-empty="false"]'

  // Display value to restore. '' lets your Webflow/CSS class decide (safest).
  // Use 'block' / 'flex' only if a group needs an explicit value.
  var SHOWN_DISPLAY = ''

  // Undo the library's inline display:none — only when actually hidden, so our
  // own write doesn't retrigger the observer into a loop.
  var unhide = function (el) {
    if (el.style.display === 'none') el.style.display = SHOWN_DISPLAY
  }

  var wire = function (el) {
    if (el.getAttribute('data-hide-on-empty-inited') === 'true') return
    el.setAttribute('data-hide-on-empty-inited', 'true')

    unhide(el) // initial pass

    // The script re-hides on every response — revert each time style flips back.
    var obs = new MutationObserver(function () { unhide(el) })
    obs.observe(el, { attributes: true, attributeFilter: ['style'] })
  }

  var init = function () {
    var els = document.querySelectorAll(SELECTOR)
    for (var i = 0; i < els.length; i++) wire(els[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()