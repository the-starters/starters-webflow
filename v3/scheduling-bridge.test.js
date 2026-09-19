const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./scheduling-bridge.js'), 'utf8')
const XANO_ORIGIN = 'https://x08a-5ko8-jj1r.n7c.xano.io'
const SETTINGS_URL = `${XANO_ORIGIN}/api:tCpV3oqd/starter/free-call-settings/get/v3`

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(request) {
  return typeof request === 'string' ? request : request.url
}

function loadBridge(nativeFetch, pathname = '/starter-edit-profile') {
  const memberstack = {
    getMemberCookie: async () => 'memberstack-edit-profile',
    onAuthChange() {},
  }
  const window = {
    $memberstackDom: memberstack,
    fetch: nativeFetch,
    location: {
      hostname: 'www.thestarters.com',
      pathname,
      href: `https://www.thestarters.com${pathname}`,
    },
    setTimeout() {},
  }

  vm.runInNewContext(source, {
    Headers,
    Request,
    Response,
    URL,
    console: { info() {}, warn() {} },
    window,
  })
  return window
}

test('neutral bridge asset installs on production Edit Profile and authenticates a call-settings read', async () => {
  const schedulingRequests = []
  const nativeFetch = async (request) => {
    if (requestUrl(request).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-edit-profile' })
    }
    schedulingRequests.push(request)
    return response({ enabled: true })
  }
  const window = loadBridge(nativeFetch)

  assert.equal(window.__tsSchedulingAuthBridgeOwner, 'scheduling-auth')
  assert.equal(typeof window.__tsSchedulingAuthGetScope, 'function')
  assert.equal(typeof window.__tsSchedulingAuthFetch, 'function')

  const result = await window.__tsSchedulingAuthFetch(SETTINGS_URL)

  assert.equal(result.status, 200)
  assert.equal(schedulingRequests.length, 1)
  assert.equal(
    schedulingRequests[0].headers.get('Authorization'),
    'Bearer xano-edit-profile',
  )
})

test('neutral bridge asset keeps the production path allowlist', () => {
  const nativeFetch = async () => response({})
  const window = loadBridge(nativeFetch, '/starter-edit-profile-preview')

  assert.equal(window.__tsSchedulingAuthBridge, undefined)
  assert.equal(window.__tsSchedulingAuthFetch, undefined)
  assert.equal(window.fetch, nativeFetch)
})
