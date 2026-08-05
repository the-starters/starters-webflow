const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./starter-dashboard-messages.js'),
  'utf8',
)

const MY_ID = 'mem_me00000000000000000000'
const WRAPPER_SELECTOR = '[data-messages-element="wrapper"]'
const LIST_SELECTOR = '[data-messages-element="list"]'
const TEMPLATE_SELECTOR = '[data-messages-element="template"]'

/** The bare element surface the tile module touches during boot. */
function element(overrides = {}) {
  return Object.assign(
    {
      style: {},
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      addEventListener() {},
      cloneNode() {
        return element()
      },
      remove() {},
    },
    overrides,
  )
}

/**
 * Loads the module against a stubbed document/window carrying one minimal
 * wrapper (list + template) so mountTile reaches the TalkJS user sync.
 *
 * options.member — Memberstack member (null = logged out)
 */
function loadTile(options = {}) {
  const calls = { users: [], sessions: [] }
  const warnings = []
  const errors = []

  const template = element()
  const list = element({
    querySelector: (selector) =>
      selector === TEMPLATE_SELECTOR ? template : null,
  })
  const wrapper = element({
    querySelector: (selector) => (selector === LIST_SELECTOR ? list : null),
  })

  const Talk = {
    ready: Promise.resolve(),
    // Records the constructor argument verbatim so a test can inspect the
    // synced fields.
    User: function User(fields) {
      calls.users.push(fields)
      this.fields = fields
    },
    Session: function Session(sessionOptions) {
      calls.sessions.push(sessionOptions)
      this.unreads = { onChange() {} }
    },
  }

  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({
        data: options.member === undefined ? null : options.member,
      }),
      // No session cookie: the Xano recent-messages fetch fails early and
      // the tile degrades to unreads-only, which is all this suite needs.
      getMemberCookie: async () => null,
    },
    Talk,
    addEventListener() {},
    location: { assign() {} },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  }

  const document = {
    addEventListener() {},
    createElement() {
      return { dataset: {} }
    },
    getElementById: () => null,
    head: { appendChild() {} },
    querySelectorAll: (selector) =>
      selector === WRAPPER_SELECTOR ? [wrapper] : [],
    readyState: 'complete',
  }

  vm.runInNewContext(source, {
    JSON,
    Promise,
    console: {
      error(...args) {
        errors.push(args.map(String).join(' '))
      },
      warn(...args) {
        warnings.push(args.map(String).join(' '))
      },
    },
    document,
    encodeURIComponent,
    window,
  })

  return { calls, warnings, errors, window }
}

/**
 * Objects built inside the vm carry that realm's Object.prototype, which
 * assert/strict treats as unequal to a host literal. Normalize before comparing.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Drains enough microtask/macrotask turns for the mount chain to settle. */
async function settle(turns = 25) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('the display name is the first name alone, never the last name', async () => {
  const { calls, errors } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      // 'free-user' is this site's legacy Memberstack key for the first name.
      customFields: { 'free-user': 'Kaeser', 'last-name': 'Valencerina' },
    },
  })

  await settle()

  assert.deepEqual(plain(calls.users[0]), {
    id: MY_ID,
    name: 'Kaeser',
    email: 'starter@example.com',
    custom: { company: '' },
  })
  assert.deepEqual(errors, [])
})

test('a member carrying only a first-name key still gets that first name', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: { 'first-name': 'Kaeser', 'last-name': 'Valencerina' },
    },
  })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'Kaeser')
})

test('a nameless Talent member reads "Starter Name", never the email', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: {},
      planConnections: [
        { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true },
      ],
    },
  })

  await settle()

  // The email stays synced as a field — it just never becomes the name.
  assert.deepEqual(plain(calls.users[0]), {
    id: MY_ID,
    name: 'Starter Name',
    email: 'starter@example.com',
    custom: { company: '' },
  })
})

test('a member with a company gets it synced trimmed into custom.company', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: { 'free-user': 'Kaeser', company: '  Acme Co  ' },
    },
  })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: 'Acme Co' })
})

test('a member without a company or mapped plan syncs a blank custom.company', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: { 'free-user': 'Kaeser' },
    },
  })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: '' })
})

test('a Brand without a company reads "Company Name"', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: {},
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', active: true }],
    },
  })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: 'Company Name' })
})

test('a Brand with a company keeps the real company over the placeholder', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: { 'free-user': 'Kaeser', company: '  Acme Co  ' },
      planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', active: true }],
    },
  })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: 'Acme Co' })
})

test('conflicting plan roles fail closed to a blank company', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: {},
      planConnections: [
        { planId: 'pln_new-paid-plan-463h04ph', active: true },
        { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true },
      ],
    },
  })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: '' })
})

test('a nameless member with no mapped active plan keeps the generic default', async () => {
  const { calls } = loadTile({
    member: {
      id: MY_ID,
      auth: { email: 'starter@example.com' },
      customFields: {},
      planConnections: [],
    },
  })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'The Starters member')
})

test('the release marker matches the header @release line', () => {
  const marker = source.match(/^ \* @release (v\d+\.\d+\.\d+)$/m)
  assert.ok(
    marker,
    'no "@release vX.Y.Z" line in the starter-dashboard-messages.js header',
  )
})
