// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/step-flow
/**
 * Multi-step form flow engine (pause, cancel, etc.).
 *
 * Handles step navigation inside `[data-form-flow="…"]` roots: linear sequences,
 * multi-sub branching (radio gate → subflow → steps), footer button groups, and
 * action inference from attributes or button labels.
 *
 * Opt-in per-step validation: set `data-form-flow-validate="true"` on the flow root.
 * The current step's required fields (native `required` / `aria-required`) gate its
 * Continue control — the `.button_main-wrap` is disabled (`data-button-theme="disabled"`
 * + `aria-disabled`) until they pass, and invalid inputs get `data-form-flow-field-invalid`
 * after blur/input or a blocked attempt (styled in step-flow-css.html). Exempt a field or
 * wrapper with `data-validate-ignore`. Needs the CSS embed for the red outline.
 *
 * Works alongside `Panel Flow - JS`, which swaps whole panels (hub ↔
 * flow). This script resets a flow when `[data-panel-nav-target]` is clicked.
 *
 * Exposes `window.lumos.formFlow` for programmatic reset, navigation, and
 * returning to the hub (`reset-panel`) inside `[data-form-flow="main-container"]`.
 *
 */
document.addEventListener("DOMContentLoaded", function () {
  /** @type {readonly string[]} Valid CSS `display` values for flow elements. */
  const VALID_DISPLAYS = ["block", "flex", "grid", "inline-flex", "inline-block", "contents"]

  /** @type {string} Element id for the first step in every flow. */
  const STEP1_ID = "step-1"

  /** @type {string} Wrapper id for hub + child flow roots. */
  const MAIN_CONTAINER_ID = "main-container"

  /** @type {string} Hub panel shown on open and after reset. */
  const RESET_PANEL_ID = "reset-panel"

  /** @type {string} Marks an input that failed validation (styled in CSS). */
  const INVALID_FIELD_ATTR = "data-form-flow-field-invalid"

  /** @type {string} Set after the user interacts with a field; gates error UI. */
  const TOUCHED_FIELD_ATTR = "data-form-flow-validate-touched"

  /** @type {string} Marks a nav control disabled by validation (click guard + pointer hook). */
  const VALIDATE_DISABLED_ATTR = "data-form-flow-disabled"

  /** @type {string} Button theme applied while a Continue control is validation-disabled. */
  const DISABLED_THEME = "disabled"

  /** @type {string} Fallback theme when none is stored on the wrapper. */
  const DEFAULT_THEME = "black"

  /** @type {Set<string>} Input types that skip value/format checks (handled separately). */
  const NON_VALUE_INPUT_TYPES = new Set(["hidden", "submit", "button", "checkbox", "radio", "file"])

  /** Webflow-style boolean attrs use `"True"`; accept common casings. */
  const isAttrTrue = (value) => typeof value === "string" && value.toLowerCase() === "true"

  /**
   * Global form-flow registry and container API.
   * @type {{
   *   list: Record<string, { reset: () => void, goTo: (stepId: string, subflowId?: string) => void, el: HTMLElement }>,
   *   containers: Record<string, object>,
   *   reset: (flowId: string) => void,
   *   goTo: (flowId: string, stepId: string, subflowId?: string) => void,
   *   showResetPanel: (containerEl?: HTMLElement) => boolean
   * }}
   */
  const formFlowSystem = ((window.lumos ??= {}).formFlow ??= {
    /** @type {Record<string, object>} */
    list: {},
    /** @type {Record<string, object>} */
    containers: {},
    /**
     * Resets a registered flow to its initial step.
     * @param {string} flowId - Value of `data-form-flow` on the flow root.
     * @returns {void}
     */
    reset(flowId) {
      this.list[flowId]?.reset?.()
    },
    /**
     * Jumps to a step (and optional subflow) without pushing history.
     * @param {string} flowId - Value of `data-form-flow` on the flow root.
     * @param {string} stepId - Target `data-form-flow-element` id.
     * @param {string} [subflowId] - Subflow wrapper id for multi-sub flows.
     * @returns {void}
     */
    goTo(flowId, stepId, subflowId) {
      this.list[flowId]?.goTo?.(stepId, subflowId)
    },
    /**
     * Shows the hub panel and resets all child flows inside main-container.
     * @param {HTMLElement} [containerEl] - Main container; defaults to first on page.
     * @returns {boolean} Whether the reset panel was shown.
     */
    showResetPanel(containerEl) {
      const container = containerEl || document.querySelector(`[data-form-flow="${MAIN_CONTAINER_ID}"]`)
      return container?._formFlowContainerApi?.showResetPanel?.() || false
    },
  })

  /**
   * Returns stored or computed `display` for an element, caching on first read.
   * @param {HTMLElement} el - Target element.
   * @returns {string} Display value to use when showing the element.
   */
  const getStoredDisplay = (el) => {
    if (el.dataset.formFlowStoredDisplay) return el.dataset.formFlowStoredDisplay
    const computed = getComputedStyle(el).display
    if (computed && computed !== "none") {
      el.dataset.formFlowStoredDisplay = computed
    }
    return el.dataset.formFlowStoredDisplay || "block"
  }

  /**
   * Resolves footer button group display from `data-form-flow-button-group-display`.
   * @param {HTMLElement} el - Button group element.
   * @returns {string} Display value; defaults to `"flex"`.
   */
  const getButtonGroupDisplay = (el) => {
    const value = el.getAttribute("data-form-flow-button-group-display")
    if (value && VALID_DISPLAYS.includes(value)) return value
    return "flex"
  }

  /**
   * Hides an element and marks it inaccessible to assistive tech.
   * @param {HTMLElement | null | undefined} el - Element to hide.
   * @returns {void}
   */
  const hideEl = (el) => {
    if (!el) return
    getStoredDisplay(el)
    el.style.display = "none"
    el.setAttribute("aria-hidden", "true")
  }

  /**
   * Shows an element with optional display override.
   * @param {HTMLElement | null | undefined} el - Element to show.
   * @param {string} [displayOverride] - Explicit display; uses stored value if omitted.
   * @returns {void}
   */
  const showEl = (el, displayOverride) => {
    if (!el) return
    const display = displayOverride || getStoredDisplay(el)
    el.style.display = display
    el.setAttribute("aria-hidden", "false")
  }

  /**
   * Whether a click belongs to the tab component (sidebar links, prev/next, inner hit targets).
   * Tab UI can live inside a `[data-form-flow]` root (e.g. generate-contract); leave it to tab JS
   * unless the control also has an explicit form-flow opt-in attribute.
   *
   * @param {Element} el - Click target or resolved action element.
   * @param {HTMLElement} parent - Flow root element.
   * @returns {boolean}
   */
  const isDelegatedTabControl = (el, parent) => {
    if (!parent.contains(el)) return false
    if (el.closest("[role='tab']")) return true
    if (el.closest(".tab_button_list, [role='tablist']")) return true
    const tabWrap = el.closest("[data-tab]")
    if (tabWrap && !tabWrap.hasAttribute("data-form-flow-action")) return true
    return false
  }

  /**
   * Explicit form-flow opt-in on an element (not inferred from button style alone).
   *
   * @param {HTMLElement} el - Candidate action element.
   * @returns {boolean}
   */
  const hasExplicitFormFlowAction = (el) => {
    return (
      el.hasAttribute("data-form-flow-trigger") ||
      el.hasAttribute("data-form-flow-action") ||
      el.hasAttribute("data-form-flow-target")
    )
  }

  /**
   * Finds the clickable element that triggered a form-flow action.
   * Ignores `[data-panel-nav-back-button]` (handled by panel-nav script).
   *
   * @param {HTMLElement} parent - Flow root element.
   * @param {EventTarget | null} target - Event target.
   * @returns {HTMLElement | null} Action element, or `null` if not actionable.
   */
  const getActionElement = (parent, target) => {
    if (!(target instanceof Element)) return null
    if (target.closest("[data-panel-nav-back-button]")) return null

    // Explicit opt-in only: a control navigates the flow when it carries a
    // form-flow attribute, or (via the button fallback below) lives in a
    // [data-form-flow-button-group]. `data-button-style` is styling, NOT consent
    // to navigate — a styled <a>/<button> with no form-flow attr is left alone.
    const actionable = target.closest(
      "[data-form-flow-trigger], [data-form-flow-action], [data-form-flow-target]"
    )
    if (actionable && parent.contains(actionable)) {
      if (
        isDelegatedTabControl(actionable, parent) &&
        !hasExplicitFormFlowAction(actionable)
      ) {
        return null
      }
      return actionable
    }

    if (isDelegatedTabControl(target, parent)) return null

    if (target.matches("button") && parent.contains(target)) {
      if (
        target.closest(
          "[data-form-flow-button-group], [data-form-flow-trigger], [data-form-flow-action], [data-form-flow-target]"
        )
      ) {
        return target
      }
      return null
    }

    return null
  }

  /**
   * Normalized button label for action inference.
   * @param {HTMLElement} el - Button or wrapper element.
   * @returns {string} Lowercase trimmed label text.
   */
  const getButtonText = (el) => {
    const label = el.getAttribute("data-form-flow-label")
    if (label) return label.trim().toLowerCase()

    const button = el.matches("button") ? el : el.querySelector("button")
    return button?.textContent?.trim().toLowerCase() || el.textContent?.trim().toLowerCase() || ""
  }

  /**
   * Resolves the action for a click: explicit attribute, label heuristics, or button style.
   *
   * @param {HTMLElement} el - Action element.
   * @returns {"next" | "back" | "branch" | "close" | "reset" | null} Resolved action.
   */
  const getButtonAction = (el) => {
    const explicit = el.getAttribute("data-form-flow-action")
    // "prev" is a tolerated alias for "back" (some markup uses it); normalize so
    // the dispatcher only ever sees "back".
    if (explicit) return explicit === "prev" ? "back" : explicit

    if (el.closest("[data-panel-nav-back-button]") || el.hasAttribute("data-panel-nav-back-button")) {
      return null
    }

    if (el.closest("[data-settings-panel-close]") || el.hasAttribute("data-settings-panel-close")) {
      return "close"
    }

    const button = el.matches("button") ? el : el.querySelector("button")
    const label = getButtonText(el)

    if (button?.type === "submit") return "next"

    if (/back to account/.test(label)) return "close"

    if (/nevermind|keep my membership/.test(label) && !el.getAttribute("data-form-flow-target")) {
      return "reset"
    }

    if (label === "go back") return "back"

    const style = el.getAttribute("data-button-style")

    if (style === "tertiary") {
      if (el.getAttribute("data-form-flow-target")) return "branch"
      return null
    }

    if (style === "primary" || style === "danger") return "next"

    if (el.getAttribute("data-form-flow-target")) return "branch"

    return "next"
  }

  /**
   * Reads the selected radio branch id from the step-1 radio list.
   * @param {HTMLElement} parent - Flow root element.
   * @returns {string | null} Value of `data-form-flow-value` on the checked label.
   */
  const getSelectedSubflowId = (parent) => {
    const radioList = parent.querySelector('[data-form-flow-element="radio-list"]')
    if (!radioList) return null

    const checked = radioList.querySelector('input[type="radio"]:checked')
    if (!checked) return null

    const label = checked.closest("[data-form-flow-value]")
    return label?.getAttribute("data-form-flow-value") || null
  }

  /**
   * Parses `data-form-flow-preview-path` (e.g. `"step-2a/step-3"`).
   * @param {string | null | undefined} path - Preview path attribute value.
   * @returns {{ subflowId: string, stepId: string | null } | null} Parsed segments.
   */
  const parsePreviewPath = (path) => {
    if (!path) return null
    const parts = path.split("/").filter(Boolean)
    if (parts.length === 1) return { subflowId: parts[0], stepId: null }
    if (parts.length >= 2) return { subflowId: parts[0], stepId: parts[1] }
    return null
  }

  /**
   * Display value for a flow root, preferring panel-nav then form-flow attributes.
   * @param {HTMLElement} el - Flow root or reset panel element.
   * @returns {string} CSS display value.
   */
  const getFlowRootDisplay = (el) => {
    const panelDisplay = el.getAttribute("data-panel-nav-display")
    if (panelDisplay && VALID_DISPLAYS.includes(panelDisplay)) return panelDisplay

    const flowDisplay = el.getAttribute("data-form-flow-display")
    if (flowDisplay && VALID_DISPLAYS.includes(flowDisplay)) return flowDisplay

    return getStoredDisplay(el)
  }

  /** @type {RegExp} Matches step element ids (`step-1`, `step-2a`, etc.). */
  const STEP_ELEMENT_PATTERN = /^step-/

  /**
   * Whether to auto-add `data-form-flow-step` during hydration.
   * Skips subflow wrappers, entry wrappers, and elements that already have the attribute.
   *
   * @param {HTMLElement} el - Candidate `[data-form-flow-element]`.
   * @returns {boolean}
   */
  const shouldAutoAttachFormFlowStep = (el) => {
    if (el.hasAttribute("data-form-flow-step")) return false
    if (el.hasAttribute("data-form-flow-subflow")) return false
    if (el.hasAttribute("data-form-flow-entry")) return false

    const elementId = el.getAttribute("data-form-flow-element")
    if (!elementId || !STEP_ELEMENT_PATTERN.test(elementId)) return false

    return true
  }

  /**
   * Adds `data-form-flow-step` to navigable step elements missing it.
   * @param {ParentNode} [root=document] - DOM subtree to scan.
   * @returns {void}
   */
  const hydrateFormFlowSteps = (root = document) => {
    root.querySelectorAll("[data-form-flow-element]").forEach((el) => {
      if (shouldAutoAttachFormFlowStep(el)) {
        el.setAttribute("data-form-flow-step", "")
      }
    })
  }

  /**
   * Initializes `[data-form-flow="main-container"]`: hub visibility and container API.
   * Hides child flow roots on load and exposes `showResetPanel` / `activateFlowRoot`.
   *
   * @param {HTMLElement} container - Main container element.
   * @returns {void}
   */
  const initFormFlowContainer = (container) => {
    if (container.dataset.formFlowContainerInitialized) return
    container.dataset.formFlowContainerInitialized = "true"

    const resetPanel = container.querySelector(`[data-form-flow-element="${RESET_PANEL_ID}"]`)
    const flowRoots = [...container.querySelectorAll("[data-form-flow]")].filter(
      (el) => el.getAttribute("data-form-flow") !== MAIN_CONTAINER_ID
    )

    /** @returns {void} */
    const hideAllFlowRoots = () => {
      flowRoots.forEach(hideEl)
    }

    /** @returns {void} */
    const resetAllChildFlows = () => {
      flowRoots.forEach((root) => {
        const id = root.getAttribute("data-form-flow")
        if (id) formFlowSystem.list[id]?.reset?.()
      })
    }

    /**
     * Shows hub, hides flow roots, and resets every registered child flow.
     * @returns {boolean} Whether reset panel exists and was shown.
     */
    const showResetPanel = () => {
      if (!resetPanel) return false
      hideAllFlowRoots()
      resetAllChildFlows()
      showEl(resetPanel, getFlowRootDisplay(resetPanel))
      return true
    }

    /**
     * Shows one flow root and hides hub + other flows.
     * @param {string} flowId - Target `data-form-flow` id.
     * @returns {boolean} Whether the flow root was found and activated.
     */
    const activateFlowRoot = (flowId) => {
      const targetRoot = flowRoots.find((root) => root.getAttribute("data-form-flow") === flowId)
      if (!targetRoot) return false
      if (resetPanel) hideEl(resetPanel)
      flowRoots.forEach((root) => {
        if (root === targetRoot) showEl(root, getFlowRootDisplay(root))
        else hideEl(root)
      })
      return true
    }

    const containerKey = container.getAttribute("data-form-flow-id") || MAIN_CONTAINER_ID

    container._formFlowContainerApi = {
      resetPanel,
      flowRoots,
      showResetPanel,
      activateFlowRoot,
      hideAllFlowRoots,
    }

    formFlowSystem.containers[containerKey] = container._formFlowContainerApi

    hideAllFlowRoots()
    if (resetPanel) showEl(resetPanel, getFlowRootDisplay(resetPanel))
  }

  /**
   * Handles reset action: returns to hub when inside main-container, else in-flow reset.
   * @param {HTMLElement} parent - Flow root element.
   * @param {() => void} resetFlow - Flow-local reset callback.
   * @returns {void}
   */
  const handleFlowReset = (parent, resetFlow) => {
    const container = parent.closest(`[data-form-flow="${MAIN_CONTAINER_ID}"]`)
    if (container?._formFlowContainerApi?.showResetPanel?.()) return
    resetFlow()
  }

  /** Whether a checkbox is checked, including Webflow's visual input state. */
  const isCheckboxChecked = (input) => {
    if (input.checked) return true
    const custom = input.closest(".w-checkbox")?.querySelector(".w-checkbox-input")
    return custom?.classList.contains("w--redirected-checked") ?? false
  }

  /** Whether a radio is checked, including Webflow's visual input state. */
  const isRadioChecked = (input) => {
    if (input.checked) return true
    const custom = input.closest(".w-radio")?.querySelector(".w-radio-input")
    return custom?.classList.contains("w--redirected-checked") ?? false
  }

  /** Whether a field opts into validation (native `required` / `aria-required`). */
  const isFieldRequired = (field) =>
    field.required || field.getAttribute("aria-required") === "true"

  /**
   * Whether a field is hidden somewhere between itself and the step root —
   * `display:none` / `visibility:hidden` / `[hidden]` / Webflow conditional
   * visibility. Hidden required fields shouldn't gate Continue. Walk stops at the
   * step so a closed ancestor doesn't mark everything hidden.
   */
  const isHiddenField = (field, stepEl) => {
    let el = field
    while (el) {
      if (el === stepEl) break
      if (el.hasAttribute("hidden") || el.classList.contains("w-condition-invisible")) return true
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden") return true
      el = el.parentElement
    }
    return false
  }

  /**
   * Required, validatable fields in a step. Skips disabled and hidden fields and
   * anything inside (or carrying) `data-validate-ignore` — put that on a single
   * input or a wrapper to exempt it.
   */
  const getRequiredFields = (stepEl) =>
    [...stepEl.querySelectorAll("input, select, textarea")].filter((field) => {
      if (field.disabled || field.closest("[data-validate-ignore]")) return false
      const type = (field.getAttribute("type") || "").toLowerCase()
      if (type === "hidden" || type === "submit" || type === "button") return false
      if (isHiddenField(field, stepEl)) return false
      return isFieldRequired(field)
    })

  /** Whether an input should run value/format checks — required, or optional but filled. */
  const shouldValidateInputValue = (input) => {
    const value = input.value?.trim() ?? ""
    return isFieldRequired(input) || Boolean(value)
  }

  /** Value/format validation for a single field (presence + native constraints). */
  const isFieldValueValid = (field) => {
    if (field.tagName !== "INPUT") {
      if (field.tagName === "SELECT") {
        if (!field.value?.trim()) return false
        if (field.options[field.selectedIndex]?.disabled) return false
        return true
      }
      return Boolean(field.value?.trim())
    }

    const type = (field.getAttribute("type") || "text").toLowerCase()
    if (NON_VALUE_INPUT_TYPES.has(type)) return true
    if (!shouldValidateInputValue(field)) return true

    const value = field.value?.trim() ?? ""
    if (isFieldRequired(field) && !value) return false

    if (typeof field.checkValidity === "function") return field.checkValidity()
    return Boolean(value)
  }

  /** Whether a single required field passes (presence + format where applicable). */
  const isRequiredFieldValid = (field) => {
    if (field.type === "radio") {
      if (field.name) return true
      return isRadioChecked(field)
    }
    if (field.type === "checkbox") return isCheckboxChecked(field)
    return isFieldValueValid(field)
  }

  /** Whether every required field in a step passes. Steps with none (or null) pass. */
  const isStepValid = (stepEl) => {
    if (!stepEl) return true
    const fields = getRequiredFields(stepEl)
    if (!fields.length) return true

    const radioGroups = new Set()
    fields.forEach((field) => {
      if (field.type === "radio" && field.name) radioGroups.add(field.name)
    })
    for (const name of radioGroups) {
      const radios = [...stepEl.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)].filter(
        (radio) => !radio.disabled && !radio.closest("[data-validate-ignore]")
      )
      if (!radios.some((radio) => isRadioChecked(radio))) return false
    }

    for (const field of fields) {
      if (field.type === "radio" && field.name) continue
      if (!isRequiredFieldValid(field)) return false
    }

    /** Optional inputs with content must still pass format rules. */
    const optionalInputs = [...stepEl.querySelectorAll("input")].filter((input) => {
      if (input.disabled || input.closest("[data-validate-ignore]")) return false
      const type = (input.getAttribute("type") || "text").toLowerCase()
      if (NON_VALUE_INPUT_TYPES.has(type)) return false
      if (isHiddenField(input, stepEl)) return false
      if (isFieldRequired(input)) return false
      return Boolean(input.value?.trim())
    })
    for (const input of optionalInputs) {
      if (!isFieldValueValid(input)) return false
    }

    return true
  }

  /** Inputs in a step that can show invalid styling (`<input>` only for now). */
  const getInvalidatableInputs = (stepEl) =>
    [...stepEl.querySelectorAll("input")].filter((input) => {
      if (input.disabled || input.closest("[data-validate-ignore]")) return false
      const type = (input.getAttribute("type") || "text").toLowerCase()
      if (NON_VALUE_INPUT_TYPES.has(type)) return false
      if (isHiddenField(input, stepEl)) return false
      return shouldValidateInputValue(input)
    })

  /** Syncs `data-form-flow-field-invalid` on inputs. `forceShow` reveals errors on a blocked attempt. */
  const updateFieldInvalidStates = (stepEl, { forceShow = false } = {}) => {
    if (!stepEl) return
    getInvalidatableInputs(stepEl).forEach((input) => {
      const isInvalid = !isFieldValueValid(input)
      const showInvalid = isInvalid && (forceShow || input.hasAttribute(TOUCHED_FIELD_ATTR))
      if (showInvalid) input.setAttribute(INVALID_FIELD_ATTR, "true")
      else input.removeAttribute(INVALID_FIELD_ATTR)
    })
  }

  /** Marks a field touched so invalid styling may appear after blur/input. */
  const markFieldTouched = (field) => {
    if (!(field instanceof HTMLInputElement)) return
    field.setAttribute(TOUCHED_FIELD_ATTR, "true")
  }

  /** Caches a button wrapper's original `data-button-theme` before toggling disabled state. */
  const storeOriginalTheme = (buttonWrap) => {
    if (buttonWrap.dataset.formFlowOriginalTheme) return
    const currentTheme = buttonWrap.getAttribute("data-button-theme")
    buttonWrap.dataset.formFlowOriginalTheme =
      currentTheme && currentTheme !== DISABLED_THEME ? currentTheme : DEFAULT_THEME
  }

  /**
   * Enables/disables a Continue control's wrapper. Uses `aria-disabled` + a marker attr (not
   * native `disabled`) so the click guard still fires and can reveal field errors on attempt.
   * @param {HTMLElement} buttonWrap - `.button_main-wrap` (carries `data-button-theme`).
   * @param {boolean} isEnabled
   * @returns {void}
   */
  const setButtonEnabled = (buttonWrap, isEnabled) => {
    storeOriginalTheme(buttonWrap)
    const actionable = buttonWrap.querySelector("button, a.clickable_link, .clickable_btn")
    if (isEnabled) {
      buttonWrap.setAttribute("data-button-theme", buttonWrap.dataset.formFlowOriginalTheme || DEFAULT_THEME)
      buttonWrap.removeAttribute(VALIDATE_DISABLED_ATTR)
      buttonWrap.removeAttribute("aria-disabled")
      actionable?.removeAttribute("aria-disabled")
      return
    }
    buttonWrap.setAttribute("data-button-theme", DISABLED_THEME)
    buttonWrap.setAttribute(VALIDATE_DISABLED_ATTR, "")
    buttonWrap.setAttribute("aria-disabled", "true")
    actionable?.setAttribute("aria-disabled", "true")
  }

  /** "Next"/Continue control wrappers in a button group (excludes back/branch/close). */
  const getNextControls = (groupEl) => {
    const candidates = new Set([
      ...groupEl.querySelectorAll(".button_main-wrap"),
      ...groupEl.querySelectorAll("[data-form-flow-action]"),
    ])
    return [...candidates].filter((el) => {
      if (el.closest("[data-panel-nav-back-button]") || el.hasAttribute("data-panel-nav-back-button")) return false
      return getButtonAction(el) === "next"
    })
  }

  /** Whether a resolved action element sits inside a validation-disabled Continue control. */
  const isNavDisabled = (el) =>
    !!(el && (el.closest(`[${VALIDATE_DISABLED_ATTR}]`) || el.hasAttribute(VALIDATE_DISABLED_ATTR)))

  /**
   * Initializes a single form flow root (linear or multi-sub).
   * Registers click handlers, step state, and `formFlowSystem.list[flowId]`.
   *
   * @param {HTMLElement} parent - Element with `data-form-flow` (not main-container).
   * @returns {void}
   */
  const initFormFlow = (parent) => {
    if (parent.dataset.scriptInitialized) return
    parent.dataset.scriptInitialized = "true"

    const flowId = parent.getAttribute("data-form-flow")
    const isMultiSub = parent.getAttribute("data-form-flow-type") === "multi-sub"
    const previewPath = parent.getAttribute("data-form-flow-preview-path")
    const validateFlow = isAttrTrue(parent.getAttribute("data-form-flow-validate"))

    const entryWrapper = parent.querySelector("[data-form-flow-entry]")
    const entryIsWrapper = !!entryWrapper
    const subflowWrappers = [...parent.querySelectorAll("[data-form-flow-subflow]")]
    const allContentSteps = [...parent.querySelectorAll("[data-form-flow-step]")]
    const buttonGroups = [...parent.querySelectorAll("[data-form-flow-button-group]")]
    const linearScope = parent.querySelector("[data-form-flow-layout]") || parent
    const linearContentSteps = allContentSteps.filter((step) => !subflowWrappers.some((wrap) => wrap.contains(step)))
    const sharedFooter = !isMultiSub ? parent.querySelector("[data-form-flow-footer]") : null

    /** @type {{ currentStepId: string | null, activeSubflowEl: HTMLElement | null, history: Array<{ stepId: string, subflowEl: HTMLElement | null }> }} */
    const state = {
      currentStepId: null,
      activeSubflowEl: null,
      currentGroupEl: null,
      history: [],
    }

    /**
     * Finds a content step by id within a subflow or the flow root.
     * @param {string} stepId - `data-form-flow-element` value.
     * @param {HTMLElement | null} subflowEl - Active subflow wrapper, if any.
     * @returns {HTMLElement | null}
     */
    const findContentStep = (stepId, subflowEl) => {
      const scope = subflowEl || parent
      return scope.querySelector(
        `[data-form-flow-step][data-form-flow-element="${CSS.escape(stepId)}"]`
      )
    }

    /**
     * Finds a subflow wrapper by `data-form-flow-element` id.
     * @param {string} subflowId - Subflow id (e.g. `"step-2a"`).
     * @returns {HTMLElement | null}
     */
    const findSubflowWrapper = (subflowId) => {
      return subflowWrappers.find((el) => el.getAttribute("data-form-flow-element") === subflowId) || null
    }

    /** @returns {HTMLElement[]} Ordered content steps in the current navigation scope. */
    const getScopeContentSteps = () => {
      if (state.activeSubflowEl) return getContentStepsInScope(state.activeSubflowEl)
      if (isMultiSub) return []
      return linearContentSteps
    }

    /**
     * @param {HTMLElement} scopeEl - Subflow or layout scope.
     * @returns {HTMLElement[]}
     */
    const getContentStepsInScope = (scopeEl) => {
      return [...scopeEl.querySelectorAll("[data-form-flow-step]")]
    }

    /**
     * DOM scope that holds the footer button group for a step.
     * @param {string} stepId - Current step id.
     * @param {HTMLElement | null} subflowEl - Active subflow, if any.
     * @returns {HTMLElement}
     */
    const getButtonGroupScope = (stepId, subflowEl) => {
      if (stepId === STEP1_ID && isMultiSub && entryIsWrapper) return entryWrapper
      if (subflowEl) return subflowEl
      return sharedFooter || linearScope
    }

    /** @returns {void} */
    const hideAllButtonGroups = () => {
      buttonGroups.forEach((group) => hideEl(group))
    }

    /**
     * Shows the button group matching the current step id within scope.
     * @param {string} stepId - Step id matching `data-form-flow-button-group`.
     * @param {HTMLElement} [scopeEl] - Footer or subflow scope.
     * @returns {void}
     */
    const showButtonGroup = (stepId, scopeEl) => {
      hideAllButtonGroups()
      const scope = scopeEl || parent
      const group = scope.querySelector(`[data-form-flow-button-group="${CSS.escape(stepId)}"]`)
      if (group) {
        showEl(group, getButtonGroupDisplay(group))
        return group
      }
      console.warn(`[data-form-flow="${flowId}"] No button group "${stepId}" in scope:`, scope)
      return null
    }

    /** @returns {void} */
    const hideAllContentSteps = () => {
      allContentSteps.forEach((step) => hideEl(step))
    }

    /** @returns {void} */
    const hideAllSubflows = () => {
      subflowWrappers.forEach((wrap) => hideEl(wrap))
    }

    /**
     * Shows one step, updates subflow visibility, and syncs footer button groups.
     * @param {string} stepId - Target step id.
     * @param {{ pushHistory?: boolean, subflowEl?: HTMLElement | null }} [options] - Navigation options.
     * @returns {void}
     */
    const showStep = (stepId, options = {}) => {
      const { pushHistory = false, subflowEl = state.activeSubflowEl } = options

      if (pushHistory && state.currentStepId && state.currentStepId !== stepId) {
        state.history.push({
          stepId: state.currentStepId,
          subflowEl: state.activeSubflowEl,
        })
      }

      hideAllContentSteps()

      if (stepId === STEP1_ID && isMultiSub && entryIsWrapper) {
        hideAllSubflows()
        state.activeSubflowEl = null
        showEl(entryWrapper, "contents")
        state.currentGroupEl = showButtonGroup(STEP1_ID, entryWrapper)
        state.currentStepId = STEP1_ID
        syncStepValidation()
        return
      }

      if (entryIsWrapper) hideEl(entryWrapper)

      if (subflowEl) {
        subflowWrappers.forEach((wrap) => {
          if (wrap === subflowEl) showEl(wrap, "contents")
          else hideEl(wrap)
        })
        state.activeSubflowEl = subflowEl
      } else if (!isMultiSub) {
        hideAllSubflows()
        state.activeSubflowEl = null
        if (sharedFooter) showEl(sharedFooter)
      }

      const contentStep = findContentStep(stepId, subflowEl)
      if (!contentStep) {
        console.warn(`[data-form-flow="${flowId}"] Could not find content step:`, stepId)
        return
      }

      showEl(contentStep)
      state.currentGroupEl = showButtonGroup(stepId, getButtonGroupScope(stepId, subflowEl))
      state.currentStepId = stepId
      syncStepValidation()
    }

    /**
     * @param {HTMLElement} currentStepEl - Current content step element.
     * @returns {string | null} Next step id in DOM order, or `null` at end.
     */
    const getNextStepId = (currentStepEl) => {
      const steps = getScopeContentSteps()
      const index = steps.indexOf(currentStepEl)
      if (index === -1 || index >= steps.length - 1) return null
      return steps[index + 1].getAttribute("data-form-flow-element")
    }

    /**
     * Clears history and navigates to step 1 (or preview path in Designer).
     * @returns {void}
     */
    const resetFlow = () => {
      state.history = []
      state.activeSubflowEl = null
      state.currentStepId = null

      if (previewPath && isMultiSub) {
        const parsed = parsePreviewPath(previewPath)
        if (parsed) {
          const subflowEl = findSubflowWrapper(parsed.subflowId)
          if (subflowEl) {
            const steps = getContentStepsInScope(subflowEl)
            const stepId = parsed.stepId || steps[0]?.getAttribute("data-form-flow-element")
            if (stepId) {
              showStep(stepId, { subflowEl })
              return
            }
          }
          console.warn(`[data-form-flow="${flowId}"] Invalid preview path:`, previewPath)
        }
      }

      if (isMultiSub && entryIsWrapper) {
        hideAllSubflows()
        hideAllContentSteps()
        showStep(STEP1_ID)
        return
      }

      hideAllSubflows()
      if (sharedFooter) showEl(sharedFooter)
      showStep(STEP1_ID)
    }

    /**
     * Programmatic jump to a step without history push.
     * @param {string} stepId - Target step id.
     * @param {string} [subflowId] - Subflow wrapper id for multi-sub flows.
     * @returns {void}
     */
    const goToStep = (stepId, subflowId) => {
      const subflowEl = subflowId ? findSubflowWrapper(subflowId) : state.activeSubflowEl
      showStep(stepId, { subflowEl, pushHistory: false })
    }

    /**
     * Advances to the next step, enters a subflow from step 1, or jumps to `data-form-flow-target`.
     * @param {HTMLElement} actionEl - Clicked action element.
     * @returns {void}
     */
    const handleNext = (actionEl) => {
      const target = actionEl.getAttribute("data-form-flow-target")

      // Block advancing while the current step has invalid required fields; reveal errors.
      if (validateFlow) {
        const stepEl = findContentStep(state.currentStepId, state.activeSubflowEl)
        if (!isStepValid(stepEl)) {
          updateFieldInvalidStates(stepEl, { forceShow: true })
          return
        }
      }

      if (state.currentStepId === STEP1_ID && isMultiSub) {
        const subflowId = target || getSelectedSubflowId(parent)
        if (!subflowId) {
          console.warn(`[data-form-flow="${flowId}"] Select an option before continuing.`)
          return
        }
        const subflowEl = findSubflowWrapper(subflowId)
        if (!subflowEl) {
          console.warn(`[data-form-flow="${flowId}"] No sub-flow found:`, subflowId)
          return
        }
        const firstStep = getContentStepsInScope(subflowEl)[0]
        if (!firstStep) {
          console.warn(`[data-form-flow="${flowId}"] No steps in sub-flow:`, subflowId)
          return
        }
        showStep(firstStep.getAttribute("data-form-flow-element"), {
          subflowEl,
          pushHistory: true,
        })
        return
      }

      if (target) {
        showStep(target, { pushHistory: true })
        return
      }

      const currentStepEl = findContentStep(state.currentStepId, state.activeSubflowEl)
      const nextId = currentStepEl ? getNextStepId(currentStepEl) : null
      if (!nextId) {
        console.warn(`[data-form-flow="${flowId}"] No next step from:`, state.currentStepId)
        return
      }
      showStep(nextId, { pushHistory: true })
    }

    /**
     * Pops step history or returns to step 1 from an active subflow.
     * @returns {void}
     */
    const handleBack = () => {
      const previous = state.history.pop()
      if (previous) {
        showStep(previous.stepId, { subflowEl: previous.subflowEl, pushHistory: false })
        return
      }

      if (state.activeSubflowEl) {
        showStep(STEP1_ID, { pushHistory: false })
      }
    }

    /**
     * Jumps to `data-form-flow-target` with history push (tertiary branch buttons).
     * @param {HTMLElement} actionEl - Clicked action element.
     * @returns {void}
     */
    const handleBranch = (actionEl) => {
      const target = actionEl.getAttribute("data-form-flow-target")
      if (!target) {
        console.warn("[data-form-flow] branch action requires data-form-flow-target on:", actionEl)
        return
      }
      showStep(target, { pushHistory: true })
    }

    /**
     * Closes the settings modal via `window.lumos.settingsPanel` or a close trigger click.
     * @returns {void}
     */
    const handleClose = () => {
      const panel = parent.closest("[data-settings-panel]")
      const panelId = panel?.getAttribute("data-settings-panel")
      if (panelId && window.lumos?.settingsPanel?.list?.[panelId]?.close) {
        window.lumos.settingsPanel.list[panelId].close()
        return
      }
      const closeTrigger = panel?.querySelector("[data-settings-panel-close] button")
      closeTrigger?.click()
    }

    /**
     * Whether a click should fall through to a native (Webflow) form submit instead
     * of being treated as a flow "next". True when the resolved control is a real
     * `type="submit"` button with no explicit form-flow opt-in and no further step to
     * advance to — i.e. the final Confirm button. Keeps us from `preventDefault()`-ing
     * the submit and stranding the form.
     *
     * @param {HTMLElement} actionEl - Resolved action element.
     * @returns {boolean}
     */
    const isTerminalSubmit = (actionEl) => {
      const button = actionEl.matches("button") ? actionEl : actionEl.querySelector("button")
      if (button?.type !== "submit") return false
      if (hasExplicitFormFlowAction(actionEl)) return false
      const currentStepEl = findContentStep(state.currentStepId, state.activeSubflowEl)
      return !(currentStepEl && getNextStepId(currentStepEl))
    }

    /**
     * Re-evaluates the current step and enables/disables its Continue control(s).
     * No-op unless the flow opted in with `data-form-flow-validate="true"`.
     * @returns {void}
     */
    const syncStepValidation = () => {
      if (!validateFlow) return
      const stepEl = findContentStep(state.currentStepId, state.activeSubflowEl)
      const valid = isStepValid(stepEl)
      if (state.currentGroupEl) {
        getNextControls(state.currentGroupEl).forEach((ctrl) => setButtonEnabled(ctrl, valid))
      }
      updateFieldInvalidStates(stepEl)
    }

    parent.addEventListener("click", (e) => {
      const actionEl = getActionElement(parent, e.target)
      if (!actionEl) return

      const action = getButtonAction(actionEl)
      if (!action) return

      // A validation-disabled Continue stays clickable (no native `disabled`) so the
      // attempt can surface field errors instead of silently doing nothing. Checked
      // before the terminal-submit fall-through so an invalid final step can't submit.
      if (action === "next" && validateFlow && isNavDisabled(actionEl)) {
        e.preventDefault()
        const stepEl = findContentStep(state.currentStepId, state.activeSubflowEl)
        updateFieldInvalidStates(stepEl, { forceShow: true })
        return
      }

      // Let the browser/Webflow handle a genuine terminal submit button.
      if (action === "next" && isTerminalSubmit(actionEl)) return

      e.preventDefault()

      if (action === "next") handleNext(actionEl)
      else if (action === "back") handleBack()
      else if (action === "branch") handleBranch(actionEl)
      else if (action === "close") handleClose()
      else if (action === "reset") handleFlowReset(parent, resetFlow)
    })

    if (validateFlow) {
      parent.addEventListener("input", (e) => {
        markFieldTouched(e.target)
        syncStepValidation()
      })
      parent.addEventListener("change", (e) => {
        markFieldTouched(e.target)
        syncStepValidation()
      })
      parent.addEventListener(
        "blur",
        (e) => {
          if (!(e.target instanceof HTMLInputElement)) return
          markFieldTouched(e.target)
          updateFieldInvalidStates(findContentStep(state.currentStepId, state.activeSubflowEl))
        },
        true
      )
      // Webflow custom checkbox/radio toggle a class, not the native `input` event.
      const validationObserver = new MutationObserver(() => syncStepValidation())
      parent.querySelectorAll(".w-checkbox-input, .w-radio-input").forEach((el) =>
        validationObserver.observe(el, { attributes: true, attributeFilter: ["class"] })
      )
    }

    buttonGroups.forEach((group) => hideEl(group))
    hideAllContentSteps()
    hideAllSubflows()
    if (entryIsWrapper) hideEl(entryWrapper)
    if (sharedFooter) hideEl(sharedFooter)

    resetFlow()

    if (flowId) {
      formFlowSystem.list[flowId] = {
        reset: resetFlow,
        goTo: goToStep,
        el: parent,
      }
    }
  }

  hydrateFormFlowSteps()

  document.querySelectorAll(`[data-form-flow="${MAIN_CONTAINER_ID}"]`).forEach(initFormFlowContainer)

  document.querySelectorAll("[data-form-flow]").forEach((parent) => {
    if (parent.getAttribute("data-form-flow") === MAIN_CONTAINER_ID) return
    initFormFlow(parent)
  })

  /**
   * Resets a flow when panel-nav opens it so the user always lands on step 1.
   * Complements `settings-panel-nav-js.html`, which handles show/hide only.
   */
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-panel-nav-target]")
    if (!trigger) return
    const targetId = trigger.getAttribute("data-panel-nav-target")
    if (targetId && formFlowSystem.list[targetId]) {
      formFlowSystem.list[targetId].reset()
    }
  })
})  