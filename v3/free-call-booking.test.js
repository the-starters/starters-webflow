const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const api = require('./free-call-booking.js')
const SOURCE = fs.readFileSync(require.resolve('./free-call-booking.js'), 'utf8')

/**
 * The booking surface resets on the modal embed's close-complete event, not on
 * a close control's click, so the suite needs a window-level event bus to close
 * the dialog with. The controller reads `global.addEventListener` when it
 * registers a popup, which is why this is installed before any test runs.
 */
const modalEvents = new EventTarget()
global.addEventListener = function (name, listener) { modalEvents.addEventListener(name, listener) }
global.removeEventListener = function (name, listener) { modalEvents.removeEventListener(name, listener) }

function dispatchModal(type, modal) {
  modalEvents.dispatchEvent(new CustomEvent(type, { detail: { modal } }))
}

/**
 * Everything a real close does, in order: the embed's click handling on the
 * closer, then — 300ms later, once the fade-out has finished — the
 * close-complete event. Tests that only want the second half call
 * `dispatchModal('modal-close', popup)` directly.
 */
function closeThroughFade(fixture, closer) {
  const control = closer || fixture.close
  ;(control.listeners.click || []).forEach(function (listener) { listener(event()) })
  dispatchModal('modal-close', fixture.popup)
}

/**
 * How many times the shared surface reset ran, read off the public ownership
 * seam: every `lifecycle.reset` claims one generation for the container, so the
 * gap between two claims minus this probe's own claim is the reset count.
 */
function resetCounter(container) {
  let mark = global.StartersBookingSurfaceOwnership.claim(container)
  return function since() {
    const next = global.StartersBookingSurfaceOwnership.claim(container)
    const count = next - mark - 1
    mark = next
    return count
  }
}

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

function chooserFixture({ includeMain = true, guests = [], closers = 1 } = {}) {
  const popup = new Element('section', { 'popup-booking': '' })
  // The authored dialog carries several closers — the X, one or more "Close"
  // buttons, and the backdrop — and every one of them must behave the same.
  const closeControls = [
    new Element('button', { 'data-modal-close': '' }),
    new Element('div', { 'data-modal-close': '', 'booking-popup-close': '' }),
    new Element('div', { 'data-modal-close': '', 'popup-booking-close': '' }),
  ].slice(0, Math.max(1, closers))
  const close = closeControls[0]
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
  popup.setQuery('[data-modal-close], [booking-popup-close], [popup-booking-close]', closeControls)

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
    closeControls,
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
    closeThroughFade(fixture)
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
    closeThroughFade(fixture)
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

// --------------------------------------------------------------------------
// Reset-after-fade: the booking surface must survive the close animation.
//
// The modal embed keeps the dialog on screen for a 300ms fade-out and only
// then dispatches `modal-close`. Resetting any earlier repaints a dialog the
// visitor can still see — a success screen snapping back to "Book a Call"
// before it disappears.
// --------------------------------------------------------------------------

/**
 * A transcription of the lifecycle singleton shipped before this change: it
 * resets on a close control's click and on the dialog's `cancel` as well as on
 * close-complete. Used to stand in for an older generation that already claimed
 * the first-installer-wins window slot.
 */
function oldGenerationLifecycle(scope) {
  const generations = new WeakMap()
  const ownership = {
    claim: function (container) {
      const generation = (generations.get(container) || 0) + 1
      generations.set(container, generation)
      return generation
    },
    owns: function (container, generation) {
      return generations.get(container) === generation
    },
  }
  const bindings = new WeakMap()
  const lifecycle = {
    register: function (popup, container, onReset) {
      let binding = bindings.get(popup)
      if (!binding) {
        binding = { container, resets: new Set() }
        bindings.set(popup, binding)
        popup.querySelectorAll(
          '[data-modal-close], [booking-popup-close], [popup-booking-close]',
        ).forEach(function (control) {
          control.addEventListener('click', function () { lifecycle.reset(popup) })
        })
        popup.addEventListener('cancel', function () { lifecycle.reset(popup) })
        scope.addEventListener('modal-close', function (event) {
          const modal = event && event.detail && event.detail.modal
          if (modal === popup) lifecycle.reset(popup)
        })
      }
      if (binding.container !== container) return false
      binding.resets.add(onReset)
      return true
    },
    reset: function (popup, nextType) {
      const binding = bindings.get(popup)
      if (!binding) return 0
      const generation = ownership.claim(binding.container)
      binding.resets.forEach(function (reset) { reset(generation, nextType || '') })
      return generation
    },
    runBooking: function (container, fingerprint, createAttempt) {
      return createAttempt().run()
    },
  }
  return { lifecycle, ownership }
}

/** Load a second, isolated copy of the controller against a supplied window. */
function loadIsolated(window) {
  vm.runInNewContext(SOURCE, {
    URLSearchParams,
    console,
    globalThis: window,
    window,
  })
  return window.StartersFreeCallBooking
}

function windowFor(document) {
  const events = new EventTarget()
  return {
    document,
    location: { hostname: 'www.thestarters.com' },
    addEventListener: (name, listener) => events.addEventListener(name, listener),
    removeEventListener: (name, listener) => events.removeEventListener(name, listener),
    dispatch: (type, modal) => events.dispatchEvent(new CustomEvent(type, { detail: { modal } })),
  }
}

async function advancedFixture(options) {
  const fixture = chooserFixture(options)
  const booking = bookingApiFixture()
  await withGlobals({ document: fixture.document }, async () => {
    assert.equal(api.installFreeBookingController(installSettings(booking.bookingApi)), true)
    await fixture.cta.onclick(event())
    fixture.topic.value = 'Growth audit'
    fixture.container.textContent = 'Calendar'
    await booking.state.mounts[0].onConfirm({ start: 1, end: 2, timezone: 'UTC' })
  })
  assert.equal(fixture.successStep.style.display, 'flex')
  return { booking, fixture }
}

test('the close click leaves the visitor’s step untouched until the fade ends', async () => {
  const { fixture } = await advancedFixture()

  // Trap. On the click-bound generation these listeners existed and wiped the
  // surface right here, while the dialog was still fully opaque.
  fixture.closeControls.forEach(function (control) {
    ;(control.listeners.click || []).forEach(function (listener) { listener(event()) })
  })
  ;(fixture.popup.listeners.cancel || []).forEach(function (listener) { listener(event()) })

  assert.deepEqual(
    fixture.closeControls.map((control) => (control.listeners.click || []).length),
    fixture.closeControls.map(() => 0),
    'no closer may carry a reset listener — that is the mid-fade repaint',
  )
  assert.equal(fixture.successStep.style.display, 'flex')
  assert.equal(fixture.defaultStep.style.display, 'none')
  assert.equal(fixture.container.textContent, 'Calendar')
  assert.equal(fixture.topic.value, 'Growth audit')

  dispatchModal('modal-close', fixture.popup)

  assert.equal(fixture.successStep.style.display, 'none')
  assert.equal(fixture.defaultStep.style.display, 'flex')
  assert.equal(fixture.container.textContent, '')
  assert.equal(fixture.topic.value, '')
})

test('every closer resets the booking surface exactly once', async () => {
  const { fixture } = await advancedFixture({ closers: 3 })
  const counted = resetCounter(fixture.container)

  fixture.closeControls.forEach(function (control, index) {
    dispatchModal('modal-open', fixture.popup)
    closeThroughFade(fixture, control)
    assert.equal(counted(), 1, `closer ${index} must reset exactly once`)
  })

  // Esc reaches the surface the same way: the embed intercepts `cancel`, plays
  // the fade, and dispatches close-complete at the end of it.
  dispatchModal('modal-open', fixture.popup)
  ;(fixture.popup.listeners.cancel || []).forEach(function (listener) { listener(event()) })
  assert.equal(counted(), 0, 'cancel alone must not reset — the dialog is still on screen')
  dispatchModal('modal-close', fixture.popup)
  assert.equal(counted(), 1)
})

test('a repeated close-complete event does not reset the surface twice', async () => {
  const { fixture } = await advancedFixture()
  const counted = resetCounter(fixture.container)

  dispatchModal('modal-close', fixture.popup)
  dispatchModal('modal-close', fixture.popup)
  assert.equal(counted(), 1)

  dispatchModal('modal-open', fixture.popup)
  dispatchModal('modal-close', fixture.popup)
  assert.equal(counted(), 1, 'reopening re-arms the surface for the next close')
})

test('closing a different dialog leaves the booking surface alone', async () => {
  const { fixture } = await advancedFixture()
  const counted = resetCounter(fixture.container)

  dispatchModal('modal-close', new Element('dialog', { 'popup-stripe-card': '' }))
  dispatchModal('modal-close', new Element('dialog', { 'data-modal-target': 'account-settings' }))

  assert.equal(counted(), 0)
  assert.equal(fixture.successStep.style.display, 'flex')
  assert.equal(fixture.container.textContent, 'Calendar')
})

test('reopening after a close starts from a fresh default step', async () => {
  const { booking, fixture } = await advancedFixture()
  closeThroughFade(fixture)
  assert.equal(fixture.defaultStep.style.display, 'flex')
  assert.equal(fixture.container.textContent, '')

  await withGlobals({ document: fixture.document }, async () => {
    dispatchModal('modal-open', fixture.popup)
    assert.equal(fixture.defaultStep.style.display, 'flex')
    assert.equal(fixture.successStep.style.display, 'none')
    assert.equal(fixture.topic.value, '')

    // A second run through the flow lands on success again, and the second
    // close clears it again — the surface is not left latched after one close.
    await fixture.cta.onclick(event())
    await booking.state.mounts[1].onConfirm({ start: 3, end: 4, timezone: 'UTC' })
    assert.equal(fixture.successStep.style.display, 'flex')
    closeThroughFade(fixture)
    assert.equal(fixture.defaultStep.style.display, 'flex')
    assert.equal(fixture.successStep.style.display, 'none')
  })
})

test('this generation marks the singleton it installs as close-complete', async () => {
  const { fixture } = await advancedFixture()
  const lifecycle = global.StartersBookingSurfaceLifecycle
  assert.equal(lifecycle.resetTiming, 'close-complete')

  // An older controller adopting this singleton gets the fixed timing for free:
  // all of its close wiring lives inside register(), which no longer binds
  // clicks, so its reset also waits for the fade.
  let adopted = 0
  assert.equal(lifecycle.register(fixture.popup, fixture.container, function () { adopted += 1 }), true)
  fixture.closeControls.forEach(function (control) {
    ;(control.listeners.click || []).forEach(function (listener) { listener(event()) })
  })
  assert.equal(adopted, 0)
  dispatchModal('modal-close', fixture.popup)
  assert.equal(adopted, 1)
})

test('an older singleton already installed is adopted with no extra close wiring', async () => {
  const adoptedFixture = chooserFixture({ closers: 3 })
  const controlFixture = chooserFixture({ closers: 3 })
  const window = windowFor(adoptedFixture.document)
  const old = oldGenerationLifecycle(window)
  window.StartersBookingSurfaceLifecycle = old.lifecycle
  window.StartersBookingSurfaceOwnership = old.ownership

  const isolated = loadIsolated(window)
  const booking = bookingApiFixture()
  assert.equal(isolated.installFreeBookingController(installSettings(booking.bookingApi)), true)

  // The singleton is adopted, not replaced, and it still carries no capability
  // mark. Nothing gates on that absence: adoption is unconditional by design.
  // Asserting it here documents which generation this fixture is standing in.
  assert.equal(window.StartersBookingSurfaceLifecycle, old.lifecycle)
  assert.equal(old.lifecycle.resetTiming, undefined)

  // Differential: the same old singleton driving a popup with no controller on
  // it resets exactly as often as the one this controller registered against.
  // Equal counts mean the new code contributed no close wiring of its own.
  let adopted = 0
  let control = 0
  old.lifecycle.register(adoptedFixture.popup, adoptedFixture.container, function () { adopted += 1 })
  old.lifecycle.register(controlFixture.popup, controlFixture.container, function () { control += 1 })

  function driveClose(fixture) {
    fixture.closeControls.forEach(function (item) {
      ;(item.listeners.click || []).forEach(function (listener) { listener(event()) })
    })
    ;(fixture.popup.listeners.cancel || []).forEach(function (listener) { listener(event()) })
    window.dispatch('modal-close', fixture.popup)
  }
  driveClose(adoptedFixture)
  driveClose(controlFixture)

  assert.ok(control >= 1, 'the old generation must still reset — no missed reset')
  assert.equal(adopted, control, 'adopting the old singleton must not add a second reset')
  assert.equal(adoptedFixture.defaultStep.style.display, 'flex')
})
