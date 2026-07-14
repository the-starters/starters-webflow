/* explore-search-chip-fill.js — sidebar chip -> search input filler.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds.
 *
 * What it does: a delegated document-level click listener on any element
 * carrying [data-fill-search] copies the element's text into the wf-algolia
 * search input ([wf-algolia-element="search-input"]), dispatches a real
 * bubbling `input` event (that is what the engine's debounced live-search
 * listener reacts to — a plain value assignment does nothing), and focuses
 * the input. It then announces the committed query via
 *   document.dispatchEvent(new CustomEvent("explore-search:commit",
 *     { detail: { query: <value> } }))
 * so optional companions (e.g. explore-search-recent-searches.js) can record
 * it — no storage logic lives here.
 *
 * Required markup: chips with [data-fill-search] + the wf-algolia search
 * input somewhere on the page. Bails out quietly per click if the input is
 * absent. Companions: chips rendered by explore-search-most-searched.js /
 * explore-search-recent-searches.js do nothing visible without this file.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-chip-fill.js
 */
(function () {
  if (window.__exploreSearchChipFillInit) return;
  window.__exploreSearchChipFillInit = true;

  document.addEventListener("click", function (event) {
    var chip = event.target.closest("[data-fill-search]");
    if (!chip) return;

    var input = document.querySelector(
      'input[wf-algolia-element="search-input"]'
    );
    if (!input) return;

    input.value = chip.textContent.trim();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();

    /* A chip fill is a committed search — announce it for companions. */
    try {
      document.dispatchEvent(
        new CustomEvent("explore-search:commit", {
          detail: { query: input.value }
        })
      );
    } catch (e) {
      /* never break the page */
    }
  });
})();
