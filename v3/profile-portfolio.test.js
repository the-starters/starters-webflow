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

function makeEnv({
  response = [],
  responseOk = true,
  responsePromise,
  memberstackId = 'mem_test_starter',
} = {}) {
  const listeners = {}
  const requests = []
  const appendedIds = []
  const appendedCards = []
  const errors = []

  function addListener(store, type, handler) {
    if (!store[type]) store[type] = []
    store[type].push(handler)
  }

  function dispatchListeners(store, type, event = {}) {
    return Promise.all((store[type] || []).map((handler) => handler(event)))
  }

  function interactiveElement(attributes = {}, classes = []) {
    const elementListeners = {}
    const attrs = { ...attributes }
    return {
      attrs,
      classList: {
        contains(value) { return classes.includes(value) },
      },
      focused: false,
      addEventListener(type, handler) { addListener(elementListeners, type, handler) },
      click(target = this) {
        return dispatchListeners(elementListeners, 'click', {
          target,
          preventDefault() {},
        })
      },
      closest(selector) {
        const attributeMatch = Object.entries(attrs).some(([name, value]) =>
          selector.includes(`[${name}="${value}"]`) || (value === '' && selector.includes(`[${name}]`)),
        )
        const classMatch = classes.some((name) => selector.includes(`.${name}`))
        return attributeMatch || classMatch ? this : null
      },
      focus() { this.focused = true },
    }
  }

  const modalContent = { scrollTop: 25 }
  const modalScrim = interactiveElement({ 'wf-portfolio-element': 'scrim' })
  const modalClose = interactiveElement({ 'wf-portfolio-element': 'close' })
  const modalListeners = {}
  const modal = {
    style: { display: 'flex' },
    addEventListener(type, handler) { addListener(modalListeners, type, handler) },
    click(target) {
      return dispatchListeners(modalListeners, 'click', {
        target,
        preventDefault() {},
      })
    },
    querySelector(selector) {
      if (selector === '[wf-portfolio-element="content"]') return modalContent
      if (selector === '[wf-portfolio-element="scrim"]') return modalScrim
      return null
    },
  }

  const template = {
    classList: classList(),
    style: {},
    cloneNode() {
      const idBlock = { textContent: '' }
      const openButton = interactiveElement({ 'wf-portfolio-element': 'open' })
      return {
        classList: classList(),
        style: {},
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = value },
        querySelector(selector) {
          if (selector === '.portfolio_card-id') return idBlock
          if (selector === '[wf-portfolio-element="open"]') return openButton
          return null
        },
        openButton,
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
    querySelectorAll(selector) {
      if (selector === '[data-portfolio-item]') {
        return appendedCards.filter((card) =>
          Object.prototype.hasOwnProperty.call(card.attrs, 'data-portfolio-item'),
        )
      }
      return []
    },
    appendChild(card) {
      appendedCards.push(card)
      appendedIds.push(Number(card.portfolioId))
    },
  }

  const buttonListeners = []
  const viewAllButton = {
    style: {},
    addEventListener(type, handler) {
      if (type === 'click') buttonListeners.push(handler)
    },
    click() {
      const event = { preventDefault() {} }
      buttonListeners.forEach((handler) => handler(event))
    },
  }

  const section = { style: {}, classList: classList() }
  const block = { style: {}, classList: classList() }

  const document = {
    addEventListener(type, handler) {
      addListener(listeners, type, handler)
    },
    dispatch(type, event) {
      return dispatchListeners(listeners, type, event)
    },
    querySelector(selector) {
      if (selector === '[data-highlights]' || selector === '.case-studies-wrapper') return wrapper
      if (selector === '[portfolio-section]') return section
      if (selector === '#portfolio-block') return block
      if (selector === '[data-btn-view-all]') return viewAllButton
      if (selector === '[wf-portfolio-element="modal"]') return modal
      return null
    },
    querySelectorAll(selector) {
      if (selector === 'script:not([src])') {
        return [{ textContent: "const URL = '/api:PmBJV0AG/Get_my_portfolios?memberstack_id='" }]
      }
      return []
    },
    activeElement: null,
    body: { style: {} },
  }

  const window = {
    starter_memberstack_id: memberstackId,
    location: { hostname: 'the-starters-3-0.webflow.io' },
    document,
    fetch(url) {
      requests.push(url)
      if (url.includes('/Get_approved_portfolios?')) {
        return responsePromise || Promise.resolve({ ok: responseOk, json: () => Promise.resolve(response) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
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
    appendedCards,
    errors,
    section,
    viewAllButton,
    modal,
    modalContent,
    modalScrim,
    modalClose,
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
  const rows = [
    { id: 2 },
    { id: 10, ordinal: 2 },
    { id: 1, ordinal: null },
    { id: 7, ordinal: 1 },
  ]
  const forward = makeEnv({ response: rows })
  const reverse = makeEnv({ response: rows.slice().reverse() })
  forward.document.dispatch('DOMContentLoaded')
  reverse.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(forward.appendedIds, [7, 10, 1, 2])
  assert.deepEqual(reverse.appendedIds, [7, 10, 1, 2])
})

test('shows three case studies first and reveals all from View all', async () => {
  const env = makeEnv({ response: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(
    env.appendedCards.map((card) => card.style.display),
    ['', '', '', 'none', 'none'],
  )
  assert.equal(env.viewAllButton.style.display, '')

  env.viewAllButton.click()

  assert.deepEqual(env.appendedCards.map((card) => card.style.display), ['', '', '', '', ''])
  assert.equal(env.viewAllButton.style.display, 'none')
})

test('hides View all when the profile has three or fewer case studies', async () => {
  const env = makeEnv({ response: [{ id: 1 }, { id: 2 }, { id: 3 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.appendedCards.map((card) => card.style.display), ['', '', ''])
  assert.equal(env.viewAllButton.style.display, 'none')
})

test('gates View all during a delayed read and ignores an early click', async () => {
  let resolveResponse
  const responsePromise = new Promise((resolve) => { resolveResponse = resolve })
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
  const env = makeEnv({ responsePromise })

  env.document.dispatch('DOMContentLoaded')

  assert.equal(env.viewAllButton.style.display, 'none')
  env.viewAllButton.click()
  assert.deepEqual(env.appendedCards, [])

  resolveResponse({ ok: true, json: () => Promise.resolve(rows) })
  await settle()

  assert.deepEqual(
    env.appendedCards.map((card) => card.style.display),
    ['', '', '', 'none', 'none'],
  )
  assert.equal(env.viewAllButton.style.display, '')

  env.viewAllButton.click()

  assert.deepEqual(env.appendedCards.map((card) => card.style.display), ['', '', '', '', ''])
  assert.equal(env.viewAllButton.style.display, 'none')
})

test('does not treat a failed public read as an empty portfolio list', async () => {
  const env = makeEnv({ response: { code: 'blocked' }, responseOk: false })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  assert.deepEqual(env.appendedIds, [])
  assert.equal(env.section.classList.has('hidden'), false)
  assert.deepEqual(env.errors, ['Portfolio: approved public read failed'])
})

test('closes the modal from the custom-attribute close control', async () => {
  const env = makeEnv({ response: [{ id: 1, title: 'Case study' }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()

  env.appendedCards[0].openButton.click()
  await settle()
  assert.equal(env.modal.style.display, 'flex')
  assert.equal(env.document.body.style.overflow, 'hidden')

  await env.modal.click(env.modalClose)

  assert.equal(env.modal.style.display, 'none')
  assert.equal(env.document.body.style.overflow, '')
  assert.equal(env.modalContent.scrollTop, 0)
  assert.equal(env.appendedCards[0].openButton.focused, true)
})

test('closes the modal from the custom-attribute scrim', async () => {
  const env = makeEnv({ response: [{ id: 1 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()
  env.appendedCards[0].openButton.click()
  await settle()

  await env.modal.click(env.modalScrim)

  assert.equal(env.modal.style.display, 'none')
})

test('closes the open modal with Escape', async () => {
  const env = makeEnv({ response: [{ id: 1 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()
  env.appendedCards[0].openButton.click()
  await settle()

  await env.document.dispatch('keydown', { key: 'Escape', preventDefault() {} })

  assert.equal(env.modal.style.display, 'none')
})

test('keeps the modal open for clicks inside its content', async () => {
  const env = makeEnv({ response: [{ id: 1 }] })
  env.document.dispatch('DOMContentLoaded')
  await settle()
  env.appendedCards[0].openButton.click()
  await settle()

  await env.modal.click(env.modalContent)

  assert.equal(env.modal.style.display, 'flex')
})
