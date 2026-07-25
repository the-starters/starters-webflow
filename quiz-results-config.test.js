const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

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

function getAlgoliaConfig(document, window = {}) {
    return vm.runInNewContext(
        [
            "const algoliaDefaultAppId = 'default-app-id'",
            "const algoliaDefaultIndexName = 'Freelancers3.0-dev'",
            'function normalize(value) {',
            "    return String(value || '').trim()",
            '}',
            getAlgoliaConfigSource(),
            'getAlgoliaSearchConfig()',
        ].join('\n'),
        { document, window },
    )
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

test('uses an index-only override after an earlier credentials element', () => {
    const credentialsSelector =
        '[data-starter-quiz-algolia-app-id], [data-algolia-app-id]'
    const indexSelector =
        '[data-starter-quiz-algolia-index-name], [data-algolia-index-name]'
    const config = getAlgoliaConfig({
        querySelector(selector) {
            if (selector === credentialsSelector) {
                return {
                    dataset: {
                        starterQuizAlgoliaAppId: 'configured-app-id',
                        starterQuizAlgoliaSearchKey: 'configured-search-key',
                    },
                }
            }

            if (selector === indexSelector) {
                return {
                    dataset: {
                        starterQuizAlgoliaIndexName: 'configured-index-name',
                    },
                }
            }

            return null
        },
    })

    assert.deepEqual({ ...config }, {
        appId: 'configured-app-id',
        searchKey: 'configured-search-key',
        indexName: 'configured-index-name',
    })
})
