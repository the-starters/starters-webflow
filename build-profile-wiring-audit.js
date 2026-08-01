const fs = require('node:fs')

const BUILD_PROFILE_PAGES = [
  '/build-profile/full-profile',
  '/build-profile/consult',
]

const VIDESIGNS_ENGINE_RE =
  /https:\/\/cdn\.jsdelivr\.net\/gh\/(?:the-starters\/starters-webflow@[^"'\s>]+\/vendor\/videsigns-multi-step\.js|videsigns\/webflow-tools@[^"'\s>]+\/multi-step\.js)/g

const PINNED_STARTERS_ENGINE_RE =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@v\d+\.\d+\.\d+\/vendor\/videsigns-multi-step\.js$/

function auditBuildProfileHtml(pagePath, html) {
  if (!BUILD_PROFILE_PAGES.includes(pagePath)) {
    throw new Error(`unsupported build-profile page: ${pagePath}`)
  }

  const engineSources = [...html.matchAll(VIDESIGNS_ENGINE_RE)].map((match) => match[0])
  const uniqueEngineSources = [...new Set(engineSources)]
  const findings = []

  if (engineSources.length !== 1) {
    findings.push(
      `expected exactly one Videsigns engine script, found ${engineSources.length}: ${uniqueEngineSources.join(', ') || 'none'}`,
    )
  } else if (!PINNED_STARTERS_ENGINE_RE.test(engineSources[0])) {
    findings.push(`engine must use the pinned Starters mirror, found: ${engineSources[0]}`)
  }

  if (/utils\/multi-step-failover\.js/.test(html)) {
    findings.push('obsolete multi-step-failover.js is still loaded')
  }

  const hasAuthoritativeEndpoint = /build_profile\/starter\/update/.test(html)
  const hasFormSubmitControl = /\bform-submit(?:\s*=\s*(?:""|''))?/.test(html)
  const hasDirectClickOwner =
    /formSubmit\.addEventListener\(\s*['"]click['"]/.test(html) &&
    /xanoAuthFetch\(\s*ENDPOINT_URL/.test(html)

  if (!hasAuthoritativeEndpoint) {
    findings.push('authoritative build-profile Xano endpoint is missing')
  }
  if (!hasFormSubmitControl) {
    findings.push('[form-submit] control is missing')
  }
  if (!hasDirectClickOwner) {
    findings.push(
      'authoritative Xano submit must be owned by the [form-submit] click path, not only a native submit event',
    )
  }

  return {
    engineSources,
    findings,
    ok: findings.length === 0,
    pagePath,
  }
}

function parseArgs(argv) {
  const files = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const pagePath = argv[index]
    const filePath = argv[index + 1]
    if (!pagePath || !filePath) {
      throw new Error('usage: node build-profile-wiring-audit.js <page-path> <html-file> [...]')
    }
    files.set(pagePath, filePath)
  }
  return files
}

function runCli(argv) {
  const files = parseArgs(argv)
  const missing = BUILD_PROFILE_PAGES.filter((pagePath) => !files.has(pagePath))
  if (missing.length) {
    throw new Error(`missing required page snapshots: ${missing.join(', ')}`)
  }

  let failed = false
  for (const pagePath of BUILD_PROFILE_PAGES) {
    const html = fs.readFileSync(files.get(pagePath), 'utf8')
    const result = auditBuildProfileHtml(pagePath, html)
    if (result.ok) {
      console.log(`PASS ${pagePath}: one pinned engine and direct Xano click owner`)
      continue
    }

    failed = true
    console.error(`FAIL ${pagePath}`)
    for (const finding of result.findings) console.error(`- ${finding}`)
  }

  if (failed) process.exitCode = 1
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = {
  BUILD_PROFILE_PAGES,
  auditBuildProfileHtml,
}
