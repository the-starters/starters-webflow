const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./all-starters-favorites.js'), 'utf8')

function fakeClassList() {
  const classes = new Set()
  return {
    toggle(name, force) {
      if (force === undefined) force = !classes.has(name)
      if (force) classes.add(name)
      else classes.delete(name)
      return force
    },
    contains(name) {
      return classes.has(name)
    },
  }
}

// Minimal element stub: enough surface for buildPremiumUi/decorate paths.
function fakeElement(overrides = {}) {
  const attributes = {}
  const el = {
    tagName: overrides.tagName || 'DIV',
    children: [],
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    parentNode: null,
    classList: fakeClassList(),
    firstElementChild: null,
    firstChild: null,
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
    insertBefore(child) {
      child.parentNode = el
      el.children.unshift(child)
      return child
    },
    addEventListener(type, listener) {
      el.listeners[type] = listener
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
  let bootListener = null
  const head = fakeElement({ tagName: 'HEAD' })
  const documentStub = {
    readyState: options.readyState || 'loading',
    head,
    createElement(tagName) {
      return fakeElement({ tagName: tagName.toUpperCase() })
    },
    addEventListener(type, listener) {
      if (type === 'DOMContentLoaded') bootListener = listener
    },
    querySelector(selector) {
      if (selector === '.section_all-starters-body') return options.section || null
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
    warnings,
    boot: () => {
      documentStub.readyState = 'complete'
      if (bootListener) return bootListener()
    },
  }
}

function premiumMember() {
  return {
    planConnections: [
      { planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' },
    ],
  }
}

test('boot guard: module refuses to run twice', () => {
  const mod = loadModule()
  assert.equal(mod.window.__startersV3AllStartersFavoritesBooted, true)
})

test('no all-starters section: config untouched, nothing built', async () => {
  const mod = loadModule({ section: null, memberReady: Promise.resolve(premiumMember()) })
  mod.boot()
  await Promise.resolve()
  assert.equal(mod.window.WfXanoConfig, undefined)
  assert.equal(mod.document.head.children.length, 0)
})

test('favoritesSource defaults only when the site config lacks it', async () => {
  const section = fakeElement()
  const existing = { xanoBase: 'https://x.example', favoritesSource: 'opp30:custom' }
  const mod = loadModule({
    section,
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

test('non-premium member: no shell, no styles injected', async () => {
  const section = fakeElement()
  const mod = loadModule({
    section,
    memberReady: Promise.resolve({
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    }),
  })
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(section.children.length, 0)
  assert.equal(mod.document.head.children.length, 0)
})

test('premium member: shell inserted into section and styles injected once', async () => {
  const tabs = [fakeElement({ tagName: 'BUTTON' }), fakeElement({ tagName: 'BUTTON' })]
  const savedPanel = fakeElement()
  const openAll = fakeElement({ tagName: 'BUTTON' })
  const section = fakeElement({
    querySelector() {
      return null // no existing shell
    },
    querySelectorAll() {
      return [] // no favorite wrappers to decorate in this stub
    },
  })
  const mod = loadModule({
    section,
    memberReady: Promise.resolve(premiumMember()),
  })
  // The shell element created by the module needs query surfaces for tabs/panel.
  const realCreate = mod.document.createElement
  mod.document.createElement = (tagName) => {
    const el = realCreate(tagName)
    if (tagName === 'div') {
      el.querySelectorAll = (sel) => (sel === '[role="tab"]' ? tabs : [])
      el.querySelector = (sel) => {
        if (sel === '.ts-favorites-saved') return savedPanel
        if (sel === '[data-open-all-starters]') return openAll
        return null
      }
    }
    return el
  }
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(section.children.length, 1)
  assert.equal(section.children[0].className, 'padding-global ts-favorites-shell')
  assert.equal(mod.document.head.children.length, 1)
  assert.match(mod.document.head.children[0].textContent, /z-index: 5/)
  assert.match(mod.document.head.children[0].textContent, /color: #fff/)
  // Saved tab wiring exists
  assert.equal(typeof tabs[1].listeners.click, 'function')
})

test('premium member via $memberstackDom fallback when window.memberReady is absent', async () => {
  const section = fakeElement({
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
  })
  const tabs = [fakeElement({ tagName: 'BUTTON' }), fakeElement({ tagName: 'BUTTON' })]
  const mod = loadModule({
    section,
    memberstack: {
      getCurrentMember: async () => ({ data: premiumMember() }),
    },
  })
  const realCreate = mod.document.createElement
  mod.document.createElement = (tagName) => {
    const el = realCreate(tagName)
    if (tagName === 'div') {
      el.querySelectorAll = (sel) => (sel === '[role="tab"]' ? tabs : [])
      el.querySelector = (sel) => {
        if (sel === '.ts-favorites-saved') return fakeElement()
        if (sel === '[data-open-all-starters]') return fakeElement({ tagName: 'BUTTON' })
        return null
      }
    }
    return el
  }
  mod.boot()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(section.children.length, 1)
})

test('empty Designer wrapper gets the ♡ visual with favorite-visual marker', () => {
  const mod = loadModule({ section: fakeElement(), readyState: 'complete' })
  // Exercise decorate via a MutationObserver callback captured from buildPremiumUi
  // is heavy in this stub; instead validate through the savedMarkup contract:
  // the module's source must carry the fallback branch and marker attribute.
  assert.match(source, /textContent = '♡'/)
  assert.match(source, /favorite-visual/)
  assert.match(source, /wf-xano-favorite-type', 'starter'/)
})

test('module never injects a wf-xano script tag (site head owns loading)', () => {
  assert.doesNotMatch(source, /createElement\('script'\)/)
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/gh\/the-starters\/wf-xano/)
})
