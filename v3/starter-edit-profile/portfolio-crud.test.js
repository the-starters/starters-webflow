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
    classList: { add() {}, remove() {} },
    setAttribute() {},
    cloneNode() { return element(); },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    async dispatchEvent(event) {
      await Promise.all((listeners.get(event.type) || []).map((listener) => listener(event)));
    },
    ...properties,
  };
}

function createFixture() {
  const template = element();
  const cards = [];
  const grid = element({
    appendChild(card) { cards.push(card); },
    querySelector(selector) { return selector === '.portfolio_card' ? template : null; },
    querySelectorAll() { return []; },
  });
  const addHighlight = element();
  const title = element({ value: 'A new highlight' });
  const images = element({ files: [{ name: 'cover.png', size: 1 }] });
  const videos = element({ files: [] });
  const notificationText = element();
  const notificationClose = element();
  const notifications = [];
  const notificationModal = element({
    querySelector(selector) {
      if (selector === '[notification-text]') return notificationText;
      if (selector === '[data-modal-close]') return notificationClose;
      return null;
    },
  });
  const notificationTrigger = element();
  notificationTrigger.addEventListener('click', () => notifications.push(notificationText.textContent));
  const nodes = new Map([
    ['[data-highlights]', grid],
    ['#add-highlight', addHighlight],
    ['#portfolio-title', title],
    ['#portfolio-images', images],
    ['#portfolio-videos', videos],
    ['[data-modal-target="portfolio-notification"]', notificationModal],
    ['[data-modal-trigger="portfolio-notification"]', notificationTrigger],
  ]);
  const document = element({
    querySelector(selector) { return nodes.get(selector) || null; },
    querySelectorAll() { return []; },
  });
  const window = element();
  const errors = [];
  let boot;
  let reads = 0;
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
    async fetch() {
      reads += 1;
      return { ok: true, json: async () => [] };
    },
    Event: class Event { constructor(type) { this.type = type; } },
    URL: { createObjectURL() { return 'blob:cover'; } },
    setLoader() {},
  });
  return {
    async boot() {
      new vm.Script(source, { filename: 'portfolio-crud.js' }).runInContext(context);
      await document.dispatchEvent({ type: 'DOMContentLoaded' });
      await boot;
    },
    async selectImage() { await images.dispatchEvent({ type: 'change' }); },
    async saveHighlight() {
      await addHighlight.dispatchEvent({ type: 'click', preventDefault() {} });
    },
    async doubleClickSave() {
      await Promise.all([
        addHighlight.dispatchEvent({ type: 'click', preventDefault() {} }),
        addHighlight.dispatchEvent({ type: 'click', preventDefault() {} }),
      ]);
    },
    cards,
    title,
    videos,
    notifications,
    errors,
    get reads() { return reads; },
  };
}

test('legacy highlight save handles the removed accordion and reaches form validation', async () => {
  const fixture = createFixture();
  await fixture.boot();
  const readsBeforeSave = fixture.reads;

  await fixture.saveHighlight();

  assert.equal(fixture.reads, readsBeforeSave + 1);
  assert.deepEqual(fixture.errors.map((error) => error.message), ['Please upload at least one image']);
});


test('legacy highlight queues a draft without an accordion', async () => {
  const fixture = createFixture();
  await fixture.boot();
  await fixture.selectImage();
  const readsBeforeSave = fixture.reads;

  await fixture.saveHighlight();

  assert.equal(fixture.reads, readsBeforeSave + 2);
  assert.equal(fixture.cards.length, 1);
  assert.equal(fixture.title.value, '');
  assert.deepEqual(fixture.errors, []);
});


test('legacy highlight keeps the published 50 MB video limit', async () => {
  const fixture = createFixture();
  await fixture.boot();

  fixture.videos.files = [{ name: 'allowed.mov', size: 45 * 1024 * 1024 }];
  await fixture.videos.dispatchEvent({ type: 'change' });
  assert.deepEqual(fixture.notifications, []);

  fixture.videos.files = [{ name: 'too-large.mov', size: 55 * 1024 * 1024 }];
  await fixture.videos.dispatchEvent({ type: 'change' });
  assert.deepEqual(fixture.notifications, ['Video exceeds 50MB upload size limit']);
});


test('legacy highlight ignores a second click while the first is in flight', async () => {
  const fixture = createFixture();
  await fixture.boot();
  await fixture.selectImage();
  const readsBeforeSave = fixture.reads;

  await fixture.doubleClickSave();

  assert.equal(fixture.reads, readsBeforeSave + 2);
  assert.equal(fixture.cards.length, 1);
  assert.equal(fixture.title.value, '');
  assert.deepEqual(fixture.errors, []);
});
