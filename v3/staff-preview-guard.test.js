const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./staff-preview-guard.js'), 'utf8')

const XANO = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const TRADE_URL = XANO + '/api:g1vmSLWh/auth/trade-token/v3'
const STAFF_URL = XANO + '/api:kR5gpIDB/staff/session'

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no json')) : Promise.resolve(body)),
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function settle() {
  for (let i = 0; i < 20; i++) await flush()
}

/**
 * Boots the module in a fake browser.
 * opts.cookie: Memberstack token (null = logged out); opts.noMemberstack: never loads.
 * opts.trade / opts.staff: responses; opts.fallback: data-fallback value.
 */
function boot(opts = {}) {
  const attrs = {}
  const headChildren = []
  const calls = []
  const replaced = []
  let now = 0
  const intervals = new Map()
  const timeouts = new Map()
  let seq = 0

  const scriptEl = {
    getAttribute: (name) =>
      name === 'data-fallback' ? opts.fallback ?? '/starter-onboarding' : name === 'data-mode' ? opts.mode ?? null : null,
  }
  const document = {
    currentScript: scriptEl,
    head: { appendChild: (el) => headChildren.push(el) },
    documentElement: {
      setAttribute: (k, v) => {
        attrs[k] = v
      },
    },
    getElementById: (id) => headChildren.find((el) => el.id === id) || null,
    createElement: () => ({ id: '', textContent: '' }),
  }
  const window = {
    location: {
      hostname: 'www.thestarters.com',
      pathname: '/starter-onboarding-v2',
      search: '?x=1',
      replace: (url) => replaced.push(url),
    },
    console,
    setTimeout: (fn, ms) => {
      const id = ++seq
      timeouts.set(id, { fn, at: now + ms })
      return id
    },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn, ms) => {
      const id = ++seq
      intervals.set(id, fn)
      return id
    },
    clearInterval: (id) => intervals.delete(id),
    fetch: (url, options) => {
      calls.push({ url, options })
      if (url.startsWith(TRADE_URL)) {
        return opts.tradeReject ? Promise.reject(new Error('net')) : Promise.resolve(opts.trade || response(200, { authToken: 'xano-tok' }))
      }
      if (url === STAFF_URL && opts.staffBodyStalls) {
        return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) })
      }
      if (url === STAFF_URL) return Promise.resolve(opts.staff || response(200, { email: 'jp+onb01@thestarters.com' }))
      return Promise.reject(new Error('unexpected ' + url))
    },
  }
  if (!opts.noMemberstack) {
    window.$memberstackDom = {
      getMemberCookie: () => Promise.resolve(opts.cookie === undefined ? 'ms-tok' : opts.cookie),
    }
  }
  const DateShim = { now: () => now }
  vm.runInNewContext(source, { window, document, Date: DateShim, Promise, encodeURIComponent, String, Error })
  return {
    attrs,
    headChildren,
    calls,
    replaced,
    window,
    tick(ms) {
      now += ms
      for (const fn of [...intervals.values()]) fn()
      for (const [id, t] of [...timeouts]) {
        if (t.at <= now) {
          timeouts.delete(id)
          t.fn()
        }
      }
    },
  }
}

test('hides the body at once, before any check finishes', () => {
  const env = boot({ noMemberstack: true })
  assert.equal(env.headChildren.length, 1)
  assert.match(env.headChildren[0].textContent, /html:not\(\[data-staff-preview="allowed"\]\) body\{visibility:hidden!important\}/)
  assert.equal(env.attrs['data-staff-preview'], undefined)
})

test('verified staff: page is shown and no redirect', async () => {
  const env = boot()
  await settle()
  assert.equal(env.attrs['data-staff-preview'], 'allowed')
  assert.deepEqual(env.replaced, [])
  const staffCall = env.calls.find((c) => c.url === STAFF_URL)
  assert.equal(staffCall.options.headers.Authorization, 'Bearer xano-tok')
  assert.equal(env.calls[0].url, TRADE_URL + '?token=ms-tok')
})

test('trade answer as raw string or {token} is accepted', async () => {
  for (const body of ['raw-tok', { token: 'raw-tok' }]) {
    const env = boot({ trade: response(200, body) })
    await settle()
    assert.equal(env.attrs['data-staff-preview'], 'allowed')
    assert.equal(env.calls.find((c) => c.url === STAFF_URL).options.headers.Authorization, 'Bearer raw-tok')
  }
})

test('logged out: goes to login with next = path + query', async () => {
  const env = boot({ cookie: null })
  await settle()
  assert.deepEqual(env.replaced, ['/login?next=' + encodeURIComponent('/starter-onboarding-v2?x=1')])
  assert.equal(env.calls.length, 0)
})

test('non-staff (403) goes to the fallback', async () => {
  const env = boot({ staff: response(403, { code: 'email_not_verified' }) })
  await settle()
  assert.deepEqual(env.replaced, ['/starter-onboarding'])
  assert.equal(env.attrs['data-staff-preview'], 'denied')
})

test('401, 500, malformed body and missing email all go to the fallback', async () => {
  for (const staff of [response(401, {}), response(500, {}), response(200, undefined), response(200, {}), response(200, { email: '' })]) {
    const env = boot({ staff })
    await settle()
    assert.deepEqual(env.replaced, ['/starter-onboarding'])
    assert.notEqual(env.attrs['data-staff-preview'], 'allowed')
  }
})

test('trade failure or network error goes to the fallback (fail closed)', async () => {
  for (const o of [{ trade: response(500, {}) }, { trade: response(200, {}) }, { tradeReject: true }]) {
    const env = boot(o)
    await settle()
    assert.deepEqual(env.replaced, ['/starter-onboarding'])
    assert.equal(env.calls.some((c) => c.url === STAFF_URL), false)
  }
})

test('Memberstack never loads: fallback after 8 seconds', async () => {
  const env = boot({ noMemberstack: true })
  await settle()
  assert.deepEqual(env.replaced, [])
  env.tick(8000)
  await settle()
  assert.deepEqual(env.replaced, ['/starter-onboarding'])
})

test('stalled response body: fallback at the 20 second deadline', async () => {
  const env = boot({ staffBodyStalls: true })
  await settle()
  env.tick(19999)
  await settle()
  assert.deepEqual(env.replaced, [])
  assert.notEqual(env.attrs['data-staff-preview'], 'allowed')
  env.tick(1)
  await settle()
  assert.deepEqual(env.replaced, ['/starter-onboarding'])
  assert.equal(env.attrs['data-staff-preview'], 'denied')
})

test('verified staff: the deadline does not redirect later', async () => {
  const env = boot()
  await settle()
  env.tick(20000)
  await settle()
  assert.equal(env.attrs['data-staff-preview'], 'allowed')
  assert.deepEqual(env.replaced, [])
})

test('unsafe or missing data-fallback uses /starter-dashboard', async () => {
  for (const fallback of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '', '/a b']) {
    const env = boot({ fallback, staff: response(403, {}) })
    await settle()
    assert.deepEqual(env.replaced, ['/starter-dashboard'], fallback)
  }
})

test('boots only once per page', () => {
  const env = boot({ noMemberstack: true })
  vm.runInNewContext(source, { window: env.window, document: { currentScript: null } })
  assert.equal(env.headChildren.length, 1)
})

// Flag mode (2026-11-12): one staff-only element on a live page that real users see.
test('flag mode: never hides the page', () => {
  const env = boot({ mode: 'flag', noMemberstack: true })
  assert.equal(env.headChildren.length, 0)
})

test('flag mode: verified staff resolves the promise to true', async () => {
  const env = boot({ mode: 'flag' })
  await settle()
  assert.equal(env.attrs['data-staff-preview'], 'allowed')
  assert.equal(await env.window.StartersStaffPreview, true)
  assert.deepEqual(env.replaced, [])
})

test('flag mode: non-staff, logged out, failures and the deadline never redirect', async () => {
  const cases = [
    { staff: response(403, {}) },
    { cookie: null },
    { trade: response(500, {}) },
    { tradeReject: true },
    { staff: response(200, {}) },
  ]
  for (const o of cases) {
    const env = boot({ mode: 'flag', ...o })
    await settle()
    env.tick(20000)
    await settle()
    assert.deepEqual(env.replaced, [], JSON.stringify(o))
    assert.equal(env.attrs['data-staff-preview'], 'denied', JSON.stringify(o))
    assert.equal(await env.window.StartersStaffPreview, false, JSON.stringify(o))
  }
})

test('flag mode: Memberstack never loads resolves false without a redirect', async () => {
  const env = boot({ mode: 'flag', noMemberstack: true })
  env.tick(8000)
  await settle()
  assert.deepEqual(env.replaced, [])
  assert.equal(await env.window.StartersStaffPreview, false)
})

test('page mode also publishes the result', async () => {
  const staff = boot()
  await settle()
  assert.equal(await staff.window.StartersStaffPreview, true)
  const denied = boot({ staff: response(403, {}) })
  await settle()
  assert.equal(await denied.window.StartersStaffPreview, false)
  assert.deepEqual(denied.replaced, ['/starter-onboarding'])
})
