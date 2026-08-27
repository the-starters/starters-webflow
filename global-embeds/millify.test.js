/**
 * Guards for the millify embed.
 *
 * The contract this file protects is "refuse rather than approximate": a value
 * the formatter cannot render exactly must leave the element's text ALONE, not
 * substitute a dash, a zero, or a rounded-off guess. Several tests below look
 * redundant until you try to change that behaviour.
 *
 * The DOM is a hand-rolled mock in the style of the other tests in this repo.
 * millify only ever queries '[data-millify]', so the selector support here is
 * deliberately that narrow.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./millify.js'), 'utf8')

const PROD_HOST = 'www.thestarters.com'
const DEV_HOST = 'the-starters-3-0.webflow.io'

/* ------------------------------------------------------------------ DOM --- */

function makeElement(attrs = {}, text = '') {
  const el = { nodeType: 1, attributes: { ...attrs }, textContent: String(text) }
  el.getAttribute = (n) =>
    Object.prototype.hasOwnProperty.call(el.attributes, n) ? el.attributes[n] : null
  el.setAttribute = (n, v) => {
    el.attributes[n] = String(v)
  }
  el.removeAttribute = (n) => {
    delete el.attributes[n]
  }
  el.hasAttribute = (n) => Object.prototype.hasOwnProperty.call(el.attributes, n)
  el.matches = (sel) => sel === '[data-millify]' && el.hasAttribute('data-millify')
  el.querySelectorAll = () => []
  return el
}

/** A bare marker element whose own text is the number — the CMS-bound case. */
function bound(text, attrs = {}) {
  return makeElement({ 'data-millify': '', ...attrs }, text)
}

function makeDocument(elements, body) {
  return {
    nodeType: 9,
    readyState: 'complete',
    addEventListener() {},
    body,
    querySelectorAll: (sel) =>
      sel === '[data-millify]' ? elements.filter((el) => el.hasAttribute('data-millify')) : [],
  }
}

function run(elements, options = {}) {
  const { hostname = PROD_HOST, language = 'en-US', body = null, debug = false } = options
  const warnings = []
  const observers = []

  const context = {
    window: debug ? { STARTERS_DEBUG: true } : {},
    location: { hostname },
    navigator: { language, languages: [language] },
    console: {
      warn: (...args) => warnings.push(args.map((a) => String(a)).join(' ')),
    },
    MutationObserver: function (callback) {
      this.observe = () => {}
      observers.push(callback)
    },
  }
  context.document = makeDocument(elements, body)

  vm.createContext(context)
  vm.runInContext(source, context)
  return { context, warnings, observers }
}

/** Format one value through a fresh page and return the resulting text. */
function render(text, attrs = {}, options = {}) {
  const el = bound(text, attrs)
  run([el], options)
  return el.textContent
}

/* -------------------------------------------------------------- basics --- */

test('formats a CMS-bound number from the element text', () => {
  assert.equal(render('12345'), '12.3K')
  assert.equal(render('1450000'), '1.4M')
  assert.equal(render('250000'), '250K')
})

test('numbers below the first unit are left as plain digits', () => {
  assert.equal(render('135'), '135')
  assert.equal(render('0'), '0')
})

test('an explicit attribute value beats the visible text', () => {
  const el = makeElement({ 'data-millify': '1450000' }, '1,450,000')
  run([el])
  assert.equal(el.textContent, '1.4M')
})

test('thousands separators and stray whitespace still parse', () => {
  assert.equal(render('12,345'), '12.3K')
  assert.equal(render('  12 345  '), '12.3K')
})

test('rounding that overflows a unit promotes to the next one', () => {
  // 999,999 at precision 1 would otherwise render the nonsense "1000K".
  assert.equal(render('999999'), '1M')
})

test('negative values keep their sign', () => {
  assert.equal(render('-2500'), '-2.5K')
})

test('an element with no usable number is left completely alone', () => {
  assert.equal(render(''), '')
  assert.equal(render('not a number'), 'not a number')
})

/* ------------------------------------------------------------- options --- */

test('precision, space, lowercase and custom units are honoured', () => {
  assert.equal(render('1450000', { 'data-millify-precision': '2' }), '1.45M')
  assert.equal(render('1450000', { 'data-millify-space': 'true' }), '1.4 M')
  assert.equal(render('1450000', { 'data-millify-lowercase': 'true' }), '1.4m')
  assert.equal(render('1450000', { 'data-millify-units': ',k,m,bn' }), '1.4m')
})

test('an invalid precision falls back to 1 and warns on staging', () => {
  const el = bound('1450000', { 'data-millify-precision': 'lots' })
  const { warnings } = run([el], { hostname: DEV_HOST })
  assert.equal(el.textContent, '1.4M')
  assert.ok(
    warnings.some((w) => w.includes('invalid data-millify-precision')),
    'expected a precision warning, got: ' + JSON.stringify(warnings),
  )
})

/* --------------------------------------------------------- unit ceiling --- */

test('the default units stop at P, the highest the safe-integer guard allows', () => {
  assert.equal(render('9007199254740991'), '9P')
})

test('a value past the safe integer range is refused, not approximated', () => {
  // Number.MAX_SAFE_INTEGER + 1. Rendering it would imply a precision the
  // double does not have.
  assert.equal(render('9007199254740992'), '9007199254740992')
  assert.equal(render('1e18'), '1e18')
})

test('scientific notation from a CMS Number field is left visible', () => {
  // The bug that prompted this contract: a Number field at or above 1e21
  // serialises this way, and hiding it behind a tidy fallback would have
  // concealed the bad data indefinitely.
  const raw = '1.2312312312312422e+31'
  const el = bound(raw)
  run([el])
  assert.equal(el.textContent, raw)
  assert.equal(el.getAttribute('data-millify-raw'), null, 'a refusal must not record a raw value')
})

/* --------------------------------------------------------------- locale --- */

test('output is pinned to en-US whatever the visitor locale is', () => {
  // A German locale would render "1,5K" for a USD price — a typo at best.
  for (const language of ['de-DE', 'fr-FR', 'en-GB']) {
    assert.equal(render('1500', {}, { language }), '1.5K', 'locale: ' + language)
    assert.equal(render('12345', {}, { language }), '12.3K', 'locale: ' + language)
  }
})

/* ------------------------------------------------------ authored ceiling --- */

test('data-millify-max refuses anything above the ceiling', () => {
  const el = bound('12312312', { 'data-millify-max': '1000000' })
  run([el])
  assert.equal(el.textContent, '12312312')
  assert.equal(el.getAttribute('data-millify-raw'), null)
})

test('a value at or below the ceiling formats normally', () => {
  assert.equal(render('250000', { 'data-millify-max': '1000000' }), '250K')
  assert.equal(render('1000000', { 'data-millify-max': '1000000' }), '1M')
})

test('a comma-formatted ceiling is understood', () => {
  // Authors write the number the CMS shows them; a bare Number() would make
  // this NaN and drop the ceiling silently on production.
  assert.equal(render('12312312', { 'data-millify-max': '1,000,000' }), '12312312')
  assert.equal(render('250000', { 'data-millify-max': '1,000,000' }), '250K')
})

test('a zero ceiling means format nothing but zero itself', () => {
  // Zero is how an author switches formatting off. Treating it as garbage
  // would leave the element with no ceiling at all — the opposite of the ask.
  assert.equal(render('5000', { 'data-millify-max': '0' }), '5000')
  assert.equal(render('0', { 'data-millify-max': '0' }), '0')
})

test('an unusable ceiling is ignored and warns on staging', () => {
  const el = bound('12312312', { 'data-millify-max': 'lots' })
  const { warnings } = run([el], { hostname: DEV_HOST })
  assert.equal(el.textContent, '12.3M', 'an unusable ceiling must not block formatting')
  assert.ok(
    warnings.some((w) => w.includes('invalid data-millify-max')),
    'expected a ceiling warning, got: ' + JSON.stringify(warnings),
  )
})

test('a ceiling rejection names the ceiling instead of blaming the value', () => {
  // The author needs to be sent to their own attribute, not off auditing the
  // CMS field. This warning is the whole discoverability surface for the
  // feature, since production is silent by design.
  const el = bound('5000', { 'data-millify-max': '1000' })
  const { warnings } = run([el], { hostname: DEV_HOST })
  const hit = warnings.find((w) => w.includes('data-millify-max'))
  assert.ok(hit, 'expected a ceiling-rejection warning, got: ' + JSON.stringify(warnings))
  assert.ok(hit.includes('1000'), 'the warning should quote the ceiling: ' + hit)
  assert.ok(
    !hit.includes('could not format value'),
    'a ceiling rejection must not read as a malformed value: ' + hit,
  )
})

/* ----------------------------------------------------------- lifecycle --- */

test('production stays silent even when a value cannot be formatted', () => {
  const { warnings } = run([bound('not a number')], { hostname: PROD_HOST })
  assert.deepEqual(warnings, [])
})

test('STARTERS_DEBUG opts a production page into the warnings', () => {
  const { warnings } = run([bound('not a number')], { hostname: PROD_HOST, debug: true })
  assert.ok(warnings.length > 0, 'expected opt-in warnings on production')
})

test('reprocessing an already-formatted element changes nothing', () => {
  const el = bound('12345')
  const { context } = run([el])
  assert.equal(el.textContent, '12.3K')
  const raw = el.getAttribute('data-millify-raw')

  context.window.__startersMillifyInit = false
  vm.runInContext(source, context)

  assert.equal(el.textContent, '12.3K', 'a second pass must not reformat its own output')
  assert.equal(el.getAttribute('data-millify-raw'), raw)
})

test('the init guard makes a double load a no-op', () => {
  const el = bound('12345')
  const { context } = run([el])
  assert.equal(context.window.__startersMillifyInit, true)
  el.textContent = 'untouched'
  vm.runInContext(source, context)
  assert.equal(el.textContent, 'untouched', 'the second load should not have run at all')
})

test('nodes added after load are formatted by the observer', () => {
  const body = { nodeType: 1 }
  const { observers } = run([], { body })
  assert.equal(observers.length, 1, 'expected the MutationObserver to be wired')

  const late = bound('12345')
  const host = {
    nodeType: 1,
    matches: () => false,
    querySelectorAll: (sel) => (sel === '[data-millify]' ? [late] : []),
  }
  observers[0]([{ addedNodes: [host] }])
  assert.equal(late.textContent, '12.3K')
})

test('a refusal says why, so callers can tell the cases apart', () => {
  // `reason` is documented public API on the returned object.
  const { context } = run([])
  const millify = context.window.__startersMillify
  const opts = { precision: 1, units: ['', 'K', 'M'], space: false, lowercase: false }
  assert.equal(millify('nope', opts).reason, 'parse')
  assert.equal(millify('9007199254740992', opts).reason, 'range')
  assert.equal(millify('999999999', opts).reason, 'units')
  assert.equal(millify('5000', { ...opts, max: 1000 }).reason, 'max')
})

test('the pure formatter is exposed for console use', () => {
  const { context } = run([])
  const millify = context.window.__startersMillify
  assert.equal(typeof millify, 'function')
  const opts = { precision: 1, units: ['', 'K', 'M'], space: false, lowercase: false }
  // Field-by-field rather than deepEqual: the result is built inside the vm, so
  // its prototype is the vm realm's and a structural compare would fail on that.
  const result = millify('12345', opts)
  assert.equal(result.ok, true)
  assert.equal(result.text, '12.3K')
  assert.equal(result.raw, 12345)
  assert.equal(millify('nope', opts).ok, false)
  // Callers that omit `max` must be unaffected by the ceiling feature.
  assert.equal(millify('999999999', opts).ok, false, 'runs out of the supplied units')
})
