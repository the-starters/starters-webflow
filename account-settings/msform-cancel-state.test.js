const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'msform-cancel-state.js'), 'utf8')

/* ------------------------------- mini DOM -------------------------------- *
 * The module walks ancestors (closest) to decide which root owns an element and
 * writes style.display / aria-hidden, so flat stubs cannot express what it does.
 * This is a small tree implementing exactly the surface it touches. Only the
 * selector shapes the module actually uses are supported — `[attr]`,
 * `[attr="value"]`, `.class`, and comma groups of those — and anything else
 * throws, so a future selector cannot silently match nothing and turn a real
 * regression into a passing test.
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
    // The disabled walk uses parentElement, as the real DOM does to skip text nodes.
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
  root: 'msform-cancel-state',
  element: 'msform-cancel-state-element',
  change: 'msform-cancel-state-change',
  key: 'msform-cancel-state-key',
  current: 'msform-cancel-state-current',
  active: 'msform-cancel-state-active',
  display: 'msform-cancel-state-display',
}

/**
 * Webflow's button component as the real page authors it: the attributes live on
 * the `.button_main-wrap` WRAPPER, and the click lands on the overlaid
 * `.clickable_btn` inside it (or on `.button_main-text`), never on the wrapper.
 * `type="button"` is what the flow's branch buttons use; the final Confirm is
 * `type="submit"`.
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
 * The cancel form as authored in Webflow: a `.w-form` Form Block carrying the
 * root, the `<form>` with the reason buttons, and Webflow's success div holding
 * the tagged wrapper + items.
 *
 * Returns `wraps` (the elements carrying the attributes) and `buttons` (the inner
 * elements a member actually clicks). They are the same element only for the
 * `plain: true` variant, which is a bare tagged `<a>`.
 *
 * @param {{prefix?: string, rootValue?: string, keys?: string[], buttons?: string[],
 *          rootOn?: 'block'|'form', wrapper?: boolean, plain?: boolean,
 *          displays?: Record<string,string>, innerType?: string}} [options]
 */
function cancelForm(options) {
  const o = options || {}
  const p = o.prefix || ''
  const keys = o.keys || ['default', 'pause', 'needs']
  const buttonKeys = o.buttons || ['pause', 'needs']

  const built = buttonKeys.map((key) => {
    const attrs = { [p + A.element]: 'button', [p + A.change]: key }
    if (o.plain) {
      const el = h('a', attrs)
      return { wrap: el, hit: el, text: el }
    }
    return componentButton(attrs, o.innerType)
  })
  const wraps = built.map((b) => b.wrap)
  const buttons = built.map((b) => b.hit)
  const labels = built.map((b) => b.text)
  const items = keys.map((key) =>
    h('div', { [p + A.element]: 'success-item', [p + A.key]: key })
  )
  // Displays have to be in place BEFORE the module boots, exactly as page CSS is.
  if (o.displays) {
    items.forEach((item) => {
      const key = item.getAttribute(p + A.key)
      if (o.displays[key]) item.computedDisplay = o.displays[key]
    })
  }

  const itemHost =
    o.wrapper === false ? h('div', {}, items) : h('div', { [p + A.element]: 'success-wrapper' }, items)
  const done = h('div', { class: 'w-form-done' }, [itemHost])
  const formEl = h('form', {}, wraps)

  const rootAttrs = { [p + A.root]: o.rootValue === undefined ? '' : o.rootValue }
  let root
  let block
  if (o.rootOn === 'form') {
    // Root on the <form>: Webflow puts the success div OUTSIDE the form, as a
    // sibling inside the Form Block.
    Object.keys(rootAttrs).forEach((k) => formEl.setAttribute(k, rootAttrs[k]))
    root = formEl
    block = h('div', { class: 'w-form' }, [formEl, done])
  } else {
    root = h('div', { ...rootAttrs, class: 'w-form' }, [formEl, done])
    block = root
  }

  return { root, block, formEl, done, wrapper: itemHost, items, buttons, wraps, labels }
}

/** Items keyed by their state key, for readable assertions. */
function byKey(items) {
  const out = {}
  items.forEach((item) => {
    out[item.getAttribute(A.key) || item.getAttribute('data-' + A.key)] = item
  })
  return out
}

const visible = (el) => el.style.display !== 'none'
const shownKeys = (items) =>
  items.filter(visible).map((i) => i.getAttribute(A.key) || i.getAttribute('data-' + A.key))

/* -------------------------------- harness -------------------------------- */

/**
 * Boot the module over a page. `body` is the document element; anything the test
 * appends afterwards is visible to refresh() and to delegated clicks.
 */
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
  const body = h('body', {}, [form.root.parentNode || form.root])
  if (form.block !== form.root && !form.block.parentNode) body.append(form.block)
  const page = load({ ...options, body })
  return { ...page, ...form, keyed: byKey(form.items) }
}

/* --------------------------------- tests --------------------------------- */

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
  // `pause` is authored LAST here, so a positional implementation would show the
  // wrong message.
  const { items, buttons, click } = onePage({ keys: ['default', 'needs', 'pause'] })

  click(buttons[0]) // pause

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

test('two forms on one page keep separate state', () => {
  const a = cancelForm()
  const b = cancelForm()
  const body = h('body', {}, [a.root, b.root])
  const { click } = load({ body })

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

test('root tagged on the <form> still finds the sibling success div', () => {
  const { items, buttons, click } = onePage({ rootOn: 'form' })

  click(buttons[1]) // needs

  assert.deepEqual(shownKeys(items), ['needs'])
})

test('a forgotten success-wrapper does not break the switch', () => {
  const { items, buttons, click } = onePage({ wrapper: false })

  click(buttons[0]) // pause

  assert.deepEqual(shownKeys(items), ['pause'])
})

test('a key with no item falls back to default but still reports the state', () => {
  const { items, root, buttons, click, warnings } = onePage({
    keys: ['default', 'needs'],
    hostname: 'the-starters-3-0.webflow.io',
  })

  click(buttons[0]) // pause — no matching item

  assert.deepEqual(shownKeys(items), ['default'], 'the member never sees an empty success box')
  assert.equal(root.getAttribute(A.current), 'pause', 'the chosen state is still reported')
  assert.ok(
    warnings.some((w) => w.includes('no success-item with') && w.includes('pause')),
    'staging warns about the missing item'
  )
})

test('a missing default item leaves the block empty and says so', () => {
  const { items, warnings } = onePage({
    keys: ['pause', 'needs'],
    hostname: 'localhost',
  })

  assert.deepEqual(shownKeys(items), [])
  assert.ok(warnings.some((w) => w.includes('there is no "default" item')))
})

test('the data- spelling of every attribute works', () => {
  const { items, buttons, root, click } = onePage({ prefix: 'data-' })

  assert.deepEqual(shownKeys(items), ['default'])

  click(buttons[1]) // needs

  assert.deepEqual(shownKeys(items), ['needs'])
  assert.equal(root.getAttribute(A.current), 'needs', 'reflection is always un-prefixed')
})

test('the active flag lands on the component wrapper, and the previous one clears', () => {
  const { buttons, wraps, click } = onePage()

  click(buttons[0])
  assert.equal(wraps[0].getAttribute(A.active), 'true')
  assert.equal(wraps[1].getAttribute(A.active), null)

  click(buttons[1])
  assert.equal(wraps[0].getAttribute(A.active), null)
  assert.equal(wraps[1].getAttribute(A.active), 'true')
})

test('the button theme is never touched — that belongs to the flow', () => {
  const { buttons, wraps, click } = onePage()

  click(buttons[0])

  assert.equal(wraps[0].getAttribute('data-button-theme'), 'black')
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

test('a click inside a text node child of the button still resolves', () => {
  const { buttons, items, click } = onePage()
  const label = h('span', {})
  buttons[0].append(label)

  click(label)

  assert.deepEqual(shownKeys(items), ['pause'])
})

test('an empty change value is ignored instead of blanking the form', () => {
  const form = cancelForm()
  const stray = h('a', { [A.change]: '   ' })
  form.formEl.append(stray)
  const { click, warnings } = load({
    body: h('body', {}, [form.root]),
    hostname: 'the-starters-3-0.webflow.io',
  })

  click(stray)

  assert.deepEqual(shownKeys(form.items), ['default'])
  assert.equal(form.root.getAttribute(A.current), 'default')
  assert.ok(warnings.some((w) => w.includes('is empty on a clicked button')))
})

test('a button outside every root is ignored, not crashed on', () => {
  const form = cancelForm()
  const orphan = h('a', { [A.change]: 'needs' })
  const { click, warnings } = load({
    body: h('body', {}, [form.root, orphan]),
    hostname: 'the-starters-3-0.webflow.io',
  })

  assert.doesNotThrow(() => click(orphan))
  assert.deepEqual(shownKeys(form.items), ['default'])
  assert.ok(warnings.some((w) => w.includes('is not inside a [msform-cancel-state] root')))
})

test('a root with no items warns instead of throwing', () => {
  const root = h('div', { [A.root]: '', class: 'w-form' }, [h('form', {})])
  const { warnings } = load({ body: h('body', {}, [root]), hostname: 'localhost' })

  assert.ok(warnings.some((w) => w.includes('has no [msform-cancel-state-element="success-item"]')))
})

test('items hidden in the Designer come back as block', () => {
  const page = onePage({ displays: { default: 'none', pause: 'none', needs: 'none' } })

  page.click(page.buttons[1]) // needs

  assert.equal(page.keyed.needs.style.display, 'block')
  assert.equal(page.keyed.default.style.display, 'none')
})

test('an authored display is preserved, and the display attribute overrides it', () => {
  const page = onePage({ displays: { needs: 'flex', pause: 'none' } })
  page.keyed.pause.setAttribute(A.display, 'grid')

  page.click(page.buttons[1]) // needs
  assert.equal(page.keyed.needs.style.display, 'flex')

  page.click(page.buttons[0]) // pause
  assert.equal(page.keyed.pause.style.display, 'grid')
})

test('the authored display survives being hidden first', () => {
  // Reading the display only when an item is shown would read back the inline
  // `none` this module wrote on the first paint, stranding the item forever.
  // `needs` is hidden by the very first paint, before it is ever shown.
  const page = onePage({ displays: { needs: 'flex' } })

  page.click(page.buttons[0]) // pause
  page.click(page.buttons[1]) // needs

  assert.equal(page.keyed.needs.style.display, 'flex')
})

test('a root value naming an item starts on that state', () => {
  const { items, root } = onePage({ rootValue: 'pause' })

  assert.deepEqual(shownKeys(items), ['pause'])
  assert.equal(root.getAttribute(A.current), 'pause')
})

test('a root value that is only a label still starts on default', () => {
  const { items, root } = onePage({ rootValue: 'cancel-form' })

  assert.deepEqual(shownKeys(items), ['default'])
  assert.equal(root.getAttribute(A.current), 'default')
})

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
  page.click(form.buttons[1]) // needs

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

/* --------------- Webflow button component + disabled gating --------------- */

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

test('a step-flow validation-gated button does not change state', () => {
  // step-flow disables the wrapper by attribute, so the click still arrives here
  // first (capture phase) — the success message must not move for a step the flow
  // refuses to advance.
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
  // The root sits inside a disabled panel wrapper; only markers between the
  // trigger and the root may gate, or an unrelated ancestor could freeze the form.
  const form = cancelForm()
  const outer = h('div', { 'aria-disabled': 'true' }, [form.root])
  const { click } = load({ body: h('body', {}, [outer]) })

  click(form.buttons[1])

  assert.deepEqual(shownKeys(form.items), ['needs'])
})

test('an element role used as a state key is named as a swap', () => {
  // The mistake this attribute pair invites: msform-cancel-state-change="button".
  const form = cancelForm({ buttons: ['button'] })
  const { click, warnings } = load({
    body: h('body', {}, [form.root]),
    hostname: 'the-starters-3-0.webflow.io',
  })

  click(form.buttons[0])

  assert.ok(
    warnings.some((w) => w.includes('is an msform-cancel-state-element role, not a state key')),
    'staging names the swap'
  )
  assert.deepEqual(shownKeys(form.items), ['default'], 'and it still shows default, not nothing')
})

test('a repeated authoring mistake warns once, not once per click', () => {
  const form = cancelForm({ buttons: ['button'] })
  const { click, warnings } = load({
    body: h('body', {}, [form.root]),
    hostname: 'localhost',
  })

  click(form.buttons[0])
  click(form.buttons[0])
  click(form.buttons[0])

  const swaps = warnings.filter((w) => w.includes('not a state key'))
  assert.equal(swaps.length, 1)
})

test('display: contents survives a hide and show', () => {
  // The account-settings flow wraps steps in .display-contents, so an item can
  // legitimately compute to `contents`.
  const page = onePage({ displays: { needs: 'contents' } })

  page.click(page.buttons[0])
  page.click(page.buttons[1])

  assert.equal(page.keyed.needs.style.display, 'contents')
})

test('the release marker matches the header @release line', () => {
  const { api } = onePage()
  const header = /@release\s+(v\d+\.\d+\.\d+)/.exec(source)

  assert.ok(header, 'the file must carry an @release marker')
  assert.equal(api.release, header[1])
})
