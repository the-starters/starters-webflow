const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./scheduling-availability-section.js'), 'utf8')
const WRITER_SOURCE = fs.readFileSync(require.resolve('./scheduling-availability-writer.js'), 'utf8')
const API_BASE = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd'
const DAY_VARIANT_DEFAULT = 'w-variant-89402c65-e26d-c236-91e7-76e9135a2d42'
const DAY_VARIANT_SELECTED = 'w-variant-30a4a9ed-8474-d414-9314-498a5fe53866'
const ACTIVE_CALLS_COPY =
  'Resolve pending and upcoming calls before disconnecting the calendar. You can still edit settings or switch calendars.'
const DISCONNECT_GOOGLE_GENERIC_COPY =
  "We couldn't disconnect your Google calendar. Please try again or contact support."
const PAID_CALL_RATE_COPY =
  'Your paid call rate must be a whole-dollar amount from $1 to $1,000. Update it in Call Settings, then try again.'

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
      calendarBindingVersion: null,
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
        calendar_binding_version: state.calendarBindingVersion,
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
      state.availability = { items: {}, ...state.availability, manager: 'platform' }
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

function connectionOnlySection(initial = {}) {
  const result = loadSection({
    serverState: { configs: [], ...initial },
    postRoutes: {
      '/grants/create_virtual_calendar/v3': (body) => {
        assert.equal(body.grant_id, result.state.grantId)
        result.state.calendarId = result.state.calendarId || 'vcal-1'
        result.state.availability = { items: {}, ...result.state.availability, manager: 'platform' }
        return { status: 200, body: { response: { status: 200, result: { data: { id: result.state.calendarId } } } } }
      },
      '/starter/update_availability/v3': (body) => {
        if (body.availability.manager !== result.state.availability.manager) {
          return { status: 400, body: { message: 'Use the calendar switch action to select a different manager' } }
        }
        result.state.availability = body.availability
        return { status: 200, body: { id: 1 } }
      },
      '/scheduler/configurations/create/v3': () => {
        throw new Error('Connection must not manufacture a Free offer')
      },
    },
  })
  return result
}

test('connection-only initial Platform setup leaves both offers OFF and reloads connected', async () => {
  const first = connectionOnlySection({ availability: { items: {}, manager: null } })
  await settle()
  first.dom.connectBtnWrapper.children[0].click()
  await settle()
  assert.equal(first.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.deepEqual(first.state.configs, [])
  assert.equal(first.calls.filter(c => c.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(first.calls.filter(c => c.path === '/grants/create_virtual_account/v3').length, 1)
  const reloaded = connectionOnlySection(first.state)
  await settle()
  assert.equal(reloaded.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(reloaded.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, null)
  assert.equal(reloaded.calls.filter(c => /create|add_virtual|delete|upsert/.test(c.path)).length, 0)
})

for (const calendarId of [null, 'existing-calendar']) {
  test(`connection-only Platform resume keeps the existing grant and ${calendarId || 'missing calendar'} without duplicate creation`, async () => {
    const result = connectionOnlySection({ grantId: 'existing-grant', grantEmail: 'member-a', calendarId })
    await settle()
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'reconnect')
    result.dom.connectBtnWrapper.children[0].click()
    await settle()
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
    assert.equal(result.state.grantId, 'existing-grant')
    assert.equal(result.state.calendarId, calendarId || 'vcal-1')
    assert.equal(result.calls.filter(c => c.path === '/grants/create_virtual_calendar/v3').length, 1)
    assert.equal(result.calls.filter(c => /create_virtual_account|add_virtual|grants\/delete|configurations\/create/.test(c.path)).length, 0)
    result.dom.connectBtnWrapper.children[0].click()
    await settle()
    assert.equal(result.calls.filter(c => c.path === '/grants/create_virtual_calendar/v3').length, 1)
  })
}

test('connection-only resume remains an error until canonical manager finalization is verified', async () => {
  const result = loadSection({
    serverState: { grantId: 'existing-grant', grantEmail: 'member-a', calendarId: 'existing-calendar', configs: [] },
    postRoutes: {
      '/grants/create_virtual_calendar/v3': () => ({ status: 200, body: { response: { result: { data: { id: 'existing-calendar' } } } } }),
    },
  })
  await settle()
  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(result.dom.notif.steps['request-error'].style.display, '')
  assert.equal(result.calls.filter(c => /create_virtual_account|add_virtual|grants\/delete|configurations\/create|update_availability/.test(c.path)).length, 0)
})

test('connection-only availability save with no offers does not create a Free fallback', async () => {
  const result = connectionOnlySection({ grantId: 'existing-grant', grantEmail: 'member-a', calendarId: 'existing-calendar', availability: { items: { general: { days: [1], defaultDays: [1], start: '09:00', end: '17:00' } }, manager: 'platform' } })
  await settle()
  const card = result.dom.list.children.find(el => el.dataset.id === 'general')
  card.children[0].children[2].children[0].click()
  card.children[2].children[0].children[1].children[1].click()
  await settle()
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.dom.notif.steps['availability-saved'].style.display, '')
  assert.equal(result.calls.filter(c => /configurations\/(create|update)/.test(c.path)).length, 0)
})

for (const syncStatus of [null, '']) {
  for (const includeActivatedServices of [false, true]) {
    test(`connection-only hours save preserves ${JSON.stringify(syncStatus)}-sync placeholders with activated services ${includeActivatedServices}`, async () => {
      const placeholder = { config_id: 'pending-free', grant_id: 'existing-grant', duration: 30,
        active: true, is_paid: false, revision: syncStatus === null ? 1 : '1', sync_status: syncStatus }
      const activated = includeActivatedServices ? [
        { config_id: 'ready-free', grant_id: 'existing-grant', duration: 30,
          active: true, is_paid: false, revision: 2, sync_status: 'ready' },
        { config_id: 'ready-paid', grant_id: 'existing-grant', duration: 60, price_cents: 100,
          active: true, is_paid: true, revision: 1, sync_status: null },
      ] : []
      const expectedPlaceholder = { ...placeholder }
      const result = loadSection({
        serverState: {
          grantId: 'existing-grant', grantEmail: 'member-a', calendarId: 'existing-calendar',
          availability: { items: { general: { days: [1], defaultDays: [1], start: '09:00', end: '17:00' } }, manager: 'platform' },
          configs: [placeholder, ...activated],
        },
        postRoutes: {
          '/scheduler/configurations/update/v3': (body) => {
            const config = result.state.configs.find((item) => item.config_id === body.config_id)
            config.revision = Number(config.revision) + 1
            config.sync_status = 'ready'
            return { status: 200, body: { response: { status: 200 } } }
          },
        },
      })
      await settle()
      const card = result.dom.list.children.find((el) => el.dataset.id === 'general')
      card.children[0].children[2].children[0].click()
      const form = card.querySelector('[data-availability-element="availability-form"]')
      form.querySelector('[name=start-time]').value = '10:00'
      form.querySelector('[name=end-time]').value = '16:00'
      card.children[2].children[0].children[1].children[1].click()
      await settle()

      assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 1)
      assert.equal(result.state.availability.items.general.start, '10:00')
      assert.equal(result.state.availability.items.general.end, '16:00')
      assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
      assert.equal(result.dom.notif.steps['availability-saved'].style.display, '')
      const configUpdates = result.calls.filter((call) => call.path === '/scheduler/configurations/update/v3')
      assert.deepEqual(configUpdates.map((call) => call.body.config_id), activated.map((config) => config.config_id))
      assert.deepEqual(result.state.configs[0], expectedPlaceholder)
      for (const call of configUpdates) {
        assert.equal(call.body.in_availability.availability_rules.default_open_hours[0].start, '10:00')
        assert.equal(call.body.in_availability.availability_rules.default_open_hours[0].end, '16:00')
      }
      assert.equal(result.calls.filter((call) => /configurations\/create|settings\/upsert/.test(call.path)).length, 0)
    })
  }
}

for (const syncStatus of [null, '']) {
  test(`connection-only null-availability resume preserves the ${JSON.stringify(syncStatus)}-sync Free placeholder without previewing it`, async () => {
    const placeholder = { config_id: 'existing-placeholder', grant_id: 'existing-grant', duration: 30,
      active: true, is_paid: false, revision: syncStatus === null ? 1 : '1', sync_status: syncStatus }
    const result = connectionOnlySection({ grantId: 'existing-grant', grantEmail: 'member-a',
      calendarId: 'existing-calendar', availability: null, configs: [placeholder] })
    await settle()
    assert.equal(result.document.documentElement.getAttribute('data-scheduling-availability-section'), 'ready')
    assert.equal(result.dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'empty')
    assert.equal(result.calls.filter(c => c.path === '/scheduler/get_availability/v3').length, 0)
    result.dom.connectBtnWrapper.children[0].click()
    await settle()
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
    assert.equal(result.state.grantId, 'existing-grant')
    assert.equal(result.state.calendarId, 'existing-calendar')
    assert.deepEqual(result.state.configs, [placeholder])
    assert.equal(result.dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'empty')
    assert.equal(result.dom.calendarPreview.querySelector('[data-preview-config-id="existing-placeholder"]'), null)
    assert.equal(result.calls.filter(c => c.path === '/scheduler/get_availability/v3').length, 0)
    assert.equal(result.calls.filter(c => /create_virtual_account|add_virtual|grants\/delete|configurations\/(create|update)|settings\/upsert/.test(c.path)).length, 0)

    const reloaded = connectionOnlySection(result.state)
    await settle()
    assert.equal(reloaded.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
    assert.deepEqual(reloaded.state.configs, [placeholder])
    assert.equal(reloaded.dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'empty')
    assert.equal(reloaded.calls.filter(c => c.path === '/scheduler/get_availability/v3').length, 0)
    assert.equal(reloaded.calls.filter(c => /create|add_virtual|delete|upsert/.test(c.path)).length, 0)
  })
}

test('connection-only reload previews the existing Free service after canonical activation', async () => {
  const service = { config_id: 'existing-placeholder', grant_id: 'existing-grant', duration: 30,
    active: true, is_paid: false, revision: 2, sync_status: 'ready' }
  const result = connectionOnlySection({ grantId: 'existing-grant', grantEmail: 'member-a',
    calendarId: 'existing-calendar', availability: { items: {}, manager: 'platform' }, configs: [service] })
  await settle()
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'ready')
  assert.equal(result.dom.calendarPreview.querySelector('[data-preview-config-id="existing-placeholder"]').getAttribute('data-preview-service-type'), 'free')
  assert.deepEqual(result.calls.filter(c => c.path === '/scheduler/get_availability/v3').map(c => c.query.configuration_id), ['existing-placeholder'])
  assert.deepEqual(result.state.configs, [service])
  assert.equal(result.calls.filter(c => /create|add_virtual|delete|upsert/.test(c.path)).length, 0)
})

test('connection-only Paid-only resume preserves the service without manufacturing Free', async () => {
  const paid = { config_id: 'existing-paid', grant_id: 'existing-grant', duration: 60,
    title: 'Existing Paid', price_cents: 100, active: true, is_paid: true, sync_status: 'ready' }
  const result = connectionOnlySection({ grantId: 'existing-grant', grantEmail: 'member-a',
    calendarId: 'existing-calendar', configs: [paid], paidService: paid })
  await settle()
  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.deepEqual(result.state.configs, [paid])
  assert.deepEqual(result.state.paidService, paid)
  assert.equal(result.dom.calendarPreview.getAttribute('data-scheduling-preview-state'), 'ready')
  assert.equal(result.dom.calendarPreview.querySelector('[data-preview-service-type="free"]'), null)
  assert.ok(result.dom.calendarPreview.querySelector('[data-preview-config-id="existing-paid"]'))
  assert.ok(result.calls.some(c => c.path === '/scheduler/get_availability/v3' && c.query.configuration_id === 'existing-paid'))
  assert.equal(result.calls.filter(c => /configurations\/(create|update)|settings\/upsert|grants\/delete/.test(c.path)).length, 0)
})

test('connection-only mismatched canonical finalization never publishes a connected state', async () => {
  const result = loadSection({
    serverState: { grantId: 'existing-grant', grantEmail: 'member-a', calendarId: 'existing-calendar', configs: [] },
    postRoutes: {
      '/grants/create_virtual_calendar/v3': () => {
        result.state.grantId = 'different-grant'
        result.state.availability = { ...result.state.availability, manager: 'platform' }
        return { status: 200, body: { response: { result: { data: { id: 'existing-calendar' } } } } }
      },
    },
  })
  await settle()
  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(connectionStates(result.events).includes('connected'), false)
})

test('connection-only bootstrap connects the grantless empty-array projection without creating offers', async () => {
  const result = connectionOnlySection({ availability: [], grantId: '', grantEmail: '', calendarId: '' })
  await settle()
  assert.equal(result.document.documentElement.getAttribute('data-scheduling-availability-section'), 'ready')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'disconnected')
  assert.equal(JSON.stringify(result.window.STARTER_AVAILABILITY), JSON.stringify({ items: {}, manager: null }))
  assert.equal(result.calls.filter(c => /create|add_virtual|delete|upsert|update_availability/.test(c.path)).length, 0)
  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.state.availability.manager, 'platform')
  assert.deepEqual(result.state.configs, [])
  assert.equal(result.calls.filter(c => c.path === '/grants/create_virtual_account/v3').length, 1)
  assert.equal(result.calls.filter(c => c.path === '/grants/create_virtual_calendar/v3').length, 1)
  assert.equal(result.calls.filter(c => /configurations\/create|settings\/upsert|grants\/delete/.test(c.path)).length, 0)
})

for (const state of [
  { availability: [], grantId: 'existing-grant' },
  { availability: [], calendarId: 'existing-calendar' },
  { availability: [], grantId: 'existing-grant', grantEmail: 'member-a', calendarId: 'existing-calendar' },
  { availability: [{ days: [1], start: '09:00', end: '17:00' }] },
]) {
  test(`connection-only bootstrap rejects malformed array projection ${JSON.stringify(state)}`, async () => {
    const result = connectionOnlySection(state)
    await settle()
    assert.equal(result.document.documentElement.getAttribute('data-scheduling-availability-section'), 'error')
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
    result.dom.connectBtnWrapper.children[0].click()
    await settle()
    assert.equal(result.calls.filter(c => /create|add_virtual|delete|upsert|update_availability/.test(c.path)).length, 0)
    assert.ok(result.warnings.some(message => message.includes('Canonical scheduling reader returned invalid availability')))
  })
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
  const productionQuery = production.calls.filter(
    (call) => call.path === '/scheduler/get_availability/v3',
  ).at(-1).query
  assert.ok(Number(productionQuery.start_time) >= productionNow + 24 * 60 * 60)
  assert.ok(Number(productionQuery.start_time) <= Math.floor(Date.now() / 1000) + 24 * 60 * 60)
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

test('initial connection refresh publishes one loading state and one final state', async () => {
  const { events } = loadSection()
  await settle()

  const states = events
    .filter((event) => event.type === 'starterSchedulingConnectionStateChanged')
    .map((event) => event.detail.state)
  assert.deepEqual(states, ['loading', 'disconnected'])
})

test('boots into disconnected state: only Connect Platform visible', async () => {
  const { dom, window } = loadSection()
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'disconnected')
  assert.equal(dom.connectInfoWrapper.style.display, '')
  assert.notEqual(dom.connectBtnWrapper.children[0].style.display, 'none') // connect-platform
  assert.equal(dom.connectBtnWrapper.children[1].style.display, 'none') // Google waits for Platform
  assert.equal(dom.connectBtnWrapper.children[2].style.display, 'none') // disconnect-google
})

test('connection pills and actions follow the independent Nylas and Google state matrix', async () => {
  const cases = [
    {
      name: 'no Nylas grant',
      serverState: {},
      labels: [true, false, true, false],
      actions: [true, false, false],
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
      actions: [true, false, true],
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
      actions: [true, false, false],
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

  assert.equal(calls.filter(c => c.path === '/scheduler/configurations/create/v3').length, 0)
})

test('staging connection keeps the preview notice and creates no offer', async () => {
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
  assert.equal(configCall, undefined)
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
})

test('opening the availability preview never rewrites existing provider configurations', async () => {
  const now = Math.floor(Date.now() / 1000)
  const { calls, dom } = loadSection({
    serverState: {
      grantId: 'grant-1', grantEmail: 'starter@example.com', calendarId: 'primary',
      configs: [{ config_id: 'cfg-free-existing', grant_id: 'grant-1', duration: 30,
        is_paid: false, active: true, data_environment: 'production' }],
    },
    postRoutes: {
      '/scheduler/configurations/update/v3': () => ({ status: 503, body: {} }),
    },
    getRoutes: {
      '/scheduler/get_availability/v3': () => ({ status: 200,
        body: { time_slots: [{ start_time: now + 25 * 60 * 60 }] } }),
    },
  })
  await settle()
  assert.equal(calls.filter((call) => call.path === '/scheduler/configurations/update/v3').length, 0)
  const slotsList = dom.calendarPreview.querySelector('[data-availability-element="slots-list"]')
  assert.equal(slotsList.querySelector('[data-availability-element="preview-times"]').children.length, 1)
})

test('initial connection ignores an unavailable legacy offer-creation endpoint', async () => {
  const { dom } = loadSection({
    serverState: { availability: { items: {}, manager: null } },
    postRoutes: {
      '/scheduler/configurations/create/v3': () => ({
        status: 200,
        body: { response: { status: 503 } },
      }),
    },
  })
  await settle()

  dom.connectBtnWrapper.children[0].click()
  await settle()

  assert.equal(dom.notif.steps['virtual-connected'].style.display, '')
  assert.equal(dom.notif.steps['request-error'].style.display, 'none')
})

test('a disconnected member cannot reach Google OAuth: a stale Connect Google click is ignored', async () => {
  const { dom, calls, assigned } = loadSection({ serverState: { availability: null } })
  await settle()

  assert.equal(dom.connectBtnWrapper.children[1].style.display, 'none')
  dom.connectBtnWrapper.children[1].click() // hidden, programmatic click
  dom.notif.oauthRedirectBtn.click()
  await settle()

  assert.equal(dom.notif.steps['pre-oauth'].style.display, 'none')
  assert.equal(dom.notif.steps['switch-calendar'].style.display, 'none')
  assert.equal(dom.notif.steps['oauth-redirect'].style.display, 'none')
  assert.equal(dom.notif.steps['request-error'].style.display, 'none')
  assert.equal(calls.filter((c) => c.path === '/grants/delete/v3').length, 0)
  assert.equal(calls.filter((c) => c.path === '/grants/oauth/v3').length, 0)
  assert.equal(assigned.length, 0)
})

test('a brand-new member connects Platform first, then Connect Google reaches OAuth', async () => {
  const { dom, calls, assigned, window } = loadSection({ serverState: { availability: null } })
  await settle()

  dom.connectBtnWrapper.children[0].click() // connect-platform
  await settle()
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.notEqual(dom.connectBtnWrapper.children[1].style.display, 'none') // Google now offered

  dom.connectBtnWrapper.children[1].click() // open-connect-google -> informational step
  assert.equal(dom.notif.steps['pre-oauth'].style.display, '')
  assert.equal(dom.notif.steps['switch-calendar'].style.display, 'none')
  dom.notif.oauthRedirectBtn.click() // "Done"
  await settle()

  assert.equal(calls.filter((c) => c.path === '/grants/delete/v3').length, 0)
  assert.equal(calls.filter((c) => c.path === '/grants/oauth/v3').length, 1)
  assert.equal(assigned.length, 1)
  assert.ok(assigned[0].includes('nylas.example/oauth'))
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
  assert.equal(dom.connectBtnWrapper.children[0].style.display, '') // switch future bookings to Platform
  assert.equal(dom.connectBtnWrapper.children[0].textContent, 'Use Platform Calendar')
  assert.equal(dom.connectBtnWrapper.children[1].style.display, 'none') // already on Google
  assert.equal(dom.connectBtnWrapper.children[2].style.display, '') // disconnect-google visible
})

test('boots connected for a versioned binding with no active offers', async () => {
  const { window } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [],
      calendarBindingVersion: 1,
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
})

test('versioned zero-offer binding without a grant email remains reconnect', async () => {
  const { window } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: '',
      calendarId: 'cal-1',
      configs: [],
      calendarBindingVersion: 1,
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'reconnect')
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.hasGrant, true)
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.hasCalendar, true)
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
})

test('canonical zero-config binding is connected without a preservation marker', async () => {
  const { window } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [],
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, null)
})

test('availability save keeps a versioned zero-offer binding empty', async () => {
  const result = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [],
      calendarBindingVersion: 1,
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  const card = result.dom.list.children.find((el) => el.dataset.id === 'general')
  card.children[0].children[2].children[0].click()
  card.children[2].children[0].children[1].children[1].click()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/update/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 1)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.dom.notif.steps['availability-saved'].style.display, '')
})

const PLATFORM_TRANSITION_KEY = 'starter-scheduling-platform-transition:member-a'

function platformTransitionIntent(options = {}) {
  const activeConfigIds = Object.prototype.hasOwnProperty.call(options, 'activeConfigIds')
    ? options.activeConfigIds
    : ['cfg-free-new']
  const transitionId = options.transitionId || 'platform-transition-fixture'
  return JSON.stringify({
    createdAt: Date.now(),
    preserveBookings: true,
    replaceGrantId: options.replaceGrantId || 'google-grant',
    transitionId,
    targetManager: 'platform',
    grantReceipt: {
      transition_id: transitionId,
      previous_grant_retained: true,
      replaced_grant_id: options.replaceGrantId || 'google-grant',
      grant_id: options.grantId || 'platform-grant',
      default_selected: true,
      services_ready: true,
      manager: 'platform',
      active_config_ids: activeConfigIds,
      active_service_count: activeConfigIds.length,
    },
  })
}

function completedPlatformReceiptReloadSection(options = {}) {
  const activeConfigIds = Object.prototype.hasOwnProperty.call(options, 'activeConfigIds')
    ? options.activeConfigIds
    : ['cfg-free-new']
  const configs = Object.prototype.hasOwnProperty.call(options, 'configs')
    ? options.configs
    : activeConfigIds.map((id) => ({
        config_id: id,
        grant_id: 'platform-grant',
        duration: 30,
        is_paid: false,
        active: true,
      }))
  const intent = platformTransitionIntent({ activeConfigIds })
  return loadSection({
    serverState: {
      grantId: 'platform-grant',
      grantEmail: 'virtual@example.com',
      calendarId: 'platform-cal',
      calendarBindingVersion: 1,
      configs,
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'platform',
      },
    },
    sessionStorage: options.sessionStorage || { [PLATFORM_TRANSITION_KEY]: intent },
    localStorage: options.localStorage || { [PLATFORM_TRANSITION_KEY]: intent },
  })
}

function connectionStates(events) {
  return events
    .filter((event) => event.type === 'starterSchedulingConnectionStateChanged')
    .map((event) => event.detail && event.detail.state)
}

test('Use Platform Calendar selects a preserved Platform default without disconnecting Google', async () => {
  let canonicalState = null
  const result = loadSection({
    serverState: {
      grantId: 'google-grant',
      grantEmail: 'member-a@gmail.example',
      calendarId: 'google-cal',
      configs: [
        { config_id: 'cfg-free-old', grant_id: 'google-grant', duration: 30, is_paid: false, active: true },
        { config_id: 'cfg-paid-old', grant_id: 'google-grant', duration: 60, is_paid: true, active: true },
      ],
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/grants/delete/v3': () => ({
        status: 400,
        body: { message: 'Resolve active bookings before disconnecting the calendar' },
      }),
      '/grants/create_virtual_account/v3': (body) => {
        canonicalState.grantId = 'platform-grant'
        canonicalState.grantEmail = 'virtual@example.com'
        canonicalState.calendarId = 'platform-cal'
        canonicalState.calendarBindingVersion = 1
        canonicalState.configs = [
          { config_id: 'cfg-free-new', grant_id: 'platform-grant', duration: 30, is_paid: false, active: true },
          { config_id: 'cfg-paid-new', grant_id: 'platform-grant', duration: 60, is_paid: true, active: true },
        ]
        canonicalState.availability = {
          ...canonicalState.availability,
          manager: 'platform',
        }
        return {
          status: 200,
          body: {
            transition_id: body.in_transition_id,
            previous_grant_retained: true,
            replaced_grant_id: 'google-grant',
            grant_id: 'platform-grant',
            default_selected: true,
            services_ready: true,
            manager: 'platform',
            active_config_ids: ['cfg-free-new', 'cfg-paid-new'],
            active_service_count: 2,
          },
        }
      },
    },
  })
  canonicalState = result.state
  await settle()

  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  await settle()

  const request = result.calls.find((call) => call.path === '/grants/create_virtual_account/v3')
  assert.deepEqual(request.body, {
    member_id: 'member-a',
    in_preserve_bookings: true,
    in_replace_grant_id: 'google-grant',
    in_transition_id: 'uuid-fixed',
  })
  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/add_virtual/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_calendar/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.state.availability.manager, 'platform')
  assert.equal(result.dom.notif.steps['virtual-connected'].style.display, '')
  assert.equal(result.window.sessionStorage._map.has('starter-scheduling-platform-transition:member-a'), false)
})

test('Use Platform Calendar accepts a preserved zero-offer Platform binding', async () => {
  let canonicalState = null
  const result = loadSection({
    serverState: {
      grantId: 'google-grant',
      grantEmail: 'member-a@gmail.example',
      calendarId: 'google-cal',
      configs: [{ config_id: 'cfg-free-old', grant_id: 'google-grant', duration: 30, is_paid: false, active: true }],
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    postRoutes: {
      '/grants/create_virtual_account/v3': (body) => {
        canonicalState.grantId = 'platform-grant'
        canonicalState.grantEmail = 'virtual@example.com'
        canonicalState.calendarId = 'platform-cal'
        canonicalState.calendarBindingVersion = 1
        canonicalState.configs = []
        canonicalState.availability = {
          ...canonicalState.availability,
          manager: 'platform',
        }
        return {
          status: 200,
          body: {
            transition_id: body.in_transition_id,
            previous_grant_retained: true,
            replaced_grant_id: 'google-grant',
            grant_id: 'platform-grant',
            default_selected: true,
            services_ready: true,
            manager: 'platform',
            active_config_ids: [],
            active_service_count: 0,
          },
        }
      },
    },
  })
  canonicalState = result.state
  await settle()

  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  await settle()

  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
  assert.equal(result.state.availability.manager, 'platform')
  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.window.sessionStorage._map.has('starter-scheduling-platform-transition:member-a'), false)
})

test('Use Platform Calendar retries a verified receipt without rekeying the old grant', async () => {
  const availability = {
    items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
    manager: 'calendar',
  }
  let canonicalManager = 'calendar'
  let canonicalGrant = {
    id: 'google-grant',
    email: 'member-a@gmail.example',
    calendarId: 'google-cal',
  }
  let calendarBindingVersion = null
  const result = loadSection({
    serverState: {
      grantId: 'google-grant',
      grantEmail: 'member-a@gmail.example',
      calendarId: 'google-cal',
      configs: [{ config_id: 'cfg-free-old', grant_id: 'google-grant', duration: 30, is_paid: false, active: true }],
      availability,
    },
    postRoutes: {
      '/starter/get_by_memberstack/v3': () => ({
        status: 200,
        body: {
          id: 1,
          timezone: 'Asia/Manila',
          availability: { ...availability, manager: canonicalManager },
          nylas_grant_id: canonicalGrant.id,
          nylas_grant_email: canonicalGrant.email,
          nylas_calendar_id: canonicalGrant.calendarId,
          calendar_binding_version: calendarBindingVersion,
        },
      }),
      '/nylas_configurations/get_all/v3': (body) => ({
        status: 200,
        body: body.grant_id === 'platform-grant'
          ? [{ config_id: 'cfg-free-new', grant_id: 'platform-grant', duration: 30, is_paid: false, active: true }]
          : [{ config_id: 'cfg-free-old', grant_id: 'google-grant', duration: 30, is_paid: false, active: true }],
      }),
      '/grants/create_virtual_account/v3': (body) => {
        canonicalGrant = {
          id: 'platform-grant',
          email: 'virtual@example.com',
          calendarId: 'platform-cal',
        }
        calendarBindingVersion = 1
        return {
          status: 200,
          body: {
            transition_id: body.in_transition_id,
            previous_grant_retained: true,
            replaced_grant_id: 'google-grant',
            grant_id: 'platform-grant',
            default_selected: true,
            services_ready: true,
            manager: 'platform',
            active_config_ids: ['cfg-free-new'],
            active_service_count: 1,
          },
        }
      },
    },
  })
  await settle()

  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  await settle()

  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(result.window.sessionStorage._map.has('starter-scheduling-platform-transition:member-a'), true)
  canonicalManager = 'platform'
  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  await settle()

  const requests = result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.in_replace_grant_id, 'google-grant')
  assert.equal(requests[0].body.in_transition_id, 'uuid-fixed')
  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/add_virtual/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_calendar/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.sessionStorage._map.has(PLATFORM_TRANSITION_KEY), false)
})

test('Use Platform Calendar replaces a stale old-grant transition for the current Google grant', async () => {
  const staleIntent = JSON.stringify({
    createdAt: Date.now(),
    preserveBookings: true,
    replaceGrantId: 'google-grant-1',
    transitionId: 'stale-transition',
    targetManager: 'platform',
  })
  let canonicalState = null
  const result = loadSection({
    serverState: {
      grantId: 'google-grant-2',
      grantEmail: 'member-a@gmail.example',
      calendarId: 'google-cal-2',
      configs: [{ config_id: 'cfg-free-g2', grant_id: 'google-grant-2', duration: 30, is_paid: false, active: true }],
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
    sessionStorage: { [PLATFORM_TRANSITION_KEY]: staleIntent },
    localStorage: { [PLATFORM_TRANSITION_KEY]: staleIntent },
    postRoutes: {
      '/grants/create_virtual_account/v3': (body) => {
        canonicalState.grantId = 'platform-grant-2'
        canonicalState.grantEmail = 'virtual@example.com'
        canonicalState.calendarId = 'platform-cal-2'
        canonicalState.calendarBindingVersion = 1
        canonicalState.configs = [
          { config_id: 'cfg-free-platform-2', grant_id: 'platform-grant-2', duration: 30, is_paid: false, active: true },
        ]
        canonicalState.availability = {
          ...canonicalState.availability,
          manager: 'platform',
        }
        return {
          status: 200,
          body: {
            transition_id: body.in_transition_id,
            previous_grant_retained: true,
            replaced_grant_id: body.in_replace_grant_id,
            grant_id: 'platform-grant-2',
            default_selected: true,
            services_ready: true,
            manager: 'platform',
            active_config_ids: ['cfg-free-platform-2'],
            active_service_count: 1,
          },
        }
      },
    },
  })
  canonicalState = result.state
  await settle()

  result.dom.connectBtnWrapper.children[0].click()
  await settle()
  await settle()

  const requests = result.calls.filter((call) => call.path === '/grants/create_virtual_account/v3')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.in_replace_grant_id, 'google-grant-2')
  assert.equal(requests[0].body.in_transition_id, 'uuid-fixed')
  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/add_virtual/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/create_virtual_calendar/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length, 0)
  assert.equal(result.state.availability.manager, 'platform')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.sessionStorage._map.has(PLATFORM_TRANSITION_KEY), false)
  assert.equal(result.window.localStorage._map.has(PLATFORM_TRANSITION_KEY), false)
})

test('completed Platform receipt reload stays closed until active configs match', async () => {
  const first = completedPlatformReceiptReloadSection({ configs: [] })
  await settle()

  assertNoCalendarReplacementWrites(first.calls)
  assert.equal(first.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(connectionStates(first.events).includes('connected'), false)
  assert.equal(first.dom.notif.steps['request-error'].style.display, '')
  assert.match(first.dom.notif.errorText.textContent, /refresh and try again/i)
  assert.notEqual(first.dom.connectWrapper.style.display, 'flex')
  assert.notEqual(first.dom.mainWrapper.style.display, 'grid')
  assert.equal(first.window.sessionStorage._map.has(PLATFORM_TRANSITION_KEY), true)
  assert.equal(first.window.localStorage._map.has(PLATFORM_TRANSITION_KEY), true)

  const second = completedPlatformReceiptReloadSection({
    sessionStorage: Object.fromEntries(first.window.sessionStorage._map),
    localStorage: Object.fromEntries(first.window.localStorage._map),
  })
  await settle()

  assertNoCalendarReplacementWrites(second.calls)
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(second.window.sessionStorage._map.has(PLATFORM_TRANSITION_KEY), false)
  assert.equal(second.window.localStorage._map.has(PLATFORM_TRANSITION_KEY), false)
})

test('completed Platform receipt in localStorage is not masked by stale session intent', async () => {
  const staleSessionIntent = JSON.stringify({
    createdAt: Date.now(),
    preserveBookings: true,
    replaceGrantId: 'platform-grant',
    transitionId: 'stale-platform-transition',
    targetManager: 'platform',
  })
  const completedIntent = platformTransitionIntent()
  const first = completedPlatformReceiptReloadSection({
    configs: [],
    sessionStorage: { [PLATFORM_TRANSITION_KEY]: staleSessionIntent },
    localStorage: { [PLATFORM_TRANSITION_KEY]: completedIntent },
  })
  await settle()

  assertNoCalendarReplacementWrites(first.calls)
  assert.equal(first.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(connectionStates(first.events).includes('connected'), false)
  assert.equal(first.window.localStorage._map.has(PLATFORM_TRANSITION_KEY), true)

  const zeroOfferIntent = platformTransitionIntent({ activeConfigIds: [] })
  const second = completedPlatformReceiptReloadSection({
    activeConfigIds: [],
    configs: [],
    sessionStorage: { [PLATFORM_TRANSITION_KEY]: staleSessionIntent },
    localStorage: { [PLATFORM_TRANSITION_KEY]: zeroOfferIntent },
  })
  await settle()

  assertNoCalendarReplacementWrites(second.calls)
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(second.window.sessionStorage._map.has(PLATFORM_TRANSITION_KEY), false)
  assert.equal(second.window.localStorage._map.has(PLATFORM_TRANSITION_KEY), false)
})

test('completed zero-offer Platform receipt reload verifies without provisioning', async () => {
  const result = completedPlatformReceiptReloadSection({ activeConfigIds: [], configs: [] })
  await settle()

  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
  assert.equal(result.window.sessionStorage._map.has(PLATFORM_TRANSITION_KEY), false)
  assert.equal(result.window.localStorage._map.has(PLATFORM_TRANSITION_KEY), false)
})

test('completed zero-offer Platform receipt clears stale paid OAuth recovery across reloads', async () => {
  const platformIntent = platformTransitionIntent({ activeConfigIds: [] })
  const paidIntent = stalePaidOAuthIntent()
  const first = completedPlatformReceiptReloadSection({
    activeConfigIds: [],
    configs: [],
    sessionStorage: {
      [PLATFORM_TRANSITION_KEY]: platformIntent,
      [OAUTH_INTENT_KEY]: paidIntent,
    },
    localStorage: {
      [PLATFORM_TRANSITION_KEY]: platformIntent,
      [OAUTH_INTENT_KEY]: paidIntent,
    },
  })
  await settle()

  assertNoCalendarReplacementWrites(first.calls)
  assert.equal(first.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(first.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(first.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
  assert.equal(first.window.localStorage._map.has(OAUTH_INTENT_KEY), false)

  const second = completedPlatformReceiptReloadSection({
    activeConfigIds: [],
    configs: [],
    sessionStorage: Object.fromEntries(first.window.sessionStorage._map),
    localStorage: Object.fromEntries(first.window.localStorage._map),
  })
  await settle()

  assertNoCalendarReplacementWrites(second.calls)
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(second.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
  assert.equal(second.window.localStorage._map.has(OAUTH_INTENT_KEY), false)
})

for (const manager of ['platform', 'calendar']) {
  test(`versioned zero-offer ${manager} binding suppresses stale paid OAuth recovery without receipts`, async () => {
    const paidIntent = stalePaidOAuthIntent()
    const result = loadSection({
      serverState: {
        grantId: manager + '-grant',
        grantEmail: manager + '@example.com',
        calendarId: manager + '-calendar',
        calendarBindingVersion: 1,
        configs: [],
        availability: {
          items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
          manager,
        },
      },
      sessionStorage: { [OAUTH_INTENT_KEY]: paidIntent },
      localStorage: { [OAUTH_INTENT_KEY]: paidIntent },
    })
    await settle()

    assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
    assert.equal(result.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
    assert.equal(result.window.localStorage._map.has(OAUTH_INTENT_KEY), false)
  })
}

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

// Calendar transitions preserve the canonical paid-call service by re-writing it
// after the grant is deleted, so a rate the paid-call contract would reject must
// stop the transition before the irreversible provider mutation instead of being
// preserved, rounded, or silently dropped.
for (const [label, priceCents] of [
  ['above the $1,000 maximum', 100100],
  ['not a whole dollar', 42550],
]) {
  test(`a canonical paid-call rate ${label} stops the calendar transition before the grant is deleted`, async () => {
    const { dom, calls } = loadSection({
      serverState: {
        grantId: 'grant-1',
        grantEmail: 'g@example.com',
        calendarId: 'cal-1',
        paidService: {
          config_id: 'cfg-paid-old',
          title: 'Paid Strategy Call',
          price_cents: priceCents,
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
    dom.notif.disconnectGoogleBtn.click() // confirm
    await settle()

    assert.equal(
      calls.filter((call) => call.path === '/grants/delete/v3').length,
      0,
      'the provider grant must survive a paid-call rate the contract rejects',
    )
    assert.equal(
      calls.filter((call) => call.path === '/starter/paid-call-settings/upsert/v3').length,
      0,
      'no paid-call rate may be rewritten from a rejected canonical value',
    )
    assert.equal(dom.notif.steps['calendar-disconnected'].style.display, 'none')
    // The rate is repairable in Call Settings, so the member must be told that
    // rather than being left with copy that blames the calendar connection.
    assert.equal(dom.notif.steps['request-error'].style.display, '')
    assert.equal(dom.notif.errorText.textContent, PAID_CALL_RATE_COPY)
  })
}

test('a Nylas grant persisted without a calendar stays repairable through Connect Platform', async () => {
  // Reproduces the half-built virtual grant: /grants/add_virtual/v3 persisted
  // nylas_grant_id but /grants/create_virtual_calendar/v3 failed, so the
  // reloaded member holds a grant that can serve neither availability nor
  // bookings. Platform must read Disconnected and keep offering completion.
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

  dom.connectBtnWrapper.children[0].click() // connect-platform resumes it
  await settle()

  const deleteCall = calls.find((call) => call.path === '/grants/delete/v3')
  assert.equal(deleteCall, undefined)
  const paths = calls.map((call) => call.path)
  assert.equal(paths.includes('/grants/create_virtual_account/v3'), false)
  assert.equal(paths.includes('/grants/add_virtual/v3'), false)
  assert.equal(dom.notif.steps['virtual-connected'].style.display, '')
  assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(state.grantId, 'orphan-grant')
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

const PLATFORM_STATE = {
  grantId: 'grant-virtual-1',
  grantEmail: 'member-a@virtual.example',
  calendarId: 'cal-virtual-1',
  availability: {
    items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
    manager: 'platform',
  },
}
const OAUTH_INTENT_KEY = 'starter-scheduling-oauth-intent:member-a'

function platformState(extra) {
  return Object.assign({}, PLATFORM_STATE, extra || {}, {
    availability: Object.assign({}, PLATFORM_STATE.availability, extra && extra.availability),
  })
}

test('Connect Google from Platform skips paid-service capture while preserving the old default', async () => {
  const { dom, calls, assigned, window } = loadSection({
    serverState: platformState({
      paidService: {
        config_id: 'paid-old',
        title: 'Paid Legacy Call',
        price_cents: 100050,
        duration: 90,
        active: true,
      },
    }),
  })
  await settle()

  assert.equal(dom.connectBtnWrapper.children[0].style.display, 'none') // Platform already connected
  assert.notEqual(dom.connectBtnWrapper.children[1].style.display, 'none')
  dom.connectBtnWrapper.children[1].click()
  assert.equal(dom.notif.steps['switch-calendar'].style.display, 'none')
  assert.equal(dom.notif.steps['pre-oauth'].style.display, '')

  dom.notif.oauthRedirectBtn.click() // "Done"
  await settle()

  assert.equal(calls.filter((c) => c.path === '/grants/delete/v3').length, 0)
  assert.equal(calls.filter((c) => c.path === '/grants/oauth/v3').length, 1)
  assert.equal(calls.filter((c) => c.path === '/starter/paid-call-settings/get/v3').length, 0)
  assert.equal(assigned.length, 1)
  const intent = JSON.parse(window.sessionStorage._map.get(OAUTH_INTENT_KEY))
  const durableIntent = JSON.parse(window.localStorage._map.get(OAUTH_INTENT_KEY))
  assert.equal(intent.paidCallIntent, null)
  assert.deepEqual(durableIntent, intent)
})

test('stale Connect Google confirm refuses a refreshed Google-managed grant', async () => {
  const result = loadSection({ serverState: platformState() })
  await settle()

  result.dom.connectBtnWrapper.children[1].click()
  assert.equal(result.dom.notif.steps['pre-oauth'].style.display, '')

  result.state.grantId = 'google-grant'
  result.state.grantEmail = 'member-a@gmail.example'
  result.state.calendarId = 'google-cal'
  result.state.configs = [{
    config_id: 'cfg-google',
    grant_id: 'google-grant',
    duration: 30,
    is_paid: false,
    active: true,
  }]
  result.state.availability = {
    items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
    manager: 'calendar',
  }

  result.dom.notif.oauthRedirectBtn.click()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/oauth/v3').length, 0)
  assert.equal(result.assigned.length, 0)
  assert.equal(result.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
  assert.equal(result.window.localStorage._map.has(OAUTH_INTENT_KEY), false)
  assert.equal(result.state.grantId, 'google-grant')
  assert.equal(result.state.availability.manager, 'calendar')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(result.dom.notif.steps['request-error'].style.display, '')
  assert.equal(result.dom.notif.steps['oauth-redirect'].style.display, 'none')
})

test('starting a calendar switch retains the current default and active calls until OAuth completes', async () => {
  const initial = platformState()
  const result = loadSection({
    serverState: initial,
    postRoutes: {
      '/grants/delete/v3': () => ({
        status: 400,
        body: { message: 'Resolve active bookings before disconnecting the calendar' },
      }),
    },
  })
  await settle()
  const originalAvailability = JSON.parse(JSON.stringify(result.state.availability))
  const originalGrant = result.state.grantId
  const originalCalendar = result.state.calendarId

  result.dom.connectBtnWrapper.children[1].click()
  result.dom.notif.oauthRedirectBtn.click()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 0)
  assert.deepEqual(result.assigned, ['https://nylas.example/oauth'])
  assert.equal(result.state.grantId, originalGrant)
  assert.equal(result.state.calendarId, originalCalendar)
  assert.deepEqual(result.state.availability, originalAvailability)
})

test('a stale modal Connect Google action is ignored after Google is connected', async () => {
  const result = loadSection({
    serverState: {
      grantId: 'google-grant',
      grantEmail: 'member-a@gmail.example',
      calendarId: 'primary',
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: 'calendar',
      },
    },
  })
  await settle()

  result.dom.notif.oauthRedirectBtn.click()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/delete/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/grants/oauth/v3').length, 0)
  assert.equal(result.assigned.length, 0)
  assert.equal(result.dom.notif.steps['oauth-redirect'].style.display, 'none')
  assert.equal(result.dom.notif.steps['request-error'].style.display, 'none')
  assert.equal(result.dom.connectBtnWrapper.children[2].style.display, '')
  assert.equal(result.state.grantId, 'google-grant')
  assert.equal(result.state.availability.manager, 'calendar')
})

test('the OAuth return after a Platform replacement shows Platform and Google both connected', async () => {
  let canonicalState = null
  const result = loadSection({
    search: '?success=true&grant_id=google-grant-9&state=member-a',
    sessionStorage: {
      [OAUTH_INTENT_KEY]: JSON.stringify({
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
        canonicalState.grantId = 'google-grant-9'
        canonicalState.grantEmail = 'member-a@gmail.example'
        canonicalState.calendarId = 'primary'
        return { status: 200, body: { grant_id: 'google-grant-9' } }
      },
    },
  })
  canonicalState = result.state
  await settle()

  assert.equal(result.calls.filter((c) => c.path === '/grants/add/v3').length, 1)
  assert.equal(result.calls.filter((c) => c.path === '/grants/create_virtual_account/v3').length, 0)
  assert.equal(result.state.availability.manager, 'calendar')
  ;[false, true, false, true].forEach((visible, index) => {
    assert.equal(result.dom.labelGroup.children[index].style.display !== 'none', visible, 'label ' + index)
  })
  ;[true, false, true].forEach((visible, index) => {
    assert.equal(result.dom.connectBtnWrapper.children[index].style.display !== 'none', visible, 'action ' + index)
  })
  assert.equal(result.dom.connectBtnWrapper.children[0].textContent, 'Use Platform Calendar')
  assert.equal(result.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
})

for (const [refusalContract, refusalMessage] of [
  ['legacy', 'Resolve active bookings before disconnecting the calendar'],
  ['owner-wide', ACTIVE_CALLS_COPY],
]) {
  test(`an active-booking rejection stops Google disconnect before the virtual Platform replacement (${refusalContract})`, async () => {
    const paidService = {
      config_id: 'cfg-paid-old',
      title: 'Paid Strategy Call',
      price_cents: 42500,
      duration: 45,
      active: true,
    }
    const paidConfig = {
      config_id: 'cfg-paid-old',
      grant_id: 'grant-1',
      duration: 45,
      is_paid: true,
      active: true,
    }
    const { dom, calls, state, window } = loadSection({
      serverState: {
        grantId: 'grant-1',
        grantEmail: 'g@example.com',
        calendarId: 'cal-1',
        paidService,
        configs: [paidConfig],
        availability: {
          items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
          manager: 'calendar',
        },
      },
      postRoutes: {
        '/grants/delete/v3': () => ({
          status: 400,
          body: { code: 'ERROR_CODE_INPUT_ERROR', message: refusalMessage },
        }),
      },
    })
    await settle()

    dom.connectBtnWrapper.children[2].click()
    dom.notif.disconnectGoogleBtn.click() // confirm Google disconnect
    await settle()

    assert.equal(calls.filter((c) => c.path === '/grants/delete/v3').length, 1)
    assert.equal(calls.filter((c) => c.path === '/grants/create_virtual_account/v3').length, 0)
    assert.equal(calls.filter((c) => c.path === '/grants/add_virtual/v3').length, 0)
    assert.equal(calls.filter((c) => c.path === '/grants/create_virtual_calendar/v3').length, 0)
    assert.equal(calls.filter((c) => c.path === '/scheduler/configurations/create/v3').length, 0)
    assert.equal(calls.filter((c) => c.path === '/starter/update_availability/v3').length, 0)
    assert.equal(calls.filter((c) => c.path === '/starter/paid-call-settings/upsert/v3').length, 0)
    assert.equal(state.grantId, 'grant-1')
    assert.equal(state.grantEmail, 'g@example.com')
    assert.equal(state.calendarId, 'cal-1')
    assert.deepEqual(state.paidService, paidService)
    assert.deepEqual(state.configs, [paidConfig])
    assert.equal(window.STARTER_SCHEDULING_CONNECTION.state, 'error')
    // The refusal is something the member can act on, so it must name the calls
    // instead of blaming the calendar connection.
    assert.equal(dom.notif.steps['request-error'].style.display, '')
    assert.equal(dom.notif.errorText.textContent, ACTIVE_CALLS_COPY)

    const reload = loadSection({
      serverState: state,
      sessionStorage: Object.fromEntries(window.sessionStorage._map),
      localStorage: Object.fromEntries(window.localStorage._map),
    })
    await settle()

    assert.equal(window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
    assert.equal(window.localStorage._map.has(OAUTH_INTENT_KEY), false)
    assertNoCalendarReplacementWrites(reload.calls)
    assert.equal(reload.state.grantId, 'grant-1')
    assert.equal(reload.state.availability.manager, 'calendar')
    assert.deepEqual(reload.state.paidService, paidService)
    assert.deepEqual(reload.state.configs, [paidConfig])
  })
}

test('only the exact 400 active-bookings refusal replaces section disconnect copy', async () => {
  const cases = [
    {
      label: 'owner-wide refusal with a non-400 status',
      response: { status: 500, body: { message: ACTIVE_CALLS_COPY } },
    },
    {
      label: 'matching message with a non-400 status',
      response: {
        status: 500,
        body: { message: 'Resolve active bookings before disconnecting the calendar' },
      },
    },
    {
      label: 'different message with a 400 status',
      response: {
        status: 400,
        body: { message: 'Grant does not belong to the authenticated member' },
      },
    },
    {
      label: 'owner-wide refusal plus unrelated suffix with a 400 status',
      response: {
        status: 400,
        body: { message: ACTIVE_CALLS_COPY + ' Invalid grant owner.' },
      },
    },
  ]

  for (const entry of cases) {
    const { dom } = loadSection({
      serverState: {
        grantId: 'grant-1',
        grantEmail: 'g@example.com',
        calendarId: 'cal-1',
        availability: {
          items: {
            general: {
              days: [1, 2, 3],
              start: '09:00',
              end: '17:00',
              defaultDays: [1, 2, 3],
            },
          },
          manager: 'calendar',
        },
      },
      postRoutes: {
        '/grants/delete/v3': () => entry.response,
      },
    })
    await settle()

    dom.connectBtnWrapper.children[2].click()
    dom.notif.disconnectGoogleBtn.click()
    await settle()

    assert.equal(
      dom.notif.errorText.textContent,
      DISCONNECT_GOOGLE_GENERIC_COPY,
      entry.label,
    )
  }
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

test('an override may cover the last general day without sending an empty window to Nylas', async () => {
  const baseline = {
    items: {
      general: { days: [4], start: '12:00', end: '17:00', defaultDays: [3, 4] },
      existing: { days: [3], start: '12:00', end: '17:00' },
    },
    manager: 'calendar',
  }
  const { dom, calls, state } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'starter@example.com',
      calendarId: 'primary',
      availability: baseline,
      configs: [{ config_id: 'cfg-free', grant_id: 'grant-1', duration: 30, is_paid: false, active: true }],
    },
  })
  await settle()

  dom.createBtn.click()
  await settle()
  const draftCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && !['general', 'existing'].includes(el.dataset.id),
  )
  const formWrapper = draftCard.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[4].children[1].checked = true
  form.querySelector('[name=start-time]').value = '10:00'
  form.querySelector('[name=end-time]').value = '14:00'
  formWrapper.children[0].children[1].children[1].click()
  await settle()

  assert.deepEqual(state.availability.items.general, {
    days: [],
    start: '12:00',
    end: '17:00',
    defaultDays: [3, 4],
  })
  const configUpdate = calls.find((call) => call.path === '/scheduler/configurations/update/v3')
  assert.ok(configUpdate)
  const providerHours = configUpdate.body.in_availability.availability_rules.default_open_hours
  assert.equal(providerHours.some((window) => window.days.length === 0), false)
  assert.deepEqual(providerHours.map((window) => window.days), [[3], [4]])
})

test('editing an override restores its previous default day', async () => {
  const baseline = {
    items: {
      general: { days: [4], start: '12:00', end: '17:00', defaultDays: [3, 4] },
      existing: { days: [3], start: '10:00', end: '14:00' },
    },
    manager: 'calendar',
  }
  const { dom, calls } = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'starter@example.com',
      calendarId: 'primary',
      availability: baseline,
      configs: [{ config_id: 'cfg-free', grant_id: 'grant-1', duration: 30, is_paid: false, active: true }],
    },
  })
  await settle()

  const card = dom.list.children.find((el) => el.dataset.id === 'existing')
  card.children[0].children[2].children[0].click()
  const formWrapper = card.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[3].children[1].checked = false
  form.children[4].children[1].checked = true
  form.querySelector('[name=start-time]').value = '10:00'
  form.querySelector('[name=end-time]').value = '14:00'
  formWrapper.children[0].children[1].children[1].click()
  await settle()

  const update = calls.find((call) => call.path === '/starter/update_availability/v3')
  assert.deepEqual(update.body.availability.items.general.days, [3])
  assert.deepEqual(update.body.availability.items.existing.days, [4])
  const configUpdate = calls.find((call) => call.path === '/scheduler/configurations/update/v3')
  assert.deepEqual(
    configUpdate.body.in_availability.availability_rules.default_open_hours.map((window) => window.days),
    [[3], [4]],
  )
})

test('a failed canonical override save restores the pre-submit availability model and cards', async () => {
  const baseline = {
    items: {
      general: { days: [4], start: '12:00', end: '17:00', defaultDays: [3, 4] },
      existing: { days: [3], start: '12:00', end: '17:00' },
    },
    manager: 'calendar',
  }
  const expectedBaseline = JSON.parse(JSON.stringify(baseline))
  const { dom, calls, window } = loadSection({
    serverState: { availability: baseline },
    postRoutes: {
      '/starter/update_availability/v3': () => ({ status: 400, body: { message: 'rejected' } }),
    },
  })
  await settle()

  dom.createBtn.click()
  await settle()
  const draftCard = dom.list.children.find(
    (el) => el.getAttribute('data-availability-element') === 'item-card' && !['general', 'existing'].includes(el.dataset.id),
  )
  const formWrapper = draftCard.children[2]
  const form = formWrapper.querySelector('[data-availability-element="availability-form"]')
  form.children[4].children[1].checked = true
  form.querySelector('[name=start-time]').value = '10:00'
  form.querySelector('[name=end-time]').value = '14:00'
  formWrapper.children[0].children[1].children[1].click()
  await settle()

  assert.equal(JSON.stringify(window.STARTER_AVAILABILITY), JSON.stringify(expectedBaseline))
  assert.deepEqual(dom.list.children.filter((card) => card.dataset.id).map((card) => card.dataset.id), ['general', 'existing'])
  assert.equal(calls.some((call) => call.path === '/scheduler/configurations/update/v3'), false)
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
  const firstSlot = futureUtcSlot(17, 0)
  const slots = [0, 1, 2, 3, 4, 5].map((offset) => ({
    start_time: firstSlot + offset * 24 * 60 * 60,
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

  dom.calendarPreview
    .querySelector(`[data-preview-date="${slotDateKey(slots[2].start_time, 'America/Los_Angeles')}"]`)
    .click()
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

test('a foreign-environment configuration is not previewed or replaced by an implicit Free offer', async () => {
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
    0,
  )
  const services = result.dom.calendarPreview.querySelector(
    '[data-availability-element="preview-services"]',
  )
  assert.equal(services, null)
})

test('calendar-preview excludes paid services outside the whole-dollar $1 to $1,000 contract or failed provider sync', async () => {
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
          config_id: 'cfg-paid-too-high',
          duration: 60,
          price_cents: 100100,
          is_paid: true,
          active: true,
          sync_status: 'ready',
        },
        {
          config_id: 'cfg-paid-fractional',
          duration: 60,
          price_cents: 1050,
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
  assert.equal(dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid-too-high"]'), null)
  assert.equal(dom.calendarPreview.querySelector('[data-preview-config-id="cfg-paid-fractional"]'), null)
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

test('open-item-remove keeps a versioned zero-offer binding empty', async () => {
  const result = loadSection({
    serverState: {
      grantId: 'grant-1',
      grantEmail: 'g@example.com',
      calendarId: 'cal-1',
      configs: [],
      calendarBindingVersion: 1,
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

  const overrideCard = result.dom.list.children.find((el) => el.dataset.id === 'override1')
  overrideCard.children[0].children[2].children[1].click()
  result.dom.notif.itemRemoveBtn.click()
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/create/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/scheduler/configurations/update/v3').length, 0)
  assert.equal(result.calls.filter((call) => call.path === '/starter/update_availability/v3').length, 1)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.dom.notif.steps['availability-removed'].style.display, '')
})

test('open-item-remove restores the model and card when the canonical save fails', async () => {
  const baseline = {
    items: {
      general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] },
      override1: { days: [4], start: '10:00', end: '11:00' },
    },
    manager: null,
  }
  const expectedBaseline = JSON.parse(JSON.stringify(baseline))
  const { dom, warnings, window } = loadSection({
    serverState: {
      availability: baseline,
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
  assert.equal(JSON.stringify(window.STARTER_AVAILABILITY), JSON.stringify(expectedBaseline))
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

// Synthetic server admission for the future-default transition contract. These
// fixtures never use provider credentials or the network.
function completedCalendarReceipt(activeConfigIds = ['new-free']) {
  return {
    transition_id: 'transition-fixture',
    previous_grant_retained: true,
    replaced_grant_id: 'old-grant',
    grant_id: 'new-grant',
    default_selected: true,
    services_ready: true,
    manager: 'calendar',
    active_config_ids: activeConfigIds,
    active_service_count: activeConfigIds.length,
  }
}

function completedCalendarIntent(activeConfigIds = ['new-free']) {
  return JSON.stringify({
    createdAt: Date.now(),
    redirectUri: 'https://thestarters.com/starter-dashboard',
    paidCallIntent: null,
    preserveBookings: true,
    replaceGrantId: 'old-grant',
    transitionId: 'transition-fixture',
    oauthGrantSaved: true,
    grantReceipt: completedCalendarReceipt(activeConfigIds),
  })
}

function unfinishedCalendarIntent(options = {}) {
  return JSON.stringify({
    createdAt: Date.now(),
    redirectUri: 'https://thestarters.com/starter-dashboard',
    paidCallIntent: null,
    preserveBookings: true,
    replaceGrantId: options.replaceGrantId || 'old-grant',
    transitionId: options.transitionId || 'transition-fixture',
    targetManager: 'calendar',
  })
}

function stalePaidOAuthIntent() {
  return JSON.stringify({
    createdAt: Date.now(),
    redirectUri: 'https://thestarters.com/starter-dashboard',
    paidCallIntent: { title: 'Paid Strategy Call', price_cents: 42500, duration_minutes: 45 },
  })
}

function legacyOAuthIntent(options = {}) {
  const intent = {
    createdAt: Date.now(),
    redirectUri: 'https://thestarters.com/starter-dashboard',
    paidCallIntent: { title: 'Paid Strategy Call', price_cents: 42500, duration_minutes: 45 },
    ...options,
  }
  return JSON.stringify(intent)
}

function storedOAuthCallback(options = {}) {
  return JSON.stringify({
    capturedAt: Date.now(),
    state: 'member-a',
    ...options,
  })
}

function preservedOAuthCase(options = {}) {
  const activeConfigIds =
    options.activeConfigIds === undefined ? ['new-free'] : options.activeConfigIds
  const intent = {
    createdAt: Date.now(),
    redirectUri: 'https://thestarters.com/starter-dashboard',
    paidCallIntent: options.paidCallIntent || null,
    preserveBookings: true,
    replaceGrantId: 'old-grant',
    transitionId: 'transition-fixture',
    ...options.intent,
  }
  const receipt = {
    transition_id: 'transition-fixture',
    previous_grant_retained: true,
    replaced_grant_id: 'old-grant',
    grant_id: 'new-grant',
    default_selected: true,
    services_ready: true,
    manager: 'calendar',
    active_config_ids: activeConfigIds,
    active_service_count: activeConfigIds.length,
    ...options.receipt,
  }
  let selected = options.selected === true
  const newConfigs =
    options.newConfigs === undefined
      ? activeConfigIds.map((configId) => ({
          config_id: configId,
          grant_id: 'new-grant',
          duration: configId.indexOf('paid') > -1 ? 60 : 30,
          is_paid: configId.indexOf('paid') > -1,
          active: true,
        }))
      : options.newConfigs
  const oldConfigs = options.oldConfigs || [{
    config_id: 'old-free',
    grant_id: 'old-grant',
    duration: 30,
    is_paid: false,
    active: true,
  }]
  const availability = {
    items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
    manager: selected ? 'calendar' : 'platform',
  }
  const routes = {
    '/starter/get_by_memberstack/v3': () => ({
      status: 200,
      body: {
        id: 1,
        timezone: 'Asia/Manila',
        availability: { ...availability, manager: selected ? 'calendar' : 'platform' },
        nylas_grant_id: selected ? 'new-grant' : 'old-grant',
        nylas_grant_email: selected ? 'new@example.com' : 'old@example.com',
        nylas_calendar_id: selected ? 'new-calendar' : 'old-calendar',
        calendar_binding_version: selected
          ? (options.bindingVersion === undefined ? 1 : options.bindingVersion)
          : null,
      },
    }),
    '/nylas_configurations/get_all/v3': (body) => ({
      status: 200,
      body: (selected ? newConfigs : oldConfigs).map((config) => ({
        ...config,
        grant_id: options.wrongConfigGrant ? 'old-grant' : body.grant_id,
      })),
    }),
    '/grants/add/v3': () => {
      if (options.addFailure) return { status: 503, body: { message: 'Retry transition' } }
      if (options.selectOnAdd !== false) selected = true
      return { status: 200, body: receipt }
    },
  }
  const sessionStorage = options.includeDefaultIntent === false
    ? { ...(options.sessionStorage || {}) }
    : {
        'starter-scheduling-oauth-intent:member-a': JSON.stringify(intent),
        ...options.sessionStorage,
      }
  const search = options.search === undefined ? '?code=fixture-code&state=member-a' : options.search
  const result = loadSection({
    hostname: options.hostname,
    pathname: options.pathname,
    origin: options.origin,
    search, sessionStorage,
    localStorage: options.localStorage,
    serverState: { grantId: 'old-grant', grantEmail: 'old@example.com', calendarId: 'old-calendar', availability },
    postRoutes: routes,
  })
  result.intentStillStored = () => result.window.sessionStorage._map.has('starter-scheduling-oauth-intent:member-a')
  return result
}

test('staging Google OAuth starts on the published Dashboard and persists that redirect', async () => {
  const result = loadSection({
    hostname: 'the-starters-3-0.webflow.io',
    origin: 'https://the-starters-3-0.webflow.io',
    serverState: platformState(),
  })
  await settle()
  result.dom.connectBtnWrapper.children[1].click()
  result.dom.notif.oauthRedirectBtn.click()
  await settle()

  const redirect = 'https://the-starters-3-0.webflow.io/starter-dashboard'
  assert.equal(result.calls.find((call) => call.path === '/grants/oauth/v3').body.in_redirect_uri, redirect)
  assert.equal(JSON.parse(result.window.sessionStorage.getItem(OAUTH_INTENT_KEY)).redirectUri, redirect)
})

for (const route of ['/starter-dashboard', '/starter-dashboard---availability-stage']) {
  test('staging Dashboard completes preserved OAuth with exact saved redirect ' + route, async () => {
    const redirectUri = 'https://the-starters-3-0.webflow.io' + route
    const result = preservedOAuthCase({
      hostname: 'the-starters-3-0.webflow.io',
      origin: 'https://the-starters-3-0.webflow.io',
      pathname: '/starter-dashboard',
      intent: { redirectUri },
    })
    await settle()
    assert.equal(result.calls.find((call) => call.path === '/grants/add/v3').body.in_redirect_uri, redirectUri)
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
    assert.equal(result.intentStillStored(), false)
    assertNoCalendarReplacementWrites(result.calls)
  })
}

for (const redirectUri of [
  'https://foreign.invalid/starter-dashboard',
  'https://the-starters-3-0.webflow.io/other',
  'https://the-starters-3-0.webflow.io/starter-dashboard?override=1',
]) {
  test('staging rejects an unapproved saved OAuth redirect ' + redirectUri, async () => {
    const result = preservedOAuthCase({
      hostname: 'the-starters-3-0.webflow.io',
      origin: 'https://the-starters-3-0.webflow.io',
      intent: { redirectUri },
    })
    await settle()
    assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
    assertNoCalendarReplacementWrites(result.calls)
  })
}

function assertNoCalendarReplacementWrites(calls) {
  const forbidden = new Set([
    '/grants/delete/v3', '/grants/create_virtual_account/v3', '/grants/add_virtual/v3',
    '/grants/create_virtual_calendar/v3', '/starter/update_availability/v3',
    '/scheduler/configurations/create/v3', '/scheduler/configurations/update/v3',
    '/starter/paid-call-settings/upsert/v3',
  ])
  assert.deepEqual(calls.filter((call) => forbidden.has(call.path)), [])
}

test('preserved OAuth completion sends the expected old binding and accepts only an attested new default', async () => {
  const result = preservedOAuthCase()
  await settle()
  const request = result.calls.find((call) => call.path === '/grants/add/v3')
  assert.deepEqual(request.body, {
    member_id: 'member-a',
    in_redirect_uri: 'https://thestarters.com/starter-dashboard',
    in_state: 'member-a',
    code: 'fixture-code',
    in_replace_grant_id: 'old-grant',
    in_preserve_bookings: true,
    in_transition_id: 'transition-fixture',
  })
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'calendar')
  assert.equal(result.intentStillStored(), false)
})

test('preserved OAuth callback prefers current durable intent over stale legacy session', async () => {
  const result = preservedOAuthCase({
    sessionStorage: { [OAUTH_INTENT_KEY]: stalePaidOAuthIntent() },
    localStorage: { [OAUTH_INTENT_KEY]: unfinishedCalendarIntent() },
  })
  await settle()

  const request = result.calls.find((call) => call.path === '/grants/add/v3')
  assert.equal(request.body.in_preserve_bookings, true)
  assert.equal(request.body.in_replace_grant_id, 'old-grant')
  assert.equal(request.body.in_transition_id, 'transition-fixture')
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'calendar')
})

test('preserved OAuth callback refuses stale or noncurrent records with current grant', async () => {
  const cases = [
    {
      label: 'stale legacy intent',
      includeDefaultIntent: false,
      sessionStorage: { [OAUTH_INTENT_KEY]: stalePaidOAuthIntent() },
    },
    {
      label: 'wrong old grant intent',
      includeDefaultIntent: false,
      sessionStorage: {
        [OAUTH_INTENT_KEY]: unfinishedCalendarIntent({
          replaceGrantId: 'another-old-grant',
          transitionId: 'other-transition',
        }),
      },
    },
    { label: 'missing intent', includeDefaultIntent: false },
  ]
  for (const options of cases) {
    const result = preservedOAuthCase(options)
    await settle()

    assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0, options.label)
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error', options.label)
    assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform', options.label)
    assert.equal(result.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false, options.label)
    assert.equal(result.window.localStorage._map.has(OAUTH_INTENT_KEY), false, options.label)
  }
})

for (const manager of ['platform', 'calendar']) {
  for (const callbackKind of ['hosted', 'saved-code']) {
    test(`versioned zero-offer ${manager} binding consumes resumed ${callbackKind} legacy callback read-only`, async () => {
      const currentGrantId = manager + '-grant'
      const intentOptions = callbackKind === 'saved-code'
        ? { oauthGrantSaved: true, oauthGrantId: currentGrantId }
        : {}
      const callback = callbackKind === 'saved-code'
        ? storedOAuthCallback({ code: 'fixture-code' })
        : storedOAuthCallback({ grantId: currentGrantId, success: 'true' })
      const result = loadSection({
        serverState: {
          grantId: currentGrantId,
          grantEmail: manager + '@example.com',
          calendarId: manager + '-calendar',
          calendarBindingVersion: 1,
          configs: [],
          availability: {
            items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
            manager,
          },
        },
        sessionStorage: {
          [OAUTH_INTENT_KEY]: legacyOAuthIntent(intentOptions),
          'starter-scheduling-oauth-callback': callback,
        },
      })
      await settle()

      assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
      assertNoCalendarReplacementWrites(result.calls)
      assert.equal(result.state.availability.manager, manager)
      assert.equal(result.state.paidService, null)
      assert.deepEqual(result.state.configs, [])
      assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
      assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
      assert.equal(result.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
      assert.equal(result.window.sessionStorage._map.has('starter-scheduling-oauth-callback'), false)
    })
  }
}

test('saved code OAuth retry resumes setup without re-exchanging the grant', async () => {
  let failRead = true
  let canonicalState = null
  let addCalls = 0
  const postRoutes = {
    '/grants/add/v3': () => {
      addCalls += 1
      canonicalState.grantId = 'grant-9'
      canonicalState.grantEmail = 'google@example.com'
      canonicalState.calendarId = 'cal-9'
      canonicalState.configs = []
      return { status: 200, body: { grant_id: 'grant-9' } }
    },
    '/nylas_configurations/get_all/v3': () => failRead
      ? { status: 503, body: { message: 'try again' } }
      : { status: 200, body: [] },
  }
  const first = loadSection({
    search: '?code=fixture-code&state=member-a',
    sessionStorage: { [OAUTH_INTENT_KEY]: legacyOAuthIntent({ paidCallIntent: null }) },
    serverState: {
      availability: {
        items: { general: { days: [1, 2, 3], start: '09:00', end: '17:00', defaultDays: [1, 2, 3] } },
        manager: null,
      },
      configs: [],
    },
    postRoutes,
  })
  canonicalState = first.state
  await settle()

  assert.equal(addCalls, 1)
  assert.equal(first.window.sessionStorage._map.has('starter-scheduling-oauth-callback'), true)
  const retainedIntent = JSON.parse(first.window.sessionStorage._map.get(OAUTH_INTENT_KEY))
  assert.equal(retainedIntent.oauthGrantSaved, true)
  assert.equal(retainedIntent.oauthGrantId, 'grant-9')

  failRead = false
  const second = loadSection({
    search: '',
    sessionStorage: Object.fromEntries(first.window.sessionStorage._map),
    serverState: first.state,
    postRoutes,
  })
  canonicalState = second.state
  await settle()

  assert.equal(addCalls, 1)
  assert.equal(second.state.availability.manager, 'calendar')
  assert.equal(second.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
  assert.equal(second.window.sessionStorage._map.has('starter-scheduling-oauth-callback'), false)
})

test('preserved OAuth accepts a versioned binding with no active offers', async () => {
  const result = preservedOAuthCase({ activeConfigIds: [], newConfigs: [] })
  await settle()

  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'calendar')
  assert.equal(result.intentStillStored(), false)
})

test('preserved OAuth rejects missing or mismatched server attestations before any configuration writes', async () => {
  const badReceipts = [
    { transition_id: 'other-transition' }, { previous_grant_retained: false },
    { replaced_grant_id: 'another-old-grant' }, { default_selected: false },
    { services_ready: false }, { manager: 'platform' },
    { grant_id: 'old-grant' }, { grant_id: '' },
    { active_config_ids: undefined }, { active_config_ids: ['new-free', 'new-free'], active_service_count: 2 },
    { active_config_ids: ['new-free'], active_service_count: 0 },
  ]
  for (const receipt of badReceipts) {
    const result = preservedOAuthCase({ receipt, selectOnAdd: false })
    await settle()
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
    assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
    assert.equal(result.intentStillStored(), true)
    assert.ok(result.warnings.some((warning) => warning.includes('did not verify booking preservation')))
  }
})

test('preserved hosted OAuth requires the receipt grant to match the hosted callback', async () => {
  const result = preservedOAuthCase({ search: '?success=true&grant_id=different-grant&state=member-a' })
  await settle()
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.intentStillStored(), true)
  assert.ok(result.warnings.some((warning) => warning.includes('did not verify booking preservation')))
})

test('preserved OAuth fails closed if canonical selection or config ownership disagrees with the receipt', async () => {
  const unexpectedConfig = {
    config_id: 'unexpected-free',
    grant_id: 'new-grant',
    duration: 30,
    is_paid: false,
    active: true,
  }
  for (const options of [
    { selectOnAdd: false },
    { wrongConfigGrant: true },
    { activeConfigIds: ['new-free'], newConfigs: [] },
    { activeConfigIds: [], newConfigs: [unexpectedConfig] },
    { activeConfigIds: ['new-free'], newConfigs: [unexpectedConfig] },
    { bindingVersion: null },
  ]) {
    const result = preservedOAuthCase(options)
    await settle()
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.intentStillStored(), true)
    assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
    assert.ok(result.warnings.some((warning) => warning.includes('does not match the verified transition')))
  }
})

test('a resumed preserved code callback exchanges through the server even while the old default is usable', async () => {
  const result = preservedOAuthCase({
    search: '',
    sessionStorage: {
      'starter-scheduling-oauth-callback': JSON.stringify({
        capturedAt: Date.now(), code: 'fixture-code', state: 'member-a',
      }),
    },
  })
  await settle()
  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 1)
  assert.equal(result.intentStillStored(), false)
  assertNoCalendarReplacementWrites(result.calls)
})

test('a persisted completed preservation receipt resumes without re-exchanging the one-use code', async () => {
  const result = preservedOAuthCase({
    selected: true,
    intent: {
      oauthGrantSaved: true,
      grantReceipt: completedCalendarReceipt(),
    },
  })
  await settle()
  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assert.equal(result.intentStillStored(), false)
  assertNoCalendarReplacementWrites(result.calls)
})

test('completed Google receipt reload stays closed until active configs match', async () => {
  const first = preservedOAuthCase({
    search: '',
    selected: true,
    newConfigs: [],
    intent: {
      oauthGrantSaved: true,
      grantReceipt: completedCalendarReceipt(),
    },
  })
  await settle()

  assert.equal(first.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(first.calls)
  assert.equal(first.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(connectionStates(first.events).includes('connected'), false)
  assert.equal(first.intentStillStored(), true)

  const second = preservedOAuthCase({
    search: '',
    selected: true,
    sessionStorage: Object.fromEntries(first.window.sessionStorage._map),
  })
  await settle()

  assert.equal(second.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(second.calls)
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(second.intentStillStored(), false)
})

test('completed Google receipt in localStorage is not masked by stale session intent', async () => {
  const first = preservedOAuthCase({
    search: '',
    selected: true,
    newConfigs: [],
    sessionStorage: { [OAUTH_INTENT_KEY]: stalePaidOAuthIntent() },
    localStorage: { [OAUTH_INTENT_KEY]: completedCalendarIntent() },
  })
  await settle()

  assert.equal(first.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(first.calls)
  assert.equal(first.window.STARTER_SCHEDULING_CONNECTION.state, 'error')
  assert.equal(connectionStates(first.events).includes('connected'), false)
  assert.equal(first.window.localStorage._map.has(OAUTH_INTENT_KEY), true)

  const second = preservedOAuthCase({
    search: '',
    selected: true,
    activeConfigIds: [],
    newConfigs: [],
    sessionStorage: { [OAUTH_INTENT_KEY]: stalePaidOAuthIntent() },
    localStorage: { [OAUTH_INTENT_KEY]: completedCalendarIntent([]) },
  })
  await settle()

  assert.equal(second.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(second.calls)
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(second.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(second.window.sessionStorage._map.has(OAUTH_INTENT_KEY), false)
  assert.equal(second.window.localStorage._map.has(OAUTH_INTENT_KEY), false)
})

test('completed zero-offer Google receipt reload verifies without provisioning', async () => {
  const result = preservedOAuthCase({
    search: '',
    selected: true,
    activeConfigIds: [],
    newConfigs: [],
    intent: {
      oauthGrantSaved: true,
      grantReceipt: completedCalendarReceipt([]),
    },
  })
  await settle()

  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.state, 'connected')
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.configurationCount, 0)
  assert.equal(result.window.STARTER_SCHEDULING_CONNECTION.calendarBindingVersion, 1)
  assert.equal(result.intentStillStored(), false)
})

test('cancelled and abandoned preserved OAuth never rebuilds a virtual calendar or restores paid settings', async () => {
  for (const search of ['?error=access_denied&state=member-a', '']) {
    const result = preservedOAuthCase({
      search,
      paidCallIntent: { title: 'Paid Consultation', price_cents: 15000, duration_minutes: 60 },
    })
    await settle()
    assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
    assertNoCalendarReplacementWrites(result.calls)
    assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  }
})

test('preserved OAuth transient failure leaves the old default and transition available for retry', async () => {
  const result = preservedOAuthCase({ addFailure: true })
  await settle()
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.window.STARTER_AVAILABILITY.manager, 'platform')
  assert.equal(result.intentStillStored(), true)
})

test('a partial availability save explains that canonical settings were saved but booking times need retry', async () => {
  const result = loadSection({
    serverState: platformState(),
    postRoutes: { '/scheduler/configurations/update/v3': () => ({ status: 503, body: null }) },
  })
  await settle()
  const card = result.dom.list.children.find((el) => el.dataset.id === 'general')
  card.children[0].children[2].children[0].click()
  const wrapper = card.children[2]
  const form = wrapper.querySelector('[data-availability-element="availability-form"]')
  form.querySelector('[name=start-time]').value = '10:00'
  form.querySelector('[name=end-time]').value = '16:00'
  wrapper.children[0].children[1].children[1].click()
  await settle()
  assert.equal(result.window.STARTER_AVAILABILITY.items.general.start, '10:00')
  assert.equal(result.dom.notif.steps['availability-saved'].style.display, 'none')
  assert.equal(result.dom.notif.errorText.textContent,
    "Your availability was saved, but booking times could not be verified. Please try again or contact support.")
})

test('a completed preserved receipt rejects another hosted grant without re-exchanging the code', async () => {
  const result = preservedOAuthCase({
    search: '?success=true&grant_id=other-grant&state=member-a',
    selected: true,
    intent: { grantReceipt: completedCalendarReceipt() },
  })
  await settle()
  assert.equal(result.calls.filter((call) => call.path === '/grants/add/v3').length, 0)
  assertNoCalendarReplacementWrites(result.calls)
  assert.equal(result.intentStillStored(), true)
  assert.ok(result.warnings.some((warning) => warning.includes('does not match the completed transition')))
})
