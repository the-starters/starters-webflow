const assert = require('node:assert/strict')
const test = require('node:test')

const {
  BUILD_PROFILE_PAGES,
  auditBuildProfileHtml,
} = require('./build-profile-wiring-audit')

const pinnedEngine =
  '<script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.49/vendor/videsigns-multi-step.js"></script>'

const pinnedDraftGuard =
  '<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@abcdef1234567890/build-profile-draft-identity-guard.js"></script>'

// The authored success state. Its CTA is the only way forward after a successful
// submit, so the audit treats a missing one as a finding.
const successState = `
    <div build-profile-success class="w-form-done">
      <h3>Thanks</h3>
      <a href="/starter-onboarding" class="button">Start onboarding</a>
    </div>
  `

// Published Webflow pages declare their own origin. The audit resolves CTA hrefs
// against it, so absolute links are judged against the host the snapshot was
// actually captured from.
const PRODUCTION_ORIGIN = 'https://www.thestarters.com'
const STAGING_ORIGIN = 'https://the-starters-3-0.webflow.io'

function pageHtml({
  engines = pinnedEngine,
  guard = pinnedDraftGuard,
  submitOwner = 'click',
  success = successState,
  canonical = `${PRODUCTION_ORIGIN}/build-profile/consult`,
} = {}) {
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
    ${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
    ${guard}
    ${engines}
    <form build-profile-form>
      <a form-submit="" href="#">Submit your profile</a>
    </form>
    ${success}
    <script>
      const ENDPOINT_URL = 'https://example.test/build_profile/starter/update'
      ${handler}
    </script>
  `
}

test('a missing, deferred, or late identity guard fails the audit', () => {
  const missing = auditBuildProfileHtml(
    '/build-profile/full-profile',
    pageHtml({ guard: '' }),
  )
  assert.equal(missing.ok, false)
  assert.match(missing.findings.join('\n'), /exactly one build-profile draft identity guard/)

  const deferred = auditBuildProfileHtml(
    '/build-profile/full-profile',
    pageHtml({ guard: pinnedDraftGuard.replace('<script ', '<script defer ') }),
  )
  assert.equal(deferred.ok, false)
  assert.match(deferred.findings.join('\n'), /must load synchronously/)

  const lateHtml = pageHtml({ guard: '' }).replace(
    '</form>',
    `</form><script>localStorage.getItem('build_profile')</script>${pinnedDraftGuard}`,
  )
  const late = auditBuildProfileHtml('/build-profile/consult', lateHtml)
  assert.equal(late.ok, false)
  assert.match(late.findings.join('\n'), /must appear before/)
})

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

test('an unrelated [form-submit] click handler plus a native-submit-only Xano writer fails', () => {
  const html = `
    ${pinnedEngine}
    <form build-profile-form>
      <a form-submit="" href="#">Submit your profile</a>
    </form>
    ${successState}
    <script>
      const ENDPOINT_URL = 'https://example.test/build_profile/starter/update'
      const formSubmit = form.querySelector('[form-submit]')
      formSubmit.addEventListener('click', () => {
        showSpinner()
      })
      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        await xanoAuthFetch(ENDPOINT_URL, { method: 'POST' })
      })
    </script>
  `
  const result = auditBuildProfileHtml('/build-profile/full-profile', html)

  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /\[form-submit\] click path/)
})

test('a renamed control and endpoint variable still pass when co-located', () => {
  const html = `
    ${pinnedDraftGuard}
    ${pinnedEngine}
    <form build-profile-form>
      <a form-submit="" href="#">Submit your profile</a>
    </form>
    ${successState}
    <script>
      const saveUrl = 'https://example.test/build_profile/starter/update'
      const submitControl = form.querySelector('[form-submit]')
      submitControl.addEventListener('click', async (event) => {
        event.preventDefault()
        await xanoAuthFetch(saveUrl, { method: 'POST' })
      })
    </script>
  `
  const result = auditBuildProfileHtml('/build-profile/consult', html)

  assert.equal(result.ok, true, result.findings.join('; '))
})

test('the published qs helper and delegated click writer pass the audit', () => {
  const html = `
    ${pinnedDraftGuard}
    ${pinnedEngine}
    <form build-profile-form>
      <a form-submit="" href="#">Submit your profile</a>
    </form>
    ${successState}
    <script>
      const formSubmit = form ? qs('[form-submit]', form) : null
      formSubmit.addEventListener('click', async (event) => {
        event.preventDefault()
        await submitFreelancerData(new FormData(form))
      })
      async function submitFreelancerData(data) {
        const endpointUrl = 'https://example.test/build_profile/starter/update'
        return xanoAuthFetch(endpointUrl, { method: 'POST', body: data })
      }
    </script>
  `
  const result = auditBuildProfileHtml('/build-profile/full-profile', html)

  assert.equal(result.ok, true, result.findings.join('; '))
})

test('a success state with no onboarding CTA fails the audit', () => {
  const missing = auditBuildProfileHtml('/build-profile/consult', pageHtml({ success: '' }))
  assert.equal(missing.ok, false)
  assert.match(missing.findings.join('\n'), /\[build-profile-success\] state is missing/)

  // Present, but the member is stranded on it.
  const noCta = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success: '<div build-profile-success class="w-form-done"><h3>Thanks</h3></div>',
    }),
  )
  assert.equal(noCta.ok, false)
  assert.match(noCta.findings.join('\n'), /must contain a same-origin link to \/starter-onboarding/)

  // A link that goes somewhere else is not the CTA either.
  const wrongTarget = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success:
        '<div build-profile-success><a href="/starter-dashboard">Dashboard</a></div>',
    }),
  )
  assert.equal(wrongTarget.ok, false)
  assert.match(wrongTarget.findings.join('\n'), /must contain a same-origin link to \/starter-onboarding/)
})

test('the onboarding CTA is accepted in every href shape the pages author', () => {
  for (const href of [
    '/starter-onboarding',
    '/starter-onboarding/',
    '/starter-onboarding?ref=cta',
    '../starter-onboarding',
    `${PRODUCTION_ORIGIN}/starter-onboarding`,
    '//www.thestarters.com/starter-onboarding',
  ]) {
    const result = auditBuildProfileHtml(
      '/build-profile/consult',
      pageHtml({ success: `<div build-profile-success><a href="${href}">Go</a></div>` }),
    )
    assert.equal(result.ok, true, `${href}: ${result.findings.join('; ')}`)
  }

  const nested = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success: `
        <div build-profile-success class="w-form-done">
          <div class="inner"><div dashboard-button-wrap>
            <a href="/starter-onboarding" class="button">Start onboarding</a>
          </div></div>
        </div>
      `,
    }),
  )
  assert.equal(nested.ok, true, nested.findings.join('; '))
})

test('the CTA rule is same-origin per snapshot, matching the runtime module', () => {
  // A production capture whose CTA points at staging is a real defect: members
  // on the live site would be sent to another host.
  const productionToStaging = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      canonical: `${PRODUCTION_ORIGIN}/build-profile/consult`,
      success: `<div build-profile-success><a href="${STAGING_ORIGIN}/starter-onboarding">Go</a></div>`,
    }),
  )
  assert.equal(productionToStaging.ok, false)
  assert.match(productionToStaging.findings.join('\n'), /same-origin link/)

  // The mirror image: on a staging capture the staging href is correct and the
  // production one is not.
  const stagingToStaging = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      canonical: `${STAGING_ORIGIN}/build-profile/consult`,
      success: `<div build-profile-success><a href="${STAGING_ORIGIN}/starter-onboarding">Go</a></div>`,
    }),
  )
  assert.equal(stagingToStaging.ok, true, stagingToStaging.findings.join('; '))

  const stagingToProduction = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      canonical: `${STAGING_ORIGIN}/build-profile/consult`,
      success: `<div build-profile-success><a href="${PRODUCTION_ORIGIN}/starter-onboarding">Go</a></div>`,
    }),
  )
  assert.equal(stagingToProduction.ok, false)

  // Wholly unrelated hosts never pass.
  for (const canonical of [`${PRODUCTION_ORIGIN}/build-profile/consult`, null]) {
    const offSite = auditBuildProfileHtml(
      '/build-profile/consult',
      pageHtml({
        canonical,
        success:
          '<div build-profile-success><a href="https://evil.example/starter-onboarding">Go</a></div>',
      }),
    )
    assert.equal(offSite.ok, false, String(canonical))
  }
})

test('a snapshot with no declared origin still accepts relative CTAs and rejects absolute ones', () => {
  const relative = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      canonical: null,
      success: '<div build-profile-success><a href="/starter-onboarding">Go</a></div>',
    }),
  )
  assert.equal(relative.ok, true, relative.findings.join('; '))

  // Nothing can vouch for an absolute host when the snapshot declares no origin.
  const absolute = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      canonical: null,
      success: `<div build-profile-success><a href="${PRODUCTION_ORIGIN}/starter-onboarding">Go</a></div>`,
    }),
  )
  assert.equal(absolute.ok, false)
})

test('og:url stands in for a missing canonical link', () => {
  const html = pageHtml({
    canonical: null,
    success: `<div build-profile-success><a href="${STAGING_ORIGIN}/starter-onboarding">Go</a></div>`,
  }).replace(
    '<form build-profile-form>',
    `<meta property="og:url" content="${STAGING_ORIGIN}/build-profile/consult"><form build-profile-form>`,
  )
  const result = auditBuildProfileHtml('/build-profile/consult', html)
  assert.equal(result.ok, true, result.findings.join('; '))
})

test('the CTA search is scoped to the success state, not the whole page', () => {
  // A link to onboarding elsewhere on the page does not rescue an empty success
  // state — the member never sees it from there.
  const result = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success:
        '<div build-profile-success><h3>Thanks</h3></div><a href="/starter-onboarding">elsewhere</a>',
    }),
  )
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /must contain a same-origin link to \/starter-onboarding/)
})

test('an unterminated success state fails closed instead of widening to the page', () => {
  // No closing tag: the element's bounds cannot be established. Widening to the
  // rest of the document would let the link below rescue it.
  const result = auditBuildProfileHtml(
    '/build-profile/consult',
    `${pageHtml({ success: '<div build-profile-success class="w-form-done"><h3>Thanks</h3>' })}
     <a href="/starter-onboarding">elsewhere entirely</a>`,
  )
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /bounds could not be established/)
})

test('a nested same-tag element does not end the success state early', () => {
  const result = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success: `
        <div build-profile-success>
          <div><div><h3>Thanks</h3></div></div>
          <a href="/starter-onboarding">Start onboarding</a>
        </div>
      `,
    }),
  )
  assert.equal(result.ok, true, result.findings.join('; '))
})

test('markup inside comments and scripts cannot fake or skew the success state', () => {
  // A commented-out success state is not a success state.
  const commented = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success:
        '<!-- <div build-profile-success><a href="/starter-onboarding">Go</a></div> -->',
    }),
  )
  assert.equal(commented.ok, false)
  assert.match(commented.findings.join('\n'), /\[build-profile-success\] state is missing/)

  // An unbalanced `<div` inside a script string must not skew the depth count
  // and swallow the real closing tag.
  const withScriptNoise = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success: `
        <div build-profile-success>
          <script>var tpl = '<div class="unclosed">'</script>
          <a href="/starter-onboarding">Start onboarding</a>
        </div>
      `,
    }),
  )
  assert.equal(withScriptNoise.ok, true, withScriptNoise.findings.join('; '))
})

test('a tag spelled inside an attribute value cannot skew the success-state bounds', () => {
  // An extra `<div>` in an attribute value used to inflate the depth count, so
  // the slice ran past the real closing tag and the link below rescued a success
  // state that has no CTA of its own.
  const widened = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success:
        '<div build-profile-success><p data-tip="click the <div> below">Thanks</p></div><a href="/starter-onboarding">elsewhere</a>',
    }),
  )
  assert.equal(widened.ok, false)
  assert.match(widened.findings.join('\n'), /must contain a same-origin link to \/starter-onboarding/)

  // The mirror image: a stray `</div>` in an attribute value used to end the
  // element early and hide the CTA that really is inside it.
  const truncated = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success:
        '<div build-profile-success><p data-tip="the </div> below">Thanks</p><a href="/starter-onboarding">Start onboarding</a></div>',
    }),
  )
  assert.equal(truncated.ok, true, truncated.findings.join('; '))
})

test('the CTA href is read as an attribute, not as text inside another attribute', () => {
  // `href=` nested in another attribute's value must not donate a phantom target
  // to an anchor whose real destination is the dashboard.
  const phantom = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success:
        '<div build-profile-success><a href="/starter-dashboard" data-analytics="href=\'/starter-onboarding\'">Dashboard</a></div>',
    }),
  )
  assert.equal(phantom.ok, false)
  assert.match(phantom.findings.join('\n'), /must contain a same-origin link to \/starter-onboarding/)

  // An unquoted href is still a real href.
  const unquoted = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success: '<div build-profile-success><a href=/starter-onboarding>Start onboarding</a></div>',
    }),
  )
  assert.equal(unquoted.ok, true, unquoted.findings.join('; '))
})

test('the success attribute must be an attribute name, not another value', () => {
  const result = auditBuildProfileHtml(
    '/build-profile/consult',
    pageHtml({
      success:
        '<div data-state="build-profile-success"><a href="/starter-onboarding">Go</a></div>',
    }),
  )
  assert.equal(result.ok, false)
  assert.match(result.findings.join('\n'), /\[build-profile-success\] state is missing/)
})

test('the no-op failover probe is allowed when exactly one pinned engine is present', () => {
  const html = `${pageHtml()}
    <script defer src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@v1.59.49/utils/multi-step-failover.js"></script>`
  const result = auditBuildProfileHtml('/build-profile/consult', html)

  assert.equal(result.ok, true, result.findings.join('; '))
})
