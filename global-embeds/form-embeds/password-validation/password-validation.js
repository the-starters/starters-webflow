// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/password-validation
//
// @release v1.59.502
//
// Password validation — configured entirely from wrapper attributes so a
// Webflow component instance can pick its own rule set with no code changes.
//
// On the component wrapper (any element carrying at least one of these):
//   starters-password-validation-characters="true"
//   starters-password-validation-character-count="8"
//   starters-password-validation-special="true"
//   starters-password-validation-capitalization="true"
//   starters-password-validation-numbers="true"
// Only the literal string "true" enables a rule. Wrappers pair with their
// nearest <form> ancestor; the password input (data-ms-member="password") and
// the submit button (ms-code-submit-button) are Memberstack's own hooks.
//
// One validated instance per form, however many wrappers it holds — Webflow's
// way to vary a component per breakpoint is two instances in one form, so all
// of them are rendered and flip together. The first wrapper that enables a
// rule sets the config; wrappers that enable nothing configure nothing. A form
// no wrapper configures fails open and says so on staging; it never gates.
//
// Forms added after load: call window.startersPasswordValidation.rescan().
//
// The CTA gate covers the WHOLE form, not just the password: the button stays
// grey until every active password rule passes, the terms checkbox
// (input[data-ms-member="terms-and-condition"]) is checked when the form has
// one, and the email (input[data-ms-member="email"]) looks like an email when
// the form has one. Turnstile is deliberately not in this gate — it resolves
// after the click, on Memberstack's side. Fields the form does not have gate
// nothing, so login and reset flows keep their password-only behavior.
//
// The live CTA is Memberstack's overlay: a `.clickable_btn` (type="button")
// inside the [ms-code-submit-button] wrap, with the native submit hidden. A
// type="button" overlay never fires the native submit path on its own, so an
// enabled click on a non-submitting control dispatches a cancelable synthetic
// submit event — what Memberstack's listener consumes — and never a native
// submission (see triggerSubmit for why requestSubmit is unsafe). That bridge
// is installed on EVERY form[data-ms-form] carrying [ms-code-submit-button],
// wrapper or not — it is the only submit path such a CTA has, so a fail-open
// form still submits; the click is gated only where a wrapper configures rules.
// Disabling covers the wrap AND every overlay control inside it (native
// `disabled` + aria-disabled), so the visible button can never stay live while
// only the hidden one is gated.
//
// Memberstack rejections after the click (duplicate email, 4xx/5xx, Turnstile,
// network) used to be console-only. A submit that passes the gate arms a
// watcher over window.fetch; a failing Memberstack/Turnstile request paints
// the form's own Webflow fail block (.w-form-fail) as a role="alert",
// preferring the server's message and falling back to a house line.
//
// On each checklist row inside the wrapper:
//   starters-password-validation-rule="characters|special|capitalization|numbers"
//   starters-password-validation-icon="valid" / "invalid"
// Author the invalid icon visible and the valid icon hidden. A wired form has
// both overwritten from the first paint, so the authoring only shows through
// on a fail-open instance — where it is what makes the checklist read as a
// plain unchecked list rather than a row of green ticks.

(function () {
  if (window.__startersPasswordValidationInit) return;
  window.__startersPasswordValidationInit = true;

  var PREFIX = 'starters-password-validation-';
  var COUNT_ATTR = PREFIX + 'character-count';
  var RULE_ATTR = PREFIX + 'rule';
  var ICON_ATTR = PREFIX + 'icon';
  var DEFAULT_COUNT = 8;
  var WIRED_FLAG = '__startersPasswordValidation';
  var BRIDGE_FLAG = '__startersPasswordBridge';
  var SUBMIT_BUTTON_SELECTOR = '[ms-code-submit-button]';
  var MS_FORM_SELECTOR = 'form[data-ms-form]';

  // Rule predicates. Adding a rule is one entry here plus one Webflow
  // attribute — the key IS the attribute suffix and the row's rule value.
  // Every predicate must return false for the empty string: the checklist
  // renders pass/fail from the first paint, so a rule that passes vacuously
  // on '' would show pre-checked on a blank form.
  var RULES = {
    'characters': function (value, count) {
      return value.length >= count;
    },
    'special': function (value) {
      return /[!@#$%^&*(),.?":{}|<>]/.test(value);
    },
    'capitalization': function (value) {
      return /[a-z]/.test(value) && /[A-Z]/.test(value);
    },
    'numbers': function (value) {
      return /[0-9]/.test(value);
    }
  };

  // Derived, never hand-maintained: the map above is the single place a rule
  // is declared, and its key order is the checklist order.
  var RULE_NAMES = Object.keys(RULES);

  // A wrapper is any element carrying at least one config attribute. The count
  // is included so a wrapper that sets only the count is still detected — and
  // therefore still reported as having no active rules, rather than being
  // invisible to the script.
  var WRAPPER_SELECTOR = RULE_NAMES.map(function (name) {
    return '[' + PREFIX + name + ']';
  }).concat('[' + COUNT_ATTR + ']').join(',');

  // --- dev-only diagnostics -------------------------------------------------
  // Silent in production. Emits only on staging/local hosts or when the site
  // owner opts in with window.STARTERS_DEBUG === true.
  // Anchored on a dot or the start of the string, so a lookalike domain such
  // as notwebflow.io or evil-trycloudflare.com cannot read as staging.
  var STAGING_HOSTS = [/(\.|^)webflow\.io$/, /(\.|^)trycloudflare\.com$/];

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
      console.warn.apply(console, ['[password-validation]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* no-op */
    }
  }

  function show(el) { if (el) el.style.display = 'flex'; }
  function hide(el) { if (el) el.style.display = 'none'; }

  // "At least {count} characters" -> "At least 8 characters". Walks text nodes
  // so the row's icons (and any nested text blocks) survive untouched, and
  // rewrites nothing at all when the token is absent.
  //
  // The authored text is cached on the node the first time it is seen, and
  // every pass re-renders from that cache rather than from what the previous
  // pass wrote. A wrapper that failed open renders its fallback count and
  // stays eligible for rescan(); once its attributes arrive, the rescan has to
  // be able to replace that number with the one now being enforced, which is
  // impossible once the token has been overwritten.
  var COUNT_TOKEN = '{count}';
  var TEMPLATE_PROP = '__startersPasswordValidationTemplate';

  function countTemplate(textNode) {
    var cached = textNode[TEMPLATE_PROP];
    if (typeof cached === 'string') return cached;
    var text = textNode.nodeValue;
    if (!text || text.indexOf(COUNT_TOKEN) === -1) return null;
    textNode[TEMPLATE_PROP] = text;
    return text;
  }

  // Visits every text node under `node`. A visitor returning true stops the
  // walk and is reported back, so "rewrite them all" and "does any of them"
  // stay one traversal with one definition of which nodes count.
  function walkText(node, visit) {
    if (!node || !node.childNodes) return false;
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 3) {
        if (visit(child) === true) return true;
      } else if (child.nodeType === 1 && walkText(child, visit)) {
        return true;
      }
    }
    return false;
  }

  function substituteCount(node, count) {
    walkText(node, function (textNode) {
      var template = countTemplate(textNode);
      if (template !== null) textNode.nodeValue = template.split(COUNT_TOKEN).join(count);
    });
  }

  // Asks the authored copy, not the rendered copy: a row that already had its
  // token substituted by an earlier pass is still a row that uses the token.
  function usesCountToken(node) {
    return walkText(node, function (textNode) {
      return countTemplate(textNode) !== null;
    });
  }

  // Webflow renders a boolean component property as the string "true"/"false".
  function isOn(el, name) {
    return el.getAttribute(PREFIX + name) === 'true';
  }

  // Absent, unparsable, or nonsensical (< 1) all fall back to the default.
  function readCount(el) {
    var n = parseInt(el.getAttribute(COUNT_ATTR), 10);
    return isNaN(n) || n < 1 ? DEFAULT_COUNT : n;
  }

  // Button treatment, mirroring form-validation.js's setButtonEnabled. A bare
  // `disabled` class is styled by nothing in this codebase, so what actually
  // greys a Webflow CTA is the data-button-theme swap; aria-disabled announces
  // it, and the class plus the native property stay for back-compat and to
  // keep the Enter key from firing the button.
  var THEME_ATTR = 'data-button-theme';
  var DISABLED_THEME = 'disabled';
  var DEFAULT_THEME = 'black';

  // null means "this button is not themed" — never invent a theme attribute.
  function readAuthoredTheme(button) {
    if (!button || !button.hasAttribute(THEME_ATTR)) return null;
    var theme = button.getAttribute(THEME_ATTR);
    // A CTA authored already-grey would otherwise cache "disabled" as its
    // original and never come back; fall back to the house default.
    return theme && theme !== DISABLED_THEME ? theme : DEFAULT_THEME;
  }

  // [ms-code-submit-button] can land on the wrap or on the control inside it,
  // and the theme can sit on either, so three roles are resolved separately:
  //   root       — the marked element; keeps the `disabled` class
  //   actionable — the thing a user actually activates
  //   themeEl    — the element carrying data-button-theme, if any
  var ACTIONABLE_SELF = 'button,input[type="submit"],input[type="button"],a';
  var ACTIONABLE_INNER = 'button,input[type="submit"],a,.clickable_btn,.clickable_link';
  var NATIVE_CONTROL = 'button,input';
  var OVERLAY_CONTROLS = '.clickable_btn,.clickable_link';

  function isNativeControl(el) {
    return !!(el && el.matches && el.matches(NATIVE_CONTROL));
  }

  function resolveButton(root, form) {
    if (!root) return null;

    var actionable = root.matches && root.matches(ACTIONABLE_SELF)
      ? root
      : root.querySelector(ACTIONABLE_INNER) || root;

    // Every activation control under the marked element gates together. The
    // live Button component publishes overlay controls (.clickable_btn /
    // .clickable_link) that can sit after other variants in the DOM, and the
    // first querySelector hit above is not guaranteed to be the one the user
    // clicks — disabling only it leaves a visible CTA live while the hidden
    // native submit is the only thing gated.
    var controls = [actionable];
    if (root.querySelectorAll) {
      var overlays = root.querySelectorAll(OVERLAY_CONTROLS);
      for (var o = 0; o < overlays.length; o++) {
        if (controls.indexOf(overlays[o]) === -1) controls.push(overlays[o]);
      }
    }

    // The theme lives on the element that carries it: the marked element, the
    // wrap around it, or the control inside it — searched in that order.
    var themeEl = null;
    if (root.hasAttribute(THEME_ATTR)) {
      themeEl = root;
    } else {
      for (var node = root.parentElement; node && node !== form; node = node.parentElement) {
        if (node.hasAttribute && node.hasAttribute(THEME_ATTR)) {
          themeEl = node;
          break;
        }
      }
      if (!themeEl) themeEl = root.querySelector('[' + THEME_ATTR + ']');
    }

    var native = false;
    for (var n = 0; n < controls.length; n++) {
      if (isNativeControl(controls[n])) native = true;
    }

    return {
      root: root,
      actionable: actionable,
      controls: controls,
      themeEl: themeEl,
      // Only a real control has a disabled property worth setting; writing one
      // onto a div or an anchor invents an attribute the browser ignores.
      native: native,
      theme: readAuthoredTheme(themeEl)
    };
  }

  function setDisabled(button, isDisabled) {
    if (!button) return;
    var themeEl = button.themeEl;
    var controls = button.controls;
    var i;
    var el;

    if (isDisabled) {
      button.root.classList.add('disabled');
      if (themeEl) {
        themeEl.setAttribute(THEME_ATTR, DISABLED_THEME);
        if (controls.indexOf(themeEl) === -1) themeEl.setAttribute('aria-disabled', 'true');
      }
      for (i = 0; i < controls.length; i++) {
        el = controls[i];
        el.setAttribute('aria-disabled', 'true');
        if (isNativeControl(el)) {
          el.disabled = true;
          el.setAttribute('disabled', 'disabled');
          el.setAttribute('tabindex', '-1');
        }
      }
    } else {
      button.root.classList.remove('disabled');
      if (themeEl) {
        if (button.theme !== null) themeEl.setAttribute(THEME_ATTR, button.theme);
        if (controls.indexOf(themeEl) === -1) themeEl.removeAttribute('aria-disabled');
      }
      for (i = 0; i < controls.length; i++) {
        el = controls[i];
        el.removeAttribute('aria-disabled');
        if (isNativeControl(el)) {
          el.disabled = false;
          el.removeAttribute('disabled');
          el.removeAttribute('tabindex');
        }
      }
    }
  }

  // --- whole-form gate ------------------------------------------------------
  // A form without one of these fields is not gated on it: login and reset
  // flows share this script and have no terms checkbox or email to check.

  // "@" with something before it and a domain with a dot — the plausibility
  // Memberstack itself would reject anyway, not RFC 5322.
  var EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function emailSatisfied(emailInput) {
    if (!emailInput) return true;
    return EMAIL_SHAPE.test(emailInput.value || '');
  }

  function termsSatisfied(termsInput) {
    if (!termsInput) return true;
    if (termsInput.checked) return true;
    // Webflow custom checkboxes mirror their state onto a sibling visual div;
    // trust either signal, the same way form-validation.js does.
    var wrap = termsInput.closest ? termsInput.closest('.w-checkbox') : null;
    var visual = wrap && wrap.querySelector ? wrap.querySelector('.w-checkbox-input') : null;
    return !!(visual && visual.classList && visual.classList.contains('w--redirected-checked'));
  }

  // --- overlay submit -------------------------------------------------------
  // An input[type=submit] or a button whose type is submit (or absent — the
  // browser default inside a form) already submits on click; triggering again
  // would double-submit.
  function isNativeSubmitter(el) {
    if (!el || !el.matches) return false;
    if (el.matches('input[type="submit"]')) return true;
    if (el.matches('button')) {
      return (el.getAttribute('type') || 'submit').toLowerCase() === 'submit';
    }
    return false;
  }

  function triggerSubmit(form) {
    // A cancelable synthetic submit reaches every listener, Memberstack's
    // included — and nothing else. Never form.requestSubmit(): its default
    // action is a REAL native submission, so if Memberstack's listener is
    // missing (blocked script, slow load, script error) a Webflow form —
    // method="get", no action — would navigate with the password in the
    // query string. With no listener to act on the synthetic event the click
    // stays inert, exactly the pre-overlay behavior.
    if (typeof Event === 'function' && typeof form.dispatchEvent === 'function') {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }

  // The control the user actually activated, resolved against the button's
  // known controls so a click on a nested icon lands on its overlay.
  function clickedControl(event, button) {
    var node = event && event.target;
    while (node) {
      if (button.controls.indexOf(node) !== -1) return node;
      if (node === button.root) break;
      node = node.parentElement;
    }
    return button.actionable;
  }

  // --- post-submit failure surface ------------------------------------------
  // Memberstack owns the request; this script only watches for the loss so it
  // lands on the form instead of the console. One submit in flight at a time
  // is the real-world shape — arming a new one drops the previous watcher.
  var FALLBACK_ERROR = "Couldn't create the account. Try again.";
  var OUTCOME_URL = /memberstack|turnstile|challenges\.cloudflare/i;
  var OUTCOME_TIMEOUT_MS = 20000;
  var pendingOutcome = null;

  function settlePendingOutcome() {
    if (!pendingOutcome) return;
    if (pendingOutcome.timer && typeof clearTimeout === 'function') clearTimeout(pendingOutcome.timer);
    pendingOutcome = null;
  }

  // Wraps window.fetch exactly once, and only reacts while a watcher is armed
  // AND the request is Memberstack's or Turnstile's; everything else passes
  // through untouched. The response is read from a clone so Memberstack's own
  // reader is not consumed.
  function installOutcomeWatcher() {
    if (window.__startersPasswordValidationFetch) return;
    if (typeof window.fetch !== 'function') return;
    window.__startersPasswordValidationFetch = true;
    var originalFetch = window.fetch;
    window.fetch = function (resource) {
      var url = '';
      try {
        // Covers strings, Request objects (.url), and URL objects
        // (String() -> href); a fetch this misses stays console-only.
        url = typeof resource === 'string'
          ? resource
          : String((resource && resource.url) || resource || '');
      } catch (e) { /* no-op */ }
      var entry = pendingOutcome;
      var result = originalFetch.apply(this, arguments);
      if (!entry || !OUTCOME_URL.test(url) || !result || typeof result.then !== 'function') {
        return result;
      }
      result.then(function (response) {
        if (!response || response.ok) {
          // A success does NOT disarm the watcher: a real signup attempt can
          // issue several matching requests (token, Turnstile, ancillary
          // calls), and the first OK must not swallow a later rejection —
          // the duplicate-email 4xx is the whole point. The watcher ends on
          // a failure, the next arming, or the timeout.
          return;
        }
        var fallback = function () { entry.fail(null); };
        try {
          response.clone().json().then(function (body) {
            entry.fail((body && (body.message || (body.error && body.error.message))) || null);
          }, fallback);
        } catch (e) {
          fallback();
        }
      }, function () {
        entry.fail(null);
      });
      return result;
    };
  }

  function armOutcome(surface) {
    installOutcomeWatcher();
    settlePendingOutcome();
    var entry = {
      settle: function () {
        if (pendingOutcome === entry) settlePendingOutcome();
      },
      fail: function (message) {
        if (pendingOutcome !== entry) return;
        settlePendingOutcome();
        surface.show(message);
      }
    };
    if (typeof setTimeout === 'function') entry.timer = setTimeout(entry.settle, OUTCOME_TIMEOUT_MS);
    pendingOutcome = entry;
    // A fresh attempt clears the previous rejection's message.
    surface.hide();
  }

  // The form's own Webflow fail block is the surface: it is Designer-styled,
  // in the right place, and empty forms already ship one. Nothing is created
  // when it is missing — that absence is a wiring mistake worth naming.
  function failSurface(form) {
    function block() {
      var wrap = form.closest ? form.closest('.w-form') : null;
      var el = wrap && wrap.querySelector ? wrap.querySelector('.w-form-fail') : null;
      if (!el && form.parentElement && form.parentElement.querySelector) {
        el = form.parentElement.querySelector('.w-form-fail');
      }
      return el || null;
    }
    return {
      show: function (message) {
        var el = block();
        if (!el) {
          devWarn(
            'a rejected submit had nowhere to land — no .w-form-fail block ' +
            'near this form, so the failure is console-only.',
            form
          );
          return;
        }
        el.setAttribute('role', 'alert');
        var target = (el.querySelector && el.querySelector('div')) || el;
        try {
          target.textContent = message || FALLBACK_ERROR;
        } catch (e) { /* no-op */ }
        el.style.display = 'block';
      },
      hide: function () {
        var el = block();
        if (el) el.style.display = 'none';
      }
    };
  }

  // --- submit bridge --------------------------------------------------------
  // At most one submit and one click listener per form, wired or not. Both read
  // form[WIRED_FLAG] at event time, so a form bridged pass-through and wired
  // later by rescan() gates without re-binding. Callers own the opt-in: this
  // adds listeners to any form handed to it.
  function ensureBridge(form) {
    var bridge = form[BRIDGE_FLAG];

    if (!bridge) {
      bridge = form[BRIDGE_FLAG] = { root: null, button: null, surface: failSurface(form) };

      form.addEventListener('submit', function (event) {
        // Recompute FIRST, then adjudicate on what came back.
        var wired = form[WIRED_FLAG];
        if (wired && !wired.render()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        // A submit that goes through is Memberstack's to win or lose; watch for
        // the loss so it lands on the form instead of the console.
        if (form.getAttribute && form.getAttribute('data-ms-form') !== null) {
          armOutcome(bridge.surface);
        }
      }, true);
    }

    if (bridge.root) return bridge;
    var root = form.querySelector(SUBMIT_BUTTON_SELECTOR);
    if (!root) return bridge;
    bridge.root = root;
    bridge.button = resolveButton(root, form);

    // A control that is not a native submitter (type="button", an anchor, a div
    // wrap) never fires the submit path on its own, so its click dispatches the
    // submit event Memberstack consumes. A native submitter is left alone.
    root.addEventListener('click', function (event) {
      var wired = form[WIRED_FLAG];
      var gate = wired ? wired.render() : true;
      var control = clickedControl(event, bridge.button);
      if (!gate) {
        // A disabled native control never gets here; an anchor or a stale
        // overlay still can, and must not navigate or submit.
        if (event.preventDefault) event.preventDefault();
        return;
      }
      if (isNativeSubmitter(control)) return;
      if (control && control.matches && control.matches('a') && event.preventDefault) {
        event.preventDefault();
      }
      triggerSubmit(form);
    });

    return bridge;
  }

  function activeRules(wrapper) {
    var active = [];
    for (var i = 0; i < RULE_NAMES.length; i++) {
      if (isOn(wrapper, RULE_NAMES[i])) active.push(RULE_NAMES[i]);
    }
    return active;
  }

  // Compared against the config actually being ENFORCED, not re-derived from
  // the primary wrapper — the enforced values are the only ones that matter,
  // and re-deriving them here is how the two drift apart.
  function warnIfConfigDiffers(wrapper, active, count) {
    var mine = activeRules(wrapper);
    // A wrapper that enables nothing is not asserting a config (an all-off
    // responsive instance, an ancestor carrying only the count), so it cannot
    // clash with one.
    if (!mine.length) return;
    if (mine.join('|') === active.join('|') && readCount(wrapper) === count) return;
    devWarn(
      'this wrapper differs from the one driving the form — the first wrapper ' +
      'with active rules sets the config, so this instance is being rendered ' +
      'with rules [' + active.join(', ') + '] and count ' + count + '.',
      wrapper
    );
  }

  // Fill in {count} across every wrapper, before anything can bail out.
  // With a primary the ENFORCED count is used everywhere, so the copy can
  // never advertise a number the form is not enforcing; with no primary each
  // wrapper falls back to its own.
  function renderCopy(wrappers, count) {
    for (var i = 0; i < wrappers.length; i++) {
      substituteCount(wrappers[i], count === null ? readCount(wrappers[i]) : count);
    }
  }

  // Presentation for one wrapper: hide the off rules' rows and register its
  // icon pairs with the form's shared rules. Missing rows are tolerated
  // (Designer-side visibility bindings stay a valid alternative to the
  // auto-hide) and reported once, together, on staging.
  function normalize(wrapper, active, rules) {
    var missing = [];
    for (var i = 0; i < RULE_NAMES.length; i++) {
      var name = RULE_NAMES[i];
      var row = wrapper.querySelector('[' + RULE_ATTR + '="' + name + '"]');
      if (active.indexOf(name) === -1) {
        hide(row);
        continue;
      }
      if (!row) {
        missing.push(name);
        continue;
      }
      for (var j = 0; j < rules.length; j++) {
        if (rules[j].name !== name) continue;
        rules[j].icons.push({
          yes: row.querySelector('[' + ICON_ATTR + '="valid"]'),
          no: row.querySelector('[' + ICON_ATTR + '="invalid"]')
        });
      }
    }
    if (missing.length) {
      // Not necessarily a bug: a Designer-bound visibility can legitimately
      // replace the auto-hide. It is worth naming, because a typo'd rule value
      // looks exactly the same.
      devWarn(
        'no checklist row for: ' + missing.join(', ') + ' — ' +
        (missing.length === 1 ? 'that rule is' : 'those rules are') +
        ' enforced but invisible here. Expected ' + RULE_ATTR +
        '="<rule>" inside this wrapper; fine if you bind that row yourself.',
        wrapper
      );
    }
  }

  function setUp(wrappers, form) {
    // Config comes from the first wrapper that actually enables a rule — not
    // simply the first one found. A stray count on an ancestor section, or a
    // responsive instance left at its defaults, is discovered first but
    // configures nothing, and must not decide the form's fate.
    var wrapper = null;
    var active = [];
    for (var p = 0; p < wrappers.length; p++) {
      var candidate = activeRules(wrappers[p]);
      if (!candidate.length) continue;
      wrapper = wrappers[p];
      active = candidate;
      break;
    }
    var count = wrapper ? readCount(wrapper) : null;

    if (wrapper) warnOnCountDrift(wrappers, active, count);

    // Copy is rendered before any bail-out below. Substitution changes no
    // gating and no visibility, and a literal "{count}" left on screen is a
    // bug the user can read — failing open is about not gating, not about
    // abandoning the page mid-render.
    renderCopy(wrappers, count);

    var input = form.querySelector('input[data-ms-member="password"]');
    if (!input) {
      devWarn(
        'wrapper found, but its form has no password input ' +
        '(input[data-ms-member="password"]) — nothing to validate.',
        wrappers[0]
      );
      return;
    }

    // Nothing to enforce anywhere: fail open, leaving the form exactly as
    // authored — no gating, no submit blocker, no rows or icons touched. A
    // forgotten component property must never be able to brick signup, so the
    // only signal is a staging-side console warning.
    if (!wrapper) {
      devWarn(
        'zero active rules across all ' + wrappers.length + ' wrapper' +
        (wrappers.length === 1 ? '' : 's') + ' in this form — every ' + PREFIX +
        '* toggle is off or invalid, so this form is not being validated.',
        wrappers[0]
      );
      return;
    }

    var buttonRoot = form.querySelector(SUBMIT_BUTTON_SELECTOR);
    if (!buttonRoot) {
      // Not fatal — the Enter-key blocker still gates the form — but it means
      // the visible CTA never greys out, which is always a wiring mistake.
      devWarn(
        'no [ms-code-submit-button] in this form — the submit button cannot be ' +
        'gated, though the Enter key is still blocked.',
        form
      );
    }
    var button = ensureBridge(form).button;
    if (button && !button.themeEl && !button.native) {
      // Nothing to grey and nothing to disable: the CTA will look and behave
      // identical whether the password passes or not.
      devWarn(
        'the [ms-code-submit-button] CTA cannot be greyed out or disabled — it ' +
        'carries no ' + THEME_ATTR + ' and contains no button, input or link. ' +
        'The Enter key is still blocked.',
        buttonRoot
      );
    }

    // One entry per active rule; its icon pairs are collected from EVERY
    // wrapper in the form, so a second (responsive) instance flips in step
    // with the first instead of sitting frozen.
    var rules = [];
    for (var r = 0; r < active.length; r++) {
      rules.push({ name: active[r], fn: RULES[active[r]], arg: count, icons: [] });
    }

    for (var w = 0; w < wrappers.length; w++) {
      if (wrappers[w] !== wrapper) warnIfConfigDiffers(wrappers[w], active, count);
      normalize(wrappers[w], active, rules);
    }

    var emailInput = form.querySelector('input[data-ms-member="email"]');
    var termsInput = form.querySelector('input[data-ms-member="terms-and-condition"]');

    // Returns the verdict rather than stashing it, so no caller can ever
    // adjudicate on a copy that has gone stale.
    function render() {
      var value = input.value || '';
      var allPass = true;

      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        var pass = false;
        try { pass = !!r.fn(value, r.arg); } catch (e) { pass = false; }
        if (!pass) allPass = false;

        // Every active row states where it stands from the very first render,
        // including the one at wiring time: an empty field meets no rule, so
        // the checklist reads as unchecked boxes that fill in as rules pass.
        for (var k = 0; k < r.icons.length; k++) {
          var pair = r.icons[k];
          if (pass) {
            show(pair.yes);
            hide(pair.no);
          } else {
            hide(pair.yes);
            show(pair.no);
          }
        }
      }

      // The CTA opens only when the whole form is submittable — password
      // rules, plus terms and a plausible email where the form has them. The
      // checklist above still reads from the password alone.
      var gate = allPass && emailSatisfied(emailInput) && termsSatisfied(termsInput);
      setDisabled(button, !gate);
      return gate;
    }

    // Autofill and password-manager paths are inconsistent: some fire `input`,
    // some only `change`, some nothing until the field is left. Binding all
    // three covers every variant that emits anything, and the blur re-checks
    // the field afterwards. A purely programmatic write to input.value fires
    // no event at all — nothing can catch that at write time, which is why the
    // submit handler recomputes rather than trusting the last render. The
    // gate's other fields recompute on the same three events.
    function bindField(field, handler) {
      if (!field) return;
      field.addEventListener('input', handler);
      field.addEventListener('change', handler);
      field.addEventListener('focusout', handler);
    }
    bindField(input, render);
    bindField(emailInput, render);
    // The terms listener fires at the target BEFORE Webflow's delegated
    // document handler updates the custom checkbox's visual class, so a
    // render in the same tick can read a stale w--redirected-checked (an
    // uncheck would leave the CTA open). Render now for snap, then once more
    // a tick later against the settled state.
    bindField(termsInput, function () {
      render();
      if (typeof setTimeout === 'function') setTimeout(render, 0);
    });

    // First paint: states every active rule, met or not.
    render();

    // Only a genuinely wired form is marked. A form that bailed out stays
    // unmarked so a later rescan can pick it up once the missing piece (an
    // input, a CMS-bound attribute) has arrived.
    //
    // The mark carries the enforced config and a way in for wrappers that
    // arrive later (a step flow revealing its checklist inside the form that
    // is already gating). Such a wrapper is adopted into the existing
    // instance — copy, rows and icons — rather than re-wiring the form, so
    // the config and the listeners stay exactly where the first pass put them.
    // render is read by the bridge's listeners at event time, so a form bridged
    // before it was wired starts gating from this assignment on.
    form[WIRED_FLAG] = {
      wrappers: wrappers,
      render: render,
      adopt: function (extra) {
        if (wrappers.indexOf(extra) !== -1) return;
        wrappers.push(extra);
        warnIfConfigDiffers(extra, active, count);
        warnOnCountDrift([extra], active, count);
        substituteCount(extra, count);
        normalize(extra, active, rules);
        render();
      }
    };
  }

  // Rows authored without a wrapper around them: the checklist is on the page
  // and does nothing. Usually a typo'd or missing wrapper attribute, so it is
  // reported once for the page rather than once per row.
  function warnOnOrphanRows() {
    var rows = document.querySelectorAll('[' + RULE_ATTR + ']');
    var orphans = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].closest && rows[i].closest(WRAPPER_SELECTOR)) continue;
      orphans.push(rows[i].getAttribute(RULE_ATTR));
    }
    if (!orphans.length) return;
    devWarn(
      orphans.length + ' checklist row' + (orphans.length === 1 ? '' : 's') +
      ' (' + orphans.join(', ') + ') sit outside any wrapper, so ' +
      (orphans.length === 1 ? 'it does' : 'they do') + ' nothing. Check for a ' +
      'missing or misspelled ' + PREFIX + '* attribute on the component root.'
    );
  }

  // A characters row whose copy does not use the token is a number that can
  // drift away from the one being enforced the moment either is edited.
  function warnOnCountDrift(wrappers, active, count) {
    if (active.indexOf('characters') === -1) return;
    var seen = [];
    for (var i = 0; i < wrappers.length; i++) {
      var row = wrappers[i].querySelector('[' + RULE_ATTR + '="characters"]');
      if (!row || seen.indexOf(row) !== -1) continue;
      seen.push(row);
      if (usesCountToken(row)) continue;
      devWarn(
        'the characters row does not use the ' + COUNT_TOKEN + ' token, so its ' +
        'copy can drift from the ' + count + ' actually being enforced.',
        row
      );
    }
  }

  function init() {
    var wrappers = document.querySelectorAll(WRAPPER_SELECTOR);
    warnOnOrphanRows();

    // Group every wrapper by its form: one validated instance per form, no
    // matter how many wrappers the Designer authored into it.
    var instances = [];
    for (var i = 0; i < wrappers.length; i++) {
      var wrapper = wrappers[i];
      var form = wrapper.closest ? wrapper.closest('form') : null;
      if (!form) {
        // No form means no primary to borrow a count from, so this wrapper's
        // own count renders its copy before we give up on it.
        substituteCount(wrapper, readCount(wrapper));
        devWarn(
          'wrapper is not inside a <form>, so its password input and submit ' +
          'button cannot be found — this instance does nothing.',
          wrapper
        );
        continue;
      }
      var wired = form[WIRED_FLAG];
      if (wired) {
        wired.adopt(wrapper);
        continue;
      }

      var instance = null;
      for (var j = 0; j < instances.length; j++) {
        if (instances[j].form === form) {
          instance = instances[j];
          break;
        }
      }
      if (instance) instance.wrappers.push(wrapper);
      else instances.push({ form: form, wrappers: [wrapper] });
    }

    for (var k = 0; k < instances.length; k++) {
      setUp(instances[k].wrappers, instances[k].form);
    }

    // The overlay CTA has no submit path of its own, so every Memberstack form
    // carrying one gets the bridge — validated or not. data-ms-form is the
    // opt-in: a non-Memberstack form using the same Button component is left
    // entirely untouched, no listeners at all.
    var msForms = document.querySelectorAll(MS_FORM_SELECTOR);
    for (var m = 0; m < msForms.length; m++) {
      if (msForms[m].querySelector(SUBMIT_BUTTON_SELECTOR)) ensureBridge(msForms[m]);
    }
  }

  // Markup injected after load (modals, CMS tabs, step flows) is invisible to
  // the one-shot init, so the page can ask for another pass. An already-wired
  // form is never re-wired, only extended with wrappers it has not seen, so
  // repeated calls stay harmless.
  window.startersPasswordValidation = { rescan: init };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
