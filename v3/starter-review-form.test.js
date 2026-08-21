const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-review-form.js'), 'utf8')

function load(options = {}) {
    const listeners = new Map()
    const historyCalls = []
    const fetchCalls = []
    const context = {
        URL,
        URLSearchParams,
        Date,
        Math,
        console,
        window: {
            __STARTERS_TEST__: true,
            location: {
                href: options.href || 'https://thestarters.com/review-starter',
                origin: 'https://thestarters.com',
            },
            history: {
                state: null,
                replaceState(state, title, url) {
                    historyCalls.push(url)
                },
            },
            crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
            posthog: options.posthog,
        },
        document: {
            readyState: 'loading',
            addEventListener(name, callback) {
                listeners.set(name, callback)
            },
            querySelector() {
                return options.root || null
            },
        },
        fetch: async (...args) => {
            fetchCalls.push(args)
            if (!options.fetch) throw new Error('unexpected fetch')
            return options.fetch(...args)
        },
    }
    vm.runInNewContext(source, context)
    return {
        api: context.window.__startersReviewFormTest,
        fetchCalls,
        historyCalls,
        init: listeners.get('DOMContentLoaded'),
    }
}

test('extracts a fragment token and returns a token-free URL with manual UTMs', () => {
    const { api } = load()
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
    const { api } = load()
    const result = api.getTokenAndSanitizedUrl(
        'https://thestarters.com/review-starter?token=legacy-private-token-12345&utm_campaign=v3_starter_review_request',
    )
    assert.equal(result.token, '')
    assert.equal(
        result.sanitized,
        '/review-starter?utm_campaign=v3_starter_review_request',
    )
})

test('builds the bounded public submit payload', () => {
    const { api } = load()
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
    const { api } = load()
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

test('sanitizes the visible URL before checking the Designer root', () => {
    const harness = load({
        href: 'https://thestarters.com/review-starter?utm_source=email#token=private-capability-token-12345',
    })
    assert.deepEqual(harness.historyCalls, ['/review-starter?utm_source=email'])
})

test('redacts token values and URLs before analytics sends them', () => {
    const { api } = load()
    const event = api.redactAnalyticsEvent({
        properties: {
            token: 'private-capability-token-12345',
            $current_url: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        },
    })
    assert.deepEqual(JSON.parse(JSON.stringify(event)), {
        properties: {
            token: '[redacted]',
            $current_url: 'https://thestarters.com/review-starter',
        },
    })
})

function makeFormHarness() {
    const states = [
        'loading',
        'form',
        'success',
        'unavailable',
        'error',
    ].map((name) => ({
        hidden: false,
        style: { display: '' },
        getAttribute: (attribute) =>
            attribute === 'data-starter-review-state' ? name : null,
    }))
    const fields = {
        rating: { value: '5', disabled: false },
        review_text: { value: 'Excellent partner and operator.', disabled: false },
        private_feedback: { value: 'Internal note.', disabled: false },
    }
    const submitButton = { disabled: false }
    const errorNode = { textContent: '' }
    const photoNode = {
        hidden: false,
        style: { display: '' },
        setAttribute() {},
    }
    let submit
    const form = {
        addEventListener(name, callback) {
            if (name === 'submit') submit = callback
        },
        querySelector(selector) {
            if (selector === '[name="rating"]:checked') return fields.rating
            if (selector === '[name="review_text"]') return fields.review_text
            if (selector === '[name="private_feedback"]') return fields.private_feedback
            if (selector === '[type="submit"]') return submitButton
            return null
        },
        querySelectorAll() {
            return Object.values(fields)
        },
    }
    const root = {
        state: '',
        setAttribute(name, value) {
            if (name === 'data-starter-review-current-state') this.state = value
        },
        querySelectorAll: (selector) =>
            selector === '[data-starter-review-state]' ? states : [],
        querySelector(selector) {
            if (selector === 'form[data-starter-review-form]') return form
            if (selector === '[data-starter-review-error]') return errorNode
            if (selector === '[data-starter-review-photo]') return photoNode
            return null
        },
    }
    return {
        fields,
        photoNode,
        root,
        states,
        submit: (event) => submit(event),
        submitButton,
    }
}

function response(payload, ok = true, status = 200) {
    return {
        ok,
        status,
        json: async () => payload,
    }
}

test('analytics failures do not make a valid form unavailable', async () => {
    const formHarness = makeFormHarness()
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        posthog: { capture: () => { throw new Error('analytics unavailable') } },
        fetch: async () => response({ available: true, starter: { name: 'Starter' } }),
    })
    await harness.init()
    assert.equal(formHarness.root.state, 'form')
})

test('sends the capability only in private endpoint bodies without credentials or referrer data', async () => {
    const formHarness = makeFormHarness()
    const harness = load({
        href: 'https://thestarters.com/review-starter?utm_source=mandrill#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async (url) => response(
            url.endsWith('/context/resolve')
                ? { available: true, starter: { name: 'Starter' } }
                : { accepted: true, duplicate: false },
        ),
    })

    await harness.init()
    await formHarness.submit({ preventDefault() {}, stopImmediatePropagation() {} })

    assert.equal(harness.fetchCalls.length, 2)
    for (const [url, options] of harness.fetchCalls) {
        assert.equal(options.method, 'POST')
        assert.equal(options.credentials, 'omit')
        assert.equal(options.referrerPolicy, 'no-referrer')
        assert.doesNotMatch(url, /private-capability|token=/)
        assert.equal(JSON.parse(options.body).token, 'private-capability-token-12345')
    }
    assert.deepEqual(harness.historyCalls, ['/review-starter?utm_source=mandrill'])
})

test('ambiguous retries preserve the first payload and idempotency key', async () => {
    const formHarness = makeFormHarness()
    let submitAttempts = 0
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async (url) => {
            if (url.endsWith('/context/resolve')) {
                return response({ available: true, starter: { name: 'Starter' } })
            }
            submitAttempts += 1
            if (submitAttempts === 1) throw new Error('connection lost')
            return response({ accepted: true, duplicate: true })
        },
    })
    await harness.init()
    const event = { preventDefault() {}, stopImmediatePropagation() {} }
    await formHarness.submit(event)
    formHarness.fields.review_text.value = 'A different review after the timeout.'
    await formHarness.submit(event)

    const payloads = harness.fetchCalls
        .slice(1)
        .map(([, options]) => JSON.parse(options.body))
    assert.equal(formHarness.fields.review_text.disabled, true)
    assert.deepEqual(payloads[0], payloads[1])
    assert.equal(formHarness.root.state, 'success')
})

// This unit seam cannot exercise the real CSS cascade, so it locks the inline-style
// contract that defeats authored display rules instead: the `hidden` attribute alone
// loses to a Designer class such as `display: flex` or the base `img` rule, so every
// hidden node must also carry an inline `display: none`, and a shown node must have
// that inline value cleared.
test('state switching hides inactive blocks with inline display, not hidden alone', async () => {
    const formHarness = makeFormHarness()
    const displays = () => Object.fromEntries(
        formHarness.states.map((node) => [
            node.getAttribute('data-starter-review-state'),
            { hidden: node.hidden, display: node.style.display },
        ]),
    )
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async (url) => response(
            url.endsWith('/context/resolve')
                ? { available: true, starter: { name: 'Starter' } }
                : { accepted: true, duplicate: false },
        ),
    })

    await harness.init()
    assert.deepEqual(displays(), {
        loading: { hidden: true, display: 'none' },
        form: { hidden: false, display: '' },
        success: { hidden: true, display: 'none' },
        unavailable: { hidden: true, display: 'none' },
        error: { hidden: true, display: 'none' },
    })
    assert.equal(formHarness.photoNode.hidden, true)
    assert.equal(formHarness.photoNode.style.display, 'none')

    await formHarness.submit({ preventDefault() {}, stopImmediatePropagation() {} })
    assert.deepEqual(displays(), {
        loading: { hidden: true, display: 'none' },
        form: { hidden: true, display: 'none' },
        success: { hidden: false, display: '' },
        unavailable: { hidden: true, display: 'none' },
        error: { hidden: true, display: 'none' },
    })
})
