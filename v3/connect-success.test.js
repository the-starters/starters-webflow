const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./connect-success.js'), 'utf8')
const ENDPOINT = 'https://x08a-5ko8-jj1r.n7c.xano.io/api:tCpV3oqd/grants/add/v3'

function loadHandler(options = {}) {
  const attributes = new Map()
  const events = []
  const redirects = []
  const calls = []
  const warnings = []

  const member = options.member === undefined ? { id: 'member-a' } : options.member
  const xanoAuthFetch =
    options.withoutAuthFetch === true
      ? undefined
      : async (url, init) => {
          calls.push({ url, init })
          if (options.response) return options.response
          return {
            ok: true,
            status: 200,
            json: async () => ({ grant_id: 'grant-9', email: 'g@example.com' }),
          }
        }

  const window = {
    location: {
      hostname: options.hostname || 'the-starters-3-0.webflow.io',
      search: options.search === undefined ? '?code=abc123&state=member-a' : options.search,
      replace: (url) => redirects.push(url),
    },
    $memberstackDom: {
      getCurrentMember: async () => ({ data: member }),
    },
    xanoAuthFetch,
    dispatchEvent: (event) => events.push(event),
  }
  const document = {
    readyState: 'complete',
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
    },
    addEventListener() {},
  }

  class CustomEvent {
    constructor(name, init) {
      this.type = name
      this.detail = init && init.detail
    }
  }

  vm.runInNewContext(source, {
    CustomEvent,
    URLSearchParams,
    console: { warn: (...args) => warnings.push(args.join(' ')) },
    document,
    window,
  })

  return {
    attributes,
    calls,
    events,
    redirects,
    warnings,
    window,
    status: () => attributes.get('data-connect-success'),
  }
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise(setImmediate)
}

test('does not install outside V3 Webflow staging', () => {
  const result = loadHandler({ hostname: 'www.thestarters.com' })
  assert.equal(result.window.StarterConnectSuccess, undefined)
})

test('booking-confirmation visits without a code are not applicable', async () => {
  const result = loadHandler({ search: '?confirmation=bref_1' })
  await settle()
  assert.equal(result.status(), 'not-applicable')
  assert.equal(result.calls.length, 0)
})

test('never writes without the auth helper', async () => {
  const result = loadHandler({ withoutAuthFetch: true })
  await settle()
  assert.equal(result.status(), 'missing-auth')
})

test('saves the grant for the authenticated member and returns to the booking stage', async () => {
  const result = loadHandler()
  await settle()

  assert.equal(result.calls.length, 1)
  assert.equal(result.calls[0].url, ENDPOINT)
  assert.deepEqual(JSON.parse(result.calls[0].init.body), {
    code: 'abc123',
    member_id: 'member-a',
  })
  assert.equal(result.status(), 'success')
  assert.deepEqual(result.redirects, [
    '/starter-dashboard---availability-stage?calendar=google',
  ])
  assert.equal(result.events[0].type, 'starterConnectSuccess')
})

test('a state for a different member aborts without writing', async () => {
  const result = loadHandler({ search: '?code=abc123&state=member-b' })
  await settle()

  assert.equal(result.calls.length, 0)
  assert.equal(result.status(), 'error')
  assert.equal(result.redirects.length, 0)
  assert.equal(result.events[0].type, 'starterConnectSuccessError')
})

test('a failed exchange reports an error and does not redirect', async () => {
  const result = loadHandler({
    response: { ok: false, status: 400, json: async () => ({ message: 'bad code' }) },
  })
  await settle()

  assert.equal(result.status(), 'error')
  assert.equal(result.redirects.length, 0)
})

test('a 200 without a grant id is treated as a failure', async () => {
  const result = loadHandler({
    response: { ok: true, status: 200, json: async () => ({}) },
  })
  await settle()

  assert.equal(result.status(), 'error')
  assert.equal(result.redirects.length, 0)
})

test('logged-out visits fail safely without writing', async () => {
  const result = loadHandler({ member: null })
  await settle()

  assert.equal(result.calls.length, 0)
  assert.equal(result.status(), 'error')
})
