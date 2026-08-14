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

// The real helpers the anchor code depends on, not stand-ins.
const normalizeSource = sliceSource(
    'function normalize(value) {',
    'function slugify(value)',
)
const slugifySource = sliceSource(
    'function slugify(value) {',
    'function getQuizTaxonomyItemId',
)
const anchorSource = sliceSource(
    'function getTocScrollOffset()',
    '/**\n     * Normalizes array-like Algolia attributes',
)

/**
 * Minimal element for the selectors and attributes the anchor code touches.
 */
class FakeElement {
    constructor(attrs = {}, children = []) {
        this.attrs = { ...attrs }
        this.children = children
        this.parent = null
        children.forEach((child) => {
            child.parent = this
        })
        this.offsetHeight = attrs.offsetHeight || 0
    }

    get id() {
        return this.attrs.id || ''
    }

    getAttribute(name) {
        return this.attrs[name] === undefined ? null : this.attrs[name]
    }

    setAttribute(name, value) {
        this.attrs[name] = String(value)
    }

    get firstElementChild() {
        return this.children[0] || null
    }

    getBoundingClientRect() {
        return { top: this.attrs.rectTop || 0 }
    }

    closest(selector) {
        if (selector !== '[data-toc-algolia-link] a[href^="#"]') return null
        const href = this.getAttribute('href')
        const isHashLink =
            this.attrs.tag === 'a' && typeof href === 'string' &&
            href.startsWith('#')
        if (!isHashLink) return null
        let node = this.parent
        while (node) {
            if (node.getAttribute('data-toc-algolia-link') !== null) return this
            node = node.parent
        }
        return null
    }
}

/**
 * Builds the document/window pair the anchor code queries.
 *
 * @param {FakeElement[]} sections [data-toc-algolia-target] wrappers.
 * @param {FakeElement | null} navbar Optional .w-nav element.
 * @param {string} hash window.location.hash value.
 * @param {FakeElement[]} extraElements Other page elements that may own ids.
 * @returns {{context: object, listeners: object, scrolls: object[], pushes: string[]}}
 */
function buildDom(sections, navbar, hash = '', extraElements = []) {
    const listeners = {}
    const scrolls = []
    const pushes = []

    const allElements = []
    const collect = (element) => {
        allElements.push(element)
        element.children.forEach(collect)
    }
    sections.forEach(collect)
    if (navbar) collect(navbar)
    extraElements.forEach(collect)

    const context = {
        result: null,
        document: {
            querySelectorAll(selector) {
                assert.equal(selector, '[data-toc-algolia-target]')
                return sections
            },
            querySelector(selector) {
                assert.equal(selector, '.w-nav')
                return navbar
            },
            getElementById(id) {
                return (
                    allElements.find((element) => element.id === id) || null
                )
            },
            addEventListener(type, handler) {
                listeners[type] = handler
            },
        },
        window: {
            scrollY: 100,
            location: { hash },
            history: {
                pushState(state, title, url) {
                    pushes.push(url)
                },
            },
            getComputedStyle(element) {
                return { position: element.attrs.position || 'static' }
            },
            scrollTo(options) {
                scrolls.push(options)
            },
        },
        logQuizFlow() {},
    }

    vm.createContext(context)
    vm.runInContext(
        [
            normalizeSource,
            slugifySource,
            anchorSource,
            'this.result = { syncTocAnchorNavigation, scrollToInitialTocHash }',
        ].join('\n'),
        context,
    )

    return { context, listeners, scrolls, pushes }
}

function makeSection(target, childAttrs = {}) {
    return new FakeElement({ 'data-toc-algolia-target': target }, [
        new FakeElement(childAttrs),
    ])
}

test('stamps slugified section ids on the first boxed child', () => {
    const paid = makeSection('paid-media')
    const finance = makeSection('Finance')
    const { context } = buildDom([paid, finance], null)

    context.result.syncTocAnchorNavigation()

    assert.equal(paid.firstElementChild.id, 'paid-media')
    assert.equal(finance.firstElementChild.id, 'finance')
})

test('never overwrites an existing different id', () => {
    const section = makeSection('paid-media', { id: 'keep-me' })
    const { context } = buildDom([section], null)

    context.result.syncTocAnchorNavigation()

    assert.equal(section.firstElementChild.id, 'keep-me')
})

test('TOC link click scrolls with the sticky navbar offset', () => {
    const section = makeSection('paid-media', { rectTop: 500 })
    const link = new FakeElement({ tag: 'a', href: '#paid-media' })
    new FakeElement({ 'data-toc-algolia-link': 'paid-media' }, [link])
    const navbar = new FakeElement({
        position: 'sticky',
        offsetHeight: 66,
    })
    const { context, listeners, scrolls, pushes } = buildDom(
        [section],
        navbar,
    )

    context.result.syncTocAnchorNavigation()

    let prevented = false
    listeners.click({
        target: link,
        preventDefault() {
            prevented = true
        },
    })

    assert.equal(prevented, true)
    // 500 (rect top) + 100 (scrollY) - 66 (navbar) - 16 (breathing room)
    assert.equal(scrolls.length, 1)
    assert.equal(scrolls[0].top, 518)
    assert.equal(scrolls[0].behavior, 'smooth')
    assert.equal(pushes.length, 1)
    assert.equal(pushes[0], '#paid-media')
})

test('clicks fall through when the matching id was not stamped', () => {
    const section = makeSection('paid-media', { id: 'keep-me' })
    const unrelatedElement = new FakeElement({ id: 'paid-media' })
    const link = new FakeElement({ tag: 'a', href: '#paid-media' })
    new FakeElement({ 'data-toc-algolia-link': 'paid-media' }, [link])
    const { context, listeners, scrolls } = buildDom(
        [section],
        null,
        '',
        [unrelatedElement],
    )

    context.result.syncTocAnchorNavigation()

    let prevented = false
    listeners.click({
        target: link,
        preventDefault() {
            prevented = true
        },
    })

    assert.equal(prevented, false)
    assert.equal(scrolls.length, 0)
})

test('a deep-link hash scrolls after rendering settles', () => {
    const section = makeSection('paid-media', { rectTop: 300 })
    const { context, scrolls } = buildDom([section], null, '#paid-media')

    context.result.syncTocAnchorNavigation()
    assert.equal(scrolls.length, 0)

    section.firstElementChild.attrs.rectTop = 500
    context.result.scrollToInitialTocHash()

    assert.equal(scrolls.length, 1)
    assert.equal(scrolls[0].top, 584)
    assert.equal(scrolls[0].behavior, 'smooth')
})
