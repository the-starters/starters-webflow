
/**
 * Quiz tab background and UI theming.
 *
 * Updates page background, section classes, and nav button themes
 * when the active quiz tab changes. Runs after tab switches and
 * subcategory visibility changes.
 *
 * Required markup:
 * - `[data-tab-wrapper]` with `[data-tab-content]` panels
 * - `[data-page-bg]` — full-page background element
 * - `[data-tab='previous']` and `[data-tab='next']` nav wrappers
 *
 * Optional markup inside the wrapper:
 * - `.new_quiz-bottom`, `.new_quiz-step-component`, `.quiz_bottom-layout`
 * - `.section_quiz`, parent `section`
 * - `[data-tab-subcategory='panel']` / `[data-tab-subcategory='button']`
 *
 * Works with `Tabs - JS` via `_quizTabController.syncNavState()`.
 *
 * Webflow embed order: load after `Tabs - JS` and
 * `Tabs Toggler - JS`, before `Tooltip - JS`.
 */
document.addEventListener("DOMContentLoaded", function () {
  const defaultButtonTheme = "white"
  const lightButtonTheme = "black"
  const gradientBackground = "linear-gradient(104deg, #CADED9 25.12%, #77A2AB 100.36%)"
  const sunnyBackgroundColor = "var(--_colors---fill--sunny-melon)"

  /**
   * Sets the full-page background for ways, signup, or default tabs.
   *
   * @param {string | null | undefined} activeTabContent - Value from `data-tab-content`.
   */
  const updatePageBackground = (activeTabContent) => {
    const pageBgEl = document.querySelector("[data-page-bg]")
    if (!pageBgEl) return

    pageBgEl.classList.toggle("is-gradient", activeTabContent === "ways")
    pageBgEl.classList.toggle("is-sunny", activeTabContent === "signup")

    if (activeTabContent === "ways") {
      pageBgEl.style.backgroundImage = "none"
      pageBgEl.style.background = gradientBackground
      return
    }

    if (activeTabContent === "signup") {
      pageBgEl.style.backgroundImage = "none"
      pageBgEl.style.background = sunnyBackgroundColor
      return
    }

    pageBgEl.style.removeProperty("background")
    pageBgEl.style.removeProperty("background-color")
    pageBgEl.style.removeProperty("background-image")
  }

  /**
   * Returns the `data-tab-content` value of the active tab panel.
   *
   * @param {Element} tabWrap - Quiz tab wrapper.
   * @returns {string | null | undefined}
   */
  const getActiveTabContent = (tabWrap) =>
    tabWrap.querySelector("[data-tab-content].is-active")?.getAttribute("data-tab-content")

  /**
   * Applies background, layout, and button theme updates for the active tab.
   *
   * @param {Element} tabWrap - Quiz tab wrapper.
   */
  const updateTabUi = (tabWrap) => {
    const activeTabContent = getActiveTabContent(tabWrap)
    const isWaysOrSignup = activeTabContent === "ways" || activeTabContent === "signup"
    const isSignup = activeTabContent === "signup"
    const isSubcategoryActive = Boolean(
      tabWrap.querySelector(
        "[data-tab-subcategory='panel'].is-active, [data-tab-subcategory='button'].is-active"
      )
    )

    const sectionEl = tabWrap.closest("section")
    if (sectionEl) {
      sectionEl.classList.toggle("is-gradient", activeTabContent === "ways")
      sectionEl.classList.toggle("is-sunny", activeTabContent === "signup")
    }

    updatePageBackground(activeTabContent)

    const bottomEl = tabWrap.querySelector(".quiz_bottom")
    if (bottomEl) {
      bottomEl.classList.toggle("is-light", isWaysOrSignup)
      bottomEl.classList.toggle("is-subcategory", isSubcategoryActive)
      if (isWaysOrSignup) bottomEl.style.backgroundColor = "transparent"
      else bottomEl.style.removeProperty("background-color")
    }

    const stepComponentEl = tabWrap.querySelector(".quiz_tabs-component")
    if (stepComponentEl) stepComponentEl.classList.toggle("is-alt", isWaysOrSignup)

    const bottomMainEl = tabWrap.querySelector(".quiz_bottom-layout")
    if (bottomMainEl) {
      if (isSignup) {
        bottomMainEl.style.opacity = "0"
        bottomMainEl.style.pointerEvents = "none"
      } else {
        bottomMainEl.style.removeProperty("opacity")
        bottomMainEl.style.removeProperty("pointer-events")
      }
    }

    const sectionQuizEl = tabWrap.closest(".section_quiz")
    if (sectionQuizEl) sectionQuizEl.classList.toggle("is-subcategory", isSubcategoryActive)

    tabWrap._quizTabController?.syncNavState?.()

    tabWrap.querySelectorAll("[data-tab='previous'], [data-tab='next']").forEach((control) => {
      if (control.hasAttribute("data-nav-disabled") || control.hasAttribute("data-subcategory-nav-disabled")) {
        control.setAttribute("data-button-theme", "disabled")
        return
      }
      control.setAttribute(
        "data-button-theme",
        isWaysOrSignup ? lightButtonTheme : defaultButtonTheme
      )
    })
  }

  document.querySelectorAll("[data-tab-wrapper]").forEach((tabWrap) => {
    const observedEls = tabWrap.querySelectorAll("[data-tab-content], [data-tab-subcategory]")
    if (!observedEls.length) return

    updateTabUi(tabWrap)

    const observer = new MutationObserver(() => updateTabUi(tabWrap))
    observedEls.forEach((el) => {
      observer.observe(el, { attributes: true, attributeFilter: ["class"] })
    })
  })
})