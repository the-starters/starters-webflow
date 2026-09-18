const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./hire-profile-favorites.js'), 'utf8')
const allStartersSource = fs.readFileSync(require.resolve('./all-starters-favorites.js'), 'utf8')

const CONTROL = '[wf-xano-element="favorite"]'
const LIST_SECTION = '[data-starters-list]'
const HIRE_PATH = '/hire/brian'

function fakeElement(overrides = {}) {
  const attributes = { ...(overrides.attributes || {}) }
  const el = {
    tagName: overrides.tagName || 'BUTTON',
    nodeType: 1,
    children: [],
    className: overrides.className || '',
    textContent: '',
    hidden: overrides.hidden !== undefined ? overrides.hidden : true,
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
  return Object.assign(el, overrides, { attributes })
}

function profileFavoriteControl() {
  return fakeElement({
    tagName: 'BUTTON',
    className: 'icon-32 is-profile',
    hidden: true,
    attributes: {
      'wf-xano-element': 'favorite',
      'wf-xano-favorite-type': 'starter',
      'wf-xano-favorite-id': '558',
    },
  })
}

function premiumMember() {
  return {
    planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: true }],
  }
}

function fakeWfXano(ids = []) {
  const calls = { refresh: 0, init: 0, initTargets: [] }
  return {
    calls,
    favorites: {
      ids: () => ids.slice(),
      refresh: () => {
        calls.refresh += 1
        return Promise.resolve()
      },
      init: (target) => {
        calls.init += 1
        calls.initTargets.push(target)
      },
    },
  }
}

function loadModule(options = {}) {
  const warnings = []
  let bootListener = null
  const controls = options.controls || []
  const queried = []
  const queriedAll = []
  const head = fakeElement({ tagName: 'HEAD' })
  const documentStub = {
    readyState: 'loading',
    head,
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() })
    },
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') bootListener = listener
    },
    querySelector(selector) {
      queried.push(selector)
      if (selector === CONTROL) return controls[0] || null
      if (selector === LIST_SECTION) return options.listSection || null
      return null
    },
    querySelectorAll(selector) {
      queriedAll.push(selector)
      if (selector === CONTROL) return controls.slice()
      return []
    },
  }
  const windowStub = {
    setTimeout,
    clearTimeout,
    location: { pathname: options.pathname === undefined ? HIRE_PATH : options.pathname },
    WfXanoConfig: options.config,
    WfXano: options.wfXano,
    memberReady: options.memberReady,
    $memberstackDom: options.memberstack,
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
  }
  vm.createContext(context)
  vm.runInContext(options.source || source, context)
  if (options.secondSource) vm.runInContext(options.secondSource, context)
  return {
    window: windowStub,
    document: documentStub,
    context,
    queried,
    queriedAll,
    warnings,
    boot: () => {
      documentStub.readyState = 'complete'
      if (bootListener) return bootListener()
    },
  }
}

test('boot guard: module refuses to run twice', () => {
  const mod = loadModule()
  assert.equal(mod.window.__startersV3HireProfileFavoritesBooted, true)
  vm.runInContext(source, mod.context)
  assert.equal(mod.window.__startersV3HireProfileFavoritesBooted, true)
})

test('no hire path: config untouched, nothing inited', async () => {
  const wfXano = fakeWfXano()
  const mod = loadModule({
    pathname: '/all-starters',
    controls: [profileFavoriteControl()],
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mod.window.WfXanoConfig, undefined)
  assert.equal(wfXano.calls.init, 0)
  assert.equal(wfXano.calls.refresh, 0)
  assert.equal(mod.document.head.children.length, 0)
})

test('hire path without a profile favorite control: config untouched', async () => {
  const wfXano = fakeWfXano()
  const mod = loadModule({
    pathname: '/hire/brian',
    controls: [],
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mod.window.WfXanoConfig, undefined)
  assert.equal(wfXano.calls.init, 0)
  assert.equal(wfXano.calls.refresh, 0)
  assert.equal(mod.document.head.children.length, 0)
})

test('bare /hire and nested hire paths do not hydrate', async () => {
  for (const pathname of ['/hire', '/hire/', '/hire/brian/extra']) {
    const wfXano = fakeWfXano()
    const mod = loadModule({
      pathname,
      controls: [profileFavoriteControl()],
      wfXano,
      memberReady: Promise.resolve(premiumMember()),
    })
    mod.boot()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(mod.window.WfXanoConfig, undefined, pathname)
    assert.equal(wfXano.calls.init, 0, pathname)
  }
})

test('no [data-starters-list] marker: still hydrates a hire-profile favorite', async () => {
  const control = profileFavoriteControl()
  const wfXano = fakeWfXano()
  const mod = loadModule({
    controls: [control],
    listSection: null,
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
  assert.equal(wfXano.calls.init, 1)
  assert.equal(wfXano.calls.initTargets[0], control)
  assert.ok(!mod.queried.includes(LIST_SECTION))
})

test('favoritesSource defaults only when the site config lacks it', async () => {
  const existing = { xanoBase: 'https://x.example', favoritesSource: 'opp30:custom' }
  const mod = loadModule({
    controls: [profileFavoriteControl()],
    config: existing,
    wfXano: fakeWfXano(),
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mod.window.WfXanoConfig, existing)
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:custom')

  const mod2 = loadModule({
    controls: [profileFavoriteControl()],
    config: { xanoBase: 'https://x.example' },
    wfXano: fakeWfXano(),
    memberReady: Promise.resolve(premiumMember()),
  })
  mod2.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mod2.window.WfXanoConfig.xanoBase, 'https://x.example')
  assert.equal(mod2.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
})

test('non-premium member: no source, no init, no styles, control stays hidden', async () => {
  const cases = [
    { planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }] },
    { planConnections: [{ planId: 'pln_dorxata-test-free-plan-dvcg0k8o', status: 'ACTIVE' }] },
    { planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: false, status: 'CANCELED' }] },
    null,
  ]
  for (const member of cases) {
    const control = profileFavoriteControl()
    const wfXano = fakeWfXano()
    const mod = loadModule({
      controls: [control],
      wfXano,
      memberReady: Promise.resolve(member),
    })
    mod.boot()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(mod.window.WfXanoConfig, undefined)
    assert.equal(wfXano.calls.init, 0)
    assert.equal(wfXano.calls.refresh, 0)
    assert.equal(mod.document.head.children.length, 0)
    assert.equal(control.hidden, true)
    assert.equal(control.getAttribute('wf-xano-element'), 'favorite')
  }
})

test('premium member: sets source, inits the profile favorite, leaves hidden for wf-xano paint', async () => {
  const control = profileFavoriteControl()
  const wfXano = fakeWfXano()
  const mod = loadModule({
    controls: [control],
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
  assert.equal(wfXano.calls.init, 1)
  assert.equal(wfXano.calls.initTargets[0], control)
  assert.equal(control.hidden, true)
  assert.equal(control.getAttribute('wf-xano-favorite-id'), '558')
  assert.equal(mod.document.head.children.length, 1)
})

test('test Brand plan hydrates the same way as paid Brand', async () => {
  const control = profileFavoriteControl()
  const wfXano = fakeWfXano()
  const mod = loadModule({
    controls: [control],
    wfXano,
    memberReady: Promise.resolve({
      planConnections: [{ planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' }],
    }),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.init, 1)
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
})

test('inits every hire-profile favorite control, not a list section', async () => {
  const first = profileFavoriteControl()
  const second = profileFavoriteControl()
  second.setAttribute('wf-xano-favorite-id', '559')
  const wfXano = fakeWfXano()
  const mod = loadModule({
    controls: [first, second],
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.init, 2)
  assert.deepEqual(wfXano.calls.initTargets, [first, second])
})

test('pre-warm: premium member refreshes starter ids at eval', async () => {
  const wfXano = fakeWfXano()
  const mod = loadModule({
    controls: [profileFavoriteControl()],
    wfXano,
    memberReady: Promise.resolve(premiumMember()),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, 1)
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
})

test('pre-warm: non-premium member does not refresh or set source', async () => {
  const wfXano = fakeWfXano()
  const mod = loadModule({
    controls: [profileFavoriteControl()],
    wfXano,
    memberReady: Promise.resolve({
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.refresh, 0)
  assert.equal(mod.window.WfXanoConfig, undefined)
})

test('null member at eval, Memberstack ready by boot: hydration still runs', async () => {
  const control = profileFavoriteControl()
  const wfXano = fakeWfXano()
  const mod = loadModule({ controls: [control], wfXano })
  mod.window.$memberstackDom = {
    getCurrentMember: () => Promise.resolve({ data: premiumMember() }),
  }
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(wfXano.calls.init, 1)
  assert.equal(mod.window.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
})

test('trailing-slash and mixed-case hire paths still hydrate', async () => {
  for (const pathname of ['/hire/brian/', '/HIRE/brian']) {
    const wfXano = fakeWfXano()
    const mod = loadModule({
      pathname,
      controls: [profileFavoriteControl()],
      wfXano,
      memberReady: Promise.resolve(premiumMember()),
    })
    mod.boot()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(wfXano.calls.init, 1, pathname)
  }
})

test('injected CSS covers favorited fill and a scoped [hidden] hide', async () => {
  const mod = loadModule({
    controls: [profileFavoriteControl()],
    wfXano: fakeWfXano(),
    memberReady: Promise.resolve(premiumMember()),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  const css = mod.document.head.children[0].textContent
  assert.match(css, /\[wf-xano-element="favorite"\]\.is-wf-xano-favorited path \{ fill: currentColor; \}/)
  assert.match(css, /\[wf-xano-element="favorite"\]\[hidden\] \{ display: none !important; \}/)
  assert.doesNotMatch(css, /data-starters-list/)
  assert.doesNotMatch(css, /expert-card_favorite-wrapper/)
})

test('all-starters-favorites on a hire page without the list marker does not set source; this module then does', async () => {
  const control = profileFavoriteControl()
  const wfXano = fakeWfXano()
  const member = premiumMember()
  const warnings = []
  let bootListeners = []
  const queried = []
  const head = fakeElement({ tagName: 'HEAD' })
  const documentStub = {
    readyState: 'loading',
    head,
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() })
    },
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') bootListeners.push(listener)
    },
    querySelector(selector) {
      queried.push(selector)
      if (selector === CONTROL) return control
      if (selector === LIST_SECTION) return null
      return null
    },
    querySelectorAll(selector) {
      if (selector === CONTROL) return [control]
      return []
    },
  }
  const windowStub = {
    setTimeout,
    clearTimeout,
    location: { pathname: HIRE_PATH },
    WfXano: wfXano,
    memberReady: Promise.resolve(member),
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
    MutationObserver: function () {
      return { observe() {} }
    },
  }
  vm.createContext(context)
  vm.runInContext(allStartersSource, context)
  assert.equal(windowStub.WfXanoConfig, undefined)
  vm.runInContext(source, context)
  bootListeners.forEach((listener) => listener())
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(windowStub.WfXanoConfig.favoritesSource, 'opp30:brand/favorites')
  assert.equal(wfXano.calls.init, 1)
  assert.ok(queried.includes(LIST_SECTION))
  assert.ok(queried.includes(CONTROL))
})

test('executable code never keys off a list marker or injects library scripts', () => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /createElement\('script'\)/)
  assert.doesNotMatch(code, /innerHTML/)
  assert.doesNotMatch(code, /data-starters-list/)
  assert.doesNotMatch(code, /cdn\.jsdelivr\.net\/gh\/the-starters\/(wf-xano|wf-algolia)/)
})
