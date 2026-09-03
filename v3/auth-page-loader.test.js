const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./auth-page-loader.js'), 'utf8')
const routeGuardSource = fs.readFileSync(
  require.resolve('./route-guard.js'),
  'utf8',
)
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

  const now = options.now === undefined ? 1700000005000 : options.now
  class FakeDate extends Date {
    static now() {
      return now
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

  return { appended, document, errors, events, listeners, marks, storage, window }
}

test('auth paths install only route guard then auth router from one release ref', () => {
  for (const pathname of ['/login', '/starter-login', '/auth-route']) {
    const { appended, window } = loadLoader({ pathname })
    assert.equal(appended.length, 2, pathname)
    assert.deepEqual(
      appended.map((script) => script.attributes['data-starters-auth-runtime']),
      ['route-guard', 'auth-route'],
      pathname,
    )
    assert.deepEqual(
      appended.map((script) => script.src),
      [
        'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v9.8.7/v3/route-guard.js',
        'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v9.8.7/v3/auth-route.js',
      ],
      pathname,
    )
    assert.ok(appended.every((script) => script.async === false), pathname)
    assert.ok(appended.every((script) => script.defer === false), pathname)
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

// The site-head block asks after this script has finished executing, when
// document.currentScript is null. The answer must not change then.
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

test('destination load emits timestamp-only timing and consumes the marker', () => {
  const { events, listeners, marks, storage } = loadLoader({
    pathname: '/starter-dashboard',
    startedAt: 1700000000000,
    redirectedAt: 1700000004000,
  })

  assert.equal(typeof listeners.load, 'function')
  listeners.load()
  assert.deepEqual(marks, ['starters:v3-auth-route:destination-load'])
  assert.equal(events.length, 1)
  assert.deepEqual({ ...events[0].detail }, {
    stage: 'destination-load',
    elapsedMs: 5000,
  })
  assert.equal(storage.has(TIMING_KEY), false)
  assert.equal(JSON.stringify(events).includes('member'), false)
  assert.equal(JSON.stringify(events).includes('token'), false)
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

test('header and exported release markers match', () => {
  const { window } = loadLoader()
  const marker = source.match(/@release\s+(v\d+\.\d+\.\d+)/)
  assert.ok(marker)
  assert.equal(window.StartersV3AuthPageLoader.release, marker[1])
})

// The `@release` header is an owned text contract: the release process reads it
// out of the served bytes with `curl | grep '@release'` and compares it against
// the exported property. The route-guard family ships as one unit, so a release
// that stamps one of them must stamp all of them, or the "which version is
// loaded?" console check answers differently per script.
test('the loader carries the same release marker as the route guard family', () => {
  const loaderMarker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  const guardMarker = routeGuardSource.match(
    /^ \* @release (v\d+\.\d+\.\d+)$/m,
  )
  assert.ok(loaderMarker, 'no @release line in auth-page-loader.js')
  assert.ok(guardMarker, 'no @release line in route-guard.js')
  assert.equal(loaderMarker[1], guardMarker[1])
})
