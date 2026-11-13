'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const { h } = require('../../step-flow-test-dom')

const SOURCE = fs.readFileSync(path.join(__dirname, 'modal-cta-takeover.js'), 'utf8')
const MODAL_SOURCE = fs.readFileSync(path.join(__dirname, 'modal.js'), 'utf8')

/**
 * The page is the shared DOM stub (`step-flow-test-dom.js`) plus a small event
 * dispatcher that walks the real DOM order: window capture, document capture,
 * element capture down to the target, then bubble back up through document and
 * window. stopPropagation / stopImmediatePropagation and preventDefault behave as
 * in a browser, so "the other handlers never ran" and "the link did not
 * navigate" are observable consequences rather than implementation details.
 *
 * With `lumos: true` the real modal.js runs in the same page and boots on
 * DOMContentLoaded, so the takeover is checked against the actual lumos.modal
 * registry and its own document-level trigger listeners.
 */
function makeEnv({
  dialogs = ['book-a-call'],
  lumos = true,
  bodyAttrs = {},
  hostname = 'www.hirethestarters.com',
  debug = false,
  doubleLoad = false,
} = {}) {
  const body = h('body', bodyAttrs)
  const registry = new Map()
  const add = (node, type, fn, options) => {
    const list = registry.get(node) || []
    list.push({ type, fn, capture: options === true || !!(options && options.capture) })
    registry.set(node, list)
  }

  const document = {
    body,
    activeElement: null,
    addEventListener: (type, fn, options) => add(document, type, fn, options),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
    getElementById: (id) => body.descendants().find((el) => el.getAttribute('id') === id) || null,
  }

  const origin = `https://${hostname}`
  const location = {
    hostname,
    origin,
    pathname: '/paid-landing',
    search: '',
    href: `${origin}/paid-landing`,
  }

  const takeovers = []
  const opened = []
  const window = {
    document,
    location,
    addEventListener: (type, fn, options) => add(window, type, fn, options),
    dispatchEvent(event) {
      ;(registry.get(window) || [])
        .filter((entry) => entry.type === event.type)
        .forEach((entry) => entry.fn(event))
      return true
    },
  }
  if (debug) window.STARTERS_DEBUG = true

  class CustomEventStub {
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
    }
  }

  function dialogStub(id) {
    const dialog = h('dialog', { class: 'modal_dialog', 'data-modal-target': id })
    dialog.open = false
    dialog.showModalCalls = 0
    dialog.showModal = () => {
      dialog.showModalCalls += 1
      dialog.open = true
    }
    dialog.close = () => { dialog.open = false }
    dialog.focus = () => {}
    body.append(dialog)
    return dialog
  }
  const dialogEls = {}
  dialogs.forEach((id) => { dialogEls[id] = dialogStub(id) })

  const logs = []
  const record = (...args) => logs.push(args)
  const context = {
    window,
    document,
    location,
    history: { replaceState() {} },
    URL,
    URLSearchParams,
    CustomEvent: CustomEventStub,
    console: { info: record, warn: record, error: record, log: record },
  }
  context.globalThis = context
  vm.createContext(context)

  vm.runInContext(SOURCE, context)
  if (doubleLoad) vm.runInContext(SOURCE, context)
  window.addEventListener('modal-cta-takeover', (event) => takeovers.push(event.detail))
  window.addEventListener('modal-open', (event) => opened.push(event.detail.modal.getAttribute('data-modal-target')))

  if (lumos) {
    vm.runInContext(MODAL_SOURCE, context)
    ;(registry.get(document) || [])
      .filter((entry) => entry.type === 'DOMContentLoaded')
      .forEach((entry) => entry.fn({ type: 'DOMContentLoaded' }))
  }

  function listenersFor(node, type, phase) {
    const own = (registry.get(node) || []).filter((entry) => entry.type === type)
    const capture = own.filter((entry) => entry.capture).map((entry) => entry.fn)
    // Element.addEventListener in the stub has no options: those are bubble listeners.
    const stubbed = node._listeners ? node._listeners.get(type) || [] : []
    const bubble = own.filter((entry) => !entry.capture).map((entry) => entry.fn).concat(stubbed)
    if (phase === 'capture') return capture
    if (phase === 'bubble') return bubble
    return capture.concat(bubble)
  }

  /** Dispatches a click-like event through the full capture/target/bubble path. */
  function dispatch(target, type = 'click', init = {}) {
    const event = {
      type,
      target,
      button: 0,
      detail: 1,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...init,
      defaultPrevented: false,
      stopped: false,
      immediate: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.stopped = true },
      stopImmediatePropagation() { this.stopped = true; this.immediate = true },
    }
    const chain = []
    for (let node = target.nodeType === 3 ? target.parentElement : target; node; node = node.parentElement) {
      chain.unshift(node)
    }
    const above = [window, document, ...chain.slice(0, -1)]
    const at = chain[chain.length - 1]
    const run = (node, phase) => {
      for (const fn of listenersFor(node, type, phase)) {
        fn(event)
        if (event.immediate) return
      }
    }
    for (const node of above) {
      run(node, 'capture')
      if (event.stopped) return event
    }
    run(at, 'target')
    if (event.stopped) return event
    for (const node of above.slice().reverse()) {
      run(node, 'bubble')
      if (event.stopped) return event
    }
    return event
  }

  /**
   * Handlers the CTA already has on the live page: a document capture listener
   * (delegated scripts), a listener on the element itself (Memberstack data-ms-*,
   * Webflow IX), and document/window bubble listeners (lumos, join-membership).
   */
  function competitors(el, type = 'click') {
    const calls = []
    document.addEventListener(type, () => calls.push('document-capture'), true)
    el.addEventListener(type, () => calls.push('element'))
    document.addEventListener(type, () => calls.push('document-bubble'))
    window.addEventListener(type, () => calls.push('window-bubble'))
    window.addEventListener(type, () => calls.push('window-capture-later'), true)
    return calls
  }

  /** A link the browser would follow: not prevented, and there is an a[href] around the target. */
  const navigated = (event) => !event.defaultPrevented && !!event.target.closest('a[href]')

  return { window, document, body, dialog: dialogEls, dispatch, competitors, navigated, takeovers, opened, logs }
}

const link = (href, attrs = {}) => h('a', { href, ...attrs })

test('a /quiz CTA opens the book-a-call modal and nothing else runs', () => {
  const env = makeEnv()
  const cta = env.body.append(link('/quiz'))
  const label = cta.append(h('div', { class: 'button_label' }))
  const calls = env.competitors(cta)

  const event = env.dispatch(label)

  assert.equal(env.dialog['book-a-call'].open, true)
  assert.deepEqual(env.opened, ['book-a-call'], 'lumos opened it, with its modal-open event')
  assert.equal(env.navigated(event), false, 'the link did not navigate')
  assert.deepEqual(calls, [], 'no capture, element or bubble handler saw the click')
  assert.equal(env.takeovers.length, 1)
  assert.equal(env.takeovers[0].modalId, 'book-a-call')
  assert.equal(env.takeovers[0].trigger, cta)
})

test('every default CTA rule is taken over', () => {
  const cases = [
    () => link('/quiz'),
    () => link('/quiz/'),
    () => link('/quiz?category=paid-media#top'),
    () => link('https://www.hirethestarters.com/quiz'),
    () => link('/sign-up'),
    () => link('/signup'),
    () => link('/get-started'),
    () => link('/checkout'),
    () => link('#join-starters-cta'),
    () => link('/why-us#join-starters-cta'),
    () => link('https://calendly.com/the-starters/intro'),
    () => link('https://www.calendly.com/the-starters/intro', { target: '_blank' }),
    () => h('div', { 'data-modal-trigger': 'join-membership-signup' }),
    () => h('button', { 'data-modal-trigger': 'signup-modal' }),
    () => h('a', { href: '#', 'data-modal-trigger': 'start-project' }),
  ]
  for (const make of cases) {
    const env = makeEnv({ dialogs: ['book-a-call', 'join-membership-signup', 'signup-modal', 'start-project'] })
    const el = env.body.append(make())
    const calls = env.competitors(el)
    const label = `${el.tagName} ${el.getAttribute('href') || el.getAttribute('data-modal-trigger')}`

    const event = env.dispatch(el)

    assert.equal(event.defaultPrevented, true, `${label}: default prevented`)
    assert.deepEqual(calls, [], `${label}: other handlers stopped`)
    assert.deepEqual(env.opened, ['book-a-call'], `${label}: only book-a-call opened`)
    assert.equal(env.takeovers.length, 1, `${label}: one takeover event`)
  }
})

test('non-CTA links and controls keep their normal behaviour', () => {
  const cases = [
    () => link('/login'),
    () => link('/why-us'),
    () => link('/learn'),
    () => link('/learn/'),
    () => link('/learning/how-to-hire'),
    () => link('/become-a-starter'),
    () => link('/case-studies'),
    () => link('/all-starters-archive'),
    () => link('/hire'),
    () => link('/subcategories'),
    () => link('https://evil.example/hire/jane-doe'),
    () => link('/quizzes'),
    () => link('/privacy-policy'),
    () => link('https://twitter.com/thestarters'),
    () => link('https://notcalendly.com/x'),
    () => link('https://evil.example/quiz'),
    () => link('#'),
    () => h('button', { 'data-join-membership-plan': 'monthly' }),
    () => h('button', { 'data-join-membership-plan': 'yearly' }),
    () => h('div', { 'data-modal-trigger': 'account-settings' }),
  ]
  for (const make of cases) {
    const env = makeEnv()
    const el = env.body.append(make())
    const calls = env.competitors(el)
    const label = `${el.tagName} ${el.getAttribute('href') || el.outerHTML || ''}`

    const event = env.dispatch(el)

    assert.equal(event.defaultPrevented, false, `${label}: default not prevented`)
    assert.equal(calls.length, 5, `${label}: every other handler ran`)
    assert.equal(env.dialog['book-a-call'].open, false, `${label}: modal stays closed`)
    assert.equal(env.takeovers.length, 0)
  }
})

test('the search-brilliance trigger still opens its own modal', () => {
  const env = makeEnv({ dialogs: ['book-a-call', 'search-brilliance'] })
  const trigger = env.body.append(h('div', { 'data-modal-trigger': 'search-brilliance' }))

  env.dispatch(trigger)

  assert.deepEqual(env.opened, ['search-brilliance'])
  assert.equal(env.dialog['book-a-call'].open, false)
})

test('data-modal-cta="skip" and "cta" override the defaults, nearest ancestor wins', () => {
  {
    const env = makeEnv()
    const section = env.body.append(h('section', { 'data-modal-cta': 'skip' }))
    const cta = section.append(link('/quiz'))
    const event = env.dispatch(cta)
    assert.equal(env.navigated(event), true, 'a /quiz link inside a skip region still navigates')
    assert.equal(env.dialog['book-a-call'].open, false)
  }
  {
    const env = makeEnv()
    const cta = env.body.append(link('/quiz', { 'data-modal-cta': 'skip' }))
    assert.equal(env.navigated(env.dispatch(cta)), true, 'skip on the link itself')
  }
  {
    const env = makeEnv()
    const card = env.body.append(h('div', { 'data-modal-cta': 'cta' }))
    const inner = card.append(h('span'))
    const event = env.dispatch(inner)
    assert.equal(event.defaultPrevented, true)
    assert.equal(env.dialog['book-a-call'].open, true, 'a cta marker on any element opens the modal')
    assert.equal(env.takeovers[0].trigger, card)
  }
  {
    const env = makeEnv()
    const region = env.body.append(h('section', { 'data-modal-cta': 'skip' }))
    const login = region.append(link('/login', { 'data-modal-cta': 'cta' }))
    assert.equal(env.dispatch(login).defaultPrevented, true, 'a cta inside a skip region is taken over')
    assert.equal(env.dialog['book-a-call'].open, true)
  }
  {
    const env = makeEnv()
    const region = env.body.append(h('div', { 'data-modal-cta': 'cta' }))
    const cta = region.append(link('/quiz', { 'data-modal-cta': 'skip' }))
    assert.equal(env.navigated(env.dispatch(cta)), true, 'a skip inside a cta region is left alone')
    assert.equal(env.dialog['book-a-call'].open, false)
  }
})

test('clicks inside the book-a-call dialog are never taken over', () => {
  const env = makeEnv()
  const dialog = env.dialog['book-a-call']
  env.window.lumos.modal.open('book-a-call')
  const calendly = dialog.append(link('https://calendly.com/the-starters/intro'))
  const marked = dialog.append(h('div', { 'data-modal-cta': 'cta' }))
  const close = dialog.append(h('button', { 'data-modal-close': '' }))

  assert.equal(env.navigated(env.dispatch(calendly)), true, 'the calendly link inside the modal navigates')
  assert.equal(env.dispatch(marked).defaultPrevented, false)
  env.dispatch(close)
  assert.equal(dialog.open, false, 'lumos still closes it from its own close control')
  assert.equal(env.takeovers.length, 0)
})

test('without the target dialog on the page the script does nothing', () => {
  const env = makeEnv({ dialogs: ['join-membership-signup'] })
  const quiz = env.body.append(link('/quiz'))
  const calls = env.competitors(quiz)
  const join = env.body.append(h('div', { 'data-modal-trigger': 'join-membership-signup' }))

  assert.equal(env.navigated(env.dispatch(quiz)), true)
  assert.equal(calls.length, 5)
  env.dispatch(join)
  assert.deepEqual(env.opened, ['join-membership-signup'], 'the join CTA opens its own modal as before')
  assert.equal(env.takeovers.length, 0)
})

test('the dialog is looked up at click time, so one added later still counts', () => {
  const env = makeEnv({ dialogs: [], lumos: false })
  const quiz = env.body.append(link('/quiz'))
  assert.equal(env.navigated(env.dispatch(quiz)), true)

  const dialog = env.body.append(h('dialog', { class: 'modal_dialog', 'data-modal-target': 'book-a-call' }))
  dialog.showModal = () => { dialog.open = true }
  assert.equal(env.dispatch(quiz).defaultPrevented, true)
  assert.equal(dialog.open, true)
})

test('data-modal-cta-takeover on <body> picks a different modal', () => {
  const env = makeEnv({ dialogs: ['book-a-call', 'talk-to-sales'], bodyAttrs: { 'data-modal-cta-takeover': 'talk-to-sales' } })
  const cta = env.body.append(link('/quiz'))

  env.dispatch(cta)

  assert.deepEqual(env.opened, ['talk-to-sales'])
  assert.equal(env.dialog['book-a-call'].open, false)
  assert.equal(env.takeovers[0].modalId, 'talk-to-sales')
})

test('an overridden id with no matching dialog leaves the page alone', () => {
  const env = makeEnv({ bodyAttrs: { 'data-modal-cta-takeover': 'missing' } })
  const cta = env.body.append(link('/quiz'))
  assert.equal(env.navigated(env.dispatch(cta)), true)
  assert.equal(env.dialog['book-a-call'].open, false)
})

test('loading the script twice still takes over each click once', () => {
  const env = makeEnv({ doubleLoad: true, lumos: false })
  const cta = env.body.append(link('/quiz'))

  env.dispatch(cta)

  assert.equal(env.takeovers.length, 1)
  assert.equal(env.dialog['book-a-call'].showModalCalls, 1)
})

test('without lumos the dialog is opened natively', () => {
  const env = makeEnv({ lumos: false })
  const cta = env.body.append(link('/get-started'))

  const event = env.dispatch(cta)

  assert.equal(event.defaultPrevented, true)
  assert.equal(env.dialog['book-a-call'].showModalCalls, 1)
  assert.equal(env.dialog['book-a-call'].open, true)
  assert.equal(env.takeovers.length, 1)

  env.dispatch(cta)
  assert.equal(env.dialog['book-a-call'].showModalCalls, 1, 'an already-open dialog is not re-shown')
})

test('lumos that has not registered the dialog falls back to showModal', () => {
  const env = makeEnv({ lumos: false })
  env.window.lumos = { modal: { list: {}, open() { throw new Error('should not be called') } } }
  const cta = env.body.append(link('/quiz'))

  env.dispatch(cta)

  assert.equal(env.dialog['book-a-call'].showModalCalls, 1)
})

test('a lumos open that throws still ends with the dialog open', () => {
  const env = makeEnv({ lumos: false })
  env.window.lumos = { modal: { list: { 'book-a-call': {} }, open() { throw new Error('boom') } } }
  const cta = env.body.append(link('/quiz'))

  env.dispatch(cta)

  assert.equal(env.dialog['book-a-call'].open, true)
})

test('modifier clicks and middle clicks on a CTA link are taken over too', () => {
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
    const env = makeEnv()
    const cta = env.body.append(link('/quiz'))
    const event = env.dispatch(cta, 'click', init)
    assert.equal(event.defaultPrevented, true, JSON.stringify(init))
    assert.equal(env.dialog['book-a-call'].open, true)
  }
  {
    const env = makeEnv()
    const cta = env.body.append(link('/quiz'))
    const calls = env.competitors(cta, 'auxclick')
    const event = env.dispatch(cta, 'auxclick', { button: 1 })
    assert.equal(event.defaultPrevented, true, 'the middle click does not open a new tab')
    assert.deepEqual(calls, [])
    assert.equal(env.dialog['book-a-call'].open, true)
  }
  {
    const env = makeEnv()
    const cta = env.body.append(link('/quiz'))
    const event = env.dispatch(cta, 'auxclick', { button: 2 })
    assert.equal(event.defaultPrevented, false, 'a right click keeps the context menu')
    assert.equal(env.dialog['book-a-call'].open, false)
  }
  {
    const env = makeEnv({ dialogs: ['book-a-call', 'join-membership-signup'] })
    const trigger = env.body.append(h('div', { 'data-modal-trigger': 'join-membership-signup' }))
    assert.equal(env.dispatch(trigger, 'auxclick', { button: 1 }).defaultPrevented, false, 'auxclick on a non-link is ignored')
  }
})

test('keyboard activation (Enter on a link: a click with detail 0) is taken over', () => {
  const env = makeEnv()
  const cta = env.body.append(link('/quiz'))

  const event = env.dispatch(cta, 'click', { detail: 0 })

  assert.equal(event.defaultPrevented, true)
  assert.equal(env.dialog['book-a-call'].open, true)
})

test('a click whose target is a text node resolves to its element', () => {
  const env = makeEnv()
  const cta = env.body.append(link('/quiz'))
  const text = { nodeType: 3, parentElement: cta }

  const event = env.dispatch(text)

  assert.equal(event.defaultPrevented, true)
  assert.equal(env.dialog['book-a-call'].open, true)
})

test('console diagnostics only on staging hosts or with STARTERS_DEBUG', () => {
  const prod = makeEnv({ hostname: 'www.hirethestarters.com' })
  prod.dispatch(prod.body.append(link('/quiz')))
  assert.equal(prod.logs.length, 0)

  const staging = makeEnv({ hostname: 'the-starters-3-0.webflow.io' })
  staging.dispatch(staging.body.append(link('/quiz')))
  assert.ok(staging.logs.length > 0)

  const lookalike = makeEnv({ hostname: 'notwebflow.io' })
  lookalike.dispatch(lookalike.body.append(link('/quiz')))
  assert.equal(lookalike.logs.length, 0)

  const forced = makeEnv({ debug: true })
  forced.dispatch(forced.body.append(link('/quiz')))
  assert.ok(forced.logs.length > 0)
})

test('the @release header is the release the page reads back', () => {
  const declared = /^\/\/ @release (v\d+\.\d+\.\d+)$/m.exec(SOURCE)
  assert.ok(declared, 'the header carries an @release line')
  const env = makeEnv({ lumos: false })
  assert.equal(env.window.startersModalCtaTakeover.release, declared[1])
})

test('the hero quiz "Get Started" button (no href) is taken over, its topic chips are not', () => {
  const env = makeEnv()
  const form = env.body.append(h('form', { 'data-quiz-form': 'home', 'data-name': 'home-quiz' }))
  const chip = form.append(h('label', { class: 'w-checkbox form_selection-field' }))
  const checkbox = chip.append(h('input', { type: 'checkbox', id: 'creative' }))
  const getStarted = form.append(h('button', { type: 'button', class: 'clickable_btn' }))
  const label = getStarted.append(h('div', { class: 'button_label' }))
  const quizHome = env.competitors(getStarted)

  const event = env.dispatch(label)

  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(quizHome, [], 'quiz-home.js never saw the click, so no /quiz redirect')
  assert.deepEqual(env.opened, ['book-a-call'])
  assert.equal(env.takeovers[0].trigger, getStarted)

  const chipCalls = env.competitors(checkbox)
  const chipEvent = env.dispatch(checkbox)
  assert.equal(chipEvent.defaultPrevented, false, 'a topic chip still toggles')
  assert.ok(chipCalls.includes('element'), 'the chip keeps its own handlers')
  assert.equal(env.takeovers.length, 1)

  const elsewhere = env.body.append(h('button', { type: 'button' }))
  const otherCalls = env.competitors(elsewhere)
  env.dispatch(elsewhere)
  assert.ok(otherCalls.includes('element'), 'a plain button outside a quiz form is left alone')
  assert.equal(env.takeovers.length, 1)
})

test('content CTAs in the page body are taken over by path prefix', () => {
  const cases = [
    '/hire/jane-doe',
    '/hire/jane-doe?tab=consult',
    '/all-starters',
    '/all-starters/',
    '/all-starters?mode=consult',
    '/all-starters/marketing',
    '/learn/sessions/partnerships-playbook',
    '/learn/playbooks-frameworks/the-landing-page-toolkit',
    '/subcategories/paid-media',
    'https://www.hirethestarters.com/hire/rose',
  ]
  for (const href of cases) {
    const env = makeEnv()
    const section = env.body.append(h('section', { 'data-section': 'talent' }))
    const card = section.append(link(href))
    const calls = env.competitors(card)

    const event = env.dispatch(card.append(h('div', { class: 'card_title' })))

    assert.equal(event.defaultPrevented, true, `${href}: default prevented`)
    assert.deepEqual(calls, [], `${href}: other handlers stopped`)
    assert.deepEqual(env.opened, ['book-a-call'], `${href}: book-a-call opened`)
    assert.equal(env.takeovers[0].trigger, card)
  }
})

test('prefix rules never apply inside the navbar or footer, exact CTAs still do', () => {
  for (const make of [() => h('div', { role: 'banner', 'data-wf--navbar-main--variant': 'base' }), () => h('footer')]) {
    const env = makeEnv()
    const region = env.body.append(make())
    for (const href of ['/hire/jane-doe', '/all-starters', '/learn/sessions/x', '/subcategories/paid-media']) {
      const el = region.append(link(href))
      const calls = env.competitors(el)
      const event = env.dispatch(el)
      assert.equal(event.defaultPrevented, false, `${region.tagName} ${href}: navigates`)
      assert.equal(calls.length, 5, `${region.tagName} ${href}: handlers ran`)
    }
    assert.equal(env.takeovers.length, 0)

    const getStarted = region.append(link('/quiz'))
    env.dispatch(getStarted)
    assert.equal(env.takeovers.length, 1, `${region.tagName}: /quiz is still taken over`)
  }
})

test('data-modal-cta="cta" still forces a nav or footer link', () => {
  const env = makeEnv()
  const nav = env.body.append(h('div', { role: 'banner' }))
  const forced = nav.append(link('/all-starters', { 'data-modal-cta': 'cta' }))
  env.dispatch(forced)
  assert.equal(env.takeovers.length, 1)
})
