const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const css = fs.readFileSync(path.join(__dirname, 'navbar-embeds/navlinks.css'), 'utf8')

test('merged opportunities uses the single authored navbar role contract in published mode', () => {
  assert.match(
    css,
    /html\[data-opp-role-resolved\] \[data-preview-nav='freelancer'\] \[data-ms-content='freelancer-only'\]/,
  )
  assert.match(
    css,
    /html\[data-opp-role-resolved\] \[data-preview-nav='brand'\] \[data-ms-content='premium-brands'\]/,
  )
  assert.match(
    css,
    /html\[data-opp-role-resolved\] \[data-preview-nav\] \.navbar_link-list\s*\{\s*display:\s*none\s*!important\s*;/,
  )
  assert.match(
    css,
    /\[data-ms-content='premium-brands'\]\s*\{\s*display:\s*flex\s*!important\s*;/,
  )
  assert.match(
    css,
    /html:not\(\[data-opp-role-resolved\]\):has\(\[data-opp-role\] \[wf-xano-element='wrapper'\]\[wf-xano-defer='true'\]\) \[data-preview-nav\] #freelancer,/,
  )
  assert.match(
    css,
    /html:not\(\[data-opp-role-resolved\]\):has\(\[data-opp-role\] \[wf-xano-element='wrapper'\]\[wf-xano-defer='true'\]\) \[data-preview-nav\] \[data-ms-content='premium-brands'\]\s*\{\s*display:\s*none\s*!important\s*;/,
  )
  assert.doesNotMatch(
    css,
    /html:not\(\[data-opp-role-resolved\]\):has\(\[data-opp-role\]\) \[data-preview-nav\]/,
  )
})
