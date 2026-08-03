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

test('the header carries a well-formed release marker', () => {
    // This controller exports no window API, so there is no `release` property
    // to compare the marker against. Unlike quiz-main/quiz-redirect.js this file
    // sits outside the v3 lockstep group, so the assertion stays format-level:
    // pinning the literal here would fail every time a v3-only release moves.
    const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)

    assert.ok(marker, 'no "@release vX.Y.Z" line in the quiz-results.js header')
})
