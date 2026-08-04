const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'ms-form-cancel-state.js'), 'utf8')

/* ------------------------------- mini DOM -------------------------------- *
 * The module walks ancestors (closest, parentElement) to decide which root owns an
 * element and writes style.display / aria-hidden, so flat stubs cannot express what
 * it does. This is a small tree implementing exactly the surface it touches. Only
 * the selector shapes the module actually uses are supported — `[attr]`,
 * `[attr="value"]`, `.class` — and anything else throws, so a future selector cannot
 * silently match nothing and turn a real regression into a passing test.
 * ------------------------------------------------------------------------- */

function matcher(selector) {
  const parts = String(selector)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('mini DOM: empty selector')

  const tests = parts.map((part) => {
    let m
    if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(part))) {
      const [, name, value] = m
      return (el) => el.getAttribute(name) === value
    }
    if ((m = /^\[([\w-]+)\]$/.exec(part))) {
      const [, name] = m
      return (el) => el.hasAttribute(name)
    }
    if ((m = /^\.([\w-]+)$/.exec(part))) {
      const [, cls] = m
      return (el) => el.classes.has(cls)
    }
    throw new Error('mini DOM: unsupported selector ' + part)
  })

  return (el) => tests.some((t) => t(el))
}

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = String(tag || 'div').toUpperCase()
    this.nodeType = 1
    this._attrs = new Map()
    this.children = []
    this.parentNode = null
    this.parentElement = null
    this.style = {}
    this.classes = new Set()
    // What getComputedStyle reports when no inline display is set.
    this.computedDisplay = 'block'

    Object.keys(attrs).forEach((key) => this.setAttribute(key, attrs[key]))
    String(attrs.class || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this.classes.add(c))
    children.forEach((child) => this.append(child))
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value))
    return this
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  hasAttribute(name) {
    return this._attrs.has(name)
  }

  removeAttribute(name) {
    this._attrs.delete(name)
  }

  append(child) {
    child.parentNode = this
    child.parentElement = this
    this.children.push(child)
    return child
  }

  /** Self and descendants, depth-first. */
  walk(out) {
    const acc = out || []
    acc.push(this)
    this.children.forEach((c) => c.walk(acc))
    return acc
  }

  /** Descendants only, matching the real querySelectorAll contract. */
  querySelectorAll(selector) {
    const test = matcher(selector)
    return this.walk().slice(1).filter(test)
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  /** Self-or-nearest-ancestor match — how ownership is decided. */
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

const h = (tag, attrs, children) => new El(tag, attrs || {}, children || [])

/* ------------------------------- fixtures -------------------------------- */

const A = {
  root: 'ms-form-cancel-state',
  element: 'ms-form-cancel-state-element',
  change: 'ms-form-cancel-state-change',
  key: 'ms-form-cancel-state-key',
  current: 'ms-form-cancel-state-current',
}

/**
 * Webflow's button component as the real page authors it: the attributes live on the
 * `.button_main-wrap` WRAPPER, and the click lands on the overlaid `.clickable_btn`
 * inside it (or on `.button_main-text`), never on the wrapper. `type="button"` is
 * what the flow's branch buttons use; the final Confirm is `type="submit"`.
 */
function componentButton(attrs, innerType) {
  const hit = h('button', { type: innerType || 'button', class: 'clickable_btn' })
  const text = h('div', { class: 'button_main-text' })
  const wrap = h(
    'div',
    {
      'data-button-theme': 'black',
      'data-button-style': 'primary',
      'data-validate-element': 'button',
      ...attrs,
      class: 'button_main-wrap',
    },
    [
      h('div', { class: 'clickable_wrap' }, [hit]),
      h('div', { class: 'button_main-element' }, [text, h('div', { class: 'button_main-line' })]),
    ]
  )
  return { wrap, hit, text }
}

/**
 * The cancel form as authored in Webflow: the `.w-form` Form Block carries the root,
 * the `<form>` holds the reason buttons, and Webflow's success div — a SIBLING of the
 * form, inside the block — holds the tagged wrapper and items.
 *
 * Returns `wraps` (the elements carrying the attributes) and `buttons` (the inner
 * elements a member actually clicks); they are the same element only for `plain`.
 *
 * @param {{keys?: string[], buttons?: string[], rootOn?: 'block'|'form',
 *          wrapper?: boolean, plain?: boolean, noElementAttr?: boolean,
 *          displays?: Record<string,string>, innerType?: string,
 *          rootValue?: string}} [options]
 */
function cancelForm(options) {
  const o = options || {}
  const keys = o.keys || ['default', 'pause', 'needs']
  const buttonKeys = o.buttons || ['pause', 'needs']

  const built = buttonKeys.map((key) => {
    const attrs = {}
    if (!o.noElementAttr) attrs[A.element] = 'button'
    attrs[A.change] = key
    if (o.plain) {
      const el = h('a', attrs)
      return { wrap: el, hit: el, text: el }
    }
    return componentButton(attrs, o.innerType)
  })
  const wraps = built.map((b) => b.wrap)
  const buttons = built.map((b) => b.hit)
  const labels = built.map((b) => b.text)

  const items = keys.map((key) => h('div', { [A.element]: 'success-item', [A.key]: key }))
  // Displays have to be in place BEFORE the module boots, exactly as page CSS is.
  if (o.displays) {
    items.forEach((item) => {
      const key = item.getAttribute(A.key)
      if (o.displays[key]) item.computedDisplay = o.displays[key]
    })
  }

  const itemHost =
    o.wrapper === false ? h('div', {}, items) : h('div', { [A.element]: 'success-wrapper' }, items)
  const done = h('div', { class: 'w-form-done' }, [itemHost])
  const formEl = h('form', {}, wraps)

  const rootAttrs = { [A.root]: o.rootValue === undefined ? '' : o.rootValue }
  let root
  let block
  if (o.rootOn === 'form') {
    Object.keys(rootAttrs).forEach((k) => formEl.setAttribute(k, rootAttrs[k]))
    root = formEl
    block = h('div', { class: 'w-form' }, [formEl, done])
  } else {
    root = h('div', { ...rootAttrs, class: 'w-form' }, [formEl, done])
    block = root
  }

  return { root, block, formEl, done, wrapper: itemHost, items, buttons, wraps, labels }
}

function byKey(items) {
  const out = {}
  items.forEach((item) => {
    out[item.getAttribute(A.key)] = item
  })
  return out
}

const visible = (el) => el.style.display !== 'none'
const shownKeys = (items) => items.filter(visible).map((i) => i.getAttribute(A.key))

/* -------------------------------- harness -------------------------------- */

function load(options) {
  const opts = options || {}
  const body = opts.body || h('body')
  const warnings = []
  const listeners = {}

  const sandbox = {
    console: {
      warn(...args) {
        warnings.push(args.map((a) => (typeof a === 'string' ? a : '<el>')).join(' '))
      },
      log() {},
    },
    String,
    Object,
    Array,
    WeakMap,
    WeakSet,
    RegExp,
  }

  sandbox.window = sandbox
  sandbox.window.location = { hostname: opts.hostname || 'www.thestarters.com' }
  if (opts.debug !== undefined) sandbox.window.STARTERS_DEBUG = opts.debug
  sandbox.window.getComputedStyle = (el) => ({ display: el.style.display || el.computedDisplay })

  body.readyState = opts.readyState || 'complete'
  body.addEventListener = (type, fn, capture) => {
    ;(listeners[type] = listeners[type] || []).push({ fn, capture: capture === true })
  }
  sandbox.document = body

  vm.createContext(sandbox)
  new vm.Script(source).runInContext(sandbox)

  /** Fire the delegated click handler(s) as a real click on `el` would. */
  const click = (el) => {
    const event = {
      target: el,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true
      },
      stopPropagation() {
        event.propagationStopped = true
      },
    }
    ;(listeners.click || []).forEach((entry) => entry.fn(event))
    return event
  }

  return {
    api: sandbox.window.StartersMsFormCancelState,
    window: sandbox.window,
    document: body,
    warnings,
    listeners,
    click,
    rerun: () => new vm.Script(source).runInContext(sandbox),
    ready: () => (listeners.DOMContentLoaded || []).forEach((entry) => entry.fn()),
  }
}

/** A booted page holding one cancel form. */
function onePage(options) {
  const form = cancelForm(options)
  const body = h('body', {}, [form.block])
  const page = load({ ...options, body })
  return { ...page, ...form, keyed: byKey(form.items) }
}

/* ------------------------------ core contract ----------------------------- */

test('first paint shows only the default item', () => {
  const { items, keyed, root } = onePage()

  assert.deepEqual(shownKeys(items), ['default'])
  assert.equal(keyed.default.getAttribute('aria-hidden'), 'false')
  assert.equal(keyed.pause.getAttribute('aria-hidden'), 'true')
  assert.equal(root.getAttribute(A.current), 'default')
})

test('clicking a state button shows only that key', () => {
  const { items, buttons, root, click } = onePage()

  click(buttons[1]) // needs

  assert.deepEqual(shownKeys(items), ['needs'])
  assert.equal(root.getAttribute(A.current), 'needs')
})

test('the state key matches by value, not by DOM order', () => {
  const { items, buttons, click } = onePage({ keys: ['default', 'needs', 'pause'] })

  click(buttons[0]) // pause, authored last

  assert.deepEqual(shownKeys(items), ['pause'])
})

test('switching again repaints, and default is reachable as a key', () => {
  const { items, buttons, click, root } = onePage({ buttons: ['pause', 'needs', 'default'] })

  click(buttons[0])
  assert.deepEqual(shownKeys(items), ['pause'])

  click(buttons[1])
  assert.deepEqual(shownKeys(items), ['needs'])

  click(buttons[2])
  assert.deepEqual(shownKeys(items), ['default'])
  assert.equal(root.getAttribute(A.current), 'default')
})

test('every item with the clicked key shows, not just the first', () => {
  const { items, buttons, click } = onePage({ keys: ['default', 'pause', 'pause', 'needs'] })

  click(buttons[0]) // pause

  assert.deepEqual(shownKeys(items), ['pause', 'pause'])
})

test('a forgotten success-wrapper does not break the switch', () => {
  const { items, buttons, click } = onePage({ wrapper: false })

  click(buttons[0]) // pause

  assert.deepEqual(shownKeys(items), ['pause'])
})

test('a key with no item leaves the block empty and says so', () => {
  // The contract is "only the div with that key shows", so a mistyped key is an
  // authoring bug to surface — not something to paper over with another message.
  const { items, root, buttons, click, warnings } = onePage({
    keys: ['default', 'needs'],
    hostname: 'the-starters-3-0.webflow.io',
  })

  click(buttons[0]) // pause — no matching item

  assert.deepEqual(shownKeys(items), [])
  assert.equal(root.getAttribute(A.current), 'pause', 'the chosen state is still reported')
  assert.ok(warnings.some((w) => w.includes('no success-item has') && w.includes('pause')))
})

test('the root attribute value is a label, never a starting state', () => {
  const { items, root } = onePage({ rootValue: 'pause' })

  assert.deepEqual(shownKeys(items), ['default'])
  assert.equal(root.getAttribute(A.current), 'default')
})

/* --------------------------- ownership isolation -------------------------- */

test('two forms on one page keep separate state', () => {
  const a = cancelForm()
  const b = cancelForm()
  const { click } = load({ body: h('body', {}, [a.root, b.root]) })

  click(b.buttons[1]) // needs, in form B

  assert.deepEqual(shownKeys(a.items), ['default'], 'form A must not move')
  assert.deepEqual(shownKeys(b.items), ['needs'])
  assert.equal(a.root.getAttribute(A.current), 'default')
  assert.equal(b.root.getAttribute(A.current), 'needs')
})

test('a nested root is not repainted by the outer root', () => {
  const outer = cancelForm()
  const inner = cancelForm()
  outer.root.append(inner.root)
  const { click } = load({ body: h('body', {}, [outer.root]) })

  click(outer.buttons[0]) // pause, on the outer form

  assert.deepEqual(shownKeys(outer.items), ['pause'])
  assert.deepEqual(shownKeys(inner.items), ['default'], 'inner form must not move')
})

test('ownership is strict: a root never adopts items it does not contain', () => {
  // Root on the <form> puts Webflow's success div outside it. Widening the search to
  // the enclosing .w-form would couple behavior to a styling class and could let a
  // root adopt items owned by no root in an outer block. It warns instead.
  const { items, buttons, click, warnings } = onePage({
    rootOn: 'form',
    hostname: 'localhost',
  })

  click(buttons[1])

  assert.deepEqual(shownKeys(items), ['default', 'pause', 'needs'], 'nothing painted')
  assert.ok(warnings.some((w) => w.includes('has no [ms-form-cancel-state-element="success-item"]')))
})

/* ------------------------------ trigger contract -------------------------- */

test('a trigger missing the element attribute is inert and says so', () => {
  const { items, buttons, click, warnings } = onePage({
    noElementAttr: true,
    hostname: 'the-starters-3-0.webflow.io',
  })

  click(buttons[1])

  assert.deepEqual(shownKeys(items), ['default'])
  assert.ok(warnings.some((w) => w.includes('is missing ms-form-cancel-state-element="button"')))
})

test('an element role used as a state key is inert, not a transition', () => {
  // The mistake this attribute pair invites: -change="button". A role value must not
  // become a state, and must not repaint anything.
  const form = cancelForm({ buttons: ['button'] })
  const { click, warnings } = load({
    body: h('body', {}, [form.root]),
    hostname: 'the-starters-3-0.webflow.io',
  })

  click(form.buttons[0])

  assert.deepEqual(shownKeys(form.items), ['default'], 'the member sees no state change')
  assert.equal(form.root.getAttribute(A.current), 'default')
  assert.ok(warnings.some((w) => w.includes('is an ms-form-cancel-state-element role, not a state key')))
  assert.ok(warnings.some((w) => w.includes('Ignoring this click')))
})

test('an empty change value is inert', () => {
  const form = cancelForm()
  const stray = h('div', { [A.element]: 'button', [A.change]: '   ' })
  form.formEl.append(stray)
  const { click, warnings } = load({
    body: h('body', {}, [form.root]),
    hostname: 'the-starters-3-0.webflow.io',
  })

  click(stray)

  assert.deepEqual(shownKeys(form.items), ['default'])
  assert.ok(warnings.some((w) => w.includes('is empty on a clicked control')))
})

test('a button outside every root is ignored, not crashed on', () => {
  const form = cancelForm()
  const orphan = h('div', { [A.element]: 'button', [A.change]: 'needs' })
  const { click, warnings } = load({
    body: h('body', {}, [form.root, orphan]),
    hostname: 'the-starters-3-0.webflow.io',
  })

  assert.doesNotThrow(() => click(orphan))
  assert.deepEqual(shownKeys(form.items), ['default'])
  assert.ok(warnings.some((w) => w.includes('is not inside a [ms-form-cancel-state] root')))
})

test('a repeated authoring mistake warns once, not once per click', () => {
  const form = cancelForm({ buttons: ['button'] })
  const { click, warnings } = load({ body: h('body', {}, [form.root]), hostname: 'localhost' })

  click(form.buttons[0])
  click(form.buttons[0])
  click(form.buttons[0])

  assert.equal(warnings.filter((w) => w.includes('not a state key')).length, 1)
})

/* --------------------- Webflow button component + gating ------------------ */

test('a click on the overlaid .clickable_btn resolves the wrapper key', () => {
  const { buttons, items, click } = onePage()

  click(buttons[1]) // the inner <button>, not the tagged wrapper

  assert.deepEqual(shownKeys(items), ['needs'])
})

test('a click on the visible .button_main-text resolves too', () => {
  const { labels, items, click } = onePage()

  click(labels[0]) // the text div — no attributes of its own

  assert.deepEqual(shownKeys(items), ['pause'])
})

test('a submit-type component button works the same as a branch one', () => {
  const { buttons, items, click } = onePage({ innerType: 'submit' })

  const event = click(buttons[1])

  assert.deepEqual(shownKeys(items), ['needs'])
  assert.equal(event.defaultPrevented, false, 'the submit must still happen')
})

test('a bare tagged <a> still works', () => {
  const { buttons, items, click } = onePage({ plain: true })

  click(buttons[1])

  assert.deepEqual(shownKeys(items), ['needs'])
})

test('the click is never swallowed — these buttons also submit or navigate', () => {
  const { buttons, click } = onePage()

  const event = click(buttons[0])

  assert.equal(event.defaultPrevented, false)
  assert.equal(event.propagationStopped, false)
})

test('the listener is delegated once, in the capture phase', () => {
  const { listeners } = onePage()

  assert.equal(listeners.click.length, 1)
  assert.equal(listeners.click[0].capture, true, 'capture survives a stopPropagation below')
})

test('loading the embed twice does not double-bind or double-boot', () => {
  const page = onePage()

  page.rerun()

  assert.equal(page.listeners.click.length, 1)
  page.click(page.buttons[1])
  assert.deepEqual(shownKeys(page.items), ['needs'])
})

test('a step-flow validation-gated button does not change state', () => {
  const page = onePage()
  page.wraps[1].setAttribute('data-button-theme', 'disabled')
  page.wraps[1].setAttribute('data-form-flow-disabled', '')
  page.wraps[1].setAttribute('aria-disabled', 'true')

  page.click(page.buttons[1])

  assert.deepEqual(shownKeys(page.items), ['default'])
  assert.equal(page.root.getAttribute(A.current), 'default')
})

test('each disabled marker alone is enough to stand down', () => {
  const markers = [
    ['data-button-theme', 'disabled'],
    ['data-form-flow-disabled', ''],
    ['aria-disabled', 'true'],
  ]

  markers.forEach(([name, value]) => {
    const page = onePage()
    page.wraps[1].setAttribute(name, value)

    page.click(page.buttons[1])

    assert.deepEqual(shownKeys(page.items), ['default'], `${name} should gate the click`)
  })
})

test('a disabled ancestor between the trigger and the root also gates', () => {
  const page = onePage()
  page.wraps[1].parentElement.setAttribute('aria-disabled', 'true')

  page.click(page.buttons[1])

  assert.deepEqual(shownKeys(page.items), ['default'])
})

test('a re-enabled button changes state again', () => {
  const page = onePage()
  page.wraps[1].setAttribute('data-button-theme', 'disabled')
  page.click(page.buttons[1])
  assert.deepEqual(shownKeys(page.items), ['default'])

  page.wraps[1].setAttribute('data-button-theme', 'black')
  page.click(page.buttons[1])

  assert.deepEqual(shownKeys(page.items), ['needs'])
})

test('a native disabled button is gated', () => {
  const page = onePage({ plain: true })
  page.wraps[1].disabled = true

  page.click(page.buttons[1])

  assert.deepEqual(shownKeys(page.items), ['default'])
})

test('a disabled state outside the root is not consulted', () => {
  const form = cancelForm()
  const outer = h('div', { 'aria-disabled': 'true' }, [form.root])
  const { click } = load({ body: h('body', {}, [outer]) })

  click(form.buttons[1])

  assert.deepEqual(shownKeys(form.items), ['needs'])
})

test('the button theme is never touched — that belongs to the flow', () => {
  const { buttons, wraps, click } = onePage()

  click(buttons[0])

  assert.equal(wraps[0].getAttribute('data-button-theme'), 'black')
})

/* -------------------------------- visibility ------------------------------ */

test('items hidden in the Designer come back as block', () => {
  const page = onePage({ displays: { default: 'none', pause: 'none', needs: 'none' } })

  page.click(page.buttons[1]) // needs

  assert.equal(page.keyed.needs.style.display, 'block')
  assert.equal(page.keyed.default.style.display, 'none')
})

test('an authored flex display is preserved', () => {
  const page = onePage({ displays: { needs: 'flex' } })

  page.click(page.buttons[1])

  assert.equal(page.keyed.needs.style.display, 'flex')
})

test('display: contents survives a hide and show', () => {
  // The account-settings flow wraps steps in .display-contents, so an item can
  // legitimately compute to `contents`.
  const page = onePage({ displays: { needs: 'contents' } })

  page.click(page.buttons[0])
  page.click(page.buttons[1])

  assert.equal(page.keyed.needs.style.display, 'contents')
})

test('the authored display survives being hidden first', () => {
  // Reading the display only when an item is shown would read back the inline `none`
  // this module wrote on the first paint, stranding the item forever.
  const page = onePage({ displays: { needs: 'flex' } })

  page.click(page.buttons[0]) // pause
  page.click(page.buttons[1]) // needs

  assert.equal(page.keyed.needs.style.display, 'flex')
})

/* ------------------------------- late DOM + API --------------------------- */

test('refresh() paints a root added after boot', () => {
  const form = cancelForm()
  const body = h('body')
  const page = load({ body })

  body.append(form.root)
  page.api.refresh()

  assert.deepEqual(shownKeys(form.items), ['default'])
})

test('a click paints a root that arrived after boot, with no refresh() call', () => {
  const form = cancelForm()
  const body = h('body')
  const page = load({ body })

  body.append(form.root)
  page.click(form.buttons[1])

  assert.deepEqual(shownKeys(form.items), ['needs'])
})

test('refresh() repaints the live state, picking up late items', () => {
  const page = onePage()
  page.click(page.buttons[0]) // pause

  const late = h('div', { [A.element]: 'success-item', [A.key]: 'pause' })
  page.wrapper.append(late)
  page.api.refresh()

  assert.equal(visible(late), true)
  assert.deepEqual(shownKeys(page.items), ['pause'])
})

test('get() and set() drive a root programmatically', () => {
  const page = onePage()

  assert.equal(page.api.get(page.root), 'default')
  page.api.set(page.root, 'needs')

  assert.equal(page.api.get(page.root), 'needs')
  assert.deepEqual(shownKeys(page.items), ['needs'])
})

test('boot waits for DOMContentLoaded while the document is still loading', () => {
  const form = cancelForm()
  const page = load({ body: h('body', {}, [form.root]), readyState: 'loading' })

  assert.deepEqual(shownKeys(form.items), ['default', 'pause', 'needs'], 'nothing painted yet')

  page.ready()

  assert.deepEqual(shownKeys(form.items), ['default'])
})

test('the public API is exactly the documented surface', () => {
  const { api } = onePage()

  assert.deepEqual(Object.keys(api).sort(), [
    'diagnosticsEnabled',
    'get',
    'refresh',
    'release',
    'set',
    'stagingHost',
  ])
})

/* ------------------------------- diagnostics ------------------------------ */

test('production stays silent; staging and STARTERS_DEBUG talk', () => {
  const prod = onePage({ keys: ['default'], hostname: 'www.thestarters.com' })
  prod.click(prod.buttons[0]) // pause, which has no item
  assert.deepEqual(prod.warnings, [])

  const debug = onePage({ keys: ['default'], hostname: 'www.thestarters.com', debug: true })
  debug.click(debug.buttons[0])
  assert.ok(debug.warnings.length > 0)
})

test('staging host matching is anchored', () => {
  const { api } = onePage()

  assert.equal(api.stagingHost('the-starters-3-0.webflow.io'), true)
  assert.equal(api.stagingHost('localhost'), true)
  assert.equal(api.stagingHost('abc.trycloudflare.com'), true)
  assert.equal(api.stagingHost('notwebflow.io'), false)
  assert.equal(api.stagingHost('evil-trycloudflare.com'), false)
  assert.equal(api.stagingHost('www.thestarters.com'), false)
})

test('the release marker matches the header @release line', () => {
  const { api } = onePage()
  const header = /@release\s+(v\d+\.\d+\.\d+)/.exec(source)

  assert.ok(header, 'the file must carry an @release marker')
  assert.equal(api.release, header[1])
})

test('no bare msform- or data- prefixed attribute survives the rename', () => {
  // The folder speaks one dialect: ms-form-*. A stray msform- or data-ms-form- would
  // silently do nothing on a page authored to the documented contract.
  assert.equal(/[^-]msform-/.test(source), false, 'stray msform- prefix')
  assert.equal(/data-ms-form-/.test(source), false, 'stray data-ms-form- prefix')
})
