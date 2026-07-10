// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/companies

  document.addEventListener('DOMContentLoaded', () => {
    const FIELD = 'also-worked-with'; // company list field
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
      const nodes = document.querySelectorAll(`.wf-algolia-injected [wf-algolia-text="${FIELD}"]`);
      if (!nodes.length) return;
      let changed = false;
      nodes.forEach(p => { if (normalize(p)) changed = true; });
      if (changed) requestRelayout();
    }

    const container =
      document.querySelector('[wf-algolia-element="browse"]') ||
      document.querySelector('[wf-algolia-element="results"]');

    if (container) {
      new MutationObserver(run).observe(container, { childList: true, subtree: true });
    }
    run();
  });