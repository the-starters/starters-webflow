const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const DIR = __dirname
const EXPECTED = {
  'bio-editor.js': '91671c4ed05806b2ed306f50c265954ef0c36714f59c77f721e2510370c9273f',
  'company-autocomplete.js': 'eb426e9899ccfc9976c5eb061930f122d54542fa33f4453a0602aae48f842f4c',
  'company-experience-crud.js': '6dc7fa7306d9558fb493cb6a6cfd6196659e0b7005c6d49831ffcc5f3261b5d3',
  'field-counters.js': 'decbf5b49d1006f8a857602a33e2d89a6270fa8b9355d6311d16188f6a4bfe83',
  'grouped-selects.js': 'e80bb01f28a43ebcb5b28e8ea733bac273985ddfa3235179cdfc6a9a5168ae84',
  'portfolio-crud.js': '7ab803c9890b802f154c6f5c3f0a6d5906624f71b9683153b2f5798617e1070d',
  'portfolio-list.js': 'ddbc94bf09e237e7fc016b73c3ab0a4f361e38ba5105840c4c568886841b3255',
  'profile-photo.js': '213646b19cc04f2b87375afeb303cc7ebe1f598cd5ffa4ce471b7c4ca895cf5c',
  'work-dates.js': '4d8aa2dbd4c7668f37430a73c92049a7a5fa566d99915f5e45a61be5dac0c321',
}

function source(file) {
  return fs.readFileSync(path.join(DIR, file), 'utf8')
}

test('inventory contains exactly the nine scoped GitHub-owned controllers', () => {
  const actual = fs.readdirSync(DIR).filter((file) => file.endsWith('.js') && !file.endsWith('.test.js')).sort()
  assert.deepEqual(actual, Object.keys(EXPECTED).sort())
})

test('each captured controller remains valid as a standalone classic script', () => {
  for (const file of Object.keys(EXPECTED)) {
    assert.doesNotThrow(() => new vm.Script(source(file), { filename: file }), file)
  }
})

test('each controller keeps its exact live-body evidence hash in source', () => {
  for (const [file, hash] of Object.entries(EXPECTED)) {
    assert.match(source(file), new RegExp(`Original live inline body SHA-256: ${hash}`), file)
  }
})

test('the migrated blocks exclude Elvin-owned workflow terms and browser secrets', () => {
  for (const file of Object.keys(EXPECTED)) {
    const text = source(file)
    assert.doesNotMatch(text, /availability|booking|paid[_-]?call|free-consulting/i, file)
    assert.doesNotMatch(text, /api\.airtable\.com|hook\.us1\.make\.com|\bpat[A-Za-z0-9]{20,}/, file)
    assert.doesNotMatch(text, /<form\b/i, `${file} must bind authored Webflow markup`)
  }
})

