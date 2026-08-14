const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./starter-profile-redirect.js'), 'utf8')
const routeGuardSource = fs.readFileSync(require.resolve('./route-guard.js'), 'utf8')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const STATUS_URL = XANO + '/api:KZf7nFnk/starters_onboarding/get_build_profile_status'
const STARTER_DASHBOARD = '/starter-dashboard'
const BUILD_PROFILE = '/build-profile/select-profile'
const ONBOARDING = '/starter-onboarding'
const LOADER_SELECTOR = '[data-page-spinner]'

const ONBOARDED = {
  has_record: true,
  build_profile_done: true,
  onboarding_done: true,
  profile_type: 'Full',
  platform_status: 'approved',
}
const NEEDS_ONBOARDING = {
  has_record: true,
  build_profile_done: true,
  onboarding_done: false,
  profile_type: 'Full',
  platform_status: 'approved',
}
const UNFINISHED_WITH_ROW = {
  has_record: true,
  build_profile_done: false,
  onboarding_done: false,
  profile_type: '',
  platform_status: '',
}
const NO_RECORD = {
  has_record: false,
  build_profile_done: false,
  onboarding_done: false,
  profile_type: '',
  platform_status: '',
}

function plan(planId) {
  return { active: true, planId }
}

const TALENT = {
  id: 'm-talent',
  planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
}
const BRAND_PAID = {
  id: 'm-brand-paid',
  planConnections: [plan('pln_new-paid-plan-463h04ph')],
}
const BRAND_FREE = {
  id: 'm-brand-free',
  planConnections: [plan('pln_free-plan-f6kn0dxz')],
}
const UNMAPPED = { id: 'm-unknown', planConnections: [plan('pln_unknown')] }
const CONFLICTED = {
  id: 'm-conflict',
  planConnections: [
    plan('pln_dorxata-test-free-plan-dvcg0k8o'),
    plan('pln_new-paid-plan-463h04ph'),
  ],
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

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
  const pathname = Object.prototype.hasOwnProperty.call(options, 'pathname')
    ? options.pathname
    : STARTER_DASHBOARD
  const fetchCalls = []
  const aborted = []
  const logs = { warn: [], info: [], error: [] }
  const loader = Object.prototype.hasOwnProperty.call(options, 'loader') ? options.loader : null

  const location = {
    hostname,
    origin: 'https://' + hostname,
    pathname,
    search: '',
    href: 'https://' + hostname + pathname,
    replace(value) {
      location.replaced = value
    },
  }

  async function fetchStub(url, config = {}) {
    fetchCalls.push({ url: String(url), config })

    if (String(url).indexOf(TRADE_URL) === 0) {
      if (options.tradeRejects) throw new Error('trade network failure')
      if (options.tradeFails) return jsonResponse(null, { ok: false, status: 401 })
      return jsonResponse(
        Object.prototype.hasOwnProperty.call(options, 'tradeBody')
          ? options.tradeBody
          : 'xano-token-abc',
      )
    }

    if (String(url) === STATUS_URL) {
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
        Object.prototype.hasOwnProperty.call(options, 'envelope')
          ? options.envelope
          : UNFINISHED_WITH_ROW,
      )
    }

    throw new Error('unexpected fetch: ' + url)
  }

  const window = {
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.name = name
        this.detail = init && init.detail
      }
    },
    URL,
    URLSearchParams,
    dispatchEvent() {},
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

  if (options.debug) window.STARTERS_DEBUG = true

  function memberstackFor(member) {
    const api = {
      getCurrentMember: async () => {
        if (options.memberLookupRejects) throw new Error('member lookup failure')
        return { data: member }
      },
    }
    if (!options.cookieMissing) {
      api.getMemberCookie = async () => {
        if (options.memberstackRejects) throw new Error('memberstack failure')
        return options.loggedOutCookie ? null : 'ms-jwt'
      }
    }
    return api
  }

  if (!options.memberstackMissing) {
    window.$memberstackDom = memberstackFor(
      Object.prototype.hasOwnProperty.call(options, 'member') ? options.member : TALENT,
    )
  }

  const document = {
    readyState: options.readyState || 'complete',
    documentElement: {
      setAttribute() {},
    },
    querySelector(selector) {
      if (options.querySelectorThrows) throw new Error('querySelector is unavailable')
      return selector === LOADER_SELECTOR ? loader : null
    },
    querySelectorAll() {
      return []
    },
    listeners: {},
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
    URL,
    URLSearchParams,
    CustomEvent: window.CustomEvent,
    console: {
      warn: (message) => logs.warn.push(message),
      info: (message) => logs.info.push(message),
      error: (message) => logs.error.push(message),
    },
  })

  const run = () => vm.runInContext(source, context)

  if (!options.roleContractMissing) {
    location.pathname = '/harness-neutral-unguarded-path'
    vm.runInContext(routeGuardSource, context)
    location.pathname = pathname
  }
  run()

  return {
    api: window.StartersStarterProfileRedirect,
    aborted,
    clock,
    document,
    fetchCalls,
    loader,
    location,
    logs,
    run,
    window,
  }
}

const urlsOf = (calls) => calls.map((call) => call.url)
const callsTo = (calls, url) => calls.filter((call) => call.url === url)

async function settled(harness) {
  await flush()
  await flush()
  return harness
}

test('the Talent lock pages are in scope, including slash twins and opp detail', () => {
  const { api } = loadModule({ pathname: '/other' })
  const inScope = [
    '/brand-dashboard',
    '/brand-dashboard/',
    '/opportunities',
    '/opportunities/',
    '/opportunities/product-designer',
    '/opportunities/product-designer/',
    '/all-starters',
    '/all-starters/',
    '/messages',
    '/messages/',
    '/starter-dashboard',
    '/starter-dashboard/',
    '/dashboard',
    '/dashboard/',
  ]
  for (const path of inScope) {
    assert.equal(api.isGuardedPath(path), true, path)
  }
  const outOfScope = [
    '/brand-dashboard/settings',
    '/complete-profile',
    '/opportunities/product-designer/apply',
    '/opportunities-brands-view',
    '/favorites',
    '/starter-onboarding',
    '/build-profile/select-profile',
    '/',
  ]
  for (const path of outOfScope) {
    assert.equal(api.isGuardedPath(path), false, path)
  }
})

test('neither redirect destination is itself a scoped page (no loop)', () => {
  const { api } = loadModule({ pathname: '/other' })
  for (const destination of [api.buildProfilePath, api.onboardingPath]) {
    assert.equal(api.isGuardedPath(destination), false, destination)
  }
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

test('the status body maps to a funnel position, mirroring auth-route', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.funnelStateFrom(NO_RECORD), 'build-profile')
  assert.equal(api.funnelStateFrom(UNFINISHED_WITH_ROW), 'build-profile')
  assert.equal(api.funnelStateFrom(NEEDS_ONBOARDING), 'onboarding')
  assert.equal(api.funnelStateFrom(ONBOARDED), 'done')
})

test('only a literal false on build_profile_done means "still building"', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.funnelStateFrom(null), 'unknown')
  assert.equal(api.funnelStateFrom({}), 'unknown')
  assert.equal(api.funnelStateFrom({ build_profile_done: 'false' }), 'unknown')
  assert.equal(api.funnelStateFrom({ build_profile_done: 0 }), 'unknown')
  assert.equal(api.funnelStateFrom({ build_profile_done: null }), 'unknown')
})

test('only a literal true on onboarding_done counts as onboarded', () => {
  const { api } = loadModule({ pathname: '/other' })
  for (const onboarding_done of ['true', 1, {}, null, undefined]) {
    assert.equal(
      api.funnelStateFrom({ build_profile_done: true, onboarding_done }),
      'onboarding',
      String(onboarding_done),
    )
  }
  assert.equal(
    api.funnelStateFrom({ build_profile_done: true, onboarding_done: true }),
    'done',
  )
})

test('destinationForState only moves the two unfinished positions', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.equal(api.destinationForState('build-profile'), BUILD_PROFILE)
  assert.equal(api.destinationForState('onboarding'), ONBOARDING)
  assert.equal(api.destinationForState('done'), null)
  assert.equal(api.destinationForState('unknown'), null)
})

test('an unfinished Talent is replaced to /build-profile/select-profile with a bearer-authorized read', async () => {
  const { location, fetchCalls } = await settled(loadModule())

  assert.equal(location.replaced, BUILD_PROFILE)
  const reads = callsTo(fetchCalls, STATUS_URL)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].config.headers.Authorization, 'Bearer xano-token-abc')
  assert.ok(urlsOf(fetchCalls)[0].startsWith(TRADE_URL + '?token='))
})

test('a Talent who finished Build-profile but not onboarding goes to /starter-onboarding', async () => {
  const { location, fetchCalls } = await settled(loadModule({ envelope: NEEDS_ONBOARDING }))
  assert.equal(location.replaced, ONBOARDING)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('a finished Talent stays on the dashboard', async () => {
  const { location, fetchCalls } = await settled(loadModule({ envelope: ONBOARDED }))
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('no-record Talent (never built) is sent to Build-profile, same as login', async () => {
  const { location } = await settled(loadModule({ envelope: NO_RECORD }))
  assert.equal(location.replaced, BUILD_PROFILE)
})

test('a logged-out visitor never reaches Xano and is not redirected', async () => {
  const { location, fetchCalls } = await settled(loadModule({ member: null }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('a paid Brand never reaches Xano and is not redirected', async () => {
  const { location, fetchCalls } = await settled(loadModule({ member: BRAND_PAID }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('a free Brand never reaches Xano and is not redirected', async () => {
  const { location, fetchCalls } = await settled(loadModule({ member: BRAND_FREE }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('an unmapped member never reaches Xano and is not redirected', async () => {
  const { location, fetchCalls } = await settled(loadModule({ member: UNMAPPED }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('a Talent+Brand conflict never reaches Xano and is not redirected', async () => {
  const { location, fetchCalls } = await settled(loadModule({ member: CONFLICTED }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('a missing role contract fails open with no Xano call', async () => {
  const { location, fetchCalls, logs } = await settled(loadModule({ roleContractMissing: true }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
  assert.ok(logs.warn.some((line) => String(line).includes('role contract unavailable')))
})

test('a failed token trade fails open', async () => {
  const { location, fetchCalls } = await settled(loadModule({ tradeFails: true }))
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 0)
})

test('a rejected token trade fails open', async () => {
  const { location, fetchCalls } = await settled(loadModule({ tradeRejects: true }))
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 0)
})

test('a token trade that returns no usable token fails open', async () => {
  const { location, fetchCalls } = await settled(loadModule({ tradeBody: { nothing: true } }))
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 0)
})

test('a rejected read fails open', async () => {
  const { location } = await settled(loadModule({ statusRejects: true }))
  assert.equal(location.replaced, undefined)
})

test('an HTTP error on the read fails open', async () => {
  for (const statusCode of [401, 403, 404, 500, 502]) {
    const { location } = await settled(loadModule({ statusCode }))
    assert.equal(location.replaced, undefined, String(statusCode))
  }
})

test('a malformed body fails open', async () => {
  const unparseable = await settled(loadModule({ statusBodyUnparseable: true }))
  assert.equal(unparseable.location.replaced, undefined)

  for (const envelope of [null, 'ok', 42, [], { unexpected: 'shape' }]) {
    const { location } = await settled(loadModule({ envelope }))
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
  const { location, fetchCalls } = await settled(loadModule({ memberstackRejects: true }))
  assert.equal(location.replaced, undefined)
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 0)
})

test('a rejected getCurrentMember lookup fails open with no Xano call', async () => {
  const { location, fetchCalls } = await settled(loadModule({ memberLookupRejects: true }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('there is no completion-marker short-circuit in this module', () => {
  assert.equal(source.includes('thestarters:v3-brand-profile-completed'), false)
  assert.equal(source.includes('completionMarker'), false)
  assert.equal(/\bsessionStorage\s*\./.test(source), false)
})

test('the spinner is raised before the status read begins', async () => {
  const loader = loaderElement()
  const { fetchCalls } = loadModule({ loader })

  assert.equal(loader.style.display, 'block', 'raised synchronously at boot')
  assert.equal(loader.attributes.hidden, undefined)
  assert.equal(fetchCalls.length, 0)
  await flush()
})

test('the spinner stays up while the redirect navigates', async () => {
  const loader = loaderElement()
  const { location } = await settled(loadModule({ loader }))

  assert.equal(location.replaced, BUILD_PROFILE)
  assert.equal(loader.style.display, 'block')
})

test('the spinner comes down when the Talent is finished and the dashboard renders', async () => {
  const loader = loaderElement()
  const { location } = loadModule({ loader, envelope: ONBOARDED })
  assert.equal(loader.style.display, 'block')
  await settled({ location })

  assert.equal(location.replaced, undefined)
  assert.equal(loader.style.display, 'none')
})

test('the spinner comes down for a logged-out visitor', async () => {
  const loader = loaderElement()
  const { location, fetchCalls } = await settled(loadModule({ loader, member: null }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
  assert.equal(loader.style.display, 'none')
})

test('the spinner comes down for a Brand (role gate, no Xano)', async () => {
  const loader = loaderElement()
  const { location, fetchCalls } = await settled(loadModule({ loader, member: BRAND_PAID }))
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
    { envelope: {} },
  ]) {
    const label = JSON.stringify(failure)
    const loader = loaderElement()
    const { location } = await settled(loadModule(Object.assign({ loader }, failure)))

    assert.equal(location.replaced, undefined, label)
    assert.equal(loader.style.display, 'none', label)
  }
})

test('the spinner comes down after a hung read times out', async () => {
  const loader = loaderElement()
  const { location, clock, aborted } = loadModule({ loader, statusNeverSettles: true })
  await flush()
  assert.equal(loader.style.display, 'block')

  await clock.advance(8000)

  assert.equal(aborted.length, 1)
  assert.equal(location.replaced, undefined)
  assert.equal(loader.style.display, 'none')
})

test('a Memberstack that never loads holds the spinner for the 8s budget, then lowers it', async () => {
  const loader = loaderElement()
  const { location, clock } = loadModule({ loader, memberstackMissing: true })
  await flush()
  assert.equal(loader.style.display, 'block')

  await clock.advance(7900)
  assert.equal(loader.style.display, 'block')

  await clock.advance(200)
  assert.equal(loader.style.display, 'none')
  assert.equal(location.replaced, undefined)
})

test('a redirect the browser refuses brings the spinner back down', async () => {
  const loader = loaderElement()
  const { location, logs } = loadModule({ loader })
  location.replace = () => {
    throw new Error('navigation blocked')
  }
  await settled({ location })

  assert.equal(loader.style.display, 'none')
  assert.ok(logs.warn.some((line) => String(line).includes('unexpected redirect-check failure')))
})

test('a spinner element built without the hidden attribute is still raised', async () => {
  const loader = loaderElement({ withHiddenAttribute: false })
  loadModule({ loader, envelope: ONBOARDED })
  assert.equal(loader.style.display, 'block')
  await flush()
  await flush()
  assert.equal(loader.style.display, 'none')
})

test('a page with no spinner element decides exactly the same way', async () => {
  const { location, logs, loader } = await settled(loadModule())
  assert.equal(loader, null)

  assert.equal(location.replaced, BUILD_PROFILE)
  assert.equal(logs.warn.length, 0)
  assert.ok(logs.info.some((line) => String(line).includes(LOADER_SELECTOR)))

  const staying = await settled(loadModule({ envelope: ONBOARDED }))
  assert.equal(staying.location.replaced, undefined)
})

test('a querySelector that throws cannot stop the redirect', async () => {
  const { location, loader } = await settled(
    loadModule({ loader: loaderElement(), querySelectorThrows: true }),
  )
  assert.equal(location.replaced, BUILD_PROFILE)
  assert.equal(loader.style.display, 'none')

  const staying = await settled(
    loadModule({
      loader: loaderElement(),
      querySelectorThrows: true,
      envelope: ONBOARDED,
    }),
  )
  assert.equal(staying.location.replaced, undefined)
})

test('redirectIfIncomplete() called by hand leaves the spinner alone', async () => {
  const loader = loaderElement()
  const { api } = loadModule({ loader, pathname: '/other', envelope: ONBOARDED })
  await flush()
  assert.equal(loader.style.display, 'none')

  const redirecting = await api.redirectIfIncomplete()
  assert.equal(redirecting, false)
  assert.equal(loader.style.display, 'none')
})

test('does nothing on another page of the site', async () => {
  for (const pathname of [
    '/complete-profile',
    '/starter-onboarding',
    '/build-profile/select-profile',
    '/opportunities/x/apply',
    '/favorites',
    '/',
  ]) {
    const { location, fetchCalls } = await settled(loadModule({ pathname }))
    assert.equal(location.replaced, undefined, pathname)
    assert.equal(fetchCalls.length, 0, pathname)
  }
})

test('each expanded lock page redirects an unfinished Talent', async () => {
  for (const pathname of [
    '/brand-dashboard',
    '/opportunities',
    '/opportunities/',
    '/opportunities/acme-role',
    '/all-starters',
    '/messages',
    '/dashboard',
  ]) {
    const { location, fetchCalls } = await settled(loadModule({ pathname }))
    assert.equal(location.replaced, BUILD_PROFILE, pathname)
    assert.ok(callsTo(fetchCalls, STATUS_URL).length >= 1, pathname)
  }
})

test('does nothing on an unapproved host', async () => {
  const { location, fetchCalls } = await settled(loadModule({ hostname: 'attacker.example' }))
  assert.equal(location.replaced, undefined)
  assert.equal(fetchCalls.length, 0)
})

test('runs on a cloudflared dev tunnel so the staging loop can QA it', async () => {
  const { location } = await settled(
    loadModule({ hostname: 'chain-bless-robot.trycloudflare.com' }),
  )
  assert.equal(location.replaced, BUILD_PROFILE)
})

test('the trailing-slash path form is in scope at runtime too', async () => {
  for (const pathname of ['/starter-dashboard/', '/all-starters/', '/messages/', '/dashboard/']) {
    const { location } = await settled(loadModule({ pathname }))
    assert.equal(location.replaced, BUILD_PROFILE, pathname)
  }
})

test('a second load of the same tag is a no-op (boot guard)', async () => {
  const { fetchCalls, run } = await settled(loadModule())
  run()
  await flush()
  assert.equal(callsTo(fetchCalls, STATUS_URL).length, 1)
})

test('the module never sends anyone to the page it lives on', async () => {
  const { location } = await settled(loadModule())
  assert.notEqual(location.replaced, STARTER_DASHBOARD)
  assert.equal(source.includes("replace('/starter-dashboard')"), false)
})

test('the exposed console surface is the read half only', () => {
  const { api } = loadModule({ pathname: '/other' })
  assert.deepEqual(Object.keys(api).sort(), [
    'allowedHost',
    'buildProfilePath',
    'destinationForState',
    'diagnosticsEnabled',
    'funnelDestination',
    'funnelStateFrom',
    'guardedPaths',
    'isGuardedPath',
    'loaderSelector',
    'onboardingPath',
    'redirectIfIncomplete',
    'release',
    'stagingHost',
  ])
  assert.equal(api.buildProfilePath, BUILD_PROFILE)
  assert.equal(api.onboardingPath, ONBOARDING)
  assert.equal(api.loaderSelector, LOADER_SELECTOR)
})

test('the exposed paths array cannot be mutated from the console', () => {
  const { api } = loadModule({ pathname: '/other' })
  api.guardedPaths.push('/anything')
  assert.equal(api.isGuardedPath('/anything'), false)
})

test('the header @release marker matches the exported release property', () => {
  const { api } = loadModule({ pathname: '/other' })
  const marker = source.match(/^ \* @release (\S+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the starter-profile-redirect.js header')
  assert.equal(api.release, marker[1])
  assert.match(marker[1], /^v(\d+\.\d+\.\d+|X\.Y\.Z)$/)
})

test('the file is raw JavaScript with no script wrapper', () => {
  assert.equal(source.includes('<script'), false)
  assert.equal(source.includes('</script'), false)
})

test('production stays silent while staging logs', async () => {
  const quiet = await settled(loadModule({ hostname: 'www.thestarters.com', envelope: ONBOARDED }))
  assert.equal(quiet.logs.warn.length + quiet.logs.info.length, 0)

  const loud = await settled(loadModule({ envelope: ONBOARDED }))
  assert.ok(loud.logs.info.length > 0)
})

test('STARTERS_DEBUG turns logging on in production without changing behaviour', async () => {
  const { logs, location } = await settled(
    loadModule({
      hostname: 'www.thestarters.com',
      envelope: ONBOARDED,
      debug: true,
    }),
  )
  assert.equal(location.replaced, undefined)
  assert.ok(logs.info.length > 0)
})

test('a deferred-late document waits for DOMContentLoaded before doing anything', async () => {
  const { document, fetchCalls, location } = loadModule({ readyState: 'loading' })
  await flush()
  assert.equal(fetchCalls.length, 0)

  document.listeners.DOMContentLoaded.forEach((handler) => handler())
  await flush()
  await flush()
  assert.equal(location.replaced, BUILD_PROFILE)
})
