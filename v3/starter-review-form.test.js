const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-review-form.js'), 'utf8')
const snippet = fs.readFileSync(
    path.join(__dirname, 'starter-review-form-webflow.html'),
    'utf8',
)
const squash = (value) => value.replace(/\s+/g, ' ').trim()

function load(options = {}) {
    const listeners = new Map()
    const historyCalls = []
    const fetchCalls = []
    const openCalls = []
    const locationAssigns = []
    const timers = []
    const clearedTimers = []
    let nextTimerId = 1
    const context = {
        URL,
        URLSearchParams,
        Date,
        Math,
        console,
        setTimeout(handler, delay) {
            const id = nextTimerId
            nextTimerId += 1
            timers.push({ id, handler, delay, cleared: false })
            return id
        },
        clearTimeout(id) {
            clearedTimers.push(id)
            const timer = timers.find((entry) => entry.id === id)
            if (timer) timer.cleared = true
        },
        window: {
            __STARTERS_TEST__: true,
            location: {
                href: options.href || 'https://thestarters.com/review-starter',
                origin: 'https://thestarters.com',
                assign(url) {
                    locationAssigns.push(url)
                },
            },
            history: {
                state: null,
                replaceState(state, title, url) {
                    historyCalls.push(url)
                },
            },
            crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
            // Real window.open returns null when a popup blocker or an in-app
            // webview refuses the tab; options.blockPopups models that.
            open(...args) {
                openCalls.push(args)
                return options.blockPopups ? null : { closed: false }
            },
            posthog: options.posthog,
        },
        document: {
            readyState: 'loading',
            head: {
                children: options.headChildren || [],
                appendChild(node) {
                    this.children.push(node)
                },
            },
            createElement(tag) {
                return { tag, id: '', textContent: '' }
            },
            getElementById(id) {
                return this.head.children.find((node) => node.id === id) || null
            },
            addEventListener(name, callback) {
                listeners.set(name, callback)
            },
            querySelector() {
                return options.root || null
            },
        },
        fetch: (...args) => {
            fetchCalls.push(args)
            if (!options.fetch) return Promise.reject(new Error('unexpected fetch'))
            return options.fetch(...args)
        },
    }
    // options.abortController === false models a browser without the global, where
    // the controller must fall back to an unbounded request rather than throw.
    if (options.abortController !== false) context.AbortController = AbortController
    vm.createContext(context)
    // options.runs > 1 models a page that loads the controller twice.
    for (let run = 0; run < (options.runs || 1); run += 1) {
        vm.runInContext(source, context)
    }
    return {
        api: context.window.__startersReviewFormTest,
        booted: context.window.__startersV3ReviewFormBooted,
        fetchCalls,
        headChildren: context.document.head.children,
        historyCalls,
        init: listeners.get('DOMContentLoaded'),
        locationAssigns,
        clearedTimers,
        // Fire every armed, uncleared timer — the stand-in for 15 seconds passing.
        fireTimers() {
            timers
                .filter((timer) => !timer.cleared)
                .forEach((timer) => {
                    timer.cleared = true
                    timer.handler()
                })
        },
        openCalls,
        posthogHook: context.window.__startersV3ReviewPosthogBeforeSend,
        timers,
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

const boundNode = () => ({
    hidden: false,
    style: { display: '' },
    textContent: '',
    attributes: {},
    setAttributeCalls: [],
    removeAttributeCalls: [],
    // setAttribute/removeAttribute round-trip through the attributes map because
    // the profile once-guard reads back what it writes.
    setAttribute(name, value) {
        this.setAttributeCalls.push([name, value])
        this.attributes[name] = value
    },
    removeAttribute(name) {
        this.removeAttributeCalls.push(name)
        delete this.attributes[name]
    },
    getAttribute(name) {
        return name in this.attributes ? this.attributes[name] : null
    },
})

// options.profileTagName / options.profileAnchor model the three shapes the
// profile link ships in: a plain anchor (default), the design-system Button
// component with no anchor inside, or a wrapper with a nested anchor.
function makeFormHarness(options = {}) {
    const states = [
        'loading',
        'form',
        'success',
        'unavailable',
        'error',
    ].map((name) =>
        Object.assign(boundNode(), {
            attributes: { 'data-starter-review-state': name },
        }),
    )
    const fields = {
        rating: { value: '5', disabled: false },
        review_text: { value: 'Excellent partner and operator.', disabled: false },
        private_feedback: { value: 'Internal note.', disabled: false },
    }
    const submitButton = { disabled: false }
    const errorNode = { textContent: '' }
    const photoNode = boundNode()
    const headlineNode = boundNode()
    const profileAnchor = options.profileAnchor || null
    const profileNode = Object.assign(boundNode(), {
        tagName: options.profileTagName || 'A',
        clickListeners: [],
        // Only the component's documented link element answers, so a controller
        // looking for a bare 'a' would find nothing here.
        querySelector: (selector) =>
            selector === 'a.clickable_link' ? profileAnchor : null,
        addEventListener(type, handler, capture) {
            if (type === 'click') this.clickListeners.push({ handler, capture })
        },
    })
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
        querySelectorAll(selector) {
            return selector ===
                '[name="rating"], [name="review_text"], [name="private_feedback"]'
                ? Object.values(fields)
                : []
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
            if (selector === '[data-starter-review-headline]') return headlineNode
            if (selector === '[data-starter-review-profile-link]') return profileNode
            return null
        },
    }
    return {
        errorNode,
        fields,
        headlineNode,
        photoNode,
        profileAnchor,
        profileNode,
        root,
        states,
        submit: (event) => submit(event),
        submitButton,
    }
}

// A request that never answers on its own, like a stalled connection: it settles
// only when the caller aborts it, exactly as real fetch does.
function hangingFetch(url, requestOptions) {
    return new Promise((resolve, reject) => {
        if (!requestOptions || !requestOptions.signal) return
        requestOptions.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
        })
    })
}

// Bounded wait, so a test asserting a hang can never itself hang: if the abort is
// not wired through, this reports 'pending' and the assertion fails instead.
async function settle(promise) {
    let state = 'pending'
    promise.then(
        () => {
            state = 'settled'
        },
        () => {
            state = 'settled'
        },
    )
    for (let tick = 0; tick < 20 && state === 'pending'; tick += 1) {
        await new Promise((resolve) => setImmediate(resolve))
    }
    return state
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

// This seam cannot exercise the real CSS cascade, so it locks the inline-style
// contract that defeats authored display rules instead.
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
    for (const node of [
        formHarness.photoNode,
        formHarness.headlineNode,
        formHarness.profileNode,
    ]) {
        assert.equal(node.hidden, true)
        assert.equal(node.style.display, 'none')
        assert.deepEqual(node.setAttributeCalls, [])
        assert.deepEqual(node.removeAttributeCalls, [])
    }

    await formHarness.submit({ preventDefault() {}, stopImmediatePropagation() {} })
    assert.deepEqual(displays(), {
        loading: { hidden: true, display: 'none' },
        form: { hidden: true, display: 'none' },
        success: { hidden: false, display: '' },
        unavailable: { hidden: true, display: 'none' },
        error: { hidden: true, display: 'none' },
    })
})

test('injects the preflight pre-hide style once', () => {
    const fresh = load()
    assert.equal(fresh.headChildren.length, 1)
    assert.equal(fresh.headChildren[0].tag, 'style')
    assert.equal(fresh.headChildren[0].id, 'starter-review-preflight')

    // The loading block paints from first paint, so the rule must exclude it.
    assert.match(
        fresh.headChildren[0].textContent,
        /:not\(\[data-starter-review-state="loading"\]\)/,
    )
    // The rule self-disarms on the root attribute setState writes.
    assert.match(
        fresh.headChildren[0].textContent,
        /:not\(\[data-starter-review-current-state\]\)/,
    )

    // A legacy page paste that still ships its own preflight style keeps working:
    // the controller defers to it instead of adding a second element.
    const embedded = { id: 'starter-review-preflight', textContent: '' }
    const withPageEmbed = load({ headChildren: [embedded] })
    assert.equal(withPageEmbed.headChildren.length, 1)
    assert.equal(embedded.textContent, '')
})

// The Webflow paste is one script tag and must stay that way: every rule the page
// needs is injected by the controller, so a style block or inline script creeping
// back into the snippet means logic escaped the repo into the Designer.
test('the Webflow snippet stays a single script tag', () => {
    assert.doesNotMatch(snippet, /<style[\s>]/i)
    const scripts = snippet.match(/<script\b[^>]*>/gi) || []
    assert.equal(scripts.length, 1)
    assert.match(scripts[0], /\ssrc="https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\//)
    // Synchronous on purpose: flash protection and token stripping both need it.
    assert.doesNotMatch(scripts[0], /\s(defer|async)[\s=>]/i)
    assert.equal(squash(snippet.replace(/<!--[\s\S]*?-->/g, '')), squash(scripts[0] + '</script>'))
})

test('the boot guard survives a second controller script tag', () => {
    const twice = load({ runs: 2 })
    // The guard's own re-entry check keys on this flag, so booting must set it.
    assert.equal(twice.booted, true)
    assert.equal(twice.headChildren.length, 1)
    // URL sanitizing sits above the guard by design, so it runs per evaluation.
    assert.equal(twice.historyCalls.length, 2)

    // The redaction hook also installs above the guard, so a second tag wraps it
    // again. That is safe only while redaction stays idempotent: the doubled
    // chain must redact exactly like a single one.
    const event = () => ({
        properties: {
            token: 'private-capability-token-12345',
            $current_url:
                'https://thestarters.com/review-starter#token=private-capability-token-12345',
        },
    })
    const once = load()
    assert.deepEqual(
        JSON.parse(JSON.stringify(twice.posthogHook(event()))),
        JSON.parse(JSON.stringify(once.posthogHook(event()))),
    )
})

function resolvedContext() {
    return {
        available: true,
        starter: {
            name: 'Starter',
            headline: 'Fractional growth operator',
            photo_url: 'https://example.com/p.jpg',
            profile_url: '/hire/test-starter',
        },
    }
}

test('a resolved context shows the Starter nodes and strips the placeholder art', async () => {
    const formHarness = makeFormHarness()
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response(resolvedContext()),
    })

    await harness.init()

    assert.equal(formHarness.photoNode.hidden, false)
    assert.equal(formHarness.photoNode.style.display, '')
    assert.deepEqual(formHarness.photoNode.setAttributeCalls, [
        ['src', 'https://example.com/p.jpg'],
    ])
    // A w-descriptor srcset outranks the src, so the placeholder must be stripped.
    assert.deepEqual(formHarness.photoNode.removeAttributeCalls, ['srcset', 'sizes'])

    assert.equal(formHarness.headlineNode.hidden, false)
    assert.equal(formHarness.headlineNode.style.display, '')
    assert.equal(formHarness.headlineNode.textContent, 'Fractional growth operator')

    assert.equal(formHarness.profileNode.hidden, false)
    assert.equal(formHarness.profileNode.style.display, '')
    // An anchor navigates on its own, but must open a new tab: a same-tab trip
    // would destroy the token-bearing history entry and any typed review.
    assert.deepEqual(formHarness.profileNode.setAttributeCalls, [
        ['href', '/hire/test-starter'],
        ['target', '_blank'],
        ['rel', 'noopener'],
    ])
    assert.deepEqual(formHarness.profileNode.clickListeners, [])
    assert.deepEqual(harness.openCalls, [])
})

test('the component link flavor gets the href on a.clickable_link', async () => {
    const formHarness = makeFormHarness({
        profileTagName: 'DIV',
        profileAnchor: boundNode(),
    })
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response(resolvedContext()),
    })

    await harness.init()

    assert.deepEqual(formHarness.profileAnchor.setAttributeCalls, [
        ['href', '/hire/test-starter'],
        ['target', '_blank'],
        ['rel', 'noopener'],
    ])
    assert.deepEqual(formHarness.profileNode.setAttributeCalls, [])
    assert.deepEqual(formHarness.profileNode.clickListeners, [])
    assert.deepEqual(harness.openCalls, [])
})

test('the anchorless Button component opens the profile in a new tab, bound once', async () => {
    // The button-flavored component renders div.button_main-wrap >
    // div.clickable_wrap > button.clickable_btn, with no a.clickable_link inside,
    // so setAttribute('href') would go nowhere.
    const formHarness = makeFormHarness({ profileTagName: 'DIV' })
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response(resolvedContext()),
    })

    await harness.init()
    // Re-binding against the same DOM must not stack a second listener. Calling
    // init twice on one load cannot show this — the capability token is consumed
    // on the first run, so a second call bails at the token check — so drive a
    // second controller instance over the same nodes. In one window the boot guard
    // already prevents that; the attribute guard is the defense behind it.
    const second = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response(resolvedContext()),
    })
    await second.init()

    assert.equal(formHarness.profileNode.hidden, false)
    assert.equal(formHarness.profileNode.clickListeners.length, 1)
    assert.equal(formHarness.profileNode.clickListeners[0].capture, true)
    // The url is stored per resolve; the bound marker is written only once.
    assert.deepEqual(formHarness.profileNode.setAttributeCalls, [
        ['data-starter-review-profile-url', '/hire/test-starter'],
        ['data-starter-review-profile-bound', 'true'],
        ['data-starter-review-profile-url', '/hire/test-starter'],
    ])

    let prevented = 0
    let stopped = 0
    formHarness.profileNode.clickListeners[0].handler({
        preventDefault() {
            prevented += 1
        },
        stopPropagation() {
            stopped += 1
        },
    })
    assert.equal(prevented, 1)
    assert.equal(stopped, 1)
    assert.deepEqual(harness.openCalls, [
        ['/hire/test-starter', '_blank', 'noopener'],
    ])
    assert.deepEqual(harness.locationAssigns, [])
})

test('a re-resolve with a new profile url retargets the bound listener', async () => {
    const formHarness = makeFormHarness({ profileTagName: 'DIV' })
    const first = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response(resolvedContext()),
    })
    await first.init()

    const moved = resolvedContext()
    moved.starter.profile_url = '/hire/renamed-starter'
    const second = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response(moved),
    })
    await second.init()

    // Still one listener, but it must follow the newer destination.
    assert.equal(formHarness.profileNode.clickListeners.length, 1)
    formHarness.profileNode.clickListeners[0].handler({
        preventDefault() {},
        stopPropagation() {},
    })
    assert.deepEqual(first.openCalls, [
        ['/hire/renamed-starter', '_blank', 'noopener'],
    ])
})

test('a blocked popup falls back to a same-tab trip', async () => {
    const formHarness = makeFormHarness({ profileTagName: 'DIV' })
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        blockPopups: true,
        fetch: async () => response(resolvedContext()),
    })
    await harness.init()

    formHarness.profileNode.clickListeners[0].handler({
        preventDefault() {},
        stopPropagation() {},
    })

    assert.deepEqual(harness.openCalls, [
        ['/hire/test-starter', '_blank', 'noopener'],
    ])
    // window.open handed back null, so the button must still go somewhere.
    assert.deepEqual(harness.locationAssigns, ['/hire/test-starter'])
})

test('a profile url outside the /hire allowlist binds nothing', async () => {
    const formHarness = makeFormHarness({ profileTagName: 'DIV' })
    const context = resolvedContext()
    context.starter.profile_url = 'https://evil.example.com/hire/test-starter'
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response(context),
    })

    await harness.init()

    assert.equal(formHarness.profileNode.hidden, true)
    assert.equal(formHarness.profileNode.style.display, 'none')
    assert.deepEqual(formHarness.profileNode.clickListeners, [])
    assert.deepEqual(formHarness.profileNode.setAttributeCalls, [])
    assert.deepEqual(harness.openCalls, [])
})

test('a hung context request times out into the unavailable state', async () => {
    const formHarness = makeFormHarness()
    const captures = []
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        posthog: { capture: (name, properties) => captures.push([name, properties]) },
        fetch: hangingFetch,
    })

    const running = harness.init()
    assert.equal(formHarness.root.state, 'loading')
    assert.equal(harness.timers.length, 1)
    assert.equal(harness.timers[0].delay, 15000)

    harness.fireTimers()
    assert.equal(await settle(running), 'settled')

    assert.equal(formHarness.root.state, 'unavailable')
    // Status 0, not 404, so the reason must be load_failed.
    const unavailable = captures.find(
        ([name]) => name === 'v3_starter_review_unavailable',
    )
    // JSON round-trip: the properties object is built inside the vm realm, so its
    // prototype differs from the host's and deepStrictEqual would reject it.
    assert.deepEqual(JSON.parse(JSON.stringify(unavailable)), [
        'v3_starter_review_unavailable',
        { reason: 'load_failed' },
    ])
})

test('a completed request clears its timeout', async () => {
    const formHarness = makeFormHarness()
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: async () => response({ available: true, starter: { name: 'Starter' } }),
    })

    await harness.init()

    assert.equal(formHarness.root.state, 'form')
    assert.equal(harness.timers.length, 1)
    assert.deepEqual(harness.clearedTimers, [harness.timers[0].id])
})

test('a timed-out submit shows the error and retries the same payload', async () => {
    const formHarness = makeFormHarness()
    let submitAttempts = 0
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        fetch: (url, requestOptions) => {
            if (url.endsWith('/context/resolve')) {
                return Promise.resolve(
                    response({ available: true, starter: { name: 'Starter' } }),
                )
            }
            submitAttempts += 1
            if (submitAttempts === 1) return hangingFetch(url, requestOptions)
            return Promise.resolve(response({ accepted: true, duplicate: true }))
        },
    })
    await harness.init()

    const event = { preventDefault() {}, stopImmediatePropagation() {} }
    const firstSubmit = formHarness.submit(event)
    harness.fireTimers()
    assert.equal(await settle(firstSubmit), 'settled')

    assert.equal(
        formHarness.errorNode.textContent,
        'We could not submit your review. Try again.',
    )
    assert.equal(formHarness.fields.review_text.disabled, true)
    assert.equal(formHarness.root.state, 'form')

    // The locked payload survives the timeout, key included.
    formHarness.fields.review_text.value = 'A different review after the timeout.'
    await formHarness.submit(event)

    const payloads = harness.fetchCalls
        .slice(1)
        .map(([, requestOptions]) => JSON.parse(requestOptions.body))
    assert.deepEqual(payloads[0], payloads[1])
    assert.equal(formHarness.root.state, 'success')
})

test('an environment without AbortController sends an untimed request', async () => {
    const formHarness = makeFormHarness()
    const harness = load({
        href: 'https://thestarters.com/review-starter#token=private-capability-token-12345',
        root: formHarness.root,
        abortController: false,
        fetch: async () => response({ available: true, starter: { name: 'Starter' } }),
    })

    await harness.init()

    assert.equal(formHarness.root.state, 'form')
    assert.equal(harness.timers.length, 0)
    assert.equal(harness.fetchCalls[0][1].signal, undefined)
})
