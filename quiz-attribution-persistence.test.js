const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-results.js'), 'utf8')

function sliceSource(startText, endText) {
    const start = source.indexOf(startText)
    const end = source.indexOf(endText, start)

    assert.notEqual(start, -1, `missing source start: ${startText}`)
    assert.notEqual(end, -1, `missing source end: ${endText}`)

    return source.slice(start, end)
}

function getAttributionApi(cookie) {
    const attributionSource = sliceSource(
        'const attributionCookieFieldIds = {',
        '/**\n     * Saves a short starter quiz summary',
    )

    return vm.runInNewContext(
        [
            "function normalize(value) { return (value || '').trim() }",
            'function logQuizFlow() {}',
            attributionSource,
            '({ getCookieValue, getAttributionCustomFields })',
        ].join('\n'),
        { document: { cookie } },
    )
}

function getSaveQuizCustomFieldSource() {
    return sliceSource(
        'async function saveQuizCustomField(memberstack, starterQuiz) {',
        '/**\n     * Persists quiz data to the logged-in Memberstack member.',
    )
}

test('every attribution cookie maps to its verified Memberstack field ID', () => {
    const { getAttributionCustomFields } = getAttributionApi(
        [
            'utm_source=facebook',
            'utm_campaign=spring-launch',
            'utm_adset=adset-a',
            'utm_content=creative-3',
            'fbclid=abc123',
            'fbc=fb.1.1700000000.abc123',
            'fbp=fb.1.1700000000.987654321',
            'event_id=evt-42',
        ].join('; '),
    )

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': 'facebook',
        'utm-campaign': 'spring-launch',
        'utm-adset': 'adset-a',
        'utm-content': 'creative-3',
        fbclid: 'abc123',
        fbc: 'fb.1.1700000000.abc123',
        fbp: 'fb.1.1700000000.987654321',
        'event-id': 'evt-42',
    })
})

test('event_id becomes the hyphenated event-id field ID', () => {
    const { getAttributionCustomFields } = getAttributionApi('event_id=evt-99')
    const customFields = { ...getAttributionCustomFields() }

    assert.equal(customFields['event-id'], 'evt-99')
    assert.equal(
        Object.prototype.hasOwnProperty.call(customFields, 'event_id'),
        false,
        'the raw cookie name must never be sent as a field ID',
    )
})

test('absent and empty cookies are omitted instead of blanking fields', () => {
    const { getAttributionCustomFields } = getAttributionApi(
        'utm_source=facebook; utm_campaign=; fbclid=   ; fbp=fb.1.2.3',
    )

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': 'facebook',
        fbp: 'fb.1.2.3',
    })
})

test('unrelated cookies never leak into the custom fields payload', () => {
    const { getAttributionCustomFields } = getAttributionApi(
        '_ga=GA1.1.123; utm_source_extra=nope; session=abc; utm_source=google',
    )

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': 'google',
    })
})

test('URL-encoded cookie values are decoded before saving', () => {
    const { getCookieValue, getAttributionCustomFields } = getAttributionApi(
        'utm_campaign=spring%20launch%20%2B%20promo; utm_content=a%2Fb',
    )

    assert.equal(getCookieValue('utm_campaign'), 'spring launch + promo')
    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-campaign': 'spring launch + promo',
        'utm-content': 'a/b',
    })
})

test('a malformed percent escape falls back to the raw cookie value', () => {
    const { getAttributionCustomFields } = getAttributionApi('utm_source=100%')

    assert.deepEqual({ ...getAttributionCustomFields() }, {
        'utm-source': '100%',
    })
})

test('with no attribution cookies the payload is empty', () => {
    const { getAttributionCustomFields } = getAttributionApi('')

    assert.deepEqual({ ...getAttributionCustomFields() }, {})
    assert.equal(Object.keys(getAttributionCustomFields()).length, 0)
})

test('starter-quiz survives the attribution merge in updateMember', () => {
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(
        saveSource,
        /customFields:\s*\{\s*\.\.\.attributionCustomFields,\s*'starter-quiz': customFieldValue,/,
        'starter-quiz must be written after the attribution spread',
    )
    assert.equal(
        (saveSource.match(/updateMember\(/g) || []).length,
        1,
        'attribution must ride along in the single existing updateMember call',
    )
})

test('a failed attribution read still saves starter-quiz alone', () => {
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(
        saveSource,
        /try \{\s*attributionCustomFields = getAttributionCustomFields\(\)\s*\} catch/,
        'the attribution read must be wrapped so it cannot throw',
    )
    assert.match(
        saveSource.slice(saveSource.indexOf('} catch')),
        /attributionCustomFields = \{\}/,
        'the catch branch must degrade to an empty attribution payload',
    )
})

test('diagnostics log attribution field IDs but not their values', () => {
    const saveSource = getSaveQuizCustomFieldSource()

    assert.match(
        saveSource,
        /attributionFieldIds: Object\.keys\(attributionCustomFields\)/,
        'logs should carry field IDs only',
    )
    assert.doesNotMatch(
        saveSource,
        /attributionCustomFields,\n\s*\}\)\n\s*\}/,
        'the raw attribution values must not be logged',
    )
})
