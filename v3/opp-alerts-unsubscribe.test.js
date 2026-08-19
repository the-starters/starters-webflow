const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.join(__dirname, 'opp-alerts-unsubscribe.js'),
  'utf8',
)

function element() {
  const attributes = new Map()
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    listeners: {},
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    getAttribute(name) {
      return attributes.get(name) || null
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener
    },
  }
}

function boot(search, fetchImpl) {
  const parts = {
    intro: element(),
    unsub: element(),
    resub: element(),
    status: element(),
  }
  parts.unsub.textContent = 'Unsubscribe me'
  parts.resub.textContent = 'Re-subscribe'
  parts.resub.hidden = true

  const root = element()
  root.querySelector = (selector) => {
    const match = selector.match(/data-oa="([^"]+)"/)
    return match ? parts[match[1]] : null
  }

  const context = {
    Boolean,
    Error,
    JSON,
    URLSearchParams,
    fetch: fetchImpl,
    window: { location: { search } },
    document: {
      readyState: 'complete',
      getElementById: (id) => (id === 'oa-unsub' ? root : null),
    },
  }
  vm.runInNewContext(source, context)
  return { parts, root }
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve))
}

test('unsubscribes and re-subscribes the member from the email link', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => ({ ok: true }) }
  }
  const { parts } = boot('?m=owned-member', fetchImpl)

  parts.unsub.listeners.click()
  await flushPromises()

  assert.equal(requests.length, 1)
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    memberstack_id: 'owned-member',
    resubscribe: false,
  })
  assert.equal(parts.unsub.hidden, true)
  assert.equal(parts.resub.hidden, false)
  assert.equal(parts.status.getAttribute('data-state'), 'ok')

  parts.resub.listeners.click()
  await flushPromises()

  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    memberstack_id: 'owned-member',
    resubscribe: true,
  })
  assert.equal(parts.resub.hidden, true)
  assert.equal(parts.status.getAttribute('data-state'), 'ok')
})

test('does not send when the emailed link has no member identifier', () => {
  let requests = 0
  const { parts } = boot('', async () => {
    requests += 1
    return { ok: true, json: async () => ({ ok: true }) }
  })

  assert.equal(parts.unsub.hidden, true)
  assert.match(parts.intro.textContent, /missing its identifier/)
  assert.equal(requests, 0)
})

test('shows a retry state when Xano rejects the preference update', async () => {
  const { parts } = boot('?m=owned-member', async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  }))

  parts.unsub.listeners.click()
  await flushPromises()

  assert.equal(parts.unsub.disabled, false)
  assert.equal(parts.unsub.textContent, 'Unsubscribe me')
  assert.equal(parts.status.getAttribute('data-state'), 'err')
  assert.equal(parts.status.hidden, false)
})
