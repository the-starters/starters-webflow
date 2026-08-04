const assert = require('node:assert/strict')
const test = require('node:test')

const { h, mount } = require('./step-flow-test-dom')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A two-step linear flow. `rootAttrs` go on the `[data-form-flow]` root, so each
 * test opts into the scroll add-on exactly the way Webflow markup would.
 *
 * @param {Record<string, string>} [rootAttrs]
 */
function linearFlow(rootAttrs = {}) {
  const step1 = h('div', { 'data-form-flow-element': 'step-1', 'data-form-flow-step': '' })
  const step2 = h('div', { 'data-form-flow-element': 'step-2', 'data-form-flow-step': '' })
  const nextBtn = h('button', { 'data-form-flow-action': 'next' })
  const backBtn = h('button', { 'data-form-flow-action': 'back' })
  const group1 = h('div', { 'data-form-flow-button-group': 'step-1' }, [nextBtn])
  const group2 = h('div', { 'data-form-flow-button-group': 'step-2' }, [backBtn])
  const flow = h('div', Object.assign({ 'data-form-flow': 'test-flow' }, rootAttrs), [
    step1,
    step2,
    group1,
    group2,
  ])
  return { flow, step1, step2, nextBtn, backBtn }
}

/**
 * Default geometry: the page is scrolled 500px down and the flow root's top sits
 * 200px above the viewport top, so an un-offset window scroll targets 300.
 * @param {Element} flow
 */
const scrolledPastFlow = (flow) => {
  flow.rect = { top: -200, left: 0, bottom: 400, right: 0, width: 0, height: 600 }
  return flow
}

/** A scrollable ancestor pane: `overflow-y: auto` with real overflow. */
const scrollablePane = (children, { scrollTop = 400, top = 80 } = {}) => {
  const pane = h('div', {}, children)
  pane.computed = { overflowY: 'auto' }
  pane.scrollHeight = 2000
  pane.clientHeight = 800
  pane.scrollTop = scrollTop
  pane.rect = { top, left: 0, bottom: top + 800, right: 0, width: 0, height: 800 }
  return pane
}

/** A sticky/fixed navbar of a given height. */
const navbar = (attrs, height, position = 'fixed') => {
  const bar = h('div', attrs)
  bar.offsetHeight = height
  bar.computed = { position }
  return bar
}

/** Advance from step-1 to step-2 by clicking the Continue control. */
const clickNext = (harness, fixture) => harness.fire(fixture.flow, 'click', fixture.nextBtn)

// ---------------------------------------------------------------------------
// 1. Opt-in parsing
// ---------------------------------------------------------------------------

test('opt-in absent: a step change scrolls nothing', () => {
  const f = linearFlow()
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(f.step2.style.display, 'block', 'the step still changed')
  assert.equal(harness.window.scrollToCalls.length, 0)
})

test('opt-in "true": a step change scrolls the window to the flow root', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 1)
  assert.equal(harness.window.scrollToCalls[0].top, 300)
})

test('opt-in accepts Webflow\'s "True" casing', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'True' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 1)
})

test('opt-in set to anything else stays off', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'yes' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 0)
})

// ---------------------------------------------------------------------------
// 2. Offset parsing
// ---------------------------------------------------------------------------

/** @param {string | null} offsetValue @returns {number | null} scrolled-to top */
function offsetTarget(offsetValue) {
  const attrs = { 'data-form-flow-scroll-top': 'true' }
  if (offsetValue !== null) attrs['data-form-flow-scroll-offset'] = offsetValue
  const f = linearFlow(attrs)
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })
  clickNext(harness, f)
  return harness.window.scrollToCalls.length ? harness.window.scrollToCalls[0].top : null
}

test('offset: absent means 0', () => {
  assert.equal(offsetTarget(null), 300)
})

test('offset: a valid integer is subtracted', () => {
  assert.equal(offsetTarget('24'), 276)
})

test('offset: whitespace and a trailing unit still parse', () => {
  assert.equal(offsetTarget('  40  '), 260)
  assert.equal(offsetTarget('40px'), 260)
})

test('offset: unparseable values fall back to 0', () => {
  assert.equal(offsetTarget('abc'), 300)
  assert.equal(offsetTarget(''), 300)
})

test('offset: negative values fall back to 0 (never scrolls past the root)', () => {
  assert.equal(offsetTarget('-30'), 300)
})

// ---------------------------------------------------------------------------
// 3. Scroll-container resolution
// ---------------------------------------------------------------------------

test('container absent: a scrollable ancestor wins over the window', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  f.flow.rect = { top: -120, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const pane = scrollablePane([f.flow])
  const harness = mount(h('body', {}, [navbar({ 'data-toc-navbar': '' }, 90), pane]), {
    pageYOffset: 500,
  })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 0, 'the window is left alone')
  assert.equal(pane.scrollToCalls.length, 1)
  // 400 + (-120 - 80) = 200; the navbar is irrelevant inside a pane
  assert.equal(pane.scrollToCalls[0].top, 200)
})

test('container "nearest": same resolution as auto-detect', () => {
  const f = linearFlow({
    'data-form-flow-scroll-top': 'true',
    'data-form-flow-scroll-container': 'nearest',
  })
  f.flow.rect = { top: -120, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const pane = scrollablePane([f.flow])
  const harness = mount(h('body', {}, [pane]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(pane.scrollToCalls.length, 1)
  assert.equal(pane.scrollToCalls[0].top, 200)
})

test('container "nearest" with no scrollable ancestor falls back to the window', () => {
  const f = linearFlow({
    'data-form-flow-scroll-top': 'true',
    'data-form-flow-scroll-container': 'nearest',
  })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 1)
  assert.equal(harness.window.scrollToCalls[0].top, 300)
})

test('container "window" overrides a scrollable ancestor', () => {
  const f = linearFlow({
    'data-form-flow-scroll-top': 'true',
    'data-form-flow-scroll-container': 'window',
  })
  scrolledPastFlow(f.flow)
  const pane = scrollablePane([f.flow])
  const harness = mount(h('body', {}, [pane]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(pane.scrollToCalls.length, 0)
  assert.equal(harness.window.scrollToCalls.length, 1)
  assert.equal(harness.window.scrollToCalls[0].top, 300)
})

test('container offset applies inside a scrollable ancestor too', () => {
  const f = linearFlow({
    'data-form-flow-scroll-top': 'true',
    'data-form-flow-scroll-offset': '20',
  })
  f.flow.rect = { top: -120, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const pane = scrollablePane([f.flow])
  const harness = mount(h('body', {}, [pane]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(pane.scrollToCalls[0].top, 180)
})

test('an overflow-y:auto ancestor with nothing to scroll is not the scroller', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const pane = scrollablePane([f.flow])
  pane.scrollHeight = 800 // equal to clientHeight — no overflow
  const harness = mount(h('body', {}, [pane]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(pane.scrollToCalls.length, 0)
  assert.equal(harness.window.scrollToCalls.length, 1)
})

test('an overflow-y:hidden ancestor is not the scroller', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const pane = scrollablePane([f.flow])
  pane.computed = { overflowY: 'hidden' }
  const harness = mount(h('body', {}, [pane]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(pane.scrollToCalls.length, 0)
  assert.equal(harness.window.scrollToCalls.length, 1)
})

// ---------------------------------------------------------------------------
// 4. Navbar resolution + offset
// ---------------------------------------------------------------------------

/**
 * @param {Element[]} bars elements placed before the flow root in the body
 * @returns {number} the window scroll target
 */
function navbarTarget(bars) {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, bars.concat([f.flow])), { pageYOffset: 500 })
  clickNext(harness, f)
  assert.equal(harness.window.scrollToCalls.length, 1)
  return harness.window.scrollToCalls[0].top
}

test('navbar: no bars at all means no offset', () => {
  assert.equal(navbarTarget([]), 300)
})

test('navbar: a tagged [data-toc-navbar] bar is subtracted', () => {
  assert.equal(navbarTarget([navbar({ 'data-toc-navbar': '' }, 90)]), 210)
})

test('navbar: the .w-nav fallback is used only when nothing is tagged', () => {
  assert.equal(navbarTarget([navbar({ class: 'w-nav' }, 70)]), 230)
})

test('navbar: tagged bars beat the .w-nav fallback', () => {
  const target = navbarTarget([
    navbar({ class: 'w-nav' }, 70),
    navbar({ 'data-toc-navbar': '' }, 90),
  ])
  assert.equal(target, 210, 'only the tagged 90px bar counts, not the 70px .w-nav')
})

test('navbar: multiple tagged bars sum (stacked sticky chrome)', () => {
  const target = navbarTarget([
    navbar({ 'data-toc-navbar': '' }, 64, 'fixed'),
    navbar({ 'data-toc-navbar': '' }, 51, 'sticky'),
  ])
  assert.equal(target, 500 - 200 - 115)
})

test('navbar: a static (mobile) bar is skipped', () => {
  assert.equal(navbarTarget([navbar({ 'data-toc-navbar': '' }, 90, 'static')]), 300)
})

test('navbar: a hidden bar measures 0 and contributes nothing', () => {
  const hidden = navbar({ 'data-toc-navbar': '' }, 0, 'fixed')
  assert.equal(navbarTarget([hidden]), 300)
})

test('navbar: only the sticky bars of a mixed set count', () => {
  const target = navbarTarget([
    navbar({ 'data-toc-navbar': '' }, 64, 'fixed'),
    navbar({ 'data-toc-navbar': '' }, 200, 'static'),
    navbar({ 'data-toc-navbar': '' }, 51, 'sticky'),
  ])
  assert.equal(target, 500 - 200 - 115)
})

test('navbar: a bar whose computed style throws is skipped, not fatal', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const bad = navbar({ 'data-toc-navbar': '' }, 90)
  Object.defineProperty(bad, 'computed', {
    get() {
      throw new Error('detached')
    },
  })
  const good = navbar({ 'data-toc-navbar': '' }, 40)
  const harness = mount(h('body', {}, [bad, good, f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 1)
  assert.equal(harness.window.scrollToCalls[0].top, 260, 'only the measurable bar counts')
})

// ---------------------------------------------------------------------------
// 5. Clamp + direction guard
// ---------------------------------------------------------------------------

test('target is clamped to 0 and never goes negative', () => {
  const f = linearFlow({
    'data-form-flow-scroll-top': 'true',
    'data-form-flow-scroll-offset': '400',
  })
  f.flow.rect = { top: -100, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const harness = mount(h('body', {}, [navbar({ 'data-toc-navbar': '' }, 90), f.flow]), {
    pageYOffset: 50,
  })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 1)
  assert.equal(harness.window.scrollToCalls[0].top, 0)
})

test('direction guard: no window scroll when the root is already at or below its target', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  f.flow.rect = { top: 100, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(f.step2.style.display, 'block', 'the step still changed')
  assert.equal(harness.window.scrollToCalls.length, 0, 'never scrolls down')
})

test('direction guard: an exact match is a no-op, not a nudge', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  f.flow.rect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 0)
})

test('direction guard applies inside a scrollable ancestor too', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  f.flow.rect = { top: 300, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const pane = scrollablePane([f.flow])
  const harness = mount(h('body', {}, [pane]), { pageYOffset: 0 })

  clickNext(harness, f)

  assert.equal(pane.scrollToCalls.length, 0)
  assert.equal(harness.window.scrollToCalls.length, 0)
})

// ---------------------------------------------------------------------------
// 6. Motion preference
// ---------------------------------------------------------------------------

test('behavior is "smooth" by default', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls[0].behavior, 'smooth')
})

test('behavior is "auto" under prefers-reduced-motion', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500, reducedMotion: true })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls[0].behavior, 'auto')
})

test('reduced-motion applies to a scrollable ancestor too', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  f.flow.rect = { top: -120, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const pane = scrollablePane([f.flow])
  const harness = mount(h('body', {}, [pane]), { pageYOffset: 0, reducedMotion: true })

  clickNext(harness, f)

  assert.equal(pane.scrollToCalls[0].behavior, 'auto')
})

test('a missing matchMedia still scrolls (defaults to smooth)', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500, noMatchMedia: true })

  clickNext(harness, f)

  assert.equal(harness.window.scrollToCalls.length, 1)
  assert.equal(harness.window.scrollToCalls[0].behavior, 'smooth')
})

// ---------------------------------------------------------------------------
// 7. Init gating + step-change gating
// ---------------------------------------------------------------------------

test('no scroll on init, then a scroll on the first real step change', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  assert.equal(f.step1.style.display, 'block', 'init painted step 1')
  assert.equal(harness.window.scrollToCalls.length, 0, 'page-load init must not jump')

  clickNext(harness, f)
  assert.equal(harness.window.scrollToCalls.length, 1)
})

test('init does not scroll a flow inside a scrollable ancestor either', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  f.flow.rect = { top: -120, left: 0, bottom: 0, right: 0, width: 0, height: 600 }
  const pane = scrollablePane([f.flow])
  mount(h('body', {}, [pane]), { pageYOffset: 0 })

  assert.equal(pane.scrollToCalls.length, 0)
})

test('going back to a previous step scrolls as well', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  clickNext(harness, f)
  harness.fire(f.flow, 'click', f.backBtn)

  assert.equal(f.step1.style.display, 'block', 'back returned to step 1')
  assert.equal(harness.window.scrollToCalls.length, 2)
})

test('a goTo that lands on the current step does not scroll', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  harness.window.lumos.formFlow.goTo('test-flow', 'step-1')

  assert.equal(harness.window.scrollToCalls.length, 0, 'same step id is not a transition')
})

test('a programmatic goTo to a different step scrolls', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  harness.window.lumos.formFlow.goTo('test-flow', 'step-2')

  assert.equal(harness.window.scrollToCalls.length, 1)
  assert.equal(harness.window.scrollToCalls[0].top, 300)
})

// ---------------------------------------------------------------------------
// 8. Defensive wrapper
// ---------------------------------------------------------------------------

test('a measurement error never breaks step navigation', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  f.flow.getBoundingClientRect = () => {
    throw new Error('measurement exploded')
  }
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })

  assert.doesNotThrow(() => clickNext(harness, f))
  assert.equal(f.step2.style.display, 'block', 'step 2 is visible')
  assert.equal(f.step1.style.display, 'none', 'step 1 is hidden')
  assert.equal(harness.window.scrollToCalls.length, 0)
})

test('a scroller with no scrollTo method never breaks navigation', () => {
  const f = linearFlow({ 'data-form-flow-scroll-top': 'true' })
  scrolledPastFlow(f.flow)
  const harness = mount(h('body', {}, [f.flow]), { pageYOffset: 500 })
  harness.window.scrollTo = undefined

  assert.doesNotThrow(() => harness.fire(f.flow, 'click', f.nextBtn))
  assert.equal(f.step2.style.display, 'block')
})
