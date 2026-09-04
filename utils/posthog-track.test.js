const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./posthog-track.js'), 'utf8')

function load() {
  const listeners = {}
  const captured = []
  const context = {
    location: { host: 'www.thestarters.com', pathname: '/' },
    document: { addEventListener() {} },
    MutationObserver: function () {},
    getComputedStyle: () => ({}),
    setTimeout,
    clearTimeout,
    Error,
  }
  context.window = context
  context.window.posthog = {
    captureException(error, properties) { captured.push({ error, properties }) },
  }
  context.window.addEventListener = (type, fn) => { listeners[type] = fn }
  vm.createContext(context)
  vm.runInContext(source, context)
  return { listeners, captured }
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
  assert.equal(captured[0].properties.handled, false)
  assert.equal(captured[0].properties.mechanism, 'onerror')
})

test('cross-origin "Script error." events with no detail are dropped', () => {
  const { listeners, captured } = load()
  listeners.error({ error: null, message: 'Script error.', filename: '', lineno: 0, colno: 0 })

  assert.equal(captured.length, 0)
})

test('unhandled rejections are marked unhandled', () => {
  const { listeners, captured } = load()
  listeners.unhandledrejection({ reason: new Error('boom') })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].properties.handled, false)
  assert.equal(captured[0].properties.mechanism, 'onunhandledrejection')
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
  assert.match(captured[0].error.message, /E_API/)
  assert.match(captured[0].error.message, /503/)
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
