const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const { setImmediate: tick } = require('node:timers/promises')

const source = fs.readFileSync(require.resolve('./talent-application.js'), 'utf8')
const diagnosticSource = fs.readFileSync(require.resolve('../utils/workflow-diagnostics.js'), 'utf8')

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function makeField({ valid = true, visible = true, willValidate = true } = {}) {
  return {
    willValidate,
    offsetParent: visible ? {} : null,
    getClientRects() {
      return visible ? [{}] : []
    },
    checkValidity() {
      return valid
    },
    reportValidity() {
      this.reported = true
    },
  }
}

function makeForm(entries, attrs = {}, selects = {}, elements, controls = {}) {
  const messageAttrs = {}
  const messageListeners = {}
  const messageEl = {
    textContent: 'Something went wrong.',
    setAttribute(name, value) { messageAttrs[name] = String(value) },
    getAttribute(name) { return messageAttrs[name] ?? null },
    addEventListener(name, handler) { messageListeners[name] = handler },
  }
  const failEl = {
    style: { display: 'none' },
    querySelector() { return messageEl },
  }
  return {
    entries,
    attrs,
    failEl,
    messageEl,
    messageListeners,
    elements,
    __startersSubmitting: undefined,
    matches(selector) {
      return selector === 'form[application-form]'
    },
    getAttribute(name) {
      return this.attrs[name] ?? null
    },
    checkValidity() {
      return this.attrs.valid !== false
    },
    reportValidity() {
      this.reportedInvalid = true
    },
    closest() {
      return { querySelector: (sel) => (sel === '.w-form-fail' ? failEl : null) }
    },
    querySelector(selector) {
      const m = selector.match(/^select\[name="(.+)"\]$/)
      if (m) return selects[m[1]] ?? null
      return controls[selector] ?? null
    },
    querySelectorAll() {
      return []
    },
  }
}

function makeSelect(options, selectedIndex) {
  return { options, selectedIndex }
}

function load({
  fetchImpl,
  workflowDiagnostics = true,
  workflowDiagnosticsReady = null,
  setTimeoutImpl = setTimeout,
} = {}) {
  const listeners = []
  const assigned = []
  const stored = new Map()
  const tracked = []
  const copied = []
  const context = {
    window: {
      location: { assign: (url) => assigned.push(url) },
      console,
      Date,
      Math,
      Uint32Array,
      crypto: { randomUUID: () => '12345678-90ab-cdef-1234-567890abcdef' },
      sessionStorage: { setItem: (key, value) => stored.set(key, value) },
      navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
      StartersTrack: { track: (name, properties) => tracked.push({ name, properties }) },
      clearTimeout,
      setTimeout: setTimeoutImpl,
    },
    document: {
      addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }),
    },
    fetch: fetchImpl,
    FormData: class {
      constructor(form) {
        this.form = form
      }
      forEach(callback) {
        for (const [key, value] of this.form.entries) callback(value, key)
      }
    },
    console,
    Date,
    Math,
    Uint32Array,
  }
  if (workflowDiagnosticsReady) {
    context.window.__startersWorkflowDiagnosticsReady = workflowDiagnosticsReady
  }
  context.window.document = context.document
  vm.createContext(context)
  if (workflowDiagnostics) vm.runInContext(diagnosticSource, context)
  vm.runInContext(source, context)
  return { listeners, assigned, context, stored, tracked, copied }
}

function submitEvent(form) {
  return {
    target: form,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopImmediatePropagation() {
      this.stopped = true
    },
  }
}

function multistepClickEvent(form) {
  const submitControl = {
    closest(selector) {
      if (selector === 'form[application-form]') return form
      if (
        selector ===
        '[data-form="submit-btn"], [data-form-ms="submit-btn"]'
      ) {
        return this
      }
      return null
    },
  }
  return {
    ...submitEvent(submitControl),
    target: submitControl,
  }
}

const FULL_ENTRIES = [
  ['first-name', 'Jane'],
  ['last-name', 'Doe'],
  ['email', 'jane@example.com'],
  ['phone', '+100'],
  ['linkedin', 'https://linkedin.com/in/jane'],
  ['profile-type', 'Full Profile'],
  ['function', 'AI & Technology'],
  ['role-option', 'AI Implementation Expert'],
  ['rate', '120.00'],
  ['consult-option', ''],
  ['rate-consult', ''],
  ['referral-source', 'Google Search'],
  ['country', 'Philippines'],
  ['city', 'Manila'],
]

test('maps full-profile fields and redirects on success', async () => {
  const calls = []
  const { listeners, assigned } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 42 }) })
    },
  })
  assert.equal(listeners.length, 2)
  assert.deepEqual(
    listeners.map(({ type, capture }) => ({ type, capture })),
    [
      { type: 'click', capture: true },
      { type: 'submit', capture: true },
    ],
  )

  const form = makeForm(FULL_ENTRIES, { 'data-redirect': '/freelancer-application/step-2' })
  const event = submitEvent(form)
  listeners.find(({ type }) => type === 'submit').handler(event)
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)

  await tick()
  await tick()
  await tick()

  const payload = JSON.parse(calls[0].options.body)
  assert.equal(payload.email, 'jane@example.com')
  assert.equal(payload.first_name, 'Jane')
  assert.equal(payload.profile_type, 'Full Profile')
  assert.equal(payload.function_category, 'AI & Technology')
  assert.equal(payload.role_30, 'AI Implementation Expert')
  assert.equal(payload.rate, '120.00')
  assert.equal(payload.answers['referral-source'], 'Google Search')
  assert.deepEqual(assigned, ['/freelancer-application/step-2'])
})

test('sends explicit true when the native optional marketing checkbox is checked', async () => {
  const calls = []
  const { listeners } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 43 }) })
    },
  })
  const entries = FULL_ENTRIES.concat([['marketing-email-consent', 'on']])
  const form = makeForm(entries, {}, {}, undefined, {
    'input[type="checkbox"][name="marketing-email-consent"]': { checked: true },
  })

  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  await tick()

  const payload = JSON.parse(calls[0].options.body)
  assert.equal(payload.marketing_email_consent, true)
  assert.equal(Object.hasOwn(payload.answers, 'marketing-email-consent'), false)
})

test('sends explicit false when the native optional marketing checkbox is unchecked', async () => {
  const calls = []
  const { listeners } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 44 }) })
    },
  })
  const form = makeForm(FULL_ENTRIES, {}, {}, undefined, {
    'input[type="checkbox"][name="marketing-email-consent"]': { checked: false },
  })

  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  await tick()

  const payload = JSON.parse(calls[0].options.body)
  assert.equal(payload.marketing_email_consent, false)
})

test('omits marketing consent while the native Designer checkbox is absent', async () => {
  const calls = []
  const { listeners } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 45 }) })
    },
  })

  listeners.find(({ type }) => type === 'submit').handler(submitEvent(makeForm(FULL_ENTRIES)))
  await tick()
  await tick()

  const payload = JSON.parse(calls[0].options.body)
  assert.equal(Object.hasOwn(payload, 'marketing_email_consent'), false)
})

test('snapshots application fields and consent when submission starts', async () => {
  const calls = []
  const diagnostics = deferred()
  const checkbox = { checked: true }
  const entries = FULL_ENTRIES.concat([['marketing-email-consent', 'on']])
  const { listeners } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 46 }) })
    },
    workflowDiagnostics: false,
    workflowDiagnosticsReady: diagnostics.promise,
  })
  const form = makeForm(entries, {}, {}, undefined, {
    'input[type="checkbox"][name="marketing-email-consent"]': checkbox,
  })

  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  entries.find(([key]) => key === 'email')[1] = 'changed@example.com'
  checkbox.checked = false
  diagnostics.resolve(null)
  await tick()
  await tick()

  const payload = JSON.parse(calls[0].options.body)
  assert.equal(payload.email, 'jane@example.com')
  assert.equal(payload.marketing_email_consent, true)
})

test('consult-only coalesces the consult role/rate pair', async () => {
  const calls = []
  const { listeners } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 7 }) })
    },
  })
  const entries = FULL_ENTRIES.map(([k, v]) => {
    if (k === 'profile-type') return [k, 'Consult Only']
    if (k === 'role-option') return [k, '']
    if (k === 'rate') return [k, '']
    if (k === 'consult-option') return [k, 'Marketing Strategy Consult']
    if (k === 'rate-consult') return [k, '250.00']
    return [k, v]
  })
  listeners.find(({ type }) => type === 'submit').handler(submitEvent(makeForm(entries)))
  await tick()
  await tick()

  const payload = JSON.parse(calls[0].options.body)
  assert.equal(payload.role_30, 'Marketing Strategy Consult')
  assert.equal(payload.rate, '250.00')
})

test('failure shows the fail block and allows retry', async () => {
  const { listeners, assigned, tracked } = load({
    fetchImpl: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
  })
  const form = makeForm(FULL_ENTRIES)
  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  await tick()
  await tick()

  assert.equal(assigned.length, 0)
  assert.equal(form.failEl.style.display, 'block')
  assert.equal(form.__startersSubmitting, false)
  assert.equal(form.messageEl.textContent, 'Something went wrong.')
  assert.equal(form.messageEl.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.deepEqual(
    tracked.map((event) => event.name),
    ['workflow_form_submit_started', 'workflow_form_submit_failed'],
  )
  const receipt = form.__startersDiagnostic
  assert.equal(receipt.error_code, 'HTTP_ERROR')
  assert.equal(receipt.http_status, 500)
  assert.equal(Object.hasOwn(receipt, 'email'), false)
})

test('success records only the canonical application id before redirect', async () => {
  const { listeners, assigned, tracked } = load({
    fetchImpl: () => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 709, email: 'private@example.com' }) }),
  })
  const form = makeForm(FULL_ENTRIES)
  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  await tick()
  await tick()

  assert.deepEqual(assigned, ['/freelancer-application/step-2'])
  assert.equal(tracked.at(-1).name, 'workflow_form_submit_succeeded')
  assert.equal(form.__startersDiagnostic.resource_id, '709')
  assert.equal(Object.hasOwn(form.__startersDiagnostic, 'email'), false)
})

test('a stalled shared diagnostics loader fails open before application creation', async () => {
  const calls = []
  const { listeners } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 710 }) })
    },
    workflowDiagnostics: false,
    workflowDiagnosticsReady: new Promise(() => {}),
    setTimeoutImpl: (callback, ms) => ms === 2000 ? setImmediate(callback) : setTimeout(callback, ms),
  })
  const form = makeForm(FULL_ENTRIES)

  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  await tick()
  await tick()

  assert.equal(calls.length, 1)
})

test('a helper loaded after diagnostics timeout does not fabricate a receipt', async () => {
  const responseReady = deferred()
  const diagnosticsReady = Promise.resolve(null)
  const environment = load({
    fetchImpl: () => responseReady.promise,
    workflowDiagnostics: false,
    workflowDiagnosticsReady: diagnosticsReady,
  })
  const form = makeForm(FULL_ENTRIES)

  environment.listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  vm.runInContext(diagnosticSource, environment.context)
  responseReady.resolve({ ok: true, status: 201, json: async () => ({ id: 711 }) })
  await tick()
  await tick()
  await tick()

  assert.equal(environment.context.window.__startersWorkflowDiagnosticLast, undefined)
  assert.equal(form.__startersDiagnostic, undefined)
  assert.deepEqual(environment.assigned, ['/freelancer-application/step-2'])
})

test('visible validation failure records no request without page diagnostics', () => {
  const invalid = makeField({ valid: false, visible: true })
  const { listeners, tracked } = load({ fetchImpl: () => Promise.reject(new Error('must not fetch')) })
  const form = makeForm(FULL_ENTRIES, {}, {}, [invalid])
  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))

  assert.equal(tracked.length, 1)
  assert.equal(tracked[0].name, 'workflow_form_validation_failed')
  assert.equal(form.__startersDiagnostic.request_started, false)
  assert.equal(form.__startersDiagnostic.error_code, 'NATIVE_VALIDATION')
  assert.equal(form.messageEl.textContent, 'Something went wrong.')
  assert.equal(form.messageEl.getAttribute('data-workflow-diagnostic-copy'), null)
})

test('resolves country/state select indexes to option text', async () => {
  const calls = []
  const { listeners } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 9 }) })
    },
  })
  const entries = FULL_ENTRIES.map(([k, v]) => (k === 'country' ? [k, '17'] : k === 'city' ? [k, 'Manila'] : [k, v]))
  const form = makeForm(entries, {}, {
    country: makeSelect([{ value: '', textContent: 'Select country' }, { value: '17', textContent: 'Philippines' }], 1),
    state: makeSelect([{ value: '', textContent: 'Select state' }, { value: '3', textContent: 'Metro Manila' }], 1),
    city: makeSelect([{ value: '', textContent: 'Select city' }, { value: 'Manila', textContent: 'Manila' }], 1),
  })
  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  await tick()

  const payload = JSON.parse(calls[0].options.body)
  assert.equal(payload.country, 'Philippines')
  assert.equal(payload.city, 'Manila')
  assert.equal(payload.answers.state, 'Metro Manila')
  assert.equal(payload.answers.country, 'Philippines')
})

test('ignores forms without the application-form attribute', () => {
  let fetched = false
  const { listeners } = load({ fetchImpl: () => ((fetched = true), Promise.resolve()) })
  const form = makeForm([], {})
  form.matches = () => false
  const event = submitEvent(form)
  listeners.find(({ type }) => type === 'submit').handler(event)
  assert.equal(event.prevented, false)
  assert.equal(fetched, false)
})

test('captures the multistep Complete click before Webflow native submission', async () => {
  const calls = []
  let webflowSubmitted = false
  const { listeners, assigned } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 88 }) })
    },
  })
  const form = makeForm(FULL_ENTRIES, {
    'data-redirect': '/freelancer-application/step-2',
  })
  const event = multistepClickEvent(form)

  listeners.find(({ type }) => type === 'click').handler(event)
  if (!event.stopped) webflowSubmitted = true

  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(webflowSubmitted, false)
  assert.equal(calls.length, 1)

  await tick()
  await tick()

  assert.deepEqual(assigned, ['/freelancer-application/step-2'])
})

test('leaves invalid multistep clicks to the existing validation UI', () => {
  let fetched = false
  const { listeners } = load({
    fetchImpl: () => {
      fetched = true
      return Promise.resolve()
    },
  })
  const form = makeForm(FULL_ENTRIES, { valid: false })
  const event = multistepClickEvent(form)

  listeners.find(({ type }) => type === 'click').handler(event)

  assert.equal(event.prevented, false)
  assert.equal(event.stopped, false)
  assert.equal(form.reportedInvalid, true)
  assert.equal(fetched, false)
})

test('ignores required-but-hidden fields when validating visible controls', async () => {
  const calls = []
  const { listeners, assigned } = load({
    fetchImpl: (url, options) => {
      calls.push({ url, options })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 55 }) })
    },
  })
  const hiddenRequired = makeField({ valid: false, visible: false })
  const form = makeForm(
    FULL_ENTRIES,
    { 'data-redirect': '/freelancer-application/step-2' },
    {},
    [makeField({ valid: true, visible: true }), hiddenRequired],
  )
  listeners.find(({ type }) => type === 'submit').handler(submitEvent(form))
  await tick()
  await tick()

  assert.equal(hiddenRequired.reported, undefined)
  assert.equal(calls.length, 1)
  assert.deepEqual(assigned, ['/freelancer-application/step-2'])
})

test('blocks and reports the first invalid visible control', () => {
  let fetched = false
  const { listeners } = load({
    fetchImpl: () => {
      fetched = true
      return Promise.resolve()
    },
  })
  const invalidVisible = makeField({ valid: false, visible: true })
  const form = makeForm(FULL_ENTRIES, {}, {}, [
    makeField({ valid: true, visible: true }),
    invalidVisible,
    makeField({ valid: false, visible: false }),
  ])
  const event = submitEvent(form)
  listeners.find(({ type }) => type === 'submit').handler(event)

  assert.equal(event.prevented, false)
  assert.equal(invalidVisible.reported, true)
  assert.equal(fetched, false)
})
