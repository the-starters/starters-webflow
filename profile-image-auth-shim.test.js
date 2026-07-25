const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./profile-image-auth-shim.js'),
  'utf8',
)

const mutationCases = [
  ['/api:KZf7nFnk/edit_profile/update/member', 'PATCH'],
  ['/api:KZf7nFnk/starter/set_also_worked_with', 'POST'],
  ['/api:KZf7nFnk/build_profile/starter/profile_image', 'POST'],
  ['/api:SYL06lUR/companies', 'POST'],
  ['/api:SYL06lUR/companies/1', 'PATCH'],
  ['/api:SYL06lUR/companies/1', 'DELETE'],
  ['/api:PmBJV0AG/Create_portfolio', 'POST'],
  ['/api:PmBJV0AG/Update_portfolio', 'PATCH'],
  ['/api:PmBJV0AG/Delete_portfolio', 'DELETE'],
  ['/api:PmBJV0AG/upload-image', 'POST'],
  ['/api:PmBJV0AG/Add_portfolio_image', 'POST'],
  ['/api:PmBJV0AG/upload-video', 'POST'],
  ['/api:PmBJV0AG/Add_portfolio_video', 'POST'],
  ['/api:PmBJV0AG/Delete_portfolio_image', 'DELETE'],
  ['/api:PmBJV0AG/Delete_portfolio_video', 'DELETE'],
]

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

function loadShim({
  hostname,
  pathname = '/starter-edit-profile',
  localStorage = createStorage({ editSubmit: 'stale-value' }),
  memberstackToken = 'memberstack-token',
  origin = `https://${hostname}`,
  fetchImpl,
}) {
  const calls = []
  const window = {
    location: { hostname, pathname, origin },
    localStorage,
    $memberstackDom: {
      async getMemberCookie() {
        return memberstackToken
      },
    },
    fetch: async (input, init) => {
      calls.push({ input, init })
      if (fetchImpl) return fetchImpl(input, init)
      if (String(input).includes('/auth/trade-token/v3')) {
        return new Response(JSON.stringify({ authToken: 'xano-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200 })
    },
  }
  const context = vm.createContext({
    window,
    console: { info() {} },
    Headers,
    Response,
    FormData,
    Blob,
    Request,
    URL,
    JSON,
    Promise,
  })
  vm.runInContext(source, context)
  return { window, calls, localStorage }
}

async function run() {
  {
    const { window, localStorage } = loadShim({ hostname: 'thestarters.com' })
    assert.equal(window.__TS_EDIT_PROFILE_MODE__, 'live-write')
    assert.equal(localStorage.getItem('editSubmit'), 'true')
  }

  {
    const localStorage = {
      setItem() {
        throw new DOMException('Storage unavailable', 'SecurityError')
      },
    }
    const { window, calls } = loadShim({
      hostname: 'thestarters.com',
      localStorage,
    })
    assert.equal(window.__TS_EDIT_PROFILE_MODE__, 'live-write')
    const response = await window.fetch('https://example.com/read')
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
  }

  {
    const { window, localStorage, calls } = loadShim({
      hostname: 'the-starters-3-0.webflow.io',
    })
    assert.equal(window.__TS_EDIT_PROFILE_MODE__, 'read-only')
    assert.equal(localStorage.getItem('editSubmit'), null)

    for (const [path, method] of mutationCases) {
      const response = await window.fetch(
        `https://x08a-5ko8-jj1r.n7c.xano.io${path}`,
        { method, headers: { Authorization: 'Bearer existing-token' } },
      )
      assert.equal(response.status, 403)
      assert.equal((await response.json()).code, 'EDIT_PROFILE_READ_ONLY')
    }
    assert.equal(calls.length, 0)

    const readResponse = await window.fetch(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Get_my_portfolios',
    )
    assert.equal(readResponse.status, 200)
    assert.equal(calls.length, 1)

    const headResponse = await window.fetch(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
      { method: 'HEAD' },
    )
    assert.equal(headResponse.status, 200)
    assert.equal(calls.length, 2)

    const requestResponse = await window.fetch(
      new Request(
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Delete_portfolio',
        { method: 'DELETE' },
      ),
    )
    assert.equal(requestResponse.status, 403)
    assert.equal((await requestResponse.json()).code, 'EDIT_PROFILE_READ_ONLY')
    assert.equal(calls.length, 2)
  }

  {
    const localStorage = {
      removeItem() {
        throw new DOMException('Storage unavailable', 'SecurityError')
      },
    }
    const { window, calls } = loadShim({
      hostname: 'the-starters-3-0.webflow.io',
      localStorage,
    })
    assert.equal(window.__TS_EDIT_PROFILE_MODE__, 'read-only')
    const response = await window.fetch(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
      { method: 'POST' },
    )
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'EDIT_PROFILE_READ_ONLY')
    assert.equal(calls.length, 0)
  }

  {
    const { window, calls } = loadShim({ hostname: 'www.thestarters.com' })
    for (const [path, method] of mutationCases) {
      const response = await window.fetch(
        `https://x08a-5ko8-jj1r.n7c.xano.io${path}`,
        { method, headers: { Authorization: 'Bearer existing-token' } },
      )
      assert.equal(response.status, 200)
    }
    assert.equal(calls.length, mutationCases.length)
  }

  {
    const authInjectionCases = mutationCases.filter(
      ([path]) =>
        path.includes('/api:SYL06lUR/companies') ||
        path.includes('/api:PmBJV0AG/'),
    )
    const { window, calls } = loadShim({ hostname: 'thestarters.com' })
    for (const [path, method] of authInjectionCases) {
      const response = await window.fetch(
        `https://x08a-5ko8-jj1r.n7c.xano.io${path}`,
        { method },
      )
      assert.equal(response.status, 200)
    }
    const tradeCalls = calls.filter(({ input }) =>
      String(input).includes('/auth/trade-token/v3'),
    )
    assert.equal(tradeCalls.length, 1)
    const mutationCalls = calls.filter(
      ({ input }) => !String(input).includes('/auth/trade-token/v3'),
    )
    assert.equal(mutationCalls.length, authInjectionCases.length)
    for (const { init } of mutationCalls) {
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer xano-token')
    }
  }

  {
    const attempts = []
    let tradeCount = 0
    const { window } = loadShim({
      hostname: 'thestarters.com',
      fetchImpl: async (input) => {
        if (String(input).includes('/auth/trade-token/v3')) {
          tradeCount += 1
          return new Response(
            JSON.stringify({
              authToken: tradeCount === 1 ? 'stale-token' : 'fresh-token',
            }),
            { status: 200 },
          )
        }
        attempts.push({
          body: await input.text(),
          headers: new Headers(input.headers),
          method: input.method,
        })
        return new Response('{}', { status: attempts.length === 1 ? 401 : 200 })
      },
    })
    const request = new Request(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Header': 'request-value',
        },
        body: JSON.stringify({ job_title: 'Temporary QA Edited' }),
      },
    )
    const response = await window.fetch(request, {
      headers: { 'X-Init-Header': 'init-value' },
    })
    assert.equal(response.status, 200)
    assert.equal(tradeCount, 2)
    assert.equal(request.bodyUsed, false)
    assert.equal(attempts.length, 2)
    for (const [index, attempt] of attempts.entries()) {
      assert.equal(attempt.method, 'PATCH')
      assert.equal(attempt.body, '{"job_title":"Temporary QA Edited"}')
      assert.equal(attempt.headers.has('Content-Type'), false)
      assert.equal(attempt.headers.has('X-Request-Header'), false)
      assert.equal(attempt.headers.get('X-Init-Header'), 'init-value')
      assert.equal(
        attempt.headers.get('Authorization'),
        index === 0 ? 'Bearer stale-token' : 'Bearer fresh-token',
      )
    }
    const deleteResponse = await window.fetch(
      new Request(
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
        { method: 'DELETE' },
      ),
    )
    assert.equal(deleteResponse.status, 200)
    assert.equal(attempts.length, 3)
    assert.equal(attempts[2].method, 'DELETE')
    assert.equal(attempts[2].body, '')
    assert.equal(attempts[2].headers.get('Authorization'), 'Bearer fresh-token')
  }

  {
    const hostileInput = {
      url: 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
      method: 'PATCH',
      headers: { 'X-Hostile': 'value' },
      clone() {
        throw new Error('must not clone request-like objects')
      },
      toString() {
        return 'https://evil.test/token-target'
      },
    }
    const init = { headers: { 'X-Init-Header': 'init-value' } }
    const { window, calls } = loadShim({ hostname: 'thestarters.com' })
    const response = await window.fetch(hostileInput, init)
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, hostileInput)
    assert.equal(calls[0].init, init)
    assert.equal(init.headers.Authorization, undefined)
  }

  {
    const calls = []
    const { window } = loadShim({
      hostname: 'thestarters.com',
      fetchImpl: async (input, init) => {
        calls.push({ input, init })
        if (String(input).includes('/auth/trade-token/v3')) {
          return new Response(JSON.stringify({ authToken: 'replacement-token' }), {
            status: 200,
          })
        }
        return new Response('{}', { status: 200 })
      },
    })
    const request = new Request(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer request-token',
          'Content-Type': 'application/json',
        },
        body: '{"job_title":"Designer"}',
      },
    )
    const response = await window.fetch(request, {
      headers: { 'X-Init-Header': 'init-value' },
    })
    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
    const outgoing = calls[1].input
    assert.equal(calls[1].init, undefined)
    assert.equal(outgoing.headers.get('Authorization'), 'Bearer replacement-token')
    assert.equal(outgoing.headers.has('Content-Type'), false)
    assert.equal(outgoing.headers.get('X-Init-Header'), 'init-value')
    assert.equal(await outgoing.text(), '{"job_title":"Designer"}')
    assert.equal(request.bodyUsed, false)
  }

  {
    const live = loadShim({ hostname: 'thestarters.com' })
    const mutationUrl = new URL(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
    )
    const liveResponse = await live.window.fetch(mutationUrl, { method: 'PATCH' })
    assert.equal(liveResponse.status, 200)
    assert.equal(live.calls.length, 2)
    assert.equal(live.calls[1].input, mutationUrl.href)
    assert.equal(
      new Headers(live.calls[1].init.headers).get('Authorization'),
      'Bearer xano-token',
    )

    const staging = loadShim({ hostname: 'the-starters-3-0.webflow.io' })
    const stagingResponse = await staging.window.fetch(mutationUrl, {
      method: 'PATCH',
    })
    assert.equal(stagingResponse.status, 403)
    assert.equal((await stagingResponse.json()).code, 'EDIT_PROFILE_READ_ONLY')
    assert.equal(staging.calls.length, 0)
  }

  {
    class HostileUrl extends URL {
      toString() {
        return 'https://evil.test/token-target'
      }

      [Symbol.toPrimitive]() {
        return 'https://evil.test/token-target'
      }
    }
    const input = new HostileUrl(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
    )
    const { window, calls } = loadShim({ hostname: 'thestarters.com' })
    const response = await window.fetch(input, { method: 'PATCH' })
    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
    assert.equal(
      calls.some(({ input: outgoing }) => String(outgoing).includes('evil.test')),
      false,
    )
    assert.equal(
      calls[1].input,
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
    )
    assert.equal(
      new Headers(calls[1].init.headers).get('Authorization'),
      'Bearer xano-token',
    )
  }

  {
    class HostileRequest extends Request {
      get url() {
        return 'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1'
      }
    }
    const input = new HostileRequest('https://evil.test/token-target', {
      method: 'PATCH',
    })
    const { window, calls } = loadShim({ hostname: 'thestarters.com' })
    const response = await window.fetch(input)
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input instanceof HostileRequest, false)
    assert.equal(calls[0].input.url, 'https://evil.test/token-target')
    assert.equal(calls[0].input.headers.has('Authorization'), false)
  }

  {
    const calls = []
    const { window } = loadShim({
      hostname: 'thestarters.com',
      fetchImpl: async (input, init) => {
        calls.push({ input, init, body: await input.text() })
        return new Response('{}', { status: 200 })
      },
    })
    const request = new Request(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies/1',
      {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer existing-token',
          'Content-Type': 'application/json',
        },
        body: '{"job_title":"Designer"}',
      },
    )
    const init = { signal: new AbortController().signal }
    const response = await window.fetch(request, init)
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.notEqual(calls[0].input, request)
    assert.equal(calls[0].input.url, request.url)
    assert.equal(calls[0].init, undefined)
    assert.equal(calls[0].body, '{"job_title":"Designer"}')
    assert.equal(request.bodyUsed, false)
  }

  {
    const hostileUrls = [
      'https://evil.test/api:SYL06lUR/companies',
      'https://x08a-5ko8-jj1r.n7c.xano.io.evil.test/api:PmBJV0AG/Create_portfolio',
      'https://x08a-5ko8-jj1r.n7c.xano.io@evil.test/api:PmBJV0AG/Delete_portfolio',
      'https://evil.test/collect?next=/api:PmBJV0AG/Update_portfolio',
      'https://evil.test/api:KZf7nFnk/build_profile/starter/profile_image',
    ]
    const { window, calls } = loadShim({ hostname: 'thestarters.com' })
    for (const url of hostileUrls) {
      const response = await window.fetch(url, { method: 'POST' })
      assert.equal(response.status, 200)
    }
    assert.equal(calls.length, hostileUrls.length)
    for (const { init } of calls) {
      assert.equal(new Headers(init.headers).has('Authorization'), false)
    }
  }

  {
    const { window, calls } = loadShim({
      hostname: 'x08a-5ko8-jj1r.n7c.xano.io',
      origin: 'https://x08a-5ko8-jj1r.n7c.xano.io',
      pathname: '/hosted-page',
    })
    const response = await window.fetch('/api:SYL06lUR/companies', {
      method: 'POST',
    })
    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
    assert.equal(
      new Headers(calls[1].init.headers).get('Authorization'),
      'Bearer xano-token',
    )
  }

  {
    let releaseTrade
    const tradeGate = new Promise((resolve) => {
      releaseTrade = resolve
    })
    let resolveTradeStarted
    const tradeStarted = new Promise((resolve) => {
      resolveTradeStarted = resolve
    })
    let tradeCount = 0
    const { window } = loadShim({
      hostname: 'thestarters.com',
      fetchImpl: async (input) => {
        if (String(input).includes('/auth/trade-token/v3')) {
          tradeCount += 1
          resolveTradeStarted()
          await tradeGate
          return new Response(JSON.stringify({ authToken: 'shared-token' }), {
            status: 200,
          })
        }
        return new Response('{}', { status: 200 })
      },
    })
    const requests = [
      window.fetch(
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
        { method: 'POST' },
      ),
      window.fetch(
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Create_portfolio',
        { method: 'POST' },
      ),
    ]
    await tradeStarted
    assert.equal(tradeCount, 1)
    releaseTrade()
    await Promise.all(requests)
    assert.equal(tradeCount, 1)
  }

  {
    let tradeCount = 0
    let staleMutationCount = 0
    let resolveBothStale
    const bothStale = new Promise((resolve) => {
      resolveBothStale = resolve
    })
    const { window } = loadShim({
      hostname: 'thestarters.com',
      fetchImpl: async (input, init) => {
        if (String(input).includes('/auth/trade-token/v3')) {
          tradeCount += 1
          const authToken = tradeCount === 1 ? 'stale-token' : 'fresh-token'
          return new Response(JSON.stringify({ authToken }), { status: 200 })
        }
        const token = new Headers(init && init.headers).get('Authorization')
        if (token === 'Bearer stale-token') {
          staleMutationCount += 1
          if (staleMutationCount === 2) resolveBothStale()
          await bothStale
          return new Response('{}', { status: 401 })
        }
        return new Response('{}', { status: 200 })
      },
    })
    await Promise.all([
      window.fetch(
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
        { method: 'POST' },
      ),
      window.fetch(
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Create_portfolio',
        { method: 'POST' },
      ),
    ])
    assert.equal(staleMutationCount, 2)
    assert.equal(tradeCount, 2)
  }

  {
    let tradeCount = 0
    const { window } = loadShim({
      hostname: 'thestarters.com',
      fetchImpl: async (input) => {
        if (String(input).includes('/auth/trade-token/v3')) {
          tradeCount += 1
          if (tradeCount === 1) return new Response('{}', { status: 500 })
          return new Response(JSON.stringify({ authToken: 'recovered-token' }), {
            status: 200,
          })
        }
        return new Response('{}', { status: 200 })
      },
    })
    const endpoint =
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies'
    await Promise.all([
      window.fetch(endpoint, { method: 'POST' }),
      window.fetch(endpoint, { method: 'POST' }),
    ])
    assert.equal(tradeCount, 1)
    await window.fetch(endpoint, { method: 'POST' })
    assert.equal(tradeCount, 2)
  }

  {
    for (const hostname of [
      'notthestarters.com',
      'beta.thestarters.com',
      'www.thestarters.com.example.org',
      'thestarters.com.evil.test',
    ]) {
      const { window, localStorage, calls } = loadShim({ hostname })
      assert.equal(window.__TS_EDIT_PROFILE_MODE__, 'read-only')
      assert.equal(localStorage.getItem('editSubmit'), null)
      const response = await window.fetch(
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
        { method: 'POST' },
      )
      assert.equal(response.status, 403)
      assert.equal(calls.length, 0)
    }
  }

  {
    const { window, localStorage, calls } = loadShim({
      hostname: 'THESTARTERS.COM',
    })
    assert.equal(window.__TS_EDIT_PROFILE_MODE__, 'live-write')
    assert.equal(localStorage.getItem('editSubmit'), 'true')
    const response = await window.fetch(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
      { method: 'POST' },
    )
    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
    assert.equal(
      new Headers(calls[1].init.headers).get('Authorization'),
      'Bearer xano-token',
    )
  }

  {
    const { window, localStorage, calls } = loadShim({
      hostname: 'the-starters-3-0.webflow.io',
      pathname: '/build-profile/full-profile',
    })
    assert.equal(window.__TS_EDIT_PROFILE_MODE__, undefined)
    assert.equal(localStorage.getItem('editSubmit'), 'stale-value')
    const response = await window.fetch(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
      { method: 'POST' },
    )
    assert.equal(response.status, 200)
    assert.equal(calls.length, 2)
    assert.equal(
      new Headers(calls[1].init.headers).get('Authorization'),
      'Bearer xano-token',
    )
  }
}

run()
  .then(() => console.log('profile-image-auth-shim tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
