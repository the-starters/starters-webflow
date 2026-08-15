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
 * options.actions   — false to omit the custom-action methods (older SDK)
 * options.fetch     — replaces window.fetch for the Clickable Identity handler
 * options.popupBlocked — window.open returns null, as a blocked popup does
 * options.steerThrows  — steering a reserved tab throws, as a refused
 *                        navigation does
 * options.hostname  — window.location.hostname, which gates staging diagnostics
 */
function loadMessages(options = {}) {
  const replacements = []
  const warnings = []
  const errors = []
  const calls = {
    users: [],
    conversations: [],
    selected: [],
    mounted: [],
    // Clickable Identity: which actions were registered, and what the handler
    // did with the network and with window.open.
    messageActions: new Map(),
    conversationActions: new Map(),
    fetches: [],
    opens: [],
    // Fake window handles returned by window.open, so the reserved-tab path is
    // observable: which URL it was steered to, whether it was closed again.
    handles: [],
    conversationSelected: [],
    aborts: [],
    // Every window.setTimeout the module arms, so a test can assert the
    // identity handler's abort budget and fire it without waiting 4 seconds.
    timers: [],
  }
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
  if (options.actions !== false) {
    inbox.onCustomMessageAction = (action, handler) => {
      calls.messageActions.set(action, handler)
    }
    inbox.onCustomConversationAction = (action, handler) => {
      calls.conversationActions.set(action, handler)
    }
    inbox.onConversationSelected = (handler) => {
      calls.conversationSelected.push(handler)
    }
    // setFeedFilter is what installFeedFilterActions checks for; without it the
    // feed filters silently skip registration and a test could mistake that for
    // the identity actions being missing too.
    inbox.setFeedFilter = () => {}
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
      // Staging diagnostics are gated on this; the default is a non-staging
      // host so the silence-in-production path is what most tests exercise.
      hostname: options.hostname || 'thestarters.com',
      replace(value) {
        replacements.push(value)
      },
    },
    open(...args) {
      calls.opens.push(args)
      if (options.popupBlocked) return null
      const handle = {
        closed: false,
        opener: {},
        hrefs: [],
        close() {
          handle.closed = true
        },
        location: {
          set href(value) {
            // A navigation the browser refuses: a stale handle, or one the
            // page is no longer allowed to steer.
            if (options.steerThrows) throw new Error('navigation refused')
            handle.hrefs.push(value)
          },
          get href() {
            return handle.hrefs[handle.hrefs.length - 1] || ''
          },
        },
      }
      calls.handles.push(handle)
      return handle
    },
    fetch(url, init) {
      calls.fetches.push({ url, init })
      if (init && init.signal) {
        init.signal.addEventListener('abort', () => calls.aborts.push(url))
      }
      return options.fetch
        ? options.fetch(url, init, calls)
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ slug: '' }) })
    },
    AbortController,
    sessionStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setInterval,
    clearInterval,
    setTimeout(fn, ms, ...rest) {
      calls.timers.push({ ms, fire: fn })
      return setTimeout(fn, ms, ...rest)
    },
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

test('?conversation= selects that existing conversation without mutating it', async () => {
  const conversationId = 'one:mem_me|mem_other'
  const { calls } = loadMessages({
    search: '?conversation=' + encodeURIComponent(conversationId),
  })

  await settle()

  assert.deepEqual(calls.selected, [conversationId])
  assert.equal(calls.conversations.length, 0)
})

test('?conversation= takes precedence over ?with=', async () => {
  const { calls } = loadMessages({
    search:
      '?conversation=existing-thread&with=' + encodeURIComponent(OTHER_ID),
  })

  await settle()

  assert.deepEqual(calls.selected, ['existing-thread'])
  assert.equal(calls.conversations.length, 0)
})

test('a malformed conversation id is ignored without breaking the inbox', async () => {
  const { calls } = loadMessages({ search: '?conversation=%0A' })

  await settle()

  assert.equal(calls.mounted.length, 1)
  assert.deepEqual(calls.selected, [])
  assert.equal(calls.conversations.length, 0)
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

test('a member without a company or mapped plan syncs a blank custom.company', async () => {
  const { calls } = loadMessages({ search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: '' })
})

test('a Brand without a company reads "Company Name"', async () => {
  const namelessMember = member()
  namelessMember.customFields = {}
  namelessMember.planConnections = [
    { planId: 'pln_new-paid-plan-463h04ph', active: true },
  ]
  const { calls } = loadMessages({ member: namelessMember, search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: 'Company Name' })
})

test('a Brand with a company keeps the real company over the placeholder', async () => {
  const companyMember = member()
  companyMember.customFields = { 'free-user': 'Brand', company: '  Acme Co  ' }
  companyMember.planConnections = [
    { planId: 'pln_free-plan-f6kn0dxz', active: true },
  ]
  const { calls } = loadMessages({ member: companyMember, search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: 'Acme Co' })
})

test('a Talent member without a company keeps a blank company', async () => {
  const talentMember = member()
  talentMember.customFields = {}
  talentMember.planConnections = [
    { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true },
  ]
  const { calls } = loadMessages({ member: talentMember, search: '' })

  await settle()

  assert.deepEqual(plain(calls.users[0]).custom, { company: '' })
})

test('conflicting plan roles fail closed to a blank company', async () => {
  const conflictedMember = member()
  conflictedMember.customFields = {}
  conflictedMember.planConnections = [
    { planId: 'pln_new-paid-plan-463h04ph', active: true },
    { planId: 'pln_dorxata-test-free-plan-dvcg0k8o', active: true },
  ]
  const { calls } = loadMessages({ member: conflictedMember, search: '' })

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

/* --------------------------- Clickable Identity --------------------------- */
//
// The theme wraps the chat-header photo/name and the received-message avatar in
// ActionButtons carrying `data-member`, which TalkJS delivers to the controller
// as `event.params.member`. These tests drive the handler the controller
// actually registered, through the same inbox object the SDK would use — the
// DOM half (which surfaces are buttons, whether they have accessible names)
// is proven separately by the staging theme rig, which cannot be asserted here.
//
// The one thing to keep in mind when editing these: the slug is fetched when
// the CONVERSATION opens, not when the member clicks, and the click must reach
// window.open without awaiting anything. The handler is not in the click's own
// call stack — TalkJS is cross-origin, so the action arrives over postMessage
// in a later task — but it does run on the activation forwarded to this
// window, and WebKit gives that about a second before a popup stops opening.
// `openedSynchronously` below is what stops that guarantee from rotting.

const IDENTITY_ACTION = 'starters-open-profile'
const RESOLVER_URL =
  'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/starter/slug_by_memberstack'

/** The handler the controller registered for message-row identity clicks. */
function identityHandler(loaded, channel = 'messageActions') {
  const handler = loaded.calls[channel].get(IDENTITY_ACTION)
  assert.equal(typeof handler, 'function', `no ${channel} handler registered`)
  return handler
}

/** Answers a fixed slug, as the live resolver does for a listed starter. */
function resolves(slug) {
  return () => Promise.resolve({ ok: true, status: 200, json: async () => ({ slug }) })
}

/** A TalkJS ConversationSelectedEvent, in the shape a live one arrives in. */
function selectionEvent(otherId = OTHER_ID, myId = MY_ID) {
  return {
    me: { id: myId },
    conversationId: 'conv-1',
    others: [{ id: otherId, name: 'Kaeser' }],
    conversation: {
      id: 'conv-1',
      participants: { [myId]: { access: 'ReadWrite' }, [otherId]: { access: 'ReadWrite' } },
    },
  }
}

/** Fire the conversation-selected listeners the controller registered. */
function selectConversation(loaded, event = selectionEvent()) {
  assert.equal(loaded.calls.conversationSelected.length, 1, 'no selection listener registered')
  loaded.calls.conversationSelected[0](event)
}

/**
 * Call the handler and report whether window.open ran before the call returned.
 *
 * Single-threaded JS makes this exact: if the open is not recorded by the time
 * the handler's body has finished, it happened after an await, and on WebKit
 * the forwarded activation will have expired long before the answer lands.
 */
function clickIdentity(loaded, memberId, channel = 'messageActions') {
  const before = loaded.calls.opens.length
  const returned = identityHandler(loaded, channel)({ params: { member: memberId } })
  return {
    openedSynchronously: loaded.calls.opens.length > before,
    settled: Promise.resolve(returned),
  }
}

test('the identity action and the prefetch are registered on every channel', async () => {
  const { calls } = loadMessages({ search: '' })

  await settle()

  assert.deepEqual([...calls.messageActions.keys()], [IDENTITY_ACTION])
  assert.equal(calls.conversationActions.has(IDENTITY_ACTION), true)
  assert.equal(calls.conversationSelected.length, 1)
  // The feed filters still register on the same channel and are untouched.
  assert.deepEqual(
    [...calls.conversationActions.keys()].sort(),
    ['messages-filter-all', 'messages-filter-read', 'messages-filter-unread', IDENTITY_ACTION].sort(),
  )
})

test('opening a conversation resolves the other participant once, before any click', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

  await settle()
  assert.deepEqual(loaded.calls.fetches, [], 'nothing is fetched just by mounting')

  selectConversation(loaded)
  await settle()

  assert.equal(loaded.calls.fetches.length, 1)
  const { url, init } = loaded.calls.fetches[0]
  assert.equal(url, RESOLVER_URL)
  assert.equal(init.method, 'POST')
  assert.deepEqual(JSON.parse(init.body), { member_id: OTHER_ID })
  assert.deepEqual(loaded.calls.opens, [], 'the prefetch opens nothing')
})

test('the prefetch never asks about the viewer themselves', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

  await settle()
  selectConversation(loaded)
  await settle()

  const asked = loaded.calls.fetches.map((f) => JSON.parse(f.init.body).member_id)
  assert.deepEqual(asked, [OTHER_ID])
})

test('the other participant is found even when the event carries no `others`', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

  await settle()
  const event = selectionEvent()
  delete event.others
  selectConversation(loaded, event)
  await settle()

  const asked = loaded.calls.fetches.map((f) => JSON.parse(f.init.body).member_id)
  assert.deepEqual(asked, [OTHER_ID])
})

test('a cached slug opens /hire/<slug> in a new tab, synchronously', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

  await settle()
  selectConversation(loaded)
  await settle()

  const click = clickIdentity(loaded, OTHER_ID)

  // The assertion this whole design exists for.
  assert.equal(
    click.openedSynchronously,
    true,
    'window.open must run before the handler awaits, or WebKit refuses the tab',
  )
  assert.deepEqual(loaded.calls.opens, [
    ['/hire/kaeser-valencerina', '_blank', 'noopener'],
  ])
  // And the click itself touched the network not at all.
  assert.equal(loaded.calls.fetches.length, 1, 'still just the prefetch')
})

test('the header (conversation) channel opens the same profile, also synchronously', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

  await settle()
  selectConversation(loaded)
  await settle()

  const click = clickIdentity(loaded, OTHER_ID, 'conversationActions')

  assert.equal(click.openedSynchronously, true)
  assert.deepEqual(loaded.calls.opens, [
    ['/hire/kaeser-valencerina', '_blank', 'noopener'],
  ])
})

test('every identity button in a conversation shares the one lookup', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

  await settle()
  selectConversation(loaded)
  await settle()

  clickIdentity(loaded, OTHER_ID)
  clickIdentity(loaded, OTHER_ID, 'conversationActions')
  clickIdentity(loaded, OTHER_ID)
  await settle()

  assert.equal(loaded.calls.fetches.length, 1)
  assert.equal(loaded.calls.opens.length, 3)
})

test('a cached empty slug opens nothing and says nothing', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('') })

  await settle()
  selectConversation(loaded)
  await settle()

  const click = clickIdentity(loaded, OTHER_ID)
  await click.settled

  assert.deepEqual(loaded.calls.opens, [])
  assert.deepEqual(loaded.errors, [])
  assert.deepEqual(loaded.warnings, [])
})

test('a whitespace-only slug counts as no profile', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('   ') })

  await settle()
  selectConversation(loaded)
  await settle()
  clickIdentity(loaded, OTHER_ID)
  await settle()

  assert.deepEqual(loaded.calls.opens, [])
})

test('a slug that tries to steer the path is encoded, not obeyed', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('../../admin?x=1') })

  await settle()
  selectConversation(loaded)
  await settle()
  clickIdentity(loaded, OTHER_ID)

  assert.deepEqual(loaded.calls.opens, [
    ['/hire/..%2F..%2Fadmin%3Fx%3D1', '_blank', 'noopener'],
  ])
})

/* ------------------------- the cold-cache slow path ------------------------ */
// Only reachable when a member clicks inside the first moments of a
// conversation, before its prefetch has answered. A tab cannot be opened once
// the gesture is gone, so one is reserved up front and steered afterwards.

test('a click that beats the prefetch reserves a tab synchronously and steers it', async () => {
  let release
  const loaded = loadMessages({
    search: '',
    fetch: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, json: async () => ({ slug: 'kaeser-valencerina' }) })
    }),
  })

  await settle()
  selectConversation(loaded)
  await settle()
  // The prefetch is in flight, so the cache is still cold.
  const click = clickIdentity(loaded, OTHER_ID)

  assert.equal(click.openedSynchronously, true, 'the tab is reserved inside the click')
  assert.deepEqual(loaded.calls.opens, [['', '_blank']])
  const reserved = loaded.calls.handles[0]
  assert.deepEqual(reserved.hrefs, [], 'nothing to steer to yet')

  release()
  await click.settled

  assert.deepEqual(reserved.hrefs, ['/hire/kaeser-valencerina'])
  assert.equal(reserved.opener, null, 'opener severed, since this open could not use noopener')
  assert.equal(reserved.closed, false)
  // Still one request: the click joined the prefetch instead of racing it.
  assert.equal(loaded.calls.fetches.length, 1)
})

test('a reserved tab is closed again when the member has no profile', async () => {
  let release
  const loaded = loadMessages({
    search: '',
    fetch: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, json: async () => ({ slug: '' }) })
    }),
  })

  await settle()
  const click = clickIdentity(loaded, OTHER_ID)
  assert.deepEqual(loaded.calls.opens, [['', '_blank']])

  // The request is dispatched a microtask after the click, so `release` does
  // not exist yet at the assertion above.
  await new Promise((resolve) => setImmediate(resolve))
  release()
  await click.settled

  assert.equal(loaded.calls.handles[0].closed, true, 'no blank tab is left behind')
  assert.deepEqual(loaded.errors, [])
})

test('a reserved tab is closed again when the resolver is down', async () => {
  const loaded = loadMessages({
    search: '',
    fetch: () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }),
  })

  await settle()
  const click = clickIdentity(loaded, OTHER_ID)
  await click.settled

  assert.equal(loaded.calls.handles[0].closed, true)
  assert.deepEqual(loaded.errors, [])
})

test('a blocked popup falls back to a direct open rather than doing nothing', async () => {
  const loaded = loadMessages({
    search: '',
    popupBlocked: true,
    fetch: resolves('kaeser-valencerina'),
  })

  await settle()
  const click = clickIdentity(loaded, OTHER_ID)
  await click.settled

  assert.deepEqual(loaded.calls.opens, [
    ['', '_blank'],
    ['/hire/kaeser-valencerina', '_blank', 'noopener'],
  ])
})

test('an outage is not cached, so the next click tries again', async () => {
  let attempt = 0
  const loaded = loadMessages({
    search: '',
    fetch: () => {
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ slug: 'kaeser-valencerina' }) })
    },
  })

  await settle()
  selectConversation(loaded)
  await settle()
  assert.deepEqual(loaded.calls.opens, [], 'the failed prefetch opened nothing')

  const click = clickIdentity(loaded, OTHER_ID)
  await click.settled

  assert.equal(loaded.calls.fetches.length, 2, 'the failure was retried, not remembered')
  assert.deepEqual(loaded.calls.handles[0].hrefs, ['/hire/kaeser-valencerina'])
})

test('an answered empty slug IS cached, so a brand is asked about once', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('') })

  await settle()
  selectConversation(loaded)
  await settle()
  clickIdentity(loaded, OTHER_ID)
  clickIdentity(loaded, OTHER_ID)
  await settle()

  assert.equal(loaded.calls.fetches.length, 1)
  assert.deepEqual(loaded.calls.opens, [])
})

test('a slow resolver is aborted at the deadline and opens nothing', async () => {
  // Never resolves on its own: only the deadline can end this call.
  const loaded = loadMessages({
    search: '',
    fetch: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }),
  })

  await settle()
  const before = loaded.calls.timers.length
  const click = clickIdentity(loaded, OTHER_ID)
  await new Promise((resolve) => setImmediate(resolve))

  const armed = loaded.calls.timers.slice(before)
  assert.equal(armed.length, 1, 'the handler arms exactly one deadline')
  assert.equal(armed[0].ms, 4000, 'the click gives up after 4s')
  assert.deepEqual(loaded.calls.opens, [['', '_blank']], 'only the reserved tab so far')

  armed[0].fire()
  await click.settled

  assert.deepEqual(loaded.calls.aborts, [RESOLVER_URL])
  assert.equal(loaded.calls.handles[0].closed, true)
  assert.deepEqual(loaded.errors, [])
})

test('the deadline is armed even when AbortController is missing', async () => {
  // The branch the old code left without any timeout at all: the guard was
  // `controller ? setTimeout(...) : null`, i.e. no deadline in exactly the
  // case the deadline exists for.
  const loaded = loadMessages({
    search: '',
    fetch: () => new Promise(() => {}),
  })
  loaded.window.AbortController = undefined

  await settle()
  const before = loaded.calls.timers.length
  const click = clickIdentity(loaded, OTHER_ID)
  await new Promise((resolve) => setImmediate(resolve))

  const armed = loaded.calls.timers.slice(before)
  assert.equal(armed.length, 1)
  assert.equal(armed[0].ms, 4000)

  armed[0].fire()
  await click.settled

  assert.equal(loaded.calls.handles[0].closed, true, 'the reserved tab still gets cleaned up')
  assert.deepEqual(loaded.calls.opens, [['', '_blank']])
})

/* ------------------------------ rejected input ----------------------------- */

test('a malformed member id never reaches the network', async () => {
  for (const value of ['not-a-member', 'mem_', 'mem_sb_', '', 'mem_bad-id', 'mem_sb_extra_underscore', '../../etc', '  ', null, undefined, 42]) {
    const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

    await settle()
    await identityHandler(loaded)({ params: { member: value } })

    assert.deepEqual(loaded.calls.fetches, [], 'rejected: ' + JSON.stringify(value))
    assert.deepEqual(loaded.calls.opens, [], 'nothing opened for: ' + JSON.stringify(value))
  }
})

test('an event with no params at all is a no-op', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('kaeser-valencerina') })

  await settle()
  await identityHandler(loaded)({})
  await identityHandler(loaded)()

  assert.deepEqual(loaded.calls.fetches, [])
  assert.deepEqual(loaded.calls.opens, [])
})

test('a selection event naming nobody resolvable fetches nothing', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('x') })

  await settle()
  selectConversation(loaded, { me: { id: MY_ID }, others: [{ id: 'not-a-member' }], conversation: {} })
  selectConversation(loaded, {})
  await settle()

  assert.deepEqual(loaded.calls.fetches, [])
})

test('a sandbox member id resolves like a live one', async () => {
  const SANDBOX_ID = 'mem_sb_cmqhuaxn80d270sseeo74fn7i'
  const loaded = loadMessages({ search: '', fetch: resolves('jp-test') })

  await settle()
  selectConversation(loaded, selectionEvent(SANDBOX_ID))
  await settle()
  clickIdentity(loaded, SANDBOX_ID)

  assert.deepEqual(JSON.parse(loaded.calls.fetches[0].init.body), { member_id: SANDBOX_ID })
  assert.deepEqual(loaded.calls.opens, [['/hire/jp-test', '_blank', 'noopener']])
})

/* --------------------------- deep link and wiring -------------------------- */

test('a ?with= deep link primes the cache from the id in the URL', async () => {
  const loaded = loadMessages({ search: '?with=' + OTHER_ID, fetch: resolves('kaeser-valencerina') })

  await settle()

  const asked = loaded.calls.fetches.map((f) => JSON.parse(f.init.body).member_id)
  assert.deepEqual(asked, [OTHER_ID], 'the profile is resolved without waiting for a selection event')

  const click = clickIdentity(loaded, OTHER_ID)
  assert.equal(click.openedSynchronously, true)
})

test('production stays silent about an unresolvable identity click', async () => {
  const loaded = loadMessages({ search: '', hostname: 'thestarters.com', fetch: resolves('') })

  await settle()
  selectConversation(loaded)
  await settle()
  clickIdentity(loaded, OTHER_ID)

  assert.deepEqual(loaded.warnings, [])
  assert.deepEqual(loaded.errors, [])
})

test('staging says why nothing happened', async () => {
  const loaded = loadMessages({
    search: '',
    hostname: 'the-starters-3-0.webflow.io',
    fetch: resolves(''),
  })

  await settle()
  selectConversation(loaded)
  await settle()
  clickIdentity(loaded, OTHER_ID)

  assert.equal(loaded.warnings.length, 1)
  assert.match(loaded.warnings[0], /no published profile/)
})

test('a lookalike staging hostname does not turn diagnostics on', async () => {
  const loaded = loadMessages({ search: '', hostname: 'notwebflow.io', fetch: resolves('') })

  await settle()
  selectConversation(loaded)
  await settle()
  clickIdentity(loaded, OTHER_ID)

  assert.deepEqual(loaded.warnings, [])
})

test('an SDK without custom-action support still mounts the inbox', async () => {
  const { calls, errors } = loadMessages({ search: '', actions: false })

  await settle()

  assert.equal(calls.mounted.length, 1)
  assert.deepEqual(errors, [])
})

/* ------------------- one reserved tab per member, not per click ------------ */

test('clicking two identity surfaces before the prefetch answers reserves one tab', async () => {
  let release
  const loaded = loadMessages({
    search: '',
    fetch: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, json: async () => ({ slug: 'kaeser-valencerina' }) })
    }),
  })

  await settle()
  selectConversation(loaded)
  await settle()

  // The header photo, then the header name, then a received avatar — all the
  // same member, all inside the prefetch window.
  const first = clickIdentity(loaded, OTHER_ID, 'conversationActions')
  const second = clickIdentity(loaded, OTHER_ID, 'conversationActions')
  const third = clickIdentity(loaded, OTHER_ID)

  assert.deepEqual(loaded.calls.opens, [['', '_blank']], 'exactly one tab reserved')
  assert.equal(first.openedSynchronously, true)
  assert.equal(second.openedSynchronously, false, 'the second click reserves nothing')
  assert.equal(third.openedSynchronously, false)

  release()
  await Promise.all([first.settled, second.settled, third.settled])

  assert.equal(loaded.calls.handles.length, 1)
  assert.deepEqual(loaded.calls.handles[0].hrefs, ['/hire/kaeser-valencerina'], 'steered once')
  assert.equal(loaded.calls.opens.length, 1, 'no extra tabs after the slug arrives')
  assert.equal(loaded.calls.fetches.length, 1)
})

test('a double-click on one avatar still reserves one tab', async () => {
  let release
  const loaded = loadMessages({
    search: '',
    fetch: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, json: async () => ({ slug: 'jp-test' }) })
    }),
  })

  await settle()
  const a = clickIdentity(loaded, OTHER_ID)
  const b = clickIdentity(loaded, OTHER_ID)
  await new Promise((resolve) => setImmediate(resolve))
  release()
  await Promise.all([a.settled, b.settled])

  assert.deepEqual(loaded.calls.opens, [['', '_blank']])
  assert.deepEqual(loaded.calls.handles[0].hrefs, ['/hire/jp-test'])
})

test('the reservation is released, so a later cold click can reserve again', async () => {
  const loaded = loadMessages({ search: '', fetch: resolves('') })

  await settle()
  const first = clickIdentity(loaded, OTHER_ID)
  await first.settled
  assert.equal(loaded.calls.handles[0].closed, true)

  // The empty answer was cached, so this one takes the fast path and opens
  // nothing — the point is that it is not silently swallowed by a stale
  // reservation.
  loaded.calls.opens.length = 0
  const second = clickIdentity(loaded, 'mem_second00000000000000')
  await second.settled

  assert.deepEqual(loaded.calls.opens, [['', '_blank']], 'a different member can reserve')
})

/* ------------------ a reservation that cannot be steered ------------------- */

test('a reserved tab that cannot be steered is closed, not stranded', async () => {
  const loaded = loadMessages({
    search: '',
    steerThrows: true,
    fetch: resolves('kaeser-valencerina'),
  })

  await settle()
  const click = clickIdentity(loaded, OTHER_ID)
  await click.settled

  const reserved = loaded.calls.handles[0]
  assert.equal(reserved.closed, true, 'the blank tab is closed before the fallback')
  assert.deepEqual(loaded.calls.opens, [
    ['', '_blank'],
    ['/hire/kaeser-valencerina', '_blank', 'noopener'],
  ])
})

test('a reserved tab the member closed is not replaced behind their back', async () => {
  let release
  const loaded = loadMessages({
    search: '',
    fetch: () => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, json: async () => ({ slug: 'kaeser-valencerina' }) })
    }),
  })

  await settle()
  const click = clickIdentity(loaded, OTHER_ID)
  await new Promise((resolve) => setImmediate(resolve))

  // The member closes the blank tab while the resolver is still working.
  loaded.calls.handles[0].close()
  release()
  await click.settled

  assert.deepEqual(loaded.calls.opens, [['', '_blank']], 'nothing re-opened')
  assert.deepEqual(loaded.calls.handles[0].hrefs, [], 'and nothing steered into a closed tab')
})
