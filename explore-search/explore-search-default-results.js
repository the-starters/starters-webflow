/* explore-search-default-results.js — DEFAULT result lists for the empty query.
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
 * Behavior / timing:
 * - Rendering goes through the engine's own public API: WfAlgolia.multiSearch
 *   for the empty-query fetch and WfAlgolia.cloneAndPopulate(templateEl, hit)
 *   for each hit (which stamps class wf-algolia-injected, so the engine's own
 *   pre-render sweep removes these clones when a real search renders).
 * - cloneAndPopulate needs the section's hit-card TEMPLATE element, but the
 *   engine DETACHES those templates from the DOM when it initializes. This
 *   embed captures them with a two-step, race-proof strategy:
 *     1. Live DOM: if a deferred run beats engine init (the normal Webflow
 *        case — init is queued via Webflow.push and drains around
 *        DOMContentLoaded), clone each section's direct-child template in
 *        place.
 *     2. Fallback: if the engine already detached them (e.g. a cached engine
 *        module that initialized before this deferred script ran), re-fetch
 *        the current page's HTML and parse the templates back out, matching
 *        each to its section by wf-algolia-index. This is why the templates
 *        must be authored in the page markup (they are, hidden).
 * - It then waits (polling) for window.WfAlgolia, which only exists AFTER the
 *   engine initializes. On a ~15s timeout it bails quietly, leaving native
 *   behavior intact (fail-safe).
 * - The results container stays authored display:none until the first default
 *   render completes, so there is no empty flash.
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

    var sectionEls = resultsEl.querySelectorAll(
      '[wf-algolia-element="section"][wf-algolia-index]'
    );
    if (!sectionEls.length) return;

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
      return (input.value || "").trim();
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
       cap, and (filled in below) a captured clone of its hit-card template. */
    var pairs = [];
    Array.prototype.forEach.call(sectionEls, function (section) {
      var indexName = section.getAttribute("wf-algolia-index");
      if (!indexName) return;
      pairs.push({
        section: section,
        indexName: indexName,
        cap: capFor(section),
        templateClone: null
      });
    });
    if (!pairs.length) return;

    /* --- Step 1: capture templates from the live DOM (wins the race in the
       normal Webflow case, where engine init is deferred to the ready-queue). */
    var missingTemplates = false;
    pairs.forEach(function (p) {
      var tpl = p.section.querySelector(
        ':scope > [wf-algolia-element="template"]'
      );
      if (tpl) {
        p.templateClone = tpl.cloneNode(true);
      } else {
        missingTemplates = true;
      }
    });

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
      var started = Date.now();
      var pollTimer = setInterval(function () {
        if (
          window.WfAlgolia &&
          typeof window.WfAlgolia.multiSearch === "function" &&
          typeof window.WfAlgolia.cloneAndPopulate === "function"
        ) {
          clearInterval(pollTimer);
          startObserver();
          renderDefaults();
        } else if (Date.now() - started > ENGINE_TIMEOUT_MS) {
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
            pairs.forEach(function (p) {
              if (p.templateClone) return;
              var srcSection = doc.querySelector(
                '[wf-algolia-element="section"][wf-algolia-index="' +
                  p.indexName +
                  '"]'
              );
              var srcTpl =
                srcSection &&
                srcSection.querySelector(
                  ':scope > [wf-algolia-element="template"]'
                );
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

    ensureTemplatesThenStart();
  } catch (e) {
    /* never break the page */
  }
})();
