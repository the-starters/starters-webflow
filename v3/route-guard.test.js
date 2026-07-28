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
  if (Object.prototype.hasOwnProperty.call(options, 'member')) {
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

test('/quiz-results and /all-starters are intentionally NOT guarded', () => {
  const { api } = loadGuard()
  // Decision 2026-07-23: excluded pending confirmation they are not pre-signup
  // funnel pages. The guard must never force a login there even if installed.
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

test('paid Brand precedence when a member holds several mapped active plans', () => {
  const { api } = loadGuard()
  const multi = {
    id: 'm-multi',
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o'), plan('pln_new-paid-plan-463h04ph')],
  }
  assert.equal(api.memberRole(multi), 'brand-paid')
  assert.equal(api.redirectTargetFor(multi, '/brand-dashboard'), '')
  assert.equal(api.redirectTargetFor(multi, '/starter-dashboard'), '/brand-dashboard')
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

test('surfaces an unmapped plan on a guarded page instead of redirecting home', async () => {
  const { location, attributes } = loadGuard({
    pathname: '/brand-dashboard',
    member: UNMAPPED,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(attributes['data-route-guard-error'], 'unmapped-plan')
})

test('sets the checking state synchronously on a guarded page', () => {
  const { attributes } = loadGuard({
    pathname: '/brand-dashboard',
    member: BRAND_PAID,
  })
  assert.equal(attributes['data-route-guard'], 'checking')
})
