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
    this.matches = Object.create(null)
    this.childNodes = []
    this.className = ''
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  removeAttribute(name) { delete this.attrs[name] }
  getAttribute(name) { return this.attrs[name] ?? null }
  querySelector(selector) { return this.children[selector] || null }
  querySelectorAll(selector) { return this.matches[selector] || [] }
  closest(selector) { return selector === 'form[data-review-form-v3]' ? this : null }
  appendChild(element) { this.childNodes.push(element); return element }
  replaceChildren(...elements) { this.childNodes = elements }
}

function documentFixture() {
  const root = new Element({ 'data-reviews-v3': 'profile' })
  const average = new Element()
  const legacyAverage = new Element()
  const count = new Element()
  const list = new Element({ 'data-reviews-v3-list': 'reviews' })
  const outsideList = new Element({ 'data-reviews-v3-list': 'reviews' })
  root.children['[data-reviews-v3-list="reviews"]'] = list
  root.matches['[data-reviews-v3-average], #rating'] = [average, legacyAverage]
  root.matches['[data-reviews-v3-count], .profile-hero_card-progress [fs-countitems-element="value"]'] = [count]
  const listeners = {}
  return {
    root,
    average,
    legacyAverage,
    count,
    list,
    outsideList,
    listeners,
    addEventListener(name, handler, capture) { listeners[name] = { handler, capture } },
    dispatchEvent() {},
    querySelector(selector) {
      if (selector === '[data-reviews-v3="profile"]') return root
      if (selector === '[data-reviews-v3-list="reviews"]') return outsideList
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
  const wfx = options.wfx || callbacks
  const window = {
    document,
    location: { pathname: options.pathname || '/not-a-profile' },
    crypto: options.crypto || { randomUUID: () => 'uuid-123' },
    WfXano: wfx,
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
  assert.equal(fixture.root.getAttribute('wf-xano-element'), 'wrapper')
  assert.equal(fixture.root.getAttribute('wf-xano-instance'), 'starter-reviews')
  assert.equal(fixture.root.getAttribute('wf-xano-source'), 'opp30:starter/reviews/summary')
  assert.equal(fixture.root.getAttribute('wf-xano-method'), 'GET')
  assert.equal(fixture.root.getAttribute('wf-xano-auth'), 'none')
  assert.equal(fixture.list.getAttribute('wf-xano-element'), 'list')
  assert.equal(fixture.list.getAttribute('aria-live'), 'polite')
  assert.equal(fixture.root.childNodes[0].getAttribute('wf-xano-element'), 'template')
  assert.equal(fixture.root.childNodes[0].hidden, true)
})

test('fails closed when the authored profile review attributes are absent', () => {
  const fixture = documentFixture()
  fixture.root.removeAttribute('data-reviews-v3')
  fixture.querySelector = () => null

  const { api } = load({ document: fixture, pathname: '/hire/jp-dionisio' })
  assert.equal(api.configureProfileRoot(fixture, '/hire/jp-dionisio'), null)
  assert.equal(fixture.root.getAttribute('wf-xano-source'), null)
})

test('fails closed when the authored review list target is absent', () => {
  const fixture = documentFixture()
  delete fixture.root.children['[data-reviews-v3-list="reviews"]']

  const { api } = load({ document: fixture, pathname: '/hire/jp-dionisio' })
  assert.equal(api.configureProfileRoot(fixture, '/hire/jp-dionisio'), null)
  assert.equal(fixture.root.getAttribute('wf-xano-source'), null)
})

test('initializes the profile wrapper when wf-xano already booted', () => {
  const fixture = documentFixture()
  const initialized = []
  const callbacks = []
  const wfx = {
    init(root) { initialized.push(root) },
    push(callback) { callbacks.push(callback) },
  }
  load({ document: fixture, pathname: '/hire/elvis-p', wfx })
  assert.deepEqual(initialized, [fixture.root])
  assert.equal(callbacks.length, 1)
})

test('does not compete with the dashboard controller for review submission', () => {
  const fixture = documentFixture()
  const { callbacks } = load({ document: fixture, pathname: '/brand-dashboard' })
  assert.equal(fixture.listeners.submit, undefined)
  assert.equal(callbacks.length, 0)
})

test('paints approved aggregate and reveals the authored section', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  const raw = {
    reviews: [{ review_id: 41, rating: 4 }, { review_id: 42, rating: 5 }],
    aggregate: { review_count: 12, average_rating: 4.8 },
  }
  assert.equal(api.paintProfile(fixture, fixture.root, { raw, items: [raw] }), true)
  assert.equal(fixture.average.textContent, '4.8')
  assert.equal(fixture.legacyAverage.textContent, '4.8')
  assert.equal(fixture.count.textContent, '12')
  assert.equal(fixture.list.childNodes.length, 2)
  assert.equal(fixture.outsideList.childNodes.length, 0)
  assert.equal(fixture.root.hidden, false)
  assert.equal(fixture.root.style.display, '')
})

test('keeps an empty authored reviews section hidden', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  api.paintProfile(fixture, fixture.root, {
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
  assert.equal(api.renderProfileReviews(fixture, fixture.root, [{
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
  api.wireInstances(wfx, fixture, fixture.root)
  api.wireInstances(wfx, fixture, fixture.root)
  assert.equal(typeof handlers.results, 'function')
  const raw = {
    reviews: [{ rating: 5 }],
    aggregate: { review_count: 3, average_rating: 4.7 },
  }
  handlers.results({ raw, items: [raw] })
  assert.equal(fixture.list.childNodes.length, 1)
  assert.equal(fixture.count.textContent, '3')
  assert.equal(fixture.average.textContent, '4.7')
  assert.equal(fixture.outsideList.childNodes.length, 0)
})

test('refuses profile wiring without the validated root and descendant list', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  let reads = 0
  const wfx = { get() { reads += 1 } }

  api.wireInstances(wfx, fixture, null)
  delete fixture.root.children['[data-reviews-v3-list="reviews"]']
  api.wireInstances(wfx, fixture, fixture.root)

  assert.equal(reads, 0)
  assert.equal(api.paintProfile(fixture, fixture.root, { raw: { reviews: [{ rating: 5 }] } }), false)
  assert.equal(fixture.outsideList.childNodes.length, 0)
})
