const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('./profile-photo.js'), 'utf8');

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
    dispatchEvent() {},
    appendChild() {},
    contains() { return false; },
    querySelector() { return null; },
  };
}

function createHarness() {
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
    createElement() { return element(); },
  };
  const window = {
    crypto: { randomUUID: () => uuids[uuidIndex++] },
    $memberstackDom: {
      async updateMemberProfileImage() { return { data: { profileImage: 'https://example.invalid/small.jpg' } }; },
    },
  };
  const fetch = async (url, options = {}) => {
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
  const context = vm.createContext({
    window,
    document,
    console: { log() {}, error() {} },
    MEMBER: { id: 'member-id-not-sent' },
    activeProfile: { data: { step_1: { 'profile-photo-url': '' } } },
    waitForMember: (callback) => callback(),
    waitProfileData: (callback) => callback(),
    setLoader() {},
    qsa: () => [],
    fetch,
    FormData: TestFormData,
    File: TestFile,
    Event: class {},
    DataTransfer: class {
      constructor() {
        this.files = [];
        this.items = { add: (file) => { this.files.push(file); } };
      }
    },
    Uint8Array,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    URL: { createObjectURL: () => 'blob:preview' },
    Response,
    Blob,
    Promise,
    setTimeout: (callback) => callback(),
    requestAnimationFrame: (callback) => callback(),
  });
  vm.runInContext(source, context);
  domReady();
  return { input, label, uploadError, uploads, wrap };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  const { input, label, uploadError, uploads, wrap } = createHarness();
  const firstFile = {
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 100,
    lastModified: 123,
  };
  input.files = [firstFile];
  input.listeners.get('change')();
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

  const replacementWithSameMetadata = {
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 100,
    lastModified: 123,
  };
  input.files = [replacementWithSameMetadata];
  input.listeners.get('change')();
  await settle();
  assert.equal(uploads.length, 3);
  assert.notEqual(uploads[2].sourceMutationId, uploads[1].sourceMutationId);
  assert.equal(uploads[2].image, replacementWithSameMetadata);

  const secondFile = { name: 'new-photo.jpg', type: 'image/jpeg', size: 100 };
  input.files = [secondFile];
  input.listeners.get('change')();
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
}

run()
  .then(() => console.log('profile-photo upload intent tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
