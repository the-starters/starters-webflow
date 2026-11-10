const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = name => fs.readFileSync(require.resolve('./' + name + '.js'), 'utf8')
const STEP_SOURCE = source('complete-profile-call-step')
const PAID_SOURCE = source('paid-call-brand-payment')
const FREE_SOURCE = source('free-call-booking')
const HANDOFF = 'starters:brand-profile-completed'
const DASHBOARD = '/brand-dashboard'
const SETUP_COPY = "We're still setting up your account. Try again in a moment."
const FIRST_SLOT = Date.parse('2026-04-12T19:00:00Z')
const READY = { booking: { row_id: '1', booking_id: 'booking-fixture' } }
const flush = () => new Promise(resolve => setImmediate(resolve))

class Element extends EventTarget {
  constructor(tagName, ownerDocument) {
    super()
    this.tagName = tagName
    this.ownerDocument = ownerDocument
    this.attributes = new Map()
    this.children = []
    this.style = { setProperty: (name, value) => { this.style[name] = value } }
    this.hidden = false
    this.disabled = false
    this.classList = new Set()
    const addClass = this.classList.add.bind(this.classList)
    this.classList.add = (...names) => names.forEach(addClass)
    this.classList.remove = this.classList.delete.bind(this.classList)
    this.value = ''
    this.text = ''
  }

  set textContent(value) {
    this.text = String(value)
    this.children.forEach(child => { child.parentElement = null })
    this.children.length = 0
    this.ownerDocument?.notifyMutation(this, 'childList')
  }

  get disabled() { return this.hasAttribute('disabled') }
  set disabled(value) {
    if (value) this.setAttribute('disabled', '')
    else this.removeAttribute('disabled')
  }

  get options() { return this.children }
  getBoundingClientRect() { return { height: this.mockHeight || 0 } }

  get textContent() {
    return this.text + this.children.map(child => child.textContent).join('')
  }

  get className() { return [...this.classList].join(' ') }
  set className(value) { this.classList.clear(); this.classList.add(...value.split(/\s+/)) }

  get isConnected() {
    return this.tagName === 'html' || Boolean(this.parentElement?.isConnected)
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    this.ownerDocument?.notifyMutation(this, 'attributes', name)
  }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) {
    if (this.attributes.delete(name)) this.ownerDocument?.notifyMutation(this, 'attributes', name)
  }

  matches(selector) {
    const tag = /^[a-z]+(?=\[)/.exec(selector)
    if (tag && this.tagName !== tag[0]) return false
    if (tag || selector.startsWith('[')) {
      return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) =>
        this.hasAttribute(name) && (value === undefined || this.getAttribute(name) === value))
    }
    if (selector.startsWith('.')) return this.classList.has(selector.slice(1))
    return this.tagName === selector
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node
    return null
  }

  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ])
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }

  remove() {
    if (!this.parentElement) return
    const siblings = this.parentElement.children
    siblings.splice(siblings.indexOf(this), 1)
    this.parentElement.ownerDocument?.notifyMutation(this.parentElement, 'childList')
    this.parentElement = null
  }

  insert(child, next) {
    child.remove()
    child.parentElement = this
    const index = next ? this.children.indexOf(next) : this.children.length
    this.children.splice(index, 0, child)
    this.ownerDocument?.notifyMutation(this, 'childList')
    return child
  }

  appendChild(child) { return this.insert(child) }
  append(...children) { children.forEach(child => this.appendChild(child)) }
  before(node) { this.parentElement.insert(node, this) }
  after(node) { this.parentElement.insert(node, this.parentElement.children[this.parentElement.children.indexOf(this) + 1]) }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click', { cancelable: true })) }
  focus() { this.ownerDocument.activeElement = this }
}

function response(status, data) {
  return { status, ok: status >= 200 && status < 300, json: async () => data }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(options = {}) {
  const html = new Element('html')
  const head = html.appendChild(new Element('head'))
  const body = html.appendChild(new Element('body'))
  const observers = new Set()
  const created = []
  class Observer {
    constructor(callback) {
      this.callback = callback
      this.targets = new Map()
      this.queued = false
    }
    observe(node, settings) {
      this.targets.set(node, settings)
      observers.add(this)
    }
    disconnect() {
      this.targets.clear()
      observers.delete(this)
    }
    notify(node, type, attribute) {
      if (this.queued) return
      const matches = [...this.targets].some(([target, settings]) => {
        if (!settings[type] || (settings.attributeFilter && !settings.attributeFilter.includes(attribute))) return false
        for (let parent = node; parent; parent = settings.subtree && parent.parentElement) {
          if (parent === target) return true
        }
        return false
      })
      if (!matches) return
      this.queued = true
      queueMicrotask(() => {
        this.queued = false
        if (this.targets.size) this.callback()
      })
    }
  }
  const document = {
    readyState: 'complete', head,
    createElement(tag) {
      const node = new Element(tag, document)
      created.push(node)
      return node
    },
    notifyMutation(node, type, attribute) {
      observers.forEach(observer => observer.notify(node, type, attribute))
    },
    getElementById: id => html.querySelector('[id="' + id + '"]'),
    querySelector: selector => html.querySelector(selector),
  }
  const el = (tag, parent, attrs = {}) => {
    const node = parent.appendChild(document.createElement(tag))
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
    return node
  }
  const authored = (tag, parent, name) => el(tag, parent, { ['data-complete-profile-' + name]: '' })
  const details = authored('section', body, 'details')
  const form = el('form', details, { redirect: DASHBOARD })
  const submit = el('button', form, { type: 'submit' })
  const submitLabel = authored('span', form, 'call-submit-label')
  submitLabel.textContent = 'Complete Profile'
  const back = authored('button', body, 'back')
  const step = authored('section', body, 'call-step')
  step.setAttribute('data-call-host-member', 'mem_production_fixture')
  step.setAttribute('data-call-host-slug', 'jai')
  step.classList.add('hide')
  step.style.display = 'none'
  const greeting = el('div', step, { 'data-jai-trial-greeting': '' })
  greeting.mockHeight = 170
  const heading = authored('h1', greeting, 'call-heading')
  const doneHeading = authored('h1', greeting, 'call-heading-done')
  doneHeading.style.display = 'none'
  const loading = el('div', step, { 'data-paid-calendar-element': 'loading' })
  loading.hidden = true
  const spinner = el('div', loading, { 'data-loader': '1000' })
  spinner.classList.add('experts-list_loader', 'is-complete-profile')
  spinner.setAttribute('aria-hidden', 'true')
  const loadingText = el('p', loading, { 'data-paid-calendar-element': 'loading-text', role: 'status' })
  loadingText.textContent = "Loading Jai's available times…"
  const banner = el('p', step, { 'data-complete-profile-call-status': '', 'data-paid-calendar-element': 'status', role: 'status' })
  banner.hidden = true
  const calendar = authored('div', step, 'call-calendar')
  calendar.mockHeight = 735
  const footer = authored('div', step, 'call-footer')
  footer.mockHeight = 132
  const bookingActions = authored('div', footer, 'call-booking-actions')
  const successActions = authored('div', footer, 'call-success-actions')
  successActions.hidden = true
  function native(group, name) {
    const holder = el('div', group, { 'data-jai-trial-native-button': name })
    const wrapper = el('div', holder, { 'data-button-theme': 'black', 'data-button-style': name === 'skip' ? 'tertiary' : 'primary' })
    const label = el('span', wrapper)
    label.textContent = { skip: 'Continue to dashboard', book: 'Book a free call', done: 'Go to dashboard' }[name]
    if (name !== 'book' || !options.bookLabelMissing) label.setAttribute('data-complete-profile-call-button-label', '')
    const button = el('button', wrapper, { type: 'button' })
    button.type = 'button'
    return { holder, wrapper, label, button }
  }
  const skipAction = native(bookingActions, 'skip')
  const bookAction = native(bookingActions, 'book')
  const doneAction = native(successActions, 'done')
  const skip = skipAction.button
  const done = doneAction.button
  const unavailable = authored('section', step, 'call-unavailable')
  unavailable.style.display = 'none'
  const success = authored('section', step, 'call-success')
  success.style.display = 'none'
  const receipt = Object.fromEntries(['start-date', 'start-time', 'price', 'paid-meeting']
    .map(name => [name, el('span', success, { 'booking-element': name })]))
  const contextWrap = el('div', success, { 'booking-element-wrap': '' })
  el('span', contextWrap, { 'booking-element': 'context' })
  const successText = el('p', success, { 'booking-success-text': '' })

  const hostname = options.hostname ?? 'the-starters-3-0.webflow.io'
  const pathname = options.pathname ?? '/complete-profile'
  const role = options.role ?? 'brand-paid'
  const initialMember = { id: 'mem_brand_fixture', auth: { email: 'before@example.test' }, role }
  let currentMember = initialMember
  let now = options.now ?? Date.parse('2026-04-10T12:00:00Z')
  let timerId = 0
  const timers = new Map()
  const navigations = []
  const scrolls = []
  const warnings = []
  const statusReads = []
  const lookups = []
  const requests = []
  const inputs = []
  const configSelections = []
  let recordReady = options.hasRecord ?? true
  const active = { active: true, data_environment: hostname.endsWith('webflow.io') ? 'test' : 'production' }
  const records = [
    { ...active, config_id: 'paid-config', is_paid: true, payment_environment: 'test', price_cents: 10000, duration: 60, currency: 'USD' },
    { ...active, config_id: 'disabled-free', is_paid: false, active: false },
    ...(options.noFreeConfig ? [] : [{ ...active, config_id: 'free-config', is_paid: false }]),
  ]
  let memberReads = 0
  const available = options.availability
  let onBook = options.onBook ?? (() => response(200, READY))
  const xanoAuthFetch = async (url, init) => {
    const path = new URL(url).pathname.split('/').slice(2).join('/')
    const body = init.body && JSON.parse(init.body)
    switch (path) {
      case 'starters_onboarding/get_brand_profile_status':
        statusReads.push({ url, init })
        return options.statusRead?.() ?? response(200, { has_record: recordReady })
      case 'starter/get_booking_profile/v3':
        lookups.push([path, init.method, body])
        return options.starterStatus
          ? response(options.starterStatus, {})
          : response(200, { id: 1, nylas_grant_id: 'grant-fixture', nylas_grant_email: 'mem_host_fixture' })
      case 'nylas_configurations/get_bookable/v3':
        lookups.push([path, init.method, body])
        return response(200, records)
      case 'scheduler/get_availability/v3':
        lookups.push([path, init.method, Object.fromEntries(new URL(url).searchParams)])
        return available ?? response(200, { time_slots: [
          { start_time: FIRST_SLOT / 1000, end_time: (FIRST_SLOT + 1800000) / 1000 },
        ] })
      case 'brand/booking/request/v3':
        requests.push(body)
        return onBook(body)
      default: throw new Error('Unexpected request: ' + path)
    }
  }
  const pickers = new WeakMap()
  const monthNumber = date => date.getFullYear() * 12 + date.getMonth()
  function drawPicker(node, picker) {
    node.textContent = ''
    for (const [direction, offset, edge] of [
      ['prev', -1, picker.month > monthNumber(picker.options.minDate)],
      ['next', 1, picker.month < monthNumber(picker.options.maxDate)],
    ]) {
      const arrow = el('a', node, edge ? { 'data-handler': direction } : {})
      arrow.className = 'ui-datepicker-' + direction + (edge ? '' : ' ui-state-disabled')
      if (edge) arrow.addEventListener('click', () => {
        picker.month += offset
        drawPicker(node, picker)
      })
    }
    picker.options.onUpdateDatepicker?.()
  }
  const $ = node => ({
    datepicker(command, key, value) {
      if (typeof command === 'object') {
        const picker = { options: command, date: command.defaultDate, month: monthNumber(command.defaultDate) }
        pickers.set(node, picker)
        drawPicker(node, picker)
        return
      }
      const picker = pickers.get(node)
      if (command === 'destroy') { pickers.delete(node); return }
      if (command === 'getDate') return picker.date
      if (command === 'isDisabled') return Boolean(picker.options.disabled)
      assert.equal(command, 'option')
      if (typeof key === 'object') Object.assign(picker.options, key)
      else if (value !== undefined) picker.options[key] = value
      else return picker.options[key]
      drawPicker(node, picker)
    },
  })
  $.fn = { datepicker: true }
  const window = {
    ...(options.datepicker ? { jQuery: $ } : {}),
    location: { hostname, pathname, assign: value => navigations.push(value) },
    document,
    xanoAuthFetch: options.authMissing ? undefined : xanoAuthFetch,
    getXanoAuthToken: async () => 'fixture-token',
    StartersV3RouteGuard: { memberRole: member => member.role },
    $memberstackDom: {
      getCurrentMember() {
        memberReads += 1
        return memberReads === 1 && options.memberRead ? options.memberRead : Promise.resolve({ data: currentMember })
      },
    },
    matchMedia: () => ({ matches: options.phone ?? false }),
    scrollTo: (...args) => scrolls.push(args),
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId },
    clearTimeout: id => timers.delete(id),
  }
  const context = vm.createContext({
    window, document, AbortController, URL, URLSearchParams, queueMicrotask,
    Date: class extends Date { static now() { return now } },
    MutationObserver: Observer,
    console: { warn: (...args) => warnings.push(args.join(' ')), error() {}, info() {} },
  })
  vm.runInContext(PAID_SOURCE, context)
  vm.runInContext(FREE_SOURCE, context)
  const paid = window.StartersPaidCallBrandPayment
  const free = window.StartersFreeCallBooking
  const createBookingAttempt = paid.createBookingAttempt
  paid.createBookingAttempt = (input, ...args) => {
    inputs.push(JSON.parse(JSON.stringify(input)))
    return createBookingAttempt(input, ...args)
  }
  window.StartersFreeCallBooking = {
    ...free,
    selectBookableConfigurations: (rows, host) => {
      configSelections.push([rows, host])
      return free.selectBookableConfigurations(rows, host)
    },
  }
  if (options.dependencyMissing) delete window[options.dependencyMissing]
  if (options.markupMissing) calendar.remove()
  if (options.successMissing) success.remove()
  if (options.nativeButtonMissing) bookAction.holder.remove()
  if (options.stepMissing) step.remove()
  created.length = 0
  const load = () => vm.runInContext(STEP_SOURCE, context)
  load()

  function handoff(memberId = initialMember.id, operation = 'brand/account/build') {
    const event = new CustomEvent(HANDOFF, { bubbles: true, cancelable: true, detail: { memberId, operation } })
    form.dispatchEvent(event)
    return event.defaultPrevented
  }

  async function advance(ms) {
    const end = now + ms
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > end) break
      timers.delete(next[0])
      now = next[1].at
      next[1].fn()
      await flush()
    }
    now = end
  }

  const part = name => step.querySelector('[data-paid-calendar-element="' + name + '"]')
  const select = () => calendar.querySelector('[data-paid-calendar-slot]').click()
  const book = () => bookAction.button.click()
  function chooseDate(value) {
    const picker = pickers.get(part('month'))
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    if (date < picker.options.minDate || date > picker.options.maxDate || !picker.options.beforeShowDay(date)[0]) return false
    picker.date = date
    picker.options.onSelect(value)
    drawPicker(part('month'), picker)
    return true
  }
  async function open() {
    await flush()
    assert.equal(handoff(), true, 'the saved profile stays on this page')
    await flush()
  }

  return {
    window, document, calendar, step, details, back, heading, doneHeading, footer, skip, unavailable,
    success, receipt, contextWrap, successText, done, part, select, chooseDate, book, open, handoff, load,
    submit, submitLabel, form, bookingActions, successActions, bookAction, skipAction, doneAction,
    banner, loading, created,
    advance, navigations, scrolls, warnings, statusReads, lookups, requests, inputs, configSelections,
    finishAuth: () => { window.xanoAuthFetch = xanoAuthFetch },
    setEmail: email => { currentMember = { ...initialMember, auth: { email } } },
    ready: () => { recordReady = true },
    setBookingResponse: fn => { onBook = fn },
  }
}

test('only an eligible, ready paid Brand can claim the completion hand-off', async t => {
  const cases = [
    ['wrong host', { hostname: 'other.webflow.io' }],
    ['unrelated page', { pathname: '/complete-profile-trial/other' }],
    ['step absent on trial', { pathname: '/complete-profile-trial', stepMissing: true }],
    ['missing native Book holder', { nativeButtonMissing: true }],
    ['missing receipt', { successMissing: true }],
    ['missing markup', { markupMissing: true }],
    ['missing calendar engine', { dependencyMissing: 'StartersPaidCallBrandPayment' }],
    ['missing free booking helper', { dependencyMissing: 'StartersFreeCallBooking' }],
    ['missing booking lifecycle', { dependencyMissing: 'StartersBookingSurfaceLifecycle' }],
    ['auth unavailable at hand-off', { authMissing: true }],
    ['member lookup pending', { memberRead: deferred().promise }],
    ['free Brand', { role: 'brand-free' }],
    ['Talent', { role: 'talent' }],
    ['different member', {}, 'mem_different'],
    ['different operation', {}, undefined, 'brand/account/settings'],
  ]
  for (const [label, options, memberId, operation] of cases) {
    await t.test(label, async () => {
      const page = fixture(options)
      await flush()
      assert.equal(page.handoff(memberId, operation), false)
      assert.equal(page.details.hidden, false)
      assert.deepEqual(page.lookups, [])
      assert.deepEqual(page.statusReads, [])
    })
  }
})

test('the trial relabel keeps the native submit and its redirect', async () => {
  const trial = fixture({ pathname: '/complete-profile-trial/' })
  assert.equal(trial.submitLabel.textContent, 'Continue')
  assert.equal(trial.submit.getAttribute('aria-label'), 'Continue')
  assert.equal(trial.form.querySelector('[type="submit"]'), trial.submit)
  assert.equal(trial.form.getAttribute('redirect'), DASHBOARD)
  assert.equal(trial.submit.disabled, false)
  await trial.open()
  assert.equal(trial.lookups[0][2].member_id, 'mem_sb_cmqhuaxn80d270sseeo74fn7i')

  const noStep = fixture({ pathname: '/complete-profile-trial', stepMissing: true })
  assert.equal(noStep.submitLabel.textContent, 'Complete Profile')
  assert.equal(noStep.submit.getAttribute('aria-label'), null)
  assert.deepEqual(noStep.created, [])

  const production = fixture({ hostname: 'thestarters.com' })
  assert.equal(production.submitLabel.textContent, 'Complete Profile')
  assert.equal(production.submit.getAttribute('aria-label'), null)
})

test('the staging trial offers and books only slots more than 24 hours away', async () => {
  const page = fixture({
    pathname: '/complete-profile-trial',
    now: FIRST_SLOT - 86400000 - 1000,
    availability: response(200, { time_slots: [
      { start_time: (FIRST_SLOT - 1000) / 1000 },
      { start_time: FIRST_SLOT / 1000 },
    ] }),
  })
  await page.open()
  const slots = page.calendar.querySelectorAll('[data-paid-calendar-slot]')
  assert.deepEqual(slots.map(button => Number(button.getAttribute('data-paid-calendar-slot'))), [FIRST_SLOT])
  page.select()
  await page.advance(1000)
  page.book()
  await flush()
  assert.deepEqual(page.requests, [])
  assert.match(page.banner.textContent, /time is no longer available/i)
  assert.equal(page.bookAction.button.disabled, true)
})

test('production trial preserves the engine notice and uses the authored Jai identity', async () => {
  const page = fixture({ hostname: 'www.thestarters.com', pathname: '/complete-profile-trial',
    now: FIRST_SLOT - 86400000 })
  await page.open()
  assert.deepEqual(page.lookups[0][2], { member_id: 'mem_production_fixture' })
  assert.equal(page.calendar.querySelectorAll('[data-paid-calendar-slot]').length, 1)
  page.select()
  await flush()
  page.book()
  await flush()
  assert.equal(page.requests[0].starter_slug, 'jai')
})

test('a phone confirmation keeps the measured booking layout using the existing page nodes', async () => {
  const pending = deferred()
  const page = fixture({ pathname: '/complete-profile-trial', phone: true, bookLabelMissing: true,
    onBook: () => pending.promise })
  await page.open()
  assert.equal(page.bookAction.button.hasAttribute('data-complete-profile-call-book'), true)
  assert.equal(page.step.style['--jai-booking-body'], undefined)
  page.select()
  await flush()
  page.book()
  await flush()
  assert.equal(page.bookAction.button.getAttribute('aria-busy'), 'true')
  assert.equal(page.bookAction.button.disabled, true)
  assert.equal(page.bookAction.wrapper.getAttribute('data-button-theme'), 'disabled')
  assert.equal(page.skipAction.wrapper.getAttribute('data-button-theme'), 'disabled')
  assert.equal(page.step.style['--jai-booking-body'], '735px')
  assert.equal(page.step.style['--jai-booking-footer'], '132px')
  assert.equal(page.step.style['--jai-booking-heading'], '170px')
  const engineStatus = page.calendar.querySelector('[data-paid-calendar-element="status"]')
  assert.equal(engineStatus.hidden, true)
  assert.equal(page.banner.hidden, false)
  assert.equal(page.banner.getAttribute('data-paid-calendar-status'), 'progress')
  pending.resolve(response(200, READY))
  await flush()
  assert.equal(page.step.getAttribute('data-complete-profile-call-step'), 'success')
  assert.equal(page.bookAction.button.hasAttribute('aria-busy'), false)
  assert.equal(page.banner.hidden, true)
  assert.equal(page.document.activeElement, page.done)
  assert.equal(page.doneAction.holder.parentElement, page.successActions)
})

test('a retry keeps the authored label as the accessible name when no label hook is available', async () => {
  const page = fixture({ bookLabelMissing: true, onBook: () => Promise.reject(new TypeError('network')) })
  await page.open()
  page.select()
  await flush()
  page.book()
  await flush()
  assert.equal(page.bookAction.label.textContent, 'Book a free call')
  assert.equal(page.bookAction.button.getAttribute('aria-label'), 'Book a free call')
  assert.equal(page.bookAction.button.disabled, false)
  assert.equal(page.bookAction.wrapper.getAttribute('data-button-theme'), 'black')
  assert.equal(page.banner.getAttribute('data-paid-calendar-status'), 'error')
  assert.match(page.banner.textContent, /Retry to check the same request/)
})

test('auth may arrive after init, and the staging calendar uses the free test fixture', async () => {
  const pending = deferred()
  const page = fixture({ pathname: '/complete-profile/', authMissing: true, availability: pending.promise })
  await flush()
  page.finishAuth()
  page.load()
  assert.equal(page.handoff(), true)
  await flush()
  assert.equal(page.details.hidden, true)
  assert.equal(page.back.hidden, true)
  assert.equal(page.step.classList.has('hide'), false)
  assert.deepEqual(page.scrolls, [[0, 0]])
  assert.equal(page.calendar.getAttribute('data-paid-calendar-state'), 'loading')
  const loader = page.part('loading').querySelector('[data-loader="1000"]')
  assert.equal(loader.classList.has('experts-list_loader'), true)
  assert.equal(loader.classList.has('is-complete-profile'), true)
  assert.equal(loader.getAttribute('aria-hidden'), 'true')
  assert.equal(page.part('loading-text').textContent, "Loading Jai's available times…")
  assert.equal(page.part('loading-text').getAttribute('role'), 'status')
  assert.equal(page.part('shell'), null)
  assert.equal(page.loading.hidden, false)
  assert.equal(page.calendar.hidden, true)
  assert.equal(page.bookAction.button.disabled, true)
  assert.equal(page.bookAction.wrapper.getAttribute('data-button-theme'), 'disabled')
  assert.deepEqual(page.created, [], 'the module reveals Designer nodes without constructing a page shell')
  assert.equal(page.skip.disabled, false)
  assert.deepEqual(page.lookups.slice(0, 2), [
    ['starter/get_booking_profile/v3', 'POST', { member_id: 'mem_sb_cmqhuaxn80d270sseeo74fn7i' }],
    ['nylas_configurations/get_bookable/v3', 'POST', { grant_id: 'grant-fixture' }],
  ])
  assert.equal(page.configSelections.length, 1, 'loading the script twice cannot start a second lookup')
  assert.equal(page.configSelections[0][1], 'the-starters-3-0.webflow.io')
  assert.equal(page.lookups[2][2].configuration_id, 'free-config')
  pending.resolve(response(200, { time_slots: [] }))
  await flush()
  assert.equal(page.calendar.getAttribute('data-paid-calendar-state'), 'empty')
  assert.equal(page.loading.hidden, true)
  assert.equal(page.calendar.hidden, false)
  assert.equal(page.banner.hidden, true)
  const calendarStatus = page.calendar.querySelector('[data-paid-calendar-element="status"]')
  assert.match(calendarStatus.textContent, /No available times/)
  assert.equal(calendarStatus.hidden, false)
  assert.equal(page.bookAction.button.disabled, true)
  assert.equal(page.skip.disabled, false)
  page.skip.click()
  assert.deepEqual(page.navigations, [DASHBOARD])
  assert.deepEqual(page.requests, [])
})

test('an empty date disables booking and points to the next available date', async () => {
  const page = fixture({ datepicker: true, availability: response(200, { time_slots: [
    { start_time: FIRST_SLOT / 1000 },
    { start_time: FIRST_SLOT / 1000 + 2 * 86400 },
  ] }) })
  await page.open()
  const timezone = page.part('timezone')
  timezone.value = 'UTC'
  timezone.dispatchEvent(new Event('change'))
  page.select()
  assert.equal(page.part('confirm').disabled, false)
  assert.equal(page.chooseDate('2026-04-13'), true)
  assert.equal(page.part('confirm').disabled, true)
  assert.equal(page.part('empty-day').children[0].textContent, 'No times left on Monday, April 13')
  assert.equal(page.part('empty-day').children[1].textContent, "Pick another date. Jai's next opening is Tuesday, April 14.")
  assert.equal(page.chooseDate('2026-04-14'), true)
  assert.equal(page.part('empty-day'), null)
  page.select()
  assert.equal(page.part('confirm').disabled, false)
})

test('native month buttons preserve the calendar bounds and focus across redraws', async () => {
  const pending = deferred()
  const page = fixture({ datepicker: true, onBook: () => pending.promise,
    now: Date.parse('2026-04-25T12:00:00Z'), availability: response(200, { time_slots: [
      { start_time: Date.parse('2026-04-29T12:00:00Z') / 1000 },
      { start_time: Date.parse('2026-05-02T12:00:00Z') / 1000 },
    ] }),
  })
  await page.open()
  const arrow = direction => page.calendar.querySelector('[data-complete-profile-call-month-nav="' + direction + '"]')
  const next = arrow('next')
  assert.equal(next.tagName, 'button')
  assert.equal(next.type, 'button')
  assert.equal(next.getAttribute('aria-label'), 'Next month')
  assert.equal(next.getAttribute('aria-disabled'), 'false')
  assert.equal(arrow('previous').getAttribute('aria-disabled'), 'true')
  assert.equal(arrow('previous').disabled, false, 'the boundary arrow stays in the Tab order')
  arrow('previous').click()
  assert.equal(next.isConnected, true, 'a boundary arrow does not redraw the calendar')
  next.focus()
  next.click()
  assert.equal(next.isConnected, false)
  assert.equal(arrow('next').getAttribute('aria-disabled'), 'true')
  assert.equal(arrow('next').disabled, false)
  assert.equal(arrow('previous').getAttribute('aria-label'), 'Previous month')
  assert.equal(page.document.activeElement, arrow('previous'))
  arrow('previous').click()
  assert.equal(page.document.activeElement, arrow('next'))
  page.select()
  await flush()
  page.book()
  await flush()
  assert.equal(arrow('next').disabled, true, 'calendar navigation is blocked while booking')
  assert.equal(arrow('next').getAttribute('aria-disabled'), 'true')
  pending.resolve(response(422, {}))
  await flush()
  assert.equal(arrow('next').disabled, false, 'navigation returns after a definite rejection')
})

test('a saved profile can book once using the fresh email and go to the dashboard from its receipt', async () => {
  const pending = deferred()
  const page = fixture({ hostname: 'www.thestarters.com', onBook: () => pending.promise })
  await page.open()
  assert.deepEqual(page.lookups[0], ['starter/get_booking_profile/v3', 'POST', { member_id: 'mem_production_fixture' }])
  const bookingActions = page.footer.querySelector('[data-complete-profile-call-booking-actions]')
  const successActions = page.footer.querySelector('[data-complete-profile-call-success-actions]')
  assert.equal(page.part('confirm').closest('[data-complete-profile-call-calendar]'), page.calendar)
  assert.equal(page.part('confirm').hidden, true)
  assert.equal(page.part('confirm').tabIndex, -1)
  assert.deepEqual(bookingActions.children, [page.skipAction.holder, page.bookAction.holder])
  assert.equal(successActions.hidden, true)
  assert.equal(page.banner.parentElement, page.footer.parentElement)
  page.setEmail('updated@example.test')
  page.select()
  await flush()
  page.book()
  page.book()
  await flush()
  assert.equal(page.skip.disabled, true)
  assert.match(page.part('status').textContent, /Sending your request/)
  assert.equal(page.part('status').getAttribute('data-paid-calendar-status'), 'progress')
  assert.equal(page.part('status').getAttribute('role'), 'status')
  page.skip.click()
  assert.deepEqual(page.navigations, [])
  assert.equal(page.requests.length, 1)
  assert.deepEqual(page.inputs, [{
    starter_slug: 'jai',
    config_id: 'free-config',
    start: FIRST_SLOT,
    end: FIRST_SLOT + 1800000,
    timezone: page.part('timezone').value,
    topic: 'New Brand welcome call',
    context: '',
    guest_emails: [],
    brand_email: 'updated@example.test',
    starter_email: 'mem_host_fixture',
  }])
  pending.resolve(response(200, READY))
  await flush()
  assert.equal(page.success.hidden, false)
  assert.equal(page.success.style.display, '')
  assert.equal(page.calendar.hidden, true)
  assert.equal(page.footer.hidden, false)
  assert.equal(page.step.style['--jai-booking-body'], undefined, 'desktop geometry stays CSS-owned')
  assert.equal(bookingActions.hidden, true)
  assert.equal(successActions.hidden, false)
  assert.equal(page.doneAction.holder.parentElement, successActions)
  assert.equal(page.document.activeElement, page.done)
  assert.equal(page.heading.hidden, true)
  assert.equal(page.doneHeading.style.display, '')
  assert.equal(page.contextWrap.hidden, true)
  assert.equal(page.receipt.price.textContent, '$0')
  assert.equal(page.receipt['paid-meeting'].textContent, 'Free')
  assert.match(page.receipt['start-date'].textContent, /April \d+, 2026/)
  assert.match(page.receipt['start-time'].textContent, /\d+:\d{2} (?:AM|PM) \S+/)
  assert.equal(page.successText.textContent, "We'll share your call request with Jai and reach out when it's been confirmed, typically within 24 hours")
  page.done.click()
  assert.deepEqual(page.navigations, [DASHBOARD])
})

test('an ambiguous free request retries the same idempotency key after the slot ages out', async () => {
  const page = fixture()
  await page.open()
  page.select()
  await flush()
  page.setBookingResponse(() => Promise.reject(new TypeError('connection lost after send')))
  page.book()
  await flush()
  assert.equal(page.requests.length, 1)
  assert.equal(page.requests[0].starter_slug, 'jp-dionisio')
  assert.match(page.part('status').textContent, /may have been received/)
  assert.equal(page.bookAction.label.textContent, 'Try again')
  assert.equal(page.bookAction.button.getAttribute('aria-label'), 'Try again')
  assert.equal(page.bookAction.button.disabled, false)
  await page.advance(FIRST_SLOT - Date.parse('2026-04-10T12:00:00Z'))
  page.setBookingResponse(() => response(200, READY))
  page.book()
  await flush()
  assert.equal(page.requests.length, 2)
  assert.ok(page.requests[0].idempotency_key)
  assert.deepEqual(page.requests[0], page.requests[1])
  assert.equal(page.inputs.length, 1)
  assert.equal(page.success.style.display, '')
})

test('a first attempt with a stale selected slot never posts and clears selection', async () => {
  const page = fixture({ now: FIRST_SLOT - 360000 })
  await page.open()
  page.select()
  await page.advance(61000)
  page.book()
  await flush()
  assert.deepEqual(page.requests, [])
  assert.match(page.part('status').textContent, /time is no longer available/i)
  assert.equal(page.calendar.querySelector('[data-paid-calendar-slot]').getAttribute('aria-pressed'), 'false')
  assert.equal(page.part('confirm').disabled, true)
  assert.equal(page.skip.disabled, false)
})

test('Brand status polls on a bounded interval and blocks booking with the setup copy', async () => {
  const page = fixture({ hasRecord: false })
  await page.open()
  assert.equal(page.statusReads.length, 1)
  const { url, init } = page.statusReads[0]
  assert.match(url, /\/api:KZf7nFnk\/starters_onboarding\/get_brand_profile_status$/)
  assert.equal(init.method, 'GET')
  assert.equal(init.headers.Authorization, 'Bearer fixture-token')
  page.select()
  await flush()
  page.book()
  await flush()
  assert.deepEqual(page.requests, [])
  assert.equal(page.part('status').textContent, SETUP_COPY)
  assert.equal(page.part('status').getAttribute('data-paid-calendar-status'), 'error')
  assert.equal(page.bookAction.label.textContent, 'Try again')
  assert.equal(page.bookAction.button.getAttribute('aria-label'), 'Try again')
  assert.equal(page.bookAction.button.disabled, false)
  await page.advance(1000)
  assert.equal(page.statusReads.length, 2)
  await page.advance(12000)
  assert.equal(page.statusReads.length, 10)
  page.ready()
  page.book()
  await flush()
  assert.equal(page.statusReads.length, 11, 'clicking after timeout restarts the bounded status check')
  assert.deepEqual(page.requests, [])
  page.book()
  await flush()
  assert.equal(page.requests.length, 1)
})

test('service-not-found is retryable shortly after submit and later falls back', async () => {
  const page = fixture({ onBook: () => response(404, { message: 'Bookable service was not found' }) })
  await page.open()
  page.select()
  await flush()
  page.book()
  await flush()
  assert.equal(page.part('status').textContent, SETUP_COPY)
  assert.equal(page.unavailable.style.display, 'none')
  await page.advance(60001)
  page.book()
  await flush()
  assert.equal(page.requests.length, 2)
  assert.equal(page.unavailable.style.display, '')
  assert.equal(page.part('confirm').hidden, true)
  page.skip.click()
  assert.deepEqual(page.navigations, [DASHBOARD])
})

test('calendar and booking errors leave a working Continue action', async t => {
  for (const [label, options, submit] of [
    ['starter lookup 404', { starterStatus: 404 }, false],
    ['no free config', { noFreeConfig: true }, false],
    ['availability 403', { availability: response(403, {}) }, false],
    ['booking 403', { onBook: () => response(403, {}) }, true],
  ]) {
    await t.test(label, async () => {
      const page = fixture(options)
      await page.open()
      if (submit) {
        page.select()
        await flush()
        page.book()
        await flush()
      }
      assert.equal(page.calendar.hidden, true)
      assert.equal(page.unavailable.style.display, '')
      assert.equal(page.bookAction.holder.hidden, true)
      assert.equal(page.skipAction.wrapper.getAttribute('data-button-style'), 'primary')
      assert.equal(page.footer.hidden, false)
      assert.equal(page.skip.disabled, false)
      page.skip.click()
      assert.deepEqual(page.navigations, [DASHBOARD])
    })
  }
})

test('the browser release matches the published script header', () => {
  const page = fixture()
  const header = /@release (v\d+\.\d+\.\d+)/.exec(STEP_SOURCE)
  assert.ok(header, 'the published script carries a release marker')
  assert.equal(page.window.StartersCompleteProfileCallStep.release, header[1])
})
