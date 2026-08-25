const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'portfolio-crud.js'), 'utf8');

function loadController() {
  const context = vm.createContext({
    console,
    document: { addEventListener() {} },
  });
  new vm.Script(source, { filename: 'portfolio-crud.js' }).runInContext(context);
  return context;
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const values = listeners.get(type) || [];
      values.push(listener);
      listeners.set(type, values);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
  };
}

test('portfolio lifecycle ignores Escape and closes only a stale restored modal', () => {
  const context = loadController();
  const eventTarget = createEventTarget();
  let hasActivePortfolio = true;
  let closeCount = 0;

  context.createStarterEditPortfolioModalLifecycle({
    eventTarget,
    hasActivePortfolio: () => hasActivePortfolio,
    closeModal: () => { closeCount += 1; },
  });

  eventTarget.dispatchEvent({ type: 'keydown', key: 'Escape' });
  eventTarget.dispatchEvent({ type: 'pageshow' });
  assert.equal(closeCount, 0);

  hasActivePortfolio = false;
  eventTarget.dispatchEvent({ type: 'pageshow' });
  assert.equal(closeCount, 1);
});
