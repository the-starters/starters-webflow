const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')
const { h } = require('../../step-flow-test-dom')

const source = fs.readFileSync(process.env.MOBILE_ACCORDIONS_TEST_SOURCE || require.resolve('./mobile-accordions.js'), 'utf8')

function element(tag, attrs, children) {
  const el = h(tag, attrs, children)
  const classes = new Set()
  el.classList = {
    add: (...values) => values.forEach(value => classes.add(value)),
    remove: (...values) => values.forEach(value => classes.delete(value)),
    contains: value => classes.has(value),
  }
  el.style.removeProperty = key => { delete el.style[key] }
  el.addEventListener = (type, handler, { signal } = {}) => {
    const handlers = el._listeners.get(type) || new Set()
    handlers.add(handler)
    el._listeners.set(type, handlers)
    signal?.addEventListener('abort', () => handlers.delete(handler), { once: true })
  }
  return el
}

function mount({ animated = false, width = 767, loading = false } = {}) {
  const body = element('body')
  const groups = ['join-cta', 'signup-modal'].map(name => {
    const root = element('div', { 'data-accordion-item-wrapper': '', id: name })
    body.append(root)
    const cards = Array.from({ length: 3 }, () => {
      const button = element('button', { 'data-accordion-button-toggle': '' })
      const panel = element('div', { 'data-accordion-content-wrap': '' })
      const card = element('div', { 'data-accordion-component': '' }, [button, panel])
      card.classList.add('is-open', 'is-active')
      root.append(card)
      return { card, button, panel }
    })
    return { root, cards }
  })
  const mediaListeners = new Set()
  const readyListeners = new Set()
  const timelines = []
  const context = vm.createContext({
    AbortController,
    document: {
      readyState: loading ? 'loading' : 'complete',
      querySelectorAll: selector => body.querySelectorAll(selector),
      addEventListener: (type, handler) => { if (type === 'DOMContentLoaded') readyListeners.add(handler) },
    },
    window: { matchMedia: query => ({
      matches: width <= Number(query.match(/\d+/)[0]),
      addEventListener: (type, handler) => mediaListeners.add(handler),
    }) },
  })
  if (animated) context.gsap = {
    set(panel, { clearProps }) {
      for (const key of clearProps === 'all' ? ['display', 'height'] : [clearProps]) panel.style.removeProperty(key)
    },
    timeline(options) {
      let target
      const tl = {
        killed: false,
        set(panel) { target = panel; return this },
        fromTo() { return this },
        progress(value) { target.style.display = value ? 'block' : 'none'; target.style.height = value ? 'auto' : '0px'; return this },
        play() { this.progress(1); options.onComplete(); return this },
        reverse() { this.progress(0); options.onReverseComplete(); return this },
        pause() { return this },
        invalidate() { return this },
        kill() { this.killed = true },
      }
      timelines.push(tl)
      return tl
    },
  }
  const install = () => vm.runInContext(source, context, { filename: 'mobile-accordions.js' })
  install()
  return {
    groups, timelines, mediaListeners, install,
    ready: () => readyListeners.forEach(handler => handler()),
    resize(value) { width = value; mediaListeners.forEach(handler => handler()) },
    click(group, card) { groups[group].cards[card].button._listeners.get('click')?.forEach(handler => handler()) },
  }
}

function state(env, group, card, open) {
  const item = env.groups[group].cards[card]
  assert.equal(item.card.classList.contains('is-active'), open)
  assert.equal(item.card.classList.contains('is-open'), open)
  assert.equal(item.button.getAttribute('aria-expanded'), String(open))
  assert.equal(item.panel.style.display, open ? 'block' : 'none')
  assert.equal(item.button.getAttribute('aria-controls'), item.panel.getAttribute('id'))
  assert.equal(item.panel.getAttribute('aria-labelledby'), item.button.getAttribute('id'))
}

for (const animated of [false, true]) {
  const mode = animated ? 'with animation' : 'without GSAP'
  test(`${mode}: first card defaults open, groups remain independent, second click closes`, () => {
    const env = mount({ animated })
    for (let group = 0; group < 2; group++) {
      state(env, group, 0, true)
      state(env, group, 1, false)
      state(env, group, 2, false)
    }
    const ids = env.groups.flatMap(group => group.cards.flatMap(({button,panel}) => [button.getAttribute('id'),panel.getAttribute('id')]))
    assert.equal(new Set(ids).size, 12)
    env.click(0, 1)
    state(env, 0, 0, false)
    state(env, 0, 1, true)
    state(env, 1, 0, true)
    env.click(0, 1)
    state(env, 0, 1, false)
    env.click(1, 2)
    state(env, 1, 0, false)
    state(env, 1, 2, true)
  })

  test(`${mode}: 768px restores layout; returning to 767px binds once`, () => {
    const env = mount({ animated })
    env.click(0, 2)
    env.resize(768)
    for (const { root, cards } of env.groups) {
      assert.equal(root.dataset.scriptInitialized, undefined)
      for (const { card, button, panel } of cards) {
        assert.equal(card.classList.contains('is-active'), false)
        assert.equal(card.classList.contains('is-open'), false)
        assert.equal(panel.style.display, undefined)
        assert.equal(panel.style.height, undefined)
        assert.equal(button._listeners.get('click').size, 0)
      }
    }
    assert.ok(env.timelines.every(tl => tl.killed))
    env.resize(767)
    state(env, 0, 0, true)
    env.click(0, 1)
    state(env, 0, 1, true)
    env.click(0, 1)
    state(env, 0, 1, false)
  })

  test(`${mode}: duplicate component includes install one listener and respect DOM readiness`, () => {
    const env = mount({ animated, loading: true, width: 1024 })
    env.install()
    env.ready()
    assert.equal(env.mediaListeners.size, 1)
    assert.equal(env.groups[0].root.dataset.scriptInitialized, undefined)
    env.resize(767)
    env.install()
    env.click(0, 1)
    state(env, 0, 1, true)
    assert.equal(env.groups[0].cards[1].button._listeners.get('click').size, 1)
  })
}
