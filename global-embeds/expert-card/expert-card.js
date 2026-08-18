// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/expert-card

  (function () {
    'use strict';

    // The page embeds this file twice; without a guard every listener below
    // binds twice (doubling layout passes). Bind once per page.
    if (window.__expertCardLayoutInit) return;
    window.__expertCardLayoutInit = true;

    var touchUiMql = window.matchMedia('(hover: none)');
    var jobsOpenClass = 'expert-card_item--jobs-open';
    var companyEqualizeRunId = 0;
    var layoutResizeWidth = window.innerWidth;
    var layoutResizeTimer;

    function updateExpertCardJobsOpenHeights() {
      var jobsWrappers = document.querySelectorAll('.expert-card_jobs-wrapper');
      jobsWrappers.forEach(function (wrapper) {
        var card = wrapper.closest('.expert-card_item');
        if (!card) return;

        wrapper.style.maxHeight = 'none';
        var h = wrapper.scrollHeight;
        wrapper.style.maxHeight = '';

        if (h <= 0) return;
        card.style.setProperty(
          '--expert-card-jobs-open-height',
          Math.ceil(h) + 'px'
        );
      });
    }

    // Companion embeds (e.g. expert-card-browse-loader.js) wait on this to know
    // a layout pass has fully settled before revealing content. Never throws.
    function dispatchRelayoutDone() {
      try {
        window.dispatchEvent(new CustomEvent('expert-cards:relayout:done'));
      } catch (e) {
        /* never break the page */
      }
    }

    // Run fn after two rAFs OR a timeout, whichever fires first, exactly once.
    // Hidden/occluded tabs suspend rAF entirely, so the timeout guarantees the
    // layout pass still completes there (scrollHeight forces sync layout on
    // demand, so measurements are valid on the timeout path too).
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

    function equalizeExpertCardCompanyLists() {
      var lists = document.querySelectorAll('.expert-card_company-list');
      if (!lists.length) {
        dispatchRelayoutDone();
        return;
      }

      var runId = ++companyEqualizeRunId;

      afterFramesOrTimeout(function () {
        if (runId !== companyEqualizeRunId) return;

        // Atomicity: clear + measure + apply MUST share one synchronous task so
        // paint never observes the cleared (collapsed) heights. If the clear ran
        // in an earlier task, the browser would paint 1-2 frames of collapsed
        // lists — the visible "tweak for no reason" on visible relayouts (resize).
        //
        // maxHeight is cleared but never written: this pass no longer sets one,
        // and clearing it removes any left by another script on the page.
        lists.forEach(function (el) {
          el.style.minHeight = '';
          el.style.maxHeight = '';
        });

        // Every list is capped against ITS OWN line height. Sampling lists[0]
        // let one list decide for the page: if the first list was hidden or
        // computed `line-height: normal`, no list got capped and the measured
        // overflow was written back as a height, undoing the 2-line clamp in
        // expert-card.css.
        //
        // A list whose line height cannot be read is left out entirely rather
        // than contributing an uncapped scrollHeight. Its inline heights stay
        // cleared, so `-webkit-line-clamp: 2` in the stylesheet keeps the clamp.
        var capped = [];
        var maxH = 0;
        lists.forEach(function (el) {
          var lh = parseFloat(window.getComputedStyle(el).lineHeight);
          if (!(lh > 0)) return;
          capped.push(el);
          maxH = Math.max(maxH, Math.min(el.scrollHeight, lh * 2));
        });

        if (!capped.length || maxH <= 0) {
          dispatchRelayoutDone();
          return;
        }

        // min-height ONLY. Row alignment needs a floor, and that is all this
        // pass is for; the ceiling belongs to `-webkit-line-clamp: 2` in
        // expert-card.css. An inline max-height in px is what ate the ellipsis:
        // it clips the box at the same two lines but paints no `…`, so a
        // clamped list looked complete. Never write maxHeight here.
        var px = Math.ceil(maxH) + 'px';
        capped.forEach(function (el) {
          el.style.minHeight = px;
        });

        dispatchRelayoutDone();
      }, 80);
    }

    function runExpertCardLayout() {
      updateExpertCardJobsOpenHeights();
      equalizeExpertCardCompanyLists();
    }

    function scheduleExpertCardLayout() {
      clearTimeout(layoutResizeTimer);
      layoutResizeTimer = setTimeout(runExpertCardLayout, 1000);
    }

    function clearTouchJobsOpenState() {
      document.querySelectorAll('.' + jobsOpenClass).forEach(function (el) {
        el.classList.remove(jobsOpenClass);
        el.removeAttribute('aria-expanded');
      });
    }

    function onDocumentClick(e) {
      if (!touchUiMql.matches) return;
      var card = e.target.closest('.expert-card_item');
      if (!card) return;
      if (
        e.target.closest(
          'a, button, input, select, textarea, [role="button"]'
        )
      ) {
        return;
      }
      card.classList.toggle(jobsOpenClass);
      if (card.classList.contains(jobsOpenClass)) {
        card.setAttribute('aria-expanded', 'true');
      } else {
        card.removeAttribute('aria-expanded');
      }
    }

    document.addEventListener('click', onDocumentClick);
    touchUiMql.addEventListener('change', function () {
      if (!touchUiMql.matches) {
        clearTouchJobsOpenState();
      }
    });

    window.addEventListener('load', runExpertCardLayout);

    // NEW: let other embeds request a recalc after they mutate card content
    window.addEventListener('expert-cards:relayout', runExpertCardLayout);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(runExpertCardLayout);
    }

    window.addEventListener('resize', function () {
      if (window.innerWidth === layoutResizeWidth) return;
      layoutResizeWidth = window.innerWidth;
      scheduleExpertCardLayout();
    });
  })();