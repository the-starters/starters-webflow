const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./membership-status.js'), 'utf8')
const PAID = 'pln_new-paid-plan-463h04ph'

function matches(el, selector) {
  return selector.split(',').some((part) => {
    const pieces = part.trim().split(/\s+/)
    function simple(node, value) {
      if (!node) return false
      const tag = value.match(/^[a-z]+/i)?.[0]
      if (tag && node.tagName !== tag.toUpperCase()) return false
      if (value.includes(':checked') && !node.checked) return false
      const attrs = [...value.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)]
      return attrs.every(([, key, expected]) => expected === undefined
        ? node.hasAttribute(key)
        : node.getAttribute(key) === expected)
    }
    if (!simple(el, pieces.pop())) return false
    let ancestor = el.parentElement
    while (pieces.length) {
      const value = pieces.pop()
      while (ancestor && !simple(ancestor, value)) ancestor = ancestor.parentElement
      if (!ancestor) return false
      ancestor = ancestor.parentElement
    }
    return true
  })
}

class El {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase()
    this.attrs = { ...attrs }
    this.children = []
    this.style = { display: '', removeProperty: (key) => { this.style[key] = '' } }
  }
  setAttribute(key, value) { this.attrs[key] = String(value) }
  getAttribute(key) { return this.hasAttribute(key) ? this.attrs[key] : null }
  hasAttribute(key) { return key in this.attrs }
  removeAttribute(key) { delete this.attrs[key] }
  appendChild(el) { el.parentElement = this; this.children.push(el); return el }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (matches(node, selector)) return node
    }
    return null
  }
  querySelectorAll(selector) {
    return this.children.flatMap((el) => [el, ...el.descendants()]).filter((el) => matches(el, selector))
  }
  descendants() { return this.children.flatMap((el) => [el, ...el.descendants()]) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}

function plan(status = 'ACTIVE', extra = {}) {
  return { planId: PAID, active: true, status, ...extra }
}
function member(plans, customFields = {}) { return { id: 'member-test', planConnections: plans, customFields } }
function event(target, extra = {}) {
  return { target, prevented: false, stopped: false,
    preventDefault() { this.prevented = true },
    stopImmediatePropagation() { this.stopped = true }, ...extra }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

function harness(initial, options = {}) {
  const root = new El('html')
  const head = root.appendChild(new El('head'))
  const body = root.appendChild(new El('body'))
  const add = (parent, attrs = {}, tag = 'div') => parent.appendChild(new El(tag, attrs))
  const pauseCard = add(body, { 'data-member-status': 'pause-option' })
  const pause = add(pauseCard, { 'data-member-status': 'active', 'data-panel-nav-target': 'pause-membership' })
  const paused = add(pauseCard, { 'data-member-status': 'paused' })
  const cancel = add(body, { 'data-panel-nav-target': 'cancel-membership' })
  const complete = add(body, { 'data-project-status': 'complete' })
  const incomplete = add(body, { 'data-project-status': 'incomplete' })
  const cancelFlow = add(body, { 'data-form-flow': 'cancel-membership', 'ms-form-cancel-state': '' })
  const cancelForm = add(cancelFlow, {}, 'form')
  const price = add(cancelForm, { 'data-member-price': 'recurring' }, 'p')
  price.textContent = 'Included'
  const firstGroup = add(cancelForm, { 'data-form-flow-button-group': 'step-1' })
  const next = add(firstGroup, { 'data-form-flow-action': 'next' })
  const radioList = add(cancelForm, { 'data-form-flow-element': 'radio-list' })
  const busyReason = add(radioList, { 'data-form-flow-value': 'step-2d' })
  const busyInput = add(busyReason, { type: 'radio' }, 'input')
  busyInput.checked = true
  const busyFooter = add(cancelForm, { 'data-form-flow-button-group': 'step-2d-1' })
  const pauseInstead = add(busyFooter, { 'data-form-flow-action': 'next' })
  const cancelInstead = add(busyFooter, { 'data-form-flow-action': 'branch', 'data-form-flow-target': 'step-3' })
  const confirmPause = add(cancelForm, { 'ms-form-cancel-state-change': 'pause' })
  const finalFooter = add(cancelForm, { 'data-form-flow-button-group': 'step-3' })
  const back = add(finalFooter, { 'data-form-flow-action': 'back' })
  const pauseFlow = add(body, { 'data-form-flow': 'pause-membership' })
  const pauseForm = add(pauseFlow, {}, 'form')
  const directPause = add(pauseForm, { 'data-form-flow-action': 'next' })
  const listeners = {}
  const windowListeners = {}
  const observers = []
  const jumps = []
  const resets = []
  let onAuthChange
  let reads = 0
  let value = initial
  const document = {
    readyState: 'complete', documentElement: root, head,
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    createElement: (tag) => new El(tag),
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
  }
  const window = {
    setTimeout, clearTimeout,
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn) },
    $memberstackDom: {
      getCurrentMember() {
        reads += 1
        if (options.reader) return options.reader()
        return value instanceof Error ? Promise.reject(value) : Promise.resolve({ data: value })
      },
      onAuthChange(fn) { onAuthChange = fn },
    },
    lumos: { formFlow: { list: { 'cancel-membership': {
      el: cancelFlow, goTo: (id) => jumps.push(id), reset: () => resets.push(true),
    } } } },
  }
  const context = vm.createContext({ window, document, console, Date,
    MutationObserver: class { constructor(fn) { observers.push(fn) } observe() {} },
  })
  vm.runInContext(source, context)
  return { root, body, pauseCard, pause, paused, cancel, complete, incomplete, cancelFlow, cancelForm, price,
    next, back, busyReason, busyInput, pauseInstead, cancelInstead, confirmPause, directPause, pauseForm,
    jumps, resets, listeners, windowListeners, window, add, get reads() { return reads },
    auth: (nextMember) => onAuthChange(nextMember),
    mutate: () => observers.forEach((fn) => fn()),
    setMember(nextMember) { value = nextMember },
    click(target) { const e = event(target); listeners.click.forEach((fn) => fn(e)); return e },
    submit(target, submitter) { const e = event(target, { submitter }); listeners.submit.forEach((fn) => fn(e)); return e },
    reloadScript: () => vm.runInContext(source, context),
  }
}

function blocked(el) { return el.getAttribute('data-membership-pause-blocked') === 'true' }

for (const connection of [
  plan('TRIALING'),
  plan('ACTIVE', { payment: { status: 'trialing', amount: 1 } }),
  plan(' trialing '),
  plan('TRIALING', { active: false }),
]) {
  test('trial status blocks every Pause control while cancellation stays available: ' + JSON.stringify(connection), async () => {
    const h = harness(member([connection]))
    await flush()
    for (const control of [h.pauseCard, h.pause, h.pauseInstead, h.confirmPause, h.directPause]) {
      assert.equal(blocked(control), true)
      assert.equal(control.hasAttribute('inert'), true)
      assert.equal(h.click(control).prevented, true)
    }
    assert.equal(h.cancel.hasAttribute('hidden'), false)
    assert.equal(h.click(h.cancel).prevented, false)
    assert.equal(h.click(h.cancelInstead).prevented, false)
    assert.equal(h.submit(h.cancelForm).prevented, false)
    assert.equal(h.submit(h.pauseForm).prevented, true)
    h.cancelFlow.setAttribute('ms-form-cancel-state-current', 'pause')
    assert.equal(h.submit(h.cancelForm).prevented, true)
  })
}

for (const amount of [295, 495, 3540]) {
  test('paid membership keeps Pause and cancellation controls and its price ' + amount, async () => {
    const data = member([plan('ACTIVE', { payment: { amount, status: 'active' } })])
    const before = structuredClone(data)
    const h = harness(data)
    await flush()
    assert.equal(blocked(h.pause), false)
    assert.equal(h.pause.hasAttribute('hidden'), false)
    assert.equal(h.paused.hasAttribute('hidden'), true)
    assert.equal(h.click(h.pauseInstead).prevented, false)
    assert.equal(h.submit(h.pauseForm).prevented, false)
    assert.deepEqual(data, before)
  })
}

test('trial Too busy reason skips the Pause offer through the existing cancellation flow', async () => {
  const h = harness(member([plan('TRIALING')]))
  await flush()
  assert.equal(h.click(h.next).prevented, true)
  assert.deepEqual(h.jumps, ['step-3'])
  assert.equal(h.click(h.back).prevented, true)
  assert.deepEqual(h.resets, [true])
  assert.equal(h.click(h.back).prevented, false)
  h.busyReason.setAttribute('data-form-flow-value', 'step-2c')
  assert.equal(h.click(h.next).prevented, false)
})

test('paid Too busy reason keeps the existing retention flow', async () => {
  const h = harness(member([plan()]))
  await flush()
  assert.equal(h.click(h.next).prevented, false)
  assert.deepEqual(h.jumps, [])
})

test('an inactive historical trial does not hide Pause for the current paid membership', async () => {
  const h = harness(member([plan('TRIALING', { active: false }), plan()]))
  await flush()
  assert.equal(blocked(h.pause), false)
})

test('trial in another plan does not change this membership', async () => {
  const h = harness(member([plan(), plan('TRIALING', { planId: 'other-product' })]))
  await flush()
  assert.equal(blocked(h.pause), false)
})

test('paused members retain the paused state and project blocking stays unchanged', async () => {
  const h = harness(member([plan()], { 'membership-paused': 'True', 'incomplete-ongoing-project': true }))
  await flush()
  assert.equal(h.pause.hasAttribute('hidden'), true)
  assert.equal(h.paused.hasAttribute('hidden'), false)
  assert.equal(h.complete.hasAttribute('hidden'), true)
  assert.equal(h.incomplete.hasAttribute('hidden'), false)
})

test('missing member data, free memberships and read failure keep Pause blocked', async () => {
  for (const data of [null, member([]), member([plan('ACTIVE', { planId: 'free' })]), new Error('unavailable')]) {
    const h = harness(data)
    assert.equal(blocked(h.pauseInstead), true)
    await flush()
    assert.equal(blocked(h.pause), true)
    assert.equal(h.click(h.cancel).prevented, false)
  }
})

for (const membershipStatus of [undefined, '', 'UNKNOWN', 'future-status']) {
  test('unrecognized membership status withholds Pause despite a paid payment status: ' + membershipStatus, async () => {
    const data = member([plan(membershipStatus, {
      status: membershipStatus,
      payment: { status: 'active', priceId: 'prc_3-0-premium-monthly-ge4a00iw' },
    })])
    const before = structuredClone(data)
    const h = harness(data)
    await flush()
    for (const control of [h.pauseCard, h.pause, h.pauseInstead, h.confirmPause, h.directPause]) {
      assert.equal(blocked(control), true)
      assert.equal(control.hasAttribute('inert'), true)
      assert.equal(h.click(control).prevented, true)
    }
    assert.equal(h.submit(h.pauseForm).prevented, true)
    assert.equal(h.click(h.cancel).prevented, false)
    assert.equal(h.click(h.cancelInstead).prevented, false)
    assert.equal(h.submit(h.cancelForm).prevented, false)
    assert.equal(h.price.textContent, 'Included')
    assert.equal(h.paused.hasAttribute('hidden'), true)
    assert.deepEqual(data, before)
  })
}

test('unknown current status blocks Pause but inactive unknown history does not', async () => {
  const h = harness(member([plan('UNKNOWN'), plan()]))
  await flush()
  assert.equal(blocked(h.pauseInstead), true)
  h.auth(member([plan('UNKNOWN', { active: false }), plan()]))
  assert.equal(blocked(h.pauseInstead), false)
})

test('an explicit paused field stays visible when subscription status is unresolved', async () => {
  const h = harness(member([plan('UNKNOWN')], { 'membership-paused': true }))
  await flush()
  assert.equal(blocked(h.pauseInstead), true)
  assert.equal(h.paused.hasAttribute('hidden'), false)
})

test('unknown-status Too busy cancellation skips the unavailable Pause offer and keeps Back working', async () => {
  const h = harness(member([plan('UNKNOWN')]))
  await flush()
  assert.equal(h.click(h.next).prevented, true)
  assert.deepEqual(h.jumps, ['step-3'])
  assert.equal(h.click(h.back).prevented, true)
  assert.deepEqual(h.resets, [true])
  h.auth(member([plan()]))
  assert.equal(h.click(h.next).prevented, false)
  assert.deepEqual(h.jumps, ['step-3'])
})

test('status resolution restores paid Pause and price labels without changing the member', async () => {
  const h = harness(member([plan('UNKNOWN')]))
  await flush()
  assert.equal(blocked(h.pauseInstead), true)
  for (const [priceId, label] of [
    ['prc_premium-monthly--fn1ae0qjj', '$295/mo'],
    ['prc_3-0-premium-monthly-ge4a00iw', '$495/mo'],
    ['prc_paid-annual-2o5f040u', '$2,340/yr'],
    ['prc_3-0-premium-annual-xhb200bu', '$3,540/yr'],
  ]) {
    const data = member([plan('ACTIVE', { payment: { priceId, status: 'active' } })])
    const before = structuredClone(data)
    h.auth(data)
    assert.equal(blocked(h.pauseInstead), false)
    assert.equal(h.price.textContent, label)
    assert.deepEqual(data, before)
  }
  h.auth(member([plan('UNKNOWN')]))
  assert.equal(blocked(h.pauseInstead), true)
  assert.equal(h.price.textContent, 'Included')
})

test('a late member lookup cannot overwrite an auth change', async () => {
  let finish
  const h = harness(null, { reader: () => new Promise((resolve) => { finish = resolve }) })
  h.auth(member([plan('TRIALING')]))
  finish({ data: member([plan()]) })
  await flush()
  assert.equal(blocked(h.pause), true)
  h.auth(member([plan()]))
  assert.equal(blocked(h.pause), false)
  h.auth(null)
  assert.equal(blocked(h.pause), true)
})

test('late-inserted Pause controls get the current trial state', async () => {
  const h = harness(member([plan('TRIALING')]))
  await flush()
  const late = h.add(h.body, { 'data-panel-nav-target': 'pause-membership' })
  h.mutate()
  assert.equal(blocked(late), true)
})

test('refresh after trial conversion restores paid controls; duplicate loads bind once', async () => {
  const h = harness(member([plan('TRIALING')]))
  await flush()
  h.setMember(member([plan()]))
  await h.window.StartersMembershipStatus.refresh()
  assert.equal(blocked(h.pause), false)
  h.reloadScript()
  assert.equal(h.listeners.click.length, 1)
  assert.equal(h.reads, 2)
})

for (const [priceId, expected] of [
  ['prc_premium-monthly--fn1ae0qjj', '$295/mo'],
  ['prc_paid-annual-2o5f040u', '$2,340/yr'],
  ['prc_3-0-premium-monthly-ge4a00iw', '$495/mo'],
  ['prc_3-0-premium-annual-xhb200bu', '$3,540/yr'],
]) {
  test('cancellation displays the subscribed rate for ' + priceId, async () => {
    const data = member([plan('ACTIVE', { payment: { priceId, amount: 1 } })])
    data.createdAt = '2020-01-01T00:00:00Z'
    const before = structuredClone(data)
    const h = harness(data)
    await flush()
    assert.equal(h.price.textContent, expected)
    assert.deepEqual(data, before)
  })
}

test('trial shows the recurring rate after trial, not the upfront $1 fee', async () => {
  const h = harness(member([plan('ACTIVE', { payment: {
    priceId: 'prc_3-0-premium-monthly-ge4a00iw', status: 'trialing', amount: 1,
  } })]))
  await flush()
  assert.equal(h.price.textContent, '$495/mo after your trial')
  assert.equal(blocked(h.pause), true)
  h.auth(member([plan('ACTIVE', { priceId: 'prc_premium-monthly--fn1ae0qjj' })]))
  assert.equal(h.price.textContent, '$295/mo')
  h.auth(null)
  assert.equal(h.price.textContent, 'Included')
})

test('historical price cannot override the current subscription or a returning member rate', async () => {
  const h = harness(member([
    plan('CANCELED', { active: false, priceId: 'prc_premium-monthly--fn1ae0qjj' }),
    plan('ACTIVE', { priceId: 'prc_3-0-premium-monthly-ge4a00iw' }),
  ]))
  await flush()
  assert.equal(h.price.textContent, '$495/mo')
})

test('unresolved, unknown and multiple current subscriptions never guess a price', async () => {
  for (const plans of [[], [plan()], [plan('ACTIVE', { priceId: 'unconfirmed-legacy-rate' })], [
    plan('ACTIVE', { priceId: 'prc_premium-monthly--fn1ae0qjj' }),
    plan('ACTIVE', { priceId: 'prc_3-0-premium-monthly-ge4a00iw' }),
  ]]) {
    const h = harness(member(plans))
    await flush()
    assert.equal(h.price.textContent, 'Included')
  }
})

test('late-inserted price text uses the current member and resets after a failed refresh', async () => {
  const h = harness(member([plan('ACTIVE', { priceId: 'prc_3-0-premium-monthly-ge4a00iw' })]))
  await flush()
  const late = h.add(h.body, { 'data-member-price': 'recurring' })
  h.mutate()
  assert.equal(late.textContent, '$495/mo')
  h.setMember(new Error('unavailable'))
  await h.window.StartersMembershipStatus.refresh()
  assert.equal(late.textContent, 'Included')
})
