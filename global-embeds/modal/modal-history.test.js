'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const file = path.join(__dirname, 'modal-history.js')
const storageKey = 'thestarters:modal-popups'
const firstTime = '2026-11-07T00:00:00.000Z'

function environment({ hostname = 'the-starters-3-0.webflow.io', raw, blocked = false, writeBlocked = false, readyState = 'complete', modalReady = true, memberstack = { async getCurrentMember() { return { data: null } } } } = {}) {
  let now = Date.parse(firstTime)
  let stored = raw
  let reads = 0
  let writes = 0
  let storageAccesses = 0
  const timers = []
  const listeners = new Map()
  const window = { location: { hostname }, STARTERS_DEBUG: true, $memberstackDom: memberstack }
  if (modalReady) window.lumos = { modal: { init() {} } }
  Object.defineProperty(window, 'localStorage', {
    get() {
      storageAccesses += 1
      if (blocked) throw new Error('Storage disabled')
      return {
        getItem(key) { assert.equal(key, storageKey); reads += 1; return stored ?? null },
        setItem(key, value) {
          assert.equal(key, storageKey)
          if (writeBlocked) throw new Error('Storage quota exceeded')
          writes += 1
          stored = value
        },
      }
    },
  })
  const document = {
    readyState,
    addEventListener(type, fn) {
      const list = listeners.get(type) || []
      list.push(fn)
      listeners.set(type, list)
    },
  }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const context = vm.createContext({
    window, document, Date: ClockDate,
    setTimeout(fn, ms) { const timer = { fn, at: now + ms }; timers.push(timer); return timer },
    clearTimeout(timer) { const index = timers.indexOf(timer); if (index !== -1) timers.splice(index, 1) },
  })
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  vm.runInContext(source, context)
  return {
    window, document,
    get history() { return window.lumos?.modal?.history },
    get stored() { return stored },
    get counts() { return { reads, writes, storageAccesses, timers: timers.length } },
    advance(ms) {
      const until = now + ms
      while (timers.some((timer) => timer.at <= until)) {
        timers.sort((a, b) => a.at - b.at)
        const timer = timers.shift()
        now = timer.at
        timer.fn()
      }
      now = until
    },
    domReady() {
      document.readyState = 'interactive'
      for (const fn of listeners.get('DOMContentLoaded') || []) fn()
    },
    reload() { vm.runInContext(source, context) },
  }
}

test('first visit is unseen and recording shown persists the exact event shape', async () => {
  const env = environment()
  assert.equal(await env.history.hasShown('k'), false)
  assert.equal(await env.history.record('k', 'shown'), true)
  assert.equal(await env.history.hasShown('k'), true)
  assert.deepEqual(JSON.parse(env.stored), { k: { shownAt: firstTime, dismissedAt: null, ctaAt: null } })
})

test('recording shown twice preserves the first timestamp', async () => {
  const env = environment()
  await env.history.record('k', 'shown')
  env.advance(5000)
  assert.equal(await env.history.record('k', 'shown'), true)
  assert.equal(JSON.parse(env.stored).k.shownAt, firstTime)
  assert.equal(env.counts.writes, 1)
})

test('dismissed and cta timestamps are independent and each keeps its first value', async () => {
  const env = environment()
  await env.history.record('k', 'shown')
  env.advance(1000)
  await env.history.record('k', 'dismissed')
  env.advance(1000)
  await env.history.record('k', 'cta')
  env.advance(1000)
  await env.history.record('k', 'dismissed')
  await env.history.record('k', 'cta')
  assert.deepEqual(JSON.parse(env.stored), { k: {
    shownAt: firstTime, dismissedAt: '2026-11-07T00:00:01.000Z', ctaAt: '2026-11-07T00:00:02.000Z',
  } })
})

test('corrupt JSON and invalid stored shapes return unknown and ignore writes', async () => {
  for (const raw of ['{broken', 'null', '[]', '42', '{"k":null}', '{"k":{"shownAt":123}}', '{"k":{"shownAt":"yesterday"}}']) {
    const env = environment({ raw })
    assert.equal(await env.history.hasShown('k'), null, raw)
    assert.equal(await env.history.record('k', 'shown'), false, raw)
    assert.equal(await env.history.entries(), null, raw)
    assert.equal(env.stored, raw)
    assert.equal(env.counts.writes, 0)
  }
})

test('storage access failures resolve unknown and false without throwing', async () => {
  const env = environment({ blocked: true })
  assert.equal(await env.history.hasShown('k'), null)
  assert.equal(await env.history.record('k', 'shown'), false)
  assert.equal(await env.history.entries(), null)
})

test('a rejected storage write returns false and leaves earlier history intact', async () => {
  const raw = JSON.stringify({ a: { shownAt: firstTime, dismissedAt: null, ctaAt: null } })
  const env = environment({ raw, writeBlocked: true })
  assert.equal(await env.history.record('b', 'shown'), false)
  assert.equal(env.stored, raw)
  assert.equal(await env.history.hasShown('a'), true)
})

test('both production hosts and lookalike hosts install nothing and never access storage', () => {
  for (const hostname of ['www.thestarters.com', 'thestarters.com', 'evil.webflow.io', 'localhost']) {
    const env = environment({ hostname })
    assert.equal(env.history, undefined)
    assert.deepEqual(env.counts, { reads: 0, writes: 0, storageAccesses: 0, timers: 0 })
  }
})

test('entries returns an independent deep copy, including prototype-like campaign keys', async () => {
  const env = environment()
  await env.history.record('__proto__', 'shown')
  const copy = await env.history.entries()
  assert.equal(Object.hasOwn(copy, '__proto__'), true)
  assert.equal(copy.__proto__.shownAt, firstTime)
  copy.__proto__.shownAt = null
  copy.extra = { shownAt: firstTime }
  const again = await env.history.entries()
  assert.equal(again.__proto__.shownAt, firstTime)
  assert.equal(again.extra, undefined)
})

test('dismissed alone does not mean displayed and other campaign history is preserved', async () => {
  const env = environment()
  await env.history.record('a', 'dismissed')
  await env.history.record('b', 'shown')
  assert.equal(await env.history.hasShown('a'), false)
  assert.equal(await env.history.hasShown('b'), true)
  assert.deepEqual(JSON.parse(env.stored), {
    a: { shownAt: null, dismissedAt: firstTime, ctaAt: null },
    b: { shownAt: firstTime, dismissedAt: null, ctaAt: null },
  })
})

test('installation starts its deadline at DOMContentLoaded and waits for the modal owner', () => {
  const env = environment({ readyState: 'loading', modalReady: false })
  env.advance(4500)
  assert.equal(env.history, undefined)
  assert.equal(env.window.lumos, undefined)
  env.domReady()
  env.window.lumos = { modal: { init() {} } }
  env.advance(50)
  assert.equal(typeof env.history.hasShown, 'function')
  const history = env.history
  env.reload()
  assert.equal(env.history, history)
})

test('invalid event or key does not write history', async () => {
  const env = environment()
  assert.equal(await env.history.record('k', 'other'), false)
  assert.equal(await env.history.record('', 'shown'), false)
  assert.equal(env.counts.writes, 0)
})

function memberStore(initial = {}, { rejectWrite = false, wrapped = true } = {}) {
  let json = structuredClone(initial)
  let reads = 0
  let writes = 0
  const sdk = {
    async getCurrentMember() { return { data: { id: 'member-1' } } },
    async getMemberJSON() { reads += 1; return wrapped ? { data: structuredClone(json) } : structuredClone(json) },
    async updateMemberJSON({ json: next }) {
      writes += 1
      if (rejectWrite) throw new Error('Write rejected')
      json = structuredClone(next)
    },
  }
  return { sdk, get json() { return json }, get reads() { return reads }, get writes() { return writes } }
}

test('member recording preserves tours and re-reads JSON for each write', async () => {
  const store = memberStore({ tours: { welcome: firstTime }, preferences: { email: false } })
  const env = environment({ memberstack: store.sdk })
  assert.equal(await env.history.record('k', 'shown'), true)
  assert.equal(await env.history.hasShown('k'), true)
  assert.deepEqual(store.json, {
    tours: { welcome: firstTime }, preferences: { email: false },
    popups: { k: { shownAt: firstTime, dismissedAt: null, ctaAt: null } },
  })
  store.json.tours.another = '2026-11-08T00:00:00.000Z'
  assert.equal(await env.history.record('k', 'cta'), true)
  assert.equal(store.json.tours.another, '2026-11-08T00:00:00.000Z')
  assert.equal(store.reads, 3)
  assert.equal(env.counts.writes, 0)
})

test('another device reads the account history with empty localStorage', async () => {
  const store = memberStore({ popups: { k: { shownAt: firstTime } } }, { wrapped: false })
  const env = environment({ memberstack: store.sdk })
  assert.equal(await env.history.hasShown('k'), true)
  assert.equal(store.writes, 0)
  const entries = await env.history.entries()
  entries.k.shownAt = null
  assert.equal(await env.history.hasShown('k'), true)
})

test('sign-in merges each event using its earliest time and adds guest-only keys once', async () => {
  const later = '2026-11-08T00:00:00.000Z'
  const raw = JSON.stringify({ k: { shownAt: firstTime, dismissedAt: later, ctaAt: firstTime }, guest: { shownAt: firstTime } })
  const store = memberStore({ tours: { welcome: firstTime }, popups: { k: { shownAt: later, dismissedAt: firstTime }, remote: { ctaAt: later } } })
  let signedIn = false
  store.sdk.getCurrentMember = async () => ({ data: signedIn ? { id: 'member-1' } : null })
  const env = environment({ raw, memberstack: store.sdk })
  assert.equal(await env.history.hasShown('guest'), true)
  assert.equal(store.writes, 0)
  signedIn = true
  const [shown, entries] = await Promise.all([env.history.hasShown('k'), env.history.entries()])
  assert.equal(shown, true)
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), {
    k: { shownAt: firstTime, dismissedAt: firstTime, ctaAt: firstTime },
    remote: { shownAt: null, dismissedAt: null, ctaAt: later },
    guest: { shownAt: firstTime, dismissedAt: null, ctaAt: null },
  })
  await env.history.hasShown('guest')
  await env.history.entries()
  assert.equal(store.writes, 1)
  assert.equal(env.stored, raw)
  assert.deepEqual(store.json.tours, { welcome: firstTime })
})

test('member lookup timeout returns unknown exactly after 3000 ms', async () => {
  const env = environment({ memberstack: { getCurrentMember() { return new Promise(() => {}) } } })
  let finished = false
  const result = env.history.hasShown('k').then(value => { finished = true; return value })
  env.advance(2999)
  await Promise.resolve()
  assert.equal(finished, false)
  env.advance(1)
  assert.equal(await result, null)
  const record = env.history.record('k', 'shown')
  env.advance(3000)
  assert.equal(await record, false)
})

test('member lookup errors, missing SDK, and member JSON failures fail closed', async () => {
  for (const memberstack of [undefined, null, { async getCurrentMember() { throw new Error('Lookup failed') } }, {
    async getCurrentMember() { return { data: { id: 'member-1' } } },
    async getMemberJSON() { throw new Error('Read failed') },
  }]) {
    const env = environment({ memberstack: memberstack ?? null })
    assert.equal(await env.history.hasShown('k'), null)
    assert.equal(await env.history.record('k', 'shown'), false)
    assert.equal(await env.history.entries(), null)
    assert.equal(env.counts.writes, 0)
  }
})

test('rejected member writes and malformed member popup history never throw', async () => {
  const store = memberStore({ tours: { welcome: firstTime } }, { rejectWrite: true })
  const env = environment({ memberstack: store.sdk })
  assert.equal(await env.history.record('k', 'shown'), false)
  assert.equal(await env.history.hasShown('k'), false)
  for (const popups of [[], 'bad', { k: { shownAt: 'invalid' } }]) {
    const broken = memberStore({ popups })
    const env = environment({ memberstack: broken.sdk })
    assert.equal(await env.history.hasShown('k'), null)
    assert.equal(await env.history.record('k', 'shown'), false)
    assert.equal(broken.writes, 0)
  }
})

test('popup writes share the tour write queue and preserve concurrent history', async () => {
  const store = memberStore({ tours: {} })
  const env = environment({ memberstack: store.sdk })
  env.window.__tsMemberJsonWrite = Promise.resolve().then(async () => {
    const { data: json } = await store.sdk.getMemberJSON()
    json.tours.welcome = firstTime
    await store.sdk.updateMemberJSON({ json })
  })
  assert.deepEqual(await Promise.all([env.history.record('a', 'shown'), env.history.record('__proto__', 'cta')]), [true, true])
  assert.equal(store.json.tours.welcome, firstTime)
  assert.equal(store.json.popups.a.shownAt, firstTime)
  assert.equal(Object.hasOwn(store.json.popups, '__proto__'), true)
  assert.equal(store.json.popups.__proto__.ctaAt, firstTime)
})
