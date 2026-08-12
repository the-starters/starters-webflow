/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: 7ab803c9890b802f154c6f5c3f0a6d5906624f71b9683153b2f5798617e1070d
 * Captured read-only from /build-profile/consult on 2026-08-12.
 */
  // Manages portfolio CRUD, media uploads, previews, and edit/remove modals.
  document.addEventListener('DOMContentLoaded', async function () {
    waitForMember(async () => {
      if (!MEMBER.id) return;

      const XANO_BASE_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io';
      const XANO_GET_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Get_my_portfolios`;
      const XANO_CREATE_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Create_portfolio`;
      const XANO_UPDATE_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Update_portfolio`;
      const XANO_DELETE_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Delete_portfolio`;
      const XANO_UPLOAD_URL = `${XANO_BASE_URL}/api:PmBJV0AG/upload-image`;
      const XANO_ADD_IMAGE_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Add_portfolio_image`;
      const XANO_GET_IMAGES_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Get_portfolio_images`;
      const XANO_UPLOAD_VIDEO_URL = `${XANO_BASE_URL}/api:PmBJV0AG/upload-video`;
      const XANO_ADD_VIDEO_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Add_portfolio_video`;
      const XANO_GET_VIDEOS_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Get_portfolio_videos`;
      const XANO_DELETE_IMAGE_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Delete_portfolio_image`;
      const XANO_DELETE_VIDEO_URL = `${XANO_BASE_URL}/api:PmBJV0AG/Delete_portfolio_video`;

      const PLACEHOLDER_IMAGE = 'https://cdn.prod.website-files.com/plugins/Basic/assets/placeholder.60f9b1840c.svg';
      const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
      const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
      const MAX_PORTFOLIOS = 9;

      const grid = qs('[data-highlights]');
      const template = grid ? qs('.portfolio_card', grid) : null;

      const editModal = qs('[data-modal-target="portfolio-edit"]');
      const editModalTrigger = qs('[data-modal-trigger="portfolio-edit"]');
      const editModalClose = qs('[data-modal-close]', editModal);

      const removeModal = qs('[data-modal-target="portfolio-remove"]');
      const removeModalTrigger = qs('[data-modal-trigger="portfolio-remove"]');
      const removeModalClose = qs('[data-modal-close]', removeModal);

      const notificationModal = qs('[data-modal-target="portfolio-notification"]');
      const notificationModalTrigger = qs('[data-modal-trigger="portfolio-notification"]');
      const notificationModalClose = qs('[data-modal-close]', notificationModal);
      const notificationText = notificationModal ? qs('[notification-text]', notificationModal) : null;

      const createSubmit = qs('#add-highlight');
      const editForm = qs('#wf-form-Portfolio-update');
      const editSubmit = qs('[free-edit-submit]');

      const titleInput = qs('#portfolio-title');
      const descriptionInput = qs('#portfolio-description');
      const editTitleInput = qs('#portfolio-title-edit');
      const editDescriptionInput = qs('#portfolio-description-edit');
      const imagesInput = qs('#portfolio-images');
      const previewWrapper = qs('#portfolio-images-preview');
      const coverIndexInput = qs('#portfolio-cover-index');

      const editImagesInput = qs('#portfolio-images-edit');
      const editPreviewWrapper = qs('#portfolio-images-edit-preview');
      const videosInput = qs('#portfolio-videos');
      const videosPreviewWrapper = qs('#portfolio-videos-preview');
      const editVideosInput = qs('#portfolio-videos-edit');
      const editVideosPreviewWrapper = qs('#portfolio-videos-edit-preview');

      const firstPortfolioInput = qs('#first-portfolio');
      const profileDropdown = qs('#profile-dropdown');
      const highlightDropdownLabel = qs('[highlight-dropdown-label]');
      const skipBlock = qs('[skip-highlights]');

      if (!grid || !template) return;
      let selectedFiles = [];
      let selectedVideos = [];
      let coverIndex = 0;
      let activePortfolio = null;
      let existingImages = [];
      let existingVideos = [];
      let autoOpenedCreateDropdown = false;

      function getAssetUrl(value) {
        if (!value) return '';
        if (value.startsWith('http')) return value;
        if (value.startsWith('/')) return XANO_BASE_URL + value;
        return value;
      }

      function getImageUrl(value) {
        return getAssetUrl(value) || PLACEHOLDER_IMAGE;
      }

      async function requestJson(url, options, errorLabel) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) {
          console.error(`${errorLabel}:`, data);
          throw new Error(data.message || errorLabel);
        }
        return data;
      }

      async function uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);
        return requestJson(
          XANO_UPLOAD_URL,
          {
            method: 'POST',
            body: formData,
          },
          'Image upload failed',
        );
      }

      async function uploadVideo(file) {
        const formData = new FormData();
        formData.append('video', file);
        const data = await requestJson(
          XANO_UPLOAD_VIDEO_URL,
          {
            method: 'POST',
            body: formData,
          },
          'Video upload failed',
        );
        if (data.path) return data;
        if (data.video && data.video.path) return data.video;
        console.error('Video upload error:', data);
        throw new Error(data?.payload || 'Video upload failed');
      }

      async function getPortfolios() {
        const data = await requestJson(`${XANO_GET_URL}?memberstack_id=${encodeURIComponent(MEMBER.id)}`, undefined, 'Failed to load portfolios');
        return Array.isArray(data) ? data : [];
      }

      async function getPortfolioImages(portfolioId) {
        const data = await requestJson(`${XANO_GET_IMAGES_URL}?portfolio_id=${encodeURIComponent(portfolioId)}&memberstack_id=${encodeURIComponent(MEMBER.id)}`, undefined, 'Failed to load portfolio images');
        return Array.isArray(data) ? data : [];
      }

      async function getPortfolioVideos(portfolioId) {
        const data = await requestJson(`${XANO_GET_VIDEOS_URL}?portfolio_id=${encodeURIComponent(portfolioId)}&memberstack_id=${encodeURIComponent(MEMBER.id)}`, undefined, 'Failed to load portfolio videos');
        return Array.isArray(data) ? data : [];
      }

      async function createPortfolio(payload) {
        return requestJson(
          XANO_CREATE_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          'Portfolio creation failed',
        );
      }

      async function updatePortfolio(payload) {
        return requestJson(
          XANO_UPDATE_URL,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          'Portfolio update failed',
        );
      }

      async function deletePortfolio(payload) {
        return requestJson(
          XANO_DELETE_URL,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          'Portfolio deletion failed',
        );
      }

      async function addPortfolioImage(payload) {
        return requestJson(
          XANO_ADD_IMAGE_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          'Portfolio image creation failed',
        );
      }

      async function addPortfolioVideo(payload) {
        return requestJson(
          XANO_ADD_VIDEO_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          'Portfolio video creation failed',
        );
      }

      async function deletePortfolioImage(imageId) {
        return requestJson(
          XANO_DELETE_IMAGE_URL,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_id: Number(imageId),
              memberstack_id: MEMBER.id,
            }),
          },
          'Image deletion failed',
        );
      }

      async function deletePortfolioVideo(videoId) {
        return requestJson(
          XANO_DELETE_VIDEO_URL,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              video_id: Number(videoId),
              memberstack_id: MEMBER.id,
            }),
          },
          'Video deletion failed',
        );
      }

      function openModal() {
        if (!editModal) return;

        editModalTrigger.dispatchEvent(new Event('click', { bubbles: true }));
      }

      function closeModal() {
        if (!editModal) return;

        editModalClose.dispatchEvent(new Event('click', { bubbles: true }));

        activePortfolio = null;
        existingImages = [];
        existingVideos = [];
        setTimeout(() => {
          if (editForm) editForm.reset();
        }, 300);
      }

      function openRemoveModal() {
        if (!removeModal) return;

        removeModalTrigger.dispatchEvent(new Event('click', { bubbles: true }));
      }

      function closeRemoveModal() {
        if (!removeModal) return;

        removeModalClose.dispatchEvent(new Event('click', { bubbles: true }));
      }

      function getErrorMessage(error, fallback) {
        return error && error.message ? error.message : fallback;
      }

      function openNotificationModal(message) {
        if (!notificationModal || !notificationText) return;

        notificationText.textContent = message || 'Something went wrong';
        notificationText.style.whiteSpace = 'pre-line';
        notificationModalTrigger.dispatchEvent(new Event('click', { bubbles: true }));
      }

      function closeNotificationModal() {
        if (!notificationModal || !notificationModalClose) return;

        notificationModalClose.dispatchEvent(new Event('click', { bubbles: true }));
      }

      function updateCreateSubmitState() {
        if (!createSubmit) return;

        const titleIsFilled = Boolean(titleInput && titleInput.value.trim());
        const hasImage = selectedFiles.length > 0;
        const canSubmit = titleIsFilled && hasImage;
        createSubmit.style.opacity = canSubmit ? '1' : '0.5';
        createSubmit.style.pointerEvents = canSubmit ? 'auto' : 'none';
      }

      function updateCreateDropdownState(portfoliosCount) {
        if (highlightDropdownLabel) {
          const nextItemNumber = Math.min(portfoliosCount + 1, MAX_PORTFOLIOS);
          highlightDropdownLabel.textContent = `Add Portfolio Highlight - ${nextItemNumber} of ${MAX_PORTFOLIOS}`;
        }

        if (profileDropdown) {
          profileDropdown.style.display = portfoliosCount >= MAX_PORTFOLIOS ? 'none' : 'block';
        }

        if (portfoliosCount === 0 && !autoOpenedCreateDropdown) {
          const dropdownToggle = qs('[data-add-highlight-dropdown]');
          if (dropdownToggle) {
            dropdownToggle.click();
            autoOpenedCreateDropdown = true;
          }
        }
      }

      function renderImagePreviews() {
        if (!previewWrapper) return;
        previewWrapper.innerHTML = '';
        selectedFiles.forEach(function (file, index) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const image = document.createElement('img');
          image.className = 'portfolio-preview-image';
          image.src = URL.createObjectURL(file);
          const actions = document.createElement('div');
          actions.className = 'portfolio-preview-actions';
          const coverButton = document.createElement('button');
          coverButton.type = 'button';
          coverButton.className = 'portfolio-preview-cover';
          coverButton.textContent = index === coverIndex ? 'Cover' : 'Set as cover';
          if (index === coverIndex) coverButton.classList.add('is-cover');
          coverButton.addEventListener('click', function () {
            coverIndex = index;
            if (coverIndexInput) coverIndexInput.value = coverIndex;
            renderImagePreviews();
          });
          const removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.className = 'profile-photo-remove is-portfolio-edit';
          removeButton.textContent = 'Remove';
          removeButton.addEventListener('click', function () {
            selectedFiles = selectedFiles.filter(function (_, fileIndex) {
              return fileIndex !== index;
            });
            if (coverIndex >= selectedFiles.length) coverIndex = Math.max(0, selectedFiles.length - 1);
            if (coverIndexInput) coverIndexInput.value = coverIndex;
            renderImagePreviews();
            updateCreateSubmitState();
          });
          actions.appendChild(coverButton);
          actions.appendChild(removeButton);
          item.appendChild(image);
          item.appendChild(actions);
          previewWrapper.appendChild(item);
        });
      }

      function renderVideoPreviews() {
        if (!videosPreviewWrapper) return;
        videosPreviewWrapper.innerHTML = '';
        selectedVideos.forEach(function (file, index) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const video = document.createElement('video');
          video.className = 'portfolio-preview-video';
          video.src = URL.createObjectURL(file);
          video.controls = true;
          video.muted = true;
          const removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.className = 'profile-photo-remove is-portfolio-edit is-video';
          removeButton.textContent = 'Remove';
          removeButton.addEventListener('click', function () {
            selectedVideos = selectedVideos.filter(function (_, videoIndex) {
              return videoIndex !== index;
            });
            renderVideoPreviews();
          });
          item.appendChild(video);
          item.appendChild(removeButton);
          videosPreviewWrapper.appendChild(item);
        });
      }

      function renderEditImages() {
        if (!editPreviewWrapper) return;
        editPreviewWrapper.innerHTML = '';
        existingImages.forEach(function (imageItem) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const image = document.createElement('img');
          image.className = 'portfolio-preview-image';
          image.src = `${getImageUrl(imageItem.image_url)}?tpl=large`;
          const actions = document.createElement('div');
          actions.className = 'portfolio-preview-actions';
          const coverButton = document.createElement('button');
          coverButton.type = 'button';
          coverButton.className = 'portfolio-preview-cover';
          coverButton.textContent = imageItem.is_cover ? 'Cover' : 'Set as cover';
          if (imageItem.is_cover) coverButton.classList.add('is-cover');
          coverButton.addEventListener('click', function () {
            existingImages = existingImages.map(function (item) {
              return {
                ...item,
                is_cover: item.id === imageItem.id,
              };
            });
            renderEditImages();
          });
          const removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.className = 'profile-photo-remove is-portfolio-edit';
          removeButton.textContent = 'Remove';
          removeButton.addEventListener('click', async function () {
            try {
              if (!imageItem.is_new) {
                await deletePortfolioImage(imageItem.id);
              }
              existingImages = existingImages.filter(function (item) {
                return item.id !== imageItem.id;
              });
              if (!existingImages.some((item) => item.is_cover) && existingImages.length > 0) {
                existingImages[0].is_cover = true;
              }
              renderEditImages();
            } catch (error) {
              console.error(error);
              openNotificationModal(getErrorMessage(error, 'Image deletion failed'));
            }
          });
          actions.appendChild(coverButton);
          actions.appendChild(removeButton);
          item.appendChild(image);
          item.appendChild(actions);
          editPreviewWrapper.appendChild(item);
        });
      }

      function renderEditVideos() {
        if (!editVideosPreviewWrapper) return;
        editVideosPreviewWrapper.innerHTML = '';
        existingVideos.forEach(function (videoItem) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const video = document.createElement('video');
          video.className = 'portfolio-preview-video';
          video.src = getAssetUrl(videoItem.video_url);
          video.controls = true;
          video.muted = true;
          const removeButton = document.createElement('button');
          removeButton.type = 'button';
          removeButton.className = 'profile-photo-remove is-portfolio-edit is-video';
          removeButton.textContent = 'Remove';
          removeButton.addEventListener('click', async function () {
            try {
              if (!videoItem.is_new) {
                await deletePortfolioVideo(videoItem.id);
              }
              existingVideos = existingVideos.filter(function (item) {
                return item.id !== videoItem.id;
              });
              renderEditVideos();
            } catch (error) {
              console.error(error);
              openNotificationModal(getErrorMessage(error, 'Video deletion failed'));
            }
          });
          item.appendChild(video);
          item.appendChild(removeButton);
          editVideosPreviewWrapper.appendChild(item);
        });
      }

      async function fillEditForm(portfolio) {
        activePortfolio = portfolio;
        if (editTitleInput) editTitleInput.value = portfolio.title || '';
        if (editDescriptionInput) editDescriptionInput.value = portfolio.description || '';
        existingImages = await getPortfolioImages(portfolio.id);
        existingVideos = await getPortfolioVideos(portfolio.id);
        renderEditImages();
        renderEditVideos();
        openModal();
      }

      function createCard(portfolio) {
        const card = template.cloneNode(true);
        card.classList.remove('hidden');
        card.style.display = '';
        const image = qs('.portfolio_card-thumb', card);
        const title = qs('.portfolio_card-title', card);
        const description = qs('.portfolio_card-description', card);
        const statusBlock = qs('.portfolio_card-status', card);
        const idBlock = qs('.portfolio_card-id', card);
        const editButton = qs('[edit-portfolio]', card);
        const removeButton = qs('[open-remove-modal]', card);
        if (image) {
          const originalImage = portfolio.thumbnail_url;
          image.src = `${getImageUrl(originalImage)}?tpl=large`;
          image.loading = 'lazy';
          image.decoding = 'async';
        }
        if (title) title.textContent = portfolio.title || '';
        if (description) description.innerHTML = portfolio.description || '';
        if (idBlock) idBlock.textContent = portfolio.id || '';
        if (statusBlock) {
          const status = (portfolio.status || portfolio.Status || '').toLowerCase();
          statusBlock.textContent = status;
          statusBlock.classList.remove('is-approved', 'is-pending', 'is-rejected');
          if (status === 'approved') statusBlock.classList.add('is-approved');
          if (status === 'pending' || status === 'pending_review') statusBlock.classList.add('is-pending');
          if (status === 'rejected') statusBlock.classList.add('is-rejected');
        }
        if (editButton) {
          editButton.addEventListener('click', async function (event) {
            event.preventDefault();
            await fillEditForm(portfolio);
          });
        }
        if (removeButton) {
          removeButton.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            activePortfolio = portfolio;
            openRemoveModal();
          });
        }
        return card;
      }

      async function renderPortfolios() {
        const portfolios = await getPortfolios();
        qsa('.portfolio_card:not(:first-child)', grid).forEach(function (card) {
          card.remove();
        });
        template.style.display = 'none';
        updateCreateDropdownState(portfolios.length);

        if (firstPortfolioInput) {
          if (!firstPortfolioInput.value && portfolios.length) {
            firstPortfolioInput.value = 'true';
          } else if (firstPortfolioInput.value && !portfolios.length) {
            firstPortfolioInput.value = '';
          }

          firstPortfolioInput.dispatchEvent(new Event('change', { bubbles: true }));
          firstPortfolioInput.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (!portfolios.length) {
          if (skipBlock) skipBlock.style.display = 'flex';
        } else {
          if (skipBlock) skipBlock.style.display = 'none';
        }

        portfolios.forEach(function (portfolio) {
          grid.appendChild(createCard(portfolio));
        });
      }

      function resetCreateForm() {
        if (titleInput) titleInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
        selectedFiles = [];
        selectedVideos = [];
        coverIndex = 0;
        if (coverIndexInput) coverIndexInput.value = '0';
        if (imagesInput) imagesInput.value = '';
        if (videosInput) videosInput.value = '';
        if (previewWrapper) previewWrapper.innerHTML = '';
        if (videosPreviewWrapper) videosPreviewWrapper.innerHTML = '';
        updateCreateSubmitState();
      }

      function closeCreateDropdown() {
        const dropdownToggle = qs('[data-add-highlight-dropdown]');
        if (dropdownToggle) dropdownToggle.click();
      }

      function disableDropdownToggle(state) {
        profileDropdown.style.pointerEvents = state ? 'none' : 'auto';
        profileDropdown.style.opacity = state ? '0.6' : '1';
      }

      async function handlePortfolioCreate(event) {
        event.preventDefault();
        try {
          disableDropdownToggle(true);
          const portfolios = await getPortfolios();
          if (portfolios.length >= MAX_PORTFOLIOS) throw new Error(`Maximum ${MAX_PORTFOLIOS} portfolios allowed`);
          const title = titleInput ? titleInput.value.trim() : '';
          const description = descriptionInput ? descriptionInput.value.trim() : '';
          if (!title) throw new Error('Please fill all required fields');
          if (selectedFiles.length === 0) throw new Error('Please upload at least one image');
          const uploadedImages = [];
          for (const file of selectedFiles) {
            uploadedImages.push(await uploadImage(file));
          }
          const coverImage = uploadedImages[coverIndex];
          const coverUrl = XANO_BASE_URL + coverImage.path;
          const portfolio = await createPortfolio({
            memberstack_id: MEMBER.id,
            title: title,
            description: description,
            thumbnail_url: coverUrl,
          });
          for (let index = 0; index < uploadedImages.length; index++) {
            const imageData = uploadedImages[index];
            const imageUrl = XANO_BASE_URL + imageData.path;
            await addPortfolioImage({
              memberstack_id: MEMBER.id,
              portfolio_id: Number(portfolio.id),
              image: imageData,
              image_url: imageUrl,
              is_cover: index === coverIndex,
              sort_order: Number(index),
            });
          }
          for (let index = 0; index < selectedVideos.length; index++) {
            const videoData = await uploadVideo(selectedVideos[index]);
            const videoUrl = XANO_BASE_URL + videoData.path;
            await addPortfolioVideo({
              memberstack_id: MEMBER.id,
              portfolio_id: Number(portfolio.id),
              video: videoData,
              video_url: videoUrl,
              sort_order: Number(index),
            });
          }
          await renderPortfolios();
          window.dispatchEvent(
            new CustomEvent('portfolio-created', {
              detail: portfolio,
            }),
          );
          resetCreateForm();

          closeCreateDropdown();
        } catch (error) {
          console.error(error);
          openNotificationModal(getErrorMessage(error, 'Portfolio creation failed'));
        } finally {
          disableDropdownToggle(false);
        }
      }

      async function handlePortfolioUpdate(event) {
        event.preventDefault();
        try {
          if (!activePortfolio) throw new Error('Portfolio is not selected');
          if (existingImages.length === 0) throw new Error('Portfolio must have at least one photo');
          editSubmit.style.pointerEvents = 'none';
          editSubmit.style.opacity = '0.6';
          const coverImage = existingImages.find(function (item) {
            return item.is_cover;
          });
          await updatePortfolio({
            id: activePortfolio.id,
            memberstack_id: MEMBER.id,
            title: editTitleInput.value.trim(),
            description: editDescriptionInput.value.trim(),
            thumbnail_url: coverImage ? coverImage.image_url : activePortfolio.thumbnail_url,
          });
          const newImages = existingImages.filter((item) => item.is_new);
          for (let index = 0; index < newImages.length; index++) {
            const imageItem = newImages[index];
            await addPortfolioImage({
              memberstack_id: MEMBER.id,
              portfolio_id: Number(activePortfolio.id),
              image: imageItem.image,
              image_url: imageItem.image_url,
              is_cover: imageItem.is_cover,
              sort_order: Number(existingImages.indexOf(imageItem)),
            });
          }
          const newVideos = existingVideos.filter((item) => item.is_new);
          for (let index = 0; index < newVideos.length; index++) {
            const videoItem = newVideos[index];
            await addPortfolioVideo({
              memberstack_id: MEMBER.id,
              portfolio_id: Number(activePortfolio.id),
              video: videoItem.video,
              video_url: videoItem.video_url,
              sort_order: Number(existingVideos.indexOf(videoItem)),
            });
          }
          closeModal();
          await renderPortfolios();
        } catch (error) {
          console.error(error);
          openNotificationModal(getErrorMessage(error, 'Portfolio update failed'));
        } finally {
          editSubmit.style.pointerEvents = 'auto';
          editSubmit.style.opacity = '1';
        }
      }

      async function handleDeleteFromModal(button, shouldCloseEditModal) {
        if (!activePortfolio) return;
        try {
          button.style.pointerEvents = 'none';
          button.style.opacity = '0.6';
          await deletePortfolio({
            id: activePortfolio.id,
            memberstack_id: MEMBER.id,
          });
          if (shouldCloseEditModal) closeModal();
          closeRemoveModal();
          await renderPortfolios();
        } catch (error) {
          console.error(error);
          openNotificationModal(getErrorMessage(error, 'Portfolio deletion failed'));
        } finally {
          button.style.pointerEvents = 'auto';
          button.style.opacity = '1';
        }
      }

      document.addEventListener('click', async function (event) {
        const removeFromEditButton = event.target.closest('[remove-item]');
        if (removeFromEditButton) {
          await handleDeleteFromModal(removeFromEditButton, true);
          return;
        }
        const directRemoveButton = event.target.closest('[remove-item-direct]');
        if (directRemoveButton) {
          await handleDeleteFromModal(directRemoveButton, false);
          return;
        }
        const closeRemoveButton = event.target.closest('[close-remove]');
        if (closeRemoveButton) {
          event.preventDefault();
          if (closeRemoveButton.closest('[data-modal-target="portfolio-notification"]')) {
            closeNotificationModal();
            return;
          }
          closeRemoveModal();
          return;
        }
        const closeButton = event.target.closest('[aria-label="close button"]');
        if (closeButton && closeButton.closest('[data-modal-target="portfolio-notification"]')) {
          event.preventDefault();
          closeNotificationModal();
          return;
        }
        if (closeButton && closeButton.closest('[data-modal-target="portfolio-remove"]')) {
          event.preventDefault();
          closeRemoveModal();
          return;
        }
        if (closeButton) {
          event.preventDefault();
          closeModal();
        }
      });

      grid.addEventListener('click', async function (event) {
        const button = event.target.closest('[show-portfolio]');
        if (!button) return;
        const card = button.closest('.portfolio_card');
        const idBlock = card ? qs('.portfolio_card-id', card) : null;
        if (!idBlock) return;
        const portfolioId = Number(idBlock.textContent);
        try {
          const portfolios = await getPortfolios();
          const portfolio = portfolios.find((item) => Number(item.id) === portfolioId);
          if (portfolio) await fillEditForm(portfolio);
        } catch (error) {
          console.error(error);
          openNotificationModal(getErrorMessage(error, 'Failed to open portfolio'));
        }
      });

      document.addEventListener('click', async function (event) {
        const button = event.target.closest('[open-remove-modal]');
        if (!button) return;
        const card = button.closest('.portfolio_card');
        const idBlock = card ? qs('.portfolio_card-id', card) : null;
        if (!idBlock) return;
        const portfolioId = Number(idBlock.textContent);
        try {
          const portfolios = await getPortfolios();
          const portfolio = portfolios.find((item) => Number(item.id) === portfolioId);
          if (!portfolio) return;
          activePortfolio = portfolio;
          openRemoveModal();
        } catch (error) {
          console.error(error);
          openNotificationModal(getErrorMessage(error, 'Failed to open portfolio'));
        }
      });

      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        closeNotificationModal();
        closeRemoveModal();
        closeModal();
      });

      if (imagesInput) {
        imagesInput.setAttribute('multiple', 'multiple');
        imagesInput.addEventListener('change', function () {
          const files = Array.from(imagesInput.files);

          const oversizedFiles = files.filter(function (file) {
            return file.size > MAX_IMAGE_SIZE;
          });
          const validFiles = files.filter(function (file) {
            return file.size <= MAX_IMAGE_SIZE;
          });

          const availableSlots = Math.max(0, 5 - selectedFiles.length);
          const filesToAdd = validFiles.slice(0, availableSlots);

          const messages = [];
          if (oversizedFiles.length) {
            const names = oversizedFiles
              .map(function (file) {
                return ' - ' + file.name;
              })
              .join('\n');
            messages.push('Image exceeds 4MB upload size limit:\n' + names);
          }
          if (validFiles.length > availableSlots) {
            messages.push('Maximum 5 photos allowed');
          }
          if (messages.length) {
            openNotificationModal(messages.join('\n'));
          }

          selectedFiles = selectedFiles.concat(filesToAdd);
          if (selectedFiles.length && coverIndex >= selectedFiles.length) coverIndex = 0;

          if (coverIndexInput) coverIndexInput.value = coverIndex;

          renderImagePreviews();
          updateCreateSubmitState();

          imagesInput.value = '';
        });
      }

      if (videosInput) {
        videosInput.setAttribute('multiple', 'multiple');
        videosInput.addEventListener('change', function () {
          const files = Array.from(videosInput.files);
          const oversizedFiles = files.filter(function (file) {
            return file.size > MAX_VIDEO_SIZE;
          });

          if (oversizedFiles.length) {
            openNotificationModal('Video exceeds 50MB upload size limit');
            videosInput.value = '';
            selectedVideos = [];
            if (videosPreviewWrapper) videosPreviewWrapper.innerHTML = '';
            return;
          }

          const availableSlots = Math.max(0, 3 - selectedVideos.length);
          const filesToAdd = files.slice(0, availableSlots);

          if (files.length > availableSlots) {
            openNotificationModal('Maximum 3 videos allowed');
          }

          selectedVideos = selectedVideos.concat(filesToAdd);

          renderVideoPreviews();

          videosInput.value = '';
        });
      }

      if (editImagesInput) {
        editImagesInput.setAttribute('multiple', 'multiple');
        editImagesInput.addEventListener('change', async function () {
          const files = Array.from(editImagesInput.files);
          const oversizedFiles = files.filter(function (file) {
            return file.size > MAX_IMAGE_SIZE;
          });

          if (oversizedFiles.length) {
            openNotificationModal('Image exceeds 4MB upload size limit');
            editImagesInput.value = '';
            return;
          }
          const availableSlots = Math.max(0, 5 - existingImages.length);
          const filesToAdd = files.slice(0, availableSlots);
          if (files.length > availableSlots) {
            openNotificationModal('Maximum 5 photos allowed');
          }
          try {
            for (const file of filesToAdd) {
              const imageData = await uploadImage(file);
              const imageUrl = XANO_BASE_URL + imageData.path;
              existingImages.push({
                id: `new_${Date.now()}_${Math.random()}`,
                image: imageData,
                image_url: imageUrl,
                is_cover: existingImages.length === 0,
                sort_order: existingImages.length,
                is_new: true,
              });
            }
          } catch (error) {
            console.error(error);
            openNotificationModal(getErrorMessage(error, 'Image upload failed'));
          }
          renderEditImages();
        });
      }

      if (editVideosInput) {
        editVideosInput.setAttribute('multiple', 'multiple');
        editVideosInput.addEventListener('change', async function () {
          const files = Array.from(editVideosInput.files);
          const oversizedFiles = files.filter(function (file) {
            return file.size > MAX_VIDEO_SIZE;
          });

          if (oversizedFiles.length) {
            openNotificationModal('Video exceeds 50MB upload size limit');
            editVideosInput.value = '';
            return;
          }
          const availableSlots = Math.max(0, 3 - existingVideos.length);
          const filesToAdd = files.slice(0, availableSlots);
          if (files.length > availableSlots) {
            openNotificationModal('Maximum 3 videos allowed');
          }
          try {
            for (const file of filesToAdd) {
              const videoData = await uploadVideo(file);
              const videoUrl = XANO_BASE_URL + videoData.path;
              existingVideos.push({
                id: `new_${Date.now()}_${Math.random()}`,
                video: videoData,
                video_url: videoUrl,
                sort_order: existingVideos.length,
                is_new: true,
              });
            }
          } catch (error) {
            console.error(error);
            openNotificationModal(getErrorMessage(error, 'Video upload failed'));
          }
          renderEditVideos();
        });
      }

      if (createSubmit) createSubmit.addEventListener('click', handlePortfolioCreate);

      if (titleInput) {
        titleInput.addEventListener('input', updateCreateSubmitState);
      }

      updateCreateSubmitState();

      if (editSubmit) editSubmit.addEventListener('click', handlePortfolioUpdate);

      closeModal();
      closeNotificationModal();
      try {
        await renderPortfolios();
      } catch (error) {
        console.error(error);
        openNotificationModal(getErrorMessage(error, 'Failed to load portfolios'));
      }
    });
  });

