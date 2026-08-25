// millify embed — format long numbers as 1.2K / 3.4M via data-millify attributes
// Formatting algorithm adapted from millify v6.1.0 (MIT) — https://www.npmjs.com/package/millify
//
// Contract: refuse rather than approximate. Any value this cannot render exactly
// leaves the element's text untouched instead of showing a rounded-off guess —
// a value we cannot represent is usually a data bug, and leaving it visible is
// what surfaces it. Do not "fix" this into a dash or a zero.

(function () {
  if (window.__startersMillifyInit) return;
  window.__startersMillifyInit = true;

  // Stops at P. The MAX_SAFE_INTEGER guard below caps input at ~9.007e15, so an
  // 'E' (1e18) unit could never be emitted — it only advertised a range we refuse.
  var DEFAULT_UNITS = ['', 'K', 'M', 'B', 'T', 'P'];
  var MAX = Number.MAX_SAFE_INTEGER;
  var MIN = Number.MIN_SAFE_INTEGER;

  // --- dev-only diagnostics -------------------------------------------------
  // Silent in production. Emits only on staging/local hosts or when the site
  // owner opts in with window.STARTERS_DEBUG === true.
  function isDevHost() {
    try {
      if (window.STARTERS_DEBUG === true) return true;
      var h = (location && location.hostname) || '';
      return (
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h.endsWith('webflow.io') ||
        h.endsWith('trycloudflare.com')
      );
    } catch (e) {
      return false;
    }
  }

  function devWarn() {
    if (!isDevHost()) return;
    try {
      console.warn.apply(console, ['[millify]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* no-op */
    }
  }

  // A refusal carries why, so the caller can say something useful on staging.
  // Reasons: 'parse' | 'range' | 'max' | 'units'.
  function fail(reason) {
    return { ok: false, reason: reason };
  }

  // --- pure formatter -------------------------------------------------------
  // Returns { ok: true, text, raw } on success, or { ok: false, reason } for
  // graceful fallback (caller leaves the element's text untouched).
  function millifyCore(input, opts) {
    var num = parseFloat(input);
    if (!isFinite(num)) return fail('parse');
    // Values beyond the safe integer range are ambiguous — leave them alone.
    if (num > MAX || num < MIN) return fail('range');

    // An authored ceiling (data-millify-max) is a domain guard, not a formatting
    // one: a value above it is bad data rather than a very large number, so it
    // gets the same refusal as anything else we cannot honestly render.
    if (opts.max != null && Math.abs(num) > opts.max) return fail('max');

    var units = opts.units;
    var precision = opts.precision;

    var negative = num < 0;
    var value = Math.abs(num);

    // Repeatedly divide by 1000 while the next group still has an integer part.
    var unitIndex = 0;
    var denominator = 1;
    while (value / (denominator * 1000) >= 1) {
      denominator *= 1000;
      unitIndex++;
    }
    value = value / denominator;

    // Round: integers stay exact; otherwise honour the requested precision.
    if (!Number.isInteger(value)) {
      value = parseFloat(value.toFixed(precision));
    }

    // Edge-case fix from upstream millify: rounding can push the value back up
    // into the next unit (e.g. 999,999 @ precision 1 -> "1000K" would be wrong;
    // this promotes it to "1M"). Re-run the divide loop on the rounded value.
    while (value / 1000 >= 1) {
      value = value / 1000;
      unitIndex++;
    }

    // Too large for the available units -> ambiguous, leave original.
    if (unitIndex >= units.length) return fail('units');

    // Count decimals of the rounded value so the locale output keeps them.
    var str = String(value);
    var dot = str.indexOf('.');
    var digits = dot === -1 ? 0 : str.length - dot - 1;

    // Pinned to en-US rather than the visitor's locale: every consumer renders a
    // USD price, and a European locale turns "$1.5K" into "$1,5K" — which reads
    // as a typo at best and as a hundredfold error at worst.
    var formatted;
    try {
      formatted = value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        // Pin the max to the same count so an already-rounded value with more
        // than 3 decimals (high precision) is not silently re-rounded.
        maximumFractionDigits: digits
      });
    } catch (e) {
      formatted = String(value);
    }

    var unit = units[unitIndex] != null ? units[unitIndex] : '';
    if (opts.lowercase) unit = unit.toLowerCase();

    var prefix = negative ? '-' : '';
    // Only insert the separating space when there is actually a unit to
    // separate, so small numbers never render with a dangling trailing space.
    var sep = opts.space && unit !== '' ? ' ' : '';

    return { ok: true, text: prefix + formatted + sep + unit, raw: num };
  }

  // --- attribute + text parsing --------------------------------------------
  function sanitize(text) {
    if (text == null) return '';
    // Trim, then strip thousands separators (commas) and any whitespace,
    // including non-breaking spaces, so CMS text like "12,345" parses.
    return String(text).trim().replace(/[\s, ]/g, '');
  }

  function readOptions(el) {
    var precision = 1;
    var pAttr = el.getAttribute('data-millify-precision');
    if (pAttr !== null && pAttr.trim() !== '') {
      var n = Number(pAttr);
      if (Number.isInteger(n) && n >= 0) {
        precision = n;
      } else {
        devWarn('invalid data-millify-precision (using default 1):', pAttr, el);
      }
    }

    var max = null;
    var mAttr = el.getAttribute('data-millify-max');
    if (mAttr !== null && mAttr.trim() !== '') {
      // Through sanitize() for the same reason the value path uses it: an author
      // writing "1,000,000" is writing the number the CMS shows them, and a bare
      // Number() would make that NaN and drop the ceiling silently in production.
      var m = Number(sanitize(mAttr));
      // Zero is a legitimate ceiling meaning "format nothing but zero itself",
      // and it is the value an author reaches for to switch formatting off. It
      // must not be lumped in with garbage, or the attribute silently becomes
      // no ceiling at all — the opposite of what was asked for.
      if (Number.isFinite(m) && m >= 0) {
        max = m;
      } else {
        devWarn('invalid data-millify-max (ignored):', mAttr, el);
      }
    }

    var space = el.getAttribute('data-millify-space') === 'true';
    var lowercase = el.getAttribute('data-millify-lowercase') === 'true';

    var units = DEFAULT_UNITS;
    var uAttr = el.getAttribute('data-millify-units');
    if (uAttr !== null && uAttr.trim() !== '') {
      var parts = uAttr.split(',').map(function (s) {
        return s.trim();
      });
      if (parts.length >= 1) units = parts;
    }

    return { precision: precision, space: space, lowercase: lowercase, units: units, max: max };
  }

  // --- element processing ---------------------------------------------------
  function processElement(el) {
    if (!el || el.nodeType !== 1) return;

    var opts = readOptions(el);

    var markerVal = el.getAttribute('data-millify');
    var explicit = typeof markerVal === 'string' && markerVal.trim() !== '';

    var source;
    if (explicit) {
      // An explicit value means the visible text may already be formatted;
      // always format from the attribute value, never from textContent.
      source = markerVal;
    } else if (el.hasAttribute('data-millify-raw')) {
      // Already processed via the textContent path. If the text still matches
      // what we last wrote, there's nothing to do. If it changed (a CMS
      // re-render dropped a fresh number in), re-parse from the new text.
      var stored = el.getAttribute('data-millify-raw');
      var expected = millifyCore(stored, opts);
      if (expected.ok && el.textContent === expected.text) return;
      source = el.textContent;
    } else {
      source = el.textContent;
    }

    var cleaned = sanitize(source);
    var result = millifyCore(cleaned, opts);

    if (!result.ok) {
      if (result.reason === 'max') {
        // Distinct from a bad value: the number is fine, the authored ceiling
        // rejected it. Saying "could not format" would send the author off to
        // audit the CMS field instead of their own attribute.
        devWarn(
          'value above data-millify-max (' + opts.max + '); leaving text untouched:',
          source,
          el
        );
      } else {
        devWarn('could not format value; leaving text untouched:', source, el);
      }
      return;
    }

    // Idempotency: don't rewrite (and thus don't fire a needless childList
    // mutation) if the text already equals our computed output.
    if (el.textContent !== result.text) {
      el.textContent = result.text;
    }
    el.setAttribute('data-millify-raw', String(result.raw));
  }

  function processTree(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.matches && root.matches('[data-millify]')) {
      processElement(root);
    }
    if (root.querySelectorAll) {
      var list = root.querySelectorAll('[data-millify]');
      for (var i = 0; i < list.length; i++) processElement(list[i]);
    }
  }

  // --- lifecycle ------------------------------------------------------------
  function start() {
    processTree(document);

    if (typeof MutationObserver !== 'function' || !document.body) return;

    // Watch only for ADDED nodes (childList/subtree). We deliberately do NOT
    // observe attribute or characterData mutations: our own textContent writes
    // fire childList mutations whose added nodes are text nodes, so filtering
    // to element matches keeps us from reprocessing our own output.
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          processTree(added[j]);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Expose the pure formatter for testing/console use without leaking internals.
  window.__startersMillify = millifyCore;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
