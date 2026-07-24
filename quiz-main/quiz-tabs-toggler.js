
/**
 * Quiz category sub-tabs.
 *
 * Shows or hides category tab buttons and panels based on checkboxes
 * in the Categories form. Previous and Next stay disabled until at
 * least one category is selected.
 *
 * Required markup (inside each `[data-tab-wrapper]`):
 * - Form: `#wf-form-Categories`
 * - Checkboxes: `[data-category-value]`
 * - Tab buttons: `[data-category-link]` (value must match a checkbox)
 * - Tab panels: `[data-tab-category-link]` (value must match a checkbox)
 * - Nav wrappers: `[data-tab='previous']`, `[data-tab='next']`
 *
 * Works with `Tabs - JS`, which exposes `tabWrap._quizTabController`.
 *
 * Webflow embed order: load after `Tabs - JS`, before
 * `Page Theme - JS` and `Tooltip - JS`.
 */
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("[data-tab-wrapper]").forEach((tabWrap) => {
    const form = tabWrap.querySelector("#wf-form-Categories")
    if (!form) return

    const previousWrap = tabWrap.querySelector("[data-tab='previous']")
    const nextWrap = tabWrap.querySelector("[data-tab='next']")

    /**
     * Returns the values of all checked category checkboxes.
     *
     * @returns {string[]} Selected category values from `data-category-value`.
     */
    const getSelectedCategories = () =>
      [...form.querySelectorAll("[data-category-value]:checked")].map(
        (el) => el.dataset.categoryValue
      )

    /**
     * Enables or disables Previous and Next navigation.
     *
     * When gated, sets `data-nav-disabled` and disables the button inside
     * each nav wrapper. When ungated, removes those restrictions and asks
     * the tab controller to refresh.
     *
     * @param {boolean} gated - `true` to disable nav, `false` to enable it.
     */
    const setNavGated = (gated) => {
      ;[previousWrap, nextWrap].forEach((wrap) => {
        if (!wrap) return
        const button = wrap.querySelector("button")
        if (gated) {
          wrap.setAttribute("data-nav-disabled", "")
          wrap.setAttribute("data-button-theme", "disabled")
          if (button) button.disabled = true
          return
        }
        wrap.removeAttribute("data-nav-disabled")
      })

      tabWrap._quizTabController?.refresh()
    }

    /**
     * Updates visible category tabs and panels to match the form selection.
     *
     * Hides tabs and panels whose category is not checked. Disables nav
     * when nothing is selected.
     */
    const syncCategoryTabs = () => {
      const selected = new Set(getSelectedCategories())

      tabWrap.querySelectorAll("[data-category-link]").forEach((btn) => {
        const show = selected.has(btn.dataset.categoryLink)
        btn.toggleAttribute("data-category-hidden", !show)
        btn.hidden = !show
      })

      tabWrap.querySelectorAll("[data-tab-category-link]").forEach((panel) => {
        const show = selected.has(panel.dataset.tabCategoryLink)
        panel.toggleAttribute("data-category-hidden", !show)
      })

      setNavGated(selected.size === 0)
    }

    // Start with all category tabs hidden and nav disabled.
    tabWrap.querySelectorAll("[data-category-link]").forEach((btn) => {
      btn.setAttribute("data-category-hidden", "")
      btn.hidden = true
    })

    tabWrap.querySelectorAll("[data-tab-category-link]").forEach((panel) => {
      panel.setAttribute("data-category-hidden", "")
    })

    setNavGated(true)
    form.addEventListener("change", syncCategoryTabs)
    syncCategoryTabs()
  })
})