// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/learn-categories

  (function () {
    // The "Algolia Result Modifiers" component is instantiated inside BOTH the
    // Starters List - Premium and Starters List - Free components, so this file
    // loads twice on /all-starters. Without this guard it wired a second
    // MutationObserver over the same containers. Bind once.
    if (window.__startersLearnCategoriesInit) return;
    window.__startersLearnCategoriesInit = true;

    const HOOK = 'data-learn-category';
    const SELECTOR = `[${HOOK}]`;
    const INJECTED = `.wf-algolia-injected ${SELECTOR}`;

    function init() {
      // Marker gate: bail immediately on pages with no learn-category template.
      if (!document.querySelector(SELECTOR)) return;

      // Official display names (from the site's CMS category list).
      // Update this map whenever categories are added/renamed in the CMS;
      // unmapped slugs fall back to prettify() below.
      const CATEGORY_LABELS = {
        'ai-technology': 'AI & Technology',
        'analytics-experimentation': 'Analytics & Experimentation',
        'content-organic': 'Content & Organic',
        'creative-brand': 'Creative & Brand',
        'finance': 'Finance',
        'hiring-team-building': 'Hiring & Team Building',
        'influencer-affiliate-pr': 'Influencer, Affiliate & PR',
        'marketing-strategy-leadership': 'Marketing Strategy & Leadership',
        'operations-supply-chain': 'Operations & Supply Chain',
        'paid-media': 'Paid Media',
        'physical-product-development': 'Physical Product & Development',
        'retail-marketplace': 'Retail & Marketplace',
        'retention-crm': 'Retention & CRM'
      };

      function prettify(s) {
        return s
          .trim()
          .replace(/-/g, ' ')          // hyphens → spaces
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\b\w/g, c => c.toUpperCase()); // Capitalize Each Word
      }

      function pillify(seed) {
        const items = seed.textContent
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(slug => CATEGORY_LABELS[slug] || prettify(slug)); // map first, prettify fallback
        if (!items.length) { seed.remove(); return; } // empty categories → no stray pill

        const clones = items.map(label => {
          const clone = seed.cloneNode(false);       // copies span + its classes
          clone.removeAttribute('wf-algolia-text');
          clone.removeAttribute(HOOK);               // prevents re-processing / loop
          clone.textContent = label;
          return clone;
        });
        seed.replaceWith(...clones);
      }

      function run() {
        const nodes = document.querySelectorAll(INJECTED);
        if (!nodes.length) return;
        nodes.forEach(pillify);
      }

      // Observe EVERY browse/results container, not just the first, and do it
      // unconditionally rather than only as a fallback.
      //
      // This file's targets live in the SEARCH OVERLAY
      // (.search-brilliance_results-wrapper, which carries the "results" role),
      // not in the browse grid. The old code resolved a single container with
      // querySelector and preferred [wf-algolia-element="browse"], so it bound to
      // the browse grid and never saw the overlay renders it exists to process —
      // leaving raw slugs on the page. The engine also emits "results" from
      // browse mode ONLY, so the event alone cannot cover the overlay either.
      //
      // Only childList is observed, so the engine's inline show/hide of sections
      // (attribute mutations) causes no churn here.
      function observeAllContainers() {
        const containers = document.querySelectorAll(
          '[wf-algolia-element="browse"], [wf-algolia-element="results"]'
        );
        if (!containers.length) {
          if (/webflow\.io$|^localhost$|trycloudflare\.com$/.test(location.hostname) || window.STARTERS_DEBUG) {
            console.warn('[starters learn-categories] no wf-algolia browse/results container found — only the engine results event can trigger this modifier.');
          }
          return;
        }
        const observer = new MutationObserver(run);
        containers.forEach(c => observer.observe(c, { childList: true, subtree: true }));
      }

      // Do NOT read the event payload here. The two browse paths pass different
      // shapes: single-index passes the raw Algolia response (which HAS `hits`),
      // the federated path used on first load passes { results, nbHits, nbPages }
      // and has NO `hits`. Always re-query the DOM.
      //
      // wf-algolia is loaded with `async`, so it may not exist yet. Wait briefly
      // and give up quickly rather than polling for seconds.
      const MAX_TRIES = 20; // ~2s ceiling, exits the moment the engine appears

      let tries = 0;

      function arm() {
        if (window.WfAlgolia && typeof window.WfAlgolia.on === 'function') {
          window.WfAlgolia.on('results', run);
          run(); // covers a render that completed before we armed
          return;
        }
        if (++tries > MAX_TRIES) {
          run();
          return;
        }
        setTimeout(arm, 100);
      }

      observeAllContainers();
      arm();
    }

    // Also CDN-loadable: a copy injected after DOMContentLoaded still boots.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
