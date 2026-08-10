const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// These READMEs are public documentation artifacts. Relative links and section
// anchors are part of their reader-facing navigation contract.
const DOCS = ['README.md', path.join('v3', 'README.md')]

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
