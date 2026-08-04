'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'reviews.js'), 'utf8')

class Element {
  constructor(attrs = {}) {
    this.attrs = { ...attrs }
    this.value = attrs.value || ''
    this.textContent = ''
    this.hidden = false
    this.style = { display: '' }
    this.children = Object.create(null)
    this.childNodes = []
    this.className = ''
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  removeAttribute(name) { delete this.attrs[name] }
  getAttribute(name) { return this.attrs[name] ?? null }
  querySelector(selector) { return this.children[selector] || null }
  closest(selector) { return selector === 'form[data-review-form-v3]' ? this : null }
  appendChild(element) { this.childNodes.push(element); return element }
  replaceChildren(...elements) { this.childNodes = elements }
}

function documentFixture() {
  const root = new Element({ 'data-reviews-v3': '' })
  const average = new Element()
  const legacyAverage = new Element()
  const count = new Element()
  const list = new Element({ 'data-reviews-v3-list': 'true' })
  const listeners = {}
  return {
    root,
    average,
    legacyAverage,
    count,
    list,
    listeners,
    addEventListener(name, handler, capture) { listeners[name] = { handler, capture } },
    dispatchEvent() {},
    querySelector(selector) {
      if (selector === '[data-reviews-v3]') return root
      if (selector === '[data-reviews-v3-list]') return list
      return null
    },
    createElement() { return new Element() },
    querySelectorAll(selector) {
      if (selector === '[data-reviews-v3-average], #rating') return [average, legacyAverage]
      if (selector === '[data-reviews-v3-count], .profile-hero_card-progress [fs-countitems-element="value"]') return [count]
      return []
    },
  }
}

function load(options = {}) {
  const document = options.document || documentFixture()
  const callbacks = []
  const window = {
    document,
    location: { pathname: options.pathname || '/not-a-profile' },
    crypto: options.crypto || { randomUUID: () => 'uuid-123' },
    WfXano: callbacks,
    CustomEvent: class CustomEvent { constructor(name, init) { this.type = name; this.detail = init.detail } },
    Uint32Array,
    Math,
    Date,
  }
  vm.runInNewContext(SOURCE, { window, Uint32Array, Math, Date }, { filename: 'reviews.js' })
  return { api: window.StartersReviewsV3, callbacks, document, window }
}

test('extracts and decodes only a canonical /hire profile slug', () => {
  const { api } = load()
  assert.equal(api.profileSlug('/hire/elvis-p'), 'elvis-p')
  assert.equal(api.profileSlug('/hire/jane%20doe/'), 'jane doe')
  assert.equal(api.profileSlug('/all-starters'), '')
})

test('configures the public wrapper with a slug before wf-xano boot', () => {
  const fixture = documentFixture()
  load({ document: fixture, pathname: '/hire/elvis-p' })
  assert.equal(fixture.root.getAttribute('wf-xano-param-starter_slug'), 'elvis-p')
  assert.equal(fixture.root.childNodes[0].getAttribute('wf-xano-element'), 'template')
  assert.equal(fixture.root.childNodes[0].hidden, true)
})

test('sets a fresh stable-project idempotency key in capture phase', () => {
  const fixture = documentFixture()
  load({ document: fixture })
  assert.equal(fixture.listeners.submit.capture, true)

  const form = new Element()
  const project = new Element({ value: '665' })
  const key = new Element()
  form.children['[wf-xano-field="project_id"]'] = project
  form.children['[wf-xano-field="idempotency_key"]'] = key
  fixture.listeners.submit.handler({ target: form })
  assert.equal(key.value, 'review-ui:665:uuid-123')
  assert.equal(key.getAttribute('value'), key.value)
})

test('paints approved aggregate and reveals the authored section', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  const raw = {
    reviews: [{ review_id: 41, rating: 4 }, { review_id: 42, rating: 5 }],
    aggregate: { review_count: 12, average_rating: 4.8 },
  }
  assert.equal(api.paintProfile(fixture, { raw, items: [raw] }), true)
  assert.equal(fixture.average.textContent, '4.8')
  assert.equal(fixture.legacyAverage.textContent, '4.8')
  assert.equal(fixture.count.textContent, '12')
  assert.equal(fixture.list.childNodes.length, 2)
  assert.equal(fixture.root.hidden, false)
  assert.equal(fixture.root.style.display, '')
})

test('keeps an empty authored reviews section hidden', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  api.paintProfile(fixture, {
    raw: { reviews: [], aggregate: { review_count: 0, average_rating: 0 } },
  })
  assert.equal(fixture.average.textContent, '0')
  assert.equal(fixture.count.textContent, '0')
  assert.equal(fixture.root.hidden, true)
  assert.equal(fixture.root.style.display, 'none')
})

test('replaces the legacy projection with sanitized Xano review cards', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  fixture.list.appendChild(new Element())
  assert.equal(api.renderProfileReviews(fixture, [{
    review_id: 42,
    rating: 5,
    review_text: '<img src=x onerror=alert(1)> Great work',
    published_at: '2026-08-04T00:00:00.000Z',
    brand: { company_name: 'Acme' },
  }]), true)
  assert.equal(fixture.list.childNodes.length, 1)
  const card = fixture.list.childNodes[0]
  assert.equal(card.getAttribute('data-review-id'), '42')
  assert.equal(card.childNodes[1].textContent, '<img src=x onerror=alert(1)> Great work')
  assert.equal(card.childNodes[0].childNodes[0].childNodes.length, 5)
  assert.equal(card.childNodes[0].childNodes[0].getAttribute('role'), 'img')
  assert.equal(card.childNodes[0].childNodes[0].getAttribute('aria-label'), '5 out of 5 stars')
  assert.equal(card.childNodes[0].childNodes[1].childNodes[0].textContent, 'Verified Review')
  assert.equal(card.childNodes[2].childNodes[0].textContent, 'Acme')
  assert.equal(card.childNodes[2].childNodes[1].textContent, 'Verified brand')
  assert.match(card.childNodes[0].childNodes[0].childNodes[0].src, /bootstrap-icons@1\.11\.3\/icons\/star-fill\.svg$/)
})

test('wires the profile results event once', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  const handlers = {}
  const instance = { on(name, handler) { handlers[name] = handler } }
  const wfx = { get(key) { return key === 'starter-reviews' ? instance : null } }
  api.wireInstances(wfx, fixture)
  api.wireInstances(wfx, fixture)
  assert.equal(typeof handlers.results, 'function')
  const raw = {
    reviews: [{ rating: 5 }],
    aggregate: { review_count: 3, average_rating: 4.7 },
  }
  handlers.results({ raw, items: [raw] })
  assert.equal(fixture.list.childNodes.length, 1)
  assert.equal(fixture.count.textContent, '3')
  assert.equal(fixture.average.textContent, '4.7')
})
