const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  path.join(__dirname, 'build-profile-draft-identity-guard.js'),
  'utf8',
)

function createEnvironment({
  memberId,
  memberReady,
  sharedValues = new Map(),
  pendingMember = false,
  pathname = '/unrelated-page',
}) {
  class FakeStorage {
    getItem(key) {
      return sharedValues.has(String(key)) ? sharedValues.get(String(key)) : null
    }

    setItem(key, value) {
      sharedValues.set(String(key), String(value))
    }

    removeItem(key) {
      sharedValues.delete(String(key))
    }
  }

  let resolveMember
  const memberPromise = pendingMember
    ? new Promise((resolve) => {
        resolveMember = resolve
      })
    : Promise.resolve({ data: memberId ? { id: memberId } : null })

  const events = []
  const window = {
    Storage: FakeStorage,
    localStorage: new FakeStorage(),
    location: { pathname },
    $memberstackDom: {
      getCurrentMember: () => memberPromise,
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type
        this.detail = options.detail
      }
    },
    dispatchEvent(event) {
      events.push(event)
    },
    setTimeout,
  }

  if (memberReady !== undefined) window.memberReady = memberReady

  const context = vm.createContext({ console, Date, Promise, setTimeout, window })
  vm.runInContext(source, context)

  return {
    events,
    guard: window.__TS_BUILD_PROFILE_DRAFT_GUARD__,
    localStorage: window.localStorage,
    resolveMember,
    sharedValues,
    window,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('seeds the Consult type before the authored draft callback reads an empty member scope', async () => {
  const environment = createEnvironment({
    memberId: 'mem_consult',
    pathname: '/build-profile/consult',
  })

  await environment.guard.whenReady()
  const draft = JSON.parse(environment.localStorage.getItem('build_profile'))

  assert.equal(draft.type, 'consult')
  assert.equal(draft.type_id, 'ca6ff4250b7d01b49e83433432af3686')
  assert.deepEqual(draft.data, {})
  assert.equal(typeof draft.last_update, 'number')
})

test('repairs a stale Full draft on the Consult page without dropping captured fields', async () => {
  const sharedValues = new Map([
    [
      'ts:build_profile:member:mem_consult',
      JSON.stringify({
        type: 'full',
        type_id: 'a52dcf2c568fa40bf96cd67e4f8c6186',
        last_update: 100,
        data: { step_1: { city: 'Los Angeles' } },
      }),
    ],
  ])
  const environment = createEnvironment({
    memberId: 'mem_consult',
    pathname: '/build-profile/consult/',
    sharedValues,
  })

  await environment.guard.whenReady()
  const draft = JSON.parse(environment.localStorage.getItem('build_profile'))

  assert.equal(draft.type, 'consult')
  assert.equal(draft.type_id, 'ca6ff4250b7d01b49e83433432af3686')
  assert.deepEqual(draft.data, { step_1: { city: 'Los Angeles' } })
  assert.ok(draft.last_update > 100)
})

test('normalizes an early authored draft write to the fixed page type after identity resolves', async () => {
  const environment = createEnvironment({
    memberId: 'mem_consult',
    pendingMember: true,
    pathname: '/build-profile/consult',
  })

  environment.localStorage.setItem(
    'build_profile',
    JSON.stringify({ type: 'full', type_id: 'full-id', data: { step_2: { tagline: 'QA' } } }),
  )
  environment.resolveMember({ data: { id: 'mem_consult' } })
  await environment.guard.whenReady()
  const draft = JSON.parse(environment.localStorage.getItem('build_profile'))

  assert.equal(draft.type, 'consult')
  assert.equal(draft.type_id, 'ca6ff4250b7d01b49e83433432af3686')
  assert.deepEqual(draft.data, { step_2: { tagline: 'QA' } })
})

test('repairs a stale Consult draft on the Full Profile page', async () => {
  const sharedValues = new Map([
    [
      'ts:build_profile:member:mem_full',
      JSON.stringify({
        type: 'consult',
        type_id: 'ca6ff4250b7d01b49e83433432af3686',
        data: { step_1: { city: 'Austin' } },
      }),
    ],
  ])
  const environment = createEnvironment({
    memberId: 'mem_full',
    pathname: '/build-profile/full-profile',
    sharedValues,
  })

  await environment.guard.whenReady()
  const draft = JSON.parse(environment.localStorage.getItem('build_profile'))

  assert.equal(draft.type, 'full')
  assert.equal(draft.type_id, 'a52dcf2c568fa40bf96cd67e4f8c6186')
  assert.deepEqual(draft.data, { step_1: { city: 'Austin' } })
})

test('does not create or rewrite a build-profile draft outside the owned routes', async () => {
  const environment = createEnvironment({ memberId: 'mem_other' })

  await environment.guard.whenReady()

  assert.equal(environment.localStorage.getItem('build_profile'), null)
  assert.equal(environment.sharedValues.size, 0)
})

test('drops an unowned legacy draft and exposes no draft before identity resolves', async () => {
  const sharedValues = new Map([['build_profile', 'previous-member-draft']])
  const environment = createEnvironment({
    memberId: 'mem_current',
    pendingMember: true,
    sharedValues,
  })

  assert.equal(environment.localStorage.getItem('build_profile'), null)
  assert.equal(sharedValues.has('build_profile'), false)

  environment.resolveMember({ data: { id: 'mem_current' } })
  await environment.guard.whenReady()

  assert.equal(environment.guard.status, 'ready')
  assert.equal(environment.localStorage.getItem('build_profile'), null)
})

test('queues an early legacy write and flushes it only into the resolved member scope', async () => {
  const environment = createEnvironment({ memberId: 'mem_one', pendingMember: true })

  environment.localStorage.setItem('build_profile', 'safe-draft')
  assert.equal(environment.localStorage.getItem('build_profile'), null)
  assert.equal(environment.sharedValues.size, 0)

  environment.resolveMember({ data: { id: 'mem_one' } })
  await environment.guard.whenReady()

  assert.equal(environment.localStorage.getItem('build_profile'), 'safe-draft')
  assert.equal(
    environment.sharedValues.get('ts:build_profile:member:mem_one'),
    'safe-draft',
  )
  assert.equal(environment.sharedValues.has('build_profile'), false)
})

test('sequential members in one browser cannot read each other drafts', async () => {
  const sharedValues = new Map()
  const memberOne = createEnvironment({ memberId: 'mem_one', sharedValues })
  await memberOne.guard.whenReady()
  memberOne.localStorage.setItem('build_profile', 'member-one-draft')

  const memberTwo = createEnvironment({ memberId: 'mem_two', sharedValues })
  await memberTwo.guard.whenReady()

  assert.equal(memberTwo.localStorage.getItem('build_profile'), null)
  memberTwo.localStorage.setItem('build_profile', 'member-two-draft')

  assert.equal(sharedValues.get('ts:build_profile:member:mem_one'), 'member-one-draft')
  assert.equal(sharedValues.get('ts:build_profile:member:mem_two'), 'member-two-draft')
})

test('anonymous sessions cannot persist a build-profile draft', async () => {
  const environment = createEnvironment({ memberId: null })
  await environment.guard.whenReady()

  environment.localStorage.setItem('build_profile', 'anonymous-draft')

  assert.equal(environment.guard.status, 'anonymous')
  assert.equal(environment.localStorage.getItem('build_profile'), null)
  assert.equal(environment.sharedValues.size, 0)
})

test('waitForMember restores a member-scoped draft on first page load without a race', async () => {
  const sharedValues = new Map([
    ['ts:build_profile:member:mem_current', 'saved-draft'],
  ])
  const environment = createEnvironment({
    memberId: 'mem_current',
    pendingMember: true,
    sharedValues,
  })

  // A load-time read before identity resolves must not leak or restore anything.
  assert.equal(environment.localStorage.getItem('build_profile'), null)

  let restored = 'not-run'
  let seenMember = 'not-run'
  const gated = environment.guard.waitForMember((member) => {
    seenMember = member
    restored = environment.localStorage.getItem('build_profile')
    return 'callback-return'
  })

  environment.resolveMember({ data: { id: 'mem_current' } })
  const result = await gated

  assert.equal(environment.guard.status, 'ready')
  assert.equal(restored, 'saved-draft')
  assert.deepEqual(seenMember, { id: 'mem_current' })
  assert.equal(result, 'callback-return')
})

test('waits for upstream readiness then aligns every consumer to the fresh live member', async () => {
  const upstream = deferred()
  const live = deferred()
  const sharedValues = new Map([
    ['ts:build_profile:member:mem_stale', 'stale-member-draft'],
    ['ts:build_profile:member:mem_current', 'current-member-draft'],
  ])
  const calls = []
  const environment = createEnvironment({
    memberId: 'ignored-by-live-override',
    memberReady: upstream.promise,
    pendingMember: true,
    sharedValues,
  })

  environment.window.$memberstackDom.getCurrentMember = () => {
    calls.push('fresh-read')
    return live.promise
  }

  await Promise.resolve()
  assert.deepEqual(calls, [])

  let callbackMember = null
  let callbackGlobalMember = null
  let callbackDraft = null
  const gated = environment.window.waitForMember((member) => {
    callbackMember = member
    callbackGlobalMember = environment.window.MEMBER
    callbackDraft = environment.localStorage.getItem('build_profile')
  })

  upstream.resolve({ id: 'mem_stale' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['fresh-read'])

  live.resolve({ data: { id: 'mem_current', email: 'current@example.test' } })
  await gated

  assert.equal(environment.guard.memberId, 'mem_current')
  assert.deepEqual(environment.window.MEMBER, {
    id: 'mem_current',
    email: 'current@example.test',
  })
  assert.deepEqual(callbackMember, environment.window.MEMBER)
  assert.deepEqual(callbackGlobalMember, environment.window.MEMBER)
  assert.equal(callbackDraft, 'current-member-draft')
  assert.equal(sharedValues.get('ts:build_profile:member:mem_stale'), 'stale-member-draft')
  assert.equal(sharedValues.get('ts:build_profile:member:mem_current'), 'current-member-draft')
})

test('a rejected upstream readiness promise still performs the fresh live identity read', async () => {
  const upstream = deferred()
  const environment = createEnvironment({
    memberId: 'mem_current',
    memberReady: upstream.promise,
  })

  upstream.reject(new Error('stale bootstrap failed'))
  await environment.guard.whenReady()

  assert.equal(environment.guard.status, 'ready')
  assert.equal(environment.guard.memberId, 'mem_current')
  assert.deepEqual(environment.window.MEMBER, { id: 'mem_current' })
})

test('a later authored waitForMember stays gated behind identity and restores the scoped draft on first callback', async () => {
  const sharedValues = new Map([
    ['ts:build_profile:member:mem_current', 'saved-draft'],
  ])
  const environment = createEnvironment({
    memberId: 'mem_current',
    pendingMember: true,
    sharedValues,
  })

  // Authored Webflow code loads after the head guard and installs its own
  // waitForMember. That assignment must not escape the identity gate.
  let delegateThis = 'not-run'
  const authored = function (callback) {
    delegateThis = this
    return callback(environment.guard.memberId)
  }
  environment.window.waitForMember = authored

  // The page-global still resolves to the guard wrapper, not the raw authored fn.
  assert.notEqual(environment.window.waitForMember, authored)

  let restored = 'not-run'
  let seenArg = 'not-run'
  const gated = environment.window.waitForMember((member) => {
    seenArg = member
    restored = environment.localStorage.getItem('build_profile')
    return 'authored-return'
  })

  environment.resolveMember({ data: { id: 'mem_current' } })
  const result = await gated

  assert.equal(environment.guard.status, 'ready')
  assert.equal(restored, 'saved-draft')
  assert.equal(seenArg, 'mem_current')
  assert.equal(delegateThis, environment.window)
  assert.equal(result, 'authored-return')
})

test('an authored wrapper around the captured global restores the draft once without a microtask loop', async () => {
  const sharedValues = new Map([
    ['ts:build_profile:member:mem_current', 'saved-draft'],
  ])
  const environment = createEnvironment({
    memberId: 'mem_current',
    pendingMember: true,
    sharedValues,
  })

  // Authored Webflow code extends, rather than replaces, the head guard's global
  // by capturing it first and delegating through the captured reference. This
  // wrap pattern must terminate at the guard's gated default, not re-enter it.
  const orig = environment.window.waitForMember
  environment.window.waitForMember = function (callback) {
    return orig(callback)
  }

  let restored = 'not-run'
  let seenMember = 'not-run'
  let callbackCalls = 0
  const gated = environment.window.waitForMember((member) => {
    callbackCalls += 1
    seenMember = member
    restored = environment.localStorage.getItem('build_profile')
    return 'wrapped-return'
  })

  environment.resolveMember({ data: { id: 'mem_current' } })
  const result = await gated

  // A recursive delegate would keep scheduling microtasks and never settle, so
  // draining the queue here proves termination as well as single invocation.
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(environment.guard.status, 'ready')
  assert.equal(callbackCalls, 1)
  assert.equal(restored, 'saved-draft')
  assert.deepEqual(seenMember, { id: 'mem_current' })
  assert.equal(result, 'wrapped-return')
})

test('a doubly-wrapped authored waitForMember still resolves once through the backward chain', async () => {
  const environment = createEnvironment({ memberId: 'mem_current', pendingMember: true })

  const origOne = environment.window.waitForMember
  environment.window.waitForMember = function (callback) {
    return origOne(callback)
  }
  const origTwo = environment.window.waitForMember
  environment.window.waitForMember = function (callback) {
    return origTwo(callback)
  }

  let callbackCalls = 0
  const gated = environment.window.waitForMember((member) => {
    callbackCalls += 1
    return member
  })

  environment.resolveMember({ data: { id: 'mem_current' } })
  const result = await gated
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(callbackCalls, 1)
  assert.deepEqual(result, { id: 'mem_current' })
})

test('a later authored waitForMember still completes anonymous sessions', async () => {
  const environment = createEnvironment({ memberId: null, pendingMember: true })

  environment.window.waitForMember = function (callback) {
    return callback(environment.guard.memberId)
  }

  let seenArg = 'not-run'
  const gated = environment.window.waitForMember((member) => {
    seenArg = member
    return 'anon-return'
  })

  environment.resolveMember({ data: null })
  const result = await gated

  assert.equal(environment.guard.status, 'anonymous')
  assert.equal(seenArg, null)
  assert.equal(result, 'anon-return')
})

test('waitForMember completes anonymous sessions with a null member and no draft', async () => {
  const environment = createEnvironment({ memberId: null, pendingMember: true })

  let seenMember = 'not-run'
  let restored = 'not-run'
  const gated = environment.guard.waitForMember((member) => {
    seenMember = member
    restored = environment.localStorage.getItem('build_profile')
  })

  environment.resolveMember({ data: null })
  await gated

  assert.equal(environment.guard.status, 'anonymous')
  assert.equal(seenMember, null)
  assert.equal(restored, null)
})
