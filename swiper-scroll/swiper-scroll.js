// Docs: https://wf-starter-embeds-docs.vercel.app/docs/swiper-scroll
(function () {
    'use strict';

    var INIT_ATTR = 'data-swiper-scroll-inited';
    var SWIPER_SELECTOR = '[data-swiper-scroll="swiper"]';

    function schedule(fn) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(fn);
      } else {
        window.setTimeout(fn, 0);
      }
    }

    /** data-swiper-scroll-cms="true" keeps CMS markup intact and moves the scrollbar outside. */
    function isCmsMode(swiperEl) {
      return swiperEl.getAttribute('data-swiper-scroll-cms') === 'true';
    }

    /** Unwraps leading .u-display-contents helpers so their children sit directly in the wrapper. */
    function flattenDisplayContents(wrapper) {
      var changed = false;
      var child = wrapper.firstElementChild;

      while (child && child.classList.contains('u-display-contents')) {
        while (child.firstChild) {
          wrapper.insertBefore(child.firstChild, child);
        }
        wrapper.removeChild(child);
        changed = true;
        child = wrapper.firstElementChild;
      }

      return changed;
    }

    /**
     * Lifts CMS content out of a nested Collection List: each item's first visible child
     * becomes a direct wrapper child, then the old list and static placeholders are removed.
     * Leaves the wrapper alone when there is no .w-dyn-list or it has no items (empty state).
     */
    function unwrapCmsList(wrapper) {
      var dynList = wrapper.querySelector(':scope > .w-dyn-list');
      if (!dynList) return false;

      var itemsEl = dynList.querySelector('.w-dyn-items');
      var items = itemsEl ? Array.prototype.slice.call(itemsEl.children) : [];
      if (!items.length) return false;

      var previousChildren = Array.prototype.slice.call(wrapper.children);

      items.forEach(function (item) {
        var content = Array.prototype.find.call(item.children, function (el) {
          return !el.classList.contains('w-condition-invisible');
        });
        if (content) wrapper.appendChild(content);
      });

      previousChildren.forEach(function (el) {
        el.remove();
      });

      return true;
    }

    /** Strips Webflow CMS wrappers (if any) and tags the promoted children as slides. */
    function normalizeCmsSlides(wrapper) {
      var changed = flattenDisplayContents(wrapper);
      changed = unwrapCmsList(wrapper) || changed;
      if (!changed) return;

      Array.prototype.forEach.call(wrapper.children, function (child) {
        child.setAttribute('data-swiper-scroll', 'swiper-slide');
      });
    }

    /** Adds Swiper class hooks while keeping data-swiper-scroll attributes. */
    function prepareSwiperClasses(swiperEl) {
      var wrapper = swiperEl.querySelector('[data-swiper-scroll="swiper-wrapper"]');
      var slides = swiperEl.querySelectorAll('[data-swiper-scroll="swiper-slide"]');

      swiperEl.classList.add('swiper');
      if (wrapper) wrapper.classList.add('swiper-wrapper');
      slides.forEach(function (slide) {
        slide.classList.add('swiper-slide');
      });
    }

    /**
     * Scrollbar is a direct child inside this swiper — scoped to the instance only.
     * CMS mode (data-swiper-scroll-cms="true"): the scrollbar is a sibling of the swiper
     * under the same parent instead.
     */
    function resolveScrollbarPair(swiperEl) {
      var pairId = swiperEl.getAttribute('data-swiper-scroll-id');
      var scope = isCmsMode(swiperEl) ? swiperEl.parentElement : swiperEl;
      var track = null;

      if (!scope) return null;

      if (pairId) {
        track = scope.querySelector(
          ':scope > [data-swiper-scroll="swiper-scrollbar"][data-swiper-scroll-id="' + pairId + '"]'
        );
      }

      if (!track) {
        track = scope.querySelector(':scope > [data-swiper-scroll="swiper-scrollbar"]');
      }

      if (!track) return null;

      var thumb = track.querySelector('[data-scrollbar-thumb]');
      if (!thumb) return null;

      return { root: swiperEl, track: track, thumb: thumb };
    }

    /**
     * scroll (default): freeMode + 3 slides visible — feels like scrolling, not snapping.
     * slide: snap carousel — set data-swiper-scroll-mode="slide".
     */
    function isWebflowDesignMode() {
      return document.documentElement.classList.contains('wf-design-mode');
    }

    function getDesignSlidesPerView(swiperEl) {
      var custom = parseFloat(swiperEl.getAttribute('data-swiper-design-slides-per-view'));
      if (Number.isFinite(custom) && custom > 0) return custom;
      return 3;
    }

    function getScrollMode(swiperEl) {
      var mode = (swiperEl.getAttribute('data-swiper-scroll-mode') || 'scroll').toLowerCase();
      if (mode === 'slide') return 'slide';
      if (mode === 'free' || mode === 'scroll') return 'scroll';
      if (swiperEl.getAttribute('data-swiper-free-mode') === 'true') return 'scroll';
      return 'scroll';
    }

    function isFreeScroll(swiperEl) {
      return getScrollMode(swiperEl) === 'scroll';
    }

    function getFreeModeConfig(swiperEl) {
      if (!isFreeScroll(swiperEl)) return false;

      if (swiperEl.getAttribute('data-swiper-free-mode') === 'sticky') {
        return {
          enabled: true,
          sticky: true,
          momentum: true,
          momentumRatio: 0.35,
        };
      }

      return {
        enabled: true,
        momentum: true,
        momentumRatio: 0.45,
        minimumVelocity: 0.02,
      };
    }

    function parseSlidesPerViewValue(value) {
      if (!value) return null;
      if (value === 'auto') return 'auto';
      var parsed = parseFloat(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      return null;
    }

    function getScrollDefaultSlidesPerView(swiperEl, viewport) {
      if (!isFreeScroll(swiperEl)) return 'auto';
      return viewport === 'mobile' ? 1.15 : 3;
    }

    /**
     * Resolves mobile / mobile-landscape / tablet / desktop slidesPerView from data attributes.
     * Webflow breakpoints: mobile below 480px, mobile landscape from 480px, tablet from 768px,
     * desktop from the desktop breakpoint (default 992px). Landscape falls back to the mobile
     * value, tablet falls back to the landscape value.
     */
    function getSlidesPerViewConfig(swiperEl) {
      if (isWebflowDesignMode()) {
        var designSpv = getDesignSlidesPerView(swiperEl);
        return {
          mobile: designSpv,
          landscape: designSpv,
          landscapeMin: 480,
          tablet: designSpv,
          tabletMin: 768,
          desktop: designSpv,
          desktopMin: 992,
        };
      }

      var desktopMin = parseFloat(swiperEl.getAttribute('data-swiper-breakpoint'));
      if (!Number.isFinite(desktopMin) || desktopMin <= 0) desktopMin = 992;

      var mobileAttr = parseSlidesPerViewValue(swiperEl.getAttribute('data-swiper-slides-per-view-mobile'));
      var landscapeAttr = parseSlidesPerViewValue(swiperEl.getAttribute('data-swiper-slides-per-view-mobile-landscape'));
      var tabletAttr = parseSlidesPerViewValue(swiperEl.getAttribute('data-swiper-slides-per-view-tablet'));
      var desktopAttr = parseSlidesPerViewValue(swiperEl.getAttribute('data-swiper-slides-per-view'));
      var mobile = mobileAttr !== null ? mobileAttr : desktopAttr !== null ? desktopAttr : getScrollDefaultSlidesPerView(swiperEl, 'mobile');
      var desktop = desktopAttr !== null ? desktopAttr : mobileAttr !== null ? mobileAttr : getScrollDefaultSlidesPerView(swiperEl, 'desktop');
      var landscape = landscapeAttr !== null ? landscapeAttr : mobile;
      var tablet = tabletAttr !== null ? tabletAttr : landscape;

      return {
        mobile: mobile,
        landscape: landscape,
        landscapeMin: 480,
        tablet: tablet,
        tabletMin: 768,
        desktop: desktop,
        desktopMin: desktopMin,
      };
    }

    function getSpaceBetweenConfig(swiperEl) {
      var desktopGap = parseFloat(swiperEl.getAttribute('data-swiper-space-between'));
      var mobileGap = parseFloat(swiperEl.getAttribute('data-swiper-space-between-mobile'));
      var gap = Number.isFinite(desktopGap) ? desktopGap : 0;
      var mobile = Number.isFinite(mobileGap) ? mobileGap : gap;

      return { mobile: mobile, desktop: gap };
    }

    function getSwiperOptions(swiperEl) {
      var grabCursor = swiperEl.getAttribute('data-swiper-grab-cursor');
      var mousewheel = swiperEl.getAttribute('data-swiper-mousewheel');
      var scrollMode = getScrollMode(swiperEl);
      var inDesignMode = isWebflowDesignMode();
      var spv = getSlidesPerViewConfig(swiperEl);
      var gap = getSpaceBetweenConfig(swiperEl);
      var options = {
        direction: 'horizontal',
        slidesPerView: spv.mobile,
        spaceBetween: gap.mobile,
        slidesPerGroup: 1,
        freeMode: inDesignMode ? false : getFreeModeConfig(swiperEl),
        grabCursor: inDesignMode ? false : grabCursor !== 'false',
        simulateTouch: !inDesignMode,
        allowTouchMove: !inDesignMode,
        speed: scrollMode === 'slide' ? 450 : 0,
        resistanceRatio: scrollMode === 'slide' ? 0.65 : 0,
        longSwipes: scrollMode === 'slide',
        shortSwipes: scrollMode === 'slide',
        watchOverflow: true,
        observer: true,
        observeParents: true,
        observeSlideChildren: true,
        wrapperClass: 'swiper-wrapper',
        slideClass: 'swiper-slide',
      };

      if (!inDesignMode) {
        var breakpoints = {};
        if (spv.landscape !== spv.mobile && spv.landscapeMin < spv.desktopMin) {
          breakpoints[spv.landscapeMin] = {
            slidesPerView: spv.landscape,
            spaceBetween: gap.mobile,
          };
        }
        if (spv.tablet !== spv.landscape && spv.tabletMin < spv.desktopMin) {
          breakpoints[spv.tabletMin] = {
            slidesPerView: spv.tablet,
            spaceBetween: gap.mobile,
          };
        }
        if (spv.desktop !== spv.tablet || gap.desktop !== gap.mobile) {
          breakpoints[spv.desktopMin] = {
            slidesPerView: spv.desktop,
            spaceBetween: gap.desktop,
          };
        }
        if (Object.keys(breakpoints).length) options.breakpoints = breakpoints;
      }

      if (!inDesignMode && mousewheel !== 'false') {
        options.mousewheel = {
          enabled: true,
          forceToAxis: true,
          sensitivity: scrollMode === 'scroll' ? 0.85 : 1,
          releaseOnEdges: true,
        };
      }

      return options;
    }

    function hideTrack(track, thumb) {
      track.style.display = 'none';
      thumb.style.left = '0px';
      thumb.style.width = '0px';
    }

    function bindCustomScrollbar(swiper, track, thumb) {
      var isDragging = false;
      var startX = 0;
      var startProgress = 0;
      var layoutTimer = null;

      thumb.style.touchAction = 'none';

      /** Syncs thumb only — never call swiper.update() here (causes infinite update loop). */
      function updateThumb() {
        var virtualSize = swiper.virtualSize || swiper.width;
        var viewWidth = swiper.width;

        if (virtualSize <= 0 || viewWidth <= 0) {
          hideTrack(track, thumb);
          return;
        }

        var maxTranslate = Math.abs(swiper.maxTranslate());
        if (maxTranslate <= 1) {
          hideTrack(track, thumb);
          return;
        }

        // Unhide before measuring — a display:none track reads clientWidth 0 and would stay hidden forever.
        track.style.display = '';
        void track.offsetWidth;

        var trackWidth = track.clientWidth;
        if (trackWidth <= 0) {
          hideTrack(track, thumb);
          return;
        }

        var ratio = viewWidth / virtualSize;
        var thumbWidth = Math.max(24, ratio * trackWidth);
        var maxThumbMove = Math.max(0, trackWidth - thumbWidth);
        var progress = typeof swiper.progress === 'number' ? swiper.progress : 0;

        thumb.style.width = thumbWidth + 'px';
        thumb.style.left = progress * maxThumbMove + 'px';
      }

      /** Debounced Swiper remeasure after layout/size changes — separate from thumb sync. */
      function scheduleLayoutUpdate() {
        if (layoutTimer) clearTimeout(layoutTimer);
        layoutTimer = setTimeout(function () {
          layoutTimer = null;
          swiper.update();
          updateThumb();
        }, 50);
      }

      function onPointerDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startProgress = typeof swiper.progress === 'number' ? swiper.progress : 0;
        document.body.style.userSelect = 'none';
        if (typeof thumb.setPointerCapture === 'function') {
          thumb.setPointerCapture(e.pointerId);
        }
      }

      function onPointerMove(e) {
        if (!isDragging) return;

        var trackWidth = track.clientWidth;
        var thumbWidth = thumb.clientWidth;
        var maxThumbMove = Math.max(0, trackWidth - thumbWidth);
        if (maxThumbMove <= 0) return;

        var delta = e.clientX - startX;
        var nextProgress = startProgress + delta / maxThumbMove;
        if (nextProgress < 0) nextProgress = 0;
        if (nextProgress > 1) nextProgress = 1;

        swiper.setProgress(nextProgress, 0);
      }

      function endDrag(e) {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
        if (
          e &&
          typeof thumb.releasePointerCapture === 'function' &&
          thumb.hasPointerCapture &&
          thumb.hasPointerCapture(e.pointerId)
        ) {
          thumb.releasePointerCapture(e.pointerId);
        }
      }

      thumb.addEventListener('pointerdown', onPointerDown);
      thumb.addEventListener('pointermove', onPointerMove);
      thumb.addEventListener('pointerup', endDrag);
      thumb.addEventListener('pointercancel', endDrag);

      swiper.on('progress', updateThumb);
      swiper.on('resize', updateThumb);
      swiper.on('setTranslate', updateThumb);
      swiper.on('slideChange', updateThumb);
      swiper.on('observerUpdate', scheduleLayoutUpdate);
      window.addEventListener('resize', scheduleLayoutUpdate);

      if (typeof window.ResizeObserver !== 'undefined') {
        var ro = new window.ResizeObserver(scheduleLayoutUpdate);
        ro.observe(track);
        ro.observe(swiper.el);
      }

      schedule(function () {
        swiper.update();
        updateThumb();
      });
      window.setTimeout(function () {
        swiper.update();
        updateThumb();
      }, 100);
      window.setTimeout(function () {
        swiper.update();
        updateThumb();
      }, 500);
    }

    function initSwiperBlock(swiperEl) {
      if (!swiperEl || swiperEl.getAttribute(INIT_ATTR) === 'true') return;
      if (!window.Swiper) {
        console.warn('[swiper-scroll] Swiper is not loaded.');
        return;
      }

      var pair = resolveScrollbarPair(swiperEl);
      var wrapper = swiperEl.querySelector('[data-swiper-scroll="swiper-wrapper"]');
      if (wrapper && !isCmsMode(swiperEl)) normalizeCmsSlides(wrapper);
      var slides = swiperEl.querySelectorAll('[data-swiper-scroll="swiper-slide"]');

      if (!wrapper || !slides.length || !pair) return;

      var track = pair.track;
      var thumb = pair.thumb;

      prepareSwiperClasses(swiperEl);

      if (isWebflowDesignMode()) {
        swiperEl.style.setProperty('--swiper-scroll-design-columns', String(getDesignSlidesPerView(swiperEl)));
      }

      swiperEl.setAttribute(INIT_ATTR, 'true');

      var swiper = new window.Swiper(swiperEl, getSwiperOptions(swiperEl));
      bindCustomScrollbar(swiper, track, thumb);

      swiperEl.__swiperScrollInstance = swiper;
    }

    function initSwiperScrollRegions() {
      var blocks = document.querySelectorAll(SWIPER_SELECTOR);
      blocks.forEach(initSwiperBlock);
    }

    function runWhenReady() {
      function start() {
        schedule(initSwiperScrollRegions);
      }

      if (document.readyState === 'complete') {
        start();
      } else {
        window.addEventListener('load', start, { once: true });
      }
    }

    runWhenReady();
  })();