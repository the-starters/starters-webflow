const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./canonical-profile-loader.js'), 'utf8')

function element(tag) {
  return {
    tagName: tag,
    attrs: {},
    children: [],
    style: {},
    textContent: '',
    listeners: {},
    setAttribute(name, value) { this.attrs[name] = String(value) },
    appendChild(child) { this.children.push(child); return child },
    addEventListener(type, fn) { this.listeners[type] = fn },
  }
}

function load({ authored = null } = {}) {
  const body = element('body')
  const document = {
    body,
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn },
    createElement: element,
    querySelector(selector) {
      if (selector === '[data-profile-load-error]') return authored
      if (selector === '[data-profile-load-error-banner]') {
        return body.children.find((child) => 'data-profile-load-error-banner' in child.attrs) || null
      }
      return null
    },
  }
  const window = { addEventListener() {}, location: { reloaded: 0, reload() { this.reloaded += 1 } } }
  window.window = window
  const context = vm.createContext({ window, document, Set, Map, String, Array, Object, setTimeout, clearTimeout })
  vm.runInContext(source, context)
  return { context, body, window }
}

{
  const { context, body, window } = load()
  const banner = context.showProfileLoadError()
  assert.equal(body.children.length, 1, 'a failed profile read adds one visible notice')
  assert.equal(banner.attrs.role, 'alert', 'the notice is announced')
  assert.match(banner.children[0].textContent, /could not load/, 'the notice says what failed')
  banner.children[1].listeners.click()
  assert.equal(window.location.reloaded, 1, 'the Reload button reloads the page')
  assert.equal(context.showProfileLoadError(), banner, 'a second failure does not add a second notice')
  assert.equal(body.children.length, 1)
}

{
  const authored = element('div')
  authored.style.display = 'none'
  const { context, body } = load({ authored })
  assert.equal(context.showProfileLoadError(), authored, 'an authored notice element is used first')
  assert.equal(authored.style.display, '', 'the authored notice is shown')
  assert.match(authored.textContent, /could not load/)
  assert.equal(body.children.length, 0, 'no banner is added when the page authors its own notice')
}
