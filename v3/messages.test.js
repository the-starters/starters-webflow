const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./messages.js'), 'utf8')

const MY_ID = 'mem_me00000000000000000000'
const OTHER_ID = 'mem_other0000000000000000'
const HANDOFF_KEY = 'starters:hire-message-handoff'

function member(id = MY_ID) {
  return {
    id,
    auth: { email: 'brand@example.com' },
    // 'free-user' is this site's legacy Memberstack key for the first name.
    customFields: { 'free-user': 'Brand', 'last-name': 'Owner' },
  }
}

/**
 * Loads the module against a stubbed document/window.
 *
 * options.member    — Memberstack member (null = logged out)
 * options.search    — window.location.search
 * options.handoff   — value stored under the handoff key (object or string)
 * options.onSelect  — override inbox.select (e.g. to throw)
 * options.talk      — false to omit the TalkJS stub entirely
 */
function loadMessages(options = {}) {
  const replacements = []
  const warnings = []
  const errors = []
  const calls = { users: [], conversations: [], selected: [], mounted: [] }
  const container = {}
  const storage = new Map()

  if (options.handoff !== undefined) {
    storage.set(
      HANDOFF_KEY,
      typeof options.handoff === 'string'
        ? options.handoff
        : JSON.stringify(options.handoff),
    )
  }

  const inbox = {
    mount(target) {
      calls.mounted.push(target)
    },
    select(conversation) {
      if (options.onSelect) return options.onSelect(conversation)
      calls.selected.push(conversation)
      return Promise.resolve()
    },
  }

  function conversationStub(id) {
    const conversation = {
      id,
      participants: [],
      attributes: null,
      setParticipant(user) {
        conversation.participants.push(user)
      },
      setAttributes(attributes) {
        conversation.attributes = attributes
      },
    }
    calls.conversations.push(conversation)
    return conversation
  }

  const Talk = {
    ready: Promise.resolve(),
    // Records the constructor argument verbatim so a test can tell an id-only
    // reference (a string) from a field-carrying sync (an object).
    User: function User(fields) {
      calls.users.push(fields)
      this.fields = fields
    },
    oneOnOneId(a, b) {
      return 'one:' + [a, b].sort().join('|')
    },
    Session: function Session(sessionOptions) {
      calls.session = sessionOptions
      this.getOrCreateConversation = conversationStub
      this.createInbox = (inboxOptions) => {
        calls.inboxOptions = inboxOptions
        return inbox
      }
    },
  }

  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({
        data: options.member === undefined ? member() : options.member,
      }),
    },
    addEventListener() {},
    location: {
      pathname: options.pathname || '/messages',
      search: options.search || '',
      replace(value) {
        replacements.push(value)
      },
    },
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  }
  if (options.talk !== false) window.Talk = Talk

  const document = {
    addEventListener() {},
    createElement() {
      return {}
    },
    getElementById(id) {
      return id === 'talkjs-container' ? container : null
    },
    head: { appendChild() {} },
    readyState: 'complete',
  }

  vm.runInNewContext(source, {
    URLSearchParams,
    JSON,
    Promise,
    console: {
      error(...args) {
        errors.push(args.join(' '))
      },
      warn(...args) {
        warnings.push(args.map(String).join(' '))
      },
    },
    document,
    encodeURIComponent,
    window,
  })

  return { replacements, warnings, errors, calls, container, storage, window }
}

/**
 * Objects built inside the vm carry that realm's Object.prototype, which
 * assert/strict treats as unequal to a host literal. Normalize before comparing.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Drains enough microtask/macrotask turns for the full mount chain to settle. */
async function settle(turns = 25) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('logged-out Messages visitors retain the requested path and query', async () => {
  const { replacements } = loadMessages({
    member: null,
    pathname: '/messages',
    search: '?conversation=brand-a',
  })

  await settle(2)

  assert.deepEqual(replacements, [
    '/login?next=%2Fmessages%3Fconversation%3Dbrand-a',
  ])
})

test('a visit without ?with= mounts the inbox and touches no conversation', async () => {
  const { calls, errors } = loadMessages({ search: '' })

  await settle()

  assert.equal(calls.mounted.length, 1)
  assert.equal(calls.conversations.length, 0)
  assert.equal(calls.selected.length, 0)
  assert.deepEqual(errors, [])
})

test('the current member syncs a changed login email to the same stable TalkJS user', async () => {
  const updatedMember = member()
  updatedMember.auth.email = 'starter.canary@example.com'
  const { calls, errors } = loadMessages({ member: updatedMember, search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]), {
    id: MY_ID,
    name: 'Brand',
    email: 'starter.canary@example.com',
    custom: { company: '' },
  })
  assert.deepEqual(errors, [])
})

test('the display name is the first name alone, never the last name', async () => {
  const { calls } = loadMessages({ search: '' })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'Brand')
})

test('a member carrying only a first-name key still gets that first name', async () => {
  const legacyMember = member()
  legacyMember.customFields = { 'first-name': 'Brand', 'last-name': 'Owner' }
  const { calls } = loadMessages({ member: legacyMember, search: '' })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'Brand')
})

test('a nameless member on the free Brand plan reads "Brand Name"', async () => {
  const namelessMember = member()
  namelessMember.customFields = {}
  namelessMember.planConnections = [
    { planId: 'pln_free-plan-f6kn0dxz', active: true },
  ]
  const { calls } = loadMessages({ member: namelessMember, search: '' })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'Brand Name')
})

test('a nameless member on the paid Brand plan reads "Brand Name"', async () => {
  const namelessMember = member()
  namelessMember.customFields = {}
  // The status-string flavor of "active" that route-guard also accepts.
  namelessMember.planConnections = [
    { planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' },
  ]
  const { calls } = loadMessages({ member: namelessMember, search: '' })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'Brand Name')
})

test('a nameless Talent member reads "Starter Name"', async () => {
  const namelessMember = member()
  namelessMember.customFields = {}
  namelessMember.planConnections = [
    { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true },
  ]
  const { calls } = loadMessages({ member: namelessMember, search: '' })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'Starter Name')
})

test('a nameless member with no mapped active plan keeps the generic default', async () => {
  const namelessMember = member()
  namelessMember.customFields = {}
  namelessMember.planConnections = [
    { planId: 'pln_something-unmapped-000000', active: true },
    { planId: 'pln_new-paid-plan-463h04ph', active: false, status: 'CANCELED' },
  ]
  const { calls } = loadMessages({ member: namelessMember, search: '' })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'The Starters member')
})

test('conflicting Brand and Talent plans fail closed to the generic default', async () => {
  const namelessMember = member()
  namelessMember.customFields = {}
  namelessMember.planConnections = [
    { planId: 'pln_new-paid-plan-463h04ph', active: true },
    { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true },
  ]
  const { calls } = loadMessages({ member: namelessMember, search: '' })

  await settle()

  assert.equal(plain(calls.users[0]).name, 'The Starters member')
})

test('the email field stays synced even when the name is a placeholder', async () => {
  const namelessMember = member()
  namelessMember.customFields = {}
  namelessMember.planConnections = [
    { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true },
  ]
  const { calls } = loadMessages({ member: namelessMember, search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]), {
    id: MY_ID,
    name: 'Starter Name',
    email: 'brand@example.com',
    custom: { company: '' },
  })
})

test('a member with a company gets it synced trimmed into custom.company', async () => {
  const companyMember = member()
  companyMember.customFields = { 'free-user': 'Brand', company: '  Acme Co  ' }
  const { calls } = loadMessages({ member: companyMember, search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: 'Acme Co' })
})

test('a member without a company syncs an empty custom.company to self-clear', async () => {
  const { calls } = loadMessages({ search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: '' })
})

test('?with= opens the one-on-one conversation and selects it', async () => {
  const { calls } = loadMessages({
    search: '?with=' + OTHER_ID,
    handoff: {
      id: OTHER_ID,
      name: 'Kaeser Valencerina',
      photo: 'https://x08a.example/vault/freelancer-5.jpg',
      slug: 'kaeser-valencerina',
    },
  })

  await settle()

  assert.equal(calls.conversations.length, 1)
  const conversation = calls.conversations[0]
  assert.equal(conversation.id, 'one:' + [MY_ID, OTHER_ID].sort().join('|'))
  assert.equal(conversation.participants.length, 2)
  assert.deepEqual(plain(conversation.attributes), {
    custom: { source: 'hire-page', slug: 'kaeser-valencerina' },
  })
  assert.deepEqual(calls.selected, [conversation])

  // Second Talk.User is the starter, built from the handoff fields.
  assert.deepEqual(plain(calls.users[1]), {
    id: OTHER_ID,
    name: 'Kaeser Valencerina',
    photoUrl: 'https://x08a.example/vault/freelancer-5.jpg',
  })
})

test('the handoff is consumed so it cannot be replayed', async () => {
  const { storage } = loadMessages({
    search: '?with=' + OTHER_ID,
    handoff: { id: OTHER_ID, name: 'Kaeser', photo: '', slug: 'k' },
  })

  await settle()

  assert.equal(storage.has(HANDOFF_KEY), false)
})

test('with no handoff the starter is referenced by id alone', async () => {
  const { calls } = loadMessages({ search: '?with=' + OTHER_ID })

  await settle()

  assert.equal(calls.conversations.length, 1)
  assert.equal(calls.users[1], OTHER_ID)
  assert.deepEqual(plain(calls.conversations[0].attributes), {
    custom: { source: 'hire-page', slug: '' },
  })
})

test('a handoff naming a different member is ignored, not applied', async () => {
  const { calls, storage } = loadMessages({
    search: '?with=' + OTHER_ID,
    handoff: {
      id: 'mem_someoneelse000000000',
      name: 'Wrong Person',
      photo: 'https://x08a.example/wrong.jpg',
      slug: 'wrong',
    },
  })

  await settle()

  assert.equal(calls.users[1], OTHER_ID)
  assert.equal(calls.conversations[0].attributes.custom.slug, '')
  assert.equal(storage.has(HANDOFF_KEY), false)
})

test('a non-https handoff photo is dropped and the name kept', async () => {
  const { calls } = loadMessages({
    search: '?with=' + OTHER_ID,
    handoff: {
      id: OTHER_ID,
      name: 'Kaeser Valencerina',
      photo: 'javascript:alert(1)',
      slug: 'kaeser-valencerina',
    },
  })

  await settle()

  assert.deepEqual(plain(calls.users[1]), { id: OTHER_ID, name: 'Kaeser Valencerina' })
})

test('corrupt handoff JSON degrades to an id-only reference', async () => {
  const { calls } = loadMessages({
    search: '?with=' + OTHER_ID,
    handoff: '{not json',
  })

  await settle()

  assert.equal(calls.conversations.length, 1)
  assert.equal(calls.users[1], OTHER_ID)
})

test('a sandbox (Test Mode) ?with= id opens the conversation like a live id', async () => {
  const SANDBOX_ID = 'mem_sb_cmqhuaxn80d270sseeo74fn7i'
  const { calls } = loadMessages({ search: '?with=' + SANDBOX_ID })

  await settle()

  assert.equal(calls.conversations.length, 1)
  assert.equal(calls.users[1], SANDBOX_ID)
})

test('a malformed ?with= value is ignored', async () => {
  for (const value of ['not-a-member', 'mem_', 'mem_sb_', '', 'mem_bad-id', 'mem_sb_extra_underscore', '../../etc']) {
    const { calls } = loadMessages({ search: '?with=' + encodeURIComponent(value) })

    await settle()

    assert.equal(calls.conversations.length, 0, 'rejected: ' + JSON.stringify(value))
    assert.equal(calls.mounted.length, 1, 'inbox still mounts: ' + value)
  }
})

test('a self-link creates no conversation', async () => {
  const { calls } = loadMessages({ search: '?with=' + MY_ID })

  await settle()

  assert.equal(calls.conversations.length, 0)
  assert.equal(calls.mounted.length, 1)
})

test('a failing select leaves the mounted inbox intact and warns', async () => {
  const { calls, warnings, errors } = loadMessages({
    search: '?with=' + OTHER_ID,
    onSelect: () => Promise.reject(new Error('select exploded')),
  })

  await settle()

  assert.equal(calls.mounted.length, 1)
  assert.equal(errors.length, 0, 'the mount error path is not triggered')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Unable to open the requested conversation/)
})

test('sessionStorage being unavailable degrades to an id-only reference', async () => {
  const loaded = loadMessages({ search: '?with=' + OTHER_ID })
  loaded.window.sessionStorage = {
    getItem() {
      throw new Error('storage disabled')
    },
  }

  await settle()

  assert.equal(loaded.calls.conversations.length, 1)
})
