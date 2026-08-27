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
const freeBookingSource = fs.readFileSync(require.resolve('./free-call-booking.js'), 'utf8')

/* ------------------------------------------------------------------ DOM --- */

/** Parses the selector subset used by hire-profile.js into a predicate. */
function compile(selector) {
  const parts = selector.trim().split(/\s+/)
  const matches = parts.map((part) => {
    const tests = []
    let rest = part

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

    return (el) => tests.every((test) => test(el))
  })

  return (el) => {
    let node = el
    if (!matches[matches.length - 1](node)) return false
    for (let index = matches.length - 2; index >= 0; index -= 1) {
      node = node.parentElement
      while (node && !matches[index](node)) node = node.parentElement
      if (!node) return false
    }
    return true
  }
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
  // Reflected like the real property: assigning it replaces the whole class
  // list. renderRateCards builds its chip label <p> this way, so without the
  // reflection the classes never reach classList and `.service-card_price-unit`
  // would silently match nothing.
  Object.defineProperty(el, 'className', {
    get: () => el.classes.join(' '),
    set: (v) => {
      el.classes = String(v).split(/\s+/).filter(Boolean)
    },
    configurable: true,
  })
  el.getAttribute = (n) =>
    Object.prototype.hasOwnProperty.call(el.attributes, n) ? el.attributes[n] : null
  el.setAttribute = (n, v) => {
    el.attributes[n] = String(v)
  }
  el.removeAttribute = (n) => {
    delete el.attributes[n]
  }
  el.hasAttribute = (n) => el.getAttribute(n) !== null
  // Reflected script properties the loader recovery reads.
  Object.defineProperty(el, 'src', {
    get: () => el.getAttribute('src') || '',
    set: (v) => el.setAttribute('src', v),
    configurable: true,
  })
  for (const flag of ['async', 'defer']) {
    let value = el.hasAttribute(flag)
    Object.defineProperty(el, flag, {
      get: () => value,
      set: (next) => {
        value = Boolean(next)
      },
      configurable: true,
    })
  }
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
  // Real semantics: a null reference appends, but a reference that is not a
  // child throws rather than silently appending. That throw is load-bearing --
  // it is what stops a mislocated "from" label from landing at the end of the
  // chip and still reading as a pass.
  el.insertBefore = (child, reference) => {
    if (reference == null) return el.appendChild(child)
    const at = el.children.indexOf(reference)
    if (at < 0) {
      throw new Error('insertBefore: the reference node is not a child of this element')
    }
    child.parentElement = el
    el.children.splice(at, 0, child)
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
  el.querySelectorAll = (s) => {
    const selectors = String(s).split(',').map((part) => part.trim()).filter(Boolean)
    const matches = selectors.map(compile)
    return walk(el).filter((node) => matches.some((match) => match(node)))
  }
  el.querySelector = (s) => el.querySelectorAll(s)[0] || null
  el.cloneNode = () => {
    const copy = makeElement(el.tag, el.attributes, el.classes)
    copy.textContent = el.textContent
    for (const child of el.children) copy.appendChild(child.cloneNode())
    return copy
  }
  return el
}

/**
 * Index of a DIRECT child, refusing anything else.
 *
 * Ordering checks that lean on indexOf silently go vacuous the moment the node
 * is nested one level deeper: indexOf returns -1, and "after the price" becomes
 * trivially true against it. Throwing keeps a fixture that drifts away from
 * production markup loud instead of quietly green.
 */
function childIndexOf(parent, node, label) {
  const at = parent.children.indexOf(node)
  if (at < 0) throw new Error(`childIndexOf: ${label} is not a direct child of the given parent`)
  return at
}

/** A hire page with the elements the renderer looks for. */
function makePage({
  index = 'Freelancers3.0-production',
  includeFreeCard = true,
  includeNativeFreeTemplate = false,
  includeCallDataType = true,
  includeBookingButton = true,
  includeHeroCallCards = false,
  includePriceParagraph = true,
  includeAuthoredChipLabels = true,
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

  let heroFreeCard = null
  let heroPaidCard = null
  if (includeHeroCallCards) {
    heroFreeCard = makeElement('div', {
      'data-service-card': 'component',
      'has-connection': 'free',
      'data-type': 'free',
      'data-modal-trigger': 'popup-booking',
      'booking-popup-open': '',
    }, ['service-tout_component'])
    heroPaidCard = makeElement('div', {
      'data-service-card': 'component',
      'has-connection': 'paid',
      'data-type': 'paid',
      'data-modal-trigger': 'popup-booking',
      'booking-popup-open': '',
    }, ['service-tout_component'])
    root.appendChild(heroFreeCard)
    root.appendChild(heroPaidCard)
  }

  // Services section with the Default card the rate cards are cloned from.
  const services = makeElement('div', { id: 'services' })
  const list = makeElement('div', {}, ['services-list_wrapper'])
  const cardAttributes = {
    'data-service-card': 'component',
    'data-service-card-state': 'Default',
    'has-connection': includeFreeCard ? 'free' : 'paid',
    'data-modal-trigger': 'popup-booking',
    'booking-popup-open': '',
    'data-signup-trigger-element': 'service',
    'data-signup-trigger-value': includeFreeCard ? 'Free Call' : 'Paid Consulting Call',
  }
  if (includeCallDataType) cardAttributes['data-type'] = includeFreeCard ? 'free' : 'paid'
  if (!includeFreeCard) delete cardAttributes['booking-popup-open']

  const card = makeElement(
    'div',
    cardAttributes,
    ['service-card_component'],
  )
  // Production nests the title in its own wrapper. The title renders alone in
  // there: the rate-card unit line goes in the price chip, not beside it.
  const cardTitleWrapper = makeElement('div', {}, ['service-card_title-wrapper'])
  const cardTitle = makeElement('div', { 'data-service-card-element': 'title' })
  cardTitle.textContent = includeFreeCard ? 'Free Call' : 'Paid Consulting Call'
  cardTitleWrapper.appendChild(cardTitle)
  card.appendChild(cardTitleWrapper)
  const bookingContent = makeElement('div', {}, ['service-card_content-wrapper'])
  bookingContent.appendChild(makeElement('div', { 'next-available-slot': '' }))
  card.appendChild(bookingContent)
  // The green price chip, nested exactly as production authors it:
  //   .service-card_price-card
  //     > .service-card_price-card-layout   (centred column flex)
  //       > p.text-size-small.line-height-100  "per"      (authored top label)
  //       > p.text-size-large
  //         > span "$"
  //         > span[data-millify]
  //       > p.text-size-small.line-height-100  "/hr"      (authored bottom label)
  // The millify hook is a GRANDCHILD of the layout, not a direct child, so the
  // renderer's walk from the hook up to the layout's own child is genuinely
  // exercised and the ordering assertions cannot compare against a -1 index.
  //
  // The authored labels are what the Designer's Service Card started shipping:
  // cloneNode carries them onto every rate card, so a clone that does not strip
  // them renders "$135 /hr /hour". They deliberately share the chip label's
  // utility classes and differ only by service-card_price-unit, which is what
  // makes "exactly one .service-card_price-unit" a real check rather than one
  // that a leftover authored label would also satisfy.
  const priceCard = makeElement('div', {}, ['service-card_price-card'])
  const priceCardLayout = makeElement('div', {}, ['service-card_price-card-layout'])
  // The authored labels are published independently of the price paragraph, so
  // they are modelled that way: a chip whose price hook is missing still has
  // the Designer's labels in it, which is what the soft-fail path must leave
  // alone rather than empty.
  if (includeAuthoredChipLabels) {
    const authoredTop = makeElement('p', {}, ['text-size-small', 'line-height-100'])
    authoredTop.textContent = 'per'
    priceCardLayout.appendChild(authoredTop)
  }

  if (includePriceParagraph) {
    const pricePara = makeElement('p', {}, ['text-size-large'])
    const currency = makeElement('span')
    currency.textContent = '$'
    const amount = makeElement('span', {
      'data-millify': '',
      'data-millify-raw': '0',
      'data-millify-max': '5000',
    })
    amount.textContent = '0'
    pricePara.appendChild(currency)
    pricePara.appendChild(amount)
    priceCardLayout.appendChild(pricePara)
  }

  if (includeAuthoredChipLabels) {
    const authoredBottom = makeElement('p', {}, ['text-size-small', 'line-height-100'])
    authoredBottom.textContent = '/hr'
    priceCardLayout.appendChild(authoredBottom)
  }
  priceCard.appendChild(priceCardLayout)
  card.appendChild(priceCard)
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
  const paidModalPrice = makeElement('span', { 'call-type-price': '' })
  paidModalPrice.textContent = '$50'
  paidModalOption.appendChild(paidModalCta)
  paidModalOption.appendChild(paidModalPrice)
  root.appendChild(paidModalOption)

  const bookingButtonWrapper = makeElement('div', { 'booking-button-wrapper': '' })
  bookingButtonWrapper.style.display = 'none'
  bookingButtonWrapper.setAttribute('aria-hidden', 'true')
  const bookingButton = makeElement('button', { 'data-modal-trigger': 'popup-booking-main' })
  bookingButtonWrapper.appendChild(bookingButton)
  if (includeBookingButton) root.appendChild(bookingButtonWrapper)

  const bookingDialog = makeElement('dialog', {
    'data-modal-target': 'popup-booking-main',
    'popup-booking': '',
  })
  bookingDialog.appendChild(popupNylasContainer)
  root.appendChild(bookingDialog)

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
    paidModalPrice,
    bookingButtonWrapper,
    bookingButton,
    bookingDialog,
    heroFreeCard,
    heroPaidCard,
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
  freeController,
  paidController,
  dynamicFreeController,
  freeControllerLoadFails = false,
  omitInitialFreeController = false,
  existingHeadScripts = [],
  location = { hostname: 'www.thestarters.com', pathname: '/hire/ashna-rana' },
  schedulingBridge = false,
} = {}) {
  const warnings = []
  const requestedIndexes = []
  const emptyNavRefreshCalls = []
  const requestedObjectIds = []
  const requestedUrls = []
  const mutationObserverCallbacks = []
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
    // Real document queries span head and body; script tags live in head.
    querySelector: (s) => head.querySelector(s) || root.querySelector(s),
    querySelectorAll: (s) => [...head.querySelectorAll(s), ...root.querySelectorAll(s)],
    createElement: (tag) => makeElement(tag),
  }

  const headScripts = existingHeadScripts.map((attrs) =>
    head.appendChild(makeElement('script', attrs)),
  )

  const defaultFreeController = (
    typeof getStarterByMemberId === 'function' ||
    typeof getConfigs === 'function' ||
    typeof initBookingComponents === 'function'
  ) ? {
      getStarterByMemberId,
      getConfigs,
      getNearestSlot,
      installFreeBookingController: typeof initBookingComponents === 'function'
        ? (options) => {
            initBookingComponents(
              options.starterMemberstackId,
              options.grantId,
              [options.config],
              options.brandName,
              options.brandEmail,
            )
            return true
          }
        : undefined,
    } : undefined

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
    URLSearchParams,
    URL,
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
    MutationObserver: function (callback) {
      mutationObserverCallbacks.push(callback)
      return { observe() {} }
    },
    qs: (s, scope) => (scope || documentObject).querySelector(s),
    qsa: (s, scope) => (scope || documentObject).querySelectorAll(s),
    MEMBER: member,
    memberReady: Promise.resolve(member),
    waitForMember: (cb) => Promise.resolve().then(() => cb(member)),
    StartersFreeCallBooking: omitInitialFreeController
      ? undefined
      : (freeController || defaultFreeController),
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
  const originalHeadAppend = head.appendChild
  head.appendChild = (child) => {
    const appended = originalHeadAppend(child)
    if (
      (dynamicFreeController || freeControllerLoadFails) &&
      child.tag === 'script' &&
      String(child.getAttribute('src') || '').endsWith('/v3/free-call-booking.js')
    ) {
      Promise.resolve().then(() => {
        if (dynamicFreeController) context.StartersFreeCallBooking = dynamicFreeController
        const eventName = freeControllerLoadFails ? 'error' : 'load'
        for (const listener of child.listeners[eventName] || []) listener()
      })
    }
    return appended
  }
  if (schedulingBridge) {
    context.StarterSchedulingV3Stage = {}
    documentObject.documentElement.setAttribute('data-scheduling-v3-stage', 'ready')
  }
  context.headScripts = headScripts
  context.warnings = warnings
  context.requestedIndexes = requestedIndexes
  context.emptyNavRefreshCalls = emptyNavRefreshCalls
  context.requestedObjectIds = requestedObjectIds
  context.requestedUrls = requestedUrls
  context.mutationObserverCallbacks = mutationObserverCallbacks
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
  assert.equal(page.servicesList.children[0].style.display, 'none')
  assert.equal(page.servicesList.children[0].getAttribute('data-canonical-call-unavailable'), '')
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
  assert.equal(page.servicesList.children[0].style.display, 'none')
  assert.equal(page.servicesList.children[0].getAttribute('data-canonical-call-unavailable'), '')
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
    assert.equal(card.getAttribute('data-canonical-call-unavailable'), null)
    assert.equal(card.getAttribute('aria-hidden'), 'false')
    assert.equal(card.style.display, 'block')
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

    // The label lives in the green price chip. The old title-sibling
    // description is gone, and its class must not come back:
    // service-card_description carries word-break:break-all and the
    // body-regular size, neither of which suits a chip.
    assert.equal(
      card.querySelector('.service-card_description'),
      null,
      'the retired title-sibling description must not survive anywhere on the card',
    )

    const units = card.querySelectorAll('.service-card_price-unit')
    assert.equal(units.length, 1, `${title} must render exactly one chip label`)
    assert.ok(
      units[0].classList.contains('text-size-small') &&
        units[0].classList.contains('line-height-100'),
      'the chip label must keep the small-text and tight-leading utilities',
    )

    // The millify hook is a span inside the price <p>, so ordering has to be
    // measured against that paragraph, the layout's actual child. Comparing
    // against the hook itself would compare against -1 and pass vacuously.
    const priceEl = card.querySelector('[data-millify]')
    const pricePara = priceEl.closest('p')
    assert.ok(pricePara, 'the millify hook must sit inside a price paragraph')
    assert.notEqual(
      priceEl,
      pricePara,
      'the fixture must nest the millify hook inside the paragraph, as production does',
    )

    const layout = units[0].parentElement
    assert.ok(
      layout.classList.contains('service-card_price-card-layout'),
      'the chip label must be placed inside the price chip layout',
    )
    assert.equal(
      pricePara.parentElement,
      layout,
      'the chip label must share the price paragraph\'s layout box',
    )

    // Freelance prices a unit, so "/hour" reads under the amount. Retainer
    // quotes a starting price, so "from" reads above it. Same element, and
    // the side is the whole point: "from" under the price would misread as
    // a unit, and "/hour" above it would misread as a qualifier.
    // The Designer's authored chip labels ride along on cloneNode. If they
    // survive, the chip reads "$135 /hr /hour" on production.
    assert.equal(
      card.querySelectorAll('.service-card_price-card-layout')[0].children.length,
      2,
      'the cloned chip must hold only the price paragraph and the script label',
    )
    for (const node of card.descendants()) {
      assert.notEqual(
        node.textContent,
        '/hr',
        'the authored chip label must not survive cloning',
      )
      assert.notEqual(node.textContent, 'per', 'the authored top label must not survive cloning')
    }

    const unitAt = childIndexOf(layout, units[0], 'the chip label')
    const priceAt = childIndexOf(layout, pricePara, 'the price paragraph')
    if (title === 'Freelance') {
      assert.equal(units[0].textContent, '/hour', 'Freelance must carry its bare unit text')
      assert.ok(
        unitAt > priceAt,
        'the Freelance unit must come after the price so it renders underneath',
      )
      assert.deepEqual(
        layout.children,
        [pricePara, units[0]],
        'the Freelance chip layout must be exactly [price, unit]',
      )
    } else {
      assert.equal(units[0].textContent, 'from', 'Retainer must read as a from-price')
      assert.ok(
        unitAt < priceAt,
        'the Retainer "from" must come before the price so it renders on top',
      )
      assert.deepEqual(
        layout.children,
        [units[0], pricePara],
        'the Retainer chip layout must be exactly [unit, price]',
      )
    }

    const titleEl = card.querySelector('[data-service-card-element="title"]')
    assert.ok(
      titleEl.parentElement.classList.contains('service-card_title-wrapper'),
      'the title must stay inside the authored title wrapper',
    )
    assert.deepEqual(
      titleEl.parentElement.children,
      [titleEl],
      'the title now renders alone in its wrapper',
    )
  }

  const price = cloned[0].querySelector('[data-millify]')
  assert.equal(price.getAttribute('data-millify'), '5000')
  assert.equal(price.getAttribute('data-millify-raw'), null, 'stale raw value must be cleared')
  assert.equal(
    price.getAttribute('data-millify-max'),
    null,
    'the authored ceiling is sized for the paid-call rate and must not be inherited by rate cards',
  )

  // The hook is the inner amount span, so the rate must land there and leave
  // the authored currency span alone. Writing to the paragraph instead would
  // render the price but silently swallow the "$".
  assert.equal(price.tag, 'span', 'the millify hook is the amount span, not the paragraph')
  assert.equal(price.textContent, '5000', 'the rate must be written onto the millify span')
  assert.equal(
    price.closest('p').children[0].textContent,
    '$',
    'the authored currency span must survive the price write',
  )

  // The strip must happen on the clone, never the source: the authored call
  // card's paid-call price is exactly what the ceiling guards.
  const template = page.servicesList.children.find(
    (child) => child.getAttribute('data-rate-card') === null,
  )
  assert.equal(template.querySelector('[data-millify]').getAttribute('data-millify-max'), '5000')

  // The authored labels are stripped from CLONES only. The template is the
  // real call card the section still renders, so its own '/hr' must survive:
  // stripping in place would blank the authored chip for every visitor.
  const templateLayout = template.querySelector('.service-card_price-card-layout')
  assert.equal(
    templateLayout.children.length,
    3,
    'the template chip keeps its authored top and bottom labels',
  )
  assert.ok(
    templateLayout.children.some((child) => child.textContent === '/hr'),
    'the authored /hr must still be on the untouched template after renderRateCards',
  )
  assert.equal(
    template.querySelectorAll('.service-card_price-unit').length,
    0,
    'the template must never receive a script-built chip label',
  )
})

test('a price chip with no millify paragraph warns and still renders the cards', async () => {
  // The chip label is anchored on [data-millify]. If Webflow ever ships a card
  // whose price paragraph is missing or unhooked, that must cost the label
  // only: the cards themselves still carry the rate, the title, and the
  // signup attribution, so a cosmetic gap must never take the section down.
  const page = makePage({ includePriceParagraph: false })
  const context = makeContext({
    page,
    record: { rate: 135, 'retainer-rate': '5500', 'retainer-enabled': true },
  })
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  await settle()

  const cloned = page.servicesList.children.filter((c) => c.getAttribute('data-rate-card'))
  assert.deepEqual(
    cloned.map((c) => c.getAttribute('data-rate-card')),
    ['freelance', 'retainer'],
    'both rate cards must still render without their price paragraph',
  )
  for (const card of cloned) {
    assert.equal(
      card.querySelectorAll('.service-card_price-unit').length,
      0,
      'no chip label can be placed when there is no price paragraph to anchor it',
    )
    assert.equal(card.style.display, 'block', 'the card must still be revealed')
    assert.equal(card.getAttribute('data-signup-trigger-element'), 'service')
    // The strip is anchored on the same price paragraph as the insert, so
    // when there is nothing to anchor there is nothing to strip either: the
    // authored chip must be left exactly as the Designer published it rather
    // than emptied by a half-applied fix.
    assert.deepEqual(
      card
        .querySelector('.service-card_price-card-layout')
        .children.map((child) => child.textContent),
      ['per', '/hr'],
      'an unanchored chip keeps its authored labels untouched',
    )
  }
  assert.ok(
    context.warnings.some(
      (line) => line.includes('Rate services:') && line.includes('Price paragraph not found'),
    ),
    'expected a soft-fail warning, got: ' + JSON.stringify(context.warnings),
  )
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
  assert.equal(page.bookingButtonWrapper.style.display, 'none')
  assert.equal(page.bookingButtonWrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(page.bookingButton.getAttribute('data-booking-trigger-unavailable'), '')
  assert.equal(page.bookingButton.getAttribute('aria-disabled'), 'true')
  assert.equal(
    page.servicesList.children.filter((card) =>
      card.hasAttribute('data-runtime-free-call-card'),
    ).length,
    0,
  )
  assert.ok(context.warnings.some((line) => line.includes('No Configurations found')))
})

test('the TEST fixture uses canonical Free and Paid configs to reveal the authored Book Call trigger', async () => {
  const page = makePage({ index: 'Freelancers3.0-staging-test' })
  const configs = [
    { config_id: 'config_free_test', is_paid: false, active: true, data_environment: 'test' },
    {
      config_id: 'config_paid_test',
      is_paid: true,
      active: true,
      data_environment: 'test',
      payment_environment: 'test',
      price_cents: 100,
      currency: 'usd',
      duration: 60,
    },
  ]
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
    getConfigs: async () => configs,
    getNearestSlot: async () => null,
    initBookingComponents: () => {},
    paidController: { installPaidBookingController: () => true },
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.bookingButtonWrapper.style.display, 'flex')
  assert.equal(page.bookingButtonWrapper.getAttribute('aria-hidden'), 'false')
  assert.equal(page.bookingButton.getAttribute('data-modal-trigger'), 'popup-booking-main')
  assert.equal(page.bookingButton.getAttribute('data-booking-trigger-unavailable'), null)
  assert.equal(page.bookingButton.getAttribute('aria-disabled'), null)
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'config_free_test')
  assert.equal(page.paidModalCta.getAttribute('data-config'), 'config_paid_test')
})

test('a missing page loader is recovered from the GitHub Free controller exactly once', async () => {
  const page = makePage({ index: 'Freelancers3.0-staging-test' })
  const configs = [
    { config_id: 'config_free_test', is_paid: false, active: true, data_environment: 'test' },
    {
      config_id: 'config_paid_test',
      is_paid: true,
      active: true,
      data_environment: 'test',
      payment_environment: 'test',
      price_cents: 500,
      currency: 'usd',
      duration: 60,
    },
  ]
  let installs = 0
  const dynamicFreeController = {
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_test' }),
    getConfigs: async () => configs,
    installFreeBookingController: () => {
      installs += 1
      return true
    },
  }
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
    omitInitialFreeController: true,
    dynamicFreeController,
    paidController: { installPaidBookingController: () => true },
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const loaders = context.document.head.children.filter((child) =>
    child.tag === 'script' &&
    child.hasAttribute('data-starters-free-call-booking-loader'),
  )
  assert.equal(loaders.length, 1)
  assert.equal(
    loaders[0].getAttribute('src'),
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/free-call-booking.js',
  )
  assert.equal(context.StartersFreeCallBooking, dynamicFreeController)
  assert.equal(installs, 1)
  assert.equal(page.bookingButtonWrapper.style.display, 'flex')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'config_free_test')
  assert.equal(page.paidModalCta.getAttribute('data-config'), 'config_paid_test')
})

test('an existing GitHub Free controller does not add another loader', async () => {
  const page = makePage({ index: 'Freelancers3.0-staging-test' })
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
    getConfigs: async () => [
      { config_id: 'config_free_test', is_paid: false, active: true, data_environment: 'test' },
    ],
    initBookingComponents: () => {},
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(
    context.document.head.children.filter((child) =>
      child.tag === 'script' && child.hasAttribute('data-starters-free-call-booking-loader'),
    ).length,
    0,
  )
})

test('a failed GitHub Free controller load keeps booking hidden', async () => {
  const page = makePage({ index: 'Freelancers3.0-staging-test' })
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
    omitInitialFreeController: true,
    freeControllerLoadFails: true,
    paidController: { installPaidBookingController: () => true },
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.bookingButtonWrapper.style.display, 'none')
  assert.equal(page.bookingButtonWrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(page.freeModalCta.getAttribute('data-config'), null)
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.ok(context.warnings.some((line) => line.includes('failed to load')))
})


const CANONICAL_BOOKING_LOADER =
  'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/free-call-booking.js'

const TEST_BRAND_MEMBER = {
  id: 'brand_test_member',
  auth: { email: 'brand-test@example.com' },
  customFields: { 'free-user': 'Brand', 'last-name': 'Test' },
  planConnections: [
    { planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' },
  ],
}

const TEST_BOOKING_CONFIGS = [
  { config_id: 'config_free_test', is_paid: false, active: true, data_environment: 'test' },
  {
    config_id: 'config_paid_test',
    is_paid: true,
    active: true,
    data_environment: 'test',
    payment_environment: 'test',
    price_cents: 500,
    currency: 'usd',
    duration: 60,
  },
]

function makeTestFreeController() {
  return {
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_test' }),
    getConfigs: async () => TEST_BOOKING_CONFIGS,
    installFreeBookingController: () => true,
  }
}

function bookingLoaders(head) {
  return head.children.filter(
    (child) =>
      child.tag === 'script' && child.hasAttribute('data-starters-free-call-booking-loader'),
  )
}

/** Every booking-controller script tag present, injected or page-authored. */
function bookingScripts(head) {
  return head.children.filter(
    (child) =>
      child.tag === 'script' &&
      String(child.getAttribute('src') || '').endsWith('/v3/free-call-booking.js'),
  )
}

test('a page loader still in flight is reused instead of adding a second one', async () => {
  const page = makePage({ index: 'Freelancers3.0-staging-test' })
  const lateController = makeTestFreeController()
  const context = makeContext({
    page,
    member: TEST_BRAND_MEMBER,
    omitInitialFreeController: true,
    existingHeadScripts: [{ src: CANONICAL_BOOKING_LOADER, async: '' }],
    paidController: { installPaidBookingController: () => true },
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const inFlight = context.headScripts[0]
  assert.equal(bookingLoaders(context.document.head).length, 0)
  assert.equal(bookingScripts(context.document.head).length, 1)
  assert.ok(
    (inFlight.listeners.load || []).length > 0,
    'expected the in-flight page loader to be watched rather than duplicated',
  )
  assert.equal(page.bookingButtonWrapper.style.display, 'none')

  context.StartersFreeCallBooking = lateController
  for (const listener of inFlight.listeners.load) listener()
  await settle()

  assert.equal(bookingScripts(context.document.head).length, 1)
  assert.equal(page.bookingButtonWrapper.style.display, 'flex')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'config_free_test')
  assert.equal(page.paidModalCta.getAttribute('data-config'), 'config_paid_test')
})

test('a blocking page loader that already ran is superseded by the canonical loader', async () => {
  const page = makePage({ index: 'Freelancers3.0-staging-test' })
  const context = makeContext({
    page,
    member: TEST_BRAND_MEMBER,
    omitInitialFreeController: true,
    // A stale pinned tag whose load/error events fired long before this
    // deferred file ran, and which never installed the controller.
    existingHeadScripts: [{
      src: 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/v3/free-call-booking.js',
    }],
    dynamicFreeController: makeTestFreeController(),
    paidController: { installPaidBookingController: () => true },
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const loaders = bookingLoaders(context.document.head)
  assert.equal(loaders.length, 1)
  assert.equal(loaders[0].getAttribute('src'), CANONICAL_BOOKING_LOADER)
  assert.deepEqual(context.headScripts[0].listeners, {})
  assert.equal(page.bookingButtonWrapper.style.display, 'flex')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'config_free_test')
  assert.equal(page.paidModalCta.getAttribute('data-config'), 'config_paid_test')
  assert.ok(!context.warnings.some((line) => line.includes('failed to load')))
})

test('a reused page loader that errors falls back to the canonical loader', async () => {
  const page = makePage({ index: 'Freelancers3.0-staging-test' })
  const context = makeContext({
    page,
    member: TEST_BRAND_MEMBER,
    omitInitialFreeController: true,
    existingHeadScripts: [{
      src: 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.60.0/v3/free-call-booking.js',
      async: '',
    }],
    dynamicFreeController: makeTestFreeController(),
    paidController: { installPaidBookingController: () => true },
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/jp-dionisio' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const inFlight = context.headScripts[0]
  assert.equal(bookingLoaders(context.document.head).length, 0)

  for (const listener of inFlight.listeners.error) listener()
  await settle()

  const loaders = bookingLoaders(context.document.head)
  assert.equal(loaders.length, 1)
  assert.equal(loaders[0].getAttribute('src'), CANONICAL_BOOKING_LOADER)
  assert.equal(page.bookingButtonWrapper.style.display, 'flex')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'config_free_test')
})

test('the TEST fixture booking surface stays hidden and inert on production', async () => {
  const page = makePage()
  let starterReads = 0
  let configReads = 0
  const context = makeContext({
    page,
    member: {
      id: 'brand_live_member',
      auth: { email: 'brand-live@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Live' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => {
      starterReads += 1
      return { nylas_grant_id: 'grant_must_not_be_read' }
    },
    getConfigs: async () => {
      configReads += 1
      return [{ config_id: 'config_must_not_bind', is_paid: false, active: true, data_environment: 'production' }]
    },
    location: { hostname: 'www.thestarters.com', pathname: '/hire/jp-dionisio/' },
    schedulingBridge: true,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(starterReads, 0)
  assert.equal(configReads, 0)
  assert.equal(page.bookingButtonWrapper.style.display, 'none')
  assert.equal(page.bookingButtonWrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(page.freeModalCta.getAttribute('data-config'), null)
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.ok(context.warnings.some((line) => line.includes('TEST booking fixture stayed closed')))
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
    assert.equal(page.servicesList.children[0].getAttribute('data-modal-trigger'), null)
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
  assert.equal(freeCard.getAttribute('data-modal-trigger'), null)
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
    getStarterByMemberId: async () => ({
      nylas_grant_id: 'grant_prod',
      nylas_grant_email: 'starter@example.com',
    }),
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
  assert.equal(freeCard.getAttribute('data-modal-trigger'), null)
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
  assert.equal(
    guard.textContent,
    '[data-booking-unavailable]{display:none!important}' +
      '[data-booking-trigger-unavailable]{display:none!important}' +
      '[data-canonical-call-unavailable]{display:none!important}',
  )
  assert.equal(page.inlineWrapper.style.display, 'none')
  assert.equal(page.inlineWrapper.getAttribute('aria-hidden'), 'true')
})

test('a signed-in Brand hides call projections while canonical discovery is pending', async () => {
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
  assert.equal(page.servicesList.children[0].style.display, 'none')
  assert.equal(page.servicesList.children[0].getAttribute('data-canonical-call-unavailable'), '')
  assert.equal(page.servicesList.children[0].getAttribute('aria-hidden'), 'true')
  assert.equal(page.bookingButton.getAttribute('data-booking-trigger-unavailable'), '')
  assert.equal(page.bookingButton.getAttribute('aria-disabled'), 'true')

  resolveStarter(null)
  await settle()
})

test('an anonymous viewer cannot reveal call projections from stale public flags', async () => {
  const page = makePage()
  const paidSurface = makeElement('div', { 'has-connection': 'paid' })
  page.root.appendChild(paidSurface)
  const context = makeContext({
    page,
    record: {
      'free-consulting-calls-t-f': true,
      'paid-consulting-calls-t-f': true,
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)

  const freeSurface = page.servicesList.querySelector('[has-connection="free"]')
  for (const surface of [freeSurface, paidSurface]) {
    assert.equal(surface.getAttribute('data-canonical-call-unavailable'), '')
    assert.equal(surface.getAttribute('aria-hidden'), 'true')
    assert.equal(surface.style.display, 'none')
  }

  await settle()

  for (const surface of [freeSurface, paidSurface]) {
    assert.equal(surface.getAttribute('data-canonical-call-unavailable'), '')
    assert.equal(surface.getAttribute('aria-hidden'), 'true')
    assert.equal(surface.style.display, 'none')
  }
})

test('a chooser trigger outside booking-button-wrapper stays hidden until discovery succeeds', async () => {
  const page = makePage()
  const strayTrigger = makeElement('button', {
    'data-modal-trigger': 'popup-booking-main',
  })
  page.root.appendChild(strayTrigger)
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => null,
    getConfigs: async () => [],
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(strayTrigger.getAttribute('data-booking-trigger-unavailable'), '')
  assert.equal(strayTrigger.getAttribute('aria-disabled'), 'true')
  const guard = context.document.getElementById('hire-booking-modal-availability-guard')
  assert.ok(guard.textContent.includes(
    '[data-booking-trigger-unavailable]{display:none!important}',
  ))
})

test('canonical discovery removes legacy Free and Paid projections when the profile is not bookable', async () => {
  const page = makePage()
  const paidSurface = makeElement('div', { 'has-connection': 'paid' })
  page.root.appendChild(paidSurface)
  const context = makeContext({
    page,
    record: {
      'free-consulting-calls-t-f': true,
      'paid-consulting-calls-t-f': true,
    },
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => null,
    getConfigs: async () => [],
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeSurface = page.servicesList.querySelector('[has-connection="free"]')
  for (const surface of [freeSurface, paidSurface]) {
    assert.equal(surface.getAttribute('data-canonical-call-unavailable'), '')
    assert.equal(surface.getAttribute('aria-hidden'), 'true')
    assert.equal(surface.style.display, 'none')
  }
  assert.equal(page.bookingButton.getAttribute('data-booking-trigger-unavailable'), '')
})

test('canonical installed Free and Paid controllers reveal every matching projection surface', async () => {
  const page = makePage()
  const paidSurface = makeElement('div', { 'has-connection': 'paid' })
  page.root.appendChild(paidSurface)
  const context = makeContext({
    page,
    record: {
      'free-consulting-calls-t-f': false,
      'paid-consulting-calls-t-f': false,
    },
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({
      nylas_grant_id: 'grant_prod',
      nylas_grant_email: 'starter@example.com',
    }),
    getConfigs: async () => [
      { config_id: 'free_live', is_paid: false, active: true, data_environment: 'production' },
      {
        config_id: 'paid_live',
        is_paid: true,
        active: true,
        data_environment: 'production',
        payment_environment: 'live',
        currency: 'USD',
        price_cents: 25000,
        duration: 60,
      },
    ],
    initBookingComponents: () => {},
    paidController: { installPaidBookingController: () => true },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeSurface = page.servicesList.querySelector('[has-connection="free"]')
  for (const surface of [freeSurface, paidSurface]) {
    assert.equal(surface.getAttribute('data-canonical-call-unavailable'), null)
    assert.equal(surface.getAttribute('aria-hidden'), null)
    assert.equal(surface.style.display, 'block')
  }
  assert.equal(page.bookingButton.getAttribute('data-booking-trigger-unavailable'), null)
})

test('canonical Brand discovery refreshes hidden Services navigation after reveal', async () => {
  const page = makePage()
  const services = page.root.querySelector('#services')
  services.style.display = 'none'
  let resolveConfigs
  const configsReady = new Promise((resolve) => { resolveConfigs = resolve })
  let refreshes = 0
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
    getConfigs: () => configsReady,
    initBookingComponents: () => {},
  })
  context.__startersEmptyNavRefresh = () => {
    refreshes += 1
    const freeSurface = page.servicesList.querySelector('[has-connection="free"]')
    if (freeSurface.style.display === 'block' && freeSurface.getAttribute('aria-hidden') !== 'true') {
      services.style.display = 'block'
    }
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(refreshes, 0)
  assert.equal(services.style.display, 'none')

  resolveConfigs([{
    config_id: 'free_live',
    is_paid: false,
    active: true,
    data_environment: 'production',
  }])
  await settle()

  assert.equal(refreshes, 1)
  assert.equal(services.style.display, 'block')
})

test('canonical discovery preserves hidden runtime call templates', async () => {
  const page = makePage({ includeNativeFreeTemplate: true })
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
    getConfigs: async () => [{
      config_id: 'free_live',
      is_paid: false,
      active: true,
      data_environment: 'production',
    }],
    initBookingComponents: () => {},
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const authored = page.servicesList.children[0]
  assert.equal(authored.getAttribute('data-canonical-call-unavailable'), null)
  assert.equal(authored.style.display, 'block')
  assert.equal(page.nativeFreeTemplate.hasAttribute('hidden'), true)
  assert.equal(page.nativeFreeTemplate.getAttribute('aria-hidden'), 'true')
  assert.notEqual(page.nativeFreeTemplate.style.display, 'block')
  assert.equal(
    page.servicesList.children.filter((card) =>
      card.getAttribute('has-connection') === 'free' && !card.hasAttribute('hidden'),
    ).length,
    1,
  )
})

test('booking discovery rejects inactive, mixed-environment, and duplicate configurations', async () => {
  const scenarios = [
    [{ config_id: 'inactive_free', is_paid: false, active: false, data_environment: 'production' }],
    [{ config_id: 'inactive_paid', is_paid: true, active: false, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: 500 }],
    [{ config_id: 'mixed_data', is_paid: false, active: true, data_environment: 'test' }],
    [{ config_id: 'mixed_payment', is_paid: true, active: true, data_environment: 'production', payment_environment: 'test', currency: 'USD', price_cents: 500 }],
    [{ config_id: 'missing_duration', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: 500 }],
    [{ config_id: 'wrong_duration', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: 500, duration: 30 }],
    [{ config_id: 'sub_minimum', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: 99, duration: 60 }],
    [{ config_id: 'unknown_payment', is_paid: null, active: true, data_environment: 'production' }],
    [
      { config_id: 'free_a', is_paid: false, active: true, data_environment: 'production' },
      { config_id: 'free_b', is_paid: false, active: true, data_environment: 'production' },
    ],
    [
      { config_id: 'paid_a', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: 500, duration: 60 },
      { config_id: 'paid_b', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: 500, duration: 60 },
    ],
    [
      { config_id: 'shared', is_paid: false, active: true, data_environment: 'production' },
      { config_id: 'shared', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live', currency: 'USD', price_cents: 500, duration: 60 },
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
    { config_id: 'paid_live', is_paid: true, active: true, data_environment: 'production', payment_environment: 'live', currency: 'usd', price_cents: 1250, duration: 60 },
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
    getStarterByMemberId: async () => ({
      nylas_grant_id: 'grant_prod',
      nylas_grant_email: 'starter@example.com',
    }),
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
  assert.equal(paidCalls[0].grantId, 'grant_prod')
  assert.equal(paidCalls[0].starterSlug, 'ashna-rana')
  assert.equal(paidCalls[0].starterEmail, 'starter@example.com')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'free_live')
  assert.equal(page.paidModalCta.getAttribute('data-config'), 'paid_live')
  assert.equal(page.freeModalOption.getAttribute('data-booking-unavailable'), null)
  assert.equal(page.paidModalOption.getAttribute('data-booking-unavailable'), null)
  assert.equal(page.freeModalOption.getAttribute('aria-hidden'), null)
  assert.equal(page.paidModalOption.getAttribute('aria-hidden'), null)
  assert.equal(page.freeModalOption.style.display, 'block')
  assert.equal(page.paidModalOption.style.display, 'block')
})

test('a failed Paid install keeps the installed Free chooser option selectable', async () => {
  const page = makePage()
  const paidSurface = makeElement('div', { 'has-connection': 'paid' })
  page.root.appendChild(paidSurface)
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({
      nylas_grant_id: 'grant_prod',
      nylas_grant_email: 'starter@example.com',
    }),
    getConfigs: async () => [
      {
        config_id: 'free_live',
        is_paid: false,
        active: true,
        data_environment: 'production',
      },
      {
        config_id: 'paid_live',
        is_paid: true,
        active: true,
        data_environment: 'production',
        payment_environment: 'live',
        currency: 'USD',
        price_cents: 1250,
        duration: 60,
      },
    ],
    initBookingComponents: () => {},
    paidController: { installPaidBookingController: () => false },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeSurface = page.servicesList.querySelector('[has-connection="free"]')
  assert.equal(freeSurface.style.display, 'block')
  assert.equal(freeSurface.getAttribute('data-canonical-call-unavailable'), null)
  assert.equal(paidSurface.style.display, 'none')
  assert.equal(paidSurface.getAttribute('data-canonical-call-unavailable'), '')
  assert.equal(page.freeModalCta.getAttribute('data-config'), 'free_live')
  assert.equal(page.freeModalOption.getAttribute('data-booking-unavailable'), null)
  assert.equal(page.freeModalOption.getAttribute('aria-hidden'), null)
  assert.equal(page.freeModalOption.style.display, 'block')
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.equal(page.paidModalOption.getAttribute('data-booking-unavailable'), '')
  assert.equal(page.paidModalOption.getAttribute('aria-hidden'), 'true')
  assert.equal(page.paidModalOption.style.display, 'none')
  assert.equal(page.bookingButtonWrapper.style.display, 'flex')
})

test('the generic Book Call button keeps the authored Free/Paid chooser entry', async () => {
  const page = makePage()
  let chooserClicks = 0
  let freeClicks = 0
  page.bookingButton.click = () => { chooserClicks += 1 }
  page.freeModalCta.click = () => { freeClicks += 1 }
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    freeController: {
      getStarterByMemberId: async () => ({
        nylas_grant_id: 'grant_prod',
        nylas_grant_email: 'starter@example.com',
      }),
      getConfigs: async () => [{
        config_id: 'free_live',
        is_paid: false,
        active: true,
        data_environment: 'production',
      }],
      installFreeBookingController: () => {
        page.freeModalCta.setAttribute('data-free-call-v3', 'ready')
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.bookingButton.getAttribute('data-modal-trigger'), 'popup-booking-main')
  assert.equal(page.bookingButton.getAttribute('data-booking-trigger-unavailable'), null)
  page.bookingButton.click()
  assert.equal(chooserClicks, 1)
  assert.equal(freeClicks, 0)
})

test('a Free service card opens the modal shell before the ready Free CTA', async () => {
  const page = makePage()
  const clickOrder = []
  page.bookingButton.click = () => { clickOrder.push('shell') }
  page.freeModalCta.click = () => { clickOrder.push('free') }
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    freeController: {
      getStarterByMemberId: async () => ({
        nylas_grant_id: 'grant_prod',
        nylas_grant_email: 'starter@example.com',
      }),
      getConfigs: async () => [{
        config_id: 'free_live',
        is_paid: false,
        active: true,
        data_environment: 'production',
      }],
      installFreeBookingController: () => {
        page.freeModalCta.setAttribute('data-free-call-v3', 'ready')
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeCard = page.servicesList.querySelector('[has-connection="free"]')
  assert.equal(freeCard.getAttribute('booking-popup-open'), null)
  assert.equal(freeCard.getAttribute('data-modal-trigger'), null)
  assert.equal(freeCard.getAttribute('data-call-service-direct'), 'ready')
  freeCard.listeners.click[0]({
    preventDefault() {},
    stopImmediatePropagation() {},
  })
  await settle()
  assert.deepEqual(clickOrder, ['shell', 'free'])
})

test('a Paid service card opens the modal shell before the ready Paid CTA', async () => {
  // Production Webflow markup identifies this card with has-connection="paid"
  // and does not author data-type on the service card itself.
  const page = makePage({ includeFreeCard: false, includeCallDataType: false })
  const clickOrder = []
  page.bookingButton.click = () => { clickOrder.push('shell') }
  page.paidModalCta.click = () => { clickOrder.push('paid') }
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({
      nylas_grant_id: 'grant_prod',
      nylas_grant_email: 'starter@example.com',
    }),
    getConfigs: async () => [{
      config_id: 'paid_live',
      is_paid: true,
      active: true,
      data_environment: 'production',
      payment_environment: 'live',
      currency: 'usd',
      price_cents: 100,
      duration: 60,
    }],
    paidController: {
      installPaidBookingController: () => {
        page.paidModalCta.setAttribute('data-paid-call-v3', 'ready')
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const paidCard = page.servicesList.querySelector('[has-connection="paid"]')
  assert.equal(paidCard.getAttribute('data-type'), null)
  assert.equal(paidCard.getAttribute('booking-popup-open'), null)
  assert.equal(paidCard.getAttribute('data-modal-trigger'), null)
  assert.equal(paidCard.getAttribute('data-call-service-direct'), 'ready')
  assert.equal(paidCard.listeners.click.length, 1)

  let prevented = 0
  let stopped = 0
  paidCard.listeners.click[0]({
    preventDefault: () => { prevented += 1 },
    stopImmediatePropagation: () => { stopped += 1 },
  })
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  await settle()
  assert.deepEqual(clickOrder, ['shell', 'paid'])
})

test('hero Free and Paid service rows use the same direct entry as Services cards', async () => {
  const page = makePage({ includeHeroCallCards: true })
  const clickOrder = []
  page.bookingButton.click = () => { clickOrder.push('shell') }
  page.freeModalCta.click = () => { clickOrder.push('free') }
  page.paidModalCta.click = () => { clickOrder.push('paid') }
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
      getConfigs: async () => [{
        config_id: 'free_live',
        is_paid: false,
        active: true,
        data_environment: 'production',
      }, {
        config_id: 'paid_live',
        is_paid: true,
        active: true,
        data_environment: 'production',
        payment_environment: 'live',
        currency: 'usd',
        price_cents: 100,
        duration: 60,
      }],
      installFreeBookingController: () => {
        page.freeModalCta.setAttribute('data-free-call-v3', 'ready')
        return true
      },
    },
    paidController: {
      installPaidBookingController: () => {
        page.paidModalCta.setAttribute('data-paid-call-v3', 'ready')
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  for (const card of [page.heroFreeCard, page.heroPaidCard]) {
    assert.equal(card.getAttribute('booking-popup-open'), null)
    assert.equal(card.getAttribute('data-modal-trigger'), null)
    assert.equal(card.getAttribute('data-call-service-direct'), 'ready')
    assert.equal(card.listeners.click.length, 1)
  }

  page.heroFreeCard.listeners.click[0]({ preventDefault() {}, stopImmediatePropagation() {} })
  await settle()
  page.heroPaidCard.listeners.click[0]({ preventDefault() {}, stopImmediatePropagation() {} })
  await settle()
  assert.deepEqual(clickOrder, ['shell', 'free', 'shell', 'paid'])
})

test('hero call rows inserted after canonical discovery are wired by the live observer', async () => {
  const page = makePage()
  const clickOrder = []
  page.bookingButton.click = () => { clickOrder.push('shell') }
  page.freeModalCta.click = () => { clickOrder.push('free') }
  page.paidModalCta.click = () => { clickOrder.push('paid') }

  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
      getConfigs: async () => [{
          config_id: 'free_live',
          is_paid: false,
          active: true,
          data_environment: 'production',
        }, {
          config_id: 'paid_live',
          is_paid: true,
          active: true,
          data_environment: 'production',
          payment_environment: 'live',
          currency: 'usd',
          price_cents: 100,
          duration: 60,
        }],
      installFreeBookingController: () => {
        page.freeModalCta.setAttribute('data-free-call-v3', 'ready')
        return true
      },
    },
    paidController: {
      installPaidBookingController: () => {
        page.paidModalCta.setAttribute('data-paid-call-v3', 'ready')
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const heroFreeCard = makeElement('div', {
    'data-service-card': 'component',
    'has-connection': 'free',
    'data-modal-trigger': 'popup-booking',
    'booking-popup-open': '',
  })
  const heroPaidCard = makeElement('div', {
    'data-service-card': 'component',
    'has-connection': 'paid',
    'data-modal-trigger': 'popup-booking',
    'booking-popup-open': '',
  })
  page.root.appendChild(heroFreeCard)
  page.root.appendChild(heroPaidCard)
  for (const callback of context.mutationObserverCallbacks) {
    callback([{ type: 'childList', addedNodes: [heroFreeCard, heroPaidCard] }])
  }

  for (const card of [heroFreeCard, heroPaidCard]) {
    assert.equal(card.getAttribute('booking-popup-open'), null)
    assert.equal(card.getAttribute('data-modal-trigger'), null)
    assert.equal(card.getAttribute('data-call-service-direct'), 'ready')
    assert.equal(card.listeners.click.length, 1)
  }

  heroFreeCard.listeners.click[0]({ preventDefault() {}, stopImmediatePropagation() {} })
  await settle()
  heroPaidCard.listeners.click[0]({ preventDefault() {}, stopImmediatePropagation() {} })
  await settle()
  assert.deepEqual(clickOrder, ['shell', 'free', 'shell', 'paid'])
})

test('a cloned ready call card receives its own direct-entry listener', async () => {
  const page = makePage({ includeHeroCallCards: true })
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
      getConfigs: async () => [{
        config_id: 'free_live',
        is_paid: false,
        active: true,
        data_environment: 'production',
      }],
      installFreeBookingController: () => {
        page.freeModalCta.setAttribute('data-free-call-v3', 'ready')
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const clone = page.heroFreeCard.cloneNode(true)
  assert.equal(clone.getAttribute('data-call-service-direct'), 'ready')
  assert.equal((clone.listeners.click || []).length, 0)
  page.root.appendChild(clone)
  for (const callback of context.mutationObserverCallbacks) {
    callback([{ type: 'childList', addedNodes: [clone] }])
  }

  assert.equal(clone.getAttribute('data-call-service-direct'), 'ready')
  assert.equal(clone.listeners.click.length, 1)
})

test('a migrated profile without the legacy Book Call button still uses the direct Free CTA', async () => {
  const page = makePage({ includeBookingButton: false })
  const clickOrder = []
  page.bookingDialog.open = false
  page.freeModalCta.click = () => {
    assert.equal(page.bookingDialog.open, true)
    clickOrder.push('free')
  }
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    omitInitialFreeController: true,
  })
  context.lumos = {
    modal: {
      list: {
        'popup-booking-main': {
          el: page.bookingDialog,
          open: () => {
            page.bookingDialog.open = true
            clickOrder.push('shell')
          },
        },
      },
    },
  }
  context.xanoAuthFetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('/starter/get_booking_profile/v3')
      ? { id: 383, nylas_grant_id: 'grant_prod' }
      : [{
          config_id: 'free_live',
          is_paid: false,
          active: true,
          data_environment: 'production',
        }],
  })
  context.StartersPaidCallBrandPayment = {
    bookingRequestFingerprint: () => 'fingerprint',
    createBookingAttempt: () => ({ run: async () => ({}) }),
    mountPaidCalendar: async () => ({ slots: [] }),
  }
  vm.createContext(context)
  vm.runInContext(freeBookingSource, context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.root.querySelector('[data-modal-trigger="popup-booking-main"]'), null)
  assert.equal(page.bookingDialog.getAttribute('data-booking-surface-unavailable'), null)

  const freeCard = page.servicesList.querySelector('[has-connection="free"]')
  freeCard.listeners.click[0]({
    preventDefault() {},
    stopImmediatePropagation() {},
  })
  await settle()
  assert.deepEqual(clickOrder, ['shell', 'free'])
})

test('a migrated profile fails closed when no trigger or modal registry exists', async () => {
  const page = makePage({ includeBookingButton: false })
  let freeClicks = 0
  page.freeModalCta.click = () => { freeClicks += 1 }
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
    freeController: {
      getStarterByMemberId: async () => ({
        nylas_grant_id: 'grant_prod',
        nylas_grant_email: 'starter@example.com',
      }),
      getConfigs: async () => [{
        config_id: 'free_live',
        is_paid: false,
        active: true,
        data_environment: 'production',
      }],
      installFreeBookingController: () => {
        page.freeModalCta.setAttribute('data-free-call-v3', 'ready')
        return true
      },
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const freeCard = page.servicesList.querySelector('[has-connection="free"]')
  freeCard.listeners.click[0]({
    preventDefault() {},
    stopImmediatePropagation() {},
  })
  await settle()
  assert.equal(freeClicks, 0)
})

test('a migrated profile without the legacy Book Call button stays closed before discovery succeeds', () => {
  const page = makePage({ includeBookingButton: false })
  let freeClicks = 0
  page.freeModalCta.click = () => { freeClicks += 1 }
  const context = makeContext({ page })
  delete context.qs
  delete context.qsa
  delete context.waitForMember
  vm.createContext(context)
  vm.runInContext(source, context)

  assert.equal(page.bookingDialog.getAttribute('data-booking-surface-unavailable'), '')
  const card = page.servicesList.children[0]
  card.listeners.click[0]({
    preventDefault() {},
    stopImmediatePropagation() {},
  })
  assert.equal(freeClicks, 0)
})

test('call service cards neutralize the retired scheduler before dependency stand-down', () => {
  for (const includeFreeCard of [true, false]) {
    const page = makePage({ includeFreeCard })
    let directClicks = 0
    const target = includeFreeCard ? page.freeModalCta : page.paidModalCta
    target.click = () => { directClicks += 1 }
    const context = makeContext({ page })
    delete context.qs
    delete context.qsa
    delete context.waitForMember
    vm.createContext(context)
    vm.runInContext(source, context)

    const card = page.servicesList.children[0]
    assert.equal(card.getAttribute('booking-popup-open'), null)
    assert.equal(card.getAttribute('data-modal-trigger'), null)
    assert.equal(card.getAttribute('data-call-service-direct'), 'ready')
    assert.equal(card.listeners.click.length, 1)

    let prevented = 0
    let stopped = 0
    card.listeners.click[0]({
      preventDefault: () => { prevented += 1 },
      stopImmediatePropagation: () => { stopped += 1 },
    })
    assert.equal(prevented, 1)
    assert.equal(stopped, 1)
    assert.equal(directClicks, 0)
  }
})

test('a call service card fails closed when its matching CTA is absent or unready', async () => {
  for (const mode of ['absent', 'unready']) {
    const page = makePage({ includeFreeCard: false, includeCallDataType: false })
    let paidClicks = 0
    page.paidModalCta.click = () => { paidClicks += 1 }
    if (mode === 'absent') page.paidModalCta.remove()
    const context = makeContext({
      page,
      member: {
        id: 'brand_member',
        auth: { email: 'brand@example.com' },
        customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
        planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
      },
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
      getConfigs: async () => [{
        config_id: 'paid_live',
        is_paid: true,
        active: true,
        data_environment: 'production',
        payment_environment: 'live',
        currency: 'usd',
        price_cents: 100,
        duration: 60,
      }],
      paidController: { installPaidBookingController: () => true },
    })
    vm.createContext(context)
    vm.runInContext(source, context)
    await settle()

    const paidCard = page.servicesList.querySelector('[has-connection="paid"]')
    paidCard.listeners.click[0]({
      preventDefault() {},
      stopImmediatePropagation() {},
    })
    assert.equal(paidClicks, 0, mode)
  }
})

test('Paid-only discovery stays closed when the V3 controller is unavailable', async () => {
  const page = makePage()
  let nearestSlotCalls = 0
  const context = makeContext({
    page,
    member: {
      id: 'brand_member',
      auth: { email: 'brand@example.com' },
      customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
    },
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_prod' }),
    getConfigs: async () => [{
      config_id: 'paid_live',
      is_paid: true,
      active: true,
      data_environment: 'production',
      payment_environment: 'live',
      currency: 'USD',
      price_cents: 1250,
        duration: 60,
    }],
    getNearestSlot: async () => { nearestSlotCalls += 1 },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.bookingButtonWrapper.style.display, 'none')
  assert.equal(page.bookingButtonWrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(page.freeModalOption.style.display, 'none')
  assert.equal(page.paidModalOption.style.display, 'none')
  assert.equal(page.paidModalCta.getAttribute('data-config'), null)
  assert.equal(nearestSlotCalls, 0)
  assert.ok(context.warnings.some((line) => line.includes('Paid Call controller is unavailable')))
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

  const unknownCard = makeElement('div', {
    'data-service-card': 'component',
    'data-service-card-state': 'Default',
    'data-signup-trigger-element': 'service',
    'data-signup-trigger-value': 'Unknown Advisory',
  })
  const unknownTitle = makeElement('div', { 'data-service-card-element': 'title' })
  unknownTitle.textContent = 'Unknown Advisory'
  unknownCard.appendChild(unknownTitle)
  page.servicesList.appendChild(unknownCard)

  const paidCard = makeElement('div', {
    'data-service-card': 'component',
    'data-service-card-state': 'Default',
    'data-modal-trigger': 'popup-booking',
    'booking-popup-open': '',
    'data-type': 'paid',
    'data-signup-trigger-element': 'service',
    'data-signup-trigger-value': 'Paid Consulting Call',
  })
  const paidTitle = makeElement('div', { 'data-service-card-element': 'title' })
  paidTitle.textContent = 'Paid Consulting Call'
  paidCard.appendChild(paidTitle)
  page.servicesList.appendChild(paidCard)

  const decoyServiceSelect = makeElement('select', { name: 'Services' })
  decoyServiceSelect.options = []
  page.root.appendChild(decoyServiceSelect)

  const contractDialog = makeElement('dialog', { 'data-modal-target': 'generate-contract' })
  const serviceSelect = makeElement('select', { name: 'Services' })
  serviceSelect.options = [
    { value: '', textContent: 'Select one...' },
    { value: 'Freelance work', textContent: 'Freelance work' },
    { value: 'asdf', textContent: 'asdf' },
    { value: 'Free Call', textContent: 'Free Call' },
    { value: 'Paid Consulting Call', textContent: 'Paid Consulting Call' },
  ]
  contractDialog.appendChild(serviceSelect)
  page.root.appendChild(contractDialog)
  assert.equal(
    page.root.querySelector('dialog[data-modal-target="generate-contract"] [name="Services"]'),
    serviceSelect,
  )
  assert.equal(page.root.querySelectorAll('#services [data-service-card="component"]').includes(cmsCard), true)

  const context = makeContext({
    page,
    record: { rate: 100, 'retainer-rate': '2500', 'retainer-enabled': true },
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
  const retainerCard = page.servicesList.children.find((card) =>
    card.getAttribute('data-rate-card') === 'retainer')
  assert.ok(freelanceCard)
  assert.ok(retainerCard)
  for (const [card, service] of [
    [freelanceCard, 'Freelance work'],
    [retainerCard, 'Freelance work'],
    [cmsCard, 'asdf'],
  ]) {
    assert.equal(card.getAttribute('data-modal-trigger'), 'generate-contract', service)
    assert.equal(card.getAttribute('data-sp-fill'), 'button')
    assert.equal(card.getAttribute('data-sp-fill-category'), 'service')
    assert.equal(card.getAttribute('data-sp-fill-value'), service)
  }

  for (const attribute of [
    'data-modal-trigger',
    'data-sp-fill',
    'data-sp-fill-category',
    'data-sp-fill-value',
  ]) {
    assert.equal(
      unknownCard.getAttribute(attribute),
      null,
      `unknown native service option must fail closed for ${attribute}`,
    )
  }

  const freeCard = page.servicesList.children.find((card) => card.getAttribute('data-type') === 'free')
  assert.equal(
    freeCard.getAttribute('data-modal-trigger'),
    null,
    'Free Call must not be converted into a project trigger',
  )
  assert.equal(freeCard.getAttribute('data-call-service-direct'), 'ready')
  assert.equal(freeCard.getAttribute('data-sp-fill'), null)
  assert.equal(freeCard.getAttribute('data-sp-fill-value'), null)
  assert.equal(
    paidCard.getAttribute('data-modal-trigger'),
    null,
    'Paid Call must not be converted into a project trigger',
  )
  assert.equal(paidCard.getAttribute('data-call-service-direct'), 'ready')
  assert.equal(paidCard.getAttribute('data-sp-fill'), null)
  assert.equal(paidCard.getAttribute('data-sp-fill-value'), null)
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
