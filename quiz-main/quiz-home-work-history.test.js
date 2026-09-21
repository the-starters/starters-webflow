const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-home.js'), 'utf8')

const MANAGED_INDEX = 'Freelancers3.0-production'

function attributeElement(attributes = {}) {
    return {
        attributes: { ...attributes },
        children: [],
        textContent: '',
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name)
                ? this.attributes[name]
                : null
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value)
        },
        replaceChildren(...nodes) {
            this.children = nodes
            this.textContent = nodes.map((node) => node.textContent).join('')
        },
    }
}

function homeCard(id, legacyText, { withImage = true } = {}) {
    const list = attributeElement()
    list.textContent = legacyText
    const image = attributeElement({
        src: `https://cdn.example.test/freelancer-${id}.avif`,
    })
    const card = attributeElement()
    card.querySelector = (selector) => {
        if (selector === '.expert-card_profile-image') {
            return withImage ? image : null
        }
        if (selector === '.expert-card_company-list') return list
        return null
    }
    return { card, list }
}

function flushPromises() {
    return new Promise((resolve) => setImmediate(resolve))
}

async function load({
    histories,
    responseOk = true,
    responseStatus = 200,
    managedConfig = {
        appId: 'APP123',
        searchKey: 'public-search-key',
        indexName: MANAGED_INDEX,
    },
    withImages = true,
}) {
    const cards = Object.keys(histories).map((id) =>
        homeCard(id, 'Legacy company', { withImage: withImages }),
    )
    const requests = []
    const dispatched = []

    const document = {
        readyState: 'complete',
        createElement(tagName) {
            const element = attributeElement()
            element.tagName = tagName.toUpperCase()
            element.className = ''
            return element
        },
        querySelector(selector) {
            if (selector === '[data-quiz-form="home"]') return null
            return null
        },
        querySelectorAll(selector) {
            if (
                selector ===
                '.section_home-consult .expert-card_item.is-consult-home'
            ) {
                return cards.map((entry) => entry.card)
            }
            return []
        },
        addEventListener() {},
    }

    const storage = {
        getItem: () => null,
        removeItem() {},
        setItem() {},
    }
    const window = {
        location: { search: '', href: 'https://www.thestarters.com/' },
        addEventListener() {},
        dispatchEvent(event) {
            dispatched.push(event.type)
            return true
        },
        StartersV3AlgoliaEnvironment: {
            getManagedSearchConfig(resource) {
                if (resource !== 'starters') return null
                return managedConfig
            },
        },
    }
    window.window = window

    const fetch = async (url, options) => {
        requests.push({ url, options })
        return {
            ok: responseOk,
            status: responseStatus,
            json: async () => ({
                results: options
                    ? JSON.parse(options.body).requests.map((request) => ({
                          'work-history': histories[request.objectID],
                      }))
                    : [],
            }),
        }
    }

    vm.runInContext(
        source,
        vm.createContext({
            console: { log() {}, warn() {} },
            CustomEvent: class {
                constructor(type) {
                    this.type = type
                }
            },
            document,
            fetch,
            localStorage: storage,
            sessionStorage: storage,
            URLSearchParams,
            window,
        }),
    )
    await flushPromises()
    await flushPromises()

    return { cards, dispatched, requests }
}

function companiesOf({ list }) {
    return list.children.map((child) => child.textContent)
}

function companyClassesOf({ list }) {
    return list.children.map((child) => `${child.tagName}.${child.className}`)
}

test('Home consult cards render ordered work-history for three, two, one, and empty states', async () => {
    const page = await load({
        histories: {
            101: [
                { company: 'First' },
                { company: 'Second' },
                { company: 'Third' },
            ],
            102: [{ company: 'Alpha' }, { company: 'Beta' }],
            103: [{ company: 'Only' }],
            104: [],
        },
    })

    assert.equal(page.requests.length, 1, 'all cards are fetched in one Algolia request')
    assert.equal(
        page.requests[0].url,
        'https://app123-dsn.algolia.net/1/indexes/*/objects',
    )
    assert.deepEqual(
        JSON.parse(page.requests[0].options.body).requests.map((request) => ({
            indexName: request.indexName,
            objectID: request.objectID,
            attributesToRetrieve: request.attributesToRetrieve,
        })),
        [
            {
                indexName: MANAGED_INDEX,
                objectID: '101',
                attributesToRetrieve: ['work-history'],
            },
            {
                indexName: MANAGED_INDEX,
                objectID: '102',
                attributesToRetrieve: ['work-history'],
            },
            {
                indexName: MANAGED_INDEX,
                objectID: '103',
                attributesToRetrieve: ['work-history'],
            },
            {
                indexName: MANAGED_INDEX,
                objectID: '104',
                attributesToRetrieve: ['work-history'],
            },
        ],
    )
    assert.deepEqual(page.cards.map(companiesOf), [
        ['First', 'Second', 'Third'],
        ['Alpha', 'Beta'],
        ['Only'],
        [],
    ])
    assert.deepEqual(
        page.cards.map(({ list }) => list.textContent),
        ['FirstSecondThird', 'AlphaBeta', 'Only', ''],
        'the legacy CMS company text is gone from every card, populated or empty',
    )
    assert.deepEqual(page.dispatched, ['expert-cards:relayout'])
})

test('each company is its own styled paragraph the expert-card sheet can size', async () => {
    const page = await load({
        histories: { 593: [{ company: 'Xero Shoes' }, { company: 'Parachute Home' }] },
    })

    assert.deepEqual(companyClassesOf(page.cards[0]), [
        'P.expert-card_company-text text-size-small',
        'P.expert-card_company-text text-size-small',
    ])
    assert.deepEqual(companiesOf(page.cards[0]), ['Xero Shoes', 'Parachute Home'])
})

test('invalid work-history entries are omitted without reviving legacy CMS text', async () => {
    const page = await load({
        histories: {
            593: [
                null,
                { company: ' Parachute Home ' },
                { company: '' },
                { company: { name: 'Nike' } },
                { company: 'The Honest Company' },
            ],
        },
    })

    assert.deepEqual(companiesOf(page.cards[0]), [
        'Parachute Home',
        'The Honest Company',
    ])
})

test('repeat stints at one company collapse to the first spelling', async () => {
    const page = await load({
        histories: {
            593: [
                { company: 'Nike', title: 'PM' },
                { company: 'nike', title: 'Sr PM' },
                { company: 'Parachute Home' },
            ],
        },
    })

    assert.deepEqual(companiesOf(page.cards[0]), ['Nike', 'Parachute Home'])
})

test('a failed Algolia request removes the misleading legacy company list', async () => {
    const page = await load({
        histories: { 593: [{ company: 'Parachute Home' }] },
        responseOk: false,
        responseStatus: 503,
    })

    assert.deepEqual(companiesOf(page.cards[0]), [])
    assert.equal(page.cards[0].list.textContent, '')
    assert.deepEqual(page.dispatched, ['expert-cards:relayout'])
})

test('an unresolved managed environment fails closed and still relayouts', async () => {
    const page = await load({
        histories: { 593: [{ company: 'Parachute Home' }] },
        managedConfig: null,
    })

    assert.equal(page.requests.length, 0, 'no request without managed credentials')
    assert.equal(page.cards[0].list.textContent, '')
    assert.deepEqual(page.dispatched, ['expert-cards:relayout'])
})

test('a card with no resolvable profile ID clears its legacy list and relayouts', async () => {
    const page = await load({
        histories: { 593: [{ company: 'Parachute Home' }] },
        withImages: false,
    })

    assert.equal(page.requests.length, 0, 'no request without a profile ID')
    assert.equal(page.cards[0].list.textContent, '')
    assert.deepEqual(page.dispatched, ['expert-cards:relayout'])
})
