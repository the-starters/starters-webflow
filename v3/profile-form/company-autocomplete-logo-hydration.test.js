'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function createHarness(file, companies, { isMulti = true } = {}) {
  let domReady
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
      return {
        dataset: {},
        name: { textContent: '' },
        domain: { textContent: '' },
        deleteButton: { addEventListener() {} },
        classList: { remove() {} },
      }
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
      return {
        className: '',
        style: {},
        addEventListener(name, callback) {
          dropdownListeners[name] ||= []
          dropdownListeners[name].push(callback)
        },
      }
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
        json: async () => companies,
      }),
    },
  }

  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  domReady()

  return {
    input,
    valueInput,
    selectCompany(selection) {
      const item = {
        dataset: {
          name: selection.name,
          domain: selection.domain,
          logoUrl: selection.logo_url,
        },
        classList: { contains() { return false }, add() {} },
      }
      const target = {
        closest(selector) {
          if (selector === '.company-search-item') return item
          return null
        },
      }
      for (const listener of dropdownListeners.click || []) listener({ target })
    },
    changeInput(value) {
      input.value = value
      inputListeners.input?.()
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
    [{ company_name: 'Acme', company_domain: 'acme.example', company_logo_url: logoUrl }],
  )
  await new Promise((resolve) => setImmediate(resolve))

  const [company] = Object.values(JSON.parse(valueInput.value))
  assert.equal(company.logo_url, logoUrl)
})

for (const [label, file] of [
  ['Build Profile', path.join(__dirname, '../build-profile/company-autocomplete.js')],
  ['Edit Profile', path.join(__dirname, '../starter-edit-profile/company-autocomplete.js')],
]) {
  test(`${label} stores the selected Company domain and logo on the input`, async () => {
    const harness = createHarness(file, {}, { isMulti: false })
    harness.selectCompany({
      name: 'QA Wolf',
      domain: 'qawolf.com',
      logo_url: 'https://img.logo.dev/qawolf.com',
    })

    assert.equal(harness.input.value, 'QA Wolf')
    assert.equal(harness.input.dataset.selectedCompanyName, 'QA Wolf')
    assert.equal(harness.input.dataset.selectedCompanyDomain, 'qawolf.com')
    assert.equal(harness.input.dataset.selectedCompanyLogoUrl, 'https://img.logo.dev/qawolf.com')

    await new Promise((resolve) => setTimeout(resolve, 5))
    harness.changeInput('QA Wolf renamed')
    harness.changeInput('QA Wolf')
    assert.equal(harness.input.dataset.selectedCompanyName, undefined)
    assert.equal(harness.input.dataset.selectedCompanyDomain, undefined)
    assert.equal(harness.input.dataset.selectedCompanyLogoUrl, undefined)
  })
}

function createCrudHarness(file, { deferredWrites = false } = {}) {
  let readyPromise
  const requests = []

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
  const companySubmit = element()
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
    ['[data-edit-submit="companies"]', companySubmit],
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
      return { ok: true, json: async () => ({ companies: [], starter_id: 'starter-1' }) }
    },
    jQuery: undefined,
    MEMBER: { id: 'member-1' },
    qs(selector, root) {
      if (selector === 'div:first-child' && root === addButton) return { textContent: 'Add company' }
      if (selector === '.company-card' && root === companyList) return companyTemplate
      return elements.get(selector) || null
    },
    qsa() { return [] },
    setTimeout() { return 0 },
    clearTimeout() {},
    setInterval() { return 0 },
    clearInterval() {},
    waitForMember(callback) { readyPromise = callback() },
    window: {},
  }

  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })

  function select(input) {
    input.dataset.selectedCompanyName = 'QA Wolf'
    input.dataset.selectedCompanyDomain = 'qawolf.com'
    input.dataset.selectedCompanyLogoUrl = 'https://img.logo.dev/qawolf.com'
  }

  return {
    companyInput,
    editCompanyInput,
    requests,
    select,
    async start() {
      await documentListeners.get('DOMContentLoaded')[0]()
      await readyPromise
    },
    async submitAdd() {
      await addButton.listeners.get('click')[0]({ preventDefault() {} })
      if (deferredWrites) await companySubmit.listeners.get('click')[0]({ preventDefault() {} })
    },
    async submitEdit() {
      await saveEditButton.listeners.get('click')[0]({ preventDefault() {} })
      if (deferredWrites) await companySubmit.listeners.get('click')[0]({ preventDefault() {} })
    },
    async openExistingCompany() {
      const card = element()
      card.dataset.id = 'company-7'
      card.dataset.company = JSON.stringify({
        id: 'company-7',
        company_name: 'QA Wolf',
        company_domain: 'qawolf.com',
        company_logo_url: 'https://img.logo.dev/qawolf.com',
        job_title: 'Lead Engineer',
        start_date: 'Jan 2025',
        end_date: 'Present',
        current_work: true,
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
    }
    const addHarness = createCrudHarness(file, { deferredWrites })
    await addHarness.start()
    addHarness.select(addHarness.companyInput)
    await addHarness.submitAdd()

    const createRequest = addHarness.requests.find(({ options }) => options.method === 'POST')
    assert.deepEqual(JSON.parse(createRequest.options.body), {
      ...expectedSelection,
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
    await harness.submitAdd()
    assert.equal(harness.requests.some(({ options }) => ['POST', 'PATCH'].includes(options.method)), false)
  })
}
