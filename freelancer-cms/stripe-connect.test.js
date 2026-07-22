const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./stripe-connect.js'), 'utf8')
const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const CONNECT_LINKS_URL = `${XANO_ORIGIN}/api:tCpV3oqd/stripe/connect_links`
const OWNER_ID = 'mem_owner'

function fakeElement(attrs) {
  return {
    _attrs: attrs || {},
    style: {},
    href: '',
    getAttribute(name) {
      return this._attrs[name] != null ? this._attrs[name] : null
    },
    setAttribute(name, value) {
      this._attrs[name] = value
    },
  }
}

// A component-mode tooltip wrapper (service-card_tooltip block). Its first `<a>`
// descendant is the shared Button instance the module wires; `anchor` may be
// null to model a wrapper the Designer left without a CTA anchor.
function fakeWrapper(anchor) {
  return {
    _attrs: {},
    style: {},
    _anchor: anchor || null,
    getAttribute(name) {
      return this._attrs[name] != null ? this._attrs[name] : null
    },
    setAttribute(name, value) {
      this._attrs[name] = value
    },
    querySelector(selector) {
      return selector === 'a' ? this._anchor : null
    },
  }
}

// Minimal DOM: querySelectorAll returns arrays (which have forEach), plus a
// getElementById map and a fireable DOMContentLoaded listener registry.
function fakeDocument(options) {
  const elements = options.elements || {}
  const byId = options.byId || {}
  const listeners = {}
  return {
    readyState: options.readyState || 'complete',
    getElementById(id) {
      return byId[id] || null
    },
    querySelectorAll(selector) {
      return elements[selector] || []
    },
    addEventListener(type, callback) {
      ;(listeners[type] = listeners[type] || []).push(callback)
    },
    fire(type) {
      ;(listeners[type] || []).forEach((fn) => fn())
    },
    documentElement: { setAttribute() {}, getAttribute: () => null },
  }
}

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data
    },
  }
}

function loadModule(options = {}) {
  const doc = fakeDocument(options)
  const fetchCalls = []
  const window = {
    location: { hostname: options.hostname || 'the-starters-3-0.webflow.io' },
    setTimeout: (fn) => setTimeout(fn, 0),
    console: { warn() {}, info() {}, error() {} },
  }
  if (options.stripeChargesPredefined !== undefined) {
    window.stripe_charges = options.stripeChargesPredefined
  }
  if ('memberstack' in options) {
    window.$memberstackDom = options.memberstack
  } else {
    window.$memberstackDom = {
      getCurrentMember: async () => ({ data: { id: options.memberId ?? OWNER_ID } }),
    }
  }
  if (options.withXanoAuthFetch !== false) {
    window.xanoAuthFetch = async (url, init) => {
      fetchCalls.push({ url, init })
      if (options.xanoResponder) return options.xanoResponder(url, init)
      return response({ charges_enabled: false, connect_url: null, dashboard_url: null })
    }
  }

  vm.runInNewContext(source, {
    window,
    document: doc,
    Promise,
    setTimeout,
    console: window.console,
    Array,
    JSON,
  })

  return { window, document: doc, fetchCalls }
}

test('does not install outside V3 Webflow staging', () => {
  const { window, fetchCalls } = loadModule({ hostname: 'www.thestarters.com' })

  assert.equal(window.__tsStripeConnect, undefined)
  assert.equal(window.tsStripeConnectReady, undefined)
  assert.equal(window.stripe_charges, undefined)
  assert.equal(window.starter_dashboard_url, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('wires [starter-dashboard-url] links on DOMContentLoaded', async () => {
  const dashLinks = [fakeElement(), fakeElement()]
  const { window, document } = loadModule({
    readyState: 'loading',
    elements: { '[starter-dashboard-url]': dashLinks },
    byId: {},
    memberstack: { getCurrentMember: async () => ({ data: null }) },
  })

  document.fire('DOMContentLoaded')
  await window.tsStripeConnectReady

  assert.equal(window.starter_dashboard_url, '/starter-dashboard')
  for (const link of dashLinks) assert.equal(link.href, '/starter-dashboard')
})

test('non-owner never fetches Stripe links', async () => {
  const connectLinks = [fakeElement()]
  const { window, fetchCalls } = loadModule({
    memberId: 'mem_visitor',
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[stripe-connect-url]': connectLinks },
  })

  const result = await window.tsStripeConnectReady

  assert.equal(result, null)
  assert.equal(fetchCalls.length, 0)
  assert.equal(window.stripe_charges, false)
  assert.equal(connectLinks[0].style.display, undefined)
})

test('logged-out viewer never fetches Stripe links', async () => {
  const { window, fetchCalls } = loadModule({
    memberstack: { getCurrentMember: async () => ({ data: null }) },
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
  })

  const result = await window.tsStripeConnectReady

  assert.equal(result, null)
  assert.equal(fetchCalls.length, 0)
  assert.equal(window.stripe_charges, false)
})

test('owner with connect_url reveals and wires [stripe-connect-url]', async () => {
  const connectLinks = [fakeElement(), fakeElement()]
  const dashboardLinks = [fakeElement()]
  const { window, fetchCalls } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: {
      '[stripe-connect-url]': connectLinks,
      '[stripe-dashboard-url]': dashboardLinks,
    },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        connect_url: 'https://connect.stripe.com/setup/abc',
        dashboard_url: null,
      }),
  })

  const result = await window.tsStripeConnectReady

  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url, CONNECT_LINKS_URL)
  assert.equal(fetchCalls[0].init.method, 'POST')
  assert.equal(fetchCalls[0].init.body, '{}')
  assert.equal(window.stripe_charges, false)
  for (const link of connectLinks) {
    assert.equal(link.style.display, 'flex')
    assert.equal(link.href, 'https://connect.stripe.com/setup/abc')
  }
  // dashboard controls stay hidden when connect is the active path
  assert.equal(dashboardLinks[0].style.display, undefined)
  assert.deepEqual(result, {
    charges_enabled: false,
    connect_url: 'https://connect.stripe.com/setup/abc',
    dashboard_url: null,
  })
})

test('owner with dashboard_url reveals and wires [stripe-dashboard-url]', async () => {
  const connectLinks = [fakeElement()]
  const dashboardLinks = [fakeElement(), fakeElement()]
  const { window, fetchCalls } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: {
      '[stripe-connect-url]': connectLinks,
      '[stripe-dashboard-url]': dashboardLinks,
    },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        connect_url: 'https://connect.stripe.com/setup/ignored',
        dashboard_url: 'https://dashboard.stripe.com/login/xyz',
      }),
  })

  await window.tsStripeConnectReady

  assert.equal(fetchCalls.length, 1)
  assert.equal(window.stripe_charges, false)
  // dashboard_url takes precedence over connect_url
  for (const link of dashboardLinks) {
    assert.equal(link.style.display, 'flex')
    assert.equal(link.href, 'https://dashboard.stripe.com/login/xyz')
  }
  assert.equal(connectLinks[0].style.display, undefined)
})

test('owner with charges_enabled leaves every CTA hidden', async () => {
  const connectLinks = [fakeElement()]
  const dashboardLinks = [fakeElement()]
  const { window, fetchCalls } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: {
      '[stripe-connect-url]': connectLinks,
      '[stripe-dashboard-url]': dashboardLinks,
    },
    xanoResponder: () =>
      response({
        charges_enabled: true,
        connect_url: null,
        dashboard_url: 'https://dashboard.stripe.com/login/xyz',
      }),
  })

  const result = await window.tsStripeConnectReady

  assert.equal(fetchCalls.length, 1)
  assert.equal(window.stripe_charges, true)
  assert.equal(connectLinks[0].style.display, undefined)
  assert.equal(dashboardLinks[0].style.display, undefined)
  assert.equal(result.charges_enabled, true)
})

test('endpoint 404 is a graceful no-op (endpoint still unbuilt)', async () => {
  const connectLinks = [fakeElement()]
  const { window, fetchCalls } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[stripe-connect-url]': connectLinks },
    xanoResponder: () => response({ message: 'Not found' }, 404),
  })

  const result = await window.tsStripeConnectReady

  assert.equal(fetchCalls.length, 1)
  assert.equal(result, null)
  assert.equal(window.stripe_charges, false)
  assert.equal(connectLinks[0].style.display, undefined)
})

test('fetch rejection resolves ready with null and leaves defaults', async () => {
  const { window } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    xanoResponder: () => {
      throw new Error('network down')
    },
  })

  const result = await window.tsStripeConnectReady

  assert.equal(result, null)
  assert.equal(window.stripe_charges, false)
})

test('does not clobber a stripe_charges value set before the module loads', async () => {
  const { window } = loadModule({
    stripeChargesPredefined: true,
    memberstack: { getCurrentMember: async () => ({ data: null }) },
  })

  await window.tsStripeConnectReady
  // No owner fetch happened, so the pre-set value must survive.
  assert.equal(window.stripe_charges, true)
})

test('missing owner data element skips the fetch', async () => {
  const { window, fetchCalls } = loadModule({
    byId: {},
  })

  const result = await window.tsStripeConnectReady

  assert.equal(result, null)
  assert.equal(fetchCalls.length, 0)
})

test('missing xanoAuthFetch helper is a graceful no-op', async () => {
  const { window } = loadModule({
    withXanoAuthFetch: false,
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
  })

  const result = await window.tsStripeConnectReady

  assert.equal(result, null)
  assert.equal(window.stripe_charges, false)
})

/* -------------------------------------------------------------------------- */
/* Component mode: shared "Service Card - Tooltip" instances (no discrete       */
/* [stripe-connect-url]/[stripe-dashboard-url] anchors on the 3.0 hire page).   */
/* -------------------------------------------------------------------------- */

test('component mode: owner + connect_url wires [no-connection="paid"] anchor', async () => {
  const paidAnchor = fakeElement()
  const paidWrapper = fakeWrapper(paidAnchor)
  const { window, fetchCalls } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        connect_url: 'https://connect.stripe.com/setup/abc',
        dashboard_url: null,
      }),
  })

  await window.tsStripeConnectReady

  assert.equal(fetchCalls.length, 1)
  assert.equal(paidAnchor.href, 'https://connect.stripe.com/setup/abc')
  // The module never adds the legacy hide-me attributes or touches display.
  assert.equal(paidAnchor.getAttribute('stripe-connect-url'), null)
  assert.equal(paidAnchor.getAttribute('stripe-dashboard-url'), null)
  assert.equal(paidWrapper.style.display, undefined)
  assert.equal(paidAnchor.style.display, undefined)
})

test('component mode: owner + dashboard_url wins over connect_url on paid anchor', async () => {
  const paidAnchor = fakeElement()
  const paidWrapper = fakeWrapper(paidAnchor)
  const { window } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        connect_url: 'https://connect.stripe.com/setup/ignored',
        dashboard_url: 'https://dashboard.stripe.com/login/xyz',
      }),
  })

  await window.tsStripeConnectReady

  assert.equal(paidAnchor.href, 'https://dashboard.stripe.com/login/xyz')
})

test('component mode: charges_enabled leaves the paid anchor untouched', async () => {
  const paidAnchor = fakeElement()
  const paidWrapper = fakeWrapper(paidAnchor)
  const { window } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: true,
        connect_url: null,
        dashboard_url: 'https://dashboard.stripe.com/login/xyz',
      }),
  })

  await window.tsStripeConnectReady

  assert.equal(window.stripe_charges, true)
  assert.equal(paidAnchor.href, '')
})

test('component mode: paid wrapper without an anchor does not throw', async () => {
  const emptyWrapper = fakeWrapper(null)
  const { window } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [emptyWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        connect_url: 'https://connect.stripe.com/setup/abc',
        dashboard_url: null,
      }),
  })

  const result = await window.tsStripeConnectReady

  // Resolves normally (no throw) with the payload.
  assert.equal(result.connect_url, 'https://connect.stripe.com/setup/abc')
})

test('component mode: wires [no-connection="free"] anchor on DOMContentLoaded', async () => {
  const freeAnchor = fakeElement()
  const freeWrapper = fakeWrapper(freeAnchor)
  const { window, document, fetchCalls } = loadModule({
    readyState: 'loading',
    elements: { '[no-connection="free"]': [freeWrapper] },
    // A logged-out visitor still gets the free CTA wired (unconditional).
    memberstack: { getCurrentMember: async () => ({ data: null }) },
  })

  document.fire('DOMContentLoaded')
  await window.tsStripeConnectReady

  assert.equal(freeAnchor.href, '/starter-dashboard')
  assert.equal(fetchCalls.length, 0)
})

test('component mode: free wrapper without an anchor does not throw', async () => {
  const emptyWrapper = fakeWrapper(null)
  const { window, document } = loadModule({
    readyState: 'loading',
    elements: { '[no-connection="free"]': [emptyWrapper] },
    memberstack: { getCurrentMember: async () => ({ data: null }) },
  })

  // Firing DOMContentLoaded must not throw even with no anchor present.
  assert.doesNotThrow(() => document.fire('DOMContentLoaded'))
  const result = await window.tsStripeConnectReady
  assert.equal(result, null)
})
