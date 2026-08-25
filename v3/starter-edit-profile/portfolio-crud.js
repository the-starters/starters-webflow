/**
 * GitHub-owned copy of the Starter Edit Profile Webflow controller block.
 * Original live inline body SHA-256: 8def2d83a95789431895634566199088cae153f1d517210abcb917977dd02e5d
 * Captured read-only from /starter-edit-profile on 2026-08-12.
 */
function getStarterEditPortfolioSuccessCopy(updatedHighlightCount) {
  if (!Number.isInteger(updatedHighlightCount) || updatedHighlightCount < 1) return null;
  return {
    heading: 'Highlight submitted',
    message: 'Your changes were saved and sent for review. Your currently approved highlight stays live until the update is approved.',
  };
}

function createStarterEditPortfolioSuccessController(options) {
  const modal = options.modal;
  const heading = options.heading;
  const message = options.message;
  const trigger = options.trigger;
  const closeEventTarget = options.closeEventTarget;
  const defaultHeading = heading ? heading.textContent : '';
  const defaultMessage = message ? message.textContent : '';

  function restore() {
    if (heading) heading.textContent = defaultHeading;
    if (message) message.textContent = defaultMessage;
  }

  function showForSubmit(updatedHighlightCount) {
    const copy = getStarterEditPortfolioSuccessCopy(updatedHighlightCount);
    if (copy) {
      if (heading) heading.textContent = copy.heading;
      if (message) message.textContent = copy.message;
    } else {
      restore();
    }
    if (trigger) trigger.dispatchEvent(new Event('click', { bubbles: true }));
  }

  function handleSharedModalClose(event) {
    if (event.detail && event.detail.modal === modal) restore();
  }

  if (modal) modal.addEventListener('close', restore);
  if (closeEventTarget) closeEventTarget.addEventListener('modal-close', handleSharedModalClose);

  return { showForSubmit };
}

function createStarterEditPortfolioModalLifecycle(options) {
  options.eventTarget.addEventListener('pageshow', function () {
    if (options.isModalOpen() && !options.hasActivePortfolio()) options.closeModal();
  });
}

async function commitStarterEditPortfolioDrafts(options) {
  for (const draft of options.createDrafts) {
    await options.commitCreateDraft(draft);
  }

  for (const draft of options.updateDrafts) {
    await options.commitUpdateDraft(draft);
  }

  await options.commitDeleteDrafts();
  options.clearAllDraftQueues();
  await options.renderPortfolios();
  options.successController.showForSubmit(options.updateDrafts.length);
}

  // Manages portfolio CRUD, media uploads, previews, and edit/remove modals.
  document.addEventListener('DOMContentLoaded', async function () {
    waitForMember(async () => {
      if (!MEMBER.id) return;

      const XANO_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io';
      ((XANO_GET_URL = `${XANO_BASE}/api:PmBJV0AG/Get_my_portfolios`), (XANO_CREATE_URL = `${XANO_BASE}/api:PmBJV0AG/Create_portfolio`), (XANO_UPDATE_URL = `${XANO_BASE}/api:PmBJV0AG/Update_portfolio`), (XANO_DELETE_URL = `${XANO_BASE}/api:PmBJV0AG/Delete_portfolio`), (XANO_UPLOAD_URL = `${XANO_BASE}/api:PmBJV0AG/upload-image`), (XANO_ADD_IMAGE_URL = `${XANO_BASE}/api:PmBJV0AG/Add_portfolio_image`), (XANO_GET_IMAGES_URL = `${XANO_BASE}/api:PmBJV0AG/Get_portfolio_images`), (XANO_UPLOAD_VIDEO_URL = `${XANO_BASE}/api:PmBJV0AG/upload-video`), (XANO_ADD_VIDEO_URL = `${XANO_BASE}/api:PmBJV0AG/Add_portfolio_video`), (XANO_GET_VIDEOS_URL = `${XANO_BASE}/api:PmBJV0AG/Get_portfolio_videos`), (XANO_DELETE_IMAGE_URL = `${XANO_BASE}/api:PmBJV0AG/Delete_portfolio_image`), (XANO_DELETE_VIDEO_URL = `${XANO_BASE}/api:PmBJV0AG/Delete_portfolio_video`), (PLACEHOLDER_IMAGE = 'https://cdn.prod.website-files.com/plugins/Basic/assets/placeholder.60f9b1840c.svg'), (MAX_IMAGE_SIZE = 4 * 1024 * 1024), (MAX_VIDEO_SIZE = 50 * 1024 * 1024), (MAX_PORTFOLIOS = 9), (grid = qs('[data-highlights]')), (template = grid ? qs('.portfolio_card', grid) : null), (editModal = qs('[data-modal-target="portfolio-edit"]')), (editModalTrigger = qs('[data-modal-trigger="portfolio-edit"]')), (editModalClose = qs('[data-modal-close]', editModal)), (removeModal = qs('[data-modal-target="portfolio-remove"]')), (removeModalTrigger = qs('[data-modal-trigger="portfolio-remove"]')), (removeModalClose = qs('[data-modal-close]', removeModal)), (notifyModal = qs('[data-modal-target="portfolio-notification"]')), (notifyModalTrigger = qs('[data-modal-trigger="portfolio-notification"]')), (notifyModalClose = qs('[data-modal-close]', notifyModal)), (notificationText = notifyModal ? qs('[notification-text]', notifyModal) : null), (openSuccess = qs("[data-modal-trigger='edit-form-success']")), (createSubmit = qs('#add-highlight')), (editForm = qs('#wf-form-Portfolio-update')), (editSubmit = qs('[free-edit-submit]')), (portfolioSubmit = qs('[data-edit-submit="portfolio"]')), (titleInp = qs('#portfolio-title')), (descInp = qs('#portfolio-description')), (editTitleInp = qs('#portfolio-title-edit')), (editDescInp = qs('#portfolio-description-edit')), (imagesInp = qs('#portfolio-images')), (previewWrap = qs('#portfolio-images-preview')), (coverIndexInput = qs('#portfolio-cover-index')), (editImagesInp = qs('#portfolio-images-edit')), (editPreviewWrap = qs('#portfolio-images-edit-preview')), (videosInp = qs('#portfolio-videos')), (videosPreviewWrap = qs('#portfolio-videos-preview')), (editVideosInp = qs('#portfolio-videos-edit')), (editVideosPreviewWrap = qs('#portfolio-videos-edit-preview')), (firstPortfolioInp = qs('#first-portfolio')), (profileDrop = qs('#profile-dropdown')), (highlightDropdownLabel = qs('[highlight-dropdown-label]')), (skipBlock = qs('[skip-highlights]')));

      const successModal = qs('[data-modal-target="edit-form-success"]');
      const successHeading = successModal ? qs('.heading-style-h1', successModal) : null;
      const successMessage = successModal ? qs('.text-size-xlarge', successModal) : null;
      const successController = createStarterEditPortfolioSuccessController({
        modal: successModal,
        heading: successHeading,
        message: successMessage,
        trigger: openSuccess,
        closeEventTarget: window,
      });

      if (!grid || !template) return;
      let selectedFiles = [],
        selectedVideos = [],
        coverIndex = 0,
        activePortfolio = null,
        existingImages = [],
        existingVideos = [],
        deletedImageIds = [],
        deletedVideoIds = [],
        pendingCreateDrafts = [],
        pendingUpdateDrafts = new Map(),
        pendingDeleteDraftIds = new Set(),
        autoOpenedCreateDropdown = false,
        editFormResetTimer = null;

      function getAssetUrl(value) {
        if (!value) return '';
        if (value.startsWith('http')) return value;
        if (value.startsWith('/')) return XANO_BASE + value;
        return value;
      }

      function getImageUrl(value) {
        return getAssetUrl(value) || PLACEHOLDER_IMAGE;
      }

      function getImagePreviewUrl(imageItem) {
        if (imageItem.preview_url) return imageItem.preview_url;
        return `${getImageUrl(imageItem.image_url)}?tpl=large`;
      }

      function getPortfolioCardImageUrl(portfolio) {
        const imageUrl = portfolio && portfolio.thumbnail_url ? portfolio.thumbnail_url : '';
        if (!imageUrl) return PLACEHOLDER_IMAGE;
        if (imageUrl.startsWith('blob:')) return imageUrl;
        if (portfolio && portfolio.is_draft) return imageUrl;
        return `${getImageUrl(imageUrl)}?tpl=large`;
      }

      function getVideoPreviewUrl(videoItem) {
        if (videoItem.preview_url) return videoItem.preview_url;
        return getAssetUrl(videoItem.video_url);
      }

      function cloneEditDraftItems(items) {
        return items.map(function (item) {
          return {
            ...item,
          };
        });
      }

      function getPendingCreateCount() {
        return pendingCreateDrafts.length;
      }

      function getPendingDeleteCount() {
        return pendingDeleteDraftIds.size;
      }

      function getDraftThumbnailUrlFromImages(images) {
        const coverImage = images.find(function (item) {
          return item.is_cover;
        });

        if (!coverImage) return '';
        return coverImage.preview_url || coverImage.image_url || '';
      }

      function getDraftThumbnailUrlFromFiles(files, coverIndexValue) {
        const file = files[coverIndexValue] || files[0];
        return file ? URL.createObjectURL(file) : '';
      }

      function createCreateDraft() {
        const imageFiles = selectedFiles.slice();
        const videoFiles = selectedVideos.slice();

        return {
          id: `draft_${Date.now()}_${Math.random()}`,
          type: 'create',
          is_draft: true,
          pending_type: 'create',
          title: titleInp ? titleInp.value.trim() : '',
          description: descInp ? descInp.value.trim() : '',
          imageFiles: imageFiles,
          videoFiles: videoFiles,
          coverIndex: coverIndex,
          thumbnail_url: getDraftThumbnailUrlFromFiles(imageFiles, coverIndex),
          status: 'draft',
        };
      }

      function createUpdateDraft() {
        const images = cloneEditDraftItems(existingImages);
        const videos = cloneEditDraftItems(existingVideos);

        return {
          id: activePortfolio.id,
          type: 'update',
          title: editTitleInp ? editTitleInp.value.trim() : '',
          description: editDescInp ? editDescInp.value.trim() : '',
          images: images,
          videos: videos,
          deletedImageIds: deletedImageIds.slice(),
          deletedVideoIds: deletedVideoIds.slice(),
          thumbnail_url: getDraftThumbnailUrlFromImages(images) || activePortfolio.thumbnail_url,
          status: 'draft',
        };
      }

      function updateCreateDraftFromModal() {
        const imageFiles = existingImages
          .map(function (item) {
            return item.file;
          })
          .filter(Boolean);
        const videoFiles = existingVideos
          .map(function (item) {
            return item.file;
          })
          .filter(Boolean);

        const nextCoverIndex = Math.max(
          0,
          existingImages.findIndex(function (item) {
            return item.is_cover;
          }),
        );

        return {
          ...activePortfolio,
          title: editTitleInp ? editTitleInp.value.trim() : '',
          description: editDescInp ? editDescInp.value.trim() : '',
          imageFiles: imageFiles,
          videoFiles: videoFiles,
          coverIndex: nextCoverIndex,
          thumbnail_url: getDraftThumbnailUrlFromFiles(imageFiles, nextCoverIndex),
          status: 'draft',
          is_draft: true,
          pending_type: 'create',
        };
      }

      function applyPendingOverlay(portfolio) {
        if (pendingDeleteDraftIds.has(String(portfolio.id))) return null;

        const draft = pendingUpdateDrafts.get(String(portfolio.id));
        if (!draft) return portfolio;

        return {
          ...portfolio,
          title: draft.title,
          description: draft.description,
          thumbnail_url: draft.thumbnail_url || portfolio.thumbnail_url,
          status: 'draft',
          is_draft: true,
          pending_type: 'update',
        };
      }

      function removeCreateDraft(draftId) {
        pendingCreateDrafts = pendingCreateDrafts.filter(function (draft) {
          return draft.id !== draftId;
        });
      }

      function removeUpdateDraft(portfolioId) {
        pendingUpdateDrafts.delete(String(portfolioId));
      }

      function getDraftPortfolioById(portfolioId) {
        const normalizedId = String(portfolioId || '').trim();
        if (!normalizedId) return null;

        const createDraft = pendingCreateDrafts.find(function (draft) {
          return String(draft.id) === normalizedId;
        });
        if (createDraft) return createDraft;

        const updateDraft = pendingUpdateDrafts.get(normalizedId);
        if (updateDraft) {
          return {
            ...updateDraft,
            id: normalizedId,
            is_draft: true,
            pending_type: 'update',
          };
        }

        return null;
      }

      function queuePortfolioDeletion(portfolio) {
        if (!portfolio || !portfolio.id) return;

        if (portfolio.is_draft) {
          if (portfolio.pending_type === 'update') {
            removeUpdateDraft(portfolio.id);
          } else {
            removeCreateDraft(portfolio.id);
          }
          return;
        }

        pendingDeleteDraftIds.add(String(portfolio.id));
        removeUpdateDraft(portfolio.id);
      }

      function clearAllDraftQueues() {
        pendingCreateDrafts = [];
        pendingUpdateDrafts = new Map();
        pendingDeleteDraftIds = new Set();
      }

      function resetEditDraftState() {
        activePortfolio = null;
        existingImages = [];
        existingVideos = [];
        deletedImageIds = [];
        deletedVideoIds = [];
      }

      function queueImageDeletion(imageItem) {
        if (!imageItem || imageItem.is_new) return;
        if (!deletedImageIds.includes(imageItem.id)) {
          deletedImageIds.push(imageItem.id);
        }
      }

      function queueVideoDeletion(videoItem) {
        if (!videoItem || videoItem.is_new) return;
        if (!deletedVideoIds.includes(videoItem.id)) {
          deletedVideoIds.push(videoItem.id);
        }
      }

      async function requestJson(url, options, errorLabel, workflow) {
        const diagnostics = window.StartersNativeFormDiagnostics;
        const request = () => fetch(url, options);
        const response = await (workflow && diagnostics
          ? diagnostics.observeMutation(workflow, request)
          : request());
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
          'portfolio_image_upload',
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
          'portfolio_video_upload',
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
          'portfolio_record_create',
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
          'portfolio_record_update',
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
          'portfolio_record_delete',
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
          'portfolio_image_attach',
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
          'portfolio_video_attach',
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
          'portfolio_image_delete',
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
          'portfolio_video_delete',
        );
      }

      function cancelEditFormReset() {
        if (editFormResetTimer === null) return;
        clearTimeout(editFormResetTimer);
        editFormResetTimer = null;
      }

      function openModal() {
        if (!editModal) return;

        cancelEditFormReset();
        editModalTrigger.dispatchEvent(new Event('click', { bubbles: true }));
      }

      function closeModal() {
        if (!editModal) return;

        editModalClose.dispatchEvent(new Event('click', { bubbles: true }));

        resetEditDraftState();
        cancelEditFormReset();
        editFormResetTimer = setTimeout(() => {
          editFormResetTimer = null;
          if (editModal.open || activePortfolio) return;
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

      function openNotifyModal(message) {
        if (!notifyModal || !notificationText) return;

        notificationText.textContent = message || 'Something went wrong';
        notificationText.style.whiteSpace = 'pre-line';
        notifyModalTrigger.dispatchEvent(new Event('click', { bubbles: true }));
      }

      function closeNotifyModal() {
        if (!notifyModal || !notifyModalClose) return;

        notifyModalClose.dispatchEvent(new Event('click', { bubbles: true }));
      }

      createStarterEditPortfolioModalLifecycle({
        eventTarget: window,
        hasActivePortfolio: function () {
          return Boolean(activePortfolio);
        },
        isModalOpen: function () {
          return Boolean(editModal && editModal.open);
        },
        closeModal: closeModal,
      });

      function updateCreateSubmitState() {
        if (!createSubmit) return;

        const titleIsFilled = Boolean(titleInp && titleInp.value.trim());
        const hasImage = selectedFiles.length > 0;
        const canSubmit = titleIsFilled && hasImage;
        createSubmit.style.opacity = canSubmit ? '1' : '0.5';
        createSubmit.style.pointerEvents = canSubmit ? 'auto' : 'none';
      }

      function updatePortfolioSubmitState() {
        if (!portfolioSubmit) return;

        const hasPendingChanges = Boolean(pendingCreateDrafts.length || pendingUpdateDrafts.size || pendingDeleteDraftIds.size);
        const hasFirstPortfolio = Boolean(firstPortfolioInp && firstPortfolioInp.value);
        const canSubmit = hasPendingChanges && hasFirstPortfolio;

        portfolioSubmit.style.opacity = canSubmit ? '1' : '0.5';
        portfolioSubmit.style.pointerEvents = canSubmit ? 'auto' : 'none';
      }

      function updateCreateDropdownState(portfoliosCount) {
        const effectiveCount = Math.max(0, portfoliosCount - getPendingDeleteCount() + getPendingCreateCount());

        if (highlightDropdownLabel) {
          const nextItemNumber = Math.min(effectiveCount + 1, MAX_PORTFOLIOS);
          highlightDropdownLabel.textContent = `Add Portfolio Highlight - ${nextItemNumber} of ${MAX_PORTFOLIOS}`;
        }

        if (profileDrop) {
          profileDrop.style.display = effectiveCount >= MAX_PORTFOLIOS ? 'none' : 'block';
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
        if (!previewWrap) return;
        previewWrap.innerHTML = '';
        selectedFiles.forEach(function (file, index) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const image = document.createElement('img');
          image.className = 'portfolio-preview-image';
          image.src = URL.createObjectURL(file);
          const actions = document.createElement('div');
          actions.className = 'portfolio-preview-actions';
          const coverBtn = document.createElement('button');
          coverBtn.type = 'button';
          coverBtn.className = 'portfolio-preview-cover';
          coverBtn.textContent = index === coverIndex ? 'Cover' : 'Set as cover';
          if (index === coverIndex) coverBtn.classList.add('is-cover');
          coverBtn.addEventListener('click', function () {
            coverIndex = index;
            if (coverIndexInput) coverIndexInput.value = coverIndex;
            renderImagePreviews();
          });
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'profile-photo-remove is-portfolio-edit';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', function () {
            selectedFiles = selectedFiles.filter(function (_, fileIndex) {
              return fileIndex !== index;
            });
            if (index === coverIndex) coverIndex = 0;
            else if (index < coverIndex) coverIndex -= 1;
            if (coverIndex >= selectedFiles.length) coverIndex = Math.max(0, selectedFiles.length - 1);
            if (coverIndexInput) coverIndexInput.value = coverIndex;
            renderImagePreviews();
            updateCreateSubmitState();
          });
          actions.appendChild(coverBtn);
          actions.appendChild(removeBtn);
          item.appendChild(image);
          item.appendChild(actions);
          previewWrap.appendChild(item);
        });
      }

      function renderVideoPreviews() {
        if (!videosPreviewWrap) return;
        videosPreviewWrap.innerHTML = '';
        selectedVideos.forEach(function (file, index) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const video = document.createElement('video');
          video.className = 'portfolio-preview-video';
          video.src = URL.createObjectURL(file);
          video.controls = true;
          video.muted = true;
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'profile-photo-remove is-portfolio-edit is-video';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', function () {
            selectedVideos = selectedVideos.filter(function (_, videoIndex) {
              return videoIndex !== index;
            });
            renderVideoPreviews();
          });
          item.appendChild(video);
          item.appendChild(removeBtn);
          videosPreviewWrap.appendChild(item);
        });
      }

      function renderEditImages() {
        if (!editPreviewWrap) return;
        editPreviewWrap.innerHTML = '';
        existingImages.forEach(function (imageItem) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const image = document.createElement('img');
          image.className = 'portfolio-preview-image';
          image.src = getImagePreviewUrl(imageItem);
          const actions = document.createElement('div');
          actions.className = 'portfolio-preview-actions';
          const coverBtn = document.createElement('button');
          coverBtn.type = 'button';
          coverBtn.className = 'portfolio-preview-cover';
          coverBtn.textContent = imageItem.is_cover ? 'Cover' : 'Set as cover';
          if (imageItem.is_cover) coverBtn.classList.add('is-cover');
          coverBtn.addEventListener('click', function () {
            existingImages = existingImages.map(function (item) {
              return {
                ...item,
                is_cover: item.id === imageItem.id,
              };
            });
            renderEditImages();
          });
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'profile-photo-remove is-portfolio-edit';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', async function () {
            try {
              queueImageDeletion(imageItem);
              existingImages = existingImages.filter(function (item) {
                return item.id !== imageItem.id;
              });
              if (!existingImages.some((item) => item.is_cover) && existingImages.length > 0) {
                existingImages[0].is_cover = true;
              }
              renderEditImages();
            } catch (error) {
              console.error(error);
              openNotifyModal(getErrorMessage(error, 'Image deletion failed'));
            }
          });
          actions.appendChild(coverBtn);
          actions.appendChild(removeBtn);
          item.appendChild(image);
          item.appendChild(actions);
          editPreviewWrap.appendChild(item);
        });
      }

      function renderEditVideos() {
        if (!editVideosPreviewWrap) return;
        editVideosPreviewWrap.innerHTML = '';
        existingVideos.forEach(function (videoItem) {
          const item = document.createElement('div');
          item.className = 'portfolio-preview-item';
          const video = document.createElement('video');
          video.className = 'portfolio-preview-video';
          video.src = getVideoPreviewUrl(videoItem);
          video.controls = true;
          video.muted = true;
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'profile-photo-remove is-portfolio-edit is-video';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', async function () {
            try {
              queueVideoDeletion(videoItem);
              existingVideos = existingVideos.filter(function (item) {
                return item.id !== videoItem.id;
              });
              renderEditVideos();
            } catch (error) {
              console.error(error);
              openNotifyModal(getErrorMessage(error, 'Video deletion failed'));
            }
          });
          item.appendChild(video);
          item.appendChild(removeBtn);
          editVideosPreviewWrap.appendChild(item);
        });
      }

      async function fillEditForm(portfolio) {
        cancelEditFormReset();
        activePortfolio = portfolio;

        if (portfolio && portfolio.pending_type === 'create') {
          if (editTitleInp) editTitleInp.value = portfolio.title || '';
          if (editDescInp) editDescInp.value = portfolio.description || '';

          const draftImageFiles = Array.isArray(portfolio.imageFiles) ? portfolio.imageFiles : [];
          const draftVideoFiles = Array.isArray(portfolio.videoFiles) ? portfolio.videoFiles : [];
          const safeCoverIndex = Math.min(Math.max(0, Number(portfolio.coverIndex || 0)), Math.max(0, draftImageFiles.length - 1));

          existingImages = draftImageFiles.map(function (file, index) {
            return {
              id: `new_${Date.now()}_${Math.random()}_${index}`,
              file,
              image_url: '',
              preview_url: URL.createObjectURL(file),
              is_cover: index === safeCoverIndex,
              sort_order: index,
              is_new: true,
            };
          });

          existingVideos = draftVideoFiles.map(function (file, index) {
            return {
              id: `new_${Date.now()}_${Math.random()}_${index}`,
              file,
              video_url: '',
              preview_url: URL.createObjectURL(file),
              sort_order: index,
              is_new: true,
            };
          });

          deletedImageIds = [];
          deletedVideoIds = [];
          renderEditImages();
          renderEditVideos();
          openModal();
          return;
        }

        const pendingDraft = pendingUpdateDrafts.get(String(portfolio.id));
        if (editTitleInp) editTitleInp.value = pendingDraft ? pendingDraft.title : portfolio.title || '';
        if (editDescInp) editDescInp.value = pendingDraft ? pendingDraft.description : portfolio.description || '';
        if (pendingDraft) {
          existingImages = cloneEditDraftItems(pendingDraft.images || []);
          existingVideos = cloneEditDraftItems(pendingDraft.videos || []);
          deletedImageIds = (pendingDraft.deletedImageIds || []).slice();
          deletedVideoIds = (pendingDraft.deletedVideoIds || []).slice();
        } else {
          existingImages = (await getPortfolioImages(portfolio.id)).map(function (imageItem) {
            return {
              ...imageItem,
              is_new: false,
            };
          });
          existingVideos = (await getPortfolioVideos(portfolio.id)).map(function (videoItem) {
            return {
              ...videoItem,
              is_new: false,
            };
          });
          deletedImageIds = [];
          deletedVideoIds = [];
        }
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
        const editBtn = qs('[edit-portfolio]', card);
        const removeBtn = qs('[open-remove-modal]', card);
        if (image) {
          image.src = getPortfolioCardImageUrl(portfolio);
          image.loading = 'lazy';
          image.decoding = 'async';
        }
        if (title) title.textContent = portfolio.title || '';
        if (description) description.innerHTML = portfolio.description || '';
        if (idBlock) idBlock.textContent = portfolio.id || '';
        if (statusBlock) {
          const status = (portfolio.status || portfolio.Status || '').toLowerCase();
          statusBlock.textContent = portfolio.is_draft ? 'draft' : status;
          statusBlock.classList.remove('is-approved', 'is-pending', 'is-rejected');
          if (portfolio.is_draft) statusBlock.classList.add('is-pending');
          if (status === 'approved') statusBlock.classList.add('is-approved');
          if (status === 'pending' || status === 'pending_review') statusBlock.classList.add('is-pending');
          if (status === 'rejected') statusBlock.classList.add('is-rejected');
        }
        if (editBtn) {
          editBtn.addEventListener('click', async function (event) {
            event.preventDefault();
            await fillEditForm(portfolio);
          });
        }
        if (removeBtn) {
          removeBtn.addEventListener('click', function (event) {
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
        const mergedPortfolios = portfolios.map(applyPendingOverlay).filter(Boolean).concat(pendingCreateDrafts);
        qsa('.portfolio_card:not(:first-child)', grid).forEach(function (card) {
          card.remove();
        });
        template.style.display = 'none';
        updateCreateDropdownState(portfolios.length);

        if (firstPortfolioInp) {
          if (!firstPortfolioInp.value && mergedPortfolios.length) {
            firstPortfolioInp.value = 'true';
          } else if (firstPortfolioInp.value && !mergedPortfolios.length) {
            firstPortfolioInp.value = '';
          }

          firstPortfolioInp.dispatchEvent(new Event('change', { bubbles: true }));
          firstPortfolioInp.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (!mergedPortfolios.length) {
          if (skipBlock) skipBlock.style.display = 'flex';
        } else {
          if (skipBlock) skipBlock.style.display = 'none';
        }

        mergedPortfolios.forEach(function (portfolio) {
          grid.appendChild(createCard(portfolio));
        });

        removeBtnsVisibility();
        updatePortfolioSubmitState();
      }

      function removeBtnsVisibility() {
        const cards = qsa('.portfolio_card:not(:first-child)', grid);
        cards.forEach(function (card) {
          const btn = qs('[open-remove-modal]', card);
          if (btn) btn.style.display = cards.length <= 1 ? 'none' : '';
        });
      }

      function resetCreateForm() {
        if (titleInp) titleInp.value = '';
        if (descInp) descInp.value = '';
        selectedFiles = [];
        selectedVideos = [];
        coverIndex = 0;
        if (coverIndexInput) coverIndexInput.value = '0';
        if (imagesInp) imagesInp.value = '';
        if (videosInp) videosInp.value = '';
        if (previewWrap) previewWrap.innerHTML = '';
        if (videosPreviewWrap) videosPreviewWrap.innerHTML = '';
        updateCreateSubmitState();
      }

      function closeCreateDropdown() {
        const dropdownToggle = qs('[data-add-highlight-dropdown]');
        if (dropdownToggle) dropdownToggle.click();
      }

      function disableDropdownToggle(state) {
        profileDrop.style.pointerEvents = state ? 'none' : 'auto';
        profileDrop.style.opacity = state ? '0.6' : '1';
      }

      async function handlePortfolioCreate(event) {
        event.preventDefault();
        try {
          disableDropdownToggle(true);
          const portfolios = await getPortfolios();
          if (portfolios.length + pendingCreateDrafts.length >= MAX_PORTFOLIOS) throw new Error(`Maximum ${MAX_PORTFOLIOS} portfolios allowed`);
          const title = titleInp ? titleInp.value.trim() : '';
          const description = descInp ? descInp.value.trim() : '';
          if (!title) throw new Error('Please fill all required fields');
          if (selectedFiles.length === 0) throw new Error('Please upload at least one image');
          pendingCreateDrafts.push(createCreateDraft());
          await renderPortfolios();
          resetCreateForm();

          closeCreateDropdown();
        } catch (error) {
          console.error(error);
          openNotifyModal(getErrorMessage(error, 'Portfolio creation failed'));
        } finally {
          disableDropdownToggle(false);
        }
      }

      async function handlePortfolioUpdate(event) {
        event.preventDefault();
        try {
          if (!activePortfolio) throw new Error('Portfolio is not selected');
          if (existingImages.length === 0) throw new Error('Portfolio must have at least one photo');
          if (editSubmit) {
            editSubmit.style.pointerEvents = 'none';
            editSubmit.style.opacity = '0.6';
          }

          if (activePortfolio.pending_type === 'create') {
            const updatedDraft = updateCreateDraftFromModal();
            pendingCreateDrafts = pendingCreateDrafts.map(function (draft) {
              return draft.id === updatedDraft.id ? updatedDraft : draft;
            });
            closeModal();
            await renderPortfolios();
            return;
          }

          pendingUpdateDrafts.set(String(activePortfolio.id), createUpdateDraft());
          closeModal();
          await renderPortfolios();
        } catch (error) {
          console.error(error);
          openNotifyModal(getErrorMessage(error, 'Portfolio update failed'));
        } finally {
          if (editSubmit) {
            editSubmit.style.pointerEvents = 'auto';
            editSubmit.style.opacity = '1';
          }
        }
      }

      async function commitCreateDraft(draft) {
        const uploadedImages = [];
        for (const file of draft.imageFiles || []) {
          uploadedImages.push(await uploadImage(file));
        }

        const coverImage = uploadedImages[draft.coverIndex] || uploadedImages[0];
        const coverUrl = coverImage ? XANO_BASE + coverImage.path : '';
        const portfolio = await createPortfolio({
          memberstack_id: MEMBER.id,
          title: draft.title,
          description: draft.description,
          thumbnail_url: coverUrl,
        });

        for (let index = 0; index < uploadedImages.length; index++) {
          const imageData = uploadedImages[index];
          const imageUrl = XANO_BASE + imageData.path;
          await addPortfolioImage({
            memberstack_id: MEMBER.id,
            portfolio_id: Number(portfolio.id),
            image: imageData,
            image_url: imageUrl,
            is_cover: index === draft.coverIndex,
            sort_order: Number(index),
          });
        }

        for (let index = 0; index < (draft.videoFiles || []).length; index++) {
          const videoData = await uploadVideo(draft.videoFiles[index]);
          const videoUrl = XANO_BASE + videoData.path;
          await addPortfolioVideo({
            memberstack_id: MEMBER.id,
            portfolio_id: Number(portfolio.id),
            video: videoData,
            video_url: videoUrl,
            sort_order: Number(index),
          });
        }

        return portfolio;
      }

      async function commitUpdateDraft(draft) {
        const uploadedImageMap = new Map();
        const uploadedVideoMap = new Map();
        const newImages = (draft.images || []).filter((item) => item.is_new);
        const newVideos = (draft.videos || []).filter((item) => item.is_new);

        for (const imageItem of newImages) {
          const imageData = await uploadImage(imageItem.file);
          uploadedImageMap.set(imageItem.id, imageData);
        }

        for (const videoItem of newVideos) {
          const videoData = await uploadVideo(videoItem.file);
          uploadedVideoMap.set(videoItem.id, videoData);
        }

        const coverImage = (draft.images || []).find(function (item) {
          return item.is_cover;
        });
        const coverImageUrl = coverImage ? (coverImage.is_new ? XANO_BASE + uploadedImageMap.get(coverImage.id).path : coverImage.image_url) : '';

        await updatePortfolio({
          id: draft.id,
          memberstack_id: MEMBER.id,
          title: draft.title,
          description: draft.description,
          thumbnail_url: coverImageUrl,
        });

        for (const imageId of draft.deletedImageIds || []) {
          await deletePortfolioImage(imageId);
        }

        for (let index = 0; index < newImages.length; index++) {
          const imageItem = newImages[index];
          const imageData = uploadedImageMap.get(imageItem.id);
          if (!imageData) continue;
          await addPortfolioImage({
            memberstack_id: MEMBER.id,
            portfolio_id: Number(draft.id),
            image: imageData,
            image_url: XANO_BASE + imageData.path,
            is_cover: imageItem.is_cover,
            sort_order: Number((draft.images || []).indexOf(imageItem)),
          });
        }

        for (const videoId of draft.deletedVideoIds || []) {
          await deletePortfolioVideo(videoId);
        }

        for (let index = 0; index < newVideos.length; index++) {
          const videoItem = newVideos[index];
          const videoData = uploadedVideoMap.get(videoItem.id);
          if (!videoData) continue;
          await addPortfolioVideo({
            memberstack_id: MEMBER.id,
            portfolio_id: Number(draft.id),
            video: videoData,
            video_url: XANO_BASE + videoData.path,
            sort_order: Number((draft.videos || []).indexOf(videoItem)),
          });
        }
      }

      async function commitDeleteDrafts() {
        for (const portfolioId of pendingDeleteDraftIds) {
          await deletePortfolio({
            id: Number(portfolioId),
            memberstack_id: MEMBER.id,
          });
        }
      }

      function setPortfolioSubmitLoading(button, isLoading) {
        if (!button) return;

        button.style.opacity = isLoading ? '0.6' : '';
        button.style.pointerEvents = isLoading ? 'none' : '';

        const step = button.closest('[data-form=step]');
        if (step) setLoader(isLoading, step);

        qsa('.button_main-text', button).forEach(function (el) {
          el.textContent = isLoading ? 'Loading...' : 'Submit';
        });
      }

      async function handlePortfolioSubmitAll(event) {
        event.preventDefault();

        const finalSubmitButton = portfolioSubmit || editSubmit || createSubmit;

        if (!pendingCreateDrafts.length && !pendingUpdateDrafts.size && !pendingDeleteDraftIds.size) {
          successController.showForSubmit(0);
          return;
        }

        try {
          setPortfolioSubmitLoading(finalSubmitButton, true);

          const createDrafts = pendingCreateDrafts.slice();
          const updateDrafts = Array.from(pendingUpdateDrafts.values());

          await commitStarterEditPortfolioDrafts({
            createDrafts: createDrafts,
            updateDrafts: updateDrafts,
            commitCreateDraft: commitCreateDraft,
            commitUpdateDraft: commitUpdateDraft,
            commitDeleteDrafts: commitDeleteDrafts,
            clearAllDraftQueues: clearAllDraftQueues,
            renderPortfolios: renderPortfolios,
            successController: successController,
          });
        } catch (error) {
          console.error(error);
          openNotifyModal(getErrorMessage(error, 'Portfolio save failed'));
        } finally {
          setPortfolioSubmitLoading(finalSubmitButton, false);
          updatePortfolioSubmitState();
        }
      }

      async function handleDeleteFromModal(button, shouldCloseEditModal) {
        if (!activePortfolio) return;
        try {
          button.style.pointerEvents = 'none';
          button.style.opacity = '0.6';
          queuePortfolioDeletion(activePortfolio);
          if (shouldCloseEditModal) closeModal();
          closeRemoveModal();
          await renderPortfolios();
        } catch (error) {
          console.error(error);
          openNotifyModal(getErrorMessage(error, 'Portfolio deletion failed'));
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
        const directRemoveBtn = event.target.closest('[remove-item-direct]');
        if (directRemoveBtn) {
          await handleDeleteFromModal(directRemoveBtn, false);
          return;
        }
        const closeRemoveBtn = event.target.closest('[close-remove]');
        if (closeRemoveBtn) {
          event.preventDefault();
          if (closeRemoveBtn.closest('[data-modal-target="portfolio-notification"]')) {
            closeNotifyModal();
            return;
          }
          closeRemoveModal();
          return;
        }
        const closeButton = event.target.closest('[aria-label="close button"]');
        if (closeButton && closeButton.closest('[data-modal-target="portfolio-notification"]')) {
          event.preventDefault();
          closeNotifyModal();
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
        const portfolioId = (idBlock.textContent || '').trim();
        try {
          const draftPortfolio = getDraftPortfolioById(portfolioId);
          if (draftPortfolio) {
            await fillEditForm(draftPortfolio);
            return;
          }

          const portfolios = await getPortfolios();
          const portfolio = portfolios.find((item) => String(item.id) === portfolioId);
          if (portfolio) await fillEditForm(portfolio);
        } catch (error) {
          console.error(error);
          openNotifyModal(getErrorMessage(error, 'Failed to open portfolio'));
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
          openNotifyModal(getErrorMessage(error, 'Failed to open portfolio'));
        }
      });

      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        closeNotifyModal();
        closeRemoveModal();
      });

      if (imagesInp) {
        imagesInp.setAttribute('multiple', 'multiple');
        imagesInp.addEventListener('change', function () {
          const files = Array.from(imagesInp.files);

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
            openNotifyModal(messages.join('\n'));
          }

          selectedFiles = selectedFiles.concat(filesToAdd);
          if (selectedFiles.length && coverIndex >= selectedFiles.length) coverIndex = 0;

          if (coverIndexInput) coverIndexInput.value = coverIndex;

          renderImagePreviews();
          updateCreateSubmitState();

          imagesInp.value = '';
        });
      }

      if (videosInp) {
        videosInp.setAttribute('multiple', 'multiple');
        videosInp.addEventListener('change', function () {
          const files = Array.from(videosInp.files);
          const oversizedFiles = files.filter(function (file) {
            return file.size > MAX_VIDEO_SIZE;
          });

          if (oversizedFiles.length) {
            openNotifyModal('Video exceeds 50MB upload size limit');
            videosInp.value = '';
            selectedVideos = [];
            if (videosPreviewWrap) videosPreviewWrap.innerHTML = '';
            return;
          }

          const availableSlots = Math.max(0, 3 - selectedVideos.length);
          const filesToAdd = files.slice(0, availableSlots);

          if (files.length > availableSlots) {
            openNotifyModal('Maximum 3 videos allowed');
          }

          selectedVideos = selectedVideos.concat(filesToAdd);

          renderVideoPreviews();

          videosInp.value = '';
        });
      }

      if (editImagesInp) {
        editImagesInp.setAttribute('multiple', 'multiple');
        editImagesInp.addEventListener('change', function () {
          const files = Array.from(editImagesInp.files);
          const oversizedFiles = files.filter(function (file) {
            return file.size > MAX_IMAGE_SIZE;
          });

          if (oversizedFiles.length) {
            openNotifyModal('Image exceeds 4MB upload size limit');
            editImagesInp.value = '';
            return;
          }
          const availableSlots = Math.max(0, 5 - existingImages.length);
          const filesToAdd = files.slice(0, availableSlots);
          if (files.length > availableSlots) {
            openNotifyModal('Maximum 5 photos allowed');
          }
          for (const file of filesToAdd) {
            existingImages.push({
              id: `new_${Date.now()}_${Math.random()}`,
              file,
              image_url: '',
              preview_url: URL.createObjectURL(file),
              is_cover: existingImages.length === 0,
              sort_order: existingImages.length,
              is_new: true,
            });
          }
          renderEditImages();
          editImagesInp.value = '';
        });
      }

      if (editVideosInp) {
        editVideosInp.setAttribute('multiple', 'multiple');
        editVideosInp.addEventListener('change', function () {
          const files = Array.from(editVideosInp.files);
          const oversizedFiles = files.filter(function (file) {
            return file.size > MAX_VIDEO_SIZE;
          });

          if (oversizedFiles.length) {
            openNotifyModal('Video exceeds 50MB upload size limit');
            editVideosInp.value = '';
            return;
          }
          const availableSlots = Math.max(0, 3 - existingVideos.length);
          const filesToAdd = files.slice(0, availableSlots);
          if (files.length > availableSlots) {
            openNotifyModal('Maximum 3 videos allowed');
          }
          for (const file of filesToAdd) {
            existingVideos.push({
              id: `new_${Date.now()}_${Math.random()}`,
              file,
              video_url: '',
              preview_url: URL.createObjectURL(file),
              sort_order: existingVideos.length,
              is_new: true,
            });
          }
          renderEditVideos();
          editVideosInp.value = '';
        });
      }

      if (createSubmit) createSubmit.addEventListener('click', handlePortfolioCreate);

      if (titleInp) {
        titleInp.addEventListener('input', updateCreateSubmitState);
      }

      updateCreateSubmitState();
      updatePortfolioSubmitState();

      if (editSubmit) editSubmit.addEventListener('click', handlePortfolioUpdate);
      if (portfolioSubmit) portfolioSubmit.addEventListener('click', handlePortfolioSubmitAll);

      if (editModal && editModal.open) closeModal();
      closeNotifyModal();
      try {
        await renderPortfolios();
      } catch (error) {
        console.error(error);
        openNotifyModal(getErrorMessage(error, 'Failed to load portfolios'));
      }
    });
  });
