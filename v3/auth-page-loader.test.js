const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./auth-page-loader.js'), 'utf8')
const TIMING_KEY = 'thestarters:v3-auth-route-timing'
const PINNED_SRC =
  'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v9.8.7/v3/auth-page-loader.js'

function loadLoader(options = {}) {
  const pathname = options.pathname || '/auth-route'
  const hostname = options.hostname || 'www.thestarters.com'
  const appended = []
  const marks = []
  const events = []
  const errors = []
  const listeners = {}
  const storage = new Map()
  if (options.startedAt !== undefined) {
    const receipt = { startedAt: options.startedAt }
    // /auth-route stamps `redirectedAt` as it hands off; a receipt without it
    // never reached the router.
    if (options.redirectedAt !== undefined) {
      receipt.redirectedAt = options.redirectedAt
    }
    storage.set(TIMING_KEY, JSON.stringify(receipt))
  } else if (options.rawReceipt !== undefined) {
    storage.set(TIMING_KEY, options.rawReceipt)
  }

  function makeParent() {
    return {
      appendChild(node) {
        appended.push(node)
        return node
      },
    }
  }

  const head = makeParent()
  const documentElement = makeParent()
  documentElement.attributes = {}
  documentElement.setAttribute = function (name, value) {
    this.attributes[name] = value
  }
  const document = {
    currentScript: Object.prototype.hasOwnProperty.call(
      options,
      'currentScript',
    )
      ? options.currentScript
      : { src: options.loaderSrc || PINNED_SRC },
    head,
    documentElement,
    readyState: options.readyState || 'loading',
    createElement(tagName) {
      assert.equal(tagName, 'script')
      return {
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value
        },
      }
    },
  }

  // Mutable so a test can advance the clock between the loader's boot and the
  // `load` event, which is the only way to tell WHEN elapsedMs is measured.
  const clock = { now: options.now === undefined ? 1700000005000 : options.now }
  class FakeDate extends Date {
    static now() {
      return clock.now
    }
  }

  class CustomEvent {
    constructor(name, init) {
      this.type = name
      this.detail = init.detail
    }
  }

  const window = {
    location: { hostname, pathname },
    sessionStorage: {
      getItem(key) {
        return storage.get(key) || null
      },
      removeItem(key) {
        storage.delete(key)
      },
    },
    performance: {
      mark(name) {
        marks.push(name)
      },
    },
    addEventListener(name, callback) {
      listeners[name] = callback
    },
    dispatchEvent(event) {
      events.push(event)
    },
  }

  vm.runInNewContext(source, {
    Array,
    CustomEvent,
    Date: FakeDate,
    JSON,
    Number,
    Set,
    String,
    console: {
      error: (message) => errors.push(message),
    },
    document,
    window,
  })

  return {
    appended,
    clock,
    document,
    errors,
    events,
    listeners,
    marks,
    storage,
    window,
  }
}

// The static sitewide route-guard.js tag owns guard delivery and
// guard-before-router ordering on every page, these three included. A second
// copy from here could only re-download 43 KB to hit the guard's boot guard and
// return, so auth-route.js is the only asset the loader inserts.
test('auth paths install only the auth router, from the loader own release ref', () => {
  for (const pathname of ['/login', '/starter-login', '/auth-route']) {
    const { appended, window } = loadLoader({ pathname })
    assert.equal(appended.length, 1, pathname)
    assert.equal(
      appended[0].attributes['data-starters-auth-runtime'],
      'auth-route',
      pathname,
    )
    assert.equal(
      appended[0].src,
      'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v9.8.7/v3/auth-route.js',
      pathname,
    )
    assert.equal(appended[0].async, false, pathname)
    assert.equal(appended[0].defer, false, pathname)
    assert.equal(
      window.StartersV3AuthPageLoader.shouldLoadApplicationControllers(pathname),
      false,
    )
  }
})

// The sitewide route-guard.js tag stays parser-inserted in the site head so it
// keeps executing before page-level controllers that read
// window.StartersV3RouteGuard. Injecting it here would make it non-blocking and
// silently hand those controllers a null role.
test('non-auth pages install nothing and admit the existing app block', () => {
  for (const pathname of [
    '/starter-dashboard',
    '/build-profile/select-profile',
    '/forgot-password',
    '/memberstack/search-freelancers',
  ]) {
    const { appended, window } = loadLoader({ pathname })

    assert.deepEqual(appended, [], pathname)
    assert.equal(
      window.StartersV3AuthPageLoader.shouldLoadApplicationControllers(pathname),
      true,
      pathname,
    )
  }
})

// A loader that installs nothing must not also suppress the site's own
// controller block, or an auth page ends up with no runtime at all: no
// route-guard.js, no auth-route.js, no `redirect="/auth-route"` on the form,
// and the login falls through to the shared Memberstack plan redirect.
test('unapproved hosts install nothing and re-admit the app block', () => {
  const { appended, window } = loadLoader({
    hostname: 'lookalike-webflow.io.example',
    pathname: '/login',
  })

  assert.equal(appended.length, 0)
  for (const pathname of ['/login', '/starter-login', '/auth-route', '/quiz']) {
    assert.equal(
      window.StartersV3AuthPageLoader.shouldLoadApplicationControllers(pathname),
      true,
      pathname,
    )
  }
})

test('an underivable base fails closed and re-admits the app block', () => {
  for (const options of [
    { currentScript: null },
    { currentScript: {} },
    { loaderSrc: 'https://assets.example.com/bundles/site-head.js' },
  ]) {
    const label = JSON.stringify(options)
    const { appended, errors, window } = loadLoader({
      pathname: '/login',
      ...options,
    })

    assert.deepEqual(appended, [], label)
    assert.equal(errors.length, 1, label)
    assert.match(errors[0], /auth runtime not installed/)
    for (const pathname of ['/login', '/starter-login', '/auth-route']) {
      assert.equal(
        window.StartersV3AuthPageLoader.shouldLoadApplicationControllers(
          pathname,
        ),
        true,
        label + ' ' + pathname,
      )
    }
  }
})

test('a failed auth-router request becomes observable and re-admits the app block', () => {
  const { appended, document, errors, events, window } = loadLoader({
    pathname: '/auth-route',
  })

  assert.equal(appended.length, 1)
  appended[0].onerror()

  assert.equal(
    document.documentElement.attributes['data-auth-page-loader-error'],
    'auth-route-load-failed',
  )
  assert.equal(
    document.documentElement.attributes['data-auth-route-error'],
    'auth-route-load-failed',
  )
  assert.equal(
    window.StartersV3AuthPageLoader.shouldLoadApplicationControllers(
      '/auth-route',
    ),
    true,
  )
  assert.equal(events.at(-1).type, 'starters:v3-auth-page-loader-error')
  assert.deepEqual({ ...events.at(-1).detail }, {
    stage: 'auth-route-load-failed',
  })
  assert.match(errors.at(-1), /auth-route\.js failed to load/)
})

// The site-head block asks after this script has finished executing, when
// document.currentScript is null. The answer must not change then.
// Reading the receipt consumes it, so there is no safe public entry point: a
// diagnostic call would destroy the measurement it was inspecting. The boot
// path is the only driver.
test('the loader publishes no timing entry point', () => {
  const { window } = loadLoader({ pathname: '/starter-dashboard' })
  const api = window.StartersV3AuthPageLoader

  assert.deepEqual(Object.keys(api).sort(), [
    'authPaths',
    'isApprovedHost',
    'isAuthPath',
    'release',
    'shouldLoadApplicationControllers',
  ])
})

test('the controller answer survives losing document.currentScript', () => {
  const { window, document } = loadLoader({ pathname: '/login' })

  document.currentScript = null
  assert.equal(
    window.StartersV3AuthPageLoader.shouldLoadApplicationControllers('/login'),
    false,
  )
  assert.equal(
    window.StartersV3AuthPageLoader.shouldLoadApplicationControllers('/quiz'),
    true,
  )
})

// The head script boots at +5s but the destination page is not loaded until
// +7s. `destination-load` must report 7000, not the 5000 that was readable when
// the receipt was consumed, or the number excludes the very interval it names.
test('destination load measures through load, not the boot read', () => {
  const { clock, events, listeners, marks, storage } = loadLoader({
    pathname: '/starter-dashboard',
    startedAt: 1700000000000,
    redirectedAt: 1700000004000,
  })

  assert.equal(typeof listeners.load, 'function')
  assert.equal(storage.has(TIMING_KEY), false)
  assert.equal(events.length, 0)

  clock.now = 1700000007000
  listeners.load()

  assert.deepEqual(marks, ['starters:v3-auth-route:destination-load'])
  assert.equal(events.length, 1)
  assert.deepEqual({ ...events[0].detail }, {
    stage: 'destination-load',
    elapsedMs: 7000,
  })
  assert.equal(JSON.stringify(events).includes('member'), false)
  assert.equal(JSON.stringify(events).includes('token'), false)
})

// The ceiling has to hold at emit time too: a destination page that takes
// longer than the receipt's whole lifetime to load has nothing honest to report.
test('a load that arrives past the two-minute ceiling emits nothing', () => {
  const { clock, events, listeners, marks } = loadLoader({
    pathname: '/starter-dashboard',
    startedAt: 1700000000000,
    redirectedAt: 1700000004000,
  })

  clock.now = 1700000000000 + 120001
  listeners.load()

  assert.equal(events.length, 0)
  assert.equal(marks.length, 0)
})

test('a receipt the router never confirmed is discarded without an event', () => {
  const { events, listeners, marks, storage } = loadLoader({
    pathname: '/forgot-password',
    startedAt: 1700000000000,
  })

  assert.equal(listeners.load, undefined)
  assert.equal(events.length, 0)
  assert.equal(marks.length, 0)
  assert.equal(storage.has(TIMING_KEY), false)
})

// The member hits stop or clicks away before `load`. The receipt must already
// be gone, so the next page cannot report the abandoned load plus the
// interstitial time as a login-to-destination duration.
test('an abandoned destination load consumes the receipt and emits nothing', () => {
  const { events, marks, storage } = loadLoader({
    pathname: '/starter-dashboard',
    startedAt: 1700000000000,
    redirectedAt: 1700000004000,
  })

  assert.equal(storage.has(TIMING_KEY), false)
  assert.equal(events.length, 0)
  assert.equal(marks.length, 0)
})

test('auth pages preserve timing for the next navigation', () => {
  const { listeners, storage } = loadLoader({
    pathname: '/auth-route',
    startedAt: 1700000000000,
    redirectedAt: 1700000004000,
  })

  assert.equal(listeners.load, undefined)
  assert.equal(storage.has(TIMING_KEY), true)
})

test('stale timing is removed without emitting a destination event', () => {
  const { events, listeners, marks, storage } = loadLoader({
    pathname: '/brand-dashboard',
    startedAt: 1699999000000,
    redirectedAt: 1699999004000,
  })

  assert.equal(listeners.load, undefined)
  assert.equal(events.length, 0)
  assert.equal(marks.length, 0)
  assert.equal(storage.has(TIMING_KEY), false)
})

test('an unparseable timing receipt is discarded', () => {
  const { events, listeners, marks, storage } = loadLoader({
    pathname: '/starter-dashboard',
    rawReceipt: '{not-json',
  })

  assert.equal(listeners.load, undefined)
  assert.equal(events.length, 0)
  assert.equal(marks.length, 0)
  assert.equal(storage.has(TIMING_KEY), false)
})

test('header and exported release markers match', () => {
  const { window } = loadLoader()
  const marker = source.match(/@release\s+(v\d+\.\d+\.\d+)/)
  assert.ok(marker)
  assert.equal(window.StartersV3AuthPageLoader.release, marker[1])
})
