/* expert-card-browse-loader.js — masks browse-list jank behind the loader.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone: no
 * imports, no shared globals with the sibling expert-card embeds.
 *
 * What it does: the wf-algolia "browse" engine on /all-starters re-queries and
 * re-renders on every filter/sort/paginate/clear/commit/refresh (and fires the
 * query TWICE per click, ~70ms apart). Freshly injected cards paint raw, then
 * ~380ms later the result-modifier embeds rewrite text and expert-card.js
 * equalizes heights — a visible reflow. This embed hides that churn: while a
 * browse transition is in flight it SHOWS the designer-authored loader and
 * hides the results list with `visibility: hidden` (visibility, NOT display —
 * the layout space is kept, and it never fights the engine's own display
 * writes). When the transition settles (cards rendered AND heights equalized),
 * the loader hides and the list reappears in its final layout.
 *
 * Unlike explore-search-list-loader.js (which sniffs network traffic), this
 * embed hooks the engine directly: cache-served browse queries produce zero
 * network traffic, so it watches the engine's own loader show/hide writes and
 * its "results"/"error" bus events instead.
 *
 * Contract:
 * - Browse block: [wf-algolia-element="browse"]. Loader element: [data-loader]
 *   inside it (the page authors <div data-loader="1000" ...> as a SIBLING of
 *   the results list, so hiding the list never hides the loader). Results list:
 *   [wf-algolia-element="results"]. Any missing → bail quietly, patch nothing.
 * - Self-heal: the page currently ships the loader permanently visible with no
 *   script managing it; this embed force-hides it once at init. The loader is
 *   never user-visible outside a session.
 * - Minimum display duration: 200ms by default; the numeric [data-loader]
 *   value overrides it (e.g. data-loader="1000" shows for at least 1000ms).
 * - Engine contract promotion: the engine's runBrowseQuery() shows a
 *   [wf-algolia-element="loader"] before every query (re-querying the DOM each
 *   call, so a late-added attribute is honored) and hides it before injecting
 *   hits — for cache-served repeats too. We promote OUR [data-loader] to that
 *   contract (add wf-algolia-element="loader" and wf-algolia-display="block",
 *   the latter to avoid the engine's display:block console warning). If browse
 *   already has a DIFFERENT [wf-algolia-element="loader"], we skip promoting
 *   but still drive show/hide through OUR [data-loader] element.
 * - Session start: a MutationObserver on the loader's style attribute drives a
 *   convergent state machine (NO write attribution — observer callbacks are
 *   async microtasks, so a synchronous suppress flag is useless). When the
 *   engine shows the loader while idle, a session begins (record shown time,
 *   hide the list). While a session is active the loader is kept visible: if
 *   the engine hides it mid-session, our re-show rewrites the style, which
 *   re-fires the callback that then sees visible+active and no-ops — it
 *   converges without looping. endSession's hide converges the same way.
 * - Settle: each WfAlgolia "results" event (re)starts a settle-wait that
 *   resolves on the next window "expert-cards:relayout:done" (600ms timeout
 *   fallback if a page lacks expert-card.js) plus two rAFs raced against a short
 *   timeout — hidden tabs suspend rAF — to let the height writes paint.
 *   "relayout:done" events are IGNORED until the session's
 *   first "results" event: expert-card.js also dispatches it from its
 *   window-load, fonts.ready and resize passes, and a stray one mid-query
 *   (e.g. fonts.ready during the initial load) would otherwise settle the
 *   session before cards render. The engine's double-fire, or a new engine
 *   loader-show during the wait, restarts the session rather than ending early.
 * - Session end: only when BOTH the settle-wait completed AND the minimum
 *   display time elapsed — hide the loader, restore the list. "error" ends the
 *   session after min display without waiting for relayout:done. A 6s failsafe
 *   ceiling force-ends unconditionally. Every path is wrapped in try/catch and
 *   restores the list — it can never stay hidden (success, error, timeout,
 *   exception alike).
 * - The initial page-load query also shows the loader via the engine, which is
 *   desirable (it masks initial-load tweaking too). No arming logic is needed:
 *   the "results"/"error" events and the loader show/hide are emitted ONLY by
 *   browse mode, so every trigger here is browse-scoped by construction.
 * - Bails out quietly when the contract markup is absent, or if WfAlgolia never
 *   appears within 10s (then it force-restores everything and stays off).
 * - Accepted limitation: a mid-session query that resolves LATER than the
 *   remaining minimum-display time after a settle can render unmasked (the
 *   session will already have ended). This is rare — the engine's double-fire
 *   queries run ~70ms apart, well inside the default/authored min display — it
 *   self-corrects via the relayout pipeline, and it can never leave the list
 *   hidden.
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/global-embeds/expert-card/expert-card-browse-loader.js
 */
(function () {
  if (window.__expertCardBrowseLoaderInit) return;
  window.__expertCardBrowseLoaderInit = true;

  var DEFAULT_MIN_MS = 200;
  var SETTLE_TIMEOUT_MS = 600; // relayout:done may never come (no expert-card.js)
  var SESSION_CEILING_MS = 6000; // hard failsafe: never mask longer than this
  var POLL_INTERVAL_MS = 100;
  var POLL_MAX_MS = 10000;

  /* --- Resolve the contract markup (defer = DOM parsed). --- */

  var browseEl = document.querySelector('[wf-algolia-element="browse"]');
  var loader = browseEl && browseEl.querySelector('[data-loader]');
  var listEl =
    browseEl && browseEl.querySelector('[wf-algolia-element="results"]');
  if (!browseEl || !loader || !listEl) return; // markup missing — bail quietly

  /* --- Minimum display duration from [data-loader]. --- */

  var minMs = DEFAULT_MIN_MS;
  var authored = parseInt(loader.getAttribute('data-loader'), 10);
  if (isFinite(authored) && authored >= 0) minMs = authored;

  /* --- Show/hide helpers (never throw). ---
     No write attribution: MutationObserver callbacks are async microtasks, so a
     synchronous suppress flag is always reset by the time the callback runs.
     Instead the observer is a convergent state machine (see below) — our own
     writes re-trigger it and simply no-op once state agrees. */

  function hideLoader() {
    try {
      loader.style.display = 'none';
    } catch (e) {
      /* never break the page */
    }
  }

  function showLoader() {
    try {
      var disp = loader.getAttribute('wf-algolia-display');
      loader.style.display = disp || 'block';
    } catch (e) {
      /* never break the page */
    }
  }

  function hideList() {
    try {
      listEl.style.visibility = 'hidden';
    } catch (e) {
      /* never break the page */
    }
  }

  function showList() {
    try {
      listEl.style.visibility = '';
    } catch (e) {
      /* never break the page */
    }
  }

  /* Self-heal: the page ships the loader visible with no manager. Hide it now;
     it must never be user-visible outside a session. */
  hideLoader();

  /* --- Promote the loader to the engine's native loader contract. --- */

  try {
    var existingLoader = browseEl.querySelector('[wf-algolia-element="loader"]');
    if (!existingLoader || existingLoader === loader) {
      // No other engine loader (or it IS our element) — safe to promote ours.
      if (!loader.getAttribute('wf-algolia-element')) {
        loader.setAttribute('wf-algolia-element', 'loader');
      }
      if (!loader.getAttribute('wf-algolia-display')) {
        // Prevents the engine's "display:block" console warning on show.
        loader.setAttribute('wf-algolia-display', 'block');
      }
    }
    // If a DIFFERENT engine loader already exists, we skip promoting but still
    // drive show/hide through our [data-loader] element below.
  } catch (e) {
    /* never break the page */
  }

  /* --- Session state --- */

  var sessionActive = false;
  var shownAt = 0;
  var settleDone = false;
  var settleTimer = null;
  var settleRafScheduled = false;
  var settleArmed = false; // set only after the session's first "results"
  var ceilingTimer = null;

  function clearSettleTimer() {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  function clearCeiling() {
    if (ceilingTimer) {
      clearTimeout(ceilingTimer);
      ceilingTimer = null;
    }
  }

  // Run fn after two rAFs OR a timeout, whichever fires first, exactly once.
  // Hidden/occluded tabs suspend rAF entirely, so the timeout guarantees the
  // settle chain still completes there instead of stalling until the tab shows.
  function afterFramesOrTimeout(fn, ms) {
    var ran = false;
    function run() {
      if (ran) return;
      ran = true;
      fn();
    }
    try {
      requestAnimationFrame(function () {
        requestAnimationFrame(run);
      });
    } catch (e) {
      /* rAF unavailable — the timeout below still runs fn */
    }
    setTimeout(run, ms);
  }

  /* END: only when BOTH the settle-wait completed AND min display elapsed. */
  function tryEndSession() {
    try {
      if (!sessionActive || !settleDone) return;
      var remaining = Math.max(0, minMs - (Date.now() - shownAt));
      if (remaining > 0) {
        clearSettleTimer();
        settleTimer = setTimeout(function () {
          settleTimer = null;
          tryEndSession();
        }, remaining);
        return;
      }
      endSession();
    } catch (e) {
      endSession(); // worst case: force-restore
    }
  }

  function endSession() {
    try {
      sessionActive = false;
      settleDone = false;
      settleRafScheduled = false;
      settleArmed = false;
      clearSettleTimer();
      clearCeiling();
      hideLoader();
      showList();
    } catch (e) {
      /* invariant: the list can never stay hidden */
      try {
        showList();
      } catch (e2) {}
    }
  }

  function beginSession() {
    try {
      sessionActive = true;
      settleDone = false;
      settleRafScheduled = false;
      settleArmed = false;
      shownAt = Date.now();
      hideList();
      clearCeiling();
      ceilingTimer = setTimeout(function () {
        ceilingTimer = null;
        endSession(); // hard ceiling: unconditional force-end
      }, SESSION_CEILING_MS);
    } catch (e) {
      /* never break the page */
    }
  }

  /* SETTLE: wait for expert-cards:relayout:done (or timeout), then two rAFs
     raced against a short timeout — hidden tabs suspend rAF — to let the height
     writes paint, then mark the settle-wait complete. */
  function markSettled() {
    if (settleRafScheduled) return;
    settleRafScheduled = true;
    afterFramesOrTimeout(function () {
      if (!sessionActive) return;
      settleDone = true;
      tryEndSession();
    }, 150);
  }

  function onRelayoutDone() {
    // Ignore done events until the session's first "results" has fired.
    // expert-card.js also dispatches relayout:done from its window-load,
    // fonts.ready and resize passes; a stray one mid-query (e.g. fonts.ready on
    // initial load) would otherwise settle the session before cards render.
    if (!sessionActive || !settleArmed || settleRafScheduled) return;
    clearSettleTimer();
    markSettled();
  }

  function startSettleWait() {
    try {
      if (!sessionActive) return;
      // A new "results" fired — arm the settle-wait and restart it (do not end
      // early). Arming here means a relayout:done now counts toward settling.
      settleArmed = true;
      settleDone = false;
      settleRafScheduled = false;
      clearSettleTimer();
      settleTimer = setTimeout(function () {
        settleTimer = null;
        // relayout:done never came (page may lack expert-card.js) — settle.
        markSettled();
      }, SETTLE_TIMEOUT_MS);
    } catch (e) {
      /* never break the page */
    }
  }

  window.addEventListener('expert-cards:relayout:done', onRelayoutDone);

  /* --- Observe the engine's loader show/hide writes. --- */

  function onLoaderStyleMutation() {
    try {
      // Convergent state machine — no write attribution. Our own writes
      // re-trigger this callback and simply no-op once state agrees.
      var visible = loader.style.display !== 'none';
      if (sessionActive && !visible) {
        // Engine hid the loader mid-session — keep the spinner up while masked.
        // This rewrite re-fires the callback, which then sees visible+active
        // and no-ops: it converges, no loop.
        showLoader();
      } else if (!sessionActive && visible) {
        // Engine showed the loader while idle — begin masking this transition.
        beginSession();
      }
      // (sessionActive && visible) and (!sessionActive && !visible) both no-op.
    } catch (e) {
      /* never break the page */
    }
  }

  try {
    var observer = new MutationObserver(onLoaderStyleMutation);
    observer.observe(loader, {
      attributes: true,
      attributeFilter: ['style'],
    });
  } catch (e) {
    /* never break the page */
  }

  /* --- Wire the engine bus once WfAlgolia is ready. --- */

  function onResults() {
    if (!sessionActive) return;
    startSettleWait();
  }

  function onError() {
    if (!sessionActive) return;
    // End after min display without waiting for relayout:done.
    settleDone = true;
    settleRafScheduled = true; // don't let a later rAF path re-open the wait
    clearSettleTimer();
    tryEndSession();
  }

  var pollStart = Date.now();
  var pollTimer = setInterval(function () {
    try {
      if (window.WfAlgolia && typeof window.WfAlgolia.on === 'function') {
        clearInterval(pollTimer);
        try {
          window.WfAlgolia.on('results', onResults);
          window.WfAlgolia.on('error', onError);
        } catch (e) {
          /* never break the page */
        }
        return;
      }
      if (Date.now() - pollStart >= POLL_MAX_MS) {
        clearInterval(pollTimer);
        // Engine never appeared — force-restore and stay off.
        try {
          if (observer) observer.disconnect();
        } catch (e) {}
        endSession();
      }
    } catch (e) {
      clearInterval(pollTimer);
      endSession();
    }
  }, POLL_INTERVAL_MS);
})();
