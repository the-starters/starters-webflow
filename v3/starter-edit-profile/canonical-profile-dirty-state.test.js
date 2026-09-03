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

function assertClean(window, message) {
  const event = beforeUnload(window)
  assert.equal(event.prevented, false, message)
  assert.equal(event.returnValue, undefined, `${message} (leaves the leave-page prompt unrequested)`)
}

function assertPrompts(window, message) {
  const event = beforeUnload(window)
  assert.equal(event.prevented, true, message)
  assert.equal(event.returnValue, true, `${message} (requests the browser-native leave-page prompt)`)
}

{
  const { window, document, state } = loadDirtyState()
  document.dispatch('input', { target: field(1) })
  assertClean(window, 'hydration changes stay clean')

  state.finishHydration()
  assertClean(window, 'unchanged navigation stays clean')

  state.runHydrationSync(() => {
    document.dispatch('input', { target: field(3), isTrusted: false })
  })
  assertClean(window, 'explicit late hydration changes stay clean')

  document.dispatch('input', { target: field(3), isTrusted: false })
  assertPrompts(window, 'synthetic events from user-driven custom controls mark dirty')
  state.setDirty(3, false)
  assertClean(window, 'discarding the only local change clears the warning')

  document.dispatch('change', { target: field(1), isTrusted: true })
  assertPrompts(window, 'a real edit prevents unguarded navigation')

  const save = state.beginSave(1)
  assertPrompts(window, 'an in-flight save remains protected')
  state.sealSave(save)
  state.finishSave(1, true, save)
  assertClean(window, 'an accepted save clears its step')
}

{
  const { window, document, state } = loadDirtyState()
  state.finishHydration()
  document.dispatch('input', { target: field(2) })
  const failedSave = state.beginSave(2)
  state.finishSave(2, false, failedSave)
  assertPrompts(window, 'a failed save keeps the warning')

  const retrySave = state.beginSave(2)
  state.sealSave(retrySave)
  state.finishSave(2, true, retrySave)
  assertClean(window, 'a repeated successful save clears it')
}

{
  const { window, document, state } = loadDirtyState()
  state.finishHydration()
  document.dispatch('input', { target: field(1) })
  document.dispatch('input', { target: field(2) })
  const firstSave = state.beginSave(1)
  state.sealSave(firstSave)
  state.finishSave(1, true, firstSave)
  assertPrompts(window, 'saving one step preserves another dirty step')
  const secondSave = state.beginSave(2)
  state.sealSave(secondSave)
  state.finishSave(2, true, secondSave)
  assertClean(window, 'clearing every dirty step leaves navigation clean')
}

{
  const { window, document, state } = loadDirtyState()
  state.finishHydration()
  document.dispatch('input', { target: field(1) })
  const save = state.beginSave(1)
  document.dispatch('input', { target: field(1) })
  state.sealSave(save)
  document.dispatch('input', { target: field(1) })
  state.finishSave(1, true, save)
  assertPrompts(window, 'an accepted save preserves edits made after its payload snapshot')
}

{
  const { window, document, state } = loadDirtyState()
  state.finishHydration()
  document.dispatch('input', { target: field(1) })
  const save = state.beginSave(1)
  document.dispatch('input', { target: field(1) })
  state.sealSave(save)
  state.finishSave(1, true, save)
  assertClean(window, 'an accepted save clears edits included in its later payload snapshot')
}

console.log('Edit Profile dirty-state behavior passed')
