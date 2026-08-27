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
// of them are rendered and flip together, with the first one's config ruling.
// A misconfigured instance fails open and says so on staging; it never gates.
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

  function setDisabled(button, authoredTheme, isDisabled) {
    if (!button) return;
    if (isDisabled) {
      button.classList.add('disabled');
      button.disabled = true;
      button.setAttribute('disabled', 'disabled');
      button.setAttribute('aria-disabled', 'true');
      if (authoredTheme !== null) button.setAttribute(THEME_ATTR, DISABLED_THEME);
    } else {
      button.classList.remove('disabled');
      button.disabled = false;
      button.removeAttribute('disabled');
      button.removeAttribute('aria-disabled');
      if (authoredTheme !== null) button.setAttribute(THEME_ATTR, authoredTheme);
    }
  }

  function activeRules(wrapper) {
    var active = [];
    for (var i = 0; i < RULE_NAMES.length; i++) {
      if (isOn(wrapper, RULE_NAMES[i])) active.push(RULE_NAMES[i]);
    }
    return active;
  }

  function warnIfConfigDiffers(wrapper, primary) {
    if (
      activeRules(wrapper).join('|') === activeRules(primary).join('|') &&
      readCount(wrapper) === readCount(primary)
    ) return;
    devWarn(
      'a second wrapper in this form differs from the first — the first one ' +
      'sets the rules for the whole form, so this instance is being rendered ' +
      "with the first wrapper's config.",
      wrapper
    );
  }

  // Presentation for one wrapper: hide the off rules' rows, fill in {count}
  // anywhere inside it, and register its icon pairs with the form's shared
  // rules. Missing rows are tolerated (Designer-side visibility bindings stay
  // a valid alternative to the auto-hide). Returns how many rows it found.
  function normalize(wrapper, active, count, rules) {
    var found = 0;
    for (var i = 0; i < RULE_NAMES.length; i++) {
      var name = RULE_NAMES[i];
      var row = wrapper.querySelector('[' + RULE_ATTR + '="' + name + '"]');
      if (active.indexOf(name) === -1) {
        hide(row);
        continue;
      }
      if (!row) continue;
      found++;
      for (var j = 0; j < rules.length; j++) {
        if (rules[j].name !== name) continue;
        rules[j].icons.push({
          yes: row.querySelector('[' + ICON_ATTR + '="valid"]'),
          no: row.querySelector('[' + ICON_ATTR + '="invalid"]')
        });
      }
    }
    // Once per wrapper, so a heading above the list can carry the token too.
    substituteCount(wrapper, count);
    return found;
  }

  function setUp(wrappers, form) {
    var input = form.querySelector('input[data-ms-member="password"]');
    if (!input) {
      devWarn(
        'wrapper found, but its form has no password input ' +
        '(input[data-ms-member="password"]) — nothing to validate.',
        wrappers[0]
      );
      return;
    }

    // Config comes from the FIRST wrapper. A responsive component is authored
    // as two instances in one form (one hidden per breakpoint); they are meant
    // to agree, so one of them is the source of truth and a disagreement is a
    // staging warning rather than two competing gates.
    var wrapper = wrappers[0];
    var count = readCount(wrapper);
    var active = activeRules(wrapper);

    // Nothing to enforce: fail open, leaving the form exactly as authored — no
    // gating, no submit blocker, no rows or icons touched. A forgotten
    // component property must never be able to brick signup, so the only
    // signal is a staging-side console warning.
    if (!active.length) {
      devWarn(
        'wrapper has zero active rules — every ' + PREFIX + '* toggle is off or invalid, ' +
        'so this form is not being validated.',
        wrapper
      );
      return;
    }

    var button = form.querySelector('[ms-code-submit-button]');
    if (!button) {
      // Not fatal — the Enter-key blocker still gates the form — but it means
      // the visible CTA never greys out, which is always a wiring mistake.
      devWarn(
        'no [ms-code-submit-button] in this form — the submit button cannot be ' +
        'gated, though the Enter key is still blocked.',
        form
      );
    }
    var authoredTheme = readAuthoredTheme(button);

    // One entry per active rule; its icon pairs are collected from EVERY
    // wrapper in the form, so a second (responsive) instance flips in step
    // with the first instead of sitting frozen.
    var rules = [];
    for (var r = 0; r < active.length; r++) {
      rules.push({ name: active[r], fn: RULES[active[r]], arg: count, icons: [] });
    }

    var foundRows = 0;
    for (var w = 0; w < wrappers.length; w++) {
      if (w > 0) warnIfConfigDiffers(wrappers[w], wrapper);
      foundRows += normalize(wrappers[w], active, count, rules);
    }

    // Every active rule resolved to nothing on screen: the rules are still
    // enforced, but the user is being gated with no visible explanation.
    if (!foundRows) {
      devWarn(
        'active rules (' + active.join(', ') + ') but no checklist rows — the ' +
        'user sees no reason for the disabled button. Check the ' + RULE_ATTR +
        ' values.',
        wrapper
      );
    }

    var isValid = false;
    var touched = false;

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

      isValid = allPass;
      setDisabled(button, authoredTheme, !isValid);
    }

    input.addEventListener('input', function () {
      touched = true;
      render();
    });

    // Blurring a field someone (or something) filled counts as typing. An
    // empty field is left alone, so simply tabbing past earns no red crosses.
    input.addEventListener('focusout', function () {
      if ((input.value || '') === '') return;
      touched = true;
      render();
    });

    form.addEventListener('submit', function (event) {
      // Recompute FIRST, then adjudicate. Writing input.value fires no event,
      // so a password manager or a script can leave the cached validity stale
      // — and with the button disabled, a stale "invalid" would lock the form
      // with no way out.
      touched = true;
      render();
      if (!isValid) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    // Non-empty at init (autofill, browser restore) counts as typed.
    if ((input.value || '') !== '') touched = true;
    render();
  }

  function init() {
    var wrappers = document.querySelectorAll(WRAPPER_SELECTOR);

    // Group every wrapper by its form: one validated instance per form, no
    // matter how many wrappers the Designer authored into it.
    var forms = [];
    var groups = [];
    for (var i = 0; i < wrappers.length; i++) {
      var wrapper = wrappers[i];
      var form = wrapper.closest ? wrapper.closest('form') : null;
      if (!form) {
        devWarn(
          'wrapper is not inside a <form>, so its password input and submit ' +
          'button cannot be found — this instance does nothing.',
          wrapper
        );
        continue;
      }
      var at = forms.indexOf(form);
      if (at === -1) {
        forms.push(form);
        groups.push([wrapper]);
      } else {
        groups[at].push(wrapper);
      }
    }

    for (var j = 0; j < forms.length; j++) setUp(groups[j], forms[j]);
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
