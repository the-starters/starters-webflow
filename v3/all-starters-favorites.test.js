const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./all-starters-favorites.js'), 'utf8')

// vm-realm objects have a foreign Object.prototype; normalize before deep-equal.
const plain = (value) => JSON.parse(JSON.stringify(value))

// The favorites section is found by its dedicated marker attribute, never by a
// Memberstack gate value (renaming the gate used to silently kill the module).
const LIST_SECTION = '[data-starters-list]'
const LEGACY_PREMIUM_SECTION = '.section_all-starters-body[data-ms-content="premium-brands"]'

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
  const queried = []
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
      queried.push(selector)
      const marker = options.sectionSelector || LIST_SECTION
      if (selector === marker) return options.section || null
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
    queried,
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

// A decoratable favorite wrapper: matches the wrapper selector, sits inside a
// premium hit (closest returns truthy), and has no inner button/svg so the
// wrapper itself becomes the control. fakeWfXano's init does NOT paint (never
// sets hidden=false), so after decoration the control stays hidden — modelling
// "no paint has run yet".
function favoriteWrapper() {
  const wrapper = fakeElement({ tagName: 'DIV' })
  wrapper.matches = (selector) => selector === '.expert-card_favorite-wrapper'
  wrapper.closest = () => ({})
  return wrapper
}

test('boot guard: module refuses to run twice', () => {
  const mod = loadModule()
  assert.equal(mod.window.__startersV3AllStartersFavoritesBooted, true)
})

test('no marked list section: config untouched, nothing built', async () => {
  const mod = loadModule({ section: null, memberReady: Promise.resolve(premiumMember()) })
  mod.boot()
  await Promise.resolve()
  assert.equal(mod.window.WfXanoConfig, undefined)
  assert.equal(mod.document.head.children.length, 0)
})

test('boot keys off the [data-starters-list] marker, not a Memberstack gate', async () => {
  // Null member on purpose: the lookup+style injection happen before the plan
  // check, and a premium member here would start a 10s wf-xano readiness poll.
  const mod = loadModule({
    section: fakeElement(),
    memberReady: Promise.resolve(null),
  })
  mod.boot()
  await Promise.resolve()
  // Both the eval-time pre-warm and boot() look the section up by the marker.
  assert.ok(mod.queried.length > 0)
  mod.queried.forEach((selector) => assert.equal(selector, LIST_SECTION))
  assert.equal(mod.document.head.children.length, 1)
})

test('a legacy premium-brands section without the marker is ignored', async () => {
  // The section exists but only answers to the old gate selector: the module
  // must no-op (this is exactly the paid-plans rename that killed it live).
  const mod = loadModule({
    section: fakeElement(),
    sectionSelector: LEGACY_PREMIUM_SECTION,
    memberReady: Promise.resolve(premiumMember()),
  })
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

test('styles inject when the marked section exists (incl. unmarked-variant hard hide)', async () => {
  const mod = loadModule({
    section: fakeElement(),
    memberReady: Promise.resolve(null),
  })
  mod.boot()
  await Promise.resolve()
  assert.equal(mod.document.head.children.length, 1)
  const css = mod.document.head.children[0].textContent
  // Hard hide is scoped to unmarked .section_all-starters-body variants, so it
  // survives gate renames AND leaves favorite wrappers elsewhere on the page
  // (membership-modal static Expert Cards) alone.
  assert.match(
    css,
    /\.section_all-starters-body:not\(\[data-starters-list\]\) \.expert-card_favorite-wrapper \{ display: none !important; \}/
  )
  assert.doesNotMatch(css, /data-ms-content/)
  assert.match(css, /\[data-starters-list\] \.expert-card_wrapper > \.expert-card_favorite-wrapper \{ position: absolute/)
  // Global [hidden] override: Webflow's class display:flex beats the UA [hidden]
  // rule, so both our decorate-hidden state and wf-xano's auth-fail hide need
  // this to actually hide anything.
  assert.match(css, /\.expert_favorite-button\[hidden\], \.expert-card_favorite-wrapper\[hidden\] \{ display: none !important; \}/)
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

test('decorated control is hidden until wf-xano paints it (show-when-ready)', async () => {
  const wrapper = favoriteWrapper()
  const section = fakeElement()
  section.querySelectorAll = (selector) =>
    selector === '.expert-card_favorite-wrapper' ? [wrapper] : []
  const wfXano = fakeWfXano()
  const mod = loadModule({
    section,
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  // Decorated (attribute stamped) but hidden, since the fake init never paints.
  assert.equal(wrapper.getAttribute('wf-xano-element'), 'favorite')
  assert.equal(wrapper.hidden, true)
})

test('a second decorate pass does not re-hide an already-decorated control', async () => {
  const wrapper = favoriteWrapper()
  const section = fakeElement()
  section.querySelectorAll = (selector) =>
    selector === '.expert-card_favorite-wrapper' ? [wrapper] : []
  const wfXano = fakeWfXano()
  let observerCallback = null
  const mod = loadModule({
    section,
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
    MutationObserver: function (callback) {
      observerCallback = callback
      return { observe() {} }
    },
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wrapper.hidden, true)
  assert.equal(wrapper.getAttribute('wf-xano-element'), 'favorite')

  // Simulate wf-xano's paint revealing the control, then a re-render that
  // re-decorates the same node via the observer: it must NOT re-hide it.
  wrapper.hidden = false
  observerCallback([{ addedNodes: [wrapper] }])
  assert.equal(wrapper.hidden, false)
})

test('pre-warm: premium member triggers a favorites refresh at eval (no DOMContentLoaded)', async () => {
  const wfXano = fakeWfXano()
  const mod = loadModule({
    section: fakeElement(),
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  // Deliberately do NOT call mod.boot(): the pre-warm runs at script eval.
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, 1)
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
})

test('pre-warm: non-premium member does not trigger a favorites refresh', async () => {
  const wfXano = fakeWfXano()
  const mod = loadModule({
    section: fakeElement(),
    wfXano,
    memberReady: Promise.resolve({
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, 0)
})

test('null member at eval, Memberstack ready by boot: decoration still runs', async () => {
  const wrapper = favoriteWrapper()
  const section = fakeElement()
  section.querySelectorAll = (selector) =>
    selector === '.expert-card_favorite-wrapper' ? [wrapper] : []
  const wfXano = fakeWfXano()
  // Eval-time: no window.memberReady and no $memberstackDom, so the cached
  // memberPromise resolves null (simulating a late/async Memberstack tag).
  const mod = loadModule({ section, wfXano })
  // Memberstack becomes available only by DOMContentLoaded/boot time.
  mod.window.$memberstackDom = {
    getCurrentMember: () => Promise.resolve({ data: premiumMember() }),
  }
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  // boot()'s retry re-resolves the member and decoration runs for the premium.
  assert.equal(wrapper.getAttribute('wf-xano-element'), 'favorite')
  assert.equal(wrapper.hidden, true)
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
  // Baseline includes the eval-time pre-warm refresh (premium member); assert
  // the view switch's refresh relative to it so the count stays intent-focused.
  const refreshBaseline = wfXano.calls.refresh

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
  assert.equal(wfXano.calls.refresh, refreshBaseline + 1)
  assert.deepEqual(plain(wfAlgolia.filters.at(-1)), ['objectID', ['314', '425']])

  // Back to Show all clears the filter without another refresh.
  marker.setAttribute('data-ts-favorites-view', 'all')
  mod.docListeners.change({ target: input })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, refreshBaseline + 1)
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

test('executable code never references a Memberstack gate attribute', () => {
  // Header prose keeps a historical note about the old premium-brands gate; the
  // code itself must be free of gate coupling (that coupling is what broke).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /data-ms-content/)
  assert.doesNotMatch(code, /premium-brands/)
  assert.match(code, /\[data-starters-list\]/)
})

test('module never creates UI or injects library scripts', () => {
  assert.doesNotMatch(source, /createElement\('script'\)/)
  assert.doesNotMatch(source, /innerHTML/)
  assert.doesNotMatch(source, /insertBefore/)
  assert.doesNotMatch(source, /ts-favorites-shell|ts-favorites-tab|savedMarkup/)
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/gh\/the-starters\/(wf-xano|wf-algolia)/)
})
