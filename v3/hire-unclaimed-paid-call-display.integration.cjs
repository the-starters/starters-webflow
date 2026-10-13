// NODE_PATH=<wf-xano>/node_modules WF_XANO_SOURCE=<wf-xano>/wf-xano.js node --test v3/hire-unclaimed-paid-call-display.integration.cjs
// An unclaimed admin-prebuilt profile shows its Paid Call rate display-only:
// no booking, signup or modal hook, and the Free card stays hidden.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const { JSDOM, VirtualConsole } = require('jsdom')
const library = fs.readFileSync(process.env.WF_XANO_SOURCE, 'utf8')
const page = fs.readFileSync(require.resolve('./hire-profile.js'), 'utf8')
const millify = fs.readFileSync(require.resolve('../global-embeds/millify.js'), 'utf8')

async function until(predicate, label) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail(`Timed out: ${label}`)
}

// The published templates are Free cards; the paid clone is cloned from them.
const tout = `<div wf-xano-element="template" data-service-card="component" data-service-card-type="tout"
  has-connection="free" data-signup-trigger-element="service" data-signup-trigger-value="Free Call">
  <p data-service-card-element="title">Free Call</p><p data-service-card-element="description">/session</p>
  <span data-millify="" wf-xano-bind="price">0</span></div>`
const serviceCard = `<div wf-xano-element="template" data-service-card="component" booking-popup-open="" data-type="free"
  data-modal-trigger="popup-booking" has-connection="free" data-signup-trigger-element="service" data-signup-trigger-value="Free Call">
  <p data-service-card-element="title">Free Call</p>
  <div class="service-card_content-wrapper"><p next-available-slot="">00:00PM on 00/00</p></div>
  <span data-millify="" wf-xano-bind="price">0</span></div>`
const strayPaid = `<div data-service-card="component" data-type="paid" has-connection="paid"
  data-signup-trigger-element="service" data-signup-trigger-value="Paid Consulting Call">
  <p data-service-card-element="title">Paid Consulting Call</p></div>`

function callItems(paid) {
  return {
    schema: 'starter_public_calls_v3',
    items: [
      { id: '1262:call:free', type: 'free', name: 'Free Call', description: '', price: 0, currency: 'USD', unit: '/session', public_available: false },
      Object.assign({ id: '1262:call:paid', type: 'paid', name: 'Paid Consulting Call', description: '', currency: 'USD', unit: '/session', public_available: false }, paid),
    ],
  }
}

async function render({ paid, memberstackId = '', libraryFirst = false }) {
  const errors = []
  const warnings = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', error => errors.push(error.message))
  vc.on('warn', message => warnings.push(String(message)))
  const wrapper = (key, surface, body) => `<div wf-xano-element="wrapper" wf-xano-instance="${key}" data-call-offer-surface="${surface}"
    wf-xano-source="KZf7nFnk:profile/starter/calls/v3" wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="1262">
    <div wf-xano-element="list">${body}</div></div>`
  const dom = new JSDOM(`<body><div data-starter-xano-id="">1262</div><div data-profile-type="Consult"></div>
    ${wrapper('starter-call-offers-header', 'header', tout)}
    <section id="services">${wrapper('starter-call-offers-services', 'services', serviceCard + strayPaid)}</section></body>`,
  { url: 'https://www.thestarters.com/hire/moiz', runScripts: 'outside-only', virtualConsole: vc })
  const w = dom.window
  const requests = []
  Object.assign(w, { MEMBER: {}, memberReady: Promise.resolve({}), waitForMember: cb => cb({}), stripe_charges: false,
    qs: (selector, scope) => (scope || w.document).querySelector(selector),
    qsa: (selector, scope) => (scope || w.document).querySelectorAll(selector),
    WfXanoConfig: { xanoBase: 'https://fixture.invalid', preAuth: false, debug: false },
    IntersectionObserver: class { observe() {} disconnect() {} }, formatWithTimezone: () => ({ list: {} }) })
  if (memberstackId !== undefined) w.starter_memberstack_id = memberstackId
  w.fetch = async url => {
    const parsed = new URL(url, 'https://fixture.invalid')
    requests.push(parsed.pathname)
    if (parsed.pathname.endsWith('/profile/starter/calls/v3')) {
      const body = callItems(paid)
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
    }
    assert.fail(`Unexpected request ${parsed.pathname}`)
  }
  w.eval(millify)
  if (libraryFirst) {
    w.eval(library)
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
    await until(() => w.document.querySelectorAll('[wf-xano-item]').length === 4, 'library render')
    w.eval(page)
  } else {
    w.eval(page)
    w.eval(library)
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
  }
  await until(() => w.document.querySelectorAll('[wf-xano-item][data-call-offer-state]').length === 4, 'call clones settled')
  await new Promise(resolve => setTimeout(resolve, 30))
  return { w, errors, warnings, requests }
}

const BOOKING_HOOKS = ['has-connection', 'no-connection', 'data-type', 'booking-popup-open', 'data-modal-trigger',
  'data-signup-trigger-element', 'data-signup-trigger-value', 'data-call-service-direct', 'data-profile-book-call']

for (const memberstackId of ['', undefined]) for (const libraryFirst of [false, true]) {
  test(`unclaimed profile paints Paid Call $500 display-only, id=${JSON.stringify(memberstackId)}, libraryFirst=${libraryFirst}`, async () => {
    const { w, errors, warnings, requests } = await render({ paid: { price: 500 }, memberstackId, libraryFirst })
    const paid = Array.from(w.document.querySelectorAll('[data-wf-xano-id="1262:call:paid"]'))
    assert.equal(paid.length, 2)
    for (const card of paid) {
      assert.equal(card.getAttribute('data-call-display-only'), 'paid')
      assert.equal(card.getAttribute('data-call-offer-state'), 'display-only')
      assert.equal(card.style.display, 'block')
      assert.equal(card.hasAttribute('data-canonical-call-unavailable'), false)
      assert.equal(card.getAttribute('aria-hidden'), null)
      assert.equal(card.querySelector('[data-service-card-element="title"]').textContent, 'Paid Consulting Call')
      assert.equal(card.querySelector('[wf-xano-bind="price"]').getAttribute('data-millify'), '500')
      assert.equal(card.querySelector('[next-available-slot]'), null)
      for (const hook of BOOKING_HOOKS) assert.equal(card.getAttribute(hook), null, hook)
      assert.notEqual(card.style.cursor, 'pointer')
      // A click opens nothing: no modal, no signup, no booking request.
      card.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
    }
    const free = Array.from(w.document.querySelectorAll('[data-wf-xano-id="1262:call:free"]'))
    assert.equal(free.length, 2)
    for (const card of free) {
      assert.equal(card.style.display, 'none')
      assert.equal(card.getAttribute('data-call-offer-state'), 'hidden')
      for (const hook of BOOKING_HOOKS) assert.equal(card.getAttribute(hook), null, hook)
    }
    const stray = w.document.querySelector('#services [data-type="paid"]:not([wf-xano-item])')
    assert.ok(stray.hasAttribute('data-call-offer-superseded'))
    assert.ok(warnings.some(m => m.includes('member profile scripts stood down')))
    assert.ok(requests.every(r => r.endsWith('/profile/starter/calls/v3')), requests.join('\n'))
    assert.deepEqual(errors, [])
    w.close()
  })
}

for (const [label, paid] of [
  ['null price (live today)', { price: null }],
  ['zero price', { price: 0 }],
  ['fractional price', { price: 499.5 }],
  ['above the 1000 cap', { price: 5000 }],
  ['string price', { price: '500' }],
  ['public_available true is not display-only', { price: 500, public_available: true }],
]) {
  test(`unclaimed profile keeps the paid card hidden: ${label}`, async () => {
    const { w, errors } = await render({ paid })
    const paidCards = Array.from(w.document.querySelectorAll('[data-wf-xano-id="1262:call:paid"]'))
    assert.equal(paidCards.length, 2)
    for (const card of paidCards) {
      assert.equal(card.style.display, 'none')
      assert.equal(card.getAttribute('data-call-display-only'), null)
      for (const hook of BOOKING_HOOKS) assert.equal(card.getAttribute(hook), null, hook)
    }
    assert.deepEqual(errors, [])
    w.close()
  })
}
