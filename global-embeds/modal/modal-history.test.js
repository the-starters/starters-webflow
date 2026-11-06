'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const file = path.join(__dirname, 'modal-history.js')
const storageKey = 'thestarters:modal-popups'
const firstTime = '2026-11-07T00:00:00.000Z'

function environment({ hostname = 'the-starters-3-0.webflow.io', raw, blocked = false, writeBlocked = false, readyState = 'complete', modalReady = true } = {}) {
  let now = Date.parse(firstTime)
  let stored = raw
  let reads = 0
  let writes = 0
  let storageAccesses = 0
  const timers = []
  const listeners = new Map()
  const window = { location: { hostname }, STARTERS_DEBUG: true }
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
    setTimeout(fn, ms) { timers.push({ fn, at: now + ms }) },
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
