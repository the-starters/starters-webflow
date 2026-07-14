// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/learn-categories

  document.addEventListener('DOMContentLoaded', () => {
    const HOOK = 'data-learn-category';

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
      const nodes = document.querySelectorAll(`.wf-algolia-injected [${HOOK}]`);
      if (!nodes.length) return;
      nodes.forEach(pillify);
    }

    const container =
      document.querySelector('[wf-algolia-element="browse"]') ||
      document.querySelector('[wf-algolia-element="results"]');

    if (container) {
      new MutationObserver(run).observe(container, { childList: true, subtree: true });
    }
    run();
  });