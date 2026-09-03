const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'password-validation.js'), 'utf8')

/** the attribute prefix that IS the component's public API */
const P = 'starters-password-validation-'

// ---------------------------------------------------------------------------
// Minimal DOM. Only what password-validation.js actually touches: attributes,
// classes, style.display, text nodes (the {count} token lives in one), a tiny
// selector engine (tag / [attr] / [attr="v"] / .class / comma groups),
// matches(), closest('form'), and a dispatcher with real capture-then-bubble
// ordering so a capture-phase submit blocker can be observed beating a page's
// bubble-phase handler.
// ---------------------------------------------------------------------------

/**
 * @param {Element} el
 * @param {string} sel one compound selector (no combinators)
 * @returns {boolean}
 */
function matchesSimple(el, sel) {
  let rest = sel.trim()
  if (!rest) return false
  while (rest) {
    let m
    if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) {
      const value = el.getAttribute(m[1])
      if (value === null) return false
      if (m[2] !== undefined && value !== m[2]) return false
    } else if ((m = /^\.([\w-]+)/.exec(rest))) {
      if (!el.classList.contains(m[1])) return false
    } else if ((m = /^([a-zA-Z][\w-]*)/.exec(rest))) {
      if (el.tagName !== m[1].toUpperCase()) return false
    } else {
      throw new Error('unsupported selector: ' + sel)
    }
    rest = rest.slice(m[0].length)
  }
  return true
}

const matches = (el, selector) => selector.split(',').some((part) => matchesSimple(el, part))

class Text {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = String(value)
    this.parentElement = null
  }
}

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this._attrs = new Map()
    this.childNodes = []
    this.parentElement = null
    this.style = {}
    this.value = ''
    this.disabled = undefined
    this._listeners = new Map()

    const classes = new Set()
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    }

    Object.keys(attrs).forEach((key) => this.setAttribute(key, attrs[key]))
    children.forEach((child) => this.append(child))
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1)
  }

  get textContent() {
    return this.childNodes
      .map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent))
      .join('')
  }

  set textContent(value) {
    this.childNodes = []
    this.append(String(value))
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value))
  }
  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }
  hasAttribute(name) {
    return this._attrs.has(name)
  }
  removeAttribute(name) {
    this._attrs.delete(name)
  }

  append(child) {
    const node = typeof child === 'string' ? new Text(child) : child
    node.parentElement = this
    this.childNodes.push(node)
    return node
  }

  descendants() {
    const out = []
    const walk = (node) =>
      node.children.forEach((child) => {
        out.push(child)
        walk(child)
      })
    walk(this)
    return out
  }

  querySelectorAll(selector) {
    return this.descendants().filter((el) => matches(el, selector))
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  matches(selector) {
    return matches(this, selector)
  }
  contains(node) {
    for (let n = node; n; n = n.parentElement) if (n === this) return true
    return false
  }
  /** detach from the tree, so a swapped-out CTA subtree can be modelled */
  remove() {
    const parent = this.parentElement
    if (!parent) return
    parent.childNodes = parent.childNodes.filter((n) => n !== this)
    this.parentElement = null
  }
  closest(selector) {
    let node = this
    while (node) {
      if (matches(node, selector)) return node
      node = node.parentElement
    }
    return null
  }

  addEventListener(type, listener, capture) {
    const list = this._listeners.get(type) || []
    list.push({ listener, capture: capture === true || (capture && capture.capture === true) })
    this._listeners.set(type, list)
  }

  /** minimal EventTarget.dispatchEvent: routes through the harness dispatcher */
  dispatchEvent(evt) {
    const result = dispatch(this, evt.type)
    if (result.defaultPrevented && typeof evt.preventDefault === 'function') evt.preventDefault()
    return !result.defaultPrevented
  }

  /** how many listeners of `type` are bound here (idempotence probe) */
  listenerCount(type) {
    return (this._listeners.get(type) || []).length
  }
}

/** @returns {Element} */
const h = (tag, attrs, children) => new Element(tag, attrs || {}, children || [])

/**
 * Dispatch with real DOM phase ordering: capture listeners run root -> target
 * (the target's own capture listeners included), then bubble listeners run
 * target -> root. stopImmediatePropagation halts everything after it.
 * @param {Element} target
 * @param {string} type
 * @param {object} [extra]
 */
function dispatch(target, type, extra) {
  const event = Object.assign(
    {
      type,
      target,
      currentTarget: null,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      stopImmediatePropagation() {
        this.stopped = true
      },
    },
    extra || {},
  )

  const path = []
  for (let node = target; node; node = node.parentElement) path.push(node)

  const run = (el, wantCapture) => {
    event.currentTarget = el
    const list = (el._listeners.get(type) || []).slice()
    for (const entry of list) {
      if (event.stopped) return
      if (!!entry.capture !== wantCapture) continue
      entry.listener.call(el, event)
    }
  }

  for (let i = path.length - 1; i >= 0 && !event.stopped; i--) run(path[i], true)
  for (let i = 0; i < path.length && !event.stopped; i++) run(path[i], false)
  return event
}

/**
 * Run the script against a fake document whose body is `root`.
 * @param {Element} root
 * @param {{hostname?: string, debug?: boolean, loadTwice?: boolean, readyState?: string}} [options]
 * @returns {{window: object, warnings: string[], root: Element, fireReady: () => void}}
 */
function mount(root, options = {}) {
  const documentListeners = new Map()
  const warnings = []
  const document = {
    readyState: options.readyState || 'complete',
    addEventListener(type, listener) {
      const list = documentListeners.get(type) || []
      list.push(listener)
      documentListeners.set(type, list)
    },
    querySelectorAll: (selector) => root.querySelectorAll(selector),
  }
  const location = { hostname: options.hostname || 'www.thestarters.com' }
  const window = { location }
  if (options.debug !== undefined) window.STARTERS_DEBUG = options.debug
  if (options.fetch) window.fetch = options.fetch
  window.window = window

  /** what `new Event(type, opts)` gives the script inside the VM */
  class FakeEvent {
    constructor(type, opts = {}) {
      this.type = type
      this.bubbles = !!opts.bubbles
      this.cancelable = !!opts.cancelable
      this.defaultPrevented = false
    }
    preventDefault() {
      this.defaultPrevented = true
    }
  }

  const context = vm.createContext({
    window,
    document,
    location,
    Event: FakeEvent,
    // Real timers, unref'd so a pending watcher timeout never holds the
    // test process open.
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms)
      if (t.unref) t.unref()
      return t
    },
    clearTimeout: (t) => clearTimeout(t),
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
  })
  vm.runInContext(source, context)
  if (options.loadTwice) vm.runInContext(source, context)

  /** run the DOMContentLoaded handlers the script parked while the DOM parsed */
  const fireReady = () => {
    ;(documentListeners.get('DOMContentLoaded') || []).forEach((listener) => listener())
  }

  return { window, warnings, root, fireReady }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_RULES = ['characters', 'special', 'capitalization', 'numbers']

const DEFAULT_TEXT = {
  characters: 'At least {count} characters',
  special: 'One special character',
  capitalization: 'Upper and lower case',
  numbers: 'One number',
}

/**
 * @param {string} rule
 * @param {string} text
 * @param {{icons?: boolean}} [opts]
 */
function ruleRow(rule, text, opts = {}) {
  const kids = []
  if (opts.icons !== false) {
    kids.push(h('span', { [P + 'icon']: 'valid' }))
    kids.push(h('span', { [P + 'icon']: 'invalid' }))
  }
  kids.push(text)
  return h('li', { [P + 'rule']: rule }, kids)
}

/**
 * One component wrapper: the config attributes plus its checklist.
 * @param {object} config attribute suffix -> value, e.g. { characters: 'true' }
 * @param {{rows?: string[]|null, text?: object, noWrapper?: boolean, icons?: boolean, heading?: string}} [opts]
 */
function buildWrapper(config, opts = {}) {
  const rowNames = opts.rows === undefined ? ALL_RULES : opts.rows || []
  const text = Object.assign({}, DEFAULT_TEXT, opts.text || {})
  const rows = {}
  rowNames.forEach((name) => {
    rows[name] = ruleRow(name, text[name], { icons: opts.icons })
  })

  const attrs = {}
  if (!opts.noWrapper) {
    Object.keys(config).forEach((key) => {
      attrs[P + key] = config[key]
    })
  }
  const kids = []
  if (opts.heading !== undefined) kids.push(h('h4', {}, [opts.heading]))
  kids.push(h('ul', {}, rowNames.map((n) => rows[n])))
  return { wrapper: h('div', attrs, kids), rows }
}

/**
 * A form + wrapper pair.
 * @param {object} config attribute suffix -> value, e.g. { characters: 'true' }
 * @param {object} [opts] buildWrapper opts plus noInput / noButton / wrapperOutsideForm
 */
function makeForm(config, opts = {}) {
  const { wrapper, rows } = buildWrapper(config, opts)

  const input = h('input', { type: 'password', 'data-ms-member': 'password' })
  const button = h('button', { type: 'submit', 'ms-code-submit-button': '' })
  const inForm = []
  if (!opts.noInput) inForm.push(input)
  if (!opts.wrapperOutsideForm) inForm.push(wrapper)
  if (!opts.noButton) inForm.push(button)
  const form = h('form', {}, inForm)

  // the page's own bubble-phase submit handler (the demo's "submitted!" line)
  const submits = []
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submits.push(event)
  })

  return { wrapper, rows, input, button, form, submits }
}

/**
 * @param {object} config
 * @param {object} [opts] forwarded to makeForm; `mount` options under .mount
 */
function setup(config, opts = {}) {
  const f = makeForm(config, opts)
  const kids = opts.wrapperOutsideForm ? [f.form, f.wrapper] : [f.form]
  const root = h('body', {}, kids)
  const app = mount(root, opts.mount || {})
  return Object.assign({ root }, f, app)
}

/** a staging mount, where devWarn is audible */
const onStaging = (extra) => Object.assign({ hostname: 'the-starters-3-0.webflow.io' }, extra || {})

/**
 * Three-valued on purpose. 'untouched' (the script never wrote a display) must
 * stay distinguishable from a state the script wrote. The script no longer
 * produces 'neutral' at all — an active row is always 'pass' or 'fail' — so a
 * 'neutral' result now means something hid both icons and is worth failing on.
 * @returns {'no-icons'|'untouched'|'partial'|'neutral'|'pass'|'fail'|'both'}
 */
function iconState(row) {
  const valid = row.querySelector('[' + P + 'icon="valid"]')
  const invalid = row.querySelector('[' + P + 'icon="invalid"]')
  if (!valid && !invalid) return 'no-icons'
  const dv = valid ? valid.style.display : undefined
  const di = invalid ? invalid.style.display : undefined
  if (dv === undefined && di === undefined) return 'untouched'
  if (dv === undefined || di === undefined) return 'partial'
  if (dv !== 'none' && di !== 'none') return 'both'
  if (dv !== 'none') return 'pass'
  if (di !== 'none') return 'fail'
  return 'neutral'
}

const isGated = (button) =>
  button.classList.contains('disabled') &&
  button.disabled === true &&
  button.getAttribute('disabled') !== null &&
  button.getAttribute('aria-disabled') === 'true'

const isOpen = (button) =>
  !button.classList.contains('disabled') &&
  button.disabled !== true &&
  button.getAttribute('disabled') === null &&
  button.getAttribute('aria-disabled') === null

/** type a value and fire the input event the way a browser would */
function type(app, value) {
  app.input.value = value
  return dispatch(app.input, 'input')
}

// ===========================================================================
// Ticket 01 — wrapper attribute grammar drives the checklist
// ===========================================================================

test('01: only the literal "true" turns a rule on', () => {
  const onlyNumbers = setup({ numbers: 'true' })
  type(onlyNumbers, 'a')
  assert.equal(iconState(onlyNumbers.rows.numbers), 'fail', 'numbers is enforced')
  assert.equal(isGated(onlyNumbers.button), true)
  type(onlyNumbers, '1')
  assert.equal(iconState(onlyNumbers.rows.numbers), 'pass')
  assert.equal(isOpen(onlyNumbers.button), true, 'no other rule is enforced')

  // every non-"true" spelling leaves the rule off, while a sibling keeps it alive
  ;['false', 'TRUE', 'True', '1', 'yes', ''].forEach((value) => {
    const app = setup({ numbers: 'true', special: value })
    type(app, '1')
    assert.equal(isOpen(app.button), true, JSON.stringify(value) + ' must not enable special')
  })
})

test('01: each of the four rules can be enabled independently', () => {
  const cases = [
    { rule: 'characters', config: { characters: 'true', 'character-count': '4' }, bad: 'aB1', good: 'aB1!' },
    { rule: 'special', config: { special: 'true' }, bad: 'abc', good: 'ab!' },
    { rule: 'capitalization', config: { capitalization: 'true' }, bad: 'abc', good: 'aBc' },
    { rule: 'numbers', config: { numbers: 'true' }, bad: 'abc', good: 'ab1' },
  ]
  cases.forEach(({ rule, config, bad, good }) => {
    const app = setup(config)
    type(app, bad)
    assert.equal(iconState(app.rows[rule]), 'fail', rule + ' fails on ' + bad)
    assert.equal(isGated(app.button), true, rule + ' gates the button')
    type(app, good)
    assert.equal(iconState(app.rows[rule]), 'pass', rule + ' passes on ' + good)
    assert.equal(isOpen(app.button), true)

    // the three rules that are OFF must not be enforced by the same value
    ALL_RULES.filter((n) => n !== rule).forEach((other) => {
      assert.equal(iconState(app.rows[other]), 'untouched', other + ' stays out of it')
    })
  })
})

test('01: all four rules on means all four must pass', () => {
  const app = setup({
    characters: 'true',
    'character-count': '8',
    special: 'true',
    capitalization: 'true',
    numbers: 'true',
  })
  type(app, 'Passw0rd')
  assert.equal(iconState(app.rows.special), 'fail', 'no special character yet')
  assert.equal(isGated(app.button), true)

  type(app, 'Passw0rd!')
  ALL_RULES.forEach((name) => assert.equal(iconState(app.rows[name]), 'pass', name))
  assert.equal(isOpen(app.button), true)
})

test('01: characters with no count attribute enforces a minimum of 8', () => {
  const app = setup({ characters: 'true' })
  type(app, 'abcdefg')
  assert.equal(iconState(app.rows.characters), 'fail', '7 chars is short of the default 8')
  assert.equal(isGated(app.button), true)
  type(app, 'abcdefgh')
  assert.equal(iconState(app.rows.characters), 'pass', '8 chars clears the default')
  assert.equal(isOpen(app.button), true)
})

test('01: an unparsable count attribute falls back to 8', () => {
  ;['', 'eight', 'abc', 'null'].forEach((value) => {
    const app = setup({ characters: 'true', 'character-count': value })
    type(app, 'abcdefg')
    assert.equal(isGated(app.button), true, JSON.stringify(value) + ' -> 7 chars still short')
    type(app, 'abcdefgh')
    assert.equal(isOpen(app.button), true, JSON.stringify(value) + ' -> 8 chars clears')
  })
})

test('01: a valid count attribute enforces exactly that number', () => {
  ;[4, 12].forEach((n) => {
    const app = setup({ characters: 'true', 'character-count': String(n) })
    type(app, 'x'.repeat(n - 1))
    assert.equal(isGated(app.button), true, n - 1 + ' chars is short of ' + n)
    type(app, 'x'.repeat(n))
    assert.equal(isOpen(app.button), true, n + ' chars clears ' + n)
  })
})

test('01: the old ms-code-pw-validation grammar is gone from the script', () => {
  assert.equal(source.includes('ms-code-pw-validation'), false)
})

test('01: the checklist shows every rule unmet from load, then flips as they pass', () => {
  const app = setup({ characters: 'true', numbers: 'true' })

  // The checklist reads as unchecked checkboxes: an empty field meets nothing,
  // so every active rule shows its invalid icon before a key is pressed. The
  // valid icon is EXPLICITLY hidden, not merely left alone — the latter would
  // also be true of a script that never ran.
  ;['characters', 'numbers'].forEach((name) =>
    assert.equal(iconState(app.rows[name]), 'fail', name + ' is unmet on an empty field'),
  )
  assert.equal(isGated(app.button), true, 'and the button is gated from the start')

  type(app, 'a')
  assert.equal(iconState(app.rows.characters), 'fail')
  assert.equal(iconState(app.rows.numbers), 'fail')

  type(app, 'abcdefg1')
  assert.equal(iconState(app.rows.characters), 'pass')
  assert.equal(iconState(app.rows.numbers), 'pass')
})

test('01: a field already filled at init validates immediately (autofill / restore)', () => {
  const f = makeForm({ characters: 'true', 'character-count': '4' })
  f.input.value = 'ab'
  mount(h('body', {}, [f.form]))

  assert.equal(iconState(f.rows.characters), 'fail', 'a prefilled value counts as typed')
  assert.equal(isGated(f.button), true)
})

test('01: the button is gated by class AND the real disabled property', () => {
  const app = setup({ numbers: 'true' })
  assert.equal(app.button.classList.contains('disabled'), true)
  assert.equal(app.button.disabled, true)
  assert.equal(app.button.getAttribute('disabled'), 'disabled')

  type(app, '1')
  assert.equal(app.button.classList.contains('disabled'), false)
  assert.equal(app.button.disabled, false)
  assert.equal(app.button.getAttribute('disabled'), null)
})

test('01: a dispatched submit is blocked while invalid and reveals the failing rows', () => {
  const app = setup({ characters: 'true', 'character-count': '8', numbers: 'true' })

  const blocked = dispatch(app.form, 'submit')
  assert.equal(blocked.defaultPrevented, true, 'Enter cannot half-submit')
  assert.equal(app.submits.length, 0, 'the bubble-phase handler never ran')
  assert.equal(iconState(app.rows.characters), 'fail', 'blocking reveals why')
  assert.equal(iconState(app.rows.numbers), 'fail')
})

test('01: a dispatched submit passes through once every rule is met', () => {
  const app = setup({ characters: 'true', 'character-count': '8', numbers: 'true' })
  type(app, 'abcdefg1')

  const passed = dispatch(app.form, 'submit')
  assert.equal(passed.defaultPrevented, true, 'prevented by the page handler, not the gate')
  assert.equal(app.submits.length, 1, 'the bubble-phase handler ran')
})

test('01: two wrappers in two forms validate independently', () => {
  const a = makeForm({ characters: 'true', 'character-count': '8', numbers: 'true' })
  const b = makeForm({ characters: 'true', 'character-count': '4' }, { rows: ['characters'] })
  const root = h('body', {}, [a.form, b.form])
  mount(root)

  a.input.value = 'abcdefg1'
  dispatch(a.input, 'input')

  assert.equal(isOpen(a.button), true, 'form A is satisfied')
  assert.equal(isGated(b.button), true, 'form B is untouched by typing in A')
  assert.equal(iconState(b.rows.characters), 'fail', 'B is still at its own unmet start')

  const bBlocked = dispatch(b.form, 'submit')
  assert.equal(bBlocked.defaultPrevented, true)
  assert.equal(b.submits.length, 0)

  b.input.value = 'abcd'
  dispatch(b.input, 'input')
  assert.equal(isOpen(b.button), true)
  assert.equal(isOpen(a.button), true, 'A did not regress')
  assert.equal(dispatch(b.form, 'submit') && b.submits.length, 1)
})

test('01: a page with no wrapper is left completely alone', () => {
  const f = makeForm({}, { noWrapper: true })
  mount(h('body', {}, [f.form]))

  assert.equal(f.button.classList.contains('disabled'), false)
  assert.equal(f.button.disabled, undefined, 'the disabled property was never written')
  assert.equal(f.button.getAttribute('disabled'), null)
  assert.equal(f.input.listenerCount('input'), 0, 'no input listener bound')
  assert.equal(f.form.listenerCount('submit'), 1, 'only the page own handler')
  ALL_RULES.forEach((name) => {
    assert.equal(iconState(f.rows[name]), 'untouched', name + ' icons never written')
    assert.equal(f.rows[name].style.display, undefined, 'no row was touched')
  })

  dispatch(f.form, 'submit')
  assert.equal(f.submits.length, 1, 'submit passes straight through')
})

test('01: loading the script twice initializes once', () => {
  const app = setup({ numbers: 'true' }, { mount: { loadTwice: true } })

  assert.equal(app.input.listenerCount('input'), 1)
  assert.equal(app.form.listenerCount('submit'), 2, 'the page handler plus one gate')

  type(app, '1')
  assert.equal(isOpen(app.button), true)
  dispatch(app.form, 'submit')
  assert.equal(app.submits.length, 1)
})

// ===========================================================================
// Ticket 02 — rows follow the config: auto-hide and {count}
// ===========================================================================

test('02: a row whose rule is off is hidden by the script', () => {
  const app = setup({ characters: 'true', numbers: 'true', special: 'false' })

  assert.equal(app.rows.special.style.display, 'none', 'explicit "false" hides the row')
  assert.equal(app.rows.capitalization.style.display, 'none', 'an absent toggle hides it too')
})

test('02: a row whose rule is on stays visible and validates', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })

  assert.notEqual(app.rows.characters.style.display, 'none')
  assert.notEqual(app.rows.numbers.style.display, 'none')

  type(app, 'abc')
  assert.equal(iconState(app.rows.characters), 'fail')
  assert.equal(iconState(app.rows.numbers), 'fail')
  type(app, 'abc1')
  assert.equal(iconState(app.rows.characters), 'pass')
  assert.equal(iconState(app.rows.numbers), 'pass')
  assert.notEqual(app.rows.characters.style.display, 'none', 'still visible after validating')
})

test('02: an active rule with no row is enforced silently', () => {
  // "numbers" is on but the designer omitted (or Designer-bound away) its row
  const app = setup(
    { characters: 'true', 'character-count': '4', numbers: 'true' },
    { rows: ['characters'] },
  )

  assert.equal(app.rows.numbers, undefined, 'the row really is absent')
  assert.equal(isGated(app.button), true)

  type(app, 'abcd')
  assert.equal(iconState(app.rows.characters), 'pass')
  assert.equal(isGated(app.button), true, 'the row-less rule still gates')
  assert.equal(dispatch(app.form, 'submit').defaultPrevented, true)
  assert.equal(app.submits.length, 0)

  type(app, 'abc1')
  assert.equal(isOpen(app.button), true)
  dispatch(app.form, 'submit')
  assert.equal(app.submits.length, 1)
})

test('02: a wrapper with no rows at all still gates the form', () => {
  const app = setup({ numbers: 'true' }, { rows: [] })

  assert.equal(isGated(app.button), true)
  type(app, 'abc')
  assert.equal(isGated(app.button), true)
  type(app, 'abc1')
  assert.equal(isOpen(app.button), true)
})

test('02: {count} renders the count attribute value', () => {
  const app = setup({ characters: 'true', 'character-count': '12' })
  assert.equal(app.rows.characters.textContent, 'At least 12 characters')
})

test('02: {count} renders the default 8 when no count attribute is set', () => {
  const app = setup({ characters: 'true' })
  assert.equal(app.rows.characters.textContent, 'At least 8 characters')

  const fallback = setup({ characters: 'true', 'character-count': 'eight' })
  assert.equal(fallback.rows.characters.textContent, 'At least 8 characters')
})

test('02: {count} is substituted anywhere in a row, including nested text', () => {
  const f = makeForm(
    { characters: 'true', 'character-count': '10', numbers: 'true' },
    { text: { numbers: 'One number, {count} chars, {count} minimum' } },
  )
  // a Webflow row usually wraps its copy in a nested text block
  const nested = h('div', {}, [h('span', {}, ['{count} or more'])])
  f.rows.characters.append(nested)
  mount(h('body', {}, [f.form]))

  assert.equal(f.rows.numbers.textContent, 'One number, 10 chars, 10 minimum', 'every occurrence')
  assert.equal(nested.textContent, '10 or more', 'nested text blocks too')
})

test('02: row copy without the token is left byte-for-byte unchanged', () => {
  const f = makeForm(
    { characters: 'true', 'character-count': '12', special: 'true' },
    { text: { characters: 'At least 8 characters {countdown} {Count} {{count}}' } },
  )
  const before = {
    characters: f.rows.characters.textContent,
    special: f.rows.special.textContent,
  }
  mount(h('body', {}, [f.form]))

  assert.equal(f.rows.special.textContent, before.special, 'a token-free row is untouched')
  assert.equal(
    f.rows.characters.textContent,
    'At least 8 characters {countdown} {Count} {12}',
    'only the exact {count} token is replaced',
  )
})

// ===========================================================================
// Ticket 03 — zero active rules fail open, with a staging warning
// ===========================================================================

/** a wrapper that is detected (a toggle is present) but enables nothing */
const ZERO_RULES = { characters: 'false', numbers: 'no', special: '' }

test('03: a wrapper with zero active rules leaves the button exactly as authored', () => {
  const app = setup(ZERO_RULES)

  assert.equal(app.button.classList.contains('disabled'), false)
  assert.equal(app.button.disabled, undefined, 'the disabled property was never written')
  assert.equal(app.button.getAttribute('disabled'), null)

  type(app, 'x')
  assert.equal(app.button.classList.contains('disabled'), false, 'and stays that way on input')
  assert.equal(app.button.disabled, undefined)
})

test('03: a zero-rule wrapper lets submits straight through', () => {
  const app = setup(ZERO_RULES)

  const event = dispatch(app.form, 'submit')
  assert.equal(app.submits.length, 1, 'the page handler ran')
  assert.equal(event.stopped, false, 'no blocker interfered')
  assert.equal(app.form.listenerCount('submit'), 1, 'no submit blocker was installed')
  assert.equal(app.input.listenerCount('input'), 0, 'no input listener either')
})

test('03: a zero-rule wrapper touches no rows and no icons', () => {
  const f = makeForm(ZERO_RULES, { text: { characters: 'At least {count} characters' } })
  mount(h('body', {}, [f.form]))

  ALL_RULES.forEach((name) => {
    assert.equal(f.rows[name].style.display, undefined, name + ' row untouched')
    assert.equal(iconState(f.rows[name]), 'untouched', name + ' icons untouched')
  })
  // {count} IS substituted even here: it is pure copy, gating-inert, and a raw
  // token on screen is a bug the user can see. Fail-open is about gating.
  assert.equal(
    f.rows.characters.textContent,
    'At least 8 characters',
    'copy is still rendered; only gating is withheld',
  )
})

test('03: the zero-rules warning fires on every staging host', () => {
  ;['localhost', '127.0.0.1', 'the-starters-3-0.webflow.io', 'abc-def.trycloudflare.com'].forEach(
    (hostname) => {
      const app = setup(ZERO_RULES, { mount: { hostname } })
      assert.equal(app.warnings.length, 1, hostname + ' must warn once')
      assert.match(app.warnings[0], /\[password-validation\]/, hostname + ' carries the prefix')
    },
  )
})

test('03: the debug override warns on a production host', () => {
  const app = setup(ZERO_RULES, { mount: { hostname: 'www.thestarters.com', debug: true } })
  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /\[password-validation\]/)
})

test('03: production stays silent', () => {
  // the lookalikes matter: an unanchored endsWith would read the middle three
  // as staging and start logging on somebody else's domain
  ;[
    'www.thestarters.com',
    'thestarters.com',
    'notwebflow.io',
    'evil-trycloudflare.com',
    'notwebflow.io.example.com',
  ].forEach((hostname) => {
    const app = setup(ZERO_RULES, { mount: { hostname } })
    assert.deepEqual(app.warnings, [], hostname + ' must stay silent')
  })

  const optedOut = setup(ZERO_RULES, { mount: { hostname: 'www.thestarters.com', debug: false } })
  assert.deepEqual(optedOut.warnings, [], 'STARTERS_DEBUG=false is not an opt-in')
})

test('03: a configured wrapper never warns, on staging or anywhere else', () => {
  const app = setup(
    { characters: 'true', 'character-count': '8' },
    { mount: { hostname: 'the-starters-3-0.webflow.io' } },
  )
  assert.deepEqual(app.warnings, [])

  type(app, 'abc')
  dispatch(app.form, 'submit')
  assert.deepEqual(app.warnings, [], 'and not while validating either')

  const noWrapper = makeForm({}, { noWrapper: true, rows: [] })
  const quiet = mount(h('body', {}, [noWrapper.form]), { hostname: 'the-starters-3-0.webflow.io' })
  assert.deepEqual(quiet.warnings, [], 'a page with no wrapper has nothing to warn about')
})

// ===========================================================================
// Fix round — diagnostics: every bail-out is audible on staging
//
// A component instance can be wired wrong in more ways than "no rules". Each
// one used to return silently, which on staging looks identical to a working
// form. Every give-up path now says so; a password form with no wrapper at all
// stays silent, because login pages legitimately have none.
// ===========================================================================

test('fix2: a wrapper outside any form warns', () => {
  const app = setup({ characters: 'true' }, { wrapperOutsideForm: true, mount: onStaging() })

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /not inside a <form>/)
  assert.equal(app.button.disabled, undefined, 'and still fails open')
})

test('fix2: a form with no password input warns', () => {
  const app = setup({ characters: 'true' }, { noInput: true, mount: onStaging() })

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /no password input/)
  assert.equal(app.button.disabled, undefined, 'and still fails open')
})

test('fix2: a form with no submit button warns but still validates', () => {
  const app = setup({ characters: 'true', 'character-count': '4' }, { noButton: true, mount: onStaging() })

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /ms-code-submit-button/)

  // the missing button must not cost the form its Enter-key gate
  assert.equal(dispatch(app.form, 'submit').defaultPrevented, true)
  assert.equal(app.submits.length, 0)
  assert.equal(iconState(app.rows.characters), 'fail', 'the checklist still works')

  type(app, 'abcd')
  dispatch(app.form, 'submit')
  assert.equal(app.submits.length, 1, 'and still opens when satisfied')
})

test('fix2: active rules that resolve no rows at all warn', () => {
  const app = setup({ characters: 'true', numbers: 'true' }, { rows: [], mount: onStaging() })

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /no checklist row for/)
  assert.match(app.warnings[0], /characters, numbers/, 'names which rules are missing')
  assert.equal(isGated(app.button), true, 'but the rules are still enforced')
})

test('fix2: a count-only wrapper is detected and reported, not ignored', () => {
  const app = setup({ 'character-count': '8' }, { mount: onStaging() })

  assert.equal(app.warnings.length, 1, 'a wrapper that sets only the count is not invisible')
  assert.match(app.warnings[0], /zero active rules/)
  assert.equal(app.button.disabled, undefined, 'fail open, as with any zero-rule wrapper')
})

test('fix2: a password form with no wrapper stays silent (login pages)', () => {
  // a login form: a password field and nothing else — no wrapper, and no
  // checklist markup either
  const f = makeForm({}, { noWrapper: true, rows: [] })
  const app = mount(h('body', {}, [f.form]), onStaging())

  assert.deepEqual(app.warnings, [], 'no wrapper is a legitimate shape, not a misconfiguration')
})

test('fix2: a correctly wired instance stays silent', () => {
  const app = setup({ characters: 'true', 'character-count': '8' }, { mount: onStaging() })
  assert.deepEqual(app.warnings, [])
})

// ===========================================================================
// Fix round — two wrappers in one form (the responsive-instance pattern)
//
// Webflow's way to vary a component per breakpoint is two instances in the
// same form, one hidden by CSS at each size. The second used to be skipped
// entirely: literal {count} in its copy and its disabled rows still visible.
// Every wrapper is now normalized and wired into one shared render loop;
// gating config comes from the first, and a disagreeing second one warns.
// ===========================================================================

/**
 * @param {object} configA
 * @param {object} configB
 * @param {object} [opts] mount options
 */
function twoWrapperForm(configA, configB, opts = {}) {
  const a = buildWrapper(configA, { heading: 'Needs {count} characters' })
  const b = buildWrapper(configB, {})
  const input = h('input', { type: 'password', 'data-ms-member': 'password' })
  const button = h('button', { type: 'submit', 'ms-code-submit-button': '' })
  const form = h('form', {}, [input, a.wrapper, b.wrapper, button])
  const submits = []
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submits.push(event)
  })
  const app = mount(h('body', {}, [form]), opts)
  return Object.assign({ a, b, input, button, form, submits }, app)
}

const SAME = { characters: 'true', 'character-count': '8', numbers: 'true' }

test('fix3: both wrappers in one form render and flip together', () => {
  const f = twoWrapperForm(SAME, SAME, onStaging())

  assert.deepEqual(f.warnings, [], 'two matching instances are a normal shape')
  ;[f.a, f.b].forEach((w, i) => {
    const which = 'wrapper ' + (i ? 'B' : 'A')
    assert.equal(w.rows.special.style.display, 'none', which + ' hid its off rows')
    assert.equal(w.rows.capitalization.style.display, 'none', which)
    assert.equal(iconState(w.rows.characters), 'fail', which + ' starts unmet')
    assert.equal(iconState(w.rows.numbers), 'fail', which)
  })

  f.input.value = 'abcdefg'
  dispatch(f.input, 'input')
  ;[f.a, f.b].forEach((w, i) => {
    assert.equal(iconState(w.rows.characters), 'fail', 'both flip: ' + i)
    assert.equal(iconState(w.rows.numbers), 'fail', 'both flip: ' + i)
  })

  f.input.value = 'abcdefg1'
  dispatch(f.input, 'input')
  ;[f.a, f.b].forEach((w, i) => {
    assert.equal(iconState(w.rows.characters), 'pass', 'both flip back: ' + i)
    assert.equal(iconState(w.rows.numbers), 'pass', 'both flip back: ' + i)
  })
  assert.equal(isOpen(f.button), true)
})

test('fix3: the second wrapper gets {count} substituted too', () => {
  const f = twoWrapperForm(SAME, SAME)

  assert.equal(f.b.rows.characters.textContent, 'At least 8 characters', 'not left frozen')
  assert.equal(f.a.rows.characters.textContent, 'At least 8 characters')
})

test('fix3: one form still gets exactly one submit blocker and one input listener', () => {
  const f = twoWrapperForm(SAME, SAME)

  assert.equal(f.input.listenerCount('input'), 1, 'not one per wrapper')
  assert.equal(f.form.listenerCount('submit'), 2, 'the page handler plus one gate')

  const blocked = dispatch(f.form, 'submit')
  assert.equal(blocked.defaultPrevented, true)
  assert.equal(f.submits.length, 0)
})

test('fix3: a second wrapper whose config differs warns, and the first wins', () => {
  const f = twoWrapperForm(SAME, { characters: 'true', 'character-count': '12' }, onStaging())

  assert.equal(f.warnings.length, 1)
  assert.match(f.warnings[0], /differs/)

  // gating follows wrapper A: 8 chars + a digit, not B's 12
  f.input.value = 'abcdefg1'
  dispatch(f.input, 'input')
  assert.equal(isOpen(f.button), true, "the first wrapper's config is the one enforced")

  // ...and B is normalized to A's config rather than its own
  assert.equal(f.b.rows.characters.textContent, 'At least 8 characters')
  assert.equal(f.b.rows.numbers.style.display, undefined, "numbers is on in A, so B's row shows")
})

test('fix3: a config mismatch is silent in production', () => {
  const f = twoWrapperForm(SAME, { characters: 'true', 'character-count': '12' })
  assert.deepEqual(f.warnings, [])
})

// ===========================================================================
// Fix round — button treatment matches the house standard
//
// A bare `disabled` class is styled by no CSS in this repo; the treatment that
// actually greys a Webflow button is form-validation.js's: swap
// data-button-theme to "disabled" and set aria-disabled, restoring the
// authored theme on the way back. The class and the native property stay for
// back-compat and for the Enter key.
// ===========================================================================

/** a form whose CTA is themed the Webflow way */
function themedForm(themeValue, config) {
  const f = makeForm(config || { characters: 'true', 'character-count': '4' })
  if (themeValue !== null) f.button.setAttribute('data-button-theme', themeValue)
  const app = mount(h('body', {}, [f.form]))
  return Object.assign({}, f, app)
}

test('fix4: a gated button gets aria-disabled and the disabled theme', () => {
  const app = themedForm('black')

  assert.equal(app.button.classList.contains('disabled'), true, 'class kept for back-compat')
  assert.equal(app.button.disabled, true, 'native property kept, so Enter cannot fire it')
  assert.equal(app.button.getAttribute('disabled'), 'disabled')
  assert.equal(app.button.getAttribute('aria-disabled'), 'true', 'announced to assistive tech')
  assert.equal(app.button.getAttribute('data-button-theme'), 'disabled', 'visibly greyed')
})

test('fix4: opening the button restores the authored theme and drops aria', () => {
  const app = themedForm('black')
  type(app, 'abcd')

  assert.equal(app.button.classList.contains('disabled'), false)
  assert.equal(app.button.disabled, false)
  assert.equal(app.button.getAttribute('disabled'), null)
  assert.equal(app.button.getAttribute('aria-disabled'), null)
  assert.equal(app.button.getAttribute('data-button-theme'), 'black', 'authored theme restored')
})

test('fix4: the theme round-trips across repeated gate flips', () => {
  const app = themedForm('primary')

  type(app, 'abcd')
  assert.equal(app.button.getAttribute('data-button-theme'), 'primary')
  type(app, 'ab')
  assert.equal(app.button.getAttribute('data-button-theme'), 'disabled')
  type(app, 'abcd')
  assert.equal(app.button.getAttribute('data-button-theme'), 'primary', 'still right on pass 2')
})

test('fix4: a button with no data-button-theme never grows one', () => {
  const app = themedForm(null)

  assert.equal(app.button.hasAttribute('data-button-theme'), false, 'not invented while gated')
  assert.equal(app.button.getAttribute('aria-disabled'), 'true', 'aria still applies')

  type(app, 'abcd')
  assert.equal(app.button.hasAttribute('data-button-theme'), false, 'nor while open')
  assert.equal(app.button.getAttribute('aria-disabled'), null)
})

test('fix4: a button authored as already-disabled restores to the house default', () => {
  const app = themedForm('disabled')
  type(app, 'abcd')

  assert.equal(
    app.button.getAttribute('data-button-theme'),
    'black',
    'caching "disabled" as the original would leave the CTA permanently grey',
  )
})

// ===========================================================================
// Fix round — never adjudicate on a stale value
//
// Writing input.value fires no event, and the gated button means Enter is the
// only way out. A password manager, a browser restore, or any script that
// fills the field could therefore leave the form permanently locked: the
// cached validity said "invalid" and nothing was ever going to recompute it.
// ===========================================================================

/** fill the field the way a password manager does: no input event at all */
function silentFill(app, value) {
  app.input.value = value
}

test('fix5: a submit recomputes validity instead of trusting the cached value', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })
  assert.equal(isGated(app.button), true)

  silentFill(app, 'abc1')
  const event = dispatch(app.form, 'submit')

  assert.equal(event.defaultPrevented, true, 'prevented by the page handler')
  assert.equal(app.submits.length, 1, 'the submit was NOT blocked — the value is valid')
  assert.equal(isOpen(app.button), true, 'and the button caught up')
})

test('fix5: a submit still blocks when the fresh value really is invalid', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })

  silentFill(app, 'ab')
  const event = dispatch(app.form, 'submit')

  assert.equal(event.defaultPrevented, true)
  assert.equal(app.submits.length, 0, 'blocked')
  assert.equal(iconState(app.rows.characters), 'fail', 'and the reason is revealed')
  assert.equal(iconState(app.rows.numbers), 'fail')
})

test('fix5: a submit re-blocks after a valid value is silently replaced', () => {
  const app = setup({ characters: 'true', 'character-count': '4' })

  type(app, 'abcd')
  assert.equal(isOpen(app.button), true)

  silentFill(app, 'ab') // e.g. a script rewriting the field
  const event = dispatch(app.form, 'submit')
  assert.equal(app.submits.length, 0, 'the stale "valid" must not let this through')
  assert.equal(event.defaultPrevented, true)
  assert.equal(isGated(app.button), true)
})

test('fix5: blurring a filled field revalidates it', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })

  silentFill(app, 'abc1')
  dispatch(app.input, 'focusout')

  assert.equal(iconState(app.rows.characters), 'pass')
  assert.equal(iconState(app.rows.numbers), 'pass')
  assert.equal(isOpen(app.button), true, 'an autofilled password unlocks on blur')
})

test('fix5: blurring an emptied field walks the checklist back down', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })

  type(app, 'abc1')
  assert.equal(iconState(app.rows.characters), 'pass')
  assert.equal(isOpen(app.button), true)

  // a listener that skipped empty values would strand the green ticks and the
  // open button on a field with nothing in it
  silentFill(app, '')
  dispatch(app.input, 'focusout')

  assert.equal(iconState(app.rows.characters), 'fail')
  assert.equal(iconState(app.rows.numbers), 'fail')
  assert.equal(isGated(app.button), true, 'and the button re-gates')
})

// ===========================================================================
// Fix round — {count} is a wrapper-wide token, not a row-only one
// ===========================================================================

test('fix8: {count} substitutes anywhere in the wrapper, headings included', () => {
  const f = twoWrapperForm(SAME, SAME)

  assert.match(f.a.wrapper.textContent, /Needs 8 characters/, 'a heading above the list')
  assert.equal(f.a.wrapper.textContent.includes('{count}'), false, 'no token left behind')
})

test('fix8: a hidden row inside the wrapper is substituted too, not left literal', () => {
  const app = setup(
    { characters: 'true', 'character-count': '6', special: 'false' },
    { text: { special: 'One special character (min {count})' } },
  )

  assert.equal(app.rows.special.style.display, 'none')
  assert.equal(
    app.rows.special.textContent,
    'One special character (min 6)',
    'so un-hiding it later cannot reveal a raw token',
  )
})

// ===========================================================================
// Fix round — the boot branch, and rows with no icons
// ===========================================================================

test('fix9: when the DOM is still parsing, wiring waits for DOMContentLoaded', () => {
  const f = makeForm({ characters: 'true', 'character-count': '4' })
  const app = mount(h('body', {}, [f.form]), { readyState: 'loading' })

  assert.equal(f.input.listenerCount('input'), 0, 'nothing is wired mid-parse')
  assert.equal(f.button.disabled, undefined, 'and the button is untouched')

  app.fireReady()

  assert.equal(f.input.listenerCount('input'), 1, 'wired once the DOM is ready')
  assert.equal(isGated(f.button), true)

  f.input.value = 'abcd'
  dispatch(f.input, 'input')
  assert.equal(isOpen(f.button), true, 'and fully working from there')
})

test('fix9: a row with no icon elements still validates and gates', () => {
  const app = setup({ characters: 'true', 'character-count': '4' }, { icons: false })

  assert.equal(iconState(app.rows.characters), 'no-icons', 'the row really has none')
  assert.equal(isGated(app.button), true, 'the rule is enforced anyway')
  assert.equal(dispatch(app.form, 'submit').defaultPrevented, true)
  assert.equal(app.submits.length, 0)

  type(app, 'abcd')
  assert.equal(isOpen(app.button), true)
  dispatch(app.form, 'submit')
  assert.equal(app.submits.length, 1, 'and nothing threw on the way')
})

// ===========================================================================
// Round 2 — the CTA is a wrap plus a control, not one element
//
// The design system puts data-button-theme on a .button_main-wrap and the real
// control inside it, so [ms-code-submit-button] may land on either. Treating
// that one element as both the theme target and the thing to disable greys the
// wrong node, or nothing at all. Resolution now splits: themeEl carries the
// look, actionable takes the native disabling, the marked element keeps the
// class. Reference: form-validation.js setButtonEnabled.
// ===========================================================================

/**
 * A form whose CTA subtree is supplied by the caller.
 * @param {Element} area the button area appended into the form
 * @param {object} [mountOpts]
 */
function buttonForm(area, mountOpts) {
  const built = buildWrapper({ characters: 'true', 'character-count': '4' }, {})
  const input = h('input', { type: 'password', 'data-ms-member': 'password' })
  const form = h('form', {}, [input, built.wrapper, area])
  const submits = []
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submits.push(event)
  })
  const app = mount(h('body', {}, [form]), mountOpts || {})
  return Object.assign({ rows: built.rows, input, form, submits }, app)
}

const aria = (el) => el.getAttribute('aria-disabled')
const theme = (el) => el.getAttribute('data-button-theme')

test('r2-1: theme on the wrap, marker on the wrap, control inside', () => {
  const control = h('button', { type: 'submit' })
  const wrap = h('div', { 'ms-code-submit-button': '', 'data-button-theme': 'black' }, [control])
  const app = buttonForm(wrap)

  assert.equal(wrap.classList.contains('disabled'), true, 'class stays on the marked element')
  assert.equal(theme(wrap), 'disabled', 'the wrap is what gets greyed')
  assert.equal(aria(wrap), 'true', 'announced on the wrap')
  assert.equal(aria(control), 'true', 'and on the control')
  assert.equal(control.disabled, true, 'the real control is what gets natively disabled')
  assert.equal(control.getAttribute('tabindex'), '-1')
  assert.equal(wrap.disabled, undefined, 'the wrap is not a control — never natively disabled')

  type(app, 'abcd')
  assert.equal(wrap.classList.contains('disabled'), false)
  assert.equal(theme(wrap), 'black', 'authored theme restored')
  assert.equal(aria(wrap), null)
  assert.equal(aria(control), null)
  assert.equal(control.disabled, false)
  assert.equal(control.getAttribute('tabindex'), null, 'tabindex removed on enable')
})

test('r2-1: marker on the wrap, theme on the inner control', () => {
  const control = h('button', { type: 'submit', 'data-button-theme': 'black' })
  const wrap = h('div', { 'ms-code-submit-button': '' }, [control])
  const app = buttonForm(wrap)

  assert.equal(wrap.classList.contains('disabled'), true)
  assert.equal(theme(control), 'disabled', 'found by descendant lookup')
  assert.equal(theme(wrap), null, 'the wrap never grows a theme it did not have')
  assert.equal(aria(control), 'true')
  assert.equal(control.disabled, true)

  type(app, 'abcd')
  assert.equal(theme(control), 'black')
  assert.equal(aria(control), null)
  assert.equal(control.disabled, false)
})

test('r2-1: marker on the control, theme on the ancestor wrap', () => {
  const control = h('button', { type: 'submit', 'ms-code-submit-button': '' })
  const wrap = h('div', { 'data-button-theme': 'black', class: 'button_main-wrap' }, [control])
  const app = buttonForm(wrap)

  assert.equal(control.classList.contains('disabled'), true, 'class on the marked element')
  assert.equal(theme(wrap), 'disabled', 'nearest themed ancestor inside the form')
  assert.equal(aria(wrap), 'true')
  assert.equal(aria(control), 'true')
  assert.equal(control.disabled, true)

  type(app, 'abcd')
  assert.equal(theme(wrap), 'black')
  assert.equal(aria(wrap), null)
  assert.equal(control.disabled, false)
})

test('r2-1: an anchor CTA is themed and announced, never natively disabled', () => {
  const link = h('a', { class: 'clickable_link', href: '/next' })
  const wrap = h('div', { 'ms-code-submit-button': '', 'data-button-theme': 'black' }, [link])
  const app = buttonForm(wrap, onStaging())

  assert.deepEqual(app.warnings, [], 'themed + resolvable is a supported shape')
  assert.equal(theme(wrap), 'disabled')
  assert.equal(aria(link), 'true', 'the anchor is announced disabled')
  assert.equal(link.disabled, undefined, 'an <a> has no disabled property to set')
  assert.equal(link.getAttribute('disabled'), null, 'and must not be given a meaningless one')

  type(app, 'abcd')
  assert.equal(theme(wrap), 'black')
  assert.equal(aria(link), null)
})

test('r2-1: a bare button still works exactly as before', () => {
  const button = h('button', { type: 'submit', 'ms-code-submit-button': '' })
  const app = buttonForm(button, onStaging())

  assert.deepEqual(app.warnings, [], 'a native control needs no theme to be gateable')
  assert.equal(isGated(button), true)
  assert.equal(button.getAttribute('tabindex'), '-1')
  assert.equal(button.hasAttribute('data-button-theme'), false, 'no theme invented')

  type(app, 'abcd')
  assert.equal(isOpen(button), true)
  assert.equal(button.getAttribute('tabindex'), null)
})

test('r2-1: an unstylable, ungateable CTA warns', () => {
  const wrap = h('div', { 'ms-code-submit-button': '' }, [h('span', {}, ['Sign up'])])
  const app = buttonForm(wrap, onStaging())

  assert.equal(app.warnings.length, 1, 'no theme to swap AND no control to disable')
  assert.match(app.warnings[0], /cannot be greyed out or disabled/)

  // it still fails safe: the Enter-key gate is independent of the button
  assert.equal(dispatch(app.form, 'submit').defaultPrevented, true)
  assert.equal(app.submits.length, 0)
})

test('r2-1: a themed div CTA with no native control does NOT warn', () => {
  const wrap = h('div', { 'ms-code-submit-button': '', 'data-button-theme': 'black' }, [
    h('span', {}, ['Sign up']),
  ])
  const app = buttonForm(wrap, onStaging())

  assert.deepEqual(app.warnings, [], 'it can at least be greyed, so it is not a dead end')
  assert.equal(theme(wrap), 'disabled')
})

// ===========================================================================
// Round 2 — the primary wrapper is the first CONFIGURED one
//
// Taking wrappers[0] blindly meant one stray attribute on an ancestor section,
// or a responsive first instance left at its defaults, silently failed the
// whole form open. The form is now driven by the first wrapper that actually
// enables a rule.
// ===========================================================================

/**
 * @param {Element[]} wrappers in document order inside the form
 * @param {object} [mountOpts]
 */
function wrappersForm(wrappers, mountOpts) {
  const input = h('input', { type: 'password', 'data-ms-member': 'password' })
  const button = h('button', { type: 'submit', 'ms-code-submit-button': '' })
  const form = h('form', {}, [input].concat(wrappers, [button]))
  const submits = []
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submits.push(event)
  })
  const app = mount(h('body', {}, [form]), mountOpts || {})
  return Object.assign({ input, button, form, submits }, app)
}

test('r2-2: a count-only ancestor no longer fails the whole form open', () => {
  const inner = buildWrapper({ characters: 'true', 'character-count': '4' }, {})
  // the real-world shape: someone put the count on a section that WRAPS the
  // component, so it is discovered first
  const section = h('section', { [P + 'character-count']: '4' }, [inner.wrapper])
  const app = wrappersForm([section], onStaging())

  assert.deepEqual(app.warnings, [], 'the configured wrapper inside it is found')
  assert.equal(isGated(app.button), true, 'the form really is gated')

  app.input.value = 'abc'
  dispatch(app.input, 'input')
  assert.equal(iconState(inner.rows.characters), 'fail')
  assert.equal(isGated(app.button), true)

  app.input.value = 'abcd'
  dispatch(app.input, 'input')
  assert.equal(iconState(inner.rows.characters), 'pass')
  assert.equal(isOpen(app.button), true)
})

test('r2-2: a responsive pair whose first instance is left at defaults still gates', () => {
  const off = buildWrapper({ characters: 'false' }, {})
  const on = buildWrapper({ characters: 'true', 'character-count': '4', numbers: 'true' }, {})
  const app = wrappersForm([off.wrapper, on.wrapper], onStaging())

  assert.deepEqual(app.warnings, [], 'an all-off instance asserts no config, so it is not a clash')
  assert.equal(isGated(app.button), true)

  app.input.value = 'abcd'
  dispatch(app.input, 'input')
  assert.equal(isGated(app.button), true, "the second wrapper's numbers rule is enforced")

  app.input.value = 'abc1'
  dispatch(app.input, 'input')
  assert.equal(isOpen(app.button), true)
  // and the defaulted instance is still normalized to the enforced config
  assert.equal(iconState(off.rows.characters), 'pass', 'it renders in step')
  assert.equal(iconState(off.rows.numbers), 'pass')
})

test('r2-2: only when NO wrapper configures anything does the form fail open', () => {
  const a = buildWrapper({ characters: 'false' }, {})
  const b = buildWrapper({ 'character-count': '8' }, {})
  const app = wrappersForm([a.wrapper, b.wrapper], onStaging())

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /zero active rules/)
  assert.match(app.warnings[0], /2 wrapper/, 'says how many were checked')
  assert.equal(app.button.disabled, undefined, 'fails open')
  dispatch(app.form, 'submit')
  assert.equal(app.submits.length, 1)
})

test('r2-2: the enforced config comes from the first CONFIGURED wrapper', () => {
  const off = buildWrapper({ special: 'false' }, {})
  const first = buildWrapper({ characters: 'true', 'character-count': '4' }, {})
  const second = buildWrapper({ characters: 'true', 'character-count': '12' }, {})
  const app = wrappersForm([off.wrapper, first.wrapper, second.wrapper], onStaging())

  assert.equal(app.warnings.length, 1, 'only the genuinely clashing wrapper is reported')
  assert.match(app.warnings[0], /differs/)

  app.input.value = 'abcd'
  dispatch(app.input, 'input')
  assert.equal(isOpen(app.button), true, "4 wins, not 12 and not the all-off wrapper's default")
})

// ===========================================================================
// Round 2 — copy renders even when gating does not
//
// Failing open is about not gating. It was never about leaving a literal
// "{count}" on the page for a user to read, so every detected wrapper gets its
// token substituted before any bail-out.
// ===========================================================================

test('r2-3: a zero-rules wrapper still renders its count copy', () => {
  const f = makeForm({ characters: 'false', 'character-count': '12' })
  mount(h('body', {}, [f.form]))

  assert.equal(f.rows.characters.textContent, 'At least 12 characters', 'its own count is used')
  assert.equal(f.rows.characters.style.display, undefined, 'rows still untouched')
  assert.equal(iconState(f.rows.characters), 'untouched', 'icons still untouched')
  assert.equal(f.button.disabled, undefined, 'and gating is still withheld')
})

test('r2-3: a form with no password input still renders its count copy', () => {
  const f = makeForm({ characters: 'true', 'character-count': '6' }, { noInput: true })
  const app = mount(h('body', {}, [f.form]), onStaging())

  assert.equal(f.rows.characters.textContent, 'At least 6 characters')
  assert.equal(app.warnings.length, 1, 'and it still reports the real problem')
  assert.match(app.warnings[0], /no password input/)
})

test('r2-3: a wrapper outside any form still renders its own count copy', () => {
  const f = makeForm({ characters: 'true', 'character-count': '10' }, { wrapperOutsideForm: true })
  const app = mount(h('body', {}, [f.form, f.wrapper]), onStaging())

  assert.equal(f.rows.characters.textContent, 'At least 10 characters', "its own readCount")
  assert.match(app.warnings[0], /not inside a <form>/)
})

test('r2-3: on a bail-out the count still defaults to 8 when unset', () => {
  const f = makeForm({ characters: 'false' })
  mount(h('body', {}, [f.form]))
  assert.equal(f.rows.characters.textContent, 'At least 8 characters')
})

test('r2-3: when a primary exists, every wrapper renders the ENFORCED count', () => {
  const first = buildWrapper({ characters: 'true', 'character-count': '4' }, {})
  const other = buildWrapper({ 'character-count': '99' }, {})
  const app = wrappersForm([first.wrapper, other.wrapper])

  assert.equal(first.rows.characters.textContent, 'At least 4 characters')
  assert.equal(
    other.rows.characters.textContent,
    'At least 4 characters',
    'not 99 — the copy must match what is enforced',
  )
})

// ===========================================================================
// Round 2 — `change` joins `focusout` as an escape hatch
//
// Some autofill paths fire `change` without `input`, and some fire neither
// until the field is left. Both events revalidate, whatever the field holds —
// there is no neutral state left to protect an empty field from.
// ===========================================================================

test('r2-4: a change event revalidates a filled field', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })

  app.input.value = 'abc1'
  dispatch(app.input, 'change')

  assert.equal(iconState(app.rows.characters), 'pass')
  assert.equal(iconState(app.rows.numbers), 'pass')
  assert.equal(isOpen(app.button), true)
})

test('r2-4: a change event on an emptied field returns it to unmet', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })

  type(app, 'abc1')
  assert.equal(iconState(app.rows.characters), 'pass')

  // the field is cleared (a password manager overwriting, a reset) and the
  // browser reports it via change rather than input
  app.input.value = ''
  dispatch(app.input, 'change')

  assert.equal(iconState(app.rows.characters), 'fail', 'the checklist follows the value back down')
  assert.equal(iconState(app.rows.numbers), 'fail')
  assert.equal(isGated(app.button), true)
})

test('r2-4: a change event reveals the failing rules on a bad value', () => {
  const app = setup({ characters: 'true', 'character-count': '8' })

  app.input.value = 'abc'
  dispatch(app.input, 'change')

  assert.equal(iconState(app.rows.characters), 'fail')
  assert.equal(isGated(app.button), true)
})

test('r2-4: input, focusout and change are each bound exactly once', () => {
  const app = setup({ characters: 'true' })

  assert.equal(app.input.listenerCount('input'), 1)
  assert.equal(app.input.listenerCount('focusout'), 1)
  assert.equal(app.input.listenerCount('change'), 1)
})

// ===========================================================================
// Round 2 — rescan for forms that arrive after load
//
// Modals, CMS tabs and step flows inject their markup long after
// DOMContentLoaded. Without a way back in, those forms shipped ungated.
// ===========================================================================

test('r2-5: rescan wires a form injected after load', () => {
  const first = makeForm({ characters: 'true', 'character-count': '4' })
  const root = h('body', {}, [first.form])
  const app = mount(root)
  assert.equal(isGated(first.button), true)

  // a modal opens and drops a second signup form into the page
  const late = makeForm({ characters: 'true', 'character-count': '6', numbers: 'true' })
  root.append(late.form)
  assert.equal(late.input.listenerCount('input'), 0, 'not wired by the original pass')
  assert.equal(late.rows.characters.textContent, 'At least {count} characters', 'nor rendered')

  app.window.startersPasswordValidation.rescan()

  assert.equal(late.input.listenerCount('input'), 1, 'the late form is wired')
  assert.equal(late.rows.characters.textContent, 'At least 6 characters')
  assert.equal(isGated(late.button), true)

  late.input.value = 'abc123'
  dispatch(late.input, 'input')
  assert.equal(isOpen(late.button), true)
  assert.equal(isGated(first.button), true, 'and the original form is unaffected')
})

test('r2-5: rescan never double-binds an already-wired form', () => {
  const f = makeForm({ characters: 'true', 'character-count': '4' })
  const app = mount(h('body', {}, [f.form]))

  app.window.startersPasswordValidation.rescan()
  app.window.startersPasswordValidation.rescan()

  assert.equal(f.input.listenerCount('input'), 1, 'still one input listener')
  assert.equal(f.input.listenerCount('focusout'), 1)
  assert.equal(f.input.listenerCount('change'), 1)
  assert.equal(f.form.listenerCount('submit'), 2, 'the page handler plus one gate')

  // and one blocked submit stays one blocked submit
  const event = dispatch(f.form, 'submit')
  assert.equal(event.defaultPrevented, true)
  assert.equal(f.submits.length, 0)
})

test('r2-5: rescan is exposed even on a page with no wrapper at all', () => {
  const f = makeForm({}, { noWrapper: true })
  const app = mount(h('body', {}, [f.form]))

  assert.equal(typeof app.window.startersPasswordValidation.rescan, 'function')
  app.window.startersPasswordValidation.rescan()
  assert.equal(f.button.disabled, undefined, 'and still does nothing observable')
})

// ===========================================================================
// Round 2 — diagnostics that name the thing that is wrong
//
// "Some rows are missing somewhere in this form" is not actionable. Each warn
// now names the wrapper and the specific rules, catches rows authored outside
// any wrapper, and catches copy whose number can drift from the enforced one.
// ===========================================================================

test('r2-6a: a missing row is reported per rule, not as an all-or-nothing total', () => {
  const app = setup(
    { characters: 'true', 'character-count': '4', numbers: 'true', special: 'true' },
    { rows: ['characters'], mount: onStaging() },
  )

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /no checklist row for/)
  assert.match(app.warnings[0], /special, numbers|numbers, special/, 'names both missing rules')
  assert.equal(app.warnings[0].includes('characters,'), false, 'and not the one that IS present')
})

test('r2-6a: each wrapper is reported separately', () => {
  const full = buildWrapper({ characters: 'true', 'character-count': '4', numbers: 'true' }, {})
  const partial = buildWrapper({ characters: 'true', 'character-count': '4', numbers: 'true' }, {
    rows: ['characters'],
  })
  const app = wrappersForm([full.wrapper, partial.wrapper], onStaging())

  assert.equal(app.warnings.length, 1, 'only the incomplete wrapper is reported')
  assert.match(app.warnings[0], /numbers/)
})

test('r2-6a: a complete checklist reports nothing', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' }, {
    mount: onStaging(),
  })
  assert.deepEqual(app.warnings, [])
})

test('r2-6b: rows authored outside any wrapper are reported once', () => {
  const stray = ruleRow('numbers', 'One number')
  const f = makeForm({ characters: 'true', 'character-count': '4' })
  f.form.append(stray) // authored in the form, but the wrapper attrs were never set
  const app = mount(h('body', {}, [f.form]), onStaging())

  const orphan = app.warnings.filter((w) => /outside any/.test(w))
  assert.equal(orphan.length, 1, 'one warn covering the orphans, not one per row')
  assert.match(orphan[0], /numbers/)
})

test('r2-6b: rows correctly inside a wrapper are never called orphans', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' }, {
    mount: onStaging(),
  })
  assert.equal(app.warnings.filter((w) => /outside any/.test(w)).length, 0)
})

test('r2-6c: an active characters row with no {count} token warns about drift', () => {
  const app = setup(
    { characters: 'true', 'character-count': '12' },
    { text: { characters: 'At least 8 characters' }, mount: onStaging() },
  )

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /\{count\}/, 'the fix is named in the message')
  assert.match(app.warnings[0], /12/, 'and so is the number actually enforced')
  assert.equal(
    app.rows.characters.textContent,
    'At least 8 characters',
    'the copy is left exactly as authored — this is a warning, not a rewrite',
  )
})

test('r2-6c: a row using the token never warns', () => {
  const app = setup({ characters: 'true', 'character-count': '12' }, { mount: onStaging() })
  assert.deepEqual(app.warnings, [])
  assert.equal(app.rows.characters.textContent, 'At least 12 characters')
})

test('r2-6c: drift is only checked when characters is actually enforced', () => {
  const app = setup(
    { numbers: 'true', characters: 'false' },
    { text: { characters: 'At least 8 characters' }, mount: onStaging() },
  )
  assert.deepEqual(app.warnings, [], 'a hidden, unenforced row cannot drift from anything')
})

test('r2-6b: a checklist with no wrapper attributes IS the typo this catches', () => {
  // same markup as a working component, minus the wrapper attributes: the
  // rows render and nothing validates, which is exactly the silent failure
  const f = makeForm({}, { noWrapper: true })
  const app = mount(h('body', {}, [f.form]), onStaging())

  assert.equal(app.warnings.length, 1)
  assert.match(app.warnings[0], /outside any wrapper/)
  assert.match(app.warnings[0], /4 checklist rows/)
  assert.equal(f.button.disabled, undefined, 'and it still fails open')
})

// ===========================================================================
// Round 3 — the rendered count follows the enforced count across a rescan
//
// A wrapper that fails open still renders its fallback number, and stays
// eligible for rescan(). Substituting in place would burn that number into
// the copy, so a later rescan enforcing a different one would advertise the
// old figure and additionally accuse the row of not using the token.
// ===========================================================================

test('r3-1: a bail-open wrapper re-renders the enforced count on rescan', () => {
  const f = makeForm(ZERO_RULES)
  const app = mount(h('body', {}, [f.form]), onStaging())

  assert.equal(f.rows.characters.textContent, 'At least 8 characters', 'the fallback renders')
  assert.equal(app.warnings.length, 1, 'and the zero-rules warning is the only one')
  assert.match(app.warnings[0], /zero active rules/)

  // the CMS-bound component properties arrive and the page asks for another pass
  f.wrapper.setAttribute(P + 'characters', 'true')
  f.wrapper.setAttribute(P + 'character-count', '12')
  app.window.startersPasswordValidation.rescan()

  assert.equal(
    f.rows.characters.textContent,
    'At least 12 characters',
    'the copy shows the count now being enforced, not the fallback',
  )
  assert.equal(app.warnings.length, 1, 'and no false drift warning about the token')

  f.input.value = 'abcdefghijkl'
  dispatch(f.input, 'input')
  assert.equal(isOpen(f.button), true, '12 characters passes the enforced rule')
})

test('r3-1: a rescan after the count changes re-renders every wrapper', () => {
  const first = buildWrapper({ characters: 'true', 'character-count': '6' })
  const second = buildWrapper({ 'character-count': '6' }, { heading: 'Needs {count} characters' })
  const input = h('input', { type: 'password', 'data-ms-member': 'password' })
  const button = h('button', { type: 'submit', 'ms-code-submit-button': '' })
  // no input yet, so the form bails and stays eligible for a rescan
  const form = h('form', {}, [first.wrapper, second.wrapper, button])
  const app = mount(h('body', {}, [form]))

  assert.equal(first.rows.characters.textContent, 'At least 6 characters')
  assert.equal(second.wrapper.textContent.includes('Needs 6 characters'), true)

  first.wrapper.setAttribute(P + 'character-count', '10')
  form.append(input)
  app.window.startersPasswordValidation.rescan()

  assert.equal(first.rows.characters.textContent, 'At least 10 characters')
  assert.equal(
    second.wrapper.textContent.includes('Needs 10 characters'),
    true,
    'the second instance follows the enforced count too',
  )
})

test('r3-1: a row authored without the token still warns after a rescan', () => {
  const f = makeForm(ZERO_RULES, { text: { characters: 'At least 8 characters' } })
  const app = mount(h('body', {}, [f.form]), onStaging())
  assert.equal(app.warnings.length, 1, 'only the zero-rules warning so far')

  f.wrapper.setAttribute(P + 'characters', 'true')
  f.wrapper.setAttribute(P + 'character-count', '12')
  app.window.startersPasswordValidation.rescan()

  const drift = app.warnings.filter((w) => /\{count\}/.test(w))
  assert.equal(drift.length, 1, 'hard-coded copy is still called out')
  assert.match(drift[0], /12/)
})

// ===========================================================================
// Round 3 — a wrapper injected into an ALREADY-WIRED form
//
// A step flow reveals its checklist inside the <form> that is already gating.
// Skipping the whole form on rescan left that wrapper showing a literal
// {count} with its off rows still visible and its icons frozen.
// ===========================================================================

test('r3-2: rescan adopts a wrapper injected into a wired form', () => {
  const f = makeForm({ characters: 'true', 'character-count': '6' })
  const app = mount(h('body', {}, [f.form]))
  assert.equal(f.rows.characters.textContent, 'At least 6 characters')

  const late = buildWrapper({ characters: 'true', 'character-count': '6' })
  f.form.append(late.wrapper)
  assert.equal(late.rows.characters.textContent, 'At least {count} characters', 'not yet rendered')

  app.window.startersPasswordValidation.rescan()

  assert.equal(
    late.rows.characters.textContent,
    'At least 6 characters',
    'the enforced count reaches the late wrapper',
  )
  assert.equal(late.rows.numbers.style.display, 'none', 'an off rule is hidden')
  assert.equal(late.rows.special.style.display, 'none')
  assert.equal(iconState(late.rows.characters), 'fail', 'and starts unmet, like the first')

  assert.equal(f.input.listenerCount('input'), 1, 'no listener was bound twice')
  assert.equal(f.input.listenerCount('focusout'), 1)
  assert.equal(f.input.listenerCount('change'), 1)
  assert.equal(f.form.listenerCount('submit'), 2, 'the page handler plus the one gate')
})

test('r3-2: an adopted wrapper flips in step with the original', () => {
  const f = makeForm({ characters: 'true', 'character-count': '6' })
  const app = mount(h('body', {}, [f.form]))

  const late = buildWrapper({ characters: 'true', 'character-count': '6' })
  f.form.append(late.wrapper)
  app.window.startersPasswordValidation.rescan()

  f.input.value = 'abc'
  dispatch(f.input, 'input')
  assert.equal(iconState(f.rows.characters), 'fail')
  assert.equal(iconState(late.rows.characters), 'fail', 'the adopted instance follows')
  assert.equal(isGated(f.button), true)

  f.input.value = 'abcdef'
  dispatch(f.input, 'input')
  assert.equal(iconState(late.rows.characters), 'pass')
  assert.equal(isOpen(f.button), true)
})

test('r3-2: adopting a wrapper never changes the enforced config', () => {
  const f = makeForm({ characters: 'true', 'character-count': '6' })
  const app = mount(h('body', {}, [f.form]), onStaging())

  // a mismatched late instance: it renders, it warns, it does not take over
  const late = buildWrapper({ characters: 'true', 'character-count': '12', numbers: 'true' })
  f.form.append(late.wrapper)
  app.window.startersPasswordValidation.rescan()

  assert.equal(app.warnings.length, 1, 'the existing mismatch warn covers it')
  assert.match(app.warnings[0], /differs from the one driving the form/)
  assert.equal(late.rows.characters.textContent, 'At least 6 characters', 'enforced, not its own')
  assert.equal(late.rows.numbers.style.display, 'none', 'its extra rule is not adopted')

  f.input.value = 'abcdef'
  dispatch(f.input, 'input')
  assert.equal(isOpen(f.button), true, 'six characters still passes; 12 was never enforced')
})

test('r3-2: a repeated rescan adopts each wrapper exactly once', () => {
  const f = makeForm({ characters: 'true', 'character-count': '6' })
  const app = mount(h('body', {}, [f.form]), onStaging())

  const late = buildWrapper({ characters: 'true', 'character-count': '6' })
  f.form.append(late.wrapper)
  app.window.startersPasswordValidation.rescan()
  app.window.startersPasswordValidation.rescan()
  app.window.startersPasswordValidation.rescan()

  assert.deepEqual(app.warnings, [], 'a matching wrapper is silent however often we look')

  f.input.value = 'abcdef'
  dispatch(f.input, 'input')
  assert.equal(iconState(late.rows.characters), 'pass', 'and its icons are registered once')
})

// ===========================================================================
// Round 4 — the checklist reads as unchecked checkboxes from load
//
// Product decision: the invalid icon is restyled in the Designer as a bordered
// circle, so an unmet rule looks like an empty checkbox rather than a scolding
// red cross. There is no neutral state to hold back any more — the checklist
// states where every active rule stands from the first paint. The icons are
// authored invalid-visible / valid-hidden, so a fail-open instance, whose
// icons the script never touches, still reads as a plain unchecked list.
// ===========================================================================

test('r4: the invalid icon is shown and the valid icon hidden at wiring time', () => {
  const app = setup({ characters: 'true', numbers: 'true' })

  // asserted on the elements directly, not through the iconState helper
  ;['characters', 'numbers'].forEach((name) => {
    const row = app.rows[name]
    const valid = row.querySelector('[' + P + 'icon="valid"]')
    const invalid = row.querySelector('[' + P + 'icon="invalid"]')
    assert.equal(invalid.style.display, 'flex', name + ': the unchecked box is visible')
    assert.equal(valid.style.display, 'none', name + ': the check is hidden')
  })
})

test('r4: the first render is a real evaluation, not a blanket fail', () => {
  // a value is already in the field at wiring time (autofill, browser restore)
  // that satisfies one active rule but not the other
  const f = makeForm({ characters: 'true', 'character-count': '4', numbers: 'true' })
  f.input.value = 'abcdefgh'
  mount(h('body', {}, [f.form]))

  assert.equal(iconState(f.rows.characters), 'pass', '8 chars already clears the 4 minimum')
  assert.equal(iconState(f.rows.numbers), 'fail', 'but there is no digit')
  assert.equal(isGated(f.button), true)
})

// ---------------------------------------------------------------------------
// The empty-string invariant, executable rather than prose
// ---------------------------------------------------------------------------

test('r4: every rule in RULES fails on an empty string', () => {
  // The checklist renders pass/fail from the first paint, so a predicate that
  // passed vacuously on '' would show pre-checked on a blank form. The script
  // exports nothing, so the map's keys are read back out of its source: adding
  // an entry to RULES without adding it to ALL_RULES — and so to every fixture
  // and to this loop — fails here first, with the name of the new rule.
  const block = /var RULES = \{([\s\S]*?)\n  \};/.exec(source)
  assert.ok(block, 'the RULES map is still recognisable in the source')
  const declared = [...block[1].matchAll(/^ {4}'([\w-]+)':/gm)].map((m) => m[1])

  assert.deepEqual(declared, ALL_RULES, 'a new RULES entry must be added to ALL_RULES')

  declared.forEach((rule) => {
    const app = setup({ [rule]: 'true' })
    assert.equal(iconState(app.rows[rule]), 'fail', rule + ' must not pass on an empty field')
    assert.equal(isGated(app.button), true, rule + ' must gate an empty field')
  })
})

// ===========================================================================
// Round 5 — the CTA gate covers the whole form, and the overlay submits
//
// The live SIGN UP CTA is Memberstack's overlay: a .clickable_btn
// (type="button") inside the [ms-code-submit-button] wrap, with the native
// submit hidden. The gate must grey and disable that overlay too, must also
// hold until terms and a plausible email are in (when the form has them), and
// an ENABLED overlay click must reach the submit path Memberstack listens on.
// Rejections after the click land on the form's own fail block.
// ===========================================================================

const VALID_PASSWORD = 'Passw0rd!'
const SIGNUP_RULES = {
  characters: 'true',
  'character-count': '8',
  special: 'true',
  capitalization: 'true',
  numbers: 'true',
}

/**
 * The [ms-code-submit-button] CTA in each shape the live Button component ships.
 * @param {'overlay'|'native'|'anchor'|'none'} [kind]
 * @returns {{overlay: Element|null, wrapBtn: Element|null}}
 */
function buildCta(kind) {
  if (kind === 'none') return { overlay: null, wrapBtn: null }
  if (kind === 'native') {
    const native = h('button', { type: 'submit', 'ms-code-submit-button': '' }, ['SIGN UP'])
    return { overlay: native, wrapBtn: native }
  }
  let overlay
  if (kind === 'anchor') {
    overlay = h('a', { href: '#' }, ['SIGN UP'])
    overlay.classList.add('clickable_link')
  } else {
    overlay = h('button', { type: 'button' }, ['SIGN UP'])
    overlay.classList.add('clickable_btn')
  }
  const clickWrap = h('div', {}, [overlay])
  clickWrap.classList.add('clickable_wrap')
  const wrapBtn = h('div', { 'ms-code-submit-button': '', 'data-button-theme': 'black' }, [clickWrap])
  wrapBtn.classList.add('button_main-wrap')
  return { overlay, wrapBtn }
}

/**
 * The published /sign-up shape: marker + theme on the Button wrap, the
 * overlay button inside it, email + terms alongside the password.
 *
 * `wrapper: false` drops the checklist entirely (the page the fix is for),
 * `cta` picks the control shape ('none' authors no marker at all), and
 * `msForm` sets or removes the data-ms-form kind.
 * @param {{email?: boolean, terms?: boolean, customCheckbox?: boolean, failBlock?: boolean, wrapper?: false|object, cta?: 'overlay'|'native'|'anchor'|'none', msForm?: false|string, mount?: object}} [opts]
 */
function liveSetup(opts = {}) {
  const config = opts.wrapper === false ? null : opts.wrapper || SIGNUP_RULES
  const built = config ? buildWrapper(config) : { wrapper: null, rows: null }
  const wrapper = built.wrapper
  const rows = built.rows
  const input = h('input', { type: 'password', 'data-ms-member': 'password' })

  const email = opts.email === false ? null : h('input', { type: 'email', 'data-ms-member': 'email' })

  let terms = null
  let termsVisual = null
  let termsWrap = null
  if (opts.terms !== false) {
    terms = h('input', { type: 'checkbox', 'data-ms-member': 'terms-and-condition' })
    terms.checked = false
    if (opts.customCheckbox) {
      termsVisual = h('div')
      termsVisual.classList.add('w-checkbox-input')
      termsWrap = h('label', {}, [termsVisual, terms])
      termsWrap.classList.add('w-checkbox')
    }
  }

  const { overlay, wrapBtn } = buildCta(opts.cta)

  const inForm = [input]
  if (email) inForm.push(email)
  if (wrapper) inForm.push(wrapper)
  if (terms) inForm.push(termsWrap || terms)
  if (wrapBtn) inForm.push(wrapBtn)
  const formAttrs =
    opts.msForm === false
      ? {}
      : { 'data-ms-form': opts.msForm || 'signup', 'data-ms-redirect': '/brand-dashboard' }
  const form = h('form', formAttrs, inForm)

  const submits = []
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submits.push(event)
  })

  const wFormKids = [form]
  let fail = null
  let failText = null
  if (opts.failBlock !== false) {
    failText = h('div', {}, ['Something went wrong'])
    fail = h('div', {}, [failText])
    fail.classList.add('w-form-fail')
    wFormKids.push(fail)
  }
  const wForm = h('div', {}, wFormKids)
  wForm.classList.add('w-form')

  const root = h('body', {}, [wForm])
  const app = mount(root, opts.mount || {})
  return Object.assign(
    { root, wrapper, rows, input, email, terms, termsVisual, overlay, wrapBtn, form, submits, fail, failText },
    app,
  )
}

const overlayGated = (f) =>
  f.overlay.disabled === true &&
  f.overlay.getAttribute('disabled') !== null &&
  f.overlay.getAttribute('aria-disabled') === 'true' &&
  f.wrapBtn.classList.contains('disabled') &&
  f.wrapBtn.getAttribute('data-button-theme') === 'disabled' &&
  f.wrapBtn.getAttribute('aria-disabled') === 'true'

const overlayOpen = (f) =>
  f.overlay.disabled !== true &&
  f.overlay.getAttribute('disabled') === null &&
  f.overlay.getAttribute('aria-disabled') === null &&
  !f.wrapBtn.classList.contains('disabled') &&
  f.wrapBtn.getAttribute('data-button-theme') === 'black' &&
  f.wrapBtn.getAttribute('aria-disabled') === null

function fillEmail(f, value) {
  f.email.value = value
  dispatch(f.email, 'input')
}

function checkTerms(f) {
  f.terms.checked = true
  dispatch(f.terms, 'change')
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('r5-1: a failing password greys the wrap AND natively disables the overlay', () => {
  const f = liveSetup()
  fillEmail(f, 'brand@example.com')
  checkTerms(f)
  type(f, 'weakpass')
  assert.equal(overlayGated(f), true, 'wrap themed disabled, overlay disabled for real')
})

test('r5-2: a passing password with the terms box unchecked stays grey', () => {
  const f = liveSetup()
  fillEmail(f, 'brand@example.com')
  type(f, VALID_PASSWORD)
  assert.equal(overlayGated(f), true, 'terms exists and is unchecked')
})

test('r5-3: a passing password with an empty or implausible email stays grey', () => {
  const f = liveSetup()
  checkTerms(f)
  type(f, VALID_PASSWORD)
  assert.equal(overlayGated(f), true, 'email empty')
  ;['not-an-email', 'user@nodot', '@example.com', 'user @example.com'].forEach((value) => {
    fillEmail(f, value)
    assert.equal(overlayGated(f), true, JSON.stringify(value) + ' must not enable')
  })
})

test('r5-4: password + email + terms all passing opens the overlay and restores the theme', () => {
  const f = liveSetup()
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  checkTerms(f)
  assert.equal(overlayOpen(f), true)
})

test('r5-4: a Webflow custom checkbox counts through its visual state too', () => {
  const f = liveSetup({ customCheckbox: true })
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  // the visual div flips before/instead of the native checked in some paths
  f.termsVisual.classList.add('w--redirected-checked')
  dispatch(f.terms, 'change')
  assert.equal(overlayOpen(f), true)
})

test('r5-5: a form with no terms field enables on password + email alone', () => {
  const f = liveSetup({ terms: false })
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  assert.equal(overlayOpen(f), true)
})

test('r5-5: a form with neither email nor terms keeps password-only gating', () => {
  const f = liveSetup({ terms: false, email: false })
  type(f, VALID_PASSWORD)
  assert.equal(overlayOpen(f), true)
})

test('r5-6: an invalid form still blocks a dispatched submit ahead of the page', () => {
  const f = liveSetup()
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  // terms still unchecked
  const blocked = dispatch(f.form, 'submit')
  assert.equal(blocked.defaultPrevented, true)
  assert.equal(f.submits.length, 0, 'the bubble-phase handler never ran')
})

test('r5-7: an enabled overlay click is not prevented and dispatches one synthetic submit', () => {
  const f = liveSetup()
  // requestSubmit must never be the bridge: its default action is a REAL
  // native submission (password into the query string on a method=get form)
  f.form.requestSubmit = () => {
    throw new Error('requestSubmit must not be called')
  }
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  checkTerms(f)

  const click = dispatch(f.overlay, 'click')
  assert.equal(click.defaultPrevented, false, 'the type=button click is left alone')
  assert.equal(f.submits.length, 1, 'one synthetic submit reached the page (Memberstack) handler')
})

test('r5-7: a disabled-state overlay click submits nothing', () => {
  const f = liveSetup()
  type(f, 'weakpass')
  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 0)
})

test('r5-7: a native submitter under the marker is never double-submitted', () => {
  // marker on the wrap around a real submit button — the pre-component shape
  const button = h('button', { type: 'submit' }, ['SIGN UP'])
  const wrapBtn = h('div', { 'ms-code-submit-button': '' }, [button])
  const { wrapper } = buildWrapper({ numbers: 'true' })
  const input = h('input', { type: 'password', 'data-ms-member': 'password' })
  const form = h('form', {}, [input, wrapper, wrapBtn])
  const submits = []
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submits.push(event)
  })
  mount(h('body', {}, [form]))

  input.value = '1'
  dispatch(input, 'input')
  dispatch(button, 'click')
  assert.equal(submits.length, 0, 'no synthetic submit — the browser owns a type=submit click')
})

// --- r5-8: rejections land on the form ------------------------------------

const msFailure = (body) => ({
  ok: false,
  clone() {
    return this
  },
  json: () => Promise.resolve(body),
})

/** arm the watcher the way a real pass does: a valid form and a submit */
function armedSetup(fetchImpl) {
  const f = liveSetup({ mount: { fetch: fetchImpl } })
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  checkTerms(f)
  dispatch(f.form, 'submit')
  return f
}

test('r5-8: a Memberstack 4xx paints the fail block with the server message', async () => {
  const responses = [msFailure({ message: 'That email is already registered.' })]
  const f = armedSetup(() => Promise.resolve(responses.shift()))

  f.window.fetch('https://client.memberstack.com/member')
  await flush()

  assert.equal(f.fail.style.display, 'block', 'the fail block is shown')
  assert.equal(f.fail.getAttribute('role'), 'alert')
  assert.equal(f.failText.textContent, 'That email is already registered.')
})

test('r5-8: a rejection with no usable message falls back to the house line', async () => {
  const f = armedSetup(() => Promise.reject(new Error('network down')))

  f.window.fetch('https://challenges.cloudflare.com/turnstile').catch(() => {})
  await flush()

  assert.equal(f.fail.style.display, 'block')
  assert.equal(f.failText.textContent, "Couldn't create the account. Try again.")
})

test('r5-8: a success touches nothing and a re-submit clears the old message', async () => {
  let response = msFailure({ message: 'Duplicate.' })
  const f = armedSetup(() => Promise.resolve(response))

  f.window.fetch('https://client.memberstack.com/member')
  await flush()
  assert.equal(f.fail.style.display, 'block', 'first attempt failed visibly')

  // second attempt: arming hides the stale message, an ok response leaves it so
  response = { ok: true }
  dispatch(f.form, 'submit')
  assert.equal(f.fail.style.display, 'none', 'arming clears the previous rejection')
  f.window.fetch('https://client.memberstack.com/member')
  await flush()
  assert.equal(f.fail.style.display, 'none', 'success paints no error')
})

test('r5-8: unrelated requests never trip the watcher', async () => {
  const f = armedSetup(() => Promise.resolve(msFailure({ message: 'nope' })))

  f.window.fetch('https://x08a-5ko8-jj1r.n7c.xano.io/api/whatever')
  await flush()

  assert.equal(f.fail.style.display, 'none', 'still just armed-and-hidden, no error painted')
  assert.equal(f.failText.textContent, 'Something went wrong', 'the authored copy is untouched')
})

test('r5-8: an OK ancillary call does not swallow a later rejection', async () => {
  const queue = [{ ok: true }, msFailure({ message: 'That email is already registered.' })]
  const f = armedSetup(() => Promise.resolve(queue.shift()))

  // token / Turnstile / ancillary call succeeds first…
  f.window.fetch('https://client.memberstack.com/token')
  await flush()
  assert.equal(f.fail.style.display, 'none', 'a success never paints and never disarms')

  // …then the real signup POST is rejected
  f.window.fetch('https://client.memberstack.com/member')
  await flush()
  assert.equal(f.fail.style.display, 'block', 'the rejection still lands')
  assert.equal(f.failText.textContent, 'That email is already registered.')
})

test('r5-8: a fetch called with a URL-like object is still watched', async () => {
  const f = armedSetup(() => Promise.resolve(msFailure({ message: 'nope' })))

  f.window.fetch({
    toString() {
      return 'https://client.memberstack.com/member'
    },
  })
  await flush()

  assert.equal(f.fail.style.display, 'block', 'String(resource) covers URL objects')
  assert.equal(f.failText.textContent, 'nope')
})

test('r5-9: unchecking a custom terms checkbox regreys once the visual state settles', async () => {
  const f = liveSetup({ customCheckbox: true })
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  f.terms.checked = true
  f.termsVisual.classList.add('w--redirected-checked')
  dispatch(f.terms, 'change')
  assert.equal(overlayOpen(f), true, 'checked opens the gate')

  // Uncheck: the native checked flips before our at-target listener runs, but
  // Webflow's DELEGATED handler removes the visual class only afterwards — so
  // the immediate render reads a stale class. The deferred render must not.
  f.terms.checked = false
  dispatch(f.terms, 'change')
  f.termsVisual.classList.remove('w--redirected-checked')

  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(overlayGated(f), true, 'the deferred render reads the settled state')
})

// ===========================================================================
// Round 6 — the submit bridge is independent of the rules gate
//
// The live SIGN UP CTA is a type="button" overlay, and this script's click
// bridge is the only thing that turns it into a submit. Removing the
// validation component from the page removed the bridge with it, so Sign up
// did nothing at all. The bridge now belongs to every form[data-ms-form]
// carrying [ms-code-submit-button]; the gate still belongs to the wrapper.
// ===========================================================================

/** the whole CTA as authored: nothing the gate would have written to it */
const ctaUntouched = (f) => overlayOpen(f)

test('r6-1: an overlay CTA on a wrapperless Memberstack form still submits', () => {
  const f = liveSetup({ wrapper: false, mount: onStaging() })

  const click = dispatch(f.overlay, 'click')
  assert.equal(click.defaultPrevented, false, 'the type=button click is left alone')
  assert.equal(f.submits.length, 1, 'one synthetic submit reached the page (Memberstack) handler')
  assert.equal(f.submits[0].stopped, false, 'no capture-phase blocker interfered')
  assert.equal(ctaUntouched(f), true, 'no wrapper means no gating treatment')
  assert.deepEqual(f.warnings, [], 'a wrapperless signup form is a legitimate shape')
})

test('r6-2: a fail-open wrapper (every toggle off) still submits on click', () => {
  const f = liveSetup({ wrapper: ZERO_RULES })

  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 1)
  assert.equal(ctaUntouched(f), true, 'fail open still means no gating treatment')
})

test('r6-3: a wrapperless native submitter under the marker gets no synthetic submit', () => {
  const f = liveSetup({ wrapper: false, cta: 'native' })

  assert.equal(f.wrapBtn.listenerCount('click'), 1, 'the bridge is bound')
  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 0, 'the browser owns a type=submit click; the bridge adds nothing')
})

test('r6-4: an anchor CTA is prevented and submits once', () => {
  const f = liveSetup({ wrapper: false, cta: 'anchor' })

  const click = dispatch(f.overlay, 'click')
  assert.equal(click.defaultPrevented, true, 'the anchor must not navigate')
  assert.equal(f.submits.length, 1)
})

test('r6-5: a form without data-ms-form is left entirely alone', () => {
  const f = liveSetup({ wrapper: false, msForm: false })

  assert.equal(f.form.listenerCount('submit'), 1, 'only the page own handler')
  assert.equal(f.wrapBtn.listenerCount('click'), 0, 'no bridge on a non-Memberstack form')
  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 0)
})

test('r6-6: a bridged form that gains a wrapper on rescan starts gating, once', () => {
  const f = liveSetup({ wrapper: false })
  const { wrapper } = buildWrapper(SIGNUP_RULES)
  f.form.append(wrapper)
  f.window.startersPasswordValidation.rescan()

  assert.equal(f.form.listenerCount('submit'), 2, 'the page handler plus one gate')
  assert.equal(f.wrapBtn.listenerCount('click'), 1, 'still one bridge, not two')

  type(f, 'weakpass')
  const blocked = dispatch(f.form, 'submit')
  assert.equal(blocked.stopped, true, 'the capture blocker now stops the submit')
  assert.equal(f.submits.length, 0, 'the page handler never ran')
  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 0, 'and the click is blocked too')

  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  checkTerms(f)
  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 1, 'a satisfied form submits exactly once')
})

test('r6-7: a wrapperless signup click still arms the rejection watcher', async () => {
  const f = liveSetup({
    wrapper: false,
    mount: { fetch: () => Promise.resolve(msFailure({ message: 'nope' })) },
  })

  dispatch(f.overlay, 'click')
  f.window.fetch('https://client.memberstack.com/member')
  await flush()

  assert.equal(f.fail.style.display, 'block', 'the watcher was armed by the bridged click')
})

test('r6-8: the @release header and the exposed release property cannot drift apart', () => {
  const header = source.match(/^\/\/ @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(header, 'the file header must carry an @release marker')
  const app = mount(h('body', {}, []))
  assert.equal(app.window.startersPasswordValidation.release, header[1])
})

test('r6-9: a wired form whose marker arrives later greys its CTA on rescan', () => {
  // wired with no CTA at all: the old code snapshotted button === null here and
  // the CTA could never grey, however many rescans ran
  const f = liveSetup({ cta: 'none', mount: onStaging() })
  assert.match(f.warnings.join(' '), /no \[ms-code-submit-button\]/, 'staging says so')

  const { wrapBtn, overlay } = buildCta('overlay')
  f.form.append(wrapBtn)
  f.window.startersPasswordValidation.rescan()

  const live = Object.assign({}, f, { wrapBtn, overlay })
  assert.equal(overlayGated(live), true, 'the late CTA greys immediately, not on first input')

  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  checkTerms(f)
  assert.equal(overlayOpen(live), true, 'and opens once the form is satisfied')
  dispatch(overlay, 'click')
  assert.equal(f.submits.length, 1)
})

test('r6-10: a swapped CTA subtree moves the bridge and leaves the old root inert', () => {
  const f = liveSetup({ wrapper: false })
  const old = f.wrapBtn
  old.remove()

  const { wrapBtn, overlay } = buildCta('overlay')
  f.form.append(wrapBtn)
  f.window.startersPasswordValidation.rescan()

  dispatch(overlay, 'click')
  assert.equal(f.submits.length, 1, 'the new control submits exactly once')

  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 1, 'the detached root has no live effect')
})

test('r6-11: a login form with the marker submits but arms no signup watcher', async () => {
  const f = liveSetup({
    wrapper: false,
    msForm: 'login',
    mount: { fetch: () => Promise.resolve(msFailure({ message: 'nope' })) },
  })

  dispatch(f.overlay, 'click')
  assert.equal(f.submits.length, 1, 'the CTA still works')

  f.window.fetch('https://client.memberstack.com/member')
  await flush()
  assert.equal(f.fail.style.display, undefined, 'signup copy never lands on a login form')
})

test('r6-12: a wired non-signup form arms, and falls back to neutral copy', async () => {
  const f = liveSetup({
    msForm: 'reset-password',
    mount: { fetch: () => Promise.resolve(msFailure({})) },
  })
  type(f, VALID_PASSWORD)
  fillEmail(f, 'brand@example.com')
  checkTerms(f)
  dispatch(f.form, 'submit')

  f.window.fetch('https://client.memberstack.com/member')
  await flush()

  assert.equal(f.fail.style.display, 'block', 'a checklist-wired form still gets its watcher')
  assert.equal(f.failText.textContent, 'Something went wrong. Please try again.')
})

test('r6-13: a click another script already refused is never turned into a submit', () => {
  const prevented = liveSetup({ wrapper: false })
  dispatch(prevented.overlay, 'click', { defaultPrevented: true })
  assert.equal(prevented.submits.length, 0, 'the other script owns a click it preventDefaulted')

  const aria = liveSetup({ wrapper: false })
  aria.wrapBtn.setAttribute('aria-disabled', 'true')
  dispatch(aria.overlay, 'click')
  assert.equal(aria.submits.length, 0, 'an aria-disabled CTA is another script gating it')

  const ariaControl = liveSetup({ wrapper: false })
  ariaControl.overlay.setAttribute('aria-disabled', 'true')
  dispatch(ariaControl.overlay, 'click')
  assert.equal(ariaControl.submits.length, 0, 'on the control too')
})
