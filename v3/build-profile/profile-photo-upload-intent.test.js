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
    contains() { return false; },
    querySelector() { return null; },
  };
}

function createHarness({ cryptoApi } = {}) {
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
  const elements = new Map([
    ['#profile-photo-wrap', wrap],
    ['#profile-photo', input],
    ['#profile-photo-preview', preview],
    ['#profile-photo-preview-img', previewImg],
    ['#profile-photo-remove', removeBtn],
    ['#profile-photo-url', photoUrlInput],
  ]);
  let domReady;
  let resizeCount = 0;
  const uploads = [];
  const uploadStatuses = [500, 500, 200, 200, 200];
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
      const status = uploadStatuses.shift();
      return new Response(JSON.stringify(status === 200 ? {
        starter_image: 'https://example.invalid/photo.jpg',
        starter_image_small: 'https://example.invalid/photo-small.jpg',
      } : { message: 'temporary failure' }), {
        status,
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
      pathname: '/build-profile/full-profile',
      origin: 'https://thestarters.com',
    },
    localStorage: { setItem() {}, removeItem() {} },
    fetch: originalFetch,
    $memberstackDom: {
      async getMemberCookie() { return 'memberstack-token'; },
      async updateMemberProfileImage() { return { data: { profileImage: 'https://example.invalid/small.jpg' } }; },
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
    console: { log() {}, info() {}, error() {} },
    MEMBER: { id: 'member-id-not-sent' },
    activeProfile: { data: { step_1: { 'profile-photo-url': '' } } },
    waitForMember: (callback) => callback(),
    waitProfileData: (callback) => callback(),
    setLoader() {},
    qsa: () => [],
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
    uploadError,
    uploads,
    wrap,
    resizeCount: () => resizeCount,
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
    uploadError,
    uploads,
    wrap,
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
  assert.equal(uploads.length, 1);
  assert.equal(wrap.style.display, 'block');
  assert.equal(uploadError.style.display, 'block');
  assert.equal(uploadError.textContent, 'Image upload failed. Click here to try again.');

  wrap.listeners.get('click')({ target: uploadError });
  await settle();
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].sourceMutationId, uploads[1].sourceMutationId);
  assert.equal(uploads[0].memberId, null);
  assert.equal(uploads[1].memberId, null);
  assert.equal(resizeCount(), 1);

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
  assert.equal(uploads.length, 3);
  assert.notEqual(uploads[2].sourceMutationId, uploads[1].sourceMutationId);
  assert.equal(resizeCount(), 2);

  const secondFile = { name: 'new-photo.jpg', type: 'image/jpeg', size: 100 };
  input.dispatchEvent(new TestEvent('click'));
  input.value = '/fake/new-photo.jpg';
  input.files = [secondFile];
  input.dispatchEvent(new TestEvent('change'));
  await settle();
  assert.equal(uploads.length, 4);
  assert.notEqual(uploads[3].sourceMutationId, uploads[2].sourceMutationId);

  const droppedFile = { name: 'drop.jpg', type: 'image/jpeg', size: 100 };
  label.listeners.get('drop')({
    preventDefault() {},
    dataTransfer: { files: [droppedFile] },
  });
  await settle();
  assert.equal(uploads.length, 5);
  assert.notEqual(uploads[4].sourceMutationId, uploads[3].sourceMutationId);
  assert.equal(uploads.every((upload) => upload.image && upload.memberId === null), true);

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
}

run()
  .then(() => console.log('profile-photo upload intent tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
