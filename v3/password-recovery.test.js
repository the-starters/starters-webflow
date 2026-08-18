const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./password-recovery.js'), 'utf8')

function element(attributes = {}) {
  const own = Object.assign({}, attributes)
  return {
    textContent: '',
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(own, name) ? own[name] : null
    },
    removeAttribute(name) {
      delete own[name]
    },
    setAttribute(name, value) {
      own[name] = String(value)
    },
  }
}

function formWithEmail(email, options = {}) {
  const input = { value: email }
  const listeners = []
  const form = element({ 'data-ms-form': 'forgot-password' })
  form.querySelector = (selector) =>
    selector === '[data-ms-member="email"]' ? input : null
  form.addEventListener = (type, handler, settings) => {
    listeners.push({ type, handler, settings })
  }
  form.checkValidity = () => (options.valid === false ? false : true)
  form.submit = () => {
    listeners
      .filter((listener) => listener.type === 'submit')
      .forEach((listener) => listener.handler({ type: 'submit' }))
  }
  return { form, input }
}

function load(options = {}) {
  const storage = options.storage || new Map()
  const listeners = []
  const selectors = Object.assign({}, options.selectors)
  if (options.storedOrigin) {
    storage.set('thestarters:v3-password-origin', options.storedOrigin)
  }

  const location = {
    hostname: options.hostname || 'the-starters-3-0.webflow.io',
    pathname: options.pathname || '/forgot-password',
    search: options.search || '',
    hash: options.hash || '',
    replace(value) {
      location.replaced = value
    },
  }
  const document = {
    readyState: options.readyState || 'complete',
    addEventListener(type, handler, settings) {
      listeners.push({ type, handler, settings })
    },
    querySelectorAll(selector) {
      return selectors[selector] || []
    },
  }
  const window = {
    URLSearchParams,
    document,
    location,
    sessionStorage: {
      getItem(key) {
        if (options.storageFailure === 'get') throw new Error('blocked')
        return storage.get(key) || null
      },
      setItem(key, value) {
        if (options.storageFailure === 'set') throw new Error('blocked')
        storage.set(key, String(value))
      },
      removeItem(key) {
        if (options.storageFailure === 'remove') throw new Error('blocked')
        storage.delete(key)
      },
    },
  }
  if (options.booted) window.__startersV3PasswordRecoveryBooted = true

  vm.runInNewContext(source, {
    URLSearchParams,
    document,
    window,
  })

  return {
    api: window.StartersV3PasswordRecovery,
    document,
    listeners,
    location,
    selectors,
    storage,
    window,
  }
}

test('legacy Talent reset redirect preserves the raw token query and hash', () => {
  const { location } = load({
    pathname: '/starters-reset-password',
    search: '?token=a%2Bb%2Fz&return=%2Fstarter-dashboard',
    hash: '#reset',
  })

  assert.equal(
    location.replaced,
    '/reset-password?token=a%2Bb%2Fz&return=%2Fstarter-dashboard&from=talent#reset',
  )
})

test('legacy redirects cover Talent pages, stale singular success, and Brand typo', () => {
  const cases = [
    ['/starters-forgot-password', '/forgot-password?from=talent'],
    ['/starters-password-success', '/password-success?from=talent'],
    ['/starter-password-success', '/password-success?from=talent'],
    ['/password-sucess', '/password-success?from=brand'],
  ]

  for (const [pathname, expected] of cases) {
    const { location } = load({ pathname })
    assert.equal(location.replaced, expected, pathname)
  }
})

test('canonical and legacy paths tolerate a trailing slash', () => {
  const legacy = load({ pathname: '/starters-forgot-password/' })
  assert.equal(legacy.location.replaced, '/forgot-password?from=talent')

  const form = element({ 'data-ms-form': 'forgot-password' })
  load({
    pathname: '/forgot-password/',
    search: '?from=talent',
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  assert.equal(form.getAttribute('redirect'), '/reset-password?from=talent')
})

test('existing from query is retained without reserializing the query string', () => {
  const { api } = load({ hostname: 'example.com' })

  assert.equal(api.appendOrigin('?token=a%20b&from=talent', 'talent'), '?token=a%20b&from=talent')
  assert.equal(api.appendOrigin('?token=a+b', 'talent'), '?token=a+b&from=talent')
})

test('unapproved hosts expose helpers but do not redirect or configure forms', () => {
  const form = element({ 'data-ms-form': 'forgot-password' })
  const selector = 'form[data-ms-form="forgot-password"]'
  const { api, location } = load({
    hostname: 'example.com',
    pathname: '/starters-forgot-password',
    selectors: { [selector]: [form] },
  })

  assert.ok(api)
  assert.equal(location.replaced, undefined)
  assert.equal(form.getAttribute('redirect'), null)
})

test('Brand and Talent login pages point their forgot links at the canonical page', () => {
  const selector =
    'a[href="/forgot-password"], a[href="/starters-forgot-password"], a[href="/legacy-starters-forgot-password"]'

  const brandLink = element({ href: '/forgot-password' })
  load({
    pathname: '/login',
    selectors: { [selector]: [brandLink] },
  })
  assert.equal(brandLink.getAttribute('href'), '/forgot-password?from=brand')

  const talentLink = element({ href: '/legacy-starters-forgot-password' })
  load({
    pathname: '/starter-login',
    selectors: { [selector]: [talentLink] },
  })
  assert.equal(talentLink.getAttribute('href'), '/forgot-password?from=talent')
})

test('canonical forgot form keeps Brand origin in both redirect attributes', () => {
  const form = element({ 'data-ms-form': 'forgot-password' })
  const selector = 'form[data-ms-form="forgot-password"]'
  const { storage } = load({
    pathname: '/forgot-password',
    search: '?from=brand',
    selectors: { [selector]: [form] },
  })

  assert.equal(form.getAttribute('redirect'), '/reset-password?from=brand')
  assert.equal(form.getAttribute('data-redirect'), '/reset-password?from=brand')
  assert.equal(storage.get('thestarters:v3-password-origin'), 'brand')
})

test('canonical reset form keeps Talent origin through success', () => {
  const form = element({ 'data-ms-form': 'reset-password' })
  const selector = 'form[data-ms-form="reset-password"]'
  load({
    pathname: '/reset-password',
    search: '?token=abc&from=talent',
    selectors: { [selector]: [form] },
  })

  assert.equal(form.getAttribute('redirect'), '/password-success?from=talent')
  assert.equal(form.getAttribute('data-redirect'), '/password-success?from=talent')
})

test('canonical forms use canonical destinations when origin is unavailable', () => {
  const forgot = element({ 'data-ms-form': 'forgot-password' })
  load({
    pathname: '/forgot-password',
    selectors: {
      'form[data-ms-form="forgot-password"]': [forgot],
    },
  })
  assert.equal(forgot.getAttribute('redirect'), '/reset-password')

  const reset = element({ 'data-ms-form': 'reset-password' })
  load({
    pathname: '/reset-password',
    selectors: {
      'form[data-ms-form="reset-password"]': [reset],
    },
  })
  assert.equal(reset.getAttribute('redirect'), '/password-success')
})

test('native login choices show only the matching origin', () => {
  const brand = element({ 'data-password-recovery-login': 'brand' })
  const talent = element({ 'data-password-recovery-login': 'talent' })
  const selector = '[data-password-recovery-login]'
  load({
    pathname: '/password-success',
    search: '?from=talent',
    selectors: { [selector]: [brand, talent] },
  })

  assert.equal(brand.getAttribute('href'), '/login')
  assert.equal(brand.getAttribute('hidden'), '')
  assert.equal(talent.getAttribute('href'), '/starter-login')
  assert.equal(talent.getAttribute('hidden'), null)
})

test('native login choices both remain visible when origin is unavailable', () => {
  const brand = element({
    'data-password-recovery-login': 'brand',
    hidden: '',
  })
  const talent = element({
    'data-password-recovery-login': 'talent',
    hidden: '',
  })
  const selector = '[data-password-recovery-login]'
  load({
    pathname: '/password-success',
    selectors: { [selector]: [brand, talent] },
  })

  assert.equal(brand.getAttribute('href'), '/login')
  assert.equal(brand.getAttribute('hidden'), null)
  assert.equal(talent.getAttribute('href'), '/starter-login')
  assert.equal(talent.getAttribute('hidden'), null)
})

test('compatibility fallback rewrites existing login links for a known origin', () => {
  const brandLink = element({ href: '/login' })
  const talentLink = element({ href: '/starter-login' })
  const selector = 'a[href="/login"], a[href="/starter-login"]'
  load({
    pathname: '/reset-password',
    search: '?from=talent',
    selectors: { [selector]: [brandLink, talentLink] },
  })

  assert.equal(brandLink.getAttribute('href'), '/starter-login')
  assert.equal(talentLink.getAttribute('href'), '/starter-login')
})

test('compatibility fallback is neutral when origin is unavailable', () => {
  const loginLink = element({ href: '/login' })
  const selector = 'a[href="/login"], a[href="/starter-login"]'
  load({
    pathname: '/password-success',
    selectors: { [selector]: [loginLink] },
  })

  assert.equal(loginLink.getAttribute('href'), '/')
  assert.equal(loginLink.getAttribute('aria-label'), 'Return to homepage')
  assert.equal(loginLink.textContent, 'Return to homepage')
})

test('neutral fallback updates the visible Webflow button label without overlay text', () => {
  const visibleLabel = { textContent: 'Back to Login' }
  const loginLink = element({ href: '/login' })
  loginLink.closest = () => ({
    querySelector() {
      return visibleLabel
    },
  })
  const selector = 'a[href="/login"], a[href="/starter-login"]'
  load({
    pathname: '/password-success',
    selectors: { [selector]: [loginLink] },
  })

  assert.equal(loginLink.getAttribute('href'), '/')
  assert.equal(loginLink.getAttribute('aria-label'), 'Return to homepage')
  assert.equal(loginLink.textContent, '')
  assert.equal(visibleLabel.textContent, 'Return to homepage')
})

test('retry links return to canonical forgot page with origin', () => {
  const link = element({ href: '/starters-forgot-password' })
  const selector =
    '[data-password-recovery-retry], a[href="/forgot-password"], a[href="/starters-forgot-password"]'
  load({
    pathname: '/reset-password',
    search: '?from=talent',
    selectors: { [selector]: [link] },
  })

  assert.equal(link.getAttribute('href'), '/forgot-password?from=talent')
})

test('stored origin survives canonical navigation and storage failures are safe', () => {
  const { api } = load({
    hostname: 'example.com',
    pathname: '/password-success',
    storedOrigin: 'talent',
  })
  assert.equal(api.originFor('/password-success', ''), 'talent')

  const failed = load({
    hostname: 'example.com',
    pathname: '/password-success',
    storedOrigin: 'talent',
    storageFailure: 'get',
  })
  assert.equal(failed.api.originFor('/password-success', ''), null)
})

test('invalid origins are ignored and never stored', () => {
  const { api, storage } = load({
    pathname: '/forgot-password',
    search: '?from=admin',
  })

  assert.equal(api.validOrigin('admin'), null)
  assert.equal(api.queryOrigin('?from=admin'), null)
  assert.equal(storage.has('thestarters:v3-password-origin'), false)
})

test('loading documents receive a second idempotent pass at DOMContentLoaded', () => {
  const selector = 'form[data-ms-form="forgot-password"]'
  const loaded = load({
    pathname: '/forgot-password',
    search: '?from=talent',
    readyState: 'loading',
    selectors: { [selector]: [] },
  })
  const form = element({ 'data-ms-form': 'forgot-password' })
  loaded.selectors[selector] = [form]

  assert.equal(loaded.listeners.length, 1)
  loaded.listeners[0].handler()
  assert.equal(form.getAttribute('redirect'), '/reset-password?from=talent')
})

test('boot guard makes a second evaluation a complete no-op', () => {
  const result = load({ booted: true })

  assert.equal(result.api, undefined)
  assert.equal(result.location.replaced, undefined)
})

test('Reset Password shows the Recovery Email Hint from Forgot Password submit', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    search: '?from=brand',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  const reset = element({ 'data-ms-form': 'reset-password' })
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      'form[data-ms-form="reset-password"]': [reset],
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(surface.textContent, 'ada@example.com')
  assert.equal(reset.getAttribute('redirect'), '/password-success?from=brand')
})

test('Reset Password keeps generic copy when no Recovery Email Hint exists', () => {
  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  const reset = element({ 'data-ms-form': 'reset-password' })
  load({
    pathname: '/reset-password',
    selectors: {
      'form[data-ms-form="reset-password"]': [reset],
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(surface.textContent, 'an email')
  assert.equal(reset.getAttribute('redirect'), '/password-success')
})

test('typing on Forgot Password without submit does not create a Recovery Email Hint', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(surface.textContent, 'an email')
})

test('invalid Forgot Password submit does not create a Recovery Email Hint', () => {
  const storage = new Map()
  const { form } = formWithEmail('not-an-email', { valid: false })
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(surface.textContent, 'an email')
})

test('Forgot Password redirect does not put the Recovery Email Hint in the URL', () => {
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    search: '?from=brand',
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  assert.equal(form.getAttribute('redirect'), '/reset-password?from=brand')
  assert.equal(form.getAttribute('data-redirect'), '/reset-password?from=brand')
})

test('Reset Password keeps generic copy when Recovery Email Hint storage fails', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    storage,
    storageFailure: 'set',
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  const reset = element({ 'data-ms-form': 'reset-password' })
  load({
    pathname: '/reset-password',
    storage,
    storageFailure: 'get',
    selectors: {
      'form[data-ms-form="reset-password"]': [reset],
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(surface.textContent, 'an email')
  assert.equal(reset.getAttribute('redirect'), '/password-success')
  assert.equal(reset.getAttribute('data-redirect'), '/password-success')
})

test('Reset Password updates the authored Recovery Email Hint text node', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const textNode = { nodeType: 3, nodeValue: 'an email' }
  const surface = element({ 'data-password-recovery-email': '' })
  surface.firstChild = textNode
  surface.textContent = 'an email'
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(textNode.nodeValue, 'ada@example.com')
  assert.equal(surface.textContent, 'an email')
})

test('Reset Password shows a mistyped Recovery Email Hint', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@gmial.com')
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(surface.textContent, 'ada@gmial.com')
})

test('Forgot Password email is filled from the Recovery Email Hint', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    search: '?from=talent',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const retryInput = { value: '' }
  const retryForm = element({ 'data-ms-form': 'forgot-password' })
  retryForm.querySelector = (selector) =>
    selector === '[data-ms-member="email"]' ? retryInput : null
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [retryForm],
    },
  })

  assert.equal(retryInput.value, 'ada@example.com')
})

test('a second Forgot Password submit replaces the Recovery Email Hint', () => {
  const storage = new Map()
  const first = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [first.form],
    },
  })
  first.form.submit()

  const second = formWithEmail('')
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [second.form],
    },
  })
  assert.equal(second.input.value, 'ada@example.com')
  second.input.value = 'ada@thestarters.com'
  second.form.submit()

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(surface.textContent, 'ada@thestarters.com')
})

test('abandoning Forgot Password without a new submit keeps the Recovery Email Hint', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const retryInput = { value: '' }
  const retryForm = element({ 'data-ms-form': 'forgot-password' })
  retryForm.querySelector = (selector) =>
    selector === '[data-ms-member="email"]' ? retryInput : null
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [retryForm],
    },
  })

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(retryInput.value, 'ada@example.com')
  assert.equal(surface.textContent, 'ada@example.com')
})

test('Password Success clears the Recovery Email Hint', () => {
  const storage = new Map()
  const { form } = formWithEmail('ada@example.com')
  load({
    pathname: '/forgot-password',
    storage,
    selectors: {
      'form[data-ms-form="forgot-password"]': [form],
    },
  })
  form.submit()

  const successSurface = element({ 'data-password-recovery-email': '' })
  successSurface.textContent = 'an email'
  load({
    pathname: '/password-success',
    storage,
    selectors: {
      '[data-password-recovery-email]': [successSurface],
    },
  })

  const surface = element({ 'data-password-recovery-email': '' })
  surface.textContent = 'an email'
  const reset = element({ 'data-ms-form': 'reset-password' })
  load({
    pathname: '/reset-password',
    storage,
    selectors: {
      'form[data-ms-form="reset-password"]': [reset],
      '[data-password-recovery-email]': [surface],
    },
  })

  assert.equal(successSurface.textContent, 'an email')
  assert.equal(surface.textContent, 'an email')
  assert.equal(reset.getAttribute('redirect'), '/password-success')
})
