const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'utils', 'wf-validate.js'), 'utf8')

const INVALID = 'is-wf-validate-invalid'
const DISABLED = 'is-wf-validate-disabled'

// ---------------------------------------------------------------------------
// Minimal DOM. Only what wf-validate.js actually touches: attributes, classes,
// style.display, a tiny selector engine (tag / [attr] / [attr="v"] / .class /
// :not(...) / comma groups — the exact shapes the script queries), a hand-rolled
// ValidityState, and listener plumbing the tests can fire by hand.
// ---------------------------------------------------------------------------

/**
 * @param {Element} el
 * @param {string} sel one compound selector (no combinators)
 * @returns {boolean}
 */
function matchesSimple(el, sel) {
  let rest = sel.trim()
  while (rest) {
    let m
    if ((m = /^:not\(([^)]*)\)/.exec(rest))) {
      if (matchesSimple(el, m[1])) return false
    } else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) {
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

/**
 * Compile a `pattern` attribute the way the HTML spec tells browsers to:
 * implicitly anchored, with the `v` flag. The flag is the point — it rejects
 * the unescaped `(){}|` and the doubled punctuators that a hand-written symbol
 * whitelist tends to contain, so a pattern that a browser would silently ignore
 * throws here instead. Cached because ValidityState is a getter.
 * @type {Map<string, RegExp>}
 */
const patternCache = new Map()
const compilePattern = (pattern) => {
  let compiled = patternCache.get(pattern)
  if (!compiled) {
    compiled = new RegExp('^(?:' + pattern + ')$', 'v')
    patternCache.set(pattern, compiled)
  }
  return compiled
}

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = String(tag).toUpperCase()
    this._attrs = new Map()
    this.children = []
    this.parentElement = null
    this.style = {}
    this.textContent = ''
    this.id = ''
    this.value = ''
    this.noValidate = false
    this.rendered = true
    this.willValidate = /^(INPUT|SELECT|TEXTAREA)$/.test(this.tagName)
    this._custom = ''
    this._listeners = new Map()
    this.focusCalls = []
    this.scrollCalls = []
    this.selectionStart = undefined
    this.selectionEnd = undefined

    const classes = new Set()
    this._classes = classes
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !classes.has(c) : !!on
        if (next) classes.add(c)
        else classes.delete(c)
        return next
      },
    }

    Object.keys(attrs).forEach((key) => this.setAttribute(key, attrs[key]))
    String(attrs.class || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => classes.add(c))
    children.forEach((child) => this.append(child))
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
    child.parentElement = this
    this.children.push(child)
    return child
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
  closest(selector) {
    let node = this
    while (node) {
      if (matches(node, selector)) return node
      node = node.parentElement
    }
    return null
  }
  insertAdjacentElement(position, el) {
    assert.equal(position, 'afterend')
    const parent = this.parentElement
    parent.children.splice(parent.children.indexOf(this) + 1, 0, el)
    el.parentElement = parent
    return el
  }

  getClientRects() {
    return this.rendered ? [{}] : []
  }
  setCustomValidity(message) {
    this._custom = message || ''
  }
  get validity() {
    const valueMissing = this.hasAttribute('required') && !this.value
    const type = this.getAttribute('type')
    const typeMismatch =
      type === 'email' && !!this.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)
    const pattern = this.getAttribute('pattern')
    // An empty value is never a pattern mismatch (that is `required`'s job), and
    // the expression is anchored and compiled with the `v` flag exactly as the
    // HTML spec tells browsers to compile it — see section 8.
    const patternMismatch = !!pattern && !!this.value && !compilePattern(pattern).test(this.value)
    const customError = !!this._custom
    return {
      valueMissing,
      typeMismatch,
      badInput: false,
      patternMismatch,
      tooShort: false,
      tooLong: false,
      rangeUnderflow: false,
      rangeOverflow: false,
      stepMismatch: false,
      customError,
      valid: !valueMissing && !typeMismatch && !patternMismatch && !customError,
    }
  }
  get validationMessage() {
    if (this._custom) return this._custom
    const v = this.validity
    if (v.valueMissing) return 'Please fill out this field.'
    if (v.typeMismatch) return 'Please enter an email address.'
    if (v.patternMismatch) return 'Please match the requested format.'
    return ''
  }

  focus(options) {
    this.focusCalls.push(options)
  }
  scrollIntoView(options) {
    this.scrollCalls.push(options)
  }
  setSelectionRange(start, end) {
    this.selectionStart = start
    this.selectionEnd = end
  }

  addEventListener(type, listener) {
    const list = this._listeners.get(type) || []
    list.push(listener)
    this._listeners.set(type, list)
  }
}

/** @returns {Element} */
const h = (tag, attrs, children) => new Element(tag, attrs || {}, children || [])

/**
 * @param {string} type
 * @param {Element} target
 * @param {object} [extra] extra event properties (e.g. ToggleEvent's newState)
 */
function makeEvent(type, target, extra) {
  return Object.assign({
    type,
    target,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopImmediatePropagation() {
      this.stopped = true
    },
  }, extra || {})
}

/**
 * Run the script against a fake document whose body is `root`.
 * @param {Element} root
 * @param {{reducedMotion?: boolean}} [options]
 */
function mount(root, options = {}) {
  const documentListeners = new Map()
  const document = {
    readyState: 'complete',
    addEventListener(type, listener) {
      const list = documentListeners.get(type) || []
      list.push(listener)
      documentListeners.set(type, list)
    },
    createElement: (tag) => h(tag),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    querySelector: (selector) => root.querySelector(selector),
  }
  const window = {
    matchMedia: (query) => ({ matches: !!options.reducedMotion && /reduced-motion/.test(query) }),
  }
  window.window = window
  const context = vm.createContext({
    Element,
    console,
    document,
    setTimeout,
    clearTimeout,
    window,
  })
  vm.runInContext(source, context)

  /** fire a listener bound on `el` itself (the validator's form listeners) */
  const fire = (el, type, target, extra) => {
    const event = makeEvent(type, target || el, extra)
    ;(el._listeners.get(type) || []).forEach((listener) => listener(event))
    return event
  }
  /** fire the document-capture listeners (submit / click gates, dialog toggle) */
  const fireDocument = (type, target, extra) => {
    const event = makeEvent(type, target, extra)
    ;(documentListeners.get(type) || []).forEach((listener) => listener(event))
    return event
  }
  return { WfValidate: window.WfValidate, fire, fireDocument, root, window }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// ---------------------------------------------------------------------------
// 1. submit-disable
// ---------------------------------------------------------------------------

function submitDisableFixture() {
  const email = h('input', { name: 'Email', type: 'email', required: '' })
  const error = h('div', { 'wf-validate-element': 'error' })
  const themed = h('button', { type: 'submit', 'data-theme': 'primary' })
  const plain = h('button', { type: 'submit' })
  const form = h('form', {}, [email, error, themed, plain])
  // marker OUTSIDE the form, inside the opted-in wrapper (modal-footer shape)
  const outside = h('div', { 'wf-validate-element': 'submit' })
  const wrapper = h('div', { 'wf-validate-element': 'form', 'wf-validate-submit-disable': '' }, [
    form,
    outside,
  ])
  const root = h('body', {}, [wrapper])
  return { email, error, themed, plain, outside, form, root }
}

const isDisabled = (el) =>
  el.classList.contains(DISABLED) &&
  el.getAttribute('aria-disabled') === 'true' &&
  el.getAttribute('data-theme') === 'disabled'

const isEnabled = (el) =>
  !el.classList.contains(DISABLED) && el.getAttribute('aria-disabled') === null

test('submit-disable: an empty required form starts disabled at bind time', () => {
  const f = submitDisableFixture()
  mount(f.root)

  assert.equal(isDisabled(f.themed), true)
  assert.equal(isDisabled(f.plain), true)
  assert.equal(isDisabled(f.outside), true, 'marked submitter outside the form is covered')
})

test('submit-disable: opting out leaves every submitter untouched', () => {
  const f = submitDisableFixture()
  f.root.children[0].removeAttribute('wf-validate-submit-disable')
  mount(f.root)

  assert.equal(f.themed.classList.contains(DISABLED), false)
  assert.equal(f.themed.getAttribute('aria-disabled'), null)
  assert.equal(f.themed.getAttribute('data-theme'), 'primary')
  assert.equal(f.outside.classList.contains(DISABLED), false)
})

test('submit-disable: enabling restores a pre-existing data-theme and removes an invented one', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)

  f.email.value = 'hi@example.com'
  app.fire(f.form, 'input', f.email)

  assert.equal(isEnabled(f.themed), true)
  assert.equal(f.themed.getAttribute('data-theme'), 'primary', 'cached theme restored')
  assert.equal(isEnabled(f.plain), true)
  assert.equal(f.plain.hasAttribute('data-theme'), false, 'no pre-existing theme -> removed')
  assert.equal(isEnabled(f.outside), true)
})

test('submit-disable: the disabled/enabled round-trip survives repeats', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)

  f.email.value = 'hi@example.com'
  app.fire(f.form, 'input', f.email)
  assert.equal(f.themed.getAttribute('data-theme'), 'primary')

  f.email.value = ''
  app.fire(f.form, 'input', f.email)
  assert.equal(isDisabled(f.themed), true)

  f.email.value = 'again@example.com'
  app.fire(f.form, 'input', f.email)
  assert.equal(isEnabled(f.themed), true)
  assert.equal(f.themed.getAttribute('data-theme'), 'primary', 'still restored on the 2nd pass')
})

test('submit-disable: submitters are collected lazily, so late buttons get the state', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)

  const late = h('button', { type: 'submit' })
  f.form.append(late)
  assert.equal(late.classList.contains(DISABLED), false, 'not yet — no event has run')

  app.fire(f.form, 'input', f.email)
  assert.equal(isDisabled(late), true)
})

test('submit-disable: never sets the native disabled property, and the click gate still fires', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)

  assert.equal(f.themed.disabled, undefined, 'no native disabled — button stays clickable')

  const event = app.fireDocument('click', f.themed)
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.stopped, true)
  assert.equal(f.email.classList.contains(INVALID), true, 'the gate revealed the error')
  assert.equal(f.error.style.display, '')
})

test('submit-disable: validateAll refreshes the state (API path)', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)

  f.email.value = 'hi@example.com'
  assert.equal(app.WfValidate.validate(f.form), true)
  assert.equal(isEnabled(f.themed), true)
})

// ---------------------------------------------------------------------------
// 1b. submit-disable: the theme attribute the opt-in's value names
// ---------------------------------------------------------------------------

/**
 * A form whose buttons theme off data-button-theme (the real-world shape: the
 * authored value is "black", not a data-theme at all).
 * @param {string} optIn value of wf-validate-submit-disable
 */
function customThemeFixture(optIn) {
  const email = h('input', { name: 'Email', type: 'email', required: '' })
  const themed = h('button', { type: 'submit', 'data-button-theme': 'black' })
  const plain = h('button', { type: 'submit' })
  const form = h('form', {}, [email, themed, plain])
  const wrapper = h('div', { 'wf-validate-element': 'form', 'wf-validate-submit-disable': optIn }, [
    form,
  ])
  return { email, themed, plain, form, root: h('body', {}, [wrapper]) }
}

test('submit-disable: a data- value names the attribute that gets "disabled"', () => {
  const f = customThemeFixture('data-button-theme')
  mount(f.root)

  assert.equal(f.themed.classList.contains(DISABLED), true)
  assert.equal(f.themed.getAttribute('aria-disabled'), 'true')
  assert.equal(f.themed.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.themed.hasAttribute('data-theme'), false, 'the default attribute is left alone')

  assert.equal(f.plain.getAttribute('data-button-theme'), 'disabled', 'invented on a bare button')
  assert.equal(f.plain.hasAttribute('data-theme'), false)
})

test('submit-disable: the named attribute round-trips its authored value', () => {
  const f = customThemeFixture('data-button-theme')
  const app = mount(f.root)

  f.email.value = 'hi@example.com'
  app.fire(f.form, 'input', f.email)
  assert.equal(isEnabled(f.themed), true)
  assert.equal(f.themed.getAttribute('data-button-theme'), 'black', 'authored value restored')
  assert.equal(f.plain.hasAttribute('data-button-theme'), false, 'nothing there before -> removed')
  assert.equal(f.themed.hasAttribute('data-theme'), false, 'never touched, in either direction')

  f.email.value = ''
  app.fire(f.form, 'input', f.email)
  assert.equal(f.themed.getAttribute('data-button-theme'), 'disabled')

  f.email.value = 'again@example.com'
  app.fire(f.form, 'input', f.email)
  assert.equal(f.themed.getAttribute('data-button-theme'), 'black', 'still restored on the 2nd pass')
})

test('submit-disable: a non-attribute value falls back to data-theme', () => {
  // "true" is what Webflow's Designer nudges you into typing, and what every
  // install shipped before the value meant anything carries
  ;['true', 'yes please', ''].forEach((optIn) => {
    const f = submitDisableFixture()
    f.root.children[0].setAttribute('wf-validate-submit-disable', optIn)
    const app = mount(f.root)

    assert.equal(isDisabled(f.themed), true, 'value ' + JSON.stringify(optIn) + ': data-theme used')
    assert.equal(f.plain.getAttribute('data-theme'), 'disabled')

    f.email.value = 'hi@example.com'
    app.fire(f.form, 'input', f.email)
    assert.equal(f.themed.getAttribute('data-theme'), 'primary')
    assert.equal(f.plain.hasAttribute('data-theme'), false)
  })
})

test('refresh: a required field injected after bind joins the validation gate', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)
  f.email.value = 'hi@example.com'
  app.fire(f.form, 'input', f.email)

  const late = h('input', { name: 'Estimated-Hours', required: '' })
  f.form.append(late)
  assert.equal(app.WfValidate.validate(f.form), true, 'not part of the initial field scan')

  app.WfValidate.refresh(f.form)
  assert.equal(app.WfValidate.validate(f.form), false)
  assert.equal(late.classList.contains(INVALID), true)
  assert.equal(late.getAttribute('aria-invalid'), 'true')
})

// ---------------------------------------------------------------------------
// 2. the silent check paints nothing and touches nothing
// ---------------------------------------------------------------------------

test('the bind-time and input-time silent checks never paint or mark touched', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)

  // form is invalid (empty required email) and the submitters prove the check ran
  assert.equal(isDisabled(f.themed), true)
  assert.equal(f.email.classList.contains(INVALID), false)
  assert.equal(f.email.getAttribute('aria-invalid'), null)
  assert.equal(f.error.style.display, 'none')
  assert.equal(f.error.textContent, '')
  assert.equal(f.form.classList.contains(INVALID), false)

  // typing an invalid value must still not paint: the group is untouched
  f.email.value = 'nope'
  app.fire(f.form, 'input', f.email)
  assert.equal(isDisabled(f.themed), true, 'still incomplete')
  assert.equal(f.email.classList.contains(INVALID), false)
  assert.equal(f.error.style.display, 'none')

  // ...until the user leaves the field
  app.fire(f.form, 'focusout', f.email)
  assert.equal(f.email.classList.contains(INVALID), true)
  assert.equal(f.error.style.display, '')
})

// ---------------------------------------------------------------------------
// 3. success slot visibility matrix
// ---------------------------------------------------------------------------

function successFixture() {
  const email = h('input', { name: 'Email', type: 'email', required: '' })
  const error = h('div', { 'wf-validate-element': 'error' }, [
    h('div', { 'wf-validate-element': 'message' }),
  ])
  const success = h('div', { 'wf-validate-element': 'success' }, [])
  success.textContent = 'Looks good!'
  const field = h('div', {}, [email, error, success])
  const form = h('form', { 'wf-validate-element': 'form' }, [field])
  return { email, error, success, form, root: h('body', {}, [form]) }
}

test('success slot: hidden at bind, and never shown while the group is untouched', () => {
  const f = successFixture()
  const app = mount(f.root)

  assert.equal(f.success.style.display, 'none')
  assert.equal(f.success.getAttribute('role'), null, 'a success slot is not an alert')

  f.email.value = 'hi@example.com'
  app.fire(f.form, 'input', f.email)
  assert.equal(f.success.style.display, 'none', 'valid but untouched -> still hidden')
})

test('success slot: shown only while touched + valid, never alongside the error', () => {
  const f = successFixture()
  const app = mount(f.root)

  // touched + invalid -> error only
  app.fire(f.form, 'focusout', f.email)
  assert.equal(f.error.style.display, '')
  assert.equal(f.success.style.display, 'none')

  // touched + valid -> success only
  f.email.value = 'hi@example.com'
  app.fire(f.form, 'input', f.email)
  assert.equal(f.error.style.display, 'none')
  assert.equal(f.success.style.display, '')

  // back to invalid -> error only again
  f.email.value = ''
  app.fire(f.form, 'input', f.email)
  assert.equal(f.error.style.display, '')
  assert.equal(f.success.style.display, 'none')
})

test('success slot: the script never rewrites the designer content', () => {
  const f = successFixture()
  const app = mount(f.root)

  f.email.value = 'hi@example.com'
  app.fire(f.form, 'focusout', f.email)

  assert.equal(f.success.style.display, '')
  assert.equal(f.success.textContent, 'Looks good!')
})

// ---------------------------------------------------------------------------
// 4. reset
// ---------------------------------------------------------------------------

function resetFixture() {
  const bio = h('textarea', { name: 'Bio', required: '', maxlength: '2500' })
  const error = h('div', { 'wf-validate-element': 'error' })
  const success = h('div', { 'wf-validate-element': 'success' })
  const count = h('div', { 'wf-validate-element': 'count' })
  const submit = h('button', { type: 'submit' })
  const form = h('form', {}, [h('div', {}, [bio, error, success, count]), submit])
  const wrapper = h('div', { 'wf-validate-element': 'form', 'wf-validate-submit-disable': '' }, [form])
  return { bio, error, success, count, submit, form, root: h('body', {}, [wrapper]) }
}

test('reset: clears touched/painted state synchronously', () => {
  const f = resetFixture()
  const app = mount(f.root)

  app.fireDocument('submit', f.form) // paints everything invalid
  assert.equal(f.bio.classList.contains(INVALID), true)
  assert.equal(f.form.classList.contains(INVALID), true)

  app.fire(f.form, 'reset', f.form)

  assert.equal(f.bio.classList.contains(INVALID), false)
  assert.equal(f.bio.getAttribute('aria-invalid'), 'false')
  assert.equal(f.error.style.display, 'none')
  assert.equal(f.success.style.display, 'none')
  assert.equal(f.form.classList.contains(INVALID), false)
})

test('reset: a valid-then-reset form hides the success slot and does not re-show the error', () => {
  const f = resetFixture()
  const app = mount(f.root)

  f.bio.value = 'a bio'
  app.fire(f.form, 'focusout', f.bio)
  assert.equal(f.success.style.display, '')

  app.fire(f.form, 'reset', f.form)
  assert.equal(f.success.style.display, 'none')
  assert.equal(f.error.style.display, 'none')
})

test('reset: counter and submit-disable are recomputed AFTER the values revert', async () => {
  const f = resetFixture()
  const app = mount(f.root)

  f.bio.value = 'a bio'
  app.fire(f.form, 'input', f.bio)
  assert.equal(f.count.textContent, '5 / 2,500')
  assert.equal(isEnabled(f.submit), true)

  // reset fires BEFORE the browser reverts the value
  app.fire(f.form, 'reset', f.form)
  assert.equal(f.count.textContent, '5 / 2,500', 'not recomputed synchronously — value is stale')
  f.bio.value = '' // the browser reverts here, after the event

  await tick()
  assert.equal(f.count.textContent, '0 / 2,500')
  assert.equal(isDisabled(f.submit), true)
})

// ---------------------------------------------------------------------------
// 5. rule regressions (length / words / match) + scroll-into-view
// ---------------------------------------------------------------------------

function rulesFixture() {
  const short = h('input', { name: 'Handle', minlength: '5' })
  const shortError = h('div', { 'wf-validate-element': 'error' })
  const long = h('input', { name: 'Nick', maxlength: '3' })
  const longError = h('div', { 'wf-validate-element': 'error' })
  const bio = h('textarea', { name: 'Bio', 'wf-validate-minwords': '3', 'wf-validate-maxwords': '5' })
  const bioError = h('div', { 'wf-validate-element': 'error' })
  const password = h('input', { name: 'Password' })
  const confirm = h('input', {
    name: 'Confirm',
    'wf-validate-match': 'Password',
    'wf-validate-message-match': 'Passwords must match.',
  })
  const confirmError = h('div', { 'wf-validate-element': 'error' })
  const form = h('form', { 'wf-validate-element': 'form' }, [
    h('div', {}, [short, shortError]),
    h('div', {}, [long, longError]),
    h('div', {}, [bio, bioError]),
    h('div', {}, [password]),
    h('div', {}, [confirm, confirmError]),
  ])
  return {
    short,
    shortError,
    long,
    longError,
    bio,
    bioError,
    password,
    confirm,
    confirmError,
    form,
    root: h('body', {}, [form]),
  }
}

test('rules: minlength / maxlength messages still render', () => {
  const f = rulesFixture()
  const app = mount(f.root)

  f.short.value = 'abc'
  app.fire(f.form, 'focusout', f.short)
  assert.equal(
    f.shortError.textContent,
    'Please use at least 5 characters (you are currently using 3).',
  )

  f.long.value = 'abcdef'
  app.fire(f.form, 'focusout', f.long)
  assert.equal(
    f.longError.textContent,
    'Please use no more than 3 characters (you are currently using 6).',
  )
})

test('rules: word bounds still render, and clear when back in range', () => {
  const f = rulesFixture()
  const app = mount(f.root)

  f.bio.value = 'one two'
  app.fire(f.form, 'focusout', f.bio)
  assert.equal(f.bioError.textContent, 'Please use at least 3 words (you are currently using 2).')

  f.bio.value = 'one two three four five six'
  app.fire(f.form, 'input', f.bio)
  assert.equal(f.bioError.textContent, 'Please use no more than 5 words (you are currently using 6).')

  f.bio.value = 'one two three four'
  app.fire(f.form, 'input', f.bio)
  assert.equal(f.bioError.style.display, 'none')
  assert.equal(f.bio.classList.contains(INVALID), false)
})

test('rules: the match rule still renders its override message', () => {
  const f = rulesFixture()
  const app = mount(f.root)

  f.password.value = 'hunter2'
  f.confirm.value = 'hunter3'
  app.fire(f.form, 'focusout', f.confirm)
  assert.equal(f.confirmError.textContent, 'Passwords must match.')

  f.confirm.value = 'hunter2'
  app.fire(f.form, 'input', f.confirm)
  assert.equal(f.confirmError.style.display, 'none')
})

test('rules: an unrendered field is skipped instead of blocking submit', () => {
  const f = rulesFixture()
  f.short.setAttribute('required', '')
  f.short.rendered = false
  const app = mount(f.root)

  const event = app.fireDocument('submit', f.form)
  assert.equal(event.defaultPrevented, false)
})

test('a blocked submit focuses without scrolling, then centers the field smoothly', () => {
  const f = rulesFixture()
  f.short.value = 'abc'
  const app = mount(f.root)

  app.fireDocument('submit', f.form)

  // options objects are created inside the vm realm, so compare structurally
  assert.equal(f.short.focusCalls.length, 1)
  assert.equal(f.short.focusCalls[0].preventScroll, true)
  assert.equal(f.short.scrollCalls.length, 1)
  assert.equal(f.short.scrollCalls[0].behavior, 'smooth')
  assert.equal(f.short.scrollCalls[0].block, 'center')
})

test('prefers-reduced-motion makes the scroll instant', () => {
  const f = rulesFixture()
  f.short.value = 'abc'
  const app = mount(f.root, { reducedMotion: true })

  app.fireDocument('submit', f.form)

  assert.equal(f.short.scrollCalls.length, 1)
  assert.equal(f.short.scrollCalls[0].behavior, 'auto')
  assert.equal(f.short.scrollCalls[0].block, 'center')
})

// ---------------------------------------------------------------------------
// 6. reveal recomputes: dialog toggle + focusin
//
// A form bound inside a closed <dialog> is display:none, so every field measures
// as unrendered and is skipped: the empty form computes as COMPLETE and its
// submitter is left looking enabled. Opening the dialog fires no
// input/change/focusout, so that wrong look used to survive until the first
// interaction. `rendered = false` on the stub's fields is the closed dialog.
// ---------------------------------------------------------------------------

/** A gated form living inside a <dialog>, themed off data-button-theme. */
function dialogFixture() {
  const email = h('input', { name: 'Email', type: 'email', required: '', maxlength: '80' })
  const error = h('div', { 'wf-validate-element': 'error' })
  const count = h('div', { 'wf-validate-element': 'count' })
  const submit = h('button', { type: 'submit', 'data-button-theme': 'black' })
  const form = h(
    'form',
    { 'wf-validate-element': 'form', 'wf-validate-submit-disable': 'data-button-theme' },
    [h('div', {}, [email, error, count]), submit],
  )
  const dialog = h('dialog', {}, [form])
  return { email, error, count, submit, form, dialog, root: h('body', {}, [dialog]) }
}

const themeDisabled = (el) =>
  el.classList.contains(DISABLED) &&
  el.getAttribute('aria-disabled') === 'true' &&
  el.getAttribute('data-button-theme') === 'disabled'

test('dialog toggle: opening the dialog flips the wrongly-enabled submitter to disabled', () => {
  const f = dialogFixture()
  f.email.rendered = false // closed dialog: display:none, no client rects
  const app = mount(f.root)

  // the bug this exists to fix: nothing was measurable, so the empty required
  // form counted as complete and the submitter kept its authored look
  assert.equal(isEnabled(f.submit), true, 'bound while hidden -> looks complete')
  assert.equal(f.submit.getAttribute('data-button-theme'), 'black')

  // dialog.showModal(): layout is real now, but no input/change/focusout fires
  f.email.rendered = true
  app.fireDocument('toggle', f.dialog, { newState: 'open' })

  assert.equal(themeDisabled(f.submit), true, 'recomputed at open, before any interaction')
})

test('dialog toggle: the open recompute is silent — nothing painted, nothing touched', () => {
  const f = dialogFixture()
  f.email.rendered = false
  const app = mount(f.root)

  f.email.rendered = true
  app.fireDocument('toggle', f.dialog, { newState: 'open' })

  assert.equal(f.email.classList.contains(INVALID), false, 'a freshly opened modal shows no errors')
  assert.equal(f.email.getAttribute('aria-invalid'), null)
  assert.equal(f.error.style.display, 'none')
  assert.equal(f.form.classList.contains(INVALID), false)

  // ...and the user still earns the error the normal way
  app.fire(f.form, 'focusout', f.email)
  assert.equal(f.email.classList.contains(INVALID), true)
  assert.equal(f.error.style.display, '')
})

test('dialog toggle: counters are refreshed in the same pass', () => {
  const f = dialogFixture()
  f.email.rendered = false
  const app = mount(f.root)
  assert.equal(f.count.textContent, '0 / 80')

  // a value put there while the dialog was closed (draft restore, prefill) fires
  // no input event, so the counter text is stale until the open recompute
  f.email.value = 'hi@example.com'
  f.email.rendered = true
  assert.equal(f.count.textContent, '0 / 80', 'still stale — nothing has run')

  app.fireDocument('toggle', f.dialog, { newState: 'open' })
  assert.equal(f.count.textContent, '14 / 80')
})

test('dialog toggle: a close, or a ToggleEvent with no newState, recomputes nothing', () => {
  const f = dialogFixture()
  f.email.rendered = false
  const app = mount(f.root)
  assert.equal(isEnabled(f.submit), true)

  f.email.rendered = true
  app.fireDocument('toggle', f.dialog, { newState: 'closed' })
  assert.equal(isEnabled(f.submit), true, 'closing is not a reveal')

  app.fireDocument('toggle', f.dialog) // older ToggleEvent shape: no newState
  assert.equal(isEnabled(f.submit), true, 'a missing newState is treated as not-open')

  // and the real open still works after both no-ops
  app.fireDocument('toggle', f.dialog, { newState: 'open' })
  assert.equal(themeDisabled(f.submit), true)
})

test('dialog toggle: the toggling element may itself be the bound form (popover form)', () => {
  const f = dialogFixture()
  f.email.rendered = false
  const app = mount(f.root)

  // the popover/dialog attribute sits on the <form> itself, so the event target
  // IS the bound form rather than an ancestor of it
  f.email.rendered = true
  app.fireDocument('toggle', f.form, { newState: 'open' })

  assert.equal(themeDisabled(f.submit), true)
})

test('dialog toggle: an unbound form inside the revealed subtree is left alone', () => {
  const f = dialogFixture()
  f.email.rendered = false
  const app = mount(f.root)

  const stray = h('form', {}, [h('input', { name: 'Stray', required: '' })])
  f.dialog.append(stray)

  f.email.rendered = true
  app.fireDocument('toggle', f.dialog, { newState: 'open' })

  assert.equal(themeDisabled(f.submit), true, 'the bound form still recomputed')
  assert.equal(stray.noValidate, false, 'the unbound one was never bound or touched')
})

test('focusin: entering a field recomputes state for reveals that fire no other event', () => {
  const f = submitDisableFixture()
  f.email.rendered = false // a class-swapped tab/step panel, not a dialog
  const app = mount(f.root)
  assert.equal(isEnabled(f.themed), true, 'measured while hidden -> looks complete')

  // the panel is shown by a class change (no event the script can hear); the
  // first focusin is the backstop
  f.email.rendered = true
  app.fire(f.form, 'focusin', f.email)

  assert.equal(isDisabled(f.themed), true)
  assert.equal(isDisabled(f.outside), true, 'external marked submitter too')
  assert.equal(f.email.classList.contains(INVALID), false, 'focusin never paints')
  assert.equal(f.error.style.display, 'none')
})

test('focusin: entering a field on a complete form leaves the submitter enabled', () => {
  const f = submitDisableFixture()
  const app = mount(f.root)

  f.email.value = 'hi@example.com'
  app.fire(f.form, 'input', f.email)
  assert.equal(isEnabled(f.themed), true)

  app.fire(f.form, 'focusin', f.email)
  assert.equal(isEnabled(f.themed), true, 'no flicker back to disabled')
  assert.equal(f.themed.getAttribute('data-theme'), 'primary')
})

// ---------------------------------------------------------------------------
// 7. count-max must gate submit (user: 5000/500 still goes through)
//
// The live counter can show a 500 denominator from wf-validate-count-max even
// when the field has no maxlength, or a much higher one (Webflow embeds often
// ship maxlength="5000"). Displaying 5,000 / 500 while still submitting is the
// bug.
// ---------------------------------------------------------------------------

function countLimitFixture(fieldAttrs, countAttrs) {
  const brief = h('textarea', Object.assign({ name: 'Brief' }, fieldAttrs))
  const count = h('div', Object.assign({ 'wf-validate-element': 'count' }, countAttrs))
  const error = h('div', { 'wf-validate-element': 'error' })
  const submit = h('button', { type: 'submit' })
  const form = h(
    'form',
    { 'wf-validate-element': 'form', 'wf-validate-submit-disable': '' },
    [h('div', {}, [brief, error, count]), submit],
  )
  return { brief, count, error, submit, form, root: h('body', {}, [form]) }
}

test('count-max 500: 5000 chars shows 5,000 / 500 and must not submit', () => {
  const f = countLimitFixture({}, { 'wf-validate-count-max': '500' })
  const app = mount(f.root)

  f.brief.value = 'x'.repeat(5000)
  app.fire(f.form, 'input', f.brief)

  assert.equal(f.count.textContent, '5,000 / 500')
  assert.equal(isDisabled(f.submit), true, 'over the shown 500 limit must soft-disable')
  const event = app.fireDocument('submit', f.form)
  assert.equal(event.defaultPrevented, true, 'over the shown 500 limit must block submit')
})

test('count-max 500 + maxlength 5000: 5000 chars still must not submit', () => {
  const f = countLimitFixture({ maxlength: '5000' }, { 'wf-validate-count-max': '500' })
  const app = mount(f.root)

  f.brief.value = 'x'.repeat(5000)
  app.fire(f.form, 'input', f.brief)

  assert.equal(f.count.textContent, '5,000 / 500')
  assert.equal(isDisabled(f.submit), true)
  const event = app.fireDocument('submit', f.form)
  assert.equal(event.defaultPrevented, true)
})

test('count-max 500: 501 chars is enough to be over-limit (minimised)', () => {
  const f = countLimitFixture({}, { 'wf-validate-count-max': '500' })
  const app = mount(f.root)

  f.brief.value = 'x'.repeat(500)
  app.fire(f.form, 'input', f.brief)
  assert.equal(f.count.textContent, '500 / 500')
  assert.equal(isEnabled(f.submit), true, 'exactly 500 must still submit')

  f.brief.value = 'x'.repeat(501)
  app.fire(f.form, 'input', f.brief)
  assert.equal(f.count.textContent, '501 / 500')
  assert.equal(isDisabled(f.submit), true, '501 must soft-disable')
  const event = app.fireDocument('submit', f.form)
  assert.equal(event.defaultPrevented, true, '501 must block submit')
  assert.equal(
    f.error.textContent,
    'Please use no more than 500 characters (you are currently using 501).',
  )
})

test('maxlength 500 control: JS-set 501 chars already blocks without count-max', () => {
  const f = countLimitFixture({ maxlength: '500' }, {})
  const app = mount(f.root)

  f.brief.value = 'x'.repeat(501)
  app.fire(f.form, 'input', f.brief)

  assert.equal(isDisabled(f.submit), true)
  const event = app.fireDocument('submit', f.form)
  assert.equal(event.defaultPrevented, true)
})

test('count-max 5 words: 6 words must not submit', () => {
  const f = countLimitFixture({}, { 'wf-validate-count-max': '5', 'wf-validate-count-mode': 'words' })
  const app = mount(f.root)

  f.brief.value = 'one two three four five six'
  app.fire(f.form, 'input', f.brief)

  assert.equal(f.count.textContent, '6 / 5 words')
  assert.equal(isDisabled(f.submit), true)
  const event = app.fireDocument('submit', f.form)
  assert.equal(event.defaultPrevented, true)
  assert.equal(
    f.error.textContent,
    'Please use no more than 5 words (you are currently using 6).',
  )
  assert.equal(f.count.style.display, 'none', 'helper hides while the error is showing')
})

test('count-max 5 words: a 6th word keystroke is blocked', () => {
  const f = countLimitFixture({}, { 'wf-validate-count-max': '5', 'wf-validate-count-mode': 'words' })
  const app = mount(f.root)

  f.brief.value = 'one two three four five'
  const blocked = app.fire(f.brief, 'beforeinput', f.brief, {
    data: ' six',
    inputType: 'insertText',
  })
  assert.equal(blocked.defaultPrevented, true)

  const extendLast = app.fire(f.brief, 'beforeinput', f.brief, {
    data: 'x',
    inputType: 'insertText',
  })
  assert.equal(extendLast.defaultPrevented, false, 'extending the last word stays at 5')

  const backspace = app.fire(f.brief, 'beforeinput', f.brief, {
    inputType: 'deleteContentBackward',
  })
  assert.equal(backspace.defaultPrevented, false)
})

test('count-max 5 words: paste is truncated to the remaining room', () => {
  const f = countLimitFixture({}, { 'wf-validate-count-max': '5', 'wf-validate-count-mode': 'words' })
  const app = mount(f.root)

  f.brief.value = 'one two three '
  app.fire(f.brief, 'paste', f.brief, {
    clipboardData: { getData: () => 'four five six seven' },
  })

  assert.equal(f.brief.value, 'one two three four five')
  assert.equal(f.count.textContent, '5 / 5 words')
  assert.equal(isEnabled(f.submit), true)
})

test('count helper returns once the over-limit error clears', () => {
  const f = countLimitFixture({}, { 'wf-validate-count-max': '5', 'wf-validate-count-mode': 'words' })
  const app = mount(f.root)

  f.brief.value = 'one two three four five six'
  app.fireDocument('submit', f.form)
  assert.equal(f.count.style.display, 'none')

  f.brief.value = 'one two three four five'
  app.fire(f.form, 'input', f.brief)
  assert.equal(f.error.style.display, 'none')
  assert.equal(f.count.style.display, '')
})

test('count-max 3 chars: a 4th character keystroke is blocked', () => {
  const f = countLimitFixture({}, { 'wf-validate-count-max': '3' })
  const app = mount(f.root)

  f.brief.value = 'abc'
  const blocked = app.fire(f.brief, 'beforeinput', f.brief, {
    data: 'd',
    inputType: 'insertText',
  })
  assert.equal(blocked.defaultPrevented, true)
})

// ---------------------------------------------------------------------------
// 8. password complexity (monday 3162492240)
//
// The policy lives in Webflow attributes, not in this repo's JavaScript, so the
// README is its single source of truth and these tests read the canonical
// `pattern` straight out of it. Drift between the documented recipe and the
// vectors below is therefore a failing test rather than a silent divergence.
//
// The mini DOM compiles `pattern` with the `v` flag, which is what the HTML
// spec tells browsers to use. That is deliberate: `v` mode makes several
// characters errors inside a character class unless escaped (`( ) { } | -` …)
// and forbids doubled punctuators (`&&`, `!!` …), so the textbook symbol
// whitelist `[!@#$%^&*(),.?":{}|<>]` is a SyntaxError in a real browser and
// would silently accept every password. Compiling it here is what stops that
// shipping.
// ---------------------------------------------------------------------------

const readmeSource = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')

/** The canonical policy, lifted out of the README's password-complexity recipe. */
const PASSWORD_POLICY = (() => {
  const section = /### Password complexity([\s\S]*?)(?=\n## |\n### |$)/.exec(readmeSource)
  if (!section) throw new Error('README.md has no "### Password complexity" section')
  const pattern = /pattern="([^"]+)"/.exec(section[1])
  const message = /wf-validate-message-pattern="([^"]+)"/.exec(section[1])
  if (!pattern || !message) {
    throw new Error('The README password recipe must carry both pattern= and wf-validate-message-pattern=')
  }
  return { pattern: pattern[1], message: message[1] }
})()

function passwordFixture(inputAttrs) {
  const password = h(
    'input',
    Object.assign(
      {
        name: 'Password',
        type: 'password',
        required: '',
        maxlength: '256',
        pattern: PASSWORD_POLICY.pattern,
        'wf-validate-message-pattern': PASSWORD_POLICY.message,
      },
      inputAttrs,
    ),
  )
  // mirrors the live markup: the input sits inside the show/hide toggle wrapper
  const wrapper = h('div', { 'data-password-input': '' }, [password])
  const error = h('div', { 'wf-validate-element': 'error' })
  const submit = h('input', { type: 'submit' })
  const form = h('form', { 'wf-validate-element': 'form', 'data-ms-form': 'signup' }, [
    wrapper,
    error,
    submit,
  ])
  const root = h('body', {}, [form])
  return { password, error, submit, form, root }
}

test('password policy: the documented pattern compiles under the v flag', () => {
  assert.doesNotThrow(
    () => new RegExp('^(?:' + PASSWORD_POLICY.pattern + ')$', 'v'),
    'the pattern must be a valid v-mode regular expression, or every browser accepts every password',
  )
})

test('password policy: the documented pattern is HTML-attribute safe', () => {
  assert.equal(/["<>&]/.test(PASSWORD_POLICY.pattern), false)
})

const WEAK_PASSWORDS = [
  ['seven characters, every class', 'Aa1!aaa'],
  ['no uppercase', 'aa1!aaaa'],
  ['no lowercase', 'AA1!AAAA'],
  ['no number', 'Aa!aaaaa'],
  ['no symbol', 'Aa1aaaaa'],
  ['the classic Passw0rd', 'Passw0rd'],
  ['all lowercase letters', 'password'],
]

for (const [label, value] of WEAK_PASSWORDS) {
  test(`password policy: ${label} is rejected with the policy message`, () => {
    const f = passwordFixture()
    const app = mount(f.root)

    f.password.value = value
    const submit = app.fireDocument('submit', f.form)

    assert.equal(submit.defaultPrevented, true, 'the submit must be blocked')
    assert.equal(f.error.style.display, '')
    assert.equal(f.error.textContent, PASSWORD_POLICY.message)
    assert.equal(f.password.classList.contains(INVALID), true)
  })
}

const STRONG_PASSWORDS = [
  ['the shortest passing password', 'Aa1!aaaa'],
  ['a passphrase whose symbol is a space', 'Correct horse 9'],
  ['a non-ASCII symbol', 'Str0ngPass€'],
  ['a long password', 'Aa1!' + 'a'.repeat(60)],
]

for (const [label, value] of STRONG_PASSWORDS) {
  test(`password policy: ${label} is accepted`, () => {
    const f = passwordFixture()
    const app = mount(f.root)

    f.password.value = value
    const submit = app.fireDocument('submit', f.form)

    assert.equal(submit.defaultPrevented, false, 'a strong password must submit')
    assert.equal(f.error.style.display, 'none')
    assert.equal(f.password.classList.contains(INVALID), false)
  })
}

test('password policy: an empty field still reports required, not the pattern', () => {
  const f = passwordFixture()
  const app = mount(f.root)

  app.fireDocument('submit', f.form)

  assert.equal(f.error.textContent, 'Please fill out this field.')
})

test('password policy: the error clears the moment the password becomes strong', () => {
  const f = passwordFixture()
  const app = mount(f.root)

  f.password.value = 'password'
  app.fireDocument('submit', f.form)
  assert.equal(f.error.style.display, '')

  f.password.value = 'Aa1!aaaa'
  app.fire(f.form, 'input', f.password)

  assert.equal(f.error.style.display, 'none')
  assert.equal(f.password.classList.contains(INVALID), false)
})

test('password policy: a weak password never reaches an API-direct submit handler', () => {
  // The opp30 modal pattern, which is also how Memberstack surfaces behave when a
  // controller owns the click: no submit event is ever fired, so only the click
  // gate can stop the request.
  const f = passwordFixture()
  const app = mount(f.root)
  let apiCalls = 0
  f.submit.addEventListener('click', () => {
    apiCalls += 1
  })

  f.password.value = 'password'
  const click = app.fireDocument('click', f.submit)

  assert.equal(click.defaultPrevented, true)
  assert.equal(click.stopped, true, 'the click must be killed before the page controller sees it')
  assert.equal(apiCalls, 0)
})

test('password policy: a browser with no message override falls back to native text', () => {
  const f = passwordFixture({ 'wf-validate-message-pattern': undefined })
  f.password.removeAttribute('wf-validate-message-pattern')
  const app = mount(f.root)

  f.password.value = 'password'
  app.fireDocument('submit', f.form)

  assert.equal(f.error.textContent, 'Please match the requested format.')
})
