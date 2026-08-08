/* explore-search-tab-no-results.js — per-tab "no matches" message for the tabbed federated search.
 *
 * @release v1.59.129
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds.
 *
 * The problem it fixes: this is a TABBED federated search (one tab per index).
 * The wf-algolia engine only reveals the single shared no-results element when
 * the WHOLE federated search (all indices combined) returns 0 hits — otherwise
 * it just hides each 0-hit section individually. So when the ACTIVE tab's
 * section is empty but ANOTHER tab still has hits, the engine keeps no-results
 * hidden and the active tab looks blank, with no message at all.
 *
 * What it does: shows that shared no-results element whenever the ACTIVE tab's
 * panel has no populated section — even if another tab has hits — and hides it
 * again the moment the active tab has a populated section. The existing global
 * behavior is preserved (both tabs empty still shows it). On an EMPTY query it
 * always force-hides it: explore-search-default-results.js fills both sections
 * with default items then, so a "no matches" message would be wrong (this also
 * covers the pre-render initial load, so there is no flash).
 *
 * Required markup — this is the layout as ACTUALLY authored on the live page,
 * which is NOT what an earlier version of this comment claimed: the shared
 * no-results element is a child of the panel-list, not its sibling.
 *
 *   [wf-algolia-element="search-wrapper"]
 *     input[wf-algolia-element="search-input"]
 *     [wf-algolia-element="results"]                 (also data-tab-component="wrapper")
 *       [data-tab-component="button-list"]           one button per tab
 *       [data-tab-component="panel-list"]
 *         <panel>  … [wf-algolia-element="section"] …    (one panel per tab)
 *         <panel>  … [wf-algolia-element="section"] …
 *         [wf-algolia-element="no-results"]          <-- INSIDE panel-list, last child
 *   tabs.js flips data-tab-active="true" onto the active panel (and its button).
 *
 * Consequences of that real nesting, all handled below:
 * - The no-results element is a DIRECT CHILD of panel-list, so it lands in the
 *   candidate set for "which panel is active". global-embeds/tabs/tabs.js makes
 *   exactly that mistake: it counts panel-list's children as panels, logs
 *   "Tab button/panel count mismatch: 2 buttons vs 3 panels", and stamps
 *   data-tab-active="false" plus an inline display:none onto the no-results
 *   element like any other panel. This embed must not repeat it — an "active
 *   panel" holding no section would read as NOT empty and the message would
 *   never show. getActivePanel() below therefore only ever accepts a child that
 *   is not the no-results element AND actually contains a section.
 * - tabs.js's inline display:none on the no-results element is one more reason
 *   the forcing class has to use !important (see below); it is not only the
 *   engine writing that inline style.
 * - The message sits INSIDE the region explore-search-list-loader.js masks, so
 *   it is masked along with it (see isListLoading()).
 *
 * Finding the right markup (this page is NOT single-widget):
 * - The same page also carries wf-algolia BROWSE widgets, and every one of them
 *   owns its own [wf-algolia-element="results"] container. On the live site
 *   three browse widgets (the cancel-membership expert lists) sit EARLIER in
 *   document order than the search UI, so a bare
 *   document.querySelector('[wf-algolia-element="results"]') resolves to a
 *   browse widget's container — which is exactly the bug that left this whole
 *   feature dead: no-results and panel-list both came back null and the embed
 *   returned before it even injected its stylesheet. Memberstack deletes those
 *   browse widgets shortly after load, which is why the selector looks
 *   unambiguous when you inspect the settled page in devtools.
 * - This embed instead walks a ladder: the search wrapper's own results
 *   container that carries the tabbed markup, else any container in the
 *   document carrying it, else the first container a browse widget does not
 *   own. Every rung skips browse-owned containers. The input is resolved the
 *   same browse-guarded way.
 * - The resolution helpers (inBrowseWidget / firstOutsideBrowse /
 *   resolveResultsEl / resolveInput) are deliberately duplicated from
 *   explore-search-default-results.js so each embed stays standalone — keep
 *   them in sync with that sibling.
 * - Unlike that sibling, this embed does NOT need a retry poll. Everything it
 *   depends on (results container, input, panel-list, no-results, sections) is
 *   static page markup present at defer time, and it reads no late-binding CMS
 *   attribute; the only DOM churn during the load window is the browse widgets
 *   the ladder already refuses to adopt, and their removal can only shrink the
 *   set of decoys.
 * - Everything scoped to the tab wrapper is scoped to OUR tab wrapper. Other
 *   unrelated tab components exist on the page (the generate-contract form is
 *   one, and it precedes the search UI in document order), so the tab-switch
 *   hooks resolve through the results container rather than by a bare
 *   document-wide [data-tab-component="…"] lookup.
 *
 * How it reads "empty": the engine signals a 0-hit section by inline-setting the
 * SECTION's own style.display="none" (a section WITH hits gets real hit-card
 * children appended and its inline display cleared). Every section also always
 * contains a structural section-label plus a hidden template, so an EMPTY
 * section still has a non-template child — the populated check therefore tests
 * style.display FIRST and only then looks for a non-template child.
 *
 * How it forces the toggle: the shared no-results element carries an inline
 * style.display="none" from BOTH the engine (whenever another tab has hits) and
 * tabs.js (which mis-counts it as a panel). A plain inline write would be fought
 * by them, so this embed toggles a stylesheet class that uses !important (an
 * !important stylesheet declaration beats a normal inline declaration in the
 * cascade). It mutates ONLY the no-results element's classList.
 *
 * No conflict with explore-search-hide-empty.js: that sibling only touches
 * elements marked [starters-algolia-hide="true"], which on this page are the two
 * PANELS, not the no-results element — and even if the attribute were authored
 * onto the no-results element it holds no [wf-algolia-element="section"], and
 * hide-empty leaves section-less wrappers completely alone. Its hiding of an
 * empty active panel is complementary: the panel collapses, the message shows.
 *
 * Kept correct via a MutationObserver on the results container (child + style
 * changes as the engine re-renders) plus a click hook on the tab button-list
 * (re-evaluate after tabs.js flips the active panel). Evaluations are coalesced
 * onto a single 0ms timeout (not rAF — animation-frame callbacks are suspended
 * while the tab is backgrounded; a plain timeout still runs).
 *
 * Coordinates with explore-search-list-loader.js: that sibling masks the
 * panel-list with inline visibility:hidden while an Algolia "/queries" request is
 * in flight, reserving the old (taller) height. Our no-results element sits
 * INSIDE that panel-list, so while the mask is up the message would be masked
 * along with the rest of the list — revealing it there would paint nothing, and
 * it would then pop in when the mask lifts. So this embed DEFERS revealing while
 * masked. The MutationObserver already watches the subtree's style changes, so
 * when the loader restores visibility, evaluate() re-fires and the message
 * appears once, in its final spot.
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

  var RESULTS_SELECTOR = '[wf-algolia-element="results"]';
  var BROWSE_SELECTOR = '[wf-algolia-element="browse"]';
  var WRAPPER_SELECTOR = '[wf-algolia-element="search-wrapper"]';
  var INPUT_SELECTOR = 'input[wf-algolia-element="search-input"]';
  var SECTION_SELECTOR = '[wf-algolia-element="section"]';
  var TEMPLATE_SELECTOR = '[wf-algolia-element="template"]';
  var NO_RESULTS_SELECTOR = '[wf-algolia-element="no-results"]';
  var PANEL_LIST_SELECTOR = '[data-tab-component="panel-list"]';
  var BUTTON_LIST_SELECTOR = '[data-tab-component="button-list"]';
  var TAB_WRAPPER_SELECTOR = '[data-tab-component="wrapper"]';

  function init() {
    try {
      /* --- Locate the feature markup (defer = DOM parsed) ---
         Never a bare first match: the browse widgets described above own
         look-alike [wf-algolia-element="results"] containers and precede the
         search UI in document order. */

      function inBrowseWidget(el) {
        try {
          if (el && typeof el.closest === "function") {
            return !!el.closest(BROWSE_SELECTOR);
          }
        } catch (e) {
          /* fall through */
        }
        return false;
      }

      /* First match that is not owned by a browse widget. */
      function firstOutsideBrowse(root, selector) {
        if (!root) return null;
        var all = root.querySelectorAll(selector);
        for (var i = 0; i < all.length; i++) {
          if (!inBrowseWidget(all[i])) return all[i];
        }
        return null;
      }

      /* The tabbed federated layout this embed exists for: a panel-list, the
         shared no-results element, and at least one section to judge. A browse
         widget's container has none of them. */
      function hasTabbedMarkup(el) {
        if (!el) return false;
        return !!(
          el.querySelector(PANEL_LIST_SELECTOR) &&
          el.querySelector(NO_RESULTS_SELECTOR) &&
          el.querySelector(SECTION_SELECTOR)
        );
      }

      /* Ladder, every rung skipping browse-owned containers, each falling
         THROUGH to the next rather than committing to a bad match. */
      function resolveResultsEl(root) {
        var scope = root || document;
        var wrapper = scope.querySelector(WRAPPER_SELECTOR);
        var all;
        var i;
        /* 1. The search wrapper's own results container, if it carries the
              tabbed markup. */
        if (wrapper) {
          all = wrapper.querySelectorAll(RESULTS_SELECTOR);
          for (i = 0; i < all.length; i++) {
            if (!inBrowseWidget(all[i]) && hasTabbedMarkup(all[i])) return all[i];
          }
        }
        /* 2. Anywhere in the document: the container that actually holds it. */
        all = scope.querySelectorAll(RESULTS_SELECTOR);
        for (i = 0; i < all.length; i++) {
          if (!inBrowseWidget(all[i]) && hasTabbedMarkup(all[i])) return all[i];
        }
        /* 3. Any container at all that a browse widget does not own — the
              feature then bails on the missing parts below, but it bails
              against the real search UI rather than against a browse widget. */
        return (
          firstOutsideBrowse(wrapper, RESULTS_SELECTOR) ||
          firstOutsideBrowse(scope, RESULTS_SELECTOR)
        );
      }

      function resolveInput(root) {
        var scope = root || document;
        return (
          firstOutsideBrowse(scope.querySelector(WRAPPER_SELECTOR), INPUT_SELECTOR) ||
          firstOutsideBrowse(scope, INPUT_SELECTOR)
        );
      }

      var resultsEl = resolveResultsEl(document);
      var input = resolveInput(document);
      if (!resultsEl || !input) return; // feature absent — bail quietly

      var noResultsEl = resultsEl.querySelector(NO_RESULTS_SELECTOR);
      var panelList = resultsEl.querySelector(PANEL_LIST_SELECTOR);
      // Only applies to the tabbed layout with a shared no-results element.
      if (!noResultsEl || !panelList) return;
      // Nothing to judge if there are no sections at all.
      if (!resultsEl.querySelector(SECTION_SELECTOR)) return;

      /* The tab component that owns OUR panel-list. On the live page this is
         the results container itself; resolving it this way (never a bare
         document-wide lookup) keeps the tab hooks below off the unrelated tab
         components that also live on this page. */
      var tabWrapEl = null;
      try {
        tabWrapEl =
          panelList.closest && panelList.closest(TAB_WRAPPER_SELECTOR);
      } catch (e) {
        tabWrapEl = null;
      }
      if (!tabWrapEl) tabWrapEl = resultsEl;

      /* --- Inject the forcing stylesheet once (id-guarded). The no-results
         element carries an inline display:none from the engine (when another
         tab has hits) and from tabs.js (which mis-counts it as a panel), so
         !important declarations are needed to override those inline rules. --- */
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
          if (child.matches && !child.matches(TEMPLATE_SELECTOR)) {
            return true;
          }
        }
        return false;
      }

      /* Not every direct child of panel-list is a panel. In the live markup the
         shared no-results element is authored as panel-list's last child, so a
         candidate must (a) not BE that element and (b) actually contain a
         section — otherwise a section-less "panel" would always read as NOT
         empty and the message could never show. The identity test also covers
         the documented-but-not-live layout where no-results sits outside
         panel-list (it then simply never matches). */
      function isPanelCandidate(el) {
        if (!el || el === noResultsEl) return false;
        return !!el.querySelector(SECTION_SELECTOR);
      }

      /* The active panel is the candidate tabs.js flagged; before tabs.js runs,
         fall back to the FIRST candidate (matches the default-visible tab). */
      function getActivePanel() {
        var children = panelList.children;
        var first = null;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (!isPanelCandidate(child)) continue;
          if (child.getAttribute("data-tab-active") === "true") return child;
          if (!first) first = child;
        }
        return first;
      }

      function isActivePanelEmpty() {
        var panel = getActivePanel();
        if (!panel) return false;
        var sections = panel.querySelectorAll(SECTION_SELECTOR);
        // Cannot happen (candidates are section-bearing) — kept defensively.
        if (!sections.length) return false; // nothing to judge → not empty
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
        // sits INSIDE that panel-list, so while the mask is up the message is
        // masked too: revealing it there would paint nothing and then pop in
        // when the mask lifts. Defer while masked; the MutationObserver below
        // already watches ['style'] on the subtree, so the loader restoring
        // visibility re-fires evaluate() and the message appears once, in its
        // final spot. No loader on the page => panel-list is never masked =>
        // never gated.
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
          // Read OUR tab wrapper's duration, not the first one in the document.
          var d = parseFloat(tabWrapEl.getAttribute("data-duration"));
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
      // Scoped to OUR tab wrapper — other tab components on this page must not
      // trip the guard.
      document.addEventListener("click", function (e) {
        try {
          if (!e.target || !e.target.closest) return;
          var buttonList = e.target.closest(BUTTON_LIST_SELECTOR);
          if (!buttonList || !tabWrapEl.contains(buttonList)) return;
          switching = true;
          hideNoResults();
          if (switchTimer) clearTimeout(switchTimer);
          switchTimer = setTimeout(function () {
            switching = false;
            scheduleEvaluate();
          }, switchDelayMs());
        } catch (err) {
          /* never break the page */
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
