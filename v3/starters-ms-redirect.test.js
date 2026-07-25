const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starters-ms-redirect.js'), 'utf8')

const MARKER = 'starters-ms-redirect'
const FORM_SELECTOR = 'form[data-ms-form="signup"]'
const MARKER_SELECTOR = `[${MARKER}]`

function element(attributes = {}) {
  const own = Object.assign({}, attributes)
  return {
    attributes: own,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(own, name) ? own[name] : null
    },
    setAttribute(name, value) {
      own[name] = String(value)
    },
  }
}

function signupForm(attributes = {}) {
  return element(Object.assign({ 'data-ms-form': 'signup' }, attributes))
}

/**
 * Loads the module against a stubbed document/window.
 *
 * options.forms      — signup form elements returned by the form selector
 * options.markers    — elements returned by the marker selector
 * options.hostname   — window.location.hostname (default: staging)
 * options.readyState — document.readyState (default: 'complete')
 * options.debug      — window.STARTERS_DEBUG
 * options.booted     — pre-set the boot guard
 */
function load(options = {}) {
  const state = {
    forms: options.forms || [],
    markers: options.markers || [],
  }
  const warnings = []
  const listeners = []

  const document = {
    readyState: options.readyState || 'complete',
    addEventListener(type, handler, opts) {
      listeners.push({ type, handler, opts })
    },
    querySelectorAll(selector) {
      if (selector === FORM_SELECTOR) return state.forms
      if (selector === MARKER_SELECTOR) return state.markers
      return []
    },
    querySelector(selector) {
      return document.querySelectorAll(selector)[0] || null
    },
  }

  const window = {
    location: { hostname: options.hostname || 'the-starters-3-0.webflow.io' },
    document,
  }
  if (options.debug !== undefined) window.STARTERS_DEBUG = options.debug
  if (options.booted) window.__startersMsRedirectBooted = true

  vm.runInNewContext(source, {
    console: {
      warn(message) {
        warnings.push(String(message))
      },
    },
    document,
    window,
  })

  function fireDomContentLoaded() {
    listeners
      .filter((entry) => entry.type === 'DOMContentLoaded')
      .forEach((entry) => entry.handler())
  }

  return { api: window.StartersMsRedirect, state, warnings, window, listeners, fireDomContentLoaded }
}

test('writes the page marker value onto the signup form as redirect and data-redirect', () => {
  const form = signupForm()
  const target = '/hire/some-slug?modal-id=signup-modal&src=marker'
  const { warnings } = load({
    forms: [form],
    markers: [element({ [MARKER]: target })],
  })

  assert.equal(form.getAttribute('redirect'), target)
  assert.equal(form.getAttribute('data-redirect'), target)
  assert.deepEqual(warnings, [])
})

test('applies the marker to every signup form on the page', () => {
  const first = signupForm()
  const second = signupForm()
  load({
    forms: [first, second],
    markers: [element({ [MARKER]: '/hire/a?modal-id=signup-modal' })],
  })

  assert.equal(first.getAttribute('redirect'), '/hire/a?modal-id=signup-modal')
  assert.equal(second.getAttribute('redirect'), '/hire/a?modal-id=signup-modal')
})

test('uses the first marker element when a page carries several', () => {
  const form = signupForm()
  load({
    forms: [form],
    markers: [
      element({ [MARKER]: '/first?modal-id=signup-modal' }),
      element({ [MARKER]: '/second?modal-id=signup-modal' }),
    ],
  })

  assert.equal(form.getAttribute('redirect'), '/first?modal-id=signup-modal')
})

test('a marker on the form itself wins over the page marker', () => {
  const form = signupForm({ [MARKER]: '/form-level?modal-id=signup-modal' })
  load({
    forms: [form],
    markers: [element({ [MARKER]: '/page-level?modal-id=signup-modal' })],
  })

  assert.equal(form.getAttribute('redirect'), '/form-level?modal-id=signup-modal')
  assert.equal(form.getAttribute('data-redirect'), '/form-level?modal-id=signup-modal')
})

test('an existing non-empty redirect attribute is never overwritten', () => {
  const form = signupForm({ redirect: '/author-choice' })
  load({
    forms: [form],
    markers: [element({ [MARKER]: '/hire/some-slug?modal-id=signup-modal' })],
  })

  assert.equal(form.getAttribute('redirect'), '/author-choice')
  assert.equal(form.getAttribute('data-redirect'), null)
})

test('a blank redirect attribute is treated as absent', () => {
  const form = signupForm({ redirect: '   ' })
  load({
    forms: [form],
    markers: [element({ [MARKER]: '/hire/some-slug?modal-id=signup-modal' })],
  })

  assert.equal(form.getAttribute('redirect'), '/hire/some-slug?modal-id=signup-modal')
})

test('rejects values that are not root-relative same-origin paths', () => {
  for (const value of [
    'https://evil.example/steal',
    '//evil.example/steal',
    '/\\evil.example/steal',
    'hire/some-slug',
    '?modal-id=signup-modal',
  ]) {
    const form = signupForm()
    const { warnings } = load({
      forms: [form],
      markers: [element({ [MARKER]: value })],
    })

    assert.equal(form.getAttribute('redirect'), null, `should reject ${value}`)
    assert.equal(form.getAttribute('data-redirect'), null, `should reject ${value}`)
    assert.equal(warnings.length, 1, `should warn once for ${value}`)
    assert.match(
      warnings[0],
      /ignoring starters-ms-redirect value/,
      `should warn about an invalid value for ${value}`,
    )
  }
})

test('rejects values containing ASCII control characters', () => {
  // The WHATWG URL parser strips ASCII tab, LF and CR *before* parsing, so
  // "/\t/evil.example" passes a naive leading-slash check yet resolves to
  // https://evil.example/ — verified against Node's URL below.
  assert.equal(new URL('/\t/evil.example', 'https://thestarters.com').href, 'https://evil.example/')

  for (const value of [
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/hire\u0000/some-slug',
    '/hire/some-slug\u007F',
    '\t/hire/some-slug',
  ]) {
    const form = signupForm()
    const { warnings, api } = load({
      forms: [form],
      markers: [element({ [MARKER]: value })],
    })

    assert.equal(api.localPath(value), null, `localPath should reject ${JSON.stringify(value)}`)
    assert.equal(form.getAttribute('redirect'), null, `should reject ${JSON.stringify(value)}`)
    assert.equal(warnings.length, 1, `should warn once for ${JSON.stringify(value)}`)
    assert.match(warnings[0], /ignoring starters-ms-redirect value/)
  }
})

test('a whitespace-only marker counts as a missing value, not an invalid one', () => {
  const form = signupForm()
  const { warnings } = load({
    forms: [form],
    markers: [element({ [MARKER]: '   ' })],
  })

  assert.equal(form.getAttribute('redirect'), null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /no \[starters-ms-redirect\] value on the page/)
})

test('apply() reports how many forms it configured', () => {
  const first = signupForm()
  const second = signupForm()
  const third = signupForm({ redirect: '/author-choice' })
  const { api } = load({
    forms: [first, second, third],
    markers: [element({ [MARKER]: '/hire/a?modal-id=signup-modal' })],
  })

  // Two written at boot, the author-set one skipped, and nothing left to do after.
  assert.equal(first.getAttribute('redirect'), '/hire/a?modal-id=signup-modal')
  assert.equal(second.getAttribute('redirect'), '/hire/a?modal-id=signup-modal')
  assert.equal(third.getAttribute('redirect'), '/author-choice')
  assert.equal(api.apply(), 0)

  const late = signupForm()
  const { api: api2 } = load({
    forms: [late],
    markers: [element({ [MARKER]: '/hire/b?modal-id=signup-modal' })],
    booted: false,
  })
  assert.equal(api2.apply(), 0, 'already configured at boot')

  const fresh = signupForm()
  const loaded = load({ forms: [], markers: [element({ [MARKER]: '/hire/c?modal-id=signup-modal' })] })
  loaded.state.forms = [fresh]
  assert.equal(loaded.api.apply(), 1, 'one newly configured form')
  assert.equal(fresh.getAttribute('redirect'), '/hire/c?modal-id=signup-modal')
})

test('a marker carried by one form is not donated to another form', () => {
  // The marker selector also matches a form that carries the attribute. Such a
  // marker belongs to that form alone: form A's target must never leak to form B.
  const withMarker = signupForm({
    [MARKER]: '/form-a?modal-id=signup-modal',
    redirect: '/author-choice',
  })
  const other = signupForm()
  const { warnings } = load({
    forms: [withMarker, other],
    // both forms are also marker-selector matches, and there is no page marker
    markers: [withMarker, other],
  })

  assert.equal(withMarker.getAttribute('redirect'), '/author-choice')
  assert.equal(other.getAttribute('redirect'), null, 'must not inherit form A marker')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /no \[starters-ms-redirect\] value on the page/)
})

test('a page marker still applies when a form also carries its own marker', () => {
  const withMarker = signupForm({ [MARKER]: '/form-a?modal-id=signup-modal' })
  const other = signupForm()
  const pageMarker = element({ [MARKER]: '/page-level?modal-id=signup-modal' })
  load({
    forms: [withMarker, other],
    markers: [withMarker, pageMarker],
  })

  assert.equal(withMarker.getAttribute('redirect'), '/form-a?modal-id=signup-modal')
  assert.equal(other.getAttribute('redirect'), '/page-level?modal-id=signup-modal')
})

test('exposes localPath so the rules can be checked directly', () => {
  const { api } = load()

  assert.equal(api.localPath('/hire/a?modal-id=signup-modal'), '/hire/a?modal-id=signup-modal')
  assert.equal(api.localPath('  /hire/a  '), '/hire/a')
  assert.equal(api.localPath('//evil.example'), null)
  assert.equal(api.localPath('https://evil.example'), null)
  assert.equal(api.localPath(null), null)
  assert.equal(api.markerAttribute, MARKER)
})

test('a marker with no signup form on the page is a silent no-op', () => {
  const { warnings, api } = load({
    forms: [],
    markers: [element({ [MARKER]: '/hire/some-slug?modal-id=signup-modal' })],
  })

  assert.deepEqual(warnings, [])
  assert.equal(api.apply(), 0)
})

test('a signup form with no marker anywhere warns on staging and sets nothing', () => {
  const form = signupForm()
  const { warnings } = load({ forms: [form], markers: [] })

  assert.equal(form.getAttribute('redirect'), null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /no \[starters-ms-redirect\] value/)
})

test('warnings are silent in production and enabled on staging hosts', () => {
  const stagingHosts = [
    'the-starters-3-0.webflow.io',
    'localhost',
    '127.0.0.1',
    'random-words-1234.trycloudflare.com',
  ]
  for (const hostname of stagingHosts) {
    const { warnings } = load({
      hostname,
      forms: [signupForm()],
      markers: [element({ [MARKER]: 'https://evil.example/steal' })],
    })
    assert.equal(warnings.length, 1, `expected a warning on ${hostname}`)
  }

  for (const hostname of ['thestarters.com', 'www.thestarters.com', 'notwebflow.iottt']) {
    const { warnings } = load({
      hostname,
      forms: [signupForm()],
      markers: [element({ [MARKER]: 'https://evil.example/steal' })],
    })
    assert.deepEqual(warnings, [], `expected silence on ${hostname}`)
  }
})

test('STARTERS_DEBUG re-enables warnings on a production host', () => {
  const { warnings } = load({
    hostname: 'thestarters.com',
    debug: true,
    forms: [signupForm()],
    markers: [element({ [MARKER]: 'https://evil.example/steal' })],
  })

  assert.equal(warnings.length, 1)
})

test('the boot guard makes a second evaluation a complete no-op', () => {
  const form = signupForm()
  const result = load({
    booted: true,
    forms: [form],
    markers: [element({ [MARKER]: '/hire/some-slug?modal-id=signup-modal' })],
  })

  assert.equal(result.api, undefined)
  assert.equal(form.getAttribute('redirect'), null)
  assert.deepEqual(result.warnings, [])
})

test('re-runs on DOMContentLoaded when it evaluated before the form was parsed', () => {
  const form = signupForm()
  const loaded = load({ readyState: 'loading', forms: [], markers: [] })

  assert.equal(form.getAttribute('redirect'), null)

  loaded.state.forms = [form]
  loaded.state.markers = [element({ [MARKER]: '/hire/late?modal-id=signup-modal' })]
  loaded.fireDomContentLoaded()

  assert.equal(form.getAttribute('redirect'), '/hire/late?modal-id=signup-modal')
  assert.equal(form.getAttribute('data-redirect'), '/hire/late?modal-id=signup-modal')
})

test('does not register a DOMContentLoaded listener once parsing has finished', () => {
  const loaded = load({ readyState: 'complete', forms: [signupForm()], markers: [] })

  assert.equal(loaded.listeners.length, 0)
})

test('a second apply() pass leaves already-configured forms untouched', () => {
  const form = signupForm()
  const { api } = load({
    forms: [form],
    markers: [element({ [MARKER]: '/hire/some-slug?modal-id=signup-modal' })],
  })

  assert.equal(form.getAttribute('redirect'), '/hire/some-slug?modal-id=signup-modal')
  assert.equal(api.apply(), 0)
  assert.equal(form.getAttribute('redirect'), '/hire/some-slug?modal-id=signup-modal')
})
