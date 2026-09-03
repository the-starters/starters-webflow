const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function load(file) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
  const context = vm.createContext({
    console,
    Date,
    Map,
    Set,
    document: { addEventListener() {} },
  })
  new vm.Script(source, { filename: file }).runInContext(context)
  return { context, source }
}

test('discarding the final local portfolio draft leaves no pending work', () => {
  const { context, source } = load('portfolio-crud.js')
  assert.equal(context.hasStarterEditPortfolioPendingChanges([], new Map(), new Set()), false)
  assert.equal(context.hasStarterEditPortfolioPendingChanges([{ id: 'draft_1' }], new Map(), new Set()), true)
  assert.match(source, /removeCreateDraft\(portfolio\.id\);[\s\S]*?reconcilePortfolioDirtyState\(\);/)
})

test('discarding a company draft preserves other company-step changes', () => {
  const { context, source } = load('company-experience-crud.js')
  assert.equal(context.hasStarterEditCompanyPendingChanges([], new Map(), new Set(), false), false)
  assert.equal(context.hasStarterEditCompanyPendingChanges([], new Map(), new Set(), true), true)
  assert.match(source, /removeCreateDraft\(id\);[\s\S]*?reconcileCompanyDirtyState\(\);/)
})
