// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-validation/email-validation

/**
 * Standalone email format validation for Webflow.
 *
 * Inits every `input[type="email"]` on the page (and `input[data-validate-email]`
 * for text fields Webflow styled as email). Shows a red outline via
 * `data-validate-field-invalid="true"` after blur (or when a blocked Continue
 * button is pressed) — not while typing.
 *
 * When validate-form-js.html is also loaded, email fields inside a validate
 * group additionally block the linked Continue button until valid.
 *
 * Webflow: paste this embed + validate-form-css.html (Head). validate-form-js.html
 * is optional — only needed for step Continue button gating.
 */
(function () {
  "use strict"

  const validateForm = ((window.lumos ??= {}).validateForm ??= {
    fieldValidators: [],
    groupInitHooks: [],
    registerFieldValidator(fn) {
      this.fieldValidators.push(fn)
    },
    registerGroupInitHook(fn) {
      this.groupInitHooks.push(fn)
    },
  })

  /** @type {string} Marks an email input that failed validation. */
  const INVALID_FIELD_ATTR = "data-validate-field-invalid"

  /** @type {string} Set after blur; gates when invalid styling appears. */
  const TOUCHED_FIELD_ATTR = "data-validate-touched"

  const EMAIL_SELECTOR = 'input[type="email"], input[data-validate-email]'

  /**
   * Whether an input is treated as an email field.
   * @param {Element | null | undefined} field
   * @returns {field is HTMLInputElement}
   */
  const isEmailField = (field) => {
    if (!(field instanceof HTMLInputElement)) return false
    if (field.disabled || field.hasAttribute("data-validate-ignore")) return false

    const type = (field.getAttribute("type") || "").toLowerCase()
    if (type === "email") return true
    return field.hasAttribute("data-validate-email")
  }

  /**
   * Email inputs under a root (defaults to whole document).
   * @param {ParentNode} [root]
   * @returns {HTMLInputElement[]}
   */
  const getEmailInputs = (root = document) =>
    [...root.querySelectorAll(EMAIL_SELECTOR)].filter((input) => isEmailField(input))

  /**
   * Whether an email input has content and passes format validation.
   * @param {HTMLInputElement} input
   * @returns {boolean}
   */
  const isEmailInputValid = (input) => {
    const value = input.value?.trim() ?? ""
    if (!value) return false

    const type = (input.getAttribute("type") || "").toLowerCase()
    if (type === "email" && typeof input.checkValidity === "function") {
      return input.checkValidity()
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  /**
   * Syncs invalid outline on one email input.
   * @param {HTMLInputElement} input
   * @param {{ forceShow?: boolean }} [options]
   */
  const updateEmailInvalidState = (input, { forceShow = false } = {}) => {
    const isInvalid = !isEmailInputValid(input)
    const showInvalid = isInvalid && (forceShow || input.hasAttribute(TOUCHED_FIELD_ATTR))
    if (showInvalid) input.setAttribute(INVALID_FIELD_ATTR, "true")
    else input.removeAttribute(INVALID_FIELD_ATTR)
  }

  /** Marks an email field as touched so invalid styling may appear. */
  const markEmailTouched = (field) => {
    if (!isEmailField(field)) return
    field.setAttribute(TOUCHED_FIELD_ATTR, "true")
  }

  /**
   * Wires blur/input listeners on one email input. Idempotent.
   * @param {HTMLInputElement} input
   */
  const initEmailInput = (input) => {
    if (!isEmailField(input)) return
    if (input.dataset.validateEmailInited) return
    input.dataset.validateEmailInited = "true"

    const revalidate = () => updateEmailInvalidState(input)

    input.addEventListener("input", () => {
      if (!input.hasAttribute(TOUCHED_FIELD_ATTR)) return
      revalidate()
    })

    input.addEventListener("change", () => {
      markEmailTouched(input)
      revalidate()
    })

    input.addEventListener("blur", () => {
      markEmailTouched(input)
      revalidate()
    })

    revalidate()
  }

  /** Inits every email input on the page. */
  const initAllEmailInputs = () => {
    getEmailInputs().forEach(initEmailInput)
  }

  validateForm.registerFieldValidator((field) => {
    if (!isEmailField(field)) return
    return isEmailInputValid(field)
  })

  document.addEventListener("DOMContentLoaded", initAllEmailInputs)

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      const buttonWrap = target?.closest('[data-validate-element="button"][data-validate-disabled]')
      if (!buttonWrap) return

      const groupId = buttonWrap.getAttribute("data-validate-group")
      const fieldGroup = groupId
        ? document.querySelector(
            `[data-validate-group="${CSS.escape(groupId)}"]:not([data-validate-element="button"])`
          )
        : null

      const scope = fieldGroup || document
      getEmailInputs(scope).forEach((input) => updateEmailInvalidState(input, { forceShow: true }))
    },
    true
  )
})()