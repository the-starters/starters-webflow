/**
 * V3 profile portfolio / case-study renderer — /hire/<slug>
 *
 * Ported verbatim (behaviour-for-behaviour) from the on-canvas Code Embed that
 * previously lived inside the "Embed Code" component on the hire template, so
 * that this logic lives in GitHub instead of in Webflow. See
 * platform-ops/migrations/2026-08-14-legacy-case-studies/renderer-location-findings.md
 *
 * Renders the section labelled "Highlights" on the profile. It reads Xano
 * Portfolios (#28) through Get_approved_portfolios, which resolves the starter
 * via freelancers_v3 (#82) and returns approved public rows only. As of
 * 2026-08-15 that table also holds 1,439 imported
 * legacy V2 case studies, which are TEXT ONLY.
 *
 * Five deliberate changes from the embed:
 *
 *  1. memberstackId is read from the page's existing `starter_memberstack_id`
 *     global instead of being hardcoded. In the embed the value came from a CMS
 *     binding, so the rendered output carried one starter's literal id.
 *  2. Elements are found by ATTRIBUTE first, class second. Per AGENTS.md,
 *     behaviour binds to custom attributes, never styling classes. The class
 *     fallbacks let this run before the Designer attributes are added, and can
 *     be deleted once they are.
 *  3. The modal's Images block is hidden when a portfolio has no images, exactly
 *     as the Videos block already was. Without this, every text-only case study
 *     shows an empty "Images" heading.
 *  4. Only three case studies show initially. The authored View all control
 *     reveals the complete approved set when more case studies exist.
 *  5. The modal closes from its close control, scrim, or Escape key. Modal
 *     behaviour is wired by `wf-portfolio-element` attributes first.
 *
 * Ownership: this CDN file is the only Highlights renderer. The legacy on-canvas
 * owner-read embed must be removed in the same Webflow whole-block cutover.
 */
(function () {
  'use strict';

  var XANO_BASE_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io';
  var PLACEHOLDER_THUMB =
    'https://cdn.prod.website-files.com/plugins/Basic/assets/placeholder.60f9b1840c.svg';
  var OWNED = 'data-portfolio-rendered';
  var INITIAL_VISIBLE_COUNT = 3;

  function pick(attrSelector, classSelector, scope) {
    var root = scope || document;
    return root.querySelector(attrSelector) || root.querySelector(classSelector);
  }

  function getMemberstackId() {
    if (typeof window.starter_memberstack_id === 'string' && window.starter_memberstack_id) {
      return window.starter_memberstack_id;
    }
    var host = document.querySelector('[data-starter-memberstack-id]');
    return host ? host.getAttribute('data-starter-memberstack-id') : '';
  }

  document.addEventListener('DOMContentLoaded', async function () {
    var memberstackId = getMemberstackId();
    if (!memberstackId) {
      console.warn('Portfolio:', 'No starter memberstack id on the page');
      return;
    }

    var XANO_GET_APPROVED_URL =
      XANO_BASE_URL +
      '/api:PmBJV0AG/Get_approved_portfolios?memberstack_id=' +
      encodeURIComponent(memberstackId);

    var block = document.querySelector('#portfolio-block');
    var section = pick('[portfolio-section]', '.profile-hightlights_wr');
    var wrapper = pick('[data-highlights]', '.case-studies-wrapper');
    var template = wrapper
      ? pick('[wf-portfolio-element="card"]', '.portfolio_card', wrapper)
      : null;
    if (template) template.classList.add('hidden');

    var modal = pick('[wf-portfolio-element="modal"]', '.portfolio_modal-component');
    var modalContent = modal
      ? pick('[wf-portfolio-element="content"]', '.portfolio_modal-content', modal)
      : null;
    var modalScrim = modal
      ? pick('[wf-portfolio-element="scrim"]', '.portfolio_modal-background', modal)
      : null;
    var modalTitle = document.querySelector('[portfolio-title]');
    var modalDescription = document.querySelector('[portfolio-description]');
    var modalImages = pick('[wf-portfolio-element="images"]', '.portfolio_modal-images');
    var modalVideos = pick('[wf-portfolio-element="videos"]', '.portfolio_modal-videos');
    var lastModalTrigger = null;
    var bodyOverflowBeforeOpen = '';

    function isModalOpen() {
      return !!modal && modal.style.display !== 'none';
    }

    function getAssetUrl(value) {
      if (!value) return '';
      if (value.startsWith('http')) return value;
      if (value.startsWith('/')) return XANO_BASE_URL + value;
      return value;
    }

    function getThumbUrl(value) {
      var url = getAssetUrl(value);
      if (!url) return PLACEHOLDER_THUMB;
      return url + '?tpl=large';
    }

    function truncateText(text, maxLength) {
      if (typeof text !== 'string' || text.length <= maxLength) return text || '';
      return text.slice(0, maxLength).trim() + '...';
    }

    /** Show or hide a modal block's wrapper based on whether it has content. */
    function toggleModalBlock(el, hasContent) {
      if (!el) return;
      var contentWrapper = el.closest('.portfolio_modal-content-wrapper');
      if (!contentWrapper) return;
      contentWrapper.style.display = hasContent ? '' : 'none';
    }

    async function openModal(portfolio, trigger) {
      if (!modal) return;

      if (!isModalOpen()) bodyOverflowBeforeOpen = document.body.style.overflow || '';
      lastModalTrigger = trigger || document.activeElement || null;

      if (modalTitle) modalTitle.textContent = truncateText(portfolio.title || '', 150);
      if (modalDescription) {
        var oldToggle = modal.querySelector('[data-toggle-for="description"]');
        if (oldToggle) oldToggle.remove();
        delete modalDescription.dataset.fullTextdescription;
        delete modalDescription.dataset.expandeddescription;

        modalDescription.style.whiteSpace = 'pre-line';
        modalDescription.textContent = portfolio.description || '';
      }

      var images = await getPublicPortfolioImages(portfolio.id);
      var videos = await getPublicPortfolioVideos(portfolio.id);

      if (modalImages) {
        modalImages.innerHTML = '';
        // Legacy case studies are text-only; without this the "Images" heading
        // renders with nothing under it. Mirrors the videos behaviour below.
        toggleModalBlock(modalImages, images.length > 0);

        images.forEach(function (imageItem) {
          var img = document.createElement('img');
          img.src = getAssetUrl(imageItem.image_url) + '?tpl=large';
          img.alt = portfolio.title || '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.className = 'portfolio_modal-image';
          modalImages.appendChild(img);
        });
      }

      if (modalVideos) {
        modalVideos.innerHTML = '';
        toggleModalBlock(modalVideos, videos.length > 0);

        videos.forEach(function (videoItem) {
          var video = document.createElement('video');
          video.src = getAssetUrl(videoItem.video_url);
          video.controls = true;
          video.className = 'portfolio_modal-video';
          modalVideos.appendChild(video);
        });
      }

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function closeModal(options) {
      if (!modal) return;
      var restoreFocus = !options || options.restoreFocus !== false;
      modal.style.display = 'none';
      document.body.style.overflow = bodyOverflowBeforeOpen;

      if (modalContent) modalContent.scrollTop = 0;

      if (restoreFocus && lastModalTrigger && typeof lastModalTrigger.focus === 'function') {
        lastModalTrigger.focus();
      }
      lastModalTrigger = null;
    }

    function wireModalDismiss() {
      if (!modal) return;

      modal.addEventListener('click', function (event) {
        var target = event.target;
        var closeControl =
          target && typeof target.closest === 'function'
            ? target.closest(
                '[wf-portfolio-element="close"], [data-modal-close], [aria-label="close-modal"], .portfolio_modal-close',
              )
            : null;

        if (closeControl || target === modal || (modalScrim && target === modalScrim)) {
          event.preventDefault();
          closeModal();
        }
      });

      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !isModalOpen()) return;
        event.preventDefault();
        closeModal();
      });
    }

    function createCard(portfolio) {
      var card = template.cloneNode(true);
      card.classList.remove('hidden');
      card.style.display = '';

      var image = pick('[wf-portfolio-element="thumb"]', '.portfolio_card-thumb', card);
      var title = pick('[wf-portfolio-element="title"]', '.portfolio_card-title', card);
      var idBlock = card.querySelector('.portfolio_card-id');
      var openButton =
        card.querySelector('[wf-portfolio-element="open"]') ||
        card.querySelector('[show-portfolio], [aria-label="open-modal"]');

      if (image) {
        image.src = getThumbUrl(portfolio.thumbnail_url || portfolio.featured_image_url);
        image.loading = 'lazy';
        image.decoding = 'async';
      }

      if (title) title.textContent = portfolio.title || '';
      if (idBlock) idBlock.textContent = portfolio.id || '';

      if (openButton) {
        openButton.addEventListener('click', async function (event) {
          event.preventDefault();
          await openModal(portfolio, openButton);
        });
      }

      return card;
    }

    async function loadPortfolios() {
      var response = await fetch(XANO_GET_APPROVED_URL);
      var data = await response.json();

      if (!response.ok || !Array.isArray(data)) {
        throw new Error('PUBLIC_PORTFOLIO_READ_FAILED');
      }

      return data.slice().sort(function (a, b) {
        var aHasOrder = a.ordinal !== null && a.ordinal !== '' && Number.isFinite(Number(a.ordinal));
        var bHasOrder = b.ordinal !== null && b.ordinal !== '' && Number.isFinite(Number(b.ordinal));
        if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;

        var aOrder = aHasOrder ? Number(a.ordinal) : 0;
        var bOrder = bHasOrder ? Number(b.ordinal) : 0;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return Number(a.id) - Number(b.id);
      });
    }

    async function getPublicPortfolioImages(portfolioId) {
      var response = await fetch(
        XANO_BASE_URL +
          '/api:PmBJV0AG/Get_public_portfolio_images?portfolio_id=' +
          encodeURIComponent(portfolioId),
      );
      var data = await response.json();
      if (!response.ok) {
        console.error('Images error:', data);
        return [];
      }
      return Array.isArray(data) ? data : [];
    }

    async function getPublicPortfolioVideos(portfolioId) {
      var response = await fetch(
        XANO_BASE_URL +
          '/api:PmBJV0AG/Get_public_portfolio_videos?portfolio_id=' +
          encodeURIComponent(portfolioId),
      );
      var data = await response.json();
      if (!response.ok) {
        console.error('Videos error:', data);
        return [];
      }
      return Array.isArray(data) ? data : [];
    }

    wireModalDismiss();

    if (!wrapper || !template) return;

    if (wrapper.hasAttribute(OWNED)) return;
    wrapper.setAttribute(OWNED, 'cdn');

    closeModal({ restoreFocus: false });

    var canRevealPortfolios = false;
    var viewAllButton = document.querySelector('[data-btn-view-all]');

    if (viewAllButton) {
      viewAllButton.style.display = 'none';
      viewAllButton.addEventListener('click', function (event) {
        event.preventDefault();
        if (!canRevealPortfolios) return;

        var cards = wrapper.querySelectorAll('[data-portfolio-item]');
        cards.forEach(function (card) {
          card.style.display = '';
        });
        canRevealPortfolios = false;
        viewAllButton.style.display = 'none';
      });
    }

    var portfolios;
    try {
      portfolios = await loadPortfolios();
    } catch (error) {
      console.error('Portfolio: approved public read failed');
      return;
    }

    template.classList.add('hidden');

    if (!portfolios.length) {
      if (block) block.classList.add('hidden');
      if (section) section.classList.add('hidden');
      return;
    }

    if (section) section.style.display = 'block';

    if (window.location.hostname === 'the-starters.webflow.io') {
      if (block) block.classList.remove('hidden');
    }

    portfolios.forEach(function (portfolio, index) {
      var card = createCard(portfolio);
      card.setAttribute('data-portfolio-item', '');
      if (index >= INITIAL_VISIBLE_COUNT) card.style.display = 'none';
      wrapper.appendChild(card);
    });

    canRevealPortfolios = portfolios.length > INITIAL_VISIBLE_COUNT;
    if (viewAllButton && canRevealPortfolios) viewAllButton.style.display = '';
  });
})();
