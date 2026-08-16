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
function makePage({ index = 'Freelancers3.0-production' } = {}) {
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
  const card = makeElement(
    'div',
    {
      'data-service-card': 'component',
      'data-service-card-state': 'Default',
      'has-connection': 'free',
      'data-modal-trigger': 'popup-booking',
      'booking-popup-open': '',
      'data-type': 'free',
      'data-signup-trigger-element': 'service',
      'data-signup-trigger-value': 'Free Call',
    },
    ['service-card_component'],
  )
  card.appendChild(makeElement('div', { 'data-service-card-element': 'title' }))
  card.appendChild(makeElement('div', {}, ['service-card_content-wrapper']))
  card.appendChild(makeElement('div', { 'data-millify': '', 'data-millify-raw': '0' }))
  list.appendChild(card)
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

  return {
    root,
    servicesList: list,
    starterXanoId,
    experience,
    client,
    inlineWrapper,
    back,
    calendarLive,
    popupNylasContainer,
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
  location = { hostname: 'www.thestarters.com', pathname: '/hire/ashna-rana' },
  schedulingBridge = false,
} = {}) {
  const warnings = []
  const requestedIndexes = []
  const emptyNavRefreshCalls = []
  const requestedObjectIds = []
  const requestedUrls = []
  const root = page ? page.root : makeElement('body')

  if (page) page.starterXanoId.textContent = String(starterId)

  const documentObject = {
    documentElement: makeElement('html'),
    body: root,
    addEventListener: (type, fn) => {
      if (type === 'DOMContentLoaded') fn()
    },
    getElementById: (id) => root.querySelector('#' + id),
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
  const context = makeContext()
  delete context.qs
  delete context.qsa
  delete context.waitForMember
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  assert.ok(
    context.warnings.some((l) => l.includes('[hire-profile]') && l.includes('stood down')),
    'expected a stand-down warning, got: ' + JSON.stringify(context.warnings),
  )
})

test('a page missing starter_memberstack_id stands down instead of throwing', () => {
  const context = makeContext()
  delete context.starter_memberstack_id
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  assert.ok(
    context.warnings.some((l) => l.includes('starter_memberstack_id')),
    'expected a warning naming the missing global, got: ' + JSON.stringify(context.warnings),
  )
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

test('the approved production canary opens free booking inline and uses state-aware back', async () => {
  const page = makePage()
  let scheduler
  let toggledTo = null
  let schedulerBackCalls = 0
  const connector = {
    scheduler: {
      toggleAdditionalData: async (value) => {
        toggledTo = value
      },
    },
  }
  const context = makeContext({
    page,
    member: {
      id: 'brand_prod_test',
      auth: { email: 'brand@example.com' },
      customFields: {
        'brands-dashboard-url': '/brand-dashboard',
        'free-user': 'Brand',
        'last-name': 'Tester',
      },
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_canary' }),
    getConfigs: async () => [{ config_id: 'config_free', is_paid: false }],
    getNearestSlot: async () => null,
    initBookingComponents: () => {},
    createScheduler: (configId) => {
      const container = page.root.querySelector('[nylas-container]')
      assert.equal(container, page.calendarLive, 'the shared scheduler must target calendar-live')
      assert.equal(configId, 'config_free')
      scheduler = makeElement('nylas-scheduling')
      scheduler.eventOverrides = {
        backButtonClicked: async () => {
          schedulerBackCalls += 1
        },
      }
      container.appendChild(scheduler)
      return scheduler
    },
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-test' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const card = page.servicesList.children[0]
  assert.equal(card.getAttribute('data-modal-trigger'), null, 'canary uses inline UI, not popup')
  assert.equal(card.getAttribute('aria-expanded'), 'false')

  card.onclick({ preventDefault() {}, stopPropagation() {} })
  assert.equal(page.inlineWrapper.style.display, 'flex')
  assert.equal(page.inlineWrapper.getAttribute('aria-hidden'), 'false')
  assert.equal(card.getAttribute('aria-expanded'), 'true')
  assert.equal(page.calendarLive.getAttribute('nylas-container'), null)
  assert.equal(page.popupNylasContainer.getAttribute('nylas-container'), '')
  assert.equal(page.back.getAttribute('data-availability-back-mode'), 'close')

  await scheduler.eventOverrides.timeslotConfirmed({ detail: {} }, connector)
  assert.equal(page.back.getAttribute('data-availability-back-mode'), 'previous-step')

  await page.back.listeners.click[0]({ preventDefault() {} })
  assert.equal(toggledTo, false)
  assert.equal(schedulerBackCalls, 1)
  assert.equal(page.inlineWrapper.style.display, 'flex')
  assert.equal(page.back.getAttribute('data-availability-back-mode'), 'close')

  await page.back.listeners.click[0]({ preventDefault() {} })
  assert.equal(page.inlineWrapper.style.display, 'none')
  assert.equal(page.inlineWrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(card.getAttribute('aria-expanded'), 'false')
})

test('Brand Free keeps the V2 free-call booking rule on the approved canary', async () => {
  const page = makePage()
  let schedulerCalls = 0
  const context = makeContext({
    page,
    member: {
      id: 'brand_free_member',
      auth: { email: 'brand-free@example.com' },
      customFields: {
        'brands-dashboard-url': '/quiz-results',
        'free-user': 'Free',
        'last-name': 'Brand',
      },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_canary' }),
    getConfigs: async () => [{ config_id: 'config_free', is_paid: false }],
    getNearestSlot: async () => null,
    initBookingComponents: () => {},
    createScheduler: () => {
      schedulerCalls += 1
      const scheduler = makeElement('nylas-scheduling')
      scheduler.eventOverrides = {}
      page.calendarLive.appendChild(scheduler)
      return scheduler
    },
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-test' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeCard = page.servicesList.children[0]
  freeCard.onclick({ preventDefault() {}, stopPropagation() {} })

  assert.equal(schedulerCalls, 1, 'Brand Free may book the free service without an upgrade gate')
  assert.equal(page.inlineWrapper.style.display, 'flex')
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
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-test' },
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

test('inline back recovers the Nylas connector when the timeslot callback omits it', async () => {
  const page = makePage()
  let scheduler
  let toggledTo = null
  const connector = {
    scheduler: {
      toggleAdditionalData: async (value) => {
        toggledTo = value
      },
    },
  }
  const context = makeContext({
    page,
    member: {
      id: 'brand_prod_test',
      auth: { email: 'brand@example.com' },
      customFields: {
        'brands-dashboard-url': '/brand-dashboard',
        'free-user': 'Brand',
        'last-name': 'Tester',
      },
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_canary' }),
    getConfigs: async () => [{ config_id: 'config_free', is_paid: false }],
    getNearestSlot: async () => null,
    initBookingComponents: () => {},
    createScheduler: () => {
      scheduler = makeElement('nylas-scheduling')
      scheduler.eventOverrides = {}
      scheduler.getNylasSchedulerConnector = async () => connector
      page.calendarLive.appendChild(scheduler)
      return scheduler
    },
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-test' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  page.servicesList.children[0].onclick({ preventDefault() {}, stopPropagation() {} })
  await scheduler.eventOverrides.timeslotConfirmed({ detail: {} })
  await page.back.listeners.click[0]({ preventDefault() {} })

  assert.equal(toggledTo, false)
  assert.equal(page.inlineWrapper.style.display, 'flex')
  assert.equal(page.back.getAttribute('data-availability-back-mode'), 'close')
})

test('a malformed booking callback does not mark the inline scheduler complete', async () => {
  const page = makePage()
  let scheduler
  const context = makeContext({
    page,
    member: {
      id: 'brand_prod_test',
      auth: { email: 'brand@example.com' },
      customFields: {
        'brands-dashboard-url': '/brand-dashboard',
        'free-user': 'Brand',
        'last-name': 'Tester',
      },
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_canary' }),
    getConfigs: async () => [{ config_id: 'config_free', is_paid: false }],
    getNearestSlot: async () => null,
    initBookingComponents: () => {},
    createScheduler: () => {
      scheduler = makeElement('nylas-scheduling')
      scheduler.eventOverrides = {}
      page.calendarLive.appendChild(scheduler)
      return scheduler
    },
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-test' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const card = page.servicesList.children[0]
  card.onclick({ preventDefault() {}, stopPropagation() {} })
  await scheduler.eventOverrides.timeslotConfirmed({ detail: {} })
  await scheduler.eventOverrides.bookedEventInfo({ detail: {} })
  assert.equal(page.back.getAttribute('data-availability-back-mode'), 'previous-step')

  await page.back.listeners.click[0]({ preventDefault() {} })
  assert.equal(page.inlineWrapper.style.display, 'flex')
})

test('inline booking stays inert when the route environment bridge is missing', async () => {
  const page = makePage()
  const context = makeContext({
    page,
    member: {
      id: 'brand_prod_test',
      auth: { email: 'brand@example.com' },
      customFields: {
        'brands-dashboard-url': '/brand-dashboard',
        'free-user': 'Brand',
        'last-name': 'Tester',
      },
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_canary' }),
    getConfigs: async () => [{ config_id: 'config_free', is_paid: false }],
    getNearestSlot: async () => null,
    initBookingComponents: () => {},
    createScheduler: () => {
      throw new Error('must not initialize')
    },
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-test' },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const card = page.servicesList.children[0]
  assert.equal(card.getAttribute('data-modal-trigger'), 'popup-booking')
  assert.equal(page.inlineWrapper.style.display, 'none')
  assert.ok(context.warnings.some((line) => line.includes('environment bridge is not ready')))
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
