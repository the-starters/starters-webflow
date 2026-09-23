const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'portfolio-crud.js'), 'utf8');

function element(properties = {}) {
  const listeners = new Map();
  return {
    style: {},
    value: '',
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    async dispatchEvent(event) {
      await Promise.all((listeners.get(event.type) || []).map((listener) => listener(event)));
    },
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...properties,
  };
}

function createFixture({ dropdown = false } = {}) {
  const template = element();
  const grid = element({
    querySelector(selector) { return selector === '.portfolio_card' ? template : null; },
  });
  const createSubmit = element();
  const titleInput = element({ value: 'A new highlight' });
  const imagesInput = element({ files: [{ name: 'cover.png', size: 1 }] });
  const profileDropdown = dropdown ? element() : null;
  const notificationText = element();
  const notificationTrigger = element();
  const notificationModal = element({
    querySelector(selector) {
      if (selector === '[notification-text]') return notificationText;
      return null;
    },
  });
  const nodes = new Map([
    ['[data-highlights]', grid],
    ['#add-highlight', createSubmit],
    ['#portfolio-title', titleInput],
    ['#portfolio-images', imagesInput],
    ['#profile-dropdown', profileDropdown],
    ['[data-modal-target="portfolio-notification"]', notificationModal],
    ['[data-modal-trigger="portfolio-notification"]', notificationTrigger],
  ]);
  const document = element({
    querySelector(selector) { return nodes.get(selector) || null; },
  });
  const window = element({ location: { pathname: '/build-profile/full-profile' } });
  const errors = [];
  let boot;
  let created = 0;
  let failNextCreate = false;
  const context = vm.createContext({
    document,
    window,
    MEMBER: { id: 'member-1' },
    console: { ...console, error(error) { errors.push(error); } },
    waitForMember(callback) { boot = callback(); },
    qs(selector, root) {
      return root && root.querySelector ? root.querySelector(selector) : document.querySelector(selector);
    },
    qsa(selector, root) {
      return root && root.querySelectorAll ? root.querySelectorAll(selector) : document.querySelectorAll(selector);
    },
    async fetch(url) {
      if (url.includes('/Create_portfolio')) {
        created += 1;
        if (failNextCreate) {
          failNextCreate = false;
          return { ok: false, json: async () => ({ message: 'Create failed' }) };
        }
        return { ok: true, json: async () => ({ id: created }) };
      }
      if (url.includes('/upload-image')) {
        return { ok: true, json: async () => ({ path: '/cover.png' }) };
      }
      return { ok: true, json: async () => url.includes('/Get_my_portfolios') ? [] : {} };
    },
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    FormData: class FormData { append() {} },
    setLoader() {},
  });
  return {
    async boot() {
      new vm.Script(source, { filename: 'portfolio-crud.js' }).runInContext(context);
      await document.dispatchEvent({ type: 'DOMContentLoaded' });
      await boot;
    },
    async selectImage() { await imagesInput.dispatchEvent({ type: 'change' }); },
    async save() { await createSubmit.dispatchEvent({ type: 'click', preventDefault() {} }); },
    async doubleClick() {
      await Promise.all([
        createSubmit.dispatchEvent({ type: 'click', preventDefault() {} }),
        createSubmit.dispatchEvent({ type: 'click', preventDefault() {} }),
      ]);
    },
    failNextCreate() { failNextCreate = true; },
    get created() { return created; },
    titleInput,
    profileDropdown,
    errors,
  };
}

test('Build Profile saves a highlight when the accordion is absent', async () => {
  const fixture = createFixture();
  await fixture.boot();
  await fixture.selectImage();

  await fixture.save();

  assert.equal(fixture.created, 1);
  assert.equal(fixture.titleInput.value, '');
  assert.deepEqual(fixture.errors, []);
});

test('Build Profile ignores a second save click while creation is in flight', async () => {
  const fixture = createFixture();
  await fixture.boot();
  await fixture.selectImage();

  await fixture.doubleClick();

  assert.equal(fixture.created, 1);
  assert.deepEqual(fixture.errors, []);
});

test('Build Profile can retry after a failed creation', async () => {
  const fixture = createFixture({ dropdown: true });
  await fixture.boot();
  await fixture.selectImage();
  fixture.failNextCreate();

  await fixture.save();
  await fixture.save();

  assert.equal(fixture.created, 2);
  assert.equal(fixture.profileDropdown.style.pointerEvents, 'auto');
  assert.equal(fixture.titleInput.value, '');
});
