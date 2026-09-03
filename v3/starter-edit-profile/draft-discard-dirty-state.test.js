const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

class EventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }
}

function load(controllerFile) {
  const window = new EventTarget()
  const document = new EventTarget()
  window.window = window
  const context = vm.createContext({ window, document, console, Date, Map, Set, String })
  for (const file of ['canonical-profile-loader.js', controllerFile]) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    new vm.Script(source, { filename: file }).runInContext(context)
  }
  window.__tsProfileDirtyState.finishHydration()
  return { context, state: window.__tsProfileDirtyState }
}

for (const scenario of [
  {
    label: 'portfolio',
    file: 'portfolio-crud.js',
    step: 4,
    create(context, options) { return context.createStarterEditPortfolioDraftDirtyController(options) },
  },
  {
    label: 'company',
    file: 'company-experience-crud.js',
    step: 3,
    create(context, options) { return context.createStarterEditCompanyDraftDirtyController(options) },
  },
]) {
  test(`discarding the only local ${scenario.label} draft returns its step to clean`, () => {
    const { context, state } = load(scenario.file)
    const pending = new Set()
    const controller = scenario.create(context, {
      dirtyState: state,
      stepIndex: scenario.step,
      hasPendingChanges: () => pending.size > 0,
    })

    state.markDirty(scenario.step)
    pending.add('draft-a')
    controller.queue('draft-a')
    pending.delete('draft-a')
    controller.discard('draft-a')

    assert.equal(state.isDirty(), false)
  })

  test(`discarding a ${scenario.label} draft preserves a later unqueued edit`, () => {
    const { context, state } = load(scenario.file)
    const pending = new Set()
    const controller = scenario.create(context, {
      dirtyState: state,
      stepIndex: scenario.step,
      hasPendingChanges: () => pending.size > 0,
    })

    state.markDirty(scenario.step)
    pending.add('draft-a')
    controller.queue('draft-a')
    state.markDirty(scenario.step)
    pending.delete('draft-a')
    controller.discard('draft-a')

    assert.equal(state.isDirty(), true)
  })

  test(`discarding all ${scenario.label} drafts clears them in either order`, () => {
    const { context, state } = load(scenario.file)
    const pending = new Set()
    const controller = scenario.create(context, {
      dirtyState: state,
      stepIndex: scenario.step,
      hasPendingChanges: () => pending.size > 0,
    })

    state.markDirty(scenario.step)
    pending.add('draft-a')
    controller.queue('draft-a')
    state.markDirty(scenario.step)
    pending.add('draft-b')
    controller.queue('draft-b')
    pending.delete('draft-b')
    controller.discard('draft-b')
    pending.delete('draft-a')
    controller.discard('draft-a')

    assert.equal(state.isDirty(), false)
  })
}
