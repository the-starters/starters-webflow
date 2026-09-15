const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./posthog-track.js'), 'utf8')

function load({ beforeSend, queued = false } = {}) {
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
  return { listeners, captured, sdk,
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

test('unhandled rejections are marked unhandled', () => {
  const { listeners, captured } = load()
  listeners.unhandledrejection({ reason: new Error('boom') })

  assert.equal(captured.length, 1)
  assert.equal(captured[0].properties.$exception_list[0].mechanism.handled, false)
  assert.equal(captured[0].properties.starters_error_source, 'onunhandledrejection')
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
