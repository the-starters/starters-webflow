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

async function mountWriter() {
  const fixture = mount('/build-profile/full-profile')
  const { window, field } = fixture
  await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  const form = field.closest('form')
  form.setAttribute('build-profile-form', '')
  field.name = 'rate'
  form.insertAdjacentHTML('beforeend', '<button type="button" form-submit>Submit</button>')
  window.document.body.insertAdjacentHTML('beforeend', '<div build-profile-success></div><div build-profile-error><p>Error</p></div>')
  window.qs = (selector, scope = window.document) => scope.querySelector(selector)
  window.waitForMember = callback => callback()
  window.MEMBER = { id: 'test' }
  window.setLoader = () => {}
  window.console = { log() {}, error() {}, warn() {} }
  window.eval(fs.readFileSync(path.join(__dirname, '../build-profile/submit-writer.js'), 'utf8'))
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  fixture.submit = async () => {
    form.querySelector('[form-submit]').click()
    await Promise.resolve()
    await Promise.resolve()
    fixture.state.advances = 0
    fixture.state.draftSaves = 0
  }
  return fixture
}

for (const value of ['1', '1000']) {
  test('writer rejection recovers through Continue after correction to ' + value, async () => {
    const { dom, window, field, button, state, submit } = await mountWriter()
    try {
      field.value = '1.0'
      button.click()
      assert.equal(state.advances, 1)
      await submit()
      assert.equal(field.validity.customError, true)
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
      button.click()
      assert.equal(state.advances, 0)
      field.value = value
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
      assert.equal(field.validity.customError, false)
      button.click()
      assert.deepEqual(state, { advances: 1, draftSaves: 1 })
      assert.equal(field.value, value)
      field.value = '1.0'
      field.dispatchEvent(new window.Event('change', { bubbles: true }))
      await submit()
      assert.equal(field.validity.customError, true)
    } finally { dom.window.close() }
  })
}

test('writer recovery preserves native constraints and unrelated custom feedback', async () => {
  const { dom, window, field, button, state, submit } = await mountWriter()
  try {
    field.value = '1.0'
    await submit()
    field.value = '1001'
    field.dispatchEvent(new window.Event('change', { bubbles: true }))
    assert.equal(field.validity.customError, false)
    button.click()
    assert.equal(state.advances, 0)
    field.value = '1.0'
    await submit()
    field.setCustomValidity('Unrelated validation')
    field.value = '1'
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
    assert.equal(field.validationMessage, 'Unrelated validation')
    button.click()
    assert.equal(state.advances, 0)
    await submit()
    assert.equal(field.validationMessage, 'Unrelated validation')
  } finally { dom.window.close() }
})
