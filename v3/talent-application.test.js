const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const { setImmediate: tick } = require('node:timers/promises')

const source = fs.readFileSync(require.resolve('./talent-application.js'), 'utf8')

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

function makeForm(entries, attrs = {}, selects = {}, elements) {
  const failEl = { style: { display: 'none' } }
  return {
    entries,
    attrs,
    failEl,
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
      return m ? selects[m[1]] ?? null : null
    },
    querySelectorAll() {
      return []
    },
  }
}

function makeSelect(options, selectedIndex) {
  return { options, selectedIndex }
}

function load({ fetchImpl }) {
  const listeners = []
  const assigned = []
  const context = {
    window: {
      location: { assign: (url) => assigned.push(url) },
      console,
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
  }
  context.window.document = context.document
  vm.createContext(context)
  vm.runInContext(source, context)
  return { listeners, assigned, context }
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
  const { listeners, assigned } = load({
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
