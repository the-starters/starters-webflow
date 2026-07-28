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
 * masks the results list with `visibility: hidden` + `opacity: 0` +
 * `pointer-events: none` (NOT display — the layout space is kept, and it never
 * fights the engine's own display writes). The opacity is load-bearing:
 * visibility alone can be punched through by a descendant carrying an explicit
 * inline `visibility: visible` (e.g. interaction-written styles on the favorite
 * wrapper), which left bookmarks floating over the emptied grid mid-mask
 * (reproduced live). Ancestor opacity composites the whole subtree and cannot
 * be overridden by descendants; pointer-events blocks interaction with the
 * invisible cards. When the transition settles (cards rendered AND heights
 * equalized), the loader hides and the list reappears in its final layout.
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
 *   [wf-algolia-element="results"]. A page may hold SEVERAL browse blocks, so
 *   we scan them all and drive the first VISIBLE one that has both a loader and
 *   a results list — see the resolution note below. No qualifying block → bail
 *   quietly, patch nothing.
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
 * - Bounded image wait: after the layout settles, freshly revealed cards may
 *   still have loading="lazy" photos that finish 1-1.5s later and visibly pop
 *   in. So the settle-wait also waits for any not-yet-complete <img> in the list
 *   to load/error, raced against a 1200ms timeout, before ending the session.
 *   Each wait is stamped with a settle-attempt counter (bumped on session
 *   begin/restart/end) so a stale image wait completing after a restart can
 *   never end a newer session. The 6s ceiling still bounds everything.
 * - Reveal fade: because the mask already zeroes opacity, showList adds an
 *   `opacity 180ms ease` transition before clearing the mask (a free fade-in)
 *   and clears the transition ~250ms later; hideList clears the transition
 *   first so re-masking is always instant.
 * - Session end: only when BOTH the settle-wait completed AND the minimum
 *   display time elapsed — hide the loader, restore the list. "error" ends the
 *   session after min display without waiting for relayout:done or images. A 6s
 *   failsafe ceiling force-ends unconditionally. Every path is wrapped in
 *   try/catch and restores the list — it can never stay hidden (success, error,
 *   timeout, exception alike).
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
  var IMAGE_WAIT_MS = 1200; // bounded wait for freshly revealed lazy card imgs
  var POLL_INTERVAL_MS = 100;
  var POLL_MAX_MS = 10000;
  var RESOLVE_MAX_MS = 10000; // give Memberstack this long to settle the gates

  /* --- Resolve the contract markup.
     A page can carry SEVERAL [wf-algolia-element="browse"] blocks. /all-starters
     ships one per Memberstack gate variant plus satellites that hold only a
     results-count — 5 blocks in its raw HTML, and the FIRST has no [data-loader]
     and no results list. A plain document.querySelector() therefore grabbed a
     block this embed cannot drive and bailed at init, managing nothing
     (reproduced live 2026-07-28). Two rules make resolution deterministic:

       1. Only a block with BOTH a [data-loader] and a
          [wf-algolia-element="results"] can be driven. Skip the others instead
          of bailing on the first miss.
       2. Prefer a VISIBLE qualifying block, and wait for the gates to settle
          first. Memberstack REMOVES the non-matching variants, but only after it
          resolves — and this embed runs at defer time, before that. Binding the
          first qualifying block too early picks a variant that is about to be
          deleted, which leaves the surviving one unmanaged. So wait on
          window.memberReady (the site's own helper) and poll briefly for a
          visible match, falling back to a hidden one rather than nothing. --- */

  var browseEl = null;
  var loader = null;
  var listEl = null;
  var minMs = DEFAULT_MIN_MS;

  function qualifies(block) {
    try {
      return !!(
        block.querySelector('[data-loader]') &&
        block.querySelector('[wf-algolia-element="results"]')
      );
    } catch (e) {
      return false;
    }
  }

  // offsetParent is null inside a display:none subtree, so a gate variant that
  // Memberstack has hidden but not yet removed is skipped. getClientRects is the
  // second opinion for position:fixed subtrees, where offsetParent is also null.
  function isVisible(el) {
    try {
      return el.offsetParent !== null || el.getClientRects().length > 0;
    } catch (e) {
      return true; // never let a probe failure block resolution
    }
  }

  // Returns a visible qualifying block, else any qualifying block, else null.
  function resolveContract() {
    var blocks;
    var fallback = null;
    var i;
    try {
      blocks = document.querySelectorAll('[wf-algolia-element="browse"]');
    } catch (e) {
      return null;
    }
    for (i = 0; i < blocks.length; i++) {
      if (!qualifies(blocks[i])) continue;
      if (isVisible(blocks[i])) return blocks[i];
      if (!fallback) fallback = blocks[i];
    }
    return fallback;
  }

  // Calls run(block) at most once, as soon as a visible qualifying block exists.
  function whenGateSettled(run) {
    var started = Date.now();
    var timer = null;
    var done = false;

    function finish(block) {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      run(block);
    }

    function attempt() {
      if (done) return;
      var block = resolveContract();
      if (block && isVisible(block)) {
        finish(block);
        return;
      }
      if (Date.now() - started >= RESOLVE_MAX_MS) {
        if (block) {
          finish(block); // only hidden matches left — drive one rather than none
          return;
        }
        done = true; // nothing on this page to drive — stop polling
        if (timer) clearInterval(timer);
      }
    }

    // memberReady resolving is the strongest signal that the gates are settled;
    // the poll covers pages without the helper and Memberstack's own lag after it.
    try {
      if (window.memberReady && typeof window.memberReady.then === 'function') {
        window.memberReady.then(attempt, attempt);
      }
    } catch (e) {
      /* never break the page */
    }
    attempt();
    if (!done) timer = setInterval(attempt, POLL_INTERVAL_MS);
  }

  function bindContract(block) {
    browseEl = block;
    loader = block.querySelector('[data-loader]');
    listEl = block.querySelector('[wf-algolia-element="results"]');
    var authored = parseInt(loader.getAttribute('data-loader'), 10);
    if (isFinite(authored) && authored >= 0) minMs = authored;
  }

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
      // Masking must be INSTANT — clear any leftover reveal transition first so
      // the opacity 1->0 does not animate.
      listEl.style.transition = '';
      // opacity composites the whole subtree (a descendant cannot override it,
      // unlike visibility); pointer-events blocks interaction with the masked
      // cards. See the header note for the descendant-punch-through bug.
      listEl.style.visibility = 'hidden';
      listEl.style.opacity = '0';
      listEl.style.pointerEvents = 'none';
    } catch (e) {
      /* never break the page */
    }
  }

  function showList() {
    try {
      // Reveal is a fade for free: the mask already set opacity:0, so add an
      // opacity transition BEFORE clearing the mask, then clear the transition
      // ~250ms later (after it finishes) so it never affects the next mask.
      listEl.style.transition = 'opacity 180ms ease';
      listEl.style.visibility = '';
      listEl.style.opacity = '';
      listEl.style.pointerEvents = '';
      setTimeout(function () {
        try {
          listEl.style.transition = '';
        } catch (e) {
          /* never break the page */
        }
      }, 250);
    } catch (e) {
      /* never break the page */
    }
  }

  /* --- Self-heal + promote the loader to the engine's native loader contract.
     Runs once the contract is bound, not at file scope. --- */

  function selfHealAndPromote() {
    /* The page ships the loader visible with no manager. Hide it now; it must
       never be user-visible outside a session. */
    hideLoader();

    try {
      var existingLoader = browseEl.querySelector(
        '[wf-algolia-element="loader"]',
      );
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
      // If a DIFFERENT engine loader already exists we skip promoting, but still
      // drive show/hide through our [data-loader] element.
    } catch (e) {
      /* never break the page */
    }
  }

  /* --- Session state --- */

  var sessionActive = false;
  var shownAt = 0;
  var settleDone = false;
  var settleTimer = null;
  var settleRafScheduled = false;
  var settleArmed = false; // set only after the session's first "results"
  var settleAttempt = 0; // bumped on begin/restart/end; stamps each settle wait
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

  // Resolve `done` once, when every image in `imgs` has load/error-fired OR the
  // timeout elapses — whichever comes first. Never throws; a hung/broken image
  // can only delay up to `ms`. `imgs` is a plain array of not-yet-complete imgs.
  function waitForImages(imgs, ms, done) {
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      try {
        done();
      } catch (e) {
        /* never break the page */
      }
    }
    try {
      if (!imgs || !imgs.length) {
        finish();
        return;
      }
      var remaining = imgs.length;
      function onOne() {
        remaining--;
        if (remaining <= 0) finish();
      }
      imgs.forEach(function (img) {
        try {
          if (img.complete) {
            onOne(); // finished between the pending-scan and now
            return;
          }
          img.addEventListener('load', onOne, { once: true });
          img.addEventListener('error', onOne, { once: true });
        } catch (e) {
          onOne(); // attach failed — count it so we never hang
        }
      });
      setTimeout(finish, ms);
    } catch (e) {
      finish();
    }
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
      settleAttempt++; // invalidate any in-flight settle/image wait
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
      settleAttempt++; // new session owns a fresh settle attempt
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
     writes paint, then a bounded wait for freshly revealed lazy card images
     (so photos don't pop in 1-1.5s after the reveal), then mark the settle-wait
     complete. Each wait is stamped with the current settleAttempt; a restart
     (new results/loader-show) or an end bumps it, so a stale wait completing
     later can never end a newer session. */
  function markSettled() {
    if (settleRafScheduled) return;
    settleRafScheduled = true;
    var attempt = settleAttempt; // this settle attempt owns the wait
    afterFramesOrTimeout(function () {
      if (!sessionActive || attempt !== settleAttempt) return;
      var pending = [];
      try {
        var imgs = listEl.querySelectorAll('img');
        for (var i = 0; i < imgs.length; i++) {
          if (!imgs[i].complete) pending.push(imgs[i]);
        }
      } catch (e) {
        /* never break the page */
      }
      waitForImages(pending, IMAGE_WAIT_MS, function () {
        if (!sessionActive || attempt !== settleAttempt) return;
        settleDone = true;
        tryEndSession();
      });
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
      settleAttempt++; // restart: stale settle/image waits must not end us
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

  var observer = null;

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

  /* --- Startup, once a drivable browse block exists. --- */

  function start(block) {
    if (!block) return; // no qualifying block on this page — stay off

    bindContract(block);
    selfHealAndPromote();

    window.addEventListener('expert-cards:relayout:done', onRelayoutDone);

    try {
      observer = new MutationObserver(onLoaderStyleMutation);
      observer.observe(loader, {
        attributes: true,
        attributeFilter: ['style'],
      });
    } catch (e) {
      /* never break the page */
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
  }

  whenGateSettled(start);
})();
