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

function getLearnContentTaxonomyApi() {
    const aliasesSource = sliceSource(
        resultsSource,
        'const learnContentCategoryFilterAliases =',
        '/**\n     * Checks whether starter quiz debug logging is enabled.',
    )
    const filtersSource = sliceSource(
        resultsSource,
        'function getLearnContentCategoryFilterValues(',
        'function getLearnContentSearchConfig(',
    )

    return vm.runInNewContext(
        [
            'function normalizeLearnContentValue(value) {',
            "  return String(value || '').trim()",
            '}',
            'function slugifyLearnContentValue(value) {',
            '  return normalizeLearnContentValue(value).toLowerCase()',
            "    .replace(/[^a-z0-9]+/g, '-')",
            "    .replace(/(^-|-$)/g, '')",
            '}',
            aliasesSource,
            filtersSource,
            '({',
            '  getLearnContentCategoryFilterValues,',
            '  getLearnContentCategoryFilters,',
            '})',
        ].join('\n'),
    )
}

function runMainSubcategoryRestore({ subcategoryItems, categoryInputs, savedSubcategoryIds }) {
    const getCheckboxInputSource = sliceSource(
        mainSource,
        'function getCheckboxInput(item)',
        '/**\n     * Subcategory checkbox inputs',
    )
    const setWebflowCheckboxStateSource = sliceSource(
        mainSource,
        'function setWebflowCheckboxState(input, checked)',
        '/**\n     * Switches the start heading',
    )
    const getSubcategoryCategoryIdSource = sliceSource(
        mainSource,
        'function getSubcategoryCategoryId(item)',
        '/**\n     * Gets the readable label',
    )
    const getCheckboxLabelSource = sliceSource(
        mainSource,
        'function getCheckboxLabel(input)',
        '/**\n     * Reads selected categories',
    )
    const restoreLoopSource = sliceSource(
        mainSource,
        'subcategoryItems.forEach((item) => {',
        'if (!restoredInputCount) {',
    )

    const sandbox = { subcategoryItems, categoryInputs, savedSubcategoryIds }

    vm.runInNewContext(
        [
            "function normalize(value) { return String(value || '').trim() }",
            getCheckboxInputSource,
            setWebflowCheckboxStateSource,
            getSubcategoryCategoryIdSource,
            getCheckboxLabelSource,
            'let restoredInputCount = 0',
            'const restoredParentCategoryIds = new Set()',
            restoreLoopSource,
            'globalThis.__restoreResult = {',
            '  restoredInputCount,',
            '  restoredParentCategoryIds: Array.from(restoredParentCategoryIds),',
            '}',
        ].join('\n'),
        sandbox,
    )

    return sandbox.__restoreResult
}

function makeCheckboxInput(id) {
    return {
        id,
        value: id,
        checked: false,
        matches(selector) {
            return selector === 'input[type="checkbox"]'
        },
        closest() {
            return null
        },
    }
}

function makeSubcategoryItem(input, categoryId) {
    return {
        dataset: { category: categoryId },
        matches() {
            return false
        },
        querySelector(selector) {
            return selector === 'input[type="checkbox"]' ? input : null
        },
        closest() {
            return null
        },
    }
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

test('LearnContent filters project renamed V3 categories to legacy tags', () => {
    const { getLearnContentCategoryFilterValues } =
        getLearnContentTaxonomyApi()

    assert.deepEqual(
        Array.from(
            getLearnContentCategoryFilterValues({
                id: 'creative',
                label: 'Creative',
            }),
        ),
        ['creative', 'creative-brand', 'Creative'],
    )
    assert.deepEqual(
        Array.from(
            getLearnContentCategoryFilterValues({
                id: 'marketing-strategy-brand',
                label: 'Marketing Strategy & Brand',
            }),
        ),
        [
            'marketing-strategy-brand',
            'marketing-strategy-leadership',
            'Marketing Strategy & Brand',
        ],
    )
})

test('LearnContent filters remain compatible with legacy saved category IDs', () => {
    const { getLearnContentCategoryFilterValues } =
        getLearnContentTaxonomyApi()

    assert.deepEqual(
        Array.from(getLearnContentCategoryFilterValues('creative-brand')),
        ['creative-brand', 'creative'],
    )
    assert.deepEqual(
        Array.from(
            getLearnContentCategoryFilterValues(
                'marketing-strategy-leadership',
            ),
        ),
        ['marketing-strategy-leadership', 'marketing-strategy-brand'],
    )
})

test('LearnContent filters preserve current categories without invented aliases', () => {
    const { getLearnContentCategoryFilters } = getLearnContentTaxonomyApi()
    const filters = getLearnContentCategoryFilters({
        categories: [
            { id: 'paid-media', label: 'Paid Media' },
            { id: 'retention-crm', label: 'Retention & CRM' },
        ],
    })

    assert.deepEqual(Array.from(filters.selectedCategoryFilters), [
        'paid-media',
        'Paid Media',
        'retention-crm',
        'Retention & CRM',
    ])
    assert.deepEqual(
        Array.from(
            filters.selectedCategoryFilterGroups,
            ({ categoryId, filterValues }) => ({
                categoryId,
                filterValues: Array.from(filterValues),
            }),
        ),
        [
            {
                categoryId: 'paid-media',
                filterValues: ['paid-media', 'Paid Media'],
            },
            {
                categoryId: 'retention-crm',
                filterValues: ['retention-crm', 'Retention & CRM'],
            },
        ],
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
})

test('retake prefill restores subcategories and re-checks their parent category', () => {
    const paidSearchInput = makeCheckboxInput('paid-search')
    const marketingLeadershipInput = makeCheckboxInput('marketing-leadership')
    const subcategoryItems = [
        makeSubcategoryItem(paidSearchInput, 'paid-media'),
        makeSubcategoryItem(marketingLeadershipInput, 'marketing-strategy-brand'),
    ]
    const paidMediaCategory = makeCheckboxInput('paid-media')
    const marketingCategory = makeCheckboxInput('marketing-strategy-brand')
    const categoryInputs = [paidMediaCategory, marketingCategory]

    const result = runMainSubcategoryRestore({
        subcategoryItems,
        categoryInputs,
        savedSubcategoryIds: new Set(['paid-search']),
    })

    assert.equal(paidSearchInput.checked, true)
    assert.equal(marketingLeadershipInput.checked, false)
    assert.equal(paidMediaCategory.checked, true)
    assert.equal(marketingCategory.checked, false)
    assert.deepEqual([...result.restoredParentCategoryIds], ['paid-media'])
    assert.equal(result.restoredInputCount, 2)
})

test('taxonomy compatibility release invalidates v17 recommendations', () => {
    assert.match(
        resultsSource,
        /recommendationAlgorithmVersion = 'category-subcategory-pairs-v18'/,
    )
})
