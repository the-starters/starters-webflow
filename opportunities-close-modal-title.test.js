const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const core = fs.readFileSync(require.resolve('./opportunities-3.0.js'), 'utf8')

// Minimal element/selector engine: the close-modal title contract is resolved
// through closest()/matches()/querySelectorAll() on live ancestors, so the
// wiring can only be exercised against a real tree rather than per-selector
// stubs.
const COMPOUND =
  /^(?:([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]|:([\w-]+)|#([\w-]+))/

function parseCompound(text) {
  const spec = { tag: '', ids: [], classes: [], attrs: [], pseudos: [] }
  let rest = text
  while (rest) {
    const match = rest.match(COMPOUND)
    if (!match) throw new Error(`unsupported selector: ${text}`)
    if (match[1]) spec.tag = match[1].toLowerCase()
    else if (match[2]) spec.classes.push(match[2])
    else if (match[3]) spec.attrs.push({ name: match[3], op: match[4] || '', value: match[5] || '' })
    else if (match[6]) spec.pseudos.push(match[6])
    else spec.ids.push(match[7])
    rest = rest.slice(match[0].length)
  }
  return spec
}

function matchesCompound(el, spec) {
  if (spec.tag && el.tag !== spec.tag) return false
  if (!spec.ids.every((id) => el.getAttribute('id') === id)) return false
  if (!spec.classes.every((cls) => el.classes.includes(cls))) return false
  if (spec.pseudos.some((pseudo) => pseudo !== 'checked' || el.checked !== true)) return false
  return spec.attrs.every(({ name, op, value }) => {
    const actual = el.getAttribute(name)
    if (actual === null) return false
    if (op === '=') return actual === value
    if (op === '*=') return actual.includes(value)
    if (op === '^=') return actual.startsWith(value)
    if (op === '$=') return actual.endsWith(value)
    return true
  })
}

function matchesSelector(el, selector) {
  return String(selector)
    .split(',')
    .map((group) => group.trim().split(/\s+/).map(parseCompound))
    .some((parts) => {
      if (!matchesCompound(el, parts[parts.length - 1])) return false
      let index = parts.length - 2
      for (let node = el.parent; node && index >= 0; node = node.parent)
        if (matchesCompound(node, parts[index])) index -= 1
      return index < 0
    })
}

class FakeElement {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag
    this.attrs = new Map(Object.entries(attrs).map(([name, value]) => [name, String(value)]))
    this.classes = []
    this.children = []
    this.parent = null
    this.style = {}
    this.textContent = ''
    this.clicks = 0
    this.classList = {
      add: (cls) => {
        if (!this.classes.includes(cls)) this.classes.push(cls)
      },
      remove: (cls) => {
        this.classes = this.classes.filter((existing) => existing !== cls)
      },
      toggle: () => {},
    }
  }

  append(tag, attrs, classes = []) {
    const child = new FakeElement(tag, attrs)
    child.classes = classes
    child.parent = this
    this.children.push(child)
    return child
  }

  appendChild(child) {
    child.parent = this
    this.children.push(child)
    return child
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value))
  }

  removeAttribute(name) {
    this.attrs.delete(name)
  }

  hasAttribute(name) {
    return this.attrs.has(name)
  }

  matches(selector) {
    return matchesSelector(this, selector)
  }

  closest(selector) {
    for (let node = this; node; node = node.parent) if (node.matches(selector)) return node
    return null
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  querySelectorAll(selector) {
    return this.descendants().filter((el) => el.matches(selector))
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  cloneNode() {
    const copy = new FakeElement(this.tag, Object.fromEntries(this.attrs))
    copy.classes = [...this.classes]
    return copy
  }

  click() {
    this.clicks += 1
  }
}

// Brand-feed page skeleton: the shared Close modal with the Designer-authored
// active/closed nav title twins plus one clickable card that supplies activeOpp.
function brandFeedPage() {
  const documentElement = new FakeElement('html')
  const body = documentElement.append('body')
  const card = body.append('div', { 'data-opp-id': '42' })
  const modal = body.append('div', { 'data-modal-target': 'close-opportunity' })
  const nav = modal.append('div', {}, ['modal_nav'])
  const confirmTitle = nav.append('h2', { 'data-opp-status': 'active' })
  const successTitle = nav.append('h2', { 'data-opp-status': 'closed' })
  const confirmButton = modal.append('div', { 'data-close-opp': 'confirm-button' })
  return { body, card, confirmButton, confirmTitle, documentElement, modal, successTitle }
}

function loadBrandFeed() {
  const page = brandFeedPage()
  const documentListeners = new Map()
  const windowListeners = new Map()
  const record = (listeners) => (type, listener) => {
    const bucket = listeners.get(type) || []
    bucket.push(listener)
    listeners.set(type, bucket)
  }
  const dispatch = (listeners) => (event) => {
    let stopped = false
    const target = {
      ...event,
      preventDefault() {},
      stopPropagation() {
        stopped = true
      },
    }
    for (const listener of listeners.get(event.type) || []) {
      listener(target)
      if (stopped) break
    }
    return !stopped
  }
  const document = {
    addEventListener: record(documentListeners),
    createElement: (tag) => new FakeElement(tag),
    dispatchEvent: dispatch(documentListeners),
    documentElement: page.documentElement,
    getElementById: () => null,
    head: page.documentElement,
    querySelector: (selector) => page.documentElement.querySelector(selector),
    querySelectorAll: (selector) => page.documentElement.querySelectorAll(selector),
    // 'complete' so the controller boots synchronously and wires the
    // close-opportunity delegation the same way the live page does.
    readyState: 'complete',
  }
  const window = {
    // Resolves the Memberstack gate immediately as "signed out", so the brand
    // feed controllers bail early instead of polling for 10s. The Close
    // delegation and the modal-open listener are wired regardless.
    $memberstackDom: { getCurrentMember: async () => ({ data: null }) },
    addEventListener: record(windowListeners),
    clearInterval,
    clearTimeout,
    dispatchEvent: dispatch(windowListeners),
    setInterval,
    setTimeout,
  }
  window.window = window
  vm.runInNewContext(core, {
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type
        this.detail = options.detail
      }
    },
    Event: class Event {
      constructor(type) {
        this.type = type
      }
    },
    FormData,
    Headers,
    MutationObserver: class MutationObserver {},
    Request,
    URL,
    URLSearchParams,
    alert() {},
    console: { error() {}, info() {}, log() {}, warn() {} },
    document,
    fetch: async () => {
      throw new Error('unexpected fetch')
    },
    history: { replaceState() {} },
    location: {
      href: 'https://example.test/opportunities-brands-view',
      hostname: 'example.test',
      pathname: '/opportunities-brands-view',
      search: '',
    },
    window,
  })
  return { ...page, document, window }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('opening the close modal upgrades the status twins and shows only the confirmation title', () => {
  const { confirmTitle, modal, successTitle, window } = loadBrandFeed()

  window.dispatchEvent({ type: 'modal-open', detail: { modal } })

  assert.equal(confirmTitle.getAttribute('data-close-opp-title'), 'confirm')
  assert.equal(successTitle.getAttribute('data-close-opp-title'), 'success')
  assert.equal(confirmTitle.getAttribute('data-opp-status'), null)
  assert.equal(successTitle.getAttribute('data-opp-status'), null)
  assert.equal(confirmTitle.style.display, '')
  assert.equal(successTitle.style.display, 'none')
})

test('the document-level status painter no longer owns the upgraded close modal titles', () => {
  const { confirmTitle, modal, successTitle, window } = loadBrandFeed()

  window.dispatchEvent({ type: 'modal-open', detail: { modal } })
  window.Opp30.paintOpportunityDetail({ status: 'Closed' })

  assert.equal(confirmTitle.style.display, '')
  assert.equal(successTitle.style.display, 'none')
})

test('a successful close reveals the success title and advances the form flow', async () => {
  const { card, confirmButton, confirmTitle, document, modal, successTitle, window } =
    loadBrandFeed()
  const closed = []
  window.Opp30.API.brandOppClose = async (id) => {
    closed.push(id)
    return { id, status: 'Closed' }
  }

  document.dispatchEvent({ type: 'click', target: card })
  window.dispatchEvent({ type: 'modal-open', detail: { modal } })
  document.dispatchEvent({ type: 'click', target: confirmButton })
  await settle()
  await settle()

  assert.deepEqual(closed, [42])
  assert.equal(confirmTitle.style.display, 'none')
  assert.equal(successTitle.style.display, '')
  assert.equal(confirmButton.clicks, 1)
})

test('reopening the close modal after a close rewinds to the confirmation title', async () => {
  const { card, confirmButton, confirmTitle, document, modal, successTitle, window } =
    loadBrandFeed()
  window.Opp30.API.brandOppClose = async (id) => ({ id, status: 'Closed' })

  document.dispatchEvent({ type: 'click', target: card })
  window.dispatchEvent({ type: 'modal-open', detail: { modal } })
  document.dispatchEvent({ type: 'click', target: confirmButton })
  await settle()
  await settle()
  assert.equal(successTitle.style.display, '')

  window.dispatchEvent({ type: 'modal-open', detail: { modal } })

  assert.equal(confirmTitle.style.display, '')
  assert.equal(successTitle.style.display, 'none')
})

test('a failed close leaves the confirmation title in place', async () => {
  const { card, confirmButton, confirmTitle, document, modal, successTitle, window } =
    loadBrandFeed()
  window.Opp30.API.brandOppClose = async () => {
    throw new Error('xano down')
  }

  document.dispatchEvent({ type: 'click', target: card })
  window.dispatchEvent({ type: 'modal-open', detail: { modal } })
  document.dispatchEvent({ type: 'click', target: confirmButton })
  await settle()
  await settle()

  assert.equal(confirmTitle.style.display, '')
  assert.equal(successTitle.style.display, 'none')
  assert.equal(confirmButton.clicks, 0)
})
