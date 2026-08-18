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

// starter-edit-profile.js embeds a counterFields clone whose paste handler uses some
// of the same identifiers, so every assertion about the editor reads the bio block
// alone: from its limit declaration to the initial sync that closes the block.
function bioBlock(source) {
  const start = source.indexOf('const MAX_CHARS')
  const end = source.indexOf('\n\n\t\tsyncQuillValue();', start)
  assert.ok(start !== -1 && end !== -1, 'the bio block must be locatable')
  return source.slice(start, end)
}

const BIO_SURFACES = [
  ['v3/build-profile/bio-editor.js', bioBlock(bioEditor)],
  ['starter-edit-profile.js', bioBlock(editProfile)],
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

  test(`${label}: only an edit that grows an over-limit bio is reverted`, () => {
    // A bio saved under the old 300-word cap can be ~2000 characters. It must stay
    // editable downward, so the limit gates growth rather than existence.
    assert.match(source, /if \(charCount > MAX_CHARS && charCount > prevCharCount\) \{/)
    assert.match(source, /bioEditor\.setContents\(prevContents, 'silent'\);/)
    // Whitespace could not raise a word count; it can raise a character count.
    assert.doesNotMatch(source, /hasOnlyWhitespaceInsert/)
  })

  test(`${label}: the revert baseline advances synchronously, not in a frame`, () => {
    // A burst of keystrokes fires several text-change events before one animation
    // frame runs. A baseline refreshed only in the frame would revert accepted edits.
    const handler = source.slice(source.indexOf("bioEditor.on('text-change'"))
    const frame = handler.indexOf('requestAnimationFrame')
    assert.ok(handler.indexOf('prevCharCount = charCount;') < frame, 'baseline must advance before the frame')
    assert.equal(handler.slice(frame, handler.indexOf('});', frame)).includes('prevContents'), false)
  })

  test(`${label}: a restored over-limit bio is grandfathered, not wiped`, () => {
    // Assigning innerHTML leaves a pending Quill mutation. Flushed inside the
    // isCleaning window, it cannot revert the member's own bio to the empty baseline.
    const restore = source.slice(source.indexOf('waitProfileData('), source.indexOf("bioEditor.root.addEventListener('paste'"))
    assert.ok(restore.indexOf('isCleaning = true;') < restore.indexOf('bioEditor.root.innerHTML = html;'))
    assert.ok(restore.indexOf('bioEditor.root.innerHTML = html;') < restore.indexOf('bioEditor.update();'))
    assert.ok(restore.indexOf('bioEditor.update();') < restore.indexOf('prevContents = bioEditor.getContents();'))
    assert.ok(restore.indexOf('prevCharCount = getQuillCharCount(bioEditor);') < restore.indexOf('isCleaning = false;'))
  })

  test(`${label}: paste is trimmed to the remaining characters, on a whole character`, () => {
    assert.match(source, /const availableChars = MAX_CHARS - baseCharCount;/)
    assert.match(source, /const allowedPaste = dropSplitSurrogate\(pastedText\.slice\(0, Math\.max\(availableChars, 0\)\)\);/)
    // The <= 0 early return is load-bearing: a negative end slices from the right.
    assert.ok(source.indexOf('if (availableChars <= 0) {') < source.indexOf('const allowedPaste ='))
  })

  test(`${label}: counting normalizes CRLF so one line break is one character`, () => {
    assert.match(functionSource(source, 'normalizeCountText'), /\.replace\(\/\\r\\n\?\/g, '\\n'\)/)
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
    assert.match(sync, /String\(countCharsFromText\(plain\)\)\.padStart\(2, '0'\)/)
    // One getText per sync: the plain mirror and the counter read the same string.
    assert.equal(sync.match(/getPlainQuillText\(bioEditor\)/g).length, 1)
  })

  test(`${label}: authoring drift warns on staging and stays silent in production`, () => {
    const warn = functionSource(source, 'warnAuthoring')
    assert.match(warn, /webflow\\\.io/)
    assert.match(warn, /trycloudflare/)
    assert.match(warn, /window\.STARTERS_DEBUG !== true/)
    assert.match(warn, /console\.warn/)
    // Both silent-no-op paths must reach it.
    const denominator = functionSource(source, 'setCounterDenominator')
    assert.equal(denominator.match(/warnAuthoring\(/g).length, 2)
  })
}

test('the two bio blocks share one implementation of the counting contract', () => {
  for (const name of [
    'stripTrailingNewline',
    'getPlainQuillText',
    'normalizeCountText',
    'countCharsFromText',
    'getQuillCharCount',
    'dropSplitSurrogate',
    'setCounterDenominator',
    'warnAuthoring',
    'handleQuillPaste',
    'syncQuillValue',
    'hasAdjacentSpace',
    'getCleanQuillHTML',
  ]) {
    assert.equal(
      functionSource(bioBlock(editProfile), name),
      functionSource(bioBlock(bioEditor), name),
      `${name} must stay identical across both bio surfaces`,
    )
  }
})

test('the denominator is only rewritten when it is the authored /<number> text node', () => {
  const rewrite = functionSource(bioEditor, 'setCounterDenominator')
  assert.match(rewrite, /denominator\.nodeType === 3/)
  assert.match(rewrite, /DENOMINATOR_PATTERN\.test\(authored\)/)
  // The pattern is anchored, so a wrapper that holds anything else is left alone.
  assert.ok(bioEditor.includes(String.raw`const DENOMINATOR_PATTERN = /^(\s*)\/\d+(\s*)$/;`))

  const pattern = /^(\s*)\/\d+(\s*)$/
  assert.equal('/300'.replace(pattern, '$1/1500$2'), '/1500')
  assert.equal('\n\t/300\n'.replace(pattern, '$1/1500$2'), '\n\t/1500\n')
  assert.equal(pattern.test('300'), false)
  assert.equal(pattern.test('/300 words'), false)
})

test('generic counters stand down for a group owned by a rich-text editor', () => {
  for (const [label, source] of [
    ['v3/build-profile/field-counters.js', fieldCounters],
    ['starter-edit-profile.js', editProfile],
  ]) {
    const guard = source.indexOf("if (qs('[data-editor-id]', wrapper)) {")
    assert.notEqual(guard, -1, `${label} must skip editor-owned counter groups`)

    // The skip claims the input on the way out, so a re-scan does not re-examine it,
    // and it still happens before the counter group is wired up.
    const guardBlock = source.slice(guard, source.indexOf('}', guard) + 1)
    assert.match(guardBlock, /input\.classList\.add\('initialized'\);/)
    assert.ok(guard < source.indexOf("const countSpan = qs('.count-input', wrapper);"))
    assert.ok(guard < source.indexOf('const byWords ='))
  }
})

test('data-max-chars survives the published-form contract sanitizer', () => {
  assert.match(formContract, /'data-max-chars',/)
  assert.match(formContract, /'data-max-words',/)
})
