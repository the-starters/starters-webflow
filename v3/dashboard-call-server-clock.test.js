const test = require('node:test')
const assert = require('node:assert/strict')
global.window = global
const api = require('./dashboard-call-actions.js')
const SERVER = 1800000000000
function booking(delta = 0) {
  return {booking_id:'clock-1', config_id:'config-1', data_environment:'test', status:'confirmed', paid_meeting:false, grant_id:'grant-1', duration:30, start:SERVER+8*3600000+delta, server_now_ms:SERVER, starter_data:{memberstack_id:'mem_sb_starter'},brand_data:{memberstack_id:'mem_sb_brand'}}
}
test('slow device clock cannot open rescheduling at exact server cutoff', () => {
  const b=booking()
  const before=Date.now
  Date.now=()=>SERVER-3600000
  try { assert.equal(api.canProposeReschedule('brand', b), false) }
  finally { Date.now=before }
})

function withClock(fn) {
  const original=Object.getOwnPropertyDescriptor(global,'performance')
  let mono=100
  Object.defineProperty(global,'performance',{configurable:true,value:{now:()=>mono}})
  try { fn(value=>{mono=value}) } finally {Object.defineProperty(global,'performance',original)}
}
test('both roles use strict eight-hour cutoff with a bound clock', () => withClock(() => {
  for(const delta of [-1,0,1]) for(const role of ['brand','starter']) {
    const b=booking(delta)
    assert.equal(api.bindCanonicalClock([b],100),true)
    assert.equal(api.canProposeReschedule(role,b),delta>0)
  }
}))
test('wall-clock drift does not change bound eligibility', () => withClock(() => {
  const b=booking(1); api.bindCanonicalClock([b],100)
  const original=Date.now
  try {for(const drift of [-3600000,3600000]) { Date.now=()=>SERVER+drift;assert.equal(api.canProposeReschedule('brand',b),true) }}
  finally {Date.now=original}
}))
test('full request latency closes a crossed cutoff', () => withClock(set => {
  const b=booking(500);set(1100);api.bindCanonicalClock([b],100)
  assert.equal(api.canProposeReschedule('brand',b),false)
}))
test('advancing clock closes an already-open proposal', () => withClock(set => {
  const b=booking(1);api.bindCanonicalClock([b],100)
  assert.equal(api.canProposeReschedule('brand',b),true)
  set(101);assert.equal(api.canProposeReschedule('brand',b),false)
}))
test('invalid, missing and inconsistent stamps fail closed', () => withClock(() => {
  for(const stamp of [null,undefined,'1800000000000',NaN,Infinity,0]) {
    const b=booking(1);b.server_now_ms=stamp
    assert.equal(api.bindCanonicalClock([b],100),false)
    assert.equal(api.canProposeReschedule('brand',b),false)
  }
  const a=booking(1), b=booking(1);b.server_now_ms++
  assert.equal(api.bindCanonicalClock([a,b],100),false)
}))
test('backwards monotonic clock invalidates the binding permanently', () => withClock(set => {
  const b=booking(1000);api.bindCanonicalClock([b],100)
  set(99);assert.equal(api.canProposeReschedule('brand',b),false)
  set(101);assert.equal(api.canProposeReschedule('brand',b),false)
}))
test('confirmation checks original cutoff and keeps decline eligibility separate', () => withClock(() => {
  const b=booking(3600000);b.status='rescheduled';b.rescheduled_by='starter';b.start_old=SERVER+8*3600000
  api.bindCanonicalClock([b],100)
  assert.equal(api.canConfirmReschedule('brand',b),false)
  assert.equal(api.canRespondReschedule('brand',b),true)
  b.start_old++;assert.equal(api.canConfirmReschedule('brand',b),true)
  b.start=SERVER;assert.equal(api.canConfirmReschedule('brand',b),false)
}))

test('calendar load and confirmation recheck a cutoff crossed while waiting', async () => {
  const originals = {
    performance: Object.getOwnPropertyDescriptor(global, 'performance'),
    calendar: global.StartersPaidCallBrandPayment,
    fetch: global.xanoAuthFetch,
    setTimeout: global.setTimeout,
  }
  let mono = 100
  let submitCount = 0
  let mountCount = 0
  let resolveScriptLoad
  const container = { textContent: '' }
  const modal = {
    getAttribute(name) { return name === 'data-booking-id' ? 'clock-1' : null },
    querySelector(selector) {
      return selector === '[booking-reschedule-calendar]' ? container : null
    },
    querySelectorAll() { return [] },
  }
  const script = {
    addEventListener(name, callback) {
      if (name === 'load') resolveScriptLoad = callback
    },
  }
  const document = {
    createElement() { return script },
    querySelector() { return script },
  }
  try {
    Object.defineProperty(global, 'performance', { configurable: true, value: { now: () => mono } })
    global.setTimeout = () => 1
    global.xanoAuthFetch = async () => { submitCount++; throw new Error('unexpected provider request') }
    global.StartersPaidCallBrandPayment = undefined
    const first = booking(1)
    assert.equal(api.bindCanonicalClock([first], 100), true)
    const pending = api.mountRescheduleCalendar(document, modal, first, 'brand', 'new time')
    assert.equal(typeof resolveScriptLoad, 'function')
    mono = 101
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar() { mountCount++ },
    }
    resolveScriptLoad()
    assert.equal(await pending, false)
    assert.equal(mountCount, 0, 'a late calendar module cannot mount after cutoff')

    mono = 200
    const second = booking(1)
    let calendarOptions
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar(options) { mountCount++; calendarOptions = options },
    }
    assert.equal(api.bindCanonicalClock([second], 200), true)
    assert.equal(await api.mountRescheduleCalendar(document, modal, second, 'brand', 'new time'), true)
    assert.equal(mountCount, 1)
    mono = 201
    assert.equal(await calendarOptions.onConfirm({ start: SERVER + 9 * 3600000, end: SERVER + 9 * 3600000 + 1800000 }), null)
    assert.equal(submitCount, 0, 'a late calendar confirmation cannot submit')
  } finally {
    Object.defineProperty(global, 'performance', originals.performance)
    global.StartersPaidCallBrandPayment = originals.calendar
    global.xanoAuthFetch = originals.fetch
    global.setTimeout = originals.setTimeout
  }
})
