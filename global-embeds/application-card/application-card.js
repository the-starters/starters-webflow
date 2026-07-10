// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/application-card
(function () {
    'use strict';
    var uid = 0, deb = 100, tol = 1, dur = 0.32, ez = 'power2.out';
    var gs = typeof gsap !== 'undefined' ? gsap : null;
  
    function noTween() {
      return !gs || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function kill(e) { gs && gs.killTweensOf(e); }
    function clr(e) { gs ? gs.set(e, { clearProps: 'maxHeight' }) : e.style.removeProperty('max-height'); }
    function mh(e, v) {
      v === 'none' ? gs ? gs.set(e, { maxHeight: 'none' }) : (e.style.maxHeight = 'none') : gs ? gs.set(e, { maxHeight: v }) : (e.style.maxHeight = v + 'px');
    }
    function tw(el, fr, to, cb) {
      if (!gs || noTween()) return mh(el, typeof to === 'number' ? to : 'none'), void (cb && cb());
      gs.fromTo(el, { maxHeight: fr }, { maxHeight: to, duration: dur, ease: ez, immediateRender: false, overwrite: 'auto', onComplete: cb || function () {} });
    }
  
    function measure(w, inner) {
      kill(inner);
      w.classList.remove('is-expanded');
      clr(inner);
      inner.offsetHeight;
      var co = Math.ceil(inner.offsetHeight);
      w.classList.add('is-expanded');
      clr(inner);
      mh(inner, 'none');
      inner.offsetHeight;
      var ex = Math.ceil(inner.scrollHeight);
      w.classList.remove('is-expanded');
      kill(inner);
      clr(inner);
      inner.offsetHeight;
      return { co: co, ex: ex };
    }
  
    function bind(wrap) {
      var inner = wrap.querySelector('.application-card_message-content-wrapper'),
        btn = wrap.querySelector('.application-card_see-more'), lab = wrap.querySelector('.application-card_see-more-text'), ch,
        aria = function (on) {
          lab.textContent = on ? 'See less' : 'See more';
          btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        },
        doneOpen = function () { clr(inner); };
  
      function layout() {
        var open = wrap.classList.contains('is-expanded'), m = measure(wrap, inner);
        ch = m.co;
        if (m.ex <= m.co + tol) {
          wrap.classList.add('is-collapsed-only');
          kill(inner);
          clr(inner);
          wrap.classList.remove('is-expanded');
          aria(false);
          return;
        }
        wrap.classList.remove('is-collapsed-only');
        kill(inner);
        if (open) wrap.classList.add('is-expanded'), aria(true), doneOpen();
        else wrap.classList.remove('is-expanded'), aria(false), mh(inner, ch);
      }
      function expand() {
        if (wrap.classList.contains('is-expanded')) return;
        var fh = inner.offsetHeight;
        wrap.classList.add('is-expanded');
        inner.offsetHeight;
        var th = inner.scrollHeight;
        aria(true);
        if (noTween() || Math.abs(th - fh) < 1) return doneOpen();
        mh(inner, fh);
        inner.offsetHeight;
        tw(inner, fh, th, doneOpen);
      }
      function collapse() {
        if (!wrap.classList.contains('is-expanded')) return;
        aria(false);
        if (noTween()) return wrap.classList.remove('is-expanded'), void mh(inner, ch);
        kill(inner);
        var fh = inner.offsetHeight;
        mh(inner, fh);
        inner.offsetHeight;
        tw(inner, fh, ch, function () {
          wrap.classList.remove('is-expanded');
          mh(inner, ch);
        });
      }
  
      if (!inner || !btn || !lab) return null;
      inner.id || (inner.id = 'application-card-msg-' + ++uid);
      btn.setAttribute('aria-controls', inner.id);
      layout();
      if (wrap.classList.contains('is-collapsed-only')) return null;
      btn.addEventListener('click', function () {
        if (!wrap.classList.contains('is-collapsed-only'))
          (wrap.classList.contains('is-expanded') ? collapse : expand)();
      });
      return layout;
    }
  
    function boot() {
      !gs && console.warn('[application-card message] No GSAP — instant toggles only.');
      var relayout = [], t, f;
      document.querySelectorAll('.application-card_message-wrapper').forEach(function (w) {
        if (w.querySelector('.application-card_message-content-wrapper')) (f = bind(w)) && relayout.push(f);
      });
      window.addEventListener('resize', function () {
        clearTimeout(t);
        t = setTimeout(function () { relayout.forEach(function (fn) { fn(); }); }, deb);
      });
    }
  
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
  })();