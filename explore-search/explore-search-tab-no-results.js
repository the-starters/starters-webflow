/* explore-search-tab-no-results.js — per-tab "No matches found." for the tabbed federated search.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds.
 *
 * The problem it fixes: this is a TABBED federated search (one tab per index).
 * The wf-algolia engine only reveals the single shared no-results element when
 * the WHOLE federated search (all indices combined) returns 0 hits — otherwise
 * it just hides each 0-hit section individually. So when the ACTIVE tab's
 * section is empty but ANOTHER tab still has hits, the engine keeps no-results
 * hidden and the active tab looks blank, with no "No matches found." message.
 *
 * What it does: shows that shared no-results element whenever the ACTIVE tab's
 * panel has no populated section — even if another tab has hits — and hides it
 * again the moment the active tab has a populated section. The existing global
 * behavior is preserved (both tabs empty still shows it). On an EMPTY query it
 * always force-hides it: explore-search-default-results.js fills both sections
 * with default items then, so "No matches found." would be wrong (this also
 * covers the pre-render initial load, so there is no flash).
 *
 * Required markup (the tabbed federated layout):
 *   input[wf-algolia-element="search-input"]
 *   [wf-algolia-element="results"]
 *     [data-tab-component="panel-list"]
 *       <panel> … [wf-algolia-element="section"] …    (one panel per tab)
 *     [wf-algolia-element="no-results"]
 *   tabs.js flips data-tab-active="true" onto the active panel (and its button).
 *
 * How it reads "empty": the engine signals a 0-hit section by inline-setting the
 * SECTION's own style.display="none" (a section WITH hits gets real hit-card
 * children appended and its inline display cleared). Every section also always
 * contains a structural section-label plus a hidden template, so an EMPTY
 * section still has a non-template child — the populated check therefore tests
 * style.display FIRST and only then looks for a non-template child.
 *
 * How it forces the toggle: when one tab has hits, the engine sets the shared
 * no-results element's OWN inline style.display="none". A plain inline write
 * would be fought by the engine, so this embed toggles a stylesheet class that
 * uses !important (an !important stylesheet declaration beats a normal inline
 * declaration in the cascade). It mutates ONLY the no-results element's classList.
 *
 * Kept correct via a MutationObserver on the results container (child + style
 * changes as the engine re-renders) plus a click hook on the tab button-list
 * (re-evaluate after tabs.js flips the active panel). Evaluations are coalesced
 * onto a single 0ms timeout (not rAF — animation-frame callbacks are suspended
 * while the tab is backgrounded; a plain timeout still runs).
 *
 * Coordinates with explore-search-list-loader.js: that sibling masks the
 * panel-list with inline visibility:hidden while an Algolia "/queries" request is
 * in flight, reserving the old (taller) height. This embed's no-results element
 * sits AFTER the panel-list, so while the mask is up it DEFERS revealing the
 * message — otherwise it would render low, then visibly jump to the top when the
 * mask lifts and the empty panel collapses. The MutationObserver already watches
 * the subtree's style changes, so when the loader restores visibility, evaluate()
 * re-fires and the message appears once, in its final spot.
 *
 * Bails out quietly if the results / no-results / panel-list / section markup is
 * absent (feature only applies to the tabbed layout). Never throws (defensive
 * try/catch) — must not break the page.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-tab-no-results.js
 */
(function () {
  if (window.__exploreSearchTabNoResultsInit) return;
  window.__exploreSearchTabNoResultsInit = true;

  var STYLE_ID = "starters-es-tab-no-results-style";
  var SHOW_CLASS = "starters-es-no-results--show";
  var HIDE_CLASS = "starters-es-no-results--hide";

  function init() {
    try {
      /* --- Locate the feature markup (defer = DOM parsed) --- */
      var resultsEl = document.querySelector('[wf-algolia-element="results"]');
      var input = document.querySelector(
        'input[wf-algolia-element="search-input"]'
      );
      if (!resultsEl || !input) return; // feature absent — bail quietly

      var noResultsEl = resultsEl.querySelector(
        '[wf-algolia-element="no-results"]'
      );
      var panelList = resultsEl.querySelector(
        '[data-tab-component="panel-list"]'
      );
      // Only applies to the tabbed layout with a shared no-results element.
      if (!noResultsEl || !panelList) return;
      // Nothing to judge if there are no sections at all.
      if (!resultsEl.querySelector('[wf-algolia-element="section"]')) return;

      /* --- Inject the forcing stylesheet once (id-guarded). The engine sets the
         no-results element's OWN inline display:none when another tab has hits,
         so !important declarations are needed to override that inline rule. --- */
      if (!document.getElementById(STYLE_ID)) {
        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent =
          "." + SHOW_CLASS + " { display: block !important; }" +
          "." + HIDE_CLASS + " { display: none !important; }";
        (document.head || document.documentElement).appendChild(style);
      }

      /* --- Helpers --- */

      /* A section is "populated" only if the engine has NOT inline-hidden it AND
         it has at least one non-template child. The display:none test MUST come
         first (fact of this engine): an empty section still keeps its structural
         section-label child, so counting children alone would misread it as
         populated. */
      function isSectionPopulated(section) {
        if (section.style.display === "none") return false;
        var children = section.children;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (
            child.matches &&
            !child.matches('[wf-algolia-element="template"]')
          ) {
            return true;
          }
        }
        return false;
      }

      /* The active panel is the one tabs.js flagged; before tabs.js runs, fall
         back to the first panel (matches the default-visible tab). */
      function getActivePanel() {
        return (
          panelList.querySelector(':scope > [data-tab-active="true"]') ||
          panelList.firstElementChild
        );
      }

      function isActivePanelEmpty() {
        var panel = getActivePanel();
        if (!panel) return false;
        var sections = panel.querySelectorAll('[wf-algolia-element="section"]');
        if (!sections.length) return false; // nothing to judge → treat as not empty
        for (var i = 0; i < sections.length; i++) {
          if (isSectionPopulated(sections[i])) return false;
        }
        return true;
      }

      function showNoResults() {
        noResultsEl.classList.add(SHOW_CLASS);
        noResultsEl.classList.remove(HIDE_CLASS);
      }

      function hideNoResults() {
        noResultsEl.classList.add(HIDE_CLASS);
        noResultsEl.classList.remove(SHOW_CLASS);
      }

      function isListLoading() {
        // explore-search-list-loader.js masks the panel-list with inline
        // visibility:hidden while an Algolia "/queries" request is in flight
        // (min-display is configurable via data-loader). Our no-results element
        // sits AFTER the panel-list, so revealing it while the mask reserves the
        // old (taller) height would drop it low and make it jump to the top when
        // the mask lifts. Defer while masked; the MutationObserver below already
        // watches ['style'] on the subtree, so the loader restoring visibility
        // re-fires evaluate() and the message appears once, in its final spot.
        // No loader on the page => panel-list is never masked => never gated.
        try { return panelList.style.visibility === "hidden"; } catch (e) { return false; }
      }

      /* Tab-switch animation guard. An ANIMATED (GSAP) tab switch keeps the
         OUTGOING panel visible during the fade, so revealing the message mid-
         switch places it against the old height and it jumps to the top when the
         layout settles — only noticeable on wider screens, where the height
         delta is larger. While a switch is in flight we defer the reveal, then
         re-evaluate once. FAIL-SAFE: `switching` ALWAYS clears after the delay,
         so this can never leave the message stuck hidden (unlike checking a
         panel's computed display, which is fragile on nested Webflow markup). */
      var switching = false;
      var switchTimer = null;
      function switchDelayMs() {
        try {
          var wrap = document.querySelector('[data-tab-component="wrapper"]');
          var d = wrap && parseFloat(wrap.getAttribute("data-duration"));
          var dur = isFinite(d) && d > 0 ? d : 0.3; // seconds; tabs.js default 0.3
          return Math.max(400, Math.min(Math.round(dur * 1000 + 300), 1500));
        } catch (e) {
          return 600;
        }
      }

      function evaluate() {
        try {
          // Empty query → default-results owns the view; never show no-results
          // (also covers the pre-render initial load, so there is no flash).
          if ((input.value || "").trim() === "") {
            hideNoResults();
            return;
          }
          // Defer while the list-loader masks the panel-list, so the message
          // never appears mid-transition below the reserved height and jumps.
          if (isListLoading()) {
            hideNoResults();
            return;
          }
          // Defer while a tab switch is animating (see the click handler /
          // switchDelayMs): revealing mid-switch makes the message jump when the
          // layout settles.
          if (switching) {
            hideNoResults();
            return;
          }
          if (isActivePanelEmpty()) {
            showNoResults();
          } else {
            hideNoResults();
          }
        } catch (e) {
          /* never break the page */
        }
      }

      /* Coalesce mutation bursts into a single evaluate() on a 0ms timeout — NOT
         rAF: animation-frame callbacks are fully suspended while the tab is
         backgrounded (document.visibilityState "hidden"), but a 0ms timeout still
         runs, so evaluation happens (and is verifiable) even off-foreground. */
      var pending = false;
      function scheduleEvaluate() {
        if (pending) return;
        pending = true;
        var run = function () {
          pending = false;
          evaluate();
        };
        setTimeout(run, 0);
      }

      /* --- Wiring --- */

      /* Re-evaluate on any engine re-render: hit cards are added/removed
         (childList) and 0-hit sections are inline-hidden/shown (style attr).
         LOOP-SAFETY: this embed mutates ONLY the no-results element's classList —
         never its style attribute and never child nodes — so our own writes
         never satisfy this observer's ['style']/childList filters and cannot
         re-trigger it. Do NOT add 'class' to attributeFilter. */
      if (typeof window.MutationObserver === "function") {
        var observer = new MutationObserver(function () {
          scheduleEvaluate();
        });
        observer.observe(resultsEl, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style"]
        });
      }

      // Typing changes the query (and thus the empty-query guard).
      document.addEventListener("input", function (e) {
        if (e.target === input) scheduleEvaluate();
      });

      // Tab switch: hide the message immediately and hold the reveal across the
      // switch-animation window, then re-evaluate once it settles (prevents the
      // reveal-then-jump on animated switches). Rapid clicks just extend the
      // window; it always ends and re-evaluates, so the message can't stay hidden.
      document.addEventListener("click", function (e) {
        if (
          e.target.closest &&
          e.target.closest('[data-tab-component="button-list"]')
        ) {
          switching = true;
          hideNoResults();
          if (switchTimer) clearTimeout(switchTimer);
          switchTimer = setTimeout(function () {
            switching = false;
            scheduleEvaluate();
          }, switchDelayMs());
        }
      });

      // Initial pass (covers the authored/default state on load).
      scheduleEvaluate();
    } catch (e) {
      /* never break the page */
    }
  }

  /* Boot: deferred scripts run after parse (readyState "interactive"), so init
     runs immediately; guard for the "loading" case anyway (same as hide-empty). */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
