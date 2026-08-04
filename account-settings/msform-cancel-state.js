/**
 * Cancel/pause form success state — show one success message out of several,
 * picked by the reason button the member clicked.
 *
 * @release v1.59.88
 *
 * ONE job: remember the last state KEY chosen inside a `[msform-cancel-state]`
 * root, and show only the success item tagged with that key. Every other item in
 * that root stays hidden. Nothing is submitted, fetched, or validated here.
 *
 * Where it goes in Webflow: Page or Project footer (before </body>), one
 * deferred tag. No dependencies. Safe to load twice.
 *
 * DOM contract:
 *
 *   <div msform-cancel-state>                        <!-- root: the Form Block -->
 *     <form>
 *       <a msform-cancel-state-element="button"
 *          msform-cancel-state-change="pause">Pause instead</a>
 *       <a msform-cancel-state-element="button"
 *          msform-cancel-state-change="needs">My needs changed</a>
 *     </form>
 *     <div class="w-form-done">                      <!-- Webflow success div -->
 *       <div msform-cancel-state-element="success-wrapper">
 *         <div msform-cancel-state-element="success-item"
 *              msform-cancel-state-key="default">…</div>
 *         <div msform-cancel-state-element="success-item"
 *              msform-cancel-state-key="pause">…</div>
 *         <div msform-cancel-state-element="success-item"
 *              msform-cancel-state-key="needs">…</div>
 *       </div>
 *     </div>
 *   </div>
 *
 * THE KEY IS THE WHOLE CONTRACT: `msform-cancel-state-change="needs"` on a
 * button shows the item carrying `msform-cancel-state-key="needs"`, and nothing
 * else matches them up — not DOM order, not position. Keys are compared trimmed
 * and case-sensitively, so `Needs` and `needs` are two different states.
 *
 * THE BUTTON IS WEBFLOW'S `.button_main-wrap` COMPONENT, so both attributes go on
 * the WRAPPER — the same element the page's other systems already tag:
 *
 *   <div data-form-flow-action="branch" data-form-flow-target="step-4a"
 *        data-button-theme="black" data-button-style="primary"
 *        data-validate-element="button"
 *        msform-cancel-state-element="button"
 *        msform-cancel-state-change="needs"
 *        class="button_main-wrap">
 *     <div class="clickable_wrap"><button type="button" class="clickable_btn"></button></div>
 *     <div class="button_main-element">
 *       <div class="button_main-text">My needs changed</div>
 *       <div class="button_main-line"></div>
 *     </div>
 *   </div>
 *
 * The real click lands on the overlaid `.clickable_btn`, or on `.button_main-text`,
 * never on the wrapper itself — so the trigger is resolved with `closest()` from
 * whatever was clicked, and tagging the wrapper is enough. It is also why the
 * inner `type` is irrelevant: the flow's branch buttons are `type="button"` and
 * the final Confirm is `type="submit"`, and both work because the click is never
 * intercepted (see below).
 *
 * `msform-cancel-state-change` holds the STATE KEY, never the element role. A
 * value of `button`, `success-item`, or `success-wrapper` means the two attributes
 * got swapped; staging says so by name, and the click still falls back to the
 * `default` item rather than blanking the success box.
 *
 * A DISABLED CONTROL NEVER CHANGES STATE. step-flow.js and tab-component.js gate a
 * Continue by attribute on this same wrapper (`data-button-theme="disabled"`,
 * `data-form-flow-disabled`, `aria-disabled="true"`) and not by the native
 * `disabled` property, so a gated button still RECEIVES the click — it is only
 * `preventDefault()`-ed. Because this listener runs in the capture phase it sees
 * that click first, so it checks those markers from the trigger up to the root and
 * stands down. Without that, a member could repaint the success message from a
 * step the flow refused to advance.
 *
 * Nothing is ever inferred. Unlike step-flow, this script does not read button
 * labels, `data-button-style`, or bare `<button>` elements, so it cannot hijack a
 * tab control or a footer button that merely looks like a state trigger. The only
 * thing that makes a control a trigger is its own `msform-cancel-state-change`.
 *
 * `default` is the state before anyone clicks, and a button can return to it
 * (`msform-cancel-state-change="default"`) like any other key. Give the root a
 * value to start somewhere else — `msform-cancel-state="pause"`. A root value
 * that does not name an existing item is treated as a label, not a state, so
 * `msform-cancel-state="cancel-form"` still starts on `default`.
 *
 * Optional attributes:
 *   msform-cancel-state-display="flex"   on an item: the display used when it is
 *                                        shown. Only needed when the item is
 *                                        hidden in the Designer AND is not a
 *                                        block — see WHY DISPLAY IS SNIFFED.
 *
 * Written back for CSS/QA hooks (always in the un-prefixed spelling):
 *   msform-cancel-state-current="needs" on the root — the live state.
 *   msform-cancel-state-active="true"   on the button(s) for that state.
 *   aria-hidden                         on every item, tracking its visibility.
 *
 * Also accepts the `data-` spelling of every attribute above
 * (`data-msform-cancel-state-change="pause"`), because every other script in this
 * repo is `data-*` and a mixed-spelling page would otherwise fail silently.
 *
 * SCALES TO ANY NUMBER OF FORMS ON ONE PAGE. State lives per root, and each root
 * only ever reads elements it owns — an element whose NEAREST `[msform-cancel-state]`
 * ancestor is that root. Two cancel forms on one page, or one nested inside
 * another, cannot read or repaint each other's items. Clicks are handled by a
 * single delegated listener rather than one listener per button, so buttons and
 * items that Webflow renders later (CMS, a component, a modal that mounts on
 * open) work with no re-init.
 *
 * EVERY MATCHING ITEM SHOWS, not the first. A key is a state, not an element id;
 * a `pause` heading and a `pause` card can both be tagged and both appear.
 *
 * WHY THE CLICK IS NEVER `preventDefault()`-ed: these buttons double as the
 * step-flow Continue control (global-embeds/step-flow/step-flow.js, which does
 * its own preventDefault) and as the form's submit button. Swallowing the click
 * here would break navigation or the submit itself. This script only ever
 * records state as a side effect of a click that still does its normal job.
 *
 * WHY THE STATE IS PAINTED AT CLICK TIME AND NOT ON SUCCESS: the success div is
 * in the DOM from page load, just hidden, so the right item can be revealed
 * before Webflow ever shows the block. There is nothing to listen for, and no
 * race with Webflow's AJAX submit. It also means a member who changes their mind
 * and clicks a different reason repaints immediately.
 *
 * NOT PERSISTED. State is in-page only. Webflow's AJAX submit reveals the
 * success div without a reload, so it survives submitting; it does NOT survive a
 * form that redirects or reloads. If a redirecting variant ever needs this, store
 * the key in sessionStorage on click and read it in init() — deliberately not
 * built, because the cancel form does not reload today.
 *
 * WHY DISPLAY IS SNIFFED INSTEAD OF FORCED TO `block`: the authored display is
 * read once (before anything is hidden) and restored on show, so a flex or grid
 * item keeps its layout. Items hidden in the Designer compute to `none`, which is
 * not a display anything can be restored to — those fall back to `block` unless
 * `msform-cancel-state-display` says otherwise.
 *
 * Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`) or with `window.STARTERS_DEBUG === true`; production
 * stays silent. They fire on the authoring mistakes that are otherwise invisible:
 * a key with no item, a button outside every root, a root with no items.
 *
 * Public API: `window.StartersMsFormCancelState` — `get(root)`, `set(root, key)`,
 * `refresh()` for QA and for DOM that arrives late.
 */
;(function () {
  'use strict'

  if (window.__startersMsFormCancelStateBooted) return
  window.__startersMsFormCancelStateBooted = true

  var LOG_PREFIX = '[starters msform-cancel-state]'

  var NS = 'msform-cancel-state'
  var ROOT_ATTR = NS
  var ELEMENT_ATTR = NS + '-element'
  var CHANGE_ATTR = NS + '-change'
  var KEY_ATTR = NS + '-key'
  var CURRENT_ATTR = NS + '-current'
  var ACTIVE_ATTR = NS + '-active'
  var DISPLAY_ATTR = NS + '-display'
  var INITED_ATTR = NS + '-inited'

  var DEFAULT_KEY = 'default'

  // Restoring an item that was hidden in the Designer has no authored display to
  // go back to; block is the Webflow div default.
  var FALLBACK_DISPLAY = 'block'

  /* How the page's other systems mark a `.button_main-wrap` as disabled. Read,
   * never written — this script does not own button state. */
  var FLOW_DISABLED_ATTR = 'data-form-flow-disabled'
  var THEME_ATTR = 'data-button-theme'
  var DISABLED_THEME = 'disabled'

  // Values that belong to `-element`, so seeing one as a state key means the two
  // attributes were swapped.
  var ELEMENT_ROLES = ['button', 'success-wrapper', 'success-item']

  /* ------------------------------ environment ------------------------------ */

  // Anchored on purpose (same shape as v3/plan-dates.js): a lookalike such as
  // "notwebflow.io" or "evil-trycloudflare.com" must not read as staging.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never widen what counts as a staging host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function warn(message, detail) {
    if (!diagnosticsEnabled()) return
    if (detail === undefined) console.warn(LOG_PREFIX + ' ' + message)
    else console.warn(LOG_PREFIX + ' ' + message, detail)
  }

  var warned = new WeakSet()

  /**
   * Warn about one element once. An authoring mistake on a button would otherwise
   * repeat on every click, and a console repeating the same line reads as a loop
   * rather than as one thing to fix.
   */
  function warnOnce(el, message) {
    if (!diagnosticsEnabled() || warned.has(el)) return
    warned.add(el)
    warn(message, el)
  }

  /* ------------------------------- attributes ------------------------------- */

  /** Selector matching both the bare and the `data-` spelling of an attribute. */
  function sel(name, value) {
    var tail = value === undefined ? ']' : '="' + value + '"]'
    return '[' + name + tail + ', [data-' + name + tail
  }

  /** Attribute value in either spelling; bare wins when both are present. */
  function attr(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return null
    var bare = el.getAttribute(name)
    return bare === null ? el.getAttribute('data-' + name) : bare
  }

  /** Trimmed attribute value, or '' when absent — keys are always compared trimmed. */
  function keyAttr(el, name) {
    var value = attr(el, name)
    return value === null ? '' : String(value).trim()
  }

  var ROOT_SEL = sel(ROOT_ATTR)
  var WRAPPER_SEL = sel(ELEMENT_ATTR, 'success-wrapper')
  var ITEM_SEL = sel(ELEMENT_ATTR, 'success-item')
  var CHANGE_SEL = sel(CHANGE_ATTR)

  /* -------------------------------- ownership ------------------------------- */

  /** The root an element belongs to: its nearest `[msform-cancel-state]` ancestor. */
  function nearestRoot(el) {
    if (!el || typeof el.closest !== 'function') return null
    return el.closest(ROOT_SEL)
  }

  /**
   * Matches inside `scope` that belong to `root`. A match owned by a DIFFERENT
   * root is dropped — that is the whole defence against two forms (or a nested
   * pair) repainting each other. `null` ownership is kept because the form-block
   * fallback below legitimately searches outside the root.
   */
  function ownedIn(scope, root, selector) {
    var found = scope.querySelectorAll(selector)
    var out = []
    for (var i = 0; i < found.length; i++) {
      var owner = nearestRoot(found[i])
      if (owner === root || owner === null) out.push(found[i])
    }
    return out
  }

  /**
   * Owned matches for `selector`, searched in the root and — only when the root
   * turns up nothing — in the Webflow form block around it. That fallback is what
   * makes the root work whether it is tagged on the Form Block (success div
   * inside it) or on the `<form>` itself, where Webflow puts the success div as a
   * SIBLING of the form and it is therefore not a descendant of the root.
   */
  function collect(root, selector) {
    var found = ownedIn(root, root, selector)
    if (found.length) return found
    var block = typeof root.closest === 'function' ? root.closest('.w-form') : null
    if (!block || block === root) return found
    return ownedIn(block, root, selector)
  }

  /**
   * The success items this root owns, preferring the ones inside a tagged
   * `success-wrapper` and falling back to any owned item when the wrapper is
   * missing or empty — a forgotten wrapper should not silently kill the feature.
   * Looked up fresh on every paint, so late-rendered items need no re-init.
   */
  function itemsFor(root) {
    var wrappers = collect(root, WRAPPER_SEL)
    var out = []
    for (var i = 0; i < wrappers.length; i++) {
      var inWrapper = ownedIn(wrappers[i], root, ITEM_SEL)
      for (var j = 0; j < inWrapper.length; j++) {
        if (out.indexOf(inWrapper[j]) === -1) out.push(inWrapper[j])
      }
    }
    return out.length ? out : collect(root, ITEM_SEL)
  }

  /** The state buttons this root owns. */
  function buttonsFor(root) {
    return collect(root, CHANGE_SEL)
  }

  /** Every root on the page. */
  function roots() {
    var found = document.querySelectorAll(ROOT_SEL)
    var out = []
    for (var i = 0; i < found.length; i++) out.push(found[i])
    return out
  }

  function withKey(items, key) {
    var out = []
    for (var i = 0; i < items.length; i++) {
      if (keyAttr(items[i], KEY_ATTR) === key) out.push(items[i])
    }
    return out
  }

  /* ------------------------------- visibility ------------------------------- */

  var authoredDisplay = new WeakMap()

  /**
   * The display an item is shown with. Resolved once, BEFORE anything is hidden,
   * or the inline `none` this script writes would be read back as the authored
   * value and the item could never come back.
   */
  function displayFor(el) {
    var override = keyAttr(el, DISPLAY_ATTR)
    if (override) return override
    if (authoredDisplay.has(el)) return authoredDisplay.get(el)

    var computed = ''
    try {
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null
      computed = (style && style.display) || ''
    } catch (e) {
      computed = ''
    }

    var resolved = !computed || computed === 'none' ? FALLBACK_DISPLAY : computed
    authoredDisplay.set(el, resolved)
    return resolved
  }

  function hide(el) {
    displayFor(el) // capture the authored display before overwriting it
    el.style.display = 'none'
    el.setAttribute('aria-hidden', 'true')
  }

  function show(el) {
    el.style.display = displayFor(el)
    el.setAttribute('aria-hidden', 'false')
  }

  /* --------------------------------- state ---------------------------------- */

  /**
   * Paint one root: show the items whose key is `key`, hide every other item this
   * root owns, and reflect the state onto the root and its buttons.
   *
   * A key with no item falls back to rendering `default` rather than an empty
   * success box, because a mistyped key must never leave a member staring at a
   * blank confirmation. `msform-cancel-state-current` still reports the key that
   * was actually requested — the state is what the member chose; only the
   * rendering fell back.
   *
   * @returns {Element[]} the items left visible
   */
  function apply(root, key) {
    if (!root) return []

    var wanted = String(key === undefined || key === null ? '' : key).trim() || DEFAULT_KEY
    var items = itemsFor(root)

    root.setAttribute(CURRENT_ATTR, wanted)
    markButtons(root, wanted)

    if (!items.length) {
      warn('a root has no [' + ELEMENT_ATTR + '="success-item"]; nothing to switch', root)
      return []
    }

    var matched = withKey(items, wanted)
    if (!matched.length && wanted !== DEFAULT_KEY) {
      warn(
        'no success-item with ' + KEY_ATTR + '="' + wanted + '"; showing "' + DEFAULT_KEY + '" instead',
        root
      )
      matched = withKey(items, DEFAULT_KEY)
    }
    if (!matched.length) {
      warn(
        'no success-item matches "' + wanted + '" and there is no "' + DEFAULT_KEY +
          '" item; the success block will be empty',
        root
      )
    }

    for (var i = 0; i < items.length; i++) {
      if (matched.indexOf(items[i]) === -1) hide(items[i])
      else show(items[i])
    }

    return matched
  }

  /** Flag the button(s) for the live state; clear the rest. Pure styling hook. */
  function markButtons(root, key) {
    var buttons = buttonsFor(root)
    for (var i = 0; i < buttons.length; i++) {
      if (keyAttr(buttons[i], CHANGE_ATTR) === key) buttons[i].setAttribute(ACTIVE_ATTR, 'true')
      else buttons[i].removeAttribute(ACTIVE_ATTR)
    }
  }

  /**
   * The state a root starts in. A root value that names an existing item is an
   * explicit starting state; anything else is just an instance label
   * (`msform-cancel-state="cancel-form"`) and must not strand the form on a state
   * that has no message.
   */
  function initialKey(root, items) {
    var declared = keyAttr(root, ROOT_ATTR)
    if (!declared) return DEFAULT_KEY
    return withKey(items || itemsFor(root), declared).length ? declared : DEFAULT_KEY
  }

  function getState(root) {
    if (!root) return null
    var current = attr(root, CURRENT_ATTR)
    return current === null ? initialKey(root) : String(current).trim()
  }

  function setState(root, key) {
    return apply(root, key)
  }

  /** First paint for a root. Idempotent — a second call is a no-op. */
  function init(root) {
    if (!root || root.getAttribute(INITED_ATTR) === 'true') return false
    root.setAttribute(INITED_ATTR, 'true')
    apply(root, initialKey(root))
    return true
  }

  /**
   * Re-scan the page: new roots get their first paint, roots already inited
   * repaint their current state. The repaint is what picks up success items
   * rendered after init, and what QA can call instead of faking a click.
   */
  function refresh() {
    var found = roots()
    for (var i = 0; i < found.length; i++) {
      if (found[i].getAttribute(INITED_ATTR) === 'true') apply(found[i], getState(found[i]))
      else init(found[i])
    }
    return found
  }

  /* -------------------------------- controls -------------------------------- */

  /**
   * Whether a trigger is currently disabled by another system, checked from the
   * trigger up to its root and never past it.
   *
   * Webflow's button component is a WRAPPER (`.button_main-wrap`) around an
   * overlaid `<button class="clickable_btn">`, and step-flow.js / tab-component.js
   * disable it by ATTRIBUTE on that wrapper — `data-button-theme="disabled"`,
   * `data-form-flow-disabled`, `aria-disabled="true"` — not by the native
   * `disabled` property. A gated Continue therefore still receives the click and is
   * only `preventDefault()`-ed, and this listener sees it first (capture phase), so
   * without this check a member could repaint the success message from a step the
   * flow refused to advance. The native `disabled` property is checked too, for a
   * trigger tagged directly on a real `<button>`.
   */
  function isDisabled(trigger, root) {
    var node = trigger
    while (node) {
      if (node.disabled === true) return true
      if (node.getAttribute('aria-disabled') === 'true') return true
      if (node.hasAttribute(FLOW_DISABLED_ATTR)) return true
      if (node.getAttribute(THEME_ATTR) === DISABLED_THEME) return true
      if (node === root) return false
      node = node.parentElement
    }
    return false
  }

  /* -------------------------------- listeners ------------------------------- */

  /**
   * One delegated listener for the whole page, in the CAPTURE phase so a handler
   * further down that calls `stopPropagation()` cannot swallow the state change.
   *
   * Matches on `msform-cancel-state-change` alone rather than also requiring
   * `msform-cancel-state-element="button"`: the key is what carries meaning, and
   * a forgotten `element="button"` should not turn the button into a silent no-op.
   */
  function watchClicks() {
    document.addEventListener(
      'click',
      function (e) {
        var target = e && e.target
        if (!target || typeof target.closest !== 'function') return

        var trigger = target.closest(CHANGE_SEL)
        if (!trigger) return

        var key = keyAttr(trigger, CHANGE_ATTR)
        if (!key) {
          warnOnce(trigger, CHANGE_ATTR + ' is empty on a clicked button; ignoring it')
          return
        }

        var root = nearestRoot(trigger)
        if (!root) {
          warnOnce(
            trigger,
            'a ' + CHANGE_ATTR + '="' + key + '" button is not inside a [' + ROOT_ATTR + '] root; ignoring it'
          )
          return
        }

        // A gated Continue still receives the click; see isDisabled.
        if (isDisabled(trigger, root)) return

        if (ELEMENT_ROLES.indexOf(key) !== -1) {
          warnOnce(
            trigger,
            CHANGE_ATTR + '="' + key + '" is an ' + ELEMENT_ATTR + ' role, not a state key — the two ' +
              'attributes look swapped. Put the role on ' + ELEMENT_ATTR + ' and the key that matches ' +
              KEY_ATTR + ' (e.g. "pause") on ' + CHANGE_ATTR
          )
        }

        // A root that Webflow rendered after init has never been painted.
        if (root.getAttribute(INITED_ATTR) !== 'true') init(root)

        apply(root, key)
      },
      true
    )
  }

  function boot() {
    watchClicks()
    refresh()
  }

  window.StartersMsFormCancelState = {
    // Keep in sync with the @release line in this file's header comment; the
    // msform-cancel-state.test.js drift guard asserts they match.
    release: 'v1.59.88',
    stagingHost: stagingHost,
    diagnosticsEnabled: diagnosticsEnabled,
    roots: roots,
    items: itemsFor,
    buttons: buttonsFor,
    get: getState,
    set: setState,
    apply: apply,
    init: init,
    refresh: refresh,
    isDisabled: isDisabled,
    defaultKey: DEFAULT_KEY,
    attrs: {
      root: ROOT_ATTR,
      element: ELEMENT_ATTR,
      change: CHANGE_ATTR,
      key: KEY_ATTR,
      current: CURRENT_ATTR,
      active: ACTIVE_ATTR,
      display: DISPLAY_ATTR,
      inited: INITED_ATTR,
    },
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
