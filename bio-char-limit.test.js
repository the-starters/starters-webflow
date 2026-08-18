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

// Position of `needle`, proving it is there first. Ordering assertions written as
// bare `indexOf(a) < indexOf(b)` pass when a is DELETED, since -1 sorts first, which
// makes every such guard vacuous against exactly the regression it exists to catch.
function at(source, needle, label) {
  const index = source.indexOf(needle)
  assert.notEqual(index, -1, `${label}: ${JSON.stringify(needle)} must be present`)
  return index
}

const BIO_SURFACES = [
  ['v3/build-profile/bio-editor.js', bioBlock(bioEditor)],
  ['starter-edit-profile.js', bioBlock(editProfile)],
]

const FULL_SOURCES = [
  ['v3/build-profile/bio-editor.js', bioEditor],
  ['starter-edit-profile.js', editProfile],
]

for (const [label, source] of FULL_SOURCES) {
  test(`${label}: no word-limit machinery survives anywhere in the file`, () => {
    // Whole-file, not block-scoped: the counter clone embedded in the edit-profile
    // controller counts words for other fields, but none of these names may return.
    assert.doesNotMatch(source, /MAX_WORDS/)
    assert.doesNotMatch(source, /getQuillWordCount|trimTextToWords|countWordsFromText/)
  })
}

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
    const handler = source.slice(at(source, "bioEditor.on('text-change'", label))
    const frame = at(handler, 'requestAnimationFrame', label)
    assert.ok(
      at(handler, 'prevCharCount = charCount;', label) < frame,
      'the baseline must advance before the frame',
    )
    const frameEnd = handler.indexOf('});', frame)
    assert.notEqual(frameEnd, -1, `${label}: the frame callback must be closed`)
    assert.equal(handler.slice(frame, frameEnd).includes('prevContents'), false)
  })

  test(`${label}: a restored over-limit bio is grandfathered, not wiped`, () => {
    // Assigning innerHTML leaves a pending Quill mutation. Flushed inside the
    // isCleaning window, it cannot revert the member's own bio to the empty baseline.
    const restore = source.slice(
      at(source, 'waitProfileData(', label),
      at(source, "bioEditor.root.addEventListener('paste'", label),
    )
    const step = (needle) => at(restore, needle, `${label} restore path`)

    assert.ok(step('isCleaning = true;') < step('bioEditor.root.innerHTML = html;'))
    assert.ok(step('bioEditor.root.innerHTML = html;') < step('bioEditor.update();'))
    assert.ok(step('bioEditor.update();') < step('prevContents = bioEditor.getContents();'))
    assert.ok(step('prevCharCount = getQuillCharCount(bioEditor);') < step('isCleaning = false;'))

    // Quill's History records the innerHTML restore as an undoable user change, so an
    // undo would shrink the bio to empty — and shrinking is what the gate allows.
    assert.ok(step('bioEditor.history?.clear?.();') < step('isCleaning = false;'))
  })

  test(`${label}: paste is trimmed to the remaining characters, on a whole character`, () => {
    assert.match(source, /const availableChars = MAX_CHARS - baseCharCount;/)
    assert.match(source, /const allowedPaste = dropSplitSurrogate\(pastedText\.slice\(0, Math\.max\(availableChars, 0\)\)\);/)
    // The <= 0 early return is load-bearing: a negative end slices from the right.
    assert.ok(at(source, 'if (availableChars <= 0) {', label) < at(source, 'const allowedPaste =', label))
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
      at(sync, "outputHtml.dispatchEvent(new Event('input'", label) <
        at(sync, 'counterSpan.textContent', label),
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

test('the two bio blocks are the same block, character for character', () => {
  // The primary parity guard. Comparing only named functions leaves the restore path,
  // the text-change handler and the counter-takeover init uncovered, and those are
  // exactly where the surfaces have drifted before.
  const editProfileBlock = bioBlock(editProfile).replace('window.activeProfile?.data', 'activeProfile?.data')

  assert.ok(
    bioBlock(editProfile).includes('window.activeProfile?.data'),
    'the edit-profile controller reads the profile off window; that is the one sanctioned divergence',
  )
  assert.equal(editProfileBlock, bioBlock(bioEditor))
})

test('each surface names itself in its own warnings', () => {
  // Declared outside the compared block on purpose, so the console names the script
  // that is actually loaded without breaking the block-parity assertion above.
  assert.ok(bioEditor.includes("const LOG_PREFIX = '[bio-editor]';"))
  assert.ok(editProfile.includes("const LOG_PREFIX = '[starter-edit-profile]';"))
  for (const [label, source] of BIO_SURFACES) {
    assert.equal(source.includes('LOG_PREFIX'), true, `${label} must warn through the prefix`)
    assert.equal(source.includes("const LOG_PREFIX"), false, `${label} must declare it outside the block`)
  }
})

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
