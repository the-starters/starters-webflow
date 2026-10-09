const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./auth-route.js'), 'utf8')

const INVALID = 'The provided credentials are invalid.'
const USE_EMAIL = 'Please login with your email.'
const INVALID_COPY =
  'That email and password do not match. Forgot password?' +
  'If you signed up with Google, use "Continue with Google".'
const USE_EMAIL_COPY =
  'This account uses an email and password, not Google. ' +
  'Log in with your email below, or reset your password.'

// ---------------------------------------------------------------------------
// Minimal DOM: elements, text nodes, attribute selectors, capture/bubble event
// dispatch, and a MutationObserver that is delivered on flush() and re-runs
// until the page settles, so a self-triggering observer loop fails the test.
// ---------------------------------------------------------------------------

function createDom() {
  const observers = []

  function touched(node) {
    observers.forEach((observer) => {
      if (observer.targets.some((target) => contains(target, node))) {
        observer.dirty = true
      }
    })
  }

  function contains(parent, node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === parent) return true
    }
    return false
  }

  function matches(element, selector) {
    return selector.split(',').some((part) => {
      const match = /^\s*\[([\w-]+)(?:="([^"]*)")?\]\s*$/.exec(part)
      if (!match) throw new Error('unsupported selector: ' + selector)
      const value = element.getAttribute(match[1])
      if (value === null) return false
      return match[2] === undefined || value === match[2]
    })
  }

  class TextNode {
    constructor(data) {
      this.nodeType = 3
      this.parentNode = null
      this._data = String(data)
    }
    get textContent() {
      return this._data
    }
  }

  class Element {
    constructor(tagName, attributes = {}) {
      this.nodeType = 1
      this.tagName = tagName.toUpperCase()
      this.parentNode = null
      this.childNodes = []
      this.attributes = new Map(Object.entries(attributes))
      this.listeners = []
      this.hidden = false
      this.className = ''
      const element = this
      const styleValues = {}
      this.style = new Proxy(styleValues, {
        get: (target, key) => (key in target ? target[key] : ''),
        set: (target, key, value) => {
          target[key] = value
          touched(element)
          return true
        },
      })
    }
    get textContent() {
      return this.childNodes.map((node) => node.textContent).join('')
    }
    set textContent(value) {
      this.childNodes.forEach((node) => {
        node.parentNode = null
      })
      this.childNodes = []
      this.appendChild(new TextNode(value))
    }
    get nextSibling() {
      if (!this.parentNode) return null
      const siblings = this.parentNode.childNodes
      return siblings[siblings.indexOf(this) + 1] || null
    }
    get children() {
      return this.childNodes.filter((node) => node.nodeType === 1)
    }
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value))
      touched(this)
    }
    appendChild(node) {
      return this.insertBefore(node, null)
    }
    insertBefore(node, reference) {
      if (node.parentNode) node.parentNode.removeChild(node)
      const index = reference ? this.childNodes.indexOf(reference) : -1
      if (index === -1) this.childNodes.push(node)
      else this.childNodes.splice(index, 0, node)
      node.parentNode = this
      touched(this)
      return node
    }
    removeChild(node) {
      this.childNodes.splice(this.childNodes.indexOf(node), 1)
      node.parentNode = null
      touched(this)
      return node
    }
    descendants() {
      return this.children.flatMap((child) => [child, ...child.descendants()])
    }
    querySelectorAll(selector) {
      return this.descendants().filter((element) => matches(element, selector))
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    }
    closest(selector) {
      for (let current = this; current && current.nodeType === 1; current = current.parentNode) {
        if (matches(current, selector)) return current
      }
      return null
    }
    addEventListener(type, listener, capture) {
      this.listeners.push({ type, listener, capture: Boolean(capture) })
    }
  }

  const root = new Element('html')
  const listeners = []
  const document = {
    readyState: 'complete',
    createElement: (tagName) => new Element(tagName),
    createTextNode: (data) => new TextNode(data),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener(type, listener, capture) {
      listeners.push({ type, listener, capture: Boolean(capture) })
    },
  }

  function fire(list, event, capture) {
    list
      .filter((entry) => entry.type === event.type && entry.capture === capture)
      .forEach((entry) => entry.listener(event))
  }

  // Document capture, then the target, then bubbling to the document.
  function dispatch(target, type) {
    const event = { type, target }
    fire(listeners, event, true)
    const path = []
    for (let current = target; current && current !== root; current = current.parentNode) {
      path.push(current)
    }
    fire(target.listeners, event, true)
    path.forEach((element) => fire(element.listeners, event, false))
    fire(listeners, event, false)
    flush()
  }

  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.targets = []
      this.dirty = false
      observers.push(this)
    }
    observe(target) {
      this.targets.push(target)
    }
  }

  function flush() {
    for (let round = 0; round < 20; round += 1) {
      const due = observers.filter((observer) => observer.dirty)
      if (!due.length) return
      due.forEach((observer) => {
        observer.dirty = false
        observer.callback([])
      })
    }
    assert.fail('mutation observers never settled')
  }

  return { Element, MutationObserver, document, dispatch, flush, root }
}

// The /login markup the copy depends on: a Memberstack login form whose error
// banner holds a `[data-ms-message-text]` element, plus a Google control.
function loadLoginPage({ pathname = '/login', withObserver = true } = {}) {
  const dom = createDom()
  const { Element, root } = dom
  const wrapper = root.appendChild(new Element('div'))
  const form = wrapper.appendChild(
    new Element('form', { 'data-ms-form': 'login' }),
  )
  const google = form.appendChild(
    new Element('a', { 'data-ms-auth-provider': 'google' }),
  )
  const banner = wrapper.appendChild(
    new Element('div', { 'data-ms-message': 'error' }),
  )
  const text = banner.appendChild(new Element('div', { 'data-ms-message-text': '' }))
  text.className = 'error-text'
  text.textContent = 'Placeholder error text.'

  const storage = new Map()
  const window = {
    location: {
      hostname: 'www.thestarters.com',
      pathname,
      search: '',
      replace() {},
    },
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    performance: { mark() {} },
    dispatchEvent() {},
    // Webflow CSS hides the banner until Memberstack sets an inline display.
    getComputedStyle: (element) => ({
      display:
        element.style.display ||
        (element.getAttribute('data-ms-message') ? 'none' : 'block'),
    }),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  const context = {
    console: { error() {}, warn() {}, info() {} },
    CustomEvent: class {
      constructor(name, init) {
        this.name = name
        this.detail = init && init.detail
      }
    },
    URL,
    URLSearchParams,
    document: dom.document,
    window,
  }
  if (withObserver) context.MutationObserver = dom.MutationObserver
  vm.createContext(context)
  vm.runInContext(source, context)
  dom.flush()

  // What Memberstack does: write the message, then show the banner. Its own
  // timer hides the banner about 7 seconds later.
  const memberstack = {
    showError(message) {
      text.textContent = message
      banner.style.display = 'block'
      dom.flush()
    },
    hideTimerFires() {
      banner.style.display = 'none'
      dom.flush()
    },
  }

  const copy = () => banner.querySelector('[data-starters-login-error-copy]')
  return { banner, copy, dom, form, google, memberstack, storage, text }
}

function visibleCopy(page) {
  const copy = page.copy()
  return copy ? copy.textContent : null
}

test('wrong email or password shows Option A with a real Forgot password link', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)

  const copy = page.copy()
  assert.ok(copy, 'copy rendered')
  assert.equal(copy.textContent, INVALID_COPY)
  assert.equal(copy.getAttribute('data-starters-login-error-copy'), 'invalid_credentials')
  assert.equal(copy.getAttribute('role'), 'alert')
  assert.equal(copy.className, 'error-text')
  const links = copy.descendants().filter((element) => element.tagName === 'A')
  assert.equal(links.length, 1)
  assert.equal(links[0].getAttribute('href'), '/forgot-password')
  assert.equal(links[0].textContent, 'Forgot password?')
  // The two sentences are separate lines.
  assert.equal(copy.children.length, 2)
  copy.children.forEach((line) => assert.equal(line.style.display, 'block'))
})

test('Memberstack text is hidden but kept verbatim for banner-text classifiers', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)

  assert.equal(page.text.textContent, INVALID)
  assert.equal(page.text.style.display, 'none')
  assert.equal(page.banner.querySelector('[data-ms-message-text]'), page.text)
})

test('Google click on a password account shows the drafted reset message', () => {
  const page = loadLoginPage()
  page.memberstack.showError(USE_EMAIL)

  const copy = page.copy()
  assert.equal(copy.textContent, USE_EMAIL_COPY)
  assert.equal(copy.getAttribute('data-starters-login-error-copy'), 'use_email_login')
  const link = copy.descendants().find((element) => element.tagName === 'A')
  assert.equal(link.getAttribute('href'), '/forgot-password')
  assert.equal(link.textContent, 'reset your password')
})

test('any other Memberstack message stays exactly as Memberstack wrote it', () => {
  const page = loadLoginPage()
  page.memberstack.showError('Too many requests. Please try again later.')

  assert.equal(page.copy(), null)
  assert.equal(page.text.style.display, '')
  assert.equal(page.text.textContent, 'Too many requests. Please try again later.')
})

test('a later unknown message replaces the copy with Memberstack text', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)
  page.memberstack.showError('Something else went wrong.')

  assert.equal(page.copy(), null)
  assert.equal(page.text.style.display, '')
})

test('copy does not render while the banner is still hidden', () => {
  const page = loadLoginPage()
  page.text.textContent = INVALID
  page.dom.flush()
  assert.equal(page.copy(), null)

  page.banner.style.display = 'block'
  page.dom.flush()
  assert.equal(visibleCopy(page), INVALID_COPY)
})

test('the message stays visible after Memberstack hide timer fires', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)
  page.memberstack.hideTimerFires()

  assert.equal(page.banner.style.display, 'block')
  assert.equal(visibleCopy(page), INVALID_COPY)
  assert.equal(page.banner.querySelectorAll('[data-starters-login-error-copy]').length, 1)
})

test('the next submit hides the old message and restores Memberstack text', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)
  page.dom.dispatch(page.form, 'submit')

  assert.equal(page.banner.style.display, 'none')
  assert.equal(page.copy(), null)
  assert.equal(page.text.style.display, '')

  // A stale Memberstack timer after the new attempt does not bring it back.
  page.memberstack.hideTimerFires()
  assert.equal(page.copy(), null)

  // The next failure renders a fresh alert.
  page.memberstack.showError(INVALID)
  assert.equal(visibleCopy(page), INVALID_COPY)
})

test('a Google click also starts a new attempt', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)
  page.dom.dispatch(page.google, 'click')

  assert.equal(page.banner.style.display, 'none')
  assert.equal(page.copy(), null)

  page.memberstack.showError(USE_EMAIL)
  assert.equal(visibleCopy(page), USE_EMAIL_COPY)
})

test('a message Memberstack shows synchronously on submit is not hidden', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)
  // Memberstack's own submit handler validates and reports in the same event.
  page.form.addEventListener('submit', () => {
    page.text.textContent = 'Please complete the captcha.'
    page.banner.style.display = 'block'
  })
  page.dom.dispatch(page.form, 'submit')

  assert.equal(page.banner.style.display, 'block')
  assert.equal(page.copy(), null)
  assert.equal(page.text.style.display, '')
  assert.equal(page.text.textContent, 'Please complete the captcha.')
})

test('a submit with no copy up leaves the banner alone', () => {
  const page = loadLoginPage()
  page.memberstack.showError('Too many requests.')
  page.dom.dispatch(page.form, 'submit')

  assert.equal(page.banner.style.display, 'block')
})

test('the login timing receipt still starts on submit', () => {
  const page = loadLoginPage()
  page.memberstack.showError(INVALID)
  page.dom.dispatch(page.form, 'submit')

  const receipt = JSON.parse(page.storage.get('thestarters:v3-auth-route-timing'))
  assert.equal(typeof receipt.startedAt, 'number')
})

test('pages other than the two login paths are left alone', () => {
  const page = loadLoginPage({ pathname: '/pricing' })
  page.memberstack.showError(INVALID)

  assert.equal(page.copy(), null)
  assert.equal(page.text.style.display, '')
})

test('without MutationObserver the Memberstack message is unchanged', () => {
  const page = loadLoginPage({ withObserver: false })
  page.memberstack.showError(INVALID)

  assert.equal(page.copy(), null)
  assert.equal(page.text.style.display, '')
})
