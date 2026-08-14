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

function boot({
  delayHelper = false,
  helperUnavailable = false,
  legacyMutatingHelper = false,
  ctaHref = '/starter-onboarding',
  hostname = 'the-starters-3-0.webflow.io',
  debug = undefined,
} = {}) {
  const form = new Element({ 'build-profile-form': '' })
  const trigger = new Element({ 'form-submit': '' })
  const success = new Element({ 'build-profile-success': '' })
  const error = new Element({ 'build-profile-error': '' })
  const successInner = new Element()
  const successHeading = new Element()
  const successBody = new Element()
  const successLink = new Element(ctaHref === null ? {} : { href: ctaHref })
  successHeading.textContent = 'Thanks John'
  successBody.textContent = 'Your profile is now live on The Starters. Complete onboarding to access your dashboard.'
  successLink.textContent = 'Start onboarding'
  successInner.children = [successHeading, successBody, successLink]
  successInner.textContent = 'Authored success structure'
  success.style.display = 'none'
  error.style.display = 'none'
  form.querySelector = (selector) => selector === '[form-submit]' ? trigger : null
  success.querySelector = (selector) => (
    selector === '[data-workflow-diagnostic-message], p, div' ? successInner : null
  )
  success.querySelectorAll = (selector) => (
    selector === 'a[href]' && ctaHref !== null ? [successLink] : []
  )
  error.querySelector = () => null
  form.parentElement = new Element()
  const observers = []
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this) }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  const session = new Map()
  const redirects = []
  const warnings = []
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
  // Every route a browser has out of this page records into `redirects`, so a
  // navigation regression fails a test instead of silently passing one.
  const location = {
    hostname,
    pathname: '/build-profile/consult',
    replace: (url) => redirects.push(url),
    assign: (url) => redirects.push(url),
    set href(url) { redirects.push(url) },
  }
  const window = {
    Date,
    MutationObserver,
    clearTimeout,
    console: { info() {}, warn: (message) => warnings.push(message) },
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    document,
    getComputedStyle: (element) => ({ display: element.style.display || 'block', visibility: 'visible' }),
    navigator: {},
    open: (url) => { redirects.push(url) },
    sessionStorage: {
      getItem: (key) => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
    },
    setTimeout,
  }
  if (debug !== undefined) window.STARTERS_DEBUG = debug
  // Assigning the whole object (`window.location = path`) is the regression the
  // property-level traps above cannot see, so it gets its own setter.
  Object.defineProperty(window, 'location', {
    get: () => location,
    set: (value) => { redirects.push(String(value)) },
  })
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
    if (legacyMutatingHelper) {
      window.StartersWorkflowDiagnostics.message = () => ({ diagnostic_id: 'structured-success' })
      window.StartersWorkflowDiagnostics.decorate = (element) => {
        element.textContent = 'Diagnostic ID: structured-success'
        return true
      }
    }
  }
  new vm.Script(source).runInContext(context)
  return {
    error, form, observers, redirects, success, successInner, successHeading,
    successBody, successLink, trigger, warnings, window,
    resolveHelper: delayHelper ? () => {
      new vm.Script(helperSource).runInContext(context)
      resolveHelper(window.StartersWorkflowDiagnostics)
    } : null,
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
// A macrotask beat, for the assertions that claim nothing fires later.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

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
  assert.equal(page.successInner.textContent, 'Authored success structure')
  assert.deepEqual(
    page.successInner.children.map((element) => element.textContent),
    [
      'Thanks John',
      'Your profile is now live on The Starters. Complete onboarding to access your dashboard.',
      'Start onboarding',
    ],
  )
  assert.equal(page.success.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.doesNotMatch(page.success.textContent || '', /Diagnostic ID:/)
})

test('structured-success stays authored when an older helper exposes DOM decoration', async () => {
  const page = boot({ legacyMutatingHelper: true })
  page.trigger.dispatch('click')
  await tick()
  page.success.style.display = 'block'
  page.observers[0].callback()

  assert.equal(page.successInner.textContent, 'Authored success structure')
  assert.deepEqual(
    page.successInner.children.map((element) => element.textContent),
    [
      'Thanks John',
      'Your profile is now live on The Starters. Complete onboarding to access your dashboard.',
      'Start onboarding',
    ],
  )
  assert.doesNotMatch(page.successInner.textContent, /Diagnostic ID:|\[object Object\]/)
})

test('authored success never navigates and leaves the CTA in charge', async () => {
  const page = boot()
  page.trigger.dispatch('click')
  await tick()
  page.success.style.display = 'block'
  page.observers[0].callback()
  assert.deepEqual(page.redirects, [])
  await settle()
  assert.deepEqual(page.redirects, [])
  page.observers[0].callback()
  await settle()
  assert.deepEqual(page.redirects, [])
  const receipt = page.window.StartersWorkflowDiagnostics.latest('build_profile_submit')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.controller_version, 'build-profile-submit-outcome-v3')
})

test('authored success stays silent and inert when diagnostics never load', async () => {
  const page = boot({ helperUnavailable: true })
  assert.doesNotThrow(() => page.trigger.dispatch('click'))
  await tick()
  page.success.style.display = 'block'
  assert.doesNotThrow(() => page.observers[0].callback())
  await settle()
  assert.deepEqual(page.redirects, [])
  assert.equal(page.window.StartersWorkflowDiagnostics, undefined)
})

test('the exported API surface stays exactly what the page contract needs', () => {
  const page = boot()
  assert.deepEqual(
    Object.keys(page.window.StartersBuildProfileSubmitDiagnostics).sort(),
    ['disabled', 'init', 'release', 'visible'],
  )
})

test('the source carries no navigation call of any shape', () => {
  assert.doesNotMatch(source, /location\s*\.\s*(replace|assign)\s*\(/)
  assert.doesNotMatch(source, /location\s*\.\s*href\s*=/)
  assert.doesNotMatch(source, /window\s*\.\s*open\s*\(/)
  assert.doesNotMatch(source, /(window\s*\.)?\blocation\s*=[^=]/)
})

test('the header @release marker matches the exported release property', () => {
  const page = boot()
  const marker = source.match(/^ \* @release (\S+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the submit-diagnostics.js header')
  assert.equal(page.window.StartersBuildProfileSubmitDiagnostics.release, marker[1])
  assert.match(marker[1], /^v(\d+\.\d+\.\d+|X\.Y\.Z)$/)
})

test('success state without an authored submit records nothing and does not navigate', async () => {
  const page = boot()
  page.success.style.display = 'block'
  page.observers[0].callback()
  await tick()
  await settle()
  assert.deepEqual(page.redirects, [])
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('build_profile_submit'), null)
})

test('success is terminal: the observer disconnects and later clicks are ignored', async () => {
  const page = boot()
  page.trigger.dispatch('click')
  await tick()
  page.success.style.display = 'block'
  page.observers[0].callback()
  await tick()
  assert.equal(page.observers[0].disconnected, true)

  // A second submit that FAILS must not inherit the still-visible success state.
  page.trigger.dispatch('click')
  await tick()
  page.error.style.display = 'block'
  page.observers[0].callback()
  await tick()

  const receipt = page.window.StartersWorkflowDiagnostics.latest('build_profile_submit')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.error_code, '')
  assert.deepEqual(page.redirects, [])
})

test('an authored error is not terminal: the retry that succeeds is recorded', async () => {
  const page = boot()
  page.trigger.dispatch('click')
  await tick()
  page.error.style.display = 'block'
  page.observers[0].callback()
  await tick()
  assert.equal(
    page.window.StartersWorkflowDiagnostics.latest('build_profile_submit').result,
    'failure',
  )
  assert.equal(page.observers[0].disconnected, false)

  // The member fixes the form and retries while the stale error is still shown.
  page.trigger.dispatch('click')
  await tick()
  page.observers[0].callback()
  await tick()
  assert.equal(
    page.window.StartersWorkflowDiagnostics.latest('build_profile_submit').result,
    'started',
    'a stale visible error must not be charged to the in-flight retry',
  )

  page.error.style.display = 'none'
  page.success.style.display = 'block'
  page.observers[0].callback()
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('build_profile_submit')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.error_code, '')
  assert.equal(page.observers[0].disconnected, true)
})

test('a missing success-state CTA warns on staging without blocking init', () => {
  const page = boot({ ctaHref: null })
  assert.equal(page.form.getAttribute('data-build-profile-submit-diagnostics'), 'true')
  assert.equal(page.warnings.length, 1)
  assert.match(page.warnings[0], /no link to \/starter-onboarding/)
})

test('an authored success-state CTA is accepted in absolute and trailing-slash form', () => {
  assert.deepEqual(boot({ ctaHref: '/starter-onboarding' }).warnings, [])
  assert.deepEqual(boot({ ctaHref: '/starter-onboarding/' }).warnings, [])
  assert.deepEqual(
    boot({ ctaHref: 'https://www.thestarters.com/starter-onboarding?ref=cta' }).warnings,
    [],
  )
  assert.equal(boot({ ctaHref: '/starter-dashboard' }).warnings.length, 1)
})

test('the missing-CTA warning is silent in production unless STARTERS_DEBUG is on', () => {
  assert.deepEqual(boot({ ctaHref: null, hostname: 'www.thestarters.com' }).warnings, [])
  assert.equal(
    boot({ ctaHref: null, hostname: 'www.thestarters.com', debug: true }).warnings.length,
    1,
  )
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
