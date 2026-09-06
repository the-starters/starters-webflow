// Explicit integration suite: NODE_PATH=<installed node_modules> node --test <this file>
// jsdom is required, never silently skipped. It supplies real DOM events and
// native numeric validity; geometry is supplied because jsdom has no layout.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const { JSDOM } = require('jsdom')
const source = process.env.BUILD_NUMERIC_BASELINE === '1'
  ? execFileSync('git', ['show', 'HEAD:v3/profile-form/shared-foundation.js'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' })
  : fs.readFileSync(path.join(__dirname, 'shared-foundation.js'), 'utf8')

function mount(route) {
  const dom = new JSDOM(`<!doctype html><form data-form="multistep">
    <section data-form="step"><input name="paid-call-rate" type="number" required min="1" max="1000" step="1">
      <button type="button" data-form="next-btn"><span>Continue</span></button></section>
    <section data-form="step" hidden><input type="number" required min="1" value="0"></section>
  </form>`, { url: 'https://example.test' + route, runScripts: 'outside-only' })
  const { window } = dom
  const field = window.document.querySelector('[name="paid-call-rate"]')
  const button = window.document.querySelector('button')
  // Geometry alone is outside jsdom's implementation. No validity override.
  field.getClientRects = () => [{ width: 120, height: 30 }]
  const state = { draftSaves: 0, advances: 0 }
  button.addEventListener('click', () => state.draftSaves++)
  window.document.addEventListener('click', () => state.advances++)
  window.eval(source)
  return { dom, window, field, button, state }
}

for (const route of ['/build-profile/consult', '/build-profile/full-profile/']) {
  for (const value of ['', '-1', '0', '1.5', '1001', '1', '1000']) {
    test(`real DOM ${route}: authored numeric constraints for ${value || 'empty'}`, () => {
      const { dom, window, field, button, state } = mount(route)
      try {
        field.value = value
        const valid = field.checkValidity()
        assert.equal(valid, value === '1' || value === '1000')
        // Native keyboard activation generates a click with detail=0. Real DOM
        // dispatch runs the browser event phases, including stopImmediatePropagation.
        const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })
        button.querySelector('span').dispatchEvent(event)
        assert.equal(event.defaultPrevented, !valid)
        assert.equal(state.draftSaves, valid ? 1 : 0)
        assert.equal(state.advances, valid ? 1 : 0)
        assert.equal(field.value, value)
      } finally { dom.window.close() }
    })
  }
}

test('real DOM disabled and inherited hidden visibility are exempt; correcting value restores Continue', () => {
  const { dom, window, field, button, state } = mount('/build-profile/consult')
  try {
    field.value = '0'
    field.disabled = true
    button.click()
    assert.equal(state.advances, 1)
    field.disabled = false
    field.parentElement.style.visibility = 'hidden'
    assert.equal(window.getComputedStyle(field).visibility, 'hidden')
    button.click()
    assert.equal(state.advances, 2)
    field.parentElement.style.visibility = 'visible'
    button.click()
    assert.equal(state.advances, 2)
    field.value = '1000'
    button.click()
    assert.equal(state.advances, 3)
  } finally { dom.window.close() }
})
