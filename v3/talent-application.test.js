const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const { setImmediate: tick } = require('node:timers/promises')

const source = fs.readFileSync(require.resolve('./talent-application.js'), 'utf8')

function makeForm(entries, attrs = {}, selects = {}) {
  const failEl = { style: { display: 'none' } }
  return {
    entries,
    attrs,
    failEl,
    __startersSubmitting: undefined,
    matches(selector) {
      return selector === 'form[application-form]'
    },
    getAttribute(name) {
      return this.attrs[name] ?? null
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
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0].capture, true)

  const form = makeForm(FULL_ENTRIES, { 'data-redirect': '/freelancer-application/step-2' })
  const event = submitEvent(form)
  listeners[0].handler(event)
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
  listeners[0].handler(submitEvent(makeForm(entries)))
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
  listeners[0].handler(submitEvent(form))
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
  listeners[0].handler(submitEvent(form))
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
  listeners[0].handler(event)
  assert.equal(event.prevented, false)
  assert.equal(fetched, false)
})
