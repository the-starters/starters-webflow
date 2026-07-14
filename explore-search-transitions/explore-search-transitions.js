(function () {
    'use strict';

    function init() {
      var wrapper = document.querySelector('[data-search-brilliance-wrapper]');
      if (!wrapper) return;

      var ACTIVE = 'is-active';
      var INPUT_SELECTOR = '#search-brilliance-input';
      var WRAPPER_CLOSED = 'polygon(0 0, 100% 0, 100% 0, 0 0)';
      var WRAPPER_OPEN = 'polygon(0 0, 100% 0, 100% 100%, 0 100%)';

      var openTl = null;
      var closeTl = null;
      var gsapCtx = null;
      var reduceMotion = false;
      var hasGsap = typeof gsap !== 'undefined';
      var isClosing = false;

      function isOpen() {
        return wrapper.classList.contains(ACTIVE);
      }

      function focusInput() {
        var input = wrapper.querySelector(INPUT_SELECTOR);
        if (!input) return;

        try {
          input.focus({ preventScroll: true });
        } catch (err) {
          input.focus();
        }
      }

      function lock() {
        isClosing = false;
        wrapper.classList.remove(ACTIVE);
        wrapper.setAttribute('inert', '');
        wrapper.setAttribute('aria-hidden', 'true');
      }

      function unlock() {
        wrapper.classList.add(ACTIVE);
        wrapper.removeAttribute('inert');
        wrapper.setAttribute('aria-hidden', 'false');
      }

      function getTargets() {
        var searchWrapper = wrapper.querySelector('.search-brilliance_search-wrapper');
        var searchRowFade = [];
        var step3 = [];

        if (searchWrapper) {
          var logo = searchWrapper.querySelector('.navbar_logo');
          var inputWrapper = searchWrapper.querySelector('.search-brilliance_search-input-wrapper');
          var closeBtn = searchWrapper.querySelector('.button_main-wrap');
          if (logo) searchRowFade.push(logo);
          if (inputWrapper) searchRowFade.push(inputWrapper);
          if (closeBtn) searchRowFade.push(closeBtn);
        }

        wrapper.querySelectorAll('.search-brilliance_filter-group').forEach(function (el) {
          step3.push(el);
        });

        var header = wrapper.querySelector('.search-brilliance_results-header');
        if (header) step3.push(header);

        var resultsBody = wrapper.querySelector('.search-brilliance_results-body');
        if (resultsBody) step3.push(resultsBody);

        return {
          searchRowFade: searchRowFade,
          step3: step3,
        };
      }

      function killTimelines() {
        if (openTl) {
          openTl.kill();
          openTl = null;
        }

        if (closeTl) {
          closeTl.kill();
          closeTl = null;
        }

        if (gsapCtx) {
          gsapCtx.revert();
          gsapCtx = null;
        }
      }

      function resetToClosedState() {
        var targets = getTargets();

        gsap.set(wrapper, { clearProps: 'transform,opacity,visibility,clipPath' });

        if (targets.searchRowFade.length) {
          gsap.set(targets.searchRowFade, {
            clearProps: 'transform,opacity,visibility,filter',
          });
        }

        if (targets.step3.length) {
          gsap.set(targets.step3, { clearProps: 'transform,opacity,visibility,filter' });
        }
      }

      function getEnterFade() {
        return {
          y: 12,
          autoAlpha: 0,
          filter: 'blur(4px)',
          duration: reduceMotion ? 0 : 0.35,
          ease: 'power2.out',
        };
      }

      function buildOpenTimeline() {
        killTimelines();
        resetToClosedState();
        gsap.set(wrapper, { autoAlpha: 1, y: 0 });

        var targets = getTargets();
        var wrapperClipDuration = reduceMotion ? 0 : 0.6;
        var enterFade = getEnterFade();
        var rowStagger = reduceMotion ? 0 : 0.1;
        var rowStart = wrapperClipDuration * 0.8;
        var step3Start = wrapperClipDuration;

        gsapCtx = gsap.context(function () {
          openTl = gsap.timeline({
            paused: true,
            onComplete: focusInput,
          });

          openTl.fromTo(
            wrapper,
            { clipPath: WRAPPER_CLOSED },
            {
              clipPath: WRAPPER_OPEN,
              duration: wrapperClipDuration,
              ease: 'power4.inOut',
            },
            0
          );

          if (targets.searchRowFade.length) {
            openTl.from(
              targets.searchRowFade,
              Object.assign({}, enterFade, { stagger: rowStagger }),
              rowStart
            );
          }

          if (targets.step3.length) {
            openTl.from(targets.step3, enterFade, step3Start);
          }
        }, wrapper);

        return openTl;
      }

      function buildCloseTimeline() {
        if (openTl) {
          openTl.kill();
          openTl = null;
        }

        if (closeTl) {
          closeTl.kill();
          closeTl = null;
        }

        var fadeDuration = reduceMotion ? 0 : 0.35;

        closeTl = gsap.timeline({
          paused: true,
          onComplete: function () {
            lock();
            killTimelines();
            resetToClosedState();
          },
        });

        closeTl.to(
          wrapper,
          {
            y: 16,
            autoAlpha: 0,
            duration: fadeDuration,
            ease: 'power2.in',
          },
          0
        );

        return closeTl;
      }

      function openWithGsap() {
        if (isClosing) return;

        unlock();
        buildOpenTimeline();
        openTl.play(0);
      }

      function closeWithGsap() {
        if (isClosing) return;

        isClosing = true;
        buildCloseTimeline();
        closeTl.play(0);
      }

      function openFallback() {
        unlock();
        focusInput();
      }

      function closeFallback() {
        lock();
      }

      function open() {
        if (hasGsap) openWithGsap();
        else openFallback();
      }

      function close() {
        if (hasGsap && isOpen()) closeWithGsap();
        else closeFallback();
      }

      function toggle() {
        if (isOpen()) close();
        else open();
      }

      lock();

      if (hasGsap && gsap.matchMedia) {
        gsap.matchMedia().add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, function (context) {
          reduceMotion = context.conditions.reduceMotion;
        });
      } else if (window.matchMedia) {
        reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }

      document.querySelectorAll('[data-brilliance-button]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          toggle();
        });
      });

      wrapper.querySelectorAll('[data-search-brilliance-close]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          close();
        });
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) close();
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  })();