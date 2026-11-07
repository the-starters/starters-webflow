'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { h } = require('../../step-flow-test-dom')

const file = path.join(__dirname, 'modal-campaigns.js')
const today = new Date(2026, 10, 7, 12).getTime()

function campaign(key, values = {}) {
  const rules = {
    campaign: key, active: 'true', priority: '1', start: '', end: '', destinations: '/',
    'aud-signed-out': 'true', 'aud-brand-free': 'false', 'aud-brand-paid': 'false', 'aud-starter': 'false',
    ...values,
  }
  return h('div', { class: 'w-dyn-item', ...Object.fromEntries(Object.entries(rules).map(([name, value]) => ['data-popup-' + name, value])) })
}

function environment({ hostname = 'the-starters-3-0.webflow.io', pathname = '/', rows = [campaign('one')], audience = 'signed-out', seen = {}, now = today, open = false, sourceFn, audienceFn, loadFn, shownFn, recordFn, openFn, readyState = 'complete', modalReady = true } = {}) {
  const body = h('body')
  const sourceRoot = h('html', {}, rows)
  const loads = []
  const records = []
  const checks = []
  const listeners = new Map()
  const domListeners = new Map()
  const logs = []
  let sourceCalls = 0
  let audienceCalls = 0
  let opens = 0
  const location = new URL(`https://${hostname}${pathname}`)
  const window = { location,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list) },
  }
  const document = { body, readyState,
    querySelector: selector => body.querySelector(selector),
    addEventListener(type, fn) { domListeners.set(type, fn) },
  }
  const modal = { init() {},
    async source(url) { sourceCalls += 1; return sourceFn ? sourceFn(url) : sourceRoot },
    async audience() { audienceCalls += 1; return audienceFn ? audienceFn() : audience },
    history: {
      async hasShown(key) { checks.push(key); return shownFn ? shownFn(key) : (Object.hasOwn(seen, key) ? seen[key] : false) },
      async record(key, event) { records.push([key, event]); return recordFn ? recordFn(key, event) : true },
    },
    async load(url, key, options) {
      loads.push({ url, key, open: options.open })
      if (loadFn) return loadFn(url, key, options)
      const el = h('dialog', { 'data-popup-loaded': key }, [h('a', { href: '/go' }, [h('span')]), h('button'), h('p')])
      el.open = false
      body.append(el)
      return { el, open() {
        opens += 1
        if (openFn) return openFn(el)
        el.open = true
        el.setAttribute('open', '')
      } }
    },
  }
  if (modalReady) window.lumos = { modal }
  if (open) body.append(h('dialog', { open: '' }))
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const context = vm.createContext({ window, document, Date: ClockDate, setTimeout, clearTimeout,
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args), log: (...args) => logs.push(args) },
  })
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  vm.runInContext(source, context)
  return { window, body, modal, loads, records, checks, logs,
    get run() { return window.lumos?.modal?.campaigns?.run },
    get counts() { return { source: sourceCalls, audience: audienceCalls, opens } },
    emit(type, detail) { for (const fn of listeners.get(type) || []) fn({ type, detail }) },
    click(el, target) { for (const fn of el._listeners.get('click') || []) fn({ target }) },
    domReady() { document.readyState = 'interactive'; domListeners.get('DOMContentLoaded')?.() },
    reload() { vm.runInContext(source, context) },
  }
}

test('highest-priority unseen campaign opens once and records displayed history', async () => {
  const env = environment({ rows: [campaign('low'), campaign('high', { priority: '10' }), campaign('seen', { priority: '20' })], seen: { seen: true } })
  const entry = await env.run()
  assert.deepEqual(env.loads, [{ url: '/modals', key: 'high', open: false }])
  assert.equal(entry.el.open, true)
  assert.deepEqual(env.records, [['high', 'shown']])
  await env.run('/another-source')
  assert.equal(env.loads.length, 1)
  assert.deepEqual(env.counts, { source: 1, audience: 1, opens: 1 })
})

test('a priority tie chooses the newest Start, with a missing Start oldest', async () => {
  const env = environment({ rows: [campaign('missing'), campaign('old', { start: 'November 1, 2026' }), campaign('new', { start: 'November 7, 2026' })] })
  await env.run()
  assert.equal(env.loads[0].key, 'new')
})

test('Start begins at local midnight and End includes the last millisecond of today', async () => {
  const end = environment({ now: new Date(2026, 10, 7, 23, 59, 59, 999).getTime(), rows: [campaign('today', { start: 'November 7, 2026', end: 'November 7, 2026' })] })
  await end.run()
  assert.equal(end.loads[0].key, 'today')
  const start = environment({ now: new Date(2026, 10, 7).getTime(), rows: [campaign('today', { start: 'November 7, 2026' })] })
  await start.run()
  assert.equal(start.loads.length, 1)
  const nextDay = environment({ now: new Date(2026, 10, 8).getTime(), rows: [campaign('expired', { end: 'November 7, 2026' })] })
  await nextDay.run()
  assert.equal(nextDay.loads.length, 0)
})

test('inactive, future, expired, malformed date and malformed priority rules are skipped', async () => {
  for (const values of [
    { active: 'false' }, { start: 'November 8, 2026' }, { end: 'November 6, 2026' },
    { start: '2026-11-07' }, { end: 'February 30, 2026' }, { priority: 'NaN' }, { priority: '1.5' },
  ]) {
    const env = environment({ rows: [campaign('ineligible', values)] })
    await env.run()
    assert.equal(env.loads.length, 0, JSON.stringify(values))
  }
})

test('destinations support comma lists, exact paths, single wildcard segments and trailing slashes', async () => {
  for (const pathname of ['/hire/jane', '/hire/jane/', '/about/']) {
    const env = environment({ pathname, rows: [campaign('match', { destinations: '/about, /hire/*' })] })
    await env.run()
    assert.equal(env.loads[0].key, 'match', pathname)
  }
  for (const pathname of ['/hiring', '/hire', '/hire/jane/more', '/about-us']) {
    const env = environment({ pathname, rows: [campaign('miss', { destinations: '/about, /hire/*' })] })
    await env.run()
    assert.equal(env.loads.length, 0, pathname)
  }
})

test('each resolved audience matches only its own literal true switch', async () => {
  for (const [audience, attribute] of Object.entries({ 'signed-out': 'aud-signed-out', 'brand-free': 'aud-brand-free', 'brand-paid': 'aud-brand-paid', talent: 'aud-starter' })) {
    const env = environment({ audience, rows: [campaign('wrong', { 'aud-signed-out': 'false' }), campaign('right', { 'aud-signed-out': 'false', [attribute]: 'true' })] })
    await env.run()
    assert.equal(env.loads[0].key, 'right', audience)
  }
  for (const audience of [null, 'unknown-role']) {
    const env = environment({ audience })
    await env.run()
    assert.equal(env.loads.length, 0)
    assert.equal(env.counts.source, 0)
  }
})

test('seen true, unknown null and other non-false history results are skipped', async () => {
  const env = environment({ rows: [campaign('seen', { priority: '99' }), campaign('unknown', { priority: '50' }), campaign('missing', { priority: '30' }), campaign('new')], seen: { seen: true, unknown: null, missing: undefined } })
  await env.run()
  assert.equal(env.loads[0].key, 'new')
})

test('an initially open dialog prevents all audience and source work', async () => {
  const env = environment({ open: true })
  assert.equal(await env.run(), null)
  assert.deepEqual(env.counts, { source: 0, audience: 0, opens: 0 })
  assert.equal(env.loads.length, 0)
})

test('all skip paths and descendants stop before fetching, without matching similar names', async () => {
  const skip = ['/login', '/starter-login', '/sign-up', '/build-profile', '/starter-onboarding', '/stripe-connect-callback', '/checkout', '/cancel', '/modals']
  for (const base of skip) {
    for (const pathname of [base, base + '/', base + '/next']) {
      const env = environment({ pathname })
      assert.equal(await env.run(), null, pathname)
      assert.equal(env.counts.source, 0)
      assert.equal(env.counts.audience, 0)
    }
  }
  const env = environment({ pathname: '/cancelled', rows: [campaign('allowed', { destinations: '/cancelled' })] })
  await env.run()
  assert.equal(env.loads[0].key, 'allowed')
})

test('a null load or an open method that does not display records nothing', async () => {
  for (const options of [{ loadFn: async () => null }, { openFn() {} }]) {
    const env = environment(options)
    await env.run()
    assert.deepEqual(env.records, [])
  }
})

test('a dialog opening while the campaign stylesheet loads keeps the campaign closed', async () => {
  let finish
  let started
  const loading = new Promise(resolve => { started = resolve })
  const el = h('dialog'); el.open = false
  let opens = 0
  const entry = { el, open() { opens += 1; el.open = true } }
  const env = environment({ loadFn: () => { started(); return new Promise(resolve => { finish = resolve }) } })
  const run = env.run()
  await loading
  env.body.append(h('dialog', { open: '' }))
  finish(entry)
  assert.equal(await run, null)
  assert.equal(opens, 0)
  assert.equal(el.open, false)
  assert.deepEqual(env.records, [])
})

test('path changes during loading are checked again before opening', async () => {
  const el = h('dialog'); el.open = false
  let opens = 0
  const env = environment({ loadFn: async () => {
    env.window.location.pathname = '/checkout'
    return { el, open() { opens += 1; el.open = true } }
  } })
  await env.run()
  assert.equal(opens, 0)
  assert.deepEqual(env.records, [])
})

test('close and nested link/button clicks record events only for the chosen dialog', async () => {
  const env = environment()
  const { el } = await env.run()
  env.emit('modal-close', { modal: h('dialog') })
  env.emit('modal-close', { modal: el })
  env.click(el, el.querySelector('span'))
  env.click(el, el.querySelector('button'))
  env.click(el, el.querySelector('p'))
  assert.deepEqual(env.records, [['one', 'shown'], ['one', 'dismissed'], ['one', 'cta'], ['one', 'cta']])
})

test('failures are silent and concurrent runs still select at most one campaign', async () => {
  for (const options of [
    { sourceFn: async () => { throw new Error('Source failed') } },
    { audienceFn: async () => { throw new Error('Member failed') } },
    { shownFn: async () => { throw new Error('History failed') } },
    { loadFn: async () => { throw new Error('Load failed') } },
    { openFn: () => { throw new Error('Open failed') } },
    { recordFn: async () => { throw new Error('Write failed') } },
  ]) {
    const env = environment(options)
    await env.run()
    assert.deepEqual(env.logs, [])
  }
  const env = environment()
  const [a, b] = await Promise.all([env.run(), env.run()])
  assert.equal(a, b)
  assert.equal(env.loads.length, 1)
  assert.deepEqual(env.records, [['one', 'shown']])
})

test('production hosts install nothing; installation waits for the existing modal owner', () => {
  for (const hostname of ['www.thestarters.com', 'thestarters.com', 'localhost']) {
    const env = environment({ hostname })
    assert.equal(env.run, undefined)
    assert.deepEqual(env.counts, { source: 0, audience: 0, opens: 0 })
  }
  const env = environment({ readyState: 'loading', modalReady: false })
  assert.equal(env.window.lumos, undefined)
  env.window.lumos = { modal: env.modal }
  env.domReady()
  assert.equal(typeof env.run, 'function')
  const run = env.run
  env.reload()
  assert.equal(env.run, run)
})
