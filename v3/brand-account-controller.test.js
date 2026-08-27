const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./brand-account-controller.js'),
  'utf8',
)
const diagnosticSource = fs.readFileSync(
  require.resolve('../utils/workflow-diagnostics.js'),
  'utf8',
)

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
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
    textContent: '',
    disabled: false,
    style: {},
    attributes: new Map(),
    listeners: new Map(),
    setAttribute(name, next) {
      this.attributes.set(name, String(next))
    },
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null
    },
    addEventListener(name, listener) {
      this.listeners.set(name, listener)
    },
  }
}

function makeWrapper() {
  const done = makeElement()
  done.textContent = 'Your authored success message.'
  const fail = makeElement()
  const failText = makeElement()
  failText.textContent = 'Original failure'
  fail.querySelector = (selector) => (selector.includes('div') ? failText : null)
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
  } else if (kind === 'security') {
    inputs.set('[data-ms-member="email"]', makeElement(values.email || 'ada@example.com'))
  } else {
    const emailInput = makeElement(values.email || 'ada@example.com')
    emailInput.checkValidity = () => values.emailValid !== false
    inputs.set('input[type="email"]', emailInput)
  }
  inputs.set('[type="submit"]', submit)
  inputs.set('[data-opp-element="loading-button"]', loading)

  const attributes = new Map([
    ['redirect', '/brand-dashboard'],
    ['data-redirect', '/brand-dashboard'],
  ])
  const listeners = new Map()
  let nativeSubmits = 0
  let nativeClicks = 0
  let nativeSubmitReady = true
  let validityReports = 0
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
    checkValidity() {
      return values.valid !== false
    },
    reportValidity() {
      validityReports += 1
      return values.valid !== false
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
    get nativeClicks() {
      return nativeClicks
    },
    get validityReports() {
      return validityReports
    },
    clickSubmit(target = submit) {
      const record = listeners.get('click')
      if (!record) throw new Error('click listener not bound')
      const event = {
        target,
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
    inputEmail(value, isTrusted = true) {
      const input = inputs.get('input[type="email"]')
      if (!input) throw new Error('email input not found')
      input.value = value
      const listener = input.listeners.get('input')
      if (listener) listener({ isTrusted })
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
  submit.click = () => {
    nativeClicks += 1
  }
  return form
}

function loadController(options = {}) {
  const buildForm = options.buildForm === null ? null : options.buildForm || makeForm('build')
  const securityForm = options.securityForm || makeForm('security')
  const starterProfileForm = options.starterProfileForm || null
  const signupForm = options.signupForm || null
  const quizSignupForm = options.quizSignupForm || null
  const calls = []
  const tracked = []
  const redirects = []
  const starterReplayProofs = []
  let longTimer = 0
  const mutationObservers = []

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
  // The same-tab completion marker the routers read. A recording store rather
  // than a real one, so a test can assert both the key/value written and the
  // Safari-private-mode case where the setter itself throws.
  const storage = new Map()
  const storageWrites = []
  const sessionStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null
    },
    setItem(key, value) {
      storageWrites.push({ key, value })
      if (options.sessionStorageThrows) {
        throw new DOMException('', 'SecurityError')
      }
      storage.set(key, String(value))
    },
    removeItem(key) {
      storage.delete(key)
    },
  }

  const window = {
    location,
    // Omitted entirely for the harsher storage case: reading the property is
    // itself what throws in Safari private mode, so the controller's try/catch
    // has to cover the lookup and not just the write.
    sessionStorage: options.sessionStorageMissing ? undefined : sessionStorage,
    $memberstackDom: options.memberstackMissing ? undefined : memberstack,
    StartersBrandAccountConfig: options.config || {},
    StartersV3RouteGuard: options.routeGuard,
    StartersStarterEditProfile: Object.assign({
      validatePersonalDetails() {
        return {
          valid:
            !starterProfileForm ||
            typeof starterProfileForm.checkValidity !== 'function' ||
            starterProfileForm.checkValidity(),
        }
      },
      authorizePersonalDetailsReplay(form, proof) {
        starterReplayProofs.push({ form, proof })
        return true
      },
      clearPersonalDetailsReplay() {},
    }, options.starterEditProfile || {}),
    StartersTrack: {
      track(name, payload) {
        tracked.push({ name, payload })
        if (options.trackThrows) throw new Error('analytics transport unavailable')
      },
    },
    setTimeout(fn, ms) {
      if (options.setTimeout) return options.setTimeout(fn, ms)
      if (ms >= 10000) return ++longTimer
      return setImmediate(fn)
    },
    clearTimeout() {},
    MutationObserver: options.mutationObserver === false
      ? undefined
      : class {
          constructor(callback) {
            this.callback = callback
            this.connected = false
            this.observeOptions = null
            mutationObservers.push(this)
          }
          observe(target, observeOptions) {
            this.connected = true
            this.target = target
            this.observeOptions = observeOptions
          }
          disconnect() {
            this.connected = false
          }
          trigger() {
            this.callback([])
          }
        },
  }
  if (options.diagnosticsReady) window.__startersWorkflowDiagnosticsReady = options.diagnosticsReady
  const document = {
    readyState: 'complete',
    documentElement: makeElement(),
    querySelector(selector) {
      if (selector === '#wf-form-Complete-Profile-Form') return buildForm
      if (selector === '#wf-form-Account-Security') return securityForm
      if (selector === '#wf-form-Build-Form-Full-Profile') return starterProfileForm
      if (selector === '#wf-form-Brand-Signup') return signupForm
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-quiz-form="signup"][data-ms-form="signup"]') {
        return [quizSignupForm].filter(Boolean)
      }
      if (selector === '#wf-form-Brand-Signup, [data-quiz-form="signup"][data-ms-form="signup"]') {
        return [signupForm, quizSignupForm].filter(Boolean)
      }
      return []
    },
    addEventListener() {},
  }
  const appendedScripts = []
  if (options.captureNativeDiagnosticsLoader) {
    document.currentScript = {
      src: options.controllerScriptSrc
        || 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/v3/brand-account-controller.js',
    }
    document.createElement = () => makeElement()
    document.head = { appendChild(script) { appendedScripts.push(script) } }
    const querySelector = document.querySelector.bind(document)
    document.querySelector = (selector) => {
      if (selector === 'script[data-starters-native-form-diagnostics]') {
        return appendedScripts.find((script) => (
          script.getAttribute('data-starters-native-form-diagnostics') !== null
        )) || null
      }
      return querySelector(selector)
    }
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
  if (options.diagnostics) {
    window.Date = Date
    window.Math = Math
    window.Uint32Array = Uint32Array
    window.crypto = { randomUUID: () => '12345678-90ab-cdef-1234-567890abcdef' }
    window.navigator = { clipboard: { writeText: async () => {} } }
    vm.runInContext(diagnosticSource, context)
  }
  vm.runInContext(source, context)

  return {
    api: window.StartersBrandAccount,
    appendedScripts,
    buildForm,
    calls,
    context,
    document,
    member,
    memberstack,
    mutationObservers,
    redirects,
    securityForm,
    starterProfileForm,
    signupForm,
    quizSignupForm,
    storage,
    storageWrites,
    tracked,
    starterReplayProofs,
    window,
  }
}

const MARKER_KEY = 'thestarters:v3-brand-profile-completed'

test('Brand signup uses the Test Brand plan on the Webflow staging hostname', () => {
  const signupForm = makeElement()
  signupForm.setAttribute('data-ms-form', 'signup')
  signupForm.setAttribute('data-ms-plan:add', 'pln_free-plan-f6kn0dxz')

  loadController({ buildForm: null, signupForm })

  assert.equal(
    signupForm.getAttribute('data-ms-plan:add'),
    'pln_dorxata-test-brand-plan-777r02pa',
  )
})

test('Brand signup keeps the live Brand Free plan on production hostnames', () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const signupForm = makeElement()
    signupForm.setAttribute('data-ms-form', 'signup')
    signupForm.setAttribute('data-ms-plan:add', 'pln_dorxata-test-brand-plan-777r02pa')

    loadController({ buildForm: null, hostname, signupForm })

    assert.equal(signupForm.getAttribute('data-ms-plan:add'), 'pln_free-plan-f6kn0dxz')
  }
})

test('Quiz email signup receives the live Brand Free plan', () => {
  const quizSignupForm = makeElement()
  quizSignupForm.setAttribute('data-ms-form', 'signup')

  loadController({ buildForm: null, hostname: 'thestarters.com', quizSignupForm })

  assert.equal(quizSignupForm.getAttribute('data-ms-plan:add'), 'pln_free-plan-f6kn0dxz')
})

test('Late quiz signup receives Brand Free after a standard signup is configured', () => {
  const signupForm = makeElement()
  signupForm.setAttribute('data-ms-form', 'signup')
  const environment = loadController({
    buildForm: null,
    hostname: 'thestarters.com',
    pathname: '/quiz',
    signupForm,
  })

  assert.equal(signupForm.getAttribute('data-ms-plan:add'), 'pln_free-plan-f6kn0dxz')
  assert.equal(environment.mutationObservers.length, 1)
  assert.equal(environment.mutationObservers[0].connected, true)
  environment.mutationObservers[0].trigger()
  assert.equal(environment.mutationObservers[0].connected, true)

  const quizSignupForm = makeElement()
  quizSignupForm.setAttribute('data-ms-form', 'signup')
  environment.document.querySelectorAll = (selector) => {
    if (selector === '[data-quiz-form="signup"][data-ms-form="signup"]') {
      return [quizSignupForm]
    }
    if (selector === '#wf-form-Brand-Signup, [data-quiz-form="signup"][data-ms-form="signup"]') {
      return [signupForm, quizSignupForm]
    }
    return []
  }

  assert.deepEqual(plain(environment.mutationObservers[0].observeOptions), {
    childList: true,
    subtree: true,
  })

  environment.mutationObservers[0].trigger()

  assert.equal(quizSignupForm.getAttribute('data-ms-plan:add'), 'pln_free-plan-f6kn0dxz')
  assert.equal(environment.mutationObservers[0].connected, false)
})

test('All Brand signup forms on a page receive the matching plan', () => {
  const signupForm = makeElement()
  signupForm.setAttribute('data-ms-form', 'signup')
  const quizSignupForm = makeElement()
  quizSignupForm.setAttribute('data-ms-form', 'signup')

  loadController({
    buildForm: null,
    hostname: 'the-starters-3-0.webflow.io',
    signupForm,
    quizSignupForm,
  })

  assert.equal(
    signupForm.getAttribute('data-ms-plan:add'),
    'pln_dorxata-test-brand-plan-777r02pa',
  )
  assert.equal(
    quizSignupForm.getAttribute('data-ms-plan:add'),
    'pln_dorxata-test-brand-plan-777r02pa',
  )
})

test('Brand signup plan guard ignores a form without the Memberstack signup contract', () => {
  const signupForm = makeElement()
  signupForm.setAttribute('data-ms-plan:add', 'designer-authored-value')

  loadController({ buildForm: null, signupForm })

  assert.equal(signupForm.getAttribute('data-ms-plan:add'), 'designer-authored-value')
})

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
      'getCurrentMember',
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
  assert.deepEqual(plain(environment.calls[3].payload), { email: 'ada+new@example.com' })
  assert.deepEqual(plain(environment.calls[4].payload), {
    customFields: { 'completed-brand-profile': 'true' },
  })
  assert.deepEqual(plain(environment.calls[5].payload), { email: 'ada+new@example.com' })
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  // A redirect was initiated, so the form stays busy until the page unloads.
  // See the `redirecting` flag in bindForm() for why.
  assert.equal(buildForm.getAttribute('aria-busy'), 'true')
  assert.equal(buildForm.submit.disabled, true)
})

test('Build Account refuses an email write after the signed-in member changes', async () => {
  const buildForm = makeForm('build', { email: 'next@example.com' })
  let current = {
    id: 'mem-brand-a',
    auth: { email: 'old@example.com' },
  }
  const environment = loadController({
    buildForm,
    getCurrentMember: async () => ({ data: current }),
    updateMember: async (payload) => {
      if (!payload.customFields['completed-brand-profile']) {
        current = {
          id: 'mem-brand-b',
          auth: { email: 'other@example.com' },
        }
      }
      return { ok: true }
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'updateMember', 'getCurrentMember'],
  )
  assert.equal(buildForm.wrapper.fail.style.display, 'block')
  assert.match(buildForm.wrapper.failText.textContent, /signed-in account changed/i)
  assert.deepEqual(environment.redirects, [])
})

test('Build Account success records a privacy-safe console receipt without page diagnostics', async () => {
  const buildForm = makeForm('build', { email: 'private@example.com' })
  const environment = loadController({
    buildForm,
    currentEmail: 'private@example.com',
    diagnostics: true,
  })

  buildForm.submitEvent()
  await settle()

  const receipt = buildForm.__startersAccountDiagnostic
  assert.equal(receipt.workflow, 'brand_account_build')
  assert.equal(receipt.controller_version, 'brand-account-controller-v2')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.request_started, true)
  assert.equal(Object.hasOwn(receipt, 'email'), false)
  assert.equal(Object.hasOwn(receipt, 'firstName'), false)
  assert.equal(buildForm.wrapper.done.textContent, 'Your authored success message.')
  assert.equal(buildForm.wrapper.done.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.ok(environment.tracked.some((event) => event.name === 'workflow_form_submit_succeeded'))
  assert.deepEqual(
    plain(environment.tracked.filter((event) => event.name === 'brand_account_email_decision')),
    [{
      name: 'brand_account_email_decision',
      payload: {
        controller_version: 'brand-account-controller-v2',
        email_change_required: false,
        security_email_attempted: false,
      },
    }],
  )
})

test('Build Account changed-email success keeps the receipt free of identity fields', async () => {
  const buildForm = makeForm('build', { email: 'private@example.com' })
  const environment = loadController({
    buildForm,
    currentEmail: 'old@example.com',
    diagnostics: true,
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(
    environment.calls.filter((call) => call.method === 'updateMemberAuth').length,
    1,
  )
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    1,
  )
  const receipt = buildForm.__startersAccountDiagnostic
  assert.equal(receipt.workflow, 'brand_account_build')
  assert.equal(receipt.controller_version, 'brand-account-controller-v2')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.request_started, true)
  assert.equal(Object.hasOwn(receipt, 'email'), false)
  assert.equal(Object.hasOwn(receipt, 'firstName'), false)
})

test('Build Account validation receipt truthfully records that no request started', async () => {
  const buildForm = makeForm('build')
  buildForm.inputs.get('[name="First-Name"]').value = ''
  const environment = loadController({ buildForm, diagnostics: true })

  buildForm.submitEvent()
  await settle()

  const receipt = buildForm.__startersAccountDiagnostic
  assert.equal(receipt.result, 'failed')
  assert.equal(receipt.stage, 'validation')
  assert.equal(receipt.error_code, 'FORM_VALIDATION')
  assert.equal(receipt.request_started, false)
  assert.equal(environment.calls.length, 0)
  assert.equal(buildForm.wrapper.failText.textContent, 'First name is required.')
  assert.equal(buildForm.wrapper.failText.getAttribute('data-workflow-diagnostic-copy'), null)
})

test('Build Account setup failure records that no Memberstack request started', async () => {
  const buildForm = makeForm('build')
  const environment = loadController({ buildForm, diagnostics: true, memberstackMissing: true })

  buildForm.submitEvent()
  await settle()

  assert.equal(buildForm.__startersAccountDiagnostic.result, 'failed')
  assert.equal(buildForm.__startersAccountDiagnostic.request_started, false)
  assert.equal(environment.calls.length, 0)
})

test('a stalled shared diagnostics loader fails open before Build Account requests', async () => {
  const environment = loadController({
    diagnosticsReady: new Promise(() => {}),
  })

  environment.buildForm.submitEvent()
  await settle()

  assert.equal(environment.calls[0].method, 'getCurrentMember')
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('a helper loaded after diagnostics timeout does not fabricate a receipt', async () => {
  const memberReady = deferred()
  const environment = loadController({
    diagnosticsReady: Promise.resolve(null),
    getCurrentMember: () => memberReady.promise,
  })

  environment.buildForm.submitEvent()
  await flush()
  vm.runInContext(diagnosticSource, environment.context)
  memberReady.resolve({ data: environment.member })
  await settle()

  assert.equal(environment.window.__startersWorkflowDiagnosticLast, undefined)
  assert.equal(environment.buildForm.__startersAccountDiagnostic, undefined)
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

// --- The redirect busy latch --------------------------------------------------
//
// Rationale lives at the `redirecting` flag in bindForm(). These three tests pin
// its boundary: latched on the path that called assign, released on the two that
// leave the member here. v3/complete-profile-loader.js watches this attribute.

test('a successful submit that initiated a redirect stays busy until the page unloads', async () => {
  const environment = loadController({ currentEmail: 'old@example.com' })

  environment.buildForm.submitEvent()
  await settle()

  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  assert.equal(environment.buildForm.getAttribute('aria-busy'), 'true')
  assert.equal(environment.buildForm.submit.disabled, true)
  // The button's own spinner keeps spinning through the navigation too.
  assert.equal(
    environment.buildForm.loading.getAttribute('data-opp-loading'),
    'true',
  )
})

test('a successful submit with no redirect URL still releases the form', async () => {
  // Same success path, but nothing to navigate to — the latch must not fire, or
  // a member on a form with no redirect attribute would be locked out of it.
  const environment = loadController({ currentEmail: 'old@example.com' })
  environment.buildForm.setAttribute('redirect', '')
  environment.buildForm.setAttribute('data-redirect', '')

  environment.buildForm.submitEvent()
  await settle()

  assert.deepEqual(environment.redirects, [])
  assert.equal(environment.buildForm.getAttribute('aria-busy'), 'false')
  assert.equal(environment.buildForm.submit.disabled, false)
})

test('a failed submit releases the form, because the member is staying on it', async () => {
  const environment = loadController({
    currentEmail: 'old@example.com',
    updateMember: async () => {
      throw new Error('completion failed')
    },
  })

  environment.buildForm.submitEvent()
  await settle()

  assert.deepEqual(environment.redirects, [])
  assert.equal(environment.buildForm.getAttribute('aria-busy'), 'false')
  assert.equal(environment.buildForm.submit.disabled, false)
})

// --- Completion marker (same-tab half of the completion contract) -------------

test('a successful completion write stamps the sessionStorage marker', async () => {
  const environment = loadController({ currentEmail: 'old@example.com' })

  environment.buildForm.submitEvent()
  await settle()

  assert.equal(environment.storage.get(MARKER_KEY), '1')
  // Exactly one write, with the key the reading modules look for.
  assert.deepEqual(environment.storageWrites, [{ key: MARKER_KEY, value: '1' }])
  // The exported contract, so a reader pinning this key is pinning the writer's.
  assert.equal(environment.api.brandProfileMarkerKey, MARKER_KEY)
  assert.equal(environment.api.brandProfileMarkerValue, '1')
  // Written after completion is durable and before the changed-email security
  // message, so a delivery failure still counts as done in this tab.
  const methods = environment.calls.map((call) => call.method)
  assert.equal(methods[methods.length - 1], 'sendMemberResetPasswordEmail')
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('a marker write that throws does not disturb the rest of the submit', async () => {
  // Safari private mode, in both of its shapes: a setter that throws, and a
  // sessionStorage property that cannot even be read.
  for (const options of [
    { sessionStorageThrows: true },
    { sessionStorageMissing: true },
  ]) {
    const environment = loadController(
      Object.assign({ currentEmail: 'old@example.com' }, options),
    )

    environment.buildForm.submitEvent()
    await settle()

    assert.deepEqual(
      environment.calls.map((call) => call.method),
      [
        'getCurrentMember',
        'updateMember',
        'getCurrentMember',
        'updateMemberAuth',
        'updateMember',
        'sendMemberResetPasswordEmail',
      ],
      JSON.stringify(options),
    )
    assert.deepEqual(environment.redirects, ['/brand-dashboard'], JSON.stringify(options))
    // Success state, not the authored failure state: the marker is a courtesy.
    assert.equal(environment.buildForm.wrapper.done.style.display, 'block')
    assert.equal(environment.buildForm.wrapper.fail.style.display, 'none')
    assert.equal(environment.storage.has(MARKER_KEY), false, JSON.stringify(options))
  }
})

test('a rejected completion write leaves the marker unset', async () => {
  // The marker must never claim more than the durable write achieved, or the
  // routers would wave a member past a form Xano still has as unfinished.
  const environment = loadController({
    currentEmail: 'old@example.com',
    updateMember: async (payload) => {
      if (payload.customFields['completed-brand-profile']) {
        throw new Error('completion failed')
      }
      return { ok: true }
    },
  })

  environment.buildForm.submitEvent()
  await settle()

  assert.deepEqual(environment.storageWrites, [])
  assert.equal(environment.storage.has(MARKER_KEY), false)
  // And the submit failed loudly rather than quietly succeeding.
  assert.equal(environment.buildForm.wrapper.fail.style.display, 'block')
  assert.deepEqual(environment.redirects, [])
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail')
      .length,
    0,
  )
})

test('Build Account does not send a password email when login email is unchanged', async () => {
  const buildForm = makeForm('build', { email: 'ADA@EXAMPLE.COM' })
  const environment = loadController({ buildForm, currentEmail: 'ada@example.com' })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'updateMember', 'updateMember'],
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
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
    [
      'getCurrentMember',
      'updateMember',
      'getCurrentMember',
      'updateMemberAuth',
      'getCurrentMember',
    ],
  )
  assert.equal(buildForm.wrapper.failText.textContent, 'That email is already in use. Choose another email address.')
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
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

test('Build Account sends one security email only after changing login email', async () => {
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
      'getCurrentMember',
      'updateMemberAuth',
      'updateMember',
      'sendMemberResetPasswordEmail',
    ],
  )
  assert.deepEqual(plain(environment.calls[3].payload), { email: 'verified-next@example.com' })
  assert.deepEqual(plain(environment.calls[5].payload), { email: 'verified-next@example.com' })
  assert.deepEqual(
    plain(environment.tracked.filter((event) => event.name === 'brand_account_email_decision')),
    [{
      name: 'brand_account_email_decision',
      payload: {
        controller_version: 'brand-account-controller-v2',
        email_change_required: true,
        security_email_attempted: true,
      },
    }],
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('a throwing tracker cannot cost an unchanged-email submit its redirect', async () => {
  const buildForm = makeForm('build', { email: 'ada@example.com' })
  const environment = loadController({
    buildForm,
    currentEmail: 'ada@example.com',
    trackThrows: true,
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  assert.equal(buildForm.wrapper.done.style.display, 'block')
  assert.equal(buildForm.wrapper.fail.style.display, 'none')
  assert.equal(
    environment.tracked.filter((event) => event.name === 'brand_account_email_decision').length,
    1,
  )
})

test('a throwing tracker cannot cost a changed-email submit its ownership email or redirect', async () => {
  const buildForm = makeForm('build', { email: 'next@example.com' })
  const environment = loadController({
    buildForm,
    currentEmail: 'old@example.com',
    trackThrows: true,
  })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    [
      'getCurrentMember',
      'updateMember',
      'getCurrentMember',
      'updateMemberAuth',
      'updateMember',
      'sendMemberResetPasswordEmail',
    ],
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  assert.equal(buildForm.wrapper.done.style.display, 'block')
  assert.equal(buildForm.wrapper.fail.style.display, 'none')
})

test('Build Account with an unreadable login email writes no auth email and sends none', async () => {
  const buildForm = makeForm('build', { email: 'next@example.com' })
  const environment = loadController({
    buildForm,
    member: { id: 'mem_sb_brand' },
  })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    [
      'getCurrentMember',
      'updateMember',
      'updateMember',
    ],
  )
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    1,
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  assert.deepEqual(
    plain(environment.tracked.filter((event) => event.name === 'brand_account_email_decision')),
    [{
      name: 'brand_account_email_decision',
      payload: {
        controller_version: 'brand-account-controller-v2',
        email_change_required: false,
        security_email_attempted: false,
      },
    }],
  )
})

test('unavailable reset-email API does not affect onboarding with an unchanged email', async () => {
  const buildForm = makeForm('build', { email: 'ada@example.com' })
  const environment = loadController({
    buildForm,
    currentEmail: 'ada@example.com',
    sendMemberResetPasswordEmail: async () => {
      throw new Error('must not be called')
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    [
      'getCurrentMember',
      'updateMember',
      'updateMember',
    ],
  )
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    1,
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  assert.equal(buildForm.wrapper.done.style.display, 'block')
  assert.equal(buildForm.wrapper.fail.style.display, 'none')
})

test('changed-email reset failure keeps durable completion and provides recovery copy', async () => {
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
  assert.deepEqual(
    plain(environment.tracked.filter((event) => event.name === 'brand_account_email_decision')),
    [{
      name: 'brand_account_email_decision',
      payload: {
        controller_version: 'brand-account-controller-v2',
        email_change_required: true,
        security_email_attempted: true,
      },
    }],
  )
})

test('non-Error changed-email rejection still produces stable recovery copy', async () => {
  const buildForm = makeForm('build', { email: 'next@example.com' })
  const environment = loadController({
    buildForm,
    currentEmail: 'old@example.com',
    sendMemberResetPasswordEmail: async () => Promise.reject('response lost'),
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    1,
  )
  assert.equal(
    buildForm.wrapper.failText.textContent,
    'Your account changes were saved, but the password email could not be confirmed. Use Forgot Password to send a new link.',
  )
  assert.deepEqual(environment.redirects, [])
})

test('a landed auth write answered with 409 completes on the same submit', async () => {
  // The reported ambiguity: Memberstack claimed the address, the retry came back
  // 409 for an address this member now owns, so the change is only observable on
  // a fresh read of the member.
  let authAttempts = 0
  const member = { id: 'mem_sb_brand', auth: { email: 'old@example.com' } }
  const buildForm = makeForm('build', { email: 'moved@example.com' })
  const environment = loadController({
    buildForm,
    member,
    updateMemberAuth: async (payload) => {
      authAttempts += 1
      member.auth.email = payload.email
      const conflict = new Error('That email is already in use.')
      conflict.status = 409
      throw conflict
    },
  })

  buildForm.submitEvent()
  await settle()

  const emails = environment.calls.filter(
    (call) => call.method === 'sendMemberResetPasswordEmail',
  )
  assert.equal(authAttempts, 1)
  assert.equal(emails.length, 1)
  assert.deepEqual(plain(emails[0].payload), { email: 'moved@example.com' })
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    1,
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
  assert.equal(buildForm.wrapper.fail.style.display, 'none')
})

test('a 409 from an address this member does not own keeps the conflict', async () => {
  const member = { id: 'mem_sb_brand', auth: { email: 'old@example.com' } }
  const buildForm = makeForm('build', { email: 'taken@example.com' })
  const environment = loadController({
    buildForm,
    member,
    updateMemberAuth: async () => {
      const conflict = new Error('raw provider conflict')
      conflict.status = 409
      throw conflict
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    0,
  )
  assert.equal(
    buildForm.wrapper.failText.textContent,
    'That email is already in use. Choose another email address.',
  )
  assert.deepEqual(environment.redirects, [])
})

test('a 409 after the signed-in member changed reports the account-scope change', async () => {
  const member = { id: 'mem_sb_brand', auth: { email: 'old@example.com' } }
  const buildForm = makeForm('build', { email: 'moved@example.com' })
  let reads = 0
  const environment = loadController({
    buildForm,
    member,
    getCurrentMember: async () => {
      reads += 1
      // The re-read that settles the ambiguity lands in a different session.
      if (reads > 2) return { data: { id: 'mem_sb_other', auth: { email: 'moved@example.com' } } }
      return { data: member }
    },
    updateMemberAuth: async (payload) => {
      member.auth.email = payload.email
      const conflict = new Error('That email is already in use.')
      conflict.status = 409
      throw conflict
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    0,
  )
  assert.equal(
    buildForm.wrapper.failText.textContent,
    'Your signed-in account changed. Refresh and try again.',
  )
  assert.deepEqual(environment.redirects, [])
})

test('a failed reconciliation read keeps the conflict without retrying the read', async () => {
  // The probe exists to settle one ambiguity, so it gets one bounded look: a
  // member facing a genuine conflict must not wait out the retry ladder first.
  const member = { id: 'mem_sb_brand', auth: { email: 'old@example.com' } }
  const buildForm = makeForm('build', { email: 'taken@example.com' })
  let reads = 0
  const environment = loadController({
    buildForm,
    member,
    getCurrentMember: async () => {
      reads += 1
      if (reads > 2) {
        const unreadable = new Error('member lookup unavailable')
        unreadable.status = 503
        throw unreadable
      }
      return { data: member }
    },
    updateMemberAuth: async () => {
      const conflict = new Error('raw provider conflict')
      conflict.status = 409
      throw conflict
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(reads, 3)
  assert.equal(
    buildForm.wrapper.failText.textContent,
    'That email is already in use. Choose another email address.',
  )
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    0,
  )
  assert.deepEqual(environment.redirects, [])
})

test('a landed auth write that keeps timing out sends one email on resubmit', async () => {
  let authAttempts = 0
  const member = { id: 'mem_sb_brand', auth: { email: 'old@example.com' } }
  const buildForm = makeForm('build', { email: 'moved@example.com' })
  const environment = loadController({
    buildForm,
    member,
    updateMemberAuth: async (payload) => {
      authAttempts += 1
      member.auth.email = payload.email
      const lost = new Error('Account update timed out. Please try again.')
      lost.status = 408
      throw lost
    },
  })

  buildForm.submitEvent()
  await settle()

  assert.equal(authAttempts, 2)
  assert.deepEqual(environment.redirects, [])
  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    0,
  )

  buildForm.submitEvent()
  await settle()

  const emails = environment.calls.filter(
    (call) => call.method === 'sendMemberResetPasswordEmail',
  )
  assert.equal(authAttempts, 2)
  assert.equal(emails.length, 1)
  assert.deepEqual(plain(emails[0].payload), { email: 'moved@example.com' })
  assert.equal(
    environment.calls.filter(
      (call) => call.method === 'updateMember' && call.payload.customFields['completed-brand-profile'],
    ).length,
    1,
  )
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
})

test('a reconciled ambiguous auth write sends no second security email', async () => {
  let deliveries = 0
  const member = { id: 'mem_sb_brand', auth: { email: 'old@example.com' } }
  const buildForm = makeForm('build', { email: 'moved@example.com' })
  const environment = loadController({
    buildForm,
    member,
    updateMemberAuth: async (payload) => {
      member.auth.email = payload.email
      const conflict = new Error('That email is already in use.')
      conflict.status = 409
      throw conflict
    },
    sendMemberResetPasswordEmail: async () => {
      deliveries += 1
      throw new Error('response lost after delivery')
    },
  })

  buildForm.submitEvent()
  await settle()
  buildForm.submitEvent()
  await settle()
  buildForm.submitEvent()
  await settle()

  assert.equal(deliveries, 1)
  assert.deepEqual(environment.redirects, ['/brand-dashboard'])
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
    ['getCurrentMember'],
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

test('Identity-scoped Account Security owns Talent email changes', async () => {
  const securityForm = makeForm('security', { email: 'talent-next@example.com' })
  const environment = loadController({
    buildForm: null,
    securityForm,
    currentEmail: 'talent-old@example.com',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  const submission = securityForm.submitEvent()
  await settle()

  assert.equal(submission.event.prevented, true)
  assert.equal(submission.event.stopped, true)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'sendMemberResetPasswordEmail'],
  )
  assert.deepEqual(plain(environment.calls[2].payload), {
    email: 'talent-next@example.com',
  })
  assert.equal(securityForm.nativeSubmits, 0)
  assert.equal(securityForm.wrapper.done.style.display, 'block')
})

test('Account Security refuses an auth switch while diagnostics load', async () => {
  const diagnosticsReady = deferred()
  const securityForm = makeForm('security', { email: 'talent-next@example.com' })
  let current = {
    id: 'mem-talent-a',
    auth: { email: 'talent-old@example.com' },
  }
  const environment = loadController({
    buildForm: null,
    securityForm,
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    getCurrentMember: async () => ({ data: current }),
    diagnosticsReady: diagnosticsReady.promise,
    setTimeout: (callback, ms) => (ms === 2000 ? 1 : setImmediate(callback)),
  })

  securityForm.submitEvent()
  while (environment.calls.filter((call) => call.method === 'getCurrentMember').length < 1) {
    await flush()
  }
  current = {
    id: 'mem-talent-b',
    auth: { email: 'other@example.com' },
  }
  diagnosticsReady.resolve(null)
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember'],
  )
  assert.equal(securityForm.wrapper.fail.style.display, 'block')
  assert.match(securityForm.wrapper.failText.textContent, /signed-in account changed/i)
})

test('Account Security revalidates identity before a retried email write', async () => {
  const securityForm = makeForm('security', { email: 'next@example.com' })
  let current = {
    id: 'mem-talent-a',
    auth: { email: 'old@example.com' },
  }
  let attempts = 0
  const environment = loadController({
    buildForm: null,
    securityForm,
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    getCurrentMember: async () => ({ data: current }),
    updateMemberAuth: async () => {
      attempts += 1
      const error = new Error('temporary')
      error.status = 503
      throw error
    },
    setTimeout(callback, ms) {
      if (ms >= 10000) return 1
      if (ms === 300) {
        current = {
          id: 'mem-talent-b',
          auth: { email: 'other@example.com' },
        }
      }
      return setImmediate(callback)
    },
  })

  securityForm.submitEvent()
  await settle(12)

  assert.equal(attempts, 1)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    [
      'getCurrentMember',
      'getCurrentMember',
      'updateMemberAuth',
      'getCurrentMember',
    ],
  )
  assert.equal(securityForm.wrapper.fail.style.display, 'block')
  assert.match(securityForm.wrapper.failText.textContent, /signed-in account changed/i)
})

test('Talent Account Security success exposes no email in its diagnostic receipt', async () => {
  const securityForm = makeForm('security', { email: 'private-next@example.com' })
  loadController({
    buildForm: null,
    securityForm,
    currentEmail: 'private-old@example.com',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    diagnostics: true,
  })

  securityForm.submitEvent()
  await settle()

  const receipt = securityForm.__startersAccountDiagnostic
  assert.equal(receipt.workflow, 'talent_account_email')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.request_started, true)
  assert.equal(Object.hasOwn(receipt, 'email'), false)
  assert.equal(Object.hasOwn(receipt, 'member_id'), false)
  assert.equal(securityForm.wrapper.done.textContent, 'Your authored success message.')
  assert.equal(securityForm.wrapper.done.getAttribute('data-workflow-diagnostic-copy'), null)
})

test('visible Starter Edit Profile changes Memberstack email before replaying the authored submit', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-next@example.com',
    nativeSubmitNeedsMacrotask: true,
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  const submission = starterProfileForm.submitEvent()
  await settle(12)

  assert.equal(submission.event.prevented, true)
  assert.equal(submission.event.stopped, true)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth'],
  )
  assert.deepEqual(plain(environment.calls[2].payload), {
    email: 'talent-next@example.com',
  })
  assert.equal(starterProfileForm.nativeSubmits, 1)
})

test('visible Starter Edit Profile changes email independently when unrelated required fields are invalid', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
    valid: false,
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  const click = starterProfileForm.clickSubmit()
  await settle()

  assert.equal(click.event.prevented, true)
  assert.equal(click.event.stopped, true)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'getCurrentMember'],
  )
  assert.equal(starterProfileForm.nativeSubmits, 0)
  assert.equal(starterProfileForm.validityReports, 0)
  assert.equal(starterProfileForm.wrapper.done.style.display, 'block')
})

test('independent Starter email accepts a click from nested submit content', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
    valid: false,
  })
  const nestedSubmitContent = {}
  starterProfileForm.submit.contains = (candidate) => candidate === nestedSubmitContent
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  const click = starterProfileForm.clickSubmit(nestedSubmitContent)
  await settle()

  assert.equal(click.event.prevented, true)
  assert.equal(click.event.stopped, true)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'getCurrentMember'],
  )
  assert.equal(starterProfileForm.nativeSubmits, 0)
  assert.equal(starterProfileForm.wrapper.done.style.display, 'block')
})

test('independent Starter email accepts the disabled authored submit wrapper click', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
    valid: false,
  })
  starterProfileForm.inputs.delete('[type="submit"]')
  starterProfileForm.inputs.set('[data-edit-submit]', starterProfileForm.submit)
  const disabledSubmitWrapper = {
    contains(candidate) {
      return candidate === starterProfileForm.submit
    },
  }
  starterProfileForm.submit.parentElement = disabledSubmitWrapper
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  const click = starterProfileForm.clickSubmit(disabledSubmitWrapper)
  await settle()

  assert.equal(click.event.prevented, true)
  assert.equal(click.event.stopped, true)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'getCurrentMember'],
  )
  assert.equal(starterProfileForm.nativeSubmits, 0)
  assert.equal(starterProfileForm.wrapper.done.style.display, 'block')
})

test('independent Starter email ignores ancestors outside the submit wrapper', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-next@example.com',
    valid: false,
  })
  const formAncestor = {
    contains(candidate) {
      return candidate === starterProfileForm.submit
    },
  }
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  const click = starterProfileForm.clickSubmit(formAncestor)
  await settle()

  assert.equal(click.event.prevented, false)
  assert.equal(click.event.stopped, false)
  assert.deepEqual(environment.calls, [])
  assert.equal(starterProfileForm.nativeSubmits, 0)
  assert.equal(starterProfileForm.validityReports, 0)
})

test('independent Starter email change preserves its validated click-time snapshot', async () => {
  const values = {
    email: 'talent-old@example.com',
    valid: false,
  }
  const starterProfileForm = makeForm('starter-profile', values)
  let resolveMember
  const memberRead = new Promise((resolve) => {
    resolveMember = resolve
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    getCurrentMember: () => memberRead,
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.inputEmail('validated@example.com')
  starterProfileForm.clickSubmit()
  await flush()
  starterProfileForm.inputs.get('input[type="email"]').value = 'blocked@example.com'
  values.emailValid = false
  resolveMember({
    data: {
      id: 'mem_sb_talent',
      auth: { email: 'talent-old@example.com' },
    },
  })
  await settle()

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'getCurrentMember'],
  )
  assert.deepEqual(plain(environment.calls[2].payload), {
    email: 'validated@example.com',
  })
  assert.equal(
    environment.calls.some((call) => call.method === 'sendMemberResetPasswordEmail'),
    false,
  )
})

test('valid Starter profile click changes Memberstack email before replaying the authored click', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  const click = starterProfileForm.clickSubmit()
  await settle(12)

  assert.equal(click.event.prevented, true)
  assert.equal(click.event.stopped, true)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'getCurrentMember'],
  )
  assert.deepEqual(plain(environment.calls[2].payload), {
    email: 'talent-next@example.com',
  })
  assert.equal(starterProfileForm.nativeClicks, 1)
  assert.equal(starterProfileForm.nativeSubmits, 0)
  assert.equal(starterProfileForm.getAttribute('data-brand-account-native-replay'), 'false')
})

test('valid Personal Details replay ignores invalid required fields in later steps', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
    valid: false,
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    starterEditProfile: {
      validatePersonalDetails: () => ({ valid: true, failures: [] }),
    },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'getCurrentMember'],
  )
  assert.equal(starterProfileForm.nativeClicks, 1)
  assert.equal(starterProfileForm.nativeSubmits, 0)
  assert.equal(starterProfileForm.validityReports, 0)
})

test('valid Starter profile click does not save profile fields when the email change fails', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
  })
  const failure = new Error('email update failed')
  failure.status = 409
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    updateMemberAuth: async () => {
      throw failure
    },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  const click = starterProfileForm.clickSubmit()
  await settle(12)

  assert.equal(click.event.prevented, true)
  assert.equal(click.event.stopped, true)
  assert.equal(starterProfileForm.nativeClicks, 0)
  assert.equal(starterProfileForm.wrapper.fail.style.display, 'block')
})

test('valid Starter profile click updates email without requesting a password reset', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
  })
  let resetCalls = 0
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    sendMemberResetPasswordEmail: async () => {
      resetCalls += 1
      throw new Error('Starter Edit Profile must not request a password reset')
    },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'getCurrentMember'],
  )
  assert.equal(resetCalls, 0)
  assert.equal(starterProfileForm.nativeClicks, 1)
  assert.equal(starterProfileForm.wrapper.fail.style.display, 'none')
  assert.deepEqual(plain(environment.starterReplayProofs[0].proof), {
    memberId: 'mem_sb_brand',
    email: 'talent-next@example.com',
  })
})

test('valid non-Talent profile click does not replay a changed email', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'changed@example.com',
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'brand-paid' },
  })

  starterProfileForm.inputEmail('next@example.com')
  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
  assert.equal(starterProfileForm.nativeClicks, 0)
})

test('valid profile click does not replay when the route guard is unavailable', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(environment.calls, [])
  assert.equal(starterProfileForm.nativeClicks, 0)
})

test('valid profile click does not replay when the initial member read fails', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    getCurrentMember: async () => {
      throw new Error('member read failed')
    },
  })

  starterProfileForm.inputEmail('talent-next@example.com')
  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
  assert.equal(starterProfileForm.nativeClicks, 0)
})

test('email drift during the identity write blocks replay and remains changed', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
  })
  const member = {
    id: 'mem_sb_talent',
    auth: { email: 'talent-old@example.com' },
  }
  const write = deferred()
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    member,
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    updateMemberAuth: async (payload) => {
      await write.promise
      member.auth.email = payload.email
    },
  })

  starterProfileForm.inputEmail('email-a@example.com')
  starterProfileForm.clickSubmit()
  await flush()
  starterProfileForm.inputEmail('email-b@example.com')
  write.resolve()
  await settle(12)

  assert.equal(starterProfileForm.nativeClicks, 0)

  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(
    environment.calls
      .filter((call) => call.method === 'updateMemberAuth')
      .map((call) => plain(call.payload)),
    [{ email: 'email-a@example.com' }, { email: 'email-b@example.com' }],
  )
  assert.equal(starterProfileForm.nativeClicks, 1)
})

test('session change during identity confirmation blocks replay and requires a fresh click', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-old@example.com',
  })
  const confirmation = deferred()
  let reads = 0
  let currentMember = {
    id: 'mem_member_a',
    auth: { email: 'talent-old@example.com' },
  }
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    getCurrentMember: async () => {
      reads += 1
      if (reads === 3) await confirmation.promise
      return { data: currentMember }
    },
    updateMemberAuth: async (payload) => {
      currentMember.auth.email = payload.email
    },
  })

  starterProfileForm.inputEmail('member-a-next@example.com')
  starterProfileForm.clickSubmit()
  await flush()
  currentMember = {
    id: 'mem_member_b',
    auth: { email: 'member-b@example.com' },
  }
  confirmation.resolve()
  await settle(12)

  assert.equal(starterProfileForm.nativeClicks, 0)
  assert.equal(environment.starterReplayProofs.length, 0)

  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(
    plain(environment.calls.filter((call) => call.method === 'updateMemberAuth').at(-1).payload),
    { email: 'member-a-next@example.com' },
  )
})

test('authored validation rejection restores interception for a fresh member click', async () => {
  const replayTasks = []
  const starterProfileForm = makeForm('starter-profile', {
    email: 'member-a@example.com',
  })
  let currentMember = {
    id: 'mem_member_a',
    auth: { email: 'member-a@example.com' },
  }
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    getCurrentMember: async () => ({ data: currentMember }),
    updateMemberAuth: async (payload) => {
      currentMember.auth.email = payload.email
    },
    setTimeout(fn, ms) {
      if (ms === 0) {
        replayTasks.push(fn)
        return replayTasks.length
      }
      return 1
    },
  })

  starterProfileForm.inputEmail('shared@example.com')
  starterProfileForm.clickSubmit()
  await settle(12)

  assert.equal(replayTasks.length, 1)
  currentMember = {
    id: 'mem_member_b',
    auth: { email: 'member-b@example.com' },
  }
  starterProfileForm.submit.click = () => {
    environment.starterReplayProofs[0].proof.onRejected()
  }
  replayTasks.shift()()

  starterProfileForm.clickSubmit()
  await settle(12)

  assert.deepEqual(
    environment.calls
      .filter((call) => call.method === 'updateMemberAuth')
      .map((call) => plain(call.payload)),
    [{ email: 'shared@example.com' }, { email: 'shared@example.com' }],
  )
  assert.equal(environment.starterReplayProofs[1].proof.memberId, 'mem_member_b')
})

test('invalid email stays native so browser validation remains authoritative', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'not-an-email',
    valid: false,
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  const click = starterProfileForm.clickSubmit()
  await settle()

  assert.equal(click.event.prevented, false)
  assert.deepEqual(environment.calls, [])
})

test('natively invalid Starter email stays native despite matching the basic pattern', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-next@example.com',
    emailValid: false,
    valid: false,
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  const click = starterProfileForm.clickSubmit()
  await settle()

  assert.equal(click.event.prevented, false)
  assert.equal(click.event.stopped, false)
  assert.deepEqual(environment.calls, [])
})

test('invalid Starter profile preserves native validation when email is unchanged', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent@example.com',
    valid: false,
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  const click = starterProfileForm.clickSubmit()
  await settle()

  assert.equal(click.event.prevented, false)
  assert.equal(click.event.stopped, false)
  assert.deepEqual(environment.calls, [])
  assert.equal(starterProfileForm.nativeSubmits, 0)
  assert.equal(starterProfileForm.validityReports, 0)
})

test('programmatic Starter profile prefill does not activate email security interception', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'stale@example.com',
    valid: false,
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.inputEmail('talent@example.com', false)
  const click = starterProfileForm.clickSubmit()
  await settle()

  assert.equal(click.event.prevented, false)
  assert.equal(click.event.stopped, false)
  assert.deepEqual(environment.calls, [])
  assert.equal(starterProfileForm.validityReports, 0)
})

test('visible Starter Edit Profile updates email without requesting a password reset', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-next@example.com',
  })
  let resetCalls = 0
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
    sendMemberResetPasswordEmail: async () => {
      resetCalls += 1
      throw new Error('Starter Edit Profile must not request a password reset')
    },
  })

  starterProfileForm.submitEvent()
  await settle(12)

  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth'],
  )
  assert.equal(resetCalls, 0)
  assert.equal(starterProfileForm.nativeSubmits, 1)
  assert.equal(starterProfileForm.wrapper.fail.style.display, 'none')
  assert.deepEqual(environment.tracked, [])
})

test('visible Starter Edit Profile replays an unchanged email without an auth mutation', async () => {
  const starterProfileForm = makeForm('starter-profile', { email: 'talent@example.com' })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.submitEvent()
  await settle()

  assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
  assert.equal(starterProfileForm.nativeSubmits, 1)
})

test('visible Starter Edit Profile blocks changed non-Talent email and leaves off-route forms native', async () => {
  for (const scenario of [
    { pathname: '/starter-edit-profile', role: 'brand-paid', bound: true },
    { pathname: '/starter-dashboard', role: 'talent', bound: false },
  ]) {
    const starterProfileForm = makeForm('starter-profile')
    const environment = loadController({
      buildForm: null,
      starterProfileForm,
      pathname: scenario.pathname,
      config: { guardSecurityForm: 'identity' },
      routeGuard: { memberRole: () => scenario.role },
    })

    assert.equal(starterProfileForm.listeners.has('submit'), scenario.bound)
    if (scenario.bound) {
      starterProfileForm.submitEvent()
      await settle()
      assert.equal(starterProfileForm.nativeSubmits, 0)
      assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
    }
  }
})

test('visible Starter Edit Profile blocks changed email for logged-out and unreadable roles', async () => {
  for (const state of ['logged-out', 'unreadable']) {
    const starterProfileForm = makeForm('starter-profile', {
      email: 'talent-next@example.com',
    })
    const environment = loadController({
      buildForm: null,
      starterProfileForm,
      pathname: '/starter-edit-profile',
      config: { guardSecurityForm: 'identity' },
      getCurrentMember:
        state === 'logged-out' ? async () => ({ data: null }) : undefined,
      routeGuard: {
        memberRole() {
          if (state === 'unreadable') throw new Error('role lookup failed')
          throw new Error('role lookup must not run while logged out')
        },
      },
    })

    starterProfileForm.submitEvent()
    await settle()

    assert.equal(starterProfileForm.nativeSubmits, 0)
    assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
  }
})

test('visible Starter Edit Profile never sends a reset email for a real email change', async () => {
  const starterProfileForm = makeForm('starter-profile', {
    email: 'talent-next@example.com',
  })
  const environment = loadController({
    buildForm: null,
    starterProfileForm,
    currentEmail: 'talent-old@example.com',
    pathname: '/starter-edit-profile',
    config: { guardSecurityForm: 'identity' },
    routeGuard: { memberRole: () => 'talent' },
  })

  starterProfileForm.submitEvent()
  await settle()
  starterProfileForm.submitEvent()
  await settle()

  assert.equal(
    environment.calls.filter((call) => call.method === 'sendMemberResetPasswordEmail').length,
    0,
  )
  assert.equal(
    environment.calls.filter((call) => call.method === 'updateMemberAuth').length,
    1,
  )
  assert.equal(starterProfileForm.nativeSubmits, 2)
})

test('Account Security preserves Brand telemetry and classifies Starter failures separately', async () => {
  for (const scenario of [
    { mode: 'brand', role: 'brand-paid', path: 'brand/account/email' },
    { mode: 'identity', role: 'brand-free', path: 'brand/account/email' },
    { mode: 'identity', role: 'talent', path: 'starter/account/email' },
  ]) {
    const failure = new Error('email update failed')
    failure.status = 503
    const securityForm = makeForm('security', { email: 'next@example.com' })
    const environment = loadController({
      buildForm: null,
      securityForm,
      currentEmail: 'old@example.com',
      config: { guardSecurityForm: scenario.mode },
      routeGuard: { memberRole: () => scenario.role },
      updateMemberAuth: async () => {
        throw failure
      },
    })

    securityForm.submitEvent()
    await settle()

    assert.deepEqual(plain(environment.tracked), [
      { name: 'bridge_error', payload: { path: scenario.path, status: 503 } },
    ])
  }
})

test('Identity-scoped Account Security still leaves unknown and conflicted roles Memberstack-native', async () => {
  for (const role of [null, 'conflicting-plan-roles']) {
    const securityForm = makeForm('security')
    const environment = loadController({
      buildForm: null,
      securityForm,
      config: { guardSecurityForm: 'identity' },
      routeGuard: { memberRole: () => role },
    })

    securityForm.submitEvent()
    await settle()

    assert.equal(securityForm.nativeSubmits, 1)
    assert.deepEqual(environment.calls.map((call) => call.method), ['getCurrentMember'])
  }
})

test('Identity-scoped Account Security revalidates the same member before mutation', async () => {
  const securityForm = makeForm('security', { email: 'next@example.com' })
  let reads = 0
  const authorizedMember = {
    id: 'mem_sb_talent',
    auth: { email: 'old@example.com' },
    planConnections: ['talent'],
  }
  const environment = loadController({
    buildForm: null,
    securityForm,
    config: { guardSecurityForm: 'identity' },
    getCurrentMember: async () => {
      reads += 1
      if (reads === 1) return { data: authorizedMember }
      return { data: { ...authorizedMember, planConnections: ['conflicting-plan-roles'] } }
    },
    routeGuard: {
      memberRole(member) {
        return member.planConnections[0]
      },
    },
  })

  securityForm.submitEvent()
  await settle()

  assert.equal(reads, 2)
  assert.deepEqual(
    environment.calls.map((call) => call.method),
    ['getCurrentMember', 'getCurrentMember', 'updateMemberAuth', 'sendMemberResetPasswordEmail'],
  )
  assert.equal(securityForm.nativeSubmits, 0)
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

test('Build Account sends no changed-email message until completion succeeds', async () => {
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

test('Build Account does not retry an ambiguously acknowledged changed-email message', async () => {
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

test('sibling diagnostics loaders resolve through a release cache-key controller src', () => {
  const environment = loadController({
    buildForm: null,
    captureNativeDiagnosticsLoader: true,
    controllerScriptSrc:
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/brand-account-controller.js?v=1.59.339',
  })
  assert.deepEqual(
    environment.appendedScripts.map((script) => script.src),
    [
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/utils/workflow-diagnostics.js',
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/native-form-diagnostics.js',
    ],
  )
})

test('native form diagnostics inherit the controller CDN ref and use one loader sentinel', () => {
  const environment = loadController({ buildForm: null, captureNativeDiagnosticsLoader: true })
  const nativeScripts = () => environment.appendedScripts.filter((script) => (
    script.getAttribute('data-starters-native-form-diagnostics') !== null
  ))
  assert.equal(nativeScripts().length, 1)
  const script = nativeScripts()[0]
  assert.equal(
    script.src,
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/v3/native-form-diagnostics.js',
  )
  assert.equal(script.getAttribute('data-starters-native-form-diagnostics'), '')
  environment.api.init()
  assert.equal(nativeScripts().length, 1)
})
