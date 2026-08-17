const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  path.join(__dirname, 'canonical-profile-hydrator.js'),
  'utf8',
)

function loadApi() {
  const window = {
    __TS_DISABLE_BUILD_PROFILE_CANONICAL_AUTO_INIT__: true,
    location: { pathname: '/build-profile/full-profile' },
  }
  const context = {
    window,
    document: {},
    console,
    Event: class Event {},
    CSS: { escape: String },
    Set,
  }
  vm.runInNewContext(source, context)
  return window.StartersBuildProfileCanonicalHydrator
}

test('maps the canonical profile into the native seven-step capture shape', () => {
  const api = loadApi()
  const profile = api.mapCanonicalProfile({
    Profile_Type: 'Full',
    Profile_Type_ID: 'type-id',
    First_Name: 'Owned',
    Last_Name: 'Starter',
    Email: 'owned@example.test',
    Phone: '+15550000000',
    Country: 'country-index',
    State_Province: 'state-index',
    City: 'Test City',
    Profile_Photo: 'https://example.test/photo.jpg',
    Category: 'Marketing',
    Category_ID: 'category-id',
    Roles: 'Strategist',
    Roles_IDs: 'role-id',
    Tagline: 'A useful tagline',
    Professional_Headline: 'A useful headline',
    Bio: '<p>Bio</p>',
    Skills: 'Planning',
    Skills_IDs: 'skill-id',
    Tool: 'Analytics',
    Tools_IDs: 'tool-id',
    Industry_Experience: 'Retail',
    Industry_Experience_IDs: 'industry-id',
    Hourly_Rate: 50,
    Availability: 'Available now',
    Availability_ID: 'availability-id',
    Free_Call_Enabled: true,
    Paid_Call_Enabled: false,
    Retainer_Enabled: true,
    Open_to_Full_Time: false,
    Services: {
      'service-1': { name: 'Audit', price: '100' },
      'service-2': null,
      'service-3': null,
    },
    Reviewers: {
      'reviewer-1': { email: 'reviewer@example.test', 'first-name': 'Reviewer' },
      'reviewer-2': {},
      'reviewer-3': {},
    },
  })

  assert.equal(profile.type, 'full')
  assert.equal(profile.type_id, 'type-id')
  assert.equal(profile.data.step_1['first-name'], 'Owned')
  assert.equal(profile.data.step_1.function, 'category-id')
  assert.equal(profile.data.step_1['function-required'], 'category-id')
  assert.equal(profile.data.step_1['roles-required'], 'role-id')
  assert.equal(profile.data.step_2['bio-html'], '<p>Bio</p>')
  assert.equal(profile.data.step_5['skills-required'], 'skill-id')
  assert.equal(profile.data.step_6['free-consulting-calls'], 'yes')
  assert.equal(profile.data.step_6['paid-consulting-calls'], 'no')
  assert.equal(profile.data.step_6['full-time-placement'], 'no')
  assert.deepEqual(JSON.parse(profile.data.step_6.service), { name: 'Audit', price: '100' })
  assert.deepEqual(JSON.parse(profile.data.step_7.reviewer), {
    email: 'reviewer@example.test',
    'first-name': 'Reviewer',
  })
})

test('uses canonical values only as fallbacks and preserves every active draft key', () => {
  const api = loadApi()
  const merged = api.mergeProfileFallback(
    {
      type: 'full',
      type_id: 'canonical-type',
      last_update: 10,
      data: {
        step_1: { email: 'canonical@example.test', city: 'Canonical City' },
        step_2: { tagline: 'Canonical tagline' },
      },
    },
    {
      type: 'consult',
      type_id: 'draft-type',
      last_update: 20,
      data: {
        step_1: { email: '', phone: '+15551111111' },
      },
    },
  )

  assert.equal(merged.type, 'consult')
  assert.equal(merged.type_id, 'draft-type')
  assert.equal(merged.last_update, 20)
  assert.equal(merged.data.step_1.email, '')
  assert.equal(merged.data.step_1.phone, '+15551111111')
  assert.equal(merged.data.step_1.city, 'Canonical City')
  assert.equal(merged.data.step_2.tagline, 'Canonical tagline')
})

test('select hydration falls back from canonical display text to the authored option value', async () => {
  const window = {
    location: { pathname: '/build-profile/full-profile' },
    MEMBER: { id: 'mem_owned' },
    activeProfile: { type: 'full', type_id: 'type-id', last_update: 1, data: { step_1: {} } },
    waitForMember(callback) { callback() },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        memberstack_id: 'mem_owned',
        Profile_Type: 'Full',
        Country: 'Philippines',
      }),
    }),
    setInterval,
    clearInterval,
  }
  const events = []
  const country = {
    tagName: 'SELECT',
    _value: '',
    options: [
      { value: '', textContent: 'Select country' },
      { value: '168', textContent: 'Philippines' },
    ],
    get value() { return this._value },
    set value(next) {
      this._value = this.options.some((option) => option.value === next) ? next : ''
    },
    getAttribute() { return null },
    dispatchEvent(event) { events.push(event.type) },
  }
  const step = {
    querySelectorAll(selector) {
      return selector === '[name="country"]' ? [country] : []
    },
  }
  const document = {
    readyState: 'complete',
    querySelector(selector) {
      return selector === '[data-form="step"][data-index="1"]' ? step : null
    },
    querySelectorAll() { return [] },
  }
  const context = {
    window,
    document,
    console: { info() {}, warn() {} },
    Event: class Event { constructor(type) { this.type = type } },
    CSS: { escape: String },
    Set,
    Date,
    Promise,
    JSON,
    Array,
  }
  vm.runInNewContext(source, context)
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.equal(country.value, '168')
  assert.deepEqual(events, ['input', 'change'])
})

test('hydrates once after stable member and canonical identity readback', async () => {
  const canonical = {
    memberstack_id: 'mem_owned',
    Profile_Type: 'Full',
    Profile_Type_ID: 'type-id',
    First_Name: 'Owned',
    Email: 'owned@example.test',
  }
  const calls = []
  const window = {
    location: { pathname: '/build-profile/full-profile' },
    MEMBER: { id: 'mem_owned' },
    activeProfile: { type: 'full', type_id: 'type-id', last_update: 1, data: { step_1: {} } },
    waitForMember(callback) { callback() },
    fetch: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 200, json: async () => canonical }
    },
    setInterval,
    clearInterval,
  }
  const document = {
    readyState: 'complete',
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
  const context = {
    window,
    document,
    console: { info() {}, warn() {} },
    Event: class Event {},
    CSS: { escape: String },
    Set,
    Date,
    Promise,
    JSON,
    Array,
  }
  vm.runInNewContext(source, context)
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.equal(calls.length, 1)
  assert.equal(JSON.parse(calls[0].options.body).member_id, 'mem_owned')
  assert.equal(window.activeProfile.data.step_1['first-name'], 'Owned')
  assert.equal(window.__tsBuildProfileCanonicalHydrated, true)
  await window.StartersBuildProfileCanonicalHydrator.hydrate()
  assert.equal(calls.length, 1)
})

test('refuses a canonical row for a different stable member id', async () => {
  const apiWindow = {
    __TS_DISABLE_BUILD_PROFILE_CANONICAL_AUTO_INIT__: true,
    location: { pathname: '/build-profile/full-profile' },
    MEMBER: { id: 'mem_owned' },
    activeProfile: { type: 'full', type_id: 'type-id', last_update: 1, data: {} },
    waitForMember(callback) { callback() },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ memberstack_id: 'mem_other' }),
    }),
    setInterval,
    clearInterval,
  }
  const context = {
    window: apiWindow,
    document: { querySelector() { return null }, querySelectorAll() { return [] } },
    console,
    Event: class Event {},
    CSS: { escape: String },
    Set,
    Date,
    Promise,
    JSON,
    Array,
  }
  vm.runInNewContext(source, context)
  await assert.rejects(
    apiWindow.StartersBuildProfileCanonicalHydrator.hydrate(),
    /canonical profile identity mismatch/,
  )
})
