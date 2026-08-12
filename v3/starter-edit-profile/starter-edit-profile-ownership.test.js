const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const DIR = __dirname
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(DIR, 'live-body-provenance.json'), 'utf8'))

function source(asset) {
  return fs.readFileSync(path.resolve(DIR, asset), 'utf8')
}

function executableBody(asset) {
  const text = source(asset)
  const marker = text.indexOf('*/')
  assert.notEqual(marker, -1, `${asset} metadata boundary`)
  return `\n${text.slice(marker + 3, -1)}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

test('captured live bodies map to six executable GitHub assets in original order', () => {
  const observations = Object.values(PROVENANCE.page.scripts)
  assert.equal(observations.length, 6)
  assert.deepEqual(observations.map(({ index }) => index), [84, 87, 88, 89, 90, 91])

  for (const observation of observations) {
    const body = executableBody(observation.asset)
    assert.equal(body.length, observation.characters, observation.asset)
    assert.equal(sha256(body), observation.sha256, observation.asset)
  }
})

test('each controller remains valid as a standalone classic script', () => {
  for (const { asset } of Object.values(PROVENANCE.page.scripts)) {
    assert.doesNotThrow(() => new vm.Script(source(asset), { filename: asset }), asset)
  }
})

test('controllers boot with an authenticated member and absent authored regions without writes', async () => {
  for (const { asset } of Object.values(PROVENANCE.page.scripts)) {
    const listeners = []
    const created = []
    const requests = []
    const document = {
      addEventListener(type, listener) { listeners.push({ type, listener }) },
      createElement(tag) { created.push(tag); return { addEventListener() {}, style: {} } },
      querySelector() { return null },
      querySelectorAll() { return [] },
    }
    const context = vm.createContext({
      activeProfile: {}, console, document, fetch: async (url) => { requests.push(String(url)); return { ok: true, json: async () => ({}) } },
      FormData, getXanoAuthToken: async () => 'test-token', logoSearchInit() {}, MEMBER: { id: 'test-member' },
      qs: document.querySelector, qsa: document.querySelectorAll, setTimeout, URL,
      waitForMember(callback) { return callback() }, window: { addEventListener() {}, document },
    })
    context.window.fetch = context.fetch

    new vm.Script(source(asset), { filename: asset }).runInContext(context)
    for (const { type, listener } of listeners) {
      if (type === 'DOMContentLoaded') await listener()
    }

    assert.equal(created.includes('form'), false, `${asset} created a form`)
    assert.deepEqual(requests, [], `${asset} wrote without its authored region`)
  }
})
