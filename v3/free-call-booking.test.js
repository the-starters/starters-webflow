const assert = require('node:assert/strict')
const test = require('node:test')

const api = require('./free-call-booking.js')

class Element {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag
    this.attributes = { ...attrs }
    this.style = {}
    this.textContent = ''
    this.children = []
    this.parentElement = null
    this.queries = new Map()
    this.shadowRoot = null
    this.onclick = null
    this.id = ''
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

  hasAttribute(name) {
    return this.getAttribute(name) !== null
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  replaceChildren(...children) {
    this.children = []
    children.forEach((child) => this.appendChild(child))
  }

  closest(selector) {
    let node = this
    while (node) {
      if (selector === '[call-type-item]' && node.getAttribute('call-type-item') !== null) return node
      if (selector === '[popup-booking]' && node.getAttribute('popup-booking') !== null) return node
      if (selector === '[booking-element-wrap]' && node.getAttribute('booking-element-wrap') !== null) return node
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

function chooserFixture() {
  const popup = new Element('section', { 'popup-booking': '' })
  const freeButtons = new Element('div', { 'success-call-buttons': '', 'data-type': 'free' })
  const paidButtons = new Element('div', { 'success-call-buttons': '', 'data-type': 'paid' })
  popup.setQuery('[success-call-buttons]', [freeButtons, paidButtons])

  const item = new Element('div', { 'call-type-item': '' })
  const nextSlot = new Element('span', { 'next-available-slot': '' })
  const cta = new Element('button', { 'booking-popup-open': '', 'data-type': 'free' })
  item.appendChild(cta)
  item.appendChild(nextSlot)
  item.setQuery('[next-available-slot]', nextSlot)

  const main = new Element('button', { 'data-modal-trigger': 'popup-booking-main' })
  const container = new Element('div', { 'nylas-container': '' })
  popup.appendChild(container)

  const document = {
    querySelector(selector) {
      if (selector === '[popup-booking]') return popup
      if (selector === '[nylas-container]') return container
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('[data-type="free"]')) return [cta]
      if (selector === '[data-modal-trigger="popup-booking-main"]') return [main]
      return []
    },
    createElement(tag) {
      const element = new Element(tag)
      if (tag === 'nylas-scheduling') element.shadowRoot = shadowRoot()
      return element
    },
  }
  return { cta, container, document, freeButtons, item, main, nextSlot, paidButtons, popup }
}

function shadowRoot() {
  const root = new Element('shadow-root')
  root.getElementById = function (id) {
    return this.children.find((child) => child.id === id) || null
  }
  return root
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
    assert.equal(
      await api.getNearestSlot('grant_1', 'free_1', now),
      Math.floor(now / 1000) + 100000,
    )
  })

  assert.equal(calls.length, 3)
  assert.equal(new URL(calls[0].url).pathname.endsWith(api.STARTER_PATH), true)
  assert.deepEqual(JSON.parse(calls[0].options.body), { member_id: 'mem_starter' })
  assert.equal(new URL(calls[1].url).pathname.endsWith(api.CONFIGS_PATH), true)
  assert.deepEqual(JSON.parse(calls[1].options.body), { grant_id: 'grant_1' })
  assert.equal(new URL(calls[2].url).pathname.endsWith(api.AVAILABILITY_PATH), true)
  assert.equal(calls[2].options.method, 'GET')
})

test('reinstall keeps one chooser handler and one availability request per click', async () => {
  const fixture = chooserFixture()
  let requests = 0
  await withGlobals({
    document: fixture.document,
    location: { hostname: 'www.thestarters.com' },
    xanoAuthFetch: async () => {
      requests += 1
      return response({ time_slots: [{ start_time: Math.floor(Date.now() / 1000) + 90000 }] })
    },
  }, async () => {
    const settings = {
      config: { config_id: 'free_prod', is_paid: false },
      grantId: 'grant_prod',
      brandName: 'Brand Member',
      brandEmail: 'brand@example.com',
    }
    assert.equal(api.installFreeBookingController(settings), true)
    const firstHandler = fixture.main.onclick
    assert.equal(api.installFreeBookingController(settings), true)
    assert.notEqual(fixture.main.onclick, null)

    const first = event()
    await fixture.main.onclick(first)
    assert.equal(first.prevented, 1)
    assert.equal(requests, 1)
    assert.notEqual(fixture.nextSlot.textContent, 'Loading...')

    const second = event()
    await fixture.main.onclick(second)
    assert.equal(second.prevented, 1)
    assert.equal(requests, 2)
    assert.equal(typeof firstHandler, 'function')
  })
})

test('each Free option click mounts one Nylas scheduler in the authored container', async () => {
  const fixture = chooserFixture()
  let definitions = 0
  let schedulerCreates = 0
  const originalCreate = fixture.document.createElement
  fixture.document.createElement = function (tag) {
    if (tag === 'nylas-scheduling') schedulerCreates += 1
    return originalCreate.call(this, tag)
  }

  await withGlobals({
    document: fixture.document,
    location: { hostname: 'the-starters-3-0.webflow.io' },
    customElements: { get: () => definitions > 0 },
    setTimeout: (fn) => { fn(); return 1 },
  }, async () => {
    const settings = {
      config: { config_id: 'free_test', is_paid: false },
      grantId: 'grant_test',
      brandName: 'Brand Test',
      brandEmail: 'brand-test@example.com',
      loadSchedulerModule: async () => ({ defineCustomElement: () => { definitions += 1 } }),
    }
    assert.equal(api.installFreeBookingController(settings), true)

    const first = event()
    await fixture.cta.onclick(first)
    assert.equal(first.prevented, 1)
    assert.equal(schedulerCreates, 1)
    assert.equal(fixture.container.children.length, 1)
    const scheduler = fixture.container.children[0]
    assert.equal(scheduler.configurationId, 'free_test')
    assert.equal(scheduler.schedulerApiUrl, 'https://api.us.nylas.com')
    assert.deepEqual(scheduler.bookingInfo.primaryParticipant, {
      name: 'Brand Test',
      email: 'brand-test@example.com',
    })
    assert.equal(scheduler.bookingInfo.additionalFields.from_stage.value, 'true')
    assert.equal(fixture.freeButtons.style.display, 'flex')
    assert.equal(fixture.paidButtons.style.display, 'none')

    const second = event()
    await fixture.cta.onclick(second)
    assert.equal(second.prevented, 1)
    assert.equal(schedulerCreates, 2)
    assert.equal(fixture.container.children.length, 1, 'the second click replaces, not duplicates, the calendar')
    assert.equal(definitions, 1)
  })
})

test('provider callbacks keep identity fields hidden and switch the native success step', async () => {
  const fixture = chooserFixture()
  const defaultStep = new Element('div', { 'schedule-step': 'default' })
  const successStep = new Element('div', { 'schedule-step': 'success' })
  const successText = new Element('p', { 'booking-success-text': '' })
  const callType = new Element('span', { 'booking-element': 'paid-meeting' })
  fixture.popup.setQuery('[schedule-step]', [defaultStep, successStep])
  fixture.popup.setQuery('[booking-success-text]', successText)
  fixture.popup.setQuery('[booking-element]', callType)

  await withGlobals({
    document: fixture.document,
    location: { hostname: 'www.thestarters.com' },
    customElements: { get: () => true },
    setTimeout: (fn) => { fn(); return 1 },
  }, async () => {
    const scheduler = await api.createScheduler({
      configId: 'free_prod',
      brandName: 'Brand Member',
      brandEmail: 'brand@example.com',
    })

    const form = new Element('nylas-booking-form')
    form.shadowRoot = shadowRoot()
    const submit = new Element('button')
    const identity = new Element('input-component')
    identity.id = 'brand_memberstack_id'
    identity.shadowRoot = shadowRoot()
    identity.parentElement = new Element('label')
    const starterIdentity = new Element('input-component')
    starterIdentity.id = 'starter_memberstack_id'
    starterIdentity.shadowRoot = shadowRoot()
    starterIdentity.parentElement = new Element('label')
    const context = new Element('input-component')
    context.id = 'call_context'
    context.shadowRoot = shadowRoot()
    context.parentElement = new Element('label')
    form.shadowRoot.setQuery('button[type="submit"]', submit)
    form.shadowRoot.setQuery('input-component', [identity, starterIdentity, context])
    scheduler.shadowRoot.setQuery('nylas-booking-form', form)

    scheduler.eventOverrides.timeslotConfirmed()
    assert.equal(submit.textContent, 'Request Call')
    assert.equal(identity.parentElement.style.display, 'none')
    assert.equal(starterIdentity.parentElement.style.display, 'none')
    assert.equal(context.parentElement.style.display, undefined)

    scheduler.eventOverrides.bookedEventInfo({
      detail: {
        data: {
          additional_fields: {
            call_full_title: 'Free Call',
            call_context: 'Project fit',
            starter_name: 'Starter Member',
          },
        },
      },
    }, {
      schedulerStore: {
        get: () => ({ start_time: new Date('2026-08-21T05:00:00Z') }),
      },
    })

    assert.equal(defaultStep.style.display, 'none')
    assert.equal(successStep.style.display, 'flex')
    assert.equal(callType.textContent, 'Free Call')
    assert.match(successText.textContent, /Starter Member/)
  })
})
