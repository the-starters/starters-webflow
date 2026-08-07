const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'opportunities-3.0.js'), 'utf8')

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function response(data, ok = true, status = 200) {
  return { ok, status, json: async () => data }
}

async function waitForRequestCount(requests, count) {
  for (let attempt = 0; attempt < 20 && requests.length < count; attempt += 1) {
    await new Promise(setImmediate)
  }
  assert.equal(requests.length, count)
}

async function loadBridge(
  fetch,
  {
    hostname = 'example.test',
    member = null,
    pathname = '/all-modals',
    querySelector = null,
    querySelectorAll = null,
    routeGuard = false,
    routeGuardDelayMs = null,
    routeGuardScript = false,
    search = '',
  } = {},
) {
  const documentListeners = new Map()
  const mutationObservers = []
  let authChange
  const attributes = new Map()
  if (routeGuard) {
    attributes.set('data-route-guard', routeGuard === true ? 'allowed' : String(routeGuard))
  }
  const documentElement = {
    appendChild() {},
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
  }
  const document = {
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || []
      listeners.push(listener)
      documentListeners.set(type, listeners)
    },
    createElement() {
      return { addEventListener() {}, setAttribute() {}, style: {} }
    },
    documentElement,
    getElementById: () => null,
    head: documentElement,
    querySelector: (selector) => {
      if (selector === 'script[src*="/v3/route-guard.js"]' && routeGuardScript) return {}
      return querySelector ? querySelector(selector) : null
    },
    querySelectorAll: (selector) => (querySelectorAll ? querySelectorAll(selector) : []),
    readyState: 'loading',
  }
  const trackCalls = []
  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({ data: typeof member === 'function' ? member() : member }),
      getMemberCookie: async () => 'memberstack-a',
      onAuthChange(listener) {
        authChange = listener
      },
    },
    StartersTrack: { track: (...args) => trackCalls.push(args) },
    addEventListener() {},
    clearInterval,
    clearTimeout,
    dispatchEvent() {},
    setInterval,
    setTimeout,
  }
  window.fetch = fetch
  window.window = window
  const location = {
    href: `https://${hostname}${pathname}${search}`,
    hostname,
    pathname,
    search,
  }
  const context = vm.createContext({
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type
        this.detail = options?.detail
      }
    },
    FormData,
    Headers,
    MutationObserver: class MutationObserver {
      constructor(callback) {
        this.callback = callback
        this.connected = true
        mutationObservers.push(this)
      }
      disconnect() {
        this.connected = false
      }
      observe() {}
    },
    Request,
    URL,
    URLSearchParams,
    alert() {},
    console: { error() {}, info() {}, log() {}, warn() {} },
    document,
    fetch: (...args) => window.fetch(...args),
    history: { replaceState() {} },
    location,
    window,
  })
  vm.runInContext(source, context)
  if (routeGuardDelayMs !== null) {
    setTimeout(() => documentElement.setAttribute('data-route-guard', 'checking'), routeGuardDelayMs)
  }
  for (const listener of documentListeners.get('DOMContentLoaded') || []) listener()
  await Promise.resolve()
  assert.equal(typeof authChange, 'function')
  return {
    API: window.Opp30.API,
    authChange,
    attributes,
    documentElement,
    fetch: window.fetch,
    location,
    trackCalls,
    window,
    notifyMutations(mutations = []) {
      mutationObservers
        .filter((observer) => observer.connected)
        .forEach((observer) => observer.callback(mutations))
    },
    dispatchDocument(type, event) {
      for (const listener of documentListeners.get(type) || []) listener(event)
    },
  }
}

test('builds a login URL that preserves the current V3 path and query', async () => {
  const bridge = await loadBridge(async () => response({}))

  assert.equal(
    bridge.window.Opp30.loginPathWithNext(),
    '/login?next=%2Fall-modals',
  )
})

const talentMember = {
  id: 'm-talent',
  customFields: {},
  planConnections: [{ active: true, planId: 'pln_dorxata-test-free-plan-dvcg0k8o' }],
}
const paidBrandMember = {
  id: 'm-brand',
  customFields: {},
  planConnections: [{ active: true, planId: 'pln_new-paid-plan-463h04ph' }],
}
const freeBrandMember = {
  id: 'm-free',
  customFields: {},
  planConnections: [{ active: true, planId: 'pln_free-plan-f6kn0dxz' }],
}

test('invoiceCreate sends the V3 invoice payload through the authenticated Xano bridge', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init = {}) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
      if (url.includes('/invoices/create/v3')) {
        return response({
          invoice_id: 901,
          stripe_ref: 'plink_test',
          payment_link: 'https://buy.stripe.com/test',
          status: 'unpaid',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    },
    { member: talentMember },
  )

  const result = await bridge.API.invoiceCreate({
    project_id: 675,
    amount: 25.5,
    description: 'August test invoice',
    idempotency_key: 'invoice-v3-675-test',
  })

  assert.equal(result.invoice_id, 901)
  assert.match(requests[1].url, /\/invoices\/create\/v3$/)
  assert.equal(requests[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    project_id: 675,
    amount: 25.5,
    description: 'August test invoice',
    idempotency_key: 'invoice-v3-675-test',
  })
})

test('invoice helpers turn the Stripe prerequisite into an actionable dashboard message', async () => {
  const bridge = await loadBridge(async () => response({}))

  assert.equal(
    bridge.window.Opp30.invoiceErrorMessage({
      data: { message: 'Connect a Stripe account before generating invoices' },
    }),
    'Connect your Stripe account from the dashboard before generating invoices.',
  )
  assert.equal(bridge.window.Opp30.formatInvoiceAmount(25.5), '$25.50')
})

test('the authored type=button invoice CTA requests the native form submit', async () => {
  const bridge = await loadBridge(async () => response({}))
  let submits = 0
  let prevented = 0
  let stopped = 0
  const modal = {}
  const form = {
    closest: (selector) =>
      selector === '[data-modal-target="generate-invoice"]' ? modal : null,
    requestSubmit: () => {
      submits += 1
    },
  }
  const action = { closest: (selector) => (selector === 'form' ? form : null) }
  const target = {
    closest: (selector) =>
      selector.includes('#wf-form-Generate-Invoice [data-button-style="primary"]')
        ? action
        : null,
  }

  bridge.dispatchDocument('click', {
    target,
    preventDefault: () => {
      prevented += 1
    },
    stopPropagation: () => {
      stopped += 1
    },
  })

  assert.equal(submits, 1)
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
})

// A project card as either list library renders it: the row id as an attribute,
// the display fields behind wf-algolia-text / wf-xano-bind / data-opp-bind.
function invoiceCard(fields, id = '675') {
  return {
    getAttribute: (name) => (name === 'data-wf-xano-id' ? id : null),
    querySelector: (selector) => {
      const match = /^\[(?:wf-algolia-text|wf-xano-bind|data-opp-bind)="([\w-]+)"\]$/.exec(selector)
      const field = match && match[1]
      return field && fields[field] != null ? { textContent: fields[field] } : null
    },
  }
}

test('the invoiced amount is rounded to cents and never below the promised $0.01', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { normalizeInvoiceAmount } = bridge.window.Opp30

  // What gets posted is exactly what the success screen shows.
  assert.equal(normalizeInvoiceAmount('25.555'), 25.56)
  assert.equal(bridge.window.Opp30.formatInvoiceAmount(normalizeInvoiceAmount('25.555')), '$25.56')
  assert.equal(normalizeInvoiceAmount('0.01'), 0.01)
  assert.equal(normalizeInvoiceAmount('0.004'), null)
  assert.equal(normalizeInvoiceAmount('0'), null)
  assert.equal(normalizeInvoiceAmount('-5'), null)
  assert.equal(normalizeInvoiceAmount(''), null)
  assert.equal(normalizeInvoiceAmount('abc'), null)
  assert.equal(normalizeInvoiceAmount('1000000'), 1000000)
  assert.equal(normalizeInvoiceAmount('1000000.01'), null)
})

test('invoiceProjectContext prefers a bound brand field over the pipe-split heading', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { invoiceProjectContext } = bridge.window.Opp30

  const bound = invoiceProjectContext(
    invoiceCard({ heading_display: 'Growth | Ops | Acme Co', company: 'Acme Co', title: 'Growth' }),
  )
  assert.equal(bound.projectId, 675)
  assert.equal(bound.title, 'Growth')
  assert.equal(bound.brand, 'Acme Co')

  const heading = invoiceProjectContext(invoiceCard({ heading_display: 'Growth | Ops | Acme Co' }))
  assert.equal(heading.brand, 'Acme Co')

  // The authored V3 project card binds the brand as wf-xano-bind="company_name"
  // and its heading as "#<id> | <brand>", so the bound field must win over the
  // heading split rather than the other way round.
  const authored = invoiceProjectContext(
    invoiceCard({
      heading_display: '#1123 | Stale Heading',
      company_name: 'Northwind Coffee',
      title: 'Growth Marketing Lead',
    }),
  )
  assert.equal(authored.brand, 'Northwind Coffee')
  assert.equal(authored.title, 'Growth Marketing Lead')

  assert.equal(invoiceProjectContext(invoiceCard({}, '0')), null)
  assert.equal(invoiceProjectContext(invoiceCard({}, '-4')), null)
  assert.equal(invoiceProjectContext(null), null)
})

// The Generate Invoice modal's success screen as the authored Webflow component
// renders it: brand/project/amount binds (there is no status hook), and a
// "View in Stripe" design-system button whose visible element is the
// .button_main-wrap div wrapping an invisible a.clickable_link overlay that
// carries the "#invoice-payment-link" placeholder href.
function invoiceModalFixture() {
  const wrap = { style: {} }
  // Attribute-backed like the real anchor: rewriting .href rewrites the
  // attribute, so an [href="#invoice-payment-link"] selector stops matching.
  const linkAttributes = new Map([['href', '#invoice-payment-link']])
  const link = {
    style: {},
    closest: (selector) => (selector === '.button_main-wrap' ? wrap : null),
    getAttribute: (name) => (linkAttributes.has(name) ? linkAttributes.get(name) : null),
    hasAttribute: (name) => linkAttributes.has(name),
    setAttribute: (name, value) => linkAttributes.set(name, String(value)),
  }
  Object.defineProperty(link, 'href', {
    enumerable: true,
    get: () => linkAttributes.get('href'),
    set: (value) => linkAttributes.set('href', String(value)),
  })
  const binds = {
    brand: { textContent: '' },
    project: { textContent: '' },
    amount: { textContent: '$1,000.00' },
  }
  const form = { dataset: {}, style: {}, reset() {} }
  const done = { style: {} }
  const modal = {
    querySelector: (selector) => {
      if (selector === 'form') return form
      if (selector === '.w-form-done') return done
      if (selector === '[data-wf-invoice="payment-link"]') {
        return link.getAttribute('data-wf-invoice') === 'payment-link' ? link : null
      }
      if (selector === 'a[href="#invoice-payment-link"]') {
        return link.getAttribute('href') === '#invoice-payment-link' ? link : null
      }
      return null
    },
    querySelectorAll: (selector) => {
      const match = /^\[data-wf-invoice-bind="([\w-]+)"\]$/.exec(selector)
      const field = match && match[1]
      return field && binds[field] ? [binds[field]] : []
    },
  }
  return { binds, done, form, link, modal, wrap }
}

test('the success screen shows and hides the Stripe button, not just its overlay anchor', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { paintInvoiceSuccess } = bridge.window.Opp30
  const context = { brand: 'Northwind Coffee', title: 'Growth Marketing Lead' }

  const paid = invoiceModalFixture()
  paintInvoiceSuccess(
    paid.modal,
    { status: 'unpaid', payment_link: 'https://buy.stripe.com/test_link' },
    context,
    2500.5,
  )
  assert.equal(paid.form.style.display, 'none')
  assert.equal(paid.done.style.display, 'block')
  assert.equal(paid.binds.brand.textContent, 'Northwind Coffee')
  assert.equal(paid.binds.project.textContent, 'Growth Marketing Lead')
  assert.equal(paid.binds.amount.textContent, '$2,500.50')
  assert.equal(paid.link.href, 'https://buy.stripe.com/test_link')
  assert.equal(paid.link.target, '_blank')
  assert.equal(paid.link.rel, 'noopener noreferrer')
  assert.equal(paid.wrap.style.display, '')

  // Without a payment_link the styled button itself has to go: hiding only the
  // overlay anchor would leave a visible, dead "View in Stripe" button.
  const unpayable = invoiceModalFixture()
  paintInvoiceSuccess(unpayable.modal, { status: 'unpaid' }, context, 10)
  assert.equal(unpayable.wrap.style.display, 'none')
  assert.equal(unpayable.link.href, '#invoice-payment-link')
})

// A member can bill several projects without reloading, and the first success
// rewrites the anchor's placeholder href — so the pay CTA has to stay findable
// afterwards, or invoice #2 sends them to invoice #1's Stripe link.
test('a second invoice in the same session repaints the Stripe button, never a stale link', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { paintInvoiceSuccess, prepareInvoiceModal } = bridge.window.Opp30
  const first = { brand: 'Northwind Coffee', title: 'Growth Marketing Lead' }
  const second = { brand: 'Halcyon Labs', title: 'Lifecycle Email Revamp' }
  const fixture = invoiceModalFixture()

  prepareInvoiceModal(fixture.modal, first)
  paintInvoiceSuccess(
    fixture.modal,
    { status: 'unpaid', payment_link: 'https://buy.stripe.com/project-675' },
    first,
    250,
  )
  assert.equal(fixture.link.href, 'https://buy.stripe.com/project-675')

  prepareInvoiceModal(fixture.modal, second)
  assert.equal(fixture.wrap.style.display, '')
  paintInvoiceSuccess(
    fixture.modal,
    { status: 'unpaid', payment_link: 'https://buy.stripe.com/project-702' },
    second,
    480,
  )
  assert.equal(fixture.binds.brand.textContent, 'Halcyon Labs')
  assert.equal(fixture.link.href, 'https://buy.stripe.com/project-702')
  assert.equal(fixture.wrap.style.display, '')

  // An invoice that comes back without a payment_link must hide the button
  // rather than leave the previous invoice's live link behind it.
  prepareInvoiceModal(fixture.modal, second)
  assert.equal(fixture.link.href, '#invoice-payment-link')
  paintInvoiceSuccess(fixture.modal, { status: 'unpaid' }, second, 90)
  assert.equal(fixture.wrap.style.display, 'none')
  assert.equal(fixture.link.href, '#invoice-payment-link')
})

test('openInvoiceModal opens through modal.js and only falls back to showModal', async () => {
  let live = false
  let showModalCalls = 0
  const opens = []
  const modal = {
    open: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    showModal() {
      showModalCalls += 1
    },
  }
  const bridge = await loadBridge(async () => response({}), {
    querySelector: (selector) =>
      live && selector === '[data-modal-target="generate-invoice"]' ? modal : null,
  })
  live = true
  const card = invoiceCard({ title: 'Growth', company: 'Acme Co' })

  bridge.window.lumos = {
    modal: { list: { 'generate-invoice': { open: () => opens.push('modal.js'), el: modal } } },
  }
  assert.equal(bridge.window.Opp30.openInvoiceModal(card), true)
  assert.deepEqual(opens, ['modal.js'])
  assert.equal(showModalCalls, 0)

  bridge.window.lumos = undefined
  assert.equal(bridge.window.Opp30.openInvoiceModal(card), true)
  assert.equal(showModalCalls, 1)
})

test('redirectForeignBrandToFeed redirects only on ownership-denied statuses', async () => {
  const denied404 = await loadBridge(async () => response({}))
  assert.equal(denied404.window.Opp30.redirectForeignBrandToFeed({ status: 404 }), true)
  assert.equal(denied404.location.href, '/opportunities-brands-view')

  const denied403 = await loadBridge(async () => response({}))
  assert.equal(denied403.window.Opp30.redirectForeignBrandToFeed({ status: 403 }), true)
  assert.equal(denied403.location.href, '/opportunities-brands-view')

  // Transient / server / network errors must NOT bounce the (possibly real) owner.
  const server = await loadBridge(async () => response({}))
  assert.equal(server.window.Opp30.redirectForeignBrandToFeed({ status: 500 }), false)
  assert.equal(server.location.href, 'https://example.test/all-modals')

  const network = await loadBridge(async () => response({}))
  assert.equal(network.window.Opp30.redirectForeignBrandToFeed(new Error('fetch failed')), false)
  assert.equal(network.location.href, 'https://example.test/all-modals')

  const nullish = await loadBridge(async () => response({}))
  assert.equal(nullish.window.Opp30.redirectForeignBrandToFeed(null), false)
  assert.equal(nullish.location.href, 'https://example.test/all-modals')
})

test('both brand detail routes redirect a foreign brand after the owner-scoped probe returns 404', async () => {
  const member = {
    ...paidBrandMember,
    customFields: { 'brands-dashboard-url': '/brand-dashboard' },
  }
  const runRoute = async ({ pathname, search = '' }) => {
    const requests = []
    const dom = mergedFeedDom({})
    const bridge = await loadBridge(
      async (input) => {
        const url = String(input)
        requests.push(url)
        if (url.includes('/auth/trade-token/v3')) return response({ authToken: 'xano-token' })
        if (url.includes('/brand/applications/list')) {
          return response({ message: 'Not found' }, false, 404)
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      {
        member,
        pathname,
        querySelector: dom.querySelector,
        querySelectorAll: dom.querySelectorAll,
        search,
      },
    )
    await waitForRequestCount(requests, 2)
    for (let attempt = 0; attempt < 20 && bridge.location.href !== '/opportunities-brands-view'; attempt += 1) {
      await new Promise(setImmediate)
    }
    assert.equal(bridge.location.href, '/opportunities-brands-view')
    assert.match(requests[1], /\/brand\/applications\/list$/)
    if (/^\/opportunities\//.test(pathname)) {
      assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'common')
      assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), 'brand')
    }
  }

  await runRoute({
    pathname: '/opportunities-details---brand-view',
    search: '?opp=456',
  })
  await runRoute({ pathname: '/opportunities/456' })
})

test('brandFreeHome routes to /quiz until the quiz is completed, then /quiz-results', async () => {
  const bridge = await loadBridge(async () => response({}))
  const { Opp30 } = bridge.window
  assert.equal(Opp30.hasCompletedQuiz(freeBrandMember), false)
  assert.equal(Opp30.brandFreeHome(freeBrandMember), '/quiz')
  const done = {
    ...freeBrandMember,
    customFields: { 'starter-quiz': '{"status":"ready"}' },
  }
  assert.equal(Opp30.hasCompletedQuiz(done), true)
  assert.equal(Opp30.brandFreeHome(done), '/quiz-results')
  // Empty custom field is not "completed".
  assert.equal(Opp30.hasCompletedQuiz({ customFields: { 'starter-quiz': '' } }), false)
})

test('routeGuardActive reflects the html[data-route-guard] stamp', async () => {
  const off = await loadBridge(async () => response({}))
  assert.equal(off.window.Opp30.routeGuardActive(), false)

  const on = await loadBridge(async () => response({}), { routeGuard: true })
  assert.equal(on.window.Opp30.routeGuardActive(), true)
})

test('waits for an allowed guard outcome before revealing paid Brand and Talent feeds', async () => {
  for (const [role, resolvedMember] of [
    ['brand', paidBrandMember],
    ['talent', talentMember],
  ]) {
    let memberSnapshot = {
      id: `m-${role}-before-plans-hydrate`,
      customFields: {},
      planConnections: [],
    }
    const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
    const dom = mergedFeedDom(roots)
    const bridge = await loadBridge(async () => response({}), {
      member: () => memberSnapshot,
      pathname: '/opportunities',
      querySelector: dom.querySelector,
      querySelectorAll: dom.querySelectorAll,
      routeGuardScript: true,
    })

    assert.equal(dom.wrappers[role].style.display, undefined)
    memberSnapshot = resolvedMember
    bridge.documentElement.setAttribute('data-route-guard', 'allowed')

    assert.equal(await bridge.window.Opp30.waitForRouteGuardHandoff(), 'allowed')
    assert.ok(
      await waitFor(() => dom.wrappers[role].style.display === ''),
      `${role} wrapper revealed`,
    )
    assert.equal(dom.wrappers[role === 'brand' ? 'talent' : 'brand'].style.display, 'none')
    assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), role)
    assert.ok(Array.isArray(bridge.window.WfXano))
    assert.equal(bridge.window.WfXano.length, 1)
    assert.equal(bridge.window.Opp30.routeGuardActive(), true)
    assert.equal(
      bridge.location.href,
      'https://example.test/opportunities',
      'the guard owns the unresolved-role decision instead of the legacy / fallback',
    )
  }
})

test('guard errors and redirects leave the merged feed hidden without a legacy redirect', async () => {
  for (const terminal of ['error', 'redirecting']) {
    const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
    const dom = mergedFeedDom(roots)
    const bridge = await loadBridge(async () => response({}), {
      member: paidBrandMember,
      pathname: '/opportunities',
      querySelector: dom.querySelector,
      querySelectorAll: dom.querySelectorAll,
      routeGuard: 'checking',
      routeGuardScript: true,
    })

    if (terminal === 'error') {
      bridge.documentElement.setAttribute('data-route-guard-error', 'unmapped-plan')
    } else {
      bridge.documentElement.setAttribute('data-route-guard', 'redirecting')
    }

    assert.equal(await bridge.window.Opp30.waitForRouteGuardHandoff(), 'blocked')
    assert.equal(dom.wrappers.talent.style.display, undefined)
    assert.equal(dom.wrappers.brand.style.display, undefined)
    assert.equal(bridge.window.WfXano, undefined)
    assert.equal(bridge.location.href, 'https://example.test/opportunities')
  }
})

test('with the guard active, gateOrRedirect returns a matching member without a custom-field check or redirect', async () => {
  // Member has NO legacy dashboard custom-fields — legacy path would redirect.
  const bridge = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    routeGuard: true,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, paidBrandMember)
  assert.equal(bridge.location.href, 'https://example.test/all-modals') // unchanged
})

test('with the guard active, gateOrRedirect blocks a wrong-role member without redirecting', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember,
    routeGuard: true,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  assert.equal(bridge.location.href, 'https://example.test/all-modals') // unchanged
})

test('with the guard active, a logged-out visitor returns null and the guard (not opp30) redirects', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: null,
    routeGuard: true,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  assert.equal(bridge.location.href, 'https://example.test/all-modals') // opp30 did NOT redirect
})

test('without the guard, gateOrRedirect keeps the legacy custom-field redirect', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember, // no brands-dashboard-url custom field
    routeGuard: false,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  // freelancer-dashboard-url also absent -> falls back to '/'
  assert.equal(bridge.location.href, '/')
})

test('without the guard, a logged-out visitor is still sent to login by opp30', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: null,
    routeGuard: false,
  })

  const result = await bridge.window.Opp30.gateOrRedirect('brand')
  assert.equal(result, null)
  assert.equal(bridge.location.href, '/login?next=%2Fall-modals')
})

test('with the guard active, gateByPlan resolves talent/paid-brand and bails on free-brand without redirect', async () => {
  const talent = await loadBridge(async () => response({}), {
    member: talentMember,
    routeGuard: true,
  })
  const talentGate = await talent.window.Opp30.gateByPlan()
  assert.equal(talentGate.member, talentMember)
  assert.equal(talentGate.role, 'talent')
  assert.equal(talent.location.href, 'https://example.test/all-modals')

  const free = await loadBridge(async () => response({}), {
    member: freeBrandMember,
    routeGuard: true,
  })
  assert.equal(await free.window.Opp30.gateByPlan(), null)
  assert.equal(free.location.href, 'https://example.test/all-modals') // guard owns the redirect
})

test('waitForMappedMemberRole retries an authenticated snapshot until plans hydrate', async () => {
  let calls = 0
  const bridge = await loadBridge(async () => response({}), {
    member: () => {
      calls += 1
      return paidBrandMember
    },
  })
  const initialMember = {
    id: 'm-brand-before-plans-hydrate',
    customFields: {},
    planConnections: [],
  }

  const result = await bridge.window.Opp30.waitForMappedMemberRole(
    bridge.window.$memberstackDom,
    initialMember,
  )

  assert.equal(result.member, paidBrandMember)
  assert.equal(result.role, 'brand-paid')
  assert.equal(calls, 1)
})

test('waitForMappedMemberRole does not retry a complete unmapped plan snapshot', async () => {
  let calls = 0
  const bridge = await loadBridge(async () => response({}))
  const initialMember = {
    id: 'm-unmapped',
    customFields: {},
    planConnections: [{ active: true, planId: 'pln_unknown' }],
  }

  const result = await bridge.window.Opp30.waitForMappedMemberRole(
    {
      getCurrentMember: async () => {
        calls += 1
        return { data: paidBrandMember }
      },
    },
    initialMember,
  )

  assert.equal(result.member, initialMember)
  assert.equal(result.role, null)
  assert.equal(calls, 0)
})

test('waitForMappedMemberRole keeps polling after a transient Memberstack rejection', async () => {
  let calls = 0
  const bridge = await loadBridge(async () => response({}))
  const initialMember = {
    id: 'm-brand-before-plans-hydrate',
    customFields: {},
    planConnections: [],
  }

  const result = await bridge.window.Opp30.waitForMappedMemberRole(
    {
      getCurrentMember: async () => {
        calls += 1
        if (calls === 1) throw new Error('temporary Memberstack failure')
        return { data: paidBrandMember }
      },
    },
    initialMember,
  )

  assert.equal(result.member, paidBrandMember)
  assert.equal(result.role, 'brand-paid')
  assert.equal(calls, 2)
})

test('without the guard, gateByPlan sends an un-completed free brand to /quiz', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: freeBrandMember,
    routeGuard: false,
  })

  assert.equal(await bridge.window.Opp30.gateByPlan(), null)
  assert.equal(bridge.location.href, '/quiz')
})

test('without the guard, gateByPlan sends a completed free brand to /quiz-results', async () => {
  const bridge = await loadBridge(async () => response({}), {
    member: { ...freeBrandMember, customFields: { 'starter-quiz': '{"status":"ready"}' } },
    routeGuard: false,
  })

  assert.equal(await bridge.window.Opp30.gateByPlan(), null)
  assert.equal(bridge.location.href, '/quiz-results')
})

test('gateByPlan resolves paid brand under both guard states', async () => {
  const guarded = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    routeGuard: true,
  })
  const guardedGate = await guarded.window.Opp30.gateByPlan()
  assert.equal(guardedGate.member, paidBrandMember)
  assert.equal(guardedGate.role, 'brand-paid')

  const legacy = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    routeGuard: false,
  })
  const legacyGate = await legacy.window.Opp30.gateByPlan()
  assert.equal(legacyGate.member, paidBrandMember)
  assert.equal(legacyGate.role, 'brand-paid')
})

test('scheduling auth is limited to the exact Xano origin and path prefix', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init) => {
      requests.push({ input, init })
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )

  await bridge.fetch('https://attacker.test/api:tCpV3oqd/availability')
  await bridge.fetch('https://x08a-5ko8-jj1r.n7c.xano.io/not-api:tCpV3oqd/availability')

  assert.equal(requests.length, 2)
  assert.equal(requests.some(({ input }) => String(input).includes('trade-token')), false)
  assert.equal(requests.every(({ init }) => !init?.headers), true)
  assert.equal(bridge.window.__tsSchedulingAuthBridgeOwner, 'opportunities-3.0')
  assert.equal(typeof bridge.window.__tsSchedulingAuthOriginalFetch, 'function')
})

test('scheduling auth validates the effective Request URL', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init) => {
      requests.push({ input, init })
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const input = {
    url: 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability',
    toString: () => 'https://attacker.test/collect',
  }

  await bridge.fetch(input)

  assert.equal(requests.length, 1)
  assert.equal(requests[0].input, input)
  assert.equal(String(requests[0].input), 'https://attacker.test/collect')
})

test('scheduling auth supports string, URL, and Request inputs', async () => {
  const schedulingRequests = []
  const bridge = await loadBridge(
    async (input) => {
      if (String(input).includes('/auth/trade-token/v3')) {
        return response({ authToken: 'xano-a' })
      }
      schedulingRequests.push(input)
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'

  await bridge.fetch(endpoint)
  await bridge.fetch(new URL(endpoint))
  await bridge.fetch(new Request(endpoint))

  assert.equal(schedulingRequests.length, 3)
  for (const request of schedulingRequests) {
    assert.equal(request.headers.get('Authorization'), 'Bearer xano-a')
  }
})

test('scheduling retry preserves effective Request semantics and body', async () => {
  const schedulingRequests = []
  let tradeCount = 0
  const controller = new AbortController()
  const bridge = await loadBridge(
    async (input) => {
      if (String(input).includes('/auth/trade-token/v3')) {
        tradeCount += 1
        return response({ authToken: `xano-${tradeCount}` })
      }
      schedulingRequests.push(input)
      return response(
        {},
        schedulingRequests.length !== 1,
        schedulingRequests.length === 1 ? 401 : 200,
      )
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'
  const input = new Request(endpoint, {
    body: 'request-body',
    credentials: 'include',
    headers: { 'Content-Type': 'text/plain', 'X-Input': 'discarded' },
    method: 'POST',
    signal: controller.signal,
  })

  const result = await bridge.fetch(input, {
    cache: 'no-store',
    headers: { 'Content-Type': 'text/plain', 'X-Init': 'preserved' },
  })

  assert.equal(result.status, 200)
  assert.equal(tradeCount, 2)
  assert.equal(schedulingRequests.length, 2)
  assert.equal(input.bodyUsed, true)
  for (const [index, request] of schedulingRequests.entries()) {
    assert.equal(request.method, 'POST')
    assert.equal(request.credentials, 'include')
    assert.equal(request.cache, 'no-store')
    assert.equal(request.signal.aborted, false)
    assert.equal(request.headers.get('X-Input'), null)
    assert.equal(request.headers.get('X-Init'), 'preserved')
    assert.equal(request.headers.get('Authorization'), `Bearer xano-${index + 1}`)
    assert.equal(await request.text(), 'request-body')
  }
  controller.abort()
  assert.equal(schedulingRequests.every((request) => request.signal.aborted), true)
})

test('scheduling auth leaves already-authorized requests untouched', async () => {
  const requests = []
  const bridge = await loadBridge(
    async (input, init) => {
      requests.push({ input, init })
      return response({})
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'
  const request = new Request(endpoint, { headers: { Authorization: 'Bearer native' } })

  await bridge.fetch(request)

  assert.equal(requests.length, 1)
  assert.equal(requests[0].input, request)
  assert.equal(requests[0].init, undefined)
})

test('auth switch rejects an in-flight scheduling response', async () => {
  const schedulingResponse = deferred()
  const requests = []
  const bridge = await loadBridge(
    async (input) => {
      requests.push(input)
      if (String(input).includes('/auth/trade-token/v3')) {
        return response({ authToken: 'xano-a' })
      }
      return schedulingResponse.promise
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'

  const request = bridge.fetch(endpoint)
  await waitForRequestCount(requests, 2)
  bridge.authChange({ id: 'member-b' })
  schedulingResponse.resolve(response({ slots: [] }))

  await assert.rejects(request, { code: 'MEMBER_SCOPE_CHANGED' })
})

test('scheduling retry preserves fetch network failures', async () => {
  const networkError = new TypeError('fetch failed')
  let schedulingCount = 0
  let tradeCount = 0
  const bridge = await loadBridge(
    async (input) => {
      if (String(input).includes('/auth/trade-token/v3')) {
        tradeCount += 1
        return response({ authToken: `xano-${tradeCount}` })
      }
      schedulingCount += 1
      if (schedulingCount === 1) return response({}, false, 401)
      throw networkError
    },
    { hostname: 'the-starters-3-0.webflow.io' },
  )
  const endpoint = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/availability'

  await assert.rejects(bridge.fetch(endpoint), networkError)
  assert.equal(tradeCount, 2)
  assert.equal(schedulingCount, 2)
})

test('auth switch during token acquisition does not retry under the new member', async () => {
  const tokenResponse = deferred()
  const requests = []
  const bridge = await loadBridge(async (url, options) => {
    requests.push({ url, options })
    return tokenResponse.promise
  })
  bridge.authChange({ id: 'member-a' })

  const request = bridge.API.brandOppCreate({ title: 'A request' })
  await waitForRequestCount(requests, 1)

  bridge.authChange({ id: 'member-b' })
  tokenResponse.resolve(response({ authToken: 'xano-a' }))

  await assert.rejects(request, { code: 'MEMBER_SCOPE_CHANGED' })
  assert.equal(requests.length, 1)
})

test('auth switch rejects an in-flight response before it can resolve or track', async () => {
  const apiResponse = deferred()
  const requests = []
  const bridge = await loadBridge(async (url, options) => {
    requests.push({ url, options })
    if (url.includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-a' })
    }
    return apiResponse.promise
  })
  bridge.authChange({ id: 'member-a' })

  const request = bridge.API.brandOppCreate({ title: 'A request' })
  await waitForRequestCount(requests, 2)
  assert.equal(requests[1].options.headers.Authorization, 'Bearer xano-a')

  bridge.authChange({ id: 'member-b' })
  apiResponse.resolve(response({ id: 42 }))

  await assert.rejects(request, { code: 'MEMBER_SCOPE_CHANGED' })
  assert.deepEqual(bridge.trackCalls, [])
  assert.equal(requests.length, 2)
})

// --- Merged /opportunities feed (one page, role wrappers, deferred wf-xano) ---

function roleWrapper(role) {
  return {
    getAttribute: (name) => (name === 'data-opp-role' ? role : null),
    style: {},
  }
}

function deferredRoot(role) {
  return { __role: role }
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (check()) return true
    await new Promise(setImmediate)
  }
  return check()
}

function mergedFeedDom(roots) {
  const wrappers = { talent: roleWrapper('talent'), brand: roleWrapper('brand') }
  const navbarAttributes = new Map([['data-preview-nav', 'common']])
  const navbar = {
    getAttribute: (name) => navbarAttributes.get(name) || null,
    setAttribute: (name, value) => navbarAttributes.set(name, String(value)),
  }
  return {
    navbar,
    wrappers,
    querySelector: (selector) => {
      const match = /^\[data-opp-role="(talent|brand)"\] \[wf-xano-element="wrapper"\]\[wf-xano-defer="true"\]$/.exec(selector)
      if (match) return roots[match[1]] || null
      return null
    },
    querySelectorAll: (selector) => {
      if (selector === '[data-opp-role]') return [wrappers.talent, wrappers.brand]
      if (selector === '[data-preview-nav]') return [navbar]
      return []
    },
  }
}

test('boot routes bare /opportunities to the merged feed: talent wrapper + only the talent feed activates', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  assert.ok(await waitFor(() => dom.wrappers.talent.style.display === ''), 'talent wrapper revealed')
  assert.equal(dom.wrappers.brand.style.display, 'none')
  assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'freelancer')
  // This VM has no CSSOM; the resolved stamp proves the anti-flash selector no longer applies.
  assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), 'talent')
  assert.equal(bridge.documentElement.getAttribute('data-opp30-talent-algolia'), 'wf-xano')

  // wf-xano not loaded yet in this harness: activation queued on the pre-load array.
  assert.ok(Array.isArray(bridge.window.WfXano))
  assert.equal(bridge.window.WfXano.length, 1)
  const inits = []
  bridge.window.WfXano[0]({ init: (root) => inits.push(root) })
  assert.deepEqual(inits, [roots.talent], 'only the talent root is activated')
  assert.equal(bridge.location.href, 'https://example.test/opportunities', 'no redirect')
})

test('merged feed for a paid brand: brand wrapper + only the brand feed activates', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: paidBrandMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  assert.ok(await waitFor(() => dom.wrappers.brand.style.display === ''), 'brand wrapper revealed')
  assert.equal(dom.wrappers.talent.style.display, 'none')
  assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'brand')
  assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), 'brand')
  assert.equal(bridge.documentElement.getAttribute('data-opp30-talent-algolia'), null)

  assert.ok(Array.isArray(bridge.window.WfXano))
  assert.equal(bridge.window.WfXano.length, 1)
  const inits = []
  bridge.window.WfXano[0]({ init: (root) => inits.push(root) })
  assert.deepEqual(inits, [roots.brand], 'only the brand root is activated')
  assert.equal(bridge.window.__opp30CloseWired, true, 'brand close-opportunity modal wired')
  assert.equal(bridge.window.__opp30CreatePage, true, 'brand create form binder ran')
})

test('merged feed re-applies the Talent navbar role after Webflow restores the authored component value', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: talentMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  assert.ok(await waitFor(() => dom.navbar.getAttribute('data-preview-nav') === 'freelancer'))
  dom.navbar.setAttribute('data-preview-nav', 'common')
  bridge.notifyMutations([{ type: 'attributes', target: dom.navbar }])
  assert.equal(dom.navbar.getAttribute('data-preview-nav'), 'freelancer')
})

test('merged feed with the guard active bails quietly for a free brand (guard owns the redirect)', async () => {
  const roots = { talent: deferredRoot('talent'), brand: deferredRoot('brand') }
  const dom = mergedFeedDom(roots)
  const bridge = await loadBridge(async () => response({}), {
    member: freeBrandMember,
    pathname: '/opportunities',
    querySelector: dom.querySelector,
    querySelectorAll: dom.querySelectorAll,
    routeGuard: true,
  })

  await bridge.window.Opp30.initMergedOppFeed()
  assert.equal(dom.wrappers.talent.style.display, undefined)
  assert.equal(dom.wrappers.brand.style.display, undefined)
  assert.equal(bridge.documentElement.getAttribute('data-opp-role-resolved'), null)
  assert.equal(bridge.window.WfXano, undefined, 'no feed activation queued')
  assert.equal(bridge.location.href, 'https://example.test/opportunities')
})

test('activateDeferredFeed runs immediately when wf-xano is already loaded', async () => {
  const bridge = await loadBridge(async () => response({}), { member: talentMember })
  const inits = []
  bridge.window.WfXano = { init: (root) => inits.push(root) }
  const root = deferredRoot('talent')
  bridge.window.Opp30.activateDeferredFeed(root)
  assert.deepEqual(inits, [root])
})
