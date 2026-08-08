/* explore-search-tab-no-results.js — per-tab "no matches" message for the tabbed federated search.
 *
 * @release v1.59.130
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
 * THE INVARIANT (read this before changing anything below):
 *
 *   This embed only ever ADDS the message in the one case the engine misses,
 *   and NEVER suppresses a reveal the engine performed itself.
 *
 * Concretely, it shows the shared no-results element on exactly one condition:
 * the ACTIVE panel is empty AND at least one OTHER panel is populated. That
 * asymmetry IS the engine's blind spot and the entire reason this file exists.
 * In every other state it removes its own class and lets the engine's inline
 * display govern, whatever the engine decided.
 *
 * An earlier version instead ran two blanket rules — "empty query => force-hide"
 * and "active panel empty => show" — and the force-hide was actively harmful,
 * on two independent grounds:
 *
 *   1. It can blank a legitimate message. explore-search-default-results.js is
 *      what normally fills both sections on an empty query, and it can
 *      under-deliver: it hides any section whose empty-query fetch returns zero
 *      hits, it swallows multiSearch rejections in a bare .catch(), it gives up
 *      at its shared ~15s deadline, and it bails when no hit-card template can
 *      be recovered. In any of those cases the sections are empty with an empty
 *      search box, the engine may well have revealed the shared message itself,
 *      and force-hiding it left a blank panel with no explanation — the exact
 *      state this feature exists to explain, i.e. strictly worse than the
 *      feature being dead.
 *   2. Independently of any specific trigger, stamping display:none !important
 *      over a reveal the ENGINE performed is wrong on principle. This embed's
 *      remit is to cover the engine's blind spot, never to override the
 *      engine's own correct behavior.
 *
 * The empty-query behavior is now DERIVED from the invariant rather than
 * special-cased: with defaults painted the active panel has hits, so the SHOW
 * condition is simply not met and no special case is needed.
 *
 * Because of the invariant there is no "hide" class at all. Not showing simply
 * means removing our own class, which hands the element straight back to the
 * engine's (and tabs.js's) inline display. Do not reintroduce a forcing hide.
 *
 * Required markup — this is the layout as ACTUALLY authored on the live page,
 * which is NOT what an earlier version of this comment claimed: the shared
 * no-results element is a child of the panel-list, not its sibling.
 *
 *   [wf-algolia-element="search-wrapper"]
 *     input[wf-algolia-element="search-input"]      (optional — see below)
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
 *   never show. isPanelCandidate() below rejects it (and honors
 *   data-tab-component-skip, the same signal tabs.js uses, so both files agree
 *   on what counts as a panel).
 * - tabs.js's inline display:none on the no-results element is why the forcing
 *   class needs !important; it is not only the engine writing that style.
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
 *   own. Every rung skips browse-owned containers.
 * - Everything else is then derived FROM that container rather than looked up
 *   independently, so two different widgets can never be mixed: the input comes
 *   from the container's own search-wrapper, and the no-results element is
 *   preferred as a direct child of the resolved panel-list (so a future
 *   per-panel "nothing here" element can never be adopted by mistake).
 * - The browse-guard helpers (inBrowseWidget / firstOutsideBrowse) mirror
 *   explore-search-default-results.js, which fixed the same bug. The ladders
 *   themselves have deliberately DIVERGED — this one gates every rung on the
 *   tabbed markup that this feature needs, which that sibling has no reason to
 *   require — so do not "resync" them without reading both.
 * - This embed needs no retry poll. Everything it depends on is static page
 *   markup present at defer time, and it reads no late-binding CMS attribute;
 *   the only DOM churn during the load window is the browse widgets the ladder
 *   already refuses to adopt, and their removal only shrinks the decoy set.
 *
 * How it reads "empty": the engine signals a 0-hit section by inline-setting the
 * SECTION's own style.display="none"; a section WITH hits gets hit-card children
 * appended (each stamped .wf-algolia-injected) and its inline display cleared.
 * The only child these sections are authored with is the hidden template, and
 * the engine DETACHES that template when it initializes — so a settled empty
 * section has ZERO children. (An earlier version of this comment claimed every
 * section also keeps a structural section-label child; that is false for this
 * markup, and the no-flash reasoning that rested on it was wrong.) The populated
 * test therefore checks the engine's display signal first and then looks for a
 * non-template child, and the no-flash guarantee comes from the render latch
 * described next, NOT from sections being non-empty at rest.
 *
 * First-render latch (this is what prevents the first-keystroke flash): between
 * the engine detaching the templates and the first render landing, every section
 * is legitimately empty. Typing inside that window — which can be seconds wide,
 * covering default-results' engine poll, its 150ms debounce, its multiSearch
 * round-trip and, on the template-recovery path, a refetch of the ~950KB page —
 * would otherwise satisfy "active panel empty" and paint the message on
 * keystroke 1. So nothing is shown until at least one .wf-algolia-injected card
 * has appeared inside the results container; after that the latch stays set.
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
 * Tab switches are detected by OBSERVING THE STATE CHANGE, not by inferring one
 * from a click. tabs.js switches tabs from arrow-key navigation, prev/next
 * controls, its _tabController.makeActive API, autoplay and ?tab-id= deep links,
 * none of which involve a click on the button list; an earlier click-only hook
 * missed every one of those, so the message revealed on the first animation
 * frame against the outgoing panel's height and then jumped. The same hook fired
 * on clicks that changed nothing (the already-active tab, the container padding,
 * the "(0)" count — and twice per click, since each button wraps a <label for>),
 * blanking the message for ~600ms for no reason. So a MutationObserver watches
 * the panel-list for data-tab-active / class changes and arms the guard only
 * when the ACTIVE PANEL IDENTITY ACTUALLY CHANGED. The guard still always clears
 * itself on a timer, so it can never strand the message.
 *
 * Evaluations are coalesced onto a single 0ms timeout (not rAF — animation-frame
 * callbacks are suspended while the tab is backgrounded; a plain timeout runs).
 *
 * Bails out quietly if the results / no-results / panel-list / section markup is
 * absent (feature only applies to the tabbed layout). The search input is
 * OPTIONAL: no decision depends on its value any more, it is only an extra
 * re-evaluation trigger, so a page that hides or renames it degrades to
 * observer-driven updates instead of silently doing nothing. Never throws
 * (defensive try/catch) — must not break the page.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-tab-no-results.js
 */
(function () {
  if (window.__exploreSearchTabNoResultsInit) return;
  window.__exploreSearchTabNoResultsInit = true;

  var STYLE_ID = "starters-es-tab-no-results-style";
  var SHOW_CLASS = "starters-es-no-results--show";

  var RESULTS_SELECTOR = '[wf-algolia-element="results"]';
  var BROWSE_SELECTOR = '[wf-algolia-element="browse"]';
  var WRAPPER_SELECTOR = '[wf-algolia-element="search-wrapper"]';
  var INPUT_SELECTOR = 'input[wf-algolia-element="search-input"]';
  var SECTION_SELECTOR = '[wf-algolia-element="section"]';
  var TEMPLATE_SELECTOR = '[wf-algolia-element="template"]';
  var NO_RESULTS_SELECTOR = '[wf-algolia-element="no-results"]';
  var PANEL_LIST_SELECTOR = '[data-tab-component="panel-list"]';
  var TAB_WRAPPER_SELECTOR = '[data-tab-component="wrapper"]';
  var INJECTED_SELECTOR = ".wf-algolia-injected";
  var SKIP_ATTR = "data-tab-component-skip";

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

      /* First DIRECT child of root matching selector. */
      function firstChildMatching(root, selector) {
        if (!root) return null;
        var kids = root.children;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].matches && kids[i].matches(selector)) return kids[i];
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

      var resultsEl = resolveResultsEl(document);
      if (!resultsEl) return; // feature absent — bail quietly

      var panelList = resultsEl.querySelector(PANEL_LIST_SELECTOR);
      if (!panelList) return; // only applies to the tabbed layout

      /* A candidate panel, ignoring the no-results question (which is resolved
         just below and would otherwise be circular). Mirrors tabs.js's own
         notion of a tab slot via data-tab-component-skip. */
      function isPanelSlot(el) {
        if (!el) return false;
        var skip = el.getAttribute(SKIP_ATTR);
        if (typeof skip === "string" && skip.toLowerCase() === "true") return false;
        return !!el.querySelector(SECTION_SELECTOR);
      }

      /* Is el inside one of the real panels? Used only to keep a per-panel
         "nothing here" element from being adopted as the SHARED one. */
      function ownedByAPanel(el) {
        var kids = panelList.children;
        for (var i = 0; i < kids.length; i++) {
          if (isPanelSlot(kids[i]) && kids[i].contains(el)) return true;
        }
        return false;
      }

      /* The SHARED no-results element, resolved from the container we already
         committed to — direct child of the panel-list (the live layout), else
         direct child of the results container (the layout the old contract
         described), else any descendant no panel owns. */
      function resolveNoResultsEl() {
        var el =
          firstChildMatching(panelList, NO_RESULTS_SELECTOR) ||
          firstChildMatching(resultsEl, NO_RESULTS_SELECTOR);
        if (el) return el;
        var all = resultsEl.querySelectorAll(NO_RESULTS_SELECTOR);
        for (var i = 0; i < all.length; i++) {
          if (!ownedByAPanel(all[i])) return all[i];
        }
        return null;
      }

      var noResultsEl = resolveNoResultsEl();
      if (!noResultsEl) return;
      // Nothing to judge if there are no sections at all.
      if (!resultsEl.querySelector(SECTION_SELECTOR)) return;

      /* The input comes from the SAME widget as the container, never from a
         document-wide first match — a foreign wrapper's input would report a
         permanently empty value. It is optional: nothing below reads its value,
         it only triggers an extra evaluation. */
      var ownWrapper = null;
      try {
        ownWrapper = resultsEl.closest && resultsEl.closest(WRAPPER_SELECTOR);
      } catch (e) {
        ownWrapper = null;
      }
      var input =
        firstOutsideBrowse(ownWrapper, INPUT_SELECTOR) ||
        firstOutsideBrowse(document.querySelector(WRAPPER_SELECTOR), INPUT_SELECTOR) ||
        firstOutsideBrowse(document, INPUT_SELECTOR);

      /* The tab component that owns OUR panel-list. On the live page this is
         the results container itself; resolving it this way (never a bare
         document-wide lookup) keeps the tab logic below off the unrelated tab
         components that also live on this page. */
      var tabWrapEl = null;
      try {
        tabWrapEl = panelList.closest && panelList.closest(TAB_WRAPPER_SELECTOR);
      } catch (e) {
        tabWrapEl = null;
      }
      if (!tabWrapEl) tabWrapEl = resultsEl;

      /* --- Inject the forcing stylesheet once (id-guarded). The no-results
         element carries an inline display:none from the engine (when another
         tab has hits) and from tabs.js (which mis-counts it as a panel), so an
         !important declaration is needed to override those inline rules. There
         is deliberately no hide rule — see THE INVARIANT above. --- */
      if (!document.getElementById(STYLE_ID)) {
        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = "." + SHOW_CLASS + " { display: block !important; }";
        (document.head || document.documentElement).appendChild(style);
      }

      /* --- Helpers --- */

      function isPanelCandidate(el) {
        if (!el || el === noResultsEl) return false;
        return isPanelSlot(el);
      }

      /* A section is "populated" only if the engine has NOT inline-hidden it AND
         it has at least one non-template child. Sections are authored with only
         the hidden template, which the engine detaches at init, so a settled
         empty section has zero children. */
      function isSectionPopulated(section) {
        if (section.style.display === "none") return false;
        var children = section.children;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.matches && !child.matches(TEMPLATE_SELECTOR)) return true;
        }
        return false;
      }

      function isPanelPopulated(panel) {
        var sections = panel.querySelectorAll(SECTION_SELECTOR);
        for (var i = 0; i < sections.length; i++) {
          if (isSectionPopulated(sections[i])) return true;
        }
        return false;
      }

      /* The active panel is the child tabs.js flagged. If the flagged child is
         not a real panel (the no-results element, or a skipped slot), the state
         is NOT JUDGEABLE and this returns null — falling back to a different
         panel would judge the wrong one. Before tabs.js has run nothing is
         flagged, so the first candidate stands in for the default-visible tab. */
      function getActivePanel() {
        var kids = panelList.children;
        var flagged = null;
        var first = null;
        for (var i = 0; i < kids.length; i++) {
          var child = kids[i];
          if (!flagged && child.getAttribute("data-tab-active") === "true") {
            flagged = child;
          }
          if (!first && isPanelCandidate(child)) first = child;
        }
        if (flagged) return isPanelCandidate(flagged) ? flagged : null;
        return first;
      }

      /* THE INVARIANT, in code: show only when the active panel is empty AND
         some other panel has hits. Anything else is either a state the engine
         already handles (all panels empty => it reveals the message itself) or
         a state with nothing to say. */
      function shouldShow() {
        var active = getActivePanel();
        if (!active) return false; // not judgeable => never our call
        if (isPanelPopulated(active)) return false;
        var kids = panelList.children;
        for (var i = 0; i < kids.length; i++) {
          var child = kids[i];
          if (child === active || !isPanelCandidate(child)) continue;
          if (isPanelPopulated(child)) return true; // the engine's blind spot
        }
        return false;
      }

      function showNoResults() {
        noResultsEl.classList.add(SHOW_CLASS);
      }

      /* NOT a hide: this only withdraws our own override and hands the element
         back to whatever inline display the engine and tabs.js have set. */
      function releaseNoResults() {
        noResultsEl.classList.remove(SHOW_CLASS);
      }

      /* First-render latch — see the header. Nothing is shown until the engine
         (or default-results) has actually painted a card at least once. */
      var hasRenderedOnce = false;
      function engineHasRendered() {
        if (hasRenderedOnce) return true;
        try {
          if (resultsEl.querySelector(INJECTED_SELECTOR)) hasRenderedOnce = true;
        } catch (e) {
          /* leave the latch unset */
        }
        return hasRenderedOnce;
      }

      function isListLoading() {
        // explore-search-list-loader.js masks the list with inline
        // visibility:hidden while an Algolia "/queries" request is in flight,
        // and our no-results element sits INSIDE that masked region, so
        // revealing it mid-mask would paint nothing and then pop in.
        //
        // DORMANT TODAY: that sibling resolves its list element through the very
        // same bare document.querySelector('[wf-algolia-element="results"]')
        // first-match bug this file just fixed, so its mask lands on a browse
        // widget and never on THIS panel-list — this gate cannot currently
        // return true. It is kept because it becomes correct the moment
        // list-loader is fixed. Note that fixing it will silently activate a
        // gate of up to the loader's authored min-display (data-loader="1000"
        // on the live page) on every query, which is a visible timing change
        // here and should be re-QA'd together with that fix.
        try {
          return panelList.style.visibility === "hidden";
        } catch (e) {
          return false;
        }
      }

      /* Tab-switch guard. An ANIMATED (GSAP) tab switch keeps the OUTGOING panel
         visible during the fade, so revealing the message mid-switch places it
         against the old height and it jumps once the layout settles. While a
         switch is in flight we withhold the reveal, then re-evaluate.
         FAIL-SAFE: `switching` ALWAYS clears after the delay, so this can never
         leave the message stranded. */
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

      function armSwitchGuard() {
        switching = true;
        releaseNoResults();
        if (switchTimer) clearTimeout(switchTimer);
        switchTimer = setTimeout(function () {
          switching = false;
          scheduleEvaluate();
        }, switchDelayMs());
      }

      function evaluate() {
        try {
          if (!engineHasRendered() || isListLoading() || switching) {
            releaseNoResults();
            return;
          }
          if (shouldShow()) {
            showNoResults();
          } else {
            releaseNoResults();
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
        setTimeout(function () {
          pending = false;
          evaluate();
        }, 0);
      }

      /* --- Wiring --- */

      /* Re-evaluate on any engine re-render: hit cards are added/removed
         (childList) and 0-hit sections are inline-hidden/shown (style attr).
         LOOP-SAFETY: this embed mutates ONLY the no-results element's classList —
         never its style attribute and never child nodes — so our own writes
         never satisfy this observer's ['style']/childList filters and cannot
         re-trigger it. Do NOT add 'class' to attributeFilter. */
      if (typeof window.MutationObserver === "function") {
        var renderObserver = new MutationObserver(function () {
          scheduleEvaluate();
        });
        renderObserver.observe(resultsEl, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["style"]
        });

        /* Tab switches, observed rather than inferred from a click: this covers
           arrow-key navigation, prev/next controls, _tabController.makeActive,
           autoplay and ?tab-id= deep links, none of which click the button list.
           The guard is armed ONLY when the active panel identity actually
           changed, so a click on the already-active tab (or on padding, or the
           doubled event from each button's inner <label for>) no longer blanks
           the message for ~600ms.
           LOOP-SAFETY: this one DOES watch 'class', and our own writes land on
           noResultsEl which is a child of panelList — so mutations targeting
           noResultsEl are ignored outright. Even without that they would be
           inert (they cannot change which panel is active), but the explicit
           skip keeps it obviously safe. */
        var lastActivePanel = getActivePanel();
        var tabObserver = new MutationObserver(function (mutations) {
          var relevant = false;
          for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].target !== noResultsEl) {
              relevant = true;
              break;
            }
          }
          if (!relevant) return;
          var current = getActivePanel();
          if (current !== lastActivePanel) {
            lastActivePanel = current;
            armSwitchGuard();
          }
          scheduleEvaluate();
        });
        tabObserver.observe(panelList, {
          subtree: true,
          attributes: true,
          attributeFilter: ["data-tab-active", "class"]
        });
      }

      // Typing is a strong hint the results are about to change. Nothing reads
      // the value — this only schedules an evaluation.
      if (input) {
        document.addEventListener("input", function (e) {
          if (e.target === input) scheduleEvaluate();
        });
      }

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
