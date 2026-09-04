/**
 * G2 proof Marquee — looping testimonial strip.
 *
 * @release v1.59.512
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. GSAP is assumed
 * as a page global — on the V3 site that is Webflow's native GSAP integration,
 * emitted at the end of the body. Because that copy lands after this file is
 * parsed, the GSAP check lives in the run step, not at parse time: a run with
 * no GSAP warns once and returns, and the next run (DOMContentLoaded, load,
 * resize, hover-capability change) arms the Marquee. If GSAP never arrives the
 * strip stays static with a single console warning.
 *
 * MARKUP (Designer-authored; classes are the contract):
 *   .card-marquee_layout      the section row group; hover/focus target
 *   .card-marquee-wrapper     one track; needs TWO .card-marquee_list children
 *   .card-marquee_list        one card segment; copies get data-marquee-list-clone
 * Copies are appended until the track spans layout width plus one segment,
 * capped at 24, so the faded edges never reveal the end of the strip.
 *
 * ATTRIBUTES:
 *   data-marquee-speed        on the wrapper, px/s, default 50
 *   data-marquee-forward      on the wrapper, force left-to-right start
 *   data-marquee-reverse      on the wrapper, force right-to-left start
 *   data-marquee-pause        on any ancestor, skip that wrapper entirely
 *   data-marquee-hover="off"  on the layout, no hover/focus slowdown
 *   data-marquee-hover-scale  on the layout, default 0.25 ("0" pauses, "1" no-op)
 *   data-marquee-fade="off"   CSS only; this script never reads it
 *
 * Without an override, tracks alternate direction by their index in the layout.
 * Pointer hover only slows on devices that can really hover; focus always does.
 * prefers-reduced-motion skips the whole animation.
 */
(function initCardMarqueeG2() {
  'use strict';

  // One instance per page: a second copy of the tag must not double-bind.
  if (window.__g2ProofMarqueeInited) return;
  window.__g2ProofMarqueeInited = true;

  var RELEASE = 'v1.59.512';
  // Set before anything can bail, so the running version is readable even
  // when GSAP never shows up.
  window.G2ProofMarquee = { release: RELEASE };

  var WRAPPER = '.card-marquee-wrapper';
  var LIST = '.card-marquee_list';
  var LAYOUT = '.card-marquee_layout';

  var CLONE_ATTR = 'data-marquee-list-clone';
  var MAX_LIST_COPIES = 24;
  var registry = [];
  var hoverAbort = null;
  /** True when this UA should get mouseenter/leave (not most phones). */
  var hoverMql =
    window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
  var mqlHandlerBound = false;
  /** The missing-GSAP warning is emitted at most once per page. */
  var gsapWarned = false;

  function warnMissingGsap() {
    if (gsapWarned) return;
    gsapWarned = true;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[g2-proof] GSAP not found; retrying on load/resize.');
    }
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
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

  function reverseIndexInLayout(wrapper) {
    var layout = wrapper.closest && wrapper.closest(LAYOUT);
    if (!layout) return 0;
    var rows = layout.querySelectorAll(WRAPPER);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] === wrapper) return i;
    }
    return 0;
  }

  function shouldReverse(wrapper) {
    if (wrapper.hasAttribute('data-marquee-forward')) return false;
    if (wrapper.hasAttribute('data-marquee-reverse')) return true;
    return reverseIndexInLayout(wrapper) % 2 === 1;
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

  /** Clones the first list until the track outruns the section mask (CSS embed). */
  function ensureTrackFillsLayout(wrapper, layout) {
    if (!layout) return;
    var lists;
    var first;
    var safety = 0;
    var layoutW = layout.getBoundingClientRect().width;
    if (layoutW < 1) return;
    while (safety < MAX_LIST_COPIES) {
      lists = wrapper.querySelectorAll(LIST);
      first = lists[0];
      if (!first) return;
      var segW = first.offsetWidth;
      if (segW < 1) return;
      var minTrack = layoutW + segW;
      if (wrapper.scrollWidth + 0.5 >= minTrack) break;
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
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[g2-proof] AbortController missing; hover slow disabled (use a current browser).',
        );
      }
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
      if (usePointer) {
        layout.addEventListener(
          'mouseenter',
          function () {
            setEntriesTimeScale(entries, scale);
          },
          { signal: sig, passive: true },
        );
        layout.addEventListener(
          'mouseleave',
          function () {
            setEntriesTimeScale(entries, 1);
          },
          { signal: sig, passive: true },
        );
      }
      layout.addEventListener(
        'focusin',
        function () {
          setEntriesTimeScale(entries, scale);
        },
        { signal: sig, passive: true },
      );
      layout.addEventListener(
        'focusout',
        function (e) {
          if (!e.relatedTarget || !layout.contains(e.relatedTarget)) {
            setEntriesTimeScale(entries, 1);
          }
        },
        { signal: sig, passive: true },
      );
    });
  }

  function killAll() {
    for (var i = 0; i < registry.length; i++) {
      if (registry[i] && registry[i].tween) registry[i].tween.kill();
      if (registry[i] && registry[i].ro) registry[i].ro.disconnect();
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
  }

  /** `gsap` is passed in, not read from window, so a rebuild uses the instance
   *  that was present when this run armed. */
  function buildForWrapper(wrapper, gsap) {
    if (isPausedContainer(wrapper)) return;

    removeListClones(wrapper);

    var layout = getMarqueeLayout(wrapper);
    if (layout) {
      ensureTrackFillsLayout(wrapper, layout);
    }

    var lists = wrapper.querySelectorAll(LIST);
    if (lists.length < 2) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[g2-proof] Each ' +
            WRAPPER +
            ' needs two ' +
            LIST +
            ' elements for a seamless loop.',
        );
      }
      return;
    }

    var first = lists[0];
    var segmentWidth = first.offsetWidth;
    if (segmentWidth < 1) return;

    var speed = parseSpeed(wrapper);
    var rev = shouldReverse(wrapper);
    var regEntry = { tween: null, ro: null, layout: layout };

    gsap.set(wrapper, { x: rev ? -segmentWidth : 0 });

    regEntry.tween = gsap.to(wrapper, {
      x: rev ? 0 : -segmentWidth,
      duration: segmentWidth / speed,
      ease: 'none',
      repeat: -1,
      immediateRender: false,
    });

    regEntry.ro = new ResizeObserver(function () {
      removeListClones(wrapper);
      var layoutNow = getMarqueeLayout(wrapper);
      if (layoutNow) {
        ensureTrackFillsLayout(wrapper, layoutNow);
      }
      var freshLists = wrapper.querySelectorAll(LIST);
      if (freshLists.length < 2) return;
      var w = freshLists[0].offsetWidth;
      if (w < 1) return;
      if (regEntry.tween) {
        regEntry.tween.pause();
        regEntry.tween.kill();
      }
      gsap.set(wrapper, { x: rev ? -w : 0 });
      regEntry.tween = gsap.to(wrapper, {
        x: rev ? 0 : -w,
        duration: w / speed,
        ease: 'none',
        repeat: -1,
        immediateRender: false,
      });
    });

    registry.push(regEntry);
    regEntry.ro.observe(first);
  }

  function run() {
    killAll();

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
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
    if (document.readyState === 'complete') {
      requestAnimationFrame(function () {
        requestAnimationFrame(run);
      });
    } else {
      window.addEventListener('load', function onLoad() {
        window.removeEventListener('load', onLoad);
        run();
      });
    }
    var resizeT;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(run, 120);
    });
    if (hoverMql && !mqlHandlerBound) {
      mqlHandlerBound = true;
      if (hoverMql.addEventListener) {
        hoverMql.addEventListener('change', function () {
          run();
        });
      } else if (hoverMql.addListener) {
        hoverMql.addListener(function () {
          run();
        });
      }
    }
  }

  init();
})();
