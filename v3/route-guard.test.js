const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./route-guard.js'), 'utf8')

function plan(planId) {
  return { active: true, planId }
}

const TALENT = { id: 'm-talent', planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')] }
const BRAND_PAID = { id: 'm-brand-paid', planConnections: [plan('pln_new-paid-plan-463h04ph')] }
const TEST_BRAND = { id: 'm-test-brand', planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')] }
const BRAND_FREE = { id: 'm-brand-free', planConnections: [plan('pln_free-plan-f6kn0dxz')] }
const UNMAPPED = { id: 'm-unknown', planConnections: [plan('pln_unknown')] }

function loadGuard(options = {}) {
  const attributes = {}
  const events = []
  const location = {
    hostname: options.hostname || 'the-starters-3-0.webflow.io',
    origin: `https://${options.hostname || 'the-starters-3-0.webflow.io'}`,
    pathname: options.pathname || '/test',
    search: options.search || '',
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
    dispatchEvent(event) {
      events.push(event)
    },
    location,
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
  }
  if (Object.prototype.hasOwnProperty.call(options, 'delayedMember')) {
    window.setTimeout(() => {
      window.$memberstackDom = {
        getCurrentMember: async () => ({ data: options.delayedMember }),
      }
    }, options.memberstackDelayMs || 25)
  } else if (Object.prototype.hasOwnProperty.call(options, 'getCurrentMember')) {
    window.$memberstackDom = {
      getCurrentMember: options.getCurrentMember,
    }
  } else if (Object.prototype.hasOwnProperty.call(options, 'member')) {
    window.$memberstackDom = {
      getCurrentMember: async () => ({
        data: typeof options.member === 'function' ? options.member() : options.member,
      }),
    }
  } else if (options.memberstackMissing) {
    // leave $memberstackDom undefined
  }
  const document = {
    documentElement: {
      setAttribute(name, value) {
        attributes[name] = value
      },
    },
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    CustomEvent: window.CustomEvent,
    URL,
    URLSearchParams,
    document,
    window,
  })

  return { api: window.StartersV3RouteGuard, attributes, events, location, window }
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (!predicate() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(predicate(), true)
}

// --- Pure matrix logic --------------------------------------------------------

test('recognises guarded pages and ignores unlisted ones', () => {
  const { api } = loadGuard()
  assert.equal(api.isGuardedPath('/dashboard'), true)
  assert.equal(api.isGuardedPath('/dashboard/'), true)
  assert.equal(api.isGuardedPath('/brand-dashboard'), true)
  assert.equal(api.isGuardedPath('/starter-dashboard'), true)
  assert.equal(api.isGuardedPath('/opportunities/product-designer'), true)
  assert.equal(api.isGuardedPath('/'), false)
  assert.equal(api.isGuardedPath('/about'), false)
  assert.equal(api.isGuardedPath('/opportunities/slug/apply'), false)
})

test('merged /opportunities feed is guarded for both roles (incl. trailing slash)', () => {
  const { api } = loadGuard()
  assert.equal(api.isGuardedPath('/opportunities'), true)
  // Deliberately guarded since the merged-feed launch: the exact map misses
  // the slashed form and the /opportunities/ prefix rule needs a slug segment,
  // so this entry closes what used to be an unguarded gap.
  assert.equal(api.isGuardedPath('/opportunities/'), true)
  assert.equal(api.redirectTargetFor(TALENT, '/opportunities'), '')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/opportunities'), '')
  assert.equal(api.redirectTargetFor(TALENT, '/opportunities/'), '')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/opportunities/'), '')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/opportunities'), '/quiz')
})

test('/favorites is guarded paid-Brand only (incl. trailing slash)', () => {
  const { api } = loadGuard()
  assert.equal(api.isGuardedPath('/favorites'), true)
  // Same reason as the /opportunities/ twin: the exact map misses the slashed
  // form and there is no prefix rule to catch it.
  assert.equal(api.isGuardedPath('/favorites/'), true)
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/favorites'), '')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/favorites/'), '')
  // A free Brand cannot hold favorites (Xano #1506 requires plan 4/5), so it
  // goes to its own quiz home rather than an empty list it cannot fill.
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/favorites'), '/quiz')
  assert.equal(api.redirectTargetFor(TALENT, '/favorites'), '/starter-dashboard')
  assert.equal(api.redirectTargetFor(TALENT, '/favorites/'), '/starter-dashboard')
})

test('a logged-out visitor to /favorites is sent to login and can return', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/favorites',
    member: null,
  })
  await flush()
  assert.equal(location.replaced, '/login?next=' + encodeURIComponent('/favorites'))
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('/quiz-results and /all-starters are intentionally NOT guarded', () => {
  const { api } = loadGuard()
  // Permanently excluded from PAGE_ROLES: both are reachable pre-signup, so a
  // guarded page — which forces a login — would break them. Their logged-in
  // role rules live in ROLE_BOUNCE_PAGES instead (see the section at the end of
  // this file), which never touches a logged-out visitor.
  assert.equal(api.isGuardedPath('/quiz-results'), false)
  assert.equal(api.isGuardedPath('/all-starters'), false)
  assert.equal(api.redirectTargetFor(TALENT, '/quiz-results'), '')
  assert.equal(api.redirectTargetFor(TALENT, '/all-starters'), '')
})

test('allowed roles stay on the page (empty redirect target)', () => {
  const { api } = loadGuard()
  assert.equal(api.redirectTargetFor(TALENT, '/starter-dashboard'), '')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/brand-dashboard'), '')
  assert.equal(api.redirectTargetFor(TEST_BRAND, '/opportunities-brands-view'), '')
})

test('canonical /dashboard routes every mapped role to its authored home page', () => {
  const { api } = loadGuard()
  const completedFreeBrand = {
    ...BRAND_FREE,
    customFields: { 'starter-quiz': '{"status":"ready"}' },
  }

  assert.equal(api.redirectTargetFor(TALENT, '/dashboard'), '/starter-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/dashboard'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(TEST_BRAND, '/dashboard'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/dashboard'), '/quiz')
  assert.equal(api.redirectTargetFor(completedFreeBrand, '/dashboard'), '/quiz-results')

  // Trailing-slash twin routes identically for the same reason as
  // /opportunities/ and /favorites/: the exact map misses the slashed form and
  // no prefix rule catches it.
  assert.equal(api.redirectTargetFor(TALENT, '/dashboard/'), '/starter-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/dashboard/'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(TEST_BRAND, '/dashboard/'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/dashboard/'), '/quiz')
  assert.equal(api.redirectTargetFor(completedFreeBrand, '/dashboard/'), '/quiz-results')
})

test('a wrong-role member is sent to its own default, never the other role page', () => {
  const { api } = loadGuard()
  // The exact reproduced audit failures:
  assert.equal(api.redirectTargetFor(TALENT, '/brand-dashboard'), '/starter-dashboard')
  assert.equal(api.redirectTargetFor(TALENT, '/opportunities-brands-view'), '/starter-dashboard')
  // Symmetric protection for the Talent-only pages:
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/starter-dashboard'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/opportunities-freelancer-view'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/brand-dashboard'), '/quiz')
})

test('free Brand redirect target is /quiz until the quiz is completed, then /quiz-results', () => {
  const { api } = loadGuard()
  const doneFreeBrand = {
    id: 'm-free-done',
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
    customFields: { 'starter-quiz': '{"status":"ready"}' },
  }
  assert.equal(api.hasCompletedQuiz(BRAND_FREE), false)
  assert.equal(api.hasCompletedQuiz(doneFreeBrand), true)
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/brand-dashboard'), '/quiz')
  assert.equal(api.redirectTargetFor(doneFreeBrand, '/brand-dashboard'), '/quiz-results')
})

test('Messages is allowed for Talent and paid Brand but not free Brand', () => {
  const { api } = loadGuard()
  assert.equal(api.redirectTargetFor(TALENT, '/messages'), '')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/messages'), '')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/messages'), '/quiz')
})

test('opportunity detail pages are shared by Talent and paid Brand only', () => {
  const { api } = loadGuard()
  assert.equal(api.redirectTargetFor(TALENT, '/opportunities/product-designer'), '')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/opportunities/product-designer'), '')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/opportunities/product-designer'), '/quiz')
})

test('opportunity creation is paid-Brand only', () => {
  const { api } = loadGuard()
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/opportunities---create'), '')
  assert.equal(api.redirectTargetFor(TALENT, '/opportunities---create'), '/starter-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/opportunities---create'), '/quiz')
})

test('build-profile onboarding pages are Talent only', () => {
  const { api } = loadGuard()
  for (const path of [
    '/build-profile/select-profile',
    '/build-profile/full-profile',
    '/build-profile/consult',
    '/starter-edit-profile',
  ]) {
    assert.equal(api.redirectTargetFor(TALENT, path), '')
    assert.equal(api.redirectTargetFor(BRAND_PAID, path), '/brand-dashboard')
  }
})

test('/starter-onboarding is guarded Talent only', () => {
  const { api } = loadGuard()
  assert.equal(api.isGuardedPath('/starter-onboarding'), true)
  assert.equal(api.redirectTargetFor(TALENT, '/starter-onboarding'), '')
  assert.equal(api.redirectTargetFor(BRAND_PAID, '/starter-onboarding'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(TEST_BRAND, '/starter-onboarding'), '/brand-dashboard')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/starter-onboarding'), '/quiz')
})

test('a logged-out visitor to /starter-onboarding is sent to login and can return', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/starter-onboarding',
    member: null,
  })
  await flush()
  assert.equal(
    location.replaced,
    '/login?next=' + encodeURIComponent('/starter-onboarding'),
  )
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('redirects a Brand session away from /starter-onboarding to its own default', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/starter-onboarding',
    member: BRAND_PAID,
  })
  await flush()
  assert.equal(location.replaced, '/brand-dashboard')
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('cross-family Talent and Brand plans fail closed as conflicting', () => {
  const { api } = loadGuard()
  const multi = {
    id: 'm-multi',
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o'), plan('pln_new-paid-plan-463h04ph')],
  }
  assert.equal(api.memberRole(multi), null)
  assert.equal(api.memberRoleError(multi), 'conflicting-plan-roles')
  assert.equal(api.redirectTargetFor(multi, '/brand-dashboard'), null)
  assert.equal(api.redirectTargetFor(multi, '/dashboard'), null)
})

test('paid Brand wins over Brand Free in a valid same-family upgrade state', () => {
  const { api } = loadGuard()
  const upgradingBrand = {
    id: 'm-upgrading-brand',
    planConnections: [
      plan('pln_free-plan-f6kn0dxz'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }
  assert.equal(api.memberRole(upgradingBrand), 'brand-paid')
  assert.equal(api.memberRoleError(upgradingBrand), null)
  assert.equal(api.redirectTargetFor(upgradingBrand, '/brand-dashboard'), '')
  assert.equal(api.redirectTargetFor(upgradingBrand, '/dashboard'), '/brand-dashboard')
})

test('a mapped plan still determines the role when another active plan is unmapped', () => {
  const { api } = loadGuard()
  const mixed = {
    id: 'm-mixed',
    planConnections: [plan('pln_unknown'), plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }
  assert.equal(api.memberRole(mixed), 'talent')
  assert.equal(api.redirectTargetFor(mixed, '/starter-dashboard'), '')
})

test('an unmapped plan yields null on a guarded page and empty on an unguarded one', () => {
  const { api } = loadGuard()
  assert.equal(api.redirectTargetFor(UNMAPPED, '/brand-dashboard'), null)
  assert.equal(api.redirectTargetFor(UNMAPPED, '/about'), '')
})

// --- Runtime behaviour --------------------------------------------------------

test('does not run on an unapproved hostname', async () => {
  const { attributes, location } = loadGuard({
    hostname: 'attacker.example',
    pathname: '/brand-dashboard',
    member: TALENT,
  })
  await flush()
  assert.equal(attributes['data-route-guard'], undefined)
  assert.equal(location.replaced, undefined)
})

test('does not touch an unguarded page even for a logged-out visitor', async () => {
  const { attributes, location } = loadGuard({
    pathname: '/about',
    member: null,
  })
  await flush()
  assert.equal(attributes['data-route-guard'], undefined)
  assert.equal(location.replaced, undefined)
})

test('redirects a logged-out visitor to login preserving path and query', async () => {
  const { attributes, location } = loadGuard({
    pathname: '/brand-dashboard',
    search: '?ref=email',
    member: null,
  })
  await flush()
  assert.equal(location.replaced, '/login?next=' + encodeURIComponent('/brand-dashboard?ref=email'))
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('redirects a Talent session away from a Brand page to the Talent default', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/brand-dashboard',
    member: TALENT,
  })
  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('routes an authenticated Talent session from /dashboard without page-body access', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/dashboard',
    member: TALENT,
  })
  assert.equal(attributes['data-route-guard'], 'checking')
  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('keeps the neutral /dashboard checking state while Memberstack loads late', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/dashboard',
    delayedMember: TEST_BRAND,
    memberstackDelayMs: 25,
  })
  assert.equal(attributes['data-route-guard'], 'checking')
  assert.equal(location.replaced, undefined)
  await waitFor(() => location.replaced === '/brand-dashboard')
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('routes a logged-out /dashboard visitor through login with a safe return', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/dashboard',
    member: null,
  })
  await flush()
  assert.equal(location.replaced, '/login?next=' + encodeURIComponent('/dashboard'))
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('lets an allowed member stay and marks the page resolved', async () => {
  const { location, attributes, events } = loadGuard({
    pathname: '/brand-dashboard',
    member: BRAND_PAID,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(attributes['data-route-guard'], 'allowed')
  assert.ok(events.some((e) => e.name === 'starters:v3-route-guard-allowed'))
})

test('shared opportunities waits for a higher allowed plan to hydrate before redirecting', async () => {
  const snapshots = [
    BRAND_FREE,
    {
      id: 'm-test-brand',
      planConnections: [
        plan('pln_free-plan-f6kn0dxz'),
        plan('pln_dorxata-test-brand-plan-777r02pa'),
      ],
    },
  ]
  let calls = 0
  const { location, attributes } = loadGuard({
    pathname: '/opportunities',
    member: () => snapshots[Math.min(calls++, snapshots.length - 1)],
  })

  await waitFor(() => attributes['data-route-guard'] === 'allowed')
  assert.equal(location.replaced, undefined)
  assert.equal(calls, 2)
})

test('shared opportunities keeps polling after a transient Memberstack lookup failure', async () => {
  let calls = 0
  const { location, attributes } = loadGuard({
    pathname: '/opportunities',
    member: () => {
      calls += 1
      if (calls === 1) return BRAND_FREE
      if (calls === 2) throw new Error('temporary Memberstack failure')
      return TEST_BRAND
    },
  })

  await waitFor(() => attributes['data-route-guard'] === 'allowed')
  assert.equal(location.replaced, undefined)
  assert.equal(calls, 3)
})

test('shared opportunities exits at the deadline when a polling lookup never settles', async () => {
  let calls = 0
  const { location, attributes } = loadGuard({
    pathname: '/opportunities',
    getCurrentMember: () => {
      calls += 1
      if (calls === 1) return Promise.resolve({ data: BRAND_FREE })
      return new Promise(() => {})
    },
  })

  await waitFor(() => attributes['data-route-guard'] === 'redirecting', 3000)
  assert.equal(location.replaced, '/quiz')
  assert.equal(calls, 2)
})

test('surfaces an unmapped plan on a guarded page instead of redirecting home', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/brand-dashboard',
    member: UNMAPPED,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(attributes['data-route-guard-error'], 'unmapped-plan')
})

test('surfaces a cross-family role conflict instead of choosing a dashboard', async () => {
  const conflict = {
    id: 'm-conflict',
    planConnections: [
      plan('pln_dorxata-test-free-plan-dvcg0k8o'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }
  const { location, attributes } = loadGuard({
    pathname: '/dashboard',
    member: conflict,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(attributes['data-route-guard-error'], 'conflicting-plan-roles')
})

test('sets the checking state synchronously on a guarded page', () => {
  const { attributes } = loadGuard({
    pathname: '/brand-dashboard',
    member: BRAND_PAID,
  })
  assert.equal(attributes['data-route-guard'], 'checking')
})

// --- New guarded funnel pages (2026-08-03) ------------------------------------

test('/generate-invoice is guarded Talent only (incl. trailing slash)', () => {
  const { api } = loadGuard()
  for (const path of ['/generate-invoice', '/generate-invoice/']) {
    assert.equal(api.isGuardedPath(path), true, path)
    assert.equal(api.redirectTargetFor(TALENT, path), '', path)
    assert.equal(api.redirectTargetFor(BRAND_PAID, path), '/brand-dashboard', path)
    assert.equal(api.redirectTargetFor(TEST_BRAND, path), '/brand-dashboard', path)
    assert.equal(api.redirectTargetFor(BRAND_FREE, path), '/quiz', path)
  }
})

// Memberstack's `restrict-pages` gated group owns /complete-profile outright
// (decision 2026-08-03), so the guard must not claim it: two owners would mean
// two logged-out destinations, and this table's would be the one that loses the
// race. Re-adding the page has to be a deliberate edit that trips this test.
test('/complete-profile is not a guarded path — Memberstack owns it', () => {
  const { api } = loadGuard()
  for (const path of ['/complete-profile', '/complete-profile/']) {
    assert.equal(api.pageRolesFor(path), null, path)
    assert.equal(api.isGuardedPath(path), false, path)
    // And no logged-out override survives either: an unguarded page never
    // reaches that lookup, so a leftover entry would only mislead.
    assert.equal(
      api.loggedOutDestinationFor(path, ''),
      '/login?next=' + encodeURIComponent(path),
      path,
    )
  }
})

test('a logged-out visitor to /generate-invoice keeps the login round trip', async () => {
  const { location } = loadGuard({ pathname: '/generate-invoice', member: null })
  await flush()
  assert.equal(
    location.replaced,
    '/login?next=' + encodeURIComponent('/generate-invoice'),
  )
})

// --- Per-page logged-out destination overrides --------------------------------

test('the build-profile funnel sends logged-out visitors home', () => {
  const { api } = loadGuard()
  for (const path of [
    '/build-profile/select-profile',
    '/build-profile/full-profile',
    '/build-profile/consult',
  ]) {
    assert.equal(api.loggedOutDestinationFor(path, ''), '/', path)
    // The override wins over a query string too: there is no ?next= to preserve
    // when the destination is the homepage.
    assert.equal(api.loggedOutDestinationFor(path, '?ref=email'), '/', path)
  }
})

test('every other guarded page keeps the /login?next= round trip', () => {
  const { api } = loadGuard()
  assert.equal(
    api.loggedOutDestinationFor('/brand-dashboard', ''),
    '/login?next=' + encodeURIComponent('/brand-dashboard'),
  )
  assert.equal(
    api.loggedOutDestinationFor('/favorites', '?ref=email'),
    '/login?next=' + encodeURIComponent('/favorites?ref=email'),
  )
  // A prototype key must not be mistaken for a configured override.
  assert.equal(
    api.loggedOutDestinationFor('constructor', ''),
    '/login?next=constructor',
  )
})

test('a logged-out build-profile visitor is sent to the homepage, not to login', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/build-profile/full-profile',
    member: null,
  })
  await flush()
  assert.equal(location.replaced, '/')
  assert.equal(attributes['data-route-guard'], 'redirecting')
})

test('the guard leaves a logged-out /complete-profile visitor alone', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/complete-profile',
    member: null,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(attributes['data-route-guard'], undefined)
})

// --- Member-home bounce pages -------------------------------------------------

test('the four bounce pages are recognised and stay out of PAGE_ROLES', () => {
  const { api } = loadGuard()
  for (const path of ['/', '/login', '/starter-login', '/sign-up']) {
    assert.equal(api.isMemberBouncePage(path), true, path)
    // Critical: a bounce page must NOT be guarded, or a logged-out visitor
    // would be forced through a login form to reach the login form.
    assert.equal(api.isGuardedPath(path), false, path)
  }
  for (const path of ['/about', '/quiz', '/login/extra', '/sign-up/thanks']) {
    assert.equal(api.isMemberBouncePage(path), false, path)
  }
})

test('no role home is itself a bounce page (bounce cannot loop)', () => {
  const { api } = loadGuard()
  const members = [
    TALENT,
    BRAND_PAID,
    TEST_BRAND,
    BRAND_FREE,
    { ...BRAND_FREE, customFields: { 'starter-quiz': '{"status":"ready"}' } },
  ]
  for (const member of members) {
    const home = api.roleHome(member)
    assert.ok(home, member.id)
    assert.equal(api.isMemberBouncePage(home), false, home)
    // And the home must be somewhere the member is actually allowed to be.
    assert.equal(api.redirectTargetFor(member, home), '', home)
  }
})

test('a mapped member on a bounce page resolves to its role home', () => {
  const { api } = loadGuard()
  assert.equal(api.bounceTargetFor(TALENT, null), '/starter-dashboard')
  assert.equal(api.bounceTargetFor(BRAND_PAID, null), '/brand-dashboard')
  assert.equal(api.bounceTargetFor(TEST_BRAND, null), '/brand-dashboard')
  assert.equal(api.bounceTargetFor(BRAND_FREE, null), '/quiz')
  assert.equal(
    api.bounceTargetFor(
      { ...BRAND_FREE, customFields: { 'starter-quiz': '{"status":"ready"}' } },
      null,
    ),
    '/quiz-results',
  )
})

test('an unmapped or conflicted member gets no bounce target at all', () => {
  const { api } = loadGuard()
  const conflict = {
    id: 'm-conflict',
    planConnections: [
      plan('pln_dorxata-test-free-plan-dvcg0k8o'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }
  assert.equal(api.bounceTargetFor(UNMAPPED, null), null)
  assert.equal(api.bounceTargetFor(conflict, null), null)
  assert.equal(api.bounceTargetFor(UNMAPPED, '/messages'), null)
})

test('a bounce honours a next the member is allowed on', () => {
  const { api } = loadGuard()
  assert.equal(api.bounceTargetFor(TALENT, '/messages'), '/messages')
  assert.equal(api.bounceTargetFor(BRAND_PAID, '/favorites'), '/favorites')
  assert.equal(
    api.bounceTargetFor(TALENT, '/opportunities/product-designer'),
    '/opportunities/product-designer',
  )
  // Query strings survive; fragments are stripped.
  assert.equal(api.bounceTargetFor(TALENT, '/messages?thread=7'), '/messages?thread=7')
  assert.equal(api.bounceTargetFor(TALENT, '/messages#top'), '/messages')
})

test('a bounce honours a next on an entirely unguarded public page', () => {
  const { api } = loadGuard()
  // Not in PAGE_ROLES at all: a public marketing or funnel page the member was
  // reading before signing in.
  assert.equal(api.bounceTargetFor(BRAND_FREE, '/all-starters'), '/all-starters')
  assert.equal(api.bounceTargetFor(TALENT, '/about'), '/about')
  assert.equal(api.bounceTargetFor(TALENT, '/quiz-results'), '/quiz-results')
})

test('a bounce refuses a next the member is not allowed on', () => {
  const { api } = loadGuard()
  assert.equal(api.bounceTargetFor(TALENT, '/brand-dashboard'), '/starter-dashboard')
  assert.equal(api.bounceTargetFor(BRAND_FREE, '/messages'), '/quiz')
  assert.equal(api.bounceTargetFor(BRAND_PAID, '/starter-dashboard'), '/brand-dashboard')
})

test('a bounce resolves /dashboard to the role home rather than returning to it', () => {
  const { api } = loadGuard()
  // /dashboard carries an empty allowlist: no role stays there, so honouring it
  // as a next would only hand the member to another redirect.
  assert.equal(api.bounceTargetFor(TALENT, '/dashboard'), '/starter-dashboard')
  assert.equal(api.bounceTargetFor(BRAND_PAID, '/dashboard/'), '/brand-dashboard')
})

test('a bounce refuses a next pointing back at a bounce page', () => {
  const { api } = loadGuard()
  for (const next of ['/', '/login', '/starter-login', '/sign-up']) {
    assert.equal(api.bounceTargetFor(TALENT, next), '/starter-dashboard', next)
  }
})

test('a bounce refuses an off-origin or credentialed next', () => {
  const { api } = loadGuard()
  for (const next of [
    'https://attacker.example/steal',
    '//attacker.example/steal',
    'https://user:pass@the-starters-3-0.webflow.io/messages',
    'javascript:alert(1)',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(api.bounceTargetFor(TALENT, next), '/starter-dashboard', String(next))
  }
})

test('localPath normalises a same-origin next and rejects everything else', () => {
  const { api } = loadGuard()
  assert.equal(api.localPath('/messages?a=1#frag'), '/messages?a=1')
  assert.equal(
    api.localPath('https://the-starters-3-0.webflow.io/messages'),
    '/messages',
  )
  assert.equal(api.localPath('https://attacker.example/messages'), null)
  assert.equal(api.localPath(''), null)
  assert.equal(api.localPath(null), null)
})

test('a logged-in member on the homepage is bounced to its role home', async () => {
  const { location, attributes, events } = loadGuard({
    pathname: '/',
    member: TALENT,
  })
  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
  assert.equal(attributes['data-route-guard'], 'redirecting')
  assert.ok(events.some((e) => e.name === 'starters:v3-route-guard-redirecting'))
})

test('a logged-in member is bounced off both login pages and the signup page', async () => {
  for (const pathname of ['/login', '/starter-login', '/sign-up']) {
    const { location } = loadGuard({ pathname, member: BRAND_PAID })
    await flush()
    assert.equal(location.replaced, '/brand-dashboard', pathname)
  }
})

test('a bounce reads ?next= off the current URL', async () => {
  const { location } = loadGuard({
    pathname: '/login',
    search: '?next=%2Fmessages%3Fthread%3D7',
    member: TALENT,
  })
  await flush()
  assert.equal(location.replaced, '/messages?thread=7')
})

test('a bounce ignores a ?next= the member may not view', async () => {
  const { location } = loadGuard({
    pathname: '/starter-login',
    search: '?next=%2Fbrand-dashboard',
    member: TALENT,
  })
  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
})

test('a logged-out visitor is left completely alone on every bounce page', async () => {
  for (const pathname of ['/', '/login', '/starter-login', '/sign-up']) {
    const { location, attributes, events } = loadGuard({ pathname, member: null })
    await flush()
    assert.equal(location.replaced, undefined, pathname)
    // No error attribute and no "checking" stamp: these pages are authored for
    // signed-out visitors and must not depend on this script to be visible.
    assert.deepEqual(attributes, {}, pathname)
    assert.deepEqual(events, [], pathname)
  }
})

test('a bounce page with no Memberstack at all is left alone', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/',
    memberstackMissing: true,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(attributes, {})
})

test('an unmapped member stays on a bounce page with no error UI', async () => {
  const { location, attributes, events } = loadGuard({
    pathname: '/',
    member: UNMAPPED,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  // Deliberately different from a guarded page: no data-route-guard-error on a
  // public page. The console carries the diagnosis instead.
  assert.equal(attributes['data-route-guard-error'], undefined)
  assert.deepEqual(events, [])
})

test('a bounce page on an unapproved host is untouched', async () => {
  const { location, attributes } = loadGuard({
    hostname: 'attacker.example',
    pathname: '/',
    member: TALENT,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(attributes, {})
})

// --- Member-only role bounce pages --------------------------------------------

const FREE_DONE = {
  id: 'm-free-done',
  planConnections: [plan('pln_free-plan-f6kn0dxz')],
  customFields: { 'starter-quiz': '{"status":"ready"}' },
}

test('the role-bounce pages are recognised in both slash forms', () => {
  const { api } = loadGuard()
  for (const path of [
    '/quiz-results',
    '/quiz-results/',
    '/all-starters',
    '/all-starters/',
  ]) {
    assert.equal(api.isRoleBouncePage(path), true, path)
    // Critical: a role-bounce page must NOT be guarded. A guarded page sends a
    // logged-out visitor to a login form, and both of these serve anonymous
    // visitors by design.
    assert.equal(api.isGuardedPath(path), false, path)
    assert.equal(api.isMemberBouncePage(path), false, path)
  }
  for (const path of ['/quiz', '/about', '/all-starters/extra', '/']) {
    assert.equal(api.isRoleBouncePage(path), false, path)
  }
  // Spread the guard's arrays: they are built inside the vm realm, so a strict
  // deep comparison against a host array fails on the prototype alone.
  assert.deepEqual([...api.roleBounceRolesFor('/quiz-results')], ['brand-free'])
  assert.deepEqual(
    [...api.roleBounceRolesFor('/all-starters')],
    ['brand-paid', 'brand-free'],
  )
  assert.equal(api.roleBounceRolesFor('/quiz'), null)
  // A prototype key must not be mistaken for a configured page.
  assert.equal(api.isRoleBouncePage('constructor'), false)
  assert.equal(api.roleBounceTargetFor(TALENT, 'constructor'), '')
})

/**
 * The three page tables are three different contracts — force a login, bounce an
 * identified member off a public entry page, bounce a wrong-role member off a
 * public content page — and a path in two of them would be served by whichever
 * boot branch happens to run first. They are parsed out of the source rather
 * than copied here for the same reason as the auth-route parity sweep: a
 * hardcoded copy drifts exactly like the tables it is meant to police.
 */
function parsePageTables() {
  const pageRolesBlock = source.match(/var PAGE_ROLES = \{\n([\s\S]*?)\n {2}\}\n/)
  assert.ok(pageRolesBlock, 'PAGE_ROLES literal not found')
  const memberBounceBlock = source.match(
    /var MEMBER_BOUNCE_PAGES = new Set\(\[\n([\s\S]*?)\n {2}\]\)/,
  )
  assert.ok(memberBounceBlock, 'MEMBER_BOUNCE_PAGES literal not found')
  const roleBounceBlock = source.match(
    /var ROLE_BOUNCE_PAGES = \{\n([\s\S]*?)\n {2}\}\n/,
  )
  assert.ok(roleBounceBlock, 'ROLE_BOUNCE_PAGES literal not found')

  return {
    guarded: [...pageRolesBlock[1].matchAll(/^ {4}'([^']+)': \[/gm)].map(
      ([, path]) => path,
    ),
    memberBounce: [...memberBounceBlock[1].matchAll(/'([^']+)'/g)].map(
      ([, path]) => path,
    ),
    roleBounce: [...roleBounceBlock[1].matchAll(/^ {4}'([^']+)': \{/gm)].map(
      ([, path]) => path,
    ),
  }
}

test('no path appears in two of the three page tables', () => {
  const { api } = loadGuard()
  const { guarded, memberBounce, roleBounce } = parsePageTables()

  // Re-validate the parse through the live API, so a literal that stops
  // matching fails loudly instead of silently checking an empty list.
  assert.ok(guarded.length >= 15, 'parsed too few PAGE_ROLES entries')
  assert.equal(memberBounce.length, 4)
  assert.equal(roleBounce.length, 4)
  for (const path of guarded) assert.equal(api.isGuardedPath(path), true, path)
  for (const path of memberBounce) {
    assert.equal(api.isMemberBouncePage(path), true, path)
  }
  for (const path of roleBounce) {
    assert.equal(api.isRoleBouncePage(path), true, path)
  }

  const tables = { guarded, memberBounce, roleBounce }
  for (const [nameA, nameB] of [
    ['guarded', 'memberBounce'],
    ['guarded', 'roleBounce'],
    ['memberBounce', 'roleBounce'],
  ]) {
    const overlap = tables[nameA].filter((path) => tables[nameB].includes(path))
    assert.deepEqual(overlap, [], `${nameA} and ${nameB} share a path`)
  }
})

test('/quiz stays outside all three tables — its page controller owns it', () => {
  const { api } = loadGuard()
  for (const path of ['/quiz', '/quiz/']) {
    assert.equal(api.isGuardedPath(path), false, path)
    assert.equal(api.isMemberBouncePage(path), false, path)
    assert.equal(api.isRoleBouncePage(path), false, path)
  }
})

test('/quiz-results keeps only a free Brand, and only once the quiz is done', () => {
  const { api } = loadGuard()
  for (const path of ['/quiz-results', '/quiz-results/']) {
    // Done free Brand: this page IS its role home, so it stays.
    assert.equal(api.roleBounceTargetFor(FREE_DONE, path), '', path)
    // Free Brand mid-funnel is allowed by role but belongs at /quiz, because
    // there are no results to show yet.
    assert.equal(api.roleBounceTargetFor(BRAND_FREE, path), '/quiz', path)
    // Disallowed roles go to their own home, never the other role's page.
    assert.equal(api.roleBounceTargetFor(TALENT, path), '/starter-dashboard', path)
    assert.equal(
      api.roleBounceTargetFor(BRAND_PAID, path),
      '/brand-dashboard',
      path,
    )
    assert.equal(
      api.roleBounceTargetFor(TEST_BRAND, path),
      '/brand-dashboard',
      path,
    )
  }
})

test('/all-starters keeps both Brand tiers and bounces only Talent', () => {
  const { api } = loadGuard()
  for (const path of ['/all-starters', '/all-starters/']) {
    assert.equal(api.roleBounceTargetFor(BRAND_PAID, path), '', path)
    assert.equal(api.roleBounceTargetFor(TEST_BRAND, path), '', path)
    // No quiz-state enforcement here: a free Brand stays either way, which is
    // what separates this page from /quiz-results.
    assert.equal(api.roleBounceTargetFor(BRAND_FREE, path), '', path)
    assert.equal(api.roleBounceTargetFor(FREE_DONE, path), '', path)
    assert.equal(api.roleBounceTargetFor(TALENT, path), '/starter-dashboard', path)
  }
})

test('an unmapped or conflicted member gets no role-bounce target', () => {
  const { api } = loadGuard()
  const conflict = {
    id: 'm-conflict',
    planConnections: [
      plan('pln_dorxata-test-free-plan-dvcg0k8o'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }
  for (const path of ['/quiz-results', '/all-starters']) {
    assert.equal(api.roleBounceTargetFor(UNMAPPED, path), null, path)
    assert.equal(api.roleBounceTargetFor(conflict, path), null, path)
  }
  // And an untabled page is always a plain stay, even for those members.
  assert.equal(api.roleBounceTargetFor(UNMAPPED, '/about'), '')
})

test('no role home is bounced by its own role rule (role bounce cannot loop)', () => {
  const { api } = loadGuard()
  for (const member of [TALENT, BRAND_PAID, TEST_BRAND, BRAND_FREE, FREE_DONE]) {
    const home = api.roleHome(member)
    assert.ok(home, member.id)
    assert.equal(api.roleBounceTargetFor(member, home), '', home + ' ' + member.id)
    assert.equal(api.roleBounceTargetFor(member, home + '/'), '', home + '/')
  }
  // The one case where a role home IS a role-bounce page: /quiz-results is the
  // done free Brand's home, and it is on that page's allowlist, so the rule
  // resolves to "stay" rather than to a redirect back to itself.
  assert.equal(api.roleHome(FREE_DONE), '/quiz-results')
  assert.equal(api.isRoleBouncePage('/quiz-results'), true)
  assert.equal(api.roleBounceTargetFor(FREE_DONE, '/quiz-results'), '')
})

test('a role bounce target is never itself bounced again', () => {
  const { api } = loadGuard()
  const members = [TALENT, BRAND_PAID, TEST_BRAND, BRAND_FREE, FREE_DONE]
  for (const path of [
    '/quiz-results',
    '/quiz-results/',
    '/all-starters',
    '/all-starters/',
  ]) {
    for (const member of members) {
      const target = api.roleBounceTargetFor(member, path)
      if (target === '') continue
      // One hop only: whatever the bounce chose must be a place this member is
      // allowed to sit, under both the guarded table and the role-bounce table.
      assert.equal(api.roleBounceTargetFor(member, target), '', target)
      assert.equal(api.redirectTargetFor(member, target), '', target)
      assert.equal(api.isMemberBouncePage(target), false, target)
    }
  }
})

/**
 * The member-home bounce still honours a `?next=` to an unguarded page, and
 * /quiz-results is unguarded, so a Talent member arriving at /login?next=
 * /quiz-results is handed there and then bounced again by the role rule. That
 * is two redirects, not a loop: this asserts the chain terminates on a page the
 * member is allowed to sit on. Left as-is deliberately — teaching
 * bounceTargetFor about the role-bounce table would change member-bounce
 * behaviour, which this release does not touch.
 */
test('a member bounce handing off to a role-bounce page still terminates', () => {
  const { api } = loadGuard()
  const first = api.bounceTargetFor(TALENT, '/quiz-results')
  assert.equal(first, '/quiz-results')
  const second = api.roleBounceTargetFor(TALENT, first)
  assert.equal(second, '/starter-dashboard')
  assert.equal(api.roleBounceTargetFor(TALENT, second), '')
  assert.equal(api.redirectTargetFor(TALENT, second), '')
})

test('a Talent session on /all-starters is bounced to the Talent dashboard', async () => {
  const { location, attributes, events } = loadGuard({
    pathname: '/all-starters',
    member: TALENT,
  })
  // No "checking" stamp: this page must render for anonymous visitors without
  // waiting on the guard.
  assert.equal(attributes['data-route-guard'], undefined)
  await flush()
  assert.equal(location.replaced, '/starter-dashboard')
  assert.equal(attributes['data-route-guard'], 'redirecting')
  assert.ok(events.some((e) => e.name === 'starters:v3-route-guard-redirecting'))
})

test('a mid-funnel free Brand on /quiz-results is sent to the quiz', async () => {
  const { location } = loadGuard({
    pathname: '/quiz-results',
    member: BRAND_FREE,
  })
  await flush()
  assert.equal(location.replaced, '/quiz')
})

test('a done free Brand is left on /quiz-results untouched', async () => {
  const { location, attributes, events } = loadGuard({
    pathname: '/quiz-results',
    member: FREE_DONE,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  // Not even an "allowed" stamp: a role-bounce page gets no attributes at all
  // unless it is redirecting.
  assert.deepEqual(attributes, {})
  assert.deepEqual(events, [])
})

test('a paid Brand stays on /all-starters and is bounced off /quiz-results', async () => {
  const stay = loadGuard({ pathname: '/all-starters', member: BRAND_PAID })
  await flush()
  assert.equal(stay.location.replaced, undefined)
  assert.deepEqual(stay.attributes, {})

  const bounced = loadGuard({ pathname: '/quiz-results', member: BRAND_PAID })
  await flush()
  assert.equal(bounced.location.replaced, '/brand-dashboard')
})

// This is the contract that lets quiz-results.js keep serving pre-signup
// visitors whose answers are still in sessionStorage. If this test ever fails,
// that page is broken for everyone who has not signed up yet.
test('a logged-out visitor is left completely alone on every role-bounce page', async () => {
  for (const pathname of [
    '/quiz-results',
    '/quiz-results/',
    '/all-starters',
    '/all-starters/',
  ]) {
    const { location, attributes, events } = loadGuard({ pathname, member: null })
    await flush()
    assert.equal(location.replaced, undefined, pathname)
    assert.deepEqual(attributes, {}, pathname)
    assert.deepEqual(events, [], pathname)
  }
})

test('a role-bounce page with no Memberstack at all is left alone', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/quiz-results',
    memberstackMissing: true,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(attributes, {})
})

test('an unmapped member stays on a role-bounce page with no error UI', async () => {
  const { location, attributes, events } = loadGuard({
    pathname: '/all-starters',
    member: UNMAPPED,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  // Deliberately unlike a guarded page: no data-route-guard-error, because a
  // page that serves anonymous visitors is the wrong place to surface a
  // plan-configuration problem. The console carries the diagnosis.
  assert.equal(attributes['data-route-guard-error'], undefined)
  assert.deepEqual(events, [])
})

test('a late Memberstack boot still resolves a role bounce', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/all-starters',
    delayedMember: TALENT,
    memberstackDelayMs: 25,
  })
  assert.deepEqual(attributes, {})
  assert.equal(location.replaced, undefined)
  await waitFor(() => location.replaced === '/starter-dashboard')
})

test('a role-bounce page on an unapproved host is untouched', async () => {
  const { location, attributes } = loadGuard({
    hostname: 'attacker.example',
    pathname: '/quiz-results',
    member: TALENT,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.deepEqual(attributes, {})
})

// --- Homepage-only bounce overrides (2026-08-03) -------------------------------

function inactivePlan(planId) {
  // CANCELED is the status Memberstack is expected to report; the predicate is
  // deliberately status-agnostic, which the unit cases below pin down.
  return { active: false, status: 'CANCELED', planId }
}

// Sub-kind 1: paid Brand cancelled, the older free-Brand plan still live. Today
// this resolves to brand-free, so without the override it would be pushed into
// the quiz funnel.
const CANCELLED_WITH_FREE = {
  id: 'm-cancelled-with-free',
  planConnections: [
    inactivePlan('pln_new-paid-plan-463h04ph'),
    plan('pln_free-plan-f6kn0dxz'),
  ],
}

// Sub-kind 2: paid Brand cancelled and nothing active at all. Today this is
// unmapped-plan, so without the override the member would just sit on the
// homepage while the console logged a plan-configuration error.
const CANCELLED_NO_PLANS = {
  id: 'm-cancelled-no-plans',
  planConnections: [inactivePlan('pln_new-paid-plan-463h04ph')],
}

// The test-brand plan ID counts exactly the same as the production one.
const CANCELLED_TEST_BRAND = {
  id: 'm-cancelled-test-brand',
  planConnections: [inactivePlan('pln_dorxata-test-brand-plan-777r02pa')],
}

test('the cancelled-paid-Brand predicate covers both sub-kinds and both plan IDs', () => {
  const { api } = loadGuard()
  assert.equal(api.hasCancelledPaidBrandPlan(CANCELLED_WITH_FREE), true)
  assert.equal(api.hasCancelledPaidBrandPlan(CANCELLED_NO_PLANS), true)
  assert.equal(api.hasCancelledPaidBrandPlan(CANCELLED_TEST_BRAND), true)
  // Any inactive shape counts, not just the CANCELED status string.
  assert.equal(
    api.hasCancelledPaidBrandPlan({
      id: 'm-past-due',
      planConnections: [
        { active: false, status: 'PAST_DUE', planId: 'pln_new-paid-plan-463h04ph' },
      ],
    }),
    true,
  )
  assert.equal(
    api.hasCancelledPaidBrandPlan({
      id: 'm-bare-inactive',
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph' }],
    }),
    true,
  )
})

test('a member who never paid for Brand is never cancelled', () => {
  const { api } = loadGuard()
  for (const member of [TALENT, BRAND_FREE, FREE_DONE, UNMAPPED]) {
    assert.equal(api.hasCancelledPaidBrandPlan(member), false, member.id)
  }
  assert.equal(api.hasCancelledPaidBrandPlan({ id: 'm-empty', planConnections: [] }), false)
  assert.equal(api.hasCancelledPaidBrandPlan({ id: 'm-none' }), false)
  assert.equal(api.hasCancelledPaidBrandPlan(null), false)
  // An inactive plan that was never a paid Brand one is irrelevant.
  assert.equal(
    api.hasCancelledPaidBrandPlan({
      id: 'm-lapsed-free',
      planConnections: [inactivePlan('pln_free-plan-f6kn0dxz')],
    }),
    false,
  )
})

test('an active paid Brand is not cancelled even alongside an inactive paid one', () => {
  const { api } = loadGuard()
  // The re-subscribed case: an old cancelled connection plus a live one. The
  // live connection settles it, in either array order.
  const resubscribed = {
    id: 'm-resubscribed',
    planConnections: [
      inactivePlan('pln_new-paid-plan-463h04ph'),
      plan('pln_dorxata-test-brand-plan-777r02pa'),
    ],
  }
  const resubscribedReversed = {
    id: 'm-resubscribed-reversed',
    planConnections: [...resubscribed.planConnections].reverse(),
  }
  assert.equal(api.hasCancelledPaidBrandPlan(resubscribed), false)
  assert.equal(api.hasCancelledPaidBrandPlan(resubscribedReversed), false)
  assert.equal(api.hasCancelledPaidBrandPlan(BRAND_PAID), false)
  assert.equal(api.hasCancelledPaidBrandPlan(TEST_BRAND), false)
  // Still a paid Brand everywhere, override or not.
  assert.equal(api.bounceTargetFor(resubscribed, null, '/'), '/brand-dashboard')
  // The unverified cancel-at-period-end grace window resolves here: while the
  // connection still reports active the member keeps full paid-Brand access.
  assert.equal(api.memberRole(resubscribed), 'brand-paid')
})

test('a cancelled paid Brand is sent to /all-starters from the homepage only', () => {
  const { api } = loadGuard()
  for (const member of [CANCELLED_WITH_FREE, CANCELLED_NO_PLANS, CANCELLED_TEST_BRAND]) {
    assert.equal(api.bounceTargetFor(member, null, '/'), '/all-starters', member.id)
  }
})

test('the other three bounce pages keep their pre-override behaviour for a cancelled member', () => {
  const { api } = loadGuard()
  for (const pathname of ['/login', '/starter-login', '/sign-up']) {
    // Sub-kind 1 still resolves brand-free and still goes to the quiz funnel.
    assert.equal(api.bounceTargetFor(CANCELLED_WITH_FREE, null, pathname), '/quiz', pathname)
    // Sub-kind 2 is still unmapped and still stays where it is, with a
    // console-only error.
    assert.equal(api.bounceTargetFor(CANCELLED_NO_PLANS, null, pathname), null, pathname)
  }
})

test('a valid explicit next outranks the cancelled rule on the homepage', () => {
  const { api } = loadGuard()
  // Deep-link intent wins. /about is unguarded, which is the only kind of next
  // sub-kind 2 can honour — it has no role for the allowlist test.
  assert.equal(api.bounceTargetFor(CANCELLED_WITH_FREE, '/about', '/'), '/about')
  assert.equal(api.bounceTargetFor(CANCELLED_NO_PLANS, '/about', '/'), '/about')
  // A next this member may not view is not "valid", so the cancelled rule still
  // decides rather than handing them a page they would be bounced off again.
  assert.equal(api.bounceTargetFor(CANCELLED_WITH_FREE, '/messages', '/'), '/all-starters')
  // Neither is an off-origin or bounce-page next.
  assert.equal(
    api.bounceTargetFor(CANCELLED_WITH_FREE, 'https://attacker.example/x', '/'),
    '/all-starters',
  )
  assert.equal(api.bounceTargetFor(CANCELLED_WITH_FREE, '/login', '/'), '/all-starters')
})

test('a free Brand with no quiz stays on the homepage instead of being sent to /quiz', () => {
  const { api } = loadGuard()
  // '' is the stay signal, distinct from the null "cannot resolve" answer.
  assert.equal(api.bounceTargetFor(BRAND_FREE, null, '/'), '')
  assert.equal(
    api.bounceTargetFor({ id: 'm-blank', planConnections: [plan('pln_free-plan-f6kn0dxz')], customFields: { 'starter-quiz': '   ' } }, null, '/'),
    '',
  )
  // Quiz done: unchanged, the results page is a real destination now.
  assert.equal(api.bounceTargetFor(FREE_DONE, null, '/'), '/quiz-results')
  // A valid next still outranks the stay rule.
  assert.equal(api.bounceTargetFor(BRAND_FREE, '/about', '/'), '/about')
})

test('the stay rule is homepage-only — the login pages still send a free Brand to /quiz', () => {
  const { api } = loadGuard()
  for (const pathname of ['/login', '/starter-login', '/sign-up']) {
    assert.equal(api.bounceTargetFor(BRAND_FREE, null, pathname), '/quiz', pathname)
    assert.equal(api.bounceTargetFor(FREE_DONE, null, pathname), '/quiz-results', pathname)
  }
})

test('the homepage overrides leave guarded-page wrong-role redirects alone', () => {
  const { api } = loadGuard()
  // Guarded pages keep using brandFreeHome, so a not-yet-quizzed free Brand is
  // still sent to /quiz off a page it may not view. The overrides live in the
  // bounce path only.
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/brand-dashboard'), '/quiz')
  assert.equal(api.redirectTargetFor(BRAND_FREE, '/messages'), '/quiz')
  assert.equal(api.redirectTargetFor(FREE_DONE, '/brand-dashboard'), '/quiz-results')
  // Sub-kind 1 is brand-free on a guarded page, exactly as before.
  assert.equal(api.redirectTargetFor(CANCELLED_WITH_FREE, '/brand-dashboard'), '/quiz')
  // Sub-kind 2 still surfaces the unmapped error on a guarded page rather than
  // being quietly moved to /all-starters.
  assert.equal(api.redirectTargetFor(CANCELLED_NO_PLANS, '/brand-dashboard'), null)
})

test('cancelled outranks the stay rule when both would apply', () => {
  const { api } = loadGuard()
  // A cancelled Brand whose free plan is live and who never took the quiz
  // matches BOTH homepage rules. Cancelled wins: they already paid, so the quiz
  // funnel is the wrong ask and /all-starters is the useful page.
  assert.equal(api.memberRole(CANCELLED_WITH_FREE), 'brand-free')
  assert.equal(api.hasCompletedQuiz(CANCELLED_WITH_FREE), false)
  assert.equal(api.bounceTargetFor(CANCELLED_WITH_FREE, null, '/'), '/all-starters')
})

test('an unmapped member who never paid still just stays on the homepage', () => {
  const { api } = loadGuard()
  assert.equal(api.bounceTargetFor(UNMAPPED, null, '/'), null)
  const conflict = {
    id: 'm-conflict-home',
    planConnections: [
      plan('pln_dorxata-test-free-plan-dvcg0k8o'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }
  assert.equal(api.bounceTargetFor(conflict, null, '/'), null)
})

test('every other role is unaffected on the homepage', () => {
  const { api } = loadGuard()
  assert.equal(api.bounceTargetFor(BRAND_PAID, null, '/'), '/brand-dashboard')
  assert.equal(api.bounceTargetFor(TEST_BRAND, null, '/'), '/brand-dashboard')
  assert.equal(api.bounceTargetFor(TALENT, null, '/'), '/starter-dashboard')
})

test('/all-starters is a terminus for a cancelled member, so the redirect cannot loop', () => {
  const { api } = loadGuard()
  for (const member of [CANCELLED_WITH_FREE, CANCELLED_NO_PLANS]) {
    const target = api.bounceTargetFor(member, null, '/')
    assert.equal(target, '/all-starters', member.id)
    // /all-starters is a role-bounce page, not a guarded one, so it never forces
    // a login. Sub-kind 1 is an allowed brand-free (and the page does not
    // enforce quiz state); sub-kind 2 is unmapped, which the role bounce leaves
    // untouched by design. Either way the member stays.
    assert.notEqual(api.roleBounceTargetFor(member, target), '/all-starters')
    assert.equal(api.isGuardedPath(target), false)
    assert.equal(api.isMemberBouncePage(target), false)
  }
  assert.equal(api.roleBounceTargetFor(CANCELLED_WITH_FREE, '/all-starters'), '')
  // null is the role bounce's "stay silently" answer, not a redirect.
  assert.equal(api.roleBounceTargetFor(CANCELLED_NO_PLANS, '/all-starters'), null)
})

test('a cancelled paid Brand on the homepage is redirected to /all-starters at runtime', async () => {
  for (const member of [CANCELLED_WITH_FREE, CANCELLED_NO_PLANS]) {
    const { location, attributes, events } = loadGuard({ pathname: '/', member })
    await flush()
    assert.equal(location.replaced, '/all-starters', member.id)
    assert.equal(attributes['data-route-guard'], 'redirecting')
    assert.ok(events.some((e) => e.name === 'starters:v3-route-guard-redirecting'))
  }
})

test('a cancelled paid Brand then stays on /all-starters at runtime', async () => {
  for (const member of [CANCELLED_WITH_FREE, CANCELLED_NO_PLANS]) {
    const { location, attributes, events } = loadGuard({
      pathname: '/all-starters',
      member,
    })
    await flush()
    assert.equal(location.replaced, undefined, member.id)
    // A role-bounce page sets no attributes unless it is redirecting.
    assert.deepEqual(attributes, {})
    assert.deepEqual(events, [])
  }
})

test('a cancelled paid Brand on the homepage honours a valid ?next= at runtime', async () => {
  const { location } = loadGuard({
    pathname: '/',
    search: '?next=%2Fabout',
    member: CANCELLED_WITH_FREE,
  })
  await flush()
  assert.equal(location.replaced, '/about')
})

test('a cancelled paid Brand on /login keeps todays behaviour at runtime', async () => {
  const funnelled = loadGuard({ pathname: '/login', member: CANCELLED_WITH_FREE })
  await flush()
  assert.equal(funnelled.location.replaced, '/quiz')

  const stranded = loadGuard({ pathname: '/login', member: CANCELLED_NO_PLANS })
  await flush()
  assert.equal(stranded.location.replaced, undefined)
  assert.deepEqual(stranded.attributes, {})
})

test('a free Brand with no quiz is left completely untouched on the homepage at runtime', async () => {
  const { location, attributes, events } = loadGuard({
    pathname: '/',
    member: BRAND_FREE,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  // The stay must be invisible: no redirect, and no attribute or event either,
  // exactly like a logged-out visitor.
  assert.deepEqual(attributes, {})
  assert.deepEqual(events, [])
})

test('a quiz-done free Brand is still sent to /quiz-results from the homepage at runtime', async () => {
  const { location } = loadGuard({ pathname: '/', member: FREE_DONE })
  await flush()
  assert.equal(location.replaced, '/quiz-results')
})

test('a free Brand with no quiz is still sent to /quiz from the login pages at runtime', async () => {
  for (const pathname of ['/login', '/starter-login', '/sign-up']) {
    const { location } = loadGuard({ pathname, member: BRAND_FREE })
    await flush()
    assert.equal(location.replaced, '/quiz', pathname)
  }
})

test('an active paid Brand on the homepage is still sent to /brand-dashboard at runtime', async () => {
  const { location } = loadGuard({ pathname: '/', member: BRAND_PAID })
  await flush()
  assert.equal(location.replaced, '/brand-dashboard')
})

// --- Release marker -----------------------------------------------------------

test('the header @release marker matches the exported release property', () => {
  const { api } = loadGuard()
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the route-guard.js header')
  assert.equal(api.release, marker[1])
})
