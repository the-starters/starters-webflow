const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./draft-state.js'), 'utf8')

const flush = () => new Promise((resolve) => setImmediate(resolve))

class Element {
  constructor(attrs = {}, value = '') {
    this.attrs = new Map(Object.entries(attrs))
    this.value = value
    this.name = attrs.name || ''
    this.tagName = 'INPUT'
    this.checked = false
    this.listeners = new Map()
  }
  getAttribute(name) { return this.attrs.has(name) ? String(this.attrs.get(name)) : null }
  hasAttribute(name) { return this.attrs.has(name) }
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  dispatchEvent() { return true }
  closest() { return null }
  async click() { return this.listeners.get('click')?.({ preventDefault() {} }) }
}

async function load({ memberJSON: initialMemberJSON = {} } = {}) {
  const headline = new Element({ 'data-input-capture': '', name: 'headline' }, 'Growth advisor')
  const nextBtn = new Element({ 'data-form': 'next-btn' })
  const step = new Element({ 'data-form': 'step', 'data-index': '1' })

  let memberJSON = { ...initialMemberJSON }
  const writes = []
  let readsFail = false
  const store = new Map()
  const MEMBER = { id: 'mem_test', auth: { email: 'starter@example.test' }, customFields: {} }

  const qsa = (selector, scope) => {
    if (selector === '[data-form="step"]') return [step]
    if (scope !== step) return []
    if (selector === '[data-input-capture]') return [headline]
    if (selector === '[data-form="next-btn"], [form-submit]') return [nextBtn]
    return []
  }

  const window = {
    __tsProfileFormControllers: {},
    $memberstackDom: {
      getMemberJSON: async () => {
        if (readsFail) throw new Error('Memberstack read failed')
        return { data: memberJSON }
      },
      updateMemberJSON: async (value) => {
        writes.push(value)
        memberJSON = value.json
        return { data: memberJSON }
      },
    },
  }

  const domReady = []
  const context = {
    window,
    document: {
      addEventListener: (name, callback) => { if (name === 'DOMContentLoaded') domReady.push(callback) },
    },
    MEMBER,
    activeProfile: null,
    createEmptyProfile: (type, typeId, lastUpdate) => ({ type, type_id: typeId, last_update: lastUpdate, data: {} }),
    waitForMember: (callback) => { callback(MEMBER) },
    qs: () => null,
    qsa,
    setLoader() {},
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)) },
    },
    CSS: { escape: (value) => String(value) },
    Event: class { constructor(type) { this.type = type } },
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
  }

  vm.runInNewContext(SOURCE, context, { filename: 'draft-state.js' })
  domReady.forEach((callback) => callback())
  await flush()
  assert.equal(nextBtn.listeners.has('click'), true, 'the draft controller must bind the next button')

  return {
    nextBtn,
    window,
    writes,
    memberJSON: () => memberJSON,
    localDraft: () => JSON.parse(store.get('ts:build_profile:member:mem_test')),
    failReads: (value) => { readsFail = value },
  }
}

test('a draft save waits for the shared member JSON writer and keeps the Call Settings receipt', async () => {
  const result = await load({
    memberJSON: { build_profile: { last_update: 1000, data: {} }, keep: 'member-json' },
  })

  let releaseHolder
  const holder = new Promise((resolve) => { releaseHolder = resolve })
  const holderWrite = holder.then(async () => {
    const current = (await result.window.$memberstackDom.getMemberJSON()).data
    await result.window.$memberstackDom.updateMemberJSON({
      json: { ...current, starter_call_settings_intent_v3: { version: 1, free: { enabled: true } } },
    })
  })
  result.window.__tsMemberJsonWrite = holderWrite.then(() => {}, () => {})

  const draftSave = result.nextBtn.click()
  await flush()
  assert.equal(result.writes.length, 0, 'the draft write must not overtake the queued holder')

  releaseHolder()
  await Promise.all([holderWrite, draftSave])

  assert.equal(result.writes.length, 2)
  assert.deepEqual(result.memberJSON().starter_call_settings_intent_v3, { version: 1, free: { enabled: true } })
  assert.equal(result.memberJSON().build_profile.data.step_1.headline, 'Growth advisor')
  assert.equal(result.memberJSON().keep, 'member-json')
})

test('a failed member JSON read abandons the draft write instead of erasing other keys', async () => {
  const result = await load({
    memberJSON: {
      build_profile: { last_update: 1000, data: {} },
      starter_call_settings_intent_v3: { version: 1, free: { enabled: true } },
      tours: { dashboard: true },
    },
  })

  result.failReads(true)
  await result.nextBtn.click()

  assert.equal(result.writes.length, 0)
  assert.deepEqual(result.memberJSON().starter_call_settings_intent_v3, { version: 1, free: { enabled: true } })
  assert.deepEqual(result.memberJSON().tours, { dashboard: true })
  assert.equal(result.localDraft().data.step_1.headline, 'Growth advisor')
})

test('a later draft save still commits after an abandoned one', async () => {
  const result = await load({
    memberJSON: { build_profile: { last_update: 1000, data: {} }, tours: { dashboard: true } },
  })

  result.failReads(true)
  await result.nextBtn.click()
  result.failReads(false)
  await result.nextBtn.click()

  assert.equal(result.writes.length, 1)
  assert.equal(result.memberJSON().build_profile.data.step_1.headline, 'Growth advisor')
  assert.deepEqual(result.memberJSON().tours, { dashboard: true })
})
