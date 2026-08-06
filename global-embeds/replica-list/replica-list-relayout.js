/* replica-list-relayout.js — re-measure expert cards the first time a static
 * replica list becomes visible.
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. Standalone: no
 * imports, no shared globals with the expert-card embeds — it talks to them
 * only through the window CustomEvent they already listen for.
 *
 * THE GAP IT CLOSES. expert-card.js equalizes `.expert-card_company-list`
 * heights and computes `--expert-card-jobs-open-height` from scrollHeight, on
 * window load, fonts.ready, resize, and on the `expert-cards:relayout` window
 * event. Inside a `display: none` subtree every scrollHeight is 0, so that
 * routine measures nothing and bails (it explicitly skips `h <= 0`). A curated
 * replica list authored inside a Webflow modal panel is exactly that case: the
 * wf-algolia static-list mode renders its cards at engine init, while the panel
 * is still closed, and when a Webflow interaction later reveals the panel
 * NOTHING re-measures — the cards paint with unequal company lists and a
 * collapsed jobs drawer until the next resize. This embed watches each static
 * list and asks for one relayout the moment its cards are first on screen.
 *
 * Contract:
 * - Target: every `[wf-algolia-element="browse"][wf-algolia-disable-filters="true"]`
 *   block — wf-algolia's static-list mode (see REPLICA-LIST-WIRING.md). A page
 *   may hold several; a page may hold none, in which case this embed binds
 *   nothing at all and costs one querySelectorAll.
 * - A block that is ALREADY visible at init is marked done WITHOUT dispatching.
 *   expert-card.js's own window-load and fonts.ready passes measure visible
 *   content correctly, and a redundant dispatch would clear + re-apply the
 *   min/max heights, which is the visible "tweak for no reason" the
 *   browse-loader header warns about.
 * - Each block dispatches at most ONCE, then stops being watched. When no block
 *   is left pending the observer disconnects and the click listener is removed,
 *   so an opened-and-closed modal costs nothing afterwards.
 *
 * Dual detection, both cheap, whichever wins first:
 *   a. IntersectionObserver (threshold 0) per pending block. The normal path in
 *      a real tab: a modal opening flips the block from display:none to
 *      intersecting and the callback fires.
 *   b. A single capture-phase document click listener that re-checks pending
 *      blocks on the next task. This exists because IO callback delivery is not
 *      guaranteed in an occluded/hidden document (the in-app QA pane reports
 *      visibilityState "hidden": rAF is suspended and IO delivery is unreliable),
 *      and because any real "open the modal" gesture is a click. It costs one
 *      visibility probe per click and only while blocks remain pending.
 * Both funnel through the same once-per-block gate, so belt and braces can never
 * double-dispatch.
 *
 * Visibility probe: `checkVisibility()` where supported, else
 * `getClientRects().length` — NOT offsetParent, which is null for a perfectly
 * visible `position: fixed` element (a Webflow modal panel is usually fixed).
 *
 * Diagnostics are staging-gated per house convention (webflow.io / localhost /
 * 127.0.0.1 / trycloudflare.com, or `window.__replicaListDebug` /
 * `?replica-list-debug`) and silent in production. Every path is wrapped: this
 * embed must never throw on a page it does not understand.
 *
 * @release vX.Y.Z (set at tag time)
 *
 * Webflow embed (jsDelivr):
 *   https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/global-embeds/replica-list/replica-list-relayout.js
 */
(function () {
  if (window.__replicaListRelayoutInit) return;
  window.__replicaListRelayoutInit = true;

  var SELECTOR =
    '[wf-algolia-element="browse"][wf-algolia-disable-filters="true"]';
  var RELAYOUT_EVENT = 'expert-cards:relayout';

  /** Blocks whose cards have not been seen visible yet. Drains to empty. */
  var pending = [];
  var observer = null;
  var clickBound = false;

  /* --- Staging-gated diagnostics (silent in production). --- */

  function diagnosticsOn() {
    try {
      if (window.__replicaListDebug) return true;
      var host = (window.location && window.location.hostname) || '';
      var search = (window.location && window.location.search) || '';
      return (
        /webflow\.io$|^localhost$|^127\.0\.0\.1$|trycloudflare\.com$/.test(
          host,
        ) || search.indexOf('replica-list-debug') !== -1
      );
    } catch (e) {
      return false;
    }
  }

  function diag(level, message, detail) {
    try {
      if (!diagnosticsOn()) return;
      var fn = console[level] || console.log;
      if (detail === undefined) fn.call(console, '[replica-list] ' + message);
      else fn.call(console, '[replica-list] ' + message, detail);
    } catch (e) {
      /* never break the page */
    }
  }

  /* --- Visibility. offsetParent is null for position:fixed subtrees, which is
     precisely what a Webflow modal panel usually is, so it is never consulted.
     A probe failure counts as "not visible": the block simply stays pending,
     which can only delay a relayout, never cause a wrong one. --- */

  function isVisible(el) {
    try {
      if (typeof el.checkVisibility === 'function') return !!el.checkVisibility();
      return el.getClientRects().length > 0;
    } catch (e) {
      return false;
    }
  }

  function dispatchRelayout() {
    try {
      window.dispatchEvent(new CustomEvent(RELAYOUT_EVENT));
    } catch (e) {
      /* never break the page */
    }
  }

  /* --- The once-per-block gate. Both detection paths call this; a block not in
     `pending` has already fired and is ignored. --- */

  function settle(block, via) {
    var index = pending.indexOf(block);
    if (index === -1) return;
    pending.splice(index, 1);
    try {
      if (observer) observer.unobserve(block);
    } catch (e) {
      /* never break the page */
    }
    dispatchRelayout();
    diag('warn', 'static list became visible (' + via + ') — dispatched ' + RELAYOUT_EVENT, block);
    if (!pending.length) teardown();
  }

  function teardown() {
    try {
      if (observer) observer.disconnect();
    } catch (e) {
      /* never break the page */
    }
    observer = null;
    try {
      if (clickBound) {
        document.removeEventListener('click', onDocumentClick, true);
        clickBound = false;
      }
    } catch (e) {
      /* never break the page */
    }
  }

  function sweep(via) {
    // settle() mutates `pending`, so iterate a copy.
    pending.slice().forEach(function (block) {
      if (isVisible(block)) settle(block, via);
    });
  }

  function onIntersections(entries) {
    try {
      entries.forEach(function (entry) {
        if (entry && entry.isIntersecting) settle(entry.target, 'observer');
      });
    } catch (e) {
      /* never break the page */
    }
  }

  // Capture phase so a handler that stops propagation cannot hide the click from
  // us; the next task so the interaction's own display write has landed first.
  function onDocumentClick() {
    try {
      setTimeout(function () {
        sweep('click');
      }, 0);
    } catch (e) {
      /* never break the page */
    }
  }

  function start() {
    var blocks;
    try {
      blocks = document.querySelectorAll(SELECTOR);
    } catch (e) {
      return;
    }
    if (!blocks || !blocks.length) {
      diag('info', 'no static replica lists on this page — nothing bound.');
      return;
    }

    for (var i = 0; i < blocks.length; i++) {
      if (isVisible(blocks[i])) continue; // expert-card.js's own passes cover it
      pending.push(blocks[i]);
    }

    diag(
      'info',
      blocks.length +
        ' static replica list(s) found; ' +
        pending.length +
        ' hidden at init and now watched.',
    );
    if (!pending.length) return;

    try {
      observer = new IntersectionObserver(onIntersections, { threshold: 0 });
      pending.forEach(function (block) {
        try {
          observer.observe(block);
        } catch (e) {
          /* never break the page */
        }
      });
    } catch (e) {
      observer = null; // no IO in this environment — the click belt still works
    }

    try {
      document.addEventListener('click', onDocumentClick, true);
      clickBound = true;
    } catch (e) {
      /* never break the page */
    }
  }

  // Normally deferred (DOM already parsed); the guard only covers a head embed.
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  } catch (e) {
    /* never break the page */
  }
})();
