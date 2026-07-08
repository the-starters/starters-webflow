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
 *   message — optional child of an error element; the message text is written
 *             here instead, so the error can carry icons/decoration.
 *
 * Settings (on the input/select/textarea):
 *   wf-validate-message-<rule>  — per-rule message override. Rules: required,
 *                                 type, pattern, minlength, maxlength, min,
 *                                 max, step, match.
 *   wf-validate-message         — catch-all override for any failure.
 *   wf-validate-match="<name>"  — field must equal the field named <name>
 *                                 (e.g. confirm-password).
 *   (no override)               — falls back to the browser's own localized
 *                                 validationMessage.
 *
 * State classes (Finsweet-style, style them in Webflow — no CSS shipped):
 *   is-wf-validate-invalid — on each invalid field, and on the form while it
 *                            has any invalid field.
 *
 * Behavior ("reward early, punish late"):
 *   - a field first shows its error when the user leaves it (focusout)
 *   - once marked invalid it re-validates on every input, so the error
 *     clears the moment the value becomes valid
 *   - submit validates everything; if anything fails the submit is blocked
 *     at document capture (before Webflow's handler or page controllers like
 *     opportunities---create.js ever see it, regardless of script load
 *     order) and the first invalid field gets focus
 *   - fields that are not rendered (display:none step/variant inputs) are
 *     skipped, so per-project-type inputs don't block submit invisibly
 *
 * Accessibility: error slots get role="alert"; fields get aria-invalid and
 * aria-describedby pointing at their error slot.
 *
 * API: window.WfValidate = { init(scope?), validate(form) }
 *   init     — scan for unbound wf-validate-element="form" (call again after
 *              injecting forms dynamically; already-bound forms are skipped)
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
  const FIELD_SELECTOR = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'

  let uid = 0

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
   * @property {boolean} touched  whether errors may be shown yet
   */

  /**
   * Resolve the message for a failed control: per-rule override on the
   * control, then its catch-all override, then the browser's own text.
   * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} el
   * @returns {string} empty string when the control is valid
   */
  const messageFor = (el) => {
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
   * Per-form controller: builds name-keyed field groups, binds their error
   * slots, and wires focusout/input/submit.
   */
  class FormValidator {
    /** @param {HTMLFormElement} form */
    constructor(form) {
      this.form = form
      form.noValidate = true

      /** @type {Map<string, FieldGroup>} */
      this.groups = new Map()
      Array.from(form.querySelectorAll(FIELD_SELECTOR)).forEach((el) => {
        const name = el.getAttribute('name')
        if (!name) return
        let group = this.groups.get(name)
        if (!group) {
          group = { name, els: [], error: null, messageEl: null, touched: false }
          this.groups.set(name, group)
        }
        group.els.push(/** @type {HTMLInputElement} */ (el))
      })

      Array.from(form.querySelectorAll('[wf-validate-element="error"]')).forEach((error) => {
        const group = this.resolveErrorTarget(/** @type {HTMLElement} */ (error))
        if (!group) return
        group.error = /** @type {HTMLElement} */ (error)
        group.messageEl = error.querySelector('[wf-validate-element="message"]')
        error.style.display = 'none'
        error.setAttribute('role', 'alert')
        if (!error.id) error.id = 'wf-validate-error-' + ++uid
        group.els.forEach((el) => el.setAttribute('aria-describedby', error.id))
      })

      form.addEventListener('focusout', (e) => this.onLeave(e))
      form.addEventListener('input', (e) => this.onInput(e))
      form.addEventListener('change', (e) => this.onInput(e))
      // submit interception happens at document capture (see below), so it
      // wins regardless of what order page controllers were bound in
    }

    /**
     * Bind an error slot to a field group: wf-validate-for="<name>" wins;
     * otherwise walk up until an ancestor (below the form) contains a field.
     * @param {HTMLElement} error
     * @returns {FieldGroup | undefined}
     */
    resolveErrorTarget(error) {
      const explicit = error.getAttribute('wf-validate-for')
      if (explicit) return this.groups.get(explicit)
      let scope = error.parentElement
      while (scope && scope !== this.form.parentElement) {
        const field = scope.querySelector(FIELD_SELECTOR)
        if (field && field.getAttribute('name')) return this.groups.get(field.getAttribute('name') || '')
        scope = scope.parentElement
      }
      return undefined
    }

    /**
     * Validate one group and, when showable, paint its state.
     * @param {FieldGroup} group
     * @param {boolean} [show]  force-show even if the group is untouched (submit)
     * @returns {boolean} whether the group is valid
     */
    validateGroup(group, show) {
      let msg = ''
      group.els.forEach((el) => {
        if (!isActive(el)) return
        applyMatch(el, this.form)
        if (!msg) msg = messageFor(el)
      })
      if (show) group.touched = true
      if (group.touched) this.paint(group, msg)
      return !msg
    }

    /**
     * Toggle classes, aria state, and the error slot for a group.
     * @param {FieldGroup} group
     * @param {string} msg  empty string when valid
     * @returns {void}
     */
    paint(group, msg) {
      group.els.forEach((el) => {
        el.classList.toggle(INVALID_CLASS, !!msg)
        el.setAttribute('aria-invalid', msg ? 'true' : 'false')
      })
      if (group.error) {
        ;(group.messageEl || group.error).textContent = msg || ''
        group.error.style.display = msg ? '' : 'none'
      }
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

    /** Field blurred: first moment an error may appear. @param {Event} e @returns {void} */
    onLeave(e) {
      const group = this.groupFor(e)
      if (group) this.validateGroup(group, true)
    }

    /** Live re-validation, but only once a group has been marked. @param {Event} e @returns {void} */
    onInput(e) {
      const group = this.groupFor(e)
      if (group && group.touched) this.validateGroup(group)
    }

    /** @returns {boolean} whether the whole form is valid */
    validateAll() {
      let valid = true
      this.groups.forEach((group) => {
        if (!this.validateGroup(group, true)) valid = false
      })
      this.form.classList.toggle(INVALID_CLASS, !valid)
      return valid
    }
  }

  /** form element -> validator, so re-init never double-binds. @type {WeakMap<HTMLFormElement, FormValidator>} */
  const bound = new WeakMap()

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
      if (!validator || validator.validateAll()) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const firstInvalid = validator.form.querySelector('.' + INVALID_CLASS)
      if (firstInvalid) /** @type {HTMLElement} */ (firstInvalid).focus()
    },
    true,
  )

  /**
   * Scan a scope for opted-in forms and bind any that aren't bound yet.
   * wf-validate-element="form" may sit on the <form> or a wrapper around it.
   * @param {ParentNode} [scope]
   * @returns {void}
   */
  const init = (scope) => {
    Array.from((scope || document).querySelectorAll('[wf-validate-element="form"]')).forEach((el) => {
      const form = /** @type {HTMLFormElement | null} */ (el.tagName === 'FORM' ? el : el.querySelector('form'))
      if (!form || bound.has(form)) return
      bound.set(form, new FormValidator(form))
    })
  }

  window.WfValidate = {
    init,
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
