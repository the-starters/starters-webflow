const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const MODULE_PATH = require.resolve('./patch-onboarding-status.js')
const REDIRECT_PATH = require.resolve('./onboarding-done-redirect.js')
const source = fs.readFileSync(MODULE_PATH, 'utf8')
const diagnosticSource = fs.readFileSync(
  require.resolve('../utils/workflow-diagnostics.js'),
  'utf8',
)

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const PATCH_URL = XANO + '/api:KZf7nFnk/starters_onboarding/set_onboarding_status'
const LOADER_SELECTOR = '[data-page-spinner]'
const DASHBOARD = '/starter-dashboard'

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

/**
 * A deterministic clock driving both `Date.now()` and the module's timers, so
 * the 8s request/Memberstack budgets and the 1s/3s PATCH backoff are testable
 * without waiting for them.
 */
function makeClock() {
  let now = 1700000000000
  let seq = 0
  const timers = new Map()

  return {
    now: () => now,
    pending: () => timers.size,
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { fn, at: now + (ms || 0), repeat: null })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    setInterval(fn, ms) {
      const id = ++seq
      timers.set(id, { fn, at: now + (ms || 0), repeat: ms || 1 })
      return id
    },
    clearInterval(id) {
      timers.delete(id)
    },
    async advance(ms) {
      const target = now + ms
      for (let guard = 0; guard < 5000; guard += 1) {
        let dueId = null
        let due = null
        for (const [id, timer] of timers) {
          if (timer.at > target) continue
          if (!due || timer.at < due.at) {
            due = timer
            dueId = id
          }
        }
        if (!due) break
        now = Math.max(now, due.at)
        if (due.repeat === null) timers.delete(dueId)
        else due.at = now + due.repeat
        due.fn()
        await flush()
      }
      now = target
      await flush()
    },
  }
}

/**
 * The module no longer keeps any state between loads, so every storage call is
 * recorded rather than served: the tests below assert the count stays at zero.
 */
function makeSessionStorage() {
  const touches = []
  return {
    touches,
    api: {
      getItem(key) {
        touches.push(['getItem', key])
        return null
      },
      setItem(key, value) {
        touches.push(['setItem', key, value])
      },
      removeItem(key) {
        touches.push(['removeItem', key])
      },
    },
  }
}

/** The optional Designer element revealed for the length of the patch window. */
function loaderElement({ withHiddenAttribute = true } = {}) {
  return {
    style: { display: 'none' },
    attributes: withHiddenAttribute ? { hidden: '' } : {},
    removeAttribute(name) {
      delete this.attributes[name]
    },
  }
}

/** A `.w-form` wrapper holding a form and its hidden `.w-form-done` sibling. */
function formWrapper({
  withForm = true,
  withDone = true,
  withStyle = true,
  doneVisible = false,
  formAttributes = {},
} = {}) {
  const done = {
    style: { display: doneVisible ? 'block' : 'none' },
    textContent: 'Your onboarding details were saved.',
    attributes: {},
    listeners: {},
    offsetParent: null,
    observers: [],
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return this.attributes[name] || null },
    addEventListener(name, listener) { this.listeners[name] = listener },
  }
  const fail = {
    style: { display: 'none' },
    textContent: 'We could not confirm onboarding status.',
    attributes: {},
    listeners: {},
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return this.attributes[name] || null },
    addEventListener(name, listener) { this.listeners[name] = listener },
  }
  const form = {
    style: {},
    // A real form element always answers getAttribute; absent attributes are null.
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(formAttributes, name)
        ? formAttributes[name]
        : null
    },
  }
  const wrapper = {
    // A wrapper built without `style` stands in for a DOM the module cannot
    // touch; hiding it must fail quietly rather than block the PATCH.
    style: withStyle ? {} : null,
    querySelector(selector) {
      if (selector === 'form') return withForm ? form : null
      if (selector === '.w-form-done') return withDone ? done : null
      if (selector === '.w-form-fail') return fail
      return null
    },
  }

  return {
    wrapper,
    form,
    done,
    fail,
    /** What Webflow does on a successful AJAX submit. */
    succeed() {
      form.style.display = 'none'
      done.style.display = 'block'
      done.observers.slice().forEach((observer) => observer.fire())
    },
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

function loadModule(options = {}) {
  const clock = makeClock()
  const hostname = options.hostname || 'the-starters-3-0.webflow.io'
  const fetchCalls = []
  const aborted = []
  const logs = { warn: [], info: [] }
  const storage = makeSessionStorage()
  const fixtures = options.wrappers || []
  const loader = Object.prototype.hasOwnProperty.call(options, 'loader') ? options.loader : null
  const patchOutcomes = (options.patchOutcomes || []).slice()
  const tradeOutcomes = (options.tradeOutcomes || []).slice()

  const location = {
    hostname,
    pathname: options.pathname || '/starter-onboarding',
    search: '',
    href: 'https://' + hostname + (options.pathname || '/starter-onboarding'),
    replace(value) {
      location.replaced = value
      location.replaceCount = (location.replaceCount || 0) + 1
    },
  }

  async function fetchStub(url, config = {}) {
    fetchCalls.push({
      url,
      config,
      // Captured at call time so "the form was hidden before the PATCH went
      // out" is provable rather than merely true by the end of the test.
      wrapperDisplaysAtCall: fixtures.map(
        (fixture) => (fixture.wrapper.style && fixture.wrapper.style.display) || '',
      ),
    })

    if (url.indexOf(TRADE_URL) === 0) {
      const outcome = tradeOutcomes.length ? tradeOutcomes.shift() : 'ok'
      if (outcome === 'stall') return new Promise(() => {})
      if (options.tradeRejects) throw new Error('trade network failure')
      if (options.tradeFails) return jsonResponse(null, { ok: false, status: 401 })
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(options, 'tradeBody')
          ? options.tradeBody
          : 'xano-token-abc',
      )
    }

    if (url === PATCH_URL) {
      if (options.patchResponse) return options.patchResponse
      const outcome = patchOutcomes.length ? patchOutcomes.shift() : 'ok'
      if (outcome === 'reject') throw new Error('patch network failure')
      if (outcome === 'fail') return jsonResponse(null, { ok: false, status: 500 })
      return jsonResponse({ onboarding_done: true })
    }

    throw new Error('unexpected fetch: ' + url)
  }

  const window = {
    location,
    sessionStorage: storage.api,
    fetch: fetchStub,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    AbortController: class {
      constructor() {
        this.signal = { aborted: false }
      }
      abort() {
        this.signal.aborted = true
        aborted.push(this)
      }
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
      }
      observe(target, init) {
        this.target = target
        this.init = init
        target.observers.push(this)
      }
      disconnect() {
        this.disconnected = true
        const index = this.target.observers.indexOf(this)
        if (index !== -1) this.target.observers.splice(index, 1)
      }
      fire() {
        this.callback([], this)
      }
    },
  }
  if (options.diagnosticsReady) window.__startersWorkflowDiagnosticsReady = options.diagnosticsReady
  if (options.debug) window.STARTERS_DEBUG = true

  if (!options.memberstackMissing) {
    window.$memberstackDom = {
      getMemberCookie: async () => {
        if (options.memberstackRejects) throw new Error('memberstack failure')
        return options.loggedOut ? null : 'ms-jwt'
      },
    }
  }

  const document = {
    readyState: options.readyState || 'complete',
    listeners: {},
    querySelector(selector) {
      return selector === LOADER_SELECTOR ? loader : null
    },
    querySelectorAll(selector) {
      return selector === '.w-form' ? fixtures.map((fixture) => fixture.wrapper) : []
    },
    addEventListener(type, handler) {
      document.listeners[type] = document.listeners[type] || []
      document.listeners[type].push(handler)
    },
  }

  class FakeDate extends Date {
    static now() {
      return clock.now()
    }
  }

  const context = vm.createContext({
    window,
    document,
    Date: FakeDate,
    console: {
      warn: (message) => logs.warn.push(message),
      info: (message) => logs.info.push(message),
      error: (message) => logs.warn.push(message),
    },
  })

  if (options.diagnostics) {
    window.Date = FakeDate
    window.Math = Math
    window.Uint32Array = Uint32Array
    window.crypto = { randomUUID: () => '12345678-90ab-cdef-1234-567890abcdef' }
    window.navigator = { clipboard: { writeText: async () => {} } }
    window.StartersTrack = { track() {} }
    vm.runInContext(diagnosticSource, context)
  }

  const run = () => vm.runInContext(source, context)
  run()

  return {
    api: window.StartersPatchOnboardingStatus,
    aborted,
    clock,
    context,
    document,
    fetchCalls,
    loader,
    location,
    logs,
    run,
    storage,
    window,
  }
}

const urlsOf = (calls) => calls.map((call) => call.url)
const callsTo = (calls, url) => calls.filter((call) => call.url === url)

// --- Pure helpers -------------------------------------------------------------

test('only the two /starter-onboarding path forms are in scope', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isOnboardingPath('/starter-onboarding'), true)
  assert.equal(api.isOnboardingPath('/starter-onboarding/'), true)
  assert.equal(api.isOnboardingPath('/starter-onboarding/step-2'), false)
  assert.equal(api.isOnboardingPath('/starter-dashboard'), false)
  assert.equal(api.isOnboardingPath('/'), false)
})

test('host gate covers production, staging, local, and dev tunnels but not lookalikes', () => {
  const { api } = loadModule({ pathname: '/other' })
  for (const host of [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
    'localhost',
    '127.0.0.1',
    'some-generated-name.trycloudflare.com',
  ]) {
    assert.equal(api.allowedHost(host), true, host)
  }
  for (const host of [
    'notwebflow.io',
    'evil-trycloudflare.com',
    'thestarters.com.attacker.example',
    'attacker.example',
    '',
  ]) {
    assert.equal(api.allowedHost(host), false, host)
  }
})

test('a Webflow done block reads as shown only once its inline display changes', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isShown(null), false)
  assert.equal(api.isShown({ style: { display: 'none' } }), false)
  assert.equal(api.isShown({ style: { display: 'block' } }), true)
  assert.equal(api.isShown({ style: {}, offsetParent: null }), false)
  assert.equal(api.isShown({ style: {}, offsetParent: {} }), true)
})

// --- Mark done on submit ------------------------------------------------------

test('a Webflow success PATCHes the status endpoint with a bearer token', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({ wrappers: [fixture] })
  await flush()

  fixture.succeed()
  await flush()

  const patches = callsTo(fetchCalls, PATCH_URL)
  assert.equal(patches.length, 1)
  assert.equal(patches[0].config.method, 'PATCH')
  assert.equal(patches[0].config.headers.Authorization, 'Bearer xano-token-abc')
  assert.ok(urlsOf(fetchCalls)[0].startsWith(TRADE_URL + '?token='))
})

test('a successful onboarding PATCH records a privacy-safe console receipt', async () => {
  const fixture = formWrapper()
  const { location } = loadModule({ wrappers: [fixture], diagnostics: true })
  await flush()

  fixture.succeed()
  await flush()
  await flush()

  const receipt = fixture.wrapper.__startersOnboardingDiagnostic
  assert.equal(receipt.workflow, 'starter_onboarding_completion')
  assert.equal(receipt.result, 'success')
  assert.equal(receipt.http_status, 200)
  assert.equal(receipt.request_started, true)
  assert.equal(receipt.replayed, false)
  assert.equal(Object.hasOwn(receipt, 'memberstack_token'), false)
  assert.equal(Object.hasOwn(receipt, 'authorization'), false)
  assert.equal(fixture.done.textContent, 'Your onboarding details were saved.')
  assert.equal(fixture.done.getAttribute('data-workflow-diagnostic-copy'), null)
  assert.equal(location.replaced, DASHBOARD)
})

test('the first-publish PATCH stays open beyond the generic 8-second request budget', async () => {
  const patchReady = deferred()
  const fixture = formWrapper()
  const { aborted, clock, location } = loadModule({
    wrappers: [fixture],
    patchResponse: patchReady.promise,
  })
  await flush()

  fixture.succeed()
  await flush()
  await clock.advance(8001)

  assert.equal(aborted.length, 0, 'the first publish must not be aborted at the generic timeout')
  assert.equal(location.replaced, undefined, 'the loader remains while Xano completes the publish')

  patchReady.resolve(jsonResponse({
    onboarding_done: true,
    profile_publishing: { outcome_code: 'webflow_applied' },
  }))
  await flush()
  await flush()

  assert.equal(location.replaced, DASHBOARD)
})

test('a first-publish timeout redirects without starting an overlapping PATCH', async () => {
  const fixture = formWrapper()
  const { aborted, clock, fetchCalls, location } = loadModule({
    wrappers: [fixture],
    patchResponse: new Promise(() => {}),
  })
  await flush()

  fixture.succeed()
  await flush()
  await clock.advance(35000)
  await flush()

  assert.equal(aborted.length, 1)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
  assert.equal(location.replaced, DASHBOARD)
})

test('a token-trade timeout retries before starting the onboarding PATCH', async () => {
  const fixture = formWrapper()
  const { clock, fetchCalls, location } = loadModule({
    wrappers: [fixture],
    tradeOutcomes: ['stall', 'ok'],
  })
  await flush()

  fixture.succeed()
  await flush()
  await clock.advance(8000)

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 0)
  assert.equal(location.replaced, undefined)

  await clock.advance(1000)

  assert.equal(fetchCalls.filter((call) => call.url.startsWith(TRADE_URL)).length, 2)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
  assert.equal(location.replaced, DASHBOARD)
})

// --- Loader, hidden form, redirect --------------------------------------------

test('a success shows the loader and hides the form before the PATCH goes out', async () => {
  const fixture = formWrapper()
  const loader = loaderElement()
  const { fetchCalls } = loadModule({ wrappers: [fixture], loader })
  await flush()
  assert.equal(loader.style.display, 'none', 'nothing is touched before a submit')
  assert.equal(fixture.wrapper.style.display, undefined)

  fixture.succeed()
  await flush()

  assert.equal(loader.style.display, 'block')
  assert.equal(loader.attributes.hidden, undefined, 'the hidden attribute is cleared too')
  assert.equal(fixture.wrapper.style.display, 'none', "Webflow's success message goes with it")

  const patches = callsTo(fetchCalls, PATCH_URL)
  assert.deepEqual(patches[0].wrapperDisplaysAtCall, ['none'], 'hidden before the PATCH, not after')
})

test('a loader element built without the hidden attribute is still revealed', async () => {
  const fixture = formWrapper()
  const loader = loaderElement({ withHiddenAttribute: false })
  loadModule({ wrappers: [fixture], loader })
  await flush()

  fixture.succeed()
  await flush()
  assert.equal(loader.style.display, 'block')
})

test('a missing loader is a silent no-op that still patches and redirects', async () => {
  const fixture = formWrapper()
  const { fetchCalls, location, logs } = loadModule({ wrappers: [fixture] })
  await flush()

  fixture.succeed()
  await flush()

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
  assert.equal(location.replaced, DASHBOARD)
  assert.equal(logs.warn.length, 0, 'an unbuilt Designer element is not a fault')
  assert.ok(logs.info.some((line) => line.includes(LOADER_SELECTOR)))
})

test('a stalled shared diagnostics loader fails open to onboarding PATCH and redirect', async () => {
  const fixture = formWrapper()
  const { clock, fetchCalls, location } = loadModule({
    wrappers: [fixture],
    diagnosticsReady: new Promise(() => {}),
  })
  await flush()

  fixture.succeed()
  await clock.advance(1999)
  assert.equal(fetchCalls.length, 0)
  await clock.advance(1)

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
  assert.equal(location.replaced, DASHBOARD)
})

test('a helper loaded after diagnostics timeout does not fabricate a receipt', async () => {
  const patchReady = deferred()
  const fixture = formWrapper()
  const environment = loadModule({
    wrappers: [fixture],
    diagnosticsReady: Promise.resolve(null),
    patchResponse: patchReady.promise,
  })
  await flush()

  fixture.succeed()
  await flush()
  vm.runInContext(diagnosticSource, environment.context)
  patchReady.resolve(jsonResponse({ onboarding_done: true }))
  await flush()
  await flush()

  assert.equal(environment.window.__startersWorkflowDiagnosticLast, undefined)
  assert.equal(fixture.wrapper.__startersOnboardingDiagnostic, undefined)
  assert.equal(environment.location.replaced, DASHBOARD)
})

test('a wrapper that cannot be styled does not block the PATCH or the redirect', async () => {
  const fixture = formWrapper({ withStyle: false })
  const { fetchCalls, location } = loadModule({ wrappers: [fixture] })
  await flush()

  fixture.succeed()
  await flush()

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
  assert.equal(location.replaced, DASHBOARD)
})

test('a successful PATCH replaces to the dashboard, once', async () => {
  const fixture = formWrapper()
  const { location } = loadModule({ wrappers: [fixture] })
  await flush()
  assert.equal(location.replaced, undefined, 'nothing before a submit')

  fixture.succeed()
  await flush()

  assert.equal(location.replaced, DASHBOARD)
  assert.equal(location.replaceCount, 1)
})

test('a PATCH that gives up after every retry still redirects', async () => {
  const fixture = formWrapper()
  const { fetchCalls, clock, location, logs } = loadModule({
    wrappers: [fixture],
    patchOutcomes: ['fail', 'reject', 'fail'],
  })
  await flush()

  fixture.succeed()
  await flush()
  assert.equal(location.replaced, undefined, 'the redirect waits for the retries')

  await clock.advance(1000)
  assert.equal(location.replaced, undefined)
  await clock.advance(3000)
  await clock.advance(10000)

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 3, 'initial attempt plus two retries')
  assert.equal(location.replaced, DASHBOARD, 'fail open: never stranded behind a hidden form')
  assert.equal(location.replaceCount, 1)
  assert.ok(logs.warn.some((line) => line.includes('gave up marking onboarding_done')))
})

test('a redirect that the browser refuses is swallowed, not thrown at the page', async () => {
  const fixture = formWrapper()
  const { location, logs } = loadModule({ wrappers: [fixture] })
  location.replace = () => {
    throw new Error('navigation blocked')
  }
  await flush()

  fixture.succeed()
  await flush()
  assert.ok(logs.warn.some((line) => line.includes('could not redirect')))
})

test('a submit success fires at most once per form', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({ wrappers: [fixture] })
  await flush()

  fixture.succeed()
  await flush()
  fixture.succeed() // a second mutation on the same done block
  fixture.done.style.display = 'flex'
  fixture.succeed()
  await flush()

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
})

test('either of the two page forms counts, and each fires on its own', async () => {
  const full = formWrapper()
  const consult = formWrapper()
  const { fetchCalls } = loadModule({ wrappers: [full, consult] })
  await flush()

  consult.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)

  full.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 2)
})

test('a mutation that does not reveal the done block does not fire', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({ wrappers: [fixture] })
  await flush()

  fixture.done.observers.slice().forEach((observer) => observer.fire())
  await flush()

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 0)
})

test('a done block already visible at boot is left alone, not PATCHed', async () => {
  const fixture = formWrapper({ doneVisible: true })
  const { fetchCalls, location } = loadModule({ wrappers: [fixture] })
  await flush()

  assert.equal(fixture.done.observers.length, 0)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 0)
  assert.equal(location.replaced, undefined, 'a page served in its done state is not a submit')
})

test('a wrapper without a form or without a done block is skipped safely', async () => {
  const formless = formWrapper({ withForm: false })
  const doneless = formWrapper({ withDone: false })
  const { fetchCalls, logs } = loadModule({ wrappers: [formless, doneless] })
  await flush()

  assert.equal(formless.done.observers.length, 0)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 0)
  assert.ok(logs.warn.some((line) => line.includes('.w-form-done')))
})

// A Designer Redirect URL on either form navigates away on success, so
// `.w-form-done` never appears and the PATCH below is unreachable. The module
// cannot fix that, but it must never let it be silent.

test('a form with a Webflow success redirect is flagged but still watched', async () => {
  const attributed = formWrapper({
    formAttributes: { 'data-name': 'starter-onboarding-full', 'data-redirect': '/dashboard' },
  })
  const { logs } = loadModule({ wrappers: [attributed] })
  await flush()

  assert.equal(attributed.done.observers.length, 1, 'fail open: the watcher goes on anyway')
  assert.equal(logs.warn.length, 1, 'exactly one warning')
  assert.ok(logs.warn[0].includes('Redirect URL'))
  assert.ok(logs.warn[0].includes('starter-onboarding-full'), 'the form is named')
  assert.ok(logs.warn[0].includes('/dashboard'), 'the offending value is quoted')

  // Webflow has also been seen writing the setting as a bare `redirect`.
  const bare = formWrapper({ formAttributes: { redirect: '/dashboard' } })
  const plain = loadModule({ wrappers: [bare] })
  await flush()

  assert.equal(bare.done.observers.length, 1)
  assert.equal(plain.logs.warn.length, 1)
  assert.ok(plain.logs.warn[0].includes('Redirect URL'))
})

test('the success-redirect warning is staging-only, like every other diagnostic', async () => {
  const fixture = formWrapper({
    formAttributes: { 'data-name': 'starter-onboarding-full', 'data-redirect': '/dashboard' },
  })
  const { logs } = loadModule({ hostname: 'www.thestarters.com', wrappers: [fixture] })
  await flush()

  assert.equal(logs.warn.length + logs.info.length, 0)
  assert.equal(fixture.done.observers.length, 1, 'behaviour is identical to staging')
})

test('a form without a success redirect is not flagged', async () => {
  const plain = formWrapper()
  const { logs } = loadModule({ wrappers: [plain] })
  await flush()

  assert.equal(plain.done.observers.length, 1)
  assert.equal(logs.warn.length, 0)

  // An empty Redirect URL field is the same as no redirect at all.
  const emptied = formWrapper({ formAttributes: { 'data-redirect': '' } })
  const blank = loadModule({ wrappers: [emptied] })
  await flush()

  assert.equal(emptied.done.observers.length, 1)
  assert.equal(blank.logs.warn.length, 0)
})

test('a failed PATCH is retried on the 1s/3s backoff and can still succeed', async () => {
  const fixture = formWrapper()
  const { fetchCalls, clock, location } = loadModule({
    wrappers: [fixture],
    patchOutcomes: ['fail', 'ok'],
  })
  await flush()

  fixture.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
  assert.equal(location.replaced, undefined, 'the member waits behind the loader, not the form')

  await clock.advance(1000)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 2)
  assert.equal(location.replaced, DASHBOARD)
  await clock.advance(3000)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 2, 'no attempt after a success')
})

test('a logged-out submit never reaches Xano, is not retried, and is left in place', async () => {
  const fixture = formWrapper()
  const loader = loaderElement()
  const { fetchCalls, clock, location, logs } = loadModule({
    loggedOut: true,
    wrappers: [fixture],
    loader,
  })
  await flush()

  fixture.succeed()
  await flush()
  assert.equal(fetchCalls.length, 0)

  await clock.advance(1000)
  await clock.advance(3000)
  assert.equal(fetchCalls.length, 0, 'the retry loop breaks instead of re-trading')
  assert.equal(location.replaced, undefined, 'no session, nowhere to send them')
  assert.ok(logs.warn.some((line) => line.includes('No Memberstack session')))

  // Left on the page means left on a usable page, not behind a spinner.
  assert.equal(loader.style.display, 'none', 'the loader is taken back down')
  assert.equal(fixture.wrapper.style.display, '', 'the form goes back to its authored display')
  assert.equal(fixture.done.style.display, 'none')
  assert.equal(fixture.fail.style.display, 'block')
  assert.match(fixture.fail.textContent, /could not confirm your member session/i)
})

test('a logged-out onboarding completion shows a clean user-facing failure', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({
    loggedOut: true,
    wrappers: [fixture],
    diagnostics: true,
  })
  await flush()

  fixture.succeed()
  await flush()
  await flush()

  const receipt = fixture.wrapper.__startersOnboardingDiagnostic
  assert.equal(fetchCalls.length, 0)
  assert.equal(receipt.result, 'failed')
  assert.equal(receipt.error_code, 'MEMBER_LOGGED_OUT')
  assert.equal(receipt.request_started, true)
  assert.equal(fixture.done.textContent, 'Your onboarding details were saved.')
  assert.equal(fixture.done.style.display, 'none')
  assert.match(fixture.fail.textContent, /could not confirm your member session/i)
  assert.doesNotMatch(fixture.fail.textContent, /Diagnostic ID: WFD-/)
  assert.equal(fixture.fail.getAttribute('data-workflow-diagnostic-copy'), null)
})

// --- Scope gates --------------------------------------------------------------

test('does nothing on another page of the site', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({
    pathname: '/starter-dashboard',
    wrappers: [fixture],
  })
  await flush()
  assert.equal(fixture.done.observers.length, 0, 'no submit watcher outside the onboarding page')
  assert.equal(fetchCalls.length, 0)

  fixture.succeed()
  await flush()
  assert.equal(fetchCalls.length, 0)
})

test('does nothing on an unapproved host', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({
    hostname: 'attacker.example',
    wrappers: [fixture],
  })
  await flush()
  assert.equal(fixture.done.observers.length, 0)
  assert.equal(fetchCalls.length, 0)

  fixture.succeed()
  await flush()
  assert.equal(fetchCalls.length, 0)
})

test('runs on a cloudflared dev tunnel so the staging loop can QA it', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({
    hostname: 'chain-bless-robot.trycloudflare.com',
    wrappers: [fixture],
  })
  await flush()
  assert.equal(fixture.done.observers.length, 1)

  fixture.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
})

test('a second load of the same tag is a no-op (boot guard)', async () => {
  const fixture = formWrapper()
  const { fetchCalls, run } = loadModule({ wrappers: [fixture] })
  run()
  await flush()
  assert.equal(fixture.done.observers.length, 1, 'the done block is watched once, not twice')

  fixture.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
})

test('the trailing-slash path form is in scope at runtime too', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({ pathname: '/starter-onboarding/', wrappers: [fixture] })
  await flush()

  fixture.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
})

test('production stays silent while staging logs', async () => {
  const quiet = loadModule({ hostname: 'www.thestarters.com', wrappers: [formWrapper()] })
  await flush()
  assert.equal(quiet.logs.warn.length + quiet.logs.info.length, 0)

  const loud = loadModule({ wrappers: [formWrapper()] })
  await flush()
  assert.ok(loud.logs.info.length > 0)
})

test('STARTERS_DEBUG turns logging on in production without changing behaviour', async () => {
  const fixture = formWrapper()
  const { logs } = loadModule({
    hostname: 'www.thestarters.com',
    wrappers: [fixture],
    debug: true,
  })
  await flush()
  assert.equal(fixture.done.observers.length, 1)
  assert.ok(logs.info.length > 0)
})

test('a deferred-late document waits for DOMContentLoaded before doing anything', async () => {
  const fixture = formWrapper()
  const { document, fetchCalls } = loadModule({
    readyState: 'loading',
    wrappers: [fixture],
  })
  await flush()
  assert.equal(fetchCalls.length, 0)
  assert.equal(fixture.done.observers.length, 0)

  document.listeners.DOMContentLoaded.forEach((handler) => handler())
  await flush()
  assert.equal(fixture.done.observers.length, 1)

  fixture.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)
})

// --- Cross-file contract ------------------------------------------------------

test('both halves of the pair send members to the same dashboard path', () => {
  const { api } = loadModule({ pathname: '/other' })
  const redirectSource = fs.readFileSync(REDIRECT_PATH, 'utf8')

  assert.equal(api.dashboardPath, DASHBOARD)
  assert.equal(api.loaderSelector, LOADER_SELECTOR)
  assert.ok(redirectSource.includes("'" + DASHBOARD + "'"), 'the read half agrees on the target')
})

// One element, raised by both files in windows that cannot overlap. A rename in
// one half and not the other would leave the page half-covered, and nothing at
// runtime would say so.
test('both halves of the pair raise the same spinner element', () => {
  const { api } = loadModule({ pathname: '/other' })
  const redirectSource = fs.readFileSync(REDIRECT_PATH, 'utf8')

  assert.equal(api.loaderSelector, LOADER_SELECTOR)
  assert.ok(
    redirectSource.includes("var LOADER_SELECTOR = '" + LOADER_SELECTOR + "'"),
    'the read half declares the same selector',
  )
})

// The retired sessionStorage handshake: the write half redirects the member
// itself now, so neither file may quietly grow a marker back.
test('neither half of the pair touches sessionStorage any more', async () => {
  const fixture = formWrapper()
  const { storage, location } = loadModule({ wrappers: [fixture], loader: loaderElement() })
  await flush()

  fixture.succeed()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.deepEqual(storage.touches, [])

  const redirectSource = fs.readFileSync(REDIRECT_PATH, 'utf8')
  for (const text of [source, redirectSource]) {
    assert.equal(text.includes('sessionStorage'), false, 'no storage call survives in the source')
  }
})
