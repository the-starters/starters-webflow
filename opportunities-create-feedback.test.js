const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const core = fs.readFileSync(require.resolve('./opportunities-3.0.js'), 'utf8')
const standalone = fs.readFileSync(require.resolve('./opportunities---create.js'), 'utf8')

test('opportunity forms expose visible category validation before wf-validate binds', () => {
  assert.match(core, /const CATEGORY_REQUIRED_MESSAGE = 'Please select at least one category\.'/)
  assert.match(core, /input\.setCustomValidity\(selected\.length \? '' : CATEGORY_REQUIRED_MESSAGE\)/)
  assert.match(core, /prepareOpportunityCreateForms\(\)\s+initOpportunityCategorySelects\(\)/)
  assert.match(core, /categoryInput\.setAttribute\('aria-required', 'true'\)/)
})

test('ongoing part-time opportunities require and submit estimated weekly hours', () => {
  assert.match(core, /name="\$\{EST_HOURS_FIELD_NAME\}"/)
  assert.match(core, /placeholder="Example: 25 hrs\/week"/)
  assert.match(core, /payload\.project_type === 'Ongoing Part Time' && !payload\.est_hours/)
  assert.match(
    core,
    /est_hours: project_type === 'Ongoing Part Time' \? val\(EST_HOURS_FIELD_NAME\) : ''/,
  )
  assert.match(core, /setVal\(EST_HOURS_FIELD_NAME, o\.est_hours\)/)
})

test('standalone create controller delegates to the shared form and validation contract', () => {
  assert.match(standalone, /window\.Opp30\.prepareOpportunityCreateForms\(form\)/)
  assert.match(standalone, /window\.Opp30\.readOpportunityForm\(form\)/)
  assert.match(standalone, /window\.Opp30\.validateOpportunityPayload\(payload\)/)
  assert.match(
    standalone,
    /est_hours: project_type === 'Ongoing Part Time' \? val\('Estimated-Hours'\) : ''/,
  )
})
