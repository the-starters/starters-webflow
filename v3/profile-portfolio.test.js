'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'profile-portfolio.js'), 'utf8')

/**
 * Minimal DOM stub. Only the surface `profile-portfolio.js` touches before it
 * decides whether to render: attribute lookups, inline <script> scanning, and
 * the DOMContentLoaded listener.
 */
function makeEnv({ legacyEmbedPresent }) {
  const listeners = {}
  let fetched = false

  const wrapper = {
    attrs: {},
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
    },
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    querySelector() {
      return { classList: { add() {}, remove() {} }, style: {}, querySelector: () => null }
    },
    appendChild() {},
  }

  const inlineScripts = legacyEmbedPresent
    ? [{ textContent: "const URL = '/api:PmBJV0AG/Get_my_portfolios?memberstack_id='" }]
    : [{ textContent: 'console.log("something unrelated")' }]

  const document = {
    addEventListener(type, handler) {
      listeners[type] = handler
    },
    dispatch(type) {
      return listeners[type] ? listeners[type]() : undefined
    },
    querySelector(selector) {
      if (selector === '[data-highlights]' || selector === '.case-studies-wrapper') return wrapper
      if (selector === '[portfolio-section]') return { style: {}, classList: { add() {}, remove() {} } }
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'script:not([src])') return inlineScripts
      return []
    },
    body: { style: {} },
  }

  const window = {
    starter_memberstack_id: 'mem_test_starter',
    location: { hostname: 'the-starters-3-0.webflow.io' },
    document,
    fetch() {
      fetched = true
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    },
  }

  const context = {
    window,
    document,
    console: { info() {}, warn() {}, error() {} },
    fetch: window.fetch,
    setTimeout,
    Promise,
    encodeURIComponent,
  }
  context.globalThis = context

  vm.createContext(context)
  vm.runInContext(SOURCE, context)

  return {
    document,
    wrapper,
    didFetch: () => fetched,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test('stands down entirely while the legacy on-canvas embed is still installed', async () => {
  // The legacy embed has no guard of its own, so "whoever runs first wins" would
  // append a SECOND set of cards. This script must not render at all until the
  // embed is deleted in the Designer.
  const env = makeEnv({ legacyEmbedPresent: true })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.didFetch(), false, 'must not request portfolios while the embed is live')
  assert.equal(
    env.wrapper.hasAttribute('data-portfolio-rendered'),
    false,
    'must not claim the wrapper while the embed is live',
  )
})

test('takes over once the legacy embed has been removed', async () => {
  const env = makeEnv({ legacyEmbedPresent: false })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.didFetch(), true, 'requests portfolios once it owns the section')
  assert.equal(
    env.wrapper.hasAttribute('data-portfolio-rendered'),
    true,
    'claims the wrapper so a second run cannot duplicate cards',
  )
})

test('does not hardcode a starter memberstack id', () => {
  // The embed carried one starter's literal id because the value came from a CMS
  // binding; copying that verbatim would show every visitor the same portfolios.
  assert.equal(/mem_[a-z0-9]{20,}/.test(SOURCE), false)
  assert.ok(SOURCE.includes('window.starter_memberstack_id'))
})

test('hides the modal Images block when a portfolio has no images', () => {
  // Every imported legacy case study is text-only; without this the modal shows
  // an empty "Images" heading. Mirrors the pre-existing Videos behaviour.
  assert.ok(SOURCE.includes('toggleModalBlock(modalImages, images.length > 0)'))
  assert.ok(SOURCE.includes('toggleModalBlock(modalVideos, videos.length > 0)'))
})
