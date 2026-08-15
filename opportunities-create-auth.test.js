const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./opportunities---create.js'), 'utf8')

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await new Promise(setImmediate)
  }
  assert.equal(predicate(), true)
}

test('logged-out opportunity creation retains the requested path and query', async () => {
  let submit
  const form = {
    addEventListener(type, listener) {
      if (type === 'submit') submit = listener
    },
    querySelector() {
      return null
    },
  }
  const location = {
    href: '',
    pathname: '/opportunities---create',
    search: '?from=brand-dashboard',
  }
  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({ data: null }),
    },
    Opp30: { API: {} },
  }
  const document = {
    querySelector(selector) {
      return selector === '[data-opp-form="create"]' ? form : null
    },
    readyState: 'complete',
  }

  vm.runInNewContext(source, {
    HTMLInputElement: class HTMLInputElement {},
    HTMLSelectElement: class HTMLSelectElement {},
    console: { error() {}, info() {}, log() {} },
    document,
    encodeURIComponent,
    location,
    window,
  })

  assert.equal(typeof submit, 'function')
  await submit({
    preventDefault() {},
    stopImmediatePropagation() {},
    stopPropagation() {},
  })

  assert.equal(
    location.href,
    '/login?next=%2Fopportunities---create%3Ffrom%3Dbrand-dashboard',
  )
})

test('successful opportunity creation returns to the published opportunities page', async () => {
  let submit
  let createCalls = 0
  const member = deferred()
  const created = deferred()
  const form = {
    addEventListener(type, listener) {
      if (type === 'submit') submit = listener
    },
    querySelector() {
      return null
    },
  }
  const location = {
    href: '',
    pathname: '/opportunities',
    search: '',
  }
  const window = {
    $memberstackDom: {
      getCurrentMember: () => member.promise,
    },
    Opp30: {
      API: {
        brandOppCreate: async () => {
          createCalls += 1
          return created.promise
        },
      },
      prepareOpportunityCreateForms() {},
      readOpportunityForm: () => ({ title: 'V3 canary' }),
      validateOpportunityPayload: () => '',
    },
  }
  const document = {
    querySelector(selector) {
      return selector === '[data-opp-form="create"]' ? form : null
    },
    readyState: 'complete',
  }

  vm.runInNewContext(source, {
    HTMLInputElement: class HTMLInputElement {},
    HTMLSelectElement: class HTMLSelectElement {},
    console: { error() {}, info() {}, log() {} },
    document,
    encodeURIComponent,
    location,
    window,
  })

  assert.equal(typeof submit, 'function')
  const event = {
    preventDefault() {},
    stopImmediatePropagation() {},
    stopPropagation() {},
  }
  const firstSubmit = submit(event)
  const duplicateSubmit = submit(event)

  member.resolve({ data: { id: 'mem_live_brand_canary' } })
  await waitFor(() => createCalls === 1)

  assert.equal(createCalls, 1)
  assert.equal(location.href, '')

  created.resolve({ id: 123 })
  await Promise.all([firstSubmit, duplicateSubmit])

  assert.equal(createCalls, 1)
  assert.equal(location.href, '/opportunities')
})
