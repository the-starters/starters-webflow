// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/modal/reset-on-close

(function () {
  'use strict';

  var ATTR = 'data-modal-reload-on-submit';

  if (window.__modalReloadOnSubmitInited) return;
  window.__modalReloadOnSubmitInited = true;

  var isOptedIn = function (modal) {
    if (!modal.hasAttribute(ATTR)) return false;
    var value = (modal.getAttribute(ATTR) || '').trim().toLowerCase();
    return value !== 'off' && value !== 'false';
  };

  /**
   * Did Webflow complete a successful submit on this form?
   * On success Webflow hides the <form> (display:none) and shows .w-form-done.
   * Requiring BOTH avoids false positives if .w-form-done is styled visible by
   * default in the Designer.
   * @param {HTMLElement} wForm - the .w-form wrapper
   * @returns {boolean}
   */
  var didSubmitSucceed = function (wForm) {
    var form = wForm.querySelector('form');
    var done = wForm.querySelector('.w-form-done');
    var formHidden = !form || getComputedStyle(form).display === 'none';
    var doneVisible = !!done && getComputedStyle(done).display !== 'none';
    return formHidden && doneVisible;
  };

  window.addEventListener('modal-close', function (e) {
    var modal = e.detail && e.detail.modal;
    if (!modal || !isOptedIn(modal)) return;

    var wForm = modal.querySelector('.w-form');
    if (wForm && didSubmitSucceed(wForm)) window.location.reload();
  });
})();