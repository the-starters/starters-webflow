// Memberstack loader — dresses a Memberstack auth form's Button as busy and
// disabled while Memberstack shows its own spinner, and restores it on hide.
//
// @release v1.59.507
//
// Memberstack (DOM 1.2.0) fires no event for submit start or end. The only
// signal it gives is inline display on the page's [data-ms-loader], so the
// button's Pending look is driven off a MutationObserver on the Spinner
// ([data-button-spinner]) inside the form's Button Wrap (.button_main-wrap).
//
// While Pending the wrap carries data-button-theme="disabled" (the grey look),
// aria-busy="true" (existing CSS turns that into cursor: wait) and
// data-ms-loading="true"; the clickable control carries aria-disabled="true".
// The authored theme is parked on the wrap so hide can put it back.
//
// Only auth forms (data-ms-form login / signup / forgot-password /
// reset-password) are touched. Every attribute this script may have to undo is
// written alongside an ownership mark — data-memberstack-loader-theme, -busy,
// -aria — and only marked attributes are ever removed, so a peer's hold (for
// example password-validation.js's own aria-disabled) survives untouched.
// Never author those marks in Webflow.
//
// A success redirect navigates without hiding the loader, so Pending is meant
// to outlive the page: there is no timeout and no fail-open timer.
//
// Forms added after load (modals, step flows): call
// window.startersMemberstackLoader.rescan().

(function () {
  if (window.__startersMemberstackLoaderInit) return;
  window.__startersMemberstackLoaderInit = true;

  var RELEASE = 'v1.59.507';
  var WIRED_FLAG = '__startersMemberstackLoader';
  var OBSERVED_FLAG = '__startersMemberstackLoaderObserved';

  var MS_FORM_SELECTOR = 'form[data-ms-form]';
  var KIND_ATTR = 'data-ms-form';
  var SUBMIT_MARKER = '[ms-code-submit-button]';
  var WRAP_SELECTOR = '.button_main-wrap';
  var NATIVE_SUBMIT_SELECTOR = 'button[type="submit"],input[type="submit"]';
  var SPINNER_SELECTOR = '[data-button-spinner]';
  // Ordered: Memberstack's overlay wins over the native control it hides.
  var CONTROL_SELECTORS = ['.clickable_btn', 'button', 'input[type="submit"]'];

  var THEME_ATTR = 'data-button-theme';
  var DISABLED_THEME = 'disabled';
  var BUSY_ATTR = 'aria-busy';
  var LOADING_ATTR = 'data-ms-loading';
  var ARIA_ATTR = 'aria-disabled';
  var THEME_MARK = 'data-memberstack-loader-theme';
  var BUSY_MARK = 'data-memberstack-loader-busy';
  var ARIA_MARK = 'data-memberstack-loader-aria';

  var AUTH_KINDS = ['login', 'signup', 'forgot-password', 'reset-password'];

  // --- resolving the form's Button -----------------------------------------

  function candidateWraps(form) {
    var marked = form.querySelectorAll(SUBMIT_MARKER);
    if (marked.length) return marked;
    var wraps = form.querySelectorAll(WRAP_SELECTOR);
    var out = [];
    for (var i = 0; i < wraps.length; i++) {
      if (wraps[i].querySelector(NATIVE_SUBMIT_SELECTOR)) out.push(wraps[i]);
    }
    return out;
  }

  function findControl(wrap) {
    for (var i = 0; i < CONTROL_SELECTORS.length; i++) {
      var control = wrap.querySelector(CONTROL_SELECTORS[i]);
      if (control) return control;
    }
    return null;
  }

  // A sibling wrap holding only a.clickable_link resolves no control and is
  // therefore never the Button; the reset shape resolves no Spinner.
  function resolveButton(form) {
    var wraps = candidateWraps(form);
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      var spinner = wrap.querySelector(SPINNER_SELECTOR);
      if (!spinner) continue;
      var control = findControl(wrap);
      if (!control) continue;
      return { wrap: wrap, control: control, spinner: spinner };
    }
    return { wrap: null, control: null, spinner: null };
  }

  // --- Pending --------------------------------------------------------------

  function enterPending(record) {
    var wrap = record.wrap;
    var theme = wrap.getAttribute(THEME_ATTR);
    wrap.setAttribute(THEME_MARK, theme === null ? '' : theme);
    wrap.setAttribute(THEME_ATTR, DISABLED_THEME);

    if (wrap.getAttribute(BUSY_ATTR) !== 'true') {
      wrap.setAttribute(BUSY_ATTR, 'true');
      wrap.setAttribute(BUSY_MARK, '');
    }
    wrap.setAttribute(LOADING_ATTR, 'true');

    // An aria-disabled already set is a peer's hold: claim nothing.
    if (record.control.getAttribute(ARIA_ATTR) !== 'true') {
      record.control.setAttribute(ARIA_ATTR, 'true');
      record.control.setAttribute(ARIA_MARK, '');
    }

    record.pending = true;
  }

  function leavePending(record) {
    var wrap = record.wrap;
    var authored = wrap.getAttribute(THEME_MARK);
    if (authored === null || authored === '') wrap.removeAttribute(THEME_ATTR);
    else wrap.setAttribute(THEME_ATTR, authored);
    wrap.removeAttribute(THEME_MARK);

    if (wrap.hasAttribute(BUSY_MARK)) {
      wrap.removeAttribute(BUSY_ATTR);
      wrap.removeAttribute(BUSY_MARK);
    }
    wrap.removeAttribute(LOADING_ATTR);

    if (record.control.hasAttribute(ARIA_MARK)) {
      record.control.removeAttribute(ARIA_ATTR);
      record.control.removeAttribute(ARIA_MARK);
    }

    record.pending = false;
  }

  // Edge-triggered off the Spinner's live inline display, never off the batch
  // of mutation records.
  function sync(record) {
    var display = record.spinner.style.display;
    var shown = display !== '' && display !== 'none';
    if (shown && !record.pending) enterPending(record);
    else if (!shown && record.pending) leavePending(record);
  }

  function observeSpinner(record) {
    if (!record.isAuth || !record.spinner) return;
    if (typeof MutationObserver === 'undefined') return;
    if (record.spinner[OBSERVED_FLAG]) return;
    record.spinner[OBSERVED_FLAG] = true;
    var observer = new MutationObserver(function () {
      sync(record);
    });
    observer.observe(record.spinner, { attributes: true, attributeFilter: ['style'] });
  }

  // --- discovery ------------------------------------------------------------

  function init() {
    var forms = document.querySelectorAll(MS_FORM_SELECTOR);

    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var record = form[WIRED_FLAG];

      // A wired form is revisited only to pick up a Button that arrived late.
      if (record) {
        if (!record.spinner) {
          var late = resolveButton(form);
          if (late.spinner) {
            record.wrap = late.wrap;
            record.control = late.control;
            record.spinner = late.spinner;
            observeSpinner(record);
          }
        }
        continue;
      }

      var kind = form.getAttribute(KIND_ATTR) || '';
      var parts = resolveButton(form);
      record = {
        form: form,
        kind: kind,
        isAuth: AUTH_KINDS.indexOf(kind) !== -1,
        wrap: parts.wrap,
        control: parts.control,
        spinner: parts.spinner,
        pending: false
      };
      form[WIRED_FLAG] = record;
      observeSpinner(record);
    }
  }

  window.startersMemberstackLoader = { rescan: init, release: RELEASE };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
