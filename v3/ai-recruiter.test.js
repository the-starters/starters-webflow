const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const script = new vm.Script(fs.readFileSync(path.join(__dirname, 'ai-recruiter.js'), 'utf8'))
const STORAGE_KEY = 'ts:ai-recruiter:v3:session'

class Element {
  constructor(attributes = {}) {
    this.attributes = { ...attributes }
    this.dataset = {}
    this.hidden = false
    this.disabled = false
    this.checked = false
    this.value = ''
    this.textContent = ''
    this.children = []
    this.listeners = new Map()
    this.queries = new Map()
  }

  addEventListener(name, listener) { this.listeners.set(name, listener) }
  dispatch(name, values = {}) {
    const event = { preventDefault() {}, key: '', ...values }
    const result = this.listeners.get(name)?.(event)
    return Promise.resolve(result)
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  removeAttribute(name) { delete this.attributes[name] }
  appendChild(child) { this.children.push(child) }
  replaceChildren(...children) { this.children = children }
  querySelector(selector) {
    const value = this.queries.get(selector)
    return Array.isArray(value) ? value[0] || null : value || null
  }
  querySelectorAll(selector) {
    const value = this.queries.get(selector)
    if (!value) return []
    return Array.isArray(value) ? value : [value]
  }
  focus() { this.focused = true }
}

function makeFixture(options = {}) {
  const root = new Element()
  const launcher = new Element()
  const panel = new Element()
  const form = new Element()
  const input = new Element()
  const submit = new Element()
  const messages = new Element()
  const candidates = new Element()
  const status = new Element()
  const consent = new Element(options.consentRole === 'checkbox'
    ? { role: 'checkbox', 'aria-checked': 'false' }
    : {})
  const consentIndicator = new Element()
  consentIndicator.textContent = '☐'
  const consentContinue = new Element()
  const startOver = new Element()
  const states = ['consent', 'ready', 'thinking', 'retry', 'error', 'rate-limited', 'expired', 'offline', 'upgrade', 'unavailable']
    .map((name) => new Element({ 'data-ai-recruiter-state': name }))
  const clones = { messages: 0, candidates: 0 }

  const messageTemplate = new Element()
  messageTemplate.cloneNode = () => {
    clones.messages += 1
    const clone = new Element()
    clone.queries.set('[data-ai-recruiter-field="message"]', new Element())
    return clone
  }
  const candidateTemplate = new Element()
  candidateTemplate.cloneNode = () => {
    clones.candidates += 1
    const clone = new Element()
    for (const field of ['display-name', 'headline', 'match-reason', 'location', 'availability', 'rate']) {
      clone.queries.set(`[data-ai-recruiter-field="${field}"]`, new Element())
    }
    clone.queries.set('[data-ai-recruiter-field="profile-link"]', new Element())
    return clone
  }

  const values = new Map([
    ['[data-ai-recruiter="launcher"]', launcher],
    ['[data-ai-recruiter="panel"]', panel],
    ['[data-ai-recruiter="form"]', form],
    ['[data-ai-recruiter="input"]', input],
    ['[data-ai-recruiter="submit"]', submit],
    ['[data-ai-recruiter="messages"]', messages],
    ['[data-ai-recruiter="message-template"]', messageTemplate],
    ['[data-ai-recruiter="candidate-template"]', candidateTemplate],
    ['[data-ai-recruiter="candidate-list"]', candidates],
    ['[data-ai-recruiter="status"]', status],
    ['[data-ai-recruiter="consent"]', consent],
    ['[data-ai-recruiter="consent-indicator"]', consentIndicator],
    ['[data-ai-recruiter="consent-continue"]', consentContinue],
    ['[data-ai-recruiter="start-over"]', startOver],
    ['[data-ai-recruiter-state]', states],
  ])
  root.queries = values
  return { root, form, input, messages, candidates, status, consent, consentIndicator, consentContinue, startOver, clones }
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function load(options = {}) {
  const fixture = makeFixture(options)
  const stored = new Map(Object.entries(options.storage || {}))
  let uuid = 0
  const requests = []
  const events = []
  const member = options.member || {
    id: 'member-current',
    planConnections: [{ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }],
  }
  const memberstack = options.memberstack || { onAuthChange(listener) { this.authListener = listener } }
  const taskSetTimeout = options.setTimeout || setTimeout
  const taskClearTimeout = options.clearTimeout || clearTimeout
  const window = {
    crypto: { randomUUID: () => `test-id-${++uuid}` },
    memberReady: options.memberReady || Promise.resolve(member),
    $memberstackDom: memberstack,
    getXanoAuthToken: Object.hasOwn(options, 'getXanoAuthToken')
      ? options.getXanoAuthToken
      : async () => 'xano-token',
    sessionStorage: {
      getItem(key) {
        if (options.blockStorage) throw new Error('blocked')
        return stored.get(key) || null
      },
      setItem(key, value) {
        if (options.blockStorage) throw new Error('blocked')
        stored.set(key, value)
      },
    },
    setTimeout: taskSetTimeout,
    clearTimeout: taskClearTimeout,
    requestAnimationFrame(callback) { callback() },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail } },
    dispatchEvent(event) { events.push(event) },
    location: {
      hostname: options.hostname || 'thestarters.com',
      reload() { window.reloaded = true },
    },
  }
  const document = {
    readyState: 'complete',
    querySelectorAll(selector) { return selector === '[data-ai-recruiter="root"]' ? [fixture.root] : [] },
    createElement() { throw new Error('controller must use native templates') },
  }
  const fetch = async (url, init = {}) => {
    requests.push({ url, ...init })
    if (options.fetch) return options.fetch(url, init)
    return response({ status: 'recommendations', message: 'Three matches', trace_id: 'trace-1', session_id: 'server-session', top_candidates: [{ freelancer_v3_id: 7, slug: 'ada' }] })
  }
  script.runInNewContext({ window, document, fetch, console, AbortController, navigator: { onLine: true }, encodeURIComponent, setTimeout, clearTimeout })
  return { api: window.StartersAIRecruiter, fixture, requests, stored, window, events }
}

test('only explicitly active paid Brand plans grant access', () => {
  const { api } = load()
  const role = (connection, hostname = 'thestarters.com') => api.roleForMember(
    { planConnections: [connection] }, hostname,
  )
  assert.equal(role({ planId: 'pln_new-paid-plan-463h04ph', active: true }), 'brand-paid')
  assert.equal(role({ planId: 'pln_new-paid-plan-463h04ph', status: 'ACTIVE' }), 'brand-paid')
  assert.equal(role({ planId: 'pln_new-paid-plan-463h04ph', active: false }), 'ineligible')
  assert.equal(role({ planId: 'pln_new-paid-plan-463h04ph', status: 'CANCELED' }), 'ineligible')
  assert.equal(role({ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }), 'brand-free')
  assert.equal(
    role({ planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' }),
    'ineligible',
  )
  assert.equal(
    role(
      { planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' },
      'the-starters-3-0.webflow.io',
    ),
    'brand-paid',
  )
  assert.equal(
    role({ planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' }, 'localhost'),
    'ineligible',
  )
  assert.equal(
    role({ planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' }, '127.0.0.1'),
    'ineligible',
  )
})

test('Brand Free sees the upgrade state with no interactive request path', async () => {
  const loaded = load({
    member: {
      id: 'free-brand',
      planConnections: [{ planId: 'pln_free-plan-f6kn0dxz', status: 'ACTIVE' }],
    },
  })
  await flush()

  assert.equal(loaded.fixture.root.hidden, false)
  assert.equal(loaded.fixture.root.dataset.aiRecruiterState, 'upgrade')
  assert.equal(loaded.fixture.form.hidden, true)
  assert.equal(loaded.fixture.input.disabled, true)
  assert.equal(loaded.fixture.startOver.hidden, true)
  assert.equal(loaded.fixture.startOver.disabled, true)
  loaded.fixture.input.value = 'This must not send'
  await loaded.fixture.form.dispatch('submit')
  await loaded.fixture.startOver.dispatch('click')
  await flush()
  assert.equal(loaded.fixture.root.dataset.aiRecruiterState, 'upgrade')
  assert.equal(loaded.requests.length, 0)
})

test('a Test Brand plan fails closed on production', async () => {
  const loaded = load({
    hostname: 'www.thestarters.com',
    member: {
      id: 'test-brand-production',
      planConnections: [{ planId: 'pln_dorxata-test-brand-plan-777r02pa', status: 'ACTIVE' }],
    },
  })
  await flush()

  assert.equal(loaded.fixture.root.hidden, true)
  assert.equal(loaded.requests.length, 0)
})

test('normalization filters canonical IDs before taking three candidates', () => {
  const { api } = load()
  const result = api.normalizeResponse({
    status: 'recommendations',
    message: 'Matches',
    top_candidates: [
      { freelancer_v3_id: 0 },
      { freelancer_v3_id: 1 },
      { freelancer_v3_id: 2 },
      { freelancer_v3_id: 3 },
      { freelancer_v3_id: 4 },
    ],
  })
  assert.deepEqual(Array.from(result.top_candidates, (item) => item.freelancer_v3_id), [1, 2, 3])
})

test('message requests use authenticated Xano and clone native templates', async () => {
  const loaded = load()
  await flush()
  loaded.fixture.consent.checked = true
  await loaded.fixture.consentContinue.dispatch('click')
  loaded.fixture.input.value = 'Find a designer'
  await loaded.fixture.form.dispatch('submit')
  await flush()

  assert.equal(loaded.requests.length, 1)
  assert.equal(loaded.requests[0].url, 'https://x08a-5ko8-jj1r.n7c.xano.io/api:opp30/ai-recruiter/message')
  assert.equal(loaded.requests[0].headers.Authorization, 'Bearer xano-token')
  assert.equal(loaded.fixture.clones.messages, 2)
  assert.equal(loaded.fixture.clones.candidates, 1)
  assert.equal(loaded.fixture.candidates.children[0].dataset.freelancerV3Id, '7')
})

test('fallback token exchange carries the request cancellation signal', async () => {
  const calls = []
  const loaded = load({
    getXanoAuthToken: undefined,
    memberstack: {
      async getMemberCookie() { return 'member-token' },
      onAuthChange(listener) { this.authListener = listener },
    },
    fetch: (url, init) => {
      calls.push({ url, init })
      return url.includes('/auth/trade-token/v3')
        ? response({ authToken: 'fallback-xano-token' })
        : response({ status: 'recommendations', message: 'Matches' })
    },
  })
  await flush()
  loaded.fixture.consent.checked = true
  await loaded.fixture.consentContinue.dispatch('click')
  loaded.fixture.input.value = 'Find a writer'
  await loaded.fixture.form.dispatch('submit')
  await flush()

  assert.equal(calls.length, 2)
  assert.equal(calls[0].init.signal instanceof AbortSignal, true)
  assert.equal(calls[1].init.headers.Authorization, 'Bearer fallback-xano-token')
})

test('the request timeout also bounds shared token acquisition', async () => {
  const realTimers = new Map()
  let timerId = 0
  const loaded = load({
    getXanoAuthToken: () => new Promise(() => {}),
    setTimeout(callback, delay) {
      const id = ++timerId
      if (delay === 35000) queueMicrotask(callback)
      else realTimers.set(id, setTimeout(callback, delay))
      return id
    },
    clearTimeout(id) {
      if (realTimers.has(id)) clearTimeout(realTimers.get(id))
      realTimers.delete(id)
    },
  })
  await flush()
  loaded.fixture.consent.checked = true
  await loaded.fixture.consentContinue.dispatch('click')
  loaded.fixture.input.value = 'Find an editor'
  await loaded.fixture.form.dispatch('submit')
  await flush()

  assert.equal(loaded.fixture.root.dataset.aiRecruiterState, 'retry')
  assert.equal(loaded.fixture.status.textContent, 'The search timed out. Please try again.')
})

test('stored consent is member and version scoped with blocked-storage fallback', async () => {
  const previous = JSON.stringify({
    session_id: 'other-session', consented: true, member_id: 'member-other', consent_version: '2026-08-11',
  })
  const loaded = load({ storage: { [STORAGE_KEY]: previous } })
  await flush()
  assert.equal(loaded.fixture.root.dataset.aiRecruiterState, 'consent')
  assert.equal(JSON.parse(loaded.stored.get(STORAGE_KEY)).member_id, 'member-current')

  const blocked = load({ blockStorage: true })
  await flush()
  assert.equal(blocked.fixture.root.hidden, false)
  assert.equal(blocked.fixture.root.dataset.aiRecruiterState, 'consent')
})

test('native role checkbox toggles consent before continuing', async () => {
  const loaded = load({ consentRole: 'checkbox' })
  await flush()

  assert.equal(loaded.fixture.root.dataset.aiRecruiterState, 'consent')
  assert.equal(loaded.fixture.consent.getAttribute('aria-checked'), 'false')
  assert.equal(loaded.fixture.consentIndicator.textContent, '☐')
  await loaded.fixture.consent.dispatch('click')
  assert.equal(loaded.fixture.consent.getAttribute('aria-checked'), 'true')
  assert.equal(loaded.fixture.consentIndicator.textContent, '☑')
  await loaded.fixture.consent.dispatch('click')
  assert.equal(loaded.fixture.consent.getAttribute('aria-checked'), 'false')
  assert.equal(loaded.fixture.consentIndicator.textContent, '☐')
  await loaded.fixture.consent.dispatch('click')
  await loaded.fixture.consentContinue.dispatch('click')
  assert.equal(loaded.fixture.root.dataset.aiRecruiterState, 'ready')
})

test('start over invalidates an in-flight response', async () => {
  let resolveMessage
  const pendingMessage = new Promise((resolve) => { resolveMessage = resolve })
  const loaded = load({
    fetch: (url) => url.endsWith('/message')
      ? pendingMessage
      : response({ status: 'ok' }),
  })
  await flush()
  loaded.fixture.consent.checked = true
  await loaded.fixture.consentContinue.dispatch('click')
  loaded.fixture.input.value = 'Old request'
  await loaded.fixture.form.dispatch('submit')
  await flush()
  await loaded.fixture.startOver.dispatch('click')
  resolveMessage(response({ status: 'recommendations', message: 'Stale answer', session_id: 'stale-session' }))
  await flush()

  assert.equal(loaded.fixture.messages.children.length, 0)
  assert.notEqual(JSON.parse(loaded.stored.get(STORAGE_KEY)).session_id, 'stale-session')
  assert.equal(loaded.fixture.root.dataset.aiRecruiterState, 'ready')
})

test('auth changes reload instead of retaining another member session', async () => {
  const loaded = load()
  await flush()
  loaded.window.$memberstackDom.authListener({ id: 'member-other' })
  assert.equal(loaded.window.reloaded, true)
})
