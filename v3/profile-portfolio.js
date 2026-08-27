/**
 * V3 profile portfolio / case-study renderer — /hire/<slug>
 *
 * Ported (behaviour-for-behaviour) from the on-canvas Code Embed that
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
 * OWNERSHIP SPLIT — this file fills data, it does not present anything.
 *
 * The Highlights modal is a native `<dialog data-modal-target="highlights">`
 * driven by the lumos modal system (`global-embeds/modal/modal.js`). Lumos owns
 * opening (through the card's authored `data-modal-trigger`), closing (its
 * `data-modal-close` controls and the dialog `cancel`/Escape event), the GSAP
 * open/close animation, focus restore and page-scroll locking. This renderer
 * owns the card list and the modal's DATA only: on card click it populates the
 * dialog's title, description, images and videos. It must never write to the
 * dialog's `style` — inline display writes stomp the GSAP timeline and the
 * modal loses its animation.
 *
 * It listens to two lumos events for data-side housekeeping only: `modal-open`
 * fills the first case study when the dialog is opened without a card click,
 * and `modal-close` pauses any video the visitor left playing, which
 * `dialog.close()` does not do. For a `?modal-id=highlights` deep link the
 * event is unreachable — lumos dispatches it from its own DOMContentLoaded
 * handler, before this one runs — so the dialog's open state is checked once
 * the approved rows arrive.
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
 *  5. Every modal lookup is scoped INSIDE the modal root, so an older hidden
 *     copy of the modal elsewhere in the DOM can never intercept the data.
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

  function stagingHost(hostname) {
    var host = hostname || '';
    return (
      /(\.|^)webflow\.io$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /(\.|^)trycloudflare\.com$/.test(host)
    );
  }

  // STARTERS_DEBUG may turn logging on in production. It never changes what this
  // script does — only whether it says anything about it.
  function diagnosticsEnabled() {
    if (window.STARTERS_DEBUG === true) return true;
    return stagingHost((window.location && window.location.hostname) || '');
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

    // The live modal is the native lumos <dialog>. Preferring it by tag name
    // stops a stale non-dialog copy earlier in the document from winning the
    // first match and swallowing every fill.
    var modal =
      document.querySelector('dialog[wf-portfolio-element="modal"]') ||
      pick('[wf-portfolio-element="modal"]', '.portfolio_modal-component');
    // Every modal lookup below is scoped to this root, for the same reason.
    var modalTitle = modal ? modal.querySelector('[portfolio-title]') : null;
    var modalDescription = modal ? modal.querySelector('[portfolio-description]') : null;
    var modalImages = modal
      ? pick('[wf-portfolio-element="images"]', '.portfolio_modal-images', modal)
      : null;
    var modalVideos = modal
      ? pick('[wf-portfolio-element="videos"]', '.portfolio_modal-videos', modal)
      : null;
    // Authored loading text. Absent until the Designer adds it — optional. It is
    // only ever cloned; the authored original is hidden once this script claims
    // the section, below.
    var loaderTemplate = modal ? modal.querySelector('[data-highlights-loader]') : null;
    // Guards against a slow response from an earlier card overwriting a newer one.
    var fillToken = 0;
    var loadedPortfolios = [];

    /** Xano file fields are not always strings; anything else has no URL. */
    function getAssetUrl(value) {
      if (typeof value !== 'string' || !value) return '';
      if (value.startsWith('http')) return value;
      if (value.startsWith('/')) return XANO_BASE_URL + value;
      return value;
    }

    /** Ask Xano for the large rendition without breaking an existing query. */
    function tplLarge(url) {
      if (!url) return '';
      return url + (url.indexOf('?') > -1 ? '&' : '?') + 'tpl=large';
    }

    function getThumbUrl(value) {
      var url = getAssetUrl(value);
      if (!url) return PLACEHOLDER_THUMB;
      return tplLarge(url);
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

    /** Empty a media container and drop in a loader clone while its fetch runs. */
    function startMediaSlot(container) {
      if (!container) return null;
      container.innerHTML = '';

      if (!loaderTemplate) {
        // Nothing to show while the read runs, so keep the section out of the
        // way rather than leaving the previous case study's heading over an
        // empty container.
        toggleModalBlock(container, false);
        return null;
      }

      // The previous case study may have left this section hidden. Reveal it so
      // the loading state actually paints; the settle-time render decides the
      // section's final visibility.
      toggleModalBlock(container, true);

      var clone = loaderTemplate.cloneNode(true);
      clone.style.display = '';
      container.appendChild(clone);
      return clone;
    }

    function removeLoader(clone) {
      if (!clone) return;
      if (typeof clone.remove === 'function') clone.remove();
      else if (clone.parentNode) clone.parentNode.removeChild(clone);
    }

    /** Rows whose asset URL is blank would render a broken element — drop them. */
    function withUsableAsset(rows, key) {
      return rows.filter(function (row) {
        if (!row) return false;
        return !!getAssetUrl(row[key]);
      });
    }

    function renderImages(container, loaderClone, images, portfolio) {
      if (!container) return;
      removeLoader(loaderClone);

      var usable = withUsableAsset(images, 'image_url');
      // Legacy case studies are text-only; without this the "Images" heading
      // renders with nothing under it. Mirrors the videos behaviour below.
      toggleModalBlock(container, usable.length > 0);

      usable.forEach(function (imageItem) {
        var img = document.createElement('img');
        img.src = tplLarge(getAssetUrl(imageItem.image_url));
        img.alt = portfolio.title || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.className = 'portfolio_modal-image';
        container.appendChild(img);
      });
    }

    function renderVideos(container, loaderClone, videos) {
      if (!container) return;
      removeLoader(loaderClone);

      var usable = withUsableAsset(videos, 'video_url');
      toggleModalBlock(container, usable.length > 0);

      usable.forEach(function (videoItem) {
        var video = document.createElement('video');
        video.src = getAssetUrl(videoItem.video_url);
        video.controls = true;
        video.className = 'portfolio_modal-video';
        container.appendChild(video);
      });
    }

    /**
     * Populate the dialog for one case study. Presentation (open, close,
     * animation, focus, scroll lock) belongs to the lumos modal system, which
     * receives the same click through the card's authored `data-modal-trigger`.
     */
    function fillModal(portfolio) {
      if (!modal) return Promise.resolve();

      var token = ++fillToken;

      if (modalTitle) modalTitle.textContent = truncateText(portfolio.title || '', 150);

      if (modalDescription) {
        // In full. The modal is the read-the-whole-thing surface, so nothing
        // clamps this text — see v3/hire-profile.js, which clamps card titles
        // only.
        modalDescription.style.whiteSpace = 'pre-line';
        modalDescription.textContent = portfolio.description || '';
      }

      var imagesLoader = startMediaSlot(modalImages);
      var videosLoader = startMediaSlot(modalVideos);

      return Promise.all([
        getPublicPortfolioImages(portfolio.id).then(function (images) {
          if (token !== fillToken) return;
          renderImages(modalImages, imagesLoader, images, portfolio);
        }),
        getPublicPortfolioVideos(portfolio.id).then(function (videos) {
          if (token !== fillToken) return;
          renderVideos(modalVideos, videosLoader, videos);
        }),
      ]);
    }

    /**
     * Is lumos showing the dialog right now? `showModal()` sets the native
     * `open` state, so this answers the question without having witnessed the
     * event that opened it.
     */
    function modalIsOpen() {
      if (!modal) return false;
      if (typeof modal.open === 'boolean') return modal.open;
      return typeof modal.hasAttribute === 'function' && modal.hasAttribute('open');
    }

    /**
     * lumos can open this dialog without a card click — a ?modal-id=highlights
     * deep link, or any stray trigger — which would otherwise show the authored
     * placeholder copy. Fill the first case study only while no case study has
     * been viewed yet: once the visitor has opened one, a later stray open keeps
     * what they were last looking at. And only while the dialog is actually
     * open, so a visitor who dismissed it during the approved read does not have
     * media fetched into a closed modal behind them.
     */
    function fillDefaultPortfolio() {
      if (fillToken !== 0 || !loadedPortfolios.length || !modalIsOpen()) return;
      fillModal(loadedPortfolios[0]);
    }

    function wireLumosEvents() {
      // Catches an open that happens after this script is listening. It cannot
      // catch a deep-link open: lumos dispatches modal-open synchronously inside
      // its own DOMContentLoaded handler, which runs before this one on the live
      // page. The dialog's open state is checked once the rows arrive instead.
      window.addEventListener('modal-open', function (event) {
        if (!modal || !event || !event.detail || event.detail.modal !== modal) return;

        // Deferred so a card click filling on this same click always wins,
        // whichever listener the browser runs first. By the time this runs, a
        // card handler has bumped the token and this becomes a no-op.
        setTimeout(function () {
          if (fillToken !== 0) return;
          fillDefaultPortfolio();
        }, 0);
      });

      // Closing a <dialog> does not stop its media. Without this, a video the
      // visitor started keeps playing behind the dismissed modal.
      window.addEventListener('modal-close', function (event) {
        if (!modal || !modalVideos || !event || !event.detail || event.detail.modal !== modal) {
          return;
        }
        if (typeof modalVideos.querySelectorAll !== 'function') return;

        var playing = modalVideos.querySelectorAll('video');
        Array.prototype.forEach.call(playing, function (video) {
          if (video && typeof video.pause === 'function') video.pause();
        });
      });
    }

    function createCard(portfolio) {
      var card = template.cloneNode(true);
      card.classList.remove('hidden');
      card.style.display = '';

      var image = pick('[wf-portfolio-element="thumb"]', '.portfolio_card-thumb', card);
      var title = pick('[wf-portfolio-element="title"]', '.portfolio_card-title', card);
      var idBlock = card.querySelector('.portfolio_card-id');

      if (image) {
        image.src = getThumbUrl(portfolio.thumbnail_url || portfolio.featured_image_url);
        image.loading = 'lazy';
        image.decoding = 'async';
      }

      if (title) title.textContent = portfolio.title || '';
      if (idBlock) idBlock.textContent = portfolio.id || '';

      // Fill on ANY click inside the card, not just the open control. lumos
      // opens from whichever element carries data-modal-trigger, and nothing
      // pins that to the open control — hire-profile.js rewrites trigger
      // attributes on this page. Filling on a click that does not open is
      // harmless; missing the click that does open is not.
      card.addEventListener('click', async function (event) {
        var target = event.target;
        // preventDefault keeps `<a href="#">` controls from jumping the page. It
        // does not stop propagation, so lumos still sees the click and opens.
        // Containment, not identity: a legacy-attributed anchor nested inside an
        // attribute-carrying wrapper must be caught too, or the page navigates.
        var control =
          target && typeof target.closest === 'function'
            ? target.closest(
                '[wf-portfolio-element="open"], [show-portfolio], [aria-label="open-modal"], a[href="#"]',
              )
            : null;
        if (control) event.preventDefault();

        await fillModal(portfolio);
      });

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
      try {
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
      } catch (error) {
        console.error('Images error:', error);
        return [];
      }
    }

    async function getPublicPortfolioVideos(portfolioId) {
      try {
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
      } catch (error) {
        console.error('Videos error:', error);
        return [];
      }
    }

    if (!wrapper || !template) return;

    if (wrapper.hasAttribute(OWNED)) return;
    wrapper.setAttribute(OWNED, 'cdn');

    // Everything below runs once per page. Nothing above this guard touches the
    // modal or binds a listener, so a second copy of this script stays inert.
    //
    // The loader is only ever cloned, so its authored original is hidden for
    // good: lumos can open the dialog without us (a ?modal-id=highlights deep
    // link), and an original left visible would show loading text with nothing
    // loading.
    if (loaderTemplate) loaderTemplate.style.display = 'none';

    // A dialog with no data-modal-target is not one lumos manages — almost
    // certainly the stale copy of the old modal, which would fill silently and
    // never open. Staging and debug only; production stays quiet.
    if (
      modal &&
      typeof modal.getAttribute === 'function' &&
      !modal.getAttribute('data-modal-target') &&
      diagnosticsEnabled()
    ) {
      console.warn(
        'Portfolio:',
        'modal root has no data-modal-target — lumos will not open this element',
      );
    }

    wireLumosEvents();

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

    loadedPortfolios = portfolios;
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

    // A deep link opened the dialog before these rows existed; fill it now. The
    // open state is authoritative — the modal-open event may have been
    // dispatched before this script's listener existed, and a visitor may have
    // dismissed the dialog while the read was in flight.
    if (modalIsOpen()) fillDefaultPortfolio();
  });
})();
