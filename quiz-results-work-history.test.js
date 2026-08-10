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

// The real helpers, not stand-ins: production normalize() only accepts strings,
// which is exactly what the work-history entry guard has to survive.
const normalizeSource = [
    'function normalize(value) {',
    "    return (value || '').trim()",
    '}',
].join('\n')

const workHistorySource = sliceSource(
    'function getWorkHistoryCompanies(value)',
    '/**\n     * Reads a possibly nested field from an Algolia hit using a dot path.',
)

const splitMultiValueSource = sliceSource(
    'function splitMultiValue(value)',
    '/**\n     * Gets the first non-empty value from a primary card field',
)

const cardFieldValueSource = sliceSource(
    'function getCardFieldValue(freelancer, field)',
    '/**\n     * Checks whether a bound field value should count as empty (hidden).',
)

const setCardTextSource = sliceSource(
    'function setCardText(element, text)',
    '\n    const cardConditionOperators',
)

const joinBindingSource = sliceSource(
    '// Joined multi-value bindings (e.g. previous companies).',
    '// Link bindings:',
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
 * Runs the real getWorkHistoryCompanies() against a raw attribute value.
 *
 * @param {unknown} value Raw Algolia `work-history` value.
 * @returns {string[]} Extracted company names.
 */
function getWorkHistoryCompanies(value) {
    return toLocalValue(
        vm.runInNewContext(
            [
                normalizeSource,
                workHistorySource,
                'getWorkHistoryCompanies(rawValue)',
            ].join('\n'),
            { rawValue: value },
        ),
    )
}

/**
 * Runs the real getCardFieldValue() for a single binding field.
 *
 * @param {object} freelancer Normalized candidate.
 * @param {string} field Binding field name.
 * @returns {unknown} Resolved field value.
 */
function getCardFieldValue(freelancer, field) {
    return toLocalValue(
        vm.runInNewContext(
            [cardFieldValueSource, 'getCardFieldValue(freelancer, field)'].join(
                '\n',
            ),
            { freelancer, field },
        ),
    )
}

/**
 * Builds a minimal stand-in for a bound card element.
 *
 * @param {Record<string, string>} attributes Attribute map.
 * @returns {object} Element stub exposing textContent and its class list.
 */
function createElement(attributes) {
    const classes = new Set()

    return {
        textContent: '',
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            has: (name) => classes.has(name),
        },
        getAttribute: (name) =>
            Object.prototype.hasOwnProperty.call(attributes, name)
                ? attributes[name]
                : null,
    }
}

/**
 * Runs the controller's real [data-quiz-join] render pass over one element,
 * wiring in the real splitMultiValue(), getCardFieldValue() and setCardText().
 *
 * @param {object} element Bound element stub.
 * @param {object} freelancer Normalized candidate.
 * @returns {{textContent: string, hidden: boolean, required: object[]}} Result.
 */
function renderJoinBinding(element, freelancer) {
    const requiredFailures = []
    const context = {
        cardElement: {
            querySelectorAll: (selector) => {
                assert.equal(selector, '[data-quiz-join]')
                return [element]
            },
        },
        freelancer,
        failIfRequired: (failed) => requiredFailures.push(failed),
    }

    vm.runInNewContext(
        [
            normalizeSource,
            workHistorySource,
            splitMultiValueSource,
            cardFieldValueSource,
            setCardTextSource,
            joinBindingSource,
        ].join('\n'),
        context,
    )

    return {
        textContent: element.textContent,
        hidden: element.classList.has('hide'),
        required: requiredFailures,
    }
}

const scottBauerWorkHistory = [
    { company: 'Barstool Sports', title: 'Creative Director' },
    { company: 'Homefield Apparel', title: 'Head of Brand' },
    { company: 'SiriusXM', title: 'Senior Designer' },
]

test('work-history is requested from Algolia for recommendation cards', () => {
    const querySource = sliceSource(
        'attributesToRetrieve: [',
        'clickAnalytics: true',
    )

    assert.match(
        querySource,
        /'work-history',/,
        'the candidate query must retrieve work-history or the cards get nothing to join',
    )
    assert.match(querySource, /'previous-company',/)
})

test('candidates carry workHistoryCompanies off the raw hit', () => {
    const normalizationSource = sliceSource(
        "previousCompany: normalize(hit['previous-company']),",
        'function getUniqueRecommendedFreelancerCandidates',
    )

    assert.match(
        normalizationSource,
        /workHistoryCompanies: getWorkHistoryCompanies\(\s*hit\['work-history'\],\s*\)/,
    )
})

test('companies are extracted in index order', () => {
    assert.deepEqual(getWorkHistoryCompanies(scottBauerWorkHistory), [
        'Barstool Sports',
        'Homefield Apparel',
        'SiriusXM',
    ])
})

test('repeat stints collapse case-insensitively, first spelling kept', () => {
    assert.deepEqual(
        getWorkHistoryCompanies([
            { company: 'Barstool Sports' },
            { company: 'Homefield Apparel' },
            { company: 'barstool sports' },
            { company: 'BARSTOOL SPORTS' },
            { company: 'SiriusXM' },
        ]),
        ['Barstool Sports', 'Homefield Apparel', 'SiriusXM'],
    )
})

test('blank, missing and non-string company entries are dropped', () => {
    assert.deepEqual(
        getWorkHistoryCompanies([
            { company: '   Barstool Sports  ' },
            { company: '' },
            { company: '   ' },
            { title: 'Head of Brand' },
            { company: null },
            { company: 42 },
            { company: { name: 'Nested Co' } },
            { company: ['Array Co'] },
            null,
            undefined,
            'Homefield Apparel',
            { company: 'SiriusXM' },
        ]),
        ['Barstool Sports', 'SiriusXM'],
    )
})

test('a non-array work-history value yields no companies', () => {
    assert.deepEqual(getWorkHistoryCompanies(undefined), [])
    assert.deepEqual(getWorkHistoryCompanies(null), [])
    assert.deepEqual(getWorkHistoryCompanies([]), [])
    assert.deepEqual(getWorkHistoryCompanies('Barstool Sports'), [])
    assert.deepEqual(getWorkHistoryCompanies({ company: 'Barstool' }), [])
})

test('the previous-company binding resolves to every work-history company', () => {
    assert.deepEqual(
        getCardFieldValue(
            {
                workHistoryCompanies: [
                    'Barstool Sports',
                    'Homefield Apparel',
                    'SiriusXM',
                ],
                previousCompany: 'Barstool Sports',
            },
            'previous-company',
        ),
        ['Barstool Sports', 'Homefield Apparel', 'SiriusXM'],
    )
})

test('the binding falls back to previous-company without work-history', () => {
    assert.equal(
        getCardFieldValue(
            { workHistoryCompanies: [], previousCompany: 'Solo Co' },
            'previous-company',
        ),
        'Solo Co',
    )
    assert.equal(
        getCardFieldValue({ previousCompany: 'Solo Co' }, 'previous-company'),
        'Solo Co',
    )
})

test('a three-company record renders as one joined string', () => {
    const element = createElement({
        'data-quiz-join': 'previous-company',
        'data-quiz-sep': ', ',
    })
    const rendered = renderJoinBinding(element, {
        workHistoryCompanies: getWorkHistoryCompanies(scottBauerWorkHistory),
        previousCompany: 'Barstool Sports',
    })

    assert.equal(
        rendered.textContent,
        'Barstool Sports, Homefield Apparel, SiriusXM',
    )
    assert.equal(rendered.hidden, false)
    assert.deepEqual(rendered.required, [])
})

test('an empty work-history still renders the single previous company', () => {
    const element = createElement({
        'data-quiz-join': 'previous-company',
        'data-quiz-sep': ', ',
    })
    const rendered = renderJoinBinding(element, {
        workHistoryCompanies: getWorkHistoryCompanies([]),
        previousCompany: 'Solo Co',
    })

    assert.equal(rendered.textContent, 'Solo Co')
    assert.equal(rendered.hidden, false)
})

test('a candidate with neither field hides the binding', () => {
    const element = createElement({ 'data-quiz-join': 'previous-company' })
    const rendered = renderJoinBinding(element, {
        workHistoryCompanies: [],
        previousCompany: '',
    })

    assert.equal(rendered.textContent, '')
    assert.equal(rendered.hidden, true)
    assert.equal(rendered.required.length, 1)
})
