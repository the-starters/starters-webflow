/*
 * /lp2: "brands your size" section: revenue tabs, the sliding highlight, the mix bar odometer and the plan cards.
 *
 * Tabs follow the ARIA tabs pattern (arrow keys, Home, End). The highlight is a copy of the tab row clipped
 * to the selected tab, so the label colour change and the movement stay in step; on phones the row scrolls
 * and the clip follows it. Instant moves (first paint, keyboard, resize) skip the transition.
 * The four operator photos are fetched once the section is within 600px, so a tab change never shows
 * an empty circle while a photo loads.
 */
(function () {
  if (window.__lp2SizeInit) return;
  window.__lp2SizeInit = true;
  function $(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function $$(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  var CDN = 'https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/';
  var OPS = {
    brian: [CDN + '69f09703acb30ce3d6f00b8a_brian_1x-p-500.webp', 'Brian Chung', 'Performance · ARMRA, CORKCICLE'],
    liz: [CDN + '6b05ac89164cc22eb5fa2b98_lp2-av-liz-a.jpg', 'Liz Ahern', 'Ex CMO Chamberlain Coffee'],
    tim: [CDN + '6b05b4f0b26b4b3b89d90a60_lp2-av-tim.jpg', 'Tim Chard', 'Head of Growth · $100M+ in spend'],
    zach: [CDN + '6b05ac89eecbbcd37f7fee6c_lp2-av-zachary-g-1154.jpg', 'Zach Greenberg', 'Retail']
  };
  var LEARN = ['Read The DTC Go To Market Playbook', 'brian'];
  var SIZES = [
    { label: 'Under $1M', mix: [50, 40, 10], note: 'mostly learn what has worked for others, then pressure-test decisions on free calls before they spend.',
      plan: [LEARN, ['A free 30-minute call on your launch plan', 'brian'], ['A small paid social project when you’re ready', 'tim']] },
    { label: '$1M–$5M', mix: [25, 50, 25], note: 'spend most of their time on calls: a second opinion from someone who has already scaled past where you are.',
      plan: [LEARN, ['A strategy session on getting into retail', 'liz'], ['A paid social project to bring costs down', 'tim']] },
    { label: '$5M–$20M', mix: [10, 40, 50], note: 'hire most: senior operators for projects or fractional roles, without a recruiting fee.',
      plan: [LEARN, ['A session before your next retail push', 'liz'], ['A fractional head of paid growth', 'tim']] },
    { label: '$20M+', mix: [10, 25, 65], note: 'mostly hire: operators who have run the same playbook at a bigger brand, by the project or fractionally.',
      plan: [LEARN, ['A session on national retail rollout', 'liz'], ['Retail expansion with the operator behind Perky Jerky’s 30K stores', 'zach']] }
  ];
  var seg = $('[data-size-seg]'), ink = $('[data-size-ink]'), cur = 0;
  var tabRow = $('.lp-size_tabs[role="tablist"]');
  function isMobile() { try { return window.matchMedia('(max-width: 47.9375rem)').matches; } catch (e) { return false; } }
  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function syncInk() {
    if (!ink) return;
    ink.style.transform = isMobile() && tabRow ? 'translateX(' + (-tabRow.scrollLeft) + 'px)' : '';
  }
  function moveInk(i, instant) {
    cur = i;
    if (!seg || !ink) return;
    var b = document.getElementById('size-' + i), W = seg.offsetWidth, H = seg.offsetHeight;
    if (!b || !W || !H) return;
    var t = b.offsetTop / H * 100, l = b.offsetLeft / W * 100;
    var r = 100 - (b.offsetLeft + b.offsetWidth) / W * 100, bt = 100 - (b.offsetTop + b.offsetHeight) / H * 100;
    if (isMobile()) {
      var s = ink.children[i], IW = ink.offsetWidth, IH = ink.offsetHeight;
      if (!s || !IW || !IH) return;
      t = s.offsetTop / IH * 100; l = s.offsetLeft / IW * 100;
      r = 100 - (s.offsetLeft + s.offsetWidth) / IW * 100; bt = 100 - (s.offsetTop + s.offsetHeight) / IH * 100;
      syncInk();
    }
    if (instant) ink.style.transition = 'none';
    ink.style.clipPath = 'inset(' + t + '% ' + r + '% ' + bt + '% ' + l + '% round 62.5rem)';
    if (instant) { void ink.offsetWidth; ink.style.transition = ''; }
    seg.classList.add('is-ready');
  }
  function setText(root, sel, val) { var el = $(sel, root); if (el) el.textContent = val; }
  var EASE = (function (x1, y1, x2, y2) {
    function at(t, a, b) { return ((1 - 3 * b + 3 * a) * t * t * t) + ((3 * b - 6 * a) * t * t) + (3 * a * t); }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, t = x;
      for (var k = 0; k < 24; k++) { if (at(t, x1, x2) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return at(t, y1, y2);
    };
  })(0.77, 0, 0.175, 1);
  var rowAnim = 0, rowTouching = false;
  function stopRowAnim() { if (rowAnim) { cancelAnimationFrame(rowAnim); rowAnim = 0; } }
  function tabIntoView(i, instant) {
    var row = tabRow, b = document.getElementById('size-' + i);
    if (!row || !b || b.offsetParent !== row) return;
    var max = row.scrollWidth - row.clientWidth;
    stopRowAnim();
    if (max <= 1) return;
    var target = Math.max(0, Math.min(max, b.offsetLeft + b.offsetWidth / 2 - row.clientWidth / 2));
    var from = row.scrollLeft, dist = target - from;
    if (instant || reducedMotion() || Math.abs(dist) < 1) { row.scrollLeft = target; syncInk(); return; }
    var start = 0;
    function step(now) {
      if (!start) start = now;
      var p = Math.min(1, (now - start) / 400);
      row.scrollLeft = from + dist * EASE(p);
      syncInk();
      rowAnim = p < 1 ? requestAnimationFrame(step) : 0;
    }
    rowAnim = requestAnimationFrame(step);
  }
  function buildOdo() {
    $$('[data-mix] > [data-part]').forEach(function (part, k) {
      var el = $('[data-mix-pct]', part);
      if (!el || el.hasAttribute('data-odo-ready')) return;
      var cols = 1;
      SIZES.forEach(function (s) { if (s.mix[k] != null) cols = Math.max(cols, String(s.mix[k]).length); });
      var html = '<span data-odo-sr></span><span data-odo aria-hidden="true">';
      for (var c = cols - 1; c >= 0; c--) {
        html += '<span data-odo-col="' + c + '"><span data-odo-strip>';
        for (var n = 0; n < 10; n++) html += '<span>' + n + '</span>';
        html += '</span></span>';
      }
      html += '<span data-odo-unit>%</span></span>';
      el.innerHTML = html;
      el.setAttribute('data-odo-ready', '');
    });
  }
  function setPct(el, value) {
    if (!el) return;
    if (!el.hasAttribute('data-odo-ready')) { el.textContent = value + '%'; return; }
    var sr = $('[data-odo-sr]', el);
    if (sr) sr.textContent = value + '%';
    var digits = String(value);
    $$('[data-odo-col]', el).forEach(function (col) {
      var place = +col.getAttribute('data-odo-col'), used = place < digits.length;
      var d = used ? +digits.charAt(digits.length - 1 - place) : 0;
      var strip = col.firstChild;
      if (strip) strip.style.setProperty('--d', String(d));
    });
  }
  function showSize(i, instantAll) {
    var s = SIZES[i];
    if (!s) return;
    $$('.lp-size_tabs [role="tab"]').forEach(function (t) {
      var on = +t.getAttribute('data-size') === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    var mix = $('[data-mix]'), instant = !!instantAll || !!(mix && mix.hasAttribute('data-kbd'));
    moveInk(i, instant);
    tabIntoView(i, instant);
    $$('[data-mix] > [data-part]').forEach(function (part, k) {
      if (s.mix[k] == null) return;
      part.style.flexGrow = String(s.mix[k]);
      setPct($('[data-mix-pct]', part), s.mix[k]);
    });
    var panel = $('[data-plan]');
    if (panel) {
      panel.setAttribute('aria-labelledby', 'size-' + i);
      $$('.lp-size_card', panel).forEach(function (card, k) {
        var p = s.plan[k], op = p && OPS[p[1]];
        if (!p || !op) return;
        setText(card, '[data-title]', p[0]);
        var img = $('[data-img]', card);
        if (img) { img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.setAttribute('src', op[0]); }
        setText(card, '[data-name]', op[1]);
        setText(card, '[data-role]', op[2]);
      });
    }
    setText(document, '[data-size-note]', 'Brands at ' + s.label + ' ' + s.note + ' Example plan; availability varies.');
  }
  function initTabs() {
    var bar = $('[data-mix]');
    $$('.lp-size_tabs [role="tab"]').forEach(function (t) {
      t.addEventListener('pointerdown', function () { if (bar) bar.removeAttribute('data-kbd'); });
      t.addEventListener('click', function () { showSize(+t.getAttribute('data-size')); });
      t.addEventListener('keydown', function (e) {
        if (bar) bar.setAttribute('data-kbd', '');
        var c = +t.getAttribute('data-size');
        var n = { ArrowRight: (c + 1) % 4, ArrowLeft: (c + 3) % 4, Home: 0, End: 3 }[e.key];
        if (n == null) return;
        e.preventDefault();
        showSize(n);
        var next = document.getElementById('size-' + n);
        if (next) { try { next.focus({ preventScroll: true }); } catch (err) { next.focus(); } }
      });
    });
    var inkRaf = 0;
    window.addEventListener('resize', function () { if (inkRaf) return; inkRaf = requestAnimationFrame(function () { inkRaf = 0; moveInk(cur, true); syncInk(); }); });
    var row = tabRow, rowW = row ? row.clientWidth : 0;
    function onRowSize() { if (!row || rowTouching) return; var w = row.clientWidth; if (w !== rowW) { rowW = w; tabIntoView(cur, true); } }
    if (row && 'ResizeObserver' in window) new ResizeObserver(onRowSize).observe(row);
    else window.addEventListener('resize', onRowSize);
    if (row) {
      row.addEventListener('scroll', syncInk, { passive: true });
      row.addEventListener('touchstart', function () { rowTouching = true; stopRowAnim(); }, { passive: true });
      row.addEventListener('touchend', function () { rowTouching = false; }, { passive: true });
      row.addEventListener('touchcancel', function () { rowTouching = false; }, { passive: true });
      row.addEventListener('pointerdown', stopRowAnim, { passive: true });
      row.addEventListener('wheel', stopRowAnim, { passive: true });
    }
    try { buildOdo(); } catch (e) {}
    moveInk(0, true);
    showSize(0, true);
    if (bar) requestAnimationFrame(function () { requestAnimationFrame(function () { bar.setAttribute('data-anim', ''); }); });
  }
  // Fetch and decode the plan card photos before they are needed.
  function preloadPhotos() {
    var done = false, SRC = Object.keys(OPS).map(function (k) { return OPS[k][0]; });
    function load() { if (done) return; done = true; SRC.forEach(function (u) { var i = new Image(); i.decoding = 'async'; i.src = u; if (i.decode) i.decode().catch(function () {}); }); }
    var sec = $('[data-lp-page] .lp-size');
    if (!sec || !('IntersectionObserver' in window)) { load(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { load(); io.disconnect(); } }, { rootMargin: '600px 0px' });
    io.observe(sec);
  }
  function start() {
    try { initTabs(); } catch (e) {}
    try { preloadPhotos(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
