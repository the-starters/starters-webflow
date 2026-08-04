const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-main.js'), 'utf8')

// quiz-main.js is a 1400-line DOM controller behind a DOMContentLoaded guard, so
// this file follows quiz-main-signup-redirect.test.js: slice out the functions
// under test and run them against doubles. Everything else is out of scope.
//
// The bug this covers (INITIATIVE-136, "Navigate back and forth through quiz
// steps"): the homepage bucket seed in sessionStorage.quizSelectedCategories was
// re-applied on every load and every pageshow, and restoreCategoriesFromStorage()
// only ever *checks* boxes. Nothing updated or cleared that key when the user
// edited the quiz, so a reload or a browser Back re-checked a category the user
// had removed (reported as "Prepopulated Retail & Marketplace when it wasn't
// previously selected"), and a reload dropped their real answers entirely.
function sliceSource(startText, endText) {
    const start = source.indexOf(startText)
    const end = source.indexOf(endText, start)

    assert.notEqual(start, -1, `missing source start: ${startText}`)
    assert.notEqual(end, -1, `missing source end: ${endText}`)

    return source.slice(start, end)
}

/**
 * Checkbox double carrying just what the restore path touches.
 *
 * @param {string} id Checkbox ID.
 * @param {boolean} [checked] Starting checked state.
 */
function checkboxDouble(id, checked = false) {
    return {
        id,
        value: '',
        checked,
        // setWebflowCheckboxState() reaches for the Webflow custom checkbox
        // through closest('label'); no label means it only sets .checked.
        closest: () => null,
    }
}

/**
 * Builds a sandbox with the restore functions wired to storage and form doubles.
 *
 * @param {object} options Test setup.
 * @param {Record<string, string>} options.storage Starting sessionStorage.
 * @param {string[]} options.categoryIds Category checkbox IDs on the page.
 * @param {string[]} [options.checkedIds] Category IDs already checked.
 */
function setup({ storage, categoryIds, checkedIds = [] }) {
    const store = { ...storage }
    const categoryInputs = categoryIds.map((id) =>
        checkboxDouble(id, checkedIds.includes(id)),
    )
    const logs = []

    const context = {
        sessionStorage: {
            getItem: (key) =>
                Object.prototype.hasOwnProperty.call(store, key)
                    ? store[key]
                    : null,
            setItem: (key, value) => {
                store[key] = String(value)
            },
            removeItem: (key) => {
                delete store[key]
            },
        },
        JSON,
        Set,
        Array,
        Boolean,
        Object,
        Event: class Event {},
        storageKey: 'quizSelectedCategories',
        pendingQuizStorageKey: 'starterQuizPending',
        categoryInputs,
        // Subcategories are exercised through the live-page check below; the
        // sliced unit here only needs the category half.
        subcategoryItems: [],
        subcategoriesForms: [],
        categoriesForm: { dispatchEvent: () => {} },
        normalize: (value) => (value || '').trim(),
        getCheckboxInput: (item) => item,
        getCheckboxLabel: (input) => input.id,
        getSelectedCategoryIds: () =>
            categoryInputs.filter((input) => input.checked).map((i) => i.id),
        setWebflowCheckboxState: (input, checked) => {
            input.checked = checked
        },
        logQuizFlow: (message) => logs.push(message),
        hasRestoredDraft: false,
        hasSeededFromHomepage: false,
        getSavedBuckets: () => [],
        getBucketPairs: () => new Map(),
        restoreCategoriesFromStorage: () => {
            logs.push('homepage seed path ran')
        },
    }

    const functions = [
        sliceSource(
            '    function getDraftQuizSelection()',
            '    /**\n     * Rehydrates the form from the user',
        ),
        sliceSource(
            '    function restoreCategoriesFromDraft()',
            '    /**\n     * Seeds the form for this page view',
        ),
        sliceSource(
            '    function restoreQuizSelections()',
            '\n    /**\n     * Reads currently selected category IDs',
        ),
        sliceSource(
            '    function consumeHomepageBucketSeed()',
            '\n    categoriesForm.addEventListener',
        ),
    ].join('\n')

    const api = vm.runInNewContext(
        `${functions}\n({ getDraftQuizSelection, restoreCategoriesFromDraft, restoreQuizSelections, consumeHomepageBucketSeed })`,
        context,
    )

    return {
        api,
        context,
        store,
        logs,
        checkedIds: () =>
            categoryInputs.filter((input) => input.checked).map((i) => i.id),
    }
}

const draftOf = (...categoryIds) =>
    JSON.stringify({
        categories: categoryIds.map((id) => ({ id, label: id })),
        subcategories: [],
        resultSlug: null,
        status: 'draft',
        updatedAt: '2026-08-04T00:00:00.000Z',
        completedAt: null,
    })

test('a reload restores the draft answers, not the stale homepage seed', () => {
    // The reported repro: homepage picked retail-marketplace, then in the quiz the
    // user swapped it for paid-media. A fresh load starts from blank Webflow
    // markup, so before the fix the seed was the only thing restored.
    const harness = setup({
        storage: {
            quizSelectedCategories: JSON.stringify(['retail-marketplace']),
            starterQuizPending: draftOf('paid-media'),
        },
        categoryIds: ['paid-media', 'retail-marketplace'],
    })

    const usedDraft = harness.api.restoreQuizSelections()

    assert.equal(usedDraft, true)
    assert.deepEqual(harness.checkedIds(), ['paid-media'])
    assert.equal(
        harness.logs.includes('homepage seed path ran'),
        false,
        'the homepage seed must not run once a draft exists',
    )
})

test('a Back/Forward restore does not re-check a category the user removed', () => {
    // bfcache keeps the live DOM state, so the draft and the DOM already agree.
    // Restoring must be an exact match rather than a union.
    const harness = setup({
        storage: {
            quizSelectedCategories: JSON.stringify(['retail-marketplace']),
            starterQuizPending: draftOf('paid-media'),
        },
        categoryIds: ['paid-media', 'retail-marketplace'],
        checkedIds: ['paid-media'],
    })

    harness.api.restoreQuizSelections()

    assert.deepEqual(harness.checkedIds(), ['paid-media'])
})

test('an empty draft still lets the homepage seed prefill a first arrival', () => {
    // init writes an empty draft before the user answers anything; that must not
    // be mistaken for real answers, or homepage prefill would never work.
    const harness = setup({
        storage: {
            quizSelectedCategories: JSON.stringify(['retail-marketplace']),
            starterQuizPending: draftOf(),
        },
        categoryIds: ['paid-media', 'retail-marketplace'],
    })

    const usedDraft = harness.api.restoreQuizSelections()

    assert.equal(usedDraft, false)
    assert.equal(harness.api.getDraftQuizSelection(), null)
    assert.equal(harness.logs.includes('homepage seed path ran'), true)
})

test('no draft at all leaves the homepage seed path untouched', () => {
    const harness = setup({
        storage: {
            quizSelectedCategories: JSON.stringify(['retail-marketplace']),
        },
        categoryIds: ['paid-media', 'retail-marketplace'],
    })

    assert.equal(harness.api.restoreQuizSelections(), false)
    assert.equal(harness.logs.includes('homepage seed path ran'), true)
})

test('a malformed draft falls back to the seed instead of throwing', () => {
    const harness = setup({
        storage: {
            quizSelectedCategories: JSON.stringify(['retail-marketplace']),
            starterQuizPending: '{not json',
        },
        categoryIds: ['paid-media', 'retail-marketplace'],
    })

    assert.equal(harness.api.restoreQuizSelections(), false)
    assert.equal(harness.logs.includes('homepage seed path ran'), true)
})

test('the homepage seed is cleared once, so clearing every answer cannot replay it', () => {
    // Without this, unchecking everything left an empty draft and the seed came
    // back on the next load.
    const harness = setup({
        storage: {
            quizSelectedCategories: JSON.stringify(['retail-marketplace']),
        },
        categoryIds: ['paid-media', 'retail-marketplace'],
    })

    harness.api.consumeHomepageBucketSeed()

    assert.equal(harness.store.quizSelectedCategories, undefined)
    // Idempotent: a second edit must not throw or re-log.
    harness.api.consumeHomepageBucketSeed()
    assert.equal(harness.store.quizSelectedCategories, undefined)
})

test('the seed is consumed on the first trusted user edit only', () => {
    // Guards the wiring: the restore paths dispatch synthetic change events, and
    // those must not be mistaken for the user editing the form.
    const handler = sliceSource(
        '    function markQuizTouchedByUser(event)',
        '\n    /**\n     * Drops the homepage bucket seed',
    )

    const calls = []
    const context = {
        categoryInputs: { includes: (input) => input === 'category-input' },
        subcategoryInputs: { includes: () => false },
        userTouchedQuiz: false,
        consumeHomepageBucketSeed: () => calls.push('consumed'),
    }
    const markQuizTouchedByUser = vm.runInNewContext(
        `${handler}\nmarkQuizTouchedByUser`,
        context,
    )

    markQuizTouchedByUser({ target: 'category-input', isTrusted: false })
    assert.deepEqual(calls, [], 'synthetic restore events must not consume the seed')

    markQuizTouchedByUser({ target: 'something-else', isTrusted: true })
    assert.deepEqual(calls, [], 'non-quiz inputs must not consume the seed')

    markQuizTouchedByUser({ target: 'category-input', isTrusted: true })
    assert.deepEqual(calls, ['consumed'])
})

test('the draft is restored before the seed at both call sites', () => {
    // Ordering is the whole fix, so pin it in the source: init and the pageshow
    // handler must both go through restoreQuizSelections() rather than calling
    // restoreCategoriesFromStorage() directly.
    const callSites = source.match(/^\s*restoreCategoriesFromStorage\(\)$/gm) || []

    assert.equal(
        callSites.length,
        1,
        'restoreCategoriesFromStorage() should only be called from restoreQuizSelections()',
    )
    assert.equal(
        (source.match(/^\s*restoreQuizSelections\(\)$/gm) || []).length,
        2,
        'init and the pageshow handler should both call restoreQuizSelections()',
    )
})
