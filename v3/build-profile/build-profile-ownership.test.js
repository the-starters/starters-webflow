const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const DIR = __dirname
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(DIR, 'live-body-provenance.json'), 'utf8'))
const PAGES = ['/build-profile/consult', '/build-profile/full-profile']
const EXPECTED_CAPTURE = {
  capturedAt: '2026-08-12T11:12:45+08:00',
  siteId: '69c573f20f82bd0f3384032c',
  pages: {
    '/build-profile/consult': {
      pageId: '6a3e73ae5f60c547e5e9d041',
      lastUpdated: '2026-08-11T05:31:31.807Z',
      scripts: {
        'profile-photo.js': { index: 35, characters: 6026, sha256: '213646b19cc04f2b87375afeb303cc7ebe1f598cd5ffa4ce471b7c4ca895cf5c' },
        'portfolio-crud.js': { index: 36, characters: 37410, sha256: '7ab803c9890b802f154c6f5c3f0a6d5906624f71b9683153b2f5798617e1070d' },
        'portfolio-list.js': { index: 37, characters: 3590, sha256: 'ddbc94bf09e237e7fc016b73c3ab0a4f361e38ba5105840c4c568886841b3255' },
        'company-autocomplete.js': { index: 38, characters: 11677, sha256: 'eb426e9899ccfc9976c5eb061930f122d54542fa33f4453a0602aae48f842f4c' },
        'work-dates.js': { index: 39, characters: 1685, sha256: '4d8aa2dbd4c7668f37430a73c92049a7a5fa566d99915f5e45a61be5dac0c321' },
        'company-experience-crud.js': { index: 40, characters: 30068, sha256: '6dc7fa7306d9558fb493cb6a6cfd6196659e0b7005c6d49831ffcc5f3261b5d3' },
        'field-counters.js': { index: 46, characters: 4127, sha256: 'decbf5b49d1006f8a857602a33e2d89a6270fa8b9355d6311d16188f6a4bfe83' },
        'bio-editor.js': { index: 47, characters: 7604, sha256: '91671c4ed05806b2ed306f50c265954ef0c36714f59c77f721e2510370c9273f' },
        'grouped-selects.js': { index: 48, characters: 1405, sha256: 'e80bb01f28a43ebcb5b28e8ea733bac273985ddfa3235179cdfc6a9a5168ae84' },
      },
    },
    '/build-profile/full-profile': {
      pageId: '6a01b0ef0dd420942a5f964a',
      lastUpdated: '2026-08-07T16:41:01.947Z',
      scripts: {
        'profile-photo.js': { index: 36, characters: 6026, sha256: '213646b19cc04f2b87375afeb303cc7ebe1f598cd5ffa4ce471b7c4ca895cf5c' },
        'portfolio-crud.js': { index: 37, characters: 37410, sha256: '7ab803c9890b802f154c6f5c3f0a6d5906624f71b9683153b2f5798617e1070d' },
        'portfolio-list.js': { index: 38, characters: 3590, sha256: 'ddbc94bf09e237e7fc016b73c3ab0a4f361e38ba5105840c4c568886841b3255' },
        'company-autocomplete.js': { index: 39, characters: 11677, sha256: 'eb426e9899ccfc9976c5eb061930f122d54542fa33f4453a0602aae48f842f4c' },
        'work-dates.js': { index: 40, characters: 1685, sha256: '4d8aa2dbd4c7668f37430a73c92049a7a5fa566d99915f5e45a61be5dac0c321' },
        'company-experience-crud.js': { index: 41, characters: 30068, sha256: '6dc7fa7306d9558fb493cb6a6cfd6196659e0b7005c6d49831ffcc5f3261b5d3' },
        'field-counters.js': { index: 47, characters: 4127, sha256: 'decbf5b49d1006f8a857602a33e2d89a6270fa8b9355d6311d16188f6a4bfe83' },
        'bio-editor.js': { index: 48, characters: 7604, sha256: '91671c4ed05806b2ed306f50c265954ef0c36714f59c77f721e2510370c9273f' },
        'grouped-selects.js': { index: 49, characters: 1405, sha256: 'e80bb01f28a43ebcb5b28e8ea733bac273985ddfa3235179cdfc6a9a5168ae84' },
      },
    },
  },
}
const EXPECTED_CANDIDATES = {
  sourceCommit: '781fd8ae6d05269cf14d0d33d8031ba0438ed3d4',
  files: {
    'profile-photo.js': { path: 'v3/build-profile/profile-photo.js', bytes: 14773, sha256: 'c0a95e71644efe2e660c368b6609a595169be1fa7fef9e81b72f1ec154d0b5db' },
    'portfolio-crud.js': { path: 'v3/build-profile/portfolio-crud.js', bytes: 38194, sha256: 'dd827f0e98e442774a935cc40224381a53fde0c0bdd1603e694f932d6b1dbfc7' },
    'portfolio-list.js': { path: 'v3/build-profile/portfolio-list.js', bytes: 3834, sha256: '9f7e8f223de29bc5d8ddb970ca0fe25dbfdf53cdbb36fd68a07c2e81b08b28d1' },
    'company-autocomplete.js': { path: 'v3/build-profile/company-autocomplete.js', bytes: 11921, sha256: 'a342c3700e30a9693ed2c746feef7641785726f0ca9f28c4b00730e417525cbe' },
    'work-dates.js': { path: 'v3/build-profile/work-dates.js', bytes: 1929, sha256: '3be29b0dfecfadd6057e6da6a30af0a47dc41d67bdedda863aca003512fe2890' },
    'company-experience-crud.js': { path: 'v3/build-profile/company-experience-crud.js', bytes: 39104, sha256: 'd463b86613a42d5bdb1846f3294595441dbdc806d79530758560a03df0f8be85' },
    'field-counters.js': { path: 'v3/build-profile/field-counters.js', bytes: 5027, sha256: '89add4a5af95b6e011116d13c868a7bcc91d36616f216a0ea5ec6aac296fbe61' },
    'bio-editor.js': { path: 'v3/build-profile/bio-editor.js', bytes: 12246, sha256: 'df9f20286ded40b99a04dfe9e9cae41a9737b351ef6e55dda0f7b346091082cc' },
    'grouped-selects.js': { path: 'v3/build-profile/grouped-selects.js', bytes: 1649, sha256: '9fc122b55ae5a0e40bbea47932fbb446d74de656d7818cc3744511adc0a8db22' },
  },
}

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

test('both authenticated live captures preserve their immutable evidence', () => {
  assert.deepEqual({
    capturedAt: PROVENANCE.capturedAt,
    siteId: PROVENANCE.siteId,
    pages: PROVENANCE.pages,
  }, EXPECTED_CAPTURE)
})

test('candidate asset hashes identify current Git blobs, not live captures', () => {
  assert.match(PROVENANCE.captureMethod, /Authenticated published-page HTML/)
  assert.match(PROVENANCE.candidateAssets.hashMethod, /not authenticated Webflow captures/)
  assert.deepEqual({
    sourceCommit: PROVENANCE.candidateAssets.sourceCommit,
    files: PROVENANCE.candidateAssets.files,
  }, EXPECTED_CANDIDATES)

  for (const [file, candidate] of Object.entries(PROVENANCE.candidateAssets.files)) {
    const bytes = fs.readFileSync(path.resolve(DIR, '../..', candidate.path))
    assert.equal(bytes.length, candidate.bytes, file)
    assert.equal(sha256(bytes), candidate.sha256, file)
  }

  assert.notEqual(
    PROVENANCE.pages[PAGES[0]].scripts['profile-photo.js'].sha256,
    PROVENANCE.candidateAssets.files['profile-photo.js'].sha256,
  )
})

test('each candidate controller remains valid as a standalone classic script', () => {
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

test('profile consumers wait for canonical fallback before their first read', () => {
  const listeners = new Map()
  let insertedScript
  let profileReads = 0
  const document = {
    currentScript: { src: 'https://cdn.example.test/v3/build-profile/profile-photo.js' },
    addEventListener() {},
    createElement() {
      insertedScript = {
        addEventListener(type, listener) { listeners.set(type, listener) },
      }
      return insertedScript
    },
    head: { appendChild() {} },
  }
  const window = {
    location: { pathname: '/build-profile/full-profile' },
    document,
    waitProfileData(callback) { profileReads += 1; callback() },
  }
  const context = vm.createContext({
    console, document, URL, waitForMember() {}, window,
  })

  new vm.Script(source('profile-photo.js'), { filename: 'profile-photo.js' }).runInContext(context)
  context.waitProfileData = window.waitProfileData
  window.waitProfileData(() => {})
  assert.equal(profileReads, 0)

  window.__tsReleaseBuildProfileCanonical()
  assert.equal(profileReads, 1)
  assert.equal(window.waitProfileData.name, 'waitProfileData')
  assert.ok(insertedScript)
})
