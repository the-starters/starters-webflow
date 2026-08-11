const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')

function getLeadDripApi() {
    const start = source.indexOf('function normalizeQuizLeadDripText(')
    const end = source.indexOf('async function getQuizLeadDripToken(', start)

    assert.notEqual(start, -1)
    assert.notEqual(end, -1)

    return vm.runInNewContext(
        [
            source.slice(start, end),
            '({',
            '  getQuizLeadDripFirstName,',
            '  normalizeQuizLeadDripStarter,',
            '  normalizeQuizLeadDripLearnItem,',
            '  createQuizLeadDripProperties,',
            '})',
        ].join('\n'),
        { URL },
    )
}

test('emits first names only for every Starter event property', () => {
    const { createQuizLeadDripProperties } = getLeadDripApi()
    const properties = createQuizLeadDripProperties(
        {
            updatedAt: '2026-08-11T04:00:00.000Z',
            categories: [{ id: 'creative' }],
            subcategories: [{ id: 'brand' }],
        },
        {
            featuredFreelancers: [
                {
                    objectID: 'starter-1',
                    name: 'Alex Morgan',
                    slug: 'alex-morgan',
                    roles: ['Creative Director'],
                },
                {
                    objectID: 'starter-2',
                    first_name: 'Sam',
                    name: 'Sam Rivera',
                    slug: 'sam-rivera',
                },
            ],
            recommendationGroups: [],
        },
        null,
    )

    assert.equal(properties.starter_1_first_name, 'Alex')
    assert.equal(properties.starter_2_first_name, 'Sam')
    assert.equal(properties.starter_count, '2')
    assert.equal(properties.learn_count, '0')
    assert.equal(properties.learn_title, 'Explore more expert guidance')
    assert.equal(
        properties.learn_url,
        'https://thestarters.com/learn?source=quiz-results-email',
    )
})

test('sanitizes visible text and rejects non-Starters profile links', () => {
    const { normalizeQuizLeadDripStarter } = getLeadDripApi()
    const starter = normalizeQuizLeadDripStarter({
        name: '<script>Jamie Lee</script>',
        url: 'https://evil.example/hire/jamie',
        tagline: '<b>Operator</b>',
        services: [{ name: '<i>Strategy</i>' }],
    })

    assert.equal(starter.first_name, 'Jamie')
    assert.equal(starter.url, '')
    assert.equal(starter.summary, 'Operator')
    assert.deepEqual(Array.from(starter.services), ['Strategy'])
})

test('accepts one public Learn item and preserves the zero-Learn alternative', () => {
    const { normalizeQuizLeadDripLearnItem, createQuizLeadDripProperties } =
        getLeadDripApi()
    const learn = normalizeQuizLeadDripLearnItem({
        hit: {
            title: 'Build a better brief',
            description: 'A practical guide.',
            url: '/learn/better-brief',
        },
    })

    assert.equal(learn.url, 'https://thestarters.com/learn/better-brief')

    const baseQuiz = {
        updatedAt: '2026-08-11T04:00:00.000Z',
        categories: [],
        subcategories: [],
    }
    const baseRecommendations = {
        featuredFreelancers: [
            { objectID: '1', name: 'Avery Chen', slug: 'avery-chen' },
        ],
        recommendationGroups: [],
    }
    const withLearn = createQuizLeadDripProperties(
        baseQuiz,
        baseRecommendations,
        learn,
    )
    const withoutLearn = createQuizLeadDripProperties(
        baseQuiz,
        baseRecommendations,
        null,
    )

    assert.equal(withLearn.learn_count, '1')
    assert.equal(withLearn.learn_title, 'Build a better brief')
    assert.equal(withoutLearn.learn_count, '0')
    assert.equal(withoutLearn.learn_title, 'Explore more expert guidance')
})
