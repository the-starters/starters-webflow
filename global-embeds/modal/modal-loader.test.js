'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { h } = require('../../step-flow-test-dom')

const modalSource = fs.readFileSync(path.join(__dirname, 'modal.js'), 'utf8')
const loaderPath = path.join(__dirname, 'modal-loader.js')
const host = 'the-starters-3-0.webflow.io'
const cssHref = `https://${host}/css/site.webflow.source-page.hash.css`

function element(tag, attrs = {}, children = []) {
  const el = h(tag, attrs, children)
  el.remove = () => {
    if (!el.parentElement) return
    const siblings = el.parentElement.children
    siblings.splice(siblings.indexOf(el), 1)
    el.parentElement = null
  }
  el.open = false
  el.showModal = () => { el.open = true }
  el.close = () => { el.open = false }
  el.focus = () => {}
  return el
}

function clone(el) {
  return element(el.tagName, Object.fromEntries(el._attrs), el.children.map(clone))
}

function sourceDialog(key = 'marketing-expert', children = []) {
  return element('dialog', {
    class: 'modal_dialog', 'data-popup-source': key,
    'data-modal-target': 'shared-old-key', 'data-preview': 'True',
    'data-script-initialized': 'true', open: '',
  }, children)
}

function environment({ hostname = host, dialogs = [sourceDialog()], css = 'load', fetcher, bootModal = true, readyState = 'complete', now = Date.now } = {}) {
  const head = element('head')
  const body = element('body')
  const root = element('html', {}, [head, body])
  const sourceRoot = element('html', { 'data-wf-page': 'source-page' }, [
    element('link', { rel: 'stylesheet', href: '/css/site.webflow.source-page.hash.css' }),
    ...dialogs,
  ])
  const listeners = new Map()
  const events = []
  const calls = []
  const warnings = []
  const location = new URL(`https://${hostname}/home`)
  const document = {
    head, body, activeElement: body, readyState,
    querySelectorAll: (s) => root.querySelectorAll(s),
    querySelector: (s) => root.querySelector(s),
    getElementById: () => null,
    addEventListener(type, fn) {
      const list = listeners.get(type) || []
      list.push(fn)
      listeners.set(type, list)
    },
    importNode: clone,
    createElement: (tag) => element(tag),
  }
  const append = head.append.bind(head)
  head.append = (el) => {
    append(el)
    if (css !== 'hang') queueMicrotask(() => {
      if (css === 'error') el.onerror?.()
      else el.onload?.()
    })
    return el
  }
  const window = { document, location, dispatchEvent: (event) => events.push(event) }
  const context = vm.createContext({
    window, document, location, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    Date: { now },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail } },
    console: { warn: (...args) => warnings.push(args), info() {}, error() {} },
    DOMParser: class {
      parseFromString(value, type) {
        assert.equal(value, '<source>')
        assert.equal(type, 'text/html')
        return { documentElement: sourceRoot, querySelectorAll: (s) => sourceRoot.querySelectorAll(s) }
      }
    },
    fetch: (url, options) => {
      calls.push({ url: String(url), options })
      return fetcher ? fetcher(url, options) : Promise.resolve({ ok: true, url: String(url), text: async () => '<source>' })
    },
  })
  function startModal() {
    vm.runInContext(modalSource, context)
    for (const fn of listeners.get('DOMContentLoaded') || []) fn()
  }
  if (bootModal) startModal()
  const loader = fs.existsSync(loaderPath) ? fs.readFileSync(loaderPath, 'utf8') : ''
  vm.runInContext(loader, context)
  return { window, document, head, body, calls, events, warnings, startModal, reload: () => vm.runInContext(loader, context) }
}

test('source calls share one promise-backed fetch and the same parsed Document', async () => {
  const env = environment()
  const [a, b] = await Promise.all([
    env.window.lumos.modal.source('/modals'),
    env.window.lumos.modal.source(`https://${host}/modals`),
  ])
  assert.ok(a)
  assert.equal(a, b)
  assert.equal(env.calls.length, 1)
  assert.equal(env.calls[0].options.redirect, 'error')
  assert.equal(env.head.children.length, 0)
  assert.equal(env.body.children.length, 0)
})

test('source and load reuse the parsed source without mutating it', async () => {
  const env = environment()
  const doc = await env.window.lumos.modal.source('/modals')
  const entry = await env.window.lumos.modal.load('/modals', 'marketing-expert', { open: true })
  assert.ok(entry)
  assert.equal(entry.el.open, true)
  assert.equal(env.calls.length, 1)
  assert.equal(doc.querySelectorAll('dialog')[0].getAttribute('data-modal-target'), 'shared-old-key')
  assert.equal(doc.querySelectorAll('dialog')[0].hasAttribute('data-preview'), true)
  assert.equal(await env.window.lumos.modal.source('/modals'), doc)
})

test('failed source requests are removed from the cache and can retry', async () => {
  let attempts = 0
  const env = environment({ fetcher: async (url) => {
    attempts += 1
    if (attempts === 1) throw new Error('Network unavailable')
    return { ok: true, url: String(url), text: async () => '<source>' }
  } })
  assert.equal(await env.window.lumos.modal.source('/modals'), null)
  assert.ok(await env.window.lumos.modal.source('/modals'))
  assert.equal(env.calls.length, 2)
})

test('source rejects cross-origin and malformed URLs without fetching', async () => {
  const env = environment()
  for (const url of ['https://example.com/modals', 'https://[invalid']) {
    assert.equal(await env.window.lumos.modal.source(url), null)
  }
  assert.equal(env.calls.length, 0)
})

test('source keeps failures uncached for HTTP errors and cross-origin responses', async () => {
  for (const response of [{ ok: false }, { ok: true, url: 'https://example.com/modals' }]) {
    const env = environment({ fetcher: async () => response })
    assert.equal(await env.window.lumos.modal.source('/modals'), null)
    assert.equal(await env.window.lumos.modal.source('/modals'), null)
    assert.equal(env.calls.length, 2)
  }
})

test('source caches each absolute URL independently and is inert on production', async () => {
  const env = environment()
  await env.window.lumos.modal.source('/one')
  await env.window.lumos.modal.source('/two')
  await env.window.lumos.modal.source('/one')
  assert.equal(env.calls.length, 2)
  for (const hostname of ['www.thestarters.com', 'thestarters.com']) {
    const prod = environment({ hostname })
    assert.equal(await prod.window.lumos.modal.source('/modals'), null)
    assert.equal(prod.calls.length, 0)
  }
})

test('source times out at the default deadline and aborts even when fetch ignores it', async () => {
  const env = environment({ fetcher: () => new Promise(() => {}) })
  assert.equal(await env.window.lumos.modal.source('/modals'), null)
  assert.equal(env.calls[0].options.signal.aborted, true)
  assert.equal(env.body.children.length, 0)
  assert.equal(env.head.children.length, 0)
})

test('loads, registers and opens the keyed dialog and imports page CSS once', async () => {
  const env = environment()
  const entry = await env.window.lumos.modal.load('/modals', 'marketing-expert', { open: true })
  assert.equal(env.body.children.length, 1)
  assert.equal(entry.el, env.body.children[0])
  assert.equal(entry.el.getAttribute('data-modal-target'), 'marketing-expert')
  assert.equal(entry.el.getAttribute('data-popup-loaded'), 'marketing-expert')
  assert.equal(entry.el.hasAttribute('data-preview'), false)
  assert.equal(entry.el.hasAttribute('open'), false)
  assert.equal(entry.el.dataset.scriptInitialized, 'true')
  assert.equal(env.window.lumos.modal.list['marketing-expert'], entry)
  assert.equal(entry.el.open, true)
  assert.equal(env.head.children.length, 1)
  assert.equal(env.head.children[0].href, cssHref)
  assert.deepEqual(env.events.map((e) => e.type), ['modal-open'])
})

test('missing source key leaves body and head unchanged', async () => {
  const env = environment()
  assert.equal(await env.window.lumos.modal.load('/modals', 'missing'), null)
  assert.equal(env.body.children.length, 0)
  assert.equal(env.head.children.length, 0)
})

test('duplicate source keys leave body and head unchanged', async () => {
  const env = environment({ dialogs: [sourceDialog(), sourceDialog()] })
  assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert'), null)
  assert.equal(env.body.children.length, 0)
  assert.equal(env.head.children.length, 0)
})

test('cross-origin URLs never fetch', async () => {
  const env = environment()
  assert.equal(await env.window.lumos.modal.load('https://example.com/modals', 'marketing-expert'), null)
  assert.equal(env.calls.length, 0)
  assert.equal(env.body.children.length, 0)
})

test('fetch timeout aborts and leaves nothing behind even if fetch ignores abort', async () => {
  const env = environment({ fetcher: () => new Promise(() => {}) })
  assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert', { timeoutMs: 15 }), null)
  assert.equal(env.body.children.length, 0)
  assert.equal(env.head.children.length, 0)
})

test('already loaded target resolves to the same entry with no second fetch or dialog', async () => {
  const env = environment()
  const first = await env.window.lumos.modal.load('/modals', 'marketing-expert')
  const second = await env.window.lumos.modal.load('/modals', 'marketing-expert', { open: true })
  assert.equal(second, first)
  assert.equal(first.el.open, true)
  assert.equal(env.body.children.length, 1)
  assert.equal(env.head.children.length, 1)
  assert.equal(env.calls.length, 1)
})

test('rewrites relative href/src, preserves fragment hrefs and strips scripts', async () => {
  const env = environment({ dialogs: [sourceDialog('marketing-expert', [
    element('img', { src: '../portrait.jpg' }), element('a', { href: 'booking' }),
    element('a', { href: '#details' }), element('script'),
  ])] })
  const { el } = await env.window.lumos.modal.load('/sources/modals', 'marketing-expert')
  assert.equal(el.querySelector('img').getAttribute('src'), `https://${host}/portrait.jpg`)
  assert.equal(el.querySelectorAll('a')[0].getAttribute('href'), `https://${host}/sources/booking`)
  assert.equal(el.querySelectorAll('a')[1].getAttribute('href'), '#details')
  assert.equal(el.querySelectorAll('script').length, 0)
})

test('both production hosts are no-ops even with debug enabled', async () => {
  for (const hostname of ['www.thestarters.com', 'thestarters.com']) {
    const env = environment({ hostname })
    env.window.STARTERS_DEBUG = true
    assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert', { open: true }), null)
    assert.equal(env.calls.length, 0)
    assert.equal(env.body.children.length, 0)
    assert.equal(env.head.children.length, 0)
  }
})

test('relative srcset candidates are rewritten without changing descriptors or data URLs', async () => {
  const env = environment({ dialogs: [sourceDialog('marketing-expert', [element('img', {
    srcset: '../small.jpg 500w, /large.jpg 1000w, https://example.com/full.jpg 2000w, data:image/png;base64,AAAA 1x',
  })])] })
  const { el } = await env.window.lumos.modal.load('/sources/modals', 'marketing-expert')
  assert.equal(el.querySelector('img').getAttribute('srcset'),
    `https://${host}/small.jpg 500w, https://${host}/large.jpg 1000w, https://example.com/full.jpg 2000w, data:image/png;base64,AAAA 1x`)
})

test('stylesheet timeout and error remove the link this call created', async () => {
  for (const css of ['hang', 'error']) {
    const env = environment({ css })
    assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert', { timeoutMs: 15 }), null)
    assert.equal(env.body.children.length, 0)
    assert.equal(env.head.children.length, 0)
  }
})

test('failed registration removes its dialog and stylesheet', async () => {
  const env = environment()
  env.window.lumos.modal.init = () => {}
  assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert'), null)
  assert.equal(env.body.children.length, 0)
  assert.equal(env.head.children.length, 0)
  assert.equal(env.window.lumos.modal.list['marketing-expert'], undefined)
})

test('existing page stylesheet is preserved and target alias is respected', async () => {
  const env = environment()
  env.head.append(element('link', { rel: 'stylesheet', href: cssHref }))
  const entry = await env.window.lumos.modal.load('/modals', 'marketing-expert', { as: 'test-alias' })
  assert.equal(entry.el.getAttribute('data-modal-target'), 'test-alias')
  assert.equal(env.window.lumos.modal.list['test-alias'], entry)
  assert.equal(env.head.children.length, 1)
})

test('concurrent loads for one target share one dialog', async () => {
  const env = environment()
  const [a, b] = await Promise.all([
    env.window.lumos.modal.load('/modals', 'marketing-expert'),
    env.window.lumos.modal.load('/modals', 'marketing-expert', { open: true }),
  ])
  assert.equal(a, b)
  assert.equal(a.el.open, true)
  assert.equal(env.calls.length, 1)
  assert.equal(env.body.children.length, 1)
})

test('loader waits for modal.js without replacing its namespace and guards repeat execution', async () => {
  const env = environment({ bootModal: false })
  assert.equal(env.window.lumos, undefined)
  env.startModal()
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(typeof env.window.lumos.modal.load, 'function')
  const load = env.window.lumos.modal.load
  env.reload()
  assert.equal(env.window.lumos.modal.load, load)
  assert.equal(typeof env.window.lumos.modal.open, 'function')
})

test('a late response after timeout cannot append CSS or a dialog', async () => {
  let respond
  const env = environment({ fetcher: (url) => new Promise((resolve) => {
    respond = () => resolve({ ok: true, url: String(url), text: async () => '<source>' })
  }) })
  assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert', { timeoutMs: 15 }), null)
  respond()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(env.body.children.length, 0)
  assert.equal(env.head.children.length, 0)
})

test('an open failure rolls back the new registry entry, dialog and CSS', async () => {
  const env = environment()
  env.window.lumos.modal.open = () => { throw new Error('Cannot show dialog') }
  assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert', { open: true }), null)
  assert.equal(env.window.lumos.modal.list['marketing-expert'], undefined)
  assert.equal(env.body.children.length, 0)
  assert.equal(env.head.children.length, 0)
})

test('two source keys share CSS and a failed call preserves the successful call stylesheet', async () => {
  const env = environment({ dialogs: [sourceDialog(), sourceDialog('second')] })
  const init = env.window.lumos.modal.init
  env.window.lumos.modal.init = () => {
    init()
    if (env.body.children.some((el) => el.getAttribute('data-modal-target') === 'second')) throw new Error('Init failed')
  }
  const [first, second] = await Promise.all([
    env.window.lumos.modal.load('/modals', 'marketing-expert'),
    env.window.lumos.modal.load('/modals', 'second'),
  ])
  assert.equal(first.el.getAttribute('data-modal-target'), 'marketing-expert')
  assert.equal(second, null)
  assert.equal(env.body.children.length, 1)
  assert.equal(env.head.children.length, 1)
  assert.equal(env.window.lumos.modal.list.second, undefined)
})

test('install deadline starts at DOMContentLoaded even when parsing takes over 4000ms', async () => {
  let time = 0
  const env = environment({ bootModal: false, readyState: 'loading', now: () => time })
  time = 4500
  await new Promise((resolve) => setTimeout(resolve, 60))
  env.document.readyState = 'interactive'
  env.startModal()
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(time, 4500)
  assert.equal(typeof env.window.lumos.modal.load, 'function')
  assert.equal(typeof env.window.lumos.modal.open, 'function')
})

test('a load that times out does not fail a concurrent source request', async () => {
  let release
  const env = environment({ fetcher: () => new Promise((resolve) => {
    release = () => resolve({ ok: true, url: `https://${host}/modals`, text: async () => '<source>' })
  }) })
  const shared = env.window.lumos.modal.source('/modals')
  assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert', { timeoutMs: 100 }), null)
  assert.equal(env.calls[0].options.signal.aborted, false)
  release()
  assert.ok(await shared)
  assert.equal(env.calls.length, 1)
})

test('a later source call gets the Document from the single fetch after a load timeout', async () => {
  let release
  const env = environment({ fetcher: () => new Promise((resolve) => {
    release = () => resolve({ ok: true, url: `https://${host}/modals`, text: async () => '<source>' })
  }) })
  assert.equal(await env.window.lumos.modal.load('/modals', 'marketing-expert', { timeoutMs: 100 }), null)
  release()
  const doc = await env.window.lumos.modal.source('/modals')
  assert.ok(doc)
  assert.equal(await env.window.lumos.modal.source('/modals'), doc)
  assert.equal(env.calls.length, 1)
})
