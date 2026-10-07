// NODE_PATH=<wf-xano>/node_modules WF_XANO_SOURCE=<wf-xano>/wf-xano.js node --test v3/hire-unclaimed-public-cards.integration.cjs
// An unclaimed admin-prebuilt profile has no Memberstack id. Its public Xano
// cards must still render, and no member-bound request may run.
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

const card = (extra = '') => `<div wf-xano-element="template" data-service-card="component"${extra}>
  <p data-service-card-element="title">Service Name</p>
  <p data-service-card-element="description">Service Description</p>
  <span wf-xano-bind="price" data-millify="" data-millify-max="5000">000</span></div>`

const signupHook = ' data-signup-trigger-element="service" data-signup-trigger-value="Template Signup"'

for (const memberstackId of ['', undefined]) for (const libraryFirst of [false, true]) {
  test(`unclaimed profile paints public cards, id=${JSON.stringify(memberstackId)}, libraryFirst=${libraryFirst}`, async () => {
    const errors = []
    const warnings = []
    const vc = new VirtualConsole()
    vc.on('jsdomError', error => errors.push(error.message))
    vc.on('warn', message => warnings.push(String(message)))
    const dom = new JSDOM(`<body><div data-starter-xano-id="">1264</div>
      <div wf-xano-element="wrapper" wf-xano-instance="starter-retainer" wf-xano-source="KZf7nFnk:profile/starter/taxonomy/v3"
        wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="1264" wf-xano-param-kind="retainer">
        <a data-service-card="component" data-service-card-type="tout" href="#services"><span wf-xano-bind="price" data-millify="">0</span></a>
      </div>
      <section id="services">
        <div wf-xano-element="wrapper" wf-xano-instance="starter-retainer" wf-xano-source="KZf7nFnk:profile/starter/taxonomy/v3"
          wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="1264" wf-xano-param-kind="retainer">${card(signupHook)}</div>
        <div wf-xano-element="wrapper" wf-xano-instance="starter-services" wf-xano-source="KZf7nFnk:profile/starter/taxonomy/v3"
          wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="1264" wf-xano-param-kind="services">${card(signupHook)}</div>
      </section></body>`, { url: 'https://www.thestarters.com/hire/nik', runScripts: 'outside-only', virtualConsole: vc })
    const w = dom.window
    const requests = []
    const globals = { MEMBER: {}, memberReady: Promise.resolve({}), waitForMember: cb => cb({}), stripe_charges: false,
      qs: (selector, scope) => (scope || w.document).querySelector(selector),
      qsa: (selector, scope) => (scope || w.document).querySelectorAll(selector),
      WfXanoConfig: { xanoBase: 'https://fixture.invalid', preAuth: false, debug: false },
      IntersectionObserver: class { observe() {} disconnect() {} }, formatWithTimezone: () => ({ list: {} }) }
    if (memberstackId !== undefined) globals.starter_memberstack_id = memberstackId
    Object.assign(w, globals)
    w.fetch = async (url, options = {}) => {
      const parsed = new URL(url, 'https://fixture.invalid')
      requests.push(parsed.pathname + '?' + parsed.searchParams.toString())
      const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
      if (parsed.pathname.endsWith('/profile/starter/rates/v3')) {
        assert.equal(parsed.searchParams.get('kind'), 'retainer')
        return json({ items: [{ id: 'retainer:1264', type: 'retainer', name: 'Retainer', price: 2000 }] })
      }
      if (parsed.pathname.endsWith('/profile/starter/retainer/v3')) {
        return json({ items: [{ id: 'retainer:1264', name: 'Ongoing Advisory Retainer', description: 'Four 60-minute calls per month.', price: 2000 }] })
      }
      if (parsed.pathname.endsWith('/profile/starter/taxonomy/v3') && parsed.searchParams.get('kind') === 'services') {
        return json({ items: [{ id: '1264:0', name: 'Amazon Marketing Audit', description: 'Audit fixture', price: 6000 }] })
      }
      assert.fail(`Unexpected request ${parsed.pathname}`)
    }
    w.eval(millify)
    if (libraryFirst) {
      w.eval(library)
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
      await until(() => w.document.querySelector('[wf-xano-item]'), 'library render')
      w.eval(page)
    } else {
      w.eval(page)
      w.eval(library)
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'))
    }
    await until(() => w.document.querySelector('[data-xano-service-card]') && w.document.querySelector('[data-xano-retainer-card]') &&
      w.document.querySelector('[data-canonical-hero-rate="retainer"]'), 'public cards')

    const service = w.document.querySelector('[data-xano-service-card]')
    assert.equal(service.querySelector('[data-service-card-element="title"]').textContent, 'Amazon Marketing Audit')
    assert.equal(service.querySelector('[data-service-card-element="description"]').textContent, 'Audit fixture')
    const retainer = w.document.querySelector('[data-xano-retainer-card]')
    assert.equal(retainer.querySelector('[data-service-card-element="title"]').textContent, 'Ongoing Advisory Retainer')
    assert.equal(retainer.querySelector('[data-service-card-element="description"]').textContent, 'Four 60-minute calls per month.')
    assert.equal(retainer.querySelector('[wf-xano-bind="price"]').getAttribute('data-millify'), '2000')
    const hero = w.document.querySelector('[data-canonical-hero-rate="retainer"]')
    assert.equal(hero.querySelector('[wf-xano-bind="price"]').getAttribute('data-millify'), '2000')
    // Read-only: no project wiring and no clickable affordance for a profile with no member.
    for (const node of [service, retainer]) {
      assert.equal(node.getAttribute('data-modal-trigger'), null)
      assert.equal(node.getAttribute('data-signup-trigger-element'), null)
      assert.equal(node.getAttribute('data-signup-trigger-value'), null)
      assert.notEqual(node.style.cursor, 'pointer')
    }
    assert.ok(warnings.some(m => m.includes('member profile scripts stood down')))
    assert.ok(requests.every(r => /\/profile\/starter\/(rates|retainer|taxonomy)\/v3\?/.test(r)), requests.join('\n'))
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.deepEqual(errors, [])
    w.close()
  })
}
