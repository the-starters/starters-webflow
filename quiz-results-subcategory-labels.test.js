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

// The staging gate, its once-per-load latch and the warning itself.
const warnSource = sliceSourceOnce(
    'let hasWarnedAboutEmptySubcategories = false',
    '/**\n     * Formats a rate value for display',
)

const splitMultiValueSource = sliceSource(
    'function splitMultiValue(value)',
    '/**\n     * Gets the first non-empty value from a primary card field',
)

const cardFieldValueSource = sliceSource(
    'function getCardFieldValue(freelancer, field)',
    '/**\n     * Checks whether a bound field value should count as empty (hidden).',
)

// The real [data-quiz-list] pass, which is the chip path itself.
const listBindingSource = sliceSource(
    '// Indexed list item bindings (e.g. roles[0], roles[1], roles[2]).',
    '// Joined multi-value bindings',
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

/**
 * Runs the real staging-gated warning over one or more response batches.
 *
 * A fresh context per call, because the once-per-load latch is module state.
 *
 * @param {object} options Harness options.
 * @param {string} options.hostname Hostname the page is served from.
 * @param {unknown} [options.debug] window.STARTERS_DEBUG value.
 * @param {boolean} [options.debugLogging] isDebugLoggingEnabled() result.
 * @param {object[][]} options.batches Candidate batches, one per response.
 * @returns {string[]} Warning messages printed.
 */
function runSubcategoryWarn({
    hostname,
    debug,
    debugLogging = false,
    batches,
}) {
    const warnings = []
    const context = {
        window: { location: { hostname }, STARTERS_DEBUG: debug },
        console: {
            warn: (...args) =>
                warnings.push(
                    args.filter((arg) => typeof arg === 'string').join(' '),
                ),
        },
        // This controller's own opt-in flag, stubbed: it reads the query string
        // and sessionStorage, neither of which is what these cases pin.
        isDebugLoggingEnabled: () => debugLogging,
        subcategoryFieldNames: ['categories.lvl1'],
        batches,
    }

    vm.runInNewContext(
        [
            warnSource,
            'for (const candidates of batches) {',
            '    warnWhenSubcategoriesResolveEmpty(candidates)',
            '}',
        ].join('\n'),
        context,
    )

    return warnings
}

/**
 * Runs the real [data-quiz-list] chip binding for three seeded slots.
 *
 * @param {object} freelancer Normalized candidate.
 * @returns {string[]} Text landing in chip slots 0, 1 and 2.
 */
function renderChipSlots(freelancer) {
    const elements = [0, 1, 2].map((index) => {
        const classes = new Set()

        return {
            textContent: '',
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
                has: (name) => classes.has(name),
            },
            getAttribute: (name) =>
                name === 'data-quiz-list'
                    ? 'subcategories'
                    : name === 'data-quiz-index'
                      ? String(index)
                      : null,
            hasAttribute: () => false,
        }
    })

    vm.runInNewContext(
        [
            normalizeSource,
            splitMultiValueSource,
            cardFieldValueSource,
            setCardTextSource,
            listBindingSource,
        ].join('\n'),
        {
            cardElement: {
                querySelectorAll: (selector) => {
                    assert.equal(selector, '[data-quiz-list]')
                    return elements
                },
            },
            freelancer,
            failIfRequired: () => {},
        },
    )

    return elements.map((element) => element.textContent)
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

const emptyLvl1Batch = [
    { categories: { lvl0: ['Paid Media'] }, subcategories: [] },
]

test('the warning fires once on staging when no leaf resolves', () => {
    const warnings = runSubcategoryWarn({
        hostname: 'the-starters-3-0.webflow.io',
        batches: [emptyLvl1Batch],
    })

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /no Subcategory label resolved from categories/)
})

test('the warning stays silent in production', () => {
    assert.deepEqual(
        runSubcategoryWarn({
            hostname: 'thestarters.com',
            batches: [emptyLvl1Batch],
        }),
        [],
    )
})

test('the warning stays silent when no hit carries categories', () => {
    assert.deepEqual(
        runSubcategoryWarn({
            hostname: 'the-starters-3-0.webflow.io',
            batches: [[{ subcategories: [] }, { subcategories: [] }]],
        }),
        [],
    )
})

test('the warning stays silent when leaves do resolve', () => {
    assert.deepEqual(
        runSubcategoryWarn({
            hostname: 'the-starters-3-0.webflow.io',
            batches: [
                [
                    {
                        categories: { lvl1: ['Paid Media > Paid Search'] },
                        subcategories: ['Paid Search'],
                    },
                ],
            ],
        }),
        [],
    )
})

test('the warning fires once per page load, not once per response', () => {
    const warnings = runSubcategoryWarn({
        hostname: 'localhost',
        batches: [emptyLvl1Batch, emptyLvl1Batch, emptyLvl1Batch],
    })

    assert.equal(warnings.length, 1)
})

test('STARTERS_DEBUG === true re-enables the warning in production', () => {
    const warnings = runSubcategoryWarn({
        hostname: 'thestarters.com',
        debug: true,
        batches: [emptyLvl1Batch],
    })

    assert.equal(warnings.length, 1)
})

// Pins the strict === true comparison: a truthy leftover such as the STRING
// 'false' used to read as "debugging on" and would leak the warning to
// production visitors.
test('a truthy but non-true STARTERS_DEBUG does not enable the warning', () => {
    for (const debug of ['false', '0', 1, {}, 'yes']) {
        assert.deepEqual(
            runSubcategoryWarn({
                hostname: 'thestarters.com',
                debug,
                batches: [emptyLvl1Batch],
            }),
            [],
            `STARTERS_DEBUG=${JSON.stringify(debug)} must not enable logging`,
        )
    }
})

// Pins the anchored host regexes. The older loose pattern
// (/webflow\.io$|^localhost$|trycloudflare\.com$/) matches every lookalike
// below, which would print internal diagnostics on a domain we do not own.
test('lookalike hostnames do not read as staging', () => {
    for (const hostname of [
        'notwebflow.io',
        'evil-trycloudflare.com',
        'mywebflow.io',
        'faketrycloudflare.com',
    ]) {
        assert.deepEqual(
            runSubcategoryWarn({ hostname, batches: [emptyLvl1Batch] }),
            [],
            `${hostname} must not count as a staging host`,
        )
    }
})

test('real staging hosts and loopback addresses do read as staging', () => {
    for (const hostname of [
        'the-starters-3-0.webflow.io',
        'webflow.io',
        'localhost',
        '127.0.0.1',
        'random-words-here.trycloudflare.com',
    ]) {
        assert.equal(
            runSubcategoryWarn({ hostname, batches: [emptyLvl1Batch] }).length,
            1,
            `${hostname} must count as a staging host`,
        )
    }
})

test("the controller's own debug flag also enables the warning anywhere", () => {
    const warnings = runSubcategoryWarn({
        hostname: 'thestarters.com',
        debugLogging: true,
        batches: [emptyLvl1Batch],
    })

    assert.equal(warnings.length, 1)
})

// The chips themselves: data-quiz-list="subcategories" resolves through
// getCardFieldValue's default arm (there is no 'subcategories' case) and then
// splitMultiValue. splitMultiValue only takes its array branch here, which is
// what keeps a slash or a comma inside a label intact — the string branch
// splits on /[/;,]/ and would shatter "UI/UX Design" into two chips.
test('lvl1 leaves reach chip slots 0, 1 and 2 verbatim', () => {
    assert.deepEqual(
        renderChipSlots({
            subcategories: [
                'UI/UX Design',
                'CRO & Experimentation',
                'E-Commerce Management',
            ],
        }),
        ['UI/UX Design', 'CRO & Experimentation', 'E-Commerce Management'],
    )
})

test('a short leaf list leaves the trailing chip slots blank', () => {
    assert.deepEqual(renderChipSlots({ subcategories: ['Paid Search'] }), [
        'Paid Search',
        '',
        '',
    ])
    assert.deepEqual(renderChipSlots({ subcategories: [] }), ['', '', ''])
})
