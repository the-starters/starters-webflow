// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/roles

  document.addEventListener('DOMContentLoaded', () => {
    const FIELD = 'roles';
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

    function listify(p) {
      const items = p.textContent.split(',').map(clean).filter(Boolean);
      if (!items.length) return;

      if (items.length === 1) {
        // single role: clean in place, no extra paragraphs
        p.textContent = items[0];
        p.removeAttribute('wf-algolia-text'); // prevents re-processing / loop
        return;
      }

      const clones = items.map(role => {
        const clone = p.cloneNode(false);        // copy <p> + its classes
        clone.removeAttribute('wf-algolia-text');
        clone.textContent = role;
        return clone;
      });
      p.replaceWith(...clones);
    }

    function run() {
      const nodes = document.querySelectorAll(`.wf-algolia-injected [wf-algolia-text="${FIELD}"]`);
      if (!nodes.length) return;
      nodes.forEach(listify);
      requestRelayout();
    }

    const container =
      document.querySelector('[wf-algolia-element="browse"]') ||
      document.querySelector('[wf-algolia-element="results"]');

    if (container) {
      new MutationObserver(run).observe(container, { childList: true, subtree: true });
    }
    run();
  });