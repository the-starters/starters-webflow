/**
 * Guards for the footer -> GitHub port of the /hire profile renderer.
 *
 * These cover the ways THIS MIGRATION could regress rather than the renderer's
 * whole behaviour. Inline in the page, a throw cost only its own <script>; in
 * one file an uncaught throw at top level takes every section with it, so the
 * stand-down paths are load-bearing now in a way they were not before.
 *
 * The DOM here is a hand-rolled mock in the style of the other tests in this
 * repo. It supports the attribute, class and descendant selectors this file
 * actually uses, which is enough to drive the real code paths end to end.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./hire-profile.js'), 'utf8')

/* ------------------------------------------------------------------ DOM --- */

/** Parses the selector subset used by hire-profile.js into a predicate. */
function compile(selector) {
  const parts = selector.trim().split(/\s+/)
  const last = parts[parts.length - 1]
  const tests = []
  let rest = last

  const not = rest.match(/:not\(\.([\w-]+)\)/)
  if (not) {
    tests.push((el) => !el.classList.contains(not[1]))
    rest = rest.replace(not[0], '')
  }
  for (const m of rest.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/g)) {
    const name = m[1]
    const want = m[2] !== undefined ? m[2] : m[3]
    tests.push((el) =>
      want === undefined ? el.getAttribute(name) !== null : el.getAttribute(name) === want,
    )
  }
  rest = rest.replace(/\[[^\]]*\]/g, '')
  for (const m of rest.matchAll(/\.([\w-]+)/g)) {
    const cls = m[1]
    tests.push((el) => el.classList.contains(cls))
  }
  const id = rest.match(/#([\w-]+)/)
  if (id) tests.push((el) => el.getAttribute('id') === id[1])
  rest = rest.replace(/[#.][\w-]+/g, '')
  if (rest) tests.push((el) => el.tag === rest)

  return (el) => tests.every((t) => t(el))
}

function makeElement(tag = 'div', attrs = {}, classes = []) {
  const el = {
    tag,
    attributes: { ...attrs },
    classes: [...classes],
    children: [],
    parentElement: null,
    style: {},
    textContent: '',
    dataset: {},
    listeners: {},
  }
  el.classList = {
    contains: (c) => el.classes.includes(c),
    remove: (c) => {
      el.classes = el.classes.filter((x) => x !== c)
    },
    add: (c) => el.classes.push(c),
  }
  el.getAttribute = (n) =>
    Object.prototype.hasOwnProperty.call(el.attributes, n) ? el.attributes[n] : null
  el.setAttribute = (n, v) => {
    el.attributes[n] = String(v)
  }
  el.removeAttribute = (n) => {
    delete el.attributes[n]
  }
  el.hasAttribute = (n) => el.getAttribute(n) !== null
  el.matches = (s) => compile(s)(el)
  el.appendChild = (child) => {
    child.parentElement = el
    el.children.push(child)
    return child
  }
  el.prepend = (child) => {
    child.parentElement = el
    el.children.unshift(child)
    return child
  }
  el.remove = () => {
    if (!el.parentElement) return
    el.parentElement.children = el.parentElement.children.filter((c) => c !== el)
    el.parentElement = null
  }
  el.insertAdjacentElement = (_pos, node) => el.parentElement && el.parentElement.appendChild(node)
  el.addEventListener = (type, fn) => {
    ;(el.listeners[type] = el.listeners[type] || []).push(fn)
  }
  el.closest = (s) => {
    const match = compile(s)
    let node = el
    while (node) {
      if (match(node)) return node
      node = node.parentElement
    }
    return null
  }
  const walk = (node, out = []) => {
    for (const c of node.children) {
      out.push(c)
      walk(c, out)
    }
    return out
  }
  el.descendants = () => walk(el)
  el.querySelectorAll = (s) => walk(el).filter(compile(s))
  el.querySelector = (s) => el.querySelectorAll(s)[0] || null
  el.cloneNode = () => {
    const copy = makeElement(el.tag, el.attributes, el.classes)
    copy.textContent = el.textContent
    for (const child of el.children) copy.appendChild(child.cloneNode())
    return copy
  }
  return el
}

/** A hire page with the elements the renderer looks for. */
function makePage({
  index = 'Freelancers3.0-production',
  includeFreeCard = true,
  includeNativeFreeTemplate = false,
} = {}) {
  const root = makeElement('body')

  // The element algolia-environment.js rewrites per environment.
  root.appendChild(
    makeElement('div', { 'data-starters-v3-algolia-resource': 'starters', 'wf-algolia-index': index }),
  )

  const nativeBinding = makeElement('div', {}, ['data-native-binding'])
  const starterXanoId = makeElement('div', { 'data-starter-xano-id': '' })
  nativeBinding.appendChild(starterXanoId)
  root.appendChild(nativeBinding)

  // Webflow CMS owns these rows after the Phase 2 cutover. The runtime must
  // leave the server-rendered content in place for anonymous visitors.
  const experience = makeElement('article', { 'data-native-experience': '' })
  experience.textContent = 'Acme Corp — Product Designer — 2022 to Present'
  root.appendChild(experience)

  const client = makeElement('a', {
    'data-native-client': '',
    href: '/companies/globex',
  })
  client.textContent = 'Globex'
  root.appendChild(client)

  // Services section with the Default card the rate cards are cloned from.
  const services = makeElement('div', { id: 'services' })
  const list = makeElement('div', {}, ['services-list_wrapper'])
  const cardAttributes = {
    'data-service-card': 'component',
    'data-service-card-state': 'Default',
    'has-connection': includeFreeCard ? 'free' : 'paid',
    'data-modal-trigger': 'popup-booking',
    'booking-popup-open': '',
    'data-type': includeFreeCard ? 'free' : 'paid',
    'data-signup-trigger-element': 'service',
    'data-signup-trigger-value': includeFreeCard ? 'Free Call' : 'Paid Consulting Call',
  }
  if (!includeFreeCard) delete cardAttributes['booking-popup-open']

  const card = makeElement(
    'div',
    cardAttributes,
    ['service-card_component'],
  )
  const cardTitle = makeElement('div', { 'data-service-card-element': 'title' })
  cardTitle.textContent = includeFreeCard ? 'Free Call' : 'Paid Consulting Call'
  card.appendChild(cardTitle)
  const bookingContent = makeElement('div', {}, ['service-card_content-wrapper'])
  bookingContent.appendChild(makeElement('div', { 'next-available-slot': '' }))
  card.appendChild(bookingContent)
  card.appendChild(makeElement('div', { 'data-millify': '', 'data-millify-raw': '0' }))
  list.appendChild(card)

  let nativeFreeTemplate = null
  if (includeNativeFreeTemplate) {
    nativeFreeTemplate = card.cloneNode(true)
    nativeFreeTemplate.setAttribute('data-runtime-call-template', 'free')
    nativeFreeTemplate.setAttribute('hidden', 'hidden')
    nativeFreeTemplate.setAttribute('aria-hidden', 'true')
    nativeFreeTemplate.setAttribute('has-connection', 'free')
    nativeFreeTemplate.setAttribute('booking-popup-open', '')
    nativeFreeTemplate.setAttribute('data-type', 'free')
    nativeFreeTemplate.setAttribute('data-signup-trigger-value', 'Free Call')
    nativeFreeTemplate.querySelector('[data-service-card-element="title"]').textContent = 'Free Call'
    list.appendChild(nativeFreeTemplate)
  }
  services.appendChild(list)

  const inlineWrapper = makeElement('div', { 'data-availability-element': 'wrapper' })
  inlineWrapper.style.display = 'flex'
  const back = makeElement('button', { 'data-availability-element': 'back' })
  const calendarLive = makeElement('div', { 'data-availability-element': 'calendar-live' })
  inlineWrapper.appendChild(back)
  inlineWrapper.appendChild(calendarLive)
  services.appendChild(inlineWrapper)
  root.appendChild(services)

  const popupNylasContainer = makeElement('div', { 'nylas-container': '' })
  root.appendChild(popupNylasContainer)

  const freeModalOption = makeElement('div', { 'call-type-item': '' })
  const freeModalCta = makeElement('button', {
    'booking-popup-open': '',
    'data-type': 'free',
  })
  freeModalOption.appendChild(freeModalCta)
  root.appendChild(freeModalOption)

  const paidModalOption = makeElement('div', { 'call-type-item': '' })
  const paidModalCta = makeElement('button', {
    'booking-popup-open': '',
    'data-type': 'paid',
  })
  paidModalOption.appendChild(paidModalCta)
  root.appendChild(paidModalOption)

  return {
    root,
    servicesList: list,
    starterXanoId,
    experience,
    client,
    inlineWrapper,
    nativeFreeTemplate,
    back,
    calendarLive,
    popupNylasContainer,
    freeModalOption,
    freeModalCta,
    paidModalOption,
    paidModalCta,
  }
}

function makeContext({
  page,
  record,
  starterId = 383,
  member = {},
  getStarterByMemberId = () => Promise.resolve(null),
  getConfigs,
  getNearestSlot,
  initBookingComponents,
  createScheduler,
  paidController,
  location = { hostname: 'www.thestarters.com', pathname: '/hire/ashna-rana' },
  schedulingBridge = false,
} = {}) {
  const warnings = []
  const requestedIndexes = []
  const emptyNavRefreshCalls = []
  const requestedObjectIds = []
  const requestedUrls = []
  const root = page ? page.root : makeElement('body')
  const head = makeElement('head')

  if (page) page.starterXanoId.textContent = String(starterId)

  const documentObject = {
    documentElement: makeElement('html'),
    head,
    body: root,
    addEventListener: (type, fn) => {
      if (type === 'DOMContentLoaded') fn()
    },
    getElementById: (id) => head.querySelector('#' + id) || root.querySelector('#' + id),
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    createElement: (tag) => makeElement(tag),
  }

  const context = {
    console: {
      warn: (...a) => warnings.push(a.map((x) => (x && x.message) || String(x)).join(' ')),
      error() {},
      log() {},
    },
    document: documentObject,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Map,
    Set,
    JSON,
    Number,
    Array,
    Object,
    String,
    parseFloat,
    isNaN,
    getComputedStyle: () => ({ display: 'block', cursor: 'auto' }),
    innerWidth: 1280,
    IntersectionObserver: function () {
      return { observe() {} }
    },
    MutationObserver: function () {
      return { observe() {} }
    },
    qs: (s, scope) => (scope || documentObject).querySelector(s),
    qsa: (s, scope) => (scope || documentObject).querySelectorAll(s),
    MEMBER: member,
    memberReady: Promise.resolve(member),
    waitForMember: (cb) => Promise.resolve().then(() => cb(member)),
    getStarterByMemberId,
    getConfigs,
    getNearestSlot,
    initBookingComponents,
    createScheduler,
    StartersPaidCallBrandPayment: paidController,
    formatWithTimezone: () => ({ list: {} }),
    starter_memberstack_id: 'mem_canary',
    stripe_charges: false,
    location,
    fetch: (url) => {
      requestedUrls.push(String(url))
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    },
    __startersEmptyNavRefresh: () => {
      emptyNavRefreshCalls.push(Date.now())
    },
    WfAlgolia: {
      getObject: (indexName, objectId) => {
        requestedIndexes.push(indexName)
        requestedObjectIds.push(objectId)
        return Promise.resolve(record || null)
      },
    },
  }
  context.window = context
  if (schedulingBridge) {
    context.StarterSchedulingV3Stage = {}
    documentObject.documentElement.setAttribute('data-scheduling-v3-stage', 'ready')
  }
  context.warnings = warnings
  context.requestedIndexes = requestedIndexes
  context.emptyNavRefreshCalls = emptyNavRefreshCalls
  context.requestedObjectIds = requestedObjectIds
  context.requestedUrls = requestedUrls
  return context
}

/** Lets the file's promise chains settle. */
async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 10))
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

/* ---------------------------------------------------------------- tests --- */

test('a page missing the Memberstack helpers stands down instead of throwing', () => {
  const page = makePage()
  const context = makeContext({ page })
  delete context.qs
  delete context.qsa
  delete context.waitForMember
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  assert.ok(
    context.warnings.some((l) => l.includes('[hire-profile]') && l.includes('stood down')),
    'expected a stand-down warning, got: ' + JSON.stringify(context.warnings),
  )
  assert.equal(page.freeModalOption.style.display, 'none')
  assert.equal(page.paidModalOption.style.display, 'none')
  assert.equal(page.freeModalCta.getAttribute('data-config'), null)
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.equal(page.servicesList.children[0].style.display, undefined)
})

test('a page missing starter_memberstack_id stands down instead of throwing', () => {
  const page = makePage()
  const context = makeContext({ page })
  delete context.starter_memberstack_id
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  assert.ok(
    context.warnings.some((l) => l.includes('starter_memberstack_id')),
    'expected a warning naming the missing global, got: ' + JSON.stringify(context.warnings),
  )
  assert.equal(page.freeModalOption.style.display, 'none')
  assert.equal(page.paidModalOption.style.display, 'none')
  assert.equal(page.freeModalCta.getAttribute('data-config'), null)
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.equal(page.servicesList.children[0].style.display, undefined)
})

test('the jQuery-only blocks are skipped, not fatal, when jQuery is absent', () => {
  const context = makeContext({ page: makePage() })
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  assert.equal(
    context.warnings.filter((l) => l.includes('jQuery missing')).length,
    2,
    'both jQuery blocks should report themselves skipped',
  )
})

test('a bare hash link does not enter the jQuery selector engine', () => {
  const page = makePage()
  const bareHash = makeElement('a', { href: '#' })
  page.root.appendChild(bareHash)
  const context = makeContext({ page })

  const emptyChain = {
    length: 0,
    each() { return this },
    find() { return this },
    on() { return this },
    off() { return this },
  }
  context.$ = function (value) {
    if (value === context.document) {
      return { ready(fn) { fn(); return this } }
    }
    if (value === 'a[href^="#"]') {
      return {
        on(type, fn) {
          bareHash.addEventListener(type, fn)
          return this
        },
      }
    }
    if (value === bareHash) {
      return { attr: (name) => bareHash.getAttribute(name) }
    }
    if (value === '#') throw new Error('Syntax error, unrecognized expression: #')
    return emptyChain
  }

  vm.createContext(context)
  vm.runInContext(source, context)

  let prevented = false
  assert.doesNotThrow(() => {
    bareHash.listeners.click[0].call(bareHash, { preventDefault() { prevented = true } })
  })
  assert.equal(prevented, false, 'a placeholder hash link must retain its default no-op behavior')
})

test('the file keeps its symbols out of the page global scope', async () => {
  // The footer blocks were separate <script>s. Merging them into one file must
  // not start publishing their internals to the page, where they could collide
  // with another embed.
  const context = makeContext({ page: makePage(), record: { rate: 100 } })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  for (const leaked of [
    'FREELANCER_ID',
    'startersBooking_handler',
    'renderRateCards',
    'markServiceCardsClickable',
    'resolveStartersIndex',
    'formatShort',
  ]) {
    assert.equal(context[leaked], undefined, `${leaked} must not leak onto window`)
  }
})

test('it queries the Algolia index the page declares, not a hardcoded one', async () => {
  // Regression: a hardcoded Freelancers3.0-dev silently 403'd under the rotated
  // search key after the index migration and emptied Services for every viewer.
  const context = makeContext({
    page: makePage({ index: 'Freelancers3.0-production' }),
    record: { rate: 5000 },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.ok(context.requestedIndexes.length > 0, 'expected the search record to be requested')
  for (const name of context.requestedIndexes) {
    assert.equal(name, 'Freelancers3.0-production')
  }
  assert.deepEqual([...new Set(context.requestedObjectIds)], ['383'])
})

test('native CMS profile rows remain visible while services use the CMS-bound Xano id', async () => {
  const page = makePage()
  const context = makeContext({
    page,
    starterId: 517,
    record: { rate: 225, 'retainer-rate': 1800, 'retainer-enabled': true },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.root.querySelector('[data-native-experience]'), page.experience)
  assert.equal(
    page.experience.textContent,
    'Acme Corp — Product Designer — 2022 to Present',
  )
  assert.equal(page.root.querySelector('[data-native-client]'), page.client)
  assert.equal(page.client.textContent, 'Globex')
  assert.equal(page.client.getAttribute('href'), '/companies/globex')
  assert.deepEqual(context.requestedUrls, [], 'native profile data must not trigger Xano fetches')
  assert.deepEqual([...new Set(context.requestedObjectIds)], ['517'])
  assert.deepEqual(
    page.servicesList.children
      .filter((child) => child.getAttribute('data-rate-card'))
      .map((child) => child.getAttribute('data-rate-card')),
    ['freelance', 'retainer'],
  )
})

test('it follows the page when the environment resolves a different index', async () => {
  const context = makeContext({
    page: makePage({ index: 'Freelancers3.0-staging-test' }),
    record: { rate: 135 },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.deepEqual([...new Set(context.requestedIndexes)], ['Freelancers3.0-staging-test'])
})

test('a page missing the Algolia index stands down before requesting a record', async () => {
  const page = makePage()
  page.root.querySelector('[wf-algolia-index]').remove()
  const context = makeContext({ page, record: { rate: 5000 } })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.deepEqual(context.requestedIndexes, [])
  assert.ok(
    context.warnings.some(
      (line) => line.includes('Anonymous services:') && line.includes('search index'),
    ),
    'expected a missing-index warning, got: ' + JSON.stringify(context.warnings),
  )
})

test('a cloned rate card keeps signup attribution and drops the booking wiring', async () => {
  // Logged-out clicks reach the signup modal only through data-signup-trigger-*,
  // handled by v3/signup-attribution.js. Leaving the booking attributes on a
  // card that cannot be booked opens an unconfigured popup for members.
  const page = makePage()
  const context = makeContext({
    page,
    record: { rate: 5000, 'retainer-rate': '4500', 'retainer-enabled': true },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const cloned = page.servicesList.children.filter((c) => c.getAttribute('data-rate-card'))
  assert.deepEqual(
    cloned.map((c) => c.getAttribute('data-rate-card')),
    ['freelance', 'retainer'],
    'both rate cards should be prepended, cheapest-first order preserved',
  )

  for (const card of cloned) {
    const title = card.getAttribute('data-rate-card') === 'freelance' ? 'Freelance' : 'Retainer'
    assert.equal(card.getAttribute('data-signup-trigger-element'), 'service')
    assert.equal(card.getAttribute('data-signup-trigger-value'), title)
    for (const dropped of [
      'data-modal-trigger',
      'booking-popup-open',
      'data-type',
      'has-connection',
      'no-connection',
    ]) {
      assert.equal(card.getAttribute(dropped), null, `${dropped} must be stripped`)
    }
    assert.equal(
      card.querySelector('.service-card_content-wrapper'),
      null,
      'the booking "Next Available" row must not survive on a rate card',
    )
  }

  const price = cloned[0].querySelector('[data-millify]')
  assert.equal(price.getAttribute('data-millify'), '5000')
  assert.equal(price.getAttribute('data-millify-raw'), null, 'stale raw value must be cleared')
})

test('a retainer that is disabled or zero produces no retainer card', async () => {
  const page = makePage()
  const context = makeContext({
    page,
    record: { rate: 135, 'retainer-rate': '5500', 'retainer-enabled': false },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.deepEqual(
    page.servicesList.children
      .filter((c) => c.getAttribute('data-rate-card'))
      .map((c) => c.getAttribute('data-rate-card')),
    ['freelance'],
  )
})

test('it asks hide-empty-sections to re-evaluate after revealing service cards', async () => {
  // hide-empty-sections.js observes { childList, subtree } only. Revealing a
  // call card is an inline-style change, which that observer cannot see, so
  // #services and its TOC link stay hidden even though cards are visible.
  // Reproduced on production 2026-08-16 (/hire/advika-aggarwal, logged out).
  const context = makeContext({
    page: makePage(),
    record: { rate: 125, 'retainer-rate': '2500', 'retainer-enabled': true,
      'free-consulting-calls-t-f': true, 'paid-consulting-calls-t-f': true },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.ok(
    context.emptyNavRefreshCalls.length > 0,
    'expected __startersEmptyNavRefresh to be invoked after the cards were revealed',
  )
})

test('a signed-in Starter refreshes empty navigation after owner cards are revealed', async () => {
  const page = makePage()
  let resolveStarter
  const starterReady = new Promise((resolve) => {
    resolveStarter = resolve
  })
  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-rate': 0, 'retainer-enabled': false },
    member: {
      id: 'owner_member',
      auth: { email: 'owner@example.com' },
      customFields: { 'free-user': 'Owner', 'last-name': 'Member' },
    },
    getStarterByMemberId: () => starterReady,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(context.emptyNavRefreshCalls.length, 1)
  resolveStarter({ nylas_grant_id: 'grant_owner' })
  await settle()

  assert.equal(page.servicesList.children.length, 1, 'zero rates must not add a childList mutation')
  assert.equal(page.servicesList.children[0].style.display, 'block')
  assert.equal(
    context.emptyNavRefreshCalls.length,
    2,
    'owner card visibility must trigger a refresh after the delayed lookup completes',
  )
})

test('the runtime free card fails closed without a free config or exact route', async () => {
  for (const scenario of [
    {
      name: 'no free config',
      configs: [{ config_id: 'config_paid', is_paid: true }],
      location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    },
    {
      name: 'unknown payment identity',
      configs: [{ config_id: 'config_unknown' }],
      location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    },
    {
      name: 'inactive free config',
      configs: [{ config_id: 'config_inactive', is_paid: false, active: false }],
      location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    },
    {
      name: 'unknown route',
      configs: [{ config_id: 'config_test_free', is_paid: false }],
      location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/someone-else' },
    },
  ]) {
    const page = makePage({
      index: 'Freelancers3.0-staging-test',
      includeFreeCard: false,
      includeNativeFreeTemplate: true,
    })
    const context = makeContext({
      page,
      member: {
        id: 'brand_test_member',
        auth: { email: 'brand-test@example.com' },
        customFields: { 'free-user': 'Brand', 'last-name': 'Test' },
        planConnections: [
          { planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' },
        ],
      },
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_test' }),
      getConfigs: async () => scenario.configs,
      getNearestSlot: async () => null,
      initBookingComponents: () => {},
      createScheduler: () => {
        throw new Error('must not initialize')
      },
      location: scenario.location,
      schedulingBridge: true,
    })
    vm.createContext(context)
    vm.runInContext(source, context)
    await settle()

    assert.equal(
      page.servicesList.children.filter((card) =>
        card.hasAttribute('data-runtime-free-call-card'),
      ).length,
      0,
      scenario.name,
    )
    assert.equal(page.inlineWrapper.style.display, 'none', scenario.name)
    assert.equal(page.servicesList.children[0].getAttribute('data-type'), 'paid', scenario.name)
  }
})

test('an empty canonical configuration response fails closed without booking activation', async () => {
  const page = makePage({
    index: 'Freelancers3.0-staging-test',
    includeFreeCard: false,
    includeNativeFreeTemplate: true,
  })
  let bookingComponentCalls = 0
  let schedulerCalls = 0
  const context = makeContext({
    page,
    member: {
      id: 'brand_test_member',
      auth: { email: 'brand-test@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Test' },
      planConnections: [
        { planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' },
      ],
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_test' }),
    getConfigs: async () => [],
    getNearestSlot: async () => {
      throw new Error('must not read availability without a configuration')
    },
    initBookingComponents: () => {
      bookingComponentCalls += 1
    },
    createScheduler: () => {
      schedulerCalls += 1
    },
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(bookingComponentCalls, 0)
  assert.equal(schedulerCalls, 0)
  assert.equal(page.inlineWrapper.style.display, 'none')
  assert.equal(
    page.servicesList.children.filter((card) =>
      card.hasAttribute('data-runtime-free-call-card'),
    ).length,
    0,
  )
  assert.ok(context.warnings.some((line) => line.includes('No Configurations found')))
})

test('invalid, inactive, and cross-role plan records fail closed with a legacy Brand field', async () => {
  for (const planConnections of [
    null,
    {},
    'pln_free-plan-f6kn0dxz',
    [],
    [{ planId: 'pln_new-paid-plan-463h04ph', status: 'CANCELED' }],
    [
      { planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' },
      { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', status: 'ACTIVE' },
    ],
  ]) {
    const page = makePage()
    let configReads = 0
    let schedulerCalls = 0
    const context = makeContext({
      page,
      member: {
        id: 'ineligible_member',
        auth: { email: 'ineligible@example.com' },
        customFields: {
          'brands-dashboard-url': '/brand-dashboard',
          'free-user': 'Ineligible',
          'last-name': 'Member',
        },
        planConnections,
      },
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_canary' }),
      getConfigs: async () => {
        configReads += 1
        return [{ config_id: 'config_free', is_paid: false }]
      },
      createScheduler: () => {
        schedulerCalls += 1
      },
      location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-testiz-d' },
      schedulingBridge: true,
    })
    vm.createContext(context)
    vm.runInContext(source, context)
    await settle()

    assert.equal(configReads, 0, 'ineligible plan state must not read booking configurations')
    assert.equal(schedulerCalls, 0, 'ineligible plan state must not initialize the scheduler')
    assert.equal(page.inlineWrapper.style.display, 'none')
    assert.equal(page.servicesList.children[0].getAttribute('data-modal-trigger'), 'popup-booking')
  }
})

test('logged-out free-call clicks keep signup attribution and never initialize inline booking', async () => {
  const page = makePage()
  let schedulerCalls = 0
  const context = makeContext({
    page,
    record: { 'free-consulting-calls-t-f': true },
    createScheduler: () => {
      schedulerCalls += 1
    },
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-testiz-d' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeCard = page.servicesList.children[0]
  assert.equal(freeCard.getAttribute('data-signup-trigger-element'), 'service')
  assert.equal(freeCard.getAttribute('data-signup-trigger-value'), 'Free Call')
  assert.equal(freeCard.getAttribute('data-modal-trigger'), 'popup-booking')
  assert.equal(freeCard.onclick, undefined)
  assert.equal(page.inlineWrapper.style.display, 'none')
  assert.equal(page.inlineWrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(schedulerCalls, 0)
})

test('signed-in Brand keeps Free Call in the existing modal and the inline panel stays parked', async () => {
  const page = makePage()
  const bookingCalls = []
  let schedulerCalls = 0
  const configs = [{
    config_id: 'config_free',
    is_paid: false,
    active: true,
    data_environment: 'production',
    payment_environment: null,
  }]
  const context = makeContext({
    page,
    record: { 'free-consulting-calls-t-f': true },
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
    getConfigs: async () => configs,
    getNearestSlot: async () => null,
    initBookingComponents: (...args) => {
      bookingCalls.push(args)
      // Reproduce the shared initializer's later readiness callbacks trying to
      // reopen both authored options after the page controller has discovered
      // that only Free is available.
      page.freeModalOption.style.display = 'block'
      page.paidModalOption.style.display = 'block'
    },
    createScheduler: () => { schedulerCalls += 1 },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeCard = page.servicesList.children[0]
  assert.equal(bookingCalls.length, 1)
  assert.deepEqual(
    bookingCalls[0][2].map((record) => record.config_id),
    ['config_free'],
  )
  assert.equal(freeCard.getAttribute('data-modal-trigger'), 'popup-booking')
  assert.equal(freeCard.getAttribute('data-type'), 'free')
  assert.equal(schedulerCalls, 0, 'the calendar waits for a modal option click')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'config_free')
  assert.equal(page.freeModalOption.getAttribute('data-booking-unavailable'), null)
  assert.equal(page.freeModalOption.getAttribute('aria-hidden'), null)
  assert.equal(page.freeModalOption.style.display, 'block', 'shared modal init owns Free visibility')
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.equal(page.paidModalOption.style.display, 'none', 'controller re-closes unavailable Paid')
  assert.equal(page.paidModalOption.getAttribute('data-booking-unavailable'), '')
  assert.equal(page.paidModalOption.getAttribute('aria-hidden'), 'true')
  const guard = context.document.getElementById('hire-booking-modal-availability-guard')
  assert.ok(guard)
  assert.equal(guard.textContent, '[data-booking-unavailable]{display:none!important}')
  assert.equal(page.inlineWrapper.style.display, 'none')
  assert.equal(page.inlineWrapper.getAttribute('aria-hidden'), 'true')
})

test('authored modal options hide synchronously without hiding Services call cards', async () => {
  const page = makePage()
  let resolveStarter
  const starterReady = new Promise((resolve) => {
    resolveStarter = resolve
  })
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    getStarterByMemberId: () => starterReady,
    getConfigs: async () => [],
  })
  vm.createContext(context)
  vm.runInContext(source, context)

  assert.equal(page.freeModalOption.style.display, 'none')
  assert.equal(page.paidModalOption.style.display, 'none')
  assert.equal(page.freeModalOption.getAttribute('data-booking-unavailable'), '')
  assert.equal(page.paidModalOption.getAttribute('data-booking-unavailable'), '')
  assert.equal(page.freeModalOption.getAttribute('aria-hidden'), 'true')
  assert.equal(page.paidModalOption.getAttribute('aria-hidden'), 'true')
  assert.equal(page.freeModalCta.getAttribute('data-config'), null)
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.equal(page.servicesList.children[0].style.display, undefined)

  resolveStarter(null)
  await settle()
})

test('booking discovery rejects inactive, mixed-environment, and duplicate configurations', async () => {
  const scenarios = [
    [{ config_id: 'inactive_free', is_paid: false, active: false, data_environment: 'production' }],
    [{ config_id: 'inactive_paid', is_paid: true, active: false, data_environment: 'production', payment_environment: 'live' }],
    [{ config_id: 'mixed_data', is_paid: false, active: true, data_environment: 'test' }],
    [{ config_id: 'mixed_payment', is_paid: true, active: true, data_environment: 'production', payment_environment: 'test' }],
    [{ config_id: 'unknown_payment', is_paid: null, active: true, data_environment: 'production' }],
    [
      { config_id: 'free_a', is_paid: false, active: true, data_environment: 'production' },
      { config_id: 'free_b', is_paid: false, active: true, data_environment: 'production' },
    ],
    [
      { config_id: 'paid_a', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live' },
      { config_id: 'paid_b', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live' },
    ],
    [
      { config_id: 'shared', is_paid: false, active: true, data_environment: 'production' },
      { config_id: 'shared', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live' },
    ],
  ]

  for (const configs of scenarios) {
    const page = makePage()
    let bookingComponentCalls = 0
    let nearestSlotCalls = 0
    const context = makeContext({
      page,
      member: {
        id: 'brand_member',
        auth: { email: 'brand@example.com' },
        customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
        planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
      },
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
      getConfigs: async () => configs,
      getNearestSlot: async () => { nearestSlotCalls += 1 },
      initBookingComponents: () => { bookingComponentCalls += 1 },
    })
    vm.createContext(context)
    vm.runInContext(source, context)
    await settle()

    assert.equal(bookingComponentCalls, 0)
    assert.equal(nearestSlotCalls, 0)
    assert.equal(page.freeModalCta.getAttribute('data-config'), null)
    assert.equal(page.paidModalCta.getAttribute('data-config'), null)
    assert.equal(page.freeModalOption.style.display, 'none')
    assert.equal(page.paidModalOption.style.display, 'none')
    assert.ok(context.warnings.some((line) => line.includes('No Configurations found')))
  }
})

test('booking discovery keeps Free on the shared modal and gives Paid to the V3 controller', async () => {
  const page = makePage()
  const bookingCalls = []
  const paidCalls = []
  const configs = [
    { config_id: 'paid_live', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live' },
    { config_id: 'free_live', is_paid: false, active: true, data_environment: 'production', payment_environment: null },
  ]
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
    getConfigs: async () => configs,
    getNearestSlot: async () => null,
    initBookingComponents: (...args) => bookingCalls.push(args),
    paidController: {
      installPaidBookingController: (options) => {
        paidCalls.push(options)
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(bookingCalls.length, 1)
  assert.deepEqual(
    bookingCalls[0][2].map((record) => record.config_id),
    ['free_live'],
  )
  assert.equal(paidCalls.length, 1)
  assert.equal(paidCalls[0].config.config_id, 'paid_live')
  assert.equal(paidCalls[0].starterSlug, 'ashna-rana')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'free_live')
  assert.equal(page.paidModalCta.getAttribute('data-config'), 'paid_live')
  assert.equal(page.freeModalOption.getAttribute('data-booking-unavailable'), null)
  assert.equal(page.paidModalOption.getAttribute('data-booking-unavailable'), null)
  assert.equal(page.freeModalOption.getAttribute('aria-hidden'), null)
  assert.equal(page.paidModalOption.getAttribute('aria-hidden'), null)
  assert.equal(page.freeModalOption.style.display, 'block')
  assert.equal(page.paidModalOption.style.display, 'none')
})

test('signed-in Brand routes non-call services to Start a Project with a valid native service preset', async () => {
  const page = makePage()
  const cmsCard = makeElement('div', {
    'data-service-card': 'component',
    'data-service-card-state': 'Default',
    'data-signup-trigger-element': 'service',
    'data-signup-trigger-value': 'asdf',
  })
  const cmsTitle = makeElement('div', { 'data-service-card-element': 'title' })
  cmsTitle.textContent = 'asdf'
  cmsCard.appendChild(cmsTitle)
  page.servicesList.appendChild(cmsCard)

  const serviceSelect = makeElement('select', { name: 'Services' })
  serviceSelect.options = [
    { value: '', textContent: 'Select one...' },
    { value: 'Freelance work', textContent: 'Freelance work' },
    { value: 'asdf', textContent: 'asdf' },
  ]
  page.root.appendChild(serviceSelect)
  assert.equal(page.root.querySelectorAll('#services [data-service-card="component"]').includes(cmsCard), true)

  const context = makeContext({
    page,
    record: { rate: 100 },
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => null,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freelanceCard = page.servicesList.children.find((card) =>
    card.getAttribute('data-rate-card') === 'freelance')
  assert.ok(freelanceCard)
  for (const [card, service] of [[freelanceCard, 'Freelance work']]) {
    assert.equal(card.getAttribute('data-modal-trigger'), 'generate-contract', service)
    assert.equal(card.getAttribute('data-sp-fill'), 'button')
    assert.equal(card.getAttribute('data-sp-fill-category'), 'service')
    assert.equal(card.getAttribute('data-sp-fill-value'), service)
  }
  const freeCard = page.servicesList.children.find((card) => card.getAttribute('data-type') === 'free')
  assert.equal(
    freeCard.getAttribute('data-modal-trigger'),
    'popup-booking',
    'Free Call must not be converted into a project trigger',
  )
})

test('a page without the hide-empty hook still renders its cards', async () => {
  const page = makePage()
  const context = makeContext({
    page,
    record: { rate: 125, 'retainer-rate': '2500', 'retainer-enabled': true },
  })
  delete context.__startersEmptyNavRefresh
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  await settle()
  assert.deepEqual(
    page.servicesList.children
      .filter((c) => c.getAttribute('data-rate-card'))
      .map((c) => c.getAttribute('data-rate-card')),
    ['freelance', 'retainer'],
    'a missing cosmetic hook must never stop the cards rendering',
  )
})
