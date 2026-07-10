// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/tabs
/**
 * Global tab component — attribute-driven tabs for multi-step forms and layouts.
 *
 * Inits every `[data-tab-component="wrapper"]`. Style with Webflow classes;
 * JS reads only `data-*` hooks.
 *
 * Required:
 * - `[data-tab-component="button-list"]` — direct children are tab buttons
 * - `[data-tab-component="panel-list"]` — direct children are tab panels
 *
 * Prev/next placement (`data-tab-nav` on wrapper):
 * - `"global"` — shared `[data-tab-component="nav"]` outside panels
 * - `"panel"` — prev/next inside each panel (or per-panel `[data-tab-component="nav"]`)
 *
 * Prev/next wrappers: `[data-tab="previous"]` / `[data-tab="next"]` (Webflow button components).
 * When disabled, JS sets `data-button-theme="disabled"` on the wrapper.
 *
 * Optional `data-tab-lock-links="True"` on wrapper — tab links stay disabled until
 * reached via the Next button; once unlocked, back-and-forth navigation is allowed.
 *
 * Optional `data-validate-tabs="True"` on wrapper — the active panel's Next control
 * stays disabled (`data-button-theme="disabled"`) until every `required` field in
 * that panel passes. `<input>` fields also respect native format rules (`type`,
 * `pattern`, `min`, `max`, `step`, etc.). Invalid inputs get
 * `data-tab-field-invalid="true"` (red outline via tab-component-css.html) after
 * blur or when Next is clicked while blocked. Put `data-validate-ignore` on a
 * field or a wrapping group to exempt it; hidden required fields are skipped
 * automatically.
 */
document.addEventListener("DOMContentLoaded", function () {
  /** @type {string} Theme applied while a nav control is disabled. */
  const DISABLED_THEME = "disabled"

  /** @type {string} Fallback theme when none is stored on the wrapper. */
  const DEFAULT_THEME = "black"

  /** @type {string} Marks an input that failed validation (styled in CSS). */
  const INVALID_FIELD_ATTR = "data-tab-field-invalid"

  /** @type {string} Set after the user interacts with a field; gates error UI. */
  const TOUCHED_FIELD_ATTR = "data-tab-validate-touched"

  /** Webflow-style boolean attrs use `"True"`; accept common variants. */
  const isAttrTrue = (value) => typeof value === "string" && value.toLowerCase() === "true"

  /** Skips decorative slots that should not participate in tab indexing. */
  const isTabSlotItem = (el) => !isAttrTrue(el.getAttribute("data-tab-component-skip"))

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
   * Whether a field is hidden somewhere between itself and the panel root —
   * `display:none` / `visibility:hidden` / `[hidden]` / Webflow conditional
   * visibility. Hidden required fields shouldn't gate Next. Walk stops at the
   * panel so an unopened modal ancestor doesn't mark everything hidden.
   */
  const isHiddenField = (field, panel) => {
    let el = field
    while (el) {
      if (el === panel) break
      if (el.hasAttribute("hidden") || el.classList.contains("w-condition-invisible")) return true
      const style = getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden") return true
      el = el.parentElement
    }
    return false
  }

  /**
   * Required, validatable fields in a panel. Skips disabled and hidden fields
   * (see isHiddenField) and anything inside (or carrying) `data-validate-ignore`
   * — put that attribute on a single input or a wrapper to exempt a group.
   */
  const getRequiredFields = (panel) =>
    [...panel.querySelectorAll("input, select, textarea")].filter((field) => {
      if (field.disabled || field.closest("[data-validate-ignore]")) return false
      const type = (field.getAttribute("type") || "").toLowerCase()
      if (type === "hidden" || type === "submit" || type === "button") return false
      if (isHiddenField(field, panel)) return false
      return isFieldRequired(field)
    })

  /** Input types that skip value/format validation (handled separately). */
  const NON_VALUE_INPUT_TYPES = new Set(["hidden", "submit", "button", "checkbox", "radio", "file"])

  /**
   * Whether an input should run value/format checks — required fields, or optional
   * fields the user has started filling in.
   */
  const shouldValidateInputValue = (input) => {
    const value = input.value?.trim() ?? ""
    return isFieldRequired(input) || Boolean(value)
  }

  /**
   * Value/format validation for a single field. `<input>` only today; extend here
   * for select, textarea, or custom widgets.
   */
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

  /** Whether every required field in a panel passes. Panels with none pass. */
  const isPanelValid = (panel) => {
    if (!panel) return true
    const fields = getRequiredFields(panel)
    if (!fields.length) return true

    const radioGroups = new Set()
    fields.forEach((field) => {
      if (field.type === "radio" && field.name) radioGroups.add(field.name)
    })
    for (const name of radioGroups) {
      const radios = [...panel.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)].filter(
        (radio) => !radio.disabled && !radio.closest("[data-validate-ignore]")
      )
      if (!radios.some((radio) => isRadioChecked(radio))) return false
    }

    for (const field of fields) {
      if (field.type === "radio" && field.name) continue
      if (!isRequiredFieldValid(field)) return false
    }

    /** Optional inputs with content must also pass format rules. */
    const optionalInputs = [...panel.querySelectorAll("input")].filter((input) => {
      if (input.disabled || input.closest("[data-validate-ignore]")) return false
      const type = (input.getAttribute("type") || "text").toLowerCase()
      if (NON_VALUE_INPUT_TYPES.has(type)) return false
      if (isHiddenField(input, panel)) return false
      if (isFieldRequired(input)) return false
      return Boolean(input.value?.trim())
    })
    for (const input of optionalInputs) {
      if (!isFieldValueValid(input)) return false
    }

    return true
  }

  /**
   * Inputs in a panel that can show invalid styling. `<input>` only for now.
   * @param {HTMLElement} panel
   * @returns {HTMLInputElement[]}
   */
  const getInvalidatableInputs = (panel) =>
    [...panel.querySelectorAll("input")].filter((input) => {
      if (input.disabled || input.closest("[data-validate-ignore]")) return false
      const type = (input.getAttribute("type") || "text").toLowerCase()
      if (NON_VALUE_INPUT_TYPES.has(type)) return false
      if (isHiddenField(input, panel)) return false
      return shouldValidateInputValue(input)
    })

  /** Syncs `data-tab-field-invalid` on inputs after validation runs. */
  const updateFieldInvalidStates = (panel, { forceShow = false } = {}) => {
    if (!panel) return
    getInvalidatableInputs(panel).forEach((input) => {
      const isInvalid = !isFieldValueValid(input)
      const showInvalid =
        isInvalid && (forceShow || input.hasAttribute(TOUCHED_FIELD_ATTR))
      if (showInvalid) input.setAttribute(INVALID_FIELD_ATTR, "true")
      else input.removeAttribute(INVALID_FIELD_ATTR)
    })
  }

  /** Marks a field as touched so invalid styling may appear. */
  const markFieldTouched = (field) => {
    if (!(field instanceof HTMLInputElement)) return
    field.setAttribute(TOUCHED_FIELD_ATTR, "true")
  }

  document.querySelectorAll("[data-tab-component='wrapper']").forEach((tabWrap, componentIndex) => {
    if (tabWrap.dataset.tabComponentInited) return
    tabWrap.dataset.tabComponentInited = "true"

    const loopControls = isAttrTrue(tabWrap.getAttribute("data-loop-controls"))
    const lockTabLinks = isAttrTrue(tabWrap.getAttribute("data-tab-lock-links"))
    const validateTabs = isAttrTrue(tabWrap.getAttribute("data-validate-tabs"))
    const slideTabs = isAttrTrue(tabWrap.getAttribute("data-slide-tabs"))
    const pauseOnHover = isAttrTrue(tabWrap.getAttribute("data-pause-on-hover"))
    let autoplay = Number(tabWrap.getAttribute("data-autoplay-duration")) || 0
    const duration = Number(tabWrap.getAttribute("data-duration")) || 0.3
    const buttonList = tabWrap.querySelector("[data-tab-component='button-list']")
    const panelList = tabWrap.querySelector("[data-tab-component='panel-list']")
    const toggleWrap = tabWrap.querySelector("[data-tab-button='toggle']")
    const toggleButton = tabWrap.querySelector("[data-tab-button='toggle'] button")

    const navModeAttr = tabWrap.getAttribute("data-tab-nav")
    const panelNavRoots = panelList
      ? Array.from(panelList.children).flatMap((panel) =>
          Array.from(panel.querySelectorAll("[data-tab-component='nav']"))
        )
      : []
    const globalNavRoot = tabWrap.querySelector(
      ":scope > [data-tab-component='nav'], :scope > * > [data-tab-component='nav'], :scope > * > * > [data-tab-component='nav']"
    )
    const navMode =
      navModeAttr === "global" || navModeAttr === "panel"
        ? navModeAttr
        : panelNavRoots.length
          ? "panel"
          : globalNavRoot
            ? "global"
            : "panel"

    let animating = false
    let canPlay = true
    let autoplayTl

    /** Unwraps Webflow `display-contents` / `u-display-contents` layers. */
    const flattenDisplayContents = (slot) => {
      if (!slot) return
      let child = slot.firstElementChild
      while (
        child &&
        (child.classList.contains("u-display-contents") ||
          child.classList.contains("display-contents"))
      ) {
        while (child.firstChild) {
          slot.insertBefore(child.firstChild, child)
        }
        slot.removeChild(child)
        child = slot.firstElementChild
      }
    }

    flattenDisplayContents(buttonList)
    flattenDisplayContents(panelList)

    /** Hoists CMS collection items into the tab slot. */
    const removeCMSList = (slot) => {
      const dynList = Array.from(slot.children).find((child) =>
        child.classList.contains("w-dyn-list")
      )
      if (!dynList) return
      const nestedItems = dynList?.querySelector(".w-dyn-items")?.children
      if (!nestedItems) return
      const staticWrapper = [...slot.children]
      ;[...nestedItems].forEach((el) => {
        const c = [...el.children].find((child) => !child.classList.contains("w-condition-invisible"))
        if (c) slot.appendChild(c)
      })
      staticWrapper.forEach((el) => el.remove())
    }

    removeCMSList(buttonList)
    removeCMSList(panelList)

    const buttonItems = Array.from(buttonList?.children || []).filter(isTabSlotItem)
    const panelItems = Array.from(panelList?.children || []).filter(isTabSlotItem)

    if (!buttonList || !panelList || !buttonItems.length || !panelItems.length) {
      console.warn("Missing tab elements in:", tabWrap)
      return
    }

    if (buttonItems.length !== panelItems.length) {
      console.warn(
        "Tab button/panel count mismatch:",
        buttonItems.length,
        "buttons vs",
        panelItems.length,
        "panels in",
        tabWrap
      )
    }

    panelItems.forEach((panel) => {
      panel.style.display = "none"
      panel.setAttribute("role", "tabpanel")
      panel.setAttribute("data-tab-active", "false")
    })

    panelList.removeAttribute("role")
    buttonList.setAttribute("role", "tablist")
    buttonItems.forEach((btn) => {
      btn.setAttribute("role", "tab")
      btn.setAttribute("data-tab-active", "false")
    })

    /** Returns prev/next wrappers and buttons inside a nav root or panel. */
    const getNavControls = (root) => ({
      previousWrap:
        root?.querySelector("[data-tab='previous'], [data-tab='prev']") || null,
      nextWrap: root?.querySelector("[data-tab='next']") || null,
      previous:
        root?.querySelector("[data-tab='previous'] button, [data-tab='prev'] button") ||
        null,
      next: root?.querySelector("[data-tab='next'] button") || null,
    })

    const globalNav = getNavControls(globalNavRoot)
    const panelNavSets = panelItems.map((panel) => ({
      panel,
      ...getNavControls(panel.querySelector("[data-tab-component='nav']") || panel),
    }))

    /** Stores the Webflow button theme before toggling disabled state. */
    const storeOriginalTheme = (wrap) => {
      if (!wrap || wrap.dataset.tabOriginalTheme) return
      const currentTheme = wrap.getAttribute("data-button-theme")
      wrap.dataset.tabOriginalTheme =
        currentTheme && currentTheme !== DISABLED_THEME ? currentTheme : DEFAULT_THEME
    }

    /** Enables/disables a prev/next control and syncs `data-button-theme`. */
    const setNavControlState = (wrap, button, disabled) => {
      if (!wrap) return
      storeOriginalTheme(wrap)

      const originalTheme = wrap.dataset.tabOriginalTheme || DEFAULT_THEME

      if (disabled) {
        wrap.setAttribute("data-button-theme", DISABLED_THEME)
        wrap.setAttribute("data-tab-nav-disabled", "true")
      } else {
        wrap.setAttribute("data-button-theme", originalTheme)
        wrap.removeAttribute("data-tab-nav-disabled")
      }

      if (!button) return

      button.disabled = disabled
      button.setAttribute("aria-disabled", disabled ? "true" : "false")
    }

    let activeIndex = 0
    /** Highest tab index unlocked via Next (only used when `data-tab-lock-links="True"`). */
    let furthestReachedIndex = 0

    /**
     * Brings the active tab into the button-list viewport. Centers it when there's
     * room, but clamps to the scroll bounds so the first/last tabs rest naturally
     * at the edges (with the list's padding as breathing room) instead of
     * over-scrolling and clipping the active highlight. No-op when nothing scrolls.
     */
    const scrollActiveIntoView = (btn) => {
      if (!buttonList || typeof btn?.getBoundingClientRect !== "function") return
      const maxScroll = buttonList.scrollWidth - buttonList.clientWidth
      if (maxScroll <= 0) return
      const listRect = buttonList.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      // Where the button sits relative to the list's current scroll position.
      const btnStart = btnRect.left - listRect.left + buttonList.scrollLeft
      // Scroll so the button's center lines up with the viewport's center.
      const centered = btnStart + btnRect.width / 2 - buttonList.clientWidth / 2
      const target = Math.max(0, Math.min(centered, maxScroll))
      if (Math.abs(target - buttonList.scrollLeft) > 1) {
        buttonList.scrollTo({ left: target, behavior: "smooth" })
      }
    }

    /** Syncs locked/unlocked state on tab link buttons. */
    const updateTabLinkStates = (activeIdx) => {
      buttonItems.forEach((btn, i) => {
        const isLocked = lockTabLinks && i > furthestReachedIndex

        if (isLocked) {
          btn.setAttribute("data-tab-link-disabled", "true")
          btn.setAttribute("aria-disabled", "true")
          btn.setAttribute("tabindex", "-1")
          return
        }

        btn.removeAttribute("data-tab-link-disabled")
        btn.setAttribute("aria-disabled", "false")
        btn.setAttribute("tabindex", i === activeIdx ? "0" : "-1")
      })
    }

    /** Enables/disables prev/next for the active step. */
    const updateNavState = (index) => {
      const isPrevDisabled = index === 0 && !loopControls
      const isNextDisabled = index === buttonItems.length - 1 && !loopControls
      const blockNext = validateTabs && !isPanelValid(panelItems[index])

      if (navMode === "panel") {
        panelNavSets.forEach(({ panel, previousWrap, nextWrap, previous, next }, i) => {
          const isActivePanel = i === index
          setNavControlState(previousWrap, previous, !isActivePanel || isPrevDisabled)
          setNavControlState(nextWrap, next, !isActivePanel || isNextDisabled || blockNext)
        })
        return
      }

      setNavControlState(globalNav.previousWrap, globalNav.previous, isPrevDisabled)
      setNavControlState(globalNav.nextWrap, globalNav.next, isNextDisabled || blockNext)
    }

    const makeActive = (index, focus = false, animate = true) => {
      if (animating) return
      if (index < 0 || index >= buttonItems.length) return

      buttonItems.forEach((btn, i) => {
        const isActive = i === index
        btn.setAttribute("data-tab-active", isActive ? "true" : "false")
        btn.setAttribute("aria-selected", isActive ? "true" : "false")
        btn.classList.toggle("is-active", isActive)
      })

      panelItems.forEach((panel, i) => {
        const isActive = i === index
        panel.setAttribute("data-tab-active", isActive ? "true" : "false")
        panel.classList.toggle("is-active", isActive)
      })

      updateTabLinkStates(index)
      if (focus) buttonItems[index].focus()

      const previousPanel = panelItems[activeIndex]
      const currentPanel = panelItems[index]
      let direction = 1
      if (activeIndex > index) direction = -1

      if (typeof gsap !== "undefined" && animate && activeIndex !== index) {
        if (autoplayTl && !canPlay && typeof autoplayTl.restart === "function") {
          autoplayTl.restart()
        }
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
        if (previousPanel) previousPanel.style.display = "none"
        if (currentPanel) currentPanel.style.display = "block"
      }

      updateNavState(index)
      scrollActiveIntoView(buttonItems[index])
      activeIndex = index
    }

    makeActive(0, false, false)

    if (validateTabs) {
      const revalidate = () => {
        updateNavState(activeIndex)
        updateFieldInvalidStates(panelItems[activeIndex])
      }
      panelList.addEventListener("input", (event) => {
        const target = event.target
        if (target instanceof HTMLInputElement) markFieldTouched(target)
        revalidate()
      })
      panelList.addEventListener("change", (event) => {
        const target = event.target
        if (target instanceof HTMLInputElement) markFieldTouched(target)
        revalidate()
      })
      panelList.addEventListener(
        "blur",
        (event) => {
          const target = event.target
          if (!(target instanceof HTMLInputElement)) return
          markFieldTouched(target)
          updateFieldInvalidStates(panelItems[activeIndex])
        },
        true
      )
      panelList.addEventListener("click", () => requestAnimationFrame(revalidate))
      tabWrap.addEventListener(
        "pointerdown",
        (event) => {
          const target = event.target instanceof Element ? event.target : null
          const nextWrap = target?.closest("[data-tab='next']")
          if (!nextWrap || !tabWrap.contains(nextWrap)) return
          if (!nextWrap.hasAttribute("data-tab-nav-disabled")) return
          updateFieldInvalidStates(panelItems[activeIndex], { forceShow: true })
        },
        true
      )
      const validationObserver = new MutationObserver(revalidate)
      panelList.querySelectorAll(".w-checkbox-input, .w-radio-input").forEach((el) =>
        validationObserver.observe(el, { attributes: true, attributeFilter: ["class"] })
      )
    }

    /** Resolves the target index for a step, respecting bounds and link lock. */
    const getStepIndex = (from, delta, { allowUnlockStep = false } = {}) => {
      if (loopControls) {
        return (from + delta + buttonItems.length) % buttonItems.length
      }

      const next = from + delta
      if (next < 0 || next >= buttonItems.length) return from
      if (lockTabLinks && delta > 0 && !allowUnlockStep && next > furthestReachedIndex) {
        return from
      }
      return next
    }

    /**
     * Steps to another tab by delta.
     * @param {number} delta - Direction (+1 next, -1 prev).
     * @param {boolean} [focus=false] - Move focus to the tab button.
     * @param {{ unlockLinks?: boolean }} [options] - Unlock forward links when stepping via Next.
     */
    const updateIndex = (delta, focus = false, { unlockLinks = false } = {}) => {
      const newIndex = getStepIndex(activeIndex, delta, { allowUnlockStep: unlockLinks })
      if (newIndex === activeIndex) return

      if (lockTabLinks && unlockLinks && delta > 0) {
        furthestReachedIndex = Math.max(furthestReachedIndex, newIndex)
      }

      makeActive(newIndex, focus, true)
    }

    /** Delegates prev/next clicks from any nav placement. */
    tabWrap.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return

      const prevWrap = target.closest("[data-tab='previous'], [data-tab='prev']")
      const nextWrap = target.closest("[data-tab='next']")
      if (!prevWrap && !nextWrap) return
      if (!tabWrap.contains(prevWrap || nextWrap)) return

      if (prevWrap && prevWrap.contains(target)) {
        if (prevWrap.hasAttribute("data-tab-nav-disabled")) return
        event.preventDefault()
        updateIndex(-1)
        return
      }

      if (nextWrap && nextWrap.contains(target)) {
        if (nextWrap.hasAttribute("data-tab-nav-disabled")) return
        event.preventDefault()
        updateIndex(1, false, { unlockLinks: true })
      }
    })

    buttonItems.forEach((btn, index) => {
      const tabId = (tabWrap.getAttribute("data-tab-component-id") || String(componentIndex + 1))
        .toLowerCase()
        .replaceAll(" ", "-")
      const itemId = (btn.getAttribute("data-tab-item-id") || String(index + 1))
        .toLowerCase()
        .replaceAll(" ", "-")

      btn.setAttribute("id", "tab-button-" + tabId + "-" + itemId)
      btn.setAttribute("aria-controls", "tab-panel-" + tabId + "-" + itemId)
      panelItems[index]?.setAttribute("id", "tab-panel-" + tabId + "-" + itemId)
      panelItems[index]?.setAttribute("aria-labelledby", btn.id)

      if (new URLSearchParams(location.search).get("tab-id") === tabId + "-" + itemId) {
        if (lockTabLinks) furthestReachedIndex = Math.max(furthestReachedIndex, index)
        makeActive(index, false, false)
        autoplay = 0
        tabWrap.scrollIntoView({ behavior: "smooth", block: "start" })
        history.replaceState(
          {},
          "",
          ((url) => (url.searchParams.delete("tab-id"), url))(new URL(location.href))
        )
      }

      btn.addEventListener("click", () => {
        if (lockTabLinks && index > furthestReachedIndex) return
        makeActive(index)
      })
      btn.addEventListener("keydown", (event) => {
        if (["ArrowRight", "ArrowDown"].includes(event.key)) updateIndex(1, true)
        else if (["ArrowLeft", "ArrowUp"].includes(event.key)) updateIndex(-1, true)
      })
    })

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
        if (prefersReducedMotion || !inView || canPlay || isHovered || hasFocusInside) {
          autoplayTl.pause()
        } else {
          autoplayTl.play()
        }
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
      if (pauseOnHover) {
        tabWrap.addEventListener("mouseleave", () => {
          hasFocusInside = false
          isHovered = false
          updateAuto()
        })
      }

      tabWrap.addEventListener("focusin", () => { hasFocusInside = true; updateAuto() })
      tabWrap.addEventListener("focusout", (event) => {
        if (!event.relatedTarget || !tabWrap.contains(event.relatedTarget)) {
          hasFocusInside = false
          updateAuto()
        }
      })

      new IntersectionObserver((entries) => {
        inView = entries[0].isIntersecting
        updateAuto()
      }, { threshold: 0 }).observe(tabWrap)
    }

    tabWrap._tabController = {
      makeActive,
      updateNavState,
      updateTabLinkStates,
      getActiveIndex: () => activeIndex,
      getFurthestReachedIndex: () => furthestReachedIndex,
      /** Unlocks tab links up to and including `index`. */
      unlockTabLinksUpTo: (index) => {
        furthestReachedIndex = Math.max(furthestReachedIndex, index)
        updateTabLinkStates(activeIndex)
      },
    }
  })
})