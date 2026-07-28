// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/companies

  (function () {
    // The "Algolia Result Modifiers" component is instantiated inside BOTH the
    // Starters List - Premium and Starters List - Free components, so this file
    // loads twice on /all-starters. Guard so a duplicate never wires a second
    // listener / relayout dispatch. Bind once.
    if (window.__startersCompaniesModifierInit) return;
    window.__startersCompaniesModifierInit = true;

    const FIELD = 'also-worked-with'; // company list field
    const HOOK = `[wf-algolia-text="${FIELD}"]`;
    const INJECTED = `.wf-algolia-injected ${HOOK}`;

    function init() {
      // Marker gate: bail immediately on pages that have no company-bound template.
      if (!document.querySelector(HOOK)) return;

      let relayoutTimer;

      function requestRelayout() {
        clearTimeout(relayoutTimer);
        relayoutTimer = setTimeout(() => {
          window.dispatchEvent(new CustomEvent('expert-cards:relayout'));
        }, 60);
      }

      function normalize(p) {
        const current = p.textContent;
        const next = current
          .split(',')
          .map(s => s.trim().replace(/-/g, ' ').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(', ');           // ← comma + space between items
        if (next === current) return false; // already normalized → skip (no loop)
        p.textContent = next;
        return true;
      }

      function run() {
        const nodes = document.querySelectorAll(INJECTED);
        if (!nodes.length) return;
        let changed = false;
        nodes.forEach(p => { if (normalize(p)) changed = true; });
        if (changed) requestRelayout();
      }

      // Fallback only: observe EVERY browse/results container, not just the first.
      //
      // Why the first-match version was wrong: /all-starters has three
      // [wf-algolia-element="browse"] containers (Premium list, Free list, and the
      // gated-CTA block). querySelector bound to whichever came first, Memberstack
      // then gated the section that did not apply to the member, and the observer
      // was left watching a detached node while the engine rendered into a
      // different list. Nothing threw; the company list simply stayed unformatted.
      function observeAllContainers() {
        const containers = document.querySelectorAll(
          '[wf-algolia-element="browse"], [wf-algolia-element="results"]'
        );
        if (!containers.length) return;
        const observer = new MutationObserver(run);
        containers.forEach(c => observer.observe(c, { childList: true, subtree: true }));
      }

      // Preferred path: the engine's own render signal. wf-algolia emits "results"
      // after renderHits on both browse paths, so cards are in the DOM by then.
      //
      // Do NOT read the event payload here — the two paths pass different shapes
      // (single-index passes the raw Algolia response; federated passes
      // { results, nbHits, nbPages }). Always re-query the DOM instead.
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
          observeAllContainers();
          run();
          return;
        }
        setTimeout(arm, 100);
      }

      run(); // cheap no-op unless cards are somehow already on the page
      arm();
    }

    // Also CDN-loadable: a copy injected after DOMContentLoaded still boots.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
