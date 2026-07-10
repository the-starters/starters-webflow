// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/custom-algolia-scripts/disable-apply
(function () {
    'use strict'
  
    if (document.documentElement.getAttribute('data-apply-disable-inited') === 'true') return
    document.documentElement.setAttribute('data-apply-disable-inited', 'true')
  
    var APPLY_SEL = '[wf-algolia-button="apply"][starters-algolia-disable-empty]'
    var GROUP_SEL = '[wf-algolia-element="filter-group"]'
    var BROWSE_SEL = '[wf-algolia-element="browse"]'
    var ACTIVE_CLASS = 'is-active'
    var DEFAULT_DISABLED_THEME = 'disabled'
  
    /** All filter groups a button commits, per the WF-Algolia scope cascade. */
    var resolveGroups = function (btn) {
      var scope = btn.closest(BROWSE_SEL) || document
      var all = Array.prototype.slice.call(scope.querySelectorAll(GROUP_SEL))
  
      // Rule 1 — explicit CSV of fields.
      if (btn.hasAttribute('wf-algolia-fields')) {
        var csv = btn.getAttribute('wf-algolia-fields').split(',')
          .map(function (s) { return s.trim() }).filter(Boolean)
        if (!csv.length) return [] // deliberate no-op -> stays disabled
        return all.filter(function (g) {
          var field = g.getAttribute('wf-algolia-field') || g.getAttribute('wf-algolia-facet')
          return field && csv.indexOf(field) !== -1
        })
      }
  
      // Rule 2 — button lives inside a group.
      var own = btn.closest(GROUP_SEL)
      if (own) return [own]
  
      // Rule 3 — browse-wide.
      return all
    }
  
    /** A range group is "active" once either handle is off its authored bound. */
    var rangeHasSelection = function (group) {
      var lo = parseFloat(group.getAttribute('fs-rangeslider-min'))
      var hi = parseFloat(group.getAttribute('fs-rangeslider-max'))
      var minEl = group.querySelector('[wf-algolia-element="range-min"], [fs-rangeslider-element="from-value"]')
      var maxEl = group.querySelector('[wf-algolia-element="range-max"], [fs-rangeslider-element="to-value"]')
      var readVal = function (el) {
        if (!el) return NaN
        var v = parseFloat(el.value)
        if (!isNaN(v)) return v
        return parseFloat(el.getAttribute('aria-valuenow')) // handle fallback
      }
      if (isNaN(lo)) { var mn = minEl && minEl.getAttribute('min'); if (mn != null) lo = parseFloat(mn) }
      if (isNaN(hi)) { var mx = maxEl && maxEl.getAttribute('max'); if (mx != null) hi = parseFloat(mx) }
      var curMin = readVal(minEl)
      var curMax = readVal(maxEl)
      if (!isNaN(curMin) && !isNaN(lo) && curMin > lo) return true
      if (!isNaN(curMax) && !isNaN(hi) && curMax < hi) return true
      return false
    }
  
    var selectHasSelection = function (group) {
      return Array.prototype.some.call(group.querySelectorAll('select'), function (s) {
        return s.value !== '' && s.value != null
      })
    }
  
    var itemHasSelection = function (group) {
      var items = group.querySelectorAll('[wf-algolia-element="filter-item"]')
      return Array.prototype.some.call(items, function (item) {
        if (item.hasAttribute('wf-algolia-reset')) return false // "All"/"Any" resets don't count
        var input = item.matches('input') ? item
          : item.querySelector('input[type="checkbox"], input[type="radio"]')
        if (input && input.checked) return true
        if (item.getAttribute('aria-pressed') === 'true') return true
        if (item.getAttribute('data-wf-algolia-active') === 'true') return true
        if (item.classList.contains(ACTIVE_CLASS)) return true
        return false
      })
    }
  
    /** Type-agnostic: staged (deferred, pre-apply) OR a committed selection in the DOM. */
    var groupHasSelection = function (group) {
      if (group.getAttribute('data-wf-algolia-staged') === 'true') return true
      var type = group.getAttribute('wf-algolia-type')
      if (type === 'range' || group.querySelector('[wf-algolia-element="range-min"]')) return rangeHasSelection(group)
      if (type === 'select' || group.querySelector('select')) return selectHasSelection(group)
      return itemHasSelection(group) // checkbox (default) + radio
    }
  
    var setEnabled = function (btn, enabled) {
      var disabledTheme = btn.getAttribute('data-disabled-theme') || DEFAULT_DISABLED_THEME
  
      if (!enabled) {
        if (btn.getAttribute('data-button-theme') !== disabledTheme) {
          btn.setAttribute('data-active-theme', btn.getAttribute('data-button-theme') || '')
          btn.setAttribute('data-button-theme', disabledTheme)
        }
        btn.setAttribute('aria-disabled', 'true')
      } else {
        if (btn.hasAttribute('data-active-theme')) {
          btn.setAttribute('data-button-theme', btn.getAttribute('data-active-theme'))
        }
        btn.removeAttribute('aria-disabled')
      }
  
      // Keep inner clickable controls in sync for keyboard + AT users.
      Array.prototype.forEach.call(btn.querySelectorAll('button'), function (b) {
        b.disabled = !enabled
      })
    }
  
    // Re-query the buttons on EVERY evaluation — never cache. This page renders/re-parents
    // the filter UI after load (WF-Algolia re-render + the mobile <dialog> move), so any list
    // captured at startup would be empty or stale and we'd silently manage nothing.
    var evaluate = function () {
      Array.prototype.forEach.call(document.querySelectorAll(APPLY_SEL), function (btn) {
        var groups = resolveGroups(btn)
        var enabled = groups.some(groupHasSelection)
        setEnabled(btn, enabled)
      })
    }
  
    // Block a disabled click from reaching WF-Algolia (delegated so it survives re-render).
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest(APPLY_SEL)
      if (btn && btn.getAttribute('aria-disabled') === 'true') {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }, true)
  
    // Recompute on any interaction inside the page's filters.
    ;['input', 'change', 'click'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        if (e.target.closest && e.target.closest(GROUP_SEL)) evaluate()
      }, true)
    })
  
    // Catch programmatic changes and late-rendered/moved buttons: watch the whole document so
    // we never observe a stale, detached browse node.
    var observer = new MutationObserver(function () { evaluate() })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-pressed', 'data-wf-algolia-active', 'data-wf-algolia-staged', 'value']
    })
  
    // Subscribe to WF-Algolia lifecycle events. The bundle is loaded async (type="module"),
    // so window.WfAlgolia may not exist yet when this footer script runs — poll for it and
    // wire the events the moment it appears.
    var EVENTS = ['ready', 'filter', 'filter:parent-stage-change', 'response']
    var wired = false
    var wireWfAlgolia = function () {
      if (wired || !window.WfAlgolia || typeof window.WfAlgolia.on !== 'function') return false
      wired = true
      EVENTS.forEach(function (evt) {
        try { window.WfAlgolia.on(evt, evaluate) } catch (err) {}
      })
      evaluate()
      return true
    }
  
    // Initial paint + a settle loop that runs the FULL window (does not stop early on wire)
    // so state is corrected repeatedly while WF-Algolia and the filter UI finish rendering.
    evaluate()
    var ticks = 0
    var settle = setInterval(function () {
      evaluate()
      wireWfAlgolia()
      if (++ticks >= 40) clearInterval(settle) // ~10s cap
    }, 250)
    window.addEventListener('load', evaluate)
  })()