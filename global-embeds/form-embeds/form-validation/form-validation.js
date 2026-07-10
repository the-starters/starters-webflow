// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/form-validation

/**
 * Form validation that gates submit buttons by field group.
 *
 * Initializes each field container with `[data-validate-group]` (excluding
 * buttons). Linked buttons use `[data-validate-element="button"]` with the
 * same group id — they may live inside the group, under a sibling parent, or
 * anywhere on the page.
 *
 * Disables buttons via `data-button-theme="disabled"`, `aria-disabled`, and
 * native `disabled` until all validatable inputs in the group pass. Supports
 * Webflow custom checkboxes/radios (`.w--redirected-checked`) and skips fields
 * marked `data-validate-ignore`.
 *
 * Used on Account Settings step flows so each step's Continue button stays
 * disabled until its fields are complete.
 */
document.addEventListener("DOMContentLoaded", function () {
  /** @type {string} Theme applied while the button is validation-disabled. */
  const DISABLED_THEME = "disabled"

  /** @type {string} Fallback theme restored when validation passes. */
  const DEFAULT_THEME = "black"

  /**
   * Returns inputs, selects, and textareas that participate in validation.
   * @param {HTMLElement} wrapper - Field group root (`[data-validate-group]`).
   * @returns {HTMLInputElement[] | HTMLSelectElement[] | HTMLTextAreaElement[]} Validatable fields.
   */
  const getValidatableFields = (wrapper) =>
    [...wrapper.querySelectorAll("input, select, textarea")].filter((field) => {
      if (field.disabled || field.hasAttribute("data-validate-ignore")) return false

      const type = (field.getAttribute("type") || "").toLowerCase()
      if (type === "hidden" || type === "submit" || type === "button") return false

      return true
    })

  /**
   * Whether a checkbox is checked, including Webflow's visual input state.
   * @param {HTMLInputElement} input - Checkbox input.
   * @returns {boolean}
   */
  const isWebflowCheckboxChecked = (input) => {
    if (input.checked) return true

    const customInput = input.closest(".w-checkbox")?.querySelector(".w-checkbox-input")
    return customInput?.classList.contains("w--redirected-checked") ?? false
  }

  /**
   * Whether a radio is checked, including Webflow's visual input state.
   * @param {HTMLInputElement} input - Radio input.
   * @returns {boolean}
   */
  const isWebflowRadioChecked = (input) => {
    if (input.checked) return true

    const customInput = input.closest(".w-radio")?.querySelector(".w-radio-input")
    return customInput?.classList.contains("w--redirected-checked") ?? false
  }

  /**
   * Whether at least one radio in a named group is selected.
   * @param {HTMLElement} wrapper - Field group root.
   * @param {string} groupName - Shared `name` attribute on radio inputs.
   * @returns {boolean}
   */
  const isRadioGroupValid = (wrapper, groupName) => {
    const groupRadios = [...wrapper.querySelectorAll('input[type="radio"]')].filter(
      (radio) => !radio.disabled && !radio.hasAttribute("data-validate-ignore") && radio.name === groupName
    )

    if (!groupRadios.length) return true
    return groupRadios.some((radio) => isWebflowRadioChecked(radio))
  }

  /**
   * Whether a select has a non-empty, enabled selection.
   * @param {HTMLSelectElement} select - Select element.
   * @returns {boolean}
   */
  const isSelectValid = (select) => {
    const value = select.value?.trim() ?? ""
    if (!value) return false

    const selectedOption = select.options[select.selectedIndex]
    if (selectedOption?.disabled) return false

    return true
  }

  /**
   * Whether a text-like field has non-whitespace content.
   * @param {HTMLInputElement | HTMLTextAreaElement} field - Input or textarea.
   * @returns {boolean}
   */
  const isTextLikeValid = (field) => Boolean(field.value?.trim())

  /**
   * Validates every validatable field inside a group wrapper.
   * @param {HTMLElement} wrapper - Field group root.
   * @returns {boolean} True when all fields pass validation.
   */
  const isFormWrapperValid = (wrapper) => {
    const fields = getValidatableFields(wrapper)
    if (!fields.length) return true

    const radioGroupNames = new Set()

    fields.forEach((field) => {
      if (field.type !== "radio" || !field.name) return
      radioGroupNames.add(field.name)
    })

    for (const groupName of radioGroupNames) {
      if (!isRadioGroupValid(wrapper, groupName)) return false
    }

    for (const field of fields) {
      if (field.type === "radio") {
        if (field.name) continue
        if (!isWebflowRadioChecked(field)) return false
        continue
      }

      if (field.type === "checkbox") {
        if (!isWebflowCheckboxChecked(field)) return false
        continue
      }

      if (field.tagName === "SELECT") {
        if (!isSelectValid(field)) return false
        continue
      }

      if (!isTextLikeValid(field)) return false
    }

    return true
  }

  /**
   * Caches the button's original `data-button-theme` before toggling disabled state.
   * @param {HTMLElement} buttonWrap - Webflow button wrapper (`.button_main-wrap`).
   * @returns {void}
   */
  const storeOriginalTheme = (buttonWrap) => {
    if (buttonWrap.dataset.validateOriginalTheme) return

    const currentTheme = buttonWrap.getAttribute("data-button-theme")
    buttonWrap.dataset.validateOriginalTheme =
      currentTheme && currentTheme !== DISABLED_THEME ? currentTheme : DEFAULT_THEME
  }

  /**
   * Enables or disables a button wrapper and its actionable child.
   * @param {HTMLElement} buttonWrap - Webflow button wrapper.
   * @param {boolean} isEnabled - Whether validation passed.
   * @returns {void}
   */
  const setButtonEnabled = (buttonWrap, isEnabled) => {
    const originalTheme = buttonWrap.dataset.validateOriginalTheme || DEFAULT_THEME
    const actionable = buttonWrap.querySelector("button, a.clickable_link, .clickable_btn")

    if (isEnabled) {
      buttonWrap.setAttribute("data-button-theme", originalTheme)
      buttonWrap.removeAttribute("data-validate-disabled")
      buttonWrap.removeAttribute("aria-disabled")

      if (actionable) {
        actionable.removeAttribute("aria-disabled")
        actionable.removeAttribute("tabindex")
        if (actionable.matches("button")) actionable.disabled = false
      }

      return
    }

    buttonWrap.setAttribute("data-button-theme", DISABLED_THEME)
    buttonWrap.setAttribute("data-validate-disabled", "")
    buttonWrap.setAttribute("aria-disabled", "true")

    if (actionable) {
      actionable.setAttribute("aria-disabled", "true")
      actionable.setAttribute("tabindex", "-1")
      if (actionable.matches("button")) actionable.disabled = true
    }
  }

  /**
   * Finds all button wrappers linked to a validate group id.
   *
   * Searches inside the field group, under its parent, and document-wide so
   * footer buttons can share a group's id without nesting inside it.
   *
   * @param {HTMLElement} fieldGroup - Field group root.
   * @param {string} groupId - Shared `data-validate-group` value.
   * @returns {HTMLElement[]} Unique matching button wrappers.
   */
  const findButtonsForGroup = (fieldGroup, groupId) => {
    const matched = new Set()
    const groupSelector = `[data-validate-element="button"][data-validate-group="${CSS.escape(groupId)}"]`

    fieldGroup.querySelectorAll('[data-validate-element="button"]').forEach((el) => matched.add(el))
    fieldGroup.parentElement?.querySelectorAll(groupSelector).forEach((el) => matched.add(el))
    document.querySelectorAll(groupSelector).forEach((el) => matched.add(el))

    return [...matched]
  }

  /**
   * Wires validation listeners and syncs linked button state for one field group.
   * @param {HTMLElement} fieldGroup - Element with `data-validate-group` (not a button).
   * @returns {void}
   */
  const initValidateGroup = (fieldGroup) => {
    if (fieldGroup.dataset.validateInitialized) return
    fieldGroup.dataset.validateInitialized = "true"

    const groupId = fieldGroup.getAttribute("data-validate-group")
    if (!groupId) {
      console.warn("Missing data-validate-group value on field group:", fieldGroup)
      return
    }

    const fieldScope = fieldGroup
    const buttonWraps = findButtonsForGroup(fieldGroup, groupId)

    if (!buttonWraps.length) {
      console.warn(
        `No [data-validate-element="button"][data-validate-group="${groupId}"] found for field group:`,
        fieldGroup
      )
      return
    }

    buttonWraps.forEach(storeOriginalTheme)

    /** Re-evaluates the group and toggles every linked button. */
    const updateButtonState = () => {
      const isValid = isFormWrapperValid(fieldScope)
      buttonWraps.forEach((buttonWrap) => setButtonEnabled(buttonWrap, isValid))
    }

    fieldScope.addEventListener("input", updateButtonState)
    fieldScope.addEventListener("change", updateButtonState)
    fieldScope.addEventListener("click", () => {
      window.requestAnimationFrame(updateButtonState)
    })

    buttonWraps.forEach((buttonWrap) => {
      buttonWrap.addEventListener(
        "click",
        (event) => {
          if (!buttonWrap.hasAttribute("data-validate-disabled")) return
          event.preventDefault()
          event.stopPropagation()
        },
        true
      )
    })

    const observer = new MutationObserver(updateButtonState)
    fieldScope.querySelectorAll(".w-checkbox-input, .w-radio-input").forEach((el) => {
      observer.observe(el, { attributes: true, attributeFilter: ["class"] })
    })

    updateButtonState()
  }

  document
    .querySelectorAll('[data-validate-group]:not([data-validate-element="button"])')
    .forEach(initValidateGroup)
})