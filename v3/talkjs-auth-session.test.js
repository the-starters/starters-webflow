const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./talkjs-auth-session.js'), 'utf8')
const NOW_SECONDS = 2_000_000_000

function encode(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64url')
}

function token({ appId = 'test-app', memberId = 'mem_sb_membera', exp = NOW_SECONDS + 300 } = {}) {
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ tokenType: 'user', iss: appId, sub: memberId, exp }),
    'synthetic-signature',
  ].join('.')
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function harness(options = {}) {
  let member = options.member || { id: 'mem_sb_membera' }
  let memberError = null
  let memberLookup = null
  let memberstackCookie =
    options.memberstackCookie === undefined
      ? 'memberstack-cookie-a'
      : options.memberstackCookie
  let authListener
  const calls = { fetches: [], sessions: [], destroys: 0, reconnects: 0, invalidations: 0, xanoTokens: 0, xanoTokenArgs: [] }
  const config = {
    getAttribute(name) {
      if (name === 'data-token-url') return 'https://untrusted.example/token'
      if (name === 'data-conversation-url') {
        return 'https://untrusted.example/conversation'
      }
      if (name === 'data-environment') return options.environment || ''
      return null
    },
  }
  const memberstack = {
    async getCurrentMember() {
      if (memberLookup) return memberLookup()
      if (memberError) throw memberError
      return { data: member }
    },
    async getMemberCookie() {
      return memberstackCookie
    },
    onAuthChange(listener) {
      authListener = listener
    },
  }
  const window = {
    location: { hostname: options.hostname || 'the-starters-3-0.webflow.io' },
    setTimeout,
    atob(value) {
      return Buffer.from(value, 'base64').toString('utf8')
    },
    async getXanoAuthToken(options) {
      calls.xanoTokens += 1
      calls.xanoTokenArgs.push(options)
      return 'xano-bearer'
    },
    async fetch(url, init) {
      calls.fetches.push({ url, init })
      if (options.fetch) return options.fetch(url, init, calls)
      if (url.endsWith('/talkjs/conversation/v3')) {
        const intent = JSON.parse(init.body)
        const counterpartId =
          intent.counterpart_id || options.existingCounterpart || 'mem_sb_memberb'
        return jsonResponse({
          authorized: true,
          actor_id: member.id,
          counterpart_id: counterpartId,
          participant_ids: [member.id, counterpartId],
          conversation_id:
            intent.conversation_id || 'dm_v1_0123456789abcdef',
          data_environment: 'test',
        })
      }
      return jsonResponse({
        token: token({ memberId: member.id }),
        me_id: member.id,
        data_environment: member.id.startsWith('mem_sb_') ? 'test' : 'production',
        expires_in_seconds: 300,
      })
    },
  }
  if (options.noXanoBridge) delete window.getXanoAuthToken
  const document = { querySelector: () => config }
  const Talk = {
    Session: function Session(sessionOptions) {
      calls.sessions.push(sessionOptions)
      this.options = sessionOptions
      this.destroy = () => {
        calls.destroys += 1
      }
    },
  }
  vm.runInNewContext(source, {
    Date: class extends Date {
      static now() {
        return NOW_SECONDS * 1000
      }
    },
    Error,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    String,
    document,
    encodeURIComponent,
    window,
  })
  return {
    api: window.StartersTalkJsSessionOwner,
    calls,
    memberstack,
    Talk,
    member(value) {
      member = value
    },
    memberError(value) {
      memberError = value
    },
    memberLookup(value) {
      memberLookup = value
    },
    memberstackCookie(value) {
      memberstackCookie = value
    },
    async authChange() {
      await authListener()
    },
  }
}

async function open(state, overrides = {}) {
  const member = overrides.member || { id: 'mem_sb_membera' }
  return state.api.openSession({
    Talk: state.Talk,
    memberstack: state.memberstack,
    member,
    me: { id: member.id },
    clientOwner: overrides.clientOwner || 'messages-v3',
    onReconnect: overrides.onReconnect,
    onInvalidate: overrides.onInvalidate,
  })
}

test('creates one signed session with exact member and app mapping', async () => {
  const state = harness()
  const session = await open(state)
  assert.equal(state.calls.sessions.length, 1)
  assert.equal(state.calls.sessions[0].appId, 'test-app')
  assert.equal(state.calls.sessions[0].me.id, 'mem_sb_membera')
  assert.equal(typeof state.calls.sessions[0].tokenFetcher, 'function')
  assert.equal(
    state.calls.fetches[0].url,
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/talkjs/user-token/v3',
  )
  assert.equal(await state.calls.sessions[0].tokenFetcher(), token())
  assert.equal(session, state.calls.sessions[0] && session)
  assert.deepEqual(JSON.parse(JSON.stringify(state.api.debugSnapshot())), {
    appId: 'test-app',
    memberId: 'mem_sb_membera',
    environment: 'test',
    clientOwners: ['messages-v3'],
  })
})

test('refresh gets a new server token for the same subject', async () => {
  let issued = 0
  const state = harness({
    fetch: async () => {
      issued += 1
      return jsonResponse({
        token: token({ exp: NOW_SECONDS + 300 + issued }),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  await open(state)
  const fetcher = state.calls.sessions[0].tokenFetcher
  await fetcher()
  const refreshed = await fetcher()
  assert.equal(issued, 2)
  assert.equal(refreshed, token({ exp: NOW_SECONDS + 302 }))
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls.xanoTokenArgs)), [
    { forceRefresh: false },
    { forceRefresh: false },
  ])
})

test('Xano bridge receives the force-refresh option on retry', async () => {
  let requests = 0
  const state = harness({
    fetch: async () => {
      requests += 1
      if (requests === 1) return jsonResponse({ error: 'retry' }, 503)
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  await open(state)
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls.xanoTokenArgs)), [
    { forceRefresh: false },
    { forceRefresh: true },
  ])
})

test('token issuance retries one 401 with a refreshed Xano bearer', async () => {
  let requests = 0
  const state = harness({
    fetch: async () => {
      requests += 1
      if (requests === 1) return jsonResponse({ error: 'expired bearer' }, 401)
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })

  await open(state)

  assert.equal(state.calls.sessions.length, 1)
  assert.equal(state.calls.fetches.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls.xanoTokenArgs)), [
    { forceRefresh: false },
    { forceRefresh: true },
  ])
})

test('missing Xano auth bridge fails closed without putting Memberstack credentials in a URL', async () => {
  const state = harness({ noXanoBridge: true })
  state.memberstack.getMemberCookie = async () => 'memberstack-secret'
  await assert.rejects(open(state), /Xano authentication bridge is unavailable/)
  assert.equal(state.calls.fetches.length, 0)
  assert.equal(state.calls.sessions.length, 0)
})

test('a failed active refresh destroys cached session and a later open starts cleanly', async () => {
  let requests = 0
  const state = harness({
    fetch: async () => {
      requests += 1
      if (requests === 2) return jsonResponse({ error: 'provider unavailable' }, 503)
      if (requests === 3) return jsonResponse({ error: 'provider unavailable' }, 503)
      return jsonResponse({
        token: token({ exp: NOW_SECONDS + 300 + requests }),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  const first = await open(state)
  await first.options.tokenFetcher()
  await assert.rejects(first.options.tokenFetcher(), /TalkJS token request failed/)
  assert.equal(state.calls.destroys, 1)
  assert.equal(state.api.debugSnapshot(), null)
  const second = await open(state)
  assert.notEqual(second, first)
  assert.equal(state.calls.sessions.length, 2)
})

test('same member clients reuse one session and record exact owners', async () => {
  const state = harness()
  const first = await open(state)
  const second = await open(state, { clientOwner: 'dashboard-messages-v3' })
  assert.equal(second, first)
  assert.equal(state.calls.sessions.length, 1)
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.api.debugSnapshot().clientOwners)),
    ['dashboard-messages-v3', 'messages-v3'],
  )
})

test('all served client owners share one session and logout destroys it once', async () => {
  const state = harness()
  const owners = [
    'messages-v3',
    'messages-profile-v3',
    'dashboard-messages-v3',
  ]

  const sessions = []
  for (const clientOwner of owners) {
    sessions.push(await open(state, { clientOwner }))
  }

  assert.equal(new Set(sessions).size, 1)
  assert.equal(state.calls.sessions.length, 1)
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.api.debugSnapshot().clientOwners)),
    owners.slice().sort(),
  )

  state.member(null)
  state.memberstackCookie(null)
  await state.authChange()

  assert.equal(state.calls.destroys, 1)
  assert.equal(state.api.debugSnapshot(), null)
})

test('concurrent same-member clients share one opening and retain both owners', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const state = harness({
    fetch: async () => {
      await gate
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  const first = open(state)
  const second = open(state, { clientOwner: 'dashboard-messages-v3' })
  release()
  assert.equal(await first, await second)
  assert.equal(state.calls.sessions.length, 1)
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.api.debugSnapshot().clientOwners)),
    ['dashboard-messages-v3', 'messages-v3'],
  )
})

test('a foreign member cannot join another member pending opening', async () => {
  let release
  let startedResolve
  const started = new Promise((resolve) => {
    startedResolve = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const state = harness({
    fetch: async () => {
      startedResolve()
      await gate
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  const first = open(state)
  await started
  state.member({ id: 'mem_sb_memberb' })
  await assert.rejects(
    open(state, { member: { id: 'mem_sb_memberb' } }),
    /foreign TalkJS session opening/,
  )
  release()
  await assert.rejects(first, /changed during/)
  assert.equal(state.calls.sessions.length, 0)
})

test('an old opening finalizer cannot clear a newer pending opening', async () => {
  const releases = []
  const starts = []
  const state = harness({
    fetch: async () => {
      const index = starts.length
      let startedResolve
      starts.push(
        new Promise((resolve) => {
          startedResolve = resolve
        }),
      )
      startedResolve()
      await new Promise((resolve) => {
        releases[index] = resolve
      })
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })

  const first = open(state)
  while (!releases[0]) await new Promise((resolve) => setImmediate(resolve))
  state.api.destroy('test-supersede')
  const second = open(state, { clientOwner: 'dashboard-messages-v3' })
  while (!releases[1]) await new Promise((resolve) => setImmediate(resolve))
  releases[0]()
  await assert.rejects(first, /superseded/)

  const third = open(state, { clientOwner: 'messages-profile-v3' })
  releases[1]()
  assert.equal(await third, await second)
  assert.equal(state.calls.sessions.length, 1)
  assert.equal(state.calls.fetches.length, 2)
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.api.debugSnapshot().clientOwners)),
    ['dashboard-messages-v3', 'messages-profile-v3'],
  )
})

test('browser-selected foreign member is refused before token request', async () => {
  const state = harness()
  await assert.rejects(
    open(state, { member: { id: 'mem_sb_foreign' } }),
    /differs from Memberstack/,
  )
  assert.equal(state.calls.fetches.length, 0)
  assert.equal(state.calls.sessions.length, 0)
})

test('wrong signed subject is refused before session construction', async () => {
  const state = harness({
    fetch: async () =>
      jsonResponse({
        token: token({ memberId: 'mem_sb_foreign' }),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      }),
  })
  await assert.rejects(open(state), /does not match/)
  assert.equal(state.calls.sessions.length, 0)
})

test('wrong environment is refused before session construction', async () => {
  const state = harness({
    fetch: async () =>
      jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'production',
        expires_in_seconds: 300,
      }),
  })
  await assert.rejects(open(state), /does not match/)
  assert.equal(state.calls.sessions.length, 0)
})

test('production page refuses a sandbox member before network', async () => {
  const state = harness({ hostname: 'www.thestarters.com' })
  await assert.rejects(open(state), /environment does not match/)
  assert.equal(state.calls.fetches.length, 0)
})

test('logout destroys and clears the session owner', async () => {
  const state = harness()
  await open(state)
  state.member(null)
  state.memberstackCookie(null)
  await state.authChange()
  assert.equal(state.calls.destroys, 1)
  assert.equal(state.api.debugSnapshot(), null)
})

test('transient empty member notification preserves the signed session', async () => {
  const state = harness()
  const session = await open(state)

  state.member(null)
  await state.authChange()

  assert.equal(state.calls.destroys, 0)
  assert.equal(state.api.debugSnapshot().memberId, 'mem_sb_membera')
  state.member({ id: 'mem_sb_membera' })
  assert.equal(await open(state), session)
})

test('transient member lookup error preserves the signed session', async () => {
  const state = harness()
  const session = await open(state)

  state.memberError(new Error('Memberstack DOM is refreshing'))
  await state.authChange()

  assert.equal(state.calls.destroys, 0)
  assert.equal(state.api.debugSnapshot().memberId, 'mem_sb_membera')
  state.memberError(null)
  assert.equal(await open(state), session)
})

test('same-member cookie rotation closes and reconnects the signed session', async () => {
  const state = harness()
  let reconnect
  reconnect = async () => {
    state.calls.reconnects += 1
    await open(state, { onReconnect: reconnect })
  }
  const session = await open(state, { onReconnect: reconnect })

  state.memberstackCookie('memberstack-cookie-b')
  await state.authChange()

  assert.equal(state.calls.destroys, 1)
  assert.equal(state.calls.reconnects, 1)
  assert.equal(state.calls.sessions.length, 2)
  assert.equal(state.api.debugSnapshot().memberId, 'mem_sb_membera')
  assert.notEqual(await open(state), session)
})

test('changed cookie closes immediately then reconnects after identity resolves', async () => {
  const state = harness()
  let resolveMember
  const memberGate = new Promise((resolve) => {
    resolveMember = resolve
  })
  let reconnect
  reconnect = async () => {
    state.calls.reconnects += 1
    state.memberLookup(null)
    await open(state, { onReconnect: reconnect })
  }
  await open(state, { onReconnect: reconnect })
  state.memberstackCookie('memberstack-cookie-b')
  state.memberLookup(() => memberGate)

  const reconciliation = state.authChange()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.calls.destroys, 1)
  assert.equal(state.api.debugSnapshot(), null)

  resolveMember({ data: { id: 'mem_sb_membera' } })
  await reconciliation
  assert.equal(state.calls.reconnects, 1)
  assert.equal(state.api.debugSnapshot().memberId, 'mem_sb_membera')
})

test('changed cookie resolves from error to a different identity', async () => {
  const state = harness()
  await open(state, {
    onReconnect: () => {
      state.calls.reconnects += 1
    },
  })
  const lookups = [
    new Error('Memberstack DOM is refreshing'),
    { data: { id: 'mem_sb_memberb' } },
  ]
  state.memberstackCookie('memberstack-cookie-b')
  state.memberLookup(() => {
    const value = lookups.shift()
    if (value instanceof Error) throw value
    return value
  })

  await state.authChange()

  assert.equal(state.calls.destroys, 1)
  assert.equal(state.calls.reconnects, 0)
  assert.equal(state.api.debugSnapshot(), null)
})

test('bounded unresolved changed-cookie identity destroys the session', async () => {
  const state = harness()
  await open(state)
  let lookups = 0
  state.memberstackCookie('memberstack-cookie-b')
  state.memberLookup(() => {
    lookups += 1
    return { data: null }
  })

  await state.authChange()

  assert.equal(lookups, 3)
  assert.equal(state.calls.destroys, 1)
  assert.equal(state.api.debugSnapshot(), null)
})

test('changed member and cookie destroy the old session', async () => {
  const state = harness()
  await open(state)
  state.member({ id: 'mem_sb_memberb' })
  state.memberstackCookie('memberstack-cookie-b')
  await state.authChange()
  assert.equal(state.calls.destroys, 1)
  assert.equal(state.api.debugSnapshot(), null)
})

test('logout during token issuance cannot construct a TalkJS session', async () => {
  let release
  let startedResolve
  const started = new Promise((resolve) => {
    startedResolve = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const state = harness({
    fetch: async () => {
      startedResolve()
      await gate
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })

  const opening = open(state)
  await started
  state.memberstackCookie(null)
  release()

  await assert.rejects(opening, /superseded/)
  assert.equal(state.calls.sessions.length, 0)
  assert.equal(state.api.debugSnapshot(), null)
})

test('changed-cookie auth event supersedes and invalidates a pending opening', async () => {
  let release
  let startedResolve
  const started = new Promise((resolve) => {
    startedResolve = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const state = harness({
    fetch: async () => {
      startedResolve()
      await gate
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  const opening = open(state, {
    onInvalidate: () => {
      state.calls.invalidations += 1
    },
  })
  await started

  state.memberstackCookie('memberstack-cookie-b')
  await state.authChange()

  assert.equal(state.calls.invalidations, 1)
  release()
  await assert.rejects(opening, /superseded/)
  assert.equal(state.calls.sessions.length, 0)
  assert.equal(state.api.debugSnapshot(), null)
})

test('cookie rotation after an early auth callback supersedes opening', async () => {
  let release
  let startedResolve
  const started = new Promise((resolve) => {
    startedResolve = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const state = harness({
    fetch: async () => {
      startedResolve()
      await gate
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  const opening = open(state)
  await started

  await state.authChange()
  state.memberstackCookie('memberstack-cookie-b')
  release()

  await assert.rejects(opening, /superseded/)
  assert.equal(state.calls.sessions.length, 0)
  assert.equal(state.api.debugSnapshot(), null)
})

test('account switch during opening cannot construct the old member session', async () => {
  const state = harness()
  let lookups = 0
  state.memberLookup(() => {
    lookups += 1
    if (lookups === 3) {
      state.member({ id: 'mem_sb_memberb' })
      state.memberstackCookie('memberstack-cookie-b')
      return { data: { id: 'mem_sb_membera' } }
    }
    return { data: { id: lookups < 3 ? 'mem_sb_membera' : 'mem_sb_memberb' } }
  })

  await assert.rejects(
    open(state),
    /superseded/,
  )
  assert.equal(state.calls.sessions.length, 0)
  assert.equal(state.api.debugSnapshot(), null)
})

test('identity change during refresh destroys the old session', async () => {
  const state = harness()
  await open(state)
  const fetcher = state.calls.sessions[0].tokenFetcher
  await fetcher()
  state.member({ id: 'mem_sb_memberb' })
  await assert.rejects(fetcher(), /changed before/)
  assert.equal(state.calls.destroys, 1)
})

test('authentication denial is not retried', async () => {
  const state = harness({ fetch: async () => jsonResponse({}, 403) })
  await assert.rejects(open(state), /token request failed/)
  assert.equal(state.calls.fetches.length, 1)
})

test('one transient failure retries without changing identity', async () => {
  let attempt = 0
  const state = harness({
    fetch: async () => {
      attempt += 1
      if (attempt === 1) return jsonResponse({}, 503)
      return jsonResponse({
        token: token(),
        me_id: 'mem_sb_membera',
        data_environment: 'test',
        expires_in_seconds: 300,
      })
    },
  })
  await open(state)
  assert.equal(state.calls.fetches.length, 2)
  assert.equal(state.calls.xanoTokens, 2)
})

test('debug state contains no bearer or TalkJS token', async () => {
  const state = harness()
  await open(state)
  const serialized = JSON.stringify(state.api.debugSnapshot())
  assert.doesNotMatch(serialized, /xano-bearer|synthetic-signature|token/i)
})

test('authorizes a pair with server-derived actor and accepts exact two-party receipt', async () => {
  const state = harness()
  await open(state)
  const receipt = await state.api.authorizeConversation({
    clientOwner: 'messages-v3',
    counterpartId: 'mem_sb_memberb',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), {
    conversationId: 'dm_v1_0123456789abcdef',
    counterpartId: 'mem_sb_memberb',
  })
  const request = state.calls.fetches.at(-1)
  assert.equal(
    request.url,
    'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/talkjs/conversation/v3',
  )
  assert.deepEqual(JSON.parse(request.init.body), {
    mode: 'pair',
    counterpart_id: 'mem_sb_memberb',
  })
  assert.doesNotMatch(request.init.body, /membera|actor/i)
})

test('authorizes an existing deep link before returning its exact id', async () => {
  const state = harness({ existingCounterpart: 'mem_sb_memberb' })
  await open(state)
  const receipt = await state.api.authorizeConversation({
    clientOwner: 'messages-v3',
    conversationId: 'legacy:membera|memberb',
  })
  assert.equal(receipt.conversationId, 'legacy:membera|memberb')
  assert.equal(receipt.counterpartId, 'mem_sb_memberb')
})

test('conversation authorization retries one 401 without changing its intent', async () => {
  let authorizationRequests = 0
  const state = harness({
    fetch: async (url, init) => {
      if (url.endsWith('/user-token/v3')) {
        return jsonResponse({
          token: token(),
          me_id: 'mem_sb_membera',
          data_environment: 'test',
          expires_in_seconds: 300,
        })
      }
      authorizationRequests += 1
      if (authorizationRequests === 1) {
        return jsonResponse({ error: 'expired bearer' }, 401)
      }
      return jsonResponse({
        authorized: true,
        actor_id: 'mem_sb_membera',
        counterpart_id: 'mem_sb_memberb',
        participant_ids: ['mem_sb_membera', 'mem_sb_memberb'],
        conversation_id: 'dm_v1_0123456789abcdef',
        data_environment: 'test',
      })
    },
  })
  await open(state)

  const receipt = await state.api.authorizeConversation({
    clientOwner: 'messages-v3',
    counterpartId: 'mem_sb_memberb',
  })

  assert.equal(receipt.conversationId, 'dm_v1_0123456789abcdef')
  assert.equal(authorizationRequests, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls.xanoTokenArgs)), [
    { forceRefresh: false },
    { forceRefresh: false },
    { forceRefresh: true },
  ])
  const authorizationBodies = state.calls.fetches
    .filter(({ url }) => url.endsWith('/conversation/v3'))
    .map(({ init }) => JSON.parse(init.body))
  assert.deepEqual(authorizationBodies, [
    { mode: 'pair', counterpart_id: 'mem_sb_memberb' },
    { mode: 'pair', counterpart_id: 'mem_sb_memberb' },
  ])
})

test('conversation authorization denial is not retried', async () => {
  let authorizationRequests = 0
  const state = harness({
    fetch: async (url) => {
      if (url.endsWith('/user-token/v3')) {
        return jsonResponse({
          token: token(),
          me_id: 'mem_sb_membera',
          data_environment: 'test',
          expires_in_seconds: 300,
        })
      }
      authorizationRequests += 1
      return jsonResponse({ error: 'forbidden' }, 403)
    },
  })
  await open(state)

  await assert.rejects(
    state.api.authorizeConversation({
      clientOwner: 'messages-v3',
      counterpartId: 'mem_sb_memberb',
    }),
    /authorization failed/,
  )

  assert.equal(authorizationRequests, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls.xanoTokenArgs)), [
    { forceRefresh: false },
    { forceRefresh: false },
  ])
})

test('nonparticipant C cannot accept an A/B conversation receipt', async () => {
  const memberC = { id: 'mem_sb_memberc' }
  const state = harness({
    member: memberC,
    fetch: async (url) => {
      if (url.endsWith('/user-token/v3')) {
        return jsonResponse({
          token: token({ memberId: memberC.id }),
          me_id: memberC.id,
          data_environment: 'test',
          expires_in_seconds: 300,
        })
      }
      return jsonResponse({
        authorized: true,
        actor_id: 'mem_sb_membera',
        counterpart_id: 'mem_sb_memberb',
        participant_ids: ['mem_sb_membera', 'mem_sb_memberb'],
        conversation_id: 'legacy:membera|memberb',
        data_environment: 'test',
      })
    },
  })
  await open(state, { member: memberC })
  await assert.rejects(
    state.api.authorizeConversation({
      clientOwner: 'messages-v3',
      conversationId: 'legacy:membera|memberb',
    }),
    /does not match the authenticated member/,
  )
})

test('refuses foreign participants, groups, duplicate participants and altered pair', async () => {
  const badReceipts = [
    ['mem_sb_membera', 'mem_sb_foreign'],
    ['mem_sb_membera', 'mem_sb_memberb', 'mem_sb_foreign'],
    ['mem_sb_membera', 'mem_sb_membera'],
  ]
  for (const participantIds of badReceipts) {
    const state = harness({
      fetch: async (url) => {
        if (url.endsWith('/user-token/v3')) {
          return jsonResponse({
            token: token(),
            me_id: 'mem_sb_membera',
            data_environment: 'test',
            expires_in_seconds: 300,
          })
        }
        return jsonResponse({
          authorized: true,
          actor_id: 'mem_sb_membera',
          counterpart_id: 'mem_sb_memberb',
          participant_ids: participantIds,
          conversation_id: 'dm_v1_0123456789abcdef',
          data_environment: 'test',
        })
      },
    })
    await open(state)
    await assert.rejects(
      state.api.authorizeConversation({
        clientOwner: 'messages-v3',
        counterpartId: 'mem_sb_memberb',
      }),
      /does not match/,
    )
  }
})

test('refuses self, malformed, ambiguous and unowned conversation intents before request', async () => {
  const state = harness()
  await open(state)
  const before = state.calls.fetches.length
  await assert.rejects(
    state.api.authorizeConversation({
      clientOwner: 'messages-v3',
      counterpartId: 'mem_sb_membera',
    }),
    /counterpart is invalid/,
  )
  await assert.rejects(
    state.api.authorizeConversation({
      clientOwner: 'messages-v3',
      conversationId: 'bad/conversation',
    }),
    /Conversation id is invalid/,
  )
  await assert.rejects(
    state.api.authorizeConversation({
      clientOwner: 'messages-v3',
      counterpartId: 'mem_sb_memberb',
      conversationId: 'legacy:a|b',
    }),
    /One conversation intent/,
  )
  await assert.rejects(
    state.api.authorizeConversation({
      clientOwner: 'messages-profile-v3',
      counterpartId: 'mem_sb_memberb',
    }),
    /does not own/,
  )
  assert.equal(state.calls.fetches.length, before)
})

test('member change during conversation authorization destroys the active session', async () => {
  const state = harness({
    fetch: async (url) => {
      if (url.endsWith('/user-token/v3')) {
        return jsonResponse({
          token: token(),
          me_id: 'mem_sb_membera',
          data_environment: 'test',
          expires_in_seconds: 300,
        })
      }
      state.member({ id: 'mem_sb_memberc' })
      return jsonResponse({
        authorized: true,
        actor_id: 'mem_sb_membera',
        counterpart_id: 'mem_sb_memberb',
        participant_ids: ['mem_sb_membera', 'mem_sb_memberb'],
        conversation_id: 'dm_v1_0123456789abcdef',
        data_environment: 'test',
      })
    },
  })
  await open(state)
  await assert.rejects(
    state.api.authorizeConversation({
      clientOwner: 'messages-v3',
      counterpartId: 'mem_sb_memberb',
    }),
    /changed during/,
  )
  assert.equal(state.calls.destroys, 1)
  assert.equal(state.api.debugSnapshot(), null)
})
