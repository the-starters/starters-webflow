const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./scheduling-availability-section.js'), 'utf8')
const WRITER_SOURCE = fs.readFileSync(require.resolve('./scheduling-availability-writer.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
const DAY_VARIANT_DEFAULT = 'w-variant-89402c65-e26d-c236-91e7-76e9135a2d42'
const DAY_VARIANT_SELECTED = 'w-variant-30a4a9ed-8474-d414-9314-498a5fe53866'

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
    if (value !== '') return
    for (const child of this.children) child._blurIfActiveInside()
    this.children = []
  }

  _blurIfActiveInside() {
    const doc = this.ownerDocument
    if (!doc || !doc.activeElement) return
    if (doc.activeElement === this) {
      doc.activeElement = null
      return
    }
    for (const el of this.walk()) {
      if (el === doc.activeElement) {
        doc.activeElement = null
        return
      }
    }
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
    this._blurIfActiveInside()
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
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

  const topContent = new El('div', {
    class: 'availability-settings_top-content',
    'data-availability-element': 'item-top-content',
  })
  const itemTitle = new El('p', { 'data-availability-element': 'item-title' })
  const tagLabel = new El('div')
  tagLabel.textContent = 'Main schedule'
  const buttonGroup = new El('div', {
    class: 'availability-settings_button-group',
    'data-availability-element': 'item-button-group',
  })
  const editBtn = new El('div', { 'data-availability-action': 'item-form-open' })
  editBtn.textContent = 'Edit'
  const removeBtn = new El('div', { 'data-availability-action': 'open-item-remove' })
  const removeBtnText = new El('span', { 'text-element': '' })
  removeBtnText.textContent = 'Remove'
  removeBtn.appendChild(removeBtnText)
  buttonGroup.appendChild(editBtn)
  buttonGroup.appendChild(removeBtn)
  topContent.appendChild(itemTitle)
  topContent.appendChild(tagLabel)
  topContent.appendChild(buttonGroup)

  const headline = new El('div', {
    class: 'availability-settings_item-headline',
    'data-availability-element': 'item-headline',
  })
  const timeWrapper = new El('div', {
    class: 'availability-settings_description-wrapper',
    'data-availability-element': 'item-time-wrapper',
  })
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

  const daysWrapper = new El('div', {
    class: 'availability-settings_description-wrapper',
    'data-availability-element': 'item-days-wrapper',
  })
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
    const checkboxSkin = new El('div', { class: 'w-checkbox-input' })
    const checkbox = new El('input', { type: 'checkbox', name: 'avail-day' })
    dayWrap.appendChild(checkboxSkin)
    dayWrap.appendChild(checkbox)
    form.appendChild(dayWrap)
  })
  const timepickerGroup = new El('div', { 'data-input-timepicker-group': '' })
  const startInput = new El('input', {
    name: 'start-time',
    id: 'start-time',
    'data-input-timepicker': '',
    'data-input-timepicker-role': 'start',
  })
  const endInput = new El('input', {
    name: 'end-time',
    id: 'end-time',
    'data-input-timepicker': '',
    'data-input-timepicker-role': 'end',
  })
  timepickerGroup.appendChild(startInput)
  timepickerGroup.appendChild(endInput)
  form.appendChild(timepickerGroup)
  formOuter.appendChild(form)
  const buttonRow = new El('div')
  const cancelBtn = new El('div', { 'data-availability-action': 'item-form-close' })
  cancelBtn.textContent = 'Cancel'
  const submitBtn = new El('div', { 'data-availability-action': 'item-form-submit' })
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

// Minimal stand-in for the "Availability - Notifications" component instance
// (`[data-modal-target="availability-notification"]`) — only the
// `[notification-type]` steps and `[data-availability-action]` confirm
// buttons that scheduling-availability-section.js actually drives. Close/
// Done buttons that only ever close the modal (`[data-modal-close]`, owned
// entirely by global-embeds/modal/modal.js) are included for shape but are
// never clicked by these tests.
function buildNotificationModal() {
  const modal = new El('dialog', { 'data-modal-target': 'availability-notification' })
  const steps = {}

  function closeBtn() {
    return new El('div', { 'data-modal-close': '' })
  }
  function actionBtn(action) {
    return new El('div', { 'data-availability-action': action })
  }
  function addStep(type, buttons) {
    const step = new El('div', { 'notification-type': type })
    if (buttons && buttons.length) {
      const group = new El('div', { class: 'call-sched_button-group' })
      buttons.forEach((b) => group.appendChild(b))
      step.appendChild(group)
    }
    steps[type] = step
    modal.appendChild(step)
    return step
  }

  addStep('availability-saved')
  const itemRemoveBtn = actionBtn('item-remove')
  addStep('availability-remove-approve', [closeBtn(), itemRemoveBtn])
  addStep('availability-removed')
  const disconnectGoogleBtn = actionBtn('disconnect-google')
  addStep('disconnect-calendar', [closeBtn(), disconnectGoogleBtn])
  addStep('calendar-disconnected')
  const switchConnectGoogleBtn = actionBtn('connect-google')
  addStep('switch-calendar', [closeBtn(), switchConnectGoogleBtn])
  const oauthRedirectBtn = actionBtn('open-oauth-redirect')
  const preOAuthStep = addStep('pre-oauth', [oauthRedirectBtn])
  const preOAuthCopy = new El('p')
  preOAuthCopy.textContent =
    'You’ll be taken to connect your Google calendar. Your availability settings have been saved.'
  preOAuthStep.appendChild(preOAuthCopy)
  addStep('oauth-redirect')
  addStep('virtual-connect')
  addStep('virtual-connected')
  const errorText = new El('div', { 'error-text-element': '' })
  addStep('request-error', [closeBtn()]).appendChild(errorText)

  return {
    modal,
    steps,
    itemRemoveBtn,
    disconnectGoogleBtn,
    switchConnectGoogleBtn,
    oauthRedirectBtn,
    preOAuthCopy,
    errorText,
  }
}

function buildSectionDom(options = {}) {
  const root = new El('div', { 'data-availability-element': 'section' })

  const loadingSection = new El('div', { 'data-availability-element': 'loading-section' })

  const connectWrapper = new El('div', { 'data-availability-element': 'connect-wrapper' })
  const labelGroup = new El('div', {
    class: 'button-group is-secondary',
    'data-availability-element': 'connect-label-group',
  })
  // Mirrors the real Designer markup. `connectLabels` picks which of the
  // supported shapes to build:
  //   'pairs'  (default) — one disconnected/connected pair per manager, every
  //                        label carrying both [data-type] and [data-manager]
  //   'legacy'           — the prior three-label shape: one shared untagged
  //                        [data-type="false"] plus the two
  //                        [data-type="true"][data-manager] variants
  //   'mixed'            — a part-migrated group: the shared untagged
  //                        [data-type="false"] still in place, with only the
  //                        calendar pair's [data-type="false"] added
  function connectLabel(type, manager, text) {
    const attrs = { 'data-type': type, 'data-availability-element': 'connect-label' }
    if (manager) attrs['data-manager'] = manager
    const label = new El('div', attrs)
    label.textContent = text
    return label
  }
  const connectLabelShapes = {
    pairs: () => [
      connectLabel('false', 'platform', 'Platform: Disconnected'),
      connectLabel('true', 'platform', 'Platform: Connected'),
      connectLabel('false', 'calendar', 'Google: Disconnected'),
      connectLabel('true', 'calendar', 'Google: Connected'),
    ],
    legacy: () => [
      connectLabel('false', null, 'Disconnected'),
      connectLabel('true', 'platform', 'Connected to platform'),
      connectLabel('true', 'calendar', 'Connected to calendar'),
    ],
    mixed: () => [
      connectLabel('false', null, 'Disconnected'),
      connectLabel('true', 'platform', 'Platform: Connected'),
      connectLabel('false', 'calendar', 'Google: Disconnected'),
      connectLabel('true', 'calendar', 'Google: Connected'),
    ],
  }
  const buildConnectLabels = connectLabelShapes[options.connectLabels || 'pairs']
  if (!buildConnectLabels) throw new Error('unknown connectLabels shape ' + options.connectLabels)
  buildConnectLabels().forEach((label) => labelGroup.appendChild(label))

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

  const connectOutlookBtn = new El('div', { 'data-availability-action': 'open-connect-outlook' })
  connectOutlookBtn.textContent = 'Connect Outlook Calendar'
  const disconnectOutlookBtn = new El('div', { 'data-availability-action': 'open-disconnect-outlook' })
  disconnectOutlookBtn.textContent = 'Disconnect Outlook Calendar'

  connectWrapper.appendChild(labelGroup)
  connectWrapper.appendChild(connectInfoWrapper)
  connectWrapper.appendChild(connectBtnWrapper)

  const mainWrapper = new El('div', { 'data-availability-element': 'main-wrapper' })
  const listWrapper = new El('div', { 'data-availability-element': 'list-wrapper' })
  const list = new El('div', { 'data-availability-element': 'list' })
  const itemTemplate = buildItemTemplate()
  // Lives directly in `list` now (a single instance, not cloned per item
  // form) — populated once at bootstrap from the starter's Paid_Call_Rate.
  const priceInput = new El('input', { type: 'hidden', id: 'price', name: 'price', 'data-rate': '150' })
  list.appendChild(itemTemplate)
  list.appendChild(priceInput)
  listWrapper.appendChild(list)

  const createCard = new El('div')
  const createBtn = new El('div', options.omitCreateAction ? {} : { 'data-availability-action': 'availability-create' })
  createBtn.textContent = 'Add availability window'
  createCard.appendChild(createBtn)

  const slotsWrapper = new El('div', { 'data-availability-element': 'slots-wrapper' })
  const loadingSlots = new El('div', { 'data-availability-element': 'loading-slots' })
  const calendarPreview = new El('div', { 'data-availability-element': 'calendar-preview' })
  slotsWrapper.appendChild(loadingSlots)
  slotsWrapper.appendChild(calendarPreview)

  mainWrapper.appendChild(listWrapper)
  mainWrapper.appendChild(createCard)
  mainWrapper.appendChild(slotsWrapper)

  const notif = buildNotificationModal()

  root.appendChild(loadingSection)
  root.appendChild(connectWrapper)
  root.appendChild(connectOutlookBtn)
  root.appendChild(disconnectOutlookBtn)
  root.appendChild(mainWrapper)
  root.appendChild(notif.modal)

  return {
    root,
    loadingSection,
    connectWrapper,
    connectBtnWrapper,
    labelGroup,
    connectInfoWrapper,
    connectOutlookBtn,
    disconnectOutlookBtn,
    mainWrapper,
    listWrapper,
    list,
    priceInput,
    loadingSlots,
    calendarPreview,
    slotsWrapper,
    createBtn,
    notif,
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
      Paid_Call_Rate: 150,
      paidService: null,
      configs: null,
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
        Paid_Call_Rate: state.Paid_Call_Rate,
      },
    }),
    '/starter/set_timezone/v3': () => ({ status: 200, body: { timezone: 'Asia/Manila' } }),
    '/starter/clear_calendar_data/v3': () => ({ status: 200, body: { id: 1 } }),
    '/starter/paid-call-settings/upsert/v3': (body) => {
      state.paidService = {
        config_id: 'cfg-paid-restored',
        title: body.title,
        price_cents: body.price_cents,
        duration: body.duration_minutes,
        active: true,
      }
      return { status: 200, body: { service: state.paidService } }
    },
    '/nylas_configurations/get_all/v3': () => ({
      status: 200,
      body: state.grantId
        ? state.configs || [{
            config_id: 'cfg-free',
            grant_id: state.grantId,
            title: 'Free Consultation Call',
            duration: 30,
            is_paid: false,
            active: true,
          }]
        : [],
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
      state.paidService = null
      return {
        status: 200,
        body: {
          connected: false,
          already_disconnected: false,
          availability: {},
          deleted_configuration_ids: [],
          provider_response: { status: 200 },
        },
      }
    },
    '/grants/oauth/v3': () => ({
      status: 200,
      body: { response: { result: { data: { url: 'https://nylas.example/oauth' } } } },
    }),
    '/grants/add/v3': () => ({ status: 200, body: { grant_id: 'grant-9' } }),
  }

  const getRoutes = {
    '/scheduler/get_availability/v3': () => ({ status: 200, body: { time_slots: [] } }),
    '/starter/paid-call-settings/get/v3': () => ({
      status: 200,
      body: {
        readiness: { paid_call_enabled: Boolean(state.paidService) },
        services: state.paidService ? [state.paidService] : [],
      },
    }),
  }

  return { state, postRoutes, getRoutes }
}

function loadSection(options = {}) {
  const dom = buildSectionDom(options.dom)
  const body = new El('body')
  body.appendChild(dom.root)
  const { state, postRoutes, getRoutes } = buildStatefulRoutes(options.serverState)
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
      const result = await route(query)
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
    activeElement: null,
    createElement: (tag) => {
      const element = new El(tag)
      element.ownerDocument = document
      return element
    },
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
      _map: new Map(Object.entries(options.localStorage || {})),
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
    sessionStorage: {
      _map: new Map(Object.entries(options.sessionStorage || {})),
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
    clearGrantData: options.clearGrantData,
    jQuery: options.jQuery,
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
    Intl: options.intl || Intl,
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

  return { dom, calls, warnings, logs, assigned, events, state, window, document }
}

async function settle(iterations = 25) {
  for (let i = 0; i < iterations; i++) await new Promise(setImmediate)
}

function createDatepickerStub() {
  const jQuery = (element) => {
    const api = {
      datepicker(arg, value) {
        if (typeof arg === 'object') {
          element._datepickerOptions = arg
          element.appendChild(new El('div', { class: 'ui-datepicker ui-datepicker-inline' }))
        } else if (arg === 'setDate') {
          element._datepickerDate = value
        }
        return api
      },
    }
    return api
  }
  jQuery.fn = { datepicker() {} }
  return jQuery
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
  assert.equal(daysWrapper.children[1].getAttribute('data-wf--labelv2--style-theme'), 'lime')
  assert.equal(daysWrapper.children[3].getAttribute('data-wf--labelv2--style-theme'), 'lime')
  ;[0, 2, 4, 5, 6].forEach((i) => {
    assert.ok(classesOf(i).includes(DAY_VARIANT_DEFAULT))
    assert.ok(!classesOf(i).includes(DAY_VARIANT_SELECTED))
    assert.equal(daysWrapper.children[i].getAttribute('data-wf--labelv2--style-theme'), 'silver')
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
    assert.equal(daysWrapper.children[i].getAttribute('data-wf--labelv2--style-theme'), 'silver')
  }
})

/* ------------------------------------------------------------------ */
/* Tests: getUpcomingTimeSlots                                         */
/* ------------------------------------------------------------------ */

test('getUpcomingTimeSlots sorts, drops past slots, and slices to the limit', async () => {
  // Matches the production lead-time rule (Date.now() + 24h floor): slot offsets
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

test('slot preview applies the host-locked booking notice floor', async () => {
  const stagingNow = Math.floor(Date.now() / 1000)
  const stagingTooSoon = stagingNow + 4 * 60
  const stagingAllowed = stagingNow + 6 * 60
  const staging = loadSection({
    hostname: 'the-starters-3-0.webflow.io',
    origin: 'https://the-starters-3-0.webflow.io',
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: stagingTooSoon }, { start_time: stagingAllowed }] },
      }),
    },
  })
  await settle()
  assert.deepEqual(
    await staging.window.StarterSchedulingAvailabilitySection.getUpcomingTimeSlots({
      grantId: 'grant-1',
      configId: 'cfg-free',
    }),
    [stagingAllowed],
  )
  const stagingQuery = staging.calls.filter(
    (call) => call.path === '/scheduler/get_availability/v3',
  ).at(-1).query
  assert.ok(Number(stagingQuery.start_time) >= stagingNow + 5 * 60)
  assert.ok(Number(stagingQuery.start_time) <= Math.floor(Date.now() / 1000) + 5 * 60)

  const productionNow = Math.floor(Date.now() / 1000)
  const productionTooSoon = productionNow + 23 * 60 * 60
  const productionAllowed = productionNow + 25 * 60 * 60
  const production = loadSection({
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: productionTooSoon }, { start_time: productionAllowed }] },
      }),
    },
  })
  await settle()
  assert.deepEqual(
    await production.window.StarterSchedulingAvailabilitySection.getUpcomingTimeSlots({
      grantId: 'grant-1',
      configId: 'cfg-free',
    }),
    [productionAllowed],
  )
})

test('getUpcomingTimeSlots returns an empty array without grantId/configId', async () => {
  const { window } = loadSection()
  await settle()
  const result = await window.StarterSchedulingAvailabilitySection.getUpcomingTimeSlots({})
  assert.equal(result.length, 0)
})

test('getUpcomingTimeSlots returns the full booking window when limit is zero', async () => {
  const firstSlot = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const slots = Array.from({ length: 140 }, (_, index) => ({
    start_time: firstSlot + index * 15 * 60,
  }))
  const { window } = loadSection({
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({ status: 200, body: { time_slots: slots } }),
    },
  })
  await settle()

  const result = await window.StarterSchedulingAvailabilitySection.getUpcomingTimeSlots({
    grantId: 'grant-1',
    configId: 'cfg-free',
    limit: 0,
  })
  assert.equal(result.length, 140)
})

/* ------------------------------------------------------------------ */
/* Tests: connection-state -> visibility                               */
/* ------------------------------------------------------------------ */

test('boots into disconnected state: connect + google visible, disconnect hidden', async () => {
  const { dom, window } = loadSection()
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'disconnected')
  assert.equal(dom.connectInfoWrapper.style.display, '')
  assert.notEqual(dom.connectBtnWrapper.children[0].style.display, 'none') // connect-platform
  assert.notEqual(dom.connectBtnWrapper.children[1].style.display, 'none') // connect-google
  assert.equal(dom.connectBtnWrapper.children[2].style.display, 'none') // disconnect-google
})

test('connection pills and actions follow the independent Nylas and Google state matrix', async () => {
  const cases = [
    {
      name: 'no Nylas grant',
      serverState: {},
      labels: [true, false, true, false],
      actions: [true, true, false],
    },
    {
      name: 'virtual Nylas grant',
      serverState: {
        grantId: 'virtual-grant',
        grantEmail: 'member-a',
        calendarId: 'virtual-calendar',
        availability: {
          items: { general: { days: [1], start: '09:00', end: '17:00', defaultDays: [1] } },
          manager: 'platform',
        },
      },
      labels: [false, true, true, false],
      actions: [false, true, false],
    },
    {
      name: 'Google-backed Nylas grant',
      serverState: {
        grantId: 'google-grant',
        grantEmail: 'g@example.com',
        calendarId: 'google-calendar',
        availability: {
          items: { general: { days: [1], start: '09:00', end: '17:00', defaultDays: [1] } },
          manager: 'calendar',
        },
      },
      labels: [false, true, false, true],
      actions: [false, false, true],
    },
    {
      name: 'stale Google manager without a Nylas grant',
      serverState: {
        availability: {
          items: { general: { days: [1], start: '09:00', end: '17:00', defaultDays: [1] } },
          manager: 'calendar',
        },
      },
      labels: [true, false, true, false],
      actions: [true, true, false],
    },
  ]

  for (const entry of cases) {
    const { dom } = loadSection({ serverState: entry.serverState })
    await settle()
    entry.labels.forEach((visible, index) => {
      assert.equal(
        dom.labelGroup.children[index].style.display !== 'none',
        visible,
        entry.name + ' label ' + index,
      )
    })
    entry.actions.forEach((visible, index) => {
      assert.equal(
        dom.connectBtnWrapper.children[index].style.display !== 'none',
        visible,
        entry.name + ' action ' + index,
      )
    })
  }
})

test('the first load reveals connect-wrapper (flex) and hides loading-section regardless of connection state, but keeps main-wrapper hidden until a successful connect', async () => {
  const { dom } = loadSection()

  // Nothing is revealed yet — the wrappers are hidden by the site's own CSS
  // and the script must never touch that itself, only reveal them once ready.
  assert.notEqual(dom.connectWrapper.style.display, 'flex')
  assert.notEqual(dom.mainWrapper.style.display, 'grid')

  await settle()

  // Boots disconnected (see 'boots into disconnected state' above) — the
  // connect UI must always surface once loading finishes, but the
  // list/slots main-wrapper has nothing to show until a calendar is
  // actually connected.
  assert.equal(dom.loadingSection.style.display, 'none')
  assert.equal(dom.connectWrapper.style.display, 'flex')
  assert.notEqual(dom.mainWrapper.style.display, 'grid')

  dom.connectBtnWrapper.children[0].click() // connect-platform
  await settle()

  assert.equal(dom.mainWrapper.style.display, 'grid')
})

test('main-wrapper stays visible through a later disconnect-google switch back to platform', async () => {
  const { dom } = loadSection({
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
  assert.equal(dom.mainWrapper.style.display, 'grid')

  dom.connectBtnWrapper.children[2].click() // open-disconnect-google -> opens the confirm modal
  dom.notif.disconnectGoogleBtn.click() // confirm -> actually reverts to platform
  await settle()

  // main-wrapper must not have been hidden by the manager switch.
  assert.equal(dom.mainWrapper.style.display, 'grid')
})

test('#price is not populated from the profile projection or Designer placeholder', async () => {
  const { dom, window } = loadSection({
    serverState: { Paid_Call_Rate: 275 },
  })
  await settle()

  assert.equal(dom.priceInput.value, '')
  assert.equal(dom.priceInput.dataset.rate, '150')
  assert.equal(window.localStorage._map.has('paid_call_rate'), false)
})

test('#price remains inert when the starter has no projected Paid_Call_Rate', async () => {
  const { dom } = loadSection({
    serverState: { Paid_Call_Rate: null },
  })
  await settle()

  assert.equal(dom.priceInput.value, '')
})

test('clicking the ordinal connect-platform button (no data-availability-action yet) connects and flips visibility', async () => {
  const { dom, window, warnings } = loadSection()
  await settle()

  dom.connectBtnWrapper.children[0].click() // connect-platform, ordinal fallback
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(dom.connectInfoWrapper.style.display, 'none')
  assert.equal(dom.connectBtnWrapper.children[0].style.display, 'none') // now on platform
  assert.notEqual(dom.connectBtnWrapper.children[1].style.display, 'none') // can still switch to Google
  assert.equal(dom.connectBtnWrapper.children[2].style.display, 'none') // not on Google
  assert.ok(warnings.some((w) => w.includes('using ordinal position')))
})

test('connecting for the first time (no items at all) seeds a default Mon-Fri 09:00-18:00 General item', async () => {
  const { dom, calls } = loadSection({
    serverState: {
      availability: { items: {}, manager: null },
    },
  })
  await settle()

  const before = dom.list.children.filter((el) => el.getAttribute('data-availability-element') === 'item-card')
  assert.equal(before.length, 0, 'no items before the first connect')

  dom.connectBtnWrapper.children[0].click() // connect-platform
  await settle()

  const generalCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id === 'general',
  )
  assert.ok(generalCard, 'a general item was created automatically on first connect')

  const updateCall = calls.filter((c) => c.path === '/starter/update_availability/v3').pop()
  assert.deepEqual(updateCall.body.availability.items.general, {
    days: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '18:00',
    defaultDays: [1, 2, 3, 4, 5],
  })

  // The scheduler config must actually carry those hours — otherwise the
  // freshly connected calendar would have zero open hours and be unbookable.
  const configCall = calls.find((c) => c.path === '/scheduler/configurations/create/v3')
  assert.ok(configCall)
  assert.deepEqual(configCall.body.in_availability.availability_rules.default_open_hours, [
    { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  ])
  assert.equal(configCall.body.in_scheduler.min_booking_notice, 1440)
})

test('staging scheduler configuration creation uses a five-minute booking notice', async () => {
  const { dom, calls, window } = loadSection({
    hostname: 'the-starters-3-0.webflow.io',
    origin: 'https://the-starters-3-0.webflow.io',
    serverState: { availability: { items: {}, manager: null } },
  })
  await settle()

  assert.equal(window.StarterSchedulingAvailabilitySection.minimumBookingNoticeMinutes(), 5)
  dom.connectBtnWrapper.children[0].click()
  await settle()

  const configCall = calls.find((call) => call.path === '/scheduler/configurations/create/v3')
  assert.ok(configCall)
  assert.equal(configCall.body.in_scheduler.min_booking_notice, 5)
})

test('accepts any successful provider 2xx status when creating a scheduler configuration', async () => {
  const { dom } = loadSection({
    serverState: { availability: { items: {}, manager: null } },
    postRoutes: {
      '/scheduler/configurations/create/v3': () => ({
        status: 200,
        body: { response: { status: 201 } },
      }),
    },
  })
  await settle()

  dom.connectBtnWrapper.children[0].click()
  await settle()

  assert.equal(dom.notif.steps['virtual-connected'].style.display, '')
  assert.equal(dom.notif.steps['request-error'].style.display, 'none')
})

test('connect-google succeeds on a brand-new starter with no availability row yet', async () => {
  // Reproduces the reported bug: a starter who has never saved any
  // availability has no canonical availability row in Xano at all (not even
  // the empty {items:{}, manager:null} shape) — refreshCanonicalConnectionState()'s
  // strict isAvailability() check used to throw here and block the redirect
  // before the member ever reached Google.
  const { dom, assigned, warnings, window } = loadSection({
    serverState: { availability: null },
  })
  await settle()

  dom.connectBtnWrapper.children[1].click() // open-connect-google -> disconnected, so straight to pre-oauth
  assert.equal(dom.notif.steps['pre-oauth'].style.display, '')
  assert.equal(assigned.length, 0, 'no redirect yet — still waiting on the informational step')

  dom.notif.oauthRedirectBtn.click() // "Done" -> the actual redirect
  await settle()

  assert.equal(assigned.length, 1, 'the OAuth redirect actually happened')
  assert.ok(assigned[0].includes('nylas.example/oauth'))
  assert.ok(!warnings.some((w) => w.includes('connect-google failed')))
  assert.ok(window.sessionStorage._map.has('starter-scheduling-oauth-intent:member-a'))
  assert.ok(window.localStorage._map.has('starter-scheduling-oauth-intent:member-a'))
})

test('hides unsupported Outlook actions and removes premature Google OAuth success copy', async () => {
  const { dom } = loadSection()
  await settle()

  assert.equal(dom.connectOutlookBtn.style.display, 'none')
  assert.equal(dom.disconnectOutlookBtn.style.display, 'none')
  assert.equal(dom.connectOutlookBtn.getAttribute('aria-hidden'), 'true')
  assert.equal(dom.disconnectOutlookBtn.getAttribute('aria-hidden'), 'true')
  assert.equal(dom.notif.preOAuthCopy.textContent, 'You’ll be taken to connect your Google calendar.')
})

test('applies calendar UI corrections when initialization fails', async () => {
  const { dom } = loadSection({
    postRoutes: {
      '/starter/get_by_memberstack/v3': () => ({ status: 500, body: {} }),
    },
  })
  await settle()

  assert.equal(dom.connectOutlookBtn.style.display, 'none')
  assert.equal(dom.disconnectOutlookBtn.style.display, 'none')
  assert.equal(dom.notif.preOAuthCopy.textContent, 'You’ll be taken to connect your Google calendar.')
})

test('rejects a nested provider failure even when the Xano transport returns HTTP 200', async () => {
  const { dom } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [{ config_id: 'cfg-free', duration: 30, is_paid: false, active: true }],
      availability: {
        items: {
          general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] },
        },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/scheduler/configurations/update/v3': () => ({
        status: 200,
        body: { response: { status: 422 } },
      }),
    },
  })
  await settle()

  const card = dom.list.children.find((el) => el.dataset.id === 'general')
  card.children[0].children[2].children[0].click()
  const formWrapper = card.children[2]
  formWrapper.children[0].children[1].children[1].click()
  await settle()

  assert.equal(dom.notif.steps['request-error'].style.display, '')
  assert.equal(dom.notif.steps['availability-saved'].style.display, 'none')
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
  assert.equal(dom.labelGroup.children[0].style.display, 'none') // Platform disconnected
  assert.equal(dom.labelGroup.children[1].style.display, '') // Platform connected through Nylas
  assert.equal(dom.labelGroup.children[2].style.display, 'none') // Google disconnected
  assert.equal(dom.labelGroup.children[3].style.display, '') // Google connected
  assert.equal(dom.connectBtnWrapper.children[0].style.display, 'none') // Nylas is already connected
  assert.equal(dom.connectBtnWrapper.children[1].style.display, 'none') // already on Google
  assert.equal(dom.connectBtnWrapper.children[2].style.display, '') // disconnect-google visible
})

test('disconnecting Google preserves the Platform layer by replacing the Google grant with a virtual grant', async () => {
  const legacyClearCalls = []
  const { dom, calls } = loadSection({
    clearGrantData: async (...args) => legacyClearCalls.push(args),
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      paidService: {
        config_id: 'cfg-paid-old',
        title: 'Paid Strategy Call',
        price_cents: 42500,
        duration: 45,
        active: true,
      },
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  dom.connectBtnWrapper.children[2].click() // disconnect-google
  await settle()

  // Deleting a live Google grant is irreversible, so the click only opens the
  // shared confirm step — nothing may be deleted until the member confirms.
  assert.equal(dom.notif.steps['disconnect-calendar'].style.display, '')
  assert.equal(
    calls.filter((c) => c.path === '/grants/delete/v3').length,
    0,
    'no provider mutation before the member confirms',
  )

  dom.notif.disconnectGoogleBtn.click() // confirm -> replaces Google with the virtual Platform grant
  await settle()

  assert.equal(dom.notif.steps['calendar-disconnected'].style.display, '')
  const deleteCall = calls.find((c) => c.path === '/grants/delete/v3')
  assert.ok(deleteCall, 'expected the existing Google grant to be deleted')
  assert.equal(deleteCall.body.in_grant_id, 'grant-1')
  assert.deepEqual(legacyClearCalls, [], 'legacy clearGrantData must not own provider disconnect')
  const restoreCall = calls.find((call) => call.path === '/starter/paid-call-settings/upsert/v3')
  assert.deepEqual(restoreCall.body, {
    config_id: null,
    title: 'Paid Strategy Call',
    price_cents: 42500,
    duration_minutes: 45,
    expected_revision: 0,
    idempotency_key: 'paid-call-calendar-transition:uuid-fixed',
  })
  const paths = calls.map((call) => call.path)
  assert.ok(paths.indexOf('/grants/delete/v3') < paths.indexOf('/starter/paid-call-settings/upsert/v3'))
})

test('a stale/programmatic connect-platform click is ignored while a Google-backed Nylas grant exists', async () => {
  const { dom, calls } = loadSection({
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

  assert.equal(dom.connectBtnWrapper.children[0].style.display, 'none')
  dom.connectBtnWrapper.children[0].click()
  await settle()

  assert.equal(dom.notif.steps['disconnect-calendar'].style.display, 'none')
  assert.equal(calls.filter((c) => c.path === '/grants/delete/v3').length, 0)
  assert.equal(calls.filter((c) => c.path === '/grants/create_virtual_account/v3').length, 0)
})

test('a Nylas grant persisted without a calendar stays repairable through Connect Platform', async () => {
  // Reproduces the half-built virtual grant: /grants/add_virtual/v3 persisted
  // nylas_grant_id but /grants/create_virtual_calendar/v3 failed, so the
  // reloaded member holds a grant that can serve neither availability nor
  // bookings. Platform must read Disconnected and keep offering the rebuild.
  const { dom, calls, window, state } = loadSection({
    serverState: {
      grantId: 'orphan-grant',
      grantEmail: 'virtual@example.com',
      calendarId: null,
      availability: {
        items: { general: { days: [1], start: '09:00', end: '17:00', defaultDays: [1] } },
        manager: null,
      },
    },
  })
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'reconnect')
  assert.equal(dom.labelGroup.children[0].style.display, '') // Platform disconnected
  assert.equal(dom.labelGroup.children[1].style.display, 'none') // not "Connected"
  assert.equal(dom.connectBtnWrapper.children[0].style.display, '') // connect-platform
  assert.equal(dom.connectBtnWrapper.children[2].style.display, 'none') // no Google to disconnect

  dom.connectBtnWrapper.children[0].click() // connect-platform rebuilds over it
  await settle()

  const deleteCall = calls.find((call) => call.path === '/grants/delete/v3')
  assert.ok(deleteCall, 'expected the half-built grant to be deleted first')
  assert.equal(deleteCall.body.in_grant_id, 'orphan-grant')
  const paths = calls.map((call) => call.path)
  assert.ok(
    paths.indexOf('/grants/delete/v3') < paths.indexOf('/grants/create_virtual_account/v3'),
  )
  assert.equal(dom.notif.steps['virtual-connected'].style.display, '')
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(state.grantId, 'vgrant-1')
  assert.equal(state.calendarId, 'vcal-1')
  assert.equal(state.availability.manager, 'platform')
  assert.equal(dom.labelGroup.children[1].style.display, '') // Platform connected
  assert.equal(dom.connectBtnWrapper.children[0].style.display, 'none')
})

test('a half-built Google-backed grant keeps the confirmed disconnect path instead of Connect Platform', async () => {
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'google-grant',
      grantEmail: 'g@example.com',
      calendarId: null,
      availability: {
        items: { general: { days: [1], start: '09:00', end: '17:00', defaultDays: [1] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  assert.equal(dom.labelGroup.children[3].style.display, '') // Google connected
  assert.equal(dom.connectBtnWrapper.children[0].style.display, 'none') // connect-platform
  assert.equal(dom.connectBtnWrapper.children[2].style.display, '') // open-disconnect-google

  dom.connectBtnWrapper.children[0].click()
  await settle()

  assert.equal(calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 0)
})

test('OAuth cancellation rebuilds platform scheduling and restores the saved paid service', async () => {
  const result = loadSection({
    search: '?error=access_denied&error_description=cancelled&state=member-a',
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 1)
  assert.equal(result.state.grantId, 'vgrant-1')
  assert.equal(result.state.availability.manager, 'platform')
  assert.deepEqual(result.state.paidService, {
    config_id: 'cfg-paid-restored',
    title: 'Paid Strategy Call',
    price_cents: 42500,
    duration: 45,
    active: true,
  })
  assert.equal(result.window.sessionStorage._map.has('starter-scheduling-oauth-callback'), false)
  assert.equal(
    result.window.sessionStorage._map.has('starter-scheduling-oauth-intent:member-a'),
    false,
  )
})

test('production OAuth callback uses the durable same-origin intent fallback', async () => {
  let canonicalState = null
  const intentKey = 'starter-scheduling-oauth-intent:member-a'
  const result = loadSection({
    search: '?success=true&grant_id=hosted-grant-9&state=member-a',
    localStorage: {
      [intentKey]: JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: null,
      }),
    },
    serverState: {
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: null,
      },
    },
    postRoutes: {
      '/grants/add/v3': () => {
        canonicalState.grantId = 'hosted-grant-9'
        canonicalState.grantEmail = 'jp@hirethestarters.com'
        canonicalState.calendarId = 'primary'
        return { status: 200, body: { grant_id: 'hosted-grant-9' } }
      },
    },
  })
  canonicalState = result.state
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
  assert.equal(result.state.grantId, 'hosted-grant-9')
  assert.equal(result.state.availability.manager, 'calendar')
  assert.equal(result.window.localStorage._map.has(intentKey), false)
  assert.equal(result.window.sessionStorage._map.has('starter-scheduling-oauth-callback'), false)
})

test('another tab does not consume the durable OAuth intent without a callback', async () => {
  const intentKey = 'starter-scheduling-oauth-intent:member-a'
  const result = loadSection({
    localStorage: {
      [intentKey]: JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 0)
  assert.equal(result.window.localStorage._map.has(intentKey), true)
})

test('OAuth cancellation recovery reuses canonical resources after partial success', async () => {
  const result = loadSection({
    search: '?error=access_denied&error_description=cancelled&state=member-a',
    sessionStorage: {
      'starter-scheduling-oauth-intent:member-a': JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: {
          title: 'Paid Strategy Call',
          price_cents: 42500,
          duration_minutes: 45,
        },
      }),
    },
    serverState: {
      grantId: 'vgrant-existing',
      grantEmail: 'virtual@example.com',
      calendarId: 'vcal-existing',
      configs: [
        {
          config_id: 'cfg-free-existing',
          grant_id: 'vgrant-existing',
          duration: 30,
          is_paid: false,
          active: true,
        },
      ],
      paidService: {
        config_id: 'cfg-paid-existing',
        title: 'Paid Strategy Call',
        price_cents: 42500,
        duration: 45,
        active: true,
      },
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'platform',
      },
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.window.sessionStorage._map.has('starter-scheduling-oauth-callback'), false)
  assert.equal(
    result.window.sessionStorage._map.has('starter-scheduling-oauth-intent:member-a'),
    false,
  )
})

test('an active-booking rejection stops Google disconnect before the virtual Platform replacement', async () => {
  const { dom, calls, window } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/grants/delete/v3': () => ({
        status: 400,
        body: { code: 'ERROR_CODE_INPUT_ERROR', message: 'Resolve active bookings before disconnecting the calendar' },
      }),
    },
  })
  await settle()

  dom.connectBtnWrapper.children[2].click()
  dom.notif.disconnectGoogleBtn.click() // confirm Google disconnect
  await settle()

  assert.equal(calls.filter((c) => c.path === '/grants/delete/v3').length, 1)
  assert.equal(calls.filter((c) => c.path === '/grants/create_virtual_account/v3').length, 0)
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'error')
})

test('an ambiguous grant deletion immediately restores the paid service', async () => {
  let canonicalState = null
  const result = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      paidService: {
        config_id: 'cfg-paid-old',
        title: 'Paid Strategy Call',
        price_cents: 100,
        duration: 45,
        active: true,
      },
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/grants/delete/v3': () => {
        canonicalState.grantId = null
        canonicalState.grantEmail = null
        canonicalState.calendarId = null
        canonicalState.paidService = null
        return { status: 503, body: { message: 'response lost' } }
      },
    },
  })
  canonicalState = result.state
  await settle()

  result.dom.connectBtnWrapper.children[2].click()
  result.dom.notif.disconnectGoogleBtn.click() // confirm Google disconnect
  await settle()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 1)
  assert.equal(
    result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3').length,
    1,
  )
  assert.deepEqual(result.state.paidService, {
    config_id: 'cfg-paid-restored',
    title: 'Paid Strategy Call',
    price_cents: 100,
    duration: 45,
    active: true,
  })
  assert.equal(result.state.availability.manager, 'platform')
  assert.equal(
    result.window.sessionStorage._map.has('starter-scheduling-oauth-intent:member-a'),
    false,
  )
})

test('a failed calendar replacement retains paid intent and recovers it on reload', async () => {
  const firstLoad = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      paidService: {
        config_id: 'cfg-paid-old',
        title: 'Paid Strategy Call',
        price_cents: 42500,
        duration: 45,
        active: true,
      },
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/grants/create_virtual_account/v3': () => ({ status: 503, body: { message: 'try again' } }),
    },
  })
  await settle()

  firstLoad.dom.connectBtnWrapper.children[2].click()
  firstLoad.dom.notif.disconnectGoogleBtn.click() // confirm Google disconnect
  await settle()

  const retained = JSON.parse(
    firstLoad.window.sessionStorage._map.get('starter-scheduling-oauth-intent:member-a'),
  )
  assert.equal(retained.paidCallIntent.title, 'Paid Strategy Call')
  assert.equal(firstLoad.state.paidService, null)

  const secondLoad = loadSection({
    serverState: firstLoad.state,
    sessionStorage: Object.fromEntries(firstLoad.window.sessionStorage._map),
  })
  await settle()

  assert.equal(secondLoad.state.paidService.title, 'Paid Strategy Call')
  assert.equal(secondLoad.state.availability.manager, 'platform')
  assert.equal(
    secondLoad.window.sessionStorage._map.has('starter-scheduling-oauth-intent:member-a'),
    false,
  )
})

test('a Google disconnect whose virtual replacement fails drops the stale Google state', async () => {
  // Reproduces the reported bug: /grants/delete/v3 succeeds (the Nylas grant
  // is gone) but the replacement virtual calendar fails, and the module used
  // to keep grantId/manager='calendar' locally — still offering "Disconnect
  // Google" and re-deleting a grant id that no longer exists on every retry.
  const { dom, calls, state, document } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/grants/create_virtual_account/v3': () => ({ status: 503, body: { message: 'try again' } }),
    },
  })
  await settle()

  dom.connectBtnWrapper.children[2].click() // disconnect-google
  dom.notif.disconnectGoogleBtn.click() // confirm disconnect
  await settle()

  assert.equal(document.documentElement.getAttribute('data-scheduling-calendar-state'), 'error')
  assert.equal(dom.notif.steps['request-error'].style.display, '')
  // The grant is gone, so nothing may still claim Google is connected.
  assert.equal(state.availability.manager, null, 'canonical manager was cleared')
  assert.equal(dom.connectBtnWrapper.children[2].style.display, 'none') // no "Disconnect Google"
  assert.notEqual(dom.connectBtnWrapper.children[0].style.display, 'none') // retry stays available

  const deletesBeforeRetry = calls.filter((c) => c.path === '/grants/delete/v3').length
  assert.equal(deletesBeforeRetry, 1)

  dom.connectBtnWrapper.children[0].click() // retry
  await settle()

  assert.equal(
    calls.filter((c) => c.path === '/grants/delete/v3').length,
    deletesBeforeRetry,
    'a retry must not re-delete the already-deleted grant',
  )
})

test('connect-label-group and connect-info-wrapper do not flash mid-request on disconnect-google', async () => {
  const { dom } = loadSection({
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

  // A Google-backed Nylas grant makes both connection layers connected.
  assert.equal(dom.labelGroup.children[0].style.display, 'none') // Platform disconnected
  assert.equal(dom.labelGroup.children[1].style.display, '') // Platform connected
  assert.equal(dom.labelGroup.children[2].style.display, 'none') // Google disconnected
  assert.equal(dom.labelGroup.children[3].style.display, '') // Google connected
  assert.equal(dom.connectInfoWrapper.style.display, 'none')

  dom.connectBtnWrapper.children[2].click() // open-disconnect-google -> opens the confirm modal, no request yet
  dom.notif.disconnectGoogleBtn.click() // confirm -> publishes 'loading' synchronously

  // The request hasn't resolved yet — both pairs must still read
  // exactly as they did before the click, not flip to a "disconnected" look.
  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '')
  assert.equal(dom.labelGroup.children[2].style.display, 'none')
  assert.equal(dom.labelGroup.children[3].style.display, '')
  assert.equal(dom.connectInfoWrapper.style.display, 'none')

  await settle()

  // Disconnect reverts to the platform manager, landing back on a connected
  // look (now the platform label) once the real response arrives.
  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '')
  assert.equal(dom.labelGroup.children[2].style.display, '')
  assert.equal(dom.labelGroup.children[3].style.display, 'none')
  assert.equal(dom.connectInfoWrapper.style.display, 'none')
})

test('connect-label shows one state from each provider pair', async () => {
  const { dom } = loadSection()
  await settle()

  // Boots disconnected: each pair shows its disconnected variant.
  assert.equal(dom.labelGroup.children[0].style.display, '')
  assert.equal(dom.labelGroup.children[1].style.display, 'none')
  assert.equal(dom.labelGroup.children[2].style.display, '')
  assert.equal(dom.labelGroup.children[3].style.display, 'none')

  dom.connectBtnWrapper.children[0].click() // connect-platform
  await settle()

  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '') // platform variant
  assert.equal(dom.labelGroup.children[2].style.display, '') // Google disconnected
  assert.equal(dom.labelGroup.children[3].style.display, 'none')
})

test('legacy three-label connect-label markup keeps its group-wide semantics', async () => {
  const { dom } = loadSection({ dom: { connectLabels: 'legacy' } })
  await settle()

  // Boots disconnected: only the shared untagged [data-type="false"] shows.
  assert.equal(dom.labelGroup.children[0].style.display, '') // "Disconnected"
  assert.equal(dom.labelGroup.children[1].style.display, 'none') // platform variant
  assert.equal(dom.labelGroup.children[2].style.display, 'none') // calendar variant

  dom.connectBtnWrapper.children[0].click() // connect-platform
  await settle()

  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '')
  assert.equal(dom.labelGroup.children[2].style.display, 'none')
})

test('legacy three-label connect-label markup survives an in-flight disconnect-google', async () => {
  const { dom } = loadSection({
    dom: { connectLabels: 'legacy' },
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

  // Both legacy connected labels show because Google is carried by Nylas.
  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '')
  assert.equal(dom.labelGroup.children[2].style.display, '')

  dom.connectBtnWrapper.children[2].click() // open-disconnect-google
  dom.notif.disconnectGoogleBtn.click() // confirm -> publishes 'loading'

  // Still mid-request: no flash back to the "Disconnected" label.
  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '')
  assert.equal(dom.labelGroup.children[2].style.display, '')

  await settle()

  // Disconnect reverts to the platform manager.
  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '')
  assert.equal(dom.labelGroup.children[2].style.display, 'none')
})

function loadSectionInErrorState(domOptions) {
  // Boots as a Google-connected member, then fails the configuration read the
  // boot sequence requires — init's catch publishes the 'error' state.
  return loadSection({
    dom: domOptions,
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/nylas_configurations/get_all/v3': () => ({ status: 500, body: { message: 'configuration reader down' } }),
    },
  })
}

test('the error state asserts nothing about either provider', async () => {
  const { dom, document } = loadSectionInErrorState()
  await settle()

  assert.equal(document.documentElement.getAttribute('data-scheduling-calendar-state'), 'error')

  // The live manager is unknown, so no pair may claim a provider is connected
  // OR disconnected — especially not "Google: Disconnected" next to the
  // "Disconnect Google" button this member still gets.
  assert.equal(dom.labelGroup.children[0].style.display, 'none') // Platform disconnected
  assert.equal(dom.labelGroup.children[1].style.display, 'none') // Platform connected
  assert.equal(dom.labelGroup.children[2].style.display, 'none') // Google disconnected
  assert.equal(dom.labelGroup.children[3].style.display, 'none') // Google connected

  // The rest of the error UI and the action row are untouched.
  assert.equal(document.documentElement.getAttribute('data-scheduling-availability-section'), 'error')
  assert.equal(dom.connectWrapper.style.display, 'flex')
  assert.equal(dom.loadingSection.style.display, 'none')
  assert.equal(dom.connectBtnWrapper.children[2].style.display, '') // "Disconnect Google" still offered
})

test('the error state keeps the legacy group-wide label', async () => {
  // The untagged [data-type="false"] label names no provider, so its prior
  // meaning survives an error; only the per-manager variants drop out.
  const { dom, document } = loadSectionInErrorState({ connectLabels: 'legacy' })
  await settle()

  assert.equal(document.documentElement.getAttribute('data-scheduling-calendar-state'), 'error')
  assert.equal(dom.labelGroup.children[0].style.display, '') // "Disconnected"
  assert.equal(dom.labelGroup.children[1].style.display, 'none') // platform variant
  assert.equal(dom.labelGroup.children[2].style.display, 'none') // calendar variant
})

test('a part-migrated connect-label group still resolves every tagged pair', async () => {
  // One untagged legacy "Disconnected" label left in place alongside a fully
  // tagged calendar pair: the untagged label must not disable the pairs.
  const { dom } = loadSection({ dom: { connectLabels: 'mixed' } })
  await settle()

  assert.equal(dom.labelGroup.children[0].style.display, '') // untagged "Disconnected"
  assert.equal(dom.labelGroup.children[1].style.display, 'none') // Platform connected
  assert.equal(dom.labelGroup.children[2].style.display, '') // Google disconnected
  assert.equal(dom.labelGroup.children[3].style.display, 'none') // Google connected

  dom.connectBtnWrapper.children[0].click() // connect-platform
  await settle()

  // Platform is connected, so the group-wide label goes away — but the Google
  // pair must still report its own (disconnected) state rather than vanish.
  assert.equal(dom.labelGroup.children[0].style.display, 'none')
  assert.equal(dom.labelGroup.children[1].style.display, '')
  assert.equal(dom.labelGroup.children[2].style.display, '')
  assert.equal(dom.labelGroup.children[3].style.display, 'none')
})

/* ------------------------------------------------------------------ */
/* Tests: per-item form toggle, action visibility, checkbox skin       */
/* ------------------------------------------------------------------ */

test('item-form-open toggles the item form open and closed via display', async () => {
  const { dom } = loadSection()
  await settle()
  const card = dom.list.children.find((el) => el.dataset.id === 'general')
  const buttonGroup = card.children[0].children[2] // topContent -> button-group
  const formWrapper = card.children[2]
  const editBtn = buttonGroup.children[0]

  assert.equal(formWrapper.style.display, 'none') // closed by default after render
  editBtn.click()
  assert.equal(formWrapper.style.display, 'block')
  editBtn.click()
  assert.equal(formWrapper.style.display, 'none')
  editBtn.click()
  assert.equal(formWrapper.style.display, 'block')
})

test('general item shows an edit button but hides remove; a newly created draft hides both (and the headline) until saved', async () => {
  const { dom } = loadSection()
  await settle()

  const generalCard = dom.list.children.find((el) => el.dataset.id === 'general')
  const generalButtons = generalCard.children[0].children[2]
  assert.notEqual(generalButtons.children[0].style.display, 'none') // edit
  assert.equal(generalButtons.children[1].style.display, 'none') // remove

  dom.createBtn.click()
  await settle()

  const draftCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const draftButtons = draftCard.children[0].children[2]
  const draftHeadline = draftCard.children[1]
  // A draft that doesn't exist server-side yet opens straight into its edit
  // form — edit/remove and the days/time headline don't apply until it's
  // actually saved.
  assert.equal(draftButtons.style.display, 'none')
  assert.equal(draftHeadline.style.display, 'none')

  const formWrapper = draftCard.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[0].children[1].checked = true // Sunday
  form.querySelector('[name=start-time]').value = '09:00'
  form.querySelector('[name=end-time]').value = '10:00'
  const buttonRow = formWrapper.children[0].children[1]
  buttonRow.children[1].click() // item-form-submit
  await settle()

  const savedCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const savedButtons = savedCard.children[0].children[2]
  assert.notEqual(savedButtons.children[0].style.display, 'none') // edit
  assert.notEqual(savedButtons.children[1].style.display, 'none') // remove
  assert.notEqual(savedCard.children[1].style.display, 'none') // headline back
})

test('an added window normalizes hour-only timepicker values before the availability request', async () => {
  const { dom, calls } = loadSection()
  await settle()

  dom.createBtn.click()
  await settle()

  const draftCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const formWrapper = draftCard.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[3].children[1].checked = true // Wednesday
  form.children[4].children[1].checked = true // Thursday
  form.querySelector('[name=start-time]').value = '10'
  form.querySelector('[name=end-time]').value = '14'

  formWrapper.children[0].children[1].children[1].click()
  await settle()

  const updateCall = calls.filter((call) => call.path === '/starter/update_availability/v3').at(-1)
  assert.ok(updateCall)
  const saved = Object.values(updateCall.body.availability.items).find(
    (item) => item.days.length === 2 && item.days.includes(3) && item.days.includes(4),
  )
  assert.ok(saved)
  assert.equal(saved.start, '10:00')
  assert.equal(saved.end, '14:00')
})

test('an added window zero-pads a one-digit hour before the availability request', async () => {
  const { dom, calls } = loadSection()
  await settle()

  dom.createBtn.click()
  await settle()

  const draftCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const formWrapper = draftCard.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[0].children[1].checked = true // Sunday
  form.querySelector('[name=start-time]').value = '9:30'
  form.querySelector('[name=end-time]').value = '14'

  formWrapper.children[0].children[1].children[1].click()
  await settle()

  const updateCall = calls.filter((call) => call.path === '/starter/update_availability/v3').at(-1)
  assert.ok(updateCall)
  const saved = Object.values(updateCall.body.availability.items).find((item) => item.days.includes(0))
  assert.ok(saved)
  assert.equal(saved.start, '09:30')
  assert.equal(saved.end, '14:00')
})

test('invalid or non-ascending times stay editable and never send an availability request', async () => {
  const cases = [
    ['25', '14'],
    ['10', '10:60'],
    ['14:00', '14:00'],
    ['15:00', '14:00'],
  ]

  for (const [start, end] of cases) {
    const { dom, calls, state } = loadSection()
    await settle()
    const before = JSON.stringify(state.availability)

    dom.createBtn.click()
    await settle()

    const draftCard = dom.list.children.find(
      (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
    )
    const formWrapper = draftCard.children[2]
    const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
    form.children[0].children[1].checked = true
    form.querySelector('[name=start-time]').value = start
    form.querySelector('[name=end-time]').value = end

    formWrapper.children[0].children[1].children[1].click()
    await settle()

    assert.equal(calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
    assert.equal(JSON.stringify(state.availability), before)
    assert.equal(dom.notif.steps['request-error'].style.display, '')
    assert.match(dom.notif.errorText.textContent, /valid start and end time/i)
    assert.ok(dom.list.children.includes(draftCard), 'invalid draft remains editable')
  }
})

test('populateItemForm marks selected day checkboxes with the Webflow checked-skin class', async () => {
  const { dom } = loadSection({
    serverState: {
      availability: {
        items: { general: { days: [1, 3], start: '09:00', end: '17:00', defaultDays: [1, 3] } },
        manager: null,
      },
    },
  })
  await settle()
  const card = dom.list.children.find((el) => el.dataset.id === 'general')
  const buttonGroup = card.children[0].children[2]
  const editBtn = buttonGroup.children[0]
  editBtn.click() // opens + populates
  await settle()

  const formWrapper = card.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  const dayWraps = form.children.slice(0, 7)
  const isChecked = (i) => dayWraps[i].children[0].classList.contains('w--redirected-checked')

  assert.ok(isChecked(1))
  assert.ok(isChecked(3))
  ;[0, 2, 4, 5, 6].forEach((i) => assert.ok(!isChecked(i)))
})

test('the explicit [data-availability-action="availability-create"] trigger creates a new item', async () => {
  const { dom } = loadSection()
  await settle()
  const before = dom.list.children.filter((el) => el.getAttribute('data-availability-element') === 'item-card').length

  dom.createBtn.click()
  await settle()

  const after = dom.list.children.filter((el) => el.getAttribute('data-availability-element') === 'item-card').length
  assert.equal(after, before + 1)
})

test('the create trigger is disabled while a draft is open, and re-enabled after the draft is cancelled', async () => {
  const { dom } = loadSection()
  await settle()

  assert.notEqual(dom.createBtn.style.pointerEvents, 'none')

  dom.createBtn.click() // opens a draft
  await settle()

  assert.equal(dom.createBtn.style.pointerEvents, 'none')
  assert.equal(dom.createBtn.style.opacity, '0.6')

  const before = dom.list.children.filter((el) => el.getAttribute('data-availability-element') === 'item-card').length
  dom.createBtn.click() // must be a no-op — one draft at a time
  await settle()
  const afterSecondClick = dom.list.children.filter(
    (el) => el.getAttribute('data-availability-element') === 'item-card',
  ).length
  assert.equal(afterSecondClick, before)

  const draftCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const formWrapper = draftCard.children[2]
  const buttonRow = formWrapper.children[0].children[1]
  buttonRow.children[0].click() // item-form-close — discards the unsaved draft
  await settle()

  assert.notEqual(dom.createBtn.style.pointerEvents, 'none')
  assert.notEqual(dom.createBtn.style.opacity, '0.6')

  dom.createBtn.click() // a new draft is allowed again
  await settle()
  const afterCancelAndRecreate = dom.list.children.filter(
    (el) => el.getAttribute('data-availability-element') === 'item-card',
  ).length
  // `before` already counted the first draft (general + draft = 2) — cancel
  // removes it, recreate adds a new one back, netting the same count.
  assert.equal(afterCancelAndRecreate, before)
})

test('the create trigger re-enables once a draft is saved', async () => {
  const { dom } = loadSection()
  await settle()

  dom.createBtn.click()
  await settle()
  assert.equal(dom.createBtn.style.pointerEvents, 'none')

  const draftCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const formWrapper = draftCard.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[0].children[1].checked = true // Sunday
  form.querySelector('[name=start-time]').value = '09:00'
  form.querySelector('[name=end-time]').value = '10:00'
  const buttonRow = formWrapper.children[0].children[1]
  buttonRow.children[1].click() // item-form-submit
  await settle()

  assert.notEqual(dom.createBtn.style.pointerEvents, 'none')
})

test('without the [data-availability-action="availability-create"] attribute, the create trigger is never bound (no text-matching fallback)', async () => {
  const { dom } = loadSection({ dom: { omitCreateAction: true } })
  await settle()
  const before = dom.list.children.filter((el) => el.getAttribute('data-availability-element') === 'item-card').length

  // dom.createBtn still exists and still reads "Add availability window",
  // but carries no [data-availability-action] — clicking it must do nothing.
  dom.createBtn.click()
  await settle()

  const after = dom.list.children.filter((el) => el.getAttribute('data-availability-element') === 'item-card').length
  assert.equal(after, before)
})

test('initInputPickers scopes to the freshly rendered list on a full render, and to just the new card on create', async () => {
  const { dom, window } = loadSection()
  await settle()

  const calls = []
  window.wfInputTimepicker = { init: (scope) => calls.push(scope) }

  // activatePlatformManager() ends in a full renderAvailabilityItems() call.
  dom.connectBtnWrapper.children[0].click()
  await settle()
  assert.ok(calls.includes(dom.list))

  calls.length = 0
  dom.createBtn.click()
  await settle()
  const newCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  assert.deepEqual(calls, [newCard])
})

test('a cloned item-card gets fresh timepicker markup so global timepicker.js does not skip re-init', async () => {
  const { dom, window } = loadSection()
  await settle()

  // Minimal stand-in for global-embeds/form-embeds/timepicker/timepicker.js's
  // own guard: a group already carrying data-input-timepicker-initialized
  // ="true" is skipped entirely (initGroup() returns immediately).
  const initedGroups = []
  window.wfInputTimepicker = {
    init(scope) {
      scope.querySelectorAll('[data-input-timepicker-group]').forEach((group) => {
        if (group.getAttribute('data-input-timepicker-initialized') === 'true') return
        initedGroups.push(group)
        group.setAttribute('data-input-timepicker-initialized', 'true')
      })
    },
  }

  // Reproduce the real precondition: the item-template is a hidden sibling
  // inside `list` (never removed), so the very first initInputPickers(list)
  // call in renderAvailabilityItems() reaches and marks it too — every future
  // clone would otherwise inherit this mark via cloneNode(true).
  const template = dom.list.children.find((el) => el.getAttribute('data-availability-element') === 'item-template')
  template.querySelector('[data-input-timepicker-group]').setAttribute('data-input-timepicker-initialized', 'true')

  dom.createBtn.click()
  await settle()

  const newCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const newGroup = newCard.querySelector('[data-input-timepicker-group]')
  assert.ok(
    initedGroups.includes(newGroup),
    'initGroup() must actually run on the clone instead of bailing on an inherited INIT_ATTR',
  )

  const newStart = newCard.querySelector('[data-input-timepicker][data-input-timepicker-role="start"]')
  const newEnd = newCard.querySelector('[data-input-timepicker][data-input-timepicker-role="end"]')
  assert.equal(newStart.getAttribute('id'), null, 'cloned start input id must be stripped to avoid duplicate DOM ids')
  assert.equal(newEnd.getAttribute('id'), null, 'cloned end input id must be stripped to avoid duplicate DOM ids')
})

test('item cards remain visible (not display:none) across repeated renders', async () => {
  const { dom } = loadSection()
  await settle()

  dom.createBtn.click()
  await settle()
  const newCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && el.dataset.id !== 'general',
  )
  const formWrapper = newCard.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[0].children[1].checked = true // Sunday
  form.querySelector('[name=start-time]').value = '09:00'
  form.querySelector('[name=end-time]').value = '10:00'

  const buttonRow = formWrapper.children[0].children[1]
  buttonRow.children[1].click() // item-form-submit
  await settle()

  const cards = dom.list.children.filter((el) => el.getAttribute('data-availability-element') === 'item-card')
  assert.ok(cards.length > 0)
  cards.forEach((card) => {
    assert.notEqual(card.style.display, 'none')
  })
})

/* ------------------------------------------------------------------ */
/* Tests: bookable-slots preview loading state                        */
/* ------------------------------------------------------------------ */

test('calendar-preview renders canonical active free services and their live slots', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const laterDate = future + 24 * 60 * 60
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-free',
          grant_id: 'grant-1',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }, { start_time: laterDate }] },
      }),
    },
  })
  await settle()

  assert.equal(dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'ready')
  const services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.ok(services)
  assert.equal(services.children.length, 1)
  assert.equal(services.children[0].getAttribute('data-preview-config-id'), 'cfg-free')
  assert.equal(services.children[0].getAttribute('aria-pressed'), 'true')
  assert.equal(services.children[0].children[0].textContent, 'Free Consultation Call')
  assert.equal(services.children[0].children[1].textContent, '30 minutes · Free')
  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-booking-notice"]')
      .textContent,
    "Bookings require at least 24 hours' notice.",
  )

  const slotsList = dom.calendarPreview.querySelector('[data-availability-element="slots-list"]')
  assert.ok(slotsList)
  const dates = slotsList.querySelector('[data-availability-element="preview-dates"]')
  const times = slotsList.querySelector('[data-availability-element="preview-times"]')
  assert.ok(dates)
  assert.ok(times)
  assert.equal(dates.children.length, 2)
  assert.equal(dates.children[0].getAttribute('aria-pressed'), 'true')
  assert.equal(times.children.length, 1)
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    1,
  )
})

test('calendar-preview explains the five-minute staging booking notice', async () => {
  const future = Math.floor(Date.now() / 1000) + 10 * 60
  const { dom } = loadSection({
    hostname: ' THE-STARTERS-3-0.WEBFLOW.IO ',
    origin: 'https://the-starters-3-0.webflow.io',
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid',
          grant_id: 'grant-1',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 100,
          currency: 'usd',
          is_paid: true,
          active: true,
          sync_status: 'ready',
          data_environment: 'test',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-booking-notice"]')
      .textContent,
    "Bookings require at least 5 minutes' notice.",
  )
})

test('calendar-preview explains the 24-hour notice on both production hosts', async () => {
  for (const hostname of ['thestarters.com', 'www.thestarters.com']) {
    const { dom } = loadSection({
      hostname,
      origin: 'https://' + hostname,
      serverState: {
        grantId: 'grant-1',
        grantEmail: 'g@example.com',
        calendarId: 'cal-1',
        configs: [
          {
            config_id: 'cfg-free',
            grant_id: 'grant-1',
            title: 'Free Consultation Call',
            duration: 30,
            is_paid: false,
            active: true,
          },
        ],
      },
    })
    await settle()

    assert.equal(
      dom.calendarPreview.querySelector('[data-availability-element="preview-booking-notice"]')
        .textContent,
      "Bookings require at least 24 hours' notice.",
      hostname,
    )
  }
})

test('calendar-preview uses the existing jQuery UI library for a stylable month calendar', async () => {
  const firstDate = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const secondDate = firstDate + 24 * 60 * 60
  const { dom } = loadSection({
    jQuery: createDatepickerStub(),
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-free',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: firstDate }, { start_time: secondDate }] },
      }),
    },
  })
  await settle()

  const calendar = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-month-calendar"]',
  )
  assert.ok(calendar)
  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-dates"]').style.display,
    'none',
  )
  assert.equal(calendar.querySelector('.ui-datepicker-inline').style.display, 'block')
  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-picker-layout"]').style.gridTemplateColumns,
    'minmax(0, 1fr)',
  )
  assert.equal(calendar._datepickerOptions.dateFormat, 'yy-mm-dd')
  assert.equal(calendar._datepickerOptions.beforeShowDay(calendar._datepickerDate)[0], true)
  assert.equal(
    calendar._datepickerOptions.beforeShowDay(
      new Date(calendar._datepickerDate.getFullYear(), calendar._datepickerDate.getMonth(), calendar._datepickerDate.getDate() + 7),
    )[0],
    false,
  )

  const timezoneControl = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-timezone-control"]',
  )
  const timezoneSelect = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-timezone"]',
  )
  const calendarColumn = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-calendar-column"]',
  )
  assert.ok(timezoneControl)
  assert.ok(timezoneSelect)
  assert.equal(timezoneSelect.value, 'Asia/Manila')
  assert.equal(calendarColumn.children.indexOf(timezoneControl) > calendarColumn.children.indexOf(calendar), true)
})

function futureUtcSlot(hour = 4, minute = 30) {
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  return Math.floor(
    Date.UTC(future.getUTCFullYear(), future.getUTCMonth(), future.getUTCDate(), hour, minute) /
      1000,
  )
}

function formatSlotTime(start, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(start * 1000))
}

function slotDateKey(start, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(new Date(start * 1000))
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function formatSlotSummary(start, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(start * 1000))
}

function formatSlotDate(start, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(start * 1000))
}

test('calendar-preview timezone selector converts slots without a write or another availability read', async () => {
  const start = futureUtcSlot()
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-free',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: start }] },
      }),
    },
  })
  await settle()

  const initialWrites = calls.filter((call) => call.method !== 'GET').length
  const initialReads = calls.filter((call) => call.path === '/scheduler/get_availability/v3').length
  let timezoneSelect = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-timezone"]',
  )
  let times = dom.calendarPreview.querySelector('[data-availability-element="preview-times"]')
  assert.equal(timezoneSelect.value, 'Asia/Manila')
  assert.equal(times.children[0].textContent, formatSlotTime(start, 'Asia/Manila'))

  timezoneSelect.value = 'America/New_York'
  timezoneSelect.dispatchEvent({ type: 'change', target: timezoneSelect })

  timezoneSelect = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-timezone"]',
  )
  times = dom.calendarPreview.querySelector('[data-availability-element="preview-times"]')
  assert.equal(timezoneSelect.value, 'America/New_York')
  assert.equal(times.children[0].textContent, formatSlotTime(start, 'America/New_York'))
  assert.equal(calls.filter((call) => call.method !== 'GET').length, initialWrites)
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    initialReads,
  )
})

function intlWithLocalTimezone(zone) {
  const stub = {
    localZoneReads: 0,
    supportedValuesOf:
      typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf.bind(Intl) : undefined,
    DateTimeFormat: function (locales, options) {
      if (locales === undefined && options === undefined) {
        stub.localZoneReads += 1
        return { resolvedOptions: () => ({ timeZone: zone }) }
      }
      return new Intl.DateTimeFormat(locales, options)
    },
  }
  return stub
}

const STARTER_WITHOUT_TIMEZONE = () => ({
  status: 200,
  body: {
    id: 1,
    availability: {
      items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00' } },
      manager: null,
    },
    nylas_grant_id: 'grant-1',
    nylas_grant_email: 'g@example.com',
    nylas_calendar_id: 'cal-1',
  },
})

const FREE_ONLY_SERVER_STATE = {
  grantId: 'grant-1',
  grantEmail: 'g@example.com',
  calendarId: 'cal-1',
  configs: [
    {
      config_id: 'cfg-free',
      title: 'Free Consultation Call',
      duration: 30,
      is_paid: false,
      active: true,
    },
  ],
}

test('calendar-preview keeps the timezone selector visible when there are no upcoming slots', async () => {
  const { dom } = loadSection({
    serverState: FREE_ONLY_SERVER_STATE,
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({ status: 200, body: { time_slots: [] } }),
    },
  })
  await settle()

  const slotsList = dom.calendarPreview.querySelector(
    '[data-availability-element="slots-list"]',
  )
  assert.equal(slotsList.children[0].textContent, 'No upcoming open slots found.')
  const timezoneSelect = slotsList.querySelector(
    '[data-availability-element="preview-timezone"]',
  )
  assert.ok(timezoneSelect)
  assert.equal(timezoneSelect.value, 'Asia/Manila')
})

test('calendar-preview selector and slot times share one zone when the starter has no saved timezone', async () => {
  const start = futureUtcSlot()
  const { dom } = loadSection({
    intl: intlWithLocalTimezone('America/Los_Angeles'),
    serverState: FREE_ONLY_SERVER_STATE,
    postRoutes: { '/starter/get_by_memberstack/v3': STARTER_WITHOUT_TIMEZONE },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: start }] },
      }),
    },
  })
  await settle()

  const timezoneSelect = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-timezone"]',
  )
  const times = dom.calendarPreview.querySelector('[data-availability-element="preview-times"]')
  assert.equal(timezoneSelect.value, 'America/Los_Angeles')
  assert.equal(times.children[0].textContent, formatSlotTime(start, 'America/Los_Angeles'))
  assert.equal(
    times.children[0].textContent,
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezoneSelect.value,
    }).format(new Date(start * 1000)),
  )
})

test('calendar-preview reuses the timezone selector node and keeps its focus across a change', async () => {
  const start = futureUtcSlot()
  const { dom, document, calls } = loadSection({
    serverState: FREE_ONLY_SERVER_STATE,
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: start }] },
      }),
    },
  })
  await settle()

  const timezoneSelect = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-timezone"]',
  )
  const optionCount = timezoneSelect.children.length
  const firstOption = timezoneSelect.children[0]
  const initialReads = calls.filter((call) => call.path === '/scheduler/get_availability/v3').length
  const initialWrites = calls.filter((call) => call.method !== 'GET').length
  assert.equal(optionCount > 1, true)

  timezoneSelect.focus()
  assert.ok(document.activeElement === timezoneSelect, 'select should be focusable')

  timezoneSelect.value = 'America/New_York'
  timezoneSelect.dispatchEvent({ type: 'change', target: timezoneSelect })

  assert.ok(
    dom.calendarPreview.querySelector('[data-availability-element="preview-timezone"]') ===
      timezoneSelect,
    'timezone change should reuse the same select node',
  )
  assert.equal(timezoneSelect.children.length, optionCount)
  assert.ok(
    timezoneSelect.children[0] === firstOption,
    'timezone change should reuse the same option nodes',
  )
  assert.ok(
    document.activeElement === timezoneSelect,
    'timezone change should leave focus on the select',
  )
  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-times"]').children[0]
      .textContent,
    formatSlotTime(start, 'America/New_York'),
  )
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    initialReads,
  )
  assert.equal(calls.filter((call) => call.method !== 'GET').length, initialWrites)

  const dateButtons = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-dates"]',
  )
  dateButtons.children[0].click()
  assert.ok(
    dom.calendarPreview.querySelector('[data-availability-element="preview-timezone"]') ===
      timezoneSelect,
    'date selection should reuse the same select node',
  )
  assert.equal(timezoneSelect.children.length, optionCount)
})

test('calendar-preview keeps the selected slot and re-expresses it when the timezone changes', async () => {
  const firstSlot = futureUtcSlot()
  const secondSlot = futureUtcSlot(1, 0) + 2 * 24 * 60 * 60
  const manilaDateKey = slotDateKey(secondSlot, 'Asia/Manila')
  const newYorkDateKey = slotDateKey(secondSlot, 'America/New_York')
  const { dom, calls } = loadSection({
    serverState: FREE_ONLY_SERVER_STATE,
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: firstSlot }, { start_time: secondSlot }] },
      }),
    },
  })
  await settle()

  dom.calendarPreview.querySelector(`[data-preview-date="${manilaDateKey}"]`).click()
  dom.calendarPreview.querySelector(`[data-preview-slot-start="${secondSlot}"]`).click()
  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-selection"]').textContent,
    `Selected: ${formatSlotSummary(secondSlot, 'Asia/Manila')}`,
  )

  const initialReads = calls.filter((call) => call.path === '/scheduler/get_availability/v3').length
  const initialWrites = calls.filter((call) => call.method !== 'GET').length
  const timezoneSelect = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-timezone"]',
  )
  timezoneSelect.value = 'America/New_York'
  timezoneSelect.dispatchEvent({ type: 'change', target: timezoneSelect })

  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-selection"]').textContent,
    `Selected: ${formatSlotSummary(secondSlot, 'America/New_York')}`,
  )
  const timesColumn = dom.calendarPreview.querySelector(
    '[data-availability-element="preview-times-column"]',
  )
  assert.equal(timesColumn.children[0].textContent, formatSlotDate(secondSlot, 'America/New_York'))
  const selectedButton = dom.calendarPreview.querySelector(
    `[data-preview-slot-start="${secondSlot}"]`,
  )
  assert.equal(selectedButton.getAttribute('aria-pressed'), 'true')
  assert.equal(selectedButton.textContent, formatSlotTime(secondSlot, 'America/New_York'))
  assert.equal(
    dom.calendarPreview
      .querySelector(`[data-preview-date="${newYorkDateKey}"]`)
      .getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    initialReads,
  )
  assert.equal(calls.filter((call) => call.method !== 'GET').length, initialWrites)
})

test('calendar-preview resolves the browser timezone fallback once, not per rendered slot', async () => {
  const intl = intlWithLocalTimezone('America/Los_Angeles')
  const slots = [0, 1, 2, 3, 4, 5].map((offset) => ({
    start_time: Math.floor(Date.UTC(2026, 8, 2 + offset, 17, 0) / 1000),
  }))
  const { dom } = loadSection({
    intl,
    serverState: FREE_ONLY_SERVER_STATE,
    postRoutes: { '/starter/get_by_memberstack/v3': STARTER_WITHOUT_TIMEZONE },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({ status: 200, body: { time_slots: slots } }),
    },
  })
  await settle()

  assert.equal(
    dom.calendarPreview.querySelector('[data-availability-element="preview-timezone"]').value,
    'America/Los_Angeles',
  )
  assert.equal(intl.localZoneReads, 1)

  dom.calendarPreview.querySelector('[data-preview-date="2026-09-04"]').click()
  assert.equal(intl.localZoneReads, 1)
})

test('calendar-preview selects Free or Paid dates and times without creating a booking', async () => {
  const firstDate = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const secondDate = firstDate + 24 * 60 * 60
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-free',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
        },
        {
          config_id: 'cfg-paid',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 5500,
          currency: 'USD',
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: firstDate }, { start_time: secondDate }] },
      }),
    },
  })
  await settle()
  const writeCountBeforeSelection = calls.filter((call) => call.method !== 'GET').length

  let services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.equal(services.children.length, 2)
  assert.equal(services.children[0].children[1].textContent, '30 minutes · Free')
  assert.equal(services.children[1].children[1].textContent, '60 minutes · $55.00')
  assert.equal(services.children[0].getAttribute('aria-pressed'), 'true')

  let dates = dom.calendarPreview.querySelector('[data-availability-element="preview-dates"]')
  dates.children[1].click()
  dates = dom.calendarPreview.querySelector('[data-availability-element="preview-dates"]')
  assert.equal(dates.children[1].getAttribute('aria-pressed'), 'true')

  let times = dom.calendarPreview.querySelector('[data-availability-element="preview-times"]')
  assert.equal(times.children.length, 1)
  times.children[0].click()
  times = dom.calendarPreview.querySelector('[data-availability-element="preview-times"]')
  assert.equal(times.children[0].getAttribute('aria-pressed'), 'true')
  assert.ok(dom.calendarPreview.querySelector('[data-availability-element="preview-selection"]'))
  assert.equal(
    calls.filter((call) => call.method !== 'GET').length,
    writeCountBeforeSelection,
  )

  services.children[1].click()
  await settle()
  services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.equal(services.children[0].getAttribute('aria-pressed'), 'false')
  assert.equal(services.children[1].getAttribute('aria-pressed'), 'true')

  dates = dom.calendarPreview.querySelector('[data-availability-element="preview-dates"]')
  dates.children[1].click()
  dates = dom.calendarPreview.querySelector('[data-availability-element="preview-dates"]')
  assert.equal(dates.children[1].getAttribute('aria-pressed'), 'true')

  times = dom.calendarPreview.querySelector('[data-availability-element="preview-times"]')
  assert.equal(times.children.length, 1)
  times.children[0].click()
  times = dom.calendarPreview.querySelector('[data-availability-element="preview-times"]')
  assert.equal(times.children[0].getAttribute('aria-pressed'), 'true')
  assert.ok(dom.calendarPreview.querySelector('[data-availability-element="preview-selection"]'))
  assert.equal(
    calls.filter((call) => call.method !== 'GET').length,
    writeCountBeforeSelection,
  )
  assert.deepEqual(
    calls
      .filter((call) => call.path === '/scheduler/get_availability/v3')
      .map((call) => call.query.configuration_id),
    ['cfg-free', 'cfg-paid'],
  )
})

test('calendar-preview renders a canonical active paid service and its live slots', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid',
          grant_id: 'grant-1',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 100,
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  assert.equal(dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'ready')
  const paid = dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid"]')
  assert.ok(paid)
  assert.equal(paid.getAttribute('data-preview-service-type'), 'paid')
  assert.equal(paid.getAttribute('aria-pressed'), 'true')
  assert.equal(paid.children[0].textContent, 'Paid Consultation Call')
  assert.equal(paid.children[1].textContent, '60 minutes · $1.00')
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    1,
  )
})

test('calendar-preview shows free and paid services together', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-free',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
        },
        {
          config_id: 'cfg-paid',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 15000,
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  const services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.equal(services.children.length, 2)
  assert.equal(services.children[0].getAttribute('data-preview-service-type'), 'free')
  assert.equal(services.children[0].children[1].textContent, '30 minutes · Free')
  assert.equal(services.children[1].getAttribute('data-preview-service-type'), 'paid')
  assert.equal(services.children[1].children[1].textContent, '60 minutes · $150.00')
})

test('calendar-preview keeps Free before Paid when Xano returns the paid record first', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 15000,
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
        {
          config_id: 'cfg-free',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  const services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.deepEqual(
    services.children.map((child) => child.getAttribute('data-preview-config-id')),
    ['cfg-free', 'cfg-paid'],
  )
  assert.equal(services.children[0].getAttribute('aria-pressed'), 'true')
  assert.equal(services.children[1].getAttribute('aria-pressed'), 'false')
  const availability = calls.filter((call) => call.path === '/scheduler/get_availability/v3')
  assert.equal(availability.length, 1)
  assert.equal(availability[0].query.configuration_id, 'cfg-free')
})

test('calendar-preview orders duplicate services deterministically by config id', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const paid = (configId) => ({
    config_id: configId,
    title: 'Paid Consultation Call',
    duration: 60,
    price_cents: 15000,
    is_paid: true,
    active: true,
    sync_status: 'ready',
  })
  const free = (configId) => ({
    config_id: configId,
    title: 'Free Consultation Call',
    duration: 30,
    is_paid: false,
    active: true,
  })
  const slotRoutes = {
    '/scheduler/get_availability/v3': () => ({
      status: 200,
      body: { time_slots: [{ start_time: future }] },
    }),
  }
  const order = (configs) =>
    loadSection({
      serverState: { grantId: 'grant-1', grantEmail: 'g@example.com', calendarId: 'cal-1', configs },
      getRoutes: slotRoutes,
    })

  const forward = order([paid('cfg-paid-b'), free('cfg-free-b'), paid('cfg-paid-a'), free('cfg-free-a')])
  const reversed = order([free('cfg-free-a'), paid('cfg-paid-a'), free('cfg-free-b'), paid('cfg-paid-b')])
  await settle()

  const ids = (result) =>
    result.dom.calendarPreview
      .querySelector('[data-availability-element="preview-services"]')
      .children.map((child) => child.getAttribute('data-preview-config-id'))
  const expected = ['cfg-free-a', 'cfg-free-b', 'cfg-paid-a', 'cfg-paid-b']
  assert.deepEqual(ids(forward), expected)
  assert.deepEqual(ids(reversed), expected)
})

test('calendar-preview renders a free service that carries no stored duration', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-free-no-duration',
          title: 'Free Consultation Call',
          is_paid: false,
          active: true,
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  assert.equal(dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'ready')
  const service = dom.calendarPreview.querySelector('[data-preview-config-id="cfg-free-no-duration"]')
  assert.ok(service)
  assert.equal(service.getAttribute('data-preview-service-type'), 'free')
  assert.equal(service.children[1].textContent, '30 minutes · Free')
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    1,
  )
})

test('calendar-preview admits environment stamps that differ only by case or padding', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-free-cased',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
          data_environment: ' Production ',
        },
        {
          config_id: 'cfg-paid-cased',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 15000,
          currency: 'USD',
          is_paid: true,
          active: true,
          data_environment: 'PRODUCTION',
          payment_environment: 'Live',
          sync_status: 'ready',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  const services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.ok(services)
  assert.deepEqual(
    services.children.map((child) => child.getAttribute('data-preview-config-id')),
    ['cfg-free-cased', 'cfg-paid-cased'],
  )
})

test('a free configuration stamped for another environment does not block canonical creation', async () => {
  let canonicalState = null
  const intentKey = 'starter-scheduling-oauth-intent:member-a'
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const result = loadSection({
    search: '?success=true&grant_id=hosted-grant-9&state=member-a',
    localStorage: {
      [intentKey]: JSON.stringify({
        createdAt: Date.now(),
        redirectUri: 'https://thestarters.com/starter-dashboard',
        paidCallIntent: null,
      }),
    },
    serverState: {
      configs: [
        {
          config_id: 'cfg-free-test-stamped',
          grant_id: 'hosted-grant-9',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
          data_environment: 'test',
        },
      ],
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: null,
      },
    },
    postRoutes: {
      '/grants/add/v3': () => {
        canonicalState.grantId = 'hosted-grant-9'
        canonicalState.grantEmail = 'jp@hirethestarters.com'
        canonicalState.calendarId = 'primary'
        return { status: 200, body: { grant_id: 'hosted-grant-9' } }
      },
      '/scheduler/configurations/create/v3': () => {
        canonicalState.configs.push({
          config_id: 'cfg-free-production',
          grant_id: 'hosted-grant-9',
          title: 'Free Consultation Call',
          duration: 30,
          is_paid: false,
          active: true,
          data_environment: 'production',
        })
        return { status: 200, body: { response: { status: 200 } } }
      },
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  canonicalState = result.state
  await settle()

  assert.equal(
    result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length,
    1,
  )
  const services = result.dom.calendarPreview.querySelector(
    '[data-availability-element="preview-services"]',
  )
  assert.ok(services)
  assert.deepEqual(
    services.children.map((child) => child.getAttribute('data-preview-config-id')),
    ['cfg-free-production'],
  )
})

test('calendar-preview excludes paid services that are below $1 or failed provider sync', async () => {
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid-too-low',
          duration: 60,
          price_cents: 99,
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
        {
          config_id: 'cfg-paid-failed',
          duration: 60,
          price_cents: 100,
          is_paid: true,
          active: true,
          sync_status: 'failed',
        },
      ],
    },
  })
  await settle()

  assert.equal(dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'empty')
  assert.equal(dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid-too-low"]'), null)
  assert.equal(dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid-failed"]'), null)
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    0,
  )
})

test('calendar-preview excludes a paid service that is not stored at the canonical 60 minutes', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid-legacy',
          title: 'Legacy Paid Call',
          duration: 15,
          price_cents: 500,
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
        {
          config_id: 'cfg-paid-no-duration',
          title: 'Paid Call Without Duration',
          price_cents: 500,
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  assert.equal(dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'empty')
  assert.equal(dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid-legacy"]'), null)
  assert.equal(
    dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid-no-duration"]'),
    null,
  )
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    0,
  )
})

test('calendar-preview renders only the canonical USD paid service', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid-eur',
          title: 'Euro Paid Call',
          duration: 60,
          price_cents: 15000,
          currency: 'eur',
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
        {
          config_id: 'cfg-paid-usd',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 15000,
          currency: 'usd',
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  const services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.ok(services)
  assert.equal(services.children.length, 1)
  assert.equal(services.children[0].getAttribute('data-preview-config-id'), 'cfg-paid-usd')
  assert.equal(services.children[0].children[1].textContent, '60 minutes · $150.00')
})

test('calendar-preview excludes configurations stamped for another environment', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const environmentConfigs = [
    {
      config_id: 'cfg-free-test-data',
      title: 'Free Consultation Call (test)',
      duration: 30,
      is_paid: false,
      active: true,
      data_environment: 'test',
    },
    {
      config_id: 'cfg-free-live-data',
      title: 'Free Consultation Call',
      duration: 30,
      is_paid: false,
      active: true,
      data_environment: 'production',
    },
    {
      config_id: 'cfg-paid-mixed-payment',
      title: 'Paid Consultation Call (mixed)',
      duration: 60,
      price_cents: 15000,
      currency: 'USD',
      is_paid: true,
      active: true,
      data_environment: 'production',
      payment_environment: 'test',
      sync_status: 'ready',
    },
    {
      config_id: 'cfg-paid-test',
      title: 'Paid Consultation Call (test)',
      duration: 60,
      price_cents: 15000,
      currency: 'USD',
      is_paid: true,
      active: true,
      data_environment: 'test',
      payment_environment: 'test',
      sync_status: 'ready',
    },
    {
      config_id: 'cfg-paid-live',
      title: 'Paid Consultation Call',
      duration: 60,
      price_cents: 15000,
      currency: 'USD',
      is_paid: true,
      active: true,
      data_environment: 'production',
      payment_environment: 'live',
      sync_status: 'ready',
    },
  ]
  const slotRoutes = {
    '/scheduler/get_availability/v3': () => ({
      status: 200,
      body: { time_slots: [{ start_time: future }] },
    }),
  }
  const production = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: environmentConfigs,
    },
    getRoutes: slotRoutes,
  })
  await settle()

  const services = production.dom.calendarPreview.querySelector(
    '[data-availability-element="preview-services"]',
  )
  assert.ok(services)
  assert.deepEqual(
    services.children.map((child) => child.getAttribute('data-preview-config-id')),
    ['cfg-free-live-data', 'cfg-paid-live'],
  )

  const staging = loadSection({
    hostname: 'the-starters-3-0.webflow.io',
    origin: 'https://the-starters-3-0.webflow.io',
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: environmentConfigs,
    },
    getRoutes: slotRoutes,
  })
  await settle()

  const stagingServices = staging.dom.calendarPreview.querySelector(
    '[data-availability-element="preview-services"]',
  )
  assert.ok(stagingServices)
  assert.deepEqual(
    stagingServices.children.map((child) => child.getAttribute('data-preview-config-id')),
    ['cfg-free-test-data', 'cfg-paid-test'],
  )
})

test('calendar-preview reads the provider sync state without hiding a ready paid service', async () => {
  const future = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const { dom } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid-ready-cased',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 15000,
          is_paid: true,
          active: true,
          sync_status: 'READY',
        },
        {
          config_id: 'cfg-paid-not-synced',
          title: 'Unsynced Paid Call',
          duration: 60,
          price_cents: 15000,
          is_paid: true,
          active: true,
          sync_status: false,
        },
        {
          config_id: 'cfg-paid-pending',
          title: 'Pending Paid Call',
          duration: 60,
          price_cents: 15000,
          is_paid: true,
          active: true,
          sync_status: 'pending',
        },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({
        status: 200,
        body: { time_slots: [{ start_time: future }] },
      }),
    },
  })
  await settle()

  const services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.ok(services)
  assert.deepEqual(
    services.children.map((child) => child.getAttribute('data-preview-config-id')),
    ['cfg-paid-ready-cased'],
  )
})

test('calendar-preview excludes a paid service whose active state is not declared', async () => {
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        {
          config_id: 'cfg-paid-unknown-active',
          title: 'Paid Consultation Call',
          duration: 60,
          price_cents: 15000,
          is_paid: true,
          sync_status: 'ready',
        },
      ],
    },
  })
  await settle()

  assert.equal(dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'empty')
  assert.equal(
    dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid-unknown-active"]'),
    null,
  )
  assert.equal(
    calls.filter((call) => call.path === '/scheduler/get_availability/v3').length,
    0,
  )
})

test('calendar-preview ignores an older slot response after the selected service changes', async () => {
  const pending = []
  const slotA = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60
  const slotB = Math.floor(Date.now() / 1000) + 4 * 24 * 60 * 60
  const { dom } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        { config_id: 'cfg-a', title: 'Free A', duration: 30, is_paid: false, active: true },
        { config_id: 'cfg-b', title: 'Free B', duration: 45, is_paid: false, active: true },
      ],
    },
    getRoutes: {
      '/scheduler/get_availability/v3': (query) => new Promise((resolve) => {
        pending.push({ configId: query.configuration_id, resolve })
      }),
    },
  })
  await settle(5)

  const services = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.ok(services)
  assert.equal(pending.length, 1)
  services.children[1].click()
  await settle(5)
  assert.equal(pending.length, 2)

  pending.find((request) => request.configId === 'cfg-b').resolve({
    status: 200,
    body: { time_slots: [{ start_time: slotB }] },
  })
  await settle(5)
  pending.find((request) => request.configId === 'cfg-a').resolve({
    status: 200,
    body: { time_slots: [{ start_time: slotA }] },
  })
  await settle(5)

  const expected = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  }).format(new Date(slotB * 1000))
  const currentList = dom.calendarPreview.querySelector('[data-availability-element="slots-list"]')
  assert.ok(currentList)
  const currentTimes = currentList.querySelector('[data-availability-element="preview-times"]')
  assert.ok(currentTimes)
  assert.equal(currentTimes.children.length, 1)
  assert.equal(currentTimes.children[0].textContent, new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  }).format(new Date(slotB * 1000)))
  assert.ok(expected)
  assert.equal(services.children[1].getAttribute('aria-pressed'), 'false') // stale DOM was replaced
  const currentServices = dom.calendarPreview.querySelector('[data-availability-element="preview-services"]')
  assert.equal(currentServices.children[1].getAttribute('aria-pressed'), 'true')
})

test('removing an item waits for the response before refreshing slots (not fired concurrently)', async () => {
  const { dom } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      availability: {
        items: {
          general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] },
          override1: { days: [4], start: '10:00', end: '11:00' },
        },
        manager: 'calendar',
      },
    },
  })
  await settle()

  const slotsList = dom.slotsWrapper.querySelector('[data-availability-element="slots-list"]')
  assert.ok(slotsList)
  assert.notEqual(slotsList.style.display, 'none')
  assert.equal(dom.loadingSlots.style.display, 'none')

  const overrideCard = dom.list.children.find((el) => el.dataset.id === 'override1')
  const removeBtn = overrideCard.children[0].children[2].children[1]
  removeBtn.click() // open-item-remove -> opens the confirm modal, no request yet
  dom.notif.itemRemoveBtn.click() // confirm -> the actual removal request

  // renderSlotsPreview is chained onto the remove request's own promise, not
  // fired alongside it — so nothing here changes until that request lands.
  assert.notEqual(slotsList.style.display, 'none')
  assert.equal(dom.loadingSlots.style.display, 'none')

  await settle()

  assert.equal(dom.loadingSlots.style.display, 'none')
  const refreshedSlotsList = dom.slotsWrapper.querySelector('[data-availability-element="slots-list"]')
  assert.ok(refreshedSlotsList)
  assert.notEqual(refreshedSlotsList.style.display, 'none')
})

test('open-item-remove updates all active configurations without replacing paid fields', async () => {
  const { dom, calls, state } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [
        { config_id: 'cfg-free', duration: 30, is_paid: false, active: true },
      ],
      availability: {
        items: {
          general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] },
          override1: { days: [4], start: '10:00', end: '11:00' },
        },
        manager: null,
      },
    },
  })
  await settle()
  state.configs.push({ config_id: 'cfg-paid', duration: 60, is_paid: true, active: true })

  const overrideCard = dom.list.children.find((el) => el.dataset.id === 'override1')
  const removeBtn = overrideCard.children[0].children[2].children[1]

  removeBtn.click()

  // Opens on the confirm step only — no removal has happened yet.
  assert.equal(dom.notif.steps['availability-remove-approve'].style.display, '')
  assert.equal(dom.notif.steps['availability-removed'].style.display, 'none')
  assert.ok(dom.list.children.find((el) => el.dataset.id === 'override1'))

  const group = dom.notif.itemRemoveBtn.closest('.call-sched_button-group')
  assert.notEqual(group.style.pointerEvents, 'none')

  dom.notif.itemRemoveBtn.click() // confirm -> the actual removal request

  assert.equal(group.style.pointerEvents, 'none')
  assert.equal(group.style.opacity, '0.6')

  await settle()

  // Removal succeeded — override1 is gone, and the modal switched to the
  // success step with its buttons re-enabled.
  const stillThere = dom.list.children.find((el) => el.dataset.id === 'override1')
  assert.equal(stillThere, undefined)
  assert.equal(dom.notif.steps['availability-removed'].style.display, '')
  assert.notEqual(group.style.pointerEvents, 'none')

  const configUpdates = calls.filter((call) => call.path === '/scheduler/configurations/update/v3')
  assert.deepEqual(configUpdates.map((call) => call.body.config_id), ['cfg-free', 'cfg-paid'])
  assert.deepEqual(configUpdates.map((call) => call.body.in_availability.duration_minutes), [30, 60])
  configUpdates.forEach((call) => {
    assert.equal(call.body.in_config_name, undefined)
    assert.equal(call.body.in_event_booking, undefined)
    assert.equal(call.body.in_scheduler, undefined)
  })
})

test('open-item-remove switches to the error step on failure without removing the card', async () => {
  const { dom, warnings } = loadSection({
    serverState: {
      availability: {
        items: {
          general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] },
          override1: { days: [4], start: '10:00', end: '11:00' },
        },
        manager: null,
      },
    },
    postRoutes: {
      '/starter/update_availability/v3': () => ({ status: 500, body: null }),
    },
  })
  await settle()

  const overrideCard = dom.list.children.find((el) => el.dataset.id === 'override1')
  const removeBtn = overrideCard.children[0].children[2].children[1]

  removeBtn.click()
  dom.notif.itemRemoveBtn.click()

  await settle()

  assert.equal(dom.notif.steps['request-error'].style.display, '')
  assert.ok(dom.notif.errorText.textContent.length > 0)
  assert.equal(dom.notif.itemRemoveBtn.closest('.call-sched_button-group').style.pointerEvents, '')
  assert.ok(dom.list.children.find((el) => el.dataset.id === 'override1'), 'override1 was not removed')
  assert.ok(warnings.some((w) => w.includes('availability remove failed')))
})

test('opening or closing the item form does not touch the slots preview', async () => {
  const { dom } = loadSection({
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

  const slotsList = dom.slotsWrapper.querySelector('[data-availability-element="slots-list"]')
  assert.ok(slotsList)
  assert.notEqual(slotsList.style.display, 'none')
  assert.equal(dom.loadingSlots.style.display, 'none')

  const generalCard = dom.list.children.find((el) => el.dataset.id === 'general')
  const editBtn = generalCard.children[0].children[2].children[0]
  editBtn.click() // open
  await settle()
  editBtn.click() // close
  await settle()

  assert.notEqual(slotsList.style.display, 'none')
  assert.equal(dom.loadingSlots.style.display, 'none')
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
