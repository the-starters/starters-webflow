/*
 * /lp2: membership section Monthly / Yearly toggle.
 *
 * Memberstack owns the plan switch (data-join-membership-selected-plan); this file follows it to update
 * the price line, swap "monthly" for "yearly" in the heading while keeping the monthly line breaks, and
 * slide the toggle highlight. Plan tabs are links, so their default navigation is cancelled and Space activates them.
 */
(function () {
  if (window.__lp2MembershipInit) return;
  window.__lp2MembershipInit = true;
  function $(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function $$(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function memPriceLine() {
    var sec = $('.lp-mem[data-join-membership]'), line = sec ? $('[data-lp-mem-then]', sec) : null;
    if (sec) $$('[data-join-membership-plan]', sec).forEach(function (tab) {
      tab.addEventListener('click', function (e) { e.preventDefault(); });
      tab.addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); tab.click(); } });
    });
    if (!line) return;
    var MONTHLY = 'then $495/mo · cancel anytime', YEARLY = 'then $3,540/yr ($295/mo - 40% off) · cancel anytime';
    function yearly() { return sec.getAttribute('data-join-membership-selected-plan') === 'yearly'; }
    function current() { return yearly() ? YEARLY : MONTHLY; }
    var h2 = $('.lp-mem_inner h2', sec), em = h2 ? $('em', h2) : null, word = null;
    if (em && /^monthly(\s|$)/.test(em.textContent)) {
      var rest = em.textContent.slice(7);
      word = document.createElement('span');
      word.textContent = 'monthly';
      em.textContent = '';
      em.appendChild(word);
      em.appendChild(document.createTextNode(rest));
    }
    var breaks = null;
    function words(measure) {
      var out = [], tw = document.createTreeWalker(h2, NodeFilter.SHOW_TEXT), r = measure ? document.createRange() : null, n, re, m, b, k = 0;
      while ((n = tw.nextNode())) {
        re = /\S+/g;
        while ((m = re.exec(n.data))) {
          if (!measure) out.push({ node: n, at: m.index, k: k });
          else { r.setStart(n, m.index); r.setEnd(n, m.index + 1); b = r.getClientRects()[0]; if (b) out.push({ node: n, at: m.index, top: b.top, k: k }); }
          k++;
        }
      }
      return out;
    }
    function lineStarts(list) { var k = []; for (var i = 1; i < list.length; i++) if (list[i].top > list[i - 1].top + 1) k.push(i); return k; }
    function clearBreaks() { $$('br[data-lp-mem-br]', h2).forEach(function (br) { br.parentNode.removeChild(br); }); h2.normalize(); }
    function measureBreaks() {
      if (!word) return;
      clearBreaks();
      word.textContent = 'monthly';
      var want = lineStarts(words(true));
      word.textContent = 'yearly';
      var now = words(true), have = lineStarts(now);
      breaks = want.filter(function (i) { return now[i] && have.indexOf(i) < 0; }).map(function (i) { return now[i].k; });
      setWord();
    }
    function setWord() {
      if (!word) return;
      clearBreaks();
      word.textContent = yearly() ? 'yearly' : 'monthly';
      if (!yearly() || !breaks) return;
      var ws = words(false);
      breaks.slice().sort(function (a, b) { return b - a; }).forEach(function (k) {
        var w = ws[k];
        if (!w) return;
        var at = w.at ? w.node.splitText(w.at) : w.node, br = document.createElement('br');
        br.setAttribute('data-lp-mem-br', '');
        at.parentNode.insertBefore(br, at);
      });
    }
    var toggle = $('.lp-mem_toggle', sec), memTabs = toggle ? $$('[data-join-membership-plan]', toggle) : [], ink = null;
    if (toggle && memTabs.length > 1) {
      ink = document.createElement('div');
      ink.setAttribute('data-lp-mem-ink', '');
      ink.setAttribute('aria-hidden', 'true');
      memTabs.forEach(function (t) { var s = document.createElement('span'); s.textContent = (t.textContent || '').trim(); ink.appendChild(s); });
      toggle.appendChild(ink);
      toggle.addEventListener('keydown', function () { ink.setAttribute('data-kbd', ''); });
      toggle.addEventListener('pointerdown', function () { ink.removeAttribute('data-kbd'); });
    }
    function boxIn(el, base) {
      var r = el.getBoundingClientRect(), sx = 1, sy = 1;
      try { var m = new DOMMatrixReadOnly(getComputedStyle(el).transform); sx = m.a || 1; sy = m.d || 1; } catch (e) {}
      var w = r.width / sx, h = r.height / sy;
      return [r.left - (w - r.width) / 2 - base.left, r.top - (h - r.height) / 2 - base.top, w, h];
    }
    var clips = null;
    function measureInk() {
      var base = ink.getBoundingClientRect(), W = base.width, H = base.height, c = {};
      if (!W || !H) return;
      memTabs.forEach(function (t, k) {
        var b = boxIn(t, base), s = ink.children[k];
        if (!b || !s) return;
        var l = b[0] / W * 100, tp = b[1] / H * 100, w = b[2] / W * 100, h = b[3] / H * 100;
        s.style.left = l + '%'; s.style.top = tp + '%'; s.style.width = w + '%'; s.style.height = h + '%';
        c[t.getAttribute('data-join-membership-plan')] = 'inset(' + tp + '% ' + (100 - l - w) + '% ' + (100 - tp - h) + '% ' + l + '% round 62.5rem)';
      });
      clips = c;
    }
    function moveMemInk(instant, remeasure) {
      if (!ink) return;
      if (remeasure || !clips) measureInk();
      var clip = clips && clips[yearly() ? 'yearly' : 'monthly'];
      if (!clip) return;
      if (instant) ink.style.transition = 'none';
      ink.style.clipPath = clip;
      if (instant) { void ink.offsetWidth; ink.style.transition = ''; }
      toggle.setAttribute('data-ink-ready', '');
    }
    function update() { line.textContent = current(); try { setWord(); } catch (e) {} try { moveMemInk(false); } catch (e) {} }
    new MutationObserver(update).observe(sec, { attributes: true, attributeFilter: ['data-join-membership-selected-plan'] });
    var lastW = window.innerWidth;
    var memRaf = 0;
    window.addEventListener('resize', function () {
      if (memRaf) return;
      memRaf = requestAnimationFrame(function () { memRaf = 0; if (window.innerWidth !== lastW) { lastW = window.innerWidth; try { measureBreaks(); } catch (e) {} } try { moveMemInk(true, true); } catch (e) {} });
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { try { measureBreaks(); moveMemInk(true, true); } catch (e) {} });
    try { measureBreaks(); } catch (e) {}
    update();
    if (ink) requestAnimationFrame(function () { requestAnimationFrame(function () { ink.setAttribute('data-anim', ''); }); });
  }
  function start() {
    try { memPriceLine(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
