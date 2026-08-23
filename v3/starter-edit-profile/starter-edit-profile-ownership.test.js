const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const DIR = __dirname
const PROVENANCE = JSON.parse(fs.readFileSync(path.join(DIR, 'live-body-provenance.json'), 'utf8'))
const EXPECTED_CAPTURE = {
  capturedAt: '2026-08-12T11:43:00+08:00',
  siteId: '69c573f20f82bd0f3384032c',
  page: {
    path: '/starter-edit-profile',
    pageId: '6a44b2477e93b2d11b905de0',
    lastUpdated: '2026-08-11T17:46:16.651Z',
    scripts: {
      'profile-photo.js': { asset: '../build-profile/profile-photo.js', index: 84, characters: 6026, sha256: '213646b19cc04f2b87375afeb303cc7ebe1f598cd5ffa4ce471b7c4ca895cf5c' },
      'portfolio-crud.js': { asset: 'portfolio-crud.js', index: 87, characters: 49773, sha256: '8def2d83a95789431895634566199088cae153f1d517210abcb917977dd02e5d' },
      'portfolio-list.js': { asset: 'portfolio-list.js', index: 88, characters: 3763, sha256: '2d0a3261493ac1e07a63a16981083920425e91315ced4d84d3f9d6e6709bfb18' },
      'company-autocomplete.js': { asset: 'company-autocomplete.js', index: 89, characters: 12671, sha256: '24702eef9717e717f266be3f7f1b22f84609acf486c20042fb7f6a8d7d3b427f' },
      'company-experience-crud.js': { asset: 'company-experience-crud.js', index: 90, characters: 45194, sha256: '1224636b9f1167c5534957407d3451640b8d5b17e52f4930011e17f5a0eb8664' },
      'work-dates.js': { asset: '../build-profile/work-dates.js', index: 91, characters: 1685, sha256: '4d8aa2dbd4c7668f37430a73c92049a7a5fa566d99915f5e45a61be5dac0c321' },
    },
  },
}
const EXPECTED_CANDIDATES = {
  sourceCommit: '781fd8ae6d05269cf14d0d33d8031ba0438ed3d4',
  files: {
    'profile-photo.js': { path: 'v3/build-profile/profile-photo.js', bytes: 14773, sha256: 'c0a95e71644efe2e660c368b6609a595169be1fa7fef9e81b72f1ec154d0b5db' },
    'portfolio-crud.js': { path: 'v3/starter-edit-profile/portfolio-crud.js', bytes: 53024, sha256: '793ae71fb66933d903d56af2134e0d61885adacce293e8687c3b05e906434bbf' },
    'portfolio-list.js': { path: 'v3/starter-edit-profile/portfolio-list.js', bytes: 4013, sha256: 'f559928f524705d1fcce022a1213b0a637c233cbd55f4973dc376457e0ab74ff' },
    'company-autocomplete.js': { path: 'v3/starter-edit-profile/company-autocomplete.js', bytes: 12921, sha256: '07582d43008c17f4f447505c542f1175805d84cc9f5df3a79fdf1942e0bed7a4' },
    'company-experience-crud.js': { path: 'v3/starter-edit-profile/company-experience-crud.js', bytes: 55527, sha256: 'd9ed6ce47bcc9d8a9da3b7a72988e3ce5f6c236858e83393bb633ee6458e20b5' },
    'work-dates.js': { path: 'v3/build-profile/work-dates.js', bytes: 1929, sha256: '3be29b0dfecfadd6057e6da6a30af0a47dc41d67bdedda863aca003512fe2890' },
  },
}

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

test('authenticated live capture preserves its immutable evidence', () => {
  assert.deepEqual({
    capturedAt: PROVENANCE.capturedAt,
    siteId: PROVENANCE.siteId,
    page: PROVENANCE.page,
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
    PROVENANCE.page.scripts['profile-photo.js'].sha256,
    PROVENANCE.candidateAssets.files['profile-photo.js'].sha256,
  )
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
