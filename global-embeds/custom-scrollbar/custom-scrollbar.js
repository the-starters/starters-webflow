// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/custom-scrollbar
(function () {
    'use strict';

    /** Re-measure after the browser is likely to have stable overflow (scrollWidth) numbers. */
    function scheduleLayoutRemeasures(updateThumb) {
      updateThumb();
      if (typeof window.requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            updateThumb();
          });
        });
      }
      if (typeof window.setTimeout === 'function') {
        [0, 16, 50, 100, 250, 500, 1000].forEach(function (ms) {
          window.setTimeout(updateThumb, ms);
        });
      }
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready
          .then(function () {
            updateThumb();
          })
          .catch(function () {});
      }
    }

    /**
     * scrollWidth for an overflow scroller can stay stale until a scroll/layout flush; a short
     * run of rAFs forces repeated reads the way “user scrolled once” does.
     */
    function runRafBurst(updateThumb, maxFrames) {
      var n = 0;
      var cap = typeof maxFrames === 'number' ? maxFrames : 40;
      function step() {
        updateThumb();
        n++;
        if (n < cap && typeof window.requestAnimationFrame === 'function') {
          requestAnimationFrame(step);
        } else if (n < cap) {
          setTimeout(step, 16);
        }
      }
      if (typeof window.requestAnimationFrame === 'function') {
        requestAnimationFrame(step);
      } else {
        setTimeout(step, 0);
      }
    }

    function bindImageRemeasure(el, updateThumb) {
      var imgs = el.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        (function (img) {
          if (img.complete) return;
          img.addEventListener(
            'load',
            function onImg() {
              img.removeEventListener('load', onImg);
              updateThumb();
            },
            { once: true },
          );
        })(imgs[i]);
      }
    }

    function setupResizeObservers(container, track, updateThumb) {
      if (typeof window.ResizeObserver === 'undefined') return;

      var raf = null;
      function schedule() {
        if (raf !== null) return;
        raf = window.requestAnimationFrame(function () {
          raf = null;
          updateThumb();
        });
      }

      var ro = new window.ResizeObserver(schedule);
      ro.observe(container);
      ro.observe(track);

      var k = 0;
      for (k = 0; k < container.children.length; k++) {
        ro.observe(container.children[k]);
      }
    }

    function setupIntersectionResync(wrapper, updateThumb) {
      if (typeof window.IntersectionObserver === 'undefined') return;

      var roVisible = new window.IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i] && entries[i].isIntersecting) {
              scheduleLayoutRemeasures(updateThumb);
              runRafBurst(updateThumb, 24);
            }
          }
        },
        { root: null, threshold: 0, rootMargin: '0px' },
      );
      roVisible.observe(wrapper);
    }

    function setupDomMutationResync(container, updateThumb) {
      if (typeof window.MutationObserver === 'undefined') return;

      var t = null;
      var mo = new window.MutationObserver(function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          t = null;
          updateThumb();
        }, 50);
      });
      mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }

    /** Syncs thumb size/position; hides the track when there is nothing to scroll. */
    function updateThumbFor(container, track, thumb) {
      var scrollWidth = container.scrollWidth;
      var clientWidth = container.clientWidth;
      var scrollLeft = container.scrollLeft;
      var trackWidth = track.clientWidth;
      var hasItems = container.children.length > 0;
      var isScrollable = scrollWidth > clientWidth + 1;

      if (!hasItems || !isScrollable || scrollWidth <= 0 || trackWidth <= 0) {
        track.style.display = 'none';
        thumb.style.left = '0px';
        thumb.style.width = '0px';
        return;
      }

      track.style.display = '';

      var thumbWidth = (clientWidth / scrollWidth) * trackWidth;
      thumb.style.width = thumbWidth + 'px';

      var maxScroll = scrollWidth - clientWidth;
      var maxThumbMove = trackWidth - thumbWidth;
      var thumbLeft = (scrollLeft / maxScroll) * maxThumbMove;
      thumb.style.left = thumbLeft + 'px';
    }

    function initCustomScrollbars() {
      var wrappers = document.querySelectorAll('[data-scrollbar-container]');
      wrappers.forEach(function (wrapper) {
        if (wrapper.getAttribute('data-scrollbar-inited') === 'true') return;
        wrapper.setAttribute('data-scrollbar-inited', 'true');

        var container = wrapper.querySelector('[data-scroll-content]');
        var track = wrapper.querySelector('[data-scrollbar-track]');
        var thumb = wrapper.querySelector('[data-scrollbar-thumb]');

        if (!container || !track || !thumb) return;

        thumb.style.touchAction = 'none';

        var isDragging = false;
        var startX = 0;
        var startScroll = 0;

        function updateThumb() {
          void container.offsetWidth;
          void track.offsetWidth;
          updateThumbFor(container, track, thumb);
        }

        function onPointerDown(e) {
          if (e.button !== 0) return;
          e.preventDefault();
          isDragging = true;
          startX = e.clientX;
          startScroll = container.scrollLeft;
          document.body.style.userSelect = 'none';
          if (typeof thumb.setPointerCapture === 'function') {
            thumb.setPointerCapture(e.pointerId);
          }
        }

        function onPointerMove(e) {
          if (!isDragging) return;
          var dx = e.clientX - startX;
          var sw = container.scrollWidth;
          var cw = container.clientWidth;
          var tw = track.clientWidth;
          var delta = sw - cw;
          if (tw <= 0) return;
          var scrollRatio = delta / tw;
          container.scrollLeft = startScroll + dx * scrollRatio;
        }

        function endDrag(e) {
          if (!isDragging) return;
          isDragging = false;
          document.body.style.userSelect = '';
          if (e && typeof thumb.releasePointerCapture === 'function' && thumb.hasPointerCapture && thumb.hasPointerCapture(e.pointerId)) {
            thumb.releasePointerCapture(e.pointerId);
          }
        }

        thumb.addEventListener('pointerdown', onPointerDown);
        thumb.addEventListener('pointermove', onPointerMove);
        thumb.addEventListener('pointerup', endDrag);
        thumb.addEventListener('pointercancel', endDrag);
        container.addEventListener('scroll', updateThumb, { passive: true });
        window.addEventListener('resize', updateThumb);

        setupResizeObservers(container, track, updateThumb);
        bindImageRemeasure(container, updateThumb);
        setupIntersectionResync(wrapper, updateThumb);
        setupDomMutationResync(container, updateThumb);

        scheduleLayoutRemeasures(updateThumb);
        runRafBurst(updateThumb, 40);
      });
    }

    function runWhenPageReady() {
      function start() {
        if (typeof window.requestAnimationFrame === 'function') {
          requestAnimationFrame(initCustomScrollbars);
        } else {
          initCustomScrollbars();
        }
      }

      if (document.readyState === 'complete') {
        start();
      } else {
        window.addEventListener('load', start, { once: true });
      }
    }

    runWhenPageReady();
  })();