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

// The real helper, not a stand-in: production normalize() only accepts strings.
const normalizeSource = [
    'function normalize(value) {',
    "    return (value || '').trim()",
    '}',
].join('\n')

const roleNamesSource = sliceSource(
    'function formatSlugTitle(slug)',
    '/**\n     * Converts text into a URL-style slug',
)

const context = { result: null }
vm.createContext(context)
vm.runInContext(
    [normalizeSource, roleNamesSource, 'this.result = { formatRoleName, formatSlugTitle, ROLE_NAMES }'].join(
        '\n',
    ),
    context,
)

const { formatRoleName, formatSlugTitle, ROLE_NAMES } = context.result

test('acronym role slugs resolve to their display names', () => {
    assert.equal(formatRoleName('ui-ux-designer'), 'UI/UX Designer')
    assert.equal(formatRoleName('cro-expert'), 'CRO Expert')
    assert.equal(formatRoleName('seo-marketer'), 'SEO Marketer')
    assert.equal(formatRoleName('e-commerce-manager'), 'E-Commerce Manager')
    assert.equal(formatRoleName('pr-directors'), 'PR Director')
})

test('unmapped role slugs still fall back to title case', () => {
    assert.equal(formatRoleName('social-media-manager'), 'Social Media Manager')
    assert.equal(formatRoleName('content-marketer'), 'Content Marketer')
})

test('an empty or missing role yields an empty string, not a crash', () => {
    assert.equal(formatRoleName(''), '')
    assert.equal(formatRoleName(null), '')
    assert.equal(formatRoleName(undefined), '')
})

test('lookup is case and whitespace tolerant', () => {
    assert.equal(formatRoleName('  CRO-Expert  '), 'CRO Expert')
})

// The bug this file exists to prevent: the quiz page used to bind
// formatSlugTitle directly, which title-cases each word and turns every
// acronym role into "Cro Expert".
test('the recommendation binding uses formatRoleName, not formatSlugTitle', () => {
    assert.match(
        source,
        /roles: normalizeAlgoliaList\(hit\.roles\)\.map\(formatRoleName\),/,
        'card roles must resolve through the ROLE_NAMES override map',
    )
})

test('every mapped role is one plain title-casing would have broken', () => {
    // If a slug already title-cases correctly, the entry is dead weight and
    // belongs out of the map (and out of the four files it is synced with).
    for (const slug of Object.keys(ROLE_NAMES)) {
        assert.notEqual(
            formatSlugTitle(slug),
            ROLE_NAMES[slug],
            `"${slug}" does not need an override`,
        )
    }
})
