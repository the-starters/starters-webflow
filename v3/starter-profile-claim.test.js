const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-profile-claim.js'), 'utf8')
const WRAPPER_SELECTOR = '[data-starter-claim="wrapper"]'
const FORM_SELECTOR = 'form[data-starter-claim="form"][data-ms-form="signup"]'
const PROFILE_SLUG_FIELD_SELECTOR =
  'input[type="hidden"][data-ms-member="starter-claim-profile-slug"]'
const GOOGLE_AUTH_SELECTOR = '[data-ms-auth-provider="google"]'

function element(attributes = {}) {
  const own = Object.assign({}, attributes)
  const classes = new Set(String(own.class || '').split(/\s+/).filter(Boolean))
  const selectors = new Map()

  return {
    attributes: own,
    classList: {
      add(value) { classes.add(value) },
      contains(value) { return classes.has(value) },
      remove(value) { classes.delete(value) },
    },
    hidden: Object.prototype.hasOwnProperty.call(own, 'hidden'),
    value: '',
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(own, name) ? own[name] : null
    },
    setAttribute(name, value) {
      own[name] = String(value)
    },
    removeAttribute(name) {
      delete own[name]
    },
    querySelector(selector) {
      return selectors.get(selector) || null
    },
    setQuery(selector, value) {
      selectors.set(selector, value)
    },
  }
}

function load(options = {}) {
  const profileSlugField = options.profileSlugField === false ? null : element()
  const googleAuth = options.googleAuth === false
    ? null
    : element({ class: 'button is-google w-button', 'data-ms-auth-provider': 'google' })
  const form = options.form === false ? null : element()
  if (form && profileSlugField) {
    form.setQuery(options.fieldSelector || PROFILE_SLUG_FIELD_SELECTOR, profileSlugField)
  }

  const wrapper = options.wrapper === false
    ? null
    : element({
        class: 'claim-modal hide',
        hidden: 'hidden',
        'aria-hidden': 'true',
        'data-starter-claim': 'wrapper',
      })
  if (wrapper && form) wrapper.setQuery(FORM_SELECTOR, form)
  if (wrapper && googleAuth) wrapper.setQuery(GOOGLE_AUTH_SELECTOR, googleAuth)

  const listeners = []
  const pathname = options.pathname || '/hire/jane-doe'
  const location = {
    pathname,
    search: options.search || '',
    href: `https://www.thestarters.com${pathname}${options.search || ''}`,
  }
  const document = {
    readyState: options.readyState || 'loading',
    addEventListener(type, handler, config) {
      listeners.push({ type, handler, config })
    },
    querySelector(selector) {
      return selector === WRAPPER_SELECTOR ? wrapper : null
    },
  }

  const window = {
    document,
    location,
    STARTER_PROFILE_CLAIM_SLUGS: options.allowedSlugs || [],
  }
  vm.runInNewContext(source, { document, window })

  function dispatch(type) {
    for (const listener of [...listeners]) {
      if (listener.type !== type) continue
      listener.handler()
      if (listener.config && listener.config.once) {
        listeners.splice(listeners.indexOf(listener), 1)
      }
    }
  }

  return { dispatch, form, listeners, profileSlugField, googleAuth, wrapper, window }
}

test('keeps the wrapper hidden for a normal profile not in the allowlist', () => {
  const harness = load({ search: '?utm_source=gift' })
  harness.dispatch('DOMContentLoaded')

  assert.equal(harness.wrapper.classList.contains('hide'), true)
  assert.equal(harness.wrapper.hidden, true)
  assert.equal(harness.wrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(harness.profileSlugField.value, '')
  assert.equal(harness.googleAuth.classList.contains('hide'), true)
  assert.equal(harness.googleAuth.hidden, true)
})

test('shows the form for an allowlisted slug and puts that slug in the signup field', () => {
  const harness = load({ allowedSlugs: ['jane-doe'] })

  assert.equal(harness.wrapper.classList.contains('hide'), true)
  assert.equal(harness.wrapper.hidden, true)
  assert.equal(harness.wrapper.getAttribute('aria-hidden'), 'true')

  harness.dispatch('DOMContentLoaded')

  assert.equal(harness.profileSlugField.value, 'jane-doe')
  assert.equal(harness.profileSlugField.getAttribute('value'), 'jane-doe')
  assert.equal(harness.wrapper.classList.contains('hide'), false)
  assert.equal(harness.wrapper.hidden, false)
  assert.equal(harness.wrapper.getAttribute('hidden'), null)
  assert.equal(harness.wrapper.getAttribute('aria-hidden'), 'false')
  assert.equal(harness.googleAuth.classList.contains('hide'), true)
  assert.equal(harness.googleAuth.hidden, true)
  assert.equal(harness.googleAuth.getAttribute('hidden'), '')
  assert.equal(harness.googleAuth.getAttribute('aria-hidden'), 'true')
  assert.equal(harness.googleAuth.getAttribute('tabindex'), '-1')
})

test('uses only the profile slug when unrelated query parameters are present', () => {
  const harness = load({
    allowedSlugs: ['jane-doe'],
    search: '?utm_source=gift&utm_campaign=profile',
  })
  harness.dispatch('DOMContentLoaded')

  assert.equal(harness.profileSlugField.value, 'jane-doe')
  assert.equal(harness.window.location.search, '?utm_source=gift&utm_campaign=profile')
})

test('does not show the form for another slug even when one profile is allowlisted', () => {
  const harness = load({
    pathname: '/hire/john-smith',
    allowedSlugs: ['jane-doe'],
  })
  harness.dispatch('DOMContentLoaded')

  assert.equal(harness.wrapper.classList.contains('hide'), true)
  assert.equal(harness.profileSlugField.value, '')
})

test('fails closed for non-profile paths and non-canonical slugs', () => {
  for (const pathname of [
    '/hire',
    '/all-starters',
    '/hire/../admin',
    '/hire/jane_doe',
    '/hire/jane-doe/',
  ]) {
    const harness = load({ pathname, allowedSlugs: ['jane-doe'] })
    harness.dispatch('DOMContentLoaded')
    assert.equal(harness.wrapper.classList.contains('hide'), true, pathname)
  }
})

test('fails closed when the allowed form or slug field is not authored', () => {
  for (const options of [
    { form: false },
    { profileSlugField: false },
    { fieldSelector: '[data-ms-member="starter-claim-profile-slug"]' },
  ]) {
    const harness = load({ ...options, allowedSlugs: ['jane-doe'] })
    harness.dispatch('DOMContentLoaded')
    assert.equal(harness.wrapper.classList.contains('hide'), true)
    assert.equal(harness.wrapper.hidden, true)
    assert.equal(harness.wrapper.getAttribute('aria-hidden'), 'true')
  }
})

test('does not require the slug field on profiles outside the allowlist', () => {
  const harness = load({ profileSlugField: false })
  harness.dispatch('DOMContentLoaded')
  assert.equal(harness.wrapper.classList.contains('hide'), true)
})

test('registers one DOMContentLoaded boot while the document is loading', () => {
  const harness = load()
  assert.equal(harness.listeners.length, 1)
  assert.equal(harness.listeners[0].type, 'DOMContentLoaded')
  assert.equal(harness.listeners[0].config.once, true)
})

test('boots immediately when the document is already ready', () => {
  const harness = load({ readyState: 'complete', allowedSlugs: ['jane-doe'] })
  assert.equal(harness.listeners.length, 0)
  assert.equal(harness.wrapper.classList.contains('hide'), false)
  assert.equal(harness.wrapper.hidden, false)
  assert.equal(harness.profileSlugField.value, 'jane-doe')
})

test('keeps controller helpers private', () => {
  const harness = load({ readyState: 'complete', allowedSlugs: ['jane-doe'] })
  assert.equal(Object.prototype.hasOwnProperty.call(harness.window, 'StarterProfileClaim'), false)
})

test('second evaluation respects the global boot guard', () => {
  const harness = load()
  vm.runInNewContext(source, {
    document: harness.window.document,
    window: harness.window,
  })
  assert.equal(harness.listeners.length, 1)
})
