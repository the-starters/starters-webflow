const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const { h, makeEvent } = require('../test-helpers/form-dom.cjs')
const { createEnvironment, deferred, submit } = require('../test-helpers/edit-profile-controller.cjs')

function mount(fetchImpl, { rates = false, services = null, readback = null, picker = false, profileType = 'full', hourlyRequired = true,
  rows = true, pickerSearch = false, backendRequired = false, deferProfile = false, saveControl = true,
  dirtyState = null, retainersOff = false } = {}) {
  const readRequests = []
  const timers = []
  const elapsed = { ms: 0 }
  const name = h('input', { id: 'service-name', name: 'service-name', 'data-name': 'service-name', required: '', 'aria-describedby': 'service-hint' })
  const price = h('input', { name: 'service-price', 'data-name': 'service-price', required: '' })
  const description = h('textarea', { name: 'service-description', 'data-name': 'service-description' })
  const label = h('label', { for: 'service-name' })
  const hint = h('span', { id: 'service-hint' })
  const content = h('div', { 'increment-dropdown-content': '' }, [label, name, hint, price, description])
  const toggle = h('div', { 'increment-dropdown-toggle': '' })
  const remove = h('button', { 'increment-dropdown-remove': '', type: 'button' })
  const row = h('div', { 'increment-dropdown': '1', 'data-entity': 'Service' }, [toggle, content, remove])
  const add = h('button', { 'profile-items-add': '', type: 'button' })
  const discard = h('button', { 'profile-items-discard': '', type: 'button' })
  const root = h('section', {}, rows ? [row, add, discard] : [add, discard])
  // A Finsweet option search box: authored inside the section but owned by the picker script.
  const search = h('input', { name: 'availability-search', required: '' })
  if (pickerSearch) root.appendChild(search)
  // Authored as backend-required while Webflow leaves the Required checkbox unchecked.
  // `backendRequired: '<profile type>'` is the authored pair a Starter of that type is not
  // asked for: backend-required, and marked non-required for this profile type.
  const backendOnly = h('input', { name: 'description-retainer', 'form-xano-required': '',
    ...(typeof backendRequired === 'string' ? { 'data-non-required': backendRequired } : {}) })
  backendOnly.value = 'Retainer copy a Starter typed'
  if (backendRequired) root.appendChild(backendOnly)
  // The published markup disables the retainer description while retainers are switched off.
  const retainerChoice = h('input', { name: 'offer-monthly-retainers', type: 'radio' })
  retainerChoice.value = 'no'
  retainerChoice.checked = true
  const retainerDescription = h('textarea', { name: 'description-retainer' })
  retainerDescription.value = 'Ongoing advisory retainer'
  retainerDescription.disabled = true
  if (retainersOff) { root.appendChild(retainerChoice); root.appendChild(retainerDescription) }
  const hourly = h('input', { name: 'rate', 'data-input-capture': '', required: '' })
  hourly.required = hourlyRequired
  hourly.setAttribute('data-non-required', 'consult')
  hourly.dataset = { nonRequired: 'consult' }
  hourly.value = '125'
  const retainer = h('input', { name: 'rate-retainer', 'data-input-capture': '' })
  retainer.disabled = true
  if (rates) { root.appendChild(hourly); root.appendChild(retainer) }
  const availability = h('input', { name: 'availability-option', 'ms-code-select': 'input' })
  const availabilityRequired = h('input', { name: 'availability-required', 'ms-code-select': 'input-required', required: '' })
  if (picker) root.appendChild(h('div', { 'select-wrap-entity': 'availability' }, [availability, availabilityRequired]))
  const environment = createEnvironment(fetchImpl || (async () => ({ ok: true, status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  })), {
    stepIndex: 6,
    profileType,
    profileReady: true,
    dirtyState,
    setupSection({ context, window, document, step, stepFields }) {
      context.Event = class {
        constructor(type, options) { Object.assign(this, makeEvent(type, null, options)) }
      }
      if (deferProfile) {
        // Deferred scripts can run before the page embed that defines waitProfileData.
        delete window.waitProfileData
        window.activeProfile = null
        window.setTimeout = callback => timers.push(callback)
        const RealDate = context.Date
        class Clock extends RealDate { static now() { return RealDate.now() + elapsed.ms } }
        context.Date = Clock
        window.Date = Clock
      }
      if (readback) window.xanoAuthFetch = async (...args) => {
        readRequests.push(args)
        return { ok: true, json: async () => typeof readback === 'function' ? readback() : readback }
      }
      if (services) window.activeProfile.data.step_6 = services
      if (rates) {
        stepFields['[name="rate"]'] = hourly
        stepFields['[name="rate-retainer"]'] = retainer
      } else stepFields['[name="rate-retainer"]'].disabled = true
      const query = step.querySelector.bind(step)
      const queryAll = step.querySelectorAll.bind(step)
      step.querySelector = selector => !saveControl && selector === '[data-edit-submit]'
        ? null : root.querySelector(selector) || query(selector)
      step.querySelectorAll = selector => [...root.querySelectorAll(selector), ...queryAll(selector)]
      step.addEventListener = root.addEventListener.bind(root)
      step.appendChild = root.appendChild.bind(root)
      step.setAttribute('profile-unified-items', 'services')
      root.setAttribute('profile-unified-items', 'services')
      const documentQuery = document.querySelectorAll.bind(document)
      document.querySelectorAll = selector => selector === '[profile-unified-items="services"]' ? [step]
        : selector === '[data-non-required]' && rates ? [hourly] : documentQuery(selector)
      document.createElement = tag => h(tag)
      for (const file of ['profile-section-validation.js', 'unified-services.js']) {
        vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context)
      }
    },
  })
  return { ...environment, name, price, description, row, root, add, remove, discard, hourly, retainer, readRequests, availability, availabilityRequired,
    search, backendOnly, retainerChoice, retainerDescription,
    controller: () => environment.window.StarterProfileSections?.get(environment.step),
    flushTimers: () => timers.splice(0).forEach(callback => callback()),
    pendingTimers: () => timers.length,
    advanceClock: ms => { elapsed.ms += ms },
    click: element => element.dispatchEvent(makeEvent('click', element, { bubbles: true })),
    type(field, value) {
      field.value = value
      field.dispatchEvent(makeEvent('input', field, { bubbles: true }))
    },
  }
}

// The published dirty state owns the hydration window every profile script writes through.
function loadDirtyState() {
  const target = () => ({ addEventListener() {} })
  const windowStub = target()
  windowStub.window = windowStub
  const context = vm.createContext({ window: windowStub, document: target() })
  vm.runInContext(fs.readFileSync(__dirname + '/canonical-profile-loader.js', 'utf8'), context)
  return windowStub.__tsProfileDirtyState
}

test('picker hydration inside the shared hydration window never reports unsaved changes', () => {
  const dirtyState = loadDirtyState()
  const page = mount(undefined, { picker: true, dirtyState })
  const status = page.root.querySelector('[profile-items-status]')
  dirtyState.finishHydration()
  // The availability picker replays its saved selection as bubbling change and input events.
  dirtyState.runHydrationSync(() => {
    page.availabilityRequired.value = '1'
    page.availabilityRequired.dispatchEvent(makeEvent('change', page.availabilityRequired, { bubbles: true }))
    page.availability.value = 'Available'
    page.availability.dispatchEvent(makeEvent('input', page.availability, { bubbles: true }))
  })
  assert.equal(status.textContent, '')
  assert.equal(page.step.getAttribute('profile-items-dirty'), null)
  assert.equal(dirtyState.isDirty(), false)
  page.type(page.name, 'Design audit')
  assert.equal(status.textContent, 'Unsaved changes.')
  assert.equal(page.step.getAttribute('profile-items-dirty'), 'true')
})

test('Save includes the open service and never drops a started row with an empty required price', async () => {
  const page = mount()
  page.type(page.name, 'Design audit')
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.equal(page.price.getAttribute('aria-invalid'), 'true')
  assert.equal(page.price.focusCalls.length, 1)
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.requests.length, 1)
  const payload = JSON.parse(page.requests[0][1].body)
  assert.deepEqual(JSON.parse(payload.Services), {
    'service-1': { name: 'Design audit', description: '', price: 500 },
    'service-2': null, 'service-3': null,
  })
})

test('draft feedback clears on Discard and nested removal cannot reopen a removed row', () => {
  const page = mount()
  const status = page.root.querySelector('[profile-items-status]')
  page.type(page.name, 'Draft audit')
  assert.equal(status.textContent, 'Unsaved changes.')
  const toggle = page.row.querySelector('[increment-dropdown-toggle]')
  page.remove.remove()
  toggle.appendChild(page.remove)
  page.click(page.remove)
  const content = page.row.querySelector('[increment-dropdown-content]')
  assert.equal(content.hidden, true)
  assert.equal(content.inert, true)
  page.click(page.row.querySelector('[profile-items-undo]'))
  assert.equal(content.hidden, false)
  assert.equal(content.inert, false)
  page.click(page.discard)
  assert.equal(status.textContent, 'Changes discarded.')
})

test('malformed saved service shapes pause Save instead of replacing unreadable entries', async () => {
  for (const service of ['[]', '12', '"saved service"', '{"price":{"amount":500}}']) {
    const page = mount(undefined, { services: { service } })
    page.type(page.name, 'Draft')
    page.type(page.price, '500')
    await submit(page)
    assert.equal(page.requests.length, 0)
    assert.match(page.root.querySelector('[profile-items-status]').textContent, /could not be read/)
  }
})

test('Full and Consult applicability cannot turn an unchecked native Required setting on', () => {
  for (const profileType of ['full', 'consult']) {
    const page = mount(undefined, { rates: true, profileType, hourlyRequired: false })
    assert.equal(page.hourly.required, false)
  }
  const full = mount(undefined, { rates: true, profileType: 'full', hourlyRequired: true })
  assert.equal(full.hourly.required, true)
  const consult = mount(undefined, { rates: true, profileType: 'consult', hourlyRequired: true })
  assert.equal(consult.hourly.required, false)
})

test('authored availability presence shows feedback on the usable picker instead of its hidden mirror', async () => {
  const page = mount(undefined, { picker: true })
  page.type(page.availability, 'Unselected text')
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.equal(page.availability.getAttribute('aria-invalid'), 'true')
  assert.equal(page.availability.focusCalls.length, 1)
  assert.equal(page.availabilityRequired.focusCalls.length, 0)
  page.type(page.availabilityRequired, '1')
  assert.equal(page.availability.getAttribute('aria-invalid'), 'false')
  page.availabilityRequired.removeAttribute('required')
  page.type(page.availabilityRequired, '')
  await submit(page)
  assert.equal(page.requests.length, 1, 'unchecked Required does not invent a picker minimum')
})

test('an uncertain service write is confirmed only by matching canonical readback, without replaying the PATCH', async () => {
  const page = mount(async () => { throw new Error('Response lost') }, { readback: {
    Hourly_Rate: 125, Availability: 'Available', Availability_ID: '1',
    Services: { 'service-1': { name: 'Audit', description: '', price: 500 }, 'service-2': null, 'service-3': null },
  } })
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.requests.length, 1)
  assert.equal(page.readRequests.length, 1)
  assert.match(page.readRequests[0][0], /\/starter\/get$/)
  assert.equal(page.modalEvents.error, 0)
  assert.equal(page.root.querySelector('[role="status"]').textContent, 'Changes saved.')
  page.type(page.name, 'Unsaved name')
  page.click(page.discard)
  assert.equal(page.root.querySelector('[data-name="service-name"]').value, 'Audit')
})

test('a later read-only check can confirm a slow save while keeping newer drafts', async () => {
  let saved = {}
  const page = mount(async () => { throw new Error('Response lost') }, { readback: () => saved })
  page.type(page.name, 'Submitted audit')
  page.type(page.price, '500')
  await submit(page)
  page.type(page.name, 'Later draft')
  saved = { Hourly_Rate: 125, Availability: 'Available', Availability_ID: '1',
    Services: { 'service-1': { name: 'Submitted audit', description: '', price: 500 }, 'service-2': null, 'service-3': null } }
  const check = page.root.querySelector('[profile-items-check-save]')
  assert.equal(check.hidden, false)
  page.click(check)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.requests.length, 1)
  assert.equal(page.readRequests.length, 2)
  assert.equal(page.name.value, 'Later draft')
  assert.equal(page.step.getAttribute('profile-items-dirty'), 'true')
  page.click(page.discard)
  assert.equal(page.root.querySelector('[data-name="service-name"]').value, 'Submitted audit')
})

test('reconciliation cannot confirm a save after the signed-in member changes', async () => {
  const page = mount(async () => { throw new Error('Response lost') }, { readback: () => {
    page.switchMember({ id: 'mem_other', auth: { email: 'other@example.test' }, customFields: {} })
    return { Hourly_Rate: 125, Availability: 'Available', Availability_ID: '1',
      Services: { 'service-1': { name: 'Audit', description: '', price: 500 }, 'service-2': null, 'service-3': null } }
  } })
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.modalEvents.success, 0)
  assert.equal(page.requests.length, 1)
  assert.match(page.root.querySelector('[role="status"]').textContent, /could not confirm/i)
  page.click(page.root.querySelector('[profile-items-check-save]'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.readRequests.length, 1, 'the old member must not be read under the new sign-in')
})

test('repeated fields keep unique labels and hints, and rows support keyboard toggling', () => {
  const page = mount()
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  page.click(page.add)
  const rows = page.root.querySelectorAll('[increment-dropdown]')
  const clonedName = rows[1].querySelector('[data-name="service-name"]')
  assert.notEqual(clonedName.getAttribute('id'), page.name.getAttribute('id'))
  assert.equal(rows[1].querySelector('label').getAttribute('for'), clonedName.getAttribute('id'))
  assert.notEqual(clonedName.getAttribute('aria-describedby'), page.name.getAttribute('aria-describedby'))
  const toggle = rows[0].querySelector('[increment-dropdown-toggle]')
  assert.equal(toggle.getAttribute('role'), 'button')
  assert.equal(toggle.getAttribute('tabindex'), '0')
  toggle.dispatchEvent(makeEvent('keydown', toggle, { key: 'Enter' }))
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  toggle.dispatchEvent(makeEvent('keydown', toggle, { key: ' ' }))
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
})

test('canonical services hydrate as retained rows and clearing a saved row is not an implicit deletion', async () => {
  const page = mount(undefined, { services: {
    service: JSON.stringify({ name: 'Audit', description: 'Review', price: 500 }),
    'service-2': JSON.stringify({ name: 'Retained service', description: '', price: 250 }),
  } })
  const rows = page.root.querySelectorAll('[increment-dropdown]')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].querySelector('[data-name="service-name"]').value, 'Audit')
  assert.equal(rows[1].querySelector('[data-name="service-price"]').value, '250')
  for (const field of rows[1].querySelectorAll('[data-name]')) page.type(field, '')
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.equal(rows[1].querySelector('[data-name="service-name"]').getAttribute('aria-invalid'), 'true')
})

test('an opted-in section with missing replacement scripts fails closed instead of using the legacy writer', async () => {
  const page = createEnvironment(async () => ({ ok: true, status: 200,
    json: async () => ({ saved: true, projection_pending: false }),
  }), { stepIndex: 6, setupSection: ({ step }) => step.setAttribute('profile-unified-items', 'services') })
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.match(page.errorFeedback.textContent, /could not load/i)
})

test('rates share section validation and Discard, while a disabled retainer is excluded', async () => {
  const page = mount(undefined, { rates: true })
  page.type(page.hourly, '1001')
  page.type(page.retainer, 'invalid disabled rate')
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.equal(page.hourly.getAttribute('aria-invalid'), 'true')
  assert.notEqual(page.retainer.getAttribute('aria-invalid'), 'true')
  page.type(page.hourly, '1000')
  await submit(page)
  assert.equal(JSON.parse(page.requests[0][1].body).Hourly_Rate, 1000)
  page.type(page.hourly, '2000')
  page.hourly.dispatchEvent(makeEvent('focusout', page.hourly, { bubbles: true }))
  assert.equal(page.hourly.getAttribute('aria-invalid'), 'true')
  page.click(page.discard)
  assert.equal(page.hourly.value, '1000')
  assert.notEqual(page.hourly.getAttribute('aria-invalid'), 'true')
})

test('one section stays locked during Save and an unknown response preserves drafts without blind replay', async () => {
  const request = deferred()
  const page = mount(() => request.promise)
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  const saving = submit(page)
  const duplicate = submit(page)
  request.reject(new Error('Connection lost'))
  assert.equal(page.step.inert, true)
  assert.equal(page.root.querySelector('[role="status"]').textContent, 'Saving changes…')
  await Promise.all([saving, duplicate])
  assert.equal(page.requests.length, 1)
  assert.equal(page.step.inert, false)
  assert.equal(page.name.value, 'Audit')
  assert.match(page.root.querySelector('[role="status"]').textContent, /could not confirm/i)
  await submit(page)
  assert.equal(page.requests.length, 1, 'unknown write cannot be replayed')
})

test('only the submitted snapshot becomes the Discard baseline if values change during a save', async () => {
  const request = deferred()
  const started = deferred()
  const page = mount(() => { started.resolve(); return request.promise })
  page.type(page.name, 'Submitted audit')
  page.type(page.price, '500')
  const save = submit(page)
  await started.promise
  page.type(page.name, 'Later draft')
  request.resolve({ ok: true, status: 200, json: async () => ({ saved: true, projection_pending: false }) })
  await save
  assert.equal(JSON.parse(JSON.parse(page.requests[0][1].body).Services)['service-1'].name, 'Submitted audit')
  assert.equal(page.name.value, 'Later draft')
  assert.equal(page.step.getAttribute('profile-items-dirty'), 'true')
  page.click(page.discard)
  assert.equal(page.root.querySelector('[data-name="service-name"]').value, 'Submitted audit')
})

test('removal waits for Save, Undo restores the service, and Discard restores the last confirmed save', async () => {
  const page = mount()
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  page.click(page.remove)
  assert.equal(page.requests.length, 1, 'Remove does not write')
  assert.equal(page.row.getAttribute('profile-items-removed'), 'true')
  assert.equal(page.root.querySelectorAll('[increment-dropdown]').filter(row => !row.hasAttribute('profile-items-removed')).length, 1,
    'removing the last entry leaves a blank row')
  page.click(page.row.querySelector('[profile-items-undo]'))
  assert.equal(page.row.getAttribute('profile-items-removed'), null)
  assert.equal(page.name.value, 'Audit')
  page.type(page.name, 'Changed audit')
  page.click(page.remove)
  page.click(page.discard)
  assert.equal(page.root.querySelector('[data-name="service-name"]').value, 'Audit')
  assert.equal(page.root.querySelector('[data-name="service-price"]').value, '500')
  assert.equal(page.root.querySelectorAll('[profile-items-removed]').length, 0)
  assert.equal(page.requests.length, 1, 'Discard does not write')
})

test('three services are retained at the limit, and explicit removal clears the saved collection', async () => {
  const page = mount()
  for (let index = 0; index < 3; index += 1) {
    const row = page.root.querySelectorAll('[increment-dropdown]')[index]
    page.type(row.querySelector('[data-name="service-name"]'), 'Service ' + (index + 1))
    page.type(row.querySelector('[data-name="service-price"]'), String((index + 1) * 100))
    page.click(page.add)
  }
  assert.equal(page.root.querySelectorAll('[increment-dropdown]').length, 3)
  await submit(page)
  assert.equal(JSON.parse(JSON.parse(page.requests[0][1].body).Services)['service-3'].name, 'Service 3')
  for (const row of page.root.querySelectorAll('[increment-dropdown]')) page.click(row.querySelector('[increment-dropdown-remove]'))
  await submit(page)
  assert.deepEqual(JSON.parse(JSON.parse(page.requests[1][1].body).Services), {
    'service-1': null, 'service-2': null, 'service-3': null,
  })
})

test('Add another reports the three-service cap instead of doing nothing', () => {
  const page = mount()
  const status = page.root.querySelector('[profile-items-status]')
  for (let index = 0; index < 3; index += 1) {
    const row = page.root.querySelectorAll('[increment-dropdown]')[index]
    page.type(row.querySelector('[data-name="service-name"]'), 'Service ' + (index + 1))
    page.type(row.querySelector('[data-name="service-price"]'), String((index + 1) * 100))
    page.click(page.add)
  }
  assert.equal(page.root.querySelectorAll('[increment-dropdown]').length, 3)
  page.click(page.add)
  assert.equal(page.root.querySelectorAll('[increment-dropdown]').length, 3, 'the cap still holds')
  assert.equal(status.textContent, 'You can keep up to three services.')
})

test('Add validates then collapses a completed service and focuses one new blank row without saving', async () => {
  const page = mount()
  page.click(page.add)
  assert.equal(page.root.querySelectorAll('[increment-dropdown]').length, 1, 'unused blank does not multiply')
  page.type(page.name, 'Audit')
  page.click(page.add)
  assert.equal(page.root.querySelectorAll('[increment-dropdown]').length, 1, 'started invalid row blocks Add')
  page.type(page.price, '500')
  page.click(page.add)
  const rows = page.root.querySelectorAll('[increment-dropdown]')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].querySelector('[increment-dropdown-toggle]').getAttribute('aria-expanded'), 'false')
  assert.match(rows[0].querySelector('[profile-items-summary]').textContent, /Audit/)
  const nextName = rows[1].querySelector('[data-name="service-name"]')
  assert.equal(nextName.value, '')
  assert.equal(nextName.focusCalls.length, 1)
  assert.equal(page.requests.length, 0)
  page.click(page.add)
  assert.equal(page.root.querySelectorAll('[increment-dropdown]').length, 2)
  await submit(page)
  assert.equal(page.requests.length, 1, 'unused extra row is ignored on Save')
})

test('entered service prices use whole-dollar bounds even when the field is optional', async () => {
  for (const price of ['0', '50001', '10.50', '5e2', '-1', 'word']) {
    const page = mount()
    page.price.removeAttribute('required')
    page.type(page.name, 'Design audit')
    page.type(page.price, price)
    await submit(page)
    assert.equal(page.requests.length, 0, price)
    assert.equal(page.price.getAttribute('aria-invalid'), 'true', price)
  }
  for (const price of ['1', '50000']) {
    const page = mount()
    page.type(page.name, 'Design audit')
    page.type(page.price, price)
    await submit(page)
    assert.equal(page.requests.length, 1, price)
    assert.equal(JSON.parse(JSON.parse(page.requests[0][1].body).Services)['service-1'].price, Number(price))
  }
})

test('services bind from the profile alone when no page embed defines waitProfileData', () => {
  const page = mount(undefined, { deferProfile: true })
  assert.equal(page.controller(), undefined, 'binding waits for the profile')
  page.flushTimers()
  assert.equal(page.controller(), undefined, 'and keeps waiting while the profile is unset')
  // The page embed publishes an empty placeholder profile before it fetches the saved one.
  page.window.activeProfile = { type: 'full', type_id: 1, last_update: null, data: {} }
  page.flushTimers()
  assert.equal(page.controller(), undefined, 'a placeholder profile is not the saved profile')
  page.window.activeProfile = { type: 'full', type_id: 1, last_update: 1758067200000, data: {} }
  page.flushTimers()
  assert.ok(page.controller(), 'the controller registers once the saved profile arrives')
  assert.equal(page.root.querySelectorAll('[profile-items-status]').length, 1, 'one status region, bound once')
})

test('a profile that never arrives leaves the section unbound rather than binding it empty', () => {
  const page = mount(undefined, { deferProfile: true })
  page.flushTimers()
  page.window.activeProfile = { type: 'full', type_id: 1, last_update: null, data: {} }
  page.flushTimers()
  page.advanceClock(10000)
  page.flushTimers()
  assert.equal(page.controller(), undefined, 'binding an empty section would let a late Save clear saved services')
  assert.equal(page.pendingTimers(), 0, 'polling stops at the deadline')
  assert.equal(page.root.querySelectorAll('[profile-items-status]').length, 0, 'no rows or status were touched')
  assert.equal(page.row.getAttribute('data-profile-row-id'), null)
  assert.equal(page.row.querySelectorAll('[profile-items-undo]').length, 0)
})

test('a section authored without a row fails closed instead of leaving the page uncontrolled', async () => {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args)
  let page
  try { page = mount(undefined, { rows: false }) } finally { console.warn = original }
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][0], '[unified-services] missing [increment-dropdown] row or Save control in section')
  assert.equal(page.root.querySelector('[profile-items-status]').textContent,
    'This section could not load. Reload the page before editing.')
  const controller = page.controller()
  assert.ok(controller, 'a controller is still registered so Save can explain the gap')
  assert.equal(controller.validate().valid, false)
  assert.equal(controller.validate().failures[0].code, 'MARKUP_CONTRACT_MISSING')
  assert.equal(controller.begin(), false)
  await submit(page)
  assert.equal(page.requests.length, 0)
})

test('Save waits for a resolved profile type instead of writing an unresolved one', async () => {
  const page = mount(undefined, { profileType: '' })
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.equal(page.controller().validate().failures[0].code, 'PROFILE_NOT_READY')
  page.window.activeProfile.type = 'full'
  await submit(page)
  assert.equal(page.requests.length, 1)
})

test('an authored requirement on a picker search box outside a row does not gate Save', async () => {
  const page = mount(undefined, { pickerSearch: true })
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  assert.equal(page.search.value, '', 'the blank search box is authored required')
  await submit(page)
  assert.equal(page.requests.length, 1)
  assert.notEqual(page.search.getAttribute('aria-invalid'), 'true')
  assert.equal(page.search.focusCalls.length, 0)
})

test('a backend-required field Webflow leaves optional pauses Save with a value-free diagnostic', async () => {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    const page = mount(undefined, { backendRequired: true })
    const status = page.root.querySelector('[profile-items-status]')
    assert.equal(status.textContent, 'This form is misconfigured. Saving is paused until it is fixed.')
    page.type(page.name, 'Audit')
    page.type(page.price, '500')
    assert.equal(status.textContent, 'This form is misconfigured. Saving is paused until it is fixed.',
      'the pause survives editing')
    await submit(page)
    assert.equal(page.requests.length, 0)
    const controller = page.controller()
    assert.equal(controller.validate().failures[0].code, 'FORM_MISCONFIGURED')
    assert.equal(controller.begin(), false)
    assert.equal(warnings.length, 1, 'the mismatch is reported once, not on every Save attempt')
    assert.equal(warnings[0][0], '[unified-services] form-xano-required without required:')
    assert.equal(Array.from(warnings[0][1]).join(','), 'description-retainer')
    assert.ok(!JSON.stringify(warnings).includes('Retainer copy'), 'the diagnostic names fields, never values')
    page.click(page.discard)
    assert.equal(page.root.querySelector('[data-name="service-name"]').value, '', 'Discard stays available')
  } finally { console.warn = original }
})

test('a refused write reports the server reason and leaves Save and Discard usable', async () => {
  const page = mount(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Price is required' }) }))
  const status = page.root.querySelector('[profile-items-status]')
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.requests.length, 1)
  assert.equal(status.textContent, 'Price is required', 'the server explains its own refusal')
  assert.equal(page.root.querySelector('[profile-items-check-save]').hidden, true,
    'a received refusal leaves nothing to check')
  assert.equal(page.name.value, 'Audit', 'the draft survives')
  await submit(page)
  assert.equal(page.requests.length, 2, 'Save is not paused by a refusal the server already answered')
  page.click(page.discard)
  assert.equal(page.root.querySelector('[data-name="service-name"]').value, '')
  assert.equal(status.textContent, 'Changes discarded.')
})

test('a refusal without a readable body falls back to plain wording and still frees Save', async () => {
  const page = mount(async () => ({ ok: false, status: 500, json: async () => { throw new Error('Empty body') } }))
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.root.querySelector('[profile-items-status]').textContent,
    'The server rejected this change. Check the entry and try again.')
  assert.equal(page.root.querySelector('[profile-items-check-save]').hidden, true)
  await submit(page)
  assert.equal(page.requests.length, 2)
})

test('a lost response still leaves the outcome unknown and pauses Save', async () => {
  const page = mount(async () => { throw new Error('Connection lost') })
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.requests.length, 1)
  assert.match(page.root.querySelector('[profile-items-status]').textContent, /could not confirm/i)
  assert.equal(page.name.value, 'Audit')
  await submit(page)
  assert.equal(page.requests.length, 1, 'an unknown write is never replayed')
})

test('a refusal is reported even when the saved profile already matches the submission', async () => {
  const page = mount(async () => ({ ok: false, status: 403,
    json: async () => ({ message: 'Your plan does not allow this change' }) }), {
    readback: { Hourly_Rate: 125, Availability: 'Available', Availability_ID: '1',
      Services: { 'service-1': { name: 'Audit', description: '', price: 500 }, 'service-2': null, 'service-3': null } },
  })
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.requests.length, 1)
  assert.equal(page.readRequests.length, 0, 'a received refusal needs no canonical read')
  assert.equal(page.modalEvents.success, 0, 'a refusal is never dressed up as a save')
  assert.equal(page.root.querySelector('[profile-items-status]').textContent,
    'Your plan does not allow this change')
  assert.equal(page.root.querySelector('[profile-items-check-save]').hidden, true)
  await submit(page)
  assert.equal(page.requests.length, 2, 'Save stays usable after a refusal')
})

test('a Services section missing its rows or its Save control halts and disables Save', async () => {
  const unusable = 'This section could not load. Reload the page before editing.'
  const missingRows = mount(null, { rows: false })
  assert.equal(missingRows.root.querySelector('[profile-items-status]').textContent, unusable)
  assert.equal(missingRows.button.getAttribute('disabled'), '', 'a halted section must not leave Save live')
  await submit(missingRows)
  assert.equal(missingRows.requests.length, 0)

  const missingSave = mount(null, { saveControl: false })
  assert.equal(missingSave.root.querySelector('[profile-items-status]').textContent, unusable)
  assert.equal(missingSave.controller().validate().valid, false,
    'without a Save control the section registers a halted controller')
})

test('switching retainers off clears the stored retainer description it owns', async () => {
  const page = mount(undefined, { retainersOff: true })
  page.type(page.name, 'Audit')
  page.type(page.price, '500')
  await submit(page)
  assert.equal(page.requests.length, 1)
  const payload = JSON.parse(page.requests[0][1].body)
  assert.equal(payload.Retainer_Enabled, false)
  assert.equal(payload.Retainer_Rate, 0)
  assert.equal(payload.Retainer_Description, '',
    'the description control is disabled, but this section still owns the value')
})

test('a saved service slot that cannot be read disables Save with a terminal message', async () => {
  const unreadable = 'Saved services could not be read. Reload the page before editing.'
  const page = mount(undefined, { services: { service: '{"price":{"amount":500}}' } })
  const status = page.root.querySelector('[profile-items-status]')
  assert.equal(status.textContent, unreadable)
  assert.equal(page.button.getAttribute('disabled'), '', 'Save is never left live over entries nobody can read')
  assert.equal(page.controller().validate().valid, false)
  assert.equal(page.controller().validate().failures[0].code, 'SAVED_STATE_UNREADABLE')
  assert.equal(page.controller().begin(), false)
  page.type(page.name, 'Draft')
  assert.equal(status.textContent, unreadable, 'an edit never hides the reason Save is refused')
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.equal(page.root.querySelector('[profile-items-check-save]').hidden, true,
    'a failed read is not a write in doubt, so there is nothing to check')
  page.click(page.discard)
  assert.match(page.root.querySelector('[profile-items-status]').textContent, /reload the page/i,
    'Discard stays usable and restates the block')
})

test('Save clicked before the section binds reports a section still loading, not a reload', async () => {
  const page = mount(undefined, { deferProfile: true })
  assert.equal(page.controller(), undefined, 'the section has not bound yet')
  assert.equal(page.button.getAttribute('aria-disabled'), 'true', 'Save says so from page load')
  await submit(page)
  assert.equal(page.requests.length, 0)
  assert.match(page.errorFeedback.textContent, /still loading/i)
  assert.equal(/reload the page/i.test(page.errorFeedback.textContent), false)
  page.window.activeProfile = { type: 'full', type_id: 1, last_update: 1758067200000, data: {} }
  page.flushTimers()
  assert.ok(page.controller(), 'the controller registers once the saved profile arrives')
  assert.equal(page.button.getAttribute('aria-disabled'), null, 'and Save becomes usable')
})

test('a field this profile type is not asked for is not a form misconfiguration', async () => {
  const consult = mount(undefined, { backendRequired: 'consult', profileType: 'consult' })
  consult.type(consult.name, 'Audit')
  consult.type(consult.price, '500')
  await submit(consult)
  assert.equal(consult.requests.length, 1, 'the two markers agree for this profile type')
  assert.notEqual(consult.root.querySelector('[profile-items-status]').textContent,
    'This form is misconfigured. Saving is paused until it is fixed.')

  const full = mount(undefined, { backendRequired: 'consult', profileType: 'full' })
  full.type(full.name, 'Audit')
  full.type(full.price, '500')
  await submit(full)
  assert.equal(full.requests.length, 0, 'for any other profile type the two markers still disagree')
  assert.equal(full.root.querySelector('[profile-items-status]').textContent,
    'This form is misconfigured. Saving is paused until it is fixed.')
})
