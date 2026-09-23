const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-profile-claim.js'), 'utf8')

const WRAPPER_SELECTOR = '[data-starter-claim="wrapper"]'
const FORM_SELECTOR = 'form[data-starter-claim="form"][data-ms-form="signup"]'
const TOKEN_FIELD_SELECTOR = '[data-ms-member="starter-claim-token"]'
const ENDPOINT =
  'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter_profile_claim/validate'
const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789_-A'

function element(attributes = {}) {
  const own = Object.assign({}, attributes)
  const classes = new Set(String(own.class || '').split(/\s+/).filter(Boolean))
  const selectors = new Map()

  return {
    attributes: own,
    classList: {
      add(value) {
        classes.add(value)
      },
      contains(value) {
        return classes.has(value)
      },
      remove(value) {
        classes.delete(value)
      },
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

function response(body, ok = true) {
  return {
    ok,
    async json() {
      return body
    },
  }
}

function load(options = {}) {
  const tokenField = options.tokenField === false ? null : element()
  const form = options.form === false ? null : element()
  if (form && tokenField) form.setQuery(TOKEN_FIELD_SELECTOR, tokenField)

  const wrapper = options.wrapper === false
    ? null
    : element({
        class: 'claim-modal hide',
        hidden: 'hidden',
        'aria-hidden': 'true',
        'data-starter-claim': 'wrapper',
        'data-starter-claim-validate-url':
          options.endpoint === undefined ? ENDPOINT : options.endpoint,
      })
  if (wrapper && form) wrapper.setQuery(FORM_SELECTOR, form)

  const listeners = []
  const warnings = []
  const requests = []
  const replacements = []
  const search = options.search === undefined ? `?claim=${TOKEN}&utm_source=qr` : options.search
  const pathname = options.pathname || '/hire/jane-doe'
  const href = `https://${options.hostname || 'the-starters-3-0.webflow.io'}${pathname}${search}`

  const document = {
    readyState: 'loading',
    addEventListener(type, handler, config) {
      listeners.push({ type, handler, config })
    },
    querySelector(selector) {
      return selector === WRAPPER_SELECTOR ? wrapper : null
    },
  }

  const window = {
    document,
    location: {
      href,
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      pathname,
      search,
    },
    history: {
      state: { preserved: true },
      replaceState(state, title, next) {
        replacements.push({ state, title, next })
      },
    },
    fetch: async (url, requestOptions) => {
      requests.push({ url, options: requestOptions })
      if (options.fetchError) throw options.fetchError
      return options.response || response({ valid: true, status: 'active', profile_path: pathname })
    },
    setTimeout,
    clearTimeout,
  }
  if (options.debug !== undefined) window.STARTERS_DEBUG = options.debug

  vm.runInNewContext(source, {
    AbortController,
    console: {
      warn(message) {
        warnings.push(String(message))
      },
    },
    document,
    URL,
    URLSearchParams,
    window,
    setTimeout,
    clearTimeout,
  })

  return {
    api: window.StarterProfileClaim,
    form,
    listeners,
    replacements,
    requests,
    tokenField,
    warnings,
    window,
    wrapper,
  }
}

test('keeps the authored hide class when there is no claim query', async () => {
  const harness = load({ search: '?utm_source=box' })
  const result = await harness.api.init()

  assert.equal(result.state, 'no_query')
  assert.equal(harness.wrapper.classList.contains('hide'), true)
  assert.equal(harness.wrapper.hidden, true)
  assert.equal(harness.wrapper.getAttribute('aria-hidden'), 'true')
  assert.equal(harness.requests.length, 0)
})

test('validates one opaque claim token and only then reveals the wrapper', async () => {
  const harness = load()
  const result = await harness.api.init()

  assert.equal(result.state, 'ready')
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0].url, ENDPOINT)
  assert.equal(harness.requests[0].options.method, 'POST')
  assert.equal(harness.requests[0].options.credentials, 'omit')
  assert.equal(harness.requests[0].options.referrerPolicy, 'no-referrer')
  assert.deepEqual(JSON.parse(harness.requests[0].options.body), {
    token: TOKEN,
    profile_path: '/hire/jane-doe',
  })
  assert.equal(harness.tokenField.value, TOKEN)
  assert.equal(harness.tokenField.getAttribute('value'), TOKEN)
  assert.equal(harness.wrapper.classList.contains('hide'), false)
  assert.equal(harness.wrapper.hidden, false)
  assert.equal(harness.wrapper.getAttribute('hidden'), null)
  assert.equal(harness.wrapper.getAttribute('aria-hidden'), 'false')
  assert.equal(harness.wrapper.getAttribute('data-starter-claim-state'), 'ready')
})

test('scrubs only the claim value after successful validation', async () => {
  const harness = load({ search: `?claim=${TOKEN}&utm_source=gift#ignored` })
  await harness.api.init()

  assert.deepEqual(harness.replacements, [
    {
      state: { preserved: true },
      title: '',
      next: '/hire/jane-doe?utm_source=gift#ignored',
    },
  ])
})

test('rejects malformed and repeated claim values without a request', async () => {
  for (const search of [
    '?claim=short',
    `?claim=${TOKEN}!`,
    `?claim=${TOKEN}&claim=${TOKEN}`,
  ]) {
    const harness = load({ search })
    const result = await harness.api.init()

    assert.equal(result.state, 'invalid_query', search)
    assert.equal(harness.requests.length, 0, search)
    assert.equal(harness.wrapper.classList.contains('hide'), true, search)
  }
})

test('requires the exact hire profile path returned by Xano', async () => {
  const harness = load({
    response: response({ valid: true, status: 'active', profile_path: '/hire/someone-else' }),
  })
  const result = await harness.api.init()

  assert.equal(result.state, 'unavailable')
  assert.equal(harness.wrapper.classList.contains('hide'), true)
  assert.equal(harness.tokenField.value, '')
  assert.equal(harness.replacements.length, 1)
})

test('keeps expired, used, and revoked claims closed', async () => {
  for (const status of ['expired', 'claimed', 'revoked']) {
    const harness = load({ response: response({ valid: false, status }) })
    const result = await harness.api.init()

    assert.equal(result.state, 'unavailable', status)
    assert.equal(harness.wrapper.classList.contains('hide'), true, status)
    assert.equal(harness.tokenField.value, '', status)
  }
})

test('keeps the wrapper closed on request and response failures', async () => {
  const cases = [
    { fetchError: new Error('offline') },
    { response: response({}, false) },
    { response: { ok: true, async json() { throw new Error('bad json') } } },
  ]

  for (const options of cases) {
    const harness = load(options)
    const result = await harness.api.init()
    assert.equal(result.state, 'unavailable')
    assert.equal(harness.wrapper.classList.contains('hide'), true)
  }
})

test('fails closed when the form or token field is not authored', async () => {
  for (const options of [{ form: false }, { tokenField: false }]) {
    const harness = load(options)
    const result = await harness.api.init()
    assert.equal(result.state, 'misconfigured')
    assert.equal(harness.requests.length, 0)
    assert.equal(harness.wrapper.classList.contains('hide'), true)
  }
})

test('accepts only the fixed Xano origin and claim endpoint namespace', async () => {
  for (const endpoint of [
    'https://evil.example/api:KZf7nFnk/starter_profile_claim/validate',
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/other/validate',
    ENDPOINT + '?forward=evil',
    '//x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter_profile_claim/validate',
  ]) {
    const harness = load({ endpoint })
    const result = await harness.api.init()
    assert.equal(result.state, 'misconfigured', endpoint)
    assert.equal(harness.requests.length, 0, endpoint)
  }
})

test('rejects non-profile routes before sending the capability', async () => {
  for (const pathname of ['/hire', '/all-starters', '/hire/../admin', '/hire/jane_doe']) {
    const harness = load({ pathname })
    const result = await harness.api.init()
    assert.equal(result.state, 'misconfigured', pathname)
    assert.equal(harness.requests.length, 0, pathname)
  }
})

test('registers one DOMContentLoaded boot while the document is loading', () => {
  const harness = load({ search: '' })
  assert.equal(harness.listeners.length, 1)
  assert.equal(harness.listeners[0].type, 'DOMContentLoaded')
  assert.equal(harness.listeners[0].config.once, true)
})

test('second evaluation respects the global boot guard', () => {
  const harness = load({ search: '' })
  vm.runInNewContext(source, {
    AbortController,
    console,
    document: harness.window.document,
    URL,
    URLSearchParams,
    window: harness.window,
    setTimeout,
    clearTimeout,
  })
  assert.equal(harness.listeners.length, 1)
})
