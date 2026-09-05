// Local integration: NODE_PATH=<wf-xano>/node_modules WF_XANO_SOURCE=<wf-xano>/wf-xano.js node --test v3/hire-canonical-rates.integration.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const { JSDOM, VirtualConsole } = require('jsdom')
const library = fs.readFileSync(process.env.WF_XANO_SOURCE, 'utf8')
const pageSource = fs.readFileSync(require.resolve('./hire-profile.js'), 'utf8')
const millify = fs.readFileSync(require.resolve('../global-embeds/millify.js'), 'utf8')

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('Timed out waiting for real wf-xano state')
}
for (const libraryFirst of [false, true]) test(`real wf-xano canonical hero GET/render, libraryFirst=${libraryFirst}`, async () => {
  const html = `<body><span data-starter-xano-id>1063</span>${['hourly', 'retainer'].map(kind => `
    <div wf-xano-element="wrapper" wf-xano-instance="starter-${kind}" wf-xano-source="KZf7nFnk:profile/starter/taxonomy/v3" wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="1063" wf-xano-param-kind="${kind}">
      <a data-service-card="component" data-service-card-type="tout" href="#services" data-signup-trigger-value="${kind}"><span wf-xano-bind="price" data-millify="" data-millify-raw="0">0</span></a>
    </div>`).join('')}
    <section id="services"><div wf-xano-element="wrapper" wf-xano-instance="starter-retainer" wf-xano-source="KZf7nFnk:profile/starter/retainer/v3" wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="1063">
      <div wf-xano-element="template"><span wf-xano-bind="name">Advisory</span><span wf-xano-bind="price">0</span></div>
    </div></section></body>`
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM(html, { url: 'https://www.thestarters.com/hire/fixture', runScripts: 'outside-only', virtualConsole })
  const w = dom.window
  const requests = []
  let prices = { hourly: 1, retainer: 1 }
  let responseMode = 'valid'
  let releaseResponse = null
  Object.assign(w, { MEMBER: {}, memberReady: Promise.resolve({}), waitForMember: callback => callback({}),
    starter_memberstack_id: 'fixture-member', stripe_charges: false,
    qs: (selector, scope) => (scope || w.document).querySelector(selector),
    qsa: (selector, scope) => Array.from((scope || w.document).querySelectorAll(selector)),
    WfXanoConfig: { xanoBase: 'https://fixture.invalid', preAuth: false, debug: false },
    IntersectionObserver: class { observe() {} disconnect() {} },
    formatWithTimezone: () => ({ list: {} }),
  })
  w.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    requests.push({ url: parsed, method: options.method, headers: options.headers })
    if (parsed.pathname.endsWith('/profile/starter/rates/v3')) {
      if (responseMode === 'pending') await new Promise(resolve => { releaseResponse = resolve })
      if (responseMode === 'error') return { ok: false, status: 503, text: async () => 'Unavailable' }
      const kind = parsed.searchParams.get('kind')
      const items = responseMode === 'empty' ? [] : [{ id: `${kind}:1063`, type: kind, name: kind === 'hourly' ? 'Freelance' : 'Retainer', price: prices[kind] }]
      return { ok: true, status: 200, json: async () => ({ schema: 'starter_public_rates_v3', starter_id: 1063, items }) }
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) }
  }
  try {
    w.eval(millify)
    if (libraryFirst) {
      w.eval(library)
      await until(() => w.WfXano && !Array.isArray(w.WfXano))
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
      await new Promise(resolve => setTimeout(resolve, 10))
      w.eval(pageSource)
    } else {
      w.eval(pageSource)
      w.eval(library)
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
    }
    const roots = Array.from(w.document.querySelectorAll('[data-canonical-hero-rate-state]'))
    assert.equal(roots.length, 2)
    await until(() => roots.every(root => root.getAttribute('data-canonical-hero-rate-state') === 'ready'))
    const rateRequests = requests.filter(request => request.url.pathname.endsWith('/profile/starter/rates/v3'))
    assert.equal(rateRequests.length, 2, 'deferred root init must issue one real request per hero')
    assert.deepEqual(rateRequests.map(request => request.url.searchParams.get('kind')).sort(), ['hourly', 'retainer'])
    for (const request of rateRequests) {
      assert.equal(request.method, 'GET')
      assert.equal(request.url.searchParams.get('starter_id'), '1063')
    }
    const servicesRoot = w.document.querySelector('#services [wf-xano-element="wrapper"]')
    assert.equal(w.WfXano.get('starter-retainer').root, servicesRoot, 'duplicate old hero key cannot take Services ownership')
    for (const root of roots) {
      assert.equal(root.querySelector('[wf-xano-item] [wf-xano-bind="price"]').textContent, '1')
      assert.equal(root.querySelector('[wf-xano-element="template"]').style.display, 'none')
      assert.equal(root.querySelector('[wf-xano-item]').getAttribute('href'), '#services')
    }
    prices = { hourly: 1000, retainer: 25000 }
    await Promise.all(roots.map(root => w.WfXano.get(root.getAttribute('wf-xano-instance')).refresh()))
    for (const root of roots) {
      const kind = root.getAttribute('wf-xano-param-kind')
      assert.equal(root.querySelector('[wf-xano-item] [wf-xano-bind="price"]').textContent, kind === 'hourly' ? '1K' : '25K')
    }
    prices = { hourly: 15000, retainer: 250000 }
    await Promise.all(roots.map(root => w.WfXano.get(root.getAttribute('wf-xano-instance')).refresh()))
    for (const root of roots) {
      const kind = root.getAttribute('wf-xano-param-kind')
      const amount = root.querySelector('[wf-xano-item] [wf-xano-bind="price"]')
      assert.equal(amount.textContent, kind === 'hourly' ? '15K' : '250K', 'legacy canonical values must not be clamped or hidden')
      assert.equal(amount.getAttribute('data-millify'), String(prices[kind]))
    }
    const root = roots[0]; const instance = w.WfXano.get(root.getAttribute('wf-xano-instance'))
    responseMode = 'pending'
    const pending = instance.refresh()
    await until(() => releaseResponse)
    assert.equal(root.style.display, 'none', 'stale successful price hidden during refresh')
    responseMode = 'error'; releaseResponse(); await pending
    assert.equal(root.style.display, 'none', 'failed read cannot expose previous price')
    responseMode = 'empty'; await instance.refresh()
    assert.equal(root.style.display, 'none', 'disabled offer cannot expose previous price')
    assert.deepEqual(errors, [])
  } finally { w.close() }
})
