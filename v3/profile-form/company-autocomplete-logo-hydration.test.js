'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function createHarness(file, companies, { isMulti = true, companyFetch } = {}) {
  let domReady
  let dropdown
  let nextId = 0
  const tags = []
  const inputListeners = {}
  const dropdownListeners = {}
  const valueInput = {
    value: '',
    dispatchEvent() {},
  }
  const tagTemplate = {
    cloneNode() {
      const tag = {
        dataset: {},
        name: { textContent: '' },
        domain: { textContent: '' },
        deleteButton: { addEventListener() {} },
        classList: { remove() {} },
        remove() {
          const index = tags.indexOf(tag)
          if (index !== -1) tags.splice(index, 1)
        },
      }
      return tag
    },
  }
  const tagWrapper = {
    appendChild(tag) {
      tags.push(tag)
    },
  }
  const group = {}
  const searchGroup = {
    appendChild() {},
    contains() { return false },
  }
  const input = {
    value: '',
    dataset: {},
    hasAttribute(name) { return name === 'data-multiple' && isMulti },
    closest(selector) { return selector === '[form-group]' ? group : searchGroup },
    addEventListener(name, callback) { inputListeners[name] = callback },
    focus() {},
  }
  const document = {
    addEventListener(name, callback) {
      if (name === 'DOMContentLoaded') domReady = callback
    },
    createElement() {
      dropdown = {
        className: '',
        style: {},
        innerHTML: '',
        addEventListener(name, callback) {
          dropdownListeners[name] ||= []
          dropdownListeners[name].push(callback)
        },
      }
      return dropdown
    },
  }
  const context = {
    activeProfile: {
      data: {
        step_3: {
          'also-worked-with': JSON.stringify(companies),
        },
      },
    },
    console,
    crypto: { randomUUID: () => `id-${++nextId}` },
    document,
    Event: class Event {},
    MEMBER: { id: 'member-1' },
    qsa(selector, root) {
      if (selector === '[logo-search-input]') return [input]
      if (selector === '[also-worked-tag]' && root === tagWrapper) return tags
      return []
    },
    qs(selector, root) {
      if (root === group) {
        if (selector === '[also-worked-tag].is_template') return tagTemplate
        if (selector === '[also-worked-wrapper]') return tagWrapper
        if (selector === '#also-worked-with') return valueInput
        return null
      }
      if (selector === '[also-worked-tag-name]') return root.name
      if (selector === '[also-worked-tag-domain]') return root.domain
      if (selector === '[also-worked-tag-delete]') return root.deleteButton
      return null
    },
    setTimeout,
    clearTimeout,
    waitForMember(callback) { callback() },
    waitProfileData(callback) { callback() },
    window: {
      xanoAuthFetch: async () => ({
        ok: true,
        json: async () => companyFetch ? companyFetch : companies,
      }),
    },
    fetch: async () => ({ ok: true, json: async () => [] }),
  }

  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  domReady()

  return {
    input,
    valueInput,
    clickResult(selection, { deleteResult = false } = {}) {
      let isAdded = deleteResult
      const item = {
        dataset: {
          name: selection.name,
          domain: selection.domain,
          logoUrl: selection.logo_url,
          companyEntityId: String(selection.company_entity_id || 0),
          source: selection.source || '',
        },
        classList: {
          contains(name) { return name === 'is-added' && isAdded },
          add(name) { if (name === 'is-added') isAdded = true },
          remove(name) { if (name === 'is-added') isAdded = false },
        },
      }
      const target = {
        closest(selector) {
          if (selector === '.company-search-item') return item
          if (selector === '.company-search-delete' && deleteResult) return target
          return null
        },
      }
      if (deleteResult) target.closest = function (selector) {
        if (selector === '.company-search-delete') return {
          closest(itemSelector) { return itemSelector === '.company-search-item' ? item : null },
        }
        if (selector === '.company-search-item') return item
        return null
      }
      for (const listener of dropdownListeners.click || []) listener({ target })
    },
    selectCompany(selection) {
      this.clickResult(selection)
    },
    deleteResult(selection) {
      this.clickResult(selection, { deleteResult: true })
    },
    changeInput(value) {
      input.value = value
      inputListeners.input?.()
    },
    async search(value) {
      input.value = value
      inputListeners.focus?.()
      await new Promise((resolve) => setImmediate(resolve))
      return dropdown.innerHTML
    },
  }
}

test('Build Profile preserves a hydrated company logo in the serialized selection', () => {
  const logoUrl = 'https://logos.example/acme.svg'
  const { valueInput } = createHarness(
    path.join(__dirname, '../build-profile/company-autocomplete.js'),
    { company: { name: 'Acme', domain: 'acme.example', logo_url: logoUrl } },
  )

  assert.equal(JSON.parse(valueInput.value).company.logo_url, logoUrl)
})

test('Edit Profile preserves a hydrated API company logo in the serialized selection', async () => {
  const logoUrl = 'https://logos.example/acme.svg'
  const { valueInput } = createHarness(
    path.join(__dirname, '../starter-edit-profile/company-autocomplete.js'),
    [{ id: 42, company_entity_id: 9, company_name: 'Acme', company_domain: 'acme.example', company_logo_url: logoUrl }],
  )
  await new Promise((resolve) => setImmediate(resolve))

  const serialized = JSON.parse(valueInput.value)
  const company = serialized['client-42']
  assert.equal(company.logo_url, logoUrl)
  assert.equal(company.client_row_id, 42)
  assert.equal(company.company_entity_id, 9)
})

test('Edit Profile hydration does not append a case-variant duplicate after a custom selection', async () => {
  let resolveCompanies
  const companyFetch = new Promise((resolve) => { resolveCompanies = resolve })
  const harness = createHarness(
    path.join(__dirname, '../starter-edit-profile/company-autocomplete.js'),
    [],
    { companyFetch },
  )

  harness.selectCompany({
    name: 'Acme',
    domain: '',
    logo_url: '',
    company_entity_id: 0,
    source: 'custom',
  })
  resolveCompanies([
    { id: 42, company_entity_id: 9, company_name: 'acme', company_domain: '', company_source: 'custom' },
  ])
  await new Promise((resolve) => setImmediate(resolve))

  const selected = Object.values(JSON.parse(harness.valueInput.value))
  assert.equal(selected.length, 1)
  assert.equal(selected[0].name, 'Acme')
})

for (const [label, file] of [
  ['Build Profile', path.join(__dirname, '../build-profile/company-autocomplete.js')],
  ['Edit Profile', path.join(__dirname, '../starter-edit-profile/company-autocomplete.js')],
]) {
  test(`${label} offers and serializes a custom company in Also Worked With`, async () => {
    const harness = createHarness(file, label === 'Edit Profile' ? [] : {})
    const html = await harness.search('JP Custom Client')

    assert.match(html, /data-name="JP Custom Client"/)
    assert.match(html, /data-source="custom"/)
    assert.match(html, />Use custom company</)

    harness.selectCompany({
      name: 'JP Custom Client',
      domain: '',
      logo_url: '',
      company_entity_id: 0,
      source: 'custom',
    })

    const selected = Object.values(JSON.parse(harness.valueInput.value))[0]
    assert.deepEqual({ ...selected }, {
      name: 'JP Custom Client',
      domain: '',
      logo_url: '',
      ...(label === 'Edit Profile' ? { client_row_id: 0 } : {}),
      company_entity_id: 0,
      source: 'custom',
    })

    await new Promise((resolve) => setTimeout(resolve, 1))
    const duplicateHtml = await harness.search('jp custom client')
    assert.match(duplicateHtml, /company-search-item is-added[^>]+data-name="jp custom client"/)

    harness.deleteResult({ name: 'jp custom client', domain: '', company_entity_id: 0 })
    assert.equal(Object.keys(JSON.parse(harness.valueInput.value)).length, 0)

    harness.selectCompany({
      name: 'jp custom client',
      domain: '',
      logo_url: '',
      company_entity_id: 0,
      source: 'custom',
    })
    harness.selectCompany({
      name: 'JP CUSTOM CLIENT',
      domain: '',
      logo_url: '',
      company_entity_id: 0,
      source: 'custom',
    })
    assert.equal(Object.keys(JSON.parse(harness.valueInput.value)).length, 1)
  })

  test(`${label} stores the selected Company domain and logo on the input`, async () => {
    const harness = createHarness(file, {}, { isMulti: false })
    harness.selectCompany({
      name: 'QA Wolf',
      domain: 'qawolf.com',
      logo_url: 'https://img.logo.dev/qawolf.com',
      company_entity_id: 73,
      source: 'platform',
    })

    assert.equal(harness.input.value, 'QA Wolf')
    assert.equal(harness.input.dataset.selectedCompanyName, 'QA Wolf')
    assert.equal(harness.input.dataset.selectedCompanyDomain, 'qawolf.com')
    assert.equal(harness.input.dataset.selectedCompanyLogoUrl, 'https://img.logo.dev/qawolf.com')
    assert.equal(harness.input.dataset.selectedCompanyEntityId, '73')
    assert.equal(harness.input.dataset.selectedCompanySource, 'platform')

    await new Promise((resolve) => setTimeout(resolve, 5))
    harness.changeInput('QA Wolf renamed')
    harness.changeInput('QA Wolf')
    assert.equal(harness.input.dataset.selectedCompanyName, undefined)
    assert.equal(harness.input.dataset.selectedCompanyDomain, undefined)
    assert.equal(harness.input.dataset.selectedCompanyLogoUrl, undefined)
    assert.equal(harness.input.dataset.selectedCompanyEntityId, undefined)
    assert.equal(harness.input.dataset.selectedCompanySource, undefined)
  })
}

function createCrudHarness(file, { deferredWrites = false, alsoWorkedWithStatuses = [], companyCreateStatuses = [], initialCompanies = [] } = {}) {
  let readyPromise
  let baselineTimer
  const requests = []
  const modalCounts = { success: 0, error: 0 }
  const dirtyStateCalls = []
  const renderedCards = []
  const canonicalCompanies = initialCompanies.map((company) => ({ ...company }))

  function element(value = '') {
    const listeners = new Map()
    return {
      value,
      checked: false,
      dataset: {},
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
      previousElementSibling: null,
      listeners,
      addEventListener(name, callback) {
        listeners.set(name, [...(listeners.get(name) || []), callback])
      },
      dispatchEvent(event) {
        for (const listener of listeners.get(event.type) || []) listener(event)
      },
      closest(selector) { return selector === '[form-group]' ? element() : null },
      querySelector() { return { textContent: 'Save' } },
      appendChild() {},
      cloneNode() { return element(value) },
      setAttribute() {},
      removeAttribute() {},
    }
  }

  const companyInput = element('QA Wolf')
  const jobTitleInput = element('Engineer')
  const startDateInput = element('Jan 2025')
  const endDateInput = element('Aug 2026')
  const addButton = element()
  const companyList = element()
  companyList.appendChild = (card) => { renderedCards.push(card) }
  const companyTemplate = element()
  const editWrapper = element()
  editWrapper.dataset.id = 'company-7'
  const editCompanyInput = element('QA Wolf')
  const editJobTitleInput = element('Lead Engineer')
  const editStartDateInput = element('Jan 2025')
  const editEndDateInput = element('Present')
  const editCurrentCheckbox = element()
  editCurrentCheckbox.checked = true
  const saveEditButton = element()
  const removeSubmitButton = element()
  const removeModal = element()
  const removeModalTrigger = element()
  const removeModalClose = element()
  const companySubmit = element()
  const firstCompanyInput = element('true')
  const alsoWorkedWithInput = element('{}')
  const successTrigger = element()
  const errorTrigger = element()
  successTrigger.addEventListener('click', () => { modalCounts.success += 1 })
  errorTrigger.addEventListener('click', () => { modalCounts.error += 1 })
  const elements = new Map([
    ['.company-list', companyList],
    ['#company-name', companyInput],
    ['#company-position', jobTitleInput],
    ['#company-start', startDateInput],
    ['#company-end', endDateInput],
    ['#company-current', element()],
    ['#add-company', addButton],
    ['#edit-company-wrapper', editWrapper],
    ['#edit-company-name', editCompanyInput],
    ['#edit-company-position', editJobTitleInput],
    ['#edit-company-start', editStartDateInput],
    ['#edit-company-end', editEndDateInput],
    ['#edit-company-current', editCurrentCheckbox],
    ['[save-company-edit]', saveEditButton],
    ['[company-remove-submit]', removeSubmitButton],
    ['[data-modal-target="company-remove"]', removeModal],
    ['[data-modal-trigger="company-remove"]', removeModalTrigger],
    ['[data-edit-submit="companies"]', companySubmit],
    ['#first-company', firstCompanyInput],
    ['#also-worked-with', alsoWorkedWithStatuses.length ? alsoWorkedWithInput : null],
    ["[data-modal-trigger='edit-form-success']", successTrigger],
    ["[data-modal-trigger='edit-form-error']", errorTrigger],
  ])
  const documentListeners = new Map()
  const document = {
    addEventListener(name, callback) {
      documentListeners.set(name, [...(documentListeners.get(name) || []), callback])
    },
    createElement() { return element() },
  }
  const context = {
    console,
    document,
    Event: class Event {
      constructor(type) { this.type = type }
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options })
      if (url.includes('/starter/set_also_worked_with')) {
        const status = alsoWorkedWithStatuses.shift() || 200
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => status >= 200 && status < 300 ? [3068] : { message: 'Select each new company with a valid name and domain' },
        }
      }
      if (url.endsWith('/companies') && options.method === 'POST' && companyCreateStatuses.length) {
        const status = companyCreateStatuses.shift()
        const payload = JSON.parse(options.body)
        if (status >= 200 && status < 300) {
          const company = { ...payload, id: `company-${canonicalCompanies.length + 1}` }
          canonicalCompanies.push(company)
          return { ok: true, status, json: async () => company }
        }
        return { ok: false, status, json: async () => ({ message: 'Company creation failed' }) }
      }
      return { ok: true, json: async () => ({ companies: canonicalCompanies, starter_id: 'starter-1' }) }
    },
    jQuery: undefined,
    MEMBER: { id: 'member-1' },
    qs(selector, root) {
      if (selector === 'div:first-child' && root === addButton) return { textContent: 'Add company' }
      if (selector === '.company-card' && root === companyList) return companyTemplate
      if (selector === '[data-modal-close]' && root === removeModal) return removeModalClose
      return elements.get(selector) || null
    },
    qsa() { return [] },
    setTimeout(callback, delay) {
      if (alsoWorkedWithStatuses.length && delay === 1500) baselineTimer = callback
      return 0
    },
    clearTimeout() {},
    setInterval() { return 0 },
    clearInterval() {},
    waitForMember(callback) { readyPromise = callback() },
    window: {
      __tsProfileDirtyState: {
        beginSave(stepIndex) { dirtyStateCalls.push(['begin', stepIndex]) },
        finishSave(stepIndex, saved) { dirtyStateCalls.push(['finish', stepIndex, saved]) },
      },
    },
  }

  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })

  function select(input) {
    input.dataset.selectedCompanyName = 'QA Wolf'
    input.dataset.selectedCompanyDomain = 'qawolf.com'
    input.dataset.selectedCompanyLogoUrl = 'https://img.logo.dev/qawolf.com'
    input.dataset.selectedCompanyEntityId = '73'
    input.dataset.selectedCompanySource = 'platform'
  }

  return {
    companyInput,
    editCompanyInput,
    requests,
    modalCounts,
    dirtyStateCalls,
    renderedCards,
    select,
    selectCustom(input, name = 'Private QA Company') {
      input.value = name
      input.dataset.selectedCompanyName = name
      input.dataset.selectedCompanyDomain = ''
      input.dataset.selectedCompanyLogoUrl = ''
      input.dataset.selectedCompanyEntityId = '0'
      input.dataset.selectedCompanySource = 'custom'
    },
    prepareAdd() {
      companyInput.value = 'QA Wolf'
      jobTitleInput.value = 'Engineer'
      startDateInput.value = 'Jan 2025'
      endDateInput.value = 'Aug 2026'
      select(companyInput)
    },
    async start() {
      await documentListeners.get('DOMContentLoaded')[0]()
      await readyPromise
      baselineTimer?.()
    },
    async queueAdd() {
      await addButton.listeners.get('click')[0]({ preventDefault() {} })
    },
    async queueDelete(company) {
      const card = element()
      card.dataset.id = String(company.id)
      card.dataset.company = JSON.stringify(company)
      const removeButton = element()
      await companyList.listeners.get('click')[0]({
        target: {
          closest(selector) {
            if (selector === '.company-card') return card
            if (selector === '[company-remove-open]') return removeButton
            return null
          },
        },
      })
      await removeSubmitButton.listeners.get('click')[0]({ preventDefault() {} })
    },
    changeAlsoWorkedWith(value) {
      alsoWorkedWithInput.value = JSON.stringify(value)
      alsoWorkedWithInput.dispatchEvent(new context.Event('input'))
    },
    async submitAll() {
      await companySubmit.listeners.get('click')[0]({ preventDefault() {} })
    },
    async submitAdd() {
      await addButton.listeners.get('click')[0]({ preventDefault() {} })
      if (deferredWrites) await companySubmit.listeners.get('click')[0]({ preventDefault() {} })
    },
    async submitEdit() {
      await saveEditButton.listeners.get('click')[0]({ preventDefault() {} })
      if (deferredWrites) await companySubmit.listeners.get('click')[0]({ preventDefault() {} })
    },
    async openExistingCompany(overrides = {}) {
      const card = element()
      card.dataset.id = 'company-7'
      card.dataset.company = JSON.stringify({
        id: 'company-7',
        company_name: 'QA Wolf',
        company_domain: 'qawolf.com',
        company_logo_url: 'https://img.logo.dev/qawolf.com',
        company_entity_id: 73,
        company_source: 'platform',
        job_title: 'Lead Engineer',
        start_date: 'Jan 2025',
        end_date: 'Present',
        current_work: true,
        ...overrides,
      })
      const editButton = element()
      await companyList.listeners.get('click')[0]({
        target: {
          closest(selector) {
            if (selector === '.company-card') return card
            if (selector === '[company-card-edit]') return editButton
            return null
          },
        },
      })
    },
  }
}

test('Edit Profile keeps pending work and shows an error when Also Worked With fails, then retries successfully', async () => {
  const file = path.join(__dirname, '../starter-edit-profile/company-experience-crud.js')
  const harness = createCrudHarness(file, { deferredWrites: true, alsoWorkedWithStatuses: [400, 200] })
  await harness.start()
  harness.select(harness.companyInput)
  await harness.queueAdd()
  harness.changeAlsoWorkedWith({
    'client-3068': {
      name: 'OpenStore',
      domain: '',
      logo_url: '',
      client_row_id: 3068,
      company_entity_id: 1448,
    },
  })

  await harness.submitAll()
  assert.equal(harness.modalCounts.error, 1)
  assert.equal(harness.modalCounts.success, 0)
  assert.equal(harness.requests.filter(({ url }) => url.includes('/starter/set_also_worked_with')).length, 1)
  assert.equal(harness.requests.filter(({ url, options }) => url.endsWith('/companies') && options.method === 'POST').length, 0)
  assert.deepEqual(harness.dirtyStateCalls, [['begin', 3], ['finish', 3, false]])

  await harness.submitAll()
  assert.equal(harness.modalCounts.error, 1)
  assert.equal(harness.modalCounts.success, 1)
  assert.equal(harness.requests.filter(({ url }) => url.includes('/starter/set_also_worked_with')).length, 2)
  assert.equal(harness.requests.filter(({ url, options }) => url.endsWith('/companies') && options.method === 'POST').length, 1)
  assert.deepEqual(harness.dirtyStateCalls, [
    ['begin', 3], ['finish', 3, false],
    ['begin', 3], ['finish', 3, true],
  ])
})

test('Edit Profile refreshes committed creates after a later create fails', async () => {
  const file = path.join(__dirname, '../starter-edit-profile/company-experience-crud.js')
  const harness = createCrudHarness(file, { deferredWrites: true, companyCreateStatuses: [200, 500, 200] })
  await harness.start()
  harness.prepareAdd()
  await harness.queueAdd()
  harness.prepareAdd()
  await harness.queueAdd()

  await harness.submitAll()
  assert.equal(harness.modalCounts.error, 1)
  assert.equal(harness.modalCounts.success, 0)
  assert.deepEqual(harness.renderedCards.slice(-2).map((card) => card.dataset.id), [
    'company-1',
    harness.renderedCards.at(-1).dataset.id,
  ])
  assert.match(harness.renderedCards.at(-1).dataset.id, /^draft_/)

  await harness.submitAll()
  assert.equal(harness.modalCounts.success, 1)
  assert.equal(harness.requests.filter(({ url, options }) => url.endsWith('/companies') && options.method === 'POST').length, 3)
})

test('Edit Profile atomically pairs a replacement create with its pending deletion at the three-company limit', async () => {
  const file = path.join(__dirname, '../starter-edit-profile/company-experience-crud.js')
  const existingCompanies = [1, 2, 3].map((id) => ({
    id,
    company_name: `Existing ${id}`,
    company_domain: `existing-${id}.example`,
    company_entity_id: 100 + id,
    company_source: 'platform',
    job_title: 'Engineer',
    start_date: 'Jan 2025',
    end_date: 'Aug 2026',
    current_work: false,
  }))
  const harness = createCrudHarness(file, { deferredWrites: true, initialCompanies: existingCompanies })
  await harness.start()
  await harness.queueDelete(existingCompanies[2])
  harness.selectCustom(harness.companyInput)
  await harness.queueAdd()
  await harness.submitAll()

  const createRequests = harness.requests.filter(({ url, options }) => url.endsWith('/companies') && options.method === 'POST')
  const deleteRequests = harness.requests.filter(({ url, options }) => url.endsWith('/3') && options.method === 'DELETE')
  assert.equal(createRequests.length, 1)
  assert.equal(deleteRequests.length, 0)
  assert.equal(JSON.parse(createRequests[0].options.body).replace_companies_id, 3)
  assert.equal(harness.modalCounts.success, 1)
  assert.equal(harness.modalCounts.error, 0)
})

for (const [label, file, deferredWrites] of [
  ['Build Profile', path.join(__dirname, '../build-profile/company-experience-crud.js'), false],
  ['Edit Profile', path.join(__dirname, '../starter-edit-profile/company-experience-crud.js'), true],
]) {
  test(`${label} submits picker metadata for Company creates and updates`, async () => {
    const expectedSelection = {
      freelancers_id: 'starter-1',
      company_name: 'QA Wolf',
      company_domain: 'qawolf.com',
      company_logo_url: 'https://img.logo.dev/qawolf.com',
      company_entity_id: 73,
      company_source: 'platform',
    }
    const addHarness = createCrudHarness(file, { deferredWrites })
    await addHarness.start()
    addHarness.select(addHarness.companyInput)
    await addHarness.submitAdd()

    const createRequest = addHarness.requests.find(({ options }) => options.method === 'POST')
    assert.deepEqual(JSON.parse(createRequest.options.body), {
      ...expectedSelection,
      ...(label === 'Build Profile' ? { defer_projection: true } : {}),
      job_title: 'Engineer',
      start_date: 'Jan 2025',
      end_date: 'Aug 2026',
      current_work: false,
    })

    const editHarness = createCrudHarness(file, { deferredWrites })
    await editHarness.start()
    await editHarness.openExistingCompany()
    assert.equal(editHarness.editCompanyInput.dataset.selectedCompanyDomain, 'qawolf.com')
    await editHarness.submitEdit()

    const updateRequest = editHarness.requests.find(({ options }) => options.method === 'PATCH')
    assert.equal(updateRequest.url.endsWith('/company-7'), true)
    assert.deepEqual(JSON.parse(updateRequest.options.body), {
      ...expectedSelection,
      ...(label === 'Build Profile' ? { defer_projection: true } : {}),
      job_title: 'Lead Engineer',
      start_date: 'Jan 2025',
      end_date: 'Present',
      current_work: true,
    })
  })

  test(`${label} suppresses Company writes after free typing`, async () => {
    const harness = createCrudHarness(file, { deferredWrites })
    await harness.start()
    harness.select(harness.companyInput)
    delete harness.companyInput.dataset.selectedCompanyName
    delete harness.companyInput.dataset.selectedCompanyDomain
    delete harness.companyInput.dataset.selectedCompanyLogoUrl
    delete harness.companyInput.dataset.selectedCompanyEntityId
    delete harness.companyInput.dataset.selectedCompanySource
    await harness.submitAdd()
    assert.equal(harness.requests.some(({ options }) => ['POST', 'PATCH'].includes(options.method)), false)
  })

  test(`${label} accepts a selected canonical Company without a domain`, async () => {
    const harness = createCrudHarness(file, { deferredWrites })
    await harness.start()
    harness.companyInput.dataset.selectedCompanyName = 'OpenStore'
    harness.companyInput.dataset.selectedCompanyDomain = ''
    harness.companyInput.dataset.selectedCompanyLogoUrl = 'https://logos.example/openstore.svg'
    harness.companyInput.dataset.selectedCompanyEntityId = '1448'
    harness.companyInput.dataset.selectedCompanySource = 'platform'
    harness.companyInput.value = 'OpenStore'
    await harness.submitAdd()

    const request = harness.requests.find(({ options }) => options.method === 'POST')
    const payload = JSON.parse(request.options.body)
    assert.equal(payload.company_domain, '')
    assert.equal(payload.company_entity_id, 1448)
    assert.equal(payload.company_source, 'platform')
  })

  test(`${label} accepts an explicit custom Company and sends no placeholder logo`, async () => {
    const harness = createCrudHarness(file, { deferredWrites })
    await harness.start()
    harness.companyInput.dataset.selectedCompanyName = 'My New Company'
    harness.companyInput.dataset.selectedCompanyDomain = ''
    harness.companyInput.dataset.selectedCompanyLogoUrl = ''
    harness.companyInput.dataset.selectedCompanyEntityId = '0'
    harness.companyInput.dataset.selectedCompanySource = 'custom'
    harness.companyInput.value = 'My New Company'
    await harness.submitAdd()

    const request = harness.requests.find(({ options }) => options.method === 'POST')
    const payload = JSON.parse(request.options.body)
    assert.equal(payload.company_source, 'custom')
    assert.equal(payload.company_logo_url, '')
    assert.equal(payload.company_entity_id, 0)
  })

  test(`${label} does not persist a hydrated legacy placeholder logo`, async () => {
    const harness = createCrudHarness(file, { deferredWrites })
    await harness.start()
    await harness.openExistingCompany({
      company_logo_url: 'https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6a21517ca6c1caa51f014026_company-placeholder.svg',
      logo_url: '',
    })
    assert.equal(harness.editCompanyInput.dataset.selectedCompanyLogoUrl, '')
    await harness.submitEdit()

    const request = harness.requests.find(({ options }) => options.method === 'PATCH')
    const payload = JSON.parse(request.options.body)
    assert.equal(payload.company_logo_url, '')
    assert.doesNotMatch(payload.company_logo_url, /company-placeholder/)
  })
}

test('Build Profile defers projection when deleting Company experience', async () => {
  const file = path.join(__dirname, '../build-profile/company-experience-crud.js')
  const company = {
    id: 7,
    company_name: 'QA Wolf',
    company_domain: 'qawolf.com',
    company_entity_id: 73,
    company_source: 'platform',
    job_title: 'Engineer',
    start_date: 'Jan 2025',
    end_date: 'Aug 2026',
    current_work: false,
  }
  const harness = createCrudHarness(file, { deferredWrites: false, initialCompanies: [company] })
  await harness.start()
  await harness.queueDelete(company)

  const deleteRequest = harness.requests.find(({ options }) => options.method === 'DELETE')
  assert.equal(deleteRequest.url.endsWith('/7'), true)
  assert.deepEqual(JSON.parse(deleteRequest.options.body), { defer_projection: true })
})
