const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./posthog-track.js'), 'utf8')

function load({
  beforeSend,
  queued = false,
  storageThrows = false,
  hostname = 'www.thestarters.com',
} = {}) {
  const listeners = {}
  const captured = []
  const scheduled = []
  const storageValues = new Map()
  let reloads = 0
  const context = {
    location: {
      host: hostname,
      hostname,
      pathname: '/',
      reload() {
        reloads += 1
      },
    },
    document: { addEventListener() {} },
    MutationObserver: function () {},
    getComputedStyle: () => ({}),
    sessionStorage: {
      getItem(key) {
        if (storageThrows) throw new Error('storage blocked')
        return storageValues.has(key) ? storageValues.get(key) : null
      },
      setItem(key, value) {
        if (storageThrows) throw new Error('storage blocked')
        storageValues.set(key, String(value))
      },
    },
    setTimeout(fn) {
      scheduled.push(fn)
      return scheduled.length
    },
    clearTimeout() {},
    Error,
    URL,
  }
  context.window = context
  const sdk = {
    config: { before_send: beforeSend },
    set_config(update) { Object.assign(this.config, update) },
    captureException(error, properties) {
      let event = { event: '$exception', properties: { ...properties,
        $exception_list: [{ type: error.name, value: error.message, mechanism: { handled: true, synthetic: false } }],
      } }
      const hooks = this.config.before_send
      for (const hook of Array.isArray(hooks) ? hooks : hooks ? [hooks] : []) {
        event = hook(event)
        if (event == null) return
      }
      captured.push({ error, properties: event.properties })
    },
  }
  const queue = []
  queue.captureException = (...args) => queue.push(['captureException', ...args])
  context.window.posthog = queued ? queue : sdk
  context.window.addEventListener = (type, fn) => { listeners[type] = fn }
  vm.createContext(context)
  vm.runInContext(source, context)
  return { listeners, captured, sdk, storageValues, location: context.location,
    get reloads() {
      return reloads
    },
    runScheduled() {
      while (scheduled.length) scheduled.shift()()
    },
    flush() {
      context.window.posthog = sdk
      for (const entry of queue) {
        if (typeof entry === 'function') entry.call(sdk)
        else sdk[entry[0]](...entry.slice(1))
      }
      queue.length = 0
    },
  }
}

function chunkError(request) {
  const error = new Error(`Loading chunk 862 failed. (error: ${request})`)
  error.name = 'ChunkLoadError'
  error.request = request
  return error
}

test('uncaught errors forward the source location and a truthful mechanism', () => {
  const { listeners, captured } = load()
  listeners.error({
    error: null,
    message: 'InvalidStateError: bad state',
    filename: 'https://cdn.example.com/app.js',
    lineno: 42,
    colno: 7,
  })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].properties.filename, 'https://cdn.example.com/app.js')
  assert.equal(captured[0].properties.lineno, 42)
  assert.equal(captured[0].properties.colno, 7)
  assert.equal(captured[0].properties.$exception_list[0].mechanism.handled, false)
  assert.equal(captured[0].properties.starters_error_source, 'onuncaughtexception')
})

test('cross-origin "Script error." events with no detail are dropped', () => {
  const { listeners, captured } = load()
  listeners.error({ error: null, message: 'Script error.', filename: '', lineno: 0, colno: 0 })

  assert.equal(captured.length, 0)
})

test('a confirmed Webflow chunk failure is captured before one recovery reload', () => {
  const app = load()
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'

  app.listeners.error({
    error: chunkError(request),
    message: `Loading chunk 862 failed. (error: ${request})`,
    filename:
      'https://cdn.prod.website-files.com/site/js/webflow.runtime.js',
  })
  app.listeners.error({ error: chunkError(request), message: 'Loading chunk 862 failed.' })

  assert.equal(app.captured.length, 2)
  assert.equal(app.reloads, 0)
  app.runScheduled()
  assert.equal(app.reloads, 1)

  const markers = JSON.parse(
    app.storageValues.get('starters:webflow-chunk-recovery'),
  )
  assert.deepEqual(markers.map((marker) => marker.page), ['/'])
  assert.equal(Number.isFinite(markers[0].at), true)
})

test('an unhandled Webflow chunk rejection uses the same recovery guard', () => {
  const app = load()
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'

  app.listeners.unhandledrejection({ reason: chunkError(request) })

  assert.equal(app.captured.length, 1)
  assert.equal(
    app.captured[0].properties.starters_error_source,
    'onunhandledrejection',
  )
  assert.equal(app.reloads, 0)
  app.runScheduled()
  assert.equal(app.reloads, 1)
})

test('a Webflow chunk failure can recover independently on another page', () => {
  const app = load()
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'

  app.listeners.error({ error: chunkError(request) })
  app.runScheduled()
  assert.equal(app.reloads, 1)

  app.location.pathname = '/starter-dashboard'
  app.listeners.error({ error: chunkError(request) })
  app.runScheduled()
  assert.equal(app.reloads, 2)
  assert.deepEqual(
    JSON.parse(app.storageValues.get('starters:webflow-chunk-recovery')).map(
      (marker) => marker.page,
    ),
    ['/', '/starter-dashboard'],
  )
})

test('recovering another page never re-arms an earlier page cooldown', () => {
  const app = load()
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'

  app.listeners.error({ error: chunkError(request) })
  app.runScheduled()
  assert.equal(app.reloads, 1)

  app.location.pathname = '/starter-dashboard'
  app.listeners.error({ error: chunkError(request) })
  app.runScheduled()
  assert.equal(app.reloads, 2)

  app.location.pathname = '/'
  app.listeners.error({ error: chunkError(request) })
  app.runScheduled()
  assert.equal(app.captured.length, 3)
  assert.equal(app.reloads, 2)
})

test('recovery markers stay bounded as more pages fail', () => {
  const app = load()
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'

  for (let i = 0; i < 25; i += 1) {
    app.location.pathname = `/page-${i}`
    app.listeners.error({ error: chunkError(request) })
    app.runScheduled()
  }

  assert.equal(app.reloads, 25)
  const markers = JSON.parse(
    app.storageValues.get('starters:webflow-chunk-recovery'),
  )
  assert.equal(markers.length, 10)
  assert.equal(markers[markers.length - 1].page, '/page-24')
  assert.deepEqual(Object.keys(markers[0]).sort(), ['at', 'page'])
})

test('an expired same-page recovery marker permits a later retry', () => {
  const app = load()
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'
  app.storageValues.set(
    'starters:webflow-chunk-recovery',
    JSON.stringify([{ page: '/', at: 0 }]),
  )

  app.listeners.error({ error: chunkError(request) })
  app.runScheduled()

  assert.equal(app.reloads, 1)
})

test('Marker.io and other providers never trigger Webflow recovery', () => {
  const app = load()
  const request = 'https://edge.marker.io/latest/2.v2.36.2.js'

  app.listeners.error({
    error: chunkError(request),
    message: `Loading chunk 2 failed. (timeout: ${request})`,
    filename: 'https://edge.marker.io/latest/shim.js',
  })

  assert.equal(app.captured.length, 1)
  app.runScheduled()
  assert.equal(app.reloads, 0)
  assert.equal(app.storageValues.size, 0)
})

test('a Webflow chunk failure on a non-V3 host remains capture-only', () => {
  const app = load({ hostname: 'www.hirethestarters.com' })
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'

  app.listeners.error({ error: chunkError(request) })

  assert.equal(app.captured.length, 1)
  app.runScheduled()
  assert.equal(app.reloads, 0)
  assert.equal(app.storageValues.size, 0)
})

test('blocked session storage fails closed without escaping the error listener', () => {
  const app = load({ storageThrows: true })
  const request =
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'

  assert.doesNotThrow(() =>
    app.listeners.error({ error: chunkError(request) }),
  )
  assert.equal(app.captured.length, 1)
  app.runScheduled()
  assert.equal(app.reloads, 0)
})

test('unhandled rejections are marked unhandled', () => {
  const { listeners, captured } = load()
  listeners.unhandledrejection({ reason: new Error('boom') })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].properties.$exception_list[0].mechanism.handled, false)
  assert.equal(captured[0].properties.starters_error_source, 'onunhandledrejection')
})

test('only recognized network reasons without original source frames share a fingerprint', () => {
  const app = load()
  const reasons = ['Load failed', 'Failed to fetch', 'Failed to fetch (example.test)',
    'NetworkError when attempting to fetch resource.', 'Network Error']
  for (const message of reasons) {
    const reason = new TypeError(message)
    reason.stack = ''
    app.listeners.unhandledrejection({ reason })
  }
  app.listeners.unhandledrejection({ reason: { code: 'network-error' } })
  app.listeners.unhandledrejection({ reason: 'Load failed' })
  for (const { properties } of app.captured) {
    assert.equal(properties.starters_error_kind, 'network')
    assert.equal(properties.$exception_fingerprint, 'starters-network-rejection')
    assert.equal(properties.$exception_list[0].mechanism.handled, false)
  }
  assert.equal(app.captured.length, 7)
})

test('useful Chrome, Safari, Firefox and stacktrace sources retain network source grouping', () => {
  const app = load()
  const sources = [
    { stack: 'TypeError: Failed to fetch\n    at checkout (https://example.test/checkout.js:8:4)' },
    { stack: 'fetch@https://example.test/profile.js:21:9' },
    { stack: 'global code@https://example.test/search.js:2:10' },
    { stacktrace: 'fetch@https://example.test/list.js:7:11', stack: '' },
    { stack: 'at checkout (https://example.test/checkout.js:8)' },
    { stack: 'fetch@https://example.test/profile.js:21' },
  ]
  for (const fields of sources) {
    const reason = Object.assign(new TypeError('Failed to fetch'), fields)
    app.listeners.unhandledrejection({ reason })
    assert.equal(app.captured.at(-1).error, reason)
    assert.equal(app.captured.at(-1).properties.$exception_fingerprint, undefined)
  }
  assert.equal(app.captured.length, sources.length)
})

test('malformed original network stacks do not prevent stable stackless grouping', () => {
  const app = load()
  for (const stack of ['TypeError: Load failed', 'arbitrary private body', 'x'.repeat(17000)]) {
    app.listeners.unhandledrejection({ reason: { name: 'TypeError', message: 'Load failed', stack } })
    assert.equal(app.captured.at(-1).properties.$exception_fingerprint, 'starters-network-rejection')
    assert.notEqual(app.captured.at(-1).error.stack, stack)
  }
})

test('other network-looking rejections and dynamic imports retain default grouping', () => {
  const app = load()
  for (const message of ['Failed to fetch dynamically imported module: https://example.test/x.js',
    'Load failed after validation', 'boom']) {
    app.listeners.unhandledrejection({ reason: new Error(message) })
    assert.equal(app.captured.at(-1).properties.$exception_fingerprint, undefined)
  }
  assert.equal(app.captured.length, 3)
})

test('actual failed requests select chunk ownership despite unrelated caller frames', () => {
  const webflow = 'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'
  const marker = 'https://edge.marker.io/latest/2.v2.36.2.f4e0c18f.js'
  for (const [request, caller, vendor, fingerprint, reloads] of [
    [marker, webflow, 'marker.io', 'starters-markerio-chunk-load', 0],
    [webflow, marker, 'webflow', 'starters-webflow-chunk-load', 1],
  ]) {
    const app = load()
    const reason = chunkError(request)
    reason.stack = `ChunkLoadError: Loading chunk 862 failed.\n    at caller (${caller}:1:2)`
    app.listeners.unhandledrejection({ reason })
    assert.equal(app.captured[0].error, reason)
    assert.equal(app.captured[0].properties.starters_error_kind, 'chunk-load')
    assert.equal(app.captured[0].properties.starters_chunk_vendor, vendor)
    assert.equal(app.captured[0].properties.$exception_fingerprint, fingerprint)
    app.runScheduled()
    assert.equal(app.reloads, reloads)
  }
})

test('chunk hashes and browser error channels share only the confirmed vendor fingerprint', () => {
  const app = load()
  app.listeners.error({ error: chunkError('https://cdn.prod.website-files.com/site/js/webflow.achunk.aaa.js') })
  app.listeners.unhandledrejection({ reason: chunkError('https://cdn.prod.website-files.com/site/js/webflow.achunk.bbb.js') })
  for (const { properties } of app.captured) {
    assert.equal(properties.$exception_fingerprint, 'starters-webflow-chunk-load')
  }
  assert.equal(app.captured.length, 2)
  app.runScheduled()
  assert.equal(app.reloads, 1)
})

test('unknown or invalid explicit requests cannot inherit ownership from other URLs', () => {
  const webflow = 'https://cdn.prod.website-files.com/site/js/webflow.achunk.deadbeef.js'
  const requests = [
    undefined, null, '', 42, 'not a URL',
    'https://example.test/path/https://cdn.prod.website-files.com/site/js/webflow.achunk.a.js',
    'https://cdn.prod.website-files.com.evil.test/site/js/webflow.achunk.a.js',
    'https://user:password@cdn.prod.website-files.com/site/js/webflow.achunk.a.js',
    'https://cdn.prod.website-files.com:444/site/js/webflow.achunk.a.js',
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.a.js.map',
    'https://cdn.prod.website-files.com/site/js/webflow.achunk.a.js/trailing',
    'https://edge.marker.io/latest/2.js.map',
  ]
  for (const request of requests) {
    const app = load()
    const reason = chunkError(webflow)
    reason.request = request
    reason.stack = `ChunkLoadError\n    at caller (${webflow}:1:2)`
    app.listeners.error({ error: reason, filename: webflow })
    assert.equal(app.captured.length, 1)
    assert.equal(app.captured[0].properties.starters_chunk_vendor, undefined, String(request))
    assert.equal(app.captured[0].properties.$exception_fingerprint, undefined, String(request))
    app.runScheduled()
    assert.equal(app.reloads, 0, String(request))
  }
})

test('missing requests use only a unique explicit failed-asset message', () => {
  const webflow = 'https://cdn.prod.website-files.com/site/js/webflow.achunk.a.js'
  const marker = 'https://edge.marker.io/latest/2.js'
  const app = load()
  const reason = chunkError(webflow)
  delete reason.request
  app.listeners.error({ error: reason })
  assert.equal(app.captured[0].properties.starters_chunk_vendor, 'webflow')
  app.runScheduled()
  assert.equal(app.reloads, 1)
  for (const message of [
    'Loading chunk 1 failed.',
    `Loading chunk 1 failed. caller=${webflow}`,
    `Loading chunk 1 failed. (error: ${webflow}) (timeout: ${marker})`,
    'Loading chunk 1 failed. (error: https://example.test/x.js)',
  ]) {
    const other = load()
    other.listeners.error({ error: { name: 'ChunkLoadError', message, stack: `at caller (${webflow}:1:2)` }, filename: webflow })
    assert.equal(other.captured[0].properties.starters_chunk_vendor, undefined)
    other.runScheduled()
    assert.equal(other.reloads, 0)
  }
})

test('copied errors retain their title, bounded primitive diagnostics, and sanitized original frames', () => {
  const app = load()
  const reason = { name: 'ApiFailure', message: 'Search request failed',
    code: 'E_SEARCH', status: 503, private_detail: 'must not be captured',
    stack: 'ApiFailure: Search request failed\n    at search (https://user:password@example.test/search.js?token=private#secret:8:4)' }
  app.listeners.unhandledrejection({ reason })
  const { error, properties } = app.captured[0]
  assert.equal(error.message, 'Search request failed')
  assert.equal(error.name, 'ApiFailure')
  assert.equal(properties.starters_error_code, 'E_SEARCH')
  assert.equal(properties.starters_error_status, 503)
  assert.match(error.stack, /https:\/\/example.test\/search.js:8:4/)
  assert.doesNotMatch(error.stack, /password|token|private|secret|userinfo/)
  assert.equal(properties.private_detail, undefined)
})

test('a real cross-realm Error keeps a usable original source without copying private fields', () => {
  const reason = vm.runInNewContext("Object.assign(new Error('Remote failure'), { code: 'E_REMOTE', status: 502, private_detail: 'private' })")
  reason.stack = 'Error: Remote failure\nremote@https://example.test/remote.js:12:3'
  assert.equal(reason instanceof Error, false)
  const app = load()
  app.listeners.unhandledrejection({ reason })
  assert.equal(app.captured[0].error.message, 'Remote failure')
  assert.match(app.captured[0].error.stack, /remote.*https:\/\/example.test\/remote.js:12:3/)
  assert.equal(app.captured[0].properties.starters_error_code, 'E_REMOTE')
  assert.equal(app.captured[0].properties.private_detail, undefined)
})

test('copied diagnostics remain bounded primitives and unsupported values are excluded', () => {
  const app = load()
  app.listeners.unhandledrejection({ reason: { message: 'x'.repeat(300), name: 'y'.repeat(100),
    code: 'z'.repeat(400), status: false } })
  const first = app.captured[0]
  assert.equal(first.error.message.length, 200)
  assert.equal(first.error.name.length, 80)
  assert.equal(first.properties.starters_error_code.length, 200)
  assert.equal(first.properties.starters_error_status, false)
  for (const value of [{ secret: 'private' }, ['private'], () => 'private', Infinity, NaN]) {
    app.listeners.unhandledrejection({ reason: { message: 'Request failed', code: value, status: value } })
    assert.equal(app.captured.at(-1).properties.starters_error_code, undefined)
    assert.equal(app.captured.at(-1).properties.starters_error_status, undefined)
  }
})

test('copied stacks accept supported frame formats and SDK stacktrace precedence', () => {
  const app = load()
  for (const frame of ['    at run (https://example.test/app.js:7:3)',
    '    at https://example.test/app.js:7:3',
    'run@https://example.test/app.js:7:3',
    'global code@https://example.test/app.js:7:3']) {
    app.listeners.unhandledrejection({ reason: { message: 'failed', stack: frame } })
    assert.match(app.captured.at(-1).error.stack, /https:\/\/example.test\/app.js:7:3/)
  }
  app.listeners.unhandledrejection({ reason: { message: 'failed', stack: 'at wrong (https://example.test/wrong.js:1:2)',
    stacktrace: 'right@https://example.test/right.js:8:9' } })
  assert.match(app.captured.at(-1).error.stack, /https:\/\/example.test\/right.js:8:9/)
  assert.doesNotMatch(app.captured.at(-1).error.stack, /wrong/)
})

test('copied stacks reject malformed or oversized input and cap frame count and line length', () => {
  const app = load()
  for (const stack of ['nonsense with private body', 'x'.repeat(17000),
    'at unsupported (webpack:///private.js:1:2)',
    `at long${'x'.repeat(1100)} (https://example.test/app.js:1:2)`]) {
    app.listeners.unhandledrejection({ reason: { message: 'failed', stack } })
    assert.notEqual(app.captured.at(-1).error.stack, stack)
    assert.match(app.captured.at(-1).error.stack, /posthog-track/)
  }
  const frames = Array.from({ length: 35 }, (_, i) => `at frame${i} (https://example.test/app.js:${i + 1}:2)`).join('\n')
  app.listeners.unhandledrejection({ reason: { message: 'failed', stack: frames } })
  assert.equal((app.captured.at(-1).error.stack.match(/https:\/\/example.test/g) || []).length, 20)
})

test('copied stack headers cannot inject private frames through name or message', () => {
  const app = load()
  const injection = '\n    at injected (https://user:password@example.test/private.js?token=private#secret:1:2)'
  app.listeners.unhandledrejection({ reason: { name: `ApiFailure${injection}`, message: `failed${injection}`,
    stack: 'at safe (https://example.test/safe.js?token=private#secret:7:3)' } })
  const { error } = app.captured[0]
  assert.doesNotMatch(error.stack, /password|token|private|secret|injected/)
  assert.match(error.stack, /https:\/\/example.test\/safe.js:7:3/)
})

test('hostile copied fields cannot drop the event or trigger recovery', () => {
  const app = load()
  const reason = new Proxy({}, { get() { throw new Error('unsafe getter') } })
  assert.doesNotThrow(() => app.listeners.unhandledrejection({ reason }))
  assert.equal(app.captured.length, 1)
  assert.equal(app.captured[0].error.message, 'Unhandled rejection object')
  app.runScheduled()
  assert.equal(app.reloads, 0)
})

test('primitive rejection reasons remain captured without changing their value', () => {
  const app = load()
  for (const reason of [null, undefined, false, 0, 503, 'plain failure']) {
    app.listeners.unhandledrejection({ reason })
    assert.equal(app.captured.at(-1).error.message, String(reason))
    assert.equal(app.captured.at(-1).properties.$exception_fingerprint, undefined)
  }
  assert.equal(app.captured.length, 6)
})

test('native Error input retains identity, message, name and stack', () => {
  const app = load()
  const reason = new Error('Original failure')
  reason.name = 'NativeFailure'
  reason.stack = 'NativeFailure: Original failure\n    at caller (https://example.test/native.js?original=kept:4:6)'
  const original = { message: reason.message, name: reason.name, stack: reason.stack }
  app.listeners.unhandledrejection({ reason })
  const captured = app.captured[0]
  assert.equal(captured.error, reason)
  assert.deepEqual({ message: captured.error.message, name: captured.error.name, stack: captured.error.stack }, original)
})

test('throwing copied getters retain safe fields and cannot turn caller URLs into a failed request', () => {
  const app = load()
  const reason = { name: 'ChunkLoadError', message: 'Loading chunk 1 failed.', status: 503,
    stack: 'at caller (https://cdn.prod.website-files.com/site/js/webflow.runtime.js:1:2)' }
  for (const key of ['code', 'request']) {
    Object.defineProperty(reason, key, { get() { throw new Error('private getter') } })
  }
  assert.doesNotThrow(() => app.listeners.unhandledrejection({ reason }))
  assert.equal(app.captured.length, 1)
  assert.equal(app.captured[0].error.message, 'Loading chunk 1 failed.')
  assert.equal(app.captured[0].properties.starters_error_status, 503)
  assert.equal(app.captured[0].properties.starters_error_code, undefined)
  assert.equal(app.captured[0].properties.$exception_fingerprint, undefined)
  app.runScheduled()
  assert.equal(app.reloads, 0)
})

test('object promise rejections retain safe diagnostics without leaking arbitrary fields', () => {
  const listeners = {}
  const captured = []
  const context = {
    location: { host: 'www.thestarters.com', pathname: '/starter-dashboard' },
    document: { addEventListener() {} },
    MutationObserver: function () {},
    getComputedStyle: () => ({}),
    setTimeout,
    clearTimeout,
    Error,
    URL,
  }
  context.window = context
  context.window.posthog = {
    captureException(error, properties) { captured.push({ error, properties }) },
  }
  context.window.addEventListener = (type, fn) => { listeners[type] = fn }

  vm.createContext(context)
  vm.runInContext(source, context)
  listeners.unhandledrejection({
    reason: {
      name: 'ApiFailure',
      message: 'Request failed',
      code: 'E_API',
      status: 503,
      private_detail: 'must not be captured',
    },
  })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].properties.platform, 'v3')
  assert.match(captured[0].error.message, /Request failed/)
  assert.equal(captured[0].properties.starters_error_code, 'E_API')
  assert.equal(captured[0].properties.starters_error_status, 503)
  assert.doesNotMatch(captured[0].error.message, /\[object Object\]/)
  assert.doesNotMatch(captured[0].error.message, /must not be captured/)
})

test('throwing rejection properties cannot escape the analytics listener', () => {
  const listeners = {}
  const captured = []
  const context = {
    location: { host: 'www.thestarters.com', pathname: '/starter-dashboard' },
    document: { addEventListener() {} },
    MutationObserver: function () {},
    getComputedStyle: () => ({}),
    setTimeout,
    clearTimeout,
    Error,
    URL,
  }
  context.window = context
  context.window.posthog = {
    captureException(error, properties) { captured.push({ error, properties }) },
  }
  context.window.addEventListener = (type, fn) => { listeners[type] = fn }

  vm.createContext(context)
  vm.runInContext(source, context)
  const reason = new Proxy({}, {
    get() { throw new Error('unsafe getter') },
  })

  assert.doesNotThrow(() => listeners.unhandledrejection({ reason }))
  assert.equal(captured.length, 1)
  assert.equal(captured[0].error.message, 'Unhandled rejection object')
  assert.equal(captured[0].properties.platform, 'v3')
})


test('queued snippet installs the hook before replaying captured errors', () => {
  const app = load({ queued: true })
  app.listeners.error({ error: new Error('early failure') })
  assert.equal(app.captured.length, 0)
  app.flush()
  assert.equal(app.captured[0].properties.$exception_list[0].mechanism.handled, false)
  app.listeners.error({ error: new Error('later failure') })
  assert.equal(app.sdk.config.before_send.length, 1)
})

test('existing privacy hooks and event drops are preserved', () => {
  const app = load({ beforeSend: [event => {
    assert.equal(event.properties.$exception_list[0].mechanism.handled, false)
    delete event.properties.filename
    return event
  }, event => event.properties.$exception_list[0].value === 'drop' ? null : event] })
  app.listeners.error({ error: new Error('keep'), filename: 'private-url' })
  app.listeners.error({ error: new Error('drop') })
  assert.equal(app.captured.length, 1)
  assert.equal(app.captured[0].properties.filename, undefined)
})

test('manual captures, unrelated events and handled causes keep their metadata', () => {
  const app = load()
  app.listeners.error({ error: new Error('install') })
  app.sdk.captureException(new Error('manual'), {})
  assert.equal(app.captured[1].properties.$exception_list[0].mechanism.handled, true)
  const hook = app.sdk.config.before_send[0]
  const other = { event: 'pageview', properties: {} }
  assert.equal(hook(other), other)
  assert.equal(hook(null), null)
  const cause = { mechanism: { handled: true, type: 'chained' } }
  const event = hook({ event: '$exception', properties: {
    starters_error_source: 'onuncaughtexception',
    $exception_list: [{ mechanism: { handled: true, synthetic: false } }, cause],
  } })
  assert.equal(event.properties.$exception_list[0].mechanism.handled, false)
  assert.equal(event.properties.$exception_list[0].mechanism.synthetic, false)
  assert.equal(event.properties.$exception_list[1], cause)
})
