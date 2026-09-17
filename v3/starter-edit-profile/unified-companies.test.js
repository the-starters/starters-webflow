const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const { h, makeEvent } = require('../test-helpers/form-dom.cjs')
const tick = () => new Promise(resolve => setImmediate(resolve))
const BASELINE_ASSOCIATIONS = '{"client-1":{"name":"Acme","domain":"acme.example","logo_url":"","client_row_id":1,"company_entity_id":0,"source":"custom"}}'
const EDITED_ASSOCIATIONS = '{"client-1":{"name":"Acme","domain":"acme.example","logo_url":"","client_row_id":1,"company_entity_id":0,"source":"custom"},"client-2":{"name":"Beta","domain":"beta.example","logo_url":"","client_row_id":0,"company_entity_id":0,"source":"custom"}}'

async function mount({ companies = [], fail = null, minimum = true, withRow = true, withSave = true,
  required = ['company_name', 'job_title'], xanoRequired = [], hydrate = true, initialOther = '{}',
  liveAssociationReader = false, associationReadStatus = 200, claim = true, normalize = null,
  answer = null, picker = true } = {}) {
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
  // The picker claims the shared field as it initializes, exactly as company-autocomplete.js
  // does on the page. `claim: false` is the page where no picker owns the field at all.
  const other = h('input', { id: 'also-worked-with',
    ...(claim ? { 'data-starter-also-worked-with-state': 'pending' } : {}) })
  const section = h('section', { 'profile-unified-items': 'companies' },
    [h('div', {}, withRow ? [row] : []), ...(withSave ? [save] : []), add, discard, presence, other])
  const requests = []
  const warnings = []
  let nextId = 10
  let nextUuid = 0
  let storedOther = ''
  let stored = structuredClone(companies)
  let boot
  const document = {
    readyState: 'complete', createElement: tag => h(tag),
    querySelector: selector => section.querySelector(selector),
    querySelectorAll: selector => section.querySelectorAll(selector),
    addEventListener() {},
  }
  // The live reader lives in company-autocomplete.js. Loading it here exercises the real
  // failure handling instead of a stub that can only ever look healthy.
  const windowStub = { matchMedia: () => ({ matches: false }) }
  if (!liveAssociationReader) windowStub.fetchAlsoWorkedWithCompanies = async () => {
    try { return storedOther ? JSON.parse(storedOther) : {} } catch (error) { return {} }
  }
  if (liveAssociationReader) windowStub.xanoAuthFetch = async () => associationReadStatus === 200
    ? { ok: true, json: async () => {
      let parsed = {}
      try { parsed = storedOther ? JSON.parse(storedOther) : {} } catch (error) { parsed = {} }
      return Object.values(parsed).map((company, index) => ({
        id: index + 1, company_name: company.name, company_domain: company.domain,
        company_entity_id: company.company_entity_id || 0, company_source: company.source || '',
      }))
    } }
    : { ok: false, status: associationReadStatus }
  const context = vm.createContext({
    window: windowStub, document,
    Event: class { constructor(type, options) { Object.assign(this, makeEvent(type, null, options)) } },
    MEMBER: { id: 'test-member' },
    crypto: { randomUUID: () => 'generated-' + ++nextUuid },
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
      if (String(url).includes('set_also_worked_with')) {
        // The association write lands before the answer can be lost.
        storedOther = body.also_worked_with
        if (result === 'lose') throw new Error('Response lost')
        if (result && result.status) return { ok: false, status: result.status, json: async () => result.body }
        return { ok: true, json: async () => [1] }
      }
      if (result === 'lose') throw new Error('Response lost')
      if (result && result.status) return {
        ok: false, status: result.status,
        // A non-JSON refusal answers exactly as fetch does: json() throws, text() has the body.
        json: async () => { if (result.text !== undefined) throw new SyntaxError('Unexpected token <'); return result.body },
        text: async () => result.text !== undefined ? result.text : JSON.stringify(result.body ?? null),
      }
      if (request.method === 'GET') return { ok: true, json: async () => ({ companies: structuredClone(stored), starter_id: 7 }) }
      let value
      if (request.method === 'POST') {
        stored = stored.filter(item => Number(item.id) !== Number(body.replace_companies_id))
        value = { ...body, id: nextId++ }
        // Xano answers with the columns it stores, which need not echo the request field for field.
        stored.push(normalize ? normalize(value) : value)
      } else if (request.method === 'PATCH') {
        value = { ...body, id: Number(url.split('/').at(-1)) }
        const storedValue = normalize ? normalize(value) : value
        stored = stored.map(item => item.id === storedValue.id ? storedValue : item)
      } else stored = stored.filter(item => item.id !== Number(url.split('/').at(-1)))
      // Xano decides how much of the row its answer carries; `answer` is that choice.
      return { ok: true, json: async () => value ? (answer ? answer(value) : value) : { deleted: true } }
    },
  })
  // Both the Edit and the Build copies publish a picker initializer; these rows must reach the
  // Edit one. `company-autocomplete.js` loads before the section on the page, so the spies are
  // in place before the section binds; installing them again after the files load lets the spy
  // stand in for whichever copy the loaded scripts published. `picker: false` is the page that
  // never loaded the Edit picker at all.
  const pickerCalls = { edit: [], legacy: [] }
  function installPicker() {
    if (!picker) return
    windowStub.StarterEditLogoSearchInit = field => { pickerCalls.edit.push(field) }
    windowStub.logoSearchInit = field => { pickerCalls.legacy.push(field) }
  }
  installPicker()
  const files = ['profile-section-validation.js', 'unified-companies.js', 'company-experience-crud.js']
  if (liveAssociationReader) files.unshift('company-autocomplete.js')
  for (const file of files) {
    vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context, { filename: file })
  }
  // A classic script's top-level declarations are window properties on the published page.
  if (liveAssociationReader) windowStub.fetchAlsoWorkedWithCompanies = context.fetchAlsoWorkedWithCompanies
  installPicker()
  function hydrateOther(value) {
    other.value = value
    other.dispatchEvent(makeEvent('starter:also-worked-with-hydrated', other, { bubbles: true }))
  }
  function failOther() {
    other.dispatchEvent(makeEvent('starter:also-worked-with-hydration-failed', other, { bubbles: true }))
  }
  // The picker hydrates on its own, after the section has started loading.
  if (hydrate) {
    setImmediate(() => hydrateOther(initialOther))
    await boot
  } else await tick()
  const click = element => element.dispatchEvent(makeEvent('click', element, { bubbles: true }))
  const field = (key, index = 0) => section.querySelectorAll('[profile-item-row]')[index].querySelector('[profile-company-field="' + key + '"]')
  function type(key, value, index = 0) {
    const input = field(key, index); input.value = value
    input.dispatchEvent(makeEvent('input', input, { bubbles: true }))
  }
  // A custom pick in the real picker clears the canonical identity it replaces.
  function company(name, index = 0) {
    type('company_name', name, index)
    Object.assign(field('company_name', index).dataset, { selectedCompanyName: name, selectedCompanySource: 'custom',
      selectedCompanyDomain: '', selectedCompanyLogoUrl: '', selectedCompanyEntityId: '0' })
    field('company_name', index).dispatchEvent(makeEvent('change', field('company_name', index), { bubbles: true }))
  }
  function editOther(value) {
    other.value = value
    other.dispatchEvent(makeEvent('input', other, { bubbles: true }))
    other.dispatchEvent(makeEvent('change', other, { bubbles: true }))
  }
  return { section, save, add, discard, click, field, type, company, requests, context, warnings,
    other, hydrateOther, failOther, editOther, pickerCalls,
    otherRequests: () => requests.filter(item => String(item.url).includes('set_also_worked_with')),
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

test('clearing "I currently work here" saves an empty End month instead of the Present sentinel', async () => {
  const page = await mount({ companies: [{ id: 1, company_name: 'Acme', company_source: 'custom',
    job_title: 'Designer', start_date: '2024-01-01', end_date: 'Present', current_work: true }] })
  assert.equal(page.field('end_date').value, '')
  assert.equal(page.field('end_date').disabled, true)
  page.field('current_work').checked = false
  page.field('current_work').dispatchEvent(makeEvent('change', null, { bubbles: true }))
  assert.equal(page.field('end_date').disabled, false)
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.mutations()[0].method, 'PATCH')
  assert.equal(page.mutations()[0].body.current_work, false)
  assert.equal(page.mutations()[0].body.end_date, '')
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.field('end_date').value, '')
})

test('partial company saves keep confirmed entries and release a create the server never took', async () => {
  const page = await mount({ fail: request => request.method === 'POST' && request.body.company_name === 'Beta' ? 'lose' : null })
  page.company('Acme'); page.type('job_title', 'Designer'); page.click(page.add)
  page.company('Beta', 1); page.type('job_title', 'Engineer', 1)
  await page.submit()
  assert.equal(page.mutations().length, 2)
  // The canonical read holds Acme and no second row at all, so the lost Beta answer is not
  // merely unconfirmed: that create is proved not to have landed.
  assert.equal(page.status(), 'That change was not saved. Your draft is kept; you can save again.')
  assert.equal(page.checkSave().hidden, true, 'there is nothing left to check')
  assert.equal(page.field('company_name', 1).value, 'Beta', 'the draft survives')
  await page.submit()
  assert.equal(page.mutations().length, 3, 'Save is usable again and re-sends only the lost create')
  assert.equal(page.mutations()[2].method, 'POST')
  assert.equal(page.mutations()[2].body.company_name, 'Beta')
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
  // Reads in order: the section load, the pre-write read for Acme, then the pre-write read for
  // Beta, which fails before that create is ever sent.
  let reads = 0
  const page = await mount({ fail: request => request.method === 'GET' && ++reads === 3 ? 'lose' : null })
  page.company('Acme'); page.type('job_title', 'Designer'); page.click(page.add)
  page.company('Beta', 1); page.type('job_title', 'Engineer', 1)
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.match(page.status(), /was not submitted/)
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

test('a company response the canonical read cannot settle still pauses Save', async () => {
  // The update reached the server, the answer was lost, and the row now holds neither what
  // was sent nor what it held before. Nothing is proved either way, so Save stays paused.
  const page = await mount({
    companies: [{ id: 1, company_name: 'Acme', job_title: 'Designer', company_source: 'custom' }],
    fail: (request, { stored, setStored }) => {
      if (request.method !== 'PATCH') return null
      setStored(stored.map(item => Number(item.id) === 1 ? { ...item, job_title: 'Engineer (in review)' } : item))
      return 'lose'
    },
  })
  page.type('job_title', 'Engineer')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.match(page.status(), /could not be confirmed/)
  assert.equal(page.checkSave().hidden, false)
  await page.submit()
  assert.equal(page.mutations().length, 1, 'an unknown write is never replayed')
  page.click(page.checkSave())
  await tick()
  assert.equal(page.status(), 'The save is still unconfirmed. Your draft is kept; Save remains paused.')
  assert.equal(page.checkSave().hidden, false)
  page.click(page.discard)
  assert.equal(page.field('job_title').value, 'Engineer', 'Discard is refused while the outcome is unknown')
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

test('a refused company save with a non-JSON body still reads as a known refusal', async () => {
  const page = await mount({ fail: request => request.method === 'POST'
    ? { status: 400, text: '<html><body>Bad Request</body></html>' } : null })
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.status(), 'The server rejected this change. Check the entry and try again.')
  assert.equal(page.checkSave().hidden, true)
  await page.submit()
  assert.equal(page.mutations().length, 2)
  page.click(page.discard)
  assert.equal(page.status(), 'Changes discarded.')
  assert.equal(page.field('company_name').value, '')
})

test('a lost Also Worked With response is resolved by Check saved state instead of blocking the section', async () => {
  const page = await mount({ minimum: false, initialOther: BASELINE_ASSOCIATIONS,
    fail: request => String(request.url).includes('set_also_worked_with') ? 'lose' : null })
  page.editOther(EDITED_ASSOCIATIONS)
  await page.submit()
  assert.equal(page.otherRequests().length, 1)
  assert.match(page.status(), /could not be confirmed/)
  assert.equal(page.checkSave().hidden, false)
  page.click(page.checkSave())
  await tick()
  assert.equal(page.checkSave().hidden, true)
  assert.match(page.status(), /confirmed/)
  await page.submit()
  assert.equal(page.otherRequests().length, 1)
  assert.equal(page.status(), 'Changes saved.')
})

test('switching a saved platform company to a same-name custom company sends the update', async () => {
  const page = await mount({ companies: [{ id: 1, company_name: 'Acme', company_domain: 'acme.example',
    company_entity_id: 73, company_source: 'platform', job_title: 'Designer' }] })
  page.company('Acme')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.mutations()[0].method, 'PATCH')
  assert.equal(page.mutations()[0].body.company_source, 'custom')
  assert.equal(page.mutations()[0].body.company_entity_id, 0)
  assert.equal(page.mutations()[0].body.company_domain, '')
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.field('company_name').dataset.selectedCompanySource, 'custom')
  assert.equal(page.field('company_name').dataset.selectedCompanyEntityId, '0')
})

test('a lost company switch the server never took releases Save instead of pausing it', async () => {
  const page = await mount({
    companies: [{ id: 1, company_name: 'Acme', job_title: 'Designer', company_domain: 'acme.example',
      company_entity_id: 73, company_source: 'platform' }],
    fail: request => request.method === 'PATCH' ? 'lose' : null,
  })
  page.company('Acme')
  await page.submit()
  assert.equal(page.mutations().length, 1)
  // The row still holds exactly what it held before the write, so the switch is proved not to
  // have landed. It is never mistaken for a confirmation, and it is not left in doubt either.
  assert.equal(page.status(), 'That change was not saved. Your draft is kept; you can save again.')
  assert.equal(page.checkSave().hidden, true, 'there is nothing left to check')
  assert.equal(page.field('company_name').dataset.selectedCompanySource, 'custom', 'the draft survives')
  await page.submit()
  assert.equal(page.mutations().length, 2, 'Save was never paused')
  assert.equal(page.mutations()[1].method, 'PATCH')
  assert.equal(page.mutations()[1].body.company_entity_id, 0)
})

test('a lost Also Worked With write stays unconfirmed when the saved set cannot be read', async () => {
  const page = await mount({ minimum: false, liveAssociationReader: true, associationReadStatus: 500,
    initialOther: BASELINE_ASSOCIATIONS,
    fail: request => String(request.url).includes('set_also_worked_with') ? 'lose' : null })
  page.editOther('{}')
  await page.submit()
  assert.equal(page.otherRequests().length, 1)
  assert.equal(page.checkSave().hidden, false)
  page.click(page.checkSave())
  await tick()
  assert.equal(page.status(), 'The save is still unconfirmed. Your draft is kept; Save remains paused.')
  assert.equal(page.checkSave().hidden, false, 'a failed canonical read never confirms a cleared association')
  await page.submit()
  assert.equal(page.otherRequests().length, 1, 'Save stays paused while the saved state is unknown')
})

test('Work Experience refuses to save until the Also Worked With baseline exists', async () => {
  const page = await mount({ minimum: false, hydrate: false })
  assert.equal(page.status(), 'Loading work experience…')
  page.editOther(EDITED_ASSOCIATIONS)
  await page.submit()
  assert.equal(page.otherRequests().length, 0, 'nothing is written before the picker baseline exists')
  assert.notEqual(page.status(), 'Changes saved.', 'a skipped association is never reported as saved')

  page.hydrateOther(BASELINE_ASSOCIATIONS)
  await tick()
  assert.equal(page.status(), '')
  page.editOther(EDITED_ASSOCIATIONS)
  await page.submit()
  assert.equal(page.otherRequests().length, 1, 'the edit is still pending and now reaches the server')
  assert.equal(page.otherRequests()[0].body.also_worked_with, EDITED_ASSOCIATIONS)
  assert.equal(page.status(), 'Changes saved.')
})

test('a failed Also Worked With hydration leaves Work Experience readable with Save refused', async () => {
  const page = await mount({ minimum: false, hydrate: false })
  page.failOther()
  await tick()
  assert.equal(page.status(), 'Work experience could not be loaded. Save is paused to protect existing entries.')
  assert.equal(page.section.inert, false, 'the section stays readable')
  page.editOther(EDITED_ASSOCIATIONS)
  await page.submit()
  assert.equal(page.otherRequests().length, 0)
})

test('Discard restores the Also Worked With draft and the next Save leaves it alone', async () => {
  const page = await mount({ minimum: false, initialOther: BASELINE_ASSOCIATIONS })
  page.editOther(EDITED_ASSOCIATIONS)
  page.click(page.discard)
  assert.equal(page.other.value, BASELINE_ASSOCIATIONS)
  assert.equal(page.status(), 'Changes discarded.')
  await page.submit()
  assert.equal(page.otherRequests().length, 0)
})

test('a section missing its row template or Save control reports the gap and disables Save', async () => {
  const unusable = 'This section could not load. Reload the page before editing.'
  const missingRow = await mount({ withRow: false })
  assert.equal(missingRow.status(), unusable)
  assert.ok(missingRow.warnings.some(args => args[0] === '[unified-companies] missing [profile-item-row] or Save control in section'))
  assert.equal(missingRow.save.getAttribute('disabled'), '')
  assert.equal(missingRow.requests.length, 0)
  const missingSave = await mount({ withSave: false })
  assert.equal(missingSave.status(), unusable)
  assert.equal(missingSave.section.querySelectorAll('[profile-item-row]').length, 1)
})

test('the presence message opens a usable row instead of the one being removed', async () => {
  const page = await mount({ companies: [{ id: 1, company_name: 'Acme', company_source: 'custom', job_title: 'Designer' }] })
  page.click(page.section.querySelector('[profile-item-remove]'))
  const rows = page.section.querySelectorAll('[profile-item-row]')
  assert.equal(rows.length, 2)
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.equal(page.status(), 'Add at least one work experience entry.')
  assert.equal(rows[0].querySelector('[profile-item-content]').hidden, true)
  assert.equal(rows[0].querySelector('[profile-items-undo]').hidden, false)
  assert.equal(rows[1].querySelector('[profile-item-content]').hidden, false)
  assert.ok(page.field('company_name', 1).focusCalls.length >= 1)
})

test('a canonical read that normalizes what it stores still confirms the save', async () => {
  // Xano answers with the columns it owns: the current-role flag without the 'Present'
  // sentinel, and no job title at all. Neither contradicts the draft, so the write is confirmed.
  const page = await mount({ normalize: value => {
    const { job_title, ...rest } = value
    return { ...rest, end_date: '' }
  } })
  page.company('Acme'); page.type('job_title', 'Designer')
  page.field('current_work').checked = true
  page.field('current_work').dispatchEvent(makeEvent('change', null, { bubbles: true }))
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.mutations()[0].body.end_date, 'Present')
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.checkSave().hidden, true)
})

test('a saved current role is not rewritten when the server stores only one of its two markers', async () => {
  const saved = { id: 1, company_name: 'Acme', company_source: 'custom', job_title: 'Designer', start_date: '2020-01-01' }
  const flagOnly = await mount({ companies: [{ ...saved, end_date: '', current_work: true }] })
  assert.equal(flagOnly.field('current_work').checked, true)
  await flagOnly.submit()
  assert.equal(flagOnly.mutations().length, 0, 'the draft matches the saved role, so nothing is written')
  assert.equal(flagOnly.status(), 'Changes saved.')

  const sentinelOnly = await mount({ companies: [{ ...saved, end_date: 'Present', current_work: false }] })
  assert.equal(sentinelOnly.field('current_work').checked, true, 'the sentinel renders as the current role it is')
  assert.equal(sentinelOnly.field('end_date').value, '')
  await sentinelOnly.submit()
  assert.equal(sentinelOnly.mutations().length, 0, 'and the role is never quietly given no end date at all')
})

test('a create answered with only an id keeps the entry it saved instead of a blank baseline', async () => {
  // The answer proves the write landed, but the row it landed is the one that was sent.
  const page = await mount({ answer: value => ({ id: value.id }) })
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.field('company_name').value, 'Acme', 'the saved entry is still on the page')
  assert.equal(page.field('job_title').value, 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 1, 'and no follow-up write pushes blanks over the server row')
})

test('a company write that never left the browser reports nothing submitted and keeps Save usable', async () => {
  const page = await mount()
  // A broken diagnostics wrapper throws before it ever calls the request.
  page.context.window.StartersNativeFormDiagnostics = {
    observeMutation() { throw new TypeError('observeMutation is not a function') },
  }
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.mutations().length, 0, 'nothing reached the server')
  assert.equal(page.status(),
    'That change was not submitted. Your draft is kept; you can save again.')
  assert.equal(page.checkSave().hidden, true, 'an unsent write leaves nothing to check')
  delete page.context.window.StartersNativeFormDiagnostics
  await page.submit()
  assert.equal(page.mutations().length, 1, 'Save was never paused')
  assert.equal(page.status(), 'Changes saved.')
})

test('a field no picker claims is ready with the value it already has', async () => {
  // No Also Worked With picker on the page: there is no hydration to wait for, so the section
  // must load rather than fail closed after a blind wait.
  const page = await mount({ minimum: false, claim: false, hydrate: false })
  for (let turn = 0; turn < 50 && page.status() !== ''; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  assert.equal(page.status(), '', 'the section finished loading')
  page.company('Acme'); page.type('job_title', 'Designer')
  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.otherRequests().length, 0, 'an unclaimed field is its own baseline')
  page.editOther(EDITED_ASSOCIATIONS)
  await page.submit()
  assert.equal(page.otherRequests().length, 1, 'a later edit is still a change against that baseline')
})

test('Work Experience rows use the Edit picker, not whichever copy loaded last', async () => {
  const page = await mount()
  assert.equal(page.pickerCalls.edit.length, 1)
  assert.equal(page.pickerCalls.edit[0], page.field('company_name'))
  assert.equal(page.pickerCalls.legacy.length, 0, 'the bare global is only the fallback')
})

test('a misconfigured form keeps saying so while the draft changes', async () => {
  const page = await mount({ required: ['company_name'], xanoRequired: ['job_title'] })
  const misconfigured = 'This form is misconfigured. Saving is paused until it is fixed.'
  assert.equal(page.status(), misconfigured)
  page.type('job_title', 'Designer')
  assert.equal(page.status(), misconfigured, 'an edit never hides the reason Save is paused')
})

test('the month-range message matches the wording the legacy company form uses', async () => {
  const page = await mount()
  page.company('Acme'); page.type('job_title', 'Designer')
  page.type('start_date', '2025-06'); page.type('end_date', '2024-06')
  await page.submit()
  assert.equal(page.mutations().length, 0)
  assert.ok(page.errors().includes('End month must be the same as or later than the start month.'))
})

test('a lost atomic replacement is confirmed by the row it created, not refused by the row it replaces', async () => {
  const companies = ['Acme', 'Beta', 'Gamma'].map((company_name, index) => ({ id: index + 1, company_name, company_source: 'custom', job_title: 'Designer' }))
  const page = await mount({ companies, fail: (request, { stored, setStored }) => {
    if (request.method !== 'POST') return null
    // The insert landed; the row it was told to replace is still there when the read runs.
    setStored([...stored, { ...request.body, id: 99 }])
    return 'lose'
  } })
  page.click(page.add)
  page.click(page.section.querySelector('[profile-item-remove]'))
  page.click(page.add)
  page.company('Delta', 3); page.type('job_title', 'Engineer', 3)
  await page.submit()
  assert.equal(page.mutations().length, 1)
  assert.equal(page.mutations()[0].body.replace_companies_id, 1)
  assert.equal(page.status(), 'Changes saved.')
  assert.equal(page.checkSave().hidden, true)
  assert.equal(page.section.querySelectorAll('[profile-item-row]').length, 3)
})

test('Work Experience fails closed when the Edit company picker script never loaded', async () => {
  const page = await mount({ picker: false })
  assert.equal(page.status(), 'This section could not load. Reload the page before editing.')
  assert.equal(page.save.getAttribute('disabled'), '')
  assert.ok(page.warnings.some(args => String(args[0]).includes('StarterEditLogoSearchInit')),
    'the missing script is named once in the console')
  assert.equal(page.requests.length, 0, 'a section that cannot pick a company never reads or writes')
  await page.submit()
  assert.equal(page.mutations().length, 0)
})
