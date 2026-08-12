const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const { setImmediate: tick } = require('node:timers/promises')

const source = fs.readFileSync(require.resolve('./talent-application-ui.js'), 'utf8')

function matches(element, selector) {
  if (selector.endsWith(':checked')) {
    return element.checked && matches(element, selector.slice(0, -8))
  }
  if (selector.startsWith('#')) return element.id === selector.slice(1)
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1))

  const match = selector.match(/^(\w+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?(?:#([\w-]+))?$/)
  if (!match) throw new Error(`Unsupported selector: ${selector}`)
  const [, tag, attribute, expected, id] = match
  if (tag && element.tagName !== tag.toUpperCase()) return false
  if (id && element.id !== id) return false
  if (!attribute) return true
  if (!element.hasAttribute(attribute)) return false
  return expected === undefined || element.getAttribute(attribute) === expected
}

class TestEvent {
  constructor(type, options = {}) {
    this.type = type
    this.bubbles = Boolean(options.bubbles)
    this.animationName = options.animationName
    this.target = null
  }
}

class TestElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.parentNode = null
    this._attributes = new Map()
    this._listeners = new Map()
    this._value = ''
    this.checked = false
    this.disabled = false
    this.required = false
    this.dataset = {}
    this.textContent = ''
    this.style = {}

    const classes = new Set()
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    }

    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value)
  }

  get id() {
    return this.getAttribute('id') || ''
  }

  set id(value) {
    this.setAttribute('id', value)
  }

  get className() {
    return this.getAttribute('class') || ''
  }

  set className(value) {
    this.setAttribute('class', value)
  }

  get value() {
    return this._value
  }

  set value(value) {
    this._value = String(value)
  }

  get options() {
    return this.tagName === 'SELECT' ? this.children.filter((child) => child.tagName === 'OPTION') : undefined
  }

  get selectedIndex() {
    if (this.tagName !== 'SELECT') return -1
    const selected = this.options.findIndex((option) => option.value === this.value)
    return selected >= 0 ? selected : 0
  }

  set innerHTML(value) {
    this.children = []
    const optionPattern = /<option value="([^"]*)">([^<]*)<\/option>/g
    let match
    while ((match = optionPattern.exec(value))) {
      const option = new TestElement('option')
      option.value = match[1]
      option.textContent = match[2]
      this.appendChild(option)
    }
    this._notifyMutation()
  }

  get innerHTML() {
    return this.children.map((child) => child.textContent).join('')
  }

  setAttribute(name, value) {
    this._attributes.set(name, String(value))
    if (name === 'class') {
      value.split(/\s+/).filter(Boolean).forEach((item) => this.classList.add(item))
    } else if (name === 'required') {
      this.required = true
    } else if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      this.dataset[key] = String(value)
    }
    this._notifyMutation()
  }

  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null
  }

  hasAttribute(name) {
    return this._attributes.has(name)
  }

  removeAttribute(name) {
    this._attributes.delete(name)
    if (name === 'required') this.required = false
    this._notifyMutation()
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    this._notifyMutation()
    return child
  }

  insertBefore(child, reference) {
    child.parentNode = this
    const index = this.children.indexOf(reference)
    this.children.splice(index < 0 ? this.children.length : index, 0, child)
    this._notifyMutation()
    return child
  }

  remove() {
    if (!this.parentNode) return
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this)
    this.parentNode = null
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  querySelectorAll(selector) {
    return this.descendants().filter((element) => matches(element, selector))
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  contains(target) {
    return target === this || this.descendants().includes(target)
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) || []
    listeners.push(listener)
    this._listeners.set(type, listeners)
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this
    for (const listener of this._listeners.get(event.type) || []) listener.call(this, event)
    if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event)
    return true
  }

  focus() {
    this.focused = true
  }

  _notifyMutation() {
    for (const observer of TestMutationObserver.instances) {
      if (observer.target === this) observer.callback([])
    }
  }
}

class TestMutationObserver {
  static instances = []

  constructor(callback) {
    this.callback = callback
    TestMutationObserver.instances.push(this)
  }

  observe(target) {
    this.target = target
  }
}

function element(tag, attributes, children = []) {
  const node = new TestElement(tag, attributes)
  children.forEach((child) => node.appendChild(child))
  return node
}

function makeMarkup() {
  const field = (id, attributes = {}) => element('input', { id, ...attributes })
  const firstName = field('first-name')
  const linkedin = field('linkedin')
  const email = field('email')
  const phone = field('phone')
  const fullProfile = field('full-profile', { name: 'profile-type' })
  const consultOnly = field('consult-only', { name: 'profile-type' })
  const rate = field('rate')
  const rateConsult = field('rate-consult')
  const role = field('role', { name: 'role-option' })
  const consult = field('consult', { name: 'consult-option' })
  const referralSource = element('select', { id: 'referral-source' })
  const referred = field('referred')
  const other = field('other')
  const country = element('select', { id: 'country' })
  const state = element('select', { id: 'state' })
  const city = element('select', { id: 'city' })
  const next = element('button', { 'form-next': '' })
  const submit = element('button', { 'form-submit': '' })
  const fullBlock = element('div', { 'data-element': 'full-profile' }, [rate, role])
  const consultBlock = element('div', { 'data-element': 'consult' }, [rateConsult, consult])
  const referredBlock = element('div', { 'data-element': 'referred' }, [referred])
  const otherBlock = element('div', { 'data-element': 'other-option' }, [other])
  const wrappers = [country, state, city].map((select) => element('div', {}, [select]))
  const form = element('form', { 'application-form': '' }, [
    element('div', {}, [firstName]),
    element('div', {}, [linkedin]),
    element('div', {}, [email]),
    phone,
    fullProfile,
    consultOnly,
    fullBlock,
    consultBlock,
    referralSource,
    referredBlock,
    otherBlock,
    ...wrappers,
    next,
    submit,
  ])
  const body = element('body', {}, [form])
  return {
    body,
    form,
    firstName,
    linkedin,
    email,
    phone,
    fullProfile,
    consultOnly,
    rate,
    rateConsult,
    referralSource,
    referred,
    other,
    country,
    state,
    city,
    next,
    submit,
    fullBlock,
    consultBlock,
    referredBlock,
    otherBlock,
  }
}

async function mount() {
  TestMutationObserver.instances = []
  const markup = makeMarkup()
  const documentListeners = new Map()
  const fetches = []
  const logs = []
  const locations = [{ name: 'Philippines', states: [{ name: 'Metro Manila', cities: [{ name: 'Makati' }] }] }]
  const document = {
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || []
      listeners.push(listener)
      documentListeners.set(type, listeners)
    },
    querySelector: (selector) => markup.body.querySelector(selector),
    querySelectorAll: (selector) => markup.body.querySelectorAll(selector),
    getElementById: (id) => markup.body.descendants().find((node) => node.id === id) || null,
    createElement: (tag) => new TestElement(tag),
  }
  const context = {
    window: {},
    document,
    MutationObserver: TestMutationObserver,
    Event: TestEvent,
    fetch: async (...args) => {
      fetches.push(args)
      return { json: async () => locations }
    },
    localStorage: { setItem() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (callback) => callback(),
    console: {
      log: (...args) => logs.push(['log', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
  }
  context.window.document = document
  vm.createContext(context)
  vm.runInContext(source, context)
  for (const listener of documentListeners.get('DOMContentLoaded') || []) listener(new TestEvent('DOMContentLoaded'))
  await tick()
  await tick()
  return { ...markup, context, documentListeners, fetches, logs }
}

function fire(target, type, options = { bubbles: true }) {
  target.dispatchEvent(new TestEvent(type, options))
}

test('boots once and registers one UI initializer', () => {
  const listeners = []
  const context = {
    window: {},
    document: { addEventListener: (type, listener) => listeners.push({ type, listener }) },
    MutationObserver: TestMutationObserver,
    Event: TestEvent,
    setInterval,
    clearInterval,
    setTimeout,
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  vm.runInContext(source, context)

  assert.equal(context.window.__startersTalentApplicationUiBooted, true)
  assert.deepEqual(listeners.map(({ type }) => type), ['DOMContentLoaded'])
})

test('does not submit or expose applicant data while handling UI events', async () => {
  const mounted = await mount()
  mounted.firstName.value = 'Private Person'
  mounted.email.value = 'private@example.com'
  mounted.linkedin.value = 'https://linkedin.com/in/private-person'
  mounted.phone.value = '+63 900 000 0000'
  mounted.referralSource.value = 'Referral'

  fire(mounted.firstName, 'input')
  fire(mounted.email, 'input')
  fire(mounted.linkedin, 'input')
  fire(mounted.referralSource, 'change')
  fire(mounted.form, 'submit')

  assert.equal(mounted.fetches.length, 1)
  assert.equal(
    mounted.fetches[0][0],
    'https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/69f1f101875b89285ab287fd_locations.txt',
  )
  assert.deepEqual(mounted.logs, [])
})

test('preserves validation, conditional fields, locations, and custom selects', async () => {
  const mounted = await mount()

  assert.equal(mounted.country.options.length, 2)
  assert.equal(mounted.country.options[1].textContent, 'Philippines')
  assert.equal(mounted.fullBlock.style.display, 'none')
  assert.equal(mounted.consultBlock.style.display, 'none')
  assert.equal(mounted.next.classList.contains('disabled'), true)

  mounted.email.value = 'invalid'
  mounted.linkedin.value = 'invalid'
  fire(mounted.email, 'input')
  fire(mounted.linkedin, 'input')
  assert.equal(mounted.email.style.borderColor, '#e11d48')
  assert.equal(mounted.linkedin.style.borderColor, '#e11d48')

  mounted.fullProfile.checked = true
  fire(mounted.fullProfile, 'change')
  assert.equal(mounted.fullBlock.style.display, 'flex')
  assert.equal(mounted.consultBlock.style.display, 'none')
  assert.equal(mounted.rate.required, true)
  assert.equal(mounted.rateConsult.required, false)

  mounted.referralSource.value = 'Referral'
  fire(mounted.referralSource, 'change')
  assert.equal(mounted.referredBlock.style.display, 'block')
  assert.equal(mounted.referred.required, true)
  assert.equal(mounted.otherBlock.style.display, 'none')

  mounted.referralSource.value = 'Other'
  fire(mounted.referralSource, 'change')
  assert.equal(mounted.referred.required, false)
  assert.equal(mounted.otherBlock.style.display, 'block')
  assert.equal(mounted.other.required, true)

  mounted.country.value = '0'
  fire(mounted.country, 'change')
  assert.equal(mounted.state.disabled, false)
  assert.equal(mounted.state.options[1].textContent, 'Metro Manila')
  mounted.state.value = '0'
  fire(mounted.state, 'change')
  assert.equal(mounted.city.disabled, false)
  assert.equal(mounted.city.required, true)
  assert.equal(mounted.city.options[1].textContent, 'Makati')

  const cityWidget = mounted.city.__customSelectInstance
  cityWidget.trigger.dispatchEvent(new TestEvent('click'))
  assert.equal(cityWidget.container.classList.contains('open'), true)
  cityWidget.search.value = 'mak'
  fire(cityWidget.search, 'input')
  const cityOption = cityWidget.optionsContainer.querySelector('.custom-select-option')
  assert.equal(cityOption.classList.contains('hidden'), false)
  cityOption.dispatchEvent(new TestEvent('click'))
  assert.equal(mounted.city.value, 'Makati')
  assert.equal(cityWidget.trigger.textContent, 'Makati')

  mounted.email.value = 'private@example.com'
  mounted.linkedin.value = 'https://linkedin.com/in/private-person'
  mounted.phone.value = '+63 900 000 0000'
  fire(mounted.form, 'input')
  assert.equal(mounted.next.classList.contains('disabled'), false)
  assert.equal(mounted.next.style.pointerEvents, 'auto')
})
