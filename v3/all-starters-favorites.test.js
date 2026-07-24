const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./all-starters-favorites.js'), 'utf8')

// vm-realm objects have a foreign Object.prototype; normalize before deep-equal.
const plain = (value) => JSON.parse(JSON.stringify(value))

const PREMIUM_SECTION = '.section_all-starters-body[data-ms-content="premium-brands"]'

// Minimal element stub: enough surface for the decorate/filter paths.
function fakeElement(overrides = {}) {
  const attributes = {}
  const el = {
    tagName: overrides.tagName || 'DIV',
    nodeType: 1,
    children: [],
    className: '',
    textContent: '',
    hidden: false,
    parentNode: null,
    firstElementChild: null,
    listeners: {},
    setAttribute(name, value) {
      attributes[name] = String(value)
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null
    },
    appendChild(child) {
      child.parentNode = el
      el.children.push(child)
      if (!el.firstElementChild) el.firstElementChild = child
      return child
    },
    addEventListener(type, listener) {
      el.listeners[type] = listener
    },
    contains() {
      return true
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    matches() {
      return false
    },
    closest() {
      return null
    },
    attributes,
  }
  return Object.assign(el, overrides)
}

function loadModule(options = {}) {
  const warnings = []
  const docListeners = {}
  let bootListener = null
  const head = fakeElement({ tagName: 'HEAD' })
  const documentStub = {
    readyState: 'loading',
    head,
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() })
    },
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') bootListener = listener
      else docListeners[type] = listener
    },
    querySelector(selector) {
      if (selector === PREMIUM_SECTION) return options.section || null
      return null
    },
    querySelectorAll() {
      return []
    },
  }
  const windowStub = {
    setTimeout,
    clearTimeout,
    WfXanoConfig: options.config,
    WfXano: options.wfXano,
    WfAlgolia: options.wfAlgolia,
    memberReady: options.memberReady,
    $memberstackDom: options.memberstack,
    MutationObserver:
      options.MutationObserver ||
      function () {
        return { observe() {} }
      },
    console: { warn: (...args) => warnings.push(args) },
  }
  windowStub.window = windowStub
  const context = {
    window: windowStub,
    document: documentStub,
    console: windowStub.console,
    Promise,
    setTimeout,
    clearTimeout,
    MutationObserver: windowStub.MutationObserver,
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  return {
    window: windowStub,
    document: documentStub,
    docListeners,
    warnings,
    boot: () => {
      documentStub.readyState = 'complete'
      if (bootListener) return bootListener()
    },
  }
}

function premiumMember() {
  return {
    planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: true }],
  }
}

function fakeWfXano(ids = []) {
  const calls = { refresh: 0, init: 0 }
  return {
    calls,
    favorites: {
      ids: () => ids.slice(),
      refresh: () => {
        calls.refresh += 1
        return Promise.resolve()
      },
      init: () => {
        calls.init += 1
      },
    },
  }
}

function fakeWfAlgolia() {
  const filters = []
  return {
    filters,
    setFilter(field, values) {
      filters.push([field, values])
    },
  }
}

test('boot guard: module refuses to run twice', () => {
  const mod = loadModule()
  assert.equal(mod.window.__startersV3AllStartersFavoritesBooted, true)
})

test('no premium section: config untouched, nothing built', async () => {
  const mod = loadModule({ section: null, memberReady: Promise.resolve(premiumMember()) })
  mod.boot()
  await Promise.resolve()
  assert.equal(mod.window.WfXanoConfig, undefined)
  assert.equal(mod.document.head.children.length, 0)
})

test('favoritesSource defaults only when the site config lacks it', async () => {
  const existing = { xanoBase: 'https://x.example', favoritesSource: 'opp30:custom' }
  const mod = loadModule({
    section: fakeElement(),
    config: existing,
    memberReady: Promise.resolve(null),
  })
  mod.boot()
  await Promise.resolve()
  assert.equal(mod.window.WfXanoConfig, existing)
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:custom')

  const mod2 = loadModule({
    section: fakeElement(),
    config: { xanoBase: 'https://x.example' },
    memberReady: Promise.resolve(null),
  })
  mod2.boot()
  await Promise.resolve()
  assert.equal(mod2.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
})

test('styles inject when the premium section exists (incl. non-premium hard hide)', async () => {
  const mod = loadModule({
    section: fakeElement(),
    memberReady: Promise.resolve(null),
  })
  mod.boot()
  await Promise.resolve()
  assert.equal(mod.document.head.children.length, 1)
  const css = mod.document.head.children[0].textContent
  assert.match(css, /data-ms-content="!premium-brands"\] \.expert-card_favorite-wrapper \{ display: none !important/)
  assert.match(css, /data-ms-content="premium-brands"\] \.expert-card_wrapper > \.expert-card_favorite-wrapper \{ position: absolute/)
})

test('non-premium member: no decoration, no listeners bound', async () => {
  const section = fakeElement()
  const mod = loadModule({
    section,
    memberReady: Promise.resolve({
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    }),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mod.docListeners.change, undefined)
  assert.equal(mod.docListeners['wf-xano:favorite'], undefined)
})

test('premium member: decorates, observes, inits favorites, binds controls', async () => {
  let observed = null
  const section = fakeElement()
  const wfXano = fakeWfXano()
  const mod = loadModule({
    section,
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
    MutationObserver: function (callback) {
      return {
        observe(target, opts) {
          observed = { target, opts, callback }
        },
      }
    },
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observed.target, section)
  assert.deepEqual(plain(observed.opts), { childList: true, subtree: true })
  assert.equal(wfXano.calls.init, 1)
  assert.equal(typeof mod.docListeners.change, 'function')
  assert.equal(typeof mod.docListeners['wf-xano:favorite'], 'function')
})

test('switching to Favourites refreshes ids and filters the grid by objectID', async () => {
  const section = fakeElement()
  const wfXano = fakeWfXano(['314', '425'])
  const wfAlgolia = fakeWfAlgolia()
  const mod = loadModule({
    section,
    wfXano,
    wfAlgolia,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))

  const marker = fakeElement()
  marker.setAttribute('data-ts-favorites-view', 'favorites')
  const input = fakeElement({
    tagName: 'INPUT',
    type: 'radio',
    checked: true,
    closest: () => marker,
  })
  mod.docListeners.change({ target: input })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, 1)
  assert.deepEqual(plain(wfAlgolia.filters.at(-1)), ['objectID', ['314', '425']])

  // Back to Show all clears the filter without another refresh.
  marker.setAttribute('data-ts-favorites-view', 'all')
  mod.docListeners.change({ target: input })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, 1)
  assert.deepEqual(plain(wfAlgolia.filters.at(-1)), ['objectID', []])
})

test('zero favourites filters to the __none__ sentinel (grid empty state)', async () => {
  const section = fakeElement()
  const wfXano = fakeWfXano([])
  const wfAlgolia = fakeWfAlgolia()
  const mod = loadModule({
    section,
    wfXano,
    wfAlgolia,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  const marker = fakeElement()
  marker.setAttribute('data-ts-favorites-view', 'favorites')
  const input = fakeElement({ tagName: 'INPUT', type: 'radio', checked: true, closest: () => marker })
  mod.docListeners.change({ target: input })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(plain(wfAlgolia.filters.at(-1)), ['objectID', ['__none__']])
})

test('un-hearting while in Favourites view re-applies the filter without a refetch', async () => {
  const section = fakeElement()
  const ids = ['314', '425']
  const wfXano = fakeWfXano(ids)
  const wfAlgolia = fakeWfAlgolia()
  const mod = loadModule({
    section,
    wfXano,
    wfAlgolia,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  const marker = fakeElement()
  marker.setAttribute('data-ts-favorites-view', 'favorites')
  const input = fakeElement({ tagName: 'INPUT', type: 'radio', checked: true, closest: () => marker })
  mod.docListeners.change({ target: input })
  await new Promise((resolve) => setImmediate(resolve))
  const refreshesAfterSwitch = wfXano.calls.refresh

  ids.pop() // wf-xano updates its cache before dispatching the event
  mod.docListeners['wf-xano:favorite']({ detail: { item_type: 'starter', item_id: '425', favorited: false } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, refreshesAfterSwitch)
  assert.deepEqual(plain(wfAlgolia.filters.at(-1)), ['objectID', ['314']])
})

test('favorite events for other item types are ignored', async () => {
  const section = fakeElement()
  const wfXano = fakeWfXano(['314'])
  const wfAlgolia = fakeWfAlgolia()
  const mod = loadModule({
    section,
    wfXano,
    wfAlgolia,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  const before = wfAlgolia.filters.length
  mod.docListeners['wf-xano:favorite']({ detail: { item_type: 'opportunity', item_id: '9', favorited: false } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfAlgolia.filters.length, before)
})

test('module never creates UI or injects library scripts', () => {
  assert.doesNotMatch(source, /createElement\('script'\)/)
  assert.doesNotMatch(source, /innerHTML/)
  assert.doesNotMatch(source, /insertBefore/)
  assert.doesNotMatch(source, /ts-favorites-shell|ts-favorites-tab|savedMarkup/)
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/gh\/the-starters\/(wf-xano|wf-algolia)/)
})
