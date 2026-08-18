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

test('the shared height is capped at two lines, not the measured overflow', () => {
  // The bug: 80px of content was written back as a height, which overrode the
  // stylesheet's clamp and let the list grow past two lines.
  const a = companyList(80)
  const b = companyList(80)
  const page = load([a, b], { lineHeight: '20px' })

  page.fire('load')

  assert.equal(a.style.minHeight, '40px', 'two 20px lines, not the measured 80')
  assert.equal(b.style.minHeight, '40px', 'every list gets the same floor, so rows line up')
  assert.deepEqual(page.dispatched, ['expert-cards:relayout:done'])
})

test('no inline max-height is written, or the ellipsis is clipped away', () => {
  // An inline max-height in px stops the box at two lines with no `…` painted,
  // which is exactly the silent clip `-webkit-line-clamp: 2` replaced. The
  // ceiling is the stylesheet's; this pass only ever writes the floor.
  const a = companyList(80)
  const b = companyList(20)
  const page = load([a, b], { lineHeight: '20px' })

  page.fire('load')

  assert.ok(!a.style.maxHeight, 'the clamped list must keep its ellipsis')
  assert.ok(!b.style.maxHeight, 'and a short list has nothing to cap anyway')
})

test('a list shorter than two lines is left at its measured height', () => {
  // The cap is a ceiling, not a target: a one-line list must not be padded.
  const short = companyList(20)
  const page = load([short], { lineHeight: '20px' })

  page.fire('load')

  assert.equal(short.style.minHeight, '20px')
  assert.ok(!short.style.maxHeight)
})

test('the tallest list still sets the shared height, up to the cap', () => {
  const short = companyList(18)
  const tall = companyList(34)
  const page = load([short, tall], { lineHeight: '20px' })

  page.fire('load')

  assert.equal(short.style.minHeight, '34px', 'equalized on the tallest')
  assert.equal(tall.style.minHeight, '34px')
})

test('a fractional line height is rounded up, so the second line is not clipped', () => {
  const list = companyList(80)
  const page = load([list], { lineHeight: '20.4px' })

  page.fire('load')

  assert.equal(list.style.minHeight, '41px', 'ceil(2 * 20.4)')
})

test('line-height: normal writes no inline height, so the CSS clamp stays', () => {
  // Writing the measured 80px back would push the list past its two clamped
  // lines. With no line height to cap against, the stylesheet is the better
  // authority.
  const list = companyList(80)
  const page = load([list], { lineHeight: 'normal' })

  page.fire('load')

  assert.ok(!list.style.minHeight, 'nothing to pad the list out')
  assert.ok(!list.style.maxHeight, 'and nothing to clip the ellipsis either')
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

  assert.ok(!unreadable.style.minHeight, 'left to the stylesheet')
  assert.ok(!unreadable.style.maxHeight)
  assert.equal(normal.style.minHeight, '40px', 'still capped at its own two lines')
  assert.ok(!normal.style.maxHeight, 'and still no clip over the ellipsis')
})

test('each list is capped against its own line height, not the first one', () => {
  // Two 20px lines is 40px; capping the taller list at the shorter list's
  // 2 * 16px would clip its second line.
  const small = companyList(80, { lineHeight: '16px' })
  const big = companyList(80, { lineHeight: '20px' })
  const page = load([small, big])

  page.fire('load')

  assert.equal(big.style.minHeight, '40px', 'max of the capped contributions')
  assert.equal(small.style.minHeight, '40px', 'equalized on it, as rows must line up')
})

test('the layout pass runs once, not once per frame and again on the belt', () => {
  const list = companyList(80)
  const page = load([list], { lineHeight: '20px' })

  page.fire('load')
  assert.equal(page.pendingTimers(), 1, 'the 80ms belt is armed')

  page.flush()

  assert.equal(list.style.minHeight, '40px', 'still capped after the belt fires')
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

  assert.equal(list.style.minHeight, '40px')
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
  // company is ignored and each one claims its own line. Doubled class so it
  // still wins if the Designer's flex rule on the same class loads after this
  // sheet. `-webkit-box` reads as a sentence exactly as `display: block` did,
  // because the companies are inline either way — the earlier ban on
  // `-webkit-line-clamp` was measured against flex with BLOCK children, which
  // is not the shape this sheet ships.
  assert.match(
    liveCss,
    /\.expert-card_company-list\.expert-card_company-list\s*\{[^}]*display:\s*-webkit-box\b/,
    'no doubled-class `display: -webkit-box` on .expert-card_company-list'
  )
})

test('the clamp is two lines with an ellipsis, not a silent height clip', () => {
  // A `max-height` clip stops at two lines and paints no `…`, so a card with
  // ten companies read as a card with two. Only line-clamp shows the cut. The
  // prefixed pair is deliberate: unprefixed `line-clamp` on a block does not
  // clamp in this engine.
  const doubled = liveCss.match(
    /\.expert-card_company-list\.expert-card_company-list\s*\{[^}]*\}/
  )
  assert.ok(doubled, 'no doubled-class rule at all')
  assert.match(doubled[0], /-webkit-line-clamp:\s*2\b/, 'no `-webkit-line-clamp: 2`')
  assert.match(
    doubled[0],
    /-webkit-box-orient:\s*vertical\b/,
    'line-clamp does nothing without a vertical box orientation'
  )
  assert.match(
    liveCss,
    /\.expert-card_company-list\s*\{[^}]*\boverflow:\s*hidden\b/,
    'the clamp needs overflow: hidden to paint the ellipsis'
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

test('a company name does not wrap inside itself', () => {
  // "Xero Shoes" is one company. `white-space: normal` wraps at that space and
  // paints "Xero" on line 1 with "Shoes, …" on line 2. nowrap keeps the name
  // one unit; wrap still happens between inline companies.
  assert.match(
    liveCss,
    /\.expert-card_company-list[\s\S]*?\{[^}]*white-space:\s*nowrap/,
    'without nowrap a two-word company splits across the clamp'
  )
  assert.doesNotMatch(
    liveCss,
    /white-space:\s*normal/,
    '`normal` is the backup that split "Xero Shoes"'
  )
})

test('the earlier attempt is commented out, not live', () => {
  for (const [pattern, why] of [
    [/font-size:\s*inherit/, 'font-size: inherit beat .text-size-small'],
    [/text-wrap:\s*pretty/, 'text-wrap: pretty re-balanced the two clamped lines'],
    [/--expert-card-company-line-height-unitless/, 'the line height is written directly'],
    [/p:empty/, 'hiding an empty last item left the previous comma trailing'],
    [/max-height:\s*2lh/, 'a height clip stops at two lines but paints no ellipsis'],
    [/display:\s*block/, 'the list is a -webkit-box now, or the clamp cannot paint'],
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
