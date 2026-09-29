const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./starter-dashboard-stripe-connect.js')

const ELEMENT_ATTR = 'data-stripe-connect-element'
const ACTION_ATTR = 'data-stripe-connect-action'
const selector = (name) => '[' + ELEMENT_ATTR + '="' + name + '"]'
const actionSelector = (name) => '[' + ACTION_ATTR + '="' + name + '"]'

class FakeElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName
    this.attributes = new Map()
    this.children = new Map()
    this.hidden = false
    this.style = {}
    this.classes = new Set()
    this.listeners = new Map()
    this.classList = {
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        if (force) this.classes.add(name)
        else this.classes.delete(name)
      },
    }
  }

  querySelector(value) {
    return this.children.get(value) || null
  }

  querySelectorAll(value) {
    const child = this.children.get(value)
    if (!child) return []
    return Array.isArray(child) ? child : [child]
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(event) {
    const listeners = this.listeners.get(event.type) || []
    listeners.forEach((listener) => listener.call(this, event))
    return event.defaultPrevented !== true
  }

  contains(element) {
    if (this === element) return true
    return Array.from(this.children.values()).some((value) => {
      const children = Array.isArray(value) ? value : [value]
      return children.some(
        (child) =>
          child === element ||
          (child &&
            typeof child.contains === 'function' &&
            child.contains(element)),
      )
    })
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.get(name) || null
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }
}

function stripeRoot() {
  const root = new FakeElement()
  const states = Object.fromEntries(
    ['loading', 'disconnected', 'incomplete', 'ready', 'review', 'error'].map(
      (name) => [name, new FakeElement()],
    ),
  )
  Object.entries(states).forEach(([name, element]) => {
    root.children.set(selector(name), element)
  })
  const errorCopy = {
    button: new FakeElement(),
    label: new FakeElement(),
    message: new FakeElement(),
  }
  errorCopy.label.textContent = 'Stripe Status Unavailable'
  errorCopy.message.textContent =
    "We couldn't load your Stripe status. Your account was not changed."
  errorCopy.button.textContent = 'Try Again'
  states.error.children.set('.label_text', errorCopy.label)
  states.error.children.set('.action-item_title', errorCopy.message)
  states.error.children.set('.button_main-text', errorCopy.button)
  return { errorCopy, root, states }
}

function response(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    json: async () => body,
  }
}

function sessionStorageFixture() {
  const values = new Map()
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    values,
  }
}

function returnContext(overrides = {}) {
  return {
    cleanReturnUrl: false,
    mode: '',
    pollForSettlement: false,
    reason: '',
    returnedFromStripe: false,
    ...overrides,
  }
}

test('dashboard view uses canonical connected and charges-enabled state', () => {
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: false },
      returnContext(),
    ),
    'disconnected',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: false },
      returnContext(),
    ),
    'incomplete',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: true },
      returnContext(),
    ),
    'ready',
  )
  assert.equal(
    api.resolveDashboardView({ mode: 'provider_unavailable' }, returnContext()),
    'error',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: 'false', charges_enabled: false },
      returnContext(),
    ),
    'error',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: true },
      returnContext(),
    ),
    'error',
  )
})

test('a Stripe return renders review only while the provider account is connected', () => {
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: false },
      returnContext({ mode: 'connected', returnedFromStripe: true }),
    ),
    'review',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: false },
      returnContext({ mode: 'connected', returnedFromStripe: true }),
    ),
    'disconnected',
  )
})

test('exchange outcome exposes only the allowlisted owner-conflict reason', () => {
  assert.deepEqual(
    api.resolveExchangeOutcome({
      connected: false,
      mode: 'reconciliation_required',
      reason: 'account_owner_conflict',
    }),
    {
      mode: 'reconciliation_required',
      reason: 'account_owner_conflict',
    },
  )
  assert.deepEqual(
    api.resolveExchangeOutcome({
      connected: false,
      mode: 'reconciliation_required',
      reason: 'oauth_exchange_ambiguous',
    }),
    { mode: 'reconciliation_required', reason: '' },
  )
  assert.deepEqual(
    api.resolveExchangeOutcome({
      connected: true,
      mode: 'completed',
      reason: 'account_owner_conflict',
    }),
    { mode: 'completed', reason: '' },
  )
})

test('return context bounds query-controlled Stripe mode and reason', () => {
  assert.deepEqual(
    api.resolveReturnContext(
      '?stripe_connect=reconciliation_required&stripe_connect_reason=account_owner_conflict',
    ),
    {
      cleanReturnUrl: true,
      mode: 'reconciliation_required',
      pollForSettlement: true,
      reason: '',
      returnedFromStripe: true,
    },
  )
  assert.deepEqual(
    api.resolveReturnContext(
      '?stripe_connect=reconciliation_required&stripe_connect_reason=account_owner_conflict',
      'account_owner_conflict',
    ),
    {
      cleanReturnUrl: true,
      mode: 'reconciliation_required',
      pollForSettlement: false,
      reason: 'account_owner_conflict',
      returnedFromStripe: true,
    },
  )
  assert.deepEqual(
    api.resolveReturnContext(
      '?stripe_connect=reconciliation_required&stripe_connect_reason=private_backend_detail',
    ),
    {
      cleanReturnUrl: true,
      mode: 'reconciliation_required',
      pollForSettlement: true,
      reason: '',
      returnedFromStripe: true,
    },
  )
  assert.deepEqual(
    api.resolveReturnContext(
      '?stripe_connect=restart_required&stripe_connect_reason=account_owner_conflict',
    ),
    {
      cleanReturnUrl: true,
      mode: 'restart_required',
      pollForSettlement: false,
      reason: '',
      returnedFromStripe: false,
    },
  )
  assert.deepEqual(api.resolveReturnContext('?stripe_connect=forged'), {
    cleanReturnUrl: true,
    mode: '',
    pollForSettlement: false,
    reason: '',
    returnedFromStripe: false,
  })
})

test('owner-conflict return receipt is short-lived, member-bound, and one-time', () => {
  const previousStorage = global.sessionStorage
  const storage = sessionStorageFixture()
  global.sessionStorage = storage
  const outcome = {
    mode: 'reconciliation_required',
    reason: 'account_owner_conflict',
  }

  try {
    assert.equal(api.storeReturnReason('mem-a', outcome), true)
    assert.equal(
      api.consumeReturnReason('mem-a', 'reconciliation_required'),
      'account_owner_conflict',
    )
    assert.equal(
      api.consumeReturnReason('mem-a', 'reconciliation_required'),
      '',
      'the receipt cannot be replayed',
    )

    assert.equal(api.storeReturnReason('mem-a', outcome), true)
    assert.equal(
      api.consumeReturnReason('mem-b', 'reconciliation_required'),
      '',
      'a different member cannot use the receipt',
    )

    assert.equal(api.storeReturnReason('mem-a', outcome), true)
    assert.equal(
      api.consumeReturnReason('mem-a', 'restart_required'),
      '',
      'a different return mode cannot use the receipt',
    )

    assert.equal(api.storeReturnReason('mem-a', outcome), true)
    const [storageKey] = storage.values.keys()
    const expired = JSON.parse(storage.getItem(storageKey))
    expired.createdAt = Date.now() - 6 * 60 * 1000
    storage.setItem(storageKey, JSON.stringify(expired))
    assert.equal(
      api.consumeReturnReason('mem-a', 'reconciliation_required'),
      '',
      'an expired receipt cannot be used',
    )

    assert.equal(
      api.storeReturnReason('mem-a', {
        mode: 'reconciliation_required',
        reason: 'private_backend_detail',
      }),
      false,
    )
    assert.equal(storage.values.size, 0)
  } finally {
    global.sessionStorage = previousStorage
  }
})

test('canonical status wins while disconnected reconciliation stays fail closed', () => {
  const conflict = {
    mode: 'reconciliation_required',
    reason: 'account_owner_conflict',
    returnedFromStripe: true,
  }
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: false },
      conflict,
    ),
    'error',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: true },
      conflict,
    ),
    'ready',
  )
})

test('owner conflict uses safe recovery copy and later generic errors restore authored copy', () => {
  const { errorCopy, root } = stripeRoot()

  api.renderRoots([root], 'error', 'account_owner_conflict')

  assert.equal(
    root.getAttribute('data-stripe-connect-reason'),
    'account_owner_conflict',
  )
  assert.equal(errorCopy.label.textContent, 'Stripe account already linked')
  assert.equal(
    errorCopy.message.textContent,
    'This Stripe account is already linked to another Starter profile. Use a different Stripe account or contact The Starters.',
  )
  assert.equal(errorCopy.button.textContent, 'Connect a different account')

  api.renderRoots([root], 'error')

  assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
  assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
  assert.equal(
    errorCopy.message.textContent,
    "We couldn't load your Stripe status. Your account was not changed.",
  )
  assert.equal(errorCopy.button.textContent, 'Try Again')
})

test('only the authored conflict error action starts different-account recovery', () => {
  const { root, states } = stripeRoot()
  const refresh = new FakeElement('BUTTON')
  const unrelatedRefresh = new FakeElement('BUTTON')
  states.error.children.set(actionSelector('refresh'), refresh)

  api.renderRoots([root], 'error', 'account_owner_conflict')
  assert.equal(
    api.isAccountOwnerConflictRecovery(refresh, [root]),
    true,
  )
  assert.equal(
    api.isAccountOwnerConflictRecovery(unrelatedRefresh, [root]),
    false,
  )

  api.renderRoots([root], 'error')
  assert.equal(
    api.isAccountOwnerConflictRecovery(refresh, [root]),
    false,
  )
})

test('owner conflict reads canonical status once and cleans both return parameters', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { errorCopy, root } = stripeRoot()
  const replaced = []
  let statusReads = 0
  let unsubscribes = 0
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.document = { title: 'Starter dashboard' }
  global.fetch = async () => {
    statusReads += 1
    return response({ connected: false, charges_enabled: false })
  }
  global.history = {
    replaceState: (_state, _title, url) => replaced.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof#stripe',
    search:
      '?stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof',
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-live' } }),
    onAuthChange() {
      return {
        unsubscribe() {
          unsubscribes += 1
        },
      }
    },
  }
  api.__resetXanoToken()

  try {
    const conflictAuthScope = api.armConflictAuthScope('member-live')
    assert.ok(conflictAuthScope)
    const context = {
      ...api.resolveReturnContext(
        global.location.search,
        'account_owner_conflict',
      ),
      conflictAuthScope,
    }
    await api.loadDashboardStatus([root], context)

    assert.equal(statusReads, 1)
    assert.equal(unsubscribes, 1)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(errorCopy.label.textContent, 'Stripe account already linked')
    assert.deepEqual(replaced, [
      '/starter-dashboard?utm_source=proof#stripe',
    ])
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('owner-conflict guidance requires a valid canonical disconnect', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
  }
  const { errorCopy, root } = stripeRoot()
  let liveReads = 0
  let statusReads = 0
  let unsubscribes = 0
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async () => {
    statusReads += 1
    return response({ connected: false, charges_enabled: true })
  }
  global.$memberstackDom = {
    getCurrentMember: async () => {
      liveReads += 1
      return { data: { id: 'member-live' } }
    },
    onAuthChange: () => ({
      unsubscribe() {
        unsubscribes += 1
      },
    }),
  }
  api.__resetXanoToken()

  try {
    const conflictAuthScope = api.armConflictAuthScope('member-live')
    assert.ok(conflictAuthScope)
    await api.loadDashboardStatus(
      [root],
      returnContext({
        conflictAuthScope,
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
        returnedFromStripe: true,
      }),
    )

    assert.equal(statusReads, 1)
    assert.equal(liveReads, 6)
    assert.equal(unsubscribes, 1)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
    assert.equal(errorCopy.button.textContent, 'Try Again')
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
  }
})

test('forged owner-conflict query polls before showing the generic authored error', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    setTimeout: global.setTimeout,
  }
  const { errorCopy, root } = stripeRoot()
  let statusReads = 0
  global.document = { title: 'Starter dashboard' }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async () => {
    statusReads += 1
    return response({ connected: false, charges_enabled: false })
  }
  global.history = { replaceState: () => {} }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict',
    search:
      '?stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict',
  }
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  api.__resetXanoToken()

  try {
    await api.loadDashboardStatus(
      [root],
      api.resolveReturnContext(global.location.search),
    )

    assert.equal(statusReads, 5)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
    assert.equal(errorCopy.button.textContent, 'Try Again')
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.setTimeout = previous.setTimeout
  }
})

test('restart marker uses one canonical read and cannot retain a forged reason', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
  }
  const { root } = stripeRoot()
  const replaced = []
  let statusReads = 0
  global.document = { title: 'Starter dashboard' }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async () => {
    statusReads += 1
    return response({ connected: false, charges_enabled: false })
  }
  global.history = {
    replaceState: (_state, _title, url) => replaced.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=restart_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof#stripe',
    search:
      '?stripe_connect=restart_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof',
  }
  api.__resetXanoToken()

  try {
    await api.loadDashboardStatus(
      [root],
      api.resolveReturnContext(
        global.location.search,
        'account_owner_conflict',
      ),
    )

    assert.equal(statusReads, 1)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'disconnected')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.deepEqual(replaced, [
      '/starter-dashboard?utm_source=proof#stripe',
    ])
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
  }
})

test('canonical ready status overrides a stale conflict marker', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { errorCopy, root } = stripeRoot()
  let liveReads = 0
  let statusReads = 0
  let unsubscribes = 0
  global.document = { title: 'Starter dashboard' }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async () => {
    statusReads += 1
    return response({ connected: true, charges_enabled: true })
  }
  global.history = { replaceState: () => {} }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict',
    search:
      '?stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict',
  }
  global.$memberstackDom = {
    getCurrentMember: async () => {
      liveReads += 1
      return { data: { id: 'member-live' } }
    },
    onAuthChange: () => ({
      unsubscribe() {
        unsubscribes += 1
      },
    }),
  }
  api.__resetXanoToken()

  try {
    const conflictAuthScope = api.armConflictAuthScope('member-live')
    assert.ok(conflictAuthScope)
    await api.loadDashboardStatus(
      [root],
      {
        ...api.resolveReturnContext(
          global.location.search,
          'account_owner_conflict',
        ),
        conflictAuthScope,
      },
    )

    assert.equal(statusReads, 1)
    assert.equal(liveReads, 6)
    assert.equal(unsubscribes, 1)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'ready')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(root.hidden, true)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('auth loss discards an in-flight status without recovery', async () => {
  const previous = {
    CustomEvent: global.CustomEvent,
    dispatchEvent: global.dispatchEvent,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
    setTimeout: global.setTimeout,
  }
  const { root } = stripeRoot()
  const setRootAttribute = root.setAttribute.bind(root)
  const renderedViews = []
  const readyEvents = []
  const statusAuthorizations = []
  const tokenOptions = []
  let authChangeListener
  let authUnsubscribes = 0
  let liveMemberId = 'member-a'
  let markFirstStatusStarted
  let resolveFirstStatus
  let statusReads = 0
  const firstStatusStarted = new Promise((resolve) => {
    markFirstStatusStarted = resolve
  })

  root.setAttribute = (name, value) => {
    if (name === 'data-stripe-connect-view') {
      renderedViews.push(String(value))
    }
    setRootAttribute(name, value)
  }
  global.CustomEvent = class {
    constructor(type, options) {
      this.detail = options.detail
      this.type = type
    }
  }
  global.dispatchEvent = (event) => {
    if (event.type === 'starterStripeConnectReady') {
      readyEvents.push(event.detail)
    }
    return true
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: liveMemberId } }),
    onAuthChange(listener) {
      authChangeListener = listener
      return {
        unsubscribe() {
          authUnsubscribes += 1
        },
      }
    },
  }
  global.getXanoAuthToken = async (options) => {
    tokenOptions.push(options)
    return liveMemberId + '-xano-token'
  }
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.fetch = async (_url, options) => {
    statusReads += 1
    statusAuthorizations.push(options.headers.Authorization)
    if (statusReads === 1) {
      return new Promise((resolve) => {
        resolveFirstStatus = () =>
          resolve(response({ connected: true, charges_enabled: false }))
        markFirstStatusStarted()
      })
    }
    return response({ connected: true, charges_enabled: true })
  }
  api.__resetXanoToken()
  api.renderRoots([root], 'ready', '', true)
  renderedViews.length = 0

  try {
    const conflictAuthScope = api.armConflictAuthScope('member-a')
    assert.ok(conflictAuthScope)
    const loaded = api.loadDashboardStatus(
      [root],
      returnContext({
        conflictAuthScope,
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
        returnedFromStripe: true,
      }),
    )
    await firstStatusStarted

    liveMemberId = 'member-b'
    authChangeListener({ id: 'member-b' })
    resolveFirstStatus()

    assert.equal(await loaded, null)
    assert.equal(statusReads, 1)
    assert.equal(authUnsubscribes, 1)
    assert.deepEqual(tokenOptions, [undefined])
    assert.deepEqual(statusAuthorizations, ['Bearer member-a-xano-token'])
    assert.equal(renderedViews.includes('incomplete'), false)
    assert.equal(renderedViews.includes('review'), false)
    assert.equal(renderedViews.includes('ready'), false)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(root.hidden, false)
    assert.deepEqual(readyEvents, [])
  } finally {
    api.__resetXanoToken()
    global.CustomEvent = previous.CustomEvent
    global.dispatchEvent = previous.dispatchEvent
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
    global.setTimeout = previous.setTimeout
  }
})

test('auth loss during token acquisition prevents the status request', async () => {
  const previous = {
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
  }
  const { root } = stripeRoot()
  const statusAuthorizations = []
  const tokenOptions = []
  let authChangeListener
  let authUnsubscribes = 0
  let liveMemberId = 'member-a'
  let markTokenRequestStarted
  let resolveToken
  let statusReads = 0
  const tokenRequestStarted = new Promise((resolve) => {
    markTokenRequestStarted = resolve
  })

  global.console = { ...console, error: () => {} }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: liveMemberId } }),
    onAuthChange(listener) {
      authChangeListener = listener
      return {
        unsubscribe() {
          authUnsubscribes += 1
        },
      }
    },
  }
  global.getXanoAuthToken = (options) => {
    tokenOptions.push(options)
    return new Promise((resolve) => {
      resolveToken = resolve
      markTokenRequestStarted()
    })
  }
  global.fetch = async (_url, options) => {
    statusReads += 1
    statusAuthorizations.push(options.headers.Authorization)
    return response({ connected: true, charges_enabled: true })
  }
  api.__resetXanoToken()

  try {
    const conflictAuthScope = api.armConflictAuthScope('member-a')
    assert.ok(conflictAuthScope)
    const loaded = api.loadDashboardStatus(
      [root],
      returnContext({
        conflictAuthScope,
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
        returnedFromStripe: true,
      }),
    )
    await tokenRequestStarted

    liveMemberId = 'member-b'
    authChangeListener({ id: 'member-b' })
    liveMemberId = 'member-a'
    authChangeListener({ id: 'member-a' })
    resolveToken('member-b-xano-token')

    assert.equal(await loaded, null)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(authUnsubscribes, 1)
    assert.equal(statusReads, 0)
    assert.deepEqual(tokenOptions, [undefined])
    assert.deepEqual(statusAuthorizations, [])
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
  }
})

test('rendering selects authored state without changing its copy', () => {
  const { root, states } = stripeRoot()
  states.review.textContent = 'Stripe is reviewing your account.'

  api.setView(root, 'review')

  assert.equal(states.review.style.display, '')
  assert.equal(states.loading.style.display, 'none')
  assert.equal(states.error.style.display, 'none')
  assert.equal(states.review.textContent, 'Stripe is reviewing your account.')
  assert.equal(root.getAttribute('data-stripe-connect-status'), 'review')
  assert.equal(root.getAttribute('data-stripe-connect-view'), 'review')
})

test('connected Stripe states remove the Action Item root', () => {
  for (const view of ['incomplete', 'ready', 'review']) {
    const { root } = stripeRoot()

    api.renderRoots([root], view, '', true)

    assert.equal(root.hidden, true, view)
    assert.equal(root.style.display, 'none', view)
  }

  for (const view of ['loading', 'error']) {
    const { root } = stripeRoot()

    api.renderRoots([root], view)

    assert.equal(root.hidden, false, view)
    assert.equal(root.style.display, '', view)
  }

  const { root } = stripeRoot()
  api.renderRoots([root], 'disconnected', '', false)
  assert.equal(root.hidden, false)
  assert.equal(root.style.display, '')
})

test('status refresh keeps a canonically connected Action Item hidden while polling', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  const { root } = stripeRoot()
  let resolveStatus
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = () =>
    new Promise((resolve) => {
      resolveStatus = resolve
    })
  api.__resetXanoToken()
  api.renderRoots([root], 'ready', '', true)

  try {
    const refresh = api.loadDashboardStatus([root], returnContext())
    await new Promise(setImmediate)

    assert.equal(root.getAttribute('data-stripe-connect-view'), 'loading')
    assert.equal(root.hidden, true)
    assert.equal(root.style.display, 'none')

    resolveStatus(response({ connected: true, charges_enabled: true }))
    await refresh
    assert.equal(root.hidden, true)
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})

test('Dashboard access failure keeps a canonically connected Action Item hidden', async () => {
  const previous = {
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const { root } = stripeRoot()
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  }
  global.console = { ...console, error: () => {} }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.open = () => stripeTab
  global.fetch = async () => response({}, { ok: false, status: 503 })
  api.__resetXanoToken()
  api.renderRoots([root], 'ready', '', true)

  try {
    assert.equal(
      await api.openDashboardInNewTab(
        api.createExclusiveRunner(),
        new FakeElement('A'),
        [root],
        'member-123',
      ),
      false,
    )
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.hidden, true)
    assert.equal(root.style.display, 'none')
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('the two authored earnings tiles resolve to disconnected and ready states', () => {
  const connect = new FakeElement()
  const history = new FakeElement()

  const tiles = api.resolveEarningsTiles([connect, history])

  assert.equal(tiles.disconnected, connect)
  assert.equal(tiles.ready, history)
})

test('explicit earnings state attributes do not depend on document order', () => {
  const connect = new FakeElement()
  const history = new FakeElement()
  connect.setAttribute('data-stripe-connect-earnings-state', 'disconnected')
  history.setAttribute('data-stripe-connect-earnings-state', 'ready')

  const tiles = api.resolveEarningsTiles([history, connect])

  assert.equal(tiles.disconnected, connect)
  assert.equal(tiles.ready, history)
})

test('partial earnings state wiring assigns only the unlabeled fallback', () => {
  const labeledConnect = new FakeElement()
  const unlabeledHistory = new FakeElement()
  labeledConnect.setAttribute(
    'data-stripe-connect-earnings-state',
    'disconnected',
  )

  const connectTiles = api.resolveEarningsTiles([
    unlabeledHistory,
    labeledConnect,
  ])

  assert.equal(connectTiles.disconnected, labeledConnect)
  assert.equal(connectTiles.ready, unlabeledHistory)

  const unlabeledConnect = new FakeElement()
  const labeledHistory = new FakeElement()
  labeledHistory.setAttribute('data-stripe-connect-earnings-state', 'ready')

  const historyTiles = api.resolveEarningsTiles([
    labeledHistory,
    unlabeledConnect,
  ])

  assert.equal(historyTiles.disconnected, unlabeledConnect)
  assert.equal(historyTiles.ready, labeledHistory)
})

test('a lone explicitly disconnected tile is never reused as ready', () => {
  const connect = new FakeElement()
  connect.setAttribute('data-stripe-connect-earnings-state', 'disconnected')

  const tiles = api.resolveEarningsTiles([connect])

  assert.equal(tiles.disconnected, connect)
  assert.equal(tiles.ready, undefined)

  api.renderEarningsTiles(tiles, 'disconnected')
  assert.equal(connect.hidden, false)
  assert.equal(connect.getAttribute('aria-disabled'), 'false')
})

test('one authored blue tile stays visible and changes action with Stripe state', () => {
  const connect = new FakeElement()
  const history = new FakeElement()
  const title = new FakeElement()
  const description = new FakeElement()
  history.children.set('.dash-hero_button-title', title)
  history.children.set('.dash-hero_button-description', description)
  const tiles = api.resolveEarningsTiles([connect, history])

  api.renderEarningsTiles(tiles, 'disconnected')

  assert.equal(connect.hidden, true)
  assert.equal(connect.style.display, 'none')
  assert.equal(history.hidden, false)
  assert.equal(history.style.display, '')
  assert.equal(history.getAttribute('aria-disabled'), 'false')
  assert.equal(history.getAttribute('tabindex'), '0')
  assert.equal(history.getAttribute('data-stripe-connect-hero-action'), 'start')
  assert.equal(title.textContent, 'Get Paid')
  assert.equal(description.textContent, 'Connect Stripe')

  api.renderEarningsTiles(tiles, 'incomplete')

  assert.equal(history.hidden, false)
  assert.equal(history.getAttribute('data-stripe-connect-hero-action'), 'start')
  assert.equal(title.textContent, 'Complete Setup')
  assert.equal(description.textContent, 'Finish Stripe onboarding')

  api.renderEarningsTiles(tiles, 'review')

  assert.equal(history.hidden, false)
  assert.equal(history.getAttribute('aria-disabled'), 'true')
  assert.equal(history.getAttribute('tabindex'), '-1')
  assert.equal(history.getAttribute('data-stripe-connect-hero-action'), 'none')
  assert.equal(title.textContent, 'Under Review')
  assert.equal(description.textContent, 'Stripe is reviewing your account')

  api.renderEarningsTiles(tiles, 'ready')

  assert.equal(connect.hidden, true)
  assert.equal(connect.style.display, 'none')
  assert.equal(history.hidden, false)
  assert.equal(history.style.display, '')
  assert.equal(history.getAttribute('aria-disabled'), 'false')
  assert.equal(history.getAttribute('tabindex'), '0')
  assert.equal(
    history.getAttribute('data-stripe-connect-hero-action'),
    'dashboard',
  )
  assert.equal(title.textContent, 'Earnings')
  assert.equal(description.textContent, 'Payment history & payouts')
})

test('the blue tile stays visible but disabled while status is unresolved', () => {
  const connect = new FakeElement()
  const history = new FakeElement()
  const title = new FakeElement()
  const description = new FakeElement()
  history.children.set('.dash-hero_button-title', title)
  history.children.set('.dash-hero_button-description', description)
  const tiles = api.resolveEarningsTiles([connect, history])

  api.renderEarningsTiles(tiles, 'loading')
  assert.equal(connect.hidden, true)
  assert.equal(history.hidden, false)
  assert.equal(history.getAttribute('aria-disabled'), 'true')
  assert.equal(history.getAttribute('data-stripe-connect-hero-action'), 'none')
  assert.equal(title.textContent, 'Checking Stripe')
  assert.equal(description.textContent, 'Loading account status')

  api.renderEarningsTiles(tiles, 'error')
  assert.equal(connect.hidden, true)
  assert.equal(history.hidden, false)
  assert.equal(history.getAttribute('aria-disabled'), 'true')
  assert.equal(title.textContent, 'Stripe Unavailable')
  assert.equal(description.textContent, 'Use Try Again above')

  api.renderEarningsTiles(tiles, 'error', 'account_owner_conflict')
  assert.equal(title.textContent, 'Stripe Unavailable')
  assert.equal(
    description.textContent,
    'Use Connect a different account above',
  )
})

test('the single blue tile dispatches only its current state action', () => {
  const tile = new FakeElement()
  tile.setAttribute('aria-disabled', 'false')
  const activations = []
  const event = {
    key: 'Enter',
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  const actions = {
    start: () => activations.push('start'),
    dashboard: () => activations.push('dashboard'),
  }

  tile.setAttribute('data-stripe-connect-hero-action', 'start')
  assert.equal(
    api.handleHeroTileActivation(tile, event, false, actions),
    true,
  )

  tile.setAttribute('data-stripe-connect-hero-action', 'dashboard')
  assert.equal(
    api.handleHeroTileActivation(tile, event, true, actions),
    true,
  )

  tile.setAttribute('data-stripe-connect-hero-action', 'none')
  assert.equal(
    api.handleHeroTileActivation(tile, event, false, actions),
    false,
  )
  assert.deepEqual(activations, ['start', 'dashboard'])
  assert.equal(event.prevented, true)
})

test('the disconnected earnings tile activates only while enabled', () => {
  const connect = new FakeElement()
  let activations = 0
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }

  connect.setAttribute('aria-disabled', 'true')
  assert.equal(
    api.handleConnectClick(connect, event, () => {
      activations += 1
    }),
    false,
  )
  assert.equal(event.prevented, true)
  assert.equal(activations, 0)

  event.prevented = false
  connect.setAttribute('aria-disabled', 'false')
  assert.equal(
    api.handleConnectClick(connect, event, () => {
      activations += 1
    }),
    true,
  )
  assert.equal(event.prevented, true)
  assert.equal(activations, 1)
})

test('the disconnected earnings tile supports Enter and Space', () => {
  const connect = new FakeElement()
  const keys = []
  const keydown = (key) => ({
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  })
  connect.setAttribute('aria-disabled', 'false')

  assert.equal(
    api.handleConnectKeydown(connect, keydown('a'), () => keys.push('a')),
    false,
  )
  assert.equal(
    api.handleConnectKeydown(connect, keydown('Enter'), () => keys.push('Enter')),
    true,
  )
  assert.equal(
    api.handleConnectKeydown(connect, keydown(' '), () => keys.push('Space')),
    true,
  )
  assert.deepEqual(keys, ['Enter', 'Space'])
})

test('a pending Connect Stripe action is visibly and fully disabled', () => {
  const connect = new FakeElement()
  connect.disabled = false
  connect.setAttribute('data-stripe-connect-earnings-state', 'disconnected')
  api.renderEarningsTiles(api.resolveEarningsTiles([connect]), 'disconnected')

  api.setActionPending(connect, true)

  assert.equal(connect.getAttribute('aria-busy'), 'true')
  assert.equal(connect.getAttribute('aria-disabled'), 'true')
  assert.equal(connect.getAttribute('tabindex'), '-1')
  assert.equal(connect.classList.contains('is-disabled'), true)
  assert.equal(connect.style.pointerEvents, 'none')
  assert.equal(connect.disabled, true)

  let activations = 0
  const event = { preventDefault() {} }
  assert.equal(
    api.handleConnectClick(connect, event, () => {
      activations += 1
    }),
    false,
  )
  assert.equal(activations, 0)

  api.setActionPending(connect, false)

  assert.equal(connect.getAttribute('aria-busy'), 'false')
  assert.equal(connect.getAttribute('aria-disabled'), 'false')
  assert.equal(connect.getAttribute('tabindex'), '0')
  assert.equal(connect.getAttribute('data-stripe-connect-pending-tabindex'), null)
  assert.equal(connect.classList.contains('is-disabled'), false)
  assert.equal(connect.style.pointerEvents, '')
  assert.equal(connect.disabled, false)
})

test('both start paths apply pending state to the Connect Stripe tile', () => {
  const connect = new FakeElement()
  const actionListButton = new FakeElement('BUTTON')
  connect.setAttribute('tabindex', '0')

  ;[connect, actionListButton].forEach((initiator) => {
    api.setStartPending(initiator, connect, true)

    assert.equal(connect.getAttribute('aria-busy'), 'true')
    assert.equal(connect.getAttribute('aria-disabled'), 'true')
    assert.equal(connect.getAttribute('tabindex'), '-1')
    assert.equal(connect.classList.contains('is-disabled'), true)
    assert.equal(initiator.getAttribute('aria-busy'), 'true')

    api.setStartPending(initiator, connect, false)
    assert.equal(connect.getAttribute('tabindex'), '0')
    assert.equal(connect.getAttribute('aria-disabled'), 'false')
  })
})

test('the exclusive start guard latches only after a successful redirect', async () => {
  const successfulRunner = api.createExclusiveRunner()
  let successfulRuns = 0

  assert.equal(
    await successfulRunner(() => {
      successfulRuns += 1
      return true
    }, true),
    true,
  )
  assert.equal(
    await successfulRunner(() => {
      successfulRuns += 1
      return true
    }, true),
    null,
  )
  assert.equal(successfulRuns, 1)

  const failedRunner = api.createExclusiveRunner()
  let failedRuns = 0
  assert.equal(
    await failedRunner(() => {
      failedRuns += 1
      return false
    }, true),
    false,
  )
  assert.equal(
    await failedRunner(() => {
      failedRuns += 1
      return true
    }, true),
    true,
  )
  assert.equal(failedRuns, 2)
})

test('earnings delegates account access only while charges are enabled', () => {
  const earnings = new FakeElement('A')
  earnings.setAttribute('href', '#')

  api.setEarningsAccess([earnings], false)

  assert.equal(earnings.getAttribute('href'), null)
  assert.equal(earnings.getAttribute('target'), null)
  assert.equal(earnings.getAttribute('rel'), null)
  assert.equal(earnings.getAttribute('aria-disabled'), 'true')
  assert.equal(earnings.getAttribute('tabindex'), '-1')
  assert.equal(earnings.classList.contains('is-disabled'), true)

  api.setEarningsAccess([earnings], true)

  assert.equal(earnings.getAttribute('href'), '#')
  assert.equal(earnings.getAttribute('target'), null)
  assert.equal(earnings.getAttribute('rel'), null)
  assert.equal(earnings.getAttribute('aria-disabled'), 'false')
  assert.equal(earnings.getAttribute('tabindex'), null)
  assert.equal(earnings.classList.contains('is-disabled'), false)
  let activations = 0
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  assert.equal(
    api.handleEarningsClick(earnings, event, () => {
      activations += 1
    }),
    true,
  )
  assert.equal(event.prevented, true)
  assert.equal(activations, 1)
})

test('the authored Earnings div activates from the keyboard once enabled', () => {
  const earnings = new FakeElement()
  const activations = []
  const keydown = (key) => ({
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  })
  api.setEarningsAccess([earnings], false)
  const whileDisabled = keydown('Enter')
  assert.equal(
    api.handleEarningsKeydown(earnings, whileDisabled, () => activations.push('disabled')),
    false,
  )
  assert.equal(whileDisabled.prevented, true)

  api.setEarningsAccess([earnings], true)
  const ignored = keydown('a')
  assert.equal(api.handleEarningsKeydown(earnings, ignored, () => {}), false)
  assert.equal(ignored.prevented, false)

  const enter = keydown('Enter')
  assert.equal(
    api.handleEarningsKeydown(earnings, enter, () => activations.push('Enter')),
    true,
  )
  assert.equal(enter.prevented, true)

  const space = keydown(' ')
  assert.equal(
    api.handleEarningsKeydown(earnings, space, () => activations.push('Space')),
    true,
  )
  assert.equal(space.prevented, true)
  assert.deepEqual(activations, ['Enter', 'Space'])
})

test('keyboard activation is a no-op for the anchor earnings tile', () => {
  const earnings = new FakeElement('A')
  const event = {
    key: 'Enter',
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
  }
  assert.equal(api.handleEarningsKeydown(earnings, event), false)
  assert.equal(event.prevented, false)
})

test('Stripe Dashboard destinations are account-scoped and fail closed', () => {
  assert.equal(
    api.isStripeDashboardUrl(
      'https://dashboard.stripe.com/b/acct_123ABC',
      'full',
      'acct_123ABC',
    ),
    true,
  )
  assert.equal(
    api.isStripeDashboardUrl(
      'https://connect.stripe.com/express/acct_123ABC/single-use-token',
      'express',
      'acct_123ABC',
    ),
    true,
  )
  assert.equal(
    api.isStripeDashboardUrl(
      'https://dashboard.stripe.com/b/acct_123ABC',
      'full',
      'acct_DIFFERENT',
    ),
    false,
  )
  assert.equal(
    api.isStripeDashboardUrl(
      'https://evil.example/b/acct_123ABC',
      'full',
      'acct_123ABC',
    ),
    false,
  )
})

function stripeRequest(requests, path) {
  return requests.find((request) => String(request.url).includes(path))
}

test('status reads Xano with a Bearer token and no client-supplied member id', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({ connected: true, charges_enabled: true, synced_at: 123 })
  }

  try {
    const status = await api.fetchStatus()
    assert.equal(status.charges_enabled, true)
    const statusRequest = stripeRequest(requests, '/stripe_connect/status/v3')
    assert.equal(
      statusRequest.url,
      'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/stripe_connect/status/v3',
    )
    assert.equal(statusRequest.options.method, 'POST')
    assert.match(
      statusRequest.options.headers.Authorization,
      /^Bearer .+/,
    )
    assert.deepEqual(JSON.parse(statusRequest.options.body), {})
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
  }
})

test('status reuses the shared dashboard Xano token without a local trade', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  const requests = []
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    return response({ connected: true, charges_enabled: true, synced_at: 123 })
  }
  api.__resetXanoToken()

  try {
    const status = await api.fetchStatus()
    assert.equal(status.charges_enabled, true)
    assert.equal(requests.length, 1)
    assert.equal(requests.some(({ url }) => String(url).includes('trade-token')), false)
    assert.equal(requests[0].options.headers.Authorization, 'Bearer shared-xano-token')
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})

test('ambiguous status responses render the authored fail-closed state', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  const statuses = [
    { mode: 'provider_unavailable' },
    { connected: 'false', charges_enabled: false },
    { connected: false, charges_enabled: true },
  ]
  global.getXanoAuthToken = async () => 'shared-xano-token'
  api.__resetXanoToken()

  try {
    for (const status of statuses) {
      const { root, states } = stripeRoot()
      const connect = new FakeElement()
      const history = new FakeElement('A')
      const earningsTiles = api.resolveEarningsTiles([connect, history])
      api.renderEarningsTiles(earningsTiles, 'ready')
      global.fetch = async () => response(status)

      await api.loadDashboardStatus([root], returnContext(), earningsTiles)

      assert.equal(states.error.style.display, '')
      assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
      assert.equal(connect.hidden, true)
      assert.equal(history.hidden, false)
      assert.equal(history.getAttribute('aria-disabled'), 'true')
    }
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})

test('Dashboard access and disconnect use authenticated V3 endpoints', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  const requests = []
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/dashboard/v3')) {
      return response({
        account_id: 'acct_123ABC',
        connected: true,
        mode: 'full',
        url: 'https://dashboard.stripe.com/b/acct_123ABC',
      })
    }
    return response({
      connected: false,
      provider_action: 'deauthorized',
      replayed: false,
    })
  }
  api.__resetXanoToken()

  try {
    const dashboard = await api.dashboardAccess('dashboard-attempt-123')
    const disconnected = await api.disconnectConnect('disconnect-attempt-123')
    assert.equal(dashboard.mode, 'full')
    assert.equal(disconnected.connected, false)

    const dashboardRequest = stripeRequest(
      requests,
      '/stripe_connect/dashboard/v3',
    )
    assert.deepEqual(JSON.parse(dashboardRequest.options.body), {
      idempotency_key: 'dashboard-attempt-123',
    })
    assert.equal(
      dashboardRequest.options.headers.Authorization,
      'Bearer shared-xano-token',
    )

    const disconnectRequest = stripeRequest(
      requests,
      '/stripe_connect/disconnect/v3',
    )
    assert.deepEqual(JSON.parse(disconnectRequest.options.body), {
      idempotency_key: 'disconnect-attempt-123',
    })
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})

test('Earnings opens the provider-verified connected Stripe account', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const { root } = stripeRoot()
  const earnings = new FakeElement('A')
  const destinations = []
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace: (value) => destinations.push(value) },
    opener: global,
  }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.open = () => stripeTab
  global.fetch = async () =>
    response({
      account_id: 'acct_123ABC',
      connected: true,
      mode: 'full',
      url: 'https://dashboard.stripe.com/b/acct_123ABC',
    })
  api.__resetXanoToken()

  try {
    assert.equal(
      await api.openDashboardInNewTab(
        api.createExclusiveRunner(),
        earnings,
        [root],
        'member-123',
      ),
      true,
    )
    assert.deepEqual(destinations, [
      'https://dashboard.stripe.com/b/acct_123ABC',
    ])
    assert.equal(stripeTab.opener, null)
    assert.equal(stripeTab.closed, false)
    assert.equal(earnings.getAttribute('aria-busy'), 'false')
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('Earnings rejects a generic or untrusted Stripe destination', async () => {
  const previous = {
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const { root, states } = stripeRoot()
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  }
  global.console = { ...console, error: () => {} }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.open = () => stripeTab
  global.fetch = async () =>
    response({
      account_id: 'acct_123ABC',
      connected: true,
      mode: 'full',
      url: 'https://dashboard.stripe.com/',
    })
  api.__resetXanoToken()

  try {
    assert.equal(
      await api.openDashboardInNewTab(
        api.createExclusiveRunner(),
        new FakeElement('A'),
        [root],
        'member-123',
      ),
      false,
    )
    assert.equal(stripeTab.closed, true)
    assert.equal(states.error.style.display, '')
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('Earnings rejects ambiguous modes and mismatched provider accounts', async () => {
  const previous = {
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const invalidResults = [
    {
      account_id: 'acct_123ABC',
      connected: true,
      url: 'https://dashboard.stripe.com/b/acct_123ABC',
    },
    {
      account_id: 'acct_123ABC',
      connected: true,
      mode: 'unknown',
      url: 'https://dashboard.stripe.com/b/acct_123ABC',
    },
    {
      connected: true,
      mode: 'full',
      url: 'https://dashboard.stripe.com/b/acct_123ABC',
    },
    {
      account_id: 'acct_123ABC',
      connected: true,
      mode: 'full',
      url: 'https://dashboard.stripe.com/b/acct_DIFFERENT',
    },
  ]
  const tabs = []
  const destinations = []
  global.console = { ...console, error: () => {} }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.open = () => {
    const tab = {
      closed: false,
      close() {
        this.closed = true
      },
      location: { replace: (value) => destinations.push(value) },
      opener: global,
    }
    tabs.push(tab)
    return tab
  }
  api.__resetXanoToken()

  try {
    for (const result of invalidResults) {
      const { root } = stripeRoot()
      const connect = new FakeElement()
      const history = new FakeElement('A')
      const earningsTiles = api.resolveEarningsTiles([connect, history])
      api.renderEarningsTiles(earningsTiles, 'ready')
      global.fetch = async () => response(result)

      assert.equal(
        await api.openDashboardInNewTab(
          api.createExclusiveRunner(),
          history,
          [root],
          'member-123',
          earningsTiles,
        ),
        false,
      )
      assert.equal(connect.hidden, true)
      assert.equal(history.hidden, false)
      assert.equal(history.getAttribute('aria-disabled'), 'true')
    }
    assert.equal(tabs.every((tab) => tab.closed), true)
    assert.deepEqual(destinations, [])
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('a blocked Earnings popup leaves one disabled recovery tile visible', async () => {
  const previous = { fetch: global.fetch, open: global.open }
  const { root } = stripeRoot()
  const connect = new FakeElement()
  const history = new FakeElement('A')
  const earningsTiles = api.resolveEarningsTiles([connect, history])
  let fetchCount = 0
  api.renderEarningsTiles(earningsTiles, 'ready')
  global.fetch = async () => {
    fetchCount += 1
    return response({})
  }
  global.open = () => null

  try {
    assert.equal(
      await api.openDashboardInNewTab(
        api.createExclusiveRunner(),
        history,
        [root],
        'member-123',
        earningsTiles,
      ),
      false,
    )
    assert.equal(fetchCount, 0)
    assert.equal(connect.hidden, true)
    assert.equal(history.hidden, false)
    assert.equal(history.getAttribute('aria-disabled'), 'true')
  } finally {
    global.fetch = previous.fetch
    global.open = previous.open
  }
})

test('staging query flags do not bypass authenticated Dashboard access', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const requests = []
  let fetchCount = 0
  let openCount = 0
  global.location = {
    hostname: 'the-starters-3-0.webflow.io',
    search: '?stripe_connect_sandbox=1',
  }
  global.getXanoAuthToken = async () => 'xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem_sb_member_123' } }),
  }
  global.fetch = async (url, options) => {
    fetchCount += 1
    requests.push({ url, options })
    return response({
      connected: true,
      account_id: 'acct_test123',
      mode: 'express',
      url: 'https://connect.stripe.com/express/acct_test123/login/test',
    })
  }
  global.open = () => {
    openCount += 1
    return { closed: false, location: { replace: () => {} } }
  }

  try {
    assert.equal(
      await api.openDashboardInNewTab(
        api.createExclusiveRunner(),
        new FakeElement('A'),
        [stripeRoot().root],
        'mem_sb_member_123',
        api.resolveEarningsTiles([]),
      ),
      true,
    )
    assert.equal(openCount, 1)
    assert.equal(fetchCount, 1)
    assert.ok(stripeRequest(requests, '/stripe_connect/dashboard/v3'))
  } finally {
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('server environment mismatches fail before Stripe or projection access', async () => {
  const previous = {
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const cases = [
    {
      memberId: 'member-live-123',
      origin: 'https://the-starters-3-0.webflow.io',
    },
    {
      memberId: 'mem_sb_test_123',
      origin: 'https://thestarters.com',
    },
  ]
  global.console = { ...console, error: () => {} }
  global.getXanoAuthToken = async () => 'xano-token'

  try {
    for (const fixture of cases) {
      const effects = {
        endpointCalls: 0,
        keySelections: 0,
        projectionReads: 0,
        stripeCalls: 0,
      }
      const stripeTab = {
        closed: false,
        close() {
          this.closed = true
        },
        location: { replace: () => {} },
      }
      const testMember = fixture.memberId.startsWith('mem_sb_')
      const testOrigin = fixture.origin === 'https://the-starters-3-0.webflow.io'
      global.location = {
        hostname: new URL(fixture.origin).hostname,
        origin: fixture.origin,
        search: '',
      }
      global.$memberstackDom = {
        getCurrentMember: async () => ({ data: { id: fixture.memberId } }),
      }
      global.open = () => stripeTab
      global.fetch = async () => {
        effects.endpointCalls += 1
        if (testMember !== testOrigin) {
          return response(
            { error: 'Stripe environment mismatch' },
            { ok: false, status: 403 },
          )
        }
        effects.keySelections += 1
        effects.projectionReads += 1
        effects.stripeCalls += 1
        return response({
          account_id: 'acct_environment123',
          connected: true,
          mode: 'full',
          url: 'https://dashboard.stripe.com/b/acct_environment123',
        })
      }
      const { root, states } = stripeRoot()

      assert.equal(
        await api.openDashboardInNewTab(
          api.createExclusiveRunner(),
          new FakeElement('A'),
          [root],
          fixture.memberId,
          api.resolveEarningsTiles([]),
        ),
        false,
      )
      assert.deepEqual(effects, {
        endpointCalls: 1,
        keySelections: 0,
        projectionReads: 0,
        stripeCalls: 0,
      })
      assert.equal(stripeTab.closed, true)
      assert.equal(states.error.style.display, '')
    }
  } finally {
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('ambiguous Dashboard retries preserve one idempotency key', async () => {
  const previous = {
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  global.console = { ...console, error: () => {} }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.location = { hostname: 'thestarters.com', search: '' }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.open = () => ({
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  })
  const failures = [new Error('network timeout'), 408, 409, 429, 500]

  try {
    for (const failure of failures) {
      const bodies = []
      let attempt = 0
      api.__resetXanoToken()
      api.__resetDashboardAttempt()
      global.fetch = async (_url, options) => {
        bodies.push(JSON.parse(options.body))
        attempt += 1
        if (attempt === 1) {
          if (failure instanceof Error) throw failure
          return response({ error: 'retry' }, { ok: false, status: failure })
        }
        return response({
          account_id: 'acct_123ABC',
          connected: true,
          mode: 'full',
          url: 'https://dashboard.stripe.com/b/acct_123ABC',
        })
      }
      const invoke = () =>
        api.openDashboardInNewTab(
          api.createExclusiveRunner(),
          new FakeElement('A'),
          [stripeRoot().root],
          'member-123',
          api.resolveEarningsTiles([]),
        )

      assert.equal(await invoke(), false)
      assert.equal(await invoke(), true)
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0].idempotency_key, bodies[1].idempotency_key)
    }
  } finally {
    api.__resetXanoToken()
    api.__resetDashboardAttempt()
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('a definitive Dashboard result clears its idempotency key', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const bodies = []
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.location = { hostname: 'thestarters.com', search: '' }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.open = () => ({
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  })
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body))
    return response({
      account_id: 'acct_123ABC',
      connected: true,
      mode: 'full',
      url: 'https://dashboard.stripe.com/b/acct_123ABC',
    })
  }
  api.__resetXanoToken()
  api.__resetDashboardAttempt()

  try {
    const invoke = () =>
      api.openDashboardInNewTab(
        api.createExclusiveRunner(),
        new FakeElement('A'),
        [stripeRoot().root],
        'member-123',
        api.resolveEarningsTiles([]),
      )
    assert.equal(await invoke(), true)
    assert.equal(await invoke(), true)
    assert.notEqual(bodies[0].idempotency_key, bodies[1].idempotency_key)
  } finally {
    api.__resetXanoToken()
    api.__resetDashboardAttempt()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('Earnings self-heals when Stripe was disconnected after status loaded', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const { root } = stripeRoot()
  const connect = new FakeElement()
  const history = new FakeElement('A')
  const earningsTiles = api.resolveEarningsTiles([connect, history])
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  }
  let calls = 0
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.open = () => stripeTab
  global.fetch = async (url) => {
    calls += 1
    if (String(url).includes('/dashboard/v3')) {
      return response({ connected: false, mode: 'disconnected' })
    }
    return response({ connected: false, charges_enabled: false })
  }
  api.__resetXanoToken()

  try {
    assert.equal(
      await api.openDashboardInNewTab(
        api.createExclusiveRunner(),
        history,
        [root],
        'member-123',
        earningsTiles,
      ),
      false,
    )
    assert.equal(calls, 2)
    assert.equal(stripeTab.closed, true)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'disconnected')
    assert.equal(connect.hidden, true)
    assert.equal(history.hidden, false)
    assert.equal(
      history.getAttribute('data-stripe-connect-hero-action'),
      'start',
    )
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('disconnect requires confirmation and refreshes to disconnected state', async () => {
  const previous = {
    confirm: global.confirm,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
  }
  const { root } = stripeRoot()
  const connect = new FakeElement()
  const history = new FakeElement()
  const earningsTiles = api.resolveEarningsTiles([connect, history])
  let calls = 0
  global.confirm = () => true
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.fetch = async (url) => {
    calls += 1
    if (String(url).includes('/disconnect/v3')) {
      return response({
        connected: false,
        provider_action: 'deauthorized',
        replayed: false,
      })
    }
    return response({ connected: false, charges_enabled: false })
  }
  api.__resetXanoToken()

  try {
    assert.equal(
      await api.handleDisconnect(
        api.createExclusiveRunner(),
        new FakeElement('BUTTON'),
        [root],
        earningsTiles,
        'member-123',
      ),
      true,
    )
    assert.equal(calls, 2)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'disconnected')
    assert.equal(connect.hidden, true)
    assert.equal(history.hidden, false)
    assert.equal(
      history.getAttribute('data-stripe-connect-hero-action'),
      'start',
    )

    global.confirm = () => false
    assert.equal(
      await api.handleDisconnect(
        api.createExclusiveRunner(),
        new FakeElement('BUTTON'),
        [root],
        earningsTiles,
        'member-123',
      ),
      false,
    )
    assert.equal(calls, 2)
  } finally {
    api.__resetXanoToken()
    global.confirm = previous.confirm
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
  }
})

test('disconnect rejects a changed member before calling the provider endpoint', async () => {
  const previous = {
    confirm: global.confirm,
    console: global.console,
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  let fetchCount = 0
  global.confirm = () => true
  global.console = { ...console, error: () => {} }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-after-switch' } }),
  }
  global.fetch = async () => {
    fetchCount += 1
    return response({ connected: false })
  }
  api.__resetDisconnectAttempt()

  try {
    assert.equal(
      await api.handleDisconnect(
        api.createExclusiveRunner(),
        new FakeElement('BUTTON'),
        [stripeRoot().root],
        api.resolveEarningsTiles([]),
        'member-at-boot',
      ),
      false,
    )
    assert.equal(fetchCount, 0)
  } finally {
    api.__resetDisconnectAttempt()
    global.confirm = previous.confirm
    global.console = previous.console
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
  }
})

test('staging query flags do not bypass confirmed disconnect', async () => {
  const previous = {
    confirm: global.confirm,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  let confirmCount = 0
  let fetchCount = 0
  global.location = {
    hostname: 'the-starters-3-0.webflow.io',
    search: '?stripe_connect_sandbox=1',
  }
  global.confirm = () => {
    confirmCount += 1
    return true
  }
  global.getXanoAuthToken = async () => 'xano-token'
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem_sb_member_123' } }),
  }
  global.fetch = async (url, options) => {
    fetchCount += 1
    requests.push({ url, options })
    return response({ connected: false })
  }

  try {
    assert.equal(
      await api.handleDisconnect(
        api.createExclusiveRunner(),
        new FakeElement('BUTTON'),
        [stripeRoot().root],
        api.resolveEarningsTiles([]),
        'mem_sb_member_123',
      ),
      true,
    )
    assert.equal(confirmCount, 1)
    assert.equal(fetchCount, 2)
    assert.ok(stripeRequest(requests, '/stripe_connect/disconnect/v3'))
    assert.ok(stripeRequest(requests, '/stripe_connect/status/v3'))
  } finally {
    global.confirm = previous.confirm
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('ambiguous disconnect retries preserve one idempotency key', async () => {
  const previous = {
    confirm: global.confirm,
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  global.confirm = () => true
  global.console = { ...console, error: () => {} }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.location = { hostname: 'thestarters.com', search: '' }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  const failures = [new Error('network timeout'), 408, 409, 429, 500]

  try {
    for (const failure of failures) {
      const bodies = []
      let attempt = 0
      api.__resetXanoToken()
      api.__resetDisconnectAttempt()
      global.fetch = async (url, options) => {
        if (String(url).includes('/disconnect/v3')) {
          bodies.push(JSON.parse(options.body))
          attempt += 1
          if (attempt === 1) {
            if (failure instanceof Error) throw failure
            return response({ error: 'retry' }, { ok: false, status: failure })
          }
          return response({ connected: false, provider_action: 'deauthorized' })
        }
        return response({ connected: false, charges_enabled: false })
      }
      const invoke = () =>
        api.handleDisconnect(
          api.createExclusiveRunner(),
          new FakeElement('BUTTON'),
          [stripeRoot().root],
          api.resolveEarningsTiles([]),
          'member-123',
        )

      assert.equal(await invoke(), false)
      assert.equal(await invoke(), true)
      assert.equal(bodies.length, 2)
      assert.equal(bodies[0].idempotency_key, bodies[1].idempotency_key)
    }
  } finally {
    api.__resetXanoToken()
    api.__resetDisconnectAttempt()
    global.confirm = previous.confirm
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('a non-retryable disconnect response clears its idempotency key', async () => {
  const previous = {
    confirm: global.confirm,
    console: global.console,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const bodies = []
  let attempt = 0
  global.confirm = () => true
  global.console = { ...console, error: () => {} }
  global.getXanoAuthToken = async () => 'shared-xano-token'
  global.location = { hostname: 'thestarters.com', search: '' }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
  }
  global.fetch = async (url, options) => {
    if (String(url).includes('/disconnect/v3')) {
      bodies.push(JSON.parse(options.body))
      attempt += 1
      if (attempt === 1) {
        return response({ error: 'invalid request' }, { ok: false, status: 422 })
      }
      return response({ connected: false, provider_action: 'deauthorized' })
    }
    return response({ connected: false, charges_enabled: false })
  }
  api.__resetXanoToken()
  api.__resetDisconnectAttempt()

  try {
    const invoke = () =>
      api.handleDisconnect(
        api.createExclusiveRunner(),
        new FakeElement('BUTTON'),
        [stripeRoot().root],
        api.resolveEarningsTiles([]),
        'member-123',
      )
    assert.equal(await invoke(), false)
    assert.equal(await invoke(), true)
    assert.notEqual(bodies[0].idempotency_key, bodies[1].idempotency_key)
  } finally {
    api.__resetXanoToken()
    api.__resetDisconnectAttempt()
    global.confirm = previous.confirm
    global.console = previous.console
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('a shared stale Xano token is force-refreshed after a 401', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
  }
  const tokenOptions = []
  const authorizations = []
  let statusAttempts = 0
  global.getXanoAuthToken = async (options) => {
    tokenOptions.push(options)
    return options && options.forceRefresh ? 'shared-fresh-token' : 'shared-stale-token'
  }
  global.fetch = async (url, options) => {
    authorizations.push(options.headers.Authorization)
    statusAttempts += 1
    if (statusAttempts === 1) {
      return response({ error: 'expired token' }, { ok: false, status: 401 })
    }
    return response({ connected: true, charges_enabled: true })
  }
  api.__resetXanoToken()

  try {
    const status = await api.fetchStatus()
    assert.equal(status.charges_enabled, true)
    assert.deepEqual(tokenOptions, [undefined, { forceRefresh: true }])
    assert.deepEqual(authorizations, [
      'Bearer shared-stale-token',
      'Bearer shared-fresh-token',
    ])
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
  }
})

test('a silent member switch blocks the authenticated 401 retry', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
  }
  let fetchReads = 0
  let liveMemberId = 'member-a'
  let liveReads = 0
  const tokenOptions = []
  global.$memberstackDom = {
    getCurrentMember: async () => {
      liveReads += 1
      return { data: { id: liveMemberId } }
    },
    onAuthChange() {
      return { unsubscribe() {} }
    },
  }
  global.getXanoAuthToken = async (options) => {
    tokenOptions.push(options)
    return options && options.forceRefresh
      ? 'member-b-xano-token'
      : 'member-a-xano-token'
  }
  global.fetch = async () => {
    fetchReads += 1
    liveMemberId = 'member-b'
    return response({ error: 'expired token' }, { ok: false, status: 401 })
  }
  api.__resetXanoToken()
  const authScope = api.armConflictAuthScope('member-a')

  try {
    assert.ok(authScope)
    await assert.rejects(
      () =>
        api.startConnect(
          'https://thestarters.com/starter-dashboard',
          'connect-start-member-a',
          authScope,
        ),
      (error) => {
        assert.equal(error.code, 'member_scope_changed')
        return true
      },
    )
    assert.equal(fetchReads, 1)
    assert.equal(liveReads, 3)
    assert.deepEqual(tokenOptions, [undefined])
  } finally {
    authScope.release()
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
  }
})

test('an auth event at the async member-check boundary blocks the request', async () => {
  const previous = {
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    memberstack: global.$memberstackDom,
  }
  let authChangeListener
  let fetchReads = 0
  let tokenReads = 0
  global.$memberstackDom = {
    getCurrentMember() {
      return {
        then(resolve) {
          resolve({ data: { id: 'member-a' } })
          queueMicrotask(() => {
            queueMicrotask(() => authChangeListener({ id: 'member-a' }))
          })
        },
      }
    },
    onAuthChange(listener) {
      authChangeListener = listener
      return { unsubscribe() {} }
    },
  }
  global.getXanoAuthToken = async () => {
    tokenReads += 1
    return 'member-a-xano-token'
  }
  global.fetch = async () => {
    fetchReads += 1
    return response({ connected: false, charges_enabled: false })
  }
  api.__resetXanoToken()
  const authScope = api.armConflictAuthScope('member-a')

  try {
    assert.ok(authScope)
    await assert.rejects(
      () => api.fetchStatus(false, authScope),
      (error) => {
        assert.equal(error.code, 'member_scope_changed')
        return true
      },
    )
    assert.equal(tokenReads, 0)
    assert.equal(fetchReads, 0)
  } finally {
    authScope.release()
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.$memberstackDom = previous.memberstack
  }
})

test('initial identity reuses memberReady while live checks read Memberstack', async () => {
  const previous = {
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
  }
  let liveReads = 0
  global.memberReady = Promise.resolve({ id: 'member-at-boot' })
  global.$memberstackDom = {
    getCurrentMember: async () => {
      liveReads += 1
      return { data: { id: 'member-after-switch' } }
    },
  }

  try {
    assert.equal(await api.initialMemberId(), 'member-at-boot')
    assert.equal(liveReads, 0)
    assert.equal(await api.currentMemberId(), 'member-after-switch')
    assert.equal(liveReads, 1)
  } finally {
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
  }
})

test('start sends the dashboard return URL and accepts Stripe URLs only', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }

  try {
    const result = await api.startConnect(
      'https://thestarters.com/starter-dashboard',
      'connect-attempt-123',
    )
    assert.equal(result.mode, 'oauth')
    const startRequest = stripeRequest(requests, '/stripe_connect/start/v3')
    assert.match(startRequest.options.headers.Authorization, /^Bearer .+/)
    assert.deepEqual(JSON.parse(startRequest.options.body), {
      return_url: 'https://thestarters.com/starter-dashboard',
      callback_url: 'https://thestarters.com/stripe-connect-callback',
      idempotency_key: 'connect-attempt-123',
    })
    assert.equal(api.isStripeUrl(result.url), true)
    assert.equal(api.isStripeUrl('https://evil.example/stripe'), false)
    assert.equal(api.isStripeUrl('javascript:alert(1)'), false)
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
  }
})

test('Connect attempt keys are non-empty and bounded', () => {
  const key = api.createAttemptKey('connect-start')
  assert.match(key, /^connect-start-/)
  assert.ok(key.length <= 128)
})

test('network-ambiguous Connect start retries reuse the same attempt key', async () => {
  const previous = {
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { root } = stripeRoot()
  const button = new FakeElement('BUTTON')
  const connectTile = new FakeElement()
  const startBodies = []
  let startCalls = 0
  api.__resetXanoToken()
  api.__resetConnectStartAttempt()
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url, options) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    startBodies.push(JSON.parse(options.body))
    startCalls += 1
    if (startCalls === 1) throw new Error('network failed after request')
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }
  const createStripeTab = () => ({
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
  })

  try {
    assert.equal(
      await api.handleStart(
        button,
        connectTile,
        [root],
        'member-123',
        createStripeTab(),
      ),
      false,
    )
    assert.equal(
      await api.handleStart(
        button,
        connectTile,
        [root],
        'member-123',
        createStripeTab(),
      ),
      true,
    )
    assert.equal(startBodies.length, 2)
    assert.equal(startBodies[0].idempotency_key, startBodies[1].idempotency_key)
  } finally {
    api.__resetXanoToken()
    api.__resetConnectStartAttempt()
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('Connect start accepts terminal replay modes without requiring a URL', async () => {
  const previous = {
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { root } = stripeRoot()
  const button = new FakeElement('BUTTON')
  const connectTile = new FakeElement()
  api.__resetXanoToken()
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
    getMemberCookie: async () => 'ms-cookie',
  }

  try {
    for (const mode of ['connected', 'reconciliation_required']) {
      api.__resetConnectStartAttempt()
      global.fetch = async (url) => {
        if (String(url).includes('/auth/trade-token/v3')) {
          return response({ authToken: 'xano-token' })
        }
        return response({ mode, replayed: true })
      }
      const stripeTab = {
        closed: false,
        close() {
          this.closed = true
        },
        location: { replace() {} },
      }

      assert.equal(
        await api.handleStart(
          button,
          connectTile,
          [root],
          'member-123',
          stripeTab,
        ),
        mode,
      )
      assert.equal(stripeTab.closed, true)
      assert.notEqual(root.getAttribute('data-stripe-connect-status'), 'error')
    }
  } finally {
    api.__resetXanoToken()
    api.__resetConnectStartAttempt()
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('reconciliation replay stays fail closed while canonically disconnected', async () => {
  const previous = {
    BroadcastChannel: global.BroadcastChannel,
    addEventListener: global.addEventListener,
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
    removeEventListener: global.removeEventListener,
    setTimeout: global.setTimeout,
  }
  const { errorCopy, root, states } = stripeRoot()
  const button = new FakeElement('BUTTON')
  const title = new FakeElement()
  const description = new FakeElement()
  button.children.set('.dash-hero_button-title', title)
  button.children.set('.dash-hero_button-description', description)
  const earningsTiles = api.resolveEarningsTiles([button])
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  }
  let statusReads = 0
  global.BroadcastChannel = undefined
  global.addEventListener = undefined
  global.removeEventListener = undefined
  global.location = {
    href: 'https://thestarters.com/starter-dashboard',
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.open = () => stripeTab
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    if (String(url).includes('/stripe_connect/start/v3')) {
      return response({ mode: 'reconciliation_required', replayed: true })
    }
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response(
        statusReads === 1
          ? { connected: true, charges_enabled: false }
          : { connected: false, charges_enabled: false },
      )
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()
  api.__resetConnectStartAttempt()

  try {
    assert.deepEqual(
      await api.loadDashboardStatus(
        [root],
        returnContext(),
        earningsTiles,
      ),
      { connected: true, charges_enabled: false },
    )
    assert.equal(root.hidden, true)
    assert.equal(button.hidden, false)
    assert.equal(
      button.getAttribute('data-stripe-connect-hero-action'),
      'start',
    )

    assert.equal(
      await api.startInNewTab(
        api.createExclusiveRunner(),
        button,
        button,
        [root],
        'member-123',
        earningsTiles,
      ),
      false,
    )
    assert.equal(statusReads, 6)
    assert.equal(stripeTab.closed, true)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(root.hidden, false)
    assert.equal(root.style.display, '')
    assert.equal(states.error.style.display, '')
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
    assert.equal(errorCopy.button.textContent, 'Try Again')
    assert.equal(button.hidden, false)
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    assert.equal(title.textContent, 'Stripe Unavailable')
    assert.equal(description.textContent, 'Use Try Again above')
  } finally {
    api.__resetXanoToken()
    api.__resetConnectStartAttempt()
    global.BroadcastChannel = previous.BroadcastChannel
    global.addEventListener = previous.addEventListener
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
    global.removeEventListener = previous.removeEventListener
    global.setTimeout = previous.setTimeout
  }
})

test('Connect retry policy keeps only ambiguous start outcomes on the same key', () => {
  assert.equal(api.shouldRetainConnectStartKey(new Error('network')), true)
  assert.equal(api.shouldRetainConnectStartKey({ status: 408 }), true)
  assert.equal(api.shouldRetainConnectStartKey({ status: 429 }), true)
  assert.equal(api.shouldRetainConnectStartKey({ status: 500 }), true)
  assert.equal(api.shouldRetainConnectStartKey({ status: 400 }), false)
  assert.equal(api.shouldRetainConnectStartKey({ status: 422 }), false)
})

test('opaque production OAuth state accepts only the backend length contract', () => {
  assert.equal(api.validOpaqueState('opaque-state-1234'), true)
  assert.equal(api.validOpaqueState('short'), false)
  assert.equal(api.validOpaqueState('x'.repeat(128)), true)
  assert.equal(api.validOpaqueState('x'.repeat(129)), false)
})

test('Connect exchange modes are explicit and fail closed', () => {
  assert.equal(
    api.resolveExchangeMode({ connected: true, mode: 'completed' }),
    'completed',
  )
  assert.equal(
    api.resolveExchangeMode({ connected: false, mode: 'reconciliation_required' }),
    'reconciliation_required',
  )
  assert.equal(
    api.resolveExchangeMode({ connected: false, mode: 'restart_required' }),
    'restart_required',
  )
  assert.throws(
    () => api.resolveExchangeMode({ connected: false, mode: 'completed' }),
    /did not connect/,
  )
  assert.throws(
    () => api.resolveExchangeMode({ connected: false, mode: 'unknown' }),
    /unknown mode/,
  )
})

test('Connect Stripe reserves and navigates a new tab without leaving the dashboard', async () => {
  const previous = {
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const { root } = stripeRoot()
  const connect = new FakeElement()
  const openCalls = []
  const destinations = []
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace: (value) => destinations.push(value) },
    opener: global,
  }
  let fetchCount = 0
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.open = (...args) => {
    openCalls.push(args)
    return stripeTab
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url) => {
    fetchCount += 1
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }
  api.__resetXanoToken()

  try {
    const resultPromise = api.startInNewTab(
      api.createExclusiveRunner(),
      connect,
      connect,
      [root],
      'member-123',
    )

    assert.deepEqual(openCalls, [['about:blank', '_blank']])
    assert.equal(fetchCount, 0, 'the tab is reserved in the click task')
    assert.equal(await resultPromise, true)
    assert.equal(stripeTab.opener, null)
    assert.equal(stripeTab.closed, false)
    assert.deepEqual(destinations, [
      'https://connect.stripe.com/oauth/authorize?client_id=test',
    ])
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('a failed Connect Stripe request closes the reserved tab and restores recovery UI', async () => {
  const previous = {
    console: global.console,
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const { root, states } = stripeRoot()
  const connect = new FakeElement()
  const title = new FakeElement()
  const description = new FakeElement()
  connect.children.set('.dash-hero_button-title', title)
  connect.children.set('.dash-hero_button-description', description)
  const earningsTiles = api.resolveEarningsTiles([connect])
  api.renderEarningsTiles(earningsTiles, 'disconnected')
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  }
  global.console = { ...console, error: () => {} }
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.open = () => stripeTab
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({ error: 'invalid account' }, { ok: false, status: 500 })
  }
  api.__resetXanoToken()

  try {
    assert.equal(
      await api.startInNewTab(
        api.createExclusiveRunner(),
        connect,
        connect,
        [root],
        'member-123',
        earningsTiles,
      ),
      false,
    )
    assert.equal(stripeTab.closed, true)
    assert.equal(connect.getAttribute('aria-busy'), 'false')
    assert.equal(connect.getAttribute('aria-disabled'), 'true')
    assert.equal(connect.getAttribute('tabindex'), '-1')
    assert.equal(connect.getAttribute('data-stripe-connect-hero-action'), 'none')
    assert.equal(title.textContent, 'Stripe Unavailable')
    assert.equal(description.textContent, 'Use Try Again above')
    assert.equal(states.error.style.display, '')
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('a blocked popup fails closed before making a Stripe Connect request', async () => {
  const previous = { fetch: global.fetch, open: global.open }
  const { root, states } = stripeRoot()
  const connect = new FakeElement()
  const title = new FakeElement()
  const description = new FakeElement()
  connect.children.set('.dash-hero_button-title', title)
  connect.children.set('.dash-hero_button-description', description)
  const earningsTiles = api.resolveEarningsTiles([connect])
  api.renderEarningsTiles(earningsTiles, 'disconnected')
  let fetchCount = 0
  global.fetch = async () => {
    fetchCount += 1
    return response({})
  }
  global.open = () => null

  try {
    assert.equal(
      await api.startInNewTab(
        api.createExclusiveRunner(),
        connect,
        connect,
        [root],
        'member-123',
        earningsTiles,
      ),
      false,
    )
    assert.equal(fetchCount, 0)
    assert.equal(states.error.style.display, '')
    assert.equal(connect.hidden, false)
    assert.equal(connect.getAttribute('aria-disabled'), 'true')
    assert.equal(connect.getAttribute('tabindex'), '-1')
    assert.equal(connect.getAttribute('data-stripe-connect-hero-action'), 'none')
    assert.equal(title.textContent, 'Stripe Unavailable')
    assert.equal(description.textContent, 'Use Try Again above')
  } finally {
    global.fetch = previous.fetch
    global.open = previous.open
  }
})

test('duplicate Connect Stripe activation does not reserve or render another popup', async () => {
  const previous = {
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
  }
  const { root, states } = stripeRoot()
  const connect = new FakeElement()
  const runner = api.createExclusiveRunner()
  let resolveMember
  let openCount = 0
  const member = new Promise((resolve) => {
    resolveMember = resolve
  })
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.open = () => {
    openCount += 1
    return {
      closed: false,
      close() {},
      location: { replace() {} },
      opener: global,
    }
  }
  global.$memberstackDom = {
    getCurrentMember: async () => member,
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }
  api.setView(root, 'disconnected')
  api.__resetXanoToken()

  try {
    const first = api.startInNewTab(
      runner,
      connect,
      connect,
      [root],
      'member-123',
    )
    const duplicate = api.startInNewTab(
      runner,
      new FakeElement(),
      connect,
      [root],
      'member-123',
    )

    assert.equal(await duplicate, null)
    assert.equal(openCount, 1)
    assert.equal(states.error.style.display, 'none')
    resolveMember({ data: { id: 'member-123' } })
    assert.equal(await first, true)
  } finally {
    api.__resetXanoToken()
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
  }
})

test('early returning focus waits for start before releasing Stripe retry', async () => {
  const previous = {
    addEventListener: global.addEventListener,
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
    removeEventListener: global.removeEventListener,
    setTimeout: global.setTimeout,
  }
  const { root } = stripeRoot()
  const connect = new FakeElement()
  const earnings = new FakeElement()
  const runner = api.createExclusiveRunner()
  const listeners = new Map()
  let resolveMember
  let openCount = 0
  let statusCount = 0
  const member = new Promise((resolve) => {
    resolveMember = resolve
  })
  global.addEventListener = (name, listener) => listeners.set(name, listener)
  global.removeEventListener = (name, listener) => {
    if (listeners.get(name) === listener) listeners.delete(name)
  }
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.open = () => {
    openCount += 1
    return {
      closed: false,
      close() {},
      location: { replace() {} },
      opener: global,
    }
  }
  global.$memberstackDom = {
    getCurrentMember: async () => member,
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusCount += 1
      return response({ connected: false, charges_enabled: false })
    }
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }
  const tiles = api.resolveEarningsTiles([connect, earnings])
  api.__resetXanoToken()

  try {
    const firstStart = api.startInNewTab(
      runner,
      connect,
      connect,
      [root],
      'member-123',
      tiles,
    )
    assert.equal(connect.getAttribute('aria-busy'), 'true')
    const recovery = listeners.get('focus')()
    assert.equal(statusCount, 0)
    assert.equal(
      await api.startInNewTab(
        runner,
        connect,
        connect,
        [root],
        'member-123',
        tiles,
      ),
      null,
    )
    assert.equal(openCount, 1)

    resolveMember({ data: { id: 'member-123' } })
    assert.equal(await firstStart, true)
    await recovery

    assert.equal(statusCount, 5)
    assert.equal(connect.getAttribute('aria-busy'), 'false')
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'disconnected')
    assert.equal(
      await api.startInNewTab(
        runner,
        connect,
        connect,
        [root],
        'member-123',
        tiles,
      ),
      true,
    )
    assert.equal(openCount, 2)
    await listeners.get('focus')()
  } finally {
    api.__resetXanoToken()
    global.addEventListener = previous.addEventListener
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
    global.removeEventListener = previous.removeEventListener
    global.setTimeout = previous.setTimeout
  }
})

test('verified callback signal renders review on the original dashboard', async () => {
  const previous = {
    BroadcastChannel: global.BroadcastChannel,
    addEventListener: global.addEventListener,
    clearInterval: global.clearInterval,
    document: global.document,
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
    removeEventListener: global.removeEventListener,
    setInterval: global.setInterval,
    setTimeout: global.setTimeout,
  }
  const { root } = stripeRoot()
  const connect = new FakeElement()
  const earnings = new FakeElement()
  const runner = api.createExclusiveRunner()
  const channels = []
  let delivery = Promise.resolve()
  let statusCount = 0
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name
      this.onmessage = null
      channels.push(this)
    }

    postMessage(data) {
      delivery = Promise.all(
        channels
          .filter((channel) => channel !== this && channel.name === this.name)
          .map((channel) =>
            channel.onmessage ? channel.onmessage({ data }) : null,
          ),
      )
    }

    close() {
      const index = channels.indexOf(this)
      if (index >= 0) channels.splice(index, 1)
    }
  }
  global.BroadcastChannel = FakeBroadcastChannel
  global.addEventListener = () => {}
  global.removeEventListener = () => {}
  global.setInterval = () => 42
  global.clearInterval = () => {}
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.document = {}
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.open = () => ({
    closed: false,
    close() {},
    location: { replace() {} },
    opener: global,
  })
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusCount += 1
      return response({ connected: true, charges_enabled: false })
    }
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }
  const tiles = api.resolveEarningsTiles([connect, earnings])
  api.__resetXanoToken()

  try {
    assert.equal(
      await api.startInNewTab(
        runner,
        connect,
        connect,
        [root],
        'member-123',
        tiles,
      ),
      true,
    )

    assert.equal(api.signalStripeReturn('member-123'), true)
    await delivery

    assert.equal(statusCount, 5)
    assert.equal(connect.getAttribute('aria-busy'), 'false')
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'review')
  } finally {
    api.__resetXanoToken()
    global.BroadcastChannel = previous.BroadcastChannel
    global.addEventListener = previous.addEventListener
    global.clearInterval = previous.clearInterval
    global.document = previous.document
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
    global.removeEventListener = previous.removeEventListener
    global.setInterval = previous.setInterval
    global.setTimeout = previous.setTimeout
  }
})

test('closing a background Stripe tab releases recovery without focus', async () => {
  const previous = {
    addEventListener: global.addEventListener,
    clearInterval: global.clearInterval,
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
    open: global.open,
    removeEventListener: global.removeEventListener,
    setInterval: global.setInterval,
    setTimeout: global.setTimeout,
  }
  const { root } = stripeRoot()
  const connect = new FakeElement()
  const earnings = new FakeElement()
  const runner = api.createExclusiveRunner()
  const listeners = new Map()
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: { replace() {} },
    opener: global,
  }
  let closedTimer
  let clearedTimer = false
  let statusCount = 0
  global.addEventListener = (name, listener) => listeners.set(name, listener)
  global.removeEventListener = (name, listener) => {
    if (listeners.get(name) === listener) listeners.delete(name)
  }
  global.setInterval = (callback) => {
    closedTimer = callback
    return 42
  }
  global.clearInterval = (timer) => {
    if (timer === 42) clearedTimer = true
  }
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.location = {
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.open = () => stripeTab
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
    getMemberCookie: async () => 'ms-cookie',
  }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusCount += 1
      return response({ connected: false, charges_enabled: false })
    }
    return response({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }
  const tiles = api.resolveEarningsTiles([connect, earnings])
  api.__resetXanoToken()

  try {
    assert.equal(
      await api.startInNewTab(
        runner,
        connect,
        connect,
        [root],
        'member-123',
        tiles,
      ),
      true,
    )
    assert.equal(connect.getAttribute('aria-busy'), 'true')

    stripeTab.closed = true
    await closedTimer()

    assert.equal(clearedTimer, true)
    assert.equal(listeners.has('focus'), false)
    assert.equal(statusCount, 5)
    assert.equal(connect.getAttribute('aria-busy'), 'false')
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'disconnected')
    assert.equal(await runner(() => 'retry'), 'retry')
  } finally {
    api.__resetXanoToken()
    global.addEventListener = previous.addEventListener
    global.clearInterval = previous.clearInterval
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
    global.removeEventListener = previous.removeEventListener
    global.setInterval = previous.setInterval
    global.setTimeout = previous.setTimeout
  }
})

test('staging uses the normal persistent Connect endpoint with an explicit callback', async () => {
  const previous = {
    fetch: global.fetch,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  global.location = {
    hostname: 'the-starters-3-0.webflow.io',
    origin: 'https://the-starters-3-0.webflow.io',
    search: '?stripe_connect_sandbox=1',
  }
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      mode: 'oauth',
      sandbox: true,
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })
  }

  try {
    await api.startConnect(
      'https://the-starters-3-0.webflow.io/starter-dashboard',
      'staging-connect-attempt',
    )
    const startRequest = stripeRequest(
      requests,
      '/stripe_connect/start/v3',
    )
    assert.match(startRequest.options.headers.Authorization, /^Bearer .+/)
    assert.deepEqual(JSON.parse(startRequest.options.body), {
      return_url: 'https://the-starters-3-0.webflow.io/starter-dashboard',
      callback_url:
        'https://the-starters-3-0.webflow.io/stripe-connect-callback',
      idempotency_key: 'staging-connect-attempt',
    })
  } finally {
    global.fetch = previous.fetch
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('a stale Xano token triggers one re-trade and retry on 401', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  const requests = []
  let trades = 0
  let statusAttempts = 0
  api.__resetXanoToken()
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      trades += 1
      return response({ authToken: 'xano-token-' + trades })
    }
    statusAttempts += 1
    if (statusAttempts === 1) {
      return response({ error: 'expired token' }, { ok: false, status: 401 })
    }
    return response({ connected: true, charges_enabled: true })
  }

  try {
    const status = await api.fetchStatus()
    assert.equal(status.charges_enabled, true)
    assert.equal(statusAttempts, 2, 'the request is retried exactly once')
    assert.equal(trades, 2, 'a fresh token is traded after the 401')
    const statusRequests = requests.filter((request) =>
      String(request.url).includes('/stripe_connect/status/v3'),
    )
    assert.equal(
      statusRequests[0].options.headers.Authorization,
      'Bearer xano-token-1',
    )
    assert.equal(
      statusRequests[1].options.headers.Authorization,
      'Bearer xano-token-2',
      'the retry uses the freshly traded token',
    )
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
    api.__resetXanoToken()
  }
})

test('a persistent 401 rejects without retrying forever', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  let statusAttempts = 0
  api.__resetXanoToken()
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    statusAttempts += 1
    return response({ error: 'expired token' }, { ok: false, status: 401 })
  }

  try {
    await assert.rejects(
      () => api.fetchStatus(),
      /status\/v3 failed \(401\)/,
    )
    assert.equal(statusAttempts, 2, 'retried once, then gives up')
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
    api.__resetXanoToken()
  }
})

test('OAuth exchange 401 never replays a one-time code', async () => {
  const previous = {
    fetch: global.fetch,
    memberstack: global.$memberstackDom,
  }
  global.$memberstackDom = { getMemberCookie: async () => 'ms-cookie' }

  try {
    const requests = []
    let trades = 0
    api.__resetXanoToken()
    global.fetch = async (url, options) => {
      if (String(url).includes('/auth/trade-token/v3')) {
        trades += 1
        return response({ authToken: 'xano-token-' + trades })
      }
      requests.push({ url, options })
      return response({ error: 'expired token' }, { ok: false, status: 401 })
    }

    await assert.rejects(
      () => api.exchangeCode('one-time-code', 'opaque-state-1234567890'),
      /oauth_exchange\/v3 failed \(401\)/,
    )

    assert.equal(requests.length, 1, 'the authorization code is sent once')
    assert.equal(trades, 1, 'the exchange does not refresh authentication')
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      code: 'one-time-code',
      state: 'opaque-state-1234567890',
    })
    assert.equal(
      new URL(requests[0].url).pathname.endsWith(api.EXCHANGE_PATH),
      true,
    )
  } finally {
    global.fetch = previous.fetch
    global.$memberstackDom = previous.memberstack
    api.__resetXanoToken()
  }
})

test('callback forwards opaque OAuth state and exchanges for the live member session', async () => {
  const previous = {
    BroadcastChannel: global.BroadcastChannel,
    document: global.document,
    fetch: global.fetch,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { root, states } = stripeRoot()
  const requests = []
  const historyCalls = []
  const assigned = []
  const returnMessages = []

  global.BroadcastChannel = class {
    postMessage(message) {
      returnMessages.push(message)
    }

    close() {}
  }

  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = {
    replaceState: (...args) => historyCalls.push(args),
  }
  global.location = {
    href:
      'https://thestarters.com/stripe-connect-callback?' +
      'code=code-123&state=opaque-state-1234567890',
    origin: 'https://thestarters.com',
    assign: (url) => assigned.push(url),
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
    getMemberCookie: async () => 'ms-cookie',
    onAuthChange: () => ({ unsubscribe() {} }),
  }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      connected: true,
      mode: 'completed',
      charges_enabled: false,
    })
  }

  try {
    const result = await api.mountCallback()
    assert.equal(result.connected, true)
    const exchangeRequest = stripeRequest(
      requests,
      '/stripe_connect/oauth_exchange/v3',
    )
    assert.match(exchangeRequest.options.headers.Authorization, /^Bearer .+/)
    assert.deepEqual(JSON.parse(exchangeRequest.options.body), {
      code: 'code-123',
      state: 'opaque-state-1234567890',
    })
    assert.equal(historyCalls.length, 1)
    assert.equal(
      historyCalls[0][2],
      '/stripe-connect-callback',
      'code and state are removed before the exchange',
    )
    assert.deepEqual(assigned, [
      'https://thestarters.com/starter-dashboard?stripe_connect=connected',
    ])
    assert.deepEqual(returnMessages, [
      { memberId: 'mem-live', type: 'connected' },
    ])
    assert.equal(states.error.style.display, 'none')
  } finally {
    global.BroadcastChannel = previous.BroadcastChannel
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})

test('callback refuses an invalid opaque state without exchanging', async () => {
  const previous = {
    console: global.console,
    document: global.document,
    fetch: global.fetch,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root, states } = stripeRoot()
  let fetchCount = 0

  global.console = { ...console, error: () => {} }
  global.sessionStorage = storage
  api.storeReturnReason('mem-live', {
    mode: 'reconciliation_required',
    reason: 'account_owner_conflict',
  })
  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = { replaceState: () => {} }
  global.location = {
    href: 'https://thestarters.com/stripe-connect-callback?code=code-123&state=short',
    origin: 'https://thestarters.com',
    assign: () => {
      throw new Error('must not redirect')
    },
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
  }
  global.fetch = async () => {
    fetchCount += 1
    return response({ connected: true })
  }

  try {
    const result = await api.mountCallback()
    assert.equal(result, null)
    assert.equal(fetchCount, 0)
    assert.equal(storage.values.size, 0)
    assert.equal(states.error.style.display, '')
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
  } finally {
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.sessionStorage = previous.sessionStorage
  }
})

test('callback handles reconciliation and restart modes without replaying the code', async () => {
  const previous = {
    console: global.console,
    document: global.document,
    fetch: global.fetch,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  global.console = { ...console, error: () => {} }
  global.sessionStorage = storage
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
    getMemberCookie: async () => 'ms-cookie',
    onAuthChange: () => ({ unsubscribe() {} }),
  }

  try {
    const outcomes = [
      {
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
      },
      {
        mode: 'reconciliation_required',
        reason: 'oauth_exchange_ambiguous',
      },
      { mode: 'restart_required', reason: 'account_owner_conflict' },
    ]
    for (const outcome of outcomes) {
      const { mode, reason } = outcome
      const { root, states } = stripeRoot()
      const assigned = []
      let exchangeCount = 0
      api.__resetXanoToken()
      api.storeReturnReason('mem-live', {
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
      })
      global.document = {
        title: 'Stripe callback',
        querySelectorAll: () => [root],
      }
      global.history = { replaceState: () => {} }
      global.location = {
        href:
          'https://thestarters.com/stripe-connect-callback?' +
          'code=one-time-code&state=opaque-state-1234567890',
        origin: 'https://thestarters.com',
        assign: (url) => assigned.push(url),
      }
      global.fetch = async (url) => {
        if (String(url).includes('/auth/trade-token/v3')) {
          return response({ authToken: 'xano-token' })
        }
        exchangeCount += 1
        return response({ connected: false, mode, reason })
      }

      const result = await api.mountCallback()
      assert.equal(result.mode, mode)
      assert.equal(exchangeCount, 1)
      const expected = new URL(
        'https://thestarters.com/starter-dashboard?stripe_connect=' + mode,
      )
      if (
        mode === 'reconciliation_required' &&
        reason === 'account_owner_conflict'
      ) {
        expected.searchParams.set(
          'stripe_connect_reason',
          'account_owner_conflict',
        )
      }
      assert.deepEqual(assigned, [expected.toString()])
      assert.equal(states.error.style.display, 'none')
      assert.equal(
        api.consumeReturnReason('mem-live', mode),
        mode === 'reconciliation_required' &&
          reason === 'account_owner_conflict'
          ? 'account_owner_conflict'
          : '',
      )
    }
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.sessionStorage = previous.sessionStorage
  }
})

test('callback requires the documented auth subscription for conflict receipts', async (t) => {
  for (const listenerMode of [
    'missing',
    'throwing',
    'function',
    'void',
    'invalid',
    'event',
  ]) {
    await t.test(listenerMode, async () => {
      const previous = {
        console: global.console,
        document: global.document,
        fetch: global.fetch,
        getXanoAuthToken: global.getXanoAuthToken,
        history: global.history,
        location: global.location,
        memberstack: global.$memberstackDom,
        sessionStorage: global.sessionStorage,
      }
      const storage = sessionStorageFixture()
      const { root, states } = stripeRoot()
      const refresh = new FakeElement('BUTTON')
      const assigned = []
      const cleanedUrls = []
      let exchangeCount = 0
      let listenerRegistrations = 0
      let liveReads = 0
      let reloads = 0
      refresh.setAttribute(ACTION_ATTR, 'refresh')
      states.error.children.set(actionSelector('refresh'), refresh)
      root.children.set(actionSelector('refresh'), refresh)
      global.console = { ...console, error: () => {} }
      global.sessionStorage = storage
      api.storeReturnReason('member-a', {
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
      })
      global.document = {
        title: 'Stripe callback',
        querySelectorAll: () => [root],
      }
      global.history = {
        replaceState: (_state, _title, url) => cleanedUrls.push(url),
      }
      global.location = {
        href:
          'https://thestarters.com/stripe-connect-callback?' +
          'code=one-time-code&state=opaque-state-1234567890',
        origin: 'https://thestarters.com',
        reload: () => {
          reloads += 1
        },
        assign: (url) => assigned.push(url),
      }
      global.$memberstackDom = {
        getCurrentMember: async () => {
          liveReads += 1
          return { data: { id: 'member-a' } }
        },
      }
      if (listenerMode !== 'missing') {
        global.$memberstackDom.onAuthChange = (listener) => {
          listenerRegistrations += 1
          if (listenerMode === 'throwing') {
            throw new Error('auth listener unavailable')
          }
          if (listenerMode === 'function') return () => {}
          if (listenerMode === 'invalid') return {}
          if (listenerMode === 'event') {
            listener({ data: { id: 'member-a' } })
            return { unsubscribe() {} }
          }
          return undefined
        }
      }
      global.getXanoAuthToken = async () => 'member-a-xano-token'
      global.fetch = async (url) => {
        if (String(url).includes('/stripe_connect/oauth_exchange/v3')) {
          exchangeCount += 1
          return response({
            connected: false,
            mode: 'reconciliation_required',
            reason: 'account_owner_conflict',
          })
        }
        throw new Error('Unexpected Stripe request: ' + url)
      }
      api.__resetXanoToken()

      try {
        const result = await api.mountCallback()
        assert.equal(result, null)
        assert.equal(listenerRegistrations, listenerMode === 'missing' ? 0 : 1)
        assert.equal(liveReads, 0)
        assert.equal(exchangeCount, 0)
        assert.deepEqual(cleanedUrls, ['/stripe-connect-callback'])
        assert.deepEqual(assigned, [])
        assert.equal(storage.values.size, 0)
        assert.equal(states.error.style.display, '')
        const click = {
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true
          },
          type: 'click',
        }
        refresh.dispatchEvent(click)
        assert.equal(click.defaultPrevented, true)
        assert.equal(reloads, 1)
        assert.equal(exchangeCount, 0)
      } finally {
        api.__resetXanoToken()
        global.console = previous.console
        global.document = previous.document
        global.fetch = previous.fetch
        global.getXanoAuthToken = previous.getXanoAuthToken
        global.history = previous.history
        global.location = previous.location
        global.$memberstackDom = previous.memberstack
        global.sessionStorage = previous.sessionStorage
      }
    })
  }
})

test('callback drops conflict trust after an ABA auth change during exchange', async () => {
  const previous = {
    console: global.console,
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root, states } = stripeRoot()
  const assigned = []
  const cleanedUrls = []
  let authChangeListener
  let authUnsubscribes = 0
  let exchangeAuthorization = ''
  let exchangeCount = 0
  let liveMemberId = 'member-a'
  let liveReads = 0
  let markExchangeStarted
  let resolveExchange
  const exchangeStarted = new Promise((resolve) => {
    markExchangeStarted = resolve
  })

  global.sessionStorage = storage
  global.console = { ...console, error: () => {} }
  api.storeReturnReason('member-a', {
    mode: 'reconciliation_required',
    reason: 'account_owner_conflict',
  })
  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = {
    replaceState: (_state, _title, url) => cleanedUrls.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/stripe-connect-callback?' +
      'code=one-time-code&state=opaque-state-1234567890',
    origin: 'https://thestarters.com',
    assign: (url) => assigned.push(url),
  }
  global.$memberstackDom = {
    getCurrentMember: async () => {
      assert.equal(typeof authChangeListener, 'function')
      liveReads += 1
      return { data: { id: liveMemberId } }
    },
    onAuthChange(listener) {
      authChangeListener = listener
      return {
        unsubscribe() {
          authUnsubscribes += 1
        },
      }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.fetch = (url, options) => {
    if (String(url).includes('/stripe_connect/oauth_exchange/v3')) {
      exchangeCount += 1
      exchangeAuthorization = options.headers.Authorization
      markExchangeStarted()
      return new Promise((resolve) => {
        resolveExchange = () =>
          resolve(
            response({
              connected: false,
              mode: 'reconciliation_required',
              reason: 'account_owner_conflict',
            }),
          )
      })
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    const callback = api.mountCallback()
    await exchangeStarted
    assert.equal(liveReads, 3)
    assert.equal(exchangeCount, 1)

    liveMemberId = 'member-b'
    authChangeListener({ id: 'member-b' })
    liveMemberId = 'member-a'
    authChangeListener({ id: 'member-a' })
    resolveExchange()

    const result = await callback
    assert.equal(result, null)
    assert.equal(authUnsubscribes, 1)
    assert.equal(exchangeCount, 1)
    assert.equal(exchangeAuthorization, 'Bearer member-a-xano-token')
    assert.equal(liveReads, 3)
    assert.deepEqual(cleanedUrls, ['/stripe-connect-callback'])
    assert.deepEqual(assigned, [])
    assert.equal(storage.values.size, 0)
    assert.equal(states.error.style.display, '')
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.sessionStorage = previous.sessionStorage
  }
})

test('callback stops when auth changes at the final settlement boundary', async () => {
  const previous = {
    console: global.console,
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root, states } = stripeRoot()
  const assigned = []
  const cleanedUrls = []
  let authChangeListener
  let authUnsubscribes = 0
  let exchangeCount = 0
  let liveReads = 0

  global.sessionStorage = storage
  global.console = { ...console, error: () => {} }
  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = {
    replaceState: (_state, _title, url) => cleanedUrls.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/stripe-connect-callback?' +
      'code=one-time-code&state=opaque-state-1234567890',
    origin: 'https://thestarters.com',
    assign: (url) => assigned.push(url),
  }
  global.$memberstackDom = {
    getCurrentMember() {
      liveReads += 1
      if (liveReads !== 6) {
        return Promise.resolve({ data: { id: 'member-a' } })
      }
      return {
        then(resolve) {
          resolve({ data: { id: 'member-a' } })
          queueMicrotask(() => {
            queueMicrotask(() => authChangeListener({ id: 'member-a' }))
          })
        },
      }
    },
    onAuthChange(listener) {
      authChangeListener = listener
      return {
        unsubscribe() {
          authUnsubscribes += 1
        },
      }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/oauth_exchange/v3')) {
      exchangeCount += 1
      return response({
        connected: false,
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
      })
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.equal(await api.mountCallback(), null)
    assert.equal(liveReads, 6)
    assert.equal(authUnsubscribes, 1)
    assert.equal(exchangeCount, 1)
    assert.deepEqual(cleanedUrls, ['/stripe-connect-callback'])
    assert.deepEqual(assigned, [])
    assert.equal(storage.values.size, 0)
    assert.equal(states.error.style.display, '')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
    global.sessionStorage = previous.sessionStorage
  }
})

test('authenticated callback mounts owner-conflict recovery and starts a new flow', async () => {
  const previous = {
    BroadcastChannel: global.BroadcastChannel,
    addEventListener: global.addEventListener,
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    open: global.open,
    removeEventListener: global.removeEventListener,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root: callbackRoot } = stripeRoot()
  const {
    errorCopy,
    root: dashboardRoot,
    states: dashboardStates,
  } = stripeRoot()
  const recoveryButton = new FakeElement('BUTTON')
  dashboardStates.error.setAttribute(ELEMENT_ATTR, 'error')
  recoveryButton.setAttribute(ACTION_ATTR, 'refresh')
  dashboardStates.error.children.set(
    actionSelector('refresh'),
    recoveryButton,
  )
  dashboardRoot.children.set(
    actionSelector('refresh'),
    recoveryButton,
  )
  let activeRoot = callbackRoot
  const assigned = []
  const historyCalls = []
  const popupDestinations = []
  const requests = []
  let authUnsubscribes = 0
  let statusReads = 0
  let resolveStartRequest
  const startRequestObserved = new Promise((resolve) => {
    resolveStartRequest = resolve
  })
  const sameTabLocation = {
    href:
      'https://thestarters.com/stripe-connect-callback?' +
      'code=one-time-code&state=opaque-state-1234567890',
    hostname: 'thestarters.com',
    origin: 'https://thestarters.com',
    search: '?code=one-time-code&state=opaque-state-1234567890',
    assign(url) {
      assigned.push(url)
      const next = new URL(url)
      this.href = next.toString()
      this.search = next.search
    },
  }
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: {
      replace(url) {
        popupDestinations.push(url)
      },
    },
    opener: global,
  }

  global.BroadcastChannel = undefined
  global.addEventListener = undefined
  global.removeEventListener = undefined
  global.sessionStorage = storage
  global.location = sameTabLocation
  global.document = {
    title: 'Stripe callback',
    querySelectorAll(value) {
      return value === selector('root') ? [activeRoot] : []
    },
  }
  global.history = {
    replaceState(_state, _title, url) {
      historyCalls.push(url)
      const next = new URL(url, sameTabLocation.origin)
      sameTabLocation.href = next.toString()
      sameTabLocation.search = next.search
    },
  }
  global.memberReady = Promise.resolve({ id: 'mem-live' })
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
    getMemberCookie: async () => 'ms-cookie',
    onAuthChange: () => ({
      unsubscribe() {
        authUnsubscribes += 1
      },
    }),
  }
  global.getXanoAuthToken = undefined
  global.open = () => stripeTab
  global.fetch = async (url, options) => {
    requests.push({ options, url: String(url) })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    if (String(url).includes('/stripe_connect/oauth_exchange/v3')) {
      return response({
        connected: false,
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
      })
    }
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response({ connected: false, charges_enabled: false })
    }
    if (String(url).includes('/stripe_connect/start/v3')) {
      resolveStartRequest({ options, url: String(url) })
      return response({
        mode: 'oauth',
        url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
      })
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()
  api.__resetConnectStartAttempt()

  try {
    const callbackResult = await api.mountCallback()
    assert.equal(callbackResult.mode, 'reconciliation_required')
    assert.deepEqual(assigned, [
      'https://thestarters.com/starter-dashboard?' +
        'stripe_connect=reconciliation_required&' +
        'stripe_connect_reason=account_owner_conflict',
    ])

    activeRoot = dashboardRoot
    global.document.title = 'Starter dashboard'
    const status = await api.mountDashboard()

    assert.deepEqual(status, { connected: false, charges_enabled: false })
    assert.equal(authUnsubscribes, 1)
    assert.equal(statusReads, 1)
    assert.equal(storage.values.size, 0)
    assert.equal(sameTabLocation.href, 'https://thestarters.com/starter-dashboard')
    assert.equal(historyCalls.at(-1), '/starter-dashboard')
    assert.equal(
      dashboardRoot.getAttribute('data-stripe-connect-view'),
      'error',
    )
    assert.equal(
      dashboardRoot.getAttribute('data-stripe-connect-reason'),
      'account_owner_conflict',
    )
    assert.equal(errorCopy.label.textContent, 'Stripe account already linked')
    assert.equal(
      errorCopy.message.textContent,
      'This Stripe account is already linked to another Starter profile. Use a different Stripe account or contact The Starters.',
    )
    assert.equal(errorCopy.button.textContent, 'Connect a different account')

    const click = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      type: 'click',
    }
    recoveryButton.dispatchEvent(click)
    const startRequest = await startRequestObserved
    await new Promise(setImmediate)

    assert.equal(click.defaultPrevented, true)
    assert.equal(
      requests.filter((request) =>
        request.url.includes('/stripe_connect/start/v3'),
      ).length,
      1,
    )
    const startBody = JSON.parse(startRequest.options.body)
    assert.equal(
      startBody.return_url,
      'https://thestarters.com/starter-dashboard',
    )
    assert.equal(
      startBody.callback_url,
      'https://thestarters.com/stripe-connect-callback',
    )
    assert.equal(typeof startBody.idempotency_key, 'string')
    assert.ok(startBody.idempotency_key.length > 0)
    assert.ok(startBody.idempotency_key.length <= 128)
    assert.deepEqual(popupDestinations, [
      'https://connect.stripe.com/oauth/authorize?client_id=test',
    ])
  } finally {
    api.__resetXanoToken()
    api.__resetConnectStartAttempt()
    global.BroadcastChannel = previous.BroadcastChannel
    global.addEventListener = previous.addEventListener
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
    global.removeEventListener = previous.removeEventListener
    global.sessionStorage = previous.sessionStorage
  }
})

test('dashboard rejects an owner-conflict receipt after member identity changes', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    setTimeout: global.setTimeout,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { errorCopy, root, states } = stripeRoot()
  const refresh = new FakeElement('BUTTON')
  const replaced = []
  let liveReads = 0
  let reloads = 0
  let statusReads = 0
  refresh.setAttribute(ACTION_ATTR, 'refresh')
  states.error.children.set(actionSelector('refresh'), refresh)
  root.children.set(actionSelector('refresh'), refresh)
  global.sessionStorage = storage
  api.storeReturnReason('member-a', {
    mode: 'reconciliation_required',
    reason: 'account_owner_conflict',
  })
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      return value === selector('root') ? [root] : []
    },
  }
  global.history = {
    replaceState: (_state, _title, url) => replaced.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof#stripe',
    origin: 'https://thestarters.com',
    reload: () => {
      reloads += 1
    },
    search:
      '?stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember: async () => {
      liveReads += 1
      return { data: { id: 'member-b' } }
    },
    onAuthChange: () => ({ unsubscribe() {} }),
  }
  global.getXanoAuthToken = async () => 'member-b-xano-token'
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response({ connected: false, charges_enabled: false })
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.equal(await api.mountDashboard(), null)
    assert.equal(liveReads, 1)
    assert.equal(statusReads, 0)
    assert.equal(storage.values.size, 0)
    assert.deepEqual(replaced, [
      '/starter-dashboard?utm_source=proof#stripe',
    ])
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
    assert.equal(errorCopy.button.textContent, 'Try Again')
    const click = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      type: 'click',
    }
    refresh.dispatchEvent(click)
    assert.equal(click.defaultPrevented, true)
    assert.equal(reloads, 1)
    assert.equal(statusReads, 0)
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.setTimeout = previous.setTimeout
    global.sessionStorage = previous.sessionStorage
  }
})

test('dashboard requires the documented auth-change subscription for conflict guidance', async (t) => {
  for (const listenerMode of [
    'missing',
    'throwing',
    'function',
    'void',
    'invalid',
    'event',
  ]) {
    await t.test(listenerMode, async () => {
      const previous = {
        document: global.document,
        fetch: global.fetch,
        getXanoAuthToken: global.getXanoAuthToken,
        history: global.history,
        location: global.location,
        memberReady: global.memberReady,
        memberstack: global.$memberstackDom,
        setTimeout: global.setTimeout,
        sessionStorage: global.sessionStorage,
      }
      const storage = sessionStorageFixture()
      const { errorCopy, root } = stripeRoot()
      const replaced = []
      let listenerRegistrations = 0
      let liveReads = 0
      let statusReads = 0
      global.sessionStorage = storage
      api.storeReturnReason('member-a', {
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
      })
      global.document = {
        title: 'Starter dashboard',
        querySelectorAll(value) {
          return value === selector('root') ? [root] : []
        },
      }
      global.history = {
        replaceState: (_state, _title, url) => replaced.push(url),
      }
      global.location = {
        href:
          'https://thestarters.com/starter-dashboard?' +
          'stripe_connect=reconciliation_required&' +
          'stripe_connect_reason=account_owner_conflict&' +
          'utm_source=proof#stripe',
        origin: 'https://thestarters.com',
        search:
          '?stripe_connect=reconciliation_required&' +
          'stripe_connect_reason=account_owner_conflict&' +
          'utm_source=proof',
      }
      global.memberReady = Promise.resolve({ id: 'member-a' })
      global.$memberstackDom = {
        getCurrentMember: async () => {
          liveReads += 1
          return { data: { id: 'member-a' } }
        },
      }
      if (listenerMode !== 'missing') {
        global.$memberstackDom.onAuthChange = (listener) => {
          listenerRegistrations += 1
          if (listenerMode === 'throwing') {
            throw new Error('auth listener unavailable')
          }
          if (listenerMode === 'function') return () => {}
          if (listenerMode === 'invalid') return {}
          if (listenerMode === 'event') {
            listener({ data: { id: 'member-a' } })
            return { unsubscribe() {} }
          }
          return undefined
        }
      }
      global.getXanoAuthToken = async () => 'member-a-xano-token'
      global.setTimeout = (callback) => {
        callback()
        return 1
      }
      global.fetch = async (url) => {
        if (String(url).includes('/stripe_connect/status/v3')) {
          statusReads += 1
          return response(
            statusReads === 1
              ? { connected: false, charges_enabled: false }
              : { connected: true, charges_enabled: true },
          )
        }
        throw new Error('Unexpected Stripe request: ' + url)
      }
      api.__resetXanoToken()

      try {
        assert.equal(await api.mountDashboard(), null)
        assert.equal(listenerRegistrations, listenerMode === 'missing' ? 0 : 1)
        assert.equal(liveReads, 0)
        assert.equal(statusReads, 0)
        assert.equal(storage.values.size, 0)
        assert.deepEqual(replaced, [
          '/starter-dashboard?utm_source=proof#stripe',
        ])
        assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
        assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
        assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
        assert.equal(errorCopy.button.textContent, 'Try Again')
      } finally {
        api.__resetXanoToken()
        global.document = previous.document
        global.fetch = previous.fetch
        global.getXanoAuthToken = previous.getXanoAuthToken
        global.history = previous.history
        global.location = previous.location
        global.memberReady = previous.memberReady
        global.$memberstackDom = previous.memberstack
        global.setTimeout = previous.setTimeout
        global.sessionStorage = previous.sessionStorage
      }
    })
  }
})

test('ordinary dashboard mount keeps a live auth scope and cleans return markers', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    setTimeout: global.setTimeout,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root } = stripeRoot()
  const replaced = []
  let authChangeListener
  let listenerRegistrations = 0
  let liveReads = 0
  let statusReads = 0
  global.sessionStorage = storage
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      return value === selector('root') ? [root] : []
    },
  }
  global.history = {
    replaceState: (_state, _title, url) => replaced.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=restart_required&utm_source=proof#stripe',
    origin: 'https://thestarters.com',
    search: '?stripe_connect=restart_required&utm_source=proof',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember: async () => {
      liveReads += 1
      return { data: { id: 'member-a' } }
    },
    onAuthChange(listener) {
      listenerRegistrations += 1
      authChangeListener = listener
      return { unsubscribe() {} }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response({ connected: false, charges_enabled: false })
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.deepEqual(await api.mountDashboard(), {
      connected: false,
      charges_enabled: false,
    })
    assert.equal(typeof authChangeListener, 'function')
    assert.equal(listenerRegistrations, 1)
    assert.equal(liveReads, 6)
    assert.equal(statusReads, 1)
    assert.deepEqual(replaced, [
      '/starter-dashboard?utm_source=proof#stripe',
    ])
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'disconnected')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.sessionStorage = previous.sessionStorage
  }
})

test('a late dashboard auth change forces reload and blocks every Stripe action', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    open: global.open,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { errorCopy, root } = stripeRoot()
  const dashboard = new FakeElement('BUTTON')
  const refresh = new FakeElement('BUTTON')
  const start = new FakeElement('BUTTON')
  dashboard.setAttribute(ACTION_ATTR, 'dashboard')
  refresh.setAttribute(ACTION_ATTR, 'refresh')
  start.setAttribute(ACTION_ATTR, 'start')
  root.children.set(actionSelector('dashboard'), dashboard)
  root.children.set(actionSelector('refresh'), refresh)
  root.children.set(actionSelector('start'), start)

  let authChangeListener
  let authUnsubscribes = 0
  let liveMemberId = 'member-a'
  let popupAttempts = 0
  let reloads = 0
  let statusReads = 0
  global.sessionStorage = storage
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      return value === selector('root') ? [root] : []
    },
  }
  global.history = { replaceState() {} }
  global.location = {
    href: 'https://thestarters.com/starter-dashboard',
    origin: 'https://thestarters.com',
    reload() {
      reloads += 1
    },
    search: '',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: liveMemberId } }),
    onAuthChange(listener) {
      authChangeListener = listener
      return {
        unsubscribe() {
          authUnsubscribes += 1
        },
      }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.open = () => {
    popupAttempts += 1
    return null
  }
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response({ connected: false, charges_enabled: false })
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.deepEqual(await api.mountDashboard(), {
      connected: false,
      charges_enabled: false,
    })
    assert.equal(statusReads, 1)

    liveMemberId = 'member-b'
    authChangeListener({ data: { id: 'member-b' } })

    assert.equal(authUnsubscribes, 1)
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
    assert.equal(errorCopy.button.textContent, 'Try Again')

    const click = () => ({
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      type: 'click',
    })
    const refreshClick = click()
    refresh.dispatchEvent(refreshClick)
    start.dispatchEvent(click())
    dashboard.dispatchEvent(click())

    assert.equal(refreshClick.defaultPrevented, true)
    assert.equal(reloads, 1)
    assert.equal(popupAttempts, 0)
    assert.equal(statusReads, 1)
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
    global.sessionStorage = previous.sessionStorage
  }
})

test('an auth change while a Connect response body parses blocks navigation', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root } = stripeRoot()
  const button = new FakeElement('BUTTON')
  const connectTile = new FakeElement()
  const popupDestinations = []
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: {
      replace(url) {
        popupDestinations.push(url)
      },
    },
  }
  let authChangeListener
  let markStartRequestObserved
  let resolveStartBody
  let startReads = 0
  let statusReads = 0
  const startRequestObserved = new Promise((resolve) => {
    markStartRequestObserved = resolve
  })
  global.sessionStorage = storage
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      return value === selector('root') ? [root] : []
    },
  }
  global.history = { replaceState() {} }
  global.location = {
    href: 'https://thestarters.com/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'member-a' } }),
    onAuthChange(listener) {
      authChangeListener = listener
      return { unsubscribe() {} }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response({ connected: false, charges_enabled: false })
    }
    if (String(url).includes('/stripe_connect/start/v3')) {
      startReads += 1
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((resolve) => {
            resolveStartBody = resolve
            markStartRequestObserved()
          }),
      }
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.deepEqual(await api.mountDashboard(), {
      connected: false,
      charges_enabled: false,
    })

    const started = api.handleStart(
      button,
      connectTile,
      [root],
      'member-a',
      stripeTab,
    )
    await startRequestObserved
    authChangeListener({ data: { id: 'member-b' } })
    resolveStartBody({
      mode: 'oauth',
      url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
    })

    assert.equal(await started, false)
    assert.equal(statusReads, 1)
    assert.equal(startReads, 1)
    assert.equal(stripeTab.closed, true)
    assert.deepEqual(popupDestinations, [])
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.sessionStorage = previous.sessionStorage
  }
})

test('a silent member change while a Dashboard response body parses blocks navigation', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    open: global.open,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root } = stripeRoot()
  const button = new FakeElement('BUTTON')
  const popupDestinations = []
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: {
      replace(url) {
        popupDestinations.push(url)
      },
    },
  }
  let markDashboardBodyObserved
  let resolveDashboardBody
  let dashboardReads = 0
  let liveMemberId = 'member-a'
  let statusReads = 0
  const dashboardBodyObserved = new Promise((resolve) => {
    markDashboardBodyObserved = resolve
  })
  global.sessionStorage = storage
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      return value === selector('root') ? [root] : []
    },
  }
  global.history = { replaceState() {} }
  global.location = {
    href: 'https://thestarters.com/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: liveMemberId } }),
    onAuthChange() {
      return { unsubscribe() {} }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.open = () => stripeTab
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response({ connected: true, charges_enabled: true })
    }
    if (String(url).includes('/stripe_connect/dashboard/v3')) {
      dashboardReads += 1
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((resolve) => {
            resolveDashboardBody = resolve
            markDashboardBodyObserved()
          }),
      }
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.deepEqual(await api.mountDashboard(), {
      connected: true,
      charges_enabled: true,
    })

    const opened = api.openDashboardInNewTab(
      api.createExclusiveRunner(),
      button,
      [root],
      'member-a',
    )
    await dashboardBodyObserved
    liveMemberId = 'member-b'
    resolveDashboardBody({
      account_id: 'acct_ownerA',
      connected: true,
      mode: 'full',
      url: 'https://dashboard.stripe.com/b/acct_ownerA',
    })

    assert.equal(await opened, false)
    assert.equal(statusReads, 1)
    assert.equal(dashboardReads, 1)
    assert.equal(stripeTab.closed, true)
    assert.deepEqual(popupDestinations, [])
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.open = previous.open
    global.sessionStorage = previous.sessionStorage
  }
})

test('an auth event after the final member read cannot escape through Connect navigation', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { root } = stripeRoot()
  const button = new FakeElement('BUTTON')
  const connectTile = new FakeElement()
  const popupDestinations = []
  const stripeTab = {
    closed: false,
    close() {
      this.closed = true
    },
    location: {
      replace(url) {
        popupDestinations.push(url)
      },
    },
  }
  let actionPhase = false
  let actionLiveReads = 0
  let authChangeListener
  let startReads = 0
  let statusReads = 0
  global.sessionStorage = storage
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      return value === selector('root') ? [root] : []
    },
  }
  global.history = { replaceState() {} }
  global.location = {
    href: 'https://thestarters.com/starter-dashboard',
    origin: 'https://thestarters.com',
    search: '',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember() {
      if (!actionPhase) {
        return Promise.resolve({ data: { id: 'member-a' } })
      }
      actionLiveReads += 1
      if (actionLiveReads !== 5) {
        return Promise.resolve({ data: { id: 'member-a' } })
      }
      return {
        then(resolve) {
          resolve({ data: { id: 'member-a' } })
          queueMicrotask(() => {
            queueMicrotask(() => {
              queueMicrotask(() => authChangeListener({ id: 'member-a' }))
            })
          })
        },
      }
    },
    onAuthChange(listener) {
      authChangeListener = listener
      return { unsubscribe() {} }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response({ connected: false, charges_enabled: false })
    }
    if (String(url).includes('/stripe_connect/start/v3')) {
      startReads += 1
      return response({
        mode: 'oauth',
        url: 'https://connect.stripe.com/oauth/authorize?client_id=test',
      })
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.deepEqual(await api.mountDashboard(), {
      connected: false,
      charges_enabled: false,
    })
    actionPhase = true

    assert.equal(
      await api.handleStart(
        button,
        connectTile,
        [root],
        'member-a',
        stripeTab,
      ),
      false,
    )
    assert.equal(actionLiveReads, 5)
    assert.equal(statusReads, 1)
    assert.equal(startReads, 1)
    assert.equal(stripeTab.closed, true)
    assert.deepEqual(popupDestinations, [])
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.sessionStorage = previous.sessionStorage
  }
})

test('dashboard discards stale status and token after an ABA auth change', async () => {
  const previous = {
    console: global.console,
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    setTimeout: global.setTimeout,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { errorCopy, root, states } = stripeRoot()
  const earningsTile = new FakeElement()
  const refresh = new FakeElement('BUTTON')
  const setRootAttribute = root.setAttribute.bind(root)
  const replaced = []
  const statusAuthorizations = []
  const tokenOptions = []
  let authChangeListener
  let authUnsubscribes = 0
  let conflictReasonWrites = 0
  let liveMemberId = 'member-a'
  let liveReads = 0
  let reloads = 0
  let readyViewWrites = 0
  let statusReads = 0
  let resolveToken
  let markTokenRequestStarted
  const tokenRequestStarted = new Promise((resolve) => {
    markTokenRequestStarted = resolve
  })

  root.setAttribute = (name, value) => {
    if (
      name === 'data-stripe-connect-reason' &&
      value === 'account_owner_conflict'
    ) {
      conflictReasonWrites += 1
    }
    if (name === 'data-stripe-connect-view' && value === 'ready') {
      readyViewWrites += 1
    }
    setRootAttribute(name, value)
  }
  refresh.setAttribute(ACTION_ATTR, 'refresh')
  states.error.children.set(actionSelector('refresh'), refresh)
  root.children.set(actionSelector('refresh'), refresh)
  global.sessionStorage = storage
  global.console = { ...console, error: () => {} }
  api.storeReturnReason('member-a', {
    mode: 'reconciliation_required',
    reason: 'account_owner_conflict',
  })
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      if (value === selector('root')) return [root]
      if (value === actionSelector('earnings')) return [earningsTile]
      return []
    },
  }
  global.history = {
    replaceState: (_state, _title, url) => replaced.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof#stripe',
    origin: 'https://thestarters.com',
    reload: () => {
      reloads += 1
    },
    search:
      '?stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember: async () => {
      liveReads += 1
      return { data: { id: liveMemberId } }
    },
    onAuthChange(listener) {
      authChangeListener = listener
      return {
        unsubscribe() {
          authUnsubscribes += 1
        },
      }
    },
  }
  global.getXanoAuthToken = (options) => {
    tokenOptions.push(options)
    if (tokenOptions.length > 1) {
      return Promise.resolve(liveMemberId + '-xano-token')
    }
    return new Promise((resolve) => {
      resolveToken = resolve
      markTokenRequestStarted()
    })
  }
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.fetch = async (_url, options) => {
    statusReads += 1
    statusAuthorizations.push(options.headers.Authorization)
    return response({ connected: true, charges_enabled: true })
  }
  api.__resetXanoToken()

  try {
    const mounted = api.mountDashboard()
    await tokenRequestStarted
    assert.equal(storage.values.size, 0)

    liveMemberId = 'member-b'
    authChangeListener({ id: 'member-b' })
    liveMemberId = 'member-a'
    authChangeListener({ id: 'member-a' })
    resolveToken('member-b-xano-token')

    assert.equal(await mounted, null)
    assert.equal(liveReads, 3)
    assert.equal(authUnsubscribes, 1)
    assert.equal(statusReads, 0)
    assert.deepEqual(tokenOptions, [undefined])
    assert.deepEqual(statusAuthorizations, [])
    assert.equal(conflictReasonWrites, 0)
    assert.equal(readyViewWrites, 0)
    assert.equal(storage.values.size, 0)
    assert.deepEqual(replaced, [
      '/starter-dashboard?utm_source=proof#stripe',
    ])
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(earningsTile.getAttribute('aria-disabled'), 'true')
    earningsTile.dispatchEvent({ type: 'click' })
    assert.equal(statusReads, 0)
    const click = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      type: 'click',
    }
    refresh.dispatchEvent(click)
    assert.equal(click.defaultPrevented, true)
    assert.equal(reloads, 1)
    assert.equal(statusReads, 0)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
    assert.equal(
      errorCopy.message.textContent,
      "We couldn't load your Stripe status. Your account was not changed.",
    )
    assert.equal(errorCopy.button.textContent, 'Try Again')
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.setTimeout = previous.setTimeout
    global.sessionStorage = previous.sessionStorage
  }
})

test('dashboard stops when auth changes at the final render boundary', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    setTimeout: global.setTimeout,
    sessionStorage: global.sessionStorage,
  }
  const storage = sessionStorageFixture()
  const { errorCopy, root } = stripeRoot()
  const setRootAttribute = root.setAttribute.bind(root)
  const replaced = []
  let authChangeListener
  let authUnsubscribes = 0
  let conflictReasonWrites = 0
  let liveReads = 0
  let statusReads = 0

  root.setAttribute = (name, value) => {
    if (
      name === 'data-stripe-connect-reason' &&
      value === 'account_owner_conflict'
    ) {
      conflictReasonWrites += 1
    }
    setRootAttribute(name, value)
  }
  global.sessionStorage = storage
  api.storeReturnReason('member-a', {
    mode: 'reconciliation_required',
    reason: 'account_owner_conflict',
  })
  global.document = {
    title: 'Starter dashboard',
    querySelectorAll(value) {
      return value === selector('root') ? [root] : []
    },
  }
  global.history = {
    replaceState: (_state, _title, url) => replaced.push(url),
  }
  global.location = {
    href:
      'https://thestarters.com/starter-dashboard?' +
      'stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof#stripe',
    origin: 'https://thestarters.com',
    search:
      '?stripe_connect=reconciliation_required&' +
      'stripe_connect_reason=account_owner_conflict&utm_source=proof',
  }
  global.memberReady = Promise.resolve({ id: 'member-a' })
  global.$memberstackDom = {
    getCurrentMember() {
      liveReads += 1
      if (liveReads !== 7) {
        return Promise.resolve({ data: { id: 'member-a' } })
      }
      return {
        then(resolve) {
          resolve({ data: { id: 'member-a' } })
          queueMicrotask(() => {
            queueMicrotask(() => authChangeListener({ id: 'member-a' }))
          })
        },
      }
    },
    onAuthChange(listener) {
      authChangeListener = listener
      return {
        unsubscribe() {
          authUnsubscribes += 1
        },
      }
    },
  }
  global.getXanoAuthToken = async () => 'member-a-xano-token'
  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.fetch = async (url) => {
    if (String(url).includes('/stripe_connect/status/v3')) {
      statusReads += 1
      return response(
        statusReads === 1
          ? { connected: false, charges_enabled: false }
          : { connected: true, charges_enabled: true },
      )
    }
    throw new Error('Unexpected Stripe request: ' + url)
  }
  api.__resetXanoToken()

  try {
    assert.equal(await api.mountDashboard(), null)
    assert.equal(liveReads, 7)
    assert.equal(authUnsubscribes, 1)
    assert.equal(statusReads, 1)
    assert.equal(conflictReasonWrites, 0)
    assert.equal(storage.values.size, 0)
    assert.deepEqual(replaced, [
      '/starter-dashboard?utm_source=proof#stripe',
    ])
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
    assert.equal(root.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
    assert.equal(errorCopy.button.textContent, 'Try Again')
  } finally {
    api.__resetXanoToken()
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.setTimeout = previous.setTimeout
    global.sessionStorage = previous.sessionStorage
  }
})

test('blocked session storage keeps callback redirect and dashboard status fail closed', async () => {
  const previous = {
    console: global.console,
    document: global.document,
    fetch: global.fetch,
    getXanoAuthToken: global.getXanoAuthToken,
    history: global.history,
    location: global.location,
    memberReady: global.memberReady,
    memberstack: global.$memberstackDom,
    setTimeout: global.setTimeout,
    sessionStorageDescriptor: Object.getOwnPropertyDescriptor(
      global,
      'sessionStorage',
    ),
  }
  const { root: callbackRoot } = stripeRoot()
  const assigned = []
  let statusReads = 0

  Object.defineProperty(global, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('session storage is blocked')
    },
  })
  global.console = { ...console, error: () => {} }
  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [callbackRoot],
  }
  global.history = { replaceState: () => {} }
  global.location = {
    href:
      'https://thestarters.com/stripe-connect-callback?' +
      'code=one-time-code&state=opaque-state-1234567890',
    origin: 'https://thestarters.com',
    assign: (url) => assigned.push(url),
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
    getMemberCookie: async () => 'ms-cookie',
    onAuthChange: () => ({ unsubscribe() {} }),
  }
  global.fetch = async (url) => {
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    if (String(url).includes('/oauth_exchange/v3')) {
      return response({
        connected: false,
        mode: 'reconciliation_required',
        reason: 'account_owner_conflict',
      })
    }
    statusReads += 1
    return response({ connected: false, charges_enabled: false })
  }
  api.__resetXanoToken()

  try {
    const callbackResult = await api.mountCallback()
    assert.equal(callbackResult.mode, 'reconciliation_required')
    assert.deepEqual(assigned, [
      'https://thestarters.com/starter-dashboard?' +
        'stripe_connect=reconciliation_required',
    ])

    const { errorCopy, root: dashboardRoot } = stripeRoot()
    const dashboardUrl = new URL(assigned[0])
    global.document = {
      title: 'Starter dashboard',
      querySelectorAll(value) {
        return value === selector('root') ? [dashboardRoot] : []
      },
    }
    global.history = { replaceState: () => {} }
    global.location = {
      href: dashboardUrl.toString(),
      search: dashboardUrl.search,
    }
    global.memberReady = Promise.resolve({ id: 'mem-live' })
    global.setTimeout = (callback) => {
      callback()
      return 1
    }

    const status = await api.mountDashboard()
    assert.deepEqual(status, { connected: false, charges_enabled: false })
    assert.equal(statusReads, 5)
    assert.equal(
      dashboardRoot.getAttribute('data-stripe-connect-view'),
      'error',
    )
    assert.equal(dashboardRoot.getAttribute('data-stripe-connect-reason'), null)
    assert.equal(errorCopy.label.textContent, 'Stripe Status Unavailable')
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.getXanoAuthToken = previous.getXanoAuthToken
    global.history = previous.history
    global.location = previous.location
    global.memberReady = previous.memberReady
    global.$memberstackDom = previous.memberstack
    global.setTimeout = previous.setTimeout
    if (previous.sessionStorageDescriptor) {
      Object.defineProperty(
        global,
        'sessionStorage',
        previous.sessionStorageDescriptor,
      )
    } else {
      delete global.sessionStorage
    }
  }
})

test('staging callback uses the persistent exchange and keeps the TEST domain', async () => {
  const previous = {
    document: global.document,
    fetch: global.fetch,
    history: global.history,
    location: global.location,
    memberstack: global.$memberstackDom,
  }
  const { root, states } = stripeRoot()
  const requests = []
  const assigned = []

  global.document = {
    title: 'Stripe callback',
    querySelectorAll: () => [root],
  }
  global.history = { replaceState: () => {} }
  global.location = {
    hostname: 'the-starters-3-0.webflow.io',
    href:
      'https://the-starters-3-0.webflow.io/stripe-connect-callback?' +
      'code=test-code&state=opaque-test-state-123456',
    origin: 'https://the-starters-3-0.webflow.io',
    assign: (url) => assigned.push(url),
  }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem_sb_test' } }),
    getMemberCookie: async () => 'ms-cookie',
    onAuthChange: () => ({ unsubscribe() {} }),
  }
  global.fetch = async (url, options) => {
    requests.push({ url, options })
    if (String(url).includes('/auth/trade-token/v3')) {
      return response({ authToken: 'xano-token' })
    }
    return response({
      connected: true,
      charges_enabled: false,
      mode: 'completed',
    })
  }

  try {
    const result = await api.mountCallback()
    assert.equal(result.mode, 'completed')
    const exchangeRequest = stripeRequest(
      requests,
      '/stripe_connect/oauth_exchange/v3',
    )
    assert.deepEqual(JSON.parse(exchangeRequest.options.body), {
      code: 'test-code',
      state: 'opaque-test-state-123456',
    })
    assert.deepEqual(assigned, [
      'https://the-starters-3-0.webflow.io/starter-dashboard?' +
        'stripe_connect=connected',
    ])
    assert.equal(states.error.style.display, 'none')
  } finally {
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
  }
})
