/**
 * Cancel-flow success state — show one success message out of several, picked by
 * the reason button the member clicked.
 *
 * @release v1.59.91
 *
 * ONE job: remember the state KEY chosen inside a `[ms-form-cancel-state]` root and
 * show only the success item tagged with that key. Nothing is submitted, fetched,
 * or validated here.
 *
 * Where it goes in Webflow: Page or Project footer (before </body>), one deferred
 * tag. No dependencies. Safe to load twice.
 *
 * WHY THIS IS A PAGE SCRIPT AND NOT A step-flow CAPABILITY. The repo's rule is to
 * extend an established library when the capability will be reused, and to keep a
 * one-off here only when the behavior is genuinely page-specific. step-flow.js owns
 * these very buttons, but it never touches anything inside `.w-form-done`: its model
 * is "which step is visible NOW", and `resetFlow()` deliberately clears that on
 * init, on `data-form-flow-action="reset"`, and on every panel-nav reopen. This
 * state has to OUTLIVE the submit and persist into the success view, so folding it
 * into step-flow would mean bolting a reset-exempt second state concept onto an
 * engine built on the opposite assumption — and step-flow also ships to
 * /generate-contract, which has no success messages to switch. The display
 * cache-and-restore below is deliberately the minimum version of step-flow's: no
 * display-override attribute, no valid-display whitelist.
 *
 * Vocabulary: `ms-form-*`, the same family as `account-settings/plan-dates.js`
 * (`ms-form-pause-*`), so this folder reads as one dialect rather than two.
 *
 * DOM contract:
 *
 *   <div ms-form-cancel-state class="w-form">        <!-- the Form Block -->
 *     <form>
 *       <div ms-form-cancel-state-element="button"
 *            ms-form-cancel-state-change="needs"
 *            class="button_main-wrap">…</div>
 *     </form>
 *     <div class="w-form-done">                      <!-- Webflow success div -->
 *       <div ms-form-cancel-state-element="success-wrapper">
 *         <div ms-form-cancel-state-element="success-item"
 *              ms-form-cancel-state-key="default">…</div>
 *         <div ms-form-cancel-state-element="success-item"
 *              ms-form-cancel-state-key="pause">…</div>
 *         <div ms-form-cancel-state-element="success-item"
 *              ms-form-cancel-state-key="needs">…</div>
 *       </div>
 *     </div>
 *   </div>
 *
 * THE KEY IS THE WHOLE CONTRACT: `ms-form-cancel-state-change="needs"` shows the
 * item carrying `ms-form-cancel-state-key="needs"` and hides every other item this
 * root owns. Nothing else pairs them up — not DOM order, not position. Keys are
 * compared trimmed and case-sensitively, so `Needs` and `needs` are two states.
 * `default` is what shows before anyone clicks, and it is reachable as a key like
 * any other, which is how a "Keep my membership" or reset button returns the block
 * to its opening message.
 *
 * EVERY MATCHING ITEM SHOWS, not the first — a key is a state, not an element id,
 * so a heading and a card can share one key. A key with NO item shows nothing and
 * warns on staging: the contract is "only the div with that key shows", so a
 * mistyped key is an authoring bug to surface, not something to paper over with a
 * different message.
 *
 * A TRIGGER NEEDS BOTH ATTRIBUTES — `ms-form-cancel-state-element="button"` and
 * `ms-form-cancel-state-change="<key>"`. Either one alone does nothing and says so
 * on staging. `-change` holds the state key and never the element role: a value of
 * `button`, `success-wrapper`, or `success-item` means the two attributes got
 * swapped, and such a click is INERT rather than being treated as a state named
 * "button".
 *
 * THE ROOT MUST CONTAIN ITS OWN SUCCESS ITEMS. Tag the Form Block — the `.w-form`
 * div — and not the `<form>`, because Webflow emits `.w-form-done` as a SIBLING of
 * the form, so a root on the form cannot see it. Ownership is strict: an element
 * counts only when its NEAREST `[ms-form-cancel-state]` ancestor is this root. That
 * is what stops two cancel forms on one page, or a nested pair, from reading or
 * repainting each other's items. (An earlier draft widened the search to the
 * enclosing `.w-form` when a root came up empty. That coupled behavior to a styling
 * class, against the repo's attributes-not-classes rule, and could let a root adopt
 * items owned by no root in an outer Form Block. A root with no items now warns.)
 *
 * The root's attribute VALUE is free — `ms-form-cancel-state="cancel-form"` is a
 * label and nothing more. The opening state is always `default`.
 *
 * Written back, for CSS and QA: `ms-form-cancel-state-current` on the root (the
 * live state) and `aria-hidden` on every item, tracking its visibility.
 *
 * SCALES TO ANY NUMBER OF FORMS. State lives per root. One delegated `document`
 * click listener in the CAPTURE phase covers every root on the page, so buttons and
 * items Webflow renders later (CMS, a component, a modal that mounts on open) need
 * no re-init, and a `stopPropagation()` from a handler below cannot swallow the
 * state change.
 *
 * THE CLICK IS NEVER `preventDefault()`-ed. These buttons are Webflow's
 * `.button_main-wrap` component and double as the step-flow Continue control (which
 * does its own) and as the form's submit. Both attributes go on that WRAPPER — the
 * same element `data-form-flow-action` and `data-validate-element` already sit on —
 * because the real click lands on the overlaid `.clickable_btn` or on
 * `.button_main-text`, never on the wrapper itself. The trigger is therefore
 * resolved with `closest()` from whatever was clicked, and the inner `type` is
 * irrelevant: branch buttons are `type="button"`, the final Confirm is
 * `type="submit"`, and both work because the click is left alone.
 *
 * A DISABLED CONTROL NEVER CHANGES STATE. step-flow.js and global-embeds/tabs/tabs.js
 * gate a Continue by ATTRIBUTE on that same wrapper (`data-button-theme="disabled"`,
 * `data-form-flow-disabled`, `aria-disabled="true"`) and not by the native `disabled`
 * property, so a gated button still RECEIVES the click and is only
 * `preventDefault()`-ed. Because this listener runs in the capture phase it sees that
 * click first, so it checks those markers from the trigger up to the root and stands
 * down. Without it, a member could repaint the success message from a step the flow
 * refused to advance.
 *
 * Nothing is ever inferred. Unlike step-flow, this script does not read button
 * labels, `data-button-style`, or bare `<button>` elements, so it cannot hijack a tab
 * control or a footer button that merely looks like a state trigger.
 *
 * WHY THE STATE IS PAINTED AT CLICK TIME AND NOT ON SUCCESS: the success div is in
 * the DOM from page load, just hidden, so the right item can be revealed before
 * Webflow ever shows the block. There is nothing to listen for and no race with
 * Webflow's AJAX submit.
 *
 * NOT PERSISTED. In-page only: it survives Webflow's AJAX submit, which reveals the
 * success div without a reload, but not a redirect or a page reload.
 *
 * Diagnostics are staging-only (`*.webflow.io`, localhost, 127.0.0.1,
 * `*.trycloudflare.com`) or with `window.STARTERS_DEBUG === true`; production stays
 * silent. They fire once per element on the mistakes that are otherwise invisible.
 *
 * `window.StartersMsFormCancelState` exposes `get`, `set`, and `refresh` for console
 * checks on staging.
 */
;(function () {
  'use strict'

  if (window.__startersMsFormCancelStateBooted) return
  window.__startersMsFormCancelStateBooted = true

  var LOG_PREFIX = '[starters ms-form-cancel-state]'

  var NS = 'ms-form-cancel-state'
  var ROOT_ATTR = NS
  var ELEMENT_ATTR = NS + '-element'
  var CHANGE_ATTR = NS + '-change'
  var KEY_ATTR = NS + '-key'
  var CURRENT_ATTR = NS + '-current'
  var INITED_ATTR = NS + '-inited'

  var ROOT_SEL = '[' + ROOT_ATTR + ']'
  var WRAPPER_SEL = '[' + ELEMENT_ATTR + '="success-wrapper"]'
  var ITEM_SEL = '[' + ELEMENT_ATTR + '="success-item"]'
  var TRIGGER_SEL = '[' + CHANGE_ATTR + ']'

  var BUTTON_ROLE = 'button'
  var DEFAULT_KEY = 'default'

  // Restoring an item hidden in the Designer has no authored display to go back to;
  // block is the Webflow div default.
  var FALLBACK_DISPLAY = 'block'

  // How the page's other systems mark a `.button_main-wrap` disabled. Read, never
  // written — this script does not own button state.
  var FLOW_DISABLED_ATTR = 'data-form-flow-disabled'
  var THEME_ATTR = 'data-button-theme'
  var DISABLED_THEME = 'disabled'

  // Values that belong to `-element`; seeing one as a state key means the two
  // attributes were swapped.
  var ELEMENT_ROLES = [BUTTON_ROLE, 'success-wrapper', 'success-item']

  /* ------------------------------ environment ------------------------------ */

  // Anchored on purpose (same shape as account-settings/plan-dates.js): a lookalike
  // such as "notwebflow.io" or "evil-trycloudflare.com" must not read as staging.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on in
  // production, but it must never widen what counts as a staging host.
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
   * repeat on every click, and a console repeating one line reads as a loop rather
   * than as one thing to fix.
   */
  function warnOnce(el, message) {
    if (!diagnosticsEnabled() || warned.has(el)) return
    warned.add(el)
    warn(message, el)
  }

  /* -------------------------------- elements -------------------------------- */

  /** Trimmed attribute value, or '' when absent — keys are always compared trimmed. */
  function keyAttr(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return ''
    var value = el.getAttribute(name)
    return value === null ? '' : String(value).trim()
  }

  /** The root an element belongs to: its nearest `[ms-form-cancel-state]` ancestor. */
  function nearestRoot(el) {
    if (!el || typeof el.closest !== 'function') return null
    return el.closest(ROOT_SEL)
  }

  /**
   * Matches for `selector` inside `scope` that this root owns. A match whose nearest
   * root is a DIFFERENT root is dropped — the whole defence against two forms, or a
   * nested pair, repainting each other.
   */
  function ownedIn(scope, root, selector) {
    var found = scope.querySelectorAll(selector)
    var out = []
    for (var i = 0; i < found.length; i++) {
      if (nearestRoot(found[i]) === root) out.push(found[i])
    }
    return out
  }

  /**
   * The success items this root owns, preferring the ones inside a tagged
   * `success-wrapper` and falling back to any owned item when the wrapper is missing
   * or empty — a forgotten wrapper should not silently kill the feature. Looked up
   * fresh on every paint, so late-rendered items need no re-init.
   */
  function itemsFor(root) {
    var wrappers = ownedIn(root, root, WRAPPER_SEL)
    var out = []
    for (var i = 0; i < wrappers.length; i++) {
      var inWrapper = ownedIn(wrappers[i], root, ITEM_SEL)
      for (var j = 0; j < inWrapper.length; j++) {
        if (out.indexOf(inWrapper[j]) === -1) out.push(inWrapper[j])
      }
    }
    return out.length ? out : ownedIn(root, root, ITEM_SEL)
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
   * The display an item is shown with. Resolved once, BEFORE anything is hidden, or
   * the inline `none` this script writes would be read back as the authored value
   * and the item could never come back. An item hidden in the Designer computes to
   * `none`, which is not a display anything can be restored to, so it falls back to
   * block.
   */
  function displayFor(el) {
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
   * root owns, and record the state on the root.
   *
   * A key with no item leaves the block empty and warns, because the contract is
   * that only the matching item shows. `ms-form-cancel-state-current` reports the
   * requested key either way.
   *
   * @returns {Element[]} the items left visible
   */
  function apply(root, key) {
    if (!root) return []

    var wanted = String(key === undefined || key === null ? '' : key).trim() || DEFAULT_KEY
    var items = itemsFor(root)

    root.setAttribute(CURRENT_ATTR, wanted)

    if (!items.length) {
      warnOnce(root, 'this root has no [' + ELEMENT_ATTR + '="success-item"]; nothing to switch')
      return []
    }

    var matched = withKey(items, wanted)
    if (!matched.length) {
      warn(
        'no success-item has ' + KEY_ATTR + '="' + wanted + '"; the success block will be empty',
        root
      )
    }

    for (var i = 0; i < items.length; i++) {
      if (matched.indexOf(items[i]) === -1) hide(items[i])
      else show(items[i])
    }

    return matched
  }

  function getState(root) {
    if (!root) return null
    var current = keyAttr(root, CURRENT_ATTR)
    return current || DEFAULT_KEY
  }

  function setState(root, key) {
    return apply(root, key)
  }

  /** First paint for a root. Idempotent — a second call is a no-op. */
  function init(root) {
    if (!root || root.getAttribute(INITED_ATTR) === 'true') return false
    root.setAttribute(INITED_ATTR, 'true')
    apply(root, DEFAULT_KEY)
    return true
  }

  /**
   * Re-scan the page: new roots get their first paint, roots already inited repaint
   * their current state. The repaint is what picks up success items rendered after
   * init, and what QA can call instead of faking a click.
   */
  function refresh() {
    var roots = document.querySelectorAll(ROOT_SEL)
    for (var i = 0; i < roots.length; i++) {
      if (roots[i].getAttribute(INITED_ATTR) === 'true') apply(roots[i], getState(roots[i]))
      else init(roots[i])
    }
    return roots.length
  }

  /* -------------------------------- controls -------------------------------- */

  /**
   * Whether a trigger is currently disabled by another system, checked from the
   * trigger up to its root and never past it — a disabled panel somewhere above the
   * root must not freeze the form.
   *
   * Webflow's button component is a WRAPPER (`.button_main-wrap`) around an overlaid
   * `<button class="clickable_btn">`, and step-flow.js / global-embeds/tabs/tabs.js
   * disable it by ATTRIBUTE on that wrapper, not by the native `disabled` property.
   * A gated Continue therefore still receives the click and is only
   * `preventDefault()`-ed, and this listener sees it first (capture phase). The
   * native property is checked too, for a trigger tagged on a real `<button>`.
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
   */
  function watchClicks() {
    document.addEventListener(
      'click',
      function (e) {
        var target = e && e.target
        if (!target || typeof target.closest !== 'function') return

        var trigger = target.closest(TRIGGER_SEL)
        if (!trigger) return

        var key = keyAttr(trigger, CHANGE_ATTR)
        if (!key) {
          warnOnce(trigger, CHANGE_ATTR + ' is empty on a clicked control; ignoring it')
          return
        }

        // Diagnosed before the role check below, because a swapped pair is the
        // likeliest reason `-element` is missing too, and it is the better message.
        if (ELEMENT_ROLES.indexOf(key) !== -1) {
          warnOnce(
            trigger,
            CHANGE_ATTR + '="' + key + '" is an ' + ELEMENT_ATTR + ' role, not a state key — the ' +
              'two attributes look swapped. Put the role on ' + ELEMENT_ATTR + ' and the key that ' +
              'matches ' + KEY_ATTR + ' (e.g. "pause") on ' + CHANGE_ATTR + '. Ignoring this click'
          )
          return
        }

        if (keyAttr(trigger, ELEMENT_ATTR) !== BUTTON_ROLE) {
          warnOnce(
            trigger,
            'a ' + CHANGE_ATTR + '="' + key + '" control is missing ' + ELEMENT_ATTR + '="' +
              BUTTON_ROLE + '"; a trigger needs both attributes. Ignoring this click'
          )
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
    // ms-form-cancel-state.test.js drift guard asserts they match.
    release: 'v1.59.91',
    stagingHost: stagingHost,
    diagnosticsEnabled: diagnosticsEnabled,
    get: getState,
    set: setState,
    refresh: refresh,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
