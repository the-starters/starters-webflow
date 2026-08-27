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
  window.window = window

  const context = vm.createContext({
    window,
    document,
    location,
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
 * stay distinguishable from 'neutral' (the script explicitly hid both icons),
 * or a test asserting the neutral start would also pass on a script that never
 * ran at all.
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

test('01: the checklist starts neutral and flips only after the first input', () => {
  const app = setup({ characters: 'true', numbers: 'true' })

  // both icons EXPLICITLY hidden — not merely left alone, which would look the
  // same to a user but would also be true of a script that never ran
  ;['characters', 'numbers'].forEach((name) =>
    assert.equal(iconState(app.rows[name]), 'neutral', name + ' is actively hidden before typing'),
  )
  assert.equal(isGated(app.button), true, 'but the button is gated from the start')

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
  assert.equal(iconState(b.rows.characters), 'neutral', 'B is still at its own neutral start')

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
    assert.equal(iconState(w.rows.characters), 'neutral', which + ' starts neutral')
    assert.equal(iconState(w.rows.numbers), 'neutral', which)
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

test('fix5: blurring an empty untouched field shows no crosses', () => {
  const app = setup({ characters: 'true', numbers: 'true' })

  dispatch(app.input, 'focusout')

  assert.equal(iconState(app.rows.characters), 'neutral', 'no red crosses for doing nothing')
  assert.equal(iconState(app.rows.numbers), 'neutral')
  assert.equal(isGated(app.button), true, 'still gated, just not scolding')
})

test('fix5: a filled-then-blurred field that fails does show its crosses', () => {
  const app = setup({ characters: 'true', 'character-count': '8' })

  silentFill(app, 'abc')
  dispatch(app.input, 'focusout')

  assert.equal(iconState(app.rows.characters), 'fail')
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
// until the field is left. Both events now revalidate a filled field, with the
// same guard: an empty one earns no crosses.
// ===========================================================================

test('r2-4: a change event revalidates a filled field', () => {
  const app = setup({ characters: 'true', 'character-count': '4', numbers: 'true' })

  app.input.value = 'abc1'
  dispatch(app.input, 'change')

  assert.equal(iconState(app.rows.characters), 'pass')
  assert.equal(iconState(app.rows.numbers), 'pass')
  assert.equal(isOpen(app.button), true)
})

test('r2-4: a change event on an empty field shows no crosses', () => {
  const app = setup({ characters: 'true', numbers: 'true' })

  dispatch(app.input, 'change')

  assert.equal(iconState(app.rows.characters), 'neutral')
  assert.equal(iconState(app.rows.numbers), 'neutral')
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
