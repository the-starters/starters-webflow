const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'memberstack-loader.js'), 'utf8')

/** the real peer this component has to share a CTA with, loaded verbatim */
const pvSource = fs.readFileSync(
  path.join(__dirname, '..', 'password-validation', 'password-validation.js'),
  'utf8',
)

// ---------------------------------------------------------------------------
// Minimal DOM, grown from password-validation.test.js: attributes, classes,
// style.display, text nodes, a tiny selector engine (tag / [attr] / [attr="v"]
// / .class / comma groups), matches(), closest('form'), and a dispatcher with
// real capture-then-bubble ordering.
//
// Three additions this component needs, and their limits:
//
//   * `style.display` is a getter/setter pair. Writing it queues an attribute
//     mutation for `style`, which is how Memberstack's loader show/hide reaches
//     an observer. No other style property is observable.
//   * setAttribute / removeAttribute queue an attribute mutation for the
//     attribute they wrote. A `class` attribute also seeds classList (the
//     reverse is not wired: classList.add does not rewrite the attribute).
//   * MutationObserver shim: attributes only, honouring attributeFilter,
//     delivered batched per observer on a microtask. NO childList, NO subtree,
//     NO oldValue, NO characterData. A write is recorded even when it does not
//     change the value, exactly as the real thing does — which is why the
//     re-assert loop guard is tested here rather than only reasoned about.
//
// `flush()` awaits one macrotask turn so queued microtask deliveries have run.
// `observerCount(node)` reports how many live observers watch a node, the
// idempotence probe for repeated rescans.
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

/** live observers, so a write on any node can be routed to whoever watches it */
const observers = new Set()

function queueMutation(target, attributeName) {
  for (const observer of observers) observer.__queue(target, attributeName)
}

class MutationObserver {
  constructor(callback) {
    this.__callback = callback
    this.__targets = []
    this.__records = []
    this.__scheduled = false
    observers.add(this)
  }

  observe(node, options = {}) {
    if (!options.attributes) return
    this.__targets.push({ node, filter: options.attributeFilter || null })
  }

  disconnect() {
    this.__targets = []
    this.__records = []
    observers.delete(this)
  }

  takeRecords() {
    const records = this.__records
    this.__records = []
    return records
  }

  __watches(target, attributeName) {
    return this.__targets.some(
      (entry) =>
        entry.node === target && (!entry.filter || entry.filter.indexOf(attributeName) !== -1),
    )
  }

  __queue(target, attributeName) {
    if (!this.__watches(target, attributeName)) return
    this.__records.push({ type: 'attributes', attributeName, target })
    if (this.__scheduled) return
    this.__scheduled = true
    queueMicrotask(() => {
      this.__scheduled = false
      const records = this.takeRecords()
      if (records.length) this.__callback(records, this)
    })
  }
}

/** how many live observers watch `node` */
const observerCount = (node) =>
  [...observers].filter((observer) => observer.__targets.some((entry) => entry.node === node))
    .length

/** one macrotask turn, long enough for queued microtask deliveries */
const flush = () => new Promise((resolve) => setImmediate(resolve))

/** a real timer turn; outlives password-validation's setTimeout(render, 0) settle pass */
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

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
    this.value = ''
    this.disabled = undefined
    this._listeners = new Map()

    const classes = new Set()
    this._classes = classes
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    }

    // display is the only observable style property (see header)
    const styleValues = { display: '' }
    const node = this
    this.style = {
      get display() {
        return styleValues.display
      },
      set display(value) {
        styleValues.display = String(value)
        queueMutation(node, 'style')
      },
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
    if (name === 'class' && this._classes) {
      this._classes.clear()
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => this._classes.add(token))
    }
    queueMutation(this, name)
  }
  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }
  hasAttribute(name) {
    return this._attrs.has(name)
  }
  removeAttribute(name) {
    this._attrs.delete(name)
    if (name === 'class' && this._classes) this._classes.clear()
    queueMutation(this, name)
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
  /** in the document only while an ancestor chain reaches the mounted body */
  get isConnected() {
    for (let n = this; n; n = n.parentElement) if (n.tagName === 'BODY') return true
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

/** what `new Event(type, opts)` gives a script inside the VM */
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

/**
 * Run one or more scripts against a fake document whose body is `root`.
 * `sources` order is load order, which is also listener registration order.
 * @param {Element} root
 * @param {{loadTwice?: boolean, readyState?: string, hostname?: string,
 *          debug?: boolean, fetch?: Function, sources?: string[]}} [options]
 * @returns {{window: object, warnings: string[], root: Element, fireReady: () => void,
 *            firePageshow: (opts?: {persisted?: boolean}) => void}}
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
    querySelector: (selector) => root.querySelector(selector),
  }
  const location = { hostname: options.hostname || 'www.thestarters.com' }
  const windowListeners = new Map()
  const window = {
    location,
    addEventListener(type, listener) {
      const list = windowListeners.get(type) || []
      list.push(listener)
      windowListeners.set(type, list)
    },
  }
  if (options.debug !== undefined) window.STARTERS_DEBUG = options.debug
  if (options.fetch) window.fetch = options.fetch
  window.window = window

  const context = vm.createContext({
    window,
    document,
    location,
    MutationObserver,
    queueMicrotask,
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
  const sources = options.sources || [source]
  sources.forEach((src) => vm.runInContext(src, context))
  if (options.loadTwice) sources.forEach((src) => vm.runInContext(src, context))

  /** run the DOMContentLoaded handlers the script parked while the DOM parsed */
  const fireReady = () => {
    ;(documentListeners.get('DOMContentLoaded') || []).forEach((listener) => listener())
  }

  /** a back-button restore (persisted) or an ordinary fresh show */
  const firePageshow = (opts = {}) => {
    ;(windowListeners.get('pageshow') || []).forEach((listener) =>
      listener({ type: 'pageshow', persisted: !!opts.persisted }),
    )
  }

  return { window, warnings, root, fireReady, firePageshow }
}

// ---------------------------------------------------------------------------
// Fixtures — the real /sign-up form (fetched 2026-09-03 from staging) and the
// profile-shape button. SVG icon contents omitted.
// ---------------------------------------------------------------------------

const spinner = (attrs) =>
  h('div', attrs, [h('div', { class: 'button_spinner' })])

const P = 'starters-password-validation-'
const ALL_RULES = ['characters', 'special', 'capitalization', 'numbers']
const RULE_TEXT = {
  characters: 'At least {count} characters',
  special: 'One special character',
  capitalization: 'Upper and lower case',
  numbers: 'One number',
}

/** the password-validation checklist component, authored the documented way */
function passwordChecklist() {
  return h(
    'div',
    {
      [P + 'characters']: 'true',
      [P + 'special']: 'true',
      [P + 'capitalization']: 'true',
      [P + 'numbers']: 'true',
      [P + 'character-count']: '8',
    },
    ALL_RULES.map((name) =>
      h('div', { [P + 'rule']: name }, [
        h('div', { [P + 'icon']: 'valid' }),
        h('div', { [P + 'icon']: 'invalid' }),
        h('div', {}, [RULE_TEXT[name]]),
      ]),
    ),
  )
}

/** set a field the way a person does: value first, then the events */
function fill(input, value) {
  input.value = value
  dispatch(input, 'input')
  dispatch(input, 'change')
}

function check(input) {
  input.checked = true
  dispatch(input, 'change')
}

/**
 * @param {{kind?: string, theme?: string, ariaDisabled?: string, noLoader?: boolean,
 *          noSpinner?: boolean, checklist?: boolean}} [opts]
 */
function signupForm(opts = {}) {
  const kind = opts.kind === undefined ? 'signup' : opts.kind
  const theme = opts.theme === undefined ? 'black' : opts.theme

  const submitSpinnerAttrs = {
    'aria-hidden': 'true',
    'data-button-spinner': '',
    class: 'w-layout-vflex button_icon-spinner',
  }
  if (!opts.noLoader) submitSpinnerAttrs['data-ms-loader'] = ''
  const submitSpinner = spinner(submitSpinnerAttrs)

  const control = h('button', { type: 'button', class: 'clickable_btn' })
  if (opts.ariaDisabled !== undefined) control.setAttribute('aria-disabled', opts.ariaDisabled)

  const submitElement = h('div', { class: 'button_main-element' }, [
    h('div', { class: 'button_main-text' }, ['Sign up']),
    h('div', { class: 'button_main-line' }),
  ])
  if (!opts.noSpinner) submitElement.append(submitSpinner)

  const submitWrapAttrs = {
    'data-wf--button--style-button---size': 'default',
    'data-button-style': 'primary',
    'data-opp-element': 'loading-button',
    'data-opp-loading': 'false',
    'ms-code-submit-button': '',
    class: 'button_main-wrap',
  }
  if (theme !== null) submitWrapAttrs['data-button-theme'] = theme
  const submitWrap = h('div', submitWrapAttrs, [
    h('div', { type: '', class: 'clickable_wrap' }, [control]),
    submitElement,
  ])

  const linkSpinner = spinner({
    'data-button-spinner': '',
    'aria-hidden': 'true',
    class: 'w-layout-vflex button_icon-spinner',
  })
  const link = h('a', { 'aria-label': '', href: '/login', class: 'clickable_link w-inline-block' })
  const linkWrap = h(
    'div',
    {
      'data-wf--button--style-button---size': 'default',
      'data-button-theme': 'black',
      'data-button-style': 'secondary',
      'data-opp-element': 'loading-button',
      'data-opp-loading': 'false',
      class: 'button_main-wrap',
    },
    [
      h('div', { type: '', class: 'clickable_wrap' }, [link]),
      h('div', { class: 'button_main-element' }, [
        h('div', { class: 'button_main-text' }, ['Have an account? Sign in here']),
        h('div', { class: 'button_main-line' }),
        linkSpinner,
      ]),
    ],
  )

  const email = h('input', {
    class: 'form_input w-input',
    name: 'Work-Email',
    placeholder: 'Work Email',
    type: 'email',
    id: 'Work-Email',
    'data-ms-member': 'email',
    required: '',
  })
  const password = h('input', {
    class: 'form_input is-password w-input',
    name: 'Password',
    type: 'password',
    id: 'Password',
    'data-ms-member': 'password',
    required: '',
  })
  const termsVisual = h('div', {
    class: 'w-checkbox-input w-checkbox-input--inputType-custom auth-form_checkbox_icon',
  })
  const terms = h('input', {
    type: 'checkbox',
    name: 'Accept-legal',
    id: 'Accept-legal',
    required: '',
    'data-ms-member': 'terms-and-condition',
  })
  const checklist = opts.checklist ? passwordChecklist() : null

  const buttonGroup = h('div', { class: 'auth_form-button-group' }, [
    submitWrap,
    linkWrap,
    h('a', { 'data-ms-auth-provider': 'google', href: '#', class: 'button is-google w-button' }, [
      'Continue with Google',
    ]),
  ])

  const formChildren = [
    h('label', { for: 'Work-Email', class: 'form_label' }, ['Work Email']),
    email,
    h('label', { for: 'Password', class: 'form_label' }, ['Password']),
    h('div', { class: 'password-input_component' }, [
      h('div', { 'data-password-input': '', class: 'password-input_wrapper' }, [
        password,
        h('div', { id: 'passwordToggle', 'data-password-toggle': '', class: 'password-toggle' }, [
          h('div', { class: 'eye-icon show' }),
          h('div', { class: 'eye-icon visible' }),
        ]),
      ]),
    ]),
    h('div', { class: 'spacer-6' }),
    h('label', { class: 'w-checkbox auth-form_checkbox' }, [
      termsVisual,
      terms,
      h('span', { class: 'text-size-medium w-form-label', for: 'Accept-legal' }, [
        'I accept the Terms',
      ]),
    ]),
    h('div', { class: 'spacer-16' }),
  ]
  if (checklist) formChildren.push(checklist)
  formChildren.push(buttonGroup)

  const form = h(
    'form',
    {
      'data-ms-redirect': '/quiz',
      method: 'get',
      'data-ms-form': kind,
      name: 'wf-form-Brand-Signup',
      id: 'wf-form-Brand-Signup',
      class: 'auth_form-block',
      'data-turnstile-sitekey': '0x4AAAAAAAQTptj2So4dx43e',
    },
    formChildren,
  )

  return {
    form,
    submitWrap,
    submitElement,
    submitSpinner,
    control,
    linkWrap,
    linkSpinner,
    link,
    email,
    password,
    terms,
    termsVisual,
    checklist,
  }
}

/** profile/security shape: no marker, native submit inside the wrap */
function profileForm(opts = {}) {
  const theme = opts.theme === undefined ? 'black' : opts.theme
  const submitSpinnerAttrs = {
    'aria-hidden': 'true',
    'data-button-spinner': '',
    class: 'w-layout-vflex button_icon-spinner',
  }
  if (!opts.noLoader) submitSpinnerAttrs['data-ms-loader'] = ''
  const submitSpinner = spinner(submitSpinnerAttrs)
  const control = h('button', { type: 'submit', class: 'clickable_btn' })
  const wrap = h(
    'div',
    { 'data-button-theme': theme, 'data-button-style': 'primary', class: 'button_main-wrap' },
    [
      h('div', { class: 'clickable_wrap' }, [control]),
      h('div', { class: 'button_main-element' }, [
        h('div', { class: 'button_main-text' }, ['Save changes']),
        submitSpinner,
      ]),
    ],
  )
  const form = h('form', { 'data-ms-form': opts.kind || 'profile', class: 'auth_form-block' }, [
    wrap,
  ])
  return { form, wrap, control, submitSpinner }
}

/** reset shape: the marker rides a bare native submit, no wrap and no Spinner */
function resetForm() {
  const control = h('input', {
    type: 'submit',
    'ms-code-submit-button': '',
    value: 'Reset password',
    class: 'button w-button',
  })
  const form = h('form', { 'data-ms-form': 'reset-password', class: 'auth_form-block' }, [control])
  return { form, control }
}

/** reset shape without the marker: the /login page's bare native form */
function loginForm() {
  const control = h('input', {
    type: 'submit',
    'data-wait': 'Please wait...',
    value: 'Log in',
    class: 'button dark w-button',
  })
  const form = h('form', { 'data-ms-form': 'login', class: 'auth_form-block' }, [
    h('input', {
      class: 'form_input w-input',
      name: 'Work-Email',
      type: 'email',
      id: 'Work-Email',
      'data-ms-member': 'email',
      required: '',
    }),
    h('input', {
      class: 'form_input w-input',
      name: 'Password',
      type: 'password',
      id: 'Password',
      'data-ms-member': 'password',
      required: '',
    }),
    control,
  ])
  return { form, control }
}

/**
 * Memberstack stand-in: consumes the form's submit, then shows the loader. No
 * DOM event marks submit start or end, which is the whole reason the component
 * watches the loader instead.
 *
 * initLoader() caches `document.querySelector('[data-ms-loader]')` once at
 * page init and every show is `_showLoader(cached)`, so a marker moved later
 * changes nothing; only a page that authored none re-queries live and falls
 * back to the injected full-screen overlay. `opts.cache: false` models that
 * empty cache explicitly; by default the stand-in caches at construction, so
 * construct it after mount and before any submit.
 */
function memberstack(root, form, opts = {}) {
  const state = { submits: 0, overlayShows: 0, overlayRemovals: 0 }
  const live = () => root.querySelector('[data-ms-loader]')
  const cached = opts.cache === false ? null : live()
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    state.submits += 1
    if (cached) {
      cached.style.display = 'block'
      return
    }
    const el = live()
    if (el) el.style.display = 'block'
    else state.overlayShows += 1
  })
  return {
    cached,
    get submits() {
      return state.submits
    },
    get overlayShows() {
      return state.overlayShows
    },
    get overlayRemovals() {
      return state.overlayRemovals
    },
    submit: () => dispatch(form, 'submit'),
    hide: () => {
      const el = live()
      if (el) el.style.display = 'none'
      else state.overlayRemovals += 1
      if (cached) cached.style.display = 'none'
    },
  }
}

const body = (children) => h('body', {}, children)

/** every element currently carrying the Memberstack loader marker */
const loaders = (root) => root.querySelectorAll('[data-ms-loader]')

/** the page-level marker a hero section authors, which Memberstack pins */
const heroLoader = () => h('div', { id: 'hero', 'data-ms-loader': '' })

/** every attribute this component may write, read off one element */
const marksOf = (el) => ({
  theme: el.getAttribute('data-button-theme'),
  themeMark: el.getAttribute('data-memberstack-loader-theme'),
  busy: el.getAttribute('aria-busy'),
  busyMark: el.getAttribute('data-memberstack-loader-busy'),
  loading: el.getAttribute('data-ms-loading'),
  ariaDisabled: el.getAttribute('aria-disabled'),
  ariaMark: el.getAttribute('data-memberstack-loader-aria'),
})

/** an element this component has never written to */
const NO_MARKS = {
  theme: null,
  themeMark: null,
  busy: null,
  busyMark: null,
  loading: null,
  ariaDisabled: null,
  ariaMark: null,
}

/** a Button Wrap sitting at its authored theme, nothing else written */
const IDLE_WRAP = Object.assign({}, NO_MARKS, { theme: 'black' })

// Named, never defaulted: a warning assertion only means something when the
// host it was mounted on is the one that can produce warnings.
const STAGING = 'the-starters-3-0.webflow.io'
const PRODUCTION = 'www.thestarters.com'
const TAG = '[memberstack-loader]'

/** the one-request-at-a-time refusal, staging only */
const SUBMIT_REFUSED = 'submit refused'

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('sign-up button greys out and reads busy while the spinner runs', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()

  assert.equal(ms.submits, 1)
  assert.deepEqual(marksOf(f.submitWrap), {
    theme: 'disabled',
    themeMark: 'black',
    busy: 'true',
    busyMark: '',
    loading: 'true',
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(f.control.getAttribute('data-memberstack-loader-aria'), '')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a non-black authored theme is the one that comes back', async () => {
  const f = signupForm({ theme: 'primary' })
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-memberstack-loader-theme'), 'primary')
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  ms.hide()
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'primary')
})

test('hiding the spinner restores the button exactly as authored', async () => {
  const f = signupForm()
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  ms.hide()
  await flush()

  assert.deepEqual(marksOf(f.submitWrap), {
    theme: 'black',
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(f.control.getAttribute('aria-disabled'), null)
  assert.equal(f.control.getAttribute('data-memberstack-loader-aria'), null)
})

test('a wrap with no authored theme ends up with no theme attribute at all', async () => {
  const f = signupForm({ theme: null })
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(
    f.submitWrap.hasAttribute('data-memberstack-loader-theme'),
    false,
    'nothing was authored, so nothing is parked',
  )
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  ms.hide()
  await flush()
  assert.equal(f.submitWrap.hasAttribute('data-button-theme'), false)
  assert.equal(f.submitWrap.hasAttribute('data-memberstack-loader-theme'), false)
})

test('an authored empty theme comes back empty, not missing', async () => {
  const f = signupForm({ theme: '' })
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-memberstack-loader-theme'), '')
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  ms.hide()
  await flush()
  assert.equal(f.submitWrap.hasAttribute('data-button-theme'), true)
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), '')
  assert.equal(f.submitWrap.hasAttribute('data-memberstack-loader-theme'), false)
})

test("another script's hold on the button is never lifted", async () => {
  const f = signupForm({ ariaDisabled: 'true' })
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(f.control.hasAttribute('data-memberstack-loader-aria'), false)

  ms.hide()
  await flush()
  assert.equal(f.control.getAttribute('aria-disabled'), 'true', 'the foreign hold survives')
  assert.equal(f.control.hasAttribute('data-memberstack-loader-aria'), false)
})

test("a foreign aria-busy on the wrap survives the pending round trip", async () => {
  const f = signupForm()
  f.submitWrap.setAttribute('aria-busy', 'true')
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(f.submitWrap.hasAttribute('data-memberstack-loader-busy'), false)

  ms.hide()
  await flush()
  assert.equal(f.submitWrap.getAttribute('aria-busy'), 'true')
})

test("a non-auth Memberstack form's button is never dressed", async () => {
  const f = profileForm()
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(ms.submits, 1)
  assert.equal(f.submitSpinner.style.display, 'block', 'Memberstack still shows its loader')
  assert.deepEqual(marksOf(f.wrap), {
    theme: 'black',
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(f.control.getAttribute('aria-disabled'), null)
  // its own Spinner is the pinned loader here: watched once for its own hide,
  // once as the Anchor
  assert.equal(observerCount(f.submitSpinner), 2, 'watched only to see when the request ends')

  ms.hide()
  await flush()
  assert.equal(f.wrap.getAttribute('data-button-theme'), 'black')
  assert.equal(f.control.getAttribute('aria-disabled'), null)
})

test('the "Sign in here" link button next to the CTA is never the one watched', async () => {
  const f = signupForm()
  const root = body([f.form])
  mount(root)

  assert.equal(observerCount(f.submitSpinner), 1)
  assert.equal(observerCount(f.linkSpinner), 0)

  f.linkSpinner.style.display = 'block'
  await flush()
  assert.equal(f.linkWrap.getAttribute('data-button-theme'), 'black')
  assert.equal(f.linkWrap.hasAttribute('aria-busy'), false)
  assert.equal(f.link.hasAttribute('aria-disabled'), false)
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'black')
  assert.equal(f.control.hasAttribute('aria-disabled'), false)

  f.submitSpinner.style.display = 'block'
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.linkWrap.getAttribute('data-button-theme'), 'black', 'the link wrap stays put')
})

test('a form added after load starts working once the page asks for a rescan', async () => {
  const first = signupForm()
  const root = body([first.form])
  const app = mount(root)
  app.fireReady()

  const late = signupForm({ kind: 'login' })
  late.submitSpinner.removeAttribute('data-ms-loader')
  root.append(late.form)

  late.submitSpinner.style.display = 'block'
  await flush()
  assert.equal(late.submitWrap.getAttribute('data-button-theme'), 'black', 'not wired yet')

  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()
  assert.equal(observerCount(late.submitSpinner), 1, 'two rescans, one observer')

  late.submitSpinner.style.display = 'none'
  await flush()
  late.submitSpinner.style.display = 'block'
  await flush()
  assert.deepEqual(marksOf(late.submitWrap), {
    theme: 'disabled',
    themeMark: 'black',
    busy: 'true',
    busyMark: '',
    loading: 'true',
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(late.control.getAttribute('aria-disabled'), 'true')

  late.submitSpinner.style.display = 'none'
  await flush()
  assert.deepEqual(marksOf(late.submitWrap), {
    theme: 'black',
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(late.control.hasAttribute('aria-disabled'), false)
})

test('a spinner that arrives after wiring is picked up by the next rescan', async () => {
  const f = signupForm({ noSpinner: true })
  const root = body([f.form])
  const app = mount(root)

  assert.equal(observerCount(f.submitSpinner), 0)
  f.submitElement.append(f.submitSpinner)
  app.window.startersMemberstackLoader.rescan()
  assert.equal(observerCount(f.submitSpinner), 1)

  f.submitSpinner.style.display = 'block'
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
})

test('the release marker in the source is the one the page can read back', async () => {
  const declared = /@release\s+(v\d+\.\d+\.\d+)/.exec(source)
  assert.ok(declared, 'the source carries an @release header line')

  const f = signupForm()
  const root = body([f.form])
  const app = mount(root, { loadTwice: true })

  assert.equal(app.window.startersMemberstackLoader.release, declared[1])
  assert.equal(observerCount(f.submitSpinner), 1, 'a second load installs no second observer')

  app.window.startersMemberstackLoader.rescan()
  const ms = memberstack(root, f.form)
  ms.submit()
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
})

test('a page with no Memberstack form loads the script and touches nothing', async () => {
  const orphan = signupForm()
  const bare = h('div', { class: 'auth_form-button-group' }, [orphan.submitWrap])
  const root = body([bare])
  // production on purpose: the stray marker this page carries is a staging
  // warning of its own, covered by the diagnostics section below
  const app = mount(root, { hostname: PRODUCTION })

  assert.equal(typeof app.window.startersMemberstackLoader.rescan, 'function')
  app.window.startersMemberstackLoader.rescan()

  orphan.submitSpinner.style.display = 'block'
  await flush()
  assert.deepEqual(marksOf(orphan.submitWrap), {
    theme: 'black',
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(orphan.control.hasAttribute('aria-disabled'), false)
  assert.equal(app.warnings.length, 0)
})

test('the reset-password form, which has no spinner at all, is wired and inert', async () => {
  const f = resetForm()
  const root = body([f.form])
  // production on purpose: on staging this shape is warned about by name
  const app = mount(root, { hostname: PRODUCTION })

  const record = f.form.__startersMemberstackLoader
  assert.ok(record, 'the form carries the wired record')
  assert.equal(record.spinner, null)
  assert.equal(record.isAuth, true)

  app.window.startersMemberstackLoader.rescan()
  dispatch(f.form, 'submit')
  await flush()

  assert.deepEqual(marksOf(f.control), {
    theme: null,
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(app.warnings.length, 0)
})

/** a markerless Button Wrap whose only control is a <button> of the given type */
function bareButtonForm(type) {
  const submitSpinner = spinner({
    'aria-hidden': 'true',
    'data-button-spinner': '',
    'data-ms-loader': '',
    class: 'w-layout-vflex button_icon-spinner',
  })
  const attrs = { class: 'clickable_btn' }
  if (type !== undefined) attrs.type = type
  const control = h('button', attrs)
  const wrap = h(
    'div',
    { 'data-button-theme': 'black', 'data-button-style': 'primary', class: 'button_main-wrap' },
    [
      h('div', { class: 'clickable_wrap' }, [control]),
      h('div', { class: 'button_main-element' }, [
        h('div', { class: 'button_main-text' }, ['Log in']),
        submitSpinner,
      ]),
    ],
  )
  const form = h('form', { 'data-ms-form': 'login', class: 'auth_form-block' }, [wrap])
  return { form, wrap, control, submitSpinner }
}

test('a wrap whose button has no type at all is still the Button', async () => {
  const f = bareButtonForm()
  const root = body([f.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form)

  assert.equal(f.form.__startersMemberstackLoader.spinner, f.submitSpinner)

  ms.submit()
  await flush()
  assert.equal(f.wrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(app.warnings.length, 0)

  ms.hide()
  await flush()
  assert.deepEqual(marksOf(f.wrap), IDLE_WRAP)
  assert.deepEqual(marksOf(f.control), NO_MARKS)
})

test('a wrap holding only a type="button" control is not the Button', async () => {
  const f = bareButtonForm('button')
  const root = body([f.form])
  // production on purpose: on staging this shape is warned about by name
  const app = mount(root, { hostname: PRODUCTION })
  const ms = memberstack(root, f.form)

  assert.equal(f.form.__startersMemberstackLoader.spinner, null)

  ms.submit()
  await flush()
  assert.equal(f.submitSpinner.style.display, 'block', 'Memberstack still lights its own loader')
  assert.deepEqual(marksOf(f.wrap), IDLE_WRAP)
  assert.deepEqual(marksOf(f.control), NO_MARKS)
  assert.equal(app.warnings.length, 0)
})

test('a second submit after a failure greys the button again', async () => {
  const f = signupForm()
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  ms.hide()
  await flush()
  ms.submit()
  await flush()

  assert.equal(ms.submits, 2)
  assert.deepEqual(marksOf(f.submitWrap), {
    theme: 'disabled',
    themeMark: 'black',
    busy: 'true',
    busyMark: '',
    loading: 'true',
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(f.control.getAttribute('data-memberstack-loader-aria'), '')
})

test('a spinner shown twice with no hide between does not restack the marks', async () => {
  const f = signupForm()
  const root = body([f.form])
  mount(root)

  f.submitSpinner.style.display = 'block'
  await flush()
  f.submitWrap.setAttribute('data-memberstack-loader-theme', 'tampered')
  f.submitSpinner.style.display = 'flex'
  await flush()

  assert.equal(
    f.submitWrap.getAttribute('data-memberstack-loader-theme'),
    'tampered',
    'still pending, so nothing is re-stored',
  )
})

test('nothing is wired while the page is still parsing', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root, { readyState: 'loading' })

  assert.equal(observerCount(f.submitSpinner), 0)
  f.submitSpinner.style.display = 'block'
  await flush()
  f.submitSpinner.style.display = 'none'
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'black')
  assert.equal(f.control.hasAttribute('aria-disabled'), false)

  app.fireReady()
  assert.equal(observerCount(f.submitSpinner), 1)
  f.submitSpinner.style.display = 'block'
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
})

test('a browser with no MutationObserver still loads the script quietly', async () => {
  const f = signupForm()
  const root = body([f.form])
  const documentListeners = new Map()
  const warnings = []
  const window = { location: { hostname: STAGING } }
  window.window = window
  const context = vm.createContext({
    window,
    document: {
      readyState: 'complete',
      addEventListener: (type, listener) => {
        const list = documentListeners.get(type) || []
        list.push(listener)
        documentListeners.set(type, list)
      },
      querySelectorAll: (selector) => root.querySelectorAll(selector),
      querySelector: (selector) => root.querySelector(selector),
    },
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
  })
  vm.runInContext(source, context)

  window.startersMemberstackLoader.rescan()
  f.submitSpinner.style.display = 'block'
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'black')
  assert.equal(warnings.length, 0)
})

// ---------------------------------------------------------------------------
// Double-submit guard
// ---------------------------------------------------------------------------

test('a second submit while the button is busy never reaches Memberstack', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form)
  let watched = 0
  f.form.addEventListener('submit', () => {
    watched += 1
  })

  const first = ms.submit()
  await flush()
  assert.equal(ms.submits, 1)
  assert.equal(watched, 1, 'the first submit reaches every bubble listener')
  assert.equal(first.stopped, false)
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')

  const second = ms.submit()
  assert.equal(ms.submits, 1, 'Memberstack is asked once')
  assert.equal(watched, 1, 'and nothing downstream is asked twice either')
  assert.equal(second.defaultPrevented, true)
  assert.equal(second.stopped, true)
  assert.equal(app.warnings.length, 0)
})

test('once the spinner hides, the same button submits again', async () => {
  const f = signupForm()
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  ms.hide()
  await flush()
  assert.deepEqual(marksOf(f.submitWrap), {
    theme: 'black',
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })

  ms.submit()
  await flush()
  assert.equal(ms.submits, 2)
  assert.deepEqual(marksOf(f.submitWrap), {
    theme: 'disabled',
    themeMark: 'black',
    busy: 'true',
    busyMark: '',
    loading: 'true',
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
})

test('a non-auth form clicked again mid-request is refused too', async () => {
  const f = profileForm()
  const root = body([f.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  f.submitSpinner.style.display = 'block'
  await flush()
  ms.submit()
  await flush()
  ms.submit()
  await flush()

  assert.equal(ms.submits, 1, 'one request, however often the Save button is clicked')
  assert.deepEqual(marksOf(f.wrap), {
    theme: 'black',
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.deepEqual(marksOf(f.control), {
    theme: null,
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(app.warnings.length, 2, app.warnings.join(' | '))
})

test('the reset-password form, which shows no spinner, submits every time', async () => {
  const f = resetForm()
  const root = body([f.form])
  // production on purpose: on staging this shape is warned about by name
  const app = mount(root, { hostname: PRODUCTION })
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  ms.submit()
  await flush()
  ms.submit()
  await flush()

  assert.equal(ms.submits, 3)
  assert.deepEqual(marksOf(f.control), {
    theme: null,
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.deepEqual(loaders(root), [], 'a form with no Spinner carries no marker')
  assert.equal(ms.overlayShows, 3, 'Memberstack falls back to its own overlay every time')
  assert.equal(app.warnings.length, 0)
})

test('repeated rescans never stack a second guard on the same form', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root)

  const wired = f.form.listenerCount('submit')
  assert.equal(wired, 1, 'one guard after the first wiring')

  const ms = memberstack(root, f.form)
  const withStandIn = f.form.listenerCount('submit')
  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()
  assert.equal(f.form.listenerCount('submit'), withStandIn)

  ms.submit()
  await flush()
  assert.equal(ms.submits, 1)
  ms.submit()
  assert.equal(ms.submits, 1)
})

// ---------------------------------------------------------------------------
// Re-assertion while the spinner runs
// ---------------------------------------------------------------------------

test('another script stripping the busy look mid-submit gets it put straight back', async () => {
  const f = signupForm()
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()

  f.control.removeAttribute('aria-disabled')
  await flush()
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(f.control.getAttribute('data-memberstack-loader-aria'), '')

  f.submitWrap.setAttribute('data-button-theme', 'black')
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  f.submitWrap.removeAttribute('aria-busy')
  await flush()
  assert.equal(f.submitWrap.getAttribute('aria-busy'), 'true')
  assert.equal(f.submitWrap.getAttribute('data-memberstack-loader-busy'), '')

  f.submitWrap.removeAttribute('data-ms-loading')
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-ms-loading'), 'true')

  f.control.setAttribute('aria-disabled', 'false')
  await flush()
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')

  ms.hide()
  await flush()
  assert.deepEqual(marksOf(f.submitWrap), {
    theme: 'black',
    themeMark: null,
    busy: null,
    busyMark: null,
    loading: null,
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(f.control.hasAttribute('aria-disabled'), false)
  assert.equal(f.control.hasAttribute('data-memberstack-loader-aria'), false)

  f.submitWrap.setAttribute('data-button-theme', 'primary')
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'primary', 'no longer defended')

  f.control.setAttribute('aria-disabled', 'true')
  await flush()
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(f.control.hasAttribute('data-memberstack-loader-aria'), false)
})

test("a foreign hold stripped mid-submit becomes ours, and leaves with us", async () => {
  const f = signupForm({ ariaDisabled: 'true' })
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(f.control.hasAttribute('data-memberstack-loader-aria'), false, 'not ours yet')

  f.control.removeAttribute('aria-disabled')
  await flush()
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(f.control.getAttribute('data-memberstack-loader-aria'), '')

  ms.hide()
  await flush()
  assert.equal(f.control.hasAttribute('aria-disabled'), false, 'the state the peer left')
  assert.equal(f.control.hasAttribute('data-memberstack-loader-aria'), false)
})

test("a foreign aria-busy stripped mid-submit becomes ours, and leaves with us", async () => {
  const f = signupForm()
  f.submitWrap.setAttribute('aria-busy', 'true')
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  assert.equal(f.submitWrap.hasAttribute('data-memberstack-loader-busy'), false, 'not ours yet')

  f.submitWrap.removeAttribute('aria-busy')
  await flush()
  assert.equal(f.submitWrap.getAttribute('aria-busy'), 'true')
  assert.equal(f.submitWrap.getAttribute('data-memberstack-loader-busy'), '')

  ms.hide()
  await flush()
  assert.equal(f.submitWrap.hasAttribute('aria-busy'), false, 'the state the peer left')
  assert.equal(f.submitWrap.hasAttribute('data-memberstack-loader-busy'), false)
})

test('re-asserting the busy look settles instead of looping', async () => {
  const f = signupForm()
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  await flush()
  f.control.removeAttribute('aria-disabled')
  await flush()

  const wrapBefore = marksOf(f.submitWrap)
  const controlBefore = marksOf(f.control)
  const wrapObservers = observerCount(f.submitWrap)
  const controlObservers = observerCount(f.control)

  await flush()
  await flush()

  assert.deepEqual(marksOf(f.submitWrap), wrapBefore)
  assert.deepEqual(marksOf(f.control), controlBefore)
  assert.equal(observerCount(f.submitWrap), wrapObservers)
  assert.equal(observerCount(f.control), controlObservers)
  assert.equal(wrapObservers, 1)
  assert.equal(controlObservers, 1)
})

test('a non-auth form is watched at its Spinner and nowhere else', async () => {
  const f = profileForm()
  const root = body([f.form])
  const app = mount(root)
  app.window.startersMemberstackLoader.rescan()

  assert.equal(observerCount(f.wrap), 0)
  assert.equal(observerCount(f.control), 0)
  assert.equal(observerCount(f.submitSpinner), 1, 'one watcher, and a rescan adds no more')
})

test('a button wired by a later rescan is defended just like the rest', async () => {
  const f = signupForm({ noSpinner: true })
  const root = body([f.form])
  const app = mount(root)

  assert.equal(observerCount(f.submitWrap), 0)
  f.submitElement.append(f.submitSpinner)
  app.window.startersMemberstackLoader.rescan()
  assert.equal(observerCount(f.submitWrap), 1)
  assert.equal(observerCount(f.control), 1)

  const ms = memberstack(root, f.form)
  ms.submit()
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  f.submitWrap.removeAttribute('data-ms-loading')
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-ms-loading'), 'true')

  ms.submit()
  assert.equal(ms.submits, 1)
})

// ---------------------------------------------------------------------------
// Alongside the real password-validation.js
// ---------------------------------------------------------------------------

const REFUSED = "click refused by another script's disabled state on the CTA"

/**
 * A page carrying both scripts, in the given load order, plus the Webflow
 * fail block password-validation reaches for.
 * `orphan` adds a checklist row outside every wrapper, which is a page-level
 * password-validation warning: it re-prints on each rescan and stays put on a
 * per-form regate.
 * @param {{form?: object, loaderFirst?: boolean, hostname?: string, orphan?: boolean}} [opts]
 */
function pvWorld(opts = {}) {
  const f = signupForm(opts.form || {})
  const fail = h('div', { class: 'w-form-fail' }, [h('div', {}, [''])])
  const kids = [h('div', { class: 'w-form' }, [f.form, fail])]
  if (opts.orphan) kids.push(h('div', { 'starters-password-validation-rule': 'numbers' }))
  const root = body(kids)
  const app = mount(root, {
    sources: opts.loaderFirst ? [source, pvSource] : [pvSource, source],
    hostname: opts.hostname || 'the-starters-3-0.webflow.io',
  })
  const ms = memberstack(root, f.form)
  return Object.assign({ root, fail, ms }, f, app)
}

test('with password-validation loaded first, a repeat click is refused, not double-submitted', async () => {
  const w = pvWorld()

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1)
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(w.control.getAttribute('aria-disabled'), 'true')
  assert.equal(w.control.getAttribute('data-memberstack-loader-aria'), '')

  const before = w.warnings.length
  dispatch(w.control, 'click')
  assert.equal(w.ms.submits, 1)
  const fresh = w.warnings.slice(before)
  assert.equal(fresh.length, 1, fresh.join(' | '))
  assert.ok(fresh[0].includes(REFUSED), fresh[0])

  w.ms.hide()
  await flush()
  assert.equal(w.control.hasAttribute('aria-disabled'), false)
  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 2)
})

test('with the loader script first, the pair behaves identically', async () => {
  const w = pvWorld({ loaderFirst: true })

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1)
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(w.control.getAttribute('aria-disabled'), 'true')
  assert.equal(w.control.getAttribute('data-memberstack-loader-aria'), '')

  const before = w.warnings.length
  dispatch(w.control, 'click')
  assert.equal(w.ms.submits, 1)
  const fresh = w.warnings.slice(before)
  assert.equal(fresh.length, 1, fresh.join(' | '))
  assert.ok(fresh[0].includes(REFUSED), fresh[0])

  w.ms.hide()
  await flush()
  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 2)
})

test('on production the refused repeat click says nothing in the console', async () => {
  const w = pvWorld({ hostname: 'www.thestarters.com' })

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1)
  dispatch(w.control, 'click')
  assert.equal(w.ms.submits, 1)
  assert.equal(w.warnings.length, 0)
})

test('pressing Enter during a Memberstack submit is swallowed with password-validation loaded', async (t) => {
  const w = pvWorld()

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1)

  // password-validation's capture listener clears this block when it runs
  w.fail.style.display = 'block'
  const event = dispatch(w.form, 'submit')

  assert.equal(w.ms.submits, 1)
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.stopped, true)
  const pvFirst = w.fail.style.display === 'none'
  t.diagnostic(
    'sources password-validation then loader: password-validation capture listener ran ' +
      (pvFirst ? 'BEFORE' : 'AFTER') +
      ' this script',
  )
})

test('the checklist gate and the busy button hand the same CTA back and forth', async (t) => {
  const w = pvWorld({ form: { checklist: true } })

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 0, 'the gate is closed')
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(w.control.getAttribute('aria-disabled'), 'true')
  assert.equal(w.control.getAttribute('data-password-validation-aria'), '')

  fill(w.email, 'brand@example.com')
  fill(w.password, 'Passw0rd!')
  check(w.terms)
  await tick()
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'black')
  assert.equal(w.control.hasAttribute('aria-disabled'), false)

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1)
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(w.control.getAttribute('aria-disabled'), 'true')
  assert.equal(w.control.getAttribute('data-memberstack-loader-aria'), '')
  assert.equal(w.control.hasAttribute('data-password-validation-aria'), false)

  dispatch(w.email, 'focusout')
  await flush()
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(w.control.getAttribute('data-memberstack-loader-aria'), '')
  assert.equal(w.submitWrap.getAttribute('aria-busy'), 'true')
  t.diagnostic(
    'password-validation render mid-submit leaves wrap class `disabled`: ' +
      w.submitWrap.classList.contains('disabled'),
  )

  const before = w.warnings.length
  dispatch(w.control, 'click')
  assert.equal(w.ms.submits, 1)
  const fresh = w.warnings.slice(before)
  assert.equal(fresh.length, 1, fresh.join(' | '))
  assert.ok(fresh[0].includes(REFUSED), fresh[0])

  w.ms.hide()
  await flush()
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'black')
  assert.equal(w.control.hasAttribute('aria-disabled'), false)
  assert.equal(w.control.hasAttribute('data-memberstack-loader-aria'), false)
  const classAfterHide = w.submitWrap.classList.contains('disabled')
  t.diagnostic('after hide, wrap class `disabled` is present: ' + classAfterHide)
  assert.equal(classAfterHide, false, 'the release hands the CTA back and the class clears at once')

  dispatch(w.email, 'input')
  await flush()
  assert.equal(w.submitWrap.classList.contains('disabled'), false)
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'black')

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 2)
})

test('an unfilled checklist form blocks Enter and neither script dresses the button', async () => {
  const w = pvWorld({ form: { checklist: true } })

  const event = dispatch(w.form, 'submit')
  await flush()

  assert.equal(w.ms.submits, 0)
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.stopped, true)
  assert.equal(w.submitSpinner.style.display, '')
  assert.equal(w.submitWrap.hasAttribute('data-memberstack-loader-theme'), false)
  assert.equal(w.submitWrap.hasAttribute('aria-busy'), false)
  assert.equal(w.submitWrap.hasAttribute('data-ms-loading'), false)
  assert.equal(w.control.hasAttribute('data-memberstack-loader-aria'), false)
})

test('a gate closed while the button spins is still closed after the spinner stops', async () => {
  const w = pvWorld({ form: { checklist: true } })

  fill(w.email, 'brand@example.com')
  fill(w.password, 'Passw0rd!')
  check(w.terms)
  await tick()
  assert.equal(w.control.hasAttribute('aria-disabled'), false, 'the gate opened')

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1)
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(w.control.getAttribute('data-memberstack-loader-aria'), '')

  // the person edits the password back to something invalid while it spins
  w.password.value = 'short'
  dispatch(w.password, 'input')
  await tick()

  w.ms.hide()
  await flush()
  await tick()

  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled', 'the CTA still reads shut')
  assert.equal(w.control.getAttribute('aria-disabled'), 'true')
  assert.equal(w.control.getAttribute('data-password-validation-aria'), '')
  assert.equal(w.control.disabled, true, 'the native control stays refused')
  assert.equal(w.control.hasAttribute('disabled'), true)
  assert.equal(w.control.getAttribute('data-password-validation-native'), '')

  assert.equal(w.submitWrap.hasAttribute('data-memberstack-loader-theme'), false)
  assert.equal(w.submitWrap.hasAttribute('data-memberstack-loader-busy'), false)
  assert.equal(w.submitWrap.hasAttribute('aria-busy'), false)
  assert.equal(w.submitWrap.hasAttribute('data-ms-loading'), false)
  assert.equal(w.control.hasAttribute('data-memberstack-loader-aria'), false)

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1, 'a shut CTA does not submit')
})

test('a password fixed while the button spins leaves a live CTA behind', async () => {
  const w = pvWorld({ form: { checklist: true } })

  fill(w.email, 'brand@example.com')
  fill(w.password, 'Passw0rd!')
  check(w.terms)
  await tick()

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 1)

  w.password.value = 'short'
  dispatch(w.password, 'input')
  await tick()
  fill(w.password, 'Passw0rd!')
  await tick()

  w.ms.hide()
  await flush()
  await tick()

  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'black')
  assert.equal(w.control.hasAttribute('aria-disabled'), false)
  assert.equal(w.control.disabled, false, 'the native control is handed back')
  assert.equal(w.control.hasAttribute('disabled'), false)
  assert.equal(w.control.hasAttribute('data-password-validation-native'), false)

  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 2)
})

test('the release hands one form back, not the whole page', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root)
  const ms = memberstack(root, f.form)

  const calls = []
  app.window.startersPasswordValidation = {
    regate: (form) => {
      calls.push({ name: 'regate', form })
      return true
    },
    rescan: () => calls.push({ name: 'rescan', form: null }),
  }

  ms.submit()
  await flush()
  assert.deepEqual(calls, [], 'nothing is handed back while it spins')

  ms.hide()
  await flush()
  assert.deepEqual(
    calls.map((call) => call.name),
    ['regate'],
  )
  assert.equal(calls[0].form, f.form, 'and it names the form that was released')
})

test('a password-validation that declines the hand-back still gets a rescan', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root)
  const ms = memberstack(root, f.form)

  const calls = []
  app.window.startersPasswordValidation = {
    regate: () => {
      calls.push('regate')
      return false
    },
    rescan: function () {
      calls.push('rescan:' + arguments.length)
    },
  }

  ms.submit()
  await flush()
  ms.hide()
  await flush()
  assert.deepEqual(calls, ['regate', 'rescan:0'], 'a form it never bridged falls back')
})

test('a password-validation too old to regate still gets a rescan', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root)
  const ms = memberstack(root, f.form)

  const calls = []
  app.window.startersPasswordValidation = { rescan: () => calls.push('rescan') }

  ms.submit()
  await flush()
  ms.hide()
  await flush()
  assert.deepEqual(calls, ['rescan'])
})

test('handing the CTA back never re-prints a page-level checklist warning', async () => {
  const w = pvWorld({ form: { checklist: true }, orphan: true })
  const orphans = () => w.warnings.filter((line) => line.includes('sit outside any wrapper')).length

  assert.equal(orphans(), 1, w.warnings.join(' | '))

  fill(w.email, 'brand@example.com')
  fill(w.password, 'Passw0rd!')
  check(w.terms)
  await tick()

  for (let round = 0; round < 2; round++) {
    dispatch(w.control, 'click')
    await flush()
    w.ms.hide()
    await flush()
    await tick()
  }

  assert.equal(w.ms.submits, 2, 'both submit/hide cycles really ran')
  assert.equal(orphans(), 1, w.warnings.join(' | '))
})

// ---------------------------------------------------------------------------
// The loader follows the submitting form
//
// MIRROR mode: the page authored a [data-ms-loader], so Memberstack pinned it
// and the marker can never move. MOVE mode: it authored none, so every
// show/hide re-queries live and the marker can be placed at submit time.
// ---------------------------------------------------------------------------

/** the homepage shape: the signup modal's loader above an account form */
function anchoredPage() {
  const s = signupForm()
  const p = profileForm({ noLoader: true })
  return { s, p, root: body([s.form, p.form]) }
}

/** the account-page shape: profile form and signup form, neither anchored */
function unanchoredPage() {
  const s = signupForm({ noLoader: true })
  const p = profileForm({ noLoader: true })
  return { s, p, root: body([s.form, p.form]) }
}

test('saving a profile spins the Save button, not the closed signup modal', async () => {
  const { s, p, root } = anchoredPage()
  const app = mount(root, { hostname: STAGING })
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  profile.submit()
  assert.equal(profile.submits, 1)
  assert.equal(signup.submits, 0)
  assert.equal(profile.overlayShows, 0)
  await flush()

  assert.equal(p.submitSpinner.style.display, 'block', 'the Save button spins')
  assert.equal(s.submitSpinner.style.display, 'block', 'Memberstack still lights the pinned one')
  assert.deepEqual(loaders(root), [s.submitSpinner], 'the marker never moves')
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP, 'the closed modal is not greyed out')
  assert.deepEqual(marksOf(s.control), NO_MARKS)
  assert.deepEqual(marksOf(p.wrap), IDLE_WRAP)
  assert.deepEqual(marksOf(p.control), NO_MARKS)

  profile.hide()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'none')
  assert.equal(s.submitSpinner.style.display, 'none')
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
  assert.deepEqual(marksOf(p.wrap), IDLE_WRAP)
  assert.equal(app.warnings.length, 0)
})

test('the signup button on that same page still greys out for its own submit', async () => {
  const { s, p, root } = anchoredPage()
  mount(root)
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  profile.submit()
  await flush()
  profile.hide()
  await flush()

  signup.submit()
  await flush()
  assert.deepEqual(marksOf(s.submitWrap), {
    theme: 'disabled',
    themeMark: 'black',
    busy: 'true',
    busyMark: '',
    loading: 'true',
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(s.control.getAttribute('aria-disabled'), 'true')
  assert.equal(p.submitSpinner.style.display, 'none', 'the Save button is not dragged along')

  signup.hide()
  await flush()
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
  assert.equal(s.control.hasAttribute('aria-disabled'), false)

  profile.submit()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'block')
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
})

test('the pinned loader is watched from the first submit, and watched once', async () => {
  const { s, p, root } = anchoredPage()
  mount(root)
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  assert.equal(observerCount(s.submitSpinner), 1, 'its own form watches it')

  signup.submit()
  await flush()
  assert.equal(observerCount(s.submitSpinner), 2, 'the mirror watches it from the first submit')
  signup.hide()
  await flush()

  profile.submit()
  await flush()
  assert.equal(observerCount(s.submitSpinner), 2)
  profile.hide()
  await flush()

  profile.submit()
  await flush()
  assert.equal(observerCount(s.submitSpinner), 2, 'the mirror is installed once')

  assert.equal(observerCount(p.submitSpinner), 1, 'the Save button is watched for its own hide')
  assert.equal(observerCount(p.wrap), 0)
  assert.equal(observerCount(p.control), 0)
})

test('a second form submitting mid-flight is refused until the first spin ends', async () => {
  const { s, p, root } = anchoredPage()
  mount(root)
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  profile.submit()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'block')

  signup.submit()
  await flush()
  assert.equal(signup.submits, 0, 'Memberstack is never asked for a second request')
  assert.equal(p.submitSpinner.style.display, 'block', 'the Save button keeps its spin')
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP, 'and the signup button is untouched')

  profile.hide()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'none')

  signup.submit()
  await flush()
  assert.equal(signup.submits, 1)
  assert.equal(s.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(s.control.getAttribute('aria-disabled'), 'true')
})

test('a loader shown by no submit at all still dresses its own button', async () => {
  const { s, p, root } = anchoredPage()
  mount(root)
  memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  profile.submit()
  await flush()
  profile.hide()
  await flush()

  s.submitSpinner.style.display = 'block'
  await flush()
  assert.equal(p.submitSpinner.style.display, 'none', 'no submit asked for a mirror')
  assert.equal(s.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(s.control.getAttribute('aria-disabled'), 'true')

  s.submitSpinner.style.display = 'none'
  await flush()
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
  assert.equal(s.control.hasAttribute('aria-disabled'), false)
})

test('a native login form on an anchored page leaves every button alone', async () => {
  const s = signupForm()
  const l = loginForm()
  const root = body([s.form, l.form])
  // production on purpose: on staging the login form is warned about by name
  const app = mount(root, { hostname: PRODUCTION })
  const login = memberstack(root, l.form)

  login.submit()
  await flush()

  assert.equal(login.submits, 1)
  assert.equal(login.overlayShows, 0, 'the pin lights the signup spinner instead')
  assert.deepEqual(loaders(root), [s.submitSpinner], 'the marker is not taken away')
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
  assert.deepEqual(marksOf(l.control), NO_MARKS)
  assert.equal(l.form.hasAttribute('data-ms-loading'), false)
  assert.equal(app.warnings.length, 0)
})

test('a mirrored spin settles instead of flickering', async () => {
  const { s, p, root } = anchoredPage()
  mount(root)
  memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  const snapshot = () => [
    s.submitSpinner.style.display,
    p.submitSpinner.style.display,
    marksOf(s.submitWrap),
    marksOf(p.wrap),
  ]

  profile.submit()
  await flush()
  const shown = snapshot()
  await flush()
  await flush()
  assert.deepEqual(snapshot(), shown)

  profile.hide()
  await flush()
  const hidden = snapshot()
  await flush()
  await flush()
  assert.deepEqual(snapshot(), hidden)
})

test('removing the authored loader later does not start moving the marker', async () => {
  const { s, p, root } = anchoredPage()
  const app = mount(root)
  const profile = memberstack(root, p.form)

  s.submitSpinner.removeAttribute('data-ms-loader')
  app.window.startersMemberstackLoader.rescan()

  profile.submit()
  await flush()
  assert.deepEqual(loaders(root), [], 'the marker is never authored by this script')
  assert.equal(profile.overlayShows, 0, 'Memberstack still uses what it cached')
  assert.equal(p.submitSpinner.style.display, 'block')
})

test('with no authored loader the profile save spins its own button', async () => {
  const { s, p, root } = unanchoredPage()
  const app = mount(root, { hostname: STAGING })
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  let atBubble = null
  p.form.addEventListener('submit', () => {
    atBubble = loaders(root)
  })

  profile.submit()
  assert.deepEqual(atBubble, [p.submitSpinner], 'placed before Memberstack looks for it')
  await flush()

  assert.equal(signup.submits, 0)
  assert.equal(profile.overlayShows, 0, 'no full-screen overlay')
  assert.equal(p.submitSpinner.style.display, 'block')
  assert.equal(s.submitSpinner.style.display, '')
  assert.equal(s.submitSpinner.hasAttribute('data-ms-loader'), false)
  assert.deepEqual(marksOf(p.wrap), IDLE_WRAP)
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)

  profile.hide()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'none')
  assert.equal(app.warnings.length, 0)
})

test('the marker follows whichever form was submitted last', async () => {
  const { s, p, root } = unanchoredPage()
  mount(root)
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  profile.submit()
  await flush()
  profile.hide()
  await flush()

  signup.submit()
  assert.deepEqual(loaders(root), [s.submitSpinner], 'the marker moved to the signup form')
  assert.equal(p.submitSpinner.hasAttribute('data-ms-loader'), false)
  await flush()
  assert.equal(s.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(s.control.getAttribute('aria-disabled'), 'true')
  assert.equal(p.submitSpinner.style.display, 'none')

  signup.submit()
  assert.equal(signup.submits, 1, 'the repeat submit is swallowed')
  assert.deepEqual(loaders(root), [s.submitSpinner], 'and it re-routes nothing')

  signup.hide()
  await flush()
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)

  profile.submit()
  assert.deepEqual(loaders(root), [p.submitSpinner], 'and back again')
  await flush()
  assert.equal(p.submitSpinner.style.display, 'block')
})

test('a second form submitting mid-flight is refused, and the first keeps its guard', async () => {
  const a = signupForm({ noLoader: true })
  const b = signupForm({ kind: 'login', noLoader: true })
  const root = body([a.form, b.form])
  const app = mount(root, { hostname: STAGING })
  const msA = memberstack(root, a.form, { cache: false })
  const msB = memberstack(root, b.form, { cache: false })

  msA.submit()
  await flush()
  assert.equal(a.submitSpinner.style.display, 'block')
  assert.deepEqual(loaders(root), [a.submitSpinner])
  assert.equal(a.submitWrap.getAttribute('data-button-theme'), 'disabled')

  msB.submit()
  await flush()

  assert.equal(msB.submits, 0, 'the second form never reaches Memberstack')
  assert.deepEqual(loaders(root), [a.submitSpinner], 'and the marker does not move')
  assert.equal(a.submitSpinner.style.display, 'block')
  assert.equal(a.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(a.control.getAttribute('aria-disabled'), 'true')
  assert.deepEqual(marksOf(b.submitWrap), IDLE_WRAP)
  assert.deepEqual(marksOf(b.control), NO_MARKS)

  msA.submit()
  assert.equal(msA.submits, 1, 'and the first form is still guarding its own submit')

  msA.hide()
  await flush()
  assert.deepEqual(marksOf(a.submitWrap), IDLE_WRAP)

  msB.submit()
  await flush()
  assert.equal(msB.submits, 1)
  assert.deepEqual(loaders(root), [b.submitSpinner], 'now the marker moves')
  assert.equal(a.submitSpinner.hasAttribute('data-ms-loader'), false)
  assert.equal(a.submitSpinner.style.display, 'none')

  msB.hide()
  await flush()

  msA.submit()
  await flush()
  assert.equal(msA.submits, 2)

  const refusals = app.warnings.filter((line) => line.includes(SUBMIT_REFUSED))
  assert.equal(refusals.length, 1, app.warnings.join(' | '))
  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
})

test('a native login form with nowhere to spin falls back to the overlay', async () => {
  const p = profileForm({ noLoader: true })
  const l = loginForm()
  const root = body([p.form, l.form])
  // production on purpose: on staging the login form is warned about by name
  const app = mount(root, { hostname: PRODUCTION })
  const profile = memberstack(root, p.form)
  const login = memberstack(root, l.form)

  profile.submit()
  await flush()
  assert.deepEqual(loaders(root), [p.submitSpinner])
  assert.equal(p.submitSpinner.style.display, 'block')

  login.submit()
  await flush()
  assert.equal(login.submits, 0, 'the Spinner-less form waits its turn too')
  assert.equal(login.overlayShows, 0, 'so no overlay is raised over a live spin')
  assert.deepEqual(loaders(root), [p.submitSpinner], 'the marker stays with the open request')
  assert.equal(p.submitSpinner.style.display, 'block')

  profile.hide()
  await flush()

  login.submit()
  await flush()
  assert.equal(login.overlayShows, 1, 'Memberstack shows its own full-screen overlay')
  assert.deepEqual(loaders(root), [], 'the unlit marker it left behind is swept')
  assert.equal(p.submitSpinner.style.display, 'none')
  assert.deepEqual(marksOf(l.control), NO_MARKS)

  login.hide()
  assert.equal(login.overlayRemovals, 1)
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('with no authored loader, a save in flight refuses the signup form', async () => {
  const s = signupForm({ noLoader: true })
  const p = profileForm({ noLoader: true })
  const root = body([p.form, s.form])
  mount(root)
  const profile = memberstack(root, p.form, { cache: false })
  const signup = memberstack(root, s.form, { cache: false })

  profile.submit()
  await flush()
  assert.deepEqual(loaders(root), [p.submitSpinner])
  assert.equal(p.submitSpinner.style.display, 'block')

  signup.submit()
  await flush()
  assert.equal(signup.submits, 0)
  assert.deepEqual(loaders(root), [p.submitSpinner], 'the marker stays where the request is')
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
  assert.deepEqual(marksOf(s.control), NO_MARKS)

  profile.hide()
  await flush()

  signup.submit()
  await flush()
  assert.equal(signup.submits, 1)
  assert.deepEqual(loaders(root), [s.submitSpinner], 'now it moves')
  assert.equal(s.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(s.control.getAttribute('aria-disabled'), 'true')
})

test('a re-submit after a hide cannot be released by a rival request', async () => {
  const a = signupForm({ noLoader: true })
  const b = signupForm({ kind: 'login', noLoader: true })
  const root = body([a.form, b.form])
  mount(root)
  const msA = memberstack(root, a.form, { cache: false })
  const msB = memberstack(root, b.form, { cache: false })

  msA.submit()
  await flush()
  msB.submit()
  await flush()
  assert.equal(msB.submits, 0, 'no rival request is ever opened')

  msA.hide()
  await flush()
  msA.submit()
  await flush()
  assert.equal(msA.submits, 2)
  assert.equal(a.submitWrap.getAttribute('data-button-theme'), 'disabled')

  // nothing is in flight but A's own second request, so nothing can end it early
  msA.submit()
  await flush()
  assert.equal(msA.submits, 2, 'the repeat is swallowed, not passed on')
  assert.equal(a.submitSpinner.style.display, 'block', 'and A is still pending')
  assert.equal(a.control.getAttribute('aria-disabled'), 'true')
})

test('the form that owns the pinned loader waits for a mirrored spin too', async () => {
  const { s, p, root } = anchoredPage()
  const app = mount(root, { hostname: STAGING })
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  profile.submit()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'block', 'the Save button holds the mirrored spin')

  signup.submit()
  await flush()
  assert.equal(signup.submits, 0)
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)

  profile.hide()
  await flush()

  signup.submit()
  await flush()
  assert.equal(signup.submits, 1)
  assert.deepEqual(marksOf(s.submitWrap), {
    theme: 'disabled',
    themeMark: 'black',
    busy: 'true',
    busyMark: '',
    loading: 'true',
    ariaDisabled: null,
    ariaMark: null,
  })
  assert.equal(s.control.getAttribute('aria-disabled'), 'true')
  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
  assert.ok(app.warnings[0].includes(SUBMIT_REFUSED), app.warnings[0])
})

test('clicking Save twice opens one Memberstack request, not two', async () => {
  const moved = profileForm({ noLoader: true })
  const movedRoot = body([moved.form])
  const moveApp = mount(movedRoot, { hostname: STAGING })
  const move = memberstack(movedRoot, moved.form, { cache: false })

  move.submit()
  await flush()
  move.submit()
  await flush()
  assert.equal(move.submits, 1, 'MOVE mode: the second click is refused')
  assert.equal(moveApp.warnings.length, 1, moveApp.warnings.join(' | '))
  assert.ok(moveApp.warnings[0].includes(SUBMIT_REFUSED), moveApp.warnings[0])
  assert.ok(moveApp.warnings[0].includes('form.auth_form-block'), moveApp.warnings[0])

  const pinned = profileForm()
  const pinnedRoot = body([pinned.form])
  const pinnedApp = mount(pinnedRoot, { hostname: STAGING })
  const pin = memberstack(pinnedRoot, pinned.form)

  pin.submit()
  await flush()
  pin.submit()
  await flush()
  assert.equal(pin.submits, 1, 'MIRROR mode: so is a second click into the pinned loader')
  assert.equal(pinnedApp.warnings.length, 1, pinnedApp.warnings.join(' | '))
  assert.ok(pinnedApp.warnings[0].includes(SUBMIT_REFUSED), pinnedApp.warnings[0])
})

test('the refused submit is named, and the open request is left alone', async () => {
  const move = unanchoredPage()
  const moveApp = mount(move.root, { hostname: STAGING })
  const moveProfile = memberstack(move.root, move.p.form, { cache: false })
  const moveSignup = memberstack(move.root, move.s.form, { cache: false })

  moveProfile.submit()
  await flush()
  moveSignup.submit()
  await flush()
  assert.equal(moveSignup.submits, 0, 'MOVE mode: the second form is swallowed')
  assert.equal(move.p.submitSpinner.style.display, 'block', 'the open request keeps its spin')
  assert.deepEqual(loaders(move.root), [move.p.submitSpinner], 'and its marker')
  assert.equal(moveApp.warnings.length, 1, moveApp.warnings.join(' | '))
  assert.ok(moveApp.warnings[0].includes(SUBMIT_REFUSED), moveApp.warnings[0])
  assert.ok(
    moveApp.warnings[0].includes('form#wf-form-Brand-Signup.auth_form-block'),
    moveApp.warnings[0],
  )

  const pin = anchoredPage()
  const pinApp = mount(pin.root, { hostname: STAGING })
  const pinSignup = memberstack(pin.root, pin.s.form)
  const pinProfile = memberstack(pin.root, pin.p.form)

  pinProfile.submit()
  await flush()
  pinSignup.submit()
  await flush()
  assert.equal(pinSignup.submits, 0, 'MIRROR mode: the same')
  assert.equal(pin.p.submitSpinner.style.display, 'block')
  assert.deepEqual(marksOf(pin.s.submitWrap), IDLE_WRAP)
  assert.equal(pinApp.warnings.length, 1, pinApp.warnings.join(' | '))
  assert.ok(
    pinApp.warnings[0].includes('form#wf-form-Brand-Signup.auth_form-block'),
    pinApp.warnings[0],
  )
})

test('a lit marker this script never lit refuses nothing', async () => {
  const f = signupForm({ noLoader: true })
  const stray = h('div', { id: 'hero', class: 'foo' })
  const root = body([f.form, stray])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form, { cache: false })

  // a duplicate marker, or a peer widget lighting one of its own
  stray.setAttribute('data-ms-loader', '')
  stray.style.display = 'block'
  await flush()

  ms.submit()
  await flush()
  assert.equal(ms.submits, 1, 'a marker we never lit does not hold the page')
  assert.equal(f.submitSpinner.style.display, 'block')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a spinner left lit with no hide does not lock the next form out', async () => {
  const { s, p, root } = unanchoredPage()
  const app = mount(root, { hostname: STAGING })
  const profile = memberstack(root, p.form, { cache: false })
  const signup = memberstack(root, s.form, { cache: false })

  profile.submit()
  await flush()
  profile.hide()
  await flush()

  // Memberstack's logout path shows the loader and never hides it on rejection
  p.submitSpinner.style.display = 'block'
  await flush()

  signup.submit()
  await flush()
  assert.equal(signup.submits, 1, 'the stranded spin blocks nothing')
  assert.deepEqual(loaders(root), [s.submitSpinner])
  assert.equal(p.submitSpinner.style.display, 'none', 'and the stranded spin is put out')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a spinner taken off the page mid-request releases the page', async () => {
  const { s, p, root } = unanchoredPage()
  const app = mount(root, { hostname: STAGING })
  const profile = memberstack(root, p.form, { cache: false })
  const signup = memberstack(root, s.form, { cache: false })

  profile.submit()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'block', 'the Save button spins')

  // a modal or step flow swaps the CTA subtree out while the request is open
  p.submitSpinner.remove()
  await flush()

  signup.submit()
  await flush()
  assert.equal(signup.submits, 1, 'no hide can ever reach the detached spinner')
  assert.equal(s.submitSpinner.style.display, 'block')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a page loader taken off the page still holds the request open', async () => {
  const hero = heroLoader()
  const s = signupForm({ noLoader: true })
  const p = profileForm({ noLoader: true })
  p.form.setAttribute('id', 'save')
  const root = body([hero, s.form, p.form])
  const app = mount(root, { hostname: STAGING })
  const strayWarnings = app.warnings.length
  const signup = memberstack(root, s.form)
  const profile = memberstack(root, p.form)

  signup.submit()
  await flush()
  assert.equal(hero.style.display, 'block', 'the pinned page loader is what lights')

  // Memberstack writes the element it cached at init, in the document or not
  hero.remove()
  await flush()

  profile.submit()
  await flush()
  assert.equal(profile.submits, 0, 'the cached loader is still the open request')
  const refusals = app.warnings.slice(strayWarnings)
  assert.equal(refusals.length, 1, app.warnings.join(' | '))
  assert.ok(refusals[0].includes(SUBMIT_REFUSED), refusals[0])
  assert.ok(refusals[0].includes('form#save.auth_form-block'), refusals[0])

  hero.style.display = 'none'
  await flush()
  profile.submit()
  await flush()
  assert.equal(profile.submits, 1, 'and its hide still ends it')
})

test('a rescan picks up the Button that replaced a detached one', async () => {
  const { s, p, root } = unanchoredPage()
  const app = mount(root, { hostname: STAGING })
  const profile = memberstack(root, p.form, { cache: false })
  const signup = memberstack(root, s.form, { cache: false })

  profile.submit()
  await flush()
  p.submitSpinner.remove()
  await flush()

  signup.submit()
  await flush()
  signup.hide()
  await flush()

  // the step flow puts a fresh Button where the one it took away used to be
  const fresh = profileForm({ noLoader: true })
  fresh.wrap.remove()
  p.form.append(fresh.wrap)
  app.window.startersMemberstackLoader.rescan()

  profile.submit()
  await flush()
  assert.equal(fresh.submitSpinner.style.display, 'block', 'the new Button is what spins')
  assert.equal(profile.overlayShows, 0, 'Memberstack never falls back to its overlay')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a Button that replaced a pending one is dressed and re-asserted', async () => {
  const f = signupForm({ noLoader: true })
  const root = body([f.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form, { cache: false })

  ms.submit()
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  // the modal swaps the whole Button out while the request is still open
  const gone = f.submitWrap
  const fresh = signupForm({ noLoader: true })
  fresh.submitWrap.remove()
  gone.remove()
  f.form.append(fresh.submitWrap)
  app.window.startersMemberstackLoader.rescan()
  assert.deepEqual(marksOf(gone), IDLE_WRAP, 'the Button on its way out is left clean')

  ms.submit()
  await flush()
  assert.equal(fresh.submitWrap.getAttribute('data-button-theme'), 'disabled', 'the new one greys')

  // a peer strips the busy look off the Button that arrived late
  fresh.submitWrap.removeAttribute('data-button-theme')
  await flush()
  assert.equal(fresh.submitWrap.getAttribute('data-button-theme'), 'disabled', 'and it is put back')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a peer putting out the mirrored spinner does not open the page', async () => {
  const hero = heroLoader()
  const a = signupForm({ noLoader: true })
  const b = profileForm({ noLoader: true })
  b.form.setAttribute('id', 'save')
  const root = body([hero, a.form, b.form])
  const app = mount(root, { hostname: STAGING })
  const strayWarnings = app.warnings.length
  const signup = memberstack(root, a.form)
  const profile = memberstack(root, b.form)

  signup.submit()
  await flush()
  assert.equal(hero.style.display, 'block', 'the pinned page loader is what lights')
  assert.equal(a.submitSpinner.style.display, 'block', 'and the signup button mirrors it')

  // opportunities-3.0.js blanks every [data-button-spinner] on modal-open
  a.submitSpinner.style.display = 'none'
  await flush()
  assert.deepEqual(marksOf(a.submitWrap), IDLE_WRAP, 'the button comes back')

  profile.submit()
  await flush()
  assert.equal(profile.submits, 0, 'the request Memberstack still has open holds the page')
  const refusals = app.warnings.slice(strayWarnings)
  assert.equal(refusals.length, 1, app.warnings.join(' | '))
  assert.ok(refusals[0].includes(SUBMIT_REFUSED), refusals[0])
  assert.ok(refusals[0].includes('form#save.auth_form-block'), refusals[0])

  hero.style.display = 'none'
  await flush()
  profile.submit()
  await flush()
  assert.equal(profile.submits, 1, 'the ended request lets the next one through')
})

test('a submit another script cancels never holds the page', async () => {
  const hero = heroLoader()
  const a = signupForm({ noLoader: true })
  const b = profileForm({ noLoader: true })
  const root = body([hero, a.form, b.form])
  const app = mount(root, { hostname: STAGING })
  const strayWarnings = app.warnings.length
  const signup = memberstack(root, a.form)
  const profile = memberstack(root, b.form)

  // turnstile-contents-fix.js cancels a tokenless submit from a later capture
  // listener, so Memberstack never sees it and never lights anything
  a.form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    true,
  )
  signup.submit()
  await tick()
  assert.equal(signup.submits, 0, 'the cancelled submit never reached Memberstack')

  // a peer widget lights the page loader afterwards
  hero.style.display = 'block'
  await flush()
  assert.deepEqual(marksOf(a.submitWrap), IDLE_WRAP, 'the cancelled form is not dressed')
  assert.equal(a.submitSpinner.style.display, '', 'and nothing mirrors onto it')

  profile.submit()
  await flush()
  assert.equal(profile.submits, 1, 'the abandoned claim does not refuse the next form')
  assert.equal(b.submitSpinner.style.display, 'block', 'the Save button is what mirrors')
  assert.equal(app.warnings.length, strayWarnings, app.warnings.join(' | '))
})

test("a back-button restore takes Memberstack's overlay off the page", async () => {
  const f = signupForm({ noLoader: true })
  const overlay = h('div', { 'data-ms-modal-loader': '' })
  const root = body([f.form, overlay])
  const app = mount(root, { hostname: STAGING })

  app.firePageshow({ persisted: false })
  await flush()
  assert.equal(root.querySelector('[data-ms-modal-loader]'), overlay, 'a fresh show leaves it')

  app.firePageshow({ persisted: true })
  await flush()
  assert.equal(root.querySelector('[data-ms-modal-loader]'), null, 'the restore clears it')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a password-validation hand-back that throws still restores every button', async () => {
  const a = signupForm({ noLoader: true })
  const b = signupForm({ noLoader: true })
  const root = body([a.form, b.form])
  const app = mount(root, { hostname: STAGING })
  app.window.startersPasswordValidation = {
    regate() {
      throw new Error('password-validation blew up')
    },
  }

  a.submitSpinner.style.display = 'block'
  b.submitSpinner.style.display = 'block'
  await flush()
  assert.equal(a.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(b.submitWrap.getAttribute('data-button-theme'), 'disabled')

  app.firePageshow({ persisted: true })
  await flush()
  assert.deepEqual(marksOf(a.submitWrap), IDLE_WRAP, 'the first button comes back')
  assert.deepEqual(marksOf(b.submitWrap), IDLE_WRAP, 'and so does the one after it')
  assert.equal(a.control.hasAttribute('aria-disabled'), false)
  assert.equal(b.control.hasAttribute('aria-disabled'), false)
})

test('a page-level loader lit again after its request ended blocks nothing', async () => {
  const l = loginForm()
  const s = signupForm({ noLoader: true })
  const hero = heroLoader()
  const root = body([hero, l.form, s.form])
  // production on purpose: on staging the Spinner-less login form is named
  const app = mount(root, { hostname: PRODUCTION })
  const login = memberstack(root, l.form)
  const signup = memberstack(root, s.form)

  login.submit()
  await flush()
  assert.equal(hero.style.display, 'block', 'the pinned page loader is what lights')

  login.hide()
  await flush()
  hero.style.display = 'block'
  await flush()

  signup.submit()
  await flush()
  assert.equal(signup.submits, 1, 'the finished login no longer holds the page')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a profile save that ends releases the page for the next one', async () => {
  const p = profileForm({ noLoader: true })
  const root = body([p.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, p.form, { cache: false })

  ms.submit()
  await flush()
  ms.hide()
  await flush()

  ms.submit()
  await flush()
  assert.equal(ms.submits, 2, 'the ended save is not still holding the page')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a back-button restore puts the button back and reopens the page', async () => {
  const f = signupForm({ noLoader: true })
  const root = body([f.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form, { cache: false })

  ms.submit()
  await flush()
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  // restored from the bfcache: Memberstack will never hide the loader it left
  app.firePageshow({ persisted: true })
  await flush()

  assert.deepEqual(marksOf(f.submitWrap), IDLE_WRAP)
  assert.equal(f.control.hasAttribute('aria-disabled'), false)
  assert.equal(f.submitSpinner.style.display, 'none')

  ms.submit()
  await flush()
  assert.equal(ms.submits, 2)
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('an ordinary fresh show leaves a live request exactly as it was', async () => {
  const f = signupForm({ noLoader: true })
  const root = body([f.form])
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, f.form, { cache: false })

  ms.submit()
  await flush()
  app.firePageshow({ persisted: false })
  await flush()

  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.equal(f.submitSpinner.style.display, 'block')
  ms.submit()
  assert.equal(ms.submits, 1, 'still pending')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('on production the refused submit says nothing in the console', async () => {
  const build = () => {
    const s = signupForm({ noLoader: true })
    const p = profileForm({ noLoader: true })
    return { s, p, root: body([p.form, s.form]) }
  }

  const quiet = build()
  const quietApp = mount(quiet.root, { hostname: PRODUCTION })
  const quietProfile = memberstack(quiet.root, quiet.p.form, { cache: false })
  const quietSignup = memberstack(quiet.root, quiet.s.form, { cache: false })
  quietProfile.submit()
  await flush()
  quietSignup.submit()
  await flush()
  assert.equal(quietSignup.submits, 0, 'still refused')
  assert.equal(quietApp.warnings.length, 0, quietApp.warnings.join(' | '))

  const loud = build()
  const loudApp = mount(loud.root, { hostname: STAGING })
  const loudProfile = memberstack(loud.root, loud.p.form, { cache: false })
  const loudSignup = memberstack(loud.root, loud.s.form, { cache: false })
  loudProfile.submit()
  await flush()
  loudSignup.submit()
  await flush()
  assert.equal(loudSignup.submits, 0)
  assert.equal(loudApp.warnings.length, 1, loudApp.warnings.join(' | '))
  assert.ok(loudApp.warnings[0].includes(SUBMIT_REFUSED), loudApp.warnings[0])
})

test('the marker never lands on the sign-in link next to the CTA', async () => {
  const f = signupForm({ noLoader: true })
  const root = body([f.form])
  mount(root)
  const ms = memberstack(root, f.form)

  ms.submit()
  assert.deepEqual(loaders(root), [f.submitSpinner])
  assert.equal(f.linkSpinner.hasAttribute('data-ms-loader'), false)
  await flush()

  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(f.control.getAttribute('aria-disabled'), 'true')
  assert.deepEqual(marksOf(f.linkWrap), IDLE_WRAP)
  assert.equal(f.linkSpinner.style.display, '')
})

test('a mirrored spinner already put out by hand is not written to again', async () => {
  const hero = heroLoader()
  const p = profileForm({ noLoader: true })
  const root = body([hero, p.form])
  // production on purpose: on staging the page-level marker is named as a stray
  mount(root, { hostname: PRODUCTION })
  const profile = memberstack(root, p.form)

  profile.submit()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'block', 'the Save button mirrors the page loader')

  // a peer puts the Spinner back to its authored display mid-request
  p.submitSpinner.style.display = ''
  await flush()

  const writes = []
  const watcher = new MutationObserver((records) => records.forEach((record) => writes.push(record)))
  watcher.observe(p.submitSpinner, { attributes: true, attributeFilter: ['style'] })

  profile.hide()
  await flush()
  assert.equal(p.submitSpinner.style.display, '', 'an unlit Spinner is left alone')
  assert.deepEqual(writes, [], 'and nothing is written to put it out twice')
  watcher.disconnect()
})

test('a loader authored after load does not start mirroring it', async () => {
  const f = signupForm({ noLoader: true })
  const stray = h('div', {})
  const root = body([f.form, stray])
  const app = mount(root)
  const ms = memberstack(root, f.form)

  stray.setAttribute('data-ms-loader', '')
  app.window.startersMemberstackLoader.rescan()

  ms.submit()
  assert.deepEqual(loaders(root), [f.submitSpinner], 'the stray marker is taken away')
  await flush()
  assert.equal(f.submitSpinner.style.display, 'block')
  assert.equal(ms.overlayShows, 0)
})

test('repeated rescans still leave exactly one loader marker', async () => {
  const { s, p, root } = unanchoredPage()
  const app = mount(root)
  const wired = p.form.listenerCount('submit')
  const profile = memberstack(root, p.form)

  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()
  assert.equal(p.form.listenerCount('submit'), wired + 1, 'only the stand-in was added')

  profile.submit()
  await flush()
  assert.deepEqual(loaders(root), [p.submitSpinner])
  assert.equal(profile.submits, 1)
  assert.equal(s.submitSpinner.hasAttribute('data-ms-loader'), false)
})

test('with password-validation loaded the marker still follows the click', async () => {
  const w = pvWorld({ form: { noLoader: true } })

  dispatch(w.control, 'click')
  assert.deepEqual(loaders(w.root), [w.submitSpinner])
  await flush()
  assert.equal(w.ms.submits, 1)
  assert.equal(w.ms.overlayShows, 0)
  assert.equal(w.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(w.control.getAttribute('aria-disabled'), 'true')

  const before = w.warnings.length
  dispatch(w.control, 'click')
  assert.equal(w.ms.submits, 1)
  const fresh = w.warnings.slice(before)
  assert.equal(fresh.length, 1, fresh.join(' | '))
  assert.ok(fresh[0].includes(REFUSED), fresh[0])

  w.ms.hide()
  await flush()
  dispatch(w.control, 'click')
  await flush()
  assert.equal(w.ms.submits, 2)
  assert.deepEqual(loaders(w.root), [w.submitSpinner])
})

// ---------------------------------------------------------------------------
// Staging diagnostics
//
// Three warnings, each at most once per page, emitted only on a staging host
// or under window.STARTERS_DEBUG === true. Production is silent.
// ---------------------------------------------------------------------------

/** the /login shape: an auth form whose Spinner has no marker, served by MOVE mode */
const noLoaderPage = () => {
  const s = signupForm({ noLoader: true })
  return { s, root: body([s.form]) }
}

/** the real fallback case: an auth form with no Button Spinner to turn at all */
const noSpinnerPage = () => {
  const s = signupForm({ noSpinner: true })
  return { s, root: body([s.form]) }
}

/** two authored markers on one page: Memberstack pins the first and ignores the rest */
const twoLoaderPage = () => {
  const s = signupForm()
  const p = profileForm()
  return { s, p, root: body([s.form, p.form]) }
}

/** a marker parked on a decorative div, next to a correctly authored form */
const strayLoaderPage = () => {
  const s = signupForm()
  const hero = h('div', { id: 'hero', class: 'foo', 'data-ms-loader': '' })
  return { s, hero, root: body([s.form, hero]) }
}

test('a staging auth form with no Button Spinner is told so once', async () => {
  const { root } = noSpinnerPage()
  const app = mount(root, { hostname: STAGING })

  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
  assert.equal(
    app.warnings[0],
    TAG +
      ' auth form form#wf-form-Brand-Signup.auth_form-block has no Button Spinner ' +
      '(its Button Wrap has no [data-button-spinner]); ' +
      'Memberstack shows its overlay instead',
  )
})

/** the same spinnerless auth form under a chosen id, so describe() can name it */
const namedNoSpinnerForm = (id) => {
  const f = signupForm({ noSpinner: true })
  f.form.setAttribute('id', id)
  return f
}

test('each spinnerless auth form on the page is named in its own warning', async () => {
  const first = namedNoSpinnerForm('wf-form-One')
  const second = namedNoSpinnerForm('wf-form-Two')
  const root = body([first.form, second.form])
  const app = mount(root, { hostname: STAGING })

  assert.equal(app.warnings.length, 2, app.warnings.join(' | '))
  assert.ok(app.warnings[0].includes('form#wf-form-One.auth_form-block'), app.warnings[0])
  assert.ok(app.warnings[1].includes('form#wf-form-Two.auth_form-block'), app.warnings[1])

  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()
  assert.equal(app.warnings.length, 2, 'still one per form, however many rescans')
})

test('on an anchored page the spinnerless form is told the pinned loader lights', async () => {
  const s = signupForm()
  const l = loginForm()
  const root = body([s.form, l.form])
  const app = mount(root, { hostname: STAGING })
  const login = memberstack(root, l.form)

  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
  assert.ok(app.warnings[0].includes('has no Button Spinner'), app.warnings[0])
  assert.ok(app.warnings[0].includes('no Button Wrap holding a submit control'), app.warnings[0])
  assert.ok(app.warnings[0].includes('the pinned [data-ms-loader] lights instead'), app.warnings[0])

  login.submit()
  await flush()
  assert.equal(login.overlayShows, 0, 'and that is what really happens')
})

test('a spinnerless auth form added after load is warned about on the next rescan', async () => {
  const { s, root } = noLoaderPage()
  const app = mount(root, { hostname: STAGING })
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))

  const late = namedNoSpinnerForm('wf-form-Late')
  root.append(late.form)
  app.window.startersMemberstackLoader.rescan()

  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
  assert.ok(app.warnings[0].includes('form#wf-form-Late'), app.warnings[0])
  assert.equal(s.form.__startersMemberstackLoader.spinner, s.submitSpinner, 'the wired form is fine')

  app.window.startersMemberstackLoader.rescan()
  assert.equal(app.warnings.length, 1, 'and it is not repeated')
})

test('the reset and login shapes each name their own cause on staging', async () => {
  const reset = mount(body([resetForm().form]), { hostname: STAGING })
  assert.equal(reset.warnings.length, 1, reset.warnings.join(' | '))
  assert.ok(reset.warnings[0].includes('form.auth_form-block'), reset.warnings[0])
  assert.ok(
    reset.warnings[0].includes('its Button Wrap has no [data-button-spinner]'),
    reset.warnings[0],
  )

  const login = mount(body([loginForm().form]), { hostname: STAGING })
  assert.equal(login.warnings.length, 1, login.warnings.join(' | '))
  assert.ok(
    login.warnings[0].includes('no Button Wrap holding a submit control'),
    login.warnings[0],
  )
})

test('a wrap whose only control cannot submit is named as having no Button Wrap', async () => {
  const f = bareButtonForm('button')
  const app = mount(body([f.form]), { hostname: STAGING })

  assert.equal(f.form.getAttribute('data-ms-form'), 'login', 'it really is an auth form')
  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
  assert.ok(
    app.warnings[0].includes('no Button Wrap holding a submit control'),
    app.warnings[0],
  )
  assert.ok(
    app.warnings[0].includes('the pinned [data-ms-loader] lights instead'),
    'its own Spinner still carries the marker Memberstack pinned',
  )
})

test('a marker-less page whose auth form has a Spinner is not nagged', async () => {
  const { root } = noLoaderPage()
  const app = mount(root, { hostname: STAGING })

  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a staging page with two loader markers is told Memberstack pins the first', async () => {
  const { root } = twoLoaderPage()
  const app = mount(root, { hostname: STAGING })

  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
  assert.ok(app.warnings[0].includes('2 [data-ms-loader] elements at load'), app.warnings[0])
})

test('a loader marker outside every form is named element by element', async () => {
  const { root } = strayLoaderPage()
  const app = mount(root, { hostname: STAGING })

  assert.equal(app.warnings.length, 2, app.warnings.join(' | '))
  assert.ok(app.warnings[0].includes('2 [data-ms-loader] elements at load'), app.warnings[0])
  assert.equal(
    app.warnings[1],
    TAG + ' [data-ms-loader] outside any Memberstack form: div#hero.foo',
  )
})

test('the homepage shape says nothing on staging', async () => {
  const { root } = anchoredPage()
  const app = mount(root, { hostname: STAGING })

  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a profile page carrying its own authored loader says nothing on staging', async () => {
  const p = profileForm()
  const app = mount(body([p.form]), { hostname: STAGING })

  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('a page with no auth form is not nagged about a missing loader', async () => {
  const p = profileForm({ noLoader: true })
  const app = mount(body([p.form]), { hostname: STAGING })

  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('production stays silent on a page that warns twice on staging', async () => {
  const app = mount(strayLoaderPage().root, { hostname: PRODUCTION })

  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('production stays silent on a page whose auth form has no Spinner', async () => {
  const app = mount(noSpinnerPage().root, { hostname: PRODUCTION })

  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('STARTERS_DEBUG turns the same warnings on in production', async () => {
  const stray = mount(strayLoaderPage().root, { debug: true })
  assert.equal(stray.warnings.length, 2, stray.warnings.join(' | '))
  assert.ok(stray.warnings[0].includes('2 [data-ms-loader] elements at load'), stray.warnings[0])
  assert.ok(stray.warnings[1].includes('outside any Memberstack form'), stray.warnings[1])

  const missing = mount(noSpinnerPage().root, { debug: true })
  assert.equal(missing.warnings.length, 1, missing.warnings.join(' | '))
  assert.ok(missing.warnings[0].includes('has no Button Spinner'), missing.warnings[0])
})

test('STARTERS_DEBUG set to false leaves production silent', async () => {
  const app = mount(noSpinnerPage().root, { debug: false })

  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

for (const hostname of ['localhost', '127.0.0.1', STAGING, 'abc-def.trycloudflare.com']) {
  test('on ' + hostname + ' the missing Spinner is reported', async () => {
    const app = mount(noSpinnerPage().root, { hostname })

    assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
  })
}

for (const hostname of ['notwebflow.io', 'evil-trycloudflare.com', 'www.thestarters.com']) {
  test('on ' + hostname + ' nothing is reported', async () => {
    const app = mount(noSpinnerPage().root, { hostname })

    assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
  })
}

test('rescanning never repeats the missing-Spinner warning', async () => {
  const app = mount(noSpinnerPage().root, { hostname: STAGING })

  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()

  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
})

test('rescanning never repeats the duplicate or the stray warning', async () => {
  const app = mount(strayLoaderPage().root, { hostname: STAGING })

  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()

  assert.equal(app.warnings.length, 2, app.warnings.join(' | '))
})

test('a marker-less page still spins its own button, and says nothing', async () => {
  const { s, root } = noLoaderPage()
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, s.form, { cache: false })

  ms.submit()
  assert.deepEqual(loaders(root), [s.submitSpinner], 'the marker lands on the submitting Spinner')
  await flush()
  assert.equal(ms.overlayShows, 0)
  assert.equal(s.submitWrap.getAttribute('data-button-theme'), 'disabled')
  assert.equal(s.control.getAttribute('aria-disabled'), 'true')
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))

  ms.hide()
  await flush()
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
  assert.deepEqual(marksOf(s.control), NO_MARKS)

  app.window.startersMemberstackLoader.rescan()
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))
})

test('the warned page really is the one Memberstack covers with its overlay', async () => {
  const { s, root } = noSpinnerPage()
  const app = mount(root, { hostname: STAGING })
  const ms = memberstack(root, s.form, { cache: false })

  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))

  ms.submit()
  await flush()
  assert.equal(ms.overlayShows, 1, 'Memberstack shows its own full-screen overlay')
  assert.deepEqual(loaders(root), [])
  assert.deepEqual(marksOf(s.submitWrap), IDLE_WRAP)
  assert.deepEqual(marksOf(s.control), NO_MARKS)
  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
})

test('with the DOM still parsing the warning waits for DOMContentLoaded', async () => {
  const app = mount(noSpinnerPage().root, { hostname: STAGING, readyState: 'loading' })
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))

  app.fireReady()
  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
})

test('loading the script twice on staging still warns once', async () => {
  const app = mount(noSpinnerPage().root, { hostname: STAGING, loadTwice: true })

  assert.equal(app.warnings.length, 1, app.warnings.join(' | '))
})

/** a page carrying password-validation, with the loader started after it */
function withPv(pv, hostname) {
  const f = signupForm({ noLoader: true })
  const app = mount(body([f.form]), { hostname, readyState: 'loading' })
  if (pv) app.window.startersPasswordValidation = pv
  app.fireReady()
  return app
}

const OLD_PV = 'older than v1.59.504'
const oldPvWarnings = (app) => app.warnings.filter((line) => line.includes(OLD_PV)).length

test('a password-validation too old to hand back to is named once', () => {
  const app = withPv({ rescan() {} }, STAGING)

  assert.equal(oldPvWarnings(app), 1, app.warnings.join(' | '))
  app.window.startersMemberstackLoader.rescan()
  app.window.startersMemberstackLoader.rescan()
  assert.equal(oldPvWarnings(app), 1, 'and never again on a rescan')
})

test('a password-validation that reports its release is left alone', () => {
  const named = withPv({ rescan() {}, release: 'v1.59.502' }, STAGING)
  assert.equal(oldPvWarnings(named), 0, named.warnings.join(' | '))

  const absent = withPv(null, STAGING)
  assert.equal(oldPvWarnings(absent), 0, absent.warnings.join(' | '))

  const live = withPv({ rescan() {} }, PRODUCTION)
  assert.equal(live.warnings.length, 0, 'and production says nothing at all')
})

test('a diagnostics failure never breaks the button wiring', async () => {
  const { p, root } = twoLoaderPage()
  const all = root.querySelectorAll.bind(root)
  root.querySelectorAll = (selector) => {
    if (selector === '[data-ms-loader]') throw new Error('querySelectorAll blew up')
    return all(selector)
  }
  root.querySelector = (selector) => all(selector)[0] || null

  const app = mount(root, { hostname: STAGING })
  const profile = memberstack(root, p.form)
  assert.equal(app.warnings.length, 0, app.warnings.join(' | '))

  profile.submit()
  await flush()
  assert.equal(p.submitSpinner.style.display, 'block', 'the Save button still spins')
  assert.deepEqual(marksOf(p.wrap), IDLE_WRAP, 'a profile form is still never dressed')
})
