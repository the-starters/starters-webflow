const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

const controllers = ['opportunities-3.0.js', 'opportunities---create.js']

test('opportunity creation uses its stable form role instead of Webflow IDs or classes', () => {
  for (const controller of controllers) {
    const source = fs.readFileSync(require.resolve(`./${controller}`), 'utf8')
    assert.match(source, /\[data-opp-form=["']create["']\]/, controller)
    assert.doesNotMatch(
      source,
      /#(?:opportunities-create-form|wf-form-Opportunity-Create-Form|email-form)|(?:form\.)?create-opportunities_layout/,
      controller,
    )
  }
})
