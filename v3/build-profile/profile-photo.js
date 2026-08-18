/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: 213646b19cc04f2b87375afeb303cc7ebe1f598cd5ffa4ce471b7c4ca895cf5c
 * Captured read-only from /build-profile/consult on 2026-08-12.
 */
;(function loadCanonicalProfileHydrator() {
  if (window.StartersBuildProfileCanonicalHydrator || window.__tsCanonicalProfileHydratorLoading) {
    return
  }
  var buildProfilePaths = ['/build-profile/full-profile', '/build-profile/consult']
  var isBuildProfile = buildProfilePaths.includes(String(window.location && window.location.pathname || ''))
  var originalWaitForProfile = window.waitProfileData
  var waitingForCanonical = []
  var canonicalReleased = false
  if (isBuildProfile && typeof originalWaitForProfile === 'function') {
    window.waitProfileData = function waitForCanonicalProfile(callback) {
      if (canonicalReleased) return originalWaitForProfile(callback)
      waitingForCanonical.push(callback)
    }
    window.__tsReleaseBuildProfileCanonical = function releaseCanonicalProfile() {
      if (canonicalReleased) return
      canonicalReleased = true
      window.waitProfileData = originalWaitForProfile
      waitingForCanonical.splice(0).forEach(function resumeProfileConsumer(callback) {
        originalWaitForProfile(callback)
      })
    }
  }
  var source = document.currentScript && document.currentScript.src
  if (!source) {
    if (window.__tsReleaseBuildProfileCanonical) window.__tsReleaseBuildProfileCanonical()
    return
  }
  var script = document.createElement('script')
  script.src = new URL('canonical-profile-hydrator.js', source).href
  script.async = false
  window.__tsCanonicalProfileHydratorLoading = true
  script.addEventListener('load', function loaded() {
    window.__tsCanonicalProfileHydratorLoading = false
  }, { once: true })
  script.addEventListener('error', function failed() {
    window.__tsCanonicalProfileHydratorLoading = false
    if (window.__tsReleaseBuildProfileCanonical) window.__tsReleaseBuildProfileCanonical()
    console.warn('[build-profile-canonical] loader failed')
  }, { once: true })
  ;(document.head || document.documentElement).appendChild(script)
})()

  document.addEventListener('DOMContentLoaded', () => {
    waitForMember(() => {
      if (!MEMBER.id) return;

      const MAX_SIZE = 4 * 1024 * 1024; // 4MB
      const SOURCE_MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
      let pendingUploadIntent = null;

      const XANO_BASE_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io';
      const wrap = document.querySelector('#profile-photo-wrap');
      const label = wrap?.querySelector('.app-form_upload');
      const input = document.querySelector('#profile-photo');
      const preview = document.querySelector('#profile-photo-preview');
      const previewImg = document.querySelector('#profile-photo-preview-img');
      const removeBtn = document.querySelector('#profile-photo-remove');
      const photoUrlInput = document.querySelector('#profile-photo-url');

      if (!wrap || !label || !input || !preview || !previewImg || !photoUrlInput) return;

      waitProfileData(() => {
        if (activeProfile['data']['step_1']['profile-photo-url'] && activeProfile['data']['step_1']['profile-photo-url'] !== '') {
          previewImg.src = activeProfile['data']['step_1']['profile-photo-url'];
          setTimeout(() => {
            wrap.style.display = 'none';
            preview.style.display = 'block';
          }, 100);
        }
      });

      function showError(text, state = true) {
        let error = wrap.querySelector('.upload-error');

        if (!error) {
          error = document.createElement('div');
          error.className = 'upload-error';
          wrap.appendChild(error);
        }

        error.textContent = text;

        if (state) {
          error.style.display = 'block';
        } else {
          error.style.display = 'none';
        }
      }

      function resetPhoto() {
        pendingUploadIntent = null;
        input.value = '';
        previewImg.src = '';
        label.classList.remove('dropping');

        photoUrlInput.value = '';
        photoUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
        photoUrlInput.dispatchEvent(new Event('input', { bubbles: true }));

        preview.style.display = 'none';
        wrap.style.display = 'block';
      }

      function createSourceMutationId() {
        const cryptoApi = window.crypto;
        let id = '';

        if (typeof cryptoApi?.randomUUID === 'function') {
          id = cryptoApi.randomUUID();
        } else if (typeof cryptoApi?.getRandomValues === 'function') {
          const bytes = cryptoApi.getRandomValues(new Uint8Array(24));
          let binary = '';
          bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
          id = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        }

        if (!SOURCE_MUTATION_ID_PATTERN.test(id)) {
          throw new Error('Secure upload intent ID is unavailable');
        }
        return id;
      }

      async function handleFile(file, { retry = false } = {}) {
        label.classList.remove('dropping');

        // hide error block
        showError("text", false);

        if (retry) {
          if (!pendingUploadIntent) return;
          file = pendingUploadIntent.file;
        } else {
          pendingUploadIntent = null;
        }
        if (!file) return;

        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp'];

        if (!allowedTypes.includes(file.type)) {
          showError('Please upload a valid image. GIF images are not supported.');
          return;
        }

        if (file.size > MAX_SIZE) {
          showError('Image is too large. Max size is 4MB.');
          return;
        }

        setLoader(true, preview);

        const imageUrl = URL.createObjectURL(file);
        previewImg.src = imageUrl;

        wrap.style.display = 'none';
        preview.style.display = 'block';

        // upload the image to Xano/Webflow and update the profile data with Webflow photo URL
        let uploadIntent;
        let wf_photo_data;
        try {
          uploadIntent = retry
            ? pendingUploadIntent
            : {
                file,
                sourceMutationId: createSourceMutationId(),
              };
          pendingUploadIntent = uploadIntent;
          wf_photo_data = await uploadImage(
            uploadIntent.file,
            uploadIntent.sourceMutationId,
          );
        } catch (error) {
          setLoader(false, preview);
          wrap.style.display = 'block';
          showError('Image upload failed. Click here to try again.');
          console.error('Profile image upload failed:', error);
          return;
        }
        if (pendingUploadIntent === uploadIntent) pendingUploadIntent = null;
        waitProfileData(async () => {
          photoUrlInput.value = wf_photo_data['starter_image'];
          photoUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
          photoUrlInput.dispatchEvent(new Event('input', { bubbles: true }));

          setLoader(false, preview);

          const fileSmaller = await urlToFile(wf_photo_data['starter_image_small'], file.name);
          const updImgInfo = await window.$memberstackDom.updateMemberProfileImage({ profileImage: fileSmaller });
          console.log('Smaller image for Memberstack profile:', updImgInfo?.data?.profileImage);
          
          // update logo image in the nav bar
          requestAnimationFrame(() => {
            qsa('[nav-profile-image]').forEach(img => {
              img.src = img.srcset = updImgInfo?.data?.profileImage || wf_photo_data['starter_image'];
            });
          });
        });
      }

      async function urlToFile(url, fileName = 'profile-photo.jpg') {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error('Failed to fetch image');
        }

        const blob = await response.blob();
        const mimeType = blob.type || 'image/jpeg';

        return new File([blob], fileName, {
          type: mimeType,
          lastModified: Date.now(),
        });
      }

      async function uploadImage(file, sourceMutationId) {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('source_mutation_id', sourceMutationId);
        const data = await requestJson(
          XANO_BASE_URL + '/api:KZf7nFnk/build_profile/starter/profile_image',
          {
            method: 'POST',
            body: formData,
          },
          'Image upload failed',
        );
        if (
          typeof data?.starter_image !== 'string' ||
          data.starter_image.trim() === '' ||
          typeof data?.starter_image_small !== 'string' ||
          data.starter_image_small.trim() === ''
        ) {
          throw new Error('Image upload response is incomplete');
        }
        return data;
      }

      async function requestJson(url, options, errorLabel) {
        const diagnostics = window.StartersNativeFormDiagnostics;
        const request = () => fetch(url, options);
        const response = await (diagnostics
          ? diagnostics.observeMutation('profile_photo_xano_upload', request)
          : request());
        const data = await response.json();
        if (!response.ok) {
          console.error(`${errorLabel}:`, data);
          throw new Error(data.message || errorLabel);
        }
        return data;
      }

      input.addEventListener('change', () => {
        handleFile(input.files[0]);
      });

      input.addEventListener('click', () => {
        input.value = '';
      });

      wrap.addEventListener('click', (event) => {
        if (
          pendingUploadIntent &&
          event.target?.classList?.contains('upload-error')
        ) {
          handleFile(null, { retry: true });
        }
      });

      label.addEventListener('dragenter', (e) => {
        e.preventDefault();
        label.classList.add('dropping');
      });

      label.addEventListener('dragover', (e) => {
        e.preventDefault();
        label.classList.add('dropping');
      });

      label.addEventListener('dragleave', (e) => {
        if (!label.contains(e.relatedTarget)) {
          label.classList.remove('dropping');
        }
      });

      label.addEventListener('drop', (e) => {
        e.preventDefault();

        const file = e.dataTransfer.files[0];
        if (file) {
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
        }

        handleFile(file);
      });

      removeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        resetPhoto();
      });
    });
  });
