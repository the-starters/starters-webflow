const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

global.window = global
const api = require('./dashboard-calls.js')

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function element(attributes = {}) {
  return {
    attributes: { ...attributes },
    hidden: false,
    innerHTML: '',
    style: {},
    textContent: '',
    addEventListener() {},
    appendChild() {},
    cloneNode() {
      return element(this.attributes)
    },
    getAttribute(name) {
      return this.attributes[name] || null
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
    },
    classList: {
      toggle() {},
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    remove() {},
    removeAttribute(name) {
      delete this.attributes[name]
    },
    setAttribute(name, value) {
      this.attributes[name] = value
    },
  }
}

async function until(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise(setImmediate)
  }
  assert.fail('condition was not reached')
}

test('activates only canonical V3 dashboard paths', () => {
  assert.equal(api.roleForPath('/starter-dashboard/'), 'starter')
  assert.equal(api.roleForPath('/brand-dashboard'), 'brand')
  assert.equal(api.roleForPath('/freelancer-start-project'), '')
})

test('normalizes lifecycle statuses and completed timestamps', () => {
  const now = 2_000
  assert.equal(api.bookingStatus({ status: 'pending' }, now), 'pending')
  assert.equal(api.bookingStatus({ status: 'declined' }, now), 'cancelled')
  assert.equal(api.bookingStatus({ status: 'confirmed', end: 1_000 }, now), 'completed')
  assert.equal(api.bookingStatus({ status: 'confirmed', end: 3_000 }, now), 'confirmed')
})

test('normalizes canonical Unix seconds once while preserving milliseconds', () => {
  assert.deepEqual(
    api.normalizeBooking({ booking_id: 'seconds', start: 1_709_645_400, end: '1709649000' }),
    { booking_id: 'seconds', start: 1_709_645_400_000, end: 1_709_649_000_000 },
  )
  assert.deepEqual(
    api.normalizeBooking({ booking_id: 'milliseconds', start: 1_709_645_400_000 }),
    { booking_id: 'milliseconds', start: 1_709_645_400_000, end: Number.NaN },
  )
})

test('builds the current confirm payload only when booking_ref identities match', () => {
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const salt = Buffer.from('bounded-salt')
  const bookingRef = Buffer.concat([uuidBytes(configId), uuidBytes(bookingId), salt])
    .toString('base64url')
  const payload = api.confirmPayload({
    booking_id: bookingId,
    config_id: configId,
    booking_ref: bookingRef,
  }, 'dashboard-confirm:one')

  assert.deepEqual(payload, {
    booking_id: bookingId,
    config_id: configId,
    booking_ref_salt: salt.toString('base64url'),
    idempotency_key: 'dashboard-confirm:one',
  })
  assert.equal(api.confirmPayload({
    booking_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    config_id: configId,
    booking_ref: bookingRef,
  }, 'dashboard-confirm:one'), null)
  assert.equal(api.confirmPayload({
    booking_id: bookingId,
    config_id: configId,
    booking_ref: 'malformed',
  }, 'dashboard-confirm:one'), null)
})

test('Starter Accept sends one canonical request and blocks a double click', async () => {
  const configId = '11111111-2222-3333-4444-555555555555'
  const bookingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const uuidBytes = (value) => Buffer.from(value.replace(/-/g, ''), 'hex')
  const bookingRef = Buffer.concat([
    uuidBytes(configId),
    uuidBytes(bookingId),
    Buffer.from('bounded-salt'),
  ]).toString('base64url')
  const booking = {
    booking_id: bookingId,
    config_id: configId,
    booking_ref: bookingRef,
    status: 'pending',
  }
  const listeners = []
  const requests = []
  let releaseRequest
  let restartCount = 0
  const originalDocument = global.document
  const originalCrypto = global.crypto
  const originalFetch = global.xanoAuthFetch
  const card = {
    getAttribute(name) {
      return name === 'data-booking-id' ? bookingId : null
    },
  }
  const button = {
    attributes: {},
    closest(selector) {
      return selector === '[data-booking-id]' ? card : this
    },
    setAttribute(name, value) {
      this.attributes[name] = value
    },
  }
  const event = {
    target: button,
    preventDefault() {},
    stopImmediatePropagation() {},
  }

  try {
    global.document = {
      addEventListener(type, listener, capture) {
        listeners.push({ type, listener, capture })
      },
    }
    global.crypto = { randomUUID: () => 'one-action' }
    global.xanoAuthFetch = async (url, options) => {
      requests.push({ url, options })
      await new Promise((resolve) => { releaseRequest = resolve })
      return { ok: true, json: async () => ({ status: 'confirmed' }) }
    }
    api.wireBookingActions([{ rows: [booking] }], 'starter', async () => {
      restartCount += 1
    })
    assert.equal(listeners.length, 1)
    assert.equal(listeners[0].type, 'click')
    assert.equal(listeners[0].capture, true)

    const first = listeners[0].listener(event)
    const second = listeners[0].listener(event)
    await until(() => requests.length === 1 && typeof releaseRequest === 'function')
    releaseRequest()
    await Promise.all([first, second])

    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/booking\/confirm\/v3$/)
    const requestBody = JSON.parse(requests[0].options.body)
    assert.deepEqual({ ...requestBody, idempotency_key: 'canonical-key' }, {
      booking_id: bookingId,
      config_id: configId,
      booking_ref_salt: Buffer.from('bounded-salt').toString('base64url'),
      idempotency_key: 'canonical-key',
    })
    assert.match(requestBody.idempotency_key, /^dashboard-confirm:[0-9a-f-]+$/)
    assert.equal(restartCount, 1)
    assert.equal(button.attributes['aria-busy'], 'false')
    assert.equal(button.attributes['aria-disabled'], 'false')
  } finally {
    global.document = originalDocument
    global.crypto = originalCrypto
    global.xanoAuthFetch = originalFetch
  }
})

test('only the V3-native Starter Accept action is visible on pending cards', () => {
  const accept = element({ 'booking-action-btn': 'switch-confirm' })
  const decline = element({ 'booking-action-btn': 'switch-decline' })
  const reschedule = element({ 'booking-action-btn': 'reschedule' })
  const message = element({ 'booking-action-btn': 'message' })
  const join = element({ 'booking-action-btn': 'join' })
  const buttons = [accept, decline, reschedule, message, join]
  const card = {
    querySelectorAll(selector) {
      assert.equal(selector, '[booking-card-action-btn], [booking-action-btn]')
      return buttons
    },
  }

  api.configureActionButtons(card, 'starter', 'pending')

  assert.equal(accept.hidden, false)
  assert.equal(accept.style.display, '')
  for (const button of [decline, reschedule, message, join]) {
    assert.equal(button.hidden, true)
    assert.equal(button.style.display, 'none')
  }
})

test('canonical V3 component loader includes the dashboard controller', () => {
  const loader = fs.readFileSync(
    require.resolve('./scheduling-v3-stage-component.html'),
    'utf8',
  )
  assert.match(loader, /v3\/dashboard-calls\.js/)
})

test('auth changes clear identity state and stale requests cannot render', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const firstResponse = deferred()
  const requests = []
  let authChange
  let currentMember = {
    id: 'member-a',
    customFields: { 'free-user': 'Member A', company: 'Company A' },
  }
  const name = element()
  const surname = element()
  const company = element()
  const image = element({ 'hero-element': 'brand-image', srcset: 'placeholder.jpg 1x' })
  const list = element()
  const template = element({ 'bookings-item-template': 'calls' })
  const loader = element()
  const empty = element()
  const count = element()
  const filters = element()
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': loader,
      '[bookings-empty="calls"]': empty,
      '[bookings-count]': count,
      '.tabs-button_component.is-dashboard': filters,
    })[selector] || null
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  template.cloneNode = () => element()
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    querySelector(selector) {
      return (
        {
          '[hero-element="brand-first-name"]': name,
          '[hero-element="brand-last-name"]': surname,
          '[hero-element="brand-company"]': company,
          '[hero-element="brand-image"]': image,
        }[selector] || null
      )
    },
    querySelectorAll(selector) {
      if (selector === '[bookings-section]') return [section]
      return []
    },
  }
  const memberstack = {
    async getCurrentMember() {
      return currentMember
    },
    onAuthChange(listener) {
      authChange = listener
    },
  }
  const window = {
    $memberstackDom: memberstack,
    clearInterval,
    document,
    location: { pathname: '/brand-dashboard' },
    setInterval,
    xanoAuthFetch: async (_url, init) => {
      requests.push(JSON.parse(init.body).memberstack_id)
      if (requests.length === 1) return firstResponse.promise
      return {
        ok: true,
        json: async () => [
          {
            booking_id: 'member-b-call',
            brand_data: { memberstack_id: 'member-b' },
            status: 'confirmed',
          },
        ],
      }
    },
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    document,
    Intl,
    setInterval,
    window,
  })
  await until(() => requests.length === 1)

  currentMember = {
    id: 'member-b',
    customFields: { 'free-user': 'Member B', company: 'Company B' },
    profileImage: 'https://cdn.example/member-b.jpg',
  }
  authChange()
  assert.equal(name.textContent, '')
  assert.equal(company.textContent, '')
  await until(() => requests.length === 2 && root.attributes['data-dashboard-calls-v3'] === 'ready')
  assert.deepEqual(requests, ['member-a', 'member-b'])
  assert.equal(name.textContent, 'Member B')
  assert.equal(company.textContent, 'Company B')
  assert.equal(image.attributes.src, undefined)
  assert.equal(image.attributes.srcset, 'placeholder.jpg 1x')
  assert.equal(filters.hidden, false)

  firstResponse.resolve({ ok: true, json: async () => [] })
  await new Promise(setImmediate)
  assert.equal(name.textContent, 'Member B')

  currentMember = null
  authChange()
  assert.equal(name.textContent, '')
  assert.equal(company.textContent, '')
  assert.equal(filters.hidden, true)
  await until(() => root.attributes['data-dashboard-calls-v3'] === 'error')
})

test('native Brand profile saves repaint the hero only after canonical Memberstack readback', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const profileListeners = {}
  const profileFields = {
    'free-user': { value: 'Old First' },
    'last-name': { value: 'Old Last' },
    company: { value: 'Old Company' },
  }
  const profileForm = element({ 'data-ms-form': 'profile' })
  profileForm.querySelector = (selector) => {
    const match = selector.match(/^\[data-ms-member="(.+)"\]$/)
    return match ? profileFields[match[1]] || null : null
  }
  profileForm.addEventListener = (name, listener) => {
    profileListeners[name] = listener
  }

  const name = element()
  const surname = element()
  const company = element()
  const list = element()
  const template = element({ 'bookings-item-template': 'calls' })
  const loader = element()
  const empty = element()
  const count = element()
  const filters = element()
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': loader,
      '[bookings-empty="calls"]': empty,
      '[bookings-count]': count,
      '.tabs-button_component.is-dashboard': filters,
    })[selector] || null
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  template.cloneNode = () => element()

  let memberReads = 0
  let authChange
  let pendingMemberRead
  const oldMember = {
    id: 'brand-1',
    customFields: {
      'free-user': 'Old First',
      'last-name': 'Old Last',
      company: 'Old Company',
    },
  }
  const newMember = {
    id: 'brand-1',
    customFields: {
      'free-user': 'New First',
      'last-name': 'New Last',
      company: 'New Company',
    },
  }
  let currentMember = oldMember
  const memberstack = {
    async getCurrentMember() {
      memberReads += 1
      if (pendingMemberRead) {
        const read = pendingMemberRead
        pendingMemberRead = null
        return read.promise
      }
      return currentMember
    },
    onAuthChange(listener) {
      authChange = listener
    },
  }
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    querySelector(selector) {
      return (
        {
          '[hero-element="brand-first-name"]': name,
          '[hero-element="brand-last-name"]': surname,
          '[hero-element="brand-company"]': company,
          '[hero-element="brand-image"]': null,
        }[selector] || null
      )
    },
    querySelectorAll(selector) {
      if (selector === '[bookings-section]') return [section]
      if (selector === 'form[data-ms-form="profile"]') return [profileForm]
      return []
    },
  }
  const window = {
    $memberstackDom: memberstack,
    clearInterval,
    document,
    location: { pathname: '/brand-dashboard' },
    setInterval,
    setTimeout: (listener) => setImmediate(listener),
    xanoAuthFetch: async () => ({ ok: true, json: async () => [] }),
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    document,
    Intl,
    setInterval,
    window,
  })
  await until(() => root.attributes['data-dashboard-calls-v3'] === 'ready')
  assert.equal(name.textContent, 'Old First')
  assert.equal(surname.textContent, 'Old Last')
  assert.equal(company.textContent, 'Old Company')

  profileFields['free-user'].value = ' New First '
  profileFields['last-name'].value = ' New Last '
  profileFields.company.value = ' New Company '
  let prevented = false
  profileListeners.submit({
    preventDefault() {
      prevented = true
    },
  })
  await until(() => memberReads >= 3)
  assert.equal(prevented, false)
  assert.equal(name.textContent, 'Old First')

  currentMember = newMember
  await until(() => name.textContent === 'New First')
  assert.equal(surname.textContent, 'New Last')
  assert.equal(company.textContent, 'New Company')

  profileFields['free-user'].value = 'Stale First'
  profileFields['last-name'].value = 'Stale Last'
  profileFields.company.value = 'Stale Company'
  const staleRead = deferred()
  pendingMemberRead = staleRead
  profileListeners.submit({})
  await until(() => pendingMemberRead === null)

  currentMember = {
    id: 'brand-2',
    customFields: {
      'free-user': 'Current First',
      'last-name': 'Current Last',
      company: 'Current Company',
    },
  }
  authChange()
  await until(() => name.textContent === 'Current First')

  staleRead.resolve({
    id: 'brand-1',
    customFields: {
      'free-user': 'Stale First',
      'last-name': 'Stale Last',
      company: 'Stale Company',
    },
  })
  await new Promise(setImmediate)
  assert.equal(name.textContent, 'Current First')
  assert.equal(surname.textContent, 'Current Last')
  assert.equal(company.textContent, 'Current Company')
})

test('fails closed when the authenticated participant identity is absent or mismatched', () => {
  const booking = {
    starter_data: { memberstack_id: 'starter-1' },
    brand_data: { memberstack_id: 'brand-1' },
  }
  assert.equal(api.memberOwnsBooking(booking, 'starter-1', 'starter'), true)
  assert.equal(api.memberOwnsBooking(booking, 'brand-1', 'brand'), true)
  assert.equal(api.memberOwnsBooking(booking, 'brand-1', 'starter'), false)
  assert.equal(api.memberOwnsBooking(booking, '', 'brand'), false)
})

test('deduplicates canonical booking IDs and sorts newest call first', () => {
  const rows = api.uniqueBookings([
    { booking_id: 'old', start: 100 },
    { booking_id: 'new', start: 300 },
    { booking_id: 'old', start: 200 },
    { start: 400 },
  ])
  assert.deepEqual(rows.map((row) => row.booking_id), ['new', 'old'])
})

test('Starter separates pending requests from calls while Brand keeps one call list', () => {
  const rows = [
    { booking_id: 'pending', status: 'pending', start: 300 },
    { booking_id: 'active', status: 'confirmed', start: 200, end: Date.now() + 10_000 },
    { booking_id: 'cancelled', status: 'cancelled', start: 100 },
  ]
  assert.deepEqual(
    api.sectionBookings(rows, 'starter', 'requests').map((row) => row.booking_id),
    ['pending'],
  )
  assert.deepEqual(
    api.sectionBookings(rows, 'starter', 'calls').map((row) => row.booking_id),
    ['active', 'cancelled'],
  )
  assert.equal(api.sectionBookings(rows, 'brand', 'calls').length, 3)
})

test('call filters remain visible when the selected status alone has no matches', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const listeners = {}
  const allFilter = element({ 'booking-filter': 'all' })
  const completedFilter = element({ 'booking-filter': 'completed' })
  allFilter.addEventListener = (name, listener) => {
    listeners.all = listener
  }
  completedFilter.addEventListener = (name, listener) => {
    listeners.completed = listener
  }
  const list = element()
  const renderedCards = []
  list.appendChild = (card) => renderedCards.push(card)
  const template = element({ 'bookings-item-template': 'calls' })
  template.cloneNode = () => element()
  const loader = element()
  const empty = element()
  const filters = element()
  const section = element({ 'bookings-section': 'calls' })
  section.querySelector = (selector) =>
    ({
      '[bookings-list="calls"]': list,
      '[bookings-item-template="calls"]': template,
      '[bookings-loader="calls"]': loader,
      '[bookings-empty="calls"]': empty,
      '.tabs-button_component.is-dashboard': filters,
    })[selector] || null
  section.querySelectorAll = (selector) =>
    selector === '[booking-filter]' ? [allFilter, completedFilter] : []
  list.querySelectorAll = (selector) =>
    selector === '[bookings-item-template]' ? [template] : []
  const root = element()
  const document = {
    documentElement: root,
    readyState: 'complete',
    querySelector() {
      return null
    },
    querySelectorAll(selector) {
      return selector === '[bookings-section]' ? [section] : []
    },
  }
  const window = {
    $memberstackDom: {
      async getCurrentMember() {
        return { id: 'brand-1', customFields: {} }
      },
      onAuthChange() {},
    },
    document,
    location: { pathname: '/brand-dashboard' },
    xanoAuthFetch: async () => ({
      ok: true,
      json: async () => [
        {
          booking_id: 'confirmed-call',
          brand_data: { memberstack_id: 'brand-1' },
          status: 'confirmed',
        },
      ],
    }),
  }

  vm.runInNewContext(source, { console: { error() {} }, document, Intl, window })
  await until(() => root.attributes['data-dashboard-calls-v3'] === 'ready')
  assert.equal(filters.hidden, false)
  assert.equal(renderedCards.length, 1)

  listeners.completed({ preventDefault() {} })
  assert.equal(renderedCards.length, 1)
  assert.equal(list.hidden, true)
  assert.equal(empty.hidden, false)
  assert.equal(filters.hidden, false)
})

test('project filters hide only after an authoritative unfiltered empty result', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      { status: 'success', data: { total: 0 }, query: { params: {} } },
      memory,
    ),
    false,
  )
  assert.deepEqual(memory, { known: true, hasAny: false })
})

test('project filters remain usable when only the selected filter is empty', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: 2 },
        query: { params: { status: '*' } },
      },
      memory,
    ),
    true,
  )
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: 0 },
        query: { params: { status: 'completed' } },
      },
      memory,
    ),
    true,
  )
})

test('project filters stay visible while a known project list changes filters', () => {
  const memory = { known: true, hasAny: true }
  assert.equal(api.projectFilterVisible({ status: 'loading' }, memory), true)
  assert.equal(api.projectFilterVisible({ status: 'error' }, memory), true)
  assert.equal(api.projectFilterVisible({}, memory), true)
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: null },
        query: { params: { status: 'active' } },
      },
      memory,
    ),
    true,
  )
})

test('an active project filter remains usable before the full list is known', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      { status: 'loading', query: { params: { status: 'incomplete' } } },
      memory,
    ),
    true,
  )
  assert.equal(
    api.projectFilterVisible(
      {
        status: 'success',
        data: { total: 0 },
        query: { params: { status: 'active' } },
      },
      memory,
    ),
    true,
  )
  assert.deepEqual(memory, {
    known: false,
    hasAny: false,
    navigationVisible: true,
  })
  assert.equal(
    api.projectFilterVisible(
      { status: 'loading', query: { params: {} } },
      memory,
    ),
    true,
  )
  assert.equal(
    api.projectFilterVisible(
      { status: 'error', query: { params: {} } },
      memory,
    ),
    true,
  )
})

test('an unresolved unfiltered project list stays hidden', () => {
  const memory = { known: false, hasAny: false }
  assert.equal(
    api.projectFilterVisible(
      { status: 'loading', query: { params: {} } },
      memory,
    ),
    false,
  )
  assert.equal(
    api.projectFilterVisible(
      { status: 'error', query: { params: {} } },
      memory,
    ),
    false,
  )
})

test('project filters hide synchronously before wf-xano is available', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const filters = element()
  const project = element({ 'wf-xano-instance': 'dash-projects' })
  project.querySelector = (selector) =>
    selector === '.tabs-button_component.is-dashboard' ? filters : null
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[wf-xano-instance="dash-projects"]') return [project]
      return []
    },
  }
  const window = {
    document,
    location: { pathname: '/starter-dashboard' },
  }

  vm.runInNewContext(source, { document, Intl, window })

  assert.equal(filters.hidden, true)
  assert.equal(filters.style.display, 'none')
  assert.equal(window.WfXano.length, 1)
})

test('an empty selected filter stays visible without issuing a hidden All probe', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const filters = element()
  const project = element({ 'wf-xano-instance': 'dash-projects' })
  project.querySelector = (selector) =>
    selector === '.tabs-button_component.is-dashboard' ? filters : null
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[wf-xano-instance="dash-projects"]') return [project]
      return []
    },
  }
  const window = {
    document,
    location: { pathname: '/starter-dashboard' },
  }
  let state = {
    status: 'success',
    data: { total: 0 },
    query: { params: { status: 'active' } },
  }
  const params = []
  let subscriber
  const instance = {
    qa: () => [filters],
    root: project,
    on() {},
    setParam(field, value) {
      params.push([field, value])
    },
    subscribe(selector, handler) {
      subscriber = (next) => handler(selector(next))
      subscriber(state)
    },
  }

  vm.runInNewContext(source, { document, Intl, window })
  window.WfXano[0]({ get: (key) => (key === 'dash-projects' ? instance : null) })
  assert.deepEqual(params, [])
  assert.equal(filters.hidden, false)

  subscriber({
    status: 'loading',
    data: { total: 0 },
    query: { params: {} },
  })
  assert.equal(filters.hidden, false)

  subscriber({
    status: 'error',
    data: { total: 0 },
    query: { params: {} },
  })
  assert.equal(filters.hidden, false)
})

test('project navigation stays hidden until the remote auth reload resolves', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const filters = element()
  const project = element({ 'wf-xano-instance': 'dash-projects' })
  project.querySelector = (selector) =>
    selector === '.tabs-button_component.is-dashboard' ? filters : null
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[wf-xano-instance="dash-projects"]') return [project]
      return []
    },
  }
  const window = {
    document,
    location: { pathname: '/starter-dashboard' },
  }
  let stateChange
  let subscriber
  const instance = {
    qa: () => [filters],
    root: project,
    on(name, handler) {
      if (name === 'stateChange') stateChange = handler
    },
    subscribe(selector, handler) {
      subscriber = (state) => handler(selector(state))
      subscriber({
        status: 'success',
        data: {
          total: 2,
          items: [
            { id: 1, status: 'pending' },
            { id: 2, status: 'completed' },
          ],
        },
        query: { params: {} },
      })
    },
  }

  vm.runInNewContext(source, { document, Intl, window })
  window.WfXano[0]({ get: (key) => (key === 'dash-projects' ? instance : null) })
  assert.equal(filters.hidden, false)

  stateChange({ reason: 'auth:change' })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'loading',
    data: { total: 1 },
    query: { params: { status: 'active' } },
  })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'error',
    data: { total: 1 },
    query: { params: { status: 'active' } },
  })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'success',
    data: {},
    query: { params: { status: 'active' } },
  })
  assert.equal(filters.hidden, true)

  subscriber({
    status: 'success',
    data: { total: 0 },
    query: { params: { status: 'pending' } },
  })
  assert.equal(filters.hidden, false)
})

test('both current project wrappers are configured for 12-item append pagination', () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const roots = ['dash-projects', 'dash-brand-projects'].map((key) =>
    element({
      'wf-xano-instance': key,
      'wf-xano-source': `opp30:${key === 'dash-projects' ? 'starter' : 'brand'}/projects/mine`,
    }),
  )
  const document = {
    addEventListener() {},
    readyState: 'loading',
    querySelectorAll(selector) {
      const match = /^\[wf-xano-instance="([^"]+)"\]\[wf-xano-source\]$/.exec(selector)
      return match ? roots.filter((root) => root.getAttribute('wf-xano-instance') === match[1]) : []
    },
  }
  const window = { document, location: { pathname: '/starter-dashboard' } }

  vm.runInNewContext(source, { document, Intl, window })

  roots.forEach((root) => {
    assert.equal(root.getAttribute('wf-xano-load'), 'more')
    assert.equal(root.getAttribute('wf-xano-per-page'), '12')
  })
})

test('project Show more loads the next server page and hides after the final page', () => {
  const label = element()
  label.textContent = 'Show more'
  const control = element()
  let listeners = 0
  let disabledClass = false
  control.classList.toggle = (name, force) => {
    if (name === 'is-disabled') disabledClass = force
  }
  let click
  control.addEventListener = (name, handler) => {
    listeners += 1
    if (name === 'click') click = handler
  }
  control.closest = () => null
  control.querySelector = (selector) =>
    selector === '.button_main-text' ? label : null
  const root = element({ 'wf-xano-instance': 'dash-projects' })
  root.querySelectorAll = (selector) => {
    if (selector === '.button_main-wrap') return [control]
    return []
  }
  let loads = 0
  let repaintState
  const instance = {
    appendMode: false,
    loadMode: 'pagination',
    root,
    subscribe(handler) {
      repaintState = handler
      handler({ status: 'success', data: { hasMore: true } })
      return () => {}
    },
    loadNext() {
      loads += 1
    },
  }

  api.wireProjectLoadMore(instance)
  assert.equal(instance.loadMode, 'more')
  assert.equal(instance.appendMode, true)
  assert.equal(instance.perPage, 12)
  assert.equal(root.attributes['wf-xano-load'], 'more')
  assert.equal(root.attributes['wf-xano-per-page'], '12')
  assert.equal(control.hidden, false)
  assert.equal(control.attributes['aria-disabled'], 'false')
  assert.equal(control.attributes['aria-hidden'], 'false')
  assert.equal(control.attributes['aria-busy'], 'false')
  assert.equal(control.attributes['data-opp-loading'], 'false')
  assert.equal(disabledClass, false)
  assert.equal(control.attributes['wf-xano-element'], undefined)
  assert.equal(listeners, 1)
  click({ preventDefault() {} })
  assert.equal(loads, 1)
  repaintState({ status: 'success', data: { hasMore: false } })
  assert.equal(control.hidden, true)
  assert.equal(control.attributes['aria-disabled'], 'true')
  click({ preventDefault() {} })
  assert.equal(loads, 1)
})

test('project pagination creates a scoped Show more control when Webflow omitted one', () => {
  let click
  const label = element()
  label.textContent = 'Show more'
  const template = element()
  template.querySelector = (selector) => selector === '.button_main-text' ? label : null
  template.cloneNode = () => {
    const cloneLabel = element()
    cloneLabel.textContent = 'Show more'
    const clone = element({ 'bookings-load-more': 'calls', hidden: '' })
    clone.querySelector = (selector) => selector === '.button_main-text' ? cloneLabel : null
    clone.closest = () => null
    clone.addEventListener = (name, handler) => {
      if (name === 'click') click = handler
    }
    return clone
  }
  const appended = []
  const root = element({ 'wf-xano-instance': 'dash-brand-projects' })
  root.ownerDocument = {
    querySelectorAll(selector) {
      return selector === '.button_main-wrap' ? [template] : []
    },
  }
  root.contains = () => false
  root.appendChild = (child) => appended.push(child)
  root.querySelectorAll = () => []
  let loads = 0
  const instance = {
    root,
    subscribe(handler) {
      handler({ status: 'success', data: { hasMore: true } })
      return () => {}
    },
    loadNext() {
      loads += 1
    },
  }

  api.wireProjectLoadMore(instance)
  assert.equal(appended.length, 1)
  const control = appended[0]
  assert.equal(control.getAttribute('wf-xano-element'), 'load-more')
  assert.equal(control.getAttribute('wf-xano-instance'), 'dash-brand-projects')
  assert.equal(control.getAttribute('bookings-load-more'), null)
  assert.equal(control.hidden, false)
  assert.equal(control.style.display, '')
  let prevented = 0
  click({ preventDefault() { prevented += 1 } })
  assert.equal(loads, 1)
  control.setAttribute('aria-disabled', 'true')
  click({ preventDefault() { prevented += 1 } })
  assert.equal(prevented, 2)
  assert.equal(loads, 1)
})

for (const total of [0, 12, 20, 73]) {
  test(`project pagination renders and exhausts ${total} server rows in 12-item pages`, async () => {
    const label = element()
    label.textContent = 'Show more'
    const control = element()
    let click
    control.addEventListener = (name, handler) => {
      if (name === 'click') click = handler
    }
    control.closest = () => null
    control.querySelector = (selector) =>
      selector === '.button_main-text' ? label : null
    const root = element({
      'wf-xano-instance': 'dash-projects',
      'wf-xano-source': 'opp30:starter/projects/mine',
    })
    root.querySelectorAll = (selector) => selector === '.button_main-wrap' ? [control] : []
    const rows = Array.from({ length: total }, (_, index) => ({ id: index + 1 }))
    const requests = []
    const subscribers = []
    let state = { status: 'idle', data: { items: [], hasMore: false } }
    const publish = (next) => {
      state = next
      subscribers.forEach((handler) => handler(state))
    }
    const instance = {
      root,
      page: 1,
      getState: () => state,
      subscribe(handler) {
        subscribers.push(handler)
        handler(state)
        return () => {}
      },
      async request(page, append) {
        requests.push({ page, per_page: this.perPage })
        const start = (page - 1) * this.perPage
        const pageRows = rows.slice(start, start + this.perPage)
        const items = append ? state.data.items.concat(pageRows) : pageRows
        publish({
          status: 'success',
          data: { items, hasMore: start + pageRows.length < rows.length },
          query: { page, perPage: this.perPage },
        })
      },
      loadNext() {
        if (!state.data.hasMore) return Promise.resolve()
        this.page += 1
        return this.request(this.page, true)
      },
    }

    api.wireProjectLoadMore(instance)
    await instance.request(1, false)
    while (state.data.hasMore) {
      const expectedRequests = requests.length + 1
      click({ preventDefault() {} })
      await until(() => requests.length === expectedRequests)
    }

    assert.equal(state.data.items.length, total)
    assert.deepEqual(state.data.items.map((row) => row.id), rows.map((row) => row.id))
    assert.equal(requests.length, Math.max(1, Math.ceil(total / 12)))
    assert.ok(requests.every((request) => request.per_page === 12))
    assert.equal(control.hidden, true)
    assert.equal(control.attributes['aria-disabled'], 'true')
  })
}

test('both project dashboards leave remote filtering to the default wf-xano contract', async () => {
  const source = fs.readFileSync(require.resolve('./dashboard-calls.js'), 'utf8')
  const keys = ['dash-projects', 'dash-brand-projects']
  const roots = Object.fromEntries(
    keys.map((key) => {
      const filters = element()
      const root = element({ 'wf-xano-instance': key })
      root.querySelector = (selector) =>
        selector === '.tabs-button_component.is-dashboard' ? filters : null
      return [key, { filters, root }]
    }),
  )
  const snapshots = {}
  const params = {}
  const instances = Object.fromEntries(
    keys.map((key) => [
      key,
      {
        filterMode: 'remote',
        keyed: false,
        keyField: 'id',
        root: roots[key].root,
        qa: () => [roots[key].filters],
        on() {},
        setParam(field, value) {
          params[key] = [field, value]
          return Promise.resolve(key)
        },
        subscribe(selector, handler) {
          snapshots[key] = { filterMode: this.filterMode, keyed: this.keyed }
          handler(
            selector({
              status: 'success',
              data: { total: 1 },
              query: { params: {} },
            }),
          )
        },
      },
    ]),
  )
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) {
      const match = selector.match(/^\[wf-xano-instance="([^"]+)"\]$/)
      if (match && roots[match[1]]) return [roots[match[1]].root]
      return []
    },
  }
  const window = { document, location: { pathname: '/starter-dashboard' } }

  vm.runInNewContext(source, { document, Intl, window })
  window.WfXano[0]({ get: (key) => instances[key] || null })

  keys.forEach((key) => {
    assert.deepEqual(snapshots[key], { filterMode: 'remote', keyed: false })
    assert.equal(roots[key].filters.hidden, false)
  })

  const results = await Promise.all(
    keys.map((key) => instances[key].setParam('status', 'completed')),
  )
  assert.deepEqual(params, {
    'dash-projects': ['status', 'completed'],
    'dash-brand-projects': ['status', 'completed'],
  })
  assert.deepEqual(results, keys)
})
