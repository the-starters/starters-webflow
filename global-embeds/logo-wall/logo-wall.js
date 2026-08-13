// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/logo-wall
/**
 * Logo Wall — attribute-driven looping tracks of CMS logos.
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
 * Unique logos are dealt round-robin across Tracks. Each Track clones its own
 * items until it overflows (including reduced-motion freeze). Then GSAP's
 * horizontalLoop helper seamless-loops them. Odd Tracks run RTL. Hover pauses
 * that Track. Off-screen wrappers pause. prefers-reduced-motion freezes the bands.
 */
(function () {
  if (window.__startersLogoWallInit) return;
  window.__startersLogoWallInit = true;

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

  function fillTrack(track, originals, viewport) {
    removeClones(track);
    if (!originals.length) return;
    var viewW = viewport.clientWidth || 0;
    if (viewW <= 0) return;
    var copies = 0;
    while (track.scrollWidth < viewW * FILL_TIMES && copies < MAX_CLONES) {
      originals.forEach(function (item) {
        var clone = item.cloneNode(true);
        clone.removeAttribute('data-logo-wall-element');
        clone.setAttribute(CLONE_ATTR, '');
        Array.prototype.forEach.call(clone.querySelectorAll('img'), function (img) {
          img.loading = 'eager';
        });
        track.appendChild(clone);
      });
      copies += 1;
      if (track.scrollWidth <= 0) break;
    }
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
      if (shouldPlay && !hovered) tl.play();
      else tl.pause();
    });
  }

  function armLoops(state) {
    killLoops(state);
    state.tracks.forEach(function (entry) {
      fillTrack(entry.track, entry.originals, state.wrapper);
    });
    if (state.reduceMotion || typeof window.gsap === 'undefined') return;
    state.loops = state.tracks.map(function (entry, index) {
      var kids = Array.prototype.slice.call(entry.track.children);
      if (!kids.length) return null;
      return horizontalLoop(kids, {
        repeat: -1,
        speed: state.speed,
        reversed: index % 2 === 1,
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

  function bindResize(state) {
    var timer = 0;
    function onResize() {
      window.clearTimeout(timer);
      timer = window.setTimeout(function resizeArm() {
        state.reduceMotion = prefersReducedMotion();
        armLoops(state);
      }, RESIZE_MS);
    }
    window.addEventListener('resize', onResize);
    state.onResize = onResize;
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
