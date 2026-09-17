const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const { h, makeEvent } = require('../test-helpers/form-dom.cjs')
const tick = () => new Promise(resolve => setImmediate(resolve))

async function mount({ companies = [], fail = null, minimum = true,
  required = ['company_name', 'job_title'], xanoRequired = [] } = {}) {
  const fields = ['company_name', 'job_title', 'start_date', 'end_date', 'current_work'].map(key => h('input', {
    'profile-company-field': key, name: key, id: key,
    ...(key === 'current_work' ? { type: 'checkbox' } : {}),
    ...(required.includes(key) ? { required: '' } : {}),
    ...(xanoRequired.includes(key) ? { 'form-xano-required': '' } : {}),
  }))
  const row = h('div', { 'profile-item-row': '' }, [
    h('button', { 'profile-item-toggle': '', type: 'button' }, [h('span', { 'profile-items-summary': '' })]),
    h('div', { 'profile-item-content': '' }, fields), h('button', { 'profile-item-remove': '', type: 'button' }),
  ])
  const save = h('button', { 'data-edit-submit': 'companies' })
  const add = h('button', { 'profile-items-add': '' })
  const discard = h('button', { 'profile-items-discard': '' })
  const presence = h('input', { 'profile-items-presence': '', ...(minimum ? { required: '' } : {}) })
  const section = h('section', { 'profile-unified-items': 'companies' }, [h('div', {}, [row]), save, add, discard, presence])
  const requests = []
  const warnings = []
  let nextId = 10
  let stored = structuredClone(companies)
  let boot
  const document = {
    readyState: 'complete', createElement: tag => h(tag),
    querySelector: selector => section.querySelector(selector),
    querySelectorAll: selector => section.querySelectorAll(selector),
    addEventListener() {},
  }
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }) }, document,
    Event: class { constructor(type, options) { Object.assign(this, makeEvent(type, null, options)) } },
    MEMBER: { id: 'test-member' },
    waitForMember(callback) { boot = callback() },
    qs: (selector, scope) => scope ? scope.querySelector(selector) : selector === '[profile-unified-items="companies"]' ? section : section.querySelector(selector),
    qsa: (selector, scope = section) => scope.querySelectorAll(selector),
    console: { warn(...args) { warnings.push(args) }, error() {}, log() {} },
    setTimeout, clearTimeout,
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null
      const request = { url, method: init.method || 'GET', body }
      requests.push(request)
      const result = fail?.(request, { stored, setStored: value => { stored = value } })
      if (result === 'lose') throw new Error('Response lost')
      if (result && result.status) return { ok: false, status: result.status, json: async () => result.body }
      if (request.method === 'GET') return { ok: true, json: async () => ({ companies: structuredClone(stored), starter_id: 7 }) }
      let value
      if (request.method === 'POST') {
        stored = stored.filter(item => Number(item.id) !== Number(body.replace_companies_id))
        value = { ...body, id: nextId++ }; stored.push(value)
      } else if (request.method === 'PATCH') {
        value = { ...body, id: Number(url.split('/').at(-1)) }
        stored = stored.map(item => item.id === value.id ? value : item)
      } else stored = stored.filter(item => item.id !== Number(url.split('/').at(-1)))
      return { ok: true, json: async () => value || { deleted: true } }
    },
  })
  for (const file of ['profile-section-validation.js', 'unified-companies.js', 'company-experience-crud.js']) {
    vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context, { filename: file })
  }
  await boot
  const click = element => element.dispatchEvent(makeEvent('click', element, { bubbles: true }))
  const field = (key, index = 0) => section.querySelectorAll('[profile-item-row]')[index].querySelector('[profile-company-field="' + key + '"]')
  function type(key, value, index = 0) {
    const input = field(key, index); input.value = value
    input.dispatchEvent(makeEvent('input', input, { bubbles: true }))
  }
  function company(name, index = 0) {
    type('company_name', name, index)
    Object.assign(field('company_name', index).dataset, { selectedCompanyName: name, selectedCompanySource: 'custom' })
    field('company_name', index).dispatchEvent(makeEvent('change', field('company_name', index), { bubbles: true }))
  }
  return { section, save, add, discard, click, field, type, company, requests, context, warnings,
    errors: () => section.querySelectorAll('[profile-validation-error]').map(node => node.textContent),
    checkSave: () => section.querySelector('[profile-items-check-save]'),
    mutations: () => requests.filter(item => item.method !== 'GET'),
    status: () => section.querySelector('[profile-items-status]').textContent,
    async submit() { click(save); await tick() },
  }
}

test('Work Experience saves an open entry through its specialist writer without Add', async () => {
  const page = await mount()
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.mutations()[0].method, 'POST')
  assert.deepEqual(page.mutations()[0].body, {
    company_name: 'Acme', job_title: 'Designer', start_date: '', end_date: '', current_work: false,
    company_domain: '', company_logo_url: '', company_entity_id: 0, company_source: 'custom', freelancers_id: 7,
  })
  assert.equal(page.status(), 'Changes saved.')
})

test('Work Experience Add validates, collapses, and focuses one new row without a mutation', async () => {
  const page = await mount()
  page.click(page.add)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 1)
  page.company('Acme')
  page.click(page.add)
  assert.equal(page.field('job_title').getAttribute('aria-invalid'), 'true')
  page.type('job_title', 'Designer'); page.click(page.add)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 2)
  assert.equal(page.section.querySelector('[profile-item-content]').hidden, true)
  assert.equal(page.field('company_name', 1).focusCalls.length, 1)
  assert.equal(page.mutations().length, 0)
  page.company('Beta', 1); page.type('job_title', 'Engineer', 1)
  await page.submit()
  assert.equal(page.mutations().length, 2)
})

test('Work Experience uses authored presence and requiredness, with identity and date checks for entered values', async () => {
  const page = await mount()
  await page.submit()
  assert.match(page.status(), /at least one/)
  page.type('company_name', 'Unconfirmed'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.field('company_name').getAttribute('aria-invalid'), 'true')
  page.company('Acme'); page.type('start_date', '2025-06'); page.type('end_date', '2024-06')
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.field('end_date').getAttribute('aria-invalid'), 'true')
  page.field('current_work').checked = true
  page.field('current_work').dispatchEvent(makeEvent('change', null, { bubbles: true }))
  await page.submit()
  assert.equal(page.mutations()[0].body.end_date, 'Present')
  const optional = await mount({ minimum: false })
  optional.company('Acme'); optional.field('job_title').removeAttribute('required')
  await optional.submit()
  assert.equal(optional.mutations()[0].body.job_title, '')
})

test('retained company rows participate when cleared and Remove, Undo, Discard remain local', async () => {
  const page = await mount({ companies: [{ id: 1, company_name: 'Acme', company_source: 'custom', job_title: 'Designer' }] })
  page.type('company_name', '')
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.section.querySelector('[profile-item-content]').hidden, false)
  page.click(page.discard)
  assert.equal(page.field('company_name').value, 'Acme')
  page.click(page.section.querySelector('[profile-item-remove]'))
  assert.equal(page.mutations().length, 0)
  page.click(page.section.querySelector('[profile-items-undo]'))
  assert.equal(page.field('company_name').value, 'Acme')
  page.click(page.section.querySelector('[profile-item-remove]'))
  page.click(page.discard)
  assert.equal(page.field('company_name').value, 'Acme')
})

test('partial company saves keep confirmed entries and pause an unknown create without replay', async () => {
  const page = await mount({ fail: request => request.method === 'POST' && request.body.company_name === 'Beta' ? 'lose' : null })
  page.company('Acme'); page.type('job_title', 'Designer'); page.click(page.add)
  page.company('Beta', 1); page.type('job_title', 'Engineer', 1)
  await page.submit()
  assert.equal(page.mutations().length, 2)
  assert.match(page.status(), /could not be confirmed/)
  await page.submit()
  assert.equal(page.mutations().length, 2)
  assert.equal(page.field('company_name', 1).value, 'Beta')
})

test('an atomic company replacement preserves the three-entry limit and last-entry removal follows authored presence', async () => {
  const companies = ['Acme', 'Beta', 'Gamma'].map((company_name, index) => ({ id: index + 1, company_name, company_source: 'custom', job_title: 'Designer' }))
  const page = await mount({ companies })
  page.click(page.add)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 3)
  page.click(page.section.querySelector('[profile-item-remove]'))
  page.click(page.add)
  page.company('Delta', 3); page.type('job_title', 'Engineer', 3)
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.mutations()[0].body.replace_companies_id, 1)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 3)
  const empty = await mount({ companies: [companies[0]], minimum: false })
  empty.click(empty.section.querySelector('[profile-item-remove]'))
  await empty.submit()
  assert.equal(empty.mutations()[0].method, 'DELETE')
  assert.equal(empty.section.querySelectorAll('[profile-item-row]').length, 1)
})

test('a read failure before the next mutation preserves a confirmed baseline without repeating its create', async () => {
  let reads = 0
  const page = await mount({ fail: request => request.method === 'GET' && ++reads === 4 ? 'lose' : null })
  page.company('Acme'); page.type('job_title', 'Designer'); page.click(page.add)
  page.company('Beta', 1); page.type('job_title', 'Engineer', 1)
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.match(page.status(), /next change was not submitted/)
  await page.submit()
  assert.equal(page.mutations().length, 2)
  assert.deepEqual(page.mutations().map(request => request.body.company_name), ['Acme', 'Beta'])
  page.click(page.discard)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 2)
})

test('changing the start month corrects a previously shown end-range error', async () => {
  const page = await mount()
  page.company('Acme'); page.type('job_title', 'Designer')
  page.type('start_date', '2025-06'); page.type('end_date', '2024-06')
  await page.submit()
  assert.equal(page.field('end_date').getAttribute('aria-invalid'), 'true')
  page.type('start_date', '2023-06')
  assert.equal(page.field('end_date').getAttribute('aria-invalid'), 'false')
})

test('company Save locks its section, rejects duplicate clicks, and preserves changes arriving after the snapshot', async () => {
  let page
  page = await mount({ fail: request => {
    if (request.method === 'POST') {
      assert.equal(page.section.inert, true)
      page.click(page.save)
      page.type('job_title', 'Later draft')
    }
  } })
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.field('job_title').value, 'Later draft')
  assert.match(page.status(), /Later edits are still unsaved/)
  page.click(page.discard)
  assert.equal(page.field('job_title').value, 'Designer')
})

test('a refused company save keeps the draft and leaves Save and Discard available', async () => {
  const page = await mount({ fail: request => request.method === 'POST'
    ? { status: 400, body: { message: 'Enter the position you held at this company.' } } : null })
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.status(), 'Enter the position you held at this company.')
  assert.equal(page.checkSave().hidden, true)
  assert.equal(page.field('company_name').value, 'Acme')
  await page.submit()
  assert.equal(page.mutations().length, 2)
  page.click(page.discard)
  assert.equal(page.status(), 'Changes discarded.')
  assert.equal(page.field('company_name').value, '')
  const silent = await mount({ fail: request => request.method === 'POST' ? { status: 422, body: {} } : null })
  silent.company('Acme'); silent.type('job_title', 'Designer')
  await silent.submit()
  assert.equal(silent.status(), 'The server rejected this change. Check the entry and try again.')
})

test('a lost company response still pauses Save until the saved state can be checked', async () => {
  const page = await mount({ fail: request => request.method === 'POST' ? 'lose' : null })
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.match(page.status(), /could not be confirmed/)
  assert.equal(page.checkSave().hidden, false)
  await page.submit()
  assert.equal(page.mutations().length, 1)
  page.click(page.discard)
  assert.equal(page.field('company_name').value, 'Acme')
})

test('a malformed month blocks the company save and clears once a real month is entered', async () => {
  const page = await mount()
  page.company('Acme'); page.type('job_title', 'Designer'); page.type('start_date', 'sometime 2021')
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.field('start_date').getAttribute('aria-invalid'), 'true')
  assert.ok(page.errors().includes('Enter a valid month and year.'))
  page.type('start_date', '2021-06')
  assert.equal(page.field('start_date').getAttribute('aria-invalid'), 'false')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.mutations()[0].body.start_date, '2021-06')
})

test('a backend-required field authored without Required pauses Save and warns without any value', async () => {
  const page = await mount({ required: ['company_name'], xanoRequired: ['job_title'] })
  assert.equal(page.status(), 'This form is misconfigured. Saving is paused until it is fixed.')
  assert.equal(page.warnings.length, 1)
  assert.equal(page.warnings[0][0], '[unified-companies] form-xano-required without required:')
  assert.deepEqual(Array.from(page.warnings[0][1]), ['job_title'])
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.status(), 'This form is misconfigured. Saving is paused until it is fixed.')
  assert.equal(page.warnings.length, 1)
  assert.equal(JSON.stringify(page.warnings).includes('Acme'), false)
  page.click(page.discard)
  assert.equal(page.status(), 'Changes discarded.')
  assert.equal(page.field('company_name').value, '')
})

test('a failed work experience load leaves the section usable while Save and Discard stay paused', async () => {
  const unreadable = 'Work experience could not be loaded. Save is paused to protect existing entries.'
  const page = await mount({ fail: request => request.method === 'GET' ? 'lose' : null })
  assert.equal(page.status(), unreadable)
  assert.equal(page.section.inert, false)
  assert.equal(page.section.getAttribute('aria-busy'), null)
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.status(), unreadable)
  page.click(page.discard)
  assert.equal(page.status(), unreadable)
  page.click(page.add)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 1)
})
