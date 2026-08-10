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

function createHarness({ fetch, query = '' } = {}) {
    const store = new Map()
    const configScript = {
        getAttribute(name) {
            return {
                'data-app-id': 'PKVW6M9OPZ',
                'data-search-key': 'public-search-key',
            }[name]
        },
    }
    const document = {
        readyState: 'complete',
        querySelector(selector) {
            if (selector === 'script[data-app-id][data-search-key]') {
                return configScript
            }
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
        crypto: crypto.webcrypto,
        fetch: fetch || (async () => response()),
        location: { search: query },
        setTimeout,
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
        calls.map((call) => new URL(call.url).pathname),
        ['/1/indexes/*/objects', '/1/indexes/LearnContent/query'],
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
