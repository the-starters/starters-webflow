const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')

/**
 * Extracts one named function declaration from the controller source by
 * matching its braces, so the real code (not a stand-in) runs in the test.
 *
 * @param {string} name Function name.
 * @returns {string} The function's source text.
 */
function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`)
    assert.notEqual(start, -1, `missing function: ${name}`)
    const open = source.indexOf('{', source.indexOf(')', start))
    let depth = 0
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
    }
    throw new Error(`unbalanced function: ${name}`)
}

/**
 * Evaluates the `attributesToRetrieve` array of the Starter recommendation
 * search (the request contract the card template depends on).
 *
 * @returns {string[]} Requested Algolia attributes.
 */
function readRecommendationAttributes() {
    const anchor = "attributesToRetrieve: [\n                        'name',"
    const start = source.indexOf(anchor)
    assert.notEqual(start, -1, 'missing recommendation attributesToRetrieve')
    const open = source.indexOf('[', start)
    const close = source.indexOf(']', open)
    return vm.runInNewContext(source.slice(open, close + 1))
}

const context = { result: null }
vm.createContext(context)
vm.runInContext(
    [
        'normalize',
        'getRankingPoints',
        'formatRateValue',
        'getQueryTierRank',
        'compareByTierThenPoints',
        'draftRoundRobin',
        'draftUnshownRecommendations',
        'getLockedDisplayName',
        'getFirstName',
        'getCardFieldValue',
        'isEmptyCardValue',
        'getAgencyMonthlyRate',
    ]
        .map(extractFunction)
        .concat(
            'this.result = { draftUnshownRecommendations, getCardFieldValue, getAgencyMonthlyRate, formatRateValue }',
        )
        .join('\n'),
    context,
)

const { draftUnshownRecommendations, getCardFieldValue, getAgencyMonthlyRate, formatRateValue } =
    context.result

const candidate = (objectID, rankingPoints = 0) => ({
    objectID,
    name: 'Starter ' + objectID,
    rankingPoints,
})

// Jai, 2026-11-10: "Scott" showed under Paid Media and again under
// Marketing Strategy & Brand. One card per person.
test('a Starter shown in one category is not shown again in a later category', () => {
    const shown = new Set(['featured-1'])
    const paidMedia = draftUnshownRecommendations(
        [[candidate('scott', 90), candidate('a', 50)]],
        2,
        shown,
    )
    const brand = draftUnshownRecommendations(
        [[candidate('scott', 90), candidate('featured-1', 80), candidate('b', 40), candidate('c', 30)]],
        2,
        shown,
    )

    assert.deepEqual(Array.from(paidMedia, (x) => x.objectID), ['scott', 'a'])
    assert.deepEqual(Array.from(brand, (x) => x.objectID), ['b', 'c'])
    assert.deepEqual([...shown].sort(), ['a', 'b', 'c', 'featured-1', 'scott'])
})

test('a category with only already-shown Starters returns no duplicates', () => {
    const shown = new Set(['scott'])
    assert.equal(draftUnshownRecommendations([[candidate('scott', 90)]], 3, shown).length, 0)
})

// Jai, 2026-11-10: an agency's monthly figure showed as an hourly rate.
// Agencies (is-agency true) show the retainer as their monthly price.
const scott = {
    objectID: '314',
    name: 'Scott Bauer',
    'is-agency': true,
    hourlyRate: 5000,
    rate: 5000,
    retainerRate: '3500',
}

test('an agency card binds the retainer as its monthly price', () => {
    assert.equal(getCardFieldValue(scott, 'retainer-rate'), '3500')
    assert.equal(getAgencyMonthlyRate(scott), '3500')
    assert.equal(formatRateValue(getAgencyMonthlyRate(scott), '/mo'), '$3,500/mo')
})

test('an agency with no retainer falls back to the shared rate field', () => {
    const noRetainer = { ...scott, retainerRate: '' }
    assert.equal(getCardFieldValue(noRetainer, 'retainer-rate'), 5000)
    assert.equal(getAgencyMonthlyRate({ ...scott, retainerRate: null, hourlyRate: 0, rate: 0 }), null)
})

test('a non-agency card keeps its own retainer value and hourly rate', () => {
    const freelancer = { ...scott, 'is-agency': false, hourlyRate: 150, rate: 150, retainerRate: '' }
    assert.equal(getCardFieldValue(freelancer, 'retainer-rate'), '')
    assert.equal(getCardFieldValue(freelancer, 'rate'), 150)
})

test('the recommendation search requests the agency fields the card template binds', () => {
    const attributes = readRecommendationAttributes()
    assert.ok(attributes.includes('is-agency'), 'is-agency drives the agency branch')
    assert.ok(attributes.includes('agency-name'), 'agency-name is shown on agency cards')
    assert.ok(attributes.includes('retainer-rate'))
})
