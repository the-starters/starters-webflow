const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const resultsSource = fs.readFileSync(
    require.resolve('./quiz-results.js'),
    'utf8',
)
const mainSource = fs.readFileSync(
    require.resolve('./quiz-main/quiz-main.js'),
    'utf8',
)

function sliceSource(source, startText, endText) {
    const start = source.indexOf(startText)
    const end = source.indexOf(endText, start)

    assert.notEqual(start, -1, `missing source start: ${startText}`)
    assert.notEqual(end, -1, `missing source end: ${endText}`)

    return source.slice(start, end)
}

function getResultsTaxonomyApi() {
    const catalogSource = sliceSource(
        resultsSource,
        'const quizTaxonomyCatalog =',
        'const hourlyRateFieldNames =',
    )
    const normalizerSource = sliceSource(
        resultsSource,
        'function getQuizTaxonomyItemId(item)',
        '/**\n     * Strips HTML tags',
    )
    const facetSource = sliceSource(
        resultsSource,
        'function createSubcategoryFacetRule(',
        '/**\n     * Checks whether the page requests strict',
    )

    return vm.runInNewContext(
        [
            "function normalize(value) { return String(value || '').trim() }",
            'function slugify(value) {',
            '  return normalize(value).toLowerCase()',
            "    .replace(/[^a-z0-9]+/g, '-')",
            "    .replace(/(^-|-$)/g, '')",
            '}',
            catalogSource,
            normalizerSource,
            facetSource,
            '({',
            '  quizTaxonomyCatalog,',
            '  normalizeQuizTaxonomyPayload,',
            '  createSubcategoryFacetRule,',
            '  createCategoryFacetRule,',
            '})',
        ].join('\n'),
    )
}

function getMainSavedIdNormalizer() {
    const compatibilitySource = sliceSource(
        mainSource,
        'const savedQuizCategoryIdAliases =',
        '/**\n     * Reads bucket IDs selected on the homepage',
    )

    return vm.runInNewContext(
        [
            "function normalize(value) { return String(value || '').trim() }",
            compatibilitySource,
            'normalizeSavedQuizSelectionIds',
        ].join('\n'),
    )
}

test('results taxonomy catalog matches the approved 12 by 43 shape', () => {
    const { quizTaxonomyCatalog } = getResultsTaxonomyApi()
    const subcategoryCount = quizTaxonomyCatalog.reduce(
        (count, category) => count + category.subcategories.length,
        0,
    )

    assert.equal(quizTaxonomyCatalog.length, 12)
    assert.equal(subcategoryCount, 43)
    assert.deepEqual(
        Array.from(quizTaxonomyCatalog, (category) => category.id),
        [
            'paid-media',
            'content-organic',
            'creative',
            'influencer-affiliate-pr',
            'retention-crm',
            'analytics-experimentation',
            'retail-marketplace',
            'ai-technology',
            'physical-product-development',
            'marketing-strategy-brand',
            'finance',
            'operations-supply-chain',
        ],
    )
    assert.doesNotMatch(
        sliceSource(
            resultsSource,
            'const quizTaxonomyCatalog =',
            'const quizCategoryIdAliases =',
        ),
        /Hiring & Team Building|Creative & Brand|Marketing Strategy & Leadership/,
    )
})

test('saved rename and merge aliases become canonical selections', () => {
    const { normalizeQuizTaxonomyPayload } = getResultsTaxonomyApi()
    const result = normalizeQuizTaxonomyPayload({
        categories: [
            { id: 'creative-brand', label: 'Creative & Brand' },
            {
                id: 'marketing-strategy-leadership',
                label: 'Marketing Strategy & Leadership',
            },
        ],
        subcategories: [
            {
                id: 'performance-creative',
                label: 'Performance Creative',
                categoryId: 'paid-media',
            },
            {
                id: 'amazon-advertising',
                label: 'Amazon Advertising',
                categoryId: 'paid-media',
            },
            {
                id: 'demand-planning',
                label: 'Demand Planning',
                categoryId: 'retail-marketplace',
            },
        ],
    })

    assert.equal(result.requiresReselection, false)
    assert.deepEqual(
        Array.from(result.payload.categories, (category) => category.id),
        [
            'creative',
            'marketing-strategy-brand',
            'paid-media',
            'retail-marketplace',
            'operations-supply-chain',
        ],
    )
    assert.deepEqual(
        Array.from(result.payload.subcategories, (subcategory) => ({
            id: subcategory.id,
            categoryId: subcategory.categoryId,
        })),
        [
            {
                id: 'performance-creative-strategy',
                categoryId: 'paid-media',
            },
            {
                id: 'amazon-marketplace',
                categoryId: 'retail-marketplace',
            },
            {
                id: 'demand-planning',
                categoryId: 'operations-supply-chain',
            },
        ],
    )
})

test('every deterministic subcategory alias resolves to its approved target', () => {
    const { normalizeQuizTaxonomyPayload } = getResultsTaxonomyApi()
    const aliases = {
        'paid-search-sem': 'paid-search',
        'performance-creative': 'performance-creative-strategy',
        'amazon-advertising': 'amazon-marketplace',
        'e-commerce-management': 'ecommerce-management',
        'digital-product-mgmt': 'digital-product-management',
        'cmo-marketing-leadership': 'marketing-leadership',
        'financial-strategy': 'finance-leadership',
        'fp-a-modeling': 'strategic-finance',
        'coo-ops-leadership': 'operations-leadership',
        'brand-strategy': 'brand-positioning',
    }
    const result = normalizeQuizTaxonomyPayload({
        categories: [],
        subcategories: Object.keys(aliases).map((id) => ({ id })),
    })

    assert.deepEqual(
        Array.from(
            result.payload.subcategories,
            (subcategory) => subcategory.id,
        ),
        Object.values(aliases),
    )
    assert.equal(result.droppedSubcategoryIds.length, 0)
})

test('retired choices drop while surviving current choices continue', () => {
    const { normalizeQuizTaxonomyPayload } = getResultsTaxonomyApi()
    const result = normalizeQuizTaxonomyPayload({
        categories: [
            { id: 'paid-media', label: 'Paid Media' },
            {
                id: 'hiring-team-building',
                label: 'Hiring & Team Building',
            },
        ],
        subcategories: [
            {
                id: 'paid-search',
                label: 'Paid Search (SEM)',
                categoryId: 'paid-media',
            },
            {
                id: 'talent-recruiting',
                label: 'Talent & Recruiting',
                categoryId: 'hiring-team-building',
            },
        ],
    })

    assert.equal(result.requiresReselection, false)
    assert.deepEqual(
        Array.from(result.payload.categories, (category) => category.id),
        ['paid-media'],
    )
    assert.deepEqual(
        Array.from(
            result.payload.subcategories,
            (subcategory) => subcategory.id,
        ),
        ['paid-search'],
    )
    assert.deepEqual(Array.from(result.droppedCategoryIds), [
        'hiring-team-building',
    ])
    assert.deepEqual(Array.from(result.droppedSubcategoryIds), [
        'talent-recruiting',
    ])
})

test('all eleven no-successor subcategories are discarded', () => {
    const { normalizeQuizTaxonomyPayload } = getResultsTaxonomyApi()
    const retiredIds = [
        'fractional-leadership',
        'org-design',
        'talent-recruiting',
        'procurement-sourcing',
        'supply-chain',
        'financial-analysis',
        'sourcing-manufacturing',
        'regulatory-compliance',
        'data-engineering',
        'wholesale-distribution',
        'loyalty-subscription',
    ]
    const result = normalizeQuizTaxonomyPayload({
        categories: [{ id: 'paid-media', label: 'Paid Media' }],
        subcategories: retiredIds.map((id) => ({ id })),
    })

    assert.deepEqual(
        Array.from(result.droppedSubcategoryIds),
        retiredIds,
    )
    assert.equal(result.payload.subcategories.length, 0)
    assert.equal(result.requiresReselection, false)
})

test('an entirely retired saved payload requires reselection', () => {
    const { normalizeQuizTaxonomyPayload } = getResultsTaxonomyApi()
    const result = normalizeQuizTaxonomyPayload({
        categories: [
            {
                id: 'hiring-team-building',
                label: 'Hiring & Team Building',
            },
        ],
        subcategories: [
            {
                id: 'fractional-leadership',
                label: 'Fractional Leadership',
                categoryId: 'hiring-team-building',
            },
        ],
    })

    assert.equal(result.requiresReselection, true)
    assert.equal(result.payload.categories.length, 0)
    assert.equal(result.payload.subcategories.length, 0)
})

test('a current canonical payload remains unchanged', () => {
    const { normalizeQuizTaxonomyPayload } = getResultsTaxonomyApi()
    const payload = {
        categories: [
            {
                id: 'marketing-strategy-brand',
                label: 'Marketing Strategy & Brand',
            },
        ],
        subcategories: [
            {
                id: 'marketing-leadership',
                label: 'Marketing Leadership',
                categoryId: 'marketing-strategy-brand',
            },
        ],
    }
    const result = normalizeQuizTaxonomyPayload(payload)

    assert.equal(result.changed, false)
    assert.equal(result.requiresReselection, false)
    assert.equal(JSON.stringify(result.payload), JSON.stringify(payload))
})

test('every current catalog value produces the exact Algolia facet label', () => {
    const {
        quizTaxonomyCatalog,
        createSubcategoryFacetRule,
        createCategoryFacetRule,
    } = getResultsTaxonomyApi()

    quizTaxonomyCatalog.forEach((category) => {
        assert.equal(
            JSON.stringify(
                createCategoryFacetRule(category.label).facetFilters,
            ),
            JSON.stringify([['categories.lvl0:' + category.label]]),
        )

        category.subcategories.forEach((subcategory) => {
            assert.equal(
                JSON.stringify(
                    createSubcategoryFacetRule(
                        category.label,
                        subcategory.label,
                    ).facetFilters,
                ),
                JSON.stringify([
                    [
                        'categories.lvl1:' +
                            category.label +
                            ' > ' +
                            subcategory.label,
                    ],
                ]),
            )
        })
    })
})

test('retake prefill maps aliases and discards no-successor IDs', () => {
    const normalizeSavedQuizSelectionIds = getMainSavedIdNormalizer()
    const result = normalizeSavedQuizSelectionIds({
        categoryIds: [
            'creative-brand',
            'marketing-strategy-leadership',
            'hiring-team-building',
        ],
        subcategoryIds: [
            'performance-creative',
            'amazon-advertising',
            'financial-strategy',
            'talent-recruiting',
        ],
    })

    assert.deepEqual(Array.from(result.categoryIds), [
        'creative',
        'marketing-strategy-brand',
    ])
    assert.deepEqual(Array.from(result.subcategoryIds), [
        'performance-creative-strategy',
        'amazon-marketplace',
        'finance-leadership',
    ])
    assert.match(mainSource, /restoredParentCategoryIds/)
    assert.match(
        mainSource,
        /getSubcategoryCategoryId\(item\)[\s\S]*restoredParentCategoryIds\.add/,
    )
})

test('taxonomy compatibility release invalidates v17 recommendations', () => {
    assert.match(
        resultsSource,
        /recommendationAlgorithmVersion = 'category-subcategory-pairs-v18'/,
    )
})
