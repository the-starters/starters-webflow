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
        if (!containers.length) {
          // Both the engine and every container are missing: the file is inert
          // from here. Say so on staging/local only — this whole bug class is
          // silent by nature and cost a debugging session once already.
          if (/webflow\.io$|^localhost$|trycloudflare\.com$/.test(location.hostname) || window.STARTERS_DEBUG) {
            console.warn('[starters companies] no wf-algolia engine and no browse/results container — modifier is inert.');
          }
          return;
        }
        const observer = new MutationObserver(run);
        containers.forEach(c => observer.observe(c, { childList: true, subtree: true }));
      }

      // Preferred path: the engine's own render signal. wf-algolia emits "results"
      // after renderHits on both browse paths, so cards are in the DOM by then.
      //
      // Do NOT read the event payload here. The two paths pass different shapes:
      // single-index passes the raw Algolia response (which HAS `hits`), the
      // federated path — the one used on first load — passes
      // { results, nbHits, nbPages } and has NO `hits`. So `payload.hits` is
      // undefined exactly when you would first test it. Always re-query the DOM.
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

      // No standalone run() here: both arm() outcomes call it (immediately on
      // success, or after the fallback observer is wired).
      arm();
    }

    // Also CDN-loadable: a copy injected after DOMContentLoaded still boots.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
