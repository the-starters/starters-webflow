// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/roles

  (function () {
    // The "Algolia Result Modifiers" component is instantiated inside BOTH the
    // Starters List - Premium and Starters List - Free components, so this file
    // loads twice on /all-starters. Guard so a duplicate never wires a second
    // listener / relayout dispatch. Bind once.
    if (window.__startersRolesModifierInit) return;
    window.__startersRolesModifierInit = true;

    const FIELD = 'roles';
    const HOOK = `[wf-algolia-text="${FIELD}"]`;
    const INJECTED = `.wf-algolia-injected ${HOOK}`;

    function init() {
      // Marker gate: bail immediately on pages that have no roles-bound template.
      // The template ships in the static DOM, so this is a reliable "is this page
      // even relevant" check and costs one selector query.
      if (!document.querySelector(HOOK)) return;

      let relayoutTimer;

      function requestRelayout() {
        clearTimeout(relayoutTimer);
        relayoutTimer = setTimeout(() => {
          window.dispatchEvent(new CustomEvent('expert-cards:relayout'));
        }, 60);
      }

      function clean(role) {
        return role.trim().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      }

      // Returns true only when the node was actually rewritten, so relayout is
      // never dispatched for a no-op pass (matches companies.js).
      function listify(p) {
        const items = p.textContent.split(',').map(clean).filter(Boolean);

        if (!items.length) {
          // Nothing survived cleaning (empty value, or punctuation-only like
          // "," / "-"). Blank the text so a stray separator never renders, and
          // strip the hook: left in place it stays matched forever, and every
          // later pass would re-fire relayout into the expert-card equalize
          // pass for a card that never changes.
          const changed = p.textContent !== '';
          p.textContent = '';
          p.removeAttribute('wf-algolia-text');
          return changed;
        }

        if (items.length === 1) {
          // single role: clean in place, no extra paragraphs
          const changed = items[0] !== p.textContent;
          p.textContent = items[0];
          p.removeAttribute('wf-algolia-text'); // prevents re-processing / loop
          return changed;
        }

        const clones = items.map(role => {
          const clone = p.cloneNode(false);        // copy <p> + its classes
          clone.removeAttribute('wf-algolia-text');
          clone.textContent = role;
          return clone;
        });
        p.replaceWith(...clones);
        return true;
      }

      function run() {
        const nodes = document.querySelectorAll(INJECTED);
        if (!nodes.length) return;
        let changed = false;
        nodes.forEach(p => { if (listify(p)) changed = true; });
        if (changed) requestRelayout();
      }

      // Observe EVERY browse/results container, not just the first, and do it
      // unconditionally rather than only as a fallback.
      //
      // Two separate reasons, both verified on /all-starters:
      //
      // 1. First-match was wrong. The page has three
      //    [wf-algolia-element="browse"] containers (Premium list, Free list, and
      //    the gated-CTA counter). querySelector bound to whichever came first,
      //    Memberstack then gated the section that did not apply to the member,
      //    and the observer was left watching a detached node while the engine
      //    rendered into a different list.
      // 2. The engine emits "results" from BROWSE MODE ONLY. The search overlay
      //    (.search-brilliance_results-wrapper, which carries the "results" role)
      //    renders through a path that fires no event at all: typing a query
      //    there produced six cards with raw "cro-expert,ui-ux-designer" and
      //    zero results events. So the event alone cannot cover that surface;
      //    this observer is what covers it.
      //
      // Only childList is observed, so the engine's inline show/hide of sections
      // (attribute mutations) causes no churn here.
      function observeAllContainers() {
        const containers = document.querySelectorAll(
          '[wf-algolia-element="browse"], [wf-algolia-element="results"]'
        );
        if (!containers.length) {
          // Nothing to watch, so any surface that never emits "results" is
          // uncovered. Say so on staging/local only — this whole bug class is
          // silent by nature and cost a debugging session once already.
          if (/webflow\.io$|^localhost$|trycloudflare\.com$/.test(location.hostname) || window.STARTERS_DEBUG) {
            console.warn('[starters roles] no wf-algolia browse/results container found — only the engine results event can trigger this modifier.');
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
          run();
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
