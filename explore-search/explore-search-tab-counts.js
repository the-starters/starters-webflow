/* explore-search-tab-counts.js — live per-index hit counts for the tab bar.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer so the network
 * interception below is installed BEFORE the wf-algolia engine initializes
 * (the engine boots on DOMContentLoaded via the Webflow ready-queue; deferred
 * scripts always run first). Standalone: no imports, no shared globals with
 * the sibling explore-search-*.js embeds.
 *
 * What it does:
 * - Intercepts the engine's OWN Algolia responses (fetch + XMLHttpRequest,
 *   URLs containing "algolia" and "/queries"), pairs the request body's
 *   requests[] (indexName + query) positionally with the response's results[]
 *   (nbHits), and writes the bare number into each
 *   [data-tab-count-for="<indexName>"] span. Zero extra Algolia operations;
 *   the underlying requests are untouched. Only requests carrying
 *   clickAnalytics=true are counted — unrelated page scripts (e.g. the navbar
 *   mega-menu's category preloads) issue their own /queries batches that must
 *   not pollute the tab counts.
 * - Remembers counts PER QUERY: every intercepted batch is recorded into a
 *   { trimmedQuery -> { indexName: nbHits } } store. This exists because the
 *   algoliasearch JS client caches identical requests IN MEMORY: a repeat
 *   query (e.g. re-picking a "Most Searched" chip) is served from that client
 *   cache with ZERO network traffic, so the interceptor never fires. On every
 *   input event we look the current query up in this store and repaint from
 *   memory, so repeat queries show the right counts instantly instead of the
 *   stale numbers left over from the last request that DID hit the wire.
 * - Query-match guard: an intercepted batch only repaints the tab spans when
 *   its request query equals the search input's CURRENT value at response
 *   time. This drops responses that land out of order (a slow empty-query
 *   default response arriving after a fast live-search response can no longer
 *   overwrite the live counts). Non-matching batches are still recorded in the
 *   per-query store for later repaint-from-memory, just not painted now.
 * - Keeps every [data-active-tab-count] element equal to the ACTIVE tab's
 *   count. The active tab button is the `.is-active` /
 *   [data-tab-active="true"] button inside [data-tab-component="button-list"];
 *   its child [data-tab-count-for] span says which index it represents.
 *   Re-synced after every intercepted update and on button-list clicks
 *   (deferred with setTimeout 0 so the tab solution flips the class first —
 *   no new query on tab switch).
 * - Resets everything to 0 when the wf-algolia search input is cleared to a
 *   value we have no remembered counts for.
 *
 * Required markup: [data-tab-count-for="<algolia index name>"] spans inside
 * the tab buttons; optionally [data-active-tab-count] spans anywhere. Bails
 * out quietly if neither is present on the page.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-tab-counts.js
 */
(function () {
  if (window.__exploreSearchTabCountsInit) return;
  window.__exploreSearchTabCountsInit = true;

  /* Feature absent from this page — bail out quietly. */
  if (
    !document.querySelector("[data-tab-count-for]") &&
    !document.querySelector("[data-active-tab-count]")
  ) {
    return;
  }

  /* Latest total nbHits per index name, e.g. { "Freelancers3.0-dev": 122 }.
     This is the CURRENTLY PAINTED set — replaced wholesale when we repaint from
     memory so a stale index count from another query can never linger. */
  var latestCounts = {};

  /* Per-query memory: trimmed query string -> { indexName: nbHits }. Fed by
     every intercepted batch (including ones the guard declines to paint) so a
     repeat query served from the algoliasearch client's in-memory cache — with
     no network round-trip, so no interceptor fire — can still be repainted. */
  var countsByQuery = {};

  /* Paint every [data-tab-count-for] span from latestCounts. Iterating the
     spans (not latestCounts keys) means an index absent from latestCounts is
     painted 0 rather than keeping a stale number — important because we replace
     latestCounts wholesale on repaint-from-memory. */
  function renderTabCounts() {
    var spans = document.querySelectorAll("[data-tab-count-for]");
    Array.prototype.forEach.call(spans, function (el) {
      var indexName = el.getAttribute("data-tab-count-for");
      var count = latestCounts[indexName];
      el.textContent = String(typeof count === "number" ? count : 0);
    });
  }

  /* Write the ACTIVE tab's count into every [data-active-tab-count]. */
  function syncActiveCount() {
    try {
      var activeButton = document.querySelector(
        '[data-tab-component="button-list"] .is-active, ' +
          '[data-tab-component="button-list"] [data-tab-active="true"]'
      );
      var countSpan =
        activeButton && activeButton.querySelector("[data-tab-count-for]");
      var indexName = countSpan && countSpan.getAttribute("data-tab-count-for");
      var count = (indexName && latestCounts[indexName]) || 0;
      var targets = document.querySelectorAll("[data-active-tab-count]");
      Array.prototype.forEach.call(targets, function (el) {
        el.textContent = String(count);
      });
    } catch (e) {
      /* never break the page */
    }
  }

  function resetCounts() {
    latestCounts = {};
    var spans = document.querySelectorAll("[data-tab-count-for]");
    Array.prototype.forEach.call(spans, function (el) {
      el.textContent = "0";
    });
    syncActiveCount(); // active line back to "0"
  }

  /* Only requests carrying clickAnalytics=true are searches we count: the
     engine's live federated search and the default-results embed both send it.
     Unrelated page scripts (e.g. the navbar mega-menu's category preloads) and
     the engine's facet-stat auxiliary queries don't — their nbHits must not
     pollute the tab counts. Defensive: params may be a string or an object. */
  function hasClickAnalytics(r) {
    try {
      if (!r) return false;
      if (r.clickAnalytics === true) return true;
      var params = r.params;
      if (typeof params === "string") {
        return params.indexOf("clickAnalytics=true") !== -1;
      }
      return !!params && params.clickAnalytics === true;
    } catch (e) {
      return false;
    }
  }

  /* Pair request requests[] with response results[] positionally (skipping
     pairs without clickAnalytics=true), record the nbHits into the per-query
     memory store, then repaint only when the batch's query matches the input's
     CURRENT value (query-match guard). Defensive: never throw, ignore
     non-JSON. */
  function handleAlgoliaResponse(requestBody, responseText) {
    try {
      var req =
        typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody;
      var res =
        typeof responseText === "string" ? JSON.parse(responseText) : responseText;
      if (!req || !Array.isArray(req.requests)) return;
      if (!res || !Array.isArray(res.results)) return;

      /* Group this batch's counts by the request's trimmed query, then by
         index name (one multi-query batch can carry more than one query). */
      var batchByQuery = {};
      req.requests.forEach(function (r, i) {
        var result = res.results[i];
        if (!r || !r.indexName || !result || typeof result.nbHits !== "number") {
          return;
        }
        if (!hasClickAnalytics(r)) return; // not a search we count — skip
        var q = typeof r.query === "string" ? r.query.trim() : "";
        var byIndex = batchByQuery[q] || (batchByQuery[q] = {});
        /* Last-wins per (query, index) within the batch: summing would
           double-count unrelated same-index queries sharing a batch, and a
           tab represents ONE section's count. */
        byIndex[r.indexName] = result.nbHits;
      });

      /* Record every query's counts in the per-query memory store (merge per
         index so counts from separate batches for the same query accumulate). */
      Object.keys(batchByQuery).forEach(function (q) {
        var byIndex = batchByQuery[q];
        var store = countsByQuery[q] || (countsByQuery[q] = {});
        Object.keys(byIndex).forEach(function (indexName) {
          store[indexName] = byIndex[indexName];
        });
      });

      /* Query-match guard: only paint entries whose query equals the input's
         current value. Read the input fresh; if it is absent, keep today's
         behavior of painting everything unconditionally. */
      var input = document.querySelector(
        'input[wf-algolia-element="search-input"]'
      );
      var painted = false;
      if (!input) {
        Object.keys(batchByQuery).forEach(function (q) {
          var byIndex = batchByQuery[q];
          Object.keys(byIndex).forEach(function (indexName) {
            latestCounts[indexName] = byIndex[indexName];
          });
          painted = true;
        });
      } else {
        var current = (input.value || "").trim();
        var match = batchByQuery[current];
        if (match) {
          Object.keys(match).forEach(function (indexName) {
            latestCounts[indexName] = match[indexName];
          });
          painted = true;
        }
      }

      if (painted) {
        renderTabCounts();
        syncActiveCount();
      }
    } catch (e) {
      /* non-JSON or unexpected shape — ignore, never break the page */
    }
  }

  function isAlgoliaQueriesUrl(url) {
    return (
      typeof url === "string" &&
      url.indexOf("algolia") !== -1 &&
      url.indexOf("/queries") !== -1
    );
  }

  /* Patch fetch — observe only; the original request/response are untouched. */
  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var promise = originalFetch.apply(this, arguments);
      try {
        var url =
          typeof input === "string"
            ? input
            : input && typeof input.url === "string"
              ? input.url
              : "";
        if (isAlgoliaQueriesUrl(url)) {
          var body = init && init.body;
          promise
            .then(function (response) {
              try {
                response
                  .clone()
                  .text()
                  .then(function (text) {
                    handleAlgoliaResponse(body, text);
                  })
                  .catch(function () {});
              } catch (e) {
                /* ignore */
              }
            })
            .catch(function () {});
        }
      } catch (e) {
        /* ignore — never break the underlying request */
      }
      return promise;
    };
  }

  /* Patch XMLHttpRequest (open records the URL, send observes the load). */
  if (window.XMLHttpRequest) {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        this.__exploreTabCountsUrl = url;
      } catch (e) {
        /* ignore */
      }
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        if (isAlgoliaQueriesUrl(this.__exploreTabCountsUrl)) {
          var xhr = this;
          xhr.addEventListener("load", function () {
            try {
              handleAlgoliaResponse(body, xhr.responseText);
            } catch (e) {
              /* ignore */
            }
          });
        }
      } catch (e) {
        /* ignore — never break the underlying request */
      }
      return originalSend.apply(this, arguments);
    };
  }

  /* On EVERY input event, repaint from per-query memory if we have it. This is
     what defeats the algoliasearch client's in-memory cache: a repeat query
     serves the engine's hits with no network traffic, so the interceptor never
     fires — but we still hold that query's counts and repaint them instantly.
       - remembered      -> replace latestCounts with a copy and repaint.
       - empty + no memory-> resetCounts() (keeps pages without the
         default-results embed sane).
       - non-empty + no memory -> do nothing; the engine's in-flight network
         request will paint via the guarded interceptor. */
  document.addEventListener("input", function (event) {
    var input = document.querySelector(
      'input[wf-algolia-element="search-input"]'
    );
    if (!input || event.target !== input) return;
    var value = (input.value || "").trim();
    var remembered = countsByQuery[value];
    if (remembered) {
      var copy = {};
      Object.keys(remembered).forEach(function (indexName) {
        copy[indexName] = remembered[indexName];
      });
      latestCounts = copy; // replace, don't merge — no stale counts linger
      renderTabCounts();
      syncActiveCount();
    } else if (value === "") {
      resetCounts();
    }
  });

  /* Tab switches: re-sync the active line AFTER the tab solution flips the
     active class. No new query. */
  document.addEventListener("click", function (event) {
    if (event.target.closest('[data-tab-component="button-list"]')) {
      setTimeout(syncActiveCount, 0);
    }
  });

  /* Initial sync (deferred script: DOM is parsed; the tab solution may not
     have marked the active button yet — the count is 0 either way). */
  syncActiveCount();
})();
