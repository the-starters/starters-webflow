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

// The one role this module acts on, in both the not-done and done states. The
// customFields shape is Memberstack's own.
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
  // loudly and traceably the day someone adds a request to this "no network"
  // module.
  const fetches = []
  function tripwireFetch(url, init) {
    fetches.push({ url, init })
    throw new Error(
      'complete-profile-redirect must make no network request (fetch ' +
        url +
        ')',
    )
  }

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
    fetch: tripwireFetch,
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
        : brandPaid('yes'),
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
    clock,
    fetches,
    guard: window.StartersV3RouteGuard,
    guardAttributes,
    location,
    logs,
    lookups,
    window,
  }
}

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

test('the completion field is read with the same semantics as the quiz marker', () => {
  const { api, guard } = loadModule({ pathname: '/other' })
  assert.equal(api.doneField, DONE_FIELD)

  // Done: any trimmed non-empty string, and any non-string truthy value.
  for (const value of ['yes', 'true', 'completed', ' x ', true, 1, {}]) {
    assert.equal(
      api.hasCompletedBrandProfile(brandPaid(value)),
      true,
      JSON.stringify(value),
    )
  }
  // Not done: empty, whitespace-only, and every falsy value.
  for (const value of ['', '   ', '\n\t ', false, 0, null, undefined]) {
    assert.equal(
      api.hasCompletedBrandProfile(brandPaid(value)),
      false,
      JSON.stringify(value),
    )
  }
  // Absent field, absent customFields, and no member at all.
  assert.equal(api.hasCompletedBrandProfile(brandPaid()), false)
  assert.equal(api.hasCompletedBrandProfile({ id: 'm' }), false)
  assert.equal(api.hasCompletedBrandProfile(null), false)

  // The predicate is a deliberate copy of the guard's `starter-quiz` rule; if
  // that contract ever changes shape, this pins the copy to the original.
  const quizShaped = { customFields: { 'starter-quiz': '   ' } }
  assert.equal(guard.hasCompletedQuiz(quizShaped), false)
  assert.equal(
    guard.hasCompletedQuiz({ customFields: { 'starter-quiz': 'x' } }),
    true,
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

test('a paid Brand with the completion field set goes to the brand dashboard', async () => {
  const { location } = loadModule({ member: brandPaid('yes') })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

test('runs on both slash forms of the page', async () => {
  for (const pathname of ['/complete-profile', '/complete-profile/']) {
    const { location } = loadModule({ pathname, member: brandPaid('yes') })
    await flush()
    await flush()
    assert.equal(location.replaced, DASHBOARD, pathname)
  }
})

test('a paid Brand whose field is empty, whitespace, or absent stays', async () => {
  for (const member of [
    brandPaid(''),
    brandPaid('   '),
    brandPaid(),
    { id: 'm-brand-paid', planConnections: [plan('pln_new-paid-plan-463h04ph')] },
  ]) {
    const { location } = loadModule({ member })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(member))
  }
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

test('the paid-Brand completion field is ignored for the other two roles', async () => {
  // A stray `completed-brand-profile` value on a Talent or free-Brand member is
  // meaningless — it is a paid-Brand form marker — and must not divert them to
  // the Brand dashboard.
  for (const member of [TALENT, BRAND_FREE, BRAND_FREE_DONE]) {
    const withField = Object.assign({}, member, {
      customFields: Object.assign({}, member.customFields, {
        [DONE_FIELD]: 'yes',
      }),
    })
    const { location } = loadModule({ member: withField })
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

test('every role decision still costs exactly one member lookup and no network call', async () => {
  for (const member of [
    TALENT,
    BRAND_FREE,
    BRAND_FREE_DONE,
    brandPaid('yes'),
  ]) {
    const { fetches, lookups } = loadModule({ member })
    await flush()
    await flush()
    assert.equal(lookups.length, 1, member.id)
    // The harness DOES define `fetch` — a recording tripwire that throws — so an
    // empty list is the module abstaining, not the global being absent.
    assert.deepEqual(fetches, [], member.id)
  }
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
    delayedMember: brandPaid('yes'),
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

test('the decision costs exactly one member lookup and no network call', async () => {
  const { fetches, location, lookups, window } = loadModule({
    member: brandPaid('yes'),
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
    member: brandPaid('yes'),
  })
  assert.equal(await api.completeProfileDestination(), DASHBOARD)
  assert.equal(location.replaced, undefined)

  const notDone = loadModule({ pathname: '/other', member: brandPaid('  ') })
  assert.equal(await notDone.api.completeProfileDestination(), null)

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
  const { clock } = loadModule({ member: brandPaid('yes') })
  await flush()
  await flush()
  assert.equal(clock.pending(), 0)
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
  for (const member of [
    brandPaid('yes'),
    TALENT,
    BRAND_FREE,
    BRAND_FREE_DONE,
  ]) {
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
})

test('production stays silent on the fail-open paths too', async () => {
  for (const options of [
    { memberLookupRejects: true },
    { roleContractMissing: true },
    { roleHomeMissing: true, member: TALENT },
    { member: UNMAPPED },
    { member: CONFLICTED },
    { member: null },
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
