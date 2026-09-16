const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeElement {
  constructor() {
    this.value = '';
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
    this.textContent = '';
    this.customValidity = '';
    this.reported = false;
    this.focused = false;
    this.classList = {
      add() {},
      remove() {},
      contains: (name) => this.classes?.includes(name) || false,
    };
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  async dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      await listener.call(this, event);
    }
  }

  closest() {
    return this.form || null;
  }

  setCustomValidity(message) {
    this.customValidity = message;
  }

  reportValidity() {
    this.reported = true;
  }

  focus() {
    this.focused = true;
  }

  insertAdjacentElement() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function submitEvent() {
  return {
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}

async function boot() {
  const documentListeners = new Map();
  const form = new FakeElement();
  const brandSearch = new FakeElement();
  const brandContract = new FakeElement();
  const brandName = new FakeElement();
  const brandNameContract = new FakeElement();
  const brandList = new FakeElement();
  brandSearch.form = form;
  brandContract.form = form;

  const selectors = new Map([
    ['input#brand-search', brandSearch],
    ['input#brand-contract', brandContract],
    ['input#brand-name', brandName],
    ['input#brand-name-contract', brandNameContract],
    ['#brand-list', brandList],
  ]);

  const document = {
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    createElement() { return new FakeElement(); },
    getElementById() { return null; },
    querySelector(selector) { return selectors.get(selector) || null; },
    querySelectorAll() { return []; },
  };

  const context = {
    console: { error() {}, warn() {}, log() {} },
    document,
    fetch: async () => ({ ok: true, json: async () => ({ freelancer: {}, brands: [] }) }),
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setInterval() { throw new Error('unexpected interval'); },
    clearInterval() {},
    window: {
      location: { href: '', replace() {} },
      scrollTo() {},
      $memberstackDom: {
        getCurrentMember: async () => ({
          data: { id: 'mem_live_fixture', customFields: { 'completed-starter-profile': true } },
        }),
      },
    },
  };

  const source = fs.readFileSync(path.join(__dirname, 'freelancer-start-project.js'), 'utf8');
  vm.runInNewContext(source, context);
  for (const listener of documentListeners.get('DOMContentLoaded') || []) listener();
  await Promise.resolve();
  await Promise.resolve();

  return { documentListeners, form, brandSearch, brandContract, brandName, brandNameContract };
}

test('requires a selected Brand and clears stale hidden identity', async () => {
  const ui = await boot();

  const blankSubmit = submitEvent();
  await ui.form.dispatch('submit', blankSubmit);
  assert.equal(blankSubmit.prevented, true);
  assert.equal(blankSubmit.stopped, true);
  assert.match(ui.brandSearch.customValidity, /Select a Brand/);
  assert.equal(ui.brandSearch.reported, true);
  assert.equal(ui.brandSearch.focused, true);

  ui.brandContract.value = 'brand-cms-id';
  ui.brandName.value = 'Selected Brand';
  ui.brandSearch.value = 'Selected Brand';
  const validSubmit = submitEvent();
  await ui.form.dispatch('submit', validSubmit);
  assert.equal(validSubmit.prevented, false);
  assert.equal(ui.brandSearch.customValidity, '');

  ui.brandNameContract.value = 'Selected Brand - brand-cms-id';
  ui.brandSearch.value = 'Edited text';
  await ui.brandSearch.dispatch('input');
  assert.equal(ui.brandContract.value, '');
  assert.equal(ui.brandNameContract.value, '');

  const option = new FakeElement();
  option.classes = ['brand-select__option'];
  option.textContent = 'Selected Brand';
  option.dataset.webflowItemId = 'brand-cms-id';
  for (const listener of ui.documentListeners.get('mousedown') || []) {
    await listener({ target: option });
  }
  assert.equal(ui.brandContract.value, 'brand-cms-id');

  const selectedSubmit = submitEvent();
  await ui.form.dispatch('submit', selectedSubmit);
  assert.equal(selectedSubmit.prevented, false);
});
