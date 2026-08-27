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
  closest(selector) {
    if (this.closestMap && this.closestMap[selector]) return this.closestMap[selector]
    return selector === 'form[data-review-form-v3]' ? this : null
  }
  appendChild(element) { this.childNodes.push(element); return element }
  replaceChildren(...elements) { this.childNodes = elements }
}

function documentFixture() {
  // `data-toc-section` is what the published Hire template carries on the
  // Reviews wrapper, and it is the key the profile tab is tagged with.
  const root = new Element({ 'data-reviews-v3': 'profile', 'data-toc-section': 'reviews' })
  const reviewsTab = new Element({ 'data-hide-when-empty-id': 'reviews' })
  const average = new Element()
  const count = new Element()
  const summaryAverage = new Element()
  const summaryCount = new Element()
  const summaryBlockEl = new Element()
  summaryAverage.closestMap = {
    '[data-reviews-v3-summary-block], .profile-hero_card-progress': summaryBlockEl,
  }
  const legacySummaryAverage = new Element()
  const legacySummaryCount = new Element()
  const list = new Element({ 'data-reviews-v3-list': 'reviews' })
  const outsideList = new Element({ 'data-reviews-v3-list': 'reviews' })
  root.children['[data-reviews-v3-list="reviews"]'] = list
  root.matches['[data-reviews-v3-average]'] = [average]
  root.matches['[data-reviews-v3-count]'] = [count]
  const listeners = {}
  return {
    root,
    reviewsTab,
    average,
    count,
    summaryAverage,
    summaryCount,
    summaryBlockEl,
    legacySummaryAverage,
    legacySummaryCount,
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
      if (selector === '[data-reviews-v3-summary-average], #rating') {
        return [summaryAverage, legacySummaryAverage]
      }
      if (selector === '[data-reviews-v3-summary-count], #rating + span') {
        return [summaryCount, legacySummaryCount]
      }
      if (selector === '[data-hide-when-empty-id="reviews"]') return [reviewsTab]
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

test('hides the authored section and drops its placeholder cards at configuration', () => {
  const fixture = documentFixture()
  const placeholderOne = new Element()
  const placeholderTwo = new Element()
  fixture.list.appendChild(placeholderOne)
  fixture.list.appendChild(placeholderTwo)

  load({ document: fixture, pathname: '/hire/elvis-p' })

  // The Designer section ships visible and pre-filled with placeholder
  // "Verified Review" cards. Revealing it only after the approved response
  // arrives published those placeholders for the length of the request.
  assert.equal(fixture.root.hidden, true)
  assert.equal(fixture.root.style.display, 'none')
  assert.equal(fixture.root.getAttribute('data-starters-section-hidden'), '')
  assert.equal(fixture.list.childNodes.length, 0)
  // A visible tab pointing at a hidden section is the other half of the bug.
  assert.equal(fixture.reviewsTab.hidden, true)
  assert.equal(fixture.reviewsTab.style.display, 'none')
})

test('reveals the profile tab with the section, and only with it', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture, pathname: '/hire/elvis-p' })
  assert.equal(fixture.reviewsTab.hidden, true)

  api.paintProfile(fixture, fixture.root, {
    raw: { reviews: [{ review_id: 7, rating: 5 }], aggregate: { review_count: 1, average_rating: 5 } },
  })
  assert.equal(fixture.reviewsTab.hidden, false)
  assert.equal(fixture.reviewsTab.style.display, '')
  assert.equal(fixture.reviewsTab.getAttribute('data-starters-section-hidden'), null)

  api.paintProfile(fixture, fixture.root, {
    raw: { reviews: [], aggregate: { review_count: 0, average_rating: 0 } },
  })
  assert.equal(fixture.reviewsTab.hidden, true)
  assert.equal(fixture.reviewsTab.style.display, 'none')
})

test('leaves the tab alone when the section carries no toc key', () => {
  const fixture = documentFixture()
  fixture.root.removeAttribute('data-toc-section')
  load({ document: fixture, pathname: '/hire/elvis-p' })
  assert.equal(fixture.root.hidden, true)
  assert.equal(fixture.reviewsTab.hidden, false)
})

test('leaves a non-profile page untouched at configuration', () => {
  const fixture = documentFixture()
  fixture.list.appendChild(new Element())

  load({ document: fixture, pathname: '/brand-dashboard' })

  assert.equal(fixture.root.hidden, false)
  assert.equal(fixture.root.style.display, '')
  assert.equal(fixture.list.childNodes.length, 1)
})

test('keeps the authored section hidden when no approved result ever arrives', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture, pathname: '/hire/elvis-p' })
  const handlers = {}
  const instance = { on(name, handler) { handlers[name] = handler } }

  // The wf-xano request errors (the reviews endpoint rejects non-production
  // origins, so this is the permanent staging state) — `results` never fires.
  api.wireInstances({ get() { return instance } }, fixture, fixture.root)

  assert.equal(typeof handlers.results, 'function')
  assert.equal(fixture.root.hidden, true)
  assert.equal(fixture.root.style.display, 'none')
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
  assert.equal(fixture.count.textContent, '12')
  assert.equal(fixture.summaryAverage.textContent, '4.8')
  assert.equal(fixture.summaryCount.textContent, '12')
  assert.equal(fixture.legacySummaryAverage.textContent, '4.8')
  assert.equal(fixture.legacySummaryCount.textContent, '12')
  assert.equal(fixture.summaryBlockEl.hidden, false)
  assert.equal(fixture.summaryBlockEl.style.display, '')
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
  assert.equal(fixture.summaryAverage.textContent, '0')
  assert.equal(fixture.summaryCount.textContent, '0')
  assert.equal(fixture.legacySummaryAverage.textContent, '0')
  assert.equal(fixture.legacySummaryCount.textContent, '0')
  assert.equal(fixture.summaryBlockEl.hidden, true)
  assert.equal(fixture.summaryBlockEl.style.display, 'none')
  assert.equal(fixture.root.hidden, true)
  assert.equal(fixture.root.style.display, 'none')
})

test('renders a whole-number average with one decimal', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  api.paintProfile(fixture, fixture.root, {
    raw: { reviews: [{ review_id: 42, rating: 5 }], aggregate: { review_count: 2, average_rating: 5 } },
  })
  assert.equal(fixture.summaryAverage.textContent, '5.0')
  assert.equal(fixture.summaryCount.textContent, '2')
  assert.equal(fixture.summaryBlockEl.hidden, false)
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
