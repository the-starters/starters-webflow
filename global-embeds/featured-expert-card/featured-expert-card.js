// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/featured-expert-card

  (function () {
    'use strict';

    var mq = window.matchMedia('(max-width: 767px)');
    var attr = 'data-details-open';

    function clearMobileDetailsOpen() {
      if (mq.matches) return;
      document.querySelectorAll('.featured-experts_item').forEach(function (el) {
        el.removeAttribute(attr);
      });
    }

    function onDocumentClick(e) {
      if (!mq.matches) return;
      var item = e.target.closest('.featured-experts_item');
      if (!item) return;
      if (
        e.target.closest(
          'a, button, input, select, textarea, [role="button"]'
        )
      ) {
        return;
      }
      item.toggleAttribute(attr);
    }

    mq.addEventListener('change', clearMobileDetailsOpen);
    clearMobileDetailsOpen();
    document.addEventListener('click', onDocumentClick);
  })();