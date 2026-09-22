/*
 * Decision 12: a draft, its row state, and its selected files survive switching away from a
 * section and back, and unsaved unified work arms the page's leave-and-reload warning.
 * Section switching is authored visibility, so these tests hide and show the step and then
 * let the page's own second initialisation pass run, which is where a draft could be lost.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const { h, makeEvent } = require('../test-helpers/form-dom.cjs')

const tick = () => new Promise(resolve => setImmediate(resolve))
const source = name => fs.readFileSync(__dirname + '/' + name, 'utf8')
const click = element => element.dispatchEvent(makeEvent('click', element, { bubbles: true }))

// The page's real unsaved-work guard. Only its dirty state and beforeunload handler run here:
// the separate network hydration callback waits for a DOMContentLoaded that never fires.
function dirtyGuard() {
  const listeners = new Map()
  const window = {
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]) },
  }
  window.window = window
  vm.runInContext(source('canonical-profile-loader.js'), vm.createContext({ window, document: { addEventListener() {} } }))
  const state = window.__tsProfileDirtyState
  state.finishHydration()
  return {
    state,
    warnsOnLeave() {
      const event = { returnValue: undefined, prevented: false, preventDefault() { this.prevented = true } }
      for (const listener of listeners.get('beforeunload') || []) listener(event)
      return event.prevented === true && event.returnValue === true
    },
  }
}

// A section switch is authored visibility only: the step is hidden and shown again.
function leaveSection(step) { step.hidden = true; step.style.display = 'none' }
function returnToSection(step) { step.hidden = false; step.style.display = '' }

async function mountHighlights(guard, { portfolios = [] } = {}) {
  const fields = ['title', 'description', 'images', 'videos'].map(key => h(key === 'description' ? 'textarea' : 'input', {
    'profile-highlight-field': key, name: key, id: key,
    ...(['images', 'videos'].includes(key) ? { type: 'file', multiple: '' } : {}),
  }))
  const row = h('div', { 'profile-item-row': '' }, [
    h('button', { type: 'button', 'profile-item-toggle': '' }, [h('span', { 'profile-items-summary': '' })]),
    h('div', { 'profile-item-content': '' }, [...fields, h('div', { 'profile-items-media': 'images' }), h('div', { 'profile-items-media': 'videos' })]),
    h('button', { type: 'button', 'profile-item-remove': '' }),
  ])
  const save = h('button', { 'data-edit-submit': 'portfolio' })
  const add = h('button', { 'profile-items-add': '' })
  const section = h('section', { 'profile-unified-items': 'highlights' }, [h('div', {}, [row]), save, add])
  const step = h('div', { 'data-form': 'step', 'data-index': '4' }, [section])
  let stored = structuredClone(portfolios)
  let nextId = 100, nextAsset = 1, boot
  const requests = [], readyHandlers = []
  const context = vm.createContext({
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }), __tsProfileDirtyState: guard.state },
    document: { readyState: 'loading', createElement: tag => h(tag), addEventListener(type, callback) { if (type === 'DOMContentLoaded') readyHandlers.push(callback) } },
    MEMBER: { id: 'test-member' }, waitForMember(callback) { boot = callback() },
    qs: (selector, scope) => scope ? scope.querySelector(selector) : selector === '[profile-unified-items="highlights"]' ? section : section.querySelector(selector),
    qsa: (selector, scope = section) => scope.querySelectorAll(selector),
    Event: class { constructor(type, options) { Object.assign(this, makeEvent(type, null, options)) } },
    URL: { createObjectURL: file => 'blob:' + file.name, revokeObjectURL() {} },
    FormData: class { constructor() { this.entries = {} } append(key, value) { this.entries[key] = value } },
    console: { warn() {}, error() {}, log() {} },
    fetch: async (url, init = {}) => {
      const endpoint = url.split('/').at(-1).split('?')[0]
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body?.entries
      requests.push({ endpoint, method: init.method || 'GET', body })
      let value
      const id = Number(new globalThis.URL(url).searchParams.get('portfolio_id'))
      if (endpoint === 'Get_my_portfolios') value = stored.map(({ images, videos, ...row }) => row)
      else if (endpoint === 'Get_portfolio_images') value = stored.find(row => row.id === id)?.images || []
      else if (endpoint === 'Get_portfolio_videos') value = stored.find(row => row.id === id)?.videos || []
      else if (endpoint.startsWith('upload-')) value = { path: '/uploads/' + nextAsset++, size: (body.image || body.video).size }
      else if (endpoint === 'Create_portfolio') { value = { ...body, id: nextId++, images: [], videos: [] }; stored.push(value) }
      else if (endpoint === 'Update_portfolio') {
        value = stored.find(row => row.id === Number(body.id)); Object.assign(value, body)
        value.images.forEach(image => { image.is_cover = image.id === body.cover_image_id })
      } else if (endpoint.startsWith('Add_portfolio_')) {
        const kind = endpoint.endsWith('image') ? 'images' : 'videos'
        value = { ...body, id: nextId++ }; stored.find(row => row.id === body.portfolio_id)[kind].push(value)
      }
      return { ok: true, json: async () => structuredClone(value) }
    },
  })
  for (const file of ['profile-section-validation.js', 'unified-highlights.js', 'portfolio-crud.js']) {
    vm.runInContext(source(file), context, { filename: file })
  }
  readyHandlers.forEach(callback => callback()); await boot
  const field = (key, index = 0) => section.querySelectorAll('[profile-item-row]')[index].querySelector('[profile-highlight-field="' + key + '"]')
  return { section, step, save, add, field, requests, context,
    mutations: () => requests.filter(request => request.method !== 'GET'),
    rows: () => section.querySelectorAll('[profile-item-row]').length,
    media: () => section.querySelectorAll('[profile-media-item]').length,
    status: () => section.querySelector('[profile-items-status]').textContent,
    type(key, value, index = 0) { const target = field(key, index); target.value = value; target.dispatchEvent(makeEvent('input', target, { bubbles: true })) },
    files(kind, list, index = 0) { const target = field(kind, index); target.files = list; target.dispatchEvent(makeEvent('change', target, { bubbles: true })) },
    // The page initialises sections again when a Starter returns to one.
    async reinitialise() { await context.window.StarterProfileHighlights.bind(section, {}) },
    async submit() { click(save); await tick() },
  }
}

async function mountCompanies(guard) {
  const fields = ['company_name', 'job_title', 'start_date', 'end_date', 'current_work'].map(key => h('input', {
    'profile-company-field': key, name: key, id: key,
    ...(key === 'current_work' ? { type: 'checkbox' } : {}),
    ...(['company_name', 'job_title'].includes(key) ? { required: '' } : {}),
  }))
  const row = h('div', { 'profile-item-row': '' }, [
    h('button', { 'profile-item-toggle': '', type: 'button' }, [h('span', { 'profile-items-summary': '' })]),
    h('div', { 'profile-item-content': '' }, fields), h('button', { 'profile-item-remove': '', type: 'button' }),
  ])
  const save = h('button', { 'data-edit-submit': 'companies' })
  const add = h('button', { 'profile-items-add': '' })
  const section = h('section', { 'profile-unified-items': 'companies' }, [h('div', {}, [row]), save, add])
  const step = h('div', { 'data-form': 'step', 'data-index': '3' }, [section])
  const requests = []
  let stored = [], boot
  const context = vm.createContext({
    // `company-autocomplete.js` publishes the Edit picker before the section loads on the page;
    // without it the section fails closed, so the harness stands it up the same way.
    window: { matchMedia: () => ({ matches: false }), __tsProfileDirtyState: guard.state,
      StarterEditLogoSearchInit() {} },
    document: {
      readyState: 'complete', createElement: tag => h(tag),
      querySelector: selector => section.querySelector(selector),
      querySelectorAll: selector => section.querySelectorAll(selector),
      addEventListener() {},
    },
    Event: class { constructor(type, options) { Object.assign(this, makeEvent(type, null, options)) } },
    MEMBER: { id: 'test-member' },
    waitForMember(callback) { boot = callback() },
    qs: (selector, scope) => scope ? scope.querySelector(selector) : selector === '[profile-unified-items="companies"]' ? section : section.querySelector(selector),
    qsa: (selector, scope = section) => scope.querySelectorAll(selector),
    console: { warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout,
    fetch: async (url, init = {}) => {
      requests.push({ url, method: init.method || 'GET' })
      return { ok: true, json: async () => ({ companies: structuredClone(stored), starter_id: 7 }) }
    },
  })
  for (const file of ['../../global-embeds/accordions/accordions.js', 'profile-section-validation.js',
    'unified-companies.js', 'company-experience-crud.js']) {
    vm.runInContext(source(file), context, { filename: file })
  }
  await boot
  const field = (key, index = 0) => section.querySelectorAll('[profile-item-row]')[index].querySelector('[profile-company-field="' + key + '"]')
  return { section, step, field, requests, context,
    rows: () => section.querySelectorAll('[profile-item-row]').length,
    type(key, value, index = 0) { const target = field(key, index); target.value = value; target.dispatchEvent(makeEvent('input', target, { bubbles: true })) },
    async reinitialise() { await context.window.StarterProfileCompanies.bind(section, {}) },
  }
}

test('a Highlight draft, its selected file, and its dirty state survive leaving and returning to the section', async () => {
  const guard = dirtyGuard()
  const page = await mountHighlights(guard)
  page.type('title', 'Rebrand campaign')
  page.type('description', 'What the work covered')
  page.files('images', [{ name: 'cover.png', type: 'image/png', size: 1000 }])
  assert.equal(page.media(), 1)
  assert.equal(guard.state.isDirty(), true)
  assert.equal(guard.warnsOnLeave(), true, 'an unsaved unified draft arms the leave-and-reload warning')

  const before = page.requests.length
  leaveSection(page.step)
  returnToSection(page.step)
  await page.reinitialise()

  assert.equal(page.rows(), 1)
  assert.equal(page.field('title').value, 'Rebrand campaign')
  assert.equal(page.field('description').value, 'What the work covered')
  assert.equal(page.media(), 1, 'the selected file is still held for Save')
  assert.equal(page.requests.length, before, 'returning to the section does not reload the saved entries')
  assert.equal(page.status(), 'Unsaved changes.')
  assert.equal(guard.warnsOnLeave(), true)

  await page.submit()
  assert.equal(page.status(), 'Changes saved.')
  const created = page.mutations().find(request => request.endpoint === 'Create_portfolio')
  assert.equal(created.body.title, 'Rebrand campaign')
  assert.equal(created.body.description, 'What the work covered')
  assert.equal(page.mutations().filter(request => request.endpoint === 'upload-image').length, 1)
  assert.equal(guard.state.isDirty(), false)
  assert.equal(guard.warnsOnLeave(), false, 'a confirmed save releases the leave-and-reload warning')
})

test('a Work Experience draft and its dirty state survive leaving and returning to the section', async () => {
  const guard = dirtyGuard()
  const page = await mountCompanies(guard)
  page.type('company_name', 'Northwind')
  page.type('job_title', 'Design lead')
  assert.equal(guard.warnsOnLeave(), true)

  const before = page.requests.length
  leaveSection(page.step)
  returnToSection(page.step)
  await page.reinitialise()

  assert.equal(page.rows(), 1)
  assert.equal(page.field('company_name').value, 'Northwind')
  assert.equal(page.field('job_title').value, 'Design lead')
  assert.equal(page.requests.length, before, 'returning to the section does not reload the saved entries')
  assert.equal(guard.state.isDirty(), true)
  assert.equal(guard.warnsOnLeave(), true)
})

test('an untouched section leaves the leave-and-reload warning unarmed', async () => {
  const guard = dirtyGuard()
  const page = await mountHighlights(guard)
  leaveSection(page.step)
  returnToSection(page.step)
  await page.reinitialise()
  assert.equal(page.rows(), 1)
  assert.equal(guard.state.isDirty(), false)
  assert.equal(guard.warnsOnLeave(), false)
})
