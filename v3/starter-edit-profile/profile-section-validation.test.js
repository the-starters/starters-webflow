const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const { h, makeEvent } = require('../test-helpers/form-dom.cjs')

function mount() {
  const field = h('input', { name: 'service-name', required: '', 'aria-describedby': 'hint' })
  const section = h('section', {}, [field])
  const window = { matchMedia: () => ({ matches: true }) }
  vm.runInNewContext(fs.readFileSync(__dirname + '/profile-section-validation.js', 'utf8'), {
    window, document: { createElement: tag => h(tag) },
  })
  window.StarterProfileValidation.bind(section)
  const fire = type => field.dispatchEvent(makeEvent(type, field, { bubbles: true }))
  return { section, field, fire }
}

test('section Save reveals and focuses a collapsed invalid field without touching another section', () => {
  const hidden = h('input', { name: 'price', required: '' })
  hidden.rendered = false
  const row = h('div', {}, [hidden])
  const save = h('button', { type: 'button' })
  const section = h('section', {}, [row, save])
  const unrelated = h('input', { name: 'price', required: '' })
  const window = { matchMedia: () => ({ matches: true }) }
  vm.runInNewContext(fs.readFileSync(__dirname + '/profile-section-validation.js', 'utf8'), {
    window, document: { createElement: tag => h(tag) },
  })
  const validation = window.StarterProfileValidation.bind(section, {
    reveal: field => { field.rendered = true },
  })
  let writes = 0
  save.addEventListener('click', () => { if (validation.validate().valid) writes += 1 })
  save.dispatchEvent(makeEvent('click', save))
  assert.equal(writes, 0)
  assert.equal(hidden.rendered, true)
  assert.equal(hidden.focusCalls.length, 1)
  assert.equal(hidden.getAttribute('aria-invalid'), 'true')
  assert.equal(unrelated.getAttribute('aria-invalid'), null)
  hidden.value = '500'
  save.dispatchEvent(makeEvent('click', save))
  assert.equal(writes, 1)
})

test('native Required controls blur feedback, and correcting a shown error preserves its hint association', () => {
  const { section, field, fire } = mount()
  assert.equal(field.getAttribute('aria-invalid'), null, 'no errors on load')
  fire('focusout')
  assert.equal(field.getAttribute('aria-invalid'), 'true')
  const error = section.querySelector('[role="alert"]')
  assert.ok(error.textContent)
  assert.ok(field.getAttribute('aria-describedby').split(' ').includes('hint'))
  assert.ok(field.getAttribute('aria-describedby').split(' ').includes(error.id))
  field.removeAttribute('required')
  fire('input')
  assert.equal(field.getAttribute('aria-invalid'), 'false', 'same blank control now optional')
  assert.equal(error.style.display, 'none')
})

test('authored text constraints also apply to hydrated values and whitespace-only required entries', () => {
  const { field, fire } = mount()
  field.value = '   '
  fire('focusout')
  assert.equal(field.getAttribute('aria-invalid'), 'true')
  field.setAttribute('maxlength', '5')
  field.value = 'Existing oversized value'
  fire('input')
  assert.equal(field.getAttribute('aria-invalid'), 'true')
  field.value = 'Valid'
  fire('input')
  assert.equal(field.getAttribute('aria-invalid'), 'false')
})

test('a backend-required field reports a mismatch only while Webflow leaves it optional', () => {
  const backendOnly = h('input', { name: 'description-retainer', 'form-xano-required': '' })
  const authored = h('input', { name: 'rate', 'form-xano-required': '', required: '' })
  const plain = h('input', { name: 'availability-option' })
  const hidden = h('input', { type: 'hidden', name: 'availability', 'form-xano-required': '' })
  const section = h('section', {}, [backendOnly, authored, plain, hidden])
  const window = { matchMedia: () => ({ matches: true }) }
  vm.runInNewContext(fs.readFileSync(__dirname + '/profile-section-validation.js', 'utf8'), {
    window, document: { createElement: tag => h(tag) },
  })
  const { misconfigured } = window.StarterProfileValidation
  const reported = misconfigured(section)
  assert.equal(reported.length, 1, 'only the field Webflow leaves optional is reported')
  assert.equal(reported[0], backendOnly)
  backendOnly.setAttribute('required', '')
  assert.equal(misconfigured(section).length, 0, 'the authored Required checkbox settles the mismatch')
  assert.equal(misconfigured(h('section', {}, [hidden])).length, 0, 'hidden inputs are not authored controls')
})

test('a field authored both backend-required and not-required for a type is always a mismatch', () => {
  // The two markers contradict each other in every profile type, and the only field whose
  // `required` the active type clears is one carrying `data-non-required`, so the same page
  // reports the same fields for every Starter.
  // The conflict is reported whatever the active type left on the element.
  const paired = h('input', { name: 'description-retainer', 'form-xano-required': '',
    'data-non-required': 'consult', required: '' })
  const section = h('section', {}, [paired])
  const window = { matchMedia: () => ({ matches: true }) }
  vm.runInNewContext(fs.readFileSync(__dirname + '/profile-section-validation.js', 'utf8'), {
    window, document: { createElement: tag => h(tag) },
  })
  assert.equal(window.StarterProfileValidation.misconfigured(section)[0], paired)
  paired.removeAttribute('required')
  assert.equal(window.StarterProfileValidation.misconfigured(section)[0], paired,
    'and the same pairing is reported once the active type has cleared Required')
})

test('the sections share one definition of a write the read proved never landed', () => {
  const window = { matchMedia: () => ({ matches: true }) }
  vm.runInNewContext(fs.readFileSync(__dirname + '/profile-section-validation.js', 'utf8'), {
    window, document: { createElement: tag => h(tag) },
  })
  const { notLanded } = window.StarterProfileValidation
  assert.equal(notLanded.MESSAGE, 'That change was not saved. Your draft is kept; you can save again.')
  assert.equal(notLanded.NOT_LANDED, notLanded.NOT_LANDED)
  const error = notLanded.error()
  assert.equal(error.notLanded, true)
  assert.equal(error.message, notLanded.MESSAGE)
})
