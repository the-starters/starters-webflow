// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/price-label

  (function () {
    // The "Algolia Result Modifiers" component is instantiated inside BOTH the
    // Starters List - Premium and Starters List - Free components, so this file
    // loads twice on /all-starters. Guard so a duplicate never wires a second
    // WfAlgolia listener/observer. Bind once.
    if (window.__startersPriceLabelInit) return;
    window.__startersPriceLabelInit = true;

    function init() {
      // Marker gate: bail immediately on pages with no expert cards. Both hooks
      // ship in the static card template, so this is safe at DOMContentLoaded.
      if (!document.querySelector('.expert-card_item, [data-expert-type]')) return;

      const apply = () => {
        const cards = document.querySelectorAll('.expert-card_item');

        cards.forEach((card) => {
          const typeEl = card.querySelector('[data-expert-type]');
          if (!typeEl) return;

          const type = (typeEl.textContent || '').trim().toLowerCase();
          const consultEl = card.querySelector('[data-type-label="consult"]');
          const hireEl = card.querySelector('[data-type-label="hire"]');

          const isConsult = type === 'consult'; // hire + full fall to the else
          const hideEl = isConsult ? hireEl : consultEl;
          const showEl = isConsult ? consultEl : hireEl;

          if (hideEl) hideEl.style.setProperty('display', 'none', 'important');
          if (showEl) showEl.style.removeProperty('display');
        });
      };

      const applyNextFrame = () => requestAnimationFrame(apply);

      // Observe EVERY browse/results container, not just the first.
      //
      // The previous version resolved a single container with querySelector and
      // preferred [wf-algolia-element="browse"], falling back to results, then a
      // card's parent, then document.body. Two problems with that:
      //
      // 1. /all-starters has several browse containers (Premium list, Free list,
      //    gated-CTA counter) plus more from the navbar and search overlay — the
      //    served HTML carries five of each role. First-match picked one and
      //    ignored the rest, and Memberstack removes whichever gated section does
      //    not apply to the member, which can detach the observed node outright.
      // 2. The engine emits "results" from BROWSE MODE ONLY, so the search
      //    overlay renders through a path that fires no event at all. Observing
      //    every container is what covers that surface.
      //
      // Only childList is observed, so the engine's inline show/hide of sections
      // (attribute mutations) causes no churn here.
      function observeAllContainers() {
        const containers = document.querySelectorAll(
          '[wf-algolia-element="browse"], [wf-algolia-element="results"]'
        );
        if (!containers.length) {
          if (/webflow\.io$|^localhost$|trycloudflare\.com$/.test(location.hostname) || window.STARTERS_DEBUG) {
            console.warn('[starters price-label] no wf-algolia browse/results container found — only the engine results event can trigger this modifier.');
          }
          return;
        }
        const observer = new MutationObserver(applyNextFrame);
        containers.forEach(c => observer.observe(c, { childList: true, subtree: true }));
      }

      // wf-algolia is loaded with `async`, so it may not exist yet. Wait briefly
      // with a hard ceiling. The previous version polled every 100ms for a full
      // 10 seconds on EVERY page this file loaded on, which is the pattern we do
      // not want repeated.
      const MAX_TRIES = 20; // ~2s ceiling, exits the moment the engine appears

      let tries = 0;

      function arm() {
        if (window.WfAlgolia && typeof window.WfAlgolia.on === 'function') {
          window.WfAlgolia.on('results', applyNextFrame);
          applyNextFrame(); // covers a render that completed before we armed
          return;
        }
        if (++tries > MAX_TRIES) {
          applyNextFrame();
          return;
        }
        setTimeout(arm, 100);
      }

      // Both triggers, always. The observer reaches surfaces the browse-only
      // "results" event never fires for; the event covers browse re-renders
      // promptly without waiting on mutation batching.
      observeAllContainers();
      arm();
    }

    // Also CDN-loadable: a copy injected after DOMContentLoaded still boots.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
