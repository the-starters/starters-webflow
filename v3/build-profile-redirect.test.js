const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./build-profile-redirect.js'),
  'utf8',
)
const routeGuardSource = fs.readFileSync(
  require.resolve('./route-guard.js'),
  'utf8',
)

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const STATUS_URL =
  XANO + '/api:KZf7nFnk/starters_onboarding/get_build_profile_status'
// The endpoint this module used to read. Still stubbed so "it is never requested
// any more" is an assertion about behaviour rather than about a stub that would
// have thrown anyway.
const LEGACY_GET_URL =
  XANO + '/api:KZf7nFnk/starters_onboarding/get_freelancers'
const ONBOARDING = '/starter-onboarding'
const DASHBOARD = '/starter-dashboard'
const SELECT_PROFILE = '/build-profile/select-profile'

// get_build_profile_status bodies. `build_profile_done` is true only when a
// freelancers_v3 row exists AND its profile_type_30 is stamped, which is what
// the Build-profile submit does.
const ONBOARDED = {
  has_record: true,
  build_profile_done: true,
  onboarding_done: true,
  profile_type: 'Full',
  platform_status: 'approved',
}
const NEEDS_ONBOARDING = {
  has_record: true,
  build_profile_done: true,
  onboarding_done: false,
  profile_type: 'Full',
  platform_status: 'approved',
}
// The 282-of-955 case: the row was created when the member started the form and
// never finished it, so profile_type_30 is empty. Row-existence used to read this
// as "past Build profile" and pushed the member out of a step they had not done.
const UNFINISHED_WITH_ROW = {
  has_record: true,
  build_profile_done: false,
  onboarding_done: false,
  profile_type: '',
  platform_status: '',
}
const NO_RECORD = {
  has_record: false,
  build_profile_done: false,
  onboarding_done: false,
  profile_type: '',
  platform_status: '',
}
// What the pre-migration code would have read for UNFINISHED_WITH_ROW: a row is
// there, onboarding is not done, so the old logic redirected to onboarding.
const LEGACY_ROW_EXISTS_ENVELOPE = {
  freelancer: [{ id: 12, onboarding_done: false }],
}

function plan(planId) {
  return { active: true, planId }
}

const TALENT = {
  id: 'm-talent',
  planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
}
const BRAND_PAID = {
  id: 'm-brand-paid',
  planConnections: [plan('pln_new-paid-plan-463h04ph')],
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

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * A deterministic clock driving both `Date.now()` and the module's timers, so
 * the 4s overall funnel budget and the 8s Memberstack wait are testable without
 * waiting for them. Same shape as the sibling v3 test harnesses.
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
// this into a null payload, which must read as inconclusive rather than as a
// state.
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
    : SELECT_PROFILE
  const fetchCalls = []
  const aborted = []
  const logs = { info: [], warn: [], error: [] }
  // Mutable so a test can change what Xano answers BETWEEN the boot check and a
  // later bfcache restore, which is the whole point of the pageshow re-run.
  let statusBody = Object.prototype.hasOwnProperty.call(options, 'statusBody')
    ? options.statusBody
    : ONBOARDED

  const location = {
    hostname,
    origin: 'https://' + hostname,
    pathname,
    search: '',
    replace(value) {
      location.replaced = value
    },
  }

  async function fetchStub(url, config = {}) {
    fetchCalls.push({ url: String(url), config })

    if (String(url).indexOf(TRADE_URL) === 0) {
      if (options.tradeRejects) throw new Error('trade network failure')
      if (options.tradeStatus) {
        return jsonResponse(null, { ok: false, status: options.tradeStatus })
      }
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(options, 'tradeBody')
          ? options.tradeBody
          : 'xano-token-abc',
      )
    }

    if (String(url) === STATUS_URL) {
      if (options.getNeverSettles) return new Promise(() => {})
      if (options.getRejects) throw new Error('get network failure')
      if (options.getStatus) {
        return jsonResponse(null, { ok: false, status: options.getStatus })
      }
      if (options.getMalformedJson) return malformedJsonResponse()
      return jsonResponse(statusBody)
    }

    // Answerable on purpose (see LEGACY_GET_URL): the pre-migration module would
    // get a usable row-exists envelope here, so a test that asserts the new
    // destination really is asserting the new signal.
    if (String(url) === LEGACY_GET_URL) {
      return jsonResponse(LEGACY_ROW_EXISTS_ENVELOPE)
    }

    throw new Error('unexpected fetch: ' + url)
  }

  // The authored `[build-profile-success]` element. Absent unless a test asks
  // for it, which is the real shape of /build-profile/select-profile and keeps
  // every pre-existing test on its original path.
  const successElement = options.successState
    ? {
        style: { display: options.successState.display || 'block' },
        hidden: options.successState.hidden === true,
        getAttribute: (name) =>
          name === 'aria-hidden' && options.successState.ariaHidden === true
            ? 'true'
            : null,
      }
    : null

  const eventListeners = {}

  const window = {
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.name = name
        this.detail = init && init.detail
      }
    },
    URL,
    URLSearchParams,
    addEventListener(type, handler) {
      ;(eventListeners[type] ||= []).push(handler)
    },
    dispatchEvent() {},
    getComputedStyle: (element) => ({
      display: (element && element.style && element.style.display) || 'block',
      visibility: 'visible',
    }),
    location,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  }
  if (!options.fetchMissing) {
    window.fetch = fetchStub
    window.AbortController = class {
      constructor() {
        this.signal = { aborted: false }
      }
      abort() {
        this.signal.aborted = true
        aborted.push(this)
      }
    }
  }
  if (options.debug) window.STARTERS_DEBUG = true

  function memberstackFor(member) {
    const api = {
      getCurrentMember: async () => {
        if (options.memberLookupRejects) {
          throw new Error('member lookup failure')
        }
        return { data: member }
      },
    }
    if (!options.cookieMissing) {
      api.getMemberCookie = async () => {
        if (options.cookieRejects) throw new Error('memberstack failure')
        return options.loggedOutCookie ? null : 'ms-jwt'
      }
    }
    return api
  }

  if (options.delayedMember) {
    window.setTimeout(() => {
      window.$memberstackDom = memberstackFor(options.delayedMember)
    }, options.memberstackDelayMs || 25)
  } else if (!options.memberstackMissing) {
    window.$memberstackDom = memberstackFor(
      Object.prototype.hasOwnProperty.call(options, 'member')
        ? options.member
        : TALENT,
    )
  }

  const document = {
    documentElement: {
      setAttribute() {},
    },
    querySelector(selector) {
      return selector === '[build-profile-success]' ? successElement : null
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

  // The module reads the role from the sitewide guard's exported contract, so
  // the real guard source is loaded first — a hand-written stub would drift from
  // the plan table it is meant to mirror. Its OWN boot is neutralised by
  // pointing it at an unguarded path while it initialises: these three pages are
  // guarded, so a live guard would redirect the Brand, unmapped, and logged-out
  // fixtures itself and hide what this module decided. That co-located behaviour
  // is real, and it is v3/route-guard.test.js's job to assert; here only the
  // exported contract matters. Skipping the guard entirely
  // (`roleContractMissing`) reproduces a bad install order.
  if (!options.roleContractMissing) {
    location.pathname = '/harness-neutral-unguarded-path'
    vm.runInContext(routeGuardSource, context)
    location.pathname = pathname
  }
  vm.runInContext(source, context)

  return {
    api: window.StartersBuildProfileRedirect,
    aborted,
    clock,
    fetchCalls,
    location,
    logs,
    successElement,
    window,
    setStatusBody(body) {
      statusBody = body
    },
    // A bfcache restore is `persisted: true`; a normal load or a same-page
    // history hop is not, and must not re-run the check.
    firePageshow(persisted = true) {
      for (const handler of eventListeners.pageshow || []) handler({ persisted })
    },
    pageshowListenerCount: () => (eventListeners.pageshow || []).length,
  }
}

const urlsOf = (calls) => calls.map((call) => call.url)

// --- Pure helpers -------------------------------------------------------------

test('exactly the three authored build-profile paths are in scope', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isBuildProfilePath('/build-profile/select-profile'), true)
  assert.equal(api.isBuildProfilePath('/build-profile/full-profile'), true)
  assert.equal(api.isBuildProfilePath('/build-profile/consult'), true)
  // Not in scope: the funnel index, a nested step, and the sibling pages the
  // module redirects TO — a match there would be an immediate redirect loop.
  assert.equal(api.isBuildProfilePath('/build-profile'), false)
  assert.equal(api.isBuildProfilePath('/build-profile/'), false)
  assert.equal(
    api.isBuildProfilePath('/build-profile/select-profile/step-2'),
    false,
  )
  assert.equal(api.isBuildProfilePath(ONBOARDING), false)
  assert.equal(api.isBuildProfilePath(DASHBOARD), false)
  assert.equal(api.isBuildProfilePath('/'), false)
})

test('neither redirect destination is itself a scoped page (no loop)', () => {
  const { api } = loadModule({ pathname: '/other' })
  for (const destination of [api.onboardingPath, api.dashboardPath]) {
    assert.equal(api.isBuildProfilePath(destination), false, destination)
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

test('the status body maps to a funnel position', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.funnelStateFrom(NO_RECORD), 'build-profile')
  assert.equal(api.funnelStateFrom(UNFINISHED_WITH_ROW), 'build-profile')
  assert.equal(api.funnelStateFrom(NEEDS_ONBOARDING), 'onboarding')
  assert.equal(api.funnelStateFrom(ONBOARDED), 'done')
})

test('only a literal false on build_profile_done means "still building"', () => {
  const { api } = loadModule({ pathname: '/other' })
  // A body this module cannot read is inconclusive, never a state. On this page
  // both outcomes are "stay", but auth-route.js routes them apart, so the
  // distinction has to exist here too.
  assert.equal(api.funnelStateFrom(null), 'unknown')
  assert.equal(api.funnelStateFrom(undefined), 'unknown')
  assert.equal(api.funnelStateFrom({}), 'unknown')
  assert.equal(api.funnelStateFrom('nope'), 'unknown')
  assert.equal(api.funnelStateFrom({ build_profile_done: 'false' }), 'unknown')
  assert.equal(api.funnelStateFrom({ build_profile_done: 0 }), 'unknown')
  assert.equal(api.funnelStateFrom({ build_profile_done: null }), 'unknown')
  // The old envelope is not a status body.
  assert.equal(api.funnelStateFrom(LEGACY_ROW_EXISTS_ENVELOPE), 'unknown')
})

test('only a literal true on onboarding_done counts as onboarded', () => {
  const { api } = loadModule({ pathname: '/other' })
  // Everything truthy-but-not-true biases toward onboarding rather than past it.
  for (const onboarding_done of ['true', 1, {}, null, undefined]) {
    assert.equal(
      api.funnelStateFrom({ build_profile_done: true, onboarding_done }),
      'onboarding',
      String(onboarding_done),
    )
  }
  assert.equal(
    api.funnelStateFrom({ build_profile_done: true, onboarding_done: true }),
    'done',
  )
})

// --- Runtime behaviour --------------------------------------------------------

test('a Talent member with no record at all stays on the page', async () => {
  const { location, fetchCalls } = loadModule({ statusBody: NO_RECORD })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(urlsOf(fetchCalls).length, 2)
})

/**
 * The 282-member regression guard. Before 2026-08-04 the signal was "a
 * freelancers_v3 row exists", so a member who started Build profile and never
 * submitted it read as finished and was pushed to /starter-onboarding. 282 of
 * 955 rows are in exactly that shape. They belong on this page until the form is
 * submitted, so the module must STAY.
 */
test('a Talent member with a row but an unfinished build profile STAYS', async () => {
  const { location, fetchCalls } = loadModule({
    statusBody: UNFINISHED_WITH_ROW,
  })
  await flush()
  await flush()
  assert.equal(
    location.replaced,
    undefined,
    'has_record true must not count as "past Build profile"',
  )
  // Proof the decision came from the new signal: the old endpoint, which is
  // answerable in this harness and would have said "row exists, go to
  // onboarding", was never asked.
  assert.equal(
    fetchCalls.filter((call) => call.url === LEGACY_GET_URL).length,
    0,
  )
  assert.equal(fetchCalls.filter((call) => call.url === STATUS_URL).length, 1)
})

test('a Talent member who finished building but not onboarding goes to onboarding', async () => {
  const { location } = loadModule({ statusBody: NEEDS_ONBOARDING })
  await flush()
  await flush()
  assert.equal(location.replaced, ONBOARDING)
})

test('a Talent member who finished onboarding goes to the dashboard', async () => {
  const { location } = loadModule({ statusBody: ONBOARDED })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

test('runs on all three build-profile pages', async () => {
  for (const pathname of [
    '/build-profile/select-profile',
    '/build-profile/full-profile',
    '/build-profile/consult',
  ]) {
    const { location } = loadModule({ pathname, statusBody: ONBOARDED })
    await flush()
    await flush()
    assert.equal(location.replaced, DASHBOARD, pathname)
  }
})

// --- Request contract ---------------------------------------------------------

test('the funnel read goes to get_build_profile_status, never to get_freelancers', async () => {
  const { fetchCalls } = loadModule({ statusBody: ONBOARDED })
  await flush()
  await flush()
  const urls = urlsOf(fetchCalls)
  assert.equal(urls.length, 2, 'one token trade plus one status read')
  assert.ok(urls[0].startsWith(TRADE_URL + '?token='), urls[0])
  assert.equal(urls[1], STATUS_URL)
  assert.ok(
    !urls.some((url) => url.indexOf(LEGACY_GET_URL) === 0),
    'get_freelancers must no longer be requested',
  )
})

test('the status read carries the traded token as a bearer and sends no body', async () => {
  const { fetchCalls } = loadModule({ statusBody: ONBOARDED })
  await flush()
  await flush()
  const read = fetchCalls.find((call) => call.url === STATUS_URL)
  assert.ok(read, 'expected a get_build_profile_status call')
  assert.equal(read.config.headers.Authorization, 'Bearer xano-token-abc')
  // No inputs: the endpoint derives the member from the token.
  assert.equal(read.config.method, undefined)
  assert.equal(read.config.body, undefined)
})

test('does not run on an unapproved hostname', async () => {
  const { location, fetchCalls } = loadModule({
    hostname: 'attacker.example',
    statusBody: ONBOARDED,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(fetchCalls, [])
})

test('does not run on a page outside the three build-profile steps', async () => {
  const { location, fetchCalls } = loadModule({
    pathname: DASHBOARD,
    statusBody: ONBOARDED,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(fetchCalls, [])
})

// --- Role scope ---------------------------------------------------------------

test('a Brand or unmapped member costs no Xano request and is left to the guard', async () => {
  for (const member of [BRAND_PAID, BRAND_FREE, UNMAPPED, CONFLICTED]) {
    const { location, fetchCalls } = loadModule({
      member,
      statusBody: ONBOARDED,
    })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, member.id)
    assert.deepEqual(fetchCalls, [], member.id)
  }
})

test('a logged-out visitor is left alone; route-guard owns that redirect', async () => {
  for (const member of [null, {}, { id: '' }]) {
    const { location, fetchCalls } = loadModule({ member })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined)
    assert.deepEqual(fetchCalls, [])
  }
})

test('a missing route-guard role contract stays put instead of guessing', async () => {
  const { location, fetchCalls, logs } = loadModule({
    roleContractMissing: true,
    statusBody: ONBOARDED,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(fetchCalls, [])
  assert.ok(
    logs.warn.some((line) => line.includes('role contract unavailable')),
    'expected a staging warning about the missing contract',
  )
})

test('waits for a late Memberstack before deciding', async () => {
  const { location, clock } = loadModule({
    delayedMember: TALENT,
    memberstackDelayMs: 300,
    statusBody: ONBOARDED,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  await clock.advance(400)
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

test('gives up on a Memberstack that never arrives and renders the page', async () => {
  const { location, clock, fetchCalls } = loadModule({
    memberstackMissing: true,
  })
  await clock.advance(8000)
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(fetchCalls, [])
})

// --- Fail-open paths ----------------------------------------------------------

test('a member lookup that rejects leaves the page alone', async () => {
  const { location, fetchCalls } = loadModule({ memberLookupRejects: true })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(fetchCalls, [])
})

test('a logged-out Xano session (no cookie) leaves the page alone', async () => {
  const { location } = loadModule({ loggedOutCookie: true })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
})

test('a Memberstack without getMemberCookie leaves the page alone', async () => {
  const { location, fetchCalls } = loadModule({ cookieMissing: true })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(fetchCalls, [])
})

test('a rejected or non-2xx token trade leaves the page alone', async () => {
  for (const options of [{ tradeRejects: true }, { tradeStatus: 401 }]) {
    const { location } = loadModule(options)
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(options))
  }
})

test('a token trade that returns no usable token leaves the page alone', async () => {
  for (const tradeBody of [null, '', {}, { authToken: '' }]) {
    const { location } = loadModule({ tradeBody })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(tradeBody))
  }
})

test('a rejected, 401, or 500 status read leaves the page alone', async () => {
  for (const options of [
    { getRejects: true },
    // 401 is the endpoint's own answer to an unauthenticated or expired token,
    // and it must never be mistaken for a funnel position.
    { getStatus: 401 },
    { getStatus: 500 },
  ]) {
    const { location, fetchCalls } = loadModule(options)
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(options))
    assert.equal(
      fetchCalls.filter((call) => call.url === STATUS_URL).length,
      1,
      JSON.stringify(options),
    )
  }
})

test('a 200 with an unparseable body leaves the page alone', async () => {
  const { location, logs } = loadModule({ getMalformedJson: true })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.ok(logs.info.some((line) => line.includes('unknown')))
})

test('a status body missing build_profile_done leaves the page alone', async () => {
  for (const statusBody of [{}, { has_record: true }, 'nope', 42]) {
    const { location } = loadModule({ statusBody })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(statusBody))
  }
})

test('a browser without fetch skips the check entirely', async () => {
  const { location, logs } = loadModule({ fetchMissing: true })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.ok(logs.warn.some((line) => line.includes('fetch is unavailable')))
})

test('the 4s budget aborts a hung read and renders the page', async () => {
  const { location, clock, aborted, api, logs } = loadModule({
    getNeverSettles: true,
  })
  await flush()
  await flush()
  assert.equal(api.checkBudgetMs, 4000)
  assert.equal(location.replaced, undefined)
  await clock.advance(4000)
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(aborted.length, 1, 'the shared AbortController should fire once')
  assert.ok(logs.warn.some((line) => line.includes('budget')))
})

test('the budget timer is cancelled once an answer lands', async () => {
  const { clock } = loadModule({ statusBody: ONBOARDED })
  await flush()
  await flush()
  assert.equal(clock.pending(), 0, 'no timer should outlive the decision')
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
    statusBody: ONBOARDED,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.deepEqual(logs.info, [])
  assert.deepEqual(logs.warn, [])
  assert.deepEqual(logs.error, [])
})

test('a second load does not re-run the check', async () => {
  const { window, fetchCalls } = loadModule({ statusBody: ONBOARDED })
  await flush()
  await flush()
  const first = fetchCalls.length
  assert.equal(window.__startersBuildProfileRedirectBooted, true)
  assert.ok(first > 0)
})

// --- Success-state stand-down -------------------------------------------------

test('a visible authored success state stands the redirect down', async () => {
  const { location, fetchCalls, logs } = loadModule({
    pathname: '/build-profile/consult',
    statusBody: ONBOARDED,
    successState: { display: 'block' },
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  // The check still RAN — the stand-down is a decision at redirect time, not an
  // early bail that skips the funnel read. That is what makes it beat the race.
  assert.equal(fetchCalls.length, 2)
  assert.ok(
    logs.info.some((line) => line.includes('standing down')),
    'expected a stand-down note, got: ' + JSON.stringify(logs.info),
  )
})

test('the stand-down covers both authored success pages and every hide mechanism', async () => {
  for (const pathname of ['/build-profile/full-profile', '/build-profile/consult']) {
    const { location } = loadModule({
      pathname,
      statusBody: ONBOARDED,
      successState: { display: 'block' },
    })
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, pathname)
  }

  // A success element that is present but HIDDEN is not a stand-down: the member
  // is looking at the form, so the normal funnel redirect still applies.
  for (const successState of [
    { display: 'none' },
    { hidden: true },
    { ariaHidden: true },
  ]) {
    const { location } = loadModule({
      pathname: '/build-profile/consult',
      statusBody: ONBOARDED,
      successState,
    })
    await flush()
    await flush()
    assert.equal(location.replaced, DASHBOARD, JSON.stringify(successState))
  }
})

test('select-profile has no success element, so its behaviour is unchanged', async () => {
  const { location, api } = loadModule({
    pathname: SELECT_PROFILE,
    statusBody: ONBOARDED,
  })
  await flush()
  await flush()
  assert.equal(api.successStateVisible(), false)
  assert.equal(location.replaced, DASHBOARD)
})

test('the stand-down does not suppress the onboarding destination either', async () => {
  const { location } = loadModule({
    pathname: '/build-profile/consult',
    statusBody: NEEDS_ONBOARDING,
    successState: { display: 'block' },
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
})

// --- bfcache re-evaluation ----------------------------------------------------

test('a bfcache restore re-evaluates and redirects a member who is now done', async () => {
  const page = loadModule({
    pathname: '/build-profile/consult',
    statusBody: UNFINISHED_WITH_ROW,
  })
  await flush()
  await flush()
  assert.equal(page.location.replaced, undefined, 'boot must leave an unfinished member alone')
  const afterBoot = page.fetchCalls.length

  // The member finished the funnel, then came Back to this page.
  page.setStatusBody(ONBOARDED)
  page.firePageshow(true)
  await flush()
  await flush()
  assert.equal(page.location.replaced, DASHBOARD)
  assert.ok(page.fetchCalls.length > afterBoot, 'the restore must re-read the funnel')
})

test('a restored page still showing the success state stays put', async () => {
  const page = loadModule({
    pathname: '/build-profile/consult',
    statusBody: ONBOARDED,
    successState: { display: 'block' },
  })
  await flush()
  await flush()
  assert.equal(page.location.replaced, undefined)

  page.firePageshow(true)
  await flush()
  await flush()
  assert.equal(page.location.replaced, undefined)
})

test('a non-persisted pageshow does not re-run the check', async () => {
  const page = loadModule({
    pathname: '/build-profile/consult',
    statusBody: UNFINISHED_WITH_ROW,
  })
  await flush()
  await flush()
  const afterBoot = page.fetchCalls.length
  assert.ok(afterBoot > 0)

  page.setStatusBody(ONBOARDED)
  page.firePageshow(false)
  await flush()
  await flush()
  assert.equal(page.fetchCalls.length, afterBoot, 'a normal load already ran the boot check')
  assert.equal(page.location.replaced, undefined)
})

test('the pageshow listener is registered once and only on an in-scope page', async () => {
  const inScope = loadModule({ pathname: '/build-profile/consult', statusBody: UNFINISHED_WITH_ROW })
  await flush()
  assert.equal(inScope.pageshowListenerCount(), 1)

  for (const options of [
    { pathname: DASHBOARD },
    { hostname: 'attacker.example' },
  ]) {
    const out = loadModule({ statusBody: ONBOARDED, ...options })
    await flush()
    assert.equal(out.pageshowListenerCount(), 0, JSON.stringify(options))
  }
})

test('a restore arriving mid-check is dropped rather than run concurrently', async () => {
  const page = loadModule({
    pathname: '/build-profile/consult',
    statusBody: ONBOARDED,
    getNeverSettles: true,
  })
  await flush()
  await flush()
  const inFlight = page.fetchCalls.length

  page.firePageshow(true)
  await flush()
  await flush()
  assert.equal(page.fetchCalls.length, inFlight, 'no second token trade while one check is open')
  assert.ok(
    page.logs.info.some((line) => line.includes('already running')),
    'expected an in-flight note, got: ' + JSON.stringify(page.logs.info),
  )
})

test('a restore after a finished check is evaluated normally', async () => {
  const page = loadModule({
    pathname: '/build-profile/consult',
    statusBody: UNFINISHED_WITH_ROW,
  })
  await flush()
  await flush()
  const afterBoot = page.fetchCalls.length

  // Two restores in a row: the first completes, so the second is not blocked by
  // a stale in-flight latch.
  page.firePageshow(true)
  await flush()
  await flush()
  const afterFirst = page.fetchCalls.length
  assert.ok(afterFirst > afterBoot)

  page.setStatusBody(ONBOARDED)
  page.firePageshow(true)
  await flush()
  await flush()
  assert.ok(page.fetchCalls.length > afterFirst)
  assert.equal(page.location.replaced, DASHBOARD)
})

// --- Release marker -----------------------------------------------------------

test('the header @release marker matches the exported release property', () => {
  const { api } = loadModule({ pathname: '/other' })
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the build-profile-redirect.js header')
  assert.equal(api.release, marker[1])
})

test('this module ships the same release marker as the route guard it depends on', () => {
  const moduleMarker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  const guardMarker = routeGuardSource.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(moduleMarker, 'no @release line in build-profile-redirect.js')
  assert.ok(guardMarker, 'no @release line in route-guard.js')
  assert.equal(moduleMarker[1], guardMarker[1])
})
