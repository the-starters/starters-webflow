'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'calendly-fit.js'), 'utf8')

/** A minimal element: attributes, inline style, parent links and iframe lookup. */
function el(tag, attrs = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    style: { height: '' },
    children: [],
    parentElement: null,
    clientHeight: 0,
    getAttribute: (name) => (name in node.attrs ? node.attrs[name] : null),
    setAttribute: (name, value) => { node.attrs[name] = String(value) },
    hasAttribute: (name) => name in node.attrs,
    append(child) { child.parentElement = node; node.children.push(child); return child },
    descendants() { return node.children.flatMap((child) => [child, ...child.descendants()]) },
    querySelectorAll(selector) {
      if (selector === 'iframe') return node.descendants().filter((d) => d.tagName === 'IFRAME')
      throw new Error('unsupported selector ' + selector)
    },
  }
  return node
}

function makePage({ hostname = 'www.hirethestarters.com', debug = false } = {}) {
  const body = el('body')
  const listeners = []
  const logs = []
  const window = {
    location: { hostname },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn) },
  }
  if (debug) window.STARTERS_DEBUG = true
  const document = {
    querySelectorAll(selector) {
      if (selector !== '[data-calendly-fit]') throw new Error('unsupported selector ' + selector)
      return body.descendants().filter((d) => d.hasAttribute('data-calendly-fit'))
    },
  }
  const context = { window, document, console: { info: (...a) => logs.push(a) } }
  vm.createContext(context)
  vm.runInContext(SOURCE, context)
  const post = (source, data, origin = 'https://calendly.com') => listeners.forEach((fn) => fn({ origin, source, data }))
  return { body, window, post, logs, listeners, context }
}

/** column > widget > iframe, the shape Calendly's inline embed builds. */
function embed(page, { optInOn = 'widget', columnHeight = 680, baseHeight = '100%' } = {}) {
  const column = page.body.append(el('div', optInOn === 'wrapper' ? { 'data-calendly-fit': '' } : {}))
  column.clientHeight = columnHeight
  const widget = column.append(el('div', { class: 'calendly-inline-widget', ...(optInOn === 'widget' ? { 'data-calendly-fit': '' } : {}) }))
  widget.style.height = baseHeight
  const iframe = widget.append(el('iframe'))
  iframe.contentWindow = { name: 'calendly-frame' }
  return { column, widget, iframe }
}

const pageHeight = (height) => ({ event: 'calendly.page_height', payload: { height } })

test('a page_height message sizes the opted-in widget so it can be centered', () => {
  const page = makePage()
  const { widget, iframe } = embed(page)

  page.post(iframe.contentWindow, pageHeight('512px'))

  assert.equal(widget.style.height, '512px')
  assert.equal(widget.getAttribute('data-calendly-fit-height'), '512')
})

test('the height never exceeds the container', () => {
  const page = makePage()
  const { widget, iframe } = embed(page, { columnHeight: 680 })

  page.post(iframe.contentWindow, pageHeight('1100px'))

  assert.equal(widget.style.height, '680px')
})

test('later messages resize it again, up and down', () => {
  const page = makePage()
  const { widget, iframe } = embed(page)

  page.post(iframe.contentWindow, pageHeight(480))
  page.post(iframe.contentWindow, pageHeight('640px'))
  assert.equal(widget.style.height, '640px')
  page.post(iframe.contentWindow, pageHeight('400px'))
  assert.equal(widget.style.height, '400px')
})

test('the opt-in can sit on a wrapper, which is then the container', () => {
  const page = makePage()
  const { column, widget, iframe } = embed(page, { optInOn: 'wrapper', columnHeight: 600 })

  page.post(iframe.contentWindow, pageHeight('900px'))

  assert.equal(widget.style.height, '600px')
  assert.equal(column.style.height, '', 'the wrapper itself is not resized')
})

test('widgets without data-calendly-fit are never touched', () => {
  const page = makePage()
  const { widget, iframe } = embed(page, { optInOn: 'none' })

  page.post(iframe.contentWindow, pageHeight('400px'))

  assert.equal(widget.style.height, '100%')
  assert.equal(widget.hasAttribute('data-calendly-fit-height'), false)
})

test('only the widget whose iframe sent the message is resized', () => {
  const page = makePage()
  const first = embed(page)
  const second = embed(page)

  page.post(second.iframe.contentWindow, pageHeight('450px'))

  assert.equal(first.widget.style.height, '100%')
  assert.equal(second.widget.style.height, '450px')
})

test('messages from other origins, other events or bad heights are ignored', () => {
  const page = makePage()
  const { widget, iframe } = embed(page)
  const source = iframe.contentWindow

  page.post(source, pageHeight('400px'), 'https://evil.example')
  page.post(source, pageHeight('400px'), 'https://calendly.com.evil.example')
  page.post(source, { event: 'calendly.event_scheduled', payload: { height: '400px' } })
  page.post(source, pageHeight('auto'))
  page.post(source, pageHeight(0))
  page.post(source, 'calendly.page_height')
  page.post(source, null)
  page.post({ name: 'some other frame' }, pageHeight('400px'))

  assert.equal(widget.style.height, '100%')
})

test('the container is measured with the widget back at its starting height', () => {
  const page = makePage()
  const { column, widget, iframe } = embed(page, { baseHeight: '700px' })
  // A content-sized column follows the widget: model that by reading the
  // widget's current height when the container is measured.
  Object.defineProperty(column, 'clientHeight', { get: () => parseFloat(widget.style.height) || 0 })

  page.post(iframe.contentWindow, pageHeight('500px'))
  assert.equal(widget.style.height, '500px')
  page.post(iframe.contentWindow, pageHeight('650px'))
  assert.equal(widget.style.height, '650px', 'it can grow back up to the starting height')
  assert.equal(widget.getAttribute('data-calendly-fit-base'), '700px')
})

test('loading the script twice registers one listener', () => {
  const page = makePage()
  vm.runInContext(SOURCE, page.context)
  assert.equal(page.listeners.length, 1)
})

test('console diagnostics only on staging hosts or with STARTERS_DEBUG', () => {
  for (const [options, expected] of [
    [{ hostname: 'www.hirethestarters.com' }, 0],
    [{ hostname: 'the-starters-3-0.webflow.io' }, 1],
    [{ hostname: 'notwebflow.io' }, 0],
    [{ hostname: 'www.hirethestarters.com', debug: true }, 1],
  ]) {
    const page = makePage(options)
    const { iframe } = embed(page)
    page.post(iframe.contentWindow, pageHeight('400px'))
    assert.equal(page.logs.length, expected, JSON.stringify(options))
  }
})

test('the @release header is the release the page reads back', () => {
  const page = makePage()
  const header = /@release (v\d+\.\d+\.\d+)/.exec(SOURCE)[1]
  assert.equal(page.window.startersCalendlyFit.release, header)
})
