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
    this.style = {}
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
  }

  get textContent() {
    return this.text + this.children.map(child => child.textContent).join('')
  }

  get className() { return [...this.classList].join(' ') }
  set className(value) { this.classList.clear(); this.classList.add(...value.split(/\s+/)) }

  get isConnected() {
    return this.tagName === 'html' || Boolean(this.parentElement?.isConnected)
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }

  matches(selector) {
    const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector)
    if (attribute) return this.hasAttribute(attribute[1]) &&
      (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2])
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
    this.parentElement = null
  }

  insert(child, next) {
    child.remove()
    child.parentElement = this
    const index = next ? this.children.indexOf(next) : this.children.length
    this.children.splice(index, 0, child)
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
  const document = {
    readyState: 'complete', head,
    createElement: tag => new Element(tag, document),
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
  const form = el('form', details)
  const back = authored('button', body, 'back')
  const step = authored('section', body, 'call-step')
  step.setAttribute('data-call-host-member', 'mem_production_fixture')
  step.setAttribute('data-call-host-slug', 'jai')
  step.classList.add('hide')
  step.style.display = 'none'
  const heading = authored('h1', step, 'call-heading')
  const doneHeading = authored('h1', step, 'call-heading-done')
  doneHeading.style.display = 'none'
  const calendar = authored('div', step, 'call-calendar')
  calendar.setAttribute('data-booking-confirm-class', 'book-primary')
  const footer = authored('div', step, 'call-footer')
  const bookingActions = options.sharedFooter ? authored('div', footer, 'call-booking-actions') : footer
  const successActions = options.sharedFooter ? authored('div', footer, 'call-success-actions') : null
  const skip = authored('button', bookingActions, 'call-continue')
  const unavailable = authored('section', step, 'call-unavailable')
  unavailable.style.display = 'none'
  const success = authored('section', step, 'call-success')
  success.style.display = 'none'
  const receipt = Object.fromEntries(['start-date', 'start-time', 'price', 'paid-meeting']
    .map(name => [name, el('span', success, { 'booking-element': name })]))
  const contextWrap = el('div', success, { 'booking-element-wrap': '' })
  el('span', contextWrap, { 'booking-element': 'context' })
  const successText = el('p', success, { 'booking-success-text': '' })
  const done = authored('button', successActions || success, 'call-done')

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
    scrollTo: (...args) => scrolls.push(args),
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId },
    clearTimeout: id => timers.delete(id),
  }
  const context = vm.createContext({
    window, document, AbortController, URL, URLSearchParams, queueMicrotask,
    Date: class extends Date { static now() { return now } },
    MutationObserver: class { observe() {} disconnect() {} },
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
  const book = () => part('confirm').click()
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
    ['trial page', { pathname: '/complete-profile-trial' }],
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
  assert.equal(page.part('confirm').disabled, true)
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
  assert.equal(page.part('loading'), null)
  assert.equal(page.part('status').parentElement, page.calendar)
  assert.match(page.part('status').textContent, /No available times/)
  assert.equal(page.part('confirm').disabled, true)
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
  page.book()
  await flush()
  assert.equal(arrow('next').disabled, true, 'calendar navigation is blocked while booking')
  assert.equal(arrow('next').getAttribute('aria-disabled'), 'true')
  pending.resolve(response(422, {}))
  await flush()
  assert.equal(arrow('next').disabled, false, 'navigation returns after a definite rejection')
})

test('a legacy receipt keeps its authored dashboard button in the shared footer', async () => {
  const page = fixture()
  await page.open()
  page.select()
  page.book()
  await flush()
  assert.equal(page.success.querySelector('[data-complete-profile-call-done]'), null)
  assert.equal(page.footer.querySelector('[data-complete-profile-call-done]'), page.done)
  page.done.click()
  assert.deepEqual(page.navigations, [DASHBOARD])
})

test('a saved profile can book once using the fresh email and go to the dashboard from its receipt', async () => {
  const pending = deferred()
  const page = fixture({ hostname: 'www.thestarters.com', sharedFooter: true, onBook: () => pending.promise })
  await page.open()
  assert.deepEqual(page.lookups[0], ['starter/get_booking_profile/v3', 'POST', { member_id: 'mem_production_fixture' }])
  const bookingActions = page.footer.querySelector('[data-complete-profile-call-booking-actions]')
  const successActions = page.footer.querySelector('[data-complete-profile-call-success-actions]')
  assert.equal(page.part('confirm').parentElement, bookingActions)
  assert.equal(bookingActions.children[1], page.part('confirm'))
  assert.equal(successActions.hidden, true)
  assert.equal(page.footer.parentElement.children[page.footer.parentElement.children.indexOf(page.footer) - 1], page.part('status'))
  page.setEmail('updated@example.test')
  page.select()
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
  assert.equal(bookingActions.hidden, true)
  assert.equal(successActions.hidden, false)
  assert.equal(page.done.parentElement, successActions)
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
  page.setBookingResponse(() => Promise.reject(new TypeError('connection lost after send')))
  page.book()
  await flush()
  assert.equal(page.requests.length, 1)
  assert.equal(page.requests[0].starter_slug, 'jp-dionisio')
  assert.match(page.part('status').textContent, /may have been received/)
  assert.equal(page.part('confirm').textContent, 'Try again')
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
  page.book()
  await flush()
  assert.deepEqual(page.requests, [])
  assert.equal(page.part('status').textContent, SETUP_COPY)
  assert.equal(page.part('status').getAttribute('data-paid-calendar-status'), 'error')
  assert.equal(page.part('confirm').textContent, 'Try again')
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
        page.book()
        await flush()
      }
      assert.equal(page.calendar.hidden, true)
      assert.equal(page.unavailable.style.display, '')
      assert.ok(!page.part('confirm') || page.part('confirm').hidden)
      assert.equal(page.footer.hidden, false)
      assert.equal(page.skip.disabled, false)
      page.skip.click()
      assert.deepEqual(page.navigations, [DASHBOARD])
    })
  }
})

test('missing receipt markup still shows Call Requested and a dashboard exit', async () => {
  const page = fixture({ successMissing: true })
  await page.open()
  page.select()
  page.book()
  await flush()
  assert.match(page.calendar.textContent, /Call Requested/)
  page.footer.querySelector('[data-complete-profile-call-done]').click()
  assert.deepEqual(page.navigations, [DASHBOARD])
})

test('the browser release matches the published script header', () => {
  const page = fixture()
  const header = /@release (v\d+\.\d+\.\d+)/.exec(STEP_SOURCE)
  assert.ok(header, 'the published script carries a release marker')
  assert.equal(page.window.StartersCompleteProfileCallStep.release, header[1])
})
