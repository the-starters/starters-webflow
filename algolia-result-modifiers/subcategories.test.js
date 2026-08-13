const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./subcategories.js'),
  'utf8',
)

/* ------------------------------ mini DOM ------------------------------ *
 * The modifier rewrites a real subtree: it query-selects injected hooks,
 * shallow-clones the seed, and replaceWith's clones. The harness implements
 * only that surface. Unsupported selectors throw rather than silently
 * matching nothing.
 * -------------------------------------------------------------------- */

class El {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.nodeType = 1
    this.attributes = Object.create(null)
    this.childNodes = []
    this.parentNode = null
    this.style = {}
    this.textContent = ''
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }

  hasAttribute(name) {
    return name in this.attributes
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  get className() {
    return this.getAttribute('class') || ''
  }

  appendChild(child) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  remove() {
    if (!this.parentNode) return
    const at = this.parentNode.childNodes.indexOf(this)
    if (at !== -1) this.parentNode.childNodes.splice(at, 1)
    this.parentNode = null
  }

  replaceWith(...nodes) {
    const parent = this.parentNode
    if (!parent) return
    const at = parent.childNodes.indexOf(this)
    assert.notEqual(at, -1, 'mini-dom: replaceWith node is not a child')
    nodes.forEach((node) => {
      if (node.parentNode) node.remove()
      node.parentNode = parent
    })
    parent.childNodes.splice(at, 1, ...nodes)
    this.parentNode = null
  }

  cloneNode(deep) {
    assert.equal(deep, false, 'mini-dom: only shallow cloneNode is supported')
    const clone = new El(this.tagName)
    Object.assign(clone.attributes, this.attributes)
    Object.assign(clone.style, this.style)
    return clone
  }

  querySelector(selector) {
    return queryAll(this, selector)[0] || null
  }

  querySelectorAll(selector) {
    return queryAll(this, selector)
  }
}

function walk(node, visit) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 1) {
      visit(child)
      walk(child, visit)
    }
  })
}

function matchSimple(el, simple) {
  const token = simple.trim()
  if (token.startsWith('.')) {
    const cls = token.slice(1)
    return el.className.split(/\s+/).includes(cls)
  }
  const eq = /^\[([^=\]]+)="([^"]*)"\]$/.exec(token)
  if (eq) return el.getAttribute(eq[1]) === eq[2]
  const pres = /^\[([^=\]]+)\]$/.exec(token)
  if (pres) return el.hasAttribute(pres[1])
  throw new Error('mini-dom: unsupported selector part: ' + token)
}

function matchCompound(el, compound) {
  // Each descendant step is already a single simple selector. Do not split
  // on "." — attribute values such as categories.lvl1 contain dots.
  return matchSimple(el, compound.trim())
}

function queryAll(root, selector) {
  const groups = selector.split(',').map((group) => group.trim())
  const found = []
  const seen = new Set()
  groups.forEach((group) => {
    const steps = group.split(/\s+/).filter(Boolean)
    if (steps.length > 2) {
      throw new Error('mini-dom: selector too deep: ' + group)
    }
    const target = steps[steps.length - 1]
    const ancestor = steps.length === 2 ? steps[0] : null
    walk(root, (el) => {
      if (!matchCompound(el, target)) return
      if (ancestor) {
        let hit = false
        for (let p = el.parentNode; p; p = p.parentNode) {
          if (p.nodeType === 1 && matchCompound(p, ancestor)) {
            hit = true
            break
          }
        }
        if (!hit) return
      }
      if (seen.has(el)) return
      seen.add(el)
      found.push(el)
    })
  })
  return found
}

function paragraph(attributes, text) {
  const p = new El('p')
  Object.entries(attributes).forEach(([name, value]) => p.setAttribute(name, value))
  p.textContent = text
  return p
}

function buildPage({
  joinedPaths = 'Paid Media > Performance Creative Strategy',
  includeTemplateHook = true,
  includeInjected = true,
  includeBrowse = true,
  includeResults = true,
  includeRoles = false,
  rolesText = 'cro-expert,ui-ux-designer',
} = {}) {
  const documentEl = new El('html')

  const browse = new El('div')
  browse.setAttribute('wf-algolia-element', 'browse')
  if (includeTemplateHook) {
    browse.appendChild(
      paragraph({ 'wf-algolia-text': 'categories.lvl1', class: 'subcategory-tag' }, ''),
    )
  }
  documentEl.appendChild(browse)

  const results = new El('div')
  results.setAttribute('wf-algolia-element', 'results')
  documentEl.appendChild(results)

  const card = new El('div')
  card.setAttribute('class', 'wf-algolia-injected')
  const seed = paragraph(
    { 'wf-algolia-text': 'categories.lvl1', class: 'subcategory-tag' },
    joinedPaths,
  )
  card.appendChild(seed)
  let rolesEl = null
  if (includeRoles) {
    rolesEl = paragraph({ 'wf-algolia-text': 'roles', class: 'role-tag' }, rolesText)
    card.appendChild(rolesEl)
  }

  const host = includeBrowse ? browse : includeResults ? results : documentEl
  if (includeInjected) host.appendChild(card)
  if (!includeBrowse) browse.remove()
  if (!includeResults) results.remove()

  return { documentEl, browse, results, card, seed, rolesEl }
}

function tagsIn(card) {
  return card.childNodes.filter(
    (node) => node.nodeType === 1 && node.className.split(/\s+/).includes('subcategory-tag'),
  )
}

const tagText = (card) => tagsIn(card).map((el) => el.textContent)

function loadModule({
  page,
  hostname = 'the-starters-3-0.webflow.io',
  withEngine = true,
  debug,
} = {}) {
  const warnings = []
  const listeners = {}
  const timers = new Map()
  let timerId = 0
  const dispatched = []
  const observed = []

  const sandbox = {
    console: {
      warn: (...args) => warnings.push(args.join(' ')),
      error: () => {},
      log: () => {},
    },
    location: { hostname },
    setTimeout: (fn, ms) => {
      timers.set(++timerId, { fn, ms })
      return timerId
    },
    clearTimeout: (id) => {
      timers.delete(id)
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type
        this.detail = init && init.detail
      }
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
      }
      observe(target, options) {
        observed.push({ target, options })
      }
      disconnect() {}
    },
    document: {
      readyState: 'complete',
      querySelector: (selector) => page.documentEl.querySelector(selector),
      querySelectorAll: (selector) => page.documentEl.querySelectorAll(selector),
      addEventListener: () => {},
    },
  }
  sandbox.window = sandbox
  sandbox.window.dispatchEvent = (event) => dispatched.push(event.type)
  if (withEngine) {
    sandbox.window.WfAlgolia = {
      on(event, handler) {
        ;(listeners[event] = listeners[event] || []).push(handler)
      },
    }
  }
  if (debug !== undefined) sandbox.window.STARTERS_DEBUG = debug

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  const emitResults = (payload) => (listeners.results || []).forEach((fn) => fn(payload))
  const reevaluate = () => vm.runInContext(source, sandbox)
  const flushTimers = () => {
    const pending = Array.from(timers.values())
    timers.clear()
    pending.forEach(({ fn }) => fn())
  }
  const pendingTimerDelays = () => Array.from(timers.values()).map((t) => t.ms)

  return {
    warnings,
    listeners,
    observed,
    dispatched,
    emitResults,
    reevaluate,
    flushTimers,
    pendingTimerDelays,
  }
}

function render(options) {
  const page = buildPage(options)
  const mod = loadModule({ page, ...options })
  return { page, ...mod }
}

test('splits three hierarchical paths into one Subcategory tag per leaf', () => {
  const joined =
    'Paid Media > Performance Creative Strategy,Creative > Video & Production,Content & Organic > Content Creation & UGC'
  const { page } = render({ joinedPaths: joined })
  assert.deepEqual(tagText(page.card), [
    'Performance Creative Strategy',
    'Video & Production',
    'Content Creation & UGC',
  ])
})

test('does not split on a comma inside a parent Category name', () => {
  const joined =
    'Influencer, Affiliate & PR > Influencer Marketing,Paid Media > Growth Marketing'
  const { page } = render({ joinedPaths: joined })
  assert.deepEqual(tagText(page.card), [
    'Influencer Marketing',
    'Growth Marketing',
  ])
})

test('cleans a single path in place and strips the hook', () => {
  const { page } = render({
    joinedPaths: 'Paid Media > Performance Creative Strategy',
  })
  assert.equal(page.card.childNodes.length, 1)
  assert.equal(page.seed.textContent, 'Performance Creative Strategy')
  assert.equal(page.seed.hasAttribute('wf-algolia-text'), false)
  assert.equal(page.seed.getAttribute('class'), 'subcategory-tag')
})

test('a path with no > displays as the whole string', () => {
  const { page } = render({ joinedPaths: 'Performance Creative Strategy' })
  assert.deepEqual(tagText(page.card), ['Performance Creative Strategy'])
})

test('a hyphenated leaf with no > is not treated as punctuation', () => {
  const { page } = render({ joinedPaths: 'CRO-Experimentation' })
  assert.deepEqual(tagText(page.card), ['CRO-Experimentation'])
})

test('a three-level path displays only the last segment', () => {
  const { page } = render({ joinedPaths: 'A > B > C' })
  assert.deepEqual(tagText(page.card), ['C'])
})

test('blanks an empty value and strips the hook, leaving the node', () => {
  const { page } = render({ joinedPaths: '' })
  assert.equal(page.card.childNodes.length, 1)
  assert.equal(page.seed.textContent, '')
  assert.equal(page.seed.hasAttribute('wf-algolia-text'), false)
})

test('blanks punctuation-only values so a stray separator never renders', () => {
  const { page } = render({ joinedPaths: ',' })
  assert.deepEqual(tagText(page.card), [''])
  assert.equal(page.seed.hasAttribute('wf-algolia-text'), false)
})

test('blanks a >-only value so a stray separator never renders', () => {
  const { page } = render({ joinedPaths: '>' })
  assert.deepEqual(tagText(page.card), [''])
  assert.equal(page.seed.hasAttribute('wf-algolia-text'), false)
})

test('never rewrites the hidden template', () => {
  const { page } = render({
    joinedPaths: 'Paid Media > Performance Creative Strategy',
  })
  const template = page.browse.childNodes[0]
  assert.equal(template.getAttribute('wf-algolia-text'), 'categories.lvl1')
  assert.equal(template.textContent, '')
})

test('leaves a roles hook on the same card alone', () => {
  const { page } = render({
    joinedPaths: 'Paid Media > Performance Creative Strategy',
    includeRoles: true,
  })
  assert.equal(page.rolesEl.textContent, 'cro-expert,ui-ux-designer')
  assert.equal(page.rolesEl.getAttribute('wf-algolia-text'), 'roles')
})

test('does not arm when the page has no subcategory hook', () => {
  const page = buildPage({ includeTemplateHook: false, includeInjected: false })
  const mod = loadModule({ page })
  assert.deepEqual(mod.listeners, {}, 'marker gate must bail before touching WfAlgolia')
  assert.deepEqual(mod.observed, [])
})

test('clones inherit the seed class and drop the hook', () => {
  const { page } = render({
    joinedPaths:
      'Paid Media > Performance Creative Strategy,Creative > Video & Production',
  })
  const tags = tagsIn(page.card)
  assert.equal(tags.length, 2)
  tags.forEach((tag) => {
    assert.equal(tag.getAttribute('class'), 'subcategory-tag')
    assert.equal(tag.hasAttribute('wf-algolia-text'), false)
    assert.equal(tag.tagName, 'P')
  })
})

test('keeps stored capitalization, including ampersands and slashes', () => {
  const { page } = render({
    joinedPaths: 'Analytics & Experimentation > CRO & Experimentation,Creative > UI/UX Design',
  })
  assert.deepEqual(tagText(page.card), [
    'CRO & Experimentation',
    'UI/UX Design',
  ])
})

test('does not read the results payload — federated shape with no hits still rewrites', () => {
  const page = buildPage({
    joinedPaths: 'Paid Media > Performance Creative Strategy',
  })
  const mod = loadModule({ page })
  // init already ran once; a later federated payload must still be ignored.
  page.seed.setAttribute('wf-algolia-text', 'categories.lvl1')
  page.seed.textContent = 'Creative > Video & Production'
  mod.emitResults({ results: [], nbHits: 1, nbPages: 1 })
  assert.deepEqual(tagText(page.card), ['Video & Production'])
})

test('boots only once even if the file loads twice', () => {
  const page = buildPage({
    joinedPaths: 'Paid Media > Performance Creative Strategy,Creative > Video & Production',
  })
  const mod = loadModule({ page })
  assert.equal((mod.listeners.results || []).length, 1)
  mod.reevaluate()
  assert.equal((mod.listeners.results || []).length, 1)
  assert.deepEqual(tagText(page.card), [
    'Performance Creative Strategy',
    'Video & Production',
  ])
})

test('warns on staging when no browse or results container exists', () => {
  const page = buildPage({
    joinedPaths: 'Paid Media > Performance Creative Strategy',
    includeBrowse: false,
    includeResults: false,
  })
  const mod = loadModule({ page, hostname: 'the-starters-3-0.webflow.io' })
  assert.equal(mod.warnings.length, 1)
  assert.match(mod.warnings[0], /no wf-algolia browse\/results container/)
  assert.deepEqual(tagText(page.card), ['Performance Creative Strategy'])
})

test('stays silent in production when no container exists', () => {
  const page = buildPage({
    joinedPaths: 'Paid Media > Performance Creative Strategy',
    includeBrowse: false,
    includeResults: false,
  })
  const mod = loadModule({ page, hostname: 'thestarters.com' })
  assert.deepEqual(mod.warnings, [])
})

test('STARTERS_DEBUG re-enables the warning in production', () => {
  const page = buildPage({
    joinedPaths: 'Paid Media > Performance Creative Strategy',
    includeBrowse: false,
    includeResults: false,
  })
  const mod = loadModule({
    page,
    hostname: 'thestarters.com',
    debug: true,
  })
  assert.equal(mod.warnings.length, 1)
})

test('requests an expert-card relayout after tags change', () => {
  const { dispatched, flushTimers, pendingTimerDelays } = render({
    joinedPaths:
      'Paid Media > Performance Creative Strategy,Creative > Video & Production',
  })
  assert.deepEqual(pendingTimerDelays(), [60])
  assert.deepEqual(dispatched, [])
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
})

test('does not request a relayout when a repeated pass changes nothing', () => {
  const { dispatched, flushTimers, emitResults } = render({
    joinedPaths:
      'Paid Media > Performance Creative Strategy,Creative > Video & Production',
  })
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
  emitResults()
  emitResults()
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
})

test('relayouts when blanking a raw value, because hiding that text changes height', () => {
  const { dispatched, flushTimers, emitResults } = render({ joinedPaths: ',' })
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
  emitResults()
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
})
