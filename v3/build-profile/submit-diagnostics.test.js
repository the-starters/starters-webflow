const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const helperSource = fs.readFileSync(
  path.join(__dirname, '../../utils/workflow-diagnostics.js'),
  'utf8',
)
const source = fs.readFileSync(path.join(__dirname, 'submit-diagnostics.js'), 'utf8')

class Element {
  constructor(attributes = {}) {
    this.attributes = { ...attributes }
    this.listeners = {}
    this.style = { display: '' }
    this.hidden = false
    this.parentElement = null
  }
  addEventListener(type, listener) { ;(this.listeners[type] ||= []).push(listener) }
  dispatch(type) { for (const listener of this.listeners[type] || []) listener({ type }) }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  closest() { return null }
}

function boot() {
  const form = new Element({ 'build-profile-form': '' })
  const trigger = new Element({ 'form-submit': '' })
  const success = new Element({ 'build-profile-success': '' })
  const error = new Element({ 'build-profile-error': '' })
  success.style.display = 'none'
  error.style.display = 'none'
  form.querySelector = (selector) => selector === '[form-submit]' ? trigger : null
  success.querySelector = () => null
  error.querySelector = () => null
  form.parentElement = new Element()
  const observers = []
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe() {}
  }
  const session = new Map()
  const document = {
    currentScript: { src: 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/v3/build-profile/submit-diagnostics.js' },
    documentElement: new Element(),
    readyState: 'complete',
    querySelector(selector) {
      if (selector === '[build-profile-form]') return form
      if (selector === '[build-profile-success]') return success
      if (selector === '[build-profile-error]') return error
      return null
    },
  }
  const window = {
    Date,
    MutationObserver,
    clearTimeout,
    console: { info() {} },
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    document,
    getComputedStyle: (element) => ({ display: element.style.display || 'block', visibility: 'visible' }),
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/build-profile/consult' },
    navigator: {},
    sessionStorage: {
      getItem: (key) => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
    },
    setTimeout,
  }
  const context = vm.createContext({
    Date, Math, MutationObserver, Promise, Uint32Array, URL, clearTimeout,
    console: window.console, document, setTimeout, window,
  })
  new vm.Script(helperSource).runInContext(context)
  new vm.Script(source).runInContext(context)
  return { error, form, observers, success, trigger, window }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('human click plus authored success records a copyable terminal receipt', async () => {
  const page = boot()
  page.trigger.dispatch('click')
  await tick()
  assert.equal(
    page.window.StartersWorkflowDiagnostics.latest('build_profile_submit').result,
    'started',
  )
  page.success.style.display = 'block'
  page.observers[0].callback()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('build_profile_submit')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.request_started, true)
  assert.equal(receipt.resource_type, 'talent_profile')
  assert.equal(
    page.success.getAttribute('data-workflow-diagnostic-copy'),
    'build_profile_submit',
  )
  assert.match(page.success.textContent || '', /Diagnostic ID:/)
})

test('authored error records a stable failure without form data', async () => {
  const page = boot()
  page.trigger.dispatch('click')
  await tick()
  page.error.style.display = 'block'
  page.observers[0].callback()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('build_profile_submit')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.error_code, 'BUILD_PROFILE_SAVE_FAILED')
  assert.equal(JSON.stringify(receipt).includes('email'), false)
})

test('observer does not read fields, intercept clicks, or send requests', () => {
  assert.equal(/\.value\b/.test(source), false)
  assert.equal(/FormData|preventDefault|stopPropagation|stopImmediatePropagation/.test(source), false)
  assert.equal(/fetch\s*\(/.test(source), false)
})
