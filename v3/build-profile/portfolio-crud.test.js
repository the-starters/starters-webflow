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
    classList: { add() {}, remove() {} },
    attributes: {},
    value: '',
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    async dispatchEvent(event) {
      await Promise.all((listeners.get(event.type) || []).map((listener) => listener(event)));
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    cloneNode() { return element(); },
    ...properties,
  };
}

function createFixture({ dropdown = false, staleAfterCreate = false } = {}) {
  const template = element();
  const portfolios = [];
  const cards = [];
  const scrollCalls = [];
  const grid = element({
    querySelector(selector) { return selector === '.portfolio_card' ? template : null; },
    querySelectorAll(selector) {
      return selector === '.portfolio_card:not(:first-child)' ? cards : [];
    },
    appendChild(card) { cards.push(card); },
    scrollIntoView(options) { scrollCalls.push({ ...options, visibleCards: cards.length }); },
  });
  const createSubmitLabel = element({ textContent: 'Save Work Highlight' });
  const createSubmit = element({
    querySelector(selector) { return selector === 'div:first-child' ? createSubmitLabel : null; },
  });
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
  let heldCreate = null;
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
        if (heldCreate) {
          heldCreate.started();
          await heldCreate.wait;
          heldCreate = null;
        }
        if (failNextCreate) {
          failNextCreate = false;
          return { ok: false, json: async () => ({ message: 'Create failed' }) };
        }
        portfolios.push({ id: created, title: 'A new highlight' });
        return { ok: true, json: async () => ({ id: created }) };
      }
      if (url.includes('/upload-image')) {
        return { ok: true, json: async () => ({ path: '/cover.png' }) };
      }
      return { ok: true, json: async () => url.includes('/Get_my_portfolios') ? (staleAfterCreate ? [] : portfolios) : {} };
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
    holdNextCreate() {
      let started;
      let release;
      const whenStarted = new Promise((resolve) => { started = resolve; });
      const wait = new Promise((resolve) => { release = resolve; });
      heldCreate = { started, wait };
      return { whenStarted, release };
    },
    get created() { return created; },
    createSubmit,
    createSubmitLabel,
    cards,
    scrollCalls,
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

test('Build Profile shows Saving while a highlight is being created', async () => {
  const fixture = createFixture();
  await fixture.boot();
  await fixture.selectImage();
  const pendingCreate = fixture.holdNextCreate();

  const save = fixture.save();
  await pendingCreate.whenStarted;

  assert.equal(fixture.createSubmitLabel.textContent, 'Saving...');
  assert.equal(fixture.createSubmit.style.pointerEvents, 'none');
  assert.equal(fixture.createSubmit.style.opacity, '0.5');
  assert.equal(fixture.createSubmit.getAttribute('aria-disabled'), 'true');
  pendingCreate.release();
  await save;

  assert.equal(fixture.createSubmitLabel.textContent, 'Save Work Highlight');
  assert.equal(fixture.createSubmit.style.pointerEvents, 'none');
});

test('Build Profile can retry after a failed creation', async () => {
  const fixture = createFixture({ dropdown: true });
  await fixture.boot();
  await fixture.selectImage();
  fixture.failNextCreate();

  await fixture.save();
  assert.equal(fixture.createSubmitLabel.textContent, 'Save Work Highlight');
  assert.equal(fixture.createSubmit.style.pointerEvents, 'auto');
  assert.equal(fixture.createSubmit.getAttribute('aria-disabled'), 'false');
  await fixture.save();

  assert.equal(fixture.created, 2);
  assert.equal(fixture.profileDropdown.style.pointerEvents, 'auto');
  assert.equal(fixture.titleInput.value, '');
});

test('Build Profile scrolls to the highlight boxes after the new box is visible', async () => {
  const fixture = createFixture();
  await fixture.boot();
  await fixture.selectImage();

  await fixture.save();

  assert.equal(fixture.cards.length, 1);
  assert.deepEqual(fixture.scrollCalls, [
    { behavior: 'smooth', block: 'start', visibleCards: 1 },
  ]);
});

test('Build Profile stays at the highlight form when saving fails', async () => {
  const fixture = createFixture();
  await fixture.boot();
  await fixture.selectImage();
  fixture.failNextCreate();

  await fixture.save();

  assert.equal(fixture.cards.length, 0);
  assert.deepEqual(fixture.scrollCalls, []);
});

test('Build Profile does not scroll before the new highlight box appears', async () => {
  const fixture = createFixture({ staleAfterCreate: true });
  await fixture.boot();
  await fixture.selectImage();

  await fixture.save();

  assert.equal(fixture.created, 1);
  assert.equal(fixture.cards.length, 0);
  assert.deepEqual(fixture.scrollCalls, []);
});
