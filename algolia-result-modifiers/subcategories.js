// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/subcategories

  (function () {
    // The "Algolia Result Modifiers" component is instantiated inside BOTH the
    // Starters List - Premium and Starters List - Free components, so this file
    // loads twice on /all-starters. Guard so a duplicate never wires a second
    // listener / relayout dispatch. Bind once.
    if (window.__startersSubcategoriesModifierInit) return;
    window.__startersSubcategoriesModifierInit = true;

    const FIELD = 'categories.lvl1';
    const HOOK = `[wf-algolia-text="${FIELD}"]`;
    const INJECTED = `.wf-algolia-injected ${HOOK}`;

    function init() {
      // Marker gate: bail immediately on pages that have no subcategory-bound
      // template. The template ships in the static DOM, so this is a reliable
      // "is this page even relevant" check and costs one selector query.
      if (!document.querySelector(HOOK)) return;

      let relayoutTimer;

      function requestRelayout() {
        clearTimeout(relayoutTimer);
        relayoutTimer = setTimeout(() => {
          window.dispatchEvent(new CustomEvent('expert-cards:relayout'));
        }, 60);
      }

      // Engine-joined categories.lvl1: Array#toString, comma, no spaces.
      // Each array item is a hierarchical path ("Parent > Child"). Parent
      // Category names in this taxonomy contain commas
      // ("Influencer, Affiliate & PR"), so we must NOT split on comma first.
      // Subcategory labels do not contain commas; that is the accepted
      // constraint that makes path reconstruction possible.
      //
      // Split on " > ". A comma inside a later fragment ends the current path
      // (the leaf) and starts the next parent. A fragment with no comma is a
      // deeper level of the same path and is not emitted until the last
      // segment — so "A > B > C" becomes "C".
      function subcategoryLeaves(text) {
        const raw = String(text || '').trim();
        if (!raw) return [];

        const parts = raw.split(/\s*>\s*/).map((part) => part.trim());
        if (parts.length === 1) {
          return /^[,>\s]*$/.test(parts[0]) ? [] : [parts[0]];
        }

        const leaves = [];
        for (let i = 1; i < parts.length; i += 1) {
          const fragment = parts[i];
          if (!fragment) continue;
          const isLast = i === parts.length - 1;
          const commaAt = fragment.indexOf(',');
          if (commaAt === -1) {
            if (isLast) leaves.push(fragment);
            continue;
          }
          const leaf = fragment.slice(0, commaAt).trim();
          if (leaf) leaves.push(leaf);
        }
        return leaves.filter(Boolean);
      }

      // Returns true only when the node was actually rewritten, so relayout is
      // never dispatched for a no-op pass (matches roles.js / companies.js).
      function listify(p) {
        const items = subcategoryLeaves(p.textContent);

        if (!items.length) {
          const changed = p.textContent !== '';
          p.textContent = '';
          p.removeAttribute('wf-algolia-text');
          return changed;
        }

        if (items.length === 1) {
          const changed = items[0] !== p.textContent;
          p.textContent = items[0];
          p.removeAttribute('wf-algolia-text');
          return changed;
        }

        const clones = items.map((leaf) => {
          const clone = p.cloneNode(false);
          clone.removeAttribute('wf-algolia-text');
          clone.textContent = leaf;
          return clone;
        });
        p.replaceWith(...clones);
        return true;
      }

      function run() {
        const nodes = document.querySelectorAll(INJECTED);
        if (!nodes.length) return;
        let changed = false;
        nodes.forEach((p) => { if (listify(p)) changed = true; });
        if (changed) requestRelayout();
      }

      // Observe EVERY browse/results container, not just the first, and do it
      // unconditionally rather than only as a fallback.
      //
      // Two separate reasons, both verified on /all-starters for this family:
      //
      // 1. First-match was wrong. The page has several
      //    [wf-algolia-element="browse"] containers (Premium list, Free list,
      //    gated-CTA counter). querySelector bound to whichever came first,
      //    Memberstack then gated the section that did not apply to the
      //    member, and the observer was left watching a detached node while
      //    the engine rendered into a different list.
      // 2. The engine emits "results" from BROWSE MODE ONLY. The search
      //    overlay (the "results" role) renders through a path that fires no
      //    event at all. The observer is what covers that surface.
      //
      // Only childList is observed, so the engine's inline show/hide of
      // sections (attribute mutations) causes no churn here.
      function observeAllContainers() {
        const containers = document.querySelectorAll(
          '[wf-algolia-element="browse"], [wf-algolia-element="results"]'
        );
        if (!containers.length) {
          if (/webflow\.io$|^localhost$|trycloudflare\.com$/.test(location.hostname) || window.STARTERS_DEBUG) {
            console.warn('[starters subcategories] no wf-algolia browse/results container found — only the engine results event can trigger this modifier.');
          }
          return;
        }
        const observer = new MutationObserver(run);
        containers.forEach((c) => observer.observe(c, { childList: true, subtree: true }));
      }

      // Do NOT read the event payload. The two browse paths pass different
      // shapes: single-index passes the raw Algolia response (which HAS
      // `hits`), the federated path used on first load passes
      // { results, nbHits, nbPages } and has NO `hits`. Always re-query the DOM.
      //
      // wf-algolia is loaded with `async`, so it may not exist yet. Wait
      // briefly and give up quickly rather than polling for seconds.
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

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
