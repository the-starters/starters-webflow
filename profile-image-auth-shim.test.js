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
}) {
  const calls = []
  const window = {
    location: { hostname, pathname },
    localStorage,
    $memberstackDom: {
      async getMemberCookie() {
        return memberstackToken
      },
    },
    fetch: async (input, init) => {
      calls.push({ input, init })
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
