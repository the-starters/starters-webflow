/* Paid parity client gates P5 (held-call cancel + fee line), P6 (pending Paid
   edit) and P7 (saved-card Paid reschedule). Each gate mirrors a server
   admission rule, so these tests pin role x status x payment state x time
   window x environment, including the exact 24 h and 48 h 15 min edges, and
   assert that Free behavior does not change. */
const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./dashboard-call-actions.js')
const calls = require('./dashboard-calls.js')

const H = 60 * 60 * 1000
const LEAD = 48 * H + 15 * 60 * 1000
const DAY = 24 * H

test('the Paid constants match the server rules and open Test only', () => {
  assert.equal(api.PAID_CONFIRMED_CANCEL_LEAD_MS, LEAD)
  assert.equal(api.PAID_LATE_CANCEL_FEE_WINDOW_MS, DAY)
  assert.deepEqual(api.PAID_EDIT_OPEN_ENVIRONMENTS, ['test'])
  assert.deepEqual(api.PAID_RESCHEDULE_OPEN_ENVIRONMENTS, ['test'])
  assert.deepEqual(api.PAID_HOLD_CANCEL_OPEN_ENVIRONMENTS, ['test'])
  assert.equal(
    api.CANCEL_FEE_TEXT.late,
    'This call starts within 24 hours. Cancelling now charges the full session fee.',
  )
  assert.equal(api.CANCEL_FEE_TEXT.none, 'No charge will be made for this cancellation.')
})

/* ---------- shared fixtures ---------- */

function identity(overrides) {
  return Object.assign(
    {
      booking_id: 'booking-paid-1',
      config_id: 'config-paid-1',
      grant_id: 'grant-paid-1',
      duration: 30,
      data_environment: 'test',
      starter_data: { memberstack_id: 'mem_sb_starter' },
      brand_data: { memberstack_id: 'mem_sb_brand' },
    },
    overrides || {},
  )
}

function savedCard(overrides) {
  return identity(Object.assign(
    {
      paid_meeting: true,
      payment_intent: null,
      payment_status: 'waiting_for_intent',
      payment_revision: 0,
      payment_reconciliation_status: 'ready',
    },
    overrides || {},
  ))
}

function held(overrides) {
  return identity(Object.assign(
    {
      paid_meeting: true,
      status: 'confirmed',
      payment_intent: 'pi_test_hold',
      payment_status: 'intent_created',
      payment_revision: 1,
      payment_reconciliation_status: 'reconciled',
    },
    overrides || {},
  ))
}

// Rows on the canonical (server) clock, as the dashboard binds them.
function clocked(row) {
  row.server_now_ms = Date.now()
  api.bindCanonicalClock([row], api.monotonicNow())
  return row
}

const SAVED_CARD_REFUSALS = [
  ['PaymentIntent present', { payment_intent: 'pi_test_1' }],
  ['intent_created', { payment_status: 'intent_created' }],
  ['intent_cancelled', { payment_status: 'intent_cancelled' }],
  ['declined card', { payment_status: 'card_or_payment_declined' }],
  ['auth_required', { payment_status: 'auth_required' }],
  ['null payment_status', { payment_status: null }],
  ['revision 1', { payment_revision: 1 }],
  ['revision null', { payment_revision: null }],
  ['revision missing', { payment_revision: undefined }],
  ['revision empty', { payment_revision: '' }],
  ['reconciliation pending', { payment_reconciliation_status: 'pending' }],
  ['reconciliation failed', { payment_reconciliation_status: 'failed' }],
  ['reconciliation mismatch', { payment_reconciliation_status: 'mismatch' }],
  ['reconciliation null', { payment_reconciliation_status: null }],
]

test('paidSavedCardState admits only the no-PaymentIntent saved-card state', () => {
  assert.equal(api.paidSavedCardState(savedCard()), true)
  assert.equal(api.paidSavedCardState(savedCard({ payment_intent: '' })), true)
  assert.equal(api.paidSavedCardState(savedCard({ payment_revision: '0' })), true)
  assert.equal(api.paidSavedCardState(savedCard({ payment_status: 'WAITING_FOR_INTENT' })), true)
  for (const [label, change] of SAVED_CARD_REFUSALS) {
    assert.equal(api.paidSavedCardState(savedCard(change)), false, label)
  }
  assert.equal(api.paidSavedCardState(savedCard({ paid_meeting: false })), false, 'Free')
  assert.equal(api.paidSavedCardState(savedCard({ paid_meeting: undefined })), false, 'unflagged')
  assert.equal(api.paidSavedCardState(null), false)
})

/* ---------- P5: cancel a held confirmed Paid call ---------- */

test('P5: paidHoldCancelAdmitted needs a reconciled authorized hold on a confirmed Paid call', () => {
  assert.equal(api.paidHoldCancelAdmitted(held()), true)
  assert.equal(api.paidHoldCancelAdmitted(held({ is_paid: true, paid_meeting: undefined })), true)
  const refusals = [
    ['no PaymentIntent', { payment_intent: '' }],
    ['waiting_for_intent', { payment_status: 'waiting_for_intent' }],
    ['auth_required', { payment_status: 'auth_required' }],
    ['declined', { payment_status: 'card_or_payment_declined' }],
    ['intent_cancelled', { payment_status: 'intent_cancelled' }],
    ['intent_captured', { payment_status: 'intent_captured' }],
    ['reconciliation pending', { payment_reconciliation_status: 'pending' }],
    ['reconciliation failed', { payment_reconciliation_status: 'failed' }],
    ['reconciliation mismatch', { payment_reconciliation_status: 'mismatch' }],
    ['reconciliation ready', { payment_reconciliation_status: 'ready' }],
    ['status rescheduled', { status: 'rescheduled' }],
    ['status pending', { status: 'pending' }],
    ['Free', { paid_meeting: false }],
  ]
  for (const [label, change] of refusals) {
    assert.equal(api.paidHoldCancelAdmitted(held(change)), false, label)
  }
})

test('P5: both participants can cancel a held Paid call until start, inside 48 h 15 min', () => {
  const now = Date.now()
  for (const role of ['brand', 'starter']) {
    for (const lead of [1, H, DAY - 1, DAY, DAY + 1, 47 * H, LEAD - 1, LEAD, LEAD + 1, 72 * H]) {
      assert.equal(api.canCancel(role, held({ start: now + lead }), now), true, role + ' +' + lead)
    }
    assert.equal(api.canCancel(role, held({ start: now }), now), false, role + ' at start')
    assert.equal(api.canCancel(role, held({ start: now - 1 }), now), false, role + ' after start')
  }
  assert.equal(api.canCancel('guest', held({ start: now + H }), now), false)
  // No environment gate on P5: #2099 P5 admits both env pairs.
  // P5 stays Test-only until #2099 P5 is published (then add 'production').
  assert.equal(api.canCancel('brand', held({ start: now + H, data_environment: 'production' }), now), false)
  assert.equal(api.canCancel('brand', held({ start: now + H, data_environment: '' }), now), false)
  assert.equal(api.canCancel('brand', held({ start: now + H, brand_data: {} }), now), false)
})

test('P5: every other Paid payment state inside 48 h 15 min hides Cancel', () => {
  const now = Date.now()
  const states = [
    { payment_status: 'waiting_for_intent', payment_intent: null, payment_reconciliation_status: 'ready' },
    { payment_status: 'auth_required' },
    { payment_status: 'card_or_payment_declined' },
    { payment_status: 'insufficient_funds' },
    { payment_status: 'intent_cancelled' },
    { payment_status: 'intent_created', payment_reconciliation_status: 'pending' },
    { payment_status: 'intent_created', payment_reconciliation_status: 'failed' },
    { payment_status: 'intent_created', payment_reconciliation_status: 'mismatch' },
    { payment_status: 'intent_created', payment_intent: '' },
  ]
  for (const role of ['brand', 'starter']) {
    for (const state of states) {
      for (const lead of [H, DAY, LEAD]) {
        assert.equal(
          api.canCancel(role, held(Object.assign({ start: now + lead }, state)), now),
          false,
          role + ' ' + JSON.stringify(state) + ' +' + lead,
        )
      }
    }
  }
  // A held but rescheduled row stays hidden (P5 admits confirmed only).
  assert.equal(api.canCancel('brand', held({ status: 'rescheduled', start: now + H }), now), false)
})

test('P5 regression: the P4 saved-card window and Free cancel are unchanged', () => {
  const now = Date.now()
  const p4 = savedCard({ status: 'confirmed' })
  assert.equal(api.canCancel('brand', { ...p4, start: now + LEAD }, now), false)
  assert.equal(api.canCancel('brand', { ...p4, start: now + LEAD + 1 }, now), true)
  assert.equal(api.canCancel('starter', { ...p4, start: now + LEAD + 1 }, now), true)
  // P1: a Brand may still withdraw a Paid pending request; a Starter may not.
  assert.equal(api.canCancel('brand', savedCard({ status: 'pending', start: now + H }), now), true)
  assert.equal(api.canCancel('starter', savedCard({ status: 'pending', start: now + H }), now), false)
  const free = identity({ paid_meeting: false, status: 'confirmed' })
  for (const role of ['brand', 'starter']) {
    for (const status of ['confirmed', 'rescheduled']) {
      for (const lead of [1, H, DAY, LEAD]) {
        assert.equal(api.canCancel(role, { ...free, status, start: now + lead }, now), true)
      }
      assert.equal(api.canCancel(role, { ...free, status, start: now }, now), false)
    }
  }
  assert.equal(api.canCancel('starter', { ...free, status: 'pending', start: now + H }, now), false)
})

test('P5: the fee line charges a Brand only at or within 24 h of a confirmed Paid start', () => {
  const now = Date.now()
  const late = api.CANCEL_FEE_TEXT.late
  const none = api.CANCEL_FEE_TEXT.none
  assert.equal(api.cancelFeeText('brand', held({ start: now + DAY }), now), late, 'exactly 24 h')
  assert.equal(api.cancelFeeText('brand', held({ start: now + DAY - 1 }), now), late)
  assert.equal(api.cancelFeeText('brand', held({ start: now + 1 }), now), late)
  assert.equal(api.cancelFeeText('brand', held({ start: now + DAY + 1 }), now), none, '24 h + 1 ms')
  assert.equal(api.cancelFeeText('brand', held({ start: now + LEAD }), now), none)
  assert.equal(api.cancelFeeText('brand', savedCard({ status: 'confirmed', start: now + 72 * H }), now), none)
  for (const lead of [1, DAY, DAY + 1, 72 * H]) {
    assert.equal(api.cancelFeeText('starter', held({ start: now + lead }), now), none, 'starter +' + lead)
  }
  // A pending Paid request holds only a saved card: no charge at any time.
  assert.equal(api.cancelFeeText('brand', savedCard({ status: 'pending', start: now + H }), now), none)
  // Free keeps its confirmation unchanged.
  for (const role of ['brand', 'starter']) {
    for (const lead of [1, DAY, 72 * H]) {
      assert.equal(api.cancelFeeText(role, identity({ paid_meeting: false, status: 'confirmed', start: now + lead }), now), '')
      assert.equal(api.cancelFeeText(role, identity({ status: 'confirmed', start: now + lead }), now), '')
    }
  }
})

/* ---------- a small DOM for render and wire tests ---------- */

function matchesPart(node, part) {
  const parsed = /^([a-z0-9]*)((?:\[[^\]]+\])*)$/i.exec(part.trim())
  if (!parsed) return false
  if (parsed[1] && node.tagName !== parsed[1].toLowerCase()) return false
  const attributes = parsed[2].match(/\[[^\]]+\]/g) || []
  return attributes.every(function (raw) {
    const body = raw.slice(1, -1)
    const at = body.indexOf('=')
    if (at === -1) return node.hasAttribute(body)
    const name = body.slice(0, at)
    const value = body.slice(at + 1).replace(/^"|"$/g, '')
    return node.getAttribute(name) === value
  })
}

class FakeElement {
  constructor(tag, attributes, children) {
    this.tagName = String(tag).toLowerCase()
    this.attributes = new Map(Object.entries(attributes || {}))
    this.children = []
    this.childNodes = this.children
    this.parentNode = null
    this.hidden = false
    this.style = {}
    this.className = ''
    this.text = ''
    this.listeners = {}
    ;(children || []).forEach((child) => this.appendChild(child))
  }
  get ownerDocument() { return fakeDocumentRef.current }
  get nextSibling() {
    if (!this.parentNode) return null
    const siblings = this.parentNode.children
    return siblings[siblings.indexOf(this) + 1] || null
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('')
  }
  set textContent(value) {
    this.children.splice(0).forEach((child) => { child.parentNode = null })
    this.text = String(value)
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }
  addEventListener(event, handler) { this.listeners[event] = handler }
  removeEventListener(event) { delete this.listeners[event] }
  appendChild(child) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1)
    child.parentNode = this
    this.children.push(child)
    return child
  }
  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child)
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1)
    child.parentNode = this
    this.children.splice(this.children.indexOf(reference), 0, child)
    return child
  }
  descendants() {
    return this.children.flatMap((child) => [child].concat(child.descendants()))
  }
  matches(selector) {
    return selector.split(',').some((part) => matchesPart(this, part))
  }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector))
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  closest(selector) {
    let node = this
    while (node) {
      if (node.matches && node.matches(selector)) return node
      node = node.parentNode
    }
    return null
  }
}

const fakeDocumentRef = { current: null }

function el(tag, attributes, children) {
  return new FakeElement(tag, attributes, children)
}

function cancelModal(options) {
  const settings = options || {}
  const body = el('p', { 'confirming-cancel-text': '' })
  body.className = 'text-size-medium'
  body.textContent = 'Are you sure you want to cancel this call?'
  const cancelChildren = settings.anchor === false ? [] : [el('div', {}, [body])]
  if (settings.authoredSlot) cancelChildren.push(el('p', { 'booking-copy': 'cancel-fee' }))
  cancelChildren.push(el('div', { 'booking-action-btn': 'switch-cancel-reason' }))
  const panels = {
    base: el('div', { 'booking-popup-content': 'base' }, [
      el('div', { 'booking-action-btn': 'switch-cancel' }),
    ]),
    cancel: el('div', { 'booking-popup-content': 'cancel' }, cancelChildren),
    reason: el('div', { 'booking-popup-content': 'cancel-reason' }, [
      el('textarea', { 'booking-cancel-reason': '' }),
    ]),
  }
  const modal = el('div', { 'popup-booking-info': '' }, [panels.base, panels.cancel, panels.reason])
  const head = el('head')
  const document = {
    head,
    documentElement: head,
    clickHandlers: [],
    createElement(tag) { return el(tag) },
    querySelector(selector) {
      return head.querySelector(selector) || (modal.matches(selector) ? modal : modal.querySelector(selector))
    },
    querySelectorAll(selector) { return modal.querySelectorAll(selector) },
    addEventListener(event, handler) { if (event === 'click') this.clickHandlers.push(handler) },
    removeEventListener() {},
  }
  fakeDocumentRef.current = document
  return { modal, panels, document, body }
}

function openCancel(fixture) {
  api.switchPopupContent(fixture.modal, 'cancel')
}

function visibleFeeNotes(modal) {
  return modal
    .querySelectorAll('[data-starters-cancel-fee-note], [booking-copy="cancel-fee"]')
    .filter((node) => !node.hidden && node.style.display !== 'none')
}

test('P5: the fee line renders after the authored confirmation text, styled like it', () => {
  const fixture = cancelModal()
  const now = Date.now()
  openCancel(fixture)
  assert.equal(api.renderCancelFeeNote(fixture.document, fixture.modal, 'brand', held({ start: now + H }), now), true)
  const notes = visibleFeeNotes(fixture.modal)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].textContent, api.CANCEL_FEE_TEXT.late)
  assert.equal(notes[0].className, 'text-size-medium')
  assert.equal(fixture.body.nextSibling, notes[0])
  // Re-rendering reuses the same line, never stacks a second one.
  api.renderCancelFeeNote(fixture.document, fixture.modal, 'starter', held({ start: now + H }), now)
  assert.equal(fixture.modal.querySelectorAll('[data-starters-cancel-fee-note]').length, 1)
  assert.equal(visibleFeeNotes(fixture.modal)[0].textContent, api.CANCEL_FEE_TEXT.none)
  // A Free booking opened next in the same modal shows no fee line.
  assert.equal(
    api.renderCancelFeeNote(fixture.document, fixture.modal, 'brand', identity({ paid_meeting: false, status: 'confirmed', start: now + H }), now),
    false,
  )
  assert.equal(visibleFeeNotes(fixture.modal).length, 0)
  // The authored confirmation copy itself is never rewritten.
  assert.equal(fixture.body.textContent, 'Are you sure you want to cancel this call?')
})

test('P5: an authored cancel-fee slot wins, and a panel without an anchor gets the line appended', () => {
  const now = Date.now()
  const authored = cancelModal({ authoredSlot: true })
  openCancel(authored)
  api.renderCancelFeeNote(authored.document, authored.modal, 'brand', held({ start: now + DAY }), now)
  const slot = authored.modal.querySelector('[booking-copy="cancel-fee"]')
  assert.equal(slot.textContent, api.CANCEL_FEE_TEXT.late)
  assert.equal(slot.hidden, false)
  assert.equal(authored.modal.querySelectorAll('[data-starters-cancel-fee-note]').length, 0)
  api.renderCancelFeeNote(authored.document, authored.modal, 'brand', identity({ status: 'confirmed', start: now + H }), now)
  assert.equal(slot.hidden, true)

  const bare = cancelModal({ anchor: false })
  openCancel(bare)
  api.renderCancelFeeNote(bare.document, bare.modal, 'brand', held({ start: now + DAY + 1 }), now)
  const note = bare.panels.cancel.querySelector('[data-starters-cancel-fee-note]')
  assert.equal(note.textContent, api.CANCEL_FEE_TEXT.none)
  assert.equal(bare.panels.cancel.children[bare.panels.cancel.children.length - 1], note)

  // Outside the open cancel panel nothing renders.
  const closed = cancelModal()
  api.switchPopupContent(closed.modal, 'base')
  assert.equal(api.renderCancelFeeNote(closed.document, closed.modal, 'brand', held({ start: now + H }), now), false)
  assert.equal(closed.modal.querySelectorAll('[data-starters-cancel-fee-note]').length, 0)
})

async function clickAction(fixture, button) {
  const event = { target: button, preventDefault() {}, stopImmediatePropagation() {} }
  for (const handler of fixture.document.clickHandlers.slice()) await handler(event)
}

test('P5: opening Cancel on a held Paid call shows the fee line; Free opens unchanged', async () => {
  for (const scenario of [
    { role: 'brand', booking: () => held({ start: Date.now() + 2 * H }), text: api.CANCEL_FEE_TEXT.late },
    { role: 'starter', booking: () => held({ start: Date.now() + 2 * H }), text: api.CANCEL_FEE_TEXT.none },
    { role: 'brand', booking: () => held({ start: Date.now() + 30 * H }), text: api.CANCEL_FEE_TEXT.none },
    { role: 'brand', booking: () => identity({ paid_meeting: false, status: 'confirmed', start: Date.now() + 2 * H }), text: null },
  ]) {
    const fixture = cancelModal()
    const booking = scenario.booking()
    api.wire({ document: fixture.document, role: scenario.role, getBooking: () => booking })
    await clickAction(fixture, fixture.panels.base.querySelector('[booking-action-btn="switch-cancel"]'))
    assert.equal(fixture.panels.cancel.hidden, false)
    const notes = visibleFeeNotes(fixture.modal)
    if (scenario.text == null) {
      assert.equal(notes.length, 0)
    } else {
      assert.equal(notes.length, 1)
      assert.equal(notes[0].textContent, scenario.text)
    }
  }
})

test('P5: a held Paid call inside 48 h 15 min with an unresolved hold cannot open Cancel', async () => {
  const fixture = cancelModal()
  const booking = held({ start: Date.now() + 2 * H, payment_reconciliation_status: 'pending' })
  const originalWarn = console.warn
  console.warn = function () {}
  try {
    api.wire({ document: fixture.document, role: 'brand', getBooking: () => booking })
    await clickAction(fixture, fixture.panels.base.querySelector('[booking-action-btn="switch-cancel"]'))
  } finally {
    console.warn = originalWarn
  }
  assert.notEqual(fixture.panels.cancel.style.display, 'flex')
  assert.equal(visibleFeeNotes(fixture.modal).length, 0)
})

/* ---------- P6: Brand edits a Paid pending request ---------- */

test('P6: paidPendingEditAdmitted needs pending, the saved card and an open environment', () => {
  const row = savedCard({ status: 'pending' })
  assert.equal(api.paidPendingEditAdmitted(row), true)
  assert.equal(api.paidPendingEditAdmitted({ ...row, data_environment: 'production' }), false)
  assert.equal(api.paidPendingEditAdmitted({ ...row, data_environment: '' }), false)
  for (const status of ['confirmed', 'rescheduled', 'cancelled', 'declined']) {
    assert.equal(api.paidPendingEditAdmitted({ ...row, status }), false, status)
  }
  for (const [label, change] of SAVED_CARD_REFUSALS) {
    assert.equal(api.paidPendingEditAdmitted({ ...row, ...change }), false, label)
  }
})

test('P6: the Brand can edit its Paid pending request in Test only', () => {
  const now = Date.now()
  const row = savedCard({ status: 'pending', start: now + 3 * DAY })
  assert.equal(api.canRequestReschedule('brand', row, now), true)
  assert.equal(api.rescheduleKindFor('brand', row, now), 'reschedule-request')
  assert.equal(api.canRequestReschedule('starter', row, now), false)
  assert.equal(api.canRequestReschedule('guest', row, now), false)
  assert.equal(api.canRequestReschedule('brand', { ...row, data_environment: 'production' }, now), false)
  assert.equal(api.rescheduleKindFor('brand', { ...row, data_environment: 'production' }, now), '')
  for (const [label, change] of SAVED_CARD_REFUSALS) {
    assert.equal(api.canRequestReschedule('brand', { ...row, ...change }, now), false, label)
  }
  // The Free shape rules still apply to Paid: duration, grant, identity, future.
  assert.equal(api.canRequestReschedule('brand', { ...row, duration: 0 }, now), false)
  assert.equal(api.canRequestReschedule('brand', { ...row, duration: undefined }, now), false)
  assert.equal(api.canRequestReschedule('brand', { ...row, grant_id: '' }, now), false)
  assert.equal(api.canRequestReschedule('brand', { ...row, brand_data: {} }, now), false)
  assert.equal(api.canRequestReschedule('brand', { ...row, start: now }, now), false)
  assert.equal(api.canRequestReschedule('brand', { ...row, start: now + 1 }, now), true)
  // The propose contract never claims a pending row.
  assert.equal(api.canProposeReschedule('brand', clocked({ ...row })), false)
})

test('P6 regression: Free pending edit is unchanged in every environment', () => {
  const now = Date.now()
  const free = identity({ paid_meeting: false, status: 'pending', start: now + H })
  for (const environment of ['test', 'production']) {
    assert.equal(api.canRequestReschedule('brand', { ...free, data_environment: environment }, now), true)
    assert.equal(api.canRequestReschedule('starter', { ...free, data_environment: environment }, now), false)
  }
  // Free never depends on payment fields.
  assert.equal(api.canRequestReschedule('brand', { ...free, payment_status: 'intent_created', payment_revision: 3 }, now), true)
  // A row without a paid flag still fails closed (strict freeBooking).
  assert.equal(api.canRequestReschedule('brand', identity({ status: 'pending', start: now + H }), now), false)
})

/* ---------- P7: reschedule a confirmed Paid call ---------- */

test('P7: paidProposedStartAllowed is strict at 48 h 15 min', () => {
  const now = 1_800_000_000_000
  assert.equal(api.paidProposedStartAllowed(now + LEAD - 1, now), false)
  assert.equal(api.paidProposedStartAllowed(now + LEAD, now), false)
  assert.equal(api.paidProposedStartAllowed(now + LEAD + 1, now), true)
  assert.equal(api.paidProposedStartAllowed(Number.NaN, now), false)
  assert.equal(api.paidProposedStartAllowed(now + 3 * DAY, null), false)
  assert.equal(api.paidProposedStartAllowed(now + 3 * DAY, undefined), false)
})

test('P7: paidRescheduleProposeAdmitted needs confirmed, the saved card, Test and the original start window', () => {
  const now = 1_800_000_000_000
  const row = savedCard({ status: 'confirmed', start: now + 3 * DAY })
  assert.equal(api.paidRescheduleProposeAdmitted(row, now), true)
  assert.equal(api.paidRescheduleProposeAdmitted({ ...row, start: now + LEAD }, now), false)
  assert.equal(api.paidRescheduleProposeAdmitted({ ...row, start: now + LEAD + 1 }, now), true)
  assert.equal(api.paidRescheduleProposeAdmitted({ ...row, start: now + DAY }, now), false)
  assert.equal(api.paidRescheduleProposeAdmitted({ ...row, data_environment: 'production' }, now), false)
  assert.equal(api.paidRescheduleProposeAdmitted({ ...row, status: 'pending' }, now), false)
  assert.equal(api.paidRescheduleProposeAdmitted({ ...row, status: 'rescheduled' }, now), false)
  assert.equal(api.paidRescheduleProposeAdmitted(row, null), false)
  for (const [label, change] of SAVED_CARD_REFUSALS) {
    assert.equal(api.paidRescheduleProposeAdmitted({ ...row, ...change }, now), false, label)
  }
})

test('P7: both participants can propose on a saved-card Paid call more than 48 h 15 min out', () => {
  for (const role of ['brand', 'starter']) {
    const row = clocked(savedCard({ status: 'confirmed', start: Date.now() + LEAD + 60000 }))
    assert.equal(api.canProposeReschedule(role, row), true, role)
    assert.equal(api.rescheduleKindFor(role, row), 'reschedule-propose', role)
    const near = clocked(savedCard({ status: 'confirmed', start: Date.now() + LEAD - 60000 }))
    assert.equal(api.canProposeReschedule(role, near), false, role + ' inside lead')
    assert.equal(api.rescheduleKindFor(role, near), '', role + ' inside lead')
  }
  const row = savedCard({ status: 'confirmed', start: Date.now() + 3 * DAY })
  assert.equal(api.canProposeReschedule('guest', clocked({ ...row })), false)
  assert.equal(api.canProposeReschedule('brand', clocked({ ...row, data_environment: 'production' })), false)
  assert.equal(api.canProposeReschedule('brand', clocked({ ...row, grant_id: '' })), false)
  assert.equal(api.canProposeReschedule('brand', clocked({ ...row, duration: 0 })), false)
  for (const [label, change] of SAVED_CARD_REFUSALS) {
    assert.equal(api.canProposeReschedule('brand', clocked({ ...row, ...change })), false, label)
  }
  // A held call (P5 state) can be cancelled but never rescheduled.
  assert.equal(api.canProposeReschedule('brand', clocked(held({ start: Date.now() + 3 * DAY }))), false)
  // Without a canonical clock the Paid gate fails closed.
  assert.equal(api.canProposeReschedule('brand', { ...row }), false)
})

test('P7: the last accept time is min(original, proposed start) - 48 h 15 min', () => {
  const now = 1_800_000_000_000
  const row = savedCard({ status: 'rescheduled', rescheduled_by: 'starter', start_old: now + 3 * DAY, start: now + 5 * DAY })
  assert.equal(api.paidRescheduleLastAcceptTime(row), now + 3 * DAY - LEAD)
  assert.equal(api.paidRescheduleLastAcceptTime({ ...row, start: now + LEAD + 2 * H }), now + 2 * H)
  assert.ok(Number.isNaN(api.paidRescheduleLastAcceptTime({ ...row, status: 'confirmed' })))
  assert.ok(Number.isNaN(api.paidRescheduleLastAcceptTime({ ...row, start_old: null })))
  assert.ok(Number.isNaN(api.paidRescheduleLastAcceptTime({ ...row, start_old: 0 })))
  assert.ok(Number.isNaN(api.paidRescheduleLastAcceptTime({ ...row, start: undefined })))
})

test('P7: paidRescheduleRespondAdmitted closes exactly at the last accept time', () => {
  const now = 1_800_000_000_000
  const row = savedCard({ status: 'rescheduled', rescheduled_by: 'starter', start_old: now + 3 * DAY, start: now + 4 * DAY })
  const last = api.paidRescheduleLastAcceptTime(row)
  assert.equal(api.paidRescheduleRespondAdmitted(row, last - 1), true)
  assert.equal(api.paidRescheduleRespondAdmitted(row, last), false)
  assert.equal(api.paidRescheduleRespondAdmitted(row, last + 1), false)
  assert.equal(api.paidRescheduleRespondAdmitted(row, null), false)
  assert.equal(api.paidRescheduleRespondAdmitted({ ...row, data_environment: 'production' }, last - 1), false)
  for (const [label, change] of SAVED_CARD_REFUSALS) {
    assert.equal(api.paidRescheduleRespondAdmitted({ ...row, ...change }, last - 1), false, label)
  }
  // An earlier proposed start moves the last accept time with it.
  const earlier = { ...row, start: now + LEAD + 1000 }
  assert.equal(api.paidRescheduleRespondAdmitted(earlier, now + 999), true)
  assert.equal(api.paidRescheduleRespondAdmitted(earlier, now + 1000), false)
})

test('P7: only the counterpart can accept a Paid proposal, and only before the last accept time', () => {
  const open = clocked(savedCard({
    status: 'rescheduled',
    rescheduled_by: 'starter',
    start_old: Date.now() + 3 * DAY,
    start: Date.now() + 4 * DAY,
  }))
  assert.equal(api.canRespondReschedule('brand', open), true)
  assert.equal(api.canConfirmReschedule('brand', open), true)
  assert.equal(api.canRespondReschedule('starter', open), false)
  assert.equal(api.canConfirmReschedule('starter', open), false)
  const byBrand = clocked({ ...open, rescheduled_by: 'brand' })
  assert.equal(api.canConfirmReschedule('starter', byBrand), true)
  assert.equal(api.canConfirmReschedule('brand', byBrand), false)
  // Keep Current Time stays retired for Paid too.
  assert.equal(api.canKeepCurrentTime('brand', open), false)

  const lapsing = clocked(savedCard({
    status: 'rescheduled',
    rescheduled_by: 'starter',
    start_old: Date.now() + LEAD - 60000,
    start: Date.now() + 4 * DAY,
  }))
  assert.equal(api.canConfirmReschedule('brand', lapsing), false, 'original start inside lead')
  const nearProposal = clocked(savedCard({
    status: 'rescheduled',
    rescheduled_by: 'starter',
    start_old: Date.now() + 4 * DAY,
    start: Date.now() + LEAD - 60000,
  }))
  assert.equal(api.canConfirmReschedule('brand', nearProposal), false, 'proposed start inside lead')
  assert.equal(api.canConfirmReschedule('brand', clocked({ ...open, data_environment: 'production' })), false)
  for (const [label, change] of SAVED_CARD_REFUSALS) {
    assert.equal(api.canConfirmReschedule('brand', clocked({ ...open, ...change })), false, label)
  }
  assert.equal(api.canRespondReschedule('brand', { ...open }), false, 'no canonical clock fails closed')
})

test('P7 regression: Free propose and respond keep their 8 h rule in every environment', () => {
  for (const environment of ['test', 'production']) {
    const confirmed = clocked(identity({ paid_meeting: false, status: 'confirmed', data_environment: environment, start: Date.now() + 9 * H }))
    assert.equal(api.canProposeReschedule('brand', confirmed), true, environment)
    assert.equal(api.canProposeReschedule('starter', confirmed), true, environment)
    const inside = clocked({ ...confirmed, start: Date.now() + 7 * H })
    assert.equal(api.canProposeReschedule('brand', inside), false, environment)
    const proposal = clocked(identity({
      paid_meeting: false,
      status: 'rescheduled',
      rescheduled_by: 'starter',
      data_environment: environment,
      start_old: Date.now() + 9 * H,
      start: Date.now() + 10 * H,
    }))
    assert.equal(api.canRespondReschedule('brand', proposal), true, environment)
    assert.equal(api.canConfirmReschedule('brand', proposal), true, environment)
    assert.equal(api.canRespondReschedule('starter', proposal), false, environment)
  }
  // Free never reads payment fields.
  const free = clocked(identity({ paid_meeting: false, status: 'confirmed', start: Date.now() + 9 * H, payment_status: 'intent_created' }))
  assert.equal(api.canProposeReschedule('brand', free), true)
  // An unflagged row still fails closed.
  assert.equal(api.canProposeReschedule('brand', clocked(identity({ status: 'confirmed', start: Date.now() + 9 * H }))), false)
})

test('P7: a Paid proposal inside 48 h 15 min is never sent; a Free slot inside it still is', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalStorage = global.sessionStorage
  const originalCrypto = global.crypto
  const requests = []
  try {
    const values = new Map()
    global.sessionStorage = {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    }
    global.crypto = {
      subtle: originalCrypto.subtle,
      randomUUID() { return '00000000-0000-4000-8000-000000000071' },
    }
    global.xanoAuthFetch = async function (url, options) {
      const body = JSON.parse(options.body)
      requests.push({ url, body })
      return {
        ok: true,
        async json() {
          return { reschedule: { booking_id: body.booking_id, status: 'rescheduled' } }
        },
      }
    }
    const paid = clocked(savedCard({ status: 'confirmed', start: Date.now() + 4 * DAY }))
    const tooSoon = { start: Date.now() + LEAD - 60000, end: Date.now() + LEAD - 60000 + 30 * 60000 }
    assert.equal(await api.proposeReschedule(paid, 'brand', 'Travel', tooSoon), null)
    assert.equal(requests.length, 0)
    const later = { start: Date.now() + 3 * DAY, end: Date.now() + 3 * DAY + 30 * 60000, timezone: 'UTC' }
    const result = await api.proposeReschedule(paid, 'brand', 'Travel', later)
    assert.equal(result.reschedule.status, 'rescheduled')
    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/booking\/reschedule\/propose\/v3$/)
    assert.equal(requests[0].body.new_start, later.start)

    const free = clocked(identity({ paid_meeting: false, status: 'confirmed', booking_id: 'booking-free-7', start: Date.now() + 4 * DAY }))
    const freeResult = await api.proposeReschedule(free, 'brand', 'Travel', { start: Date.now() + 10 * H, end: Date.now() + 10 * H + 30 * 60000 })
    assert.equal(freeResult.reschedule.status, 'rescheduled')
    assert.equal(requests.length, 2)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.sessionStorage = originalStorage
    global.crypto = originalCrypto
  }
})

test('P7: the calendar confirm explains a too-early Paid slot instead of sending it', async () => {
  const originalFetch = global.xanoAuthFetch
  const originalCalendar = global.StartersPaidCallBrandPayment
  let requests = 0
  let mounted = null
  try {
    global.xanoAuthFetch = async function () { requests += 1; return { ok: false, async json() { return null } } }
    global.StartersPaidCallBrandPayment = {
      async mountPaidCalendar(options) { mounted = options },
    }
    const container = el('div', { 'booking-reschedule-calendar': '' })
    const panel = el('div', { 'booking-popup-content': 'reschedule-calendar' }, [container])
    const modal = el('div', { 'popup-booking-info': '', 'data-booking-id': 'booking-paid-1' }, [panel])
    const head = el('head')
    fakeDocumentRef.current = {
      head,
      documentElement: head,
      createElement(tag) { return el(tag) },
      querySelector() { return null },
    }
    const booking = clocked(savedCard({ status: 'confirmed', start: Date.now() + 4 * DAY }))
    assert.equal(
      await api.mountRescheduleCalendar(fakeDocumentRef.current, modal, booking, 'starter', 'Travel'),
      true,
    )
    await assert.rejects(
      mounted.onConfirm({ start: Date.now() + DAY, end: Date.now() + DAY + 30 * 60000 }),
      new RegExp(api.PAID_PROPOSED_START_MESSAGE),
    )
    assert.equal(requests, 0)
    const alert = modal.querySelector('[data-starters-action-error]')
    assert.equal(alert.textContent, api.PAID_PROPOSED_START_MESSAGE)
  } finally {
    global.xanoAuthFetch = originalFetch
    global.StartersPaidCallBrandPayment = originalCalendar
  }
})

test('P7: the open Paid proposal note names the lapse time with the shared formatter', () => {
  const original = global.StartersDashboardCallActions
  try {
    global.StartersDashboardCallActions = api
    const startOld = Date.UTC(2026, 10, 20, 15, 0)
    const row = savedCard({ status: 'rescheduled', rescheduled_by: 'brand', start_old: startOld, start: startOld + DAY })
    const lapse = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short', timeZone: 'UTC',
    }).format(new Date(startOld - LEAD))
    assert.equal(
      calls.paidProposalLapseText(row, 'UTC'),
      'If there is no answer before ' + lapse + ', the call stays at the original time.',
    )
    assert.equal(calls.paidProposalLapseText({ ...row, status: 'confirmed' }, 'UTC'), '')
    assert.equal(calls.paidProposalLapseText({ ...row, data_environment: 'production' }, 'UTC'), '')
    assert.equal(calls.paidProposalLapseText({ ...row, paid_meeting: false }, 'UTC'), '')
    assert.equal(calls.paidProposalLapseText({ ...row, start_old: null }, 'UTC'), '')
    global.StartersDashboardCallActions = undefined
    assert.equal(calls.paidProposalLapseText(row, 'UTC'), '')
  } finally {
    global.StartersDashboardCallActions = original
  }
})
