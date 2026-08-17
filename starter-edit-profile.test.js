const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-edit-profile.js'), 'utf8')
const diagnosticSource = fs.readFileSync(require.resolve('./utils/workflow-diagnostics.js'), 'utf8')

class Target {
  constructor() {
    this.listeners = new Map()
    this.style = {}
    this.dataset = {}
    this.attributes = new Map()
    this.textContent = ''
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event) {
    return Promise.all((this.listeners.get(event.type) || []).map((listener) => listener(event)))
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
}

function createEnvironment(fetchImpl, {
  browserGlobal = false,
  modalApi = true,
  stepIndex = 1,
  workflowDiagnostics = false,
  workflowDiagnosticsReady = null,
  setTimeoutImpl = () => 1,
  documentReadyState = 'loading',
  notifyCurrentMemberOnAuthSubscribe = false,
} = {}) {
  const domReady = []
  const modalEvents = { success: 0, error: 0 }
  const modalApiCalls = []
  const memberAuthUpdates = []
  const memberUpdates = []
  const authChangeListeners = []
  const tracked = []
  const copied = []
  const requests = []
  const fields = {
    email: Object.assign(new Target(), {
      value: 'new@example.com',
      required: true,
      disabled: false,
      checkValidity: () => true,
    }),
    phone: Object.assign(new Target(), {
      value: '+15555555555',
      required: true,
      disabled: false,
      checkValidity: () => true,
    }),
  }
  const buttonText = { textContent: 'Submit' }
  const button = new Target()
  const step = Object.assign(new Target(), { dataset: { index: String(stepIndex) } })
  const form = new Target()
  const counter = new Target()
  const counterInput = Object.assign(new Target(), {
    value: 'Profile',
    maxLength: 80,
    selectionStart: 7,
    selectionEnd: 7,
    classList: {
      values: new Set(),
      add(value) { this.values.add(value) },
      contains(value) { return this.values.has(value) },
    },
  })
  const counterWrapper = new Target()
  counterWrapper.querySelector = (selector) => selector === '.count-input' ? counter : null
  counterInput.closest = (selector) => selector === '.form_input-wr' ? counterWrapper : null

  button.closest = () => step
  button.querySelectorAll = (selector) => selector === '.button_main-text' ? [buttonText] : []
  step.querySelector = (selector) => selector === '[data-edit-submit]' ? button : null
  step.querySelectorAll = (selector) => selector === 'input, select, textarea'
    ? Object.values(fields)
    : []
  form.querySelector = () => null
  form.querySelectorAll = () => []
  form.formValues = [
    ['email', fields.email.value],
    ['phone', fields.phone.value],
    ...(stepIndex === 2 ? [['tagline', 'Product strategist']] : []),
    ...(stepIndex === 5 ? [['skill-option', 'Research']] : []),
    ...(stepIndex === 6 ? [['rate', '125']] : []),
    ...(stepIndex === 7 ? [
      ['reviewer', JSON.stringify({
        fname: 'Owned',
        lname: 'Reviewer',
        job: 'Founder',
        company: 'QA Company',
        email: 'owned-reviewer@example.com',
      })],
      ['reviewer-2', ''],
      ['reviewer-3', ''],
    ] : []),
  ]

  const successModal = new Target()
  const errorModal = new Target()
  const successFeedback = Object.assign(new Target(), { textContent: 'Your profile was saved.' })
  const errorFeedback = Object.assign(new Target(), { textContent: 'Your profile could not be saved.' })
  const successTarget = new Target()
  const errorTarget = new Target()
  successTarget.querySelector = (selector) => selector === 'p' ? successFeedback : null
  errorTarget.querySelector = (selector) => selector === 'p' ? errorFeedback : null
  successModal.addEventListener('click', () => { modalEvents.success += 1 })
  errorModal.addEventListener('click', () => { modalEvents.error += 1 })

  let domParsed = documentReadyState !== 'loading'
  const document = {
    readyState: documentReadyState,
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') domReady.push(listener)
    },
    querySelector(selector) {
      if (selector === '[build-profile-form]') return form
      if (selector === "[data-modal-trigger='edit-form-success']") return successModal
      if (selector === "[data-modal-trigger='edit-form-error']") return errorModal
      if (selector === '[data-modal-target="edit-form-success"]') return successTarget
      if (selector === '[data-modal-target="edit-form-error"]') return errorTarget
      if (selector === '#email') return fields.email
      if (selector === '#phone' || selector === 'input[name="phone"]') return fields.phone
      if (selector === `[data-form="step"][data-index="${stepIndex}"]`) return step
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-form="step"][data-index]') return [step]
      if (selector === 'input.with-count:not(.initialized), textarea.with-count:not(.initialized)') {
        return domParsed ? [counterInput] : []
      }
      return []
    },
  }

  class FormData {
    constructor(owner) {
      this.values = owner.formValues
    }

    forEach(callback) {
      this.values.forEach(([key, value]) => callback(value, key))
    }
  }

  let currentMember = {
    id: 'mem_test',
    auth: { email: 'old@example.com' },
    customFields: { 'free-user': '', 'last-name': '', phone: fields.phone.value },
  }
  const window = {
    activeProfile: { type: 'full', type_id: 1 },
    MEMBER: currentMember,
    waitProfileData() {},
    waitForMember(callback) { callback(this.MEMBER) },
    clearTimeout() {},
    setTimeout: setTimeoutImpl,
    location: { replace() {}, hostname: 'the-starters-3-0.webflow.io' },
    intlTelInput: Object.assign(() => ({}), { getInstance: () => null }),
    $memberstackDom: {
      async getCurrentMember() { return { data: currentMember } },
      onAuthChange(listener) {
        authChangeListeners.push(listener)
        if (notifyCurrentMemberOnAuthSubscribe) {
          const subscribedMember = currentMember
          Promise.resolve().then(() => listener({ data: subscribedMember }))
        }
      },
      async updateMember(payload) { memberUpdates.push(payload) },
      async updateMemberAuth(payload) { memberAuthUpdates.push(payload) },
    },
    FinsweetAttributes: [],
    Date,
    Math,
    Uint32Array,
    crypto: { randomUUID: () => '12345678-90ab-cdef-1234-567890abcdef' },
    sessionStorage: { setItem() {} },
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    StartersTrack: { track: (name, properties) => tracked.push({ name, properties }) },
    console,
  }
  if (modalApi) {
    window.lumos = {
      modal: {
        open(name) {
          modalApiCalls.push(name)
          if (name === 'edit-form-success') modalEvents.success += 1
          if (name === 'edit-form-error') modalEvents.error += 1
        },
      },
    }
  }
  if (workflowDiagnosticsReady) {
    window.__startersWorkflowDiagnosticsReady = workflowDiagnosticsReady
  }

  const dollar = () => ({ each() {} })
  const sandbox = {
    window,
    document,
    fetch: async (...args) => {
      requests.push(args)
      return fetchImpl(...args)
    },
    FormData,
    Event,
    console,
    Promise,
    Date,
    Math,
    Uint32Array,
    setInterval: () => 1,
    setTimeout: setTimeoutImpl,
    clearInterval() {},
    $: dollar,
  }
  if (browserGlobal) {
    Object.assign(window, sandbox)
    window.window = window
  }
  const context = vm.createContext(browserGlobal ? window : sandbox)
  if (workflowDiagnostics) {
    new vm.Script(diagnosticSource, { filename: 'workflow-diagnostics.js' }).runInContext(context)
  }
  new vm.Script(source, { filename: 'starter-edit-profile.js' }).runInContext(context)
  if (documentReadyState === 'loading') {
    domParsed = true
    domReady.forEach((listener) => listener())
  }

  return {
    button,
    modalEvents,
    modalApiCalls,
    memberAuthUpdates,
    memberUpdates,
    tracked,
    copied,
    requests,
    successFeedback,
    errorFeedback,
    counter,
    counterInput,
    window,
    switchMember(member) {
      currentMember = member
      authChangeListeners.forEach((listener) => listener({ data: member }))
    },
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function submit(environment) {
  return environment.button.dispatchEvent({
    type: 'click',
    preventDefault() {},
  })
}

async function testSuccess() {
  const request = deferred()
  const environment = createEnvironment(() => request.promise)
  const submission = submit(environment)

  assert.equal(environment.button.style.pointerEvents, 'none')
  assert.equal(environment.button.style.opacity, '0.6')

  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true }) })
  await submission

  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
  assert.deepEqual(environment.modalApiCalls, ['edit-form-success'])
  assert.equal(environment.button.style.pointerEvents, '')
  assert.equal(environment.button.style.opacity, '')
  assert.equal(environment.memberAuthUpdates.length, 0)
}

async function testLateLoadInitializesImmediately() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true }),
  }), { documentReadyState: 'complete' })

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
  assert.deepEqual(environment.modalApiCalls, ['edit-form-success'])
}

async function testInitialSameMemberAuthNotificationDoesNotRejectSave() {
  let requests = 0
  const environment = createEnvironment(async () => {
    requests += 1
    return { ok: true, status: 200, json: async () => ({ saved: true }) }
  }, { notifyCurrentMemberOnAuthSubscribe: true })

  await submit(environment)

  assert.equal(requests, 1)
  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
}

async function testEarlyLoadInitializesCountersAfterParsing() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true }),
  }))

  assert.equal(environment.counterInput.classList.contains('initialized'), true)
  assert.equal(environment.counter.textContent, '07')
}

async function testNon2xx() {
  const environment = createEnvironment(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: 'failed' }),
  }))

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.deepEqual(environment.modalApiCalls, ['edit-form-error'])
  assert.equal(environment.button.style.pointerEvents, '')
  assert.equal(environment.button.style.opacity, '')
}

async function testEveryOwnedSectionOpensSuccessModal() {
  for (const stepIndex of [2, 5, 6, 7]) {
    const environment = createEnvironment(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ saved: true }),
    }), { stepIndex })

    await submit(environment)

    assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
    assert.deepEqual(environment.modalApiCalls, ['edit-form-success'])
  }
}

async function testReviewerStepUsesCanonicalBuildProfileShape() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true }),
  }), { stepIndex: 7 })

  await submit(environment)

  assert.equal(environment.requests.length, 1)
  const [, options] = environment.requests[0]
  const payload = JSON.parse(options.body)
  assert.deepEqual(payload.Reviewers, {
    'reviewer-1': {
      'first-name': 'Owned',
      'last-name': 'Reviewer',
      position: 'Founder',
      company: 'QA Company',
      email: 'owned-reviewer@example.com',
    },
    'reviewer-2': null,
    'reviewer-3': null,
  })
  assert.equal(payload.Profile_Type, 'full')
  assert.equal(payload.Profile_Type_ID, 1)
  assert.equal(typeof payload.Updated_On, 'number')
  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
}

async function testReviewerFieldIsOmittedWhenNativeStepIsAbsent() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true }),
  }))

  await submit(environment)

  const [, options] = environment.requests[0]
  const payload = JSON.parse(options.body)
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'Reviewers'), false)
}

async function testRejectedFetch() {
  const environment = createEnvironment(async () => {
    throw new TypeError('network failure')
  })

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.deepEqual(environment.modalApiCalls, ['edit-form-error'])
  assert.equal(environment.button.style.pointerEvents, '')
  assert.equal(environment.button.style.opacity, '')
}

async function testBrowserGlobalDoesNotRecurse() {
  const environment = createEnvironment(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: 'failed' }),
  }), { browserGlobal: true })

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.deepEqual(environment.modalApiCalls, ['edit-form-error'])
}

async function testHiddenTriggerFallback() {
  const successEnvironment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true }),
  }), { modalApi: false })
  await submit(successEnvironment)

  assert.deepEqual(successEnvironment.modalEvents, { success: 1, error: 0 })
  assert.deepEqual(successEnvironment.modalApiCalls, [])

  const errorEnvironment = createEnvironment(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: 'failed' }),
  }), { modalApi: false })
  await submit(errorEnvironment)

  assert.deepEqual(errorEnvironment.modalEvents, { success: 0, error: 1 })
  assert.deepEqual(errorEnvironment.modalApiCalls, [])
}

async function testPrivacySafeDiagnostics() {
  const environment = createEnvironment(async () => ({
    ok: false,
    status: 422,
    json: async () => ({ message: 'Rejected private@example.com profile' }),
  }), { workflowDiagnostics: true })

  await submit(environment)

  const receipt = environment.window.__startersWorkflowDiagnosticLast
  assert.equal(receipt.workflow, 'starter_profile_edit')
  assert.equal(receipt.result, 'failed')
  assert.equal(receipt.error_code, 'HTTP_ERROR')
  assert.equal(receipt.http_status, 422)
  assert.equal(environment.errorFeedback.textContent, 'Your profile could not be saved.')
  assert.equal(environment.errorFeedback.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.doesNotMatch(JSON.stringify(receipt), /private@example\.com|new@example\.com|\+15555555555/)
  assert.deepEqual(
    environment.tracked.map((event) => event.name),
    ['workflow_form_submit_started', 'workflow_form_submit_failed'],
  )
}

async function testStalledDiagnosticsFailOpen() {
  let requests = 0
  const environment = createEnvironment(async () => {
    requests += 1
    return { ok: true, status: 200, json: async () => ({ saved: true }) }
  }, {
    workflowDiagnosticsReady: new Promise(() => {}),
    setTimeoutImpl: (callback, ms) => ms === 2000 ? setImmediate(callback) : 1,
  })

  await submit(environment)

  assert.equal(requests, 1)
  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
}

async function testAuthSwitchDuringDiagnosticsDoesNotWrite() {
  const diagnosticsReady = deferred()
  let requests = 0
  const environment = createEnvironment(async () => {
    requests += 1
    return { ok: true, status: 200, json: async () => ({ saved: true }) }
  }, {
    workflowDiagnosticsReady: diagnosticsReady.promise,
    setTimeoutImpl: (callback, ms) => (ms === 2000 ? 1 : setImmediate(callback)),
  })

  const submission = submit(environment)
  await new Promise(setImmediate)
  environment.switchMember({
    id: 'mem_other',
    auth: { email: 'other@example.com' },
    customFields: {},
  })
  diagnosticsReady.resolve(null)
  await submission

  assert.equal(requests, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.equal(environment.button.style.pointerEvents, '')
  assert.equal(environment.button.style.opacity, '')
}

async function testAuthSwitchAfterPatchDoesNotProjectToNewSession() {
  const request = deferred()
  const environment = createEnvironment(() => request.promise)
  environment.window.MEMBER.customFields.phone = ''
  const submission = submit(environment)
  await new Promise(setImmediate)

  environment.switchMember({
    id: 'mem_other',
    auth: { email: 'other@example.com' },
    customFields: {},
  })
  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true }) })
  await submission

  assert.equal(environment.memberUpdates.length, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
}

async function testLogoutAndSameMemberReauthenticationInvalidatesSave() {
  const request = deferred()
  const environment = createEnvironment(() => request.promise)
  const originalMember = environment.window.MEMBER
  originalMember.customFields.phone = ''
  const submission = submit(environment)
  await new Promise(setImmediate)

  environment.switchMember(null)
  environment.switchMember(originalMember)
  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true }) })
  await submission

  assert.equal(environment.memberUpdates.length, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
}

Promise.all([
  testSuccess(),
  testLateLoadInitializesImmediately(),
  testInitialSameMemberAuthNotificationDoesNotRejectSave(),
  testEarlyLoadInitializesCountersAfterParsing(),
  testNon2xx(),
  testEveryOwnedSectionOpensSuccessModal(),
  testReviewerStepUsesCanonicalBuildProfileShape(),
  testReviewerFieldIsOmittedWhenNativeStepIsAbsent(),
  testRejectedFetch(),
  testBrowserGlobalDoesNotRecurse(),
  testHiddenTriggerFallback(),
  testPrivacySafeDiagnostics(),
  testStalledDiagnosticsFailOpen(),
  testAuthSwitchDuringDiagnosticsDoesNotWrite(),
  testAuthSwitchAfterPatchDoesNotProjectToNewSession(),
  testLogoutAndSameMemberReauthenticationInvalidatesSave(),
])
  .then(() => console.log('starter-edit-profile tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
