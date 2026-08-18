'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  normalizePublishedFormContract,
  validatePublishedFormContract,
} = require('./published-form-contract.js')

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'published-form-contract.json'), 'utf8'),
)

function node(type, attributes, children, extra) {
  return { type, attributes: attributes || {}, children: children || [], ...(extra || {}) }
}

test('persisted published form contract passes its semantic ownership gate', () => {
  assert.deepEqual(validatePublishedFormContract(manifest), { valid: true, errors: [] })
})

test('contract covers the full Personal Details marker surface, not only email and phone', () => {
  const personal = manifest.steps.find((step) => step.index === '1')
  const ids = personal.controls.map((control) => control.id)

  assert.deepEqual(ids, [
    'first-name',
    'last-name',
    'email',
    'phone',
    'country',
    'state',
    'city',
    'profile-photo',
    'profile-photo-url',
    'function-option',
    'function',
    'function-required',
    'role-option',
    'roles',
    'roles-required',
    'subcategories-option',
    'subcategories',
    'subcategories-required',
  ])
})

test('ownership gate rejects a missing mirror marker and a lost CRUD boundary', () => {
  const changed = structuredClone(manifest)
  changed.steps[0].controls = changed.steps[0].controls.filter(({ id }) => id !== 'roles-required')
  changed.steps[2].components = ['Button']

  const result = validatePublishedFormContract(changed)
  assert.equal(result.valid, false)
  assert.deepEqual(result.errors, [
    'step 1 is missing #roles-required',
    'step 3 must remain owned by Companies [Build\\Edit Forms]',
  ])
})

test('semantic gate enforces the step 5 hidden required markers', async (t) => {
  for (const id of ['skills-required', 'tools-required']) {
    await t.test(`rejects missing #${id}`, () => {
      const changed = structuredClone(manifest)
      const step5 = changed.steps.find((step) => step.index === '5')
      step5.controls = step5.controls.filter((control) => control.id !== id)

      assert.deepEqual(validatePublishedFormContract(changed), {
        valid: false,
        errors: [`step 5 is missing #${id}`],
      })
    })

    await t.test(`rejects non-required #${id}`, () => {
      const changed = structuredClone(manifest)
      const step5 = changed.steps.find((step) => step.index === '5')
      const marker = step5.controls.find((control) => control.id === id)
      delete marker.attributes.required

      assert.deepEqual(validatePublishedFormContract(changed), {
        valid: false,
        errors: [`#${id} must remain required`],
      })
    })
  }
})

test('normalizer exposes structure while dropping text, values, props, styles, URLs, and element IDs', () => {
  const tree = node('Body', {}, [
    node('FormForm', {
      id: 'wf-form-Build-Form-Full-Profile',
      'build-profile-form': '',
      action: 'https://private.example.invalid/write',
    }, [
      node('TabsPane', { 'data-form': 'step', 'data-index': '1' }, [
        node('String', {}, [], { textContent: 'Person Name' }),
        node('FormTextInput', {
          id: 'email',
          value: 'person@example.com',
          placeholder: 'person@example.com',
          'data-input-capture': '',
        }, [], {
          settings: { input: { inputName: 'email' } },
          styleNames: ['secret-style'],
          id: { component: 'component-id', element: 'element-id' },
        }),
        node('ComponentInstance', {}, [], {
          instanceDetails: {
            name: 'Button',
            props: [{ name: 'Button Text', value: 'Private text' }],
          },
        }),
      ]),
    ]),
  ])

  const result = normalizePublishedFormContract(
    tree,
    { siteId: 'site', pageId: 'page', path: '/starter-edit-profile', capturedOn: '2026-08-18' },
    {
      steps: [{
        index: '1',
        controls: [node('FormSelect', {
          id: 'country',
          name: 'country',
          value: 'Private country value',
          'data-input-capture': '',
        })],
        submitMarkers: [''],
      }],
    },
  )

  assert.deepEqual(result.steps[0].controls[0], {
    type: 'FormTextInput',
    id: 'email',
    name: 'email',
    attributes: { id: 'email', 'data-input-capture': '' },
  })
  assert.deepEqual(result.steps[0].components, ['Button'])
  assert.deepEqual(result.steps[0].controls[1], {
    type: 'FormSelect',
    id: 'country',
    name: 'country',
    attributes: { id: 'country', name: 'country', 'data-input-capture': '' },
  })
  assert.deepEqual(result.steps[0].submitMarkers, [''])
  assert.equal(JSON.stringify(result).includes('person@example.com'), false)
  assert.equal(JSON.stringify(result).includes('Private text'), false)
  assert.equal(JSON.stringify(result).includes('private.example.invalid'), false)
  assert.equal(JSON.stringify(result).includes('element-id'), false)
  assert.equal(JSON.stringify(result).includes('secret-style'), false)
  assert.equal(JSON.stringify(result).includes('Private country value'), false)
})

test('normalizer fails closed when the native Webflow form marker is absent', () => {
  assert.throws(
    () => normalizePublishedFormContract(node('Body'), {}),
    /no \[build-profile-form\]/,
  )
})

test('main form contract does not opt into a document-capture validation owner', () => {
  assert.equal(Object.hasOwn(manifest.form.attributes, 'wf-validate-element'), false)
  assert.equal(Object.hasOwn(manifest.form.attributes, 'wf-validate-submit-disable'), false)

  const tree = node('Body', {}, [
    node('FormForm', {
      id: 'wf-form-Build-Form-Full-Profile',
      'build-profile-form': '',
      'wf-validate-element': 'form',
      'wf-validate-submit-disable': 'true',
    }, []),
  ])
  const normalized = normalizePublishedFormContract(tree, {})
  assert.equal(normalized.form.attributes['wf-validate-element'], 'form')
  assert.equal(normalized.form.attributes['wf-validate-submit-disable'], 'true')
  const result = validatePublishedFormContract(normalized)
  assert.equal(result.errors.includes('main form must not delegate validation through wf-validate-element'), true)
  assert.equal(result.errors.includes('main form must not delegate validation through wf-validate-submit-disable'), true)
})

test('semantic gate rejects a value-bearing attribute that could retain member data', () => {
  const changed = structuredClone(manifest)
  changed.steps[0].controls[2].attributes.value = 'person@example.com'

  const result = validatePublishedFormContract(changed)
  assert.equal(result.valid, false)
  assert.equal(result.errors.includes('contract retained unsafe attribute value'), true)
})

test('semantic gate enforces submit markers, the exact step 6 required groups, and reviewer internals', () => {
  const changed = structuredClone(manifest)
  changed.steps.find((step) => step.index === '5').submitMarkers = []
  const step6 = changed.steps.find((step) => step.index === '6')
  step6.controls
    .filter((control) => control.name === 'free-consulting-calls')
    .forEach((control) => { delete control.attributes.required })
  const step7 = changed.steps.find((step) => step.index === '7')
  step7.controls = step7.controls.filter((control) => control.id !== 'reviewer-email')

  const result = validatePublishedFormContract(changed)
  assert.equal(result.valid, false)
  assert.equal(result.errors.includes('step 5 must keep data-edit-submit=[""]'), true)
  assert.equal(
    result.errors.includes('step 6 required controls must remain rate, three call/retainer radio groups, and availability-required'),
    true,
  )
  assert.equal(result.errors.includes('step 7 is missing #reviewer-email'), true)
})
