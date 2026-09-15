// NODE_PATH=<wf-xano>/node_modules WF_XANO_SOURCE=<wf-xano>/wf-xano.js node --test v3/hire-header-touts.integration.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { JSDOM, VirtualConsole } = require('jsdom')
const library = fs.readFileSync(process.env.WF_XANO_SOURCE, 'utf8')
const pageSource = fs.readFileSync(require.resolve('./hire-profile.js'), 'utf8')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(predicate) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return
    await pause(5)
  }
  assert.fail('Timed out waiting for real Header clones')
}

function calls(surface) {
  return `<div wf-xano-element="wrapper" wf-xano-instance="starter-call-offers-${surface}"
    wf-xano-source="KZf7nFnk:profile/starter/calls/v3" wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="424">
    <div wf-xano-element="template" data-service-card="component" data-service-card-type="tout"
      has-connection="free" ${surface === 'services' ? 'data-type="free"' : ''}>
      <span data-service-card-element="title" wf-xano-bind="name"></span>
      <span data-service-card-element="description" wf-xano-bind="description"></span>
      <span data-millify="" wf-xano-bind="price"></span>
    </div></div>`
}

for (const libraryFirst of [false, true]) for (const profileType of ['Consult', 'Full']) test(`real Header clone cap and recovery: ${profileType}, libraryFirst=${libraryFirst}`, async () => {
  const errors = []
  const console = new VirtualConsole()
  console.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM(`<body><span data-starter-xano-id>424</span><span data-profile-type="${profileType}">${profileType}</span>
    <header>${['hourly', 'retainer'].map(kind => `<div wf-xano-element="wrapper" wf-xano-instance="starter-${kind}"
      wf-xano-source="KZf7nFnk:profile/starter/taxonomy/v3" wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="424" wf-xano-param-kind="${kind}">
      <a data-service-card="component" data-service-card-type="tout" href="#services"><span wf-xano-bind="price">0</span></a></div>`).join('')}
      ${calls('header')}</header><section id="services">${calls('services')}</section></body>`,
  { url: 'https://www.thestarters.com/hire/fixture', runScripts: 'outside-only', virtualConsole: console })
  const w = dom.window
  let rateMode = 'valid'
  const requests = []
  Object.assign(w, {
    MEMBER: {}, memberReady: Promise.resolve({}), waitForMember: callback => callback({}),
    starter_memberstack_id: 'fixture-member', stripe_charges: false,
    qs: (selector, scope) => (scope || w.document).querySelector(selector),
    qsa: (selector, scope) => (scope || w.document).querySelectorAll(selector),
    WfXanoConfig: { xanoBase: 'https://fixture.invalid', preAuth: false, debug: false },
    IntersectionObserver: class { observe() {} disconnect() {} },
    formatWithTimezone: () => ({ list: {} }),
  })
  w.fetch = async url => {
    const parsed = new URL(url)
    requests.push(parsed.pathname)
    if (parsed.pathname.endsWith('/profile/starter/rates/v3')) {
      if (rateMode === 'error') return { ok: false, status: 503, text: async () => 'Unavailable' }
      const kind = parsed.searchParams.get('kind')
      return { ok: true, status: 200, json: async () => ({ items: rateMode === 'empty' ? [] : [
        { id: `${kind}:424`, type: kind, name: kind, price: 100 },
      ] }) }
    }
    if (parsed.pathname.endsWith('/profile/starter/calls/v3')) return {
      ok: true, status: 200, json: async () => ({ starter_id: 424, items: ['free', 'paid'].map(type => ({
        id: `424:call:${type}`, type, name: type, description: '', price: type === 'free' ? 0 : 250,
        public_available: true, currency: 'USD', unit: '/session',
      })) }),
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) }
  }
  let mutations = 0
  const observer = new w.MutationObserver(records => {
    mutations += records.length
    if (mutations > 10000) {
      errors.push('MutationObserver did not settle')
      observer.disconnect()
      w.close()
    }
  })
  observer.observe(w.document.body, { subtree: true, childList: true, attributes: true })
  // JSDOM27 incorrectly lets inline display:block outrank a stylesheet's
  // display:none!important (also reproduced with an isolated one-div case).
  // Inspect the actual parsed matching rule here; real-browser computed-style
  // proof is still required. Do not substitute an invented hiding stylesheet.
  function importantDisplayNone(node) {
    return Array.from(w.document.styleSheets).some(sheet => Array.from(sheet.cssRules).some(rule =>
      rule.selectorText && node.matches(rule.selectorText) && rule.style.getPropertyValue('display') === 'none' &&
      rule.style.getPropertyPriority('display') === 'important'))
  }
  function visible(node) {
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (importantDisplayNone(current) || w.getComputedStyle(current).display === 'none') return false
    }
    return true
  }
  function headerOffers() {
    return Array.from(w.document.querySelectorAll('header [wf-xano-item]')).filter(visible).map(node =>
      node.getAttribute('data-type') || node.closest('[wf-xano-param-kind]').getAttribute('wf-xano-param-kind'))
  }
  function capture(stage) {
    if (!process.env.HIRE_HEADER_EVIDENCE_DIR) return
    const snapshot = w.document.documentElement.cloneNode(true)
    const heading = w.document.createElement('h1')
    heading.textContent = `Actual wf-xano Header fixture: ${profileType}, ${stage}`
    snapshot.querySelector('body').prepend(heading)
    fs.writeFileSync(path.join(process.env.HIRE_HEADER_EVIDENCE_DIR,
      `header-${profileType.toLowerCase()}-${libraryFirst ? 'library-first' : 'page-first'}-${stage}.html`), '<!doctype html>\n' + snapshot.outerHTML)
  }
  try {
    if (libraryFirst) {
      w.eval(library)
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
      await until(() => w.document.querySelectorAll('[wf-xano-item]').length === 4)
      assert.equal(w.document.querySelectorAll('header [wf-xano-item][has-connection="free"]').length, 2,
        'actual Header clones must exist before hire-profile bootstrap')
      assert.equal(w.document.querySelectorAll('#services [wf-xano-item][data-type="free"]').length, 2)
      assert.doesNotThrow(() => w.eval(pageSource), 'early call tracking cannot depend on later qs assignment')
    } else {
      w.eval(pageSource)
      w.eval(library)
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
    }
    await until(() => w.document.querySelectorAll('[data-xano-call-card]').length === 4 &&
      Array.from(w.document.querySelectorAll('[data-canonical-hero-rate-state]')).every(root =>
        root.getAttribute('data-canonical-hero-rate-state') === 'ready'))
    await pause(20)
    assert.deepEqual(headerOffers(), ['hourly', 'retainer', 'free'])
    const servicePaid = w.document.querySelector('#services [data-type="paid"]')
    assert.equal(visible(servicePaid), true)
    assert.equal(servicePaid.getAttribute('data-header-tout-excluded'), null)
    const headerPaid = w.document.querySelector('header [data-type="paid"]')
    assert.equal(importantDisplayNone(headerPaid), true, 'production stylesheet must match the excluded real clone')
    capture('four-offers')
    const hourly = w.document.querySelector('header [wf-xano-param-kind="hourly"]')
    const instance = w.WfXano.get(hourly.getAttribute('wf-xano-instance'))
    rateMode = 'error'; await instance.refresh(); await pause(20)
    assert.deepEqual(headerOffers(), profileType === 'Full' ? ['retainer', 'free'] : ['retainer', 'free', 'paid'])
    assert.equal(visible(servicePaid), true)
    if (profileType === 'Full') assert.equal(headerPaid.getAttribute('data-header-tout-excluded'), 'profile-type')
    else assert.equal(headerPaid.getAttribute('aria-hidden'), null)
    capture('spare-capacity')
    rateMode = 'valid'; await instance.refresh(); await pause(20)
    assert.deepEqual(headerOffers(), ['hourly', 'retainer', 'free'])
    capture('rate-recovered')
    rateMode = 'empty'; await instance.refresh(); await pause(20)
    assert.deepEqual(headerOffers(), profileType === 'Full' ? ['retainer', 'free'] : ['retainer', 'free', 'paid'])
    const settledMutations = mutations
    await pause(40)
    assert.equal(mutations, settledMutations, 'observers must stop mutating settled DOM')
    assert.ok(requests.filter(url => url.endsWith('/profile/starter/calls/v3')).length >= 2)
    assert.deepEqual(errors, [])
  } finally { observer.disconnect(); w.close() }
})
