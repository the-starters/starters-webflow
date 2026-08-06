const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./complete-profile-redirect.js'),
  'utf8',
)
const routeGuardSource = fs.readFileSync(
  require.resolve('./route-guard.js'),
  'utf8',
)

const COMPLETE_PROFILE = '/complete-profile'
const DASHBOARD = '/brand-dashboard'
const STARTER_DASHBOARD = '/starter-dashboard'
const QUIZ = '/quiz'
const QUIZ_RESULTS = '/quiz-results'
const DONE_FIELD = 'completed-brand-profile'
const QUIZ_FIELD = 'starter-quiz'

// The Xano surface the paid-Brand branch reads since 2026-08-06, and the
// same-tab marker that lets it skip the read entirely.
const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const BRAND_STATUS_URL =
  XANO + '/api:KZf7nFnk/starters_onboarding/get_brand_profile_status'
const MARKER_KEY = 'thestarters:v3-brand-profile-completed'

// get_brand_profile_status bodies. Brands that predate the funnel are
// grandfathered done, so only a new signup reads not-done.
const BRAND_DONE = { has_record: true, brand_profile_done: true }
const BRAND_NOT_DONE = { has_record: true, brand_profile_done: false }
const BRAND_NO_RECORD = { has_record: false, brand_profile_done: false }

function plan(planId) {
  return { active: true, planId }
}

const TALENT = {
  id: 'm-talent',
  planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
}
const BRAND_FREE = {
  id: 'm-brand-free',
  planConnections: [plan('pln_free-plan-f6kn0dxz')],
}
// A free Brand who has already taken the quiz, so the guard's brandFreeHome()
// resolves to /quiz-results rather than /quiz.
const BRAND_FREE_DONE = {
  id: 'm-brand-free-done',
  planConnections: [plan('pln_free-plan-f6kn0dxz')],
  customFields: { [QUIZ_FIELD]: 'answers-json' },
}
const UNMAPPED = { id: 'm-unknown', planConnections: [plan('pln_unknown')] }
const CONFLICTED = {
  id: 'm-conflict',
  planConnections: [
    plan('pln_dorxata-test-free-plan-dvcg0k8o'),
    plan('pln_new-paid-plan-463h04ph'),
  ],
}

// The one role this module acts on. `doneValue` writes the legacy
// `completed-brand-profile` member field, which this module no longer reads — it
// is kept so the tests can prove a stray value on the member object cannot
// influence any branch.
function brandPaid(doneValue) {
  const member = {
    id: 'm-brand-paid',
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
    customFields: {},
  }
  if (doneValue !== undefined) member.customFields[DONE_FIELD] = doneValue
  return member
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * A deterministic clock driving both `Date.now()` and the module's timers, so the
 * 8s Memberstack wait is testable without waiting for it. Same shape as the
 * sibling v3 test harnesses.
 */
function makeClock() {
  let now = 1700000000000
  let seq = 0
  const timers = new Map()

  return {
    now: () => now,
    pending: () => timers.size,
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { fn, at: now + (ms || 0), repeat: null })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    setInterval(fn, ms) {
      const id = ++seq
      timers.set(id, { fn, at: now + (ms || 0), repeat: ms || 1 })
      return id
    },
    clearInterval(id) {
      timers.delete(id)
    },
    async advance(ms) {
      const target = now + ms
      for (let guard = 0; guard < 5000; guard += 1) {
        let dueId = null
        let due = null
        for (const [id, timer] of timers) {
          if (timer.at > target) continue
          if (!due || timer.at < due.at) {
            due = timer
            dueId = id
          }
        }
        if (!due) break
        now = Math.max(now, due.at)
        if (due.repeat === null) timers.delete(dueId)
        else due.at = now + due.repeat
        due.fn()
        await flush()
      }
      now = target
      await flush()
    },
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

// A 200 whose body is not JSON. The module's `.json().catch(() => null)` turns
// this into a null payload, which must read as inconclusive rather than as done.
function malformedJsonResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
  }
}

function loadModule(options = {}) {
  const clock = makeClock()
  const hostname = options.hostname || 'the-starters-3-0.webflow.io'
  const pathname = Object.prototype.hasOwnProperty.call(options, 'pathname')
    ? options.pathname
    : COMPLETE_PROFILE
  const lookups = []
  const logs = { info: [], warn: [], error: [] }

  const location = {
    hostname,
    origin: 'https://' + hostname,
    pathname,
    search: '',
    replace(value) {
      location.replaced = value
    },
  }

  // A recording tripwire rather than an absent global. An undefined `fetch`
  // proves only that the harness never defined one; a fetch that records its
  // arguments and then throws proves the module actually abstained, and fails
  // loudly and traceably the day someone adds a request to a branch that is
  // still meant to be free (free Brand, Talent, and the marker fast path).
  //
  // The paid-Brand branch DOES read Xano since 2026-08-06, so a test that wants
  // that branch to reach an answer passes `xano: {...}` and gets a recording stub
  // that answers the two known URLs and tripwires everything else.
  const fetches = []
  function tripwireFetch(url, init) {
    fetches.push({ url: String(url), init })
    throw new Error(
      'complete-profile-redirect must make no network request (fetch ' +
        url +
        ')',
    )
  }

  const xano = options.xano || {}
  async function xanoFetch(url, init) {
    fetches.push({ url: String(url), init })

    if (String(url).indexOf(TRADE_URL) === 0) {
      if (xano.tradeRejects) throw new Error('trade network failure')
      if (xano.tradeStatus) {
        return jsonResponse(null, { ok: false, status: xano.tradeStatus })
      }
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(xano, 'tradeBody')
          ? xano.tradeBody
          : 'xano-token-abc',
      )
    }

    if (String(url) === BRAND_STATUS_URL) {
      if (xano.neverSettles) return new Promise(() => {})
      if (xano.rejects) throw new Error('status network failure')
      if (xano.status) {
        return jsonResponse(null, { ok: false, status: xano.status })
      }
      if (xano.malformedJson) return malformedJsonResponse()
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(xano, 'statusBody')
          ? xano.statusBody
          : BRAND_DONE,
      )
    }

    return tripwireFetch(url, init)
  }
  const activeFetch = options.xano ? xanoFetch : tripwireFetch

  // The marker store. `storageFailure: 'get'` reproduces Safari private mode,
  // where reading is what throws; `'missing'` removes the property entirely.
  const storage = new Map()
  if (options.marker !== undefined) storage.set(MARKER_KEY, options.marker)
  const sessionStorage = {
    getItem(key) {
      if (options.storageFailure === 'get') {
        throw new DOMException('', 'SecurityError')
      }
      return storage.has(key) ? storage.get(key) : null
    },
    setItem(key, value) {
      storage.set(key, String(value))
    },
    removeItem(key) {
      storage.delete(key)
    },
  }

  const aborted = []

  const window = {
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.name = name
        this.detail = init && init.detail
      }
    },
    URL,
    URLSearchParams,
    dispatchEvent() {},
    location,
    fetch: activeFetch,
    sessionStorage: options.storageFailure === 'missing' ? undefined : sessionStorage,
    AbortController: class {
      constructor() {
        this.signal = { aborted: false }
      }
      abort() {
        this.signal.aborted = true
        aborted.push(this)
      }
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  }
  if (options.debug) window.STARTERS_DEBUG = true

  function memberstackFor(member) {
    return {
      getCurrentMember: async () => {
        lookups.push(member)
        if (options.memberLookupRejects) {
          throw new Error('member lookup failure')
        }
        if (options.memberLookupMalformed) return null
        return { data: member }
      },
      getMemberCookie: async () => {
        if (options.cookieRejects) throw new Error('memberstack failure')
        return options.loggedOutCookie ? null : 'ms-jwt'
      },
    }
  }

  if (options.delayedMember) {
    window.setTimeout(() => {
      window.$memberstackDom = memberstackFor(options.delayedMember)
    }, options.memberstackDelayMs || 25)
  } else if (!options.memberstackMissing) {
    window.$memberstackDom = memberstackFor(
      Object.prototype.hasOwnProperty.call(options, 'member')
        ? options.member
        : brandPaid(),
    )
  }

  const guardAttributes = {}
  const document = {
    documentElement: {
      setAttribute(name, value) {
        guardAttributes[name] = value
      },
    },
    querySelectorAll() {
      return []
    },
  }

  class FakeDate extends Date {
    static now() {
      return clock.now()
    }
  }

  const context = vm.createContext({
    window,
    document,
    Date: FakeDate,
    URL,
    URLSearchParams,
    // The same tripwire as a bare global, so an unqualified `fetch(...)` is
    // recorded too rather than dying as a ReferenceError with no trace of who
    // called it.
    fetch: tripwireFetch,
    CustomEvent: window.CustomEvent,
    console: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
    },
  })

  // The module reads the role from the sitewide guard's exported contract, so the
  // real guard source is loaded first — a hand-written stub would drift from the
  // plan table it is meant to mirror. Skipping the guard entirely
  // (`roleContractMissing`) reproduces a bad install order.
  //
  // On the two scoped paths the guard boots for real, exactly as it does in
  // production, because /complete-profile is deliberately absent from all three
  // guard tables and a live guard is therefore a no-op there — the test below
  // asserts precisely that. Off-scope paths are a different story: several of
  // them (`/brand-dashboard`, `/`) ARE claimed by the guard, so a live boot would
  // spend its own `getCurrentMember()` call and issue its own redirect, masking
  // what this module decided. Those runs get an unguarded path while the guard
  // initialises; the guard's own co-located behaviour is v3/route-guard.test.js's
  // job to assert.
  const guardBootsOnThisPath =
    pathname === '/complete-profile' || pathname === '/complete-profile/'
  if (!options.roleContractMissing) {
    if (!guardBootsOnThisPath) location.pathname = '/harness-neutral-unguarded-path'
    vm.runInContext(routeGuardSource, context)
    location.pathname = pathname
  }
  // A half-contract: the guard is present and can name a role but cannot name its
  // home. Reproduces an older guard build being cached in front of this module.
  if (options.roleHomeMissing && window.StartersV3RouteGuard) {
    delete window.StartersV3RouteGuard.roleHome
  }
  // A contract that answers the role question and then draws a blank on the home
  // question — a `roleHome` present but returning nothing for a role the same
  // object just named. Unreachable with today's guard (ROLE_DEFAULTS covers all
  // three roles) but the contract is a foreign object at runtime, so the module's
  // guard against it needs a way in.
  if (options.roleHomeReturnsNull && window.StartersV3RouteGuard) {
    window.StartersV3RouteGuard.roleHome = () => null
  }
  vm.runInContext(source, context)

  return {
    api: window.StartersCompleteProfileRedirect,
    aborted,
    clock,
    fetches,
    guard: window.StartersV3RouteGuard,
    guardAttributes,
    location,
    logs,
    lookups,
    storage,
    window,
  }
}

const urlsOf = (calls) => calls.map((call) => call.url)
const callsTo = (calls, url) => calls.filter((call) => call.url === url)

/**
 * The destination the real route-guard contract names for a member, read from one
 * throwaway load of the guard source.
 *
 * Every navigation assertion for the free-Brand and Talent branches keys on this
 * rather than on a path literal, because the point of those branches is contract
 * reuse: the module must produce whatever `roleHome()` produces, so a guard that
 * moves a role home has to move these tests with it instead of turning them red.
 * The literals are pinned to the contract in exactly one place — the test
 * immediately below — which is the only place a wrong expectation should be able
 * to hide.
 */
const CONTRACT = loadModule({ pathname: '/other' }).guard
function contractHome(member) {
  return CONTRACT.roleHome(member)
}

// --- Pure helpers -------------------------------------------------------------

test('the guard contract names the destinations the rest of this file expects', () => {
  // The one place a path literal and the contract meet. Everything downstream
  // asserts against contractHome(), so if the guard's role homes ever change this
  // single test is what fails and says so.
  assert.equal(contractHome(TALENT), STARTER_DASHBOARD)
  assert.equal(contractHome(BRAND_FREE), QUIZ)
  assert.equal(contractHome(BRAND_FREE_DONE), QUIZ_RESULTS)
  assert.equal(contractHome(brandPaid('yes')), DASHBOARD)
  // No home for a member the contract cannot place, which is why the module
  // treats a null role as "stay" rather than as a destination.
  assert.equal(contractHome(UNMAPPED), null)
  assert.equal(contractHome(CONFLICTED), null)
})

test('exactly both slash forms of /complete-profile are in scope', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isCompleteProfilePath('/complete-profile'), true)
  assert.equal(api.isCompleteProfilePath('/complete-profile/'), true)
  // Not in scope: a nested step, a lookalike sibling page, the destination, and
  // the site root.
  assert.equal(api.isCompleteProfilePath('/complete-profile/step-2'), false)
  assert.equal(api.isCompleteProfilePath('/complete-profile-brand'), false)
  assert.equal(api.isCompleteProfilePath('/complete'), false)
  assert.equal(api.isCompleteProfilePath(DASHBOARD), false)
  assert.equal(api.isCompleteProfilePath('/'), false)
})

test('no redirect destination is itself a scoped page (no loop)', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isCompleteProfilePath(api.dashboardPath), false)
  assert.equal(api.dashboardPath, DASHBOARD)
  // Every destination the role branches can actually produce, enumerated from the
  // guard contract rather than from this test's own idea of them — a new role home
  // that happened to be this page would fail here without anyone remembering to
  // add it to a list.
  for (const member of [TALENT, BRAND_FREE, BRAND_FREE_DONE]) {
    const destination = contractHome(member)
    assert.ok(destination, member.id)
    assert.equal(api.isCompleteProfilePath(destination), false, destination)
  }
})

test('host gate covers production, staging, local, and dev tunnels but not lookalikes', () => {
  const { api } = loadModule({ pathname: '/other' })
  for (const host of [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
    'localhost',
    '127.0.0.1',
    'some-generated-name.trycloudflare.com',
  ]) {
    assert.equal(api.allowedHost(host), true, host)
  }
  for (const host of [
    'notwebflow.io',
    'evil-trycloudflare.com',
    'thestarters.com.attacker.example',
    'attacker.example',
    '',
  ]) {
    assert.equal(api.allowedHost(host), false, host)
  }
})

test('the completion marker is read with the same semantics as the quiz marker', () => {
  const { api, guard } = loadModule({ pathname: '/other' })
  assert.equal(api.markerKey, MARKER_KEY)

  // Set: any trimmed non-empty string.
  for (const marker of ['1', 'true', 'completed', ' x ']) {
    const probe = loadModule({ pathname: '/other', marker })
    assert.equal(probe.api.completionMarkerSet(), true, JSON.stringify(marker))
  }
  // Not set: absent, empty, whitespace-only.
  for (const marker of [undefined, '', '   ', '\n\t ']) {
    const probe = loadModule({ pathname: '/other', marker })
    assert.equal(probe.api.completionMarkerSet(), false, JSON.stringify(marker))
  }
  // Storage that throws on read, and storage that is not there at all.
  assert.equal(
    loadModule({ pathname: '/other', storageFailure: 'get', marker: '1' }).api.completionMarkerSet(),
    false,
  )
  assert.equal(
    loadModule({ pathname: '/other', storageFailure: 'missing' }).api.completionMarkerSet(),
    false,
  )

  // The predicate is the same rule as the guard's `starter-quiz` read; if that
  // contract ever changes shape, this pins the copy to the original.
  const quizShaped = { customFields: { 'starter-quiz': '   ' } }
  assert.equal(guard.hasCompletedQuiz(quizShaped), false)
  assert.equal(
    guard.hasCompletedQuiz({ customFields: { 'starter-quiz': 'x' } }),
    true,
  )
  assert.equal(api.markerKey, MARKER_KEY)
})

test('the marker key is exactly the one the account controller writes', () => {
  const controllerSource = fs.readFileSync(
    require.resolve('./brand-account-controller.js'),
    'utf8',
  )
  const { api } = loadModule({ pathname: '/other' })

  assert.equal(api.markerKey, MARKER_KEY)
  // Writer and reader are separate self-contained files by design, so the shared
  // key is pinned here rather than trusted.
  assert.ok(
    controllerSource.includes("'" + MARKER_KEY + "'"),
    'brand-account-controller.js must write the key this module reads',
  )
})

test('the status body maps to one of three answers, and only one navigates', () => {
  const { api } = loadModule({ pathname: '/other' })

  assert.equal(api.brandProfileStateFrom(BRAND_DONE), 'done')
  assert.equal(api.brandProfileStateFrom(BRAND_NOT_DONE), 'not-done')
  // No brands_v3 row yet: the webhook has not mirrored this member, so the form
  // is still the right place for them.
  assert.equal(api.brandProfileStateFrom(BRAND_NO_RECORD), 'unknown')

  // Nothing else may read as done, because done is the only answer that takes a
  // member off a page they may still need.
  for (const payload of [
    null,
    undefined,
    {},
    'nope',
    42,
    { brand_profile_done: true },
    { has_record: 'true', brand_profile_done: true },
    { has_record: true, brand_profile_done: 'true' },
    { has_record: true, brand_profile_done: 1 },
    { has_record: true },
  ]) {
    assert.notEqual(
      api.brandProfileStateFrom(payload),
      'done',
      JSON.stringify(payload),
    )
  }
})

test('the legacy member field is no longer part of the decision', () => {
  // The switch to Xano (2026-08-06) is the whole point of the same-signal rule,
  // so the old field must be gone from the surface as well as from the branch.
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.hasCompletedBrandProfile, undefined)
  assert.equal(api.doneField, undefined)
  assert.ok(
    !source.includes("customFields[DONE_FIELD]"),
    'the member-object completion read must be gone',
  )
})

test('the route guard deliberately does not claim this page', () => {
  // The whole premise of this module: Memberstack gated content owns access to
  // /complete-profile, so the guard has no table entry for it and cannot be the
  // thing that redirects a completed member.
  const { guard, guardAttributes } = loadModule()
  assert.equal(guard.pageRolesFor('/complete-profile'), null)
  assert.equal(guard.pageRolesFor('/complete-profile/'), null)
  assert.equal(guard.isGuardedPath('/complete-profile'), false)
  assert.equal(guard.isMemberBouncePage('/complete-profile'), false)
  assert.equal(guard.isRoleBouncePage('/complete-profile'), false)
  // A live guard booting on this path stamps nothing and redirects nobody.
  assert.deepEqual(guardAttributes, {})
})

// --- Runtime behaviour --------------------------------------------------------

test('a paid Brand with the completion marker goes to the brand dashboard, free', async () => {
  const { location, fetches, logs } = loadModule({
    marker: '1',
    member: brandPaid(),
    // Deliberately the staying body: if the marker were ignored, this run would
    // stay on the form instead of forwarding.
    xano: { statusBody: BRAND_NOT_DONE },
  })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.deepEqual(fetches, [], 'the marker path must cost no network call')
  assert.ok(logs.info.some((line) => line.includes('marker is set')))
})

test('a paid Brand whose Xano status is done goes to the brand dashboard', async () => {
  const { location, fetches } = loadModule({
    member: brandPaid(),
    xano: { statusBody: BRAND_DONE },
  })
  await flush()
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)

  // The read shape: one token trade, then one no-input bearer GET.
  const urls = urlsOf(fetches)
  assert.equal(urls.length, 2)
  assert.ok(urls[0].startsWith(TRADE_URL + '?token='), urls[0])
  assert.equal(urls[1], BRAND_STATUS_URL)
  const read = callsTo(fetches, BRAND_STATUS_URL)[0]
  assert.equal(read.init.headers.Authorization, 'Bearer xano-token-abc')
  assert.equal(read.init.method, undefined)
  assert.equal(read.init.body, undefined)
})

test('runs on both slash forms of the page', async () => {
  for (const pathname of ['/complete-profile', '/complete-profile/']) {
    const { location } = loadModule({ pathname, marker: '1', member: brandPaid() })
    await flush()
    await flush()
    assert.equal(location.replaced, DASHBOARD, pathname)
  }
})

test('a paid Brand whose Xano status is not done stays on the form', async () => {
  const { location, fetches, logs } = loadModule({
    member: brandPaid(),
    xano: { statusBody: BRAND_NOT_DONE },
  })
  await flush()
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetches, BRAND_STATUS_URL).length, 1)
  assert.ok(logs.info.some((line) => line.includes('not-done')))
})

test('a stale member field cannot move a paid Brand in either direction', async () => {
  // The same-signal rule from the other side: the module reads Xano, so a
  // `completed-brand-profile` value the webhook has not mirrored yet must not
  // forward the member, and its absence must not hold back a member Xano calls
  // done.
  const staleDone = loadModule({
    member: brandPaid('true'),
    xano: { statusBody: BRAND_NOT_DONE },
  })
  const staleMissing = loadModule({
    member: brandPaid(''),
    xano: { statusBody: BRAND_DONE },
  })
  await flush()
  await flush()
  await flush()
  assert.equal(staleDone.location.replaced, undefined)
  assert.equal(staleMissing.location.replaced, DASHBOARD)
})

test('a paid Brand with no brands_v3 record yet stays on the form', async () => {
  const { location } = loadModule({
    member: brandPaid('yes'),
    xano: { statusBody: BRAND_NO_RECORD },
  })
  await flush()
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
})

test('every paid-Brand read failure leaves the page exactly as authored', async () => {
  // Fail-open on this page means STAYING, because staying is the authored state.
  for (const xano of [
    { status: 401 },
    { status: 500 },
    { rejects: true },
    { malformedJson: true },
    { statusBody: {} },
    { statusBody: 'nope' },
    { statusBody: null },
    { tradeStatus: 401 },
    { tradeRejects: true },
    { tradeBody: { nothing: true } },
  ]) {
    const { location } = loadModule({ member: brandPaid(), xano })
    await flush()
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(xano))
  }

  // No Memberstack cookie: the trade is never even attempted.
  const loggedOutOfXano = loadModule({
    member: brandPaid(),
    loggedOutCookie: true,
    xano: { statusBody: BRAND_DONE },
  })
  await flush()
  await flush()
  await flush()
  assert.equal(loggedOutOfXano.location.replaced, undefined)
  assert.deepEqual(loggedOutOfXano.fetches, [])

  // A cookie lookup that throws, and a marker read that throws: both are still
  // just "stay", and the second one costs one read rather than a wrong answer.
  const cookieThrows = loadModule({
    member: brandPaid(),
    cookieRejects: true,
    xano: { statusBody: BRAND_DONE },
  })
  const markerThrows = loadModule({
    member: brandPaid(),
    storageFailure: 'get',
    marker: '1',
    xano: { statusBody: BRAND_NOT_DONE },
  })
  await flush()
  await flush()
  await flush()
  assert.equal(cookieThrows.location.replaced, undefined)
  assert.equal(markerThrows.location.replaced, undefined)
  assert.equal(callsTo(markerThrows.fetches, BRAND_STATUS_URL).length, 1)
})

test('a hung paid-Brand read is abandoned at the 4s budget and the page stays', async () => {
  const { location, clock, aborted, logs, api } = loadModule({
    member: brandPaid(),
    xano: { neverSettles: true },
  })

  await flush()
  await flush()
  assert.equal(location.replaced, undefined, 'nothing has navigated yet')

  await clock.advance(api.statusBudgetMs)
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(aborted.length, 1, 'the in-flight request is aborted')
  assert.ok(logs.warn.some((line) => line.includes('budget')))
  // And the budget timer is the only one that existed, so nothing is left behind.
  assert.equal(clock.pending(), 0)
})

test('a slow but in-budget paid-Brand read still forwards a finished member', async () => {
  const { location, clock } = loadModule({
    member: brandPaid(),
    xano: { statusBody: BRAND_DONE },
  })

  await flush()
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  // The budget timer is cleared once the answer lands, so nothing fires later.
  await clock.advance(10000)
  assert.equal(location.replaced, DASHBOARD)
  assert.equal(clock.pending(), 0)
})

test('does not run on an unapproved hostname', async () => {
  const { location, lookups } = loadModule({
    hostname: 'attacker.example',
    member: brandPaid('yes'),
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(lookups, [])
})

test('does not run on a page outside /complete-profile', async () => {
  for (const pathname of [DASHBOARD, '/complete-profile/step-2', '/']) {
    const { location, lookups } = loadModule({
      pathname,
      member: brandPaid('yes'),
    })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, pathname)
    assert.deepEqual(lookups, [], pathname)
  }
})

// --- Role scope ---------------------------------------------------------------

test('a Talent member goes straight to the Starter dashboard, no /login hop', async () => {
  const { location } = loadModule({ member: TALENT })
  await flush()
  await flush()
  assert.equal(location.replaced, contractHome(TALENT))
  // The point of the branch: the member is never sent to the login form to be
  // bounced from there.
  assert.notEqual(location.replaced, '/login')
})

test('a free Brand who has not taken the quiz goes to the quiz', async () => {
  const { location } = loadModule({ member: BRAND_FREE })
  await flush()
  await flush()
  assert.equal(location.replaced, contractHome(BRAND_FREE))
  assert.notEqual(location.replaced, '/login')
})

test('a free Brand who has taken the quiz goes to the quiz results', async () => {
  const { location } = loadModule({ member: BRAND_FREE_DONE })
  await flush()
  await flush()
  assert.equal(location.replaced, contractHome(BRAND_FREE_DONE))
  assert.notEqual(location.replaced, '/login')
})

test('the free-Brand and Talent destinations are the guard contract, not a copy', async () => {
  // The whole reason this module borrows roleHome() instead of reimplementing
  // ROLE_DEFAULTS and the quiz-funnel rule: if the guard ever moves a role home,
  // this page must follow without an edit here. Asserted against the guard object
  // from the same load, so not even a stale CONTRACT could mask a divergence.
  for (const member of [TALENT, BRAND_FREE, BRAND_FREE_DONE]) {
    const { api, guard, location } = loadModule({ pathname: '/other', member })
    const expected = guard.roleHome(member)
    assert.ok(expected, member.id)
    assert.equal(api.roleHome(member), expected, member.id)
    assert.equal(await api.completeProfileDestination(), expected, member.id)
    assert.equal(location.replaced, undefined, member.id)
  }
})

test('the paid-Brand completion signals are ignored for the other two roles', async () => {
  // A stray `completed-brand-profile` value or a stray completion marker is
  // meaningless on a Talent or free-Brand member — both are paid-Brand signals —
  // and must not divert them to the Brand dashboard.
  for (const member of [TALENT, BRAND_FREE, BRAND_FREE_DONE]) {
    const withField = Object.assign({}, member, {
      customFields: Object.assign({}, member.customFields, {
        [DONE_FIELD]: 'yes',
      }),
    })
    const { location } = loadModule({ marker: '1', member: withField })
    await flush()
    await flush()
    // Still the contract's answer for the member, and specifically not the paid
    // Brand's dashboard.
    assert.equal(location.replaced, contractHome(withField), member.id)
    assert.notEqual(location.replaced, DASHBOARD, member.id)
  }
})

test('an unmapped and a cross-role conflicted member are left untouched', async () => {
  for (const member of [UNMAPPED, CONFLICTED]) {
    // The completion field is set on both, so neither the role branch nor the
    // completion check can be what keeps them on the page — only the deliberate
    // "no mapped role" fail-open.
    const withField = Object.assign({}, member, {
      customFields: { [DONE_FIELD]: 'yes' },
    })
    const { location } = loadModule({ member: withField })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, member.id)
  }
})

test('the wrong-role decisions still cost one member lookup and no network call', async () => {
  // The guard contract answers for these two roles, so nothing about the Xano
  // switch is allowed to make them spend a round trip.
  for (const member of [TALENT, BRAND_FREE, BRAND_FREE_DONE]) {
    const { fetches, lookups } = loadModule({ member })
    await flush()
    await flush()
    assert.equal(lookups.length, 1, member.id)
    // The harness DOES define `fetch` — a recording tripwire that throws — so an
    // empty list is the module abstaining, not the global being absent.
    assert.deepEqual(fetches, [], member.id)
  }

  // A marked paid Brand is free too; only an unmarked one pays, and then for
  // exactly two requests.
  const marked = loadModule({ marker: '1', member: brandPaid() })
  await flush()
  await flush()
  assert.equal(marked.lookups.length, 1)
  assert.deepEqual(marked.fetches, [])

  const unmarked = loadModule({ member: brandPaid(), xano: { statusBody: BRAND_DONE } })
  await flush()
  await flush()
  await flush()
  assert.equal(unmarked.lookups.length, 1)
  assert.equal(unmarked.fetches.length, 2)
})

test('a logged-out visitor is left alone; Memberstack gating owns that case', async () => {
  for (const member of [null, {}, { id: '' }]) {
    const { location } = loadModule({ member })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(member))
  }
})

test('a missing route-guard role contract stays put instead of guessing', async () => {
  // Every role, not just the paid Brand: without the contract this module has no
  // opinion about anybody.
  for (const member of [brandPaid('yes'), TALENT, BRAND_FREE_DONE]) {
    const { location, logs } = loadModule({
      roleContractMissing: true,
      member,
    })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, member.id)
    assert.ok(
      logs.warn.some((line) => line.includes('role contract unavailable')),
      'expected a staging warning about the missing contract',
    )
  }
})

test('a guard that cannot name role homes counts as no contract at all', async () => {
  // Half a contract is not a contract: identifying a Talent member and then having
  // nowhere to send them must fail open, not throw and not guess /starter-dashboard
  // from a local copy.
  const { location, logs } = loadModule({
    roleHomeMissing: true,
    member: TALENT,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.ok(logs.warn.some((line) => line.includes('role contract unavailable')))

  // The paid-Brand branch is disabled by the same rule, so the module cannot act
  // on a partially loaded guard in either direction.
  const paid = loadModule({ roleHomeMissing: true, member: brandPaid('yes') })
  await flush()
  await flush()
  assert.equal(paid.location.replaced, undefined)
})

test('a contract that names a role but no home for it leaves the page alone', async () => {
  // Not reachable with today's guard — ROLE_DEFAULTS covers all three roles, and
  // the test above pins that — but `roleHome` is a foreign object's method at
  // runtime and this module is also a documented staging probe, so the arm is kept
  // and exercised rather than trusted. The alternative is location.replace(null).
  const { location, logs } = loadModule({
    roleHomeReturnsNull: true,
    member: TALENT,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.ok(
    logs.warn.some((line) => line.includes('has no home in the route guard')),
    'expected a staging warning naming the role with no home',
  )
  // The exported probe answers the same way instead of throwing.
  const probe = loadModule({
    pathname: '/other',
    roleHomeReturnsNull: true,
    member: TALENT,
  })
  assert.equal(probe.api.roleHome(TALENT), null)
  assert.equal(await probe.api.completeProfileDestination(), null)

  // And production stays silent about it, like every other fail-open path.
  const production = loadModule({
    hostname: 'www.thestarters.com',
    roleHomeReturnsNull: true,
    member: TALENT,
  })
  await flush()
  await flush()
  assert.equal(production.location.replaced, undefined)
  assert.deepEqual(production.logs.warn, [])
  assert.deepEqual(production.logs.info, [])
})

test('waits for a late Memberstack before deciding', async () => {
  const { location, clock } = loadModule({
    marker: '1',
    delayedMember: brandPaid(),
    memberstackDelayMs: 300,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  await clock.advance(400)
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

test('gives up on a Memberstack that never arrives and renders the page', async () => {
  const { location, clock, lookups, logs } = loadModule({
    memberstackMissing: true,
  })
  await clock.advance(8000)
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(lookups, [])
  assert.ok(logs.warn.some((line) => line.includes('never became available')))
})

// --- Fail-open paths ----------------------------------------------------------

test('a member lookup that rejects leaves the page alone', async () => {
  const { location, logs } = loadModule({ memberLookupRejects: true })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.ok(logs.warn.some((line) => line.includes('member lookup failed')))
})

test('a malformed member response leaves the page alone', async () => {
  const { location } = loadModule({ memberLookupMalformed: true })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
})

test('the marked decision costs exactly one member lookup and no network call', async () => {
  const { fetches, location, lookups, window } = loadModule({
    marker: '1',
    member: brandPaid(),
  })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.equal(lookups.length, 1)
  // The tripwire is installed, both on the window and as a bare global, and
  // recorded nothing — which is what "no network" has to mean here. Asserting the
  // global is merely undefined would only have proved the harness never made one.
  assert.equal(typeof window.fetch, 'function')
  assert.deepEqual(fetches, [])
})

test('the fetch tripwire really does catch a request', () => {
  // Guards the guard: if this ever stopped recording, the "no network" assertions
  // above would pass vacuously again, which is the exact failure they replaced.
  const { fetches, window } = loadModule({ pathname: '/other' })
  assert.throws(() =>
    window.fetch('https://example.test/x', { method: 'POST' }),
  )
  assert.equal(fetches.length, 1)
  assert.equal(fetches[0].url, 'https://example.test/x')
  assert.equal(fetches[0].init.method, 'POST')
})

test('the decision half can be called by hand without navigating', async () => {
  const { api, location } = loadModule({
    pathname: '/other',
    marker: '1',
    member: brandPaid(),
  })
  assert.equal(await api.completeProfileDestination(), DASHBOARD)
  assert.equal(location.replaced, undefined)

  // Both Xano answers are reachable by hand too, and neither navigates.
  const done = loadModule({
    pathname: '/other',
    member: brandPaid(),
    xano: { statusBody: BRAND_DONE },
  })
  assert.equal(await done.api.completeProfileDestination(), DASHBOARD)
  assert.equal(done.location.replaced, undefined)

  const notDone = loadModule({
    pathname: '/other',
    member: brandPaid(),
    xano: { statusBody: BRAND_NOT_DONE },
  })
  assert.equal(await notDone.api.completeProfileDestination(), null)
  // And the status read itself is callable in isolation on staging.
  const probe = loadModule({
    pathname: '/other',
    member: brandPaid(),
    xano: { statusBody: BRAND_NOT_DONE },
  })
  assert.equal(await probe.api.brandProfileState(probe.window.$memberstackDom), 'not-done')

  // The role branches are callable the same way, and still do not navigate. The
  // expected answer is the contract's, including the null for a member it cannot
  // place.
  for (const member of [
    TALENT,
    BRAND_FREE,
    BRAND_FREE_DONE,
    UNMAPPED,
    CONFLICTED,
  ]) {
    const probe = loadModule({ pathname: '/other', member })
    assert.equal(
      await probe.api.completeProfileDestination(),
      contractHome(member),
      member.id,
    )
    assert.equal(probe.location.replaced, undefined, member.id)
  }
})

test('the exported role helpers answer without navigating', async () => {
  const { api, location } = loadModule({ pathname: '/other', member: TALENT })
  assert.equal(api.memberRole(TALENT), 'talent')
  assert.equal(api.memberRole(BRAND_FREE), 'brand-free')
  assert.equal(api.memberRole(brandPaid('yes')), 'brand-paid')
  assert.equal(api.memberRole(UNMAPPED), null)
  assert.equal(api.memberRole(CONFLICTED), null)
  assert.equal(api.roleHome(UNMAPPED), null)
  assert.equal(location.replaced, undefined)
})

test('no timer outlives the decision', async () => {
  const marked = loadModule({ marker: '1', member: brandPaid() })
  await flush()
  await flush()
  assert.equal(marked.clock.pending(), 0)

  // Including the status budget on the branch that actually starts one.
  const read = loadModule({ member: brandPaid(), xano: { statusBody: BRAND_DONE } })
  await flush()
  await flush()
  await flush()
  assert.equal(read.clock.pending(), 0)
})

// --- Diagnostics --------------------------------------------------------------

test('diagnostics are staging-only unless STARTERS_DEBUG opts in', () => {
  const staging = loadModule({ pathname: '/other' })
  assert.equal(staging.api.diagnosticsEnabled(), true)

  const production = loadModule({
    pathname: '/other',
    hostname: 'www.thestarters.com',
  })
  assert.equal(production.api.diagnosticsEnabled(), false)

  const debugProduction = loadModule({
    pathname: '/other',
    hostname: 'www.thestarters.com',
    debug: true,
  })
  assert.equal(debugProduction.api.diagnosticsEnabled(), true)
})

test('production logs nothing while still redirecting correctly', async () => {
  for (const member of [TALENT, BRAND_FREE, BRAND_FREE_DONE]) {
    const { location, logs } = loadModule({
      hostname: 'www.thestarters.com',
      member,
    })
    await flush()
    await flush()
    assert.equal(location.replaced, contractHome(member), member.id)
    assert.deepEqual(logs.info, [], member.id)
    assert.deepEqual(logs.warn, [], member.id)
    assert.deepEqual(logs.error, [], member.id)
  }

  // The paid Brand, on both of its done paths.
  for (const options of [
    { marker: '1' },
    { xano: { statusBody: BRAND_DONE } },
  ]) {
    const { location, logs } = loadModule(
      Object.assign(
        { hostname: 'www.thestarters.com', member: brandPaid() },
        options,
      ),
    )
    await flush()
    await flush()
    await flush()
    assert.equal(location.replaced, DASHBOARD, JSON.stringify(options))
    assert.deepEqual(logs.info, [], JSON.stringify(options))
    assert.deepEqual(logs.warn, [], JSON.stringify(options))
    assert.deepEqual(logs.error, [], JSON.stringify(options))
  }
})

test('production stays silent on the fail-open paths too', async () => {
  for (const options of [
    { memberLookupRejects: true },
    { roleContractMissing: true },
    { roleHomeMissing: true, member: TALENT },
    { member: UNMAPPED },
    { member: CONFLICTED },
    { member: null },
    // The paid-Brand read failures are fail-open paths of their own now.
    { member: brandPaid(), xano: { status: 500 } },
    { member: brandPaid(), xano: { statusBody: BRAND_NOT_DONE } },
    { member: brandPaid(), storageFailure: 'missing', xano: { rejects: true } },
  ]) {
    const { logs } = loadModule(
      Object.assign({ hostname: 'www.thestarters.com' }, options),
    )
    await flush()
    await flush()
    assert.deepEqual(logs.info, [], JSON.stringify(options))
    assert.deepEqual(logs.warn, [], JSON.stringify(options))
  }
})

test('a second load does not re-run the check', async () => {
  const { window, lookups } = loadModule({ member: brandPaid('yes') })
  await flush()
  await flush()
  assert.equal(window.__startersCompleteProfileRedirectBooted, true)
  assert.equal(lookups.length, 1)
})

// --- Release marker -----------------------------------------------------------

test('the header @release marker matches the exported release property', () => {
  const { api } = loadModule({ pathname: '/other' })
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(
    marker,
    'no "@release vX.Y.Z" line in the complete-profile-redirect.js header',
  )
  assert.equal(api.release, marker[1])
})

test('this module ships the same release marker as the route guard it depends on', () => {
  const moduleMarker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  const guardMarker = routeGuardSource.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(moduleMarker, 'no @release line in complete-profile-redirect.js')
  assert.ok(guardMarker, 'no @release line in route-guard.js')
  assert.equal(moduleMarker[1], guardMarker[1])
})
