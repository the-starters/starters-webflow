const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const api = require('./free-call-booking.js')
const SOURCE = fs.readFileSync(require.resolve('./free-call-booking.js'), 'utf8')

function loadBrowserApi(hostname, xanoAuthFetch) {
  const window = {
    location: hostname === undefined ? {} : { hostname },
    xanoAuthFetch,
  }
  vm.runInNewContext(SOURCE, {
    URLSearchParams,
    console,
    globalThis: window,
    window,
  })
  return window.StartersFreeCallBooking
}

class Element {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag
    this.attributes = { ...attrs }
    this.style = {}
    this.textContent = ''
    this.children = []
    this.parentElement = null
    this.queries = new Map()
    this.onclick = null
    this.listeners = {}
    this.value = ''
  }

  setQuery(selector, values) {
    this.queries.set(selector, Array.isArray(values) ? values : [values])
  }

  querySelectorAll(selector) {
    return (this.queries.get(selector) || []).slice()
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  addEventListener(name, listener) {
    if (!this.listeners[name]) this.listeners[name] = []
    this.listeners[name].push(listener)
  }

  contains(candidate) {
    return this.children.some(function visit(child) {
      return child === candidate || child.children.some(visit)
    })
  }

  closest(selector) {
    let node = this
    while (node) {
      if (selector === '[call-type-item]' && node.getAttribute('call-type-item') !== null) return node
      if (selector === '[popup-booking]' && node.getAttribute('popup-booking') !== null) return node
      node = node.parentElement
    }
    return null
  }
}

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

function event() {
  return { prevented: 0, preventDefault() { this.prevented += 1 } }
}

function withGlobals(values, run) {
  const before = new Map()
  Object.keys(values).forEach((key) => {
    before.set(key, global[key])
    global[key] = values[key]
  })
  return Promise.resolve().then(run).finally(() => {
    before.forEach((value, key) => {
      if (value === undefined) delete global[key]
      else global[key] = value
    })
  })
}

function chooserFixture({ includeMain = true, guests = [] } = {}) {
  const popup = new Element('section', { 'popup-booking': '' })
  const close = new Element('button', { 'data-modal-close': '' })
  const freeButtons = new Element('div', { 'success-call-buttons': '', 'data-type': 'free' })
  const paidButtons = new Element('div', { 'success-call-buttons': '', 'data-type': 'paid' })
  const defaultStep = new Element('div', { 'schedule-step': 'default' })
  const successStep = new Element('div', { 'schedule-step': 'success' })
  const successText = new Element('p', { 'booking-success-text': '' })
  const successCallType = new Element('p', { 'booking-element': 'paid-meeting' })
  const legacyCardNotice = new Element('p')
  successCallType.textContent = 'Paid Call'
  legacyCardNotice.textContent = 'Your card ending in 1234 will be charged for this call.'
  const guestError = new Element('p', { 'data-call-guest-error': '' })
  const topic = new Element('input', { name: 'topic' })
  const context = new Element('textarea', { name: 'context' })
  topic.value = 'Growth audit'
  context.value = 'Review the launch plan'
  popup.setQuery('[success-call-buttons]', [freeButtons, paidButtons])
  popup.setQuery('[schedule-step]', [defaultStep, successStep])
  popup.setQuery('[booking-success-text]', successText)
  popup.setQuery('[schedule-step="success"] [booking-element="paid-meeting"]', successCallType)
  popup.setQuery('[schedule-step="success"] *', [successCallType, legacyCardNotice])
  popup.setQuery('[data-call-guest-error]', guestError)
  popup.setQuery('[data-call-guest-email]', guests)
  popup.setQuery('[name="topic"], [booking-topic]', topic)
  popup.setQuery('[name="context"], [booking-context]', context)
  popup.setQuery('[data-modal-close], [booking-popup-close], [popup-booking-close]', close)

  const item = new Element('div', { 'call-type-item': '' })
  const nextSlot = new Element('span', { 'next-available-slot': '' })
  const cta = new Element('button', { 'booking-popup-open': '', 'data-type': 'free' })
  item.appendChild(cta)
  item.appendChild(nextSlot)
  item.setQuery('[next-available-slot]', nextSlot)

  const main = new Element('button', { 'data-modal-trigger': 'popup-booking-main' })
  const container = new Element('div', { 'nylas-container': '' })
  popup.appendChild(container)
  popup.setQuery('[nylas-container]', container)

  let guestUi = null
  if (guests.length) {
    const wrapper = new Element('div', { 'data-call-guest-fields': '' })
    const list = new Element('div', { 'data-call-guest-list': '' })
    const add = new Element('button', { 'data-call-guest-add': '' })
    const rows = guests.map(function (field) {
      const row = new Element('div', { 'data-call-guest-row': '' })
      const remove = new Element('button', { 'data-call-guest-remove': '' })
      row.appendChild(field)
      row.appendChild(remove)
      row.setQuery('[data-call-guest-email]', field)
      row.setQuery('[data-call-guest-remove]', remove)
      list.appendChild(row)
      return { field, remove, row }
    })
    list.setQuery('[data-call-guest-row]', rows.map(({ row }) => row))
    wrapper.appendChild(list)
    wrapper.appendChild(add)
    wrapper.appendChild(guestError)
    wrapper.setQuery('[data-call-guest-list]', list)
    wrapper.setQuery('[data-call-guest-add]', add)
    wrapper.setQuery('[data-call-guest-error]', guestError)
    popup.appendChild(wrapper)
    popup.setQuery('[data-call-guest-fields]', wrapper)
    popup.setQuery('[data-call-guest-list]', list)
    popup.setQuery('[data-call-guest-add]', add)
    popup.setQuery('[data-call-guest-row]', rows.map(({ row }) => row))
    popup.setQuery('[data-call-guest-remove]', rows.map(({ remove }) => remove))
    popup.setQuery(
      '[data-call-guest-fields], [data-call-guest-list], [data-call-guest-error], [data-call-guest-add], [data-call-guest-row], [data-call-guest-email], [data-call-guest-remove]',
      [wrapper, list, guestError, add].concat(rows.flatMap(({ row, field, remove }) => [row, field, remove])),
    )
    guestUi = { add, rows, wrapper }
  }

  const document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      if (selector === '[nylas-container]') return container
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('[data-type="free"]')) return [cta]
      if (selector === '[data-modal-trigger="popup-booking-main"]') return includeMain ? [main] : []
      return []
    },
  }
  return {
    container,
    close,
    context,
    cta,
    defaultStep,
    document,
    freeButtons,
    guestError,
    guestUi,
    item,
    main,
    nextSlot,
    paidButtons,
    popup,
    successStep,
    successCallType,
    successText,
    legacyCardNotice,
    topic,
  }
}

function bookingApiFixture(options = {}) {
  const state = {
    attempts: 0,
    inputs: [],
    mounts: [],
    runs: 0,
  }
  const bookingApi = {
    bookingRequestFingerprint(input) {
      return JSON.stringify(input)
    },
    createBookingAttempt(input) {
      state.attempts += 1
      state.inputs.push(input)
      return {
        run: async () => {
          state.runs += 1
          if (options.run) return options.run(state.runs)
          return {
            booking: {
              booking_id: 'provider-free-1',
              row_id: 901,
            },
          }
        },
      }
    },
    mountPaidCalendar: async (mount) => {
      state.mounts.push(mount)
      return { slots: [{ start: 1, end: 2 }] }
    },
    readGuestEmails: (popup) => options.guests || popup
      .querySelectorAll('[data-call-guest-email]')
      .filter((field) => !field.disabled && String(field.value || '').trim())
      .map((field) => String(field.value).trim().toLowerCase()),
  }
  return { bookingApi, state }
}

function installSettings(bookingApi) {
  return {
    bookingApi,
    brandEmail: 'brand@example.com',
    config: { config_id: 'free_prod', duration: 30, is_paid: false, price_cents: 0 },
    grantId: 'grant_prod',
    starterEmail: 'starter@example.com',
    starterSlug: 'starter-slug',
  }
}

test('canonical Free reads use one authenticated request and exact V3 routes', async () => {
  const calls = []
  const now = Date.UTC(2026, 7, 20, 0, 0, 0)
  await withGlobals({
    xanoAuthFetch: async (url, options) => {
      calls.push({ url, options })
      if (url.includes(api.STARTER_PATH)) return response({ id: 82, nylas_grant_id: 'grant_1' })
      if (url.includes(api.CONFIGS_PATH)) return response([{ config_id: 'free_1', is_paid: false }])
      return response({ time_slots: [
        { start_time: Math.floor(now / 1000) + 200000 },
        { start_time: Math.floor(now / 1000) + 100000 },
      ] })
    },
  }, async () => {
    assert.equal((await api.getStarterByMemberId('mem_starter')).id, 82)
    assert.equal((await api.getConfigs('grant_1'))[0].config_id, 'free_1')
    assert.equal(await api.getNearestSlot('grant_1', 'free_1', now), Math.floor(now / 1000) + 100000)
  })

  assert.equal(calls.length, 3)
  assert.equal(new URL(calls[0].url).pathname.endsWith(api.STARTER_PATH), true)
  assert.deepEqual(JSON.parse(calls[0].options.body), { member_id: 'mem_starter' })
  assert.equal(new URL(calls[1].url).pathname.endsWith(api.CONFIGS_PATH), true)
  assert.deepEqual(JSON.parse(calls[1].options.body), { grant_id: 'grant_1' })
  assert.equal(new URL(calls[2].url).pathname.endsWith(api.AVAILABILITY_PATH), true)
})

test('Free availability uses five minutes only on the exact staging host', async () => {
  const now = Date.UTC(2026, 7, 24, 0, 0, 0)
  const nowSeconds = Math.floor(now / 1000)
  assert.equal(api.minimumBookingNoticeMinutes(), 1440)
  const staging = loadBrowserApi('the-starters-3-0.webflow.io', async () => response({
    time_slots: [{ start_time: nowSeconds + 5 * 60 }],
  }))
  assert.equal(staging.minimumBookingNoticeMinutes(), 5)
  assert.equal(await staging.getNearestSlot('grant', 'config', now), nowSeconds + 5 * 60)
  assert.equal(loadBrowserApi('thestarters.com').minimumBookingNoticeMinutes(), 1440)
})

test('the authored chooser installs without a legacy main trigger', async () => {
  const fixture = chooserFixture({ includeMain: false })
  const booking = bookingApiFixture()
  await withGlobals({ document: fixture.document }, async () => {
    assert.equal(api.installFreeBookingController(installSettings(booking.bookingApi)), true)
  })
  assert.equal(fixture.cta.getAttribute('data-config'), 'free_prod')
  assert.equal(fixture.cta.getAttribute('data-free-call-v3'), 'ready')
  assert.equal(typeof fixture.cta.onclick, 'function')
})

test('Free click mounts the authored calendar and canonical command', async () => {
  const guests = Array.from({ length: 5 }, () => new Element('input', { 'data-call-guest-email': '' }))
  const fixture = chooserFixture({ guests })
  const booking = bookingApiFixture()
  await withGlobals({ document: fixture.document }, async () => {
    assert.equal(api.installFreeBookingController(installSettings(booking.bookingApi)), true)
    await fixture.cta.onclick(event())
    assert.equal(booking.state.mounts.length, 1)
    assert.equal(booking.state.mounts[0].confirmText, 'Request free call')
    assert.deepEqual(booking.state.mounts[0].config, {
      config_id: 'free_prod',
      duration: 30,
      grant_id: 'grant_prod',
      is_paid: false,
      price_cents: 0,
    })
    fixture.topic.value = 'Growth audit'
    fixture.context.value = 'Review the launch plan'
    booking.state.mounts[0].onSelectionChange({ start: 1780000000000, end: 1780001800000 })
    assert.equal(fixture.guestUi.wrapper.style.display, 'flex')
    assert.equal(fixture.guestUi.rows[0].field.disabled, false)
    fixture.guestUi.add.listeners.click[0](event())
    assert.equal(fixture.guestUi.rows[1].row.style.display, 'flex')
    fixture.guestUi.rows[1].field.value = 'Guest@Example.com'
    await booking.state.mounts[0].onConfirm({
      start: 1780000000000,
      end: 1780001800000,
      timezone: 'Asia/Manila',
    })
  })

  assert.equal(booking.state.attempts, 1)
  assert.equal(booking.state.runs, 1)
  assert.deepEqual(booking.state.inputs[0], {
    brand_email: 'brand@example.com',
    config_id: 'free_prod',
    context: 'Review the launch plan',
    end: 1780001800000,
    guest_emails: ['guest@example.com'],
    start: 1780000000000,
    starter_email: 'starter@example.com',
    starter_slug: 'starter-slug',
    timezone: 'Asia/Manila',
    topic: 'Growth audit',
  })
  assert.equal(fixture.defaultStep.style.display, 'none')
  assert.equal(fixture.successStep.style.display, 'flex')
  assert.match(fixture.successText.textContent, /free call request was sent/i)
  assert.equal(fixture.successCallType.textContent, 'Free Call')
  assert.equal(fixture.legacyCardNotice.style.display, 'none')
  assert.equal(fixture.legacyCardNotice.getAttribute('aria-hidden'), 'true')
})

test('Free success requires both canonical row and provider booking identifiers', async () => {
  const fixture = chooserFixture()
  const booking = bookingApiFixture({ run: async () => ({ booking: { booking_id: 'provider-only' } }) })
  await withGlobals({ document: fixture.document }, async () => {
    api.installFreeBookingController(installSettings(booking.bookingApi))
    await fixture.cta.onclick(event())
    await assert.rejects(
      booking.state.mounts[0].onConfirm({ start: 1, end: 2, timezone: 'UTC' }),
      /canonical booking response is incomplete/i,
    )
  })
  assert.notEqual(fixture.successStep.style.display, 'flex')
})

test('a failed Free request reuses its bounded booking attempt on retry', async () => {
  const fixture = chooserFixture()
  const booking = bookingApiFixture({
    run: async (run) => {
      if (run === 1) throw new Error('temporary failure')
      return { booking: { booking_id: 'provider-free-2', row_id: 902 } }
    },
  })
  await withGlobals({ document: fixture.document }, async () => {
    api.installFreeBookingController(installSettings(booking.bookingApi))
    await fixture.cta.onclick(event())
    const slot = { start: 1, end: 2, timezone: 'UTC' }
    await assert.rejects(booking.state.mounts[0].onConfirm(slot), /temporary failure/)
    await booking.state.mounts[0].onConfirm(slot)
  })
  assert.equal(booking.state.attempts, 1)
  assert.equal(booking.state.runs, 2)
  assert.equal(fixture.successStep.style.display, 'flex')
})

test('a newer shared-surface owner prevents a pending Free calendar mount', async () => {
  const fixture = chooserFixture()
  let resolveMount
  const booking = bookingApiFixture()
  booking.bookingApi.mountPaidCalendar = (mount) => {
    booking.state.mounts.push(mount)
    return new Promise((resolve) => { resolveMount = resolve })
  }
  await withGlobals({ document: fixture.document }, async () => {
    api.installFreeBookingController(installSettings(booking.bookingApi))
    const pending = fixture.cta.onclick(event())
    global.StartersBookingSurfaceOwnership.claim(fixture.container)
    resolveMount({ slots: [] })
    await pending
  })
  assert.equal(booking.state.mounts[0].isCurrent(), false)
})

test('Free-only modal close resets fields and ignores stale booking success', async () => {
  const fixture = chooserFixture()
  let resolveBooking
  const booking = bookingApiFixture({
    run: () => new Promise((resolve) => {
      resolveBooking = () => resolve({
        booking: { booking_id: 'stale-free', row_id: 903 },
      })
    }),
  })
  await withGlobals({ document: fixture.document }, async () => {
    api.installFreeBookingController(installSettings(booking.bookingApi))
    await fixture.cta.onclick(event())
    fixture.topic.value = 'Discard topic'
    fixture.context.value = 'Discard context'
    fixture.container.textContent = 'Calendar'
    const pending = booking.state.mounts[0].onConfirm({ start: 1, end: 2, timezone: 'UTC' })
    await new Promise((resolve) => setImmediate(resolve))
    fixture.close.listeners.click[0](event())
    assert.equal(fixture.topic.value, '')
    assert.equal(fixture.context.value, '')
    assert.equal(fixture.container.textContent, '')
    assert.equal(fixture.defaultStep.style.display, 'flex')
    assert.equal(fixture.successStep.style.display, 'none')
    resolveBooking()
    await pending
    assert.equal(fixture.defaultStep.style.display, 'flex')
    assert.equal(fixture.successStep.style.display, 'none')
  })
})

test('Free reopen blocks a changed command while one is in flight', async () => {
  const fixture = chooserFixture()
  let resolveBooking
  const booking = bookingApiFixture({
    run: () => new Promise((resolve) => {
      resolveBooking = () => resolve({
        booking: { booking_id: 'shared-free', row_id: 904 },
      })
    }),
  })
  await withGlobals({ document: fixture.document }, async () => {
    const slot = { start: 1, end: 2, timezone: 'UTC' }
    api.installFreeBookingController(installSettings(booking.bookingApi))
    await fixture.cta.onclick(event())
    fixture.topic.value = 'Original topic'
    fixture.context.value = 'Original context'
    const stale = booking.state.mounts[0].onConfirm(slot)
    await new Promise((resolve) => setImmediate(resolve))
    fixture.close.listeners.click[0](event())
    assert.equal(fixture.topic.value, '')
    assert.equal(fixture.context.value, '')
    await fixture.cta.onclick(event())
    await assert.rejects(
      booking.state.mounts[1].onConfirm(slot),
      /still being processed/i,
    )
    assert.equal(booking.state.attempts, 1)
    assert.equal(booking.state.runs, 1)
    resolveBooking()
    await stale
    assert.equal(fixture.successStep.style.display, 'none')
  })
})

test('Free install fails closed without the shared canonical booking client', async () => {
  const fixture = chooserFixture()
  await withGlobals({ document: fixture.document }, async () => {
    assert.equal(api.installFreeBookingController({
      brandEmail: 'brand@example.com',
      config: { config_id: 'free_prod', is_paid: false },
      grantId: 'grant_prod',
      starterSlug: 'starter-slug',
    }), false)
  })
})
