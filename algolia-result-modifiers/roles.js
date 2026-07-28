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
          // Empty roles value. Strip the hook anyway: left in place it stays
          // matched forever, and every later pass would re-fire relayout into
          // the expert-card equalize pass for a card that never changes.
          p.removeAttribute('wf-algolia-text');
          return false;
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

      // Fallback only: observe EVERY browse/results container, not just the first.
      //
      // Why the first-match version was wrong: /all-starters has three
      // [wf-algolia-element="browse"] containers (Premium list, Free list, and the
      // gated-CTA block). querySelector bound to whichever came first, Memberstack
      // then gated the section that did not apply to the member, and the observer
      // was left watching a detached node while the engine rendered into a
      // different list. Nothing threw; roles simply never got processed.
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
