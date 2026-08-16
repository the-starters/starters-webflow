/**
 * Guards for the footer -> GitHub port of the /hire profile renderer.
 *
 * These cover the ways THIS MIGRATION could regress, not the renderer's whole
 * behaviour: the file must survive missing page globals instead of throwing
 * (an uncaught ReferenceError at top level would abort every section), each
 * former <script> keeps its own scope, and the Algolia index stays page-derived.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./hire-profile.js'), 'utf8')

function element(attrs = {}) {
  const attributes = { ...attrs }
  return {
    attributes,
    style: {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null
    },
    setAttribute(name, value) {
      attributes[name] = String(value)
    },
    removeAttribute(name) {
      delete attributes[name]
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  }
}

/** Minimal page: no Memberstack helpers, no jQuery, nothing but a bare DOM. */
function bareContext(overrides = {}) {
  const warnings = []
  const documentObject = {
    documentElement: element(),
    body: element(),
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  const context = {
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')), error() {}, log() {} },
    document: documentObject,
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Map,
    Set,
    JSON,
    fetch: () => Promise.reject(new Error('no network in test')),
    IntersectionObserver: function () {
      return { observe() {} }
    },
    MutationObserver: function () {
      return { observe() {} }
    },
    getComputedStyle: () => ({ display: 'block', cursor: 'auto' }),
    innerWidth: 1280,
    ...overrides,
  }
  context.window = context
  context.warnings = warnings
  return context
}

test('a page missing the Memberstack helpers stands down instead of throwing', () => {
  const context = bareContext()
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  assert.ok(
    context.warnings.some((line) => line.includes('[hire-profile]') && line.includes('stood down')),
    'expected a [hire-profile] stand-down warning, got: ' + JSON.stringify(context.warnings),
  )
})

test('a page missing starter_memberstack_id stands down instead of throwing', () => {
  const context = bareContext({
    qs: () => null,
    qsa: () => [],
    waitForMember: () => Promise.resolve({}),
    memberReady: Promise.resolve({}),
  })
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  assert.ok(
    context.warnings.some((line) => line.includes('starter_memberstack_id')),
    'expected a warning naming the missing global, got: ' + JSON.stringify(context.warnings),
  )
})

test('the jQuery-only blocks are skipped, not fatal, when jQuery is absent', () => {
  const context = bareContext({
    qs: () => null,
    qsa: () => [],
    waitForMember: () => Promise.resolve({}),
    memberReady: Promise.resolve({}),
    starter_memberstack_id: 'mem_test',
  })
  vm.createContext(context)

  assert.doesNotThrow(() => vm.runInContext(source, context))
  const skipped = context.warnings.filter((line) => line.includes('jQuery missing'))
  assert.equal(skipped.length, 2, 'both jQuery blocks should report themselves skipped')
})

test('each former footer <script> keeps its own scope', () => {
  // Two of the original blocks declare `el` at top level. If the port merged
  // them into one scope this file would not even parse, so assert the shape.
  const iifeCount = source.split('\n').filter((line) => line === '(function () {').length
  assert.equal(iifeCount, 8, 'expected one top-level IIFE per original <script> block')
  assert.doesNotThrow(() => new vm.Script(source), 'file must parse')
})

test('the Algolia index is read from the page, never hardcoded as the live index', () => {
  assert.match(
    source,
    /getAttribute\('wf-algolia-index'\)/,
    'the index must come from the page attribute that algolia-environment.js rewrites',
  )
  assert.doesNotMatch(
    source,
    /getObject\(\s*'Freelancers3\.0-/,
    'passing a literal index to getObject 403s under the rotated search key',
  )
})

test('cloned rate cards keep signup attribution and drop the booking wiring', () => {
  // Logged-out clicks reach the signup modal only via data-signup-trigger-*;
  // leaving the booking attributes on a non-bookable card opens an empty popup.
  const stripped = source.match(/\[([^\]]*)\]\.forEach\(function \(attr\) \{\s*el\.removeAttribute/)
  assert.ok(stripped, 'expected the rate-card attribute strip list')
  const list = stripped[1]
  for (const attr of ['data-modal-trigger', 'booking-popup-open', 'data-type']) {
    assert.ok(list.includes(attr), `${attr} must be stripped from cloned rate cards`)
  }
  assert.ok(
    !list.includes('data-signup-trigger'),
    'signup-trigger attributes must survive on cloned rate cards',
  )
  assert.match(source, /setAttribute\('data-signup-trigger-value', card\.title\)/)
})
