// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/expert-card

  (function () {
    'use strict';

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

    function equalizeExpertCardCompanyLists() {
      var lists = document.querySelectorAll('.expert-card_company-list');
      if (!lists.length) return;

      var runId = ++companyEqualizeRunId;

      lists.forEach(function (el) {
        el.style.minHeight = '';
        el.style.maxHeight = '';
      });

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (runId !== companyEqualizeRunId) return;

          var maxH = 0;
          lists.forEach(function (el) {
            maxH = Math.max(maxH, el.scrollHeight);
          });

          if (maxH <= 0) return;

          var px = Math.ceil(maxH) + 'px';
          lists.forEach(function (el) {
            el.style.minHeight = px;
            el.style.maxHeight = px;
          });
        });
      });
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