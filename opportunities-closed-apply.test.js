const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const core = fs.readFileSync(require.resolve('./opportunities-3.0.js'), 'utf8')

// Minimal element/selector engine (same as opportunities-close-modal-title.test.js): state blocks are resolved
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

  get parentNode() {
    return this.parent
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

// Talent detail page skeleton, mirroring the published /opportunities/<id>
// template: the Apply trigger (not-applied) and the applied/edited CTA block.
// The template has no closed state block (2026-11-26 published source).
function talentDetailPage({ authoredClosedBlock = false, wrappedApply = false } = {}) {
  const documentElement = new FakeElement('html')
  const body = documentElement.append('body')
  const group = body.append('div', { 'data-ms-content': 'freelancer-only' })
  const apply = wrappedApply
    ? group.append('div', { 'data-opp-state': 'not-applied' })
    : group.append('div', {
        'data-modal-trigger': 'apply-opportunity',
        'data-opp-state': 'not-applied',
      })
  if (wrappedApply) apply.append('a', { 'data-modal-trigger': 'apply-opportunity' })
  const applied = group.append('div', { 'data-opp-state': 'applied edited' })
  const authored = authoredClosedBlock ? group.append('div', { 'data-opp-state': 'closed' }) : null
  return { apply, applied, authored, body, documentElement, group }
}

function loadTalentDetail(detail, options) {
  const page = talentDetailPage(options)
  const document = {
    addEventListener() {},
    createElement: (tag) => new FakeElement(tag),
    dispatchEvent() {},
    documentElement: page.documentElement,
    getElementById: () => null,
    head: page.documentElement,
    querySelector: (selector) => page.documentElement.querySelector(selector),
    querySelectorAll: (selector) => page.documentElement.querySelectorAll(selector),
    // 'loading' keeps the controller from booting its own role router; the
    // test drives initTalentDetail directly through the public Opp30 surface.
    readyState: 'loading',
  }
  const window = {
    $memberstackDom: { getCurrentMember: async () => ({ data: null }) },
    addEventListener() {},
    clearInterval,
    clearTimeout,
    dispatchEvent() {},
    setInterval,
    setTimeout,
  }
  window.window = window
  vm.runInNewContext(core, {
    CustomEvent: class CustomEvent {},
    Event: class Event {},
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
      href: 'https://example.test/opportunities/755',
      hostname: 'example.test',
      pathname: '/opportunities/755',
      search: '',
    },
    window,
  })
  window.Opp30.API.starterOppDetail = async () => detail
  return { ...page, window }
}

const member = { id: 'mem_test' }
const OPEN = { id: 755, status: 'Active', closed_at: null }
const CLOSED = { id: 755, status: 'Closed', closed_at: 1795636031651 }

test('a Starter who has not applied sees Apply on an open opportunity', async () => {
  const { apply, applied, group, window } = loadTalentDetail({ opportunity: OPEN, application: null })
  await window.Opp30.initTalentDetail(member)
  assert.equal(apply.style.display, '')
  assert.equal(applied.style.display, 'none')
  assert.equal(group.querySelector('[data-opp-closed-notice]'), null)
})

test('a Starter who has not applied does not see Apply on a closed opportunity and gets a closed notice', async () => {
  const { apply, applied, group, window } = loadTalentDetail({ opportunity: CLOSED, application: null })
  await window.Opp30.initTalentDetail(member)
  assert.equal(apply.style.display, 'none')
  assert.equal(applied.style.display, 'none')
  const notice = group.querySelector('[data-opp-closed-notice]')
  assert.ok(notice, 'closed notice is rendered')
  assert.equal(notice.style.display, '')
  assert.match(notice.textContent, /closed and no longer accepts applications/)
})

test('a Designer-authored closed block is used instead of the runtime notice', async () => {
  const { apply, authored, group, window } = loadTalentDetail(
    { opportunity: CLOSED, application: null },
    { authoredClosedBlock: true },
  )
  await window.Opp30.initTalentDetail(member)
  assert.equal(apply.style.display, 'none')
  assert.equal(authored.style.display, '')
  assert.equal(group.querySelector('[data-opp-closed-notice]'), null)
})

test('a Starter who applied before the close also sees the closed notice instead of empty CTAs', async () => {
  const application = { id: 9, canceled_at: null, seen_opportunity_revision: 1 }
  const { apply, applied, group, window } = loadTalentDetail({ opportunity: CLOSED, application })
  await window.Opp30.initTalentDetail(member)
  assert.equal(apply.style.display, 'none')
  assert.equal(applied.style.display, 'none')
  assert.ok(group.querySelector('[data-opp-closed-notice]'))
})

test('the closed notice stays visible when the Apply trigger sits inside a not-applied wrapper', async () => {
  const { apply, group, window } = loadTalentDetail(
    { opportunity: CLOSED, application: null },
    { wrappedApply: true },
  )
  await window.Opp30.initTalentDetail(member)
  assert.equal(apply.style.display, 'none')
  const notice = group.querySelector('[data-opp-closed-notice]')
  assert.ok(notice, 'closed notice is rendered')
  assert.equal(notice.parent, group)
  assert.equal(notice.style.display, '')
})
