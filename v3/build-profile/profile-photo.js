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
      const BUILD_PROFILE_PATHS = ['/build-profile/full-profile', '/build-profile/consult'];
      const isBuildProfile = BUILD_PROFILE_PATHS.includes(String(window.location?.pathname || ''));
      let currentUploadIntent = null;
      let buildProfileSaved = false;

      const XANO_BASE_URL = 'https://x08a-5ko8-jj1r.n7c.xano.io';
      const wrap = document.querySelector('#profile-photo-wrap');
      const label = wrap?.querySelector('.app-form_upload');
      const input = document.querySelector('#profile-photo');
      const preview = document.querySelector('#profile-photo-preview');
      const previewImg = document.querySelector('#profile-photo-preview-img');
      const removeBtn = document.querySelector('#profile-photo-remove');
      const photoUrlInput = document.querySelector('#profile-photo-url');

      if (!wrap || !label || !input || !preview || !previewImg || !photoUrlInput) return;

      const photoCaptureAttribute = photoUrlInput.getAttribute('data-input-capture');
      const hadPhotoCaptureAttribute = photoUrlInput.hasAttribute('data-input-capture');

      const buildPhotoApi = window.StartersBuildProfilePhotoUpload || {};
      if (isBuildProfile) window.StartersBuildProfilePhotoUpload = buildPhotoApi;

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
        currentUploadIntent = null;
        input.value = '';
        previewImg.src = '';
        label.classList.remove('dropping');

        restorePhotoCaptureAttribute();
        photoUrlInput.value = '';
        photoUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
        photoUrlInput.dispatchEvent(new Event('input', { bubbles: true }));

        preview.style.display = 'none';
        wrap.style.display = 'block';
      }

      function restorePhotoCaptureAttribute() {
        if (hadPhotoCaptureAttribute) {
          photoUrlInput.setAttribute('data-input-capture', photoCaptureAttribute || '');
        }
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
          if (currentUploadIntent?.state !== 'failed') return;
          file = currentUploadIntent.file;
        } else {
          currentUploadIntent = null;
        }
        if (!file) return;

        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];

        if (!allowedTypes.includes(file.type)) {
          showError('Please upload a JPG, PNG, or WebP image.');
          return;
        }

        if (file.size > MAX_SIZE) {
          showError('Image is too large. Max size is 4MB.');
          return;
        }

        const imageUrl = URL.createObjectURL(file);
        previewImg.src = imageUrl;

        wrap.style.display = 'none';
        preview.style.display = 'block';

        let uploadIntent;
        try {
          if (retry) {
            uploadIntent = currentUploadIntent;
          } else {
            uploadIntent = { file, state: 'prepared', result: null, promise: null };
            currentUploadIntent = uploadIntent;
            uploadIntent.sourceMutationId = createSourceMutationId();
          }
          if (isBuildProfile && !retry) {
            // Keep the temporary required-field marker out of draft capture. The exact
            // authored capture attribute is restored after the canonical upload succeeds.
            // An already stored photo URL satisfies the required field on its own, and
            // draft capture must keep persisting it while the replacement is pending.
            if (!String(photoUrlInput.value || '').trim()) {
              photoUrlInput.removeAttribute('data-input-capture');
              photoUrlInput.value = 'pending-profile-photo-upload';
            }
            setLoader(false, preview);
            return;
          }
          if (isBuildProfile) {
            await commitPreparedUpload();
            return;
          }
          await applyUploadIntent(uploadIntent);
        } catch (error) {
          if (currentUploadIntent !== uploadIntent) return;
          uploadIntent.state = 'failed';
          setLoader(false, preview);
          wrap.style.display = 'block';
          showError('Image upload failed. Click here to try again.');
          console.error('Profile image upload failed:', error);
          return;
        }
      }

      async function applyUploadIntent(uploadIntent) {
        if (!uploadIntent || currentUploadIntent !== uploadIntent) return null;
        if (uploadIntent.state === 'complete') return uploadIntent.result;
        if (uploadIntent.promise) return uploadIntent.promise;

        uploadIntent.state = 'uploading';
        uploadIntent.promise = (async () => {
          setLoader(true, preview);
          const wf_photo_data = await uploadImage(
            uploadIntent.file,
            uploadIntent.sourceMutationId,
          );
          if (currentUploadIntent !== uploadIntent) return;
          uploadIntent.state = 'applying';
          restorePhotoCaptureAttribute();
          photoUrlInput.value = wf_photo_data['starter_image'];
          photoUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
          photoUrlInput.dispatchEvent(new Event('input', { bubbles: true }));

          setLoader(false, preview);

          uploadIntent.state = 'complete';
          uploadIntent.result = wf_photo_data;

          // The Memberstack avatar is written SERVER-side by Xano #1390, which stores the
          // durable Xano vault URL. This block used to re-upload the image through
          // updateMemberProfileImage, which made Memberstack re-host it on its own S3 and
          // clobber the server's write moments later. Those S3 objects 403 as soon as the
          // member replaces the photo, and TalkJS - whose avatar reads member.profileImage
          // and is refreshed only when that member next opens a messages page - then holds a
          // dead URL indefinitely. Verified 2026-08-29 on starter row 1063.
          // Only the on-page navbar avatar is updated here, straight from the canonical URL.
          requestAnimationFrame(() => {
            if (currentUploadIntent !== uploadIntent) return;
            qsa('[nav-profile-image]').forEach(img => {
              img.src = img.srcset = wf_photo_data['starter_image'];
            });
          });
          return wf_photo_data;
        })();

        try {
          return await uploadIntent.promise;
        } catch (error) {
          if (currentUploadIntent === uploadIntent) uploadIntent.state = 'failed';
          throw error;
        } finally {
          uploadIntent.promise = null;
        }
      }

      async function commitPreparedUpload() {
        if (!isBuildProfile || !currentUploadIntent) return null;
        if (!buildProfileSaved) throw new Error('Save the profile before uploading its photo');
        try {
          return await applyUploadIntent(currentUploadIntent);
        } catch (error) {
          setLoader(false, preview);
          wrap.style.display = 'block';
          showError('Image upload failed. Click here to try again.');
          console.error('Profile image upload failed:', error);
          throw error;
        }
      }

      if (isBuildProfile) {
        buildPhotoApi.hasPendingUpload = () => !!currentUploadIntent && currentUploadIntent.state !== 'complete';
        buildPhotoApi.markProfileSaved = () => { buildProfileSaved = true; };
        buildPhotoApi.commitPending = commitPreparedUpload;
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
          currentUploadIntent?.state === 'failed' &&
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
