const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
    require.resolve('./quiz-results-email-tester.js'),
    'utf8',
)

function response({ ok = true, status = 200, data = {} } = {}) {
    return {
        ok,
        status,
        async json() {
            return data
        },
    }
}

function createHarness({
    fetch,
    learnConfig,
    managedConfig,
    memberstack,
    query = '',
    savedState,
} = {}) {
    const store = new Map()
    const document = {
        readyState: 'complete',
        querySelector() {
            return null
        },
    }
    const sessionStorage = {
        getItem(key) {
            return store.get(key) || null
        },
        setItem(key, value) {
            store.set(key, value)
        },
        removeItem(key) {
            store.delete(key)
        },
    }
    const window = {
        __STARTERS_QUIZ_EMAIL_TEST_HOOKS__: true,
        __startersQuizEmailTestSavedState: savedState,
        StartersV3AlgoliaEnvironment: {
            getManagedSearchConfig(resource) {
                assert.equal(resource, 'starters')
                return managedConfig === null
                    ? null
                    : managedConfig || {
                          appId: 'MANAGEDAPP',
                          searchKey: 'managed-search-key',
                          indexName: 'Freelancers3.0-production',
                          environment: 'production',
                      }
            },
        },
        $memberstackDom: memberstack,
        crypto: crypto.webcrypto,
        fetch: fetch || (async () => response()),
        location: { search: query },
        setTimeout,
        starterQuizLearnContentAlgoliaConfig:
            learnConfig === null
                ? null
                : learnConfig || {
                      appId: 'SHAREDAPP',
                      searchKey: 'shared-learn-key',
                      indexName: 'LearnContent',
                  },
    }
    window.window = window

    const context = vm.createContext({
        URL,
        URLSearchParams,
        TextEncoder,
        console,
        document,
        fetch: window.fetch,
        Map,
        Promise,
        sessionStorage,
        Set,
        window,
    })
    vm.runInContext(source, context)

    return {
        hooks: window.StartersQuizEmailTesterTesting,
        sessionStorage,
        store,
        window,
    }
}

test('does not require native panel elements without the query gate', () => {
    const harness = createHarness()

    assert.ok(harness.hooks)
    assert.equal(harness.window.__startersQuizEmailTesterBooted, true)
})

test('waits for the results owner to publish the current saved quiz', async () => {
    let resolveSavedState
    let settled = false
    const savedState = {
        ready: new Promise((resolve) => {
            resolveSavedState = resolve
        }),
    }
    const harness = createHarness({
        memberstack: {
            async getCurrentMember() {
                return {
                    data: {
                        id: 'mem_brand_10',
                        auth: { email: 'jp+brand10@thestarters.com' },
                    },
                }
            },
        },
        savedState,
    })

    const contextPromise = harness.hooks.readContext().then((context) => {
        settled = true
        return context
    })
    await new Promise(setImmediate)
    assert.equal(settled, false)

    resolveSavedState({
        quiz: {
            updatedAt: '2026-08-10T09:15:00.000Z',
            featuredFreelancerIds: ['current-1', 'current-2', 'current-3'],
        },
    })

    const context = await contextPromise
    assert.equal(context.quiz.updatedAt, '2026-08-10T09:15:00.000Z')
    assert.deepEqual(Array.from(context.quiz.featuredFreelancerIds), [
        'current-1',
        'current-2',
        'current-3',
    ])
})

test('renders escaped quiz, Starter, and Learn content', () => {
    const { hooks } = createHarness()
    const html = hooks.renderEmail(
        {
            categories: [{ id: 'creative', label: '<Creative>' }],
            subcategories: [{ id: 'brand', label: 'Brand & Voice' }],
        },
        [
            {
                name: 'Alex <Admin>',
                roles: ['Designer'],
                tagline: 'Safe & fast',
                image: 'https://example.com/alex.jpg',
                url: 'https://www.thestarters.com/hire/alex',
            },
        ],
        [
            {
                title: 'Learn "Now"',
                type: 'Guide',
                matchedCategory: 'Creative',
                description: 'Useful & current',
                image: 'https://example.com/learn.jpg',
                url: 'https://www.thestarters.com/learn/now',
            },
        ],
    )

    assert.match(html, /&lt;Creative&gt;/)
    assert.match(html, /Alex &lt;Admin&gt;/)
    assert.match(html, /Brand &amp; Voice/)
    assert.match(html, /Learn &quot;Now&quot;/)
    assert.doesNotMatch(html, /<Creative>/)
})

test('hydrates current Starter and Learn records from the expected Algolia indexes', async () => {
    const calls = []
    const harness = createHarness({
        fetch: async (url, options) => {
            calls.push({ url, options })
            if (url.endsWith('/1/indexes/*/objects')) {
                return response({
                    data: {
                        results: ['11', '22', '33'].map((id) => ({
                            objectID: id,
                            name: `Starter ${id}`,
                            slug: `starter-${id}`,
                            roles: ['creative-director'],
                            tagline: `Tagline ${id}`,
                            'profile-photo-xano': `https://images.example/${id}.jpg`,
                        })),
                    },
                })
            }
            if (url.endsWith('/1/indexes/LearnContent/query')) {
                return response({
                    data: {
                        hits: [
                            {
                                objectID: 'learn-1',
                                name: 'Current Learn item',
                                content_type: { lvl0: 'Guide' },
                                description: 'Fresh advice',
                                thumbnail_url: 'https://images.example/learn.jpg',
                                url: '/learn/current',
                            },
                        ],
                    },
                })
            }
            throw new Error(`Unexpected request: ${url}`)
        },
    })

    const built = await harness.hooks.buildMessage({
        updatedAt: '2026-08-10T08:00:00.000Z',
        categories: [{ id: 'creative', label: 'Creative' }],
        subcategories: [{ id: 'brand', label: 'Brand' }],
        subcategoryIds: ['brand'],
        featuredFreelancerIds: ['11', '22', '33'],
    })

    assert.equal(built.summary, '3 Starters · 1 Learn items')
    assert.match(built.html, /Starter 11/)
    assert.match(built.html, /Current Learn item/)
    assert.deepEqual(
        calls.map((call) => ({
            appId: call.options.headers['x-algolia-application-id'],
            indexPath: new URL(call.url).pathname,
            searchKey: call.options.headers['x-algolia-api-key'],
        })),
        [
            {
                appId: 'MANAGEDAPP',
                indexPath: '/1/indexes/*/objects',
                searchKey: 'managed-search-key',
            },
            {
                appId: 'SHAREDAPP',
                indexPath: '/1/indexes/LearnContent/query',
                searchKey: 'shared-learn-key',
            },
        ],
    )
    const peopleRequest = JSON.parse(calls[0].options.body)
    assert.deepEqual(
        peopleRequest.requests.map((request) => request.indexName),
        [
            'Freelancers3.0-production',
            'Freelancers3.0-production',
            'Freelancers3.0-production',
        ],
    )
})

test('fails closed without resolved managed and LearnContent configuration', async () => {
    const quiz = {
        categories: [{ id: 'creative', label: 'Creative' }],
        featuredFreelancerIds: ['11', '22', '33'],
    }
    await assert.rejects(
        createHarness({ managedConfig: null }).hooks.buildMessage(quiz),
        /Managed Algolia search configuration is unavailable/,
    )
    await assert.rejects(
        createHarness({ learnConfig: null }).hooks.buildMessage(quiz),
        /LearnContent Algolia search configuration is unavailable/,
    )
})

test('trades the Memberstack cookie and sends only the controlled payload to Xano', async () => {
    const calls = []
    const harness = createHarness({
        fetch: async (url, options = {}) => {
            calls.push({ url, options })
            if (url.includes('/auth/trade-token/v3')) {
                return response({ data: { authToken: 'xano-auth-token' } })
            }
            if (url.endsWith('/quiz_email_test/send/v3')) {
                return response({
                    data: {
                        ok: true,
                        replayed: false,
                        status: 'sent',
                        audit_id: 123,
                    },
                })
            }
            throw new Error(`Unexpected request: ${url}`)
        },
    })

    const result = await harness.hooks.sendMessage(
        {
            memberstack: {
                async getMemberCookie() {
                    return 'memberstack-cookie'
                },
            },
        },
        {
            revision: 'quiz-results-email-v3.1:revision',
            html: '<!doctype html>' + 'x'.repeat(1200),
        },
    )

    assert.equal(result.audit_id, 123)
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /token=memberstack-cookie/)
    assert.equal(calls[1].options.headers.authorization, 'Bearer xano-auth-token')

    const body = JSON.parse(calls[1].options.body)
    assert.match(body.idempotency_key, /^quiz-email-v3:/)
    assert.equal(body.quiz_revision, 'quiz-results-email-v3.1:revision')
    assert.equal(body.html.length, 1215)
    assert.equal(Object.hasOwn(body, 'recipient'), false)
    assert.equal(harness.store.has('starterQuizEmailTestPendingKey'), false)
})

test('reuses a retry key only for the same quiz revision', async () => {
    const requestBodies = []
    let sendAttempt = 0
    const harness = createHarness({
        fetch: async (url, options = {}) => {
            if (url.includes('/auth/trade-token/v3')) {
                return response({ data: { authToken: 'xano-auth-token' } })
            }
            if (url.endsWith('/quiz_email_test/send/v3')) {
                requestBodies.push(JSON.parse(options.body))
                sendAttempt += 1
                if (sendAttempt < 3) {
                    return response({
                        ok: false,
                        status: 503,
                        data: { message: 'Ambiguous provider failure' },
                    })
                }
                return response({
                    data: { ok: true, status: 'sent', audit_id: 456 },
                })
            }
            throw new Error(`Unexpected request: ${url}`)
        },
    })
    const context = {
        memberstack: {
            async getMemberCookie() {
                return 'memberstack-cookie'
            },
        },
    }

    await assert.rejects(
        harness.hooks.sendMessage(context, {
            revision: 'quiz-results-email-v3.1:quiz-a',
            html: '<!doctype html>' + 'a'.repeat(1200),
        }),
        /Ambiguous provider failure/,
    )
    await assert.rejects(
        harness.hooks.sendMessage(context, {
            revision: 'quiz-results-email-v3.1:quiz-a',
            html: '<!doctype html>' + 'a'.repeat(1200),
        }),
        /Ambiguous provider failure/,
    )
    await harness.hooks.sendMessage(context, {
        revision: 'quiz-results-email-v3.1:quiz-b',
        html: '<!doctype html>' + 'b'.repeat(1200),
    })

    assert.equal(
        requestBodies[0].idempotency_key,
        requestBodies[1].idempotency_key,
    )
    assert.notEqual(
        requestBodies[1].idempotency_key,
        requestBodies[2].idempotency_key,
    )
})
