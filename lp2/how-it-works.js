/*
 * /lp2: How it works panels.
 *
 * The inline part of the lp2-app embed adds html.lp-how-coded before first paint when container query units
 * work. This file fills the three panels with their coded scenes (STAGES), adds a play / pause ring per panel
 * and steps through them: side by side (768 up) one panel plays at a time and the others dim; stacked (phones)
 * each plays when half of it is on screen; with reduced motion all rest on their final frame.
 * A reader's pause is kept through layout switches and scrolling.
 * If the markup does not match (card count, missing panel), the class is removed and the static panels stay.
 */
(function () {
  if (window.__lp2HowInit) return;
  window.__lp2HowInit = true;
  var d = document.documentElement;
  if (!d.classList.contains('lp-how-coded')) return;
  var STAGES = ["<div class=\"lp-hw p1\"><div class=\"sc\"><div class=\"blk\"><div class=\"in\"><span class=\"btn\"><b>Start your $1 trial</b><i><svg class=\"arrow\" viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M1 7h11M8 3l4 4-4 4\" stroke=\"currentColor\" stroke-width=\"1.600\"/></svg><svg class=\"check\" viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg></i></span><ul><li><svg viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg><span>Renews at $495/mo</span></li><li><svg viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg><span>Backed by the Starters guarantee</span></li><li><svg viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg><span>We’ll email you on day 5. Cancel anytime.</span></li></ul></div></div><div class=\"cur\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 2l14 11h-7l4 8-3 1.500-4-8-4 5z\" fill=\"#1e211e\" stroke=\"#fff\" stroke-width=\"1.500\" stroke-linejoin=\"round\"/></svg></div></div></div>", "<div class=\"lp-hw p2\"><div class=\"top\"></div><div class=\"ttl\"><b><em>All</em> Starters</b><small>Every vetted operator on the platform</small></div><div class=\"strip\"></div><div class=\"flt\"><div class=\"fh\"><b>Filters</b><span>Clear All</span></div><div class=\"lbl\"><span>Search</span></div><div class=\"inp\"><span>Search Starters Here..</span></div><div class=\"cat\"><span>Categories</span></div><div class=\"chips\"><span class=\"chip\">Marketing Strategy &amp; Brand (257)</span><span class=\"chip on\">Paid Media (215)</span><span class=\"chip\">Creative (194)</span><span class=\"chip\">AI &amp; Technology (115)</span><span class=\"chip\">Retention &amp; CRM (109)</span><span class=\"chip\">Content &amp; Organic (108)</span></div></div><div class=\"cards\"><div class=\"s \"><div class=\"ph\"><img src=\"https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6b093aacc9d571c17818e740_lp2-how-laura.webp\" loading=\"lazy\" decoding=\"async\" alt=\"\"><div class=\"vt\"><div class=\"vb\"><i><b><svg viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg></b></i><span>Verified Team</span></div></div><div class=\"rt\"><span>$4000/mo</span></div></div><div class=\"nm\"><b>Laura Carpenter</b><small>Paid Social Marketer</small></div></div><div class=\"swap\"><div class=\"s out\"><div class=\"ph\"><img src=\"https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6b093aacc9d571c17818e756_lp2-how-alex.webp\" loading=\"lazy\" decoding=\"async\" alt=\"\"><div class=\"vt\"><div class=\"vb\"><i><b><svg viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg></b></i><span>Verified Team</span></div></div><div class=\"rt\"><span>$4000/mo</span></div></div><div class=\"nm\"><b>Alex Miller</b><small>Head Of Growth</small></div></div><div class=\"s in\"><div class=\"ph\"><img src=\"https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6b093aad896439f9dacc418b_lp2-how-david.webp\" loading=\"lazy\" decoding=\"async\" alt=\"\"><div class=\"vt\"><div class=\"vb\"><i><b><svg viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg></b></i><span>Verified Team</span></div></div><div class=\"rt\"><span>$5000/mo</span></div></div><div class=\"nm\"><b>David Thomas</b><small>Paid Social Marketer</small></div></div></div></div><div class=\"cur\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 2l14 11h-7l4 8-3 1.500-4-8-4 5z\" fill=\"#1e211e\" stroke=\"#fff\" stroke-width=\"1.500\" stroke-linejoin=\"round\"/></svg></div></div>", "<div class=\"lp-hw p3\"><div class=\"sc\"><img class=\"pic\" src=\"https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6b093aade9e7fdd821c3b49d_lp2-how-zach.webp\" loading=\"lazy\" decoding=\"async\" alt=\"\"><h4>Zach<br>Greenberg</h4><div class=\"meta\">Perky Jerky 0→30K Stores<br>Free call · 30 minutes</div><div class=\"b b1\"><span>Book call</span></div><div class=\"b b2\"><span>Hire</span><svg viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M14 3.883 12.428 2.333 4.929 9.733 1.572 6.421 0 7.971l4.929 4.862L14 3.883Z\" fill=\"currentColor\"/></svg></div><div class=\"b b3\"><span>Message</span></div></div><div class=\"veil\"></div><div class=\"sc\"><div class=\"pop\"><div class=\"ph\"><b>Book a Call</b><svg viewBox=\"0 0 12 12\" fill=\"none\"><path d=\"M1.500 1.500l9 9M10.500 1.500l-9 9\" stroke=\"currentColor\" stroke-width=\"1.400\"/></svg></div><div class=\"pb\"><div class=\"hd\"><svg viewBox=\"0 0 36 36\" fill=\"none\"><path d=\"M7.96162 32.25C7.20387 32.25 6.5625 31.9875 6.0375 31.4625C5.5125 30.9375 5.25 30.2961 5.25 29.5384V9.46162C5.25 8.70387 5.5125 8.06249 6.0375 7.53749C6.5625 7.01249 7.20387 6.74999 7.96162 6.74999H10.0384V4.73062C10.0384 4.40187 10.1485 4.12737 10.3687 3.90712C10.589 3.68712 10.8635 3.57712 11.1922 3.57712C11.5212 3.57712 11.7958 3.68712 12.0158 3.90712C12.236 4.12737 12.3461 4.40187 12.3461 4.73062V6.74999H23.7116V4.70212C23.7116 4.38287 23.8192 4.11549 24.0345 3.89999C24.25 3.68474 24.5174 3.57712 24.8366 3.57712C25.1559 3.57712 25.4231 3.68474 25.6384 3.89999C25.8539 4.11549 25.9616 4.38287 25.9616 4.70212V6.74999H28.0384C28.7961 6.74999 29.4375 7.01249 29.9625 7.53749C30.4875 8.06249 30.75 8.70387 30.75 9.46162V19.1827C30.75 19.502 30.6422 19.7692 30.4267 19.9845C30.2115 20.2 29.9442 20.3077 29.625 20.3077C29.3057 20.3077 29.0385 20.2 28.8232 19.9845C28.6077 19.7692 28.5 19.502 28.5 19.1827V15.4616H7.5V29.5384C7.5 29.6539 7.54813 29.7596 7.64438 29.8556C7.74038 29.9519 7.84612 30 7.96162 30H17.1116C17.4309 30 17.6942 30.1077 17.9017 30.3232C18.1095 30.5385 18.2134 30.8057 18.2134 31.125C18.2134 31.4442 18.1057 31.7115 17.8905 31.9267C17.675 32.1422 17.4076 32.25 17.0884 32.25H7.96162ZM24.7444 29.8297L30.1845 24.3896C30.4077 24.1664 30.6689 24.0524 30.9679 24.0476C31.2669 24.0429 31.5327 24.1569 31.7655 24.3896C31.998 24.6221 32.1142 24.8894 32.1142 25.1914C32.1142 25.4934 31.998 25.7606 31.7655 25.9931L25.7164 32.0509C25.4451 32.3221 25.1249 32.4577 24.7556 32.4577C24.3864 32.4577 24.0662 32.3221 23.7952 32.0509L20.8384 29.1086C20.6059 28.8856 20.4896 28.6207 20.4896 28.314C20.4896 28.0072 20.6059 27.7375 20.8384 27.5047C21.0711 27.272 21.3385 27.1556 21.6405 27.1556C21.9422 27.1556 22.2095 27.272 22.4422 27.5047L24.7444 29.8297Z\" fill=\"currentColor\"/></svg><b>Call <em>Requested</em></b></div><p class=\"tx\">We’ll share your call request with Zach and reach out when it’s been confirmed, typically within 24 hours</p><div class=\"row\"><span>Free</span><small>30 minutes</small></div></div><div class=\"cl\"><span>Close</span></div></div><div class=\"cur\"><svg viewBox=\"0 0 24 24\"><path d=\"M5 2l14 11h-7l4 8-3 1.500-4-8-4 5z\" fill=\"#1e211e\" stroke=\"#fff\" stroke-width=\"1.500\" stroke-linejoin=\"round\"/></svg></div></div></div>"];
  function watch(el, on, off) {
    if (!('IntersectionObserver' in window)) { on(); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) on(); else off(); }); }, { rootMargin: '200px 0px' }).observe(el);
  }
  function stepper(list, st, btns, titles) {
    var cards = st.map(function (s) { return s.closest('.lp-app_card') || s.parentNode; });
    var n = st.length, END = 4000, inView = false, active = 0, userPaused = false, mode = '', raf = 0;
    var hasIO = 'IntersectionObserver' in window, S = [];
    for (var j = 0; j < n; j++) S.push({ s: 'idle', vis: 0, up: false, at: 0, wait: false });
    var stacked = matchMedia('(max-width: 47.9375rem)'), rm = matchMedia('(prefers-reduced-motion: reduce)');
    function anims(i) { try { return st[i].getAnimations({ subtree: true }); } catch (e) { return []; } }
    function clock(i) { var a = anims(i)[0]; return a ? (+a.currentTime || 0) : 0; }
    function hold(i, t) { anims(i).forEach(function (a) { try { a.pause(); a.currentTime = t; } catch (e) {} }); }
    function run(i, from) { anims(i).forEach(function (a) { try { if (from != null) a.currentTime = from; a.play(); } catch (e) {} }); }
    function begin(i) { S[i].s = 'playing'; S[i].up = false; run(i, 0); kick(); }
    function pause(i) { anims(i).forEach(function (a) { try { a.pause(); } catch (e) {} }); S[i].s = 'paused'; }
    function resume(i) { S[i].s = 'playing'; S[i].up = false; run(i, null); kick(); }
    function rest(i, done) { hold(i, done ? END : 0); S[i].s = done ? 'done' : 'idle'; S[i].up = false; }
    function held(i) { return S[i].up && S[i].s === 'paused'; }
    function dim(i, on) { if (on) cards[i].setAttribute('data-lp-dim', ''); else cards[i].removeAttribute('data-lp-dim'); }
    function go(k, play) {
      active = k;
      for (var i = 0; i < n; i++) {
        if (i === k) { dim(i, false); if (play) begin(i); else rest(i, false); }
        else { dim(i, true); rest(i, i < k); }
      }
    }
    function finish(i) { rest(i, true); if (mode === 'side' && i === active) go((i + 1) % n, inView); }
    function start() {
      mode = rm.matches ? 'rm' : stacked.matches ? 'stacked' : 'side'; userPaused = false;
      var k = -1;
      for (var i = 0; i < n; i++) { dim(i, false); if (held(i) && (k < 0 || S[i].at > S[k].at)) k = i; }
      if (mode === 'rm') { for (i = 0; i < n; i++) if (!held(i)) rest(i, true); }
      else if (mode === 'stacked') { for (i = 0; i < n; i++) { S[i].wait = k >= 0 && S[i].vis > 0; if (held(i)) continue; if (!hasIO) rest(i, true); else if (S[i].vis >= 0.49 && k < 0) begin(i); else rest(i, false); } }
      else if (k >= 0) { active = k; userPaused = true; for (i = 0; i < n; i++) { if (i === k) continue; dim(i, true); if (!held(i)) rest(i, i < k); } }
      else go(0, inView);
      render();
    }
    var VERB = { playing: 'Pause', paused: 'Play', idle: 'Play', done: 'Replay' };
    function render() {
      for (var i = 0; i < n; i++) {
        var b = btns[i], s = S[i].s, p = s === 'done' ? 1 : s === 'idle' ? 0 : Math.min(clock(i) / END, 1);
        if (b.getAttribute('data-state') !== s) { b.setAttribute('data-state', s); b.setAttribute('aria-label', (mode === 'rm' && s === 'done' ? 'Play' : VERB[s]) + ' animation: ' + titles[i]); }
        b.style.setProperty('--p', p.toFixed(4));
      }
    }
    function frame() {
      raf = 0;
      for (var i = 0; i < n; i++) if (S[i].s === 'playing' && clock(i) >= END) finish(i);
      render();
      if (S.some(function (x) { return x.s === 'playing'; })) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function toggle(i) {
      var s = S[i].s;
      if (mode === 'side') {
        userPaused = false;
        if (i !== active || s === 'idle' || s === 'done') go(i, true);
        else if (s === 'playing') { pause(i); S[i].up = true; S[i].at = Date.now(); userPaused = true; }
        else resume(i);
      } else {
        if (s === 'playing') { pause(i); S[i].up = true; S[i].at = Date.now(); } else if (s === 'paused') resume(i); else begin(i);
      }
      render();
    }
    function panel(i) {
      if (mode !== 'stacked') return;
      if (S[i].vis === 0) S[i].wait = false;
      if (S[i].vis >= 0.49) { if (S[i].s === 'idle' && !S[i].wait) { begin(i); render(); } }
      else if (S[i].vis === 0 && S[i].s !== 'idle' && !held(i)) { rest(i, false); render(); }
    }
    btns.forEach(function (b, i) { b.addEventListener('click', function () { toggle(i); }); });
    try { stacked.addEventListener('change', start); rm.addEventListener('change', start); } catch (e) {}
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    requestAnimationFrame(function () {
      start();
      watch(list, function () { if (inView) return; inView = true; if (mode === 'side' && !userPaused) { go(0, true); render(); } },
        function () { if (!inView) return; inView = false; if (mode === 'side' && !userPaused) { go(0, false); render(); } });
      if (hasIO) st.forEach(function (s, i) {
        new IntersectionObserver(function (es) { es.forEach(function (e) { S[i].vis = e.isIntersecting ? e.intersectionRatio : 0; panel(i); }); }, { threshold: [0, 0.5] }).observe(s);
      });
    });
  }
  function run() {
    var list = document.querySelector('[data-lp-page] .lp-app .lp-app_steps') || document.querySelector('.lp-app_steps');
    var cards = list ? Array.prototype.filter.call(list.children, function (c) { return c.classList.contains('lp-app_card'); }) : [];
    var panels = cards.map(function (c) { return c.querySelector('.lp-app_moment'); });
    if (!cards.length || cards.length !== STAGES.length || panels.some(function (p) { return !p; })) { d.classList.remove('lp-how-coded'); return; }
    var st = [], btns = [], titles = [], TONE = ['dark', 'dark', 'light'];
    var ICO = '<span class="lp-hwc_ico" aria-hidden="true"><svg class="pa" viewBox="0 0 16 16"><rect x="3.5" y="3" width="3" height="10" rx=".8" fill="currentColor"/><rect x="9.5" y="3" width="3" height="10" rx=".8" fill="currentColor"/></svg><svg class="pl" viewBox="0 0 16 16"><path d="M5 3.2 13 8l-8 4.8z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></span>';
    for (var i = 0; i < panels.length; i++) {
      panels[i].innerHTML = STAGES[i]; st.push(panels[i].firstChild);
      st[i].setAttribute('aria-hidden', 'true'); panels[i].removeAttribute('aria-hidden');
      var t = cards[i].querySelector('.lp-app_step'), b = document.createElement('button');
      titles.push(t ? t.textContent.replace(/\s+/g, ' ').trim() : 'step ' + (i + 1));
      b.type = 'button'; b.className = 'lp-hwc'; b.setAttribute('data-tone', TONE[i] || 'dark');
      b.innerHTML = '<span class="lp-hwc_v" aria-hidden="true"><svg class="lp-hwc_ring" viewBox="0 0 100 100"><circle class="lp-hwc_trk" cx="50" cy="50" r="45.833"/><circle class="lp-hwc_prg" cx="50" cy="50" r="45.833" pathLength="1"/></svg>' + ICO + '</span>';
      panels[i].appendChild(b); btns.push(b);
    }
    stepper(list, st, btns, titles);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
})();
