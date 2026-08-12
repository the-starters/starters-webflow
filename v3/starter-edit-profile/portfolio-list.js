/**
 * GitHub-owned copy of the Starter Edit Profile Webflow controller block.
 * Original live inline body SHA-256: 2d0a3261493ac1e07a63a16981083920425e91315ced4d84d3f9d6e6709bfb18
 * Captured read-only from /starter-edit-profile on 2026-08-12.
 */
  // Loads and renders the current member's portfolio cards from Xano.
  document.addEventListener('DOMContentLoaded', async function () {
    waitForMember(async () => {
      if (!MEMBER.id) return;
      
      const XANO_BASE_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io';
      const XANO_GET_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Get_my_portfolios';

      const block = qs('#portfolio-block');
      const wrapper = qs('.case-studies-wrapper');
      const template = wrapper ? qs('.portfolio_card', wrapper) : null;
      const viewAllButton = qs('[data-btn-view-all]');
      const skipBlock = qs('[skip-highlights]');

      if (!wrapper || !template) return;

      function getAssetUrl(value) {
        if (!value) return '';
        if (value.startsWith('http')) return value;
        if (value.startsWith('/')) return XANO_BASE_URL + value;
        return value;
      }

      function getThumbUrl(value) {
        const url = getAssetUrl(value);

        if (!url) {
          return 'https://cdn.prod.website-files.com/plugins/Basic/assets/placeholder.60f9b1840c.svg';
        }

        return url + '?tpl=large';
      }

      async function loadPortfolios() {
        const response = await fetch(`${XANO_GET_URL}?memberstack_id=${encodeURIComponent(MEMBER.id)}&_=${Date.now()}`);
        const data = await response.json();

        if (!response.ok) {
          console.error('Get portfolios error:', data);
          throw new Error('Failed to load portfolios');
        }

        return Array.isArray(data) ? data : [];
      }

      function createPortfolioCard(portfolio) {
        const card = template.cloneNode(true);

        card.classList.remove('hidden');
        card.style.display = '';

        const image = qs('.portfolio_card-thumb', card);
        const title = qs('.portfolio_card-title', card);
        const description = qs('.portfolio_card-description', card);
        const idBlock = qs('.portfolio_card-id', card);

        if (image) {
          image.src = getThumbUrl(portfolio.thumbnail_url || portfolio.featured_image_url);
          image.loading = 'lazy';
          image.decoding = 'async';
        }

        if (title) title.textContent = portfolio.title || '';
        if (description) description.textContent = portfolio.description || '';
        if (idBlock) idBlock.textContent = portfolio.id || '';

        return card;
      }

      function removeBtnVisibility() {
        const cards = qsa('.portfolio_card:not(:first-child)', wrapper);
        cards.forEach(function (card) {
          const btn = qs('[open-remove-modal]', card);
          if (btn) btn.style.display = cards.length <= 1 ? 'none' : '';
        });
      }

      async function renderPortfolios() {
        try {
          const portfolios = await loadPortfolios();

          qsa('.portfolio_card:not(:first-child)', wrapper).forEach(function (card) {
            card.remove();
          });

          template.style.display = 'none';

          if (!portfolios.length) {
            if (viewAllButton) viewAllButton.style.display = 'none';
            if (skipBlock) skipBlock.style.display = 'flex';
            return;
          }

          if (skipBlock) skipBlock.style.display = 'none';

          portfolios.forEach(function (portfolio) {
            wrapper.appendChild(createPortfolioCard(portfolio));
          });

          removeBtnVisibility();

          if (viewAllButton) {
            viewAllButton.style.display = portfolios.length < 4 ? 'none' : '';
          }
        } catch (error) {
          console.error('Render portfolios failed:', error);
        }
      }

      window.addEventListener('portfolio-created', renderPortfolios);

      await renderPortfolios();
    });
  });

