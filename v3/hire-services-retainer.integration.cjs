// NODE_PATH=<wf-xano>/node_modules WF_XANO_SOURCE=<wf-xano>/wf-xano.js node --test v3/hire-services-retainer.integration.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const { JSDOM, VirtualConsole } = require('jsdom')
const library = fs.readFileSync(process.env.WF_XANO_SOURCE, 'utf8')
const page = fs.readFileSync(require.resolve('./hire-profile.js'), 'utf8')
const millify = fs.readFileSync(require.resolve('../global-embeds/millify.js'), 'utf8')
const cases = [[1, '1'], [1000, '1K'], [5000, '5K'], [5001, '5K'], [25000, '25K'], [250000, '250K']]
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('Real Retainer controller did not finish')
}
for (const libraryFirst of [false, true]) for (const [initial, expected] of cases) {
  test(`real Services Retainer initial=${initial}, libraryFirst=${libraryFirst}`, async () => {
    const errors = []
    const vc = new VirtualConsole()
    vc.on('jsdomError', error => errors.push(error.message))
    const dom = new JSDOM(`<body><span data-starter-xano-id>1063</span>
      <section id="services"><div wf-xano-element="wrapper" wf-xano-instance="starter-retainer"
        wf-xano-source="KZf7nFnk:profile/starter/retainer/v3" wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="1063">
        <div wf-xano-element="template" data-service-card="component">
          <span data-service-card-element="title" wf-xano-bind="name">Advisory</span>
          <span data-service-card-element="description" wf-xano-bind="description"></span>
          <span wf-xano-bind="price" data-millify="" data-millify-max="5000" data-millify-raw="0">0</span>
        </div>
      </div><div data-unrelated="custom"><span data-millify="" data-millify-max="5000" data-millify-raw="0">25000</span></div></section>
      <div data-unrelated="paid"><span data-millify="" data-millify-max="5000" data-millify-raw="0">25000</span></div>
    </body>`, { url: 'https://www.thestarters.com/hire/fixture', runScripts: 'outside-only', virtualConsole: vc })
    const w = dom.window
    let price = initial
    const requests = []
    Object.assign(w, { MEMBER: {}, memberReady: Promise.resolve({}), waitForMember: cb => cb({}),
      starter_memberstack_id: 'fixture-member', stripe_charges: false,
      qs: (selector, scope) => (scope || w.document).querySelector(selector),
      qsa: (selector, scope) => (scope || w.document).querySelectorAll(selector),
      WfXanoConfig: { xanoBase: 'https://fixture.invalid', preAuth: false, debug: false },
      IntersectionObserver: class { observe() {} disconnect() {} }, formatWithTimezone: () => ({ list: {} }),
    })
    w.fetch = async (url, options = {}) => {
      const parsed = new URL(url)
      assert.ok(parsed.pathname.endsWith('/profile/starter/retainer/v3'), 'Only the canonical Retainer GET is expected')
      assert.equal(options.method, 'GET')
      assert.equal(parsed.searchParams.get('starter_id'), '1063')
      requests.push(parsed)
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'retainer:1063', name: 'Ongoing Advisory Retainer', description: 'Fixture', price }] }) }
    }
    function check(amount, text) {
      const card = w.document.querySelector('[data-xano-retainer-card]')
      assert.ok(card)
      const hook = card.querySelector('[wf-xano-bind="price"]')
      assert.equal(hook.textContent, text)
      assert.equal(hook.getAttribute('data-millify'), String(amount), 'Exact canonical amount must survive abbreviation')
      assert.equal(hook.getAttribute('data-millify-max'), null, 'Retainer must not inherit the unrelated 5000 ceiling')
      assert.equal(card.getAttribute('data-rate-card'), 'retainer')
      assert.equal(card.getAttribute('data-signup-trigger-value'), 'Retainer')
      for (const other of w.document.querySelectorAll('[data-unrelated] [data-millify]')) {
        assert.equal(other.getAttribute('data-millify-max'), '5000')
        assert.equal(other.textContent, '25000', 'Other offer guards must continue to refuse formatting')
      }
      const template = w.document.querySelector('[wf-xano-element="template"]')
      assert.equal(template.style.display, 'none')
      assert.equal(template.querySelector('[data-millify]').getAttribute('data-millify-max'), '5000')
    }
    try {
      w.eval(millify)
      if (libraryFirst) {
        w.eval(library)
        w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
        await until(() => w.document.querySelector('[wf-xano-item]'))
        w.eval(page)
      } else {
        w.eval(page)
        w.eval(library)
        w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
      }
      await until(() => w.document.querySelector('[data-xano-retainer-card]'))
      await new Promise(resolve => setTimeout(resolve, 0))
      check(initial, expected)
      assert.equal(requests.length, 1, 'Initial controller must issue one real GET')
      for (const [amount, text] of cases) {
        price = amount
        await w.WfXano.get('starter-retainer').refresh()
        await new Promise(resolve => setTimeout(resolve, 0))
        check(amount, text)
      }
      assert.equal(requests.length, cases.length + 1)
      assert.deepEqual(errors, [])
    } finally { w.close() }
  })
}
