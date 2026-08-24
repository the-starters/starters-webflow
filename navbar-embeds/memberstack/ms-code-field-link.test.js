'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, 'ms-code-field-link.js'), 'utf8')

class Link {
  constructor(attributes) {
    this.attributes = new Map(Object.entries(attributes || {}))
    this.style = {}
    this.href = this.attributes.get('href') || ''
    this.target = this.attributes.get('target') || ''
    this.rel = this.attributes.get('rel') || ''
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    if (name === 'target') this.target = ''
    if (name === 'rel') this.rel = ''
  }
}

function load(options) {
  const links = options.links || []
  const listeners = new Map()
  const requests = []
  const context = {
    URL,
    Date,
    Promise,
    setTimeout,
    document: {
      addEventListener(type, listener) {
        listeners.set(type, listener)
      },
      querySelectorAll(selector) {
        assert.equal(selector, '[ms-code-field-link]')
        return links
      },
    },
    localStorage: {
      getItem(key) {
        assert.equal(key, '_ms-mem')
        return JSON.stringify(options.member || {})
      },
    },
    fetch: async (url, init) => {
      requests.push({ url, init })
      return options.response || { ok: true, json: async () => ({ slug: 'jp-dionisio' }) }
    },
  }
  context.window = context
  if (options.memberstack !== false) {
    context.$memberstackDom = options.memberstack || {
      getCurrentMember: async () => ({ data: options.currentMember || options.member || null }),
    }
  }

  vm.runInNewContext(SOURCE, context)
  listeners.get('DOMContentLoaded')()
  return { context, links, requests }
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
  })
  const result = load({
    links: [link],
    member: {
      id: 'mem_stale123',
      customFields: { 'freelancer-profile-url': 'https://hirethestarters.com/freelancers-v2/123' },
    },
    currentMember: { id: 'mem_live456' },
  })

  assert.equal(link.style.display, 'none')
  await flush()

  assert.equal(result.requests.length, 1)
  assert.deepEqual(JSON.parse(result.requests[0].init.body), { member_id: 'mem_live456' })
  assert.equal(link.href, '/hire/jp-dionisio')
  assert.equal(link.target, '')
  assert.equal(link.rel, '')
  assert.equal(link.style.display, '')
})

test('View Profile stays hidden until delayed Memberstack readiness resolves', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  const result = load({ links: [link], member: { id: 'mem_stale123' }, memberstack: false })

  assert.equal(link.style.display, 'none')
  assert.equal(result.requests.length, 0)
  result.context.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: 'mem_live456' } }),
  }

  await new Promise((resolve) => setTimeout(resolve, 125))
  await flush()
  assert.equal(result.requests.length, 1)
  assert.deepEqual(JSON.parse(result.requests[0].init.body), { member_id: 'mem_live456' })
  assert.equal(link.href, '/hire/jp-dionisio')
  assert.equal(link.style.display, '')
})

test('View Profile stays hidden when no published V3 slug exists', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'freelancer-profile-url' })
  load({
    links: [link],
    member: {
      id: 'mem_abc123',
      customFields: { 'freelancer-profile-url': 'https://hirethestarters.com/freelancers-v2/123' },
    },
    response: { ok: true, json: async () => ({ slug: '' }) },
  })

  await flush()
  assert.equal(link.href, '#')
  assert.equal(link.style.display, 'none')
})

test('other member-field links keep their existing external-link behavior', async () => {
  const link = new Link({ href: '#', 'ms-code-field-link': 'billing-url' })
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
  assert.equal(link.style.display, '')
})

test('a real static profile link remains authoritative', async () => {
  const link = new Link({ href: '/hire/static-profile', 'ms-code-field-link': 'freelancer-profile-url' })
  const result = load({ links: [link], member: { id: 'mem_abc123' } })

  await flush()
  assert.equal(result.requests.length, 0)
  assert.equal(link.href, '/hire/static-profile')
})
