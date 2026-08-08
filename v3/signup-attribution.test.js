const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./signup-attribution.js'), 'utf8')
const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')
const header = source.slice(0, source.indexOf('*/') + 2)

const RELEASE = 'v1.59.134'
const PENDING_SAVE_FLAG = 'startersAttributionPendingSave'
const PENDING_FIELDS_KEY = 'startersAttributionPendingFields'
const FIRED_FLAG = 'startersCompleteRegistrationFired'

// Cookie name to Memberstack custom-field ID. Verified to exist in the
// Memberstack app config, so these are the literals both this file and
// quiz-results.js are pinned to.
const FIELD_IDS = {
    utm_source: 'utm-source',
    utm_campaign: 'utm-campaign',
    utm_adset: 'utm-adset',
    utm_content: 'utm-content',
    fbclid: 'fbclid',
    fbc: 'fbc',
    fbp: 'fbp',
    event_id: 'event-id',
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
 * @param {Array<string|object>} [forms] The `data-ms-form` markers present on
 *     the page, one entry per element carrying one (e.g.
 *     `['signup', 'profile']`). A string puts the marker on a `<form>`;
 *     `markerOnDiv('login')` puts it on a non-form element. Order is
 *     irrelevant; only the counts per selector are read.
 */
function documentDouble(initial, readOnly, forms) {
    const jar = new Map(Object.entries(initial || {}))
    const writes = []
    const markers = forms || []

    return {
        readyState: 'complete',
        listeners: [],
        jar,
        writes,
        addEventListener(name, handler) {
            this.listeners.push([name, handler])
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
    )
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
    const memberReads = []
    let releaseMember = () => {}

    const memberstack = options.noMemberstack
        ? undefined
        : {
              getCurrentMember: async () => {
                  if (options.memberThrows) throw new Error('no session')
                  memberReads.push(true)
                  // First read only: the signup watch's starting-state probe.
                  // Lets a test prove an unreadable start is not treated as
                  // "arrived logged out".
                  if (options.firstMemberThrows && memberReads.length === 1) {
                      throw new Error('no session')
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
                  return { data: options.member || null }
              },
              onAuthChange(handler) {
                  authHandlers.push(handler)
              },
          }
    if (memberstack && !options.noUpdateMember) {
        memberstack.updateMember = async (payload) => {
            updateCalls.push(payload)
            if (options.updateFails) throw new Error('Memberstack said no')
            return { data: { id: 'mem_123' } }
        }
    }

    const window = {
        $memberstackDom: memberstack,
        location: {
            hostname: options.hostname || 'the-starters-3-0.webflow.io',
            pathname: options.pathname === undefined ? '/quiz' : options.pathname,
            search: options.search || '',
        },
        sessionStorage: {
            getItem: (key) => (session.has(key) ? session.get(key) : null),
            setItem: (key, value) => session.set(key, String(value)),
            removeItem: (key) => session.delete(key),
        },
        crypto: options.noRandomUuid
            ? {}
            : { randomUUID: () => options.uuid || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    }
    if (!options.noFbq) {
        window.fbq = (...args) => fbqCalls.push(args)
    }

    // The Memberstack poll runs on a real ten second deadline. A test that never
    // supplies Memberstack only cares about the capture half, so it parks the
    // poll instead of paying the full wall-clock wait.
    const parkedTimers = []
    const context = {
        URLSearchParams,
        console: { warn: (message) => warnings.push(message) },
        document,
        setTimeout: options.parkTimers
            ? (handler) => parkedTimers.push(handler)
            : setTimeout,
        window,
    }
    vm.runInNewContext(source, context)

    return {
        authHandlers,
        context,
        document,
        fbqCalls,
        session,
        updateCalls,
        warnings,
        window,
        api: window.StartersAttribution,
        rerun: () => vm.runInNewContext(source, context),
        settle: () => new Promise((resolve) => setImmediate(resolve)),
        writesFor: (name) =>
            document.writes.filter((write) => write.startsWith(`${name}=`)),
        pendingSave: () => session.get(PENDING_SAVE_FLAG),
        pendingFields: () => {
            const raw = session.get(PENDING_FIELDS_KEY)
            return raw === undefined ? undefined : JSON.parse(raw)
        },
        releaseMember: () => releaseMember(),
        savedFields: () => plain(updateCalls.map((call) => call.customFields)),
    }
}

const loggedInMember = { id: 'mem_123', email: 'brand@example.com' }

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

test('getParams exposes exactly the eight contract cookies', () => {
    const harness = boot()
    assert.deepEqual(Object.keys(harness.api.getParams()), COOKIE_NAMES)
})

test('the field mapping is underscore to hyphen for all eight cookies', () => {
    for (const [cookie, field] of Object.entries(FIELD_IDS)) {
        assert.equal(cookie.replace(/_/g, '-'), field, cookie)
    }
    // The one that a naive "strip the underscore" rule gets wrong.
    assert.equal(FIELD_IDS.event_id, 'event-id')
})

test('the map in the script is exactly the eight verified pairs', () => {
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

test('the header and README document all eight verified field IDs', () => {
    for (const [cookie, field] of Object.entries(FIELD_IDS)) {
        const row = new RegExp('`' + cookie + '` -> `' + field + '`')
        assert.match(header, row, `${cookie} missing from the script header`)
        assert.match(readme, row, `${cookie} missing from v3/README.md`)
    }
    // Exactly eight mapping rows in the header: an extra one would be a field
    // that does not exist in the Memberstack app config.
    const rows = header.match(/`[a-z_]+` -> `[a-z-]+`/g) || []
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
    // Absent cookies are omitted rather than written blank.
    assert.deepEqual(Object.keys(harness.savedFields()[0]).sort(), [
        'event-id',
        'fbclid',
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
