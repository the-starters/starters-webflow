'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const { h, makeEvent } = require('../../step-flow-test-dom')

const SOURCE = fs.readFileSync(path.join(__dirname, 'modal.js'), 'utf8')

/**
 * The page is built from the shared DOM stub (`step-flow-test-dom.js`): real
 * parent chains, a real selector engine, and a real `closest()`, so a trigger
 * can be a `<span>` inside an `<a>` exactly as it is in Webflow.
 *
 * gsap is what the published pages load, so the suite runs the animated path
 * (`gsap: true`) as well as the no-gsap fallback that plain pages fall back to:
 * no timeline, straight `showModal()` / `close()`, and body-overflow scroll
 * locking instead of lenis.
 */

/**
 * Stands in for the gsap the page loads. `context()` runs the builder, and each
 * timeline records what it was built from and whether it was played or
 * reversed, so the entrance animation and the reverse-driven close are both
 * observable. `reverse()` runs `onReverseComplete` synchronously — gsap defers
 * it to the end of the animation, but the ordering the script depends on is the
 * same and a synchronous call keeps the assertions deterministic.
 */
function gsapStub() {
  const contexts = []
  const timelines = []

  /** The properties a step animates, with the timing noise dropped. */
  const animated = (vars = {}) =>
    Object.keys(vars).filter((name) => name !== 'duration' && name !== 'ease')

  function timeline(config = {}) {
    let progress = 0
    const tl = {
      config,
      calls: [],
      played: false,
      reversed: false,
      fromTo(target, from, to) { tl.calls.push(['fromTo', target, animated(to)]); return tl },
      from(target, vars) { tl.calls.push(['from', target, animated(vars)]); return tl },
      set(target, vars) { tl.calls.push(['set', target, animated(vars)]); return tl },
      play() { tl.played = true; progress = 1; return tl },
      reverse() {
        tl.reversed = true
        progress = 0
        if (typeof config.onReverseComplete === 'function') config.onReverseComplete()
        return tl
      },
      progress() { return progress },
    }
    timelines.push(tl)
    return tl
  }

  return {
    contexts,
    timelines,
    context(builder, scope) {
      contexts.push(scope)
      builder()
    },
    timeline,
  }
}

function makeEnv({
  ids = ['modal-a', 'modal-b'],
  search = '',
  variants = {},
  gsap = false,
} = {}) {
  const windowEvents = []
  const body = h('body')

  const documentListeners = new Map()
  const document = {
    activeElement: null,
    body,
    addEventListener(type, listener) {
      const list = documentListeners.get(type) || []
      list.push(listener)
      documentListeners.set(type, list)
    },
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  }

  function fire(el, type, target) {
    const event = makeEvent(type, target || el)
    ;(el._listeners.get(type) || []).forEach((listener) => listener(event))
    return event
  }

  /** Gives an element the focus surface the script uses to restore the keyboard. */
  function focusable(el) {
    el.focused = false
    el.focus = () => { el.focused = true }
    return el
  }

  /**
   * A `<dialog class="modal_dialog">`. `open` is the native flag the registry's
   * closeAll() reads, and `showModal()` pulls focus into the dialog the way the
   * real element does — that is what makes the script's capture-then-show order
   * observable. Every dialog carries a scrollable pane so the open-time scroll
   * reset can be checked, including whether it happened while the dialog was
   * already showing.
   */
  function dialogStub(id) {
    const attrs = { class: 'modal_dialog', 'data-modal-target': id }
    if (variants[id]) attrs['data-wf--modal--variant'] = variants[id]

    const dialog = focusable(h('dialog', attrs))
    const pane = h('div', { 'data-modal-scroll': '' })
    let paneScrollTop = 5
    pane.resetWhileOpen = null
    Object.defineProperty(pane, 'scrollTop', {
      get: () => paneScrollTop,
      set(value) {
        paneScrollTop = value
        pane.resetWhileOpen = dialog.open
      },
    })
    dialog.append(pane)
    dialog.pane = pane

    dialog.open = false
    dialog.closeCalls = 0
    dialog.showModal = () => {
      dialog.open = true
      document.activeElement = dialog
    }
    dialog.close = () => {
      dialog.closeCalls += 1
      dialog.open = false
      document.activeElement = body
    }
    body.append(dialog)
    return dialog
  }

  const dialogs = ids.map((id) => dialogStub(id))

  const windowListeners = new Map()
  const window = {
    document,
    addEventListener(type, listener) {
      const list = windowListeners.get(type) || []
      list.push(listener)
      windowListeners.set(type, list)
    },
    dispatchEvent(event) {
      (windowListeners.get(event.type) || []).forEach((listener) => listener(event))
      return true
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

  const gsapInstance = gsap ? gsapStub() : null

  const context = {
    window,
    document,
    location,
    history,
    URL,
    URLSearchParams,
    CustomEvent: CustomEventStub,
    console: { info() {}, warn() {}, error() {} },
  }
  if (gsapInstance) context.gsap = gsapInstance
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(SOURCE, context)

  // Registered before boot so a deep-linked open, which happens during boot, is
  // captured too. The registry snapshot pins when an entry becomes visible to a
  // modal-open listener.
  const record = (event) => {
    const modal = event.detail.modal
    const id = modal.getAttribute('data-modal-target')
    windowEvents.push({
      type: event.type,
      modal,
      registryEntry: window.lumos && window.lumos.modal ? window.lumos.modal.list[id] : undefined,
    })
  }
  window.addEventListener('modal-open', record)
  window.addEventListener('modal-close', record)

  const dialogsById = {}
  dialogs.forEach((dialog) => { dialogsById[dialog.getAttribute('data-modal-target')] = dialog })

  /** Appends an element to the page so `closest()` has a real chain to walk. */
  const inPage = (el) => body.append(el)

  return {
    document,
    window,
    history,
    dialogs,
    dialogsById,
    windowEvents,
    gsap: gsapInstance,
    /**
     * A dialog authored into the page after boot — a CMS list rendering late, or
     * a modal a companion script injects. Only `init()` can adopt it.
     */
    addDialog(id) {
      const dialog = dialogStub(id)
      dialogs.push(dialog)
      dialogsById[id] = dialog
      return dialog
    },
    /** A `[data-modal-trigger='<id>']` button somewhere in the page. */
    triggerFor(id) { return inPage(h('button', { 'data-modal-trigger': id })) },
    /** An `<a href="#<id>">` opening the same modal. */
    anchorFor(id) { return inPage(h('a', { href: `#${id}` })) },
    /** The real Webflow shape: a label inside the anchor takes the click. */
    anchorLabelFor(id) {
      const label = h('span')
      inPage(h('a', { href: `#${id}` }, [label]))
      return label
    },
    /** A `[data-modal-close]` control inside a dialog. */
    closeControlIn(dialog) { return dialog.append(h('button', { 'data-modal-close': '' })) },
    /** A `[data-close-all-modals]` control anywhere in the page. */
    closeAllControl(tag = 'button') { return inPage(h(tag, { 'data-close-all-modals': '' })) },
    /** A click on something the modal system does not care about. */
    inertElement() { return inPage(h('div')) },
    /** Boot the script the way the browser does. */
    boot() {
      const domReady = documentListeners.get('DOMContentLoaded') || []
      assert.equal(domReady.length, 1, 'modal.js binds exactly one DOMContentLoaded listener')
      domReady.forEach((listener) => listener(makeEvent('DOMContentLoaded', null)))
    },
    /** A page-level click, as delegated to the document. */
    clickDocument(target) {
      const event = makeEvent('click', target)
      ;(documentListeners.get('click') || []).forEach((listener) => listener(event))
      return event
    },
    /** A click inside a dialog, bubbled to the dialog's own listener. */
    clickInDialog(dialog, target) { return fire(dialog, 'click', target) },
    /** The native `cancel` the Escape key raises on an open dialog. */
    cancel(dialog) { return fire(dialog, 'cancel', dialog) },
    focusable,
    get modalSystem() { return window.lumos.modal },
    types() { return windowEvents.map((event) => event.type) },
  }
}

test('a trigger opens only the modal it names', () => {
  const env = makeEnv()
  env.boot()

  const event = env.clickDocument(env.triggerFor('modal-b'))

  assert.equal(env.dialogsById['modal-b'].open, true)
  assert.equal(env.dialogsById['modal-a'].open, false, 'the other dialog stays shut')
  assert.equal(env.document.body.style.overflow, 'hidden', 'page scroll is locked while open')
  assert.equal(event.defaultPrevented, false, 'a plain button keeps its default behaviour')
})

test('an anchor trigger opens the modal instead of jumping to the hash', () => {
  const env = makeEnv()
  env.boot()

  const event = env.clickDocument(env.anchorFor('modal-a'))

  assert.equal(env.dialogsById['modal-a'].open, true)
  assert.equal(event.defaultPrevented, true, 'an href="#modal-a" control must not jump')
})

test('a label inside an anchor trigger opens the modal and still suppresses the jump', () => {
  const env = makeEnv()
  env.boot()

  // Webflow wraps link text in a child element, so the click target is rarely
  // the anchor itself.
  const event = env.clickDocument(env.anchorLabelFor('modal-a'))

  assert.equal(env.dialogsById['modal-a'].open, true)
  assert.equal(event.defaultPrevented, true, 'the anchor that matched decides, not the click target')
})

test('ignores a click that is not on any trigger', () => {
  const env = makeEnv()
  env.boot()

  env.clickDocument(env.inertElement())

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
  assert.notEqual(env.document.body.style.overflow, 'hidden', 'the page was never scroll-locked')
})

test('a close control inside the dialog closes it and restores page scroll', () => {
  const env = makeEnv()
  env.boot()

  const dialog = env.dialogsById['modal-a']
  env.clickDocument(env.triggerFor('modal-a'))
  assert.equal(dialog.open, true)

  env.clickInDialog(dialog, env.closeControlIn(dialog))

  assert.equal(dialog.open, false)
  assert.equal(env.document.body.style.overflow, '', 'the page scrolls again')
})

test('a click elsewhere inside the dialog leaves it open', () => {
  const env = makeEnv()
  env.boot()

  const dialog = env.dialogsById['modal-a']
  env.clickDocument(env.triggerFor('modal-a'))
  env.clickInDialog(dialog, dialog.append(h('p')))

  assert.equal(dialog.open, true)
})

test('closes from the scrim, but not from a backdrop that only looks like one', () => {
  const env = makeEnv()
  env.boot()

  const dialog = env.dialogsById['modal-a']
  const scrim = dialog.append(h('div', { class: 'modal_backdrop', 'data-modal-close': '' }))
  const decoration = dialog.append(h('div', { class: 'modal_backdrop' }))

  env.clickDocument(env.triggerFor('modal-a'))

  env.clickInDialog(dialog, decoration)
  assert.equal(dialog.open, true, 'the class alone does not dismiss: the attribute does')

  env.clickInDialog(dialog, scrim)
  assert.equal(dialog.open, false, 'clicking the scrim closes the modal')
  assert.equal(env.document.body.style.overflow, '')
})

test('Escape closes the modal through the script, not the native cancel', () => {
  const env = makeEnv()
  env.boot()

  const dialog = env.dialogsById['modal-b']
  env.clickDocument(env.triggerFor('modal-b'))

  const event = env.cancel(dialog)

  assert.equal(dialog.open, false)
  assert.equal(
    event.defaultPrevented,
    true,
    'the native dismissal is suppressed so the script can run its own close',
  )
  assert.equal(env.document.body.style.overflow, '')
})

test('returns focus to whatever opened the modal', () => {
  const env = makeEnv()
  env.boot()

  const dialog = env.dialogsById['modal-a']
  const trigger = env.focusable(env.triggerFor('modal-a'))
  env.document.activeElement = trigger

  env.clickDocument(trigger)
  assert.equal(env.document.activeElement, dialog, 'the open dialog holds focus')
  assert.equal(trigger.focused, false)

  env.clickInDialog(dialog, env.closeControlIn(dialog))

  assert.equal(trigger.focused, true, 'the keyboard lands back where it started')
  assert.equal(dialog.focused, false, 'the dialog itself was never the thing to restore to')
})

test('resets scrollable panes only once the dialog is showing', () => {
  const env = makeEnv()
  env.boot()

  const dialog = env.dialogsById['modal-a']
  assert.equal(dialog.pane.scrollTop, 5, 'a previous visit left the pane scrolled')

  env.clickDocument(env.triggerFor('modal-a'))

  assert.equal(dialog.pane.scrollTop, 0, 'the modal opens at the top of its content')
  assert.equal(
    dialog.pane.resetWhileOpen,
    true,
    'the reset runs after showModal(), when the pane has a layout to scroll',
  )
  assert.equal(env.dialogsById['modal-b'].pane.scrollTop, 5, 'and only for the modal that opened')
})

test('announces modal-open and modal-close with the dialog that moved', () => {
  const env = makeEnv()
  env.boot()

  const dialog = env.dialogsById['modal-b']
  env.clickDocument(env.triggerFor('modal-b'))
  env.clickInDialog(dialog, env.closeControlIn(dialog))

  assert.deepEqual(env.types(), ['modal-open', 'modal-close'])
  assert.equal(env.windowEvents[0].modal, dialog)
  assert.equal(env.windowEvents[1].modal, dialog)
})

test('opens the deep-linked modal on load and strips only its own parameter', () => {
  const env = makeEnv({ search: '?modal-id=modal-b&src=marker&utm_source=x' })
  env.boot()

  assert.equal(env.dialogsById['modal-b'].open, true, 'a shared link lands with the modal already open')
  assert.equal(env.dialogsById['modal-a'].open, false)
  assert.deepEqual(env.types(), ['modal-open'])

  assert.equal(env.history.calls.length, 1)
  const rewritten = new URL(String(env.history.calls[0].url))
  assert.equal(rewritten.searchParams.get('modal-id'), null, 'a refresh must not reopen it')
  assert.equal(rewritten.searchParams.get('src'), 'marker', 'attribution the page still reads survives')
  assert.equal(rewritten.searchParams.get('utm_source'), 'x')
  assert.equal(rewritten.pathname, '/some-page')
})

test('leaves every modal closed when the URL names none of them', () => {
  const env = makeEnv({ search: '?modal-id=modal-missing' })
  env.boot()

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
  assert.deepEqual(env.history.calls, [])
})

test('deep-link modal-open fires before the modal joins the registry', () => {
  // Characterization, not endorsement: the deep-link open runs before the
  // registry entry is written, so a modal-open listener cannot look the modal
  // up. Pinned so that moving the registration is a deliberate change.
  const env = makeEnv({ search: '?modal-id=modal-b' })
  env.boot()

  assert.equal(env.windowEvents[0].registryEntry, undefined)

  env.clickDocument(env.triggerFor('modal-a'))
  assert.equal(
    env.windowEvents[1].registryEntry,
    env.modalSystem.list['modal-a'],
    'every later open does see the registry',
  )
})

test('closeAll() shuts every open modal and leaves the closed ones alone', () => {
  const env = makeEnv({ ids: ['modal-a', 'modal-b', 'modal-c'] })
  env.boot()

  env.modalSystem.list['modal-a'].open()
  env.modalSystem.list['modal-b'].open()

  env.modalSystem.closeAll()

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false, false])
  assert.deepEqual(env.dialogs.map((dialog) => dialog.closeCalls), [1, 1, 0])
  assert.deepEqual(env.types(), ['modal-open', 'modal-open', 'modal-close', 'modal-close'])
})

test('an anchor close-all control closes every open modal without jumping', () => {
  const env = makeEnv()
  env.boot()

  env.clickDocument(env.triggerFor('modal-a'))
  env.clickDocument(env.triggerFor('modal-b'))
  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [true, true])

  const event = env.clickDocument(env.closeAllControl('a'))

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
  assert.equal(event.defaultPrevented, true, 'an anchor close-all control must not jump')
  assert.equal(env.document.body.style.overflow, '')
})

test('a button close-all control keeps its default behaviour', () => {
  const env = makeEnv()
  env.boot()

  env.clickDocument(env.triggerFor('modal-a'))
  const event = env.clickDocument(env.closeAllControl())

  assert.equal(env.dialogsById['modal-a'].open, false)
  assert.equal(event.defaultPrevented, false, 'a button inside a form must still submit')
})

test('exposes each modal on window.lumos.modal for other scripts to drive', () => {
  const env = makeEnv()
  env.boot()

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

test('the last dialog authored with a target owns that registry entry', () => {
  // README: the Brand dashboard carries both the legacy rate-call dialog and
  // the live End Project & Review dialog under `rate-starter-call`, and callers
  // resolve the live one through the registry rather than document order.
  const env = makeEnv({ ids: ['dup', 'dup'] })
  env.boot()

  const [legacy, live] = env.dialogs
  assert.equal(env.modalSystem.list.dup.el, live, 'the later dialog wins the id')

  env.modalSystem.list.dup.open()

  assert.equal(live.open, true)
  assert.equal(legacy.open, false, 'a registry-driven open reaches only the winning dialog')
})

test('a shared-target trigger click opens every dialog carrying that target', () => {
  // Characterization: each dialog binds its own document listener, so a raw
  // trigger click opens all of them. Registry consumers are unaffected — per the
  // README they resolve the dialog through list[id].el, which is the last one.
  const env = makeEnv({ ids: ['dup', 'dup'] })
  env.boot()

  env.clickDocument(env.triggerFor('dup'))

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [true, true])
  assert.deepEqual(env.types(), ['modal-open', 'modal-open'])
})

test('open() on an unknown id is a no-op', () => {
  const env = makeEnv()
  env.boot()

  env.modalSystem.open('modal-missing')

  assert.deepEqual(env.dialogs.map((dialog) => dialog.open), [false, false])
})

test('re-running init does not double-bind an already adopted modal', () => {
  const env = makeEnv()
  env.boot()

  env.modalSystem.init()

  const dialog = env.dialogsById['modal-a']
  env.clickDocument(env.triggerFor('modal-a'))
  assert.equal(dialog.open, true)
  assert.deepEqual(env.types(), ['modal-open'], 'one click still means one open')

  env.clickInDialog(dialog, env.closeControlIn(dialog))
  assert.equal(dialog.open, false)
  assert.deepEqual(env.types(), ['modal-open', 'modal-close'], 'and one close fully closes it')
})

test('init() adopts a modal added after boot and leaves the earlier ones as they were', () => {
  const env = makeEnv()
  env.boot()

  const late = env.addDialog('modal-late')
  env.clickDocument(env.triggerFor('modal-late'))
  assert.equal(late.open, false, 'a dialog the page added later is inert until init runs')
  assert.equal(env.modalSystem.list['modal-late'], undefined)

  env.modalSystem.init()
  env.clickDocument(env.triggerFor('modal-late'))

  assert.equal(late.open, true, 'that is what init() is for')
  assert.equal(env.modalSystem.list['modal-late'].el, late)
  assert.deepEqual(env.types(), ['modal-open'])

  env.clickDocument(env.triggerFor('modal-a'))
  assert.equal(env.dialogsById['modal-a'].open, true)
  assert.deepEqual(
    env.types(),
    ['modal-open', 'modal-open'],
    'and the modals adopted at boot did not pick up a second listener',
  )
})

test('plays the entrance timeline when the page has gsap', () => {
  const env = makeEnv({ gsap: true })
  env.boot()

  const dialog = env.dialogsById['modal-b']
  assert.deepEqual(env.gsap.contexts, env.dialogs, 'each timeline is scoped to its own dialog')
  assert.equal(env.gsap.timelines.length, 2)

  env.clickDocument(env.triggerFor('modal-b'))

  const played = env.gsap.timelines.filter((tl) => tl.played)
  assert.equal(played.length, 1, 'only the opened modal animates')
  assert.equal(dialog.tl, played[0])
  assert.equal(played[0].config.paused, true, 'the timeline waits for the open, it does not autoplay')
  assert.equal(dialog.open, true)
  assert.deepEqual(env.types(), ['modal-open'])
  assert.equal(dialog.pane.scrollTop, 0)
})

test('closes through the reversed timeline and still finishes the teardown', () => {
  const env = makeEnv({ gsap: true })
  env.boot()

  const dialog = env.dialogsById['modal-a']
  const trigger = env.focusable(env.triggerFor('modal-a'))
  env.document.activeElement = trigger
  env.clickDocument(trigger)

  env.clickInDialog(dialog, env.closeControlIn(dialog))

  assert.equal(dialog.tl.reversed, true, 'the exit animation runs instead of a hard close')
  assert.equal(dialog.open, false)
  assert.equal(dialog.closeCalls, 1)
  assert.equal(env.document.body.style.overflow, '')
  assert.equal(trigger.focused, true)
  assert.deepEqual(env.types(), ['modal-open', 'modal-close'])
})

test('builds a different entrance for each authored variant', () => {
  const env = makeEnv({
    ids: ['panel', 'full', 'plain'],
    gsap: true,
    variants: { panel: 'side-panel', full: 'full-screen' },
  })
  env.boot()

  const [panel, full, plain] = env.gsap.timelines
  // A side panel slides in from the edge; the others fade and rise.
  assert.deepEqual(panel.calls, [
    ['fromTo', '.modal_backdrop', ['opacity']],
    ['from', '.modal_content', ['xPercent']],
  ])
  // Full screen keeps the backdrop clear and brings the slot in behind it.
  assert.deepEqual(full.calls, [
    ['set', '.modal_backdrop', ['opacity']],
    ['from', '.modal_content', ['opacity']],
    ['from', '.modal_slot', ['opacity', 'y']],
  ])
  assert.deepEqual(plain.calls, [
    ['fromTo', '.modal_backdrop', ['opacity']],
    ['from', '.modal_content', ['opacity', 'y']],
  ])
})
