/**
 * Learn CTA gate — open the sign-up gate once the reader has read enough of a
 * Learn article, or after a short wait on articles too short to scroll.
 *
 * @release v1.59.182
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with `defer` in the Learn
 * article template's before-</body> code. Pair it with learn-cta-gate.css in
 * the head, which owns the CLOSED state — this file only opens the gate.
 *
 * WHAT IT REPLACES. The gate markup already existed and painted fully visible
 * on load, so every Learn article was blocked from first paint with no reveal
 * at all. An older inline embed on the template watched `section.gated` and
 * froze `<html>` + `.page-wrapper` overflow, but the section's class is
 * `section_learn-cta-gate`, so that embed returned on its null check and never
 * ran. This file supersedes it; the inline embed is being removed.
 *
 * THE MARKUP (Designer-authored):
 *   [data-learn-gate-element="wrapper"]   section_learn-cta-gate
 *                                         position:fixed, inset 0, z-index 10,
 *                                         display:flex, column, justify-end
 *   [data-learn-gate-element="backdrop"]  learn-cta-gate_backdrop, absolute inset 0
 *   [data-learn-gate-element="content"]   learn-cta-gate_contents, the sheet
 *
 * Plus one OPTIONAL hook that is deliberately NOT a `data-learn-gate-element`
 * value: `[data-learn-gate-close-button]`, its own standalone attribute. An
 * element can only carry one `data-learn-gate-element`, so a role value could
 * never be added to a node that already has a role — and in Designer the close
 * control is quite likely to be exactly such a node. See DISMISSAL below.
 *
 * WHO SEES IT — NOT THIS SCRIPT'S DECISION. The wrapper carries Memberstack's
 * `data-ms-content="!learn-access"`. Memberstack alone decides who is gated.
 * This script reads the wrapper's COMPUTED display and exits without writing a
 * single style when it resolves to `none`. That guard matters because GSAP
 * writes inline styles, and an inline `opacity`/`visibility` on an element
 * Memberstack meant to hide is how a paywall leaks to a paying member. The
 * guard is computed-style rather than "is the element present" because this
 * site does both: Memberstack removes some gate variants and merely hides
 * others, so presence proves nothing while computed display covers both.
 *
 * THAT GUARD IS WORTHLESS IF IT RUNS TOO EARLY, which is the real trap.
 * Memberstack resolves the member asynchronously and paints the gates AFTER
 * defer-time scripts run — expert-card-browse-loader.js:124 documents the same
 * window ("Memberstack REMOVES the non-matching variants, but only after it
 * resolves — and this embed runs at defer time, before that"). A guard that
 * reads the wrapper at DOMContentLoaded therefore sees `display: flex` for
 * EVERY reader including one with learn-access, arms itself, and later locks
 * the scroll of a member who can see no gate and has no way to unlock it. The
 * close control added since does not rescue them: their whole wrapper is
 * hidden, so the close inside it is hidden too and `dismissible` resolves
 * false. So this embed waits on `window.memberReady` — the site's own
 * readiness promise, used the same way by route-guard.js,
 * expert-card-browse-loader.js and posthog-identity.js — and re-checks
 * computed display once more at reveal time, BEFORE the scroll lock, to cover
 * a gate that is hidden later still. It boots anyway if that promise is absent
 * or rejects: a gate that fails to appear is a much smaller problem than one
 * that traps a paying member on a page they cannot scroll.
 *
 * THE TRIGGER, two mutually exclusive modes chosen once at init:
 *   - Article >= CHARS (default 2500) — walk the article's text nodes, insert a
 *     1px out-of-flow sentinel after the text node that crosses the threshold,
 *     and open when an IntersectionObserver reports the sentinel on screen. No
 *     timer runs in this mode.
 *   - Article < CHARS — there is not enough article to scroll through, so skip
 *     the sentinel entirely and open after DELAY (default 10s) from init.
 *
 * WHY A SENTINEL AND NOT A SCROLL PERCENTAGE. Character count and pixel height
 * are not proportional in CMS rich text: one embedded video or hero image moves
 * "34% scrolled" hundreds of characters in either direction. A node planted at
 * the actual 2500th character is correct on every article regardless of what
 * else is in it.
 *
 * The sentinel is planted AFTER a whole text node rather than inside a split
 * one. Paragraph granularity is plenty for a paywall, and not splitting text
 * nodes keeps links, spans and Webflow's rich-text markup untouched.
 *
 * ONCE ONLY. The gate opens once per page load. `state.revealed` latches on the
 * first reveal and every trigger is torn down in the same tick, so a dismissed
 * gate cannot come back on that page — and a fresh load starts clean. That is
 * the whole of the "stays closed" behaviour; there is deliberately no cookie
 * and no localStorage.
 *
 * DISMISSAL — WHO MAY CLOSE IT IS ALSO NOT THIS SCRIPT'S DECISION. The gate is
 * a hard paywall unless Designer supplies a close control:
 *
 *   [data-learn-gate-close-button], inside the wrapper, carrying its own
 *   Memberstack `data-ms-content`. Memberstack decides who gets one. A logged-in
 *   non-paying member sees it and may dismiss; a logged-out reader gets no such
 *   element and the gate stays exactly as hard as it was before this existed.
 *
 * PUT IT ON SOMETHING MEMBERSTACK CAN HIDE, AND NEVER ON THE BACKDROP. The whole
 * gate rests on `dismissible`, which asks whether the close control is displayed.
 * The backdrop is part of the gate and shows for every reader, so marking the
 * backdrop as the close control resolves `dismissible` true for logged-out
 * readers and hands them the article. Hiding the backdrop from non-members to
 * work around that would take the dimming with it. Backdrop-CLICK already
 * dismisses (below) once a real close control exists somewhere else, which is
 * what that itch usually is.
 *
 * The script reduces that to ONE boolean, `state.dismissible`, and every
 * dismissal path is gated on it. One value to reason about, one value to test.
 *
 * `dismissible` IS COMPUTED AT REVEAL, NEVER AT BOOT, for the same reason the
 * wrapper's display guard is re-checked there: Memberstack resolves after
 * defer-time scripts, so a boot-time read predates the decision and would hand
 * every logged-out reader a dismissible paywall.
 *
 * And it is computed from COMPUTED DISPLAY, not from presence — same reasoning
 * as the wrapper guard above. This site both removes and merely hides gated
 * elements. A close control that Memberstack only hid is still in the DOM and
 * `querySelector` still finds it; binding a live click handler to it would be
 * an invisible escape hatch inside a gate meant to be hard.
 *
 * Backdrop-click dismisses; Escape does not, by product decision. No keydown
 * listener is registered at all — the absence is the feature, so if you are
 * adding one, that is a spec change and not an oversight. The backdrop handler
 * checks `event.target` so a click that lands on the sheet (or on the sign-up
 * form inside it) can never close the gate by bubbling.
 *
 * Scroll lock is byte-for-byte the modal.js line (global-embeds/modal/modal.js):
 * prefer `lenis.stop()`, else `document.body.style.overflow`. There is no Lenis
 * instance on the Learn template today, so it takes the body-overflow branch.
 * The unlock mirrors it exactly, and restores overflow to '' rather than forcing
 * 'visible' so whatever Webflow had there survives.
 *
 * Unlock happens on click, not when the exit finishes: the click already
 * committed to closing, and a page that stays frozen for a third of a second
 * after a button press reads as broken.
 *
 * Attributes on the wrapper, all optional:
 *   data-learn-gate-chars     integer, default 2500. Threshold in characters.
 *   data-learn-gate-delay     seconds, default 10. Short-article wait.
 *   data-learn-gate-article   CSS selector for the article body.
 *                             Default ".content_rte.w-richtext".
 *   data-learn-gate-ease      GSAP ease for the sheet, default "power2.out".
 *                             Validated against this page's GSAP via parseEase;
 *                             an ease this build does not know falls back with a
 *                             staging warning rather than silently flattening.
 *   data-learn-gate-duration  seconds, default 0.35. Sheet travel time.
 *   data-learn-gate-fade      seconds, default 0.2. Backdrop fade time.
 *   data-learn-gate-lag       seconds, default 0.3. When the sheet starts,
 *                             measured from the START of the backdrop fade.
 *                             Greater than the fade = a beat of stillness
 *                             between dimming and arrival; less = they overlap.
 *
 * The four motion attributes exist so the feel can be retuned in Designer
 * without a release. The defaults were chosen on staging with a visual tuner,
 * not picked off a chart, so treat them as intentional. Under
 * prefers-reduced-motion none of them apply: the sheet never slides and both
 * parts cross-fade in 0.2s.
 *
 * Diagnostics are console-only and gated to staging hosts (`*.webflow.io`,
 * `localhost`, `127.0.0.1`, `*.trycloudflare.com`) or `window.STARTERS_DEBUG`.
 * Production stays silent.
 *
 * Debug from the console: `StartersLearnCtaGate.status()`, or force it open
 * with `StartersLearnCtaGate.reveal()`. `status().dismissible` reports whether
 * this reader may close it. `StartersLearnCtaGate.dismiss()` closes it, and is
 * gated on `dismissible` like every other path — on a hard gate it is a no-op
 * by design, so QA an exit animation by authoring a close control, never by
 * reaching past the guard.
 */
;(function () {
  'use strict'

  // Window-level init guard, matching the other embeds (turnstile-contents-fix.js
  // uses the same shape). An IIFE-local flag cannot stop a duplicate script tag:
  // the second IIFE would still run to completion and overwrite the public API
  // with its own dud instance before discovering the wrapper was already armed.
  if (window.__startersLearnCtaGateBooted) return
  window.__startersLearnCtaGateBooted = true

  var RELEASE = 'v1.59.182'
  var LOG_PREFIX = '[learn-cta-gate]'

  var WRAPPER_SELECTOR = '[data-learn-gate-element="wrapper"]'
  var BACKDROP_SELECTOR = '[data-learn-gate-element="backdrop"]'
  var CONTENT_SELECTOR = '[data-learn-gate-element="content"]'
  var CLOSE_SELECTOR = '[data-learn-gate-close-button]'
  var DEFAULT_ARTICLE_SELECTOR = '.content_rte.w-richtext'

  var DEFAULT_CHARS = 2500
  var DEFAULT_DELAY_SECONDS = 10

  // Motion defaults, chosen by Jerico on staging with the visual tuner rather
  // than picked off a page of easing curves. Note LAG (0.3) is LONGER than the
  // backdrop fade (0.2): the dimming completes, the page holds still for a beat,
  // and only then does the sheet arrive. That sequential read is deliberate — do
  // not "fix" it into an overlap.
  var DEFAULT_EASE = 'power2.out'
  var DEFAULT_DURATION = 0.35
  var DEFAULT_FADE_DURATION = 0.2
  var DEFAULT_LAG = 0.3

  // Reduced motion never slides, so it needs only the one cross-fade duration.
  var REDUCED_DURATION = 0.2

  var INIT_ATTR = 'data-script-initialized'

  /* ----------------------------- diagnostics ------------------------------ */

  // Anchored so a lookalike host ("notwebflow.io", "evil-trycloudflare.com")
  // cannot read as staging.
  function stagingHost(hostname) {
    var host = hostname || ''
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    )
  }

  // STARTERS_DEBUG belongs here and not in stagingHost(): it may turn logging on
  // in production, but it must never widen what counts as a staging host.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true
    return stagingHost((window.location && window.location.hostname) || '')
  }

  function warn(message, detail) {
    if (!diagnosticsEnabled()) return
    if (detail === undefined) console.warn(LOG_PREFIX + ' ' + message)
    else console.warn(LOG_PREFIX + ' ' + message, detail)
  }

  function info(message, detail) {
    if (!diagnosticsEnabled()) return
    if (detail === undefined) console.info(LOG_PREFIX + ' ' + message)
    else console.info(LOG_PREFIX + ' ' + message, detail)
  }

  /* -------------------------------- state --------------------------------- */

  var state = {
    release: RELEASE,
    booted: false,
    /** null until boot arms something; then 'scroll' | 'timer'. A skipped boot
     *  leaves this null and records the reason in `skipped` instead. */
    mode: null,
    revealed: false,
    /** what actually opened it: 'scroll' | 'timer' | 'manual' | null */
    trigger: null,
    chars: null,
    threshold: DEFAULT_CHARS,
    delaySeconds: DEFAULT_DELAY_SECONDS,
    /** why boot stopped early, for QA */
    skipped: null,
    /** may THIS reader close it? Resolved once, at reveal. False until then, so
     *  a gate that never opened can never report itself as dismissible. */
    dismissible: false,
    dismissed: false,
    /** what closed it: 'close' | 'backdrop' | 'manual' | null */
    dismissedVia: null,
    /** the motion actually in force, after attributes and validation */
    motion: {
      ease: DEFAULT_EASE,
      duration: DEFAULT_DURATION,
      fadeDuration: DEFAULT_FADE_DURATION,
      lag: DEFAULT_LAG,
    },
  }

  var wrapper = null
  var backdrop = null
  var sheet = null
  var closeEl = null
  var sentinel = null
  var observer = null
  var timerId = null
  var timeline = null

  /* ------------------------------- helpers -------------------------------- */

  /**
   * Positive integer from an attribute, or the fallback. A garbage or negative
   * value falls back rather than throwing — an authoring typo in Designer must
   * not take the gate down.
   * @param {Element} el
   * @param {string} name
   * @param {number} fallback
   * @returns {number}
   */
  function intAttr(el, name, fallback) {
    var raw = el.getAttribute(name)
    if (raw === null || raw === '') return fallback
    var n = parseInt(String(raw).trim(), 10)
    if (!isFinite(n) || n <= 0) {
      warn('ignoring ' + name + '="' + raw + '" (not a positive integer)')
      return fallback
    }
    return n
  }

  /**
   * Non-negative float from an attribute, or the fallback. Seconds, everywhere
   * it is used. `min` exists because a duration of 0 is a mistake worth warning
   * about while a lag of 0 is a legitimate "start both together".
   * @param {Element} el
   * @param {string} name
   * @param {number} fallback
   * @param {number} min smallest accepted value (inclusive)
   * @returns {number}
   */
  function floatAttr(el, name, fallback, min) {
    var raw = el.getAttribute(name)
    if (raw === null || raw === '') return fallback
    var n = parseFloat(String(raw).trim())
    if (!isFinite(n) || n < min) {
      warn('ignoring ' + name + '="' + raw + '" (want a number >= ' + min + ')')
      return fallback
    }
    return n
  }

  /**
   * An easing name is only usable if this page's GSAP actually knows it — the
   * site could be on a build without a given plugin, and an unknown ease silently
   * degrades the animation rather than erroring. Ask GSAP instead of keeping a
   * hardcoded list here that would drift out of date.
   * @param {Element} el
   * @param {string} name
   * @param {string} fallback
   * @returns {string}
   */
  function easeAttr(el, name, fallback) {
    var raw = el.getAttribute(name)
    if (raw === null || raw === '') return fallback
    var value = String(raw).trim()
    if (typeof gsap === 'undefined' || typeof gsap.parseEase !== 'function') return value
    var parsed
    try {
      parsed = gsap.parseEase(value)
    } catch (err) {
      parsed = null
    }
    if (typeof parsed !== 'function') {
      warn('ignoring ' + name + '="' + value + '" (this page\'s GSAP does not know that ease)')
      return fallback
    }
    return value
  }

  function prefersReducedMotion() {
    if (typeof window.matchMedia !== 'function') return false
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (err) {
      return false
    }
  }

  /** Last non-empty path segment, used as the article id in analytics. */
  function articleSlug() {
    var path = (window.location && window.location.pathname) || ''
    var parts = path.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : ''
  }

  /**
   * Whitespace-collapsed length, so the count matches what a reader sees rather
   * than counting the newlines and indentation Webflow puts between blocks.
   * @param {string} value
   * @returns {number}
   */
  function visibleLength(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .length
  }

  /* ------------------------------ measurement ------------------------------ */

  /**
   * Every text node under `root`, in document order, skipping the subtrees that
   * hold no reading material. `<script>`/`<style>` text would otherwise inflate
   * the count enormously on a rich text block containing an embed.
   * @param {Element} root
   * @returns {Text[]}
   */
  function textNodes(root) {
    var out = []
    if (!root || typeof document.createTreeWalker !== 'function') return out

    var walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */, {
      acceptNode: function (node) {
        var parent = node.parentNode
        if (!parent) return 2 /* REJECT */
        var tag = (parent.nodeName || '').toUpperCase()
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return 2
        if (!String(node.nodeValue || '').trim()) return 2
        return 1 /* ACCEPT */
      },
    })

    var node
    while ((node = walker.nextNode())) out.push(node)
    return out
  }

  /**
   * Total visible characters, plus the text node at which a running count first
   * reaches `threshold`. One pass, so a long article is walked once.
   * @param {Text[]} nodes
   * @param {number} threshold
   * @returns {{total: number, crossing: Text|null}}
   */
  function measure(nodes, threshold) {
    var total = 0
    var crossing = null
    for (var i = 0; i < nodes.length; i++) {
      total += visibleLength(nodes[i].nodeValue)
      if (crossing === null && total >= threshold) crossing = nodes[i]
    }
    return { total: total, crossing: crossing }
  }

  /**
   * Plant the trigger point after `node`. Out of flow and 1px, so it adds no
   * layout and no visible mark, but still has the non-zero area that some
   * engines require before IntersectionObserver will report a target.
   * @param {Text} node
   * @returns {HTMLElement|null}
   */
  function plantSentinel(node) {
    var parent = node && node.parentNode
    if (!parent) return null

    var el = document.createElement('span')
    el.setAttribute('data-learn-gate-element', 'sentinel')
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText =
      'position:absolute;width:1px;height:1px;margin:0;padding:0;border:0;' +
      'opacity:0;pointer-events:none;'

    parent.insertBefore(el, node.nextSibling)
    return el
  }

  /* -------------------------------- reveal -------------------------------- */

  function lockScroll() {
    // Verbatim from global-embeds/modal/modal.js — one lock idiom for the site.
    typeof lenis !== 'undefined' && lenis.stop
      ? lenis.stop()
      : (document.body.style.overflow = 'hidden')
  }

  /**
   * The exact inverse of lockScroll, branch for branch. Restores overflow to ''
   * rather than 'visible': the lock is the only thing that put a value there, so
   * clearing it hands the property back to whatever Webflow's stylesheet says
   * instead of overriding it forever with an inline one.
   */
  function unlockScroll() {
    typeof lenis !== 'undefined' && lenis.start
      ? lenis.start()
      : (document.body.style.overflow = '')
  }

  function teardownTriggers() {
    if (observer) {
      observer.disconnect()
      observer = null
    }
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  /**
   * Shared PostHog send. Both gate events carry the same identifying fields so
   * shown and dismissed can be joined on slug + trigger without a lookup.
   * @param {string} name
   * @param {Record<string, unknown>} [extra]
   */
  function capture(name, extra) {
    var posthog = window.posthog
    if (!posthog || typeof posthog.capture !== 'function') {
      info('posthog absent, skipping ' + name)
      return
    }
    var props = {
      slug: articleSlug(),
      trigger: state.trigger,
      chars: state.chars,
      threshold: state.threshold,
      release: RELEASE,
    }
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        props[key] = extra[key]
      })
    }
    try {
      posthog.capture(name, props)
    } catch (err) {
      // Analytics must never break the gate.
      warn('posthog.capture threw', err)
    }
  }

  // Jerico is making the paywall escapable for a whole segment. Shown-count
  // alone cannot say what that cost, so the dismissal is measured too, and
  // `via` separates a deliberate button press from a backdrop click.
  function trackDismiss() {
    capture('learn_gate_dismissed', { via: state.dismissedVia })
  }

  // The wrapper's open state, written once so the GSAP path and the no-GSAP
  // path cannot drift apart. GSAP takes it as tween vars; applyStyles()
  // writes the same values as inline styles.
  var OPEN_WRAPPER = { visibility: 'visible', pointerEvents: 'auto', opacity: 1 }

  var OPEN_STATE = { wrapper: OPEN_WRAPPER, backdrop: '1', sheet: 'translateY(0%)' }
  var CLOSED_STATE = {
    wrapper: { visibility: 'hidden', pointerEvents: 'none', opacity: 0 },
    backdrop: '0',
    sheet: 'translateY(100%)',
  }

  /**
   * Writes a whole gate state as inline styles. Both directions go through this
   * one function on purpose: two hand-written mirrors is how a property gets
   * added to the open state and quietly forgotten in the closed one.
   *
   * Only reached when GSAP is absent, so writing `transform` here cannot collide
   * with a tween — the stylesheet's no-transform rule is about sharing the
   * property with GSAP, and on this path GSAP does not exist.
   *
   * @param {{wrapper: object, backdrop: string, sheet: string}} target
   */
  function applyStyles(target) {
    wrapper.style.visibility = target.wrapper.visibility
    wrapper.style.pointerEvents = target.wrapper.pointerEvents
    wrapper.style.opacity = String(target.wrapper.opacity)
    backdrop.style.opacity = target.backdrop
    sheet.style.transform = target.sheet
  }

  function buildTimeline() {
    var reduced = prefersReducedMotion()

    var tl = gsap.timeline({
      paused: true,
      onComplete: function () {
        // The hint has done its job; leaving it set keeps a layer promoted for
        // the life of the page for no benefit.
        sheet.style.willChange = 'auto'
      },
    })

    tl.set(wrapper, OPEN_WRAPPER)

    if (reduced) {
      // No slide. ensureClosed() skips parking the sheet under reduced motion,
      // so this is belt only — it guarantees a resting position even if some
      // other code parked it.
      tl.set(sheet, { yPercent: 0 })
      tl.fromTo(
        [backdrop, sheet],
        { opacity: 0 },
        { opacity: 1, duration: REDUCED_DURATION, ease: 'none' }
      )
      return tl
    }

    var m = state.motion

    tl.fromTo(
      backdrop,
      { opacity: 0 },
      { opacity: 1, duration: m.fadeDuration, ease: 'power2.out' }
    )
    // Position is relative to the START of the backdrop fade, not its end. With
    // the shipped defaults (fade 0.2, lag 0.3) that puts a deliberate 0.1s beat
    // of stillness between the dimming finishing and the sheet arriving. A lag
    // below the fade duration overlaps them instead; both are valid.
    tl.fromTo(
      sheet,
      { yPercent: 100 },
      { yPercent: 0, duration: m.duration, ease: m.ease },
      '<' + m.lag
    )
    return tl
  }

  /* ------------------------------ dismissal ------------------------------- */

  /**
   * The one decision every dismissal path is gated on. Called once, from
   * reveal(), because Memberstack has not necessarily decided anything at boot.
   *
   * Presence is not enough. Memberstack removes some gated elements on this site
   * and merely hides others, so a close control that is still in the DOM may be
   * one Memberstack meant to take away — binding it would be an invisible escape
   * hatch out of a hard paywall.
   */
  /**
   * True when `el` AND every ancestor between it and the wrapper is displayed.
   *
   * The walk is the whole point, and checking the close control on its own is
   * the bug it exists to prevent: `getComputedStyle` on a DESCENDANT of a
   * display:none subtree reports that descendant's OWN display — 'block', not
   * 'none' — because ancestor display does not propagate into the computed value.
   * So a close control would read as visible whenever Memberstack's attribute
   * sits on a div WRAPPING it instead of on the control itself, which is an
   * entirely normal way to author it in Designer. The cost of getting that wrong
   * is a logged-out reader who can click the paywall away.
   *
   * The wrapper is the stopping point, not part of the walk: reveal() has
   * already guarded it, and there is nothing above it worth consulting.
   *
   * `display` only, never `visibility`. Visibility INHERITS, and the gate is
   * still `visibility: hidden` when this runs — every descendant would report
   * 'hidden' and no gate could ever be dismissible.
   */
  function isDisplayed(el) {
    for (var node = el; node && node !== wrapper; node = node.parentNode) {
      if (node.nodeType !== 1) break
      if (window.getComputedStyle(node).display === 'none') return false
    }
    return true
  }

  function resolveDismissible() {
    closeEl = wrapper.querySelector(CLOSE_SELECTOR)

    // The backdrop shows for EVERY reader, so accepting it as the close control
    // would resolve `dismissible` true for a logged-out one and hand them the
    // article. Refused rather than merely documented, because it is a silent,
    // total paywall bypass and the attribute is easy to drop here by mistake.
    // Backdrop-CLICK is already a dismissal path once a real close control
    // exists elsewhere, which is what this authoring usually means to express.
    if (closeEl && closeEl === backdrop) {
      warn('the backdrop cannot be the close control — ignoring, gate stays hard')
      closeEl = null
    }

    state.dismissible = !!closeEl && isDisplayed(closeEl)

    if (closeEl && !state.dismissible) {
      info('close control present but hidden — gate stays hard for this reader')
    }
  }

  function handleCloseClick(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    dismiss('close')
  }

  /**
   * The sheet is a sibling of the backdrop, not a child, so a click inside the
   * sign-up form should never reach here. The target check makes that a fact
   * rather than a dependency on markup nobody in this file controls.
   */
  function handleBackdropClick(event) {
    if (!event || event.target !== backdrop) return
    dismiss('backdrop')
  }

  function armDismissal() {
    if (!state.dismissible) return
    closeEl.addEventListener('click', handleCloseClick)
    backdrop.addEventListener('click', handleBackdropClick)
  }

  function disarmDismissal() {
    if (closeEl) closeEl.removeEventListener('click', handleCloseClick)
    if (backdrop) backdrop.removeEventListener('click', handleBackdropClick)
  }

  /**
   * Close the gate. Gated on `dismissible` a second time on purpose: armDismissal
   * already refuses to bind when the gate is hard, so this guard only matters if
   * some future caller reaches dismiss() another way. It costs one comparison and
   * it means no path can open a hard paywall by accident.
   *
   * @param {'close'|'backdrop'|'manual'} via
   */
  function dismiss(via) {
    if (!state.revealed || state.dismissed) return
    if (!state.dismissible) {
      info('dismiss(' + via + ') ignored — this gate is not dismissible')
      return
    }

    state.dismissed = true
    state.dismissedVia = via
    disarmDismissal()

    // Before the exit plays, not after: the click already committed to closing.
    unlockScroll()

    // The reverse reverts this at the end anyway; setting it now stops the
    // full-screen wrapper from swallowing clicks while the sheet slides away.
    wrapper.style.pointerEvents = 'none'

    if (timeline) timeline.reverse()
    else applyStyles(CLOSED_STATE)

    trackDismiss()
    info('dismissed via ' + via)
    window.dispatchEvent(
      new CustomEvent('learn-gate-dismissed', {
        detail: {
          via: via,
          trigger: state.trigger,
          chars: state.chars,
          threshold: state.threshold,
        },
      })
    )
  }

  /**
   * Open the gate. Idempotent: the first call wins and every trigger is torn
   * down, so a timer and an observer can never both fire it.
   * @param {'scroll'|'timer'|'manual'} trigger
   */
  function reveal(trigger) {
    if (state.revealed) return
    if (!wrapper || !backdrop || !sheet) return

    // Last look before we touch anything. Memberstack may have resolved after
    // boot armed the trigger, and a member who can see no gate has no close
    // control inside it either — locking their scroll strands them on the page.
    // Checked here, before lockScroll(), on purpose.
    if (window.getComputedStyle(wrapper).display === 'none') {
      state.skipped = 'memberstack-hidden-late'
      teardownTriggers()
      info('wrapper went display:none after boot — standing down without locking')
      return
    }

    state.revealed = true
    state.trigger = trigger || 'manual'
    teardownTriggers()

    // Same Memberstack-has-now-decided moment as the guard above, so it reads
    // the close control here rather than at boot.
    resolveDismissible()

    lockScroll()

    if (typeof gsap !== 'undefined') {
      if (!timeline) timeline = buildTimeline()
      timeline.play()
    } else {
      warn('gsap absent, opening without animation')
      applyStyles(OPEN_STATE)
    }

    armDismissal()
    capture('learn_gate_shown')
    info('revealed via ' + state.trigger, { chars: state.chars, threshold: state.threshold })
    window.dispatchEvent(
      new CustomEvent('learn-gate-shown', {
        detail: { trigger: state.trigger, chars: state.chars, threshold: state.threshold },
      })
    )
  }

  /* --------------------------------- boot --------------------------------- */

  /**
   * Belt-and-braces closed state. learn-cta-gate.css owns this, but if the
   * stylesheet fails to load the gate would otherwise sit open permanently with
   * no animation. Applying it here degrades that to a brief flash.
   */
  function ensureClosed() {
    var computed = window.getComputedStyle(wrapper)
    if (computed.visibility !== 'hidden' && computed.opacity !== '0') {
      warn('closed state missing — is learn-cta-gate.css loaded in the head?')
      wrapper.style.visibility = 'hidden'
      wrapper.style.opacity = '0'
      wrapper.style.pointerEvents = 'none'
    }

    // Park the sheet off-screen through GSAP, never through CSS. GSAP reads the
    // computed transform as a pixel matrix, so a stylesheet `translateY(100%)`
    // lands in its `y` component and the tween's `yPercent` then stacks on top
    // of it — the sheet starts at 200% and finishes a full height low, animating
    // where nobody can see it. Owning the property from one side avoids that
    // entirely. The wrapper is already invisible, so this is not what hides it.
    if (typeof gsap !== 'undefined' && !prefersReducedMotion()) {
      gsap.set(sheet, { yPercent: 100 })
    }
  }

  function armScroll(crossing) {
    sentinel = plantSentinel(crossing)
    if (!sentinel || typeof IntersectionObserver !== 'function') {
      warn('cannot plant sentinel, falling back to the timer')
      armTimer()
      return
    }

    state.mode = 'scroll'
    observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            reveal('scroll')
            return
          }
        }
      },
      { threshold: 0 }
    )
    observer.observe(sentinel)
    info('armed on scroll at char ' + state.threshold + ' of ' + state.chars)
  }

  function armTimer() {
    state.mode = 'timer'
    timerId = setTimeout(function () {
      reveal('timer')
    }, state.delaySeconds * 1000)
    info('armed on timer, ' + state.delaySeconds + 's')
  }

  function boot() {
    if (state.booted) return
    state.booted = true

    wrapper = document.querySelector(WRAPPER_SELECTOR)
    if (!wrapper) {
      state.skipped = 'no-wrapper'
      return // Not a Learn article. Silent: this is the normal case elsewhere.
    }
    if (wrapper.getAttribute(INIT_ATTR) === 'true') {
      state.skipped = 'already-initialized'
      return
    }

    // Memberstack's call, not ours. Exit before writing ANY style.
    if (window.getComputedStyle(wrapper).display === 'none') {
      state.skipped = 'memberstack-hidden'
      info('wrapper is display:none — member has learn-access, standing down')
      return
    }

    backdrop = wrapper.querySelector(BACKDROP_SELECTOR)
    sheet = wrapper.querySelector(CONTENT_SELECTOR)
    if (!backdrop || !sheet) {
      state.skipped = 'missing-parts'
      warn('wrapper found but ' + (backdrop ? 'content' : 'backdrop') + ' is missing')
      return
    }

    wrapper.setAttribute(INIT_ATTR, 'true')
    ensureClosed()

    state.threshold = intAttr(wrapper, 'data-learn-gate-chars', DEFAULT_CHARS)
    state.delaySeconds = intAttr(wrapper, 'data-learn-gate-delay', DEFAULT_DELAY_SECONDS)

    // Motion is read once, here, so `status()` reports what will actually play
    // rather than what the timeline would compute later.
    state.motion = {
      ease: easeAttr(wrapper, 'data-learn-gate-ease', DEFAULT_EASE),
      duration: floatAttr(wrapper, 'data-learn-gate-duration', DEFAULT_DURATION, 0.05),
      fadeDuration: floatAttr(wrapper, 'data-learn-gate-fade', DEFAULT_FADE_DURATION, 0.05),
      lag: floatAttr(wrapper, 'data-learn-gate-lag', DEFAULT_LAG, 0),
    }

    var articleSelector =
      wrapper.getAttribute('data-learn-gate-article') || DEFAULT_ARTICLE_SELECTOR
    var article = document.querySelector(articleSelector)

    if (!article) {
      // Cannot measure, so fall back to the timer rather than never gating.
      // Failing toward "the gate still appears" is the right direction here:
      // the alternative silently gives the whole article away.
      state.skipped = 'no-article'
      warn('no article matched "' + articleSelector + '", falling back to the timer')
      armTimer()
      return
    }

    var nodes = textNodes(article)
    var measured = measure(nodes, state.threshold)
    state.chars = measured.total

    if (measured.total >= state.threshold && measured.crossing) {
      armScroll(measured.crossing)
    } else {
      armTimer()
    }
  }

  /* --------------------------------- API ---------------------------------- */

  window.StartersLearnCtaGate = {
    release: RELEASE,
    stagingHost: stagingHost,
    diagnosticsEnabled: diagnosticsEnabled,
    status: function () {
      return {
        release: state.release,
        mode: state.mode,
        revealed: state.revealed,
        dismissible: state.dismissible,
        dismissed: state.dismissed,
        dismissedVia: state.dismissedVia,
        trigger: state.trigger,
        chars: state.chars,
        threshold: state.threshold,
        delaySeconds: state.delaySeconds,
        skipped: state.skipped,
        hasSentinel: !!sentinel,
        motion: {
          ease: state.motion.ease,
          duration: state.motion.duration,
          fadeDuration: state.motion.fadeDuration,
          lag: state.motion.lag,
        },
        reducedMotion: prefersReducedMotion(),
      }
    },
    reveal: function () {
      reveal('manual')
    },
    dismiss: function () {
      dismiss('manual')
    },
  }

  /**
   * Boot only once Memberstack has had its say. `window.memberReady` is the
   * site's own readiness promise; boot on either settlement, because a rejected
   * promise still means "as resolved as this is going to get" and a gate that
   * never arms is worse than one that arms a beat late. Absent promise (an
   * older page, or a load failure) falls straight through to boot.
   */
  function start() {
    var ready = window.memberReady
    if (ready && typeof ready.then === 'function') {
      ready.then(boot, function () {
        warn('memberReady rejected — booting anyway')
        boot()
      })
      return
    }
    info('no memberReady on the page, booting immediately')
    boot()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
