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
const DONE_FIELD = 'completed-brand-profile'

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
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  }
  if (options.debug) window.STARTERS_DEBUG = true

  // This module makes no network call at all, so `fetch` is deliberately absent
  // from the harness window: a request would throw rather than be silently
  // stubbed, which is the assertion "no network" wants.
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
  vm.runInContext(source, context)

  return {
    api: window.StartersCompleteProfileRedirect,
    clock,
    guard: window.StartersV3RouteGuard,
    guardAttributes,
    location,
    logs,
    lookups,
    window,
  }
}

// --- Pure helpers -------------------------------------------------------------

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

test('the redirect destination is not itself a scoped page (no loop)', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isCompleteProfilePath(api.dashboardPath), false)
  assert.equal(api.dashboardPath, DASHBOARD)
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

test('Talent, a free Brand, an unmapped and a conflicted member are all untouched', async () => {
  for (const member of [TALENT, BRAND_FREE, UNMAPPED, CONFLICTED]) {
    // The completion field is set on every one of them, so only the role check
    // can be what keeps them on the page.
    const withField = Object.assign({}, member, {
      customFields: { [DONE_FIELD]: 'yes' },
    })
    const { location } = loadModule({ member: withField })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, member.id)
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
  const { location, logs } = loadModule({
    roleContractMissing: true,
    member: brandPaid('yes'),
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.ok(
    logs.warn.some((line) => line.includes('role contract unavailable')),
    'expected a staging warning about the missing contract',
  )
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
  const { location, lookups, window } = loadModule({ member: brandPaid('yes') })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.equal(lookups.length, 1)
  // `fetch` is absent from the harness window on purpose: a request would have
  // thrown instead of being stubbed.
  assert.equal(window.fetch, undefined)
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
  const { location, logs } = loadModule({
    hostname: 'www.thestarters.com',
    member: brandPaid('yes'),
  })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.deepEqual(logs.info, [])
  assert.deepEqual(logs.warn, [])
  assert.deepEqual(logs.error, [])
})

test('production stays silent on the fail-open paths too', async () => {
  for (const options of [
    { memberLookupRejects: true },
    { roleContractMissing: true },
    { member: TALENT },
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
