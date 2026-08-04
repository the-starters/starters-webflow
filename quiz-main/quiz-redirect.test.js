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

/**
 * sessionStorage double that records every write, so the tests can prove the
 * pending-quiz key is only ever read: quiz-loader.js derives its
 * skip-on-refresh run id from the same key's `updatedAt`.
 *
 * @param {string | undefined} pending Raw stored value, if any.
 * @param {boolean} [throws] Simulate blocked storage (privacy modes).
 */
function sessionStorageDouble(pending, throws) {
    return {
        removed: [],
        written: [],
        getItem(key) {
            if (throws) throw new Error('storage blocked')
            if (key !== 'starterQuizPending') return null
            return pending === undefined ? null : pending
        },
        setItem(key, value) {
            this.written.push([key, value])
        },
        removeItem(key) {
            this.removed.push(key)
        },
    }
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
    const sessionStorage = sessionStorageDouble(
        options.pending,
        options.storageThrows,
    )
    const window = {
        $memberstackDom: memberstack,
        location,
        sessionStorage,
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
    // Every caller gets the same invariant checked for free.
    assert.deepEqual(sessionStorage.removed, [])
    assert.deepEqual(sessionStorage.written, [])
    return location.replaced
}

const readyPayload = JSON.stringify({
    status: 'ready',
    updatedAt: '2026-08-04T00:00:00.000Z',
})
const draftPayload = JSON.stringify({
    status: 'draft',
    updatedAt: '2026-08-04T00:00:00.000Z',
})

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

// The post-signup safety net. Memberstack can drop the destination and return a
// brand-new member to /quiz; their `starter-quiz` custom field is not written
// until /quiz-results runs, so the `ready` session payload is the only evidence
// that they finished the quiz.
test('a ready pending payload sends a logged-in member to results', async () => {
    // No plan connections and no custom field: the branch must not depend on
    // either signal, because a just-signed-up member has neither yet.
    assert.equal(
        await run({ member: { id: 'member' }, pending: readyPayload }),
        '/quiz-results',
    )
    // Free plan, still no custom field — the pre-fix stuck state.
    assert.equal(
        await run({
            member: member('pln_free-plan-f6kn0dxz'),
            pending: readyPayload,
        }),
        '/quiz-results',
    )
    // Status comparison is trimmed and case-insensitive, like quiz-results.js.
    assert.equal(
        await run({
            member: { id: 'member' },
            pending: JSON.stringify({ status: '  Ready  ' }),
        }),
        '/quiz-results',
    )
})

test('a draft pending payload leaves the member on the quiz', async () => {
    assert.equal(
        await run({ member: { id: 'member' }, pending: draftPayload }),
        undefined,
    )
    // A payload with no status at all is not proof of a finished quiz either.
    // quiz-results.js is deliberately more tolerant there; this page is not.
    assert.equal(
        await run({ member: { id: 'member' }, pending: '{"updatedAt":"x"}' }),
        undefined,
    )
})

test('a malformed or unreadable pending payload is ignored silently', async () => {
    assert.equal(
        await run({ member: { id: 'member' }, pending: 'not json' }),
        undefined,
    )
    assert.equal(
        await run({ member: { id: 'member' }, pending: 'null' }),
        undefined,
    )
    assert.equal(await run({ member: { id: 'member' }, pending: '' }), undefined)
    assert.equal(
        await run({ member: { id: 'member' }, storageThrows: true }),
        undefined,
    )
})

test('a logged-out visitor with a ready payload stays on the quiz', async () => {
    assert.equal(await run({ member: null, pending: readyPayload }), undefined)
})

test('?retake= still bypasses the ready-payload branch', async () => {
    for (const search of ['?retake=true', '?retake=1', '?retake=yes']) {
        assert.equal(
            await run({
                member: member('pln_free-plan-f6kn0dxz'),
                pending: readyPayload,
                search,
            }),
            undefined,
            search,
        )
    }
})

test('the paid-Brand and Talent bounces outrank the ready-payload branch', async () => {
    assert.equal(
        await run({
            member: member('pln_new-paid-plan-463h04ph'),
            pending: readyPayload,
        }),
        '/brand-dashboard',
    )
    assert.equal(
        await run({
            member: member('pln_dorxata-test-brand-plan-777r02pa'),
            pending: readyPayload,
        }),
        '/brand-dashboard',
    )
    assert.equal(
        await run({
            member: member('pln_dorxata-test-free-plan-dvcg0k8o'),
            pending: readyPayload,
        }),
        '/starter-dashboard',
    )
})

test('the header carries the current release marker', () => {
    // This controller exports no window API, so there is no `release` property
    // to compare against — the marker is the only version signal it has.
    //
    // Pinned to the exact string rather than just the shape (tightened
    // 2026-08-03): a format-only assertion let this file sit at an older version
    // while its v3 siblings were bumped, and nothing failed. Bump the literal
    // below in the same commit that bumps the markers.
    const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
    assert.ok(marker, 'no "@release vX.Y.Z" line in the quiz-redirect.js header')
    assert.equal(marker[1], 'v1.59.84')
})
