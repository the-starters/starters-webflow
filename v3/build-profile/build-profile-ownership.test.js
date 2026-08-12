const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const DIR = __dirname
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(DIR, 'live-body-provenance.json'), 'utf8'))
const PAGES = ['/build-profile/consult', '/build-profile/full-profile']

function source(file) {
  return fs.readFileSync(path.join(DIR, file), 'utf8')
}

function executableBody(file) {
  const text = source(file)
  const marker = text.indexOf('*/')
  assert.notEqual(marker, -1, `${file} metadata boundary`)
  return `\n${text.slice(marker + 3, -1)}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

test('both captured pages map the same nine live bodies to executable assets', () => {
  const expectedFiles = Object.keys(PROVENANCE.pages[PAGES[0]].scripts).sort()
  assert.equal(expectedFiles.length, 9)

  for (const page of PAGES) {
    const observations = PROVENANCE.pages[page].scripts
    assert.deepEqual(Object.keys(observations).sort(), expectedFiles)
    const indexes = Object.values(observations).map(({ index }) => index)
    assert.equal(new Set(indexes).size, indexes.length)

    for (const file of expectedFiles) {
      const body = executableBody(file)
      assert.equal(body.length, observations[file].characters, `${page} ${file} characters`)
      assert.equal(sha256(body), observations[file].sha256, `${page} ${file} hash`)
    }
  }
})

test('each captured controller remains valid as a standalone classic script', () => {
  for (const file of Object.keys(PROVENANCE.pages[PAGES[0]].scripts)) {
    assert.doesNotThrow(() => new vm.Script(source(file), { filename: file }), file)
  }
})

test('controllers boot against native markup without creating forms or excluded requests', async () => {
  for (const file of Object.keys(PROVENANCE.pages[PAGES[0]].scripts)) {
    const listeners = []
    const created = []
    const requests = []
    const document = {
      addEventListener(type, listener) { listeners.push({ type, listener }) },
      createElement(tag) { created.push(tag); return { addEventListener() {}, style: {} } },
      querySelector() { return null },
      querySelectorAll() { return [] },
    }
    const ready = (callback) => listeners.push({ type: 'DOMContentLoaded', listener: callback })
    const dollar = () => ({ ready, each() {}, find: () => ({ each() {} }) })
    const window = {
      addEventListener() {},
      document,
      fetch: async (url) => { requests.push(String(url)); return { ok: true, json: async () => ({}) } },
      setTimeout,
    }
    const context = vm.createContext({
      $: dollar, console, document, fetch: window.fetch, fillRefLists: async () => {}, FormData,
      groupDropdownOptions() {}, qs: document.querySelector, qsa: document.querySelectorAll,
      setTimeout, URL, waitForMember() {}, window,
    })

    new vm.Script(source(file), { filename: file }).runInContext(context)
    for (const { type, listener } of listeners) {
      if (type === 'DOMContentLoaded') await listener()
    }

    assert.equal(created.includes('form'), false, `${file} created a form`)
    assert.equal(requests.some((url) => /availability|booking|paid[_-]?call|free-consulting/i.test(url)), false, file)
  }
})

test('controllers exclude browser-exposed integration secrets', () => {
  for (const file of Object.keys(PROVENANCE.pages[PAGES[0]].scripts)) {
    assert.doesNotMatch(
      source(file),
      /api\.airtable\.com|hook\.us1\.make\.com|\bpat[A-Za-z0-9]{20,}/,
      file,
    )
  }
})
