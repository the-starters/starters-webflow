// Docs: https://wf-starter-embeds-docs.vercel.app/docs/algolia-result-modifiers/price-label

  (function () {
    const start = Date.now();

    const apply = () => {
      const cards = document.querySelectorAll('.expert-card_item');
      let processed = 0;

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
        processed++;
      });

      //console.log('[expert-label] apply: cards=' + cards.length + ' processed=' + processed);
    };

    const init = () => {
      window.WfAlgolia.on('response', () => requestAnimationFrame(apply));

      // Re-run whenever the results list mutates (covers async cloning / load-more)
      const observer = new MutationObserver(() => requestAnimationFrame(apply));
      const target =
        document.querySelector('[wf-algolia-element="results"]') ||
        document.querySelector('[wf-algolia-element="browse"]') ||
        document.querySelector('.expert-card_item')?.parentElement ||
        document.body;
      observer.observe(target, { childList: true, subtree: true });

      requestAnimationFrame(apply);
      //console.log('[expert-label] wired up; observing', target);
    };

    const waitForApi = setInterval(() => {
      if (window.WfAlgolia) { clearInterval(waitForApi); init(); }
      else if (Date.now() - start > 10000) {
        clearInterval(waitForApi);
        //console.warn('[expert-label] WfAlgolia never appeared after 10s');
      }
    }, 100);
  })();