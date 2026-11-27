/*
 * /lp2: links and labels.
 *
 * - the nav button label (window.__lp2Nav, defined inline so it runs before paint) is applied again
 *   in case the nav rendered after the inline call
 * - icon-only links get the visible label of their button as an accessible name
 * - utm_* and fbclid from the landing URL are carried onto /quiz links, so the quiz records the ad
 * - for signed-out visitors, the Access brilliance links go to /quiz (with the ad tags) instead of the
 *   profile pages; the original href is kept in data-lp-orig-href and restored for members
 */
(function () {
  if (window.__lp2LinksInit) return;
  window.__lp2LinksInit = true;
  function $(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function $$(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function carryAdTags() {
    var keep = [];
    try {
      new URLSearchParams(window.location.search).forEach(function (val, k) {
        if (/^utm_/i.test(k) || k === 'fbclid') keep.push([k, val]);
      });
    } catch (e) { return; }
    if (!keep.length) return;
    $$('a[href]').forEach(function (a) {
      try {
        var u = new URL(a.getAttribute('href'), window.location.href);
        if (u.origin !== window.location.origin) return;
        if (u.pathname.replace(/\/+$/, '') !== '/quiz') return;
        keep.forEach(function (p) { u.searchParams.set(p[0], p[1]); });
        a.setAttribute('href', u.pathname + u.search + u.hash);
      } catch (e) {}
    });
  }
  function relabelNav() { if (window.__lp2Nav) window.__lp2Nav(); }
  function nameLinks() {
    $$('[data-lp-page] a[aria-label=""], [data-lp-page] a[data-lp-name]').forEach(function (a) {
      if ((a.textContent || '').trim()) { a.removeAttribute('aria-label'); return; }
      var box = a.parentNode && a.parentNode.parentNode;
      var label = box ? $('.button_main-text', box) : null;
      var text = label ? (label.textContent || '').trim() : '';
      if (!text) return;
      a.setAttribute('aria-label', text);
      a.setAttribute('data-lp-name', '');
    });
  }
  // Members are known from the cached Memberstack record first (no flash), then confirmed with
  // getCurrentMember once Memberstack is ready. Capture-phase listeners keep the shared Access
  // brilliance script from opening its own panel for a link this file sends to /quiz.
  var HIJACK = [
    '.section_access-brilliance a[data-ab-element$="-landing"]',
    '.section_access-brilliance .access-brilliance_button-group a'
  ];
  var HJ_SEL = HIJACK.map(function (s) { return '[data-lp-page] ' + s; }).join(', ');
  var hj = { on: false, roots: [] };
  function quizHref() {
    var u = new URL('/quiz', window.location.href);
    try { new URLSearchParams(window.location.search).forEach(function (v, k) { if (/^utm_/i.test(k) || k === 'fbclid') u.searchParams.set(k, v); }); } catch (e) {}
    return u.pathname + u.search;
  }
  function hjLink(a) {
    var q = quizHref(), h = a.getAttribute('href');
    if (h === q) return;
    a.setAttribute('data-lp-orig-href', h == null ? '' : h);
    a.setAttribute('href', q);
  }
  function hjApply() { if (hj.on) $$(HJ_SEL).forEach(hjLink); }
  function hjRestore() {
    $$('[data-lp-page] [data-lp-orig-href]').forEach(function (a) { a.setAttribute('href', a.getAttribute('data-lp-orig-href')); a.removeAttribute('data-lp-orig-href'); });
  }
  function hjSet(on) {
    if (hj.on === on) return;
    hj.on = on;
    if (on) hjApply(); else hjRestore();
  }
  function hjTarget(e) {
    if (!hj.on || !e.target || !e.target.closest) return null;
    var a = e.target.closest(HJ_SEL);
    if (a) hjLink(a);
    return a;
  }
  function cachedMember() {
    try { var m = JSON.parse(window.localStorage.getItem('_ms-mem') || 'null'); return !!(m && (m.id || (m.data && m.data.id))); } catch (e) { return false; }
  }
  function initHijack() {
    var page = $('[data-lp-page]');
    if (!page) return;
    page.addEventListener('click', function (e) { if (hjTarget(e)) e.stopPropagation(); }, true);
    page.addEventListener('auxclick', function (e) { if (hjTarget(e)) e.stopPropagation(); }, true);
    page.addEventListener('keydown', function (e) {
      if (e.key !== ' ' && e.key !== 'Spacebar') return;
      var a = hjTarget(e);
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      a.click();
    }, true);
    $$(HJ_SEL).forEach(function (a) { var r = a.closest('section') || a.parentNode; if (r && hj.roots.indexOf(r) < 0) hj.roots.push(r); });
    var mo = new MutationObserver(function () { hjApply(); });
    hj.roots.forEach(function (r) { mo.observe(r, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] }); });
    hjSet(!cachedMember());
    function ask() {
      var ms = window.$memberstackDom;
      if (!ms || typeof ms.getCurrentMember !== 'function') return;
      try { ms.getCurrentMember().then(function (r) { if (r && r.data) hjSet(false); else if (r && r.data === null) hjSet(true); }, function () {}); } catch (e) {}
    }
    var ready = window.memberReady;
    if (ready && typeof ready.then === 'function') ready.then(ask, ask); else if (window.$memberstackDom) ask(); else window.addEventListener('load', ask, { once: true });
  }
  function start() {
    try { relabelNav(); } catch (e) {}
    try { nameLinks(); } catch (e) {}
    try { carryAdTags(); } catch (e) {}
    try { initHijack(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
