const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(require.resolve('./submit-writer.js'), 'utf8')

class Element {
  constructor(value = '') {
    this.value = value
    this.style = {}
    this.attrs = new Map()
    this.listeners = new Map()
    this.textContent = ''
    this.validationMessage = ''
    this.focusCount = 0
    this.reportValidityCount = 0
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)) }
  getAttribute(name) { return this.attrs.get(name) ?? null }
  setCustomValidity(message) { this.validationMessage = String(message || '') }
  focus() { this.focusCount += 1 }
  reportValidity() { this.reportValidityCount += 1; return this.validationMessage === '' }
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  closest() { return new Element() }
  async click() { return this.listeners.get('click')?.({ preventDefault() {} }) }
}

function load(overrides = {}, pathname = '/build-profile/full', { respond = null } = {}) {
  const values = {
    email: 'starter@example.test',
    'first-name': 'Test',
    'last-name': 'Starter',
    phone: '+15555550100',
    rate: '100',
    'offer-monthly-retainers': 'no',
    'rate-retainer': '',
    'paid-consulting-calls': 'no',
    'paid-call-rate': '',
    service: '',
    'service-2': '',
    'service-3': '',
    ...overrides,
  }
  const form = new Element()
  form.values = values
  const submit = new Element()
  const step = new Element()
  submit.closest = () => step
  const success = new Element()
  const error = new Element()
  // Mirrors the authored Webflow error state: a `.w-form-fail` wrapper whose
  // single child div carries the copy the member reads.
  const errorMessage = new Element()
  errorMessage.textContent = 'Something went wrong. Please try again.'
  const inputs = Object.fromEntries([
    ['[name="rate"]', new Element(values.rate)],
    ['[name="rate-retainer"]', new Element(values['rate-retainer'])],
    ['[name="paid-call-rate"]', new Element(values['paid-call-rate'])],
    ['#service', new Element(values.service)],
    ['#service-2', new Element(values['service-2'])],
    ['#service-3', new Element(values['service-3'])],
  ])
  const requests = []
  const loaderStates = []
  const MEMBER = {
    id: 'mem_test',
    auth: { email: values.email },
    customFields: {
      'free-user': values['first-name'],
      'last-name': values['last-name'],
      phone: values.phone,
    },
  }
  const qs = (selector, scope) => {
    if (!scope) {
      if (selector === '[build-profile-form]') return form
      if (selector === '[build-profile-success]') return success
      if (selector === '[build-profile-error]') return error
      if (selector === 'input[name="phone"]') return new Element(values.phone)
      return null
    }
    if (scope === form && selector === '[form-submit]') return submit
    if (scope === form && inputs[selector]) return inputs[selector]
    if (scope === error && selector === 'p, div') return errorMessage
    return null
  }
  class FormData {
    constructor(owner) { this.values = Object.entries(owner.values) }
    [Symbol.iterator]() { return this.values[Symbol.iterator]() }
  }
  const window = {
    __tsProfileFormControllers: {},
    location: { pathname },
    intlTelInput: { getInstance: () => ({ getNumber: () => values.phone }) },
    $memberstackDom: { updateMember: async () => {}, updateMemberAuth: async () => {} },
  }
  const domReady = []
  const context = {
    window,
    document: { addEventListener: (name, callback) => { if (name === 'DOMContentLoaded') domReady.push(callback) } },
    MEMBER,
    activeProfile: { type: pathname.endsWith('/consult') ? 'consult' : 'full', type_id: 1 },
    waitForMember: (callback) => callback(MEMBER),
    qs,
    FormData,
    setLoader(state, wrapper) { loaderStates.push({ state, wrapper }) },
    xanoAuthFetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) })
      if (respond) return respond(url, init)
      return { ok: true, status: 200, json: async () => ({ saved: true }) }
    },
    console: { log() {}, warn() {}, error() {} },
    Date,
    Math,
    Number,
    Object,
    String,
  }
  vm.runInNewContext(SOURCE, context, { filename: 'submit-writer.js' })
  domReady.forEach((callback) => callback())
  return { form, submit, step, success, error, errorMessage, inputs, requests, loaderStates }
}

test('sets native whole-dollar constraints on each direct price input', () => {
  const result = load()
  assert.deepEqual(
    ['[name="rate"]', '[name="rate-retainer"]', '[name="paid-call-rate"]'].map((selector) => ({
      type: result.inputs[selector].getAttribute('type'),
      inputmode: result.inputs[selector].getAttribute('inputmode'),
      step: result.inputs[selector].getAttribute('step'),
      min: result.inputs[selector].getAttribute('min'),
      max: result.inputs[selector].getAttribute('max'),
    })),
    [
      { type: 'number', inputmode: 'numeric', step: '1', min: '1', max: '1000' },
      { type: 'number', inputmode: 'numeric', step: '1', min: '1', max: '25000' },
      { type: 'number', inputmode: 'numeric', step: '1', min: '1', max: '1000' },
    ],
  )
})

test('rejects malformed and out-of-range authored prices before the canonical request', async () => {
  const cases = [
    { rate: '0' },
    { rate: '1001' },
    { rate: '1.5' },
    { rate: '1e2' },
    { 'offer-monthly-retainers': 'yes', 'rate-retainer': '25001' },
    { service: JSON.stringify({ name: 'Audit', price: '50001' }) },
  ]
  for (const values of cases) {
    const result = load(values)
    await result.submit.click()
    assert.equal(result.requests.length, 0, JSON.stringify(values))
    assert.equal(result.error.style.display, 'block')
  }
})

test('persists exact maximums and converts service values once without rounding', async () => {
  const result = load({
    rate: '1000',
    'offer-monthly-retainers': 'yes',
    'rate-retainer': '25000',
    service: JSON.stringify({ name: 'Audit', price: '50000' }),
  })
  await result.submit.click()
  assert.equal(result.requests.length, 1)
  const payload = result.requests[0].body
  assert.equal(payload.hourly_rate, 1000)
  assert.equal(payload.retainer_rate, 25000)
  assert.equal(payload.services['service-1'].price, 50000)
})

test('consult Paid Call accepts $1 and $1,000 and converts to no hidden precision', async () => {
  for (const value of ['1', '1000']) {
    const result = load({ 'paid-call-rate': value }, '/build-profile/consult')
    await result.submit.click()
    assert.equal(result.requests.length, 1)
    assert.equal(result.requests[0].body.paid_call_rate, Number(value))
  }

  const hidden = load({ 'paid-call-rate': '1.01' }, '/build-profile/consult')
  await hidden.submit.click()
  assert.equal(hidden.requests.length, 1)
  assert.equal(hidden.requests[0].body.paid_call_rate, null)
})

test('Full Profile rejects a selected Paid Call rate that is not a whole dollar', async () => {
  const invalid = load({ 'paid-consulting-calls': 'yes', 'paid-call-rate': '1.01' }, '/build-profile/full')
  await invalid.submit.click()
  assert.equal(invalid.requests.length, 0)
  assert.match(invalid.inputs['[name="paid-call-rate"]'].validationMessage, /\$1 to \$1,000/)
})

test('a collapsed section keeps its compatibility value instead of blocking the submit', async () => {
  const retainer = load({ 'offer-monthly-retainers': 'no', 'rate-retainer': '30000' })
  await retainer.submit.click()
  assert.equal(retainer.requests.length, 1, retainer.inputs['[name="rate-retainer"]'].validationMessage)
  assert.equal(retainer.requests[0].body.retainer, false)
  assert.equal(retainer.requests[0].body.retainer_rate, 0)
  assert.equal(retainer.error.style.display, 'none')

  const paidCall = load({ 'paid-consulting-calls': 'no', 'paid-call-rate': '2500' })
  await paidCall.submit.click()
  assert.equal(paidCall.requests.length, 1, paidCall.inputs['[name="paid-call-rate"]'].validationMessage)
  assert.equal(paidCall.requests[0].body.paid_call, false)
  assert.equal(paidCall.requests[0].body.paid_call_rate, null)
})

test('a consult profile treats the canonical zero paid-call rate as no paid consult', async () => {
  for (const sentinel of ['0', '00', ' 0 ']) {
    const result = load({ 'paid-call-rate': sentinel }, '/build-profile/consult')
    await result.submit.click()
    assert.equal(result.requests.length, 1, result.inputs['[name="paid-call-rate"]'].validationMessage)
    assert.equal(result.requests[0].body.paid_call, false)
    assert.equal(result.requests[0].body.paid_call_rate, null)
    assert.equal(result.error.style.display, 'none')
  }

})

test('Full Profile rejects a selected Paid Call rate of zero', async () => {
  const selected = load({ 'paid-consulting-calls': 'yes', 'paid-call-rate': '0' }, '/build-profile/full')
  await selected.submit.click()
  assert.equal(selected.requests.length, 0)
  assert.match(selected.inputs['[name="paid-call-rate"]'].validationMessage, /\$1 to \$1,000/)
})

test('disabled and non-owned blank rates preserve compatibility zero without accepting authored zero', async () => {
  const consult = load({ rate: '' }, '/build-profile/consult')
  await consult.submit.click()
  assert.equal(consult.requests.length, 1)
  assert.equal(consult.requests[0].body.hourly_rate, 0)
  assert.equal(consult.requests[0].body.retainer_rate, 0)
  assert.equal(consult.requests[0].body.paid_call_rate, null)
})

test('a consult profile never enables or blocks on hidden paid-call data the contract rejects', async () => {
  for (const stale of ['2500', '1.50', '1,000', '$50', '1e2', '-5', '   ', '9007199254740993']) {
    const result = load({ 'paid-call-rate': stale }, '/build-profile/consult')
    await result.submit.click()
    assert.equal(
      result.requests.length, 1,
      `${stale}: ${result.inputs['[name="paid-call-rate"]'].validationMessage}`,
    )
    assert.equal(result.requests[0].body.paid_call, false)
    assert.equal(result.requests[0].body.paid_call_rate, null)
    assert.equal(result.error.style.display, 'none')
    assert.equal(result.inputs['[name="paid-call-rate"]'].reportValidityCount, 0)
  }

})

test('Full Profile reports a selected out-of-range Paid Call rate on its own visible control', async () => {
  const selected = load({ 'paid-consulting-calls': 'yes', 'paid-call-rate': '2500' }, '/build-profile/full')
  await selected.submit.click()
  assert.equal(selected.requests.length, 0)
  assert.equal(selected.error.style.display, 'block')
  assert.match(selected.inputs['[name="paid-call-rate"]'].validationMessage, /\$1 to \$1,000/)
  assert.equal(selected.inputs['[name="paid-call-rate"]'].reportValidityCount, 1)
})

// The consult flow authors no paid-call section, so hydration can leave the hidden
// radio on either answer over data the member can neither see nor repair. Neither
// answer may block the submit or leak an out-of-contract rate.
test('a consult profile ignores the hidden paid-call radio over data the contract rejects', async () => {
  for (const stale of ['2500', '0', '1.50', '1,000', '$50', '1e2', '-5', '   ', '9007199254740993']) {
    const result = load(
      { 'paid-consulting-calls': 'yes', 'paid-call-rate': stale },
      '/build-profile/consult',
    )
    await result.submit.click()
    assert.equal(
      result.requests.length, 1,
      `${stale}: ${result.inputs['[name="paid-call-rate"]'].validationMessage}`,
    )
    assert.equal(result.requests[0].body.paid_call, false)
    assert.equal(result.requests[0].body.paid_call_rate, null)
    assert.equal(result.error.style.display, 'none')
    assert.equal(result.inputs['[name="paid-call-rate"]'].reportValidityCount, 0)
  }

  const inContract = load(
    { 'paid-consulting-calls': 'yes', 'paid-call-rate': '250' },
    '/build-profile/consult',
  )
  await inContract.submit.click()
  assert.equal(inContract.requests.length, 1)
  assert.equal(inContract.requests[0].body.paid_call, true)
  assert.equal(inContract.requests[0].body.paid_call_rate, 250)
})

// A consult save persists Hourly_Rate 0 for the profile-inapplicable control, and
// hydration writes that 0 straight back into the field. Reading it back as an
// authored price would block every later submit on a value the member cannot repair.
test('a consult profile round-trips the canonical zero hourly rate it persists', async () => {
  for (const sentinel of ['0', '00', ' 0 ']) {
    const result = load({ rate: sentinel }, '/build-profile/consult')
    await result.submit.click()
    assert.equal(result.requests.length, 1, `${sentinel}: ${result.inputs['[name="rate"]'].validationMessage}`)
    assert.equal(result.requests[0].body.hourly_rate, 0)
    assert.equal(result.error.style.display, 'none')
  }

})

test('Full Profile rejects a required hourly rate of zero', async () => {
  const fullProfile = load({ rate: '0' }, '/build-profile/full')
  await fullProfile.submit.click()
  assert.equal(fullProfile.requests.length, 0)
  assert.equal(fullProfile.error.style.display, 'block')
  assert.match(fullProfile.inputs['[name="rate"]'].validationMessage, /\$1 to \$1,000/)
})

test('a consult profile still enables an in-contract hidden paid-call rate', async () => {
  const result = load({ 'paid-call-rate': '250' }, '/build-profile/consult')
  await result.submit.click()
  assert.equal(result.requests.length, 1)
  assert.equal(result.requests[0].body.paid_call, true)
  assert.equal(result.requests[0].body.paid_call_rate, 250)
})

// A service price and name live in hidden JSON capture inputs, so focus() and
// reportValidity() on them paint nothing. The blocked submit must still tell the
// member which value stopped it through the authored error panel.
test('a service price failure names itself in the authored error panel', async () => {
  const price = load({ service: JSON.stringify({ name: 'Audit', price: '500.50' }) })
  await price.submit.click()
  assert.equal(price.requests.length, 0)
  assert.equal(price.error.style.display, 'block')
  assert.equal(
    price.errorMessage.textContent,
    'Use a whole-dollar service price from $1 to $50,000.',
  )
  assert.equal(price.inputs['#service'].reportValidityCount, 0)

  const range = load({ service: JSON.stringify({ name: 'Audit', price: '50001' }) })
  await range.submit.click()
  assert.equal(range.requests.length, 0)
  assert.equal(range.errorMessage.textContent, 'Use a whole-dollar service price from $1 to $50,000.')

  const unnamed = load({ service: JSON.stringify({ name: '', price: '500' }) })
  await unnamed.submit.click()
  assert.equal(unnamed.requests.length, 0)
  assert.equal(
    unnamed.errorMessage.textContent,
    'A service name is required when a service price is set.',
  )
})

test('a corrected retry clears the previous price message and custom validity', async () => {
  const result = load({ service: JSON.stringify({ name: 'Audit', price: '500.50' }) })
  await result.submit.click()
  assert.equal(result.requests.length, 0)
  assert.match(result.errorMessage.textContent, /whole-dollar service price/)

  result.form.values.service = JSON.stringify({ name: 'Audit', price: '500' })
  await result.submit.click()
  assert.equal(result.requests.length, 1, result.errorMessage.textContent)
  assert.equal(result.requests[0].body.services['service-1'].price, 500)
  assert.equal(result.errorMessage.textContent, 'Something went wrong. Please try again.')
  assert.equal(result.inputs['[name="rate"]'].validationMessage, '')
})

// A price message must never outlive the attempt that produced it: the next
// failure has its own cause and the authored copy owns the generic case.
test('a later non-price failure restores the authored error copy', async () => {
  const result = load(
    { service: JSON.stringify({ name: 'Audit', price: '500.50' }) },
    '/build-profile/full',
    { respond: () => { throw new Error('offline') } },
  )
  await result.submit.click()
  assert.match(result.errorMessage.textContent, /whole-dollar service price/)

  result.form.values.service = JSON.stringify({ name: 'Audit', price: '500' })
  await result.submit.click()
  assert.equal(result.requests.length, 1)
  assert.equal(result.error.style.display, 'block')
  assert.equal(result.errorMessage.textContent, 'Something went wrong. Please try again.')
})

test('a rejected canonical request clears the loader behind the authored error state', async () => {
  const result = load({}, '/build-profile/full', {
    respond: () => { throw new Error('offline') },
  })
  await result.submit.click()
  assert.equal(result.requests.length, 1)
  assert.equal(result.error.style.display, 'block')
  assert.equal(result.success.style.display, 'none')
  assert.deepEqual(result.loaderStates, [
    { state: true, wrapper: result.step },
    { state: false, wrapper: result.step },
  ])
})

test('a malformed success body clears the loader behind the authored error state', async () => {
  const result = load({}, '/build-profile/full', {
    respond: () => ({ ok: true, status: 200, json: async () => { throw new Error('bad body') } }),
  })
  await result.submit.click()
  assert.equal(result.requests.length, 1)
  assert.equal(result.error.style.display, 'block')
  assert.equal(result.success.style.display, 'none')
  assert.deepEqual(result.loaderStates, [
    { state: true, wrapper: result.step },
    { state: false, wrapper: result.step },
  ])
})

test('a non-ok canonical response clears the loader behind the authored error state', async () => {
  const result = load({}, '/build-profile/full', {
    respond: () => ({ ok: false, status: 500, text: async () => 'server error' }),
  })
  await result.submit.click()
  assert.equal(result.requests.length, 1)
  assert.equal(result.error.style.display, 'block')
  assert.deepEqual(result.loaderStates, [
    { state: true, wrapper: result.step },
    { state: false, wrapper: result.step },
  ])
})
