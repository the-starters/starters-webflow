const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./select-profile.js'), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const MEMBER_ID = 'mem_test'
const KEY = 'ts:build_profile:member:' + MEMBER_ID

class Button {
  constructor(btn, href) {
    this.dataset = { btn }
    this.href = href
    this.listeners = new Map()
  }
  getAttribute(name) { return name === 'href' ? this.href : name === 'data-btn' ? this.dataset.btn : null }
  addEventListener(name, cb) { this.listeners.set(name, cb) }
  click() {
    let prevented = false
    this.listeners.get('click')({ preventDefault() { prevented = true } })
    return prevented
  }
}

function makeStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  return {
    map,
    get length() { return map.size },
    key(i) { return [...map.keys()][i] ?? null },
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
  }
}

function load({ memberData = {}, storage = makeStorage(), readFails = false, slowWriteMs = 0, queue } = {}) {
  const writes = []
  const order = []
  let data = memberData
  const full = new Button('profile-full', '/build-profile/full-profile')
  const consult = new Button('profile-consult', '/build-profile/consult')
  const warnings = []
  const window = {
    __tsProfileFormControllers: {},
    __tsMemberJsonWrite: queue,
    location: { href: '/build-profile/select-profile' },
    localStorage: storage,
    MEMBER: { id: MEMBER_ID },
    waitForMember: (cb) => Promise.resolve({ id: MEMBER_ID }).then((m) => { cb(m); return m }),
    $memberstackDom: {
      getMemberJSON: async () => {
        order.push('read')
        if (readFails) throw new Error('read failed')
        return { data }
      },
      updateMemberJSON: async (value) => {
        order.push('write')
        if (slowWriteMs) await new Promise((r) => setTimeout(r, slowWriteMs))
        writes.push(value)
        data = value.json
        return { data }
      },
    },
  }
  const context = {
    window,
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelectorAll: (sel) => (sel === '[data-btn*=profile]' ? [full, consult] : []),
    },
    console: { log() {}, warn: (...a) => warnings.push(a.join(' ')), error() {} },
    setTimeout, Promise, Object, Array, String, JSON,
  }
  vm.runInNewContext(SOURCE, context)
  return { window, writes, order, storage, full, consult, warnings, getData: () => data }
}

test('null member JSON does not throw and does not write (PostHog 01a13fe5)', async () => {
  const s = load({ memberData: null, storage: makeStorage({ [KEY]: '{"type":"full"}' }) })
  await flush(); await flush()
  assert.deepEqual(s.writes, [])
  assert.deepEqual(s.order, ['read'])
  assert.equal(s.warnings.length, 0)
})

test('returning Starter: build_profile is removed and other keys are kept', async () => {
  const s = load({ memberData: { build_profile: { type: 'full' }, modal_history: { a: 1 }, starterQuiz: 'x' }, storage: makeStorage({ [KEY]: '{"type":"full"}' }) })
  await flush(); await flush()
  assert.equal(s.writes.length, 1)
  // JSON copy: the object is created in the vm realm (different Object prototype).
  assert.deepEqual(JSON.parse(JSON.stringify(s.writes[0].json)), { modal_history: { a: 1 }, starterQuiz: 'x' })
})

test('no previous choice: member JSON is not read or written', async () => {
  const s = load({ memberData: { build_profile: { type: 'full' } } })
  await flush(); await flush()
  assert.deepEqual(s.order, [])
  assert.deepEqual(s.writes, [])
})

test('missing build_profile key: no write', async () => {
  const s = load({ memberData: { modal_history: {} }, storage: makeStorage({ [KEY]: '{}' }) })
  await flush(); await flush()
  assert.deepEqual(s.order, ['read'])
  assert.deepEqual(s.writes, [])
})

test('write runs after an earlier queued member JSON writer and joins the shared queue', async () => {
  const events = []
  let release
  const earlier = new Promise((r) => { release = r }).then(() => { events.push('earlier-writer-done') })
  const s = load({ memberData: { build_profile: {} }, storage: makeStorage({ [KEY]: '{}' }), queue: earlier })
  await flush()
  assert.deepEqual(s.order, [], 'must wait for the earlier writer')
  release()
  await flush(); await flush(); await flush()
  assert.deepEqual(events, ['earlier-writer-done'])
  assert.deepEqual(s.order, ['read', 'write'])
  assert.notEqual(s.window.__tsMemberJsonWrite, earlier, 'queue head advanced')
})

test('read failure is caught (no unhandled rejection) and the page still works', async () => {
  const s = load({ memberData: { build_profile: {} }, storage: makeStorage({ [KEY]: '{}' }), readFails: true })
  await flush(); await flush()
  assert.deepEqual(s.writes, [])
  assert.equal(s.warnings.length, 1)
  assert.equal(s.full.click(), true)
})

test('all build_profile local keys are removed, other keys kept', async () => {
  const storage = makeStorage({
    'ts:build_profile:member:a': '1',
    'ts:build_profile:member:b': '2',
    'ts:build_profile:member:c': '3',
    'other:key': 'keep',
  })
  load({ memberData: {}, storage })
  await flush()
  assert.deepEqual([...storage.map.keys()], ['other:key'])
})

test('click stores the chosen type and navigates after the clear finishes', async () => {
  const s = load({ memberData: { build_profile: {} }, storage: makeStorage({ [KEY]: '{}' }), slowWriteMs: 30 })
  await flush()
  assert.equal(s.consult.click(), true)
  assert.deepEqual(JSON.parse(s.storage.getItem(KEY)), { type: 'consult', type_id: 'ca6ff4250b7d01b49e83433432af3686', last_update: null, data: {} })
  assert.equal(s.window.location.href, '/build-profile/select-profile', 'waits for the pending clear')
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(s.writes.length, 1)
  assert.equal(s.window.location.href, '/build-profile/consult')
})

test('click navigates within the bound even if the clear never finishes', async () => {
  const stuck = new Promise(() => {})
  const s = load({ memberData: { build_profile: {} }, storage: makeStorage({ [KEY]: '{}' }), queue: stuck })
  await flush()
  s.full.click()
  await new Promise((r) => setTimeout(r, 1700))
  assert.equal(s.window.location.href, '/build-profile/full-profile')
})

test('controller boots once even if the script loads twice', async () => {
  const s = load({ memberData: {} })
  vm.runInNewContext(SOURCE, { window: s.window, document: { readyState: 'complete', addEventListener() {}, querySelectorAll: () => { throw new Error('second boot') } }, console, setTimeout, Promise })
  await flush()
  assert.ok(s.window.__tsProfileFormControllers.buildProfileSelectProfile)
})
