const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./saved-starters-roles.js'), 'utf8')

/* ------------------------------ mini DOM ------------------------------ *
 * The module rewrites a real subtree: it walks nextSibling runs, shallow-
 * clones an element (inheriting its inline style), inserts before a moving
 * anchor, and removes only its own nodes. The flat element stubs used by the
 * sibling tests cannot express any of that, so this is a small tree that
 * implements exactly the surface the module touches. Unsupported selectors
 * throw rather than silently returning nothing.
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

  get nextSibling() {
    if (!this.parentNode) return null
    const siblings = this.parentNode.childNodes
    return siblings[siblings.indexOf(this) + 1] || null
  }

  appendChild(child) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child, ref) {
    if (child.parentNode) child.remove()
    child.parentNode = this
    if (ref == null) {
      this.childNodes.push(child)
      return child
    }
    const at = this.childNodes.indexOf(ref)
    assert.notEqual(at, -1, 'mini-dom: insertBefore reference node is not a child')
    this.childNodes.splice(at, 0, child)
    return child
  }

  remove() {
    if (!this.parentNode) return
    const at = this.parentNode.childNodes.indexOf(this)
    if (at !== -1) this.parentNode.childNodes.splice(at, 1)
    this.parentNode = null
  }

  // Shallow, like the real thing: attributes and inline style copy, children
  // (and therefore the text) do not.
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

// Supports only attribute-presence selectors, optionally with one descendant
// combinator: "[a]" and "[a] [b]".
function parseSelector(selector) {
  return selector
    .trim()
    .split(/\s+/)
    .map((part) => {
      const match = /^\[([^\]=]+)\]$/.exec(part)
      if (!match) throw new Error('mini-dom: unsupported selector part: ' + part)
      return match[1]
    })
}

function walk(node, visit) {
  node.childNodes.forEach((child) => {
    if (child.nodeType === 1) {
      visit(child)
      walk(child, visit)
    }
  })
}

function queryAll(root, selector) {
  const parts = parseSelector(selector)
  if (parts.length > 2) throw new Error('mini-dom: selector too deep: ' + selector)
  const target = parts[parts.length - 1]
  const ancestor = parts.length === 2 ? parts[0] : null
  const found = []
  walk(root, (el) => {
    if (!el.hasAttribute(target)) return
    if (!ancestor) return found.push(el)
    for (let p = el.parentNode; p; p = p.parentNode) {
      if (p.hasAttribute && p.hasAttribute(ancestor)) return found.push(el)
    }
  })
  return found
}

/* ---------------------------- page fixture ---------------------------- */

function paragraph(attributes, text) {
  const p = new El('p')
  Object.entries(attributes).forEach(([name, value]) => p.setAttribute(name, value))
  p.textContent = text
  return p
}

// One saved-list wrapper: a hidden template card plus a rendered card per
// `roles` string given. Each card also carries an availability paragraph, which
// must never be de-hyphenated.
function buildPage({ roles = [], rolesAttr = 'data-ts-roles', availability = '11-20' } = {}) {
  const documentEl = new El('html')
  const root = new El('div')
  root.setAttribute('wf-xano-element', 'wrapper')
  root.setAttribute('wf-xano-instance', 'saved-starters')
  documentEl.appendChild(root)

  const template = new El('article')
  template.setAttribute('wf-xano-element', 'template')
  const templateRoles = paragraph({ 'wf-xano-bind': 'roles', [rolesAttr]: '' }, '')
  template.appendChild(templateRoles)
  root.appendChild(template)

  const cards = roles.map((value) => {
    const card = new El('article')
    card.setAttribute('wf-xano-item', '')
    const rolesEl = paragraph({ 'wf-xano-bind': 'roles', [rolesAttr]: '', class: 'role-chip' }, value)
    const availabilityEl = paragraph({ 'wf-xano-bind': 'availability' }, availability)
    card.appendChild(rolesEl)
    card.appendChild(availabilityEl)
    root.appendChild(card)
    return { card, rolesEl, availabilityEl }
  })

  return { documentEl, root, template, templateRoles, cards }
}

function chipsAfter(sourceEl) {
  const out = []
  for (let node = sourceEl.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue
    if (!node.hasAttribute('data-ts-roles-chip')) break
    out.push(node)
  }
  return out
}

const chipText = (sourceEl) => chipsAfter(sourceEl).map((chip) => chip.textContent)

/* ---------------------------- module loader --------------------------- */

function loadModule({
  page,
  hostname = 'the-starters-3-0.webflow.io',
  withInstance = true,
  debug,
  // 'array'  = wf-xano has not loaded yet, window.WfXano is the pre-load queue.
  // 'object' = wf-xano's module scope has run (window.WfXano is the API object)
  //            but boot() has NOT yet created instances, so get() returns null.
  //            This ordering is what a deferred page script actually hits.
  wfXano = 'array',
} = {}) {
  const warnings = []
  const listeners = {}
  const instance = {
    key: 'saved-starters',
    root: page.root,
    on(event, handler) {
      ;(listeners[event] = listeners[event] || []).push(handler)
      return this
    },
  }

  let booted = false
  const api = {
    get(key) {
      // Real wf-xano creates instances inside boot(); before that the list is
      // empty and get() resolves to null for every key.
      if (wfXano === 'object' && !booted) return null
      if (!withInstance) return null
      return key === 'saved-starters' ? instance : null
    },
    // Mirrors wf-xano's own push(): run now if booted, else queue until boot.
    push(fn) {
      if (typeof fn !== 'function') return
      if (booted) fn(api)
      else queue.push(fn)
    },
  }

  const queue = []
  // Manual timer queue so the 60ms relayout debounce is deterministic.
  const timers = new Map()
  let timerId = 0
  const dispatched = []
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
    document: {
      readyState: 'complete',
      querySelector: (selector) => page.documentEl.querySelector(selector),
      querySelectorAll: (selector) => page.documentEl.querySelectorAll(selector),
      addEventListener: () => {},
    },
  }
  sandbox.window = sandbox
  sandbox.window.WfXano = wfXano === 'object' ? api : queue
  sandbox.window.dispatchEvent = (event) => dispatched.push(event.type)
  if (debug !== undefined) sandbox.window.STARTERS_DEBUG = debug

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)

  // boot() pushes arm() onto the pre-load queue; wf-xano would call it after
  // init(document) has created every instance.
  // wf-xano's boot(): create instances, then run everything that queued.
  const drain = () => {
    booted = true
    queue.splice(0).forEach((fn) => fn(api))
  }
  const emitResults = () => (listeners.results || []).forEach((fn) => fn({ items: [] }))
  // Re-run the same file in the same realm, as a duplicate CDN tag would.
  const reevaluate = () => vm.runInContext(source, sandbox)
  // Fire every pending debounce callback.
  const flushTimers = () => {
    const pending = Array.from(timers.values())
    timers.clear()
    pending.forEach(({ fn }) => fn())
  }
  const pendingTimerDelays = () => Array.from(timers.values()).map((t) => t.ms)

  return {
    warnings,
    queue,
    drain,
    emitResults,
    reevaluate,
    instance,
    dispatched,
    flushTimers,
    pendingTimerDelays,
  }
}

function render(options) {
  const page = buildPage(options)
  const mod = loadModule({ page, ...options })
  mod.drain()
  mod.emitResults()
  return { page, ...mod }
}

/* -------------------------------- tests ------------------------------- */

test('splits a comma-delimited roles string into one chip per role', () => {
  const { page } = render({ roles: ['growth-marketer,paid-social-marketer'] })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth marketer', 'paid social marketer'])
})

test('splits a semicolon-delimited roles string', () => {
  const { page } = render({ roles: ['growth-strategy; paid-social; paid-search-sem'] })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth strategy', 'paid social', 'paid search sem'])
})

test('splits on both delimiters in one value', () => {
  const { page } = render({ roles: ['growth-strategy; paid-social,cro-expert'] })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth strategy', 'paid social', 'CRO Expert'])
})

// REGRESSION: ROLE_NAMES overrides the display text for slugs that plain
// de-hyphenation mangles, and is consulted only for the mapped slug. One value
// covering both branches pins the override and proves it did not widen: an
// unmapped slug alongside it must still come out de-hyphenated, untouched.
test('renders a mapped slug in display case while unmapped slugs still de-hyphenate', () => {
  const { page } = render({ roles: ['ui-ux-designer,growth-marketer'] })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['UI/UX Designer', 'growth marketer'])
})

test('collapses whitespace and drops empty segments', () => {
  const { page } = render({ roles: ['  ui--ux-designer , , ;  brand-strategy  '] })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['ui ux designer', 'brand strategy'])
})

test('de-duplicates roles case-insensitively', () => {
  const { page } = render({ roles: ['paid-social, Paid-Social; paid social'] })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['paid social'])
})

test('a blank value produces no chips and leaves nothing visible', () => {
  const { page } = render({ roles: [''] })
  assert.deepEqual(chipsAfter(page.cards[0].rolesEl), [])
  assert.equal(page.cards[0].rolesEl.style.display, 'none')
})

test('a punctuation-only value produces no chips', () => {
  const { page } = render({ roles: [' ; , - '] })
  assert.deepEqual(chipsAfter(page.cards[0].rolesEl), [])
})

test('never touches the hidden template (chips there would clone into every card)', () => {
  const { page } = render({ roles: ['growth-marketer'] })
  assert.deepEqual(chipsAfter(page.templateRoles), [])
  assert.equal(page.templateRoles.style.display, undefined)
})

test('leaves the availability bind alone — de-hyphenation must not reach "11-20"', () => {
  const { page } = render({ roles: ['growth-marketer'], availability: '11-20' })
  assert.equal(page.cards[0].availabilityEl.textContent, '11-20')
  assert.deepEqual(chipsAfter(page.cards[0].availabilityEl), [])
})

test('keeps the bound source element in the DOM, hidden and still bound', () => {
  const { page } = render({ roles: ['growth-marketer,cro-expert'] })
  const { rolesEl, card } = page.cards[0]
  assert.equal(rolesEl.parentNode, card, 'source must never be replaced — keyed re-bind needs it')
  assert.equal(rolesEl.style.display, 'none')
  assert.equal(rolesEl.getAttribute('wf-xano-bind'), 'roles')
  assert.equal(rolesEl.textContent, 'growth-marketer,cro-expert', 'raw value stays readable')
})

test('chips carry no bind attributes, so a keyed re-bind cannot overwrite them', () => {
  const { page } = render({ roles: ['growth-marketer,cro-expert'] })
  chipsAfter(page.cards[0].rolesEl).forEach((chip) => {
    assert.equal(chip.hasAttribute('wf-xano-bind'), false)
    assert.equal(chip.hasAttribute('wf-xano-default'), false)
    assert.equal(chip.hasAttribute('wf-xano-prefix'), false)
    assert.equal(chip.hasAttribute('data-ts-roles'), false, 'a chip must not be re-split as a source')
    assert.equal(chip.hasAttribute('data-ts-roles-chip'), true)
  })
})

test('chips inherit the source classes but not its hidden inline display', () => {
  const { page } = render({ roles: ['growth-marketer'] })
  const [chip] = chipsAfter(page.cards[0].rolesEl)
  assert.equal(chip.getAttribute('class'), 'role-chip')
  assert.equal(chip.tagName, 'P')
  assert.equal(chip.style.display, '')
})

test('is idempotent across re-renders — the keyed path reuses the same card', () => {
  const { page, emitResults } = render({ roles: ['growth-marketer,cro-expert'] })
  emitResults()
  emitResults()
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth marketer', 'CRO Expert'])
})

test('rebuilds chips when a reused card is re-bound to a different Starter', () => {
  const { page, emitResults } = render({ roles: ['growth-marketer,cro-expert'] })
  // What fillCard(card, item, true) does on a keyed re-render: rewrite the
  // bound element's text in place, leaving this script's chips stale.
  page.cards[0].rolesEl.textContent = 'brand-strategy'
  emitResults()
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['brand strategy'])
})

test('handles every rendered card, not just the first', () => {
  const { page } = render({ roles: ['growth-marketer', 'cro-expert;paid-social'] })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth marketer'])
  assert.deepEqual(chipText(page.cards[1].rolesEl), ['CRO Expert', 'paid social'])
})

// REGRESSION: wf-xano assigns window.WfXano = {api} at module scope, before its
// boot() creates any instance. A deferred page script lands in that window. The
// old code branched on Array.isArray, called arm() directly, found no instance,
// warned, and gave up permanently — the saved list never got its roles split.
test('queues through push() when WfXano is the API object but has not booted yet', () => {
  const page = buildPage({ roles: ['growth-marketer,cro-expert'] })
  const mod = loadModule({ page, wfXano: 'object' })
  // Must not have armed against the empty instance list.
  assert.deepEqual(mod.warnings, [], 'must not warn: the instance simply does not exist yet')
  assert.deepEqual(chipsAfter(page.cards[0].rolesEl), [], 'nothing rendered before boot')
  // wf-xano boots: instances exist, queued callbacks run.
  mod.drain()
  mod.emitResults()
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth marketer', 'CRO Expert'])
  assert.deepEqual(mod.warnings, [])
})

test('still works when WfXano is the API object and already booted', () => {
  const page = buildPage({ roles: ['head-of-growth;analytics-director'] })
  const mod = loadModule({ page, wfXano: 'object' })
  mod.drain()
  mod.emitResults()
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['head of growth', 'analytics director'])
})

test('warns only when the instance is genuinely absent after boot', () => {
  const page = buildPage({ roles: ['growth-marketer'] })
  const mod = loadModule({ page, wfXano: 'object', withInstance: false })
  mod.drain()
  assert.equal(mod.warnings.length, 1)
  assert.match(mod.warnings[0], /no wf-xano instance "saved-starters"/)
  // Still splits what is already on the page rather than leaving raw text.
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth marketer'])
})

test('does not arm at all when the page has no roles element', () => {
  const page = buildPage({ roles: ['growth-marketer'], rolesAttr: 'data-ts-unrelated' })
  const mod = loadModule({ page })
  assert.deepEqual(mod.queue, [], 'marker gate must bail before touching WfXano')
})

test('warns on staging when the instance is missing, but still splits what is rendered', () => {
  const { page, warnings } = render({ roles: ['growth-marketer'], withInstance: false })
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth marketer'])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /no wf-xano instance "saved-starters"/)
})

test('stays silent in production when the instance is missing', () => {
  const { warnings } = render({
    roles: ['growth-marketer'],
    withInstance: false,
    hostname: 'thestarters.com',
  })
  assert.deepEqual(warnings, [])
})

test('STARTERS_DEBUG re-enables the warning in production', () => {
  const { warnings } = render({
    roles: ['growth-marketer'],
    withInstance: false,
    hostname: 'thestarters.com',
    debug: true,
  })
  assert.equal(warnings.length, 1)
})

test('requests an expert-card relayout after chips change, so hover height recomputes', () => {
  const { dispatched, flushTimers, pendingTimerDelays } = render({
    roles: ['growth-marketer,cro-expert'],
  })
  assert.deepEqual(pendingTimerDelays(), [60], 'relayout must be debounced, matching the sibling modifier')
  assert.deepEqual(dispatched, [], 'nothing dispatched before the debounce fires')
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
})

test('does not request a relayout when a repeated pass changes nothing', () => {
  const { dispatched, flushTimers, emitResults } = render({ roles: ['growth-marketer,cro-expert'] })
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
  emitResults()
  emitResults()
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'], 'no-op passes must not ping-pong with the layout listener')
})

test('requests a relayout again when a re-bound card changes its roles', () => {
  const { page, dispatched, flushTimers, emitResults } = render({ roles: ['growth-marketer'] })
  flushTimers()
  page.cards[0].rolesEl.textContent = 'brand-strategy;cro-expert'
  emitResults()
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout', 'expert-cards:relayout'])
})

test('one relayout for a whole multi-card pass, not one per card', () => {
  const { dispatched, flushTimers } = render({
    roles: ['growth-marketer,cro-expert', 'paid-social', 'head-of-growth;analytics-director'],
  })
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
})

test('relayouts once for a blank value too, since hiding the raw text collapses the wrapper', () => {
  const { dispatched, flushTimers, emitResults } = render({ roles: ['', ' ; , '] })
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'], 'hiding the source is itself a height change')
  // But the pass is now settled, so repeats must stay quiet.
  emitResults()
  flushTimers()
  assert.deepEqual(dispatched, ['expert-cards:relayout'])
})

test('boots only once even if the file loads twice', () => {
  const page = buildPage({ roles: ['growth-marketer'] })
  const mod = loadModule({ page })
  assert.equal(mod.queue.length, 1)
  mod.reevaluate()
  assert.equal(mod.queue.length, 1, 'second evaluation must not queue a second arm()')
})

test('a duplicate load does not double the chips', () => {
  const page = buildPage({ roles: ['growth-marketer,cro-expert'] })
  const mod = loadModule({ page })
  mod.reevaluate()
  mod.drain()
  mod.emitResults()
  assert.deepEqual(chipText(page.cards[0].rolesEl), ['growth marketer', 'CRO Expert'])
})
