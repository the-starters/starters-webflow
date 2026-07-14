/* explore-search-recent-searches.js — the user's own recent searches as
 * chips, persisted in localStorage and rendered through a designer-owned
 * template.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone:
 * no imports, no shared globals with the sibling explore-search-*.js embeds —
 * chip clicks reach this recorder ONLY via the "explore-search:commit"
 * CustomEvent dispatched by explore-search-chip-fill.js.
 *
 * Required markup (template-clone grammar — the script keys ONLY on these
 * attributes, never on classes; style the template freely). The outer
 * recent-search-wrapper is optional but recommended: author it HIDDEN
 * (inline display:none here; Display:None in Webflow Designer) — the script
 * reveals it only while there are stored recents:
 *
 *   <div data-explore-search-element="recent-search-wrapper" style="display: none">
 *     <h2>Recent Searches</h2>
 *     <div data-explore-search-element="recent-searched-list">
 *       <button type="button" data-explore-search-element="template" style="display: none">
 *         <div data-explore-search-element="title"></div>
 *       </button>
 *     </div>
 *   </div>
 *
 * - The template is authored with inline display:none (no pre-init flash)
 *   and is DETACHED from the DOM at load; every chip on screen is a clone.
 * - If no wrapper is authored, the list element itself is shown/hidden.
 *
 * Behavior:
 * - NO placeholder recents. With 0 stored entries the wrapper stays hidden;
 *   it appears (style.display = "") the moment >= 1 entry exists — on load
 *   or live mid-session at the user's first commit — and re-hides on empty.
 *   Fail-safe by construction: script not loaded / storage blocked means the
 *   authored display:none never gets cleared, so no empty-section flash and
 *   no orphaned heading.
 * - Storage: localStorage "explore-recent-searches" (JSON array of strings,
 *   max 6, most-recent first, case-insensitive dedupe keeping the newest
 *   casing). Every storage access is guarded — in private mode reads return
 *   [] (section stays hidden) and writes fail silently.
 * - A query commits when (a) an "explore-search:commit" CustomEvent arrives
 *   (chip clicks), or (b) typing in the wf-algolia search input pauses for
 *   1.5s with a trimmed value of length >= 3. Empty/short values and
 *   programmatic resets are never recorded.
 * - Rendering: on load and after each commit the stored queries are cloned
 *   through the template. Clones get the title slot filled and are stamped
 *   with data-fill-search (behavior hook — chips do nothing visible without
 *   explore-search-chip-fill.js) and data-explore-search-injected
 *   (re-render bookkeeping).
 *
 * Bails out quietly if the list/template markup is absent.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/explore-search/explore-search-recent-searches.js
 */
(function () {
  if (window.__exploreSearchRecentSearchesInit) return;
  window.__exploreSearchRecentSearchesInit = true;

  var RECENT_KEY = "explore-recent-searches";
  var RECENT_MAX = 6;
  var COMMIT_PAUSE_MS = 1500;
  var MIN_QUERY_LENGTH = 3;

  /* Capture + DETACH the template at script run time (defer = DOM parsed).
     Bail out quietly when the markup is absent from this page. */
  var list = document.querySelector(
    '[data-explore-search-element="recent-searched-list"]'
  );
  if (!list) return;
  var template = list.querySelector(
    '[data-explore-search-element="template"]'
  );
  if (!template) return;
  template.parentNode.removeChild(template);

  /* Wrapper to show/hide with the stored state: prefer the (authored-hidden)
     recent-search-wrapper that CONTAINS the list; fall back to the list
     element itself when no wrapper is authored. */
  var wrapper = (function () {
    var wrappers = document.querySelectorAll(
      '[data-explore-search-element="recent-search-wrapper"]'
    );
    for (var i = 0; i < wrappers.length; i++) {
      if (wrappers[i].contains(list)) return wrappers[i];
    }
    return wrappers[0] || list;
  })();

  /* Template-clone helper — intentionally DUPLICATED in
     explore-search-most-searched.js so each embed stays fully standalone
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

  /* ---------- Storage (guarded for private mode) ---------- */

  function readRecent() {
    try {
      var raw = window.localStorage.getItem(RECENT_KEY);
      var stored = raw ? JSON.parse(raw) : [];
      return Array.isArray(stored)
        ? stored.filter(function (q) {
            return typeof q === "string";
          })
        : [];
    } catch (e) {
      return [];
    }
  }

  function writeRecent(queries) {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(queries));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Rendering + committing ---------- */

  /* >= 1 stored entry: render clones + reveal the authored-hidden wrapper.
     0 entries (or storage throwing -> readRecent() === []): keep/re-make it
     hidden. No placeholder recents ever render. */
  function renderRecent() {
    try {
      var queries = readRecent();
      if (queries.length) {
        renderChips(queries);
        wrapper.style.display = "";
      } else {
        wrapper.style.display = "none";
      }
    } catch (e) {
      /* never break the page */
    }
  }

  /* Push to front, case-insensitive dedupe (newest casing wins), cap at
     RECENT_MAX, persist, re-render. Short/empty queries are ignored. */
  function commitRecent(query) {
    try {
      var trimmed = (query || "").trim();
      if (trimmed.length < MIN_QUERY_LENGTH) return;
      var lower = trimmed.toLowerCase();
      var next = [trimmed]
        .concat(
          readRecent().filter(function (q) {
            return q.toLowerCase() !== lower;
          })
        )
        .slice(0, RECENT_MAX);
      if (writeRecent(next)) renderRecent();
    } catch (e) {
      /* never break the page */
    }
  }

  /* ---------- Commit detection ---------- */

  var pauseTimer = null;

  function cancelPauseCommit() {
    if (pauseTimer) clearTimeout(pauseTimer);
    pauseTimer = null;
  }

  function schedulePauseCommit(input) {
    cancelPauseCommit();
    pauseTimer = setTimeout(function () {
      pauseTimer = null;
      var value = input.value.trim();
      if (value.length >= MIN_QUERY_LENGTH) commitRecent(value);
    }, COMMIT_PAUSE_MS);
  }

  /* Typing-pause detection on the wf-algolia search input. Empty values
     cancel the pending commit (programmatic resets are never recorded). */
  document.addEventListener("input", function (event) {
    var input = document.querySelector(
      'input[wf-algolia-element="search-input"]'
    );
    if (!input || event.target !== input) return;
    if (input.value.trim() === "") {
      cancelPauseCommit();
      return;
    }
    schedulePauseCommit(input);
  });

  /* Chip clicks arrive as a CustomEvent from explore-search-chip-fill.js —
     the only cross-file coupling, by design. */
  document.addEventListener("explore-search:commit", function (event) {
    var query = event && event.detail && event.detail.query;
    if (typeof query !== "string") return;
    cancelPauseCommit(); // the chip's own input event started a timer — drop it
    commitRecent(query);
  });

  /* Initial render from storage (deferred script: DOM already parsed). */
  renderRecent();
})();
