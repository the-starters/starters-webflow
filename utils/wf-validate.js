/*!
 * wf-validate — declarative form validation for Webflow
 * ------------------------------------------------------------------
 * Thin presentation layer over the browser's native Constraint Validation
 * API. The rules come from the attributes Webflow's Designer already sets
 * (`required`, `type`, `pattern`, `min`, `max`, `minlength`, `maxlength`);
 * this script only decides WHEN to validate and HOW to show the result —
 * styled error elements instead of the unstylable native bubbles.
 *
 * Grammar (Finsweet-style element/setting split, same dialect as wf-xano):
 *
 *   <form wf-validate-element="form">
 *     <input name="Email" type="email" required
 *            wf-validate-message-required="Please enter your email."
 *            wf-validate-message-type="That doesn't look like an email." />
 *     <div wf-validate-element="error">Fallback text (replaced at runtime)</div>
 *   </form>
 *
 * Roles (wf-validate-element="…"):
 *   form    — opt a <form> in (or a wrapper containing one). Native bubbles
 *             are suppressed via `novalidate`; the API stays available.
 *   error   — a Designer-styled error slot. Hidden on init, shown with the
 *             message while its field is invalid. Binds to the nearest field
 *             sharing an ancestor, or explicitly via wf-validate-for="<name>".
 *             When an invalid field has NO error slot, a plain unstyled one is
 *             auto-injected after it (class wf-validate_error-auto) so an
 *             opted-in form never blocks submission without visible feedback.
 *   message — optional child of an error element; the message text is written
 *             here instead, so the error can carry icons/decoration.
 *   success — a Designer-styled "this one is good" slot, the positive twin of an
 *             error. Binds the same way (nearest field or wf-validate-for).
 *             Hidden on init; shown only once the field has been touched AND is
 *             valid, so it never appears next to a visible error. The script
 *             never writes into it — whatever the Designer put there (checkmark,
 *             "Looks good!", an icon) is what shows.
 *   count   — live character counter ("1,234 / 2,500"). Binds like an error
 *             slot (nearest field or wf-validate-for). Max comes from the
 *             field's maxlength, or wf-validate-count-max on the counter
 *             (Finsweet has no char-count solution — their "inputcounter" is
 *             a number stepper — so this fills that gap in our grammar).
 *             The shown denominator is the limit: extra keystrokes are
 *             blocked and paste is truncated to the remaining room; over
 *             it (prefill / JS-set) the field is invalid and submit is
 *             gated, even when the field has no maxlength (or a higher
 *             one). The tighter of maxlength and count-max wins. The count
 *             slot is hidden while its field's error is showing.
 *             wf-validate-count-mode="words" switches it to a word counter
 *             ("312 / 500 words"); its max then comes from the field's
 *             wf-validate-maxwords, or wf-validate-count-max on the
 *             counter, and that bound caps input the same way.
 *   submit  — mark a clickable OUTSIDE the form (or a non-native div button)
 *             as the form's submitter, so its clicks are gated too. Native
 *             submit buttons inside a bound form don't need it: their clicks
 *             are gated automatically — page controllers that bind click on
 *             the button (the opp30 modal pattern) and call the API directly
 *             never fire while the form is invalid.
 *
 * Settings (on the same element as wf-validate-element="form" — the <form> or
 * its wrapper):
 *   wf-validate-submit-disable  — flag, with an optional value. While the form is
 *                                 incomplete, every submitter is SOFT-disabled:
 *                                 it gets the class is-wf-validate-disabled,
 *                                 aria-disabled="true", and a theme attribute set
 *                                 to "disabled". All three are removed once the
 *                                 form validates (a pre-existing theme value,
 *                                 e.g. "primary", is cached on the first
 *                                 overwrite and restored; if there was none, the
 *                                 attribute is removed).
 *                                 The value names the theme attribute when it
 *                                 starts with "data-", so button components that
 *                                 theme off their own attribute are wired up
 *                                 without CSS:
 *                                   wf-validate-submit-disable="data-button-theme"
 *                                     -> data-button-theme="disabled"
 *                                 Anything else — no value, "true" (Webflow's
 *                                 Designer wants a value), a typo — means the
 *                                 default data-theme, so every existing install
 *                                 keeps behaving exactly as before.
 *                                 Never the native `disabled` property: the
 *                                 button stays clickable and in tab order, so a
 *                                 click while incomplete still hits the gate and
 *                                 reveals every error at once. Submitters are
 *                                 re-collected on each state change (native
 *                                 submit buttons inside the form plus every
 *                                 wf-validate-element="submit" that resolves to
 *                                 it), so late-injected buttons are covered
 *                                 without a MutationObserver.
 *
 * Settings (on the input/select/textarea):
 *   wf-validate-message-<rule>  — per-rule message override. Rules: required,
 *                                 type, pattern, minlength, maxlength, min,
 *                                 max, step, match, minwords, maxwords.
 *   wf-validate-message         — catch-all override for any failure.
 *   wf-validate-match="<name>"  — field must equal the field named <name>
 *                                 (e.g. confirm-password).
 *   wf-validate-minwords / wf-validate-maxwords
 *                               — word-count bounds (whitespace-separated
 *                                 words). The native API has no word rules, so
 *                                 these are enforced here. A max (maxwords or
 *                                 a word-mode count-max) also blocks extra
 *                                 keystrokes and truncates paste, the same
 *                                 way maxlength stops character input; the
 *                                 error remains for values that arrived over
 *                                 the limit (prefill, JS set).
 *   (no override)               — falls back to the browser's own localized
 *                                 validationMessage.
 *
 * State classes (Finsweet-style, style them in Webflow — no CSS shipped):
 *   is-wf-validate-invalid  — on each invalid field, and on the form while it
 *                             has any invalid field.
 *   is-wf-validate-disabled — the canonical styling hook for a soft-disabled
 *                             submitter (opacity, cursor, pointer-events off if
 *                             you insist). The theme attribute ("disabled" on
 *                             data-theme, or on whatever the opt-in's value
 *                             named) is written alongside it purely as bonus
 *                             wiring for projects whose button components already
 *                             theme off an attribute; style the class, not the
 *                             attribute.
 *
 * Behavior ("reward early, punish late"):
 *   - a field first shows its error when the user leaves it (focusout)
 *   - once marked invalid it re-validates on every input, so the error
 *     clears the moment the value becomes valid
 *   - submit validates everything; if anything fails the submit is blocked
 *     at document capture (before Webflow's handler or page controllers like
 *     opportunities---create.js ever see it, regardless of script load
 *     order) and the first invalid field is focused without a scroll jump, then
 *     scrolled to the middle of the viewport — smoothly, or instantly when the
 *     visitor asked for prefers-reduced-motion
 *   - fields that are not rendered (display:none step/variant inputs) are
 *     skipped, so per-project-type inputs don't block submit invisibly
 *   - resetting the form wipes the validation state with it: every group goes
 *     back to untouched and unpainted, and the form's invalid class is dropped.
 *     Counters and the submit-disable state are recomputed on the next tick,
 *     because a `reset` event fires BEFORE the browser reverts the values
 *   - submit-disable state is recomputed silently (no painting, nothing marked
 *     touched) at bind time, on every input/change/focusin/focusout, inside
 *     every validateAll (so both gates and the API refresh it), after a reset,
 *     and when a <dialog> (or popover) containing the form opens. That last one
 *     matters: a form bound while its dialog was closed measured every field as
 *     unrendered, so it counted as complete and its submitter was left looking
 *     enabled — and opening a dialog fires no input/change/focusout, so the
 *     stale look survived until the first interaction. The `toggle` event is the
 *     moment those measurements become real, so the state (and the counters,
 *     computed from the same hidden fields) is recomputed there
 *   - remaining stale-look limitation: a form revealed by programmatic
 *     show/hide that is neither a dialog/popover toggle nor accompanied by an
 *     event (a tab or wizard step swapped by a class change) still shows a stale
 *     submitter until the first focusin, input or click — each of which
 *     self-heals it. The GATE is never stale: it recomputes on every attempt
 *
 * Accessibility: error slots get role="alert"; fields get aria-invalid and
 * aria-describedby pointing at their error slot.
 *
 * API: window.WfValidate = { init(scope?), refresh(form), validate(form) }
 *   init     — scan for unbound wf-validate-element="form" (call again after
 *              injecting forms dynamically; already-bound forms are skipped)
 *   refresh  — add fields injected into an already-bound form without
 *              duplicating the form listeners or resetting touched state
 *   validate — programmatically validate a bound form; returns boolean
 *
 * Client-side validation is UX only — server endpoints must still validate.
 * ------------------------------------------------------------------
 */
;(function () {
  'use strict'

  if (window.WfValidate) return

  /** ValidityState flag -> wf-validate-message-<suffix> attribute suffix. @type {Record<string, string>} */
  const VALIDITY_RULE = {
    valueMissing: 'required',
    typeMismatch: 'type',
    badInput: 'type',
    patternMismatch: 'pattern',
    tooShort: 'minlength',
    tooLong: 'maxlength',
    rangeUnderflow: 'min',
    rangeOverflow: 'max',
    stepMismatch: 'step',
  }

  const INVALID_CLASS = 'is-wf-validate-invalid'
  const DISABLED_CLASS = 'is-wf-validate-disabled'
  const SUBMIT_DISABLE_ATTR = 'wf-validate-submit-disable'
  const DEFAULT_THEME_ATTR = 'data-theme'
  const FIELD_SELECTOR = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
  const NATIVE_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"], button:not([type])'
  const MARKED_SUBMIT_SELECTOR = '[wf-validate-element="submit"]'

  let uid = 0

  /** Fields that already have beforeinput/paste caps, so refresh never doubles them. */
  const capped = new WeakSet()

  /**
   * beforeinput types that shrink or replace the value, or that the paste
   * handler owns. Never block these — blocking Backspace at the limit would
   * trap the user over it.
   * @type {Record<string, number>}
   */
  const ALLOWED_INPUT = {
    deleteContentBackward: 1,
    deleteContentForward: 1,
    deleteByCut: 1,
    insertFromPaste: 1,
    historyUndo: 1,
    historyRedo: 1,
  }

  /**
   * Pre-existing theme values, remembered the first time we overwrite one with
   * "disabled" so re-enabling can put the original back (a designer's
   * data-theme="primary" must survive a round-trip through the disabled state).
   * The attribute name is cached with the value: two forms on one page may name
   * different theme attributes, and restore must never write to the other one.
   * A null `prev` means "the attribute wasn't there" -> remove it on restore.
   * @type {WeakMap<Element, {attr: string, prev: string | null}>}
   */
  const themeCache = new WeakMap()

  /**
   * Which attribute receives "disabled" while the form is incomplete. The opt-in's
   * value names it when the value looks like a data attribute, so a project whose
   * buttons theme off data-button-theme gets the disabled look for free:
   *
   *   wf-validate-submit-disable="data-button-theme"  ->  data-button-theme
   *
   * Every other value falls back to data-theme — no value, the "true" Webflow's
   * Designer nudges you into, or a typo. That fallback is what keeps installs
   * shipped before this was configurable behaving identically.
   * @param {Element} root  the element carrying the opt-in
   * @returns {string}
   */
  const themeAttrFor = (root) => {
    const value = (root.getAttribute(SUBMIT_DISABLE_ATTR) || '').trim()
    return value.indexOf('data-') === 0 ? value : DEFAULT_THEME_ATTR
  }

  /**
   * A field is skipped when the browser wouldn't validate it (disabled,
   * readonly…) or when it isn't rendered — Webflow variant/step inputs are
   * usually display:none, and a hidden required field must not block submit.
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} el
   * @returns {boolean}
   */
  const isActive = (el) => el.willValidate && el.getClientRects().length > 0

  /**
   * @typedef {Object} FieldGroup
   * @property {string} name
   * @property {(HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]} els  same-name controls (radio/checkbox sets)
   * @property {HTMLElement | null} error  bound error slot
   * @property {HTMLElement | null} messageEl  inner message target within the error slot
   * @property {HTMLElement | null} count  bound character-counter slot
   * @property {HTMLElement | null} success  bound success slot (shown while touched + valid)
   * @property {number | null} countMax  counter denominator (maxlength / maxwords / wf-validate-count-max)
   * @property {boolean} countWords  counter counts words instead of characters
   * @property {boolean} touched  whether errors may be shown yet
   */

  /**
   * The tighter of a native/attr bound and a counter denominator. Either
   * side may be missing (NaN); a missing side is ignored.
   * @param {string} attrValue
   * @param {number | null | undefined} countMax
   * @returns {number} NaN when neither side is a positive bound
   */
  const tighterMax = (attrValue, countMax) => {
    const fromAttr = parseInt(attrValue || '', 10)
    const candidates = []
    if (fromAttr > 0) candidates.push(fromAttr)
    if (countMax > 0) candidates.push(countMax)
    if (!candidates.length) return NaN
    return Math.min.apply(null, candidates)
  }

  /**
   * Min/maxlength enforced manually: the native tooShort/tooLong flags only
   * fire for user-typed ("dirty") values, so JS-set values (autofill, draft
   * restore, tooling) would silently bypass them. `countMax` is the counter
   * denominator (wf-validate-count-max, or maxlength copied onto the group);
   * when it is set, it is a real limit, not display-only.
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} el
   * @param {number | null | undefined} [countMax]
   * @returns {string} empty string when within bounds
   */
  const lengthMessage = (el, countMax) => {
    const len = el.value.length
    const min = parseInt(el.getAttribute('minlength') || '', 10)
    if (min > 0 && len > 0 && len < min) {
      return (
        el.getAttribute('wf-validate-message-minlength') ||
        el.getAttribute('wf-validate-message') ||
        'Please use at least ' + min + ' characters (you are currently using ' + len + ').'
      )
    }
    const max = tighterMax(el.getAttribute('maxlength'), countMax)
    if (max > 0 && len > max) {
      return (
        el.getAttribute('wf-validate-message-maxlength') ||
        el.getAttribute('wf-validate-message') ||
        'Please use no more than ' + max + ' characters (you are currently using ' + len + ').'
      )
    }
    return ''
  }

  /**
   * Whitespace-separated word count; empty/blank values count as 0 words.
   * @param {string} value
   * @returns {number}
   */
  const wordCount = (value) => {
    const trimmed = value.trim()
    return trimmed ? trimmed.split(/\s+/).length : 0
  }

  /**
   * Word-count bounds (wf-validate-minwords / wf-validate-maxwords). The
   * Constraint Validation API has no word rules, so these are enforced here,
   * mirroring lengthMessage. `countMax` is the word-mode counter denominator.
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} el
   * @param {number | null | undefined} [countMax]
   * @returns {string} empty string when within bounds
   */
  const wordMessage = (el, countMax) => {
    const words = wordCount(el.value)
    const min = parseInt(el.getAttribute('wf-validate-minwords') || '', 10)
    if (min > 0 && words > 0 && words < min) {
      return (
        el.getAttribute('wf-validate-message-minwords') ||
        el.getAttribute('wf-validate-message') ||
        'Please use at least ' + min + ' words (you are currently using ' + words + ').'
      )
    }
    const max = tighterMax(el.getAttribute('wf-validate-maxwords'), countMax)
    if (max > 0 && words > max) {
      return (
        el.getAttribute('wf-validate-message-maxwords') ||
        el.getAttribute('wf-validate-message') ||
        'Please use no more than ' + max + ' words (you are currently using ' + words + ').'
      )
    }
    return ''
  }

  /**
   * Resolve the message for a failed control: per-rule override on the
   * control, then its catch-all override, then the browser's own text.
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} el
   * @param {FieldGroup} [group]  supplies countMax so a counter denominator gates
   * @returns {string} empty string when the control is valid
   */
  const messageFor = (el, group) => {
    const charMax = group && !group.countWords ? group.countMax : null
    const wordMax = group && group.countWords ? group.countMax : null
    const lengthMsg = lengthMessage(el, charMax)
    if (lengthMsg) return lengthMsg
    const wordMsg = wordMessage(el, wordMax)
    if (wordMsg) return wordMsg
    const v = el.validity
    if (v.valid) return ''
    for (const flag in VALIDITY_RULE) {
      if (v[flag]) {
        return (
          el.getAttribute('wf-validate-message-' + VALIDITY_RULE[flag]) ||
          el.getAttribute('wf-validate-message') ||
          el.validationMessage
        )
      }
    }
    // customError (e.g. the match rule) — setCustomValidity supplied the text.
    return el.validationMessage
  }

  /**
   * Apply the wf-validate-match rule: the control must equal the value of the
   * form field named by the attribute. Uses setCustomValidity so the result
   * flows through the same ValidityState pipeline as native rules.
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} el
   * @param {HTMLFormElement} form
   * @returns {void}
   */
  const applyMatch = (el, form) => {
    const otherName = el.getAttribute('wf-validate-match')
    if (!otherName) return
    const other = form.querySelector('[name="' + otherName + '"]')
    const mismatch = other && el.value !== /** @type {{value: string}} */ (other).value
    el.setCustomValidity(
      mismatch
        ? el.getAttribute('wf-validate-message-match') || el.getAttribute('wf-validate-message') || 'Values do not match.'
        : '',
    )
  }

  /**
   * The form a submitter belongs to: its own ancestor <form> when it has one,
   * otherwise the first accepted form inside one of its ancestors — marked
   * submitters legitimately sit outside the form (modal footers), so we walk up
   * wrappers until one contains a form the caller accepts.
   * @param {Element} el
   * @param {(form: HTMLFormElement) => boolean} accept
   * @returns {HTMLFormElement | null}
   */
  const submitterForm = (el, accept) => {
    const inside = /** @type {HTMLFormElement | null} */ (el.closest('form'))
    if (inside) return inside
    let scope = el.parentElement
    while (scope) {
      const candidate = /** @type {HTMLFormElement | null} */ (scope.querySelector('form'))
      if (candidate && accept(candidate)) return candidate
      scope = scope.parentElement
    }
    return null
  }

  /**
   * The group's failure message, computed with NO side effects on presentation:
   * nothing is painted and `touched` is never mutated. Both the painting path
   * (validateGroup) and the silent completeness check (isComplete, which drives
   * the submit-disable state) go through here, so the rule logic exists once.
   * @param {FieldGroup} group
   * @param {HTMLFormElement} form
   * @returns {string} empty string when the group is valid
   */
  const groupMessage = (group, form) => {
    let msg = ''
    group.els.forEach((el) => {
      if (!isActive(el)) return
      applyMatch(el, form)
      if (!msg) msg = messageFor(el, group)
    })
    return msg
  }

  /**
   * Per-form controller: builds name-keyed field groups, binds their error
   * slots, and wires focusout/input/submit.
   */
  class FormValidator {
    /**
     * @param {HTMLFormElement} form
     * @param {Element} [root]  the opted-in element (the form, or the wrapper
     *   that carries wf-validate-element="form"); form-level settings live here
     */
    constructor(form, root) {
      this.form = form
      form.noValidate = true

      /** whether submitters are soft-disabled while the form is incomplete */
      this.submitDisable = (root || form).hasAttribute(SUBMIT_DISABLE_ATTR)

      /** the attribute set to "disabled" on soft-disabled submitters; resolved once */
      this.themeAttr = themeAttrFor(root || form)

      /** @type {Map<string, FieldGroup>} */
      this.groups = new Map()
      Array.from(form.querySelectorAll(FIELD_SELECTOR)).forEach((el) => {
        const name = el.getAttribute('name')
        if (!name) return
        let group = this.groups.get(name)
        if (!group) {
          group = {
            name,
            els: [],
            error: null,
            messageEl: null,
            success: null,
            count: null,
            countMax: null,
            countWords: false,
            touched: false,
          }
          this.groups.set(name, group)
        }
        group.els.push(/** @type {HTMLInputElement} */ (el))
      })

      Array.from(form.querySelectorAll('[wf-validate-element="error"]')).forEach((error) => {
        const group = this.resolveTarget(/** @type {HTMLElement} */ (error))
        if (!group) return
        this.adoptError(group, /** @type {HTMLElement} */ (error))
      })

      Array.from(form.querySelectorAll('[wf-validate-element="success"]')).forEach((success) => {
        const group = this.resolveTarget(/** @type {HTMLElement} */ (success))
        if (!group) return
        group.success = /** @type {HTMLElement} */ (success)
        // no role: a success slot is not an alert, and its content is the
        // Designer's (we only toggle visibility)
        group.success.style.display = 'none'
      })

      Array.from(form.querySelectorAll('[wf-validate-element="count"]')).forEach((count) => {
        const group = this.resolveTarget(/** @type {HTMLElement} */ (count))
        if (!group) return
        group.count = /** @type {HTMLElement} */ (count)
        group.countWords = count.getAttribute('wf-validate-count-mode') === 'words'
        const max = parseInt(
          count.getAttribute('wf-validate-count-max') ||
            group.els[0].getAttribute(group.countWords ? 'wf-validate-maxwords' : 'maxlength') ||
            '',
          10,
        )
        group.countMax = isNaN(max) ? null : max
        this.updateCount(group)
      })

      this.groups.forEach((group) => this.bindLimit(group))

      form.addEventListener('focusout', (e) => this.onLeave(e))
      form.addEventListener('input', (e) => this.onInput(e))
      form.addEventListener('change', (e) => this.onInput(e))
      form.addEventListener('reset', () => this.onReset())
      // cheap, silent backstop for reveal patterns that fire no other event
      // (tabs, wizard steps, a class-swapped panel): the instant the user enters
      // any field, the fields are certainly rendered, so re-measure completeness.
      // Nothing is painted and nothing is marked touched, so it can't punish early
      form.addEventListener('focusin', () => this.applySubmitState())
      // submit interception happens at document capture (see below), so it
      // wins regardless of what order page controllers were bound in

      // an empty required form is incomplete from the start, so paint the
      // submitters disabled before the user touches anything
      this.applySubmitState()
    }

    /**
     * Add fields injected after the form was bound. Existing groups and their
     * touched/painted state are preserved; only genuinely new controls are
     * appended. Error slots for those controls remain lazy like every other
     * auto-injected error.
     * @returns {void}
     */
    refresh() {
      Array.from(this.form.querySelectorAll(FIELD_SELECTOR)).forEach((el) => {
        const name = el.getAttribute('name')
        if (!name) return
        let group = this.groups.get(name)
        if (!group) {
          group = {
            name,
            els: [],
            error: null,
            messageEl: null,
            success: null,
            count: null,
            countMax: null,
            countWords: false,
            touched: false,
          }
          this.groups.set(name, group)
        }
        if (!group.els.includes(el)) group.els.push(/** @type {HTMLInputElement} */ (el))
      })
      this.groups.forEach((group) => this.bindLimit(group))
      this.applySubmitState()
    }

    /**
     * Bind an error/count slot to a field group: wf-validate-for="<name>"
     * wins; otherwise walk up until an ancestor (below the form) contains a
     * field.
     * @param {HTMLElement} slot
     * @returns {FieldGroup | undefined}
     */
    resolveTarget(slot) {
      const explicit = slot.getAttribute('wf-validate-for')
      if (explicit) return this.groups.get(explicit)
      let scope = slot.parentElement
      while (scope && scope !== this.form.parentElement) {
        const field = scope.querySelector(FIELD_SELECTOR)
        if (field && field.getAttribute('name')) return this.groups.get(field.getAttribute('name') || '')
        scope = scope.parentElement
      }
      return undefined
    }

    /**
     * Wire an error slot to its group: hide it, set a11y attributes, link the
     * group's controls to it.
     * @param {FieldGroup} group
     * @param {HTMLElement} error
     * @returns {void}
     */
    adoptError(group, error) {
      group.error = error
      group.messageEl = error.querySelector('[wf-validate-element="message"]')
      error.style.display = 'none'
      error.setAttribute('role', 'alert')
      if (!error.id) error.id = 'wf-validate-error-' + ++uid
      group.els.forEach((el) => el.setAttribute('aria-describedby', error.id))
    }

    /**
     * Fallback for invalid groups with no Designer-placed error slot: inject
     * a plain one after the field (after its wrapping label, if any), so the
     * blocked submit is never invisible to the user. Designers can style it
     * via the wf-validate_error-auto class — or add a real slot to replace it.
     * @param {FieldGroup} group
     * @returns {void}
     */
    ensureError(group) {
      if (group.error) return
      const anchor = group.els[group.els.length - 1]
      const error = document.createElement('div')
      error.setAttribute('wf-validate-element', 'error')
      error.className = 'wf-validate_error-auto'
      ;(anchor.closest('label') || anchor).insertAdjacentElement('afterend', error)
      this.adoptError(group, error)
    }

    /**
     * Render "n / max" (or just "n" without a max) into the count slot; word
     * mode appends the unit ("312 / 500 words") since it's less self-evident
     * than a character count.
     * @param {FieldGroup} group
     * @returns {void}
     */
    updateCount(group) {
      if (!group.count) return
      const n = group.countWords ? wordCount(group.els[0].value) : group.els[0].value.length
      group.count.textContent =
        n.toLocaleString('en-US') +
        (group.countMax ? ' / ' + group.countMax.toLocaleString('en-US') : '') +
        (group.countWords ? ' words' : '')
    }

    /**
     * Validate one group and, when showable, paint its state.
     * @param {FieldGroup} group
     * @param {boolean} [show]  force-show even if the group is untouched (submit)
     * @returns {boolean} whether the group is valid
     */
    validateGroup(group, show) {
      const msg = groupMessage(group, this.form)
      if (show) group.touched = true
      if (group.touched) this.paint(group, msg)
      return !msg
    }

    /**
     * Silent whole-form check: same rules as validateGroup, but it paints
     * nothing and marks nothing touched — this is what decides whether the
     * submitters are soft-disabled, and it runs long before the user has earned
     * any error messages.
     *
     * Silent means silent to the USER, not side-effect free: the shared rule
     * pass runs applyMatch, so wf-validate-match fields get setCustomValidity
     * (and therefore native :invalid) from bind time onward. Style the shipped
     * is-wf-validate-invalid class rather than :invalid to avoid pre-touch paint.
     * @returns {boolean} whether every group currently passes
     */
    isComplete() {
      let complete = true
      this.groups.forEach((group) => {
        if (groupMessage(group, this.form)) complete = false
      })
      return complete
    }

    /**
     * Everything that can submit this form: native submit buttons inside it,
     * plus every wf-validate-element="submit" in the document that resolves to
     * it (those may live outside the form). Queried fresh on every call — never
     * cached — so buttons injected after bind are handled without an observer.
     * @returns {Element[]}
     */
    submitters() {
      /** @type {Set<Element>} */
      const found = new Set()
      Array.from(this.form.querySelectorAll(NATIVE_SUBMIT_SELECTOR)).forEach((el) => found.add(el))
      Array.from(document.querySelectorAll(MARKED_SUBMIT_SELECTOR)).forEach((el) => {
        // `this.form` is accepted explicitly: at bind time it isn't in `bound` yet
        const form = submitterForm(el, (candidate) => candidate === this.form || bound.has(candidate))
        if (form === this.form) found.add(el)
      })
      return Array.from(found)
    }

    /**
     * Soft-disable (or re-enable) the submitters. Soft on purpose: no native
     * `disabled`, so the button keeps its click and its place in the tab order
     * and a determined click still runs the gate that reveals every error.
     * @returns {void}
     */
    applySubmitState() {
      if (!this.submitDisable) return
      const blocked = !this.isComplete()
      this.submitters().forEach((el) => {
        if (blocked) {
          el.classList.add(DISABLED_CLASS)
          el.setAttribute('aria-disabled', 'true')
          if (!themeCache.has(el)) {
            themeCache.set(el, { attr: this.themeAttr, prev: el.getAttribute(this.themeAttr) })
          }
          el.setAttribute(this.themeAttr, 'disabled')
          return
        }
        el.classList.remove(DISABLED_CLASS)
        el.removeAttribute('aria-disabled')
        // only touch the theme attribute if WE overwrote it, and only the one we
        // actually overwrote: restore its cached value, or remove the attribute
        // when there was nothing there before
        const cached = themeCache.get(el)
        if (cached) {
          if (typeof cached.prev === 'string') el.setAttribute(cached.attr, cached.prev)
          else el.removeAttribute(cached.attr)
          themeCache.delete(el)
        }
      })
    }

    /**
     * Toggle classes, aria state, and the error/success slots for a group. The
     * two slots are mutually exclusive by construction: success shows only for a
     * touched, valid group — exactly when the error is hidden.
     * @param {FieldGroup} group
     * @param {string} msg  empty string when valid
     * @returns {void}
     */
    paint(group, msg) {
      if (msg) this.ensureError(group)
      group.els.forEach((el) => {
        el.classList.toggle(INVALID_CLASS, !!msg)
        el.setAttribute('aria-invalid', msg ? 'true' : 'false')
      })
      if (group.error) {
        ;(group.messageEl || group.error).textContent = msg || ''
        group.error.style.display = msg ? '' : 'none'
      }
      if (group.count) group.count.style.display = msg ? 'none' : ''
      if (group.success) group.success.style.display = !msg && group.touched ? '' : 'none'
    }

    /**
     * @param {Event} e
     * @returns {FieldGroup | undefined}
     */
    groupFor(e) {
      const el = /** @type {HTMLElement} */ (e.target)
      const name = el.getAttribute && el.getAttribute('name')
      return name ? this.groups.get(name) : undefined
    }

    /**
     * Character and word ceilings that cap typing for this group. Count-max
     * only participates in the mode the counter is in, so a word counter's
     * 500 does not also become a 500-character maxlength.
     * @param {FieldGroup} group
     * @returns {{charMax: number, wordMax: number, active: boolean}}
     */
    limitOf(group) {
      const el = group.els[0]
      if (!el) return { charMax: NaN, wordMax: NaN, active: false }
      const charMax = tighterMax(el.getAttribute('maxlength'), group.countWords ? null : group.countMax)
      const wordMax = tighterMax(
        el.getAttribute('wf-validate-maxwords'),
        group.countWords ? group.countMax : null,
      )
      return { charMax, wordMax, active: charMax > 0 || wordMax > 0 }
    }

    /**
     * @param {FieldGroup} group
     * @param {string} value
     * @returns {boolean}
     */
    exceeds(group, value) {
      const { charMax, wordMax } = this.limitOf(group)
      if (charMax > 0 && value.length > charMax) return true
      if (wordMax > 0 && wordCount(value) > wordMax) return true
      return false
    }

    /**
     * @param {HTMLInputElement | HTMLTextAreaElement} el
     * @param {string} inserted
     * @returns {string}
     */
    nextValue(el, inserted) {
      const start = el.selectionStart == null ? el.value.length : el.selectionStart
      const end = el.selectionEnd == null ? start : el.selectionEnd
      return el.value.slice(0, start) + inserted + el.value.slice(end)
    }

    /**
     * Attach beforeinput/paste caps once per field when the group has a max.
     * @param {FieldGroup} group
     * @returns {void}
     */
    bindLimit(group) {
      if (!this.limitOf(group).active) return
      group.els.forEach((el) => {
        if (capped.has(el)) return
        capped.add(el)
        el.addEventListener('beforeinput', (e) => this.onBeforeInput(group, /** @type {HTMLInputElement} */ (el), e))
        el.addEventListener('paste', (e) => this.onPaste(group, /** @type {HTMLInputElement} */ (el), e))
      })
    }

    /**
     * Block keystrokes that would push the field over its character or word max.
     * @param {FieldGroup} group
     * @param {HTMLInputElement | HTMLTextAreaElement} el
     * @param {InputEvent} e
     * @returns {void}
     */
    onBeforeInput(group, el, e) {
      if (ALLOWED_INPUT[e.inputType]) return
      let inserted = e.data || ''
      if (!inserted && e.inputType === 'insertLineBreak') inserted = '\n'
      if (!inserted && e.inputType !== 'insertText') return
      if (this.exceeds(group, this.nextValue(el, inserted))) e.preventDefault()
    }

    /**
     * Truncate a paste to the remaining character and/or word room.
     * @param {FieldGroup} group
     * @param {HTMLInputElement | HTMLTextAreaElement} el
     * @param {ClipboardEvent} e
     * @returns {void}
     */
    onPaste(group, el, e) {
      const clip = e.clipboardData
      if (!clip || typeof clip.getData !== 'function') return
      const text = clip.getData('text')
      if (text == null) return
      e.preventDefault()
      const start = el.selectionStart == null ? el.value.length : el.selectionStart
      const end = el.selectionEnd == null ? start : el.selectionEnd
      const before = el.value.slice(0, start)
      const after = el.value.slice(end)
      const { charMax, wordMax } = this.limitOf(group)
      let insert = text
      if (wordMax > 0) {
        const available = wordMax - wordCount(before) - wordCount(after)
        if (available <= 0) insert = ''
        else {
          const words = insert.trim() ? insert.trim().split(/\s+/).filter(Boolean) : []
          insert = words.slice(0, available).join(' ')
        }
      }
      if (charMax > 0) {
        const available = charMax - before.length - after.length
        if (available <= 0) insert = ''
        else insert = insert.slice(0, available)
      }
      if (!insert) return
      el.value = before + insert + after
      if (typeof el.setSelectionRange === 'function') {
        const pos = before.length + insert.length
        el.setSelectionRange(pos, pos)
      }
      this.onInput({ target: el })
    }

    /** Field blurred: first moment an error may appear. @param {Event} e @returns {void} */
    onLeave(e) {
      const group = this.groupFor(e)
      if (group) this.validateGroup(group, true)
      this.applySubmitState()
    }

    /** Live counter update always; re-validation once a group has been marked. @param {Event} e @returns {void} */
    onInput(e) {
      const group = this.groupFor(e)
      if (!group) return
      this.updateCount(group)
      if (group.touched) this.validateGroup(group)
      this.applySubmitState()
    }

    /**
     * Form reset: drop the whole validation state so the user starts clean.
     * The unpainting is synchronous, but counters and the submit-disable state
     * must wait a tick — a `reset` event fires BEFORE the browser reverts the
     * control values, so computing them now would read the pre-reset input.
     * @returns {void}
     */
    onReset() {
      this.groups.forEach((group) => {
        group.touched = false
        this.paint(group, '')
      })
      this.form.classList.remove(INVALID_CLASS)
      setTimeout(() => {
        this.groups.forEach((group) => this.updateCount(group))
        this.applySubmitState()
      }, 0)
    }

    /**
     * The form just became visible (its <dialog>/popover opened). Everything
     * measured while it was hidden was measured wrong: isActive() reads
     * getClientRects(), which is empty for display:none fields, so every field
     * was skipped and the form looked complete. Re-measure now that layout is
     * real — the submit state, and the counters that were rendered from the same
     * hidden fields. Silent, like every other recompute: no painting, nothing
     * marked touched, so a freshly opened form never greets the user with errors.
     * @returns {void}
     */
    onReveal() {
      this.groups.forEach((group) => this.updateCount(group))
      this.applySubmitState()
    }

    /** @returns {boolean} whether the whole form is valid */
    validateAll() {
      let valid = true
      this.groups.forEach((group) => {
        if (!this.validateGroup(group, true)) valid = false
      })
      this.form.classList.toggle(INVALID_CLASS, !valid)
      this.applySubmitState()
      return valid
    }
  }

  /** form element -> validator, so re-init never double-binds. @type {WeakMap<HTMLFormElement, FormValidator>} */
  const bound = new WeakMap()

  /**
   * Shared invalid-gate: validate, and on failure kill the event before any
   * other listener sees it, then bring the first invalid field to the user.
   * Focus first with preventScroll (the browser's own focus scroll is instant
   * and lands the field wherever it likes), then scroll it to the middle of the
   * viewport ourselves — the field is usually below a long form, and centering
   * it keeps its label and error slot in view. Instant for anyone who asked for
   * reduced motion.
   * @param {FormValidator} validator
   * @param {Event} e
   * @returns {void}
   */
  const gateEvent = (validator, e) => {
    if (validator.validateAll()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const firstInvalid = /** @type {HTMLElement | null} */ (validator.form.querySelector('.' + INVALID_CLASS))
    if (!firstInvalid) return
    firstInvalid.focus({ preventScroll: true })
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    firstInvalid.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
  }

  /**
   * Submit gate. Capture phase on document runs BEFORE any listener on the
   * form itself (capture travels document -> form), so invalid submits are
   * blocked no matter when Webflow's handler or page controllers were bound —
   * including scripts injected async via loadEnvScript, where order varies.
   */
  document.addEventListener(
    'submit',
    (e) => {
      const validator = bound.get(/** @type {HTMLFormElement} */ (e.target))
      if (validator) gateEvent(validator, e)
    },
    true,
  )

  /**
   * Click gate. Page controllers often bind click on the submit button and
   * call the API directly (the opp30 modal pattern) — that path never fires
   * a submit event, so it must be gated at the click. Covers native submit
   * buttons inside a bound form, plus wf-validate-element="submit" markers
   * for buttons outside the form or non-native (div) buttons.
   */
  document.addEventListener(
    'click',
    (e) => {
      const origin = e.target instanceof Element ? e.target : null
      if (!origin) return
      const marked = origin.closest(MARKED_SUBMIT_SELECTOR)
      const el = marked || origin.closest(NATIVE_SUBMIT_SELECTOR)
      if (!el) return
      // marked submitters may sit outside the form (modal footers), so those get
      // the walk-up resolution; native buttons are always inside theirs
      const form = marked
        ? submitterForm(marked, (candidate) => bound.has(candidate))
        : /** @type {HTMLFormElement | null} */ (el.closest('form'))
      const validator = form && bound.get(form)
      if (validator) gateEvent(validator, e)
    },
    true,
  )

  /**
   * Dialog / popover open. A form bound inside a closed <dialog> was measured
   * while display:none, so every field was skipped as unrendered and the form
   * computed as complete — leaving the submitter looking enabled on a form that
   * is actually empty. Opening a dialog fires no input/change/focusout, so that
   * stale look used to survive until the first interaction.
   *
   * ToggleEvent does NOT bubble, so this listens at document with capture (the
   * only phase that reaches a non-bubbling event on a descendant). Popovers and
   * <details> fire the same event and get the same treatment for free — a form
   * inside a collapsed <details> was measured while hidden in exactly the same
   * way, so recomputing when it expands is right, not incidental. Recompute is
   * synchronous: `toggle` is already dispatched in a task queued AFTER the open
   * state was applied, and getClientRects() forces layout on demand, so the
   * measurements are real here — while deferring to setTimeout(0) (the trick
   * onReset needs, because `reset` genuinely fires before values revert) would
   * hand the browser a chance to paint one frame of the wrong, enabled-looking
   * button. Browsers with no dialog ToggleEvent simply never fire this and fall
   * back to the previous behavior: the gate still blocks, and the look self-heals
   * on the first focusin/input/click.
   */
  document.addEventListener(
    'toggle',
    (e) => {
      // older ToggleEvent shapes carry no newState — treat anything but an
      // explicit "open" as not-open, so a close never triggers work
      if (/** @type {{newState?: string}} */ (e).newState !== 'open') return
      const host = e.target instanceof Element ? e.target : null
      if (!host) return
      // `bound` is a WeakMap (not enumerable), so walk the revealed subtree and
      // ask it about each form found — including the host itself
      const forms = Array.from(host.querySelectorAll('form'))
      if (host.tagName === 'FORM') forms.unshift(/** @type {HTMLFormElement} */ (host))
      forms.forEach((form) => {
        const validator = bound.get(form)
        if (validator) validator.onReveal()
      })
    },
    true,
  )

  /**
   * Scan a scope for opted-in forms and bind any that aren't bound yet.
   * wf-validate-element="form" may sit on the <form> or a wrapper around it —
   * that element is handed to the validator as its settings root (it's where
   * form-level settings like wf-validate-submit-disable live).
   * @param {ParentNode} [scope]
   * @returns {void}
   */
  const init = (scope) => {
    Array.from((scope || document).querySelectorAll('[wf-validate-element="form"]')).forEach((el) => {
      const form = /** @type {HTMLFormElement | null} */ (el.tagName === 'FORM' ? el : el.querySelector('form'))
      if (!form || bound.has(form)) return
      bound.set(form, new FormValidator(form, el))
    })
  }

  window.WfValidate = {
    init,
    /**
     * Register controls injected into a form after its initial bind.
     * @param {HTMLFormElement} form
     * @returns {void}
     */
    refresh: (form) => {
      const v = bound.get(form)
      if (v) v.refresh()
    },
    /**
     * Programmatically validate a bound form (shows all errors).
     * @param {HTMLFormElement} form
     * @returns {boolean} true when valid; also true for unbound forms (no-op)
     */
    validate: (form) => {
      const v = bound.get(form)
      return v ? v.validateAll() : true
    },
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init())
  } else {
    init()
  }
})()
