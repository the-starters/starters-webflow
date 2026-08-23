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

function loadDateContract(relativePath) {
  let capturedDate
  const jQuery = (input) => ({
    data: () => true,
    datepicker(action, value) {
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
  }
}

for (const controllerPath of controllerPaths) {
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
