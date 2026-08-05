const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const FILE = path.join(__dirname, 'turnstile-contents-fix.js')
const source = fs.readFileSync(FILE, 'utf8')

/* ------------------------------- mini world ------------------------------- *
 * Only the surface the module actually touches. The point of these tests is the
 * production-silence gate and the release-marker contract, not the widget: the
 * browser half is verified against the real Webflow page, which is the only place
 * `jQuery.data(form, '.w-form')` and `turnstile.render` exist at all.
 * -------------------------------------------------------------------------- */

function makeWorld({ hostname, forms = [], turnstile = null, debug = undefined, jquery = null }) {
  const logs = { info: [], warn: [], error: [] }
  const timers = { intervals: [], timeouts: [] }

  const window = {
    location: { hostname },
    turnstile,
    jQuery: jquery,
    setInterval(fn) {
      timers.intervals.push(fn)
      return timers.intervals.length
    },
    clearInterval(id) {
      timers.intervals[id - 1] = null
    },
    setTimeout(fn) {
      timers.timeouts.push(fn)
      return timers.timeouts.length
    },
  }
  if (debug !== undefined) window.STARTERS_DEBUG = debug

  const document = {
    readyState: 'complete',
    addEventListener() {},
    createElement: () => ({
      style: {},
      setAttribute() {},
      querySelector: () => null,
      querySelectorAll: () => [],
    }),
    // Deliberately strict: the module's selection selector is the whole opt-in
    // contract, so an unexpected one must fail loudly rather than quietly match no
    // forms and turn a targeting regression into a passing test.
    querySelectorAll(selector) {
      if (selector === 'form[data-starters-turnstile-fix]') {
        return forms.filter((form) => form.hasAttribute('data-starters-turnstile-fix'))
      }
      throw new Error('mini DOM: unexpected document selector ' + selector)
    },
  }

  // The module measures its budgets against the wall clock, so the fake clock has to
  // advance with the fake ticks or nothing ever times out.
  const clock = { now: 1_700_000_000_000 }

  const sandbox = {
    window,
    document,
    Date: { now: () => clock.now },
    console: {
      info: (...args) => logs.info.push(args.join(' ')),
      warn: (...args) => logs.warn.push(args.join(' ')),
      error: (...args) => logs.error.push(args.join(' ')),
    },
    MutationObserver: function () {},
  }
  sandbox.globalThis = sandbox

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: FILE })

  // Run every live interval callback `times` times, advancing the fake clock by one
  // poll interval each time, which is how a wait reaches its timeout without a real
  // clock. `stepMs` can be raised to model a throttled background tab.
  const tick = (times, stepMs = 100) => {
    for (let i = 0; i < times; i += 1) {
      clock.now += stepMs
      timers.intervals.slice().forEach((fn) => fn && fn())
    }
  }

  return { api: window.StartersTurnstileContentsFix, logs, tick, clock, window }
}

function classList() {
  const set = new Set()
  return {
    add: (name) => set.add(name),
    remove: (name) => set.delete(name),
    contains: (name) => set.has(name),
    has: (name) => set.has(name),
  }
}

/**
 * One `<button type="submit">`. `loadingWrap: true` gives it the site's
 * `[data-opp-element="loading-button"]` ancestor so the spinner-attribute restore is
 * exercised alongside the disabled restore.
 */
function submitButton({ name, disabled, loadingWrap = false }) {
  const wrap = loadingWrap
    ? {
        attrs: { 'data-opp-loading': 'false' },
        getAttribute(key) {
          return key in this.attrs ? this.attrs[key] : null
        },
        setAttribute(key, value) {
          this.attrs[key] = value
        },
      }
    : null
  return {
    name,
    tagName: 'BUTTON',
    disabled,
    wrap,
    classList: classList(),
    getAttribute: () => null,
    closest: (selector) =>
      selector === '[data-opp-element="loading-button"]' ? wrap : null,
  }
}

/**
 * A form the module is allowed to arm: marked, sitekey-bearing, computed
 * `display: contents`. Every test that expects a skip takes one of those three away.
 */
function contentsForm(id, buttons = [], { marked = true, display = 'contents', sitekey = '0xTESTKEY' } = {}) {
  const wrapper = { classList: { contains: () => true, add() {}, remove() {} }, children: [] }
  const attrs = {}
  if (marked) attrs['data-starters-turnstile-fix'] = ''
  if (sitekey !== null) attrs['data-turnstile-sitekey'] = sitekey
  return {
    id,
    buttons,
    listeners: [],
    submitted: 0,
    attrs,
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null
    },
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    hasAttribute(name) {
      return name in this.attrs
    },
    closest: () => wrapper,
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === 'input[type="submit"], button[type="submit"]' ? this.buttons : []
    },
    appendChild() {},
    addEventListener(type, fn) {
      this.listeners.push({ type, fn })
    },
    requestSubmit() {
      this.submitted += 1
    },
    ownerDocument: { defaultView: { getComputedStyle: () => ({ display }) } },
  }
}

/**
 * Boot the module against one armed form and hand back the pieces a guard test needs:
 * the captured capture-phase submit handler, the Webflow state object it writes
 * `turnstileToken` into, and the buttons whose state must survive a hold.
 */
function armedWorld({ buttons, hostname = 'the-starters-3-0.webflow.io' }) {
  const form = contentsForm('wf-form-Cancel-Membership', buttons)
  const state = { turnstileToken: null }
  const world = makeWorld({
    hostname,
    forms: [form],
    jquery: { data: () => state },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  const submit = form.listeners.find((l) => l.type === 'submit')
  assert.ok(submit, 'the guard must register a submit listener on the armed form')
  const fire = () => {
    const event = { prevented: false, stopped: false }
    event.preventDefault = () => {
      event.prevented = true
    }
    event.stopImmediatePropagation = () => {
      event.stopped = true
    }
    submit.fn(event)
    return event
  }
  return { ...world, form, state, fire }
}

/**
 * The labels of the forms the module actually armed, copied into this realm. `status()`
 * returns an array built inside the vm context, whose prototype is that context's
 * Array — strict deepEqual compares prototypes and would reject it against a plain
 * literal here even when the contents match.
 */
function armedForms(world) {
  return Array.from(world.api.status(), (entry) => entry.form)
}

/* --------------------------------- tests ---------------------------------- */

test('the @release header and the exposed release property cannot drift apart', () => {
  const header = source.match(/@release\s+(v\d+\.\d+\.\d+)/)
  assert.ok(header, 'the file header must carry an @release marker')
  const { api } = makeWorld({ hostname: 'thestarters.com' })
  assert.equal(api.release, header[1])
})

test('the file is raw browser JavaScript, not an embed', () => {
  assert.equal(/<\/?script/i.test(source), false, 'no <script> wrapper tags may appear')
  assert.match(source, /^\s*\/\*\*/, 'the file opens with its documentation block')
  assert.match(source, /;\(function \(\) \{\n\s+'use strict'/, 'the body is a strict-mode IIFE')
  assert.match(
    source,
    /if \(window\.__startersTurnstileContentsFixBooted\) return/,
    'the IIFE guards against a double load'
  )
})

test('jQuery is used for exactly one thing: reading Webflow state', () => {
  const uses = source.match(/jq\.[a-zA-Z]+|jQuery\.[a-zA-Z]+/g) || []
  const unique = Array.from(new Set(uses))
  assert.deepEqual(unique.sort(), ['jQuery.data', 'jq.data'].sort())
})

test('the staging gate accepts staging hosts and rejects production and lookalikes', () => {
  const { api } = makeWorld({ hostname: 'thestarters.com' })
  const staging = [
    'the-starters-3-0.webflow.io',
    'webflow.io',
    'localhost',
    '127.0.0.1',
    'quick-name.trycloudflare.com',
    'trycloudflare.com',
  ]
  const production = [
    'thestarters.com',
    'www.thestarters.com',
    'notwebflow.io',
    'evil-trycloudflare.com',
    'webflow.io.evil.com',
    '',
  ]
  staging.forEach((host) => assert.equal(api.stagingHost(host), true, host))
  production.forEach((host) => assert.equal(api.stagingHost(host), false, host))
})

test('STARTERS_DEBUG turns logging on without widening what counts as staging', () => {
  const { api } = makeWorld({ hostname: 'thestarters.com', debug: true })
  assert.equal(api.diagnosticsEnabled(), true)
  assert.equal(api.stagingHost('thestarters.com'), false)
})

test('production is completely silent — nothing to arm', () => {
  const { logs } = makeWorld({ hostname: 'thestarters.com' })
  assert.deepEqual(logs, { info: [], warn: [], error: [] })
})

test('production is completely silent — turnstile never loads', () => {
  const world = makeWorld({ hostname: 'thestarters.com', forms: [contentsForm('wf-form-X')] })
  world.tick(250)
  assert.deepEqual(world.logs, { info: [], warn: [], error: [] })
})

test('staging reports both of those cases', () => {
  const quiet = makeWorld({ hostname: 'the-starters-3-0.webflow.io' })
  assert.equal(quiet.logs.info.length, 1)
  assert.match(quiet.logs.info[0], /no form on this page is marked data-starters-turnstile-fix/)

  const waiting = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [contentsForm('wf-form-X')],
  })
  assert.match(waiting.logs.info[0], /1 marked display:contents form\(s\) to arm: wf-form-X/)
  waiting.tick(250)
  assert.equal(waiting.logs.warn.length, 1)
  assert.match(waiting.logs.warn[0], /window\.turnstile never appeared/)
  assert.match(waiting.logs.warn[0], /exactly as Webflow left them/)
})

/* ------------------------- opt-in targeting contract ---------------------- */

test('an UNMARKED display:contents turnstile form is never touched or mentioned', () => {
  const unmarked = contentsForm('wf-form-Unmarked', [], { marked: false })
  const world = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [unmarked],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })

  // Textbook case of the bug — and still none of this script's business.
  assert.equal(unmarked.getAttribute('data-starters-turnstile-armed'), null)
  assert.equal(unmarked.listeners.length, 0, 'no submit guard is installed')
  assert.deepEqual(armedForms(world), [])
  assert.deepEqual(world.logs.warn, [], 'an unmarked form must not generate noise either')
  assert.match(world.logs.info[0], /no form on this page is marked/)
})

test('a MARKED form that is eligible is armed', () => {
  const marked = contentsForm('wf-form-Marked')
  const world = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [marked],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  assert.equal(marked.getAttribute('data-starters-turnstile-armed'), 'true')
  assert.deepEqual(armedForms(world), ['wf-form-Marked'])
  assert.equal(marked.listeners.filter((l) => l.type === 'submit').length, 1)
  assert.deepEqual(world.logs.warn, [])
})

test('only the marked form is armed when a page holds both', () => {
  const marked = contentsForm('wf-form-Marked')
  const unmarked = contentsForm('wf-form-Unmarked', [], { marked: false })
  const world = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [unmarked, marked],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  assert.deepEqual(armedForms(world), ['wf-form-Marked'])
  assert.equal(unmarked.getAttribute('data-starters-turnstile-armed'), null)
})

test('a marked form with a real display box is skipped and warned about', () => {
  const flex = contentsForm('wf-form-Flex', [], { display: 'flex' })
  const world = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [flex],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  assert.deepEqual(armedForms(world), [], 'the no-double-arm invariant holds')
  assert.equal(flex.getAttribute('data-starters-turnstile-armed'), null)
  assert.equal(world.logs.warn.length, 1)
  assert.match(world.logs.warn[0], /wf-form-Flex is marked data-starters-turnstile-fix/)
  assert.match(world.logs.warn[0], /computed display is "flex", not "contents"/)
  assert.match(world.logs.warn[0], /Remove the marker/)
})

test('that warning fires once per form however often the page re-scans', () => {
  const flex = contentsForm('wf-form-Flex', [], { display: 'flex' })
  const world = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [flex],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  world.api.refresh()
  world.api.refresh()
  assert.equal(world.logs.warn.length, 1)
})

test('a marked form with no sitekey is skipped and warned about', () => {
  const noKey = contentsForm('wf-form-NoKey', [], { sitekey: null })
  const world = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [noKey],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  assert.deepEqual(armedForms(world), [])
  assert.match(world.logs.warn[0], /has no data-turnstile-sitekey value/)
})

test('data-wf-no-turnstile beats the marker, and says so', () => {
  const form = contentsForm('wf-form-OptedOut')
  form.attrs['data-wf-no-turnstile'] = ''
  const world = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [form],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  assert.deepEqual(armedForms(world), [])
  assert.match(world.logs.warn[0], /also carries data-wf-no-turnstile/)
  assert.match(world.logs.warn[0], /contradict/)
})

test('production stays silent about a mismarked form too', () => {
  const flex = contentsForm('wf-form-Flex', [], { display: 'flex' })
  const world = makeWorld({
    hostname: 'thestarters.com',
    forms: [flex],
    jquery: { data: () => ({ turnstileToken: null }) },
    turnstile: { render: () => 'cf-chl-widget-test', reset() {} },
  })
  assert.deepEqual(world.logs, { info: [], warn: [], error: [] })
})

test('a hold that ends with a token restores each button, it does not enable them all', () => {
  const clicked = submitButton({ name: 'tail-clicked', disabled: false, loadingWrap: true })
  const sibling = submitButton({ name: 'tail-sibling', disabled: true })
  const world = armedWorld({ buttons: [clicked, sibling] })

  // No token yet: the guard must swallow the submit rather than let it POST.
  const event = world.fire()
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(clicked.disabled, true, 'the clicked button shows as working')
  assert.equal(sibling.disabled, true)
  assert.equal(clicked.classList.has('w-form-loading'), true)
  assert.equal(clicked.wrap.getAttribute('data-opp-loading'), 'true')
  assert.equal(world.form.submitted, 0)

  // Token lands, the guard re-submits, and every borrowed piece of state goes back.
  world.state.turnstileToken = 'token-abc'
  world.tick(1)
  assert.equal(world.form.submitted, 1, 'the held submit is replayed once the token exists')
  assert.equal(clicked.disabled, false, 'the clicked tail is usable again')
  assert.equal(
    sibling.disabled,
    true,
    'a sibling tail disabled by wf-validate must NOT be enabled by the hold ending'
  )
  assert.equal(clicked.classList.has('w-form-loading'), false)
  assert.equal(clicked.wrap.getAttribute('data-opp-loading'), 'false')
})

test('a hold that times out restores the same way and never submits', () => {
  const clicked = submitButton({ name: 'tail-clicked', disabled: false })
  const sibling = submitButton({ name: 'tail-sibling', disabled: true })
  const world = armedWorld({ buttons: [clicked, sibling] })

  world.fire()
  assert.equal(clicked.disabled, true)

  // 10s budget at a 100ms poll: 100 ticks. No token ever arrives.
  world.tick(120)
  assert.equal(world.form.submitted, 0, 'a tokenless submit is never sent')
  assert.equal(clicked.disabled, false, 'the button is handed back so the member can retry')
  assert.equal(sibling.disabled, true, 'the disabled sibling is still disabled')
  assert.equal(clicked.classList.has('w-form-loading'), false)
  assert.match(world.logs.warn.join(' '), /no token for wf-form-Cancel-Membership after 10000ms/)
})

test('the hold budget is wall-clock, so a throttled tab still gives the button back', () => {
  const clicked = submitButton({ name: 'tail-clicked', disabled: false })
  const sibling = submitButton({ name: 'tail-sibling', disabled: true })
  const world = armedWorld({ buttons: [clicked, sibling] })

  world.fire()
  // A background tab clamps setInterval to roughly 1/s: 11 ticks, 11 seconds. Counting
  // ticks instead of milliseconds would still read as 1.1s here and hold on for ~100s.
  world.tick(11, 1000)
  assert.equal(clicked.disabled, false)
  assert.equal(sibling.disabled, true)
  assert.match(world.logs.warn.join(' '), /no token for .* after 10000ms/)
})

test('a second submit during a hold does not re-snapshot the borrowed button state', () => {
  const clicked = submitButton({ name: 'tail-clicked', disabled: false })
  const sibling = submitButton({ name: 'tail-sibling', disabled: true })
  const world = armedWorld({ buttons: [clicked, sibling] })

  world.fire()
  // Both buttons now read as disabled. A second click must not overwrite the snapshot
  // with that borrowed state, or the clicked tail would never come back.
  world.fire()
  world.state.turnstileToken = 'token-abc'
  world.tick(1)
  assert.equal(clicked.disabled, false)
  assert.equal(sibling.disabled, true)
})

test('refresh() before turnstile exists reports instead of arming', () => {
  const { api, logs } = makeWorld({
    hostname: 'the-starters-3-0.webflow.io',
    forms: [contentsForm('wf-form-X')],
  })
  assert.equal(api.refresh(), 0)
  assert.match(logs.warn[0], /refresh\(\) called before window\.turnstile exists/)
})
