const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./contact-reminder.js'), 'utf8')

/** Minimal element stub: enough DOM for the popup's build, show and close. */
function element(tagName) {
  const listeners = {}
  const node = {
    tagName: tagName.toUpperCase(),
    attributes: {},
    children: [],
    textContent: '',
    open: false,
    focused: false,
    setAttribute(name, value) {
      node.attributes[name] = String(value)
    },
    addEventListener(type, handler) {
      ;(listeners[type] = listeners[type] || []).push(handler)
    },
    dispatch(type, event = {}) {
      event.preventDefault = event.preventDefault || (() => {
        event.defaultPrevented = true
      })
      ;(listeners[type] || []).forEach((handler) => handler(event))
      return event
    },
    appendChild(child) {
      node.children.push(child)
      return child
    },
    focus() {
      node.focused = true
    },
    showModal() {
      node.open = true
      node.modalCalls = (node.modalCalls || 0) + 1
    },
    close() {
      node.open = false
    },
    querySelector(selector) {
      node.parts = node.parts || {}
      if (!node.parts[selector]) node.parts[selector] = element('div')
      return node.parts[selector]
    },
  }
  Object.defineProperty(node, 'innerHTML', {
    set(value) {
      node.html = value
    },
  })
  return node
}

function load(options = {}) {
  const head = element('head')
  const body = element('body')
  const timers = []
  const document = {
    head,
    body,
    getElementById: (id) => head.children.find((child) => child.id === id) || null,
    createElement(tag) {
      const node = element(tag)
      if (options.noDialog && tag === 'dialog') delete node.showModal
      return node
    },
  }
  const window = Object.assign(
    {
      document,
      setTimeout: (fn) => timers.push(fn),
    },
    options.window || {},
  )
  const context = vm.createContext({ window, document, Promise })
  vm.runInContext(source, context)
  return {
    window,
    body,
    flushTimers: () => timers.splice(0).forEach((fn) => fn()),
    dialog: () => body.children.find((child) => child.tagName === 'DIALOG'),
  }
}

function chatUi() {
  const field = { text: null, focused: 0, setText(value) { field.text = value }, focus() { field.focused += 1 } }
  return {
    handler: null,
    messageField: field,
    onSendMessage(handler) {
      this.handler = handler
      return { unsubscribe() {} }
    },
  }
}

function send(ui, text, conversationId = 'conv_a') {
  const event = {
    message: { text },
    conversation: { id: conversationId },
    overrides: [],
    override(value) {
      event.overrides.push(JSON.parse(JSON.stringify(value)))
    },
  }
  ui.handler(event)
  return event
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('detects contact details anywhere in a long message', () => {
  const { window } = load()
  const has = window.StartersContactReminder.hasContactInfo
  const paragraph =
    'Thanks for reaching out about the brand refresh. My process starts with a discovery ' +
    'workshop, then moodboards, then two rounds of concepts over four to six weeks. '
  assert.equal(has(paragraph + 'Email me at sarah.k@gmail.com'), true)
  assert.equal(has('Book here: https://calendly.com/sarah-k/30min ' + paragraph), true)
  assert.equal(has(paragraph + 'Call me on +971 50 123 4567 any time.'), true)
  assert.equal(has('050 123 4567'), true)
  assert.equal(has('reach me at sarah (at) gmail (dot) com'), true)
  assert.equal(has('Join zoom.us/j/8812345678 tomorrow'), true)
  assert.equal(has('Add me on WhatsApp'), true)
  assert.equal(has('Grab a time on calendly dot com/sarahk'), true)
})

test('ignores normal chat, dates, budgets and Starters links', () => {
  const { window } = load()
  const has = window.StartersContactReminder.hasContactInfo
  assert.equal(has('Can we start on 2026-11-03? Budget is 15000 AED'), false)
  assert.equal(has("Nice to meet you! I'm at work till 5 but free after"), false)
  assert.equal(has('Here is my profile: https://thestarters.com/talent/sarah-k'), false)
  assert.equal(has('Brief is at hirethestarters.com/jobs/2041'), false)
  assert.equal(has('Profile thestarters.com/talent/sarah-k and email sarah@studio.ae'), true)
})

test('cancels a flagged send at once and shows the matching copy in a modal dialog', async () => {
  const loaded = load()
  const ui = chatUi()
  loaded.window.attachContactReminder(ui, 'starter')
  const event = send(ui, 'email me at sarah.k@gmail.com')
  assert.deepEqual(event.overrides, [{ cancel: true }])
  const dialog = loaded.dialog()
  assert.equal(dialog.open, true)
  assert.equal(dialog.modalCalls, 1)
  assert.equal(dialog.querySelector('.tsr-title').textContent, 'Sharing contact details against policy')
  loaded.flushTimers()
  assert.equal(ui.messageField.text, 'email me at sarah.k@gmail.com')
})

test('Send anyway lets the same text through once in the same conversation only', async () => {
  const loaded = load()
  const ui = chatUi()
  loaded.window.attachContactReminder(ui, 'brand')
  send(ui, 'sarah.k@gmail.com', 'conv_a')
  loaded.dialog().querySelector('[data-tsr="send"]').dispatch('click')
  await flush()

  assert.deepEqual(send(ui, 'sarah.k@gmail.com', 'conv_b').overrides, [{ cancel: true }])
  loaded.dialog().querySelector('[data-tsr="send"]').dispatch('click')
  await flush()

  assert.deepEqual(send(ui, 'sarah.k@gmail.com', 'conv_b').overrides, [
    { custom: { contactFlag: 'true' } },
  ])
  assert.deepEqual(send(ui, 'sarah.k@gmail.com', 'conv_b').overrides, [{ cancel: true }])
})

test('Edit message and Escape both keep the message unsent', async () => {
  const loaded = load()
  const ui = chatUi()
  loaded.window.attachContactReminder(ui, 'brand')
  send(ui, 'call +971 50 123 4567')
  loaded.dialog().querySelector('[data-tsr="edit"]').dispatch('click')
  await flush()
  assert.equal(loaded.dialog().open, false)
  assert.deepEqual(send(ui, 'call +971 50 123 4567').overrides, [{ cancel: true }])

  const cancel = loaded.dialog().dispatch('cancel', {})
  await flush()
  assert.equal(cancel.defaultPrevented, true)
  assert.equal(loaded.dialog().open, false)
  assert.deepEqual(send(ui, 'call +971 50 123 4567').overrides, [{ cancel: true }])
})

test('clean messages are left alone and loading twice keeps the first install', () => {
  const loaded = load()
  const ui = chatUi()
  const first = loaded.window.attachContactReminder
  loaded.window.attachContactReminder(ui, 'brand')
  assert.deepEqual(send(ui, 'Sounds good, talk tomorrow').overrides, [])
  vm.runInContext(source, vm.createContext({ window: loaded.window, document: loaded.window.document, Promise }))
  assert.equal(loaded.window.attachContactReminder, first)
})

test('the source carries no regex lookbehind', () => {
  assert.equal(/\(\?<[=!]/.test(source), false)
})

test('marketing work talk is not mistaken for contact sharing', () => {
  const { window } = load()
  const has = window.StartersContactReminder.hasContactInfo
  for (const text of [
    'We run WhatsApp Business campaigns for retail brands',
    'Our Telegram channel strategy grew 40%',
    'My Telegram channel has 20k members',
    'I manage Skype for Business rollouts',
    'Export logo@2x.png and icon@3x.png please',
    'react@18.3.1 is fine',
    'Let us look at the dot com era branding',
    'Check the musical.com case study',
    'Budget is 5000-8000 AED',
    'Deadline 03/11/2026, meeting 10:30-11:30',
    'We grew followers from 12,000 to 48,500',
    'Reach support@thestarters.com',
  ]) {
    assert.equal(has(text), false, text)
  }
})

test('messaging apps and country-code phones with contact intent are caught', () => {
  const { window } = load()
  const has = window.StartersContactReminder.hasContactInfo
  for (const text of [
    'Add me on WhatsApp so it is quicker',
    "let's move this to WhatsApp",
    'whatsapp me',
    'my whatsapp is below',
    'reach me via Telegram',
    'wa.me/971501234567',
    't.me/sarahk',
    '+44 20 7946 0958',
    '+971501234567',
    '+1 (415) 555-0172',
  ]) {
    assert.equal(has(text), true, text)
  }
})

test('words ending in "at", large figures and "signal me" are not contact sharing', () => {
  const { window } = load()
  const has = window.StartersContactReminder.hasContactInfo
  for (const text of [
    'Check what Nike dot com is doing',
    'Can you send me the format at a later date dot com',
    'Budget is 15000000 IDR',
    'Budget is IDR 15000000',
    'Our reach was 120 000 000 impressions',
    'We hit 12 345 678 views and 1 234 567 followers',
    'Fee is 25000000 PHP or 1 500 000 USD',
    'Order 12345678 shipped',
    'Invoice no. 12345678 is attached',
    'See ref 123-456-7890 and #12345678',
    'Signal me when ready',
    'signal us when done',
  ]) {
    assert.equal(has(text), false, text)
  }
  for (const text of [
    'name at gmail dot com',
    'name (at) gmail (dot) com',
    'name(at)gmail(dot)com',
    '+971 50 123 4567',
    '050 123 4567',
    '(415) 555-0172',
    '+971501234567',
    '+44 20 7946 0958',
    'Order 12345678 shipped, call me on 050 123 4567',
    'Budget is 5000 AED, my number 050 123 4567',
    'my Signal is below',
    'reach me via Signal',
  ]) {
    assert.equal(has(text), true, text)
  }
})

test('without <dialog> support a flagged message is sent tagged, never silently cancelled', () => {
  const loaded = load({ noDialog: true })
  const ui = chatUi()
  loaded.window.attachContactReminder(ui, 'starter')
  assert.deepEqual(send(ui, 'email me at sarah.k@gmail.com').overrides, [
    { custom: { contactFlag: 'true' } },
  ])
  assert.equal(loaded.body.children.length, 0)
})

test('a stale inline copy of the reminder is replaced by this file', () => {
  const stale = () => 'stale'
  const loaded = load({ window: { attachContactReminder: stale } })
  assert.notEqual(loaded.window.attachContactReminder, stale)
  assert.equal(typeof loaded.window.StartersContactReminder.attach, 'function')
})

test('the chat field is not focused while the popup is open, only after a choice', async () => {
  const loaded = load()
  const ui = chatUi()
  loaded.window.attachContactReminder(ui, 'brand')
  send(ui, 'sarah.k@gmail.com')
  loaded.flushTimers()
  assert.equal(ui.messageField.text, 'sarah.k@gmail.com')
  assert.equal(ui.messageField.focused, 0)

  loaded.dialog().querySelector('[data-tsr="edit"]').dispatch('click')
  await flush()
  loaded.flushTimers()
  assert.equal(ui.messageField.focused, 1)
})
