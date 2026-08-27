// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/password-validation
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
// On each checklist row inside the wrapper:
//   starters-password-validation-rule="characters|special|capitalization|numbers"
//   starters-password-validation-icon="valid" / "invalid"

(function () {
  if (window.__startersPasswordValidationInit) return;
  window.__startersPasswordValidationInit = true;

  var PREFIX = 'starters-password-validation-';
  var COUNT_ATTR = PREFIX + 'character-count';
  var RULE_ATTR = PREFIX + 'rule';
  var ICON_ATTR = PREFIX + 'icon';
  var DEFAULT_COUNT = 8;
  var WIRED_FLAG = '__startersPasswordValidation';

  // Rule predicates. Adding a rule is one entry here plus one Webflow
  // attribute — the key IS the attribute suffix and the row's rule value.
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
  var COUNT_TOKEN = '{count}';

  function substituteCount(node, count) {
    if (!node || !node.childNodes) return;
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 3) {
        var text = child.nodeValue;
        if (text && text.indexOf(COUNT_TOKEN) !== -1) {
          child.nodeValue = text.split(COUNT_TOKEN).join(count);
        }
      } else if (child.nodeType === 1) {
        substituteCount(child, count);
      }
    }
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

  function resolveButton(root, form) {
    if (!root) return null;

    var actionable = root.matches && root.matches(ACTIONABLE_SELF)
      ? root
      : root.querySelector(ACTIONABLE_INNER) || root;

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

    return {
      root: root,
      actionable: actionable,
      themeEl: themeEl,
      // Only a real control has a disabled property worth setting; writing one
      // onto a div or an anchor invents an attribute the browser ignores.
      native: !!(actionable.matches && actionable.matches(NATIVE_CONTROL)),
      theme: readAuthoredTheme(themeEl)
    };
  }

  function setDisabled(button, isDisabled) {
    if (!button) return;
    var themeEl = button.themeEl;
    var actionable = button.actionable;

    if (isDisabled) {
      button.root.classList.add('disabled');
      if (themeEl) {
        themeEl.setAttribute(THEME_ATTR, DISABLED_THEME);
        if (themeEl !== actionable) themeEl.setAttribute('aria-disabled', 'true');
      }
      actionable.setAttribute('aria-disabled', 'true');
      if (button.native) {
        actionable.disabled = true;
        actionable.setAttribute('disabled', 'disabled');
        actionable.setAttribute('tabindex', '-1');
      }
    } else {
      button.root.classList.remove('disabled');
      if (themeEl) {
        if (button.theme !== null) themeEl.setAttribute(THEME_ATTR, button.theme);
        if (themeEl !== actionable) themeEl.removeAttribute('aria-disabled');
      }
      actionable.removeAttribute('aria-disabled');
      if (button.native) {
        actionable.disabled = false;
        actionable.removeAttribute('disabled');
        actionable.removeAttribute('tabindex');
      }
    }
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

  // Fill in {count} across every wrapper, once, before anything can bail out.
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
  // auto-hide). Returns how many rows it found.
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

    // Checked before renderCopy, which is what removes the token.
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

    var buttonRoot = form.querySelector('[ms-code-submit-button]');
    if (!buttonRoot) {
      // Not fatal — the Enter-key blocker still gates the form — but it means
      // the visible CTA never greys out, which is always a wiring mistake.
      devWarn(
        'no [ms-code-submit-button] in this form — the submit button cannot be ' +
        'gated, though the Enter key is still blocked.',
        form
      );
    }
    var button = resolveButton(buttonRoot, form);
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

    var touched = false;

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

        for (var k = 0; k < r.icons.length; k++) {
          var pair = r.icons[k];
          if (!touched) {
            // Neutral initial state: no red crosses before the user types.
            hide(pair.yes);
            hide(pair.no);
          } else if (pass) {
            show(pair.yes);
            hide(pair.no);
          } else {
            hide(pair.yes);
            show(pair.no);
          }
        }
      }

      setDisabled(button, !allPass);
      return allPass;
    }

    input.addEventListener('input', function () {
      touched = true;
      render();
    });

    // A field someone (or something) filled counts as typed once the user
    // leaves it, or once the browser fires `change` — some autofill paths fire
    // one, some the other, and some neither until then. An empty field is left
    // alone, so simply tabbing past earns no red crosses.
    //
    // These are the real escape hatch from a stale-value lockout: a natively
    // disabled default submit button blocks implicit submission, so the user
    // cannot reach the submit handler to have it recompute for them.
    function revalidateIfFilled() {
      if ((input.value || '') === '') return;
      touched = true;
      render();
    }
    input.addEventListener('focusout', revalidateIfFilled);
    input.addEventListener('change', revalidateIfFilled);

    form.addEventListener('submit', function (event) {
      // Recompute FIRST, then adjudicate on what came back.
      touched = true;
      if (!render()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    // Non-empty at init (autofill, browser restore) counts as typed.
    if ((input.value || '') !== '') touched = true;
    render();

    // Only a genuinely wired form is marked. A form that bailed out stays
    // unmarked so a later rescan can pick it up once the missing piece (an
    // input, a CMS-bound attribute) has arrived.
    form[WIRED_FLAG] = true;
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
      if (row.textContent && row.textContent.indexOf(COUNT_TOKEN) !== -1) continue;
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
      if (form[WIRED_FLAG]) continue;

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
  }

  // Forms injected after load (modals, CMS tabs, step flows) are invisible to
  // the one-shot init, so the page can ask for another pass. Already-wired
  // forms are skipped, making repeated calls harmless.
  window.startersPasswordValidation = { rescan: init };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
