'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = path.join(__dirname, '../starter-edit-profile/company-autocomplete.js')
const SLOW_SEARCH_DELAY_MS = 4000

function element(overrides = {}) {
  const listeners = new Map()
  const node = {
    dataset: {},
    style: {},
    value: '',
    innerHTML: '',
    classList: { add() {}, remove() {}, contains() { return false } },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener])
    },
    dispatchEvent() { return true },
    fire(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener({ type, ...event })
    },
    hasAttribute() { return false },
    appendChild() {},
    contains() { return false },
    closest() { return null },
    focus() {},
    remove() {},
  }
  return Object.assign(node, overrides)
}

function boot() {
  const group = element()
  const searchGroup = element()
  const valueInput = element()
  const input = element()
  input.closest = (selector) => (selector === '[form-group]' ? group : searchGroup)

  let dropdown = null
  const pendingFetches = []
  const fetchedQueries = []
  const timers = new Map()
  let nextTimerId = 1
  const domReady = []
  const documentClicks = []

  const context = {
    JSON,
    Array,
    Error,
    MEMBER: { id: 'member-1' },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    crypto: { randomUUID: () => 'company-id' },
    document: {
      addEventListener(type, listener) {
        if (type === 'DOMContentLoaded') domReady.push(listener)
        if (type === 'click') documentClicks.push(listener)
      },
      createElement() {
        dropdown = element()
        return dropdown
      },
    },
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type
        Object.assign(this, options)
      }
    },
    fetch(url) {
      const query = decodeURIComponent(String(url).split('?q=')[1] || '')
      fetchedQueries.push(query)
      return new Promise((resolve, reject) => {
        pendingFetches.push({ query, resolve, reject })
      })
    },
    qs(selector, root) {
      if (root === group && selector === '#also-worked-with') return valueInput
      return null
    },
    qsa(selector) {
      return selector === '[logo-search-input]' ? [input] : []
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    waitForMember: (callback) => callback(),
    waitProfileData: (callback) => callback(),
  }
  context.window = context
  context.window.xanoAuthFetch = async () => ({ ok: true, json: async () => [] })
  vm.createContext(context)
  new vm.Script(fs.readFileSync(SOURCE, 'utf8'), { filename: SOURCE }).runInContext(context)
  for (const listener of domReady) listener()

  const settle = () => new Promise((resolve) => setImmediate(resolve))

  return {
    input,
    fetchedQueries,
    get dropdown() { return dropdown },
    isOpen() { return dropdown.style.display === 'block' },
    // The focus handler searches the current input value without the input debounce.
    async search(value) {
      input.value = value
      input.fire('focus')
      await settle()
    },
    // searchGroup.contains() is false for this stub target, so this is an outside click.
    async clickOutside() {
      for (const listener of documentClicks) listener({ type: 'click', target: element() })
      await settle()
    },
    async resolveSearch(query, results) {
      const pending = pendingFetches.find((entry) => entry.query === query)
      assert.ok(pending, `no in-flight company search for "${query}"`)
      pendingFetches.splice(pendingFetches.indexOf(pending), 1)
      pending.resolve({ ok: true, json: async () => results })
      await settle()
    },
    // Two requests can be in flight for the same text: the abandoned one and the live one.
    async resolveLatestSearch(query, results) {
      const matching = pendingFetches.filter((entry) => entry.query === query)
      const pending = matching[matching.length - 1]
      assert.ok(pending, `no in-flight company search for "${query}"`)
      pendingFetches.splice(pendingFetches.indexOf(pending), 1)
      pending.resolve({ ok: true, json: async () => results })
      await settle()
    },
    async failSearch(query, status = 503) {
      const pending = pendingFetches.find((entry) => entry.query === query)
      assert.ok(pending, `no in-flight company search for "${query}"`)
      pendingFetches.splice(pendingFetches.indexOf(pending), 1)
      pending.resolve({ ok: false, status, json: async () => null })
      await settle()
    },
    runSlowSearchTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== SLOW_SEARCH_DELAY_MS) continue
        timers.delete(id)
        timer.callback()
      }
    },
  }
}

const ACME = [{ name: 'Acme Corp', domain: 'acme.example', logo_url: '' }]

test('a slow company search reports progress while it is still the active search', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  assert.match(harness.dropdown.innerHTML, /Searching\.\.\./)

  harness.runSlowSearchTimers()
  assert.match(harness.dropdown.innerHTML, /Still searching company sources/)
  assert.equal(harness.isOpen(), true)

  await harness.resolveSearch('acme corp', ACME)
  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
  assert.equal(harness.isOpen(), true)
})

test('a slow response for an abandoned query never reopens the dropdown', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.search('a')
  assert.equal(harness.isOpen(), false)

  await harness.resolveSearch('acme corp', ACME)

  assert.equal(harness.isOpen(), false)
  assert.doesNotMatch(harness.dropdown.innerHTML, /Acme Corp/)
})

test('an abandoned search does not report failure over the dismissed dropdown', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.search('a')
  await harness.failSearch('acme corp')

  assert.equal(harness.isOpen(), false)
  assert.doesNotMatch(harness.dropdown.innerHTML, /Search unavailable/)
})

test('a failed search that is still active reports that the search is unavailable', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.failSearch('acme corp')

  assert.match(harness.dropdown.innerHTML, /Search unavailable/)
  assert.equal(harness.isOpen(), true)
})

test('the slow-search message never appears for an abandoned query', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.search('a')

  harness.runSlowSearchTimers()

  assert.equal(harness.isOpen(), false)
  assert.doesNotMatch(harness.dropdown.innerHTML, /Still searching company sources/)
})

test('retyping an abandoned query runs a fresh search instead of reopening an empty dropdown', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.search('a')
  await harness.resolveSearch('acme corp', ACME)

  await harness.search('acme corp')

  assert.deepEqual(harness.fetchedQueries, ['acme corp', 'acme corp'])
  await harness.resolveSearch('acme corp', ACME)
  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
  assert.equal(harness.isOpen(), true)
})

test('refocusing after dismissing a still-pending search never strands a Searching message', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.clickOutside()
  assert.equal(harness.isOpen(), false)

  await harness.search('acme corp')

  assert.deepEqual(harness.fetchedQueries, ['acme corp', 'acme corp'])
  assert.match(harness.dropdown.innerHTML, /Searching\.\.\./)

  await harness.resolveLatestSearch('acme corp', ACME)
  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
  assert.equal(harness.isOpen(), true)
})

test('a dismissed search that resolves after the retype leaves the retype results standing', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.clickOutside()
  await harness.search('acme corp')

  await harness.resolveSearch('acme corp', [{ name: 'Stale Corp', domain: 'stale.example', logo_url: '' }])
  await harness.resolveSearch('acme corp', ACME)

  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
  assert.doesNotMatch(harness.dropdown.innerHTML, /Stale Corp/)
  assert.equal(harness.isOpen(), true)
})

test('refocusing while a search is genuinely still in flight does not duplicate the request', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.search('acme corp')

  assert.deepEqual(harness.fetchedQueries, ['acme corp'])
  assert.equal(harness.isOpen(), true)
  assert.match(harness.dropdown.innerHTML, /Searching\.\.\./)

  await harness.resolveSearch('acme corp', ACME)
  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
})

test('reopening rendered results for unchanged text does not refetch', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.resolveSearch('acme corp', ACME)
  await harness.clickOutside()
  assert.equal(harness.isOpen(), false)

  await harness.search('acme corp')

  assert.deepEqual(harness.fetchedQueries, ['acme corp'])
  assert.equal(harness.isOpen(), true)
  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
})

test('a failed search retries on refocus instead of stranding the error message', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  await harness.failSearch('acme corp')
  assert.match(harness.dropdown.innerHTML, /Search unavailable/)

  await harness.search('acme corp')

  assert.deepEqual(harness.fetchedQueries, ['acme corp', 'acme corp'])
  await harness.resolveSearch('acme corp', ACME)
  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
})

test('a failed narrower search never strands its error over a previously rendered query', async () => {
  const harness = await boot()

  await harness.search('goo')
  await harness.resolveSearch('goo', [{ name: 'Goo Inc', domain: 'goo.example', logo_url: '' }])
  assert.match(harness.dropdown.innerHTML, /Goo Inc/)

  await harness.search('goog')
  await harness.failSearch('goog')
  assert.match(harness.dropdown.innerHTML, /Search unavailable/)

  await harness.search('goo')

  assert.deepEqual(harness.fetchedQueries, ['goo', 'goog', 'goo'])
  await harness.resolveLatestSearch('goo', [{ name: 'Goo Inc', domain: 'goo.example', logo_url: '' }])
  assert.match(harness.dropdown.innerHTML, /Goo Inc/)
  assert.doesNotMatch(harness.dropdown.innerHTML, /Search unavailable/)
})

test('backspacing to a rendered query while a narrower search is pending refetches the visible text', async () => {
  const harness = await boot()

  await harness.search('goo')
  await harness.resolveSearch('goo', [{ name: 'Goo Inc', domain: 'goo.example', logo_url: '' }])

  await harness.search('goog')
  assert.match(harness.dropdown.innerHTML, /Searching\.\.\./)

  await harness.search('goo')
  assert.deepEqual(harness.fetchedQueries, ['goo', 'goog', 'goo'])

  await harness.resolveSearch('goog', [{ name: 'Google', domain: 'google.com', logo_url: '' }])
  assert.doesNotMatch(harness.dropdown.innerHTML, /Google/)

  await harness.resolveLatestSearch('goo', [{ name: 'Goo Inc', domain: 'goo.example', logo_url: '' }])
  assert.match(harness.dropdown.innerHTML, /Goo Inc/)
  assert.equal(harness.isOpen(), true)
})

test('the slow-search message does not become a cached result for its own query', async () => {
  const harness = await boot()

  await harness.search('acme corp')
  harness.runSlowSearchTimers()
  assert.match(harness.dropdown.innerHTML, /Still searching company sources/)

  await harness.clickOutside()
  await harness.search('acme corp')

  assert.deepEqual(harness.fetchedQueries, ['acme corp', 'acme corp'])
  await harness.resolveLatestSearch('acme corp', ACME)
  assert.match(harness.dropdown.innerHTML, /Acme Corp/)
})
