const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-redirect.js'), 'utf8')

function member(planId, starterQuiz) {
    const value = {
        id: 'member',
        planConnections: [{ active: true, planId, status: 'ACTIVE' }],
    }
    if (starterQuiz !== undefined) {
        value.customFields = { 'starter-quiz': starterQuiz }
    }
    return value
}

async function run(options = {}) {
    const location = {
        pathname: '/quiz',
        search: options.search || '',
        replace(path) {
            location.replaced = path
        },
    }
    const memberstack = {
        getCurrentMember: async () => ({ data: options.member || null }),
        onAuthChange() {},
    }
    const window = {
        $memberstackDom: memberstack,
        location,
    }
    const document = {
        readyState: 'complete',
    }

    vm.runInNewContext(source, {
        URLSearchParams,
        document,
        setTimeout,
        window,
    })
    await new Promise((resolve) => setImmediate(resolve))
    return location.replaced
}

test('keeps incomplete free-plan members on the quiz', async () => {
    assert.equal(
        await run({ member: member('pln_free-plan-f6kn0dxz') }),
        undefined,
    )
    assert.equal(
        await run({ member: member('pln_free-plan-f6kn0dxz', '   ') }),
        undefined,
    )
})

test('redirects completed free-plan members to results', async () => {
    assert.equal(
        await run({
            member: member(
                'pln_free-plan-f6kn0dxz',
                '{"status":"ready"}',
            ),
        }),
        '/quiz-results',
    )
})

test('keeps paid-plan redirect and retake escape hatch', async () => {
    const paid = member('pln_new-paid-plan-463h04ph')
    assert.equal(await run({ member: paid }), '/brand-dashboard')
    assert.equal(
        await run({ member: paid, search: '?retake=true' }),
        undefined,
    )
})

test('treats Test Brand plan as paid (route-guard parity)', async () => {
    const testBrand = member('pln_dorxata-test-brand-plan-777r02pa')
    assert.equal(await run({ member: testBrand }), '/brand-dashboard')
    assert.equal(
        await run({ member: testBrand, search: '?retake=true' }),
        undefined,
    )
})

test('leaves a logged-out visitor and an unknown plan on the quiz', async () => {
    assert.equal(await run({ member: null }), undefined)
    assert.equal(await run({ member: member('pln_unknown') }), undefined)
    // Inactive plans do not count, whichever plan they are.
    const inactiveTalent = {
        id: 'member',
        planConnections: [
            {
                active: false,
                planId: 'pln_dorxata-test-free-plan-dvcg0k8o',
                status: 'CANCELED',
            },
        ],
    }
    assert.equal(await run({ member: inactiveTalent }), undefined)
})

test('redirects an active Talent member off the quiz', async () => {
    const talent = member('pln_dorxata-test-free-plan-dvcg0k8o')
    assert.equal(await run({ member: talent }), '/starter-dashboard')
})

// Unlike the Brand redirects, the Talent bounce is not escapable: ?retake=
// exists so a Brand can re-run their own quiz, and Talent has no quiz to
// retake (decision by Jerico 2026-08-03).
test('the Talent bounce ignores every ?retake= value', async () => {
    const talent = member('pln_dorxata-test-free-plan-dvcg0k8o')
    for (const search of ['?retake=true', '?retake=1', '?retake=yes']) {
        assert.equal(
            await run({ member: talent, search }),
            '/starter-dashboard',
            search,
        )
    }
})

// A member holding Talent and paid Brand at once is a configuration error that
// v3/route-guard.js fails closed as `conflicting-plan-roles`. This page keeps
// its pre-existing answer for that state rather than inventing a new one.
test('a Talent + paid Brand member keeps the paid outcome and its retake hatch', async () => {
    const conflicted = {
        id: 'member',
        planConnections: [
            {
                active: true,
                planId: 'pln_dorxata-test-free-plan-dvcg0k8o',
                status: 'ACTIVE',
            },
            { active: true, planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' },
        ],
    }
    assert.equal(await run({ member: conflicted }), '/brand-dashboard')
    assert.equal(
        await run({ member: conflicted, search: '?retake=true' }),
        undefined,
    )
})

test('the header carries a well-formed @release marker', () => {
    // This controller exports no window API, so there is no `release` property
    // to compare against — the marker is the only version signal it has.
    assert.match(source, /^ \* @release v\d+\.\d+\.\d+$/m)
})
