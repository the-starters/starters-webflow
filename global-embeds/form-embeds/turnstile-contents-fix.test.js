const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const FILE = path.join(__dirname, 'turnstile-contents-fix.js')
const source = fs.readFileSync(FILE, 'utf8')

/* ------------------------------- mini world ------------------------------- *
 * Only the surface the module actually touches. The point of these tests is the
 * production-silence gate and the release-marker contract, not the widget: the
 * browser half is verified against the real Webflow page, which is the only place
 * `jQuery.data(form, '.w-form')` and `turnstile.render` exist at all.
 * -------------------------------------------------------------------------- */

function makeWorld({ hostname, forms = [], turnstile = null, debug = undefined }) {
  const logs = { info: [], warn: [], error: [] }
  const timers = { intervals: [], timeouts: [] }

  const window = {
    location: { hostname },
    turnstile,
    setInterval(fn) {
      timers.intervals.push(fn)
      return timers.intervals.length
    },
    clearInterval(id) {
      timers.intervals[id - 1] = null
    },
    setTimeout(fn) {
      timers.timeouts.push(fn)
      return timers.timeouts.length
    },
  }
  if (debug !== undefined) window.STARTERS_DEBUG = debug

  const document = {
    readyState: 'complete',
    addEventListener() {},
    createElement: () => ({
      style: {},
      setAttribute() {},
      querySelector: () => null,
      querySelectorAll: () => [],
    }),
    querySelectorAll(selector) {
      return selector === 'form[data-turnstile-sitekey]' ? forms : []
    },
  }

  const sandbox = {
    window,
    document,
    console: {
      info: (...args) => logs.info.push(args.join(' ')),
      warn: (...args) => logs.warn.push(args.join(' ')),
      error: (...args) => logs.error.push(args.join(' ')),
    },
    MutationObserver: function () {},
  }
  sandbox.globalThis = sandbox

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: FILE })

  // Run every live interval callback `times` times, which is how the turnstile wait
  // reaches its timeout without a real clock.
  const tick = (times) => {
    for (let i = 0; i < times; i += 1) {
      timers.intervals.slice().forEach((fn) => fn && fn())
    }
  }

  return { api: window.StartersTurnstileContentsFix, logs, tick, window }
}

function contentsForm(id) {
  const wrapper = { classList: { contains: () => true, add() {}, remove() {} }, children: [] }
  return {
    id,
    attrs: { 'data-turnstile-sitekey': '0xTESTKEY' },
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null
    },
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    hasAttribute(name) {
      return name in this.attrs
    },
    closest: () => wrapper,
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild() {},
    addEventListener() {},
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'contents' }) } },
  }
}

/* --------------------------------- tests ---------------------------------- */

test('the @release header and the exposed release property cannot drift apart', () => {
  const header = source.match(/@release\s+(v\d+\.\d+\.\d+)/)
  assert.ok(header, 'the file header must carry an @release marker')
  const { api } = makeWorld({ hostname: 'thestarters.com' })
  assert.equal(api.release, header[1])
})

test('the file is raw browser JavaScript, not an embed', () => {
  assert.equal(/<\/?script/i.test(source), false, 'no <script> wrapper tags may appear')
  assert.match(source, /^\s*\/\*\*/, 'the file opens with its documentation block')
  assert.match(source, /;\(function \(\) \{\n\s+'use strict'/, 'the body is a strict-mode IIFE')
  assert.match(
    source,
    /if \(window\.__startersTurnstileContentsFixBooted\) return/,
    'the IIFE guards against a double load'
  )
})

test('jQuery is used for exactly one thing: reading Webflow state', () => {
  const uses = source.match(/jq\.[a-zA-Z]+|jQuery\.[a-zA-Z]+/g) || []
  const unique = Array.from(new Set(uses))
  assert.deepEqual(unique.sort(), ['jQuery.data', 'jq.data'].sort())
})

test('the staging gate accepts staging hosts and rejects production and lookalikes', () => {
  const { api } = makeWorld({ hostname: 'thestarters.com' })
  const staging = [
    'the-starters-3-0.webflow.io',
    'webflow.io',
    'localhost',
    '127.0.0.1',
    'quick-name.trycloudflare.com',
    'trycloudflare.com',
  ]
  const production = [
    'thestarters.com',
    'www.thestarters.com',
    'notwebflow.io',
    'evil-trycloudflare.com',
    'webflow.io.evil.com',
    '',
  ]
  staging.forEach((host) => assert.equal(api.stagingHost(host), true, host))
  production.forEach((host) => assert.equal(api.stagingHost(host), false, host))
})

test('STARTERS_DEBUG turns logging on without widening what counts as staging', () => {
  const { api } = makeWorld({ hostname: 'thestarters.com', debug: true })
  assert.equal(api.diagnosticsEnabled(), true)
  assert.equal(api.stagingHost('thestarters.com'), false)
})

test('production is completely silent — nothing to arm', () => {
  const { logs } = makeWorld({ hostname: 'thestarters.com' })
  assert.deepEqual(logs, { info: [], warn: [], error: [] })
})

test('production is completely silent — turnstile never loads', () => {
  const world = makeWorld({ hostname: 'thestarters.com', forms: [contentsForm('wf-form-X')] })
  world.tick(250)
  assert.deepEqual(world.logs, { info: [], warn: [], error: [] })
})

test('staging reports both of those cases', () => {
  const quiet = makeWorld({ hostname: 'the-starters-3-0.webflow.io' })
  assert.equal(quiet.logs.info.length, 1)
  assert.match(quiet.logs.info[0], /no display:contents forms/)

  const waiting = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [contentsForm('wf-form-X')],
  })
  assert.match(waiting.logs.info[0], /1 display:contents form\(s\) to arm: wf-form-X/)
  waiting.tick(250)
  assert.equal(waiting.logs.warn.length, 1)
  assert.match(waiting.logs.warn[0], /window\.turnstile never appeared/)
  assert.match(waiting.logs.warn[0], /exactly as Webflow left them/)
})

test('a form whose computed display is not contents is never a candidate', () => {
  const form = contentsForm('wf-form-Flex')
  form.ownerDocument.defaultView.getComputedStyle = () => ({ display: 'flex' })
  const { logs } = makeWorld({ hostname: 'the-starters-3-0.webflow.io', forms: [form] })
  assert.equal(logs.info.length, 1)
  assert.match(logs.info[0], /no display:contents forms/)
})

test('data-wf-no-turnstile is honoured the way Webflow honours it', () => {
  const form = contentsForm('wf-form-OptedOut')
  form.attrs['data-wf-no-turnstile'] = ''
  const { logs } = makeWorld({ hostname: 'the-starters-3-0.webflow.io', forms: [form] })
  assert.match(logs.info[0], /no display:contents forms/)
})

test('refresh() before turnstile exists reports instead of arming', () => {
  const { api, logs } = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [contentsForm('wf-form-X')],
  })
  assert.equal(api.refresh(), 0)
  assert.match(logs.warn[0], /refresh\(\) called before window\.turnstile exists/)
})
