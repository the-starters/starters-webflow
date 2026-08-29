const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const controllerSource = fs.readFileSync(require.resolve('./profile-photo.js'), 'utf8');
const shimSource = fs.readFileSync(
  require.resolve('../../profile-image-auth-shim.js'),
  'utf8',
);

class TestFormData {
  constructor() {
    this.values = new Map();
  }

  append(name, value) {
    this.values.set(name, value);
  }

  get(name) {
    return this.values.has(name) ? this.values.get(name) : null;
  }
}

class TestFile {
  constructor(parts, name, options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = options.type || '';
    this.size = parts.reduce((total, part) => total + String(part).length, 0);
  }
}

function element() {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  return {
    style: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    value: '',
    files: [],
    listeners,
    addEventListener(name, listener) { listeners.set(name, listener); },
    dispatchEvent(event) {
      const listener = listeners.get(event.type);
      if (listener) listener(event);
    },
    appendChild() {},
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    hasAttribute(name) { return attributes.has(name); },
    removeAttribute(name) { attributes.delete(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    contains() { return false; },
    querySelector() { return null; },
  };
}

function createHarness({
  avatarResponder,
  cryptoApi,
  uploadResponder,
  pathname = '/build-profile/full-profile',
  storedPhotoUrl = '',
} = {}) {
  const label = element();
  const wrap = element();
  const uploadError = element();
  uploadError.classList.add('upload-error');
  wrap.querySelector = (selector) => {
    if (selector === '.app-form_upload') return label;
    if (selector === '.upload-error') return uploadError;
    return null;
  };
  const input = element();
  const preview = element();
  const previewImg = element();
  const removeBtn = element();
  const photoUrlInput = element();
  const navbarImages = [element(), element()];
  photoUrlInput.setAttribute('data-input-capture', '');
  photoUrlInput.value = storedPhotoUrl;
  const elements = new Map([
    ['#profile-photo-wrap', wrap],
    ['#profile-photo', input],
    ['#profile-photo-preview', preview],
    ['#profile-photo-preview-img', previewImg],
    ['#profile-photo-remove', removeBtn],
    ['#profile-photo-url', photoUrlInput],
  ]);
  let domReady;
  let profileImageUpdateCalls = 0;
  let resizeCount = 0;
  const uploads = [];
  const uploadResponses = [
    { starter_image: '   ', starter_image_small: '\n' },
    {
      starter_image: 'https://example.invalid/photo.jpg',
      starter_image_small: 'https://example.invalid/photo-small.jpg',
    },
    {
      starter_image: 'https://example.invalid/photo.jpg',
      starter_image_small: 'https://example.invalid/photo-small.jpg',
    },
    {
      starter_image: 'https://example.invalid/photo.jpg',
      starter_image_small: 'https://example.invalid/photo-small.jpg',
    },
    {
      starter_image: 'https://example.invalid/photo.jpg',
      starter_image_small: 'https://example.invalid/photo-small.jpg',
    },
  ];
  const uuids = [
    '123e4567-e89b-12d3-a456-426614174000',
    '123e4567-e89b-12d3-a456-426614174001',
    '123e4567-e89b-12d3-a456-426614174002',
    '123e4567-e89b-12d3-a456-426614174003',
  ];
  let uuidIndex = 0;
  const document = {
    addEventListener(name, listener) { if (name === 'DOMContentLoaded') domReady = listener; },
    querySelector(selector) { return elements.get(selector) || null; },
    createElement(tagName) {
      if (tagName === 'canvas') {
        return {
          getContext() {
            return {
              fillRect() {},
              drawImage() {},
              set fillStyle(value) {},
            };
          },
          toBlob(resolve) {
            resolve(new Blob([`encoded-${resizeCount}`], { type: 'image/jpeg' }));
          },
        };
      }
      return element();
    },
  };
  const originalFetch = async (url, options = {}) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return new Response(JSON.stringify({ authToken: 'xano-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (String(url).includes('/profile_image')) {
      uploads.push({
        image: options.body.get('image'),
        sourceMutationId: options.body.get('source_mutation_id'),
        memberId: options.body.get('member_id'),
      });
      if (uploadResponder) return uploadResponder(uploads.length - 1);
      return new Response(JSON.stringify(uploadResponses.shift()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('small-image', { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  };
  const window = {
    crypto: cryptoApi === undefined
      ? { randomUUID: () => uuids[uuidIndex++] }
      : cryptoApi,
    location: {
      hostname: 'thestarters.com',
      pathname,
      origin: 'https://thestarters.com',
    },
    localStorage: { setItem() {}, removeItem() {} },
    fetch: originalFetch,
    $memberstackDom: {
      async getMemberCookie() { return 'memberstack-token'; },
      async updateMemberProfileImage() {
        profileImageUpdateCalls += 1;
        if (avatarResponder) return avatarResponder();
        return { data: { profileImage: 'https://example.invalid/small.jpg' } };
      },
    },
  };
  class TestEvent {
    constructor(type, options = {}) {
      this.type = type;
      Object.assign(this, options);
    }

    preventDefault() {}
  }
  class TestURL extends URL {
    static createObjectURL() {
      return 'blob:preview';
    }
  }
  const context = vm.createContext({
    window,
    document,
    console: { log() {}, info() {}, warn() {}, error() {} },
    MEMBER: { id: 'member-id-not-sent' },
    activeProfile: { data: { step_1: { 'profile-photo-url': '' } } },
    waitForMember: (callback) => callback(),
    waitProfileData: (callback) => callback(),
    setLoader() {},
    qsa: (selector) => selector === '[nav-profile-image]' ? navbarImages : [],
    fetch: originalFetch,
    FormData: TestFormData,
    File: TestFile,
    Event: TestEvent,
    DataTransfer: class {
      constructor() {
        this.files = [];
        this.items = { add: (file) => { this.files.push(file); } };
      }
    },
    Uint8Array,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    URL: TestURL,
    Headers,
    Request,
    JSON,
    Response,
    Blob,
    Promise,
    createImageBitmap: async () => {
      resizeCount += 1;
      return { width: 1200, height: 800, close() {} };
    },
    setTimeout: (callback) => callback(),
    requestAnimationFrame: (callback) => callback(),
  });
  vm.runInContext(shimSource, context);
  context.fetch = window.fetch;
  vm.runInContext(controllerSource, context);
  domReady();
  return {
    input,
    label,
    preview,
    previewImg,
    photoUrlInput,
    navbarImages,
    removeBtn,
    uploadError,
    uploads,
    wrap,
    window,
    resizeCount: () => resizeCount,
    profileImageUpdateCalls: () => profileImageUpdateCalls,
    TestEvent,
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  const {
    input,
    label,
    photoUrlInput,
    uploadError,
    uploads,
    wrap,
    window,
    resizeCount,
    TestEvent,
  } = createHarness();
  const firstFile = {
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 100,
    lastModified: 123,
  };
  input.value = '/fake/photo.jpg';
  input.files = [firstFile];
  input.dispatchEvent(new TestEvent('change'));
  await settle();
  assert.equal(uploads.length, 0);
  assert.equal(photoUrlInput.value, 'pending-profile-photo-upload');
  assert.equal(photoUrlInput.hasAttribute('data-input-capture'), false);
  await assert.rejects(window.StartersBuildProfilePhotoUpload.commitPending(), /Save the profile/);
  assert.equal(uploads.length, 0);

  window.StartersBuildProfilePhotoUpload.markProfileSaved();
  await assert.rejects(window.StartersBuildProfilePhotoUpload.commitPending(), /Image upload response is incomplete/);
  assert.equal(uploads.length, 1);
  assert.equal(uploadError.style.display, 'block');
  assert.equal(uploadError.textContent, 'Image upload failed. Click here to try again.');

  wrap.listeners.get('click')({ target: uploadError });
  await settle();
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].sourceMutationId, uploads[1].sourceMutationId);
  assert.equal(uploads[0].memberId, null);
  assert.equal(uploads[1].memberId, null);
  assert.equal(resizeCount(), 1);
  assert.equal(photoUrlInput.hasAttribute('data-input-capture'), true);

  const replacementWithSameMetadata = {
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 100,
    lastModified: 123,
  };
  input.dispatchEvent(new TestEvent('click'));
  assert.equal(input.value, '');
  input.value = '/fake/photo.jpg';
  input.files = [replacementWithSameMetadata];
  input.dispatchEvent(new TestEvent('change'));
  await settle();
  assert.equal(uploads.length, 2);
  await window.StartersBuildProfilePhotoUpload.commitPending();
  assert.equal(uploads.length, 3);
  assert.notEqual(uploads[2].sourceMutationId, uploads[1].sourceMutationId);
  assert.equal(resizeCount(), 2);

  const secondFile = { name: 'new-photo.jpg', type: 'image/jpeg', size: 100 };
  input.dispatchEvent(new TestEvent('click'));
  input.value = '/fake/new-photo.jpg';
  input.files = [secondFile];
  input.dispatchEvent(new TestEvent('change'));
  await settle();
  assert.equal(uploads.length, 3);
  await window.StartersBuildProfilePhotoUpload.commitPending();
  assert.equal(uploads.length, 4);
  assert.notEqual(uploads[3].sourceMutationId, uploads[2].sourceMutationId);

  const droppedFile = { name: 'drop.jpg', type: 'image/jpeg', size: 100 };
  label.listeners.get('drop')({
    preventDefault() {},
    dataTransfer: { files: [droppedFile] },
  });
  await settle();
  assert.equal(uploads.length, 4);
  await window.StartersBuildProfilePhotoUpload.commitPending();
  assert.equal(uploads.length, 5);
  assert.notEqual(uploads[4].sourceMutationId, uploads[3].sourceMutationId);
  assert.equal(uploads.every((upload) => upload.image && upload.memberId === null), true);

  for (const [name, type] of [
    ['photo.avif', 'image/avif'],
    ['photo.svg', 'image/svg+xml'],
    ['photo.bmp', 'image/bmp'],
  ]) {
    const unsupportedFormat = createHarness();
    unsupportedFormat.input.files = [{ name, type, size: 100 }];
    unsupportedFormat.input.dispatchEvent(new unsupportedFormat.TestEvent('change'));
    await settle();
    assert.equal(unsupportedFormat.uploads.length, 0);
    assert.equal(unsupportedFormat.uploadError.style.display, 'block');
    assert.equal(
      unsupportedFormat.uploadError.textContent,
      'Please upload a JPG, PNG, or WebP image.',
    );
  }

  const fourMegabyteBoundary = createHarness();
  fourMegabyteBoundary.input.files = [{
    name: 'photo.png',
    type: 'image/png',
    size: 4 * 1024 * 1024,
  }];
  fourMegabyteBoundary.input.dispatchEvent(new fourMegabyteBoundary.TestEvent('change'));
  await settle();
  assert.equal(fourMegabyteBoundary.uploads.length, 0);
  assert.equal(fourMegabyteBoundary.photoUrlInput.value, 'pending-profile-photo-upload');
  assert.equal(fourMegabyteBoundary.uploadError.style.display, 'none');

  const supportedWebp = createHarness();
  supportedWebp.input.files = [{ name: 'photo.webp', type: 'image/webp', size: 100 }];
  supportedWebp.input.dispatchEvent(new supportedWebp.TestEvent('change'));
  await settle();
  assert.equal(supportedWebp.uploads.length, 0);
  assert.equal(supportedWebp.photoUrlInput.value, 'pending-profile-photo-upload');
  assert.equal(supportedWebp.uploadError.style.display, 'none');

  const oversized = createHarness();
  oversized.input.files = [{
    name: 'photo.png',
    type: 'image/png',
    size: (4 * 1024 * 1024) + 1,
  }];
  oversized.input.dispatchEvent(new oversized.TestEvent('change'));
  await settle();
  assert.equal(oversized.uploads.length, 0);
  assert.equal(oversized.uploadError.style.display, 'block');
  assert.equal(oversized.uploadError.textContent, 'Image is too large. Max size is 4MB.');

  const unavailable = createHarness({ cryptoApi: {} });
  unavailable.input.value = '/fake/unavailable.jpg';
  unavailable.input.files = [firstFile];
  unavailable.input.dispatchEvent(new unavailable.TestEvent('change'));
  await settle();
  assert.equal(unavailable.uploads.length, 0);
  assert.equal(unavailable.wrap.style.display, 'block');
  assert.equal(unavailable.preview.style.display, 'block');
  assert.equal(unavailable.uploadError.style.display, 'block');
  assert.equal(
    unavailable.uploadError.textContent,
    'Image upload failed. Click here to try again.',
  );

  const pendingResponses = [];
  const overlapping = createHarness({
    uploadResponder(index) {
      return new Promise((resolve) => { pendingResponses[index] = resolve; });
    },
  });
  const select = async (name) => {
    overlapping.input.files = [{ name, type: 'image/jpeg', size: 100 }];
    overlapping.input.dispatchEvent(new overlapping.TestEvent('change'));
    await settle();
  };
  const response = (body) => new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  await select('first.jpg');
  overlapping.window.StartersBuildProfilePhotoUpload.markProfileSaved();
  const firstCommit = overlapping.window.StartersBuildProfilePhotoUpload.commitPending();
  await select('second.jpg');
  const secondCommit = overlapping.window.StartersBuildProfilePhotoUpload.commitPending();
  pendingResponses[0](response(JSON.stringify({
    starter_image: 'https://example.invalid/stale.jpg',
    starter_image_small: 'https://example.invalid/stale-small.jpg',
  })));
  await firstCommit;
  await settle();
  assert.equal(overlapping.uploadError.style.display, 'none');
  assert.equal(overlapping.wrap.style.display, 'none');
  pendingResponses[1](response(JSON.stringify({
    starter_image: 'https://example.invalid/current.jpg',
    starter_image_small: 'https://example.invalid/current-small.jpg',
  })));
  await secondCommit;
  await settle();
  assert.equal(
    overlapping.photoUrlInput.value,
    'https://example.invalid/current.jpg',
  );

  const editProfile = createHarness({
    pathname: '/starter-edit-profile',
    uploadResponder() {
      return response(JSON.stringify({
        starter_image: 'https://example.invalid/edit-photo.jpg',
        starter_image_small: 'https://example.invalid/edit-photo-small.jpg',
      }));
    },
  });
  editProfile.input.files = [{ name: 'edit.jpg', type: 'image/jpeg', size: 100 }];
  editProfile.input.dispatchEvent(new editProfile.TestEvent('change'));
  await settle();
  assert.equal(editProfile.uploads.length, 1);
  assert.equal(editProfile.photoUrlInput.value, 'https://example.invalid/edit-photo.jpg');

  const durableAvatar = createHarness({
    avatarResponder() {
      return {
        data: {
          profileImage: 'https://ms-application-assets.s3.amazonaws.com/clobbered-photo.jpg',
        },
      };
    },
    uploadResponder() {
      return response(JSON.stringify({
        starter_image: 'https://xano-vault.example/canonical-photo.jpg',
        starter_image_small: 'https://xano-vault.example/canonical-photo-small.jpg',
      }));
    },
  });
  durableAvatar.input.files = [{ name: 'durable-avatar.jpg', type: 'image/jpeg', size: 100 }];
  durableAvatar.input.dispatchEvent(new durableAvatar.TestEvent('change'));
  await settle();
  durableAvatar.window.StartersBuildProfilePhotoUpload.markProfileSaved();
  await durableAvatar.window.StartersBuildProfilePhotoUpload.commitPending();
  assert.equal(durableAvatar.uploads.length, 1);
  assert.equal(durableAvatar.profileImageUpdateCalls(), 0);
  assert.equal(durableAvatar.photoUrlInput.value, 'https://xano-vault.example/canonical-photo.jpg');
  assert.equal(durableAvatar.uploadError.style.display, 'none');
  for (const navbarImage of durableAvatar.navbarImages) {
    assert.equal(navbarImage.src, 'https://xano-vault.example/canonical-photo.jpg');
    assert.equal(navbarImage.srcset, 'https://xano-vault.example/canonical-photo.jpg');
    assert.notEqual(navbarImage.src, 'https://xano-vault.example/canonical-photo-small.jpg');
    assert.equal(String(navbarImage.src).includes('ms-application-assets'), false);
  }

  // `data-input-capture` is what the Build Profile draft controller enumerates, and it
  // rewrites the whole of `step_1` from that set on every save - including the Submit
  // click that triggers this gate. A returning Starter replacing an existing photo must
  // therefore stay inside the capture set, holding the stored URL, until the replacement
  // is actually committed.
  const returning = createHarness({
    storedPhotoUrl: 'https://example.invalid/stored-photo.jpg',
    uploadResponder(index) {
      if (index === 0) {
        return new Response(JSON.stringify({ message: 'synthetic upload failure' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return response(JSON.stringify({
        starter_image: 'https://example.invalid/replacement.jpg',
        starter_image_small: 'https://example.invalid/replacement-small.jpg',
      }));
    },
  });
  returning.input.files = [{ name: 'replacement.jpg', type: 'image/jpeg', size: 100 }];
  returning.input.dispatchEvent(new returning.TestEvent('change'));
  await settle();
  assert.equal(returning.uploads.length, 0);
  assert.equal(returning.photoUrlInput.value, 'https://example.invalid/stored-photo.jpg');
  assert.equal(returning.photoUrlInput.hasAttribute('data-input-capture'), true);

  returning.window.StartersBuildProfilePhotoUpload.markProfileSaved();
  await assert.rejects(
    returning.window.StartersBuildProfilePhotoUpload.commitPending(),
    /synthetic upload failure/,
  );
  assert.equal(returning.uploads.length, 1);
  assert.equal(returning.photoUrlInput.value, 'https://example.invalid/stored-photo.jpg');
  assert.equal(returning.photoUrlInput.hasAttribute('data-input-capture'), true);

  returning.wrap.listeners.get('click')({ target: returning.uploadError });
  await settle();
  assert.equal(returning.uploads.length, 2);
  assert.equal(returning.uploads[0].sourceMutationId, returning.uploads[1].sourceMutationId);
  assert.equal(returning.photoUrlInput.value, 'https://example.invalid/replacement.jpg');
  assert.equal(returning.photoUrlInput.hasAttribute('data-input-capture'), true);
}

run()
  .then(() => console.log(
    'Browser interaction trace: Build selection stayed local until the profile save gate; the first upload failure kept one opaque intent for retry; replacements and drops created new intents only when committed; stale overlapping uploads could not overwrite the current photo; a returning Starter kept the stored photo URL in draft capture across a failed replacement.',
  ))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
