// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/filters-mobile

  window.addEventListener('DOMContentLoaded', () => {
    const panel   = document.querySelector('[data-filter-panel]');
    const home    = document.querySelector('[data-filter-home]');
    const landing = document.querySelector('[data-filter-landing]');
    if (!panel || !home || !landing) return;

    const mq = window.matchMedia('(max-width: 767px)'); // Webflow mobile breakpoint
    const isMobile = () => mq.matches;

    const place = () => {
      const target = isMobile() ? landing : home;
      if (panel.parentElement !== target) target.appendChild(panel);
    };

    // Desktop = instant: commit the moment the script flags a staged change
    const commit = () => {
      if (!isMobile() && window.WfAlgolia) window.WfAlgolia.commitStaging();
    };

    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.attributeName === 'data-wf-algolia-staged' &&
            m.target.getAttribute('data-wf-algolia-staged') === 'true') {
          commit();
        }
      }
    });
    panel.querySelectorAll('[wf-algolia-element="filter-group"]').forEach((g) =>
      obs.observe(g, { attributes: true, attributeFilter: ['data-wf-algolia-staged'] })
    );

    const onBreakpoint = () => { place(); commit(); }; // flush staged picks when entering desktop

    place();
    mq.addEventListener('change', onBreakpoint);
  });