const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// The bio editor exists twice: once as the Build Profile asset, once embedded in the
// Starter Edit Profile controller. Only one of the two is ever loaded on a page, so a
// change to one is invisible on the other surface until a member finds the difference.
// These tests pin the character-limit contract and the clone parity that protects it.

const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8')

const bioEditor = read('v3/build-profile/bio-editor.js')
const fieldCounters = read('v3/build-profile/field-counters.js')
const editProfile = read('starter-edit-profile.js')
const formContract = read('v3/starter-edit-profile/published-form-contract.js')

// Returns the source of `function <name>(...) { ... }`, braces balanced.
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist`)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1).replace(/\s+/g, ' ')
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const BIO_SURFACES = [
  ['v3/build-profile/bio-editor.js', bioEditor],
  ['starter-edit-profile.js', editProfile],
]

for (const [label, source] of BIO_SURFACES) {
  test(`${label}: the bio limit is characters, read from data-max-chars, default 1500`, () => {
    assert.match(source, /const MAX_CHARS = Number\(outputPlain\.dataset\.maxChars\) \|\| 1500;/)
    assert.doesNotMatch(source, /MAX_WORDS/)
    assert.doesNotMatch(source, /getQuillWordCount|trimTextToWords|countWordsFromText/)
  })

  test(`${label}: the character count is the plain text minus its trailing newline`, () => {
    assert.equal(
      functionSource(source, 'getQuillCharCount'),
      'function getQuillCharCount(quillInstance) { return countCharsFromText(getPlainQuillText(quillInstance)); }',
    )
    assert.equal(
      functionSource(source, 'getPlainQuillText'),
      'function getPlainQuillText(quillInstance) { return stripTrailingNewline(quillInstance.getText()); }',
    )
  })

  test(`${label}: overflow reverts to the previous contents`, () => {
    assert.match(source, /if \(getQuillCharCount\(bioEditor\) > MAX_CHARS\) \{/)
    assert.match(source, /bioEditor\.setContents\(prevContents, 'silent'\);/)
    // Whitespace could not raise a word count; it can raise a character count.
    assert.doesNotMatch(source, /hasOnlyWhitespaceInsert/)
  })

  test(`${label}: paste is trimmed to the remaining characters`, () => {
    assert.match(source, /const availableChars = MAX_CHARS - baseCharCount;/)
    assert.match(source, /const allowedPaste = pastedText\.slice\(0, availableChars\);/)
  })

  test(`${label}: the editor owns the counter group`, () => {
    assert.match(source, /outputPlain\.removeAttribute\('count-by-words'\);/)
    assert.match(source, /setCounterDenominator\(counterSpan, MAX_CHARS\);/)
    // The counter write must come after the mirror events, so it survives them.
    const sync = functionSource(source, 'syncQuillValue')
    assert.ok(
      sync.indexOf("outputHtml.dispatchEvent(new Event('input'") <
        sync.indexOf('counterSpan.textContent'),
      'the counter write must be the last statement in syncQuillValue',
    )
    assert.match(sync, /String\(getQuillCharCount\(bioEditor\)\)\.padStart\(2, '0'\)/)
  })
}

test('the two bio blocks share one implementation of the counting contract', () => {
  for (const name of [
    'stripTrailingNewline',
    'getPlainQuillText',
    'normalizeCountText',
    'countCharsFromText',
    'getQuillCharCount',
    'setCounterDenominator',
    'handleQuillPaste',
    'hasAdjacentSpace',
    'getCleanQuillHTML',
  ]) {
    assert.equal(
      functionSource(editProfile, name),
      functionSource(bioEditor, name),
      `${name} must stay identical across both bio surfaces`,
    )
  }
})

test('the denominator is only rewritten when it is the authored /<number> text node', () => {
  const rewrite = functionSource(bioEditor, 'setCounterDenominator')
  assert.match(rewrite, /denominator\.nodeType !== 3/)
  assert.match(rewrite, /\/\^\(\\s\*\)\\\/\\d\+\(\\s\*\)\$\//)
})

test('generic counters stand down for a group owned by a rich-text editor', () => {
  for (const [label, source] of [
    ['v3/build-profile/field-counters.js', fieldCounters],
    ['starter-edit-profile.js', editProfile],
  ]) {
    const guard = source.indexOf("if (qs('[data-editor-id]', wrapper)) return;")
    const claim = source.indexOf("input.classList.add('initialized');")
    assert.notEqual(guard, -1, `${label} must skip editor-owned counter groups`)
    assert.ok(guard < claim, `${label} must skip before it claims the input`)
  }
})

test('data-max-chars survives the published-form contract sanitizer', () => {
  assert.match(formContract, /'data-max-chars',/)
  assert.match(formContract, /'data-max-words',/)
})
