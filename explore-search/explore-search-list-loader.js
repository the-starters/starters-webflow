/* explore-search-list-loader.js — masks layout jank while result lists change.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds
 * (the fetch/XHR interception below is deliberately duplicated from
 * explore-search-tab-counts.js so each embed stays independent).
 *
 * What it does: while a result-list transition is in flight (typing /
 * filtering / clearing all trigger Algolia "/queries" requests), it SHOWS a
 * designer-authored loader element and hides the list content with
 * `visibility: hidden` (visibility, NOT display — the layout space is kept
 * and it never fights the engine's or default-results' display writes).
 * When the transition settles, the loader hides and the list reappears.
 *
 * Contract:
 * - Loader element: [data-loader] anywhere inside
 *   [wf-algolia-element="search-wrapper"]. Authoring it HIDDEN (Display:None
 *   in Webflow / inline style="display: none") is still recommended — it
 *   prevents any flash before this script runs — but the embed also
 *   force-hides it once at init as a self-heal, so authored-visible loaders
 *   never stay on screen outside a session. This embed shows it during
 *   transitions and re-hides it after. Fail-safe: embed absent means the
 *   loader simply never appears (an authored-hidden loader stays hidden).
 *   When showing, a wf-algolia-display attribute on the loader is honored;
 *   otherwise the inline display is cleared (display "").
 * - Minimum display duration: 200ms by default; a numeric attribute value
 *   overrides it (e.g. data-loader="350" shows for at least 350ms).
 * - Transition detection: fetch + XMLHttpRequest are patched (observe only);
 *   requests whose URL contains "algolia" AND "/queries" (plural — this
 *   naturally excludes the Query Suggestions "/query" fetch) start a loader
 *   session. The list content hidden is the [data-tab-component="panel-list"]
 *   inside [wf-algolia-element="results"], falling back to the results
 *   element's first element child.
 * - Initial automatic queries never show the loader: the engine fires
 *   "/queries" for default results during page load, before any interaction.
 *   The loader stays "unarmed" until the FIRST pointerdown/keydown/input
 *   inside [wf-algolia-element="search-wrapper"] (typing, clicking a filter/
 *   chip/tab, or IME/paste/autofill text insertion that fires no keydown).
 *   Only requests that fire while armed start a session; un-armed requests
 *   are ignored entirely (no counter changes, no loader).
 * - The session ends only when BOTH (a) the minimum display time has elapsed
 *   since the loader was shown and (b) every in-flight request has settled.
 *   Overlapping requests (rapid typing) coalesce into ONE session that ends
 *   after the LAST request settles. Visibility is restored on success, error
 *   and abort paths alike — the list can never stay hidden.
 * - Bails out quietly when no [data-loader] element exists in the parsed DOM
 *   (deferred script = DOM fully parsed, i.e. DOMContentLoaded content).
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-list-loader.js
 */
(function () {
  if (window.__exploreSearchListLoaderInit) return;
  window.__exploreSearchListLoaderInit = true;

  var DEFAULT_MIN_MS = 200;

  /* --- Resolve the contract markup (defer = DOM parsed). --- */

  var searchWrapperEl = document.querySelector(
    '[wf-algolia-element="search-wrapper"]'
  );

  var loader =
    searchWrapperEl && searchWrapperEl.querySelector('[data-loader]');
  if (!loader) return; // no loader authored — bail quietly, patch nothing

  var minMs = DEFAULT_MIN_MS;
  var authored = parseInt(loader.getAttribute("data-loader"), 10);
  if (isFinite(authored) && authored >= 0) minMs = authored;

  /* Self-heal: the contract says author the loader hidden, but if the page
     ships it visible, force-hide it now — the loader must never be
     user-visible outside a session. (hideLoader never throws.) */
  hideLoader();

  var resultsEl = document.querySelector('[wf-algolia-element="results"]');
  var listEl =
    (resultsEl &&
      (resultsEl.querySelector('[data-tab-component="panel-list"]') ||
        resultsEl.firstElementChild)) ||
    null;

  /* --- Show/hide helpers (never throw) --- */

  function showLoader() {
    try {
      var disp = loader.getAttribute("wf-algolia-display");
      loader.style.display = disp || "";
    } catch (e) {
      /* never break the page */
    }
  }

  function hideLoader() {
    try {
      loader.style.display = "none";
    } catch (e) {
      /* never break the page */
    }
  }

  function hideList() {
    try {
      if (listEl) listEl.style.visibility = "hidden";
    } catch (e) {
      /* never break the page */
    }
  }

  function showList() {
    try {
      if (listEl) listEl.style.visibility = "";
    } catch (e) {
      /* never break the page */
    }
  }

  /* --- Arming: ignore the engine's automatic initial-load queries --- */
  /* The loader stays disarmed until the user actually interacts with the
     search UI, so default-results "/queries" (fired during page load) never
     show it. Arms on pointerdown, keydown, or input — the input listener
     covers IME-style text insertion (mobile IMEs, context-menu paste,
     autofill, automation) that changes the field without any keydown.
     Capture phase so arming lands before the engine's own handlers fire the
     Algolia request in the same interaction. */

  var armed = false;

  function arm() {
    armed = true;
  }

  if (searchWrapperEl) {
    try {
      searchWrapperEl.addEventListener("pointerdown", arm, {
        capture: true,
        once: true,
      });
      searchWrapperEl.addEventListener("keydown", arm, {
        capture: true,
        once: true,
      });
      searchWrapperEl.addEventListener("input", arm, {
        capture: true,
        once: true,
      });
    } catch (e) {
      /* never break the page */
    }
  }

  /* --- Loader session (coalesces overlapping requests) --- */

  var inFlight = 0;
  var sessionActive = false;
  var shownAt = 0;
  var settleTimer = null;

  function cancelSettle() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
  }

  function beginRequest() {
    try {
      inFlight++;
      cancelSettle(); // a new request extends the current session
      if (!sessionActive) {
        sessionActive = true;
        shownAt = Date.now();
        showLoader();
        hideList();
      }
    } catch (e) {
      /* never break the page */
    }
  }

  /* Called on EVERY settle path (success, HTTP error, network error, abort,
     timeout) so the list can never stay hidden. */
  function endRequest() {
    try {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight > 0) return; // wait for the LAST in-flight request
      // End only when BOTH the min display elapsed AND everything settled.
      var remaining = Math.max(0, minMs - (Date.now() - shownAt));
      cancelSettle();
      settleTimer = setTimeout(function () {
        settleTimer = null;
        if (inFlight > 0) return; // a new request started meanwhile — keep going
        sessionActive = false;
        hideLoader();
        showList();
      }, remaining);
    } catch (e) {
      /* worst case: force-restore the list */
      sessionActive = false;
      hideLoader();
      showList();
    }
  }

  function isAlgoliaQueriesUrl(url) {
    return (
      typeof url === "string" &&
      url.indexOf("algolia") !== -1 &&
      url.indexOf("/queries") !== -1
    );
  }

  /* --- Patch fetch (observe only; request/response untouched) --- */

  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var tracked = false;
      try {
        var url =
          typeof input === "string"
            ? input
            : input && typeof input.url === "string"
              ? input.url
              : "";
        tracked = armed && isAlgoliaQueriesUrl(url);
      } catch (e) {
        tracked = false;
      }
      if (tracked) beginRequest();
      var promise;
      try {
        promise = originalFetch.apply(this, arguments);
      } catch (e) {
        if (tracked) endRequest(); // synchronous throw still settles the session
        throw e;
      }
      if (tracked) {
        promise.then(
          function () {
            endRequest();
          },
          function () {
            endRequest();
          }
        );
      }
      return promise;
    };
  }

  /* --- Patch XMLHttpRequest (open records the URL; loadend covers load,
     error, abort and timeout in one hook) --- */

  if (window.XMLHttpRequest) {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        this.__exploreListLoaderUrl = url;
      } catch (e) {
        /* ignore */
      }
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var tracked = false;
      try {
        tracked = armed && isAlgoliaQueriesUrl(this.__exploreListLoaderUrl);
      } catch (e) {
        tracked = false;
      }
      if (tracked) {
        beginRequest();
        this.addEventListener("loadend", function () {
          endRequest();
        });
      }
      return originalSend.apply(this, arguments);
    };
  }
})();
