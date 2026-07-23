const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./auth-route.js'), 'utf8')

function plan(planId) {
  return { active: true, planId }
}

function loadRouter(options = {}) {
  const attributes = {}
  const form = {
    setAttribute(name, value) {
      attributes[name] = value
    },
  }
  const storage = new Map()
  if (options.storedDestination) {
    storage.set('thestarters:v3-auth-next', options.storedDestination)
  }
  const location = {
    hostname: options.hostname || 'the-starters-3-0.webflow.io',
    origin: `https://${options.hostname || 'the-starters-3-0.webflow.io'}`,
    pathname: options.pathname || '/test',
    search: options.search || '',
    replace(value) {
      location.replaced = value
    },
  }
  const sessionStorage = {
    getItem(key) {
      if (options.storageFailure === 'get') throw new DOMException('', 'SecurityError')
      return storage.get(key) || null
    },
    removeItem(key) {
      if (options.storageFailure === 'remove') {
        throw new DOMException('', 'SecurityError')
      }
      storage.delete(key)
    },
    setItem(key, value) {
      if (options.storageFailure === 'set') throw new DOMException('', 'SecurityError')
      storage.set(key, value)
    },
  }
  const window = {
    CustomEvent: class CustomEvent {
      constructor(name, init) {
        this.name = name
        this.detail = init.detail
      }
    },
    URL,
    URLSearchParams,
    dispatchEvent() {},
    location,
    sessionStorage,
    setInterval,
    clearInterval,
  }
  if (options.member) {
    window.$memberstackDom = {
      getCurrentMember: async () => ({ data: options.member }),
    }
  }
  const document = {
    documentElement: {
      setAttribute(name, value) {
        attributes[name] = value
      },
    },
    querySelectorAll() {
      return [form]
    },
  }

  vm.runInNewContext(source, {
    console: { error() {} },
    CustomEvent: window.CustomEvent,
    URL,
    URLSearchParams,
    document,
    window,
  })

  return { api: window.StartersV3AuthRouter, attributes, location, storage, window }
}

test('maps stable active plan IDs to application roles', () => {
  const { api } = loadRouter()

  assert.equal(
    api.memberRole({
      planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
    }),
    'talent',
  )
  assert.equal(
    api.memberRole({
      planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
    }),
    'brand-paid',
  )
})

test('paid Brand wins when a member has more than one mapped active plan', () => {
  const { api } = loadRouter()
  const member = {
    planConnections: [
      plan('pln_dorxata-test-free-plan-dvcg0k8o'),
      plan('pln_new-paid-plan-463h04ph'),
    ],
  }

  assert.equal(api.memberRole(member), 'brand-paid')
  assert.equal(api.destinationFor(member), '/brand-dashboard')
})

test('uses role defaults for Talent, paid Brand, and free Brand', () => {
  const { api } = loadRouter()

  assert.equal(
    api.destinationFor({
      planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
    }),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor({
      planConnections: [plan('pln_new-paid-plan-463h04ph')],
    }),
    '/brand-dashboard',
  )
  assert.equal(
    api.destinationFor({ planConnections: [plan('pln_free-plan-f6kn0dxz')] }),
    '/quiz-results',
  )
})

test('preserves only same-origin destinations allowed for the member role', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }

  assert.equal(
    api.destinationFor(talent, '/starter-edit-profile?from=beta'),
    '/starter-edit-profile?from=beta',
  )
  assert.equal(
    api.destinationFor(talent, '/brand-dashboard'),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor(talent, 'https://evil.example/steal'),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor(talent, '//evil.example/steal'),
    '/starter-dashboard',
  )
})

test('allows opportunity details only for Talent and paid Brand', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }
  const paidBrand = {
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }
  const freeBrand = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
  }

  assert.equal(
    api.destinationFor(talent, '/opportunities/product-designer?source=saved'),
    '/opportunities/product-designer?source=saved',
  )
  assert.equal(
    api.destinationFor(paidBrand, '/opportunities/product-designer'),
    '/opportunities/product-designer',
  )
  assert.equal(
    api.destinationFor(freeBrand, '/opportunities/product-designer'),
    '/quiz-results',
  )
  assert.equal(
    api.destinationFor(talent, '/opportunities/'),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor(talent, '/opportunities/product-designer/apply'),
    '/starter-dashboard',
  )
})

test('allows opportunity creation only for paid Brand', () => {
  const { api } = loadRouter()
  const talent = {
    planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
  }
  const paidBrand = {
    planConnections: [plan('pln_new-paid-plan-463h04ph')],
  }
  const freeBrand = {
    planConnections: [plan('pln_free-plan-f6kn0dxz')],
  }

  assert.equal(
    api.destinationFor(paidBrand, '/opportunities---create?from=dashboard'),
    '/opportunities---create?from=dashboard',
  )
  assert.equal(
    api.destinationFor(talent, '/opportunities---create'),
    '/starter-dashboard',
  )
  assert.equal(
    api.destinationFor(freeBrand, '/opportunities---create'),
    '/quiz-results',
  )
})

test('returns no destination for an unmapped plan', () => {
  const { api } = loadRouter()

  assert.equal(
    api.destinationFor({ planConnections: [plan('pln_unknown')] }),
    null,
  )
})

test('V3 login form overrides shared Memberstack redirects with auth route', () => {
  const { attributes, storage } = loadRouter({
    pathname: '/login',
    search: '?next=%2Fmessages',
  })

  assert.equal(attributes['data-ms-redirect'], '/auth-route')
  assert.equal(storage.get('thestarters:v3-auth-next'), '/messages')
})

test('login form redirect is configured when session storage writes fail', () => {
  const { attributes, storage } = loadRouter({
    pathname: '/login',
    search: '?next=%2Fmessages',
    storageFailure: 'set',
  })

  assert.equal(attributes['data-ms-redirect'], '/auth-route')
  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('login form redirect is configured when session storage reads fail', () => {
  const { attributes } = loadRouter({
    pathname: '/login',
    storageFailure: 'get',
  })

  assert.equal(attributes['data-ms-redirect'], '/auth-route')
})

test('fresh login clears an abandoned stored destination', () => {
  const { storage } = loadRouter({
    pathname: '/login',
    storedDestination: '/messages',
  })

  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('login with an invalid next clears an abandoned stored destination', () => {
  const { storage } = loadRouter({
    pathname: '/login',
    search: '?next=https%3A%2F%2Fevil.example%2Fsteal',
    storedDestination: '/messages',
  })

  assert.equal(storage.has('thestarters:v3-auth-next'), false)
})

test('does not change login forms on an unapproved hostname', () => {
  const { attributes } = loadRouter({
    hostname: 'attacker.example',
    pathname: '/login',
  })

  assert.equal(attributes['data-ms-redirect'], undefined)
})

test('auth route sends a paid Brand to the confirmed V3 Brand dashboard', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-brand',
      planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(location.replaced, '/brand-dashboard')
})

test('auth route preserves the stored destination from login', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storedDestination: '/opportunities/product-designer?source=login',
    member: {
      id: 'member-talent',
      planConnections: [plan('pln_dorxata-test-free-plan-dvcg0k8o')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    location.replaced,
    '/opportunities/product-designer?source=login',
  )
})

test('auth route uses role default when session storage removal fails', async () => {
  const { location } = loadRouter({
    pathname: '/auth-route',
    storageFailure: 'remove',
    member: {
      id: 'member-brand',
      planConnections: [plan('pln_dorxata-test-brand-plan-777r02pa')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(location.replaced, '/brand-dashboard')
})

test('auth route surfaces unmapped plans instead of silently routing home', async () => {
  const { attributes } = loadRouter({
    pathname: '/auth-route',
    member: {
      id: 'member-unknown',
      planConnections: [plan('pln_unknown')],
    },
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(attributes['data-auth-route-error'], 'unmapped-plan')
})
