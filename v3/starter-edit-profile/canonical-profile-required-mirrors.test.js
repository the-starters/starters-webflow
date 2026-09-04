const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./canonical-profile-loader.js'), 'utf8')

const window = {
  addEventListener() {},
  __tsProfileFormControllers: {},
}
const document = { addEventListener() {} }
window.window = window

vm.runInContext(source, vm.createContext({ window, document, Set, Map, String }))

test('canonical required mirrors prefer IDs and preserve display fallbacks', () => {
  const mirrors = window.StartersCanonicalProfileLoader.canonicalRequiredMirrors({
    Category_ID: 'category-id',
    Category: 'Category fallback',
    Roles_IDs: ['role-a', 'role-b'],
    Roles: ['Role fallback'],
    Subcategories_IDs: [],
    Subcategories: ['Strategy'],
    Skills_IDs: ['skill-id'],
    Skills: ['Skill fallback'],
    Tools_IDs: null,
    Tool: 'Figma',
    Availability_ID: 42,
    Availability: '21-40',
  })

  assert.deepEqual(JSON.parse(JSON.stringify(mirrors)), {
    step_1: {
      'function-required': 'category-id',
      'roles-required': 'role-a,role-b',
      'subcategories-required': 'Strategy',
    },
    step_5: {
      'skills-required': 'skill-id',
      'tools-required': 'Figma',
    },
    step_6: {
      'availability-required': '42',
    },
  })
})

test('restoration hydrates every required mirror so validation passes', () => {
  const mirrorNames = [
    'function-required',
    'roles-required',
    'subcategories-required',
    'skills-required',
    'tools-required',
    'availability-required',
  ]
  const fields = Object.fromEntries(mirrorNames.map((name) => [name, {
    name,
    value: '',
    required: true,
    attributes: { 'ms-code-select': 'input-required' },
    checkValidity() { return !this.required || this.value.trim() !== '' },
  }]))
  const steps = [
    { index: '1', fields: mirrorNames.slice(0, 3).map((name) => fields[name]) },
    { index: '5', fields: mirrorNames.slice(3, 5).map((name) => fields[name]) },
    { index: '6', fields: [fields['availability-required']] },
  ]
  const mirrors = window.StartersCanonicalProfileLoader.canonicalRequiredMirrors({
    Category_ID: 'category-id',
    Roles_IDs: ['role-a', 'role-b'],
    Subcategories: ['Strategy'],
    Skills_IDs: ['skill-id'],
    Tool: 'Figma',
    Availability_ID: 42,
  })

  window.StartersCanonicalProfileLoader.restoreCanonicalProfileFields(
    { data: mirrors },
    steps,
    (step) => step.index,
    (selector, step) => step.fields.filter((field) => (
      selector.split(',').some((part) => {
        const match = part.trim().match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/)
        if (!match) return false
        const value = field.attributes[match[1]]
        return match[2] === undefined ? value !== undefined : value === match[2]
      })
    )),
    (field, value) => { field.value = String(value) },
  )

  assert.deepEqual(
    Object.fromEntries(mirrorNames.map((name) => [name, fields[name].value])),
    {
      'function-required': 'category-id',
      'roles-required': 'role-a,role-b',
      'subcategories-required': 'Strategy',
      'skills-required': 'skill-id',
      'tools-required': 'Figma',
      'availability-required': '42',
    },
  )
  assert.equal(mirrorNames.every((name) => fields[name].checkValidity()), true)
})
