const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'relaunch-pricing-preview.js'), 'utf8')
const loaderSource = fs.readFileSync(
  path.join(__dirname, '..', 'navbar-embeds', 'memberstack', 'free-paid-anon.js'),
  'utf8',
)

const STAGING = 'the-starters-3-0.webflow.io'
const PRICE = 'data-ms-price:add'

// Minimal DOM: attributes, children, textContent, and the selector shapes the
// module uses: `*`, `[name]`, `[name="value"]`, with `\:` escapes in names.
// Text nodes expose nodeType 3 and nodeValue, like the DOM.
const textNode = (value) => ({ nodeType: 3, nodeValue: String(value) })

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = 1
    this.tagName = tag.toUpperCase()
    this.attrs = Object.assign({}, attrs)
    this.style = {}
    this.parentNode = null
    // childNodes keeps text and element children in order, like the DOM;
    // `children` holds elements only.
    this.childNodes = children.map((child) =>
      typeof child === 'string' ? textNode(child) : child,
    )
    this.childNodes.forEach((child) => {
      if (child instanceof Element) child.parentNode = this
    })
    const el = this
    this.classList = {
      contains: (name) => String(el.attrs.class || '').split(/\s+/).includes(name),
      add: (name) => {
        if (!el.classList.contains(name)) el.attrs.class = (String(el.attrs.class || '') + ' ' + name).trim()
      },
      remove: (name) => {
        el.attrs.class = String(el.attrs.class || '')
          .split(/\s+/)
          .filter((c) => c && c !== name)
          .join(' ')
      },
    }
  }
  get nextSibling() {
    if (!this.parentNode) return null
    const siblings = this.parentNode.childNodes
    return siblings[siblings.indexOf(this) + 1] || null
  }
  cloneNode(deep) {
    const copy = new Element(
      this.tagName,
      this.attrs,
      deep
        ? this.childNodes.map((child) => (child instanceof Element ? child.cloneNode(true) : child.nodeValue))
        : [],
    )
    copy.style = Object.assign({}, this.style)
    return copy
  }
  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node)
    const index = reference ? this.childNodes.indexOf(reference) : -1
    if (index === -1) this.childNodes.push(node)
    else this.childNodes.splice(index, 0, node)
    node.parentNode = this
    return node
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter((child) => child !== node)
    node.parentNode = null
    return node
  }
  removeAttribute(name) {
    delete this.attrs[name]
  }
  get children() {
    return this.childNodes.filter((child) => child instanceof Element)
  }
  get textContent() {
    return this.childNodes
      .map((child) => (child instanceof Element ? child.textContent : child.nodeValue))
      .join('')
  }
  set textContent(value) {
    this.childNodes = [textNode(value)]
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }
  descendants() {
    const out = []
    const walk = (node) =>
      node.children.forEach((child) => {
        out.push(child)
        walk(child)
      })
    walk(this)
    return out
  }
  querySelectorAll(selector) {
    if (selector === '*') return this.descendants()
    const m = /^\[((?:[\w-]|\\:)+)(?:="([^"]*)")?\]$/.exec(selector)
    if (!m) throw new Error('unsupported selector: ' + selector)
    const name = m[1].replace('\\:', ':')
    return this.descendants().filter((el) => {
      const value = el.getAttribute(name)
      return value !== null && (m[2] === undefined || value === m[2])
    })
  }
}

const h = (tag, attrs, children) => new Element(tag, attrs || {}, children || [])

function button(label, attrs = {}) {
  return h('div', Object.assign({ class: 'button_main-wrap' }, attrs), [
    h('div', { class: 'clickable_wrap' }, [h('button', { class: 'clickable_btn' }, [])]),
    h('div', { class: 'button_main-element' }, [
      h('div', { class: 'button_main-text' }, [label]),
      h('div', { class: 'button_main-line' }, []),
      h('div', { 'data-button-spinner': '', 'aria-hidden': 'true' }, [h('svg', {}, [h('path', {}, [])])]),
      h('div', { class: 'button_main-icon' }, [h('svg', {}, [h('path', {}, [])])]),
    ]),
  ])
}

// Same structure as the live Join CTA (section and both modals).
function joinCta(overrides = {}) {
  const monthlyLabel = overrides.monthlyLabel || 'Get started for $295/month'
  return h('div', { 'join-cta-wrapper': '' }, [
    h('div', { 'join-cta-tabs': 'wrapper' }, [
      h('button', { 'join-cta-tabs': 'monthly' }, [h('div', {}, ['Monthly'])]),
      h('button', { 'join-cta-tabs': 'yearly' }, [
        h('div', {}, ['Yearly ', h('span', { class: 'join-cta_tab-yearly-text' }, ['(Save $1,200)'])]),
      ]),
    ]),
    h('div', { 'join-cta': 'monthly' }, [
      h('div', {}, [
        button(monthlyLabel, { [PRICE]: 'prc_premium-monthly--fn1ae0qjj', 'data-ms-content': 'members' }),
        button(monthlyLabel, { 'data-ms-content': '!members' }),
      ]),
      h('p', {}, ['Cancel anytime.']),
    ]),
    h('div', { 'join-cta': 'yearly' }, [
      h('div', {}, [
        button('Get started for $195/mo', { [PRICE]: 'prc_paid-annual-2o5f040u' }),
        button('Get started for $195/mo billed annually', {}),
      ]),
      h('p', {}, ['Billed annually at $2,340/year.']),
    ]),
  ])
}

const FAQ_LIVE =
  'Membership is $295/month, or $195/month billed annually at $2,340/year. The annual plan saves $1,200 per year compared with paying monthly.'
const FAQ_RELAUNCH =
  'Membership is $495/month, or $295/month billed annually at $3,540/year. The annual plan saves $2,400 per year compared with paying monthly.'
const COST_LIVE = '$295/mo or $195/mo billed annually ($2,340/year), plus freelancer rate'
const COST_RELAUNCH = '$495/mo or $295/mo billed annually ($3,540/year), plus freelancer rate'
const PAYWALL_LIVE =
  'Get unlimited access to The Starters\u2019 exclusive reporting and ad-free intelligence. Membership is $295/month, or $195/month billed annually at $2,340/year.'
const PAYWALL_RELAUNCH =
  'Get unlimited access to The Starters\u2019 exclusive reporting and ad-free intelligence. Membership is $495/month, or $295/month billed annually at $3,540/year.'
const WHY_LIVE = ['$195', 'Per month, billed annually at $2,340/year.']
const WHY_RELAUNCH = ['$295', 'Per month when billed annually at $3,540/year. Or $495 month to month.']

// FAQ answer, Competitors cost cell, and Why Us price pair, as published.
function pageCopy(faq, cost, why) {
  return h('div', {}, [
    h('div', { 'data-accordion': 'content-wrap' }, [h('div', {}, [h('p', {}, [faq])])]),
    h('table', {}, [h('tr', {}, [h('td', {}, [h('p', {}, ['Cost']), h('p', {}, [cost])])])]),
    h('div', { class: 'why-comparison_price-wrapper' }, [h('p', {}, [why[0]]), h('p', {}, [why[1]])]),
  ])
}
const livePageCopy = () => pageCopy(FAQ_LIVE, COST_LIVE, WHY_LIVE)
const relaunchPageCopy = () => pageCopy(FAQ_RELAUNCH, COST_RELAUNCH, WHY_RELAUNCH)

function run(hostname, root, extra = {}) {
  const document = Object.assign(
    {
      readyState: 'complete',
      body: root,
      querySelectorAll: (selector) => root.querySelectorAll(selector),
      addEventListener() {},
    },
    extra.document || {},
  )
  const location = Object.assign({ hostname }, extra.location || {})
  const window = Object.assign({ location, document }, extra.window || {})
  vm.runInNewContext(extra.source || source, { window, Object, Array, String })
  return window
}

function texts(root) {
  return root
    .descendants()
    .filter((el) => el.children.length === 0 && el.textContent)
    .map((el) => el.textContent)
}

function yearlyTabText(root) {
  return root.querySelectorAll('[join-cta-tabs="yearly"]').map((el) => el.textContent)
}

function prices(root) {
  return root.querySelectorAll('[data-ms-price\\:add]').map((el) => el.getAttribute(PRICE))
}

test('staging host shows the relaunch offer and relaunch price IDs', () => {
  const root = h('body', {}, [joinCta()])
  const window = run(STAGING, root)

  assert.deepEqual(prices(root), [
    'prc_3-0-premium-monthly-ge4a00iw',
    'prc_3-0-premium-annual-xhb200bu',
  ])
  assert.deepEqual(texts(root), [
    'Monthly',
    '(Save $2,400)',
    '7 Day Trial for $1',
    '7 Day Trial for $1',
    '$495/mo after. Cancel anytime.',
    'Get started for $295/mo',
    'Get started for $295/mo billed annually',
    'Billed annually at $3,540/year.',
  ])
  assert.deepEqual(yearlyTabText(root), ['Yearly (Save $2,400)'])
  assert.equal(typeof window.StartersRelaunchPricingPreview.apply, 'function')
})

for (const hostname of ['www.thestarters.com', 'thestarters.com', 'localhost', '']) {
  test(`host "${hostname}" keeps live prices and copy unchanged`, () => {
    const root = h('body', {}, [joinCta(), livePageCopy()])
    const before = { prices: prices(root), texts: texts(root) }
    const window = run(hostname, root)

    assert.deepEqual(prices(root), before.prices)
    assert.deepEqual(texts(root), before.texts)
    assert.deepEqual(
      JSON.parse(JSON.stringify(window.StartersRelaunchPricingPreview.apply(root))),
      { prices: 0, labels: 0 },
    )
  })
}

for (const hostname of ['localhost', '', 'the-starters-3-0.webflow.io.evil.test']) {
  test(`host "${hostname}" does not boot`, () => {
    const window = run(hostname, h('body', {}, []))
    assert.equal(window.StartersRelaunchPricingPreview.boot(), false)
    assert.equal(window.StartersRelaunchPricingPreview.mode(), '')
  })
}

test('staging host shows relaunch copy in the FAQ, Competitors cost, and Why Us price', () => {
  const root = h('body', {}, [livePageCopy()])
  const window = run(STAGING, root)

  assert.deepEqual(texts(root), [FAQ_RELAUNCH, 'Cost', COST_RELAUNCH, ...WHY_RELAUNCH])
  assert.equal(window.StartersRelaunchPricingPreview.mode(), 'preview')
})

for (const hostname of ['www.thestarters.com', 'thestarters.com']) {
  test(`production host "${hostname}" turns leaked relaunch copy back to live copy`, () => {
    const leaked = h('body', {}, [relaunchPageCopy()])
    const window = run(hostname, leaked)

    assert.deepEqual(texts(leaked), [FAQ_LIVE, 'Cost', COST_LIVE, ...WHY_LIVE])
    assert.equal(window.StartersRelaunchPricingPreview.mode(), 'guard')
  })

  test(`production host "${hostname}" turns leaked Join CTA copy back but never changes price IDs`, () => {
    const root = h('body', {}, [joinCta()])
    run(STAGING, root)
    const relaunchPrices = prices(root)
    run(hostname, root)

    assert.deepEqual(prices(root), relaunchPrices)
    assert.deepEqual(texts(root), [
      'Monthly',
      '(Save $1,200)',
      'Get started for $295/month',
      'Get started for $295/month',
      'Cancel anytime.',
      'Get started for $295/mo',
      'Get started for $195/mo billed annually',
      'Billed annually at $2,340/year.',
    ])
  })

  test(`production host "${hostname}" keeps a "Get started for $295/mo" Join CTA label unchanged`, () => {
    const root = h('body', {}, [
      h('div', { 'join-cta': 'monthly' }, [button('Get started for $295/mo', {})]),
      h('div', { 'join-cta': 'yearly' }, [button('Get started for $295/mo', {})]),
    ])
    run(hostname, root)

    assert.deepEqual(texts(root), ['Get started for $295/mo', 'Get started for $295/mo'])
  })
}

test('a short Why Us price without its partner sibling stays unchanged', () => {
  const root = h('body', {}, [
    h('div', {}, [h('p', {}, ['$195']), h('p', {}, ['Per month'])]),
    h('div', {}, [h('p', {}, ['$195'])]),
  ])
  run(STAGING, root)

  assert.deepEqual(texts(root), ['$195', 'Per month', '$195'])
})

test('a sentence inside a larger text block stays unchanged', () => {
  const root = h('body', {}, [h('p', {}, ['Note: ' + FAQ_LIVE])])
  run(STAGING, root)

  assert.deepEqual(texts(root), ['Note: ' + FAQ_LIVE])
})

test('copy that does not exactly match a known live label stays unchanged', () => {
  const root = h('body', {}, [joinCta({ monthlyLabel: 'Start your membership' })])
  run(STAGING, root)

  assert.equal(texts(root).filter((t) => t === 'Start your membership').length, 2)
  assert.equal(texts(root).includes('7 Day Trial for $1'), false)
})

test('price attributes outside the Join CTA scopes stay unchanged', () => {
  const outside = button('Get started for $295/month', { [PRICE]: 'prc_premium-monthly--fn1ae0qjj' })
  const root = h('body', {}, [outside])
  run(STAGING, root)

  assert.equal(outside.getAttribute(PRICE), 'prc_premium-monthly--fn1ae0qjj')
  assert.deepEqual(texts(root), ['Get started for $295/month'])
})

test('a second apply after the first is a no-op', () => {
  const root = h('body', {}, [joinCta(), joinCta()])
  const window = run(STAGING, root)
  const after = { prices: prices(root), texts: texts(root) }

  assert.deepEqual(
    JSON.parse(JSON.stringify(window.StartersRelaunchPricingPreview.apply(root))),
    { prices: 0, labels: 0 },
  )
  assert.deepEqual(prices(root), after.prices)
  assert.deepEqual(texts(root), after.texts)
  assert.equal(prices(root).length, 4)
})

test('while the document is loading, the swap waits for DOMContentLoaded', () => {
  const root = h('body', {}, [joinCta()])
  let ready = null
  run(STAGING, root, {
    document: {
      readyState: 'loading',
      addEventListener(type, fn) {
        if (type === 'DOMContentLoaded') ready = fn
      },
    },
  })

  assert.equal(prices(root)[0], 'prc_premium-monthly--fn1ae0qjj')
  ready()
  assert.equal(prices(root)[0], 'prc_3-0-premium-monthly-ge4a00iw')
})

test('an annual button inside a join-cta="monthly" wrapper still gets the annual offer', () => {
  const mislabeled = h('div', { 'join-cta': 'monthly' }, [
    button('Get started for $195/mo billed annually', {}),
    h('p', {}, ['Billed annually at $2,340/year.']),
  ])
  const root = h('body', {}, [mislabeled])
  run(STAGING, root)

  assert.deepEqual(texts(root), [
    'Get started for $295/mo billed annually',
    'Billed annually at $3,540/year.',
  ])
})

function runLoader(hostname) {
  const appended = []
  const document = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll: () => [],
    documentElement: { classList: { add() {}, remove() {} } },
    createElement: (tag) => ({ tagName: tag.toUpperCase() }),
    head: { appendChild: (node) => appended.push(node) },
  }
  const window = { location: { hostname }, document, addEventListener() {} }
  vm.runInNewContext(loaderSource, {
    window,
    document,
    setTimeout() {},
    clearTimeout() {},
    Date,
  })
  return appended
}

test('the navbar gate loads the module on the staging and production hosts only', () => {
  for (const hostname of [STAGING, 'www.thestarters.com', 'thestarters.com']) {
    const appended = runLoader(hostname)
    assert.equal(appended.length, 1)
    assert.equal(
      appended[0].src,
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/relaunch-pricing-preview.js',
    )
    assert.equal(appended[0].async, true)
  }

  for (const hostname of ['localhost', '', 'the-starters-3-0.webflow.io.evil.test']) {
    assert.deepEqual(runLoader(hostname), [])
  }
})

test('staging shows the relaunch Learn paywall price; production turns a leaked one back', () => {
  const staging = h('body', {}, [h('p', { class: 'text-size-medium' }, [PAYWALL_LIVE])])
  run(STAGING, staging)
  assert.deepEqual(texts(staging), [PAYWALL_RELAUNCH])

  for (const hostname of ['www.thestarters.com', 'thestarters.com']) {
    const leaked = h('body', {}, [h('p', { class: 'text-size-medium' }, [PAYWALL_RELAUNCH])])
    run(hostname, leaked)
    assert.deepEqual(texts(leaked), [PAYWALL_LIVE])
  }
})

const TRIAL_Q = 'How does the 7-day monthly trial work?'
const LEGAL_START =
  'I confirm that I am not actively working with any Starter on the platform, nor do I plan on initiating outreach with a Starter out-of-platform. I acknowledge that doing so will be in direct violation of '
const legalEnd = (price) =>
  ` and will result in a ${price} charge on my card on file (cost of annual membership).`
const legalFull = (price) => LEGAL_START + 'The Starters’ Terms of Use' + legalEnd(price).trimEnd()

// Pause step: one span. Cancel step: the Terms of Use link splits the line.
function legalCopy(price) {
  return h('div', {}, [
    h('span', { class: 'confirmation_checkbox-label' }, [legalFull(price)]),
    h('span', { class: 'confirmation_checkbox-label' }, [
      LEGAL_START,
      h('a', { href: '/legals/terms-of-use' }, [h('span', {}, ['The Starters’ Terms of Use'])]),
      legalEnd(price),
    ]),
  ])
}
const legalTexts = (root) => root.children[0].children.map((el) => el.textContent)

test('staging shows the $3,540 legal line in the pause and cancel confirmations', () => {
  const root = h('body', {}, [legalCopy('$2,340')])
  run(STAGING, root)

  assert.deepEqual(legalTexts(root), [legalFull('$3,540'), legalFull('$3,540')])
  // The Terms of Use link stays in place.
  assert.equal(root.querySelectorAll('[href]').length, 1)
})

for (const hostname of ['www.thestarters.com', 'thestarters.com']) {
  test(`production host "${hostname}" turns a leaked $3,540 legal line back`, () => {
    const root = h('body', {}, [legalCopy('$3,540')])
    run(hostname, root)

    assert.deepEqual(legalTexts(root), [legalFull('$2,340'), legalFull('$2,340')])
  })
}

test('staging adds no relaunch FAQ items', () => {
  const root = h('body', {}, [
    h('div', { role: 'list' }, [h('div', { role: 'listitem' }, [h('p', { 'data-relaunch-pricing': 'faq-pricing' }, [FAQ_LIVE])])]),
  ])
  run(STAGING, root)

  assert.equal(root.querySelectorAll('[data-relaunch-faq]').length, 0)
  assert.deepEqual(texts(root), [FAQ_RELAUNCH])
})

for (const hostname of [STAGING, 'www.thestarters.com', 'thestarters.com']) {
  test(`host "${hostname}" removes an earlier relaunch FAQ item`, () => {
    const root = h('body', {}, [
      h('div', { role: 'list' }, [
        h('div', { role: 'listitem' }, ['Who are the Starters?']),
        h('div', { role: 'listitem', 'data-relaunch-faq': 'trial' }, [TRIAL_Q]),
      ]),
    ])
    run(hostname, root)

    assert.equal(root.querySelectorAll('[data-relaunch-faq]').length, 0)
    assert.deepEqual(texts(root), ['Who are the Starters?'])
  })
}

// Staff canary and script-first cutover on production.
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  }
}
const CANARY_KEY = 'ts:relaunch-pricing-canary'
const PROD_RELAUNCH_PRICES = ['prc_3-0-premium-monthly-ge4a00iw', 'prc_3-0-premium-annual-xhb200bu']

for (const hostname of ['www.thestarters.com', 'thestarters.com']) {
  test(`production host "${hostname}" shows the relaunch offer for a ?relaunch=preview canary tab`, () => {
    const sessionStorage = memoryStorage()
    const root = h('body', {}, [joinCta(), livePageCopy()])
    const window = run(hostname, root, { location: { search: '?relaunch=preview' }, window: { sessionStorage } })

    assert.equal(window.StartersRelaunchPricingPreview.mode(), 'preview')
    assert.deepEqual(prices(root), PROD_RELAUNCH_PRICES)
    assert.ok(texts(root).includes('7 Day Trial for $1'))
    assert.ok(texts(root).includes(FAQ_RELAUNCH))
    assert.equal(sessionStorage.data.get(CANARY_KEY), '1')
  })

  test(`production host "${hostname}" keeps the canary on later pages of the same tab`, () => {
    const sessionStorage = memoryStorage({ [CANARY_KEY]: '1' })
    const root = h('body', {}, [joinCta()])
    const window = run(hostname, root, { location: { search: '' }, window: { sessionStorage } })

    assert.equal(window.StartersRelaunchPricingPreview.mode(), 'preview')
    assert.deepEqual(prices(root), PROD_RELAUNCH_PRICES)
  })

  test(`production host "${hostname}" ends the canary with ?relaunch=off`, () => {
    const sessionStorage = memoryStorage({ [CANARY_KEY]: '1' })
    const root = h('body', {}, [joinCta()])
    const window = run(hostname, root, { location: { search: '?relaunch=off' }, window: { sessionStorage } })

    assert.equal(window.StartersRelaunchPricingPreview.mode(), 'guard')
    assert.equal(sessionStorage.data.has(CANARY_KEY), false)
    assert.deepEqual(prices(root), ['prc_premium-monthly--fn1ae0qjj', 'prc_paid-annual-2o5f040u'])
  })

  test(`production host "${hostname}" stays in guard mode without a canary flag`, () => {
    const root = h('body', {}, [joinCta()])
    const window = run(hostname, root, { location: { search: '?relaunch=yes' }, window: { sessionStorage: memoryStorage() } })

    assert.equal(window.StartersRelaunchPricingPreview.mode(), 'guard')
    assert.deepEqual(prices(root), ['prc_premium-monthly--fn1ae0qjj', 'prc_paid-annual-2o5f040u'])
  })

  test(`production host "${hostname}" canary URL still works when sessionStorage throws`, () => {
    const blocked = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    }
    const root = h('body', {}, [joinCta()])
    const window = run(hostname, root, { location: { search: '?relaunch=preview' }, window: { sessionStorage: blocked } })

    assert.equal(window.StartersRelaunchPricingPreview.mode(), 'preview')
    assert.deepEqual(prices(root), PROD_RELAUNCH_PRICES)
  })

  test(`production host "${hostname}" shows the relaunch offer to everyone when PRODUCTION_LIVE is true`, () => {
    const liveSource = source.replace('var PRODUCTION_LIVE = false', 'var PRODUCTION_LIVE = true')
    assert.notEqual(liveSource, source)
    const root = h('body', {}, [joinCta(), livePageCopy()])
    const window = run(hostname, root, { source: liveSource, location: { search: '' } })

    assert.equal(window.StartersRelaunchPricingPreview.mode(), 'preview')
    assert.deepEqual(prices(root), PROD_RELAUNCH_PRICES)
    assert.ok(texts(root).includes(FAQ_RELAUNCH))
  })
}

test('the canary flag never turns on preview for other hosts', () => {
  for (const hostname of ['localhost', 'the-starters-3-0.webflow.io.evil.test']) {
    const window = run(hostname, h('body', {}, [joinCta()]), {
      location: { search: '?relaunch=preview' }, window: { sessionStorage: memoryStorage() },
    })
    assert.equal(window.StartersRelaunchPricingPreview.mode(), '')
  }
})
