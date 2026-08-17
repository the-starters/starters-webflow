const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./timepicker.js'), 'utf8')

function makeInput(role) {
  return {
    nodeType: 1,
    attributes: { 'data-input-timepicker': '', 'data-input-timepicker-role': role },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
    },
    matches(selector) {
      return selector === '[data-input-timepicker]'
    },
    closest(selector) {
      return selector === '[data-input-timepicker-group]' ? this.group : null
    },
    querySelectorAll() { return [] },
  }
}

function makeHarness(startValue) {
  const start = makeInput('start')
  const end = makeInput('end')
  const group = {
    nodeType: 1,
    attributes: { 'data-input-timepicker-group': '' },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
    },
    setAttribute(name, value) { this.attributes[name] = String(value) },
    matches(selector) { return selector === '[data-input-timepicker-group]' },
    querySelector(selector) {
      if (selector.includes('role="start"')) return start
      if (selector.includes('role="end"')) return end
      return null
    },
    querySelectorAll(selector) {
      return selector === '[data-input-timepicker]' ? [start, end] : []
    },
  }
  start.group = group
  end.group = group

  const document = {
    nodeType: 9,
    body: { contains: () => true },
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({}),
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '[data-input-timepicker-group]') return [group]
      if (selector === '[data-input-timepicker]') return [start, end]
      return []
    },
  }

  const states = new WeakMap()
  const stateFor = (el) => {
    if (!states.has(el)) states.set(el, { data: {}, options: {}, date: el === start ? startValue : null })
    return states.get(el)
  }
  function $(el) {
    const state = stateFor(el)
    return {
      length: 0,
      data(name, value) {
        if (arguments.length === 1) return state.data[name]
        state.data[name] = value
        return this
      },
      closest() { return { length: 0 } },
      timepicker(command, name, value) {
        if (typeof command === 'object') {
          state.options = { ...state.options, ...command }
          return this
        }
        if (command === 'getDate') return state.date
        if (command === 'option') {
          state.options[name] = value
          return this
        }
        return this
      },
    }
  }
  $.fn = { timepicker() {} }

  const context = {
    window: null,
    document,
    jQuery: $,
    setTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (fn) => { fn(); return 1 },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    innerHeight: 900,
  }
  context.window = context
  return { context, start, end, stateFor }
}

test('a string value from the timepicker addon becomes a safe range bound', () => {
  const harness = makeHarness('09:30')
  vm.createContext(harness.context)
  vm.runInContext(source, harness.context)

  assert.doesNotThrow(() => harness.stateFor(harness.start).options.onSelect())
  assert.equal(harness.stateFor(harness.end).options.minTime, '09:30:00')
})
