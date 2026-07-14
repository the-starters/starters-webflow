// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/disabler

(function () {
  'use strict'

  var ELEMENT_ATTR = 'data-disabler-element'
  var TARGET_ATTR = 'data-disabler-target'
  var WHEN_ATTR = 'data-disabler-when'
  var CLEAR_ATTR = 'data-disabler-clear'
  var INIT_ATTR = 'data-disabler-inited'

  var TRIGGER_SELECTOR =
    '[' + ELEMENT_ATTR + '="checkbox"],' +
    '[' + ELEMENT_ATTR + '="radio"],' +
    '[' + ELEMENT_ATTR + '="input"]'
  var TARGET_SELECTOR = '[' + ELEMENT_ATTR + '="target"]'

  // Remember which controls are already wired so peers / re-runs (modal reopen,
  // script pasted twice) never double-bind a listener.
  var boundControls = typeof WeakSet === 'function' ? new WeakSet() : null
  var boundList = []
  var hasBound = function (el) {
    return boundControls ? boundControls.has(el) : boundList.indexOf(el) !== -1
  }
  var markBound = function (el) {
    if (boundControls) boundControls.add(el)
    else if (boundList.indexOf(el) === -1) boundList.push(el)
  }

  /** Include root if it matches, then everything under it that matches. */
  var collect = function (root, selector) {
    var out = []
    if (root.matches && root.matches(selector)) out.push(root)
    Array.prototype.push.apply(out, root.querySelectorAll(selector))
    return out
  }

  /** The form control that carries the state — the marked element or a child. */
  var resolveControl = function (el) {
    var tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return el
    return el.querySelector('input, textarea, select')
  }

  /** Whitespace-separated pairing keys on a trigger or target. */
  var keysOf = function (el) {
    var parts = (el.getAttribute(TARGET_ATTR) || '').split(/\s+/)
    var out = []
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] !== '') out.push(parts[i])
    }
    return out
  }

  /** Is this trigger currently in its "active" (disabling) state? */
  var isActive = function (trigger) {
    var control = resolveControl(trigger)
    if (!control) return false
    var type = (trigger.getAttribute(ELEMENT_ATTR) || '').toLowerCase()
    var when = (trigger.getAttribute(WHEN_ATTR) || '').toLowerCase()

    if (type === 'input') {
      var value = typeof control.value === 'string' ? control.value : ''
      var filled = value.trim() !== ''
      return when === 'empty' ? !filled : filled
    }
    // checkbox / radio
    var checked = control.checked === true
    return when === 'unchecked' ? !checked : checked
  }

  var wantsClear = function (trigger) {
    return trigger.getAttribute(CLEAR_ATTR) === 'true'
  }

  /** Reflect the native disabled attribute (also mirrors onto non-form nodes). */
  var applyDisabled = function (el, disabled) {
    if (disabled) {
      el.disabled = true
      if (!el.hasAttribute('disabled')) el.setAttribute('disabled', '')
    } else {
      el.disabled = false
      if (el.hasAttribute('disabled')) el.removeAttribute('disabled')
    }
  }

  var clearValue = function (el) {
    if (typeof el.value === 'string' && el.value !== '') {
      el.value = ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  // --- Staging-only diagnostics -------------------------------------------
  // Misconfiguration warnings help during development but must NEVER reach the
  // production console. "Staging" = Webflow's *.webflow.io, local dev, or the
  // cloudflared dev tunnel. Force on/off with window.DISABLER_DEBUG = true/false.
  var isStaging = function () {
    if (window.DISABLER_DEBUG === true) return true
    if (window.DISABLER_DEBUG === false) return false
    var h = location.hostname
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      /(^|\.)webflow\.io$/.test(h) ||
      /(^|\.)trycloudflare\.com$/.test(h)
    )
  }

  var warn = function (msg, el) {
    if (!isStaging()) return
    if (window.console && console.warn) console.warn('[data-disabler] ' + msg, el)
  }

  var hasTargetForKey = function (key) {
    return !!document.querySelector(
      '[' + ELEMENT_ATTR + '="target"][' + TARGET_ATTR + '~="' + key + '"]'
    )
  }

  /**
   * Global re-evaluation. For every target key, disabled = OR over all triggers
   * referencing that key of (trigger active?). Runs on init, on every bound
   * event, and on modal-open — global so radio de-selection and late-rendered
   * modals always settle to the correct state.
   */
  var evaluateAll = function () {
    var triggers = document.querySelectorAll(TRIGGER_SELECTOR)
    var targets = document.querySelectorAll(TARGET_SELECTOR)
    var activeByKey = {}
    var clearByKey = {}
    var i, j, keys, key, active, clear

    for (i = 0; i < triggers.length; i++) {
      active = isActive(triggers[i])
      clear = wantsClear(triggers[i])
      keys = keysOf(triggers[i])
      for (j = 0; j < keys.length; j++) {
        key = keys[j]
        if (!(key in activeByKey)) activeByKey[key] = false
        if (!(key in clearByKey)) clearByKey[key] = false
        if (active) activeByKey[key] = true
        if (active && clear) clearByKey[key] = true
      }
    }

    for (i = 0; i < targets.length; i++) {
      var target = targets[i]
      var tkeys = keysOf(target)
      var disable = false
      var clearIt = false
      for (j = 0; j < tkeys.length; j++) {
        if (activeByKey[tkeys[j]]) disable = true
        if (clearByKey[tkeys[j]]) clearIt = true
      }
      applyDisabled(target, disable)
      if (disable && clearIt) clearValue(target)
    }
  }

  var onEvent = function () {
    evaluateAll()
  }

  var bindControl = function (control, alsoInput) {
    if (!control || hasBound(control)) return
    markBound(control)
    control.addEventListener('change', onEvent)
    if (alsoInput) control.addEventListener('input', onEvent)
  }

  /** Other radios sharing this control's group (same form, same name). */
  var radioPeers = function (control) {
    var scope = control.form || document
    var all = scope.querySelectorAll('input[type="radio"]')
    var out = []
    for (var i = 0; i < all.length; i++) {
      if (all[i] !== control && all[i].name === control.name) out.push(all[i])
    }
    return out
  }

  var bindTrigger = function (trigger) {
    if (trigger.getAttribute(INIT_ATTR) === 'true') return
    trigger.setAttribute(INIT_ATTR, 'true')

    var type = (trigger.getAttribute(ELEMENT_ATTR) || '').toLowerCase()
    var control = resolveControl(trigger)
    if (!control) {
      warn('a "' + type + '" trigger has no form control to read state from', trigger)
      return
    }

    // Staging-only misconfiguration diagnostics.
    var declaredKeys = keysOf(trigger)
    if (declaredKeys.length === 0) {
      warn('trigger is missing ' + TARGET_ATTR + ' — nothing to disable', trigger)
    } else {
      for (var d = 0; d < declaredKeys.length; d++) {
        if (!hasTargetForKey(declaredKeys[d])) {
          warn(
            'no target found for key "' + declaredKeys[d] + '" — add ' +
              ELEMENT_ATTR + '="target" ' + TARGET_ATTR + '="' + declaredKeys[d] +
              '" to the element you want disabled',
            trigger
          )
        }
      }
    }
    if (
      (type === 'checkbox' || type === 'radio') &&
      control.type !== 'checkbox' &&
      control.type !== 'radio'
    ) {
      warn(
        ELEMENT_ATTR + '="' + type + '" but this control is "' +
          (control.type || control.tagName.toLowerCase()) +
          '" — it can never be checked, so it will never disable anything',
        trigger
      )
    }

    bindControl(control, type === 'input')

    if (type === 'radio' && control.type === 'radio' && control.name) {
      var peers = radioPeers(control)
      for (var i = 0; i < peers.length; i++) bindControl(peers[i], false)
    }
  }

  var run = function (scope) {
    var root = scope && scope.nodeType === 1 ? scope : document
    collect(root, TRIGGER_SELECTOR).forEach(bindTrigger)
    evaluateAll()
  }

  var start = function () {
    run(document)

    // Modal content in Webflow renders/enables late — re-sync when one opens.
    window.addEventListener('modal-open', function (event) {
      if (event.detail && event.detail.modal) run(event.detail.modal)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
