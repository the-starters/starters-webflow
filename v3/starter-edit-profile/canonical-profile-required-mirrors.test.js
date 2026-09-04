const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./canonical-profile-loader.js'), 'utf8')

const window = {
  addEventListener() {},
  __tsProfileFormControllers: {},
}
const document = { addEventListener() {} }
window.window = window

vm.runInContext(source, vm.createContext({ window, document, Set, Map, String }))

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

console.log('Edit Profile canonical required-mirror hydration passed')
