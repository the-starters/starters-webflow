'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const controllerPaths = [
  '../starter-edit-profile/company-experience-crud.js',
  '../build-profile/company-experience-crud.js',
]

// Mirrors jQuery UI's parseDate contract for the one format this suite pins: an exact
// match returns a Date, anything else throws instead of becoming a relative-day offset.
function parseDateForTestFormat(format, value) {
  if (format !== 'mm/dd/yy') throw new Error(`Unsupported format: ${format}`)

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value))
  if (!match) throw new Error('Unexpected literal')

  const year = Number(match[3])
  const monthIndex = Number(match[1]) - 1
  const day = Number(match[2])
  const date = new Date(year, monthIndex, day)

  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    throw new Error('Invalid date')
  }

  return date
}

function loadDateContract(relativePath, { dateFormat } = {}) {
  let capturedDate
  const parseDateCalls = []
  const jQuery = (input) => ({
    data: () => true,
    datepicker(action, value) {
      if (action === 'option') {
        return value === 'dateFormat' ? dateFormat : undefined
      }

      assert.equal(action, 'setDate')
      capturedDate = value
      if (value instanceof Date) {
        const month = value.toLocaleString('en-US', { month: 'short' })
        input.value = `${month} ${String(value.getDate()).padStart(2, '0')} ${value.getFullYear()}`
      } else if (value === null) {
        input.value = ''
      }
    },
  })
  jQuery.fn = { datepicker() {} }
  jQuery.datepicker = {
    parseDate(format, value) {
      parseDateCalls.push({ format, value })
      return parseDateForTestFormat(format, value)
    },
  }

  const context = vm.createContext({
    Date,
    jQuery,
    document: { addEventListener() {} },
  })
  const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
  vm.runInContext(source, context, { filename: relativePath })

  return {
    context,
    getCapturedDate: () => capturedDate,
    getParseDateCalls: () => parseDateCalls,
  }
}

// ---------------------------------------------------------------------------
// Executable harness: boots a whole company-experience controller against a
// fake DOM + fake jQuery UI datepicker so the edit-modal hydration path can be
// driven end to end (open the modal, let the widget clobber the fields, save).
// ---------------------------------------------------------------------------

function formatPickerValue(date, dateFormat) {
  const month = date.toLocaleString('en-US', { month: 'short' })
  if (dateFormat === 'M yy') return `${month} ${date.getFullYear()}`
  return `${month} ${String(date.getDate()).padStart(2, '0')} ${date.getFullYear()}`
}

function createClock() {
  let now = 0
  let nextId = 0
  const tasks = new Map()

  const schedule = (fn, delay, interval) => {
    const id = ++nextId
    tasks.set(id, { fn, at: now + (delay || 0), interval })
    return id
  }

  return {
    setTimeout: (fn, delay) => schedule(fn, delay, null),
    clearTimeout: (id) => tasks.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, Math.max(delay || 0, 1)),
    clearInterval: (id) => tasks.delete(id),
    advance(ms) {
      const target = now + ms

      for (let guard = 0; guard < 10000; guard += 1) {
        let due = null
        for (const entry of tasks) {
          if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry
        }
        if (!due) break

        now = due[1].at
        if (due[1].interval === null) tasks.delete(due[0])
        else due[1].at = now + due[1].interval
        due[1].fn()
      }

      now = target
    },
  }
}

class FakeClassList {
  constructor() {
    this.tokens = new Set()
  }
  add(token) { this.tokens.add(token) }
  remove(token) { this.tokens.delete(token) }
  contains(token) { return this.tokens.has(token) }
  toggle(token, force) {
    const next = force === undefined ? !this.tokens.has(token) : !!force
    if (next) this.add(token)
    else this.remove(token)
    return next
  }
}

class FakeElement {
  constructor() {
    this.attrs = {}
    this.value = ''
    this.checked = false
    this.textContent = ''
    this.dataset = {}
    this.style = {}
    this.classList = new FakeClassList()
    this.listeners = new Map()
    this.descendants = new Map()
    this.validationMessage = ''
    this.readOnly = false
    this.reportValidityCalls = 0
    this.lastReportValidity = null
    this.children = []
    this.parentNode = null
    this.hidden = false
    this.offsetWidth = 280
    this.offsetHeight = 320
    this.focused = false
  }
  // Mirrors the constraint-validation surface the controller uses: a custom message
  // persists on the control until it is explicitly cleared.
  setCustomValidity(message) { this.validationMessage = String(message == null ? '' : message) }
  // A readonly or disabled control is barred from constraint validation: it never
  // reports, so `reportValidity()` resolves to true no matter what message is set.
  get willValidate() { return !this.readOnly && this.getAttribute('disabled') === null }
  reportValidity() {
    this.reportValidityCalls += 1
    this.lastReportValidity = this.willValidate ? !this.validationMessage : true
    return this.lastReportValidity
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null }
  removeAttribute(name) { delete this.attrs[name] }
  querySelector(selector) { return this.descendants.get(selector) || null }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child }
  append(...children) { children.forEach((child) => this.appendChild(child)) }
  contains(target) { return target === this || this.children.some((child) => child.contains && child.contains(target)) }
  getBoundingClientRect() { return { left: 20, top: 20, bottom: 60, width: 200, height: 40 } }
  focus() { this.focused = true }
  closest() { return null }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || []
    handlers.push(handler)
    this.listeners.set(type, handlers)
  }
  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) || []) handler(event)
    return true
  }
  handlersFor(type) { return this.listeners.get(type) || [] }
}

// Picks a month the only way a member can: open the popup, walk the year arrows, and
// click the month button. Nothing else can write this field, so nothing else may write
// it here either. `value` is the `YYYY-MM` the picker is expected to end up submitting.
function chooseMonth(input, value) {
  const picker = input._starterProfileCompanyMonthPicker
  if (!picker || input.getAttribute('disabled') !== null) return false

  const match = /^(\d{4})-(\d{2})$/.exec(String(value))
  if (!match) return false

  const targetYear = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) return false

  const popup = picker.popup
  const [previousYear, yearLabel, nextYear] = popup.children[0].children
  const monthButtons = popup.children[1].children

  input.dispatchEvent({ type: 'click' })
  if (popup.hidden) return false

  for (let guard = 0; guard < 500 && Number(yearLabel.textContent) !== targetYear; guard += 1) {
    const arrow = Number(yearLabel.textContent) > targetYear ? previousYear : nextYear
    arrow.dispatchEvent({ type: 'click' })
  }
  if (Number(yearLabel.textContent) !== targetYear) return false

  monthButtons[monthIndex].dispatchEvent({ type: 'click' })
  const month = new Date(targetYear, monthIndex, 1).toLocaleString('en-US', { month: 'short' })
  return input.value === `${month} ${targetYear}`
}

function clearMonth(input) {
  const picker = input._starterProfileCompanyMonthPicker
  if (!picker || input.getAttribute('disabled') !== null) return false

  input.dispatchEvent({ type: 'click' })
  if (picker.popup.hidden) return false
  picker.popup.children[2].children[1].dispatchEvent({ type: 'click' })
  return true
}

// Mirrors the two jQuery UI behaviours this controller depends on: `setDate`
// runs the value through `_restrictMinMax`, and cross-field bounds installed by
// the shared start/end pair outlive any value change.
function createPicker(input, ready) {
  return {
    input,
    ready,
    destroyed: false,
    minDate: null,
    maxDate: null,
    dateFormat: null,
    date: null,
    onSelect: null,
    setDate(value) {
      if (this.destroyed) return;
      let next = value instanceof Date ? new Date(value.getTime()) : null

      if (next && this.minDate && next < this.minDate) next = new Date(this.minDate.getTime())
      if (next && this.maxDate && next > this.maxDate) next = new Date(this.maxDate.getTime())

      this.date = next
      this.input.value = next ? formatPickerValue(next, this.dateFormat) : ''
    },
    // jQuery UI's `_selectDate`: write the picked day straight into the field and hand
    // it to `onSelect`. It fires no `input` and, because the shared embed always supplies
    // an `onSelect` for a start/end pair, no `change` either.
    select(value) {
      if (this.destroyed) return;
      this.date = value instanceof Date ? new Date(value.getTime()) : null
      this.input.value = this.date ? formatPickerValue(this.date, this.dateFormat) : ''
      if (typeof this.onSelect === 'function') {
        this.onSelect.call(this.input, this.input.value, this)
      }
    },
  }
}

function createJQuery(pickers) {
  const jQuery = (element) => ({
    data(key) {
      const picker = pickers.get(element)
      if (key !== 'datepicker') return undefined
      return picker && picker.ready ? picker : undefined
    },
    datepicker(action, value) {
      const picker = pickers.get(element)
      if (!picker || !picker.ready) throw new Error('datepicker is not initialized')

      if (action === 'destroy') {
        picker.destroyed = true
        picker.ready = false
        return undefined
      }

      if (action === 'option') {
        if (typeof value === 'string') return picker[value]
        Object.assign(picker, value)
        return undefined
      }

      if (action === 'setDate') return picker.setDate(value)
      if (action === 'getDate') return picker.date

      throw new Error(`Unsupported datepicker action: ${action}`)
    },
  })

  jQuery.fn = { datepicker() {} }
  jQuery.datepicker = {
    parseDate() {
      throw new Error('Unexpected literal')
    },
  }

  return jQuery
}

function bootCompanyController(relativePath, { pickerReady = true } = {}) {
  const clock = createClock()
  const pickers = new Map()
  const fetchCalls = []
  const domReadyHandlers = []

  const elements = {
    companyList: new FakeElement(),
    companyInput: new FakeElement(),
    jobTitleInput: new FakeElement(),
    startDateInput: new FakeElement(),
    endDateInput: new FakeElement(),
    currentWorkCheckbox: new FakeElement(),
    addCompanyButton: new FakeElement(),
    editCompanyWrapper: new FakeElement(),
    editCompanyInput: new FakeElement(),
    editJobTitleInput: new FakeElement(),
    editStartDateInput: new FakeElement(),
    editEndDateInput: new FakeElement(),
    editCurrentWorkCheckbox: new FakeElement(),
    modalEdit: new FakeElement(),
    modalEditTrigger: new FakeElement(),
    modalEditClose: new FakeElement(),
    saveCompanyEditButton: new FakeElement(),
    companySubmit: new FakeElement(),
    firstCompanyInput: new FakeElement(),
  }

  const saveButtonText = new FakeElement()
  saveButtonText.textContent = 'save changes'
  elements.saveCompanyEditButton.descendants.set('.button_main-text', saveButtonText)
  elements.editStartDateInput.closest = (selector) => selector === '.modal_dialog' ? elements.modalEdit : null
  elements.editEndDateInput.closest = (selector) => selector === '.modal_dialog' ? elements.modalEdit : null

  const startPicker = createPicker(elements.editStartDateInput, pickerReady)
  const endPicker = createPicker(elements.editEndDateInput, pickerReady)
  const addStartPicker = createPicker(elements.startDateInput, pickerReady)
  const addEndPicker = createPicker(elements.endDateInput, pickerReady)
  pickers.set(elements.editStartDateInput, startPicker)
  pickers.set(elements.editEndDateInput, endPicker)
  pickers.set(elements.startDateInput, addStartPicker)
  pickers.set(elements.endDateInput, addEndPicker)

  const bySelector = new Map([
    ['.company-list', elements.companyList],
    ['#company-name', elements.companyInput],
    ['#company-position', elements.jobTitleInput],
    ['#company-start', elements.startDateInput],
    ['#company-end', elements.endDateInput],
    ['#company-current', elements.currentWorkCheckbox],
    ['#add-company', elements.addCompanyButton],
    ['#first-company', elements.firstCompanyInput],
    ['#edit-company-wrapper', elements.editCompanyWrapper],
    ['#edit-company-name', elements.editCompanyInput],
    ['#edit-company-position', elements.editJobTitleInput],
    ['#edit-company-start', elements.editStartDateInput],
    ['#edit-company-end', elements.editEndDateInput],
    ['#edit-company-current', elements.editCurrentWorkCheckbox],
    ['[data-modal-target="company-edit"]', elements.modalEdit],
    ['[data-modal-trigger="company-edit"]', elements.modalEditTrigger],
    ['[save-company-edit]', elements.saveCompanyEditButton],
    ['[data-edit-submit="companies"]', elements.companySubmit],
  ])

  let bootPromise = Promise.resolve()
  const documentBody = new FakeElement()
  const documentHead = new FakeElement()
  const visualViewportListeners = new Map()
  const visualViewport = {
    offsetLeft: 0,
    offsetTop: 0,
    width: 1280,
    height: 800,
    addEventListener(type, handler) {
      const handlers = visualViewportListeners.get(type) || []
      handlers.push(handler)
      visualViewportListeners.set(type, handlers)
    },
  }

  const context = vm.createContext({
    Date,
    console: { log() {}, warn() {}, error() {} },
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      visualViewport,
      addEventListener() {},
    },
    MEMBER: { id: 'member-1' },
    jQuery: createJQuery(pickers),
    qs: (selector, scope) => {
      if (scope === elements.modalEdit && selector === '[data-modal-close]') return elements.modalEditClose
      return scope ? null : bySelector.get(selector) || null
    },
    waitForMember: (callback) => {
      bootPromise = callback()
    },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init: init || {} })
      return { ok: true, json: async () => ({ companies: [], starter_id: 1 }) }
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    Event: class FakeEvent {
      constructor(type) { this.type = type }
    },
    document: {
      body: documentBody,
      head: documentHead,
      documentElement: { clientWidth: 1280, clientHeight: 800 },
      addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') domReadyHandlers.push(handler)
      },
      getElementById() { return null },
      querySelector() { return null },
      createElement: () => new FakeElement(),
    },
  })

  const workDatesPath = '../build-profile/work-dates.js'
  const scripts = relativePath.includes('/build-profile/')
    ? [workDatesPath, relativePath]
    : [relativePath, workDatesPath]

  for (const scriptPath of scripts) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, scriptPath), 'utf8'), context, {
      filename: scriptPath,
    })
  }
  domReadyHandlers.forEach((handler) => handler())

  // The shared datepicker embed re-reads whatever text is sitting in the field
  // while the modal opens; jQuery UI turns anything it cannot parse into a
  // relative-day offset from today. `driftDate` stands in for that result.
  function clobberOnModalOpen(driftDate) {
    elements.modalEditTrigger.addEventListener('click', () => {
      for (const picker of pickers.values()) {
        if (picker.ready) picker.setDate(driftDate)
      }
    })
  }

  function openEditFor(company) {
    const hydratedCompany = { company_domain: 'acme.example', ...company }
    const card = { dataset: { id: String(company.id), company: JSON.stringify(hydratedCompany) } }
    const editButton = {}
    const event = {
      type: 'click',
      target: {
        closest(selector) {
          if (selector === '.company-card') return card
          if (selector === '[company-card-edit]') return editButton
          return null
        },
      },
    }

    elements.companyList.dispatchEvent(event)
  }

  async function saveEdit() {
    const clickEvent = { type: 'click', preventDefault() {} }

    for (const handler of elements.saveCompanyEditButton.handlersFor('click')) await handler(clickEvent)
    for (const handler of elements.companySubmit.handlersFor('click')) await handler(clickEvent)
  }

  function selectCompany({ name, domain = `${name.toLowerCase()}.example`, entityId = 1, source = 'platform', logoUrl = '' }) {
    elements.companyInput.value = name
    elements.companyInput.dataset.selectedCompanyName = name
    elements.companyInput.dataset.selectedCompanyDomain = domain
    elements.companyInput.dataset.selectedCompanyEntityId = String(entityId)
    elements.companyInput.dataset.selectedCompanySource = source
    elements.companyInput.dataset.selectedCompanyLogoUrl = logoUrl
  }

  async function submitAdd() {
    const clickEvent = { type: 'click', preventDefault() {} }
    for (const handler of elements.addCompanyButton.handlersFor('click')) await handler(clickEvent)
    for (const handler of elements.companySubmit.handlersFor('click')) await handler(clickEvent)
  }

  async function addCompany({ companyName, startDate, endDate, currentWork = false }) {
    selectCompany({ name: companyName })
    elements.jobTitleInput.value = 'Engineer'
    if (startDate) chooseMonth(elements.startDateInput, startDate)
    else clearMonth(elements.startDateInput)
    if (endDate) chooseMonth(elements.endDateInput, endDate)
    else clearMonth(elements.endDateInput)
    if (elements.currentWorkCheckbox.checked !== currentWork) {
      elements.currentWorkCheckbox.checked = currentWork
      elements.currentWorkCheckbox.dispatchEvent({ type: 'change' })
    }

    await submitAdd()
  }

  return {
    ...elements,
    startPicker,
    endPicker,
    clock,
    visualViewport,
    dispatchVisualViewport(type) {
      for (const handler of visualViewportListeners.get(type) || []) handler()
    },
    fetchCalls,
    clobberOnModalOpen,
    openEditFor,
    saveEdit,
    addCompany,
    selectCompany,
    submitAdd,
    mutationPayloads: () => fetchCalls
      .filter((call) => call.init.body)
      .map((call) => JSON.parse(call.init.body)),
    ready: () => bootPromise,
    markPickersReady() {
      if (startPicker.input.type === 'month') startPicker.destroyed = true
      if (endPicker.input.type === 'month') endPicker.destroyed = true
      if (!startPicker.destroyed) startPicker.ready = true
      if (!endPicker.destroyed) endPicker.ready = true
    },
    lastRequestPayload: () => JSON.parse(fetchCalls[fetchCalls.length - 1].init.body),
  }
}

for (const controllerPath of controllerPaths) {
  test(`${controllerPath} opens a month-only grid and saves the selected months`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    assert.equal(app.startDateInput.type, 'text')
    assert.equal(app.startDateInput.getAttribute('aria-readonly'), 'true')
    assert.equal(app.startDateInput.willValidate, true)
    assert.equal(app.startDateInput.getAttribute('data-input-datepicker'), null)
    assert.equal(app.startDateInput.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(app.startDateInput.getAttribute('role'), 'combobox')
    assert.equal(app.startDateInput.getAttribute('aria-expanded'), 'false')

    let typingPrevented = 0
    for (const type of ['beforeinput', 'paste', 'drop']) {
      app.startDateInput.dispatchEvent({ type, preventDefault() { typingPrevented += 1 } })
    }
    assert.equal(typingPrevented, 3)

    const startPopup = app.startDateInput._starterProfileCompanyMonthPicker.popup
    const endPopup = app.endDateInput._starterProfileCompanyMonthPicker.popup
    assert.equal(app.startDateInput.getAttribute('aria-controls'), startPopup.id)
    app.startDateInput.dispatchEvent({ type: 'click' })
    assert.equal(startPopup.hidden, false)
    assert.equal(app.startDateInput.getAttribute('aria-expanded'), 'true')
    assert.equal(startPopup.getAttribute('role'), 'dialog')
    assert.equal(startPopup.children[1].children.length, 12)
    assert.equal(startPopup.children[1].children[0].focused, true)

    const currentYear = new Date().getFullYear()
    startPopup.children[1].children[8].dispatchEvent({ type: 'click' })
    app.endDateInput.dispatchEvent({ type: 'click' })
    endPopup.children[1].children[9].dispatchEvent({ type: 'click' })
    assert.equal(app.startDateInput.value, `Sep ${currentYear}`)
    assert.equal(app.endDateInput.value, `Oct ${currentYear}`)
    assert.equal(startPopup.hidden, true)
    assert.equal(app.startDateInput.getAttribute('aria-expanded'), 'false')

    app.selectCompany({ name: 'Acme', domain: 'acme.example', entityId: 10, source: 'platform' })
    app.jobTitleInput.value = 'Engineer'
    await app.submitAdd()

    const payload = app.mutationPayloads()[0]
    assert.equal(payload.start_date, `${currentYear}-09`)
    assert.equal(payload.end_date, `${currentYear}-10`)
  })

  test(`${controllerPath} disables end months before the selected start month`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    assert.equal(chooseMonth(app.startDateInput, '2024-05'), true)
    assert.equal(app.endDateInput.getAttribute('min'), '2024-05')

    const popup = app.endDateInput._starterProfileCompanyMonthPicker.popup
    app.endDateInput.dispatchEvent({ type: 'click' })
    const [previousYear] = popup.children[0].children
    const monthButtons = popup.children[1].children

    assert.equal(chooseMonth(app.endDateInput, '2020-01'), false)
    assert.equal(popup.children[0].children[1].textContent, '2024')
    assert.equal(previousYear.disabled, true)
    assert.deepEqual(monthButtons.slice(0, 4).map((button) => button.disabled), [true, true, true, true])
    assert.equal(monthButtons[4].disabled, false)
    assert.equal(app.endDateInput.value, '')
    assert.equal(chooseMonth(app.endDateInput, '2024-05'), true)

    app.currentWorkCheckbox.checked = true
    app.currentWorkCheckbox.dispatchEvent({ type: 'change' })
    assert.equal(app.endDateInput.getAttribute('min'), null)

    app.currentWorkCheckbox.checked = false
    app.currentWorkCheckbox.dispatchEvent({ type: 'change' })
    assert.equal(app.endDateInput.getAttribute('min'), '2024-05')
  })

  test(`${controllerPath} keeps the edit picker inside its modal and keyboard reachable`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    const popup = app.editStartDateInput._starterProfileCompanyMonthPicker.popup
    assert.equal(popup.parentNode, app.modalEdit)

    let prevented = false
    app.editStartDateInput.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault() { prevented = true },
    })

    assert.equal(prevented, true)
    assert.equal(popup.hidden, false)
    assert.equal(popup.children[1].children[0].focused, true)

    let tabPrevented = false
    popup.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      shiftKey: false,
      preventDefault() { tabPrevented = true },
    })
    assert.equal(tabPrevented, true)

    let escapePrevented = false
    let escapeStopped = false
    popup.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault() { escapePrevented = true },
      stopPropagation() { escapeStopped = true },
    })
    assert.equal(escapePrevented, true)
    assert.equal(escapeStopped, true)
    assert.equal(popup.hidden, true)
    assert.equal(app.editStartDateInput.getAttribute('aria-expanded'), 'false')
    assert.equal(app.editStartDateInput.focused, true)
  })

  test(`${controllerPath} keeps the picker inside a changing visual viewport`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    const popup = app.startDateInput._starterProfileCompanyMonthPicker.popup
    app.startDateInput.dispatchEvent({ type: 'click' })
    app.visualViewport.width = 240
    app.visualViewport.height = 300
    app.dispatchVisualViewport('resize')

    assert.equal(popup.style.maxWidth, '224px')
    assert.equal(popup.style.maxHeight, '284px')
  })

  test(`${controllerPath} clears native bounds between consecutive additions`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    await app.addCompany({ companyName: 'Acme', startDate: '2024-01', endDate: '2024-12' })

    assert.equal(app.startDateInput.value, '')
    assert.equal(app.endDateInput.value, '')
    assert.equal(app.startDateInput.getAttribute('max'), null)
    assert.equal(app.endDateInput.getAttribute('min'), null)

    await app.addCompany({ companyName: 'Globex', startDate: '2025-01', endDate: '2025-12' })

    assert.equal(app.startDateInput.value, '')
    assert.equal(app.endDateInput.value, '')
    assert.equal(app.startDateInput.getAttribute('max'), null)
    assert.equal(app.endDateInput.getAttribute('min'), null)
  })

  test(`${controllerPath} does not restore an end month from a prior addition`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    await app.addCompany({
      companyName: 'Acme',
      startDate: '2024-01',
      endDate: '2024-12',
      currentWork: true,
    })

    app.currentWorkCheckbox.checked = true
    app.currentWorkCheckbox.dispatchEvent({ type: 'change' })
    app.currentWorkCheckbox.checked = false
    app.currentWorkCheckbox.dispatchEvent({ type: 'change' })
    assert.equal(app.endDateInput.value, '')

    await app.addCompany({
      companyName: 'Globex',
      startDate: '2025-01',
      endDate: '2025-12',
    })

    const secondPayload = app.mutationPayloads().find((payload) => payload.company_name === 'Globex')
    assert.equal(secondPayload.end_date, '2025-12')
  })

  test(`${controllerPath} refreshes the end-month minimum between edit operations`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    app.openEditFor({
      id: 20,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: '2024-01',
      end_date: '2024-12',
    })

    assert.equal(app.editEndDateInput.getAttribute('min'), '2024-01')
    assert.equal(app.editStartDateInput.getAttribute('max'), null)

    app.openEditFor({
      id: 21,
      company_name: 'Globex',
      job_title: 'Designer',
      start_date: '2025-03',
      end_date: '2025-03',
    })

    assert.equal(app.editEndDateInput.getAttribute('min'), '2025-03')
    assert.equal(app.editStartDateInput.getAttribute('max'), null)

    await app.saveEdit()
    app.clock.advance(1600)

    assert.equal(app.editStartDateInput.getAttribute('max'), null)
    assert.equal(app.editEndDateInput.getAttribute('min'), null)
  })

  test(`${controllerPath} does not restore an end month from a prior edit`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    app.openEditFor({
      id: 22,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: '2024-01',
      end_date: '2024-12',
    })
    app.editCurrentWorkCheckbox.checked = true
    app.editCurrentWorkCheckbox.dispatchEvent({ type: 'change' })
    await app.saveEdit()
    app.clock.advance(1600)

    app.openEditFor({
      id: 23,
      company_name: 'Globex',
      job_title: 'Designer',
      start_date: '2025-01',
      current_work: true,
    })
    app.editCurrentWorkCheckbox.checked = false
    app.editCurrentWorkCheckbox.dispatchEvent({ type: 'change' })

    assert.equal(app.editEndDateInput.value, '')
  })

  test(`${controllerPath} keeps a legacy baseline while installing the end minimum`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    app.openEditFor({
      id: 24,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Jan 2024',
      end_date: 'Dec 2025',
    })

    app.editCurrentWorkCheckbox.checked = true
    app.editCurrentWorkCheckbox.dispatchEvent({ type: 'change' })
    app.editCurrentWorkCheckbox.checked = false
    app.editCurrentWorkCheckbox.dispatchEvent({ type: 'change' })

    assert.equal(app.editEndDateInput.value, 'Dec 2025')
    assert.equal(app.editStartDateInput.getAttribute('max'), null)
    assert.equal(app.editEndDateInput.getAttribute('min'), '2024-01')

    await app.saveEdit()
    assert.equal(app.lastRequestPayload().end_date, 'Dec 2025')
  })

  test(`${controllerPath} restores the stored dates after the picker rewrites them on open`, async () => {
    const app = bootCompanyController(controllerPath)
    const drift = new Date(2026, 7, 29)

    app.clobberOnModalOpen(drift)
    app.openEditFor({
      id: 7,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Jan 2024',
      end_date: 'Dec 2024',
    })

    assert.equal(app.editStartDateInput.value, 'Jan 2024')
    assert.equal(app.editEndDateInput.value, 'Dec 2024')

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, 'Jan 2024')
    assert.equal(payload.end_date, 'Dec 2024')
  })

  test(`${controllerPath} hydrates and preserves untouched numeric legacy dates`, async () => {
    const app = bootCompanyController(controllerPath)

    app.openEditFor({
      id: 8,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: '04/22/2026',
      end_date: '04/30/2026',
    })

    assert.equal(app.editStartDateInput.value, 'Apr 2026')
    assert.equal(app.editEndDateInput.value, 'Apr 2026')

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, '04/22/2026')
    assert.equal(payload.end_date, '04/30/2026')
  })

  test(`${controllerPath} blocks an inverted range and saves it once corrected`, async () => {
    const app = bootCompanyController(controllerPath)

    app.openEditFor({
      id: 10,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: '2026-08',
      end_date: '2025-01',
    })

    assert.equal(app.editEndDateInput.getAttribute('min'), '2026-08')
    assert.equal(app.editStartDateInput.getAttribute('max'), null)

    const requestsBeforeInvalidSave = app.fetchCalls.length
    await app.saveEdit()
    assert.equal(app.fetchCalls.length, requestsBeforeInvalidSave)

    assert.equal(chooseMonth(app.editStartDateInput, '2025-06'), true)
    assert.equal(chooseMonth(app.editEndDateInput, '2025-12'), true)
    assert.equal(app.editEndDateInput.getAttribute('min'), '2025-06')
    assert.equal(app.editStartDateInput.getAttribute('max'), null)

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, '2025-06')
    assert.equal(payload.end_date, '2025-12')
  })

  test(`${controllerPath} blocks an earlier end month until the start month moves`, async () => {
    const app = bootCompanyController(controllerPath)

    app.openEditFor({
      id: 30,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: '2024-01',
      end_date: '2024-12',
    })

    assert.equal(app.editStartDateInput.value, 'Jan 2024')
    assert.equal(app.editEndDateInput.value, 'Dec 2024')

    assert.equal(chooseMonth(app.editEndDateInput, '2023-08'), false)
    assert.equal(app.editEndDateInput.value, 'Dec 2024')
    assert.equal(chooseMonth(app.editStartDateInput, '2023-05'), true)
    assert.equal(chooseMonth(app.editEndDateInput, '2023-08'), true)

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, '2023-05')
    assert.equal(payload.end_date, '2023-08')
  })

  test(`${controllerPath} corrects a valid stored range starting from the start month`, async () => {
    const app = bootCompanyController(controllerPath)

    app.openEditFor({
      id: 31,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: '2024-01',
      end_date: '2024-12',
    })

    assert.equal(chooseMonth(app.editStartDateInput, '2025-05'), true)
    assert.equal(chooseMonth(app.editEndDateInput, '2025-09'), true)

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, '2025-05')
    assert.equal(payload.end_date, '2025-09')
  })

  test(`${controllerPath} keeps an inverted-range message on the edit modal until a month changes`, async () => {
    const app = bootCompanyController(controllerPath)

    app.openEditFor({
      id: 32,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: '2024-01',
      end_date: '2024-12',
    })

    assert.equal(chooseMonth(app.editStartDateInput, '2025-06'), true)

    const requestsBeforeInvalidSave = app.fetchCalls.length
    await app.saveEdit()

    assert.equal(app.fetchCalls.length, requestsBeforeInvalidSave)
    assert.match(app.editStartDateInput.validationMessage, /end month/i)
    assert.match(app.editEndDateInput.validationMessage, /end month/i)
    assert.equal(app.editEndDateInput.reportValidityCalls, 1)
    assert.equal(app.editEndDateInput.lastReportValidity, false)

    // The transient `is-error` flash is finished well inside this window; the
    // message has to outlive it.
    app.clock.advance(1600)
    assert.match(app.editEndDateInput.validationMessage, /end month/i)

    assert.equal(chooseMonth(app.editEndDateInput, '2025-01'), false)
    assert.equal(app.editEndDateInput.value, 'Dec 2024')
    assert.match(app.editStartDateInput.validationMessage, /end month/i)
    assert.match(app.editEndDateInput.validationMessage, /end month/i)

    app.editCurrentWorkCheckbox.checked = true
    app.editCurrentWorkCheckbox.dispatchEvent({ type: 'change' })
    assert.equal(app.editEndDateInput.validationMessage, '')

    app.editCurrentWorkCheckbox.checked = false
    app.editCurrentWorkCheckbox.dispatchEvent({ type: 'change' })
    assert.match(app.editStartDateInput.validationMessage, /end month/i)
    assert.match(app.editEndDateInput.validationMessage, /end month/i)

    assert.equal(chooseMonth(app.editEndDateInput, '2025-12'), true)
    assert.equal(app.editStartDateInput.validationMessage, '')
    assert.equal(app.editEndDateInput.validationMessage, '')

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, '2025-06')
    assert.equal(payload.end_date, '2025-12')
  })

  test(`${controllerPath} keeps an inverted-range message on the add form until a month changes`, async () => {
    const app = bootCompanyController(controllerPath)
    await app.ready()

    app.selectCompany({ name: 'Acme' })
    app.jobTitleInput.value = 'Engineer'
    assert.equal(chooseMonth(app.startDateInput, '2025-06'), true)
    app.endDateInput.value = 'Dec 2024'
    app.endDateInput.dispatchEvent({ type: 'input' })

    const payloadsBeforeInvalidAdd = app.mutationPayloads().length
    await app.submitAdd()

    assert.equal(app.mutationPayloads().length, payloadsBeforeInvalidAdd)
    assert.match(app.startDateInput.validationMessage, /end month/i)
    assert.match(app.endDateInput.validationMessage, /end month/i)
    assert.equal(app.endDateInput.reportValidityCalls, 1)
    assert.equal(app.endDateInput.lastReportValidity, false)

    app.clock.advance(1600)
    assert.match(app.endDateInput.validationMessage, /end month/i)

    assert.equal(chooseMonth(app.endDateInput, '2025-01'), false)
    assert.equal(app.endDateInput.value, 'Dec 2024')
    assert.match(app.startDateInput.validationMessage, /end month/i)
    assert.match(app.endDateInput.validationMessage, /end month/i)

    app.currentWorkCheckbox.checked = true
    app.currentWorkCheckbox.dispatchEvent({ type: 'change' })
    assert.equal(app.endDateInput.validationMessage, '')

    app.currentWorkCheckbox.checked = false
    app.currentWorkCheckbox.dispatchEvent({ type: 'change' })
    assert.match(app.startDateInput.validationMessage, /end month/i)
    assert.match(app.endDateInput.validationMessage, /end month/i)

    assert.equal(chooseMonth(app.endDateInput, '2025-12'), true)
    assert.equal(app.startDateInput.validationMessage, '')
    assert.equal(app.endDateInput.validationMessage, '')

    await app.addCompany({ companyName: 'Globex', startDate: '2025-06', endDate: '2025-12' })

    const added = app.mutationPayloads().find((payload) => payload.company_name === 'Globex')
    assert.equal(added.start_date, '2025-06')
    assert.equal(added.end_date, '2025-12')
    assert.equal(app.endDateInput.validationMessage, '')
  })

  test(`${controllerPath} preserves a custom company through both range correction orders and current work`, async () => {
    const identity = { name: 'Northstar Workshop', domain: '', entityId: 0, source: 'custom', logoUrl: '' }
    const dated = bootCompanyController(controllerPath)
    await dated.ready()

    dated.selectCompany(identity)
    dated.jobTitleInput.value = 'Founder'

    // Start-first invalid range, corrected by changing the end month.
    assert.equal(chooseMonth(dated.startDateInput, '2025-06'), true)
    dated.endDateInput.value = 'Dec 2024'
    dated.endDateInput.dispatchEvent({ type: 'input' })
    await dated.submitAdd()
    assert.equal(dated.mutationPayloads().length, 0)
    assert.match(dated.endDateInput.validationMessage, /end month/i)
    assert.equal(chooseMonth(dated.endDateInput, '2025-12'), true)
    assert.equal(dated.endDateInput.validationMessage, '')

    // End-first invalid range, corrected by changing the start month. Only the
    // final corrected state is sent.
    dated.endDateInput.value = 'Dec 2024'
    dated.endDateInput.dispatchEvent({ type: 'input' })
    await dated.submitAdd()
    assert.equal(dated.mutationPayloads().length, 0)
    assert.match(dated.startDateInput.validationMessage, /end month/i)
    assert.equal(chooseMonth(dated.startDateInput, '2024-06'), true)
    assert.equal(dated.startDateInput.validationMessage, '')
    await dated.submitAdd()

    const datedPayloads = dated.mutationPayloads()
    assert.equal(datedPayloads.length, 1)
    assert.deepEqual(
      {
        company_name: datedPayloads[0].company_name,
        company_domain: datedPayloads[0].company_domain,
        company_entity_id: datedPayloads[0].company_entity_id,
        company_source: datedPayloads[0].company_source,
        start_date: datedPayloads[0].start_date,
        end_date: datedPayloads[0].end_date,
        current_work: datedPayloads[0].current_work,
      },
      {
        company_name: identity.name,
        company_domain: '',
        company_entity_id: 0,
        company_source: 'custom',
        start_date: '2024-06',
        end_date: '2024-12',
        current_work: false,
      },
    )

    const current = bootCompanyController(controllerPath)
    await current.ready()
    current.selectCompany(identity)
    current.jobTitleInput.value = 'Founder'
    assert.equal(chooseMonth(current.startDateInput, '2026-01'), true)
    assert.equal(chooseMonth(current.endDateInput, '2026-08'), true)
    current.currentWorkCheckbox.checked = true
    current.currentWorkCheckbox.dispatchEvent({ type: 'change' })

    assert.equal(current.endDateInput.value, 'Present')
    assert.equal(current.endDateInput.getAttribute('disabled'), 'disabled')
    assert.equal(current.endDateInput.classList.contains('is-disabled'), true)

    await current.submitAdd()
    const currentPayloads = current.mutationPayloads()
    assert.equal(currentPayloads.length, 1)
    assert.deepEqual(
      {
        company_name: currentPayloads[0].company_name,
        company_domain: currentPayloads[0].company_domain,
        company_entity_id: currentPayloads[0].company_entity_id,
        company_source: currentPayloads[0].company_source,
        start_date: currentPayloads[0].start_date,
        end_date: currentPayloads[0].end_date,
        current_work: currentPayloads[0].current_work,
      },
      {
        company_name: identity.name,
        company_domain: '',
        company_entity_id: 0,
        company_source: 'custom',
        start_date: '2026-01',
        end_date: 'Present',
        current_work: true,
      },
    )
  })

  test(`${controllerPath} ignores cross-field bounds left behind by an earlier edit`, async () => {
    const app = bootCompanyController(controllerPath)

    // What onSelect/lockStartMax installs after picking an end date of Jan 2019;
    // closing the modal with Escape or the X never clears it.
    app.startPicker.maxDate = new Date(2018, 11, 31)

    app.openEditFor({
      id: 9,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Mar 2021',
      end_date: 'Jun 2022',
    })

    assert.equal(app.editStartDateInput.value, 'Mar 2021')
    // A detached legacy widget may retain private bounds, but it cannot affect
    // the native month control.

    await app.saveEdit()
    assert.equal(app.lastRequestPayload().start_date, 'Mar 2021')
  })

  test(`${controllerPath} re-enables the end date after editing a current role`, async () => {
    const app = bootCompanyController(controllerPath)

    app.openEditFor({ id: 1, company_name: 'Acme', job_title: 'Engineer', start_date: 'Jan 2024', current_work: true })

    assert.equal(app.editEndDateInput.getAttribute('disabled'), 'disabled')
    assert.equal(app.editEndDateInput.classList.contains('is-disabled'), true)
    assert.equal(app.editEndDateInput.value, 'Present')

    // Escape and the modal X bypass closeEditCompany, so the next role opens
    // without the 800ms reset ever running.
    app.openEditFor({ id: 2, company_name: 'Globex', job_title: 'Designer', start_date: 'Feb 2020', end_date: 'Mar 2022' })

    assert.equal(app.editEndDateInput.getAttribute('disabled'), null)
    assert.equal(app.editEndDateInput.classList.contains('is-disabled'), false)
    assert.equal(app.editEndDateInput.value, 'Mar 2022')
  })

  test(`${controllerPath} keeps the custom month picker authoritative when jQuery UI loads late`, async () => {
    const app = bootCompanyController(controllerPath, { pickerReady: false })

    app.openEditFor({
      id: 4,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Jan 2024',
      end_date: 'Dec 2024',
    })

    assert.equal(app.editStartDateInput.value, 'Jan 2024')

    app.clock.advance(50)
    app.markPickersReady()
    app.clock.advance(500)

    assert.ok(app.editStartDateInput._starterProfileCompanyMonthPicker)
    assert.ok(app.editEndDateInput._starterProfileCompanyMonthPicker)
    assert.equal(app.editStartDateInput.getAttribute('data-input-datepicker'), null)
    assert.equal(app.editEndDateInput.getAttribute('data-input-datepicker'), null)
    assert.equal(app.editStartDateInput.value, 'Jan 2024')
    assert.equal(app.editEndDateInput.value, 'Dec 2024')

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, 'Jan 2024')
    assert.equal(payload.end_date, 'Dec 2024')
  })

  test(`${controllerPath} does not overwrite dates edited before a late picker initializes`, () => {
    const app = bootCompanyController(controllerPath, { pickerReady: false })

    app.openEditFor({
      id: 5,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Jan 2024',
      end_date: 'Dec 2024',
    })

    assert.equal(chooseMonth(app.editStartDateInput, '2025-02'), true)
    assert.equal(chooseMonth(app.editEndDateInput, '2026-03'), true)
    app.markPickersReady()
    app.clock.advance(500)

    assert.equal(app.editStartDateInput.value, 'Feb 2025')
    assert.equal(app.editEndDateInput.value, 'Mar 2026')
  })

  test(`${controllerPath} keeps a native month edit while the legacy picker is still loading`, async () => {
    const app = bootCompanyController(controllerPath, { pickerReady: false })

    app.openEditFor({
      id: 11,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Jan 2024',
      end_date: 'Dec 2024',
    })

    app.editStartDateInput.value = '2024-02'
    app.editStartDateInput.dispatchEvent({ type: 'input' })
    assert.equal(app.editStartDateInput.value, '2024-02')

    app.endPicker.ready = true
    app.clock.advance(500)

    assert.equal(app.editStartDateInput.value, '2024-02')
    assert.equal(app.editEndDateInput.value, 'Dec 2024')

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, '2024-02')
    assert.equal(payload.end_date, 'Dec 2024')
  })

  test(`${controllerPath} keeps a typed date committed only on blur`, () => {
    const app = bootCompanyController(controllerPath, { pickerReady: false })

    app.openEditFor({
      id: 12,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Jan 2024',
      end_date: 'Dec 2024',
    })

    app.editStartDateInput.value = '2025-02'
    app.editStartDateInput.dispatchEvent({ type: 'change' })
    app.markPickersReady()
    app.clock.advance(500)

    assert.equal(app.editStartDateInput.value, '2025-02')
    assert.equal(app.editEndDateInput.value, 'Dec 2024')
  })

  test(`${controllerPath} hydrates month-year dates without relative-day drift`, () => {
    const { context, getCapturedDate } = loadDateContract(controllerPath)
    const input = { value: 'Jan 2024' }

    context.setStarterProfileCompanyDatepickerDate(input, 'Jan 2024')

    const capturedDate = getCapturedDate()
    assert.equal(capturedDate.getFullYear(), 2024)
    assert.equal(capturedDate.getMonth(), 0)
    assert.equal(capturedDate.getDate(), 1)
    assert.equal(input.value, 'Jan 01 2024')
  })

  test(`${controllerPath} converts ISO dates to a local calendar date`, () => {
    const { context } = loadDateContract(controllerPath)
    const value = context.starterProfileCompanyDatepickerValue('2026-08-31T23:59:59Z')

    assert.equal(value.getFullYear(), 2026)
    assert.equal(value.getMonth(), 7)
    assert.equal(value.getDate(), 31)
  })

  test(`${controllerPath} renders ISO work-history dates as month and year`, () => {
    const { context } = loadDateContract(controllerPath)

    assert.equal(context.starterProfileCompanyMonthYearLabel('2026-08-03T00:00:00.000Z'), 'Aug 2026')
    assert.equal(context.starterProfileCompanyMonthYearLabel('2026-08-31'), 'Aug 2026')
    assert.equal(context.starterProfileCompanyMonthYearLabel('2026-08'), 'Aug 2026')
    assert.equal(context.starterProfileCompanyMonthYearLabel('Jan 2024'), 'Jan 2024')
    assert.equal(context.starterProfileCompanyMonthYearLabel('April 22, 2026'), 'Apr 2026')
    assert.equal(context.starterProfileCompanyMonthYearLabel('Present'), 'Present')
    assert.equal(context.starterProfileCompanyMonthYearLabel(''), '')
    assert.equal(context.starterProfileCompanyMonthYearLabel('unknown'), 'unknown')
    assert.equal(context.starterProfileCompanyMonthYearLabel('Marching 2024'), 'Marching 2024')
    assert.equal(context.starterProfileCompanyMonthYearLabel('2026-08-03TBD'), '2026-08-03TBD')
  })

  test(`${controllerPath} accepts a native month input without inventing a day`, () => {
    const { context } = loadDateContract(controllerPath)
    const value = context.starterProfileCompanyDatepickerValue('2026-08')

    assert.equal(value.getFullYear(), 2026)
    assert.equal(value.getMonth(), 7)
    assert.equal(value.getDate(), 1)
    assert.equal(context.starterProfileCompanyDatepickerValue('2026-13'), null)
  })

  for (const [rawValue, expectedMonth, expectedDay] of [
    ['Jan 1 2024', 0, 1],
    ['Jan 01 2024', 0, 1],
    ['April 22 2026', 3, 22],
    ['April 22, 2026', 3, 22],
  ]) {
    test(`${controllerPath} hydrates day-precision date ${rawValue}`, () => {
      const { context } = loadDateContract(controllerPath)
      const value = context.starterProfileCompanyDatepickerValue(rawValue)

      assert.equal(value.getFullYear(), Number(rawValue.match(/\d{4}/)[0]))
      assert.equal(value.getMonth(), expectedMonth)
      assert.equal(value.getDate(), expectedDay)
    })
  }

  test(`${controllerPath} rejects invalid dates instead of applying relative-day offsets`, () => {
    const { context, getCapturedDate } = loadDateContract(controllerPath)
    const input = { value: 'Jan 32 2024' }

    context.setStarterProfileCompanyDatepickerDate(input, input.value)

    assert.equal(getCapturedDate(), null)
    assert.equal(input.value, '')
    assert.equal(context.starterProfileCompanyDatepickerValue('unknown 2024'), null)
    assert.equal(context.starterProfileCompanyDatepickerValue('Marching 2024'), null)
    assert.equal(context.starterProfileCompanyDatepickerValue('2026-08-03TBD'), null)
    assert.equal(context.starterProfileCompanyDatepickerValue('2026-08-03T25:00:00Z'), null)
    assert.equal(context.starterProfileCompanyDatepickerValue('2026-08-03T12:00:00+14:30'), null)
  })

  test(`${controllerPath} hydrates a numeric legacy date without the widget`, () => {
    const { context, getCapturedDate, getParseDateCalls } = loadDateContract(controllerPath, {
      dateFormat: 'mm/dd/yy',
    })
    const input = { value: '04/22/2026' }

    context.setStarterProfileCompanyDatepickerDate(input, input.value)

    const capturedDate = getCapturedDate()
    assert.equal(capturedDate.getFullYear(), 2026)
    assert.equal(capturedDate.getMonth(), 3)
    assert.equal(capturedDate.getDate(), 22)
    assert.equal(input.value, 'Apr 22 2026')
    assert.deepEqual(getParseDateCalls(), [])
  })

  test(`${controllerPath} prefers the canonical shapes over the widget dateFormat`, () => {
    const { context, getCapturedDate, getParseDateCalls } = loadDateContract(controllerPath, {
      dateFormat: 'mm/dd/yy',
    })
    const input = { value: '2026-08-31' }

    context.setStarterProfileCompanyDatepickerDate(input, input.value)

    const capturedDate = getCapturedDate()
    assert.equal(capturedDate.getFullYear(), 2026)
    assert.equal(capturedDate.getMonth(), 7)
    assert.equal(capturedDate.getDate(), 31)
    assert.deepEqual(getParseDateCalls(), [])
  })

  test(`${controllerPath} still refuses a value the widget dateFormat cannot parse`, () => {
    const { context, getCapturedDate } = loadDateContract(controllerPath, { dateFormat: 'mm/dd/yy' })
    const input = { value: '+3m' }

    context.setStarterProfileCompanyDatepickerDate(input, input.value)

    assert.equal(getCapturedDate(), null)
    assert.equal(input.value, '')
    assert.equal(context.starterProfileCompanyDatepickerValue('13/45/2026'), null)
  })

  test(`${controllerPath} refuses an out-of-range day the widget dateFormat rejects`, () => {
    const { context, getCapturedDate } = loadDateContract(controllerPath, { dateFormat: 'mm/dd/yy' })
    const input = { value: '02/31/2026' }

    context.setStarterProfileCompanyDatepickerDate(input, input.value)

    assert.equal(getCapturedDate(), null)
    assert.equal(input.value, '')
  })

  test(`${controllerPath} hydrates a numeric legacy date without a configured widget format`, () => {
    const { context, getCapturedDate, getParseDateCalls } = loadDateContract(controllerPath)
    const input = { value: '04/22/2026' }

    context.setStarterProfileCompanyDatepickerDate(input, input.value)

    const capturedDate = getCapturedDate()
    assert.equal(capturedDate.getFullYear(), 2026)
    assert.equal(capturedDate.getMonth(), 3)
    assert.equal(capturedDate.getDate(), 22)
    assert.equal(input.value, 'Apr 22 2026')
    assert.deepEqual(getParseDateCalls(), [])
  })

  test(`${controllerPath} keeps the Present sentinel out of the datepicker`, () => {
    const { context, getCapturedDate } = loadDateContract(controllerPath)
    const input = { value: 'Present' }

    context.setStarterProfileCompanyDatepickerDate(input, 'Present')

    assert.equal(getCapturedDate(), undefined)
    assert.equal(input.value, 'Present')
    assert.equal(context.starterProfileCompanyDatepickerValue('present'), null)
  })

  test(`${controllerPath} never serializes Present for a role that is no longer current`, () => {
    const { context } = loadDateContract(controllerPath)
    const endInput = { value: '' }
    const company = { end_date: 'Present', current_work: true }

    endInput.value = company.current_work ? 'Present' : (company.end_date || '')
    context.setStarterProfileCompanyDatepickerDate(endInput, null)

    assert.equal(endInput.value, '')

    const baseline = context.starterProfileCompanyDateBaseline(
      endInput,
      company.current_work ? 'Present' : company.end_date,
    )

    assert.equal(baseline, null)

    endInput.value = ''

    assert.equal(context.serializeStarterProfileCompanyDate(endInput, baseline), '')
  })

  test(`${controllerPath} preserves a stored Present end date when another field is edited`, () => {
    const { context } = loadDateContract(controllerPath)
    const endInput = { value: 'Present' }

    context.setStarterProfileCompanyDatepickerDate(endInput, 'Present')
    const baseline = context.starterProfileCompanyDateBaseline(endInput, 'Present')

    assert.equal(context.serializeStarterProfileCompanyDate(endInput, baseline), 'Present')
  })

  test(`${controllerPath} preserves untouched canonical date strings`, () => {
    const { context } = loadDateContract(controllerPath)
    const baseline = { rawValue: 'Jan 2024', pickerValue: 'Jan 2024' }

    assert.equal(
      context.serializeStarterProfileCompanyDate({ value: 'Jan 2024' }, baseline),
      'Jan 2024',
    )
    assert.equal(
      context.serializeStarterProfileCompanyDate({ value: 'Feb 01 2024' }, baseline),
      '2024-02',
    )
  })
}
