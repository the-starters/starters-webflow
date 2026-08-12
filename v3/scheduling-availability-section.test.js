const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./scheduling-availability-section.js'), 'utf8')
const WRITER_SOURCE = fs.readFileSync(require.resolve('./scheduling-availability-writer.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
const DAY_VARIANT_DEFAULT = 'w-variant-89402c65-e26d-c236-91e7-76e9135a2d42'
const DAY_VARIANT_SELECTED = 'w-variant-ebea452c-a047-af3f-dd6c-3062ee4c048c'

/* ------------------------------------------------------------------ */
/* Minimal DOM (same shape as scheduling-availability-writer.test.js)  */
/* ------------------------------------------------------------------ */

class El {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase()
    this.attributes = {}
    this.dataset = {}
    this.children = []
    this.parentElement = null
    this.style = {}
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.disabled = false
    this._classes = new Set()
    this._listeners = new Map()
    const self = this
    this.classList = {
      add: (c) => self._classes.add(c),
      remove: (c) => self._classes.delete(c),
      contains: (c) => self._classes.has(c),
    }
    for (const [name, value] of Object.entries(attrs)) {
      this.setAttribute(name, value)
    }
  }

  get type() {
    return this.attributes.type || ''
  }

  get name() {
    return this.attributes.name || ''
  }

  get previousElementSibling() {
    if (!this.parentElement) return null
    const index = this.parentElement.children.indexOf(this)
    return index > 0 ? this.parentElement.children[index - 1] : null
  }

  set innerHTML(value) {
    if (value === '') this.children = []
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name === 'class') {
      this._classes = new Set(String(value).split(' ').filter(Boolean))
    }
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())
      this.dataset[key] = String(value)
    }
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null
  }

  hasAttribute(name) {
    return name in this.attributes
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  remove() {
    if (!this.parentElement) return
    const index = this.parentElement.children.indexOf(this)
    if (index > -1) this.parentElement.children.splice(index, 1)
    this.parentElement = null
  }

  cloneNode() {
    const copy = new El(this.tagName.toLowerCase())
    copy.attributes = { ...this.attributes }
    copy.dataset = { ...this.dataset }
    copy._classes = new Set(this._classes)
    copy.textContent = this.textContent
    copy.value = this.value
    for (const child of this.children) copy.appendChild(child.cloneNode())
    return copy
  }

  addEventListener(name, listener) {
    if (!this._listeners.has(name)) this._listeners.set(name, [])
    this._listeners.get(name).push(listener)
  }

  dispatchEvent(event) {
    for (const listener of this._listeners.get(event.type) || []) listener(event)
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {} })
  }

  *walk() {
    for (const child of this.children) {
      yield child
      yield* child.walk()
    }
  }

  closest(selector) {
    let el = this
    while (el) {
      if (matchesCompound(el, selector.trim())) return el
      el = el.parentElement
    }
    return null
  }

  querySelectorAll(selector) {
    const results = []
    for (const part of selector.split(',')) {
      const trimmed = part.trim()
      if (trimmed === '*') {
        for (const el of this.walk()) {
          if (results.indexOf(el) === -1) results.push(el)
        }
        continue
      }
      for (const el of this.walk()) {
        if (matchesSelector(el, trimmed) && results.indexOf(el) === -1) {
          results.push(el)
        }
      }
    }
    return results
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function matchesCompound(el, compound) {
  const parts = compound.match(/\[[^\]]+\]|#[\w-]+|\.[\w-]+|^[a-zA-Z][\w-]*/g) || []
  return parts.every((part) => {
    if (part.startsWith('[')) {
      const inner = part.slice(1, -1)
      const eq = inner.indexOf('=')
      if (eq === -1) return el.hasAttribute(inner)
      const name = inner.slice(0, eq)
      const value = inner.slice(eq + 1).replace(/^["']|["']$/g, '')
      return el.getAttribute(name) === value
    }
    if (part.startsWith('#')) return el.getAttribute('id') === part.slice(1)
    if (part.startsWith('.')) return el.classList.contains(part.slice(1))
    return el.tagName.toLowerCase() === part.toLowerCase()
  })
}

function matchesSelector(el, selector) {
  const compounds = selector.split(/\s+/)
  if (!matchesCompound(el, compounds[compounds.length - 1])) return false
  let index = compounds.length - 2
  let ancestor = el.parentElement
  while (index >= 0 && ancestor) {
    if (matchesCompound(ancestor, compounds[index])) index -= 1
    ancestor = ancestor.parentElement
  }
  return index < 0
}

/* ------------------------------------------------------------------ */
/* Section DOM builder                                                 */
/* ------------------------------------------------------------------ */

function buildItemTemplate() {
  const template = new El('div', { 'data-availability-element': 'item-template', 'data-id': '' })

  const topContent = new El('div', { class: 'availability-settings_top-content' })
  const itemTitle = new El('p', { 'data-availability-element': 'item-title' })
  const tagLabel = new El('div')
  tagLabel.textContent = 'Main schedule'
  const buttonGroup = new El('div', { class: 'availability-settings_button-group' })
  const editBtn = new El('div')
  editBtn.textContent = 'Edit'
  const removeBtn = new El('div')
  removeBtn.textContent = 'Remove'
  buttonGroup.appendChild(editBtn)
  buttonGroup.appendChild(removeBtn)
  topContent.appendChild(itemTitle)
  topContent.appendChild(tagLabel)
  topContent.appendChild(buttonGroup)

  const headline = new El('div', { class: 'availability-settings_item-headline' })
  const timeWrapper = new El('div', { class: 'availability-settings_description-wrapper' })
  const startLabel = new El('div')
  const dash = new El('div')
  dash.textContent = '-'
  const endLabel = new El('div')
  const tzBlock = new El('div')
  const tzSpan = new El('span', { 'data-availability-element': 'item-timezone' })
  tzBlock.appendChild(tzSpan)
  timeWrapper.appendChild(startLabel)
  timeWrapper.appendChild(dash)
  timeWrapper.appendChild(endLabel)
  timeWrapper.appendChild(tzBlock)

  const daysWrapper = new El('div', { class: 'availability-settings_description-wrapper' })
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  dayNames.forEach((name) => {
    const badge = new El('div', { class: DAY_VARIANT_DEFAULT })
    badge.textContent = name
    daysWrapper.appendChild(badge)
  })
  headline.appendChild(timeWrapper)
  headline.appendChild(daysWrapper)

  const formWrapper = new El('div', { 'data-availability-element': 'availability-form-wrapper' })
  const editInner = new El('div')
  const formOuter = new El('div')
  const form = new El('form', { 'data-availability-element': 'availability-form', 'data-availability-id': '' })
  ;['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].forEach(() => {
    const dayWrap = new El('div')
    const checkbox = new El('input', { type: 'checkbox', name: 'avail-day' })
    dayWrap.appendChild(checkbox)
    form.appendChild(dayWrap)
  })
  const startInput = new El('input', { name: 'start-time' })
  const endInput = new El('input', { name: 'end-time' })
  const priceInput = new El('input', { type: 'hidden', id: 'price', name: 'price', 'data-rate': '150' })
  form.appendChild(startInput)
  form.appendChild(endInput)
  form.appendChild(priceInput)
  formOuter.appendChild(form)
  const buttonRow = new El('div')
  const cancelBtn = new El('div')
  cancelBtn.textContent = 'Cancel'
  const submitBtn = new El('div')
  submitBtn.textContent = 'Save availability'
  buttonRow.appendChild(cancelBtn)
  buttonRow.appendChild(submitBtn)
  editInner.appendChild(formOuter)
  editInner.appendChild(buttonRow)
  formWrapper.appendChild(editInner)

  template.appendChild(topContent)
  template.appendChild(headline)
  template.appendChild(formWrapper)
  return template
}

function buildSectionDom() {
  const root = new El('div', { 'data-availability-element': 'section' })

  const connectWrapper = new El('div', { 'data-availability-element': 'connect-wrapper' })
  const labelGroup = new El('div', { class: 'button-group is-secondary' })
  const disconnectedLabel = new El('div')
  disconnectedLabel.textContent = 'Disonnected'
  const connectedLabel = new El('div')
  connectedLabel.textContent = 'Connected'
  labelGroup.appendChild(disconnectedLabel)
  labelGroup.appendChild(connectedLabel)

  const connectInfoWrapper = new El('div', { 'data-availability-element': 'connect-info-wrapper' })

  const connectBtnWrapper = new El('div', {
    class: 'button-group is-secondary is-max-width-none',
    'data-availability-element': 'connect-btn-wrapper',
  })
  // Deliberately WITHOUT [data-availability-action] — exercises the ordinal
  // fallback until the Designer wrapper divs are added.
  const connectPlatformBtn = new El('div')
  connectPlatformBtn.textContent = 'Connect Platform Calendar'
  const connectGoogleBtn = new El('div')
  connectGoogleBtn.textContent = 'Connect Google Calendar'
  const disconnectGoogleBtn = new El('div')
  disconnectGoogleBtn.textContent = 'Disconnect Google Calendar'
  connectBtnWrapper.appendChild(connectPlatformBtn)
  connectBtnWrapper.appendChild(connectGoogleBtn)
  connectBtnWrapper.appendChild(disconnectGoogleBtn)

  connectWrapper.appendChild(labelGroup)
  connectWrapper.appendChild(connectInfoWrapper)
  connectWrapper.appendChild(connectBtnWrapper)

  const mainWrapper = new El('div', { 'data-availability-element': 'main-wrapper' })
  const listWrapper = new El('div')
  const list = new El('div', { 'data-availability-element': 'list' })
  const loadingSettings = new El('div', { 'data-availability-element': 'loading-settings' })
  const itemTemplate = buildItemTemplate()
  list.appendChild(loadingSettings)
  list.appendChild(itemTemplate)
  listWrapper.appendChild(list)

  const createCard = new El('div')
  const createBtn = new El('div')
  createBtn.textContent = 'Add availability window'
  createCard.appendChild(createBtn)

  const slotsWrapper = new El('div', { 'data-availability-element': 'slots-wrapper' })
  const loadingSlots = new El('div', { 'data-availability-element': 'loading-slots' })
  slotsWrapper.appendChild(loadingSlots)

  mainWrapper.appendChild(listWrapper)
  mainWrapper.appendChild(createCard)
  mainWrapper.appendChild(slotsWrapper)

  root.appendChild(connectWrapper)
  root.appendChild(mainWrapper)

  return {
    root,
    connectBtnWrapper,
    labelGroup,
    connectInfoWrapper,
    mainWrapper,
    list,
    loadingSettings,
    loadingSlots,
    createBtn,
  }
}

/* ------------------------------------------------------------------ */
/* Stateful Xano mock                                                  */
/* ------------------------------------------------------------------ */

function buildStatefulRoutes(initialState) {
  const state = Object.assign(
    {
      grantId: null,
      grantEmail: null,
      calendarId: null,
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: null,
      },
    },
    initialState || {},
  )

  const postRoutes = {
    '/starter/update_availability/v3': (body) => {
      state.availability = body.availability
      return { status: 200, body: { id: 1 } }
    },
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: state.availability,
        nylas_grant_id: state.grantId,
        nylas_grant_email: state.grantEmail,
        nylas_calendar_id: state.calendarId,
      },
    }),
    '/starter/set_timezone/v3': () => ({ status: 200, body: { timezone: 'Asia/Manila' } }),
    '/starter/clear_calendar_data/v3': () => ({ status: 200, body: { id: 1 } }),
    '/nylas_configurations/get_all/v3': () => ({
      status: 200,
      body: state.grantId ? [{ config_id: 'cfg-free', grant_id: state.grantId, is_paid: false }] : [],
    }),
    '/scheduler/configurations/create/v3': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/scheduler/configurations/update/v3': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/scheduler/configurations/delete/v3': () => ({ status: 200, body: { response: { status: 200 } } }),
    '/grants/create_virtual_account/v3': () => {
      state.grantId = 'vgrant-1'
      state.grantEmail = 'virtual@example.com'
      return { status: 200, body: { response: { result: { data: { id: 'vgrant-1', email: 'virtual@example.com' } } } } }
    },
    '/grants/add_virtual/v3': () => ({ status: 200, body: { id: 5 } }),
    '/grants/create_virtual_calendar/v3': () => {
      state.calendarId = 'vcal-1'
      return { status: 200, body: { response: { result: { data: { id: 'vcal-1' } } } } }
    },
    '/grants/delete/v3': () => {
      state.grantId = null
      state.grantEmail = null
      state.calendarId = null
      return { status: 200, body: {} }
    },
    '/grants/oauth/v3': () => ({
      status: 200,
      body: { response: { result: { data: { url: 'https://nylas.example/oauth' } } } },
    }),
    '/grants/add/v3': () => ({ status: 200, body: { grant_id: 'grant-9' } }),
  }

  const getRoutes = {
    '/scheduler/get_availability/v3': () => ({ status: 200, body: { time_slots: [] } }),
  }

  return { state, postRoutes, getRoutes }
}

function loadSection(options = {}) {
  const dom = buildSectionDom()
  const body = new El('body')
  body.appendChild(dom.root)
  const { postRoutes, getRoutes } = buildStatefulRoutes(options.serverState)
  Object.assign(postRoutes, options.postRoutes || {})
  Object.assign(getRoutes, options.getRoutes || {})
  const calls = []
  const warnings = []
  const logs = []
  const assigned = []
  const events = []

  const xanoAuthFetch = async (url, init) => {
    const withoutOrigin = url.replace(API_BASE, '')
    const [path, queryString] = withoutOrigin.split('?')
    const method = (init && init.method) || 'POST'
    if (method === 'GET') {
      const query = Object.fromEntries(new URLSearchParams(queryString || ''))
      calls.push({ path, method, query })
      const route = getRoutes[path]
      if (!route) throw new Error('unrouted GET path ' + path)
      const result = route(query)
      return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body }
    }
    const body = init && init.body ? JSON.parse(init.body) : {}
    calls.push({ path, method, body })
    const route = postRoutes[path]
    if (!route) throw new Error('unrouted path ' + path)
    const result = route(body)
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body }
  }

  const documentElement = new El('html')
  const document = {
    readyState: 'complete',
    title: 'Starter dashboard',
    documentElement,
    createElement: (tag) => new El(tag),
    addEventListener() {},
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  }

  const window = {
    location: {
      hostname: options.hostname || 'thestarters.com',
      search: options.search || '',
      pathname: options.pathname || '/starter-dashboard',
      origin: options.origin || 'https://thestarters.com',
      assign: (url) => assigned.push(url),
    },
    localStorage: {
      _map: new Map(),
      getItem(key) {
        return this._map.has(key) ? this._map.get(key) : null
      },
      setItem(key, value) {
        this._map.set(key, String(value))
      },
    },
    sessionStorage: {
      _map: new Map(),
      getItem(key) {
        return this._map.has(key) ? this._map.get(key) : null
      },
      setItem(key, value) {
        this._map.set(key, String(value))
      },
      removeItem(key) {
        this._map.delete(key)
      },
    },
    history: { replaceState() {} },
    addEventListener(name, listener) {
      if (!window._listeners) window._listeners = new Map()
      if (!window._listeners.has(name)) window._listeners.set(name, [])
      window._listeners.get(name).push(listener)
    },
    dispatchEvent(event) {
      events.push(event)
      for (const listener of (window._listeners && window._listeners.get(event.type)) || []) {
        listener(event)
      }
    },
    $memberstackDom: {
      getCurrentMember: async () => ({ data: options.member || { id: 'member-a', customFields: {} } }),
    },
    MEMBER: { auth: { email: 'member@example.com' } },
    xanoAuthFetch,
  }

  class CustomEvent {
    constructor(name, init) {
      this.type = name
      this.detail = init && init.detail
    }
  }

  vm.runInNewContext(SOURCE, {
    CustomEvent,
    URLSearchParams,
    Intl,
    crypto: { randomUUID: () => 'uuid-fixed' },
    setTimeout: () => {},
    console: {
      warn: (...args) => warnings.push(args.join(' ')),
      info() {},
      log: (...args) => logs.push(args.map(String).join(' ')),
    },
    document,
    window,
  })

  return { dom, calls, warnings, logs, assigned, events, window, document }
}

async function settle(iterations = 25) {
  for (let i = 0; i < iterations; i++) await new Promise(setImmediate)
}

/* ------------------------------------------------------------------ */
/* Tests: applyDayBadges                                               */
/* ------------------------------------------------------------------ */

test('applyDayBadges selects only the given days and clears the rest', async () => {
  const { window, dom } = loadSection()
  await settle()
  const card = dom.list.children.find((el) => el.dataset.id === 'general')
  window.StarterSchedulingAvailabilitySection.applyDayBadges(card, [1, 3])

  const daysWrapper = card.children[1].children[1] // headline -> [time, days]
  const classesOf = (i) => Array.from(daysWrapper.children[i]._classes)
  assert.ok(classesOf(1).includes(DAY_VARIANT_SELECTED))
  assert.ok(classesOf(3).includes(DAY_VARIANT_SELECTED))
  ;[0, 2, 4, 5, 6].forEach((i) => {
    assert.ok(classesOf(i).includes(DAY_VARIANT_DEFAULT))
    assert.ok(!classesOf(i).includes(DAY_VARIANT_SELECTED))
  })
})

test('applyDayBadges reverts to the default variant when no days are selected', async () => {
  const { window, dom } = loadSection()
  await settle()
  const card = dom.list.children.find((el) => el.dataset.id === 'general')
  window.StarterSchedulingAvailabilitySection.applyDayBadges(card, [0])
  window.StarterSchedulingAvailabilitySection.applyDayBadges(card, [])

  const daysWrapper = card.children[1].children[1]
  for (let i = 0; i < 7; i++) {
    assert.ok(Array.from(daysWrapper.children[i]._classes).includes(DAY_VARIANT_DEFAULT))
  }
})

/* ------------------------------------------------------------------ */
/* Tests: getUpcomingTimeSlots                                         */
/* ------------------------------------------------------------------ */

test('getUpcomingTimeSlots sorts, drops past slots, and slices to the limit', async () => {
  // Matches the adapted lead-time rule (Date.now() + 24h floor): slot offsets
  // here are in whole days so they clear that floor comfortably.
  const nowSeconds = Math.floor(Date.now() / 1000)
  const past = nowSeconds - 3600
  const dayOffsets = [5, 4, 3, 2, 1]
  const slots = dayOffsets.map((days) => ({
    start_time: nowSeconds + days * 24 * 60 * 60,
  }))
  slots.push({ start_time: past })

  const { window } = loadSection({
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({ status: 200, body: { time_slots: slots } }),
    },
  })
  await settle()

  const result = await window.StarterSchedulingAvailabilitySection.getUpcomingTimeSlots({
    grantId: 'grant-1',
    configId: 'cfg-free',
    limit: 3,
  })

  assert.equal(result.length, 3)
  assert.ok(result[0] < result[1] && result[1] < result[2])
  assert.ok(result.every((t) => t >= nowSeconds))
})

test('getUpcomingTimeSlots returns an empty array without grantId/configId', async () => {
  const { window } = loadSection()
  await settle()
  const result = await window.StarterSchedulingAvailabilitySection.getUpcomingTimeSlots({})
  assert.equal(result.length, 0)
})

/* ------------------------------------------------------------------ */
/* Tests: connection-state -> visibility                               */
/* ------------------------------------------------------------------ */

test('boots into disconnected state: main-wrapper hidden, connect + google visible, disconnect hidden', async () => {
  const { dom, window } = loadSection()
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'disconnected')
  assert.equal(dom.mainWrapper.style.display, 'none')
  assert.equal(dom.connectInfoWrapper.style.display, '')
  assert.notEqual(dom.connectBtnWrapper.children[0].style.display, 'none') // connect-platform
  assert.notEqual(dom.connectBtnWrapper.children[1].style.display, 'none') // connect-google
  assert.equal(dom.connectBtnWrapper.children[2].style.display, 'none') // disconnect-google
})

test('clicking the ordinal connect-platform button (no data-availability-action yet) connects and flips visibility', async () => {
  const { dom, window, warnings } = loadSection()
  await settle()

  dom.connectBtnWrapper.children[0].click() // connect-platform, ordinal fallback
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.notEqual(dom.mainWrapper.style.display, 'none')
  assert.equal(dom.connectInfoWrapper.style.display, 'none')
  assert.equal(dom.connectBtnWrapper.children[0].style.display, 'none') // now on platform
  assert.notEqual(dom.connectBtnWrapper.children[1].style.display, 'none') // can still switch to Google
  assert.equal(dom.connectBtnWrapper.children[2].style.display, 'none') // not on Google
  assert.ok(warnings.some((w) => w.includes('using ordinal position')))
})

test('boots directly into connected state when the starter already has a grant/calendar/config', async () => {
  const { dom, window } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.notEqual(dom.mainWrapper.style.display, 'none')
  assert.equal(dom.connectBtnWrapper.children[2].style.display, '') // disconnect-google visible
})

/* ------------------------------------------------------------------ */
/* Test: scheduling-availability-writer.js defers to this section      */
/* ------------------------------------------------------------------ */

function loadWriterGuardCheck(hasSectionRoot) {
  const root = new El('div')
  if (hasSectionRoot) {
    root.setAttribute('data-availability-element', 'section')
  }
  const body = new El('body')
  body.appendChild(root)
  const documentElement = new El('html')
  const document = {
    readyState: 'loading',
    title: 'Starter dashboard',
    documentElement,
    addEventListener() {},
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  }
  const window = {
    location: {
      hostname: 'thestarters.com',
      pathname: '/starter-dashboard',
      search: '',
    },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { replaceState() {} },
    addEventListener() {},
    dispatchEvent() {},
    xanoAuthFetch: async () => ({ ok: true, status: 200, json: async () => null }),
  }
  class CustomEvent {
    constructor(name, init) {
      this.type = name
      this.detail = init && init.detail
    }
  }
  vm.runInNewContext(WRITER_SOURCE, {
    CustomEvent,
    URLSearchParams,
    Intl,
    crypto: { randomUUID: () => 'uuid-fixed' },
    setTimeout: () => {},
    console: { warn() {}, info() {}, log() {} },
    document,
    window,
  })
  return window
}

test('writer.js bails out before installing when the new section root is present', () => {
  const withSection = loadWriterGuardCheck(true)
  assert.equal(withSection.StarterSchedulingAvailabilityWriter, undefined)
  assert.equal(withSection.__tsSchedulingAvailabilityWriter, undefined)
})

test('writer.js installs normally when the new section root is absent (e.g. --availability-stage)', () => {
  const withoutSection = loadWriterGuardCheck(false)
  assert.equal(typeof withoutSection.StarterSchedulingAvailabilityWriter.initialize, 'function')
  assert.equal(withoutSection.__tsSchedulingAvailabilityWriter, true)
})
