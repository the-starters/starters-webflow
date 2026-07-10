// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/clear-filter-visibility

(function () {
  'use strict'

  var HIDDEN = 'wf-reset-hidden'

  // ---- Reset binding (works immediately, no need to wait for WfAlgolia to init) ----
  // Delegated click: fires for the desktop reset AND the separate mobile reset, wherever each
  // one lives (browse wrapper or the filter dialog).
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[wf-algolia-button="reset"]')
    if (!btn || !window.WfAlgolia) return

    window.WfAlgolia.clearAllFilters() // global — ignores browse scope, so the modal button works

    // Reset = clear filters + query in WF-Algolia, so also clear any browse-search input.
    document.querySelectorAll('[wf-algolia-element="browse-search"]').forEach(function (input) {
      if (!input.value) return
      input.value = ''
      if (window.WfAlgolia.setQuery) window.WfAlgolia.setQuery('')
    })
  })

  // ---- Visibility: hide the reset button(s) until there is something to reset ----
  var fieldHasValues = function (v) {
    if (Array.isArray(v)) return v.length > 0
    if (v && Array.isArray(v.values)) return v.values.length > 0
    if (v && typeof v === 'object') return Object.keys(v).length > 0
    return !!v
  }
  var hasActive = function (s) {
    return !!s && Object.keys(s).some(function (k) { return fieldHasValues(s[k]) })
  }

  // Snapshot used to detect change between polls (state + each browse-search value).
  var snapshot = function () {
    var s = window.WfAlgolia ? window.WfAlgolia.getFilterState() : null
    var q = []
    document.querySelectorAll('[wf-algolia-element="browse-search"]').forEach(function (i) {
      q.push(i.value || '')
    })
    return JSON.stringify(s) + '|' + q.join('|')
  }

  var syncAll = function () {
    var btns = document.querySelectorAll('[wf-algolia-button="reset"]')
    if (!btns.length || !window.WfAlgolia) return
    var filtersActive = hasActive(window.WfAlgolia.getFilterState())
    btns.forEach(function (btn) {
      var browse = btn.closest('[wf-algolia-element="browse"]')
      var input = browse && browse.querySelector('[wf-algolia-element="browse-search"]')
      var hasQuery = !!(input && input.value.trim())
      btn.classList.toggle(HIDDEN, !(filtersActive || hasQuery))
    })
  }

  var preHide = function () {
    document.querySelectorAll('[wf-algolia-button="reset"]').forEach(function (b) {
      b.classList.add(HIDDEN)
    })
  }
  preHide()

  var last = null
  var wired = false
  var wire = function () {
    if (wired || !window.WfAlgolia) return
    wired = true
    last = snapshot()
    syncAll()
    // Best-effort instant updates if the events do fire…
    try { window.WfAlgolia.on('filter', syncAll) } catch (e) {}
    try { window.WfAlgolia.on('response', syncAll) } catch (e) {}
    document.querySelectorAll('[wf-algolia-element="browse-search"]').forEach(function (input) {
      input.addEventListener('input', syncAll)
    })
    // …and a polling backstop that always works, even with custom filter UIs.
    setInterval(function () {
      var now = snapshot()
      if (now !== last) { last = now; syncAll() }
    }, 350)
  }

  var tries = 0
  var timer = setInterval(function () {
    preHide()
    tries++
    if (window.WfAlgolia && document.querySelector('[wf-algolia-button="reset"]')) {
      clearInterval(timer); wire()
    } else if (tries > 150) { clearInterval(timer) }
  }, 100)
})()