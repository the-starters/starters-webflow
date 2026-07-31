const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./onboarding-done-redirect.js'), 'utf8')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const GET_URL = XANO + '/api:KZf7nFnk/starters_onboarding/get_freelancers'
const PATCH_URL = XANO + '/api:KZf7nFnk/starters_onboarding/set_onboarding_status'
const MARKER_KEY = 'starter-onboarding-just-submitted'
const DASHBOARD = '/starter-dashboard'
const DONE_ENVELOPE = { freelancer: [{ id: 12, onboarding_done: true }] }
const NOT_DONE_ENVELOPE = { freelancer: [{ id: 12, onboarding_done: false }] }

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
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

function makeSessionStorage({ throws = false } = {}) {
  const store = new Map()
  const guard = () => {
    if (throws) throw new Error('SecurityError: storage is disabled')
  }
  return {
    store,
    api: {
      getItem(key) {
        guard()
        return store.has(key) ? store.get(key) : null
      },
      setItem(key, value) {
        guard()
        store.set(key, String(value))
      },
      removeItem(key) {
        guard()
        store.delete(key)
      },
    },
  }
}

/** A `.w-form` wrapper holding a form and its hidden `.w-form-done` sibling. */
function formWrapper({ withForm = true, withDone = true, doneVisible = false } = {}) {
  const done = {
    style: { display: doneVisible ? 'block' : 'none' },
    offsetParent: null,
    observers: [],
  }
  const form = { style: {} }
  const wrapper = {
    querySelector(selector) {
      if (selector === 'form') return withForm ? form : null
      if (selector === '.w-form-done') return withDone ? done : null
      return null
    },
  }

  return {
    wrapper,
    form,
    done,
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
  const storage = makeSessionStorage({ throws: options.storageThrows })
  if (options.markerPresent) storage.store.set(MARKER_KEY, '1')
  const fixtures = options.wrappers || []
  const patchOutcomes = (options.patchOutcomes || []).slice()

  const location = {
    hostname,
    pathname: options.pathname || '/starter-onboarding',
    search: '',
    href: 'https://' + hostname + (options.pathname || '/starter-onboarding'),
    replace(value) {
      location.replaced = value
    },
  }

  async function fetchStub(url, config = {}) {
    fetchCalls.push({
      url,
      config,
      // Captured at call time so "marker written before the PATCH" is provable.
      markerAtCall: storage.store.has(MARKER_KEY) ? storage.store.get(MARKER_KEY) : null,
    })

    if (url.indexOf(TRADE_URL) === 0) {
      if (options.tradeRejects) throw new Error('trade network failure')
      if (options.tradeFails) return jsonResponse(null, { ok: false, status: 401 })
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(options, 'tradeBody')
          ? options.tradeBody
          : 'xano-token-abc',
      )
    }

    if (url === GET_URL) {
      if (options.getNeverSettles) return new Promise(() => {})
      if (options.getRejects) throw new Error('get network failure')
      if (options.getStatus) return jsonResponse(null, { ok: false, status: options.getStatus })
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(options, 'envelope')
          ? options.envelope
          : DONE_ENVELOPE,
      )
    }

    if (url === PATCH_URL) {
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

  const run = () => vm.runInContext(source, context)
  run()

  return {
    api: window.StartersOnboardingDoneRedirect,
    aborted,
    clock,
    document,
    fetchCalls,
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

test('only a literal true in the freelancer envelope counts as done', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.onboardingDone(DONE_ENVELOPE), true)
  assert.equal(api.onboardingDone(NOT_DONE_ENVELOPE), false)
  assert.equal(api.onboardingDone({ freelancer: [] }), false)
  assert.equal(api.onboardingDone({ freelancer: [{}] }), false)
  assert.equal(api.onboardingDone({ freelancer: [{ onboarding_done: 'true' }] }), false)
  assert.equal(api.onboardingDone({ freelancer: [{ onboarding_done: 1 }] }), false)
  assert.equal(api.onboardingDone({ freelancer: null }), false)
  assert.equal(api.onboardingDone({}), false)
  assert.equal(api.onboardingDone(null), false)
})

test('a Webflow done block reads as shown only once its inline display changes', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isShown(null), false)
  assert.equal(api.isShown({ style: { display: 'none' } }), false)
  assert.equal(api.isShown({ style: { display: 'block' } }), true)
  assert.equal(api.isShown({ style: {}, offsetParent: null }), false)
  assert.equal(api.isShown({ style: {}, offsetParent: {} }), true)
})

// --- Job 1: redirect on visit -------------------------------------------------

test('a completed member is replaced to the dashboard with a bearer-authorized read', async () => {
  const { location, fetchCalls } = loadModule()
  await flush()

  assert.equal(location.replaced, DASHBOARD)
  const reads = callsTo(fetchCalls, GET_URL)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].config.headers.Authorization, 'Bearer xano-token-abc')
  assert.ok(urlsOf(fetchCalls)[0].startsWith(TRADE_URL + '?token='))
})

test('an unfinished member stays on the page', async () => {
  const { location } = loadModule({ envelope: NOT_DONE_ENVELOPE })
  await flush()
  assert.equal(location.replaced, undefined)
})

test('an empty envelope (no freelancer row yet) stays on the page', async () => {
  const { location } = loadModule({ envelope: {} })
  await flush()
  assert.equal(location.replaced, undefined)
})

test('a logged-out visitor never reaches Xano and is not redirected', async () => {
  const { location, fetchCalls } = loadModule({ loggedOut: true })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('a failed token trade fails open', async () => {
  const { location, fetchCalls } = loadModule({ tradeFails: true })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, GET_URL).length, 0)
})

test('a token trade that returns no usable token fails open', async () => {
  const { location, fetchCalls } = loadModule({ tradeBody: { nothing: true } })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, GET_URL).length, 0)
})

test('a rejected read fails open', async () => {
  const { location } = loadModule({ getRejects: true })
  await flush()
  assert.equal(location.replaced, undefined)
})

test('an HTTP error on the read fails open', async () => {
  const { location } = loadModule({ getStatus: 500 })
  await flush()
  assert.equal(location.replaced, undefined)
})

test('a hung read is aborted at the timeout and fails open', async () => {
  const { location, clock, aborted } = loadModule({ getNeverSettles: true })
  await flush()
  assert.equal(location.replaced, undefined)
  await clock.advance(8000)
  assert.equal(location.replaced, undefined)
  assert.equal(aborted.length, 1)
})

test('a Memberstack that never loads times out and fails open', async () => {
  const { location, fetchCalls, clock } = loadModule({ memberstackMissing: true })
  await flush()
  await clock.advance(9000)
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('a rejected Memberstack cookie lookup fails open', async () => {
  const { location, fetchCalls } = loadModule({ memberstackRejects: true })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('the fresh-submit marker suppresses the redirect once and is cleared', async () => {
  const { location, fetchCalls, storage } = loadModule({ markerPresent: true })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0, 'no Xano call is spent on a skipped load')
  assert.equal(storage.store.has(MARKER_KEY), false, 'marker is consumed, not left behind')
})

test('the load after a consumed marker redirects normally', async () => {
  const first = loadModule({ markerPresent: true })
  await flush()
  assert.equal(first.location.replaced, undefined)

  // A second page load in the same tab: same storage contents, fresh module.
  const second = loadModule({ markerPresent: first.storage.store.has(MARKER_KEY) })
  await flush()
  assert.equal(second.location.replaced, DASHBOARD)
})

test('storage that throws (Safari private mode) does not break the redirect', async () => {
  const { location } = loadModule({ storageThrows: true })
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

// --- Scope gates --------------------------------------------------------------

test('does nothing on another page of the site', async () => {
  const fixture = formWrapper()
  const { location, fetchCalls } = loadModule({
    pathname: '/starter-dashboard',
    wrappers: [fixture],
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
  assert.equal(fixture.done.observers.length, 0, 'no submit watcher outside the onboarding page')
})

test('does nothing on an unapproved host', async () => {
  const fixture = formWrapper()
  const { location, fetchCalls } = loadModule({
    hostname: 'attacker.example',
    wrappers: [fixture],
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
  assert.equal(fixture.done.observers.length, 0)
})

test('runs on a cloudflared dev tunnel so the staging loop can QA it', async () => {
  const { location } = loadModule({ hostname: 'chain-bless-robot.trycloudflare.com' })
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

test('a second load of the same tag is a no-op (boot guard)', async () => {
  const { fetchCalls, run } = loadModule()
  run()
  await flush()
  assert.equal(callsTo(fetchCalls, GET_URL).length, 1)
})

test('the trailing-slash path form is in scope at runtime too', async () => {
  const { location } = loadModule({ pathname: '/starter-onboarding/' })
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

// --- Job 2: mark done on submit ----------------------------------------------

test('a Webflow success PATCHes the status endpoint with a bearer token', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({
    markerPresent: true, // skip job 1 so only the submit path is exercised
    wrappers: [fixture],
  })
  await flush()

  fixture.succeed()
  await flush()

  const patches = callsTo(fetchCalls, PATCH_URL)
  assert.equal(patches.length, 1)
  assert.equal(patches[0].config.method, 'PATCH')
  assert.equal(patches[0].config.headers.Authorization, 'Bearer xano-token-abc')
})

test('the fresh-submit marker is written before the PATCH goes out', async () => {
  const fixture = formWrapper()
  const { fetchCalls, storage } = loadModule({ markerPresent: true, wrappers: [fixture] })
  await flush()

  fixture.succeed()
  await flush()

  assert.equal(storage.store.get(MARKER_KEY), '1')
  const patches = callsTo(fetchCalls, PATCH_URL)
  assert.equal(patches[0].markerAtCall, '1', 'marker already present when the PATCH was issued')
})

test('a submit success fires at most once per form', async () => {
  const fixture = formWrapper()
  const { fetchCalls } = loadModule({ markerPresent: true, wrappers: [fixture] })
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
  const { fetchCalls } = loadModule({ markerPresent: true, wrappers: [full, consult] })
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
  const { fetchCalls } = loadModule({ markerPresent: true, wrappers: [fixture] })
  await flush()

  fixture.done.observers.slice().forEach((observer) => observer.fire())
  await flush()

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 0)
})

test('a done block already visible at boot is left to the marker, not PATCHed', async () => {
  const fixture = formWrapper({ doneVisible: true })
  const { fetchCalls } = loadModule({ markerPresent: true, wrappers: [fixture] })
  await flush()

  assert.equal(fixture.done.observers.length, 0)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 0)
})

test('a wrapper without a form or without a done block is skipped safely', async () => {
  const formless = formWrapper({ withForm: false })
  const doneless = formWrapper({ withDone: false })
  const { fetchCalls, logs } = loadModule({
    markerPresent: true,
    wrappers: [formless, doneless],
  })
  await flush()

  assert.equal(formless.done.observers.length, 0)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 0)
  assert.ok(logs.warn.some((line) => line.includes('.w-form-done')))
})

test('a failed PATCH is retried on the 1s/3s backoff and can still succeed', async () => {
  const fixture = formWrapper()
  const { fetchCalls, clock } = loadModule({
    markerPresent: true,
    wrappers: [fixture],
    patchOutcomes: ['fail', 'ok'],
  })
  await flush()

  fixture.succeed()
  await flush()
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 1)

  await clock.advance(1000)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 2)
  await clock.advance(3000)
  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 2, 'no attempt after a success')
})

test('three failures give up quietly with a staging-only warning', async () => {
  const fixture = formWrapper()
  const { fetchCalls, clock, logs } = loadModule({
    markerPresent: true,
    wrappers: [fixture],
    patchOutcomes: ['fail', 'reject', 'fail'],
  })
  await flush()

  fixture.succeed()
  await flush()
  await clock.advance(1000)
  await clock.advance(3000)
  await clock.advance(10000)

  assert.equal(callsTo(fetchCalls, PATCH_URL).length, 3, 'initial attempt plus two retries')
  assert.ok(logs.warn.some((line) => line.includes('gave up marking onboarding_done')))
})

test('production stays silent while staging logs', async () => {
  const quiet = loadModule({ hostname: 'www.thestarters.com', envelope: NOT_DONE_ENVELOPE })
  await flush()
  assert.equal(quiet.logs.warn.length + quiet.logs.info.length, 0)

  const loud = loadModule({ envelope: NOT_DONE_ENVELOPE })
  await flush()
  assert.ok(loud.logs.info.length > 0)
})

test('STARTERS_DEBUG turns logging on in production without changing behaviour', async () => {
  const { logs, location } = loadModule({
    hostname: 'www.thestarters.com',
    envelope: NOT_DONE_ENVELOPE,
    debug: true,
  })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.ok(logs.info.length > 0)
})

test('a deferred-late document waits for DOMContentLoaded before doing anything', async () => {
  const fixture = formWrapper()
  const { document, fetchCalls, location } = loadModule({
    readyState: 'loading',
    wrappers: [fixture],
  })
  await flush()
  assert.equal(fetchCalls.length, 0)
  assert.equal(fixture.done.observers.length, 0)

  document.listeners.DOMContentLoaded.forEach((handler) => handler())
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.equal(fixture.done.observers.length, 1)
})
