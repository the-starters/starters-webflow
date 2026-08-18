const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const { h } = require('../../step-flow-test-dom')

const source = fs.readFileSync(require.resolve('./contract-preview.js'), 'utf8')

function label(text, input) {
  const el = h('label', { for: input.getAttribute('id') }, [input])
  el.textContent = text
  return el
}

function singleValueDestination(key, standardToggleValue) {
  const value = h('p', { 'data-preview-contract-element': 'value' })
  const standardHelp = h('p', {
    'data-preview-contract-element-toggle': `value=${standardToggleValue}`,
  })
  const ownHelp = h('p', {
    'data-preview-contract-element-toggle': 'value=My own contract',
  })
  const destination = h('div', { 'data-preview-contract': key }, [value, standardHelp, ownHelp])
  return { destination, value, standardHelp, ownHelp }
}

function makeHarness() {
  const projectName = h('input', { id: 'project-name', type: 'text' })
  projectName.value = 'Research project'

  const standard = h('input', { id: 'standard-contract', type: 'radio', name: 'Contract' })
  standard.value = 'Standard contract'
  standard.checked = true

  const own = h('input', { id: 'own-contract', type: 'radio', name: 'Contract' })
  own.value = 'My own contract'
  own.checked = false

  const contractSource = h('section', { 'data-preview-contract-fields': 'contract' }, [
    label('Contract', standard),
    label('Contract', own),
  ])
  // Match the active Hire form: Contract is a dedicated source nested inside
  // the broader Basic Information source.
  const basicSource = h('section', { 'data-preview-contract-fields': 'basic-information' }, [
    label('Project Name', projectName),
    contractSource,
  ])

  const basic = singleValueDestination('basic-information', 'unused')
  const basicContractSlot = h('span', {
    'data-preview-contract-field': 'basic-information',
    'data-preview-contract-field-name': 'Contract',
    'data-preview-contract-field-slot': 'value',
  })
  const review = singleValueDestination('contract', 'Standard contract')
  // Match the second authored review block, whose toggle currently uses a capital C.
  const success = singleValueDestination('contract', 'Standard Contract')

  const step2 = h('section', { 'data-form-flow-element': 'step-2' })
  step2.style.display = 'none'
  step2.append(review.destination)
  const successBlock = h('section', { class: 'generate-contract_success' }, [success.destination])
  successBlock.style.display = 'none'

  const form = h('form', { 'data-form-flow': 'generate-contract' }, [basicSource, step2])
  const wrapper = h('div', { class: 'w-form' }, [
    form,
    basic.destination,
    basicContractSlot,
    successBlock,
  ])
  const body = h('body', {}, [wrapper])

  for (const el of [body, ...body.descendants()]) el.nodeType = 1

  const observers = []
  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe() {}
  }

  const document = {
    readyState: 'complete',
    body,
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  }
  const window = { CSS: { escape: (value) => String(value) } }
  window.window = window

  const context = vm.createContext({
    CSS: window.CSS,
    MutationObserver,
    document,
    getComputedStyle: (el) => ({ display: el.style.display || 'block' }),
    window,
  })
  vm.runInContext(source, context, { filename: 'contract-preview.js' })

  function show(el) {
    el.style.display = 'none'
    observers.forEach((observer) => observer.callback())
    el.style.display = 'block'
    observers.forEach((observer) => observer.callback())
  }

  function choose(next) {
    standard.checked = next === standard
    own.checked = next === own
    show(step2)
    show(successBlock)
  }

  return { basic, basicContractSlot, choose, own, review, standard, success }
}

function assertContractState(destination, expectedValue, expectedHelp) {
  assert.equal(destination.value.textContent, expectedValue)
  assert.equal(destination.standardHelp.hasAttribute('hidden'), expectedHelp !== 'standard')
  assert.equal(destination.ownHelp.hasAttribute('hidden'), expectedHelp !== 'own')
}

test('native contract radios render Standard -> Own -> Standard into both review blocks', () => {
  const harness = makeHarness()

  assertContractState(harness.review, 'Standard contract', 'standard')
  assertContractState(harness.success, 'Standard contract', 'standard')

  harness.choose(harness.own)
  assertContractState(harness.review, 'My own contract', 'own')
  assertContractState(harness.success, 'My own contract', 'own')

  harness.choose(harness.standard)
  assertContractState(harness.review, 'Standard contract', 'standard')
  assertContractState(harness.success, 'Standard contract', 'standard')
})

test('dedicated contract source does not leak radio values into basic information', () => {
  const harness = makeHarness()

  assert.equal(harness.basic.value.textContent, 'Research project')
  assert.equal(harness.basicContractSlot.textContent, '')
  harness.choose(harness.own)
  assert.equal(harness.basic.value.textContent, 'Research project')
  assert.equal(harness.basicContractSlot.textContent, '')
  harness.choose(harness.standard)
  assert.equal(harness.basic.value.textContent, 'Research project')
  assert.equal(harness.basicContractSlot.textContent, '')
  assert.doesNotMatch(harness.basic.value.textContent, /contract/i)
})
