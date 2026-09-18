const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE_PATH = path.join(__dirname, 'view-all.js')
const source = fs.readFileSync(SOURCE_PATH, 'utf8')

// ---------------------------------------------------------------------------
// The 43 live Subcategories: Hierarchical path (CMS `algolia-filter`, identical
// to the Algolia `categories.lvl1` facet value) → Collection Page slug. Copied
// from view-all-404-brief.md, "Xano × Algolia × Webflow three-way check", which
// verified Xano `subcategories_v3` and the Webflow CMS byte-identical on all 56
// rows. The 13 archived rows are excluded: Webflow never publishes them.
// ---------------------------------------------------------------------------

const LIVE_PAIRS = [
  ['Operations & Supply Chain > Operations Leadership', 'operations-leadership'],
  ['Operations & Supply Chain > Fulfillment & Logistics', 'fulfillment-logistics'],
  ['Operations & Supply Chain > Demand Planning', 'demand-planning'],
  ['Finance > Accounting & Control', 'accounting-control'],
  ['Finance > Strategic Finance / FP&A', 'strategic-finance'],
  ['Finance > Finance Leadership', 'finance-leadership'],
  ['Marketing Strategy & Brand > Brand & Positioning', 'brand-positioning'],
  ['Marketing Strategy & Brand > Growth Strategy', 'growth-strategy'],
  ['Marketing Strategy & Brand > Marketing Leadership', 'marketing-leadership'],
  ['Physical Product Development & Commercialization > Product Launch', 'product-launch'],
  ['Physical Product Development & Commercialization > Packaging & Design', 'packaging-design'],
  ['Physical Product Development & Commercialization > Product Development', 'product-development'],
  ['Physical Product Development & Commercialization > Product Strategy', 'product-strategy'],
  ['AI & Technology > AI & Automation', 'ai-automation'],
  ['AI & Technology > Technology Leadership', 'technology-leadership'],
  ['AI & Technology > Digital Product Management', 'digital-product-management'],
  ['AI & Technology > E-Commerce Management', 'ecommerce-management'],
  ['AI & Technology > Shopify & Web Development', 'shopify-site-dev'],
  ['Retail & Marketplace > Amazon & Online Marketplaces', 'amazon-marketplace'],
  ['Retail & Marketplace > Retail Strategy', 'retail-strategy'],
  ['Analytics & Experimentation > CRO & Experimentation', 'cro-experimentation'],
  ['Analytics & Experimentation > Data & Analytics', 'data-analytics'],
  ['Retention & CRM > Customer Experience', 'customer-experience'],
  ['Retention & CRM > Retention Strategy', 'retention-strategy'],
  ['Retention & CRM > Lifecycle Marketing', 'lifecycle-marketing'],
  ['Influencer, Affiliate & PR > PR & Communications', 'pr-communications'],
  ['Influencer, Affiliate & PR > Partnerships', 'partnerships'],
  ['Influencer, Affiliate & PR > Affiliate Marketing', 'affiliate-marketing'],
  ['Influencer, Affiliate & PR > Influencer Marketing', 'influencer-marketing'],
  ['Creative > UI/UX Design', 'ui-ux-design'],
  ['Creative > Video & Production', 'video-production'],
  ['Creative > Copywriting', 'copywriting'],
  ['Creative > Graphic Design', 'graphic-design'],
  ['Creative > Creative Direction', 'creative-direction'],
  ['Content & Organic > Content Creation & UGC', 'content-creation-ugc'],
  ['Content & Organic > Organic Social', 'organic-social'],
  ['Content & Organic > Content Marketing', 'content-marketing'],
  ['Content & Organic > SEO', 'seo'],
  ['Paid Media > Performance Creative Strategy', 'performance-creative-strategy'],
  ['Paid Media > Programmatic & Display', 'programmatic-display'],
  ['Paid Media > Paid Search (SEM)', 'paid-search'],
  ['Paid Media > Paid Social', 'paid-social'],
  ['Paid Media > Growth Marketing', 'growth-marketing'],
]

// The 16 the Slug Guess gets wrong (15 reachable today, Packaging & Design
// latent until a Starter is indexed under it). Brief, "The 16 broken View All
// destinations": guessed slug → real slug.
const KNOWN_BAD = [
  ['Paid Media > Paid Search (SEM)', 'paid-search-sem', 'paid-search'],
  ['Paid Media > Programmatic & Display', 'programmatic-and-display', 'programmatic-display'],
  ['Content & Organic > Content Creation & UGC', 'content-creation-and-ugc', 'content-creation-ugc'],
  ['Creative > Video & Production', 'video-and-production', 'video-production'],
  ['Influencer, Affiliate & PR > PR & Communications', 'pr-and-communications', 'pr-communications'],
  ['Analytics & Experimentation > Data & Analytics', 'data-and-analytics', 'data-analytics'],
  ['Analytics & Experimentation > CRO & Experimentation', 'cro-and-experimentation', 'cro-experimentation'],
  ['Retail & Marketplace > Amazon & Online Marketplaces', 'amazon-and-online-marketplaces', 'amazon-marketplace'],
  ['AI & Technology > Shopify & Web Development', 'shopify-and-web-development', 'shopify-site-dev'],
  ['AI & Technology > E-Commerce Management', 'e-commerce-management', 'ecommerce-management'],
  ['AI & Technology > AI & Automation', 'ai-and-automation', 'ai-automation'],
  [
    'Physical Product Development & Commercialization > Packaging & Design',
    'packaging-and-design',
    'packaging-design',
  ],
  ['Marketing Strategy & Brand > Brand & Positioning', 'brand-and-positioning', 'brand-positioning'],
  ['Finance > Strategic Finance / FP&A', 'strategic-finance-fpanda', 'strategic-finance'],
  ['Finance > Accounting & Control', 'accounting-and-control', 'accounting-control'],
  ['Operations & Supply Chain > Fulfillment & Logistics', 'fulfillment-and-logistics', 'fulfillment-logistics'],
]

// ---------------------------------------------------------------------------
// Minimal DOM, same spirit as the learn-cta-gate harness (there is no jsdom in
// this repo): a real parent/child tree so closest() walks up, and a selector
// engine covering the attribute, class and descendant selectors this script
// queries. Selectors with spaces inside an attribute value are not supported;
// none of the script's are.
// ---------------------------------------------------------------------------

class Element {
  constructor(nodeName, attrs = {}) {
    this.nodeType = 1
    this.nodeName = nodeName.toUpperCase()
    this._attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]))
    this.childNodes = []
    this.parentNode = null
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null
  }
  setAttribute(name, value) {
    this._attrs.set(name, String(value))
  }

  append(...kids) {
    kids.forEach((k) => {
      k.parentNode = this
      this.childNodes.push(k)
    })
    return this
  }

  /** depth-first descendants, document order */
  descendants() {
    const out = []
    const walk = (n) => {
      n.childNodes.forEach((c) => {
        out.push(c)
        if (c.nodeType === 1) walk(c)
      })
    }
    walk(this)
    return out
  }

  closest(sel) {
    let node = this
    while (node) {
      if (node.nodeType === 1 && matchesCompound(node, sel)) return node
      node = node.parentNode
    }
    return null
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null
  }

  querySelectorAll(sel) {
    return this.descendants().filter((n) => n.nodeType === 1 && matchesSelector(n, sel))
  }
}

/** Supports `[attr="value"]` chains and `.class.class` chains. */
function matchesCompound(el, sel) {
  let rest = String(sel).trim()
  if (!rest) return false
  while (rest) {
    const attr = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest)
    if (attr) {
      const value = el.getAttribute(attr[1])
      if (value === null) return false
      const expected = attr[2] !== undefined ? attr[2] : attr[3]
      if (expected !== undefined && value !== expected) return false
      rest = rest.slice(attr[0].length)
      continue
    }
    const cls = /^\.([\w-]+)/.exec(rest)
    if (cls) {
      const classAttr = el.getAttribute('class') || ''
      if (!classAttr.split(/\s+/).includes(cls[1])) return false
      rest = rest.slice(cls[0].length)
      continue
    }
    throw new Error('unsupported selector: ' + sel)
  }
  return true
}

/** A descendant chain of compound selectors, e.g. `[data-a] [data-b]`. */
function matchesSelector(el, sel) {
  const parts = String(sel).trim().split(/\s+/)
  const last = parts.pop()
  if (!matchesCompound(el, last)) return false
  let node = el.parentNode
  let i = parts.length - 1
  while (i >= 0) {
    if (!node) return false
    if (node.nodeType === 1 && matchesCompound(node, parts[i])) i -= 1
    node = node.parentNode
  }
  return true
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {Array<[string,string]>} [opts.rows] wf-algolia-value per Explore row.
 *        Defaults to the 43 live paths, which is what the menu renders once
 *        every Subcategory has a Starter.
 * @param {null|Array<[string,string]>} [opts.entries] Map Entries as
 *        [path, href]. null builds no Map at all (today's page).
 * @param {Array<[string,string]>} [opts.strayEntries] entries placed OUTSIDE
 *        the Map wrapper, which the scoped query must ignore.
 * @param {string} [opts.hostname]
 * @param {boolean} [opts.debug] sets window.STARTERS_DEBUG
 */
function harness(opts = {}) {
  const {
    rows = LIVE_PAIRS.map(([p]) => p),
    entries = LIVE_PAIRS.map(([p, slug]) => [p, '/subcategories/' + slug]),
    strayEntries = [],
    hostname = 'the-starters-3-0.webflow.io',
    debug = undefined,
  } = opts

  const body = new Element('body')
  const root = new Element('html').append(body)

  // The wf-algolia-rendered Explore rows: the facet value sits on the row, the
  // hook on the button inside it.
  const buttons = new Map()
  const list = new Element('div', { class: 'explore_sub_list' })
  rows.forEach((value) => {
    const row = new Element('div', { class: 'explore_sub_item', 'wf-algolia-value': value })
    const button = new Element('a', { 'data-navbar-explore': 'view-all-button', href: '#' })
    row.append(new Element('div', { class: 'explore_sub_label' }), button)
    list.append(row)
    buttons.set(value, button)
  })
  body.append(list)

  if (entries) {
    const map = new Element('div', { 'data-view-all-map': '', style: 'display:none' })
    entries.forEach(([p, href]) => {
      map.append(new Element('a', { 'data-view-all-path': p, href }))
    })
    body.append(map)
  }
  strayEntries.forEach(([p, href]) => {
    body.append(new Element('a', { 'data-view-all-path': p, href }))
  })

  const navigations = []
  const warnings = []
  const docListeners = []

  const document = {
    documentElement: root,
    body,
    querySelector: (s) => root.querySelector(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    addEventListener: (type, handler, capture) => docListeners.push({ type, handler, capture }),
  }

  const windowObj = {
    location: {
      hostname,
      assign: (url) => navigations.push(url),
    },
  }
  if (debug !== undefined) windowObj.STARTERS_DEBUG = debug

  const context = {
    console: { warn: (...a) => warnings.push(a.join(' ')), info: () => {}, log: () => {} },
    document,
    window: windowObj,
  }
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'view-all.js' })

  return {
    navigations,
    warnings,
    docListeners,
    window: windowObj,
    body,
    /** re-evaluate the source in the SAME context, as a duplicate tag would */
    runSourceAgain() {
      vm.runInContext(source, context, { filename: 'view-all.js (again)' })
    },
    /** click View All on the row carrying `value` */
    click(value) {
      const button = buttons.get(value)
      assert.ok(button, 'harness built no row for ' + value)
      const event = {
        type: 'click',
        target: button,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          event.defaultPrevented = true
        },
        stopPropagation() {
          event.propagationStopped = true
        },
      }
      docListeners
        .filter((l) => l.type === 'click')
        .forEach((l) => l.handler(event))
      return event
    },
  }
}

/** The legacy Slug Guess, restated here so the fallback is checked against an
 *  independent copy rather than against the script's own function. */
function slugGuess(pathValue) {
  return pathValue
    .split('>')
    .pop()
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ---------------------------------------------------------------------------
// The Map resolves every live pair
// ---------------------------------------------------------------------------

test('all 43 live pairs resolve through the Map to their Collection Page', () => {
  const h = harness()
  LIVE_PAIRS.forEach(([pathValue, slug]) => {
    const before = h.navigations.length
    const event = h.click(pathValue)
    assert.equal(h.navigations.length, before + 1, 'no navigation for ' + pathValue)
    assert.equal(h.navigations[before], '/subcategories/' + slug, 'wrong page for ' + pathValue)
    assert.equal(event.defaultPrevented, true, 'the href="#" default must be stopped')
    assert.equal(event.propagationStopped, true, 'the menu must not also handle the click')
  })
  assert.equal(h.warnings.length, 0, 'a full Map must warn about nothing')
})

test('the 16 known-bad labels reach the real slug, not the guessed one', () => {
  const h = harness()
  KNOWN_BAD.forEach(([pathValue, guessed, real]) => {
    assert.equal(slugGuess(pathValue), guessed, 'brief pair drifted for ' + pathValue)
    assert.notEqual(guessed, real, 'not a known-bad pair: ' + pathValue)
    const before = h.navigations.length
    h.click(pathValue)
    assert.equal(h.navigations[before], '/subcategories/' + real, 'wrong page for ' + pathValue)
  })
})

test('the full path is matched, never the leaf alone', () => {
  // Two Categories sharing a Subcategory name must not collide.
  const h = harness({
    rows: ['Creative > Brand Strategy', 'Marketing Strategy & Brand > Brand Strategy'],
    entries: [
      ['Creative > Brand Strategy', '/subcategories/brand-strategy'],
      ['Marketing Strategy & Brand > Brand Strategy', '/subcategories/marketing-brand-strategy'],
    ],
  })
  h.click('Marketing Strategy & Brand > Brand Strategy')
  assert.deepEqual(h.navigations, ['/subcategories/marketing-brand-strategy'])
})

test('whitespace variance on either side still matches', () => {
  const h = harness({
    rows: ['Paid Media  >  Paid Search (SEM) '],
    entries: [[' Paid Media >\nPaid Search (SEM)', '/subcategories/paid-search']],
  })
  h.click('Paid Media  >  Paid Search (SEM) ')
  assert.deepEqual(h.navigations, ['/subcategories/paid-search'])
  assert.equal(h.warnings.length, 0)
})

test('only entries inside the Map count', () => {
  const h = harness({
    rows: ['Paid Media > Paid Social'],
    entries: [],
    strayEntries: [['Paid Media > Paid Social', '/somewhere-else']],
  })
  h.click('Paid Media > Paid Social')
  assert.deepEqual(h.navigations, ['/subcategories/paid-social'], 'a stray entry must be ignored')
})

// ---------------------------------------------------------------------------
// Fallback and diagnostics
// ---------------------------------------------------------------------------

test('a path absent from the Map falls back to the Slug Guess and warns once on staging', () => {
  const h = harness({
    rows: ['Operations & Supply Chain > Fulfillment & Logistics'],
    entries: [['Paid Media > Paid Social', '/subcategories/paid-social']],
  })
  h.click('Operations & Supply Chain > Fulfillment & Logistics')
  h.click('Operations & Supply Chain > Fulfillment & Logistics')

  assert.deepEqual(h.navigations, [
    '/subcategories/fulfillment-and-logistics',
    '/subcategories/fulfillment-and-logistics',
  ], 'the miss must behave exactly as the script does today')
  assert.equal(h.warnings.length, 1, 'one warning per page load, not one per click')
  assert.match(h.warnings[0], /Fulfillment & Logistics/, 'the warning must name the missed path')
  assert.match(h.warnings[0], /present/i, 'and say whether the Map was present')
})

test('the same miss warns nothing on www.thestarters.com', () => {
  const h = harness({
    rows: ['Operations & Supply Chain > Fulfillment & Logistics'],
    entries: [],
    hostname: 'www.thestarters.com',
  })
  h.click('Operations & Supply Chain > Fulfillment & Logistics')
  assert.deepEqual(h.navigations, ['/subcategories/fulfillment-and-logistics'])
  assert.equal(h.warnings.length, 0, 'production stays silent')
})

test('STARTERS_DEBUG opts production into the warning', () => {
  const h = harness({
    rows: ['Operations & Supply Chain > Fulfillment & Logistics'],
    entries: [],
    hostname: 'www.thestarters.com',
    debug: true,
  })
  h.click('Operations & Supply Chain > Fulfillment & Logistics')
  assert.equal(h.warnings.length, 1)
})

test('a page with no Map behaves as today and warns once on staging', () => {
  const h = harness({ entries: null })
  LIVE_PAIRS.forEach(([pathValue]) => h.click(pathValue))
  assert.deepEqual(
    h.navigations,
    LIVE_PAIRS.map(([pathValue]) => '/subcategories/' + slugGuess(pathValue)),
    'every row must land exactly where it lands today'
  )
  assert.equal(h.warnings.length, 1)
  assert.match(h.warnings[0], /no/i, 'the warning must report the Map as absent')
})

test('a matched entry with an empty href falls back rather than navigating to nothing', () => {
  const h = harness({
    rows: ['Paid Media > Paid Search (SEM)'],
    entries: [['Paid Media > Paid Search (SEM)', '']],
  })
  h.click('Paid Media > Paid Search (SEM)')
  assert.deepEqual(h.navigations, ['/subcategories/paid-search-sem'])
  assert.equal(h.warnings.length, 1)
})

test('a lookalike host does not count as staging', () => {
  const h = harness({
    rows: ['Paid Media > Paid Social'],
    entries: [],
    hostname: 'notwebflow.io',
  })
  h.click('Paid Media > Paid Social')
  assert.deepEqual(h.navigations, ['/subcategories/paid-social'])
  assert.equal(h.warnings.length, 0, 'notwebflow.io is not the staging site')
})

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

test('the listener is capturing, bound once, and a second run adds no second bind', () => {
  const h = harness({ rows: ['Paid Media > Paid Social'] })
  assert.equal(h.docListeners.length, 1)
  assert.equal(h.docListeners[0].capture, true, 'the menu swallows bubbling clicks')
  assert.equal(h.window.__startersViewAllInit, true)

  h.runSourceAgain()
  assert.equal(h.docListeners.length, 1, 'the init guard must block a second bind')

  h.click('Paid Media > Paid Social')
  assert.deepEqual(h.navigations, ['/subcategories/paid-social'], 'and the click fires once')
})

// ---------------------------------------------------------------------------
// Release marker
// ---------------------------------------------------------------------------

test('the header carries a well-formed @release marker', () => {
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(marker, 'no "@release vX.Y.Z" line in the view-all.js header')
})

test('a click outside a View All button is left alone', () => {
  const h = harness({ rows: ['Paid Media > Paid Social'] })
  const event = { type: 'click', target: h.body, preventDefault: () => {}, stopPropagation: () => {} }
  h.docListeners.forEach((l) => l.handler(event))
  assert.equal(h.navigations.length, 0)
})
