// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/checkbox-toggle
/*
  Hide/Show an element depending if the checkbox is checked/not

  Where it goes in Webflow: Page or Project footer (before </body>).
  No GSAP, no modules — plain IIFE, safe to run more than once.

  DOM contract (see checkbox-toggle.html):
    [data-checkbox-toggle]                       wrapper (one per toggle pair)
      [data-checkbox-toggle-element="checkbox"]  contains the <input type="checkbox">
      [data-checkbox-toggle-element="item"]      content shown/hidden

  Options (on the wrapper):
    data-checkbox-toggle="invert"   hide the item when checked (default: show when checked)
*/
(function () {
  'use strict'

  var SELECTOR = '[data-checkbox-toggle]'

  /** Sync the item's visibility to the checkbox state. */
  var apply = function (input, item, invert) {
    var show = invert ? !input.checked : input.checked
    item.hidden = !show
  }

  /** Wire one toggle wrapper. Idempotent — guards with data-checkbox-toggle-inited. */
  var init = function (wrap) {
    if (wrap.getAttribute('data-checkbox-toggle-inited') === 'true') return

    var input = wrap.querySelector('[data-checkbox-toggle-element="checkbox"] input[type="checkbox"]') ||
                wrap.querySelector('input[type="checkbox"]')
    var item = wrap.querySelector('[data-checkbox-toggle-element="item"]')
    if (!input || !item) return

    var invert = wrap.getAttribute('data-checkbox-toggle') === 'invert'

    var handleChange = function () { apply(input, item, invert) }
    input.addEventListener('change', handleChange)

    apply(input, item, invert)
    wrap.setAttribute('data-checkbox-toggle-inited', 'true')
  }

  var initAll = function () {
    var wraps = document.querySelectorAll(SELECTOR)
    for (var i = 0; i < wraps.length; i++) init(wraps[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll)
  } else {
    initAll()
  }
})()