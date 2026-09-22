const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const { h, makeEvent } = require('../../step-flow-test-dom')

const source = fs.readFileSync(
  process.env.ACCORDIONS_TEST_SOURCE || require.resolve('./accordions.js'),
  'utf8',
)

function element(tag, attrs, children) {
  const el = h(tag, attrs, children)
  Object.defineProperties(el, {
    id: { get: () => el.getAttribute('id') },
    firstElementChild: { get: () => el.children[0] || null },
  })
  return el
}

function mount({ animated = false, attrs = {}, scrollTrigger = false, groups = 1 } = {}) {
  const body = element('body')
  const cards = []
  for (let group = 0; group < groups; group += 1) {
    const list = element('div', { 'data-accordion': 'list' })
    body.append(element('div', { 'data-accordion': 'wrapper', ...attrs }, [list]))
    for (let index = 0; index < 3; index += 1) {
      const button = element('button', { 'data-accordion': 'toggle-button' })
      const content = element('div', { 'data-accordion': 'content-wrap' })
      const card = element('div', { 'data-accordion': 'component' }, [button, content])
      list.append(card)
      cards.push({ card, button, content })
    }
  }

  const listeners = new Map()
  const timelines = []
  let refreshes = 0
  const context = {
    console,
    window: {},
    document: {
      querySelectorAll: (selector) => body.querySelectorAll(selector),
      addEventListener(type, listener) {
        const handlers = listeners.get(type) || []
        handlers.push(listener)
        listeners.set(type, handlers)
      },
    },
  }
  if (scrollTrigger) context.ScrollTrigger = { refresh() { refreshes += 1 } }
  if (animated) {
    context.gsap = {
      timeline(options) {
        const timeline = {
          options,
          steps: [],
          actions: [],
          invalidations: 0,
          set(target, vars) { this.steps.push(['set', target, { ...vars }]); return this },
          fromTo(target, from, to) {
            this.steps.push(['fromTo', target, { ...from }, { ...to }])
            return this
          },
          play() { this.actions.push('play'); return this },
          reverse() { this.actions.push('reverse'); return this },
          progress(value) { this.actions.push(['progress', value]); return this },
          invalidate() { this.invalidations += 1; return this },
        }
        timelines.push(timeline)
        return timeline
      },
    }
  }
  vm.runInNewContext(source, context, { filename: 'accordions.js' })
  const card = () => {
    const button = element('button', { 'data-accordion': 'toggle-button' })
    const content = element('div', { 'data-accordion': 'content-wrap' })
    return { card: element('div', { 'data-accordion': 'component' }, [button, content]), button, content }
  }
  const boot = () => {
    for (const listener of listeners.get('DOMContentLoaded') || []) {
      listener(makeEvent('DOMContentLoaded', null))
    }
  }
  boot()
  return {
    cards,
    timelines,
    boot,
    card,
    accordions: context.window.StarterAccordions,
    get refreshes() { return refreshes },
    fire(index, type = 'click') {
      const button = cards[index].button
      for (const listener of button._listeners.get(type) || []) {
        listener(makeEvent(type, button))
      }
    },
  }
}

function assertOpen(env, index, open) {
  const { card, button, content } = env.cards[index]
  assert.equal(button.getAttribute('aria-expanded'), String(open))
  assert.equal(card.classList.contains('is-active'), open)
  if (env.timelines.length === 0) {
    assert.equal(content.style.display, open ? 'block' : 'none')
  }
}

for (const animated of [false, true]) {
  const mode = animated ? 'with GSAP' : 'without GSAP'

  test(`${mode}: initializes accessible collapsed cards and opens on click`, () => {
    const env = mount({ animated, groups: 2 })
    const ids = new Set()
    env.cards.forEach(({ button, content }, index) => {
      assertOpen(env, index, false)
      assert.equal(content.style.display, 'none')
      assert.ok(button.id)
      assert.ok(content.id)
      assert.equal(button.getAttribute('aria-controls'), content.id)
      assert.equal(content.getAttribute('aria-labelledby'), button.id)
      ids.add(button.id)
      ids.add(content.id)
    })
    assert.equal(ids.size, env.cards.length * 2)
    env.fire(0)
    assertOpen(env, 0, true)
    assertOpen(env, 1, false)
    if (animated) assert.deepEqual(env.timelines[0].actions, ['play'])
  })

  test(`${mode}: second click closes only when enabled, then reopens`, () => {
    for (const enabled of [false, true]) {
      const env = mount({ animated, attrs: { 'data-close-on-second-click': String(enabled) } })
      env.fire(0)
      env.fire(0)
      assertOpen(env, 0, !enabled)
      env.fire(0)
      assertOpen(env, 0, true)
      if (animated) {
        assert.deepEqual(env.timelines[0].actions, ['play', enabled ? 'reverse' : 'play', 'play'])
      }
    }
  })

  test(`${mode}: close-previous follows configuration and stays within its wrapper`, () => {
    for (const enabled of [false, true]) {
      const env = mount({ animated, groups: 2, attrs: { 'data-close-previous': String(enabled) } })
      env.fire(0)
      env.fire(3)
      assertOpen(env, 0, true)
      env.fire(1)
      assertOpen(env, 0, !enabled)
      assertOpen(env, 1, true)
      assertOpen(env, 3, true)
      if (animated) {
        assert.deepEqual(env.timelines[0].actions, enabled ? ['play', 'reverse'] : ['play'])
      }
    }
  })

  test(`${mode}: numeric default opens instantly and closes when another opens`, () => {
    const env = mount({ animated, attrs: { 'data-open-by-default': '2', 'data-close-previous': 'true' } })
    assertOpen(env, 0, false)
    assertOpen(env, 1, true)
    assertOpen(env, 2, false)
    if (animated) assert.deepEqual(env.timelines[1].actions, [['progress', 1]])
    env.fire(2)
    assertOpen(env, 1, false)
    assertOpen(env, 2, true)
    if (animated) {
      assert.deepEqual(env.timelines[1].actions, [['progress', 1], 'reverse'])
      assert.deepEqual(env.timelines[2].actions, ['play'])
    }
  })

  test(`${mode}: default all overrides close-previous and permits individual toggles`, () => {
    const env = mount({ animated, attrs: {
      'data-open-by-default': 'all',
      'data-close-previous': 'true',
      'data-close-on-second-click': 'true',
    } })
    env.cards.forEach((_, index) => assertOpen(env, index, true))
    if (animated) env.timelines.forEach((timeline) => assert.deepEqual(timeline.actions, [['progress', 1]]))
    env.fire(1)
    assertOpen(env, 0, true)
    assertOpen(env, 1, false)
    assertOpen(env, 2, true)
    env.fire(1)
    env.cards.forEach((_, index) => assertOpen(env, index, true))
  })

  test(`${mode}: hover is opt-in, closes the previous card, and never toggles closed`, () => {
    const disabled = mount({ animated })
    disabled.fire(0, 'mouseenter')
    assertOpen(disabled, 0, false)
    const env = mount({ animated, attrs: {
      'data-open-on-hover': 'true',
      'data-close-previous': 'true',
      'data-close-on-second-click': 'true',
    } })
    env.fire(0, 'mouseenter')
    assertOpen(env, 0, true)
    env.fire(1, 'mouseenter')
    assertOpen(env, 0, false)
    assertOpen(env, 1, true)
    env.fire(1, 'mouseenter')
    assertOpen(env, 1, true)
    env.fire(1)
    assertOpen(env, 1, false)
    if (animated) {
      assert.deepEqual(env.timelines[0].actions, ['play', 'reverse'])
      assert.deepEqual(env.timelines[1].actions, ['play', 'play', 'reverse'])
    }
  })

  test(`${mode}: repeated initialization preserves state and does not duplicate handlers`, () => {
    const env = mount({ animated, attrs: { 'data-close-on-second-click': 'true' } })
    env.fire(0)
    env.boot()
    assertOpen(env, 0, true)
    env.fire(0)
    assertOpen(env, 0, false)
    if (animated) {
      assert.equal(env.timelines.length, 3)
      assert.deepEqual(env.timelines[0].actions, ['play', 'reverse'])
    }
  })
}

test('GSAP receives the height animation and completion hooks tolerate optional ScrollTrigger', () => {
  for (const scrollTrigger of [false, true]) {
    const env = mount({ animated: true, scrollTrigger, attrs: { 'data-close-on-second-click': 'true' } })
    const timeline = env.timelines[0]
    assert.equal(timeline.options.paused, true)
    assert.deepEqual({ ...timeline.options.defaults }, { duration: 0.3, ease: 'power1.inOut' })
    assert.deepEqual(timeline.steps, [
      ['set', env.cards[0].content, { display: 'block' }],
      ['fromTo', env.cards[0].content, { height: 0 }, { height: 'auto' }],
    ])
    env.fire(0)
    timeline.options.onComplete()
    assertOpen(env, 0, true)
    assert.equal(timeline.invalidations, 1)
    assert.equal(env.refreshes, scrollTrigger ? 1 : 0)
    env.fire(0)
    timeline.options.onReverseComplete()
    assertOpen(env, 0, false)
    assert.equal(timeline.invalidations, 2)
    assert.equal(env.refreshes, scrollTrigger ? 2 : 0)
  }
})

function assertEntryOpen(entry, open, animated) {
  assert.equal(entry.isOpen(), open)
  assert.equal(entry.button.getAttribute('aria-expanded'), String(open))
  assert.equal(entry.card.classList.contains('is-active'), open)
  if (!animated) assert.equal(entry.content.style.display, open ? 'block' : 'none')
}

for (const animated of [false, true]) {
  const mode = animated ? 'with GSAP' : 'without GSAP'

  test(`${mode}: a group registered after initialization keeps one card open`, () => {
    const env = mount({ animated })
    const group = env.accordions.group({ closePrevious: true })
    const first = env.card()
    const second = env.card()
    const one = group.register(first.card, first.button, first.content)
    const two = group.register(second.card, second.button, second.content)
    assertEntryOpen(one, false, animated)
    assertEntryOpen(two, false, animated)
    one.open()
    assertEntryOpen(one, true, animated)
    two.open()
    assertEntryOpen(one, false, animated)
    assertEntryOpen(two, true, animated)
    // A card added later joins the same rule rather than opening alongside the others.
    const third = env.card()
    const three = group.register(third.card, third.button, third.content)
    three.open()
    assertEntryOpen(two, false, animated)
    assertEntryOpen(three, true, animated)
    if (animated) {
      assert.deepEqual(env.timelines.at(-3).actions, ['play', 'reverse'])
      assert.deepEqual(env.timelines.at(-2).actions, ['play', 'reverse'])
      assert.deepEqual(env.timelines.at(-1).actions, ['play'])
    }
  })
}

test('a released card is no longer the one close-previous closes', () => {
  const env = mount()
  const group = env.accordions.group({ closePrevious: true })
  const first = env.card()
  const second = env.card()
  const one = group.register(first.card, first.button, first.content)
  const two = group.register(second.card, second.button, second.content)
  one.open()
  // The page discarded this card, so opening another must not reach back into it.
  one.release()
  two.open()
  assert.equal(one.isOpen(), true)
  assert.equal(two.isOpen(), true)
})

test('a group that does not bind the control leaves activation to the page', () => {
  const env = mount()
  const owned = env.accordions.group({ closePrevious: true, bindControl: false })
  const built = env.card()
  const entry = owned.register(built.card, built.button, built.content)
  built.button._listeners.get('click')?.forEach((listener) => listener(makeEvent('click', built.button)))
  assert.equal(entry.isOpen(), false)
  assert.equal(built.content.style.display, 'none')
  entry.open()
  assert.equal(entry.isOpen(), true)
  assert.equal(built.content.style.display, 'block')
  entry.close()
  assert.equal(entry.isOpen(), false)
})

test('registration needs a card, a control, and a panel, and ids never repeat', () => {
  const env = mount()
  const group = env.accordions.group({})
  const built = env.card()
  assert.equal(group.register(null, built.button, built.content), null)
  assert.equal(group.register(built.card, null, built.content), null)
  assert.equal(group.register(built.card, built.button, null), null)
  const entry = group.register(built.card, built.button, built.content)
  const ids = new Set([...env.cards, entry].flatMap(({ button, content }) => [button.id, content.id]))
  assert.equal(ids.size, (env.cards.length + 1) * 2)
  assert.equal(entry.button.getAttribute('aria-controls'), entry.content.id)
  assert.equal(entry.content.getAttribute('aria-labelledby'), entry.button.id)
})
