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
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase()
    this.attrs = Object.assign({}, attrs)
    // childNodes keeps text and element children in order, like the DOM;
    // `children` holds elements only.
    this.childNodes = children.map((child) =>
      typeof child === 'string' ? { text: child } : child,
    )
  }
  get children() {
    return this.childNodes.filter((child) => child instanceof Element)
  }
  get textContent() {
    return this.childNodes
      .map((child) => (child instanceof Element ? child.textContent : child.text))
      .join('')
  }
  set textContent(value) {
    this.childNodes = [{ text: String(value) }]
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

function run(hostname, root, extra = {}) {
  const document = Object.assign(
    {
      readyState: 'complete',
      querySelectorAll: (selector) => root.querySelectorAll(selector),
      addEventListener() {},
    },
    extra.document || {},
  )
  const window = { location: { hostname }, document }
  vm.runInNewContext(source, { window, Object, Array, String })
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
    const root = h('body', {}, [joinCta()])
    const before = { prices: prices(root), texts: texts(root) }
    const window = run(hostname, root)

    assert.deepEqual(prices(root), before.prices)
    assert.deepEqual(texts(root), before.texts)
    assert.deepEqual(
      JSON.parse(JSON.stringify(window.StartersRelaunchPricingPreview.apply(root))),
      { prices: 0, labels: 0 },
    )
    assert.equal(window.StartersRelaunchPricingPreview.boot(), false)
  })
}

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

test('the navbar gate loads the preview module on the staging host only', () => {
  const staging = runLoader(STAGING)
  assert.equal(staging.length, 1)
  assert.equal(
    staging[0].src,
    'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/relaunch-pricing-preview.js',
  )
  assert.equal(staging[0].async, true)

  for (const hostname of ['www.thestarters.com', 'thestarters.com']) {
    assert.deepEqual(runLoader(hostname), [])
  }
})
