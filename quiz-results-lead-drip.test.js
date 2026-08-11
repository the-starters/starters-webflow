const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')
const recommendationVersion = 'category-subcategory-pairs-v18'

function response({ ok = true, status = 200, data = {} } = {}) {
    return {
        ok,
        status,
        async json() {
            return data
        },
    }
}

function createStorage(initialQuiz) {
    const values = new Map()
    if (initialQuiz) {
        values.set('starterQuizPending', JSON.stringify(initialQuiz))
    }

    return {
        getItem(key) {
            return values.get(key) || null
        },
        setItem(key, value) {
            values.set(key, value)
        },
        removeItem(key) {
            values.delete(key)
        },
    }
}

function completedQuiz(overrides = {}) {
    return {
        status: 'ready',
        updatedAt: '2026-08-11T04:00:00.000Z',
        completedAt: '2026-08-11T04:00:00.000Z',
        resultSlug: 'growth-team',
        categories: [{ id: 'paid-media', label: 'Paid Media' }],
        subcategories: [
            {
                id: 'paid-social',
                label: 'Paid Social',
                categoryId: 'paid-media',
            },
        ],
        featuredFreelancers: [
            {
                objectID: 'starter-1',
                name: 'Alex Morgan',
                slug: 'alex-morgan',
                roles: ['Creative Director'],
            },
            {
                objectID: 'starter-2',
                first_name: 'Sam',
                name: 'Sam Rivera',
                slug: 'sam-rivera',
            },
        ],
        recommendedFreelancerGroups: [],
        recommendationIssues: [],
        recommendationVersion,
        starterCount: 2,
        ...overrides,
    }
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return
        await new Promise(setImmediate)
    }
    assert.fail('controller did not reach the expected observable state')
}

async function runController({
    storage,
    enrollmentResponses,
    waitUntil,
    tradeTokenResponse = { authToken: 'xano-token' },
}) {
    const documentListeners = new Map()
    const fetchCalls = []
    const memberJsonWrites = []
    const memberUpdates = []
    const emptyStorage = createStorage()
    const document = {
        body: {},
        cookie: '',
        head: { appendChild() {} },
        readyState: 'loading',
        addEventListener(type, listener) {
            const listeners = documentListeners.get(type) || []
            listeners.push(listener)
            documentListeners.set(type, listeners)
        },
        createElement() {
            return { dataset: {} }
        },
        createTextNode(value) {
            return { textContent: value }
        },
        dispatchEvent() {},
        querySelector() {
            return null
        },
        querySelectorAll() {
            return []
        },
    }
    const memberstack = {
        async getCurrentMember() {
            return { data: { id: 'mem_brand_10', customFields: {} } }
        },
        async getMemberCookie() {
            return 'memberstack-session'
        },
        async getMemberJSON() {
            return { data: {} }
        },
        async updateMemberJSON(payload) {
            memberJsonWrites.push(payload)
        },
        async updateMember(payload) {
            memberUpdates.push(payload)
        },
    }
    const fetch = async (url, options = {}) => {
        fetchCalls.push({ url: String(url), options })
        if (String(url).includes('/auth/trade-token/v3')) {
            return response({ data: tradeTokenResponse })
        }
        return enrollmentResponses.shift() || response({
            data: { ok: true, status: 'accepted', replayed: false },
        })
    }
    const runSoon = (callback) => {
        queueMicrotask(callback)
        return 1
    }
    const window = {
        $memberstackDom: memberstack,
        addEventListener() {},
        clearInterval() {},
        dispatchEvent() {},
        location: { search: '', replace() {} },
        requestAnimationFrame: runSoon,
        sessionStorage: storage,
        setInterval: runSoon,
        setTimeout: runSoon,
    }
    window.window = window

    class CustomEvent {
        constructor(type, options = {}) {
            this.type = type
            this.detail = options.detail
        }
    }

    vm.runInContext(
        source,
        vm.createContext({
            CustomEvent,
            Map,
            Promise,
            Set,
            URL,
            URLSearchParams,
            console: { log() {}, warn() {}, error() {} },
            document,
            fetch,
            localStorage: emptyStorage,
            sessionStorage: storage,
            setTimeout: runSoon,
            window,
        }),
    )

    for (const listener of documentListeners.get('DOMContentLoaded') || []) {
        listener()
    }

    await waitFor(() => waitUntil({ fetchCalls, window }))
    await new Promise(setImmediate)

    return { fetchCalls, memberJsonWrites, memberUpdates, window }
}

function enrollmentCalls(calls) {
    return calls.filter((call) => call.url.includes('/quiz_email/enroll/v3'))
}

test('completed quiz posts current matches with safe email properties', async () => {
    const storage = createStorage(
        completedQuiz({ memberstackSavedAt: '2026-08-11T04:01:00.000Z' }),
    )
    const harness = await runController({
        storage,
        enrollmentResponses: [],
        waitUntil: ({ fetchCalls }) => enrollmentCalls(fetchCalls).length === 1,
    })
    const calls = enrollmentCalls(harness.fetchCalls)
    const payload = JSON.parse(calls[0].options.body)

    assert.equal(calls[0].options.headers.Authorization, 'Bearer xano-token')
    assert.equal(payload.properties.quiz_revision, '2026-08-11T04:00:00.000Z')
    assert.equal(payload.properties.starter_1_first_name, 'Alex')
    assert.equal(payload.properties.starter_2_first_name, 'Sam')
    assert.equal(payload.properties.starter_count, '2')
    assert.equal(payload.properties.learn_count, '0')
    assert.equal(payload.properties.learn_title, 'Explore more expert guidance')
    assert.equal(
        payload.properties.learn_url,
        'https://thestarters.com/learn?source=quiz-results-email',
    )
})

for (const [label, tradeTokenResponse] of [
    ['raw string', 'xano-token'],
    ['token property', { token: 'xano-token' }],
]) {
    test(`completed quiz accepts a ${label} trade-token response`, async () => {
        const storage = createStorage(
            completedQuiz({ memberstackSavedAt: '2026-08-11T04:01:00.000Z' }),
        )
        const harness = await runController({
            storage,
            enrollmentResponses: [],
            tradeTokenResponse,
            waitUntil: ({ fetchCalls }) => enrollmentCalls(fetchCalls).length === 1,
        })

        assert.equal(
            enrollmentCalls(harness.fetchCalls)[0].options.headers.Authorization,
            'Bearer xano-token',
        )
    })
}

test('failed enrollment is replayed from the saved quiz on refresh', async () => {
    const storage = createStorage(completedQuiz())
    const failures = Array.from({ length: 3 }, () =>
        response({ ok: false, status: 503 }),
    )
    const firstRun = await runController({
        storage,
        enrollmentResponses: failures,
        waitUntil: ({ fetchCalls }) => enrollmentCalls(fetchCalls).length === 3,
    })
    const savedAfterFailure = JSON.parse(
        storage.getItem('starterQuizPending'),
    )

    assert.equal(firstRun.memberJsonWrites.length, 1)
    assert.equal(firstRun.memberUpdates.length, 1)
    assert.ok(savedAfterFailure.memberstackSavedAt)

    const secondRun = await runController({
        storage,
        enrollmentResponses: [
            response({
                data: { ok: true, status: 'accepted', replayed: false },
            }),
        ],
        waitUntil: ({ fetchCalls }) => enrollmentCalls(fetchCalls).length === 1,
    })
    const firstPayload = JSON.parse(
        enrollmentCalls(firstRun.fetchCalls)[0].options.body,
    )
    const replayPayload = JSON.parse(
        enrollmentCalls(secondRun.fetchCalls)[0].options.body,
    )

    assert.equal(secondRun.memberJsonWrites.length, 0)
    assert.equal(secondRun.memberUpdates.length, 0)
    assert.equal(
        replayPayload.properties.quiz_revision,
        firstPayload.properties.quiz_revision,
    )
})

test('unfinished quiz never registers a V3 email event', async () => {
    const storage = createStorage(completedQuiz({ status: 'draft' }))
    const harness = await runController({
        storage,
        enrollmentResponses: [],
        waitUntil: ({ window }) => window.__starterQuizResultsReady === true,
    })

    assert.equal(enrollmentCalls(harness.fetchCalls).length, 0)
    assert.equal(harness.memberJsonWrites.length, 0)
    assert.equal(harness.memberUpdates.length, 0)
})
