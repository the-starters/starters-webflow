const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./quiz-home.js'), 'utf8')

function attributeElement(attributes = {}) {
    return {
        attributes: { ...attributes },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name)
                ? this.attributes[name]
                : null
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value)
        },
    }
}

function homeCard(id, legacyText) {
    const list = attributeElement()
    list.textContent = legacyText
    const image = attributeElement({
        src: `https://cdn.example.test/freelancer-${id}.avif`,
    })
    const card = attributeElement()
    card.querySelector = (selector) => {
        if (selector === '.expert-card_profile-image') return image
        if (selector === '.expert-card_company-list') return list
        return null
    }
    return { card, list }
}

function flushPromises() {
    return new Promise((resolve) => setImmediate(resolve))
}

async function load({ histories, responseOk = true, responseStatus = 200 }) {
    const cards = Object.keys(histories).map((id) => homeCard(id, 'Legacy company'))
    const section = attributeElement()
    const client = attributeElement({
        'data-app-id': 'APP123',
        'data-search-key': 'public-search-key',
    })
    const resource = attributeElement({
        'wf-algolia-index': 'Freelancers3.0-production__published_desc',
    })
    const requests = []
    const dispatched = []

    const document = {
        readyState: 'complete',
        querySelector(selector) {
            if (selector === '[data-quiz-form="home"]') return null
            if (selector === '.section_home-consult') return section
            if (selector === 'script[data-starters-v3-algolia-client]') return client
            if (
                selector ===
                '[data-starters-v3-algolia-resource="starters"][wf-algolia-index]'
            ) {
                return resource
            }
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

    return { cards, dispatched, requests, section }
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
                indexName: 'Freelancers3.0-production',
                objectID: '101',
                attributesToRetrieve: ['work-history'],
            },
            {
                indexName: 'Freelancers3.0-production',
                objectID: '102',
                attributesToRetrieve: ['work-history'],
            },
            {
                indexName: 'Freelancers3.0-production',
                objectID: '103',
                attributesToRetrieve: ['work-history'],
            },
            {
                indexName: 'Freelancers3.0-production',
                objectID: '104',
                attributesToRetrieve: ['work-history'],
            },
        ],
    )
    assert.deepEqual(
        page.cards.map(({ list }) => list.textContent),
        ['First, Second, Third', 'Alpha, Beta', 'Only', ''],
    )
    assert.deepEqual(
        page.cards.map(({ list }) =>
            list.getAttribute('data-home-work-history-status'),
        ),
        ['ready', 'ready', 'ready', 'empty'],
    )
    assert.equal(sectionStatus(page), 'ready')
    assert.deepEqual(page.dispatched, ['expert-cards:relayout'])
})

test('invalid work-history entries are omitted without reviving legacy CMS text', async () => {
    const page = await load({
        histories: {
            593: [
                null,
                { company: ' Parachute Home ' },
                { company: '' },
                { company: 'The Honest Company' },
            ],
        },
    })

    assert.equal(
        page.cards[0].list.textContent,
        'Parachute Home, The Honest Company',
    )
    assert.equal(
        page.cards[0].list.getAttribute('data-home-work-history-status'),
        'ready',
    )
})

test('a failed Algolia request removes the misleading legacy company list', async () => {
    const page = await load({
        histories: { 593: [{ company: 'Parachute Home' }] },
        responseOk: false,
        responseStatus: 503,
    })

    assert.equal(page.cards[0].list.textContent, '')
    assert.equal(
        page.cards[0].list.getAttribute('data-home-work-history-status'),
        'error',
    )
    assert.equal(sectionStatus(page), 'error')
    assert.deepEqual(page.dispatched, ['expert-cards:relayout'])
})

function sectionStatus(page) {
    return page.section.getAttribute('data-home-work-history-status')
}
