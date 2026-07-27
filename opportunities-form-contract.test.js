const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const source = fs.readFileSync(require.resolve('./opportunities-3.0.js'), 'utf8')

test('opportunity creation uses its stable form role instead of Webflow IDs or classes', () => {
  assert.match(source, /\[data-opp-form=["']create["']\]/)
  assert.doesNotMatch(
    source,
    /#(?:wf-form-Opportunity-Create-Form|email-form)|form\.create-opportunities_layout/,
  )
})
