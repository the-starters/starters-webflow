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
    this.reported = !this.disabled;
  }

  focus() {
    this.focused = !this.disabled;
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

async function boot({ artifact = 'freelancer-start-project.js', memberState = 'resolved' } = {}) {
  const documentListeners = new Map();
  const form = new FakeElement();
  const brandSearch = new FakeElement();
  const brandContract = new FakeElement();
  const brandName = new FakeElement();
  const brandNameContract = new FakeElement();
  const brandList = new FakeElement();
  const editButton = new FakeElement();
  let editing = false;
  editButton.click = () => {
    editing = true;
    brandSearch.disabled = false;
  };
  brandSearch.form = form;
  brandContract.form = form;

  const selectors = new Map([
    ['input#brand-search', brandSearch],
    ['input#brand-contract', brandContract],
    ['input#brand-name', brandName],
    ['input#brand-name-contract', brandNameContract],
    ['#brand-list', brandList],
    ['[dx-button="edit"]', editButton],
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
        getCurrentMember: () => memberState === 'pending' ? new Promise(() => {}) : Promise.resolve({
          data: { id: 'mem_live_fixture', customFields: { 'completed-starter-profile': true } },
        }),
      },
    },
  };

  const artifactSource = fs.readFileSync(path.join(__dirname, artifact), 'utf8');
  const source = artifact.endsWith('.html') ? artifactSource.match(/<script>([\s\S]*?)<\/script>/)[1] : artifactSource;
  vm.runInNewContext(source, context);
  for (const listener of documentListeners.get('DOMContentLoaded') || []) listener();
  await Promise.resolve();
  await Promise.resolve();

  return { documentListeners, form, brandSearch, brandContract, brandName, brandNameContract, isEditing: () => editing };
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

for (const artifact of ['freelancer-start-project.js', 'freelancer-start-project-footer.html']) {
  for (const memberState of ['pending', 'resolved']) {
    test(`${artifact}: guards Review and submit with Memberstack ${memberState}`, async () => {
      const ui = await boot({ artifact, memberState });
      ui.brandSearch.value = 'Unselected Brand';
      const review = submitEvent();
      review.target = { closest: () => ({}) };
      for (const listener of ui.documentListeners.get('click') || []) await listener(review);
      assert.equal(review.prevented, true);
      assert.equal(review.stopped, true);
      assert.equal(ui.brandSearch.customValidity, 'Select a Brand from the list before starting the project.');

      ui.brandSearch.disabled = true;
      const submit = submitEvent();
      await ui.form.dispatch('submit', submit);
      assert.equal(submit.prevented, true);
      assert.equal(ui.isEditing(), true);
      assert.equal(ui.brandSearch.disabled, false);
      assert.equal(ui.brandSearch.focused, true);
      assert.equal(ui.brandSearch.reported, true);

      ui.brandContract.value = 'stable-brand-id';
      ui.brandName.value = ui.brandSearch.value;
      const valid = submitEvent();
      await ui.form.dispatch('submit', valid);
      assert.equal(valid.prevented, false);
      assert.equal(valid.stopped, false);
      assert.equal(ui.brandSearch.customValidity, '');

      ui.brandSearch.value = 'Changed text';
      await ui.brandSearch.dispatch('input');
      assert.equal(ui.brandContract.value, '');
    });
  }
}
