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

function getMemberJsonFallbackApi(memberstack = null) {
    const redirects = []
    const parserSource = sliceSource(
        'function parsePendingQuiz(value)',
        'function getUrlListValues(',
    )
    const redirectSource = sliceSource(
        'function getMemberCustomFields(member)',
        '/**\n     * Loads a saved quiz payload from Memberstack.',
    )

    const api = vm.runInNewContext(
        [
            "function normalize(value) { return String(value || '').trim() }",
            'function logQuizFlow() {}',
            parserSource,
            redirectSource,
            '({',
            '  parsePendingQuiz,',
            '  parseStarterQuizCustomField,',
            '  getMemberCustomFields,',
            '  hasStarterQuizCompletionMarker,',
            '  getAuthenticatedNoQuizDataRedirectTarget,',
            '  redirectVisitorWithoutResults,',
            '})',
        ].join('\n'),
        {
            Boolean,
            window: {
                location: {
                    replace(target) {
                        redirects.push(target)
                    },
                },
            },
            waitForMemberstack: async () => memberstack,
        },
    )

    return { api, redirects }
}

test('legacy custom-field JSON remains a recoverable answer fallback', () => {
    const { parseStarterQuizCustomField } = getMemberJsonFallbackApi().api
    const parsed = parseStarterQuizCustomField(
        JSON.stringify({
            status: 'ready',
            categoryIds: ['paid-media'],
        }),
    )

    assert.deepEqual(Array.from(parsed.categoryIds), ['paid-media'])
    assert.equal(parsed.status, 'ready')
})

test('summary completion markers are not mistaken for full answer JSON', () => {
    const { parseStarterQuizCustomField } = getMemberJsonFallbackApi().api

    assert.equal(parseStarterQuizCustomField('ready'), null)
    assert.equal(parseStarterQuizCustomField('   '), null)
    assert.equal(parseStarterQuizCustomField('{malformed'), null)
})

test('completed member missing usable JSON is sent to an explicit retake', () => {
    const { getAuthenticatedNoQuizDataRedirectTarget } =
        getMemberJsonFallbackApi().api

    assert.equal(
        getAuthenticatedNoQuizDataRedirectTarget({
            id: 'mem_test',
            customFields: { 'starter-quiz': 'ready' },
        }),
        '/quiz?retake=true&quizDataMissing=1',
    )
})

test('authenticated member without completion marker starts the quiz normally', () => {
    const { getAuthenticatedNoQuizDataRedirectTarget } =
        getMemberJsonFallbackApi().api

    assert.equal(
        getAuthenticatedNoQuizDataRedirectTarget({
            id: 'mem_test',
            custom_fields: { 'starter-quiz': '   ' },
        }),
        '/quiz',
    )
})

test('unresolved or logged-out member state does not trigger authenticated redirect', () => {
    const { getAuthenticatedNoQuizDataRedirectTarget } =
        getMemberJsonFallbackApi().api

    assert.equal(getAuthenticatedNoQuizDataRedirectTarget(null), null)
    assert.equal(getAuthenticatedNoQuizDataRedirectTarget({}), null)
})

test('no-data runtime redirects a completed authenticated member to retake', async () => {
    const { api, redirects } = getMemberJsonFallbackApi({
        async getCurrentMember() {
            return {
                data: {
                    id: 'mem_test',
                    customFields: { 'starter-quiz': 'ready' },
                },
            }
        },
    })

    await api.redirectVisitorWithoutResults()

    assert.deepEqual(redirects, [
        '/quiz?retake=true&quizDataMissing=1',
    ])
})

test('no-data runtime keeps Memberstack-unresolved visitors in place', async () => {
    const { api, redirects } = getMemberJsonFallbackApi()

    await api.redirectVisitorWithoutResults()

    assert.deepEqual(redirects, [])
})
