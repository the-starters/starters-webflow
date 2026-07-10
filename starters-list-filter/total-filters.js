// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/total-filters

  (function () {
    const SELECTOR = '[data-total-filter-count]';

    function count() {
      if (!window.WfAlgolia || typeof window.WfAlgolia.getFilterState !== 'function') return null;
      const state = window.WfAlgolia.getFilterState() || {};
      return Object.values(state).reduce(
        (sum, v) => sum + (Array.isArray(v) ? v.length : (v ? 1 : 0)), 0
      );
    }

    function render() {
      const n = count();
      if (n === null) return;
      document.querySelectorAll(SELECTOR).forEach((el) => { el.textContent = n; });
    }

    // Instant updates via events, when the API is ready
    function wire() {
      if (!window.WfAlgolia || typeof window.WfAlgolia.on !== 'function') return false;
      window.WfAlgolia.on('ready', render);
      window.WfAlgolia.on('filter', render); // render re-reads state itself
      render();
      return true;
    }
    if (!wire()) {
      const iv = setInterval(() => { if (wire()) clearInterval(iv); }, 100);
      setTimeout(() => clearInterval(iv), 10000);
    }

    // Safety net: re-read committed state on a light interval in case an event is missed
    setInterval(render, 400);
  })();