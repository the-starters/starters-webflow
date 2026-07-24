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
