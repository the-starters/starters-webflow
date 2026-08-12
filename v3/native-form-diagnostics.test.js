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
  done.style.display = 'none'
  fail.style.display = 'none'
  memberstackDone.style.display = 'none'
  memberstackFail.style.display = 'none'
  const wrapper = new Element({ class: 'w-form' })
  wrapper.querySelector = (selector) => {
    if (selector === '.w-form-done') return done
    if (selector === '.w-form-fail') return fail
    if (selector === '[data-ms-message="success"]') return memberstackDone
    if (selector === '[data-ms-message="error"]') return memberstackFail
    return null
  }
  for (const state of [done, fail, memberstackDone, memberstackFail]) {
    state.querySelector = () => null
  }
  const form = new Element({ 'data-ms-form': kind })
  form.id = options.id || ''
  form.checkValidity = () => options.valid !== false
  form.closest = (selector) => (selector === '.w-form' ? wrapper : null)
  return { done, fail, form, memberstackDone, memberstackFail, wrapper }
}

function boot({ kind = 'login', pathname = '/login', valid = true, id = '' } = {}) {
  const parts = formHarness(kind, { valid, id })
  const observers = []
  let authListener = null
  const session = new Map()
  const fetchCalls = []
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
    MutationObserver,
    clearTimeout,
    console: { info() {} },
    crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789012' },
    Date,
    document,
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
  new vm.Script(helperSource, { filename: 'workflow-diagnostics.js' }).runInContext(context)
  new vm.Script(source, { filename: 'native-form-diagnostics.js' }).runInContext(context)
  return {
    ...parts,
    auth: (payload) => authListener && authListener(payload),
    observers,
    fetchCalls,
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
  assert.match(page.done.textContent, /Diagnostic ID:/)
})

test('native Account Profile save decorates its authored Memberstack status', async () => {
  const page = boot({ kind: 'profile', id: 'wf-form-Account-Profile' })
  page.form.dispatch('submit')
  await tick()
  page.memberstackDone.style.display = 'block'
  page.observers[0].callback()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('account_profile')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.resource_type, 'member_account')
  assert.equal(
    page.memberstackDone.getAttribute('data-workflow-diagnostic-copy'),
    'account_profile',
  )
  assert.match(page.memberstackDone.textContent, /Diagnostic ID:/)
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

test('an existing Webflow error becomes a copy target without creating markup', async () => {
  const page = boot({ kind: 'forgot-password', pathname: '/forgot-password' })
  page.form.dispatch('submit')
  await tick()
  page.fail.style.display = 'block'
  page.observers[0].callback()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('password_forgot')
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.request_started, true)
  assert.equal(page.fail.getAttribute('data-workflow-diagnostic-copy'), 'password_forgot')
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

test('the observer never reads input values or intercepts native submission', () => {
  assert.equal(/\.value\b/.test(source), false)
  assert.equal(/preventDefault\s*\(/.test(source), false)
  assert.equal(/fetch\s*\(/.test(source), false)
  assert.equal(/innerHTML|insertAdjacentHTML/.test(source), false)
})

test('profile mutation fetch outcomes are recorded without request or response data', async () => {
  const page = boot()
  const response = await page.window.fetch(
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
    {
      method: 'POST',
      body: JSON.stringify({ email: 'private@example.com', company: 'Private Co' }),
    },
  )
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('company_experience_create')
  assert.equal(response.ok, true)
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.http_status, 200)
  assert.equal(receipt.resource_type, 'talent_company_experience')
  assert.equal(JSON.stringify(receipt).includes('private@example.com'), false)
  assert.equal('body' in receipt, false)
})

test('profile mutation observation requires the exact canonical endpoint and method', () => {
  const page = boot()
  const cases = [
    ['/api:KZf7nFnk/build_profile/starter/profile_image', 'POST', 'profile_photo_xano_upload'],
    ['/api:PmBJV0AG/Create_portfolio', 'POST', 'portfolio_record_create'],
    ['/api:PmBJV0AG/Update_portfolio/17', 'PATCH', 'portfolio_record_update'],
    ['/api:PmBJV0AG/Delete_portfolio/17', 'DELETE', 'portfolio_record_delete'],
    ['/api:PmBJV0AG/upload-image', 'POST', 'portfolio_image_upload'],
    ['/api:PmBJV0AG/Add_portfolio_image', 'POST', 'portfolio_image_attach'],
    ['/api:PmBJV0AG/upload-video', 'POST', 'portfolio_video_upload'],
    ['/api:PmBJV0AG/Add_portfolio_video', 'POST', 'portfolio_video_attach'],
    ['/api:PmBJV0AG/Delete_portfolio_image/17', 'DELETE', 'portfolio_image_delete'],
    ['/api:PmBJV0AG/Delete_portfolio_video/17', 'DELETE', 'portfolio_video_delete'],
    ['/api:SYL06lUR/companies', 'POST', 'company_experience_create'],
    ['/api:SYL06lUR/companies/17', 'PATCH', 'company_experience_update'],
    ['/api:SYL06lUR/companies/17', 'DELETE', 'company_experience_delete'],
    ['/api:KZf7nFnk/starter/set_also_worked_with', 'POST', 'company_experience_associations'],
  ]

  for (const [pathname, method, workflow] of cases) {
    const url = `https://x08a-5ko8-jj1r.n7c.xano.io${pathname}`
    assert.equal(page.window.StartersNativeFormDiagnostics.observedFetch(url, method).workflow, workflow)
    assert.equal(page.window.StartersNativeFormDiagnostics.observedFetch(url, 'GET'), null)
    assert.equal(
      page.window.StartersNativeFormDiagnostics.observedFetch(`https://example.com${pathname}`, method),
      null,
    )
  }
})

test('profile mutation HTTP failures remain transparent to the caller', async () => {
  const page = boot()
  const response = await page.window.fetch(
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Create_portfolio',
    { method: 'POST', testOk: false, testStatus: 422 },
  )
  await tick()
  const receipt = page.window.StartersWorkflowDiagnostics.latest('portfolio_record_create')
  assert.equal(response.status, 422)
  assert.equal(receipt.result, 'failure')
  assert.equal(receipt.error_code, 'HTTP_ERROR')
  assert.equal(receipt.http_status, 422)
})

test('unrelated and read-only fetches bypass diagnostics', async () => {
  const page = boot()
  await page.window.fetch(
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
    { method: 'GET' },
  )
  await tick()
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('company_experience_create'), null)
  await page.window.fetch(
    'https://example.com/api:SYL06lUR/companies',
    { method: 'POST' },
  )
  await tick()
  assert.equal(page.window.StartersWorkflowDiagnostics.latest('company_experience_create'), null)
  assert.equal(page.fetchCalls.length, 2)
})
