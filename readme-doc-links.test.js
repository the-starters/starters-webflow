const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

/**
 * The root README "Current Scripts" inventory is deliberately pointer-style: a
 * bullet summarises what a script is and where it runs, then links to the doc
 * that authoritatively owns the detail. That only prevents drift while the
 * links keep resolving, so this guards both halves — the target file exists,
 * and a `#anchor` matches a real heading in it.
 */

const DOCS = ['README.md', path.join('v3', 'README.md')]

/** GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens. */
function slugify(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-')
}

/** Every heading slug in a markdown file, with GitHub's -1/-2 duplicate suffixes. */
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

/** Relative markdown links in a file, as `{ target, file, anchor }`. */
function relativeLinks(file) {
  const links = []
  const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g
  const source = fs.readFileSync(file, 'utf8')
  let match
  while ((match = pattern.exec(source))) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const [relative, anchor] = target.split('#')
    links.push({ target, file: path.resolve(path.dirname(file), relative), anchor })
  }
  return links
}

const slugCache = new Map()
function slugsFor(file) {
  if (!slugCache.has(file)) slugCache.set(file, headingSlugs(file))
  return slugCache.get(file)
}

for (const doc of DOCS) {
  test(`${doc} links point at files that exist`, () => {
    const links = relativeLinks(doc)
    assert.ok(links.length > 0, `${doc} has no relative links to check`)
    for (const link of links) {
      assert.ok(fs.existsSync(link.file), `${doc}: ${link.target} does not exist`)
    }
  })

  test(`${doc} link anchors resolve to a heading in the target doc`, () => {
    for (const link of relativeLinks(doc)) {
      if (!link.anchor) continue
      assert.ok(
        slugsFor(link.file).has(link.anchor),
        `${doc}: ${link.target} has no matching heading in ${path.basename(link.file)}`,
      )
    }
  })
}

test('every trimmed inventory bullet still links to its owning doc', () => {
  // The bullets consolidated into pointer style must keep carrying a link;
  // a summary with no pointer is the drift this change exists to prevent.
  const trimmed = [
    'quiz-main/quiz-attribution.js',
    'quiz-main/quiz-main.js',
    'quiz-main/quiz-redirect.js',
    'v3/auth-route.js',
    'v3/route-guard.js',
    'v3/password-recovery.js',
    'v3/starters-ms-redirect.js',
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
    'v3/scheduling-availability-writer.js',
    'v3/xano-grabber/xano-grabber.js',
    'account-settings/plan-dates.js',
    'account-settings/ms-form-cancel-state.js',
  ]
  const bullets = new Map()
  let current = null
  for (const line of fs.readFileSync('README.md', 'utf8').split('\n')) {
    const start = /^-\s+`([^`]+)`/.exec(line)
    if (start) {
      current = start[1]
      bullets.set(current, line)
    } else if (current && /^\s+\S/.test(line)) {
      bullets.set(current, `${bullets.get(current)} ${line.trim()}`)
    } else if (!line.trim()) {
      current = null
    }
  }
  for (const script of trimmed) {
    const bullet = bullets.get(script)
    assert.ok(bullet, `README.md has no inventory bullet for ${script}`)
    assert.match(bullet, /\[[^\]]*\]\([^)\s]+\)/, `${script} bullet no longer links to an owning doc`)
  }
})
