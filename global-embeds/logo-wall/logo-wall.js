// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/logo-wall
/**
 * Logo Wall — attribute-driven looping tracks of CMS logos.
 *
 * @release v1.59.234
 *
 * Raw JS (CDN-served, no HTML wrapper tags). Load with defer. GSAP is assumed
 * as a page global (already on the V3 site). Without GSAP the tracks still
 * build; they just do not loop.
 *
 * MARKUP (Designer-authored; classes are style-only):
 *   [data-logo-wall-element="wrapper"]   overflow root; holds optional config
 *   [data-logo-wall-element="item"]      each logo cell (inner CMS child)
 *   [data-logo-wall-element="track"]     written by this script, never authored
 *
 * Config on the wrapper (all optional):
 *   data-logo-wall-tracks            default 3
 *   data-logo-wall-speed             default 0.4 (~40px/s; GSAP horizontalLoop units)
 *   data-logo-wall-pause-on-hover    default on; "false" opts out
 *
 * THE CONTAINER IS THE MASK. The wrapper itself is the overflow-hidden clip,
 * at whatever width the Designer gives it. This script never measures the
 * viewport, never sizes the wrapper, and never touches an ancestor's styles —
 * full-bleed is a Designer layout choice (make the section full-width), not
 * script behaviour.
 *
 * Unique logos are dealt round-robin across Tracks. Each Track clones its own
 * items on both sides until it overflows the wrapper (including reduced-motion
 * freeze), so the unique set starts centered. Then GSAP's horizontalLoop helper
 * seamless-loops them. Even Tracks run LTR (logos travel toward the right);
 * odd Tracks run RTL.
 * Hover pauses that Track. Off-screen wrappers pause. prefers-reduced-motion
 * freezes the bands.
 *
 * SELF-DEFENSE: the companion stylesheet (logo-wall.css) is required. If a
 * Track does not compute as a flex row, the stylesheet did not load. The
 * original logos are left in place and visible but UNSTYLED — without the Track
 * rule that is typically a vertical stack, not a row — with no clones and no
 * animation, plus one dev-gated warning. The check re-runs on every re-arm as
 * defense in depth; it is not a recovery path, since under the documented
 * deploy (stylesheet <link> in Head, script deferred) a failed stylesheet has
 * already resolved before this script runs and is never retried.
 */
(function () {
  if (window.__startersLogoWallInit) return;
  window.__startersLogoWallInit = true;

  var RELEASE = 'v1.59.234';
  window.__startersLogoWall = { release: RELEASE };

  var WRAPPER_SEL = '[data-logo-wall-element="wrapper"]';
  var ITEM_SEL = '[data-logo-wall-element="item"]';
  var INIT_ATTR = 'data-logo-wall-inited';
  var CLONE_ATTR = 'data-logo-wall-clone';
  var DEFAULT_TRACKS = 3;
  var DEFAULT_SPEED = 0.4;
  var FILL_TIMES = 2;
  var MAX_CLONES = 24;
  var RESIZE_MS = 150;

  function isDevHost() {
    try {
      if (window.STARTERS_DEBUG === true) return true;
      var h = (location && location.hostname) || '';
      return (
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h.endsWith('webflow.io') ||
        h.endsWith('trycloudflare.com')
      );
    } catch (e) {
      return false;
    }
  }

  function devWarn() {
    if (!isDevHost()) return;
    try {
      console.warn.apply(console, ['[logo-wall]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* no-op */
    }
  }

  function isDesignMode() {
    return document.documentElement.classList.contains('wf-design-mode');
  }

  function isAttrFalse(value) {
    return typeof value === 'string' && value.toLowerCase() === 'false';
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function parseTracks(value) {
    var n = parseInt(value, 10);
    if (!isFinite(n) || n < 1) return DEFAULT_TRACKS;
    return n;
  }

  function parseSpeed(value) {
    if (value == null || value === '') return DEFAULT_SPEED;
    var n = parseFloat(value);
    if (!isFinite(n) || n <= 0) return DEFAULT_SPEED;
    return n;
  }

  function isContentsHelper(el) {
    if (!el || !el.classList) return false;
    var contents =
      el.classList.contains('u-display-contents') ||
      el.classList.contains('display-contents');
    if (!contents) return false;
    return (
      !el.classList.contains('w-dyn-list') &&
      !el.classList.contains('w-dyn-items') &&
      !el.classList.contains('w-dyn-item')
    );
  }

  function flattenDisplayContents(slot) {
    if (!slot) return;
    var child = slot.firstElementChild;
    while (child && isContentsHelper(child)) {
      while (child.firstChild) slot.insertBefore(child.firstChild, child);
      slot.removeChild(child);
      child = slot.firstElementChild;
    }
  }

  function removeCMSList(slot) {
    var dynList = Array.prototype.find.call(slot.children, function (child) {
      return child.classList.contains('w-dyn-list');
    });
    if (!dynList) return;
    var itemsRoot = dynList.querySelector('.w-dyn-items');
    if (!itemsRoot) return;
    var nestedItems = itemsRoot.children;
    if (!nestedItems || !nestedItems.length) return;
    var staticWrapper = Array.prototype.slice.call(slot.children);
    Array.prototype.forEach.call(nestedItems, function (el) {
      var c = Array.prototype.find.call(el.children, function (child) {
        return !child.classList.contains('w-condition-invisible');
      });
      if (c) slot.appendChild(c);
    });
    staticWrapper.forEach(function (el) {
      el.remove();
    });
  }

  function whenImagesReady(root, done) {
    var imgs = root.querySelectorAll('img');
    var pending = 0;
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      done();
    }

    function onOne() {
      pending -= 1;
      if (pending <= 0) finish();
    }

    Array.prototype.forEach.call(imgs, function (img) {
      if (img.complete) return;
      pending += 1;
      img.addEventListener('load', onOne, { once: true });
      img.addEventListener('error', onOne, { once: true });
    });

    if (pending === 0) finish();
  }

  function columnGapPx(el) {
    var gap = parseFloat(window.getComputedStyle(el).columnGap);
    return isFinite(gap) ? gap : 0;
  }

  function removeClones(track) {
    Array.prototype.slice.call(track.children).forEach(function (child) {
      if (child.hasAttribute(CLONE_ATTR)) child.remove();
    });
  }

  function cloneItem(item) {
    var clone = item.cloneNode(true);
    clone.removeAttribute('data-logo-wall-element');
    clone.setAttribute(CLONE_ATTR, '');
    Array.prototype.forEach.call(clone.querySelectorAll('img'), function (img) {
      img.loading = 'eager';
    });
    return clone;
  }

  function appendCloneSet(track, originals) {
    originals.forEach(function (item) {
      track.appendChild(cloneItem(item));
    });
  }

  function prependCloneSet(track, originals) {
    var first = originals[0];
    originals.forEach(function (item) {
      track.insertBefore(cloneItem(item), first);
    });
  }

  /** `wrapW` is measured once per arm by armLoops — never re-read here. */
  function fillTrack(track, originals, wrapW) {
    removeClones(track);
    if (!originals.length) return;
    var copies = 0;
    while (track.scrollWidth < wrapW * FILL_TIMES && copies < MAX_CLONES) {
      appendCloneSet(track, originals);
      copies += 1;
      if (track.scrollWidth <= 0) break;
    }
    var i;
    for (i = 0; i < copies; i++) prependCloneSet(track, originals);
  }

  /**
   * Official GSAP helper: seamless x-axis loop.
   * https://gsap.com/docs/v3/HelperFunctions/helpers/seamlessLoop
   */
  function horizontalLoop(items, config) {
    var gsap = window.gsap;
    items = gsap.utils.toArray(items);
    config = config || {};
    var tl = gsap.timeline({
      repeat: config.repeat,
      paused: config.paused,
      defaults: { ease: 'none' },
      onReverseComplete: function onReverseComplete() {
        tl.totalTime(tl.rawTime() + tl.duration() * 100);
      },
    });
    var length = items.length;
    var startX = items[0].offsetLeft;
    var times = [];
    var widths = [];
    var xPercents = [];
    var curIndex = 0;
    var pixelsPerSecond = (config.speed || 1) * 100;
    var snap =
      config.snap === false
        ? function (v) {
            return v;
          }
        : gsap.utils.snap(config.snap || 1);
    var totalWidth;
    var curX;
    var distanceToStart;
    var distanceToLoop;
    var item;
    var i;

    gsap.set(items, {
      xPercent: function setXPercent(idx, el) {
        var w = (widths[idx] = parseFloat(gsap.getProperty(el, 'width', 'px')));
        xPercents[idx] = snap(
          (parseFloat(gsap.getProperty(el, 'x', 'px')) / w) * 100 +
            gsap.getProperty(el, 'xPercent')
        );
        return xPercents[idx];
      },
    });
    gsap.set(items, { x: 0 });
    totalWidth =
      items[length - 1].offsetLeft +
      (xPercents[length - 1] / 100) * widths[length - 1] -
      startX +
      items[length - 1].offsetWidth * gsap.getProperty(items[length - 1], 'scaleX') +
      (parseFloat(config.paddingRight) || 0);

    for (i = 0; i < length; i++) {
      item = items[i];
      curX = (xPercents[i] / 100) * widths[i];
      distanceToStart = item.offsetLeft + curX - startX;
      distanceToLoop = distanceToStart + widths[i] * gsap.getProperty(item, 'scaleX');
      tl.to(
        item,
        {
          xPercent: snap(((curX - distanceToLoop) / widths[i]) * 100),
          duration: distanceToLoop / pixelsPerSecond,
        },
        0
      )
        .fromTo(
          item,
          {
            xPercent: snap(((curX - distanceToLoop + totalWidth) / widths[i]) * 100),
          },
          {
            xPercent: xPercents[i],
            duration: (curX - distanceToLoop + totalWidth - curX) / pixelsPerSecond,
            immediateRender: false,
          },
          distanceToLoop / pixelsPerSecond
        )
        .add('label' + i, distanceToStart / pixelsPerSecond);
      times[i] = distanceToStart / pixelsPerSecond;
    }

    function toIndex(index, vars) {
      vars = vars || {};
      Math.abs(index - curIndex) > length / 2 &&
        (index += index > curIndex ? -length : length);
      var newIndex = gsap.utils.wrap(0, length, index);
      var time = times[newIndex];
      if (time > tl.time() !== index > curIndex) {
        vars.modifiers = { time: gsap.utils.wrap(0, tl.duration()) };
        time += tl.duration() * (index > curIndex ? 1 : -1);
      }
      curIndex = newIndex;
      vars.overwrite = true;
      return tl.tweenTo(time, vars);
    }

    tl.next = function next(vars) {
      return toIndex(curIndex + 1, vars);
    };
    tl.previous = function previous(vars) {
      return toIndex(curIndex - 1, vars);
    };
    tl.current = function current() {
      return curIndex;
    };
    tl.toIndex = function toIndexPublic(index, vars) {
      return toIndex(index, vars);
    };
    tl.times = times;
    tl.progress(1, true).progress(0, true);
    if (config.reversed) {
      tl.vars.onReverseComplete();
      tl.reverse();
    }
    return tl;
  }

  function killLoops(state) {
    if (!state.loops) return;
    state.loops.forEach(function (tl) {
      if (tl && typeof tl.kill === 'function') tl.kill();
    });
    state.loops = [];
    if (typeof window.gsap !== 'undefined') {
      state.tracks.forEach(function (entry) {
        window.gsap.set(entry.track.children, { clearProps: 'transform' });
      });
    }
  }

  function syncPlayback(state) {
    if (!state.loops || !state.loops.length) return;
    var shouldPlay = state.inView && !state.reduceMotion;
    state.loops.forEach(function (tl, i) {
      if (!tl) return;
      var hovered = state.pauseOnHover && state.hoverIndex === i;
      // resume(), never play(): play() means "play FORWARD" and clears the
      // reversed state horizontalLoop set for even Tracks, so every sync tick
      // (init, hover leave, IO transition) used to flip them back to RTL.
      if (shouldPlay && !hovered) tl.resume();
      else tl.pause();
    });
  }

  /**
   * Evidence that the companion stylesheet actually applied: our Track rule is
   * the only thing making a Track a flex row. If it did not load, the Track is
   * a block, every item is full-width on its own line, and the fill target can
   * never be reached — which is how one 404 turned 22 logos into ~550 nodes.
   * Substring match so `inline-flex` (a legitimate override) still counts.
   */
  function tracksAreFlexRows(state) {
    return state.tracks.every(function (entry) {
      var cs = window.getComputedStyle(entry.track);
      return !!cs && String(cs.display).indexOf('flex') !== -1;
    });
  }

  function armLoops(state) {
    // Measured ONCE, before anything mutates the DOM. Re-reading it per Track
    // lets an earlier Track's clones inflate the wrapper and skew later ones.
    var wrapW = state.wrapper.clientWidth || 0;
    state.armWidth = wrapW;
    killLoops(state);

    // No width means the wrapper (or an ancestor) is hidden or collapsed. A
    // display:none ancestor still computes as flex, so the stylesheet guard
    // below cannot see this; only the width can. Arming against 0 builds a band
    // nobody can measure: the fill target is 0 so not one clone is added, and
    // horizontalLoop then divides by zero-width items — NaN transforms. The
    // clones stay in place; killLoops above has already dropped the timelines
    // and cleared their inline transforms. The ResizeObserver re-arms on width.
    if (wrapW <= 0) return;

    if (!tracksAreFlexRows(state)) {
      // The originals stay in the DOM and visible, just unstyled — without the
      // Track rule that is typically a vertical stack, not a row. No clones, no
      // animation. Also strips clones from an earlier healthy arm so none are
      // left stranded in a Track that can no longer lay them out.
      state.tracks.forEach(function (entry) {
        removeClones(entry.track);
      });
      if (!state.warnedMissingCss) {
        state.warnedMissingCss = true;
        devWarn('structural CSS missing; wall left static', state.wrapper);
      }
      return;
    }
    state.tracks.forEach(function (entry) {
      fillTrack(entry.track, entry.originals, wrapW);
    });
    if (state.reduceMotion || typeof window.gsap === 'undefined') return;
    state.loops = state.tracks.map(function (entry, index) {
      var kids = Array.prototype.slice.call(entry.track.children);
      if (!kids.length) return null;
      return horizontalLoop(kids, {
        repeat: -1,
        speed: state.speed,
        reversed: index % 2 === 0,
        paddingRight: columnGapPx(entry.track),
        paused: true,
      });
    });
    syncPlayback(state);
  }

  function bindHover(state) {
    if (!state.pauseOnHover) return;
    state.tracks.forEach(function (entry, index) {
      function onEnter() {
        state.hoverIndex = index;
        syncPlayback(state);
      }
      function onLeave() {
        if (state.hoverIndex === index) state.hoverIndex = -1;
        syncPlayback(state);
      }
      entry.track.addEventListener('mouseenter', onEnter);
      entry.track.addEventListener('mouseleave', onLeave);
    });
  }

  function bindViewport(state) {
    state.inView = true;
    if (typeof IntersectionObserver !== 'function') {
      syncPlayback(state);
      return;
    }
    var io = new IntersectionObserver(function onIntersect(entries) {
      var entry = entries[0];
      state.inView = !!(entry && entry.isIntersecting);
      syncPlayback(state);
    });
    io.observe(state.wrapper);
    state.io = io;
  }

  /**
   * Re-arm when the WRAPPER's width changes — which is not the same event as a
   * window resize. A wrapper can be revealed from display:none, expand out of a
   * collapsed parent, or reflow inside a tab, all without the window moving; a
   * window resize can equally leave the wrapper untouched (iOS collapsing its
   * URL bar fires resize with the wrapper width unchanged). Both paths funnel
   * through the same width comparison, so nothing rebuilds for free.
   */
  function bindResize(state) {
    var timer = 0;
    function onGeometryChange() {
      if (state.armWidth == null) return; // never armed; the first arm is coming
      window.clearTimeout(timer);
      if ((state.wrapper.clientWidth || 0) === state.armWidth) return;
      timer = window.setTimeout(function resizeArm() {
        if ((state.wrapper.clientWidth || 0) === state.armWidth) return;
        state.reduceMotion = prefersReducedMotion();
        armLoops(state);
      }, RESIZE_MS);
    }

    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(onGeometryChange);
      ro.observe(state.wrapper);
      state.ro = ro;
    }
    // Kept for browsers without ResizeObserver; harmless alongside it.
    window.addEventListener('resize', onGeometryChange);
    state.onResize = onGeometryChange;
  }

  function bindReducedMotion(state) {
    var mq;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch (e) {
      return;
    }
    function onChange() {
      state.reduceMotion = prefersReducedMotion();
      armLoops(state);
    }
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  }

  function splitItems(items, trackCount) {
    var buckets = [];
    var i;
    for (i = 0; i < trackCount; i++) buckets.push([]);
    items.forEach(function (item, index) {
      buckets[index % trackCount].push(item);
    });
    return buckets;
  }

  function buildTracks(wrapper, items, trackCount) {
    var buckets = splitItems(items, trackCount);
    var tracks = [];
    buckets.forEach(function (originals) {
      if (!originals.length) return;
      var track = document.createElement('div');
      track.setAttribute('data-logo-wall-element', 'track');
      originals.forEach(function (item) {
        track.appendChild(item);
      });
      wrapper.appendChild(track);
      tracks.push({ track: track, originals: originals });
    });
    return tracks;
  }

  function initWrapper(wrapper) {
    if (wrapper.getAttribute(INIT_ATTR) === 'true') return;
    wrapper.setAttribute(INIT_ATTR, 'true');

    flattenDisplayContents(wrapper);
    removeCMSList(wrapper);

    var leftovers = Array.prototype.filter.call(wrapper.children, function (child) {
      return child.getAttribute('data-logo-wall-element') !== 'item';
    });
    if (leftovers.length) {
      devWarn('leftover non-item children; skipped', wrapper);
      return;
    }

    var items = Array.prototype.slice.call(wrapper.querySelectorAll(ITEM_SEL));
    if (!items.length) {
      devWarn('no items in wrapper; skipped', wrapper);
      return;
    }

    var requested = parseTracks(wrapper.getAttribute('data-logo-wall-tracks'));
    var trackCount = Math.min(requested, items.length);
    var tracks = buildTracks(wrapper, items, trackCount);
    if (!tracks.length) {
      devWarn('no tracks built; skipped', wrapper);
      return;
    }

    var state = {
      wrapper: wrapper,
      tracks: tracks,
      loops: [],
      speed: parseSpeed(wrapper.getAttribute('data-logo-wall-speed')),
      pauseOnHover: !isAttrFalse(wrapper.getAttribute('data-logo-wall-pause-on-hover')),
      reduceMotion: prefersReducedMotion(),
      inView: true,
      hoverIndex: -1,
      warnedMissingCss: false,
      /** Wrapper width used by the last arm; null until the first one runs. */
      armWidth: null,
    };

    bindHover(state);
    bindViewport(state);
    bindResize(state);
    bindReducedMotion(state);

    whenImagesReady(wrapper, function onReady() {
      armLoops(state);
    });
  }

  function initWrapperSafe(wrapper) {
    try {
      initWrapper(wrapper);
    } catch (err) {
      devWarn('init failed', wrapper, err);
    }
  }

  function start() {
    if (isDesignMode()) return;
    var wrappers = document.querySelectorAll(WRAPPER_SEL);
    Array.prototype.forEach.call(wrappers, initWrapperSafe);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
