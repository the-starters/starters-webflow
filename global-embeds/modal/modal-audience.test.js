'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const file = path.join(__dirname, 'modal-audience.js')
const root = path.resolve(__dirname, '../..')
const guardSource = fs.readFileSync(path.join(root, 'v3/route-guard.js'), 'utf8')
const matrix = fs.readFileSync(path.join(root, 'v3/ACCESS-MATRIX.md'), 'utf8')
const plans = [...matrix.matchAll(/^\| `(pln_[^`]+)` \| `(brand-free|brand-paid|talent)` \|/gm)]
  .map((match) => ({ id: match[1], role: match[2] }))

function member(...ids) {
  return { id: 'member-1', planConnections: ids.map(planId => ({ planId, status: 'ACTIVE', active: true })) }
}

function environment({ hostname = 'the-starters-3-0.webflow.io', response = { data: null }, lookup, sdkReady = true, guardReady = true, modalReady = true, readyState = 'complete', datesReady = true } = {}) {
  let now = 0
  let calls = 0
  const timers = []
  let externalReads = 0
  const listeners = new Map()
  const window = { location: { hostname, pathname: '/modals', search: '', hash: '', href: `https://${hostname}/modals` } }
  if (modalReady) window.lumos = { modal: { init() {} } }
  const sdk = { getCurrentMember() { calls += 1; return lookup ? lookup() : Promise.resolve(response) } }
  if (sdkReady) window.$memberstackDom = sdk
  const countExternalRead = () => { externalReads += 1; throw new Error('Unexpected external read') }
  window.__tsSchedulingAuthFetch = countExternalRead
  window.getXanoAuthToken = countExternalRead
  window.fetch = countExternalRead
  const document = { readyState, querySelector() { return null }, addEventListener(type, fn) { listeners.set(type, fn) } }
  class ClockDate extends Date { static now() { return now } }
  const context = vm.createContext({
    window, document, Date: ClockDate, console,
    setTimeout(fn, ms) { const timer = { fn, at: now + ms }; timers.push(timer); return timer },
    clearTimeout(timer) { const index = timers.indexOf(timer); if (index !== -1) timers.splice(index, 1) },
  })
  if (datesReady) vm.runInContext(fs.readFileSync(path.join(root, 'account-settings/plan-dates.js'), 'utf8'), context)
  vm.runInContext(guardSource, context)
  const guard = window.StartersV3RouteGuard
  if (!guardReady) delete window.StartersV3RouteGuard
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  vm.runInContext(source, context)
  return {
    window, sdk, guard,
    get externalReads() { return externalReads },
    get signals() { return window.lumos?.modal?.signals },
    get audience() { return window.lumos?.modal?.audience },
    get calls() { return calls },
    get timerCount() { return timers.length },
    advance(ms) {
      const until = now + ms
      while (timers.some(timer => timer.at <= until)) {
        timers.sort((a, b) => a.at - b.at)
        const timer = timers.shift()
        now = timer.at
        timer.fn()
      }
      now = until
    },
    domReady() { document.readyState = 'interactive'; listeners.get('DOMContentLoaded')?.() },
    reload() { vm.runInContext(source, context) },
  }
}

test('only an explicit null member resolves signed-out', async () => {
  assert.equal(await environment().audience(), 'signed-out')
  for (const response of [undefined, {}, { data: {} }, { data: false }]) {
    const env = environment({ response: response ?? {} })
    assert.equal(await env.audience(), null)
  }
})

test('each ACCESS-MATRIX plan uses the real route guard mapping', async () => {
  assert.ok(plans.length >= 4)
  for (const plan of plans) {
    const env = environment({ response: { data: member(plan.id) } })
    assert.equal(await env.audience(), plan.role, plan.id)
  }
})

test('unmapped and cross-family members return unknown; paid/free upgrade uses paid', async () => {
  const free = plans.find(plan => plan.role === 'brand-free').id
  const paid = plans.find(plan => plan.role === 'brand-paid').id
  const talent = plans.find(plan => plan.role === 'talent').id
  for (const ids of [['unmapped-plan'], [free, talent], [paid, talent]]) {
    assert.equal(await environment({ response: { data: member(...ids) } }).audience(), null)
  }
  assert.equal(await environment({ response: { data: member(free, paid) } }).audience(), 'brand-paid')
})

test('missing Memberstack or route guard times out without a member lookup', async () => {
  for (const options of [{ sdkReady: false }, { guardReady: false }]) {
    const env = environment(options)
    let finished = false
    const result = env.audience().then(value => { finished = true; return value })
    env.advance(2999)
    await Promise.resolve()
    assert.equal(finished, false)
    env.advance(1)
    assert.equal(await result, null)
    assert.equal(env.calls, 0)
    env.window.$memberstackDom = env.sdk
    env.window.StartersV3RouteGuard = env.guard
    env.advance(100)
    assert.equal(await env.audience(), null)
    assert.equal(env.calls, 0)
  }
})

test('dependencies arriving before the deadline resolve and clean up timers', async () => {
  const env = environment({ sdkReady: false, guardReady: false })
  const result = env.audience()
  env.advance(500)
  env.window.$memberstackDom = env.sdk
  env.window.StartersV3RouteGuard = env.guard
  env.advance(50)
  assert.equal(await result, 'signed-out')
  assert.equal(env.calls, 1)
  assert.equal(env.timerCount, 0)
})

test('a rejected lookup or throwing role resolver returns unknown', async () => {
  const env = environment({ lookup: async () => { throw new Error('Unavailable') } })
  assert.equal(await env.audience(), null)
  const roleError = environment({ response: { data: member('unknown') } })
  roleError.window.StartersV3RouteGuard.memberRole = () => { throw new Error('Bad role') }
  assert.equal(await roleError.audience(), null)
})

test('a hung lookup times out and late completion cannot change the cached result', async () => {
  let resolve
  const env = environment({ lookup: () => new Promise(done => { resolve = done }) })
  const result = env.audience()
  env.advance(3000)
  assert.equal(await result, null)
  resolve({ data: null })
  assert.equal(await env.audience(), null)
  assert.equal(env.calls, 1)
})

test('concurrent and later calls reuse one member lookup', async () => {
  const env = environment()
  assert.deepEqual(await Promise.all([env.audience(), env.audience()]), ['signed-out', 'signed-out'])
  assert.equal(await env.audience(), 'signed-out')
  assert.equal(env.calls, 1)
})

test('production and lookalike hosts install nothing', () => {
  for (const hostname of ['www.thestarters.com', 'thestarters.com', 'localhost', 'other.webflow.io']) {
    const env = environment({ hostname })
    assert.equal(env.audience, undefined)
    assert.equal(env.calls, 0)
    assert.equal(env.timerCount, 0)
  }
})

test('waits for the modal owner from DOMContentLoaded and guards repeated loads', () => {
  const env = environment({ modalReady: false, readyState: 'loading' })
  env.advance(5000)
  assert.equal(env.window.lumos, undefined)
  env.domReady()
  env.window.lumos = { modal: { init() {} } }
  env.advance(50)
  assert.equal(typeof env.audience, 'function')
  const original = env.audience
  env.reload()
  assert.equal(env.audience, original)
})

const talentPlan = plans.find(plan => plan.role === 'talent').id
const paidPlan = plans.find(plan => plan.role === 'brand-paid').id
test('signals reuse the audience member and real plan-date normalization', async () => {
  const data = member(paidPlan)
  data.createdAt = '2026-11-01T00:00:00Z'
  data.planConnections.unshift({ active: true, payment: null })
  data.planConnections[1].payment = { nextBillingDate: 1794096000, cancelAtDate: 1794182400 }
  const env = environment({ response: { data } })
  assert.equal(await env.audience(), 'brand-paid')
  const promise = env.signals()
  assert.equal(env.signals(), promise)
  const value = await promise
  assert.equal(value.createdAt, Date.parse(data.createdAt))
  assert.equal(value.nextBillingDate, 1794096000000)
  assert.equal(value.cancelAt, 1794182400000)
  assert.equal(env.calls, 1)
  assert.equal(env.externalReads, 0)
})

test('an absent cancellation date is empty; malformed dates remain unknown', async () => {
  for (const cancelAtDate of [undefined, null, '', 'invalid']) {
    const data = member(paidPlan)
    data.planConnections[0].payment = { nextBillingDate: '1794096000', cancelAtDate }
    const value = await environment({ response: { data } }).signals()
    assert.equal(value.cancelAt, cancelAtDate === 'invalid' ? undefined : null)
    assert.equal(value.nextBillingDate, 1794096000000)
    assert.equal(value.createdAt, null)
  }
  const env = environment({ datesReady: false, response: { data: member(paidPlan) } })
  assert.equal((await env.signals()).nextBillingDate, null)
})

test('date signals use only member data for signed-out visitors, brands and Starters', async () => {
  for (const data of [null, member(paidPlan), member(talentPlan)]) {
    const env = environment({ response: { data } })
    const signals = await env.signals()
    assert.deepEqual(Object.keys(signals).sort(), ['cancelAt', 'createdAt', 'nextBillingDate'])
    assert.equal(env.externalReads, 0)
  }
})

test('off-staging installs no signal API and makes no requests', () => {
  for (const hostname of ['www.thestarters.com', 'thestarters.com', 'the-starters-3-0.webflow.io.evil.test']) {
    const env = environment({ hostname })
    assert.equal(env.signals, undefined)
    assert.equal(env.externalReads, 0)
  }
})
