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

function formatPickerValue(date) {
  const month = date.toLocaleString('en-US', { month: 'short' })
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
  }
  setAttribute(name, value) { this.attrs[name] = String(value) }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null }
  removeAttribute(name) { delete this.attrs[name] }
  querySelector(selector) { return this.descendants.get(selector) || null }
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

// Mirrors the two jQuery UI behaviours this controller depends on: `setDate`
// runs the value through `_restrictMinMax`, and cross-field bounds installed by
// the shared start/end pair outlive any value change.
function createPicker(input, ready) {
  return {
    input,
    ready,
    minDate: null,
    maxDate: null,
    dateFormat: null,
    date: null,
    onSelect: null,
    setDate(value) {
      let next = value instanceof Date ? new Date(value.getTime()) : null

      if (next && this.minDate && next < this.minDate) next = new Date(this.minDate.getTime())
      if (next && this.maxDate && next > this.maxDate) next = new Date(this.maxDate.getTime())

      this.date = next
      this.input.value = next ? formatPickerValue(next) : ''
    },
    // jQuery UI's `_selectDate`: write the picked day straight into the field and hand
    // it to `onSelect`. It fires no `input` and, because the shared embed always supplies
    // an `onSelect` for a start/end pair, no `change` either.
    select(value) {
      this.date = value instanceof Date ? new Date(value.getTime()) : null
      this.input.value = this.date ? formatPickerValue(this.date) : ''
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
    editCompanyWrapper: new FakeElement(),
    editCompanyInput: new FakeElement(),
    editJobTitleInput: new FakeElement(),
    editStartDateInput: new FakeElement(),
    editEndDateInput: new FakeElement(),
    editCurrentWorkCheckbox: new FakeElement(),
    modalEdit: new FakeElement(),
    modalEditTrigger: new FakeElement(),
    saveCompanyEditButton: new FakeElement(),
    companySubmit: new FakeElement(),
    firstCompanyInput: new FakeElement(),
  }

  const saveButtonText = new FakeElement()
  saveButtonText.textContent = 'save changes'
  elements.saveCompanyEditButton.descendants.set('.button_main-text', saveButtonText)

  const startPicker = createPicker(elements.editStartDateInput, pickerReady)
  const endPicker = createPicker(elements.editEndDateInput, pickerReady)
  pickers.set(elements.editStartDateInput, startPicker)
  pickers.set(elements.editEndDateInput, endPicker)

  const bySelector = new Map([
    ['.company-list', elements.companyList],
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

  const context = vm.createContext({
    Date,
    console: { log() {}, warn() {}, error() {} },
    window: {},
    MEMBER: { id: 'member-1' },
    jQuery: createJQuery(pickers),
    qs: (selector, scope) => (scope ? null : bySelector.get(selector) || null),
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
      addEventListener(type, handler) {
        if (type === 'DOMContentLoaded') domReadyHandlers.push(handler)
      },
      createElement: () => new FakeElement(),
    },
  })

  vm.runInContext(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'), context, {
    filename: relativePath,
  })
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

  return {
    ...elements,
    startPicker,
    endPicker,
    clock,
    fetchCalls,
    clobberOnModalOpen,
    openEditFor,
    saveEdit,
    ready: () => bootPromise,
    markPickersReady() {
      startPicker.ready = true
      endPicker.ready = true
    },
    lastRequestPayload: () => JSON.parse(fetchCalls[fetchCalls.length - 1].init.body),
  }
}

for (const controllerPath of controllerPaths) {
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

    assert.equal(app.editStartDateInput.value, 'Jan 01 2024')
    assert.equal(app.editEndDateInput.value, 'Dec 01 2024')

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, 'Jan 2024')
    assert.equal(payload.end_date, 'Dec 2024')
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

    assert.equal(app.editStartDateInput.value, 'Mar 01 2021')
    assert.equal(app.startPicker.maxDate, null)

    await app.saveEdit()
    assert.equal(app.lastRequestPayload().start_date, 'Mar 2021')
  })

  test(`${controllerPath} re-enables the end date after editing a current role`, async () => {
    const app = bootCompanyController(controllerPath)

    app.openEditFor({ id: 1, company_name: 'Acme', job_title: 'Engineer', start_date: 'Jan 2024', current_work: true })

    assert.equal(app.editEndDateInput.getAttribute('disabled'), 'disabled')
    assert.equal(app.editEndDateInput.classList.contains('is-disabled'), true)
    assert.equal(app.editEndDateInput.value, '')

    // Escape and the modal X bypass closeEditCompany, so the next role opens
    // without the 800ms reset ever running.
    app.openEditFor({ id: 2, company_name: 'Globex', job_title: 'Designer', start_date: 'Feb 2020', end_date: 'Mar 2022' })

    assert.equal(app.editEndDateInput.getAttribute('disabled'), null)
    assert.equal(app.editEndDateInput.classList.contains('is-disabled'), false)
    assert.equal(app.editEndDateInput.value, 'Mar 01 2022')
  })

  test(`${controllerPath} rehydrates once a late-loading jQuery UI initializes the picker`, async () => {
    const app = bootCompanyController(controllerPath, { pickerReady: false })
    const drift = new Date(2026, 7, 29)

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
    app.startPicker.setDate(drift)
    app.endPicker.setDate(drift)
    app.clock.advance(500)

    assert.equal(app.editStartDateInput.value, 'Jan 01 2024')
    assert.equal(app.editEndDateInput.value, 'Dec 01 2024')

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

    app.editStartDateInput.value = 'Feb 2025'
    app.editEndDateInput.value = 'Mar 2026'
    app.editStartDateInput.dispatchEvent({ type: 'input' })
    app.editEndDateInput.dispatchEvent({ type: 'input' })
    app.markPickersReady()
    app.clock.advance(500)

    assert.equal(app.editStartDateInput.value, 'Feb 2025')
    assert.equal(app.editEndDateInput.value, 'Mar 2026')
  })

  test(`${controllerPath} keeps a calendar pick made while the other picker is still loading`, async () => {
    const app = bootCompanyController(controllerPath, { pickerReady: false })

    app.openEditFor({
      id: 11,
      company_name: 'Acme',
      job_title: 'Engineer',
      start_date: 'Jan 2024',
      end_date: 'Dec 2024',
    })

    app.startPicker.ready = true
    app.clock.advance(100)

    app.startPicker.select(new Date(2025, 1, 3))
    assert.equal(app.editStartDateInput.value, 'Feb 03 2025')

    app.endPicker.ready = true
    app.clock.advance(500)

    assert.equal(app.editStartDateInput.value, 'Feb 03 2025')
    assert.equal(app.editEndDateInput.value, 'Dec 01 2024')

    await app.saveEdit()
    const payload = app.lastRequestPayload()

    assert.equal(payload.start_date, 'Feb 03 2025')
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

    app.editStartDateInput.value = 'Feb 2025'
    app.editStartDateInput.dispatchEvent({ type: 'change' })
    app.markPickersReady()
    app.clock.advance(500)

    assert.equal(app.editStartDateInput.value, 'Feb 2025')
    assert.equal(app.editEndDateInput.value, 'Dec 01 2024')
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
    assert.equal(context.starterProfileCompanyMonthYearLabel('Jan 2024'), 'Jan 2024')
    assert.equal(context.starterProfileCompanyMonthYearLabel('April 22, 2026'), 'Apr 2026')
    assert.equal(context.starterProfileCompanyMonthYearLabel('Present'), 'Present')
    assert.equal(context.starterProfileCompanyMonthYearLabel(''), '')
    assert.equal(context.starterProfileCompanyMonthYearLabel('unknown'), 'unknown')
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
  })

  test(`${controllerPath} hydrates a value written in the widget's own dateFormat`, () => {
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
    assert.deepEqual(getParseDateCalls(), [{ format: 'mm/dd/yy', value: '04/22/2026' }])
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

  test(`${controllerPath} hydrates nothing when the widget has no configured dateFormat`, () => {
    const { context, getCapturedDate, getParseDateCalls } = loadDateContract(controllerPath)
    const input = { value: '04/22/2026' }

    context.setStarterProfileCompanyDatepickerDate(input, input.value)

    assert.equal(getCapturedDate(), null)
    assert.equal(input.value, '')
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
    const baseline = { rawValue: 'Jan 2024', pickerValue: 'Jan 01 2024' }

    assert.equal(
      context.serializeStarterProfileCompanyDate({ value: 'Jan 01 2024' }, baseline),
      'Jan 2024',
    )
    assert.equal(
      context.serializeStarterProfileCompanyDate({ value: 'Feb 01 2024' }, baseline),
      'Feb 01 2024',
    )
  })
}
