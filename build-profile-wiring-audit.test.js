const assert = require('node:assert/strict')
const test = require('node:test')

const {
  BUILD_PROFILE_PAGES,
  auditBuildProfileHtml,
} = require('./build-profile-wiring-audit')

const pinnedEngine =
  '<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.49/vendor/videsigns-multi-step.js"></script>'

function pageHtml({ engines = pinnedEngine, submitOwner = 'click' } = {}) {
  const handler =
    submitOwner === 'click'
      ? `
        const formSubmit = form.querySelector('[form-submit]')
        formSubmit.addEventListener('click', async (event) => {
          event.preventDefault()
          await xanoAuthFetch(ENDPOINT_URL, { method: 'POST' })
        })
      `
      : `
        form.addEventListener('submit', async (event) => {
          event.preventDefault()
          await xanoAuthFetch(ENDPOINT_URL, { method: 'POST' })
        })
      `

  return `
    ${engines}
    <form build-profile-form>
      <a form-submit="" href="#">Submit your profile</a>
    </form>
    <script>
      const ENDPOINT_URL = 'https://example.test/build_profile/starter/update'
      ${handler}
    </script>
  `
}

test('both build-profile workflows accept one pinned mirror and a direct Xano click owner', () => {
  for (const pagePath of BUILD_PROFILE_PAGES) {
    const result = auditBuildProfileHtml(pagePath, pageHtml())
    assert.equal(result.ok, true, `${pagePath}: ${result.findings.join('; ')}`)
  }
})

test('duplicate upstream and mirror engines fail the audit', () => {
  const engines = `${pinnedEngine}
    <script src="https://cdn.jsdelivr.net/gh/videsigns/webflow-tools@latest/multi-step.js"></script>`
  const result = auditBuildProfileHtml('/build-profile/full-profile', pageHtml({ engines }))

  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /exactly one Videsigns engine script, found 2/)
})

test('an unpinned or upstream-only engine fails the audit', () => {
  const engines =
    '<script src="https://cdn.jsdelivr.net/gh/videsigns/webflow-tools@latest/multi-step.js"></script>'
  const result = auditBuildProfileHtml('/build-profile/consult', pageHtml({ engines }))

  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /pinned Starters mirror/)
})

test('a native-submit-only Xano owner fails behind the Videsigns synthetic click path', () => {
  const result = auditBuildProfileHtml(
    '/build-profile/full-profile',
    pageHtml({ submitOwner: 'submit' }),
  )

  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /\[form-submit\] click path/)
})

test('the obsolete failover loader fails the audit', () => {
  const html = `${pageHtml()}
    <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.49/utils/multi-step-failover.js"></script>`
  const result = auditBuildProfileHtml('/build-profile/consult', html)

  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /obsolete multi-step-failover/)
})
