const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'portfolio-crud.js'), 'utf8');

function createEventTarget(properties = {}) {
  const listeners = new Map();
  return Object.assign(properties, {
    addEventListener(type, listener) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
    async dispatchEvent(event) {
      event.target ||= this;
      const results = [];
      for (const listener of listeners.get(event.type) || []) results.push(listener(event));
      await Promise.all(results);
      return true;
    },
  });
}

function createClassList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
  };
}

function createElement(properties = {}) {
  const element = createEventTarget({
    children: [],
    classList: createClassList(),
    style: {},
    textContent: '',
    value: '',
    ...properties,
  });
  element.appendChild = (child) => {
    element.children.push(child);
    child.parentElement = element;
    return child;
  };
  element.remove = () => {};
  element.reset = () => { element.resetCount = (element.resetCount || 0) + 1; };
  element.setAttribute = (name, value) => { element[name] = value; };
  element.cloneNode = () => createElement();
  element.click = () => element.dispatchEvent({ type: 'click' });
  Object.defineProperty(element, 'innerHTML', {
    get() { return element._innerHTML || ''; },
    set(value) {
      element._innerHTML = value;
      if (value === '') element.children = [];
    },
  });
  return element;
}

function loadLifecycle() {
  const context = vm.createContext({
    console,
    document: { addEventListener() {} },
  });
  new vm.Script(source, { filename: 'portfolio-crud.js' }).runInContext(context);
  return context;
}

function createControllerFixture() {
  const portfolio = { id: 42, title: 'Selected highlight', description: 'Existing work' };
  const image = { id: 101, image_url: 'https://example.com/image.jpg', is_cover: true };
  const video = { id: 202, video_url: 'https://example.com/video.mp4' };
  const grid = createElement();
  const template = createElement();
  const editModal = createElement({ open: false, visible: false });
  const editModalTrigger = createElement();
  const editModalClose = createElement();
  const editForm = createElement();
  const editSubmit = createElement();
  const editTitle = createElement();
  const editDescription = createElement();
  const editImages = createElement();
  const editVideos = createElement();
  const removeModal = createElement({ visible: false });
  const removeModalTrigger = createElement();
  const removeModalClose = createElement();
  const notifyModal = createElement({ visible: false });
  const notifyModalTrigger = createElement();
  const notifyModalClose = createElement();
  const notificationText = createElement();
  const notifications = [];
  const timers = new Map();
  let currentTime = 0;
  let nextTimerId = 1;
  const authoredElements = new Map([
    ['[data-highlights]', grid],
    ['[data-modal-target="portfolio-edit"]', editModal],
    ['[data-modal-trigger="portfolio-edit"]', editModalTrigger],
    ['#wf-form-Portfolio-update', editForm],
    ['[free-edit-submit]', editSubmit],
    ['#portfolio-title-edit', editTitle],
    ['#portfolio-description-edit', editDescription],
    ['#portfolio-images-edit-preview', editImages],
    ['#portfolio-videos-edit-preview', editVideos],
    ['[data-modal-target="portfolio-remove"]', removeModal],
    ['[data-modal-trigger="portfolio-remove"]', removeModalTrigger],
    ['[data-modal-target="portfolio-notification"]', notifyModal],
    ['[data-modal-trigger="portfolio-notification"]', notifyModalTrigger],
  ]);
  const document = createEventTarget({
    createElement: () => createElement(),
    querySelector: (selector) => authoredElements.get(selector) || null,
    querySelectorAll: () => [],
  });
  const window = createEventTarget({ document });
  const errors = [];
  let memberBoot;

  editModal.querySelector = (selector) => selector === '[data-modal-close]' ? editModalClose : null;
  removeModal.querySelector = (selector) => selector === '[data-modal-close]' ? removeModalClose : null;
  notifyModal.querySelector = (selector) => {
    if (selector === '[data-modal-close]') return notifyModalClose;
    if (selector === '[notification-text]') return notificationText;
    return null;
  };
  grid.querySelector = (selector) => selector === '.portfolio_card' ? template : null;
  editForm.reset = () => {
    editForm.resetCount = (editForm.resetCount || 0) + 1;
    editTitle.value = '';
    editDescription.value = '';
  };
  editModalTrigger.addEventListener('click', () => {
    editModal.open = true;
    editModal.visible = true;
  });
  editModalClose.addEventListener('click', () => {
    editModal.open = false;
    editModal.visible = false;
  });
  removeModalTrigger.addEventListener('click', () => { removeModal.visible = true; });
  removeModalClose.addEventListener('click', () => { removeModal.visible = false; });
  notifyModalTrigger.addEventListener('click', () => {
    notifyModal.visible = true;
    notifications.push(notificationText.textContent);
  });
  notifyModalClose.addEventListener('click', () => { notifyModal.visible = false; });

  const responses = {
    Get_my_portfolios: [portfolio],
    Get_portfolio_images: [image],
    Get_portfolio_videos: [video],
  };
  const context = vm.createContext({
    console: { ...console, error: (error) => errors.push(error) },
    document,
    window,
    MEMBER: { id: 'member-1' },
    waitForMember(callback) {
      memberBoot = callback();
      return memberBoot;
    },
    qs(selector, root) {
      if (root && typeof root.querySelector === 'function') return root.querySelector(selector);
      return document.querySelector(selector);
    },
    qsa(selector, root) {
      if (root && typeof root.querySelectorAll === 'function') return root.querySelectorAll(selector);
      return document.querySelectorAll(selector);
    },
    fetch: async (url) => {
      const key = Object.keys(responses).find((name) => String(url).includes(name));
      return { ok: true, json: async () => key ? responses[key] : [] };
    },
    Event: class Event {
      constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    },
    FormData,
    URL,
    setTimeout(callback, delay) {
      const timerId = nextTimerId++;
      timers.set(timerId, { callback, runAt: currentTime + delay });
      return timerId;
    },
    clearTimeout(timerId) { timers.delete(timerId); },
    setLoader() {},
  });
  context.window.fetch = context.fetch;

  const card = createElement();
  const idBlock = createElement({ textContent: String(portfolio.id) });
  const editButton = createElement();
  editButton.closest = (selector) => {
    if (selector === '[show-portfolio]') return editButton;
    if (selector === '.portfolio_card') return card;
    return null;
  };
  card.querySelector = (selector) => selector === '.portfolio_card-id' ? idBlock : null;

  return {
    async boot() {
      new vm.Script(source, { filename: 'portfolio-crud.js' }).runInContext(context);
      await document.dispatchEvent({ type: 'DOMContentLoaded' });
      await memberBoot;
    },
    advanceTime(milliseconds) {
      currentTime += milliseconds;
      const ready = Array.from(timers.entries())
        .filter(([, timer]) => timer.runAt <= currentTime)
        .sort((left, right) => left[1].runAt - right[1].runAt);
      for (const [timerId, timer] of ready) {
        if (!timers.delete(timerId)) continue;
        timer.callback();
      }
    },
    document,
    window,
    grid,
    editButton,
    editModal,
    removeModal,
    removeModalTrigger,
    notifyModal,
    notifyModalTrigger,
    editSubmit,
    editTitle,
    editImages,
    editVideos,
    notifications,
    errors,
  };
}

test('portfolio lifecycle closes only a stale restored modal', async () => {
  const context = loadLifecycle();
  const eventTarget = createEventTarget();
  let hasActivePortfolio = true;
  let isModalOpen = true;
  let closeCount = 0;

  context.createStarterEditPortfolioModalLifecycle({
    eventTarget,
    hasActivePortfolio: () => hasActivePortfolio,
    isModalOpen: () => isModalOpen,
    closeModal: () => { closeCount += 1; },
  });

  await eventTarget.dispatchEvent({ type: 'pageshow' });
  assert.equal(closeCount, 0);

  hasActivePortfolio = false;
  isModalOpen = false;
  await eventTarget.dispatchEvent({ type: 'pageshow' });
  assert.equal(closeCount, 0);

  isModalOpen = true;
  await eventTarget.dispatchEvent({ type: 'pageshow' });
  assert.equal(closeCount, 1);
});

test('closed-page pageshow cannot reset a quickly opened highlight', async () => {
  const fixture = createControllerFixture();
  await fixture.boot();

  assert.equal(fixture.editModal.open, false);
  await fixture.window.dispatchEvent({ type: 'pageshow' });
  await fixture.grid.dispatchEvent({ type: 'click', target: fixture.editButton });
  fixture.advanceTime(301);

  assert.equal(fixture.editModal.visible, true);
  assert.equal(fixture.editTitle.value, 'Selected highlight');
  assert.equal(fixture.editImages.children.length, 1);
  assert.equal(fixture.editImages.children[0].children[0].src, 'https://example.com/image.jpg?tpl=large');
  assert.equal(fixture.editVideos.children.length, 1);
  assert.equal(fixture.editVideos.children[0].children[0].src, 'https://example.com/video.mp4');
});

test('portfolio cover normalization keeps exactly the first stored cover', () => {
  const context = loadLifecycle();
  const original = [
    { id: 1, is_cover: true },
    { id: 2, is_cover: true },
    { id: 3, is_cover: false },
  ];

  const normalized = context.normalizePortfolioCoverImages(original);

  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.map(({ id, is_cover }) => ({ id, is_cover })))),
    [
      { id: 1, is_cover: true },
      { id: 2, is_cover: false },
      { id: 3, is_cover: false },
    ],
  );
  assert.equal(original[1].is_cover, true);
});

test('stored cover selection is sent as the authoritative image id', () => {
  const context = loadLifecycle();

  assert.equal(context.getStoredPortfolioCoverId([
    { id: 1, is_cover: false },
    { id: 2, is_cover: true },
  ]), 2);
  assert.equal(context.getStoredPortfolioCoverId([
    { id: 'new-1', is_cover: true, is_new: true },
  ]), null);
});

test('document Escape preserves the active highlight and its media', async () => {
  const fixture = createControllerFixture();
  await fixture.boot();

  await fixture.grid.dispatchEvent({
    type: 'click',
    target: fixture.editButton,
  });

  assert.equal(fixture.editModal.visible, true);
  assert.equal(fixture.editTitle.value, 'Selected highlight');
  assert.equal(fixture.editImages.children.length, 1);
  assert.equal(fixture.editImages.children[0].children[0].src, 'https://example.com/image.jpg?tpl=large');
  assert.equal(fixture.editVideos.children.length, 1);
  assert.equal(fixture.editVideos.children[0].children[0].src, 'https://example.com/video.mp4');

  await fixture.removeModalTrigger.dispatchEvent({ type: 'click' });
  await fixture.notifyModalTrigger.dispatchEvent({ type: 'click' });
  assert.equal(fixture.removeModal.visible, true);
  assert.equal(fixture.notifyModal.visible, true);

  await fixture.document.dispatchEvent({ type: 'keydown', key: 'Escape' });

  assert.equal(fixture.removeModal.visible, false);
  assert.equal(fixture.notifyModal.visible, false);
  assert.equal(fixture.editModal.visible, true);
  assert.equal(fixture.editTitle.value, 'Selected highlight');
  assert.equal(fixture.editImages.children.length, 1);
  assert.equal(fixture.editImages.children[0].children[0].src, 'https://example.com/image.jpg?tpl=large');
  assert.equal(fixture.editVideos.children.length, 1);
  assert.equal(fixture.editVideos.children[0].children[0].src, 'https://example.com/video.mp4');

  await fixture.editSubmit.dispatchEvent({
    type: 'click',
    preventDefault() {},
  });

  assert.equal(fixture.notifications.includes('Portfolio is not selected'), false);
  assert.equal(fixture.errors.some((error) => error && error.message === 'Portfolio is not selected'), false);
});
