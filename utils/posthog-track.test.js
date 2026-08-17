const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./posthog-track.js'), 'utf8')

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
