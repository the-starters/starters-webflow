/**
 * Learn CTA gate — open the sign-up gate once the reader has read enough of a
 * Learn article, or after a short wait on articles too short to scroll.
 *
 * @release v1.59.166
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
 * THE MARKUP (Designer-authored, all three already exist):
 *   [data-learn-gate-element="wrapper"]   section_learn-cta-gate
 *                                         position:fixed, inset 0, z-index 10,
 *                                         display:flex, column, justify-end
 *   [data-learn-gate-element="backdrop"]  learn-cta-gate_backdrop, absolute inset 0
 *   [data-learn-gate-element="content"]   learn-cta-gate_contents, the sheet
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
 * the scroll of a member who can see no gate and has no way to unlock it: the
 * gate is invisible, there is no close control, and the timeline never
 * reverses. So this embed waits on `window.memberReady` — the site's own
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
 * ONCE ONLY. The gate has no close control by design (hard gate). The timeline
 * plays forward exactly once and is never reversed, so the unlock half of the
 * scroll lock is unreachable today. It is written anyway so that adding a close
 * button later is a UI change, not a rewrite.
 *
 * Scroll lock is byte-for-byte the modal.js line (global-embeds/modal/modal.js):
 * prefer `lenis.stop()`, else `document.body.style.overflow`. There is no Lenis
 * instance on the Learn template today, so it takes the body-overflow branch.
 *
 * Attributes on the wrapper, all optional:
 *   data-learn-gate-chars    integer, default 2500. Threshold in characters.
 *   data-learn-gate-delay    seconds, default 10. Short-article wait.
 *   data-learn-gate-article  CSS selector for the article body.
 *                            Default ".content_rte.w-richtext".
 *
 * Diagnostics are console-only and gated to staging hosts (`*.webflow.io`,
 * `localhost`, `127.0.0.1`, `*.trycloudflare.com`) or `window.STARTERS_DEBUG`.
 * Production stays silent.
 *
 * Debug from the console: `StartersLearnCtaGate.status()`, or force it open
 * with `StartersLearnCtaGate.reveal()`.
 */
;(function () {
  'use strict'

  // Window-level init guard, matching the other embeds (turnstile-contents-fix.js
  // uses the same shape). An IIFE-local flag cannot stop a duplicate script tag:
  // the second IIFE would still run to completion and overwrite the public API
  // with its own dud instance before discovering the wrapper was already armed.
  if (window.__startersLearnCtaGateBooted) return
  window.__startersLearnCtaGateBooted = true

  var RELEASE = 'v1.59.166'
  var LOG_PREFIX = '[learn-cta-gate]'

  var WRAPPER_SELECTOR = '[data-learn-gate-element="wrapper"]'
  var BACKDROP_SELECTOR = '[data-learn-gate-element="backdrop"]'
  var CONTENT_SELECTOR = '[data-learn-gate-element="content"]'
  var DEFAULT_ARTICLE_SELECTOR = '.content_rte.w-richtext'

  var DEFAULT_CHARS = 2500
  var DEFAULT_DELAY_SECONDS = 10

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
  }

  var wrapper = null
  var backdrop = null
  var sheet = null
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

  function track() {
    var posthog = window.posthog
    if (!posthog || typeof posthog.capture !== 'function') {
      info('posthog absent, skipping learn_gate_shown')
      return
    }
    try {
      posthog.capture('learn_gate_shown', {
        slug: articleSlug(),
        trigger: state.trigger,
        chars: state.chars,
        threshold: state.threshold,
        release: RELEASE,
      })
    } catch (err) {
      // Analytics must never break the gate.
      warn('posthog.capture threw', err)
    }
  }

  // The wrapper's open state, written once so the GSAP path and the no-GSAP
  // path cannot drift apart. GSAP takes it as tween vars; applyOpenStyles()
  // writes the same values as inline styles.
  var OPEN_WRAPPER = { visibility: 'visible', pointerEvents: 'auto', opacity: 1 }

  /** Final open state, applied directly when GSAP is unavailable. */
  function applyOpenStyles() {
    wrapper.style.visibility = OPEN_WRAPPER.visibility
    wrapper.style.pointerEvents = OPEN_WRAPPER.pointerEvents
    wrapper.style.opacity = String(OPEN_WRAPPER.opacity)
    backdrop.style.opacity = '1'
    sheet.style.transform = 'translateY(0%)'
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
        { opacity: 1, duration: 0.2, ease: 'none' }
      )
      return tl
    }

    tl.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' })
    // '<0.15' — start the slide 0.15s into the backdrop fade, so the dimming
    // reads first and the sheet arrives into an already-darkened page.
    tl.fromTo(
      sheet,
      { yPercent: 100 },
      { yPercent: 0, duration: 0.6, ease: 'power3.out' },
      '<0.15'
    )
    return tl
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
    // boot armed the trigger, and the scroll lock below is irreversible in a
    // gate with no close control — locking a member who cannot see the gate
    // strands them on the page. Checked here, before lockScroll(), on purpose.
    if (window.getComputedStyle(wrapper).display === 'none') {
      state.skipped = 'memberstack-hidden-late'
      teardownTriggers()
      info('wrapper went display:none after boot — standing down without locking')
      return
    }

    state.revealed = true
    state.trigger = trigger || 'manual'
    teardownTriggers()

    lockScroll()

    if (typeof gsap !== 'undefined') {
      if (!timeline) timeline = buildTimeline()
      timeline.play()
    } else {
      warn('gsap absent, opening without animation')
      applyOpenStyles()
    }

    track()
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
        trigger: state.trigger,
        chars: state.chars,
        threshold: state.threshold,
        delaySeconds: state.delaySeconds,
        skipped: state.skipped,
        hasSentinel: !!sentinel,
      }
    },
    reveal: function () {
      reveal('manual')
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
