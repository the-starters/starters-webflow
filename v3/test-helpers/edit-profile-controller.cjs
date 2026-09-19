const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('../../starter-edit-profile.js'), 'utf8')
const diagnosticSource = fs.readFileSync(require.resolve('../../utils/workflow-diagnostics.js'), 'utf8')
const publishedContract = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../starter-edit-profile/published-form-contract.json'),
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
  removeAttribute(name) { this.attributes.delete(name) }
  focus() { this.focusCount += 1 }
  reportValidity() { this.reportValidityCount += 1; return this.checkValidity?.() ?? true }
  setCustomValidity(message) { this.validationMessage = String(message || '') }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child }
  insertBefore(child, reference) {
    const index = this.children.indexOf(reference)
    if (index < 0) return this.appendChild(child)
    this.children.splice(index, 0, child)
    child.parentElement = this
    return child
  }
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
  callRetainerShareWrapper = null,
  dirtyState = null,
  setupSection = null,
  profileReady = false,
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

  // A taxonomy picker wrapper: validity is the number of selected chips inside it.
  function createGroup(selector, chips) {
    const wrapper = Object.assign(new Target(), { chips }, fieldOverrides[selector] || {})
    wrapper.removeAttribute = (name) => { wrapper.attributes.delete(name) }
    wrapper.querySelectorAll = (sel) => sel === '[ms-code-select="tag"]' ? Array.from({ length: wrapper.chips }, () => new Target()) : []
    return wrapper
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
      '[select-wrap-entity="functions"]': createGroup('[select-wrap-entity="functions"]', 1),
      '[select-wrap-entity="roles"]': createGroup('[select-wrap-entity="roles"]', 1),
      '[select-wrap-entity="subcategories"]': createGroup('[select-wrap-entity="subcategories"]', 1),
    },
    2: {
      '#tagline': createField('#tagline', { value: 'Product strategist', required: publishedRequired(2, 'tagline') }),
      '#pro-headline': createField('#pro-headline', { value: 'Senior product strategist', required: publishedRequired(2, 'pro-headline') }),
      '#bio-html': createField('#bio-html', { value: '<p>Profile biography</p>' }),
    },
    5: {
      '[select-wrap-entity="skills"]': createGroup('[select-wrap-entity="skills"]', 3),
      '[select-wrap-entity="tools"]': createGroup('[select-wrap-entity="tools"]', 2),
    },
    6: {
      '[name="rate"]': createField('[name="rate"]', { value: '125', required: publishedRequired(6, 'rate') }),
      '[name="rate-retainer"]': createField('[name="rate-retainer"]', { value: '', required: false }),
      '#service': createField('#service', { value: '' }),
      '#service-2': createField('#service-2', { value: '' }),
      '#service-3': createField('#service-3', { value: '' }),
      '#availability-required': createField('#availability-required', { value: '1' }),
      '[select-wrap-entity="availability"]': createGroup('[select-wrap-entity="availability"]', 1),
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
  // Mirrors the authored step 6 Services markup: one `.app-form_input_group` per call
  // control, all of them plus the Retainer rate inside one shared Services container.
  // `callRetainerShareWrapper` reproduces the markup risk where a call control and the
  // Retainer rate live in the same authored group.
  const legacyCallContainer = new Target()
  const legacyCallGroups = []
  let retainerCallGroup = null
  if (stepIndex === 6) {
    const retainerField = stepFields['[name="rate-retainer"]']
    const containerControls = []
    const containerLabels = []
    const wireGroup = (group, members) => {
      const label = new Target()
      group.classNames.add('app-form_input_group')
      group.appendChild(label)
      members.forEach((member) => group.appendChild(member))
      group.querySelectorAll = (query) => {
        if (query === 'input, select, textarea') return members
        if (query === 'label') return [label]
        return []
      }
      containerControls.push(...members)
      containerLabels.push(label)
      legacyCallContainer.appendChild(group)
    }
    ;[
      '[name="free-consulting-calls"]',
      '[name="free-call-description"]',
      '[name="paid-consulting-calls"]',
      '[name="paid-call-description"]',
      '[name="paid-call-rate"]',
    ].forEach((selector) => {
      const group = new Target()
      const shared = callRetainerShareWrapper === selector
      wireGroup(group, shared ? [stepFields[selector], retainerField] : [stepFields[selector]])
      if (shared) retainerCallGroup = group
      legacyCallGroups.push(group)
    })
    if (!retainerCallGroup) {
      retainerCallGroup = new Target()
      wireGroup(retainerCallGroup, [retainerField])
    }
    legacyCallContainer.querySelectorAll = (query) => {
      if (query === 'input, select, textarea') return containerControls
      if (query === 'label') return containerLabels
      return []
    }
    step.appendChild(legacyCallContainer)
  }
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
    if (selector === '[data-call-settings-profile-notice]') {
      return legacyCallContainer.children.find((child) => child.hasAttribute('data-call-settings-profile-notice')) || null
    }
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
  const documentHead = new Target()
  documentHead.querySelector = (selector) => documentHead.children.find(
    (child) => child.hasAttribute(selector.replace(/^\[|\]$/g, '')),
  ) || null
  const document = {
    readyState: documentReadyState,
    head: documentHead,
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') domReady.push(listener)
    },
    createElement(tagName) { return Object.assign(new Target(), { tagName: String(tagName || '').toUpperCase() }) },
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
      // picker wrappers are document-scoped for the profile-type bound sync
      if (Object.prototype.hasOwnProperty.call(stepFields, selector) && selector.startsWith('[select-wrap-entity=')) return [stepFields[selector]]
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
  if (setupSection) setupSection({ context, window, document, step, button, form, stepFields })
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
  if (profileReady) profileDataCallbacks.forEach((callback) => callback(window.activeProfile))

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
    stepFields,
    legacyCallContainer,
    legacyCallGroups,
    retainerCallGroup,
    documentHead,
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


module.exports = { Target, createEnvironment, deferred, submit }
