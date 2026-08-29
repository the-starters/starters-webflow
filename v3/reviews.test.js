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
  removeChild(element) {
    const index = this.childNodes.indexOf(element)
    if (index >= 0) this.childNodes.splice(index, 1)
    return element
  }
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
      if (selector === '[data-reviews-v3="profile"]') {
        return root.getAttribute('data-reviews-v3') === 'profile' ? [root] : []
      }
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
  assert.equal(fixture.root.getAttribute('data-reviews-v3-hidden'), '')
  // The shared hide-empty engine owns `data-starters-section-hidden` (its
  // value stores the display to restore) — this module must not stamp it.
  assert.equal(fixture.root.getAttribute('data-starters-section-hidden'), null)
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
  assert.equal(fixture.reviewsTab.getAttribute('data-reviews-v3-hidden'), null)

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
  // "Fails closed" must mean HIDDEN, not merely unwired: a missing list
  // target used to return before the hide, publishing the placeholder cards.
  assert.equal(fixture.root.hidden, true)
  assert.equal(fixture.root.style.display, 'none')
})

test('hides and empties every duplicate profile marker, wiring only the first', () => {
  const fixture = documentFixture()
  const dupList = new Element({ 'data-reviews-v3-list': 'reviews' })
  dupList.appendChild(new Element())
  const dupRoot = new Element({ 'data-reviews-v3': 'profile' })
  dupRoot.children['[data-reviews-v3-list="reviews"]'] = dupList
  const baseQsa = fixture.querySelectorAll.bind(fixture)
  fixture.querySelectorAll = (selector) =>
    selector === '[data-reviews-v3="profile"]' ? [fixture.root, dupRoot] : baseQsa(selector)

  load({ document: fixture, pathname: '/hire/elvis-p' })

  // The live template has shipped duplicate markers; a second one left
  // unhandled keeps publishing its authored placeholder cards.
  assert.equal(dupRoot.hidden, true)
  assert.equal(dupRoot.style.display, 'none')
  assert.equal(dupList.childNodes.length, 0)
  assert.equal(dupRoot.getAttribute('wf-xano-source'), null)
  assert.equal(fixture.root.getAttribute('wf-xano-source'), 'opp30:starter/reviews/summary')
})

test('hides the authored hero summary placeholder at configuration time', () => {
  const fixture = documentFixture()
  load({ document: fixture, pathname: '/hire/elvis-p' })
  // The summary lives outside the section, pre-filled by Designer; it must
  // fail closed with the section, not only be corrected after a result.
  assert.equal(fixture.summaryBlockEl.hidden, true)
  assert.equal(fixture.summaryBlockEl.style.display, 'none')
})

test('a revealed primary never re-touches the hidden duplicate', () => {
  const fixture = documentFixture()
  const dupList = new Element({ 'data-reviews-v3-list': 'reviews' })
  dupList.appendChild(new Element())
  const dupRoot = new Element({ 'data-reviews-v3': 'profile' })
  dupRoot.children['[data-reviews-v3-list="reviews"]'] = dupList
  const baseQsa = fixture.querySelectorAll.bind(fixture)
  fixture.querySelectorAll = (selector) =>
    selector === '[data-reviews-v3="profile"]' ? [fixture.root, dupRoot] : baseQsa(selector)

  const { api } = load({ document: fixture, pathname: '/hire/elvis-p' })
  api.paintProfile(fixture, fixture.root, {
    raw: { reviews: [{ review_id: 7, rating: 5 }], aggregate: { review_count: 1, average_rating: 5 } },
  })

  assert.equal(fixture.root.hidden, false)
  assert.equal(dupRoot.hidden, true)
  assert.equal(dupRoot.style.display, 'none')
  assert.equal(dupList.childNodes.length, 0)
})

test('a throwing tab selector still leaves the section configured and hidden', () => {
  const fixture = documentFixture()
  fixture.root.setAttribute('data-toc-section', 'rev"iews')
  const baseQsa = fixture.querySelectorAll.bind(fixture)
  fixture.querySelectorAll = (selector) => {
    if (selector.indexOf('data-hide-when-empty-id') !== -1) {
      throw new SyntaxError('invalid selector')
    }
    return baseQsa(selector)
  }

  load({ document: fixture, pathname: '/hire/elvis-p' })

  // A bad authored key must not abort the module after the hide.
  assert.equal(fixture.root.hidden, true)
  assert.equal(fixture.root.getAttribute('wf-xano-source'), 'opp30:starter/reviews/summary')
})

test('empties the list via textContent when replaceChildren is unavailable', () => {
  const fixture = documentFixture()
  fixture.list.appendChild(new Element())
  fixture.list.replaceChildren = undefined
  fixture.list.textContent = 'placeholder'

  load({ document: fixture, pathname: '/hire/elvis-p' })

  assert.equal(fixture.list.textContent, '')
})

test('the header @release marker matches the exported release property', () => {
  const headerMatch = SOURCE.match(/@release (v\d+\.\d+\.\d+)/)
  assert.ok(headerMatch, 'reviews.js must carry an @release header')
  const { api } = load()
  assert.equal(api.release, headerMatch[1])
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

test('renders a legacy testimonial without claiming verification', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  fixture.list.appendChild(new Element())
  assert.equal(api.renderProfileReviews(fixture, fixture.root, [{
    review_id: 73,
    rating: 5,
    review_text: 'Great work',
    published_at: '2026-08-28T00:00:00.000Z',
    verified: false,
    brand: null,
    reviewer: { display_name: 'Cliff', title: 'Top 1% Media Buyer', company_name: 'First Media' },
  }]), true)
  const card = fixture.list.childNodes[0]
  const badge = card.childNodes[0].childNodes[1]
  // The badge must not assert verification, and must not carry the check icon.
  assert.equal(badge.childNodes[0].textContent, 'Testimonial')
  assert.equal(badge.childNodes.length, 1)
  assert.match(badge.className, /profile-review-v3_badge-testimonial/)
  assert.equal(card.childNodes[2].childNodes[0].textContent, 'Cliff')
  assert.equal(card.childNodes[2].childNodes[1].textContent, 'Top 1% Media Buyer @ First Media')
})

test('a testimonial never renders the words "Verified brand"', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  fixture.list.appendChild(new Element())
  api.renderProfileReviews(fixture, fixture.root, [{
    review_id: 74,
    rating: 5,
    review_text: 'Solid',
    verified: false,
    brand: null,
    reviewer: { display_name: 'Zach', title: '', company_name: '' },
  }])
  const card = fixture.list.childNodes[0]
  assert.equal(card.childNodes[0].childNodes[1].childNodes[0].textContent, 'Testimonial')
  assert.equal(card.childNodes[2].childNodes[0].textContent, 'Zach')
  assert.equal(card.childNodes[2].childNodes[1].textContent, 'Client testimonial')
})

test('a payload with no verified flag still renders as a verified review', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  fixture.list.appendChild(new Element())
  api.renderProfileReviews(fixture, fixture.root, [{
    review_id: 75,
    rating: 4,
    review_text: 'Legacy shape',
    brand: { full_name: 'Cherene Aubert', company_name: 'Growth Capital' },
  }])
  const card = fixture.list.childNodes[0]
  assert.equal(card.childNodes[0].childNodes[1].childNodes[0].textContent, 'Verified Review')
  assert.equal(card.childNodes[2].childNodes[0].textContent, 'Cherene Aubert')
  assert.equal(card.childNodes[2].childNodes[1].textContent, 'Verified brand @ Growth Capital')
})

test('prefers the reviewer object over the brand join when both are present', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture })
  fixture.list.appendChild(new Element())
  api.renderProfileReviews(fixture, fixture.root, [{
    review_id: 76,
    rating: 5,
    review_text: 'Both shapes',
    verified: true,
    reviewer: { display_name: 'Reviewer Name', title: 'Head of Growth', company_name: 'Reviewer Co' },
    brand: { full_name: 'Brand Name', company_name: 'Brand Co' },
  }])
  const card = fixture.list.childNodes[0]
  assert.equal(card.childNodes[0].childNodes[1].childNodes[0].textContent, 'Verified Review')
  assert.equal(card.childNodes[2].childNodes[0].textContent, 'Reviewer Name')
  assert.equal(card.childNodes[2].childNodes[1].textContent, 'Verified brand @ Reviewer Co')
})

// Regression: the published Hire template carries `data-reviews-v3="profile"`
// TWICE, nested — the outer `#reviews` wrapper and, inside it, the authored
// section that actually holds the list. Configuration hides every marker to
// fail closed; before this fix the reveal re-showed only roots[0], so the inner
// section stayed display:none and collapsed the outer to zero height with the
// rendered cards sealed inside. Live symptom: hero read "4.9 (7 Reviews)" while
// the section rendered nothing.
function nestedDocumentFixture() {
  const outer = new Element({ 'data-reviews-v3': 'profile', 'data-toc-section': 'reviews' })
  const inner = new Element({ 'data-reviews-v3': 'profile' })
  const stray = new Element({ 'data-reviews-v3': 'profile' })
  const list = new Element({ 'data-reviews-v3-list': 'reviews' })
  const strayList = new Element({ 'data-reviews-v3-list': 'reviews' })
  // Only the outer and inner markers own the active list.
  outer.contains = (node) => node === list || node === inner
  inner.contains = (node) => node === list
  stray.contains = () => false
  outer.children['[data-reviews-v3-list="reviews"]'] = list
  inner.children['[data-reviews-v3-list="reviews"]'] = list
  stray.children['[data-reviews-v3-list="reviews"]'] = strayList
  const reviewsTab = new Element({ 'data-hide-when-empty-id': 'reviews' })
  return {
    outer, inner, stray, list, strayList, reviewsTab,
    addEventListener() {}, dispatchEvent() {}, createElement() { return new Element() },
    querySelector(selector) {
      if (selector === '[data-reviews-v3="profile"]') return outer
      if (selector === '[data-reviews-v3-list="reviews"]') return list
      return null
    },
    querySelectorAll(selector) {
      if (selector === '[data-reviews-v3="profile"]') return [outer, inner, stray]
      if (selector === '[data-hide-when-empty-id="reviews"]') return [reviewsTab]
      return []
    },
  }
}

test('configuration hides every nested marker and the stray duplicate', () => {
  const fixture = nestedDocumentFixture()
  const { api } = load({ document: fixture })
  assert.equal(api.configureProfileRoot(fixture, '/hire/lydia'), fixture.outer)
  for (const el of [fixture.outer, fixture.inner, fixture.stray]) {
    assert.equal(el.getAttribute('data-reviews-v3-hidden'), '')
    assert.equal(el.style.display, 'none')
  }
})

test('painting approved reviews reveals the whole chain that owns the list', () => {
  const fixture = nestedDocumentFixture()
  const { api } = load({ document: fixture })
  api.configureProfileRoot(fixture, '/hire/lydia')
  api.paintProfile(fixture, fixture.outer, {
    raw: { reviews: [{ review_id: 7, rating: 5 }], aggregate: { review_count: 1, average_rating: 5 } },
  })
  // Both markers own the rendered list, so both must be revealed. Revealing
  // only the outer leaves the inner display:none, which collapses the outer to
  // zero height with the rendered cards sealed inside it.
  assert.equal(fixture.outer.getAttribute('data-reviews-v3-hidden'), null)
  assert.equal(fixture.outer.style.display, '')
  assert.equal(fixture.inner.getAttribute('data-reviews-v3-hidden'), null)
  assert.equal(fixture.inner.style.display, '')
})

test('a stray marker that owns no list stays hidden after a successful paint', () => {
  const fixture = nestedDocumentFixture()
  const { api } = load({ document: fixture })
  api.configureProfileRoot(fixture, '/hire/lydia')
  api.paintProfile(fixture, fixture.outer, {
    raw: { reviews: [{ review_id: 7, rating: 5 }], aggregate: { review_count: 1, average_rating: 5 } },
  })
  assert.equal(fixture.stray.getAttribute('data-reviews-v3-hidden'), '')
  assert.equal(fixture.stray.style.display, 'none')
})

test('an empty approved response re-hides the whole chain', () => {
  const fixture = nestedDocumentFixture()
  const { api } = load({ document: fixture })
  api.configureProfileRoot(fixture, '/hire/lydia')
  api.paintProfile(fixture, fixture.outer, {
    raw: { reviews: [{ review_id: 7, rating: 5 }], aggregate: { review_count: 1, average_rating: 5 } },
  })
  api.paintProfile(fixture, fixture.outer, {
    raw: { reviews: [], aggregate: { review_count: 0, average_rating: 0 } },
  })
  for (const el of [fixture.outer, fixture.inner]) {
    assert.equal(el.getAttribute('data-reviews-v3-hidden'), '')
    assert.equal(el.style.display, 'none')
  }
})


/*
 * Designer-template mode. Once the Hire template publishes a real
 * `wf-xano-element="template"` card inside the authored list, wf-xano binds
 * that card and this module must stop rendering its own. Until then the legacy
 * renderer stays in charge, which is what every test above still covers.
 */
function designerTemplateFixture() {
  const fixture = documentFixture()
  const template = new Element({ 'wf-xano-element': 'template' })
  fixture.list.children['[wf-xano-element="template"]'] = template
  fixture.root.children['[wf-xano-element="template"]'] = template
  fixture.list.appendChild(template)
  return { fixture, template }
}

test('preserves a Designer template and drops only the placeholder cards', () => {
  const { fixture, template } = designerTemplateFixture()
  fixture.list.appendChild(new Element())
  fixture.list.appendChild(new Element())
  load({ document: fixture, pathname: '/hire/elvis-p' })
  assert.deepEqual(fixture.list.childNodes, [template])
  assert.equal(fixture.root.getAttribute('wf-xano-param-starter_slug'), 'elvis-p')
  assert.equal(fixture.list.getAttribute('wf-xano-element'), 'list')
})

test('does not append a fallback template when Designer ships one', () => {
  const { fixture } = designerTemplateFixture()
  load({ document: fixture, pathname: '/hire/elvis-p' })
  assert.equal(fixture.root.childNodes.length, 0)
})

test('stops rendering cards once the Designer template is present', () => {
  const { fixture, template } = designerTemplateFixture()
  const { api } = load({ document: fixture, pathname: '/hire/elvis-p' })
  const raw = {
    reviews: [{ review_id: 41, rating: 4 }, { review_id: 42, rating: 5 }],
    aggregate: { review_count: 2, average_rating: 4.5 },
  }
  assert.equal(api.paintProfile(fixture, fixture.root, { raw, items: [raw] }), true)
  // wf-xano owns the cards: the list still holds only the template.
  assert.deepEqual(fixture.list.childNodes, [template])
  // The aggregate projection and the reveal are still this module's job.
  assert.equal(fixture.average.textContent, '4.5')
  assert.equal(fixture.count.textContent, '2')
  assert.equal(fixture.summaryBlockEl.hidden, false)
  assert.equal(fixture.root.hidden, false)
})

test('still renders its own cards while no Designer template exists', () => {
  const fixture = documentFixture()
  const { api } = load({ document: fixture, pathname: '/hire/elvis-p' })
  const raw = {
    reviews: [{ review_id: 41, rating: 4 }],
    aggregate: { review_count: 1, average_rating: 4 },
  }
  assert.equal(api.paintProfile(fixture, fixture.root, { raw, items: [raw] }), true)
  assert.equal(fixture.list.childNodes.length, 1)
  assert.equal(fixture.list.childNodes[0].getAttribute('data-review-id'), '41')
})
