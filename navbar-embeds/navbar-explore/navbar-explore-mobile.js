
  /* Explore menu — mobile (<= 991px): stacked columns + a fixed back button that
     pops the top column. Desktop JS bails below 992px. */
  (function () {
    const mq = window.matchMedia('(max-width: 991px)');
    const isMobile = () => mq.matches;

    document.addEventListener('DOMContentLoaded', () => {
      const toggle = document.querySelector('[data-block="explore-field"]');
      const panel = document.querySelector('[data-block="explore-list"]');
      if (!toggle || !panel) return;

      let isOpen = false;
      const stack = []; // open columns, in order

      // Fixed back button, cloned from the design's arrow.
      let backBtn = null;
      function ensureBackButton() {
        if (backBtn) return backBtn;
        const src = panel.querySelector('.explore_back-button');
        backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'explore_back-button explore_back-button--mobile';
        backBtn.setAttribute('data-explore-back-button', '');
        backBtn.setAttribute('aria-label', 'Back');
        backBtn.innerHTML = src ? src.innerHTML : '\u2190';
        panel.appendChild(backBtn);
        return backBtn;
      }
      function updateBackButton() {
        ensureBackButton().classList.toggle('is-shown', isOpen && stack.length > 0);
      }

      // Each row is its own stacking context, so lift the open column's host
      // row above its siblings; restored on close.
      function openColumn(col) {
        if (!col || stack.includes(col)) return;
        const host = col.closest('.explore_sub_item') || col.closest('.explore_item');
        if (host) {
          host.dataset.prevZ = host.style.zIndex || '';
          host.style.zIndex = '1100';
          col._host = host;
        }
        col.classList.add('is-open-m');
        stack.push(col);
        updateBackButton();
      }
      function closeTop() {
        const col = stack.pop();
        if (!col) return;
        col.classList.remove('is-open-m');
        if (col._host) {
          col._host.style.zIndex = col._host.dataset.prevZ || '';
          col._host = null;
        }
        updateBackButton();
      }
      function closeAll() {
        while (stack.length) closeTop();
      }

      function openPanel() {
        toggle.classList.add('is-active'); // rotates the toggle chevron
        panel.style.opacity = '1';
        panel.style.visibility = 'visible';
        panel.style.pointerEvents = 'auto';
        isOpen = true;
        updateBackButton();
      }
      function closePanel() {
        closeAll();
        toggle.classList.remove('is-active');
        panel.style.opacity = '0';
        panel.style.visibility = 'hidden';
        panel.style.pointerEvents = 'none';
        isOpen = false;
        updateBackButton();
      }

      toggle.addEventListener('click', (e) => {
        if (!isMobile()) return;
        e.preventDefault();
        e.stopPropagation();
        isOpen ? closePanel() : openPanel();
      });

      // One delegated click handler for the panel.
      panel.addEventListener('click', (e) => {
        if (!isMobile()) return;

        if (e.target.closest('[data-explore-back-button]')) {
          e.preventDefault();
          e.stopPropagation();
          closeTop();
          return;
        }
        if (e.target.closest('a')) return; // let links navigate

        const subItem = e.target.closest('[data-block="explore-sub-item"]');
        if (subItem) {
          const fr = subItem.querySelector('[data-block="explore-freelancers"]');
          if (fr) {
            openColumn(fr);
            return;
          }
        }
        const item = e.target.closest('[data-block="explore-item"]');
        if (item) {
          const sub = item.querySelector('[data-block="explore-sub-list"]');
          if (sub) openColumn(sub);
        }
      });

      document.addEventListener('click', (e) => {
        if (!isMobile() || !isOpen) return;
        if (!toggle.contains(e.target) && !panel.contains(e.target)) closePanel();
      });

      // Back up to desktop while open: reset and let the desktop JS take over.
      mq.addEventListener('change', (e) => {
        if (!e.matches && isOpen) {
          closeAll();
          toggle.classList.remove('is-active');
          panel.style.opacity = '';
          panel.style.visibility = '';
          panel.style.pointerEvents = '';
          isOpen = false;
          updateBackButton();
        }
      });
    });
  })();