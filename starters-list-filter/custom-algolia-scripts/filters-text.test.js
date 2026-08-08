const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./filters-text.js'), 'utf8')

/**
 * Loads filters-text.js in a DOM-less sandbox and hands back the internals the
 * label pipeline is built from. The file is an IIFE with no exports, so it is
 * run with a stub `document` that never matches anything (init() then does no
 * work) and the functions are re-exposed through an injected tail.
 *
 * @returns {{prettyValue: Function, humanize: Function, ROLE_NAMES: object, SKILL_NAMES: object}}
 */
function loadInternals() {
    const exposed = source.replace(
        /\}\)\(\);?\s*$/,
        'globalThis.__internals = { prettyValue, humanize, ROLE_NAMES, SKILL_NAMES };\n})();',
    )

    assert.notEqual(exposed, source, 'failed to inject the test tail')

    const noop = () => {}
    const context = {
        document: {
            readyState: 'complete',
            body: {},
            querySelectorAll: () => [],
            addEventListener: noop,
        },
        window: {},
        MutationObserver: function MutationObserver() {
            return { observe: noop, disconnect: noop }
        },
        requestAnimationFrame: noop,
    }

    vm.createContext(context)
    vm.runInContext(exposed, context)

    return context.__internals
}

const { prettyValue, humanize, ROLE_NAMES, SKILL_NAMES } = loadInternals()

test('skill slugs resolve to their override display names', () => {
    assert.equal(prettyValue('', 'ab-testing'), 'A/B Testing')
    assert.equal(prettyValue('', 'tiktok-organic'), 'TikTok (Organic)')
    assert.equal(
        prettyValue('', 'conversion-rate-optimization-cro'),
        'Conversion Rate Optimization (CRO)',
    )
    assert.equal(prettyValue('', 'ltv-cac-analysis'), 'LTV / CAC Analysis')
    assert.equal(prettyValue('', 'fp-a'), 'FP&A')
    assert.equal(prettyValue('', 'sql'), 'SQL')
})

test('unmapped skill slugs still humanize', () => {
    assert.equal(prettyValue('', 'campaign-strategy'), 'Campaign Strategy')
    assert.equal(prettyValue('', 'email-marketing'), 'Email Marketing')
})

test('role overrides keep working alongside the skill map', () => {
    assert.equal(prettyValue('', 'ui-ux-designer'), 'UI/UX Designer')
    assert.equal(prettyValue('', 'cro-expert'), 'CRO Expert')
    assert.equal(prettyValue('', 'e-commerce-manager'), 'E-Commerce Manager')
})

// The file rewrites the SAME nodes on every engine response. A display value
// that does not map back to itself makes the label oscillate on each pass,
// which is invisible in a single render and obvious in production.
test('every emitted display name is a fixed point of the pipeline', () => {
    for (const map of [ROLE_NAMES, SKILL_NAMES]) {
        for (const slug of Object.keys(map)) {
            const display = map[slug]
            assert.equal(
                prettyValue('', display),
                display,
                `"${display}" (from "${slug}") does not survive a second pass`,
            )
        }
    }
})

test('no slug is claimed by both the role map and the skill map', () => {
    const collisions = Object.keys(SKILL_NAMES).filter(
        (slug) => slug in ROLE_NAMES,
    )
    assert.deepEqual(collisions, [])
})

test('rate and numeric bucket values are left alone', () => {
    assert.equal(prettyValue('rate', '$30 – $500'), '$30 – $500')
    assert.equal(prettyValue('', '1-10'), '1–10')
})

test('humanize is what mangles bare acronyms, so the map has to cover them', () => {
    // Guards the premise: if humanize ever learns acronyms, these entries
    // become redundant rather than load-bearing.
    assert.equal(humanize('ab-testing'), 'Ab Testing')
    assert.equal(humanize('sql'), 'Sql')
})
