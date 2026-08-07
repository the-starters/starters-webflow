/* explore-search-default-results.js — DEFAULT result lists for the empty query.
 *
 * @release v1.59.126
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds.
 *
 * What it does (reverses the old "hidden until you type" UX): whenever the
 * wf-algolia search input is EMPTY, this embed keeps the results container
 * visible and fills every federated section with its index's full default
 * ranking (an empty-query search returns all records in "top" order). The
 * moment a real query is typed the wf-algolia engine takes over and renders
 * its own hits; its pre-render sweep of .wf-algolia-injected clones removes
 * the defaults automatically, so there is never any mixing or duplication.
 * On clear, the defaults come back. Escape / outside-click hides from the
 * engine are countered — the results area is always visible now.
 *
 * Required markup (same federated markup the engine uses):
 *   [wf-algolia-element="search-wrapper"]
 *     input[wf-algolia-element="search-input"]
 *     [wf-algolia-element="results"]            (authored style="display:none")
 *       [wf-algolia-element="section"][wf-algolia-index="<index>"]
 *         [wf-algolia-element="template"]       (direct child, hidden)
 *       ...one or more sections...
 *       [wf-algolia-element="no-results"]
 *
 * Optional per-section attribute:
 *   data-explore-default-hits="<positive integer>"  overrides how many default
 *     items that section fetches/renders. Resolution order:
 *     data-explore-default-hits > wf-algolia-hits > 6 — so by default the
 *     unfiltered view shows exactly as many items as a search would.
 *
 * Finding the right markup (this page is NOT single-widget):
 * - The same page can also carry wf-algolia BROWSE widgets, and every one of
 *   them owns its own [wf-algolia-element="results"] container. On the live
 *   site three browse widgets (the cancel-membership expert lists) sit EARLIER
 *   in document order than the search UI, so a bare
 *   document.querySelector('[wf-algolia-element="results"]') resolves to a
 *   browse widget's container instead of the search one — which is exactly the
 *   bug that stopped the default lists from ever painting. This embed instead
 *   walks a ladder: the search wrapper's own results container, else the
 *   container that actually holds federated sections, else the first container
 *   not owned by a browse widget. Every rung skips browse-owned containers.
 * - Sections are looked up inside that results container first and, only if
 *   that yields nothing, document-wide (minus browse-owned ones) — so a page
 *   whose sections are nested correctly behaves exactly as before.
 * - Nothing resolved here is treated as final. Those three browse widgets are
 *   removed by Memberstack gating shortly after load, and attribute binding
 *   can settle late, so the set of look-alike containers CHANGES during the
 *   load window. If the markup is not usable yet the embed re-resolves and
 *   retries on a poll instead of bailing for good, and start() re-derives the
 *   results container from the sections it actually found — a transient miss
 *   must never become a permanent one.
 *
 * Behavior / timing:
 * - Rendering goes through the engine's own public API: WfAlgolia.multiSearch
 *   for the empty-query fetch and WfAlgolia.cloneAndPopulate(templateEl, hit)
 *   for each hit (which stamps class wf-algolia-injected, so the engine's own
 *   pre-render sweep removes these clones when a real search renders).
 * - cloneAndPopulate needs the section's hit-card TEMPLATE element, but the
 *   engine DETACHES those templates from the DOM when it initializes. The
 *   engine is loaded <script async> in the HEAD while these embeds are
 *   deferred, so who wins that race is genuinely NON-DETERMINISTIC — it turns
 *   on network timing, not on execution order. Both paths below are therefore
 *   normal paths, not a happy path plus an edge case:
 *     1. Live DOM: if this embed runs before the engine has initialized, clone
 *        each section's direct-child template in place. Best-effort.
 *     2. Recovery: if the engine already detached them — or if sections only
 *        turned up on the retry poll, by which time the engine has almost
 *        certainly initialized — re-fetch the current page's HTML and parse
 *        the templates back out, matching each to its section by
 *        wf-algolia-index (scoped the same careful way as the live lookup, so
 *        a browse widget's template is never mistaken for a section's). This
 *        is why the templates must be authored in the page markup.
 * - It then waits (polling) for window.WfAlgolia, which only exists AFTER the
 *   engine initializes. Both waits share ONE ~15s deadline measured from
 *   init, so the total is bounded at ~15s rather than compounding; on expiry
 *   it bails quietly, leaving native behavior intact (fail-safe).
 * - showEl(resultsEl) clears any inline display the engine set. Note the
 *   container is NOT authored display:none in the current markup (it carries
 *   no style attribute at all), so that call is a no-op on first render and
 *   the no-empty-flash behavior actually comes from explore-search-transitions
 *   plus explore-search-hide-empty. It is kept because the engine DOES set
 *   inline display:none later (empty query / Escape / outside click).
 * - It does NOT touch tab counts. explore-search-tab-counts.js owns those: it
 *   intercepts the engine's Algolia responses, remembers each query's counts
 *   in memory, and repaints from that memory on every input event. So even a
 *   repeat empty-query served from the algoliasearch client's in-memory cache
 *   (no network round-trip) still shows the right full-index totals — this
 *   embed no longer needs to cache-bust its requests to keep the counts fed.
 *
 * Bails out quietly if the results / sections / input markup is absent, or if
 * no section template can be recovered by either strategy. Never throws
 * (defensive try/catch throughout) — must not break the page.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-default-results.js
 */
(function () {
  if (window.__exploreSearchDefaultResultsInit) return;
  window.__exploreSearchDefaultResultsInit = true;

  var DEFAULT_HITS_CAP = 6; // default view shows the same count a search would.
  var ENGINE_TIMEOUT_MS = 15000;
  var ENGINE_POLL_MS = 150;
  var RENDER_DEBOUNCE_MS = 150;

  var SECTION_SELECTOR = '[wf-algolia-element="section"][wf-algolia-index]';
  var RESULTS_SELECTOR = '[wf-algolia-element="results"]';
  var BROWSE_SELECTOR = '[wf-algolia-element="browse"]';
  var WRAPPER_SELECTOR = '[wf-algolia-element="search-wrapper"]';
  var INPUT_SELECTOR = 'input[wf-algolia-element="search-input"]';
  var TEMPLATE_SELECTOR = ':scope > [wf-algolia-element="template"]';
  var NO_RESULTS_SELECTOR = '[wf-algolia-element="no-results"]';

  /* ONE deadline for the whole embed, measured from init and shared by the
     markup wait and the engine wait. Chaining a fresh timeout onto each would
     let a slow page keep this alive for twice as long for no benefit: the
     engine is <script async> in the head and resolves in a few hundred ms in
     practice, so if it is still missing 15s into the page it is not coming. */
  var deadline = Date.now() + ENGINE_TIMEOUT_MS;
  function pastDeadline() {
    return Date.now() > deadline;
  }

  try {
    /* --- Locate the feature markup ---
       Nothing here is resolved once and trusted forever: the browse widgets
       that create the look-alike containers are removed after load, so every
       lookup is re-runnable and the retry poll re-runs them. */

    var resultsEl = null;
    var input = null;
    var noResultsEl = null;

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

    /* First match that is not owned by a browse widget. Works on the live
       document and on a DOMParser document alike (step-2 recovery reuses it). */
    function firstOutsideBrowse(root, selector) {
      if (!root) return null;
      var all = root.querySelectorAll(selector);
      for (var i = 0; i < all.length; i++) {
        if (!inBrowseWidget(all[i])) return all[i];
      }
      return null;
    }

    /* Ladder, every rung skipping browse-owned containers, each falling
       THROUGH to the next rather than committing to a bad match. */
    function resolveResultsEl(root) {
      var scope = root || document;
      /* 1. The search wrapper's own results container. */
      var hit = firstOutsideBrowse(
        scope.querySelector(WRAPPER_SELECTOR),
        RESULTS_SELECTOR
      );
      if (hit) return hit;
      /* 2. The container that actually holds federated sections. */
      var all = scope.querySelectorAll(RESULTS_SELECTOR);
      var i;
      for (i = 0; i < all.length; i++) {
        if (!inBrowseWidget(all[i]) && all[i].querySelector(SECTION_SELECTOR)) {
          return all[i];
        }
      }
      /* 3. Any container at all that a browse widget does not own. */
      return firstOutsideBrowse(scope, RESULTS_SELECTOR);
    }

    function resolveInput(root) {
      var scope = root || document;
      return (
        firstOutsideBrowse(scope.querySelector(WRAPPER_SELECTOR), INPUT_SELECTOR) ||
        firstOutsideBrowse(scope, INPUT_SELECTOR)
      );
    }

    /* Re-resolve the container and the input. Never downgrades a good match to
       null, so a container that disappears mid-flight leaves the last known
       one in place. Returns whether we now have both. */
    function resolveMarkup() {
      var r = resolveResultsEl(document);
      if (r) resultsEl = r;
      var i = resolveInput(document);
      if (i) input = i;
      return !!(resultsEl && input);
    }

    resolveMarkup();

    /* Sections live inside the results container on correct markup. Only if
       that yields nothing do we widen to the document, so pages that nest
       their sections properly keep the exact behavior they had before. Either
       way, browse-owned sections are never adopted. */
    function findSections() {
      var scoped = resultsEl
        ? resultsEl.querySelectorAll(SECTION_SELECTOR)
        : [];
      var source = scoped.length
        ? scoped
        : document.querySelectorAll(SECTION_SELECTOR);
      var out = [];
      for (var i = 0; i < source.length; i++) {
        if (!inBrowseWidget(source[i])) out.push(source[i]);
      }
      return out;
    }

    /* --- Small helpers --- */

    function capFor(section) {
      /* Priority: data-explore-default-hits > wf-algolia-hits > 6. */
      var raw =
        section.getAttribute("data-explore-default-hits") ||
        section.getAttribute("wf-algolia-hits");
      var n = raw != null ? parseInt(raw, 10) : NaN;
      if (isFinite(n) && n > 0) return n;
      return DEFAULT_HITS_CAP;
    }

    function inputValue() {
      /* input can still be unresolved while the retry poll is running. */
      return ((input && input.value) || "").trim();
    }

    /* Show helper — replicates the engine's wf-algolia-display rule: honor the
       attribute if present, otherwise clear the inline display. */
    function showEl(el) {
      if (!el) return;
      var disp = el.getAttribute("wf-algolia-display");
      if (disp) {
        el.style.display = disp;
      } else {
        el.style.removeProperty("display");
      }
    }

    function hideEl(el) {
      if (el) el.style.display = "none";
    }

    /* One entry per section: the section element, its index, its per-section
       cap, and a captured clone of its hit-card template. Filled in by start()
       — which may run on the retry path, so it stays empty until then and
       renderDefaults() simply finds nothing renderable in the meantime. */
    var pairs = [];
    var missingTemplates = false;
    var started = false;

    /* --- Rendering --- */

    function renderSection(pair, result) {
      if (!pair.templateClone) return;
      var section = pair.section;
      /* Remove our previous default clones (direct-child .wf-algolia-injected).
         A real engine render sweeps these itself; on clear we sweep here. */
      var existing = section.querySelectorAll(":scope > .wf-algolia-injected");
      Array.prototype.forEach.call(existing, function (el) {
        el.remove();
      });

      var hits = (result && result.hits) || [];
      if (!hits.length) {
        hideEl(section); // hide a section that returned nothing
        return;
      }
      hits = hits.slice(0, pair.cap); // defensive: never render past the cap
      hits.forEach(function (hit) {
        try {
          // Enrich for insights, matching what the engine stamps on hits.
          hit.__indexName = pair.indexName;
          hit.__queryID = result.queryID;
          var clone = window.WfAlgolia.cloneAndPopulate(
            pair.templateClone,
            hit
          );
          if (clone) section.appendChild(clone);
        } catch (e) {
          /* skip a bad hit — never break the page */
        }
      });
      showEl(section);
    }

    function renderDefaults() {
      try {
        if (
          !window.WfAlgolia ||
          typeof window.WfAlgolia.multiSearch !== "function" ||
          typeof window.WfAlgolia.cloneAndPopulate !== "function"
        ) {
          return;
        }
        if (inputValue() !== "") return; // only default-render on an empty query

        var renderable = pairs.filter(function (p) {
          return !!p.templateClone;
        });
        if (!renderable.length) return;

        var queries = renderable.map(function (p) {
          return {
            indexName: p.indexName,
            query: "",
            params: {
              hitsPerPage: p.cap,
              clickAnalytics: true
            }
          };
        });

        window.WfAlgolia
          .multiSearch(queries)
          .then(function (response) {
            try {
              // The user may have typed during the round-trip — discard if so.
              if (inputValue() !== "") return;
              var results = (response && response.results) || [];
              renderable.forEach(function (p, i) {
                renderSection(p, results[i]);
              });
              hideEl(noResultsEl); // defaults never show the no-results element
              showEl(resultsEl); // reveal the container (first render clears flash)
            } catch (e) {
              /* never break the page */
            }
          })
          .catch(function () {
            /* network/API error — leave native behavior intact */
          });
      } catch (e) {
        /* never break the page */
      }
    }

    var renderTimer = null;
    function scheduleRender() {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(function () {
        renderTimer = null;
        renderDefaults();
      }, RENDER_DEBOUNCE_MS);
    }

    /* Keep the results area ALWAYS visible: whenever the engine hides it
       (empty query / Escape / outside click all set display:none), re-show it
       immediately. Only react when display becomes "none" so our own show
       mutations do not loop. */
    function startObserver() {
      try {
        var observer = new MutationObserver(function (mutations) {
          for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].attributeName !== "style") continue;
            if (resultsEl.style.display === "none") {
              showEl(resultsEl);
              // If the query is empty, repaint the defaults (the engine may
              // have hidden without touching our clones). Debounced so a burst
              // of hide events collapses into one query.
              if (inputValue() === "") scheduleRender();
            }
          }
        });
        observer.observe(resultsEl, {
          attributes: true,
          attributeFilter: ["style"]
        });
      } catch (e) {
        /* MutationObserver unavailable — degrade gracefully */
      }
    }

    /* Re-render defaults whenever the input is cleared to empty. Typing a
       non-empty value is left entirely to the engine (its own sweep removes
       our default clones on the next render). */
    document.addEventListener("input", function (event) {
      if (event.target !== input) return;
      if (inputValue() === "") scheduleRender();
    });

    /* --- Wait for the engine, then observe + do the initial render --- */
    function waitForEngineThenRender() {
      var pollTimer = setInterval(function () {
        if (
          window.WfAlgolia &&
          typeof window.WfAlgolia.multiSearch === "function" &&
          typeof window.WfAlgolia.cloneAndPopulate === "function"
        ) {
          clearInterval(pollTimer);
          startObserver();
          renderDefaults();
        } else if (pastDeadline()) {
          clearInterval(pollTimer); // give up quietly, native behavior intact
        }
      }, ENGINE_POLL_MS);
    }

    /* --- Step 2: if the engine already detached some templates, recover them
       from the page's own HTML (matched to each section by wf-algolia-index),
       then start. Otherwise start immediately. --- */
    function ensureTemplatesThenStart() {
      if (!missingTemplates || typeof window.fetch !== "function") {
        waitForEngineThenRender();
        return;
      }
      window
        .fetch(window.location.href, { credentials: "same-origin" })
        .then(function (r) {
          return r.text();
        })
        .then(function (html) {
          try {
            var doc = new DOMParser().parseFromString(html, "text/html");
            /* The parsed page carries the SAME look-alike containers the live
               one does, so resolve inside it with the same care: prefer the
               search wrapper's results container, and never accept a section
               owned by a browse widget. */
            var srcRoot = resolveResultsEl(doc) || doc;
            pairs.forEach(function (p) {
              if (p.templateClone) return;
              var selector =
                '[wf-algolia-element="section"][wf-algolia-index="' +
                p.indexName +
                '"]';
              var srcSection =
                firstOutsideBrowse(srcRoot, selector) ||
                firstOutsideBrowse(doc, selector);
              var srcTpl =
                srcSection && srcSection.querySelector(TEMPLATE_SELECTOR);
              if (srcTpl) {
                p.templateClone = document.importNode(srcTpl, true);
              }
            });
          } catch (e) {
            /* parse failure — proceed with whatever we captured live */
          }
          waitForEngineThenRender();
        })
        .catch(function () {
          waitForEngineThenRender(); // fetch failed — proceed with live captures
        });
    }

    /* --- Entry point: build the section pairs, capture their templates as
       early as possible, then hand off to the recovery/engine-wait chain.

       Returns TRUE only when it has committed to a usable set of sections.
       Anything less leaves every flag untouched so the caller keeps retrying —
       a section authored with an empty wf-algolia-index (a CMS placeholder
       still binding) matches the selector but yields no pair, and that must
       not be mistaken for "done". --- */
    function start(sections) {
      if (started) return true;
      if (!sections || !sections.length) return false;

      /* Trust the sections we actually found over anything resolved earlier:
         re-derive the container from them, so the cards we paint and the
         container we reveal/observe can never be two different elements. */
      var owner = null;
      try {
        if (sections[0] && typeof sections[0].closest === "function") {
          owner = sections[0].closest(RESULTS_SELECTOR);
        }
      } catch (e) {
        /* fall through to the ladder */
      }
      if (owner && inBrowseWidget(owner)) owner = null;
      resultsEl = owner || resolveResultsEl(document) || resultsEl;
      if (!resultsEl || !input) return false;

      var built = [];
      Array.prototype.forEach.call(sections, function (section) {
        var indexName = section.getAttribute("wf-algolia-index");
        if (!indexName) return; // unbound placeholder — skip, stay retryable
        built.push({
          section: section,
          indexName: indexName,
          cap: capFor(section),
          templateClone: null
        });
      });
      if (!built.length) return false; // nothing usable YET — keep polling

      started = true;
      pairs = built;
      noResultsEl = resultsEl.querySelector(NO_RESULTS_SELECTOR);

      /* --- Step 1: capture templates from the live DOM. Best-effort only —
         the engine is async in the head, so it may already have detached them.
         Anything missed here is recovered from the page HTML by step 2. */
      pairs.forEach(function (p) {
        var tpl = p.section.querySelector(TEMPLATE_SELECTOR);
        if (tpl) {
          p.templateClone = tpl.cloneNode(true);
        } else {
          missingTemplates = true;
        }
      });

      ensureTemplatesThenStart();
      return true;
    }

    /* Markup that is not usable YET is not markup that is absent. The results
       container, the input and the sections can all still be settling (the
       browse widgets that shadow the container are removed after load, and CMS
       attribute binding lands late), so re-resolve all three on every tick and
       only stop when start() reports success or the shared deadline expires. */
    function waitForMarkupThenStart() {
      var pollTimer = setInterval(function () {
        try {
          resolveMarkup();
          if (start(findSections())) {
            clearInterval(pollTimer);
          } else if (pastDeadline()) {
            clearInterval(pollTimer); // give up quietly, native behavior intact
          }
        } catch (e) {
          clearInterval(pollTimer); // never break the page
        }
      }, ENGINE_POLL_MS);
    }

    if (!start(findSections())) waitForMarkupThenStart();
  } catch (e) {
    /* never break the page */
  }
})();
