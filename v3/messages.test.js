const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(require.resolve('./messages.js'), 'utf8')

function loadMessages(options = {}) {
  const replacements = []
  const container = {}
  const window = {
    $memberstackDom: {
      getCurrentMember: async () => ({ data: options.member || null }),
    },
    addEventListener() {},
    location: {
      pathname: options.pathname || '/messages',
      search: options.search || '',
      replace(value) {
        replacements.push(value)
      },
    },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  }
  const document = {
    addEventListener() {},
    createElement() {
      return {}
    },
    getElementById(id) {
      return id === 'talkjs-container' ? container : null
    },
    head: { appendChild() {} },
    readyState: 'complete',
  }

  vm.runInNewContext(source, {
    URLSearchParams,
    console: { error() {} },
    document,
    encodeURIComponent,
    window,
  })

  return { replacements, window }
}

test('logged-out Messages visitors retain the requested path and query', async () => {
  const { replacements } = loadMessages({
    pathname: '/messages',
    search: '?conversation=brand-a',
  })

  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(replacements, [
    '/login?next=%2Fmessages%3Fconversation%3Dbrand-a',
  ])
})
