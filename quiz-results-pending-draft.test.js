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

const readyPredicateSource = sliceSource(
    'function isPendingQuizReady(pendingQuiz)',
    '/**\n     * Checks whether starter quiz debug logging is enabled.',
)

/**
 * Builds the sessionStorage-reading half of the controller in a sandbox, on top
 * of a fake session store that records every removeItem call.
 */
function getPendingQuizApi(storedValue, savedMemberQuiz) {
    const store = new Map()
    const removals = []
    const writes = []
    const logs = []

    if (storedValue !== undefined) {
        store.set('starterQuizPending', storedValue)
    }

    const sessionStorage = {
        getItem(key) {
            return store.has(key) ? store.get(key) : null
        },
        setItem(key, value) {
            writes.push([key, value])
            store.set(key, value)
        },
        removeItem(key) {
            removals.push(key)
            store.delete(key)
        },
    }

    const api = vm.runInNewContext(
        [
            "const pendingQuizStorageKey = 'starterQuizPending'",
            "function normalize(value) { return String(value || '').trim() }",
            'function logQuizFlow(message, data) { logs.push([message, data]) }',
            readyPredicateSource,
            sliceSource(
                '    /**\n     * Reads the pending quiz payload saved before Memberstack signup.',
                'function getUrlListValues(',
            ),
            sliceSource(
                'async function getPendingQuizFromMemberstack()',
                'function compactSelectionItems(',
            ),
            '({',
            '  getPendingQuiz,',
            '  getPendingQuizFromMemberstack,',
            '  parsePendingQuiz,',
            '  isPendingQuizReady,',
            '})',
        ].join('\n'),
        {
            String,
            Date,
            JSON,
            logs,
            sessionStorage,
            waitForMemberstack: async () =>
                savedMemberQuiz === undefined ? null : {},
            getExistingMemberJson: async () => ({
                starterQuiz: savedMemberQuiz,
            }),
            getCurrentMemberData: async () => ({ id: 'mem_test' }),
            getMemberCustomFields: () => ({}),
        },
    )

    return { api, store, removals, writes, logs }
}

/**
 * Builds the logged-out stale-cache reset on top of the same fake session store,
 * plus the sessionStorage reader, so a removal can be checked by what the boot
 * flow sees next rather than by the call alone.
 *
 * @param {object} options Harness options.
 * @param {string} [options.storedValue] Raw sessionStorage payload.
 * @param {object|null} [options.member] Value of getCurrentMember()'s `data`.
 * @param {boolean} [options.omitMemberData] Answer without a `data` property.
 * @param {boolean} [options.memberstackMissing] Never resolve Memberstack.
 * @param {boolean} [options.memberstackThrows] Reject getCurrentMember().
 */
function getLogoutResetApi(options = {}) {
    const store = new Map()
    const removals = []
    const writes = []
    const logs = []
    const memberstackWaits = []

    if (options.storedValue !== undefined) {
        store.set('starterQuizPending', options.storedValue)
    }

    const sessionStorage = {
        getItem(key) {
            return store.has(key) ? store.get(key) : null
        },
        setItem(key, value) {
            writes.push([key, value])
            store.set(key, value)
        },
        removeItem(key) {
            removals.push(key)
            store.delete(key)
        },
    }

    const api = vm.runInNewContext(
        [
            "const pendingQuizStorageKey = 'starterQuizPending'",
            "function normalize(value) { return String(value || '').trim() }",
            'function logQuizFlow(message, data) { logs.push([message, data]) }',
            readyPredicateSource,
            sliceSource(
                '    /**\n     * Reads the pending quiz payload saved before Memberstack signup.',
                'function getUrlListValues(',
            ),
            sliceSource(
                'async function resolveMemberstackAuthState()',
                '/**\n     * When the results page has no usable quiz data',
            ),
            '({',
            '  clearMemberCachedPendingQuizWhenLoggedOut,',
            '  isMemberCachedPendingQuiz,',
            '  resolveMemberstackAuthState,',
            '  getPendingQuiz,',
            '})',
        ].join('\n'),
        {
            logs,
            sessionStorage,
            waitForMemberstack: async () => {
                memberstackWaits.push(true)

                if (options.memberstackMissing) return null

                return {
                    async getCurrentMember() {
                        if (options.memberstackThrows) {
                            throw new Error('Memberstack unreachable')
                        }

                        return options.omitMemberData
                            ? {}
                            : { data: options.member ?? null }
                    },
                }
            },
        },
    )

    return { api, store, removals, writes, logs, memberstackWaits }
}

/**
 * Real payload captured from a logged-out visitor who only browsed /quiz
 * (staging, 2026-08-03). quiz-main.js saves this shape on /quiz load.
 */
const draftPayload = JSON.stringify({
    categories: [],
    subcategories: [],
    resultSlug: null,
    status: 'draft',
    updatedAt: '2026-08-03T12:37:08.766Z',
    completedAt: null,
})

const readyPayload = JSON.stringify({
    categories: [{ id: 'paid-media', label: 'Paid Media' }],
    subcategories: [],
    resultSlug: null,
    status: 'ready',
    updatedAt: '2026-08-03T12:40:00.000Z',
    completedAt: '2026-08-03T12:40:00.000Z',
})

/**
 * Shape of the payload captured previewing results to a LOGGED-OUT visitor on
 * /quiz-results (staging, 2026-08-03): a member cache written four days earlier,
 * still `ready`, still carrying full recommendations. Only the marker and the
 * dates matter here, so the ~439KB of recommendation data is elided.
 */
const memberCachePayload = JSON.stringify({
    categories: [{ id: 'paid-media', label: 'Paid Media' }],
    subcategories: [],
    resultSlug: 'paid-media',
    status: 'ready',
    updatedAt: '2026-07-30T04:12:44.101Z',
    completedAt: '2026-07-30T04:12:44.101Z',
    memberstackSavedAt: '2026-07-30T04:12:51.880Z',
    recommendedFreelancerIds: ['starter_1', 'starter_2'],
})

const draftMemberCachePayload = JSON.stringify({
    categories: [],
    subcategories: [],
    resultSlug: null,
    status: 'draft',
    updatedAt: '2026-07-30T04:10:00.000Z',
    completedAt: null,
    memberstackSavedAt: '2026-07-30T04:10:02.000Z',
})

test('a draft payload counts as no pending quiz', () => {
    const { api } = getPendingQuizApi(draftPayload)

    // Null is what unlocks redirectVisitorWithoutResults() in initResultsPage:
    // a logged-out visitor who merely browsed /quiz now gets sent to /quiz
    // instead of sitting on an empty results page.
    assert.equal(api.getPendingQuiz(), null)
})

test('a null session payload still reaches the no-results redirect', () => {
    // The other half of the fix: getPendingQuiz() returning null has to land in
    // the branch that bounces the visitor. Assert the boot order stays intact —
    // session payload, then Memberstack, then redirect.
    const bootSource = sliceSource(
        'async function initResultsPage()',
        'const taxonomyCompatibility',
    )

    assert.match(
        bootSource,
        /getPendingQuiz\(\) \|\|\s*\(await getPendingQuizFromMemberstack\(\)\)/,
    )
    assert.match(
        bootSource,
        /if \(!rawPendingQuiz\) \{[\s\S]*await redirectVisitorWithoutResults\(\)/,
    )
})

test('ignoring a draft never clears the stored payload', () => {
    const { api, store, removals } = getPendingQuizApi(draftPayload)

    api.getPendingQuiz()

    assert.deepEqual(removals, [])
    assert.equal(store.get('starterQuizPending'), draftPayload)
})

test('the ignored draft is reported through the flow diagnostics', () => {
    const { api, logs } = getPendingQuizApi(draftPayload)

    api.getPendingQuiz()

    const ignored = logs.find(([message]) =>
        message.includes('ignoring unfinished pending quiz'),
    )

    assert.ok(ignored, `no ignore log line; got ${JSON.stringify(logs)}`)
    assert.equal(ignored[1].status, 'draft')
})

test('a completed payload is still returned', () => {
    const { api, removals } = getPendingQuizApi(readyPayload)
    const pendingQuiz = api.getPendingQuiz()

    assert.equal(pendingQuiz.status, 'ready')
    assert.deepEqual(
        Array.from(pendingQuiz.categories, (category) => category.id),
        ['paid-media'],
    )
    assert.deepEqual(removals, [])
})

// Deliberate: a payload with no `status` keeps the pre-fix "usable" answer.
// Every known writer sets the field — quiz-main.js savePendingQuiz() has always
// written 'draft' or 'ready', and createMemberstackStarterQuizPayload() defaults
// it to 'ready' — so a status-less payload is an old Memberstack/custom-field
// record rather than an in-progress draft, and rejecting it would bounce members
// who really do have saved answers.
test('a status-less legacy payload keeps its pre-fix usable behavior', () => {
    const { api } = getPendingQuizApi(
        JSON.stringify({ categoryIds: ['paid-media'] }),
    )
    const pendingQuiz = api.getPendingQuiz()

    assert.ok(pendingQuiz, 'a status-less payload should still be usable')
    assert.deepEqual(Array.from(pendingQuiz.categoryIds), ['paid-media'])
    assert.equal(api.isPendingQuizReady({}), true)
    assert.equal(api.isPendingQuizReady({ status: '   ' }), true)
})

test('malformed and absent payloads behave exactly as before', () => {
    const malformed = getPendingQuizApi('{not json')

    assert.equal(malformed.api.getPendingQuiz(), null)
    assert.deepEqual(malformed.removals, [])
    assert.ok(
        malformed.logs.some(([message]) =>
            message.includes('could not parse'),
        ),
        'a malformed payload should still log a parse failure',
    )

    const empty = getPendingQuizApi()

    assert.equal(empty.api.getPendingQuiz(), null)
    assert.deepEqual(empty.removals, [])
})

// The one behavior change this fix newly makes reachable, ratified as
// acceptable: a LOGGED-IN member holding only a draft used to stop at the draft
// (and render nothing); now the draft is ignored, so the boot flow continues to
// getPendingQuizFromMemberstack(), whose pre-existing setItem caches the saved
// answers under the same key. The draft is therefore SUPERSEDED by a fresher
// payload, not deleted, and the replacement still carries `updatedAt` — which is
// the field quiz-loader.js turns into its skip-on-refresh run id.
test('a logged-in member with only a draft gets their saved answers cached over it', async () => {
    const savedMemberQuiz = {
        status: 'ready',
        updatedAt: '2026-08-02T09:00:00.000Z',
        completedAt: '2026-08-02T09:00:00.000Z',
        categoryIds: ['paid-media'],
    }
    const { api, store, removals, writes } = getPendingQuizApi(
        draftPayload,
        savedMemberQuiz,
    )

    assert.equal(api.getPendingQuiz(), null, 'the draft must be ignored first')

    const memberPendingQuiz = await api.getPendingQuizFromMemberstack()

    assert.ok(memberPendingQuiz, 'the saved member payload should be returned')
    assert.deepEqual(Array.from(memberPendingQuiz.categoryIds), ['paid-media'])

    // Replaced, not merely removed: exactly one write, to the same key, and the
    // key still holds a payload afterwards.
    assert.deepEqual(removals, [], 'the key must never be removed')
    assert.equal(writes.length, 1)
    assert.equal(writes[0][0], 'starterQuizPending')

    const stored = JSON.parse(store.get('starterQuizPending'))

    assert.notEqual(
        store.get('starterQuizPending'),
        draftPayload,
        'the stored draft should have been superseded',
    )
    assert.equal(stored.status, 'ready')
    assert.equal(stored.updatedAt, savedMemberQuiz.updatedAt)
    assert.ok(
        stored.updatedAt,
        'the replacement must keep updatedAt for the quiz-loader run id',
    )
    assert.ok(stored.memberstackSavedAt, 'the save marker should be stamped')

    // The comment at the setItem site records why this overwrite is acceptable.
    const loaderSource = sliceSource(
        'async function getPendingQuizFromMemberstack()',
        'function compactSelectionItems(',
    )

    assert.match(loaderSource, /quiz-loader\.js keeps deriving/)
})

test('the ready predicate tolerates casing and stray whitespace', () => {
    const { api } = getPendingQuizApi()

    assert.equal(api.isPendingQuizReady({ status: ' Ready ' }), true)
    assert.equal(api.isPendingQuizReady({ status: 'DRAFT' }), false)
    assert.equal(api.isPendingQuizReady(null), false)
    assert.equal(api.isPendingQuizReady('ready'), false)
})

test('the late results-save guard shares the one ready predicate', () => {
    // Before this fix the file carried its own inline `status !== 'ready'`
    // check, which is exactly the notion getPendingQuiz() was missing. Keep both
    // sites on the shared helper so they cannot drift apart again.
    assert.doesNotMatch(
        source,
        /pendingQuiz\.status\s*&&\s*pendingQuiz\.status\s*!==\s*'ready'/,
    )
    assert.match(
        source,
        /if \(!isPendingQuizReady\(pendingQuiz\)\) \{\n\s+logQuizFlow\('pending quiz is not ready/,
    )
})

test('the early LearnContent read ignores drafts through the same predicate', () => {
    const learnSource = sliceSource(
        'function getStoredLearnContentPendingQuiz()',
        'function getLearnContentCategoryFilterValues(',
    )

    assert.match(learnSource, /!isPendingQuizReady\(storedPendingQuiz\)/)
    assert.doesNotMatch(
        learnSource,
        /removeItem/,
        'the LearnContent read must not clear the stored payload',
    )
})

// The second half of the same key's contract: this controller also writes
// starterQuizPending as a cache of a logged-in member's answers, and nothing
// cleared it on logout, so a stale `ready` payload kept previewing a member's
// results to the next (logged-out) visitor.
test('a logged-out visitor stops inheriting a member cache', async () => {
    const { api, store, removals } = getLogoutResetApi({
        storedValue: memberCachePayload,
        member: null,
    })

    assert.equal(await api.clearMemberCachedPendingQuizWhenLoggedOut(), true)

    // Assert the removal by value, not just by the call: the boot flow has to
    // see an absent key so it falls through to the /quiz redirect.
    assert.deepEqual(removals, ['starterQuizPending'])
    assert.equal(store.has('starterQuizPending'), false)
    assert.equal(api.getPendingQuiz(), null)
})

// The sacred case. A visitor who finished the quiz before signing up owns this
// payload; quiz-main.js writes it without a memberstackSavedAt marker, and it
// must keep previewing results exactly as it does today.
test('a genuine pre-signup payload is kept and costs no Memberstack round-trip', async () => {
    const { api, store, removals, memberstackWaits } = getLogoutResetApi({
        storedValue: readyPayload,
        member: null,
    })

    assert.equal(await api.clearMemberCachedPendingQuizWhenLoggedOut(), false)
    assert.deepEqual(removals, [])
    assert.equal(store.get('starterQuizPending'), readyPayload)
    assert.deepEqual(
        memberstackWaits,
        [],
        'an unmarked payload must short-circuit before waiting on Memberstack',
    )

    const pendingQuiz = api.getPendingQuiz()

    assert.ok(pendingQuiz, 'the pre-signup preview must still find its payload')
    assert.equal(pendingQuiz.status, 'ready')
})

test('a logged-in member keeps their own cached answers', async () => {
    const { api, store, removals } = getLogoutResetApi({
        storedValue: memberCachePayload,
        member: { id: 'mem_test' },
    })

    assert.equal(await api.clearMemberCachedPendingQuizWhenLoggedOut(), false)
    assert.deepEqual(removals, [])
    assert.equal(store.get('starterQuizPending'), memberCachePayload)
    assert.ok(api.getPendingQuiz(), 'the member still renders their results')
})

// Same positive-resolution discipline as redirectVisitorWithoutResults(): only a
// Memberstack answer that positively says "no member" may delete anything.
test('an unresolved Memberstack removes nothing', async () => {
    const missing = getLogoutResetApi({
        storedValue: memberCachePayload,
        memberstackMissing: true,
    })

    assert.equal(
        await missing.api.clearMemberCachedPendingQuizWhenLoggedOut(),
        false,
    )
    assert.deepEqual(missing.removals, [])
    assert.equal(missing.store.get('starterQuizPending'), memberCachePayload)
    assert.ok(
        missing.logs.some(([message]) =>
            message.includes('auth state unresolved'),
        ),
        `no unresolved log line; got ${JSON.stringify(missing.logs)}`,
    )

    // A response with no `data` property is "could not tell", never "logged out".
    const dataless = getLogoutResetApi({
        storedValue: memberCachePayload,
        omitMemberData: true,
    })

    assert.equal(
        await dataless.api.clearMemberCachedPendingQuizWhenLoggedOut(),
        false,
    )
    assert.deepEqual(dataless.removals, [])

    const throwing = getLogoutResetApi({
        storedValue: memberCachePayload,
        memberstackThrows: true,
    })

    assert.equal(
        await throwing.api.clearMemberCachedPendingQuizWhenLoggedOut(),
        false,
    )
    assert.deepEqual(throwing.removals, [])
    assert.equal(
        throwing.store.get('starterQuizPending'),
        memberCachePayload,
        'a thrown auth check must leave the payload alone',
    )
})

// The two rules compose: drafts are ignored in every auth state, and a member
// cache is cleared when the visitor is logged out — including a draft one.
test('a logged-out draft member cache is cleared as well', async () => {
    const { api, store, removals } = getLogoutResetApi({
        storedValue: draftMemberCachePayload,
        member: {},
    })

    assert.equal(await api.clearMemberCachedPendingQuizWhenLoggedOut(), true)
    assert.deepEqual(removals, ['starterQuizPending'])
    assert.equal(store.has('starterQuizPending'), false)
})

test('the cleared cache is reported through the flow diagnostics', async () => {
    const { api, logs } = getLogoutResetApi({
        storedValue: memberCachePayload,
        member: null,
    })

    await api.clearMemberCachedPendingQuizWhenLoggedOut()

    const cleared = logs.find(([message]) =>
        message.includes('member-cached pending quiz; cleared'),
    )

    assert.ok(cleared, `no clear log line; got ${JSON.stringify(logs)}`)
    assert.equal(cleared[1].memberstackSavedAt, '2026-07-30T04:12:51.880Z')
    assert.equal(cleared[1].status, 'ready')
})

test('the member-cache marker is the whole discriminator', async () => {
    const { api } = getLogoutResetApi()

    assert.equal(
        api.isMemberCachedPendingQuiz({ memberstackSavedAt: '2026-07-30' }),
        true,
    )
    assert.equal(api.isMemberCachedPendingQuiz({ status: 'ready' }), false)
    assert.equal(
        api.isMemberCachedPendingQuiz({ memberstackSavedAt: '  ' }),
        false,
    )
    assert.equal(api.isMemberCachedPendingQuiz(null), false)
    assert.equal(api.isMemberCachedPendingQuiz([]), false)

    // An absent key never reaches the marker check at all.
    const empty = getLogoutResetApi({ member: null })

    assert.equal(
        await empty.api.clearMemberCachedPendingQuizWhenLoggedOut(),
        false,
    )
    assert.deepEqual(empty.removals, [])
    assert.deepEqual(empty.memberstackWaits, [])
})

// The discriminator only holds while quiz-main.js stays out of the marker
// business. Pin that: if savePendingQuiz() ever stamps memberstackSavedAt, the
// pre-signup funnel starts looking like a member cache and this fix would bounce
// genuine visitors.
test('the pre-signup writer never stamps the member-cache marker', () => {
    const quizMainSource = fs.readFileSync(
        require.resolve('./quiz-main/quiz-main.js'),
        'utf8',
    )

    assert.doesNotMatch(quizMainSource, /memberstackSavedAt/)
})

test('the boot flow clears the stale cache before it reads the key', () => {
    const bootSource = sliceSource(
        'async function initResultsPage()',
        'const taxonomyCompatibility',
    )
    const clearIndex = bootSource.indexOf(
        'await clearMemberCachedPendingQuizWhenLoggedOut()',
    )
    const readIndex = bootSource.indexOf('getPendingQuiz() ||')

    assert.notEqual(clearIndex, -1, 'the boot flow must run the stale-cache reset')
    assert.ok(
        clearIndex < readIndex,
        'the reset has to land before the sessionStorage read',
    )
    // Test mode supplies its own payload from the URL, so it must not be touched.
    assert.match(
        bootSource,
        /if \(!testPendingQuiz\) \{\n\s+await clearMemberCachedPendingQuizWhenLoggedOut\(\)/,
    )
})

test('the reset and the no-data redirect share one auth resolver', () => {
    const redirectSource = sliceSource(
        'async function redirectVisitorWithoutResults()',
        '/**\n     * Loads a saved quiz payload from Memberstack.',
    )

    assert.match(redirectSource, /await resolveMemberstackAuthState\(\)/)
    assert.doesNotMatch(
        redirectSource,
        /hasOwnProperty/,
        'the redirect must not re-implement the auth resolution it shares',
    )

    const resetSource = sliceSource(
        '/**\n     * Clears a member-cached pending quiz once Memberstack',
        '/**\n     * When the results page has no usable quiz data',
    )

    assert.match(resetSource, /await resolveMemberstackAuthState\(\)/)
    // The one removal in this file has to record why deleting the key cannot
    // strand quiz-loader.js, which derives its run id from the same payload.
    assert.match(resetSource, /quiz-loader\.js derives its\n\s+\* skip-on-refresh/)
})

test('the header carries a well-formed release marker', () => {
    // This controller exports no window API, so there is no `release` property
    // to compare the marker against. Unlike quiz-main/quiz-redirect.js this file
    // sits outside the v3 lockstep group, so the assertion stays format-level:
    // pinning the literal here would fail every time a v3-only release moves.
    const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)

    assert.ok(marker, 'no "@release vX.Y.Z" line in the quiz-results.js header')
})
