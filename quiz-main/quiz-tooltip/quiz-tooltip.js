/**
 * Quiz Continue tooltip.
 *
 * Shows a Tippy tooltip on the Continue button when the user has not
 * selected a category or subcategory option. Tooltip appears on hover
 * and keyboard focus.
 *
 * Required markup (inside each `[data-tab-wrapper]`):
 * - `[data-tab='next']` — Continue nav wrapper
 * - Gating attributes set by other quiz scripts:
 *   `data-nav-disabled` (no category) or
 *   `data-subcategory-nav-disabled` (no subcategory)
 *
 * Loads Tippy.js and Popper from CDN. Attach to `.new_quiz-button-wrap`
 * when present so hover works even when the inner button is disabled.
 */
(function () {
  const TOOLTIP_CONTENT = "Please select atleast one option to continue"

  /**
   * Returns whether Continue is blocked due to missing selections.
   *
   * @param {Element} nextWrap - Continue nav wrapper.
   * @returns {boolean}
   */
  const isSelectionGated = (nextWrap) =>
    nextWrap.hasAttribute("data-nav-disabled") ||
    nextWrap.hasAttribute("data-subcategory-nav-disabled")

  /**
   * Syncs tooltip target attributes when gating state changes.
   *
   * When gated, marks the target with `data-quiz-continue-tooltip`,
   * makes it focusable, and sets the aria-label to the tooltip text.
   *
   * @param {Element} nextWrap - Continue nav wrapper.
   * @param {Element} tooltipTarget - Element Tippy attaches to.
   */
  const syncTooltipTarget = (nextWrap, tooltipTarget) => {
    const gated = isSelectionGated(nextWrap)
    tooltipTarget.toggleAttribute("data-quiz-continue-tooltip", gated)
    tooltipTarget.setAttribute("tabindex", gated ? "0" : "-1")
    tooltipTarget.setAttribute(
      "aria-label",
      gated ? TOOLTIP_CONTENT : "Continue"
    )
  }

  /**
   * Initializes Continue tooltips on every quiz tab wrapper on the page.
   *
   * Watches `data-nav-disabled` and `data-subcategory-nav-disabled`
   * on the Next wrapper and hides the tooltip when gating is removed.
   */
  const initQuizContinueTooltips = () => {
    if (typeof tippy === "undefined") return

    document.querySelectorAll("[data-tab-wrapper]").forEach((tabWrap) => {
      const nextWrap = tabWrap.querySelector("[data-tab='next']")
      if (!nextWrap) return

      const tooltipTarget =
        nextWrap.closest(".new_quiz-button-wrap") || nextWrap

      if (tooltipTarget.dataset.tooltipInitialized) return
      tooltipTarget.dataset.tooltipInitialized = "true"

      syncTooltipTarget(nextWrap, tooltipTarget)

      const instance = tippy(tooltipTarget, {
        content: TOOLTIP_CONTENT,
        placement: "top",
        arrow: false,
        theme: "quiz-continue-tooltip",
        trigger: "mouseenter focus",
        appendTo: () => document.body,
        onShow() {
          syncTooltipTarget(nextWrap, tooltipTarget)
          return isSelectionGated(nextWrap)
        },
      })

      const observer = new MutationObserver(() => {
        syncTooltipTarget(nextWrap, tooltipTarget)
        if (!isSelectionGated(nextWrap) && instance.state.isVisible) {
          instance.hide()
        }
      })

      observer.observe(nextWrap, {
        attributes: true,
        attributeFilter: ["data-nav-disabled", "data-subcategory-nav-disabled"],
      })
    })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initQuizContinueTooltips)
  } else {
    initQuizContinueTooltips()
  }
})()