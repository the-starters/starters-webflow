'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'global-embeds', 'tabs', 'tabs.js'), 'utf8')

function matchesSimple(element, selector) {
  let rest = selector.trim()
  while (rest) {
    let match
    if ((match = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest))) {
      const value = element.getAttribute(match[1])
      if (value === null) return false
      const expected = match[2] === undefined ? match[3] : match[2]
      if (expected !== undefined && value !== expected) return false
    } else if ((match = /^\.([\w-]+)/.exec(rest))) {
      if (!element.classList.contains(match[1])) return false
    } else if ((match = /^([a-zA-Z][\w-]*)/.exec(rest))) {
      if (element.tagName !== match[1].toUpperCase()) return false
    } else {
      throw new Error('Unsupported selector in tabs test: ' + selector)
    }
    rest = rest.slice(match[0].length)
  }
  return true
}

function matchesSelector(element, selector) {
  return selector.split(',').some((group) => {
    const parts = group.trim().split(/\s+/)
    let node = element
    if (!matchesSimple(node, parts.pop())) return false
    while (parts.length) {
      const wanted = parts.pop()
      node = node.parentElement
      while (node && !matchesSimple(node, wanted)) node = node.parentElement
      if (!node) return false
    }
    return true
  })
}

class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = String(tag).toUpperCase()
    this.parentElement = null
    this.children = []
    this.style = {}
    this.dataset = {}
    this.textContent = ''
    this.value = attrs.value || ''
    this.required = attrs.required === true || Object.prototype.hasOwnProperty.call(attrs, 'required')
    this.disabled = false
    this.checked = false
    this.options = []
    this.selectedIndex = 0
    this.scrollWidth = 0
    this.clientWidth = 0
    this.scrollLeft = 0
    this._attrs = new Map()
    this._listeners = new Map()
    const classes = new Set()
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force)
        if (enabled) classes.add(name)
        else classes.delete(name)
        return enabled
      },
    }
    Object.entries(attrs).forEach(([name, value]) => {
      if (name !== 'value') this.setAttribute(name, value === true ? '' : value)
    })
    String(attrs.class || '').split(/\s+/).filter(Boolean).forEach((name) => classes.add(name))
    children.forEach((child) => this.append(child))
  }

  get firstElementChild() { return this.children[0] || null }
  get firstChild() { return this.firstElementChild }
  get type() { return (this.getAttribute('type') || '').toLowerCase() }
  get name() { return this.getAttribute('name') || '' }

  setAttribute(name, value) { this._attrs.set(name, String(value)) }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null }
  hasAttribute(name) { return this._attrs.has(name) }
  removeAttribute(name) { this._attrs.delete(name) }

  append(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  descendants() {
    const results = []
    const walk = (node) => node.children.forEach((child) => {
      results.push(child)
      walk(child)
    })
    walk(this)
    return results
  }

  querySelectorAll(selector) {
    if (selector.trim().startsWith(':scope')) return []
    return this.descendants().filter((element) => matchesSelector(element, selector))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  closest(selector) {
    let node = this
    while (node) {
      if (matchesSelector(node, selector)) return node
      node = node.parentElement
    }
    return null
  }
  contains(other) {
    let node = other
    while (node) {
      if (node === this) return true
      node = node.parentElement
    }
    return false
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) || []
    listeners.push(listener)
    this._listeners.set(type, listeners)
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this
    let node = this
    while (node) {
      for (const listener of node._listeners.get(event.type) || []) listener(event)
      if (!event.bubbles) break
      node = node.parentElement
    }
    if (event.bubbles && this._document) this._document.fire(event)
    return !event.defaultPrevented
  }

  focus() {}
  getBoundingClientRect() { return { left: 0, width: 0 } }
  scrollTo() {}
  scrollIntoView() {}
}

const h = (tag, attrs, children) => new Element(tag, attrs || {}, children || [])

function event(type, target, extra = {}) {
  return Object.assign({
    type,
    target,
    bubbles: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }, extra)
}

function mount(root, { gsap = false, beforeReady } = {}) {
  const documentListeners = new Map()
  const document = {
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || []
      listeners.push(listener)
      documentListeners.set(type, listeners)
    },
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    fire(dispatched) {
      for (const listener of documentListeners.get(dispatched.type) || []) listener(dispatched)
    },
  }
  root.descendants().concat(root).forEach((element) => { element._document = document })

  const operations = []
  const gsapObject = gsap ? {
    timeline(options = {}) {
      const timeline = {
        set(target, values) {
          operations.push(['set', target, values])
          Object.assign(target.style, values)
          return timeline
        },
        call(callback) {
          operations.push(['call'])
          callback()
          return timeline
        },
        to() { operations.push(['to']); return timeline },
        fromTo() { operations.push(['fromTo']); return timeline },
        complete() { if (options.onComplete) options.onComplete() },
      }
      return timeline
    },
  } : undefined

  const window = { document }
  window.window = window
  const context = vm.createContext({
    window,
    document,
    Element,
    HTMLElement: Element,
    HTMLInputElement: Element,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type
        this.detail = init.detail
        this.bubbles = Boolean(init.bubbles)
        this.target = null
      }
    },
    MutationObserver: class MutationObserver { observe() {} },
    CSS: { escape: String },
    URL,
    URLSearchParams,
    location: { search: '', href: 'https://www.thestarters.com/hire/example' },
    history: { replaceState() {} },
    requestAnimationFrame: (callback) => callback(),
    getComputedStyle: (element) => ({
      display: element.style.display || 'block',
      visibility: element.style.visibility || 'visible',
    }),
    console,
    ...(gsapObject ? { gsap: gsapObject } : {}),
  })
  vm.runInContext(SOURCE, context, { filename: 'tabs.js' })
  if (beforeReady) beforeReady(document)
  document.fire(event('DOMContentLoaded', null, { bubbles: false }))

  const click = (tabWrap, target) => {
    const clickEvent = event('click', target)
    for (const listener of tabWrap._listeners.get('click') || []) listener(clickEvent)
    return clickEvent
  }
  return { click, operations }
}

function projectTabsFixture({ slide = false } = {}) {
  const projectInfoNext = h('div', { 'data-tab': 'next', 'data-button-theme': 'black' }, [h('button')])
  const paymentNext = h('div', { 'data-tab': 'next', 'data-button-theme': 'black' }, [h('button')])
  const projectInfo = h('section', { 'data-tab-panel-title': 'Project Info' }, [projectInfoNext])
  const feeStructure = h('select', {
    name: 'Fee-Structure',
    'data-project-required-hidden': 'true',
    value: '',
  })
  const payment = h('section', { 'data-tab-panel-title': 'Payment' }, [feeStructure, paymentNext])
  const buttonList = h('div', { 'data-tab-component': 'button-list' }, [h('button'), h('button')])
  const panelList = h('div', { 'data-tab-component': 'panel-list' }, [projectInfo, payment])
  const tabWrap = h('div', {
    'data-tab-component': 'wrapper',
    'data-tab-nav': 'panel',
    'data-validate-tabs': 'True',
    ...(slide ? { 'data-slide-tabs': 'True' } : {}),
  }, [buttonList, panelList])
  const form = h('form', {}, [tabWrap])
  const formBlock = h('div', { 'data-project-form-v3': 'brand' }, [form])
  const modal = h('dialog', { 'data-modal-target': 'generate-contract' }, [formBlock])
  return { modal, tabWrap, projectInfoNext, paymentNext, payment, feeStructure }
}

for (const scenario of [
  { label: '', gsap: false, slide: false },
  { label: ' with GSAP fade', gsap: true, slide: false },
  { label: ' with GSAP slide', gsap: true, slide: true },
]) {
  test(`generate-contract Payment restores required before tabs validation${scenario.label}`, () => {
    const fixture = projectTabsFixture({ slide: scenario.slide })
    const observed = []
    const harness = mount(h('body', {}, [fixture.modal]), {
      gsap: scenario.gsap,
      beforeReady(document) {
        document.addEventListener('starters:tabs-panel-visible', (visibleEvent) => {
          const { tabWrap, panel } = visibleEvent.detail
          if (tabWrap !== fixture.tabWrap || panel !== fixture.payment) return
          observed.push(panel.style.display)
          fixture.feeStructure.required = true
          fixture.feeStructure.setAttribute('required', '')
          fixture.feeStructure.removeAttribute('data-project-required-hidden')
        })
      },
    })

    // Match the production failure state before Project Info Continue.
    fixture.paymentNext.removeAttribute('data-tab-nav-disabled')
    fixture.paymentNext.setAttribute('data-button-theme', 'black')
    fixture.paymentNext.querySelector('button').disabled = false
    assert.equal(fixture.payment.style.display, 'none')
    assert.equal(fixture.feeStructure.required, false)

    harness.click(fixture.tabWrap, fixture.projectInfoNext.querySelector('button'))

    assert.deepEqual(observed, ['block'], 'the handoff runs only after Payment is display:block')
    assert.equal(fixture.feeStructure.required, true)
    assert.equal(fixture.feeStructure.getAttribute('data-project-required-hidden'), null)
    assert.equal(fixture.paymentNext.getAttribute('data-button-theme'), 'disabled')
    assert.equal(fixture.paymentNext.getAttribute('data-tab-nav-disabled'), 'true')
    assert.equal(fixture.paymentNext.querySelector('button').disabled, true)

    if (scenario.gsap) {
      const setIndex = harness.operations.findIndex(([type, target, values]) =>
        type === 'set' && target === fixture.payment && values.display === 'block')
      const callIndex = harness.operations.findIndex(([type]) => type === 'call')
      assert.ok(setIndex >= 0 && callIndex > setIndex, 'GSAP schedules the handoff immediately after display:block')
    }
  })
}
