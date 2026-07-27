/**
 * Quiz tab controller.
 *
 * Powers the multi-step quiz: tab buttons, panels, Previous/Next nav,
 * keyboard support, and optional GSAP slide/fade animations.
 *
 * Also gates navigation when categories or subcategories are not selected.
 *
 * Required markup (inside each `[data-tab-wrapper]`):
 * - `[data-tab-component='button-list']` with `[data-tab-component='button']` items
 * - `[data-tab-component='panel-list']` with `[data-tab-component='panel']` items
 * - `[data-tab='previous']` and `[data-tab='next']` nav wrappers
 *
 * Optional attributes on `[data-tab-wrapper]`:
 * - `data-loop-controls="True"` — wrap from last tab back to first
 * - `data-slide-tabs="True"` — slide animation instead of fade
 * - `data-autoplay-duration` — seconds between auto-advance (0 = off)
 * - `data-pause-on-hover="True"` — pause autoplay on hover
 * - `data-duration` — animation duration in seconds (default 0.3)
 *
 * Exposes `tabWrap._quizTabController` for `Tabs Toggler - JS`.
 */
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("[data-tab-wrapper]").forEach((tabWrap, componentIndex) => {
    if (tabWrap.dataset.scriptInitialized) return
    tabWrap.dataset.scriptInitialized = "true"

    const loopControls = tabWrap.getAttribute("data-loop-controls") === "True"
    const slideTabs = tabWrap.getAttribute("data-slide-tabs") === "True"
    const pauseOnHover = tabWrap.getAttribute("data-pause-on-hover") === "True"
    let autoplay = Number(tabWrap.getAttribute("data-autoplay-duration")) || 0
    const duration = Number(tabWrap.getAttribute("data-duration")) || 0.3
    const buttonList = tabWrap.querySelector("[data-tab-component='button-list']")
    const panelList = tabWrap.querySelector("[data-tab-component='panel-list']")
    const previousButton = tabWrap.querySelector("[data-tab='previous'] button")
    const nextButton = tabWrap.querySelector("[data-tab='next'] button")
    const previousWrap = tabWrap.querySelector("[data-tab='previous']")
    const nextWrap = tabWrap.querySelector("[data-tab='next']")
    const toggleWrap = tabWrap.querySelector("[data-tab-button='toggle']")
    const toggleButton = tabWrap.querySelector("[data-tab-button='toggle'] button")

    let animating = false
    let canPlay = true
    let autoplayTl

    /**
     * Unwraps Webflow `display-contents` layers so tab items sit
     * directly inside the button or panel list.
     *
     * @param {Element | null} slot - Button list or panel list container.
     */
    const flattenDisplayContents = (slot) => {
      if (!slot) return
      let child = slot.firstElementChild
      while (child && child.classList.contains("display-contents")) {
        while (child.firstChild) {
          slot.insertBefore(child.firstChild, child)
        }
        slot.removeChild(child)
        child = slot.firstElementChild
      }
    }

    flattenDisplayContents(buttonList)
    flattenDisplayContents(panelList)

    /**
     * Moves CMS collection items out of `.w-dyn-list` into the tab slot.
     * Skips items hidden by Webflow conditions.
     *
     * @param {Element | null} slot - Button list or panel list container.
     * @param {string} itemSelector - Selector for the tab item inside each CMS row.
     */
    const removeCMSList = (slot, itemSelector) => {
      const dynList = Array.from(slot.children).find((child) => child.classList.contains("w-dyn-list"))
      if (!dynList) return
      const nestedItems = dynList.querySelector(".w-dyn-items")?.children
      if (!nestedItems) return

      const insertBefore = dynList.nextElementSibling

      ;[...nestedItems].forEach((el) => {
        const item = el.querySelector(itemSelector)
        if (item && !item.classList.contains("w-condition-invisible")) {
          slot.insertBefore(item, insertBefore)
        }
      })

      dynList.remove()
    }

    /**
     * Clears inline display/opacity styles on panel content before animation.
     *
     * @param {Element} panel - Tab panel element.
     */
    const resetPanelContentStyles = (panel) => {
      panel.querySelectorAll("[data-tab-component='content-layout']").forEach((main) => {
        main.style.removeProperty("display")
        main.style.removeProperty("opacity")
        main.style.removeProperty("transition")
      })
    }

    removeCMSList(buttonList, "[data-tab-component='button']")
    removeCMSList(panelList, "[data-tab-component='panel']")

    const buttonItems = Array.from(buttonList.querySelectorAll("[data-tab-component='button']"))
    const panelItems = Array.from(panelList.querySelectorAll("[data-tab-component='panel']"))

    if (!buttonList || !panelList || !buttonItems.length || !panelItems.length) {
      console.warn("Missing elements in:", tabWrap)
      return
    }

    panelItems.forEach((panel) => {
      resetPanelContentStyles(panel)
      panel.style.display = "none"
      panel.setAttribute("role", "tabpanel")
    })

    panelList.removeAttribute("role")
    buttonList.setAttribute("role", "tablist")
    buttonItems.forEach((btn) => btn.setAttribute("role", "tab"))
    panelItems.forEach((panel) => panel.setAttribute("role", "tabpanel"))

    /**
     * Returns whether a tab button or panel is currently visible.
     * Category tabs hidden by the subcategories script are excluded.
     *
     * @param {Element} el - Tab button or panel.
     * @returns {boolean}
     */
    const isTabVisible = (el) => {
      if (el.hasAttribute("data-category-link") || el.hasAttribute("data-tab-category-link")) {
        return !el.hasAttribute("data-category-hidden")
      }
      return true
    }

    /**
     * Filters a list to only visible tab items.
     *
     * @param {Element[]} items - Tab buttons or panels.
     * @returns {Element[]}
     */
    const getVisibleItems = (items) => items.filter(isTabVisible)

    let visibleButtonItems = getVisibleItems(buttonItems)
    let visiblePanelItems = getVisibleItems(panelItems)
    let activeButton = visibleButtonItems[0] || buttonItems[0]

    /**
     * Finds the subcategory panel linked to a tab button.
     *
     * @param {Element | undefined} button - Tab button with `data-tab-subcategory="button"`.
     * @returns {Element | null | undefined}
     */
    const getSubcategoryPanelForButton = (button) => {
      if (button?.getAttribute("data-tab-subcategory") !== "button") return null

      const categoryLink = button.getAttribute("data-category-link")
      if (categoryLink) {
        return panelItems.find((panel) => panel.dataset.tabCategoryLink === categoryLink)
      }

      return panelItems.find(
        (panel) =>
          panel.classList.contains("is-active") &&
          panel.getAttribute("data-tab-subcategory") === "panel"
      )
    }

    /**
     * Returns whether this step requires a subcategory checkbox selection.
     *
     * @param {Element | undefined} button - Tab button to check.
     * @returns {boolean}
     */
    const isSubcategorySelectionRequiredFor = (button) =>
      button?.getAttribute("data-tab-subcategory") === "button"

    /**
     * Returns whether the user has selected at least one subcategory option.
     *
     * @param {Element | undefined} button - Tab button for the subcategory step.
     * @returns {boolean}
     */
    const hasSubcategorySelectionFor = (button) => {
      const panel = getSubcategoryPanelForButton(button)
      if (!panel) return true

      const form = panel.querySelector('[data-quiz-form="subcategories"]')
      if (!form) return false

      return Boolean(
        form.querySelector('input[type="checkbox"]:checked') ||
        form.querySelector("input:checked") ||
        form.querySelector(".w-checkbox-input.w--redirected-checked") ||
        form.querySelector(".quiz-checkbox_box.w--redirected-checked")
      )
    }

    const categoryForm = tabWrap.querySelector('[data-quiz-form="categories"]')

    /**
     * Returns whether no category checkboxes are selected on the needs step.
     *
     * @returns {boolean}
     */
    const isCategorySelectionMissing = () => {
      if (!categoryForm) return false
      return !categoryForm.querySelector("[data-category-value]:checked")
    }

    /**
     * Returns whether the given button is the first tab (needs step).
     *
     * @param {Element} [button=activeButton] - Tab button to check.
     * @returns {boolean}
     */
    const isOnNeedsStep = (button = activeButton) => button === buttonItems[0]

    /**
     * Returns whether nav is blocked because no categories are selected.
     *
     * @returns {boolean}
     */
    const isCategoryNavGated = () => {
      if (previousWrap?.hasAttribute("data-nav-disabled")) return true
      if (!categoryForm) return false
      return isOnNeedsStep() && isCategorySelectionMissing()
    }

    /**
     * Returns whether nav is blocked because subcategories are not selected.
     *
     * @param {Element | undefined} button - Tab button for the current step.
     * @returns {boolean}
     */
    const isSubcategoryNavGatedFor = (button) =>
      isSubcategorySelectionRequiredFor(button) && !hasSubcategorySelectionFor(button)

    /**
     * Updates tab link accessibility when nav is gated.
     *
     * Blocks all tab links when categories are missing. Blocks only
     * forward tabs when subcategories are missing on the current step.
     *
     * @param {Element} [button=activeButton] - Currently active tab button.
     */
    const updateTabButtonsAccessibility = (button = activeButton) => {
      const currentIndex = visibleButtonItems.indexOf(button)
      const isCategoryGated = isCategoryNavGated()
      const isSubcategoryGated = isSubcategoryNavGatedFor(button)

      buttonItems.forEach((btn) => {
        const visibleIndex = visibleButtonItems.indexOf(btn)
        const isForwardTab = currentIndex !== -1 && visibleIndex > currentIndex
        const isForwardBlocked = isSubcategoryGated && isForwardTab
        const isFullyBlocked = isCategoryGated

        btn.toggleAttribute("data-tab-forward-disabled", isForwardBlocked)
        btn.setAttribute(
          "aria-disabled",
          isFullyBlocked || isForwardBlocked ? "true" : "false"
        )
        btn.setAttribute(
          "tabindex",
          isFullyBlocked || isForwardBlocked ? "-1" : btn.classList.contains("is-active") ? "0" : "-1"
        )
      })
    }

    /**
     * Returns whether a tab link click should be blocked.
     *
     * @param {Element} btn - Tab button that was clicked.
     * @returns {boolean}
     */
    const isTabLinkClickBlocked = (btn) => {
      if (isCategoryNavGated()) return true

      const visibleIndex = visibleButtonItems.indexOf(btn)
      const currentIndex = visibleButtonItems.indexOf(activeButton)
      if (visibleIndex === -1 || currentIndex === -1) return false

      return isSubcategoryNavGatedFor(activeButton) && visibleIndex > currentIndex
    }

    /**
     * Sets the Webflow button theme on a nav wrapper.
     *
     * @param {Element | null | undefined} wrap - Previous or Next wrapper.
     * @param {string} theme - Theme value, e.g. `"white"` or `"disabled"`.
     */
    const setNavButtonTheme = (wrap, theme) => {
      if (!wrap) return
      wrap.setAttribute("data-button-theme", theme)
    }

    /**
     * Enables or disables Previous/Next and updates tab link states.
     *
     * @param {number} visibleIndex - Index of the active tab in the visible list.
     * @param {Element} [button=activeButton] - Currently active tab button.
     */
    const updateNavState = (visibleIndex, button = activeButton) => {
      const isPrevDisabled = visibleIndex === 0 && !loopControls
      const isNextDisabled = visibleIndex === visibleButtonItems.length - 1 && !loopControls
      const isCategoryGated = isCategoryNavGated()
      const isSubcategoryGated = isSubcategoryNavGatedFor(button)

      if (previousButton) {
        previousButton.disabled = isCategoryGated || isPrevDisabled
      }
      if (nextButton) {
        nextButton.disabled = isCategoryGated || isSubcategoryGated || isNextDisabled
      }

      if (previousWrap) {
        previousWrap.removeAttribute("data-subcategory-nav-disabled")
        setNavButtonTheme(
          previousWrap,
          isCategoryGated || isPrevDisabled ? "disabled" : "white"
        )
      }
      if (nextWrap) {
        nextWrap.toggleAttribute("data-subcategory-nav-disabled", isSubcategoryGated)
        setNavButtonTheme(
          nextWrap,
          isCategoryGated || isSubcategoryGated || isNextDisabled ? "disabled" : "white"
        )
        nextWrap.style.removeProperty("pointer-events")
      }

      tabWrap.toggleAttribute("data-disable-tab-buttons", isCategoryGated)
      updateTabButtonsAccessibility(button)
    }

    /**
     * Activates the tab at the given index and shows its panel.
     *
     * @param {number} index - Index in the visible tab list.
     * @param {boolean} [focus=false] - Move keyboard focus to the tab button.
     * @param {boolean} [animate=true] - Run GSAP transition when available.
     */
    const makeActive = (index, focus = false, animate = true) => {
      if (animating) return
      if (index < 0 || index >= visibleButtonItems.length) return

      const previousActiveButton = activeButton
      const previousPanel = panelItems.find((panel) => panel.classList.contains("is-active"))
      const currentButton = visibleButtonItems[index]
      const currentPanel = visiblePanelItems[index]

      if (!currentButton || !currentPanel) return

      buttonItems.forEach((btn) => {
        const isActive = btn === currentButton
        btn.classList.toggle("is-active", isActive)
        btn.setAttribute("aria-selected", isActive ? "true" : "false")
        btn.setAttribute("tabindex", isActive ? "0" : "-1")
      })

      panelItems.forEach((panel) => {
        panel.classList.toggle("is-active", panel === currentPanel)
      })

      activeButton = currentButton
      updateNavState(index, currentButton)
      if (focus) currentButton.focus()

      const previousIndex = visibleButtonItems.indexOf(previousActiveButton)
      let direction = 1
      if (previousIndex > index) direction = -1

      if (typeof gsap !== "undefined" && animate && previousActiveButton !== currentButton) {
        if (autoplayTl && !canPlay && typeof autoplayTl.restart === "function") {
          autoplayTl.restart()
        }
        resetPanelContentStyles(currentPanel)
        animating = true
        const tl = gsap.timeline({
          onComplete: () => {
            animating = false
            if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh()
          },
          defaults: { duration, ease: "power1.out" },
        })
        if (slideTabs) {
          tl.set(currentPanel, { display: "block", position: "relative" })
          if (previousPanel) tl.set(previousPanel, { position: "absolute", top: 0, left: 0, width: "100%" })
          if (previousPanel) tl.fromTo(previousPanel, { xPercent: 0 }, { xPercent: -120 * direction })
          tl.fromTo(currentPanel, { xPercent: 120 * direction }, { xPercent: 0 }, "<")
          if (previousPanel) tl.set(previousPanel, { display: "none" })
        } else {
          if (previousPanel) tl.to(previousPanel, { opacity: 0 })
          if (previousPanel) tl.set(previousPanel, { display: "none" })
          tl.set(currentPanel, { display: "block" })
          tl.fromTo(currentPanel, { opacity: 0 }, { opacity: 1 })
        }
      } else {
        panelItems.forEach((panel) => {
          if (panel === currentPanel) {
            resetPanelContentStyles(panel)
            panel.style.display = "block"
            return
          }
          panel.style.display = "none"
        })
      }

      buttonList.scrollTo({ left: currentButton.offsetLeft, behavior: "smooth" })
    }

    /**
     * Recalculates visible tabs after category filters change.
     * Called by `quiz-tabs-subcategories-js.html` via `_quizTabController.refresh()`.
     */
    const refreshTabs = () => {
      visibleButtonItems = getVisibleItems(buttonItems)
      visiblePanelItems = getVisibleItems(panelItems)

      if (!visibleButtonItems.includes(activeButton)) {
        activeButton = visibleButtonItems[0] || buttonItems[0]
      }

      const newIndex = visibleButtonItems.indexOf(activeButton)
      makeActive(newIndex >= 0 ? newIndex : 0, false, false)
    }

    /**
     * Moves to the next or previous visible tab.
     *
     * @param {number} delta - `1` for next, `-1` for previous.
     * @param {boolean} [focus=false] - Move keyboard focus to the new tab.
     */
    const updateIndex = (delta, focus = false) => {
      const currentIndex = visibleButtonItems.indexOf(activeButton)
      if (currentIndex === -1) return
      if (isCategoryNavGated()) return
      if (delta > 0 && isSubcategoryNavGatedFor(activeButton)) return
      const nextIndex = (currentIndex + delta + visibleButtonItems.length) % visibleButtonItems.length
      makeActive(nextIndex, focus, true)
    }

    /**
     * Blocks Continue when category or subcategory selection is required.
     *
     * @param {Event} event - Click event on the Next wrapper.
     */
    const handleNextClick = (event) => {
      if (isCategoryNavGated() || isSubcategoryNavGatedFor(activeButton)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      updateIndex(1)
    }

    nextWrap?.addEventListener("click", handleNextClick, true)
    previousButton?.addEventListener("click", () => updateIndex(-1))

    buttonList.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tab-component='button']")
      if (!btn || !buttonList.contains(btn)) return
      if (isTabLinkClickBlocked(btn)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const visibleIndex = visibleButtonItems.indexOf(btn)
      if (visibleIndex === -1) return
      makeActive(visibleIndex)
    })

    buttonList.addEventListener("keydown", (event) => {
      const btn = event.target.closest("[data-tab-component='button']")
      if (!btn || !visibleButtonItems.includes(btn)) return
      if (isTabLinkClickBlocked(btn) && ["Enter", " "].includes(event.key)) {
        event.preventDefault()
        return
      }
      if (["ArrowRight", "ArrowDown"].includes(event.key)) updateIndex(1, true)
      else if (["ArrowLeft", "ArrowUp"].includes(event.key)) updateIndex(-1, true)
    })

    categoryForm?.addEventListener("change", () => {
      const visibleIndex = visibleButtonItems.indexOf(activeButton)
      updateNavState(visibleIndex >= 0 ? visibleIndex : 0, activeButton)
    })

    tabWrap.querySelectorAll('[data-quiz-form="subcategories"]').forEach((form) => {
      form.addEventListener("change", () => {
        const visibleIndex = visibleButtonItems.indexOf(activeButton)
        updateNavState(visibleIndex >= 0 ? visibleIndex : 0, activeButton)
      })
      form.addEventListener("click", () => {
        window.requestAnimationFrame(() => {
          const visibleIndex = visibleButtonItems.indexOf(activeButton)
          updateNavState(visibleIndex >= 0 ? visibleIndex : 0, activeButton)
        })
      })
    })

    const tabId = (tabWrap.getAttribute("data-tab-component-id") || String(componentIndex + 1))
      .toLowerCase()
      .replaceAll(" ", "-")

    buttonItems.forEach((btn, index) => {
      const itemId = (btn.getAttribute("data-tab-item-id") || String(index + 1))
        .toLowerCase()
        .replaceAll(" ", "-")

      btn.setAttribute("id", "tab-button-" + tabId + "-" + itemId)
      btn.setAttribute("aria-controls", "tab-panel-" + tabId + "-" + itemId)
      panelItems[index]?.setAttribute("id", "tab-panel-" + tabId + "-" + itemId)
      panelItems[index]?.setAttribute("aria-labelledby", btn.id)

      if (new URLSearchParams(location.search).get("tab-id") === tabId + "-" + itemId) {
        activeButton = btn
        autoplay = 0
        tabWrap.scrollIntoView({ behavior: "smooth", block: "start" })
        history.replaceState(
          {},
          "",
          ((url) => (url.searchParams.delete("tab-id"), url))(new URL(location.href))
        )
      }
    })

    /**
     * Public API used by other quiz scripts.
     *
     * @type {{ refresh: () => void, syncNavState: () => void }}
     */
    tabWrap._quizTabController = {
      /** Rebuilds the visible tab list after category filters change. */
      refresh: refreshTabs,
      /** Re-runs nav and tab link gating for the current step. */
      syncNavState: () => {
        const visibleIndex = visibleButtonItems.indexOf(activeButton)
        updateNavState(visibleIndex >= 0 ? visibleIndex : 0, activeButton)
      },
    }

    const hasCategoryForm = Boolean(
      tabWrap.querySelector('[data-quiz-form="categories"]')
    )
    if (hasCategoryForm) {
      activeButton = buttonItems[0]
      const initIndex = visibleButtonItems.indexOf(activeButton)
      if (initIndex >= 0) makeActive(initIndex, false, false)
    } else {
      refreshTabs()
    }

    /** Autoplay: advances tabs on a timer when enabled and not paused. */
    if (autoplay !== 0 && typeof gsap !== "undefined") {
      autoplayTl = gsap.timeline({ repeat: -1 }).fromTo(
        tabWrap,
        { "--progress": 0 },
        {
          onComplete: () => updateIndex(1, false),
          "--progress": 1,
          ease: "none",
          duration: autoplay,
        }
      )
      let isHovered = false
      let hasFocusInside = false
      let prefersReducedMotion = false
      let inView = true
      const updateAuto = () => {
        if (prefersReducedMotion || !inView || canPlay || isHovered || hasFocusInside) autoplayTl.pause()
        else autoplayTl.play()
      }
      const setButton = () => {
        canPlay = !canPlay
        toggleButton?.setAttribute("aria-pressed", !canPlay ? "true" : "false")
        toggleWrap?.classList.toggle("is-pressed", !canPlay)
        if (!canPlay) isHovered = hasFocusInside = prefersReducedMotion = false
        updateAuto()
      }
      setButton()
      toggleButton?.addEventListener("click", setButton)
      const handleMotionChange = (event) => {
        prefersReducedMotion = event.matches
        updateAuto()
        canPlay = !event.matches
        setButton()
      }
      handleMotionChange(window.matchMedia("(prefers-reduced-motion: reduce)"))
      window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", handleMotionChange)
      if (pauseOnHover) tabWrap.addEventListener("mouseenter", () => { isHovered = true; updateAuto() })
      if (pauseOnHover) tabWrap.addEventListener("mouseleave", () => { hasFocusInside = false; isHovered = false; updateAuto() })
      tabWrap.addEventListener("focusin", () => { hasFocusInside = true; updateAuto() })
      tabWrap.addEventListener("focusout", (event) => {
        if (!event.relatedTarget || !tabWrap.contains(event.relatedTarget)) {
          hasFocusInside = false
          updateAuto()
        }
      })
      new IntersectionObserver((entries) => { inView = entries[0].isIntersecting; updateAuto() }, { threshold: 0 }).observe(tabWrap)
    }
  })
})
