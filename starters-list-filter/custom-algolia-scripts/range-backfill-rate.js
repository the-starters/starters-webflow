// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/range-backfill-rate

(function () {
    'use strict'
  
    if (document.documentElement.getAttribute('data-range-backfill-inited') === 'true') return
    document.documentElement.setAttribute('data-range-backfill-inited', 'true')
  
    var GROUP_SEL = '[wf-algolia-element="filter-group"][wf-algolia-type="range"]'
  
    var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : null }
  
    // Authored bounds: Finsweet wrapper attrs first, then the inputs' own min/max attrs.
    var boundsOf = function (group, minEl, maxEl) {
      var lo = num(group.getAttribute('fs-rangeslider-min'))
      if (lo === null && minEl) lo = num(minEl.getAttribute('min'))
      var hi = num(group.getAttribute('fs-rangeslider-max'))
      if (hi === null && maxEl) hi = num(maxEl.getAttribute('max'))
      return { lo: lo, hi: hi }
    }
  
    // If a range input is empty/non-numeric, restore it to its bound so WF-Algolia always
    // reads two numbers. Runs in capture so it happens BEFORE WF-Algolia's handler.
    var backfill = function (group) {
      var minEl = group.querySelector('[wf-algolia-element="range-min"]')
      var maxEl = group.querySelector('[wf-algolia-element="range-max"]')
      if (!minEl || !maxEl) return
      var b = boundsOf(group, minEl, maxEl)
      if (num(minEl.value) === null && b.lo !== null) minEl.value = String(b.lo)
      if (num(maxEl.value) === null && b.hi !== null) maxEl.value = String(b.hi)
    }
  
    ;['input', 'change'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        var role = e.target && e.target.getAttribute && e.target.getAttribute('wf-algolia-element')
        if (role !== 'range-min' && role !== 'range-max') return
        var group = e.target.closest(GROUP_SEL)
        if (group) backfill(group)
      }, true)
    })
  })()