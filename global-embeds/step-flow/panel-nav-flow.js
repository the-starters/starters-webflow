// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/step-flow/panel-nav-flow
/**
 * Panel navigation for step flows.
 *
 * Swaps visibility between sibling panels inside `[data-panel-parent]`:
 * hub (`reset-panel`) and whole flows (`[data-form-flow="pause-membership"]`, etc.).
 * Uses a per-parent history stack for `[data-panel-nav-back-button]`.
 *
 * Works alongside `Step Flow - JS`, which handles step navigation
 * inside each flow. Panel nav toggles `display` instantly (no slide animation).
 *
 */
document.addEventListener("DOMContentLoaded", function () {
  /** @type {readonly string[]} Valid CSS `display` values for `data-panel-nav-display`. */
  const VALID_DISPLAYS = ["block", "flex", "grid", "inline-flex", "inline-block", "contents"]

  /**
   * Resolves the display value for a panel from `data-panel-nav-display`.
   * @param {HTMLElement} el - Panel element.
   * @returns {string} A valid display value; defaults to `"block"`.
   */
  const getDisplay = (el) => {
    const value = el.getAttribute("data-panel-nav-display")
    return VALID_DISPLAYS.includes(value) ? value : "block"
  }

  /**
   * Finds the panel container that owns a clicked element.
   *
   * When inside `[data-form-flow="main-container"]`, returns the direct child of
   * that container (e.g. `reset-panel`, `pause-membership`). Otherwise returns
   * the direct child of `[data-panel-parent]`.
   *
   * @param {HTMLElement} parent - `[data-panel-parent]` root.
   * @param {HTMLElement} el - Click target or ancestor used for lookup.
   * @returns {HTMLElement | null} The panel wrapper, or `null` if not found.
   */
  const getDirectChild = (parent, el) => {
    const mainContainer = el.closest('[data-form-flow="main-container"]')
    if (mainContainer && parent.contains(mainContainer)) {
      let node = el
      while (node && node.parentElement !== mainContainer) node = node.parentElement
      return node || mainContainer
    }

    let node = el
    while (node && node.parentElement !== parent) node = node.parentElement
    return node
  }

  /**
   * Persists the element's computed `display` before hiding so it can be restored.
   * @param {HTMLElement} el - Panel element.
   * @returns {void}
   */
  const storeDisplay = (el) => {
    if (el.dataset.panelNavStoredDisplay) return
    const computed = getComputedStyle(el).display
    if (computed && computed !== "none") {
      el.dataset.panelNavStoredDisplay = computed
    }
  }

  /**
   * Hides a panel and marks it inaccessible to assistive tech.
   * @param {HTMLElement | null | undefined} el - Panel to hide.
   * @returns {void}
   */
  const hidePanel = (el) => {
    if (!el) return
    storeDisplay(el)
    el.style.display = "none"
    el.setAttribute("aria-hidden", "true")
  }

  /**
   * Shows a panel using `data-panel-nav-display` or the stored computed display.
   * @param {HTMLElement | null | undefined} el - Panel to show.
   * @returns {void}
   */
  const showPanel = (el) => {
    if (!el) return
    const display = el.hasAttribute("data-panel-nav-display")
      ? getDisplay(el)
      : el.dataset.panelNavStoredDisplay || "block"
    el.style.display = display
    el.setAttribute("aria-hidden", "false")
  }

  document.querySelectorAll("[data-panel-parent]").forEach((parent) => {
    if (parent.dataset.scriptInitialized) return
    parent.dataset.scriptInitialized = "true"

    /** @type {HTMLElement[]} Stack of panels for `[data-panel-nav-back-button]`. */
    const history = []

    parent.querySelectorAll("[data-form-flow]").forEach((panel) => {
      if (panel.getAttribute("data-form-flow") === "main-container") return
      hidePanel(panel)
    })

    parent.addEventListener("click", (e) => {
      const navTarget = e.target.closest("[data-panel-nav-target]")
      if (navTarget) {
        const targetId = navTarget.getAttribute("data-panel-nav-target")
        if (!targetId) {
          console.warn("Missing data-panel-nav-target value on:", navTarget)
          return
        }

        const fromPanel = getDirectChild(parent, navTarget)
        const toPanel = parent.querySelector(`[data-form-flow="${CSS.escape(targetId)}"]`)

        if (!fromPanel) {
          console.warn("Could not find panel container for nav target:", navTarget)
          return
        }

        if (!toPanel) {
          console.warn(`No [data-form-flow="${targetId}"] found in:`, parent)
          return
        }

        e.preventDefault()
        history.push(fromPanel)
        hidePanel(fromPanel)
        showPanel(toPanel)
        return
      }

      const backButton = e.target.closest("[data-panel-nav-back-button]")
      if (!backButton) return

      const currentPanel = getDirectChild(parent, backButton)
      const previousPanel = history.pop()

      if (!previousPanel || !currentPanel) return

      e.preventDefault()
      hidePanel(currentPanel)
      showPanel(previousPanel)
    })
  })
})