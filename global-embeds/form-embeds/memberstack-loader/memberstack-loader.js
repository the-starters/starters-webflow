// Memberstack loader: dresses a Memberstack auth form's Button as busy and
// disabled while Memberstack shows its own spinner, and on hide restores it and
// hands it back to password-validation, whose verdict may have moved meanwhile.
// Hand-back needs password-validation v1.59.504 or newer; v1.59.510 or newer
// hands one form back through regate() and so avoids repeating that script's
// page-level staging warnings on every release.
//
// @release v1.59.510
//
// Memberstack (DOM 1.2.0) fires no event for submit start or end. The only
// signal it gives is inline display on the page's [data-ms-loader], so the
// button's Pending look is driven off a MutationObserver on the Spinner
// ([data-button-spinner]) inside the form's Button Wrap (.button_main-wrap).
//
// Memberstack pins the loader it cached at init, so on a page that authors one
// the attribute cannot be moved. Both paths ship: a page with an authored
// [data-ms-loader] keeps it in place and this script mirrors that element's
// show/hide onto the submitting form's Spinner; a page with none gets the
// attribute moved onto the submitting form's Spinner at submit time.
//
// While Pending the wrap carries data-button-theme="disabled" (the grey look),
// aria-busy="true" (site CSS may style it) and
// data-ms-loading="true"; the clickable control carries aria-disabled="true".
// The theme is always overwritten while Pending; an authored one is parked on
// the wrap (data-memberstack-loader-theme) so hide can put it back, and a wrap
// that had none ends up with no theme attribute at all.
//
// Pending — the busy look and the double-submit guard — applies to auth forms
// only (data-ms-form login / signup / forgot-password / reset-password). Loader
// routing and the one-request-at-a-time refusal below cover every Memberstack
// form, profile and account forms included. Every attribute this script may
// have to undo, other than the theme it always overwrites, is written alongside
// an ownership mark (data-memberstack-loader-busy, -aria), and only marked
// attributes are ever removed, so a peer's hold (for example
// password-validation.js's own aria-disabled) survives untouched. Never author
// data-memberstack-loader-theme, -busy or -aria in Webflow.
//
// A Memberstack hide carries no identity — it lands on whatever holds
// [data-ms-loader] at that moment — so only one Memberstack request may be open
// per page. The refusal is keyed to the one request this script witnessed: while
// the element it lit or routed is still lit, every submit is refused, its own
// form's included (staging says so). A marker something else lit blocks nothing,
// and a back-button restore clears the whole thing. A Spinner-less form's
// overlay is not tracked, so it cannot take part in that rule until those forms
// get a Button.
//
// A success redirect navigates without hiding the loader, so Pending is meant
// to outlive the page: there is no timeout and no fail-open timer.
//
// While Pending, a capture-phase submit listener swallows every further submit
// on the form, and a second MutationObserver puts the Pending attributes back
// whenever a peer script strips or overwrites one. What the script re-asserts
// it also owns, so hide still ends where the peer left the button.
//
// Forms added after load (modals, step flows): call
// window.startersMemberstackLoader.rescan().
//
// On staging (webflow.io, localhost, the dev tunnel, or window.STARTERS_DEBUG
// === true) the script warns once per auth form that has no Button Spinner —
// naming the form, the cause and what lights instead — once per page about a
// duplicated or stray [data-ms-loader], and once per refused submit.
// Production is silent.

(function () {
  if (window.__startersMemberstackLoaderInit) return;
  window.__startersMemberstackLoaderInit = true;

  var RELEASE = 'v1.59.510';
  var WIRED_FLAG = '__startersMemberstackLoader';
  var OBSERVED_FLAG = '__startersMemberstackLoaderObserved';

  var MS_FORM_SELECTOR = 'form[data-ms-form]';
  var KIND_ATTR = 'data-ms-form';
  var SUBMIT_MARKER = '[ms-code-submit-button]';
  var WRAP_SELECTOR = '.button_main-wrap';
  var NATIVE_SUBMIT_SELECTOR = 'button,input[type="submit"]';
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

  var LOADER_ATTR = 'data-ms-loader';
  var LOADER_SELECTOR = '[data-ms-loader]';

  var AUTH_KINDS = ['login', 'signup', 'forgot-password', 'reset-password'];

  var REASSERT_ATTRS = [THEME_ATTR, BUSY_ATTR, LOADING_ATTR, ARIA_ATTR];

  // The Anchor is whatever Memberstack cached. Resolved once: a rescan must not
  // flip the page between mirroring and moving.
  var anchor = null;
  var anchorResolved = false;
  var anchorObserved = false;
  // The one request this script witnessed: the record that opened it and the
  // [data-ms-loader] it lit or routed. Nothing else is ours to police.
  var owner = null;
  var ownerEl = null;
  var mirrored = null;

  function clearOwner() {
    owner = null;
    ownerEl = null;
  }

  // --- resolving the form's Button -----------------------------------------

  // A <button> with no type attribute submits: that is the browser default.
  function holdsNativeSubmit(wrap) {
    var els = wrap.querySelectorAll(NATIVE_SUBMIT_SELECTOR);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.matches('button')) return true;
      if ((el.getAttribute('type') || 'submit').toLowerCase() === 'submit') return true;
    }
    return false;
  }

  function candidateWraps(form) {
    var marked = form.querySelectorAll(SUBMIT_MARKER);
    if (marked.length) return marked;
    var wraps = form.querySelectorAll(WRAP_SELECTOR);
    var out = [];
    for (var i = 0; i < wraps.length; i++) {
      if (holdsNativeSubmit(wraps[i])) out.push(wraps[i]);
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
  // `why` is the diagnostic cause when nothing resolves, null when it does.
  function resolveButton(form) {
    var wraps = candidateWraps(form);
    var why = wraps.length
      ? 'its Button Wrap has no ' + SPINNER_SELECTOR
      : 'no Button Wrap holding a submit control';
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      var spinner = wrap.querySelector(SPINNER_SELECTOR);
      if (!spinner) continue;
      var control = findControl(wrap);
      if (!control) {
        why = 'its Button Wrap has no control';
        continue;
      }
      return { wrap: wrap, control: control, spinner: spinner, why: null };
    }
    return { wrap: null, control: null, spinner: null, why: why };
  }

  // --- Pending --------------------------------------------------------------

  function enterPending(record) {
    var wrap = record.wrap;
    // The mark's presence is the record that a theme was authored; an authored
    // data-button-theme="" is a value, not an absence.
    if (wrap.hasAttribute(THEME_ATTR)) wrap.setAttribute(THEME_MARK, wrap.getAttribute(THEME_ATTR));
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
    if (wrap.hasAttribute(THEME_MARK)) wrap.setAttribute(THEME_ATTR, wrap.getAttribute(THEME_MARK));
    else wrap.removeAttribute(THEME_ATTR);
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
    if (owner === record) clearOwner();

    // password-validation re-adjudicates the gate on hand-back. regate is
    // v1.59.510+ and declines a form it never bridged; rescan is the page-wide
    // fallback.
    var pv = window.startersPasswordValidation;
    if (!pv) return;
    var regated = typeof pv.regate === 'function' && pv.regate(record.form);
    if (!regated && typeof pv.rescan === 'function') pv.rescan();
  }

  // Edge-triggered off the Spinner's live inline display, never off the batch
  // of mutation records.
  function sync(record) {
    var display = record.spinner.style.display;
    var shown = display !== '' && display !== 'none';
    // The pinned Anchor lights up for every form on the page; Pending belongs
    // to the one that submitted.
    if (shown && record.spinner === anchor && owner && owner !== record) return;
    if (!shown && ownerEl === record.spinner) clearOwner();
    // Pending is the auth forms' busy look; every form still routes and refuses.
    if (!record.isAuth) return;
    if (shown && !record.pending) enterPending(record);
    else if (!shown && record.pending) leavePending(record);
  }

  // Writes only where the value differs: an unconditional write would be seen
  // by this same observer and loop.
  function reassert(record) {
    var wrap = record.wrap;
    var control = record.control;

    if (wrap.getAttribute(THEME_ATTR) !== DISABLED_THEME) {
      wrap.setAttribute(THEME_ATTR, DISABLED_THEME);
    }
    // Claiming on the way back: the peer took whatever was there, so hide has
    // to end with the attribute absent.
    if (wrap.getAttribute(BUSY_ATTR) !== 'true') {
      wrap.setAttribute(BUSY_ATTR, 'true');
      if (!wrap.hasAttribute(BUSY_MARK)) wrap.setAttribute(BUSY_MARK, '');
    }
    if (wrap.getAttribute(LOADING_ATTR) !== 'true') wrap.setAttribute(LOADING_ATTR, 'true');
    if (control.getAttribute(ARIA_ATTR) !== 'true') {
      control.setAttribute(ARIA_ATTR, 'true');
      if (!control.hasAttribute(ARIA_MARK)) control.setAttribute(ARIA_MARK, '');
    }
  }

  function observeReassert(record) {
    if (!record.isAuth || !record.spinner || !record.wrap || !record.control) return;
    if (typeof MutationObserver === 'undefined') return;
    if (record.reassertObserved) return;
    record.reassertObserved = true;
    var observer = new MutationObserver(function () {
      if (!record.pending) return;
      reassert(record);
    });
    var options = { attributes: true, attributeFilter: REASSERT_ATTRS };
    observer.observe(record.wrap, options);
    observer.observe(record.control, options);
  }

  function observeSpinner(record) {
    if (!record.spinner) return;
    if (typeof MutationObserver === 'undefined') return;
    if (record.spinner[OBSERVED_FLAG]) return;
    record.spinner[OBSERVED_FLAG] = true;
    var observer = new MutationObserver(function () {
      sync(record);
    });
    observer.observe(record.spinner, { attributes: true, attributeFilter: ['style'] });
  }

  // --- loader routing -------------------------------------------------------

  // MOVE mode only. A form with no Spinner clears the page instead, so
  // Memberstack falls back to its own overlay for that submit.
  function route(record) {
    var marked = document.querySelectorAll(LOADER_SELECTOR);
    for (var i = 0; i < marked.length; i++) {
      if (marked[i] === record.spinner) continue;
      marked[i].removeAttribute(LOADER_ATTR);
    }
    if (record.spinner && !record.spinner.hasAttribute(LOADER_ATTR)) {
      record.spinner.setAttribute(LOADER_ATTR, '');
    }
  }

  // A Memberstack hide carries no identity: it lands on whatever holds the
  // marker then, so only one request may be open per page. Only the element
  // this script lit or routed counts; a marker a peer lit is not ours.
  // Never throws: a broken read must not cost the page its submit.
  function loaderBusy() {
    try {
      if (!ownerEl) return false;
      var display = ownerEl.style && ownerEl.style.display;
      return !!display && display !== 'none';
    } catch (e) {
      return false;
    }
    return false;
  }

  // Reads the Anchor's live display, never the mutation batch. Writes only
  // where the value differs, and keeps at most one mirrored Spinner lit.
  function mirror() {
    var display = anchor.style.display;
    var shown = display !== '' && display !== 'none';
    var target = shown && owner ? owner.spinner : null;
    if (target === anchor) target = null;

    if (mirrored && mirrored !== target && mirrored.style.display !== 'none') {
      mirrored.style.display = 'none';
    }
    if (target) {
      if (target.style.display !== display) target.style.display = display;
      mirrored = target;
    } else {
      mirrored = null;
    }
    // A hide ends the submit, so a later show nobody asked for lights nothing.
    if (!shown) clearOwner();
  }

  // Installed from the capture-phase submit, which runs before Memberstack
  // writes display, so the first show is already watched.
  function observeAnchor() {
    if (anchorObserved) return;
    if (typeof MutationObserver === 'undefined') return;
    anchorObserved = true;
    var observer = new MutationObserver(function () {
      mirror();
    });
    observer.observe(anchor, { attributes: true, attributeFilter: ['style'] });
  }

  // --- submit ---------------------------------------------------------------

  function onSubmit(record, event) {
    if (record.pending) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (loaderBusy()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      devWarn('submit refused on ' + describe(record.form) +
        ': a Memberstack request is still open');
      return;
    }
    owner = record;
    if (anchor) {
      // Watched on every submit, or a request that ends on the Anchor alone
      // would leave ownership behind.
      observeAnchor();
      ownerEl = anchor;
    } else {
      route(record);
      // A Spinner-less form in MOVE mode owns nothing: Memberstack falls back
      // to its own untracked overlay.
      ownerEl = record.spinner || null;
    }
  }

  // Capture phase, so a repeat submit dies before Memberstack or any peer
  // listener sees it. Bound on every Memberstack form, inert off Pending.
  function wireSubmit(record) {
    if (record.submitWired) return;
    record.submitWired = true;
    record.form.addEventListener('submit', function (event) {
      onSubmit(record, event);
    }, true);
  }

  // --- staging diagnostics --------------------------------------------------
  // Anchored on a dot or the start of the string, so a lookalike domain such
  // as notwebflow.io or evil-trycloudflare.com cannot read as staging.
  var STAGING_HOSTS = [/(\.|^)webflow\.io$/, /(\.|^)trycloudflare\.com$/];

  var warnedManyLoaders = false;
  var warnedStrayLoader = false;

  function isDevHost() {
    try {
      // Tested outside the host check: it may turn logging on in production,
      // but it must never widen what counts as a staging host.
      if (window.STARTERS_DEBUG === true) return true;
      var h = (location && location.hostname) || '';
      if (h === 'localhost' || h === '127.0.0.1') return true;
      for (var i = 0; i < STAGING_HOSTS.length; i++) {
        if (STAGING_HOSTS[i].test(h)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function devWarn() {
    if (!isDevHost()) return;
    try {
      console.warn.apply(console, ['[memberstack-loader]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* no-op */
    }
  }

  function describe(el) {
    var out = el.tagName ? String(el.tagName).toLowerCase() : 'element';
    var id = el.getAttribute('id');
    if (id) out += '#' + id;
    var cls = el.getAttribute('class');
    var first = cls ? cls.trim().split(/\s+/)[0] : '';
    if (first) out += '.' + first;
    return out;
  }

  // Each condition speaks at most once per page, so a rescan never repeats it.
  // Never throws: a broken diagnostic must not cost the page its wiring.
  function diagnose() {
    if (!isDevHost()) return;
    try {
      var forms = document.querySelectorAll(MS_FORM_SELECTOR);
      var marked = document.querySelectorAll(LOADER_SELECTOR);

      // A marker-less auth form is served fine by MOVE mode; only one with no
      // Button Spinner at all really falls back. Latched per form, so a Spinner
      // arriving on a later rescan just stops the form qualifying.
      var fallback = anchor
        ? 'the pinned ' + LOADER_SELECTOR + ' lights instead'
        : 'Memberstack shows its overlay instead';
      for (var i = 0; i < forms.length; i++) {
        var record = forms[i][WIRED_FLAG];
        if (!record || !record.isAuth || record.spinner) continue;
        if (record.warnedNoSpinner) continue;
        record.warnedNoSpinner = true;
        devWarn('auth form ' + describe(record.form) + ' has no Button Spinner (' +
          record.noSpinnerWhy + '); ' + fallback);
      }

      if (!warnedManyLoaders && marked.length > 1) {
        warnedManyLoaders = true;
        devWarn(marked.length + ' ' + LOADER_SELECTOR + ' elements at load; ' +
          'Memberstack pins the first and ignores the rest');
      }

      if (!warnedStrayLoader) {
        for (var j = 0; j < marked.length; j++) {
          if (marked[j].closest(MS_FORM_SELECTOR)) continue;
          warnedStrayLoader = true;
          devWarn(LOADER_SELECTOR + ' outside any Memberstack form: ' + describe(marked[j]));
          break;
        }
      }
    } catch (e) {
      /* no-op */
    }
  }

  // --- discovery ------------------------------------------------------------

  function init() {
    if (!anchorResolved) {
      anchorResolved = true;
      anchor = document.querySelector(LOADER_SELECTOR);
    }

    var forms = document.querySelectorAll(MS_FORM_SELECTOR);

    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var record = form[WIRED_FLAG];

      // A wired form is revisited only to pick up a Button that arrived late.
      if (record) {
        if (!record.spinner) {
          var late = resolveButton(form);
          record.noSpinnerWhy = late.why;
          if (late.spinner) {
            record.wrap = late.wrap;
            record.control = late.control;
            record.spinner = late.spinner;
            observeSpinner(record);
            observeReassert(record);
          }
        }
        wireSubmit(record);
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
        noSpinnerWhy: parts.why,
        warnedNoSpinner: false,
        pending: false,
        submitWired: false,
        reassertObserved: false
      };
      form[WIRED_FLAG] = record;
      observeSpinner(record);
      observeReassert(record);
      wireSubmit(record);
    }

    diagnose();
  }

  // A restored page keeps the loader Memberstack lit and will never hide it.
  function onPageshow(event) {
    if (!event || !event.persisted) return;
    try {
      var lit = ownerEl && ownerEl.style && ownerEl.style.display;
      if (lit && lit !== 'none') ownerEl.style.display = 'none';
      var wasMirrored = mirrored && mirrored.style && mirrored.style.display;
      if (wasMirrored && wasMirrored !== 'none') mirrored.style.display = 'none';
      clearOwner();
      mirrored = null;
      var forms = document.querySelectorAll(MS_FORM_SELECTOR);
      for (var i = 0; i < forms.length; i++) {
        var record = forms[i][WIRED_FLAG];
        if (record && record.pending) leavePending(record);
      }
    } catch (e) {
      /* no-op */
    }
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pageshow', onPageshow);
  }

  window.startersMemberstackLoader = { rescan: init, release: RELEASE };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
