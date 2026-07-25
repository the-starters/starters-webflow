// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/filters-mobile

  window.addEventListener('DOMContentLoaded', () => {
    const panel   = document.querySelector('[data-filter-panel]');
    const home    = document.querySelector('[data-filter-home]');
    const landing = document.querySelector('[data-filter-landing]');

    // The filter UI lives inside a real Webflow <form>. Its accordion toggles carry
    // no type attribute, so every toggle click is an implicit submit — which runs
    // native constraint validation and pops "Please fill out this field." on the
    // always-empty (wrongly `required`) location search inputs, stealing focus and
    // scrolling the page. Harden the form regardless of the placement guard below:
    // noValidate + the submit block keep working even if Webflow re-renders the
    // controls later.
    const filterForm = (panel && panel.closest('form')) ||
                       document.querySelector('form.all-starters_filters-form');
    if (filterForm) {
      filterForm.noValidate = true;
      filterForm.querySelectorAll('button:not([type])').forEach((b) => {
        b.setAttribute('type', 'button');
      });
      filterForm.querySelectorAll('.filters_dropdown-search-field[required]').forEach((i) => {
        i.removeAttribute('required');
      });
      filterForm.addEventListener('submit', (e) => e.preventDefault()); // must never navigate
    }

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