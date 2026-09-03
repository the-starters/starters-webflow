const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./canonical-profile-loader.js'), 'utf8')

class EventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event)
  }
}

function loadDirtyState() {
  const window = new EventTarget()
  const document = new EventTarget()
  window.window = window
  const context = vm.createContext({ window, document, Set, String })
  vm.runInContext(source, context)
  return { window, document, state: window.__tsProfileDirtyState }
}

function field(stepIndex) {
  return {
    closest(selector) {
      assert.equal(selector, '[data-form="step"][data-index]')
      return { getAttribute: (name) => name === 'data-index' ? String(stepIndex) : null }
    },
  }
}

function beforeUnload(window) {
  const event = {
    prevented: false,
    returnValue: undefined,
    preventDefault() { this.prevented = true },
  }
  window.dispatch('beforeunload', event)
  return event
}

{
  const { window, document, state } = loadDirtyState()
  document.dispatch('input', { target: field(1) })
  assert.equal(beforeUnload(window).prevented, false, 'hydration changes stay clean')

  state.finishHydration()
  assert.equal(beforeUnload(window).prevented, false, 'unchanged navigation stays clean')

  document.dispatch('change', { target: field(1) })
  assert.equal(beforeUnload(window).prevented, true, 'a real edit warns before navigation')

  state.beginSave(1)
  assert.equal(beforeUnload(window).prevented, true, 'an in-flight save remains protected')

  state.finishSave(1, true)
  assert.equal(beforeUnload(window).prevented, false, 'an accepted save clears its step')
}

{
  const { window, document, state } = loadDirtyState()
  state.finishHydration()
  document.dispatch('input', { target: field(2) })
  state.beginSave(2)
  state.finishSave(2, false)
  assert.equal(beforeUnload(window).prevented, true, 'a failed save keeps the warning')

  state.beginSave(2)
  state.finishSave(2, true)
  assert.equal(beforeUnload(window).prevented, false, 'a repeated successful save clears it')
}

{
  const { window, document, state } = loadDirtyState()
  state.finishHydration()
  document.dispatch('input', { target: field(1) })
  document.dispatch('input', { target: field(2) })
  state.beginSave(1)
  state.finishSave(1, true)
  assert.equal(beforeUnload(window).prevented, true, 'saving one step preserves another dirty step')
  state.beginSave(2)
  state.finishSave(2, true)
  assert.equal(beforeUnload(window).prevented, false)
}

console.log('Edit Profile dirty-state behavior passed')
