const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-attribution.js'), 'utf8')
const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')
const header = source.slice(0, source.indexOf('*/') + 2)

const RELEASE = 'v1.59.119'
const PENDING_SAVE_FLAG = 'startersAttributionPendingSave'
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
 * Lifts one top-level object or array literal out of the script and evaluates it,
 * so a contract can be pinned against the real constant instead of a copy of it.
 * Balances brackets rather than regex-matching a closing line, which keeps it
 * indifferent to how the literal is formatted.
 *
 * @param {string} name Declared constant name.
 */
function extractLiteral(name) {
    const marker = `var ${name} = `
    const start = source.indexOf(marker)
    assert.notEqual(start, -1, `no ${name} declaration in quiz-attribution.js`)

    const from = start + marker.length
    const open = source[from]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let index = from

    for (; index < source.length; index += 1) {
        if (source[index] === open) depth += 1
        else if (source[index] === close) {
            depth -= 1
            if (depth === 0) {
                index += 1
                break
            }
        }
    }

    return plain(vm.runInNewContext(`(${source.slice(from, index)})`))
}

/**
 * `document` double whose `cookie` accessor behaves like the browser's: reading
 * returns the whole jar, assigning merges one cookie in. Every assignment is
 * recorded so a test can prove a cookie was NOT rewritten, which is the whole
 * point of "absence never clears".
 *
 * @param {object} [initial] Pre-existing cookies, name to raw value.
 * @param {boolean} [readOnly] Swallow writes, like a browser with cookies off.
 */
function documentDouble(initial, readOnly) {
    const jar = new Map(Object.entries(initial || {}))
    const writes = []

    return {
        readyState: 'complete',
        listeners: [],
        jar,
        writes,
        addEventListener(name, handler) {
            this.listeners.push([name, handler])
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
    const document = documentDouble(options.cookies, options.readOnlyCookies)
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
                  // The registration watch reads first, the pending-save retry
                  // second. Holding only the second read lets a test interleave a
                  // signup transition with a still-pending retry.
                  if (options.holdSecondMemberRead && memberReads.length === 2) {
                      return new Promise((resolve) => {
                          releaseMember = () => resolve({ data: options.heldMember || null })
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
        releaseMember: () => releaseMember(),
        savedFields: () => plain(updateCalls.map((call) => call.customFields)),
    }
}

const loggedInMember = { id: 'mem_123', email: 'brand@example.com' }

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

test('SIGNUP_PATHS covers exactly /quiz and /sign-up', () => {
    assert.deepEqual(extractLiteral('SIGNUP_PATHS'), ['/quiz', '/sign-up'])
    // Only the direct signup writes fields from this script; /quiz has
    // quiz-results.js for that.
    assert.deepEqual(extractLiteral('DIRECT_SAVE_PATHS'), ['/sign-up'])
})

test('the header and README document all eight verified field IDs', () => {
    for (const [cookie, field] of Object.entries(FIELD_IDS)) {
        const row = new RegExp('`' + cookie + '` -> `' + field + '`')
        assert.match(header, row, `${cookie} missing from the script header`)
        assert.match(readme, row, `${cookie} missing from quiz-main/README.md`)
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

const clickCookies = {
    utm_source: 'facebook',
    utm_campaign: 'summer',
    fbclid: 'IwAR123',
    event_id: 'evt_fixed',
}

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
    // Confirmed write, so the marker is gone and no page retries it.
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
    assert.ok(marker, 'no "@release vX.Y.Z" line in the quiz-attribution.js header')
    assert.equal(marker[1], RELEASE)
    assert.equal(boot().api.release, RELEASE)
})
