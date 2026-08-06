const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./complete-profile-back.js'),
  'utf8',
)

const COMPLETE_PROFILE = '/complete-profile'
const STORAGE_KEY = 'thestarters:v3-complete-profile-back'
// The neighbouring key on the same page. It belongs to
// brand-account-controller.js / complete-profile-redirect.js /
// brand-profile-redirect.js, and this module must never go near it.
const COMPLETION_MARKER_KEY = 'thestarters:v3-brand-profile-completed'

const WRAPPER_SELECTOR = '[data-complete-profile-back]'
const LABEL_SELECTOR = '[data-complete-profile-back-label]'
const BUTTON_SELECTOR = 'button.clickable_btn'
const HIDDEN_CLASS = 'hide'

const SITE = 'https://the-starters-3-0.webflow.io'
const PROD = 'https://www.thestarters.com'

// The authored placeholder, so a test that expects the label to be rewritten
// fails loudly rather than passing against an empty string.
const AUTHORED_LABEL = 'Go back to [Name]'

/* ------------------------------- fake DOM -------------------------------- */

/**
 * The smallest element that can be revealed, relabelled, and clicked. `selectors`
 * is the list of selector strings this node answers to — the module only ever
 * asks for three of them, so matching by literal is enough and keeps the harness
 * from growing a CSS engine.
 */
function element({ selectors = [], classes = [], display = null, text = '', children = [] } = {}) {
  const node = {
    selectors,
    classes: new Set(classes),
    style: { display: display === null ? '' : display },
    textContent: text,
    listeners: [],
    children,
    removed: [],
  }
  node.classList = {
    remove(name) {
      node.removed.push(name)
      node.classes.delete(name)
    },
    contains(name) {
      return node.classes.has(name)
    },
  }
  node.addEventListener = (type, handler) => {
    node.listeners.push({ type, handler })
  }
  node.querySelector = (selector) => matchIn(node.children, selector)
  node.fire = () => {
    for (const entry of node.listeners) {
      if (entry.type === 'click') entry.handler()
    }
  }
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
 * The authored markup: a wrapper hidden the way the Designer hides it, holding
 * the label text element and the real `button.clickable_btn` control.
 *
 * `hiddenBy` reproduces the three shapes a Webflow edit can leave behind — the
 * project's `hide` utility class, an inline `display:none`, or both.
 */
function backButtonMarkup({
  hiddenBy = 'both',
  labelMissing = false,
  buttonMissing = false,
} = {}) {
  const label = element({
    selectors: [LABEL_SELECTOR],
    text: AUTHORED_LABEL,
  })
  const button = element({ selectors: [BUTTON_SELECTOR] })
  const children = []
  if (!labelMissing) children.push(label)
  if (!buttonMissing) children.push(button)

  const wrapper = element({
    selectors: [WRAPPER_SELECTOR],
    classes: hiddenBy === 'inline' ? [] : [HIDDEN_CLASS],
    display: hiddenBy === 'class' ? null : 'none',
    children,
  })

  return { wrapper, label, button }
}

/* ------------------------------- the harness ------------------------------ */

function loadModule(options = {}) {
  const hostname = options.hostname || 'the-starters-3-0.webflow.io'
  const pathname = Object.prototype.hasOwnProperty.call(options, 'pathname')
    ? options.pathname
    : COMPLETE_PROFILE
  const logs = { info: [], warn: [], error: [] }
  const assigns = []

  const location = {
    hostname,
    origin: 'https://' + hostname,
    pathname,
    search: '',
    href: 'https://' + hostname + pathname,
    assign(value) {
      assigns.push(value)
    },
    replace(value) {
      location.replaced = value
    },
  }

  // Every storage touch is recorded, so the tests can prove which keys this
  // module reads and writes — specifically that it never touches the completion
  // marker the three sibling modules share on this same page.
  const store = new Map()
  if (options.stored !== undefined) store.set(STORAGE_KEY, options.stored)
  if (options.completionMarker !== undefined) {
    store.set(COMPLETION_MARKER_KEY, options.completionMarker)
  }
  const touches = []
  const sessionStorage = {
    getItem(key) {
      touches.push(['getItem', key])
      if (options.storageFailure === 'get') {
        throw new Error('SecurityError: storage is disabled')
      }
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      touches.push(['setItem', key, value])
      if (options.storageFailure === 'set') {
        throw new Error('QuotaExceededError')
      }
      store.set(key, String(value))
    },
    removeItem(key) {
      touches.push(['removeItem', key])
      store.delete(key)
    },
  }

  const markup = options.wrapperMissing
    ? { wrapper: null, label: null, button: null }
    : backButtonMarkup(options)
  const roots = markup.wrapper ? [markup.wrapper] : []

  // Elements that match the module's selectors but live OUTSIDE the wrapper.
  // This is the production shape, not a hypothetical: `clickable_btn` is the
  // project's generic button class, and the Complete-profile form's own Submit
  // control carries it.
  if (options.strayButton && markup.button) roots.push(markup.button)
  if (options.strayLabel && markup.label) roots.push(markup.label)

  const window = {
    location,
    URL,
    URLSearchParams,
    setTimeout(fn) {
      return fn ? 0 : 0
    },
    clearTimeout() {},
  }
  if (options.storageFailure === 'missing') {
    window.sessionStorage = undefined
  } else if (options.storageFailure === 'property') {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('SecurityError: storage is disabled')
      },
    })
  } else {
    window.sessionStorage = sessionStorage
  }
  if (options.urlMissing) window.URL = undefined
  if (options.debug) window.STARTERS_DEBUG = true

  const document = {
    readyState: options.readyState || 'complete',
    referrer: options.referrer === undefined ? '' : options.referrer,
    listeners: {},
    querySelector(selector) {
      if (options.querySelectorThrows) throw new Error('querySelector is unavailable')
      return matchIn(roots, selector)
    },
    addEventListener(type, handler) {
      document.listeners[type] = document.listeners[type] || []
      document.listeners[type].push(handler)
    },
  }
  if (options.referrerThrows) {
    Object.defineProperty(document, 'referrer', {
      get() {
        throw new Error('referrer is unavailable')
      },
    })
  }

  const context = vm.createContext({
    window,
    document,
    URL,
    URLSearchParams,
    console: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
    },
  })

  vm.runInContext(source, context)

  return {
    api: window.StartersCompleteProfileBack,
    assigns,
    document,
    label: markup.label,
    button: markup.button,
    location,
    logs,
    store,
    touches,
    window,
    wrapper: markup.wrapper,
  }
}

// A load on an off-scope path: the module exports its surface but never boots,
// which is how every pure-helper test gets an API without touching the DOM.
function helpers(options = {}) {
  return loadModule(Object.assign({ pathname: '/other' }, options)).api
}

// A real click on the inner control, bubbling to the wrapper the way a browser
// delivers it — both handlers run, and the module's latch is what keeps that
// from being two navigations.
function clickThroughButton(loaded) {
  loaded.button.fire()
  loaded.wrapper.fire()
}

// --- Pure helpers: gates ------------------------------------------------------

test('host gate covers production, staging, local, and dev tunnels but not lookalikes', () => {
  const api = helpers()
  for (const host of [
    'the-starters-3-0.webflow.io',
    'thestarters.com',
    'www.thestarters.com',
    'localhost',
    '127.0.0.1',
    'some-generated-name.trycloudflare.com',
  ]) {
    assert.equal(api.allowedHost(host), true, host)
  }
  for (const host of [
    'notwebflow.io',
    'evil-trycloudflare.com',
    'thestarters.com.attacker.example',
    'attacker.example',
    '',
  ]) {
    assert.equal(api.allowedHost(host), false, host)
  }
})

test('exactly both slash forms of /complete-profile are in scope', () => {
  const api = helpers()
  assert.equal(api.isCompleteProfilePath('/complete-profile'), true)
  assert.equal(api.isCompleteProfilePath('/complete-profile/'), true)
  assert.equal(api.isCompleteProfilePath('/complete-profile/step-2'), false)
  assert.equal(api.isCompleteProfilePath('/complete-profile-brand'), false)
  assert.equal(api.isCompleteProfilePath('/'), false)
})

test('paths normalize by dropping one trailing slash, except at the root', () => {
  const api = helpers()
  assert.equal(api.normalizePath('/login/'), '/login')
  assert.equal(api.normalizePath('/login'), '/login')
  assert.equal(api.normalizePath('/'), '/')
  assert.equal(api.normalizePath(''), '/')
  assert.equal(api.normalizePath(undefined), '/')
  assert.equal(api.normalizePath('/learn/sessions/'), '/learn/sessions')
  // A path that arrives without its leading slash still compares correctly.
  assert.equal(api.normalizePath('login'), '/login')
})

// --- Pure helpers: the hide rule ---------------------------------------------

test('an empty, unparseable, or off-site referrer hides the button', () => {
  const api = helpers()
  for (const referrer of [
    '',
    null,
    undefined,
    'not a url',
    'javascript:alert(1)',
    'https://www.google.com/search?q=starters',
    'https://notwebflow.io/case-studies',
    'https://thestarters.com.attacker.example/why-us',
    'https://evil-trycloudflare.com/learn',
  ]) {
    assert.equal(api.shouldHide(referrer), true, JSON.stringify(referrer))
  }
})

test('every funnel and guarded page hides the button, both slash forms', () => {
  const api = helpers()
  const excluded = [
    '/auth-route',
    '/login',
    '/sign-up',
    '/starter-login',
    '/brand-dashboard',
    '/all-starters',
    '/messages',
    '/starter-dashboard',
    '/dashboard',
    '/opportunities',
    '/complete-profile',
  ]
  // Array.from because the exported list is built inside the vm realm, and
  // deepStrictEqual compares prototypes.
  assert.deepEqual(Array.from(api.hiddenPaths), excluded)
  for (const path of excluded) {
    assert.equal(api.shouldHide(SITE + path), true, path)
    assert.equal(api.shouldHide(SITE + path + '/'), true, path + '/')
    // A query string is part of the stored URL and must not defeat the match.
    assert.equal(api.shouldHide(SITE + path + '?from=nav'), true, path + '?')
  }
})

test('every page brand-profile-redirect.js guards is on this hide list', () => {
  // The one piece of shotgun surgery this module cannot avoid: the hide list
  // duplicates the guard's page list, and the two must move together. A page
  // added to GUARDED_PATHS without a matching entry here silently reopens the
  // bounce loop on exactly that page — the member goes "back" to it, and the
  // guard sends them straight to this form again.
  //
  // Read out of the sibling's source rather than restated, so this fails the day
  // the guard grows a page instead of the day someone notices in production.
  const guardSource = fs.readFileSync(
    require.resolve('./brand-profile-redirect.js'),
    'utf8',
  )
  const block = guardSource.match(/var GUARDED_PATHS = \[([\s\S]*?)\n {2}\]/)
  assert.ok(block, 'no GUARDED_PATHS array found in brand-profile-redirect.js')

  const guarded = Array.from(block[1].matchAll(/'([^']+)'/g), (match) => match[1])
  assert.ok(guarded.length >= 12, 'expected the full guarded-page list, got ' + guarded.length)

  const api = helpers()
  for (const path of guarded) {
    const normalized = api.normalizePath(path)
    assert.ok(
      api.hiddenPaths.indexOf(normalized) !== -1,
      'brand-profile-redirect.js guards ' +
        path +
        ' but this module would offer it as a "go back" destination',
    )
    // And through the real predicate, in both slash forms.
    assert.equal(api.shouldHide(SITE + normalized), true, normalized)
    assert.equal(api.shouldHide(SITE + normalized + '/'), true, normalized + '/')
  }

  // The guard matches the opportunity detail slug with its own regex rather than
  // through GUARDED_PATHS, so it is asserted separately.
  assert.ok(
    /\^\\\/opportunities\\\/\[\^\/\]\+/.test(guardSource),
    'brand-profile-redirect.js no longer guards /opportunities/<slug> by regex',
  )
  assert.equal(api.shouldHide(SITE + '/opportunities/product-designer'), true)
})

test('an opportunity detail page hides the button; a nested page under it does not', () => {
  const api = helpers()
  assert.equal(api.shouldHide(SITE + '/opportunities/product-designer'), true)
  assert.equal(api.shouldHide(SITE + '/opportunities/product-designer/'), true)
  // Not guarded by brand-profile-redirect.js, so not hidden here either.
  assert.equal(api.shouldHide(SITE + '/opportunities/product-designer/apply'), false)
  // A lookalike sibling page is a different page.
  assert.equal(api.shouldHide(SITE + '/opportunities-brands-view'), false)
})

test('an ordinary marketing page does not hide the button, on any approved host', () => {
  const api = helpers()
  for (const origin of [SITE, PROD, 'https://thestarters.com', 'http://localhost']) {
    assert.equal(api.shouldHide(origin + '/case-studies'), false, origin)
    assert.equal(api.shouldHide(origin + '/'), false, origin + ' root')
  }
})

// --- Pure helpers: the label map ---------------------------------------------

test('the curated label map names every page it claims', () => {
  const api = helpers()
  const expected = [
    ['/', 'Home'],
    ['/learn', 'Learn'],
    ['/learn/sessions', 'Sessions'],
    ['/learn/sessions/foo', 'Sessions'],
    ['/learn/interview-news/x', 'Article'],
    ['/learn/interviews', 'Article'],
    ['/learn/playbooks-frameworks/x', 'Playbook'],
    ['/learn/frameworks-playbooks', 'Playbook'],
    ['/learn/webinar', 'Webinar'],
    ['/learn/events', 'Events'],
    ['/case-studies', 'Case Studies'],
    ['/case-studies/acme', 'Case Studies'],
    ['/why-us', 'Why Us'],
    ['/functions/design', 'Functions'],
    ['/industries/fintech', 'Industries'],
  ]
  for (const [path, name] of expected) {
    assert.equal(api.destinationNameFor(path), name, path)
    assert.equal(api.labelFor(path), 'Go back to ' + name, path)
    // The trailing-slash twin is the same page.
    if (path !== '/') {
      assert.equal(api.labelFor(path + '/'), 'Go back to ' + name, path + '/')
    }
  }
})

test('/hire/<slug> is labelled with the Starter first name only', () => {
  const api = helpers()
  assert.equal(api.labelFor('/hire/john-doe'), 'Go back to John')
  assert.equal(api.labelFor('/hire/john-doe/'), 'Go back to John')
  assert.equal(api.labelFor('/hire/JANE-smith'), 'Go back to Jane')
  // No hyphen at all: the whole slug is the first name.
  assert.equal(api.labelFor('/hire/prince'), 'Go back to Prince')
  // A slug with nothing before the hyphen has no name to show, so the button
  // falls back rather than reading "Go back to ".
  assert.equal(api.labelFor('/hire/-doe'), 'Go back')
  // The listing page and a nested page are not the map's business.
  assert.equal(api.labelFor('/hire'), 'Go back')
  assert.equal(api.labelFor('/hire/john-doe/reviews'), 'Go back')
})

test('an unmapped page gets a bare "Go back", not "Go back to "', () => {
  const api = helpers()
  for (const path of [
    '/pricing',
    '/learn/interviews/some-slug',
    '/some/deep/unknown/page',
    '/functions',
    '/industries',
  ]) {
    assert.equal(api.destinationNameFor(path), null, path)
    assert.equal(api.labelFor(path), 'Go back', path)
    assert.equal(api.labelFor(path), api.fallbackLabel, path)
  }
})

test('the pages the hide list owns are deliberately absent from the label map', () => {
  // If someone ever loosens the hide list, these read as "Go back" rather than
  // silently shipping a half-written map.
  const api = helpers()
  for (const path of api.hiddenPaths) {
    assert.equal(api.destinationNameFor(path), null, path)
  }
})

test('labelFor accepts a full URL as readily as a path', () => {
  const api = helpers()
  assert.equal(api.labelFor(SITE + '/case-studies/acme'), 'Go back to Case Studies')
  assert.equal(api.labelFor(PROD + '/hire/john-doe?ref=nav'), 'Go back to John')
  assert.equal(api.labelFor('/learn?tab=all'), 'Go back to Learn')
  assert.equal(api.labelFor('/learn#top'), 'Go back to Learn')
  assert.equal(api.labelFor('not a url'), 'Go back')
})

// --- Runtime: the applied button ----------------------------------------------

test('a same-site referrer reveals, labels, and wires the button', () => {
  const loaded = loadModule({ referrer: SITE + '/case-studies/acme' })
  const { api, wrapper, label, assigns } = loaded

  assert.equal(api.state.applied, true)
  assert.equal(api.state.reason, 'applied')
  assert.equal(label.textContent, 'Go back to Case Studies')
  assert.equal(wrapper.classes.has(HIDDEN_CLASS), false, 'the hide class is removed')
  assert.equal(wrapper.style.display, '', 'the inline display:none is cleared')

  clickThroughButton(loaded)
  assert.deepEqual(assigns, [SITE + '/case-studies/acme'])
})

test('the full referrer URL is navigated to, query string and all', () => {
  const referrer = SITE + '/hire/john-doe?utm_source=newsletter#reviews'
  const loaded = loadModule({ referrer })
  assert.equal(loaded.label.textContent, 'Go back to John')
  clickThroughButton(loaded)
  assert.deepEqual(loaded.assigns, [referrer])
})

test('one press is one navigation, however the click reaches the module', () => {
  // Wrapper and inner button are both bound on purpose, so a press on the button
  // runs two handlers. The latch is what makes that one assign().
  const loaded = loadModule({ referrer: SITE + '/why-us' })
  clickThroughButton(loaded)
  assert.equal(loaded.assigns.length, 1)
  // And a second press cannot re-navigate a page that is already leaving.
  clickThroughButton(loaded)
  assert.equal(loaded.assigns.length, 1)

  // A press that lands on the wrapper alone works identically.
  const onWrapper = loadModule({ referrer: SITE + '/why-us' })
  onWrapper.wrapper.fire()
  assert.deepEqual(onWrapper.assigns, [SITE + '/why-us'])
})

test('both hidden shapes are revealed, and a missing button still works', () => {
  for (const hiddenBy of ['class', 'inline', 'both']) {
    const loaded = loadModule({ referrer: SITE + '/learn', hiddenBy })
    assert.equal(loaded.api.state.applied, true, hiddenBy)
    assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), false, hiddenBy)
    assert.notEqual(loaded.wrapper.style.display, 'none', hiddenBy)
  }

  // No `button.clickable_btn` inside: the wrapper binding still carries the
  // click, so the control degrades instead of dying.
  const noButton = loadModule({ referrer: SITE + '/learn', buttonMissing: true })
  assert.equal(noButton.api.state.applied, true)
  noButton.wrapper.fire()
  assert.deepEqual(noButton.assigns, [SITE + '/learn'])
})

test('a stray .clickable_btn outside the wrapper is never bound', () => {
  // The live page's authored wrapper contains NO <button> at all, while the
  // form's own Submit control is a `button.clickable_btn`. A document-wide
  // fallback would therefore bind "go back" to Submit, and pressing Submit would
  // navigate to the referrer instead of submitting the profile form.
  const loaded = loadModule({
    referrer: SITE + '/why-us',
    buttonMissing: true,
    strayButton: true,
  })

  assert.equal(loaded.api.state.applied, true, 'the button still works')
  assert.deepEqual(
    loaded.button.listeners,
    [],
    'the stray button must never receive a listener',
  )

  // Firing the stray control navigates nowhere; only the wrapper does.
  loaded.button.fire()
  assert.deepEqual(loaded.assigns, [])
  loaded.wrapper.fire()
  assert.deepEqual(loaded.assigns, [SITE + '/why-us'])
})

test('a stray label outside the wrapper is neither used nor rewritten', () => {
  // Same rule, the other selector: the wrapper is the only scope.
  const loaded = loadModule({
    referrer: SITE + '/why-us',
    labelMissing: true,
    strayLabel: true,
  })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.api.state.reason, 'no-label')
  assert.equal(loaded.label.textContent, AUTHORED_LABEL, 'left untouched')
  assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), true)
})

test('an unmapped referrer still gets a working button, labelled "Go back"', () => {
  const loaded = loadModule({ referrer: SITE + '/pricing' })
  assert.equal(loaded.api.state.applied, true)
  assert.equal(loaded.label.textContent, 'Go back')
  clickThroughButton(loaded)
  assert.deepEqual(loaded.assigns, [SITE + '/pricing'])
})

// --- Runtime: staying hidden ---------------------------------------------------

test('an empty referrer with nothing stored leaves the button exactly as authored', () => {
  const loaded = loadModule({ referrer: '' })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.api.state.reason, 'no-referrer')
  assert.equal(loaded.label.textContent, AUTHORED_LABEL)
  assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), true)
  assert.equal(loaded.wrapper.style.display, 'none')
  assert.deepEqual(loaded.wrapper.listeners, [])
})

test('an off-site referrer stays hidden and is never stored', () => {
  for (const referrer of [
    'https://www.google.com/',
    'https://mail.google.com/mail/u/0/',
    'https://notwebflow.io/case-studies',
  ]) {
    const loaded = loadModule({ referrer })
    assert.equal(loaded.api.state.applied, false, referrer)
    assert.equal(loaded.api.state.reason, 'no-referrer', referrer)
    assert.equal(loaded.store.has(STORAGE_KEY), false, referrer)
    assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), true, referrer)
  }
})

test('an off-site referrer does not fall back to a stale stored page', () => {
  // The member's last move was an arrival from somewhere we do not own. Offering
  // them a page from an earlier visit would be a lie about where "back" goes.
  const loaded = loadModule({
    referrer: 'https://www.google.com/',
    stored: SITE + '/case-studies',
  })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.store.get(STORAGE_KEY), SITE + '/case-studies', 'left untouched')
})

test('every excluded referrer leaves the button hidden', () => {
  const paths = [
    '/auth-route',
    '/login',
    '/sign-up',
    '/starter-login',
    '/brand-dashboard',
    '/all-starters',
    '/messages',
    '/starter-dashboard',
    '/dashboard',
    '/opportunities',
    '/opportunities/product-designer',
    '/complete-profile',
  ]
  for (const path of paths) {
    for (const form of [path, path + '/']) {
      const loaded = loadModule({ referrer: SITE + form })
      assert.equal(loaded.api.state.applied, false, form)
      assert.equal(loaded.api.state.reason, 'excluded-referrer', form)
      assert.equal(loaded.label.textContent, AUTHORED_LABEL, form)
      assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), true, form)
      assert.deepEqual(loaded.wrapper.listeners, [], form)
    }
  }
})

test('an excluded referrer is still captured, so it replaces a stale one', () => {
  // The capture rule is origin-only by design: the most recent same-site entry
  // into this page is the truth, even when the answer is "hide". A member who
  // went /case-studies → /complete-profile → /login → /complete-profile must not
  // be offered the case study they left two navigations ago.
  const loaded = loadModule({
    referrer: SITE + '/login',
    stored: SITE + '/case-studies',
  })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.api.state.reason, 'excluded-referrer')
  assert.equal(loaded.store.get(STORAGE_KEY), SITE + '/login')
})

test('a missing wrapper or a missing label leaves the page alone and warns on staging', () => {
  const noWrapper = loadModule({ referrer: SITE + '/why-us', wrapperMissing: true })
  assert.equal(noWrapper.api.state.applied, false)
  assert.equal(noWrapper.api.state.reason, 'no-wrapper')
  assert.ok(noWrapper.logs.warn.some((line) => line.includes(WRAPPER_SELECTOR)))

  // The label element is what carries the whole promise of the button. Without
  // it, revealing would ship the authored "[Name]" placeholder to a real member.
  const noLabel = loadModule({ referrer: SITE + '/why-us', labelMissing: true })
  assert.equal(noLabel.api.state.applied, false)
  assert.equal(noLabel.api.state.reason, 'no-label')
  assert.equal(noLabel.wrapper.classes.has(HIDDEN_CLASS), true)
  assert.deepEqual(noLabel.wrapper.listeners, [])
  assert.ok(noLabel.logs.warn.some((line) => line.includes(LABEL_SELECTOR)))

  // A DOM that refuses to be queried at all is the same fail-open.
  const hostile = loadModule({ referrer: SITE + '/why-us', querySelectorThrows: true })
  assert.equal(hostile.api.state.applied, false)
  assert.equal(hostile.api.state.reason, 'no-wrapper')
})

// --- sessionStorage capture and fallback ---------------------------------------

test('a reload with a stored referrer keeps the button, with no document.referrer', () => {
  // The entire reason the key exists: a refresh of the form is exactly when the
  // member is most likely to want out, and it is also when the referrer is gone.
  const loaded = loadModule({ referrer: '', stored: SITE + '/learn/sessions/foo' })
  assert.equal(loaded.api.state.applied, true)
  assert.equal(loaded.label.textContent, 'Go back to Sessions')
  clickThroughButton(loaded)
  assert.deepEqual(loaded.assigns, [SITE + '/learn/sessions/foo'])
})

test('a fresh same-site referrer overwrites a stale stored value', () => {
  const loaded = loadModule({
    referrer: SITE + '/why-us',
    stored: SITE + '/case-studies/acme',
  })
  assert.equal(loaded.store.get(STORAGE_KEY), SITE + '/why-us')
  assert.equal(loaded.label.textContent, 'Go back to Why Us')
  clickThroughButton(loaded)
  assert.deepEqual(loaded.assigns, [SITE + '/why-us'])
})

test('the stored value is re-validated before it is ever navigated to', () => {
  // A hand-edited or cross-origin entry must not become a navigation target just
  // because it survived in storage.
  for (const stored of [
    'https://attacker.example/phish',
    'javascript:alert(1)',
    'not a url',
    '   ',
    '',
  ]) {
    const loaded = loadModule({ referrer: '', stored })
    assert.equal(loaded.api.state.applied, false, JSON.stringify(stored))
    assert.deepEqual(loaded.assigns, [], JSON.stringify(stored))
  }
})

test('a stored value on an excluded page still hides the button', () => {
  const loaded = loadModule({ referrer: '', stored: SITE + '/brand-dashboard' })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.api.state.reason, 'excluded-referrer')
})

test('this module reads and writes only its own key', () => {
  const loaded = loadModule({
    referrer: SITE + '/why-us',
    completionMarker: '1',
  })
  for (const touch of loaded.touches) {
    assert.equal(touch[1], STORAGE_KEY, JSON.stringify(touch))
  }
  // The neighbouring completion marker survives the visit untouched.
  assert.equal(loaded.store.get(COMPLETION_MARKER_KEY), '1')
  // The header names the shared key to say it is off limits; what must not exist
  // is a string LITERAL, which is the only shape that could reach storage.
  assert.ok(
    !source.includes("'" + COMPLETION_MARKER_KEY + "'"),
    'the shared completion marker key must never be a literal in this file',
  )
  assert.ok(
    !source.includes('"' + COMPLETION_MARKER_KEY + '"'),
    'the shared completion marker key must never be a literal in this file',
  )
})

test('storage that is absent or throws costs the fallback, never the page', () => {
  // A live referrer needs no storage at all, so the button still works.
  for (const storageFailure of ['missing', 'get', 'set', 'property']) {
    const live = loadModule({ referrer: SITE + '/why-us', storageFailure })
    assert.equal(live.api.state.applied, true, storageFailure)
    clickThroughButton(live)
    assert.deepEqual(live.assigns, [SITE + '/why-us'], storageFailure)
  }

  // Without a referrer there is nothing left to fall back to, and that is the
  // whole cost: a hidden button, not a broken page. Only the three failures that
  // break READING lose the fallback — a storage that refuses writes can still
  // hand back a value an earlier page managed to store.
  for (const storageFailure of ['missing', 'get', 'property']) {
    const reload = loadModule({
      referrer: '',
      stored: SITE + '/why-us',
      storageFailure,
    })
    assert.equal(reload.api.state.applied, false, storageFailure)
    assert.deepEqual(reload.assigns, [], storageFailure)
  }

  const writeOnlyFailure = loadModule({
    referrer: '',
    stored: SITE + '/why-us',
    storageFailure: 'set',
  })
  assert.equal(writeOnlyFailure.api.state.applied, true)
  clickThroughButton(writeOnlyFailure)
  assert.deepEqual(writeOnlyFailure.assigns, [SITE + '/why-us'])
})

test('a document.referrer that throws is treated as no referrer', () => {
  const loaded = loadModule({ referrerThrows: true })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.api.state.reason, 'no-referrer')
})

test('a browser without window.URL cannot be talked into navigating', () => {
  const loaded = loadModule({ referrer: SITE + '/why-us', urlMissing: true })
  assert.equal(loaded.api.state.applied, false)
  assert.deepEqual(loaded.assigns, [])
})

// --- Gating --------------------------------------------------------------------

test('does not run on an unapproved hostname', () => {
  const loaded = loadModule({
    hostname: 'attacker.example',
    referrer: 'https://attacker.example/case-studies',
  })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), true)
  assert.equal(loaded.wrapper.style.display, 'none')
  assert.deepEqual(loaded.wrapper.listeners, [])
  assert.deepEqual(loaded.touches, [], 'nothing is captured off-host')
})

test('does not run on a page outside /complete-profile', () => {
  for (const pathname of ['/brand-dashboard', '/complete-profile/step-2', '/']) {
    const loaded = loadModule({ pathname, referrer: SITE + '/why-us' })
    assert.equal(loaded.api.state.applied, false, pathname)
    assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), true, pathname)
    assert.deepEqual(loaded.wrapper.listeners, [], pathname)
    assert.deepEqual(loaded.touches, [], pathname)
  }
})

test('runs on both slash forms of the page', () => {
  for (const pathname of ['/complete-profile', '/complete-profile/']) {
    const loaded = loadModule({ pathname, referrer: SITE + '/why-us' })
    assert.equal(loaded.api.state.applied, true, pathname)
  }
})

test('a head install without defer waits for DOMContentLoaded', () => {
  const loaded = loadModule({
    readyState: 'loading',
    referrer: SITE + '/why-us',
  })
  assert.equal(loaded.api.state.applied, false, 'nothing has run yet')
  assert.equal(loaded.document.listeners.DOMContentLoaded.length, 1)
  loaded.document.listeners.DOMContentLoaded[0]()
  assert.equal(loaded.api.state.applied, true)
  assert.equal(loaded.label.textContent, 'Go back to Why Us')
})

test('a second load does not re-run, and init() is idempotent', () => {
  const loaded = loadModule({ referrer: SITE + '/why-us' })
  assert.equal(loaded.window.__startersCompleteProfileBackBooted, true)
  assert.equal(loaded.wrapper.listeners.length, 1)

  loaded.api.init()
  assert.equal(loaded.wrapper.listeners.length, 1, 'no second binding')
  clickThroughButton(loaded)
  assert.equal(loaded.assigns.length, 1)
})

test('the decision half can be called by hand off-scope without touching the page', () => {
  // Off-scope the module exports its surface but never boots, so a staging
  // session can interrogate every helper without the page moving.
  const loaded = loadModule({ pathname: '/other', referrer: SITE + '/why-us' })
  assert.equal(loaded.api.state.applied, false)
  assert.equal(loaded.api.effectiveReferrer(), SITE + '/why-us')
  assert.equal(loaded.api.storedReferrer(), SITE + '/why-us', 'capture is a read side effect')
  assert.deepEqual(loaded.assigns, [])
  assert.equal(loaded.wrapper.classes.has(HIDDEN_CLASS), true)
})

// --- Diagnostics ---------------------------------------------------------------

test('diagnostics are staging-only unless STARTERS_DEBUG opts in', () => {
  assert.equal(helpers().diagnosticsEnabled(), true)
  assert.equal(helpers({ hostname: 'www.thestarters.com' }).diagnosticsEnabled(), false)
  assert.equal(
    helpers({ hostname: 'www.thestarters.com', debug: true }).diagnosticsEnabled(),
    true,
  )
})

test('production is silent on every outcome, and still behaves identically', () => {
  const cases = [
    { referrer: PROD + '/why-us', applied: true },
    { referrer: PROD + '/login', applied: false },
    { referrer: 'https://www.google.com/', applied: false },
    { referrer: '', applied: false },
    { referrer: PROD + '/why-us', wrapperMissing: true, applied: false },
    { referrer: PROD + '/why-us', labelMissing: true, applied: false },
    { referrer: '', stored: PROD + '/case-studies', applied: true },
  ]
  for (const options of cases) {
    const expected = options.applied
    const loaded = loadModule(
      Object.assign({ hostname: 'www.thestarters.com' }, options),
    )
    const label = JSON.stringify(options)
    assert.equal(loaded.api.state.applied, expected, label)
    assert.deepEqual(loaded.logs.info, [], label)
    assert.deepEqual(loaded.logs.warn, [], label)
    assert.deepEqual(loaded.logs.error, [], label)
  }
})

test('staging narrates the decision', () => {
  const applied = loadModule({ referrer: SITE + '/why-us' })
  assert.ok(applied.logs.info.some((line) => line.includes('back button applied')))

  const excluded = loadModule({ referrer: SITE + '/brand-dashboard' })
  assert.ok(excluded.logs.info.some((line) => line.includes('stays hidden')))

  const fallback = loadModule({ referrer: '', stored: SITE + '/why-us' })
  assert.ok(fallback.logs.info.some((line) => line.includes('using the stored one')))
})

// --- Release marker ------------------------------------------------------------

test('the header @release marker matches the exported release property', () => {
  const api = helpers()
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the complete-profile-back.js header')
  assert.equal(api.release, marker[1])
})

test('the file is raw browser JavaScript, with no script wrapper', () => {
  // Repo rule: these files are dropped straight into a Webflow <script src>.
  assert.ok(!/<\/?script/i.test(source), 'no <script> tags may appear in the file')
  assert.ok(source.trimStart().startsWith('/**'), 'the header comment comes first')
})
