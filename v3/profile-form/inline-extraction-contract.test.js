const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const DIR = __dirname
const ROOT = path.resolve(DIR, '../..')
const PROVENANCE = JSON.parse(
  fs.readFileSync(path.join(DIR, 'inline-extraction-cutover-candidate.json'), 'utf8'),
)
const LOADER_CONTRACT_FILE = 'v3/profile-form/inline-extraction-loaders.CANDIDATE.html'
const CDN_PREFIX = 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/'
const PINNED_FULL_PROFILE_SHIM = Object.freeze({
  route: '/build-profile/full-profile', index: 30,
  url: 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.56.14/profile-image-auth-shim.js',
  asset: 'v3/profile-form/profile-image-auth-shim-v1.56.14.capture.txt',
  bytes: 16265,
  sha256: '6960394833ab75ab16daa45f9e0bbafc22c6e41a921f607e3acdd20b041f4aa6',
})

// This review-owned oracle is intentionally independent of the editable cutover
// manifest. A coordinated asset + manifest edit cannot redefine the live evidence.
const EXPECTED_LIVE_CAPTURES = Object.freeze({
  sharedFoundation: Object.freeze({
    asset: 'v3/profile-form/shared-foundation.js', characters: 24218,
    sha256: '7a1eec8ed6a1f41cf958771732cc703941240d97b5aff6311b4440b72f08d5f7',
    embedSha256: '32d1e6687ec692197e18e6b8b9507b05b051b5311c86777cbe64eb2b997f1c92',
    indexes: Object.freeze({ '/starter-edit-profile': 91, '/build-profile/consult': 64, '/build-profile/full-profile': 66 }),
  }),
  incrementalDropdowns: Object.freeze({
    asset: 'v3/profile-form/incremental-dropdowns.js', characters: 13961,
    sha256: '0f495d228696ab32ea19a07a3bf407ba2ad8d729d22505bbb0a927ddba76ca04',
    embedSha256: '5a9dc4899b2a24dc6bba5407db0a6c21b630dcc618f121f3c682f0cbb830302b',
    indexes: Object.freeze({ '/starter-edit-profile': 93, '/build-profile/consult': 72, '/build-profile/full-profile': 74 }),
  }),
  editLocationsReady: Object.freeze({
    asset: 'v3/starter-edit-profile/locations.js', characters: 31,
    sha256: 'b24611c0a8c87f8d88a215dbb6a5af2ef4256a630fd9f6e3686c8300a480b4ad', index: 94,
    embedSha256: '495e7109aee3940071750fbd8d99d35501e829f40f3362b7fd8ea8c09f568f98',
  }),
  editLocations: Object.freeze({
    asset: 'v3/starter-edit-profile/locations.js', characters: 9595,
    sha256: '962a3f27cf061c696c2243037218238fff228e3a540b85451c3302a4c0eb55a6', index: 100,
    embedSha256: 'f6280b0a1f0fbe9f7d717eb2924c6556d70e30b43edc25547afc99bed1a953aa',
  }),
  editCanonicalProfileLoader: Object.freeze({
    asset: 'v3/starter-edit-profile/canonical-profile-loader.js', characters: 18665,
    sha256: 'ca73e3b0341aed7564b0914e5f2b42f66475f5a25041a46cfbbd41d2bbb14b92', index: 101,
    embedSha256: '7b8317d33369f8f5a5be69c248ae8fcaae0e49192a1e02a3f79bb1bd98d46322',
  }),
  buildDraftState: Object.freeze({
    asset: 'v3/build-profile/draft-state.js', characters: 11002,
    sha256: 'ec9ed60d8c762744410c33acece59809a6231b912c14efc991ab5433cad2b4ff',
    embedSha256: '073be43ebecc9e3a21c9f57275e2867c156a83cb187ace73fc1890071a0fb428',
    indexes: Object.freeze({ '/build-profile/consult': 71, '/build-profile/full-profile': 73 }),
  }),
  buildSubmitWriter: Object.freeze({
    asset: 'v3/build-profile/submit-writer.js', characters: 9169,
    sha256: '927f43daca2cd7d66ccaea97317994ad486a7edd43b401df1e2442d36a7b7d9f',
    embedSha256: '9fc5e32ff783adf0e10f8bd407e67e9613587da268345a95a156e2f853f2f803',
    indexes: Object.freeze({ '/build-profile/consult': 73, '/build-profile/full-profile': 75 }),
  }),
  buildConsultLocations: Object.freeze({
    asset: 'v3/build-profile/locations-consult.js', characters: 10834,
    sha256: 'e39042ad31e8228dfad4a665a873e9f39dfbaa045765bf2559725f800735433a', index: 83,
    embedSha256: '5f469d5322dc08c161db8be2bed17ca9054f3874e084ce7343265598d21daa65',
  }),
  buildFullProfileLocations: Object.freeze({
    asset: 'v3/build-profile/locations-full-profile.js', characters: 10529,
    sha256: 'f882132f56623afe3d5af876cad72ad560917b89d0a1b31235aabecf572bdd7f', index: 85,
    embedSha256: '24d60c2e43f944e3764d489872d0bad10b00c2375592fa17a426eb017b6d4225',
  }),
})

const EXPECTED_CANDIDATE_ASSETS = Object.freeze({
  'v3/profile-form/shared-foundation.js': Object.freeze({
    characters: 22892, sha256: '7af566f3bd01f172416d0be37d5b669e9e80848049e980653b237d60d047a214',
    liveCaptureAsset: 'v3/profile-form/shared-foundation-published.capture.txt',
    restoreTrailingWhitespace: Object.freeze({ 3: '  ', 81: ' ', 239: '      ' }), terminalNewlinesRemoved: 0,
  }),
  'v3/profile-form/incremental-dropdowns.js': Object.freeze({
    characters: 14107, sha256: 'f239896721ec2048d138af0d8874596509710ca5ac039d016f15dcdcffa15faf',
    guardKey: 'incrementalDropdowns',
    liveCaptureAsset: 'v3/profile-form/incremental-dropdowns-published.capture.txt',
    restoreTrailingWhitespace: Object.freeze({}), terminalNewlinesRemoved: 0,
  }),
  'v3/starter-edit-profile/locations.js': Object.freeze({
    characters: 9847, sha256: '69794b67fd9359f16427ad36fae3e2dd5dca4dc8729b0eaab66ca6b4be5bd8de',
    guardKey: 'editProfileLocations',
    restoreTrailingWhitespace: Object.freeze({ 4: '  ' }), terminalNewlinesRemoved: 0,
  }),
  'v3/starter-edit-profile/canonical-profile-loader.js': Object.freeze({
    characters: 22296, sha256: '627e7554b9dd6d5f2e79cc3facbe6585c25c0b73da4d4363e77d3ea20577d2da',
    guardKey: 'canonicalProfileLoader',
    liveCaptureAsset: 'v3/profile-form/edit-canonical-profile-loader-published.capture.txt',
    restoreTrailingWhitespace: Object.freeze({}), terminalNewlinesRemoved: 0,
  }),
  'v3/build-profile/draft-state.js': Object.freeze({
    characters: 11151, sha256: 'f5311c42114ae706587bf0abe9738b80dbb798319b049781766a490df4936f7a',
    guardKey: 'buildProfileDraftState',
    liveCaptureAsset: 'v3/profile-form/build-draft-state-published.capture.txt',
    restoreTrailingWhitespace: Object.freeze({}), terminalNewlinesRemoved: 1,
  }),
  'v3/build-profile/submit-writer.js': Object.freeze({
    characters: 11438, sha256: '64bdb27d4834cd218ffe4b9dfd3777ebc0e00d0e8ea838f1106a2b503098a445',
    guardKey: 'buildProfileSubmitWriter',
    liveCaptureAsset: 'v3/profile-form/build-submit-writer-published.capture.txt',
    restoreTrailingWhitespace: Object.freeze({ 219: '          ' }), terminalNewlinesRemoved: 0,
  }),
  'v3/build-profile/locations-consult.js': Object.freeze({
    characters: 11065, sha256: '3c2e09a3a55806e1f4a82af2c3e850c6f53120fc70c1506cbf6315d5f311f160',
    guardKey: 'buildProfileConsultLocations',
    restoreTrailingWhitespace: Object.freeze({ 14: '\t\t' }), terminalNewlinesRemoved: 1,
  }),
  'v3/build-profile/locations-full-profile.js': Object.freeze({
    characters: 10756, sha256: 'baae2157ab304366ae707759d85edbe1fae999b8eef74fa6b140868df4637026',
    guardKey: 'buildProfileFullLocations',
    restoreTrailingWhitespace: Object.freeze({}), terminalNewlinesRemoved: 1,
  }),
})

const EXPECTED_ROUTE_LOADERS = Object.freeze({
  '/starter-edit-profile': Object.freeze([
    'v3/profile-form/shared-foundation.js',
    'v3/profile-form/incremental-dropdowns.js',
    'v3/starter-edit-profile/locations.js',
    'v3/starter-edit-profile/canonical-profile-loader.js',
  ]),
  '/build-profile/consult': Object.freeze([
    'v3/profile-form/shared-foundation.js',
    'v3/build-profile/draft-state.js',
    'v3/profile-form/incremental-dropdowns.js',
    'v3/build-profile/submit-writer.js',
    'v3/build-profile/locations-consult.js',
  ]),
  '/build-profile/full-profile': Object.freeze([
    'v3/profile-form/shared-foundation.js',
    'v3/build-profile/draft-state.js',
    'v3/profile-form/incremental-dropdowns.js',
    'v3/build-profile/submit-writer.js',
    'v3/build-profile/locations-full-profile.js',
  ]),
})

const EXPECTED_EXISTING_ROUTE_LOADERS = Object.freeze({
  '/starter-edit-profile': Object.freeze([
    [92, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/profile-photo.js', 'v3/build-profile/profile-photo.js'],
    [95, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-edit-profile/portfolio-crud.js', 'v3/starter-edit-profile/portfolio-crud.js'],
    [96, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-edit-profile/portfolio-list.js', 'v3/starter-edit-profile/portfolio-list.js'],
    [97, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-edit-profile/company-autocomplete.js', 'v3/starter-edit-profile/company-autocomplete.js'],
    [98, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/starter-edit-profile/company-experience-crud.js', 'v3/starter-edit-profile/company-experience-crud.js'],
    [99, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/work-dates.js', 'v3/build-profile/work-dates.js'],
    [102, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.56.8/profile-image-auth-shim.js', 'profile-image-auth-shim.js'],
    [111, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/starter-edit-profile.js', 'starter-edit-profile.js'],
  ]),
  '/build-profile/consult': Object.freeze([
    [65, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/profile-photo.js', 'v3/build-profile/profile-photo.js'],
    [66, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/portfolio-crud.js', 'v3/build-profile/portfolio-crud.js'],
    [67, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/portfolio-list.js', 'v3/build-profile/portfolio-list.js'],
    [68, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/company-autocomplete.js', 'v3/build-profile/company-autocomplete.js'],
    [69, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/work-dates.js', 'v3/build-profile/work-dates.js'],
    [70, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/company-experience-crud.js', 'v3/build-profile/company-experience-crud.js'],
    [74, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/utils/multi-step-failover.js', 'utils/multi-step-failover.js'],
    [75, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/profile-image-auth-shim.js', 'profile-image-auth-shim.js'],
    [84, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/field-counters.js', 'v3/build-profile/field-counters.js'],
    [86, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/bio-editor.js', 'v3/build-profile/bio-editor.js'],
    [87, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/grouped-selects.js', 'v3/build-profile/grouped-selects.js'],
    [89, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/submit-diagnostics.js', 'v3/build-profile/submit-diagnostics.js'],
  ]),
  '/build-profile/full-profile': Object.freeze([
    [30, PINNED_FULL_PROFILE_SHIM.url, PINNED_FULL_PROFILE_SHIM.asset, {
      servedBytes: PINNED_FULL_PROFILE_SHIM.bytes,
      servedSha256: PINNED_FULL_PROFILE_SHIM.sha256,
      runtimeRole: 'controlling_first_load_before_grouped_anchor',
    }],
    [67, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/profile-photo.js', 'v3/build-profile/profile-photo.js'],
    [68, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/portfolio-crud.js', 'v3/build-profile/portfolio-crud.js'],
    [69, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/portfolio-list.js', 'v3/build-profile/portfolio-list.js'],
    [70, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/company-autocomplete.js', 'v3/build-profile/company-autocomplete.js'],
    [71, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/work-dates.js', 'v3/build-profile/work-dates.js'],
    [72, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/company-experience-crud.js', 'v3/build-profile/company-experience-crud.js'],
    [76, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/utils/multi-step-failover.js', 'utils/multi-step-failover.js'],
    [77, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/profile-image-auth-shim.js', 'profile-image-auth-shim.js', {
      runtimeRole: 'guarded_no_op_after_index_30',
    }],
    [86, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/field-counters.js', 'v3/build-profile/field-counters.js'],
    [88, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/bio-editor.js', 'v3/build-profile/bio-editor.js'],
    [89, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/grouped-selects.js', 'v3/build-profile/grouped-selects.js'],
    [91, 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/submit-diagnostics.js', 'v3/build-profile/submit-diagnostics.js'],
  ]),
})

const EXPECTED_ROUTE_BINDINGS = Object.freeze({
  '/starter-edit-profile': Object.freeze({
    pageId: '6a44b2477e93b2d11b905de0', pageComponentInstanceId: '2c015b48-4ba6-2ec3-4876-c06707317e1c',
    nestedComponentInstanceId: '2c015b48-4ba6-2ec3-4876-c06707317e1e', anchorIndex: 91,
  }),
  '/build-profile/consult': Object.freeze({
    pageId: '6a3e73ae5f60c547e5e9d041', pageComponentInstanceId: 'b732e7f5-4c02-3273-f3df-90d6f623fa63', anchorIndex: 64,
  }),
  '/build-profile/full-profile': Object.freeze({
    pageId: '6a01b0ef0dd420942a5f964a', pageComponentInstanceId: 'd7eff4d8-d2d0-9f00-759f-c7c52fff4a2f', anchorIndex: 66,
  }),
})

const EXPECTED_REMOVAL_LOCATIONS = Object.freeze({
  '/starter-edit-profile': Object.freeze([
    ['editLocationsReady', '2c015b48-4ba6-2ec3-4876-c06707317e1f'],
    ['editLocations', 'a55ba4c4-e5a5-7d3d-77a9-79cc31eb5698'],
    ['editCanonicalProfileLoader', 'a6aa8d34-73aa-dc11-b5fb-78c2512bca23'],
  ]),
  '/build-profile/consult': Object.freeze([
    ['buildConsultLocations', 'footer/script[83]'],
  ]),
  '/build-profile/full-profile': Object.freeze([
    ['buildFullProfileLocations', 'footer/script[85]'],
  ]),
})

const EXPECTED_COMPONENT_REMOVAL_LOCATIONS = Object.freeze([
  ['sharedFoundation', 'b732e7f5-4c02-3273-f3df-90d6f623fa65'],
  ['buildDraftState', 'b732e7f5-4c02-3273-f3df-90d6f623fa6a'],
  ['incrementalDropdowns', 'b732e7f5-4c02-3273-f3df-90d6f623fa6b'],
  ['buildSubmitWriter', 'b732e7f5-4c02-3273-f3df-90d6f623fa6c'],
])

const EXPECTED_COMPLETE_REGISTRATIONS = Object.freeze({
  '/starter-edit-profile': Object.freeze([
    ['document', 'DOMContentLoaded', 'v3/profile-form/incremental-dropdowns.js'],
    ['document', 'DOMContentLoaded', 'v3/starter-edit-profile/locations.js'],
    ['document', 'input', 'v3/starter-edit-profile/canonical-profile-loader.js'],
    ['document', 'change', 'v3/starter-edit-profile/canonical-profile-loader.js'],
    ['window', 'beforeunload', 'v3/starter-edit-profile/canonical-profile-loader.js'],
    ['document', 'DOMContentLoaded', 'v3/starter-edit-profile/canonical-profile-loader.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/profile-photo.js'],
    ['document', 'DOMContentLoaded', 'v3/starter-edit-profile/portfolio-crud.js'],
    ['document', 'DOMContentLoaded', 'v3/starter-edit-profile/portfolio-list.js'],
    ['document', 'DOMContentLoaded', 'v3/starter-edit-profile/company-autocomplete.js'],
    ['document', 'DOMContentLoaded', 'v3/starter-edit-profile/company-experience-crud.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/work-dates.js'],
    ...Array.from({ length: 6 }, () => ['document', 'DOMContentLoaded', 'starter-edit-profile.js']),
  ]),
  '/build-profile/consult': Object.freeze([
    ['document', 'DOMContentLoaded', 'v3/build-profile/draft-state.js'],
    ['document', 'DOMContentLoaded', 'v3/profile-form/incremental-dropdowns.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/submit-writer.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/locations-consult.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/profile-photo.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/portfolio-crud.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/portfolio-list.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/company-autocomplete.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/work-dates.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/company-experience-crud.js'],
    ['window', 'load', 'utils/multi-step-failover.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/bio-editor.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/grouped-selects.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/submit-diagnostics.js'],
  ]),
  '/build-profile/full-profile': Object.freeze([
    ['document', 'DOMContentLoaded', 'v3/build-profile/draft-state.js'],
    ['document', 'DOMContentLoaded', 'v3/profile-form/incremental-dropdowns.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/submit-writer.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/locations-full-profile.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/profile-photo.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/portfolio-crud.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/portfolio-list.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/company-autocomplete.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/work-dates.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/company-experience-crud.js'],
    ['window', 'load', 'utils/multi-step-failover.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/bio-editor.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/grouped-selects.js'],
    ['document', 'DOMContentLoaded', 'v3/build-profile/submit-diagnostics.js'],
  ]),
})

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function restoreCapturedWhitespace(candidate, expected, asset) {
  assert.equal(candidate.endsWith('\n'), true, `${asset}: candidate must end with one newline`)
  assert.equal(candidate.endsWith('\n\n'), false, `${asset}: candidate has excess terminal newlines`)
  let normalizedCandidate = candidate
  if (expected.guardKey) {
    const guardedLines = candidate.split('\n')
    normalizedCandidate = [...guardedLines.slice(0, 1), ...guardedLines.slice(4, -2), ''].join('\n')
  }
  assert.doesNotMatch(normalizedCandidate, /[ \t]+$/m, `${asset}: candidate has trailing whitespace`)

  const lines = normalizedCandidate.split('\n')
  for (const [lineNumber, suffix] of Object.entries(expected.restoreTrailingWhitespace)) {
    const index = Number(lineNumber) - 1
    assert.ok(index >= 0 && index < lines.length - 1, `${asset}: invalid restored line ${lineNumber}`)
    lines[index] += suffix
  }
  return lines.join('\n') + '\n'.repeat(expected.terminalNewlinesRemoved)
}

function validateLiveCaptureContract(provenance, readAsset = source) {
  for (const [key, expected] of Object.entries(EXPECTED_LIVE_CAPTURES)) {
    const record = provenance.sources[key]
    assert.ok(record, `${key}: missing manifest record`)
    assert.equal(record.asset, expected.asset, `${key}: asset`)
    assert.equal(record.publishedBodyCharacters, expected.characters, `${key}: live length`)
    assert.equal(record.publishedBodySha256, expected.sha256, `${key}: live hash`)
    assert.equal(record.publishedEmbedSha256, expected.embedSha256, `${key}: live embed hash`)
    if ('index' in expected) assert.equal(record.publishedScriptIndex, expected.index, `${key}: live index`)
    if ('indexes' in expected) assert.deepEqual(record.publishedScriptIndexes, expected.indexes, `${key}: live indexes`)
  }

  assert.deepEqual(
    Object.keys(provenance.candidateAssets).sort(),
    Object.keys(EXPECTED_CANDIDATE_ASSETS).sort(),
    'candidate asset inventory',
  )
  const restoredAssets = {}
  for (const [asset, expected] of Object.entries(EXPECTED_CANDIDATE_ASSETS)) {
    const record = provenance.candidateAssets[asset]
    const transformation = {
      kind: expected.liveCaptureAsset
        ? 'whitespace_plus_idempotency_guard_plus_behavior_change'
        : (expected.guardKey ? 'whitespace_plus_idempotency_guard' : 'whitespace_only'),
      ...(expected.guardKey ? { guardKey: expected.guardKey } : {}),
      restoreTrailingWhitespace: expected.restoreTrailingWhitespace,
      terminalNewlinesRemoved: expected.terminalNewlinesRemoved,
      ...(expected.liveCaptureAsset ? { liveCaptureAsset: expected.liveCaptureAsset } : {}),
    }
    assert.deepEqual(record, {
      candidateCharacters: expected.characters,
      candidateSha256: expected.sha256,
      transformation,
    }, `${asset}: candidate manifest`)

    const candidate = readAsset(asset)
    assert.equal(candidate.length, expected.characters, `${asset}: candidate length`)
    assert.equal(sha256(candidate), expected.sha256, `${asset}: candidate hash`)
    const reconstructed = restoreCapturedWhitespace(candidate, expected, asset)

    if (!expected.liveCaptureAsset) {
      restoredAssets[asset] = reconstructed
      continue
    }

    restoredAssets[asset] = readAsset(expected.liveCaptureAsset)
    assert.notEqual(
      reconstructed, restoredAssets[asset],
      `${asset}: declared behavior change no longer diverges from its published capture`,
    )
  }

  for (const key of [
    'sharedFoundation', 'incrementalDropdowns', 'editCanonicalProfileLoader',
    'buildDraftState', 'buildSubmitWriter', 'buildConsultLocations', 'buildFullProfileLocations',
  ]) {
    const expected = EXPECTED_LIVE_CAPTURES[key]
    const restored = restoredAssets[expected.asset]
    assert.ok(restored, `${key}: missing reconstructed live body`)
    assert.equal(restored.length, expected.characters, `${key}: reconstructed live length`)
    assert.equal(sha256(restored), expected.sha256, `${key}: reconstructed live hash`)
    assert.equal(sha256(`<script>${restored}</script>`), expected.embedSha256, `${key}: reconstructed embed hash`)
  }

  const editLocations = restoredAssets[EXPECTED_LIVE_CAPTURES.editLocations.asset]
  const ready = EXPECTED_LIVE_CAPTURES.editLocationsReady
  const locations = EXPECTED_LIVE_CAPTURES.editLocations
  assert.equal(editLocations.length, ready.characters + 1 + locations.characters)
  assert.equal(sha256(editLocations.slice(0, ready.characters)), ready.sha256)
  assert.equal(sha256(editLocations.slice(ready.characters + 1)), locations.sha256)
  assert.equal(sha256(`<script>${editLocations.slice(0, ready.characters)}</script>`), ready.embedSha256)
  assert.equal(sha256(`<script>${editLocations.slice(ready.characters + 1)}</script>`), locations.embedSha256)
}

function validateGroupedCutover(provenance, routeLoaders) {
  assert.equal(provenance.schema, 'profile_form_inline_extraction_cutover_candidate_v4')
  assert.equal(provenance.cutoverModel, 'install_all_page_heads_then_component_once_then_route_removals')
  assert.deepEqual(provenance.executionOrder, [
    'install_and_read_back_all_route_page_heads',
    'remove_shared_component_bodies_once',
    'remove_route_specific_bodies',
  ], 'wrong cutover execution order')

  const componentRemovals = provenance.componentWideRemovals
  assert.deepEqual({
    scope: componentRemovals.scope,
    componentId: componentRemovals.componentId,
    action: componentRemovals.action,
  }, {
    scope: 'shared-component',
    componentId: 'b732e7f5-4c02-3273-f3df-90d6f623fa64',
    action: 'empty_each_exact_body_once_after_all_route_heads_are_saved_and_read_back',
  }, 'wrong component-wide removal contract')
  assert.deepEqual(
    componentRemovals.remove.map((item) => [item.sourceKey, item.nodeId]),
    EXPECTED_COMPONENT_REMOVAL_LOCATIONS,
    'missed, extra, or moved component-wide removal',
  )
  for (const removal of componentRemovals.remove) {
    assert.equal(removal.beforeEmbedSha256, EXPECTED_LIVE_CAPTURES[removal.sourceKey].embedSha256, `${removal.sourceKey}: component before hash`)
    assert.match(removal.nodeId, /^[a-f0-9-]{36}$/)
  }

  const byRoute = Object.fromEntries(provenance.routeCutovers.map((cutover) => [cutover.route, cutover]))
  assert.deepEqual(Object.keys(byRoute).sort(), Object.keys(EXPECTED_ROUTE_LOADERS).sort())

  for (const [route, expectedAssets] of Object.entries(EXPECTED_ROUTE_LOADERS)) {
    const cutover = byRoute[route]
    const binding = EXPECTED_ROUTE_BINDINGS[route]
    assert.ok(cutover, `${route}: missing grouped cutover`)
    assert.equal(cutover.pageId, binding.pageId, `${route}: wrong page binding`)
    assert.deepEqual(cutover.install, {
      scope: 'page-head-freeform-code',
      action: 'append_complete_route_loader_group_to_exact_saved_head',
    }, `${route}: wrong page-head install contract`)
    assert.equal(cutover.runtimePlacementEvidence.pageComponentInstanceId, binding.pageComponentInstanceId, `${route}: wrong component instance`)
    assert.equal(cutover.runtimePlacementEvidence.nestedComponentInstanceId, binding.nestedComponentInstanceId, `${route}: wrong nested instance`)
    assert.equal(cutover.runtimePlacementEvidence.originalGroupedAnchorIndex, binding.anchorIndex, `${route}: wrong anchor index`)
    assert.deepEqual(routeLoaders[route], expectedAssets, `${route}: grouped loader assets`)
    const removalLocations = cutover.remove.map((item) => [item.sourceKey, item.nodeId || item.completeLocation])
    assert.deepEqual(removalLocations, EXPECTED_REMOVAL_LOCATIONS[route], `${route}: missed, extra, or moved removal`)

    for (const removal of cutover.remove) {
      const expected = EXPECTED_LIVE_CAPTURES[removal.sourceKey]
      assert.equal(removal.beforeEmbedSha256, expected.embedSha256, `${route}/${removal.sourceKey}: before hash`)
      assert.notEqual(removal.scope, 'shared-component', `${route}: shared removal must be component-wide`)
      if (removal.scope === 'page-footer-freeform-code') {
        assert.equal(removal.nodeId, null)
        assert.match(removal.completeLocation, /^footer\/script\[\d+\]$/)
      } else {
        assert.match(removal.nodeId, /^[a-f0-9-]{36}$/)
      }
    }

    const expectedPreserved = EXPECTED_EXISTING_ROUTE_LOADERS[route].map(([publishedScriptIndex, url, , metadata]) => ({
      publishedScriptIndex,
      url,
      ...(metadata || {}),
    }))
    assert.deepEqual(cutover.preserveLoaders, expectedPreserved, `${route}: existing loader drift`)
    const beforeAnchor = cutover.preserveLoaders.filter((loader) => loader.publishedScriptIndex < binding.anchorIndex)
    const afterAnchor = cutover.preserveLoaders.filter((loader) => loader.publishedScriptIndex > binding.anchorIndex)
    const runtime = provenance.runtimeAssets[route]
    assert.ok(runtime, `${route}: missing runtime asset sequence`)
    assert.equal(runtime.groupedAnchorIndex, binding.anchorIndex, `${route}: runtime anchor index`)
    assert.deepEqual(runtime.groupedAssets, expectedAssets, `${route}: runtime grouped assets`)
    assert.deepEqual(runtime.beforeGroupedAnchorPreserveIndexes, beforeAnchor.map((loader) => loader.publishedScriptIndex), `${route}: runtime pre-anchor assets`)
    assert.deepEqual(runtime.afterGroupedAnchorPreserveIndexes, afterAnchor.map((loader) => loader.publishedScriptIndex), `${route}: runtime post-anchor assets`)
    if (route === PINNED_FULL_PROFILE_SHIM.route) {
      assert.deepEqual(beforeAnchor.map((loader) => loader.publishedScriptIndex), [PINNED_FULL_PROFILE_SHIM.index], `${route}: controlling pre-anchor loader`)
    } else {
      assert.deepEqual(beforeAnchor, [], `${route}: unexpected pre-anchor profile loader`)
    }
    assert.ok(afterAnchor.length > 0, `${route}: no preserved post-anchor loaders`)
    assert.ok(cutover.preserveNodeIds.includes('9da55ef0-14dd-2e40-09e6-706ca145917c'), `${route}: photo node is not preserved`)
  }
}

function parseAndValidateLoaderContract(html) {
  const routes = {}
  const templatePattern = /<template data-profile-form-route="([^"]+)">([\s\S]*?)<\/template>/g
  const templates = [...html.matchAll(templatePattern)]
  const outside = html.replace(templatePattern, '').replace(/<!--[\s\S]*?-->/g, '').trim()
  assert.equal(outside, '', 'loader contract contains markup outside route templates')

  for (const [, route, body] of templates) {
    assert.equal(routes[route], undefined, `${route}: duplicate route template`)
    const assets = []
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/g
    const scripts = [...body.matchAll(scriptPattern)]
    const nonScripts = body.replace(scriptPattern, '').replace(/<!--[\s\S]*?-->/g, '').trim()
    assert.equal(nonScripts, '', `${route}: non-loader markup or inline application logic`)

    for (const [, attributes, scriptBody] of scripts) {
      assert.equal(scriptBody.trim(), '', `${route}: inline application logic`)
      const match = attributes.match(/^ defer src="([^"]+)"$/)
      assert.ok(match, `${route}: loader must contain only defer and src`)
      assert.ok(match[1].startsWith(CDN_PREFIX), `${route}: wrong jsDelivr owner or version URL`)
      assets.push(match[1].slice(CDN_PREFIX.length))
    }
    assert.equal(new Set(assets).size, assets.length, `${route}: duplicate loader`)
    routes[route] = assets
  }

  assert.deepEqual(Object.keys(routes).sort(), Object.keys(EXPECTED_ROUTE_LOADERS).sort(), 'route templates')
  for (const [route, expected] of Object.entries(EXPECTED_ROUTE_LOADERS)) {
    assert.deepEqual(routes[route], expected, `${route}: loader order or route ownership`)
  }
  return routes
}

function run(file, context) {
  return new vm.Script(source(file), { filename: file }).runInContext(context)
}

function settle() {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)))
}

function event(type) {
  return { type, preventDefault() {}, stopPropagation() {} }
}

function classList() {
  const values = new Set()
  return {
    add(...names) { names.forEach((name) => values.add(name)) },
    remove(...names) { names.forEach((name) => values.delete(name)) },
    contains(name) { return values.has(name) },
  }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.options = []
    this.listeners = new Map()
    this.style = {}
    this.dataset = {}
    this.classList = classList()
    this.parentNode = { insertBefore() {}, appendChild() {} }
    this.value = ''
    this.textContent = ''
    this.disabled = false
    this.required = false
    this.selected = false
    this.multiple = false
  }

  set className(value) {
    String(value).split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name))
  }

  get selectedIndex() {
    const index = this.options.findIndex((option) => String(option.value) === String(this.value))
    return index >= 0 ? index : 0
  }

  set innerHTML(value) {
    this.children = []
    this.options = []
    const option = String(value).match(/<option\s+value=["']([^"']*)["'][^>]*>([^<]*)<\/option>/i)
    if (option) {
      const node = new Element('option')
      node.value = option[1]
      node.textContent = option[2]
      this.appendChild(node)
    }
  }

  get innerHTML() { return '' }

  appendChild(child) {
    this.children.push(child)
    child.parentNode = this
    if (child.tagName === 'OPTION') this.options.push(child)
    return child
  }

  insertBefore(child) { return this.appendChild(child) }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatchEvent(value) {
    const evt = typeof value === 'string' ? event(value) : value
    for (const listener of this.listeners.get(evt.type) || []) listener.call(this, evt)
    return true
  }

  querySelector(selector) {
    if (selector === '.no-results') {
      return this.children.find((child) => child.classList.contains('no-results')) || null
    }
    return null
  }

  querySelectorAll(selector) {
    if (selector === '.custom-select-option') {
      return this.children.filter((child) => child.classList.contains('custom-select-option'))
    }
    return []
  }

  contains() { return false }
  closest() { return null }
  getAttribute(name) { return name === 'type' ? this.type || null : null }
  hasAttribute() { return false }
  setAttribute(name, value) { this[name] = value }
  focus() {}
}

function createDocument(selectorMap = {}) {
  const listeners = new Map()
  const createdTags = []
  const document = {
    listeners,
    createdTags,
    addEventListener(type, listener) {
      const values = listeners.get(type) || []
      values.push(listener)
      listeners.set(type, values)
    },
    createElement(tag) {
      createdTags.push(String(tag).toLowerCase())
      return new Element(tag)
    },
    querySelector(selector) { return selectorMap[selector] || null },
    querySelectorAll(selector) { return selectorMap[selector] || [] },
  }
  return document
}

function createBaseContext(overrides = {}) {
  const document = overrides.document || createDocument()
  const context = vm.createContext({
    Array,
    Boolean,
    CSS: { escape: (value) => String(value) },
    Date,
    Error,
    Event: class Event { constructor(type, options = {}) { this.type = type; Object.assign(this, options) } },
    FormData,
    JSON,
    Map,
    Math,
    MutationObserver: class MutationObserver { observe() {} },
    Number,
    Object,
    Promise,
    Set,
    String,
    URL,
    clearInterval,
    clearTimeout,
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    document,
    fetch: async () => ({ ok: true, json: async () => [] }),
    localStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
    qs(selector, root) {
      return root && typeof root.querySelector === 'function'
        ? root.querySelector(selector)
        : document.querySelector(selector)
    },
    qsa(selector, root) {
      return root && typeof root.querySelectorAll === 'function'
        ? Array.from(root.querySelectorAll(selector))
        : Array.from(document.querySelectorAll(selector))
    },
    setInterval,
    setLoader() {},
    setTimeout,
    waitForMember(callback) { return callback() },
    waitProfileData(callback) { return callback() },
    window: null,
    ...overrides,
  })
  if (!context.window) context.window = context
  return context
}

function createRouteHarness(route) {
  const selectorMap = {
    '[data-form="step"]': [],
    '[increment-dropdowns]': [],
    'input.with-count, textarea.with-count': [],
    '[ref-list-wrapper][data-entity]': [],
    '[data-element="rate"]:not(.initialized)': [],
  }
  const document = createDocument(selectorMap)
  const controls = {}

  if (route === '/starter-edit-profile') {
    for (const id of ['country', 'state', 'city']) {
      const select = new Element('select')
      const placeholder = new Element('option')
      placeholder.value = ''
      select.appendChild(placeholder)
      selectorMap[`#${id}`] = select
      controls[id] = select
    }
  } else {
    const form = new Element('form')
    const submit = new Element('button')
    const success = new Element('div')
    const failure = new Element('div')
    const email = new Element('input')
    const emailWrapper = new Element('div')
    emailWrapper.appendChild(email)
    const phone = new Element('input')
    selectorMap['[build-profile-form]'] = form
    selectorMap['[form-submit]'] = submit
    selectorMap['[build-profile-success]'] = success
    selectorMap['[build-profile-error]'] = failure
    selectorMap['#email'] = email
    selectorMap['#phone'] = phone
    controls.form = form
    controls.submit = submit
    controls.email = email

    for (const id of ['country', 'state', 'city']) {
      const select = new Element('select')
      const placeholder = new Element('option')
      placeholder.value = ''
      select.appendChild(placeholder)
      selectorMap[`#${id}`] = select
      controls[id] = select
    }
  }

  const context = createBaseContext({
    MEMBER: { id: route === '/starter-edit-profile' ? '' : 'member-1', auth: { email: 'profile@example.com' }, customFields: {} },
    document,
    fetch: async () => ({ ok: true, json: async () => [] }),
    location: { replace() { throw new Error('unexpected route replacement') } },
    qsa(selector) { return Array.from(selectorMap[selector] || []) },
    qs(selector) { return selectorMap[selector] || null },
    setInterval() { return 1 },
    clearInterval() {},
  })
  context.window.addEventListener = () => {}
  context.window.intlTelInput = Object.assign(() => ({}), { getInstance() { return null } })
  return { context, controls, document }
}

async function executeRouteLoaders(route, assets) {
  const harness = createRouteHarness(route)
  for (let pass = 0; pass < 2; pass += 1) {
    for (const asset of assets) run(asset, harness.context)
  }
  const boots = [...(harness.document.listeners.get('DOMContentLoaded') || [])]
  for (const boot of boots) await boot()
  await settle()
  return { ...harness, boots }
}

function executeCompleteRouteSequence(route, groupedAssets) {
  const harness = createRouteHarness(route)
  harness.document.readyState = 'loading'
  const registrations = []
  let executingAsset = ''
  const addDocumentListener = harness.document.addEventListener.bind(harness.document)
  harness.document.addEventListener = (type, listener) => {
    registrations.push({ target: 'document', type, asset: executingAsset })
    addDocumentListener(type, listener)
  }
  harness.context.window.addEventListener = (type) => {
    registrations.push({ target: 'window', type, asset: executingAsset })
  }
  harness.context.$ = () => ({
    ready(listener) { harness.document.addEventListener('DOMContentLoaded', listener) },
  })

  const anchorIndex = EXPECTED_ROUTE_BINDINGS[route].anchorIndex
  const existing = EXPECTED_EXISTING_ROUTE_LOADERS[route]
  const beforeAnchorAssets = existing.filter(([index]) => index < anchorIndex).map(([, , asset]) => asset)
  const afterAnchorAssets = existing.filter(([index]) => index > anchorIndex).map(([, , asset]) => asset)
  const runtimeAssets = [...beforeAnchorAssets, ...groupedAssets, ...afterAnchorAssets]
  let controllingShimFetch = null
  let fetchAfterGrouped = null
  let laterShimWasNoOp = null
  for (const asset of runtimeAssets) {
    executingAsset = asset
    const fetchBefore = harness.context.fetch
    run(asset, harness.context)
    if (asset === PINNED_FULL_PROFILE_SHIM.asset) controllingShimFetch = harness.context.fetch
    if (asset === groupedAssets.at(-1)) fetchAfterGrouped = harness.context.fetch
    if (route === PINNED_FULL_PROFILE_SHIM.route && asset === 'profile-image-auth-shim.js') {
      laterShimWasNoOp = harness.context.fetch === fetchBefore && harness.context.fetch === controllingShimFetch
    }
  }
  return { ...harness, registrations, runtimeAssets, controllingShimFetch, fetchAfterGrouped, laterShimWasNoOp }
}

test('immutable live captures and cutover candidates retain their ownership contract', () => {
  assert.equal(PROVENANCE.publishAuthorized, false)
  assert.equal(PROVENANCE.installAuthorized, false)
  assert.equal(PROVENANCE.nativeFormOwnership, 'webflow')
  validateLiveCaptureContract(PROVENANCE)
  for (const expected of Object.values(EXPECTED_LIVE_CAPTURES)) {
    assert.doesNotThrow(() => new vm.Script(source(expected.asset), { filename: expected.asset }))
  }
})

test('Full Profile pinned controlling shim retains its immutable served capture', () => {
  const bytes = fs.readFileSync(path.join(ROOT, PINNED_FULL_PROFILE_SHIM.asset))
  const body = bytes.toString('utf8')
  assert.equal(bytes.length, PINNED_FULL_PROFILE_SHIM.bytes)
  assert.equal(sha256(bytes), PINNED_FULL_PROFILE_SHIM.sha256)
  assert.doesNotThrow(() => new vm.Script(body, { filename: PINNED_FULL_PROFILE_SHIM.asset }))
})

test('build draft state keeps its published body as an immutable capture', () => {
  const candidate = EXPECTED_CANDIDATE_ASSETS['v3/build-profile/draft-state.js']
  const live = EXPECTED_LIVE_CAPTURES.buildDraftState
  const capture = source(candidate.liveCaptureAsset)
  assert.equal(capture.length, live.characters)
  assert.equal(sha256(capture), live.sha256)
  assert.equal(sha256(`<script>${capture}</script>`), live.embedSha256)
  assert.doesNotThrow(() => new vm.Script(capture, { filename: candidate.liveCaptureAsset }))
})

test('the immutable live oracle rejects coordinated source and manifest drift', () => {
  const changed = `${source('v3/profile-form/shared-foundation.js')}\n// coordinated drift`
  const provenance = structuredClone(PROVENANCE)
  provenance.sources.sharedFoundation.publishedBodyCharacters = changed.length
  provenance.sources.sharedFoundation.publishedBodySha256 = sha256(changed)
  assert.throws(() => validateLiveCaptureContract(
    provenance,
    (asset) => asset === 'v3/profile-form/shared-foundation.js' ? changed : source(asset),
  ), /sharedFoundation: live length/)
})

test('the candidate oracle rejects coordinated normalized source and manifest drift', () => {
  const asset = 'v3/profile-form/shared-foundation.js'
  const changed = `${source(asset)}// coordinated candidate drift\n`
  const provenance = structuredClone(PROVENANCE)
  provenance.candidateAssets[asset].candidateCharacters = changed.length
  provenance.candidateAssets[asset].candidateSha256 = sha256(changed)
  assert.throws(() => validateLiveCaptureContract(
    provenance,
    (requestedAsset) => requestedAsset === asset ? changed : source(requestedAsset),
  ), /shared-foundation\.js: candidate manifest/)
})

test('candidate loader contract has exact deferred jsDelivr composition per route', () => {
  const routes = parseAndValidateLoaderContract(source(LOADER_CONTRACT_FILE))
  validateGroupedCutover(PROVENANCE, routes)
})

test('candidate loader contract fails bad URLs, missing defer, reorder, and both location owners', () => {
  const valid = source(LOADER_CONTRACT_FILE)
  assert.throws(
    () => parseAndValidateLoaderContract(valid.replace('cdn.jsdelivr.net/gh/the-starters', 'cdn.example.test/gh/the-starters')),
    /wrong jsDelivr owner or version URL/,
  )
  assert.throws(() => parseAndValidateLoaderContract(valid.replace('<script defer src=', '<script src=')), /only defer and src/)
  assert.throws(
    () => parseAndValidateLoaderContract(valid.replace(
      /(<script defer src="[^"]+shared-foundation\.js"><\/script>)\n  (<script defer src="[^"]+draft-state\.js"><\/script>)/,
      '$2\n  $1',
    )),
    /loader order or route ownership/,
  )
  assert.throws(
    () => parseAndValidateLoaderContract(valid.replace(
      /(<template data-profile-form-route="\/build-profile\/consult">[\s\S]*?locations-consult\.js"><\/script>)/,
      '$1\n  <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/build-profile/locations-full-profile.js"></script>',
    )),
    /loader order or route ownership/,
  )
  assert.throws(
    () => parseAndValidateLoaderContract(valid.replace('</script>', 'window.inlineAppLogic = true</script>')),
    /inline application logic/,
  )
  const sharedLoader = '  <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/v3/profile-form/shared-foundation.js"></script>'
  assert.throws(
    () => parseAndValidateLoaderContract(valid.replace(sharedLoader, `${sharedLoader}\n${sharedLoader}`)),
    /duplicate loader/,
  )
})

test('page-head cutover rejects wrong phase order, repeated shared removal, wrong install, missed removal, altered loader, and route mix', () => {
  const routes = parseAndValidateLoaderContract(source(LOADER_CONTRACT_FILE))

  const wrongPhaseOrder = structuredClone(PROVENANCE)
  ;[wrongPhaseOrder.executionOrder[0], wrongPhaseOrder.executionOrder[1]] = [
    wrongPhaseOrder.executionOrder[1], wrongPhaseOrder.executionOrder[0],
  ]
  assert.throws(() => validateGroupedCutover(wrongPhaseOrder, routes), /wrong cutover execution order/)

  const repeatedSharedRemoval = structuredClone(PROVENANCE)
  repeatedSharedRemoval.routeCutovers[0].remove.unshift({
    scope: 'shared-component',
    componentId: repeatedSharedRemoval.componentWideRemovals.componentId,
    ...repeatedSharedRemoval.componentWideRemovals.remove[2],
  })
  assert.throws(() => validateGroupedCutover(repeatedSharedRemoval, routes), /missed, extra, or moved removal|shared removal must be component-wide/)

  const wrongInstall = structuredClone(PROVENANCE)
  wrongInstall.routeCutovers[1].install.scope = 'shared-component'
  assert.throws(() => validateGroupedCutover(wrongInstall, routes), /wrong page-head install contract/)

  const missedRemoval = structuredClone(PROVENANCE)
  missedRemoval.routeCutovers[1].remove.pop()
  assert.throws(() => validateGroupedCutover(missedRemoval, routes), /missed, extra, or moved removal/)

  const alteredExisting = structuredClone(PROVENANCE)
  alteredExisting.routeCutovers[1].preserveLoaders[0].url = alteredExisting.routeCutovers[1].preserveLoaders[0].url.replace('profile-photo.js', 'profile-photo-v2.js')
  assert.throws(() => validateGroupedCutover(alteredExisting, routes), /existing loader drift/)

  const routeMix = structuredClone(PROVENANCE)
  ;[routeMix.routeCutovers[1].pageId, routeMix.routeCutovers[2].pageId] = [
    routeMix.routeCutovers[2].pageId, routeMix.routeCutovers[1].pageId,
  ]
  assert.throws(() => validateGroupedCutover(routeMix, routes), /wrong page binding/)
})

test('grouped cutover rejects a missing, moved, or altered Full Profile controlling shim', () => {
  const routes = parseAndValidateLoaderContract(source(LOADER_CONTRACT_FILE))

  const missing = structuredClone(PROVENANCE)
  missing.routeCutovers[2].preserveLoaders.shift()
  assert.throws(() => validateGroupedCutover(missing, routes), /existing loader drift/)

  const moved = structuredClone(PROVENANCE)
  moved.routeCutovers[2].preserveLoaders[0].publishedScriptIndex = 31
  assert.throws(() => validateGroupedCutover(moved, routes), /existing loader drift/)

  const missingFromRuntime = structuredClone(PROVENANCE)
  missingFromRuntime.runtimeAssets['/build-profile/full-profile'].beforeGroupedAnchorPreserveIndexes = []
  assert.throws(() => validateGroupedCutover(missingFromRuntime, routes), /runtime pre-anchor assets/)

  const movedInRuntime = structuredClone(PROVENANCE)
  movedInRuntime.runtimeAssets['/build-profile/full-profile'].beforeGroupedAnchorPreserveIndexes = [31]
  assert.throws(() => validateGroupedCutover(movedInRuntime, routes), /runtime pre-anchor assets/)

  for (const [field, value] of [
    ['url', 'https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.56.15/profile-image-auth-shim.js'],
    ['servedBytes', 16264],
    ['servedSha256', '0'.repeat(64)],
  ]) {
    const altered = structuredClone(PROVENANCE)
    altered.routeCutovers[2].preserveLoaders[0][field] = value
    assert.throws(() => validateGroupedCutover(altered, routes), /existing loader drift/, field)
  }
})

test('shared foundation owns the empty profile model without creating a form', () => {
  const document = createDocument()
  const context = createBaseContext({ document })
  run('v3/profile-form/shared-foundation.js', context)

  assert.deepEqual(JSON.parse(JSON.stringify(context.activeProfile)), {
    type: 'full',
    type_id: 'a52dcf2c568fa40bf96cd67e4f8c6186',
    last_update: null,
    data: {},
  })
  assert.equal(context.isValidEmail('profile@example.com'), true)
  assert.equal(context.isValidEmail('bad-address'), false)
  assert.equal(document.createdTags.includes('form'), false)
})

test('each deferred controller registers one boot and never creates a replacement form', async () => {
  const files = [
    'v3/profile-form/incremental-dropdowns.js',
    'v3/starter-edit-profile/canonical-profile-loader.js',
    'v3/build-profile/draft-state.js',
    'v3/build-profile/submit-writer.js',
    'v3/build-profile/locations-consult.js',
    'v3/build-profile/locations-full-profile.js',
  ]

  for (const file of files) {
    const document = createDocument({
      '[data-form="step"]': [],
      '[increment-dropdowns]': [],
      'input.with-count, textarea.with-count': [],
    })
    const context = createBaseContext({
      MEMBER: { id: '' },
      activeProfile: { type: 'full', type_id: 'full-id', last_update: null, data: {} },
      createEmptyProfile: (type = 'full', typeId = 'full-id', updated = null) => ({ type, type_id: typeId, last_update: updated, data: {} }),
      document,
      formatRateInputs() {},
      isValidEmail() { return true },
      ensureErrorElements() {},
    })
    context.window.addEventListener = () => {}
    context.window.intlTelInput = () => ({})

    run(file, context)
    run(file, context)
    assert.equal(document.listeners.get('DOMContentLoaded').length, 1, file)
    await document.listeners.get('DOMContentLoaded')[0]()
    assert.equal(document.createdTags.includes('form'), false, file)
  }
})

test('each route controller set coexists in one browser context with one authored owner per handler', async () => {
  const routes = parseAndValidateLoaderContract(source(LOADER_CONTRACT_FILE))
  for (const [route, assets] of Object.entries(routes)) {
    const { boots, controls, document } = await executeRouteLoaders(route, assets)
    assert.equal(document.createdTags.includes('form'), false, `${route}: generated replacement form`)

    if (route === '/starter-edit-profile') {
      assert.equal(boots.length, 3, `${route}: boot owners`)
      assert.equal(controls.country.listeners.get('change').length, 1, `${route}: country owner`)
      assert.equal(controls.state.listeners.get('change').length, 1, `${route}: state owner`)
      continue
    }

    assert.equal(boots.length, 4, `${route}: boot owners`)
    assert.equal(controls.submit.listeners.get('click').length, 1, `${route}: submit owner`)
    assert.equal(controls.form.listeners.get('input').length, 1, `${route}: form input owner`)
    assert.equal(controls.form.listeners.get('change').length, 1, `${route}: form change owner`)
    assert.equal(controls.email.listeners.get('input').length, 1, `${route}: email input owner`)
    assert.equal(controls.country.listeners.get('change').length, 1, `${route}: country owner`)
    assert.equal(controls.state.listeners.get('change').length, 1, `${route}: state owner`)
    assert.equal(assets.includes('v3/build-profile/locations-consult.js'), route === '/build-profile/consult')
    assert.equal(assets.includes('v3/build-profile/locations-full-profile.js'), route === '/build-profile/full-profile')
  }
})

test('complete route order preserves the Full Profile controlling shim and every grouped or post-anchor owner', () => {
  const routes = parseAndValidateLoaderContract(source(LOADER_CONTRACT_FILE))
  validateGroupedCutover(PROVENANCE, routes)

  for (const [route, groupedAssets] of Object.entries(routes)) {
    const { context, document, registrations, runtimeAssets, controllingShimFetch, fetchAfterGrouped, laterShimWasNoOp } = executeCompleteRouteSequence(route, groupedAssets)
    const anchorIndex = EXPECTED_ROUTE_BINDINGS[route].anchorIndex
    const existing = EXPECTED_EXISTING_ROUTE_LOADERS[route]
    const beforeAnchorAssets = existing.filter(([index]) => index < anchorIndex).map(([, , asset]) => asset)
    const afterAnchorAssets = existing.filter(([index]) => index > anchorIndex).map(([, , asset]) => asset)
    assert.deepEqual(runtimeAssets, [...beforeAnchorAssets, ...groupedAssets, ...afterAnchorAssets], `${route}: runtime asset order`)
    assert.equal(document.createdTags.includes('form'), false, `${route}: generated replacement form`)
    assert.deepEqual(
      registrations.map(({ target, type, asset }) => [target, type, asset]),
      EXPECTED_COMPLETE_REGISTRATIONS[route],
      `${route}: complete boot and handler registration order`,
    )

    const firstPostAnchorRegistration = registrations.findIndex((entry) => afterAnchorAssets.includes(entry.asset))
    const extractedRegistrations = registrations.filter((entry) => groupedAssets.includes(entry.asset))
    assert.ok(extractedRegistrations.length > 0, `${route}: no extracted boot registration`)
    assert.ok(firstPostAnchorRegistration > registrations.indexOf(extractedRegistrations.at(-1)), `${route}: post-anchor controller registered before grouped extraction completed`)
    if (route === PINNED_FULL_PROFILE_SHIM.route) {
      assert.equal(runtimeAssets[0], PINNED_FULL_PROFILE_SHIM.asset)
      assert.equal(context.__tsProfileImageAuthShim, true)
      assert.equal(typeof controllingShimFetch, 'function')
      assert.equal(fetchAfterGrouped, controllingShimFetch, `${route}: grouped controllers replaced the controlling shim fetch owner`)
      assert.equal(laterShimWasNoOp, true, `${route}: later @latest shim did not honor first-load guard`)
    }
  }
})

test('edit locations boot once and preserve country, state, and city transitions', async () => {
  const country = new Element('select')
  const state = new Element('select')
  const city = new Element('select')
  const stateAsterisk = new Element('span')
  const cityAsterisk = new Element('span')
  for (const select of [country, state, city]) {
    const placeholder = new Element('option')
    placeholder.value = ''
    select.appendChild(placeholder)
  }
  const document = createDocument({
    '#country': country,
    '#state': state,
    '#city': city,
    '[state-asterisk]': stateAsterisk,
    '[city-asterisk]': cityAsterisk,
  })
  const locationData = [
    { name: 'United States', states: [{ name: 'California', cities: [{ name: 'Los Angeles' }] }] },
    { name: 'Singapore', states: [] },
  ]
  const context = createBaseContext({
    activeProfile: { data: {} },
    document,
    fetch: async () => ({ json: async () => locationData }),
  })

  run('v3/starter-edit-profile/locations.js', context)
  assert.equal(context.locationsReady, false)
  assert.equal(document.listeners.get('DOMContentLoaded').length, 1)
  await document.listeners.get('DOMContentLoaded')[0]()
  await settle()

  assert.equal(context.locationsReady, true)
  assert.equal(country.options.length, 3)
  country.value = '0'
  country.dispatchEvent(event('change'))
  assert.equal(state.disabled, false)
  assert.equal(state.required, true)
  assert.equal(state.options[1].textContent, 'California')

  state.value = '0'
  state.dispatchEvent(event('change'))
  assert.equal(city.disabled, false)
  assert.equal(city.required, true)
  assert.equal(city.options[1].value, 'Los Angeles')

  country.value = '1'
  country.dispatchEvent(event('change'))
  assert.equal(state.required, false)
  assert.equal(city.required, false)
  assert.equal(document.createdTags.includes('form'), false)
})

const HYDRATED_IDENTITY = Object.freeze({
  'first-name': 'Ada', 'last-name': 'Lovelace', email: 'profile@example.com', phone: '+15550000000',
})

function memberBoundFields() {
  return ['first-name', 'last-name', 'email', 'phone'].map((name) => {
    const field = new Element('input')
    field.name = name
    field.hasAttribute = (attribute) => attribute === 'data-ms-member'
    return field
  })
}

async function runDraftCase({ localProfile, memberProfile, member, stepFields = [] }) {
  const values = new Map([
    ['ts:build_profile:member:member-1', JSON.stringify(localProfile)],
  ])
  const memberUpdates = []
  const steps = []
  if (stepFields.length) {
    const step = new Element('div')
    step.getAttribute = (name) => name === 'data-index' ? '1' : null
    step.querySelectorAll = (selector) => selector === '[data-input-capture]' ? stepFields : []
    steps.push(step)
  }
  const document = createDocument({ '[data-form="step"]': steps, 'input.with-count, textarea.with-count': [] })
  const context = createBaseContext({
    MEMBER: member || { id: 'member-1', auth: { email: 'profile@example.com' }, customFields: {} },
    document,
    localStorage: {
      getItem(key) { return values.get(key) || null },
      setItem(key, value) { values.set(key, value) },
      removeItem(key) { values.delete(key) },
    },
  })
  context.window.$memberstackDom = {
    async getMemberJSON() { return { data: { build_profile: memberProfile } } },
    async updateMemberJSON(value) { memberUpdates.push(value) },
  }
  run('v3/profile-form/shared-foundation.js', context)
  run('v3/build-profile/draft-state.js', context)
  assert.equal(document.listeners.get('DOMContentLoaded').length, 1)
  await document.listeners.get('DOMContentLoaded')[0]()
  await settle()
  return { context, memberUpdates, values }
}

test('build draft state keeps the newest local draft and syncs it once', async () => {
  const localProfile = { type: 'consult', type_id: 'consult-id', last_update: 200, data: { step_1: { tagline: 'local' } } }
  const memberProfile = { type: 'full', type_id: 'full-id', last_update: 100, data: { step_1: { tagline: 'member' } } }
  const { context, memberUpdates } = await runDraftCase({ localProfile, memberProfile })

  assert.equal(context.activeProfile.type, 'consult')
  assert.equal(context.activeProfile.data.step_1.tagline, 'local')
  assert.equal(memberUpdates.length, 1)
  assert.equal(memberUpdates[0].json.build_profile.data.step_1.tagline, 'local')
})

test('build draft state keeps a newer member draft without a reverse sync', async () => {
  const localProfile = { type: 'consult', type_id: 'consult-id', last_update: 100, data: { step_1: { tagline: 'local' } } }
  const memberProfile = { type: 'full', type_id: 'full-id', last_update: 200, data: { step_1: { tagline: 'member' } } }
  const { context, memberUpdates } = await runDraftCase({ localProfile, memberProfile })

  assert.equal(context.activeProfile.type, 'full')
  assert.equal(context.activeProfile.data.step_1.tagline, 'member')
  assert.equal(memberUpdates.length, 0)
})

test('build draft state hydrates blank member-bound fields from the signed-in member', async () => {
  const fields = memberBoundFields()
  const localProfile = {
    type: 'full', type_id: 'full-id', last_update: 200,
    data: { step_1: { 'first-name': '', 'last-name': '', email: '', phone: '' } },
  }
  const memberProfile = {
    type: 'full', type_id: 'full-id', last_update: 100,
    data: { step_1: { 'first-name': '', 'last-name': '', email: '', phone: '' } },
  }

  const { context, memberUpdates, values } = await runDraftCase({
    localProfile,
    memberProfile,
    stepFields: fields,
    member: {
      id: 'member-1',
      auth: { email: 'profile@example.com' },
      customFields: { 'free-user': 'Ada', 'last-name': 'Lovelace', phone: '+15550000000' },
    },
  })

  assert.deepEqual(fields.map((field) => field.value), [
    'Ada', 'Lovelace', 'profile@example.com', '+15550000000',
  ])
  assert.deepEqual(context.activeProfile.data.step_1, HYDRATED_IDENTITY)
  assert.deepEqual(
    JSON.parse(values.get('ts:build_profile:member:member-1')).data.step_1,
    HYDRATED_IDENTITY,
  )
  assert.equal(memberUpdates.length, 1)
  assert.deepEqual(memberUpdates[0].json.build_profile.data.step_1, HYDRATED_IDENTITY)
})

test('build draft state hydrates a first-visit draft that has no member-bound keys', async () => {
  const fields = memberBoundFields()

  const { context, values } = await runDraftCase({
    localProfile: null,
    memberProfile: null,
    stepFields: fields,
    member: {
      id: 'member-1',
      auth: { email: 'profile@example.com' },
      customFields: { 'free-user': 'Ada', 'last-name': 'Lovelace', phone: '+15550000000' },
    },
  })

  assert.deepEqual(fields.map((field) => field.value), [
    'Ada', 'Lovelace', 'profile@example.com', '+15550000000',
  ])
  assert.deepEqual({ ...context.activeProfile.data.step_1 }, HYDRATED_IDENTITY)
  assert.deepEqual(
    JSON.parse(values.get('ts:build_profile:member:member-1')).data.step_1,
    HYDRATED_IDENTITY,
  )
})

test('build draft state leaves an unmapped member-bound field untouched', async () => {
  const field = new Element('input')
  field.name = 'company'
  field.value = 'Memberstack prefill'
  field.hasAttribute = (attribute) => attribute === 'data-ms-member'

  const { context } = await runDraftCase({
    localProfile: null,
    memberProfile: null,
    stepFields: [field],
    member: { id: 'member-1', auth: { email: 'profile@example.com' }, customFields: {} },
  })

  assert.equal(field.value, 'Memberstack prefill')
  assert.deepEqual({ ...context.activeProfile.data.step_1 }, {})
})

test('build draft state preserves non-empty member-bound draft edits', async () => {
  const email = new Element('input')
  email.name = 'email'
  email.hasAttribute = (attribute) => attribute === 'data-ms-member'
  const localProfile = {
    type: 'full', type_id: 'full-id', last_update: 200,
    data: { step_1: { email: 'draft@example.com' } },
  }

  await runDraftCase({
    localProfile,
    memberProfile: { type: 'full', type_id: 'full-id', last_update: 100, data: { step_1: {} } },
    stepFields: [email],
    member: { id: 'member-1', auth: { email: 'profile@example.com' }, customFields: {} },
  })

  assert.equal(email.value, 'draft@example.com')
})

test('edit canonical loader hydrates authored fields without a load-time mutation', async () => {
  const country = new Element('select')
  const state = new Element('select')
  const city = new Element('select')
  for (const [select, value, label] of [
    [country, '0', 'United States'], [state, '0', 'California'], [city, 'Los Angeles', 'Los Angeles'],
  ]) {
    const option = new Element('option')
    option.value = value
    option.textContent = label
    select.appendChild(option)
  }
  const firstName = new Element('input')
  firstName.name = 'first-name'
  firstName.value = ''
  const step = new Element('div')
  step.getAttribute = (name) => name === 'data-index' ? '1' : null
  step.querySelectorAll = (selector) => selector === '[data-input-capture]' ? [firstName] : []
  const document = createDocument({
    '#country': country, '#state': state, '#city': city,
    '[data-form="step"]': [step],
    'input.with-count, textarea.with-count': [],
  })
  const reads = []
  const context = createBaseContext({
    MEMBER: { id: 'member-1' },
    activeProfile: { type: 'full', type_id: 'full-id', last_update: null, data: {} },
    createEmptyProfile: (type = 'full', typeId = 'full-id', updated = null) => ({ type, type_id: typeId, last_update: updated, data: {} }),
    document,
    locationsReady: true,
    xanoAuthFetch: async (url, options) => {
      reads.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            Profile_Type: 'full', Profile_Type_ID: 'full-id', Updated_On: 123,
            First_Name: 'Ada', Last_Name: 'Lovelace', Email: 'ada@example.com',
            Country: 'United States', State_Province: 'California', City: 'Los Angeles',
            Also_Worked_With: [], Services: {}, Reviewers: {},
          }
        },
      }
    },
  })
  context.window.addEventListener = () => {}

  run('v3/starter-edit-profile/canonical-profile-loader.js', context)
  assert.equal(document.listeners.get('DOMContentLoaded').length, 1)
  await document.listeners.get('DOMContentLoaded')[0]()
  await new Promise((resolve) => setTimeout(resolve, 45))

  assert.equal(reads.length, 1)
  assert.equal(reads[0].options.method, 'POST')
  assert.equal(firstName.value, 'Ada')
  assert.equal(context.activeProfile.data.step_1.email, 'ada@example.com')
})

test('build submit writer sends one normalized payload through the authored form', async () => {
  const updated = 1770000000123
  const listeners = new Map()
  const submit = new Element('button')
  const form = new Element('form')
  form.style = {}
  submit.closest = () => new Element('div')
  const success = new Element('div')
  const failure = new Element('div')
  const country = new Element('select')
  const countryOption = new Element('option')
  countryOption.value = '0'; countryOption.text = 'United States'; countryOption.textContent = 'United States'; country.appendChild(countryOption)
  const state = new Element('select')
  const stateOption = new Element('option')
  stateOption.value = '0'; stateOption.text = 'California'; stateOption.textContent = 'California'; state.appendChild(stateOption)
  const formEntries = [
    ['email', 'profile@example.com'], ['first-name', 'Ada'], ['last-name', 'Lovelace'],
    ['phone', '+15550000000'], ['city', 'Los Angeles'], ['function-option', 'Engineering'],
    ['function', 'category-id'], ['role-option', 'Developer'], ['roles', 'role-id'],
    ['skill-option', 'JavaScript'], ['skills', 'skill-id'], ['tool-option', 'Webflow'],
    ['tools', 'tool-id'], ['industries-option', 'SaaS'], ['industries', 'industry-id'],
    ['subcategories-option', 'Automation'], ['subcategories', 'subcategory-id'],
    ['tagline', 'Profile tagline'], ['pro-headline', 'Profile headline'], ['bio-html', '<p>Bio</p>'],
    ['best-fit-1', 'Startups'], ['rate', '125.6'], ['availability-option', '11-20'],
    ['availability', 'availability-id'], ['full-time-placement', 'yes'],
    ['free-consulting-calls', 'no'], ['paid-consulting-calls', 'no'],
    ['paid-call-description', 'Strategy call'], ['paid-call-rate', '199.6'],
    ['offer-monthly-retainers', 'yes'], ['rate-retainer', '2500.4'],
    ['service', JSON.stringify({ name: 'Audit', price: 500 })],
    ['reviewer', JSON.stringify({ fname: 'Grace', lname: 'Hopper', job: 'CTO', company: 'Navy', email: 'grace@example.com' })],
    ['also-worked-with', JSON.stringify({ one: { name: 'Example' } })],
  ]
  class TestFormData {
    constructor(value) { assert.equal(value, form) }
    *[Symbol.iterator]() { yield* formEntries }
  }
  const document = createDocument()
  const qs = (selector, root) => {
    if (selector === '[build-profile-form]') return form
    if (selector === '[form-submit]' && root === form) return submit
    if (selector === '[build-profile-success]') return success
    if (selector === '[build-profile-error]') return failure
    if (selector === '#country') return country
    if (selector === '#state') return state
    return null
  }
  const requests = []
  const loaderStates = []
  const context = createBaseContext({
    Date: class extends Date { static now() { return updated } },
    FormData: TestFormData,
    MEMBER: {
      id: 'member-1',
      auth: { email: 'profile@example.com' },
      customFields: { 'free-user': 'Ada', 'last-name': 'Lovelace', phone: '+15550000000' },
    },
    activeProfile: { type: 'full', type_id: 'full-id' },
    document,
    qs,
    setLoader(value) { loaderStates.push(value) },
    xanoAuthFetch: async (url, options) => {
      requests.push({ url, options })
      return { ok: true, async json() { return { ok: true } } }
    },
  })
  context.window.location = { pathname: '/build-profile/consult' }
  context.window.intlTelInput = { getInstance() { return { getNumber() { return '+15550000000' } } } }

  run('v3/build-profile/submit-writer.js', context)
  run('v3/build-profile/submit-writer.js', context)
  assert.equal(document.listeners.get('DOMContentLoaded').length, 1)
  await document.listeners.get('DOMContentLoaded')[0]()
  assert.equal(submit.listeners.get('click').length, 1)
  await submit.listeners.get('click')[0](event('click'))

  assert.equal(requests.length, 1)
  assert.deepEqual({
    url: requests[0].url,
    method: requests[0].options.method,
    headers: JSON.parse(JSON.stringify(requests[0].options.headers)),
    payload: JSON.parse(requests[0].options.body),
  }, {
    url: 'https://x08a-5ko8-jj1r.n7c.xano.io/api:KZf7nFnk/build_profile/starter/update',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: {
      member_id: 'member-1', type: 'full', type_id: 'full-id',
      email: 'profile@example.com', first_name: 'Ada', last_name: 'Lovelace', phone: '+15550000000',
      country: 'United States', state: 'California', city: 'Los Angeles',
      category: 'Engineering', category_id: 'category-id', roles: 'Developer', roles_ids: 'role-id',
      skills: 'JavaScript', skills_ids: 'skill-id', tools: 'Webflow', tools_ids: 'tool-id',
      industries: 'SaaS', industries_ids: 'industry-id', subcategories: 'Automation', subcategories_ids: 'subcategory-id',
      tagline: 'Profile tagline', pro_headline: 'Profile headline', bio: '<p>Bio</p>',
      best_fit_1: 'Startups', best_fit_2: '', best_fit_3: '', hourly_rate: 126,
      availability: '11-20', availability_id: 'availability-id', full_time: true,
      free_call: false, free_call_desc: '', paid_call: true, paid_call_desc: 'Strategy call', paid_call_rate: 200,
      retainer: true, retainer_desc: '', retainer_rate: 2500,
      services: { 'service-1': { name: 'Audit', price: 500 }, 'service-2': null, 'service-3': null },
      reviewers: {
        'reviewer-1': { 'first-name': 'Grace', 'last-name': 'Hopper', position: 'CTO', company: 'Navy', email: 'grace@example.com' },
        'reviewer-2': null,
        'reviewer-3': null,
      },
      also_worked_with: { one: { name: 'Example' } },
      updated,
    },
  })
  assert.deepEqual(loaderStates, [true, false])
  assert.equal(form.style.display, 'none')
  assert.equal(success.style.display, 'block')
})
