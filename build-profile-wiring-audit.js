const fs = require('node:fs')
const path = require('node:path')

const BUILD_PROFILE_PAGES = [
  '/build-profile/full-profile',
  '/build-profile/consult',
]

const VIDESIGNS_ENGINE_RE =
  /https:\/\/cdn\.jsdelivr\.net\/gh\/(?:the-starters\/starters-webflow@[^"'\s>]+\/vendor\/videsigns-multi-step\.js|videsigns\/webflow-tools@[^"'\s>]+\/multi-step\.js)/g

const PINNED_STARTERS_ENGINE_RE =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@v\d+\.\d+\.\d+\/vendor\/videsigns-multi-step\.js$/

const DRAFT_IDENTITY_GUARD_SRC_RE =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@(?:v\d+\.\d+\.\d+|[0-9a-f]{7,40})\/build-profile-draft-identity-guard\.js$/

const AUTHORITATIVE_ENDPOINT_RE = /build_profile\/starter\/update/

// Since the inline-extraction cutover the authoritative click owner is not in the
// page: the page loads it from the Starters CDN. The audit then reads the owner
// from that module's source (the repo copy by default, or an explicit file), so
// the click-path check still runs against what the page actually executes.
const SUBMIT_WRITER_TAG_RE =
  /<script\b[^>]*\bsrc=["']([^"']*\/v3\/build-profile\/submit-writer\.js[^"']*)["'][^>]*>/i
const STARTERS_SUBMIT_WRITER_SRC_RE =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/the-starters\/starters-webflow@[^/"'\s]+\/v3\/build-profile\/submit-writer\.js(?:\?[^"'\s]*)?$/
const DEFAULT_SUBMIT_WRITER_PATH = path.join(__dirname, 'v3', 'build-profile', 'submit-writer.js')

const ONBOARDING_PATH = '/starter-onboarding'

// A real tag: optional slash, name, then a well-formed attribute list. Matching
// through this rather than `<\w+[^>]*attr[^>]*>` is what keeps a `<div …>`
// written inside a comment or a script string from being mistaken for markup.
// Because each match consumes its whole attribute list, quoted values are
// stepped over as a unit: a `<div>` or `</div>` spelled inside one is never
// tokenized as a tag of its own.
const TAG_SOURCE =
  '<(/?)([a-zA-Z][\\w-]*)((?:\\s+[^\\s"\'>/=]+(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s"\'>`]+))?)*)\\s*(/?)>'

/**
 * Every tag in `markup` from `fromIndex` on, in document order. One shared
 * tokenizer so the CTA check, the origin lookup, and the element-bounds walk all
 * agree on what counts as a tag; each call gets its own regex, so nesting one
 * scan inside another is safe.
 */
function* tags(markup, fromIndex = 0) {
  const re = new RegExp(TAG_SOURCE, 'g')
  re.lastIndex = fromIndex
  let match
  while ((match = re.exec(markup))) {
    yield {
      closing: match[1] === '/',
      tagName: match[2],
      attributes: match[3] || '',
      selfClosing: match[4] === '/',
      index: match.index,
      end: re.lastIndex,
    }
  }
}

// The attribute NAME, not a substring of some other attribute's value.
const SUCCESS_ATTR_RE = /(?:^|\s)build-profile-success(?=[\s=]|$)/

// Stands in for the page's own origin when the snapshot does not declare one.
// Nothing absolute can resolve to it, so an unverifiable absolute href fails.
const UNKNOWN_ORIGIN = 'https://snapshot.invalid'

/**
 * Comments and script/style bodies removed. Everything downstream that counts
 * tags or looks for the success state works on this, so a `<div` inside a
 * string literal cannot skew the depth count or fake an opening tag.
 */
function markupOnly(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
}

function attrValue(attributes, name) {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i',
  )
  const match = re.exec(attributes)
  if (!match) return null
  return match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]
}

/**
 * The origin this snapshot was captured from, taken from its own canonical link
 * (or og:url). The audit is same-origin per snapshot: a production capture whose
 * CTA points at the staging host is a real defect, and a rule that accepted any
 * known Starters origin would wave it through.
 */
function snapshotOrigin(markup) {
  let canonical = null
  let ogUrl = null
  for (const tag of tags(markup)) {
    if (tag.closing) continue
    const name = tag.tagName.toLowerCase()
    if (!canonical && name === 'link') {
      const rel = attrValue(tag.attributes, 'rel')
      if (rel && rel.trim().toLowerCase() === 'canonical') {
        canonical = attrValue(tag.attributes, 'href')
      }
    } else if (!ogUrl && name === 'meta') {
      const property =
        attrValue(tag.attributes, 'property') || attrValue(tag.attributes, 'name')
      if (property && property.trim().toLowerCase() === 'og:url') {
        ogUrl = attrValue(tag.attributes, 'content')
      }
    }
  }
  for (const value of [canonical, ogUrl]) {
    if (!value) continue
    try {
      return new URL(value).origin
    } catch {
      continue
    }
  }
  return null
}

function findSuccessTag(markup) {
  for (const tag of tags(markup)) {
    if (tag.closing) continue
    if (SUCCESS_ATTR_RE.test(tag.attributes)) {
      return { tagName: tag.tagName, index: tag.index, selfClosing: tag.selfClosing }
    }
  }
  return null
}

/**
 * The outer HTML of the element opening at `startIndex`, or null when its bounds
 * cannot be established. FAILS CLOSED on purpose: widening to the rest of the
 * document would let an onboarding link anywhere on the page rescue an empty
 * success state, which is the opposite of what this check is for.
 *
 * The depth walk runs off the shared tokenizer, so a `<div>` or `</div>` spelled
 * inside an attribute value cannot inflate the count and run the slice into
 * sibling markup, nor truncate it early.
 */
function elementHtml(markup, tagName, startIndex) {
  const name = tagName.toLowerCase()
  let depth = 0
  for (const tag of tags(markup, startIndex)) {
    if (tag.tagName.toLowerCase() !== name) continue
    if (tag.closing) {
      depth -= 1
      if (depth === 0) return markup.slice(startIndex, tag.end)
      if (depth < 0) return null
    } else if (!tag.selfClosing) {
      depth += 1
    }
  }
  return null
}

/**
 * Same-origin, matching the runtime rule in
 * v3/build-profile/submit-diagnostics.js. Relative, root-relative, and
 * protocol-relative same-host hrefs all resolve; anything landing on another
 * host does not, whatever its path says.
 */
function resolvesToOnboarding(href, pagePath, origin) {
  if (!href) return false
  const base = (origin || UNKNOWN_ORIGIN) + pagePath
  let url
  let page
  try {
    url = new URL(href, base)
    page = new URL(base)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.host !== page.host) return false
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname
  return path === ONBOARDING_PATH
}

/**
 * Anchors are enumerated with the shared tokenizer and their href read with
 * `attrValue`, the same pair `findSuccessTag` and `snapshotOrigin` use: an
 * `href=` spelled inside another attribute's value cannot donate a phantom
 * target, and an unquoted href is still read.
 */
function hasOnboardingCta(successHtml, pagePath, origin) {
  for (const tag of tags(successHtml)) {
    if (tag.closing || tag.tagName.toLowerCase() !== 'a') continue
    if (resolvesToOnboarding(attrValue(tag.attributes, 'href'), pagePath, origin)) return true
  }
  return false
}

const FORM_SUBMIT_SELECTOR_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*(?:querySelector(?:All)?|\bqs)\(\s*['"`]\s*\[form-submit\]/g

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractHandlerBody(html, fromIndex) {
  const braceStart = html.indexOf('{', fromIndex)
  if (braceStart === -1) return null
  let depth = 0
  for (let index = braceStart; index < html.length; index += 1) {
    const char = html[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return html.slice(braceStart, index + 1)
    }
  }
  return null
}

// Names bound to the authoritative endpoint literal anywhere in the owner source.
// The click path reaches the endpoint through whichever of these a `xanoAuthFetch`
// call is handed, so resolution is a name lookup rather than a per-call rescan.
const ENDPOINT_BINDING_RE =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`][^'"`]*build_profile\/starter\/update/g

// The writer delegates: the click handler calls the submit builder, which calls
// the canonical-save helper and passes the endpoint in. Following one level would
// stop at the builder and report a wrong verdict on a page whose click owner is
// intact, so the walk is transitive, bounded, and tracks which parameter of each
// callee received an endpoint-bearing argument.
const MAX_CLICK_HELPER_DEPTH = 4

function endpointBindings(html) {
  const names = new Set()
  const re = new RegExp(ENDPOINT_BINDING_RE.source, 'g')
  let match
  while ((match = re.exec(html))) names.add(match[1])
  return names
}

function parenthesizedList(source, openParenIndex) {
  if (source[openParenIndex] !== '(') return null
  let depth = 0
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openParenIndex + 1, index)
    }
  }
  return null
}

function splitTopLevel(list) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of list || '') {
    if ('([{'.indexOf(char) !== -1) depth += 1
    else if (')]}'.indexOf(char) !== -1) depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  parts.push(current.trim())
  return parts
}

function resolvesToEndpoint(expression, endpointNames) {
  if (!expression) return false
  if (/['"`]/.test(expression)) return AUTHORITATIVE_ENDPOINT_RE.test(expression)
  return endpointNames.has(expression)
}

function callsEndpointDirectly(body, endpointNames) {
  const callRe = /xanoAuthFetch\(\s*([^\s,)]+)/g
  let call
  while ((call = callRe.exec(body))) {
    if (resolvesToEndpoint(call[1], endpointNames)) return true
  }
  return false
}

function bodyReachesAuthoritativeEndpoint(body, html, endpointNames, depth, visited) {
  if (callsEndpointDirectly(body, endpointNames)) return true
  if (depth <= 0) return false

  const helperCallRe = /\b([A-Za-z_$][\w$]*)\s*\(/g
  let helperCall
  while ((helperCall = helperCallRe.exec(body))) {
    const helperName = helperCall[1]
    const declarationRe = new RegExp(
      `(?:async\\s+)?function\\s+${escapeRegExp(helperName)}\\s*\\(`,
      'g',
    )
    const declaration = declarationRe.exec(html)
    if (!declaration) continue

    const parameterEnd = declaration.index + declaration[0].length - 1
    const parameters = splitTopLevel(parenthesizedList(html, parameterEnd))
    const args = splitTopLevel(parenthesizedList(body, helperCall.index + helperCall[0].length - 1))
    const calleeNames = new Set(endpointNames)
    parameters.forEach((parameter, position) => {
      if (resolvesToEndpoint(args[position], endpointNames)) calleeNames.add(parameter)
    })

    const key = `${helperName}|${[...calleeNames].sort().join(',')}`
    // Memoized per remaining budget, not per helper: a helper first reached down a
    // long path can exhaust the budget and prove nothing, and a later shorter path
    // to it must still be explored or an intact click owner is reported broken.
    const exploredAtDepth = visited.get(key)
    if (exploredAtDepth !== undefined && exploredAtDepth >= depth) continue
    visited.set(key, depth)

    const helperBody = extractHandlerBody(html, declaration.index + declaration[0].length)
    if (!helperBody) continue
    if (bodyReachesAuthoritativeEndpoint(helperBody, html, calleeNames, depth - 1, visited)) return true
  }
  return false
}

function clickBodyWritesAuthoritativeEndpoint(body, html) {
  return bodyReachesAuthoritativeEndpoint(
    body,
    html,
    endpointBindings(html),
    MAX_CLICK_HELPER_DEPTH,
    new Map(),
  )
}

function ownsAuthoritativeClickSubmit(html) {
  const submitVars = new Set()
  const selectorRe = new RegExp(FORM_SUBMIT_SELECTOR_RE.source, 'g')
  let selectorMatch
  while ((selectorMatch = selectorRe.exec(html))) submitVars.add(selectorMatch[1])
  if (!submitVars.size) return false

  for (const varName of submitVars) {
    const listenerRe = new RegExp(
      `\\b${escapeRegExp(varName)}\\.addEventListener\\(\\s*['"\`]click['"\`]`,
      'g',
    )
    let listenerMatch
    while ((listenerMatch = listenerRe.exec(html))) {
      const body = extractHandlerBody(html, listenerMatch.index + listenerMatch[0].length)
      if (!body) continue
      if (clickBodyWritesAuthoritativeEndpoint(body, html)) return true
    }
  }
  return false
}

/**
 * Where the authoritative click owner lives for this page: the page itself when
 * it still inlines the writer, otherwise the CDN-loaded submit-writer module.
 * Returns the combined source the owner checks should read, plus findings.
 * @param {string} html
 * @param {{submitWriterSource?: string | null}} options
 */
function resolveOwnerSource(html, options) {
  const findings = []
  if (AUTHORITATIVE_ENDPOINT_RE.test(html)) return { source: html, origin: 'inline', findings }
  const tag = SUBMIT_WRITER_TAG_RE.exec(html)
  if (!tag) return { source: html, origin: 'inline', findings }
  const src = tag[1]
  if (!STARTERS_SUBMIT_WRITER_SRC_RE.test(src)) {
    findings.push(`submit-writer must load from the Starters jsDelivr repo, found: ${src}`)
    return { source: html, origin: 'cdn', findings }
  }
  let writer = options.submitWriterSource
  if (writer === undefined) {
    writer = fs.existsSync(DEFAULT_SUBMIT_WRITER_PATH) ? fs.readFileSync(DEFAULT_SUBMIT_WRITER_PATH, 'utf8') : null
  }
  if (!writer) {
    findings.push('submit-writer is loaded from the CDN but its source could not be resolved for the click-owner check')
    return { source: html, origin: 'cdn', findings }
  }
  return { source: `${html}\n${writer}`, origin: 'cdn', findings }
}

function auditBuildProfileHtml(pagePath, html, options = {}) {
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

  const guardTags = [...html.matchAll(/<script\b([^>]*\bsrc=["']([^"']*build-profile-draft-identity-guard\.js)["'][^>]*)><\/script>/gi)]
  if (guardTags.length !== 1) {
    findings.push(`expected exactly one build-profile draft identity guard, found ${guardTags.length}`)
  } else {
    const [, attributes, source] = guardTags[0]
    if (!DRAFT_IDENTITY_GUARD_SRC_RE.test(source)) {
      findings.push(`draft identity guard must use a pinned Starters asset, found: ${source}`)
    }
    if (/\b(?:async|defer)\b/i.test(attributes)) {
      findings.push('draft identity guard must load synchronously before authored form scripts')
    }

    const firstLegacyDraftAccess = html.search(
      /localStorage\.(?:getItem|setItem|removeItem)\(\s*['"`]build_profile['"`]/,
    )
    if (firstLegacyDraftAccess !== -1 && guardTags[0].index > firstLegacyDraftAccess) {
      findings.push('draft identity guard must appear before the first legacy build_profile storage access')
    }
  }

  const owner = resolveOwnerSource(html, options)
  findings.push(...owner.findings)
  const hasAuthoritativeEndpoint = AUTHORITATIVE_ENDPOINT_RE.test(owner.source)
  const hasFormSubmitControl = /\bform-submit(?:\s*=\s*(?:""|''))?/.test(html)
  const hasDirectClickOwner = ownsAuthoritativeClickSubmit(owner.source)

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

  // Since v1.59.245 nothing auto-redirects after a successful submit: the
  // authored CTA inside the success state is the member's only way forward, so
  // its absence strands them on a finished form.
  const markup = markupOnly(html)
  const successTag = findSuccessTag(markup)
  if (!successTag) {
    findings.push('[build-profile-success] state is missing')
  } else {
    const successHtml = successTag.selfClosing
      ? ''
      : elementHtml(markup, successTag.tagName, successTag.index)
    if (successHtml === null) {
      findings.push(
        `[build-profile-success] bounds could not be established (no matching </${successTag.tagName}>); the success state is unverifiable`,
      )
    } else if (!hasOnboardingCta(successHtml, pagePath, snapshotOrigin(markup))) {
      findings.push(
        `[build-profile-success] must contain a same-origin link to ${ONBOARDING_PATH}; it is the only way out of a successful submit`,
      )
    }
  }

  return {
    engineSources,
    findings,
    ok: findings.length === 0,
    pagePath,
    submitOwnerSource: owner.origin,
  }
}

function parseArgs(argv) {
  const files = new Map()
  let submitWriterPath = null
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--submit-writer') {
      submitWriterPath = argv[index + 1]
      if (!submitWriterPath) throw new Error('--submit-writer needs a file path')
      index += 1
      continue
    }
    rest.push(argv[index])
  }
  for (let index = 0; index < rest.length; index += 2) {
    const pagePath = rest[index]
    const filePath = rest[index + 1]
    if (!pagePath || !filePath) {
      throw new Error('usage: node build-profile-wiring-audit.js [--submit-writer <js-file>] <page-path> <html-file> [...]')
    }
    files.set(pagePath, filePath)
  }
  return { files, submitWriterPath }
}

function runCli(argv) {
  const { files, submitWriterPath } = parseArgs(argv)
  const options = submitWriterPath ? { submitWriterSource: fs.readFileSync(submitWriterPath, 'utf8') } : {}
  const missing = BUILD_PROFILE_PAGES.filter((pagePath) => !files.has(pagePath))
  if (missing.length) {
    throw new Error(`missing required page snapshots: ${missing.join(', ')}`)
  }

  let failed = false
  for (const pagePath of BUILD_PROFILE_PAGES) {
    const html = fs.readFileSync(files.get(pagePath), 'utf8')
    const result = auditBuildProfileHtml(pagePath, html, options)
    if (result.ok) {
      console.log(`PASS ${pagePath}: one pinned engine and direct Xano click owner (${result.submitOwnerSource})`)
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
