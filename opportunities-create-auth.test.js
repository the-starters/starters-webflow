const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./opportunities---create.js'), 'utf8')

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
