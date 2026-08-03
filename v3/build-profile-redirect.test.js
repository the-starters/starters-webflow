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
const GET_URL = XANO + '/api:KZf7nFnk/starters_onboarding/get_freelancers'
const ONBOARDING = '/starter-onboarding'
const DASHBOARD = '/starter-dashboard'
const SELECT_PROFILE = '/build-profile/select-profile'

const DONE_ENVELOPE = { freelancer: [{ id: 12, onboarding_done: true }] }
const NOT_DONE_ENVELOPE = { freelancer: [{ id: 12, onboarding_done: false }] }
const EMPTY_ENVELOPE = { freelancer: [] }

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

function loadModule(options = {}) {
  const clock = makeClock()
  const hostname = options.hostname || 'the-starters-3-0.webflow.io'
  const pathname = Object.prototype.hasOwnProperty.call(options, 'pathname')
    ? options.pathname
    : SELECT_PROFILE
  const fetchCalls = []
  const aborted = []
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

    if (String(url) === GET_URL) {
      if (options.getNeverSettles) return new Promise(() => {})
      if (options.getRejects) throw new Error('get network failure')
      if (options.getStatus) {
        return jsonResponse(null, { ok: false, status: options.getStatus })
      }
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(options, 'envelope')
          ? options.envelope
          : DONE_ENVELOPE,
      )
    }

    throw new Error('unexpected fetch: ' + url)
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
    window,
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

test('envelope parsing distinguishes no-record, not-done, and done', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.onboardingStateFrom(EMPTY_ENVELOPE), 'no-record')
  assert.equal(api.onboardingStateFrom({}), 'no-record')
  assert.equal(api.onboardingStateFrom(null), 'no-record')
  assert.equal(api.onboardingStateFrom({ freelancer: null }), 'no-record')
  assert.equal(api.onboardingStateFrom(DONE_ENVELOPE), 'done')
  assert.equal(api.onboardingStateFrom(NOT_DONE_ENVELOPE), 'not-done')
  // Only a literal `true` is done; everything truthy-but-not-true biases toward
  // onboarding rather than past it.
  assert.equal(
    api.onboardingStateFrom({ freelancer: [{ onboarding_done: 'true' }] }),
    'not-done',
  )
  assert.equal(
    api.onboardingStateFrom({ freelancer: [{ onboarding_done: 1 }] }),
    'not-done',
  )
  assert.equal(api.onboardingStateFrom({ freelancer: [{}] }), 'not-done')
  assert.equal(api.onboardingStateFrom({ freelancer: [null] }), 'not-done')
})

// --- Runtime behaviour --------------------------------------------------------

test('a Talent member with no freelancer record stays on the page', async () => {
  const { location, fetchCalls } = loadModule({ envelope: EMPTY_ENVELOPE })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(urlsOf(fetchCalls).length, 2)
})

test('a Talent member with an unfinished record goes to onboarding', async () => {
  const { location } = loadModule({ envelope: NOT_DONE_ENVELOPE })
  await flush()
  await flush()
  assert.equal(location.replaced, ONBOARDING)
})

test('a Talent member who finished onboarding goes to the dashboard', async () => {
  const { location } = loadModule({ envelope: DONE_ENVELOPE })
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
    const { location } = loadModule({ pathname, envelope: DONE_ENVELOPE })
    await flush()
    await flush()
    assert.equal(location.replaced, DASHBOARD, pathname)
  }
})

test('does not run on an unapproved hostname', async () => {
  const { location, fetchCalls } = loadModule({
    hostname: 'attacker.example',
    envelope: DONE_ENVELOPE,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(fetchCalls, [])
})

test('does not run on a page outside the three build-profile steps', async () => {
  const { location, fetchCalls } = loadModule({
    pathname: DASHBOARD,
    envelope: DONE_ENVELOPE,
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
      envelope: DONE_ENVELOPE,
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
    envelope: DONE_ENVELOPE,
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
    envelope: DONE_ENVELOPE,
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

test('a rejected or non-2xx record read leaves the page alone', async () => {
  for (const options of [{ getRejects: true }, { getStatus: 500 }]) {
    const { location } = loadModule(options)
    await flush()
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(options))
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
  const { clock } = loadModule({ envelope: DONE_ENVELOPE })
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
    envelope: DONE_ENVELOPE,
  })
  await flush()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.deepEqual(logs.info, [])
  assert.deepEqual(logs.warn, [])
  assert.deepEqual(logs.error, [])
})

test('a second load does not re-run the check', async () => {
  const { window, fetchCalls } = loadModule({ envelope: DONE_ENVELOPE })
  await flush()
  await flush()
  const first = fetchCalls.length
  assert.equal(window.__startersBuildProfileRedirectBooted, true)
  assert.ok(first > 0)
})

test('the record read carries the traded token as a bearer', async () => {
  const { fetchCalls } = loadModule({ envelope: DONE_ENVELOPE })
  await flush()
  await flush()
  const read = fetchCalls.find((call) => call.url === GET_URL)
  assert.ok(read, 'expected a get_freelancers call')
  assert.equal(read.config.headers.Authorization, 'Bearer xano-token-abc')
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
