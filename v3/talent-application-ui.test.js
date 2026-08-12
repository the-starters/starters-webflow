const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./talent-application-ui.js'), 'utf8')

test('boots once and registers the authored UI initializer', () => {
  const listeners = []
  const context = {
    window: {},
    document: {
      addEventListener(type, listener) {
        listeners.push({ type, listener })
      },
    },
    MutationObserver: class {},
    Event: class {},
    setInterval,
    clearInterval,
    setTimeout,
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  vm.runInContext(source, context)

  assert.equal(context.window.__startersTalentApplicationUiBooted, true)
  assert.deepEqual(listeners.map(({ type }) => type), ['DOMContentLoaded'])
})

test('keeps submission transport out of the UI controller', () => {
  const fetches = [...source.matchAll(/fetch\s*\(\s*['"]([^'"]+)/g)].map((match) => match[1])
  assert.deepEqual(fetches, [
    'https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/69f1f101875b89285ab287fd_locations.txt',
  ])
  assert.doesNotMatch(source, /api:[A-Za-z0-9_-]+/)
  assert.doesNotMatch(source, /Form Data:/)
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:email|linkedin|referral|form data)/i)
  assert.match(source, /v3\/talent-application\.js capture listener/)
})

test('preserves the authored application form and conditional-field contracts', () => {
  for (const contract of [
    '[application-form]',
    '[form-submit]',
    '[form-next]',
    'input[name="profile-type"]',
    '[data-element="full-profile"]',
    '[data-element="consult"]',
    '[data-element="referred"]',
    '[data-element="other-option"]',
    '69f1f101875b89285ab287fd_locations.txt',
  ]) {
    assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})
