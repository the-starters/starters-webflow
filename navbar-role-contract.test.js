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
  assert.match(css, /html\[data-opp-role-resolved\] \[data-preview-nav\] \.navbar_link-list/)
})
