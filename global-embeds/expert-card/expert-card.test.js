const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./expert-card.js'), 'utf8')
const stylesheet = fs.readFileSync(require.resolve('./expert-card.css'), 'utf8')

/* ------------------------------ mini DOM ------------------------------ *
 * The script is a closed IIFE, so the only seam is the DOM a visitor's
 * browser would hold afterwards. Nothing here models layout: `scrollHeight`
 * and the computed `lineHeight` are test-controlled, which is exactly the
 * pair the two-line cap is computed from.
 * -------------------------------------------------------------------- */

/**
 * One `.expert-card_company-list`, with the height a real browser measured.
 * `opts.lineHeight` overrides the page-wide computed line height for this list
 * alone, which is how a single hidden or `normal` list is modelled.
 */
function companyList(scrollHeight, opts = {}) {
  return { style: {}, scrollHeight, lineHeight: opts.lineHeight }
}

/** The rules a browser actually applies: commented-out backups do not count. */
function activeCss(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

const liveCss = activeCss(stylesheet)

/**
 * Runs expert-card.js for real against a page holding `lists`, then fires the
 * window-load layout pass.
 *
 * @param {ReturnType<typeof companyList>[]} lists
 * @param {{ lineHeight?: string }} [options]
 */
function load(lists, options = {}) {
  const lineHeight = options.lineHeight === undefined ? '20px' : options.lineHeight
  const listeners = { window: {}, document: {} }
  const dispatched = []
  const timers = []

  const document = {
    querySelectorAll(selector) {
      if (selector === '.expert-card_company-list') return lists
      return []
    },
    addEventListener(type, fn) {
      ;(listeners.document[type] = listeners.document[type] || []).push(fn)
    },
  }

  const window = {
    innerWidth: 1200,
    // Hover-capable, so the touch tap toggle stays out of the way.
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: (el) => ({
      lineHeight: (el && el.lineHeight) || lineHeight,
    }),
    addEventListener(type, fn) {
      ;(listeners.window[type] = listeners.window[type] || []).push(fn)
    },
    dispatchEvent(event) {
      dispatched.push(event.type)
      return true
    },
  }
  window.window = window

  const sandbox = vm.createContext({
    window,
    document,
    CustomEvent: class {
      constructor(type) {
        this.type = type
      }
    },
    // Frames run inline, so the layout pass lands in the same task the test is
    // in. The 80ms belt is still queued; `flush` proves it cannot run twice.
    requestAnimationFrame: (fn) => {
      fn()
      return 1
    },
    setTimeout: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => {},
  })

  vm.runInContext(source, sandbox)

  const fire = (type) => (listeners.window[type] || []).forEach((fn) => fn())

  return {
    window,
    dispatched,
    fire,
    flush: () => {
      while (timers.length) timers.shift()()
    },
    pendingTimers: () => timers.length,
  }
}

/* --------------------------- the two-line cap --------------------------- */

test('the applied height is capped at two lines, not the measured overflow', () => {
  // The bug: 80px of content was written back as max-height, which overrode
  // the stylesheet's `max-height: 2lh` and let the list grow past two lines.
  const a = companyList(80)
  const b = companyList(80)
  const page = load([a, b], { lineHeight: '20px' })

  page.fire('load')

  assert.equal(a.style.maxHeight, '40px', 'two 20px lines, not the measured 80')
  assert.equal(b.style.maxHeight, '40px', 'every list gets the same cap')
  assert.equal(a.style.minHeight, '40px', 'min and max still agree, so rows line up')
  assert.equal(b.style.minHeight, '40px')
  assert.deepEqual(page.dispatched, ['expert-cards:relayout:done'])
})

test('a list shorter than two lines is left at its measured height', () => {
  // The cap is a ceiling, not a target: a one-line list must not be padded.
  const short = companyList(20)
  const page = load([short], { lineHeight: '20px' })

  page.fire('load')

  assert.equal(short.style.maxHeight, '20px')
  assert.equal(short.style.minHeight, '20px')
})

test('the tallest list still sets the shared height, up to the cap', () => {
  const short = companyList(18)
  const tall = companyList(34)
  const page = load([short, tall], { lineHeight: '20px' })

  page.fire('load')

  assert.equal(short.style.maxHeight, '34px', 'equalized on the tallest')
  assert.equal(tall.style.maxHeight, '34px')
})

test('a fractional line height is rounded up, so the second line is not clipped', () => {
  const list = companyList(80)
  const page = load([list], { lineHeight: '20.4px' })

  page.fire('load')

  assert.equal(list.style.maxHeight, '41px', 'ceil(2 * 20.4)')
})

test('line-height: normal writes no inline height, so the CSS clamp stays', () => {
  // Writing the measured 80px back would override `max-height: 2lh`. With no
  // line height to cap against, the stylesheet is the better authority.
  const list = companyList(80)
  const page = load([list], { lineHeight: 'normal' })

  page.fire('load')

  assert.ok(!list.style.maxHeight, 'no inline max-height to beat max-height: 2lh')
  assert.ok(!list.style.minHeight, 'and none to pad the list out either')
  assert.deepEqual(page.dispatched, ['expert-cards:relayout:done'], 'still settles')
})

test('an unreadable line height is treated the same as normal', () => {
  const list = companyList(80)
  const page = load([list], { lineHeight: '' })

  page.fire('load')

  assert.ok(!list.style.maxHeight)
  assert.ok(!list.style.minHeight)
})

test('a list with no readable line height cannot uncap the rest of the page', () => {
  // The bug: the cap was read from lists[0] only, so one hidden or `normal`
  // list at the top of the page skipped the cap for every list below it.
  const unreadable = companyList(80, { lineHeight: 'normal' })
  const normal = companyList(80)
  const page = load([unreadable, normal], { lineHeight: '20px' })

  page.fire('load')

  assert.ok(!unreadable.style.maxHeight, 'left to the stylesheet')
  assert.ok(!unreadable.style.minHeight)
  assert.equal(normal.style.maxHeight, '40px', 'still capped at its own two lines')
  assert.equal(normal.style.minHeight, '40px')
})

test('each list is capped against its own line height, not the first one', () => {
  // Two 20px lines is 40px; capping the taller list at the shorter list's
  // 2 * 16px would clip its second line.
  const small = companyList(80, { lineHeight: '16px' })
  const big = companyList(80, { lineHeight: '20px' })
  const page = load([small, big])

  page.fire('load')

  assert.equal(big.style.maxHeight, '40px', 'max of the capped contributions')
  assert.equal(small.style.maxHeight, '40px', 'equalized on it, as rows must line up')
})

test('the layout pass runs once, not once per frame and again on the belt', () => {
  const list = companyList(80)
  const page = load([list], { lineHeight: '20px' })

  page.fire('load')
  assert.equal(page.pendingTimers(), 1, 'the 80ms belt is armed')

  page.flush()

  assert.equal(list.style.maxHeight, '40px', 'still capped after the belt fires')
  assert.deepEqual(page.dispatched, ['expert-cards:relayout:done'], 'exactly one pass')
})

test('a page with no company lists settles without touching anything', () => {
  const page = load([])

  page.fire('load')

  assert.deepEqual(page.dispatched, ['expert-cards:relayout:done'])
})

test('the requested relayout event runs the same capped pass', () => {
  const list = companyList(80)
  const page = load([list], { lineHeight: '20px' })

  page.fire('expert-cards:relayout')

  assert.equal(list.style.maxHeight, '40px')
})

test('the init guard means a second load cannot bind a second pass', () => {
  const list = companyList(80)
  const page = load([list], { lineHeight: '20px' })

  assert.equal(page.window.__expertCardLayoutInit, true)

  page.fire('load')

  assert.deepEqual(page.dispatched, ['expert-cards:relayout:done'])
})

/* ---------------------------- the stylesheet ---------------------------- */

test('the list is taken out of flex, or the companies stay one per row', () => {
  // A flex container blockifies its children, so `display: inline` on a
  // company is ignored and each one claims its own line. This is the rule the
  // 2lh clamp depends on. Doubled class so it still wins if the Designer's
  // flex rule on the same class loads after this sheet.
  assert.match(
    liveCss,
    /\.expert-card_company-list\.expert-card_company-list\s*\{[^}]*\bdisplay:\s*block\b/,
    'no doubled-class `display: block` on .expert-card_company-list'
  )
  assert.doesNotMatch(
    liveCss,
    /-webkit-line-clamp/,
    '-webkit-line-clamp re-stacks the companies one per line'
  )
})

test('the clamp is two lines of the list, clipped', () => {
  assert.match(liveCss, /max-height:\s*2lh/, 'no `max-height: 2lh`')
  assert.match(
    liveCss,
    /\.expert-card_company-list\s*\{[^}]*\boverflow:\s*hidden\b/,
    'the clamp needs overflow: hidden to bite'
  )
})

test('leading ::before commas are killed on all three markup shapes', () => {
  const rule = liveCss.match(/[^}]*::before\s*\{[^}]*content:\s*none[^}]*\}/)
  assert.ok(rule, 'no ::before comma kill at all')
  const selectors = rule[0]
  assert.match(selectors, /\.expert-card_company-list[\s\S]*p::before/, 'plain paragraphs')
  assert.match(selectors, /\.expert-card_company-text::before/, 'the CMS shape')
  assert.match(
    selectors,
    /\[wf-algolia-display='inline'\]::before/,
    'the Algolia template shape'
  )
})

test('the trailing comma is glued to its company, with the gap in margin', () => {
  // `content: ', '` puts a wrap opportunity between the comma and the next
  // company, so the comma travels to the next line. A bare comma plus margin
  // keeps it welded to the name it belongs to and still lets the list wrap.
  const rule = liveCss.match(/[^}]*::after\s*\{[^}]*content:\s*','[^}]*\}/)
  assert.ok(rule, "no `::after { content: ',' }` rule")
  assert.match(
    rule[0],
    /margin-right:\s*[\d.]+em/,
    'the gap to the next company must be margin, not a breakable space'
  )
})

test('the last company has no trailing comma, in every markup shape', () => {
  // `p:not(:last-child)` is wrong here: a CMS company is the only child of its
  // own `display: contents` item, so every paragraph is a last child.
  assert.doesNotMatch(
    liveCss,
    /p:not\(:last-child\)::after/,
    'p:not(:last-child) never suppresses anything under a nested collection'
  )
  const suppressions = liveCss.match(/[^}]*::after\s*\{[^}]*content:\s*none[^}]*\}/)
  assert.ok(suppressions, 'no last-child suppression at all')
  const selectors = suppressions[0]
  assert.match(selectors, />\s*p:last-child::after/, 'Algolia siblings')
  assert.match(selectors, /\.w-dyn-item:last-child/, 'the CMS nested collection item')
})

test('the live rules stick to markup the card really ships', () => {
  assert.doesNotMatch(
    liveCss,
    /\[data-company-list-item\]/,
    'that attribute was invented here; no card writes it'
  )
  assert.doesNotMatch(
    liveCss,
    /\.wf-design-mode/,
    'Designer-canvas only, and this sheet is CDN-served on the published site'
  )
})

test('the Designer nowrap on company names is beaten, not copied', () => {
  // Staging ships `.expert-card_company-text { white-space: nowrap }`. Commenting
  // out our copy of that rule does nothing; the live sheet has to say `normal`.
  assert.match(
    liveCss,
    /\.expert-card_company-list[\s\S]*?\{[^}]*white-space:\s*normal/,
    'without this the Designer’s nowrap still clips names wider than the card',
  )
})

test('the earlier attempt is commented out, not live', () => {
  for (const [pattern, why] of [
    [/white-space:\s*nowrap/, 'nowrap clipped company names wider than the card'],
    [/font-size:\s*inherit/, 'font-size: inherit beat .text-size-small'],
    [/text-wrap:\s*pretty/, 'text-wrap: pretty re-balanced the two clamped lines'],
    [/--expert-card-company-line-height-unitless/, 'the line height is written directly'],
    [/p:empty/, 'hiding an empty last item left the previous comma trailing'],
  ]) {
    assert.doesNotMatch(liveCss, pattern, why)
  }
})

test('the stylesheet leans on the cascade rather than !important', () => {
  assert.doesNotMatch(liveCss, /!important/, 'no conflict here needed one')
})

test('the stylesheet stays company-list only', () => {
  // Jobs hover, the image and the card grid are Webflow's; duplicating them on
  // the CDN is how the two copies drift apart.
  for (const stray of [
    'expert-card_jobs-wrapper',
    'expert-card_profile-image',
    'expert-card_item--jobs-open',
  ]) {
    assert.doesNotMatch(liveCss, new RegExp(stray), stray + ' belongs in Webflow')
  }
})

test('the stylesheet carries the docs header the sibling embeds use', () => {
  assert.match(
    stylesheet,
    /^\/\* Docs: https:\/\/wf-starter-embeds-docs\.vercel\.app\/docs\/global-embeds\/expert-card\b/,
  )
  // Loading this in Body, or pasting it as an embed, is the mistake the header
  // exists to prevent: the clamp has to be in place at first paint.
  assert.match(stylesheet, /CDN-served/, 'the header must say how it is loaded')
})
