const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')

function getAlgoliaConfigSource() {
    const start = source.indexOf('function getAlgoliaSearchConfig()')
    const end = source.indexOf(
        '/**\n     * Searches Algolia for recommendation candidates',
        start,
    )

    assert.notEqual(start, -1, 'getAlgoliaSearchConfig should exist')
    assert.notEqual(end, -1, 'search config function boundary should exist')

    return source.slice(start, end)
}

test('freelancer recommendations ignore unrelated WF-Algolia wrappers', () => {
    const configSource = getAlgoliaConfigSource()

    assert.doesNotMatch(configSource, /querySelector\('\[wf-algolia-index\]'\)/)
    assert.doesNotMatch(configSource, /wfAlgoliaIndexElement/)
    assert.match(
        configSource,
        /algoliaDefaultIndexName[\s\S]*?\n\s*}/,
        'the freelancer index default should remain the final fallback',
    )
})

test('supports a dedicated quiz-results index override without an app-id override', () => {
    const configSource = getAlgoliaConfigSource()

    assert.match(configSource, /\[data-starter-quiz-algolia-index-name\]/)
    assert.match(configSource, /\[data-algolia-index-name\]/)
    assert.match(
        configSource,
        /explicitElement\?\.dataset\.starterQuizAlgoliaIndexName/,
    )
    assert.match(configSource, /explicitElement\?\.dataset\.algoliaIndexName/)
})
