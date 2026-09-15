const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

// Execute the shared classic script with legacy authored attributes and DOM event
// phases. Native validity is an injected browser boundary, not price normalization.
function mount(route = '/build-profile/consult') {
  const listeners = []
  const form = { matches: selector => selector === 'form[data-form="multistep"]' }
  const fields = []
  const step = {
    closest: selector => selector === 'form[data-form="multistep"]' ? form : null,
    querySelectorAll: selector => {
      assert.equal(selector, 'input[type="number"][required]')
      return fields
    },
  }
  const button = {
    closest: selector => selector === '[data-form="step"]' ? step :
      selector === 'form[data-form="multistep"]' ? form : null,
  }
  const target = { closest: selector => selector === '[data-form="next-btn"]' ? button : null }
  const document = { addEventListener: (type, callback, capture) => listeners.push({ type, callback, capture }) }
  const window = { location: { pathname: route }, getComputedStyle: field => ({ visibility: field.visibility }) }
  const context = vm.createContext({ window, document })
  const source = fs.readFileSync(path.join(__dirname, 'shared-foundation.js'), 'utf8')
  vm.runInContext(source, context)
  function add(valid, options = {}) {
    const field = {
      disabled: false, willValidate: true, visibility: 'visible', checked: 0, reported: 0, focused: false,
      getClientRects: () => [1],
      checkValidity() { this.checked++; return valid },
      reportValidity() { this.reported++; this.focused = !valid; return valid },
      ...options,
    }
    fields.push(field)
    return field
  }
  function click(clicked = target, detail = 1) {
    const state = { prevented: false, stopped: false, draftSaves: 0, advances: 0 }
    const event = { target: clicked, detail, preventDefault() { state.prevented = true }, stopImmediatePropagation() { state.stopped = true } }
    for (const listener of listeners.filter(l => l.type === 'click' && l.capture === true)) {
      listener.callback(event)
      if (state.stopped) break
    }
    // Existing target draft-state and bubbling Videsigns handlers.
    if (!state.stopped) { state.draftSaves++; state.advances++ }
    return state
  }
  return { add, click, step, button, target, context, source, listeners }
}

for (const route of ['/build-profile/consult', '/build-profile/full-profile/']) {
  for (const [value, valid] of [['', false], ['-1', false], ['0', false], ['1001', false], ['1.5', false], ['1', true], ['1000', true]]) {
    test(`${route}: native validity ${value || 'empty'} gates legacy Continue before draft/engine`, () => {
      const page = mount(route)
      const input = page.add(valid, { value, min: '1', max: '1000', step: '1', required: true })
      const state = page.click()
      assert.equal(input.checked, 1)
      assert.equal(state.prevented, !valid)
      assert.equal(state.draftSaves, valid ? 1 : 0)
      assert.equal(state.advances, valid ? 1 : 0)
      assert.equal(input.reported, valid ? 0 : 1)
      assert.equal(input.focused, !valid)
      assert.equal(input.value, value)
    })
  }
}

test('keyboard-generated click has the same gate; valid activation keeps its default', () => {
  const page = mount()
  const first = page.add(false)
  const second = page.add(false)
  assert.equal(page.click(page.target, 0).prevented, true)
  assert.equal(first.focused, true)
  assert.equal(second.reported, 0)
  first.checkValidity = second.checkValidity = () => true
  assert.equal(page.click(page.target, 0).prevented, false)
})

test('disabled, barred, hidden, and collapsed inactive numeric fields do not block', () => {
  const page = mount()
  const inputs = [page.add(false, { disabled: true }), page.add(false, { willValidate: false }),
    page.add(false, { getClientRects: () => [] }), page.add(false, { visibility: 'hidden' }),
    page.add(false, { visibility: 'collapse' })]
  assert.equal(page.click().advances, 1)
  inputs.forEach(input => assert.equal(input.checked, 0))
})

test('fresh click reads dynamic fields and a corrected invalid field can continue', () => {
  const page = mount()
  assert.equal(page.click().advances, 1)
  const field = page.add(false)
  assert.equal(page.click().advances, 0)
  field.checkValidity = () => true
  assert.equal(page.click().advances, 1)
})

test('other routes, non-Continue clicks, and non-legacy forms are untouched', () => {
  const edit = mount('/starter-edit-profile')
  const field = edit.add(false)
  assert.equal(edit.click().advances, 1)
  assert.equal(field.checked, 0)
  const page = mount()
  page.add(false)
  assert.equal(page.click({ closest: () => null }).advances, 1)
  page.step.closest = () => null
  assert.equal(page.click().advances, 1)
})

test('repeat script evaluation does not duplicate the capture listener', () => {
  const page = mount()
  vm.runInContext(page.source, page.context)
  assert.equal(page.listeners.filter(l => l.type === 'click').length, 1)
})
