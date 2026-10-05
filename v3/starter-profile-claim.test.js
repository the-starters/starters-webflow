const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-profile-claim.js'), 'utf8')
const WRAPPER_SELECTOR = '[data-starter-claim="wrapper"]'
const FORM_SELECTOR = 'form[data-starter-claim="form"]'
const PROFILE_SLUG_FIELD_SELECTOR =
  'input[type="hidden"][name="Profile Slug"][data-starter-claim="profile-slug"]'
const GOOGLE_AUTH_SELECTOR = '[data-ms-auth-provider="google"]'

function matchesSelector(node, selector) {
  const tagMatch = /^[a-z]+/i.exec(selector)
  if (tagMatch && node.tagName !== tagMatch[0].toLowerCase()) return false

  const attributes = node.attributes || {}
  const pattern = /\[([^\]=]+)(?:="([^"]*)")?\]/g
  let match
  while ((match = pattern.exec(selector)) !== null) {
    const name = match[1]
    if (!Object.prototype.hasOwnProperty.call(attributes, name)) return false
    if (match[2] !== undefined && String(attributes[name]) !== match[2]) return false
  }

  return true
}

function element(attributes = {}, tagName = '') {
  const own = Object.assign({}, attributes)
  const classes = new Set(String(own.class || '').split(/\s+/).filter(Boolean))
  const selectors = new Map()
  const children = []
  const handlers = {}

  return {
    addEventListener(type, handler) {
      (handlers[type] = handlers[type] || []).push(handler)
    },
    fire(type, event) {
      for (const handler of handlers[type] || []) handler(event)
    },
    handlerCount(type) {
      return (handlers[type] || []).length
    },
    attributes: own,
    tagName: tagName.toLowerCase(),
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
      if (selectors.has(selector)) return selectors.get(selector)
      for (const child of children) {
        if (matchesSelector(child, selector)) return child
        const descendant = child.querySelector(selector)
        if (descendant) return descendant
      }
      return null
    },
    appendChild(child) {
      children.push(child)
    },
    setQuery(selector, value) {
      selectors.set(selector, value)
    },
  }
}

function jsonResponse(body, status = 200) {
  return { status, json: () => Promise.resolve(body) }
}

function load(options = {}) {
  const defaultProfileSlugFieldAttributes = {
    type: 'hidden',
    name: 'Profile Slug',
    'data-starter-claim': 'profile-slug',
  }
  const profileSlugField = options.profileSlugField === false
    ? null
    : element(options.profileSlugFieldAttributes || defaultProfileSlugFieldAttributes, 'input')
  const googleAuth = options.googleAuth === false
    ? null
    : element({ class: 'button is-google w-button', 'data-ms-auth-provider': 'google' }, 'a')
  const form = options.form === false
    ? null
    : element(Object.assign({ 'data-starter-claim': 'form' }, options.formAttributes || {}), 'form')
  if (form && profileSlugField) {
    form.appendChild(profileSlugField)
  }
  if (form && googleAuth) {
    form.appendChild(googleAuth)
  }

  const wrapper = options.wrapper === false
    ? null
    : element({
        class: 'claim-modal hide',
        hidden: 'hidden',
        'aria-hidden': 'true',
        'data-starter-claim': 'wrapper',
      }, 'section')
  if (wrapper && form) wrapper.appendChild(form)

  const listeners = []
  const requests = []
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
  const timers = []
  const window = {
    document,
    location,
    fetch: options.fetch || ((url) => {
      requests.push(String(url))
      return Promise.resolve(jsonResponse({
        schema: 'starter_profile_claim_status_v3',
        slug: 'jane-doe',
        claimable: true,
      }))
    }),
    setTimeout(fn, delay) {
      timers.push({ fn, delay })
      return timers.length
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true
    },
    AbortController: options.AbortController,
  }
  vm.runInNewContext(source, { document, window, Promise, URL, encodeURIComponent })

  async function dispatch(type) {
    for (const listener of [...listeners]) {
      if (listener.type !== type) continue
      listener.handler()
      if (listener.config && listener.config.once) {
        listeners.splice(listeners.indexOf(listener), 1)
      }
    }
    await settle()
  }

  return { dispatch, form, listeners, profileSlugField, googleAuth, wrapper, window, requests, timers }
}

async function settle(times = 8) {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

function assertHidden(harness) {
  assert.equal(harness.wrapper.classList.contains('hide'), true)
  assert.equal(harness.wrapper.hidden, true)
  assert.equal(harness.wrapper.getAttribute('aria-hidden'), 'true')
}

test('claimable true reveals the plain Webflow form and puts the page slug in the hidden field', async () => {
  const harness = load({ search: '?utm_source=gift' })

  assertHidden(harness)
  await harness.dispatch('DOMContentLoaded')

  assert.equal(harness.requests.length, 1)
  assert.equal(
    harness.requests[0],
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/profile/starter/claim-status/v3?slug=jane-doe',
  )
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
  assert.equal(harness.window.location.search, '?utm_source=gift')
})

function clickOn(button) {
  const event = { target: { closest: () => button }, defaultPrevented: false }
  event.preventDefault = () => { event.defaultPrevented = true }
  return event
}

function componentButton(attributes = { type: 'button' }) {
  return element(attributes, 'button')
}

test('a type=button component click becomes one native submit after reveal', async () => {
  const harness = load()
  let submits = 0
  harness.form.requestSubmit = () => { submits += 1 }
  await harness.dispatch('DOMContentLoaded')

  const event = clickOn(componentButton())
  harness.form.fire('click', event)
  assert.equal(submits, 1)
  assert.equal(event.defaultPrevented, true)
  assert.equal(harness.form.getAttribute('data-starter-claim-submit-bound'), '')
})

test('submit binding ignores native submits, non-buttons, and disabled buttons', async () => {
  const harness = load()
  let submits = 0
  harness.form.requestSubmit = () => { submits += 1 }
  await harness.dispatch('DOMContentLoaded')

  const disabled = componentButton()
  disabled.disabled = true
  for (const event of [
    clickOn(componentButton({ type: 'submit' })),
    clickOn(null),
    clickOn(disabled),
    { target: null, preventDefault() { throw new Error('should not prevent') } },
  ]) {
    harness.form.fire('click', event)
  }
  assert.equal(submits, 0)
})

test('submit binding falls back to the native submit input without requestSubmit', async () => {
  const harness = load()
  let clicks = 0
  const nativeSubmit = element({ type: 'submit' }, 'input')
  nativeSubmit.click = () => { clicks += 1 }
  harness.form.setQuery('input[type="submit"], button[type="submit"]', nativeSubmit)
  await harness.dispatch('DOMContentLoaded')

  harness.form.fire('click', clickOn(componentButton()))
  assert.equal(clicks, 1)
})

test('submit binding is not added when the profile is not claimable', async () => {
  const harness = load({
    fetch: () => Promise.resolve(jsonResponse({
      schema: 'starter_profile_claim_status_v3',
      slug: 'jane-doe',
      claimable: false,
    })),
  })
  await harness.dispatch('DOMContentLoaded')
  assert.equal(harness.form.handlerCount('click'), 0)
  assert.equal(harness.form.getAttribute('data-starter-claim-submit-bound'), null)
})

test('form with data-ms-form stays hidden without a request', async () => {
  let calls = 0
  const harness = load({
    formAttributes: { 'data-ms-form': 'signup' },
    fetch: () => {
      calls += 1
      return Promise.resolve(jsonResponse({
        schema: 'starter_profile_claim_status_v3',
        slug: 'jane-doe',
        claimable: true,
      }))
    },
  })
  await harness.dispatch('DOMContentLoaded')
  assertHidden(harness)
  assert.equal(harness.profileSlugField.value, '')
  assert.equal(calls, 0)
})

test('claimable false keeps the form hidden', async () => {
  const harness = load({
    fetch: () => Promise.resolve(jsonResponse({
      schema: 'starter_profile_claim_status_v3',
      slug: 'jane-doe',
      claimable: false,
    })),
  })
  await harness.dispatch('DOMContentLoaded')
  assertHidden(harness)
  assert.equal(harness.profileSlugField.value, '')
})

test('network error keeps the form hidden', async () => {
  const harness = load({ fetch: () => Promise.reject(new Error('offline')) })
  await harness.dispatch('DOMContentLoaded')
  assertHidden(harness)
})

test('timeout keeps the form hidden', async () => {
  const harness = load({ fetch: () => new Promise(() => {}) })
  await harness.dispatch('DOMContentLoaded')

  assert.equal(harness.timers.length, 1)
  assert.equal(harness.timers[0].delay, 8000)
  harness.timers[0].fn()
  await settle()

  assertHidden(harness)
  assert.equal(harness.profileSlugField.value, '')
})

test('wrong slug keeps the form hidden', async () => {
  const harness = load({
    fetch: () => Promise.resolve(jsonResponse({
      schema: 'starter_profile_claim_status_v3',
      slug: 'john-smith',
      claimable: true,
    })),
  })
  await harness.dispatch('DOMContentLoaded')
  assertHidden(harness)
})

test('wrong schema keeps the form hidden', async () => {
  const harness = load({
    fetch: () => Promise.resolve(jsonResponse({
      schema: 'starter_profile_claim_status_v2',
      slug: 'jane-doe',
      claimable: true,
    })),
  })
  await harness.dispatch('DOMContentLoaded')
  assertHidden(harness)
})

test('non-200 and bad JSON keep the form hidden', async () => {
  for (const fetch of [
    () => Promise.resolve(jsonResponse({ ok: true }, 500)),
    () => Promise.resolve({ status: 200, json: () => Promise.reject(new Error('bad json')) }),
  ]) {
    const harness = load({ fetch })
    await harness.dispatch('DOMContentLoaded')
    assertHidden(harness)
  }
})

test('no wrapper means no request', async () => {
  let calls = 0
  const harness = load({ wrapper: false, fetch: () => { calls += 1; return Promise.resolve(jsonResponse({})) } })
  await harness.dispatch('DOMContentLoaded')
  assert.equal(calls, 0)
})

test('fails closed for non-profile paths and non-canonical slugs without a request', async () => {
  for (const pathname of [
    '/hire',
    '/all-starters',
    '/hire/../admin',
    '/hire/jane_doe',
    '/hire/jane-doe/',
  ]) {
    let calls = 0
    const harness = load({ pathname, fetch: () => { calls += 1; return Promise.resolve(jsonResponse({})) } })
    await harness.dispatch('DOMContentLoaded')
    assertHidden(harness)
    assert.equal(calls, 0, pathname)
  }
})

test('fails closed when the form or slug field is not authored', async () => {
  for (const options of [
    { form: false },
    { profileSlugField: false },
    {
      profileSlugFieldAttributes: {
        type: 'hidden',
        'data-starter-claim': 'profile-slug',
      },
    },
    {
      profileSlugFieldAttributes: {
        type: 'hidden',
        name: 'Profile slug',
        'data-starter-claim': 'profile-slug',
      },
    },
    {
      profileSlugFieldAttributes: {
        type: 'hidden',
        name: 'Profile Slug',
        'data-ms-member': 'starter-claim-profile-slug',
      },
    },
  ]) {
    let calls = 0
    const harness = load({ ...options, fetch: () => { calls += 1; return Promise.resolve(jsonResponse({})) } })
    await harness.dispatch('DOMContentLoaded')
    assertHidden(harness)
    assert.equal(calls, 0)
  }
})

test('registers one DOMContentLoaded boot while the document is loading', () => {
  const harness = load()
  assert.equal(harness.listeners.length, 1)
  assert.equal(harness.listeners[0].type, 'DOMContentLoaded')
  assert.equal(harness.listeners[0].config.once, true)
})

test('boots immediately when the document is already ready', async () => {
  const harness = load({ readyState: 'complete' })
  await settle()
  assert.equal(harness.listeners.length, 0)
  assert.equal(harness.wrapper.classList.contains('hide'), false)
  assert.equal(harness.wrapper.hidden, false)
  assert.equal(harness.profileSlugField.value, 'jane-doe')
})

test('keeps controller helpers private', async () => {
  const harness = load({ readyState: 'complete' })
  await settle()
  assert.equal(Object.prototype.hasOwnProperty.call(harness.window, 'StarterProfileClaim'), false)
})

test('second evaluation respects the global boot guard', () => {
  const harness = load()
  vm.runInNewContext(source, {
    document: harness.window.document,
    window: harness.window,
    Promise,
    URL,
    encodeURIComponent,
  })
  assert.equal(harness.listeners.length, 1)
})
