const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./loader.js'), 'utf8')
const config = {
  name: 'calendar-section',
  staging: 'https://cdn.example.test/staging.js',
  live: 'https://cdn.example.test/v1/calendar.js',
  type: 'text/javascript',
  productionCanary: { memberId: 'mem_canary', src: 'https://cdn.example.test/commit/calendar.js' },
}

function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

function fixture(options = {}) {
  const scripts = [], timers = new Map(), reads = []
  let nextTimer = 0
  const window = {
    location: { host: options.host || 'www.thestarters.com' },
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer },
    clearTimeout(id) { timers.delete(id) },
  }
  if (!options.noSdk) window.$memberstackDom = {
    getCurrentMember() { reads.push(true); return options.memberRead ? options.memberRead() : Promise.resolve({ data: { id: 'mem_canary' } }) },
  }
  const document = {
    createElement() {
      const events = {}, attrs = {}
      return { attrs, events, async: true,
        setAttribute(k, v) { attrs[k] = v },
        addEventListener(k, fn) { (events[k] ||= []).push(fn) },
        dispatch(k) { for (const fn of events[k] || []) fn({ type: k }) },
      }
    },
    body: { appendChild(el) { scripts.push(el) } },
  }
  const context = { window, document, console: { log() {}, error() {} }, URL, Promise, Map, JSON, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout }
  vm.createContext(context)
  vm.runInContext(source, context)
  return { load: context.loadEnvScript, scripts, timers, reads, window,
    timeout() { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } },
  }
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve() }
async function finish(f, promise, expected) {
  await settle()
  assert.equal(f.scripts.length, 1)
  assert.equal(f.scripts[0].attrs.src, expected)
  f.scripts[0].dispatch('load')
  await promise
}

test('legacy callers append immediately with the existing hostname and module defaults', () => {
  for (const [host, expected] of [['www.thestarters.com', config.live], ['the-starters-3-0.webflow.io', config.staging]]) {
    const f = fixture({ host })
    const { productionCanary, type, ...legacy } = config
    assert.equal(f.load(legacy), undefined)
    assert.equal(f.scripts[0].attrs.src, expected)
    assert.equal(f.scripts[0].attrs.type, 'module')
    assert.equal(f.reads.length, 0)
  }
})

test('matching fresh authenticated member selects the canary, once, after resolution', async () => {
  const pending = deferred(), f = fixture({ memberRead: () => pending.promise })
  const first = f.load(config), second = f.load({ ...config })
  assert.equal(first, second)
  assert.equal(f.scripts.length, 0)
  pending.resolve({ data: { id: 'mem_canary' } })
  await finish(f, first, config.productionCanary.src)
  assert.equal(f.reads.length, 1)
  assert.equal(f.scripts[0].async, false)
  assert.equal(f.scripts[0].attrs.type, 'text/javascript')
})

test('staging selects its configured source without member reads', async () => {
  const f = fixture({ host: 'the-starters-3-0.webflow.io' })
  await finish(f, f.load(config), config.staging)
  assert.equal(f.reads.length, 0)
})

for (const [label, response] of [['other member', { data: { id: 'mem_other' } }], ['anonymous', { data: null }], ['missing envelope', { id: 'mem_canary' }], ['malformed id', { data: { id: ['mem_canary'] } }]]) {
  test(label + ' keeps the live pin', async () => {
    const f = fixture({ memberRead: () => Promise.resolve(response) })
    await finish(f, f.load(config), config.live)
  })
}

for (const label of ['missing SDK', 'throw', 'reject', 'timeout']) {
  test(label + ' keeps the live pin; late success cannot append a canary', async () => {
    const pending = deferred()
    const f = fixture({ noSdk: label === 'missing SDK', memberRead() {
      if (label === 'throw') throw Error('unavailable')
      if (label === 'reject') return Promise.reject(Error('unavailable'))
      return pending.promise
    } })
    const result = f.load(config)
    await settle()
    if (label === 'timeout') f.timeout()
    await finish(f, result, config.live)
    pending.resolve({ data: { id: 'mem_canary' } })
    await settle()
    assert.equal(f.scripts.length, 1)
    assert.equal(f.timers.size, 0)
  })
}

for (const canary of [null, {}, { memberId: '', src: config.productionCanary.src }, { memberId: ['mem_canary'], src: config.productionCanary.src }, { memberId: 'mem_canary', src: 'javascript:alert(1)' }, { memberId: 'mem_canary', src: 'not a URL' }]) {
  test('invalid explicit canary configuration falls back to the live pin: ' + JSON.stringify(canary), async () => {
    const f = fixture()
    await finish(f, f.load({ ...config, productionCanary: canary }), config.live)
    assert.equal(f.reads.length, 0)
  })
}

test('different config with the same name reports conflict and never appends another script', async () => {
  const f = fixture()
  const first = f.load(config)
  await assert.rejects(f.load({ ...config, live: 'https://cdn.example.test/other.js' }), /conflicting.*calendar-section/i)
  await finish(f, first, config.productionCanary.src)
})

test('load completion can order dependent scripts; appending is not load completion', async () => {
  const f = fixture()
  let completed = false
  const first = f.load(config)
  const chain = first.then(() => { completed = true; return f.load({ ...config, name: 'dependent' }) })
  await settle()
  assert.equal(completed, false)
  assert.equal(f.scripts.length, 1)
  f.scripts[0].dispatch('load')
  await settle()
  assert.equal(f.scripts.length, 2)
  f.scripts[1].dispatch('load')
  await chain
})

test('script load failure rejects without appending a second controller', async () => {
  const f = fixture(), result = f.load(config)
  const rejected = assert.rejects(result, /failed to load/i)
  await settle()
  f.scripts[0].dispatch('error')
  await rejected
  assert.equal(f.scripts.length, 1)
})

test('a later separately named load reads the current member after an account switch', async () => {
  let id = 'mem_canary'
  const f = fixture({ memberRead: () => Promise.resolve({ data: { id } }) })
  await finish(f, f.load(config), config.productionCanary.src)
  id = 'mem_other'
  const second = f.load({ ...config, name: 'second-calendar-script' })
  await settle()
  assert.equal(f.scripts[1].attrs.src, config.live)
  f.scripts[1].dispatch('load')
  await second
  assert.equal(f.reads.length, 2)
})
