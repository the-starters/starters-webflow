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
        else if (source[i] === '}' && --depth === 0) {
            const isAsync = source.slice(start - 6, start) === 'async '
            return source.slice(isAsync ? start - 6 : start, i + 1)
        }
    }
    throw new Error(`unbalanced function: ${name}`)
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


test('the recommendation search requests the agency fields the card template binds', async () => {
    const requests = []
    const sandbox = {
        recommendedFreelancerCandidateLimit: 100,
        window: {
            StartersV3AlgoliaEnvironment: {
                getManagedSearchConfig: () => ({
                    appId: 'APP',
                    searchKey: 'KEY',
                    indexName: 'starters',
                }),
            },
        },
        fetch: async (url, init) => {
            requests.push({ url, body: JSON.parse(init.body) })
            return { ok: true, json: async () => ({ hits: [{ objectID: '314' }] }) }
        },
    }
    vm.createContext(sandbox)
    vm.runInContext(
        ['normalize', 'getAlgoliaSearchConfig', 'searchRecommendedFreelancers']
            .map(extractFunction)
            .concat('this.search = searchRecommendedFreelancers')
            .join('\n'),
        sandbox,
    )

    const hits = await sandbox.search('paid media')

    assert.equal(hits.length, 1)
    assert.equal(requests.length, 1)
    const attributes = requests[0].body.attributesToRetrieve
    assert.ok(attributes.includes('is-agency'), 'is-agency drives the agency branch')
    assert.ok(attributes.includes('agency-name'), 'agency-name is shown on agency cards')
    assert.ok(attributes.includes('retainer-rate'), 'retainer-rate is the agency monthly price')
})

// Fallback searches run in parallel; whichever resolves first must not decide
// where a shared Starter lands. The earliest category always gets them.
test('category fallbacks assign a shared Starter to the earliest category, whatever order the searches resolve', async () => {
    const resolvers = {}
    const sandbox = {
        categoryFreelancerLimit: 2,
        getCategoryRecommendationQuery: (category) => category.id,
        searchRecommendedFreelancers: (query) =>
            new Promise((resolve) => {
                resolvers[query] = resolve
            }),
        getRecommendedFreelancerCandidates: (hits) => hits,
        getUniqueRecommendedFreelancerCandidates: (candidates) => candidates,
        orderRecommendedFreelancerCandidates: (candidates) =>
            [...candidates].sort((a, b) => b.rankingPoints - a.rankingPoints),
        createRecommendationIssue: (code, message, details) => ({ code, message, details }),
    }
    vm.createContext(sandbox)
    vm.runInContext(
        ['getTopRecommendedFreelancers', 'addCategoryFallbackRecommendations']
            .map(extractFunction)
            .concat('this.addFallbacks = addCategoryFallbackRecommendations')
            .join('\n'),
        sandbox,
    )

    const group = (id, recommendations = []) => ({
        category: { id, label: id },
        query: id,
        queries: [],
        recommendations,
    })
    const groups = [group('paid-media'), group('brand'), group('full', [candidate('x'), candidate('y')])]
    const shown = new Set(['featured-1'])
    const issues = []
    const pending = sandbox.addFallbacks(groups, shown, issues)

    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(Object.keys(resolvers).sort(), ['brand', 'paid-media'])
    resolvers.brand([candidate('scott', 90), candidate('b', 40), candidate('featured-1', 99)])
    await new Promise((resolve) => setImmediate(resolve))
    resolvers['paid-media']([candidate('scott', 90), candidate('a', 50)])
    const results = await pending

    assert.deepEqual(groups[0].recommendations.map((x) => x.objectID), ['scott', 'a'])
    assert.deepEqual(groups[1].recommendations.map((x) => x.objectID), ['b'])
    assert.deepEqual(groups[2].recommendations.map((x) => x.objectID), ['x', 'y'])
    assert.equal(results[2], null)
    assert.deepEqual([...shown].sort(), ['a', 'b', 'featured-1', 'scott'])
    assert.equal(issues.length, 0)
})

// Live finding, 2026-11-10: the published quiz category card binds only
// `rate` next to a fixed "/hr" (no is-agency branch), so Scott Bauer (314)
// still rendered "$5000/hr". The controller must rewrite that line.
function fakeElement(attributes = {}, text = '', children = []) {
    const classes = new Set()
    const element = {
        attributes: { ...attributes },
        textContent: text,
        children,
        parentElement: null,
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name),
        },
        getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
        setAttribute: (name, value) => {
            element.attributes[name] = String(value)
        },
        querySelectorAll(selector) {
            const wanted = selector.split(',').map((part) => {
                const match = part.trim().match(/^\[([\w-]+)="([^"]*)"\]$/)
                return { name: match[1], value: match[2] }
            })
            const found = []
            const walk = (node) => {
                node.children.forEach((child) => {
                    if (wanted.some((w) => child.attributes[w.name] === w.value)) found.push(child)
                    walk(child)
                })
            }
            walk(element)
            return found
        },
    }
    children.forEach((child) => {
        child.parentElement = element
    })
    return element
}

// Mirrors the price lines inside [data-quiz-card] on the published /quiz-results.
function quizCard() {
    const rate = fakeElement({ 'wf-algolia-text': 'rate' }, '750')
    const suffix = fakeElement({}, '/hr')
    const consultRate = fakeElement({ 'wf-algolia-text': 'rate' }, '750')
    const consultSuffix = fakeElement({}, '/Session')
    const card = fakeElement({}, '', [
        fakeElement({ 'wf-algolia-if': "profile-type === 'Consult'" }, '', [
            fakeElement({}, 'From'),
            fakeElement({}, '', [fakeElement({}, '$'), consultRate]),
            consultSuffix,
        ]),
        fakeElement({ 'wf-algolia-if': "profile-type !== 'Consult'" }, '', [
            fakeElement({}, '$'),
            rate,
            suffix,
        ]),
    ])
    return { card, rate, suffix, consultRate, consultSuffix }
}

const labelContext = {}
vm.createContext(labelContext)
vm.runInContext(
    [
        'normalize',
        'stripHtml',
        'getRankingPoints',
        'getLockedDisplayName',
        'isEmptyCardValue',
        'getAgencyMonthlyRate',
        'formatCardValue',
        'setCardText',
        'bindAgencyRateLabel',
    ]
        .map(extractFunction)
        .concat('this.bindAgencyRateLabel = bindAgencyRateLabel')
        .join('\n'),
    labelContext,
)

test('an agency quiz card shows its monthly price with /mo instead of the rate with /hr', () => {
    const { card, rate, suffix, consultRate, consultSuffix } = quizCard()
    rate.textContent = '5000'
    labelContext.bindAgencyRateLabel(card, scott)

    assert.equal(rate.textContent, '3500')
    assert.equal(suffix.textContent, '/mo')
    assert.equal(consultRate.textContent, '750')
    assert.equal(consultSuffix.textContent, '/Session')
})

test('a reused agency card goes back to /hr for a non-agency Starter', () => {
    const { card, rate, suffix } = quizCard()
    labelContext.bindAgencyRateLabel(card, scott)
    rate.textContent = '150'
    labelContext.bindAgencyRateLabel(card, { ...scott, 'is-agency': false, hourlyRate: 150 })

    assert.equal(rate.textContent, '150')
    assert.equal(suffix.textContent, '/hr')
})

test('an agency with no retainer shows the shared rate as its monthly price', () => {
    const { card, rate, suffix } = quizCard()
    labelContext.bindAgencyRateLabel(card, { ...scott, retainerRate: null })

    assert.equal(rate.textContent, '5000')
    assert.equal(suffix.textContent, '/mo')
})
