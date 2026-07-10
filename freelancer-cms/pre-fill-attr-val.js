// Docs: https://wf-starter-embeds-docs.vercel.app/docs/freelancer-cms/pre-fill-attr-val

  (function () {
    'use strict';

    // Run once even if Webflow injects this twice.
    if (document.documentElement.dataset.spPrefillInited) return;
    document.documentElement.dataset.spPrefillInited = 'true';

    // TEMP debug logging — staging only (production is a custom domain, so these no-op there).
    var IS_STAGING = /\.webflow\.io$/i.test(location.hostname);
    function log() {
      if (!IS_STAGING) return;
      console.log.apply(console, ['[sp-prefill]'].concat([].slice.call(arguments)));
    }
    function warn() {
      if (!IS_STAGING) return;
      console.warn.apply(console, ['[sp-prefill]'].concat([].slice.call(arguments)));
    }

    var TRIGGER_SELECTOR = '[data-sp-fill="button"]';
    var INPUT_SELECTOR = '[data-sp-fill="input"]';

    function init() {
      // Delegated so triggers rendered later (CMS lists) still work.
      document.addEventListener('click', handleTriggerClick);
    }

    /** On a tagged trigger click, apply each category/value pair to its matching field. */
    function handleTriggerClick(e) {
      var trigger = e.target.closest(TRIGGER_SELECTOR);
      if (!trigger) return;

      // No preventDefault / stopPropagation — the same node may also be a modal trigger handled
      // by a separate document-level delegated listener.
      var pairs = collectFillPairs(trigger);
      log('trigger clicked —', pairs.length, 'pair(s)');

      pairs.forEach(function (pair) {
        applyPair(pair.category, pair.value);
      });
    }

    /** Gather {category, value} pairs from the trigger and its [data-sp-fill-category] descendants. */
    function collectFillPairs(trigger) {
      var sources = Array.prototype.slice.call(trigger.querySelectorAll('[data-sp-fill-category]'));
      if (trigger.hasAttribute('data-sp-fill-category')) sources.unshift(trigger);

      var pairs = [];
      sources.forEach(function (source) {
        var category = (source.getAttribute('data-sp-fill-category') || '').trim();
        if (!category) {
          warn('skipping pair with missing/empty data-sp-fill-category', source);
          return;
        }
        if (!source.hasAttribute('data-sp-fill-value')) {
          warn('skipping "' + category + '" — missing data-sp-fill-value', source);
          return;
        }
        pairs.push({ category: category, value: source.getAttribute('data-sp-fill-value') });
      });
      return pairs;
    }

    /** Resolve the field(s) tagged for a category, then write the value by field type. */
    function applyPair(category, value) {
      var target = resolveTarget(category);
      if (!target) {
        warn('no field tagged for category "' + category + '" — skipping');
        return;
      }

      var fields = fieldsFromTarget(target);
      if (fields.length === 0) {
        warn('no input/select/textarea inside target for "' + category + '" — skipping', target);
        return;
      }

      var first = fields[0];
      if (first.tagName === 'SELECT') {
        applySelect(category, first, value);
        return;
      }

      var type = (first.getAttribute('type') || '').toLowerCase();
      if (type === 'radio') {
        applyRadio(category, fields, value);
        return;
      }
      if (type === 'checkbox') {
        applyCheckbox(category, first, value);
        return;
      }

      applyText(category, first, value);
    }

    /** Find the tagged element for a category (exact match first, then case-insensitive), ignoring
     *  anything inside a trigger. Returns null when nothing matches. */
    function resolveTarget(category) {
      var candidates = Array.prototype.slice.call(document.querySelectorAll(INPUT_SELECTOR))
        .filter(function (el) { return !el.closest(TRIGGER_SELECTOR); });

      var exact = candidates.filter(function (el) {
        return (el.getAttribute('data-sp-fill-category') || '') === category;
      });
      if (exact.length) return exact[0];

      var lower = category.toLowerCase();
      var insensitive = candidates.filter(function (el) {
        return (el.getAttribute('data-sp-fill-category') || '').toLowerCase() === lower;
      });
      if (insensitive.length) {
        warn('category "' + category + '" matched a field by case-insensitive fallback ("' +
          insensitive[0].getAttribute('data-sp-fill-category') + '") — align the casing');
        return insensitive[0];
      }
      return null;
    }

    /** The tagged element itself if it's a field, otherwise the fields inside it (radio/checkbox group). */
    function fieldsFromTarget(target) {
      var tag = target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return [target];
      return Array.prototype.slice.call(target.querySelectorAll('input, select, textarea'));
    }

    /** Pick the option matching value (value exact -> value ci -> text exact -> text ci); no change if none. */
    function applySelect(category, select, value) {
      var wanted = value == null ? '' : String(value);
      var lower = wanted.toLowerCase();
      var options = Array.prototype.slice.call(select.options);

      var match =
        options.filter(function (o) { return o.value === wanted; })[0] ||
        options.filter(function (o) { return o.value.toLowerCase() === lower; })[0] ||
        options.filter(function (o) { return o.textContent.trim() === wanted; })[0] ||
        options.filter(function (o) { return o.textContent.trim().toLowerCase() === lower; })[0];

      if (!match) {
        warn('"' + category + '": no <option> matches "' + value + '" — leaving select unchanged');
        return;
      }
      if (select.disabled) {
        warn('"' + category + '": select is disabled — value would not submit, skipping');
        return;
      }

      // Select the matched option directly (immune to duplicate option values).
      match.selected = true;
      dispatchInputChange(select);
      log('"' + category + '" -> select #' + (select.id || '(no id)') + ' = "' + match.value + '"');
    }

    /** Click the radio whose value matches (exact -> case-insensitive), if not already checked. */
    function applyRadio(category, radios, value) {
      var wanted = value == null ? '' : String(value);
      var lower = wanted.toLowerCase();

      var match =
        radios.filter(function (r) { return r.value === wanted; })[0] ||
        radios.filter(function (r) { return r.value.toLowerCase() === lower; })[0];

      if (!match) {
        warn('"' + category + '": no radio value matches "' + value + '" — skipping');
        return;
      }
      if (match.disabled) {
        warn('"' + category + '": matching radio is disabled — skipping');
        return;
      }

      // A real click updates Webflow's custom radio visuals and fires change natively.
      if (!match.checked) match.click();
      log('"' + category + '" -> radio = "' + match.value + '"');
    }

    /** Toggle the checkbox to the desired state derived from the value; only clicks when it differs. */
    function applyCheckbox(category, checkbox, value) {
      var raw = (value == null ? '' : String(value)).trim();
      var lower = raw.toLowerCase();
      var ownValue = (checkbox.value || '').trim();

      var desired;
      if (lower === 'true') desired = true;
      else if (lower === 'false') desired = false;
      else if (ownValue && lower === ownValue.toLowerCase()) desired = true;
      else {
        warn('"' + category + '": checkbox value "' + raw + '" not recognized (use true/false or the checkbox\'s own value) — skipping');
        return;
      }
      if (checkbox.disabled) {
        warn('"' + category + '": checkbox is disabled — skipping');
        return;
      }

      // A real click updates Webflow's custom checkbox visuals and fires change natively.
      if (checkbox.checked !== desired) checkbox.click();
      log('"' + category + '" -> checkbox = ' + desired);
    }

    /** Assign the value to a text input / textarea and fire input + change. */
    function applyText(category, field, value) {
      if (field.disabled) {
        warn('"' + category + '": field is disabled — value would not submit, skipping');
        return;
      }
      field.value = value == null ? '' : String(value);
      dispatchInputChange(field);
      log('"' + category + '" -> text field #' + (field.id || '(no id)') + ' = "' + field.value + '"');
    }

    /** Fire input + change so the form-filter and step-flow scripts react. */
    function dispatchInputChange(field) {
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Run whether or not DOMContentLoaded has already fired (footer vs head / late inject).
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();