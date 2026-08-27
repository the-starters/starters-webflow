'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'modal.js'), 'utf8')

/**
 * Minimal DOM stub. Only the surface `modal.js` touches: the DOMContentLoaded
 * boot, the `.modal_dialog` elements it adopts, the delegated document clicks
 * that open and close them, and the window events it announces. gsap and lenis
 * are deliberately absent from the context, which is the published page's
 * fallback path: no timeline, plain `showModal()` / `close()`, and body-overflow
 * scroll locking instead of lenis.
 */

function makeEnv({
  ids = ['modal-a', 'modal-b'],
  search = '',
  variants = {},
} = {}) {
  const windowEvents = []

  function addListener(store, type, handler) {
    if (!store[type]) store[type] = []
    store[type].push(handler)
  }

  function dispatchListeners(store, type, event = {}) {
    return Promise.all((store[type] || []).map((handler) => handler(event)))
  }

  /**
   * A `<dialog class="modal_dialog">`. `open` is the native flag the registry's
   * closeAll() reads, so showModal()/close() are the only things that move it.
   * `closeCalls` lets a test prove closeAll() left an already-closed dialog alone.
   */
  function dialogStub(id) {
    const attrs = {
      'data-modal-target': id,
      'data-wf--modal--variant': variants[id] ?? null,
    }
    const listeners = {}
    return {
      id,
      dataset: {},
      open: false,
      closeCalls: 0,
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null
      },
      showModal() { this.open = true },
      close() {
        this.closeCalls += 1
        this.open = false
      },
      // The scroll panes the script resets on open; none authored here.
      querySelectorAll() { return [] },
      addEventListener(type, handler) { addListener(listeners, type, handler) },
      // Fire an event the script bound on this dialog: a click that bubbled up
      // from a child, or the native `cancel` the Escape key raises.
      dispatch(type, event) { return dispatchListeners(listeners, type, event) },
    }
  }

  /**
   * Any clickable element in the page. `closest()` string-matches the selector
   * the script builds, so a stub only answers to the selectors it was created
   * for — everything else gets null, exactly like an unrelated element.
   */
  function elementStub(selectorParts, tagName = 'BUTTON') {
    return {
      tagName,
      focused: false,
      focus() { this.focused = true },
      closest(selector) {
        return selectorParts.some((part) => selector.includes(part)) ? this : null
      },
    }
  }

  const dialogs = ids.map((id) => dialogStub(id))

  const documentListeners = {}
  const document = {
    activeElement: null,
    body: { style: {} },
    addEventListener(type, handler) { addListener(documentListeners, type, handler) },
    dispatch(type, event) { return dispatchListeners(documentListeners, type, event) },
    querySelectorAll(selector) {
      return selector === '.modal_dialog' ? dialogs : []
    },
  }

  const windowListeners = {}
  const window = {
    document,
    addEventListener(type, handler) { addListener(windowListeners, type, handler) },
    dispatchEvent(event) {
      return dispatchListeners(windowListeners, event.type, event)
    },
  }

  /** Just enough of CustomEvent for `detail` to reach a window listener. */
  class CustomEventStub {
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
    }
  }

  const location = {
    search,
    href: `https://the-starters-3-0.webflow.io/some-page${search}`,
  }

  /** Records the deep-link cleanup so a test can read the rewritten URL back. */
  const history = {
    calls: [],
    replaceState(state, title, url) {
      this.calls.push({ state, title, url })
    },
  }

  const context = {
    window,
    document,
    location,
    history,
    URL,
    URLSearchParams,
    CustomEvent: CustomEventStub,
    Object,
    console: { info() {}, warn() {}, error() {} },
  }
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(SOURCE, context)

  // Recorded before boot so a deep-linked open, which happens during boot, is
  // captured too.
  window.addEventListener('modal-open', (event) => windowEvents.push(event))
  window.addEventListener('modal-close', (event) => windowEvents.push(event))

  const dialogsById = Object.fromEntries(dialogs.map((dialog) => [dialog.id, dialog]))

  return {
    context,
    document,
    window,
    history,
    dialogs,
    dialogsById,
    windowEvents,
    elementStub,
    /** A `[data-modal-trigger='<id>']` button somewhere in the page. */
    triggerFor(id) { return elementStub([`[data-modal-trigger='${id}']`]) },
    /** An `<a href="#<id>">` opening the same modal. */
    anchorFor(id) { return elementStub([`a[href='#${id}']`], 'A') },
    /** A `[data-modal-close]` control inside a dialog. */
    closeControl() { return elementStub(['[data-modal-close]']) },
    /** A `[data-close-all-modals]` control anywhere in the page. */
    closeAllControl(tagName = 'BUTTON') {
      return elementStub(['[data-close-all-modals]'], tagName)
    },
    /** A click on something the modal system does not care about. */
    inertElement() { return elementStub([]) },
    /** Boot the script the way the browser does. */
    boot() { return document.dispatch('DOMContentLoaded') },
    /** A page-level click, as delegated to the document. */
    clickDocument(target) {
      const event = { target, defaultPrevented: false, preventDefault() { event.defaultPrevented = true } }
      return document.dispatch('click', event).then(() => event)
    },
    /** A click inside a dialog, bubbled to the dialog's own listener. */
    clickInDialog(dialog, target) {
      const event = { target, defaultPrevented: false, preventDefault() { event.defaultPrevented = true } }
      return dialog.dispatch('click', event).then(() => event)
    },
    /** The native `cancel` the Escape key raises on an open dialog. */
    cancel(dialog) {
      const event = { defaultPrevented: false, preventDefault() { event.defaultPrevented = true } }
      return dialog.dispatch('cancel', event).then(() => event)
    },
    get modalSystem() { return window.lumos.modal },
    types() { return windowEvents.map((event) => event.type) },
  }
}

test('a trigger opens only the modal it names', async () => {
  const env = makeEnv()
  await env.boot()

  await env.clickDocument(env.triggerFor('modal-b'))

  assert.equal(env.dialogsById['modal-b'].open, true)
  assert.equal(env.dialogsById['modal-a'].open, false, 'the other dialog stays shut')
  assert.equal(env.document.body.style.overflow, 'hidden', 'page scroll is locked while open')
})

test('an anchor trigger opens the modal instead of jumping to the hash', async () => {
  const env = makeEnv()
  await env.boot()

  const anchor = env.anchorFor('modal-a')
  const event = await env.clickDocument(anchor)

  assert.equal(env.dialogsById['modal-a'].open, true)
  assert.equal(event.defaultPrevented, true, 'an href="#modal-a" control must not jump')
})

test('ignores a click that is not on any trigger', async () => {
  const env = makeEnv()
  await env.boot()

  await env.clickDocument(env.inertElement())

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
  assert.equal(env.document.body.style.overflow, undefined)
})

test('a close control inside the dialog closes it and restores page scroll', async () => {
  const env = makeEnv()
  await env.boot()

  const dialog = env.dialogsById['modal-a']
  await env.clickDocument(env.triggerFor('modal-a'))
  assert.equal(dialog.open, true)

  await env.clickInDialog(dialog, env.closeControl())

  assert.equal(dialog.open, false)
  assert.equal(env.document.body.style.overflow, '', 'the page scrolls again')
})

test('a click elsewhere inside the dialog leaves it open', async () => {
  const env = makeEnv()
  await env.boot()

  const dialog = env.dialogsById['modal-a']
  await env.clickDocument(env.triggerFor('modal-a'))
  await env.clickInDialog(dialog, env.inertElement())

  assert.equal(dialog.open, true)
})

test('Escape closes the modal through the script, not the native cancel', async () => {
  const env = makeEnv()
  await env.boot()

  const dialog = env.dialogsById['modal-b']
  await env.clickDocument(env.triggerFor('modal-b'))

  const event = await env.cancel(dialog)

  assert.equal(dialog.open, false)
  assert.equal(event.defaultPrevented, true, 'the native dismissal is suppressed so the script can run its own close')
  assert.equal(env.document.body.style.overflow, '')
})

test('returns focus to whatever opened the modal', async () => {
  const env = makeEnv()
  await env.boot()

  const dialog = env.dialogsById['modal-a']
  const trigger = env.triggerFor('modal-a')
  env.document.activeElement = trigger

  await env.clickDocument(trigger)
  assert.equal(trigger.focused, false, 'focus moves into the dialog while it is open')

  await env.clickInDialog(dialog, env.closeControl())

  assert.equal(trigger.focused, true, 'the keyboard lands back where it started')
})

test('announces modal-open and modal-close with the dialog that moved', async () => {
  const env = makeEnv()
  await env.boot()

  const dialog = env.dialogsById['modal-b']
  await env.clickDocument(env.triggerFor('modal-b'))
  await env.clickInDialog(dialog, env.closeControl())

  assert.deepEqual(env.types(), ['modal-open', 'modal-close'])
  assert.equal(env.windowEvents[0].detail.modal, dialog)
  assert.equal(env.windowEvents[1].detail.modal, dialog)
})

test('opens the deep-linked modal on load and strips the parameter from the URL', async () => {
  const env = makeEnv({ search: '?modal-id=modal-b' })
  await env.boot()

  assert.equal(env.dialogsById['modal-b'].open, true, 'a shared link lands with the modal already open')
  assert.equal(env.dialogsById['modal-a'].open, false)
  assert.deepEqual(env.types(), ['modal-open'])

  assert.equal(env.history.calls.length, 1)
  const rewritten = env.history.calls[0].url
  assert.equal(rewritten.searchParams.get('modal-id'), null, 'a refresh must not reopen it')
  assert.equal(rewritten.pathname, '/some-page')
})

test('leaves every modal closed when the URL names none of them', async () => {
  const env = makeEnv({ search: '?modal-id=modal-missing' })
  await env.boot()

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
  assert.deepEqual(env.history.calls, [])
})

test('closeAll() shuts every open modal and leaves the closed ones alone', async () => {
  const env = makeEnv({ ids: ['modal-a', 'modal-b', 'modal-c'] })
  await env.boot()

  env.modalSystem.list['modal-a'].open()
  env.modalSystem.list['modal-b'].open()

  env.modalSystem.closeAll()

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false, false])
  assert.deepEqual(env.dialogs.map((dialog) => dialog.closeCalls), [1, 1, 0])
  assert.deepEqual(env.types(), ['modal-open', 'modal-open', 'modal-close', 'modal-close'])
})

test('a close-all control closes every open modal from anywhere in the page', async () => {
  const env = makeEnv()
  await env.boot()

  await env.clickDocument(env.triggerFor('modal-a'))
  await env.clickDocument(env.triggerFor('modal-b'))
  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [true, true])

  const event = await env.clickDocument(env.closeAllControl('A'))

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
  assert.equal(event.defaultPrevented, true, 'an anchor close-all control must not jump')
  assert.equal(env.document.body.style.overflow, '')
})

test('exposes each modal on window.lumos.modal for other scripts to drive', async () => {
  const env = makeEnv()
  await env.boot()

  const entry = env.modalSystem.list['modal-a']
  assert.equal(entry.el, env.dialogsById['modal-a'])
  assert.deepEqual(Object.keys(env.modalSystem.list), ['modal-a', 'modal-b'])

  entry.open()
  assert.equal(env.dialogsById['modal-a'].open, true)

  entry.close()
  assert.equal(env.dialogsById['modal-a'].open, false)

  env.modalSystem.open('modal-b')
  assert.equal(env.dialogsById['modal-b'].open, true)
})

test('open() on an unknown id is a no-op', async () => {
  const env = makeEnv()
  await env.boot()

  env.modalSystem.open('modal-missing')

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
})

test('re-running init does not double-bind an already adopted modal', async () => {
  const env = makeEnv()
  await env.boot()

  env.modalSystem.init()

  const dialog = env.dialogsById['modal-a']
  await env.clickDocument(env.triggerFor('modal-a'))
  assert.equal(dialog.open, true)
  assert.deepEqual(env.types(), ['modal-open'], 'one click still means one open')

  await env.clickInDialog(dialog, env.closeControl())
  assert.equal(dialog.open, false)
  assert.deepEqual(env.types(), ['modal-open', 'modal-close'], 'and one close fully closes it')
})
