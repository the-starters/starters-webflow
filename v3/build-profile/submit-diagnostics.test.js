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
  dispatch(type, extra = {}) { for (const listener of this.listeners[type] || []) listener({ type, ...extra }) }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  closest() { return null }
}

function boot({ delayHelper = false, helperUnavailable = false } = {}) {
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
  const redirects = []
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
    location: {
      hostname: 'the-starters-3-0.webflow.io',
      pathname: '/build-profile/consult',
      replace: (url) => redirects.push(url),
    },
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
  let resolveHelper = null
  if (helperUnavailable) {
    window.__startersWorkflowDiagnosticsReady = Promise.resolve(null)
  } else if (delayHelper) {
    window.__startersWorkflowDiagnosticsReady = new Promise((resolve) => { resolveHelper = resolve })
  } else {
    new vm.Script(helperSource).runInContext(context)
  }
  new vm.Script(source).runInContext(context)
  return {
    error, form, observers, redirects, success, trigger, window,
    resolveHelper: delayHelper ? () => {
      new vm.Script(helperSource).runInContext(context)
      resolveHelper(window.StartersWorkflowDiagnostics)
    } : null,
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('human click plus authored success records a terminal receipt without page diagnostics', async () => {
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
  assert.equal(page.success.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.doesNotMatch(page.success.textContent || '', /Diagnostic ID:/)
})

test('authored success routes to Starter Onboarding after the clean success state', async () => {
  const page = boot()
  page.trigger.dispatch('click')
  await tick()
  page.success.style.display = 'block'
  page.observers[0].callback()
  assert.deepEqual(page.redirects, [])
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.deepEqual(page.redirects, ['/starter-onboarding'])
  page.observers[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(page.redirects, ['/starter-onboarding'])
})

test('authored success still routes when diagnostics are unavailable', async () => {
  const page = boot({ helperUnavailable: true })
  page.trigger.dispatch('click')
  await tick()
  page.success.style.display = 'block'
  page.observers[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.deepEqual(page.redirects, ['/starter-onboarding'])
})

test('success state without an authored submit does not route', async () => {
  const page = boot({ helperUnavailable: true })
  page.success.style.display = 'block'
  page.observers[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.deepEqual(page.redirects, [])
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

test('an authored outcome observed before helper readiness is reconciled', async () => {
  const page = boot({ delayHelper: true })
  page.trigger.dispatch('click')
  page.success.style.display = 'block'
  page.observers[0].callback()
  page.resolveHelper()
  await tick()
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('build_profile_submit')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.request_started, true)
})

test('observer leaves the authored click transparent and does not inspect fields', async () => {
  const page = boot()
  Object.defineProperties(page.trigger, {
    value: { get() { throw new Error('field value read') } },
    files: { get() { throw new Error('field files read') } },
  })
  page.window.fetch = () => { throw new Error('request sent') }
  assert.doesNotThrow(() => page.trigger.dispatch('click', {
    preventDefault() { throw new Error('click intercepted') },
    stopPropagation() { throw new Error('click propagation stopped') },
  }))
  await tick()
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('build_profile_submit').result, 'started')
})
