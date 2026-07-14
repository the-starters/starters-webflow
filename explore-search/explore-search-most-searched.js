/* explore-search-most-searched.js — dynamic "Most Searched" chips from an
 * Algolia Query Suggestions index, rendered through a designer-owned template.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds.
 *
 * Required markup (template-clone grammar — the script keys ONLY on these
 * attributes, never on classes; style the template freely):
 *
 *   <div data-explore-search-element="most-searched-list"
 *        data-explore-most-search-index="explore_query_suggestions">
 *     <button type="button" data-explore-search-element="template" style="display: none">
 *       <div data-explore-search-element="title"></div>
 *     </button>
 *   </div>
 *
 * - The template is authored with inline display:none (no pre-init flash)
 *   and is DETACHED from the DOM at load; every chip on screen is a clone.
 * - data-explore-most-search-index is optional; the default index name is
 *   "explore_query_suggestions".
 *
 * Behavior: at DOMContentLoaded the QS index is queried with an empty query
 * (QS indices rank by popularity, so that returns the most-searched entries
 * first; hitsPerPage 7; each record's display text is its `query` field).
 * Success (>= 1 hit): one clone per suggestion. ANY failure (404, network,
 * empty): the built-in FALLBACK_MOST_SEARCHED labels render through the SAME
 * template, with a single console.info notice. Clones get the title slot
 * filled and are stamped with data-fill-search (behavior hook — chips do
 * nothing visible without explore-search-chip-fill.js) and
 * data-explore-search-injected (re-render bookkeeping).
 *
 * Credentials are read from the wf-algolia engine script tag
 * (script[data-app-id]: data-app-id + data-search-key) — never hardcoded.
 * Bails out quietly if the list/template markup is absent.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-most-searched.js
 */
(function () {
  if (window.__exploreSearchMostSearchedInit) return;
  window.__exploreSearchMostSearchedInit = true;

  var QS_DEFAULT_INDEX = "explore_query_suggestions";
  var QS_HITS = 7;
  var FALLBACK_MOST_SEARCHED = [
    "Marketing & Growth",
    "Creative & Brand",
    "Retention & CRM",
    "Ops, Finance & Product",
    "People & Leadership",
    "Technology",
    "Retail & Marketplace"
  ];

  /* Capture + DETACH the template at script run time (defer = DOM parsed).
     Bail out quietly when the markup is absent from this page. */
  var list = document.querySelector(
    '[data-explore-search-element="most-searched-list"]'
  );
  if (!list) return;
  var template = list.querySelector(
    '[data-explore-search-element="template"]'
  );
  if (!template) return;
  template.parentNode.removeChild(template);

  /* Template-clone helper — intentionally DUPLICATED in
     explore-search-recent-searches.js so each embed stays fully standalone
     (no shared globals between files). Keep the two copies in sync. */
  function cloneChipFromTemplate(tpl, query) {
    var clone = tpl.cloneNode(true);
    clone.style.display = ""; // clear the template's authored display:none
    clone.removeAttribute("data-explore-search-element"); // no longer a template
    var title = clone.querySelector('[data-explore-search-element="title"]');
    if (title) {
      title.textContent = query;
    } else {
      clone.textContent = query; // fallback: no title slot authored
    }
    clone.setAttribute("data-fill-search", ""); // behavior hook (chip-fill embed)
    clone.setAttribute("data-explore-search-injected", ""); // re-render bookkeeping
    return clone;
  }

  function renderChips(queries) {
    try {
      if (!queries || !queries.length) return false;
      Array.prototype.slice
        .call(list.querySelectorAll("[data-explore-search-injected]"))
        .forEach(function (el) {
          el.remove();
        });
      queries.forEach(function (query) {
        list.appendChild(cloneChipFromTemplate(template, query));
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function logQsFallback() {
    if (window.__exploreQsFallbackLogged) return;
    window.__exploreQsFallbackLogged = true;
    console.info(
      "[explore-demo] query-suggestions index not available yet — using static Most Searched chips"
    );
  }

  function renderFallback() {
    logQsFallback();
    renderChips(FALLBACK_MOST_SEARCHED);
  }

  function loadMostSearched() {
    try {
      /* Credentials come from the engine's own script tag. */
      var engineTag = document.querySelector("script[data-app-id]");
      var appId = engineTag && engineTag.getAttribute("data-app-id");
      var searchKey = engineTag && engineTag.getAttribute("data-search-key");
      if (!appId || !searchKey || typeof window.fetch !== "function") {
        renderFallback();
        return;
      }

      var indexName =
        list.getAttribute("data-explore-most-search-index") || QS_DEFAULT_INDEX;

      /* Empty query on a QS index = most popular suggestions first. */
      window
        .fetch(
          "https://" +
            appId +
            "-dsn.algolia.net/1/indexes/" +
            encodeURIComponent(indexName) +
            "/query",
          {
            method: "POST",
            headers: {
              "X-Algolia-API-Key": searchKey,
              "X-Algolia-Application-Id": appId
            },
            body: JSON.stringify({ query: "", hitsPerPage: QS_HITS })
          }
        )
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (data) {
          var queries = ((data && data.hits) || [])
            .map(function (hit) {
              return hit && typeof hit.query === "string" ? hit.query : null;
            })
            .filter(Boolean);
          if (!queries.length || !renderChips(queries)) {
            renderFallback();
          }
        })
        .catch(renderFallback);
    } catch (e) {
      renderFallback();
    }
  }

  /* Debug handle: lets the console re-run the loader (e.g. right after the
     QS index is created) without a page reload. */
  window.__exploreSearchMostSearched = { load: loadMostSearched };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadMostSearched);
  } else {
    loadMostSearched();
  }
})();
