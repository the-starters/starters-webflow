// NODE_PATH=<wf-xano>/node_modules WF_XANO_SOURCE=<wf-xano>/wf-xano.js node --test v3/hire-taxonomy-shared-read.integration.cjs
// Production order on /hire: wf-xano (head, defer) runs, then hire-profile.js
// (defer), then Webflow.push boots wf-xano. The fixture mirrors the published
// taxonomy wrapper set and counts endpoint #5860 requests per page view.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const { JSDOM, VirtualConsole } = require('jsdom')
const library = fs.readFileSync(process.env.WF_XANO_SOURCE, 'utf8')
const pageSource = fs.readFileSync(require.resolve('./hire-profile.js'), 'utf8')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const TAXONOMY = 'KZf7nFnk:profile/starter/taxonomy/v3'

function wrapper(kind, instance, extra = '') {
  return `<div wf-xano-element="wrapper" wf-xano-instance="${instance}" wf-xano-source="${TAXONOMY}"
    wf-xano-method="GET" wf-xano-auth="none" wf-xano-param-starter_id="424" wf-xano-param-kind="${kind}" ${extra}>
    <div wf-xano-element="template"><span wf-xano-bind="name"></span></div></div>`
}

test('one /hire view sends one shared Tools/Skills/Industries read and no Retainer taxonomy read', async () => {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const lists = ['tools', 'skills', 'industries']
  const dom = new JSDOM(`<body><span data-starter-xano-id>424</span>
    <section id="about">${lists.map(kind => wrapper(kind, 'starter-' + kind)).join('')}</section>
    <section id="mobile">${lists.map(kind => wrapper(kind, 'starter-' + kind)).join('')}</section>
    ${wrapper('work_histories', 'starter-work-histories')}${wrapper('clients', 'starter-clients')}
    <section id="services">${wrapper('services', 'starter-services')}${wrapper('retainer', 'starter-retainer')}</section>
    </body>`,
  { url: 'https://www.thestarters.com/hire/fixture', runScripts: 'outside-only', virtualConsole })
  const w = dom.window
  const requests = []
  const booted = []
  Object.assign(w, {
    MEMBER: {}, memberReady: Promise.resolve({}), waitForMember: callback => callback({}),
    starter_memberstack_id: 'fixture-member', stripe_charges: false,
    qs: (selector, scope) => (scope || w.document).querySelector(selector),
    qsa: (selector, scope) => (scope || w.document).querySelectorAll(selector),
    WfXanoConfig: { xanoBase: 'https://fixture.invalid', preAuth: false, debug: false },
    IntersectionObserver: class { observe() {} disconnect() {} },
    formatWithTimezone: () => ({ list: {} }),
    Webflow: { push: fn => booted.push(fn) },
  })
  w.fetch = async url => {
    const parsed = new URL(url)
    requests.push(parsed.pathname + parsed.search)
    const kind = parsed.searchParams.get('kind')
    if (parsed.pathname.endsWith('/profile/starter/taxonomy/v3') && !kind) {
      return { ok: true, status: 200, json: async () => ({
        items: [],
        tools: [{ id: 't1', name: 'Figma' }],
        skills: [{ id: 's1', name: 'Copywriting' }],
        industries: [{ id: 'i1', name: 'Fintech' }],
      }) }
    }
    return { ok: true, status: 200, json: async () => ({ items: kind ? [{ id: kind + '1', name: kind }] : [] }) }
  }
  try {
    w.eval(library)
    w.eval(pageSource)
    booted.splice(0).forEach(fn => fn())
    for (let i = 0; i < 100 && w.document.querySelectorAll('#mobile [wf-xano-item]').length < 3; i++) await pause(5)
    await pause(20)

    const taxonomy = requests.filter(url => url.includes('/profile/starter/taxonomy/v3'))
    assert.deepEqual(taxonomy.map(url => new URL(url, 'https://x').searchParams.get('kind') || '(shared)').sort(),
      ['(shared)', 'clients', 'services', 'work_histories'])
    assert.equal(requests.filter(url => url.includes('/profile/starter/retainer/v3')).length, 1)
    for (const section of ['#about', '#mobile']) {
      assert.deepEqual(Array.from(w.document.querySelectorAll(`${section} [wf-xano-item] span`)).map(node => node.textContent),
        ['Figma', 'Copywriting', 'Fintech'])
    }
    assert.equal(w.document.querySelector('[wf-xano-instance="starter-clients"] [wf-xano-item] span').textContent, 'clients')
    assert.deepEqual(errors, [])
  } finally { w.close() }
})
