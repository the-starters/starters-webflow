const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const controllerSource = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')
const routeGuardSource = fs.readFileSync(require.resolve('./v3/route-guard.js'), 'utf8')

function plan(planId) {
    return { active: true, planId }
}

const BRAND_FREE = {
    id: 'm-brand-free',
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
}
const BRAND_PAID = {
    id: 'm-brand-paid',
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
}
const TALENT = {
    id: 'm-talent',
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
}
const QUIZ_EMAIL_TEST_CANARY = {
    ...BRAND_PAID,
    auth: { email: 'jp+brand10@thestarters.com' },
}

function savedResult(starterCount = 3) {
    return {
        status: 'ready',
        categories: [{ id: 'paid-media', label: 'Paid Media' }],
        subcategories: [
            {
                id: 'paid-social',
                label: 'Paid Social',
                categoryId: 'paid-media',
            },
        ],
        featuredFreelancers: [{ objectID: 'starter-1', name: 'Starter One' }],
        recommendedFreelancerGroups: [],
        recommendationIssues: [],
        recommendationVersion: 'category-subcategory-pairs-v21',
        starterCount,
        memberstackSavedAt: '2026-09-20T00:00:00.000Z',
    }
}

function makeStorage(initial = {}) {
    const values = new Map(Object.entries(initial))
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    }
}

function emptyElement(tagName = 'div') {
    const attributes = new Map()
    return {
        tagName: tagName.toUpperCase(),
        children: [],
        classList: { add() {}, contains: () => false, remove() {}, toggle() {} },
        dataset: {},
        style: {},
        append(...children) { this.children.push(...children) },
        appendChild(child) { this.children.push(child); return child },
        insertBefore(child) { this.children.unshift(child); return child },
        addEventListener() {},
        contains: () => false,
        getAttribute: (name) => attributes.has(name) ? attributes.get(name) : null,
        hasAttribute: (name) => attributes.has(name),
        querySelector: () => null,
        querySelectorAll: () => [],
        removeAttribute: (name) => attributes.delete(name),
        setAttribute: (name, value) => attributes.set(name, String(value)),
    }
}

function createHarness(options = {}) {
    const attributes = new Map()
    const captures = []
    const listeners = new Map()
    const events = []
    let authReads = 0
    const hostname = options.hostname || 'thestarters.com'
    const pathname = options.pathname || '/quiz-results'
    const search = options.search || ''
    const location = {
        hostname,
        host: hostname,
        origin: `https://${hostname}`,
        pathname,
        search,
        hash: '',
        href: `https://${hostname}${pathname}${search}`,
        replace(target) { location.replaced = target },
    }
    const documentElement = emptyElement('html')
    documentElement.getAttribute = (name) => attributes.has(name) ? attributes.get(name) : null
    documentElement.setAttribute = (name, value) => attributes.set(name, String(value))
    const body = emptyElement('body')
    const document = {
        body,
        currentScript: null,
        documentElement,
        head: emptyElement('head'),
        readyState: 'loading',
        addEventListener(type, listener) {
            const registered = listeners.get(type) || []
            registered.push(listener)
            listeners.set(type, registered)
        },
        createElement: (tagName) => emptyElement(tagName),
        createTextNode: (text) => ({ textContent: String(text) }),
        dispatchEvent(event) { events.push(event) },
        querySelector: () => null,
        querySelectorAll: () => [],
    }
    const member = Object.prototype.hasOwnProperty.call(options, 'member')
        ? options.member
        : BRAND_FREE
    const pending = Object.prototype.hasOwnProperty.call(options, 'pending')
        ? options.pending
        : savedResult()
    const sessionStorage = makeStorage(
        pending ? { starterQuizPending: JSON.stringify(pending) } : {},
    )
    const window = {
        CustomEvent: class CustomEvent {
            constructor(name, init) { this.name = name; this.detail = init?.detail }
        },
        URL,
        URLSearchParams,
        addEventListener() {},
        dispatchEvent() {},
        location,
        localStorage: makeStorage(),
        sessionStorage,
        requestAnimationFrame(callback) { return setTimeout(callback, 0) },
        setInterval,
        setTimeout,
        clearInterval,
        clearTimeout,
        $memberstackDom: {
            async getCurrentMember() {
                authReads += 1
                if (options.authResponsePromise) {
                    return options.authResponsePromise
                }
                if (options.authThrows) throw new Error('Memberstack unavailable')
                if (options.unresolvedAuth) return {}
                return { data: member }
            },
        },
        StartersTrack: {
            track(name, properties) {
                captures.push({ name, properties })
                if (options.trackerThrows) throw new Error('tracker unavailable')
            },
        },
    }
    const context = {
        console: { error() {}, log() {}, warn() {} },
        CustomEvent: window.CustomEvent,
        URL,
        URLSearchParams,
        document,
        fetch: async () => ({ ok: false, json: async () => ({}), text: async () => '' }),
        getComputedStyle: () => ({}),
        localStorage: window.localStorage,
        location,
        sessionStorage,
        window,
        setInterval,
        setTimeout,
        clearInterval,
        clearTimeout,
    }

    if (!options.routeGuardMissing) vm.runInNewContext(routeGuardSource, context)
    if (options.trackerMissing) delete window.StartersTrack
    if (options.redirecting) attributes.set('data-route-guard', 'redirecting')
    vm.runInNewContext(controllerSource, context)

    return {
        attributes,
        captures,
        events,
        listeners,
        location,
        window,
        get authReads() { return authReads },
        boot() {
            for (const listener of listeners.get('DOMContentLoaded') || []) listener()
        },
    }
}

async function waitForSettled(harness, timeoutMs = 1000) {
    const startedAt = Date.now()
    while (!harness.window.__starterQuizResultsReady) {
        if (Date.now() - startedAt >= timeoutMs) {
            assert.fail('quiz results controller did not settle')
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(predicate, message, timeoutMs = 1000) {
    const startedAt = Date.now()
    while (!predicate()) {
        if (Date.now() - startedAt >= timeoutMs) assert.fail(message)
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

test('real Brand Free result boot emits once with the rendered match count', async () => {
    const harness = createHarness({ member: BRAND_FREE })
    harness.boot()
    await waitForSettled(harness)

    assert.equal(harness.captures.length, 1)
    assert.equal(harness.captures[0].name, 'quiz_results_viewed')
    assert.equal(harness.captures[0].properties.match_count, 3)
    assert.deepEqual(Object.keys(harness.captures[0].properties), ['match_count'])
})

test('a duplicate DOMContentLoaded invocation cannot capture twice', async () => {
    const harness = createHarness({ member: BRAND_FREE })
    harness.boot()
    await waitForSettled(harness)
    assert.equal(harness.window.starterQuizResultsController, true)
    assert.equal(harness.captures.length, 1)
    assert.equal(harness.listeners.get('DOMContentLoaded').length, 1)
    harness.boot()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(harness.captures.length, 1)
})

test('actual synthetic URL result boot renders without analytics', async () => {
    const harness = createHarness({
        search: '?starterQuizTest=1',
        pending: null,
        member: null,
    })
    harness.boot()
    await waitForSettled(harness)

    assert.equal(harness.captures.length, 0)
    assert.equal(harness.location.replaced, undefined)
})

test('real zero-match result emits an explicit zero count', async () => {
    const harness = createHarness({ pending: savedResult(0) })
    harness.boot()
    await waitForSettled(harness)

    assert.equal(harness.captures.length, 1)
    assert.equal(harness.captures[0].properties.match_count, 0)
})

test('the exact governed paid-Brand email canary emits on production', async () => {
    const harness = createHarness({
        member: QUIZ_EMAIL_TEST_CANARY,
        search: '?quizEmailTest=1',
    })
    harness.boot()
    await waitForSettled(harness)

    assert.equal(harness.captures.length, 1)
    assert.equal(harness.location.replaced, undefined)
})

test('wrong and unresolved roles fail closed during real boot', async () => {
    for (const member of [TALENT, BRAND_PAID, { id: 'm-unmapped' }]) {
        const harness = createHarness({ member })
        harness.boot()
        await waitForSettled(harness)
        assert.equal(harness.captures.length, 0)
    }
})

test('wrong path, missing guard and unavailable auth fail closed', async () => {
    const cases = [
        createHarness({ pathname: '/starter-dashboard' }),
        createHarness({ routeGuardMissing: true }),
        createHarness({ unresolvedAuth: true }),
        createHarness({ member: null }),
        createHarness({ authThrows: true }),
    ]
    for (const harness of cases) {
        harness.boot()
        await waitForSettled(harness)
        assert.equal(harness.captures.length, 0)
    }
})

test('redirect state prevents capture during real boot', async () => {
    const harness = createHarness({ redirecting: true })
    harness.boot()
    await waitForSettled(harness)
    assert.equal(harness.captures.length, 0)
})

test('a redirect that starts during awaited auth prevents capture', async () => {
    let resolveAuth
    const authResponsePromise = new Promise((resolve) => { resolveAuth = resolve })
    const pending = savedResult()
    delete pending.memberstackSavedAt
    const harness = createHarness({ pending, authResponsePromise })

    harness.boot()
    await waitFor(
        () => harness.authReads >= 2,
        'tracking did not reach its awaited Memberstack read',
    )
    harness.attributes.set('data-route-guard', 'redirecting')
    resolveAuth({ data: BRAND_FREE })
    await waitForSettled(harness)

    assert.equal(harness.captures.length, 0)
})

test('missing or throwing analytics never rejects controller boot', async () => {
    const missing = createHarness({ trackerMissing: true })
    const throwing = createHarness({ trackerThrows: true })
    missing.boot()
    throwing.boot()
    await waitForSettled(missing)
    await waitForSettled(throwing)

    assert.equal(missing.captures.length, 0)
    assert.equal(throwing.captures.length, 1)
})
