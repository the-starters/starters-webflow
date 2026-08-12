const assert = require('node:assert/strict')
const test = require('node:test')

global.window = global
const api = require('./starter-dashboard-stripe-connect.js')

const ELEMENT_ATTR = 'data-stripe-connect-element'
const selector = (name) => '[' + ELEMENT_ATTR + '="' + name + '"]'

class FakeElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName
    this.attributes = new Map()
    this.children = new Map()
    this.hidden = false
    this.style = {}
    this.classes = new Set()
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
  return { root, states }
}

function response(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    json: async () => body,
  }
}

test('dashboard view uses canonical connected and charges-enabled state', () => {
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: false },
      false,
    ),
    'disconnected',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: false },
      false,
    ),
    'incomplete',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: true },
      false,
    ),
    'ready',
  )
  assert.equal(
    api.resolveDashboardView({ mode: 'provider_unavailable' }, false),
    'error',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: 'false', charges_enabled: false },
      false,
    ),
    'error',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: true },
      false,
    ),
    'error',
  )
})

test('a Stripe return renders review only while the provider account is connected', () => {
  assert.equal(
    api.resolveDashboardView(
      { connected: true, charges_enabled: false },
      true,
    ),
    'review',
  )
  assert.equal(
    api.resolveDashboardView(
      { connected: false, charges_enabled: false },
      true,
    ),
    'disconnected',
  )
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

test('connected state gets idempotent Open Stripe and disconnect controls', () => {
  class FakeControl extends FakeElement {
    constructor(label = 'Connect Stripe') {
      super()
      this.label = new FakeElement()
      this.label.textContent = label
      this.link = new FakeElement('A')
      this.link.setAttribute('href', '#Stripe')
      this.link.setAttribute('target', '_blank')
    }

    cloneNode() {
      return new FakeControl(this.label.textContent)
    }

    querySelector(value) {
      if (value === '.button_main-text') return this.label
      return null
    }

    querySelectorAll(value) {
      return value === 'a, button, [role="button"]' ? [this.link] : []
    }
  }

  const { root, states } = stripeRoot()
  const controls = []
  const wrapper = {
    appendChild(control) {
      controls.push(control)
    },
  }
  const source = new FakeControl()
  states.disconnected.querySelector = (value) =>
    value === '.action-item_button-wrapper > *' ? source : null
  states.ready.querySelector = (value) => {
    if (value === '.action-item_button-wrapper') return wrapper
    const action = value.match(/data-stripe-connect-action="([^"]+)"/)
    return action
      ? controls.find(
          (control) =>
            control.getAttribute('data-stripe-connect-action') === action[1],
        ) || null
      : null
  }

  const created = api.ensureConnectedControls(root)

  assert.equal(created.length, 2)
  assert.equal(controls.length, 2)
  assert.equal(
    controls[0].getAttribute('data-stripe-connect-action'),
    'dashboard',
  )
  assert.equal(controls[0].label.textContent, 'Open Stripe')
  assert.equal(controls[0].link.getAttribute('aria-label'), 'Open Stripe')
  assert.equal(controls[0].link.getAttribute('href'), '#')
  assert.equal(controls[0].link.getAttribute('target'), null)
  assert.equal(
    controls[1].getAttribute('data-stripe-connect-action'),
    'disconnect',
  )
  assert.equal(controls[1].label.textContent, 'Disconnect Stripe')
  assert.equal(
    controls[1].link.getAttribute('aria-label'),
    'Disconnect Stripe',
  )

  assert.deepEqual(api.ensureConnectedControls(root), [])
  assert.equal(controls.length, 2)
})

test('connected state reuses the authored ready control without leaving Connect Stripe visible', () => {
  class FakeControl extends FakeElement {
    constructor(label = 'Connect Stripe') {
      super()
      this.label = new FakeElement()
      this.label.textContent = label
      this.link = new FakeElement('A')
      this.link.setAttribute('href', '#Stripe')
      this.link.setAttribute('target', '_blank')
    }

    cloneNode() {
      return new FakeControl(this.label.textContent)
    }

    querySelector(value) {
      if (value === '.button_main-text') return this.label
      return null
    }

    querySelectorAll(value) {
      return value === 'a, button, [role="button"]' ? [this.link] : []
    }
  }

  const { root, states } = stripeRoot()
  const authoredReadyControl = new FakeControl()
  const controls = [authoredReadyControl]
  const wrapper = {
    appendChild(control) {
      controls.push(control)
    },
  }
  states.ready.querySelector = (value) => {
    if (value === '.action-item_button-wrapper') return wrapper
    if (value === '.action-item_button-wrapper > *') {
      return authoredReadyControl
    }
    const action = value.match(/data-stripe-connect-action="([^"]+)"/)
    return action
      ? controls.find(
          (control) =>
            control.getAttribute('data-stripe-connect-action') === action[1],
        ) || null
      : null
  }

  const created = api.ensureConnectedControls(root)

  assert.equal(created.length, 2)
  assert.equal(controls.length, 2)
  assert.equal(controls[0], authoredReadyControl)
  assert.equal(
    controls[0].getAttribute('data-stripe-connect-action'),
    'dashboard',
  )
  assert.equal(controls[0].label.textContent, 'Open Stripe')
  assert.equal(
    controls[1].getAttribute('data-stripe-connect-action'),
    'disconnect',
  )
  assert.equal(controls[1].label.textContent, 'Disconnect Stripe')
  assert.equal(
    controls.some((control) => control.label.textContent === 'Connect Stripe'),
    false,
  )

  assert.deepEqual(api.ensureConnectedControls(root), [])
  assert.equal(controls.length, 2)
})

test('incomplete and review states each receive a working disconnect control', () => {
  class FakeControl extends FakeElement {
    constructor(label = 'Complete Setup') {
      super()
      this.label = new FakeElement()
      this.label.textContent = label
      this.link = new FakeElement('A')
    }

    cloneNode() {
      return new FakeControl(this.label.textContent)
    }

    querySelector(value) {
      if (value === '.button_main-text') return this.label
      return null
    }

    querySelectorAll(value) {
      return value === 'a, button, [role="button"]' ? [this.link] : []
    }
  }

  const { root, states } = stripeRoot()
  const readyControls = []
  const stateControls = { incomplete: [], review: [] }
  const disconnectedSource = new FakeControl('Connect Stripe')
  states.disconnected.querySelector = (value) =>
    value === '.action-item_button-wrapper > *' ? disconnectedSource : null
  states.ready.querySelector = (value) => {
    if (value === '.action-item_button-wrapper') {
      return { appendChild: (control) => readyControls.push(control) }
    }
    const action = value.match(/data-stripe-connect-action="([^"]+)"/)
    return action
      ? readyControls.find(
          (control) =>
            control.getAttribute('data-stripe-connect-action') === action[1],
        ) || null
      : null
  }

  const setupStateNames = ['incomplete', 'review']
  setupStateNames.forEach((stateName) => {
    const authored = new FakeControl()
    const controls = stateControls[stateName]
    states[stateName].querySelector = (value) => {
      if (value === '.action-item_button-wrapper') {
        return { appendChild: (control) => controls.push(control) }
      }
      if (value === '.action-item_button-wrapper > *') return authored
      const action = value.match(/data-stripe-connect-action="([^"]+)"/)
      return action
        ? controls.find(
            (control) =>
              control.getAttribute('data-stripe-connect-action') === action[1],
          ) || null
        : null
    }
  })

  api.ensureConnectedControls(root)

  for (const stateName of ['incomplete', 'review']) {
    assert.equal(stateControls[stateName].length, 1)
    assert.equal(
      stateControls[stateName][0].getAttribute('data-stripe-connect-action'),
      'disconnect',
    )
    assert.equal(
      stateControls[stateName][0].label.textContent,
      'Disconnect Stripe',
    )
  }

  api.ensureConnectedControls(root)
  assert.equal(stateControls.incomplete.length, 1)
  assert.equal(stateControls.review.length, 1)
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

      await api.loadDashboardStatus([root], false, earningsTiles)

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
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
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
        'member-123',
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
    getCurrentMember: async () => ({ data: { id: 'member-123' } }),
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
        'member-123',
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
  }
  const { root, states } = stripeRoot()
  let fetchCount = 0

  global.console = { ...console, error: () => {} }
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
    assert.equal(states.error.style.display, '')
    assert.equal(root.getAttribute('data-stripe-connect-view'), 'error')
  } finally {
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
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
  }
  global.console = { ...console, error: () => {} }
  global.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem-live' } }),
    getMemberCookie: async () => 'ms-cookie',
  }

  try {
    for (const mode of ['reconciliation_required', 'restart_required']) {
      const { root, states } = stripeRoot()
      const assigned = []
      let exchangeCount = 0
      api.__resetXanoToken()
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
        return response({ connected: false, mode })
      }

      const result = await api.mountCallback()
      assert.equal(result.mode, mode)
      assert.equal(exchangeCount, 1)
      assert.deepEqual(assigned, [
        'https://thestarters.com/starter-dashboard?stripe_connect=' + mode,
      ])
      assert.equal(states.error.style.display, 'none')
    }
  } finally {
    api.__resetXanoToken()
    global.console = previous.console
    global.document = previous.document
    global.fetch = previous.fetch
    global.history = previous.history
    global.location = previous.location
    global.$memberstackDom = previous.memberstack
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
    getCurrentMember: async () => ({ data: { id: 'mem-test' } }),
    getMemberCookie: async () => 'ms-cookie',
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
