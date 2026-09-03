const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-edit-profile.js'), 'utf8')
const diagnosticSource = fs.readFileSync(require.resolve('./utils/workflow-diagnostics.js'), 'utf8')
const publishedContract = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'v3/starter-edit-profile/published-form-contract.json'),
  'utf8',
))

function publishedRequired(stepIndex, id) {
  const step = publishedContract.steps.find(({ index }) => index === String(stepIndex))
  const control = step?.controls.find((candidate) => candidate.id === id)
  assert.ok(control, `published contract step ${stepIndex} must include #${id}`)
  return control.attributes.required === 'required'
}

class Target {
  constructor() {
    this.listeners = new Map()
    this.style = {}
    this.dataset = {}
    this.attributes = new Map()
    this.textContent = ''
    this.focusCount = 0
    this.reportValidityCount = 0
    this.validationMessage = ''
    this.children = []
    this.classNames = new Set()
    this.classList = {
      add: (value) => { this.classNames.add(value) },
      remove: (value) => { this.classNames.delete(value) },
      contains: (value) => this.classNames.has(value),
    }
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
  focus() { this.focusCount += 1 }
  reportValidity() { this.reportValidityCount += 1; return this.checkValidity?.() ?? true }
  setCustomValidity(message) { this.validationMessage = String(message || '') }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child }
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
  initialAuthNotification = undefined,
  memberReadSequence = null,
  profileType = 'full',
  fieldOverrides = {},
  missingSelectors = [],
  requiredCaptureFields = [],
  additionalFormValues = [],
  canonicalPhone = '',
  liveRateFormatter = false,
  simulateProfileHydrationAfterDomReady = false,
  dirtyState = null,
} = {}) {
  const domReady = []
  const profileDataCallbacks = []
  const modalEvents = { success: 0, error: 0 }
  const modalApiCalls = []
  const memberAuthUpdates = []
  const memberUpdates = []
  const authChangeListeners = []
  const tracked = []
  const copied = []
  const requests = []
  function createField(selector, defaults = {}) {
    const field = Object.assign(new Target(), {
      value: '',
      required: false,
      disabled: false,
      valid: true,
    }, defaults, fieldOverrides[selector] || {})
    field.checkValidity = () =>
      field.validationMessage === ''
      && field.valid
      && (!field.required || String(field.value ?? '').trim() !== '')
    const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1]
    if (name) {
      field.name = name
      field.setAttribute('name', name)
    }
    return field
  }

  const globalFields = {
    email: createField('#email', { value: 'new@example.com', required: publishedRequired(1, 'email') }),
    phone: createField('#phone', { value: '+15555555555', required: publishedRequired(1, 'phone') }),
  }
  const selectorsByStep = {
    1: {
      '[name="first-name"]': createField('[name="first-name"]', { value: 'Owned', required: publishedRequired(1, 'first-name') }),
      '[name="last-name"]': createField('[name="last-name"]', { value: 'Starter', required: publishedRequired(1, 'last-name') }),
      '[name="email"]': globalFields.email,
      '[name="phone"]': globalFields.phone,
      '#email': globalFields.email,
      '#phone': globalFields.phone,
      '[name="country"]': createField('[name="country"]', { value: 'US', required: false }),
      '[name="state"]': createField('[name="state"]', { value: '', required: false }),
      '[name="city"]': createField('[name="city"]', { value: '', required: false }),
      '#profile-photo-url': createField('#profile-photo-url', { value: 'https://example.test/profile.jpg' }),
      '#function-required': createField('#function-required', { value: '1' }),
      '#roles-required': createField('#roles-required', { value: '1' }),
      '#subcategories-required': createField('#subcategories-required', { value: '1' }),
    },
    2: {
      '#tagline': createField('#tagline', { value: 'Product strategist', required: publishedRequired(2, 'tagline') }),
      '#pro-headline': createField('#pro-headline', { value: 'Senior product strategist', required: publishedRequired(2, 'pro-headline') }),
      '#bio-html': createField('#bio-html', { value: '<p>Profile biography</p>' }),
    },
    5: {
      '#skills-required': createField('#skills-required', { value: '1' }),
      '#tools-required': createField('#tools-required', { value: '1' }),
    },
    6: {
      '[name="rate"]': createField('[name="rate"]', { value: '125', required: publishedRequired(6, 'rate') }),
      '[name="rate-retainer"]': createField('[name="rate-retainer"]', { value: '', required: false }),
      '#service': createField('#service', { value: '' }),
      '#service-2': createField('#service-2', { value: '' }),
      '#service-3': createField('#service-3', { value: '' }),
      '#availability-required': createField('#availability-required', { value: '1' }),
      '[name="free-consulting-calls"]': createField('[name="free-consulting-calls"]', { value: 'yes' }),
      '[name="free-call-description"]': createField('[name="free-call-description"]', { value: 'Legacy free description' }),
      '[name="paid-consulting-calls"]': createField('[name="paid-consulting-calls"]', { value: 'yes' }),
      '[name="paid-call-description"]': createField('[name="paid-call-description"]', { value: 'Legacy description' }),
      '[name="paid-call-rate"]': createField('[name="paid-call-rate"]', { value: '250' }),
    },
    7: {
      '[name="reviewer"]': createField('[name="reviewer"]', { value: JSON.stringify({ fname: 'Owned', lname: 'Reviewer', job: 'Founder', company: 'QA Company', email: 'owned-reviewer@example.com' }) }),
      '[name="reviewer-2"]': createField('[name="reviewer-2"]', { value: '' }),
      '[name="reviewer-3"]': createField('[name="reviewer-3"]', { value: '' }),
    },
  }
  const stepFields = selectorsByStep[stepIndex] || {}
  const absentSelectors = new Set(missingSelectors)
  const focusTarget = new Target()
  const captureFields = requiredCaptureFields.map((field, index) => createField(`capture-${index}`, {
    required: true,
    ...field,
  }))
  const fields = { ...globalFields, ...stepFields }
  const rateInputs = [
    stepFields['[name="rate"]'],
    stepFields['[name="rate-retainer"]'],
  ].filter(Boolean)
  // Mirrors the published shared foundation still live on the page
  // (v3/profile-form/shared-foundation-published.capture.txt lines 42-72): it claims
  // every unclaimed rate control and rewrites its value to two decimals on blur.
  const liveRateFormatterCalls = []
  function liveFormatRateInputs(wrapper = null) {
    liveRateFormatterCalls.push(wrapper)
    rateInputs
      .filter((input) => !input.classList.contains('initialized'))
      .forEach((input) => {
        input.classList.add('initialized')
        input.addEventListener('blur', () => {
          const parsed = parseFloat(input.value)
          input.value = Number.isNaN(parsed) ? '' : parsed.toFixed(2)
        })
      })
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
  const retainerDescription = new Target()
  const retainerRate = new Target()
  retainerDescription.querySelectorAll = () => []
  retainerRate.querySelectorAll = () => []
  counterWrapper.querySelector = (selector) => selector === '.count-input' ? counter : null
  counterInput.closest = (selector) => selector === '.form_input-wr' ? counterWrapper : null

  button.closest = () => step
  button.querySelectorAll = (selector) => selector === '.button_main-text' ? [buttonText] : []
  step.querySelector = (selector) => {
    if (selector === '[data-edit-submit]') return button
    if (absentSelectors.has(selector)) return null
    if (Object.prototype.hasOwnProperty.call(stepFields, selector)) return stepFields[selector]
    if (selector.includes(',') || selector.startsWith('.ql-editor')) return focusTarget
    return null
  }
  step.querySelectorAll = (selector) => {
    if (selector === 'input, select, textarea') return Object.values(stepFields)
    if (selector === '[data-input-capture][required]') return captureFields
    if (selector === '[name="free-consulting-calls"],[name="free-call-description"],[name="paid-consulting-calls"],[name="paid-call-description"],[name="paid-call-rate"]') {
      return [
        stepFields['[name="free-consulting-calls"]'],
        stepFields['[name="free-call-description"]'],
        stepFields['[name="paid-consulting-calls"]'],
        stepFields['[name="paid-call-description"]'],
        stepFields['[name="paid-call-rate"]'],
      ].filter(Boolean)
    }
    return []
  }
  form.querySelector = () => null
  form.querySelectorAll = () => []
  const buildFormValues = () => [
    ['email', globalFields.email.value],
    ['phone', globalFields.phone.value],
    ...(stepIndex === 1 ? [
      ['first-name', stepFields['[name="first-name"]'].value],
      ['last-name', stepFields['[name="last-name"]'].value],
      ['country', stepFields['[name="country"]'].value],
      ['state', stepFields['[name="state"]'].value],
      ['city', stepFields['[name="city"]'].value],
      ['profile-photo-url', stepFields['#profile-photo-url'].value],
      ['function-option', 'Strategy'],
      ['function', '1'],
      ['role-option', 'Product Strategy'],
      ['roles', '1'],
      ['subcategories-option', 'Consulting'],
      ['subcategories', '1'],
    ] : []),
    ...(stepIndex === 2 ? [
      ['tagline', stepFields['#tagline'].value],
      ['pro-headline', stepFields['#pro-headline'].value],
      ['bio-html', stepFields['#bio-html'].value],
    ] : []),
    ...(stepIndex === 5 ? [['skill-option', 'Research'], ['skills', '1'], ['tool-option', 'Figma'], ['tools', '1']] : []),
    ...(stepIndex === 6 ? [
      ['rate', stepFields['[name="rate"]'].value],
      ['availability-option', 'Available'],
      ['availability', '1'],
    ] : []),
    ...(stepIndex === 7 ? [
      ['reviewer', stepFields['[name="reviewer"]'].value],
      ['reviewer-2', stepFields['[name="reviewer-2"]'].value],
      ['reviewer-3', stepFields['[name="reviewer-3"]'].value],
    ] : []),
    ...additionalFormValues,
  ]
  Object.defineProperty(form, 'formValues', { get: buildFormValues })

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
    createElement() { return new Target() },
    createTextNode(text) { return Object.assign(new Target(), { textContent: text }) },
    querySelector(selector) {
      if (selector === '[build-profile-form]') return form
      if (selector === "[data-modal-trigger='edit-form-success']") return successModal
      if (selector === "[data-modal-trigger='edit-form-error']") return errorModal
      if (selector === '[data-modal-target="edit-form-success"]') return successTarget
      if (selector === '[data-modal-target="edit-form-error"]') return errorTarget
      if (selector === '#email') return globalFields.email
      if (selector === '#phone' || selector === 'input[name="phone"]') return globalFields.phone
      if (selector === '[data-monthly-retainers-description]') return retainerDescription
      if (selector === '[data-monthly-retainers-rate]') return retainerRate
      if (selector === `[data-form="step"][data-index="${stepIndex}"]`) return step
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-form="step"][data-index]') return [step]
      if (selector === '[data-element="rate"]') return rateInputs
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
    customFields: { 'free-user': '', 'last-name': '', phone: globalFields.phone.value },
  }
  let memberReadIndex = 0
  const window = {
    activeProfile: {
      type: profileType,
      type_id: profileType === 'consult' ? 2 : 1,
      data: { step_1: { phone: canonicalPhone } },
    },
    MEMBER: currentMember,
    waitProfileData(callback) { profileDataCallbacks.push(callback) },
    waitForMember(callback) { callback(this.MEMBER) },
    clearTimeout() {},
    setTimeout: setTimeoutImpl,
    location: { replace() {}, hostname: 'the-starters-3-0.webflow.io' },
    intlTelInput: Object.assign(() => ({}), { getInstance: () => null }),
    $memberstackDom: {
      async getCurrentMember() {
        if (Array.isArray(memberReadSequence) && memberReadIndex < memberReadSequence.length) {
          return { data: memberReadSequence[memberReadIndex++] }
        }
        return { data: currentMember }
      },
      onAuthChange(listener) {
        authChangeListeners.push(listener)
        if (notifyCurrentMemberOnAuthSubscribe || initialAuthNotification !== undefined) {
          const subscribedMember = notifyCurrentMemberOnAuthSubscribe
            ? currentMember
            : initialAuthNotification
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
  if (dirtyState) window.__tsProfileDirtyState = dirtyState
  if (liveRateFormatter) window.formatRateInputs = liveFormatRateInputs

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
  if (simulateProfileHydrationAfterDomReady) {
    Object.values(stepFields).forEach((field) => {
      field.disabled = false
      field.attributes.delete('aria-disabled')
    })
    profileDataCallbacks.forEach((callback) => callback(window.activeProfile))
  }

  return {
    button,
    step,
    form,
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
    fields,
    focusTarget,
    window,
    liveRateFormatterCalls,
    runLiveRateFormatter: liveFormatRateInputs,
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

  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) })
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
    json: async () => ({ saved: true, projection_pending: false }),
  }), { documentReadyState: 'complete' })

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
  assert.deepEqual(environment.modalApiCalls, ['edit-form-success'])
}

async function testInitialSameMemberAuthNotificationDoesNotRejectSave() {
  let requests = 0
  const environment = createEnvironment(async () => {
    requests += 1
    return { ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) }
  }, { notifyCurrentMemberOnAuthSubscribe: true })

  await submit(environment)

  assert.equal(requests, 1)
  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
}

async function testInitialEmptyAuthNotificationDoesNotRejectCurrentMemberSave() {
  let requests = 0
  const environment = createEnvironment(async () => {
    requests += 1
    return { ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) }
  }, { initialAuthNotification: null })

  await submit(environment)

  assert.equal(requests, 1)
  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
}

async function testInitialAuthNotificationForDifferentMemberInvalidatesSave() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    initialAuthNotification: { id: 'mem_other', auth: { email: 'other@example.com' }, customFields: {} },
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
}

async function testMemberSwitchBetweenBracketingReadsFailsBeforeRequestStage() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    workflowDiagnostics: true,
    memberReadSequence: [
      { id: 'mem_test', auth: { email: 'old@example.com' }, customFields: {} },
      { id: 'mem_other', auth: { email: 'other@example.com' }, customFields: {} },
    ],
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.deepEqual(
    environment.tracked.map((event) => event.name),
    ['workflow_form_submit_failed'],
  )
  const receipt = environment.window.__startersWorkflowDiagnosticLast
  assert.equal(receipt.stage, 'auth')
  assert.equal(receipt.error_code, 'MEMBER_SCOPE_CHANGED')
  assert.equal(receipt.request_started, false)
}

async function testSecondSaveStillFailsClosedWhenMemberSwitchesMidRequest() {
  const firstResponse = deferred()
  const secondResponse = deferred()
  const responses = [firstResponse.promise, secondResponse.promise]
  const environment = createEnvironment(() => responses.shift())
  environment.window.MEMBER.customFields.phone = ''

  const firstSubmission = submit(environment)
  firstResponse.resolve({ ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) })
  await firstSubmission

  assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
  assert.equal(environment.memberUpdates.length, 1)

  const secondSubmission = submit(environment)
  await new Promise(setImmediate)
  environment.switchMember({
    id: 'mem_other',
    auth: { email: 'other@example.com' },
    customFields: {},
  })
  secondResponse.resolve({ ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) })
  await secondSubmission

  assert.deepEqual(environment.modalEvents, { success: 1, error: 1 })
  assert.equal(environment.memberUpdates.length, 1)
}

async function testEarlyLoadInitializesCountersAfterParsing() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
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

async function testSaveLifecycleUpdatesDirtyState() {
  const calls = []
  const dirtyState = {
    beginSave(stepIndex) {
      const token = { stepIndex }
      calls.push(['begin', stepIndex])
      return token
    },
    sealSave(token) { calls.push(['seal', token.stepIndex]) },
    finishSave(stepIndex, saved) { calls.push(['finish', stepIndex, saved]) },
  }
  const request = deferred()
  const environment = createEnvironment(() => request.promise, { stepIndex: 2, dirtyState })
  const submission = submit(environment)
  await new Promise(setImmediate)

  assert.deepEqual(calls, [['begin', 2], ['seal', 2]], 'the warning starts early and seals at the payload snapshot')
  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) })
  await submission
  assert.deepEqual(calls, [['begin', 2], ['seal', 2], ['finish', 2, true]])

  const failedCalls = []
  const failedState = {
    beginSave(stepIndex) {
      const token = { stepIndex }
      failedCalls.push(['begin', stepIndex])
      return token
    },
    sealSave(token) { failedCalls.push(['seal', token.stepIndex]) },
    finishSave(stepIndex, saved) { failedCalls.push(['finish', stepIndex, saved]) },
  }
  const failed = createEnvironment(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: 'failed' }),
  }), { stepIndex: 2, dirtyState: failedState })
  await submit(failed)
  assert.deepEqual(failedCalls, [['begin', 2], ['seal', 2], ['finish', 2, false]])
}

async function testCanonicalSaveWithPendingProjectionNeverShowsWholeFormFailure() {
  for (const status of [200, 500]) {
    const environment = createEnvironment(async () => ({
      ok: status === 200,
      status,
      json: async () => ({ saved: true, projection_pending: true, profile_id: 424 }),
    }), { stepIndex: 6 })

    await submit(environment)

    assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
    assert.equal(
      environment.successFeedback.textContent,
      'Your profile was saved. Public profile changes can take a moment to appear.',
    )
  }
}

async function testSuccessfulHttpWithoutCanonicalSaveConfirmationFailsClosed() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ projection_pending: true }),
  }), { stepIndex: 6 })

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
}

async function testCanonicalSaveWithoutExplicitProjectionStateFailsClosed() {
  for (const projection_pending of [undefined, null, 'pending']) {
    const environment = createEnvironment(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ saved: true, projection_pending }),
    }), { stepIndex: 6 })

    await submit(environment)

    assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  }
}

async function testEveryOwnedSectionOpensSuccessModal() {
  for (const stepIndex of [2, 5, 6, 7]) {
    const environment = createEnvironment(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ saved: true, projection_pending: false }),
    }), { stepIndex })

    await submit(environment)

    assert.deepEqual(environment.modalEvents, { success: 1, error: 0 })
    assert.deepEqual(environment.modalApiCalls, ['edit-form-success'])
  }
}

async function submittedStepPayload(environment) {
  await submit(environment)
  assert.equal(environment.requests.length, 1)
  const [, options] = environment.requests[0]
  return JSON.parse(options.body)
}

function saved(overrides) {
  return createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }), overrides)
}

async function testOptionalRatesPreserveCanonicalZeroSentinel() {
  const disabledPayload = await submittedStepPayload(saved({
    stepIndex: 6,
    additionalFormValues: [
      ['offer-monthly-retainers', 'no'],
      ['rate-retainer', '   '],
    ],
  }))
  assert.equal(disabledPayload.Retainer_Enabled, false)
  assert.equal(disabledPayload.Retainer_Rate, 0)

  const configuredPayload = await submittedStepPayload(saved({
    stepIndex: 6,
    additionalFormValues: [
      ['offer-monthly-retainers', 'yes'],
      ['rate-retainer', '500'],
    ],
  }))
  assert.equal(configuredPayload.Retainer_Rate, 500)
}

async function testStepSixNeverWritesPaidCallAuthority() {
  const payload = await submittedStepPayload(saved({
    stepIndex: 6,
    additionalFormValues: [
      ['paid-consulting-calls', 'yes'],
      ['paid-call-description', 'Legacy profile form value'],
      ['paid-call-rate', '250.00'],
    ],
  }))

  assert.equal(Object.hasOwn(payload, 'Paid_Call_Enabled'), false)
  assert.equal(Object.hasOwn(payload, 'Paid_Call_Description'), false)
  assert.equal(Object.hasOwn(payload, 'Paid_Call_Rate'), false)
}

async function testStepSixNeverWritesFreeCallAuthority() {
  const payload = await submittedStepPayload(saved({
    stepIndex: 6,
    additionalFormValues: [
      ['free-consulting-calls', 'yes'],
      ['free-call-description', 'Legacy profile form value'],
    ],
  }))

  assert.equal(Object.hasOwn(payload, 'Free_Call_Enabled'), false)
  assert.equal(Object.hasOwn(payload, 'Free_Call_Description'), false)
}

async function testStepSixDisablesLegacyPaidCallControlsAndLinksCanonicalSettings() {
  const environment = saved({ stepIndex: 6 })
  const controlSelectors = [
    '[name="free-consulting-calls"]',
    '[name="free-call-description"]',
    '[name="paid-consulting-calls"]',
    '[name="paid-call-description"]',
    '[name="paid-call-rate"]',
  ]
  controlSelectors.forEach((selector) => {
    assert.equal(environment.fields[selector].disabled, true)
    assert.equal(environment.fields[selector].required, false)
    assert.equal(environment.fields[selector].getAttribute('aria-disabled'), 'true')
  })
  const notice = environment.step.children.find((child) => child.hasAttribute('data-paid-call-profile-notice'))
  assert.ok(notice)
  assert.equal(notice.children[0].href, '/starter-dashboard#calendar')
  assert.equal(notice.children[0].textContent, 'Call Settings')
}

async function testStepSixReappliesCallOwnershipAfterProfileHydration() {
  const environment = saved({
    stepIndex: 6,
    simulateProfileHydrationAfterDomReady: true,
  })
  const controlSelectors = [
    '[name="free-consulting-calls"]',
    '[name="free-call-description"]',
    '[name="paid-consulting-calls"]',
    '[name="paid-call-description"]',
    '[name="paid-call-rate"]',
  ]
  controlSelectors.forEach((selector) => {
    assert.equal(environment.fields[selector].disabled, true)
    assert.equal(environment.fields[selector].getAttribute('aria-disabled'), 'true')
  })
}

async function testPersonalDetailsUsesAuthoredContactControlsAndPreservesUntouchedCanonicalPhone() {
  const environment = saved({
    canonicalPhone: '0917',
    additionalFormValues: [
      ['email', 'hidden@example.com'],
      ['phone', '+639170000000'],
    ],
  })
  environment.window.intlTelInput.getInstance = () => ({ getNumber: () => '+639170000000' })

  const untouched = await submittedStepPayload(environment)
  assert.equal(untouched.Email, 'new@example.com')
  assert.equal(untouched.Phone, '0917')

  const editedEnvironment = saved({ canonicalPhone: '0917' })
  editedEnvironment.window.intlTelInput.getInstance = () => ({ getNumber: () => '+639180000000' })
  await editedEnvironment.fields.phone.dispatchEvent({ type: 'input' })
  const edited = await submittedStepPayload(editedEnvironment)
  assert.equal(edited.Phone, '+639180000000')
}

// intl-tel-input rewrites the value on a country pick and fires `countrychange`
// rather than `input`, so that gesture must count as a member edit too.
async function testPhoneCountryChangeCountsAsAMemberEdit() {
  const environment = saved({ canonicalPhone: '0917' })
  environment.window.intlTelInput.getInstance = () => ({ getNumber: () => '+14155550000' })

  await environment.fields.phone.dispatchEvent({ type: 'countrychange' })

  const payload = await submittedStepPayload(environment)
  assert.equal(payload.Phone, '+14155550000')
}

async function testEnabledOptionalRatesNeverSilentlyPersistZero() {
	const environment = saved({
		stepIndex: 6,
		additionalFormValues: [
			['offer-monthly-retainers', 'yes'],
			['rate-retainer', '   '],
		],
	})
	await submit(environment)
	assert.equal(environment.requests.length, 0)
	assert.equal(environment.fields['[name="rate-retainer"]'].reportValidityCount, 1)
	assert.match(environment.fields['[name="rate-retainer"]'].validationMessage, /\$1 to \$25,000/)
}

async function testStepSixRejectsInvalidWholeDollarPricesBeforeFetch() {
	for (const value of ['0', '1001', '-1', '1.5', '1,000', '$50', '1e2']) {
		const environment = saved({
			stepIndex: 6,
			fieldOverrides: { '[name="rate"]': { value } },
		})
		await submit(environment)
		assert.equal(environment.requests.length, 0, `hourly ${value} must not send`)
	}

	for (const value of ['25001', '1.5']) {
		const environment = saved({
			stepIndex: 6,
			additionalFormValues: [
				['offer-monthly-retainers', 'yes'],
				['rate-retainer', value],
			],
		})
		await submit(environment)
		assert.equal(environment.requests.length, 0, `retainer ${value} must not send`)
	}

	for (const value of ['0', '50001', '1.5']) {
		const environment = saved({
			stepIndex: 6,
			additionalFormValues: [['service', JSON.stringify({ name: 'Audit', price: value })]],
		})
		await submit(environment)
		assert.equal(environment.requests.length, 0, `service ${value} must not send`)
	}
}

async function testStepSixPersistsExactPriceBoundaries() {
	const environment = saved({
		stepIndex: 6,
		fieldOverrides: { '[name="rate"]': { value: '1000' } },
		additionalFormValues: [
			['offer-monthly-retainers', 'yes'],
			['rate-retainer', '25000'],
			['service', JSON.stringify({ name: 'Audit', price: '50000' })],
		],
	})
	await submit(environment)
	assert.equal(environment.requests.length, 1, JSON.stringify({
		hourly: environment.fields['[name="rate"]'].validationMessage,
		retainer: environment.fields['[name="rate-retainer"]'].validationMessage,
		service: environment.fields['#service'].validationMessage,
		modalEvents: environment.modalEvents,
	}))
	const payload = JSON.parse(environment.requests[0][1].body)
	assert.equal(payload.Hourly_Rate, 1000)
	assert.equal(payload.Retainer_Rate, 25000)
	assert.equal(JSON.parse(payload.Services)['service-1'].price, 50000)
}

async function testStepSixPriceContractSurvivesABlankServiceCaptureField() {
	const environment = saved({
		stepIndex: 6,
		additionalFormValues: [
			['service', ''],
			['offer-monthly-retainers', 'yes'],
			['rate-retainer', '0'],
		],
	})
	await submit(environment)
	assert.equal(environment.requests.length, 0)
	assert.equal(environment.fields['[name="rate-retainer"]'].reportValidityCount, 1)
	assert.match(environment.fields['[name="rate-retainer"]'].validationMessage, /\$1 to \$25,000/)
}

async function testServiceFailuresExplainThemselvesInTheErrorModal() {
	const missingName = saved({
		stepIndex: 6,
		additionalFormValues: [['service', JSON.stringify({ name: '', price: '500' })]],
	})
	await submit(missingName)
	assert.equal(missingName.requests.length, 0)
	assert.equal(missingName.modalEvents.error, 1)
	assert.match(missingName.errorFeedback.textContent, /service name is required/i)

	const invalidPrice = saved({
		stepIndex: 6,
		additionalFormValues: [['service', JSON.stringify({ name: 'Audit', price: '0' })]],
	})
	await submit(invalidPrice)
	assert.equal(invalidPrice.requests.length, 0)
	assert.equal(invalidPrice.modalEvents.error, 1)
	assert.match(invalidPrice.errorFeedback.textContent, /\$1 to \$50,000/)
}

// The error modal is shared. A price message written for one blocked save must
// never still be on screen for the next, unrelated failure, which has its own cause.
async function testAPriceMessageNeverSurvivesIntoAnUnrelatedFailure() {
	let failRequest = false
	const service = ['service', JSON.stringify({ name: 'Audit', price: '0' })]
	const environment = createEnvironment(async () => {
		if (failRequest) throw new Error('offline')
		return { ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) }
	}, {
		stepIndex: 6,
		additionalFormValues: [service],
	})

	await submit(environment)
	assert.equal(environment.requests.length, 0)
	assert.match(environment.errorFeedback.textContent, /\$1 to \$50,000/)

	service[1] = JSON.stringify({ name: 'Audit', price: '500' })
	failRequest = true
	await submit(environment)
	assert.equal(environment.requests.length, 1)
	assert.equal(environment.modalEvents.error, 2)
	assert.equal(environment.errorFeedback.textContent, 'Your profile could not be saved.')
}

// An auth failure reveals the same modal without writing a message of its own, so
// it must not inherit the price remediation copy from an earlier blocked save.
async function testAnAuthFailureNeverInheritsAPriceMessage() {
	const service = ['service', JSON.stringify({ name: '', price: '500' })]
	const environment = createEnvironment(async () => {
		throw new Error('fetch must not run')
	}, {
		stepIndex: 6,
		additionalFormValues: [service],
	})

	await submit(environment)
	assert.equal(environment.requests.length, 0)
	assert.match(environment.errorFeedback.textContent, /service name is required/i)

	service[1] = JSON.stringify({ name: 'Audit', price: '500' })
	environment.switchMember(null)
	await submit(environment)
	assert.equal(environment.requests.length, 0)
	assert.equal(environment.errorFeedback.textContent, 'Your profile could not be saved.')
}

// A canonical Hourly_Rate stored before the contract narrowed is real member data
// this page must not repair. It hydrates unchanged, blocks every resave before any
// Xano request while it is still out of contract, and only the member's own
// whole-dollar replacement clears the stale validity and reaches Xano.
async function testLegacyOutOfContractHourlyRateBlocksUntilTheMemberRepairsIt() {
	const environment = createEnvironment(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ saved: true, projection_pending: false }),
	}), {
		stepIndex: 6,
		fieldOverrides: { '[name="rate"]': { value: '2500' } },
	})
	const rate = environment.fields['[name="rate"]']
	assert.equal(rate.value, '2500', 'hydration must not rewrite the stored outlier')
	assert.equal(rate.getAttribute('max'), '1000')

	for (const attempt of [1, 2]) {
		await submit(environment)
		assert.equal(environment.requests.length, 0, `attempt ${attempt} must not reach Xano`)
		assert.match(rate.validationMessage, /\$1 to \$1,000/)
		assert.equal(rate.value, '2500', 'the stored outlier is never silently rewritten')
	}

	for (const invalid of ['1001', '2500.00', '1,000', '$900']) {
		rate.value = invalid
		await submit(environment)
		assert.equal(environment.requests.length, 0, `${invalid} must not reach Xano`)
		assert.match(rate.validationMessage, /\$1 to \$1,000/)
	}

	rate.value = '900'
	await submit(environment)
	assert.equal(environment.requests.length, 1, rate.validationMessage)
	const [, options] = environment.requests[0]
	assert.equal(JSON.parse(options.body).Hourly_Rate, 900)
	assert.equal(rate.validationMessage, '')
	assert.equal(environment.errorFeedback.textContent, 'Your profile could not be saved.')
}

// Clearing a custom-service price is the only remove gesture these forms author.
// It must empty that slot, not block the step on the service being deleted.
async function testClearingAServicePriceRemovesThatService() {
	const payload = await submittedStepPayload(saved({
		stepIndex: 6,
		additionalFormValues: [
			['service', JSON.stringify({ name: 'Audit', price: '' })],
			['service-2', JSON.stringify({ name: 'Workshop', price: '750' })],
		],
	}))
	const services = JSON.parse(payload.Services)
	assert.equal(services['service-1'], null)
	assert.deepEqual(services['service-2'], { name: 'Workshop', price: 750 })
	assert.equal(services['service-3'], null)

	for (const price of ['   ', null, undefined]) {
		const blank = await submittedStepPayload(saved({
			stepIndex: 6,
			additionalFormValues: [['service', JSON.stringify({ name: 'Audit', price })]],
		}))
		assert.equal(JSON.parse(blank.Services)['service-1'], null, `price ${price}`)
	}
}

async function testANonBlankMalformedServicePriceStillBlocksTheStep() {
	for (const price of ['0', '500.50', '50001', '1,000', '$50', '1e2', '-5']) {
		const environment = createEnvironment(async () => {
			throw new Error('fetch must not run')
		}, {
			stepIndex: 6,
			additionalFormValues: [['service', JSON.stringify({ name: 'Audit', price })]],
		})
		await submit(environment)
		assert.equal(environment.requests.length, 0, `service ${price} must not send`)
		assert.match(environment.errorFeedback.textContent, /\$1 to \$50,000/)
	}
}

// A collapsed retainer section must not block the step, and must not forward the
// stale text of a control the member cannot see as an unvalidated Xano value.
async function testCollapsedRetainerSectionNeverBlocksStepSix() {
	const unsetToggle = await submittedStepPayload(saved({
		stepIndex: 6,
		additionalFormValues: [['rate-retainer', '   ']],
	}))
	assert.equal(unsetToggle.Retainer_Enabled, undefined)
	assert.equal(Object.prototype.hasOwnProperty.call(unsetToggle, 'Retainer_Rate'), false)

	const legacyDisabledValue = await submittedStepPayload(saved({
		stepIndex: 6,
		additionalFormValues: [
			['offer-monthly-retainers', 'no'],
			['rate-retainer', '30000'],
		],
	}))
	assert.equal(legacyDisabledValue.Retainer_Enabled, false)
	assert.equal(legacyDisabledValue.Retainer_Rate, 0)
}

// Step 6 owns the service price contract for every slot, so it must serialize the
// slots it validated instead of keying the write-back on slot 1 having a value.
async function testStepSixPersistsEveryValidatedServiceSlot() {
	const secondSlotOnly = await submittedStepPayload(saved({
		stepIndex: 6,
		additionalFormValues: [
			['service', ''],
			['service-2', JSON.stringify({ name: 'Audit', price: '500' })],
		],
	}))
	const persisted = JSON.parse(secondSlotOnly.Services)
	assert.equal(persisted['service-1'], null)
	assert.deepEqual(persisted['service-2'], { name: 'Audit', price: 500 })
	assert.equal(persisted['service-3'], null)

	const whitespaceOnly = await submittedStepPayload(saved({
		stepIndex: 6,
		additionalFormValues: [['service', JSON.stringify({ name: ' ', price: ' ' })]],
	}))
	assert.deepEqual(JSON.parse(whitespaceOnly.Services), {
		'service-1': null,
		'service-2': null,
		'service-3': null,
	})
}

// The published shared foundation is still live on this page and rewrites every
// rate it claims to two decimals on blur, so a member who focuses a price control
// and then saves must still persist the whole-dollar value they authored.
async function testStepSixSavesAuthoredRatesWhileTheLiveFormatterIsPresent() {
	const environment = saved({ stepIndex: 6, liveRateFormatter: true })
	const rate = environment.fields['[name="rate"]']

	await rate.dispatchEvent({ type: 'focus' })
	await rate.dispatchEvent({ type: 'blur' })
	assert.equal(rate.value, '125')

	environment.runLiveRateFormatter()
	await rate.dispatchEvent({ type: 'blur' })
	assert.equal(rate.value, '125')

	const payload = await submittedStepPayload(environment)
	assert.equal(payload.Hourly_Rate, 125)
	assert.equal(rate.validationMessage, '')
	assert.deepEqual([
		rate.getAttribute('type'),
		rate.getAttribute('inputmode'),
		rate.getAttribute('step'),
		rate.getAttribute('min'),
		rate.getAttribute('max'),
	], ['number', 'numeric', '1', '1', '1000'])
	assert.equal(environment.fields['[name="rate-retainer"]'].getAttribute('max'), '25000')
}

// Service rows are cloned after load and formatted through the page global, so the
// contract this page validates has to reach them instead of the live rewriter.
async function testClonedServicePriceRowsGetTheWholeDollarContract() {
	const environment = saved({ stepIndex: 6, liveRateFormatter: true })
	const clonedPrice = Object.assign(new Target(), { value: '500' })
	clonedPrice.setAttribute('name', 'price-2')
	const clonedRow = new Target()
	clonedRow.querySelectorAll = (selector) => selector === '[data-element="rate"]' ? [clonedPrice] : []

	environment.window.formatRateInputs(clonedRow)
	await clonedPrice.dispatchEvent({ type: 'blur' })

	assert.equal(clonedPrice.value, '500')
	assert.equal(clonedPrice.classList.contains('initialized'), true)
	assert.deepEqual([
		clonedPrice.getAttribute('type'),
		clonedPrice.getAttribute('step'),
		clonedPrice.getAttribute('min'),
		clonedPrice.getAttribute('max'),
	], ['number', '1', '1', '50000'])
}

async function testHourlyRateUsesCanonicalZeroOnlyWhenOptional() {
  const consultPayload = await submittedStepPayload(saved({
    stepIndex: 6,
    profileType: 'consult',
    fieldOverrides: { '[name="rate"]': { value: '', required: false, valid: true } },
  }))
  assert.equal(consultPayload.Hourly_Rate, 0)

  const fullPayload = await submittedStepPayload(saved({ stepIndex: 6 }))
  assert.equal(fullPayload.Hourly_Rate, 125)

  const requiredBlank = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    stepIndex: 6,
    fieldOverrides: { '[name="rate"]': { value: '' } },
  })
  await submit(requiredBlank)
  assert.equal(requiredBlank.requests.length, 0)
}

// A consult save persists Hourly_Rate 0 for the profile-inapplicable control and
// the canonical loader writes that 0 straight back into the field, so reading it
// back as an authored price would block every later save on this flow's own data.
async function testConsultCanonicalZeroHourlyRateSurvivesSaveReloadSave() {
  const first = saved({
    stepIndex: 6,
    profileType: 'consult',
    fieldOverrides: { '[name="rate"]': { value: '', required: false, valid: true } },
  })
  const firstPayload = await submittedStepPayload(first)
  assert.equal(firstPayload.Hourly_Rate, 0)

  const reloaded = saved({
    stepIndex: 6,
    profileType: 'consult',
    fieldOverrides: {
      '[name="rate"]': { value: String(firstPayload.Hourly_Rate), required: false, valid: true },
    },
  })
  const reloadedPayload = await submittedStepPayload(reloaded)
  assert.equal(reloadedPayload.Hourly_Rate, 0)

  const required = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    stepIndex: 6,
    fieldOverrides: { '[name="rate"]': { value: '0' } },
  })
  await submit(required)
  assert.equal(required.requests.length, 0, 'a required hourly rate must still reject zero')
}

// A reported price failure leaves a custom validity message on its control, and
// native validation runs before the price contract can revalidate. Without the
// reset the corrected value could never be saved without a full page reload.
async function testCorrectedPriceSavesAfterAReportedPriceFailure() {
  const environment = saved({
    stepIndex: 6,
    fieldOverrides: { '[name="rate"]': { value: '125.00' } },
  })
  const rate = environment.fields['[name="rate"]']

  await submit(environment)
  assert.equal(environment.requests.length, 0, 'a decimal hourly rate must not reach Xano')
  assert.match(rate.validationMessage, /\$1 to \$1,000/)

  rate.value = '125'
  await submit(environment)
  assert.equal(environment.requests.length, 1, rate.validationMessage)
  const [, options] = environment.requests[0]
  assert.equal(JSON.parse(options.body).Hourly_Rate, 125)
  assert.equal(rate.validationMessage, '')
}

async function testReviewerStepUsesCanonicalBuildProfileShape() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
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
    json: async () => ({ saved: true, projection_pending: false }),
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
    json: async () => ({ saved: true, projection_pending: false }),
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
    return { ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) }
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
    return { ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) }
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
  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) })
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
  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) })
  await submission

  assert.equal(environment.memberUpdates.length, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
}

async function testInvalidNativeFieldReportsWithoutStartingRequest() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    workflowDiagnostics: true,
    fieldOverrides: { '[name="first-name"]': { value: '', valid: false } },
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.equal(environment.fields['[name="first-name"]'].reportValidityCount, 1)
  assert.equal(environment.button.style.pointerEvents ?? '', '')
  assert.equal(environment.window.__startersWorkflowDiagnosticLast.error_code, 'NATIVE_VALIDATION')
  assert.equal(environment.window.__startersWorkflowDiagnosticLast.request_started, false)
}

async function testEmptyMirrorFocusesAuthoredControlWithoutStartingRequest() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    workflowDiagnostics: true,
    fieldOverrides: { '#function-required': { value: '' } },
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.equal(environment.focusTarget.focusCount, 1)
  assert.equal(environment.button.style.pointerEvents ?? '', '')
  assert.equal(environment.window.__startersWorkflowDiagnosticLast.error_code, 'MIRROR_VALUE_MISSING')
}

async function testMissingAuthoredMarkerFailsClosed() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    workflowDiagnostics: true,
    missingSelectors: ['#profile-photo-url'],
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.equal(environment.button.style.pointerEvents ?? '', '')
  assert.equal(environment.window.__startersWorkflowDiagnosticLast.error_code, 'MARKUP_CONTRACT_MISSING')
}

async function testProfileHydrationMustFinishBeforeValidationCanWrite() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    profileType: '',
    workflowDiagnostics: true,
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.equal(environment.button.style.pointerEvents ?? '', '')
  assert.equal(environment.window.__startersWorkflowDiagnosticLast.error_code, 'PROFILE_NOT_READY')
}

async function testProfileTypeSelectsOnlyItsOwnedMirrorBranch() {
  const consultValid = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }), {
    profileType: 'consult',
    fieldOverrides: { '#roles-required': { value: '' } },
  })
  await submit(consultValid)
  assert.equal(consultValid.requests.length, 1)

  const consultInvalid = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    profileType: 'consult',
    fieldOverrides: { '#subcategories-required': { value: '' } },
  })
  await submit(consultInvalid)
  assert.equal(consultInvalid.requests.length, 0)
}

async function testProfileTypeOwnsSkillsToolsAndAvailabilityOnlyForFullProfiles() {
  for (const [stepIndex, selector] of [[5, '#skills-required'], [5, '#tools-required'], [6, '#availability-required']]) {
    const consult = createEnvironment(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ saved: true, projection_pending: false }),
    }), {
      stepIndex,
      profileType: 'consult',
      fieldOverrides: { [selector]: { value: '' } },
    })
    await submit(consult)
    assert.equal(consult.requests.length, 1, `consult step ${stepIndex} ignores ${selector}`)

    const full = createEnvironment(async () => {
      throw new Error('fetch must not run')
    }, {
      stepIndex,
      fieldOverrides: { [selector]: { value: '' } },
    })
    await submit(full)
    assert.equal(full.requests.length, 0, `full step ${stepIndex} requires ${selector}`)
  }

  const consultRate = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }), {
    stepIndex: 6,
    profileType: 'consult',
    fieldOverrides: { '[name="rate"]': { value: '', required: false, valid: true } },
  })
  await submit(consultRate)
  assert.equal(consultRate.requests.length, 1)
}

async function testConditionalLocationRequirementTransitions() {
  const optionalState = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }))
  await submit(optionalState)
  assert.equal(optionalState.requests.length, 1)

  const requiredState = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    fieldOverrides: { '[name="state"]': { value: '', required: true, valid: false } },
  })
  await submit(requiredState)
  assert.equal(requiredState.requests.length, 0)
  assert.equal(requiredState.fields['[name="state"]'].reportValidityCount, 1)
}

async function testReviewerStepRejectsPartialTupleButAllowsEmptyOptionalSlots() {
  const partial = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    stepIndex: 7,
    workflowDiagnostics: true,
    fieldOverrides: {
      '[name="reviewer"]': { value: JSON.stringify({ fname: 'Partial' }) },
    },
  })
  await submit(partial)
  assert.equal(partial.requests.length, 0)
  assert.equal(partial.window.__startersWorkflowDiagnosticLast.error_code, 'REVIEWER_TUPLE_INCOMPLETE')

  const empty = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }), {
    stepIndex: 7,
    fieldOverrides: { '[name="reviewer"]': { value: '' } },
  })
  await submit(empty)
  assert.equal(empty.requests.length, 1)

  const absentOptionalSlots = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }), {
    stepIndex: 7,
    missingSelectors: ['[name="reviewer-2"]', '[name="reviewer-3"]'],
  })
  await submit(absentOptionalSlots)
  assert.equal(absentOptionalSlots.requests.length, 1)
}

async function testDynamicRequiredCaptureBlocksBeforeLoading() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    stepIndex: 6,
    requiredCaptureFields: [{ value: '', valid: false }],
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.equal(environment.button.style.pointerEvents ?? '', '')
}

async function testPersonalDetailsValidationBoundary() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }))

  assert.equal(
    environment.window.StartersStarterEditProfile.validatePersonalDetails().valid,
    true,
  )

  environment.fields['[name="first-name"]'].value = ''

  assert.equal(
    environment.window.StartersStarterEditProfile.validatePersonalDetails().valid,
    false,
  )
}

async function testReplayProofRejectsChangedMemberAtCapture() {
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  })
  environment.window.MEMBER.auth.email = 'new@example.com'
  let rejected = 0
  environment.window.StartersStarterEditProfile.authorizePersonalDetailsReplay(
    environment.form,
    { memberId: 'mem_test', email: 'new@example.com', onRejected: () => { rejected += 1 } },
  )
  environment.switchMember({
    id: 'mem_other',
    auth: { email: 'new@example.com' },
    customFields: {},
  })

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.equal(rejected, 1)
}

async function testReplayProofRejectsChangedMemberAtRevalidation() {
  const diagnostics = deferred()
  const environment = createEnvironment(async () => {
    throw new Error('fetch must not run')
  }, {
    workflowDiagnosticsReady: diagnostics.promise,
  })
  environment.window.MEMBER.auth.email = 'new@example.com'
  let rejected = 0
  environment.window.StartersStarterEditProfile.authorizePersonalDetailsReplay(
    environment.form,
    { memberId: 'mem_test', email: 'new@example.com', onRejected: () => { rejected += 1 } },
  )

  const submission = submit(environment)
  await new Promise(setImmediate)
  environment.switchMember({
    id: 'mem_other',
    auth: { email: 'new@example.com' },
    customFields: {},
  })
  diagnostics.resolve(null)
  await submission

  assert.equal(environment.requests.length, 0)
  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.equal(rejected, 1)
}

async function testInvalidReplayRequiresExactFreshMemberProofAfterCorrection() {
  const environment = createEnvironment(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }))
  environment.window.MEMBER.auth.email = 'new@example.com'
  environment.fields['[name="first-name"]'].value = ''
  let rejected = 0
  environment.window.StartersStarterEditProfile.authorizePersonalDetailsReplay(
    environment.form,
    { memberId: 'mem_test', email: 'new@example.com', onRejected: () => { rejected += 1 } },
  )
  const nextMember = {
    id: 'mem_other',
    auth: { email: 'other@example.com' },
    customFields: {},
  }
  environment.switchMember(nextMember)

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.equal(rejected, 1)

  environment.fields['[name="first-name"]'].value = 'Corrected'
  environment.window.StartersStarterEditProfile.authorizePersonalDetailsReplay(
    environment.form,
    { memberId: 'mem_other', email: 'new@example.com', onRejected: () => { rejected += 1 } },
  )

  await submit(environment)

  assert.equal(environment.requests.length, 0)
  assert.equal(rejected, 2)

  nextMember.auth.email = 'new@example.com'
  environment.window.StartersStarterEditProfile.authorizePersonalDetailsReplay(
    environment.form,
    { memberId: 'mem_other', email: 'new@example.com' },
  )

  await submit(environment)

  assert.equal(environment.requests.length, 1)
  assert.match(environment.requests[0][0], /\/mem_other$/)
  assert.equal(JSON.parse(environment.requests[0][1].body).Email, 'new@example.com')
}

Promise.all([
  testSuccess(),
  testLateLoadInitializesImmediately(),
  testInitialSameMemberAuthNotificationDoesNotRejectSave(),
  testInitialEmptyAuthNotificationDoesNotRejectCurrentMemberSave(),
  testInitialAuthNotificationForDifferentMemberInvalidatesSave(),
  testMemberSwitchBetweenBracketingReadsFailsBeforeRequestStage(),
  testSecondSaveStillFailsClosedWhenMemberSwitchesMidRequest(),
  testEarlyLoadInitializesCountersAfterParsing(),
  testNon2xx(),
  testSaveLifecycleUpdatesDirtyState(),
  testCanonicalSaveWithPendingProjectionNeverShowsWholeFormFailure(),
  testSuccessfulHttpWithoutCanonicalSaveConfirmationFailsClosed(),
  testCanonicalSaveWithoutExplicitProjectionStateFailsClosed(),
  testEveryOwnedSectionOpensSuccessModal(),
  testOptionalRatesPreserveCanonicalZeroSentinel(),
  testStepSixNeverWritesPaidCallAuthority(),
  testStepSixNeverWritesFreeCallAuthority(),
  testStepSixDisablesLegacyPaidCallControlsAndLinksCanonicalSettings(),
  testStepSixReappliesCallOwnershipAfterProfileHydration(),
  testPersonalDetailsUsesAuthoredContactControlsAndPreservesUntouchedCanonicalPhone(),
  testPhoneCountryChangeCountsAsAMemberEdit(),
  testEnabledOptionalRatesNeverSilentlyPersistZero(),
	testStepSixRejectsInvalidWholeDollarPricesBeforeFetch(),
	testStepSixPersistsExactPriceBoundaries(),
	testStepSixPriceContractSurvivesABlankServiceCaptureField(),
	testServiceFailuresExplainThemselvesInTheErrorModal(),
	testCollapsedRetainerSectionNeverBlocksStepSix(),
	testStepSixSavesAuthoredRatesWhileTheLiveFormatterIsPresent(),
	testClonedServicePriceRowsGetTheWholeDollarContract(),
	testStepSixPersistsEveryValidatedServiceSlot(),
  testHourlyRateUsesCanonicalZeroOnlyWhenOptional(),
  testConsultCanonicalZeroHourlyRateSurvivesSaveReloadSave(),
  testCorrectedPriceSavesAfterAReportedPriceFailure(),
  testAPriceMessageNeverSurvivesIntoAnUnrelatedFailure(),
  testAnAuthFailureNeverInheritsAPriceMessage(),
  testLegacyOutOfContractHourlyRateBlocksUntilTheMemberRepairsIt(),
  testClearingAServicePriceRemovesThatService(),
  testANonBlankMalformedServicePriceStillBlocksTheStep(),
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
  testInvalidNativeFieldReportsWithoutStartingRequest(),
  testEmptyMirrorFocusesAuthoredControlWithoutStartingRequest(),
  testMissingAuthoredMarkerFailsClosed(),
  testProfileHydrationMustFinishBeforeValidationCanWrite(),
  testProfileTypeSelectsOnlyItsOwnedMirrorBranch(),
  testProfileTypeOwnsSkillsToolsAndAvailabilityOnlyForFullProfiles(),
  testConditionalLocationRequirementTransitions(),
  testReviewerStepRejectsPartialTupleButAllowsEmptyOptionalSlots(),
  testDynamicRequiredCaptureBlocksBeforeLoading(),
  testPersonalDetailsValidationBoundary(),
  testReplayProofRejectsChangedMemberAtCapture(),
  testReplayProofRejectsChangedMemberAtRevalidation(),
  testInvalidReplayRequiresExactFreshMemberProofAfterCorrection(),
])
  .then(() => console.log('starter-edit-profile tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
