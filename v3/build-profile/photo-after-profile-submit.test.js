const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'submit-writer.js'), 'utf8')

function element() {
  const listeners = new Map()
  return {
    listeners,
    style: {},
    addEventListener(type, listener) { listeners.set(type, listener) },
    closest() { return this.step || null },
    querySelector() { return null },
  }
}

test('Build saves before its photo, reuses unchanged saves, and resaves changed retry payloads', async () => {
  const form = element()
  const submit = element()
  const success = element()
  const failure = element()
  const step = element()
  submit.step = step
  form.querySelector = (selector) => selector === '[form-submit]' ? submit : null

  let domReady
  let profileSaves = 0
  let photoAttempts = 0
  let photoPending = true
  const order = []
  const photoUpload = {
    hasPendingUpload: () => photoPending,
    markProfileSaved() { order.push('mark-profile-saved') },
    async commitPending() {
      photoAttempts += 1
      order.push(`photo-${photoAttempts}`)
      if (photoAttempts < 3) throw new Error('synthetic photo failure')
      photoPending = false
      return { starter_image: 'https://example.invalid/photo.jpg' }
    },
  }
  const fields = new Map([
    ['[build-profile-form]', form],
    ['[build-profile-success]', success],
    ['[build-profile-error]', failure],
  ])
  let firstName = 'Test'
  class TestFormData {
    *[Symbol.iterator]() {
      yield ['email', 'profile@example.invalid']
      yield ['first-name', firstName]
      yield ['last-name', 'Starter']
      yield ['phone', '']
    }
  }
  const window = {
    StartersBuildProfilePhotoUpload: photoUpload,
    intlTelInput: { getInstance: () => null },
    $memberstackDom: {
      async updateMember() {},
      async updateMemberAuth() {},
    },
  }
  const context = vm.createContext({
    window,
    document: { addEventListener(type, listener) { if (type === 'DOMContentLoaded') domReady = listener } },
    FormData: TestFormData,
    MEMBER: { id: 'member-1', auth: { email: 'profile@example.invalid' }, customFields: {} },
    activeProfile: { type: 'full-profile', type_id: 'full-profile-id' },
    qs(selector, root) {
      if (root === form && selector === '[form-submit]') return submit
      return fields.get(selector) || null
    },
    setLoader() {},
    waitForMember(callback) { callback() },
    xanoAuthFetch: async () => {
      profileSaves += 1
      order.push('profile-save')
      return {
        ok: true,
        async json() { return { saved: true } },
        async text() { return '' },
      }
    },
    console: { log() {}, warn() {}, error() {} },
    JSON,
    Math,
    Number,
    Object,
    Date,
  })
  window.window = window

  new vm.Script(source, { filename: 'submit-writer.js' }).runInContext(context)
  domReady()
  const click = submit.listeners.get('click')

  await assert.rejects(click({ preventDefault() {} }), /synthetic photo failure/)
  assert.equal(profileSaves, 1)
  assert.equal(photoAttempts, 1)
  assert.equal(failure.style.display, 'block')
  assert.equal(success.style.display, 'none')

  await assert.rejects(click({ preventDefault() {} }), /synthetic photo failure/)
  assert.equal(profileSaves, 1)
  assert.equal(photoAttempts, 2)
  assert.equal(failure.style.display, 'block')
  assert.equal(success.style.display, 'none')

  firstName = 'Changed'
  await click({ preventDefault() {} })
  assert.equal(profileSaves, 2)
  assert.equal(photoAttempts, 3)
  assert.equal(form.style.display, 'none')
  assert.equal(failure.style.display, 'none')
  assert.equal(success.style.display, 'block')
  assert.deepEqual(order, [
    'profile-save',
    'mark-profile-saved',
    'photo-1',
    'mark-profile-saved',
    'photo-2',
    'profile-save',
    'mark-profile-saved',
    'photo-3',
  ])
})

test('Build preserves canonical, draft, and mixed reviewer aliases on submit', async () => {
  const form = element()
  const submit = element()
  const success = element()
  const failure = element()
  submit.step = element()
  form.querySelector = (selector) => selector === '[form-submit]' ? submit : null

  let domReady
  let submittedPayload
  const fields = new Map([
    ['[build-profile-form]', form],
    ['[build-profile-success]', success],
    ['[build-profile-error]', failure],
  ])
  const reviewerValues = {
    reviewer: {
      'first-name': 'Legacy',
      'last-name': 'Reviewer',
      position: 'Director',
      company: 'Legacy Co',
      email: 'legacy@example.invalid',
    },
    'reviewer-2': {
      fname: 'Draft',
      lname: 'Reviewer',
      job: 'Lead',
      company: 'Draft Co',
      email: 'draft@example.invalid',
    },
    'reviewer-3': {
      fname: 'Mixed',
      'last-name': 'Reviewer',
      position: 'Advisor',
      company: 'Mixed Co',
      email: 'mixed@example.invalid',
    },
  }
  class TestFormData {
    *[Symbol.iterator]() {
      yield ['email', 'profile@example.invalid']
      yield ['first-name', 'Test']
      yield ['last-name', 'Starter']
      yield ['phone', '']
      for (const [name, value] of Object.entries(reviewerValues)) {
        yield [name, JSON.stringify(value)]
      }
    }
  }
  const window = {
    intlTelInput: { getInstance: () => null },
    $memberstackDom: {
      async updateMember() {},
      async updateMemberAuth() {},
    },
  }
  const context = vm.createContext({
    window,
    document: { addEventListener(type, listener) { if (type === 'DOMContentLoaded') domReady = listener } },
    FormData: TestFormData,
    MEMBER: { id: 'member-1', auth: { email: 'profile@example.invalid' }, customFields: {} },
    activeProfile: { type: 'consult', type_id: 'consult-id' },
    qs(selector, root) {
      if (root === form && selector === '[form-submit]') return submit
      return fields.get(selector) || null
    },
    setLoader() {},
    waitForMember(callback) { callback() },
    async xanoAuthFetch(_url, options) {
      submittedPayload = JSON.parse(options.body)
      return {
        ok: true,
        async json() { return { saved: true } },
        async text() { return '' },
      }
    },
    console: { log() {}, warn() {}, error() {} },
    JSON,
    Math,
    Number,
    Object,
    Date,
  })
  window.window = window

  new vm.Script(source, { filename: 'submit-writer.js' }).runInContext(context)
  domReady()
  await submit.listeners.get('click')({ preventDefault() {} })

  assert.deepEqual(submittedPayload.reviewers, {
    'reviewer-1': {
      'first-name': 'Legacy',
      'last-name': 'Reviewer',
      position: 'Director',
      company: 'Legacy Co',
      email: 'legacy@example.invalid',
    },
    'reviewer-2': {
      'first-name': 'Draft',
      'last-name': 'Reviewer',
      position: 'Lead',
      company: 'Draft Co',
      email: 'draft@example.invalid',
    },
    'reviewer-3': {
      'first-name': 'Mixed',
      'last-name': 'Reviewer',
      position: 'Advisor',
      company: 'Mixed Co',
      email: 'mixed@example.invalid',
    },
  })
})
