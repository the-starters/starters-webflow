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
const millifySource = fs.readFileSync(require.resolve('../global-embeds/millify.js'), 'utf8')

/**
 * The REAL millify, not a stub.
 *
 * A stub of the shape `(input) => ({ok: true, text: ...})` ignores its options
 * argument, and that is exactly what let the repaint ship calling
 * `millify(value, {})`: millifyCore reads `units.length` unconditionally, so an
 * options object without `units` throws a TypeError for every value on earth.
 * The throw was swallowed and the raw number painted -- $1500 where the page
 * should read $1.5K. Driving the real module is the only stub-proof guard.
 */
function realMillify() {
  const context = {
    document: { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], body: null },
    console: { warn() {}, log() {} },
    Number, String, Math, Intl, parseFloat, isNaN,
  }
  context.window = context
  vm.createContext(context)
  vm.runInContext(millifySource, context)
  return context.__startersMillify
}
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
  // Real semantics, including `el.contains(el) === true`. The offering cap uses
  // this to drop the nested card the runtime call template wraps, so a fixture
  // without it silently sends the renderer down its catch branch instead.
  el.contains = (other) => {
    let node = other
    while (node) {
      if (node === el) return true
      node = node.parentElement
    }
    return false
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
  // Mirrors the authored select. 'Monthly retainer' is gated in the Designer by
  // element-visibility="Retainer Enabled" but is present in the DOM regardless,
  // which is why the retainer card can resolve it.
  serviceSelect.options = [
    { value: '', textContent: 'Select one...' },
    { value: 'Freelance work', textContent: 'Freelance work' },
    { value: 'Monthly retainer', textContent: 'Monthly retainer' },
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
    [retainerCard, 'Monthly retainer'],
    [cmsCard, 'asdf'],
  ]) {
    assert.equal(card.getAttribute('data-modal-trigger'), 'generate-contract', service)
    assert.equal(card.getAttribute('data-sp-fill'), 'button')
    // Byte-exact 'service': v3/project-form.js (the engine actually loaded on
    // /hire/<slug>) routes normalizedName(category) === 'service' to the form's
    // native Services field. 'Services' normalizes to 'services', misses that
    // route, and falls through to the tagged-helper lookup the native priority
    // exists to prevent.
    assert.equal(card.getAttribute('data-sp-fill-category'), 'service', service)
    for (const wrong of ['Services', 'services']) {
      assert.notEqual(
        card.getAttribute('data-sp-fill-category'),
        wrong,
        `${wrong} would normalize past the native Services route in project-form.js`,
      )
    }
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
  assert.equal(freeCard.getAttribute('data-sp-fill-category'), null)
  assert.equal(paidCard.getAttribute('data-sp-fill-category'), null)
})

test('a retainer falls back to Freelance work when the native retainer option is absent', async () => {
  // 'Monthly retainer' is gated by element-visibility="Retainer Enabled". If a
  // site ever ships without it, the retainer card must still open a contract
  // on the closest authored service rather than going inert: an approximate
  // service beats no contract at all, and the brand can correct it in the form.
  const page = makePage()
  const contractDialog = makeElement('dialog', { 'data-modal-target': 'generate-contract' })
  const serviceSelect = makeElement('select', { name: 'Services' })
  serviceSelect.options = [
    { value: '', textContent: 'Select one...' },
    { value: 'Freelance work', textContent: 'Freelance work' },
  ]
  contractDialog.appendChild(serviceSelect)
  page.root.appendChild(contractDialog)

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

  const retainerCard = page.servicesList.children.find(
    (card) => card.getAttribute('data-rate-card') === 'retainer',
  )
  assert.ok(retainerCard, 'the retainer card must still render')
  assert.equal(retainerCard.getAttribute('data-modal-trigger'), 'generate-contract')
  assert.equal(retainerCard.getAttribute('data-sp-fill-category'), 'service')
  assert.equal(
    retainerCard.getAttribute('data-sp-fill-value'),
    'Freelance work',
    'the retainer must fall back to the authored Freelance work option',
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

/* ---------------------------------- WAVE-1: canonical rate repaint --------- */

/** The generate-contract dialog, with the native Services select. */
function addContractDialog(page, options = ['', 'Freelance work', 'Monthly retainer']) {
  const dialog = makeElement('dialog', { 'data-modal-target': 'generate-contract' })
  const select = makeElement('select', { name: 'Services' })
  select.options = options.map((v) => ({ value: v, textContent: v }))
  dialog.appendChild(select)
  page.root.appendChild(dialog)
  return { dialog, select }
}

const BRAND_MEMBER = {
  id: 'brand_member',
  auth: { email: 'brand@example.com' },
  customFields: { 'free-user': 'Brand', 'last-name': 'Member' },
  planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
}

const FREE_CONFIG = {
  config_id: 'cfg_free',
  active: true,
  is_paid: false,
  data_environment: 'production',
  price_cents: 0,
  duration: 30,
}
const PAID_CONFIG = {
  config_id: 'cfg_paid',
  active: true,
  is_paid: true,
  data_environment: 'production',
  payment_environment: 'live',
  currency: 'USD',
  price_cents: 25000,
  duration: 60,
}


















test('2e: paid rate surfaces are repainted from the canonical Nylas price, not the CMS value', async () => {
  const page = makePage({ includeFreeCard: false })
  addContractDialog(page)

  // The CMS-bound markup says 250; the canonical config says 25000 cents.
  const paidCardPrice = page.servicesList.querySelector('[data-millify]')
  paidCardPrice.textContent = '250'
  const paidSurface = makeElement('div', { 'data-service-card': 'component', 'has-connection': 'paid' })
  const paidSurfacePrice = makeElement('span', { 'data-millify': '' })
  paidSurfacePrice.textContent = '250'
  paidSurface.appendChild(paidSurfacePrice)
  page.root.appendChild(paidSurface)

  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult', 'paid-call-rate': '150' },
    member: BRAND_MEMBER,
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
      getConfigs: async () => [PAID_CONFIG],
    },
    paidController: { installPaidBookingController: () => true },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paidSurfacePrice.getAttribute('data-millify'), '250', 'canonical 25000 cents = $250')
  assert.equal(paidSurfacePrice.textContent, '250')
  // [call-type-price] belongs to the Paid controller, which writes
  // canonicalPaidPrice at install (paid-call-brand-payment.js:1359) AFTER this
  // runs. A write here would be dead code and a second format of one number.
  assert.equal(
    page.paidModalPrice.textContent,
    '$50',
    'the repaint leaves the paid chooser price to its real owner',
  )
})

test('2e: the free chooser price is repainted to zero from the canonical config', async () => {
  const page = makePage()
  addContractDialog(page)
  page.freeModalOption.appendChild((() => {
    const el = makeElement('span', { 'call-type-price': '' })
    el.textContent = '$50'
    page.freeModalPrice = el
    return el
  })())

  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
      getConfigs: async () => [FREE_CONFIG],
      installFreeBookingController: () => true,
    },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.freeModalPrice.textContent, '$0')
})

test('2e: with no canonical configuration the CMS value is left alone as a cosmetic fallback', async () => {
  const page = makePage({ includeFreeCard: false })
  addContractDialog(page)
  const paidCardPrice = page.servicesList.querySelector('[data-millify]')
  paidCardPrice.textContent = '250'

  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    getStarterByMemberId: async () => null,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paidCardPrice.textContent, '250', 'no canonical source means no repaint')
  assert.equal(page.paidModalPrice.textContent, '$50')
})

test('2e: a repaint uses the shared millify formatter when the page provides one', async () => {
  const page = makePage({ includeFreeCard: false })
  addContractDialog(page)
  const paidSurface = makeElement('div', { 'data-service-card': 'component', 'has-connection': 'paid' })
  const paidSurfacePrice = makeElement('span', { 'data-millify': '', 'data-millify-raw': '250' })
  paidSurfacePrice.textContent = '250'
  paidSurface.appendChild(paidSurfacePrice)
  page.root.appendChild(paidSurface)

  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
      getConfigs: async () => [{ ...PAID_CONFIG, price_cents: 550000 }],
    },
    paidController: { installPaidBookingController: () => true },
  })
  context.__startersMillify = realMillify()
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paidSurfacePrice.textContent, '5.5K', 'the page formatter owns the display text')
  assert.equal(paidSurfacePrice.getAttribute('data-millify'), '5500')
  assert.equal(
    paidSurfacePrice.getAttribute('data-millify-raw'),
    null,
    'a stale raw value would make millify re-parse the formatted text',
  )
})

/* -- release marker -------------------------------------------------------- */

test('the file declares the release it ships in', () => {
  assert.match(source, /@release v\d+\.\d+\.\d+/)
})




/* ------------------------------- WAVE-1 next-slot paint-on-load (2f) ------- */

/**
 * The Designer sentinels Jerico is publishing. Nothing may leave one of these
 * on screen: the row now stays and must show real data (Q6 reversed).
 */
const SLOT_SENTINEL = '00:00pm on 00/00'
const PRICE_SENTINEL = '$00'

/** Adds the [next-available-slot] hooks production authors on the call cards. */
function addSlotHooks(page) {
  const hooks = {}
  const attach = (host, key) => {
    const el = makeElement('div', { 'next-available-slot': '' })
    el.textContent = SLOT_SENTINEL
    host.appendChild(el)
    hooks[key] = el
    return el
  }
  // Chooser rows (the two the recon found inside popup-booking-main).
  attach(page.freeModalOption, 'chooserFree')
  attach(page.paidModalOption, 'chooserPaid')
  // Service cards.
  const freeCard = makeElement('div', { 'data-service-card': 'component', 'data-type': 'free', 'has-connection': 'free' })
  const paidCard = makeElement('div', { 'data-service-card': 'component', 'data-type': 'paid', 'has-connection': 'paid' })
  page.servicesList.appendChild(freeCard)
  page.servicesList.appendChild(paidCard)
  attach(freeCard, 'cardFree')
  attach(paidCard, 'cardPaid')
  page.paidModalPrice.textContent = PRICE_SENTINEL
  return hooks
}

/**
 * The real module's formatter, pinned to UTC so the assertions pin the real
 * output shape without depending on the machine's timezone.
 */
function utcFormatWithTimezone(timestamp, formatOptions) {
  const date = new Date(timestamp)
  const formatter = new Intl.DateTimeFormat('en-US', Object.assign({
    weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit',
    minute: '2-digit', hour12: true, timeZoneName: 'short', timeZone: 'UTC',
  }, formatOptions || {}))
  const values = {}
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') values[part.type] = part.value
  })
  values.dayPeriod = String(values.dayPeriod || '').toUpperCase()
  return { default: '', list: values }
}

/** A booking controller whose availability answers are scripted per config. */
function slotController(slotsByConfig, calls) {
  return {
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
    getConfigs: async () => [FREE_CONFIG, PAID_CONFIG],
    installFreeBookingController: () => true,
    getNearestSlot: async (grantId, configId, nowMs) => {
      calls.push({ grantId, configId, nowMs })
      const answer = slotsByConfig[configId]
      if (answer instanceof Error) throw answer
      return answer
    },
    formatWithTimezone: utcFormatWithTimezone,
  }
}

// 2026-03-05T15:30:00Z
const SLOT_FREE = Math.floor(Date.UTC(2026, 2, 5, 15, 30) / 1000)
// 2026-03-06T09:00:00Z
const SLOT_PAID = Math.floor(Date.UTC(2026, 2, 6, 9, 0) / 1000)

function slotContext(page, controller, extra = {}) {
  return makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
    freeController: controller,
    paidController: { installPaidBookingController: () => true },
    ...extra,
  })
}

test('2f: both call cards paint their next slot on load, not only after Book Call', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const context = slotContext(page, slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, calls))
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(hooks.cardFree.textContent, '03:30PM on 03/05', 'free card painted on load')
  assert.equal(hooks.cardPaid.textContent, '09:00AM on 03/06', 'paid card painted on load')
})

test('2f: the chooser rows are painted from their own call type', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const context = slotContext(page, slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, calls))
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(hooks.chooserFree.textContent, '03:30PM on 03/05')
  assert.equal(hooks.chooserPaid.textContent, '09:00AM on 03/06')
})

test('2f: the new Designer sentinels are always overwritten', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const context = slotContext(page, slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, calls))
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  for (const [key, hook] of Object.entries(hooks)) {
    assert.notEqual(hook.textContent, SLOT_SENTINEL, `${key} must not keep the slot sentinel`)
  }
  // The paid chooser price is NOT this file's to write: the Paid controller
  // owns [call-type-price] and writes canonicalPaidPrice at install. In this
  // fixture that controller is a stub, so the sentinel legitimately survives.
  assert.equal(page.paidModalPrice.textContent, PRICE_SENTINEL)
})

test('2f: the writer goes through the shared getNearestSlot so the notice window applies', async () => {
  const page = makePage()
  addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const context = slotContext(page, slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, calls))
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  // The 24h production minimum lives inside free-call-booking's availabilityPath
  // and its slot filter. Reimplementing the fetch here would silently drop it,
  // so the contract is that this file only ever asks through that export.
  assert.deepEqual(
    calls.map((c) => c.configId).sort(),
    ['cfg_free', 'cfg_paid'],
    'one availability request per accepted configuration',
  )
  calls.forEach((c) => assert.equal(c.grantId, 'grant_1'))
  assert.equal(context.requestedUrls.length, 0, 'this file must not fetch availability itself')
})

test('2f: no available slot writes the no-slots copy instead of leaving a sentinel', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const context = slotContext(page, slotController({ cfg_free: null, cfg_paid: SLOT_PAID }, calls))
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(hooks.cardFree.textContent, 'No available slots')
  assert.equal(hooks.chooserFree.textContent, 'No available slots')
  assert.equal(hooks.cardPaid.textContent, '09:00AM on 03/06', 'paid is unaffected by the free result')
})

test('2f: an availability failure never leaves a sentinel on screen', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const context = slotContext(
    page,
    slotController({ cfg_free: new Error('availability 500'), cfg_paid: SLOT_PAID }, calls),
  )
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(hooks.cardFree.textContent, 'No available slots')
  assert.equal(hooks.cardFree.getAttribute('data-next-slot-state'), 'error')
  assert.equal(hooks.cardPaid.getAttribute('data-next-slot-state'), 'painted')
  assert.equal(hooks.cardPaid.textContent, '09:00AM on 03/06', 'one failure must not cost the other type')
})

test('2f: a profile with no canonical configuration paints nothing', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const controller = slotController({}, calls)
  // A grant exists but discovery accepts nothing, which is the case the
  // standing contract covers: no configuration means no availability request.
  controller.getConfigs = async () => []
  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    freeController: controller,
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(calls.length, 0, 'no configuration means no availability request')
  assert.equal(hooks.cardFree.textContent, SLOT_SENTINEL, 'nothing to paint means nothing is touched')
})

test('2f: a controller without getNearestSlot clears the sentinel instead of keeping it', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const controller = slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, [])
  delete controller.getNearestSlot
  const context = slotContext(page, controller)
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  await settle()
  // This test used to assert the sentinel SURVIVED, which locked in the exact
  // bug the writer exists to prevent and contradicted the wiring doc's promise
  // that a placeholder is never left standing.
  assert.equal(hooks.cardFree.textContent, 'No available slots')
  assert.equal(hooks.cardFree.getAttribute('data-next-slot-state'), 'error')
  assert.equal(hooks.cardPaid.textContent, 'No available slots')
})

test('2f: a missing Nylas grant leaves no sentinel a viewer can see', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const controller = slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, [])
  controller.getStarterByMemberId = async () => ({ nylas_grant_id: '', nylas_grant_email: '' })
  const context = slotContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  // The painter's own no-grant guard is belt-and-braces for a direct caller:
  // discovery never reaches it, because no grant means no accepted config and
  // syncCanonicalCallSurfaces([]) has already closed every call surface. The
  // sentinel survives in the DOM but on a card no viewer can see, which is the
  // contract that actually matters here.
  const freeCard = hooks.cardFree.parentElement
  assert.equal(freeCard.hasAttribute('data-canonical-call-unavailable'), true)
  assert.equal(freeCard.style.display, 'none')
})

test('2f: an uninstallable call type gets no availability request and keeps its hide', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const calls = []
  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    freeController: slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, calls),
    // Paid is accepted by canonical discovery but its controller cannot install.
    paidController: { installPaidBookingController: () => false },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.deepEqual(calls.map((c) => c.configId), ['cfg_free'], 'only the installed type is asked')
  assert.equal(hooks.cardFree.textContent, '03:30PM on 03/05')
  assert.equal(
    hooks.cardPaid.textContent,
    SLOT_SENTINEL,
    'an uninstallable Paid card stays structurally hidden, so its row is never painted',
  )
})

test('2f: 12/10-era sentinel remnants are overwritten as readily as the new ones', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  // Some profiles still carry the older placeholders. The writer must not care
  // which era a hook is from -- it always writes -- so mix both in one page.
  hooks.cardFree.textContent = '11:00PM on 12/10'
  hooks.chooserFree.textContent = '11:00pm on 12/10'
  hooks.chooserPaid.textContent = '00:00'
  page.paidModalPrice.textContent = '$50'
  const calls = []
  const context = slotContext(page, slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, calls))
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(hooks.cardFree.textContent, '03:30PM on 03/05')
  assert.equal(hooks.chooserFree.textContent, '03:30PM on 03/05')
  assert.equal(hooks.cardPaid.textContent, '09:00AM on 03/06')
  assert.equal(hooks.chooserPaid.textContent, '09:00AM on 03/06', 'a bare 00:00 remnant goes too')
})

test('the free chooser row survives: hide-free-when-paid is not in this bundle', async () => {
  const page = makePage()
  addContractDialog(page)
  // Jerico dropped the rule entirely (2026-08-27). A paid-toggled profile with
  // both call types installed must keep BOTH chooser rows.
  const context = makeContext({
    page,
    record: {
      rate: 0, 'retainer-enabled': false, 'profile-type': 'Full',
      'paid-consulting-calls-t-f': true,
    },
    member: BRAND_MEMBER,
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
      getConfigs: async () => [FREE_CONFIG, PAID_CONFIG],
      installFreeBookingController: () => true,
    },
    paidController: { installPaidBookingController: () => true },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(page.freeModalOption.hasAttribute('data-booking-unavailable'), false)
  assert.equal(page.paidModalOption.hasAttribute('data-booking-unavailable'), false)
  assert.equal(page.freeModalOption.style.display, 'block')
})

/* ---------------------------------- rate-paint fast-follow (v1.59.406) ----- */

/** A paid call card carrying one millify price hook, as production authors it. */
function addPaidCard(page, attrs = {}) {
  const card = makeElement('div', {
    'data-service-card': 'component', 'data-type': 'paid', 'has-connection': 'paid',
  })
  const price = makeElement('span', Object.assign({ 'data-millify': '' }, attrs))
  price.textContent = '250'
  card.appendChild(price)
  page.servicesList.appendChild(card)
  return { card, price }
}

function paidContext(page, config, extra = {}) {
  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
      getConfigs: async () => [config],
    },
    paidController: { installPaidBookingController: () => true },
    ...extra,
  })
  context.__startersMillify = realMillify()
  return context
}

test('rate paint: a four-figure rate renders millified, not as a raw number', async () => {
  const page = makePage({ includeFreeCard: false })
  const paid = addPaidCard(page)
  addContractDialog(page)
  // $1,500. Calling millify with {} threw on units.length for EVERY value, the
  // catch swallowed it, and this painted "1500".
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 150000 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paid.price.textContent, '1.5K')
  assert.equal(paid.price.getAttribute('data-millify'), '1500')
})

test('rate paint: authored data-millify-* options are honored', async () => {
  const page = makePage({ includeFreeCard: false })
  const paid = addPaidCard(page, { 'data-millify-precision': '2', 'data-millify-space': 'true' })
  addContractDialog(page)
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 152500 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paid.price.textContent, '1.52 K', 'precision 2 and the authored space')
})

test('rate paint: a value over data-millify-max is refused, not approximated', async () => {
  const page = makePage({ includeFreeCard: false })
  const paid = addPaidCard(page, { 'data-millify-max': '1000' })
  addContractDialog(page)
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 550000 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  // millify's contract is refuse-rather-than-approximate: the ceiling exists to
  // make bad data visible, so the authored text stands untouched.
  assert.equal(paid.price.textContent, '250')
  assert.ok(context.warnings.some((line) => line.includes('millify refused')))
})

test('rate paint: a repainted hook drops the authored ceiling', async () => {
  const page = makePage({ includeFreeCard: false })
  const paid = addPaidCard(page, { 'data-millify-max': '100000', 'data-millify-raw': '250' })
  addContractDialog(page)
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 550000 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paid.price.textContent, '5.5K')
  // The ceiling was sized for the CMS value. Left in place, a later re-process
  // fails('max') and reverts to the raw number.
  assert.equal(paid.price.getAttribute('data-millify-max'), null)
  assert.equal(paid.price.getAttribute('data-millify-raw'), null)
})

test('rate paint: odd cents keep both decimals, matching canonicalPaidPrice', async () => {
  const page = makePage({ includeFreeCard: false })
  const paid = addPaidCard(page)
  addContractDialog(page)
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 25050 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paid.price.getAttribute('data-millify'), '250.50')
})

test('rate paint: a free config with no price_cents still clears the chooser sentinel', async () => {
  const page = makePage()
  addContractDialog(page)
  page.paidModalPrice.textContent = '$00'
  const freePrice = makeElement('span', { 'call-type-price': '' })
  freePrice.textContent = '$00'
  page.freeModalOption.appendChild(freePrice)

  // selectBookableConfigurations deliberately admits a Free record with no
  // price_cents. Number(undefined) is NaN, which used to bail and leave $00 on
  // a VISIBLE free chooser row.
  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
      getConfigs: async () => [{ config_id: 'cfg_free', active: true, is_paid: false, data_environment: 'production' }],
      installFreeBookingController: () => true,
    },
  })
  context.__startersMillify = realMillify()
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(freePrice.textContent, '$0')
})

test('rate paint: a free config never overwrites an authored card rate with zero', async () => {
  const page = makePage()
  addContractDialog(page)
  const freeCard = makeElement('div', {
    'data-service-card': 'component', 'data-type': 'free', 'has-connection': 'free',
  })
  const freeCardPrice = makeElement('span', { 'data-millify': '' })
  freeCardPrice.textContent = '95'
  freeCard.appendChild(freeCardPrice)
  page.servicesList.appendChild(freeCard)

  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: BRAND_MEMBER,
    freeController: {
      getStarterByMemberId: async () => ({ nylas_grant_id: 'grant_1', nylas_grant_email: 's@x.com' }),
      getConfigs: async () => [FREE_CONFIG],
      installFreeBookingController: () => true,
    },
  })
  context.__startersMillify = realMillify()
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(freeCardPrice.textContent, '95', 'the chooser is the one intentional $0')
})

test('rate paint: only the anchored price hook is written, not every number', async () => {
  const page = makePage({ includeFreeCard: false })
  const card = makeElement('div', {
    'data-service-card': 'component', 'data-type': 'paid', 'has-connection': 'paid',
  })
  const price = makeElement('span', { 'data-millify': '' })
  price.textContent = '250'
  const duration = makeElement('span', { 'data-millify': '' })
  duration.textContent = '60'
  card.appendChild(price)
  card.appendChild(duration)
  page.servicesList.appendChild(card)
  addContractDialog(page)

  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 550000 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(price.textContent, '5.5K')
  assert.equal(duration.textContent, '60', 'a duration must never be painted with the price')
})

test('rate paint: a card inserted after discovery is painted by the observer', async () => {
  const page = makePage({ includeFreeCard: false })
  addPaidCard(page)
  addContractDialog(page)
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 550000 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  // Webflow can insert or clone hero call components after the initial scan;
  // the file already re-runs its card wiring for exactly that reason.
  const late = makeElement('div', {
    'data-service-card': 'component', 'data-type': 'paid', 'has-connection': 'paid',
  })
  const latePrice = makeElement('span', { 'data-millify': '' })
  latePrice.textContent = '250'
  const lateSlot = makeElement('div', { 'next-available-slot': '' })
  lateSlot.textContent = '00:00pm on 00/00'
  late.appendChild(latePrice)
  late.appendChild(lateSlot)
  page.servicesList.appendChild(late)

  context.mutationObserverCallbacks.forEach((cb) =>
    cb([{ type: 'childList', addedNodes: [late] }]))
  await settle()

  assert.equal(latePrice.textContent, '5.5K', 'a late card must not keep the stale CMS price')
  assert.notEqual(lateSlot.textContent, '00:00pm on 00/00', 'nor the slot sentinel')
})

test('rate paint: repainting an already-painted card is a byte-identical no-op', async () => {
  const page = makePage({ includeFreeCard: false })
  const paid = addPaidCard(page)
  addContractDialog(page)
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 550000 })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  const before = {
    text: paid.price.textContent,
    millify: paid.price.getAttribute('data-millify'),
  }
  context.mutationObserverCallbacks.forEach((cb) =>
    cb([{ type: 'childList', addedNodes: [paid.card] }]))
  await settle()

  assert.equal(paid.price.textContent, before.text)
  assert.equal(paid.price.getAttribute('data-millify'), before.millify)
})

test('rate paint: an accepted but uninstallable paid card is never priced', async () => {
  const page = makePage({ includeFreeCard: false })
  const paid = addPaidCard(page)
  addContractDialog(page)
  const context = paidContext(page, { ...PAID_CONFIG, price_cents: 550000 }, {
    paidController: { installPaidBookingController: () => false },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  // Showing a canonical price on a card nobody can book is one hide-regression
  // away from being visible, so both painters key on the INSTALLED set.
  assert.equal(paid.price.textContent, '250')
})

test('slot paint: a real slot that cannot be formatted is an error, not an empty calendar', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const controller = slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, [])
  // Version skew: an older controller exports getNearestSlot but no formatter.
  delete controller.formatWithTimezone
  delete controller.nextSlotText
  const context = slotContext(page, controller)
  delete context.formatWithTimezone
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(
    hooks.cardFree.getAttribute('data-next-slot-state'),
    'error',
    'calling this empty would send a reader to the wrong system entirely',
  )
})

/* ----------------------------------- WAVE-1 owner-path paint --------------- */

/**
 * The starter reading their OWN /hire page.
 *
 * `makeContext` publishes `starter_memberstack_id: 'mem_canary'`, so an owner
 * is exactly the member carrying that id and a non-owner talent is the same
 * member with any other one. That is the whole gate: the id this file feeds to
 * `getStarterByMemberId` is a Memberstack id, so the two sides of the
 * comparison live in one id space.
 */
const OWNER_MEMBER = {
  id: 'mem_canary',
  auth: { email: 'owner@example.com' },
  customFields: { 'free-user': 'Owner', 'last-name': 'Member' },
  planConnections: [{ planId: 'pln_dorxata-test-free-plan-dvcg0k8o', status: 'ACTIVE' }],
}

/** The same talent, on somebody else's profile. */
const OTHER_TALENT_MEMBER = Object.assign({}, OWNER_MEMBER, { id: 'mem_a_different_starter' })

const OWNER_FREE_SETTINGS_PATH = '/starter/free-call-settings/get/v3'
const OWNER_PAID_SETTINGS_PATH = '/starter/paid-call-settings/get/v3'

/** The shapes the two settings endpoints actually return. */
function ownerFreeSettings(overrides = {}) {
  return Object.assign({
    data_environment: 'production',
    public_description: 'A free intro call',
    readiness: {
      calendar_connected: true,
      availability_configured: true,
      free_call_enabled: true,
      bookable: true,
    },
    services: [{
      config_id: 'cfg_owner_free',
      grant_id: 'grant_owner',
      title: 'Free Call',
      duration: 30,
      active: true,
      revision: 3,
      sync_status: 'synced',
      updated_at: 1770000000000,
      price_cents: 0,
    }],
  }, overrides)
}

function ownerPaidSettings(overrides = {}) {
  return Object.assign({
    stripe_environment: 'live',
    readiness: {
      calendar_connected: true,
      availability_configured: true,
      paid_call_enabled: true,
      bookable: true,
    },
    services: [{
      config_id: 'cfg_owner_paid',
      title: 'Paid Consulting Call',
      price_cents: 25000,
      currency: 'USD',
      duration: 60,
      active: true,
      revision: 5,
      sync_status: 'synced',
      updated_at: 1770000000000,
      payment_environment: 'live',
    }],
  }, overrides)
}

/**
 * A booking controller with the owner path's whole surface: the starter
 * lookup, the shared authenticated bridge the settings reads go through, and
 * scripted availability. Every settings request is recorded, so "a non-owner
 * asks for nothing" is a countable assertion rather than an inference.
 */
function ownerController({
  free = ownerFreeSettings(),
  paid = ownerPaidSettings(),
  slots = {},
  requests = [],
  calls = [],
  grantId = 'grant_owner',
} = {}) {
  return {
    requests,
    calls,
    getStarterByMemberId: async () => ({
      nylas_grant_id: grantId,
      nylas_grant_email: 'owner@example.com',
    }),
    // The booking controller's own export. Reusing it is what keeps the owner
    // path on one auth stack instead of two.
    authenticatedRequest: async (path, method) => {
      requests.push({ path, method })
      const answer = path === OWNER_FREE_SETTINGS_PATH
        ? free
        : path === OWNER_PAID_SETTINGS_PATH
          ? paid
          : new Error('unexpected path ' + path)
      if (answer instanceof Error) throw answer
      return answer
    },
    getNearestSlot: async (grant, configId, nowMs) => {
      calls.push({ grantId: grant, configId, nowMs })
      const answer = slots[configId]
      if (answer instanceof Error) throw answer
      return answer === undefined ? null : answer
    },
    formatWithTimezone: utcFormatWithTimezone,
  }
}

function ownerContext(page, controller, extra = {}) {
  return makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    member: OWNER_MEMBER,
    freeController: controller,
    ...extra,
  })
}

/** A `[call-type-price]` on the free chooser row, as production authors it. */
function addFreeChooserPrice(page) {
  const el = makeElement('span', { 'call-type-price': '' })
  el.textContent = PRICE_SENTINEL
  page.freeModalOption.appendChild(el)
  return el
}

/** A paid card carrying the CMS-bound price hook. */
function addPaidPriceSurface(page, cmsText = '999') {
  const surface = makeElement('div', { 'data-service-card': 'component', 'has-connection': 'paid' })
  const price = makeElement('span', { 'data-millify': '', 'data-millify-raw': cmsText })
  price.textContent = cmsText
  surface.appendChild(price)
  page.root.appendChild(surface)
  return price
}

/**
 * Everything about a node a viewer could notice, for the non-owner
 * byte-identical check. Attributes are sorted so key order cannot make two
 * equivalent trees compare unequal.
 */
function snapshotDom(node) {
  const attributes = Object.keys(node.attributes).sort()
    .map((name) => name + '=' + node.attributes[name])
    .join('|')
  return [
    node.tag,
    attributes,
    node.classes.join(' '),
    node.style.display === undefined ? '' : node.style.display,
    node.children.length ? '' : node.textContent,
  ].join('~') + '{' + node.children.map(snapshotDom).join(',') + '}'
}

test('owner paint: the owner sees canonical rates, not the CMS value', async () => {
  const page = makePage()
  addContractDialog(page)
  const chooserFreePrice = addFreeChooserPrice(page)
  const paidPrice = addPaidPriceSurface(page)

  const context = ownerContext(page, ownerController())
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paidPrice.textContent, '250', 'the CMS said 999; canonical 25000 cents = $250')
  assert.equal(paidPrice.getAttribute('data-millify'), '250')
  assert.equal(
    paidPrice.getAttribute('data-millify-raw'),
    null,
    'a stale raw value would make millify re-parse the formatted text',
  )
  assert.equal(chooserFreePrice.textContent, '$0', 'the free chooser row is the one intentional $0')
})

test('owner paint: the owner rate goes through the real shared millify', async () => {
  const page = makePage()
  addContractDialog(page)
  const paidPrice = addPaidPriceSurface(page)

  const context = ownerContext(page, ownerController({
    paid: ownerPaidSettings({
      services: [Object.assign(ownerPaidSettings().services[0], { price_cents: 550000 })],
    }),
  }))
  context.__startersMillify = realMillify()
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paidPrice.textContent, '5.5K', 'the page formatter owns the display text')
  assert.equal(paidPrice.getAttribute('data-millify'), '5500')
})

test('owner paint: both slot rows are painted from the owner configurations', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const controller = ownerController({
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(hooks.cardFree.textContent, '03:30PM on 03/05')
  assert.equal(hooks.cardFree.getAttribute('data-next-slot-state'), 'painted')
  assert.equal(hooks.cardPaid.textContent, '09:00AM on 03/06')
  assert.equal(hooks.cardPaid.getAttribute('data-next-slot-state'), 'painted')
  assert.equal(hooks.chooserFree.textContent, '03:30PM on 03/05')
  assert.equal(hooks.chooserPaid.textContent, '09:00AM on 03/06')
  // The 24h production minimum lives inside the controller's own availability
  // path and slot filter, so the owner path asks through the same export.
  assert.deepEqual(
    controller.calls.map((c) => c.configId).sort(),
    ['cfg_owner_free', 'cfg_owner_paid'],
  )
  controller.calls.forEach((c) => assert.equal(c.grantId, 'grant_owner'))
  assert.equal(context.requestedUrls.length, 0, 'the owner path must not fetch anything itself')
})

test('owner paint: the settings endpoints are the only owner source, asked once each', async () => {
  const page = makePage()
  addSlotHooks(page)
  addContractDialog(page)
  const controller = ownerController({
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.deepEqual(
    controller.requests.map((r) => r.path).sort(),
    [OWNER_FREE_SETTINGS_PATH, OWNER_PAID_SETTINGS_PATH],
  )
  controller.requests.forEach((r) => assert.equal(r.method, 'GET'))
  // get_bookable/v3 hard-rejects a non-brand ("Brand membership is required"),
  // so reaching for it on this path would fail every owner by construction.
  assert.ok(
    !controller.requests.some((r) => String(r.path).includes('nylas_configurations')),
    'the owner path must not touch the brand-gated configuration endpoint',
  )
})

test('owner paint: an unbookable readiness asks for no availability and leaves the row alone', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const paidPrice = addPaidPriceSurface(page)
  const controller = ownerController({
    free: ownerFreeSettings({
      readiness: {
        calendar_connected: true,
        availability_configured: false,
        free_call_enabled: true,
        bookable: false,
      },
    }),
    paid: ownerPaidSettings({
      readiness: {
        calendar_connected: true,
        availability_configured: false,
        paid_call_enabled: true,
        bookable: false,
      },
    }),
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(controller.calls.length, 0, 'an unbookable service is never asked for availability')
  assert.equal(hooks.cardFree.textContent, SLOT_SENTINEL, 'the authored row is left exactly as found')
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL)
  assert.equal(hooks.cardFree.getAttribute('data-next-slot-state'), null)
  assert.equal(paidPrice.textContent, '999', 'an unbookable service earns no rate paint either')
})

test('owner paint: a rejected settings lookup leaves the rows alone and the reveal still ran', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const paidPrice = addPaidPriceSurface(page)
  const controller = ownerController({
    free: Object.assign(new Error('free-call-settings failed (403)'), { status: 403 }),
    paid: Object.assign(new Error('paid-call-settings failed (500)'), { status: 500 }),
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  await settle()

  assert.equal(hooks.cardFree.textContent, SLOT_SENTINEL, 'never "No available slots" for the owner')
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL)
  assert.equal(paidPrice.textContent, '999')
  assert.equal(controller.calls.length, 0)
  // The reveal is the thing the owner actually came for, and it completed.
  assert.equal(page.servicesList.children[0].style.display, 'block')
  assert.equal(context.emptyNavRefreshCalls.length >= 1, true)
  assert.ok(
    context.warnings.some((l) => l.includes('owner free-call settings lookup failed')),
    'each failing endpoint says so once: ' + JSON.stringify(context.warnings),
  )
})

test('owner paint: one failing endpoint does not cost the other its paint', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const paidPrice = addPaidPriceSurface(page)
  const controller = ownerController({
    paid: new Error('paid-call-settings failed (500)'),
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(hooks.cardFree.textContent, '03:30PM on 03/05', 'free still paints')
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL, 'paid is left exactly as found')
  assert.equal(paidPrice.textContent, '999')
  assert.deepEqual(controller.calls.map((c) => c.configId), ['cfg_owner_free'])
})

test('owner paint: an empty calendar never writes the no-slots copy over the owner row', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const controller = ownerController({
    slots: { cfg_owner_free: null, cfg_owner_paid: new Error('availability 500') },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  // The owner is the one viewer who can tell an empty calendar from a broken
  // lookup, and "No available slots" on their own profile sends them to fix
  // availability settings that may be perfectly correct.
  assert.equal(hooks.cardFree.textContent, SLOT_SENTINEL)
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL)
  assert.equal(hooks.chooserFree.textContent, SLOT_SENTINEL)
})

test('owner paint: a controller with no availability export leaves every owner row alone', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const controller = ownerController()
  delete controller.getNearestSlot

  const context = ownerContext(page, controller)
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  await settle()

  assert.equal(hooks.cardFree.textContent, SLOT_SENTINEL)
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL)
})

test('owner paint: a controller with no authenticated bridge stands down quietly', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const paidPrice = addPaidPriceSurface(page)
  const controller = ownerController()
  delete controller.authenticatedRequest

  const context = ownerContext(page, controller)
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  await settle()

  assert.equal(hooks.cardFree.textContent, SLOT_SENTINEL)
  assert.equal(paidPrice.textContent, '999')
  assert.equal(page.servicesList.children[0].style.display, 'block', 'the reveal is untouched')
})

test('owner paint: more than one active service is a support case, not a guess', async () => {
  const page = makePage()
  addContractDialog(page)
  const paidPrice = addPaidPriceSurface(page)
  const base = ownerPaidSettings().services[0]
  const controller = ownerController({
    paid: ownerPaidSettings({
      services: [
        base,
        Object.assign({}, base, { config_id: 'cfg_owner_paid_2', price_cents: 99900 }),
      ],
    }),
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paidPrice.textContent, '999', 'painting one at random would put an unagreed number on screen')
  assert.ok(
    context.warnings.some((l) => l.includes('multiple active paid-call services')),
    'expected a reconciliation warning, got: ' + JSON.stringify(context.warnings),
  )
})

test('owner paint: an inactive service is never painted', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const paidPrice = addPaidPriceSurface(page)
  const controller = ownerController({
    paid: ownerPaidSettings({
      services: [Object.assign(ownerPaidSettings().services[0], { active: false })],
    }),
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(paidPrice.textContent, '999')
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL)
  assert.equal(hooks.cardFree.textContent, '03:30PM on 03/05', 'free is unaffected')
})

test('owner paint: a settings grant that disagrees with the starter record is reported, not used', async () => {
  const page = makePage()
  addSlotHooks(page)
  addContractDialog(page)
  const controller = ownerController({
    free: ownerFreeSettings({
      services: [Object.assign(ownerFreeSettings().services[0], { grant_id: 'grant_stale' })],
    }),
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller)
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  controller.calls.forEach((c) => assert.equal(c.grantId, 'grant_owner', 'the starter record wins'))
  assert.ok(
    context.warnings.some((l) => l.includes('grant does not match the starter record')),
    'expected a mismatch warning, got: ' + JSON.stringify(context.warnings),
  )
})

test('owner paint: a talent on someone else profile asks for nothing and paints nothing', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const chooserFreePrice = addFreeChooserPrice(page)
  const paidPrice = addPaidPriceSurface(page)
  const controller = ownerController({
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })

  const context = ownerContext(page, controller, { member: OTHER_TALENT_MEMBER })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(controller.requests.length, 0, 'no settings request for a viewer who is not the owner')
  assert.equal(controller.calls.length, 0, 'no availability request either')
  assert.equal(hooks.cardFree.textContent, SLOT_SENTINEL)
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL)
  assert.equal(chooserFreePrice.textContent, PRICE_SENTINEL)
  assert.equal(paidPrice.textContent, '999')
})

test('owner paint: a non-owner talent gets byte-identical reveal behaviour', async () => {
  // Run the same page twice for a talent who is NOT the owner: once against a
  // controller that CAN do the owner path, and once against the pre-change
  // capability set (no authenticated bridge, no availability export). If the
  // owner gate holds, the two DOMs are indistinguishable.
  const run = (controller) => {
    const page = makePage()
    addSlotHooks(page)
    addContractDialog(page)
    addFreeChooserPrice(page)
    addPaidPriceSurface(page)
    const context = ownerContext(page, controller, { member: OTHER_TALENT_MEMBER })
    vm.createContext(context)
    vm.runInContext(source, context)
    return { page, context }
  }

  const capable = run(ownerController({
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  }))
  const legacy = run((() => {
    const controller = ownerController()
    delete controller.authenticatedRequest
    delete controller.getNearestSlot
    return controller
  })())
  await settle()

  assert.equal(
    snapshotDom(capable.page.root),
    snapshotDom(legacy.page.root),
    'the owner paint must be invisible to every viewer who is not the owner',
  )
  assert.deepEqual(capable.context.warnings, legacy.context.warnings)
})

test('owner paint: a signed-in Brand still uses canonical discovery, not the settings endpoints', async () => {
  const page = makePage()
  addSlotHooks(page)
  addContractDialog(page)
  const requests = []
  const calls = []
  const controller = slotController({ cfg_free: SLOT_FREE, cfg_paid: SLOT_PAID }, calls)
  controller.authenticatedRequest = async (path, method) => {
    requests.push({ path, method })
    return null
  }

  const context = makeContext({
    page,
    record: { rate: 0, 'retainer-enabled': false, 'profile-type': 'Consult' },
    // A brand whose Memberstack id happens to equal the profile owner's is not
    // a real account state, but it proves the gate is the id AND the role.
    member: Object.assign({}, BRAND_MEMBER, { id: 'mem_canary' }),
    freeController: controller,
    paidController: { installPaidBookingController: () => true },
  })
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()

  assert.equal(requests.length, 0, 'a brand never reaches the owner settings path')
  assert.deepEqual(calls.map((c) => c.configId).sort(), ['cfg_free', 'cfg_paid'])
})

/* -------------------- WAVE-1 owner-path paint: admission gates ------------- */

/**
 * The owner runs the SAME admission rules as every brand viewer.
 *
 * `readiness.bookable` says the starter finished setting the service up; it
 * does not say the service is shaped like something anybody could book. A
 * half-configured record that reaches only the owner's screen is the worst
 * kind, because the owner has no second view to notice it against.
 */
function ownerFreeService(overrides = {}) {
  return Object.assign({}, ownerFreeSettings().services[0], overrides)
}
function ownerPaidService(overrides = {}) {
  return Object.assign({}, ownerPaidSettings().services[0], overrides)
}

/** Runs the owner path and hands back the surfaces the gates decide about. */
async function runOwnerGate({ free, paid, slots = {}, location } = {}) {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const chooserFreePrice = addFreeChooserPrice(page)
  const paidPrice = addPaidPriceSurface(page)
  const controller = ownerController({
    free: free === undefined ? ownerFreeSettings() : free,
    paid: paid === undefined ? ownerPaidSettings() : paid,
    slots: Object.assign({ cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID }, slots),
  })
  const context = ownerContext(page, controller, location ? { location } : {})
  vm.createContext(context)
  vm.runInContext(source, context)
  await settle()
  return { page, hooks, chooserFreePrice, paidPrice, controller, context }
}

test('owner gate: a free service priced above zero is never painted', async () => {
  const run = await runOwnerGate({
    free: ownerFreeSettings({ services: [ownerFreeService({ price_cents: 5000 })] }),
  })

  // A "free" call quoted at $50 is exactly what the brand admission rule
  // exists to refuse, and the owner must not be the one viewer who sees it.
  assert.equal(run.chooserFreePrice.textContent, PRICE_SENTINEL)
  assert.equal(run.hooks.cardFree.textContent, SLOT_SENTINEL)
  assert.deepEqual(run.controller.calls.map((c) => c.configId), ['cfg_owner_paid'])
  assert.ok(
    run.context.warnings.some((l) => l.includes('owner free-call service did not pass')),
    'expected an admission warning, got: ' + JSON.stringify(run.context.warnings),
  )
})

test('owner gate: a free service of the wrong length is never painted', async () => {
  const run = await runOwnerGate({
    free: ownerFreeSettings({ services: [ownerFreeService({ duration: 45 })] }),
  })

  assert.equal(run.chooserFreePrice.textContent, PRICE_SENTINEL)
  assert.deepEqual(run.controller.calls.map((c) => c.configId), ['cfg_owner_paid'])
})

test('owner gate: a cross-environment settings record is never painted', async () => {
  // The host is production; the payload reports the test data environment.
  const run = await runOwnerGate({
    free: ownerFreeSettings({ data_environment: 'test' }),
    paid: ownerPaidSettings({ services: [ownerPaidService({ payment_environment: 'test' })] }),
  })

  assert.equal(run.chooserFreePrice.textContent, PRICE_SENTINEL)
  assert.equal(run.paidPrice.textContent, '999')
  assert.equal(run.controller.calls.length, 0, 'a cross-environment record earns no availability request')
})

test('owner gate: a paid service in another currency is never painted', async () => {
  const run = await runOwnerGate({
    paid: ownerPaidSettings({ services: [ownerPaidService({ currency: 'EUR' })] }),
  })

  assert.equal(run.paidPrice.textContent, '999')
  assert.deepEqual(run.controller.calls.map((c) => c.configId), ['cfg_owner_free'])
})

test('owner gate: a paid service below the minimum charge is never painted', async () => {
  const run = await runOwnerGate({
    paid: ownerPaidSettings({ services: [ownerPaidService({ price_cents: 50 })] }),
  })

  assert.equal(run.paidPrice.textContent, '999')
  assert.deepEqual(run.controller.calls.map((c) => c.configId), ['cfg_owner_free'])
})

test('owner gate: an unknown host paints nothing at all', async () => {
  const run = await runOwnerGate({
    location: { hostname: 'localhost', pathname: '/hire/ashna-rana' },
  })

  assert.equal(run.chooserFreePrice.textContent, PRICE_SENTINEL)
  assert.equal(run.paidPrice.textContent, '999')
  assert.equal(run.controller.calls.length, 0)
})

test('owner gate: the staging host admits the staging environments', async () => {
  const run = await runOwnerGate({
    location: { hostname: 'the-starters-3-0.webflow.io', pathname: '/hire/ashna-rana' },
    free: ownerFreeSettings({ data_environment: 'test' }),
    paid: ownerPaidSettings({
      stripe_environment: 'test',
      services: [ownerPaidService({ payment_environment: 'test' })],
    }),
  })

  assert.equal(run.chooserFreePrice.textContent, '$0')
  assert.equal(run.paidPrice.textContent, '250')
  assert.deepEqual(
    run.controller.calls.map((c) => c.configId).sort(),
    ['cfg_owner_free', 'cfg_owner_paid'],
  )
})

test('owner gate: a service that names its length duration_minutes is honored', async () => {
  // Paid is the load-bearing case: its rule demands exactly 60 with no
  // null tolerance, so reading only `duration` would reject the record.
  const service = ownerPaidService({ duration_minutes: 60 })
  delete service.duration
  const run = await runOwnerGate({ paid: ownerPaidSettings({ services: [service] }) })

  assert.equal(run.paidPrice.textContent, '250')
  assert.equal(run.hooks.cardPaid.textContent, '09:00AM on 03/06')
})

test('owner gate: a paid service reads its environment from the payload when absent', async () => {
  const service = ownerPaidService()
  delete service.payment_environment
  const run = await runOwnerGate({
    paid: ownerPaidSettings({ stripe_environment: 'live', services: [service] }),
  })

  assert.equal(run.paidPrice.textContent, '250')
})

test('owner paint: a bridge that throws synchronously costs one call type, not both', async () => {
  const page = makePage()
  const hooks = addSlotHooks(page)
  addContractDialog(page)
  const chooserFreePrice = addFreeChooserPrice(page)
  const controller = ownerController({
    slots: { cfg_owner_free: SLOT_FREE, cfg_owner_paid: SLOT_PAID },
  })
  const authenticated = controller.authenticatedRequest
  controller.authenticatedRequest = (path, method) => {
    // An unavailable xanoAuthFetch is raised this way, before any promise
    // exists to attach a rejection handler to.
    if (path === OWNER_PAID_SETTINGS_PATH) throw new Error('xanoAuthFetch is unavailable')
    return authenticated(path, method)
  }

  const context = ownerContext(page, controller)
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  await settle()

  assert.equal(chooserFreePrice.textContent, '$0', 'the free paint survives the paid throw')
  assert.equal(hooks.cardFree.textContent, '03:30PM on 03/05')
  assert.equal(hooks.cardPaid.textContent, SLOT_SENTINEL)
})
