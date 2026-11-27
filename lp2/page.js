/*
 * /lp2: small page fixes that need the rendered DOM.
 *
 * - the FAQ pricing item shared with other pages does not apply here, so it is removed;
 *   if no FAQ item is open after load, the first one is opened
 * - image sizes for the founder cut-out, so phones do not fetch the desktop file
 * - the revenue section headline break only applies on wide screens
 * - the comparison table becomes a focusable, labelled region only when it scrolls sideways
 */
(function () {
  if (window.__lp2PageInit) return;
  window.__lp2PageInit = true;
  function $(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function $$(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  $$('[data-lp-page] .section_faq [data-relaunch-pricing]').forEach(function (p) { var it = p.closest('.accordion_item'); if (it && it.parentNode) it.parentNode.removeChild(it); });
  window.addEventListener('load', function () {
    var btns = $$('[data-lp-page] .section_faq [data-accordion="toggle-button"]');
    if (!btns.length || !document.querySelector('[data-lp-page] .section_faq [data-accordion="content-wrap"][style]')) return;
    if (btns.some(function (b) { return b.getAttribute('aria-expanded') === 'true'; })) return;
    btns[0].click();
  }, { once: true });
  function compareScroll() {
    var box = $('[data-lp-page] .lp-compare_scroll');
    if (!box) return;
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Comparison table');
    var raf = 0;
    function check() { raf = 0; if (box.scrollWidth > box.clientWidth + 1) box.setAttribute('tabindex', '0'); else box.removeAttribute('tabindex'); }
    check();
    window.addEventListener('resize', function () { if (!raf) raf = requestAnimationFrame(check); });
  }
  function sizeHeadBreak() {
    $$('.lp-size_head h2 br').forEach(function (br) {
      var s = document.createElement('span');
      s.setAttribute('data-lp-br', '');
      s.textContent = ' ';
      br.parentNode.replaceChild(s, br);
    });
  }
  function jaiImages() {
    $$('.section-yellow-bg_decor img').forEach(function (img) {
      img.setAttribute('sizes', '(max-width: 47.9375rem) 32rem, (max-width: 61.9375rem) 26rem, 51.5625rem');
    });
  }
  function start() {
    try { jaiImages(); } catch (e) {}
    try { sizeHeadBreak(); } catch (e) {}
    try { compareScroll(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
