// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/input-preview
/*
  Input Value Preview — input-value-preview
  =========================================
  Needs a better docs but this is the code if you want to preview whatever is being type on an input
  (checkbox, radio, input, select) this is the code, the structure will be added later on

  Global, per-field live preview. Mirrors a single input's value into a matching
  preview slot as the user types/selects, keyed by a unique field name. Unlike
  contract-preview (which mass-collects a whole section), this is 1:1 and controlled:
  only inputs that live inside a [data-input-preview] wrapper are ever scanned, and
  each one writes to exactly the slot whose name matches.

  jQuery pickers: jQuery UI datepicker/timepicker set the value programmatically and fire a
  jQuery `.trigger("change")` that native addEventListener never sees. When window.jQuery is
  present we also delegate change/input through jQuery so those picker values still preview.

  Attribute contract
  ------------------
  Source wrapper:  [data-input-preview="<name>"]   marks a wrapper as previewable.
                   Only [data-input-preview-field] inputs INSIDE one of these are scanned.
                   The <name> value is just a marker/label — matching is by field name below.
  Source field:    [data-input-preview-field="<field-name>"]  the field to read. Put it on:
                     - the input/select/textarea itself (text, number, select, …), OR
                     - a wrapper around a Webflow custom radio/checkbox group.
  Destination:     [data-input-preview-value="<field-name>"]  the preview wrapper. Its
                   <field-name> must EXACTLY match a source field's name (ids are meant to be
                   unique per match, so each field maps to its own slot — no group blast).
                     [data-input-preview-element="value"]  text node filled with the value
                     (falls back to the destination wrapper itself if that child is absent).

  Notes
  -----
  - Radio/checkbox: only the checked option contributes; multiple checked checkboxes join
    with ", ". The value is the input's `value`, falling back to its visible label text
    (Webflow's default checkbox value "on" is treated as empty so the label wins).
  - More than one destination may share a field-name; all matching slots are filled.
*/

(function () {
  'use strict'

  if (window.__inputValuePreviewInited) return
  window.__inputValuePreviewInited = true

  var SELECT_WRAP = '[data-input-preview]'
  var ATTR_FIELD = 'data-input-preview-field'
  var ATTR_VALUE = 'data-input-preview-value'
  var ATTR_OVERRIDE = 'data-input-preview-field-value'
  var SELECT_SLOT = '[data-input-preview-element="value"]'

  // --- helpers -----------------------------------------------------------

  /** Trim ends only — preserves internal spacing. */
  var norm = function (s) { return (s == null ? '' : String(s)).trim() }
  /** Trim + collapse internal whitespace — for names and labels. */
  var clean = function (s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim() }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s)
    return String(s).replace(/["\\\]]/g, '\\$&')
  }

  /** Visible label text for a checked radio/checkbox (Webflow custom controls). */
  function controlLabel(input) {
    var lbl = input.closest('label')
    if (lbl) {
      var span = lbl.querySelector('.w-form-label')
      return clean(span ? span.textContent : lbl.textContent)
    }
    if (input.id) {
      var ext = document.querySelector('label[for="' + cssEscape(input.id) + '"]')
      if (ext) return clean(ext.textContent)
    }
    return norm(input.value)
  }

  /** Readable value for a single form control, or '' when it contributes nothing. */
  function readControl(input) {
    var tag = input.tagName.toLowerCase()
    var type = (input.type || '').toLowerCase()
    if (tag === 'select') {
      var opt = input.options[input.selectedIndex]
      return opt ? norm(opt.textContent) : ''
    }
    if (type === 'checkbox' || type === 'radio') {
      if (!input.checked) return ''
      var v = norm(input.value)
      if (v && v.toLowerCase() !== 'on') return v // skip Webflow's default "on"
      return controlLabel(input)
    }
    return norm(input.value)
  }

  /**
   * Read a [data-input-preview-field] node. When the attribute sits on the control itself,
   * read it directly; when it sits on a wrapper (radio/checkbox group), read the checked
   * option(s) — multiple checked checkboxes join with ", ".
   */
  function readField(fieldEl) {
    var tag = fieldEl.tagName.toLowerCase()
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return readControl(fieldEl)

    var controls = fieldEl.querySelectorAll('input, select, textarea')
    var picked = []
    var fallback = ''
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i]
      if (c.disabled || (c.type || '').toLowerCase() === 'hidden') continue
      var type = (c.type || '').toLowerCase()
      var val = readControl(c)
      if (type === 'checkbox' || type === 'radio') {
        if (val !== '') picked.push(val)
      } else if (val !== '') {
        fallback = val // last filled non-toggle control
      }
    }
    return picked.length ? picked.join(', ') : fallback
  }

  /** Write one field's current value into every matching destination slot. */
  function updateField(fieldEl) {
    var name = clean(fieldEl.getAttribute(ATTR_FIELD))
    if (!name) return
    var value = readField(fieldEl)
    var dests = document.querySelectorAll('[' + ATTR_VALUE + '="' + cssEscape(name) + '"]')
    for (var i = 0; i < dests.length; i++) {
      var slot = dests[i].querySelector(SELECT_SLOT) || dests[i]
      slot.textContent = value
    }
  }

  /** Every previewable source field on the page — inputs inside a [data-input-preview] wrapper. */
  function collectFields() {
    var out = []
    var wraps = document.querySelectorAll(SELECT_WRAP)
    for (var i = 0; i < wraps.length; i++) {
      var fields = wraps[i].querySelectorAll('[' + ATTR_FIELD + ']')
      for (var j = 0; j < fields.length; j++) {
        if (out.indexOf(fields[j]) === -1) out.push(fields[j])
      }
    }
    return out
  }

  function renderAll() {
    var fields = collectFields()
    for (var i = 0; i < fields.length; i++) updateField(fields[i])
  }

  // --- triggers ----------------------------------------------------------

  /** On any input/change, update only the field that owns the event target (if in scope). */
  function handleChange(e) {
    var target = e && e.target
    if (!target || !target.closest) return
    var fieldEl = target.closest('[' + ATTR_FIELD + ']')
    if (!fieldEl || !fieldEl.closest(SELECT_WRAP)) return
    updateField(fieldEl)
  }

  /**
   * Bridge jQuery-triggered events into the native handler. jQuery UI datepicker/timepicker
   * set the input's value programmatically and fire jQuery `.trigger("change")`, which native
   * addEventListener never receives — so without this, picker values never preview.
   */
  var jqBound = false
  function bindJQueryBridge() {
    if (jqBound || !window.jQuery) return
    jqBound = true
    window.jQuery(document).on('change.ivp input.ivp', handleChange)
  }

  function init() {
    document.addEventListener('input', handleChange, true)
    document.addEventListener('change', handleChange, true)
    bindJQueryBridge()
    renderAll() // initial paint (covers pre-filled / deep-link values)
    // jQuery (and pickers) may finish wiring after the footer script — re-bind / re-paint on load.
    window.addEventListener('load', function () { bindJQueryBridge(); renderAll() })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()