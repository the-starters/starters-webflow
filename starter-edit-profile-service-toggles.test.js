'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = require.resolve('./starter-edit-profile.js')

function control(value = '') {
  const attributes = new Map()
  return {
    value,
    required: false,
    tagName: 'INPUT',
    setAttribute(name, attributeValue) { attributes.set(name, String(attributeValue)) },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
  }
}

// `<head>` is where the controller really installs its hiding rule, so the harness has to
// own one for the dedupe guard to be exercised at all.
function documentHead() {
  const children = []
  return {
    children,
    appendChild(node) { children.push(node); return node },
    querySelector(selector) {
      const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1]
      if (!attribute) return null
      return children.find((node) => node.getAttribute?.(attribute) !== null) || null
    },
  }
}

function createdElement(tagName) {
  const attributes = new Map()
  return {
    tagName,
    className: '',
    href: '',
    textContent: '',
    style: {},
    setAttribute(name, value) { attributes.set(name, String(value)) },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
    appendChild(node) { return node },
    addEventListener() {},
  }
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
  unifiedServices = false,
  retainerRequired = false,
  callSettingsStep = false,
  legacyCallControls = true,
  shareRetainerRateWrapper = false,
} = {}) {
  const retainerDescriptionField = control(retainerDescription)
  const retainerRateField = control('2500')
  const paidCallRateField = control('400')
  const paidCallDescriptionField = control(paidCallDescription)
  const freeCallDescriptionField = control(freeCallDescription)

  const retainerDesc = group({ required: true, fields: [retainerDescriptionField] })
  // The accepted contract leaves a wrapper shared with a Retainer control visible, so the
  // Paid Call rate sits inside the Retainer rate wrapper the Retainer toggle operates on.
  const retainerRate = group({
    required: true,
    fields: shareRetainerRateWrapper ? [retainerRateField, paidCallRateField] : [retainerRateField],
  })
  retainerRateField.required = retainerRequired
  if (unifiedServices) {
    for (const wrapper of [retainerDesc, retainerRate]) wrapper.closest = selector => selector === '[profile-unified-items="services"]' ? {} : null
  }
  const paidCallGroup = group({ required: true, fields: [paidCallDescriptionField] })
  const freeCallGroup = group({ required: true, fields: [freeCallDescriptionField] })
  if (unifiedServices) {
    for (const wrapper of [paidCallGroup, freeCallGroup]) {
      wrapper.closest = selector => selector === '[profile-unified-items="services"]' ? {} : null
    }
  }

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

  // The dashboard owns Free and Paid Call settings; step 6 only carries the locked controls.
  const canonicalCallControls = legacyCallControls ? [paidCallDescriptionField, freeCallDescriptionField] : []
  if (legacyCallControls && shareRetainerRateWrapper) canonicalCallControls.push(paidCallRateField)
  const stepSix = {
    querySelector(selector) {
      if (selector === '[data-call-settings-profile-notice]') return null
      const byName = {
        '[name="free-call-description"]': freeCallDescriptionField,
        '[name="paid-call-description"]': paidCallDescriptionField,
        '[name="paid-call-rate"]': paidCallRateField,
      }
      return byName[selector] || null
    },
    querySelectorAll() { return canonicalCallControls },
    appendChild() {},
  }
  const selectors = {
    '[data-monthly-retainers-description]': retainerDesc,
    '[data-monthly-retainers-rate]': retainerRate,
    ...(callSettingsStep ? { '[data-form="step"][data-index="6"]': stepSix } : {}),
  }
  const selectorsAll = {
    'input[name="offer-monthly-retainers"]': retainerRadios,
    'input[name="paid-consulting-calls"]': paidCallRadios,
    'input[name="free-consulting-calls"]': freeCallRadios,
    '[paid-call-group]': [paidCallGroup],
    '[free-call-group]': [freeCallGroup],
  }

  const head = documentHead()
  const domReady = []
  const profileDataCallbacks = []
  let hydrationCallbackRuns = 0
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
      head,
      createElement(tag) { return createdElement(tag) },
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
      paidCallRate: paidCallRateField,
      paidCallDescription: paidCallDescriptionField,
      freeCallDescription: freeCallDescriptionField,
    },
    ownershipStyles: () => head.children.filter((node) => node.tagName === 'style'),
    groups: { retainerDesc, retainerRate, paidCallGroup, freeCallGroup },
    // The controller defers its first toggle pass until canonical profile data lands.
    // Callbacks are replayed, not drained, so a second call really is a second pass.
    hydrate() {
      const callbacks = [...profileDataCallbacks]
      assert.ok(callbacks.length > 0, 'controller registered no profile-data callbacks')
      hydrationCallbackRuns += callbacks.length
      for (const callback of callbacks) callback(context.activeProfile)
    },
    hydrationCallbackRuns: () => hydrationCallbackRuns,
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

test('migrated retainers preserve authored Required and exclude disabled fields', () => {
  for (const retainerRequired of [false, true]) {
    const harness = boot({ unifiedServices: true, retainerRequired })
    harness.hydrate()
    assert.equal(harness.fields.retainerRate.required, retainerRequired)
    assert.equal(harness.fields.retainerDescription.required, false)
    assert.equal(harness.fields.retainerRate.disabled, false)
    harness.chooseRetainers('no')
    assert.equal(harness.fields.retainerRate.required, retainerRequired)
    assert.equal(harness.fields.retainerRate.disabled, true)
    harness.chooseRetainers('yes')
    assert.equal(harness.fields.retainerRate.required, retainerRequired)
    assert.equal(harness.fields.retainerRate.disabled, false)
  }
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
  const firstPassRuns = harness.hydrationCallbackRuns()
  assert.ok(firstPassRuns > 0)

  harness.fields.retainerDescription.value = 'Edited between hydration passes'
  harness.hydrate()

  assert.equal(harness.hydrationCallbackRuns(), firstPassRuns * 2)
  assert.equal(harness.fields.retainerDescription.value, 'Edited between hydration passes')
  assert.equal(harness.fields.freeCallDescription.value, 'A free intro call')
  assert.equal(harness.fields.paidCallDescription.value, 'A paid deep dive')
  assert.equal(harness.groups.retainerDesc.style.display, 'none')
  assert.equal(harness.fields.retainerDescription.required, false)
})

test('a unified services section keeps Free and Paid Call settings editable in this form', () => {
  const harness = boot({ unifiedServices: true, callSettingsStep: true, paidCalls: 'no', freeCalls: 'no' })
  harness.hydrate()
  assert.equal(harness.fields.paidCallDescription.disabled, true)
  assert.equal(harness.fields.freeCallDescription.disabled, true)

  // Each canonical call controller owns its fields and the profile PATCH omits them.
  harness.choosePaidCalls('yes')
  assert.equal(harness.fields.paidCallDescription.disabled, false)
  harness.chooseFreeCalls('yes')
  assert.equal(harness.fields.freeCallDescription.disabled, false)
  assert.equal(harness.fields.paidCallDescription.required, false)
  assert.equal(harness.fields.freeCallDescription.required, false)
})

test('a wrapper shared with a Retainer control preserves the Paid Call toggle state', () => {
  const harness = boot({
    unifiedServices: true,
    callSettingsStep: true,
    shareRetainerRateWrapper: true,
    retainers: 'no',
  })
  harness.hydrate()
  assert.equal(harness.fields.paidCallRate.disabled, false)

  // Retainer visibility must not disable a Paid Call rate while Paid Calls remain on.
  harness.chooseRetainers('yes')
  assert.equal(harness.fields.paidCallRate.disabled, false)
  assert.equal(harness.fields.retainerRate.disabled, false)

  harness.chooseRetainers('no')
  assert.equal(harness.fields.paidCallRate.disabled, false)
})

test('re-applying canonical call ownership never installs a hiding rule', () => {
  const harness = boot({ unifiedServices: true, callSettingsStep: true })
  harness.hydrate()
  harness.choosePaidCalls('yes')
  harness.chooseFreeCalls('yes')
  harness.chooseRetainers('no')

  assert.deepEqual(harness.ownershipStyles(), [])
})

test('a step that no longer carries the legacy call controls installs no hiding rule', () => {
  const harness = boot({ unifiedServices: true, callSettingsStep: true, legacyCallControls: false })
  harness.hydrate()

  assert.deepEqual(harness.ownershipStyles(), [])
})
