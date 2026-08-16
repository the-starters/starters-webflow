const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-review-form.js'), 'utf8')

function load() {
    const listeners = new Map()
    const context = {
        URL,
        URLSearchParams,
        Date,
        Math,
        console,
        window: {
            __STARTERS_TEST__: true,
            location: { href: 'https://thestarters.com/review-starter' },
            history: { state: null, replaceState() {} },
            crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
        },
        document: {
            readyState: 'loading',
            addEventListener(name, callback) {
                listeners.set(name, callback)
            },
            querySelector() {
                return null
            },
        },
        fetch: async () => {
            throw new Error('fetch must not run during pure-contract tests')
        },
    }
    vm.runInNewContext(source, context)
    return context.window.__startersReviewFormTest
}

test('extracts a fragment token and returns a token-free URL with manual UTMs', () => {
    const api = load()
    const result = api.getTokenAndSanitizedUrl(
        'https://thestarters.com/review-starter?utm_source=mandrill&utm_medium=email#token=private-capability-token-12345',
    )
    assert.equal(result.token, 'private-capability-token-12345')
    assert.equal(
        result.sanitized,
        '/review-starter?utm_source=mandrill&utm_medium=email',
    )
    assert.doesNotMatch(result.sanitized, /token|private-capability/)
})

test('removes a legacy query token without deleting unrelated query fields', () => {
    const api = load()
    const result = api.getTokenAndSanitizedUrl(
        'https://thestarters.com/review-starter?token=legacy-private-token-12345&utm_campaign=v3_starter_review_request',
    )
    assert.equal(result.token, 'legacy-private-token-12345')
    assert.equal(
        result.sanitized,
        '/review-starter?utm_campaign=v3_starter_review_request',
    )
})

test('builds the bounded public submit payload', () => {
    const api = load()
    const result = api.buildSubmission(
        {
            rating: '5',
            review_text: '  Excellent partner and operator.  ',
            private_feedback: '  Internal note.  ',
        },
        'review:00000000-0000-4000-8000-000000000000',
    )
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        ok: true,
        payload: {
            rating: 5,
            review_text: 'Excellent partner and operator.',
            private_feedback: 'Internal note.',
            idempotency_key: 'review:00000000-0000-4000-8000-000000000000',
        },
    })
})

test('rejects invalid ratings and out-of-bounds public text', () => {
    const api = load()
    assert.equal(
        api.buildSubmission(
            { rating: '0', review_text: 'Long enough review', private_feedback: '' },
            'review:key',
        ).ok,
        false,
    )
    assert.equal(
        api.buildSubmission(
            { rating: '5', review_text: 'short', private_feedback: '' },
            'review:key',
        ).ok,
        false,
    )
    assert.equal(
        api.buildSubmission(
            { rating: '5', review_text: 'Long enough review', private_feedback: 'x'.repeat(2001) },
            'review:key',
        ).ok,
        false,
    )
})
