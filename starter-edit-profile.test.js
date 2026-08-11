const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-edit-profile.js'), 'utf8')

class Target {
  constructor() {
    this.listeners = new Map()
    this.style = {}
    this.dataset = {}
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event) {
    return Promise.all((this.listeners.get(event.type) || []).map((listener) => listener(event)))
  }
}

function createEnvironment(fetchImpl) {
  const domReady = []
  const modalEvents = { success: 0, error: 0 }
  const memberAuthUpdates = []
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
  const step = Object.assign(new Target(), { dataset: { index: '1' } })
  const form = new Target()

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
  ]

  const successModal = new Target()
  const errorModal = new Target()
  successModal.addEventListener('click', () => { modalEvents.success += 1 })
  errorModal.addEventListener('click', () => { modalEvents.error += 1 })

  const document = {
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') domReady.push(listener)
    },
    querySelector(selector) {
      if (selector === '[build-profile-form]') return form
      if (selector === "[data-modal-trigger='edit-form-success']") return successModal
      if (selector === "[data-modal-trigger='edit-form-error']") return errorModal
      if (selector === '#email') return fields.email
      if (selector === '#phone' || selector === 'input[name="phone"]') return fields.phone
      if (selector === '[data-form="step"][data-index="1"]') return step
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-form="step"][data-index]') return [step]
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

  const window = {
    activeProfile: { type: 'full', type_id: 1 },
    MEMBER: {
      id: 'mem_test',
      auth: { email: 'old@example.com' },
      customFields: { 'free-user': '', 'last-name': '', phone: fields.phone.value },
    },
    waitProfileData() {},
    waitForMember(callback) { callback(this.MEMBER) },
    setTimeout() { return 1 },
    location: { replace() {} },
    intlTelInput: Object.assign(() => ({}), { getInstance: () => null }),
    $memberstackDom: {
      async updateMember() {},
      async updateMemberAuth(payload) { memberAuthUpdates.push(payload) },
    },
    FinsweetAttributes: [],
  }

  const context = vm.createContext({
    window,
    document,
    fetch: fetchImpl,
    FormData,
    Event,
    console,
    Promise,
    Date,
    setInterval: () => 1,
    clearInterval() {},
  })
  new vm.Script(source, { filename: 'starter-edit-profile.js' }).runInContext(context)
  domReady[0]()

  return { button, modalEvents, memberAuthUpdates }
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
  assert.equal(environment.button.style.pointerEvents, '')
  assert.equal(environment.button.style.opacity, '')
  assert.equal(environment.memberAuthUpdates.length, 0)
}

async function testNon2xx() {
  const environment = createEnvironment(async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: 'failed' }),
  }))

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.equal(environment.button.style.pointerEvents, '')
  assert.equal(environment.button.style.opacity, '')
}

async function testRejectedFetch() {
  const environment = createEnvironment(async () => {
    throw new TypeError('network failure')
  })

  await submit(environment)

  assert.deepEqual(environment.modalEvents, { success: 0, error: 1 })
  assert.equal(environment.button.style.pointerEvents, '')
  assert.equal(environment.button.style.opacity, '')
}

Promise.all([testSuccess(), testNon2xx(), testRejectedFetch()])
  .then(() => console.log('starter-edit-profile tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
