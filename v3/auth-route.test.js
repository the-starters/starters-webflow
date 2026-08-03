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
const GET_URL = XANO + '/api:KZf7nFnk/starters_onboarding/get_freelancers'
const DONE_ENVELOPE = { freelancer: [{ id: 12, onboarding_done: true }] }
const NOT_DONE_ENVELOPE = { freelancer: [{ id: 12, onboarding_done: false }] }

function plan(planId) {
  return { active: true, planId }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Opt-in deterministic clock (`clock: true`), so the 4s onboarding-check budget
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

function loadRouter(options = {}) {
  const attributes = {}
  // One record per matched form so a test can tell the login form apart from the
  // signup form; both also write into the shared `attributes` bag the older
  // assertions read.
  const formAttributes = { login: {}, signup: {} }
  function makeForm(kind) {
    return {
      setAttribute(name, value) {
        formAttributes[kind][name] = value
        attributes[name] = value
      },
    }
  }
  const forms = [makeForm('login'), makeForm('signup')]
  const storage = new Map()
  if (options.storedDestination) {
    storage.set('thestarters:v3-auth-next', options.storedDestination)
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

    if (String(url) === GET_URL) {
      if (xano.getNeverSettles) return new Promise(() => {})
      if (xano.getRejects) throw new Error('get network failure')
      if (xano.getStatus) {
        return jsonResponse(null, { ok: false, status: xano.getStatus })
      }
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(xano, 'envelope')
          ? xano.envelope
          : DONE_ENVELOPE,
      )
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
    dispatchEvent() {},
    location,
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
      getCurrentMember: async () => ({ data: member }),
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
  } else if (options.member) {
    window.$memberstackDom = memberstackFor(options.member)
  }
  const document = {
    documentElement: {
      setAttribute(name, value) {
        attributes[name] = value
      },
    },
    querySelectorAll() {
      return forms
    },
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
    location,
    logs,
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
  for (const path of ['/complete-profile', '/complete-profile/']) {
    assert.equal(api.destinationFor(brandPaid, path), path)
    assert.equal(api.destinationFor(talent, path), '/starter-dashboard')
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

test('the freelancer envelope maps to the three funnel states', () => {
  const { api } = loadRouter()

  assert.equal(api.onboardingStateFrom(DONE_ENVELOPE), 'done')
  assert.equal(api.onboardingStateFrom(NOT_DONE_ENVELOPE), 'not-done')
  assert.equal(api.onboardingStateFrom({ freelancer: [{}] }), 'not-done')
  assert.equal(
    api.onboardingStateFrom({ freelancer: [{ onboarding_done: 'true' }] }),
    'not-done',
  )
  assert.equal(api.onboardingStateFrom({ freelancer: [] }), 'no-record')
  assert.equal(api.onboardingStateFrom({}), 'no-record')
  assert.equal(api.onboardingStateFrom(null), 'no-record')
})

test('a Talent member with no freelancer row is sent to Build profile', async () => {
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { envelope: {} },
  })

  await flush()
  assert.equal(location.replaced, '/build-profile/select-profile')
  assert.ok(urlsOf(fetchCalls)[0].startsWith(TRADE_URL + '?token='))
  const reads = callsTo(fetchCalls, GET_URL)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].config.headers.Authorization, 'Bearer xano-token-abc')
})

test('unfinished onboarding wins over a valid stored next and consumes it', async () => {
  const { location, storage } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    xano: { envelope: NOT_DONE_ENVELOPE },
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
    xano: { envelope: NOT_DONE_ENVELOPE },
  })

  await flush()
  assert.equal(location.replaced, '/starter-onboarding')
})

test('a finished Talent member keeps the requested next', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    xano: { envelope: DONE_ENVELOPE },
  })

  await flush()
  assert.equal(location.replaced, '/messages')
})

test('a finished Talent member completes the /starter-onboarding round trip', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    search: '?next=%2Fstarter-onboarding',
    member: talentMember(),
    xano: { envelope: DONE_ENVELOPE },
  })

  await flush()
  assert.equal(location.replaced, '/starter-onboarding')
})

test('a finished Talent member with no next lands on the Talent home', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { envelope: DONE_ENVELOPE },
  })

  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
})

test('an HTTP error on the freelancer read fails open to the standard route', async () => {
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/messages',
    member: talentMember(),
    xano: { getStatus: 500 },
  })

  await flush()
  assert.equal(location.replaced, '/messages')
  assert.equal(callsTo(fetchCalls, GET_URL).length, 1)
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
  assert.equal(callsTo(tradeFailed.fetchCalls, GET_URL).length, 0)
  assert.equal(callsTo(tokenless.fetchCalls, GET_URL).length, 0)
})

test('a member with no Memberstack cookie never reaches Xano and routes normally', async () => {
  const { location, fetchCalls } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    loggedOutCookie: true,
    xano: { envelope: NOT_DONE_ENVELOPE },
  })

  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
  assert.equal(fetchCalls.length, 0)
})

test('a hung onboarding check is abandoned at the 4s budget and fails open', async () => {
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
  assert.equal(location.replaced, '/messages')
  assert.equal(aborted.length, 1, 'the in-flight request is aborted')
  assert.ok(logs.warn.some((line) => line.includes('budget')))
})

test('a slow but in-budget check still drives the funnel', async () => {
  const { location, clock } = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    clock: true,
    xano: { envelope: NOT_DONE_ENVELOPE },
  })

  await flush()
  assert.equal(location.replaced, '/starter-onboarding')
  // The budget timer is cleared once the answer lands, so nothing fires later.
  await clock.advance(10000)
  assert.equal(location.replaced, '/starter-onboarding')
  assert.equal(clock.pending(), 0)
})

test('Brand logins never spend a Xano call on the Talent funnel', async () => {
  const paidBrand = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-brand-paid',
      planConnections: [plan('pln_new-paid-plan-463h04ph')],
    },
    xano: { envelope: NOT_DONE_ENVELOPE },
  })
  const freeBrand = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-brand-free',
      planConnections: [plan('pln_free-plan-f6kn0dxz')],
    },
    xano: { envelope: NOT_DONE_ENVELOPE },
  })
  const unmapped = loadRouter({
    pathname: '/auth-route',
    member: { id: 'member-unknown', planConnections: [plan('pln_unknown')] },
    xano: { envelope: NOT_DONE_ENVELOPE },
  })

  await flush()
  assert.equal(paidBrand.location.replaced, '/brand-dashboard')
  assert.equal(paidBrand.fetchCalls.length, 0)
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
    xano: { envelope: NOT_DONE_ENVELOPE },
  })
  await flush()
  assert.equal(quiet.location.replaced, '/starter-onboarding')
  assert.equal(quiet.logs.info.length + quiet.logs.warn.length, 0)

  const loud = loadRouter({
    pathname: '/auth-route',
    member: talentMember(),
    xano: { envelope: NOT_DONE_ENVELOPE },
  })
  await flush()
  assert.ok(loud.logs.info.some((line) => line.includes('/starter-onboarding')))

  const debugged = loadRouter({
    hostname: 'www.thestarters.com',
    pathname: '/auth-route',
    member: talentMember(),
    debug: true,
    xano: { envelope: NOT_DONE_ENVELOPE },
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

// --- Release marker -----------------------------------------------------------

test('the header @release marker matches the exported release property', () => {
  const { api } = loadRouter()
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the auth-route.js header')
  assert.equal(api.release, marker[1])
})

test('every script in this release carries the same release marker', () => {
  // A release that updates several files must stamp them all identically, or the
  // "which version is loaded?" console check answers differently per script.
  const guardMarker = routeGuardSource.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  const routerMarker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(guardMarker, 'no @release line in route-guard.js')
  assert.ok(routerMarker, 'no @release line in auth-route.js')
  assert.equal(guardMarker[1], routerMarker[1])
})
