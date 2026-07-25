const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(
  require.resolve('./profile-image-auth-shim.js'),
  'utf8',
)

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
}) {
  const calls = []
  const window = {
    location: { hostname, pathname },
    localStorage,
    fetch: async (input, init) => {
      calls.push({ input, init })
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

    for (const [url, method] of [
      [
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/edit_profile/update/member',
        'PATCH',
      ],
      [
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
        'POST',
      ],
      [
        'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Create_portfolio',
        'POST',
      ],
    ]) {
      const response = await window.fetch(url, { method })
      assert.equal(response.status, 403)
      assert.equal((await response.json()).code, 'EDIT_PROFILE_READ_ONLY')
    }
    assert.equal(calls.length, 0)

    const readResponse = await window.fetch(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:PmBJV0AG/Get_my_portfolios',
    )
    assert.equal(readResponse.status, 200)
    assert.equal(calls.length, 1)
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
    const response = await window.fetch(
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:SYL06lUR/companies',
      { method: 'POST' },
    )
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
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
    assert.equal(calls.length, 1)
  }
}

run()
  .then(() => console.log('profile-image-auth-shim tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
