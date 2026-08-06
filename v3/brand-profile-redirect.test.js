const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./brand-profile-redirect.js'), 'utf8')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const STATUS_URL = XANO + '/api:KZf7nFnk/starters_onboarding/get_brand_profile_status'
const BRAND_DASHBOARD = '/brand-dashboard'
const COMPLETE_PROFILE = '/complete-profile'
const MARKER_KEY = 'thestarters:v3-brand-profile-completed'
const LOADER_SELECTOR = '[data-page-spinner]'

// The one envelope that redirects, and its three near neighbours that do not.
const UNFINISHED = { has_record: true, brand_profile_done: false }
const FINISHED = { has_record: true, brand_profile_done: true }
const NO_RECORD = { has_record: false, brand_profile_done: false }

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * A deterministic clock driving both `Date.now()` and the module's timers, so the
 * 8s request and Memberstack budgets are testable without waiting for them.
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
 * The webhook-latency bridge written by brand-account-controller.js. Recorded as
 * well as stored, so the tests can prove the module only ever READS it — this file
 * must never write or clear the marker. The throwing variant stands in for Safari
 * private mode; the `hostile` variant is the harsher case where touching the
 * property itself throws.
 */
function makeSessionStorage({ throws = false, marker } = {}) {
  const touches = []
  const store = new Map()
  if (marker !== undefined) store.set(MARKER_KEY, marker)
  return {
    touches,
    store,
    api: {
      getItem(key) {
        touches.push(['getItem', key])
        if (throws) throw new Error('SecurityError: storage is disabled')
        return store.has(key) ? store.get(key) : null
      },
      setItem(key, value) {
        touches.push(['setItem', key, value])
        if (throws) throw new Error('SecurityError: storage is disabled')
        store.set(key, value)
      },
      removeItem(key) {
        touches.push(['removeItem', key])
        if (throws) throw new Error('SecurityError: storage is disabled')
        store.delete(key)
      },
    },
  }
}

/**
 * The `[data-page-spinner]` element in the state the Designer authors it: hidden,
 * and carrying the `hidden` attribute Webflow adds.
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
  const pathname = options.pathname || BRAND_DASHBOARD
  const fetchCalls = []
  const aborted = []
  const logs = { warn: [], info: [] }
  const storage = makeSessionStorage({ throws: options.storageThrows, marker: options.marker })
  const loader = Object.prototype.hasOwnProperty.call(options, 'loader') ? options.loader : null

  const location = {
    hostname,
    pathname,
    search: '',
    href: 'https://' + hostname + pathname,
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

    if (url === STATUS_URL) {
      if (options.statusNeverSettles) return new Promise(() => {})
      if (options.statusRejects) throw new Error('status network failure')
      if (options.statusCode) return jsonResponse(null, { ok: false, status: options.statusCode })
      if (options.statusBodyUnparseable) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('Unexpected token < in JSON')
          },
        }
      }
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(options, 'envelope') ? options.envelope : UNFINISHED,
      )
    }

    throw new Error('unexpected fetch: ' + url)
  }

  const window = {
    location,
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

  // Three storage shapes: the normal recorder, absent entirely, and a property
  // whose getter throws the way Safari private mode does.
  if (options.storageAbsent) {
    window.sessionStorage = undefined
  } else if (options.storageGetterThrows) {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('SecurityError: storage is disabled')
      },
    })
  } else {
    window.sessionStorage = storage.api
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
    api: window.StartersBrandProfileRedirect,
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

test('only the two /brand-dashboard path forms are in scope', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.isBrandDashboardPath('/brand-dashboard'), true)
  assert.equal(api.isBrandDashboardPath('/brand-dashboard/'), true)
  assert.equal(api.isBrandDashboardPath('/brand-dashboard/settings'), false)
  assert.equal(api.isBrandDashboardPath('/brand-dashboard-old'), false)
  assert.equal(api.isBrandDashboardPath('/complete-profile'), false)
  assert.equal(api.isBrandDashboardPath('/starter-dashboard'), false)
  assert.equal(api.isBrandDashboardPath('/'), false)
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

test('only has_record true plus brand_profile_done false asks for the form', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.needsBrandProfile(UNFINISHED), true)
  assert.equal(api.needsBrandProfile(FINISHED), false)
  assert.equal(api.needsBrandProfile(NO_RECORD), false)
  // has_record must be a literal true.
  assert.equal(api.needsBrandProfile({ has_record: 'true', brand_profile_done: false }), false)
  assert.equal(api.needsBrandProfile({ has_record: 1, brand_profile_done: false }), false)
  assert.equal(api.needsBrandProfile({ brand_profile_done: false }), false)
  // brand_profile_done must be a literal false.
  assert.equal(api.needsBrandProfile({ has_record: true, brand_profile_done: 'false' }), false)
  assert.equal(api.needsBrandProfile({ has_record: true, brand_profile_done: 0 }), false)
  assert.equal(api.needsBrandProfile({ has_record: true, brand_profile_done: null }), false)
  assert.equal(api.needsBrandProfile({ has_record: true }), false)
  // Nothing usable at all.
  assert.equal(api.needsBrandProfile({}), false)
  assert.equal(api.needsBrandProfile(null), false)
  assert.equal(api.needsBrandProfile(undefined), false)
  assert.equal(api.needsBrandProfile('not-an-object'), false)
  assert.equal(api.needsBrandProfile([]), false)
})

test('the marker counts only as a non-empty value', () => {
  const cases = [
    [undefined, false],
    ['', false],
    ['   ', false],
    ['1', true],
    ['2026-08-06T12:00:00.000Z', true],
    ['true', true],
  ]
  for (const [marker, expected] of cases) {
    const { api } = loadModule({ pathname: '/other', marker })
    assert.equal(api.completionMarkerSet(), expected, JSON.stringify(marker))
  }
})

// --- Redirect on visit --------------------------------------------------------

test('an unfinished Brand is replaced to /complete-profile with a bearer-authorized read', async () => {
  const { location, fetchCalls } = loadModule()
  await flush()

  assert.equal(location.replaced, COMPLETE_PROFILE)
  const reads = callsTo(fetchCalls, STATUS_URL)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].config.headers.Authorization, 'Bearer xano-token-abc')
  assert.ok(urlsOf(fetchCalls)[0].startsWith(TRADE_URL + '?token='))
})

test('a finished Brand stays on the dashboard', async () => {
  const { location, fetchCalls } = loadModule({ envelope: FINISHED })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('has_record false stays on the dashboard (the wrong-role answer too)', async () => {
  const { location } = loadModule({ envelope: NO_RECORD })
  await flush()
  assert.equal(location.replaced, undefined)

  // A record-less member with no done flag at all reads the same way.
  const bare = loadModule({ envelope: { has_record: false } })
  await flush()
  assert.equal(bare.location.replaced, undefined)
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
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 0)
})

test('a rejected token trade fails open', async () => {
  const { location, fetchCalls } = loadModule({ tradeRejects: true })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 0)
})

test('a token trade that returns no usable token fails open', async () => {
  const { location, fetchCalls } = loadModule({ tradeBody: { nothing: true } })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 0)
})

test('a rejected read fails open', async () => {
  const { location } = loadModule({ statusRejects: true })
  await flush()
  assert.equal(location.replaced, undefined)
})

test('an HTTP error on the read fails open', async () => {
  for (const statusCode of [401, 403, 404, 500, 502]) {
    const { location } = loadModule({ statusCode })
    await flush()
    assert.equal(location.replaced, undefined, String(statusCode))
  }
})

test('a malformed body fails open', async () => {
  // Both shapes: JSON that will not parse, and JSON that parses to the wrong thing.
  const unparseable = loadModule({ statusBodyUnparseable: true })
  await flush()
  assert.equal(unparseable.location.replaced, undefined)

  for (const envelope of [null, 'ok', 42, [], { unexpected: 'shape' }]) {
    const { location } = loadModule({ envelope })
    await flush()
    assert.equal(location.replaced, undefined, JSON.stringify(envelope))
  }
})

test('a hung read is aborted at the timeout and fails open', async () => {
  const { location, clock, aborted } = loadModule({ statusNeverSettles: true })
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

// --- The completion marker ----------------------------------------------------
// Written by brand-account-controller.js right after a successful submit, to
// bridge the Memberstack → Xano webhook latency. Read here, never written.

test('the marker short-circuits the whole check: no fetch, no redirect', async () => {
  const { location, fetchCalls, logs } = loadModule({
    marker: '2026-08-06T12:00:00.000Z',
    // Xano would say "unfinished" — the marker is the only reason this stays.
    envelope: UNFINISHED,
  })
  await flush()

  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0, 'not even the token trade goes out')
  assert.ok(logs.info.some((line) => line.includes('completion marker is set')))
})

test('the marker is read from the agreed key and never written or cleared', async () => {
  const { storage, api } = loadModule({ marker: '1' })
  await flush()

  assert.deepEqual(storage.touches, [['getItem', MARKER_KEY]])
  assert.equal(api.markerKey, MARKER_KEY)
  assert.equal(storage.store.get(MARKER_KEY), '1', 'left exactly as the controller wrote it')
  assert.equal(source.includes('setItem'), false, 'no write path in the source')
  assert.equal(source.includes('removeItem'), false, 'no clear path in the source')
})

test('an empty marker value is not a marker and the check runs normally', async () => {
  const { location, fetchCalls } = loadModule({ marker: '   ' })
  await flush()
  assert.equal(location.replaced, COMPLETE_PROFILE)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('storage that throws (Safari private mode) does not break the decision', async () => {
  const throwing = loadModule({ storageThrows: true, envelope: FINISHED })
  await flush()
  assert.equal(throwing.location.replaced, undefined)
  assert.equal(callsTo(throwing.fetchCalls, STATUS_URL).length, 1, 'falls through to the read')

  const redirecting = loadModule({ storageThrows: true })
  await flush()
  assert.equal(redirecting.location.replaced, COMPLETE_PROFILE)
})

test('a sessionStorage property that throws on access is survivable', async () => {
  const { location, fetchCalls } = loadModule({ storageGetterThrows: true })
  await flush()
  assert.equal(location.replaced, COMPLETE_PROFILE)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('no sessionStorage at all is survivable', async () => {
  const { location, fetchCalls } = loadModule({ storageAbsent: true, envelope: FINISHED })
  await flush()
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

// --- The page spinner ---------------------------------------------------------

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

  assert.equal(location.replaced, COMPLETE_PROFILE)
  assert.equal(loader.style.display, 'block', 'uncovering the page would flash it on the way out')
})

test('the spinner comes down when the Brand is finished and the dashboard renders', async () => {
  const loader = loaderElement()
  const { location } = loadModule({ loader, envelope: FINISHED })
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

test('the spinner comes down on the marker short-circuit', async () => {
  const loader = loaderElement()
  const { location, fetchCalls } = loadModule({ loader, marker: '1' })
  assert.equal(loader.style.display, 'block')
  await flush()

  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
  assert.equal(loader.style.display, 'none')
})

test('the spinner comes down on every read failure', async () => {
  for (const failure of [
    { statusRejects: true },
    { statusCode: 500 },
    { statusBodyUnparseable: true },
    { tradeFails: true },
    { tradeRejects: true },
    { tradeBody: { nothing: true } },
    { memberstackRejects: true },
    { envelope: NO_RECORD },
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
  const { location, clock, aborted } = loadModule({ loader, statusNeverSettles: true })
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

// A refused navigation rejects the check, which is the one way a "go" answer ends
// with the member still here — so the page has to be uncovered after all.
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
  loadModule({ loader, envelope: FINISHED })
  assert.equal(loader.style.display, 'block')
  await flush()
  assert.equal(loader.style.display, 'none')
})

test('a page with no spinner element decides exactly the same way', async () => {
  const { location, logs, loader } = loadModule()
  assert.equal(loader, null, 'nothing to raise')
  await flush()

  assert.equal(location.replaced, COMPLETE_PROFILE)
  assert.equal(logs.warn.length, 0, 'an unbuilt Designer element is not a fault')
  assert.ok(logs.info.some((line) => line.includes(LOADER_SELECTOR)))

  const staying = loadModule({ envelope: FINISHED })
  await flush()
  assert.equal(staying.location.replaced, undefined)
})

test('a querySelector that throws cannot stop the redirect', async () => {
  const { location, loader } = loadModule({ loader: loaderElement(), querySelectorThrows: true })
  await flush()
  assert.equal(location.replaced, COMPLETE_PROFILE)
  assert.equal(loader.style.display, 'none', 'never reached, so never changed')

  const staying = loadModule({
    loader: loaderElement(),
    querySelectorThrows: true,
    envelope: FINISHED,
  })
  await flush()
  assert.equal(staying.location.replaced, undefined)
})

// Only the boot path drives the spinner, so the exposed diagnostic stays a pure
// read-and-decide that can be run from the console without the page moving.
test('redirectIfIncomplete() called by hand leaves the spinner alone', async () => {
  const loader = loaderElement()
  const { api } = loadModule({ loader, pathname: '/other', envelope: FINISHED })
  await flush()
  assert.equal(loader.style.display, 'none', 'untouched: this load never booted')

  const redirecting = await api.redirectIfIncomplete()
  assert.equal(redirecting, false)
  assert.equal(loader.style.display, 'none', 'still untouched')
})

// --- Scope gates --------------------------------------------------------------

test('does nothing on another page of the site', async () => {
  for (const pathname of ['/complete-profile', '/starter-dashboard', '/brand-dashboard/settings', '/']) {
    const { location, fetchCalls, storage } = loadModule({ pathname })
    await flush()
    assert.equal(location.replaced, undefined, pathname)
    assert.equal(fetchCalls.length, 0, pathname)
    assert.deepEqual(storage.touches, [], pathname)
  }
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
  assert.equal(location.replaced, COMPLETE_PROFILE)
})

test('the trailing-slash path form is in scope at runtime too', async () => {
  const { location } = loadModule({ pathname: '/brand-dashboard/' })
  await flush()
  assert.equal(location.replaced, COMPLETE_PROFILE)
})

test('a second load of the same tag is a no-op (boot guard)', async () => {
  const { fetchCalls, run } = loadModule()
  run()
  await flush()
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('the module never sends anyone to the page it lives on', async () => {
  const { location } = loadModule()
  await flush()
  assert.notEqual(location.replaced, BRAND_DASHBOARD)
  assert.equal(source.includes("replace('/brand-dashboard')"), false)
})

// --- Diagnostics, release marker, and boot ------------------------------------

test('the exposed console surface is the read half only', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.deepEqual(Object.keys(api).sort(), [
    'allowedHost',
    'brandDashboardPaths',
    'completeProfilePath',
    'completionMarkerSet',
    'diagnosticsEnabled',
    'isBrandDashboardPath',
    'loaderSelector',
    'markerKey',
    'needsBrandProfile',
    'redirectIfIncomplete',
    'release',
    'stagingHost',
  ])
  assert.equal(api.completeProfilePath, COMPLETE_PROFILE)
  assert.equal(api.loaderSelector, LOADER_SELECTOR)
  assert.equal(api.markerKey, MARKER_KEY)
  // Array.from because the module's copy is built inside the vm realm.
  assert.deepEqual(Array.from(api.brandDashboardPaths), ['/brand-dashboard', '/brand-dashboard/'])
})

test('the exposed paths array cannot be mutated from the console', () => {
  const { api } = loadModule({ pathname: '/other' })
  api.brandDashboardPaths.push('/anything')
  assert.equal(api.isBrandDashboardPath('/anything'), false)
})

// The release-marker convention: the header line and the exported property must
// agree, so a served file can be identified by grep. Deliberately tolerant of the
// `vX.Y.Z` placeholder the orchestrator stamps at release time.
test('the header @release marker matches the exported release property', () => {
  const { api } = loadModule({ pathname: '/other' })
  const marker = source.match(/^ \* @release (\S+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the brand-profile-redirect.js header')
  assert.equal(api.release, marker[1])
  assert.match(marker[1], /^v(\d+\.\d+\.\d+|X\.Y\.Z)$/)
})

test('the file is raw JavaScript with no script wrapper', () => {
  assert.equal(source.includes('<script'), false)
  assert.equal(source.includes('</script'), false)
})

test('production stays silent while staging logs', async () => {
  const quiet = loadModule({ hostname: 'www.thestarters.com', envelope: FINISHED })
  await flush()
  assert.equal(quiet.logs.warn.length + quiet.logs.info.length, 0)

  const loud = loadModule({ envelope: FINISHED })
  await flush()
  assert.ok(loud.logs.info.length > 0)
})

test('STARTERS_DEBUG turns logging on in production without changing behaviour', async () => {
  const { logs, location } = loadModule({
    hostname: 'www.thestarters.com',
    envelope: FINISHED,
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
  assert.equal(location.replaced, COMPLETE_PROFILE)
})
