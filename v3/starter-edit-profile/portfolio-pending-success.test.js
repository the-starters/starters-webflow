const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'portfolio-crud.js'), 'utf8')

function loadController() {
  const context = vm.createContext({
    console,
    document: { addEventListener() {} },
  })
  new vm.Script(source, { filename: 'portfolio-crud.js' }).runInContext(context)
  return context
}

test('portfolio controller remains valid classic JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'portfolio-crud.js' }))
})

test('updated highlights select pending-review copy while no update keeps shared copy', () => {
  const context = loadController()

  const updated = context.getStarterEditPortfolioSuccessCopy(1)
  assert.equal(updated.heading, 'Highlight submitted')
  assert.equal(
    updated.message,
    'Your changes were saved and sent for review. Your currently approved highlight stays live until the update is approved.',
  )
  assert.equal(context.getStarterEditPortfolioSuccessCopy(0), null)
  assert.equal(context.getStarterEditPortfolioSuccessCopy(-1), null)
  assert.equal(context.getStarterEditPortfolioSuccessCopy(1.5), null)
})
