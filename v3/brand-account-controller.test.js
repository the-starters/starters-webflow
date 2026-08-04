const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./brand-account-controller.js'),
  'utf8',
)

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await flush()
}

function makeElement(value = '') {
  return {
    value,
    disabled: false,
    style: {},
    attributes: new Map(),
    setAttribute(name, next) {
      this.attributes.set(name, String(next))
    },
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null
    },
  }
}

function makeWrapper() {
  const done = makeElement()
  const fail = makeElement()
  const failText = { textContent: 'Original failure' }
  fail.querySelector = (selector) => (selector === 'div' ? failText : null)
  return {
    done,
    fail,
    failText,
    querySelector(selector) {
      if (selector === '.w-form-done') return done
      if (selector === '.w-form-fail') return fail
      return null
    },
  }
}

function makeForm(kind = 'build', values = {}) {
  const wrapper = makeWrapper()
  const submit = makeElement()
  const loading = makeElement()
  const inputs = new Map()

  if (kind === 'build') {
    inputs.set('[name="First-Name"]', makeElement(values.firstName || 'Ada'))
    inputs.set('[name="Last-Name"]', makeElement(values.lastName || 'Lovelace'))
    inputs.set('[name="Email-Address"]', makeElement(values.email || 'ada@example.com'))
    inputs.set('[name="Company-Name"]', makeElement(values.company || 'Analytical Engines'))
  } else {
    inputs.set('[data-ms-member="email"]', makeElement(values.email || 'ada@example.com'))
  }
  inputs.set('[type="submit"]', submit)
  inputs.set('[data-opp-element="loading-button"]', loading)

  const attributes = new Map([
    ['redirect', '/brand-dashboard'],
    ['data-redirect', '/brand-dashboard'],
  ])
  const listeners = new Map()
  let nativeSubmits = 0
  let nativeSubmitReady = true
  const form = {
    wrapper,
    submit,
    loading,
    inputs,
    listeners,
    querySelector(selector) {
      return inputs.get(selector) || null
    },
    closest(selector) {
      return selector === '.w-form' ? wrapper : null
    },
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null
    },
    addEventListener(type, listener, capture) {
      listeners.set(type, { listener, capture })
    },
    requestSubmit() {
      if (!nativeSubmitReady) return
      nativeSubmits += 1
      const record = listeners.get('submit')
      if (record) {
        record.listener({
          preventDefault() {},
          stopImmediatePropagation() {},
        })
      }
    },
    get nativeSubmits() {
      return nativeSubmits
    },
    submitEvent() {
      if (values.nativeSubmitNeedsMacrotask) {
        nativeSubmitReady = false
        setImmediate(() => {
          nativeSubmitReady = true
        })
      }
      const record = listeners.get('submit')
      if (!record) throw new Error('submit listener not bound')
      const event = {
        prevented: false,
        stopped: false,
        preventDefault() {
          this.prevented = true
        },
        stopImmediatePropagation() {
          this.stopped = true
        },
      }
      record.listener(event)
      return { event, capture: record.capture }
    },
  }
  return form
}

function loadController(options = {}) {
  const buildForm = options.buildForm === null ? null : options.buildForm || makeForm('build')
  const securityForm = options.securityForm || makeForm('security')
  const calls = []
  const tracked = []
  const redirects = []
  let longTimer = 0

  const member = options.member || {
    id: 'mem_sb_brand',
    auth: { email: options.currentEmail || 'old@example.com' },
  }

  const memberstack = {
    async getCurrentMember() {
      calls.push({ method: 'getCurrentMember' })
      if (options.getCurrentMember) return options.getCurrentMember()
      return { data: member }
    },
    async updateMember(payload) {
      calls.push({ method: 'updateMember', payload })
      if (options.updateMember) return options.updateMember(payload, calls)
      return { data: member }
    },
    async updateMemberAuth(payload) {
      calls.push({ method: 'updateMemberAuth', payload })
      if (options.updateMemberAuth) return options.updateMemberAuth(payload, calls)
      member.auth.email = payload.email
      return { data: member }
    },
    async sendMemberResetPasswordEmail(payload) {
      calls.push({ method: 'sendMemberResetPasswordEmail', payload })
      if (options.sendMemberResetPasswordEmail) {
        return options.sendMemberResetPasswordEmail(payload, calls)
      }
      return { ok: true }
    },
    async sendMemberVerificationEmail(payload) {
      calls.push({ method: 'sendMemberVerificationEmail', payload })
      return { ok: true }
    },
  }

  const location = {
    hostname: options.hostname || 'the-starters-3-0.webflow.io',
    pathname: options.pathname || '/complete-profile',
    assign(value) {
      redirects.push(value)
    },
  }
  const window = {
    location,
    $memberstackDom: memberstack,
    StartersBrandAccountConfig: options.config || {},
    StartersV3RouteGuard: options.routeGuard,
    StartersTrack: {
      track(name, payload) {
        tracked.push({ name, payload })
      },
    },
    setTimeout(fn, ms) {
      if (ms >= 10000) return ++longTimer
      return setImmediate(fn)
    },
    clearTimeout() {},
  }
  const document = {
    readyState: 'complete',
    querySelector(selector) {
      if (selector === '#wf-form-Complete-Profile-Form') return buildForm
      if (selector === '#wf-form-Account-Security') return securityForm
      return null
    },
    addEventListener() {},
  }
  const context = vm.createContext({
    window,
    document,
    Promise,
    Error,
    Number,
    String,
    console,
  })
  vm.runInContext(source, context)

  return {
    api: window.StartersBrandAccount,
    buildForm,
    calls,
    context,
    member,
    memberstack,
    redirects,
    securityForm,
    tracked,
    window,
  }
}

test('Build Account writes ordinary fields, changed email, then completion in order', async () => {
  const buildForm = makeForm('build', {
    firstName: ' Ada ',
    lastName: ' Lovelace ',
    email: 'ADA+NEW@EXAMPLE.COM ',
    company: ' Analytical Engines ',
  })
  const environment = loadController({ buildForm, currentEmail: 'old@example.com' })

  const submission = buildForm.submitEvent()
  assert.equal(submission.capture, true)
  assert.equal(submission.event.prevented, true)
  assert.equal(submission.event.stopped, true)
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    [
      'getCurrentMember',
      'updateMember',
      'updateMemberAuth',
      'updateMember',
      'sendMemberResetPasswordEmail',
    ],
  )
  assert.deepEqual(plain(environment.calls[1].payload), {
    customFields: {
      'free-user': 'Ada',
      'last-name': 'Lovelace',
      company: 'Analytical Engines',
    },
  })
  assert.deepEqual(plain(environment.calls[2].payload), { email: 'ada+new@example.com' })
  assert.deepEqual(plain(environment.calls[3].payload), {
    customFields: { 'completed-brand-profile': 'true' },
  })
  assert.deepEqual(plain(environment.calls[4].payload), { email: 'ada+new@example.com' })
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  assert.equal(buildForm.getAttribute('aria-busy'), 'false')
  assert.equal(buildForm.submit.disabled, false)
})

test('Build Account sends a reset password email without an unchanged auth mutation', async () => {
  const buildForm = makeForm('build', { email: 'ADA@EXAMPLE.COM' })
  const environment = loadController({ buildForm, currentEmail: 'ada@example.com' })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'updateMember', 'updateMember', 'sendMemberResetPasswordEmail'],
  )
  assert.deepEqual(plain(environment.calls[3].payload), { email: 'ada@example.com' })
})

test('invalid input performs no Memberstack mutation and exposes the authored error state', async () => {
  const buildForm = makeForm('build', { email: 'not-an-email' })
  const environment = loadController({ buildForm })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(environment.calls, [])
  assert.equal(buildForm.wrapper.fail.style.display, 'block')
  assert.equal(buildForm.wrapper.failText.textContent, 'Enter a valid email address.')
  assert.equal(environment.redirects.length, 0)
})

test('email collision leaves completion unset and reports a stable user-facing error', async () => {
  const buildForm = makeForm('build', { email: 'used@example.com' })
  const conflict = new Error('raw provider conflict')
  conflict.status = 409
  const environment = loadController({
    buildForm,
    updateMemberAuth: async () => {
      throw conflict
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'updateMember', 'updateMemberAuth'],
  )
  assert.equal(buildForm.wrapper.failText.textContent, 'That email is already in use. Choose another email address.')
  assert.equal(environment.redirects.length, 0)
  assert.deepEqual(plain(environment.tracked), [
    { name: 'bridge_error', payload: { path: 'brand/account/build', status: 409 } },
  ])
})

test('one transient ordinary-field failure retries without duplicating completion', async () => {
  const buildForm = makeForm('build', { email: 'old@example.com' })
  let ordinaryAttempts = 0
  const environment = loadController({
    buildForm,
    currentEmail: 'old@example.com',
    updateMember: async (payload) => {
      if (!payload.customFields['completed-brand-profile']) {
        ordinaryAttempts += 1
        if (ordinaryAttempts === 1) {
          const error = new Error('temporary')
          error.status = 503
          throw error
        }
      }
      return { ok: true }
    },
  })

  buildForm.submitEvent()
  await settle(12)

  assert.equal(ordinaryAttempts, 2)
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    1,
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('duplicate submit while the first request is pending is ignored', async () => {
  const buildForm = makeForm('build', { email: 'old@example.com' })
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  let firstOrdinary = true
  const environment = loadController({
    buildForm,
    currentEmail: 'old@example.com',
    updateMember: async (payload) => {
      if (firstOrdinary && !payload.customFields['completed-brand-profile']) {
        firstOrdinary = false
        await pending
      }
      return { ok: true }
    },
  })

  buildForm.submitEvent()
  buildForm.submitEvent()
  await settle(3)
  assert.equal(environment.calls.filter((call) => call.method === 'getCurrentMember').length, 1)

  release()
  await settle(8)
  assert.equal(environment.calls.filter((call) => call.method === 'getCurrentMember').length, 1)
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('Build Account sends one reset password email after changing auth', async () => {
  const buildForm = makeForm('build', { email: 'verified-next@example.com' })
  const environment = loadController({
    buildForm,
    currentEmail: 'old@example.com',
  })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    [
      'getCurrentMember',
      'updateMember',
      'updateMemberAuth',
      'updateMember',
      'sendMemberResetPasswordEmail',
    ],
  )
  assert.deepEqual(plain(environment.calls[4].payload), {
    email: 'verified-next@example.com',
  })
})

test('reset password email failure keeps durable completion and provides recovery copy', async () => {
  const buildForm = makeForm('build', { email: 'next@example.com' })
  const sendError = new Error('password email service unavailable')
  sendError.status = 503
  const environment = loadController({
    buildForm,
    currentEmail: 'old@example.com',
    sendMemberResetPasswordEmail: async () => {
      throw sendError
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    [
      'getCurrentMember',
      'updateMember',
      'updateMemberAuth',
      'updateMember',
      'sendMemberResetPasswordEmail',
    ],
  )
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    1,
  )
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    1,
  )
  assert.deepEqual(environment.redirects, [])
  assert.equal(buildForm.wrapper.fail.style.display, 'block')
  assert.equal(
    buildForm.wrapper.failText.textContent,
    'Your account changes were saved, but the password email could not be confirmed. Use Forgot Password to send a new link.',
  )
  assert.equal(buildForm.getAttribute('aria-busy'), 'false')
  assert.equal(buildForm.submit.disabled, false)
})

test('non-Error password email rejection still produces stable recovery copy', async () => {
  const buildForm = makeForm('build', { email: 'next@example.com' })
  const environment = loadController({
    buildForm,
    sendMemberResetPasswordEmail: async () => Promise.reject('response lost'),
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(
    buildForm.wrapper.failText.textContent,
    'Your account changes were saved, but the password email could not be confirmed. Use Forgot Password to send a new link.',
  )
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    1,
  )
})

test('Account Security interception remains off until explicitly configured', () => {
  const environment = loadController({ buildForm: null })
  assert.equal(environment.securityForm.listeners.has('submit'), false)
})

test('Brand Account Security owns the submit and skips an unchanged email', async () => {
  const securityForm = makeForm('security', { email: 'ada@example.com' })
  const environment = loadController({
    buildForm: null,
    securityForm,
    currentEmail: 'ada@example.com',
    config: { guardSecurityForm: 'brand' },
    routeGuard: { memberRole: () => 'brand-paid' },
  })

  const submission = securityForm.submitEvent()
  await settle()

  assert.equal(submission.event.prevented, true)
  assert.equal(submission.event.stopped, true)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember'],
  )
  assert.equal(securityForm.wrapper.done.style.display, 'block')
})

test('Brand Account Security changes email and sends reset password email once', async () => {
  const securityForm = makeForm('security', { email: 'next@example.com' })
  const environment = loadController({
    buildForm: null,
    securityForm,
    currentEmail: 'old@example.com',
    config: { guardSecurityForm: 'brand' },
    routeGuard: { memberRole: () => 'brand-paid' },
  })

  securityForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'sendMemberResetPasswordEmail'],
  )
  assert.deepEqual(plain(environment.calls[3].payload), { email: 'next@example.com' })
  assert.equal(securityForm.wrapper.done.style.display, 'block')
})

test('Brand-scoped Account Security binds Brand roles and sends only the reset password email', async () => {
  for (const role of ['brand-free', 'brand-paid']) {
    const securityForm = makeForm('security', { email: `${role}@example.com` })
    const environment = loadController({
      buildForm: null,
      securityForm,
      currentEmail: 'old@example.com',
      config: { guardSecurityForm: 'brand' },
      routeGuard: { memberRole: () => role },
    })

    await settle()
    assert.equal(securityForm.listeners.has('submit'), true)

    securityForm.submitEvent()
    await settle()

    assert.deepEqual(
      environment.calls.map((call) => call.method),
      [
        'getCurrentMember',
        'getCurrentMember',
        'updateMemberAuth',
        'sendMemberResetPasswordEmail',
      ],
    )
    assert.equal(
      environment.calls.some((call) => call.method === 'sendMemberVerificationEmail'),
      false,
    )
  }
})

test('Brand-scoped Account Security leaves Talent, unmapped, and conflicted roles Memberstack-native', async () => {
  for (const role of ['talent', null, 'conflicting-plan-roles']) {
    const securityForm = makeForm('security')
    const environment = loadController({
      buildForm: null,
      securityForm,
      config: { guardSecurityForm: 'brand' },
      routeGuard: { memberRole: () => role },
    })

    const submission = securityForm.submitEvent()
    await settle()

    assert.equal(submission.event.prevented, true)
    assert.equal(securityForm.nativeSubmits, 1)
    assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
  }
})

test('Brand-scoped Account Security leaves logged-out and unreadable roles Memberstack-native', async () => {
  for (const state of ['logged-out', 'unreadable']) {
    const securityForm = makeForm('security')
    const environment = loadController({
      buildForm: null,
      securityForm,
      config: { guardSecurityForm: 'brand' },
      getCurrentMember:
        state === 'logged-out' ? async () => ({ data: null }) : undefined,
      routeGuard: {
        memberRole() {
          if (state === 'unreadable') throw new Error('role lookup failed')
          throw new Error('role lookup must not run while logged out')
        },
      },
    })

    const submission = securityForm.submitEvent()
    await settle()

    assert.equal(submission.event.prevented, true)
    assert.equal(securityForm.nativeSubmits, 1)
    assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
  }
})

test('Brand-scoped Account Security does not claim the form without the shared role contract', async () => {
  const securityForm = makeForm('security')
  const environment = loadController({
    buildForm: null,
    securityForm,
    config: { guardSecurityForm: 'brand' },
  })

  securityForm.submitEvent()
  await settle()

  assert.equal(securityForm.nativeSubmits, 1)
  assert.deepEqual(environment.calls, [])
})

test('Brand-scoped Account Security rechecks role on every submit', async () => {
  let role = 'brand-paid'
  const securityForm = makeForm('security', { email: 'next@example.com' })
  const environment = loadController({
    buildForm: null,
    securityForm,
    config: { guardSecurityForm: 'brand' },
    routeGuard: { memberRole: () => role },
  })

  role = 'talent'
  securityForm.submitEvent()
  await settle()

  assert.equal(securityForm.nativeSubmits, 1)
  assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
})

test('non-Brand native replay waits until the intercepted browser submit task clears', async () => {
  const securityForm = makeForm('security', { nativeSubmitNeedsMacrotask: true })
  const environment = loadController({
    buildForm: null,
    securityForm,
    config: { guardSecurityForm: 'brand' },
    routeGuard: { memberRole: () => 'talent' },
  })

  securityForm.submitEvent()
  await settle()

  assert.equal(securityForm.nativeSubmits, 1)
  assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
})

test('Build Account sends no email until its completion write succeeds', async () => {
  let completionAttempts = 0
  const environment = loadController({
    currentEmail: 'old@example.com',
    updateMember: async (payload) => {
      if (payload.customFields['completed-brand-profile']) {
        completionAttempts += 1
        if (completionAttempts === 1) throw new Error('completion failed')
      }
      return { ok: true }
    },
  })

  environment.buildForm.submitEvent()
  await settle()
  environment.buildForm.submitEvent()
  await settle()

  assert.equal(completionAttempts, 2)
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    1,
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('Build Account does not retry an ambiguously acknowledged email on the same page', async () => {
  let messages = 0
  const environment = loadController({
    sendMemberResetPasswordEmail: async () => {
      messages += 1
      throw new Error('response lost after delivery')
    },
  })

  environment.buildForm.submitEvent()
  await settle()
  environment.buildForm.submitEvent()
  await settle()

  assert.equal(messages, 1)
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('Account Security suppresses an A-B-A replay after ambiguous email sends', async () => {
  let deliveries = 0
  const securityForm = makeForm('security', { email: 'a@example.com' })
  const environment = loadController({
    buildForm: null,
    securityForm,
    config: { guardSecurityForm: 'brand' },
    routeGuard: { memberRole: () => 'brand-paid' },
    sendMemberResetPasswordEmail: async () => {
      deliveries += 1
      throw new Error('delivery unavailable')
    },
  })

  securityForm.submitEvent()
  await settle()
  securityForm.inputs.get('[data-ms-member="email"]').value = 'B@EXAMPLE.COM'
  securityForm.submitEvent()
  await settle()
  securityForm.inputs.get('[data-ms-member="email"]').value = ' A@EXAMPLE.COM '
  securityForm.submitEvent()
  await settle()

  assert.equal(deliveries, 2)
  assert.equal(
    environment.calls.filter((call) => call.method === 'updateMemberAuth').length,
    3,
  )
  assert.equal(securityForm.wrapper.done.style.display, 'block')
})

test('controller does not bind on an unapproved host', () => {
  const environment = loadController({ hostname: 'lookalike.example' })
  assert.equal(environment.buildForm.listeners.has('submit'), false)
})
