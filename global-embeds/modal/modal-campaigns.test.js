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

function environment({ hostname = 'the-starters-3-0.webflow.io', pathname = '/', rows = [campaign('one')], audience = 'signed-out', seen = {}, now = today, open = false, sourceFn, audienceFn, loadFn, shownFn, recordFn, openFn, readyState = 'complete', modalReady = true, dataLayer, signals = {}, signalsFn, storage = new Map(), realMember, enableHost = false } = {}) {
  const body = h('body')
  const sourceRoot = h('html', {}, rows)
  const signalCalls = []
  const loads = []
  const records = []
  const checks = []
  const listeners = new Map()
  const domListeners = new Map()
  const logs = []
  const events = []
  let sourceCalls = 0
  let audienceCalls = 0
  let opens = 0
  const location = new URL(`https://${hostname}${pathname}`)
  const window = { location,
    localStorage: { removeItem(key) { storage.delete(key) } },
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list) },
    dispatchEvent(event) { events.push(event); for (const fn of listeners.get(event.type) || []) fn(event); return true },
  }
  if (dataLayer !== undefined) window.dataLayer = dataLayer
  const document = { body, readyState,
    querySelector: selector => body.querySelector(selector),
    addEventListener(type, fn) { domListeners.set(type, fn) },
  }
  const modal = { init() {},
    async signals(needs) { signalCalls.push(needs); return signalsFn ? signalsFn(needs) : signals },
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
  const context = vm.createContext({ window, document, Date: ClockDate, setTimeout, clearTimeout, URLSearchParams,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args), log: (...args) => logs.push(args) },
  })
  const memberReads = []
  if (realMember !== undefined) {
    window.$memberstackDom = { async getCurrentMember() { memberReads.push(true); return { data: realMember } } }
    for (const dependency of ['v3/route-guard.js', 'account-settings/plan-dates.js', 'global-embeds/modal/modal-audience.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', dependency), 'utf8'), context)
    }
  }
  let source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (enableHost) source = source.replace("const ENABLED_HOSTS = ['the-starters-3-0.webflow.io'];", 'const ENABLED_HOSTS = [' + JSON.stringify(hostname) + '];')
  vm.runInContext(source, context)
  return { window, body, modal, loads, records, checks, logs, events, signalCalls, storage, memberReads,
    get run() { return window.lumos?.modal?.campaigns?.run },
    get counts() { return { source: sourceCalls, audience: audienceCalls, opens } },
    emit(type, detail) { for (const fn of listeners.get(type) || []) fn({ type, detail }) },
    click(el, target) { for (const fn of el._listeners.get('click') || []) fn({ target }) },
    domReady() { document.readyState = 'interactive'; domListeners.get('DOMContentLoaded')?.() },
    reload() { vm.runInContext(source, context) },
    advance(ms) { now += ms },
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

test('shown, dismissed and CTA dispatch exact reporting details once per state', async () => {
  const env = environment({ pathname: '/offers', audience: 'brand-paid', rows: [campaign('launch', {
    destinations: '/offers', 'aud-brand-paid': 'true',
  })] })
  const received = []
  env.window.addEventListener('modal-campaign', event => received.push(event.detail))
  const { el } = await env.run()
  env.advance(1000)
  env.emit('modal-close', { modal: el })
  env.advance(1000)
  env.click(el, el.querySelector('span'))
  env.advance(1000)
  env.emit('modal-close', { modal: el })
  env.click(el, el.querySelector('button'))
  env.reload()
  await env.run()
  assert.deepEqual(JSON.parse(JSON.stringify(received)), ['shown', 'dismissed', 'cta'].map((event, index) => ({
    key: 'launch', event, audience: 'brand-paid', path: '/offers', at: new Date(today + index * 1000).toISOString(),
  })))
  assert.deepEqual(env.events.map(event => event.type), ['modal-campaign', 'modal-campaign', 'modal-campaign'])
  assert.equal(env.window.dataLayer, undefined)
  assert.equal(Object.hasOwn(env.window, 'dataLayer'), false)
})

test('an existing dataLayer receives exact reporting objects without duplicates', async () => {
  const dataLayer = [{ event: 'existing' }]
  const env = environment({ dataLayer })
  const { el } = await env.run()
  env.emit('modal-close', { modal: el })
  env.emit('modal-close', { modal: el })
  env.click(el, el.querySelector('button'))
  env.click(el, el.querySelector('span'))
  assert.equal(env.window.dataLayer, dataLayer)
  assert.deepEqual(JSON.parse(JSON.stringify(dataLayer)), [{ event: 'existing' },
    ...['shown', 'dismissed', 'cta'].map(modal_event => ({
      event: 'modal_campaign', modal_key: 'one', modal_event, audience: 'signed-out',
    })),
  ])
})

test('close controls and their descendants never record or report CTA', async () => {
  for (const tag of ['a', 'button', 'div']) {
    const env = environment({ dataLayer: [] })
    const { el } = await env.run()
    const label = h('span')
    const closer = tag === 'div'
      ? h('div', { 'data-modal-close': '' }, [h('button', {}, [label])])
      : h(tag, { 'data-modal-close': '' }, [label])
    el.append(closer)
    env.click(el, closer)
    env.click(el, label)
    assert.deepEqual(env.records, [['one', 'shown']], tag)
    assert.deepEqual(env.events.map(event => event.detail.event), ['shown'], tag)
    assert.deepEqual(env.window.dataLayer.map(event => event.modal_event), ['shown'], tag)
    env.click(el, el.querySelector('a'))
    assert.deepEqual(env.records, [['one', 'shown'], ['one', 'cta']], tag)
    assert.deepEqual(env.events.map(event => event.detail.event), ['shown', 'cta'], tag)
  }
})

test('reporting survives history failures without creating or replacing non-array dataLayer values', async () => {
  for (const dataLayer of [undefined, null, { push() { throw new Error('Not an array') } }]) {
    const env = environment({ dataLayer, recordFn: async () => { throw new Error('History unavailable') } })
    const { el } = await env.run()
    env.emit('modal-close', { modal: el })
    env.click(el, el.querySelector('button'))
    assert.deepEqual(env.events.map(event => event.detail.event), ['shown', 'dismissed', 'cta'])
    assert.equal(env.window.dataLayer, dataLayer)
    assert.deepEqual(env.logs, [])
  }
})

test('reporting failures cannot block history or the other reporting channel', async () => {
  for (const broken of ['dataLayer', 'dispatch']) {
    const dataLayer = broken === 'dataLayer' ? Object.freeze([]) : []
    const env = environment({ dataLayer })
    if (broken === 'dispatch') env.window.dispatchEvent = () => { throw new Error('Listener failed') }
    const { el } = await env.run()
    assert.equal(el.open, true)
    env.emit('modal-close', { modal: el })
    env.click(el, el.querySelector('button'))
    assert.deepEqual(env.records, [['one', 'shown'], ['one', 'dismissed'], ['one', 'cta']])
    assert.equal(broken === 'dataLayer' ? env.events.length : dataLayer.length, 3)
    assert.deepEqual(env.logs, [])
  }
})

const day = 86400000
const brandRules = { 'aud-signed-out': 'false', 'aud-brand-paid': 'true' }
const talentRules = { 'aud-signed-out': 'false', 'aud-starter': 'true' }

test('Destinations accept two lines, commas, mixed lists and published br separators', async () => {
  for (const destinations of ['/other\n/', '/other,/', ' , /other\r\n /, ', '/other<br>/', '/other<BR />/']) {
    const env = environment({ rows: [campaign('paths', { destinations })] })
    assert.equal((await env.run()).el.getAttribute('data-popup-loaded'), 'paths', destinations)
  }
})

test('new-member day boundaries are inclusive and reject old, future or unknown signup', async () => {
  for (const [createdAt, matches] of [[today, true], [today - 14 * day, true], [today - 14 * day - 1, false], [today + 1, false], [null, false]]) {
    const env = environment({ audience: 'brand-paid', rows: [campaign('new', { ...brandRules, 'new-days': '14' })], signals: { createdAt } })
    assert.equal(!!await env.run(), matches, String(createdAt))
    assert.equal(env.records.length, matches ? 1 : 0)
  }
})

test('renewal day boundaries require paid brand, a known date and empty cancellation', async () => {
  for (const [nextBillingDate, cancelAt, matches] of [
    [today, null, true], [today + 7 * day, null, true], [today + 7 * day + 1, null, false],
    [today - 1, null, false], [today, today + day, false], [null, null, false], [today, undefined, false],
  ]) {
    const env = environment({ audience: 'brand-paid', rows: [campaign('renew', { ...brandRules, 'renew-days': '7' })], signals: { nextBillingDate, cancelAt } })
    assert.equal(!!await env.run(), matches)
    assert.equal(env.records.length, matches ? 1 : 0)
  }
})

test('availability and Stripe rules require their specific known matching signals', async () => {
  for (const [attribute, field, values] of [
    ['no-availability', 'availabilityEmpty', [[true, true], [false, false], [null, false]]],
    ['no-stripe', 'stripeState', [['disconnected', true], ['incomplete', true], ['ready', false], [null, false], ['unknown', false], [{ connected: true }, false]]],
  ]) {
    for (const [value, matches] of values) {
      const env = environment({ audience: 'talent', rows: [campaign('starter', { ...talentRules, [attribute]: 'true' })], signals: { [field]: value } })
      assert.equal(!!await env.run(), matches)
      assert.equal(env.signalCalls.length, 1)
      assert.equal(env.records.length, matches ? 1 : 0)
    }
  }
})

test('all new rules combine with AND and preserve the highest-priority fallback on unknown', async () => {
  const rows = [campaign('plain', { ...talentRules, priority: '1' }), campaign('both', { ...talentRules, priority: '20', 'no-stripe': 'true', 'no-availability': 'true' })]
  const env = environment({ audience: 'talent', rows, signals: { stripeState: 'disconnected', availabilityEmpty: null } })
  assert.equal((await env.run()).el.getAttribute('data-popup-loaded'), 'plain')
  assert.deepEqual(env.records, [['plain', 'shown']])
  assert.deepEqual(JSON.parse(JSON.stringify(env.signalCalls)), [{ availability: true, stripe: true }])
})

test('empty fields and ineligible or already-seen behavior rows never request signals', async () => {
  const rows = [
    campaign('plain', { 'new-days': '', 'renew-days': '', 'no-stripe': 'false', 'no-availability': 'false' }),
    campaign('other-page', { 'no-stripe': 'true', destinations: '/elsewhere' }),
    campaign('seen', { 'no-availability': 'true' }),
  ]
  const env = environment({ rows, seen: { seen: true } })
  assert.ok(await env.run())
  assert.equal(env.signalCalls.length, 0)
})

test('behavior overrides never bypass audiences or existing destinations, dates and history', async () => {
  const params = '/?popup-as=new,no-availability,no-stripe,renewing'
  for (const [audience, rules] of [
    ['signed-out', { 'new-days': '14' }],
    ['brand-paid', { ...brandRules, 'no-stripe': 'true' }],
    ['talent', { ...talentRules, 'renew-days': '7' }],
    ['talent', { ...talentRules, 'no-stripe': 'true', destinations: '/elsewhere' }],
    ['talent', { ...talentRules, 'no-stripe': 'true', end: 'November 1, 2026' }],
  ]) {
    const env = environment({ pathname: params, audience, rows: [campaign('no', rules)] })
    assert.equal(await env.run(), null)
    assert.equal(env.signalCalls.length, 0)
  }
  const seen = environment({ pathname: params, audience: 'talent', rows: [campaign('seen', { ...talentRules, 'no-stripe': 'true' })], seen: { seen: true } })
  assert.equal(await seen.run(), null)
})

test('listed staging behavior overrides match and unlisted ones fail without requests', async () => {
  for (const [list, matches] of [['no-stripe,no-availability', true], ['no-stripe', false], ['', false]]) {
    const env = environment({ pathname: '/?popup-as=' + list, audience: 'talent', rows: [campaign('both', { ...talentRules, 'no-stripe': 'true', 'no-availability': 'true' })] })
    assert.equal(!!await env.run(), matches)
    assert.equal(env.signalCalls.length, 0)
  }
  for (const [audience, rules, list] of [['brand-paid', { ...brandRules, 'new-days': '14' }, 'new'], ['brand-paid', { ...brandRules, 'renew-days': '7' }, 'renewing']]) {
    assert.ok(await environment({ pathname: '/?popup-as=' + list, audience, rows: [campaign('yes', rules)] }).run())
  }
})

test('reset also asks history to clear signed-in popup history before choosing', async () => {
  let resets = 0
  const env = environment({ pathname: '/?popup-reset=1' })
  env.window.lumos.modal.history.reset = async () => { resets += 1; return true }
  assert.ok(await env.run())
  assert.equal(resets, 1)
  const plain = environment({ pathname: '/' })
  let plainResets = 0
  plain.window.lumos.modal.history.reset = async () => { plainResets += 1; return true }
  await plain.run()
  assert.equal(plainResets, 0)
})

test('reset clears only guest popup history and normal selection still runs', async () => {
  const storage = new Map([['thestarters:modal-popups', 'fixture'], ['keep', 'untouched']])
  const env = environment({ pathname: '/?popup-reset=1', storage })
  assert.equal(storage.has('thestarters:modal-popups'), false)
  assert.equal(storage.get('keep'), 'untouched')
  assert.ok(await env.run())
})

test('debug reports one matched/skipped reason per row', async () => {
  const env = environment({ pathname: '/?popup-debug=1', rows: [campaign('yes'), campaign('seen'), campaign('away', { destinations: '/elsewhere' }), campaign('wrong', { 'aud-signed-out': 'false' }), campaign('old', { end: 'November 1, 2026' }), campaign('signal', { ...brandRules, 'new-days': '14', 'aud-signed-out': 'true' })], seen: { seen: true } })
  await env.run()
  const logs = env.logs.map(args => args[0])
  assert.equal(logs.length, 6)
  for (const line of ['[popups] yes → matched', '[popups] seen → skipped: seen', '[popups] away → skipped: destination', '[popups] wrong → skipped: audience', '[popups] old → skipped: dates', '[popups] signal → skipped: audience']) assert.ok(logs.includes(line), line)
})

test('all QA helpers are inert on production and lookalike hosts', () => {
  for (const hostname of ['www.thestarters.com', 'thestarters.com', 'the-starters-3-0.webflow.io.evil.test']) {
    const storage = new Map([['thestarters:modal-popups', 'keep']])
    const env = environment({ hostname, pathname: '/?popup-reset=1&popup-debug=1&popup-as=new,no-stripe', storage })
    assert.equal(env.run, undefined)
    assert.equal(storage.get('thestarters:modal-popups'), 'keep')
    assert.equal(env.logs.length, 0)
    assert.equal(env.signalCalls.length, 0)
  }
})


test('impossible behavior combinations do not request remote signals', async () => {
  for (const extra of [{ 'renew-days': '7' }, { 'new-days': '-1' }, { 'new-days': '1.5' }]) {
    const env = environment({ audience: 'talent', rows: [campaign('impossible', { ...talentRules, 'no-stripe': 'true', ...extra })] })
    assert.equal(await env.run(), null)
    assert.equal(env.signalCalls.length, 0)
  }
})

test('a signup aging beyond the boundary during loading does not open or record history', async () => {
  let env
  env = environment({ audience: 'brand-paid', rows: [campaign('edge', { ...brandRules, 'new-days': '14' })],
    signals: { createdAt: today - 14 * day }, loadFn() { env.advance(1); return { el: h('dialog'), open() { throw new Error('Must stay closed') } } } })
  assert.equal(await env.run(), null)
  assert.equal(env.records.length, 0)
})


test('the real audience, plan-date and picker modules share one member lookup', async () => {
  const matrix = fs.readFileSync(path.join(__dirname, '../../v3/ACCESS-MATRIX.md'), 'utf8')
  const planId = matrix.match(/^\| `(pln_[^`]+)` \| `brand-paid` \|/m)[1]
  const realMember = { id: 'member-fixture', createdAt: new Date(today - day).toISOString(),
    planConnections: [{ active: true, status: 'ACTIVE', planId, payment: { nextBillingDate: (today + 7 * day) / 1000 } }] }
  const env = environment({ realMember, rows: [campaign('real', { ...brandRules, 'new-days': '14', 'renew-days': '7' })] })
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
  const before = env.memberReads.length
  const entry = await env.run()
  assert.equal(entry.el.getAttribute('data-popup-loaded'), 'real')
  assert.equal(env.memberReads.length, before + 1)
  assert.deepEqual(env.records, [['real', 'shown']])
  const values = await env.modal.signals()
  assert.equal(values.createdAt, today - day)
  assert.equal(values.nextBillingDate, today + 7 * day)
  assert.equal(values.cancelAt, null)
  assert.equal(env.memberReads.length, before + 1)
})


test('QA helpers remain inert if a future rollout enables the picker on production', async () => {
  const storage = new Map([['thestarters:modal-popups', 'keep']])
  const env = environment({ hostname: 'www.thestarters.com', enableHost: true,
    pathname: '/?popup-reset=1&popup-debug=1&popup-as=new', storage,
    audience: 'brand-paid', rows: [campaign('old-member', { ...brandRules, 'new-days': '14' })], signals: { createdAt: today - 100 * day } })
  assert.equal(await env.run(), null)
  assert.equal(storage.get('thestarters:modal-popups'), 'keep')
  assert.equal(env.logs.length, 0)
  assert.equal(env.signalCalls.length, 1)
})


test('malformed switch rules fail closed instead of silently removing the requirement', async () => {
  for (const attribute of ['no-availability', 'no-stripe']) {
    const env = environment({ audience: 'talent', rows: [campaign('bad', { ...talentRules, [attribute]: 'On' })] })
    assert.equal(await env.run(), null)
    assert.equal(env.signalCalls.length, 0)
    assert.equal(env.records.length, 0)
  }
})
