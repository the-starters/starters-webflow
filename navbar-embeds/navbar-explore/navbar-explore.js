
    document.addEventListener('DOMContentLoaded', () => {
      const toggle = document.querySelector('[data-block="explore-field"]');
      const searchList = document.querySelector('[data-block="explore-list"]');
  
      if (!toggle || !searchList) return;

      // Desktop only: the mobile embed takes over at <= 991px, so every handler
      // below bails under the breakpoint.
      const DESKTOP_MIN = 992;
      const isDesktop = () =>
        window.matchMedia('(min-width: ' + DESKTOP_MIN + 'px)').matches;

      let isOpen = false;
      const originalBgColor = window.getComputedStyle(toggle).backgroundColor;

      function syncExploreTop() {
        document.documentElement.style.setProperty(
          '--explore-top',
          searchList.getBoundingClientRect().top + 'px'
        );
      }

      const FLYOUT_MARGIN = 16; // gap from the viewport edges
      const FLYOUT_GAP = 4; // gap between columns
      const FLYOUT_ANIM_MS = 150; // fade/slide duration (matches the CSS)

      // Position a fixed flyout beside its anchor column, aligned to the trigger
      // row and clamped to the viewport. Call with the flyout already display:block.
      function positionFlyout(flyoutEl, anchorColEl, triggerRowEl) {
        if (!flyoutEl || !anchorColEl) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const maxH = vh - FLYOUT_MARGIN * 2;
        flyoutEl.style.maxHeight = maxH + 'px';

        const colRect = anchorColEl.getBoundingClientRect();
        const rowRect = (triggerRowEl || anchorColEl).getBoundingClientRect();
        const width = flyoutEl.offsetWidth;
        const height = Math.min(flyoutEl.offsetHeight, maxH);

        let left = colRect.right + FLYOUT_GAP;
        if (left + width > vw) left = Math.max(0, colRect.left - width - FLYOUT_GAP);

        let top = rowRect.top;
        if (top + height > vh - FLYOUT_MARGIN) top = vh - FLYOUT_MARGIN - height;
        if (top < FLYOUT_MARGIN) top = FLYOUT_MARGIN;

        flyoutEl.style.left = left + 'px';
        flyoutEl.style.top = top + 'px';
      }

      // Show + position a flyout. Cancels any pending hide so a stale close
      // can't hide a freshly-opened column.
      function openFlyout(flyoutEl, anchorColEl, rowEl, wait) {
        if (flyoutEl._hideTimer) {
          clearTimeout(flyoutEl._hideTimer);
          flyoutEl._hideTimer = null;
        }
        flyoutEl.dataset.open = '1';
        // Delay entrance one cycle when a sibling is still closing (CSS .is-switching).
        flyoutEl.classList.toggle('is-switching', !!wait);
        flyoutEl.style.display = 'block';
        positionFlyout(flyoutEl, anchorColEl, rowEl);
        // Next frame: flip to the open state so the transition runs.
        setTimeout(() => {
          flyoutEl.style.opacity = '1';
          flyoutEl.style.marginTop = '0px';
          flyoutEl.style.visibility = 'visible';
          flyoutEl.style.pointerEvents = 'auto';
        }, 10);
      }

      // Hide a flyout: fade + slide down, then display:none after the transition.
      function closeFlyout(flyoutEl) {
        delete flyoutEl.dataset.open;
        // Exits are never delayed.
        flyoutEl.classList.remove('is-switching');
        flyoutEl.style.opacity = '0';
        flyoutEl.style.marginTop = '8px';
        flyoutEl.style.visibility = 'hidden';
        flyoutEl.style.pointerEvents = 'none';
        if (flyoutEl._hideTimer) clearTimeout(flyoutEl._hideTimer);
        flyoutEl._hideTimer = setTimeout(() => {
          flyoutEl.style.display = 'none';
          flyoutEl._hideTimer = null;
        }, FLYOUT_ANIM_MS);
      }

      const isFlyoutOpen = (flyoutEl) => flyoutEl.dataset.open === '1';

      // Reposition visible flyouts (on resize).
      function repositionOpenFlyouts() {
        searchList.querySelectorAll('.explore_sub_list').forEach((subList) => {
          if (subList.style.display !== 'block') return;
          const row = subList.closest('[data-block="explore-item"]');
          // Anchor L2 to the outer panel, not .explore_list, so padding doesn't overlap.
          if (row) positionFlyout(subList, searchList, row);
        });
        searchList.querySelectorAll('.explore_fr').forEach((fr) => {
          if (fr.style.display !== 'block') return;
          const col = fr.closest('[data-block="explore-sub-list"]');
          const row = fr.closest('[data-block="explore-sub-item"]');
          if (col && row) positionFlyout(fr, col, row);
        });
      }

      function showMenu() {
        toggle.classList.add('is-active');
        searchList.style.display = 'block';
        syncExploreTop();
        setTimeout(() => {
          searchList.style.opacity = '1';
          searchList.style.pointerEvents = 'auto';
            searchList.style.visibility = 'visible';
          // searchList.classList.toggle('is-open');
        }, 10);
      }
  
      function hideMenu() {
        // searchList.classList.toggle('is-open');
        toggle.classList.remove('is-active');
        searchList.style.opacity = '0';
        searchList.style.visibility = 'hidden';
        // Reset open columns + highlights so reopening starts clean.
        searchList.querySelectorAll('.explore_sub_list, .explore_fr').forEach(closeFlyout);
        searchList
          .querySelectorAll('.explore_item.is-active, .explore_sub_item.is-active')
          .forEach((el) => el.classList.remove('is-active'));
        setTimeout(() => {
          searchList.style.display = 'none';
          searchList.style.pointerEvents = 'none';
        }, 250);
      }
  
      toggle.addEventListener('click', (e) => {
        if (!isDesktop()) return;
        e.stopPropagation();
  
        if (!isOpen) {
          showMenu();
          isOpen = true;
        } else {
          hideMenu();
          isOpen = false;
        }
      });
  
      document.addEventListener('click', (e) => {
        if (!isDesktop()) return;
        if (!toggle.contains(e.target) && !searchList.contains(e.target)) {
          if (isOpen) {
            hideMenu();
            isOpen = false;
          }
        }
      });

      let resizeRaf = null;
      window.addEventListener('resize', () => {
        if (!isDesktop()) return;
        if (!isOpen) return;
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          syncExploreTop();
          repositionOpenFlyouts();
        });
      });

      const exploreList = searchList.querySelector('.explore_list');

      // Toggle an L1 row's L2 column.
      function handleItemClick(item) {
        const subList = item.querySelector('[data-block="explore-sub-list"]');
        if (!subList || !exploreList) return;
        const wasOpen = isFlyoutOpen(subList);
        // Sibling open = any other L2/L3 still open (closed below; incoming waits).
        const siblingOpen = [
          ...searchList.querySelectorAll('.explore_sub_list, .explore_fr'),
        ].some((el) => el !== subList && isFlyoutOpen(el));
        // Close other L2s + all L3s, then toggle this one.
        searchList.querySelectorAll('.explore_sub_list').forEach((other) => {
          if (other !== subList) closeFlyout(other);
        });
        searchList.querySelectorAll('.explore_fr').forEach(closeFlyout);
        // Clear active highlight from other rows.
        searchList.querySelectorAll('.explore_item').forEach((el) => {
          if (el !== item) el.classList.remove('is-active');
        });
        searchList
          .querySelectorAll('.explore_sub_item.is-active')
          .forEach((el) => el.classList.remove('is-active'));
        if (wasOpen) {
          closeFlyout(subList);
          item.classList.remove('is-active');
        } else {
          // Anchor L2 to the outer panel so it sits beside column 1.
          openFlyout(subList, searchList, item, siblingOpen);
          item.classList.add('is-active');
        }
      }

      // Toggle an L2 row's L3 column.
      function handleSubItemClick(item) {
        const freelancers = item.querySelector('[data-block="explore-freelancers"]');
        const subList = item.closest('[data-block="explore-sub-list"]');
        if (!freelancers || !subList) return;
        const wasOpen = isFlyoutOpen(freelancers);
        // Sibling L3 open = any other one (closed below; incoming waits).
        const siblingOpen = [...subList.querySelectorAll('.explore_fr')].some(
          (el) => el !== freelancers && isFlyoutOpen(el)
        );
        // Close sibling L3s, then toggle this one.
        subList.querySelectorAll('.explore_fr').forEach((other) => {
          if (other !== freelancers) closeFlyout(other);
        });
        // Clear active highlight from sibling L2 rows.
        subList.querySelectorAll('.explore_sub_item').forEach((el) => {
          if (el !== item) el.classList.remove('is-active');
        });
        if (wasOpen) {
          closeFlyout(freelancers);
          item.classList.remove('is-active');
        } else {
          openFlyout(freelancers, subList, item, siblingOpen);
          item.classList.add('is-active');
        }
      }

      // One delegated click listener (no per-row binding — WF-Algolia clones rows,
      // and duplicate handlers cancel out, closing a column on the same click).
      // Resolve the deepest level first so an L3 click doesn't also run L1 logic.
      searchList.addEventListener('click', (e) => {
        if (!isDesktop()) return;
        const subItem = e.target.closest('[data-block="explore-sub-item"]');
        if (subItem && searchList.contains(subItem)) {
          handleSubItemClick(subItem);
          return;
        }
        const item = e.target.closest('[data-block="explore-item"]');
        if (item && searchList.contains(item)) {
          handleItemClick(item);
        }
      });
    });