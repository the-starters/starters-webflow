const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// These READMEs are public documentation artifacts. Relative links and section
// anchors are part of their reader-facing navigation contract.
const DOCS = [
  'README.md',
  path.join('v3', 'README.md'),
  path.join('global-embeds', 'session-video', 'README.md'),
]

function slugify(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-')
}

function headingSlugs(file) {
  const slugs = new Set()
  const seen = new Map()
  let inFence = false

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (!heading) continue

    const base = slugify(heading[1])
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    slugs.add(count === 0 ? base : `${base}-${count}`)
  }

  return slugs
}

function relativeLinks(file) {
  const links = []
  const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g
  const source = fs.readFileSync(file, 'utf8')
  let match

  while ((match = pattern.exec(source))) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue

    const [relative, anchor] = target.split('#')
    links.push({
      target,
      file: path.resolve(path.dirname(file), relative),
      anchor,
    })
  }

  return links
}

const slugCache = new Map()
function slugsFor(file) {
  if (!slugCache.has(file)) slugCache.set(file, headingSlugs(file))
  return slugCache.get(file)
}

for (const doc of DOCS) {
  test(`${doc} relative links resolve to existing files`, () => {
    const links = relativeLinks(doc)
    assert.ok(links.length > 0, `${doc} has no relative links to check`)

    for (const link of links) {
      assert.ok(fs.existsSync(link.file), `${doc}: ${link.target} does not exist`)
    }
  })

  test(`${doc} relative link anchors resolve to headings`, () => {
    for (const link of relativeLinks(doc)) {
      if (!link.anchor) continue
      assert.ok(
        slugsFor(link.file).has(link.anchor),
        `${doc}: ${link.target} has no matching heading in ${path.basename(link.file)}`,
      )
    }
  })
}

test('pointer-style inventory entries retain an owner-document link', () => {
  const pointerEntries = [
    'quiz-main/quiz-main.js',
    'quiz-main/quiz-redirect.js',
    'v3/auth-route.js',
    'v3/route-guard.js',
    'v3/password-recovery.js',
    'v3/starters-ms-redirect.js',
    'v3/signup-attribution.js',
    'v3/saved-starters-roles.js',
    'v3/starter-dashboard-messages.js',
    'v3/starter-dashboard-points.js',
    'v3/onboarding-profile-preview.js',
    'v3/onboarding-done-redirect.js',
    'v3/patch-onboarding-status.js',
    'v3/build-profile-redirect.js',
    'v3/complete-profile-redirect.js',
    'v3/brand-profile-redirect.js',
    'v3/complete-profile-back.js',
    'account-settings/plan-dates.js',
    'v3/xano-grabber/xano-grabber.js',
    'v3/scheduling-availability-writer.js',
    'account-settings/ms-form-cancel-state.js',
    'global-embeds/session-video/session-video.js',
  ]

  const entries = new Map()
  let current = null

  for (const line of fs.readFileSync('README.md', 'utf8').split('\n')) {
    const start = /^-\s+`([^`]+)`/.exec(line)
    if (start) {
      current = start[1]
      entries.set(current, line)
    } else if (current && /^\s+\S/.test(line)) {
      entries.set(current, `${entries.get(current)} ${line.trim()}`)
    } else if (!line.trim()) {
      current = null
    }
  }

  for (const script of pointerEntries) {
    const entry = entries.get(script)
    assert.ok(entry, `README.md has no inventory entry for ${script}`)
    assert.match(
      entry,
      /\[[^\]]*\]\([^)\s]+\)/,
      `${script} no longer links to an owning document`,
    )
  }
})

// Coverage guard. The inventory went 68 entries short once because nothing
// failed when a shipped script was simply never listed — the link checks above
// only validate links that already exist, so an absent entry is invisible to
// them. Every committed browser script must therefore appear in the inventory,
// or be named in NON_BROWSER_SCRIPTS with the reason it is exempt.
const NON_BROWSER_SCRIPTS = new Set([
  // Node tooling and test harnesses: never served to a browser.
  'build-profile-wiring-audit.js',
  'step-flow-test-dom.js',
  // Read-only Slater.app exports kept as the readable reference for
  // v2/contract.js. Generated artifacts, never edited and never loaded.
  'slater/4885.readable.js',
  'slater/4885.prod.min.js',
  'slater/4960.readable.js',
  'slater/4960.prod.min.js',
])

// Directories whose contents are not part of the published CDN inventory.
const EXCLUDED_PREFIXES = [
  'code-components/', // parked Webflow React package, documented as a folder
  'local-demos/', // gitignored harness pages
  'node_modules/',
]

function committedScripts() {
  const { execFileSync } = require('node:child_process')
  return execFileSync('git', ['ls-files', '*.js'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.endsWith('.test.js'))
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
}

function inventoryScripts(readme) {
  const listed = new Set()

  let inInventory = false
  for (const line of readme.split('\n')) {
    if (line === '## Current Scripts') {
      inInventory = true
      continue
    }
    if (inInventory && /^##\s+/.test(line)) break
    if (!inInventory || !/^-\s+/.test(line)) continue

    const separator = line.indexOf(' — ')
    const label = separator === -1 ? line : line.slice(0, separator)
    for (const match of label.matchAll(/`([^`]+\.js)`/g)) {
      listed.add(match[1])
    }
  }

  return listed
}

function assertInventoryComplete(
  readme,
  nonBrowserScripts = NON_BROWSER_SCRIPTS,
) {
  const listed = inventoryScripts(readme)

  const missing = committedScripts().filter(
    (file) => !listed.has(file) && !nonBrowserScripts.has(file),
  )

  assert.deepEqual(
    missing,
    [],
    `these scripts are not in the README inventory (add an entry, or add to ` +
      `NON_BROWSER_SCRIPTS with a reason):\n  ${missing.join('\n  ')}`,
  )
}

test('every committed browser script appears in the README inventory', () => {
  assertInventoryComplete(fs.readFileSync('README.md', 'utf8'))
})

test('coverage ignores script mentions outside inventory labels', () => {
  const script = 'v3/signup-attribution.js'
  const readme = fs.readFileSync('README.md', 'utf8')
  const withoutInventoryEntry = readme
    .split('\n')
    .filter((line) => !line.startsWith(`- \`${script}\``))
    .join('\n')

  assert.throws(
    () => assertInventoryComplete(withoutInventoryEntry),
    (error) => error.message.includes(script),
  )
})

test('non-browser exemptions rely on the allowlist', () => {
  const readme = fs.readFileSync('README.md', 'utf8')

  assert.throws(
    () => assertInventoryComplete(readme, new Set()),
    (error) =>
      Array.from(NON_BROWSER_SCRIPTS).every((script) =>
        error.message.includes(script),
      ),
  )

  for (const script of NON_BROWSER_SCRIPTS) {
    const withoutScript = new Set(NON_BROWSER_SCRIPTS)
    withoutScript.delete(script)
    assert.throws(
      () => assertInventoryComplete(readme, withoutScript),
      (error) => error.message.includes(script),
    )
  }
})

test('the non-browser allowlist has no stale entries', () => {
  const committed = new Set(committedScripts())

  for (const file of NON_BROWSER_SCRIPTS) {
    assert.ok(
      committed.has(file),
      `${file} is allowlisted as non-browser code but is no longer committed; ` +
        `remove it from NON_BROWSER_SCRIPTS`,
    )
  }
})
