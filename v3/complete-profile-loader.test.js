const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./complete-profile-loader.js'),
  'utf8',
)

const LOADER_SELECTOR = '[data-complete-profile-loader]'
const FORM_SELECTOR = '#wf-form-Complete-Profile-Form'
const FORM_DIM_SELECTOR = '[data-complete-profile-element="form"]'
const PHOTO_DIM_SELECTOR = '[data-complete-profile-element="profile-photo"]'

const BUSY = 'aria-busy'
const AUTHORED_MIN_MS = 1000
const DEFAULT_MIN_MS = 200
const MAX_MS = 5000
const DIM_TRANSITION = 'opacity 0.2s ease'

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * A deterministic clock driving both `Date.now()` and the module's timers, so
 * the 1000ms minimum display and the 5000ms fail-open cap are testable without
 * waiting for them. Same shape as the one in patch-onboarding-status.test.js.
 */
function makeClock() {
  let now = 1700000000000
  let seq = 0
  const timers = new Map()

  return {
    now: () => now,
    pending: () => timers.size,
    setTimeout(fn, ms) {
      const id = ++seq
      timers.set(id, { fn, at: now + (ms || 0) })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    async advance(ms) {
      const target = now + ms
      for (let guard = 0; guard < 5000; guard += 1) {
        let dueId = null
        let due = null
        for (const [id, timer] of timers) {
          if (timer.at > target) continue
          if (!due || timer.at < due.at) {
            due = timer
            dueId = id
          }
        }
        if (!due) break
        now = Math.max(now, due.at)
        timers.delete(dueId)
        due.fn()
        await flush()
      }
      now = target
      await flush()
    },
  }
}

/* ------------------------------- fake DOM -------------------------------- */

/**
 * The smallest element this module can query, style, and read attributes from.
 * `selectors` is the list of selector strings the node answers to — the module
 * asks for five of them in total, so matching by literal keeps the harness from
 * growing a CSS engine, exactly as complete-profile-back.test.js does.
 */
function element({ selectors = [], attributes = {}, style = {}, children = [] } = {}) {
  const node = {
    selectors,
    attributes: Object.assign({}, attributes),
    style: Object.assign({ display: '', opacity: '', pointerEvents: '', transition: '' }, style),
    children,
    observers: [],
    parentElement: null,
  }
  node.getAttribute = (name) =>
    Object.prototype.hasOwnProperty.call(node.attributes, name)
      ? node.attributes[name]
      : null
  // Writing an attribute is what drives the module: the observers registered on
  // this node fire, the way a real MutationObserver delivers an attribute record.
  node.setAttribute = (name, value) => {
    node.attributes[name] = String(value)
    for (const observer of node.observers.slice()) observer.deliver()
  }
  node.removeAttribute = (name) => {
    delete node.attributes[name]
    for (const observer of node.observers.slice()) observer.deliver()
  }
  node.querySelector = (selector) => matchIn(node.children, selector)
  // Self-or-descendant, the same answer Node.contains() gives. The module uses
  // it to refuse to dim an ancestor of the loader.
  node.contains = (other) => {
    if (!other) return false
    if (other === node) return true
    for (const child of node.children) {
      if (child.contains(other)) return true
    }
    return false
  }
  for (const child of children) child.parentElement = node
  return node
}

function matchIn(nodes, selector) {
  for (const node of nodes) {
    if (node.selectors.indexOf(selector) !== -1) return node
    const nested = node.querySelector(selector)
    if (nested) return nested
  }
  return null
}

/**
 * The published shape: one parent container holding the form, with the loader
 * as a SIBLING placed after it. The dim targets sit outside that container,
 * which is also where they live on the real page.
 */
function pageMarkup({
  loaderMissing = false,
  formMissing = false,
  formInContainer = true,
  minMsAttribute = String(AUTHORED_MIN_MS),
  loaderVisible = false,
  dimFormMissing = false,
  dimPhotoMissing = false,
  dimFormStyle = {},
  busy = null,
  // The half-finished Designer edit: the dim attribute lands on the element that
  // still wraps the loader, because step 2 was done without step 1.
  dimFormContainsLoader = false,
  // A loader with no parent at all, plus a decoy first form in the document.
  loaderParentless = false,
  decoyForm = false,
} = {}) {
  const formAttributes = {}
  if (busy !== null) formAttributes[BUSY] = busy

  const form = element({
    selectors: ['form', FORM_SELECTOR],
    attributes: formAttributes,
  })

  const loaderAttributes = {}
  if (minMsAttribute !== null) loaderAttributes['data-loader'] = minMsAttribute
  const loader = element({
    selectors: [LOADER_SELECTOR],
    attributes: loaderAttributes,
    // Authored hidden means an inline (or compiled-class) `none`; `loaderVisible`
    // is the Designer mistake this module self-heals at init.
    style: { display: loaderVisible ? '' : 'none' },
  })

  const loaderIsLoose = loaderParentless || dimFormContainsLoader

  const containerChildren = []
  if (!formMissing && formInContainer) containerChildren.push(form)
  if (!loaderMissing && !loaderIsLoose) containerChildren.push(loader)
  const container = element({ selectors: ['.container'], children: containerChildren })

  const dimForm = element({
    selectors: [FORM_DIM_SELECTOR],
    style: dimFormStyle,
    children: dimFormContainsLoader && !loaderMissing ? [loader] : [],
  })
  const dimPhoto = element({ selectors: [PHOTO_DIM_SELECTOR] })

  const roots = []
  // Pushed FIRST so a bare document.querySelector('form') would find this and
  // not the profile form — which is the mistake the id fallback must avoid.
  const decoy = element({ selectors: ['form'] })
  if (decoyForm) roots.push(decoy)
  roots.push(container)
  // A loader with no parent is still reachable from the document.
  if (loaderParentless && !loaderMissing) roots.push(loader)
  // A form outside the container is still reachable by id — the fallback path.
  if (!formMissing && !formInContainer) roots.push(form)
  if (!dimFormMissing) roots.push(dimForm)
  if (!dimPhotoMissing) roots.push(dimPhoto)

  return {
    container,
    decoy,
    form: formMissing ? null : form,
    loader: loaderMissing ? null : loader,
    dimForm: dimFormMissing ? null : dimForm,
    dimPhoto: dimPhotoMissing ? null : dimPhoto,
    roots,
  }
}

/* ------------------------------- the harness ------------------------------ */

function loadModule(options = {}) {
  const hostname = options.hostname || 'the-starters-3-0.webflow.io'
  const logs = { info: [], warn: [], error: [] }
  const clock = makeClock()
  const markup = pageMarkup(options)

  const location = {
    hostname,
    origin: 'https://' + hostname,
    pathname: '/complete-profile',
    href: 'https://' + hostname + '/complete-profile',
  }

  const window = {
    location,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
        this.records = []
      }
      observe(target, init) {
        this.target = target
        this.init = init
        target.observers.push(this)
      }
      disconnect() {
        const index = this.target.observers.indexOf(this)
        if (index !== -1) this.target.observers.splice(index, 1)
      }
      deliver() {
        this.callback([], this)
      }
    },
  }
  if (options.observerMissing) window.MutationObserver = undefined
  if (options.debug) window.STARTERS_DEBUG = true

  const document = {
    readyState: 'complete',
    querySelector(selector) {
      if (options.querySelectorThrows) throw new Error('querySelector is unavailable')
      return matchIn(markup.roots, selector)
    },
    addEventListener() {},
  }

  class FakeDate extends Date {
    static now() {
      return clock.now()
    }
  }

  const context = vm.createContext({
    window,
    document,
    Date: FakeDate,
    console: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
    },
  })

  const run = () => vm.runInContext(source, context)
  run()

  return {
    api: window.StartersCompleteProfileLoader,
    clock,
    context,
    document,
    dimForm: markup.dimForm,
    decoy: markup.decoy,
    dimPhoto: markup.dimPhoto,
    form: markup.form,
    loader: markup.loader,
    logs,
    run,
    window,
  }
}

function setBusy(loaded, value) {
  loaded.form.setAttribute(BUSY, value)
}

function assertDimmed(element, label) {
  assert.equal(element.style.opacity, '0.2', label + ' opacity')
  assert.equal(element.style.pointerEvents, 'none', label + ' pointer-events')
  assert.equal(element.style.transition, DIM_TRANSITION, label + ' transition')
}

// --- Boot and bail ------------------------------------------------------------

test('no loader element means no observer, no writes, and a named bail', () => {
  const loaded = loadModule({ loaderMissing: true })
  assert.equal(loaded.api.state.reason, 'no-loader')
  assert.equal(loaded.api.state.booted, false)
  // The gate that makes this file safe to load site-wide: the form is never
  // observed and nothing on the page is touched.
  assert.equal(loaded.form.observers.length, 0)
  assert.equal(loaded.dimForm.style.opacity, '')
  assert.equal(loaded.dimPhoto.style.opacity, '')
  // And it is silent, because every non-/complete-profile page would log here.
  assert.deepEqual(loaded.logs.warn, [])
})

test('the exported show/hide are inert after a no-loader bail', () => {
  // This file loads site-wide, so the console surface exists on pages with no
  // form. Calling it must not half-run against state that was never initialized.
  const loaded = loadModule({ loaderMissing: true })

  assert.doesNotThrow(() => loaded.api.show())
  assert.doesNotThrow(() => loaded.api.hide())
  assert.equal(loaded.api.state.showing, false)
  assert.equal(loaded.api.state.shows, 0)
  assert.equal(loaded.api.state.minMs, DEFAULT_MIN_MS)
  assert.equal(loaded.dimForm.style.opacity, '')
})

test('a loader with no form to watch bails and warns on staging', () => {
  const loaded = loadModule({ formMissing: true })
  assert.equal(loaded.api.state.reason, 'no-form')
  assert.equal(loaded.api.state.booted, false)
  assert.equal(loaded.logs.warn.length, 1)
})

test('the form is found by id when it is not the loader parent’s child', () => {
  const loaded = loadModule({ formInContainer: false })
  assert.equal(loaded.api.state.booted, true)
  assert.equal(loaded.form.observers.length, 1)
})

test('a parentless loader resolves the form by id, never the first form on the page', () => {
  // The scoped lookup must not degrade into document.querySelector('form'):
  // the first form on the real page is the nav search form, and binding the
  // spinner to it would mask the wrong submit. Wrong form is worse than none.
  const loaded = loadModule({ loaderParentless: true, decoyForm: true })

  assert.equal(loaded.api.state.booted, true)
  assert.equal(loaded.form.observers.length, 1, 'the profile form is observed')
  assert.equal(loaded.decoy.observers.length, 0, 'the decoy form is not')
})

test('a parentless loader with no id-matching form bails rather than grabbing a decoy', () => {
  const loaded = loadModule({
    loaderParentless: true,
    decoyForm: true,
    formMissing: true,
  })

  assert.equal(loaded.api.state.reason, 'no-form')
  assert.equal(loaded.decoy.observers.length, 0)
})

test('init force-hides a loader the Designer shipped visible', () => {
  const loaded = loadModule({ loaderVisible: true })
  // Inline, so it wins over the compiled class rule either way.
  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.api.state.booted, true)
})

test('the module boots watching the busy attribute and reads the authored min display', () => {
  const loaded = loadModule()
  assert.equal(loaded.api.state.booted, true)
  assert.equal(loaded.api.state.reason, 'watching')
  assert.equal(loaded.api.state.minMs, AUTHORED_MIN_MS)
  assert.equal(loaded.form.observers.length, 1)
})

test('a missing or non-numeric data-loader falls back to the 200ms default', () => {
  for (const value of [
    null,
    'soon',
    '-5',
    '',
    '   ',
    // The dangerous ones: parseInt reads these as 1 and 1000, so a plausible
    // Designer typo would silently shrink or fake the anti-flash window.
    '1s',
    '1000px',
    '1.5',
    'NaN',
    'Infinity',
  ]) {
    assert.equal(
      loadModule({ minMsAttribute: value }).api.state.minMs,
      DEFAULT_MIN_MS,
      JSON.stringify(value),
    )
  }
})

test('a wholly numeric data-loader is honored, padding included', () => {
  assert.equal(loadModule({ minMsAttribute: '1000' }).api.state.minMs, 1000)
  // Copy-paste often carries whitespace; that alone should not defeat it.
  assert.equal(loadModule({ minMsAttribute: ' 1000 ' }).api.state.minMs, 1000)
  assert.equal(loadModule({ minMsAttribute: '0' }).api.state.minMs, 0)
})

test('the init guard makes a second load of the same file a no-op', () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')
  assert.equal(loaded.api.state.shows, 1)

  const first = loaded.api
  loaded.run()

  // Same object, same counters: the second evaluation returned at the guard and
  // never re-exported, re-observed, or re-hid the loader.
  assert.equal(loaded.window.StartersCompleteProfileLoader, first)
  assert.equal(loaded.api.state.shows, 1)
  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.form.observers.length, 1)
})

// --- Showing ------------------------------------------------------------------

test('aria-busy true shows the loader and dims both targets', () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')

  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.api.state.showing, true)
  assertDimmed(loaded.dimForm, 'form')
  assertDimmed(loaded.dimPhoto, 'profile-photo')
  assert.equal(loaded.api.state.dimCount, 2)
})

test('a form already busy at init gets its loader without waiting for a mutation', () => {
  const loaded = loadModule({ busy: 'true' })
  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.api.state.showing, true)
  assertDimmed(loaded.dimForm, 'form')
})

test('missing dim targets are skipped silently and the loader still shows', () => {
  const loaded = loadModule({ dimFormMissing: true, dimPhotoMissing: true })
  setBusy(loaded, 'true')

  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.api.state.dimCount, 0)
  // Absent attributes are the expected first state in production, not an error.
  assert.deepEqual(loaded.logs.warn, [])
})

test('a dim target that contains the loader is skipped, and the spinner stays healthy', () => {
  // The half-finished Designer edit: the attribute went onto the element that
  // still wraps the loader. Dimming it would fade the spinner to 0.2 and make it
  // inert, because opacity on an ancestor creates a rendering group its children
  // cannot escape and pointer-events: none inherits.
  const loaded = loadModule({ dimFormContainsLoader: true })
  setBusy(loaded, 'true')

  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.dimForm.style.opacity, '', 'the wrapper must not be dimmed')
  assert.equal(loaded.dimForm.style.pointerEvents, '')
  // The sibling target is unaffected — the skip is per-target, not global.
  assertDimmed(loaded.dimPhoto, 'profile-photo')
  assert.equal(loaded.api.state.dimCount, 1)
  // And the author is told, on staging, exactly what to move.
  assert.equal(loaded.logs.warn.length, 1)
  assert.match(loaded.logs.warn[0], /contains the loader/)
  assert.match(loaded.logs.warn[0], /Move the loader out/)
})

test('the same target is dimmed normally once the loader is moved out of it', () => {
  // The other branch of the guard: identical markup, loader no longer inside.
  const loaded = loadModule()
  setBusy(loaded, 'true')

  assertDimmed(loaded.dimForm, 'form')
  assert.equal(loaded.api.state.dimCount, 2)
  assert.deepEqual(loaded.logs.warn, [])
})

test('one present and one absent dim target dims the present one only', () => {
  const loaded = loadModule({ dimPhotoMissing: true })
  setBusy(loaded, 'true')

  assertDimmed(loaded.dimForm, 'form')
  assert.equal(loaded.api.state.dimCount, 1)
  assert.equal(loaded.loader.style.display, 'flex')
})

// --- Hiding, minimum display, and restore --------------------------------------

test('the minimum display window is honored before the loader comes down', async () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')

  await loaded.clock.advance(100)
  setBusy(loaded, 'false')

  // Busy is already false, but the spinner would have flashed.
  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.api.state.showing, true)
  assert.equal(loaded.api.state.reason, 'min-display')

  await loaded.clock.advance(899)
  assert.equal(loaded.loader.style.display, 'flex')

  await loaded.clock.advance(1)
  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.api.state.showing, false)
})

test('a busy window longer than the minimum hides immediately on idle', async () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')
  await loaded.clock.advance(AUTHORED_MIN_MS + 50)
  setBusy(loaded, 'false')

  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.api.state.reason, 'idle')
})

test('hiding restores the dim targets, including the values the page authored', async () => {
  const loaded = loadModule({ dimFormStyle: { opacity: '0.85', transition: 'all 1s' } })
  setBusy(loaded, 'true')
  assertDimmed(loaded.dimForm, 'form')

  await loaded.clock.advance(AUTHORED_MIN_MS)
  setBusy(loaded, 'false')

  // Prior inline values come back; a target that had none is handed back to the
  // stylesheet with an empty declaration.
  assert.equal(loaded.dimForm.style.opacity, '0.85')
  assert.equal(loaded.dimForm.style.pointerEvents, '')
  assert.equal(loaded.dimPhoto.style.opacity, '')
  assert.equal(loaded.dimPhoto.style.pointerEvents, '')

  // dimCount reports APPLIED dim, so it drops the moment the styles come off —
  // not one transition later when the captured values are finally released.
  assert.equal(loaded.api.state.dimCount, 0)

  // The transition survives one beat so the fade back in animates, then goes.
  assert.equal(loaded.dimForm.style.transition, DIM_TRANSITION)
  await loaded.clock.advance(200)
  assert.equal(loaded.dimForm.style.transition, 'all 1s')
  assert.equal(loaded.dimPhoto.style.transition, '')
  assert.equal(loaded.api.state.dimCount, 0)
})

test('removing aria-busy entirely counts as idle', async () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')
  await loaded.clock.advance(AUTHORED_MIN_MS)
  loaded.form.removeAttribute(BUSY)

  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.dimForm.style.opacity, '')
})

test('an idle form that was never busy is left completely alone', () => {
  const loaded = loadModule()
  setBusy(loaded, 'false')

  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.api.state.shows, 0)
  assert.equal(loaded.api.state.hides, 0)
  assert.equal(loaded.dimForm.style.opacity, '')
})

// --- The success path (the controller's redirect busy latch) -------------------

test('a successful submit keeps the loader up for the whole redirect window', async () => {
  // The real success shape as of the redirect latch in
  // v3/brand-account-controller.js: aria-busy goes true and is NEVER cleared,
  // because the controller deliberately stays busy until the page unloads.
  const loaded = loadModule()
  setBusy(loaded, 'true')

  // Well past the minimum display, and the loader is still masking the form.
  await loaded.clock.advance(AUTHORED_MIN_MS * 3)
  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.api.state.showing, true)
  assertDimmed(loaded.dimForm, 'form')
  assert.equal(loaded.form.getAttribute(BUSY), 'true')

  // And if that navigation stalls, the fail-open cap is still the backstop —
  // the member gets the page back rather than a permanent overlay.
  await loaded.clock.advance(MAX_MS)
  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.api.state.reason, 'cap')
  assert.equal(loaded.dimForm.style.opacity, '')
  assert.equal(loaded.dimForm.style.pointerEvents, '')
})

// --- Fail-open ----------------------------------------------------------------

test('the loader hides itself 5s after a show even while the form is still busy', async () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')

  await loaded.clock.advance(MAX_MS - 1)
  assert.equal(loaded.loader.style.display, 'flex')

  await loaded.clock.advance(1)
  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.api.state.showing, false)
  assert.equal(loaded.api.state.reason, 'cap')
  assert.equal(loaded.api.state.capHits, 1)
  // A member must never be left behind an overlay AND behind a dimmed form.
  assert.equal(loaded.dimForm.style.opacity, '')
  assert.equal(loaded.dimForm.style.pointerEvents, '')
  assert.equal(loaded.dimPhoto.style.pointerEvents, '')
  // aria-busy is still "true": the cap ignores it on purpose.
  assert.equal(loaded.form.getAttribute(BUSY), 'true')
})

test('the cap is re-armed per show, so a second submit gets its own 5s', async () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')
  await loaded.clock.advance(MAX_MS)
  assert.equal(loaded.api.state.capHits, 1)

  setBusy(loaded, 'false')
  setBusy(loaded, 'true')
  await loaded.clock.advance(MAX_MS - 1)
  assert.equal(loaded.loader.style.display, 'flex')
  await loaded.clock.advance(1)
  assert.equal(loaded.api.state.capHits, 2)
  assert.equal(loaded.loader.style.display, 'none')
})

// --- Coalescing ---------------------------------------------------------------

test('a fresh submit inside the minimum-display window cancels the pending hide', async () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')
  await loaded.clock.advance(100)
  setBusy(loaded, 'false') // schedules a hide 900ms out
  setBusy(loaded, 'true') // second submit starts before it lands

  await loaded.clock.advance(900)
  // The stray timer from the first submit must not have un-dimmed this one.
  assert.equal(loaded.loader.style.display, 'flex')
  assert.equal(loaded.api.state.showing, true)
  assertDimmed(loaded.dimForm, 'form')
  assert.equal(loaded.api.state.reason, 'reshown')
})

test('the re-show restarts the minimum window rather than inheriting the old one', async () => {
  const loaded = loadModule()
  setBusy(loaded, 'true')
  await loaded.clock.advance(900)
  setBusy(loaded, 'true') // re-show at t=900
  await loaded.clock.advance(100)
  setBusy(loaded, 'false') // 100ms into the NEW window

  assert.equal(loaded.loader.style.display, 'flex')
  await loaded.clock.advance(900)
  assert.equal(loaded.loader.style.display, 'none')
})

test('a re-show reuses the originally captured inline values, never its own dim', async () => {
  const loaded = loadModule({ dimFormStyle: { opacity: '0.85' } })
  setBusy(loaded, 'true')
  await loaded.clock.advance(AUTHORED_MIN_MS)
  setBusy(loaded, 'false')
  assert.equal(loaded.dimForm.style.opacity, '0.85')

  // Back inside the transition-release window, so the captured values are still
  // held. If the module re-captured here it would record its own 0.2.
  setBusy(loaded, 'true')
  await loaded.clock.advance(AUTHORED_MIN_MS)
  setBusy(loaded, 'false')
  assert.equal(loaded.dimForm.style.opacity, '0.85')

  await loaded.clock.advance(200)
  assert.equal(loaded.api.state.dimCount, 0)
})

test('repeated busy toggles leave no timers behind once everything settles', async () => {
  const loaded = loadModule()
  for (let index = 0; index < 5; index += 1) {
    setBusy(loaded, 'true')
    await loaded.clock.advance(30)
    setBusy(loaded, 'false')
    await loaded.clock.advance(30)
  }
  await loaded.clock.advance(MAX_MS + 200)

  assert.equal(loaded.loader.style.display, 'none')
  assert.equal(loaded.api.state.showing, false)
  assert.equal(loaded.dimForm.style.opacity, '')
  assert.equal(loaded.dimForm.style.pointerEvents, '')
  assert.equal(loaded.clock.pending(), 0)
})

// --- Environment and diagnostics ----------------------------------------------

test('a browser without MutationObserver bails with the loader hidden', () => {
  const loaded = loadModule({ observerMissing: true })
  assert.equal(loaded.api.state.reason, 'no-mutation-observer')
  assert.equal(loaded.api.state.booted, false)
  assert.equal(loaded.loader.style.display, 'none')
})

test('an unqueryable DOM is treated as no loader, not as a crash', () => {
  const loaded = loadModule({ querySelectorThrows: true })
  assert.equal(loaded.api.state.reason, 'no-loader')
})

test('the staging gate covers staging, local and dev tunnels but not lookalikes', () => {
  const api = loadModule().api
  for (const host of [
    'the-starters-3-0.webflow.io',
    'localhost',
    '127.0.0.1',
    'some-generated-name.trycloudflare.com',
  ]) {
    assert.equal(api.stagingHost(host), true, host)
  }
  for (const host of ['notwebflow.io', 'evil-trycloudflare.com', 'thestarters.com', '']) {
    assert.equal(api.stagingHost(host), false, host)
  }
})

test('production is silent, and STARTERS_DEBUG is the only way to unmute it', async () => {
  const quiet = loadModule({ hostname: 'www.thestarters.com' })
  setBusy(quiet, 'true')
  await quiet.clock.advance(MAX_MS)
  assert.deepEqual(quiet.logs.info, [])
  assert.deepEqual(quiet.logs.warn, [])
  // The cap still fired — only the narration is suppressed.
  assert.equal(quiet.api.state.capHits, 1)
  assert.equal(quiet.loader.style.display, 'none')

  const loud = loadModule({ hostname: 'www.thestarters.com', debug: true })
  setBusy(loud, 'true')
  assert.ok(loud.logs.info.length > 0)
})

// --- Release and format guards -------------------------------------------------

test('the header @release marker matches the exported release property', () => {
  const marker = source.match(/^ \* @release (\S+)$/m)
  assert.ok(marker, 'no "@release" line in the complete-profile-loader.js header')
  assert.equal(loadModule().api.release, marker[1])
})

test('the file is raw CDN-safe JavaScript behind an init guard', () => {
  assert.equal(/<\/?script/i.test(source), false, 'no <script> wrapper tags')
  // The `__starters<Name>Booted` prefix the rest of v3 uses. This file loads
  // site-wide, so a generic global would be the one most likely to collide.
  assert.match(source, /window\.__startersCompleteProfileLoaderBooted/)
  // Nothing executes before the guard: the first statement inside the IIFE is
  // the guard itself.
  const body = source.slice(source.indexOf('(function () {'))
  assert.match(
    body,
    /^\(function \(\) \{\s*'use strict'\s*if \(window\.__startersCompleteProfileLoaderBooted\) return/,
  )
})

test('the attribute names carry their leading d — no "ata-" paste typo', () => {
  const typos = source.match(/[^a-z-]ata-[a-z]/g)
  assert.equal(typos, null, 'found an "ata-" attribute name: ' + typos)
})
