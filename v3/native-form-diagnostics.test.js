const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const helperSource = fs.readFileSync(
  path.join(__dirname, '../utils/workflow-diagnostics.js'),
  'utf8',
)
const source = fs.readFileSync(
  path.join(__dirname, 'native-form-diagnostics.js'),
  'utf8',
)

class Element {
  constructor(attributes = {}) {
    this.attributes = { ...attributes }
    this.listeners = {}
    this.hidden = false
    this.style = { display: '' }
    this.textContent = ''
    this.children = []
  }

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node))
  }

  addEventListener(type, listener) {
    ;(this.listeners[type] ||= []).push(listener)
  }

  dispatch(type, extra = {}) {
    const event = { type, key: '', preventDefault() {}, ...extra }
    for (const listener of this.listeners[type] || []) listener(event)
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }
}

function formHarness(kind, options = {}) {
  const done = new Element()
  const fail = new Element()
  const memberstackDone = new Element({ 'data-ms-message': 'success' })
  const memberstackFail = new Element({ 'data-ms-message': 'error' })
  const provider = new Element({ 'data-ms-auth-provider': 'google' })
  done.style.display = 'none'
  fail.style.display = 'none'
  memberstackDone.style.display = 'none'
  memberstackFail.style.display = 'none'
  let form = null
  const wrapper = new Element({ class: 'w-form' })
  wrapper.querySelector = (selector) => {
    if (selector === '.w-form-done') return done
    if (selector === '.w-form-fail') return fail
    if (selector === '[data-ms-message="success"]') return memberstackDone
    if (selector === '[data-ms-message="error"]') return memberstackFail
    if (selector.includes('data-ms-form') || selector.includes('wf-form-')) return form
    return null
  }
  for (const state of [done, fail, memberstackDone]) {
    state.querySelector = () => null
  }
  const memberstackFailText = new Element({ 'data-ms-message-text': '' })
  memberstackFail.children.push(memberstackFailText)
  memberstackFail.querySelector = (selector) =>
    selector === '[data-ms-message-text]' ? memberstackFailText : null
  provider.closest = (selector) => {
    if (selector === '[data-ms-auth-provider]') return provider
    if (selector === '.w-form') return wrapper
    return null
  }
  wrapper.children.push(provider)
  form = new Element({ 'data-ms-form': kind })
  form.id = options.id || ''
  form.checkValidity = () => options.valid !== false
  form.closest = (selector) => (selector === '.w-form' ? wrapper : null)
  return { done, fail, form, memberstackDone, memberstackFail, memberstackFailText, provider, wrapper }
}

function boot({ kind = 'login', pathname = '/login', valid = true, id = '', delayHelper = false, routeGuard = null } = {}) {
  const parts = formHarness(kind, { valid, id })
  const observers = []
  let authListener = null
  const session = new Map()
  const fetchCalls = []
  const tracked = []
  const windowListeners = {}
  const memberstack = {
    getCurrentMember: async () => ({ data: null }),
    onAuthChange(listener) {
      authListener = listener
    },
  }
  const document = {
    currentScript: {
      src: 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/v3/native-form-diagnostics.js',
    },
    readyState: 'complete',
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement: () => new Element(),
    querySelectorAll: (selector) => selector.includes('data-ms-form') ? [parts.form] : [],
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }
    observe() {}
  }
  const window = {
    $memberstackDom: memberstack,
    StartersTrack: { track: (name, properties) => tracked.push({ name, properties }) },
    StartersV3RouteGuard: routeGuard,
    MutationObserver,
    clearTimeout,
    console: { info() {} },
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    Date,
    document,
    addEventListener: (type, listener) => {
      ;(windowListeners[type] ||= []).push(listener)
    },
    dispatch: (type, extra = {}) => {
      const event = { type, target: parts.provider, preventDefault() {}, ...extra }
      for (const listener of windowListeners[type] || []) listener(event)
      return event
    },
    fetch: async (input, init = {}) => {
      fetchCalls.push({ input, init })
      return { ok: init.testOk !== false, status: init.testStatus || 200 }
    },
    getComputedStyle: (element) => ({
      display: element.style.display || 'block',
      visibility: 'visible',
    }),
    location: { hostname: 'the-starters-3-0.webflow.io', pathname },
    navigator: {},
    sessionStorage: {
      getItem: (key) => session.get(key) || null,
      setItem: (key, value) => session.set(key, value),
    },
    setTimeout,
  }
  const context = vm.createContext({
    Array,
    Date,
    Math,
    MutationObserver,
    Promise,
    Uint32Array,
    URL,
    clearTimeout,
    console: window.console,
    document,
    setTimeout,
    window,
  })
  let resolveHelper = null
  if (delayHelper) {
    window.__startersWorkflowDiagnosticsReady = new Promise((resolve) => { resolveHelper = resolve })
  } else {
    new vm.Script(helperSource, { filename: 'workflow-diagnostics.js' }).runInContext(context)
  }
  new vm.Script(source, { filename: 'native-form-diagnostics.js' }).runInContext(context)
  return {
    ...parts,
    auth: (payload) => authListener && authListener(payload),
    observers,
    fetchCalls,
    tracked,
    resolveHelper: delayHelper ? () => {
      new vm.Script(helperSource, { filename: 'workflow-diagnostics.js' }).runInContext(context)
      resolveHelper(window.StartersWorkflowDiagnostics)
    } : null,
    window,
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('maps native auth forms to stable privacy-safe workflow names', () => {
  const brand = boot({ kind: 'login', pathname: '/login' })
  const talent = boot({ kind: 'login', pathname: '/starter-login' })
  const quiz = boot({ kind: 'signup', pathname: '/quiz' })
  const forgot = boot({ kind: 'forgot-password', pathname: '/forgot-password' })
  assert.equal(brand.window.StartersNativeFormDiagnostics.workflowFor(brand.form), 'brand_login')
  assert.equal(talent.window.StartersNativeFormDiagnostics.workflowFor(talent.form), 'talent_login')
  assert.equal(quiz.window.StartersNativeFormDiagnostics.workflowFor(quiz.form), 'quiz_signup')
  assert.equal(forgot.window.StartersNativeFormDiagnostics.workflowFor(forgot.form), 'password_forgot')
})

test('pause and cancel are diagnosed as request intake, not membership mutations', async () => {
  const page = boot({ kind: '', id: 'wf-form-Pause-Membership' })
  page.form.dispatch('submit')
  await tick()
  page.done.style.display = 'block'
  page.observers[0].callback()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('pause_membership_request')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.stage, 'request_accepted')
  assert.equal(receipt.resource_type, 'support_request')
  assert.equal(receipt.resource_id, '')
  assert.doesNotMatch(page.done.textContent, /Diagnostic ID:/)
  assert.equal(page.done.getAttribute('data-workflow-diagnostic-copy'), null)
})

test('native Account Profile save keeps diagnostics out of its authored Memberstack status', async () => {
  const page = boot({ kind: 'profile', id: 'wf-form-Account-Profile' })
  page.form.dispatch('submit')
  await tick()
  page.memberstackDone.style.display = 'block'
  page.observers[0].callback()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('account_profile')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.resource_type, 'member_account')
  assert.equal(page.memberstackDone.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.doesNotMatch(page.memberstackDone.textContent, /Diagnostic ID:/)
})

test('a valid human submit records only a started receipt until an observed outcome', async () => {
  const page = boot({ kind: 'login' })
  page.form.dispatch('submit')
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('brand_login')
  assert.equal(receipt.result, 'started')
  assert.equal(receipt.request_started, false)
  assert.equal(receipt.resource_type, 'member_account')
  assert.equal(JSON.stringify(receipt).includes('email'), false)
})

test('native invalid events record truthful no-request validation failures', async () => {
  const page = boot({ kind: 'reset-password', pathname: '/reset-password', valid: false })
  page.form.dispatch('invalid')
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('password_reset')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.stage, 'validation')
  assert.equal(receipt.error_code, 'FORM_VALIDATION')
  assert.equal(receipt.request_started, false)
})

test('an existing Webflow error stays free of diagnostic copy behavior', async () => {
  const page = boot({ kind: 'forgot-password', pathname: '/forgot-password' })
  page.form.dispatch('submit')
  await tick()
  page.fail.style.display = 'block'
  page.observers[0].callback()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('password_forgot')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.request_started, true)
  assert.equal(page.fail.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.doesNotMatch(page.fail.textContent, /Diagnostic ID:/)
})

test('a logged-out to logged-in transition completes the pending login once', async () => {
  const page = boot({ kind: 'login' })
  await tick()
  page.form.dispatch('submit')
  await tick()
  page.auth({ data: { id: 'member_test' } })
  const receipt = page.window.StartersWorkflowDiagnostics.latest('brand_login')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.request_started, true)
  assert.equal(receipt.resource_id, '')
})

test('an authored outcome observed before helper readiness is reconciled', async () => {
  const page = boot({ kind: 'forgot-password', delayHelper: true })
  page.form.dispatch('submit')
  page.fail.style.display = 'block'
  page.observers[0].callback()
  page.resolveHelper()
  await tick()
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('password_forgot')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.request_started, true)
})

test('native submission remains transparent and does not inspect form data', async () => {
  const page = boot({ kind: 'login' })
  Object.defineProperties(page.form, {
    value: { get() { throw new Error('form value read') } },
    elements: { get() { throw new Error('form elements read') } },
    innerHTML: { get() { throw new Error('form HTML read') } },
  })
  assert.doesNotThrow(() => page.form.dispatch('submit', {
    preventDefault() { throw new Error('submission intercepted') },
  }))
  await tick()
  assert.equal(page.fetchCalls.length, 0)
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('brand_login').result, 'started')
})

test('explicit profile mutation outcomes are recorded without transport inspection', async () => {
  const page = boot()
  const privateTransport = {
    get url() { throw new Error('URL inspected') },
    get body() { throw new Error('body inspected') },
  }
  const response = await page.window.StartersNativeFormDiagnostics.observeMutation(
    'company_experience_create',
    () => {
      assert.equal(privateTransport instanceof Object, true)
      return { ok: true, status: 200 }
    },
  )
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('company_experience_create')
  assert.equal(response.ok, true)
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.http_status, 200)
  assert.equal(receipt.resource_type, 'talent_company_experience')
  assert.equal(response.ok, true)
  assert.equal('body' in receipt, false)
})

test('profile mutation observation accepts only allowlisted operations', async () => {
  const page = boot()
  let calls = 0
  await page.window.StartersNativeFormDiagnostics.observeMutation('unrelated_read', () => {
    calls += 1
    return { ok: true, status: 200 }
  })
  await tick()
  assert.equal(calls, 1)
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('unrelated_read'), null)
})

test('profile mutation HTTP failures remain transparent to the caller', async () => {
  const page = boot()
  const response = await page.window.StartersNativeFormDiagnostics.observeMutation(
    'portfolio_record_create',
    () => ({ ok: false, status: 422 }),
  )
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('portfolio_record_create')
  assert.equal(response.status, 422)
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.error_code, 'HTTP_ERROR')
  assert.equal(receipt.http_status, 422)
})

function showError(page, text) {
  page.memberstackFailText.textContent = text
  page.memberstackFail.style.display = 'block'
  page.observers[0].callback([{ target: page.memberstackFailText }])
}

function clickProvider(page, extra = {}) {
  const event = page.window.dispatch('click', {
    target: page.provider,
    preventDefault() { throw new Error('provider click intercepted') },
    ...extra,
  })
  if (typeof extra.afterWindowCapture === 'function') extra.afterWindowCapture()
  page.wrapper.dispatch('click', event)
}

test('a Memberstack login error records an allowlisted detail and never the message text', async () => {
  const page = boot({ kind: 'login' })
  page.form.dispatch('submit')
  await tick()
  showError(page, 'The provided credentials are invalid.')
  const receipt = page.window.StartersWorkflowDiagnostics.latest('brand_login')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.error_code, 'MEMBERSTACK_FORM_ERROR')
  assert.equal(receipt.error_detail, 'invalid_credentials')
  const failed = page.tracked.find((event) => event.name === 'workflow_form_submit_failed')
  assert.equal(failed.properties.error_detail, 'invalid_credentials')
  assert.doesNotMatch(JSON.stringify(page.tracked), /provided credentials/i)
})

test('Google-click and unknown Memberstack messages map to fixed codes', async () => {
  const google = boot({ kind: 'login' })
  google.form.dispatch('submit')
  await tick()
  showError(google, 'Please login with your email.')
  assert.equal(google.window.StartersWorkflowDiagnostics.latest('brand_login').error_detail, 'use_email_login')

  const unknown = boot({ kind: 'login' })
  unknown.form.dispatch('submit')
  await tick()
  showError(unknown, 'Something odd happened for jane@example.com')
  assert.equal(unknown.window.StartersWorkflowDiagnostics.latest('brand_login').error_detail, 'other')
  assert.doesNotMatch(JSON.stringify(unknown.tracked), /jane@example\.com|odd/)
})

test('a Google provider click starts tracking so the email-login error is recorded', async () => {
  const page = boot({ kind: 'login' })
  assert.doesNotThrow(() => clickProvider(page))
  await tick()
  showError(page, 'Please login with your email.')
  const receipt = page.window.StartersWorkflowDiagnostics.latest('brand_login')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.error_code, 'MEMBERSTACK_FORM_ERROR')
  assert.equal(receipt.error_detail, 'use_email_login')
  assert.equal(page.tracked.some((event) => event.name === 'workflow_form_submit_started'), true)
  assert.equal(page.fetchCalls.length, 0)
})

test('a Google provider click snapshots before Memberstack document capture renders an error', async () => {
  const page = boot({ kind: 'login' })
  clickProvider(page, {
    afterWindowCapture() {
      page.memberstackFailText.textContent = 'Please login with your email.'
      page.memberstackFail.style.display = 'block'
    },
  })
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('brand_login')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.error_detail, 'use_email_login')
  assert.equal(page.tracked.some((event) => event.name === 'workflow_form_submit_failed'), true)
})

test('a provider click treats a pre-visible Memberstack error as stale', async () => {
  const page = boot({ kind: 'login' })
  await tick()
  page.memberstackFailText.textContent = 'Please login with your email.'
  page.memberstackFail.style.display = 'block'
  clickProvider(page)
  await tick()
  page.observers[0].callback([{ target: page.wrapper }])
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('brand_login').result, 'started')
  page.auth({ data: { id: 'mem_test' } })
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('brand_login').result, 'success')
  assert.equal(page.tracked.some((event) => event.name === 'workflow_form_submit_failed'), false)
})

test('a banner still visible from the previous submit is not counted, and a later login succeeds', async () => {
  const page = boot({ kind: 'login' })
  await tick()
  page.memberstackFailText.textContent = 'The provided credentials are invalid.'
  page.memberstackFail.style.display = 'block'
  page.form.dispatch('submit')
  await tick()
  page.observers[0].callback([{ target: page.wrapper }])
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('brand_login').result, 'started')
  page.auth({ data: { id: 'mem_test' } })
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('brand_login').result, 'success')
  assert.equal(page.tracked.some((event) => event.name === 'workflow_form_submit_failed'), false)
})

test('a new error written into the still-visible banner after submit is counted once', async () => {
  const page = boot({ kind: 'login' })
  page.memberstackFailText.textContent = 'The provided credentials are invalid.'
  page.memberstackFail.style.display = 'block'
  page.form.dispatch('submit')
  await tick()
  showError(page, 'The provided credentials are invalid.')
  showError(page, 'The provided credentials are invalid.')
  const failures = page.tracked.filter((event) => event.name === 'workflow_form_submit_failed')
  assert.equal(failures.length, 1)
  assert.equal(failures[0].properties.error_detail, 'invalid_credentials')
})

test('a stale banner that hides and shows again during the submit is counted', async () => {
  const page = boot({ kind: 'login' })
  page.memberstackFail.style.display = 'block'
  page.form.dispatch('submit')
  await tick()
  page.memberstackFail.style.display = 'none'
  page.observers[0].callback([{ target: page.memberstackFail }])
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('brand_login').result, 'started')
  page.memberstackFail.style.display = 'block'
  page.observers[0].callback([{ target: page.memberstackFail }])
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('brand_login').result, 'failure')
})

test('a successful login records the role the route guard derives from the on-page member', async () => {
  const seen = []
  const page = boot({
    kind: 'login',
    routeGuard: { memberRole: (member) => { seen.push(member.id); return 'talent' } },
  })
  await tick()
  page.form.dispatch('submit')
  await tick()
  page.auth({ data: { id: 'mem_test' } })
  const receipt = page.window.StartersWorkflowDiagnostics.latest('brand_login')
  assert.equal(receipt.member_role, 'talent')
  assert.deepEqual(seen, ['mem_test'])
  assert.equal(page.fetchCalls.length, 0)
})

test('a missing or failing route guard leaves member role empty without breaking success', async () => {
  const page = boot({
    kind: 'login',
    routeGuard: { memberRole: () => { throw new Error('guard failed') } },
  })
  await tick()
  page.form.dispatch('submit')
  await tick()
  page.auth({ data: { id: 'mem_test' } })
  const receipt = page.window.StartersWorkflowDiagnostics.latest('brand_login')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.member_role, '')
})
