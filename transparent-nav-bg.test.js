const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

// Both embeds key on the published variant attribute, which Webflow derives from
// the Designer component name. The component was renamed navbar-v2 -> navbar-main
// and the published attribute became data-wf--navbar-main--variant, which left
// every navbar-v2 selector here matching nothing site-wide: no background fading
// in on scroll over a transparent hero, no filled background behind an open
// mobile menu. These tests pin the grammar to the published one and keep the two
// companion files in sync.
const JS_PATH = path.join(__dirname, 'navbar-embeds', 'transparent-nav-bg.js')
const CSS_PATH = path.join(__dirname, 'navbar-embeds', 'transparent-nav-bg.css')
const source = fs.readFileSync(JS_PATH, 'utf8')
const css = fs.readFileSync(CSS_PATH, 'utf8')

const NEW_ATTR = 'data-wf--navbar-main--variant'
const OLD_ATTR = 'data-wf--navbar-v2--variant'

// ---------------------------------------------------------------------------
// Minimal DOM, same shape as wf-validate.test.js: only what the script touches.
// Attribute selectors ([attr="v"] comma groups), one class selector (.nav_bg),
// style.opacity, window.scrollY, and the DOMContentLoaded / scroll listeners the
// tests fire by hand.
// ---------------------------------------------------------------------------

/** @param {Element} el @param {string} selector */
function matches(el, selector) {
  return selector.split(',').some((part) => {
    const attr = /^\s*\[([\w-]+)="([^"]*)"\]\s*$/.exec(part)
    if (attr) return el.getAttribute(attr[1]) === attr[2]
    const cls = /^\s*\.([\w-]+)\s*$/.exec(part)
    if (cls) return el.classes.has(cls[1])
    throw new Error('unsupported selector: ' + selector)
  })
}

class Element {
  constructor(attrs = {}, children = []) {
    this._attrs = new Map()
    this.children = children
    this.style = {}
    this.classes = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean))
    Object.keys(attrs).forEach((key) => this._attrs.set(key, String(attrs[key])))
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()])
  }

  querySelector(selector) {
    return this.descendants().find((el) => matches(el, selector)) || null
  }
}

/**
 * @param {Element[]} tree top-level elements
 * @returns {{win: object, fire: (type: string) => void}}
 */
function makeWindow(tree) {
  const all = tree.flatMap((el) => [el, ...el.descendants()])
  const listeners = new Map()
  const on = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(fn)
  }

  const win = {
    scrollY: 0,
    addEventListener: on,
    document: {
      addEventListener: on,
      querySelectorAll: (selector) => all.filter((el) => matches(el, selector)),
    },
  }
  win.window = win

  return { win, fire: (type) => (listeners.get(type) || []).forEach((fn) => fn()) }
}

/** One published navbar instance: .section_navbar carrying the variant attribute. */
function navbar(variantAttr, variant) {
  const navBg = new Element({ class: 'nav_bg' })
  const section = new Element({ class: 'section_navbar', [variantAttr]: variant }, [
    navBg,
    new Element({ class: 'navbar_container' }),
  ])
  return { section, navBg }
}

/** Loads the embed against one navbar and returns the handles the tests drive. */
function boot(variantAttr, variant) {
  const { section, navBg } = navbar(variantAttr, variant)
  const { win, fire } = makeWindow([section])
  vm.runInNewContext(source, win)
  return { win, fire, navBg }
}

for (const variant of ['transparent', 'transparent-light']) {
  test(`${variant} navbar-main fades .nav_bg in past 10px of scroll`, () => {
    const { win, fire, navBg } = boot(NEW_ATTR, variant)

    fire('DOMContentLoaded')
    assert.equal(navBg.style.opacity, 0, 'over the hero the navbar stays transparent')

    win.scrollY = 11
    fire('scroll')
    assert.equal(navBg.style.opacity, 1, 'past 10px the .nav_bg layer is opaque')

    win.scrollY = 0
    fire('scroll')
    assert.equal(navBg.style.opacity, 0, 'back at the hero the navbar is transparent again')
  })
}

test('the renamed component is the only variant grammar the script matches', () => {
  const { win, fire, navBg } = boot(OLD_ATTR, 'transparent')

  fire('DOMContentLoaded')
  win.scrollY = 400
  fire('scroll')
  assert.equal(
    navBg.style.opacity,
    undefined,
    'the pre-rename attribute is no longer published, so nothing should key on it',
  )
})

test('both companion embeds target the renamed navbar-main component', () => {
  for (const [file, text] of [
    ['transparent-nav-bg.js', source],
    ['transparent-nav-bg.css', css],
  ]) {
    for (const variant of ['transparent', 'transparent-light']) {
      assert.match(
        text,
        new RegExp(`\\[${NEW_ATTR}=['"]${variant}['"]\\]`),
        `${file} no longer selects the ${variant} variant of navbar-main`,
      )
    }
    assert.doesNotMatch(
      text,
      new RegExp(OLD_ATTR),
      `${file} still carries the pre-rename ${OLD_ATTR} grammar, which matches nothing published`,
    )
  }
})

test('the mobile-menu rule fills the navbar with the authored navbar background', () => {
  assert.match(
    css,
    /\.section_navbar:is\(\[data-wf--navbar-main--variant='transparent'\], \[data-wf--navbar-main--variant='transparent-light'\]\):has\(\[data-nav-menu-open\]\)\s*\{\s*background-color:\s*var\(--_navbar---main--background\)/,
  )
})
