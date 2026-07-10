// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/featured-expert-card/featured-expert-card-price

  (function () {
    'use strict';

    function parsePriceText(text) {
      var cleaned = String(text).replace(/,/g, '').trim();
      var n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    }

    /**
     * 1000 → 1K, 1100 → 1.1K, 9999 → 9.9K (not 10K), 99 → 99
     * Fractional thousands use one decimal, truncated (not rounded) so 9.999K doesn’t become 10K.
     */
    function formatAbbrevK(n) {
      if (n < 1000) return String(Math.round(n));
      var kVal = n / 1000;
      if (Math.abs(kVal - Math.round(kVal)) < 1e-9) {
        return Math.round(kVal) + 'K';
      }
      var t = Math.floor(kVal * 10 + 1e-9) / 10;
      if (Math.abs(t - Math.round(t)) < 1e-9) return Math.round(t) + 'K';
      return t.toFixed(1).replace(/\.0$/, '') + 'K';
    }

    function abbreviatePriceElements(root) {
      var scope = root || document;
      scope.querySelectorAll('[data-price-text]').forEach(function (el) {
        if (el.dataset.priceAbbrev === '1') return;
        var raw = parsePriceText(el.textContent);
        if (raw === null) return;
        el.textContent = formatAbbrevK(raw);
        el.dataset.priceAbbrev = '1';
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        abbreviatePriceElements();
      });
    } else {
      abbreviatePriceElements();
    }
  })();