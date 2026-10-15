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
  return { load: context.loadEnvScript, group: context.loadEnvScriptGroup, scripts, timers, reads, window,
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


const groupConfig = {
  name: 'calendar-owners', type: 'text/javascript',
  productionCanary: { memberId: 'mem_canary' },
  scripts: ['free', 'init', 'section'].map(name => ({ name,
    staging: 'https://cdn.example.test/staging/' + name + '.js',
    live: 'https://cdn.example.test/ordinary/' + name + '.js',
    canary: 'https://cdn.example.test/candidate/' + name + '.js',
  })),
}

// Before the new API exists, reproduce the exact old footer's independent
// chained selections. This makes the baseline red show mixed sources rather
// than only a missing-function error. The separate API assertion prevents a
// future deletion from hiding behind this baseline reproducer.
function startGroup(f, settings = groupConfig) {
  if (f.group) return f.group(settings)
  return settings.scripts.reduce((chain, script) => chain.then(() => f.load({
    name: script.name, type: settings.type, staging: script.staging, live: script.live,
    productionCanary: { memberId: settings.productionCanary.memberId, src: script.canary },
  })), Promise.resolve())
}
async function finishGroup(f, promise, cohort) {
  for (let i = 0; i < groupConfig.scripts.length; i++) {
    await settle()
    assert.equal(f.scripts.length, i + 1)
    assert.equal(f.scripts[i].attrs.src, groupConfig.scripts[i][cohort])
    assert.equal(f.scripts[i].async, false)
    f.scripts[i].dispatch('load')
  }
  await promise
}

test('group API is provided independently of legacy loadEnvScript', () => {
  assert.equal(typeof fixture().group, 'function')
})

test('group timeout then SDK recovery keeps every dependency ordinary', async () => {
  const pending = deferred()
  let calls = 0
  const f = fixture({ memberRead: () => ++calls === 1 ? pending.promise : Promise.resolve({ data: { id: 'mem_canary' } }) })
  const result = startGroup(f)
  await settle()
  f.timeout()
  await settle()
  pending.resolve({ data: { id: 'mem_canary' } })
  await finishGroup(f, result, 'live')
  assert.equal(f.reads.length, 1)
  assert.equal(f.timers.size, 0)
})

for (const [label, next] of [
  ['foreign', () => Promise.resolve({ data: { id: 'mem_other' } })],
  ['unknown', () => Promise.resolve({ data: null })],
  ['reject', () => Promise.reject(Error('SDK failed'))],
  ['throw', () => { throw Error('SDK failed') }],
]) {
  test('group candidate then ' + label + ' identity stops without mixing ordinary assets', async () => {
    let calls = 0
    const f = fixture({ memberRead: () => ++calls === 1 ? Promise.resolve({ data: { id: 'mem_canary' } }) : next() })
    const result = startGroup(f)
    // Attach immediately; no rejected group promise may escape the fixture.
    const rejected = assert.rejects(result, /identity|member|canary/i)
    await settle()
    assert.equal(f.scripts[0].attrs.src, groupConfig.scripts[0].canary)
    f.scripts[0].dispatch('load')
    await settle()
    // Finish any wrongly appended old-source script so baseline rejects fail
    // decisively instead of leaving a pending test.
    if (f.scripts[1]) {
      f.scripts[1].dispatch('load'); await settle()
      if (f.scripts[2]) f.scripts[2].dispatch('load')
    }
    await rejected
    assert.equal(f.scripts.length, 1)
  })
}

test('group candidate recheck timeout stops and late matching auth cannot resume', async () => {
  const pending = deferred()
  let calls = 0
  const f = fixture({ memberRead: () => ++calls === 1 ? Promise.resolve({ data: { id: 'mem_canary' } }) : pending.promise })
  const result = startGroup(f), rejected = assert.rejects(result, /identity|member|canary/i)
  await settle(); f.scripts[0].dispatch('load'); await settle()
  f.timeout(); await settle()
  pending.resolve({ data: { id: 'mem_canary' } }); await settle()
  if (f.scripts[1]) { f.scripts[1].dispatch('load'); await settle(); if (f.scripts[2]) f.scripts[2].dispatch('load') }
  await rejected
  assert.equal(f.scripts.length, 1)
  assert.equal(f.timers.size, 0)
})

test('group stable canary checks current identity before each ordered append', async () => {
  const f = fixture(), result = startGroup(f)
  await finishGroup(f, result, 'canary')
  assert.equal(f.reads.length, 3)
})

test('group staging selects every staging dependency without auth', async () => {
  const f = fixture({ host: 'the-starters-3-0.webflow.io', noSdk: true })
  await finishGroup(f, startGroup(f), 'staging')
  assert.equal(f.reads.length, 0)
})

test('group ordinary mismatch never upgrades after the current account changes', async () => {
  let calls = 0
  const f = fixture({ memberRead: () => Promise.resolve({ data: { id: ++calls === 1 ? 'mem_other' : 'mem_canary' } }) })
  await finishGroup(f, startGroup(f), 'live')
  assert.equal(f.reads.length, 1)
})

test('group repeated matching configuration shares its in-flight and completed load', async () => {
  const f = fixture(), first = startGroup(f), second = startGroup(f, JSON.parse(JSON.stringify(groupConfig)))
  assert.equal(first, second)
  await finishGroup(f, first, 'canary')
  assert.equal(startGroup(f), first)
  assert.equal(f.scripts.length, 3)
})

test('group conflicting ordered sources reject instead of silently reusing a load', async () => {
  const f = fixture(), first = startGroup(f)
  const changed = JSON.parse(JSON.stringify(groupConfig))
  changed.scripts[1].live += '?different'
  const rejected = assert.rejects(startGroup(f, changed), /conflict/i)
  await finishGroup(f, first, 'canary')
  await rejected
})

test('group script failure stops dependencies without a second source attempt', async () => {
  const f = fixture(), result = startGroup(f), rejected = assert.rejects(result, /failed to load/i)
  await settle(); f.scripts[0].dispatch('error'); await rejected
  assert.equal(f.scripts.length, 1)
})


test('group missing SDK on a candidate continuation refuses all remaining scripts', async () => {
  const f = fixture(), result = startGroup(f), rejected = assert.rejects(result, /identity|member|canary/i)
  await settle()
  delete f.window.$memberstackDom
  f.scripts[0].dispatch('load')
  await rejected
  assert.equal(f.scripts.length, 1)
})

test('group missing initial SDK freezes the whole ordinary cohort', async () => {
  const f = fixture({ noSdk: true })
  await finishGroup(f, startGroup(f), 'live')
  assert.equal(f.reads.length, 0)
})

test('group malformed canary source selects only ordinary without auth reads', async () => {
  const f = fixture(), invalid = JSON.parse(JSON.stringify(groupConfig))
  invalid.scripts[1].canary = 'javascript:alert(1)'
  await finishGroup(f, startGroup(f, invalid), 'live')
  assert.equal(f.reads.length, 0)
})

test('group snapshots ordered dependency URLs before caller mutation', async () => {
  const f = fixture(), settings = JSON.parse(JSON.stringify(groupConfig)), result = startGroup(f, settings)
  settings.scripts[1].canary = 'https://cdn.example.test/replaced.js'
  settings.productionCanary.memberId = 'mem_other'
  await finishGroup(f, result, 'canary')
})

test('group duplicate dependency names refuse before any append', async () => {
  const f = fixture(), invalid = JSON.parse(JSON.stringify(groupConfig))
  invalid.scripts[1].name = invalid.scripts[0].name
  await assert.rejects(startGroup(f, invalid), /invalid/i)
  assert.equal(f.scripts.length, 0)
  assert.equal(f.reads.length, 0)
})
