// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/g2-proof
/**
 * G2 proof Marquee — looping testimonial strip.
 *
 * @release v1.59.526
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. GSAP is assumed
 * as a page global — on the V3 site that is Webflow's native GSAP integration,
 * emitted at the end of the body. Because that copy lands after this file is
 * parsed, the GSAP check lives in the run step, not at parse time: a run with
 * no GSAP warns once and returns, and the next run (DOMContentLoaded, load,
 * resize, hover-capability change) arms the Marquee. If GSAP never arrives the
 * strip stays static; the warning is staging-only per the README section
 * "Staging-only console diagnostics".
 *
 * MARKUP (Designer-authored; classes are the contract):
 *   .card-marquee_layout      the section row group; hover/focus target
 *   .card-marquee-wrapper     one track; needs TWO .card-marquee_list children
 *   .card-marquee_list        one card segment; copies get data-marquee-list-clone
 * Copies are appended until the track spans layout width plus one segment. The
 * cap of 24 copies is a safety stop: hitting it means the track is still short
 * of that width and its end can show, so a staging warning fires.
 *
 * ATTRIBUTES (read):
 *   data-marquee-speed        on the wrapper, px/s, default 50
 *   data-marquee-forward      on the wrapper, force left-to-right start
 *   data-marquee-reverse      on the wrapper, force right-to-left start
 *   data-marquee-pause        on any ancestor, skip that wrapper entirely
 *   data-marquee-hover="off"  on the layout, no hover/focus slowdown
 *   data-marquee-hover-scale  on the layout, default 0.25 ("0" pauses, "1" no-op)
 *   data-marquee-fade="off"   CSS only; this script never reads it
 *
 * ATTRIBUTES (written, output markers — never author them):
 *   data-marquee-list-clone   on each appended copy
 *   data-marquee-armed        on a wrapper whose tween is running
 * window.G2ProofMarquee.armed says the same thing for the page as a whole.
 *
 * Without an override, tracks alternate direction by their index in the layout.
 * Pointer hover only slows on devices that can really hover; focus always does.
 * prefers-reduced-motion skips the animation, and a change to that preference
 * is observed: turning it on tears the strips back down to static.
 * A window resize only rebuilds when a measured width actually moved.
 */
(function initCardMarqueeG2() {
  'use strict';

  // One instance per page: a second copy of the tag must not double-bind.
  if (window.__g2ProofMarqueeInited) return;
  window.__g2ProofMarqueeInited = true;

  var RELEASE = 'v1.59.526';
  // Set before anything can bail, so the running version is readable even
  // when GSAP never shows up. `armed` flips only once tweens exist.
  window.G2ProofMarquee = { release: RELEASE, armed: false };

  var WRAPPER = '.card-marquee-wrapper';
  var LIST = '.card-marquee_list';
  var LAYOUT = '.card-marquee_layout';

  var CLONE_ATTR = 'data-marquee-list-clone';
  var ARMED_ATTR = 'data-marquee-armed';
  var MAX_LIST_COPIES = 24;
  var registry = [];
  var hoverAbort = null;
  /** layout -> the timeScale hover or focus is holding it at right now, so a
   *  rebuild under a stationary pointer does not shed the slowdown. */
  var activeScale = new Map();
  /** The missing-GSAP warning is emitted at most once per page. */
  var gsapWarned = false;

  /** An unsupported query throws in older Safari; a null mql just means off. */
  function mediaQuery(query) {
    try {
      return (window.matchMedia && window.matchMedia(query)) || null;
    } catch (e) {
      return null;
    }
  }

  /** True when this UA should get mouseenter/leave (not most phones). */
  var hoverMql = mediaQuery('(hover: hover) and (pointer: fine)');
  var reducedMql = mediaQuery('(prefers-reduced-motion: reduce)');

  /** Host patterns are anchored, so `notwebflow.io` is not staging. */
  function isDevHost() {
    try {
      if (window.STARTERS_DEBUG === true) return true;
      var h = (location && location.hostname) || '';
      return (
        h === 'localhost' ||
        h === '127.0.0.1' ||
        /(^|\.)webflow\.io$/.test(h) ||
        /(^|\.)trycloudflare\.com$/.test(h)
      );
    } catch (e) {
      return false;
    }
  }

  function warn() {
    if (!isDevHost()) return;
    try {
      console.warn.apply(console, ['[g2-proof]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* no-op */
    }
  }

  function warnMissingGsap() {
    // The host check comes first: a silent production run must not latch the
    // flag, or STARTERS_DEBUG switched on afterwards could never surface it.
    if (!isDevHost()) return;
    if (gsapWarned) return;
    gsapWarned = true;
    warn('GSAP not found; retrying on the next run (load/resize/hover change).');
  }

  function prefersReducedMotion() {
    try {
      return !!(reducedMql && reducedMql.matches);
    } catch (e) {
      return false;
    }
  }

  function parseSpeed(el) {
    var v = el.getAttribute('data-marquee-speed');
    if (v == null || v === '') return 50;
    var n = parseFloat(String(v).trim());
    return isNaN(n) || n <= 0 ? 50 : n;
  }

  function parseHoverScale(layout) {
    if (!layout) return 0.25;
    if (layout.getAttribute('data-marquee-hover') === 'off') return null;
    var v = layout.getAttribute('data-marquee-hover-scale');
    if (v == null || v === '') return 0.25;
    var n = parseFloat(String(v).trim());
    if (isNaN(n) || n < 0) return 0.25;
    return n;
  }

  function reverseIndexInLayout(wrapper, layout) {
    if (!layout) return 0;
    var rows = layout.querySelectorAll(WRAPPER);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === wrapper) return i;
    }
    return 0;
  }

  function shouldReverse(wrapper, layout) {
    if (wrapper.hasAttribute('data-marquee-forward')) return false;
    if (wrapper.hasAttribute('data-marquee-reverse')) return true;
    return reverseIndexInLayout(wrapper, layout) % 2 === 1;
  }

  function isPausedContainer(el) {
    return el.closest && el.closest('[data-marquee-pause]');
  }

  function removeListClones(wrapper) {
    var extra = wrapper.querySelectorAll(LIST + '[' + CLONE_ATTR + ']');
    for (var i = 0; i < extra.length; i++) {
      if (extra[i].parentNode) extra[i].parentNode.removeChild(extra[i]);
    }
  }

  function getMarqueeLayout(wrapper) {
    return (wrapper.closest && wrapper.closest(LAYOUT)) || null;
  }

  function layoutWidthOf(layout) {
    return layout ? layout.getBoundingClientRect().width : 0;
  }

  /** Clones the first list until the track outruns the section mask (CSS embed).
   *  Returns true when the copy cap stopped it short of that width. */
  function ensureTrackFillsLayout(wrapper, layout) {
    if (!layout) return false;
    var safety = 0;
    var layoutW = layoutWidthOf(layout);
    if (layoutW < 1) return false;
    while (true) {
      var first = wrapper.querySelectorAll(LIST)[0];
      if (!first) return false;
      var segW = first.offsetWidth;
      if (segW < 1) return false;
      if (wrapper.scrollWidth + 0.5 >= layoutW + segW) return false;
      if (safety >= MAX_LIST_COPIES) return true;
      var c = first.cloneNode(true);
      c.setAttribute(CLONE_ATTR, '');
      wrapper.appendChild(c);
      safety++;
    }
  }

  function setEntriesTimeScale(entries, t) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].tween) {
        try {
          entries[i].tween.timeScale(t);
        } catch (e) {
          /* no-op */
        }
      }
    }
  }

  /** Per-layout timeScale: mouse only on real-hover devices, focus always. */
  function wireLayoutHover() {
    if (typeof AbortController === 'undefined') {
      warn('AbortController missing; hover slow disabled (use a current browser).');
      return;
    }
    if (hoverAbort) {
      try {
        hoverAbort.abort();
      } catch (e) {
        /* no-op */
      }
    }
    hoverAbort = new AbortController();
    var sig = hoverAbort.signal;
    var map = new Map();
    var j;
    for (j = 0; j < registry.length; j++) {
      var re = registry[j];
      if (!re.layout) continue;
      if (!map.has(re.layout)) {
        map.set(re.layout, []);
      }
      map.get(re.layout).push(re);
    }
    var usePointer = hoverMql && hoverMql.matches;
    map.forEach(function (entries, layout) {
      var scale = parseHoverScale(layout);
      if (scale === null) return;
      // The map is what a rebuild reads back, so it is written here, not there.
      function slow() {
        activeScale.set(layout, scale);
        setEntriesTimeScale(entries, scale);
      }
      function restore() {
        activeScale['delete'](layout);
        setEntriesTimeScale(entries, 1);
      }
      if (usePointer) {
        layout.addEventListener('mouseenter', slow, { signal: sig, passive: true });
        layout.addEventListener('mouseleave', restore, { signal: sig, passive: true });
      }
      layout.addEventListener('focusin', slow, { signal: sig, passive: true });
      layout.addEventListener(
        'focusout',
        function (e) {
          if (!e.relatedTarget || !layout.contains(e.relatedTarget)) restore();
        },
        { signal: sig, passive: true },
      );
    });
  }

  /** A hover or reduced-motion capability change invalidates any held scale:
   *  the listener that would restore it may not exist after the change. */
  function releaseHoverHold() {
    activeScale.clear();
    setEntriesTimeScale(registry, 1);
  }

  /** Arms (or re-arms) one track from the DOM as it measures right now.
   *  Returns false when it cannot loop: fewer than two lists, or nothing
   *  measurable yet. The caller decides whether that deserves a warning. */
  function armEntry(entry) {
    var wrapper = entry.wrapper;
    // Measure before mutating: an unmeasurable track keeps its clones and tween.
    var firstList = wrapper.querySelectorAll(LIST)[0];
    if (!firstList || firstList.offsetWidth < 1) return false;
    if (entry.layout && layoutWidthOf(entry.layout) < 1) return false;

    removeListClones(wrapper);
    var capped = ensureTrackFillsLayout(wrapper, entry.layout);

    var lists = wrapper.querySelectorAll(LIST);
    if (lists.length < 2) return false;

    var segW = lists[0].offsetWidth;
    if (segW < 1) return false;

    if (capped && !entry.capWarned) {
      entry.capWarned = true;
      warn('Clone cap reached; track may show its end (check the section CSS).');
    }

    if (entry.tween) {
      entry.tween.pause();
      entry.tween.kill();
    }

    entry.gsap.set(wrapper, { x: entry.rev ? -segW : 0 });
    entry.tween = entry.gsap.to(wrapper, {
      x: entry.rev ? 0 : -segW,
      duration: segW / entry.speed,
      ease: 'none',
      repeat: -1,
      immediateRender: false,
    });
    entry.segW = segW;
    entry.layoutW = layoutWidthOf(entry.layout);

    var held = activeScale.get(entry.layout);
    if (held != null) {
      try {
        entry.tween.timeScale(held);
      } catch (e) {
        /* no-op */
      }
    }
    wrapper.setAttribute(ARMED_ATTR, '');
    return true;
  }

  /** True when this track measures differently than it did when it armed. */
  function entryWidthChanged(entry) {
    var lists = entry.wrapper.querySelectorAll(LIST);
    if (!lists.length) return false;
    return (
      lists[0].offsetWidth !== entry.segW ||
      layoutWidthOf(entry.layout) !== entry.layoutW
    );
  }

  /** `gsap` is passed in, not read from window, so a rebuild uses the instance
   *  that was present when this run armed. */
  function buildForWrapper(wrapper, gsap) {
    if (isPausedContainer(wrapper)) return;

    var layout = getMarqueeLayout(wrapper);
    var entry = {
      wrapper: wrapper,
      layout: layout,
      gsap: gsap,
      tween: null,
      ro: null,
      segW: 0,
      layoutW: 0,
      rev: shouldReverse(wrapper, layout),
      speed: parseSpeed(wrapper),
      capWarned: false,
    };

    if (!armEntry(entry)) {
      if (wrapper.querySelectorAll(LIST).length < 2) {
        warn(
          'Each ' + WRAPPER + ' needs two ' + LIST + ' elements for a seamless loop.',
        );
      }
      return;
    }

    // Registered before the observer, so nothing can leave an armed tween that
    // teardown does not know about.
    registry.push(entry);

    if (typeof ResizeObserver === 'function') {
      entry.ro = new ResizeObserver(function () {
        // A real observer delivers one observation straight after observe();
        // only a segment width that moved is worth restarting the track. The
        // layout's own width is the resize handler's job, so one resize = one restart.
        var first = wrapper.querySelectorAll(LIST)[0];
        if (!first || first.offsetWidth === entry.segW) return;
        armEntry(entry);
      });
      entry.ro.observe(wrapper.querySelectorAll(LIST)[0]);
    }
  }

  /** Back to the authored, static strip: no tweens, no clones, no inline
   *  transform left frozen mid-loop, and no stale armed markers. */
  function teardown() {
    for (var i = 0; i < registry.length; i++) {
      var entry = registry[i];
      if (!entry) continue;
      if (entry.tween) entry.tween.kill();
      if (entry.ro) entry.ro.disconnect();
      try {
        entry.gsap.set(entry.wrapper, { clearProps: 'transform' });
      } catch (e) {
        /* no-op */
      }
      removeListClones(entry.wrapper);
      entry.wrapper.removeAttribute(ARMED_ATTR);
    }
    registry = [];
    if (hoverAbort) {
      try {
        hoverAbort.abort();
      } catch (e) {
        /* no-op */
      }
      hoverAbort = null;
    }
    window.G2ProofMarquee.armed = false;
  }

  function run() {
    teardown();

    // The guard sits ahead of every DOM mutation: no GSAP means no clones and
    // no tweens, only the one warning, and the next run tries again.
    var gsap = window.gsap;
    if (!gsap) {
      warnMissingGsap();
      return;
    }

    if (prefersReducedMotion()) return;

    var nodes = document.querySelectorAll(WRAPPER);
    for (var i = 0; i < nodes.length; i++) {
      buildForWrapper(nodes[i], gsap);
    }
    wireLayoutHover();
    window.G2ProofMarquee.armed = registry.length > 0;
  }

  /** The late-GSAP hooks exist only to catch a page that armed nothing. */
  function retry() {
    if (registry.length) return;
    run();
  }

  /** iOS collapsing its URL bar fires resize with every width unchanged, and a
   *  restart from x=0 is visible, so measure before rebuilding. */
  function rebuildIfChanged() {
    if (!registry.length) {
      run();
      return;
    }
    for (var i = 0; i < registry.length; i++) {
      if (entryWidthChanged(registry[i])) {
        run();
        return;
      }
    }
  }

  /** Safari before 14 only has the deprecated addListener. */
  function onMediaChange(mql, fn) {
    if (!mql) return;
    if (mql.addEventListener) mql.addEventListener('change', fn);
    else if (mql.addListener) mql.addListener(fn);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', retry);
    } else {
      run();
    }
    if (document.readyState === 'complete') {
      requestAnimationFrame(function () {
        requestAnimationFrame(retry);
      });
    } else {
      window.addEventListener('load', function onLoad() {
        window.removeEventListener('load', onLoad);
        retry();
      });
    }
    var resizeT;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(rebuildIfChanged, 120);
    });
    onMediaChange(hoverMql, function () {
      // Only the listeners are capability-dependent; the tweens are not.
      releaseHoverHold();
      if (registry.length) wireLayoutHover();
      else run();
    });
    onMediaChange(reducedMql, function () {
      releaseHoverHold();
      run();
    });
  }

  init();
})();
