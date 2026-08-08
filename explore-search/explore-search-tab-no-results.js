/* explore-search-tab-no-results.js — per-tab "no matches" message for the tabbed federated search.
 *
 * @release v1.59.136
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
 * THE RULE (read this before changing anything below):
 *
 *   SHOW  iff  the query is NON-EMPTY  AND  the active panel is empty.
 *   Otherwise RELEASE — remove our own class and never write display.
 *
 * That is the whole decision. Two things it deliberately does NOT do:
 *
 * - It does NOT require another panel to have hits. Earlier drafts did, on the
 *   theory that "active empty while another tab has hits" is the engine's exact
 *   blind spot and anything else is the engine's job. That was wrong, because
 *   this embed is ADD-ONLY: duplicating a reveal the engine also performs is
 *   harmless (same element, same visual, one class), whereas requiring another
 *   populated panel opened a hole with no rescue. tabs.js:325-328 stamps inline
 *   display:none on EVERY panel-list child at its DOMContentLoaded init, and
 *   that list provably includes the no-results element (it is authored inside
 *   panel-list — see below). The engine is <script async> in the head, so if it
 *   reveals the message BEFORE tabs.js initializes, tabs.js clobbers it. With
 *   the "another panel populated" condition, the all-empty case no longer
 *   qualified and nothing could rescue that clobber: blank tab, no explanation.
 *   Under the rule above the all-empty case is covered by US, not delegated to
 *   engine behavior we would have to trust and cannot verify.
 * - It does NOT force-hide anything, ever. There is no hide class. "Not
 *   showing" means removing our own class, which hands the element straight
 *   back to whatever inline display the engine and tabs.js set.
 *
 * Why the NON-EMPTY query requirement, specifically: it keeps an explicit
 * cross-embed contract intact. explore-search-default-results.js:332 calls
 * hideEl(noResultsEl) with the comment "defaults never show the no-results
 * element" — on an empty query it fills both sections with default items, so a
 * "no matches" message would be a lie. Our display:block !important would beat
 * that inline write. Gating on a non-empty query restores that contract without
 * reintroducing any forcing hide: we simply never ADD a message on a search the
 * user has not made. It also removes two ways the old rule produced a false
 * message on an untouched page:
 *   - a PARTIAL default delivery (one section painted, the other hidden by its
 *     own 0-hit hideEl(section), or skipped because its template could not be
 *     recovered) used to satisfy "active empty AND other populated";
 *   - on CLEAR there is a transient where the engine has hidden the results
 *     container but the previous render's DOM survives — active section still
 *     display:none, the other still holding its cards — and default-results only
 *     repaints after its 150ms debounce plus a multiSearch round-trip. The old
 *     rule flashed the message across that window with an empty search box.
 *
 * ACCEPTED RISK of having no hide class: if the engine ever strands its own
 * reveal — leaves no-results visible while the active panel actually has hits —
 * this embed cannot correct it. That is the deliberate price of never fighting
 * the engine, and it is the right trade: a spurious extra message is a much
 * smaller failure than a blank panel with no explanation, which is what every
 * forcing-hide variant of this file eventually produced.
 *
 * Required markup — this is the layout as ACTUALLY authored on the live page,
 * which is NOT what an earlier version of this comment claimed: the shared
 * no-results element is a child of the panel-list, not its sibling.
 *
 *   [wf-algolia-element="search-wrapper"]
 *     input[wf-algolia-element="search-input"]      (REQUIRED — see below)
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
 *   element like any other panel. isPanelCandidate() below rejects it.
 * - isPanelSlot() also honors data-tab-component-skip so an author can take an
 *   element out of the running the same way tabs.js does. Note this is NOT the
 *   same test tabs.js uses: tabs.js:55 isTabSlotItem checks ONLY that attribute
 *   and does not require a section, so the two files can and do disagree about
 *   what counts as a panel — that disagreement is exactly why tabs.js miscounts
 *   the no-results element and this file does not.
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
 * - Everything else is then derived FROM that container, so two different
 *   widgets can never be mixed. The input in particular is resolved ONLY from
 *   the resolved container's own search-wrapper — there is deliberately no
 *   document-wide fallback, because the rule above reads input.value and a
 *   foreign widget's box is permanently empty, which would silently disable the
 *   message instead of failing loudly. If our wrapper has no input we treat it
 *   as ABSENT and never show: a missing input FAILS CLOSED.
 * - The no-results element is likewise preferred as a direct child of the
 *   resolved panel-list, so a future per-panel "nothing here" element can never
 *   be adopted as the shared one.
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
 * markup.) The populated test therefore checks the engine's display signal first
 * and then looks for a non-template child. It is intentionally identical in
 * semantics to explore-search-hide-empty.js's isSectionPopulated, so the two
 * embeds can never disagree about whether a section has hits.
 *
 * First-render latch: between the engine detaching the templates and the first
 * render landing, every section is legitimately empty. Typing inside that window
 * — which can be seconds wide, covering default-results' engine poll, its 150ms
 * debounce, its multiSearch round-trip and, on the template-recovery path, a
 * refetch of the ~950KB page — would satisfy "non-empty query AND active panel
 * empty" and paint the message on keystroke 1. So nothing is shown until at
 * least one .wf-algolia-injected card has appeared inside the results container;
 * after that the latch stays set.
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
 * missed every one of those, and also fired on clicks that changed nothing. It
 * writes data-tab-active on every one of those paths (tabs.js:461/468), so that
 * one attribute is the whole signal — watching 'class' as well bought nothing
 * and fired on every injected hit card and every hide-empty toggle.
 *
 * The switch guard only runs when there is actually an animation to hide. An
 * ANIMATED switch keeps the OUTGOING panel visible during the fade, so revealing
 * the message mid-switch places it against the old height and it jumps once the
 * layout settles. But tabs.js:505-508 makes every switch an instant display swap
 * when gsap is undefined, and tabs.js:628-630 deep links pass animate=false
 * explicitly. Blanking for 400-1500ms in those cases is pure harm: both panels
 * can be collapsed at once (hide-empty's !important on one, tabs.js's inline
 * display:none on the other), so the results region drops to zero height and
 * then pops back. So the guard is gated on gsap being present; otherwise we just
 * re-evaluate immediately.
 *
 * Evaluations are coalesced onto a single 0ms timeout (not rAF — animation-frame
 * callbacks are suspended while the tab is backgrounded; a plain timeout runs).
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

  /* Sentinel: a child IS flagged active but is not a real panel, so the state
     cannot be judged. Deliberately distinct from null ("nothing flagged yet"),
     because the two must behave differently — see getActivePanel(). */
  var UNJUDGEABLE = {};

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

      /* A candidate panel, ignoring the no-results question (resolved just
         below, which would otherwise be circular). */
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

      /* The input comes ONLY from the SAME widget as the container. No
         document-wide fallback on purpose: THE RULE reads input.value, and a
         foreign widget's box is permanently empty, so falling back would
         silently disable the message. Absent input => never show (fail closed). */
      var ownWrapper = null;
      try {
        ownWrapper = resultsEl.closest && resultsEl.closest(WRAPPER_SELECTOR);
      } catch (e) {
        ownWrapper = null;
      }
      var input = firstOutsideBrowse(ownWrapper, INPUT_SELECTOR);

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
         is deliberately no hide rule — see THE RULE above. --- */
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

      /* Identical in semantics to explore-search-hide-empty.js's version. */
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

      /* Three distinct outcomes, and they must stay distinct:
           - a real panel element : judge it
           - UNJUDGEABLE          : something IS flagged active but is not a
                                    panel (e.g. the no-results element authored
                                    first, which tabs.js:515 makeActive(0,…)
                                    would flag). Do not show, do not treat as a
                                    tab switch, do not latch.
           - null                 : nothing flagged active yet (tabs.js has not
                                    run). Fall back to the first candidate, which
                                    is the default-visible tab. */
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
        if (flagged) return isPanelCandidate(flagged) ? flagged : UNJUDGEABLE;
        return first;
      }

      function queryIsEmpty() {
        // No input resolved => behave as if there were no query at all.
        if (!input) return true;
        return ((input.value || "") + "").trim() === "";
      }

      /* THE RULE, in code. */
      function shouldShow() {
        if (queryIsEmpty()) return false;
        var active = getActivePanel();
        if (!active || active === UNJUDGEABLE) return false;
        return !isPanelPopulated(active);
      }

      function showNoResults() {
        noResultsEl.classList.add(SHOW_CLASS);
      }

      /* NOT a hide: this only withdraws our own override and hands the element
         back to whatever inline display the engine and tabs.js have set. */
      function releaseNoResults() {
        noResultsEl.classList.remove(SHOW_CLASS);
      }

      /* First-render latch — see the header. */
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

      /* Tab-switch guard — only meaningful while an animation is hiding the
         swap. FAIL-SAFE: `switching` ALWAYS clears after the delay. */
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
        /* No gsap => tabs.js swaps display instantly (tabs.js:505-508), so there
           is no animation to hide and holding the message back would only blank
           the region while both panels are collapsed. Re-evaluate at once. */
        if (typeof window.gsap === "undefined") {
          scheduleEvaluate();
          return;
        }
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

        /* Tab switches, observed rather than inferred from a click — this covers
           arrow keys, prev/next, _tabController.makeActive, autoplay and
           ?tab-id= deep links. data-tab-active alone is the whole signal
           (tabs.js:461/468 writes it on every path); watching 'class' as well
           only added noise from injected hit cards and hide-empty toggles.
           LOOP-SAFETY comes for free: our own writes touch 'class' on
           noResultsEl, which this filter does not observe at all. */
        var lastActivePanel = getActivePanel();
        if (lastActivePanel === UNJUDGEABLE) lastActivePanel = null;
        var tabObserver = new MutationObserver(function () {
          var current = getActivePanel();
          /* UNJUDGEABLE is not a switch and must not latch — otherwise a
             transiently odd flag would arm the guard and blank the region, and
             the latch would then treat the recovery as another switch. */
          if (current !== UNJUDGEABLE && current !== lastActivePanel) {
            /* Only a real candidate-to-candidate change is a tab switch worth
               guarding; first resolution (null -> panel) just latches. */
            var realSwitch = !!(current && lastActivePanel);
            lastActivePanel = current;
            if (realSwitch) armSwitchGuard();
          }
          scheduleEvaluate();
        });
        tabObserver.observe(panelList, {
          subtree: true,
          attributes: true,
          attributeFilter: ["data-tab-active"]
        });
      }

      // Typing changes the query, which THE RULE reads directly.
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
