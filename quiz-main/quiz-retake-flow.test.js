const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const mainSource = fs.readFileSync(require.resolve('./quiz-main.js'), 'utf8')
const tabsSource = fs.readFileSync(require.resolve('./quiz-tabs.js'), 'utf8')

class TestEvent {
    constructor(type, options = {}) {
        this.type = type
        this.bubbles = Boolean(options.bubbles)
        this.isTrusted = Boolean(options.isTrusted)
        this.defaultPrevented = false
        this.stopped = false
    }

    preventDefault() {
        this.defaultPrevented = true
    }

    stopPropagation() {
        this.stopped = true
    }

    stopImmediatePropagation() {
        this.stopped = true
    }
}

function matchesSimple(element, selector) {
    if (selector.endsWith(':checked')) {
        return element.checked && matchesSimple(element, selector.slice(0, -8))
    }
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0]
    if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false
    for (const match of selector.matchAll(/\.([\w-]+)/g)) {
        if (!element.classList.contains(match[1])) return false
    }
    for (const match of selector.matchAll(/\[([\w-]+)(?:=(['"])(.*?)\2)?\]/g)) {
        if (!element.hasAttribute(match[1])) return false
        if (match[3] !== undefined && element.getAttribute(match[1]) !== match[3]) return false
    }
    return true
}

function matchesSelector(element, selector) {
    return selector.split(',').some((alternative) => {
        const parts = alternative.trim().split(/\s+/)
        if (!matchesSimple(element, parts.pop())) return false
        let ancestor = element.parentElement
        while (parts.length) {
            const part = parts.pop()
            while (ancestor && !matchesSimple(ancestor, part)) ancestor = ancestor.parentElement
            if (!ancestor) return false
            ancestor = ancestor.parentElement
        }
        return true
    })
}

class TestElement {
    constructor(tagName = 'div', attributes = {}) {
        this.tagName = tagName.toUpperCase()
        this.attributes = new Map(Object.entries(attributes))
        this.children = []
        this.parentElement = null
        this.listeners = new Map()
        this.style = { removeProperty: () => {} }
        this.checked = false
        this.disabled = false
        this.textContent = ''
        this.offsetLeft = 0
        this.dataset = new Proxy({}, {
            get: (_, name) => this.getAttribute('data-' + String(name).replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())),
            set: (_, name, value) => {
                this.setAttribute('data-' + String(name).replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()), value)
                return true
            },
        })
        this.classList = {
            contains: (name) => (this.getAttribute('class') || '').split(/\s+/).includes(name),
            toggle: (name, force) => {
                const values = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean))
                const add = force === undefined ? !values.has(name) : force
                if (add) values.add(name)
                else values.delete(name)
                this.setAttribute('class', [...values].join(' '))
            },
        }
    }

    get id() { return this.getAttribute('id') || '' }
    set id(value) { this.setAttribute('id', value) }
    get value() { return this.getAttribute('value') || '' }
    get firstElementChild() { return this.children[0] || null }
    get nextElementSibling() {
        if (!this.parentElement) return null
        return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] || null
    }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    hasAttribute(name) { return this.attributes.has(name) }
    removeAttribute(name) { this.attributes.delete(name) }
    toggleAttribute(name, force) {
        if (force) this.setAttribute(name, '')
        else this.removeAttribute(name)
    }
    append(...children) {
        for (const child of children) {
            child.parentElement = this
            this.children.push(child)
        }
    }
    querySelectorAll(selector) {
        const found = []
        const visit = (node) => {
            for (const child of node.children) {
                if (matchesSelector(child, selector)) found.push(child)
                visit(child)
            }
        }
        visit(this)
        return found
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
    matches(selector) { return matchesSelector(this, selector) }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) {
            if (node.matches(selector)) return node
        }
        return null
    }
    contains(other) { return other === this || other.closest('*')?.parentElement === this || this.querySelectorAll('*').includes(other) }
    addEventListener(type, listener, capture = false) {
        const listeners = this.listeners.get(type) || []
        listeners.push({ listener, capture: capture === true })
        this.listeners.set(type, listeners)
    }
    dispatchEvent(event) {
        event.target = this
        const path = []
        for (let node = this; node; node = node.parentElement) path.unshift(node)
        for (const node of path) {
            for (const entry of node.listeners.get(event.type) || []) {
                if (entry.capture) entry.listener(event)
                if (event.stopped) return !event.defaultPrevented
            }
        }
        for (const node of path.reverse()) {
            for (const entry of node.listeners.get(event.type) || []) {
                if (!entry.capture) entry.listener(event)
                if (event.stopped) return !event.defaultPrevented
            }
        }
        return !event.defaultPrevented
    }
    click() {
        if (!this.disabled) this.dispatchEvent(new TestEvent('click', { bubbles: true }))
    }
    focus() {}
    scrollTo() {}
}

function element(tagName, attributes = {}, children = []) {
    const node = new TestElement(tagName, attributes)
    node.append(...children)
    return node
}

function choice(id, categoryId, label) {
    const input = element('input', { id, type: 'checkbox', value: id })
    const caption = element('span', { class: 'w-form-label' })
    caption.textContent = label
    const wrapper = element('label', categoryId ? { 'data-category': categoryId } : {}, [input, caption])
    return { input, wrapper }
}

function setup({ selected = ['paid-media'], member = { id: 'member-1' }, delayedMember = false } = {}) {
    const document = element('document')
    const storage = new Map()
    const navigations = []
    let resolveMember
    const memberPromise = delayedMember
        ? new Promise((resolve) => { resolveMember = resolve })
        : member === 'unavailable'
          ? Promise.reject(new Error('Memberstack unavailable'))
          : Promise.resolve({ data: member })
    const categoryChoices = [
        choice('paid-media', null, 'Paid Media'),
        choice('branding', null, 'Branding'),
    ]
    for (const entry of categoryChoices) {
        entry.input.setAttribute('data-category-value', '')
        entry.input.checked = selected.includes(entry.input.id)
    }
    const categoryForm = element('form', { 'data-quiz-form': 'categories' }, categoryChoices.map((entry) => entry.wrapper))
    const subcategoryChoices = [
        choice('media-ads', 'paid-media', 'Media Ads'),
        choice('brand-strategy', 'branding', 'Brand Strategy'),
    ]
    const steps = [
        { name: 'needs', button: element('div', { 'data-tab-component': 'button' }), panel: element('div', { 'data-tab-component': 'panel', 'data-tab-content': 'needs', 'data-main-is-categories': '' }, [categoryForm]) },
        ...subcategoryChoices.map(({ input, wrapper }, index) => {
            const category = index === 0 ? 'paid-media' : 'branding'
            const form = element('form', { 'data-quiz-form': 'subcategories' }, [wrapper])
            const panel = element('div', { 'data-tab-component': 'panel', 'data-tab-content': category, 'data-tab-category-link': category, 'data-main-is-subcategories': '' }, [form])
            const button = element('div', { 'data-tab-component': 'button', 'data-tab-subcategory': 'button', 'data-category-link': category })
            if (!selected.includes(category)) {
                panel.setAttribute('data-category-hidden', '')
                button.setAttribute('data-category-hidden', '')
            }
            return { name: category, button, panel, input }
        }),
        { name: 'signup', button: element('div', { 'data-tab-component': 'button' }), panel: element('div', { 'data-tab-component': 'panel', 'data-tab-content': 'signup' }) },
    ]
    const buttonList = element('div', { 'data-tab-component': 'button-list' }, steps.map((step) => step.button))
    const panelList = element('div', { 'data-tab-component': 'panel-list' }, steps.map((step) => step.panel))
    panelList.removeAttribute('role')
    const previous = element('div', { 'data-tab': 'previous' }, [element('button')])
    const next = element('div', { 'data-tab': 'next' }, [element('button')])
    const tabWrap = element('div', { 'data-tab-wrapper': '' }, [buttonList, panelList, previous, next])
    const signupForm = element('form', { 'data-quiz-form': 'signup' })
    document.append(tabWrap, signupForm)
    const window = {
        location: { search: '?retake=true', assign: (path) => navigations.push(path) },
        setTimeout: (callback) => setTimeout(callback, 0),
        addEventListener: () => {},
        $memberstackDom: {
            getCurrentMember: () => memberPromise,
            getMemberJSON: async () => ({ data: {} }),
        },
    }
    const sessionStorage = {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    }
    const context = { window, document, sessionStorage, localStorage: sessionStorage, URLSearchParams, Event: TestEvent, setTimeout, console, location: { search: '', href: 'https://example.com/quiz' }, Date }
    vm.runInNewContext(mainSource, context)
    vm.runInNewContext(tabsSource, context)
    document.dispatchEvent(new TestEvent('DOMContentLoaded'))

    return {
        steps,
        categoryChoices,
        subcategoryChoices,
        next: () => next.querySelector('button').click(),
        nextFromKeyboard: () => next.querySelector('button').dispatchEvent(new TestEvent('click', { bubbles: true })),
        active: () => steps.find((step) => step.panel.classList.contains('is-active'))?.name,
        pending: () => JSON.parse(sessionStorage.getItem('starterQuizPending')),
        navigations,
        resolveMember,
        refreshTabs: () => tabWrap._quizTabController.refresh(),
        settle: () => new Promise((resolve) => setTimeout(resolve, 5)),
    }
}

test('a signed-in Brand completing one selected category reaches results with current answers', async () => {
    const quiz = setup()
    await quiz.settle()
    quiz.next()
    assert.equal(quiz.active(), 'paid-media')
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    await quiz.settle()
    assert.deepEqual(quiz.navigations, ['/quiz-results'])
    assert.equal(quiz.pending().status, 'ready')
    assert.equal(quiz.pending().subcategories[0].id, 'media-ads')
    assert.equal(quiz.active(), 'paid-media')
})

test('a signed-in Brand completes every selected category before results', async () => {
    const quiz = setup({ selected: ['paid-media', 'branding'] })
    await quiz.settle()
    quiz.next()
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    assert.equal(quiz.active(), 'branding')
    assert.deepEqual(quiz.navigations, [])

    quiz.subcategoryChoices[1].input.checked = true
    quiz.subcategoryChoices[1].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    assert.deepEqual(quiz.navigations, ['/quiz-results'])
    assert.deepEqual(Array.from(quiz.pending().subcategories, (entry) => entry.id), ['media-ads', 'brand-strategy'])
})

test('the final step follows a changed category selection', async () => {
    const quiz = setup({ selected: ['paid-media', 'branding'] })
    await quiz.settle()
    quiz.next()
    quiz.categoryChoices[1].input.checked = false
    quiz.categoryChoices[1].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.steps[2].button.setAttribute('data-category-hidden', '')
    quiz.steps[2].panel.setAttribute('data-category-hidden', '')
    quiz.refreshTabs()
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    assert.deepEqual(quiz.navigations, ['/quiz-results'])
    assert.deepEqual(Array.from(quiz.pending().categories, (entry) => entry.id), ['paid-media'])
})

test('an unanswered required category keeps Continue on the current step', async () => {
    const quiz = setup()
    await quiz.settle()
    quiz.next()
    assert.equal(quiz.active(), 'paid-media')
    quiz.next()
    assert.equal(quiz.active(), 'paid-media')
    assert.deepEqual(quiz.navigations, [])
    assert.equal(quiz.pending().status, 'draft')
})

test('keyboard activation of Continue has the same signed-in result', async () => {
    const quiz = setup()
    await quiz.settle()
    quiz.nextFromKeyboard()
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.nextFromKeyboard()
    assert.deepEqual(quiz.navigations, ['/quiz-results'])
})

test('a signed-out visitor enters signup with completed answers saved', async () => {
    const quiz = setup({ member: null })
    await quiz.settle()
    quiz.next()
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    await quiz.settle()
    assert.equal(quiz.active(), 'signup')
    assert.deepEqual(quiz.navigations, [])
    assert.equal(quiz.pending().status, 'ready')
    assert.equal(quiz.pending().subcategories[0].id, 'media-ads')
})

test('a slow membership response keeps signup hidden until the member is known', async () => {
    const quiz = setup({ delayedMember: true })
    quiz.next()
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    assert.equal(quiz.active(), 'paid-media')
    assert.deepEqual(quiz.navigations, [])
    quiz.next()
    quiz.resolveMember({ data: { id: 'member-1' } })
    await quiz.settle()
    assert.deepEqual(quiz.navigations, ['/quiz-results'])
    assert.equal(quiz.pending().status, 'ready')
})

test('a delayed signed-out response resumes signup with the finished answers', async () => {
    const quiz = setup({ delayedMember: true })
    quiz.next()
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    assert.equal(quiz.active(), 'paid-media')
    quiz.resolveMember({ data: null })
    await quiz.settle()
    assert.equal(quiz.active(), 'signup')
    assert.equal(quiz.pending().status, 'ready')
    assert.equal(quiz.pending().subcategories[0].id, 'media-ads')
})

test('an unavailable membership check keeps answers recoverable through signup', async () => {
    const quiz = setup({ member: 'unavailable' })
    await quiz.settle()
    quiz.next()
    quiz.subcategoryChoices[0].input.checked = true
    quiz.subcategoryChoices[0].input.dispatchEvent(new TestEvent('change', { bubbles: true }))
    quiz.next()
    await quiz.settle()
    assert.equal(quiz.active(), 'signup')
    assert.deepEqual(quiz.navigations, [])
    assert.equal(quiz.pending().status, 'ready')
})
