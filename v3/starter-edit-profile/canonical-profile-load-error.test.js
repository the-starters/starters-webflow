const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./canonical-profile-loader.js'), 'utf8')

function element(tag) {
  return {
    tagName: tag,
    attrs: {},
    children: [],
    parent: null,
    style: {},
    _text: '',
    listeners: {},
    get textContent() { return this._text },
    set textContent(value) {
      this._text = String(value)
      this.children = []
    },
    setAttribute(name, value) { this.attrs[name] = String(value) },
    hasAttribute(name) { return name in this.attrs },
    appendChild(child) { child.parent = this; this.children.push(child); return child },
    remove() {
      if (!this.parent) return
      this.parent.children = this.parent.children.filter((child) => child !== this)
      this.parent = null
    },
    addEventListener(type, fn) { this.listeners[type] = fn },
    querySelector(selector) {
      const name = selector.slice(1, -1)
      for (const child of this.children) {
        if (child.hasAttribute(name)) return child
        const found = child.querySelector(selector)
        if (found) return found
      }
      return null
    },
    dispatchEvent() {},
    options: [],
    value: '',
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

function load({ authored = null, fetch = async () => okResponse({}) } = {}) {
  const body = element('body')
  if (authored) body.appendChild(authored)
  const timers = []
  const loader = []
  const document = {
    body,
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn },
    createElement: element,
    querySelector(selector) { return body.querySelector(selector) },
  }
  const window = { addEventListener() {}, location: { reloaded: 0, reload() { this.reloaded += 1 } } }
  window.window = window
  const context = vm.createContext({
    window, document, Set, Map, String, Array, Object, Number, JSON, URL, Promise, console: { log() {}, warn() {}, error() {} },
    Event: function Event(type) { this.type = type },
    setTimeout(fn, ms) { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer },
    clearTimeout(timer) { if (timer) timer.cleared = true },
    setInterval(fn) { const timer = { fn, interval: true, cleared: false }; timers.push(timer); return timer },
    clearInterval(timer) { if (timer) timer.cleared = true },
    setLoader(on) { loader.push(on) },
    waitForMember(fn) { fn() },
    MEMBER: { id: 'mem_1' },
    xanoAuthFetch: fetch,
    locationsReady: true,
    qs() { return element('select') },
    qsa() { return [] },
    createEmptyProfile() { return { data: {} } },
  })
  vm.runInContext(source, context)
  return { context, body, window, timers, loader, start: () => document.listeners.DOMContentLoaded() }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function watchdog(timers) {
  return timers.find((timer) => timer.ms === 30000)
}

async function runIntervals(timers) {
  for (const timer of timers.filter((t) => t.interval && !t.cleared)) await timer.fn()
  await flush()
}

function banner(body) {
  return body.children.find((child) => child.hasAttribute('data-profile-load-error-banner')) || null
}

async function main() {
  {
    const { context, body, window } = load()
    const notice = context.showProfileLoadError()
    assert.equal(body.children.length, 1, 'a failed profile read adds one visible notice')
    assert.equal(notice.attrs.role, 'alert', 'the notice is announced')
    assert.match(notice.children[0].textContent, /could not load/, 'the notice says what failed')
    notice.children[1].listeners.click()
    assert.equal(window.location.reloaded, 1, 'the Reload button reloads the page')
    assert.equal(context.showProfileLoadError(), notice, 'a second failure does not add a second notice')
    assert.equal(body.children.length, 1)
  }

  {
    const authored = element('div')
    authored.setAttribute('data-profile-load-error', '')
    authored.style.display = 'none'
    const { context, body, window } = load({ authored })
    assert.equal(context.showProfileLoadError(), authored, 'an authored notice element is used first')
    assert.equal(authored.style.display, 'block', 'the authored notice is shown even when a class hides it')
    assert.match(authored.textContent, /could not load/)
    const reload = authored.children.find((child) => child.tagName === 'button')
    assert.ok(reload, 'a Reload control is added to the authored notice')
    reload.listeners.click()
    assert.equal(window.location.reloaded, 1)
    assert.equal(banner(body), null, 'no banner is added when the page authors its own notice')
  }

  {
    const authored = element('div')
    authored.setAttribute('data-profile-load-error', '')
    const message = authored.appendChild(element('p'))
    message.setAttribute('data-profile-load-error-message', '')
    const reload = authored.appendChild(element('a'))
    reload.setAttribute('data-profile-load-error-reload', '')
    const { context, window } = load({ authored })
    context.showProfileLoadError()
    assert.match(message.textContent, /could not load/, 'the message goes into the authored message slot')
    assert.deepEqual(authored.children, [message, reload], 'authored children are kept')
    let prevented = false
    reload.listeners.click({ preventDefault() { prevented = true } })
    assert.equal(window.location.reloaded, 1, 'the authored Reload control reloads the page')
    assert.ok(prevented)
  }

  {
    const { body, timers, loader, start } = load({ fetch: async () => ({ ok: false, status: 500 }) })
    start()
    await flush()
    assert.match(banner(body).children[0].textContent, /could not load/, 'a failed read shows the notice')
    assert.deepEqual(loader, [true], 'the loader stays up over the empty form')
    watchdog(timers).fn()
    assert.equal(body.children.length, 1, 'the watchdog does not add a second notice')
  }

  {
    const read = deferred()
    const { body, timers, loader, start } = load({ fetch: () => read.promise })
    start()
    await flush()
    assert.equal(banner(body), null, 'no notice while the read is still in flight')
    watchdog(timers).fn()
    assert.match(banner(body).children[0].textContent, /could not load/, 'a hung read shows the notice after the watchdog')
    assert.deepEqual(loader, [true])

    read.resolve(okResponse({ Profile_Type: 'full', Also_Worked_With: [] }))
    await flush()
    await runIntervals(timers)
    assert.equal(banner(body), null, 'a late good load removes the notice')
  }

  {
    const { body, timers, start } = load({ fetch: async () => okResponse({ Profile_Type: 'full', Also_Worked_With: [] }) })
    start()
    await flush()
    await runIntervals(timers)
    assert.ok(watchdog(timers).cleared, 'a good load cancels the watchdog')
    assert.equal(banner(body), null, 'no notice remains after a good load')
    const hide = timers.find((timer) => timer.ms === 300)
    assert.ok(hide, 'a good load schedules the loader to hide')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
