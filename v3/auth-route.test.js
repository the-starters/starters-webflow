const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./auth-route.js'), 'utf8')
const routeGuardSource = fs.readFileSync(
  require.resolve('./route-guard.js'),
  'utf8',
)

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const STATUS_URL =
  XANO + '/api:KZf7nFnk/starters_onboarding/get_build_profile_status'
// The paid-Brand mirror of the funnel read (2026-08-06).
const BRAND_STATUS_URL =
  XANO + '/api:KZf7nFnk/starters_onboarding/get_brand_profile_status'
const BRAND_MARKER_KEY = 'thestarters:v3-brand-profile-completed'
const TIMING_KEY = 'thestarters:v3-auth-route-timing'
// The endpoint the funnel check used to read. Still stubbed so "it is never
// requested any more" is an assertion about behaviour rather than about a stub
// that would have thrown anyway.
const LEGACY_GET_URL =
  XANO + '/api:KZf7nFnk/starters_onboarding/get_freelancers'

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
// The 282-of-955 case: the row was created when the member started Build profile
// and never submitted it, so profile_type_30 is empty. Row-existence used to read
// this as "past Build profile" and sent the member on to onboarding.
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
// What the pre-migration code would have read for UNFINISHED_WITH_ROW.
const LEGACY_ROW_EXISTS_ENVELOPE = {
  freelancer: [{ id: 12, onboarding_done: false }],
}

// get_brand_profile_status bodies. Existing brands are grandfathered
// `brand_profile_done: true`; a new signup reads false until they submit the
// /complete-profile form and the Memberstack webhook stamps brands_v3.
const BRAND_DONE = { has_record: true, brand_profile_done: true }
const BRAND_NOT_DONE = { has_record: true, brand_profile_done: false }
const BRAND_NO_RECORD = { has_record: false, brand_profile_done: false }

function plan(planId) {
  return { active: true, planId }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Opt-in deterministic clock (`clock: true`), so the 8s onboarding-check budget
 * is testable without waiting for it. Tests that do not ask for it keep the
 * real timers the existing Memberstack-delay cases rely on.
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

// A 200 whose body is not JSON. The router's `.json().catch(() => null)` turns
// this into a null payload, which must read as inconclusive rather than as a
// funnel state.
function malformedJsonResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
  }
}

function loadRouter(options = {}) {
  const attributes = {}
  // One record per matched form so a test can tell the login form apart from the
  // signup form; both also write into the shared `attributes` bag the older
  // assertions read.
  const formAttributes = { login: {}, signup: {} }
  function makeForm(kind) {
    const listeners = {}
    return {
      kind,
      hasListener(name) {
        return typeof listeners[name] === 'function'
      },
      setAttribute(name, value) {
        formAttributes[kind][name] = value
        attributes[name] = value
      },
      addEventListener(name, callback) {
        listeners[name] = callback
      },
      dispatch(name, event) {
        if (listeners[name]) listeners[name](event)
      },
    }
  }
  const forms = [makeForm('login'), makeForm('signup')]
  const storage = new Map()
  if (options.storedDestination) {
    storage.set('thestarters:v3-auth-next', options.storedDestination)
  }
  if (options.timingReceipt) {
    storage.set(TIMING_KEY, JSON.stringify(options.timingReceipt))
  }
  // The same-tab completion marker v3/brand-account-controller.js writes.
  if (options.brandMarker !== undefined) {
    storage.set(BRAND_MARKER_KEY, options.brandMarker)
  }
  const location = {
    hostname: options.hostname || 'the-starters-3-0.webflow.io',
    origin: `https://${options.hostname || 'the-starters-3-0.webflow.io'}`,
    pathname: options.pathname || '/test',
    search: options.search || '',
    replace(value) {
      location.replaced = value
    },
  }
  const sessionStorage = {
    getItem(key) {
      if (options.storageFailure === 'get') throw new DOMException('', 'SecurityError')
      return storage.get(key) || null
    },
    removeItem(key) {
      if (options.storageFailure === 'remove') {
        throw new DOMException('', 'SecurityError')
      }
      storage.delete(key)
    },
    setItem(key, value) {
      if (options.storageFailure === 'set') throw new DOMException('', 'SecurityError')
      storage.set(key, value)
    },
  }
  const clock = options.clock ? makeClock() : null
  const fetchCalls = []
  const aborted = []
  const logs = { info: [], warn: [], error: [] }
  const marks = []
  const events = []
  let getCurrentMemberCalls = 0

  // Only wired when a test asks for Xano (`xano: {...}`). Everything else keeps
  // a window without `fetch`, which is exactly how the funnel check behaves in
  // a browser that cannot reach Xano: it fails open.
  const xano = options.xano || {}
  async function fetchStub(url, config = {}) {
    fetchCalls.push({ url: String(url), config })

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

    if (String(url) === STATUS_URL) {
      if (xano.getNeverSettles) return new Promise(() => {})
      if (xano.getDelayMs) {
        await new Promise((resolve) => window.setTimeout(resolve, xano.getDelayMs))
      }
      if (xano.getRejects) throw new Error('get network failure')
      if (xano.getStatus) {
        return jsonResponse(null, { ok: false, status: xano.getStatus })
      }
      if (xano.getMalformedJson) return malformedJsonResponse()
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(xano, 'statusBody')
          ? xano.statusBody
          : ONBOARDED,
      )
    }

    if (String(url) === BRAND_STATUS_URL) {
      if (xano.brandNeverSettles) return new Promise(() => {})
      if (xano.brandDelayMs) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, xano.brandDelayMs),
        )
      }
      if (xano.brandRejects) throw new Error('brand get network failure')
      if (xano.brandStatus) {
        return jsonResponse(null, { ok: false, status: xano.brandStatus })
      }
      if (xano.brandMalformedJson) return malformedJsonResponse()
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(xano, 'brandStatusBody')
          ? xano.brandStatusBody
          : BRAND_DONE,
      )
    }

    // Answerable on purpose (see LEGACY_GET_URL): the pre-migration router would
    // get a usable row-exists envelope here, so a test that asserts the new
    // destination really is asserting the new signal.
    if (String(url) === LEGACY_GET_URL) {
      return jsonResponse(LEGACY_ROW_EXISTS_ENVELOPE)
    }

    throw new Error('unexpected fetch: ' + url)
  }

  const window = {
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.name = name
        this.detail = init.detail
      }
    },
    URL,
    URLSearchParams,
    dispatchEvent(event) {
      events.push(event)
    },
    location,
    performance: {
      mark(name) {
        marks.push(name)
      },
    },
    sessionStorage,
    setInterval: clock ? clock.setInterval : setInterval,
    setTimeout: clock ? clock.setTimeout : setTimeout,
    clearInterval: clock ? clock.clearInterval : clearInterval,
    clearTimeout: clock ? clock.clearTimeout : clearTimeout,
  }
  if (options.xano) {
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
    return {
      getCurrentMember: async () => {
        getCurrentMemberCalls += 1
        return { data: member }
      },
      getMemberCookie: async () => {
        if (options.cookieRejects) throw new Error('memberstack failure')
        return options.loggedOutCookie ? null : options.memberCookie || 'ms-jwt'
      },
    }
  }
  if (options.delayedMember) {
    window.setTimeout(() => {
      window.$memberstackDom = memberstackFor(options.delayedMember)
    }, options.memberstackDelayMs || 25)
  } else if (Object.prototype.hasOwnProperty.call(options, 'member')) {
    // `member: null` is Memberstack present with nobody signed in.
    window.$memberstackDom = memberstackFor(options.member)
  }
  if (Object.prototype.hasOwnProperty.call(options, 'memberReady')) {
    window.memberReady = options.memberReady
  }
  const documentListeners = {}
  const document = {
    readyState: options.documentReadyState || 'complete',
    documentElement: {
      setAttribute(name, value) {
        attributes[name] = value
      },
    },
    addEventListener(name, callback) {
      documentListeners[name] = callback
    },
    // The login forms live in the body. While the parser is still running they
    // are not in the tree yet, which is what a head-injected script sees.
    // The selector is really evaluated against each form's `data-ms-form` kind,
    // so a query that widens past the login form fails the tests below instead
    // of being handed every form regardless of what it asked for.
    querySelectorAll(selector) {
      if (document.readyState === 'loading') return []
      const kinds = (
        String(selector).match(/\[data-ms-form="([\w-]+)"\]/g) || []
      ).map((token) => token.slice('[data-ms-form="'.length, -2))
      assert.ok(kinds.length, 'unsupported form selector: ' + selector)
      return forms.filter((form) => kinds.includes(form.kind))
    },
  }
  function finishParsing() {
    document.readyState = 'interactive'
    if (documentListeners.DOMContentLoaded) documentListeners.DOMContentLoaded()
  }

  class FakeDate extends Date {
    static now() {
      return clock.now()
    }
  }

  const context = {
    console: {
      error: (message) => logs.error.push(message),
      warn: (message) => logs.warn.push(message),
      info: (message) => logs.info.push(message),
    },
    CustomEvent: window.CustomEvent,
    URL,
    URLSearchParams,
    document,
    window,
  }
  if (clock) context.Date = FakeDate
  vm.createContext(context)
  if (!options.roleContractMissing) {
    vm.runInContext(routeGuardSource, context)
  }
  vm.runInContext(source, context)

  return {
    api: window.StartersV3AuthRouter,
    aborted,
    attributes,
    formAttributes,
    clock,
    fetchCalls,
    finishParsing,
    forms,
    getCurrentMemberCalls: () => getCurrentMemberCalls,
    location,
    logs,
    marks,
    events,
    storage,
    window,
  }
}

const urlsOf = (calls) => calls.map((call) => call.url)
const callsTo = (calls, url) => calls.filter((call) => call.url === url)
const talentMember = () => ({
  id: 'member-talent',
  planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
})

test('maps stable active plan IDs to application roles', () => {
  const { api } = loadRouter()

  assert.equal(
    api.memberRole({
      planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
    }),
    'talent',
  )
  assert.equal(
    api.memberRole({
      planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
    }),
    'brand-paid',
  )
})

test('paid Brand wins over Brand Free during a valid same-family upgrade', () => {
  const { api } = loadRouter()
  const member = {
    planConnections: [
      plan('pln_free-plan-f6kn0dxz'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }

  assert.equal(api.memberRole(member), 'brand-paid')
  assert.equal(api.destinationFor(member), '/brand-dashboard')
})

test('cross-family Talent and Brand plans fail closed', () => {
  const { api } = loadRouter()
  const member = {
    planConnections: [
      plan('pln_dorxata-test-free-plan-dvcg0k8o'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }

  assert.equal(api.memberRole(member), null)
  assert.equal(api.memberRoleError(member), 'conflicting-plan-roles')
  assert.equal(api.destinationFor(member), null)
})

test('uses role defaults for Talent, paid Brand, and free Brand', () => {
  const { api } = loadRouter()

  assert.equal(
    api.destinationFor({
      planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
    }),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor({
      planConnections: [plan('pln_new-paid-plan-463h04ph')],
    }),
    '/brand-dashboard',
  )
  // Free Brand with no completed quiz -> /quiz.
  assert.equal(
    api.destinationFor({ planConnections: [plan('pln_free-plan-f6kn0dxz')] }),
    '/quiz',
  )
})

test('free Brand routes to /quiz until the quiz is completed, then /quiz-results', () => {
  const { api } = loadRouter()
  const notDone = { planConnections: [plan('pln_free-plan-f6kn0dxz')] }
  const done = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
    customFields: { 'starter-quiz': '{"status":"ready"}' },
  }

  assert.equal(api.hasCompletedQuiz(notDone), false)
  assert.equal(api.hasCompletedQuiz(done), true)
  assert.equal(api.destinationFor(notDone), '/quiz')
  assert.equal(api.destinationFor(done), '/quiz-results')
  // An empty custom field is not "completed".
  assert.equal(
    api.hasCompletedQuiz({ customFields: { 'starter-quiz': '   ' } }),
    false,
  )
  // A requested /quiz or /quiz-results still survives for free Brand.
  assert.equal(api.destinationFor(notDone, '/quiz-results'), '/quiz-results')
  assert.equal(api.destinationFor(done, '/quiz'), '/quiz')
})

test('preserves only same-origin destinations allowed for the member role', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }

  assert.equal(
    api.destinationFor(talent, '/starter-edit-profile?from=beta'),
    '/starter-edit-profile?from=beta',
  )
  assert.equal(
    api.destinationFor(talent, '/brand-dashboard'),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor(talent, 'https://evil.example/steal'),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor(talent, '//evil.example/steal'),
    '/starter-dashboard',
  )
})

test('canonical /dashboard next always resolves to the role-specific home', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }
  const paidBrand = {
    planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
  }
  const completedFreeBrand = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
    customFields: { 'starter-quiz': '{"status":"ready"}' },
  }

  assert.equal(api.destinationFor(talent, '/dashboard'), '/starter-dashboard')
  assert.equal(api.destinationFor(paidBrand, '/dashboard'), '/brand-dashboard')
  assert.equal(api.destinationFor(completedFreeBrand, '/dashboard'), '/quiz-results')
})

test('preserves the V3 Talent routes defined by the access matrix', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }

  for (const pathname of [
    '/build-profile/select-profile',
    '/build-profile/full-profile',
    '/build-profile/consult',
    '/opportunities-freelancer-view',
  ]) {
    assert.equal(api.destinationFor(talent, pathname), pathname)
  }
})

test('allows Brand tiers into All Starters but keeps Messages paid-only', () => {
  const { api } = loadRouter()
  const paidBrand = {
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }
  const freeBrand = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
  }

  assert.equal(api.destinationFor(paidBrand, '/all-starters'), '/all-starters')
  assert.equal(api.destinationFor(freeBrand, '/all-starters'), '/all-starters')
  assert.equal(api.destinationFor(paidBrand, '/messages'), '/messages')
  assert.equal(api.destinationFor(freeBrand, '/messages'), '/quiz')
})

test('deep-links the merged /opportunities feed for Talent and paid Brand only', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }
  const paidBrand = {
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }
  const freeBrand = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
  }

  assert.equal(api.destinationFor(talent, '/opportunities'), '/opportunities')
  assert.equal(api.destinationFor(talent, '/opportunities/'), '/opportunities/')
  assert.equal(api.destinationFor(paidBrand, '/opportunities'), '/opportunities')
  assert.equal(
    api.destinationFor(paidBrand, '/opportunities/'),
    '/opportunities/',
  )
  assert.equal(api.destinationFor(freeBrand, '/opportunities'), '/quiz')
  assert.equal(api.destinationFor(freeBrand, '/opportunities/'), '/quiz')
})

test('allows opportunity details only for Talent and paid Brand', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }
  const paidBrand = {
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }
  const freeBrand = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
  }

  assert.equal(
    api.destinationFor(talent, '/opportunities/product-designer?source=saved'),
    '/opportunities/product-designer?source=saved',
  )
  assert.equal(
    api.destinationFor(paidBrand, '/opportunities/product-designer'),
    '/opportunities/product-designer',
  )
  assert.equal(
    api.destinationFor(freeBrand, '/opportunities/product-designer'),
    '/quiz',
  )
  assert.equal(
    api.destinationFor(talent, '/opportunities/product-designer/apply'),
    '/starter-dashboard',
  )
})

test('allows opportunity creation only for paid Brand', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }
  const paidBrand = {
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }
  const freeBrand = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
  }

  assert.equal(
    api.destinationFor(paidBrand, '/opportunities---create?from=dashboard'),
    '/opportunities---create?from=dashboard',
  )
  assert.equal(
    api.destinationFor(talent, '/opportunities---create'),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor(freeBrand, '/opportunities---create'),
    '/quiz',
  )
})

// --- Guard/router parity ------------------------------------------------------

/**
 * route-guard.js duplicates its tables on purpose (each browser script stands
 * alone), so the two files can silently drift: the guard sends a logged-out
 * visitor to /login?next=<guarded path> and the router refuses to hand that
 * path back, dropping the member on the role home instead. This suite asserts
 * the round trip closes for every guarded page, not just the ones someone
 * remembered to list.
 *
 * The guard exports `pageRolesFor`/`isGuardedPath` but no way to enumerate
 * PAGE_ROLES, and a hardcoded copy here would drift exactly like the tables it
 * is meant to police. So the paths are parsed out of the route-guard source
 * text and then re-validated through the live `pageRolesFor` API — a new guard
 * entry is picked up automatically, and a parse that stops matching the real
 * literal fails loudly rather than silently checking nothing.
 */
function parseGuardedRoutes() {
  const pageRolesBlock = routeGuardSource.match(
    /var PAGE_ROLES = \{\n([\s\S]*?)\n {2}\}\n/,
  )
  assert.ok(pageRolesBlock, 'PAGE_ROLES literal not found in route-guard.js')
  const exact = [...pageRolesBlock[1].matchAll(/^ {4}'([^']+)': \[([^\]]*)\],$/gm)].map(
    ([, pathname, roles]) => ({
      pathname,
      roles: [...roles.matchAll(/'([^']+)'/g)].map(([, role]) => role),
    }),
  )

  const prefixBlock = routeGuardSource.match(
    /var PAGE_ROLE_PREFIXES = \[\n([\s\S]*?)\n {2}\]\n/,
  )
  assert.ok(
    prefixBlock,
    'PAGE_ROLE_PREFIXES literal not found in route-guard.js',
  )
  const prefixes = [
    ...prefixBlock[1].matchAll(/\{ prefix: '([^']+)', roles: \[([^\]]*)\] \}/g),
  ].map(([, prefix, roles]) => ({
    prefix,
    roles: [...roles.matchAll(/'([^']+)'/g)].map(([, role]) => role),
  }))

  return { exact, prefixes }
}

const memberForRole = {
  talent: () => ({
    id: 'member-talent',
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }),
  'brand-paid': () => ({
    id: 'member-brand-paid',
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }),
  'brand-free': () => ({
    id: 'member-brand-free',
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
  }),
}

test('the parsed guarded-route tables match the live route-guard API', () => {
  const { window } = loadRouter()
  const guard = window.StartersV3RouteGuard
  const { exact, prefixes } = parseGuardedRoutes()

  assert.ok(exact.length >= 15, 'parsed too few PAGE_ROLES entries')
  assert.ok(prefixes.length >= 1, 'parsed no PAGE_ROLE_PREFIXES entries')
  // Spread the guard's arrays: they are built inside the vm realm, so a strict
  // deep comparison against a host array fails on the prototype alone.
  for (const { pathname, roles } of exact) {
    assert.deepEqual([...guard.pageRolesFor(pathname)], roles, pathname)
  }
  for (const { prefix, roles } of prefixes) {
    assert.deepEqual(
      [...guard.pageRolesFor(prefix + 'parity-slug')],
      roles,
      prefix,
    )
  }
  for (const role of new Set(
    exact.flatMap((entry) => entry.roles).concat(prefixes.flatMap((p) => p.roles)),
  )) {
    assert.ok(memberForRole[role], 'no fixture member for role ' + role)
  }
})

test('every guarded page is an allowed post-login next for the roles that may view it', () => {
  const { api } = loadRouter()
  const { exact, prefixes } = parseGuardedRoutes()

  // /dashboard and /dashboard/ carry an empty allowlist by design — no role
  // stays there, and the router special-cases them to the role home — so they
  // contribute no round trips to assert.
  for (const pathname of ['/dashboard', '/dashboard/']) {
    const entry = exact.find((candidate) => candidate.pathname === pathname)
    assert.ok(entry, pathname + ' missing from PAGE_ROLES')
    assert.deepEqual(entry.roles, [], pathname + ' is no longer allowlist-empty')
  }

  let assertions = 0
  for (const { pathname, roles } of exact) {
    for (const role of roles) {
      assert.equal(
        api.destinationFor(memberForRole[role](), pathname),
        pathname,
        role + ' cannot return to ' + pathname + ' after login',
      )
      assertions += 1
    }
  }
  // One representative slug per allowed role is enough for the prefix rule; the
  // exhaustive slug behaviour is covered by the opportunity-detail tests above.
  for (const { prefix, roles } of prefixes) {
    for (const role of roles) {
      const pathname = prefix + 'parity-slug'
      assert.equal(
        api.destinationFor(memberForRole[role](), pathname),
        pathname,
        role + ' cannot return to ' + pathname + ' after login',
      )
      assertions += 1
    }
  }
  assert.ok(assertions >= 15, 'the parity sweep checked suspiciously little')
})

test('returns no destination for an unmapped plan', () => {
  const { api } = loadRouter()

  assert.equal(
    api.destinationFor({ planConnections: [plan('pln_unknown')] }),
    null,
  )
})

test('V3 login form overrides shared Memberstack redirects with auth route', () => {
  const { attributes, storage } = loadRouter({
    pathname: '/login',
    search: '?next=%2Fmessages',
  })

  assert.equal(attributes['data-ms-redirect'], '/auth-route')
  assert.equal(storage.get('thestarters:v3-auth-next'), '/messages')
})

test('login and signup forms carry the plain redirect attribute for Enter-key submits', () => {
  const { formAttributes } = loadRouter({ pathname: '/login' })

  assert.equal(formAttributes.login['data-ms-redirect'], '/auth-route')
  assert.equal(formAttributes.login.redirect, '/auth-route')
  assert.equal(formAttributes.signup['data-ms-redirect'], '/auth-route')
  assert.equal(formAttributes.signup.redirect, '/auth-route')
})

test('login form redirect is configured when session storage writes fail', () => {
  const { attributes, storage } = loadRouter({
    pathname: '/login',
    search: '?next=%2Fmessages',
    storageFailure: 'set',
  })

  assert.equal(attributes['data-ms-redirect'], '/auth-route')
  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('login form redirect is configured when session storage reads fail', () => {
  const { attributes } = loadRouter({
    pathname: '/login',
    storageFailure: 'get',
  })

  assert.equal(attributes['data-ms-redirect'], '/auth-route')
})

test('fresh login clears an abandoned stored destination', () => {
  const { storage } = loadRouter({
    pathname: '/login',
    storedDestination: '/messages',
  })

  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('login with an invalid next clears an abandoned stored destination', () => {
  const { storage } = loadRouter({
    pathname: '/login',
    search: '?next=https%3A%2F%2Fevil.example%2Fsteal',
    storedDestination: '/messages',
  })

  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('does not change login forms on an unapproved hostname', () => {
  const { attributes } = loadRouter({
    hostname: 'attacker.example',
    pathname: '/login',
  })

  assert.equal(attributes['data-ms-redirect'], undefined)
})

// --- Multiple login pages (2026-08-03) ----------------------------------------

test('both V3 login pages are in scope and nothing else is', () => {
  const { api } = loadRouter()
  // Spread it: the array is built inside the vm realm, so a strict deep
  // comparison against a host array fails on the prototype alone.
  assert.deepEqual([...api.loginPaths], ['/login', '/starter-login'])
  assert.equal(api.isLoginPath('/login'), true)
  assert.equal(api.isLoginPath('/starter-login'), true)
  // /sign-up is deliberately excluded: v3/starters-ms-redirect.js owns signup
  // form redirects through its own markers and skips any form that already
  // carries a non-empty `redirect`, so configuring it here would disable that.
  assert.equal(api.isLoginPath('/sign-up'), false)
  assert.equal(api.isLoginPath('/auth-route'), false)
  assert.equal(api.isLoginPath('/login/'), false)
  assert.equal(api.isLoginPath('/starter-login/extra'), false)
})

test('/starter-login forms are configured exactly like /login', () => {
  const { formAttributes } = loadRouter({ pathname: '/starter-login' })

  for (const kind of ['login', 'signup']) {
    assert.equal(formAttributes[kind]['data-ms-redirect'], '/auth-route', kind)
    assert.equal(formAttributes[kind].redirect, '/auth-route', kind)
  }
})

test('/starter-login stores a valid next for the /auth-route hop', () => {
  const { storage } = loadRouter({
    pathname: '/starter-login',
    search: '?next=%2Fmessages',
  })

  assert.equal(storage.get('thestarters:v3-auth-next'), '/messages')
})

test('/starter-login clears an abandoned stored destination when next is invalid', () => {
  const { storage } = loadRouter({
    pathname: '/starter-login',
    search: '?next=https%3A%2F%2Fevil.example%2Fsteal',
    storedDestination: '/messages',
  })

  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('/starter-login does not route; it only configures forms', async () => {
  const { location } = loadRouter({
    pathname: '/starter-login',
    member: talentMember(),
  })

  await flush()
  assert.equal(location.replaced, undefined)
})

test('does not change /starter-login forms on an unapproved hostname', () => {
  const { attributes } = loadRouter({
    hostname: 'attacker.example',
    pathname: '/starter-login',
  })

  assert.equal(attributes['data-ms-redirect'], undefined)
})

test('the new funnel pages are allowed next destinations for their own role', () => {
  const { api } = loadRouter()
  const talent = talentMember()
  const brandPaid = {
    id: 'member-brand-paid',
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }

  for (const path of ['/generate-invoice', '/generate-invoice/']) {
    assert.equal(api.destinationFor(talent, path), path)
    // Not the other role's page: a Brand asking for it lands on its own home.
    assert.equal(api.destinationFor(brandPaid, path), '/brand-dashboard')
  }
})

// Memberstack's `restrict-pages` gated group owns /complete-profile outright
// (decision 2026-08-03) and redirects a stranger to /login with no `?next=`, so
// there is no round trip for the router to close. route-guard.js does not list
// the page either; the member-home bounce pages pick up whoever lands on /login.
test('/complete-profile is not an allowed next destination for any role', () => {
  const { api } = loadRouter()
  const brandPaid = {
    id: 'member-brand-paid',
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }

  for (const path of ['/complete-profile', '/complete-profile/']) {
    assert.equal(api.destinationFor(brandPaid, path), '/brand-dashboard')
    assert.equal(api.destinationFor(talentMember(), path), '/starter-dashboard')
  }
})

test('auth route sends a paid Brand to the confirmed V3 Brand dashboard', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-brand',
      planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(location.replaced, '/brand-dashboard')
})

test('auth route consumes /dashboard next without creating a redirect loop', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/dashboard',
    member: {
      id: 'member-talent',
      planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(location.replaced, '/starter-dashboard')
})

test('auth route waits for delayed Memberstack before resolving /dashboard', async () => {
  const { location, attributes } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/dashboard',
    delayedMember: {
      id: 'member-test-brand',
      planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
    },
    memberstackDelayMs: 25,
  })

  assert.equal(location.replaced, undefined)
  assert.equal(attributes['data-auth-route-error'], undefined)
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(location.replaced, '/brand-dashboard')
})

// Identity comes from one direct getCurrentMember() read. `window.memberReady`
// on this site resolves an empty object for every visitor, logged in or not, so
// its value carries no identity to reuse — see
// global-embeds/session-video/README.md, which records a module that shipped
// inert for its whole life on exactly that mistake.
test('auth route resolves the member with exactly one direct Memberstack read', async () => {
  const harness = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: ONBOARDED },
  })

  await flush()
  assert.equal(harness.location.replaced, '/starter-dashboard')
  assert.equal(harness.getCurrentMemberCalls(), 1)
  assert.deepEqual(
    harness.fetchCalls.map((call) => call.url.replace(/\?token=.*/, '?token=[redacted]')),
    [TRADE_URL + '?token=[redacted]', STATUS_URL],
  )
})

test('the site-head memberReady value is never treated as the member', async () => {
  for (const memberReady of [
    // What this site actually resolves, for every visitor.
    Promise.resolve({}),
    // A promise that never settles must not strand /auth-route on its loading
    // state: nothing here may await it.
    new Promise(() => {}),
    Promise.reject(new Error('memberReady failed')).catch(() => ({})),
  ]) {
    const harness = loadRouter({
      pathname: '/auth-route',
      member: talentMember(),
      memberReady,
      xano: { statusBody: ONBOARDED },
    })

    await flush()
    assert.equal(harness.location.replaced, '/starter-dashboard')
    assert.equal(harness.getCurrentMemberCalls(), 1)
  }
})

test('an unsettled memberReady does not strand a late-Memberstack login', async () => {
  const harness = loadRouter({
    pathname: '/auth-route',
    delayedMember: talentMember(),
    memberstackDelayMs: 25,
    memberReady: new Promise(() => {}),
  })

  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(harness.location.replaced, '/starter-dashboard')
  assert.equal(harness.getCurrentMemberCalls(), 1)
})

test('router timing marks contain stage names only', async () => {
  const member = talentMember()
  const harness = loadRouter({
    pathname: '/auth-route',
    member,
    xano: { statusBody: ONBOARDED },
  })

  await flush()
  assert.deepEqual(harness.marks, [
    'starters:v3-auth-route:router-boot',
    'starters:v3-auth-route:memberstack-ready',
    'starters:v3-auth-route:member-snapshot',
    'starters:v3-auth-route:token-trade-start',
    'starters:v3-auth-route:token-trade-end',
    'starters:v3-auth-route:status-read-start',
    'starters:v3-auth-route:status-read-end',
    'starters:v3-auth-route:redirect-request',
  ])
  const serialized = JSON.stringify(harness.events)
  assert.equal(serialized.includes(member.id), false)
  assert.equal(serialized.includes('ms-jwt'), false)
  assert.equal(serialized.includes('xano-token-abc'), false)
})

test('login submit starts the cross-navigation timing receipt', () => {
  const harness = loadRouter({ pathname: '/login' })

  harness.forms[0].dispatch('submit')
  const receipt = JSON.parse(harness.storage.get(TIMING_KEY))
  assert.equal(typeof receipt.startedAt, 'number')
  assert.deepEqual(Object.keys(receipt), ['startedAt'])
  assert.ok(
    harness.marks.includes('starters:v3-auth-route:login-submit'),
  )
})

// `closest` really evaluates the production selector against the control, so
// widening the selector fails these cases instead of passing on a double that
// answers "matched" no matter what it was asked.
function matchesSimpleSelector(node, simple) {
  const parts = simple.match(/^([a-z]+)?((?:\.[\w-]+|\[[^\]]+\])*)$/)
  assert.ok(parts, 'unsupported selector: ' + simple)
  if (parts[1] && parts[1] !== node.tag) return false
  return (parts[2].match(/\.[\w-]+|\[[^\]]+\]/g) || []).every((qualifier) => {
    if (qualifier.startsWith('.')) {
      return node.classes.includes(qualifier.slice(1))
    }
    const pair = qualifier.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/)
    assert.ok(pair, 'unsupported attribute selector: ' + qualifier)
    const value = node.attributes[pair[1]]
    if (value === undefined) return false
    return pair[2] === undefined || value === pair[2]
  })
}

function formControl({ tag = 'button', classes = [], attributes = {} } = {}) {
  const node = { tag, classes, attributes }
  node.closest = (selector) =>
    selector
      .split(',')
      .map((simple) => simple.trim())
      .filter(Boolean)
      .some((simple) => matchesSimpleSelector(node, simple))
      ? node
      : null
  return node
}

test('a submit-control click restarts timing after a rejected attempt', () => {
  for (const control of [
    formControl({ tag: 'button', attributes: { type: 'submit' } }),
    formControl({ tag: 'input', attributes: { type: 'submit' } }),
    formControl({
      tag: 'div',
      attributes: { 'data-ms-button': 'submit' },
    }),
  ]) {
    const harness = loadRouter({ pathname: '/login' })
    harness.storage.set(TIMING_KEY, JSON.stringify({ startedAt: 1 }))

    harness.forms[0].dispatch('click', { target: control })

    const receipt = JSON.parse(harness.storage.get(TIMING_KEY))
    assert.notEqual(receipt.startedAt, 1, control.tag)
    assert.deepEqual(Object.keys(receipt), ['startedAt'], control.tag)
    assert.ok(
      harness.marks.includes('starters:v3-auth-route:login-submit'),
      control.tag,
    )
  }
})

// `[data-ms-auth-provider]` is Memberstack's click-driven provider control (an
// anchor — see quiz-main/quiz-main.js), so it completes a login without ever
// firing submit on this form. Without a restart here, the provider attempt
// inherits the `startedAt` of an earlier rejected password on the same page
// visit, and /auth-route confirms that stale receipt as one duration.
test('a provider-control click restarts timing a rejected password left behind', () => {
  for (const control of [
    formControl({ tag: 'a', attributes: { 'data-ms-auth-provider': 'google' } }),
    formControl({
      tag: 'div',
      classes: ['clickable_btn'],
      attributes: { 'data-ms-auth-provider': 'facebook' },
    }),
  ]) {
    const harness = loadRouter({ pathname: '/login' })
    const rejectedAt = 1700000000000
    harness.forms[0].dispatch('submit')
    harness.storage.set(TIMING_KEY, JSON.stringify({ startedAt: rejectedAt }))

    harness.forms[0].dispatch('click', { target: control })

    const receipt = JSON.parse(harness.storage.get(TIMING_KEY))
    assert.notEqual(receipt.startedAt, rejectedAt, control.tag)
    assert.deepEqual(Object.keys(receipt), ['startedAt'], control.tag)
  }
})

// `.clickable_btn` is the generic Webflow Clickable Wrap overlay and sits on
// non-submitting buttons all over this site, including the login CTA while the
// password rules still fail. A click on one is not a login attempt, so it must
// not overwrite the receipt or emit a login-submit mark.
test('a non-submit control click leaves the timing receipt alone', () => {
  for (const control of [
    formControl({ tag: 'button', classes: ['clickable_btn'] }),
    formControl({
      tag: 'button',
      classes: ['clickable_btn'],
      attributes: { type: 'button' },
    }),
    formControl({ tag: 'a', classes: ['clickable_link'] }),
    formControl({ tag: 'button', attributes: { type: 'reset' } }),
    formControl({ tag: 'div', attributes: { 'data-ms-button': 'google' } }),
  ]) {
    const harness = loadRouter({ pathname: '/login' })
    harness.storage.set(TIMING_KEY, JSON.stringify({ startedAt: 1 }))

    harness.forms[0].dispatch('click', { target: control })

    const label = control.tag + '.' + control.classes.join('.')
    assert.equal(
      JSON.parse(harness.storage.get(TIMING_KEY)).startedAt,
      1,
      label,
    )
    assert.equal(
      harness.marks.includes('starters:v3-auth-route:login-submit'),
      false,
      label,
    )
  }
})

// /login carries a signup modal form, and it gets the same /auth-route redirect
// attributes so its members route through the router too. It must NOT start a
// receipt: a signup spans account creation, Turnstile, and plan assignment, so
// reporting it under the `login-submit` stage inflates the login-to-destination
// duration this receipt exists to measure.
test('a signup form on a login page starts no login timing receipt', () => {
  const harness = loadRouter({ pathname: '/login' })
  const signup = harness.forms[1]

  assert.deepEqual(harness.formAttributes.signup, {
    'data-ms-redirect': '/auth-route',
    redirect: '/auth-route',
  })
  assert.equal(signup.hasListener('submit'), false)
  assert.equal(signup.hasListener('click'), false)

  signup.dispatch('submit')
  signup.dispatch('click', {
    target: formControl({ tag: 'button', attributes: { type: 'submit' } }),
  })

  assert.equal(harness.storage.has(TIMING_KEY), false)
  assert.equal(
    harness.marks.includes('starters:v3-auth-route:login-submit'),
    false,
  )

  // The login form on the same page still measures, so the scoping is the
  // form's kind and not a disabled feature.
  harness.forms[0].dispatch('submit')
  assert.equal(harness.storage.has(TIMING_KEY), true)
})

// The loader inserts this file dynamically from the site head, so it can run
// before the parser reaches the login form. Configuring nothing would leave the
// form on the shared Memberstack plan redirect and skip /auth-route entirely.
test('a login page still parsing when the router boots is configured on DOMContentLoaded', () => {
  const harness = loadRouter({
    pathname: '/login',
    documentReadyState: 'loading',
  })

  assert.deepEqual(harness.formAttributes.login, {})

  harness.finishParsing()

  assert.deepEqual(harness.formAttributes.login, {
    'data-ms-redirect': '/auth-route',
    redirect: '/auth-route',
  })
  assert.deepEqual(harness.formAttributes.signup, {
    'data-ms-redirect': '/auth-route',
    redirect: '/auth-route',
  })
  harness.forms[0].dispatch('submit')
  assert.equal(harness.storage.has(TIMING_KEY), true)
})

test('a login page boot discards a receipt from an attempt that never routed', () => {
  const harness = loadRouter({
    pathname: '/login',
    timingReceipt: { startedAt: Date.now() },
  })

  assert.equal(harness.storage.has(TIMING_KEY), false)
})

test('auth route confirms the receipt only as it hands off to the destination', async () => {
  const startedAt = Date.now()
  const member = talentMember()
  const harness = loadRouter({
    pathname: '/auth-route',
    member,
    memberReady: Promise.resolve(member),
    xano: { statusBody: ONBOARDED },
    timingReceipt: { startedAt },
  })

  await flush()
  assert.equal(harness.location.replaced, '/starter-dashboard')
  const receipt = JSON.parse(harness.storage.get(TIMING_KEY))
  assert.equal(receipt.startedAt, startedAt)
  assert.equal(typeof receipt.redirectedAt, 'number')
  assert.deepEqual(Object.keys(receipt).sort(), ['redirectedAt', 'startedAt'])
})

test('a logged-out bounce back to /login discards the receipt unconfirmed', async () => {
  const harness = loadRouter({
    pathname: '/auth-route',
    member: null,
    timingReceipt: { startedAt: Date.now() },
  })

  await flush()
  assert.equal(harness.location.replaced, '/login')
  assert.equal(harness.storage.has(TIMING_KEY), false)
})

test('auth route preserves the stored destination from login', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/opportunities/product-designer?source=login',
    member: {
      id: 'member-talent',
      planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    location.replaced,
    '/opportunities/product-designer?source=login',
  )
})

test('auth route uses role default when session storage removal fails', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storageFailure: 'remove',
    member: {
      id: 'member-brand',
      planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(location.replaced, '/brand-dashboard')
})

test('auth route surfaces unmapped plans instead of silently routing home', async () => {
  const { attributes } = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-unknown',
      planConnections: [plan('pln_unknown')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(attributes['data-auth-route-error'], 'unmapped-plan')
})

test('auth route surfaces cross-family role conflicts instead of picking a dashboard', async () => {
  const { attributes, location } = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-conflict',
      planConnections: [
        plan('pln_dorxata-test-free-plan-dvcg0k8o'),
        plan('pln_new-paid-plan-463h04ph'),
      ],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(location.replaced, undefined)
  assert.equal(attributes['data-auth-route-error'], 'conflicting-plan-roles')
})

// --- Talent onboarding funnel -------------------------------------------------

test('/starter-onboarding is an allowed Talent next and stays Talent-only', () => {
  const { api } = loadRouter()
  const paidBrand = {
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }

  assert.equal(
    api.destinationFor(talentMember(), '/starter-onboarding'),
    '/starter-onboarding',
  )
  assert.equal(
    api.destinationFor(talentMember(), '/starter-onboarding?step=2'),
    '/starter-onboarding?step=2',
  )
  assert.equal(
    api.destinationFor(paidBrand, '/starter-onboarding'),
    '/brand-dashboard',
  )
})

test('the status body maps to a funnel position', () => {
  const { api } = loadRouter()

  assert.equal(api.funnelStateFrom(ONBOARDED), 'done')
  assert.equal(api.funnelStateFrom(NEEDS_ONBOARDING), 'onboarding')
  assert.equal(api.funnelStateFrom(UNFINISHED_WITH_ROW), 'build-profile')
  assert.equal(api.funnelStateFrom(NO_RECORD), 'build-profile')
})

test('only a literal false on build_profile_done means "still building"', () => {
  const { api } = loadRouter()

  // Here the distinction matters: 'build-profile' redirects, 'unknown' fails
  // open to the standard destination. A body the router cannot read must never
  // be turned into a redirect.
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
  const { api } = loadRouter()

  for (const onboarding_done of ['true', 1, {}, null, undefined]) {
    assert.equal(
      api.funnelStateFrom({ build_profile_done: true, onboarding_done }),
      'onboarding',
      String(onboarding_done),
    )
  }
})

test('a Talent member with no record at all is sent to Build profile', async () => {
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: NO_RECORD },
  })

  await flush()
  assert.equal(location.replaced, '/build-profile/select-profile')
  assert.ok(urlsOf(fetchCalls)[0].startsWith(TRADE_URL + '?token='))
  const reads = callsTo(fetchCalls, STATUS_URL)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].config.headers.Authorization, 'Bearer xano-token-abc')
})

/**
 * The 282-member regression guard. Before 2026-08-04 the signal was "a
 * freelancers_v3 row exists", so a member who started Build profile and never
 * submitted it read as finished and was routed on to /starter-onboarding. 282 of
 * 955 rows are in exactly that shape. They must be sent back to finish the step.
 */
test('a Talent member with a row but an unfinished build profile goes BACK to Build profile', async () => {
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: UNFINISHED_WITH_ROW },
  })

  await flush()
  assert.equal(
    location.replaced,
    '/build-profile/select-profile',
    'has_record true must not count as "past Build profile"',
  )
  // Proof the decision came from the new signal: the old endpoint, which is
  // answerable in this harness and would have said "row exists, go to
  // onboarding", was never asked.
  assert.equal(callsTo(fetchCalls, LEGACY_GET_URL).length, 0)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('the funnel read goes to get_build_profile_status, never to get_freelancers', async () => {
  const { fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: ONBOARDED },
  })

  await flush()
  const urls = urlsOf(fetchCalls)
  assert.equal(urls.length, 2, 'one token trade plus one status read')
  assert.ok(urls[0].startsWith(TRADE_URL + '?token='), urls[0])
  assert.equal(urls[1], STATUS_URL)
  assert.ok(
    !urls.some((url) => url.indexOf(LEGACY_GET_URL) === 0),
    'get_freelancers must no longer be requested',
  )
  // No inputs: the endpoint derives the member from the bearer token.
  const read = callsTo(fetchCalls, STATUS_URL)[0]
  assert.equal(read.config.method, undefined)
  assert.equal(read.config.body, undefined)
})

test('unfinished onboarding wins over a valid stored next and consumes it', async () => {
  const { location, storage } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    xano: { statusBody: NEEDS_ONBOARDING },
  })

  await flush()
  assert.equal(location.replaced, '/starter-onboarding')
  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('unfinished onboarding wins over a query next too', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    search: '?next=%2Fopportunities%2Fproduct-designer',
    member: talentMember(),
    xano: { statusBody: NEEDS_ONBOARDING },
  })

  await flush()
  assert.equal(location.replaced, '/starter-onboarding')
})

test('an unfinished build profile wins over a stored next and consumes it', async () => {
  const { location, storage } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    xano: { statusBody: UNFINISHED_WITH_ROW },
  })

  await flush()
  assert.equal(location.replaced, '/build-profile/select-profile')
  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('a finished Talent member keeps the requested next', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    xano: { statusBody: ONBOARDED },
  })

  await flush()
  assert.equal(location.replaced, '/messages')
})

test('a finished Talent member completes the /starter-onboarding round trip', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    search: '?next=%2Fstarter-onboarding',
    member: talentMember(),
    xano: { statusBody: ONBOARDED },
  })

  await flush()
  assert.equal(location.replaced, '/starter-onboarding')
})

test('a finished Talent member with no next lands on the Talent home', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: ONBOARDED },
  })

  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
})

test('a 401 or 500 on the status read fails open to the standard route', async () => {
  // 401 is the endpoint's own answer to a missing or expired Xano token. It must
  // never be read as a funnel position, and in particular must not send a
  // finished member back into the funnel.
  for (const getStatus of [401, 500]) {
    const { location, fetchCalls } = loadRouter({
      pathname: '/auth-route',
      storedDestination: '/messages',
      member: talentMember(),
      xano: { getStatus },
    })

    await flush()
    assert.equal(location.replaced, '/messages', String(getStatus))
    assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1, String(getStatus))
  }
})

test('a 200 with an unparseable body fails open to the standard route', async () => {
  const { location, logs } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    xano: { getMalformedJson: true },
  })

  await flush()
  assert.equal(location.replaced, '/messages')
  assert.ok(logs.info.some((line) => line.includes('unknown')))
})

test('a status body missing build_profile_done fails open, never to Build profile', async () => {
  for (const statusBody of [{}, { has_record: true }, 'nope', 42]) {
    const { location } = loadRouter({
      pathname: '/auth-route',
      storedDestination: '/messages',
      member: talentMember(),
      xano: { statusBody },
    })

    await flush()
    assert.equal(location.replaced, '/messages', JSON.stringify(statusBody))
  }
})

test('a rejected read, a failed trade, and a tokenless trade all fail open', async () => {
  const rejected = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { getRejects: true },
  })
  const tradeFailed = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { tradeStatus: 401 },
  })
  const tokenless = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { tradeBody: { nothing: true } },
  })

  await flush()
  assert.equal(rejected.location.replaced, '/starter-dashboard')
  assert.equal(tradeFailed.location.replaced, '/starter-dashboard')
  assert.equal(tokenless.location.replaced, '/starter-dashboard')
  assert.equal(callsTo(tradeFailed.fetchCalls, STATUS_URL).length, 0)
  assert.equal(callsTo(tokenless.fetchCalls, STATUS_URL).length, 0)
})

test('a member with no Memberstack cookie never reaches Xano and routes normally', async () => {
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    loggedOutCookie: true,
    xano: { statusBody: NEEDS_ONBOARDING },
  })

  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
  assert.equal(fetchCalls.length, 0)
})

test('a hung onboarding check is abandoned at the 8s budget and fails open', async () => {
  const { location, clock, aborted, logs } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    clock: true,
    xano: { getNeverSettles: true },
  })

  await flush()
  assert.equal(location.replaced, undefined, 'still waiting inside the budget')

  await clock.advance(4000)
  assert.equal(location.replaced, undefined, 'still waiting after the old budget')
  await clock.advance(3999)
  assert.equal(location.replaced, undefined, 'still waiting just inside the budget')
  await clock.advance(1)
  assert.equal(location.replaced, '/messages')
  assert.equal(aborted.length, 1, 'the in-flight request is aborted')
  assert.ok(logs.warn.some((line) => line.includes('budget')))
})

test('a slow but in-budget check still drives the funnel', async () => {
  const { location, clock } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    clock: true,
    xano: { getDelayMs: 5000, statusBody: NEEDS_ONBOARDING },
  })

  await flush()
  await clock.advance(4000)
  assert.equal(location.replaced, undefined, 'still waiting after the old budget')
  await clock.advance(1000)
  assert.equal(location.replaced, '/starter-onboarding')
  // The budget timer is cleared once the answer lands, so nothing fires later.
  await clock.advance(10000)
  assert.equal(location.replaced, '/starter-onboarding')
  assert.equal(clock.pending(), 0)
})

test('Brand logins never spend a Xano call on the Talent funnel', async () => {
  // A paid Brand does now spend a Xano call (see the Brand-funnel section
  // below), but never the Talent one: it must read get_brand_profile_status and
  // leave get_build_profile_status alone, so a Brand can never be diverted to a
  // Talent funnel step.
  const paidBrand = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-brand-paid',
      planConnections: [plan('pln_new-paid-plan-463h04ph')],
    },
    xano: { statusBody: NEEDS_ONBOARDING, brandStatusBody: BRAND_DONE },
  })
  const freeBrand = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-brand-free',
      planConnections: [plan('pln_free-plan-f6kn0dxz')],
    },
    xano: { statusBody: NEEDS_ONBOARDING },
  })
  const unmapped = loadRouter({
    pathname: '/auth-route',
    member: { id: 'member-unknown', planConnections: [plan('pln_unknown')] },
    xano: { statusBody: NEEDS_ONBOARDING },
  })

  await flush()
  assert.equal(paidBrand.location.replaced, '/brand-dashboard')
  assert.equal(callsTo(paidBrand.fetchCalls, STATUS_URL).length, 0)
  assert.equal(callsTo(paidBrand.fetchCalls, BRAND_STATUS_URL).length, 1)
  assert.equal(freeBrand.location.replaced, '/quiz')
  assert.equal(freeBrand.fetchCalls.length, 0)
  assert.equal(unmapped.location.replaced, undefined)
  assert.equal(unmapped.fetchCalls.length, 0)
})

test('funnel diagnostics are staging-only unless STARTERS_DEBUG is set', async () => {
  const quiet = loadRouter({
    hostname: 'www.thestarters.com',
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: NEEDS_ONBOARDING },
  })
  await flush()
  assert.equal(quiet.location.replaced, '/starter-onboarding')
  assert.equal(quiet.logs.info.length + quiet.logs.warn.length, 0)

  const loud = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: NEEDS_ONBOARDING },
  })
  await flush()
  assert.ok(loud.logs.info.some((line) => line.includes('/starter-onboarding')))

  const debugged = loadRouter({
    hostname: 'www.thestarters.com',
    pathname: '/auth-route',
    member: talentMember(),
    debug: true,
    xano: { statusBody: NEEDS_ONBOARDING },
  })
  await flush()
  assert.equal(debugged.location.replaced, '/starter-onboarding')
  assert.ok(debugged.logs.info.length > 0)
})

test('the staging host gate rejects lookalike hostnames', () => {
  const { api } = loadRouter()

  for (const host of [
    'the-starters-3-0.webflow.io',
    'localhost',
    '127.0.0.1',
    'some-generated-name.trycloudflare.com',
  ]) {
    assert.equal(api.stagingHost(host), true, host)
  }
  for (const host of [
    'notwebflow.io',
    'evil-trycloudflare.com',
    'www.thestarters.com',
    '',
  ]) {
    assert.equal(api.stagingHost(host), false, host)
  }
})

test('auth route fails safely when the shared role contract is missing', async () => {
  const { attributes, location } = loadRouter({
    pathname: '/auth-route',
    roleContractMissing: true,
    member: {
      id: 'member-brand',
      planConnections: [plan('pln_new-paid-plan-463h04ph')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(location.replaced, undefined)
  assert.equal(
    attributes['data-auth-route-error'],
    'role-contract-unavailable',
  )
})

// --- Brand profile funnel -----------------------------------------------------

const paidBrandMember = () => ({
  id: 'member-brand-paid',
  planConnections: [plan('pln_new-paid-plan-463h04ph')],
})

test('the brand status body maps to a funnel position', () => {
  const { api } = loadRouter()

  assert.equal(api.brandProfileStateFrom(BRAND_NOT_DONE), 'complete-profile')
  assert.equal(api.brandProfileStateFrom(BRAND_DONE), 'done')
  // No brands_v3 row means there is nothing to complete, so this is inconclusive
  // rather than "not done" — the member routes normally.
  assert.equal(api.brandProfileStateFrom(BRAND_NO_RECORD), 'unknown')
})

test('only has_record true with a literal false brand_profile_done diverts a Brand', () => {
  const { api } = loadRouter()

  // Every one of these must read as "route normally", because only the exact
  // shape above is an answer this router understands.
  for (const payload of [
    null,
    undefined,
    {},
    'nope',
    42,
    { brand_profile_done: false },
    { has_record: 'true', brand_profile_done: false },
    { has_record: true, brand_profile_done: 'false' },
    { has_record: true, brand_profile_done: 0 },
    { has_record: true, brand_profile_done: null },
    { has_record: true },
    // The Talent body is not a Brand body.
    UNFINISHED_WITH_ROW,
  ]) {
    assert.notEqual(
      api.brandProfileStateFrom(payload),
      'complete-profile',
      JSON.stringify(payload),
    )
  }
})

test('a paid Brand with an unfinished profile is sent to /complete-profile', async () => {
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  assert.equal(location.replaced, '/complete-profile')
  const urls = urlsOf(fetchCalls)
  assert.equal(urls.length, 2, 'one token trade plus one status read')
  assert.ok(urls[0].startsWith(TRADE_URL + '?token='), urls[0])
  assert.equal(urls[1], BRAND_STATUS_URL)
  const read = callsTo(fetchCalls, BRAND_STATUS_URL)[0]
  assert.equal(read.config.headers.Authorization, 'Bearer xano-token-abc')
  // No inputs: the endpoint derives the member from the bearer token.
  assert.equal(read.config.method, undefined)
  assert.equal(read.config.body, undefined)
})

test('an unfinished brand profile wins over a stored next and consumes it', async () => {
  const { location, storage } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/favorites',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  assert.equal(location.replaced, '/complete-profile')
  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('an unfinished brand profile wins over a query next too', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    search: '?next=%2Fopportunities-brands-view',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  assert.equal(location.replaced, '/complete-profile')
})

test('a finished paid Brand keeps the requested next and its role home', async () => {
  const withNext = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/favorites',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_DONE },
  })
  const withoutNext = loadRouter({
    pathname: '/auth-route',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_DONE },
  })

  await flush()
  assert.equal(withNext.location.replaced, '/favorites')
  assert.equal(withoutNext.location.replaced, '/brand-dashboard')
})

test('a paid Brand with no brands_v3 record routes normally', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/favorites',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_NO_RECORD },
  })

  await flush()
  assert.equal(location.replaced, '/favorites')
})

test('the completion marker short-circuits the brand check with no network', async () => {
  // The webhook-latency bridge: a member who just submitted the form is done,
  // whatever Xano currently says — and the endpoint is not even asked.
  const { location, fetchCalls, logs } = loadRouter({
    pathname: '/auth-route',
    brandMarker: '1',
    member: paidBrandMember(),
    // Deliberately the diverting body: if the marker were ignored, this run
    // would end on /complete-profile instead of the dashboard.
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  assert.equal(location.replaced, '/brand-dashboard')
  assert.deepEqual(fetchCalls, [])
  assert.ok(logs.info.some((line) => line.includes('marker is set')))
})

test('the marker is read with the same semantics as its other two readers', async () => {
  // Set: any trimmed non-empty string. Not set: absent, empty, whitespace-only.
  for (const brandMarker of ['1', 'true', ' x ']) {
    const { location, fetchCalls } = loadRouter({
      pathname: '/auth-route',
      brandMarker,
      member: paidBrandMember(),
      xano: { brandStatusBody: BRAND_NOT_DONE },
    })
    await flush()
    assert.equal(location.replaced, '/brand-dashboard', JSON.stringify(brandMarker))
    assert.deepEqual(fetchCalls, [], JSON.stringify(brandMarker))
  }

  for (const brandMarker of ['', '   ', '\n\t ']) {
    const { location, fetchCalls } = loadRouter({
      pathname: '/auth-route',
      brandMarker,
      member: paidBrandMember(),
      xano: { brandStatusBody: BRAND_NOT_DONE },
    })
    await flush()
    assert.equal(location.replaced, '/complete-profile', JSON.stringify(brandMarker))
    assert.equal(callsTo(fetchCalls, BRAND_STATUS_URL).length, 1)
  }
})

test('the marker key is exactly the one the account controller writes', () => {
  const controllerSource = fs.readFileSync(
    require.resolve('./brand-account-controller.js'),
    'utf8',
  )
  const { api } = loadRouter()

  assert.equal(api.brandProfileMarkerKey, BRAND_MARKER_KEY)
  // The writer and the reader are separate self-contained files by design, so
  // the shared key is pinned here rather than trusted.
  assert.ok(
    controllerSource.includes("'" + BRAND_MARKER_KEY + "'"),
    'brand-account-controller.js must write the key this router reads',
  )
})

test('a marker read that throws costs a Xano read, not a wrong destination', async () => {
  // Safari private mode. Reading the marker fails, so the router asks Xano
  // instead of assuming either answer.
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    storageFailure: 'get',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  assert.equal(location.replaced, '/complete-profile')
  assert.equal(callsTo(fetchCalls, BRAND_STATUS_URL).length, 1)
})

test('every brand-check failure fails open to the standard route', async () => {
  const cases = [
    { brandStatus: 401 },
    { brandStatus: 500 },
    { brandRejects: true },
    { brandMalformedJson: true },
    { brandStatusBody: {} },
    { brandStatusBody: 'nope' },
    { tradeStatus: 401 },
    { tradeBody: { nothing: true } },
  ]
  for (const xano of cases) {
    const { location } = loadRouter({
      pathname: '/auth-route',
      storedDestination: '/favorites',
      member: paidBrandMember(),
      xano,
    })
    await flush()
    assert.equal(location.replaced, '/favorites', JSON.stringify(xano))
  }

  // No Memberstack cookie: the trade is never even attempted.
  const loggedOutOfXano = loadRouter({
    pathname: '/auth-route',
    member: paidBrandMember(),
    loggedOutCookie: true,
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })
  await flush()
  assert.equal(loggedOutOfXano.location.replaced, '/brand-dashboard')
  assert.deepEqual(loggedOutOfXano.fetchCalls, [])

  // No fetch at all in the window: the check is skipped, not thrown.
  const noFetch = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/favorites',
    member: paidBrandMember(),
  })
  await flush()
  assert.equal(noFetch.location.replaced, '/favorites')
})

test('a hung brand check is abandoned at the 8s budget and fails open', async () => {
  const { location, clock, aborted, logs } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/favorites',
    member: paidBrandMember(),
    clock: true,
    xano: { brandNeverSettles: true },
  })

  await flush()
  assert.equal(location.replaced, undefined, 'still waiting inside the budget')

  await clock.advance(4000)
  assert.equal(location.replaced, undefined, 'still waiting after the old budget')
  await clock.advance(3999)
  assert.equal(location.replaced, undefined, 'still waiting just inside the budget')
  await clock.advance(1)
  assert.equal(location.replaced, '/favorites')
  assert.equal(aborted.length, 1, 'the in-flight request is aborted')
  assert.ok(logs.warn.some((line) => line.includes('brand profile check')))
  assert.ok(logs.warn.some((line) => line.includes('budget')))
})

test('a slow but in-budget brand check still drives the funnel', async () => {
  const { location, clock } = loadRouter({
    pathname: '/auth-route',
    member: paidBrandMember(),
    clock: true,
    xano: { brandDelayMs: 5000, brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  await clock.advance(4000)
  assert.equal(location.replaced, undefined, 'still waiting after the old budget')
  await clock.advance(1000)
  assert.equal(location.replaced, '/complete-profile')
  // The budget timer is cleared once the answer lands, so nothing fires later.
  await clock.advance(10000)
  assert.equal(location.replaced, '/complete-profile')
  assert.equal(clock.pending(), 0)
})

test('the brand check is paid-Brand only; nobody else touches that endpoint', async () => {
  const talent = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: ONBOARDED, brandStatusBody: BRAND_NOT_DONE },
  })
  const freeBrand = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-brand-free',
      planConnections: [plan('pln_free-plan-f6kn0dxz')],
    },
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })
  const unmapped = loadRouter({
    pathname: '/auth-route',
    member: { id: 'member-unknown', planConnections: [plan('pln_unknown')] },
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  // Talent is untouched: its own funnel decided, and the Brand endpoint was
  // never asked even though it would have said "not done".
  assert.equal(talent.location.replaced, '/starter-dashboard')
  assert.equal(callsTo(talent.fetchCalls, BRAND_STATUS_URL).length, 0)
  assert.equal(callsTo(talent.fetchCalls, STATUS_URL).length, 1)
  // brand-free has no /complete-profile form to finish, so it stays a
  // zero-network login.
  assert.equal(freeBrand.location.replaced, '/quiz')
  assert.deepEqual(freeBrand.fetchCalls, [])
  assert.equal(unmapped.location.replaced, undefined)
  assert.deepEqual(unmapped.fetchCalls, [])
})

test('a Talent funnel redirect never spends the brand call either', async () => {
  // The two branches are mutually exclusive by role, so an unfinished Talent
  // member returns before the Brand branch can be reached.
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { statusBody: NEEDS_ONBOARDING, brandStatusBody: BRAND_NOT_DONE },
  })

  await flush()
  assert.equal(location.replaced, '/starter-onboarding')
  assert.equal(callsTo(fetchCalls, BRAND_STATUS_URL).length, 0)
})

test('a finished Brand asking for /complete-profile still lands on its role home', async () => {
  // /complete-profile is not an allowed `next` for any role (asserted above), so
  // the only way to reach it from here is the funnel branch.
  const { location } = loadRouter({
    pathname: '/auth-route',
    search: '?next=%2Fcomplete-profile',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_DONE },
  })

  await flush()
  assert.equal(location.replaced, '/brand-dashboard')
})

test('brand funnel diagnostics are staging-only unless STARTERS_DEBUG is set', async () => {
  const quiet = loadRouter({
    hostname: 'www.thestarters.com',
    pathname: '/auth-route',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })
  await flush()
  assert.equal(quiet.location.replaced, '/complete-profile')
  assert.equal(quiet.logs.info.length + quiet.logs.warn.length, 0)

  const loud = loadRouter({
    pathname: '/auth-route',
    member: paidBrandMember(),
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })
  await flush()
  assert.ok(loud.logs.info.some((line) => line.includes('/complete-profile')))

  const debugged = loadRouter({
    hostname: 'www.thestarters.com',
    pathname: '/auth-route',
    member: paidBrandMember(),
    debug: true,
    xano: { brandStatusBody: BRAND_NOT_DONE },
  })
  await flush()
  assert.equal(debugged.location.replaced, '/complete-profile')
  assert.ok(debugged.logs.info.length > 0)
})

// --- Release marker -----------------------------------------------------------

test('the header @release marker matches the exported release property', () => {
  const { api } = loadRouter()
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the auth-route.js header')
  assert.equal(api.release, marker[1])
})

// The router and the site-head loader ship as one unit: the loader requests
// auth-route.js from its own release ref, so a release that stamps one and not
// the other makes the served-byte check in ROUTE-GUARD-WIRING.md answer two
// different versions for one deployment. Both values here come from the
// executed modules, not from their source text. route-guard.js is deliberately
// NOT in this unit — it is untouched by this release and keeps the marker that
// shipped its current contents.
test('the router and the site-head loader export one release value', () => {
  const { api } = loadRouter({ pathname: '/test' })
  const loaderWindow = {
    location: { hostname: 'www.thestarters.com', pathname: '/test' },
    sessionStorage: { getItem: () => null, removeItem() {} },
    addEventListener() {},
    dispatchEvent() {},
  }
  vm.runInNewContext(
    fs.readFileSync(require.resolve('./auth-page-loader.js'), 'utf8'),
    {
      Array,
      CustomEvent: class {},
      JSON,
      Number,
      Set,
      String,
      console: { error() {} },
      document: {
        currentScript: { src: 'https://cdn.example.test/v3/auth-page-loader.js' },
        head: { appendChild: (node) => node },
        documentElement: { appendChild: (node) => node },
        readyState: 'complete',
        createElement: () => ({ setAttribute() {} }),
      },
      window: loaderWindow,
    },
  )

  assert.match(api.release, /^v\d+\.\d+\.\d+$/)
  assert.equal(loaderWindow.StartersV3AuthPageLoader.release, api.release)
})
