const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')
const routeGuardSource = fs.readFileSync(
    require.resolve('./v3/route-guard.js'),
    'utf8',
)

function sliceSource(startText, endText) {
    const start = source.indexOf(startText)
    const end = source.indexOf(endText, start)

    assert.notEqual(start, -1, `missing source start: ${startText}`)
    assert.notEqual(end, -1, `missing source end: ${endText}`)

    return source.slice(start, end)
}

/**
 * The real window.StartersV3RouteGuard contract, booted on a host it does not
 * enforce on so it only publishes its API.
 */
function loadRouteGuardContract() {
    const window = {
        location: { hostname: 'localhost', pathname: '/quiz-results' },
    }
    vm.runInNewContext(routeGuardSource, { window, URL, URLSearchParams })
    return window.StartersV3RouteGuard
}

function getMemberJsonFallbackApi(memberstack = null, search = '', routeGuard) {
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
            '  getQuizRedirectTargetWithAttribution,',
            '  getAuthenticatedNoQuizDataRedirectTarget,',
            '  redirectVisitorWithoutResults,',
            '})',
        ].join('\n'),
        {
            Boolean,
            URLSearchParams,
            window: {
                location: {
                    search,
                    replace(target) {
                        redirects.push(target)
                    },
                },
                StartersV3RouteGuard: routeGuard,
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

test('authenticated member without completion marker goes to the homepage', () => {
    const { getAuthenticatedNoQuizDataRedirectTarget } =
        getMemberJsonFallbackApi().api

    assert.equal(
        getAuthenticatedNoQuizDataRedirectTarget({
            id: 'mem_test',
            custom_fields: { 'starter-quiz': '   ' },
        }),
        '/',
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

test('logged-out email visitor keeps only safe campaign attribution on quiz redirect', async () => {
    const { api, redirects } = getMemberJsonFallbackApi(
        {
            async getCurrentMember() {
                return { data: null }
            },
        },
        '?utm_source=mailchimp&utm_medium=email&utm_campaign=v3_quiz_results_drip&utm_content=e1_results&memberstack_id=private&quizEmailTest=1',
    )

    await api.redirectVisitorWithoutResults()

    assert.deepEqual(redirects, [
        '/quiz?utm_source=mailchimp&utm_medium=email&utm_campaign=v3_quiz_results_drip&utm_content=e1_results',
    ])
})

test('authenticated retake keeps required controls and safe campaign attribution', () => {
    const { getQuizRedirectTargetWithAttribution } =
        getMemberJsonFallbackApi().api

    assert.equal(
        getQuizRedirectTargetWithAttribution(
            '/quiz?retake=true&quizDataMissing=1',
            '?utm_source=mailchimp&utm_medium=email&utm_campaign=v3_quiz_results_drip&utm_content=e1_results&recipient_id=private',
        ),
        '/quiz?retake=true&quizDataMissing=1&utm_source=mailchimp&utm_medium=email&utm_campaign=v3_quiz_results_drip&utm_content=e1_results',
    )
})

const FREE_BRAND = {
    id: 'mem_free',
    planConnections: [{ active: true, planId: 'pln_free-plan-f6kn0dxz' }],
}
const LEGACY_FREE_BRAND = {
    ...FREE_BRAND,
    id: 'mem_legacy',
    customFields: { quiz: 'true', 'starter-quiz': '' },
}

test('no-quiz free Brand without results goes to the route guard home', () => {
    const contract = loadRouteGuardContract()
    const { getAuthenticatedNoQuizDataRedirectTarget } =
        getMemberJsonFallbackApi(null, '', contract).api

    for (const member of [FREE_BRAND, LEGACY_FREE_BRAND]) {
        assert.equal(contract.roleHome(member), '/', member.id)
        assert.equal(getAuthenticatedNoQuizDataRedirectTarget(member), '/', member.id)
    }
    // A completion marker still means an explicit retake.
    assert.equal(
        getAuthenticatedNoQuizDataRedirectTarget({
            ...LEGACY_FREE_BRAND,
            customFields: { quiz: 'true', 'starter-quiz': 'ready' },
        }),
        '/quiz?retake=true&quizDataMissing=1',
    )
})

test('the no-data fallback is the homepage with or without the route guard', () => {
    for (const routeGuard of [undefined, { memberRole: () => 'brand-free' }]) {
        const { getAuthenticatedNoQuizDataRedirectTarget } =
            getMemberJsonFallbackApi(null, '', routeGuard).api
        assert.equal(getAuthenticatedNoQuizDataRedirectTarget(FREE_BRAND), '/')
        assert.equal(getAuthenticatedNoQuizDataRedirectTarget(LEGACY_FREE_BRAND), '/')
    }
})

test('no-data runtime sends a no-quiz free Brand home with safe attribution', async () => {
    for (const member of [FREE_BRAND, LEGACY_FREE_BRAND]) {
        const { api, redirects } = getMemberJsonFallbackApi(
            {
                async getCurrentMember() {
                    return { data: member }
                },
            },
            '?utm_source=mailchimp&memberstack_id=private',
            loadRouteGuardContract(),
        )

        await api.redirectVisitorWithoutResults()

        assert.deepEqual(redirects, ['/?utm_source=mailchimp'], member.id)
    }
})
