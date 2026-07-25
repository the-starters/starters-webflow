/* ============================================================================
 * Starters — hide elements whose section is missing / hidden / empty,
 *            and hide the empty sections themselves
 * ----------------------------------------------------------------------------
 * THE GRAMMAR (this is the whole setup — two attribute families, keyed)
 *
 *   On a SECTION:
 *     data-hide-when-empty-section="<key>"    e.g. "overview", "reviews"
 *       Marks the section as participating, under <key>. A marked section also
 *       hides ITSELF when it is empty — the self-hide is implicit in the
 *       marking, there is no separate opt-in attribute any more.
 *
 *   On EVERY element that must disappear with it (desktop nav link, mobile nav
 *   link, tab button, anchor chip — as many as you like):
 *     data-hide-when-empty-element="<role>"   e.g. "link"  (role tag, any value)
 *     data-hide-when-empty-id="<key>"         must match the section's <key>
 *
 * WEBFLOW EXAMPLE — REVIEWS
 *   REVIEWS section      data-hide-when-empty-section = "reviews"
 *                        data-empty-watch             = ".review-card"
 *   REVIEWS nav button   data-hide-when-empty-element = "link"
 *                        data-hide-when-empty-id      = "reviews"
 *
 *   Result: while no visible `.review-card` exists inside the section, the nav
 *   button hides AND the section hides. A review landing later (CMS render,
 *   fetch, conditional visibility flipping) brings both back by itself.
 *
 * PARTICIPATION RULES
 *   - An element participates iff it has `data-hide-when-empty-id`.
 *     `data-hide-when-empty-element` is a human-readable role tag: any value is
 *     accepted, only its presence is conventional. An element carrying just
 *     `-id` (role tag forgotten) still participates — deliberately forgiving.
 *   - Untagged elements are NEVER touched. No selector-based auto-detection
 *     exists any more: nothing happens without the attributes above.
 *   - Several elements may share one <key> (desktop + mobile nav): they all
 *     follow that section.
 *   - If several sections carry the SAME <key>, the FIRST one in document order
 *     wins and the rest are ignored entirely (they also do not self-hide).
 *
 * AN ELEMENT HIDES WHEN ITS KEYED SECTION IS
 *   (a) VISUALLY HIDDEN — display:none / detached / hidden ancestor; or
 *   (b) EMPTY — by the rules below.
 *   If NO section anywhere carries the element's key, the element STAYS
 *   VISIBLE and a console warning names the key, once per key per page load —
 *   a missing key is almost always a setup mistake (the section attribute was
 *   forgotten), so the script fails safe instead of hiding a good button.
 *   (Webflow never removes conditionally-hidden sections from the DOM, so the
 *   hidden/empty rules cover every real case; "section truly absent" only
 *   happens on misconfiguration.)
 *   It un-hides again (restoring the exact inline `display` it had before) as
 *   soon as the section reappears or gains content. Everything is re-evaluated
 *   on DOM changes via one debounced MutationObserver, because profile content
 *   arrives asynchronously.
 *
 * WEBFLOW SETUP FOR THE EMPTINESS TEST (unchanged — same attributes as before)
 *   data-empty-watch="<selector>" on a SECTION  → RECOMMENDED. Overrides the
 *                                                 emptiness test: the section is
 *                                                 empty iff
 *                                                 section.querySelectorAll(selector)
 *                                                 has zero VISIBLE matches. This
 *                                                 is the intended way to define
 *                                                 what counts as a review /
 *                                                 highlight / service item.
 *   data-empty-container          on a WRAPPER  → marks the content container whose
 *                                                 direct children are the items
 *   data-empty-ignore             on any child  → never counts as content
 *
 * HOW THE DEFAULT (no data-empty-watch) DECIDES "EMPTY" — first rule that
 * applies wins. The bias is deliberately toward "NOT empty": leaving a nav
 * button visible is a much smaller failure than hiding a button for a section
 * that actually has content. Same bias everywhere else: any error, any
 * ambiguous/misconfigured attribute → the element stays visible.
 *
 *   1. `data-empty-watch` present → empty iff zero visible, non-template
 *      matches of that selector inside the section. (Explicit override.)
 *
 *   2. Otherwise, if the section contains one or more content containers
 *      (`[data-empty-container]` or `[data-highlights]`) → empty iff NONE of
 *      those containers has a "meaningful" direct child. Meaningful = element
 *      child that is not a template/control (`.js-template`,
 *      `[data-btn-view-all]`, `[data-empty-ignore]`, `.w-dyn-empty`,
 *      `.w-condition-invisible`) and is not itself hidden.
 *
 *   3. Otherwise, if the section contains a Webflow Collection List
 *      (`.w-dyn-list`) → at least one visible, non-template
 *      `.w-dyn-items > .w-dyn-item` anywhere in the section means NOT empty,
 *      and the decision stops there.
 *      Zero visible items does NOT by itself mean empty: the section may still
 *      hold real prose beside the list (a bio heading and paragraphs, say), and
 *      hiding that would be the worse failure. So a zero-item list falls
 *      THROUGH to rule 4 instead of concluding anything. A section that must
 *      hide on an empty Collection List wants `data-empty-watch` (rule 1).
 *      Knock-on worth knowing: a section whose ONLY content is an empty
 *      Collection List now stays visible whenever Webflow renders its
 *      `.w-dyn-empty` "No items found" state, because that text is substance
 *      under rule 4. With no text anywhere it still hides.
 *
 *   4. Otherwise the SECTION ITSELF is treated as the content container:
 *        - count its direct element children that are visible, not
 *          templates/controls, and have substance (non-whitespace text, or an
 *          img/svg/video/iframe/form control, or a background-image);
 *        - zero such children → empty;
 *        - if there ARE such children but the section has no visible text at
 *          all AND contains no media/interactive element → also empty
 *          (the "visible text content is empty" rule).
 *
 *   KNOWN LIMIT of rules 3 + 4: a section built as "heading + separately-filled
 *   list" is NOT detected as empty by the default — rule 3 refuses to call a
 *   zero-item Collection List empty on its own, and under rule 4 the heading
 *   text counts as substance. That is deliberate: "heading + empty list" stays
 *   VISIBLE by default. It is also exactly what `data-empty-watch` is for — put
 *   it on such sections (REVIEWS being the expected case).
 *
 * NOTES
 *   - Only `style.display` is written, and only when the value actually
 *     changes. The observer watches childList+subtree ONLY (no attributes, no
 *     characterData), so the script's own style/attribute writes can never
 *     retrigger it — the loop provably converges. (Reading attributes is of
 *     course fine; it is OBSERVING them that would loop.)
 *   - The script remembers the inline `display` it replaced and restores
 *     exactly that value when un-hiding, so it never invents styles.
 *   - Self-hide is now implicit in `data-hide-when-empty-section`, so do NOT mark
 *     a section whose inline `style.display` another script already owns (e.g. a
 *     HIGHLIGHTS panel a different script shows/hides): two owners of the same
 *     inline property fight. Leave such a section unmarked AND leave its nav
 *     element untagged — a tagged element whose key matches no marked section
 *     stays visible and warns, it is never hidden.
 *   - `display: contents` wrappers are handled correctly by the visibility
 *     check. Webflow's `display-contents` utility class sits on `.w-dyn-list` /
 *     `.w-dyn-items` / `.w-dyn-item` wrappers site-wide; such an element
 *     generates no box of its own (no client rects, null `offsetParent`) while
 *     its CHILDREN render normally, so it counts as VISIBLE whenever anything
 *     inside it renders — never as an invisible item.
 *   - Unmarked sections are invisible to this script even if they exist in the
 *     DOM: keys resolve against `data-hide-when-empty-section`, never against
 *     element ids or link hrefs.
 *   - Console silence by design, with exactly two exceptions: (1) if the page
 *     has no `data-hide-when-empty-id` elements at all, it warns once that it
 *     is idle; (2) a tagged element whose key matches no marked section warns
 *     once per key (see above). (A section marked with `-section` still
 *     self-hides on such a page — the two halves of the grammar are
 *     independent.)
 *   - `window.__startersEmptyNavRefresh()` forces a (debounced) re-evaluation
 *     if another script wants to poke it after rendering.
 * ==========================================================================*/

(function () {
  'use strict';

  if (window.__startersEmptyNavInit) return;
  window.__startersEmptyNavInit = true;

  /* The grammar. */
  var ATTR_SECTION_KEY = 'data-hide-when-empty-section'; // on the section
  /* `data-hide-when-empty-element="<role>"` is the conventional role tag on a
     hideable element. It is intentionally NEVER read: any value is accepted and
     an element that carries only `-id` still participates. Named here so the
     grammar is greppable from the code. */
  var ATTR_ELEMENT_ROLE = 'data-hide-when-empty-element'; // eslint-disable-line no-unused-vars
  var ATTR_ELEMENT_KEY = 'data-hide-when-empty-id';       // on the element

  var SECTION_SELECTOR = '[' + ATTR_SECTION_KEY + ']';
  var ELEMENT_SELECTOR = '[' + ATTR_ELEMENT_KEY + ']';

  var ATTR_WATCH = 'data-empty-watch';
  var CONTAINER_SELECTOR = '[data-empty-container],[data-highlights]';

  /* Children that never count as content. */
  var IGNORE_SELECTOR = [
    '.js-template',
    '[data-btn-view-all]',
    '[data-empty-ignore]',
    '.w-dyn-empty',
    '.w-condition-invisible'
  ].join(',');

  /* "Substance" markers used by the section-as-container fallback. */
  var MEDIA_SELECTOR = 'img,svg,picture,video,iframe,canvas,input,select,textarea,button';

  /* Markers holding the inline display value this script replaced.
     Attribute PRESENT === "this script hid it". */
  var MARK_ELEMENT = 'data-starters-element-hidden';
  var MARK_SECTION = 'data-starters-section-hidden';

  var DEBOUNCE_MS = 200;

  var warnedIdle = false;
  var warnedMissingKeys = [];
  var timerId = null;
  /* Sections currently hidden BY THIS SCRIPT (needs to survive between passes
     so they can be released before measuring). */
  var sectionsHiddenByUs = [];

  /* ---------------------------------------------------------------- helpers */

  function toArray(listLike) {
    var out = [];
    if (!listLike) return out;
    for (var i = 0; i < listLike.length; i++) out.push(listLike[i]);
    return out;
  }

  function safeMatches(el, selector) {
    if (!el || el.nodeType !== 1 || !el.matches) return false;
    try {
      return el.matches(selector);
    } catch (e) {
      return false;
    }
  }

  function safeQueryAll(root, selector) {
    if (!root || !root.querySelectorAll) return [];
    try {
      return toArray(root.querySelectorAll(selector));
    } catch (e) {
      return [];
    }
  }

  /* Does anything INSIDE this element generate a box? Walks descendants and
     stops at the first one that does — nothing is collected, so the common case
     (first child renders) costs one measurement. Recurses through children that
     generate no box themselves, because a `display: contents` wrapper can nest
     inside another one. */
  function hasRenderedDescendant(el) {
    if (!el || !el.children) return false;
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      try {
        if (kid.getClientRects && kid.getClientRects().length) return true;
      } catch (e) {
        /* unmeasurable child → ignore it and keep looking */
      }
      if (hasRenderedDescendant(kid)) return true;
    }
    return false;
  }

  /* Robust "is this element not rendered?" check.
     display:none / detached / inside a hidden ancestor → no client rects.
     display:contents generates NO box of its own by spec (no client rects, null
     offsetParent) while its children render normally — Webflow's
     `display-contents` utility class sits on `.w-dyn-list` / `.w-dyn-items` /
     `.w-dyn-item` wrappers, so falling through to the offsetParent test would
     report every Collection List item as invisible and every list as empty.
     Such a wrapper is hidden only when NOTHING inside it renders.
     position:fixed elements have no offsetParent, hence the explicit branch. */
  function isHidden(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.isConnected === false) return true;
    if (el.getClientRects && el.getClientRects().length) return false;

    var cs = null;
    try {
      cs = window.getComputedStyle(el);
    } catch (e) {
      cs = null;
    }
    if (!cs) return true;
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    if (cs.display === 'contents') return !hasRenderedDescendant(el);
    if (cs.position === 'fixed') return false;
    return el.offsetParent === null;
  }

  function isIgnorable(el) {
    return safeMatches(el, IGNORE_SELECTOR);
  }

  function hasText(el) {
    if (!el) return false;
    var text = typeof el.innerText === 'string' ? el.innerText : el.textContent;
    if (!text) return false;
    return text.replace(/[\s ]+/g, '') !== '';
  }

  function hasBackgroundImage(el) {
    var cs = null;
    try {
      cs = window.getComputedStyle(el);
    } catch (e) {
      cs = null;
    }
    return !!(cs && cs.backgroundImage && cs.backgroundImage !== 'none');
  }

  function hasMedia(el) {
    if (safeMatches(el, MEDIA_SELECTOR)) return true;
    if (el.querySelector && safeQueryAll(el, MEDIA_SELECTOR).length) return true;
    return false;
  }

  function hasSubstance(el) {
    if (hasText(el)) return true;
    if (hasMedia(el)) return true;
    if (hasBackgroundImage(el)) return true;
    return false;
  }

  /* Counts direct element children that count as content. */
  function countMeaningfulChildren(container, requireSubstance) {
    if (!container || !container.children) return 0;
    var kids = container.children;
    var count = 0;
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (isIgnorable(kid)) continue;
      if (isHidden(kid)) continue;
      if (requireSubstance && !hasSubstance(kid)) continue;
      count++;
    }
    return count;
  }

  function hasVisibleMatch(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (isIgnorable(nodes[i])) continue;
      if (isHidden(nodes[i])) continue;
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------- emptiness rules */

  function isSectionEmpty(section) {
    if (!section) return false;

    /* 1. explicit per-section override */
    if (section.hasAttribute(ATTR_WATCH)) {
      var selector = (section.getAttribute(ATTR_WATCH) || '').trim();
      if (!selector) return false; // misconfigured → never hide
      var watched = safeQueryAll(section, selector);
      return !hasVisibleMatch(watched);
    }

    /* 2. designated content containers */
    var containers = safeQueryAll(section, CONTAINER_SELECTOR);
    if (containers.length) {
      for (var i = 0; i < containers.length; i++) {
        if (countMeaningfulChildren(containers[i], false) > 0) return false;
      }
      return true;
    }

    /* 3. Webflow Collection List — one visible item settles it (NOT empty).
       Zero visible items settles NOTHING: the section may still carry real
       prose beside the list, so fall through to rule 4 rather than hide it.
       Sections that must hide on an empty list use `data-empty-watch`. */
    if (safeQueryAll(section, '.w-dyn-list').length) {
      var items = safeQueryAll(section, '.w-dyn-items > .w-dyn-item');
      if (hasVisibleMatch(items)) return false;
    }

    /* 4. the section is its own content container */
    if (countMeaningfulChildren(section, true) === 0) return true;
    if (!hasText(section) && !hasMedia(section)) return true;
    return false;
  }

  /* ------------------------------------------------------- hide / un-hide */

  function hideEl(el, mark) {
    if (!el || el.nodeType !== 1) return;
    if (!el.hasAttribute(mark)) {
      el.setAttribute(mark, el.style.display || '');
    }
    if (el.style.display !== 'none') {
      el.style.display = 'none';
    }
  }

  function showEl(el, mark) {
    if (!el || el.nodeType !== 1) return;
    if (!el.hasAttribute(mark)) return; // this script never hid it → leave alone
    var previous = el.getAttribute(mark) || '';
    el.removeAttribute(mark);
    /* Only give the inline property back if it still holds OUR value; if some
       other script changed it meanwhile, respect that script. */
    if (el.style.display === 'none' && el.style.display !== previous) {
      el.style.display = previous;
    }
  }

  /* Release the sections this script hid, so their content can be measured.
     Paired writes (release now, possibly re-hide a few lines later) happen
     inside a single task — no paint and no observer callback in between. */
  function releaseHiddenSections() {
    var previously = sectionsHiddenByUs;
    sectionsHiddenByUs = [];
    for (var i = 0; i < previously.length; i++) {
      showEl(previously[i], MARK_SECTION);
    }
  }

  /* --------------------------------------------------------------- keying */

  function keyOf(el, attr) {
    var raw = el && el.getAttribute ? el.getAttribute(attr) : null;
    return typeof raw === 'string' ? raw.replace(/^\s+|\s+$/g, '') : '';
  }

  /* ------------------------------------------------------------- main pass */

  function evaluate() {
    /* Participation is decided by `-id` alone; `-element` is a role tag whose
       value we never inspect, so an element missing it still participates. */
    var elements = safeQueryAll(document, ELEMENT_SELECTOR);

    if (!elements.length && !warnedIdle) {
      warnedIdle = true;
      console.warn('[starters] no [' + ATTR_ELEMENT_KEY + '] elements on this page — hide-when-empty is idle.');
    }

    /* Give back the sections we hid, so their real content can be measured. */
    releaseHiddenSections();

    /* key → section. First marked section per key wins; duplicates are ignored
       completely (they do not self-hide either). */
    var keys = [];
    var keyedSections = [];
    var marked = safeQueryAll(document, SECTION_SELECTOR);
    for (var m = 0; m < marked.length; m++) {
      var sectionKey = keyOf(marked[m], ATTR_SECTION_KEY);
      if (!sectionKey) continue;                  // blank key → misconfigured
      if (keys.indexOf(sectionKey) !== -1) continue; // duplicate key → ignore
      keys.push(sectionKey);
      keyedSections.push(marked[m]);
    }

    /* Measure every participating section BEFORE writing anything, so hiding
       one section can never disturb another section's measurement. */
    var states = [];
    for (var s = 0; s < keyedSections.length; s++) {
      states.push({
        el: keyedSections[s],
        hidden: isHidden(keyedSections[s]),
        empty: isSectionEmpty(keyedSections[s])
      });
    }

    /* Decide each tagged element against its keyed section. */
    var decisions = [];
    for (var e = 0; e < elements.length; e++) {
      var wanted = keyOf(elements[e], ATTR_ELEMENT_KEY);
      if (!wanted) {
        decisions.push(false); // blank key → ambiguous → stay visible
        continue;
      }
      var index = keys.indexOf(wanted);
      if (index === -1) {
        /* No section carries that key: almost always a setup mistake (the
           section attribute was forgotten), so fail safe — leave the element
           visible and say why, once per key per page load. */
        if (warnedMissingKeys.indexOf(wanted) === -1) {
          warnedMissingKeys.push(wanted);
          console.warn('[starters] no section with ' + ATTR_SECTION_KEY + '="' + wanted + '" — leaving its elements visible.');
        }
        decisions.push(false);
        continue;
      }
      decisions.push(states[index].hidden || states[index].empty);
    }

    /* Sections self-hide when empty — implicit in being marked. */
    for (var i = 0; i < states.length; i++) {
      if (states[i].empty) {
        hideEl(states[i].el, MARK_SECTION);
        sectionsHiddenByUs.push(states[i].el);
      }
    }

    /* Tagged elements. */
    for (var j = 0; j < elements.length; j++) {
      if (decisions[j]) {
        hideEl(elements[j], MARK_ELEMENT);
      } else {
        showEl(elements[j], MARK_ELEMENT);
      }
    }
  }

  function run() {
    try {
      evaluate();
    } catch (e) {
      /* Stay silent by design: this is cosmetic cleanup and must never break
         the page or spam the console. */
    }
  }

  function schedule() {
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(function () {
      timerId = null;
      run();
    }, DEBOUNCE_MS);
  }

  function boot() {
    run();

    if (typeof MutationObserver === 'function') {
      var observer = new MutationObserver(schedule);
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
      /* Never disconnected: profile content can land very late. */
    }

    /* Cheap safety net for content that lands with late assets. */
    window.addEventListener('load', schedule);
  }

  window.__startersEmptyNavRefresh = schedule;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
