/*
 * /lp2: ad-matched pain order, the hero swap backstop, and the "stuck" table highlight.
 *
 * Runs first of the lp2 files: it lifts the lp-swap flash guard that the inline page script set,
 * so it must not wait for the others. Reads window.__lp2 (hero embed) and window.__lp2Pains (page embed).
 */
(function () {
  if (window.__lp2StuckInit) return;
  window.__lp2StuckInit = true;
  function $(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function $$(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  // Cards in every [data-pain-grid] go back to authored order, then the ones matching the ad come first.
  // Authored order is kept in data-lp-idx so this can run again without drifting.
  function painKey() {
    if (window.__lp2) { var v = window.__lp2.variant(); return v ? v.pains : ''; }
    var k = '', P = window.__lp2Pains || {};
    try { k = (new URLSearchParams(window.location.search).get('utm_content') || '').toLowerCase(); } catch (e) {}
    return Object.prototype.hasOwnProperty.call(P, k) ? P[k] : '';
  }
  function applyPains() {
    var pains = painKey();
    $$('[data-pain-grid]').forEach(function (list) {
      var items = Array.prototype.slice.call(list.children);
      items.forEach(function (c, i) { if (c.getAttribute('data-lp-idx') === null) c.setAttribute('data-lp-idx', String(i)); });
      items.sort(function (a, b) { return (+a.getAttribute('data-lp-idx')) - (+b.getAttribute('data-lp-idx')); });
      if (pains) {
        items.sort(function (a, b) { return (b.getAttribute('data-pain') === pains) - (a.getAttribute('data-pain') === pains); });
      }
      items.forEach(function (c) { list.appendChild(c); });
    });
  }
  // One row of the stuck table is highlighted at a time, every second, only while the table is on screen,
  // the tab is visible and reduced motion is off. The next tick is scheduled from the planned time, not from
  // when the timer fired, so the rhythm does not drift.
  var stuck = { i: 0, timer: 0, next: 0, seen: true };
  function stuckRows() { return $$('[data-stuck] [data-pain-grid] > [data-pain]'); }
  function stuckShow(i) {
    var rows = stuckRows();
    if (!rows.length) return;
    stuck.i = i % rows.length;
    rows.forEach(function (r, k) { if (k === stuck.i) r.setAttribute('data-on', ''); else r.removeAttribute('data-on'); });
  }
  function stuckReduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function stuckRunning() { return stuck.seen && !document.hidden && !stuckReduced(); }
  function stuckStop() { if (stuck.timer) window.clearTimeout(stuck.timer); stuck.timer = 0; stuck.next = 0; }
  function stuckLoop() {
    if (stuck.timer) window.clearTimeout(stuck.timer);
    stuck.timer = 0;
    if (!stuckRunning()) { stuck.next = 0; return; }
    var now = performance.now();
    if (!stuck.next || stuck.next < now - 250) stuck.next = now + 1000;
    stuck.timer = window.setTimeout(function () {
      stuck.timer = 0;
      if (!stuckRunning()) { stuck.next = 0; return; }
      stuckShow(stuck.i + 1);
      stuck.next += 1000;
      stuckLoop();
    }, Math.max(0, stuck.next - now));
  }
  function initStuck() {
    var table = $('[data-stuck]');
    if (!table) return;
    stuckShow(0);
    if ('IntersectionObserver' in window) {
      stuck.seen = false;
      new IntersectionObserver(function (es) {
        var v = es[es.length - 1].isIntersecting;
        if (v === stuck.seen) return;
        stuck.seen = v;
        if (v) stuckLoop(); else stuckStop();
      }, { threshold: 0 }).observe(table);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stuckStop(); else stuckLoop(); });
    try {
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function (e) { if (e.matches) { stuckStop(); stuckShow(0); } else stuckLoop(); });
    } catch (e) {}
    stuckLoop();
  }
  // If the inline hero swap did not finish (it threw, or the hero embed failed), run it here,
  // then reorder the pains and lift the flash guard either way.
  function swap(hero) {
    var L = window.__lp2;
    if (hero && L) { try { L.applyHero(); L.done = true; } catch (e) {} }
    try { applyPains(); } catch (e) {}
    try { stuckShow(0); } catch (e) {}
    document.documentElement.classList.remove('lp-swap');
  }
  function heroPending() { return !(window.__lp2 && window.__lp2.done); }
  function start() {
    try { swap(heroPending()); } catch (e) {}
    try { initStuck(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
