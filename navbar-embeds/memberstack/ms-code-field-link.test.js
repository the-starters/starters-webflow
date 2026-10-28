'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'ms-code-field-link.js'), 'utf8')

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class Link {
  constructor(attributes) {
    this.attributes = new Map(Object.entries(attributes || {}))
    this.style = {}
    this.href = this.attributes.get('href') || ''
    this.target = this.attributes.get('target') || ''
    this.rel = this.attributes.get('rel') || ''
    this.textContent = this.attributes.get('textContent') || 'View Profile'
    this.isConnected = true
    this.classes = new Set()
    this.listeners = new Map()
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    if (name === 'href') this.href = ''
    if (name === 'target') this.target = ''
    if (name === 'rel') this.rel = ''
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'href') this.href = String(value)
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  matches(selector) {
    assert.equal(selector, '[ms-code-field-link]')
    return this.attributes.has('ms-code-field-link')
  }

  querySelectorAll(selector) {
    assert.equal(selector, '[ms-code-field-link]')
    return []
  }

  click() {
    const event = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      stopPropagation() {
        this.propagationStopped = true
      },
    }
    const listener = this.listeners.get('click')
    if (listener) listener(event)
    return event
  }
}

function load(options) {
  const links = options.links || []
  const listeners = new Map()
  const observers = []
  const requests = []
  const timers = []
  let fetchesPending = 0
  let maxFetchesPending = 0
  const context = {
    URL,
    Date: options.Date || Date,
    Promise,
    setTimeout(callback, delay) {
      timers.push({ callback, delay })
      return timers.length
    },
    document: {
      readyState: options.readyState || 'loading',
      hidden: options.hidden === true,
      documentElement: {},
      addEventListener(type, listener) {
        listeners.set(type, listener)
      },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type)
      },
      querySelectorAll(selector) {
        assert.equal(selector, '[ms-code-field-link]')
        return links
      },
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
        observers.push(this)
      }

      observe() {}
    },
    localStorage: {
      getItem(key) {
        assert.equal(key, '_ms-mem')
        return JSON.stringify(options.member || {})
      },
    },
    fetch: async (url, init) => {
      requests.push({ url, init })
      fetchesPending += 1
      maxFetchesPending = Math.max(maxFetchesPending, fetchesPending)
      try {
        if (options.fetch) return await options.fetch(url, init)
        if (options.responses && options.responses.length) return options.responses.shift()
        return options.response || { ok: true, json: async () => ({ slug: 'jp-dionisio' }) }
      } finally {
        fetchesPending -= 1
      }
    },
  }
  context.window = context
  context.memberReady = options.memberReady || Promise.resolve({})
  if (options.memberstack !== false) {
    context.$memberstackDom = options.memberstack || {
      getCurrentMember: async () => ({ data: options.currentMember || options.member || null }),
    }
  }

  vm.runInNewContext(SOURCE, context)
  if (context.document.readyState === 'loading') listeners.get('DOMContentLoaded')()
  return {
    context,
    listeners,
    links,
    requests,
    timers,
    maxFetchesPending: () => maxFetchesPending,
    addLink(link) {
      links.push(link)
      observers.forEach((observer) => {
        observer.callback([{ addedNodes: [link] }])
      })
    },
  }
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

test('View Profile waits for live Memberstack identity and ignores a stale member cache', async () => {
  const link = new Link({
    href: '#',
    target: '_blank',
    rel: 'noopener noreferrer',
    'ms-code-field-link': 'freelancer-profile-url',
    'data-class-disabled': '.is-disabled',
  })
  const result = load({
    links: [link],
    member: {
      id: 'mem_stale123',
      customFields: { 'freelancer-profile-url': 'https://hirethestarters.com/freelancers-v2/123' },
    },
    currentMember: { id: 'mem_live456' },
  })

  assert.equal(link.style.display, '')
  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(link.classList.contains('is-disabled'), true)
  assert.equal(link.getAttribute('aria-disabled'), 'true')
  assert.equal(link.getAttribute('href'), null)
  assert.equal(link.target, '')
  assert.equal(link.rel, '')
  await flush()

  assert.equal(result.requests.length, 1)
  assert.deepEqual(JSON.parse(result.requests[0].init.body), { member_id: 'mem_live456' })
  assert.equal(link.href, '/hire/jp-dionisio')
  assert.equal(link.target, '')
  assert.equal(link.rel, '')
  assert.equal(link.style.display, '')
  assert.equal(link.textContent, 'View Profile')
  assert.equal(link.classList.contains('is-disabled'), false)
  assert.equal(link.getAttribute('aria-disabled'), null)
})

test('View Profile awaits memberReady before reading the live Memberstack identity', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  const memberReady = deferred()
  let currentMemberReads = 0
  const result = load({
    links: [link],
    member: { id: 'mem_stale123' },
    memberReady: memberReady.promise,
    memberstack: {
      getCurrentMember: async () => {
        currentMemberReads += 1
        return { data: { id: 'mem_live456' } }
      },
    },
  })

  assert.equal(link.style.display, '')
  await flush()
  assert.equal(currentMemberReads, 0)
  assert.equal(result.requests.length, 0)

  memberReady.resolve({ id: 'mem_stale123' })
  await flush()
  assert.equal(currentMemberReads, 1)
  assert.equal(result.requests.length, 1)
  assert.deepEqual(JSON.parse(result.requests[0].init.body), { member_id: 'mem_live456' })
  assert.equal(link.href, '/hire/jp-dionisio')
  assert.equal(link.style.display, '')
})

test('View Profile stays in publishing state for an empty resolver result and then activates', async () => {
  const link = new Link({
    href: '#',
    'ms-code-field-link': 'freelancer-profile-url',
    'data-class-disabled': '.is-disabled',
  })
  const result = load({
    links: [link],
    member: {
      id: 'mem_abc123',
      customFields: { 'freelancer-profile-url': 'https://hirethestarters.com/freelancers-v2/123' },
    },
    responses: [
      { ok: true, json: async () => ({ slug: '' }) },
      { ok: true, json: async () => ({ slug: 'new-starter' }) },
    ],
  })

  await flush()
  assert.equal(link.href, '')
  assert.equal(link.getAttribute('href'), null)
  assert.equal(link.style.display, '')
  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(link.classList.contains('is-disabled'), true)
  assert.equal(link.getAttribute('aria-disabled'), 'true')
  const disabledClick = link.click()
  assert.equal(disabledClick.defaultPrevented, true)
  assert.equal(disabledClick.propagationStopped, true)
  assert.equal(result.timers.length, 1)
  assert.equal(result.timers[0].delay, 10000)

  result.timers.shift().callback()
  await flush()

  assert.equal(result.requests.length, 2)
  assert.equal(link.href, '/hire/new-starter')
  assert.equal(link.textContent, 'View Profile')
  assert.equal(link.classList.contains('is-disabled'), false)
  assert.equal(link.getAttribute('aria-disabled'), null)
  assert.equal(link.click().defaultPrevented, false)
  assert.equal(result.timers.length, 0)
})

test('View Profile retries a late Memberstack arrival without changing its authored label', async () => {
  const link = new Link({
    href: '#',
    textContent: 'View Profile',
    'ms-code-field-link': 'freelancer-profile-url',
    'data-class-disabled': '.is-disabled',
  })
  const result = load({ links: [link], memberstack: false })

  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(link.href, '')
  await flush()
  assert.equal(result.requests.length, 0)
  assert.equal(result.timers.length, 1)
  assert.equal(result.timers[0].delay, 100)
  result.context.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem_late123' } }),
  }
  result.timers.shift().callback()
  await flush()

  assert.equal(result.requests.length, 1)
  assert.equal(link.href, '/hire/jp-dionisio')
})

test('View Profile recovers when getCurrentMember initially rejects', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  let reads = 0
  const result = load({
    links: [link],
    memberstack: {
      getCurrentMember: async () => {
        reads += 1
        if (reads === 1) throw new Error('temporary Memberstack failure')
        return { data: { id: 'mem_retry123' } }
      },
    },
  })

  await flush()
  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(result.requests.length, 0)
  assert.equal(result.timers.length, 1)
  result.timers.shift().callback()
  await flush()

  assert.equal(reads, 2)
  assert.equal(result.requests.length, 1)
  assert.equal(link.href, '/hire/jp-dionisio')
})

test('View Profile recovers from a resolver failure with one non-overlapping retry', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  const firstResponse = deferred()
  const result = load({
    links: [link],
    currentMember: { id: 'mem_retry123' },
    fetch: async () => {
      if (result.requests.length === 1) return firstResponse.promise
      return { ok: true, json: async () => ({ slug: 'recovered-profile' }) }
    },
  })

  await flush()
  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(result.requests.length, 1)
  assert.equal(result.timers.length, 0)
  firstResponse.resolve({ ok: false })
  await flush()

  assert.equal(result.timers.length, 1)
  assert.equal(result.timers[0].delay, 10000)
  result.timers.shift().callback()
  await flush()

  assert.equal(result.requests.length, 2)
  assert.equal(result.maxFetchesPending(), 1)
  assert.equal(link.href, '/hire/recovered-profile')
  assert.equal(result.timers.length, 0)
})

test('View Profile watcher stops when its link is disconnected', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  const result = load({
    links: [link],
    currentMember: { id: 'mem_disconnect123' },
    response: { ok: true, json: async () => ({ slug: '' }) },
  })

  await flush()
  assert.equal(result.timers.length, 1)
  link.isConnected = false
  result.timers.shift().callback()
  await flush()

  assert.equal(result.requests.length, 1)
  assert.equal(result.timers.length, 0)
})

test('other member-field links keep their existing external-link behavior', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'billing-url' })
  link.style.display = 'none'
  const result = load({
    links: [link],
    member: {
      id: 'mem_abc123',
      customFields: { 'billing-url': 'account.example/settings' },
    },
  })

  await flush()
  assert.equal(result.requests.length, 0)
  assert.equal(link.href, 'https://account.example/settings')
  assert.equal(link.target, '_blank')
  assert.equal(link.rel, 'noopener noreferrer')
  assert.equal(link.style.display, 'none')
})

test('a real static profile link remains authoritative', async () => {
  const link = new Link({ href: '/hire/static-profile', 'ms-code-field-link': 'freelancer-profile-url' })
  const result = load({ links: [link], member: { id: 'mem_abc123' } })

  await flush()
  assert.equal(result.requests.length, 0)
  assert.equal(link.href, '/hire/static-profile')
})

test('View Profile binds when the script loads after DOMContentLoaded', async () => {
  const link = new Link({
    href: '#',
    'ms-code-field-link': 'freelancer-profile-url',
    'data-class-disabled': '.is-disabled',
  })
  const result = load({
    links: [link],
    readyState: 'complete',
    currentMember: { id: 'mem_afterdom123' },
    response: { ok: true, json: async () => ({ slug: '' }) },
  })

  assert.equal(link.style.display, '')
  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(link.classList.contains('is-disabled'), true)
  assert.equal(link.getAttribute('aria-disabled'), 'true')
  await flush()
  assert.equal(result.requests.length, 1)
})

test('View Profile binds when the navbar link is added after startup', async () => {
  const result = load({
    links: [],
    readyState: 'complete',
    currentMember: { id: 'mem_latenav123' },
    response: { ok: true, json: async () => ({ slug: '' }) },
  })
  const link = new Link({
    href: '#',
    'ms-code-field-link': 'freelancer-profile-url',
    'data-class-disabled': '.is-disabled',
  })

  result.addLink(link)

  assert.equal(link.style.display, '')
  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(link.classList.contains('is-disabled'), true)
  assert.equal(link.getAttribute('aria-disabled'), 'true')
  await flush()
  assert.equal(result.requests.length, 1)
})

function fakeClock() {
  let now = 1_000_000
  class FakeDate extends Date {
    static now() {
      return now
    }
  }
  return {
    Date: FakeDate,
    advance(ms) {
      now += ms
    },
  }
}

async function runTimer(result, clock) {
  const timer = result.timers.shift()
  clock.advance(timer.delay)
  timer.callback()
  await flush()
  return timer.delay
}

test('View Profile backs off to 60 s after five tries and stops after about 10 minutes', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  const clock = fakeClock()
  const result = load({
    links: [link],
    Date: clock.Date,
    currentMember: { id: 'mem_slow123' },
    response: { ok: true, json: async () => ({ slug: '' }) },
  })

  await flush()
  const delays = []
  while (result.timers.length) delays.push(await runTimer(result, clock))

  // Five tries 10 s apart, then one try per 60 s.
  assert.deepEqual(delays.slice(0, 4), [10000, 10000, 10000, 10000])
  assert.ok(delays.slice(4).every((delay) => delay === 60000))
  const elapsed = delays.reduce((sum, delay) => sum + delay, 0)
  assert.ok(elapsed >= 10 * 60 * 1000 && elapsed < 11 * 60 * 1000, 'polling stops after about 10 minutes')
  assert.equal(result.requests.length, delays.length + 1)
  assert.ok(result.requests.length <= 15, 'one page view makes at most 15 resolver calls')
  assert.equal(link.textContent, 'View Profile (Publishing)')
  assert.equal(link.getAttribute('aria-disabled'), 'true')
})

test('View Profile does not poll while the tab is hidden and resumes when it is visible', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  const result = load({
    links: [link],
    hidden: true,
    currentMember: { id: 'mem_hidden123' },
    responses: [
      { ok: true, json: async () => ({ slug: '' }) },
      { ok: true, json: async () => ({ slug: 'visible-profile' }) },
    ],
  })

  await flush()
  assert.equal(result.requests.length, 0)
  assert.equal(result.timers.length, 0)
  assert.equal(link.textContent, 'View Profile (Publishing)')

  result.context.document.hidden = false
  result.listeners.get('visibilitychange')()
  await flush()
  assert.equal(result.requests.length, 1)
  assert.equal(result.listeners.has('visibilitychange'), false)

  result.context.document.hidden = true
  result.timers.shift().callback()
  await flush()
  assert.equal(result.requests.length, 1, 'a timer that fires in a hidden tab does not fetch')

  result.context.document.hidden = false
  result.listeners.get('visibilitychange')()
  await flush()
  assert.equal(result.requests.length, 2)
  assert.equal(link.href, '/hire/visible-profile')
})
