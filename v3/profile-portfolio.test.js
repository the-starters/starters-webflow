'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'profile-portfolio.js'), 'utf8')

/**
 * Minimal DOM stub. Only the surface `profile-portfolio.js` touches before it
 * decides whether to render: attribute lookups and the DOMContentLoaded listener.
 */
function classList() {
  const values = new Set()
  return {
    add(value) { values.add(value) },
    remove(value) { values.delete(value) },
    has(value) { return values.has(value) },
  }
}

function makeEnv({ response = [], responseOk = true, memberstackId = 'mem_test_starter' } = {}) {
  const listeners = {}
  const requests = []
  const appendedIds = []
  const errors = []

  const template = {
    classList: classList(),
    style: {},
    cloneNode() {
      const idBlock = { textContent: '' }
      return {
        classList: classList(),
        style: {},
        querySelector(selector) {
          if (selector === '.portfolio_card-id') return idBlock
          return null
        },
        get portfolioId() { return idBlock.textContent },
      }
    },
  }

  const wrapper = {
    attrs: {},
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
    },
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    querySelector(selector) {
      if (selector === '[wf-portfolio-element="card"]' || selector === '.portfolio_card') return template
      return null
    },
    appendChild(card) {
      appendedIds.push(Number(card.portfolioId))
    },
  }

  const section = { style: {}, classList: classList() }
  const block = { style: {}, classList: classList() }

  const document = {
    addEventListener(type, handler) {
      listeners[type] = handler
    },
    dispatch(type) {
      return listeners[type] ? listeners[type]() : undefined
    },
    querySelector(selector) {
      if (selector === '[data-highlights]' || selector === '.case-studies-wrapper') return wrapper
      if (selector === '[portfolio-section]') return section
      if (selector === '#portfolio-block') return block
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'script:not([src])') {
        return [{ textContent: "const URL = '/api:PmBJV0AG/Get_my_portfolios?memberstack_id='" }]
      }
      return []
    },
    body: { style: {} },
  }

  const window = {
    starter_memberstack_id: memberstackId,
    location: { hostname: 'the-starters-3-0.webflow.io' },
    document,
    fetch(url) {
      requests.push(url)
      return Promise.resolve({ ok: responseOk, json: () => Promise.resolve(response) })
    },
  }

  const context = {
    window,
    document,
    console: { info() {}, warn() {}, error(message) { errors.push(message) } },
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
    requests,
    appendedIds,
    errors,
    section,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test('is the single renderer and reads approved public portfolios only', async () => {
  const env = makeEnv()
  env.document.dispatch('DOMContentLoaded')
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.equal(env.requests.length, 1)
  assert.match(env.requests[0], /\/Get_approved_portfolios\?memberstack_id=mem_test_starter$/)
  assert.equal(
    env.wrapper.hasAttribute('data-portfolio-rendered'),
    true,
    'claims the wrapper so a second CDN run cannot duplicate cards',
  )
})

test('uses the current profile owner identity', async () => {
  const env = makeEnv({ memberstackId: 'mem_dynamic_profile' })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.match(env.requests[0], /memberstack_id=mem_dynamic_profile$/)
})

test('sorts approved rows deterministically before rendering', async () => {
  const env = makeEnv({ response: [{ id: 9 }, { id: 2 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.appendedIds, [2, 9])
})

test('does not treat a failed public read as an empty portfolio list', async () => {
  const env = makeEnv({ response: { code: 'blocked' }, responseOk: false })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.appendedIds, [])
  assert.equal(env.section.classList.has('hidden'), false)
  assert.deepEqual(env.errors, ['Portfolio: approved public read failed'])
})
