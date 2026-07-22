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
    tagName: 'A',
    _attrs: attrs || {},
    style: {},
    dataset: {},
    href: '',
    getAttribute(name) {
      return this._attrs[name] != null ? this._attrs[name] : null
    },
    setAttribute(name, value) {
      this._attrs[name] = value
    },
  }
}

// The 3.0 Button design-system instance renders a native <button
// class="clickable_btn"> (no anchor). Model it with a click dispatcher so tests
// can trigger navigation.
function fakeButton(className) {
  const listeners = {}
  return {
    tagName: 'BUTTON',
    className: className == null ? 'clickable_btn' : className,
    style: {},
    dataset: {},
    addEventListener(type, callback) {
      ;(listeners[type] = listeners[type] || []).push(callback)
    },
    click() {
      ;(listeners.click || []).forEach((fn) => fn())
    },
  }
}

// A label node (.button_main-text) inside the button component. Starts with the
// Designer's default text so tests can assert it is left untouched.
function fakeLabel(text) {
  return { textContent: text == null ? 'Connect Stripe' : text }
}

// A component-mode tooltip wrapper (service-card_tooltip block). Options:
//   anchor    - a legacy <a> CTA (fakeElement), or omitted
//   button    - a native <button> CTA (fakeButton), or omitted
//   mainWrap  - the .button_main-wrap element (fakeElement), or omitted
//   labelNode - the .button_main-text node (fakeLabel), or omitted
// Supports the exact selectors the module queries.
function fakeWrapper(opts) {
  opts = opts || {}
  const anchor = opts.anchor || null
  const button = opts.button || null
  const mainWrap = opts.mainWrap || null
  const labelNode = opts.labelNode || null
  return {
    tagName: 'DIV',
    _attrs: {},
    style: {},
    getAttribute(name) {
      return this._attrs[name] != null ? this._attrs[name] : null
    },
    setAttribute(name, value) {
      this._attrs[name] = value
    },
    querySelector(selector) {
      if (selector === 'a, button.clickable_btn') {
        if (anchor) return anchor
        if (button && String(button.className).split(/\s+/).includes('clickable_btn')) {
          return button
        }
        return null
      }
      if (selector === 'a') return anchor
      if (selector === 'button') return button
      if (selector === '.button_main-wrap') return mainWrap
      if (selector === '.button_main-text') return labelNode
      return null
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
  const assigns = []
  const window = {
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      assign: (url) => assigns.push(url),
    },
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

  return { window, document: doc, fetchCalls, assigns }
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
  const paidWrapper = fakeWrapper({ anchor: paidAnchor })
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
  const paidWrapper = fakeWrapper({ anchor: paidAnchor })
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
  const paidWrapper = fakeWrapper({ anchor: paidAnchor })
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
  const emptyWrapper = fakeWrapper({})
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
  const freeWrapper = fakeWrapper({ anchor: freeAnchor })
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
  const emptyWrapper = fakeWrapper({})
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

/* -------------------------------------------------------------------------- */
/* Component mode, button CTA: the 3.0 Button renders <button class=            */
/* "clickable_btn">, not an <a>. The module navigates on click.                 */
/* -------------------------------------------------------------------------- */

test('button CTA: owner + connect_url navigates on click (paid)', async () => {
  const button = fakeButton('clickable_btn')
  const mainWrap = fakeElement()
  const paidWrapper = fakeWrapper({ button, mainWrap })
  const { window, assigns } = loadModule({
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

  // Latest URL stored on the element; cursor hint applied to .button_main-wrap.
  assert.equal(button.dataset.tsConnectUrl, 'https://connect.stripe.com/setup/abc')
  assert.equal(button.dataset.tsConnectBound, 'true')
  assert.equal(mainWrap.style.cursor, 'pointer')
  assert.deepEqual(assigns, [])

  button.click()
  assert.deepEqual(assigns, ['https://connect.stripe.com/setup/abc'])
})

test('button CTA: owner + dashboard_url wins and navigates on click (paid)', async () => {
  const button = fakeButton('clickable_btn')
  const paidWrapper = fakeWrapper({ button })
  const { window, assigns } = loadModule({
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
  button.click()

  assert.deepEqual(assigns, ['https://dashboard.stripe.com/login/xyz'])
})

test('button CTA: falls back to a plain <button> when not .clickable_btn', async () => {
  const button = fakeButton('') // no clickable_btn class
  const paidWrapper = fakeWrapper({ button })
  const { window, assigns } = loadModule({
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
  button.click()

  assert.deepEqual(assigns, ['https://connect.stripe.com/setup/abc'])
})

test('button CTA: free wrapper navigates to the static dashboard on click', async () => {
  const button = fakeButton('clickable_btn')
  const freeWrapper = fakeWrapper({ button })
  const { window, document, assigns, fetchCalls } = loadModule({
    readyState: 'loading',
    elements: { '[no-connection="free"]': [freeWrapper] },
    memberstack: { getCurrentMember: async () => ({ data: null }) },
  })

  document.fire('DOMContentLoaded')
  await window.tsStripeConnectReady
  button.click()

  assert.equal(fetchCalls.length, 0)
  assert.equal(button.dataset.tsConnectUrl, '/starter-dashboard')
  assert.deepEqual(assigns, ['/starter-dashboard'])
})

test('button CTA: click listener is bound only once (double-bind guard)', async () => {
  const button = fakeButton('clickable_btn')
  const paidWrapper = fakeWrapper({ button })
  const { window, assigns } = loadModule({
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
  // Re-run the flow: the URL is refreshed but the listener must not re-bind.
  await window.tsStripeConnect.run()
  button.click()

  // A single click yields a single navigation (one listener, not two).
  assert.deepEqual(assigns, ['https://connect.stripe.com/setup/abc'])
})

test('button CTA: a later run updates the URL the handler navigates to', async () => {
  const button = fakeButton('clickable_btn')
  const paidWrapper = fakeWrapper({ button })
  let call = 0
  const { window, assigns } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () => {
      call += 1
      return call === 1
        ? response({
            charges_enabled: false,
            connect_url: 'https://connect.stripe.com/setup/abc',
            dashboard_url: null,
          })
        : response({
            charges_enabled: false,
            connect_url: null,
            dashboard_url: 'https://dashboard.stripe.com/login/xyz',
          })
    },
  })

  await window.tsStripeConnectReady
  button.click()
  assert.deepEqual(assigns, ['https://connect.stripe.com/setup/abc'])

  // Second run swaps connect -> dashboard; the same handler must use the latest.
  await window.tsStripeConnect.run()
  button.click()
  assert.deepEqual(assigns, [
    'https://connect.stripe.com/setup/abc',
    'https://dashboard.stripe.com/login/xyz',
  ])
})

/* -------------------------------------------------------------------------- */
/* Paid CTA setup_state: three states via response.setup_state.                 */
/*   not_connected -> onboarding link, default label                            */
/*   incomplete    -> resume link, label relabelled "Complete Setup"            */
/*   complete      -> charges_enabled true, CTA hidden (covered above)          */
/* -------------------------------------------------------------------------- */

test('setup_state incomplete: relabels the CTA and wires the resume link', async () => {
  const button = fakeButton('clickable_btn')
  const labelNode = fakeLabel('Connect Stripe')
  const paidWrapper = fakeWrapper({ button, labelNode })
  const { window, assigns } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        setup_state: 'incomplete',
        connect_url: 'https://connect.stripe.com/setup/resume',
        dashboard_url: null,
      }),
  })

  await window.tsStripeConnectReady

  assert.equal(labelNode.textContent, 'Complete Setup')
  assert.equal(button.dataset.tsConnectUrl, 'https://connect.stripe.com/setup/resume')
  button.click()
  assert.deepEqual(assigns, ['https://connect.stripe.com/setup/resume'])
})

test('setup_state incomplete: relabels an anchor CTA too', async () => {
  const anchor = fakeElement()
  const labelNode = fakeLabel('Connect Stripe')
  const paidWrapper = fakeWrapper({ anchor, labelNode })
  const { window } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        setup_state: 'incomplete',
        connect_url: 'https://connect.stripe.com/setup/resume',
        dashboard_url: null,
      }),
  })

  await window.tsStripeConnectReady

  assert.equal(labelNode.textContent, 'Complete Setup')
  assert.equal(anchor.href, 'https://connect.stripe.com/setup/resume')
})

test('setup_state not_connected: leaves the default label untouched', async () => {
  const button = fakeButton('clickable_btn')
  const labelNode = fakeLabel('Connect Stripe')
  const paidWrapper = fakeWrapper({ button, labelNode })
  const { window } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        setup_state: 'not_connected',
        connect_url: 'https://connect.stripe.com/setup/new',
        dashboard_url: null,
      }),
  })

  await window.tsStripeConnectReady

  assert.equal(labelNode.textContent, 'Connect Stripe')
  assert.equal(button.dataset.tsConnectUrl, 'https://connect.stripe.com/setup/new')
})

test('missing setup_state: behavior is unchanged (no relabel)', async () => {
  const button = fakeButton('clickable_btn')
  const labelNode = fakeLabel('Connect Stripe')
  const paidWrapper = fakeWrapper({ button, labelNode })
  const { window } = loadModule({
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

  assert.equal(labelNode.textContent, 'Connect Stripe')
  assert.equal(button.dataset.tsConnectUrl, 'https://connect.stripe.com/setup/abc')
})

test('setup_state incomplete: no label node present does not throw', async () => {
  const button = fakeButton('clickable_btn')
  const paidWrapper = fakeWrapper({ button }) // no labelNode
  const { window, assigns } = loadModule({
    byId: { 'ts-stripe-connect-data': fakeElement({ 'data-memberstack-id': OWNER_ID }) },
    elements: { '[no-connection="paid"]': [paidWrapper] },
    xanoResponder: () =>
      response({
        charges_enabled: false,
        setup_state: 'incomplete',
        connect_url: 'https://connect.stripe.com/setup/resume',
        dashboard_url: null,
      }),
  })

  const result = await window.tsStripeConnectReady

  // Resolves normally; the link is still wired.
  assert.equal(result.setup_state, 'incomplete')
  button.click()
  assert.deepEqual(assigns, ['https://connect.stripe.com/setup/resume'])
})
