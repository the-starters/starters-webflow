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
      this.onMessage = () => {}
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
    URLSearchParams,
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

function loadRenderedRecent(recent, unreads = [], options = {}) {
  const calls = { windows: [], conversations: 0, fetches: 0, aborts: 0 }
  let messageHandler
  let resolveRecentFetch
  let unreadHandler
  const recentTimeouts = []
  let scheduledTimeouts = 0
  const makeClassList = () => ({
    add() {},
    remove() {},
    toggle() {},
  })
  const makeField = (tagName = 'DIV') => ({
    tagName,
    style: {},
    textContent: '',
    getAttribute: () => null,
    removeAttribute() {},
  })
  let list

  function makeCard() {
    const name = makeField()
    const initials = makeField()
    const preview = makeField()
    const time = makeField()
    const avatar = makeField('IMG')
    const button = Object.assign(makeField('A'), { addEventListener() {} })
    const fields = {
      '[data-messages-element="name"]': name,
      '[data-messages-element="name_initials"]': initials,
      '[data-messages-element="preview"]': preview,
      '[data-messages-element="time"]': time,
      '[data-messages-element="avatar"]': avatar,
      '.clickable_btn': button,
    }
    const card = {
      style: {},
      classList: makeClassList(),
      fields: { name, initials, preview, time, avatar, button },
      querySelector: (selector) => fields[selector] || null,
      getAttribute: () => null,
      addEventListener() {},
      cloneNode: makeCard,
      remove() {
        const index = list ? list.children.indexOf(card) : -1
        if (index >= 0) list.children.splice(index, 1)
      },
    }
    return card
  }

  const template = makeCard()
  list = {
    style: {},
    children: [],
    querySelector: (selector) =>
      selector === TEMPLATE_SELECTOR ? template : null,
    querySelectorAll() {
      return this.children.slice()
    },
    appendChild(card) {
      this.children.push(card)
    },
  }
  const total = makeField()
  const empty = makeField()
  const loading = makeField()
  const viewAll = Object.assign(makeField('A'), { addEventListener() {} })
  const wrapperFields = {
    [LIST_SELECTOR]: list,
    '[data-messages-element="total"]': total,
    '[data-messages-element="empty"]': empty,
    '[data-messages-element="loading"]': loading,
    '[data-messages-element="view-all"]': viewAll,
  }
  const wrapper = {
    getAttribute: () => null,
    querySelector: (selector) => wrapperFields[selector] || null,
  }

  const Talk = {
    ready: options.talkFails
      ? {
          then(resolve, reject) {
            reject(new Error('TalkJS unavailable'))
          },
        }
      : Promise.resolve(),
    User: function User() {},
    Session: function Session() {
      this.onMessage = (handler) => {
        messageHandler = handler
      }
      this.conversation = () => {
        calls.conversations += 1
        return {}
      }
      this.unreads = {
        onChange(handler) {
          unreadHandler = handler
          handler(unreads)
        },
      }
    },
  }
  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({ data: { id: MY_ID } }),
    },
    getXanoAuthToken: async () => 'xano-token',
    Talk,
    open(...args) {
      calls.windows.push(args)
    },
    addEventListener() {},
    location: { assign() {} },
    setInterval,
    clearInterval,
    setTimeout(callback, delay) {
      scheduledTimeouts += 1
      if (
        options.manualRecentTimeout &&
        delay === 15000 &&
        scheduledTimeouts !== 2
      ) {
        recentTimeouts.push(callback)
        return recentTimeouts.length
      }
      return setTimeout(callback, delay)
    },
    clearTimeout,
    AbortController: function AbortController() {
      this.signal = { aborted: false }
      this.abort = () => {
        this.signal.aborted = true
        calls.aborts += 1
      }
    },
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
    URLSearchParams,
    console,
    document,
    encodeURIComponent,
    fetch: async () => {
      calls.fetches += 1
      if (calls.fetches <= (options.hangAttempts || 0)) {
        return new Promise(() => {})
      }
      if (options.hangRecent) return new Promise(() => {})
      const response = {
        ok: true,
        json: async () => ({
          items: (() => {
            const snapshot =
              calls.fetches > 1 && options.refreshedRecent !== undefined
                ? options.refreshedRecent
                : recent
            return Array.isArray(snapshot) ? snapshot : [snapshot]
          })(),
        }),
      }
      if (!options.deferRecent || calls.fetches > 1) return response
      return new Promise((resolve) => {
        resolveRecentFetch = () => resolve(response)
      })
    },
    window,
  })

  return {
    calls,
    empty,
    emitMessage(message = {}) {
      messageHandler(message)
    },
    emitUnreads(nextUnreads) {
      unreadHandler(nextUnreads)
    },
    list,
    loading,
    total,
    resolveRecent() {
      resolveRecentFetch()
    },
    runRecentTimeout() {
      const timeout = recentTimeouts.shift()
      if (!timeout) throw new Error('No recent timeout is pending')
      timeout()
    },
  }
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

test('participant identity overrides conversation metadata', async () => {
  const { calls, list } = loadRenderedRecent({
    id: 'one:mem_me|mem_other',
    subject: 'Project conversation',
    photo_url: 'https://cdn.example/project.jpg',
    participant_name: 'Acme Brand',
    participant_photo_url: 'https://cdn.example/acme.jpg',
    last_message_text: 'Ready when you are',
    last_message_at: Date.now(),
    unread: false,
  })

  await settle()

  const card = list.children[list.children.length - 1]
  assert.equal(card.fields.name.textContent, 'Acme Brand')
  assert.equal(card.fields.avatar.src, 'https://cdn.example/acme.jpg')
  assert.equal(card.fields.avatar.alt, 'Acme Brand')
  assert.equal(card.fields.initials.style.display, 'none')
  assert.equal(calls.fetches, 1)
  assert.equal(calls.conversations, 0)
})

test('the dashboard preserves proxy order and the 3-card maximum', async () => {
  const recent = [
    { name: 'Recently joined', timestamp: 1, unread: false },
    { name: 'Newer message', timestamp: 4, unread: true },
    { name: 'Third', timestamp: 3, unread: false },
    { name: 'Fourth', timestamp: 2, unread: false },
  ].map((conversation, index) => ({
    id: `one:mem_me|mem_other_${index}`,
    participant_name: conversation.name,
    participant_photo_url: null,
    last_message_text: `Message ${index}`,
    last_message_at: conversation.timestamp,
    unread: conversation.unread,
  }))
  const { list } = loadRenderedRecent(recent)

  await settle()

  assert.equal(list.children.length, 3)
  assert.deepEqual(
    list.children.map((card) => card.fields.name.textContent),
    ['Recently joined', 'Newer message', 'Third'],
  )
})

test('empty TalkJS conversations never displace conversations with messages', async () => {
  const { list } = loadRenderedRecent([
    {
      id: 'empty:megan',
      participant_name: 'Megan',
      participant_photo_url: null,
      last_message_text: null,
      last_message_at: null,
      unread: false,
    },
    {
      id: 'active:jai',
      participant_name: 'Jai',
      participant_photo_url: null,
      last_message_text: 'Paid consultation request',
      last_message_at: 2,
      unread: false,
    },
    {
      id: 'empty:dominic',
      participant_name: 'Dominic',
      participant_photo_url: null,
      last_message_text: null,
      last_message_at: null,
      unread: false,
    },
    {
      id: 'active:kaeser',
      participant_name: 'Kaeser',
      participant_photo_url: null,
      last_message_text: 'Free consultation request',
      last_message_at: 1,
      unread: false,
    },
  ])

  await settle()

  assert.deepEqual(
    list.children.map((card) => card.fields.name.textContent),
    ['Jai', 'Kaeser'],
  )
})

test('empty unread conversations stay in the badge but out of cards', async () => {
  const { list, total } = loadRenderedRecent({
    id: 'empty:unread',
    participant_name: 'Unread Brand',
    participant_photo_url: null,
    last_message_text: null,
    last_message_at: null,
    unread: true,
  })

  await settle()

  assert.equal(list.children.length, 0)
  assert.equal(total.textContent, '1')
  assert.equal(total.style.display, '')
})

test('participant without a photo ignores conversation artwork', async () => {
  const { list } = loadRenderedRecent({
    id: 'one:mem_me|mem_other',
    subject: 'Project conversation',
    photo_url: 'https://cdn.example/project.jpg',
    participant_name: 'Acme Brand',
    participant_photo_url: null,
    last_message_text: 'Ready when you are',
    last_message_at: 1,
    unread: false,
  })

  await settle()

  const card = list.children[list.children.length - 1]
  assert.equal(card.fields.name.textContent, 'Acme Brand')
  assert.equal(card.fields.avatar.style.display, 'none')
  assert.equal(card.fields.initials.textContent, 'AB')
  assert.equal(card.fields.initials.style.display, '')
})

test('live unread state preserves bulk participant identity', async () => {
  const conversationId = 'one:mem_me|mem_other'
  const { list } = loadRenderedRecent(
    {
      id: conversationId,
      participant_name: 'Acme Brand',
      participant_photo_url: 'https://cdn.example/acme.jpg',
      last_message_text: 'Older preview',
      last_message_at: 1,
      unread: false,
    },
    [
      {
        conversation: { id: conversationId },
        lastMessage: {
          isByMe: true,
          body: 'Latest preview',
          timestamp: 2,
        },
      },
    ],
  )

  await settle()

  const card = list.children[list.children.length - 1]
  assert.equal(card.fields.name.textContent, 'Acme Brand')
  assert.equal(card.fields.avatar.src, 'https://cdn.example/acme.jpg')
  assert.equal(card.fields.preview.textContent, 'Latest preview')
})

test('SDK activity refreshes cards in authoritative proxy order', async () => {
  const activeId = 'one:mem_me|mem_active'
  const { calls, emitUnreads, list } = loadRenderedRecent(
    [
      {
        id: 'one:mem_me|mem_first',
        participant_name: 'First Brand',
        last_message_text: 'First message',
        last_message_at: 3,
        unread: false,
      },
      {
        id: 'one:mem_me|mem_second',
        participant_name: 'Second Brand',
        last_message_text: 'Second message',
        last_message_at: 2,
        unread: false,
      },
      {
        id: 'one:mem_me|mem_third',
        participant_name: 'Third Brand',
        last_message_text: 'Third message',
        last_message_at: 1,
        unread: false,
      },
    ],
    [],
    {
      refreshedRecent: [
        {
          id: activeId,
          participant_name: 'Newly Active Brand',
          last_message_text: 'New activity',
          last_message_at: 4,
          unread: true,
        },
        {
          id: 'one:mem_me|mem_first',
          participant_name: 'First Brand',
          last_message_text: 'First message',
          last_message_at: 3,
          unread: false,
        },
        {
          id: 'one:mem_me|mem_second',
          participant_name: 'Second Brand',
          last_message_text: 'Second message',
          last_message_at: 2,
          unread: false,
        },
      ],
    },
  )

  await settle()

  emitUnreads([
    {
      conversation: { id: activeId },
      lastMessage: { timestamp: 4, body: 'New activity' },
    },
  ])
  await settle()

  assert.equal(calls.fetches, 2)
  assert.deepEqual(
    list.children.map((card) => card.fields.name.textContent),
    ['Newly Active Brand', 'First Brand', 'Second Brand'],
  )
})

test('message activity refreshes proxy order without an unread change', async () => {
  const { calls, emitMessage, list } = loadRenderedRecent(
    [
      {
        id: 'one:mem_me|mem_first',
        participant_name: 'First Brand',
        last_message_text: 'First message',
        last_message_at: 3,
        unread: false,
      },
      {
        id: 'one:mem_me|mem_second',
        participant_name: 'Second Brand',
        last_message_text: 'Second message',
        last_message_at: 2,
        unread: false,
      },
      {
        id: 'one:mem_me|mem_third',
        participant_name: 'Third Brand',
        last_message_text: 'Third message',
        last_message_at: 1,
        unread: false,
      },
    ],
    [],
    {
      refreshedRecent: [
        {
          id: 'one:mem_me|mem_third',
          participant_name: 'Third Brand',
          last_message_text: 'Reply from me',
          last_message_at: 4,
          unread: false,
        },
        {
          id: 'one:mem_me|mem_first',
          participant_name: 'First Brand',
          last_message_text: 'First message',
          last_message_at: 3,
          unread: false,
        },
        {
          id: 'one:mem_me|mem_second',
          participant_name: 'Second Brand',
          last_message_text: 'Second message',
          last_message_at: 2,
          unread: false,
        },
      ],
    },
  )

  await settle()
  emitMessage({ senderId: MY_ID })
  await settle()

  assert.equal(calls.fetches, 2)
  assert.deepEqual(
    list.children.map((card) => card.fields.name.textContent),
    ['Third Brand', 'First Brand', 'Second Brand'],
  )
})

test('the first SDK snapshot reconciles a stale in-flight proxy snapshot', async () => {
  const activeId = 'one:mem_me|mem_active_during_load'
  const { calls, list, resolveRecent } = loadRenderedRecent(
    [
      {
        id: 'one:mem_me|mem_first',
        participant_name: 'First Brand',
        last_message_text: 'First message',
        last_message_at: 3,
        unread: false,
      },
      {
        id: 'one:mem_me|mem_second',
        participant_name: 'Second Brand',
        last_message_text: 'Second message',
        last_message_at: 2,
        unread: false,
      },
      {
        id: 'one:mem_me|mem_third',
        participant_name: 'Third Brand',
        last_message_text: 'Third message',
        last_message_at: 1,
        unread: false,
      },
    ],
    [
      {
        conversation: { id: activeId },
        lastMessage: { timestamp: 4, body: 'Arrived during load' },
      },
    ],
    {
      deferRecent: true,
      refreshedRecent: [
        {
          id: activeId,
          participant_name: 'Newly Active Brand',
          last_message_text: 'Arrived during load',
          last_message_at: 4,
          unread: true,
        },
        {
          id: 'one:mem_me|mem_first',
          participant_name: 'First Brand',
          last_message_text: 'First message',
          last_message_at: 3,
          unread: false,
        },
        {
          id: 'one:mem_me|mem_second',
          participant_name: 'Second Brand',
          last_message_text: 'Second message',
          last_message_at: 2,
          unread: false,
        },
      ],
    },
  )

  await settle(5)
  assert.equal(list.children.length, 0)

  resolveRecent()
  await settle()

  assert.equal(calls.fetches, 2)
  assert.deepEqual(
    list.children.map((card) => card.fields.name.textContent),
    ['Newly Active Brand', 'First Brand', 'Second Brand'],
  )
})

test('SDK-only unread stays out of cards but remains in the badge', async () => {
  const laggingId = 'one:mem_me|mem_lagging'
  const { list, resolveRecent, total } = loadRenderedRecent(
    {
      id: 'one:mem_me|mem_known',
      participant_name: 'Known Brand',
      participant_photo_url: 'https://cdn.example/known.jpg',
      last_message_text: 'Bulk snapshot',
      last_message_at: 1,
      unread: false,
    },
    [
      {
        conversation: {
          id: laggingId,
          subject: 'Conversation metadata',
          photoUrl: 'https://cdn.example/conversation.jpg',
        },
        lastMessage: {
          isByMe: true,
          body: 'Waiting for the bulk snapshot',
          timestamp: 2,
        },
      },
    ],
    { deferRecent: true },
  )

  await settle(5)

  assert.equal(list.children.length, 0)

  resolveRecent()
  await settle()

  assert.equal(
    list.children.some((card) =>
      String(card.fields.button.href).includes(encodeURIComponent(laggingId)),
    ),
    false,
  )
  assert.equal(total.textContent, '1')
})

test('a stalled bulk request aborts and settles the empty state', async () => {
  const { calls, empty, list, loading, runRecentTimeout } = loadRenderedRecent(
    [],
    [],
    { hangRecent: true, manualRecentTimeout: true },
  )

  await settle(5)
  runRecentTimeout()
  await settle(5)
  runRecentTimeout()
  await settle()

  assert.equal(calls.aborts, 2)
  assert.equal(calls.fetches, 2)
  assert.equal(list.children.length, 0)
  assert.equal(loading.style.display, 'none')
  assert.equal(empty.style.display, '')
})

test('a timed-out bulk request retries before showing an empty state', async () => {
  const { calls, empty, list, runRecentTimeout } = loadRenderedRecent(
    {
      id: 'one:mem_me|mem_other',
      participant_name: 'Recovered Brand',
      participant_photo_url: 'https://cdn.example/recovered.jpg',
      last_message_text: 'Loaded after retry',
      last_message_at: 1,
      unread: false,
    },
    [],
    { hangAttempts: 1, manualRecentTimeout: true },
  )

  await settle(5)
  runRecentTimeout()
  await settle()

  assert.equal(calls.aborts, 1)
  assert.equal(calls.fetches, 2)
  assert.equal(list.children.length, 1)
  assert.equal(list.children[0].fields.name.textContent, 'Recovered Brand')
  assert.equal(empty.style.display, 'none')
})

test('bulk recent conversations render when TalkJS initialization fails', async () => {
  const { list } = loadRenderedRecent(
    {
      id: 'one:mem_me|mem_other',
      participant_name: 'Acme Brand',
      participant_photo_url: 'https://cdn.example/acme.jpg',
      last_message_text: 'Still available',
      last_message_at: 1,
      unread: false,
    },
    [],
    { talkFails: true },
  )

  await settle()

  const card = list.children[list.children.length - 1]
  assert.equal(card.fields.name.textContent, 'Acme Brand')
  assert.equal(card.fields.preview.textContent, 'Still available')
})

test('a message card links to its focused conversation in a new tab', async () => {
  const { list } = loadRenderedRecent({
    id: 'one:mem_me|mem_other',
    participant_name: 'Acme Brand',
    last_message_text: 'Hello',
    last_message_at: 1,
  })

  await settle()

  const link = list.children[list.children.length - 1].fields.button
  assert.equal(
    link.href,
    '/messages?conversation=one%3Amem_me%7Cmem_other',
  )
  assert.equal(link.target, '_blank')
  assert.equal(link.rel, 'noopener')
})
