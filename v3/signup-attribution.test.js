const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./signup-attribution.js'), 'utf8')
const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')
const header = source.slice(0, source.indexOf('*/') + 2)

const RELEASE = 'v1.59.210'
const PENDING_SAVE_FLAG = 'startersAttributionPendingSave'
const PENDING_FIELDS_KEY = 'startersAttributionPendingFields'
const FIRED_FLAG = 'startersCompleteRegistrationFired'
const LEAD_ENTRY_PENDING_KEY = 'startersLeadEntryPendingV1'
const LEAD_ENTRY_POSTHOG_PENDING_KEY = 'startersLeadEntryPosthogPendingV1'

// Cookie name to Memberstack custom-field ID: the literals both this file and
// quiz-results.js are pinned to. All eleven are verified to exist in the Memberstack
// app config, which is what makes them a contract rather than a convention.
const FIELD_IDS = {
    utm_source: 'utm-source',
    utm_campaign: 'utm-campaign',
    utm_adset: 'utm-adset',
    utm_content: 'utm-content',
    fbclid: 'fbclid',
    fbc: 'fbc',
    fbp: 'fbp',
    event_id: 'event-id',
    signup_source: 'signup-source',
    signup_referrer: 'signup-referrer',
    signup_trigger: 'signup-trigger',
}

const COOKIE_NAMES = Object.keys(FIELD_IDS)

const FALLBACK_EVENT_ID =
    /^evt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Objects the script builds live in the vm realm, so their prototype is not this
 * realm's `Object.prototype` and `deepEqual` rejects them on identity alone.
 * Round-tripping through JSON compares the values, which is what matters here.
 */
const plain = (value) => JSON.parse(JSON.stringify(value))

/**
 * Lifts one top-level object or array literal out of a source string and
 * evaluates it, so a contract can be pinned against the real constant instead of
 * a copy of it. Balances brackets rather than regex-matching a closing line,
 * which keeps it indifferent to how the literal is formatted.
 *
 * @param {string} src File contents to search.
 * @param {string} name Declared constant name.
 * @param {string} keyword Declaration keyword (`var` or `const`).
 */
function extractLiteralFrom(src, name, keyword = 'var') {
    const marker = `${keyword} ${name} = `
    const start = src.indexOf(marker)
    assert.notEqual(start, -1, `no ${name} declaration`)

    const from = start + marker.length
    const open = src[from]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let index = from

    for (; index < src.length; index += 1) {
        if (src[index] === open) depth += 1
        else if (src[index] === close) {
            depth -= 1
            if (depth === 0) {
                index += 1
                break
            }
        }
    }

    return plain(vm.runInNewContext(`(${src.slice(from, index)})`))
}

/**
 * @param {string} name Declared constant name in signup-attribution.js.
 */
function extractLiteral(name) {
    return extractLiteralFrom(source, name, 'var')
}

/**
 * Lifts one function out of a source string by its declaration line, cutting at
 * the first closing brace back at four-space indentation. Both files declare
 * their IIFE-scoped functions at exactly that indent, which is what makes the
 * cut unambiguous.
 *
 * @param {string} src File contents.
 * @param {string} declaration The function's declaration line, verbatim.
 */
function sliceFunction(src, declaration) {
    const start = src.indexOf(declaration)
    assert.notEqual(start, -1, `no declaration: ${declaration}`)

    const end = src.indexOf('\n    }\n', start)
    assert.notEqual(end, -1, `unterminated function: ${declaration}`)

    return src.slice(start, end + '\n    }\n'.length)
}

/**
 * The two real `withoutFilledWriteOnceFields` implementations, each lifted from
 * its own file and given only the bindings it closes over.
 *
 * They are deliberately written in different idioms (ES5-style `var` and a
 * hand-rolled trim in `v3/`, modern syntax and the file's own `normalize()` in
 * `quiz-results.js`), so identical source is not the goal and cannot be asserted.
 * What must not diverge is what they both call "filled": one of them deciding a
 * whitespace-only value counts would silently protect a field on one signup route
 * and overwrite it on the other.
 *
 * @param {string} resultsSource Contents of quiz-results.js.
 */
function bothWriteOnceGuards(resultsSource) {
    const ids = '["signup-source","signup-referrer","signup-trigger"]'

    return {
        v3: vm.runInNewContext(
            [
                `var WRITE_ONCE_FIELD_IDS = ${ids}`,
                sliceFunction(
                    source,
                    '    var withoutFilledWriteOnceFields = function (fields, existingCustomFields) {',
                ),
                'withoutFilledWriteOnceFields',
            ].join('\n'),
            {},
        ),
        quizResults: vm.runInNewContext(
            [
                "function normalize(value) { return (value || '').trim() }",
                `const writeOnceFieldIds = ${ids}`,
                sliceFunction(
                    resultsSource,
                    '    function withoutFilledWriteOnceFields(customFields, existingCustomFields) {',
                ),
                'withoutFilledWriteOnceFields',
            ].join('\n'),
            {},
        ),
    }
}

/**
 * A `data-ms-form` marker sitting on something that is not a `<form>` — the
 * wrapper-div case the prefix-less login selector exists to catch. Drop it into
 * a `forms` list anywhere a plain string would have put the marker on a real
 * form element.
 *
 * @param {string} kind `data-ms-form` value, e.g. `'login'`.
 */
const markerOnDiv = (kind) => ({ kind, isForm: false })

/**
 * Normalizes one `forms` entry into the element the page holds. A plain string
 * is the common case: the marker on a real `<form>`.
 *
 * @param {string | {kind: string, isForm: boolean}} entry
 */
const markerElement = (entry) =>
    typeof entry === 'string' ? { kind: entry, isForm: true } : entry

/**
 * `document` double whose `cookie` accessor behaves like the browser's: reading
 * returns the whole jar, assigning merges one cookie in. Every assignment is
 * recorded so a test can prove a cookie was NOT rewritten, which is the whole
 * point of "absence never clears".
 *
 * @param {object} [initial] Pre-existing cookies, name to raw value.
 * @param {boolean} [readOnly] Swallow writes, like a browser with cookies off.
 * @param {string} [referrer] `document.referrer` as the browser reports it: an
 *     absolute URL, or '' when there is no previous page.
 * @param {Array<string|object>} [forms] The `data-ms-form` markers present on
 *     the page, one entry per element carrying one (e.g.
 *     `['signup', 'profile']`). A string puts the marker on a `<form>`;
 *     `markerOnDiv('login')` puts it on a non-form element. Order is
 *     irrelevant; only the counts per selector are read.
 */
function documentDouble(initial, readOnly, forms, referrer) {
    const jar = new Map(Object.entries(initial || {}))
    const writes = []
    const markers = forms || []

    return {
        readyState: 'complete',
        // '' is what a browser reports for direct navigation, a typed URL, or a
        // referrer policy that strips it, so it is the default here too.
        referrer: referrer || '',
        listeners: [],
        jar,
        writes,
        addEventListener(name, handler, options) {
            const capture = options === true || (options && options.capture === true)
            this.listeners.push([name, handler, capture])
        },
        // Only `data-ms-form` selectors are modelled, with and without the
        // `form` prefix, because the script's two selectors differ by exactly
        // that prefix and the harness has to keep telling them apart: the
        // prefixed one matches forms only, the bare one matches any element.
        // Anything else matches nothing, which is the honest answer for a page
        // double that holds no other elements.
        querySelectorAll(selector) {
            const match = /^(form)?\[data-ms-form="([a-z-]+)"\]$/.exec(
                String(selector),
            )
            if (!match) return []
            const formOnly = Boolean(match[1])
            const kind = match[2]
            return markers
                .map(markerElement)
                .filter(
                    (element) =>
                        element.kind === kind &&
                        (!formOnly || element.isForm === true),
                )
        },
        get cookie() {
            return Array.from(jar.entries())
                .map(([name, value]) => `${name}=${value}`)
                .join('; ')
        },
        set cookie(value) {
            writes.push(value)
            if (readOnly) return
            const pair = String(value).split(';')[0]
            const separator = pair.indexOf('=')
            jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1))
        },
    }
}

/**
 * Runs the script against a fake browser and returns everything it touched.
 */
function boot(options = {}) {
    const document = documentDouble(
        options.cookies,
        options.readOnlyCookies,
        options.forms,
        options.referrer,
    )
    document.documentElement = {
        getAttribute(name) {
            return name === 'data-wf-page' ? options.pageId || null : null
        },
    }
    // A DOM the script cannot query at all: an old engine with no
    // querySelectorAll, or one that raises on the call.
    if (options.noQuerySelectorAll) delete document.querySelectorAll
    if (options.querySelectorThrows) {
        document.querySelectorAll = () => {
            throw new Error('no DOM here')
        }
    }
    const session = new Map(Object.entries(options.session || {}))
    const fbqCalls = []
    const warnings = []
    const authHandlers = []
    const updateCalls = []
    const fetchCalls = []
    const posthogCalls = []
    const memberReads = []
    let releaseMember = () => {}

    let authChangeCalls = 0
    /**
     * `onAuthChange` as the page sees it. `authChangeThrowsOnce` makes the
     * first registration raise and every later one work, which is the only
     * shape that can tell "the claim stayed taken after a throw" apart from
     * "the claim was released and the retry happened to throw as well".
     */
    const registerAuthHandler = (handler) => {
        authChangeCalls += 1
        if (options.authChangeThrowsOnce && authChangeCalls === 1) {
            throw new Error('onAuthChange blew up')
        }
        authHandlers.push(handler)
    }

    // Always built, even when the page is not given it: `noMemberstack` only
    // withholds it from `window`, so `attachMemberstack()` can hand the same
    // double over later as a late-loading Memberstack.
    const memberstack = {
        getMemberCookie: async () => options.memberCookie || 'memberstack-cookie',
        getCurrentMember: async () => {
            if (options.memberThrows) throw new Error('no session')
            memberReads.push(true)
            // First read only: the signup watch's starting-state probe.
            // Lets a test prove an unreadable start is not treated as
            // "arrived logged out".
            if (options.firstMemberThrows && memberReads.length === 1) {
                throw new Error('no session')
            }
            // Every read AFTER that probe fails. The shape of a write-once guard
            // lookup that cannot resolve on a page whose auth state read fine,
            // which is the case that still has to write.
            if (options.laterMemberReadsThrow && memberReads.length > 1) {
                throw new Error('member read failed')
            }
            // The registration watch reads first, the pending-save retry
            // second. Holding only the second read lets a test interleave a
            // signup transition with a still-pending retry.
            if (options.holdSecondMemberRead && memberReads.length === 2) {
                return new Promise((resolve) => {
                    releaseMember = () =>
                        resolve({ data: options.heldMember || null })
                })
            }
            // After a signup Memberstack reports the brand-new member, so a read
            // taken after the watch's starting probe can legitimately differ from
            // it. `memberAfterSignup` is what lets a test drive the write-once
            // guard's lookup on a page that genuinely arrived logged out.
            const base =
                memberReads.length > 1 && options.memberAfterSignup !== undefined
                    ? options.memberAfterSignup
                    : options.member
            // `memberFields` models custom fields on the member Memberstack
            // returns from getCurrentMember, which is where the write-once guard
            // looks when the auth payload carries none.
            if (base && options.memberFields) {
                return {
                    data: Object.assign({}, base, {
                        customFields: options.memberFields,
                    }),
                }
            }
            return { data: base || null }
        },
        onAuthChange: registerAuthHandler,
    }
    // A Memberstack build with no onAuthChange on it at all: loaded, but with
    // nothing for the watch to hook onto.
    if (options.noOnAuthChange) delete memberstack.onAuthChange
    if (!options.noUpdateMember) {
        memberstack.updateMember = async (payload) => {
            updateCalls.push(payload)
            if (options.updateFails) throw new Error('Memberstack said no')
            return { data: { id: 'mem_123' } }
        }
    }

    const hostname = options.hostname || 'the-starters-3-0.webflow.io'
    const openedSignup = []
    const window = {
        $memberstackDom: options.noMemberstack ? undefined : memberstack,
        location: {
            hostname,
            // The referrer check compares origins, so the double carries the same
            // three pieces a browser does. `noLocationOrigin` drops `origin` to
            // exercise the protocol+host rebuild, which is a refusal to guess at
            // same-origin rather than a browser-support shim.
            origin: options.noLocationOrigin ? undefined : `https://${hostname}`,
            protocol: 'https:',
            host: hostname,
            pathname: options.pathname === undefined ? '/quiz' : options.pathname,
            search: options.search || '',
        },
        lumos: {
            modal: {
                list: {
                    'signup-modal': {
                        el: { open: false },
                        open: () => openedSignup.push(true),
                    },
                },
            },
        },
        sessionStorage: {
            getItem: (key) => (session.has(key) ? session.get(key) : null),
            setItem: (key, value) => session.set(key, String(value)),
            removeItem: (key) => session.delete(key),
        },
        crypto: options.noRandomUuid
            ? {}
            : { randomUUID: () => options.uuid || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
        fetch: async (url, init) => {
            fetchCalls.push({ url: String(url), init: init || {} })
            if (options.fetchHandler) return options.fetchHandler(url, init || {})
            throw new Error('unexpected fetch')
        },
        posthog: options.noPosthog
            ? undefined
            : {
                  __loaded: options.posthogLoaded !== false,
                  capture: (name, properties) => posthogCalls.push({ name, properties }),
              },
    }
    if (!options.noFbq) {
        window.fbq = (...args) => fbqCalls.push(args)
    }

    // The Memberstack poll runs on a real ten second deadline. A test that never
    // supplies Memberstack only cares about the capture half, so it parks the
    // poll instead of paying the full wall-clock wait.
    const parkedTimers = []
    const context = {
        URL,
        URLSearchParams,
        console: { warn: (message) => warnings.push(message) },
        document,
        setTimeout: options.parkTimers
            ? (handler) => parkedTimers.push(handler)
            : setTimeout,
        window,
    }

    // `runClockForward` is the other way to survive that deadline: instead of
    // parking the poll it runs every tick at once and moves a fake clock on by
    // the delay it was handed, so the ten second wait gives up in the same turn
    // of the event loop. A test that needs to see what the script does AFTER
    // the wait times out uses this; `parkTimers` only avoids the wait.
    if (options.runClockForward) {
        let skew = 0
        context.setTimeout = (handler, delay) => {
            skew += Number(delay) || 0
            handler()
        }
        context.Date = class extends Date {
            static now() {
                return Date.now() + skew
            }
        }
    }

    vm.runInNewContext(source, context)

    return {
        authHandlers,
        context,
        document,
        fbqCalls,
        memberReads,
        session,
        updateCalls,
        fetchCalls,
        posthogCalls,
        warnings,
        window,
        openedSignup,
        api: window.StartersAttribution,
        clickTrigger: (attrs = {}) => {
            const target = {
                getAttribute(name) {
                    if (name === 'data-signup-trigger-element') {
                        return attrs.element === undefined ? null : attrs.element
                    }
                    if (name === 'data-signup-trigger-value') {
                        return attrs.value === undefined ? null : attrs.value
                    }
                    return null
                },
                closest(selector) {
                    if (selector === '[data-signup-trigger-element]') return this
                    return null
                },
            }
            const event = {
                target,
                defaultPrevented: false,
                propagationStopped: false,
                immediateStopped: false,
            }
            event.preventDefault = () => {
                event.defaultPrevented = true
            }
            event.stopPropagation = () => {
                event.propagationStopped = true
            }
            event.stopImmediatePropagation = () => {
                event.immediateStopped = true
                event.propagationStopped = true
            }
            const handlers = document.listeners.filter(([name]) => name === 'click')
            const capture = handlers.filter((entry) => entry[2]).map((entry) => entry[1])
            const bubble = handlers.filter((entry) => !entry[2]).map((entry) => entry[1])
            for (const handler of capture) {
                handler(event)
                if (event.immediateStopped) break
            }
            if (!event.immediateStopped) {
                for (const handler of bubble) handler(event)
            }
            return event
        },
        submitAuth: (kind) => {
            const target = {
                getAttribute(name) {
                    return name === 'data-ms-form' ? kind : null
                },
            }
            const event = { target }
            const handlers = document.listeners.filter(([name]) => name === 'submit')
            for (const entry of handlers) entry[1](event)
            return event
        },
        submitSignup: () => {
            const target = {
                getAttribute(name) {
                    return name === 'data-ms-form' ? 'signup' : null
                },
            }
            const event = { target }
            const handlers = document.listeners.filter(([name]) => name === 'submit')
            for (const entry of handlers) entry[1](event)
            return event
        },
        rerun: () => vm.runInNewContext(source, context),
        settle: () => new Promise((resolve) => setImmediate(resolve)),
        writesFor: (name) =>
            document.writes.filter((write) => write.startsWith(`${name}=`)),
        pendingSave: () => session.get(PENDING_SAVE_FLAG),
        pendingFields: () => {
            const raw = session.get(PENDING_FIELDS_KEY)
            return raw === undefined ? undefined : JSON.parse(raw)
        },
        pendingLeadEntry: () => {
            const raw = session.get(LEAD_ENTRY_PENDING_KEY)
            return raw === undefined ? undefined : JSON.parse(raw)
        },
        pendingLeadEntryPosthog: () => {
            const raw = session.get(LEAD_ENTRY_POSTHOG_PENDING_KEY)
            return raw === undefined ? undefined : JSON.parse(raw)
        },
        releaseMember: () => releaseMember(),
        savedFields: () => plain(updateCalls.map((call) => call.customFields)),
        // Memberstack turning up after the page gave up waiting for it.
        attachMemberstack: () => {
            window.$memberstackDom = memberstack
        },
        // The same build finally exposing onAuthChange.
        attachOnAuthChange: () => {
            memberstack.onAuthChange = registerAuthHandler
        },
    }
}

const loggedInMember = { id: 'mem_123', email: 'brand@example.com' }

/**
 * An auth payload carrying custom fields, the way the write-once guard hopes to
 * find them. Kept separate from `loggedInMember` because nothing in the repo
 * proves Memberstack puts customFields on an onAuthChange payload: every other
 * consumer reads only `id`, `planConnections` or `auth.email` off it, so the
 * plain member double stays the default and this is the opt-in shape.
 *
 * @param {object} customFields Custom fields as Memberstack would return them.
 */
const memberWithFields = (customFields) =>
    Object.assign({}, loggedInMember, { customFields })

// The four non-signup-source fields clickCookies produces. Every guard test
// asserts these still arrive: the guard is one key wide, not a payload rule.
const CLICK_FIELDS = {
    'utm-source': 'facebook',
    'utm-campaign': 'summer',
    fbclid: 'IwAR123',
    'event-id': 'evt_fixed',
}

const clickCookies = {
    utm_source: 'facebook',
    utm_campaign: 'summer',
    fbclid: 'IwAR123',
    event_id: 'evt_fixed',
}

/* --------------------------------- capture -------------------------------- */

test('copies every ad parameter in the URL into a 72 hour cookie', () => {
    const harness = boot({
        search:
            '?utm_source=facebook&utm_campaign=summer&utm_adset=adset-1' +
            '&utm_content=video-a&fbclid=IwAR123',
    })

    const params = harness.api.getParams()
    assert.equal(params.utm_source, 'facebook')
    assert.equal(params.utm_campaign, 'summer')
    assert.equal(params.utm_adset, 'adset-1')
    assert.equal(params.utm_content, 'video-a')
    assert.equal(params.fbclid, 'IwAR123')

    for (const name of [
        'utm_source',
        'utm_campaign',
        'utm_adset',
        'utm_content',
        'fbclid',
    ]) {
        const writes = harness.writesFor(name)
        assert.equal(writes.length, 1, name)
        assert.match(writes[0], /; path=\/(?:;|$)/, name)

        const expires = writes[0].match(/; expires=([^;]+)/)
        assert.ok(expires, `${name} has no expires`)
        const hours = (Date.parse(expires[1]) - Date.now()) / 3600000
        assert.ok(hours > 71.9 && hours <= 72.1, `${name} TTL is ${hours}h`)
    }
})

test('a URL with no parameters writes nothing but the event id', () => {
    const existing = {
        utm_source: 'facebook',
        utm_campaign: 'summer',
        utm_adset: 'adset-1',
        utm_content: 'video-a',
        fbclid: 'IwAR123',
        fbc: 'fb.1.1700000000.IwAR123',
        fbp: 'fb.1.1700000000.987654321',
        event_id: 'evt_kept',
        // Written by an earlier signup transition, never by capture: a plain page
        // load must leave them exactly as it found them.
        signup_source: '/all-starters',
        signup_referrer: '/starters/john-doe',
        signup_trigger: 'hire',
    }
    const harness = boot({ cookies: existing })

    // Nothing was rewritten and nothing was cleared.
    assert.deepEqual(harness.document.writes, [])
    assert.deepEqual(plain(harness.api.getParams()), existing)
})

test('a fresh click overwrites an older stored click', () => {
    const harness = boot({
        cookies: { utm_source: 'google', utm_campaign: 'spring' },
        search: '?utm_source=facebook',
    })

    const params = harness.api.getParams()
    assert.equal(params.utm_source, 'facebook')
    // Untouched, because this URL does not carry it.
    assert.equal(params.utm_campaign, 'spring')
    assert.deepEqual(harness.writesFor('utm_campaign'), [])
})

test('an empty parameter value is not a click and never clears a cookie', () => {
    const harness = boot({
        cookies: { utm_source: 'facebook' },
        search: '?utm_source=&utm_campaign=',
    })

    assert.equal(harness.api.getParams().utm_source, 'facebook')
    assert.equal(harness.api.getParams().utm_campaign, null)
    assert.deepEqual(harness.writesFor('utm_source'), [])
    assert.deepEqual(harness.writesFor('utm_campaign'), [])
})

test("copies Meta's own _fbc and _fbp when ours are unset", () => {
    const harness = boot({
        cookies: {
            _fbc: 'fb.1.1700000000.IwAR123',
            _fbp: 'fb.1.1700000000.987654321',
        },
    })

    const params = harness.api.getParams()
    assert.equal(params.fbc, 'fb.1.1700000000.IwAR123')
    assert.equal(params.fbp, 'fb.1.1700000000.987654321')
    assert.equal(harness.writesFor('fbc').length, 1)
    assert.equal(harness.writesFor('fbp').length, 1)
})

test('an existing fbc or fbp is never replaced by the pixel value', () => {
    const harness = boot({
        cookies: {
            fbc: 'fb.1.1600000000.ours',
            _fbc: 'fb.1.1700000000.theirs',
            _fbp: 'fb.1.1700000000.987654321',
        },
    })

    assert.equal(harness.api.getParams().fbc, 'fb.1.1600000000.ours')
    assert.deepEqual(harness.writesFor('fbc'), [])
    // The other half of the pair still gets copied.
    assert.equal(harness.api.getParams().fbp, 'fb.1.1700000000.987654321')
})

test('ensureEventId generates an evt_ id when absent', () => {
    const harness = boot({ uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })

    assert.equal(
        harness.api.getParams().event_id,
        'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    assert.equal(harness.writesFor('event_id').length, 1)
})

test('ensureEventId reuses the stored id', () => {
    const harness = boot({ cookies: { event_id: 'evt_already-here' } })

    assert.equal(harness.api.getParams().event_id, 'evt_already-here')
    assert.deepEqual(harness.writesFor('event_id'), [])
})

test('ensureEventId falls back when crypto.randomUUID is missing', () => {
    const harness = boot({ noRandomUuid: true })

    assert.match(harness.api.getParams().event_id, FALLBACK_EVENT_ID)
})

/* ---------------------------- field-ID contract --------------------------- */

test('getParams exposes exactly the eleven contract cookies', () => {
    const harness = boot()
    assert.deepEqual(Object.keys(harness.api.getParams()), COOKIE_NAMES)
})

test('the field mapping is underscore to hyphen for all eleven cookies', () => {
    for (const [cookie, field] of Object.entries(FIELD_IDS)) {
        assert.equal(cookie.replace(/_/g, '-'), field, cookie)
    }
    // The one that a naive "strip the underscore" rule gets wrong.
    assert.equal(FIELD_IDS.event_id, 'event-id')
})

test('the map in the script is exactly the eleven contract pairs', () => {
    // The map stopped being documentation when /sign-up started writing the
    // fields from here, so it is now pinned as code.
    assert.deepEqual(extractLiteral('FIELD_IDS'), FIELD_IDS)
})

test('COOKIE_NAMES is derived from FIELD_IDS so the two cannot drift', () => {
    assert.match(
        source,
        /var COOKIE_NAMES = Object\.keys\(FIELD_IDS\)/,
        'COOKIE_NAMES must be derived from FIELD_IDS',
    )
    assert.deepEqual(Object.keys(boot().api.getParams()), COOKIE_NAMES)
    // URL_PARAMS must stay a subset of the field map: a URL-only cookie with no
    // field ID would write a literal "undefined" key to Memberstack.
    const urlParams = extractLiteral('URL_PARAMS')
    for (const name of urlParams) {
        assert.equal(FIELD_IDS[name] !== undefined, true, name)
    }
    // The subset is strict in one direction only. The two signup fields have no
    // URL parameter behind them on purpose: they report where the signup really
    // happened and where it came from, so accepting `?signup_source=` or
    // `?signup_referrer=` would let the address bar dictate them.
    assert.equal(urlParams.includes('signup_source'), false)
    assert.equal(urlParams.includes('signup_referrer'), false)
    assert.equal(urlParams.includes('signup_trigger'), false)
})

test('the drift guard sees eleven pairs, and both maps carry all eleven', () => {
    // The count is asserted explicitly so adding a field to one map and not the
    // other cannot pass by making both sides equally wrong.
    const resultsSource = fs.readFileSync(
        path.join(__dirname, '..', 'quiz-results.js'),
        'utf8',
    )
    const inQuizResults = extractLiteralFrom(
        resultsSource,
        'attributionCookieFieldIds',
        'const',
    )

    assert.equal(Object.keys(FIELD_IDS).length, 11)
    assert.equal(Object.keys(extractLiteral('FIELD_IDS')).length, 11)
    assert.equal(Object.keys(inQuizResults).length, 11)
    assert.deepEqual(inQuizResults, FIELD_IDS)
})

test('both scripts guard the same three write-once fields', () => {
    // A split set would silently protect a field on one signup route and not the
    // other, which is the same class of bug the FIELD_IDS drift guard exists for.
    const resultsSource = fs.readFileSync(
        path.join(__dirname, '..', 'quiz-results.js'),
        'utf8',
    )

    // Pinned as source text rather than lifted out: both sets are built from
    // their file's own field map, so they cannot be evaluated on their own.
    assert.match(
        source,
        /var WRITE_ONCE_FIELD_IDS = \[\s*FIELD_IDS\.signup_source,\s*FIELD_IDS\.signup_referrer,\s*FIELD_IDS\.signup_trigger,\s*\]/,
        'signup-attribution.js must guard signup_source, signup_referrer, and signup_trigger',
    )
    assert.match(
        resultsSource,
        /const writeOnceFieldIds = \[\s*attributionCookieFieldIds\.signup_source,\s*attributionCookieFieldIds\.signup_referrer,\s*attributionCookieFieldIds\.signup_trigger,\s*\]/,
        'quiz-results.js must guard exactly the same three',
    )
})

test('both guards classify "filled" identically', () => {
    // The set of guarded IDs is pinned above, but that says nothing about the
    // comparators, and the two are written in different idioms: String().trim()
    // here, the file's own normalize() there. If one of them started counting a
    // whitespace-only value as filled, a member would keep their signup fields on
    // one signup route and lose them on the other, with no other test failing.
    const resultsSource = fs.readFileSync(
        path.join(__dirname, '..', 'quiz-results.js'),
        'utf8',
    )
    const guards = bothWriteOnceGuards(resultsSource)

    const cases = [
        ['a normal path', '/starters/jane-doe', 'filled'],
        ['a value with padding', '  /quiz  ', 'filled'],
        // Numbers reach String() rather than a bare .trim(), which is the one
        // place the two idioms could have parted company outright.
        ['a numeric value', 0, 'filled'],
        ['an empty string', '', 'unfilled'],
        ['spaces only', '   ', 'unfilled'],
        ['a tab and a newline', '\t\n ', 'unfilled'],
        ['null', null, 'unfilled'],
        ['undefined', undefined, 'unfilled'],
    ]

    for (const [label, existing, expected] of cases) {
        const fields = { 'utm-source': 'facebook', 'signup-source': '/quiz' }
        const existingFields =
            existing === undefined ? {} : { 'signup-source': existing }

        const fromV3 = plain(guards.v3(fields, existingFields))
        const fromQuizResults = plain(
            guards.quizResults(fields, existingFields),
        )

        assert.deepEqual(fromV3, fromQuizResults, `${label}: the two disagree`)

        const survived = fromV3['signup-source'] === '/quiz'
        assert.equal(
            survived,
            expected === 'unfilled',
            `${label}: expected ${expected}`,
        )
        // Never at the expense of a click field, in either implementation.
        assert.equal(fromV3['utm-source'], 'facebook', label)
        assert.equal(fromQuizResults['utm-source'], 'facebook', label)
    }

    // And the unreadable case: both write, and neither throws on it.
    for (const unreadable of [null, undefined]) {
        const fields = { 'signup-source': '/quiz', 'signup-referrer': '/' }
        assert.deepEqual(
            plain(guards.v3(fields, unreadable)),
            plain(guards.quizResults(fields, unreadable)),
            String(unreadable),
        )
        assert.equal(plain(guards.v3(fields, unreadable))['signup-source'], '/quiz')
    }
})

test('the FIELD_IDS map stays in step with quiz-results.js', () => {
    const resultsSource = fs.readFileSync(
        path.join(__dirname, '..', 'quiz-results.js'),
        'utf8',
    )
    assert.deepEqual(
        extractLiteralFrom(resultsSource, 'attributionCookieFieldIds', 'const'),
        FIELD_IDS,
    )
})

test('SIGNUP_PATH_POLICY covers /quiz and /sign-up with directSave only on /sign-up', () => {
    assert.deepEqual(extractLiteral('SIGNUP_PATH_POLICY'), {
        '/quiz': { directSave: false },
        '/sign-up': { directSave: true },
    })
})

test('the two form selectors keep their deliberate asymmetry', () => {
    // Arming is anchored to `form`, the veto is not. Losing the prefix on the
    // signup selector would arm on any stray marker; adding it to the login
    // selector would let a login wrapped in a div slip past the veto. Pinned as
    // code because both directions are silent failures in the browser.
    assert.match(
        source,
        /var SIGNUP_FORM_SELECTOR = 'form\[data-ms-form="signup"\]'/,
        'SIGNUP_FORM_SELECTOR must stay anchored to a real form element',
    )
    assert.match(
        source,
        /var LOGIN_FORM_SELECTOR = '\[data-ms-form="login"\]'/,
        'LOGIN_FORM_SELECTOR must match the marker on any element',
    )
})

test('every V3 Xano Collection and Learn route produces its exact observable contract', async () => {
    const cases = [
        ['/skills/example', '69cccee53fd01363c8d406f3', '69cccee53fd01363c8d406f9', 'collection_signup'],
        ['/tools/example', '69ccce82af83f16acf711e18', '69ccce82af83f16acf711e1e', 'collection_signup'],
        ['/industries/example', '69cccd9d0354a390eb378509', '69cccd9e0354a390eb37855c', 'collection_signup'],
        ['/companies/example', '69f23440f1e67c01bcd642ca', '69f23440f1e67c01bcd642d0', 'collection_signup'],
        ['/categories/example', '69f2329d4f5bacf6765c1ca1', '69f2329e4f5bacf6765c1cc6', 'collection_signup'],
        ['/subcategories/example', '69f233f6f3e97748419e3a3d', '69f233f7f3e97748419e3a43', 'collection_signup'],
        ['/learn/playbooks-frameworks/example', '69e1e416f6476e12f572b39b', '69e1e417f6476e12f572b468', 'learn_unlock'],
        ['/learn/interviews-analyses/example', '69dca9df095d2fbcf34e255b', '69dca9df095d2fbcf34e2575', 'learn_signup'],
        ['/learn/sessions/example', '69e08554183023227aa46c1e', '69e08554183023227aa46c24', 'session_signup'],
    ]

    for (const [route, collectionId, pageId, intentSubtype] of cases) {
        const harness = boot({
            hostname: 'www.thestarters.com',
            pathname: route,
            pageId,
            forms: ['signup'],
            member: null,
            cookies: { event_id: 'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
            fetchHandler: async (url) =>
                String(url).includes('/auth/trade-token/v3')
                    ? { ok: true, status: 200, json: async () => ({ token: 'xano-token' }) }
                    : { ok: true, status: 200, json: async () => ({ ok: true }) },
        })
        await harness.settle()
        harness.submitSignup()
        harness.authHandlers[0](loggedInMember)
        await harness.settle()
        await harness.settle()
        await harness.settle()

        const body = JSON.parse(harness.fetchCalls[1].init.body)
        assert.equal(body.source_route, route, route)
        assert.equal(body.source_collection_id, collectionId, route)
        assert.equal(body.source_resource_slug, 'example', route)
        assert.equal(body.intent_subtype, intentSubtype, route)
    }
})

test('a real production CMS signup registers one authenticated V3 lead entry', async () => {
    const harness = boot({
        hostname: 'thestarters.com',
        pathname: '/skills/growth-marketing',
        pageId: '69cccee53fd01363c8d406f9',
        forms: ['signup'],
        member: null,
        cookies: {
            event_id: 'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            utm_source: 'linkedin',
            utm_campaign: 'operator-growth',
        },
        fetchHandler: async (url) => {
            if (String(url).includes('/auth/trade-token/v3')) {
                return { ok: true, status: 200, json: async () => ({ authToken: 'xano-token' }) }
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, replayed: false, status: 'pending' }),
            }
        },
    })
    await harness.settle()

    harness.submitSignup()
    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()
    await harness.settle()

    assert.equal(harness.fetchCalls.length, 2)
    assert.match(harness.fetchCalls[0].url, /auth\/trade-token\/v3\?token=/)
    assert.match(harness.fetchCalls[1].url, /lead_email\/register\/v3$/)
    assert.equal(harness.fetchCalls[1].init.headers.Authorization, 'Bearer xano-token')
    assert.deepEqual(JSON.parse(harness.fetchCalls[1].init.body), {
        source_event_id: 'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        source_route: '/skills/growth-marketing',
        source_collection_id: '69cccee53fd01363c8d406f3',
        source_resource_slug: 'growth-marketing',
        intent_subtype: 'collection_signup',
        properties: {
            client_payload_version: 'lead_entry_browser_v1',
            utm_source: 'linkedin',
            utm_campaign: 'operator-growth',
            signup_source: '/skills/growth-marketing',
        },
    })
    assert.equal(harness.pendingLeadEntry(), undefined)
    assert.deepEqual(plain(harness.posthogCalls), [
        {
            name: 'v3_lead_entry_registered',
            properties: {
                track_key: 'collection',
                intent_subtype: 'collection_signup',
                source_route: '/skills/growth-marketing',
                source_collection_id: '69cccee53fd01363c8d406f3',
                payload_version: 'lead_entry_browser_v1',
            },
        },
    ])
})

test('an accepted lead entry retries PostHog after the real SDK loads', async () => {
    const first = boot({
        hostname: 'thestarters.com',
        pathname: '/skills/growth-marketing',
        pageId: '69cccee53fd01363c8d406f9',
        forms: ['signup'],
        member: null,
        posthogLoaded: false,
        parkTimers: true,
        fetchHandler: async (url) =>
            String(url).includes('/auth/trade-token/v3')
                ? { ok: true, status: 200, json: async () => ({ token: 'xano-token' }) }
                : { ok: true, status: 200, json: async () => ({ ok: true }) },
    })
    await first.settle()
    first.submitSignup()
    first.authHandlers[0](loggedInMember)
    await first.settle()
    await first.settle()

    assert.equal(first.posthogCalls.length, 0)
    assert.equal(first.pendingLeadEntryPosthog().source_route, '/skills/growth-marketing')

    const second = boot({
        hostname: 'thestarters.com',
        pathname: '/quiz',
        forms: [],
        member: loggedInMember,
        session: Object.fromEntries(first.session),
    })
    await second.settle()

    assert.deepEqual(plain(second.posthogCalls), [
        {
            name: 'v3_lead_entry_registered',
            properties: {
                track_key: 'collection',
                intent_subtype: 'collection_signup',
                source_route: '/skills/growth-marketing',
                source_collection_id: '69cccee53fd01363c8d406f3',
                payload_version: 'lead_entry_browser_v1',
            },
        },
    ])
    assert.equal(second.pendingLeadEntryPosthog(), undefined)

    const third = boot({
        hostname: 'thestarters.com',
        pathname: '/quiz',
        forms: [],
        member: loggedInMember,
        session: Object.fromEntries(second.session),
    })
    await third.settle()
    assert.equal(third.posthogCalls.length, 0)
})

test('a CMS login without a signup-form submit never registers a lead entry', async () => {
    const harness = boot({
        hostname: 'thestarters.com',
        pathname: '/learn/playbooks-frameworks/growth-loop',
        pageId: '69e1e417f6476e12f572b468',
        forms: ['signup'],
        member: null,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.fetchCalls.length, 0)
    assert.equal(harness.pendingLeadEntry(), undefined)
})

test('a login submit cancels stale signup intent before the auth transition', async () => {
    const harness = boot({
        hostname: 'thestarters.com',
        pathname: '/learn/playbooks-frameworks/growth-loop',
        pageId: '69e1e417f6476e12f572b468',
        forms: ['signup'],
        member: null,
    })
    await harness.settle()

    harness.submitAuth('signup')
    harness.submitAuth('login')
    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.fetchCalls.length, 0)
    assert.equal(harness.pendingLeadEntry(), undefined)
})

test('request timeout and rate limit responses keep lead entry pending', async () => {
    for (const status of [408, 429]) {
        const harness = boot({
            hostname: 'thestarters.com',
            pathname: '/skills/growth-marketing',
            pageId: '69cccee53fd01363c8d406f9',
            forms: ['signup'],
            member: null,
            runClockForward: true,
            cookies: { event_id: 'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
            fetchHandler: async (url) =>
                String(url).includes('/auth/trade-token/v3')
                    ? { ok: true, status: 200, json: async () => ({ token: 'xano-token' }) }
                    : { ok: false, status, json: async () => ({ ok: false }) },
        })
        await harness.settle()

        harness.submitSignup()
        harness.authHandlers[0](loggedInMember)
        await harness.settle()
        await harness.settle()
        await harness.settle()

        assert.equal(
            harness.fetchCalls.filter((call) => /lead_email\/register\/v3$/.test(call.url)).length,
            4,
            String(status),
        )
        assert.equal(harness.pendingLeadEntry().expected_member_id, 'mem_123', String(status))
        assert.equal(harness.posthogCalls.length, 0, String(status))
    }
})

test('staging and unsupported CMS routes fail closed even after a signup submit', async () => {
    for (const options of [
        {
            hostname: 'the-starters-3-0.webflow.io',
            pathname: '/skills/growth-marketing',
            pageId: '69cccee53fd01363c8d406f9',
        },
        { hostname: 'thestarters.com', pathname: '/skills', pageId: '69cccee53fd01363c8d406f9' },
        { hostname: 'thestarters.com', pathname: '/skills/a/nested', pageId: '69cccee53fd01363c8d406f9' },
        { hostname: 'thestarters.com', pathname: '/learn/webinars/something', pageId: '69e1e417f6476e12f572b468' },
        { hostname: 'thestarters.com', pathname: '/skills/growth-marketing', pageId: '69d533cae257d435b84a3e6b' },
    ]) {
        const harness = boot(Object.assign({ forms: ['signup'], member: null }, options))
        await harness.settle()
        harness.submitSignup()
        harness.authHandlers[0](loggedInMember)
        await harness.settle()
        assert.equal(harness.fetchCalls.length, 0, options.pathname)
        assert.equal(harness.pendingLeadEntry(), undefined, options.pathname)
    }
})

test('a redirect retry is member-scoped and clears only after Xano accepts it', async () => {
    const pending = {
        expected_member_id: 'mem_123',
        source_event_id: 'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        source_route: '/learn/sessions/operator-session',
        source_collection_id: '69e08554183023227aa46c1e',
        source_resource_slug: 'operator-session',
        intent_subtype: 'session_signup',
        track_key: 'learn_session',
        properties: { client_payload_version: 'lead_entry_browser_v1' },
        captured_at: Date.now(),
    }
    const harness = boot({
        hostname: 'thestarters.com',
        pathname: '/brand-dashboard',
        member: loggedInMember,
        session: { [LEAD_ENTRY_PENDING_KEY]: JSON.stringify(pending) },
        fetchHandler: async (url) =>
            String(url).includes('/auth/trade-token/v3')
                ? { ok: true, status: 200, json: async () => ({ token: 'xano-token' }) }
                : { ok: true, status: 200, json: async () => ({ ok: true, replayed: true }) },
    })
    await harness.settle()
    await harness.settle()
    await harness.settle()

    assert.equal(harness.fetchCalls.length, 2)
    assert.equal(harness.pendingLeadEntry(), undefined)
    assert.equal(harness.posthogCalls.length, 1)
})

test('a pending lead entry cannot move to a different Memberstack member', async () => {
    const pending = {
        expected_member_id: 'mem_original',
        source_event_id: 'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        source_route: '/tools/example',
        source_collection_id: '69ccce82af83f16acf711e18',
        source_resource_slug: 'example',
        intent_subtype: 'collection_signup',
        track_key: 'collection',
        properties: {},
        captured_at: Date.now(),
    }
    const harness = boot({
        hostname: 'thestarters.com',
        pathname: '/brand-dashboard',
        member: loggedInMember,
        session: { [LEAD_ENTRY_PENDING_KEY]: JSON.stringify(pending) },
    })
    await harness.settle()
    await harness.settle()

    assert.equal(harness.fetchCalls.length, 0)
    assert.equal(harness.pendingLeadEntry(), undefined)
})

test('the header and README document all eleven contract field IDs', () => {
    for (const [cookie, field] of Object.entries(FIELD_IDS)) {
        const row = new RegExp('`' + cookie + '` -> `' + field + '`')
        assert.match(header, row, `${cookie} missing from the script header`)
        assert.match(readme, row, `${cookie} missing from v3/README.md`)
    }
    // Exactly ten mapping rows in the header: an extra one would be a field
    // neither script ever writes, or one nobody created in Memberstack.
    const rows = header.match(/`[a-z_]+` -> `[a-z-]+`/g) || []
    assert.equal(rows.length, COOKIE_NAMES.length)
})

test('the README cookie-contract table has a row for every cookie', () => {
    // The mapping-row check above only covers the field-ID list further down the
    // page, so every `| cookie | source |` row in the contract table could be
    // deleted with the suite still green. The table is where a reader learns
    // where each value comes from, which is exactly what is easy to get wrong
    // about the two derived cookies, so it is pinned too.
    const table = readme.slice(
        readme.indexOf('### Cookie contract'),
        readme.indexOf('### Attribution Memberstack field IDs'),
    )
    assert.ok(table, 'no Cookie contract section in v3/README.md')

    for (const name of COOKIE_NAMES) {
        assert.match(
            table,
            new RegExp('^\\|\\s*`' + name + '`\\s*\\|', 'm'),
            `${name} has no row in the README cookie-contract table`,
        )
    }
    // And no stray rows: a row for a cookie the script does not own would send a
    // reader looking for code that is not there.
    const rows = table.match(/^\|\s*`[a-z_]+`\s*\|/gm) || []
    assert.equal(rows.length, COOKIE_NAMES.length)
})

/* --------------------------- CompleteRegistration ------------------------- */

test('fires CompleteRegistration on the /quiz signup transition', async () => {
    const harness = boot({ cookies: { event_id: 'evt_fixed' }, member: null })
    await harness.settle()

    assert.equal(harness.authHandlers.length, 1)
    harness.authHandlers[0](loggedInMember)

    assert.deepEqual(plain(harness.fbqCalls), [
        ['track', 'CompleteRegistration', {}, { eventID: 'evt_fixed' }],
    ])
    assert.equal(harness.session.get(FIRED_FLAG), 'true')
})

test('fires CompleteRegistration on the /sign-up signup transition', async () => {
    const harness = boot({
        cookies: { event_id: 'evt_fixed' },
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    assert.equal(harness.authHandlers.length, 1)
    harness.authHandlers[0](loggedInMember)

    assert.deepEqual(plain(harness.fbqCalls), [
        ['track', 'CompleteRegistration', {}, { eventID: 'evt_fixed' }],
    ])
    assert.equal(harness.session.get(FIRED_FLAG), 'true')
})

test('arms on both signup paths whatever the case or trailing slash', async () => {
    for (const pathname of [
        '/quiz',
        '/quiz/',
        '/Quiz',
        '/sign-up',
        '/sign-up/',
        '/Sign-Up',
    ]) {
        const harness = boot({ member: null, pathname })
        await harness.settle()
        assert.equal(harness.authHandlers.length, 1, pathname)
    }
})

test('fires even when no ad parameter was ever captured', async () => {
    const harness = boot({ member: null })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)

    assert.equal(harness.fbqCalls.length, 1)
    const options = harness.fbqCalls[0][3]
    assert.equal(options.eventID, 'evt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
})

test('a session flag from an earlier load blocks a second fire', async () => {
    // One flag for both signup pages, so a session that already registered on
    // one of them cannot register again on the other.
    for (const pathname of ['/quiz', '/sign-up']) {
        const harness = boot({
            member: null,
            pathname,
            session: { [FIRED_FLAG]: 'true' },
        })
        await harness.settle()

        harness.authHandlers[0](loggedInMember)

        assert.deepEqual(harness.fbqCalls, [], pathname)
    }
})

test('two transitions in one session fire once', async () => {
    const harness = boot({ member: null })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    harness.authHandlers[0](null)
    harness.authHandlers[0](loggedInMember)

    assert.equal(harness.fbqCalls.length, 1)
})

test('an already logged-in visitor is not a registration', async () => {
    const harness = boot({ member: loggedInMember })
    await harness.settle()

    // Memberstack replaying the current member is not a transition.
    harness.authHandlers[0](loggedInMember)

    assert.deepEqual(harness.fbqCalls, [])
})

test('an unreadable starting state does not treat a logged-in replay as signup', async () => {
    // Failed getCurrentMember must not arm as "arrived logged out", or the next
    // auth replay for an already-signed-in visitor would fire the pixel and
    // start a spurious /sign-up field save.
    const harness = boot({
        cookies: clickCookies,
        firstMemberThrows: true,
        member: loggedInMember,
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.fbqCalls, [])
    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
})

test('an unreadable start still arms after a definitive logged-out reading', async () => {
    const harness = boot({
        cookies: clickCookies,
        firstMemberThrows: true,
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](null)
    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.fbqCalls.length, 1)
    assert.equal(harness.updateCalls.length, 1)
    assert.equal(harness.pendingSave(), undefined)
})

test('does not watch auth outside the signup pages', async () => {
    for (const pathname of [
        '/',
        '/quiz-results',
        '/login',
        '/starter-login',
        '/brand-dashboard',
        '/quiz-something',
        '/sign-up-now',
    ]) {
        const harness = boot({ member: null, pathname })
        await harness.settle()
        assert.deepEqual(harness.authHandlers, [], pathname)
        assert.deepEqual(harness.fbqCalls, [], pathname)
        assert.deepEqual(harness.updateCalls, [], pathname)
    }
})

/* -------------------------- signup surface detection ---------------------- */

test('the mapped paths arm from the path alone, with no signup form present', async () => {
    // The path map is the safety net: these two are hand-audited, so they must
    // keep arming even if their markup stops matching the detection selector.
    for (const pathname of ['/quiz', '/sign-up']) {
        const harness = boot({ member: null, pathname, forms: [] })
        await harness.settle()
        assert.equal(harness.authHandlers.length, 1, pathname)
    }
})

test('the mapped paths keep their own directSave, form or no form', async () => {
    // /quiz stays false because quiz-results.js owns that write. Detection would
    // have said true, so this proves the map is consulted first and wins.
    const quiz = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/quiz',
        forms: ['signup'],
    })
    await quiz.settle()
    quiz.authHandlers[0](loggedInMember)
    await quiz.settle()
    await quiz.settle()

    assert.equal(quiz.fbqCalls.length, 1)
    assert.deepEqual(quiz.updateCalls, [])
    assert.equal(quiz.pendingSave(), undefined)

    const signUp = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        forms: ['signup'],
    })
    await signUp.settle()
    signUp.authHandlers[0](loggedInMember)
    await signUp.settle()
    await signUp.settle()

    assert.equal(signUp.updateCalls.length, 1)
})

test('a mapped path is not vetoed by a login marker on the same page', async () => {
    // The veto guards the detection branch only. Rewriting /quiz or /sign-up to
    // also host a login form is a deliberate change, not an accident to protect
    // against, and silently unwatching them would lose a shipped conversion.
    // Both marker shapes, because the widened selector sees both.
    for (const login of ['login', markerOnDiv('login')]) {
        for (const pathname of ['/quiz', '/sign-up']) {
            const label = `${pathname} ${JSON.stringify(login)}`
            const harness = boot({
                member: null,
                pathname,
                forms: ['signup', login],
            })
            await harness.settle()
            assert.equal(harness.authHandlers.length, 1, label)
            assert.deepEqual(harness.warnings, [], label)
        }
    }
})

test('a mapped path keeps its own directSave despite a login marker', async () => {
    // The path map is consulted first and wins outright, so a login marker on
    // the page changes neither which pages arm nor who writes the fields. /quiz
    // stays hands-off (quiz-results.js owns that write) and /sign-up still
    // direct-saves.
    for (const login of ['login', markerOnDiv('login')]) {
        const label = JSON.stringify(login)

        const quiz = boot({
            cookies: clickCookies,
            member: null,
            pathname: '/quiz',
            forms: ['signup', login],
        })
        await quiz.settle()
        quiz.authHandlers[0](loggedInMember)
        await quiz.settle()
        await quiz.settle()

        assert.equal(quiz.fbqCalls.length, 1, label)
        assert.deepEqual(quiz.updateCalls, [], label)
        assert.equal(quiz.pendingSave(), undefined, label)

        const signUp = boot({
            cookies: clickCookies,
            member: null,
            pathname: '/sign-up',
            forms: ['signup', login],
        })
        await signUp.settle()
        signUp.authHandlers[0](loggedInMember)
        await signUp.settle()
        await signUp.settle()

        assert.equal(signUp.fbqCalls.length, 1, label)
        assert.deepEqual(signUp.savedFields(), [
            {
                'utm-source': 'facebook',
                'utm-campaign': 'summer',
                fbclid: 'IwAR123',
                'event-id': 'evt_fixed',
                'signup-source': '/sign-up',
            },
        ], label)
    }
})

test('an unmapped page with a signup form arms and direct-saves', async () => {
    // The /all-starters signup modal. Its form is display:none inside a
    // <dialog> until the modal opens, and detection deliberately never asks.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/all-starters',
        forms: ['profile', 'signup', 'profile'],
    })
    await harness.settle()

    assert.equal(harness.authHandlers.length, 1)
    harness.authHandlers[0](loggedInMember)

    // Marked synchronously, because the modal's redirect reloads the page.
    assert.equal(harness.pendingSave(), 'true')
    await harness.settle()
    await harness.settle()

    assert.deepEqual(plain(harness.fbqCalls), [
        ['track', 'CompleteRegistration', {}, { eventID: 'evt_fixed' }],
    ])
    assert.deepEqual(harness.savedFields(), [
        {
            'utm-source': 'facebook',
            'utm-campaign': 'summer',
            fbclid: 'IwAR123',
            'event-id': 'evt_fixed',
            // The page the modal signed the visitor up on, not the page its own
            // reload lands them back on.
            'signup-source': '/all-starters',
        },
    ])
    assert.equal(harness.pendingSave(), undefined)
})

test('a page with both a signup and a login form is not watched', async () => {
    // Fail safe: a login there would look like a registration, firing a false
    // CompleteRegistration and stamping this browser's UTM values onto a member
    // who already has their own.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/some-combined-page',
        forms: ['signup', 'login'],
    })
    await harness.settle()

    assert.deepEqual(harness.authHandlers, [])
    assert.deepEqual(harness.fbqCalls, [])
    assert.deepEqual(harness.updateCalls, [])
    assert.ok(
        harness.warnings.some((message) => /signup watch not armed/.test(message)),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )
})

test('a login marker on a non-form element still vetoes the page', async () => {
    // The reason LOGIN_FORM_SELECTOR drops the `form` prefix. Nothing pins the
    // marker to a real <form>: v3/auth-route.js queries it bare, so a login UI
    // wrapped in a div is markup nobody would think of as a change. A prefixed
    // veto would miss it and fire a false CompleteRegistration on every login
    // here, which is the exact failure the guard exists to prevent.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/some-combined-page',
        forms: ['signup', markerOnDiv('login')],
    })
    await harness.settle()

    assert.deepEqual(harness.authHandlers, [])
    assert.deepEqual(harness.fbqCalls, [])
    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
    assert.ok(
        harness.warnings.some((message) => /signup watch not armed/.test(message)),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )
})

test('a signup marker on a non-form element does not arm the watch', async () => {
    // The other half of the asymmetry, and the proof the harness still tells
    // the two selectors apart rather than matching every marker everywhere.
    // Arming needs a real <form>, so a bare marker on a wrapper is not enough.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/all-starters',
        forms: [markerOnDiv('signup')],
    })
    await harness.settle()

    assert.deepEqual(harness.authHandlers, [])
    assert.equal(harness.api.rearm(), false)
    // Not ambiguous, just unrecognised: no signup form means no warning either.
    assert.deepEqual(harness.warnings, [])
})

test('the ambiguous-page warning stays off production', async () => {
    for (const login of ['login', markerOnDiv('login')]) {
        const harness = boot({
            hostname: 'thestarters.com',
            member: null,
            pathname: '/some-combined-page',
            forms: ['signup', login],
        })
        await harness.settle()

        assert.deepEqual(harness.authHandlers, [], JSON.stringify(login))
        assert.deepEqual(harness.warnings, [], JSON.stringify(login))
    }
})

test('an unmapped page with no signup form is not watched', async () => {
    for (const forms of [
        [],
        ['profile'],
        ['login'],
        ['profile', 'login'],
        [markerOnDiv('login')],
        [markerOnDiv('signup')],
    ]) {
        const harness = boot({
            member: null,
            pathname: '/brand-dashboard',
            forms,
        })
        await harness.settle()
        assert.deepEqual(harness.authHandlers, [], JSON.stringify(forms))
        assert.deepEqual(harness.warnings, [], JSON.stringify(forms))
    }
})

test('rearm arms a form injected after load and never registers a second listener', async () => {
    // The harness passes this array straight through to querySelectorAll, so
    // pushing to it is a form appearing in the DOM after DOMContentLoaded.
    const forms = []
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/all-starters',
        forms,
    })
    await harness.settle()
    assert.deepEqual(harness.authHandlers, [])

    forms.push('signup')
    assert.equal(harness.api.rearm(), true)
    await harness.settle()
    assert.equal(harness.authHandlers.length, 1)

    // Redundant calls are a no-op. A second onAuthChange listener would fire
    // CompleteRegistration twice and start two competing saves.
    assert.equal(harness.api.rearm(), true)
    assert.equal(harness.api.rearm(), true)
    await harness.settle()
    assert.equal(harness.authHandlers.length, 1)

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.fbqCalls.length, 1)
    assert.equal(harness.updateCalls.length, 1)
})

test('rearm on a page that already armed at load does not double-register', async () => {
    const harness = boot({ member: null, pathname: '/sign-up' })
    await harness.settle()

    assert.equal(harness.authHandlers.length, 1)
    assert.equal(harness.api.rearm(), true)
    await harness.settle()
    assert.equal(harness.authHandlers.length, 1)
})

test('rearm reports false on a page with nothing to watch', async () => {
    const harness = boot({ member: null, pathname: '/brand-dashboard' })
    await harness.settle()

    assert.equal(harness.api.rearm(), false)
    assert.deepEqual(harness.authHandlers, [])
})

test('a watch that never found Memberstack gives its claim back', async () => {
    // The claim is taken synchronously so two same-tick calls cannot both
    // register a listener, so a watch that cannot be established has to hand it
    // back or rearm() is a no-op for the life of the page that still reports
    // true.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        noMemberstack: true,
        runClockForward: true,
    })
    await harness.settle()

    assert.deepEqual(harness.authHandlers, [])
    assert.ok(
        harness.warnings.some((message) =>
            /Memberstack never loaded/.test(message),
        ),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )

    // Memberstack turns up late. If the claim had latched, this rearm would
    // report an armed watch and register nothing.
    harness.attachMemberstack()
    assert.equal(harness.api.rearm(), true)
    await harness.settle()
    assert.equal(harness.authHandlers.length, 1)

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()
    assert.equal(harness.fbqCalls.length, 1)
})

test('a Memberstack with no onAuthChange gives the claim back too', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        noOnAuthChange: true,
    })
    await harness.settle()

    assert.deepEqual(harness.authHandlers, [])
    // Silent on purpose: the warnings this path does and does not emit are
    // unchanged by the claim moving to a single owner.
    assert.deepEqual(harness.warnings, [])

    harness.attachOnAuthChange()
    assert.equal(harness.api.rearm(), true)
    await harness.settle()
    assert.equal(harness.authHandlers.length, 1)
})

test('a throwing onAuthChange keeps the claim, deliberately', async () => {
    // The one path that does NOT release. A throw out of onAuthChange leaves us
    // unable to know whether the listener registered before it threw, so the
    // claim stays taken: a second registration would fire CompleteRegistration
    // twice and start two competing saves, and a missed attribution is the
    // cheaper failure. The double works on its second call, so a released claim
    // would show up here as a listener.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        authChangeThrowsOnce: true,
    })
    await harness.settle()

    assert.deepEqual(harness.authHandlers, [])
    assert.ok(
        harness.warnings.some((message) =>
            /CompleteRegistration wiring failed/.test(message),
        ),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )

    assert.equal(harness.api.rearm(), true)
    await harness.settle()
    assert.deepEqual(harness.authHandlers, [])
    assert.deepEqual(harness.fbqCalls, [])
})

test('an unqueryable DOM reads as no forms instead of throwing', async () => {
    // A mapped path still arms from the path alone, and an unmapped one simply
    // does not arm. Neither raises anything into the page.
    const mapped = boot({
        member: null,
        pathname: '/sign-up',
        noQuerySelectorAll: true,
    })
    await mapped.settle()
    assert.equal(mapped.authHandlers.length, 1)

    for (const broken of [
        { noQuerySelectorAll: true },
        { querySelectorThrows: true },
    ]) {
        const harness = boot(
            Object.assign({ member: null, pathname: '/all-starters' }, broken),
        )
        await harness.settle()
        assert.deepEqual(harness.authHandlers, [], JSON.stringify(broken))
        assert.equal(harness.api.rearm(), false, JSON.stringify(broken))
    }
})

test('a missing fbq does not throw and warns only on staging', async () => {
    const staging = boot({ member: null, noFbq: true })
    await staging.settle()
    staging.authHandlers[0](loggedInMember)

    assert.equal(staging.warnings.length, 1)
    assert.match(staging.warnings[0], /Meta Pixel not found/)
    // Not marked as fired, so a working pixel on the next page still counts.
    assert.equal(
        staging.session.get('startersCompleteRegistrationFired'),
        undefined,
    )

    const production = boot({
        member: null,
        noFbq: true,
        hostname: 'thestarters.com',
    })
    await production.settle()
    production.authHandlers[0](loggedInMember)

    assert.deepEqual(production.warnings, [])
})

test('a lookalike host is not treated as staging', async () => {
    const harness = boot({
        member: null,
        noFbq: true,
        hostname: 'notwebflow.io',
    })
    await harness.settle()
    harness.authHandlers[0](loggedInMember)

    assert.deepEqual(harness.warnings, [])
})

test('an absent Memberstack never throws', async () => {
    const harness = boot({ noMemberstack: true, parkTimers: true })
    await harness.settle()

    // Capture still happened; only the registration watch is unavailable.
    assert.equal(harness.api.getParams().event_id.startsWith('evt_'), true)
    assert.deepEqual(harness.fbqCalls, [])
})

/* --------------------------- field persistence ---------------------------- */

test('the /sign-up transition marks the save before starting it', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)

    // Checked before settling on purpose: the marker has to be in storage by the
    // time the handler returns, because the form's redirect="/brand-dashboard"
    // can navigate away before the request lands.
    assert.equal(harness.pendingSave(), 'true')
    assert.deepEqual(harness.pendingFields(), {
        'utm-source': 'facebook',
        'utm-campaign': 'summer',
        fbclid: 'IwAR123',
        'event-id': 'evt_fixed',
        'signup-source': '/sign-up',
    })

    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        {
            'utm-source': 'facebook',
            'utm-campaign': 'summer',
            fbclid: 'IwAR123',
            'event-id': 'evt_fixed',
            'signup-source': '/sign-up',
        },
    ])
    // Absent cookies are omitted rather than written blank.
    assert.deepEqual(Object.keys(harness.savedFields()[0]).sort(), [
        'event-id',
        'fbclid',
        'signup-source',
        'utm-campaign',
        'utm-source',
    ])
    // Confirmed write, so the marker and snapshot are gone and no page retries.
    assert.equal(harness.pendingSave(), undefined)
    assert.equal(harness.pendingFields(), undefined)
})

test('whitespace-only cookies are omitted from the Memberstack write', async () => {
    const harness = boot({
        cookies: {
            utm_source: '   ',
            utm_campaign: 'summer',
            event_id: 'evt_fixed',
        },
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        {
            'utm-campaign': 'summer',
            'event-id': 'evt_fixed',
            'signup-source': '/sign-up',
        },
    ])
})

test('retry uses the signup-time field snapshot, not fresh cookies', async () => {
    // A fresh ad click landed between /sign-up and /brand-dashboard. The write
    // must still use the values the signup captured.
    const harness = boot({
        cookies: {
            utm_source: 'google',
            utm_campaign: 'winter',
            event_id: 'evt_new',
        },
        member: loggedInMember,
        pathname: '/brand-dashboard',
        session: {
            [PENDING_SAVE_FLAG]: 'true',
            [PENDING_FIELDS_KEY]: JSON.stringify({
                'utm-source': 'facebook',
                'utm-campaign': 'summer',
                fbclid: 'IwAR123',
                'event-id': 'evt_fixed',
            }),
        },
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        {
            'utm-source': 'facebook',
            'utm-campaign': 'summer',
            fbclid: 'IwAR123',
            'event-id': 'evt_fixed',
        },
    ])
    assert.equal(harness.pendingSave(), undefined)
    assert.equal(harness.pendingFields(), undefined)
})

test('a marker without a snapshot still falls back to live cookies', async () => {
    // Pre-snapshot sessions (or blocked storage on the signup page) leave only
    // the marker. Live cookies remain the best available values.
    const harness = boot({
        cookies: clickCookies,
        member: loggedInMember,
        pathname: '/brand-dashboard',
        session: { [PENDING_SAVE_FLAG]: 'true' },
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        {
            'utm-source': 'facebook',
            'utm-campaign': 'summer',
            fbclid: 'IwAR123',
            'event-id': 'evt_fixed',
        },
    ])
    assert.equal(harness.pendingSave(), undefined)
})

test('the /quiz transition never writes the fields itself', async () => {
    const harness = boot({ cookies: clickCookies, member: null })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    // quiz-results.js owns that write, as part of its single quiz save.
    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
    // The Meta event still fires on the quiz path.
    assert.equal(harness.fbqCalls.length, 1)
})

test('a marker left by an earlier page is completed on the next load', async () => {
    // What the redirect to /brand-dashboard leaves behind: marker set, member now
    // logged in, no transition on this page at all.
    const harness = boot({
        cookies: clickCookies,
        member: loggedInMember,
        pathname: '/brand-dashboard',
        session: { [PENDING_SAVE_FLAG]: 'true' },
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        {
            'utm-source': 'facebook',
            'utm-campaign': 'summer',
            fbclid: 'IwAR123',
            'event-id': 'evt_fixed',
        },
    ])
    assert.equal(harness.pendingSave(), undefined)
})

test('no marker means no retry write', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: loggedInMember,
        pathname: '/brand-dashboard',
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.updateCalls, [])
})

test('a marker with a logged-out visitor is cleared without a write', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/brand-dashboard',
        session: { [PENDING_SAVE_FLAG]: 'true' },
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
})

test('an unreadable member state defers instead of clearing the marker', async () => {
    const harness = boot({
        cookies: clickCookies,
        memberThrows: true,
        pathname: '/brand-dashboard',
        session: { [PENDING_SAVE_FLAG]: 'true' },
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.updateCalls, [])
    // Not proof of a logged-out visitor, so the next load tries again.
    assert.equal(harness.pendingSave(), 'true')
})

test('a failed write leaves the marker for the next load', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        updateFails: true,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.updateCalls.length, 1)
    assert.equal(harness.pendingSave(), 'true')
    assert.ok(
        harness.warnings.some((message) => /attribution save failed/.test(message)),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )
})

test('a Memberstack without updateMember leaves the marker set', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: null,
        noUpdateMember: true,
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.pendingSave(), 'true')
    assert.ok(
        harness.warnings.some((message) => /updateMember unavailable/.test(message)),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )
})

test('nothing to save clears the marker without a write', async () => {
    // Cookies blocked entirely: there is no attribution to persist, so retrying
    // on every page load forever would be pointless.
    const harness = boot({
        member: null,
        pathname: '/sign-up',
        readOnlyCookies: true,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
})

test('this page\'s own signup marker survives a slow member read', async () => {
    // The narrow interleaving: a stale marker was already in storage, the retry's
    // member read is still pending when the signup lands, and that read then comes
    // back logged out. Clearing there would discard the save the next page owes.
    const harness = boot({
        cookies: clickCookies,
        holdSecondMemberRead: true,
        member: null,
        pathname: '/sign-up',
        session: { [PENDING_SAVE_FLAG]: 'true' },
        updateFails: true,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    harness.releaseMember()
    await harness.settle()
    await harness.settle()

    assert.equal(harness.pendingSave(), 'true')
})

test('the save never throws into the page', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        updateFails: true,
    })
    await harness.settle()

    assert.doesNotThrow(() => harness.authHandlers[0](loggedInMember))
    await harness.settle()
    await harness.settle()
})

/* ------------------------------ signup source ----------------------------- */

test('the signup page path is stored on the transition and saved as signup-source', async () => {
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    // Nothing yet: the page load itself is not a signup.
    assert.deepEqual(harness.writesFor('signup_source'), [])

    harness.authHandlers[0](loggedInMember)

    assert.equal(harness.writesFor('signup_source').length, 1)
    assert.equal(harness.api.getParams().signup_source, '/sign-up')
    // Snapshotted synchronously with the rest, so the form's own redirect to
    // /brand-dashboard cannot lose it.
    assert.equal(harness.pendingFields()['signup-source'], '/sign-up')

    await harness.settle()
    await harness.settle()

    assert.equal(harness.savedFields()[0]['signup-source'], '/sign-up')
})

test('the /quiz transition stores the cookie even though it never saves fields', async () => {
    // The reason the write sits before the directSave branch. /quiz is mapped
    // directSave false because quiz-results.js owns that write, so
    // persistAfterDirectSignup never runs here; the cookie is how /quiz-results
    // learns where the signup happened. Inside the branch, every quiz-funnel
    // member would get no signup-source at all.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/quiz',
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.api.getParams().signup_source, '/quiz')
    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
})

test('a page load with no signup transition never touches the cookie', async () => {
    // The reason this cannot live in capture(), which runs on every load. A
    // cookie written there would mean "last page loaded", so /brand-dashboard
    // would overwrite the /sign-up that redirected to it.
    for (const pathname of ['/sign-up', '/quiz', '/brand-dashboard', '/']) {
        const harness = boot({
            cookies: { signup_source: '/all-starters' },
            member: null,
            pathname,
        })
        await harness.settle()

        assert.deepEqual(harness.writesFor('signup_source'), [], pathname)
        assert.equal(
            harness.api.getParams().signup_source,
            '/all-starters',
            pathname,
        )
    }
})

test('a signup_source URL parameter cannot spoof the cookie', async () => {
    const harness = boot({
        member: null,
        pathname: '/brand-dashboard',
        search: '?signup_source=/spoofed',
    })
    await harness.settle()

    assert.deepEqual(harness.writesFor('signup_source'), [])
    assert.equal(harness.api.getParams().signup_source, null)

    // Not even on a page that does transition: the value comes from the path.
    const armed = boot({
        member: null,
        pathname: '/sign-up',
        search: '?signup_source=/spoofed',
    })
    await armed.settle()
    armed.authHandlers[0](loggedInMember)

    assert.equal(armed.api.getParams().signup_source, '/sign-up')
})

test('the stored path is normalized the same way the path map is matched', async () => {
    // Reuses normalizePath, so a CMS page reached with mixed case and a trailing
    // slash stores one canonical value rather than three spellings of it.
    const profile = boot({
        member: null,
        pathname: '/Starters/John-Doe/',
        forms: ['signup'],
    })
    await profile.settle()
    profile.authHandlers[0](loggedInMember)

    assert.equal(profile.api.getParams().signup_source, '/starters/john-doe')

    // The homepage keeps its slash through normalizePath (never an empty
    // string) and attribution stores that root as /home.
    const home = boot({ member: null, pathname: '/', forms: ['signup'] })
    await home.settle()
    home.authHandlers[0](loggedInMember)

    assert.equal(home.api.getParams().signup_source, '/home')
})

/* ----------------------------- signup referrer ---------------------------- */

// The host the harness serves from, so a referrer can be built same-origin.
const SITE = 'https://the-starters-3-0.webflow.io'

test('a homepage click through to /quiz records the homepage', async () => {
    // The case signup_source cannot answer: / has no signup form at all, so the
    // source is /quiz and only the referrer can say they started on the homepage.
    // Attribution stores that root as /home, not /, so analytics stays path-shaped.
    const harness = boot({
        member: null,
        pathname: '/quiz',
        referrer: `${SITE}/`,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)

    assert.equal(harness.api.getParams().signup_referrer, '/home')
    assert.equal(harness.api.getParams().signup_source, '/quiz')
})

test('a cross-origin referrer is never stored', async () => {
    // The field means "the page on OUR site where they clicked". An external
    // origin is already carried by utm_source and fbclid, so storing a hostname
    // here would poison a field of paths for no new information.
    for (const referrer of [
        'https://www.google.com/search?q=starters',
        'https://l.facebook.com/',
        'https://www.linkedin.com/feed/',
        // A lookalike host: same suffix, different origin.
        'https://notwebflow.io/quiz',
        // Same host, different scheme, so still a different origin.
        'http://the-starters-3-0.webflow.io/',
    ]) {
        const harness = boot({ member: null, pathname: '/quiz', referrer })
        await harness.settle()

        harness.authHandlers[0](loggedInMember)

        assert.deepEqual(harness.writesFor('signup_referrer'), [], referrer)
        assert.equal(harness.api.getParams().signup_referrer, null, referrer)
    }
})

test('no referrer stores nothing', async () => {
    // Direct navigation, a typed URL, or a referrer policy that strips it. Blank
    // is the honest answer: there was no previous page.
    for (const referrer of ['', undefined]) {
        const harness = boot({ member: null, pathname: '/quiz', referrer })
        await harness.settle()

        harness.authHandlers[0](loggedInMember)

        assert.deepEqual(harness.writesFor('signup_referrer'), [])
        assert.equal(harness.api.getParams().signup_referrer, null)
    }
})

test('a referrer query string and hash are dropped, and the path normalized', async () => {
    const harness = boot({
        member: null,
        pathname: '/quiz',
        referrer: `${SITE}/Starters/John-Doe/?utm_source=facebook&x=1#experience`,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)

    assert.equal(harness.api.getParams().signup_referrer, '/starters/john-doe')
})

test('the homepage referrer stores /home and never becomes an empty string', async () => {
    const harness = boot({
        member: null,
        pathname: '/sign-up',
        referrer: `${SITE}/?utm_source=facebook`,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)

    assert.equal(harness.api.getParams().signup_referrer, '/home')
})

test('a location object without origin still resolves same-origin', async () => {
    const harness = boot({
        member: null,
        noLocationOrigin: true,
        pathname: '/quiz',
        referrer: `${SITE}/all-starters`,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)

    assert.equal(harness.api.getParams().signup_referrer, '/all-starters')
})

test('/quiz records the referrer despite directSave being false', async () => {
    // The timing case. /quiz never writes fields from here, so the cookie is the
    // only carrier: quiz-results.js reads it on the next page. A capture on page
    // load would have been overwritten by /quiz-results' own referrer, which is
    // /quiz itself, and every quiz signup would claim it came from /quiz.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/quiz',
        referrer: `${SITE}/`,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.api.getParams().signup_referrer, '/home')
    // Nothing written from here, exactly as before: quiz-results.js owns it.
    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
    // And the cookie jar is what quiz-results.js will read a page later.
    assert.match(harness.document.cookie, /signup_referrer=%2Fhome(?:;|$)/)
})

test('the /quiz-results load cannot overwrite the referrer the quiz signup stored', async () => {
    // The whole reason capture happens at the transition. Sequence as the browser
    // runs it: sign up on /quiz having arrived from /, then land on /quiz-results
    // whose own referrer IS /quiz. Captured on page load, this second step would
    // rewrite the cookie to /quiz and quiz-results.js would read /quiz for every
    // single quiz signup, permanently losing the real answer.
    const quiz = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/quiz',
        referrer: `${SITE}/`,
    })
    await quiz.settle()
    quiz.authHandlers[0](loggedInMember)
    await quiz.settle()

    assert.equal(quiz.api.getParams().signup_referrer, '/home')

    // The next page, same cookie jar, referred by /quiz.
    const results = boot({
        cookies: Object.fromEntries(quiz.document.jar),
        member: loggedInMember,
        pathname: '/quiz-results',
        referrer: `${SITE}/quiz`,
    })
    await results.settle()
    await results.settle()

    assert.deepEqual(results.writesFor('signup_referrer'), [])
    // What quiz-results.js reads when it builds its single save.
    assert.equal(results.api.getParams().signup_referrer, '/home')
    assert.equal(results.api.getParams().signup_source, '/quiz')
})

test('a page load with no transition never touches the referrer cookie', async () => {
    for (const pathname of ['/sign-up', '/quiz', '/brand-dashboard', '/']) {
        const harness = boot({
            cookies: { signup_referrer: '/starters/john-doe' },
            member: null,
            pathname,
            referrer: `${SITE}/all-starters`,
        })
        await harness.settle()

        assert.deepEqual(harness.writesFor('signup_referrer'), [], pathname)
        assert.equal(
            harness.api.getParams().signup_referrer,
            '/starters/john-doe',
            pathname,
        )
    }
})

test('a signup_referrer URL parameter cannot spoof the cookie', async () => {
    const harness = boot({
        member: null,
        pathname: '/brand-dashboard',
        search: '?signup_referrer=/spoofed',
    })
    await harness.settle()

    assert.deepEqual(harness.writesFor('signup_referrer'), [])
    assert.equal(harness.api.getParams().signup_referrer, null)

    // Not on a page that does transition either: the value comes from the
    // referrer, and a URL parameter is not one.
    const armed = boot({
        member: null,
        pathname: '/sign-up',
        referrer: `${SITE}/all-starters`,
        search: '?signup_referrer=/spoofed',
    })
    await armed.settle()
    armed.authHandlers[0](loggedInMember)

    assert.equal(armed.api.getParams().signup_referrer, '/all-starters')
})

test('the modal reload cannot overwrite the referrer it signed up under', async () => {
    // /all-starters redirects to itself with ?modal-id=signup-modal. The
    // transition fires on the FIRST load, so the referrer stored is the page that
    // linked to /all-starters. The reload is just another page load, and a page
    // load never touches the cookie.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/all-starters',
        forms: ['signup'],
        referrer: `${SITE}/`,
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.savedFields()[0]['signup-referrer'], '/home')
    assert.equal(harness.savedFields()[0]['signup-source'], '/all-starters')

    // The reload: same jar, and this time /all-starters is its own referrer.
    const reload = boot({
        cookies: Object.fromEntries(harness.document.jar),
        member: loggedInMember,
        pathname: '/all-starters',
        forms: ['signup'],
        referrer: `${SITE}/all-starters`,
        search: '?modal-id=signup-modal',
    })
    await reload.settle()
    await reload.settle()

    assert.deepEqual(reload.writesFor('signup_referrer'), [])
    assert.equal(reload.api.getParams().signup_referrer, '/home')
})

/* ------------------ signup source and referrer are write-once ------------- */

test('a member who already has these fields keeps them', async () => {
    // The failure this closes: the script cannot see a signup, only a logged-out
    // to logged-in transition on a page with a signup form, so a RETURNING member
    // logging in on /sign-up arrives here indistinguishable from a new one.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](
        memberWithFields({
            'signup-source': '/starters/jane-doe',
            'signup-referrer': '/all-starters',
        }),
    )
    await harness.settle()
    await harness.settle()

    // Both keys are gone from the write, and the other eight are untouched.
    assert.deepEqual(harness.savedFields(), [CLICK_FIELDS])
    assert.equal(harness.pendingSave(), undefined)
    assert.equal(harness.pendingFields(), undefined)
    // Read off the payload we already had: one member read on this page, the
    // watch's own starting probe, and no round trip added for the guard.
    assert.equal(harness.memberReads.length, 1)
})

test('each write-once field is judged on its own', async () => {
    // A member who signed up before signup-referrer existed holds a source and no
    // referrer. Their source must survive, and the referrer must still be filled
    // in, or the field could never be backfilled for anyone.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        referrer: `${SITE}/all-starters`,
    })
    await harness.settle()

    harness.authHandlers[0](memberWithFields({ 'signup-source': '/quiz' }))
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        Object.assign({}, CLICK_FIELDS, { 'signup-referrer': '/all-starters' }),
    ])
})

test('a member with a filled signup-referrer keeps it', async () => {
    // The mirror image: referrer held, source still absent, and the eight click
    // fields ride along in the same payload either way.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
        referrer: `${SITE}/all-starters`,
    })
    await harness.settle()

    harness.authHandlers[0](memberWithFields({ 'signup-referrer': '/' }))
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        Object.assign({}, CLICK_FIELDS, { 'signup-source': '/sign-up' }),
    ])
})

test('an unfilled existing write-once value is written', async () => {
    // Absent, null, empty and whitespace-only are all "not filled". Anything else
    // would leave a member stuck with a blank field nothing can ever fill.
    for (const existing of [undefined, null, '', '   ', '\n\t ']) {
        const label = JSON.stringify(existing)
        const harness = boot({
            cookies: clickCookies,
            member: null,
            pathname: '/sign-up',
        })
        await harness.settle()

        harness.authHandlers[0](
            memberWithFields(
                existing === undefined ? {} : { 'signup-source': existing },
            ),
        )
        await harness.settle()
        await harness.settle()

        assert.deepEqual(
            harness.savedFields(),
            [Object.assign({}, CLICK_FIELDS, { 'signup-source': '/sign-up' })],
            label,
        )
    }
})

test('an unreadable existing value writes rather than skips', async () => {
    // The deliberate opposite of how CompleteRegistration resolves its doubt. A
    // genuine first signup with an empty field is the common case by a wide
    // margin, so skipping here would cost real attribution on every signup
    // whenever the read hiccups, to prevent a much rarer overwrite.
    const harness = boot({
        cookies: clickCookies,
        laterMemberReadsThrow: true,
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    // A payload with no customFields on it, so the guard has to go looking, and
    // the lookup is what fails.
    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [
        Object.assign({}, CLICK_FIELDS, { 'signup-source': '/sign-up' }),
    ])
    assert.equal(harness.pendingSave(), undefined)
})

test('the guard looks the member up when the payload carries no custom fields', async () => {
    // Nothing in the repo proves onAuthChange payloads carry customFields, so this
    // fallback is the path that actually runs in production until proven
    // otherwise. Arrived logged out, transition payload with no fields on it, and
    // the member Memberstack reports afterwards is the one holding the filled
    // field.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        memberAfterSignup: loggedInMember,
        memberFields: { 'signup-source': '/starters/jane-doe' },
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [CLICK_FIELDS])
    // The probe, plus the guard's own lookup: proof it went and asked.
    assert.equal(harness.memberReads.length, 2)
})

test('the retry path guards from the member it already read', async () => {
    // retryPendingSave holds a getCurrentMember result already, so it hands the
    // fields over instead of making the guard read the same member again.
    const harness = boot({
        cookies: clickCookies,
        member: loggedInMember,
        memberFields: { 'signup-source': '/starters/jane-doe' },
        pathname: '/brand-dashboard',
        session: {
            [PENDING_SAVE_FLAG]: 'true',
            [PENDING_FIELDS_KEY]: JSON.stringify(
                Object.assign({}, CLICK_FIELDS, { 'signup-source': '/quiz' }),
            ),
        },
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [CLICK_FIELDS])
    assert.equal(harness.pendingSave(), undefined)
    // Exactly one member read on this page: the retry's own.
    assert.equal(harness.memberReads.length, 1)
})

test('a write that owed only the write-once fields settles instead of retrying forever', async () => {
    // The guard can empty the payload. That is settled, not failed, or the marker
    // would be retried on every page load for a write that must never happen.
    const harness = boot({
        member: loggedInMember,
        memberFields: {
            'signup-source': '/starters/jane-doe',
            'signup-referrer': '/all-starters',
        },
        pathname: '/brand-dashboard',
        session: {
            [PENDING_SAVE_FLAG]: 'true',
            [PENDING_FIELDS_KEY]: JSON.stringify({
                'signup-source': '/quiz',
                'signup-referrer': '/',
            }),
        },
    })
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.updateCalls, [])
    assert.equal(harness.pendingSave(), undefined)
    assert.equal(harness.pendingFields(), undefined)
})

test('the guard never touches the other eight fields', async () => {
    // One key wide, deliberately: the click parameters are last-touch and a fresh
    // ad click is supposed to update them. Proven against a member who already
    // has every field filled, both write-once fields included.
    const harness = boot({
        cookies: clickCookies,
        member: null,
        pathname: '/sign-up',
    })
    await harness.settle()

    harness.authHandlers[0](
        memberWithFields({
            'utm-source': 'google',
            'utm-campaign': 'winter',
            'utm-adset': 'old-adset',
            'utm-content': 'old-creative',
            fbclid: 'IwAR000',
            fbc: 'fb.1.1600000000.old',
            fbp: 'fb.1.1600000000.old',
            'event-id': 'evt_old',
            'signup-source': '/starters/jane-doe',
            'signup-referrer': '/all-starters',
        }),
    )
    await harness.settle()
    await harness.settle()

    assert.deepEqual(harness.savedFields(), [CLICK_FIELDS])
})

/* ------------------------------ signup trigger ---------------------------- */

const hirePage = {
    member: null,
    pathname: '/hire/jane-doe',
    forms: ['signup'],
}

test('a logged-out Hire click stores hire and opens the signup modal', async () => {
    const harness = boot(hirePage)
    await harness.settle()

    const event = harness.clickTrigger({ element: 'hire' })

    assert.equal(harness.api.getParams().signup_trigger, 'hire')
    assert.equal(harness.writesFor('signup_trigger').length, 1)
    assert.equal(event.defaultPrevented, true)
    assert.equal(event.propagationStopped, true)
    assert.equal(harness.openedSignup.length, 1)
})

test('Message and Book Call clicks store their enum values', async () => {
    for (const element of ['message', 'book-call']) {
        const harness = boot(hirePage)
        await harness.settle()
        harness.clickTrigger({ element })
        assert.equal(harness.api.getParams().signup_trigger, element, element)
    }
})

test('a service click with a value stores service:<detail>', async () => {
    const harness = boot(hirePage)
    await harness.settle()

    harness.clickTrigger({ element: 'service', value: 'brand-strategy' })

    assert.equal(harness.api.getParams().signup_trigger, 'service:brand-strategy')
})

test('a service click without a value writes nothing', async () => {
    const harness = boot(hirePage)
    await harness.settle()

    harness.clickTrigger({ element: 'service' })

    assert.equal(harness.api.getParams().signup_trigger, null)
    assert.deepEqual(harness.writesFor('signup_trigger'), [])
    assert.equal(harness.openedSignup.length, 0)
    assert.ok(
        harness.warnings.some((message) => /signup trigger/.test(message)),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )
})

test('an unknown trigger element writes nothing', async () => {
    const harness = boot(hirePage)
    await harness.settle()

    harness.clickTrigger({ element: 'newsletter' })

    assert.equal(harness.api.getParams().signup_trigger, null)
    assert.deepEqual(harness.writesFor('signup_trigger'), [])
    assert.equal(harness.openedSignup.length, 0)
    assert.ok(
        harness.warnings.some((message) => /signup trigger/.test(message)),
        `no staging warning in ${JSON.stringify(harness.warnings)}`,
    )
})

test('an unknown trigger element stays silent on production', async () => {
    const harness = boot(Object.assign({}, hirePage, { hostname: 'thestarters.com' }))
    await harness.settle()

    harness.clickTrigger({ element: 'newsletter' })

    assert.deepEqual(harness.warnings, [])
    assert.equal(harness.api.getParams().signup_trigger, null)
})

test('the last CTA click wins until signup', async () => {
    const harness = boot(hirePage)
    await harness.settle()

    harness.clickTrigger({ element: 'message' })
    harness.clickTrigger({ element: 'hire' })

    assert.equal(harness.api.getParams().signup_trigger, 'hire')
    assert.equal(harness.writesFor('signup_trigger').length, 2)
})

test('a logged-in click does not stamp Signup Trigger or open signup', async () => {
    const harness = boot(
        Object.assign({}, hirePage, { member: loggedInMember }),
    )
    await harness.settle()

    const event = harness.clickTrigger({ element: 'hire' })

    assert.equal(harness.api.getParams().signup_trigger, null)
    assert.deepEqual(harness.writesFor('signup_trigger'), [])
    assert.equal(event.defaultPrevented, false)
    assert.deepEqual(harness.openedSignup, [])
})

test('an optional value attr overrides the Hire/Message/Book Call enum', async () => {
    const harness = boot(hirePage)
    await harness.settle()

    harness.clickTrigger({ element: 'hire', value: 'hire-sticky' })

    assert.equal(harness.api.getParams().signup_trigger, 'hire-sticky')
})

test('a signup_trigger URL parameter cannot spoof the cookie', async () => {
    const harness = boot({
        member: null,
        pathname: '/hire/jane-doe',
        forms: ['signup'],
        search: '?signup_trigger=hire',
    })
    await harness.settle()

    assert.deepEqual(harness.writesFor('signup_trigger'), [])
    assert.equal(harness.api.getParams().signup_trigger, null)
})

test('the signup write includes Signup Trigger from the cookie', async () => {
    const harness = boot(
        Object.assign({}, hirePage, { cookies: clickCookies, pathname: '/hire/jane-doe' }),
    )
    await harness.settle()

    harness.clickTrigger({ element: 'hire' })
    harness.authHandlers[0](loggedInMember)
    await harness.settle()
    await harness.settle()

    assert.equal(harness.savedFields()[0]['signup-trigger'], 'hire')
    assert.equal(harness.savedFields()[0]['signup-source'], '/hire/jane-doe')
})

test('a pending retry writes Signup Trigger from the signup-time snapshot', async () => {
    const harness = boot({
        cookies: { utm_source: 'google', signup_trigger: 'message' },
        member: loggedInMember,
        pathname: '/hire/jane-doe',
        forms: ['signup'],
        session: {
            [PENDING_SAVE_FLAG]: 'true',
            [PENDING_FIELDS_KEY]: JSON.stringify({
                'utm-source': 'facebook',
                'signup-trigger': 'hire',
                'signup-source': '/hire/jane-doe',
            }),
        },
    })
    await harness.settle()
    await harness.settle()

    assert.equal(harness.savedFields()[0]['signup-trigger'], 'hire')
    assert.equal(harness.savedFields()[0]['utm-source'], 'facebook')
    assert.equal(harness.pendingSave(), undefined)
})

test('a member who already has Signup Trigger keeps it', async () => {
    const harness = boot(
        Object.assign({}, hirePage, { cookies: clickCookies }),
    )
    await harness.settle()

    harness.clickTrigger({ element: 'hire' })
    harness.authHandlers[0](
        memberWithFields({ 'signup-trigger': 'message' }),
    )
    await harness.settle()
    await harness.settle()

    assert.equal('signup-trigger' in harness.savedFields()[0], false)
    assert.equal(harness.savedFields()[0]['utm-source'], 'facebook')
})

/* ----------------------------- file contract ------------------------------ */

test('double-loading the script is a no-op', () => {
    const harness = boot({ search: '?utm_source=facebook' })
    const writesAfterFirstLoad = harness.document.writes.length

    harness.rerun()

    assert.equal(harness.document.writes.length, writesAfterFirstLoad)
})

test('the file is raw CDN-safe JavaScript', () => {
    assert.equal(source.includes('<script'), false)
})

test('the header release marker matches the exposed release', () => {
    const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
    assert.ok(marker, 'no "@release vX.Y.Z" line in the signup-attribution.js header')
    assert.equal(marker[1], RELEASE)
    assert.equal(boot().api.release, RELEASE)
})
