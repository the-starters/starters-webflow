const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./paid-call-settings.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

class El {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase()
    this.attributes = {}
    this.style = {}
    this.value = ''
    this.checked = false
    this.disabled = false
    this.validationMessage = ''
    this.reportValidityCalls = 0
    this.textContent = ''
    this.listeners = new Map()
    this.children = []
    this.parentElement = null
    Object.entries(attrs).forEach(([name, value]) => this.setAttribute(name, value))
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  matches(selector) {
    return selector.split(',').some((part) => {
      const candidate = part.trim()
      if (candidate.startsWith('.')) {
        return String(this.getAttribute('class') || '').split(/\s+/).includes(candidate.slice(1))
      }
      const attr = candidate.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/)
      if (attr) {
        return this.getAttribute(attr[1]) !== null && (!attr[2] || this.getAttribute(attr[1]) === attr[2])
      }
      return candidate.toUpperCase() === this.tagName
    })
  }
  append(...children) {
    children.forEach((child) => {
      child.parentElement = this
      this.children.push(child)
    })
  }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }
  setCustomValidity(message) { this.validationMessage = String(message || '') }
  descendants() {
    return this.children.reduce((found, child) => found.concat(child, child.descendants()), [])
  }
  // A real <form> aggregates the validity of its submittable descendants; an
  // input reports only its own.
  reportValidity() {
    this.reportValidityCalls += 1
    if (this.tagName === 'FORM') {
      return this.descendants().every((node) => node.validationMessage === '')
    }
    return this.validationMessage === ''
  }
  async dispatch(name) {
    const event = { type: name, preventDefault() {} }
    await Promise.all((this.listeners.get(name) || []).map((listener) => listener(event)))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  querySelectorAll(selector) {
    const matches = []
    this.children.forEach((child) => {
      if (child.matches(selector)) matches.push(child)
      matches.push(...child.querySelectorAll(selector))
    })
    return matches
  }
}

function canonical(overrides = {}) {
  return {
    stripe_environment: 'live',
    readiness: {
      calendar_connected: true,
      availability_configured: true,
      stripe_connect_linked: true,
      stripe_charges_enabled: true,
      stripe_readiness_fresh: true,
      paid_call_enabled: false,
      bookable: false,
      ...(overrides.readiness || {}),
    },
    services: overrides.services || [],
  }
}

function service(overrides = {}) {
  return {
    config_id: 'cfg-paid-1',
    title: 'Paid Consultation Call',
    price_cents: 35000,
    currency: 'usd',
    duration: 60,
    active: true,
    revision: 4,
    payment_environment: 'live',
    ...overrides,
  }
}

function buildDom(withRoot = true, cardMode = false, shared = false, priceTile = {}, authoredPills = false, pillLabels = {}) {
  if (withRoot && cardMode) {
    const card = new El('section', { 'data-id': '' })
    const open = new El('div', { 'data-availability-action': 'item-form-open' })
    const formWrapper = new El('div', { 'data-availability-element': 'call-form-wrapper' })
    const editInner = new El('div')
    const root = new El('div', { 'data-availability-element': 'call-paid-form' })
    const form = new El('form', { 'data-availability-element': 'availability-form' })
    const disabled = new El('input', { name: 'consulting-calls', value: 'no' })
    const enabled = new El('input', { name: 'paid-consulting-calls', value: 'yes' })
    const disabledLabel = new El('label')
    const enabledLabel = new El('label')
    const disabledVisual = new El('div', { class: 'radio-filter_check w-radio-input w--redirected-checked' })
    const enabledVisual = new El('div', { class: 'radio-filter_check w-radio-input' })
    const title = new El('input', { name: 'call-description' })
    const price = new El('input', { name: 'call-rate' })
    const buttonRow = new El('div')
    const close = new El('div', { 'data-availability-action': 'item-form-close' })
    const save = new El('div', { 'data-availability-action': 'item-form-submit' })
    const saveIcon = new El('div', { 'data-opp-element': 'loading-hide' })
    const saveSpinner = new El('svg', { 'data-button-spinner': '', 'aria-hidden': 'true' })
    saveSpinner.style.display = 'none'
    save.append(saveIcon, saveSpinner)
    const statusOutput = new El('p', { 'data-call-settings-output': 'status' })
    const nativeError = new El('div', { class: 'w-form-fail', 'aria-hidden': 'true' })
    const nativeErrorMessage = new El('div')
    nativeErrorMessage.textContent = 'Oops! Something went wrong while submitting the form.'
    nativeError.append(nativeErrorMessage)
    nativeError.style.display = 'none'
    const priceOutput = priceTile.canonical === false
      ? null
      : new El('p', { 'data-call-settings-output': 'price' })
    const authored = priceTile.authored === true || priceTile.foreign === true
    const authoredPriceCard = authored
      ? new El('div', { 'data-service-card-element': 'price-card' })
      : null
    const authoredPriceCaption = authored && priceTile.caption === true ? new El('p') : null
    const authoredPriceText = authored ? new El('p') : null
    const authoredPriceSymbol = authored && priceTile.split === true ? new El('span') : null
    const authoredPriceNumber = authored && priceTile.split === true ? new El('span') : null
    const authoredPriceCents = authored && priceTile.cents === true ? new El('span') : null
    if (authoredPriceCard) {
      if (authoredPriceCaption) {
        authoredPriceCaption.textContent = 'Rate'
        authoredPriceCard.append(authoredPriceCaption)
      }
      if (authoredPriceSymbol && authoredPriceNumber) {
        authoredPriceSymbol.textContent = '$'
        authoredPriceNumber.textContent = priceTile.authoredNumber ?? '150'
        authoredPriceText.append(authoredPriceSymbol, authoredPriceNumber)
        if (authoredPriceCents) {
          authoredPriceCents.textContent = '.00'
          authoredPriceText.append(authoredPriceCents)
        }
      } else {
        authoredPriceText.textContent = priceTile.authoredText ?? '$150'
      }
      authoredPriceCard.append(authoredPriceText)
      if (authoredPriceCents && !authoredPriceNumber) {
        authoredPriceCents.textContent = '.00'
        authoredPriceCard.append(authoredPriceCents)
      }
    }
    const pillAttrs = authoredPills ? { 'data-availability-element': 'call-pill-on' } : null
    const onOutput = new El('div', pillAttrs || { 'data-call-settings-output': 'on' })
    const offOutput = new El('div', pillAttrs || { 'data-call-settings-output': 'off' })
    onOutput.textContent = pillLabels.on || 'ON'
    offOutput.textContent = pillLabels.off || 'OFF'
    const prerequisites = ['calendar', 'availability', 'stripe', 'charges', 'fresh', 'bookable']
      .map((name) => new El('div', { 'data-paid-call-prerequisite': name }))
    buttonRow.append(close, save)
    disabledLabel.append(disabledVisual, disabled)
    enabledLabel.append(enabledVisual, enabled)
    form.append(disabledLabel, enabledLabel, title, price, buttonRow)
    root.append(form, nativeError)
    editInner.append(root)
    formWrapper.append(editInner)
    const freeWrapper = new El('div', { 'data-availability-element': 'call-form-wrapper' })
    const freeOpen = new El('div', { 'data-availability-action': 'item-form-open' })
    const freeForm = new El('form', { 'data-availability-element': 'availability-form' })
    const freeClose = new El('div', { 'data-availability-action': 'item-form-close' })
    const freeSave = new El('div', { 'data-availability-action': 'item-form-submit' })
    const freeEnabled = new El('input', { name: 'free-consulting-calls', value: 'yes' })
    freeForm.append(freeEnabled, freeClose, freeSave)
    freeWrapper.append(freeForm)
    if (priceTile.foreign === true) freeWrapper.append(authoredPriceCard)
    const header = shared ? [freeOpen, freeWrapper] : [open]
    card.append(
      ...header,
      statusOutput,
      ...(priceOutput ? [priceOutput] : []),
      ...(authoredPriceCard && priceTile.foreign !== true ? [authoredPriceCard] : []),
      onOutput,
      offOutput,
      ...prerequisites,
      formWrapper,
    )
    return {
      card,
      root,
      form,
      disabled,
      enabled,
      disabledVisual,
      enabledVisual,
      title,
      price,
      duration: null,
      open: shared ? null : open,
      close,
      save,
      status: null,
      statusOutput,
      nativeError,
      nativeErrorMessage,
      priceOutput,
      authoredPriceCard,
      authoredPriceCaption,
      authoredPriceText,
      authoredPriceSymbol,
      authoredPriceNumber,
      authoredPriceCents,
      onOutput,
      offOutput,
      formWrapper,
      freeOpen,
      freeWrapper,
      freeClose,
      freeSave,
      prerequisites,
    }
  }
  const root = withRoot ? new El('section', { 'data-paid-call-element': 'settings' }) : null
  if (!root) return { root: null }
  const form = new El('form', { 'data-paid-call-element': 'form' })
  const enabled = new El('input', { 'data-paid-call-input': 'enabled' })
  const title = new El('input', { 'data-paid-call-input': 'title' })
  const price = new El('input', { 'data-paid-call-input': 'price' })
  const duration = new El('select', { 'data-paid-call-input': 'duration' })
  const save = new El('button', { 'data-paid-call-action': 'save' })
  const disable = new El('button', { 'data-paid-call-action': 'disable' })
  const status = new El('p', { 'data-paid-call-element': 'status' })
  const prerequisites = ['calendar', 'availability', 'stripe', 'charges', 'fresh', 'bookable']
    .map((name) => new El('div', { 'data-paid-call-prerequisite': name }))
  root.append(form, enabled, title, price, duration, save, disable, status, ...prerequisites)
  return { root, form, enabled, title, price, duration, save, disable, status, prerequisites }
}

function load(options = {}) {
  if (options.sharedCallItem === true) options = { ...options, cardMode: true }
  const dom = buildDom(
    options.withRoot !== false,
    options.cardMode === true || options.stableCardMode === true,
    options.sharedCallItem === true,
    options.priceTile || {},
    options.authoredPills === true,
    options.pillLabels || {},
  )
  const delayedSiblings = options.rootFirst === true && dom.card
    ? dom.card.children.filter((item) => item !== dom.formWrapper)
    : []
  if (delayedSiblings.length) dom.card.children = [dom.formWrapper]
  if (options.cardRadioValues && dom.root) {
    Object.keys(options.cardRadioValues).forEach((key) => {
      if (dom[key]) dom[key].setAttribute('value', options.cardRadioValues[key])
    })
  }
  if (options.cardRadioNames && dom.root) {
    Object.keys(options.cardRadioNames).forEach((key) => {
      if (dom[key]) dom[key].setAttribute('name', options.cardRadioNames[key])
    })
  }
  if (options.stableCardMode === true && dom.root) {
    dom.root.setAttribute('data-call-settings-service', 'paid')
    dom.form.setAttribute('data-call-settings-element', 'form')
    dom.formWrapper.setAttribute('data-call-settings-element', 'panel')
    dom.enabled.setAttribute('data-call-settings-input', 'enabled')
    dom.disabled.setAttribute('data-call-settings-input', 'disabled')
    dom.title.setAttribute('data-call-settings-input', 'title')
    dom.price.setAttribute('data-call-settings-input', 'price')
    dom.open.setAttribute('data-call-settings-action', 'open')
    dom.close.setAttribute('data-call-settings-action', 'close')
    dom.save.setAttribute('data-call-settings-action', 'submit')
  }
  const html = new El('html')
  const calls = []
  const events = []
  const windowListeners = new Map()
  const timers = []
  const observers = []
  const warnings = []
  let rootAvailable = options.withRoot !== false && options.rootDelayed !== true
  let state = options.initial || canonical()
  let activeMember = { id: options.memberId || 'member-a' }
  let currentMemberReader = () => activeMember
  let authChange = null
  const routes = options.routes || {}

  const document = {
    readyState: 'complete',
    documentElement: html,
    querySelector(selector) {
      if (selector === '[data-call-settings-service="paid"]') {
        return rootAvailable && options.stableCardMode === true ? dom.root : null
      }
      if (selector === '[data-paid-call-element="settings"]') {
        return rootAvailable && options.cardMode !== true && options.stableCardMode !== true
          ? dom.root
          : null
      }
      if (selector === '[data-availability-element="call-paid-form"]') {
        return rootAvailable && (options.cardMode === true || options.stableCardMode === true)
          ? dom.root
          : null
      }
      return null
    },
    querySelectorAll() { return [] },
    addEventListener() {},
  }

  const memberstack = {
    getCurrentMember: async () => ({ data: await currentMemberReader() }),
    onAuthChange(listener) { authChange = listener },
  }
  const window = {
    location: { hostname: options.hostname || 'thestarters.com' },
    crypto: { randomUUID: () => 'uuid-fixed' },
    memberReady: options.memberReady,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false }
      timers.push(timer)
      return timer
    },
    clearTimeout(timer) { timer.cancelled = true },
    addEventListener(name, listener) {
      const listeners = windowListeners.get(name) || []
      listeners.push(listener)
      windowListeners.set(name, listeners)
    },
    dispatchEvent(event) { events.push(event) },
    xanoAuthFetch: async (url, init) => {
      const path = url.replace(API_BASE, '')
      const method = init.method
      const body = init.body ? JSON.parse(init.body) : undefined
      calls.push({ path, method, body })
      if (routes[path]) {
        return routes[path]({
          method,
          body,
          member: activeMember,
          state,
          setState: (next) => { state = next },
        })
      }
      if (path === '/starter/paid-call-settings/get/v3') {
        return { ok: true, status: 200, json: async () => state }
      }
      throw new Error('unrouted request ' + path)
    },
  }
  if (!options.withoutMemberstackAtLoad) window.$memberstackDom = memberstack

  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail }
  }

  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.active = false
      observers.push(this)
    }
    observe() { this.active = true }
    disconnect() { this.active = false }
  }

  vm.runInNewContext(SOURCE, {
    CustomEvent,
    Date,
    Math,
    MutationObserver,
    console: { warn: (...args) => warnings.push(args.join(' ')) },
    document,
    window,
  })

  return {
    dom,
    calls,
    events,
    timers,
    warnings,
    window,
    document,
    changeMember: async (nextMember) => {
      activeMember = nextMember
      if (authChange) return authChange(nextMember)
      return null
    },
    setCurrentMemberReader: (reader) => { currentMemberReader = reader },
    notifyAuthChange: async (nextMember) => (authChange ? authChange(nextMember) : null),
    expireMemberSilently: () => { activeMember = null },
    installMemberstack: () => { window.$memberstackDom = memberstack },
    flushTimers: () => {
      const pending = timers.splice(0)
      pending.forEach((timer) => { if (!timer.cancelled) timer.callback() })
    },
    revealRoot: () => {
      rootAvailable = true
      observers.filter((observer) => observer.active).forEach((observer) => observer.callback())
    },
    revealSiblings: () => {
      dom.card.append(...delayedSiblings)
      observers.filter((observer) => observer.active).forEach((observer) => observer.callback())
    },
    notifyMutation: () => {
      observers.filter((observer) => observer.active).forEach((observer) => observer.callback())
    },
    getState: () => state,
    dispatchWindow: async (name, detail) => {
      const event = { type: name, detail }
      await Promise.all((windowListeners.get(name) || []).map((listener) => listener(event)))
    },
  }
}

async function settle(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) await new Promise(setImmediate)
}

test('is inert when the native Webflow settings form is absent', async () => {
  const result = load({ withRoot: false })
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'waiting-for-ui')
  result.flushTimers()
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'not-applicable')
  assert.equal(result.calls.length, 0)
})

test('boots when the native Paid card is inserted after the controller starts', async () => {
  const active = service({ duration: 15, price_cents: 500, revision: 1 })
  const result = load({
    cardMode: true,
    rootDelayed: true,
    initial: canonical({
      services: [active],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'waiting-for-ui')
  assert.equal(result.calls.length, 0)

  result.revealRoot()
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'ready')
  assert.equal(result.calls.length, 1)
  assert.equal(result.dom.price.value, 5)
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-current'), '15')
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-required'), '60')

  result.notifyMutation()
  await settle()
  assert.equal(result.calls.length, 1)
})

test('collapses concurrent initialize calls into one canonical read', async () => {
  const active = service({ duration: 15, price_cents: 500, revision: 1 })
  const result = load({
    cardMode: true,
    rootDelayed: true,
    initial: canonical({
      services: [active],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  result.revealRoot()
  await settle()
  assert.equal(result.calls.length, 1)

  const manualInitializeA = result.window.StarterPaidCallSettings.initialize()
  const manualInitializeB = result.window.StarterPaidCallSettings.initialize()
  await Promise.all([manualInitializeA, manualInitializeB])
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'ready')
  assert.equal(result.calls.length, 2)
})

test('keeps waiting for the native Paid card after the root deadline expires', async () => {
  const active = service({ duration: 15, price_cents: 500, revision: 1 })
  const result = load({
    cardMode: true,
    rootDelayed: true,
    initial: canonical({
      services: [active],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'waiting-for-ui')

  result.flushTimers()
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'not-applicable')
  assert.equal(result.calls.length, 0)

  result.revealRoot()
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'ready')
  assert.equal(result.calls.length, 1)
  assert.equal(result.dom.price.value, 5)
})

test('renders the active service and prerequisite state from canonical GET', async () => {
  const active = service()
  const result = load({ initial: canonical({
    services: [active],
    readiness: { paid_call_enabled: true, bookable: true },
  }) })
  await settle()

  assert.deepEqual(result.calls.map(({ path, method }) => ({ path, method })), [
    { path: '/starter/paid-call-settings/get/v3', method: 'GET' },
  ])
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.dom.title.value, active.title)
  assert.equal(result.dom.price.value, 350)
  assert.equal(result.dom.duration.value, '60')
  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'true')
  assert.ok(result.dom.prerequisites.every((item) => item.getAttribute('data-ready') === 'true'))
})

test('the native Paid card binds without generated IDs and upgrades a legacy duration to fixed 60', async () => {
  const legacy = service({ duration: 15, price_cents: 500, revision: 1 })
  const result = load({
    cardMode: true,
    initial: canonical({
      services: [legacy],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        const saved = service({
          duration: body.duration_minutes,
          price_cents: body.price_cents,
          title: body.title,
          revision: 2,
        })
        setState(canonical({
          services: [saved],
          readiness: { paid_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'ready')
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-current'), '15')
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-required'), '60')
  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'false')
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.dom.disabled.checked, false)
  assert.equal(result.dom.disabled.getAttribute('name'), 'paid-consulting-calls')
  assert.equal(result.dom.title.value, 'Paid Consultation Call')
  assert.equal(result.dom.price.value, 5)
  assert.equal(result.dom.formWrapper.style.display, 'none')

  await result.dom.open.dispatch('click')
  assert.equal(result.dom.formWrapper.style.display, 'flex')
  await result.dom.save.dispatch('click')
  await settle()

  const upsert = result.calls.find((call) => call.path === '/starter/paid-call-settings/upsert/v3')
  assert.deepEqual(upsert.body, {
    config_id: 'cfg-paid-1',
    title: 'Paid Consultation Call',
    price_cents: 500,
    duration_minutes: 60,
    expected_revision: 1,
    idempotency_key: 'paid-call-upsert:uuid-fixed',
  })
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-current'), '60')
  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'true')
  assert.equal(result.dom.formWrapper.style.display, 'none')
})

test('the published consulting-calls-paid group binds without runtime renaming', async () => {
  const result = load({
    cardMode: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical({
      services: [service({ duration: 15, price_cents: 500, revision: 1 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.disabled.getAttribute('name'), 'consulting-calls-paid')
  assert.equal(result.dom.enabled.getAttribute('name'), 'consulting-calls-paid')
  assert.equal(result.dom.disabled.checked, false)
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.dom.enabled.getAttribute('data-call-settings-input'), 'enabled')
  assert.equal(result.dom.disabled.getAttribute('data-call-settings-input'), 'disabled')
  assert.equal(result.dom.disabledVisual.getAttribute('class').includes('w--redirected-checked'), false)
  assert.equal(result.dom.enabledVisual.getAttribute('class').includes('w--redirected-checked'), true)
})

test('production-shaped pills show only canonical Paid status', async () => {
  const active = load({
    cardMode: true,
    authoredPills: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  assert.equal(active.dom.onOutput.hidden, false)
  assert.equal(active.dom.offOutput.hidden, true)
  assert.equal(active.dom.onOutput.getAttribute('data-call-settings-output'), 'on')
  assert.equal(active.dom.offOutput.getAttribute('data-call-settings-output'), 'off')

  const inactive = load({
    cardMode: true,
    authoredPills: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical(),
  })
  await settle()
  assert.equal(inactive.dom.onOutput.hidden, true)
  assert.equal(inactive.dom.offOutput.hidden, false)
})

test('a sub-dollar published Paid rate uses native validation instead of failing silently', async () => {
  const result = load({
    cardMode: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical(),
  })
  await settle()
  result.dom.enabled.checked = true
  await result.dom.enabled.dispatch('change')
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '0.5'
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.dom.price.validationMessage, 'Use a whole-dollar rate from $1 to $999,999.')
  assert.equal(result.dom.price.reportValidityCalls, 1)
  assert.equal(result.dom.price.getAttribute('aria-invalid'), 'true')
  assert.equal(result.dom.statusOutput.textContent, 'Use a whole-dollar rate from $1 to $999,999.')

  result.dom.price.value = '1'
  await result.dom.price.dispatch('input')
  assert.equal(result.dom.price.validationMessage, '')
  assert.equal(result.dom.price.getAttribute('aria-invalid'), 'false')
})

test('a rejected rate never blocks turning published Paid calls off', async () => {
  const result = load({
    cardMode: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  result.dom.price.value = '0.5'
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.dom.price.validationMessage, 'Use a whole-dollar rate from $1 to $999,999.')
  assert.equal(result.dom.form.reportValidity(), false)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)

  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 1)
  assert.equal(result.dom.price.validationMessage, '')
  assert.equal(result.dom.price.getAttribute('aria-invalid'), 'false')
  assert.equal(result.dom.form.reportValidity(), true)
  assert.equal(result.dom.offOutput.hidden, false)
})

test('a canonical readback clears a stale field validation state', async () => {
  const result = load({
    cardMode: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  result.dom.title.value = 'no'
  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.dom.title.getAttribute('aria-invalid'), 'true')

  await result.dispatchWindow('starterSchedulingConnectionStateChanged', {})
  await settle()

  assert.equal(result.dom.title.value, 'Paid Consultation Call')
  assert.equal(result.dom.title.validationMessage, '')
  assert.equal(result.dom.title.getAttribute('aria-invalid'), 'false')
})

test('drifted authored pill copy is reported on staging instead of failing silently', async () => {
  const result = load({
    cardMode: true,
    authoredPills: true,
    pillLabels: { on: 'Live', off: 'Paused' },
    hostname: 'the-starters-3-0.webflow.io',
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.onOutput.getAttribute('data-call-settings-output'), null)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /no authored status pill reads "on"/)
  assert.match(result.warnings[0], /live \| paused/)
})

test('authored pill copy padded with a non-breaking space still resolves', async () => {
  const result = load({
    cardMode: true,
    authoredPills: true,
    pillLabels: { on: '\u00a0On\u00a0', off: 'Off' },
    hostname: 'the-starters-3-0.webflow.io',
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.onOutput.hidden, false)
  assert.equal(result.dom.offOutput.hidden, true)
  assert.equal(result.warnings.length, 0)
})

test('Paid re-resolves the card when status pills and Edit arrive after the root', async () => {
  const result = load({
    cardMode: true,
    authoredPills: true,
    rootFirst: true,
    initial: canonical(),
  })
  await settle()

  result.revealSiblings()
  await settle()

  assert.equal(result.dom.onOutput.hidden, true)
  assert.equal(result.dom.onOutput.style.display, 'none')
  assert.equal(result.dom.offOutput.hidden, false)
  assert.equal(result.dom.offOutput.style.display, '')
  assert.equal(result.dom.onOutput.getAttribute('data-call-settings-output'), 'on')
  assert.equal(result.dom.offOutput.getAttribute('data-call-settings-output'), 'off')

  await result.dom.open.dispatch('click')
  assert.equal(result.dom.formWrapper.style.display, 'flex')
})

test('an active legacy service can update to 60 minutes while readiness is stale', async () => {
  const legacy = service({ duration: 15, price_cents: 500, revision: 1 })
  const staleReadiness = {
    stripe_readiness_fresh: false,
    paid_call_enabled: true,
    bookable: false,
  }
  const result = load({
    cardMode: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    initial: canonical({ services: [legacy], readiness: staleReadiness }),
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        const saved = service({
          duration: body.duration_minutes,
          price_cents: body.price_cents,
          title: body.title,
          revision: 2,
        })
        setState(canonical({ services: [saved], readiness: staleReadiness }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'false')
  await result.dom.save.dispatch('click')
  await settle()

  const upserts = result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3')
  assert.equal(upserts.length, 1)
  assert.deepEqual(upserts[0].body, {
    config_id: 'cfg-paid-1',
    title: 'Paid Consultation Call',
    price_cents: 500,
    duration_minutes: 60,
    expected_revision: 1,
    idempotency_key: 'paid-call-upsert:uuid-fixed',
  })
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 2)
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-current'), '60')
  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'false')
  assert.equal(result.dom.statusOutput.textContent, 'Paid calls are saved, but a prerequisite needs attention.')
})

test('one published group with two non-canonical values still binds Yes and No apart', async () => {
  const result = load({
    cardMode: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    cardRadioValues: { disabled: 'No thanks', enabled: 'Yes please' },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.enabled.getAttribute('data-call-settings-input'), 'enabled')
  assert.equal(result.dom.disabled.getAttribute('data-call-settings-input'), 'disabled')
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.dom.disabled.checked, false)

  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  assert.equal(result.dom.enabled.checked, false)
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 1)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
})

test('one published group of unreadable answers binds neither radio instead of guessing', async () => {
  const result = load({
    cardMode: true,
    cardRadioNames: {
      disabled: 'consulting-calls-paid',
      enabled: 'consulting-calls-paid',
    },
    cardRadioValues: { disabled: '0', enabled: '1' },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ setState }) => {
        const saved = service({ revision: 5 })
        setState(canonical({
          services: [saved],
          readiness: { paid_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.enabled.getAttribute('data-call-settings-input'), null)
  assert.equal(result.dom.disabled.getAttribute('data-call-settings-input'), null)
  assert.equal(result.dom.enabled.checked, false)
  assert.equal(result.dom.disabled.checked, false)

  result.dom.enabled.checked = true
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 1)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 0)
})

test('the native Paid card treats No plus Update as the guarded disable action', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  assert.equal(result.dom.enabled.checked, false)
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 1)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.dom.formWrapper.style.display, 'none')
})

test('a stale checked No state cannot disable an active Paid service without a change event', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({
      services: [service({ price_cents: 100 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ setState }) => {
        const saved = service({ price_cents: 100, revision: 5 })
        setState(canonical({ services: [saved], readiness: { paid_call_enabled: true, bookable: true } }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  // Reproduce the published Webflow hydration race without a user change.
  result.dom.disabled.checked = true
  result.dom.enabled.checked = false
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 1)
  assert.equal(result.dom.root.getAttribute('data-paid-call-enabled'), 'true')
})

test('No plus Update still disables when the Yes radio carries a non-yes value', async () => {
  const result = load({
    cardMode: true,
    cardRadioValues: { enabled: 'on' },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  assert.notEqual(
    result.dom.enabled.getAttribute('data-call-settings-input'),
    result.dom.disabled.getAttribute('data-call-settings-input'),
  )
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.dom.disabled.checked, false)

  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  assert.equal(result.dom.enabled.checked, false)
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 1)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
})

test('a legacy No radio spelled other than no still joins the Paid group and disables', async () => {
  const result = load({
    cardMode: true,
    cardRadioValues: { disabled: 'No thanks' },
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.disabled.getAttribute('name'), 'paid-consulting-calls')
  assert.equal(result.dom.enabled.getAttribute('name'), 'paid-consulting-calls')
  assert.equal(result.dom.disabled.checked, false)

  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  assert.equal(result.dom.enabled.checked, false)
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 1)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
})

test('the native Paid card can disable an active service when prerequisites are stale', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({
      services: [service()],
      readiness: { stripe_readiness_fresh: false, paid_call_enabled: true, bookable: false },
    }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical({ readiness: { stripe_readiness_fresh: false } }))
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'false')
  assert.equal(result.dom.save.style.pointerEvents, '')
  assert.equal(result.dom.save.style.opacity, '')
  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 1)
})

test('the native Paid card makes No while already off a zero-write close', async () => {
  const result = load({ cardMode: true, initial: canonical() })
  await settle()

  await result.dom.open.dispatch('click')
  assert.equal(result.dom.formWrapper.style.display, 'flex')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.dom.formWrapper.style.display, 'none')
})

test('a Call Item shared with the Free card never binds the Free controls', async () => {
  const result = load({
    sharedCallItem: true,
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.formWrapper.style.display, 'none')
  assert.equal(result.dom.freeWrapper.style.display, undefined)

  await result.dom.freeOpen.dispatch('click')
  await result.dom.freeSave.dispatch('click')
  await settle()

  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.dom.formWrapper.style.display, 'none')
  assert.equal(result.dom.freeWrapper.style.display, undefined)

  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/disable/v3').length, 1)
  assert.equal(result.dom.enabled.checked, false)
})

test('an auth change during an in-flight Paid write leaves the card controls usable', async () => {
  const pending = deferred()
  const result = load({
    cardMode: true,
    initial: canonical(),
    routes: {
      '/starter/paid-call-settings/upsert/v3': () => pending.promise,
    },
  })
  await settle()

  await result.dom.open.dispatch('click')
  result.dom.enabled.checked = true
  result.dom.disabled.checked = false
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '150'
  await result.dom.save.dispatch('click')
  await settle(2)

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 1)
  assert.equal(result.dom.open.style.pointerEvents, 'none')
  assert.equal(result.dom.open.style.opacity, '0.6')

  await result.changeMember({ id: 'member-b' })
  await settle()

  assert.equal(result.dom.open.style.pointerEvents, '')
  assert.equal(result.dom.open.style.opacity, '')
  assert.equal(result.dom.close.style.pointerEvents, '')
  assert.equal(result.dom.close.style.opacity, '')

  assert.equal(result.dom.formWrapper.style.display, 'flex')
  await result.dom.open.dispatch('click')
  assert.equal(result.dom.formWrapper.style.display, 'none')
  await result.dom.open.dispatch('click')
  assert.equal(result.dom.formWrapper.style.display, 'flex')

  pending.resolve({ ok: true, status: 200, json: async () => ({ service: service() }) })
  await settle()
})

test('an expired session fails a Paid update closed before any POST', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  result.expireMemberSilently()

  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'error')
  assert.equal(result.dom.root.getAttribute('data-paid-call-enabled'), 'false')
  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'false')
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'true')
  assert.equal(result.dom.statusOutput.textContent, 'Sign in to manage paid calls.')
})

test('a guarded Paid update mirrors the error to both outputs and clears the native block on retry', async () => {
  let attempts = 0
  const active = canonical({
    services: [service({ price_cents: 100 })],
    readiness: { paid_call_enabled: true, bookable: true },
  })
  const result = load({
    cardMode: true,
    initial: active,
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ setState }) => {
        attempts += 1
        if (attempts === 1) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
          }
        }
        setState(active)
        return {
          ok: true,
          status: 200,
          json: async () => ({ service: service({ price_cents: 100 }) }),
        }
      },
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'error')
  assert.equal(
    result.dom.statusOutput.textContent,
    'Resolve in-flight bookings before updating this service',
  )
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Resolve in-flight bookings before updating this service',
  )
  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'false')
  assert.equal(result.dom.nativeError.getAttribute('role'), 'alert')
  assert.equal(result.dom.formWrapper.style.display, 'flex')
  assert.equal(result.dom.root.getAttribute('data-paid-call-enabled'), 'true')

  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'ready')
  assert.equal(result.dom.statusOutput.textContent, 'Paid calls are on and bookable.')
  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'true')
})

test('an invalid Paid retry clears the request error without a second write', async () => {
  const active = canonical({
    services: [service({ price_cents: 100 })],
    readiness: { paid_call_enabled: true, bookable: true },
  })
  const result = load({
    cardMode: true,
    initial: active,
    routes: {
      '/starter/paid-call-settings/upsert/v3': () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
      }),
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.nativeError.style.display, 'block')

  const terms = new El('input', { name: 'call-terms', required: '' })
  result.dom.form.append(terms)
  const reports = withNativeConstraintValidation(result.dom.form)
  await result.dom.save.dispatch('click')
  await settle()

  assert.deepEqual(reports, [['call-terms']])
  assert.equal(
    result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length,
    1,
  )
  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'true')
})

test('a Paid prerequisite refresh clears an update error while pending and replaces it only on failure', async () => {
  const successfulRefresh = deferred()
  const failedRefresh = deferred()
  let reads = 0
  const active = canonical({
    services: [service({ price_cents: 100 })],
    readiness: { paid_call_enabled: true, bookable: true },
  })
  const result = load({
    cardMode: true,
    initial: active,
    routes: {
      '/starter/paid-call-settings/get/v3': () => {
        reads += 1
        if (reads === 1) return { ok: true, status: 200, json: async () => active }
        return reads === 2 ? successfulRefresh.promise : failedRefresh.promise
      },
      '/starter/paid-call-settings/upsert/v3': () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Resolve in-flight bookings before updating this service' }),
      }),
    },
  })
  await settle()
  await result.dom.open.dispatch('click')
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Resolve in-flight bookings before updating this service',
  )

  await result.dispatchWindow('starterStripeConnectReady', {})
  await settle(2)

  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'true')

  successfulRefresh.resolve({ ok: true, status: 200, json: async () => active })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'ready')
  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')

  await result.dom.save.dispatch('click')
  await settle()
  assert.equal(result.dom.nativeError.style.display, 'block')

  await result.dispatchWindow('starterStripeConnectReady', {})
  await settle(2)

  assert.equal(result.dom.nativeErrorMessage.textContent, '')
  assert.equal(result.dom.nativeError.style.display, 'none')

  failedRefresh.resolve({
    ok: false,
    status: 503,
    json: async () => ({ message: 'temporarily unavailable' }),
  })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'error')
  assert.equal(
    result.dom.nativeErrorMessage.textContent,
    'Paid-call readiness could not be refreshed. Your account was not changed.',
  )
  assert.equal(result.dom.nativeError.style.display, 'block')
  assert.equal(result.dom.nativeError.getAttribute('aria-hidden'), 'false')
})

test('an expired session fails a Paid disable closed before any POST', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  result.dom.disabled.checked = true
  await result.dom.disabled.dispatch('change')
  result.expireMemberSilently()

  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'error')
  assert.equal(result.dom.root.getAttribute('data-paid-call-enabled'), 'false')
  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'false')
  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'true')
  assert.equal(result.dom.statusOutput.textContent, 'Sign in to manage paid calls.')
})

test('a fail-closed Paid reset leaves exactly one OFF status pill', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.onOutput.style.display, '')
  assert.equal(result.dom.offOutput.style.display, 'none')

  result.expireMemberSilently()
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.onOutput.hidden, true)
  assert.equal(result.dom.onOutput.style.display, 'none')
  assert.equal(result.dom.offOutput.hidden, false)
  assert.equal(result.dom.offOutput.style.display, '')
  assert.equal(result.dom.priceOutput.textContent, '$0.00')
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-current'), '')
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-required'), '60')
})

test('the Paid card shows only the OFF pill while canonical settings load', async () => {
  const initialRead = deferred()
  const result = load({
    cardMode: true,
    routes: {
      '/starter/paid-call-settings/get/v3': () =>
        initialRead.promise.then((value) => ({ ok: true, status: 200, json: async () => value })),
    },
  })
  await settle(2)

  assert.equal(result.dom.statusOutput.textContent, 'Loading paid-call settings…')
  assert.equal(result.dom.onOutput.hidden, true)
  assert.equal(result.dom.onOutput.style.display, 'none')
  assert.equal(result.dom.offOutput.hidden, false)
  assert.equal(result.dom.offOutput.style.display, '')

  initialRead.resolve(
    canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  )
  await settle(2)

  assert.equal(result.dom.onOutput.style.display, '')
  assert.equal(result.dom.offOutput.style.display, 'none')
})

test('the Paid card price output renders grouped two-decimal USD', async () => {
  const grouped = load({
    cardMode: true,
    initial: canonical({
      services: [service({ price_cents: 150000 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  assert.equal(grouped.dom.priceOutput.textContent, '$1,500.00')
  assert.equal(grouped.dom.onOutput.style.display, '')
  assert.equal(grouped.dom.offOutput.style.display, 'none')

  const legacyCents = load({
    cardMode: true,
    initial: canonical({
      services: [service({ price_cents: 1050 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  assert.equal(legacyCents.dom.priceOutput.textContent, '$10.50')

  const off = load({ cardMode: true, initial: canonical() })
  await settle()
  assert.equal(off.dom.priceOutput.textContent, '$0.00')
  assert.equal(off.dom.onOutput.style.display, 'none')
  assert.equal(off.dom.offOutput.style.display, '')
})

test('the current native Paid card price marker renders canonical USD without a new Webflow hook', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.priceOutput, null)
  assert.equal(result.dom.authoredPriceText.textContent, '$5.00')
})

test('the published split-span Paid price tile renders and restores the canonical amount', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true, split: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.authoredPriceSymbol.textContent, '$')
  assert.equal(result.dom.authoredPriceNumber.textContent, '5.00')

  result.expireMemberSilently()
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.authoredPriceSymbol.textContent, '$')
  assert.equal(result.dom.authoredPriceNumber.textContent, '150')
})

test('a split-span Paid price tile continued by a cents span stays Designer-owned', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true, split: true, cents: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.authoredPriceSymbol.textContent, '$')
  assert.equal(result.dom.authoredPriceNumber.textContent, '150')
  assert.equal(result.dom.authoredPriceCents.textContent, '.00')
})

test('an authored Paid amount continued by a cents sibling stays Designer-owned', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true, cents: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.authoredPriceText.textContent, '$150')
  assert.equal(result.dom.authoredPriceCents.textContent, '.00')
})

test('the authored Paid price tile keeps its Designer copy with paid calls off', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true },
    initial: canonical(),
  })
  await settle()

  assert.equal(result.dom.authoredPriceText.textContent, '$150')
  assert.equal(result.dom.statusOutput.textContent, 'Paid calls are off. Add a rate to turn them on.')
})

test('the authored Paid price tile returns to its Designer copy when the session ends', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()
  assert.equal(result.dom.authoredPriceText.textContent, '$5.00')

  result.expireMemberSilently()
  await result.dom.save.dispatch('click')
  await settle()

  assert.equal(result.dom.statusOutput.textContent, 'Sign in to manage paid calls.')
  assert.equal(result.dom.authoredPriceText.textContent, '$150')
})

test('the authored Paid price tile paints its amount and never a caption', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true, caption: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.authoredPriceCaption.textContent, 'Rate')
  assert.equal(result.dom.authoredPriceText.textContent, '$5.00')
})

test('an authored Paid price tile with no currency amount is left to Designer', async () => {
  const result = load({
    cardMode: true,
    priceTile: { canonical: false, authored: true, authoredText: 'Set your rate' },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.authoredPriceText.textContent, 'Set your rate')
})

test('the canonical price output wins over an authored Paid price tile', async () => {
  const result = load({
    cardMode: true,
    priceTile: { authored: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.priceOutput.textContent, '$5.00')
  assert.equal(result.dom.authoredPriceText.textContent, '$150')
})

test('a price tile authored on the Free sibling card is never painted by Paid', async () => {
  const result = load({
    sharedCallItem: true,
    priceTile: { canonical: false, foreign: true },
    initial: canonical({
      services: [service({ price_cents: 500 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  assert.equal(result.dom.authoredPriceText.parentElement, result.dom.authoredPriceCard)
  assert.equal(result.dom.authoredPriceCard.parentElement, result.dom.freeWrapper)
  assert.equal(result.dom.authoredPriceText.textContent, '$150')
})

test('optional prerequisite rows authored in the Paid Call Item header are painted', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({ readiness: { stripe_charges_enabled: false } }),
  })
  await settle()

  const ready = {}
  result.dom.prerequisites.forEach((item) => {
    ready[item.getAttribute('data-paid-call-prerequisite')] = item.getAttribute('data-ready')
  })
  assert.equal(ready.calendar, 'true')
  assert.equal(ready.availability, 'true')
  assert.equal(ready.stripe, 'true')
  assert.equal(ready.charges, 'false')
  assert.equal(ready.fresh, 'true')
  assert.equal(ready.bookable, 'false')
})

test('the stable call-settings attribute grammar binds the native Paid card', async () => {
  const result = load({
    stableCardMode: true,
    initial: canonical({ services: [service()], readiness: { bookable: true } }),
  })
  await settle()

  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'ready')
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 1)
})

test('Cancel restores canonical Paid values and makes no write', async () => {
  const result = load({
    cardMode: true,
    initial: canonical({ services: [service({ price_cents: 15000 })] }),
  })
  await settle()

  await result.dom.open.dispatch('click')
  result.dom.title.value = 'Unsaved draft'
  result.dom.price.value = '999'
  await result.dom.close.dispatch('click')

  assert.equal(result.dom.title.value, 'Paid Consultation Call')
  assert.equal(result.dom.price.value, 150)
  assert.equal(result.dom.formWrapper.style.display, 'none')
  assert.equal(result.calls.some((call) => call.method === 'POST'), false)
})

// Models browser constraint validation for the authored native Webflow form: a
// required radio group is satisfied only when one member of the group is checked,
// and any other required control is satisfied only when it holds a value.
function withNativeConstraintValidation(form) {
  const reports = []
  form.reportValidity = () => {
    const inputs = form.querySelectorAll('input')
    const invalid = inputs.filter((input) => {
      if (input.getAttribute('required') === null) return false
      if (input.getAttribute('type') === 'radio') {
        const group = input.getAttribute('name')
        return !inputs.some((peer) => peer.getAttribute('name') === group && peer.checked)
      }
      return !String(input.value || '').trim()
    })
    reports.push(invalid.map((input) => input.getAttribute('name')))
    return invalid.length === 0
  }
  return reports
}

test('an Update click is still gated by native form validation before any write', async () => {
  const savedService = service({ price_cents: 35000, revision: 1 })
  const result = load({
    cardMode: true,
    initial: canonical(),
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ setState }) => {
        setState(canonical({
          services: [savedService],
          readiness: { paid_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: savedService }) }
      },
    },
  })
  await settle()

  // The authored Paid card renders Yes/No as required radios, and the native form
  // may carry other required controls this controller never reads.
  result.dom.enabled.setAttribute('type', 'radio')
  result.dom.enabled.setAttribute('required', '')
  result.dom.disabled.setAttribute('type', 'radio')
  result.dom.disabled.setAttribute('required', '')
  const terms = new El('input', { name: 'call-terms', required: '' })
  result.dom.form.append(terms)
  const reports = withNativeConstraintValidation(result.dom.form)

  result.dom.enabled.checked = true
  result.dom.disabled.checked = false
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '350'

  const upserts = () =>
    result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3')

  await result.dom.save.dispatch('click')
  await settle(2)
  assert.deepEqual(reports, [['call-terms']])
  assert.equal(upserts().length, 0)

  terms.value = 'agreed'
  await result.dom.save.dispatch('click')
  await settle(2)
  assert.deepEqual(reports[1], [])
  assert.equal(upserts().length, 1)
})

test('native submit and Update click share one in-flight write lock', async () => {
  const pending = deferred()
  const result = load({
    cardMode: true,
    initial: canonical(),
    routes: {
      '/starter/paid-call-settings/upsert/v3': () => pending.promise,
    },
  })
  await settle()
  result.dom.enabled.checked = true
  result.dom.disabled.checked = false
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '150'

  await result.dom.save.dispatch('click')
  await result.dom.form.dispatch('submit')
  await settle(2)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 1)
  assert.equal(result.dom.save.getAttribute('data-call-settings-busy'), 'true')
  assert.equal(result.dom.save.getAttribute('aria-busy'), 'true')
  assert.equal(result.dom.save.getAttribute('data-opp-loading'), 'true')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').style.display, 'flex')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').getAttribute('aria-hidden'), 'false')
  assert.equal(result.dom.save.querySelector('[data-opp-element="loading-hide"]').style.display, 'none')

  const saved = service({ price_cents: 15000, revision: 1 })
  pending.resolve({ ok: true, status: 200, json: async () => ({ service: saved }) })
  await settle()
  assert.equal(result.dom.save.getAttribute('data-call-settings-busy'), 'false')
  assert.equal(result.dom.save.getAttribute('aria-busy'), 'false')
  assert.equal(result.dom.save.getAttribute('data-opp-loading'), 'false')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').style.display, 'none')
  assert.equal(result.dom.save.querySelector('[data-button-spinner]').getAttribute('aria-hidden'), 'true')
  assert.equal(result.dom.save.querySelector('[data-opp-element="loading-hide"]').style.display, '')
})

test('upsert sends product intent and revision, then trusts canonical readback', async () => {
  const initial = canonical()
  const savedService = service({ price_cents: 50000, revision: 1 })
  const result = load({
    initial,
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        setState(canonical({
          services: [savedService],
          readiness: { paid_call_enabled: true, bookable: true },
        }))
        return { ok: true, status: 200, json: async () => ({ service: savedService }) }
      },
    },
  })
  await settle()
  result.dom.enabled.checked = true
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '500'
  result.dom.duration.value = '60'

  await result.window.StarterPaidCallSettings.save()

  const upsert = result.calls.find((call) => call.path === '/starter/paid-call-settings/upsert/v3')
  assert.deepEqual(upsert.body, {
    config_id: null,
    title: 'Paid Consultation Call',
    price_cents: 50000,
    duration_minutes: 60,
    expected_revision: 0,
    idempotency_key: 'paid-call-upsert:uuid-fixed',
  })
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 2)
  assert.equal(result.dom.price.value, 500)
  assert.equal(result.dom.status.textContent, 'Paid calls are on and bookable.')
})

test('canonical readback does not report bookable when readiness changed during save', async () => {
  const savedService = service({ price_cents: 50000, revision: 1 })
  const result = load({
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ setState }) => {
        setState(canonical({
          services: [savedService],
          readiness: { paid_call_enabled: true, bookable: false },
        }))
        return { ok: true, status: 200, json: async () => ({ service: savedService }) }
      },
    },
  })
  await settle()
  result.dom.enabled.checked = true
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '500'
  result.dom.duration.value = '60'

  await result.window.StarterPaidCallSettings.save()

  assert.equal(result.dom.root.getAttribute('data-paid-call-bookable'), 'false')
  assert.equal(result.dom.status.textContent, 'Paid calls are saved, but a prerequisite needs attention.')
})

test('readiness events refresh canonical settings without a reload', async () => {
  const result = load({ initial: canonical({ readiness: { calendar_connected: false } }) })
  await settle()
  assert.equal(result.dom.save.disabled, true)

  result.getState().readiness.calendar_connected = true
  await result.dispatchWindow('starterSchedulingConnectionStateChanged', { state: 'connected' })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 2)
  assert.equal(result.dom.save.disabled, false)
})

test('a newer readiness read cannot be overwritten by initial canonical state', async () => {
  const initialRead = deferred()
  const readinessRead = deferred()
  let reads = 0
  const result = load({
    routes: {
      '/starter/paid-call-settings/get/v3': () => {
        reads += 1
        const pending = reads === 1 ? initialRead : readinessRead
        return pending.promise.then((value) => ({ ok: true, status: 200, json: async () => value }))
      },
    },
  })
  await settle(2)

  const refresh = result.dispatchWindow('starterSchedulingConnectionStateChanged', { state: 'connected' })
  await settle(2)
  readinessRead.resolve(canonical())
  await refresh
  initialRead.resolve(canonical({ readiness: { calendar_connected: false } }))
  await settle()

  assert.equal(result.dom.save.disabled, false)
  assert.equal(result.dom.status.textContent, 'Paid calls are off. Add a rate to turn them on.')
})

test('auth changes clear prior settings and load the next member canonically', async () => {
  const memberBRead = deferred()
  const result = load({
    routes: {
      '/starter/paid-call-settings/get/v3': ({ member }) => {
        const value = member && member.id === 'member-a'
          ? canonical({ services: [service({ title: 'Member A Call', price_cents: 12500 })] })
          : memberBRead.promise
        return Promise.resolve(value).then((canonicalValue) => ({
          ok: true,
          status: 200,
          json: async () => canonicalValue,
        }))
      },
    },
  })
  await settle()
  assert.equal(result.dom.title.value, 'Member A Call')
  assert.equal(result.dom.price.value, 125)

  const memberBLoad = result.changeMember({ id: 'member-b' })
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)

  memberBRead.resolve(canonical({
    services: [service({ config_id: 'cfg-paid-b', title: 'Member B Call', price_cents: 45000 })],
  }))
  await memberBLoad
  assert.equal(result.dom.title.value, 'Member B Call')
  assert.equal(result.dom.price.value, 450)

  await result.changeMember(null)
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)
})

test('a transient empty auth notification suspends and restores the Paid canonical paint', async () => {
  const result = load({
    initial: canonical({
      services: [service({ title: 'Paid Consultation Call', price_cents: 100, revision: 8 })],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
  })
  await settle()

  const readsBefore = result.calls.filter(
    (call) => call.path === '/starter/paid-call-settings/get/v3',
  ).length
  const transition = result.notifyAuthChange(null)
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)

  await transition
  await settle()

  assert.equal(result.dom.title.value, 'Paid Consultation Call')
  assert.equal(result.dom.price.value, 1)
  assert.equal(result.dom.enabled.checked, true)
  assert.equal(result.dom.root.getAttribute('data-paid-call-enabled'), 'true')
  assert.equal(
    result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length,
    readsBefore + 1,
  )
})

test('a failed post-write auth read falls back to the verified Paid update', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  let reads = 0
  let postFinished = false
  const result = load({
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/get/v3': ({ state }) => {
        reads += 1
        if (reads > 1 && !postFinished) {
          return { ok: false, status: 503, json: async () => ({ message: 'temporarily unavailable' }) }
        }
        if (reads === 3) {
          return { ok: false, status: 503, json: async () => ({ message: 'temporarily unavailable' }) }
        }
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({
            title: body.title,
            price_cents: body.price_cents,
            duration: body.duration_minutes,
            revision: 5,
          })
          setState(canonical({
            services: [saved],
            readiness: { paid_call_enabled: true, bookable: true },
          }))
          postFinished = true
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Paid Call'
  result.dom.price.value = '475'
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const authTransition = result.notifyAuthChange(null)
  await settle()
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')

  finishPost.resolve()
  await authTransition
  await settle()

  assert.equal(result.dom.title.value, 'Updated Paid Call')
  assert.equal(result.dom.price.value, 475)
  assert.equal(result.dom.root.getAttribute('data-paid-call-enabled'), 'true')
  assert.equal(reads, 3)
})

test('prerequisite events coalesce behind Paid write auth recovery', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  let reads = 0
  const result = load({
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/get/v3': ({ state }) => {
        reads += 1
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({
            title: body.title,
            price_cents: body.price_cents,
            duration: body.duration_minutes,
            revision: 5,
          })
          setState(canonical({
            services: [saved],
            readiness: { paid_call_enabled: true, bookable: true },
          }))
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Paid Call'
  result.dom.price.value = '475'
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const authTransition = result.notifyAuthChange(null)
  await settle()
  await result.dispatchWindow('starterSchedulingConnectionStateChanged')
  await result.dispatchWindow('starterStripeConnectReady')
  assert.equal(reads, 1)

  finishPost.resolve()
  await authTransition
  await settle()

  assert.equal(result.dom.title.value, 'Updated Paid Call')
  assert.equal(result.dom.price.value, 475)
  assert.equal(result.dom.root.getAttribute('data-paid-call-enabled'), 'true')
  assert.equal(reads, 4)
})

test('logout supersedes pending Paid write revalidation', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  const transitionStarted = deferred()
  const failTransition = deferred()
  let reads = 0
  const result = load({
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/get/v3': ({ state }) => {
        reads += 1
        if (reads === 3) {
          transitionStarted.resolve()
          return failTransition.promise
        }
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({
            title: body.title,
            price_cents: body.price_cents,
            duration: body.duration_minutes,
            revision: 5,
          })
          setState(canonical({
            services: [saved],
            readiness: { paid_call_enabled: true, bookable: true },
          }))
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Paid Call'
  result.dom.price.value = '475'
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const staleTransition = result.notifyAuthChange(null)
  await settle()
  finishPost.resolve()
  await transitionStarted.promise
  result.expireMemberSilently()
  await result.notifyAuthChange(null)
  failTransition.resolve({
    ok: false,
    status: 503,
    json: async () => ({ message: 'temporarily unavailable' }),
  })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.status.textContent, 'Sign in to manage paid calls.')
})

test('account switch supersedes pending Paid write revalidation', async () => {
  const postStarted = deferred()
  const finishPost = deferred()
  const transitionStarted = deferred()
  const failTransition = deferred()
  let memberAReads = 0
  const result = load({
    initial: canonical({
      services: [service()],
      readiness: { paid_call_enabled: true, bookable: true },
    }),
    routes: {
      '/starter/paid-call-settings/get/v3': ({ member, state }) => {
        if (member.id === 'member-b') {
          return {
            ok: true,
            status: 200,
            json: async () => canonical({
              services: [service({
                config_id: 'cfg-paid-b',
                title: 'Member B Call',
                price_cents: 45000,
              })],
            }),
          }
        }
        memberAReads += 1
        if (memberAReads === 3) {
          transitionStarted.resolve()
          return failTransition.promise
        }
        return { ok: true, status: 200, json: async () => state }
      },
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        postStarted.resolve()
        return finishPost.promise.then(() => {
          const saved = service({
            title: body.title,
            price_cents: body.price_cents,
            duration: body.duration_minutes,
            revision: 5,
          })
          setState(canonical({
            services: [saved],
            readiness: { paid_call_enabled: true, bookable: true },
          }))
          return { ok: true, status: 200, json: async () => ({ service: saved }) }
        })
      },
    },
  })
  await settle()

  result.dom.title.value = 'Updated Paid Call'
  result.dom.price.value = '475'
  await result.dom.save.dispatch('click')
  await postStarted.promise
  const staleTransition = result.notifyAuthChange(null)
  await settle()
  finishPost.resolve()
  await transitionStarted.promise
  await result.changeMember({ id: 'member-b' })
  failTransition.resolve({
    ok: false,
    status: 503,
    json: async () => ({ message: 'temporarily unavailable' }),
  })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, 'Member B Call')
  assert.equal(result.dom.price.value, 450)
})

test('a stale Paid same-member revalidation cannot repaint after logout', async () => {
  const staleMember = deferred()
  const result = load({
    initial: canonical({
      services: [service({ title: 'Paid Consultation Call', price_cents: 100 })],
    }),
  })
  await settle()

  result.setCurrentMemberReader(() => staleMember.promise)
  const staleTransition = result.notifyAuthChange(null)
  assert.equal(result.dom.title.value, '')

  result.expireMemberSilently()
  result.setCurrentMemberReader(() => null)
  await result.notifyAuthChange(null)
  staleMember.resolve({ id: 'member-a' })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)
  assert.equal(result.dom.status.textContent, 'Sign in to manage paid calls.')
})

test('a newer Paid account switch supersedes pending empty-auth revalidation', async () => {
  const staleMember = deferred()
  const result = load({
    routes: {
      '/starter/paid-call-settings/get/v3': ({ member }) => ({
        ok: true,
        status: 200,
        json: async () => canonical({
          services: [service({
            config_id: member.id === 'member-b' ? 'cfg-paid-b' : 'cfg-paid-a',
            title: member.id === 'member-b' ? 'Member B Call' : 'Member A Call',
            price_cents: member.id === 'member-b' ? 45000 : 12500,
          })],
        }),
      }),
    },
  })
  await settle()

  result.setCurrentMemberReader(() => staleMember.promise)
  const staleTransition = result.notifyAuthChange(null)
  result.setCurrentMemberReader(() => ({ id: 'member-b' }))
  await result.changeMember({ id: 'member-b' })
  staleMember.resolve({ id: 'member-a' })
  await staleTransition
  await settle()

  assert.equal(result.dom.title.value, 'Member B Call')
  assert.equal(result.dom.price.value, 450)
  assert.equal(result.dom.enabled.checked, true)
})

test('late Memberstack arrival still wires auth changes', async () => {
  const memberReady = deferred()
  const result = load({
    initial: canonical({ services: [service({ title: 'Member A Call' })] }),
    memberReady: memberReady.promise,
    withoutMemberstackAtLoad: true,
  })
  await settle(2)
  assert.equal(result.timers.length, 1)

  result.installMemberstack()
  result.flushTimers()
  memberReady.resolve({ id: 'member-a' })
  await settle()
  assert.equal(result.dom.title.value, 'Member A Call')

  await result.changeMember(null)
  assert.equal(result.dom.title.value, '')
  assert.equal(result.dom.price.value, '')
  assert.equal(result.dom.save.disabled, true)
})

test('late Memberstack arrival starts the initial canonical read when memberReady resolved first', async () => {
  const memberReady = deferred()
  const result = load({
    initial: canonical({ services: [service({ title: 'Member A Call' })] }),
    memberReady: memberReady.promise,
    withoutMemberstackAtLoad: true,
  })
  memberReady.resolve({ id: 'member-a' })
  await settle()

  assert.equal(result.calls.length, 0)
  assert.equal(result.timers.length, 1)

  result.installMemberstack()
  result.flushTimers()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/get/v3').length, 1)
  assert.equal(result.dom.title.value, 'Member A Call')
})

test('late bootstrap keeps a live account switch over stale memberReady identity', async () => {
  const memberReady = deferred()
  const result = load({
    memberReady: memberReady.promise,
    withoutMemberstackAtLoad: true,
    routes: {
      '/starter/paid-call-settings/get/v3': ({ member }) => ({
        ok: true,
        status: 200,
        json: async () => canonical({
          services: [service({
            config_id: member.id === 'member-b' ? 'cfg-paid-b' : 'cfg-paid-a',
            title: member.id === 'member-b' ? 'Member B Call' : 'Member A Call',
          })],
        }),
      }),
    },
  })
  await settle(2)

  result.installMemberstack()
  result.flushTimers()
  const memberBLoad = result.changeMember({ id: 'member-b' })
  memberReady.resolve({ id: 'member-a' })
  await memberBLoad
  await settle()

  assert.equal(result.dom.title.value, 'Member B Call')
  assert.equal(result.warnings.length, 0)
  assert.ok(result.calls.length >= 1)
})

test('disable sends the canonical revision and verifies the service is inactive', async () => {
  const active = service({ revision: 7 })
  const result = load({
    initial: canonical({ services: [active], readiness: { paid_call_enabled: true, bookable: true } }),
    routes: {
      '/starter/paid-call-settings/disable/v3': ({ setState }) => {
        setState(canonical())
        return { ok: true, status: 200, json: async () => ({ service: { active: false } }) }
      },
    },
  })
  await settle()

  await result.window.StarterPaidCallSettings.disable()

  const disable = result.calls.find((call) => call.path === '/starter/paid-call-settings/disable/v3')
  assert.deepEqual(disable.body, {
    config_id: 'cfg-paid-1',
    expected_revision: 7,
    idempotency_key: 'paid-call-disable:uuid-fixed',
  })
  assert.equal(result.dom.enabled.checked, false)
  assert.equal(result.dom.status.textContent, 'Paid calls are off.')
})

test('blocks enable when a canonical prerequisite is missing', async () => {
  const result = load({ initial: canonical({ readiness: { stripe_charges_enabled: false } }) })
  await settle()
  result.dom.enabled.checked = true
  result.dom.title.value = 'Paid Consultation Call'
  result.dom.price.value = '500'
  result.dom.duration.value = '60'

  const saved = await result.window.StarterPaidCallSettings.save()

  assert.equal(saved, null)
  assert.equal(result.calls.some((call) => call.path.includes('/upsert/')), false)
  assert.equal(result.dom.save.disabled, true)
})

test('the panel wiring offers Save for an active service while readiness is stale', async () => {
  const staleReadiness = {
    stripe_readiness_fresh: false,
    paid_call_enabled: true,
    bookable: false,
  }
  const result = load({
    initial: canonical({
      services: [service({ duration: 15, revision: 1 })],
      readiness: staleReadiness,
    }),
    routes: {
      '/starter/paid-call-settings/upsert/v3': ({ body, setState }) => {
        const saved = service({
          duration: body.duration_minutes,
          price_cents: body.price_cents,
          title: body.title,
          revision: 2,
        })
        setState(canonical({ services: [saved], readiness: staleReadiness }))
        return { ok: true, status: 200, json: async () => ({ service: saved }) }
      },
    },
  })
  await settle()

  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'false')
  assert.equal(result.dom.save.disabled, false)

  const saved = await result.window.StarterPaidCallSettings.save()
  await settle()

  assert.ok(saved)
  const upserts = result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3')
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].body.duration_minutes, 60)
  assert.equal(upserts[0].body.expected_revision, 1)
  assert.equal(result.dom.root.getAttribute('data-paid-call-duration-current'), '60')
  assert.equal(result.dom.save.getAttribute('aria-disabled'), 'false')
})

test('fails closed when canonical state has duplicate active paid services', async () => {
  const result = load({ initial: canonical({ services: [service(), service({ config_id: 'cfg-paid-2' })] }) })
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-paid-call-settings'), 'error')
  assert.match(result.dom.status.textContent, /unavailable/i)
})
