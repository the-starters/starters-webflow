const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'memberstack-loader.js'), 'utf8')

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
//     NO oldValue, NO characterData, and no record for a write that does not
//     change the value (the real thing does record those; nothing here relies
//     on the difference).
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
 * @param {{loadTwice?: boolean, readyState?: string}} [options]
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
    querySelector: (selector) => root.querySelector(selector),
  }
  const location = { hostname: 'www.thestarters.com' }
  const window = { location }
  window.window = window

  const context = vm.createContext({
    window,
    document,
    location,
    MutationObserver,
    queueMicrotask,
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
// Fixtures — the real /sign-up form (fetched 2026-09-03 from staging) and the
// profile-shape button. SVG icon contents omitted.
// ---------------------------------------------------------------------------

const spinner = (attrs) =>
  h('div', attrs, [h('div', { class: 'button_spinner' })])

/**
 * @param {{kind?: string, theme?: string, ariaDisabled?: string, noLoader?: boolean,
 *          noSpinner?: boolean}} [opts]
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
    [
      h('label', { for: 'Work-Email', class: 'form_label' }, ['Work Email']),
      h('input', {
        class: 'form_input w-input',
        name: 'Work-Email',
        placeholder: 'Work Email',
        type: 'email',
        id: 'Work-Email',
        'data-ms-member': 'email',
        required: '',
      }),
      h('label', { for: 'Password', class: 'form_label' }, ['Password']),
      h('div', { class: 'password-input_component' }, [
        h('div', { 'data-password-input': '', class: 'password-input_wrapper' }, [
          h('input', {
            class: 'form_input is-password w-input',
            name: 'Password',
            type: 'password',
            id: 'Password',
            'data-ms-member': 'password',
            required: '',
          }),
          h('div', { id: 'passwordToggle', 'data-password-toggle': '', class: 'password-toggle' }, [
            h('div', { class: 'eye-icon show' }),
            h('div', { class: 'eye-icon visible' }),
          ]),
        ]),
      ]),
      h('div', { class: 'spacer-6' }),
      h('label', { class: 'w-checkbox auth-form_checkbox' }, [
        h('div', {
          class: 'w-checkbox-input w-checkbox-input--inputType-custom auth-form_checkbox_icon',
        }),
        h('input', {
          type: 'checkbox',
          name: 'Accept-legal',
          id: 'Accept-legal',
          required: '',
          'data-ms-member': 'terms-and-condition',
        }),
        h('span', { class: 'text-size-medium w-form-label', for: 'Accept-legal' }, [
          'I accept the Terms',
        ]),
      ]),
      h('div', { class: 'spacer-16' }),
      h('div', { class: 'auth_form-button-group' }, [
        submitWrap,
        linkWrap,
        h('a', { 'data-ms-auth-provider': 'google', href: '#', class: 'button is-google w-button' }, [
          'Continue with Google',
        ]),
      ]),
    ],
  )

  return { form, submitWrap, submitElement, submitSpinner, control, linkWrap, linkSpinner, link }
}

/** profile/security shape: no marker, native submit inside the wrap */
function profileForm(opts = {}) {
  const theme = opts.theme === undefined ? 'black' : opts.theme
  const submitSpinner = spinner({
    'data-ms-loader': '',
    'aria-hidden': 'true',
    'data-button-spinner': '',
    class: 'w-layout-vflex button_icon-spinner',
  })
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

/**
 * Memberstack stand-in: consumes the form's submit, then shows the page's
 * single loader. No DOM event marks submit start or end, which is the whole
 * reason the component watches the loader instead.
 */
function memberstack(root, form) {
  const state = { submits: 0 }
  const loader = () => root.querySelector('[data-ms-loader]')
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    state.submits += 1
    const el = loader()
    if (el) el.style.display = 'block'
  })
  return {
    get submits() {
      return state.submits
    },
    submit: () => dispatch(form, 'submit'),
    hide: () => {
      const el = loader()
      if (el) el.style.display = 'none'
    },
  }
}

const body = (children) => h('body', {}, children)

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

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('sign-up button greys out and reads busy while the spinner runs', async () => {
  const f = signupForm()
  const root = body([f.form])
  const app = mount(root)
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
  assert.equal(app.warnings.length, 0, 'production console output stays empty')
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
  assert.equal(f.submitWrap.getAttribute('data-memberstack-loader-theme'), '')
  assert.equal(f.submitWrap.getAttribute('data-button-theme'), 'disabled')

  ms.hide()
  await flush()
  assert.equal(f.submitWrap.hasAttribute('data-button-theme'), false)
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

test('a non-auth Memberstack form is left completely alone', async () => {
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
  assert.equal(observerCount(f.submitSpinner), 0)

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
  const app = mount(root)

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
  const app = mount(root)

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
  const window = { location: { hostname: 'www.thestarters.com' } }
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
