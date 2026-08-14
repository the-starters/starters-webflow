const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')

/**
 * Slices a span of the controller source between two literal markers.
 *
 * @param {string} startText Literal text the slice starts at.
 * @param {string} endText Literal text the slice stops before.
 * @returns {string} The sliced source.
 */
function sliceSource(startText, endText) {
    const start = source.indexOf(startText)
    const end = source.indexOf(endText, start)

    assert.notEqual(start, -1, `missing source start: ${startText}`)
    assert.notEqual(end, -1, `missing source end: ${endText}`)

    return source.slice(start, end)
}

/**
 * Slices as sliceSource(), but fails when the start marker is ambiguous.
 *
 * Plain indexOf silently takes the first of several matches, which is how a
 * slice can end up testing a different block than the one it names.
 *
 * @param {string} startText Literal text the slice starts at, expected once.
 * @param {string} endText Literal text the slice stops before.
 * @returns {string} The sliced source.
 */
function sliceSourceOnce(startText, endText) {
    const first = source.indexOf(startText)

    assert.notEqual(first, -1, `missing source start: ${startText}`)
    assert.equal(
        source.indexOf(startText, first + 1),
        -1,
        `ambiguous source start, matches more than once: ${startText}`,
    )

    return sliceSource(startText, endText)
}

// The real helper, not a stand-in: production normalize() only accepts strings,
// and the subcategory split leans on its trimming at every segment boundary.
const normalizeSource = [
    'function normalize(value) {',
    "    return (value || '').trim()",
    '}',
].join('\n')

const fieldNamesSource = sliceSource(
    'const subcategoryFieldNames = [',
    '\n    const maxDisplayedSubcategories',
)

const maxDisplayedSource = sliceSource(
    'const maxDisplayedSubcategories = 3',
    '\n\n    /**',
)

// getHitFieldValue through getSubcategoryLabels, contiguous in the source.
const subcategoryHelpersSource = sliceSource(
    'function getHitFieldValue(hit, path)',
    '/**\n     * Formats a rate value for display',
)

// Kept in the rank-role sandbox on purpose even though the branch no longer
// calls it: if anyone re-wraps the value, the test fails with a readable text
// diff instead of a ReferenceError that hides what actually broke.
const formatSlugTitleSource = sliceSource(
    'function formatSlugTitle(slug)',
    '/**\n     * Display-name overrides for role slugs',
)

const slugifySource = sliceSource(
    'function slugify(value)',
    '\n    function getQuizTaxonomyItemId',
)

const setCardTextSource = sliceSource(
    'function setCardText(element, text)',
    '\n    const cardConditionOperators',
)

// The rank-role branch body, minus its `if` wrapper and the required-field
// bookkeeping that follows it, so it runs as a plain script.
const rankRoleSource = sliceSource(
    "// Show the record's OWN subcategory",
    'if (!shown) failIfRequired(element)',
)

// The chip cap lives in the fallback card builder, where the deduped leaves are
// sliced to maxDisplayedSubcategories before rendering. The array guard this
// starts at is duplicated verbatim in the rank-role branch, so the marker is
// pinned by the card builder's 8-space indentation and the slice is then
// checked for the class name only that block writes.
const subcategoryRenderSource = sliceSourceOnce(
    '\n        const subcategories = Array.isArray(freelancer.subcategories)',
    'const hourlyRateText = formatRateValue(freelancer.hourlyRate)',
)

assert.match(
    subcategoryRenderSource,
    /quiz-result-freelancer-subcategory/,
    'the render slice must be the card builder block, not the rank-role branch',
)

/**
 * Rehomes a value returned from a vm context into this realm, so arrays compare
 * with deepEqual instead of tripping over a foreign Array prototype.
 *
 * @param {unknown} value Value produced inside a vm context.
 * @returns {unknown} The same value, arrays rebuilt locally.
 */
function toLocalValue(value) {
    return Array.isArray(value) ? Array.from(value) : value
}

/**
 * Runs the real getSubcategoryLabels() against a raw Algolia hit.
 *
 * @param {object} hit Raw Algolia hit.
 * @returns {string[]} Deduplicated subcategory labels a Brand would see.
 */
function getSubcategoryLabels(hit) {
    return toLocalValue(
        vm.runInNewContext(
            [
                normalizeSource,
                fieldNamesSource,
                subcategoryHelpersSource,
                'getSubcategoryLabels(hit)',
            ].join('\n'),
            { hit },
        ),
    )
}

/**
 * Builds a minimal stand-in for a bound card element.
 *
 * @returns {object} Element stub exposing textContent and its class list.
 */
function createElement() {
    const classes = new Set()

    return {
        textContent: '',
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            has: (name) => classes.has(name),
        },
    }
}

/**
 * Runs the controller's real rank-role text binding over one element.
 *
 * @param {object} freelancer Normalized candidate.
 * @returns {{textContent: string, hidden: boolean}} What the line renders.
 */
function renderRankRole(freelancer) {
    const element = createElement()

    vm.runInNewContext(
        [
            normalizeSource,
            formatSlugTitleSource,
            slugifySource,
            setCardTextSource,
            rankRoleSource,
        ].join('\n'),
        { element, freelancer },
    )

    return { textContent: element.textContent, hidden: element.classList.has('hide') }
}

/**
 * Runs the fallback card builder's subcategory paragraph over one candidate.
 *
 * @param {string[]} subcategories Deduplicated subcategory labels.
 * @returns {string[]} Text of each appended subcategory paragraph.
 */
function renderSubcategoryParagraph(subcategories) {
    const appended = []
    const context = {
        freelancer: { subcategories },
        document: {
            createElement: () => ({ className: '', textContent: '' }),
        },
        cardElement: {
            appendChild: (child) => appended.push(child),
        },
    }

    // No normalizeSource: this block only slices and joins already-clean labels.
    vm.runInNewContext(
        [maxDisplayedSource, subcategoryRenderSource].join('\n'),
        context,
    )

    return appended.map((child) => child.textContent)
}

test('subcategories come from categories.lvl1 and nothing else', () => {
    assert.match(
        fieldNamesSource,
        /^const subcategoryFieldNames = \[\s*'categories\.lvl1',?\s*\]/,
        'roles, roles-concatenate and the two dead flat fields must be gone',
    )
})

// Without this the helper could be perfect and the cards still wrong: nothing
// else pins getSubcategoryLabels to the candidate the cards actually bind.
test('candidates carry subcategories off the raw hit', () => {
    const normalizationSource = sliceSource(
        'function getRecommendedFreelancerCandidates(',
        'function getUniqueRecommendedFreelancerCandidates',
    )

    assert.match(
        normalizationSource,
        /subcategories: getSubcategoryLabels\(hit\),/,
        'card subcategories must be normalized from the hit, not left raw',
    )
})

// A cached quiz payload stores normalized freelancers and rebinds them without
// re-normalizing, so a change to the shape above only reaches existing members
// once this constant moves.
test('the recommendation cache version was bumped past v19', () => {
    const versionMatch = source.match(
        /const recommendationAlgorithmVersion = 'category-subcategory-pairs-v(\d+)'/,
    )

    assert.ok(versionMatch, 'recommendationAlgorithmVersion must stay greppable')
    assert.ok(
        Number(versionMatch[1]) >= 20,
        'stale caches would keep binding roles-derived subcategories',
    )
})

test('a hit carrying both roles and categories.lvl1 binds only the lvl1 leaves', () => {
    assert.deepEqual(
        getSubcategoryLabels({
            roles: ['ui-ux-designer', 'cro-expert'],
            'roles-concatenate': 'ui-ux-designer, cro-expert',
            categories: {
                lvl0: ['Design & Creative'],
                lvl1: ['Design & Creative > UI/UX Design'],
            },
        }),
        ['UI/UX Design'],
    )
})

test('a comma in the parent Category never splits the path', () => {
    assert.deepEqual(
        getSubcategoryLabels({
            categories: {
                lvl1: ['Influencer, Affiliate & PR > Affiliate Marketing'],
            },
        }),
        ['Affiliate Marketing'],
    )
})

test('a value with no > delimiter yields no label', () => {
    assert.deepEqual(
        getSubcategoryLabels({ categories: { lvl1: ['Paid Media'] } }),
        [],
    )
    assert.deepEqual(
        getSubcategoryLabels({
            categories: { lvl1: ['Paid Media', 'Paid Media > Paid Search'] },
        }),
        ['Paid Search'],
    )
})

// Intended, not incidental: a path missing a non-empty parent is not a valid
// "Parent > Child", so a stray delimiter cannot smuggle a leaf through.
test('a path with a blank parent or blank leaf yields no label', () => {
    assert.deepEqual(
        getSubcategoryLabels({ categories: { lvl1: ['> Branding'] } }),
        [],
    )
    assert.deepEqual(
        getSubcategoryLabels({ categories: { lvl1: ['Design > '] } }),
        [],
    )
})

test('a roles-only hit yields no labels, so every chip seed hides', () => {
    assert.deepEqual(
        getSubcategoryLabels({
            roles: ['ui-ux-designer'],
            'roles-concatenate': 'ui-ux-designer',
        }),
        [],
    )
})

test('two paths ending in the same leaf produce one label', () => {
    assert.deepEqual(
        getSubcategoryLabels({
            categories: {
                lvl1: [
                    'Design & Creative > Branding',
                    'Content & Creative > Branding',
                ],
            },
        }),
        ['Branding'],
    )
})

test('more than three leaves bind exactly three, in index order', () => {
    const labels = getSubcategoryLabels({
        categories: {
            lvl1: [
                'Paid Media > Paid Search',
                'Paid Media > Paid Social',
                'Design & Creative > UI/UX Design',
                'Lifecycle > Email Marketing',
                'SEO > Technical SEO',
            ],
        },
    })

    assert.deepEqual(labels, [
        'Paid Search',
        'Paid Social',
        'UI/UX Design',
        'Email Marketing',
        'Technical SEO',
    ])
    assert.deepEqual(renderSubcategoryParagraph(labels), [
        'Paid Search, Paid Social, UI/UX Design',
    ])
})

test('no leaves means no subcategory row at all', () => {
    assert.deepEqual(renderSubcategoryParagraph([]), [])
})

// The bug this case exists to prevent: formatSlugTitle splits on [-_\s]+, so a
// stored display label loses its hyphens ("E-Commerce Management" came out as
// "E Commerce Management"). categories.lvl1 already stores display-case labels,
// so the formatter can only damage them.
test('rank-role prints the record leaf as stored, not slug-formatted', () => {
    assert.deepEqual(
        renderRankRole({
            subcategories: ['E-Commerce Management', 'CRO & Experimentation'],
            matchedSubcategory: { label: 'E-Commerce Management' },
        }),
        { textContent: 'E-Commerce Management', hidden: false },
    )
    assert.deepEqual(
        renderRankRole({
            subcategories: ['UI/UX Design'],
            matchedSubcategory: { label: 'UI/UX Design' },
        }),
        { textContent: 'UI/UX Design', hidden: false },
    )
})

// Every arm below is anchored on a hyphenated label so that re-wrapping the
// output in formatSlugTitle fails all three, not just the own-match one.
// "Paid Search" and the like pass through the formatter unchanged and would
// have left these arms silently unguarded.
test('rank-role prefers the record leaf matching the quiz selection', () => {
    assert.deepEqual(
        renderRankRole({
            subcategories: ['Paid Search', 'E-Commerce Management'],
            matchedSubcategory: { label: 'E-Commerce Management' },
        }),
        { textContent: 'E-Commerce Management', hidden: false },
    )
})

test('rank-role falls back to the primary leaf, then the quiz selection', () => {
    assert.deepEqual(
        renderRankRole({
            subcategories: ['E-Commerce Management', 'Paid Social'],
            matchedSubcategory: { label: 'Email Marketing' },
        }),
        { textContent: 'E-Commerce Management', hidden: false },
    )
    assert.deepEqual(
        renderRankRole({
            subcategories: [],
            matchedSubcategory: { label: 'E-Commerce Management' },
        }),
        { textContent: 'E-Commerce Management', hidden: false },
    )
})

test('rank-role hides the line when neither source has a subcategory', () => {
    assert.deepEqual(renderRankRole({ subcategories: [] }), {
        textContent: '',
        hidden: true,
    })
})
