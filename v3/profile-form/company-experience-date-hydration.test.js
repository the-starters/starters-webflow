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

for (const controllerPath of controllerPaths) {
  test(`${controllerPath} reapplies canonical edit dates after the modal opens`, () => {
    const source = fs.readFileSync(path.join(__dirname, controllerPath), 'utf8')
    const openEditStart = source.indexOf('function openEditCompany(company)')
    const openEditEnd = source.indexOf('function closeEditCompany(', openEditStart)
    const openEditSource = source.slice(openEditStart, openEditEnd)

    assert.notEqual(openEditStart, -1)
    assert.match(openEditSource, /function hydrateEditCompanyDates\(\)/)
    assert.match(openEditSource, /openEditModal\(\);[\s\S]*setTimeout\(\(\) => \{[\s\S]*hydrateEditCompanyDates\(\);/)
    assert.equal((openEditSource.match(/hydrateEditCompanyDates\(\);/g) || []).length, 2)
    assert.match(openEditSource, /String\(editCompanyWrapper\.dataset\.id\) === String\(company\.id \|\| ''\)/)
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
