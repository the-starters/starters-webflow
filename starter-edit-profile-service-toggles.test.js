'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = require.resolve('./starter-edit-profile.js')

function control(value = '') {
  return { value, required: false, tagName: 'INPUT' }
}

function group({ required = false, fields = [] } = {}) {
  return {
    style: {},
    fields,
    hasAttribute(name) { return name === 'data-required' && required },
    querySelectorAll(selector) { return selector === 'input, textarea' ? fields : [] },
  }
}

function radio(name, value) {
  const listeners = new Map()
  return {
    name,
    value,
    checked: false,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener])
    },
    change(radios) {
      radios.forEach((candidate) => { candidate.checked = candidate === this })
      for (const listener of listeners.get('change') || []) listener({ type: 'change' })
    },
  }
}

// Mirrors the published Starter Edit Profile services markup: each toggle owns a
// description control that must survive a hydrated "no" and be cleared only when
// the member themself switches the toggle off.
function boot({
  retainers = 'yes',
  paidCalls = 'yes',
  freeCalls = 'yes',
  retainerDescription = 'Ongoing advisory retainer',
  freeCallDescription = 'A free intro call',
  paidCallDescription = 'A paid deep dive',
} = {}) {
  const retainerDescriptionField = control(retainerDescription)
  const retainerRateField = control('2500')
  const paidCallDescriptionField = control(paidCallDescription)
  const freeCallDescriptionField = control(freeCallDescription)

  const retainerDesc = group({ required: true, fields: [retainerDescriptionField] })
  const retainerRate = group({ required: true, fields: [retainerRateField] })
  const paidCallGroup = group({ required: true, fields: [paidCallDescriptionField] })
  const freeCallGroup = group({ required: true, fields: [freeCallDescriptionField] })

  const retainerRadios = [radio('offer-monthly-retainers', 'yes'), radio('offer-monthly-retainers', 'no')]
  const paidCallRadios = [radio('paid-consulting-calls', 'yes'), radio('paid-consulting-calls', 'no')]
  const freeCallRadios = [radio('free-consulting-calls', 'yes'), radio('free-consulting-calls', 'no')]

  const checkedByGroup = { retainers, paidCalls, freeCalls }
  for (const [radios, checkedValue] of [
    [retainerRadios, retainers],
    [paidCallRadios, paidCalls],
    [freeCallRadios, freeCalls],
  ]) {
    radios.forEach((option) => { option.checked = option.value === checkedValue })
  }

  const selectors = {
    '[data-monthly-retainers-description]': retainerDesc,
    '[data-monthly-retainers-rate]': retainerRate,
  }
  const selectorsAll = {
    'input[name="offer-monthly-retainers"]': retainerRadios,
    'input[name="paid-consulting-calls"]': paidCallRadios,
    'input[name="free-consulting-calls"]': freeCallRadios,
    '[paid-call-group]': [paidCallGroup],
    '[free-call-group]': [freeCallGroup],
  }

  const domReady = []
  const profileDataCallbacks = []
  const context = {
    Date,
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        Object.assign(this, options)
      }
    },
    FormData: class FormData { forEach() {} },
    JSON,
    Math,
    Promise,
    Uint32Array,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: {
      readyState: 'loading',
      currentScript: null,
      addEventListener(type, listener) {
        if (type === 'DOMContentLoaded') domReady.push(listener)
      },
      querySelector(selector) {
        const checkedMatch = /^input\[name="([^"]+)"\]:checked$/.exec(selector)
        if (checkedMatch) {
          const radios = selectorsAll[`input[name="${checkedMatch[1]}"]`] || []
          return radios.find((option) => option.checked) || null
        }
        return selectors[selector] ?? null
      },
      querySelectorAll(selector) { return selectorsAll[selector] || [] },
    },
    clearInterval() {},
    clearTimeout() {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setInterval: () => 1,
    setTimeout: () => 1,
    $: (target) => ({ each() {}, trigger() { return this }, find() { return this }, closest() { return this }, attr() {}, append() {}, remove() {}, filter() { return this }, detach() { return this }, text() { return '' } }),
  }
  context.window = context
  Object.assign(context, {
    activeProfile: { type: 'consult', type_id: 2, data: { step_1: {} } },
    MEMBER: { id: 'member-1', auth: { email: 'starter@example.com' }, customFields: {} },
    FinsweetAttributes: [],
    intlTelInput: Object.assign(() => ({}), { getInstance: () => null }),
    location: { replace() {}, hostname: 'the-starters-3-0.webflow.io' },
    waitForMember(callback) { callback(this.MEMBER) },
    waitProfileData(callback) { profileDataCallbacks.push(callback) },
  })
  vm.createContext(context)
  new vm.Script(fs.readFileSync(SOURCE, 'utf8'), { filename: SOURCE }).runInContext(context)
  for (const listener of [...domReady]) listener()

  return {
    checkedByGroup,
    fields: {
      retainerDescription: retainerDescriptionField,
      retainerRate: retainerRateField,
      paidCallDescription: paidCallDescriptionField,
      freeCallDescription: freeCallDescriptionField,
    },
    groups: { retainerDesc, retainerRate, paidCallGroup, freeCallGroup },
    // The controller defers its first toggle pass until canonical profile data lands.
    hydrate() {
      for (const callback of profileDataCallbacks.splice(0)) callback(context.activeProfile)
    },
    chooseRetainers(value) { retainerRadios.find((option) => option.value === value).change(retainerRadios) },
    choosePaidCalls(value) { paidCallRadios.find((option) => option.value === value).change(paidCallRadios) },
    chooseFreeCalls(value) { freeCallRadios.find((option) => option.value === value).change(freeCallRadios) },
  }
}

test('hydrating a profile that declined every service keeps its stored descriptions', () => {
  const harness = boot({ retainers: 'no', paidCalls: 'no', freeCalls: 'no' })

  harness.hydrate()

  assert.equal(harness.fields.retainerDescription.value, 'Ongoing advisory retainer')
  assert.equal(harness.fields.retainerRate.value, '2500')
  assert.equal(harness.fields.paidCallDescription.value, 'A paid deep dive')
  assert.equal(harness.fields.freeCallDescription.value, 'A free intro call')
})

test('hydration hides and un-requires the declined service groups', () => {
  const harness = boot({ retainers: 'no', paidCalls: 'no', freeCalls: 'no' })

  harness.hydrate()

  assert.equal(harness.groups.retainerDesc.style.display, 'none')
  assert.equal(harness.groups.paidCallGroup.style.display, 'none')
  assert.equal(harness.groups.freeCallGroup.style.display, 'none')
  assert.equal(harness.fields.retainerDescription.required, false)
  assert.equal(harness.fields.freeCallDescription.required, false)
})

test('hydrating an accepted service shows and requires its controls', () => {
  const harness = boot()

  harness.hydrate()

  assert.equal(harness.groups.retainerDesc.style.display, '')
  assert.equal(harness.fields.retainerDescription.required, true)
  assert.equal(harness.fields.freeCallDescription.required, true)
  assert.equal(harness.fields.retainerDescription.value, 'Ongoing advisory retainer')
})

test('the member switching a service off clears that service description', () => {
  const harness = boot()
  harness.hydrate()

  harness.chooseRetainers('no')
  assert.equal(harness.fields.retainerDescription.value, '')
  assert.equal(harness.fields.retainerRate.value, '')

  harness.chooseFreeCalls('no')
  assert.equal(harness.fields.freeCallDescription.value, '')

  harness.choosePaidCalls('no')
  assert.equal(harness.fields.paidCallDescription.value, '')
})

test('the member switching a service on leaves its description untouched', () => {
  const harness = boot({ retainers: 'no', paidCalls: 'no', freeCalls: 'no' })
  harness.hydrate()

  harness.chooseRetainers('yes')

  assert.equal(harness.fields.retainerDescription.value, 'Ongoing advisory retainer')
  assert.equal(harness.groups.retainerDesc.style.display, '')
  assert.equal(harness.fields.retainerDescription.required, true)
})

test('a second hydration pass after a reload still preserves declined descriptions', () => {
  const harness = boot({ retainers: 'no', paidCalls: 'no', freeCalls: 'no' })

  harness.hydrate()
  harness.hydrate()

  assert.equal(harness.fields.retainerDescription.value, 'Ongoing advisory retainer')
  assert.equal(harness.fields.freeCallDescription.value, 'A free intro call')
})
