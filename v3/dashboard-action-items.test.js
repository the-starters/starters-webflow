const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./dashboard-action-items.js')

function element({ attrs = {}, height = 0, children = [], text = '' } = {}) {
  const el = {
    attributes: { ...attrs },
    children,
    hidden: false,
    style: {},
    textContent: text,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
    getBoundingClientRect() {
      return { height: el.height }
    },
    querySelector(selector) {
      return el.queryAll(selector)[0] || null
    },
    querySelectorAll(selector) {
      return el.queryAll(selector)
    },
    queryAll(selector) {
      const wanted = selector.split(',').map((s) => s.trim())
      const out = []
      const visit = (node) => {
        node.children.forEach((child) => {
          const role = child.getAttribute('data-action-element')
          const cls = child.attributes.class || ''
          const hit = wanted.some((w) =>
            w.startsWith('[')
              ? role === w.slice(w.indexOf('"') + 1, w.lastIndexOf('"'))
              : cls.split(' ').includes(w.slice(1)),
          )
          if (hit) out.push(child)
          visit(child)
        })
      }
      visit(el)
      return out
    },
  }
  el.height = height
  return el
}

function row({ height = 20, cls = 'dash-hero_action-item', attrs = {} } = {}) {
  return element({ attrs: { class: cls, ...attrs }, height })
}

test('countPendingItems counts only visible leaf rows', () => {
  const scope = element({
    children: [
      element({ attrs: { 'data-action-element': 'loading', class: 'dash_card' }, height: 40 }),
      element({ attrs: { 'data-action-element': 'empty', class: 'dash_card' }, height: 40 }),
      row({ height: 20 }),
      row({ height: 0 }), // hidden or zero-height stray row
      row({ height: 18, cls: '', attrs: { 'data-action-element': 'item' } }),
    ],
  })
  assert.equal(api.countPendingItems(scope), 2)
})

test('nested group rows are not double counted', () => {
  const inner = row({ height: 20 })
  const group = element({
    attrs: { class: 'dash-hero_action-item' },
    height: 20,
    children: [inner],
  })
  const scope = element({ children: [group] })
  assert.equal(api.countPendingItems(scope), 1)
})

test('render before settle keeps loading visible and hides empty', () => {
  const loading = element({ attrs: { 'data-action-element': 'loading' } })
  const empty = element({ attrs: { 'data-action-element': 'empty' } })
  const total = element({ attrs: { 'data-action-element': 'total' }, text: '4' })
  const scope = element({ children: [loading, empty, total] })

  const panel = api.createPanel(scope)
  const count = panel.render()

  assert.equal(count, 0)
  assert.equal(loading.style.display, '')
  assert.equal(empty.style.display, 'none')
  assert.equal(total.textContent, '0')
  assert.equal(scope.attributes['data-action-items-count'], '0')
})

test('visible items settle the panel and update the badge', () => {
  const loading = element({ attrs: { 'data-action-element': 'loading' } })
  const empty = element({ attrs: { 'data-action-element': 'empty' } })
  const total = element({ attrs: { 'data-action-element': 'total' }, text: '4' })
  const scope = element({
    children: [loading, empty, total, row({ height: 20 }), row({ height: 20 })],
  })

  const panel = api.createPanel(scope)
  panel.render()

  assert.equal(panel.settled, true)
  assert.equal(loading.style.display, 'none')
  assert.equal(empty.style.display, 'none')
  assert.equal(total.textContent, '2')
})

test('settle with zero items shows the empty card', () => {
  const loading = element({ attrs: { 'data-action-element': 'loading' } })
  const empty = element({ attrs: { 'data-action-element': 'empty' } })
  const scope = element({ children: [loading, empty] })

  const panel = api.createPanel(scope)
  panel.render()
  assert.equal(loading.style.display, '')

  panel.settle()
  assert.equal(loading.style.display, 'none')
  assert.equal(empty.style.display, '')
})

test('render emits actionItemsChanged only when the count changes', () => {
  const events = []
  global.CustomEvent = function (name, init) {
    return { name, detail: init.detail }
  }
  global.dispatchEvent = (event) => events.push(event)

  const scope = element({ children: [row({ height: 20 })] })
  const panel = api.createPanel(scope)
  panel.render()
  panel.render()

  assert.equal(events.length, 1)
  assert.deepEqual(events[0].detail, { count: 1 })

  delete global.CustomEvent
  delete global.dispatchEvent
})
