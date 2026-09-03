const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./auth-page-loader.js'), 'utf8')
const TIMING_KEY = 'thestarters:v3-auth-route-timing'

function loadLoader(options = {}) {
  const pathname = options.pathname || '/auth-route'
  const hostname = options.hostname || 'www.thestarters.com'
  const appended = []
  const marks = []
  const events = []
  const listeners = {}
  const storage = new Map()
  if (options.startedAt !== undefined) {
    storage.set(TIMING_KEY, JSON.stringify({ startedAt: options.startedAt }))
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
    currentScript: {
      src:
        options.loaderSrc ||
        'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v9.8.7/v3/auth-page-loader.js',
    },
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
    document,
    window,
  })

  return { appended, events, listeners, marks, storage, window }
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

test('ordinary pages install only route guard and admit the existing app block', () => {
  const { appended, window } = loadLoader({ pathname: '/starter-dashboard' })

  assert.equal(appended.length, 1)
  assert.equal(appended[0].attributes['data-starters-auth-runtime'], 'route-guard')
  assert.equal(
    window.StartersV3AuthPageLoader.shouldLoadApplicationControllers(
      '/starter-dashboard',
    ),
    true,
  )
})

test('unapproved hosts install nothing', () => {
  const { appended } = loadLoader({ hostname: 'lookalike-webflow.io.example' })
  assert.equal(appended.length, 0)
})

test('destination load emits timestamp-only timing and consumes the marker', () => {
  const { events, listeners, marks, storage } = loadLoader({
    pathname: '/starter-dashboard',
    startedAt: 1700000000000,
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

test('auth pages preserve timing for the next navigation', () => {
  const { listeners, storage } = loadLoader({
    pathname: '/auth-route',
    startedAt: 1700000000000,
  })

  assert.equal(listeners.load, undefined)
  assert.equal(storage.has(TIMING_KEY), true)
})

test('stale timing is removed without emitting a destination event', () => {
  const { events, listeners, marks, storage } = loadLoader({
    pathname: '/brand-dashboard',
    startedAt: 1699999000000,
  })

  listeners.load()
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
