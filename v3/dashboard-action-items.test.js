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

// A document has querySelector/querySelectorAll but no setAttribute.
function documentLike({ children = [], withBody = true } = {}) {
  const root = element({ children })
  return {
    body: withBody ? root : null,
    documentElement: element({ children }),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
  }
}

test('Calendar loading waits for terminal state before settling', () => {
  const previous = {
    addEventListener: global.addEventListener,
    dispatchEvent: global.dispatchEvent,
    document: global.document,
    setTimeout: global.setTimeout,
  }

  try {
    ;[
      {
        eventName: 'starterSchedulingConnectionStateChanged',
        pendingEvent: {
          type: 'starterSchedulingConnectionStateChanged',
          detail: { state: 'loading' },
        },
        terminalEvent: {
          type: 'starterSchedulingConnectionStateChanged',
          detail: { state: 'connected' },
        },
      },
      {
        eventName: 'starterSchedulingAvailabilityError',
        terminalEvent: { type: 'starterSchedulingAvailabilityError' },
      },
    ].forEach(({ eventName, pendingEvent, terminalEvent }) => {
      const listeners = new Map()
      const loading = element({ attrs: { 'data-action-element': 'loading' } })
      const empty = element({ attrs: { 'data-action-element': 'empty' } })
      const wrapper = element({
        attrs: { 'data-action-element': 'wrapper' },
        children: [loading, empty],
      })

      global.document = documentLike({ children: [wrapper] })
      global.addEventListener = (name, listener) => {
        const handlers = listeners.get(name) || []
        handlers.push(listener)
        listeners.set(name, handlers)
      }
      global.dispatchEvent = (event) => {
        ;(listeners.get(event.type) || []).forEach((listener) => listener(event))
        return true
      }
      global.setTimeout = () => 1

      api.mount()
      assert.equal(loading.style.display, '', eventName)
      assert.equal(empty.style.display, 'none', eventName)

      if (pendingEvent) {
        global.dispatchEvent(pendingEvent)
        assert.equal(loading.style.display, '', eventName)
        assert.equal(empty.style.display, 'none', eventName)
      }

      global.dispatchEvent(terminalEvent)
      assert.equal(loading.style.display, 'none', eventName)
      assert.equal(empty.style.display, '', eventName)
    })
  } finally {
    Object.entries(previous).forEach(([name, value]) => {
      if (value === undefined) delete global[name]
      else global[name] = value
    })
  }
})

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
  const scope = element({
    attrs: { 'data-action-element': 'wrapper' },
    children: [loading, empty, total],
  })

  const panel = api.createPanel(scope)
  const count = panel.render()

  assert.equal(count, 0)
  assert.equal(loading.style.display, '')
  assert.equal(empty.style.display, 'none')
  assert.equal(total.textContent, '0')
  assert.equal(scope.attributes['data-action-items-count'], '0')
  assert.equal(scope.style.display, '')
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

test('settle with zero items hides the full action-items wrapper', () => {
  const loading = element({ attrs: { 'data-action-element': 'loading' } })
  const empty = element({ attrs: { 'data-action-element': 'empty' } })
  const scope = element({
    attrs: { 'data-action-element': 'wrapper' },
    children: [loading, empty],
  })

  const panel = api.createPanel(scope)
  panel.render()
  assert.equal(loading.style.display, '')

  panel.settle()
  assert.equal(loading.style.display, 'none')
  assert.equal(empty.style.display, '')
  assert.equal(scope.hidden, true)
  assert.equal(scope.style.display, 'none')
})

test('a new pending item restores a wrapper hidden after settlement', () => {
  const pending = row({ height: 0 })
  const scope = element({
    attrs: { 'data-action-element': 'wrapper' },
    children: [pending],
  })
  const panel = api.createPanel(scope)

  panel.settle()
  assert.equal(scope.style.display, 'none')

  pending.height = 20
  assert.equal(panel.render(), 1)
  assert.equal(scope.hidden, false)
  assert.equal(scope.style.display, '')
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

test('document-wide scope writes the count attribute to body', () => {
  const total = element({ attrs: { 'data-action-element': 'total' }, text: '4' })
  const doc = documentLike({ children: [total, row({ height: 20 })] })

  const panel = api.createPanel(doc)

  assert.equal(panel.render(), 1)
  assert.equal(total.textContent, '1')
  assert.equal(doc.body.attributes[api.COUNT_ATTR], '1')
})

test('document scope without a body falls back to documentElement', () => {
  const doc = documentLike({ children: [row({ height: 20 })], withBody: false })

  api.createPanel(doc).render()

  assert.equal(doc.documentElement.attributes[api.COUNT_ATTR], '1')
})

test('resolveScopes prefers authored wrappers', () => {
  const wrapper = element({ attrs: { 'data-action-element': 'wrapper' } })
  const doc = documentLike({ children: [wrapper] })

  assert.deepEqual(api.resolveScopes(doc), [wrapper])
})

test('resolveScopes falls back to the document for any authored chrome', () => {
  ;['loading', 'empty', 'total'].forEach((name) => {
    const doc = documentLike({
      children: [element({ attrs: { 'data-action-element': name } })],
    })
    assert.deepEqual(api.resolveScopes(doc), [doc], name)
  })

  const bare = documentLike({ children: [row({ height: 20 })] })
  assert.deepEqual(api.resolveScopes(bare), [])
})

test('render scheduler coalesces mutation bursts into one render', () => {
  const frames = []
  const previous = global.requestAnimationFrame
  global.requestAnimationFrame = (cb) => frames.push(cb)

  let renders = 0
  const schedule = api.createRenderScheduler(() => {
    renders += 1
  })

  schedule()
  schedule()
  schedule()
  assert.equal(frames.length, 1)
  assert.equal(renders, 0)

  frames.shift()()
  assert.equal(renders, 1)

  schedule()
  assert.equal(frames.length, 1)

  if (previous) global.requestAnimationFrame = previous
  else delete global.requestAnimationFrame
})

test('render scheduler falls back to setTimeout without rAF', async () => {
  const previous = global.requestAnimationFrame
  delete global.requestAnimationFrame

  let renders = 0
  const schedule = api.createRenderScheduler(() => {
    renders += 1
  })

  schedule()
  schedule()
  assert.equal(renders, 0)

  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(renders, 1)

  if (previous) global.requestAnimationFrame = previous
})

function brandDocument(post, browse) {
  const link = { closest: () => browse }
  return {
    querySelector(selector) {
      if (selector === '[data-project-proposal-template="true"]') return post
      if (selector === '.dash-hero_action-item a[href="/all-starters"]') {
        return link
      }
      return null
    },
  }
}

function installBrandGlobals({ list, visited = false }) {
  const listeners = new Map()
  global.location = { pathname: '/brand-dashboard' }
  global.memberReady = Promise.resolve({ id: 'brand-1' })
  global.Opp30 = { API: { brandOppList: list } }
  global.StartersV3RouteGuard = {
    hasBrandAllStartersVisit: (memberId) =>
      memberId === 'brand-1' && visited,
  }
  global.CustomEvent = function (type, init) {
    return { type, detail: init && init.detail }
  }
  global.addEventListener = (type, listener) => {
    const handlers = listeners.get(type) || []
    handlers.push(listener)
    listeners.set(type, handlers)
  }
  global.dispatchEvent = (event) => {
    ;(listeners.get(event.type) || []).forEach((listener) => listener(event))
    return true
  }
  return listeners
}

function clearBrandGlobals() {
  ;[
    'location',
    'memberReady',
    'Opp30',
    'StartersV3RouteGuard',
    'CustomEvent',
    'addEventListener',
    'dispatchEvent',
  ].forEach((name) => delete global[name])
}

test('Brand actions hide after a canonical post and member-scoped browse visit', async () => {
  const post = row()
  const browse = row()
  installBrandGlobals({
    list: async () => ({ items: [{ id: 7 }], itemsTotal: 1 }),
    visited: true,
  })

  try {
    assert.equal(
      await api.mountBrandActionItems(brandDocument(post, browse)),
      true,
    )
    assert.equal(post.style.display, 'none')
    assert.equal(browse.style.display, 'none')
  } finally {
    clearBrandGlobals()
  }
})

test('Brand actions remain until completed and a successful create hides only the template', async () => {
  const post = row()
  const browse = row()
  installBrandGlobals({
    list: async () => ({ items: [], itemsTotal: 0 }),
  })

  try {
    await api.mountBrandActionItems(brandDocument(post, browse))
    assert.notEqual(post.style.display, 'none')
    assert.notEqual(browse.style.display, 'none')

    global.dispatchEvent({ type: 'starters:opportunity-created' })
    assert.equal(post.style.display, 'none')
    assert.notEqual(browse.style.display, 'none')
  } finally {
    clearBrandGlobals()
  }
})

test('Brand canonical read failures leave unfinished rows visible and settle as an error', async () => {
  const post = row()
  const browse = row()
  const listeners = installBrandGlobals({
    list: async () => {
      throw new Error('canonical read failed')
    },
    visited: true,
  })
  let errors = 0
  listeners.set('starterBrandActionItemsError', [() => {
    errors += 1
  }])

  try {
    assert.equal(
      await api.mountBrandActionItems(brandDocument(post, browse)),
      false,
    )
    assert.notEqual(post.style.display, 'none')
    assert.equal(browse.style.display, 'none')
    assert.equal(errors, 1)
  } finally {
    clearBrandGlobals()
  }
})
