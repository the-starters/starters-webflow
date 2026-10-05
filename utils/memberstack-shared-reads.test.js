const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./memberstack-shared-reads.js'), 'utf8')

/**
 * Loads the module against a fake window carrying a fake Memberstack DOM SDK.
 * The fake SDK counts network reads and lets a test hold them open, change the
 * cookie, or fail them.
 */
function load(options = {}) {
  const calls = { reads: 0, writes: 0, timers: [] }
  let cookie = options.cookie === undefined ? 'cookie-a' : options.cookie
  let member = { id: 'mem_a' }
  let pending = []
  let authListener = null

  const memberstack = {
    async getCurrentMember(...args) {
      calls.reads += 1
      if (options.readError) throw options.readError
      if (options.hold) {
        return new Promise((resolve, reject) => {
          pending.push({ resolve: () => resolve({ data: member, args }), reject })
        })
      }
      return { data: member, args }
    },
    async getMemberCookie() {
      return cookie
    },
    onAuthChange(listener) {
      authListener = listener
    },
    async updateMember(payload) {
      calls.writes += 1
      member = Object.assign({}, member, payload)
      return { data: member }
    },
  }

  const window = {
    setTimeout(fn, ms) {
      calls.timers.push({ fn, ms })
      return calls.timers.length
    },
  }
  if (options.sdk !== false) window.$memberstackDom = memberstack

  vm.runInNewContext(source, { window, Promise, JSON, Map, Array, Object })

  return {
    window,
    memberstack,
    calls,
    setCookie(value) {
      cookie = value
    },
    setMember(value) {
      member = value
    },
    authChange() {
      if (authListener) authListener({ member })
    },
    releaseAll() {
      const batch = pending
      pending = []
      batch.forEach((entry) => entry.resolve())
    },
    pendingCount() {
      return pending.length
    },
  }
}

async function settle(turns = 5) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('ten concurrent identical reads make one network request and share the result', async () => {
  const state = load({ hold: true })
  const results = Promise.all(
    Array.from({ length: 10 }, () => state.memberstack.getCurrentMember()),
  )
  await settle()

  assert.equal(state.calls.reads, 1)
  assert.equal(state.pendingCount(), 1)
  state.releaseAll()
  const values = await results

  assert.equal(values.length, 10)
  values.forEach((value) => assert.equal(value.data.id, 'mem_a'))
})

test('a zero-argument read shares with trailing undefined arguments', async () => {
  const state = load({ hold: true })
  const first = state.memberstack.getCurrentMember(undefined)
  const second = state.memberstack.getCurrentMember()
  await settle()

  assert.equal(state.calls.reads, 1)
  assert.equal(state.pendingCount(), 1)
  state.releaseAll()
  const values = await Promise.all([first, second])
  values.forEach((value) => assert.deepEqual(value.args, []))
})

test('a null argument does not share with a zero-argument read', async () => {
  const state = load({ hold: true })
  const first = state.memberstack.getCurrentMember(null)
  const second = state.memberstack.getCurrentMember()
  await settle()

  assert.equal(state.calls.reads, 2)
  state.releaseAll()
  await Promise.all([first, second])
})

test('identical JSON-safe option objects share one network request', async () => {
  const state = load({ hold: true })
  const first = state.memberstack.getCurrentMember({ useCache: true })
  const second = state.memberstack.getCurrentMember({ useCache: true })
  await settle()

  assert.equal(state.calls.reads, 1)
  assert.equal(state.pendingCount(), 1)
  state.releaseAll()
  await Promise.all([first, second])
})

test('an option object with a function value bypasses sharing', async () => {
  const state = load({ hold: true })
  const shared = state.memberstack.getCurrentMember({ useCache: true })
  await settle()

  const bypassed = state.memberstack.getCurrentMember({
    useCache: true,
    transform() {
      return true
    },
  })
  const stillShared = state.memberstack.getCurrentMember({ useCache: true })
  await settle()

  assert.equal(state.calls.reads, 2)
  assert.equal(state.pendingCount(), 2)
  state.releaseAll()
  await Promise.all([shared, bypassed, stillShared])
})

test('a read that starts after the previous one settled goes to the network again', async () => {
  const state = load()
  await state.memberstack.getCurrentMember()
  await state.memberstack.getCurrentMember()

  assert.equal(state.calls.reads, 2)
})

test('reads with different arguments are not merged', async () => {
  const state = load({ hold: true })
  const first = state.memberstack.getCurrentMember({ useCache: true })
  const second = state.memberstack.getCurrentMember()
  await settle()

  assert.equal(state.calls.reads, 2)
  state.releaseAll()
  await Promise.all([first, second])
})

test('a write drops the in-flight entry so the next read is fresh', async () => {
  const state = load({ hold: true })
  const stale = state.memberstack.getCurrentMember()
  await settle()
  assert.equal(state.calls.reads, 1)

  const write = state.memberstack.updateMember({ id: 'mem_a', plan: 'paid' })
  const fresh = state.memberstack.getCurrentMember()
  await settle()

  assert.equal(state.calls.writes, 1)
  assert.equal(state.calls.reads, 2)
  state.releaseAll()
  await Promise.all([stale, write, fresh])
})

test('an auth change drops the in-flight entry', async () => {
  const state = load({ hold: true })
  const before = state.memberstack.getCurrentMember()
  await settle()
  state.authChange()
  const after = state.memberstack.getCurrentMember()
  await settle()

  assert.equal(state.calls.reads, 2)
  state.releaseAll()
  await Promise.all([before, after])
})

test('a cookie change between two reads keeps them apart', async () => {
  const state = load({ hold: true })
  const first = state.memberstack.getCurrentMember()
  await settle()
  state.setCookie('cookie-b')
  const second = state.memberstack.getCurrentMember()
  await settle()

  assert.equal(state.calls.reads, 2)
  state.releaseAll()
  await Promise.all([first, second])
})

test('a failed read rejects every sharer and is not kept', async () => {
  const error = new Error('network down')
  const state = load({ readError: error })
  const first = state.memberstack.getCurrentMember()
  const second = state.memberstack.getCurrentMember()

  await assert.rejects(first, /network down/)
  await assert.rejects(second, /network down/)
  assert.equal(state.calls.reads, 1)

  await assert.rejects(state.memberstack.getCurrentMember(), /network down/)
  assert.equal(state.calls.reads, 2)
})

test('the module installs once and marks the SDK as shared', () => {
  const state = load()

  assert.equal(state.memberstack.__tsSharedReads, 'utils/memberstack-shared-reads')
  assert.equal(state.window.__tsMemberstackSharedReads.isInstalled(), true)

  // A second evaluation (for example a duplicated tag) is a no-op.
  vm.runInNewContext(source, { window: state.window, Promise, JSON, Map, Array, Object })
  assert.equal(state.window.__tsMemberstackSharedReads.owner, 'utils/memberstack-shared-reads')
})

test('an SDK already wrapped by another owner is left alone', async () => {
  const state = load({ sdk: false })
  let reads = 0
  state.window.$memberstackDom = {
    __tsSharedReads: true,
    async getCurrentMember() {
      reads += 1
      return { data: { id: 'mem_a' } }
    },
  }
  // Fire the pending install poll.
  state.calls.timers[0].fn()
  await Promise.all([
    state.window.$memberstackDom.getCurrentMember(),
    state.window.$memberstackDom.getCurrentMember(),
  ])

  assert.equal(reads, 2)
  assert.equal(state.window.$memberstackDom.__tsSharedReads, true)
})

test('the module waits for the SDK and installs when it appears', async () => {
  const state = load({ sdk: false })

  assert.equal(state.window.__tsMemberstackSharedReads.isInstalled(), false)
  assert.equal(state.calls.timers.length, 1)
  assert.equal(state.calls.timers[0].ms, 100)

  state.window.$memberstackDom = state.memberstack
  state.calls.timers[0].fn()
  assert.equal(state.window.__tsMemberstackSharedReads.isInstalled(), true)

  const both = Promise.all([
    state.memberstack.getCurrentMember(),
    state.memberstack.getCurrentMember(),
  ])
  await both
  assert.equal(state.calls.reads, 1)
})

test('an external invalidate drops the in-flight entry', async () => {
  const state = load({ hold: true })
  const first = state.memberstack.getCurrentMember()
  await settle()
  state.window.__tsMemberstackSharedReads.invalidate()
  const second = state.memberstack.getCurrentMember()
  await settle()

  assert.equal(state.calls.reads, 2)
  state.releaseAll()
  await Promise.all([first, second])
})
