const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')

function sliceSource(startText, endText) {
    const start = source.indexOf(startText)
    const end = source.indexOf(endText, start)

    assert.notEqual(start, -1, `missing source start: ${startText}`)
    assert.notEqual(end, -1, `missing source end: ${endText}`)

    return source.slice(start, end)
}

function getAttributionApi(cookie) {
    const attributionSource = sliceSource(
        'const attributionCookieFieldIds = {',
        '/**\n     * Saves a short starter quiz summary',
    )

    return vm.runInNewContext(
        [
            "function normalize(value) { return (value || '').trim() }",
            'function logQuizFlow() {}',
            attributionSource,
            '({ getCookieValue, getAttributionCustomFields, withoutFilledWriteOnceFields })',
        ].join('\n'),
        { document: { cookie } },
    )
}

function getSaveQuizCustomFieldSource() {
    return sliceSource(
        'async function saveQuizCustomField(memberstack, starterQuiz) {',
        '/**\n     * Persists quiz data to the logged-in Memberstack member.',
    )
}

/**
 * Runs the real `saveQuizCustomField` against a fake Memberstack.
 *
 * Everything the guard path touches is the file's own code, lifted verbatim: the
 * attribution block, `getCurrentMemberData`, and `getMemberCustomFields`. Only
 * the quiz-summary formatter and the logger are stubbed, because neither has
 * anything to do with attribution. That is what makes the member-read count below
 * a real measurement rather than a regex over the source.
 *
 * @param {object} [options]
 * @param {string} [options.cookie] `document.cookie` for the save.
 * @param {object} [options.memberFields] The member's existing custom fields.
 * @param {boolean} [options.memberReadThrows] Make `getCurrentMember` reject.
 * @param {boolean} [options.noUpdateMember] Withhold `updateMember` entirely.
 */
function getSaveApi(options = {}) {
    const attributionSource = sliceSource(
        'const attributionCookieFieldIds = {',
        '/**\n     * Saves a short starter quiz summary',
    )
    const currentMemberSource = sliceSource(
        'async function getCurrentMemberData(memberstack) {',
        '    function hasStarterQuizCompletionMarker(member) {',
    )
    const memberReads = []
    const updateCalls = []
    const logs = []

    const memberstack = {
        getCurrentMember: async () => {
            memberReads.push(true)
            if (options.memberReadThrows) throw new Error('no session')
            return { data: { id: 'mem_123', customFields: options.memberFields } }
        },
    }
    if (!options.noUpdateMember) {
        memberstack.updateMember = async (payload) => {
            updateCalls.push(payload)
            return { data: { id: 'mem_123' } }
        }
    }

    const save = vm.runInNewContext(
        [
            "function normalize(value) { return (value || '').trim() }",
            'function logQuizFlow(message, detail) { logs.push([message, detail]) }',
            "function getStarterQuizCustomFieldSummary() { return 'summary' }",
            attributionSource,
            currentMemberSource,
            getSaveQuizCustomFieldSource(),
            'saveQuizCustomField',
        ].join('\n'),
        { document: { cookie: options.cookie || '' }, logs },
    )

    return {
        logs,
        memberReads,
        updateCalls,
        savedFields: () => updateCalls.map((call) => ({ ...call.customFields })),
        save: () => save(memberstack, { answers: [] }),
    }
}

test('every attribution cookie maps to its verified Memberstack field ID', () => {
    const { getAttributionCustomFields } = getAttributionApi(
        [
            'utm_source=facebook',
            'utm_campaign=spring-launch',
            'utm_adset=adset-a',
            'utm_content=creative-3',
            'fbclid=abc123',
            'fbc=fb.1.1700000000.abc123',
            'fbp=fb.1.1700000000.987654321',
            'event_id=evt-42',
            // Both written by the sitewide script on the /quiz signup transition,
            // and read here because /quiz is the one armed page that script
            // deliberately does not save fields for. The referrer is the page they
            // clicked through from, which the source can never name: /quiz is
            // always the source for this funnel.
            'signup_source=/quiz',
            'signup_referrer=/home',
            'signup_trigger=hire',
        ].join('; '),
    )

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': 'facebook',
        'utm-campaign': 'spring-launch',
        'utm-adset': 'adset-a',
        'utm-content': 'creative-3',
        fbclid: 'abc123',
        fbc: 'fb.1.1700000000.abc123',
        fbp: 'fb.1.1700000000.987654321',
        'event-id': 'evt-42',
        'signup-source': '/quiz',
        'signup-referrer': '/home',
        'signup-trigger': 'hire',
    })
})

test('event_id becomes the hyphenated event-id field ID', () => {
    const { getAttributionCustomFields } = getAttributionApi('event_id=evt-99')
    const customFields = { ...getAttributionCustomFields() }

    assert.equal(customFields['event-id'], 'evt-99')
    assert.equal(
        Object.prototype.hasOwnProperty.call(customFields, 'event_id'),
        false,
        'the raw cookie name must never be sent as a field ID',
    )
})

test('absent and empty cookies are omitted instead of blanking fields', () => {
    const { getAttributionCustomFields } = getAttributionApi(
        'utm_source=facebook; utm_campaign=; fbclid=   ; fbp=fb.1.2.3',
    )

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': 'facebook',
        fbp: 'fb.1.2.3',
    })
})

test('unrelated cookies never leak into the custom fields payload', () => {
    const { getAttributionCustomFields } = getAttributionApi(
        '_ga=GA1.1.123; utm_source_extra=nope; session=abc; utm_source=google',
    )

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': 'google',
    })
})

test('URL-encoded cookie values are decoded before saving', () => {
    const { getCookieValue, getAttributionCustomFields } = getAttributionApi(
        'utm_campaign=spring%20launch%20%2B%20promo; utm_content=a%2Fb',
    )

    assert.equal(getCookieValue('utm_campaign'), 'spring launch + promo')
    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-campaign': 'spring launch + promo',
        'utm-content': 'a/b',
    })
})

test('a malformed percent escape falls back to the raw cookie value', () => {
    const { getAttributionCustomFields } = getAttributionApi('utm_source=100%')

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': '100%',
    })
})

test('with no attribution cookies the payload is empty', () => {
    const { getAttributionCustomFields } = getAttributionApi('')

    assert.deepEqual({ ...getAttributionCustomFields() }, {})
    assert.equal(Object.keys(getAttributionCustomFields()).length, 0)
})

/* ------------- signup source and referrer are write-once ------------------ */

// The cookies a returning member's browser carries on /quiz-results after they
// simply LOGGED IN on /quiz: the sitewide script arms /quiz and writes
// signup_source=/quiz plus signup_referrer on any logged-out to logged-in
// transition there, so this controller is one write away from replacing both
// their real signup page and the page they originally came from.
const returningMemberCookies = [
    'utm_source=facebook',
    'event_id=evt-42',
    'signup_source=/quiz',
    'signup_referrer=/all-starters',
].join('; ')

test('a returning member who logged in on /quiz keeps their original signup fields', () => {
    const { getAttributionCustomFields, withoutFilledWriteOnceFields } =
        getAttributionApi(returningMemberCookies)

    const guarded = withoutFilledWriteOnceFields(getAttributionCustomFields(), {
        'signup-source': '/starters/jane-doe',
        'signup-referrer': '/',
        'starter-quiz': 'something',
    })

    assert.deepEqual({ ...guarded }, {
        'utm-source': 'facebook',
        'event-id': 'evt-42',
    })
})

test('the guard is two keys wide and leaves the other eight last-touch', () => {
    // A fresh ad click is supposed to update the click parameters, so a member who
    // already has all of them still gets the new values.
    const { getAttributionCustomFields, withoutFilledWriteOnceFields } =
        getAttributionApi(returningMemberCookies)

    const guarded = withoutFilledWriteOnceFields(getAttributionCustomFields(), {
        'utm-source': 'google',
        'event-id': 'evt-old',
        'signup-source': '/starters/jane-doe',
        'signup-referrer': '/',
    })

    assert.equal(guarded['utm-source'], 'facebook')
    assert.equal(guarded['event-id'], 'evt-42')
    assert.equal('signup-source' in guarded, false)
    assert.equal('signup-referrer' in guarded, false)
})

test('each write-once field is judged on its own', () => {
    // A member who signed up before signup-referrer existed holds a source and no
    // referrer. Their source survives and the referrer is still backfilled.
    const { getAttributionCustomFields, withoutFilledWriteOnceFields } =
        getAttributionApi(returningMemberCookies)

    const guarded = withoutFilledWriteOnceFields(getAttributionCustomFields(), {
        'signup-source': '/starters/jane-doe',
    })

    assert.equal('signup-source' in guarded, false)
    assert.equal(guarded['signup-referrer'], '/all-starters')
})

test('an unfilled or unreadable existing write-once value is written', () => {
    const { getAttributionCustomFields, withoutFilledWriteOnceFields } =
        getAttributionApi(returningMemberCookies)

    // Unfilled in every shape an empty Memberstack field takes, plus the two
    // unreadable shapes. All of them write: a genuine first signup with empty
    // fields is the common case, so a failed read must not cost it its attribution.
    for (const existing of [
        {},
        { 'signup-source': '', 'signup-referrer': '' },
        { 'signup-source': '   ', 'signup-referrer': '\t' },
        { 'signup-source': null, 'signup-referrer': null },
        undefined,
        null,
    ]) {
        const guarded = withoutFilledWriteOnceFields(
            getAttributionCustomFields(),
            existing,
        )
        const label = `existing ${JSON.stringify(existing)} must not block the write`

        assert.equal(guarded['signup-source'], '/quiz', label)
        assert.equal(guarded['signup-referrer'], '/all-starters', label)
    }
})

test('the guard runs before updateMember and only touches attribution', () => {
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(
        saveSource,
        /withoutFilledWriteOnceFields\(\s*attributionCustomFields,\s*existingCustomFields,\s*\)/,
        'the outgoing attribution fields must pass through the guard',
    )
    // Ordering pinned as code: a guard applied after the write would do nothing.
    assert.ok(
        saveSource.indexOf('withoutFilledWriteOnceFields(') <
            saveSource.indexOf('updateMember('),
        'the guard must run before updateMember',
    )
    // Still one write, and still the file's own member-read helper rather than a
    // second way to read a member.
    assert.equal((saveSource.match(/updateMember\(/g) || []).length, 1)
    assert.equal((saveSource.match(/getCurrentMemberData\(/g) || []).length, 1)
    assert.match(saveSource, /getMemberCustomFields\(/)
})

test('the member read is skipped when the write carries no write-once field', async () => {
    // The gate. A quiz signup reached by direct navigation carries no
    // signup_referrer, and nothing the member holds could change this write, so
    // reading them would be a round trip for nothing.
    const harness = getSaveApi({ cookie: 'utm_source=facebook; event_id=evt-42' })
    await harness.save()

    assert.equal(harness.memberReads.length, 0)
    assert.deepEqual(harness.savedFields(), [
        {
            'utm-source': 'facebook',
            'event-id': 'evt-42',
            'starter-quiz': 'summary',
        },
    ])
})

test('a write carrying a write-once field pays exactly one member read', async () => {
    const harness = getSaveApi({
        cookie: 'utm_source=facebook; signup_source=/quiz; signup_referrer=/',
        memberFields: { 'signup-source': '/starters/jane-doe' },
    })
    await harness.save()

    assert.equal(harness.memberReads.length, 1)
    // Their source survives, the referrer they never had is filled in, and the
    // click field still re-attributes.
    assert.deepEqual(harness.savedFields(), [
        {
            'utm-source': 'facebook',
            'signup-referrer': '/',
            'starter-quiz': 'summary',
        },
    ])
    // JSON round-trip because the detail object was built inside the vm realm, so
    // its prototype is not this realm's and deepEqual would reject it on identity
    // alone. Values are what matter here.
    assert.deepEqual(
        JSON.parse(
            JSON.stringify(
                harness.logs.find(([message]) =>
                    /already has write-once attribution/.test(message),
                )[1],
            ),
        ),
        { heldBackFieldIds: ['signup-source'] },
    )
})

test('an empty attribution payload pays no member read either', async () => {
    // Cookies blocked entirely: the payload is {} and the guard cannot matter.
    const harness = getSaveApi()
    await harness.save()

    assert.equal(harness.memberReads.length, 0)
    assert.deepEqual(harness.savedFields(), [{ 'starter-quiz': 'summary' }])
})

test('a failed existing-value read still writes the write-once fields', async () => {
    const harness = getSaveApi({
        cookie: 'signup_source=/quiz; signup_referrer=/',
        memberReadThrows: true,
    })
    await harness.save()

    assert.equal(harness.memberReads.length, 1)
    assert.deepEqual(harness.savedFields(), [
        {
            'signup-source': '/quiz',
            'signup-referrer': '/',
            'starter-quiz': 'summary',
        },
    ])
    assert.ok(
        harness.logs.some(([message]) =>
            /existing write-once attribution unreadable/.test(message),
        ),
        `no unreadable warning in ${JSON.stringify(harness.logs)}`,
    )
})

test('a failed read and a failed guard are reported as different faults', () => {
    // One catch around both would blame the read for a guard fault and point a
    // future debugger at the wrong half.
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(saveSource, /existing write-once attribution unreadable/)
    assert.match(saveSource, /write-once guard failed/)
    assert.equal((saveSource.match(/\} catch \(error\) \{/g) || []).length, 3)
})

test('starter-quiz survives the attribution merge in updateMember', () => {
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(
        saveSource,
        /customFields:\s*\{\s*\.\.\.attributionCustomFields,\s*'starter-quiz': customFieldValue,/,
        'starter-quiz must be written after the attribution spread',
    )
    assert.equal(
        (saveSource.match(/updateMember\(/g) || []).length,
        1,
        'attribution must ride along in the single existing updateMember call',
    )
})

test('a failed attribution read still saves starter-quiz alone', () => {
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(
        saveSource,
        /try \{\s*attributionCustomFields = getAttributionCustomFields\(\)\s*\} catch/,
        'the attribution read must be wrapped so it cannot throw',
    )
    assert.match(
        saveSource.slice(saveSource.indexOf('} catch')),
        /attributionCustomFields = \{\}/,
        'the catch branch must degrade to an empty attribution payload',
    )
})

test('diagnostics log attribution field IDs but not their values', () => {
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(
        saveSource,
        /attributionFieldIds: Object\.keys\(attributionCustomFields\)/,
        'logs should carry field IDs only',
    )
    assert.doesNotMatch(
        saveSource,
        /attributionCustomFields,\n\s*\}\)\n\s*\}/,
        'the raw attribution values must not be logged',
    )
})
