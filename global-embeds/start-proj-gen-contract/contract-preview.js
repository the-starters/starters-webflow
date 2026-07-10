// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/start-proj-gen-contract
(function () {
  'use strict'

  if (window.__contractPreviewInited) return
  window.__contractPreviewInited = true

  var FLOW = 'generate-contract'

  // --- helpers -----------------------------------------------------------

  /** Trim ends only — preserves a value's internal spacing. */
  var norm = function (s) { return (s == null ? '' : String(s)).trim() }
  /** Trim + collapse internal whitespace — for labels and comparisons. */
  var clean = function (s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim() }
  var lower = function (s) { return clean(s).toLowerCase() }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s)
    return String(s).replace(/["\\\]]/g, '\\$&')
  }

  /** True if the field sits inside a [hidden] ancestor (form-filter marks inactive variants). */
  function inHidden(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute('hidden')) return true
    }
    return false
  }

  /**
   * Best-effort label text for a field. Many `for=` associations in this markup are broken,
   * so we fall back to a wrapping <label>, then the nearest preceding <label> up the ancestor
   * chain, then data-name / placeholder.
   */
  function fieldLabel(field) {
    if (field.id) {
      var l = document.querySelector('label[for="' + cssEscape(field.id) + '"]')
      if (l) return clean(l.textContent)
    }
    var wrap = field.closest('label')
    if (wrap) return clean(wrap.textContent)
    for (var node = field; node && node !== document.body; node = node.parentElement) {
      for (var prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.tagName === 'LABEL') return clean(prev.textContent)
        var inner = prev.querySelector && prev.querySelector('label')
        if (inner) return clean(inner.textContent)
      }
    }
    return clean(field.getAttribute('data-name') || field.getAttribute('placeholder') || field.name || '')
  }

  /** Readable value for a field, or '' when it should be skipped. */
  function fieldValue(field) {
    var tag = field.tagName.toLowerCase()
    var type = (field.type || '').toLowerCase()
    if (tag === 'select') {
      var opt = field.options[field.selectedIndex]
      return opt ? norm(opt.textContent) : ''
    }
    if (type === 'checkbox' || type === 'radio') {
      return field.checked ? norm(field.value) : ''
    }
    return norm(field.value)
  }

  /**
   * Build one entry from a [data-preview-contract-group] wrapper: title from -group-title, value from
   * -group-format with each {label} token replaced by the grouped field whose <label> matches. Renders
   * with blanks for missing tokens; returns null only when every grouped field is empty.
   */
  function buildGroupEntry(group) {
    var map = {}
    var anyFilled = false
    var gfields = group.querySelectorAll('input, select, textarea')
    for (var i = 0; i < gfields.length; i++) {
      var gf = gfields[i]
      if (gf.disabled || gf.type === 'hidden' || inHidden(gf)) continue
      var v = fieldValue(gf)
      if (v !== '') anyFilled = true
      var key = lower(fieldLabel(gf))
      if (key && !(key in map)) map[key] = v // first label wins
    }
    if (!anyFilled) return null
    var fmt = group.getAttribute('data-preview-contract-group-format') || ''
    var value = fmt
      ? fmt.replace(/\{([^}]+)\}/g, function (_, token) {
          var k = lower(token)
          return k in map ? map[k] : ''
        })
      : Object.keys(map).map(function (k) { return map[k] }).filter(Boolean).join(' ')
    return { label: clean(group.getAttribute('data-preview-contract-group-title')), value: norm(value) }
  }

  /** Filled, visible, enabled fields inside a [data-preview-contract-fields] section, in DOM order. */
  function collectFields(sourceEl) {
    var out = []
    var groupsDone = []
    var fields = sourceEl.querySelectorAll('input, select, textarea')
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      if (f.disabled || f.type === 'hidden' || inHidden(f)) continue
      // A field inside a group wrapper is consumed by the group — emit the group once, in DOM order.
      var group = f.closest('[data-preview-contract-group]')
      if (group && sourceEl.contains(group)) {
        if (groupsDone.indexOf(group) === -1) {
          groupsDone.push(group)
          var entry = buildGroupEntry(group)
          if (entry) out.push(entry)
        }
        continue
      }
      // unchecked radios/checkboxes resolve to '' below and are skipped — only the
      // checked option in a radio group contributes, so no per-group de-dup is needed.
      var val = fieldValue(f)
      if (val === '') continue
      out.push({ label: fieldLabel(f), value: val })
    }
    return out
  }

  /**
   * One filled step-1 field by section key + label (case-insensitive). Groups do not block lookup —
   * Start Date inside a group is still reachable. Returns null when not found or empty.
   */
  function getSourceField(scope, key, fieldName) {
    var sourceEl = scope.querySelector('[data-preview-contract-fields="' + cssEscape(key) + '"]')
    if (!sourceEl || !fieldName) return null
    var want = lower(fieldName)
    var fields = sourceEl.querySelectorAll('input, select, textarea')
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      if (f.disabled || f.type === 'hidden' || inHidden(f)) continue
      if (lower(fieldLabel(f)) !== want) continue
      var val = fieldValue(f)
      if (val === '') return null
      return { label: fieldLabel(f), value: val }
    }
    return null
  }

  /** Key + field name for a field-slot node — from self or nearest ancestor wrapper. */
  function resolveFieldSlotConfig(el) {
    var key = ''
    var name = ''
    for (var node = el; node && node !== document.body; node = node.parentElement) {
      if (!key && node.hasAttribute('data-preview-contract-field')) {
        key = clean(node.getAttribute('data-preview-contract-field'))
      }
      if (!name && node.hasAttribute('data-preview-contract-field-name')) {
        name = clean(node.getAttribute('data-preview-contract-field-name'))
      }
      if (key && name) break
    }
    return { key: key, name: name }
  }

  /** Fill every [data-preview-contract-field-slot] from step-1 source (not rendered LIST rows). */
  function renderFieldSlots(scope) {
    var slots = scope.querySelectorAll('[data-preview-contract-field-slot]')
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i]
      var slot = lower(el.getAttribute('data-preview-contract-field-slot'))
      if (slot !== 'value' && slot !== 'title') continue
      var cfg = resolveFieldSlotConfig(el)
      if (!cfg.key || !cfg.name) {
        el.textContent = ''
        continue
      }
      var entry = getSourceField(scope, cfg.key, cfg.name)
      el.textContent = entry ? (slot === 'title' ? entry.label : entry.value) : ''
    }
  }

  // --- rendering ---------------------------------------------------------

  /** Render one destination section from its collected fields (LIST or SINGLE mode). */
  function renderSection(destEl, fields) {
    var tplInDom = destEl.querySelector('[data-preview-contract-element="item"]')
    var tpl = destEl.__previewTpl || (tplInDom ? (destEl.__previewTpl = tplInDom.cloneNode(true)) : null)

    if (tpl) {
      // LIST mode: clear existing rows + pads, clone the template once per field.
      var old = destEl.querySelectorAll('[data-preview-contract-element="item"], [data-preview-contract-pad]')
      for (var r = 0; r < old.length; r++) old[r].parentNode.removeChild(old[r])
      for (var j = 0; j < fields.length; j++) {
        var row = tpl.cloneNode(true)
        var titleEl = row.querySelector('[data-preview-contract-element="title"]')
        var valueEl = row.querySelector('[data-preview-contract-element="value"]')
        if (titleEl) titleEl.textContent = fields[j].label
        if (valueEl) valueEl.textContent = fields[j].value
        destEl.appendChild(row)
      }
      // Keep .table-stats_component even — pad an odd row count with one empty item.
      if (destEl.classList.contains('table-stats_component') && fields.length % 2 === 1) {
        var pad = document.createElement('div')
        pad.className = 'table-stats_item'
        pad.setAttribute('data-preview-contract-pad', '')
        pad.setAttribute('aria-hidden', 'true')
        destEl.appendChild(pad)
      }
      return
    }
    // SINGLE mode: write the first field's value into the lone value slot.
    var slot = destEl.querySelector('[data-preview-contract-element="value"]')
    if (slot) slot.textContent = fields.length ? fields[0].value : ''
  }

  /** Render one modal instance: every destination whose key matches a source section in `scope`. */
  function renderInstance(scope) {
    var byKey = {}
    var sources = scope.querySelectorAll('[data-preview-contract-fields]')
    for (var i = 0; i < sources.length; i++) {
      var key = clean(sources[i].getAttribute('data-preview-contract-fields'))
      if (key) byKey[key] = collectFields(sources[i])
    }
    var dests = scope.querySelectorAll('[data-preview-contract]')
    for (var j = 0; j < dests.length; j++) {
      var k = clean(dests[j].getAttribute('data-preview-contract'))
      if (k && byKey[k]) renderSection(dests[j], byKey[k])
    }
    renderFieldSlots(scope)
    applyToggles(scope)
  }

  // --- toggles -----------------------------------------------------------

  /** Strip a legacy "title="/"value=" prefix from a toggle's expected value. */
  function toggleExpected(raw) {
    raw = norm(raw)
    var m = /^(?:title|value)\s*=\s*([\s\S]*)$/i.exec(raw)
    return m ? norm(m[1]) : raw
  }

  /** Resolve the actual value a toggle compares against, by context. */
  function toggleActual(scope, toggleEl) {
    var refWrap = toggleEl.closest('[data-preview-contract-reference]')
    if (refWrap) {
      var key = clean(refWrap.getAttribute('data-preview-contract-reference'))
      var dest = key ? scope.querySelector('[data-preview-contract="' + cssEscape(key) + '"]') : null
      if (!dest) return ''
      var byTitle = clean(refWrap.getAttribute('data-preview-contract-reference-field'))
      if (byTitle) {
        var titles = dest.querySelectorAll('[data-preview-contract-element="title"]')
        for (var i = 0; i < titles.length; i++) {
          if (lower(titles[i].textContent) === lower(byTitle)) {
            var row = titles[i].closest('[data-preview-contract-element="item"]') || dest
            var v = row.querySelector('[data-preview-contract-element="value"]')
            return v ? norm(v.textContent) : ''
          }
        }
        return ''
      }
      var lone = dest.querySelector('[data-preview-contract-element="value"]')
      return lone ? norm(lone.textContent) : ''
    }
    var section = toggleEl.closest('[data-preview-contract]')
    if (section) {
      var slot = section.querySelector('[data-preview-contract-element="value"]')
      return slot ? norm(slot.textContent) : ''
    }
    return ''
  }

  /** Show each toggle only when its expected value matches the resolved actual value. */
  function applyToggles(scope) {
    var toggles = scope.querySelectorAll('[data-preview-contract-element-toggle]')
    for (var i = 0; i < toggles.length; i++) {
      var t = toggles[i]
      var expected = toggleExpected(t.getAttribute('data-preview-contract-element-toggle'))
      var match = expected !== '' && lower(toggleActual(scope, t)) === lower(expected)
      if (match) t.removeAttribute('hidden')
      else t.setAttribute('hidden', '')
    }
  }

  // --- triggers ----------------------------------------------------------

  var isVisible = function (el) { return !!el && getComputedStyle(el).display !== 'none' }

  /** Re-render this instance whenever `el` flips from hidden to visible. */
  function watchVisibility(el, scope) {
    if (!el) return
    var wasVisible = isVisible(el)
    if (wasVisible) renderInstance(scope)
    new MutationObserver(function () {
      var now = isVisible(el)
      if (now && !wasVisible) renderInstance(scope)
      wasVisible = now
    }).observe(el, { attributes: true, attributeFilter: ['style', 'aria-hidden', 'class'] })
  }

  function init() {
    var forms = document.querySelectorAll('[data-form-flow="' + FLOW + '"]')
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i]
      // Scope to the form's .w-form wrapper (holds both the <form> and its sibling success block);
      // fall back to the modal dialog, then the form's parent.
      var scope = form.closest('.w-form') || form.closest('[data-modal-target]') || form.parentElement
      if (!scope) continue
      watchVisibility(scope.querySelector('[data-form-flow-element="step-2"]'), scope)
      watchVisibility(scope.querySelector('.generate-contract_success'), scope)
      renderInstance(scope) // initial paint (covers already-visible / deep-link cases)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()