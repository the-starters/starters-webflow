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

function build(pathname = '/starter-edit-profile-test') {
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
  const root = el('div', { 'data-calls-step': 'root', 'data-calls-step-context': 'edit' }, [
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
