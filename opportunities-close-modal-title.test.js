const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'opportunities-3.0.js'), 'utf8')

class FakeTitle {
  constructor(status) {
    this.attributes = new Map([['data-opp-status', status]])
    this.style = {}
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }
}

function loadBridge() {
  const documentElement = {
    appendChild() {},
    getAttribute: () => null,
    setAttribute() {},
  }
  const document = {
    addEventListener() {},
    createElement: () => ({ addEventListener() {}, setAttribute() {}, style: {} }),
    documentElement,
    getElementById: () => null,
    head: documentElement,
    querySelector: () => null,
    querySelectorAll: () => [],
    readyState: 'loading',
  }
  const window = {
    addEventListener() {},
    clearInterval,
    clearTimeout,
    dispatchEvent() {},
    setInterval,
    setTimeout,
  }
  window.window = window
  vm.runInNewContext(source, {
    CustomEvent: class CustomEvent {},
    FormData,
    Headers,
    MutationObserver: class MutationObserver {},
    Request,
    URL,
    URLSearchParams,
    alert() {},
    console: { error() {}, info() {}, log() {}, warn() {} },
    document,
    fetch: async () => {
      throw new Error('unexpected fetch')
    },
    history: { replaceState() {} },
    location: {
      href: 'https://example.test/all-modals',
      hostname: 'example.test',
      pathname: '/all-modals',
      search: '',
    },
    window,
  })
  return window.Opp30
}

function closeModal() {
  const confirm = new FakeTitle('active')
  const success = new FakeTitle('closed')
  const titles = [confirm, success]
  return {
    confirm,
    modal: {
      querySelectorAll(selector) {
        if (selector === '.modal_nav [data-opp-status]') {
          return titles.filter((title) => title.getAttribute('data-opp-status') !== null)
        }
        if (selector === '[data-close-opp-title]') {
          return titles.filter((title) => title.getAttribute('data-close-opp-title') !== null)
        }
        return []
      },
    },
    success,
  }
}

test('close modal shows only confirmation title on open and only success title after close', () => {
  const bridge = loadBridge()
  const { confirm, modal, success } = closeModal()

  bridge.paintCloseOpportunityModalTitle(modal, 'confirm')

  assert.equal(confirm.getAttribute('data-close-opp-title'), 'confirm')
  assert.equal(success.getAttribute('data-close-opp-title'), 'success')
  assert.equal(confirm.getAttribute('data-opp-status'), null)
  assert.equal(success.getAttribute('data-opp-status'), null)
  assert.equal(confirm.style.display, '')
  assert.equal(success.style.display, 'none')

  bridge.paintCloseOpportunityModalTitle(modal, 'success')

  assert.equal(confirm.style.display, 'none')
  assert.equal(success.style.display, '')
})
