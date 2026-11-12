const assert = require('node:assert/strict')
const test = require('node:test')
const { validateHours } = require('./profile-calls-step')

const hours = {
  days: [1, 2, 3, 4, 5],
  windows: [{ start: '9:00 AM', end: '6:00 PM' }],
  extra: null,
}

test('weekly hours require a day and reject a reversed or invalid window', () => {
  assert.equal(validateHours({ ...hours, days: [] }), 'Pick at least one day.')
  assert.equal(validateHours({ ...hours, windows: [{ start: '1:00 PM', end: '12:00 PM' }] }),
    'A window has to end after it starts.')
  assert.equal(validateHours({ ...hours, windows: [{ start: '', end: '1:00 PM' }] }),
    'A window has to end after it starts.')
})

test('weekly hours reject overlap regardless of row order and allow adjacent windows', () => {
  assert.equal(validateHours({ ...hours, windows: [
    { start: '12:30 PM', end: '1:00 PM' },
    { start: '9:00 AM', end: '1:30 PM' },
  ] }), 'These windows overlap. Adjust one so they don’t.')
  assert.equal(validateHours({ ...hours, windows: [
    { start: '12:00 PM', end: '6:00 PM' },
    { start: '9:00 AM', end: '12:00 PM' },
  ] }), '')
})

test('additional hours require days and validate their own window', () => {
  assert.equal(validateHours({ ...hours, extra: { days: [], start: '9:00 AM', end: '1:00 PM' } }),
    'Pick at least one day.')
  assert.equal(validateHours({ ...hours, extra: { days: [6], start: '9:00 AM', end: '8:00 AM' } }),
    'A window has to end after it starts.')
  assert.equal(validateHours({ ...hours, extra: { days: [6], start: '9:00 AM', end: '1:00 PM' } }), '')
})

// Minimal fake DOM: just the surface mount() touches.
const { mount } = require('./profile-calls-step')

function matchesSelector(el, selector) {
  if (/^[a-z]+$/.test(selector)) return el.tagName === selector.toUpperCase()
  const parts = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
  return parts.length > 0 && parts.every(([, name, expected]) => {
    const actual = el.getAttribute(name)
    return actual !== null && (expected === undefined || actual === expected)
  })
}

class FakeElement {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase()
    this.attrs = new Map(Object.entries(attrs))
    this.children = []
    this.parentElement = null
    this.listeners = {}
    this.textContent = ''
    this.hidden = false
    this.style = {}
    this.value = attrs.value || ''
    children.forEach((child) => this.appendChild(child))
  }
  get dataset() {
    const out = {}
    for (const [name, value] of this.attrs) if (name.startsWith('data-')) out[name.slice(5)] = value
    return out
  }
  get options() { return this.children }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null }
  setAttribute(name, value) { this.attrs.set(name, String(value)) }
  removeAttribute(name) { this.attrs.delete(name) }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child }
  replaceChildren() { this.children = [] }
  remove() { this.parentElement.children = this.parentElement.children.filter((c) => c !== this) }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]) }
  querySelectorAll(selector) { return this.descendants().filter((el) => matchesSelector(el, selector)) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  matches(selector) { return matchesSelector(this, selector) }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node
    return null
  }
  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true
    return false
  }
  cloneNode() {
    const copy = new FakeElement(this.tagName, Object.fromEntries(this.attrs), this.children.map((c) => c.cloneNode()))
    copy.value = this.value
    copy.textContent = this.textContent
    copy.hidden = this.hidden
    return copy
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener) }
  click() {
    if (this.disabled) return
    const event = { target: this, preventDefault() {}, stopImmediatePropagation() {} }
    for (let node = this; node; node = node.parentElement) (node.listeners.click || []).forEach((l) => l(event))
  }
}

function build(pathname = '/starter-edit-profile-test', context = 'edit') {
  const el = (tag, attrs, children) => new FakeElement(tag, attrs, children)
  const select = (kind, value) => el('select', { 'data-calls-step-input': kind, value })
  const row = (start, end) => el('div', { 'data-calls-step-element': 'window' }, [
    select('window-start', start), select('window-end', end),
    el('button', { 'data-calls-step-action': 'remove-window' }),
  ])
  const day = (n) => el('button', { 'data-day': String(n), 'aria-pressed': n === 1 ? 'true' : 'false' })
  const title = el('input', { 'data-call-settings-input': 'title' })
  const windows = el('div', { 'data-calls-step-element': 'windows' }, [row('9:00 AM', '6:00 PM')])
  const error = el('p', { 'data-calls-step-element': 'error' })
  const addButton = el('button', { 'data-calls-step-action': 'add-window' })
  const root = el('div', { 'data-calls-step': 'root', 'data-calls-step-context': context }, [
    el('div', { 'data-calls-step-element': 'days' }, [day(1), day(2)]),
    el('div', { 'data-calls-step-element': 'extra-days' }),
    windows, addButton, error,
    el('div', { 'data-calls-step-element': 'extra', hidden: '' }, [select('extra-start', ''), select('extra-end', '')]),
    select('timezone', ''),
    el('span', { 'data-calls-step-output': 'timezone-now' }),
    el('div', { 'data-call-settings-service': 'paid' }, [title]),
  ])
  const form = pathname === '/build-profile-form-test' ? el('form', {}, [root]) : null
  root.ownerDocument = {
    defaultView: { location: { pathname } },
    createElement: (tag) => el(tag),
  }
  root.querySelector('[data-calls-step-element="extra"]').hidden = true
  return { root, form, windows, error, addButton, title, api: mount(root) }
}

const windowTimes = (windows) => windows.children.map((row) => [
  row.querySelector('[data-calls-step-input="window-start"]').value,
  row.querySelector('[data-calls-step-input="window-end"]').value,
])

test('added window starts in a free slot after the existing one', () => {
  const { windows, addButton, api } = build()
  addButton.click()
  assert.deepEqual(windowTimes(windows), [['9:00 AM', '6:00 PM'], ['6:00 PM', '6:30 PM']])
  assert.equal(api.validate(), '')
  addButton.click()
  assert.equal(api.validate(), '')
  assert.equal(windows.children.length, 3)
})

test('remove buttons stay visible and only disable when one window remains', () => {
  const { windows, addButton } = build()
  const buttons = () => windows.querySelectorAll('[data-calls-step-action="remove-window"]')
  const [first] = buttons()
  assert.equal(first.hidden, false)
  assert.equal(first.disabled, true)
  assert.equal(first.style.cursor, 'not-allowed')
  first.click()
  assert.equal(buttons().length, 1)

  addButton.click()
  const [original, added] = buttons()
  assert.equal(original.disabled, false)
  assert.equal(original.style.cursor, '')
  assert.equal(added.disabled, false)
  original.click()
  assert.deepEqual(buttons(), [added])
  assert.equal(added.hidden, false)
  assert.equal(added.disabled, true)
  assert.equal(added.style.cursor, 'not-allowed')
})

test('added window reports an error when no room remains', () => {
  const { windows, addButton, error, api } = build()
  const first = windows.children[0]
  first.querySelector('[data-calls-step-input="window-start"]').value = '12:00 AM'
  first.querySelector('[data-calls-step-input="window-end"]').value = '11:30 PM'
  addButton.click()
  assert.equal(windows.children.length, 1)
  assert.match(error.textContent, /No room for another window/)
})

test('paid call description allows 80 characters on Edit only', () => {
  assert.equal(build().title.maxLength, 80)
  assert.equal(build('/build-profile/consult-test').api, null)
})

test('standalone staging markup mounts without a step wrapper and blocks submit', () => {
  const { form, api } = build('/build-profile-form-test')
  assert.ok(api)
  const calls = []
  const event = { preventDefault: () => calls.push('prevent'), stopImmediatePropagation: () => calls.push('stop') }
  form.listeners.submit.forEach((listener) => listener(event))
  assert.deepEqual(calls, ['prevent', 'stop'])
})

test('onboarding context mounts on the onboarding v2 pages and hides call choices', () => {
  for (const path of ['/starter-onboarding-v2', '/starter-onboarding-v2-wip']) {
    const { root, api } = build(path, 'onboarding')
    assert.ok(api, path)
    assert.equal(root.querySelector('[data-call-settings-service="paid"]').hidden, true)
    assert.equal(api.validate(), '')
  }
})

test('onboarding context needs both the onboarding path and the onboarding marker', () => {
  assert.equal(build('/starter-onboarding-v2', 'edit').api, null)
  assert.equal(build('/starter-onboarding', 'onboarding').api, null)
  assert.equal(build('/starter-dashboard', 'onboarding').api, null)
})

// Build Profile step (Jai 2026-11-12, JP 1a): hours + Google + Free call; no Paid, no Stripe.
function buildProfileStep(pathname, { freeOn = true, paidOn = false, wrapped = true, context = 'build-profile' } = {}) {
  const el = (tag, attrs, children) => new FakeElement(tag, attrs, children)
  const select = (kind, value) => el('select', { 'data-calls-step-input': kind, value })
  const service = (name) => {
    const toggle = el('input', { 'data-call-settings-input': 'enabled' })
    return { toggle, row: el('div', { 'data-call-settings-service': name }, [toggle, el('div', { 'data-call-settings-element': 'panel' })]) }
  }
  const free = service('free')
  const paid = service('paid')
  paid.row.appendChild(el('input', { 'data-call-settings-input': 'title' }))
  paid.row.appendChild(el('input', { 'data-call-settings-input': 'price' }))
  paid.row.appendChild(el('select', { name: 'paid-call-duration' }))
  paid.row.appendChild(el('textarea', { name: 'paid-call-notes' }))
  free.toggle.checked = freeOn
  paid.toggle.checked = paidOn
  const availability = el('div', { 'data-calls-step-element': 'availability' })
  const calendar = el('div', { 'data-calls-step-element': 'calendar' })
  const stripe = el('div', { 'data-stripe-connect-element': 'root' })
  const root = el('div', { 'data-calls-step': 'root', ...(context === null ? {} : { 'data-calls-step-context': context }) }, [
    free.row, paid.row, availability, calendar, stripe,
    el('div', { 'data-calls-step-element': 'days' }, [el('button', { 'data-day': '1', 'aria-pressed': 'true' })]),
    el('div', { 'data-calls-step-element': 'extra-days' }),
    el('div', { 'data-calls-step-element': 'windows' }, [el('div', { 'data-calls-step-element': 'window' }, [
      select('window-start', '9:00 AM'), select('window-end', '6:00 PM'), el('button', { 'data-calls-step-action': 'remove-window' }),
    ])]),
    el('p', { 'data-calls-step-element': 'error' }),
    el('div', { 'data-calls-step-element': 'extra', hidden: '' }, [select('extra-start', ''), select('extra-end', '')]),
    select('timezone', ''),
    el('span', { 'data-calls-step-output': 'timezone-now' }),
  ])
  if (wrapped) el('div', { 'data-form': 'step', 'data-index': '6' }, [root])
  root.ownerDocument = { defaultView: { location: { pathname } }, createElement: (tag) => el(tag) }
  root.querySelector('[data-calls-step-element="extra"]').hidden = true
  return { root, free, paid, availability, calendar, stripe, api: mount(root) }
}

test('Build Profile context mounts on the four Build Profile pages, hides Paid and Stripe, keeps hours and calendar', () => {
  for (const path of ['/build-profile/consult-test', '/build-profile/full-profile-test', '/build-profile/consult', '/build-profile/full-profile']) {
    const page = buildProfileStep(path, { freeOn: false })
    assert.ok(page.api, path)
    assert.equal(page.paid.row.hidden, true, path)
    assert.equal(page.stripe.hidden, true, path)
    assert.equal(page.free.row.hidden, false, path)
    assert.equal(page.availability.hidden, false, path)
    assert.equal(page.calendar.hidden, false, path)
    assert.equal(page.paid.toggle.checked, false, path)
  }
})

test('Build Profile turns off and disables a Paid switch that starts checked so no paid call is submitted', () => {
  for (const path of ['/build-profile/consult-test', '/build-profile/full-profile-test']) {
    const page = buildProfileStep(path, { paidOn: true })
    assert.ok(page.api, path)
    assert.equal(page.paid.toggle.checked, false, path)
    const fields = ['input', 'select', 'textarea'].flatMap((tag) => page.paid.row.querySelectorAll(tag))
    assert.equal(fields.length, 5, path)
    for (const field of fields) assert.equal(field.disabled, true, path)
    assert.equal(page.free.toggle.disabled, undefined, path)
    assert.equal(page.api.validate(), '', path)
  }
})

test('Build Profile Next needs valid hours only, not a call type', () => {
  const page = buildProfileStep('/build-profile/consult-test', { freeOn: false })
  assert.equal(page.api.validate(), '')
  const step = page.root.parentElement
  let blocked = false
  const next = new FakeElement('a', { 'data-form': 'next-btn' })
  step.appendChild(next)
  step.listeners.click.forEach((listener) => listener({ target: next, preventDefault() { blocked = true }, stopImmediatePropagation() {} }))
  assert.equal(blocked, false)
})

test('Build Profile Free call choice follows its switch', () => {
  assert.equal(buildProfileStep('/build-profile/full-profile-test', { freeOn: true }).api.offerIntroCall(), true)
  assert.equal(buildProfileStep('/build-profile/full-profile-test', { freeOn: false }).api.offerIntroCall(), false)
})

test('Build Profile context needs a Build Profile path, the marker and a form step', () => {
  assert.equal(buildProfileStep('/starter-dashboard').api, null)
  assert.equal(buildProfileStep('/build-profile/select-profile').api, null)
  assert.equal(buildProfileStep('/build-profile/consult-test', { wrapped: false }).api, null)
})

// 2026-11-12: a new attribute written through the Webflow Data API is not published, and full-profile
// uses the shared Calls Form component, so Build Profile mode must work without the marker.
test('an unmarked calls root inside a Build Profile step runs Build Profile mode', () => {
  for (const path of ['/build-profile/consult-test', '/build-profile/full-profile-test', '/build-profile/consult', '/build-profile/full-profile']) {
    const page = buildProfileStep(path, { context: null, freeOn: false, paidOn: true })
    assert.ok(page.api, path)
    assert.equal(page.paid.row.hidden, true, path)
    assert.equal(page.paid.toggle.checked, false, path)
    assert.equal(page.stripe.hidden, true, path)
    assert.equal(page.availability.hidden, false, path)
    assert.equal(page.api.validate(), '', path)
    assert.equal(page.api.offerIntroCall(), false, path)
  }
})

test('an unmarked root outside a Build Profile step, or on another page, does not run Build Profile mode', () => {
  assert.equal(buildProfileStep('/build-profile/consult-test', { context: null, wrapped: false }).api, null)
  // Another page keeps the previous step-6 behaviour (boot is gated by route): Paid stays visible.
  assert.equal(buildProfileStep('/build-profile/select-profile', { context: null }).paid.row.hidden, false)
  const edit = buildProfileStep('/build-profile/consult-test', { context: 'edit' })
  assert.equal(edit.paid.row.hidden, false)
})
