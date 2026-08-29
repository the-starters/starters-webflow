'use strict'

/**
 * Unit tests for `v3/agency-profile.js`.
 *
 * The module's rendered behavior is covered end-to-end elsewhere, by the
 * `staging-qa` Playwright suite against the live endpoint. What is worth
 * testing here is the handful of pure decisions that are cheap to get wrong and
 * expensive to notice: the release marker drifting from the header, the slug
 * regex, and the two predicates that decide whether a section renders and
 * whether a URL is allowed into a live iframe.
 *
 * The module is an IIFE that assigns its api onto the global it is handed, then
 * bails before touching the DOM when that global has no `document`. So a fake
 * window with no document gives the exported functions with no boot side
 * effects at all.
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE_PATH = path.join(__dirname, 'agency-profile.js')
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8')

/** Load the module against a bare global and hand back its exported api. */
function loadApi() {
  const sandbox = { URL, console: { warn() {} } }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: 'agency-profile.js' })
  const api = sandbox.StartersAgencyProfileV3
  assert.ok(api, 'the module should export StartersAgencyProfileV3')
  return api
}

test('release marker: the header and the api agree, in vX.Y.Z form', () => {
  const header = /@release\s+(\S+)/.exec(SOURCE)
  assert.ok(header, 'the module header must carry an @release marker')

  const marker = header[1]
  assert.match(
    marker,
    /^v\d+\.\d+\.\d+$/,
    'the release marker must be a concrete vX.Y.Z tag, never a placeholder',
  )

  // The pair is what makes a served file identifiable at runtime: the header is
  // what a human greps, `.release` is what the console reports. They drift
  // silently unless something checks.
  assert.equal(loadApi().release, marker)
})

test('profileSlug: reads the slug out of a /hire/ path and nothing else', () => {
  const { profileSlug } = loadApi()

  assert.equal(profileSlug('/hire/jai'), 'jai')
  assert.equal(profileSlug('/hire/jai/'), 'jai', 'a trailing slash is still the same profile')
  assert.equal(profileSlug('/HIRE/jai'), 'jai', 'the path match is case-insensitive')
  assert.equal(profileSlug('/hire/alex-o'), 'alex-o')
  assert.equal(
    profileSlug('/hire/caf%C3%A9'),
    'café',
    'a percent-encoded slug is decoded before it becomes a request param',
  )

  // Anything that is not exactly one /hire/<slug> segment yields no slug, which
  // is what keeps the module inert on every other page of the site.
  assert.equal(profileSlug('/hire'), '')
  assert.equal(profileSlug('/hire/'), '')
  assert.equal(profileSlug('/hire/jai/extra'), '')
  assert.equal(profileSlug('/all-starters'), '')
  assert.equal(profileSlug('/'), '')
  assert.equal(profileSlug(''), '')
  assert.equal(profileSlug(null), '')
  assert.equal(profileSlug(undefined), '')

  // A malformed escape makes decodeURIComponent throw; that must be an empty
  // slug, not an exception that aborts the IIFE.
  assert.equal(profileSlug('/hire/%E0%A4%A'), '')
})

test('showsAgency: needs the flag AND a name with something in it', () => {
  const { showsAgency } = loadApi()

  assert.equal(showsAgency({ is_agency: true, agency_name: 'The Starters' }), true)

  assert.equal(showsAgency(null), false)
  assert.equal(showsAgency(undefined), false)
  assert.equal(showsAgency({}), false)
  assert.equal(showsAgency({ is_agency: false, agency_name: 'The Starters' }), false)
  assert.equal(showsAgency({ is_agency: true }), false)
  assert.equal(showsAgency({ is_agency: true, agency_name: '' }), false)
  assert.equal(showsAgency({ is_agency: true, agency_name: null }), false)

  // Trimmed where wf-xano's own truthiness test would not be. The divergence is
  // deliberate and fails closed: a whitespace name shows nothing rather than a
  // section with a blank heading.
  assert.equal(showsAgency({ is_agency: true, agency_name: '   ' }), false)
  assert.equal(showsAgency({ is_agency: true, agency_name: ' The Starters ' }), true)
})

test('videoUrl: only an absolute https URL is allowed into the iframe', () => {
  const { videoUrl } = loadApi()

  const stored = 'https://player.vimeo.com/video/1123131951?byline=0&portrait=0&title=0'
  assert.equal(
    videoUrl({ agency_video_link: stored }),
    stored,
    'a stored player URL survives the round trip unchanged',
  )
  assert.equal(videoUrl({ agency_video_link: `  ${stored}  ` }), stored, 'surrounding space is trimmed')

  // The empty shapes the endpoint actually returns.
  assert.equal(videoUrl(null), '')
  assert.equal(videoUrl({}), '')
  assert.equal(videoUrl({ agency_video_link: '' }), '')
  assert.equal(videoUrl({ agency_video_link: '   ' }), '')

  // Non-strings never reach the DOM, whatever a record holds.
  assert.equal(videoUrl({ agency_video_link: null }), '')
  assert.equal(videoUrl({ agency_video_link: 12345 }), '')
  assert.equal(videoUrl({ agency_video_link: { href: stored } }), '')

  // The point of the check: a stored value must not be able to become an
  // executing or non-https frame on a public page.
  assert.equal(videoUrl({ agency_video_link: 'javascript:alert(1)' }), '')
  assert.equal(videoUrl({ agency_video_link: 'data:text/html,<h1>hi</h1>' }), '')
  assert.equal(videoUrl({ agency_video_link: 'http://player.vimeo.com/video/1' }), '')
  assert.equal(videoUrl({ agency_video_link: '//player.vimeo.com/video/1' }), '')
  assert.equal(videoUrl({ agency_video_link: 'player.vimeo.com/video/1' }), '')
  assert.equal(videoUrl({ agency_video_link: 'not a url at all' }), '')
})

test('agencyRow: the single row out of a normalized wf-xano result', () => {
  const { agencyRow } = loadApi()

  const row = { is_agency: true, agency_name: 'The Starters' }
  assert.equal(agencyRow({ items: [row] }), row)

  assert.equal(agencyRow(null), null)
  assert.equal(agencyRow({}), null)
  assert.equal(agencyRow({ items: [] }), null)
})

test('timeoutMs: the cap cannot be switched off, and cannot be set past the clamp', () => {
  const { timeoutMs } = loadApi()
  const wrapper = (value) => ({
    getAttribute: (name) => (name === 'data-agency-v3-timeout-ms' ? value : null),
  })

  assert.equal(timeoutMs(wrapper(null)), 8000, 'no attribute means the 8s default')
  assert.equal(timeoutMs(wrapper('250')), 250, 'a harness can shorten the cap')
  assert.equal(timeoutMs(wrapper('60000')), 60000, 'the clamp itself is allowed')

  // There is deliberately NO way to disable the cap. A section that spins
  // forever is the exact failure it exists to prevent, so every value that is
  // not a usable duration falls back to the default rather than to no cap.
  assert.equal(timeoutMs(wrapper('0')), 8000, 'zero does not disable the cap')
  assert.equal(timeoutMs(wrapper('-0')), 8000)
  assert.equal(timeoutMs(wrapper('-1')), 8000)
  assert.equal(timeoutMs(wrapper('')), 8000)
  assert.equal(timeoutMs(wrapper('soon')), 8000)
  assert.equal(timeoutMs(null), 8000)
  assert.equal(timeoutMs({}), 8000)

  // setTimeout keeps its delay in a 32-bit int, so a value past ~24.8 days
  // wraps and fires immediately — "wait a very long time" would silently become
  // "do not wait at all". Clamped instead.
  assert.equal(timeoutMs(wrapper('600000')), 60000, 'a large value is clamped, not honoured')
  assert.equal(timeoutMs(wrapper('2147483648')), 60000, 'past the 32-bit delay limit')
  assert.equal(timeoutMs(wrapper('99999999999')), 60000)
})

test('configureSection: stamps the slug, or collapses a section the URL cannot fill', () => {
  const { configureSection } = loadApi()

  function wrapperFixture() {
    const attrs = Object.create(null)
    return {
      style: { display: '', removeProperty(name) { delete this[name] } },
      hidden: false,
      attrs,
      setAttribute(name, value) { attrs[name] = String(value) },
      removeAttribute(name) { delete attrs[name] },
      getAttribute(name) { return name in attrs ? attrs[name] : null },
      hasAttribute(name) { return name in attrs },
    }
  }
  const documentWith = (root) => ({ querySelector: () => root })

  const stamped = wrapperFixture()
  assert.equal(configureSection(documentWith(stamped), '/hire/jai'), stamped)
  assert.equal(stamped.attrs['wf-xano-param-slug'], 'jai')
  assert.equal(stamped.hidden, false, 'a usable slug leaves the wrapper alone')
  assert.equal(stamped.hasAttribute('data-agency-v3-hidden'), false)

  // The section is authored but the URL yields nothing to fetch with. Nothing
  // will ever activate it, so it must not be left holding a layout slot.
  const orphaned = wrapperFixture()
  assert.equal(configureSection(documentWith(orphaned), '/hire/jai/extra'), null)
  assert.equal(orphaned.hidden, true, 'a slug-less URL collapses the wrapper')
  assert.equal(orphaned.style.display, 'none')
  assert.equal(orphaned.hasAttribute('data-agency-v3-hidden'), true)
  assert.equal(orphaned.hasAttribute('wf-xano-param-slug'), false, 'and stamps nothing')

  // No section on the page at all: nothing to do, and nothing to throw over.
  assert.equal(configureSection(documentWith(null), '/hire/jai'), null)
  assert.equal(configureSection(null, '/hire/jai'), null)
})

test('the module is inert when the global has no document', () => {
  // Guards the boot path: loading the file must not throw or try to touch a DOM
  // that is not there, which is what makes this test file possible at all.
  const api = loadApi()
  assert.equal(typeof api.activate, 'function')
  assert.equal(typeof api.configureSection, 'function')
})
