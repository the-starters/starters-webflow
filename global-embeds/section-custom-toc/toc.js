// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/section-custom-toc
/**
 * Section table of contents — attribute-driven, auto-scrolling section nav.
 *
 * A horizontal bar of hand-authored links that tracks which page section is in
 * view, marks the matching link active, and scrolls that link into view inside
 * the bar. Any number of bars per page, zero per-page JS config. Style with
 * Webflow classes; JS reads only `data-*` hooks.
 *
 * Required:
 * - `[data-toc-element="wrapper"]` — the bar container; the horizontal scroller.
 *   Inits once per element, any number per page.
 * - `[data-toc-element="link"]` with `data-toc-id="<name>"` — a link inside the
 *   wrapper. Link text is authored in Webflow; JS never writes it.
 * - `[data-toc-section="<name>"]` — on page sections. Matches a link's
 *   `data-toc-id`. Sections may live anywhere in the document (they do not need
 *   to be siblings, or near the bar).
 *
 * Recommended:
 * - `[data-toc-element="list"]` — inner flex container holding the links, at any
 *   depth inside the wrapper. Required for the CSS centering opt-in (see toc.css
 *   and `data-toc-align` below). If absent, the wrapper is treated as the list and
 *   centering is unavailable.
 *
 * Navbar (measured automatically — no per-breakpoint config):
 * - `data-toc-navbar` on the site's navbar — recommended. Its height is added to
 *   the offset so sections never land underneath it. Tag as MANY bars as stack at
 *   the top of the page and their heights ADD UP: a profile header sitting under
 *   the site navbar is a second bar, and both must clear. With nothing tagged, the
 *   script falls back to Webflow's own `.w-nav` (a single element).
 * - Height AND position are re-measured on every scroll pass, so a navbar that is
 *   `fixed` on desktop but `static` on mobile, or hidden at some breakpoint, is
 *   handled for free — each tagged bar is judged on its own and only counts while
 *   it is `fixed`/`sticky` right now, and a hidden one measures 0.
 * - `data-toc-ignore-navbar` on a wrapper — leaves every navbar out of that bar's
 *   offset (pages with no navbar, or where it must not count). Present with any
 *   value means ON; only `="false"` turns it off. A wrapper that IS a tagged bar
 *   always skips it (its own height is already counted). A wrapper that sits INSIDE
 *   a tagged bar skips it only while the wrapper is itself sticky/fixed — that is the
 *   double-count. A static TOC strip inside a sticky bar (the profile pages: the
 *   strip is an inner div of the sticky profile header) counts that bar in full,
 *   because nothing else measures it.
 *
 * Optional:
 * - `data-toc-offset="<px>"` on the wrapper — EXTRA offset on top of the navbar,
 *   not a replacement for it. Default `0`. Used for both the click-scroll landing
 *   position and the scroll-spy line. The wrapper's own height is also added
 *   automatically when the wrapper itself is `position: sticky` or `fixed`.
 * - `data-toc-spy-zone="<0..0.8>"` on the wrapper — how far DOWN the free viewport
 *   the scroll-spy line sits, as a fraction of the space left below the chrome.
 *   Default `0.3`: a section takes the highlight once its top reaches 30% into the
 *   viewport, not the instant it slips under the bars. That is what makes a section
 *   filling the screen read as active while a hero still sitting above it does not.
 *   `0` puts the line right under the chrome (the old behavior). Values outside
 *   `0`–`0.8`, and anything unparseable, fall back to the default. SPY LINE ONLY —
 *   click-scroll landing is unaffected, sections still land right under the bars.
 * - `data-toc-align="center"` on the wrapper — centers the links while they fit
 *   the bar, falling back to a left-aligned scroller once they overflow. Pure CSS
 *   (see toc.css). Default (no attribute) is left-aligned, matching the
 *   filter-tabs embed.
 *
 * Written by JS:
 * - `data-toc-active="true"` on the active link (removed entirely from the
 *   others — never set to `"false"`). Style it in Webflow.
 *
 * Behavior notes:
 * - No link is active above the first section: while the top of every section is
 *   still below the spy line — a hero filling the screen with the first section
 *   underneath it — the bar shows no highlight, which is the honest answer. The
 *   highlight appears as soon as a section's top reaches the line, which sits 30%
 *   into the free viewport by default (`data-toc-spy-zone`), so a section that fills
 *   the screen reads as active well before it is scrolled past. Sections hidden by
 *   other scripts (a `display: none` REVIEWS panel emptied by hide-empty-sections)
 *   are ignored throughout and can never take the highlight.
 * - The bar only scrolls when the active link is NOT already fully visible inside
 *   it (2px slack). An overflowing bar therefore starts wherever it rests and stays
 *   put while the active link is on screen, then animates the link to center once it
 *   would fall out of view. Applies to clicks and scroll-spy alike.
 * - A link whose `data-toc-id` matches no section on the page is left completely
 *   alone (no `preventDefault`), so cross-page TOC links keep working.
 * - Clicking a link that does resolve smooth-scrolls the page and updates the URL
 *   hash via `history.replaceState` when the section has an `id` — never a native
 *   jump.
 * - Landing on the page with a `#hash` that points at a section (or into one) is
 *   re-anchored below the offset, since the browser's native jump ignores sticky
 *   chrome. Only while the page is still parked where the browser dropped it.
 * - Respects `prefers-reduced-motion: reduce` (instant scrolls).
 *
 * Multiple bars on one page:
 * Every wrapper computes its own spy line — `data-toc-offset` plus the navbar plus
 * its own height when it is itself sticky/fixed, then `data-toc-spy-zone` of whatever
 * viewport is left below that. That is by design (a sticky bar and
 * an in-flow bar sit in different contexts), but it means two bars tracking the SAME
 * sections only highlight in lockstep if their EFFECTIVE offsets match. The shared
 * navbar contribution is identical for both, so only the parts that differ need
 * reconciling: a sticky bar 58px tall resolves to navbar + 58, so an in-flow bar
 * alongside it needs `data-toc-offset="58"` to agree.
 *
 * Late-added links or sections (Webflow CMS, tabs, filters): call
 * `window.StartersSectionToc.refresh()` to re-scan and re-run the spy.
 */
(function () {
  if (window.__startersSectionTocInit) return
  window.__startersSectionTocInit = true

  /** @type {string} Wrapper hook — one TOC bar / one controller per match. */
  const WRAPPER_SELECTOR = "[data-toc-element='wrapper']"

  /** @type {string} Inner flex list hook (optional; wrapper is the fallback). */
  const LIST_SELECTOR = "[data-toc-element='list']"

  /** @type {string} Link hook; pairs with `data-toc-id`. */
  const LINK_SELECTOR = "[data-toc-element='link']"

  /** @type {string} Section hook; its value matches a link's `data-toc-id`. */
  const SECTION_SELECTOR = "[data-toc-section]"

  /** @type {string} Attribute set on the active link (removed from the rest). */
  const ACTIVE_ATTR = "data-toc-active"

  /** @type {string} Marks a wrapper as already initialised. */
  const INITED_ATTR = "data-toc-inited"

  /** @type {number} Slack (px) added to the spy line so a section flush with it counts. */
  const SPY_BUFFER = 2

  /**
   * @type {number} Default `data-toc-spy-zone`: the fraction of the viewport left
   * below the chrome that the spy line drops into. 0 would put the line hard against
   * the bars, where a section only counts once it is already slipping out of sight.
   */
  const DEFAULT_SPY_ZONE = 0.3

  /**
   * @type {number} Upper bound for `data-toc-spy-zone`. Past this the line reaches
   * the bottom of the screen and sections stop activating in any sensible order.
   */
  const MAX_SPY_ZONE = 0.8

  /**
   * @type {number} Slack (px) when deciding whether the active link already shows
   * inside the bar. Matches SCROLL_INTO_VIEW_SLACK in the filter-tabs embed.
   */
  const SCROLL_INTO_VIEW_SLACK = 2

  /** @type {number} Distance (px) from max scroll that counts as "page bottom". */
  const BOTTOM_EPSILON = 2

  /**
   * @type {number} How close (px) to the browser's native `#hash` landing the page
   * must still be for the offset correction to fire. Past this the visitor has
   * scrolled and the page must never be yanked.
   */
  const HASH_LANDING_TOLERANCE = 4

  /**
   * @type {number} Fallback (ms) for releasing the spy lock after a click-scroll.
   * Safari has no `scrollend` event, so the timer is the only release there.
   */
  const SETTLE_FALLBACK_MS = 1000

  /** @type {string} Explicit navbar tag — the recommended way to mark the navbar. */
  const NAVBAR_SELECTOR = "[data-toc-navbar]"

  /** @type {string} Fallback when nothing is tagged: Webflow's own navbar class. */
  const NAVBAR_FALLBACK_SELECTOR = ".w-nav"

  /**
   * @type {Array<HTMLElement>} The page's navbars, resolved at scan time and
   * re-resolved on every refresh(). Only the elements are cached — never their
   * heights or positions, both of which are read live so per-breakpoint navbars need
   * zero config. A list, because stacked sticky chrome is normal: a profile header
   * under the site navbar is two bars, and the offset owes both.
   */
  let navbars = []

  // --- dev-only diagnostics ---------------------------------------------------
  // Silent in production. Emits only on staging/local hosts or when the site
  // owner opts in with window.STARTERS_DEBUG === true.

  /** Whether this page counts as a dev/staging context for warnings. */
  const isDevHost = () => {
    try {
      if (window.STARTERS_DEBUG === true) return true
      const host = (location && location.hostname) || ""
      return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith("webflow.io") ||
        host.endsWith("trycloudflare.com")
      )
    } catch (error) {
      return false
    }
  }

  /** Prefixed console.warn that no-ops in production. */
  const devWarn = function () {
    if (!isDevHost()) return
    try {
      console.warn.apply(console, ["[section-toc]"].concat([].slice.call(arguments)))
    } catch (error) {
      /* no-op */
    }
  }

  // --- shared helpers --------------------------------------------------------

  /**
   * Webflow attribute ergonomics: an opt-in flag counts as ON whenever the
   * attribute is present, whatever its value (bare, `""`, `"true"`), and only OFF
   * when explicitly set to `"false"`.
   * @param {string|null} value
   */
  const isAttrEnabled = (value) => {
    if (value === null || value === undefined) return false
    return String(value).trim().toLowerCase() !== "false"
  }

  /**
   * Re-resolves the page navbars. Every explicitly tagged bar counts, so stacked
   * chrome can be marked bar by bar; Webflow's `.w-nav` is the single-element
   * fallback used only when nothing is tagged at all.
   */
  const resolveNavbar = () => {
    const tagged = Array.from(document.querySelectorAll(NAVBAR_SELECTOR))
    if (tagged.length) {
      navbars = tagged
      return
    }
    const fallback = document.querySelector(NAVBAR_FALLBACK_SELECTOR)
    navbars = fallback ? [fallback] : []
  }

  /**
   * The combined live height of the navbars that currently count, or 0 when none do.
   * Position AND height are read at call time, never cached: a Webflow navbar can be
   * `fixed` on desktop and `static` on mobile, and a hidden one has `offsetHeight` 0,
   * so both breakpoint cases fall out for free. Each bar is judged on its own, which
   * is what makes a single tagged navbar behave exactly as it always has.
   *
   * Two exclusions, and the second is narrower than it looks. A bar that IS the
   * wrapper never counts — the sticky-self rule in getOffset() already measures it. A
   * bar that merely CONTAINS the wrapper is skipped only while the wrapper is itself
   * sticky/fixed, because that is the only case where the sticky-self rule already
   * covers the same chrome. A STATIC wrapper inside a sticky bar contributes nothing
   * of its own, so that bar's full height is real covering chrome and counts: on the
   * profile pages the TOC strip is a static inner div inside the sticky profile
   * header, and its 51px must be cleared like any other bar's.
   * @param {HTMLElement} wrapper The bar asking — it may opt out or be a navbar.
   * @returns {number}
   */
  const getNavbarHeight = (wrapper) => {
    if (!navbars.length) return 0
    if (isAttrEnabled(wrapper.getAttribute("data-toc-ignore-navbar"))) return 0

    // Read once per call, not per bar: it decides whether an ancestor bar would be
    // double-counted by the wrapper's own sticky height.
    let wrapperPosition = ""
    try {
      wrapperPosition = getComputedStyle(wrapper).position
    } catch (error) {
      wrapperPosition = ""
    }
    const wrapperIsStuck = wrapperPosition === "sticky" || wrapperPosition === "fixed"

    let total = 0
    for (let i = 0; i < navbars.length; i += 1) {
      const bar = navbars[i]
      if (!bar) continue

      // A bar that IS this wrapper is already accounted for by the sticky-self height
      // in getOffset(); so is an ancestor bar, but ONLY while the wrapper is sticky or
      // fixed. Around a static wrapper the ancestor is uncounted covering chrome.
      if (bar === wrapper) continue
      if (wrapperIsStuck && typeof bar.contains === "function" && bar.contains(wrapper)) continue

      let position = ""
      try {
        position = getComputedStyle(bar).position
      } catch (error) {
        position = ""
      }
      if (position !== "fixed" && position !== "sticky") continue
      total += bar.offsetHeight || 0
    }
    return total
  }

  /**
   * Whether anything INSIDE an element generates a box. Stops at the first hit, and
   * recurses through children that generate no box themselves so nested wrappers
   * resolve.
   * @param {Element} element
   * @returns {boolean}
   */
  const hasRenderedDescendant = (element) => {
    const children = element ? element.children : null
    if (!children) return false
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i]
      try {
        if (child.getClientRects().length) return true
      } catch (error) {
        /* no-op */
      }
      if (hasRenderedDescendant(child)) return true
    }
    return false
  }

  /**
   * Whether an element currently renders. A section hidden with `display: none` —
   * which is exactly what the hide-empty-sections embed does to an empty REVIEWS
   * panel — measures `getBoundingClientRect().top === 0`, so it would sit at the spy
   * line on every pass and steal the active state from the visible section above it.
   * The spy therefore only ever measures sections that are actually on the page.
   *
   * `display: contents` is the exception: Webflow's `display-contents` class makes an
   * element generate no box of its own while its children render normally, so it
   * counts as rendered when anything inside it does (same rule as isHidden() in
   * v3/hide-empty-sections.js).
   * @param {HTMLElement|null} element
   * @returns {boolean}
   */
  const isRendered = (element) => {
    if (!element || typeof element.getClientRects !== "function") return false
    try {
      if (element.getClientRects().length) return true
    } catch (error) {
      return false
    }

    let display = ""
    try {
      display = getComputedStyle(element).display
    } catch (error) {
      display = ""
    }
    if (display !== "contents") return false
    return hasRenderedDescendant(element)
  }

  /** Whether the visitor asked for reduced motion (checked per scroll, not cached). */
  const prefersReducedMotion = () => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    } catch (error) {
      return false
    }
  }

  /** Scroll behavior for programmatic scrolls, honouring reduced motion. */
  const scrollBehavior = () => (prefersReducedMotion() ? "auto" : "smooth")

  /** Current vertical page scroll, tolerant of older engines. */
  const getPageScroll = () =>
    window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0

  /** Largest reachable vertical page scroll. */
  const getMaxPageScroll = () => {
    const doc = document.documentElement
    const body = document.body
    const height = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0)
    return Math.max(0, height - window.innerHeight)
  }

  /** Whether the page is scrolled to (within a hair of) the very bottom. */
  const isAtPageBottom = () => {
    const max = getMaxPageScroll()
    if (max <= 0) return false
    return getPageScroll() >= max - BOTTOM_EPSILON
  }

  /**
   * Maps every `data-toc-section` value on the page to its element. Built once
   * per scan and shared by all wrappers. First match wins on duplicates.
   * @returns {Map<string, HTMLElement>}
   */
  const buildSectionMap = () => {
    const map = new Map()
    document.querySelectorAll(SECTION_SELECTOR).forEach((section) => {
      const name = section.getAttribute("data-toc-section")
      if (!name || map.has(name)) return
      map.set(name, section)
    })
    return map
  }

  /** @type {Array<object>} Live controllers, one per initialised wrapper. */
  const controllers = []

  /** @type {WeakSet<Element>} Links already warned about, so refresh() stays quiet. */
  const warnedLinks = new WeakSet()

  /**
   * Wires one TOC bar. Returns a controller with `scan` / `update` so refresh()
   * can re-run it after CMS content lands.
   * @param {HTMLElement} wrapper
   * @returns {object|null}
   */
  const createController = (wrapper) => {
    if (!wrapper || typeof wrapper.querySelectorAll !== "function") return null

    const list = wrapper.querySelector(LIST_SELECTOR) || wrapper

    /** @type {Array<HTMLElement>} Links in author order. */
    let links = []

    /** @type {Array<HTMLElement|null>} Resolved section per link, same indexes. */
    let sections = []

    /** @type {number|null} Index of the active link; -1 = none, null = not yet run. */
    let activeIndex = null

    /** First spy pass positions the bar without animating (page-load / refresh). */
    let isFirstPass = true

    /** While true, scroll-spy stands down so a click-scroll can finish. */
    let spyLocked = false

    /** @type {number|null} */
    let settleTimer = null

    /** True while a spy pass is queued for the next frame (scroll throttle). */
    let updateQueued = false

    /** Warn only once per wrapper about having no links at all. */
    let warnedEmpty = false

    /**
     * The chrome offset: how much fixed furniture covers the top of the page. It is
     * where a clicked section LANDS, and the starting point the spy line is measured
     * down from (see getSpyLine — the spy zone is deliberately not part of this, so
     * moving the line never moves the landing position). Summed from three parts:
     *   1. `data-toc-offset` — extra manual offset, on top of the navbar.
     *   2. the combined height of the navbars that are fixed/sticky right now (see
     *      getNavbarHeight; skipped via `data-toc-ignore-navbar`).
     *   3. the wrapper's own height, when the wrapper is itself sticky/fixed — it
     *      would otherwise cover the section it just scrolled to.
     * Everything is measured live, so per-breakpoint navbar heights, resizes and
     * rotations are handled with no per-page config.
     * @returns {number}
     */
    const getOffset = () => {
      let offset = parseFloat(wrapper.getAttribute("data-toc-offset"))
      if (!isFinite(offset)) offset = 0
      offset += getNavbarHeight(wrapper)
      let position = ""
      try {
        position = getComputedStyle(wrapper).position
      } catch (error) {
        position = ""
      }
      if (position === "sticky" || position === "fixed") offset += wrapper.offsetHeight || 0
      return offset
    }

    /**
     * `data-toc-spy-zone` for this bar: the fraction of the free viewport the spy
     * line drops into. Anything unparseable or outside 0–MAX_SPY_ZONE falls back to
     * DEFAULT_SPY_ZONE, the same fail-safe bias the rest of the file uses for
     * misconfigured attributes.
     * @returns {number}
     */
    const getSpyZone = () => {
      const zone = parseFloat(wrapper.getAttribute("data-toc-spy-zone"))
      if (!isFinite(zone) || zone < 0 || zone > MAX_SPY_ZONE) return DEFAULT_SPY_ZONE
      return zone
    }

    /**
     * Where the scroll spy reads the page: the chrome offset, plus a slice of the
     * viewport that is still free below it. A line hard against the bars only calls a
     * section active once it is already sliding away, which is why a screen-filling
     * OVERVIEW read as inactive; a line 30% down the free space activates it while it
     * genuinely owns the screen, and still leaves a hero above it inactive.
     *
     * Measured live (viewport height changes on rotate/resize), and used ONLY by the
     * spy — clicks and hash landings keep using getOffset() alone.
     * @returns {number}
     */
    const getSpyLine = () => {
      const offset = getOffset()
      const viewport = window.innerHeight || 0
      return offset + SPY_BUFFER + getSpyZone() * Math.max(0, viewport - offset)
    }

    /** Re-reads links and re-resolves their sections. Safe to call repeatedly. */
    const scan = (sectionMap) => {
      const map = sectionMap || buildSectionMap()
      links = Array.from(wrapper.querySelectorAll(LINK_SELECTOR))
      sections = links.map((link) => {
        const id = link.getAttribute("data-toc-id")
        const section = id ? map.get(id) || null : null
        if (!section && !warnedLinks.has(link)) {
          warnedLinks.add(link)
          devWarn(
            id
              ? 'no [data-toc-section="' + id + '"] on this page for link:'
              : "link is missing data-toc-id:",
            link
          )
        }
        return section
      })

      if (!links.length && !warnedEmpty) {
        warnedEmpty = true
        devWarn("wrapper has no [data-toc-element='link'] children:", wrapper)
      }
    }

    /**
     * Index of the section that sits lowest in the document (the final one).
     * Hidden sections are skipped, so "last" means the last VISIBLE section — the
     * right answer for the page-bottom case, which is the only caller.
     */
    const getLastSectionIndex = () => {
      let best = -1
      let bestTop = -Infinity
      for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i]
        if (!isRendered(section)) continue
        const top = section.getBoundingClientRect().top
        if (top >= bestTop) {
          bestTop = top
          best = i
        }
      }
      return best
    }

    /**
     * Which link should be active right now.
     * The last section whose top has crossed the spy line (see getSpyLine — the
     * chrome offset plus a slice of the free viewport). Compared by measured
     * position rather than author order, so links may be listed out of document
     * order.
     *
     * Returns -1 above the first section, i.e. while every section top is still
     * below the line: with a hero on screen and the first section beneath it, no
     * link is active, and that is the intended reading.
     *
     * Page-bottom special case: a short final section can never reach the spy
     * line, so at max scroll the last section always wins.
     *
     * Hidden sections take no part: a `display: none` section measures a top of 0,
     * which clears the spy line from the very first pixel, so it would hold the
     * active state at page top for ever (see isRendered).
     * @returns {number}
     */
    const computeActiveIndex = () => {
      if (!links.length) return -1
      if (isAtPageBottom()) {
        const last = getLastSectionIndex()
        if (last !== -1) return last
      }

      const line = getSpyLine()
      let best = -1
      let bestTop = -Infinity
      for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i]
        if (!isRendered(section)) continue
        const top = section.getBoundingClientRect().top
        if (top <= line && top >= bestTop) {
          bestTop = top
          best = i
        }
      }
      return best
    }

    /** Puts `data-toc-active="true"` on one link and strips it from the others. */
    const applyActive = (index) => {
      links.forEach((link, i) => {
        if (i === index) link.setAttribute(ACTIVE_ATTR, "true")
        else link.removeAttribute(ACTIVE_ATTR)
      })
    }

    /**
     * Brings the active link into view inside the bar, centering it and clamping to
     * the scroll bounds so the first/last links rest at the edges instead of
     * over-scrolling. No-op unless the bar overflows, and no-op while the link is
     * already fully visible — so an overflowing bar rests where it is (left-aligned
     * by default) instead of creeping on every section change. Same rule for
     * spy-driven and click-driven calls. Deliberately not `scrollIntoView()` —
     * that can scroll the page vertically too.
     * @param {HTMLElement} link
     * @param {ScrollBehavior} behavior
     */
    const scrollLinkIntoView = (link, behavior) => {
      if (!link || typeof link.getBoundingClientRect !== "function") return
      const maxScroll = wrapper.scrollWidth - wrapper.clientWidth
      if (maxScroll <= 0) return

      const wrapperRect = wrapper.getBoundingClientRect()
      const linkRect = link.getBoundingClientRect()

      // Already fully in view horizontally — leave the strip alone.
      if (
        linkRect.left >= wrapperRect.left - SCROLL_INTO_VIEW_SLACK &&
        linkRect.right <= wrapperRect.right + SCROLL_INTO_VIEW_SLACK
      ) {
        return
      }

      // Where the link sits relative to the bar's current scroll position.
      const linkStart = linkRect.left - wrapperRect.left + wrapper.scrollLeft
      const centered = linkStart + linkRect.width / 2 - wrapper.clientWidth / 2
      const target = Math.max(0, Math.min(centered, maxScroll))
      if (Math.abs(target - wrapper.scrollLeft) <= 1) return
      wrapper.scrollTo({ left: target, behavior: behavior })
    }

    /** Releases the click-scroll lock and resyncs against the real scroll position. */
    const unlockSpy = () => {
      if (settleTimer !== null) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      if (!spyLocked) return
      spyLocked = false
      update()
    }

    /**
     * Suppresses spy updates until the page scroll settles, so it cannot fight a
     * click-triggered smooth scroll. `scrollend` releases it early where
     * supported; the timer is the fallback (Safari).
     */
    const lockSpy = () => {
      spyLocked = true
      if (settleTimer !== null) clearTimeout(settleTimer)
      settleTimer = setTimeout(unlockSpy, SETTLE_FALLBACK_MS)
    }

    /** Runs the spy and syncs active link + bar scroll position. */
    const update = () => {
      if (spyLocked) return
      const index = computeActiveIndex()
      const initial = isFirstPass
      isFirstPass = false
      if (index === activeIndex && !initial) return
      activeIndex = index
      applyActive(index)
      if (index >= 0) scrollLinkIntoView(links[index], initial ? "auto" : scrollBehavior())
    }

    /** Scrolls the page so a link's section lands just below the offset. */
    const goToSection = (index) => {
      const section = sections[index]
      if (!section) return

      const behavior = scrollBehavior()
      const top = Math.max(0, getPageScroll() + section.getBoundingClientRect().top - getOffset())

      // Activate immediately, then stand down until the page scroll settles.
      activeIndex = index
      isFirstPass = false
      applyActive(index)
      scrollLinkIntoView(links[index], behavior)
      lockSpy()
      window.scrollTo({ top: top, behavior: behavior })

      // replaceState never triggers a native jump, unlike assigning location.hash.
      if (section.id) {
        try {
          history.replaceState(history.state, "", "#" + section.id)
        } catch (error) {
          /* no-op */
        }
      }
    }

    /**
     * rAF-throttled scroll/resize handler. The flag is raised before the frame is
     * requested and lowered inside it, so the throttle cannot wedge itself.
     */
    const onScroll = () => {
      if (updateQueued) return
      updateQueued = true
      requestAnimationFrame(() => {
        updateQueued = false
        update()
      })
    }

    /**
     * Delegated so links added later (CMS) work without rebinding. Only calls
     * preventDefault when the link resolves to a section on this page, leaving
     * cross-page TOC links untouched.
     */
    wrapper.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      const link = target.closest(LINK_SELECTOR)
      if (!link || !wrapper.contains(link)) return

      const index = links.indexOf(link)
      if (index === -1 || !sections[index]) return

      event.preventDefault()
      goToSection(index)
    })

    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    if ("onscrollend" in window) window.addEventListener("scrollend", unlockSpy)

    /**
     * Web fonts and images land after DOMContentLoaded and move every section, so
     * the first measurement can be stale. Re-measure once on load, still without
     * animating the bar.
     */
    if (document.readyState !== "complete") {
      window.addEventListener(
        "load",
        () => {
          if (spyLocked) return
          isFirstPass = true
          update()
        },
        { once: true }
      )
    }

    const controller = {
      wrapper: wrapper,
      list: list,
      scan: scan,
      update: update,
      /** Re-scan, then reposition the bar without animating (CMS content landed). */
      refresh: (sectionMap) => {
        scan(sectionMap)
        activeIndex = null
        isFirstPass = true
        spyLocked = false
        if (settleTimer !== null) {
          clearTimeout(settleTimer)
          settleTimer = null
        }
        update()
      },
      /** Whether this bar has a link pointing at `section`. */
      hasSection: (section) => sections.indexOf(section) !== -1,
      /** Re-run the spy and snap the bar (no animation) after the page was moved. */
      resync: () => {
        isFirstPass = true
        update()
      },
      getActiveIndex: () => activeIndex,
      getOffset: getOffset,
    }

    wrapper._tocController = controller
    return controller
  }

  /**
   * Inits every un-inited wrapper and drops wrappers that left the DOM.
   * @returns {{ sectionMap: Map<string, HTMLElement>, added: Array<object> }}
   */
  const scanDocument = () => {
    resolveNavbar()
    const sectionMap = buildSectionMap()
    const added = []

    for (let i = controllers.length - 1; i >= 0; i -= 1) {
      if (document.contains(controllers[i].wrapper)) continue
      controllers.splice(i, 1)
    }

    document.querySelectorAll(WRAPPER_SELECTOR).forEach((wrapper) => {
      if (wrapper.hasAttribute(INITED_ATTR)) return
      wrapper.setAttribute(INITED_ATTR, "true")
      const controller = createController(wrapper)
      if (!controller) return
      controllers.push(controller)
      added.push(controller)
    })

    added.forEach((controller) => {
      controller.scan(sectionMap)
      controller.update()
    })

    return { sectionMap: sectionMap, added: added }
  }

  /**
   * Re-anchors a native `#hash` landing so the target section clears the offset.
   * The browser's own jump puts the section's top at the viewport top, i.e. under
   * any sticky chrome, and nothing else corrects it.
   *
   * Fires only while the page is still within HASH_LANDING_TOLERANCE of that
   * native landing, so it can never yank a page the visitor has scrolled. That
   * guard also makes it self-idempotent: once corrected, the page sits one offset
   * away and further calls no-op.
   * @returns {boolean} Whether the page was moved.
   */
  const correctHashLanding = () => {
    const raw = (location.hash || "").replace("#", "")
    if (!raw) return false

    let target = document.getElementById(raw)
    if (!target) {
      try {
        target = document.getElementById(decodeURIComponent(raw))
      } catch (error) {
        target = null
      }
    }
    if (!target || typeof target.closest !== "function") return false

    // The anchor may be the section itself or any element inside it.
    const section = target.closest(SECTION_SELECTOR)
    if (!section) return false

    // The bar that actually links to this section governs the offset.
    const controller = controllers.find((entry) => entry.hasSection(section))
    if (!controller) return false

    const offset = controller.getOffset()
    if (offset <= 0) return false

    const current = getPageScroll()
    // Absolute document position of the section top = where the native jump lands.
    const nativeLanding = current + section.getBoundingClientRect().top
    if (Math.abs(current - nativeLanding) > HASH_LANDING_TOLERANCE) return false

    // Clamped at 0, so a section at the top of the page needs no correction.
    const corrected = Math.max(0, nativeLanding - offset)
    if (Math.abs(corrected - current) <= 1) return false

    window.scrollTo({ top: corrected, behavior: "auto" })
    return true
  }

  /**
   * Public hook — pick up new bars, then re-scan links/sections and re-run the
   * spy on the bars that were already running.
   */
  const refresh = () => {
    const result = scanDocument()
    controllers.forEach((controller) => {
      if (result.added.indexOf(controller) !== -1) return
      controller.refresh(result.sectionMap)
    })
  }

  window.StartersSectionToc = { refresh: refresh }

  /** Corrects the hash landing, then snaps every bar to the new scroll position. */
  const correctHashAndResync = () => {
    if (!correctHashLanding()) return
    controllers.forEach((controller) => controller.resync())
  }

  const init = () => {
    scanDocument()
    correctHashAndResync()

    // Sections move as fonts/images land, so the landing is re-checked on load —
    // after the per-bar re-measure listeners, which were registered first.
    if (document.readyState !== "complete") {
      window.addEventListener("load", correctHashAndResync, { once: true })
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }
})()
