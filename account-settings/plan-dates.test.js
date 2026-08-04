const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./plan-dates.js'), 'utf8')

/* ------------------------------ mini DOM ------------------------------ *
 * The module walks parentNode to inherit configuration attributes and writes
 * textContent, so flat element stubs cannot express what it does. This is a
 * small tree implementing exactly the surface the module touches. Only the
 * attribute selectors the module actually uses are supported; anything else
 * throws rather than silently matching nothing.
 * -------------------------------------------------------------------- */

/**
 * Selector support is deliberately narrow: `[attr-name]` and comma-separated tag
 * lists such as `input, select`, which is everything the module uses. Anything
 * else throws, so a future selector cannot silently match nothing and turn a
 * real regression into a passing test.
 */
function matcher(selector) {
  const parts = String(selector)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('mini DOM: empty selector')

  const tests = parts.map((part) => {
    const attr = /^\[([a-z-]+)\]$/.exec(part)
    if (attr) return (el) => el.hasAttribute(attr[1])
    if (/^[a-z]+$/.test(part)) {
      const tag = part.toUpperCase()
      return (el) => el.tagName === tag
    }
    throw new Error('mini DOM: unsupported selector ' + part)
  })

  return (el) => tests.some((t) => t(el))
}

class El {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.nodeType = 1
    this.attributes = Object.create(null)
    this.children = []
    this.parentNode = null
    this.textContent = ''

    const classes = new Set()
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    return this
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }

  hasAttribute(name) {
    return name in this.attributes
  }

  append(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  /** Depth-first self-and-descendants. */
  walk(out) {
    const acc = out || []
    acc.push(this)
    this.children.forEach((c) => c.walk(acc))
    return acc
  }

  /** Descendants only, matching the real querySelectorAll contract. */
  querySelectorAll(selector) {
    const test = matcher(selector)
    return this.walk()
      .slice(1)
      .filter(test)
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  /** Self-or-nearest-ancestor match, as the module's change delegate relies on. */
  closest(selector) {
    const test = matcher(selector)
    let node = this
    while (node) {
      if (node.nodeType === 1 && test(node)) return node
      node = node.parentNode
    }
    return null
  }
}

/** A radio in a Webflow-shaped `.w-radio` label wrapper. */
function radio(name, value, checked) {
  const label = new El('label').setAttribute('class', 'w-radio')
  const input = new El('input')
  input.type = 'radio'
  input.name = name
  input.value = value
  input.checked = !!checked
  label.append(input)
  return { label, input }
}

/** Move the checked flag within a group and fire the delegated change handler. */
function check(group, input, fireOn) {
  group.forEach((r) => {
    r.input.checked = r.input === input
  })
  if (fireOn) fireOn({ target: input })
}

function makeDocument(root, readyState, listeners) {
  return {
    readyState: readyState || 'complete',
    addEventListener(type, fn) {
      if (listeners) (listeners[type] = listeners[type] || []).push(fn)
    },
    querySelectorAll(selector) {
      const test = matcher(selector)
      return root ? root.walk().filter(test) : []
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null
    },
  }
}

/** Instantiate the module in a fresh sandbox and hand back its public API. */
function load(options) {
  const opts = options || {}
  const warnings = []
  const timers = []
  const listeners = {}

  const sandbox = {
    console: {
      warn(...args) {
        warnings.push(args.join(' '))
      },
      log() {},
    },
    setTimeout(fn) {
      timers.push(fn)
      return timers.length
    },
    clearTimeout() {},
    Date,
    isFinite,
    Number,
    String,
    Math,
    RegExp,
    Promise,
    JSON,
    Object,
    Array,
  }

  sandbox.window = sandbox
  sandbox.window.location = { hostname: opts.hostname || 'www.thestarters.com' }
  if (opts.debug !== undefined) sandbox.window.STARTERS_DEBUG = opts.debug
  if (opts.memberstack) sandbox.window.$memberstackDom = opts.memberstack
  sandbox.window.addEventListener = () => {}
  sandbox.document = makeDocument(opts.root || null, opts.readyState, listeners)

  vm.createContext(sandbox)
  new vm.Script(source).runInContext(sandbox)

  return {
    api: sandbox.window.StartersPlanDates,
    warnings,
    timers,
    listeners,
    window: sandbox.window,
    /** Fire the module's delegated change handler(s). */
    change: (event) => (listeners.change || []).forEach((fn) => fn(event)),
    flush: () => timers.splice(0).forEach((fn) => fn()),
  }
}

/* --------------------------- the format contract -------------------------- */

test('every accepted input shape formats as "Jan 10, 2000"', () => {
  const { api } = load()
  const expected = 'Jan 10, 2000'
  const jan10 = Date.UTC(2000, 0, 10)

  assert.equal(api.formatDate('2000-01-10T18:57:35.143Z'), expected, 'ISO string')
  assert.equal(api.formatDate(jan10 / 1000), expected, 'Unix seconds')
  assert.equal(api.formatDate(jan10), expected, 'Unix milliseconds')
  assert.equal(api.formatDate(String(jan10 / 1000)), expected, 'stringified seconds')
  assert.equal(api.formatDate(new Date(jan10)), expected, 'Date object')
})

test('a seconds timestamp is not read as milliseconds (the 1970 bug)', () => {
  const { api } = load()
  // 947462400 as raw ms would be Jan 12 1970; it must be read as seconds.
  assert.equal(api.formatDate(947462400), 'Jan 10, 2000')
  assert.equal(api.toDate(947462400).getUTCFullYear(), 2000)
})

test('unresolvable values format as the empty string, never "Invalid Date"', () => {
  const { api } = load()
  for (const value of [null, undefined, '', 'not a date', NaN, Infinity, {}, []]) {
    assert.equal(api.formatDate(value), '', 'for ' + JSON.stringify(String(value)))
  }
})

test('the day is not zero-padded in the default format', () => {
  const { api } = load()
  assert.equal(api.formatDate('2000-01-05T00:00:00Z'), 'Jan 5, 2000')
})

test('there is exactly one output shape and no way to ask for another', () => {
  const { api } = load()
  const jan10 = '2000-01-10T00:00:00Z'
  assert.equal(api.formatDate(jan10), 'Jan 10, 2000')
  // The removed `-format` presets used to arrive as extra arguments. Any caller
  // still passing them must get the one shape, not a silent second format.
  assert.equal(api.formatDate(jan10, 'long'), 'Jan 10, 2000')
  assert.equal(api.formatDate(jan10, 'iso'), 'Jan 10, 2000')
})

test('formatting is UTC and cannot be overridden per element', () => {
  const { api } = load()
  // 2000-01-10T02:00Z is still Jan 9 in Los Angeles; UTC must win, always.
  const instant = '2000-01-10T02:00:00Z'
  assert.equal(api.formatDate(instant), 'Jan 10, 2000')
  assert.equal(
    api.formatDate(instant, 'medium', 'America/Los_Angeles'),
    'Jan 10, 2000',
    'a zone override must not be honoured — it desynced addMonths from formatting'
  )
})

test('next-billing and resumes-at stay in the same zone as each other', () => {
  // The regression the `-tz` removal fixes: 2026-03-01T00:00Z formatted in
  // America/Los_Angeles printed "Feb 28" beside a one-month "Mar 31" — 31 days
  // for a one-month choice. Both fields must agree on the calendar.
  const { api } = load()
  const m = member([
    Object.assign({}, PAID, {
      payment: Object.assign({}, PAID.payment, { nextBillingDate: Date.UTC(2026, 2, 1) / 1000 }),
    }),
  ])
  assert.equal(api.formatDate(api.resolveField(m, 'next-billing')), 'Mar 1, 2026')
  assert.equal(
    api.formatDate(api.resolveField(m, 'resumes-at', { pauseMonths: 1 })),
    'Apr 1, 2026'
  )
})

/* ------------------------------- addMonths -------------------------------- */

test('addMonths clamps the day instead of overflowing into the next month', () => {
  const { api } = load()
  const cases = [
    ['2026-01-31T00:00:00Z', 1, 'Feb 28, 2026'], // plain setMonth would give Mar 3
    ['2026-08-31T00:00:00Z', 1, 'Sep 30, 2026'],
    ['2028-01-31T00:00:00Z', 1, 'Feb 29, 2028'], // leap year keeps the 29th
    ['2026-12-15T00:00:00Z', 1, 'Jan 15, 2027'], // year rollover
    ['2026-08-20T00:00:00Z', 3, 'Nov 20, 2026'],
    ['2026-08-20T00:00:00Z', 0, 'Aug 20, 2026'],
  ]
  for (const [from, months, expected] of cases) {
    assert.equal(api.formatDate(api.addMonths(from, months)), expected, from + ' + ' + months)
  }
})

test('addMonths returns null for an unresolvable date or count', () => {
  const { api } = load()
  assert.equal(api.addMonths(null, 1), null)
  assert.equal(api.addMonths('nonsense', 1), null)
  assert.equal(api.addMonths('2026-01-01T00:00:00Z', 'abc'), null)
})

test('a clamped month is not a fixed number of days', () => {
  // Worth stating even without a daysBetween helper (removed as dead code): a
  // "one month" pause is 31 days from Aug 20 and 28 from Feb 1.
  const { api } = load()
  const span = (from) => (api.addMonths(from, 1).getTime() - new Date(from).getTime()) / 86400000
  assert.equal(span('2026-08-20T00:00:00Z'), 31)
  assert.equal(span('2026-02-01T00:00:00Z'), 28)
})

/* ---------------------------- plan connections ---------------------------- */

const FREE = { id: 'con_free', active: true, status: 'ACTIVE', planId: 'pln_free', type: 'FREE', payment: null }
const PAID = {
  id: 'con_paid',
  active: true,
  status: 'ACTIVE',
  planId: 'pln_paid',
  planName: 'Brand Paid',
  type: 'PAYMENT',
  payment: {
    amount: 9900,
    currency: 'usd',
    status: 'ACTIVE',
    lastBillingDate: Date.UTC(2026, 6, 20) / 1000,
    nextBillingDate: Date.UTC(2026, 7, 20) / 1000,
  },
}

function member(connections, createdAt) {
  return {
    id: 'mem_test',
    auth: { email: 'jerico@hirethestarters.com' },
    createdAt: createdAt || '2000-01-10T18:57:35.143Z',
    planConnections: connections || [],
  }
}

test('the paid connection wins even when a free one is listed first', () => {
  const { api } = load()
  assert.equal(api.pickConnection(member([FREE, PAID])).id, 'con_paid')
  assert.equal(api.pickConnection(member([PAID, FREE])).id, 'con_paid')
})

test('a free-only member falls back to the active free connection', () => {
  const { api } = load()
  assert.equal(api.pickConnection(member([FREE])).id, 'con_free')
})

test('inactive connections are never picked', () => {
  const { api } = load()
  const cancelled = Object.assign({}, PAID, { active: false })
  assert.equal(api.pickConnection(member([cancelled])), null)
})

test('pickConnection ignores a second argument (the removed planId pin)', () => {
  // `ms-form-pause-id` was cut as unrequested. A stale caller passing a plan id
  // must not silently change which connection is read.
  const { api } = load()
  assert.equal(api.pickConnection(member([FREE, PAID]), 'pln_free').id, 'con_paid')
})

test('no member and no connections both resolve to null', () => {
  const { api } = load()
  assert.equal(api.pickConnection(null), null)
  assert.equal(api.pickConnection(member([])), null)
})

/* ------------------------------ field resolve ----------------------------- */

test('each field resolves off the paid connection', () => {
  const { api } = load()
  const m = member([FREE, PAID])
  // Array.from: the module's arrays are built inside the vm realm, so their
  // prototype is not this realm's Array and strict deepEqual rejects them.
  assert.deepEqual(Array.from(api.fields), ['signup', 'next-billing', 'resumes-at'])
  assert.equal(api.formatDate(api.resolveField(m, 'signup')), 'Jan 10, 2000')
  assert.equal(api.formatDate(api.resolveField(m, 'next-billing')), 'Aug 20, 2026')
  assert.equal(
    api.formatDate(api.resolveField(m, 'resumes-at', { pauseMonths: 1 })),
    'Sep 20, 2026',
    'resumes-at defaults to the next-billing anchor'
  )
})

test('resumes-at is anchored on next-billing and not on the signup date', () => {
  const { api } = load()
  // Signup Jan 10 2000 + 1 month would be Feb 10 2000 — a five-figure day count
  // away from the right answer. Guards the whole reason this module exists.
  const resumes = api.formatDate(api.resolveField(member([PAID]), 'resumes-at', { pauseMonths: 1 }))
  assert.equal(resumes, 'Sep 20, 2026')
  assert.notEqual(resumes, 'Feb 10, 2000')
})

test('a free-only member has no billing date but still has a signup date', () => {
  const { api } = load()
  const m = member([FREE])
  assert.equal(api.formatDate(api.resolveField(m, 'signup')), 'Jan 10, 2000')
  assert.equal(api.resolveField(m, 'next-billing'), null)
  assert.equal(api.resolveField(m, 'resumes-at', { pauseMonths: 1 }), null)
})

test('an absent date renders the empty text without a bogus typo warning', () => {
  // A member with no paid connection legitimately has no next-billing date. That
  // must read as "no date" (null), never as "unknown field" (undefined), or
  // staging warns the author about a misspelling they never made. Guards orNull().
  const { api, warnings } = load({ hostname: 'localhost' })
  assert.equal(api.resolveField(member([FREE]), 'next-billing'), null)
  const el = target('next-billing')
  api.renderElement(el, member([FREE]))
  assert.equal(el.textContent, '—')
  assert.deepEqual(warnings, [], 'a member on a free plan is not an authoring error')
})

test('an unknown field name is distinguishable from a genuinely absent date', () => {
  const { api } = load()
  assert.equal(api.resolveField(member([PAID]), 'bogus-field'), undefined, 'unknown field')
  assert.equal(api.resolveField(member([FREE]), 'next-billing'), null, 'absent date')
})

/* ------------------------------- DOM render ------------------------------- */

function target(field) {
  return new El('span').setAttribute('ms-form-pause-date', field)
}

test('renderElement writes the formatted date into textContent', () => {
  const { api } = load()
  const el = target('next-billing')
  api.renderElement(el, member([PAID]))
  assert.equal(el.textContent, 'Aug 20, 2026')
})

test('a logged-out visitor gets the em-dash default, not a stale or broken date', () => {
  const { api } = load()
  const el = target('next-billing')
  el.textContent = 'Aug 20, 2026'
  api.renderElement(el, null)
  assert.equal(el.textContent, '—')
})

test('ms-form-pause-empty overrides the fallback text', () => {
  const { api } = load()
  const el = target('next-billing').setAttribute('ms-form-pause-empty', 'No active plan')
  api.renderElement(el, member([FREE]))
  assert.equal(el.textContent, 'No active plan')
})

test('config attributes are inherited from an ancestor wrapper', () => {
  const { api } = load()
  const wrapper = new El('div')
    .setAttribute('ms-form-pause-months', '3')
    .setAttribute('ms-form-pause-empty', 'not available')
  const el = wrapper.append(target('resumes-at'))
  api.renderElement(el, member([PAID]))
  assert.equal(el.textContent, 'Nov 20, 2026')

  const freeEl = wrapper.append(target('resumes-at'))
  api.renderElement(freeEl, member([FREE]))
  assert.equal(freeEl.textContent, 'not available', 'the wrapper empty text is inherited too')
})

test('an attribute on the element beats the same one on the wrapper', () => {
  const { api } = load()
  const wrapper = new El('div').setAttribute('ms-form-pause-months', '3')
  const el = wrapper.append(target('resumes-at').setAttribute('ms-form-pause-months', '1'))
  api.renderElement(el, member([PAID]))
  assert.equal(el.textContent, 'Sep 20, 2026')
})

/* ------------------------------ resumes-at anchor ------------------------- */

test('the literal ask — signup + N months — is reachable', () => {
  // The originating request was "signup date + 1 month if they pause for one
  // month". An earlier revision hardcoded the next-billing anchor and left no
  // way to express this at all. ms-form-pause-anchor="signup" restores it.
  const { api } = load()
  const el = target('resumes-at')
    .setAttribute('ms-form-pause-anchor', 'signup')
    .setAttribute('ms-form-pause-months', '1')
  api.renderElement(el, member([PAID]))
  assert.equal(el.textContent, 'Feb 10, 2000', 'signup Jan 10 2000 + 1 month')
})

test('the anchor defaults to next-billing and is inherited from a wrapper', () => {
  const { api } = load()
  const plain = target('resumes-at')
  api.renderElement(plain, member([PAID]))
  assert.equal(plain.textContent, 'Sep 20, 2026', 'default anchor')

  const wrapper = new El('div').setAttribute('ms-form-pause-anchor', 'signup')
  const inherited = wrapper.append(target('resumes-at'))
  api.renderElement(inherited, member([PAID]))
  assert.equal(inherited.textContent, 'Feb 10, 2000')
})

test('a signup anchor is the only one that resolves for a free-plan member', () => {
  const { api } = load()
  const free = member([FREE])

  const onNextBilling = target('resumes-at')
  api.renderElement(onNextBilling, free)
  assert.equal(onNextBilling.textContent, '—', 'no paid connection, no next-billing')

  const onSignup = target('resumes-at').setAttribute('ms-form-pause-anchor', 'signup')
  api.renderElement(onSignup, free)
  assert.equal(onSignup.textContent, 'Feb 10, 2000')
})

test('an unknown anchor warns on staging and falls back to next-billing', () => {
  const { api, warnings } = load({ hostname: 'localhost' })
  const el = target('resumes-at').setAttribute('ms-form-pause-anchor', 'subscription-start')
  api.renderElement(el, member([PAID]))
  assert.equal(el.textContent, 'Sep 20, 2026')
  assert.ok(
    warnings.some((w) => w.includes('ms-form-pause-anchor') && w.includes('next-billing')),
    'expected an anchor warning naming the fallback, got: ' + JSON.stringify(warnings)
  )
  assert.deepEqual(Array.from(api.anchors), ['next-billing', 'signup'])
})

test('the anchor composes with a radio-chosen pause length', () => {
  const page = pauseGroupPage(2) // 3 months checked
  page.out.setAttribute('ms-form-pause-anchor', 'signup')
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.out.textContent, 'Apr 10, 2000', 'signup Jan 10 2000 + 3 months')
})

test('a bad pause value falls back to one month and warns on staging', () => {
  const { api, warnings } = load({ hostname: 'the-starters-3-0.webflow.io' })
  const el = target('resumes-at').setAttribute('ms-form-pause-months', 'abc')
  api.renderElement(el, member([PAID]))
  assert.equal(el.textContent, 'Sep 20, 2026')
  assert.ok(
    warnings.some((w) => w.includes('ms-form-pause-months')),
    'expected a pause warning, got: ' + JSON.stringify(warnings)
  )
})

test('an unknown field warns and renders the empty text', () => {
  const { api, warnings } = load({ hostname: 'localhost' })
  const el = target('nextbilling') // plausible typo: missing the hyphen
  api.renderElement(el, member([PAID]))
  assert.equal(el.textContent, '—')
  assert.ok(warnings.some((w) => w.includes('nextbilling')))
})

test('renderAll writes every tagged element in the tree', () => {
  const root = new El('div')
  root.append(target('signup'))
  root.append(target('next-billing'))
  const nested = root.append(new El('div'))
  nested.append(target('resumes-at'))
  root.append(new El('span')) // untagged: must be left alone

  const { api } = load({ root })
  assert.equal(api.renderAll(member([PAID])), 3)
  const texts = root.walk().filter((el) => el.hasAttribute('ms-form-pause-date')).map((el) => el.textContent)
  assert.deepEqual(texts, ['Jan 10, 2000', 'Aug 20, 2026', 'Sep 20, 2026'])
})

/* --------------------------- boot and diagnostics ------------------------- */

test('boot renders from Memberstack and re-renders on auth change', async () => {
  const root = new El('div')
  const el = root.append(target('next-billing'))
  let authHandler = null

  const { flush } = load({
    root,
    memberstack: {
      getCurrentMember: () => Promise.resolve({ data: member([PAID]) }),
      onAuthChange: (fn) => {
        authHandler = fn
      },
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(el.textContent, 'Aug 20, 2026', 'first paint')

  assert.equal(typeof authHandler, 'function', 'onAuthChange was wired')
  authHandler(null)
  assert.equal(el.textContent, '—', 'logout clears the date')
  flush()
})

test('a failed getCurrentMember renders the empty text instead of leaving stale dates', async () => {
  const root = new El('div')
  const el = root.append(target('next-billing'))
  el.textContent = 'Aug 20, 2026'

  load({
    root,
    hostname: 'localhost',
    memberstack: {
      getCurrentMember: () => Promise.reject(new Error('network')),
      onAuthChange: () => {},
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(el.textContent, '—')
})

test('a page with no tagged elements never touches Memberstack', () => {
  let called = false
  load({
    root: new El('div'),
    memberstack: {
      getCurrentMember: () => {
        called = true
        return Promise.resolve({ data: null })
      },
      onAuthChange: () => {},
    },
  })
  assert.equal(called, false)
})

test('the module boots once per page', () => {
  const root = new El('div')
  const first = load({ root })
  assert.ok(first.api, 'first run exports the API')
  // A second evaluation in the same window must early-return on the boot guard.
  const before = first.window.StartersPlanDates
  new vm.Script(source).runInContext(first.window)
  assert.equal(first.window.StartersPlanDates, before, 'API object was not replaced')
})

test('diagnostics are silent in production and on lookalike hosts', () => {
  for (const host of ['www.thestarters.com', 'thestarters.com', 'notwebflow.io', 'evil-trycloudflare.com']) {
    const { api, warnings } = load({ hostname: host })
    api.renderElement(target('bogus-field'), member([PAID]))
    assert.equal(api.diagnosticsEnabled(), false, host + ' must not read as staging')
    assert.deepEqual(warnings, [], host + ' must stay silent')
  }
})

test('diagnostics are on for staging hosts and for the debug override', () => {
  for (const host of ['the-starters-3-0.webflow.io', 'localhost', '127.0.0.1', 'abc.trycloudflare.com']) {
    assert.equal(load({ hostname: host }).api.diagnosticsEnabled(), true, host)
  }
  assert.equal(load({ hostname: 'www.thestarters.com', debug: true }).api.diagnosticsEnabled(), true)
})

/* -------------------------- pause length from radios ---------------------- */

test('parseMonths reads a bare count and a unit-suffixed one alike', () => {
  const { api } = load()
  assert.equal(api.parseMonths('2'), 2)
  assert.equal(api.parseMonths('2 months'), 2, 'a Webflow value is as likely to carry the unit')
  assert.equal(api.parseMonths('1 month'), 1)
  assert.equal(api.parseMonths(3), 3)
  assert.equal(api.parseMonths('0'), 0, 'zero is an answer, not an absence')
  for (const junk of [null, undefined, '', 'months', 'abc']) {
    assert.equal(api.parseMonths(junk), null, JSON.stringify(String(junk)))
  }
})

test('a blank Designer Value falls back to the label text', () => {
  // Webflow only emits a radio's `value` when the author fills Radio Settings ->
  // Value. A group whose options merely READ "1/2/3 months" reports "" or "on",
  // which used to be indistinguishable from "nothing chosen": the date stuck on
  // the default and a reveal wrapper stayed permanently invisible, silently.
  for (const blank of ['', 'on']) {
    const root = new El('div')
    const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
    const r = radio('pause', blank, true)
    r.label.textContent = '3 months'
    wrapper.append(r.label)
    const out = root.append(target('resumes-at'))

    const { api } = load({ root })
    api.renderAll(member([PAID]))
    assert.equal(out.textContent, 'Nov 20, 2026', 'value=' + JSON.stringify(blank))
  }
})

test('the label fallback still ignores an UNCHECKED option', () => {
  const root = new El('div')
  const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
  const r = radio('pause', '', false)
  r.label.textContent = '3 months'
  wrapper.append(r.label)
  const out = root.append(target('resumes-at'))

  const { api } = load({ root })
  api.renderAll(member([PAID]))
  assert.equal(out.textContent, 'Sep 20, 2026', 'nothing chosen: the default, not the label')
})

test('a selected control with no month count anywhere warns by name', () => {
  const root = new El('div')
  const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
  const r = radio('pause', '', true)
  r.label.textContent = 'Pause my membership'
  wrapper.append(r.label)
  const out = root.append(target('resumes-at'))

  const { api, warnings } = load({ root, hostname: 'localhost' })
  api.renderAll(member([PAID]))
  assert.equal(out.textContent, 'Sep 20, 2026', 'falls back to one month')
  assert.ok(
    warnings.some((w) => w.includes('ms-form-pause-input') && w.includes('no month count')),
    'expected an authoring warning, got: ' + JSON.stringify(warnings)
  )
})

test('a blank-value group still reveals its wrapper via the label fallback', () => {
  // End-to-end version of the silent-blank failure: with ms-form-pause-reveal the
  // old behaviour left the sentence invisible forever with nothing in the console.
  const root = new El('div')
  const groupWrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
  const r = radio('pause', '', true)
  r.label.textContent = '2 months'
  groupWrapper.append(r.label)
  const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-reveal', '')
  const date = wrapper.append(target('resumes-at'))

  const { api } = load({ root })
  api.renderAll(member([PAID]))
  assert.equal(date.textContent, 'Oct 20, 2026')
  assert.equal(wrapper.classList.contains('is-ms-form-pause-shown'), true)
})

/** A wrapper-marked 1/2/3-month radio group plus a resumes-at output. */
function pauseGroupPage(checkedIndex, markInputs) {
  const root = new El('div')
  const wrapper = root.append(new El('div'))
  if (!markInputs) wrapper.setAttribute('ms-form-pause-input', '')

  const group = ['1 month', '2 months', '3 months'].map((value, i) => {
    const r = radio('pause', value, i === checkedIndex)
    if (markInputs) r.input.setAttribute('ms-form-pause-input', '')
    wrapper.append(r.label)
    return r
  })

  const out = root.append(target('resumes-at'))
  return { root, wrapper, group, out }
}

test('the checked radio drives resumes-at', () => {
  for (const [index, expected] of [[0, 'Sep 20, 2026'], [1, 'Oct 20, 2026'], [2, 'Nov 20, 2026']]) {
    const page = pauseGroupPage(index)
    const { api } = load({ root: page.root })
    api.renderAll(member([PAID]))
    assert.equal(page.out.textContent, expected, 'option ' + index)
  }
})

test('marking each input works as well as marking the wrapper', () => {
  const page = pauseGroupPage(2, true)
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.out.textContent, 'Nov 20, 2026')
})

test('an unchecked radio is not read, so option order cannot decide the answer', () => {
  // Third option checked; a naive read of the first input would say 1 month.
  const page = pauseGroupPage(2)
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.out.textContent, 'Nov 20, 2026')
  assert.notEqual(page.out.textContent, 'Sep 20, 2026')
})

test('with nothing checked the static attribute still renders a date', () => {
  const page = pauseGroupPage(-1)
  page.out.setAttribute('ms-form-pause-months', '2')
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.out.textContent, 'Oct 20, 2026', 'falls back rather than blanking')
})

test('with nothing checked and no static attribute it falls back to one month', () => {
  const page = pauseGroupPage(-1)
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.out.textContent, 'Sep 20, 2026')
})

test('a checked radio beats the static attribute', () => {
  const page = pauseGroupPage(2)
  page.out.setAttribute('ms-form-pause-months', '1')
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.out.textContent, 'Nov 20, 2026', 'the member picked 3 months')
})

test('changing the radio re-renders without a second Memberstack call', async () => {
  const page = pauseGroupPage(0)
  let calls = 0

  const { change } = load({
    root: page.root,
    memberstack: {
      getCurrentMember: () => {
        calls += 1
        return Promise.resolve({ data: member([PAID]) })
      },
      onAuthChange: () => {},
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.out.textContent, 'Sep 20, 2026', 'first paint uses the pre-checked option')
  assert.equal(calls, 1)

  check(page.group, page.group[2].input, change)
  assert.equal(page.out.textContent, 'Nov 20, 2026', 'radio change re-rendered')
  assert.equal(calls, 1, 'the member did not change, so no round trip')

  check(page.group, page.group[1].input, change)
  assert.equal(page.out.textContent, 'Oct 20, 2026')
  assert.equal(calls, 1)
})

test('a change on an unrelated input does not disturb the rendered date', async () => {
  const page = pauseGroupPage(1)
  const stray = page.root.append(new El('input'))
  stray.type = 'text'
  stray.value = 'hello'

  const { change } = load({
    root: page.root,
    memberstack: {
      getCurrentMember: () => Promise.resolve({ data: member([PAID]) }),
      onAuthChange: () => {},
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.out.textContent, 'Oct 20, 2026')
  change({ target: stray })
  assert.equal(page.out.textContent, 'Oct 20, 2026')
})

test('two independent pause groups each drive the output nested inside them', () => {
  const root = new El('div')

  function scope(checkedIndex) {
    const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
    ;['1 month', '2 months', '3 months'].forEach((value, i) => {
      wrapper.append(radio('pause' + checkedIndex, value, i === checkedIndex).label)
    })
    return wrapper.append(target('resumes-at'))
  }

  const first = scope(0)
  const second = scope(2)

  const { api } = load({ root })
  api.renderAll(member([PAID]))
  assert.equal(first.textContent, 'Sep 20, 2026')
  assert.equal(second.textContent, 'Nov 20, 2026', 'the nearer group wins over the other one')
})

test('an unanswered group does not borrow a sibling group\'s checked option', () => {
  // The nearest enclosing group owns the answer, including "nothing chosen".
  // Falling through to a common ancestor finds group A's radio and prints its
  // months under group B — which looks right on any page with only one group.
  const root = new El('div')

  function block(checkedIndex, name) {
    const outer = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
    ;['1 month', '2 months', '3 months'].forEach((value, i) => {
      outer.append(radio(name, value, i === checkedIndex).label)
    })
    return outer.append(target('resumes-at'))
  }

  const chosen = block(2, 'a')
  const untouched = block(-1, 'b')

  const { api } = load({ root })
  api.renderAll(member([PAID]))
  assert.equal(chosen.textContent, 'Nov 20, 2026', 'group A picked 3 months')
  assert.equal(untouched.textContent, 'Sep 20, 2026', 'group B falls back to one month')
  assert.notEqual(untouched.textContent, 'Nov 20, 2026', "not group A's answer")
})

test('a select and a number input work as pause controls too', () => {
  for (const [tag, type, value, expected] of [
    ['select', undefined, '3 months', 'Nov 20, 2026'],
    ['input', 'number', '2', 'Oct 20, 2026'],
  ]) {
    const root = new El('div')
    const control = root.append(new El(tag)).setAttribute('ms-form-pause-input', '')
    if (type) control.type = type
    control.value = value
    const out = root.append(target('resumes-at'))

    const { api } = load({ root })
    api.renderAll(member([PAID]))
    assert.equal(out.textContent, expected, tag + ' ' + (type || ''))
  }
})

test('the pause radios never affect a field that is not resumes-at', () => {
  const page = pauseGroupPage(2)
  const nextBilling = page.root.append(target('next-billing'))
  const signup = page.root.append(target('signup'))

  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(nextBilling.textContent, 'Aug 20, 2026')
  assert.equal(signup.textContent, 'Jan 10, 2000')
  assert.equal(page.out.textContent, 'Nov 20, 2026')
})

/* ------------------------------ reveal wrapper ---------------------------- */

const SHOWN = 'is-ms-form-pause-shown'

/**
 * A reveal wrapper holding one sentence with an inline resumes-at date, plus a
 * 1/2/3-month radio group as a sibling — the shape the page actually uses.
 */
function revealPage(checkedIndex) {
  const root = new El('div')

  const groupWrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
  const group = ['1 month', '2 months', '3 months'].map((value, i) => {
    const r = radio('pause', value, i === checkedIndex)
    groupWrapper.append(r.label)
    return r
  })

  const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-reveal', '')
  const sentence = wrapper.append(new El('p'))
  const date = sentence.append(target('resumes-at'))

  return { root, group, wrapper, sentence, date }
}

test('the wrapper stays hidden until an option is selected', () => {
  const page = revealPage(-1)
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.wrapper.classList.contains(SHOWN), false)
})

test('selecting an option reveals the wrapper and fills the date', () => {
  const page = revealPage(1)
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.wrapper.classList.contains(SHOWN), true)
  assert.equal(page.date.textContent, 'Oct 20, 2026')
})

test('"not chosen yet" and "chose one month" are told apart, not conflated', () => {
  // Both resolve to a one-month pause, so the reveal test has to read the SOURCE
  // of the answer rather than its value.
  const notChosen = revealPage(-1)
  const choseOne = revealPage(0)

  const a = load({ root: notChosen.root })
  a.api.renderAll(member([PAID]))
  const b = load({ root: choseOne.root })
  b.api.renderAll(member([PAID]))

  assert.equal(notChosen.date.textContent, 'Sep 20, 2026', 'both compute one month')
  assert.equal(choseOne.date.textContent, 'Sep 20, 2026')
  assert.equal(notChosen.wrapper.classList.contains(SHOWN), false, 'but only one reveals')
  assert.equal(choseOne.wrapper.classList.contains(SHOWN), true)
})

test('a static months attribute does not count as the member choosing', () => {
  const page = revealPage(-1)
  page.wrapper.setAttribute('ms-form-pause-months', '2')
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.date.textContent, 'Oct 20, 2026', 'the fallback still renders')
  assert.equal(page.wrapper.classList.contains(SHOWN), false, 'but the block stays hidden')
})

test('an unresolvable date keeps the wrapper hidden even with an option selected', () => {
  for (const [label, m] of [
    ['logged out', null],
    ['free plan only', member([FREE])],
  ]) {
    const page = revealPage(2)
    const { api } = load({ root: page.root })
    api.renderAll(m)
    assert.equal(page.date.textContent, '—', label + ' renders the empty text')
    assert.equal(
      page.wrapper.classList.contains(SHOWN),
      false,
      label + ' must not reveal "Billing resumes —"'
    )
  }
})

test('changing the option reveals, and logging out hides again', async () => {
  const page = revealPage(-1)
  let authHandler = null

  const { change } = load({
    root: page.root,
    memberstack: {
      getCurrentMember: () => Promise.resolve({ data: member([PAID]) }),
      onAuthChange: (fn) => {
        authHandler = fn
      },
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.wrapper.classList.contains(SHOWN), false, 'nothing picked yet')

  check(page.group, page.group[2].input, change)
  assert.equal(page.wrapper.classList.contains(SHOWN), true, 'picked 3 months')
  assert.equal(page.date.textContent, 'Nov 20, 2026')

  authHandler(null)
  assert.equal(page.wrapper.classList.contains(SHOWN), false, 'logout re-hides the sentence')
  assert.equal(page.date.textContent, '—')
})

test('a wrapper that is also the date element is governed by its own value', () => {
  // querySelectorAll is descendants-only, so without the self check this wrapper
  // would count as governing zero dates and reveal on an unresolved value.
  const root = new El('div')
  const groupWrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
  ;['1 month', '2 months'].forEach((value, i) => {
    groupWrapper.append(radio('pause', value, i === 0).label)
  })
  const combined = root
    .append(new El('span'))
    .setAttribute('ms-form-pause-reveal', '')
    .setAttribute('ms-form-pause-date', 'resumes-at')

  const withPlan = load({ root })
  withPlan.api.renderAll(member([PAID]))
  assert.equal(combined.classList.contains(SHOWN), true)
  assert.equal(combined.textContent, 'Sep 20, 2026')

  const freeOnly = load({ root })
  freeOnly.api.renderAll(member([FREE]))
  assert.equal(combined.classList.contains(SHOWN), false, 'its own date did not resolve')
})

test('a wrapper containing no date element rests on the selection alone', () => {
  const root = new El('div')
  const groupWrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
  const group = ['1 month', '2 months'].map((value, i) => {
    const r = radio('pause', value, false)
    groupWrapper.append(r.label)
    return r
  })
  const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-reveal', '')
  wrapper.append(new El('p')).textContent = 'Static copy, no date.'

  const { api, change } = load({ root })
  api.renderAll(member([PAID]))
  assert.equal(wrapper.classList.contains(SHOWN), false)

  check(group, group[1].input, change)
  assert.equal(wrapper.classList.contains(SHOWN), true)
})

test('every governed date must resolve, not just one of them', () => {
  const page = revealPage(0)
  const cancel = page.sentence.append(target('cancel-at')) // absent on this member
  const { api } = load({ root: page.root })
  api.renderAll(member([PAID]))
  assert.equal(page.date.textContent, 'Sep 20, 2026')
  assert.equal(cancel.textContent, '—')
  assert.equal(page.wrapper.classList.contains(SHOWN), false, 'one unresolved date is enough')
})

test('two reveal wrappers are governed by the group each is nested inside', () => {
  const root = new El('div')

  function block(checkedIndex, name) {
    const outer = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
    ;['1 month', '2 months', '3 months'].forEach((value, i) => {
      outer.append(radio(name, value, i === checkedIndex).label)
    })
    const wrapper = outer.append(new El('div')).setAttribute('ms-form-pause-reveal', '')
    const date = wrapper.append(target('resumes-at'))
    return { wrapper, date }
  }

  const chosen = block(2, 'a')
  const untouched = block(-1, 'b')

  const { api } = load({ root })
  api.renderAll(member([PAID]))
  assert.equal(chosen.wrapper.classList.contains(SHOWN), true)
  assert.equal(chosen.date.textContent, 'Nov 20, 2026')
  assert.equal(untouched.wrapper.classList.contains(SHOWN), false, 'its own group is untouched')
})

test('a page with only a reveal wrapper still boots and wires the change listener', () => {
  const root = new El('div')
  const groupWrapper = root.append(new El('div')).setAttribute('ms-form-pause-input', '')
  const group = [radio('pause', '2 months', false)]
  groupWrapper.append(group[0].label)
  const wrapper = root.append(new El('div')).setAttribute('ms-form-pause-reveal', '')
  wrapper.append(new El('p')).textContent = 'Copy only.'

  const { listeners, change } = load({
    root,
    memberstack: {
      getCurrentMember: () => Promise.resolve({ data: member([PAID]) }),
      onAuthChange: () => {},
    },
  })

  assert.ok((listeners.change || []).length, 'the change listener was wired')
  check(group, group[0].input, change)
  assert.equal(wrapper.classList.contains(SHOWN), true)
})

/* ------------------------------- drift guard ------------------------------ */

test('the header @release marker matches the exported release property', () => {
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the plan-dates.js header')
  const { api } = load()
  assert.equal(api.release, marker[1])
})

test('the documented field list matches what resolveField accepts', () => {
  const { api } = load()
  const m = member([PAID])
  for (const field of api.fields) {
    assert.notEqual(api.resolveField(m, field, { pauseMonths: 1 }), undefined, field + ' is unhandled')
  }
  // Every field named in the header comment is exported.
  const header = source.slice(0, source.indexOf('*/'))
  for (const field of api.fields) {
    assert.ok(header.includes(field), field + ' is missing from the header docs')
  }
})
