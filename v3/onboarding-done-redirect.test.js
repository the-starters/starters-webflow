const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./onboarding-done-redirect.js'), 'utf8')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const GET_URL = XANO + '/api:KZf7nFnk/starters_onboarding/get_freelancers'
const DASHBOARD = '/starter-dashboard'
const LOADER_SELECTOR = '[data-page-spinner]'
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

/**
 * The module keeps no state between loads any more, so storage is a recorder,
 * not a store: the tests below assert nothing here is ever called. The throwing
 * variant stands in for Safari private mode, where a stray call would surface as
 * a failure rather than as a silent regression.
 */
function makeSessionStorage({ throws = false } = {}) {
  const touches = []
  const guard = (call) => {
    touches.push(call)
    if (throws) throw new Error('SecurityError: storage is disabled')
  }
  return {
    touches,
    api: {
      getItem(key) {
        guard(['getItem', key])
        return null
      },
      setItem(key, value) {
        guard(['setItem', key, value])
      },
      removeItem(key) {
        guard(['removeItem', key])
      },
    },
  }
}

/**
 * The `[data-page-spinner]` element shared with the write half, in the state the
 * Designer authors it: hidden, and carrying the `hidden` attribute Webflow adds.
 */
function loaderElement({ withHiddenAttribute = true } = {}) {
  return {
    style: { display: 'none' },
    attributes: withHiddenAttribute ? { hidden: '' } : {},
    removeAttribute(name) {
      delete this.attributes[name]
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
  const loader = Object.prototype.hasOwnProperty.call(options, 'loader') ? options.loader : null

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
    fetchCalls.push({ url, config })

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
    querySelector(selector) {
      // Content blockers and exotic embeds have been seen to break lookups; the
      // decision must survive it.
      if (options.querySelectorThrows) throw new Error('querySelector is unavailable')
      return selector === LOADER_SELECTOR ? loader : null
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

// --- Redirect on visit --------------------------------------------------------

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

// The write half now hides the form and redirects the member itself, so there
// is no post-submit beat for this module to sit out: every load is a plain
// "have they already finished" check.

test('the redirect check never touches sessionStorage', async () => {
  const { location, storage } = loadModule()
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.deepEqual(storage.touches, [], 'no marker is read, written, or cleared')
  assert.equal(source.includes('sessionStorage'), false, 'and none is left in the source')
})

test('storage that throws (Safari private mode) does not break the redirect', async () => {
  const { location } = loadModule({ storageThrows: true })
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})

test('every load runs the check, including the one right after a submit', async () => {
  const first = loadModule()
  await flush()
  assert.equal(first.location.replaced, DASHBOARD)

  // A second page load in the same tab: nothing carries over between them.
  const second = loadModule()
  await flush()
  assert.equal(second.location.replaced, DASHBOARD)
  assert.equal(callsTo(second.fetchCalls, GET_URL).length, 1)
})

// --- The page spinner ---------------------------------------------------------
// The `[data-page-spinner]` element is shared with the write half, which raises
// it during its post-submit PATCH. This half owns it for the length of the
// load-time status read, and the two windows cannot overlap.

test('the spinner is raised before the status read begins', async () => {
  const loader = loaderElement()
  const { fetchCalls } = loadModule({ loader })

  assert.equal(loader.style.display, 'block', 'raised synchronously at boot')
  assert.equal(loader.attributes.hidden, undefined, 'the hidden attribute is cleared too')
  assert.equal(fetchCalls.length, 0, 'and before the first request goes out')
  await flush()
})

test('the spinner stays up while the redirect navigates', async () => {
  const loader = loaderElement()
  const { location } = loadModule({ loader })
  await flush()

  assert.equal(location.replaced, DASHBOARD)
  assert.equal(loader.style.display, 'block', 'uncovering the page would flash it on the way out')
})

test('the spinner comes down when the member is not done and the page renders', async () => {
  const loader = loaderElement()
  const { location } = loadModule({ loader, envelope: NOT_DONE_ENVELOPE })
  assert.equal(loader.style.display, 'block', 'up first, or the assertion below proves nothing')
  await flush()

  assert.equal(location.replaced, undefined)
  assert.equal(loader.style.display, 'none')
})

test('the spinner comes down for a logged-out visitor', async () => {
  const loader = loaderElement()
  const { location, fetchCalls } = loadModule({ loader, loggedOut: true })
  assert.equal(loader.style.display, 'block')
  await flush()

  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
  assert.equal(loader.style.display, 'none')
})

test('the spinner comes down on every read failure', async () => {
  for (const failure of [
    { getRejects: true },
    { getStatus: 500 },
    { tradeFails: true },
    { tradeRejects: true },
    { tradeBody: { nothing: true } },
    { memberstackRejects: true },
    { envelope: {} },
  ]) {
    const label = JSON.stringify(failure)
    const loader = loaderElement()
    const { location } = loadModule(Object.assign({ loader }, failure))
    assert.equal(loader.style.display, 'block', label)
    await flush()

    assert.equal(location.replaced, undefined, label)
    assert.equal(loader.style.display, 'none', label)
  }
})

test('the spinner comes down after a hung read times out', async () => {
  const loader = loaderElement()
  const { location, clock, aborted } = loadModule({ loader, getNeverSettles: true })
  await flush()
  assert.equal(loader.style.display, 'block', 'still covering the page while the read is in flight')

  await clock.advance(8000)

  assert.equal(aborted.length, 1)
  assert.equal(location.replaced, undefined)
  assert.equal(loader.style.display, 'none')
})

// The accepted cost of covering the page: a visitor whose Memberstack never
// arrives waits out the full budget before the page is uncovered.
test('a Memberstack that never loads holds the spinner for the 8s budget, then lowers it', async () => {
  const loader = loaderElement()
  const { location, clock } = loadModule({ loader, memberstackMissing: true })
  await flush()
  assert.equal(loader.style.display, 'block')

  await clock.advance(7900)
  assert.equal(loader.style.display, 'block', 'still waiting inside the budget')

  await clock.advance(200)
  assert.equal(loader.style.display, 'none')
  assert.equal(location.replaced, undefined)
})

// A refused navigation rejects the check, which is the one way a "go" answer
// ends with the member still here — so the page has to be uncovered after all.
test('a redirect the browser refuses brings the spinner back down', async () => {
  const loader = loaderElement()
  const { location, logs } = loadModule({ loader })
  location.replace = () => {
    throw new Error('navigation blocked')
  }
  await flush()

  assert.equal(loader.style.display, 'none')
  assert.ok(logs.warn.some((line) => line.includes('unexpected redirect-check failure')))
})

test('a spinner element built without the hidden attribute is still raised', async () => {
  const loader = loaderElement({ withHiddenAttribute: false })
  loadModule({ loader, envelope: NOT_DONE_ENVELOPE })
  assert.equal(loader.style.display, 'block')
  await flush()
  assert.equal(loader.style.display, 'none')
})

test('a page with no spinner element decides exactly the same way', async () => {
  const { location, logs, loader } = loadModule()
  assert.equal(loader, null, 'nothing to raise')
  await flush()

  assert.equal(location.replaced, DASHBOARD)
  assert.equal(logs.warn.length, 0, 'an unbuilt Designer element is not a fault')
  assert.ok(logs.info.some((line) => line.includes(LOADER_SELECTOR)))

  const staying = loadModule({ envelope: NOT_DONE_ENVELOPE })
  await flush()
  assert.equal(staying.location.replaced, undefined)
})

test('a querySelector that throws cannot stop the redirect', async () => {
  const { location, loader } = loadModule({ loader: loaderElement(), querySelectorThrows: true })
  await flush()
  assert.equal(location.replaced, DASHBOARD)
  assert.equal(loader.style.display, 'none', 'never reached, so never changed')

  const staying = loadModule({
    loader: loaderElement(),
    querySelectorThrows: true,
    envelope: NOT_DONE_ENVELOPE,
  })
  await flush()
  assert.equal(staying.location.replaced, undefined)
})

// Only the boot path drives the spinner, so the exposed diagnostic stays a pure
// read-and-decide that can be run from the console without the page moving.
test('redirectIfDone() called by hand leaves the spinner alone', async () => {
  const loader = loaderElement()
  const { api } = loadModule({ loader, pathname: '/other', envelope: NOT_DONE_ENVELOPE })
  await flush()
  assert.equal(loader.style.display, 'none', 'untouched: this load never booted')

  const done = await api.redirectIfDone()
  assert.equal(done, false)
  assert.equal(loader.style.display, 'none', 'still untouched')
})

// --- Scope gates --------------------------------------------------------------

test('does nothing on another page of the site', async () => {
  const { location, fetchCalls } = loadModule({ pathname: '/starter-dashboard' })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('does nothing on an unapproved host', async () => {
  const { location, fetchCalls } = loadModule({ hostname: 'attacker.example' })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
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

// --- Diagnostics and boot -----------------------------------------------------

test('the exposed console surface is the read half only', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.deepEqual(Object.keys(api).sort(), [
    'allowedHost',
    'dashboardPath',
    'diagnosticsEnabled',
    'isOnboardingPath',
    'loaderSelector',
    'onboardingDone',
    'redirectIfDone',
    'stagingHost',
  ])
  assert.equal(api.dashboardPath, DASHBOARD)
  assert.equal(api.loaderSelector, LOADER_SELECTOR)
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
  const { document, fetchCalls, location } = loadModule({ readyState: 'loading' })
  await flush()
  assert.equal(fetchCalls.length, 0)

  document.listeners.DOMContentLoaded.forEach((handler) => handler())
  await flush()
  assert.equal(location.replaced, DASHBOARD)
})
